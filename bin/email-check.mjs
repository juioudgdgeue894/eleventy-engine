#!/usr/bin/env node
/**
 * email-check - read-only check that a domain's email is set up to be trusted.
 *
 * For each domain it reads DNS (Cloudflare DNS-over-HTTPS, no keys) and reports:
 *   · MX: which provider receives the mail (Google, Zoho, Fastmail, Microsoft, Cloudflare routing)
 *   · SPF: exactly one v=spf1 record
 *   · DKIM: a key for the provider that sends the domain's own mail, plus Cloudflare
 *     Email Sending's key (cf-bounce) when the site's contact form sends from the domain
 *   · DMARC: present, and its policy
 * A DMARC policy of quarantine/reject with no DKIM for the mail provider is a FAIL:
 * forwarded mail and mailing-list replies from that domain get rejected.
 *
 * Usage (from the engine repo):
 *   npm run email:check -- <domain> [<domain>…]
 *   npm run email:check -- --all-sites        # every fleet site with a real seo.site_url
 * Exit code 1 if any domain fails.
 */
import fs from "node:fs";
import path from "node:path";
import { siteDirs } from "./sites.mjs";

const PROVIDERS = [
  { name: "Google Workspace", mx: /google(mail)?\.com\.?$/i, dkim: ["google"] },
  { name: "Zoho", mx: /zoho\.(eu|com|in|uk)\.?$/i, dkim: ["zmail", "zoho"] },
  { name: "Fastmail", mx: /messagingengine\.com\.?$/i, dkim: ["fm1", "fm2", "fm3"] },
  { name: "Microsoft 365", mx: /protection\.outlook\.com\.?$/i, dkim: ["selector1", "selector2"] },
  { name: "Cloudflare Email Routing", mx: /mx\.cloudflare\.net\.?$/i, dkim: [] },
];

async function dns(name, type) {
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { accept: "application/dns-json" },
  });
  const j = await r.json();
  return (j.Answer || []).filter((a) => a.type === { TXT: 16, MX: 15, CNAME: 5 }[type]).map((a) => a.data.replace(/^"|"$/g, "").replace(/" "/g, ""));
}

async function hasKey(selector, domain) {
  const host = `${selector}._domainkey.${domain}`;
  return (await dns(host, "TXT")).some((t) => /p=/.test(t)) || (await dns(host, "CNAME")).length > 0;
}

async function check(domain) {
  const out = { domain, ok: true, lines: [] };
  const bad = (msg) => { out.ok = false; out.lines.push(`  ✗ ${msg}`); };
  const good = (msg) => out.lines.push(`  ✓ ${msg}`);
  const note = (msg) => out.lines.push(`  · ${msg}`);

  const mx = (await dns(domain, "MX")).map((m) => m.split(" ").pop());
  const provider = PROVIDERS.find((p) => mx.some((h) => p.mx.test(h)));
  if (!mx.length) note("no MX: the domain receives no email");
  else good(`MX: ${provider ? provider.name : mx[0]}`);

  const spf = (await dns(domain, "TXT")).filter((t) => t.startsWith("v=spf1"));
  if (spf.length === 1) good(`SPF: ${spf[0]}`);
  else if (!spf.length) bad("SPF: missing");
  else bad(`SPF: ${spf.length} records (only one is allowed)`);

  const dmarc = (await dns(`_dmarc.${domain}`, "TXT")).find((t) => t.startsWith("v=DMARC1"));
  const policy = dmarc?.match(/p=(\w+)/)?.[1];
  if (!dmarc) bad("DMARC: missing");
  else good(`DMARC: p=${policy}`);

  if (provider?.dkim.length) {
    let found = null;
    for (const s of provider.dkim) if (await hasKey(s, domain)) { found = s; break; }
    if (found) good(`DKIM (${provider.name}): ${found}._domainkey`);
    else if (policy === "reject" || policy === "quarantine")
      bad(`DKIM (${provider.name}): missing while DMARC is p=${policy}, so forwarded mail can be rejected. Generate the key in the provider's admin and add it as ${provider.dkim[0]}._domainkey`);
    else bad(`DKIM (${provider.name}): missing. Generate the key in the provider's admin and add it as ${provider.dkim[0]}._domainkey`);
  } else if (mx.length && !provider) note(`DKIM: unknown provider (${mx[0]}), check by hand`);

  if (await hasKey("cf-bounce", domain)) good("Cloudflare Email Sending (contact form): cf-bounce._domainkey");
  else note("Cloudflare Email Sending not onboarded (only needed if the contact form sends from this domain)");
  return out;
}

const args = process.argv.slice(2);
let domains = args.filter((a) => !a.startsWith("--"));
if (args.includes("--all-sites")) {
  for (const { dir } of siteDirs()) {
    try {
      const url = JSON.parse(fs.readFileSync(path.join(dir, "src", "_data", "business.json"), "utf8"))?.seo?.site_url;
      const host = url && new URL(url).hostname;
      if (host && host !== "example.com" && !domains.includes(host)) domains.push(host);
    } catch {}
  }
}
if (!domains.length) { console.error("usage: npm run email:check -- <domain> [<domain>…] | --all-sites"); process.exit(2); }

let failed = 0;
for (const d of domains) {
  const r = await check(d);
  console.log(`\n${r.ok ? "PASS" : "FAIL"} ${d}`);
  console.log(r.lines.join("\n"));
  if (!r.ok) failed++;
}
console.log(`\n${domains.length - failed}/${domains.length} pass`);
process.exit(failed ? 1 : 0);
