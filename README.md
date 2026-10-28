# Orbique

Orbique is a property management platform for short-term rental operators in Malaysia. Orbique owns the platform and
sells it by subscription; each operator (a company that manages rental units) gets its own private **workspace** with
its units, bookings, calendar, guest inbox, cleaning tasks, inventory, invoices, expenses, reports, staff and branding.

One code base, three ways to use it:

- **Desktop**: the full app in a browser.
- **Phone**: the same app with a phone layout and a bottom tab bar, installable from the browser (it works like an app).
- **Guest app**: one private link per booking (`/guest/<token>`) with check-in details, door code, Wi-Fi and requests.
  Guests never sign in.

Orbique staff have a **platform admin** area to add operators, set their plan and pause them. It shows counts only,
never an operator's guests or money.

Connections to Airbnb, Booking.com, Agoda, WhatsApp, payment gateways and smart locks need partner approval and are
simulated for now: the app records what it would send.

## How it is built

| Part | What it is |
|---|---|
| `app/` | The web app (plain JavaScript, no framework). `scripts/build.mjs` assembles it into one page. |
| `app/server/*.js` | Production only: sign-in, workspaces, the Supabase adapter, platform admin, install support (`pwa.js`). |
| `api/` | Two Vercel serverless functions: `GET /api/health` and `POST /api/account` (see `docs/API.md`). Files under `api/_lib/` are shared helpers; Vercel does not turn files or folders whose names start with `_` into endpoints. |
| `supabase/migrations/` | The database schema, applied in name order by `scripts/migrate.mjs`. |
| `public/` | Web app manifest, icons and the service worker (copied into `dist/`). |
| `vercel.json` | Build command, output folder, rewrites (`/guest/<token>` and other paths serve the app) and cache headers. |

In production the browser talks to **Supabase** (Postgres, Auth, Realtime) with the public key; row level security
decides what each person may read and write. The secret (service-role) key is used only by `api/*.js` on Vercel.
See `docs/SPEC-v4.md` section 4 for the data model.

## Local development

Needs Node.js 20 or newer. Install once:

```bash
npm install
```

**Quick test copy (no server, data stays in the browser):**

```bash
node scripts/build.mjs --local --out /tmp/orbique.html     # open the file in a browser
```

**With a database and the API (like production):** start a Supabase stack (for example `supabase start` with the
Supabase CLI, or a hosted test project), put its values in `.env.local` (never commit this file):

```bash
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<anon or publishable key>
SUPABASE_SERVICE_ROLE_KEY=<service-role or secret key>
POSTGRES_URL_NON_POOLING=postgresql://postgres:postgres@127.0.0.1:54322/postgres
PLATFORM_OWNER_EMAILS=you@example.com
```

then:

```bash
node --env-file=.env.local scripts/migrate.mjs     # apply supabase/migrations/*.sql
node scripts/dev.mjs                               # build dist/ and serve it on http://127.0.0.1:8787
```

`scripts/dev.mjs` reads `.env.local` itself, builds the production page, serves `dist/` with the rewrites and headers from
`vercel.json`, and runs `api/<name>.js` for `/api/<name>` the way Vercel does. Options: `--port 8787`,
`--dist /tmp/me/dist` (build into another folder), `--no-build`. Restart it after changing `api/_lib/*.js`.

Screenshot tests: `tests/shot.py` (see its docstring). Channel manager tests: `node --test tests/channex/*.test.mjs`
(they start their own Channex stand-in, `scripts/channex-mock.mjs`; no key or network needed). CI
(`.github/workflows/ci.yml`) checks the syntax of every JavaScript file, runs the channel manager tests and both builds
on every push and pull request.

## Phone app

The same app also ships as an Android and iPhone app built with Capacitor (`capacitor.config.json`, `android/`,
`ios/`, `app/native/bridge.js`). It connects to the live site and its database; guests keep using the web link.
`npm run mobile:sync` (Node.js 22 or newer) builds the app's files into `mobile/www` and copies them into both native
projects. The **Phone app** workflow (`.github/workflows/mobile.yml`) builds both on every change, and the newest
Android test build is always at
https://github.com/arnobmridha90/orbique-pms/releases/download/android-test/Orbique-test.apk.

Installing, connecting the app to the live site, TestFlight, Google Play and the developer notes:
**[docs/MOBILE.md](docs/MOBILE.md)**.

## Deploy

Orbique runs on **Vercel** with a **Supabase** database added from the Vercel Marketplace. The step-by-step guide for
the owner is **[docs/DEPLOY.md](docs/DEPLOY.md)**. In short: import the repository into Vercel, add Supabase (region
Singapore) from the project's Storage tab, redeploy, open the site and choose "Set up Orbique".

Each deploy runs `npm run build`, which first applies new database migrations (`scripts/migrate.mjs`) and then builds
`dist/`. If a migration fails, the deploy stops and the previous version stays online. Preview deployments skip
migrations unless `ORBIQUE_MIGRATE_PREVIEW=1`, because they normally share the production database.

### Migrations

- Files in `supabase/migrations/` run once each, in name order, each in its own transaction. Applied files are recorded in
  `public._migrations` (name, time, checksum).
- Never edit a file that production already ran: the script warns and does not run it again. Add a new file instead.
  `node scripts/migrate.mjs --reapply <file>` runs one file again on purpose (only for files written to be re-runnable);
  `--status` lists applied and pending files.
- A file that must run outside a transaction starts with the line `-- migrate:no-transaction`.

## Environment variables

Set in Vercel (Project → Settings → Environment Variables). The Supabase integration adds most of them for you.

| Variable | Needed by | Notes |
|---|---|---|
| `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL` | build, API | The Supabase project URL. |
| `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | build | The public key. It is written into `dist/config.js` for the browser. |
| `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` | API | Secret. Used only by `api/*.js`; never in the browser, `dist/` or logs. |
| `POSTGRES_URL_NON_POOLING`, else `POSTGRES_URL`, else `DATABASE_URL` | build (migrations) | Without one, the build skips migrations with a note. |
| `PLATFORM_OWNER_EMAILS` | API (optional) | Comma-separated emails (or their SHA-256) allowed to run "Set up Orbique", in addition to `config/platform-owners.json`. |
| `APP_URL` | build (optional) | Base address for guest links. Defaults to the production domain Vercel reports. |
| `ORBIQUE_MIGRATE_PREVIEW` | build (optional) | `1` runs migrations on preview deployments too. |
| `SITE_REVALIDATE_TOKEN` | API (optional) | Secret. The website's page-refresh token (the same value the website has as its own `SITE_REVALIDATE_TOKEN`). With it, Publish on the Live website page refreshes the site's pages at once; without it the site updates within 5 minutes. |

## First sign-in

1. Open the site. While Orbique has no platform admin, the first screen offers **Set up Orbique**.
2. Enter a platform owner's email (its SHA-256 must be in `config/platform-owners.json`, or the email in
   `PLATFORM_OWNER_EMAILS`), your name and a password. That creates the first platform admin; the setup screen then
   disappears for good.
3. In the platform admin area, add the first operator (company, owner name, owner email, plan). Orbique shows a
   temporary password (for example `Mango-River-4821`); share it with the owner, who must choose a new one at first sign-in.
4. The owner invites staff from **Staff Access**; each invite also returns a temporary password to share.

To allow another platform owner email in the file, add the hash of the lower-cased email:
`node -e "console.log(require('crypto').createHash('sha256').update('owner@example.com').digest('hex'))"`.

## Security notes

- **Keys**: the service-role / secret key lives only in Vercel's environment variables and is used only by `api/*.js`.
  The browser gets the project URL and the public key (`dist/config.js`); row level security protects every table.
  CI fails if a service-role key ever appears in the build output.
- **Accounts are created by the API** (already confirmed, with a temporary password), so turn off public sign-ups in
  Supabase Auth (see `docs/DEPLOY.md`). The admin API still works with sign-ups off.
- **Who can do what** is checked on the server against the database: `create-operator` needs a row in
  `platform_admins`; `invite` and `reset-password` need an active `owner` membership of that workspace (platform admins
  may reset only workspace owners). Nobody can be invited as an owner.
- **Set up Orbique** works only while there is no platform admin and only for allow-listed emails. Do it right after the
  first deploy.
- **Temporary passwords** are two words and four digits from crypto randomness (about 29 bits) and are meant to be
  used once; the app asks for a new password at first sign-in (`must_change_password`). This is enforced by the app,
  not by the database.
- **Resetting a password** does not sign the person out of devices that are already signed in. To cut someone off
  immediately, suspend them in Staff Access (the database refuses suspended members).
- **Requests to subscribe** (`signup`) are limited to one per email per 10 minutes and 30 per hour overall.
- **Migrations** connect with TLS but without verifying Supabase's certificate (`rejectUnauthorized: false`), which
  Supabase's pooler requires with current `pg` versions. `public._migrations` is not readable through the public API.
- **Guest links** are long random tokens; anyone with the link sees that booking's guest app, so share it only with the guest.
  The site sends `Referrer-Policy: strict-origin-when-cross-origin` so the link does not leak to other sites.
- No error response contains keys, stack traces or database messages; details go to the Vercel function logs.
