#!/usr/bin/env node
/**
 * sync-all — DEV-loop helper (not shipped to sites).
 *
 * Pushes THIS local engine's shared files into every sibling site that depends
 * on @jacklamond/eleventy-engine, WITHOUT publishing a release. The workflow:
 *
 *     edit the engine  →  `npm run sync:all`  →  every site's src/ updates
 *
 * Each site's dev server (`npm run dev`) then rebuilds automatically. No version
 * bump, no git tag, no npm install — instant local iteration.
 *
 * Sites are auto-discovered: any directory next to the engine whose package.json
 * depends on the engine. Synced files are gitignored in the sites, so this never
 * dirties their git trees — it's purely for local preview.
 *
 * NOTE: this copies the *local* (possibly unreleased) engine. For production,
 * the sites still install the pinned tag tarball, so a real release is still:
 * bump version → commit → `git tag vX.Y.Z` → `git push origin vX.Y.Z` → bump the
 * sites' package.json URLs.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siblingsRoot = path.resolve(engineRoot, "..");
const syncBin = path.join(engineRoot, "bin", "sync.mjs");
const pkgName = "@jacklamond/eleventy-engine";

const only = process.argv.slice(2); // optional: limit to named dirs, e.g. `sync:all ivylounge.uk`

let synced = 0;
for (const entry of fs.readdirSync(siblingsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(siblingsRoot, entry.name);
  if (dir === engineRoot) continue;
  if (only.length && !only.includes(entry.name)) continue;

  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) continue;

  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); } catch { continue; }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps[pkgName]) continue;

  process.stdout.write(`→ ${entry.name}\n`);
  execFileSync(process.execPath, [syncBin], { cwd: dir, stdio: "inherit" });
  synced++;
}

console.log(`\n[sync:all] pushed local engine (${JSON.parse(fs.readFileSync(path.join(engineRoot, "package.json"), "utf8")).version}) into ${synced} site(s).`);
if (!synced) console.log("[sync:all] no consuming sites found next to the engine.");
