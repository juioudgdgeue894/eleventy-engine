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

// 5. Shared Claude rules (imported by the site's CLAUDE.md)
mkdirp(path.join(site, ".engine"));
cp(path.join(engineRoot, "CLAUDE.shared.md"), path.join(site, ".engine", "CLAUDE.shared.md"));

const pkg = JSON.parse(fs.readFileSync(path.join(engineRoot, "package.json"), "utf8"));
console.log(`[eleventy-engine] synced ${pkg.name}@${pkg.version} (${copied} shared files) into ./src`);
