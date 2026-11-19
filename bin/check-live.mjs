#!/usr/bin/env node
/**
 * eleventy-engine-check-live
 *
 * Post-deploy check of a live (or preview) site. Fails loudly when a page or
 * any asset it needs does not come back 200 with the right content-type.
 *
 *   npx eleventy-engine-check-live [url] [--rollback <version-id>] [--timeout 180]
 *                                  [--pages 4] [--allow <url-substring>]...
 *
 * - url: defaults to https://<first custom_domain route in wrangler.production.jsonc>/
 * - Pages: the homepage plus up to --pages URLs spread across /sitemap.xml.
 * - Assets: stylesheets, scripts, preloads, icons, manifest, share image, <img>.
 *   Redirects are followed; the final response must be 200 with the right type
 *   (text/css for CSS, javascript for JS, image/* for images, font for fonts).
 * - Own-host failures fail the check. Third-party failures are printed as
 *   warnings (not caused by our deploy). URLs matching the allow-list are
 *   ignored: Turnstile's api.js (302 to a versioned file) and the Cloudflare
 *   analytics beacon by default.
 * - Retries every 20 s for --timeout seconds (default 180): after a deploy,
 *   old HTML can show for 1-2 minutes.
 * - On failure exits 1 and prints the rollback command.
 */
import fs from "node:fs";
import path from "node:path";
import { extractAssets, expectedType, typeMatches, isEdgeInjected } from "./lib/assets.mjs";

const DEFAULT_ALLOW = ["challenges.cloudflare.com/turnstile/", "static.cloudflareinsights.com/beacon"];
const UA = "Mozilla/5.0 (compatible; jacklamond-site-check/1.0)";

// ---- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = { url: null, rollback: null, timeout: 180, pages: 4, allow: [...DEFAULT_ALLOW], config: "wrangler.production.jsonc" };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--rollback") opt.rollback = argv[++i];
  else if (a === "--timeout") opt.timeout = Number(argv[++i]);
  else if (a === "--pages") opt.pages = Number(argv[++i]);
  else if (a === "--allow") opt.allow.push(argv[++i]);
  else if (a === "--config" || a === "-c") opt.config = argv[++i];
  else if (!a.startsWith("-")) opt.url = a;
}
if (!opt.url) {
  const p = path.join(process.cwd(), opt.config);
  const m = fs.existsSync(p) && fs.readFileSync(p, "utf8").match(/"pattern"\s*:\s*"([^"/*]+)"\s*,\s*"custom_domain"\s*:\s*true/);
  if (!m) {
    console.error(`[check-live] no url given and no custom_domain route in ${opt.config}`);
    process.exit(2);
  }
  opt.url = `https://${m[1]}/`;
}
const base = new URL(opt.url);
const siteHost = base.hostname.replace(/^www\./, "");
const isOwn = (u) => u.hostname.replace(/^www\./, "") === siteHost;
const allowed = (u) => opt.allow.some((s) => u.href.includes(s));

// ---- http -------------------------------------------------------------------
async function get(url, { body = false } = {}) {
  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, "cache-control": "no-cache" },
      signal: AbortSignal.timeout(20000),
    });
    const text = body ? await r.text() : (await r.arrayBuffer(), "");
    return { status: r.status, type: r.headers.get("content-type") || "", cf: r.headers.get("cf-cache-status") || "-", text, final: r.url };
  } catch (e) {
    return { status: 0, type: "", cf: "-", text: "", error: e.cause?.code || e.name || String(e) };
  }
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// ---- one full pass ----------------------------------------------------------
async function pass() {
  const errors = [], warnings = [];
  const pages = [base.href];
  const sm = await get(new URL("/sitemap.xml", base).href, { body: true });
  if (sm.status === 200) {
    let locs = [...sm.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
    if (locs.length && locs.every((l) => l.endsWith(".xml"))) {
      const sub = await get(locs[0], { body: true });
      locs = [...sub.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
    }
    // Sitemaps list the canonical host; check the host we were asked to check.
    const cands = locs
      .map((l) => { try { const u = new URL(l); return new URL(u.pathname + u.search, base).href; } catch { return null; } })
      .filter((l) => l && l.replace(/\/$/, "") !== base.href.replace(/\/$/, ""))
      .filter((l) => !/\.(jpe?g|png|webp|avif|gif|svg|pdf|xml|txt|zip|mp4)$/i.test(new URL(l).pathname));
    const step = Math.max(1, Math.floor(cands.length / opt.pages));
    for (let k = 0; k < cands.length && pages.length < opt.pages + 1; k += step) pages.push(cands[k]);
  } else {
    warnings.push(`sitemap.xml returned ${sm.status || sm.error}; checking the homepage only`);
  }

  const assets = new Map();
  for (const pg of pages) {
    const r = await get(pg, { body: true });
    if (r.status !== 200 || !r.type.includes("text/html")) {
      errors.push(`page ${pg} -> ${r.status || r.error} ${r.type}`);
      continue;
    }
    const list = extractAssets(r.text);
    if (!list.some((a) => a.kind.includes("stylesheet")) && !/<style[\s>]/i.test(r.text))
      errors.push(`page ${pg} links no stylesheet`);
    for (const { kind, href } of list) {
      let u;
      try { u = new URL(href.trim(), r.final || pg); } catch { continue; }
      if (!/^https?:$/.test(u.protocol) || (isOwn(u) && isEdgeInjected(u.pathname))) continue;
      if (!assets.has(u.href)) assets.set(u.href, kind);
    }
  }

  const check = async ([href, kind]) => {
    const u = new URL(href);
    const exp = expectedType(kind, href);
    const r = await get(href, { body: exp === "css" && isOwn(u) });
    const ok = r.status === 200 && typeMatches(exp, r.type);
    return { u, kind, r, exp, ok };
  };
  const results = await pool([...assets.entries()], 8, check);
  // Fonts referenced from our own stylesheets (icon and web fonts).
  const fonts = new Map();
  for (const { u, exp, ok, r } of results) {
    if (!ok || exp !== "css" || !r.text) continue;
    for (const m of r.text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      if (m[1].startsWith("data:")) continue;
      let f;
      try { f = new URL(m[1], u); } catch { continue; }
      if (/\.(woff2?|ttf|otf)$/i.test(f.pathname) && !assets.has(f.href)) fonts.set(f.href, "css:font");
    }
  }
  results.push(...(await pool([...fonts.entries()], 8, check)));
  for (const { u, kind, r, exp, ok } of results) {
    if (ok || allowed(u)) continue;
    const line = `${r.status || r.error} ${r.type || "-"} (want ${exp || "any"}) cf=${r.cf} [${kind}] ${u.href}`;
    (isOwn(u) ? errors : warnings).push(line);
  }
  return { pages, assetCount: assets.size + fonts.size, errors, warnings };
}

// ---- retry loop ---------------------------------------------------------------
const started = Date.now();
let attempt = 0, last;
console.log(`[check-live] ${base.href} (up to ${opt.timeout}s)`);
while (true) {
  attempt++;
  last = await pass();
  if (!last.errors.length) break;
  const left = opt.timeout * 1000 - (Date.now() - started);
  if (left <= 0) break;
  console.log(`[check-live] attempt ${attempt}: ${last.errors.length} problem(s), retrying in 20s`);
  await new Promise((r) => setTimeout(r, Math.min(20000, left)));
}

for (const w of last.warnings) console.log(`  warning: ${w}`);
if (!last.errors.length) {
  console.log(`[check-live] OK: ${last.pages.length} pages, ${last.assetCount} assets, all 200 with the right type (attempt ${attempt})`);
  process.exit(0);
}
console.error(`\n[check-live] FAILED after ${attempt} attempt(s), ${Math.round((Date.now() - started) / 1000)}s:`);
for (const e of last.errors) console.error(`  - ${e}`);
console.error(
  opt.rollback
    ? `\nRoll back now:\n  npx wrangler rollback ${opt.rollback} --config ${opt.config}\n`
    : `\nRoll back: npx wrangler deployments list --config ${opt.config}, then npx wrangler rollback <previous version id> --config ${opt.config}\n`
);
process.exit(1);
