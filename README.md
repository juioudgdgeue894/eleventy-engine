eleventy-engine

The shared **engine** behind every client website — the brains that stay the same across sites.
Improve SEO/CSS/JS/components here once, publish a new version, and bump each site to it when ready.

## What's in here

| | |
|---|---|
| `eleventy.js` | Eleventy config as a plugin — shortcodes (`image`), filters, collections, passthrough, dir layout. A site's `.eleventy.js` is just `module.exports = require("@thatkind/eleventy-engine/eleventy")`. |
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

1. Make the change here (e.g. improve `partials/schema.njk` or add a component to `pages/components.njk`).
2. Bump `version` in `package.json` (semver).
3. Publish: `npm publish` (if using a registry) **or** `git tag v1.2.0 && git push --tags` (if sites
   install via `github:thatkind/eleventy-engine#v1.2.0`).
4. In each site, bump the engine version in `package.json` and run `npm install` when you're ready to
   adopt it. Sites on the old version are untouched.

## Notes / gotchas

- **`content` lives in the site's `tailwind.config.js`, not this preset.** Tailwind resolves content
  globs relative to the active config and does not reliably inherit them from a preset, so each site
  declares `content: ["./src/**/*.{njk,html,md,js}", "./node_modules/flowbite/**/*.js"]`.
- **`setUseGitIgnore(false)`** is set in `eleventy.js` because the synced framework pages are
  gitignored in the site repo; without it Eleventy would skip them.
- Engine deps (`@11ty/eleventy`, `eleventy-img`, `flowbite`, `tailwindcss`, `concurrently`) are
  regular `dependencies`, so a site gets them transitively — its own `package.json` only needs this
  one package.
