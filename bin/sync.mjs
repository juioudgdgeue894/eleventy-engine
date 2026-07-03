#!/usr/bin/env node
/**
 * eleventy-engine-sync
 *
 * Materialises the shared engine files into the consuming site's working tree.
 * Run automatically on `postinstall` and `prebuild` (and `predev`), both locally
 * and in CI (Netlify), so the site always reflects the pinned engine version
 * without committing engine files to the site repo.
 *
 * Copies (overwriting):
 *   <engine>/_includes        -> <site>/src/_includes
 *   <engine>/pages/*          -> <site>/src/*            (framework pages)
 *   <engine>/css/input.css    -> <site>/src/css/input.css
 *   <engine>/functions/*      -> <site>/functions/*      (Cloudflare Pages Functions)
 *   <engine>/CLAUDE.shared.md -> <site>/.engine/CLAUDE.shared.md
 *
 * It never touches site-owned files: src/index.njk, src/_data/*, src/css/user.css,
 * src/images, src/fonts, src/posts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = process.cwd();

const mkdirp = (p) => fs.mkdirSync(p, { recursive: true });
const cp = (from, to) => fs.cpSync(from, to, { recursive: true, force: true });

let copied = 0;

// 1. Layouts + partials
mkdirp(path.join(site, "src"));
cp(path.join(engineRoot, "_includes"), path.join(site, "src", "_includes"));
copied += fs.readdirSync(path.join(engineRoot, "_includes", "partials")).length;

// 2. Framework pages -> src root
const pagesDir = path.join(engineRoot, "pages");
for (const file of fs.readdirSync(pagesDir)) {
  cp(path.join(pagesDir, file), path.join(site, "src", file));
  copied += 1;
}

// 3. CSS mechanism file
mkdirp(path.join(site, "src", "css"));
cp(path.join(engineRoot, "css", "input.css"), path.join(site, "src", "css", "input.css"));

// 4. Cloudflare Pages Functions (serverless handlers, e.g. contact-form email).
//    Regenerated at build time, so sites gitignore ./functions like other synced files.
const fnDir = path.join(engineRoot, "functions");
if (fs.existsSync(fnDir)) {
  cp(fnDir, path.join(site, "functions"));
  copied += 1;
}

// 4b. Cloudflare Worker entry (static-assets sites). The site's wrangler.jsonc
//     points main -> worker/index.js; regenerated at build time (gitignored).
const workerDir = path.join(engineRoot, "worker");
if (fs.existsSync(workerDir)) {
  cp(workerDir, path.join(site, "worker"));
  copied += 1;
}

// 5. Shared Claude rules (imported by the site's CLAUDE.md)
mkdirp(path.join(site, ".engine"));
cp(path.join(engineRoot, "CLAUDE.shared.md"), path.join(site, ".engine", "CLAUDE.shared.md"));

// 6. Guard: a Worker-with-assets site must route /api/* through the Worker.
//    Browsers send `Sec-Fetch-Mode: navigate` on form submissions; without
//    assets.run_worker_first the asset layer answers those POSTs with an empty
//    405 before the Worker runs, and the contact form saves a 0-byte download
//    named "contact" in every real browser — while curl/fetch() tests (which
//    don't send the header) keep passing. Fail the build rather than let a
//    broken config deploy. Runs on prebuild locally and in Cloudflare CI.
const wranglerPath = path.join(site, "wrangler.jsonc");
if (fs.existsSync(wranglerPath)) {
  const raw = fs.readFileSync(wranglerPath, "utf8");

  // Strip // and /* */ comments without touching string contents (URLs!).
  const stripJsonc = (s) => {
    let out = "", inStr = false, inLine = false, inBlock = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i], n = s[i + 1];
      if (inLine) { if (c === "\n") { inLine = false; out += c; } continue; }
      if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++; } continue; }
      if (inStr) { out += c; if (c === "\\") { out += n ?? ""; i++; } else if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; out += c; continue; }
      if (c === "/" && n === "/") { inLine = true; continue; }
      if (c === "/" && n === "*") { inBlock = true; i++; continue; }
      out += c;
    }
    return out;
  };

  const fail = (msg) => {
    console.error(`\n[eleventy-engine] BUILD BLOCKED — wrangler.jsonc misconfiguration:\n  ${msg}\n`);
    process.exit(1);
  };

  let cfg = null;
  try {
    cfg = JSON.parse(stripJsonc(raw).replace(/,\s*([}\]])/g, "$1"));
  } catch {}

  if (cfg && cfg.assets) {
    if (!cfg.main) {
      fail('set "main": "worker/index.js" — without it wrangler deploys assets only and /api/contact is never handled (contact form downloads a file named "contact").');
    }
    const rwf = cfg.assets.run_worker_first;
    const covered =
      rwf === true ||
      (Array.isArray(rwf) &&
        rwf.some((p) => typeof p === "string" && !p.startsWith("!") && (p === "/*" || p === "/api/*" || p.startsWith("/api"))));
    if (!covered) {
      fail('add "run_worker_first": ["/api/*"] inside the "assets" block — without it the asset layer answers browser form posts (Sec-Fetch-Mode: navigate) with an empty 405 before the Worker runs, breaking the contact form in every real browser while curl tests still pass.');
    }
  } else if (!cfg && /"assets"/.test(raw) && !/run_worker_first/.test(raw)) {
    fail('could not parse wrangler.jsonc, and it looks like a Worker-with-assets config without "run_worker_first": ["/api/*"] — add it inside the "assets" block.');
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(engineRoot, "package.json"), "utf8"));
console.log(`[eleventy-engine] synced ${pkg.name}@${pkg.version} (${copied} shared files) into ./src`);
