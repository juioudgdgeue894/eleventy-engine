const path = require("path");
const fs = require("fs");
const Image = require("@11ty/eleventy-img");

// {% image "filename.jpg", "Alt text" %}
// {% image "filename.jpg", "Alt text", "(min-width:640px) 50vw, 100vw" %}
// {% image "filename.jpg", "Alt text", "100vw", "cd-rounded-img object-cover" %}
// Source files must live in src/images/. Outputs WebP + JPEG at 480/800/1200 w.
// Alt text is required; pass "" for purely decorative images.
async function imageShortcode(src, alt, sizes = "100vw", cls = "", loading = "lazy") {
  if (alt === undefined) {
    throw new Error(`{% image %} is missing alt text for: ${src}`);
  }
  // Resolve from src/photos first — that folder is NOT passthrough-copied, so the
  // full-res originals never ship (only the optimised output below does). Falls
  // back to src/images for backward compatibility with existing sites.
  const input =
    [`./src/photos/${src}`, `./src/images/${src}`].find((p) => fs.existsSync(p)) ||
    `./src/images/${src}`;
  const meta = await Image(input, {
    widths: [480, 800, 1200],
    formats: ["webp", "jpeg"],
    outputDir: "./_site/images/",
    urlPath: "/images/",
    // Lean, visually-lossless compression. WebP q72 and mozjpeg q78 roughly
    // halve photo weight versus the sharp defaults with no perceptible loss.
    sharpWebpOptions: { quality: 72 },
    sharpJpegOptions: { quality: 78, mozjpeg: true },
  });
  return Image.generateHTML(meta, {
    alt,
    sizes,
    loading,
    decoding: "async",
    // Above-the-fold images (loading="eager") are almost always the LCP
    // element - tell the browser to fetch them at high priority.
    ...(loading === "eager" ? { fetchpriority: "high" } : {}),
    ...(cls ? { class: cls } : {}),
  });
}

// {% preload_image "hero.jpg", "100vw" %} — emits a <link rel="preload"> for the
// page's LCP hero image (same pipeline/widths as {% image %}, WebP entries), so
// the fetch starts before the render-blocking stylesheet finishes. Pages opt in
// via frontmatter (see base.njk); sizes must match the {% image %} call.
async function preloadImageShortcode(src, sizes = "100vw") {
  const input =
    [`./src/photos/${src}`, `./src/images/${src}`].find((p) => fs.existsSync(p)) ||
    `./src/images/${src}`;
  const meta = await Image(input, {
    widths: [480, 800, 1200],
    formats: ["webp", "jpeg"],
    outputDir: "./_site/images/",
    urlPath: "/images/",
    sharpWebpOptions: { quality: 72 },
    sharpJpegOptions: { quality: 78, mozjpeg: true },
  });
  const webp = meta.webp || [];
  if (!webp.length) return "";
  const srcset = webp.map((w) => `${w.url} ${w.width}w`).join(", ");
  return `<link rel="preload" as="image" imagesrcset="${srcset}" imagesizes="${sizes}" fetchpriority="high" />`;
}

/**
 * Shared Eleventy engine. A consuming site's .eleventy.js is just:
 *   module.exports = require("@jacklamond/eleventy-engine/eleventy");
 * Layouts, partials, framework pages and the components catalog are synced into
 * the site's src/ tree by `eleventy-engine-sync` (run on postinstall / prebuild).
 */
module.exports = function (eleventyConfig) {
  // Synced engine files (framework pages, _includes) are gitignored in the site repo so
  // they're never committed. Eleventy honours .gitignore for input by default, which would
  // wrongly skip them — disable that so the synced pages are always built.
  eleventyConfig.setUseGitIgnore(false);

  eleventyConfig.addAsyncShortcode("image", imageShortcode);
  eleventyConfig.addAsyncShortcode("preload_image", preloadImageShortcode);
  // Tailwind CSS is output directly to _site/css/style.css by the css / css:watch scripts.

  eleventyConfig.addPassthroughCopy({ "src/fonts": "fonts" });

  // Any plain JS / images you drop in src/js or src/images ship as-is.
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });
  eleventyConfig.addPassthroughCopy({ "src/images": "images" });

  // Emit a root /favicon.ico when the site provides one. Browsers auto-discover
  // it at the root, and Safari needs a raster icon here (it won't render the SVG
  // favicon when that SVG just wraps a raster image).
  if (fs.existsSync("src/images/favicon.ico")) {
    eleventyConfig.addPassthroughCopy({ "src/images/favicon.ico": "favicon.ico" });
  }

  // Flowbite's bundled JS — resolved from wherever npm installed it (hoisted or
  // nested), so the site has zero runtime CDN dependency.
  const flowbiteJs = require.resolve("flowbite/dist/flowbite.min.js");
  eleventyConfig.addPassthroughCopy({
    [path.relative(process.cwd(), flowbiteJs)]: "js/flowbite.min.js",
  });

  // Handy in footers: {{ "now" | currentYear }} -> 2026
  // Real engine version for the <meta name="generator"> tag in base.njk.
  eleventyConfig.addGlobalData(
    "engineVersion",
    () => require("./package.json").version,
  );

  eleventyConfig.addFilter("currentYear", () => new Date().getFullYear());

  // {{ post.date | readableDate }} -> 15 January 2026
  eleventyConfig.addFilter("readableDate", (date) =>
    new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
  );

  // {{ post.date | isoDate }} -> 2026-01-15 (used in sitemap.xml <lastmod>)
  eleventyConfig.addFilter("isoDate", (date) => new Date(date).toISOString().split("T")[0]);

  // {{ business.social | pluck("url") }} -> ["https://...", "https://..."]
  eleventyConfig.addFilter("pluck", (arr, key) => (arr || []).map((item) => item[key]));

  // {{ content | readingTime }} -> 4  (whole minutes, ~200 wpm, min 1)
  eleventyConfig.addFilter("readingTime", (html) => {
    const text = String(html || "").replace(/<[^>]+>/g, " ");
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
  });

  // Re-build the site whenever business.json changes, even with --serve running.
  eleventyConfig.addWatchTarget("src/_data/business.json");

  // Blog scaffold: drop markdown files in src/posts/ to add posts.
  eleventyConfig.addCollection("posts", (collectionApi) =>
    collectionApi.getFilteredByGlob("src/posts/*.md")
  );

  // Normalise typography: replace em-dashes (—) and en-dashes (–) with plain
  // hyphens (-) across all rendered HTML. Applies site-wide to every project.
  eleventyConfig.addTransform("dashesToHyphens", function (content) {
    if ((this.page.outputPath || "").endsWith(".html")) {
      return content.replace(/[—–]/g, "-");
    }
    return content;
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site",
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};
