# 11ty Client Site — Shared Conventions

Shared operating rules for every Eleventy client site built from the master template. This file
is the single source of truth for these conventions — it lives in
`~/Developer/Claude/11ty-components/` and each project pulls it in with an `@import` line in its
own `CLAUDE.md`. Edit it here once and every linked project gets the update.

---

## Dev server

Always run `npm run dev` and open `http://localhost:8080`. Never open `_site/*.html` directly via Finder or file:// — absolute paths like `/css/style.css` break under the file protocol.

```
npm run dev       # starts Tailwind watcher + Eleventy with live reload
npm run build     # one-shot production build
```

---

## Single sources of truth — edit these, nothing else

| What | File |
|---|---|
| All business/client data | `src/_data/business.json` |
| All design tokens (colours, fonts, spacing, radii) | `src/css/user.css` |

**Never hardcode client names, phone numbers, addresses, or any business content in templates.** Every piece of content must come from `{{ business.* }}` variables.

**Never hardcode hex colours or pixel values for radii/spacing in templates.** Always reference a CSS custom property: `var(--color-primary)`, `var(--radius-button)`, etc. In Tailwind utility classes use the arbitrary value syntax: `bg-[var(--color-primary)]`, `hover:bg-[var(--color-primary-dark)]`.

### Key `business.json` blocks

**`sections` object** — controls headings, eyebrows, intro text, and CTA labels for every major section. Update these instead of editing `.njk` files:
```json
"sections": {
  "hero": { "cta_primary_label": "...", "cta_primary_href": "...", "cta_secondary_label": "...", "cta_secondary_href": "..." },
  "services": { "eyebrow": "...", "heading": "...", "intro": "..." },
  "work": { "eyebrow": "...", "heading": "...", "intro": "..." },
  "about": { "eyebrow": "..." },
  "pricing": { "eyebrow": "...", "heading": "...", "intro": "..." },
  "contact": { "heading": "...", "intro": "..." }
}
```

**`newsletter` object** — controls the footer newsletter form and the standalone `newsletter-form.njk` partial. The `consent_text` may contain HTML (e.g. a link to the Privacy Policy):
```json
"newsletter": {
  "heading": "Stay in the loop",
  "intro": "One email a month. No spam, unsubscribe any time.",
  "consent_text": "By subscribing you agree to our <a href=\"/privacy-policy/\">Privacy Policy</a> ..."
}
```

**`legal` object** — full list of fields:
- `company_number`, `vat_number`, `ico_number`, `place_of_registration` — Companies Act / GDPR mandatory disclosures
- `registered_address_same` / `registered_address` — set `false` + fill address if different from trading address
- `accessibility_reviewed` — ISO date, used in Accessibility Statement (update annually)
- `privacy_updated` — ISO date, shown in Privacy Policy "Last updated" line
- `terms_updated` — ISO date, shown in Terms "Last updated" line

---

## Component library

> **Synced from the engine:** `src/components.njk`, `src/_includes/` and the framework pages are
> **synced from `@jacklamond/eleventy-engine`** on install/build (and are gitignored in the site repo).
> Do not edit these synced files in a client site — they're overwritten on the next sync. To change a
> component, edit it in the engine, publish a new version, then bump the engine version in the site's
> `package.json`. Only `business.json`, `user.css`, `index.njk` and assets are site-owned.

Browse all available components at `http://localhost:8080/components/`. Every component has a copyable ID (e.g. `hero-02`, `services-03`).

**When asked to build or update a page section, you must only use components from this library.** Do not invent new component layouts from scratch — pick the closest match from the library and use or adapt it. If nothing fits, add a new component to `src/components.njk` first, then use it.

Each live page section is an include in `src/index.njk`:

```njk
{% include "partials/hero.njk" %}
{% include "partials/services.njk" %}
```

To swap a section, replace the HTML in the relevant partial with the chosen component's markup. The partial filename stays the same; only its contents change.

---

## Variation workflow

When the user asks to "see options" or "show me variations" for a section:

1. Create numbered variant files: `src/_includes/partials/hero-v2.njk`, `hero-v3.njk`, etc.
2. Create a flat preview page (e.g. `src/hero-variations.njk`) that includes all variants with `permalink: hero-variations.html` and `eleventyExcludeFromCollections: true` in frontmatter.
3. Present the options at `http://localhost:8080/hero-variations.html`.
4. Once the user picks one, copy its contents into the canonical partial (`hero.njk`), then delete the variant files and preview page.

---

## File map

```
src/
  _data/
    business.json         ← ALL client data lives here
  _includes/
    layouts/
      base.njk            ← full site shell (head, SEO, schema, header, footer)
      bare.njk            ← minimal shell for internal tool pages (no nav/footer)
      post.njk            ← blog post layout, chains to base.njk
    partials/             ← synced from the engine package
      header.njk          ← sticky nav + utility bar (desktop + Flowbite mobile menu; styled by the shared mobile-menu component in input.css)
      hero.njk            ← page hero section (CTAs from business.sections.hero)
      services.njk        ← services grid (heading/intro from business.sections.services)
      work.njk            ← portfolio / case studies (heading/intro from business.sections.work)
      stats.njk           ← stat band
      pricing.njk         ← pricing cards (heading/intro from business.sections.pricing)
      about.njk           ← about section (eyebrow from business.sections.about)
      team.njk            ← team grid (self-guards: hidden if business.team is empty)
      testimonials.njk    ← carousel with ARIA labels on controls and star ratings
      faq.njk             ← accordion (self-guards: hidden if business.faq is empty)
      gallery.njk         ← image grid (self-guards: hidden if business.gallery is empty)
      booking-embed.njk   ← third-party booking widget (self-guards on business.booking.enabled)
      cta.njk             ← call-to-action banner
      contact-form.njk    ← contact form (Netlify Forms + honeypot, visible labels, GDPR notice)
      newsletter-form.njk ← standalone newsletter block (data from business.newsletter.*)
      footer.njk          ← site footer (newsletter, columns, contact, legal disclosure)
      announcement.njk    ← top bar (self-guards on business.announcement.enabled)
      mobile-cta.njk      ← fixed bottom bar, mobile only
      cookie-banner.njk   ← PECR cookie consent with focus trap (auto-included in base.njk)
      schema.njk          ← JSON-LD structured data (included in base.njk head)
      credit.njk          ← "Built by" credit line in footer
  css/
    user.css              ← design tokens + .prose blog styles
    input.css             ← @import user.css, @tailwind directives, then the shared mobile-menu component
  images/
    favicon.svg           ← replace with client's SVG favicon
    og-default.jpg        ← 1200×630 social share image (replace with real branded image)
    apple-touch-icon.png  ← 180×180 PNG for iOS home screen (replace with real logo)
  posts/                  ← markdown blog posts
  index.njk               ← homepage
  blog.njk                ← blog listing
  404.njk                 ← branded 404 page (served automatically by Netlify/Vercel)
  feed.njk                ← Atom RSS feed at /feed.xml
  components.njk          ← component library (synced from the engine; internal, noindex)
  sitemap.njk             ← sitemap.xml
  robots.njk              ← robots.txt
```

---

## Adding a new page

1. Create `src/page-name.njk` with `layout: layouts/base.njk` in frontmatter.
2. Set `title` and `description` in frontmatter (used for `<title>` and meta description).
3. Build the page body using includes from `_includes/partials/` or inline component markup.
4. Add the page to `business.json → nav` if it should appear in the navigation.

---

## Conditional sections

Several partials self-guard — they render nothing if the relevant data is empty or disabled:

- `team.njk` — hidden when `business.team` is empty
- `faq.njk` — hidden when `business.faq` is empty
- `gallery.njk` — hidden when `business.gallery` is empty
- `announcement.njk` — hidden when `business.announcement.enabled` is false
- `booking-embed.njk` — hidden when `business.booking.enabled` is false

You can safely include all of these in `index.njk` unconditionally; just leave the relevant data field empty or false in `business.json` to hide them.

---

## Image shortcode

All images in templates and blog posts should use the `{% image %}` shortcode instead of raw `<img>` tags. It automatically generates WebP and JPEG versions at three widths (480, 800, 1200 px), writes a correct `srcset`, and sets `loading="lazy"` and `decoding="async"`.

**Where to put source files:**
- **Photos used via `{% image %}` → `src/photos/`** (preferred). This folder is *not* passthrough-copied, so the full-res originals never ship to the build — only the optimised WebP/JPEG output does. This keeps deploys lean.
- **Raw-referenced assets → `src/images/`** (favicon, `og-default.jpg`, apple-touch-icon, any file you link by a literal `/images/...` URL or CSS `url()`). Everything in `src/images/` ships as-is.
- The shortcode resolves `src/photos/` first, then falls back to `src/images/` — so existing sites keep working, but new photos should go in `src/photos/`.

**Drop the source file into `src/photos/` (or `src/images/`), then:**

```njk
{# Basic usage — sizes defaults to "100vw" #}
{% image "photo.jpg", "Alt text describing the image" %}

{# With a sizes hint for responsive layouts #}
{% image "team-photo.jpg", "Jane Smith", "(min-width: 768px) 25vw, 50vw" %}

{# With a sizes hint and a CSS class on the <img> #}
{% image "hero.jpg", "City skyline", "100vw", "cd-rounded-img object-cover" %}

{# Above-the-fold images (hero, etc.) — pass "eager" to avoid LCP penalty #}
{% image "hero.jpg", "City skyline", "50vw", "h-full w-full object-cover", "eager" %}
```

**In Markdown blog posts**, the shortcode works inline but must be wrapped in `{% raw %}...{% endraw %}` inside *code examples only* (to prevent Nunjucks executing the example literally):

```
{% raw %}{% image "my-photo.jpg", "Description" %}{% endraw %}
```

**Passing an empty alt** (`""`) is valid for purely decorative images (screen readers skip them). Omitting alt entirely throws a build error — intentional.

**Generated output** is a `<picture>` element with `<source type="image/webp">` and an `<img>` fallback. The `<picture>` element is `display: block` (set in `user.css`) so Tailwind sizing utilities on the parent work as expected.

**team.njk** uses the shortcode automatically when `business.team[n].photo` is a non-empty filename. Leave it blank to show the gradient placeholder.

---

## CSS rules

- `user.css` is imported first in `input.css`, before `@tailwind` directives, so custom properties are always available to Tailwind.
- Corner radii are globally overridden in `user.css` — `.rounded-*` classes all resolve to `var(--radius-button)`. To exempt an element (e.g. a circular image), add the class `cd-rounded-img` instead, which uses `var(--radius-image)`.
- Never use `color-mix()` inside Tailwind arbitrary value brackets — it silently fails. Always define pre-computed shade variables in `user.css` (e.g. `--color-primary-light`) and reference those.
- Common layout helpers defined in `user.css`: `.cd-container`, `.cd-section`, `.cd-btn`, `.cd-btn-primary`, `.cd-btn-outline`, `.cd-btn-light`.

### Mobile menu (shared component, in `input.css`)

The Flowbite mobile menu is styled by a shared component at the bottom of `input.css` (synced — do not edit per-site). It gives every site:
- a **borderless hamburger that morphs into an ×** (drawn with pseudo-elements; the engine's `<svg>` glyph is hidden),
- a **full-width drop panel that animates** open/closed with **no flash** (driven by the panel's own `hidden` class + `max-height`/`opacity`, so it needs no `:has()` and never flips `display`),
- generous tap targets, hairline dividers, and a full-width CTA pill.

It is **fully themed from tokens** — override any of these in the site's `user.css` to restyle it:

| Token | Controls | Default |
|---|---|---|
| `--color-menu-surface` | panel background | `--color-bg` |
| `--color-menu-on` | link text colour | `--color-body-text` |
| `--color-menu-divider` | hairline between links | `--color-border` |

Link hover uses `--color-primary`; the hamburger bars use `currentColor` (the button's themed text colour). On the dark default theme it adapts automatically. A **light-themed** site that wants a dark menu just sets `--color-menu-surface`/`--color-menu-on`/`--color-menu-divider` to dark values (and, if its header is transparent over a hero, darkens the header bar itself when `[data-collapse-toggle][aria-expanded="true"]`).

---

## Pre-launch checklist

Assets:
- [ ] Replace `src/images/favicon.svg` with client's real favicon
- [ ] Add `src/images/favicon.ico` (raster, e.g. 32–64px) — Safari uses this; it won't render an SVG favicon that wraps a raster image. Emitted at root `/favicon.ico`.
- [ ] Replace `src/images/og-default.jpg` with a real branded 1200×630 social share image
- [ ] Replace `src/images/apple-touch-icon.png` with a real 180×180 PNG logo
- [ ] Swap all placeholder portfolio images in `business.json → portfolio`
- [ ] If blog posts have featured images, add them to `src/images/`

Business data:
- [ ] All `business.json → legal` fields filled (company number, place of registration, VAT if applicable, ICO if applicable)
- [ ] `legal.privacy_updated` set to today's date (shown in Privacy Policy)
- [ ] `legal.terms_updated` set to today's date (shown in Terms & Conditions)
- [ ] `legal.accessibility_reviewed` updated to today's date
- [ ] Update `business.newsletter.*` with client's actual newsletter heading and consent text
- [ ] Set `business.announcement.enabled: false` if no announcement is needed
- [ ] Set `business.booking.enabled: false` if no booking widget

Forms:
- [ ] Set `action` in `contact-form.njk` (Netlify Forms: no action needed; Formspree: use your endpoint URL)
- [ ] Test form submission end to end
- [ ] If using a third-party form processor, add their domain to CSP in `netlify.toml` / `vercel.json` and list them in the Privacy Policy data table

Compliance:
- [ ] Privacy Policy cookie table updated if analytics were added
- [ ] CSP in `netlify.toml` / `vercel.json` updated if third-party scripts were added
- [ ] Confirm `Strict-Transport-Security` header is in both `netlify.toml` and `vercel.json` (already set; verify after deployment)

Quality:
- [ ] Run Lighthouse in Chrome DevTools: aim for 90+ on Performance, Accessibility, Best Practices, SEO
- [ ] Check Core Web Vitals: LCP < 2.5 s, CLS < 0.1, INP < 200 ms
- [ ] Test keyboard-only navigation end to end
- [ ] Test with a screen reader (VoiceOver on Mac: Cmd+F5)
- [ ] Verify 404 page works at `/404` or by visiting a non-existent URL
- [ ] Check RSS feed renders at `/feed.xml`

---

## UK compliance — what's built in

Every site built from this template includes the following by default. Do not remove them.

### Cookie consent (PECR)
`src/_includes/partials/cookie-banner.njk` is included in `base.njk` automatically. It:
- Shows on first visit; stores choice in `localStorage` under key `cd-cookie-consent` (`'all'` or `'essential'`).
- Has equal-weight Accept / Essential-only buttons (ICO requirement — rejecting must be as easy as accepting).
- The "Cookie Settings" link in the footer re-opens the banner via `data-cd-cookie-settings` attribute — do not replace this with a plain href.
- Non-essential scripts (analytics, pixels) must check `localStorage.getItem('cd-cookie-consent') === 'all'` before loading. Do not load them unconditionally.

### Third-party scripts & Content Security Policy
A comment block in `base.njk` (just above the Flowbite script tag) shows the required pattern for conditional script loading. When adding analytics or marketing tools for a client:

1. Wrap the snippet: `if (localStorage.getItem('cd-cookie-consent') === 'all') { /* snippet */ }`
2. Update the cookie table in `src/privacy-policy.njk` to list the new cookies.
3. Add any new external domains to the `Content-Security-Policy` in both `netlify.toml` and `vercel.json`. Examples:
   - Google Analytics 4: add `https://www.googletagmanager.com https://www.google-analytics.com` to `script-src` and `connect-src`
   - Hotjar: add `https://static.hotjar.com https://script.hotjar.com` to `script-src`, and `https://*.hotjar.com` to `connect-src` and `frame-src`
   - Crisp chat: add `https://client.crisp.chat` to `script-src` and `connect-src`

### Legal pages
| Page | URL | Notes |
|---|---|---|
| Privacy Policy | `/privacy-policy/` | UK GDPR compliant; update the cookie table if analytics change |
| Terms & Conditions | `/terms/` | Service business template; client should have a solicitor review |
| Accessibility Statement | `/accessibility/` | Declares WCAG 2.2 AA intent; update Known Limitations honestly |

These pages are linked from the "Legal" column in the footer. Do not remove those links.

### `business.json → legal`
Fill in for every client:
- `company_number` — required by Companies Act 2006 for Ltd companies
- `vat_number` — required if VAT registered
- `ico_number` — required if the site collects personal data (contact forms, analytics)
- `place_of_registration` — "Scotland", "England and Wales", or "Northern Ireland" (Companies Trading Disclosures Regulations 2008)
- `registered_address_same` — set `false` and fill in `registered_address` if different from trading address

### Accessibility baseline (WCAG 2.2 AA)
The template targets WCAG 2.2 Level AA (Equality Act 2010 duty to make reasonable adjustments). Built-in:
- Skip-to-content link (`.cd-skip-link`) — do not remove
- `:focus-visible` keyboard ring in `user.css` — do not remove
- `<main id="main-content">` as the skip link target — do not remove
- `scroll-padding-top` on `html` prevents sticky header from obscuring focused elements (WCAG 2.4.11)
- `prefers-reduced-motion` media query suppresses all transitions/animations for users who need it
- `--color-on-*` token system ensures text-on-background contrast is always explicit; update both tokens together when changing a palette colour
- Cookie banner has `role="dialog"`, `aria-modal="true"`, focus trap, and returns focus to the trigger on close
- Carousel prev/next buttons have `aria-label`; star ratings use `role="img"` with an `aria-label`
- Mobile nav has `aria-label="Mobile navigation"`; hamburger button has `aria-label="Open navigation menu"`
- External links (`target="_blank"`) include `<span class="sr-only"> (opens in new tab)</span>`
- Contact form uses visible labels (not just `sr-only`) and `autocomplete` attributes
- When adding new interactive components, ensure they are keyboard-reachable, have visible focus styles, and meet ≥24×24 px touch target size (WCAG 2.5.8)

### Contact and newsletter forms

`contact-form.njk` ships with Netlify Forms as the default handler:
- `data-netlify="true"` — Netlify detects and processes submissions automatically
- `data-netlify-honeypot="bot-field"` — hidden field that catches bots
- `<input type="hidden" name="form-name" value="contact" />` — required for SSG builds

To switch handlers, read the comment block at the top of `contact-form.njk`. For any third-party processor, add their domain to `Content-Security-Policy` (connect-src) in `netlify.toml` / `vercel.json`, and list it in the Privacy Policy data table.

Newsletter forms (footer and `newsletter-form.njk`) include a **required consent checkbox** for UK PECR compliance. Heading, intro text, and checkbox label all come from `business.newsletter.*`.

### 404 page

`src/404.njk` generates `_site/404.html`. Netlify and Vercel both serve this file automatically for unmatched routes — no extra config required.

### RSS / Atom feed

`src/feed.njk` generates `/feed.xml` — an Atom feed of all blog posts. The feed link is auto-included in `<head>` via `base.njk`. Browsers and feed readers discover it automatically.

### Blog prose typography

Post bodies render inside `class="prose"` in `post.njk`. Prose styles are hand-rolled in `user.css` (`.prose { ... }`) using design tokens, so they pick up the client's colours and radii automatically. No `@tailwindcss/typography` dependency required.

### Security headers
`netlify.toml` and `vercel.json` at the project root set security headers for every response:
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` — enforces HTTPS; note that HSTS only works over HTTPS, so it's a no-op until the domain is live with SSL
- `X-Frame-Options: SAMEORIGIN` — prevents clickjacking
- `X-Content-Type-Options: nosniff` — prevents MIME-sniffing
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — camera, mic, geolocation, payment all off by default
- `Content-Security-Policy` — restricts script/style/image sources; update if you add third-party scripts (analytics, chat widgets, etc.)

---

## Eleventy notes

- Collections: `posts` is auto-built from `src/posts/*.md`.
- All pages in `collections.all` are included in `sitemap.xml` unless they have `eleventyExcludeFromCollections: true` in frontmatter.
- Internal tool pages (component library, variation previews) should use `layout: layouts/bare.njk`, `eleventyExcludeFromCollections: true`, and `noindex: true`.
- Custom filters available in templates: `currentYear`, `readableDate`, `isoDate`, `pluck`.
- Flowbite JS is copied from `node_modules` at build time — no CDN dependency at runtime.
- Node version is pinned to ≥22 in `package.json → engines` and `.nvmrc`. Run `nvm use` before installing dependencies on a new machine.
- RSS/Atom feed is at `/feed.xml` — the `<link rel="alternate">` in `base.njk` allows browsers and readers to auto-discover it.
