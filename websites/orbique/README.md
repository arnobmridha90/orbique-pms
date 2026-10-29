# Orbique PMS website

The marketing site for Orbique PMS, served at https://www.orbiquepms.com (orbiquepms.com redirects to www).
Plain HTML, CSS and JavaScript: no framework, no build step, no outside scripts, fonts or CDNs. The whole site is about 1.3 MB.

It is its own Vercel project with **Root Directory** `websites/orbique`. `vercel.json` sets clean URLs (`/privacy`),
the security headers (the Content Security Policy allows only this site's own files) and a one-year cache for `/assets`.

## Files

| File | What it is |
|---|---|
| `index.html` | The one long page: hero, exploded view, counters, one section per feature, closing call to action |
| `privacy.html`, `404.html` | Privacy note (links to the app's policy) and the not-found page |
| `assets/css/site.css` | All styles. Brand colours are the variables at the top |
| `assets/js/boot.js` | Tiny, runs first: adds the `js` class that turns animation on, and takes it off again if `site.js` never starts |
| `assets/js/site.js` | Scroll reveals, counters, the pinned exploded view and the hotspots (about 9 KB, no libraries) |
| `assets/img/` | WebP captures of the app's demo build, the exploded-view layers and `og.jpg` (1200 x 630 share image) |
| `assets/fonts/` | Manrope and Inter (SIL Open Font License), self-hosted |
| `robots.txt`, `sitemap.xml`, `favicon.*`, `apple-touch-icon.png` | SEO and icons (the icon is the app's `public/icons`) |

## Editing

- **Text:** edit `index.html`. Keep it short and plain. Every claim must be true of the code: each section has an HTML
  comment naming the files it comes from. Check them again before changing a claim.
- **Counters:** `<span class="ct" data-to="26">26</span>`. Put the real number in both places; the comment above the
  counters lists where each number comes from (for example 26 = the `LANGS` list in `app/pages/inbox.js`).
- **Hotspots:** each `<li data-x="31.2" data-y="17.6">` inside an `.hs-list` becomes a pulsing dot at that position
  (percent of the picture) with that card. Without JavaScript the same items show as a list under the picture.
- **Exploded view:** the layers are the `.xl` elements in `.xv-stack`; how far each one lifts and slides is `MOVE` in
  `site.js`; the callouts are the `.xv-callouts` list, numbered to match.
- **Pictures:** files under `/assets` are cached for a year, so when you change one, give it a new name (or bump the
  `?v=` on the CSS and JS links). Always set `width` and `height` on images, and keep `loading="lazy"` below the fold.
- **No inline styles or scripts:** the Content Security Policy blocks `style="..."` and `<script>` blocks in the HTML
  (the JSON-LD block is data and is fine). CI checks this.

## Screens

All screens are the app's own local demo build (`node scripts/build.mjs --local`) with its fictional demo data, captured
with Playwright at 2x on Tue 6 Oct 2026, 10:15 AM (the demo's story day). Before capture: demo-only notices and toasts
hidden, "Platform owner" shown as "Demo workspace", phone numbers and emails masked, and (as in the launch video) the
two demo Vrbo bookings re-badged Expedia and one direct booking re-badged Trip.com so the calendar shows the five sites.

## Motion

- Content is visible by default. `html.js` hides elements only so they can animate in.
- Everything animates `transform` and `opacity` only. `prefers-reduced-motion` shows every final state with no movement.
- CSS scroll-driven animations (the top progress bar, picture drift) run only where the browser supports them.

## Checks

CI ("Marketing website" step in `.github/workflows/ci.yml`) checks that the pages exist, `vercel.json` and the JSON-LD
parse, every local file the pages point to exists, there are no inline styles or scripts, and the JS parses.
