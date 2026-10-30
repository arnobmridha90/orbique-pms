# Orbique PMS website

The marketing site for Orbique PMS, served at https://www.orbiquepms.com (orbiquepms.com redirects to www).
Plain HTML, CSS and JavaScript: no framework, no build step, no outside scripts, fonts or CDNs. The motion uses GSAP and Lenis,
copied into `assets/vendor/` and served from this site (see Libraries). The whole site is about 1.3 MB.

It is its own Vercel project with **Root Directory** `websites/orbique`. `vercel.json` sets clean URLs (`/privacy`),
the security headers (the Content Security Policy allows only this site's own files) and a one-year cache for `/assets`.

## Files

| File | What it is |
|---|---|
| `index.html` | The one long page: hero, exploded view, counters, one section per feature, closing call to action |
| `privacy.html`, `404.html` | Privacy note (links to the app's policy) and the not-found page |
| `assets/css/site.css` | All styles. Brand colours are the variables at the top |
| `assets/js/boot.js` | Tiny, runs first: adds the `js` class that turns animation on, and takes it off again if `site.js` never starts |
| `assets/js/site.js` | Scroll reveals, counters, the pinned exploded view and the hotspots, built on GSAP (about 23 KB) |
| `assets/vendor/` | GSAP and Lenis, unchanged minified files from npm with their licenses (see Libraries) |
| `assets/img/` | WebP captures of the app's demo build, the exploded-view layers and `og.jpg` (1200 x 630 share image) |
| `assets/fonts/` | Manrope and Inter (SIL Open Font License), self-hosted |
| `robots.txt`, `sitemap.xml`, `favicon.*`, `favicon-32.png`, `apple-touch-icon.png` | SEO and icons (the icon is the app's `public/icons`; the two PNGs are `icon-512.png` resized to 32 and 180 px, and `.gitignore` lets this folder's PNGs in) |

## Editing

- **Text:** edit `index.html`. Keep it short and plain. Every claim must be true of the code: each section has an HTML
  comment naming the files it comes from. Check them again before changing a claim.
- **Counters:** `<span class="ct" data-to="26">26</span>`. Put the real number in both places; the comment above the
  counters lists where each number comes from (for example 26 = the `LANGS` list in `app/pages/inbox.js`).
- **Hotspots:** each `<li data-x="31.2" data-y="17.6">` inside an `.hs-list` becomes a pulsing dot at that position
  (percent of the picture) with that card. Without JavaScript the same items show as a list under the picture.
- **Exploded view:** the layers are the `.xl` elements in `.xv-stack`; how far each one lifts and slides is `MOVE` in
  `site.js`; the callouts are the `.xv-callouts` list, numbered to match. The leader lines are drawn by `site.js`.
- **Pictures:** files under `/assets` are cached for a year, so when you change one, give it a new name (or bump the
  `?v=` on the CSS and JS links). Always set `width` and `height` on images, and keep `loading="lazy"` below the fold.
- **No inline styles or scripts:** the Content Security Policy blocks `style="..."` and `<script>` blocks in the HTML
  (the JSON-LD block is data and is fine). CI checks this.

## Screens

All screens are the app's own local demo build (`node scripts/build.mjs --local`) with its fictional demo data, captured
with Playwright at 2x on Tue 6 Oct 2026, 10:15 AM (the demo's story day). Before capture: demo-only notices and toasts
hidden, "Platform owner" shown as "Demo workspace", phone numbers and emails masked, and (as in the launch video) the
two demo Vrbo bookings re-badged Expedia and one direct booking re-badged Trip.com so the calendar shows the five sites.

## Libraries

All free, self-hosted (the Content Security Policy allows only this site's files), loaded with `defer` after the page has
rendered, so the hero never waits for them. About 58 KB gzipped together, plus about 8 KB for `site.js`.

| Library | Version | Files in `assets/vendor/` | Licence | Used for |
|---|---|---|---|---|
| [GSAP](https://gsap.com) | 3.15.0 | `gsap/gsap.min.js` | GSAP Standard "no charge" licence (`gsap/LICENSE.txt`) | All the tweens and timelines |
| ScrollTrigger (GSAP) | 3.15.0 | `gsap/ScrollTrigger.min.js` | same | Scrub, batch reveals, play and rewind on scroll |
| SplitText (GSAP) | 3.15.0 | `gsap/SplitText.min.js` | same | Section headings rise line by line out of a mask |
| DrawSVGPlugin (GSAP) | 3.15.0 | `gsap/DrawSVGPlugin.min.js` | same | The exploded view's leader lines draw out to the callouts |
| [Lenis](https://lenis.darkroom.engineering) | 1.3.27 | `lenis/lenis.min.js` | MIT (`lenis/LICENSE`) | Smooth wheel scrolling, desktop mouse and trackpad only |

The files are copied unchanged from `npm pack gsap@3.15.0` and `npm pack lenis@1.3.27` (`dist/*.min.js`). To upgrade, copy
the new files over and bump the `?v=` on their `<script>` tags in `index.html` (assets are cached for a year).
The Lenis CSS it needs is the short block in `site.css`.

## Motion

- Content is visible by default. `html.js` hides elements only so they can animate in. If GSAP does not load, `site.js`
  takes the `js` class off and the page shows as it does without JavaScript (the same happens if nothing starts within 4 s).
- The hero's entrance is pure CSS and paints on the first frame. As you scroll away the copy drifts up and the screen eases closer.
- Section headings rise line by line (SplitText, each split only when it comes near the screen); other blocks rise in small staggered batches (ScrollTrigger.batch).
  Scroll back up past them and they rewind, so they play again on the way down.
- Exploded view: scrubbed by the scroll and held in place by a CSS sticky pin at every width (no GSAP pin, so there is no
  layout shift, a phone's address bar does not make it jump, and a reload mid-section comes back to the same place).
  The layers lift apart one after another, the numbers and outlines appear and each callout brightens with its layer.
  On wide screens each leader line then draws out to its callout as its layer settles and lights it fully. Scrolling
  back runs it in reverse.
- Counters count up fast from 0 when they come into view, and again after you scroll back above them.
- The calendar bars, booking alerts and price waterfall play when they come into view and rewind when you scroll back
  above them. The two phone screens rise at different speeds, tied to the scroll.
- Hotspot dots pop onto the screen one by one the first time it comes into view (at once if you reach one with the keyboard).
- Everything animates `transform` and `opacity` only. `prefers-reduced-motion` shows every final state with no movement
  and no smooth scrolling.
- CSS scroll-driven animations (the top progress bar, picture drift) run where the browser supports them; elsewhere GSAP does the same.

## Checks

CI ("Marketing website" step in `.github/workflows/ci.yml`) checks that the pages exist, `vercel.json` and the JSON-LD
parse, every local file the pages point to exists (including the vendor files), there are no inline styles or scripts,
the JS in `assets/js` and `assets/vendor` parses, and each folder in `assets/vendor` has its licence file.
