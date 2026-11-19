/**
 * Shared asset helpers for eleventy-engine-predeploy and eleventy-engine-check-live.
 * No dependencies: a small tag scanner is enough for the engine's own HTML.
 */

const TAG_RE = /<(link|script|meta|img)\b([^>]*)>/gi;
const ATTR_RE = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function attrs(raw) {
  const out = {};
  for (const m of raw.matchAll(ATTR_RE)) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
  return out;
}

const LINK_RELS = ["stylesheet", "preload", "modulepreload", "icon", "manifest"];

/**
 * Every asset a page needs to render: stylesheets, preloads, icons, manifest,
 * scripts, share image and <img src>. Returns [{ kind, href }].
 */
export function extractAssets(html) {
  const found = [];
  for (const m of html.matchAll(TAG_RE)) {
    const tag = m[1].toLowerCase();
    const a = attrs(m[2]);
    if (tag === "link" && a.href) {
      const rel = (a.rel || "").toLowerCase();
      if (rel.split(/\s+/).some((t) => LINK_RELS.includes(t) || t.endsWith("-icon")))
        found.push({ kind: rel + (a.as ? ":" + a.as : ""), href: a.href });
    } else if (tag === "script" && a.src) {
      found.push({ kind: "script", href: a.src });
    } else if (tag === "meta" && a.content && (a.property === "og:image" || a.name === "twitter:image")) {
      found.push({ kind: "og:image", href: a.content });
    } else if (tag === "img" && a.src && !a.src.startsWith("data:")) {
      found.push({ kind: "img", href: a.src });
    }
  }
  return found;
}

/** What content-type an asset must come back with. */
export function expectedType(kind, url) {
  const p = new URL(url).pathname.toLowerCase();
  if (kind.includes("stylesheet") || kind.endsWith(":style") || p.endsWith(".css")) return "css";
  if (kind === "script" || kind.endsWith(":script") || kind.includes("modulepreload") || /\.m?js$/.test(p)) return "js";
  if (kind.endsWith(":font") || /\.(woff2?|ttf|otf)$/.test(p)) return "font";
  if (kind.includes("manifest") || /\.(webmanifest|json)$/.test(p)) return "json";
  if (kind.includes("icon") || kind === "og:image" || kind === "img" || kind.endsWith(":image") ||
      /\.(png|jpe?g|webp|avif|gif|svg|ico)$/.test(p)) return "image";
  return null;
}

export function typeMatches(expected, contentType) {
  const ct = (contentType || "").toLowerCase();
  switch (expected) {
    case null: return true;
    case "css": return ct.includes("text/css");
    case "js": return ct.includes("javascript") || ct.includes("ecmascript");
    case "font": return ct.startsWith("font/") || ct.includes("font") || ct.includes("octet-stream");
    case "json": return ct.includes("json");
    case "image": return ct.startsWith("image/");
    default: return true;
  }
}

/** Paths a deploy never ships itself (Cloudflare injects them at the edge). */
export function isEdgeInjected(pathname) {
  return pathname.startsWith("/cdn-cgi/");
}
