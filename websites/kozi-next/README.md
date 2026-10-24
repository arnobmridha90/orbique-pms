# Kozi websites (next)

The Kozi rental sites, built with Astro as static pages:

- `src/sites/com` is the global site for www.staykozi.com: the Earth lit as it is right now, and a country chooser.
- `src/sites/my` is the Malaysia site for www.staykozi.my: cities, buildings, suites, guides, live prices and booking.
- `src/shared` holds what both use: components, data, scripts, styles and the photos.

The first version (`websites/kozi`) stays as it is.

## Build

Node 24.

    npm ci
    npm run build      # both sites, into dist/my and dist/com
    npm run dev:my     # or dev:com: a local server that reloads

Each site is its own Vercel project with Root Directory `websites/kozi-next`, build command
`npm run build:my` (or `build:com`) and output directory `dist/my` (or `dist/com`).

## Settings

Set these in Vercel, never in the repo. All are optional.

- `PUBLIC_KOZI_API`: Orbique's address, such as `https://orbique-pms.vercel.app`. Without it the site runs in
  test mode: a sample API gives made-up prices, and checkout makes a test booking with no payment.
- `PUBLIC_MY_URL`, `PUBLIC_COM_URL`: the two sites' addresses, for the links between them. They default to the
  www addresses; preview builds point them at the preview sites.
- `PUBLIC_NOINDEX=1`: keeps search engines out, for previews. Remove it at launch.

## Booking

Prices, member sign-in and payment come from Orbique's public booking API (`api/public.js`), for the
website slug `kozi`. Members, who join free with their email, see the plain price; everyone else sees it plus
the parity markup set in Orbique. While that markup is 0%, the member-saving lines hide themselves
(`html.no-deal`, see `deal()` in `src/shared/lib/api.ts`).

## Rules

- No walking times until they have been measured.
- The building photos are CC BY-SA 4.0: keep their credit (`CREDITS` in `src/shared/data/kozi.ts`, the photo
  viewer's caption and the /credits/ page).
- Email is the only contact shown until a phone and WhatsApp number are confirmed.

## Scripts

Run by hand, and commit what they make:

- `scripts/photos.sh` grades and resizes the unit photos into `src/assets/photos`.
- `scripts/fonts.py` makes the two trimmed Fraunces files in `src/assets/fonts`.
- `scripts/land-mask.mjs` makes the globe's land grid, `src/shared/data/land-mask.json`.
