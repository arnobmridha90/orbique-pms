# Kozi websites (next)

The Kozi rental sites, built with Astro:

- `src/sites/com` is the global site for www.staykozi.com: the Earth lit as it is right now, and a country chooser.
  It is all static pages.
- `src/sites/my` is the Malaysia site for www.staykozi.my: cities, buildings, suites, guides, live prices and booking.
  Its buildings, suites and photos come from Orbique (see Content below).
- `src/shared` holds what both use: components, data, scripts, styles and the photos.

The first version (`websites/kozi`) stays as it is.

## Build

Node 24.

    npm ci
    npm run build      # both sites
    npm run dev:my     # or dev:com: a local server that reloads
    npm run photos     # only the photo sizes (build and dev run it first)

Each site is its own Vercel project with Root Directory `websites/kozi-next`:

- my: build command `npm run build:my`. It uses the Vercel adapter, which writes `.vercel/output`, so leave the
  output directory empty. The content pages run as one function.
- com: build command `npm run build:com`, output directory `dist/com`. It stays static.

## Content (staykozi.my)

The buildings, suites, their photos and their order are kept in Orbique and published from its website panel.
`src/shared/lib/content.ts` reads them from `GET /api/public/site?ws=kozi`. It waits at most 3 seconds and checks
everything it gets. If Orbique is not set, slow or wrong, the site uses its own copy, `src/shared/data/content.json`,
so it never goes down.

- The pages that show content (home, cities, buildings, suites, stays, book, sitemap) are made on request and kept
  for 5 minutes (ISR). Orbique's Publish refreshes them at once with the bypass token.
- Guides, contact, credits and the 404 page are made at build time.
- City, building and suite pages come from the content: a new suite gets its page with no code change, and an
  unknown address gives the 404 page. A building outside Kuala Lumpur gets plain pages, with no skyline.
- A suite with `bookType` empty shows "Email us to book" in place of the booking card.
- Photos are of two kinds. Built-in photos are the ones in this repo: `npm run photos` makes their sizes in
  `public/photos/<key>-<width>.jpg` (not committed) and lists them in `src/shared/data/photos.json` (committed).
  Uploaded photos live in Orbique's Supabase Storage, under `PUBLIC_PHOTO_BASE`; any other address is ignored.
- `/content.json` lists the bundled content and every built-in photo, for Orbique's panel to pick from.
- `/sitemap.xml` is made from the content. Suites with no photos of their own stay out of it.

## Settings

Set these in Vercel, never in the repo.

- `PUBLIC_KOZI_API`: Orbique's address, such as `https://orbique-pms.vercel.app`. Without it the site runs in
  test mode: the bundled content, a sample API with made-up prices, and a test booking with no payment.
- `ISR_BYPASS_TOKEN` (my only): a random string of at least 32 characters. Orbique sends it to refresh a page
  after Publish. Use the same value in Orbique.
- `PUBLIC_PHOTO_BASE` (optional): where uploaded photos live. It defaults to the `site-photos` bucket.
- `PUBLIC_MY_URL`, `PUBLIC_COM_URL`: the two sites' addresses, for the links between them. They default to the
  www addresses; preview builds point them at the preview sites.
- `PUBLIC_NOINDEX=1`: keeps search engines out, for previews. Remove it at launch.

## Booking

Prices and payment come from Orbique's public booking API (`api/public.js`), for the website slug `kozi`.
Everyone sees the same price. If online payment is off, checkout says so kindly and asks guests to email
hello@staykozi.com.

After Stripe, the thank-you page (`/booking/confirmed/`) asks Orbique about the payment session
(`GET booking?session_id`) until the stay shows as paid, then shows what was paid and the cancellation terms.

## Rules

- No walking times until they have been measured.
- The building photos are CC BY-SA 4.0: keep their credit (`CREDITS` in `src/shared/data/kozi.ts`, the photo
  viewer's caption and the /credits/ page).
- Email is the only contact shown until a phone and WhatsApp number are confirmed.
- No self check-in or door codes: we email guests how to check in.

## Scripts

- `scripts/site-photos.mjs` (`npm run photos`) makes the photo sizes. Build and dev run it for you.

Run by hand, and commit what they make:

- `scripts/photos.sh` grades and resizes the unit photos into `src/assets/photos`.
- `scripts/fonts.py` makes the two trimmed Fraunces files in `src/assets/fonts`.
- `scripts/land-mask.mjs` makes the globe's land grid, `src/shared/data/land-mask.json`.
