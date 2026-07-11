#!/usr/bin/env node
/**
 * indexnow-ping — tell IndexNow-connected search engines (Bing, plus the AI
 * answer engines that consume IndexNow) that a site's pages changed, so they
 * re-crawl in minutes instead of on the sitemap cadence. Google ignores
 * IndexNow; it still discovers via the submitted sitemap.
 *
 * Usage (from the engine repo):
 *   node bin/indexnow-ping.mjs <domain> [url ...]
 *
 * With no explicit URLs it submits every <loc> from the live sitemap.xml —
 * right after a deploy that's the honest signal ("these pages may have
 * changed"). Pass specific URLs when only a few pages moved.
 *
 * Requires INDEXNOW_KEY in the engine .env, and the site must serve
 * /<key>.txt (engine v1.18.6+ emits it when business.seo.indexnow_key is set).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(engineRoot, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const [domain, ...urls] = process.argv.slice(2);
const key = process.env.INDEXNOW_KEY;
if (!domain) { console.error("usage: indexnow-ping.mjs <domain> [url ...]"); process.exit(1); }
if (!key) { console.error("INDEXNOW_KEY not set in engine .env"); process.exit(1); }

// The key file must be live before pinging, or the submission is discarded.
const keyUrl = `https://${domain}/${key}.txt`;
const keyRes = await fetch(keyUrl).catch(() => null);
if (!keyRes?.ok || (await keyRes.text()).trim() !== key) {
  console.error(`✗ ${keyUrl} is not serving the key - set business.seo.indexnow_key and redeploy first`);
  process.exit(1);
}

let urlList = urls;
if (!urlList.length) {
  const sm = await fetch(`https://${domain}/sitemap.xml`).then((r) => r.text()).catch(() => "");
  urlList = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}
if (!urlList.length) { console.error("no URLs to submit"); process.exit(1); }

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: domain, key, keyLocation: keyUrl, urlList }),
});
// 200 = submitted, 202 = accepted (key validation pending) — both fine.
if (res.status === 200 || res.status === 202) {
  console.log(`✓ IndexNow: submitted ${urlList.length} URL(s) for ${domain} (HTTP ${res.status})`);
} else {
  console.error(`✗ IndexNow rejected the submission: HTTP ${res.status} ${await res.text().catch(() => "")}`);
  process.exit(1);
}
