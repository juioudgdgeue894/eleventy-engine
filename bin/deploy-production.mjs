#!/usr/bin/env node
/**
 * eleventy-engine-deploy-production  (a site's `npm run deploy:production`)
 *
 *   1. Gate: refuses unless the branch is main (CI branch variables, or the local
 *      git branch). FORCE_PRODUCTION_DEPLOY=1 only helps on a detached checkout.
 *      Cloudflare Workers Builds may treat a feature branch as "production"; this
 *      exits 0 there without deploying.
 *   2. Notes the live version id, so a failed check can print the rollback.
 *   3. `wrangler deploy --config wrangler.production.jsonc`. Wrangler first runs the
 *      config's build.command (`cf-build-gate && eleventy-engine-predeploy`): clean
 *      build plus output check. Nothing uploads if that fails.
 *   4. eleventy-engine-check-live against the live domain (retries ~3 minutes).
 *      Exit 1 with the rollback command if any page or asset is wrong.
 */
import { spawnSync, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG = "wrangler.production.jsonc";
const here = path.dirname(fileURLToPath(import.meta.url));

const ciBranch = process.env.WORKERS_CI_BRANCH || process.env.CF_PAGES_BRANCH || process.env.GITHUB_REF_NAME || "";
const forced = process.env.FORCE_PRODUCTION_DEPLOY === "1";
let localBranch = "";
let dirty = false;
try {
  localBranch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
  dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim() !== "";
} catch {}
const branch = ciBranch || localBranch;
const isMain = branch === "main" || process.env.GITHUB_REF === "refs/heads/main";

console.log(JSON.stringify({ gate: "deploy-production", branch: branch || null, forced, isMain, dirty }));

// main always; FORCE only when there is no branch at all (detached checkout of an
// older commit for a redeploy). A named non-main branch never ships to production.
if (!(isMain || (forced && !branch))) {
  console.log("Refusing production deploy: branch is not main. Preview builds use `npm run deploy` (wrangler.jsonc, no custom domains).");
  process.exit(0);
}
if (dirty) console.log("warning: uncommitted changes to tracked files will ship with this deploy.");

// 2. Current live version (best effort; needs the same Cloudflare auth as the deploy).
let previous = null;
try {
  const s = JSON.parse(
    execFileSync("npx", ["wrangler", "deployments", "status", "--config", CONFIG, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
  );
  previous = s.versions?.sort((a, b) => b.percentage - a.percentage)[0]?.version_id || null;
} catch {}
console.log(`[deploy-production] live version before deploy: ${previous || "unknown"}`);

// 3. Deploy (wrangler runs the build.command first).
const env = { ...process.env, FORCE_PRODUCTION_DEPLOY: "1" };
const d = spawnSync("npx", ["wrangler", "deploy", "--config", CONFIG], { stdio: "inherit", env });
if (d.status !== 0) {
  console.error("\n[deploy-production] wrangler deploy failed; nothing changed on the live site if the build step blocked it.");
  process.exit(d.status ?? 1);
}

// 4. Check the live site.
const args = [path.join(here, "check-live.mjs"), "--config", CONFIG];
if (previous) args.push("--rollback", previous);
const c = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(c.status ?? 1);
