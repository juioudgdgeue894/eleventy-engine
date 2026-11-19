#!/usr/bin/env node
/**
 * eleventy-engine-predeploy
 *
 * Clean build + fail-closed check of the output, run before every Worker deploy.
 * Wired as the wrangler `build.command` (after the site's cf-build-gate), so it
 * runs on every path that ships: `npm run deploy:production`, the manual
 * `npx wrangler deploy --config wrangler.production.jsonc`, GitHub Actions and
 * the preview `npm run deploy`.
 *
 *   1. Empties _site, keeping _site/images (the eleventy-img cache; images there
 *      are content-hashed, so keeping them is safe and keeps builds fast).
 *   2. Runs `npm run build` (engine sync, Tailwind CSS, Eleventy).
 *   3. Fails if _site/index.html is missing, _site/css/style.css is missing or
 *      under 1 KB, or any built page links a local stylesheet, script, preload,
 *      icon, manifest, share image or <img> that is not in _site.
 *
 * Exit 1 stops wrangler before anything is uploaded.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { extractAssets, isEdgeInjected } from "./lib/assets.mjs";

const site = process.cwd();
const out = path.join(site, "_site");
const KEEP = new Set(["images"]);
const MIN_CSS_BYTES = 1024;

const fail = (msg, list = []) => {
  console.error(`\n[predeploy] DEPLOY BLOCKED: ${msg}`);
  for (const l of list.slice(0, 40)) console.error(`  - ${l}`);
  if (list.length > 40) console.error(`  ... and ${list.length - 40} more`);
  console.error("");
  process.exit(1);
};

// 0. Only ever run inside an engine site (this script deletes files in _site).
let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(path.join(site, "package.json"), "utf8"));
} catch {
  fail(`no package.json in ${site}`);
}
const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
if (!deps["@jacklamond/eleventy-engine"]) fail(`${site} is not an eleventy-engine site`);
if (!pkg.scripts?.build) fail('package.json has no "build" script');

// 1. Clean _site (keep the image cache).
if (fs.existsSync(out)) {
  for (const e of fs.readdirSync(out)) {
    if (!KEEP.has(e)) fs.rmSync(path.join(out, e), { recursive: true, force: true });
  }
}
console.log(`[predeploy] cleaned _site (kept: ${[...KEEP].join(", ")})`);

// 2. Build.
const b = spawnSync("npm", ["run", "build"], { cwd: site, stdio: "inherit", env: process.env });
if (b.status !== 0) fail(`npm run build exited with ${b.status}`);

// 3. Verify the output.
const problems = [];
if (!fs.existsSync(path.join(out, "index.html"))) problems.push("_site/index.html is missing");
const css = path.join(out, "css", "style.css");
if (!fs.existsSync(css)) problems.push("_site/css/style.css is missing");
else if (fs.statSync(css).size < MIN_CSS_BYTES) problems.push(`_site/css/style.css is only ${fs.statSync(css).size} bytes`);

const htmlFiles = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (p !== path.join(out, "images")) walk(p); }
    else if (e.name.endsWith(".html")) htmlFiles.push(p);
  }
};
if (fs.existsSync(out)) walk(out);

const ORIGIN = "https://site.invalid";
// The site's own hostnames (absolute links such as og:image point at them).
const ownHosts = new Set();
for (const f of ["wrangler.production.jsonc", "wrangler.jsonc"]) {
  const p = path.join(site, f);
  if (!fs.existsSync(p)) continue;
  for (const m of fs.readFileSync(p, "utf8").matchAll(/"pattern"\s*:\s*"([^"/*]+)/g)) ownHosts.add(m[1].toLowerCase());
}
const exists = (pathname) => {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = pathname; }
  const f = path.join(out, rel);
  if (!f.startsWith(out)) return false;
  if (rel.endsWith("/")) return fs.existsSync(path.join(f, "index.html"));
  return (fs.existsSync(f) && fs.statSync(f).isFile()) || fs.existsSync(f + ".html") || fs.existsSync(path.join(f, "index.html"));
};

const missing = new Map(); // "path" -> first page that uses it
let checked = 0;
for (const file of htmlFiles) {
  const pageUrl = ORIGIN + "/" + path.relative(out, file).split(path.sep).join("/");
  const html = fs.readFileSync(file, "utf8");
  for (const { kind, href } of extractAssets(html)) {
    let u;
    try { u = new URL(href.trim(), pageUrl); } catch { continue; }
    const local = u.origin === ORIGIN || ownHosts.has(u.hostname.toLowerCase());
    if (!local || isEdgeInjected(u.pathname)) continue; // external or edge-injected
    checked++;
    if (!exists(u.pathname) && !missing.has(u.pathname))
      missing.set(u.pathname, `${u.pathname} [${kind}] used by /${path.relative(out, file)}`);
  }
}
problems.push(...[...missing.values()].map((m) => "missing " + m));

if (problems.length) fail(`build output is incomplete (${problems.length} problem${problems.length > 1 ? "s" : ""})`, problems);

console.log(
  `[predeploy] OK: ${htmlFiles.length} pages, ${checked} local asset links, css/style.css ${fs.statSync(css).size} bytes`
);
