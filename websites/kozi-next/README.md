# Kozi websites (next)

The Kozi rental sites, built with Astro:

- `src/sites/com` is the global site for www.staykozi.com: the Earth lit as it is right now, and a country chooser.
  It is all static pages.
- `src/sites/my` is the Malaysia site for www.staykozi.my: cities, buildings, suites, guides, live prices and booking.
  Its buildings, suites and photos come from Orbique (see Content below). It has the Skyline design (see below).
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

## The Skyline design (staykozi.my)

A live 3D model of Kuala Lumpur at night fills the screen behind every page, and the pages float over it on dark
glass panels, in Big Shoulders Display and DM Sans (both self-hosted) with amber accents.

- `src/sites/my/components/Shell.astro` is the page frame. It uses Astro's ClientRouter, so the city
  (`transition:persist="city"`) is built once per visit and stays while pages change. Each page says where the
  camera goes (`cam`), whether the landmark labels show (`pins`), which of our floors glow (`hi`) and whether the
  city is dimmed behind it (`dim`).
- `src/sites/my/scripts/night.ts` sets up each page as it comes in; `city.ts` builds and drives the city (camera
  presets, labels, our floors, the sky); `home.ts` runs the home page's chapters, ring of photos and "A day at
  Kozi"; `finder.ts` is the view finder at /views/; `logo.ts` animates the logo.
- The city's code and data are in `public/city/v3/` (three.js r128 and the city modules, `city.bin`, `city.json`).
  They load after the page has painted and gone idle, so the first paint is the page's text or the still image.
  A new city build goes in a new folder (`v4`), because the files are cached for a year.
- `public/city/v3/still-wide.jpg` and `still-tall.jpg` are pictures of the same city. They show until the city is
  ready, and in its place when it can't run: no WebGL, reduced motion, Save-Data, or a small or weak device.
- The home page's view photos, the view finder's and the photos of "A day at Kozi" come from the content
  (`src/sites/my/lib/shots.ts`, `pages/index.astro`): a photo taken off every suite in Orbique's panel leaves them
  too. A moment of the day whose photo is gone is left out; check-in and check-out stay, with another photo.
- The 3D city is fetched on the first page that shows it, so a visit that only sees another city never loads it.
- The header's Suites link, the footer's building links and the city's label on our tower follow the content on
  pages made on request (`src/sites/my/lib/nav.ts`); pages made at build link to /stays/, which is always there.
- The city is built from map data whose licences ask for a credit: `MAP_CREDIT` in `src/shared/data/kozi.ts`,
  shown in the footer and on /credits/.

## Content (staykozi.my)

The buildings, suites, their photos and their order are kept in Orbique and published from its website panel.
`src/shared/lib/content.ts` reads them from `GET /api/public/site?ws=kozi`. It waits at most 3 seconds and checks
everything it gets. If Orbique is not set, slow or wrong, the site uses its own copy, `src/shared/data/content.json`,
so it never goes down.

- The pages that show content (home, cities, buildings, suites, stays, book, sitemap) are made on request and kept
  for 5 minutes (ISR). Orbique's Publish refreshes them at once with the bypass token.
- Guides, contact and credits are made at build time. The 404 page is made on request, so the server can show it
  in place for an address the content doesn't have (a page made at build can't be fetched by the function there).
- Structured data (JSON-LD) is written with `ldText` in `src/shared/lib/seo.ts`, which escapes `<`: text from the
  panel can't end the script early.
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

Prices come from Orbique's public booking API (`api/public.js`), for the website slug `kozi`. Everyone sees the
same price. On `/book/` the guest checks the stay, picks a rate and adds a name, and "Continue on WhatsApp" opens a
chat with Kozi's WhatsApp number with the whole stay written out. The team confirms the suite and how to pay; nothing
is held or charged on the site. The number is set in Orbique (Live Website, "Bookings go to WhatsApp") and comes with
`GET site` as `contact.whatsapp`, so it is never in this repo. Without a number the button opens an email to
hello@staykozi.com instead.

Card payment through Stripe (`checkout()` in `src/shared/lib/api.ts` and the thank-you page `/booking/confirmed/`)
is still in the code but no page uses it now.

## Rules

- No walking times until they have been measured.
- The building photos are CC BY-SA 4.0: keep their credit (`CREDITS` in `src/shared/data/kozi.ts`, the photo
  viewer's caption and the /credits/ page).
- Email is the only contact shown until a phone and WhatsApp number are confirmed.
- No self check-in or door codes: we email guests how to check in.
- Keep the map data credit (`MAP_CREDIT`) wherever the 3D city is shown.

## Scripts

- `scripts/site-photos.mjs` (`npm run photos`) makes the photo sizes. Build and dev run it for you.

Run by hand, and commit what they make:

- `scripts/photos.sh` grades and resizes the unit photos into `src/assets/photos`.
- `scripts/fonts.py` makes the two trimmed Fraunces files in `src/assets/fonts`.
- `scripts/land-mask.mjs` makes the globe's land grid, `src/shared/data/land-mask.json`.
