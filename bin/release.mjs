#!/usr/bin/env node
/**
 * release — publish a new engine version and roll it out to the sites.
 *
 * Run from the engine repo:
 *   npm run release -- <version|patch|minor|major> [options]
 *
 * Examples:
 *   npm run release -- patch -m "fix collapsed menu bar"
 *   npm run release -- 1.8.0 -m "new pricing component"
 *   npm run release -- minor --sites ivylounge.uk        # only roll out to one site
 *   npm run release -- patch --engine-only               # publish the tag, touch no sites
 *   npm run release -- patch --dry-run                   # print the plan, change nothing
 *
 * What it does:
 *   1. Bumps `version` in package.json (explicit semver, or patch/minor/major).
 *   2. Commits the engine working tree together with the bump.
 *   3. Creates tag vX.Y.Z and pushes THE TAG to origin — that's what sites install
 *      from (`archive/refs/tags/vX.Y.Z.tar.gz`). The branch is intentionally left
 *      alone; this repo releases via tags.
 *   4. For each consuming site: rewrites its engine tarball URL to the new tag and
 *      runs `npm install` (which re-syncs the shared files).
 *
 * It deliberately does NOT commit or push the sites — review each one, then commit
 * and push when you're happy (and check the site's `origin` is its own repo, not
 * the shared starter template).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siblingsRoot = path.resolve(engineRoot, "..");
const pkgPath = path.join(engineRoot, "package.json");
const pkgName = "@jacklamond/eleventy-engine";

// ---- arg parsing ------------------------------------------------------------
const argv = process.argv.slice(2);
const opts = { sites: null, engineOnly: false, dryRun: false, message: null };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-m" || a === "--message") opts.message = argv[++i];
  else if (a === "--sites") opts.sites = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
  else if (a === "--engine-only") opts.engineOnly = true;
  else if (a === "--dry-run") opts.dryRun = true;
  else positional.push(a);
}
const bumpArg = positional[0];
if (!bumpArg) {
  console.error("usage: npm run release -- <version|patch|minor|major> [-m msg] [--sites a,b] [--engine-only] [--dry-run]");
  process.exit(1);
}

// ---- compute the new version ------------------------------------------------
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const cur = pkg.version;
const [maj, min, pat] = cur.split(".").map(Number);
let next;
if (/^\d+\.\d+\.\d+$/.test(bumpArg)) next = bumpArg;
else if (bumpArg === "major") next = `${maj + 1}.0.0`;
else if (bumpArg === "minor") next = `${maj}.${min + 1}.0`;
else if (bumpArg === "patch") next = `${maj}.${min}.${pat + 1}`;
else { console.error(`✗ not a version or patch/minor/major: ${bumpArg}`); process.exit(1); }

const tag = `v${next}`;
const message = opts.message || tag;
const git = (...args) => execFileSync("git", args, { cwd: engineRoot, encoding: "utf8" }).trim();

// guard: tag must not already exist (--verify --quiet → silent non-zero if absent)
const tagExists = execFileSync("git", ["tag", "--list", tag], { cwd: engineRoot, encoding: "utf8" }).trim() !== "";
if (tagExists) { console.error(`✗ tag ${tag} already exists`); process.exit(1); }
if (next === cur) { console.error(`✗ ${next} is the current version`); process.exit(1); }

// ---- discover consuming sites ----------------------------------------------
const sites = [];
if (!opts.engineOnly) {
  for (const entry of fs.readdirSync(siblingsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(siblingsRoot, entry.name);
    if (dir === engineRoot) continue;
    if (opts.sites && !opts.sites.includes(entry.name)) continue;
    const sp = path.join(dir, "package.json");
    if (!fs.existsSync(sp)) continue;
    let spkg;
    try { spkg = JSON.parse(fs.readFileSync(sp, "utf8")); } catch { continue; }
    const field = spkg.dependencies?.[pkgName] ? "dependencies"
      : spkg.devDependencies?.[pkgName] ? "devDependencies" : null;
    if (!field) continue;
    sites.push({ name: entry.name, dir, sp, field });
  }
}

// ---- plan -------------------------------------------------------------------
console.log(`\nRelease ${cur} → ${next}  (tag ${tag})`);
console.log(`  engine: bump · commit "${message}" · tag · push tag to origin`);
console.log(opts.engineOnly ? "  sites:  (skipped — --engine-only)"
  : sites.length ? `  sites:  ${sites.map((s) => s.name).join(", ")}  (bump URL + npm install)`
  : "  sites:  (none found)");
if (opts.dryRun) { console.log("\n[dry-run] nothing changed."); process.exit(0); }

// ---- 1-3: publish the engine ------------------------------------------------
pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
git("add", "-A");
git("commit", "-m", message);
git("tag", "-a", tag, "-m", message);
console.log(`\n✓ committed + tagged ${tag}`);
execFileSync("git", ["push", "origin", tag], { cwd: engineRoot, stdio: "inherit" });
console.log(`✓ pushed ${tag} to origin`);

// ---- 4: roll out to sites ---------------------------------------------------
const urlRe = /(eleventy-engine\/archive\/refs\/tags\/)v\d+\.\d+\.\d+(\.tar\.gz)/;
const updated = [];
for (const s of sites) {
  const raw = fs.readFileSync(s.sp, "utf8");
  const before = JSON.parse(raw)[s.field][pkgName];
  if (!urlRe.test(before)) { console.log(`  ↷ ${s.name}: skipped (not a tag tarball URL: ${before})`); continue; }
  const spkg = JSON.parse(raw);
  spkg[s.field][pkgName] = before.replace(urlRe, `$1${tag}$2`);
  fs.writeFileSync(s.sp, JSON.stringify(spkg, null, 2) + "\n");
  console.log(`\n→ ${s.name}: ${tag} — installing…`);
  execFileSync("npm", ["install"], { cwd: s.dir, stdio: "inherit" });
  updated.push(s.name);
}

// ---- summary ----------------------------------------------------------------
console.log(`\n────────────────────────────────────────`);
console.log(`Released ${tag}.`);
if (updated.length) {
  console.log(`Bumped + installed: ${updated.join(", ")}`);
  console.log(`Next: review each, then commit & push its repo, e.g.`);
  console.log(`  git -C ../${updated[0]} add package.json package-lock.json && \\`);
  console.log(`  git -C ../${updated[0]} commit -m "Bump engine to ${tag}" && git -C ../${updated[0]} push`);
  console.log(`(check each site's 'origin' is its own repo before pushing.)`);
}
