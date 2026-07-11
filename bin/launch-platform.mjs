#!/usr/bin/env node
/**
 * launch-platform — one-shot, idempotent platform setup for a live site.
 *
 * For each domain it ensures, using provider APIs (no dashboards):
 *   Cloudflare: · Always Use HTTPS on
 *               · www → apex 301 redirect rule (dynamic redirect phase)
 *               · Web Analytics (RUM) site with auto-injected beacon
 *   Google:     · domain ownership verified via DNS TXT (service account)
 *               · you added as co-owner (property shows in YOUR Search Console)
 *               · sc-domain property registered + sitemap submitted
 *   Bing:       · site added + verified via DNS CNAME + sitemap submitted
 *
 * Usage (from the engine repo):
 *   npm run launch:platform -- <domain> [<domain>…]
 *   npm run launch:platform -- --all-sites     # every sibling site dir with a
 *                                              # src/_data/business.json site_url
 *
 * Credentials come from .env in the engine root (gitignored) or the
 * environment — see .env.example for what each one is and where to get it.
 * Steps with missing credentials are skipped and reported, never fatal, so
 * you can adopt providers one at a time. Re-running is always safe.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- tiny .env loader (no deps) ----------------------------------------------
const envFile = path.join(engineRoot, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const ENV = process.env;

// ---- args ---------------------------------------------------------------------
const argv = process.argv.slice(2);
let domains = argv.filter((a) => !a.startsWith("--"));
if (argv.includes("--all-sites")) {
  const siblings = path.resolve(engineRoot, "..");
  for (const entry of fs.readdirSync(siblings, { withFileTypes: true })) {
    const bj = path.join(siblings, entry.name, "src", "_data", "business.json");
    if (entry.isDirectory() && fs.existsSync(bj)) {
      try {
        const url = JSON.parse(fs.readFileSync(bj, "utf8"))?.seo?.site_url;
        const host = url && new URL(url).hostname;
        // starter/template placeholders aren't real sites
        if (host && host !== "example.com") domains.push(host);
      } catch {}
    }
  }
}
domains = [...new Set(domains)];
if (!domains.length) {
  console.error("usage: launch-platform.mjs <domain>… | --all-sites");
  process.exit(1);
}

// ---- helpers --------------------------------------------------------------------
const results = []; // {domain, step, status: ok|already|skip|fail, note}
const log = (domain, step, status, note = "") => {
  const icon = { ok: "✓", already: "•", skip: "↷", fail: "✗" }[status];
  console.log(`  ${icon} ${step}${note ? " — " + note : ""}`);
  results.push({ domain, step, status, note });
};

async function api(url, { method = "GET", token, headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ═══ CLOUDFLARE ═══════════════════════════════════════════════════════════════
const CF = "https://api.cloudflare.com/client/v4";
const cfToken = ENV.CLOUDFLARE_API_TOKEN;
// Web Analytics (RUM) site creation has NO API-token permission group (only
// "Account Analytics: Read" exists) — the endpoint accepts the Global API Key.
// Used exclusively for the rum/* calls below; everything else stays on the token.
const cfGlobalAuth = ENV.CLOUDFLARE_EMAIL && ENV.CLOUDFLARE_GLOBAL_API_KEY
  ? { "X-Auth-Email": ENV.CLOUDFLARE_EMAIL, "X-Auth-Key": ENV.CLOUDFLARE_GLOBAL_API_KEY }
  : null;
let cfZones = null, cfAccountId = null;

async function cfInit() {
  if (!cfToken) return false;
  if (cfZones) return true;
  cfZones = new Map();
  let page = 1;
  while (true) {
    const { json } = await api(`${CF}/zones?per_page=50&page=${page}`, { token: cfToken });
    if (!json?.success) { console.error("  Cloudflare token rejected:", JSON.stringify(json?.errors)); cfZones = null; return false; }
    for (const z of json.result) cfZones.set(z.name, z.id);
    if (page >= json.result_info.total_pages) break;
    page++;
  }
  const acc = await api(`${CF}/accounts`, { token: cfToken });
  cfAccountId = ENV.CLOUDFLARE_ACCOUNT_ID || acc.json?.result?.[0]?.id || null;
  return true;
}

async function cfAlwaysHttps(domain, zone) {
  const get = await api(`${CF}/zones/${zone}/settings/always_use_https`, { token: cfToken });
  if (get.json?.result?.value === "on") return log(domain, "Always Use HTTPS", "already");
  const set = await api(`${CF}/zones/${zone}/settings/always_use_https`, { method: "PATCH", token: cfToken, body: { value: "on" } });
  log(domain, "Always Use HTTPS", set.json?.success ? "ok" : "fail", set.json?.success ? "" : JSON.stringify(set.json?.errors));
}

async function cfWwwRedirect(domain, zone) {
  const phase = `${CF}/zones/${zone}/rulesets/phases/http_request_dynamic_redirect/entrypoint`;
  const rule = {
    description: `www to apex 301 (${domain})`,
    expression: `(http.host eq "www.${domain}")`,
    action: "redirect",
    action_parameters: {
      from_value: {
        status_code: 301,
        target_url: { expression: `concat("https://${domain}", http.request.uri.path)` },
        preserve_query_string: true,
      },
    },
  };
  const get = await api(phase, { token: cfToken });
  if (get.status === 200 && get.json?.result?.rules?.some((r) => r.expression?.includes(`"www.${domain}"`)))
    return log(domain, "www → apex redirect", "already");
  let res;
  if (get.status === 200) {
    const rules = [...(get.json.result.rules || []), rule].map(({ id, last_updated, ref, version, ...keep }) => keep);
    res = await api(`${CF}/zones/${zone}/rulesets/${get.json.result.id}`, { method: "PUT", token: cfToken, body: { rules } });
  } else {
    res = await api(`${CF}/zones/${zone}/rulesets`, {
      method: "POST", token: cfToken,
      body: { name: "default", kind: "zone", phase: "http_request_dynamic_redirect", rules: [rule] },
    });
  }
  log(domain, "www → apex redirect", res.json?.success ? "ok" : "fail", res.json?.success ? "" : JSON.stringify(res.json?.errors).slice(0, 160));
}

async function cfWebAnalytics(domain, zone) {
  if (!cfGlobalAuth)
    return log(domain, "Web Analytics", "skip", "needs CLOUDFLARE_EMAIL + CLOUDFLARE_GLOBAL_API_KEY (no token permission exists for RUM site creation) - or add the site once in the dashboard");
  if (!cfAccountId) return log(domain, "Web Analytics", "fail", "set CLOUDFLARE_ACCOUNT_ID in .env");
  const auth = { headers: cfGlobalAuth };
  const list = await api(`${CF}/accounts/${cfAccountId}/rum/site_info/list?per_page=100`, auth);
  const existing = (list.json?.result || []).find((s) => s.ruleset?.zone_name === domain || s.host === domain);
  if (existing) return log(domain, "Web Analytics", "already", `site_tag ${existing.site_tag}`);
  const res = await api(`${CF}/accounts/${cfAccountId}/rum/site_info`, {
    ...auth, method: "POST",
    body: { host: domain, zone_tag: zone, auto_install: true },
  });
  log(domain, "Web Analytics", res.json?.success ? "ok" : "fail",
    res.json?.success
      ? `site_tag ${res.json.result?.site_tag} - set business.seo.cf_beacon_token to this (edge auto-injection skips Worker-served HTML; base.njk emits the beacon)`
      : JSON.stringify(res.json?.errors).slice(0, 160));
}

// DNS record helpers (used by Google TXT + Bing CNAME verification)
async function cfEnsureRecord(domain, zone, type, name, content) {
  const q = await api(`${CF}/zones/${zone}/dns_records?type=${type}&name=${encodeURIComponent(name)}`, { token: cfToken });
  const hit = (q.json?.result || []).find((r) => r.content?.replace(/^"|"$/g, "") === content || r.content === content);
  if (hit) return "already";
  const res = await api(`${CF}/zones/${zone}/dns_records`, {
    method: "POST", token: cfToken,
    body: { type, name, content, ttl: 300, proxied: false },
  });
  return res.json?.success ? "ok" : "fail:" + JSON.stringify(res.json?.errors).slice(0, 140);
}

// ═══ GOOGLE (Site Verification + Search Console via service account) ═══════════
let googleToken = null;
async function googleAuth() {
  const keyPath = ENV.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!keyPath || !fs.existsSync(keyPath)) return null;
  if (googleToken) return googleToken;
  const key = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/siteverification https://www.googleapis.com/auth/webmasters",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3500,
  })}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(unsigned), key.private_key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${unsigned}.${sig}`,
  });
  const json = await res.json();
  googleToken = json.access_token || null;
  if (!googleToken) console.error("  Google auth failed:", JSON.stringify(json).slice(0, 200));
  return googleToken;
}

async function googleSetup(domain, zone) {
  const token = await googleAuth();
  if (!token) return log(domain, "Google Search Console", "skip", "GOOGLE_SERVICE_ACCOUNT_JSON not configured");
  const site = { identifier: domain, type: "INET_DOMAIN" };

  // 1. verification token → DNS TXT
  const tok = await api("https://www.googleapis.com/siteVerification/v1/token", {
    method: "POST", token, body: { site, verificationMethod: "DNS_TXT" },
  });
  if (!tok.json?.token) return log(domain, "Google verification", "fail", JSON.stringify(tok.json).slice(0, 140));
  if (cfToken && zone) {
    const rec = await cfEnsureRecord(domain, zone, "TXT", domain, tok.json.token);
    if (rec.startsWith("fail")) return log(domain, "Google verification TXT", "fail", rec);
  } else {
    return log(domain, "Google verification", "skip", `add TXT manually: ${tok.json.token}`);
  }

  // 2. verify (retry for DNS propagation), then co-own + property + sitemap
  let verified = null;
  for (let i = 0; i < 5 && !verified; i++) {
    const v = await api("https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=DNS_TXT", {
      method: "POST", token, body: { site },
    });
    if (v.json?.id) verified = v.json;
    else await sleep(15000);
  }
  if (!verified) return log(domain, "Google verification", "fail", "TXT added but verify did not confirm - rerun later");
  log(domain, "Google verification", "ok");

  const owner = ENV.GSC_OWNER_EMAIL;
  if (owner && !(verified.owners || []).includes(owner)) {
    // Google returns webResource ids already percent-encoded ("dns%3A%2F%2F…");
    // encoding again double-escapes and the API rejects the site as invalid.
    const idPath = verified.id.includes("%") ? verified.id : encodeURIComponent(verified.id);
    const upd = await api(`https://www.googleapis.com/siteVerification/v1/webResource/${idPath}`, {
      method: "PUT", token, body: { id: verified.id, site: verified.site, owners: [...(verified.owners || []), owner] },
    });
    const coOk = upd.json?.owners?.includes(owner);
    log(domain, "Search Console co-owner", coOk ? "ok" : "fail", coOk ? owner : `${owner}: ${JSON.stringify(upd.json?.error || upd.json).slice(0, 160)}`);
  }

  const prop = `sc-domain:${domain}`;
  const add = await api(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(prop)}`, { method: "PUT", token });
  log(domain, "Search Console property", add.status === 204 || add.status === 200 ? "ok" : "fail", prop);
  const sm = await api(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(prop)}/sitemaps/${encodeURIComponent(`https://${domain}/sitemap.xml`)}`, { method: "PUT", token });
  log(domain, "Google sitemap submitted", sm.status === 204 || sm.status === 200 ? "ok" : "fail");
}

// ═══ BING WEBMASTER ═════════════════════════════════════════════════════════════
async function bingSetup(domain, zone) {
  const key = ENV.BING_WEBMASTER_API_KEY;
  if (!key) return log(domain, "Bing Webmaster", "skip", "BING_WEBMASTER_API_KEY not configured");
  const B = `https://ssl.bing.com/webmaster/api.svc/json`;
  const post = (m, body) => api(`${B}/${m}?apikey=${key}`, { method: "POST", body });
  const siteUrl = `https://${domain}/`;

  const sites = await api(`${B}/GetUserSites?apikey=${key}`);
  const existing = (sites.json?.d || []).find((s) => (s.Url || "").includes(domain));
  if (!existing) {
    const add = await post("AddSite", { siteUrl });
    log(domain, "Bing site added", add.status === 200 ? "ok" : "fail", add.status === 200 ? "" : JSON.stringify(add.json).slice(0, 140));
  } else log(domain, "Bing site added", "already", existing.IsVerified ? "verified" : "not yet verified");

  if (!existing?.IsVerified) {
    const code = ENV.BING_VERIFICATION_CODE;
    if (code && cfToken && zone) {
      const rec = await cfEnsureRecord(domain, zone, "CNAME", `${code}.${domain}`, "verify.bing.com");
      if (rec.startsWith("fail")) return log(domain, "Bing verification CNAME", "fail", rec);
      let ok = false;
      for (let i = 0; i < 4 && !ok; i++) {
        const v = await post("VerifySite", { siteUrl });
        ok = v.json?.d === true;
        if (!ok) await sleep(15000);
      }
      log(domain, "Bing verification", ok ? "ok" : "fail", ok ? "" : "CNAME added but verify pending - rerun later");
    } else {
      log(domain, "Bing verification", "skip", "BING_VERIFICATION_CODE not configured");
    }
  }

  const feed = await post("SubmitFeed", { siteUrl, feedUrl: `https://${domain}/sitemap.xml` });
  log(domain, "Bing sitemap submitted", feed.status === 200 ? "ok" : "fail", feed.status === 200 ? "" : JSON.stringify(feed.json).slice(0, 120));
}

// ═══ INDEXNOW ═══════════════════════════════════════════════════════════════════
async function indexNowPing(domain) {
  if (!ENV.INDEXNOW_KEY) return log(domain, "IndexNow ping", "skip", "INDEXNOW_KEY not configured");
  const { execFileSync } = await import("node:child_process");
  try {
    const out = execFileSync(process.execPath, [path.join(engineRoot, "bin", "indexnow-ping.mjs"), domain], { encoding: "utf8" });
    log(domain, "IndexNow ping", "ok", out.trim().replace(/^✓ /, ""));
  } catch (e) {
    log(domain, "IndexNow ping", "fail", (e.stdout || e.stderr || e.message || "").toString().trim().slice(0, 140));
  }
}

// ═══ RUN ════════════════════════════════════════════════════════════════════════
const haveCf = await cfInit();
for (const domain of domains) {
  console.log(`\n${domain}`);
  const zone = haveCf ? cfZones.get(domain) : null;
  if (haveCf && !zone) { log(domain, "Cloudflare zone", "fail", "domain not in this account"); }
  if (!haveCf) log(domain, "Cloudflare (HTTPS, redirect, analytics)", "skip", "CLOUDFLARE_API_TOKEN not configured");
  if (zone) {
    await cfAlwaysHttps(domain, zone);
    await cfWwwRedirect(domain, zone);
    await cfWebAnalytics(domain, zone);
  }
  await googleSetup(domain, zone);
  await bingSetup(domain, zone);
  await indexNowPing(domain);
}

// summary
const counts = { ok: 0, already: 0, skip: 0, fail: 0 };
for (const r of results) counts[r.status]++;
console.log(`\n──────────────────────────────────────────`);
console.log(`done: ${counts.ok} changed · ${counts.already} already set · ${counts.skip} skipped (missing credentials) · ${counts.fail} failed`);
if (counts.fail) {
  for (const r of results.filter((r) => r.status === "fail")) console.log(`  ✗ ${r.domain}: ${r.step} — ${r.note}`);
  process.exit(1);
}
