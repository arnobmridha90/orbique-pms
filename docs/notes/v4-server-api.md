# v4 server-api: notes

Owner: server-api engineer. Files: `api/` (health.js, account.js, `_lib/http.js`, `_lib/supabase.js`, `_lib/passwords.js`,
`_lib/owners.js`), `scripts/dev.mjs`, `scripts/migrate.mjs`, `vercel.json`, `public/` (manifest, icons, sw.js),
`app/server/pwa.js`, `supabase/migrations/0002_api.sql`, `README.md`, `docs/DEPLOY.md`, `.github/workflows/ci.yml`.

## For the other engineers (local stack)

- **Platform admin** on the shared local Supabase: **admin@orbique.test**, password **Orbique-test-1**. Leave it in place.
  (Created with `bootstrap` and `PLATFORM_OWNER_EMAILS=admin@orbique.test`.)
- **Dev server**: `node scripts/dev.mjs --port 8787 [--dist /tmp/<you>/dist] [--no-build]`. Pass `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (and `PLATFORM_OWNER_EMAILS` for bootstrap tests) in the shell or in
  `.env.local`. It rebuilds dist on start; restart it after editing `api/_lib/*.js` or `vercel.json`
  (edits to `api/<name>.js` are picked up per request).
- **Migrations on the local DB** are recorded in `public._migrations`. My run of `node scripts/migrate.mjs` applied
  `0001_core.sql`, `0002_api.sql` and also `0004_app.sql` (it was already in the folder; it says it is safe to re-run).
  If you change 0003/0004 after they are recorded, migrate warns and skips them: apply your file by hand as before, or
  run `node scripts/migrate.mjs --reapply 0004_app.sql`. `0003_guest.sql` was not present when I ran it.

## What I built

### API (`docs/API.md` contract)
- `GET /api/health` → `{ok, db, needsBootstrap, commit}`. `db` = URL and service key set and a count of
  `platform_admins` succeeds within 8 s. 405 for other methods.
- `POST /api/account`: `bootstrap`, `signup`, `create-operator`, `invite`, `reset-password`, as specified.
  - Caller from `Authorization: Bearer <access token>` via `auth.getUser(token)`; roles checked against
    `platform_admins` and `members` (active owner). Owner check runs **before** the workspace lookup, so a non-owner
    learns nothing about other workspaces (403 either way).
  - Inputs trimmed, control characters removed, lengths capped (company 120, names 80, email 254, phone 40, message
    2000, ids 64, plan 24); emails lower-cased; JSON body up to 64 KB; Vercel's throwing `req.body` getter handled.
  - Errors are `{ok:false, error:<code>, message:<plain English>}` with 400/401/403/409/429/500 (+405 wrong method).
    Unexpected errors log only the message server-side and answer a generic 500. No keys, stack traces or database
    messages are ever returned.
  - Temporary passwords: `Word-Word-1234` from a 240-word list and `crypto.randomInt` (≈29 bits, ≥12 chars, has
    upper, lower, digits and a symbol).
  - `create-operator`: org → owner account (new: confirmed, temp password, `{name, must_change_password: true}`;
    existing: untouched, `existing: true`) → `members` owner row → `records` staff row
    `{id, name, initials, role:'owner', roleLabel:'Account owner', email}`. The owner staff id is `S-<base36 time+random>`
    (same shape as `O.uid('S')`, so it never collides with demo ids s1–s7). Any failure rolls back (org delete cascades; new user deleted).
  - `invite`: role must be one of ops/housekeeping/frontdesk/maintenance/accountant (`owner` → 400 `bad-role`); paused
    workspace → 403. 409s: `is-owner` (email is an owner here), `email-in-use` (email belongs to another staff id here),
    `has-account` (staff id already signs in with another email). Re-inviting the same person/staff id updates role and
    sets status active (`existing: true`). Staff record is created only when none exists (or it is soft-deleted); an
    existing record from the Staff page is kept as is. A user created for an invite that then fails is deleted.
  - `reset-password`: owner of the org for any member except themselves (400 `self`); platform admin only for members
    with role owner. Unknown staff id or no sign-in → 400 `no-account`. Merges `must_change_password: true` into metadata.
  - `bootstrap`: 409 `already-set-up` once any platform admin exists; 403 for emails not allow-listed; creates the user
    confirmed or, for an existing user, sets the password (this doubles as the documented recovery path: delete the
    `platform_admins` row and bootstrap again).
  - `signup`: stores `email` (new column) and, if a valid token is sent, `user_id`. Rate limits: same email within
    10 minutes → 429; ≥30 requests in the last hour overall → 429.
- `api/_lib/` is private: Vercel's builder detection (`maybeGetApiBuilder` in `@vercel/fs-detectors`) skips any path
  containing `/_`, so these files never become endpoints (checked in Vercel's source; a community thread claiming
  otherwise did not hold up). The dev server also refuses `/api/_lib/...`.
- `config/platform-owners.json` is read from `../../config` relative to the module, with a `process.cwd()` fallback;
  `vercel.json` adds `includeFiles: "config/**"` so it ships with the functions.

### `supabase/migrations/0002_api.sql`
- `subscription_requests.email` + indexes on `(created_at)` and `(email, created_at)`.
- `public.api_user_by_email(p_email) returns uuid`: security definer, `search_path = ''`, executable only by
  `service_role` (revoked from public/anon/authenticated; verified: anon and signed-in users get "permission denied").
  The API falls back to paging `auth.admin.listUsers` when the function is missing.

### `scripts/migrate.mjs`
- Applies `supabase/migrations/*.sql` in name order, each in a transaction with `pg_advisory_xact_lock` (two deploys at
  once: one waits, then sees the file is done), `statement_timeout` 10 min, and records `(name, applied_at, checksum)`
  in `public._migrations` (RLS on, no grants to anon/authenticated).
- URL: `POSTGRES_URL_NON_POOLING` → `POSTGRES_URL` → `DATABASE_URL`. Strips `sslmode`/`ssl`/`sslrootcert`/`sslcert`/
  `sslkey`/`sslcrl`/`uselibpqcompat` and uses `ssl: {rejectUnauthorized: false}` for non-local hosts (verified that with
  `sslmode` left in, pg overrides our ssl option with verify-full).
- No URL → note, exit 0. Failure → `migrate: FAILED: <file> failed at line N: <sql line>` + message/detail/hint, exit 1;
  the connection string is never printed.
- Changed checksum of an applied file → warning, not re-run. `--reapply <file>`, `--status` (alias `--dry-run`).
  `-- migrate:no-transaction` first line opts a file out of the transaction.
- **Decision**: `VERCEL_ENV=preview` skips migrations unless `ORBIQUE_MIGRATE_PREVIEW=1`, because the Supabase
  integration connects Production, Preview and Development to the same database by default; an unmerged branch must
  not change the production schema.
- `package.json` `"build": "node scripts/migrate.mjs && node scripts/build.mjs"` is correct as is.

### `scripts/dev.mjs`
- Loads `.env.local` (own parser: comments, `export`, single/double quotes with `\n` escapes, inline `#` comments;
  shell variables win), builds with `node scripts/build.mjs` (same env; `--dist` passes `--out`), serves files first,
  then `vercel.json` rewrites (small path-to-regexp subset: `:name`, `:name*`, `(regex)`), then index.html for any
  extension-less path; applies `vercel.json` headers, so local caching matches production.
- `/api/<name>` → default export of `api/<name>.js` with `req.query`, `req.cookies`, `req.body` (JSON, form, text,
  Buffer; invalid JSON throws on access like Vercel), `res.status()`, `res.json()`, `res.send()`. Body limit 1 MB.

### `vercel.json`
- `framework: null` (= "Other"), `buildCommand: npm run build`, `outputDirectory: dist`, `regions: ["sin1"]`
  (Singapore, next to the database; Hobby allows one region), `functions["api/*.js"] = {maxDuration: 20, includeFiles: "config/**"}`.
  No `runtime` key: Node.js is the default for `api/*.js`, and `runtime` is only for community runtimes. No `memory`:
  Vercel rejects it in vercel.json when Fluid compute is on (the default).
- Rewrites: `/guest/:token` → `/index.html`, plus a catch-all `/((?!api/|vendor/|icons/).*)` → `/index.html`. Vercel
  checks the filesystem before rewrites, so real files are unaffected; a missing `/vendor/x.js` stays a 404 instead of
  returning HTML.
- Headers: `no-cache` for `/`, `/index.html`, `/guest/:token`, `/config.js`, `/sw.js`, `/manifest.webmanifest`;
  `/vendor/*` `public, max-age=604800, stale-while-revalidate=86400`; `/icons/*` `public, max-age=2592000`;
  everywhere `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (guest tokens do
  not leak in Referer), `X-Frame-Options: SAMEORIGIN`.
- **Decision**: vendor files get 7 days, not a year/immutable, because their names have no content hash
  (`vendor/supabase.js`); a dependency upgrade reaches users within a week (and sooner through the service worker).

### PWA
- `public/manifest.webmanifest`: name/short_name "Orbique", `id`/`start_url`/`scope` "/", standalone,
  `theme_color #0B5D54` (`--brand`), `background_color #F4F5F7` (`--bg`), icons 192, 512 and maskable 512.
- Icons: white ring "O" with a gold (`--accent`) orbit dot on a brand-teal gradient, rendered from SVG with Chromium;
  maskable keeps the mark inside the 80% safe zone; `public/icons/icon.svg` is the source.
- `public/sw.js` (`orbique-v4-1`): precaches index.html, config.js, manifest, icons and vendor files (each optional);
  navigations and config.js network-first with a 6 s timeout falling back to the cached copy (latest good navigation is
  stored as `/index.html`); `/vendor/*` and `/icons/*` cache-first with background refresh; ignores non-GET, cross-origin
  (Supabase, fonts) and `/api/*`; old `orbique-*` caches deleted on activate; `skipWaiting` + `clients.claim`; navigation preload.
- `app/server/pwa.js`: registers `/sw.js` only on https or localhost; moves the manifest/icon/theme-color tags into
  `<head>`; adds the iOS standalone meta tags; on guest links removes the manifest so "Add to Home Screen" keeps the
  guest's own link (start_url "/" would open the staff sign-in instead).

### CI (`.github/workflows/ci.yml`)
- On push and pull request: `npm ci`; `node --check` on every JS file under `app/` (as `.cjs` copies, see below), `api/`,
  `scripts/` and `public/sw.js`; JSON validity of vercel.json/manifest/config/package.json; the API modules import and
  export a handler; local build; production build with no database variables; dist contains the expected files and
  `server/pwa.js`; and no service-role JWT or `sb_secret_` key anywhere in dist (outside vendor/).
- **Decision**: `package.json` has `"type": "module"`, so plain `node --check app/x.js` parses browser files as strict ES
  modules (e.g. an octal literal would fail although browsers accept it). CI checks copies named `.cjs` (classic script semantics).

## Test results (local Supabase stack, 2026-10-10)

- Bootstrap: wrong email → 403, short password / bad email / bad JSON / unknown action → 400, GET → 405, real →
  200 (user confirmed, metadata `must_change_password: false`, sign-in works), second → 409; health flips
  `needsBootstrap` true → false. Existing-account bootstrap (recovery path) sets the password: verified.
- End-to-end suite through `scripts/dev.mjs` (`@s1.test` accounts): **65/65 checks pass**: every action, missing/bad token
  (401), non-admin create-operator (403), non-owner invite and reset (403), platform admin invite (403) and non-owner
  reset (403), invite as owner role (400), bad inputs (400), 409 conflicts (no stray user left behind), paused workspace (403),
  existing-user paths, staff record created vs kept, role update on re-invite, old password refused after reset,
  `must_change_password` set, signup row + 429 repeat, oversized/array/invalid bodies.
- The `listUsers` fallback finds users when the 0002 function is missing.
- Migrate on a scratch database (created and dropped by me): no URL (exit 0), status, apply, idempotent re-run, failing
  file (exit 1, line shown, its table rolled back, earlier file kept), changed-file warning, `--reapply`, preview skip,
  unreachable host (exit 1). Then applied to the shared local DB.
- Production build pointing at the local stack (`npm run build` in a scratch copy and `scripts/dev.mjs`): `/`, `/guest/anything`,
  `/guest/abc/`, `/index.html` → index.html `no-cache`; `/api/health` JSON `no-store`; `/sw.js` and
  `/manifest.webmanifest` `no-cache` with the right types; vendor/icons long cache; unknown `/api/*` → JSON 404;
  `dist/config.js` holds only the URL and the anon key.
- Chromium: manifest found (`Page.getAppManifest`, no manifest errors; the only installability error is "in-incognito",
  which is Playwright's context), SW controls the page, caches as listed, offline reload shows the cached app, offline
  `/api/health` is a network error (not cached), guest page has no manifest. Verified that Chrome ignores a manifest
  link in `<body>` and picks it up once moved to `<head>`.
- CI steps run locally in a scratch copy: all pass except the syntax check, which flagged `app/pages/guestapp.js`
  (truncated mid-edit by its owner at the time); the secret-key check catches a planted service-role key.
- Cleanup: my `@s1.test` users, `S1 …` orgs and signup rows are deleted; the scratch database is dropped;
  `admin@orbique.test` is kept.

## Open issues / for the lead

1. **build.mjs puts head tags in `<body>`** (`<title>`, manifest, icons, config.js) because `page()` wraps the shell in
   `<body>`. Chrome only reads `link[rel=manifest]` from `<head>` (verified), so the app was not installable;
   `app/server/pwa.js` moves the tags at runtime. Cleaner fix in build.mjs: put the shell's head part and the
   production `head` string inside `<head>`.
2. Vendor files have no content hash; adding `?v=<package version>` to `/vendor/*` URLs in build.mjs would allow
   `immutable` caching.
3. Temporary-password change is enforced by the app (`must_change_password`), not the database.
4. `reset-password` does not end existing sessions (GoTrue has no admin "sign out user by id" in supabase-js); suspending
   the member is the immediate cut-off (RLS requires status active).
5. Tested with the legacy JWT service-role key only (the local stack). The Supabase integration now syncs
   `SUPABASE_SECRET_KEY` / `SUPABASE_PUBLISHABLE_KEY` (`sb_secret_…` / `sb_publishable_…`); supabase-js is documented to
   accept them with `createClient`, but admin calls with a secret key are untested here. Check `/api/health` and one
   invite after the first real deploy.
6. Migrations use TLS without certificate verification (as requested). Supabase publishes its CA certificate; it could
   be bundled and verified later.
7. A bootstrap race (two allow-listed emails at the same instant) could create two platform admins; harmless.
8. 0001: `revoke all on function ... from anon` leaves the default `PUBLIC` execute grant, so anon can still call
   `platform_overview()` etc.; they are safe only because each checks `is_platform_admin()` / owner role inside.
   Revoking from `public` too would be tidier (not my file).
9. Guests who add their link to the home screen get the Orbique icon, not the operator's branding.
