# @jacklamond/eleventy-engine

The shared **engine** behind every client website — the brains that stay the same across sites.
Improve SEO/CSS/JS/components here once, publish a new version, and bump each site to it when ready.

## What's in here

| | |
|---|---|
| `eleventy.js` | Eleventy config as a plugin — shortcodes (`image`), filters, collections, passthrough, dir layout. A site's `.eleventy.js` is just `module.exports = require("@jacklamond/eleventy-engine/eleventy")`. |
| `tailwind-preset.js` | Shared Tailwind theme + Flowbite plugin. |
| `_includes/` | Layouts (`base`, `bare`, `post`) + all partials (the component library). |
| `pages/` | Framework pages every site gets: 404, blog, feed, sitemap, robots, components catalog, legal pages, locations, thanks. |
| `css/input.css` | Imports the site's `user.css`, then the Tailwind layers. |
| `CLAUDE.shared.md` | Shared conventions, imported by each site's `CLAUDE.md`. |
| `bin/sync.mjs` | `eleventy-engine-sync` — materialises the above into a consuming site. |

## How a site consumes it

A client site depends on this package and runs `eleventy-engine-sync` on `postinstall` / `prebuild`
(see the `eleventy-client-starter`). The sync copies layouts, partials, framework pages, the CSS
mechanism file and the shared Claude rules into the site's `src/` (and `.engine/`). Those copies are
**gitignored** in the site repo — so the site only ever commits its own content, and always rebuilds
against the engine version pinned in its `package.json`. The same sync runs in CI (Netlify), so
deploys are self-contained.

**Site-owned (the only things that change per client):** `business.json`, `towns.json`, `user.css`,
`index.njk` + custom pages, `images/`, `fonts/`, `posts/`.
**Engine-owned (synced, never edited in the site):** everything else.

## Releasing a new version

Make the change here, then run **one command**:

```sh
npm run release -- patch -m "fix collapsed menu bar"
# or: npm run release -- minor -m "new pricing component"
# or: npm run release -- 1.8.0 -m "..."
```

`release` (see `bin/release.mjs`) bumps `version`, commits the working tree, creates `vX.Y.Z` and
**pushes the tag** to origin (sites install from the tag tarball at
`…/archive/refs/tags/vX.Y.Z.tar.gz` — plain HTTPS, no SSH/auth; avoid the `github:owner/repo#tag`
shorthand, which resolves to git+ssh). It then bumps **every consuming site's** `package.json` to
the new tag and runs `npm install` (re-syncing them).

It does **not** commit/push the sites — review each, then commit + push (and confirm each site's
`origin` is its own repo, not the shared starter). Options:

- `--sites a,b` — only roll out to these sites (default: all)
- `--engine-only` — publish the tag, touch no sites
- `--dry-run` — print the plan, change nothing

Releases via **tags**, not the `main` branch (the branch can lag origin; only the tag matters).
For local iteration without releasing, use `npm run sync:all` instead (see *Local development*).

## Local development (fast loop)

To iterate on the engine and see it across **every** site immediately — no version
bump, no tag, no `npm install`:

```sh
# from the engine repo, after editing any shared file:
npm run sync:all
```

This pushes the **local** engine's shared files (`_includes/`, `pages/`, `css/input.css`,
`CLAUDE.shared.md`) straight into the `src/` of every sibling directory that depends on the
engine (auto-discovered). Synced files are gitignored in the sites, so this never dirties their
git trees — it's purely local preview. Limit to specific sites with
`npm run sync:all -- ivylounge.uk drprivatedining.co.uk`.

If a site's dev server (`npm run dev`) is already running, its watcher rebuilds on the spot.

**Caveat:** a site's own `predev`/`prebuild`/`postinstall` hooks run the sync from its
*installed* (pinned tarball) version. So if you **restart** a site's dev server, it re-syncs the
released version and overwrites the local preview — just re-run `npm run sync:all`, or keep the
dev server running while you iterate. `sync:all` is for preview; production still uses the
pinned tag (see *Releasing a new version*).

## Platform setup for a live site (launch:platform)

After a site is deployed (ship-site), one command wires up the platform layer:

```sh
npm run launch:platform -- newdomain.com     # or --all-sites
```

Idempotent per domain: Cloudflare Always Use HTTPS + www→apex redirect rule +
Web Analytics, Google Search Console (DNS-TXT verification, co-owner
delegation, property + sitemap), Bing Webmaster (add, CNAME verify, sitemap)
and an IndexNow ping. Credentials live in the gitignored `.env` —
`.env.example` documents each one and where to get it. Steps with missing
credentials skip cleanly; re-run any time. Provider quirks: Web Analytics
site creation has no API-token permission (needs the Global API Key vars);
its edge beacon auto-injection skips Worker-served HTML (so base.njk emits
the beacon from `business.seo.cf_beacon_token`); Bing's CNAME verification
can lag DNS by 30+ minutes — just re-run.

After content deploys (new pages, edited copy) ping IndexNow so Bing and the
IndexNow-connected AI engines recrawl in minutes:

```sh
node bin/indexnow-ping.mjs <domain>          # all sitemap URLs
node bin/indexnow-ping.mjs <domain> <url>…   # just the changed pages
```

Sites serve the required `/<key>.txt` when `business.seo.indexnow_key` is set
(same value as `INDEXNOW_KEY` in `.env`). Google ignores IndexNow — it
follows the submitted sitemap on its own cadence.

## Notes / gotchas

- **`content` lives in the site's `tailwind.config.js`, not this preset.** Tailwind resolves content
  globs relative to the active config and does not reliably inherit them from a preset, so each site
  declares `content: ["./src/**/*.{njk,html,md,js}", "./node_modules/flowbite/**/*.js"]`.
- **`setUseGitIgnore(false)`** is set in `eleventy.js` because the synced framework pages are
  gitignored in the site repo; without it Eleventy would skip them.
- Engine deps (`@11ty/eleventy`, `eleventy-img`, `flowbite`, `tailwindcss`, `concurrently`) are
  regular `dependencies`, so a site gets them transitively — its own `package.json` only needs this
  one package.
