# Orbique server API (production)

Vercel serverless functions in `api/`. Node 20+, ES modules, `export default async function handler(req, res)`.
They use the Supabase **service-role key** (env `SUPABASE_SERVICE_ROLE_KEY`, or `SUPABASE_SECRET_KEY`) and the project URL
(env `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`). That key never appears in front-end code, `dist/config.js`, logs or responses.
Write handlers so they work both on Vercel and under `scripts/dev.mjs`: parse the body yourself when `req.body` is
undefined or a string, and answer with `res.statusCode`, `res.setHeader` and `res.end(JSON.stringify(...))`.

The phone app (docs/MOBILE.md) calls these functions from its own origin (Android `https://localhost`, iOS
`capacitor://localhost`) with the site address as `ORBIQUE_CONFIG.apiBase`. Handlers start with `if (cors(req, res)) return;`
(`api/_lib/http.js`), which answers the OPTIONS preflight and adds the cross-origin headers for those two origins only.

Every response is JSON: `{ok: true, ...}` or `{ok: false, error: '<code>', message: '<plain English for the screen>'}`
with status 400 (bad input), 401 (not signed in), 403 (not allowed), 409 (conflict), 429 (too many) or 500.

## GET /api/health

No sign-in. `{ok: true, db: <the service key and URL are set and the database answers>, needsBootstrap: <no platform admin yet>, channex: <CHANNEX_API_KEY is set>, commit}`.
Never returns a key or any other setting's value.

## POST /api/account

Body `{action, ...}`. Sign-in is `Authorization: Bearer <the user's Supabase access token>`; the handler checks it with
`auth.getUser(token)`. Actions:

| action | who | body | result |
|---|---|---|---|
| `bootstrap` | anyone, only while no platform admin exists | `{email, password, name}` | `{ok}`. Allowed only when `sha256(lower(trim(email)))` is in `config/platform-owners.json` (`emailSha256`) or the email / its hash is in env `PLATFORM_OWNER_EMAILS` (comma separated). Creates the user already confirmed with that password (or sets the password of an existing user), adds `platform_admins`. |
| `signup` | anyone | `{company, contactName, email, phone, units, message}` | `{ok}`. Inserts `subscription_requests` (an operator asking to subscribe). Validate and cap lengths. |
| `create-operator` | platform admin | `{company, ownerName, ownerEmail, plan?}` | `{ok, orgId, staffId, email, tempPassword \| null, existing}`. Creates the org, the owner's account if new (confirmed, temporary password, `user_metadata = {name, must_change_password: true}`), the `members` row (role `owner`), and the owner's staff record (`records` coll `staff`: `{id: staffId, name, role: 'owner', roleLabel: 'Account owner', email}`). An existing user is added as owner without changing their password (`tempPassword: null, existing: true`). |
| `invite` | owner of `orgId` | `{orgId, staffId, name, email, phone?, role}` | `{ok, email, tempPassword \| null, existing}`. `role` is not `owner`. Creates or reuses the account, adds/updates `members` (org, user, staff_id, role, status active); creates the staff record if the org has none with that id. |
| `reset-password` | owner of `orgId` (for members of that org) or a platform admin (for org owners) | `{orgId, staffId}` | `{ok, email, tempPassword}`. New temporary password, `must_change_password: true`. |

Temporary passwords: easy to read aloud and type on a phone, e.g. `Mango-River-4821` (two words from a list + 4 digits, crypto random).

## POST /api/channex

The channel manager (Channex) for one workspace. Body `{action, orgId, ...}`, same sign-in as `/api/account`; the caller
must be an active member of an active workspace. Live mode needs `CHANNEX_API_KEY`, the workspace in
`CHANNEX_ORG_ALLOWLIST` (staging: an empty list allows nobody; production: an empty list allows everyone) and a workspace
that is not a demo (`workspaceMeta.demo`). Never returns the Channex API key.

| action | who | body | result |
|---|---|---|---|
| `config` | member | `{orgId}` | `{configured, env: 'staging'\|'production', allowed, demo}`: the Channels page shows live or practice mode |
| `connect` | owner, ops | `{orgId, buildingId}` | Checks the building (address, every active unit tagged with a unit type of the building, every type has units and a rate plan; problems come back as `problems: [..]` with status 400). Creates or reuses the Channex group, property (timezone Asia/Kuala_Lumpur, min stay on arrival, 500-day inventory), room types and rate plans, sets the building to `syncing`, requests and runs the first full sync (about 12 s budget). `{property, roomTypes, ratePlans, created, fullSync, pending, waitingUntil}`. Safe to call again |
| `iframe` | owner, ops | `{orgId, buildingId}` | `{url, expiresAt}`: the Channex channel screen signed in with a one-time token (15 minutes, single use). Desktop: iframe; phone app: `@capacitor/browser` |
| `full-sync` | owner, ops | `{orgId, buildingId, confirm: true}` | 500 days again (one availability call, one restrictions call). 429 `full-sync-recent` within 24 h of the last one, unless the building is still `syncing` |
| `flush` | member | `{orgId}` | Sends this workspace's pending changes now (no quiet window, 8 s budget): `{sent, pending, waitingUntil, live}`. One call per workspace every 2 s (429 `flush-busy`) |
| `channels` | member | `{orgId, buildingId}` | `{channels: [{id, channel, title, isActive}], cached}`; cached in `channex_properties.channels` |
| `pause` / `resume` / `disconnect` | owner | `{orgId, buildingId}` | `{property}`. Paused keeps changes queued; resume sends them. Disconnect stops sending and drops queued changes (channels are switched off in the channel screen); connecting again reuses the Channex property and sends a full update |
| `retry` | owner, ops | `{orgId, buildingId}` | Clears a pause or an error, resolves the sync error alert and sends again: `{property}` |
| `admin-setup` | platform admin | `{}` | Makes sure the global Channex webhook exists (`APP_URL/api/channex-webhook`, booking and channel events, `X-Orbique-Webhook-Token` header, signed when `CHANNEX_SIGNING_KEY_ID` is set): `{settings, webhook: {id, state: 'created'\|'updated'\|'ok', callbackUrl, signed}}`. `settings` says which env vars are present (never their values) and when the last Channex call was logged |

`property` is `{buildingId, propertyId, status, currency, fullSyncAt, fullSyncRequestedAt, pausedUntil, lastError}`.

## POST /api/channex-worker

The sending job, called by pg_cron through pg_net every minute (`{task: 'tick'}`) and at 03:00 Malaysia time
(`{task: 'nightly'}`), or locally by `node scripts/dev.mjs --worker`. `Authorization: Bearer <CHANNEX_WORKER_SECRET>`
(constant-time compare; no secret set means nobody gets in). Tick: setup queue, then every connected building with
queued changes or a full-sync request: one availability call and one restrictions call at most, each only for what
changed since Channex last accepted it (`channex_state`), within the rate limits (`channex_take_slot`), with 429 backoff
(60 s x 2^n up to 16 min), a one-minute pause after 5xx or network errors, and status `error` plus an alert after other
4xx. Before that, each tick retries stored webhook events not handled within a minute and acknowledges revisions that
were saved but not acknowledged (`inbound`), and every 15 minutes reads `/booking_revisions/feed` (`feed`). Nightly:
marks the new 500th day, re-runs unit assignment for stays starting in the next 14 days (`reassign`), refreshes channel
lists, prunes the call log after 60 days, flags unassigned arrivals within 48 h, then ticks.
Answers `{ok, task, ...counts}`; `maxDuration` 30 s in vercel.json.

## POST /api/channex-webhook

Public; Channex calls it. The body is read raw (at most 256 KB) and must carry a valid `x-hmac-signature-256`
(HMAC-SHA256 with `CHANNEX_WEBHOOK_SECRET` over `${x-hmac-timestamp}.${body}`, timestamp within 5 minutes) or the
`X-Orbique-Webhook-Token` header equal to `CHANNEX_WEBHOOK_TOKEN`; otherwise 401. The event is stored once in
`channex_events` (by the body's sha256; a replay answers `{duplicate: true}`); a database failure answers 500 so
Channex sends it again. Booking events are then handled for up to about 6 s (`api/_lib/channex-bookings.js`):
`GET /booking_revisions/:id`, save one booking record per room (ids kept in `channex_bookings`, shared `groupRef` for
several rooms), unit assignment (`assign.cjs`), `double_booking` / `needs_unit` / `unmapped_room` / `unmapped_rate`
alerts, and only then `POST /booking_revisions/:id/ack`. A revision older than the one applied is acknowledged and
not applied. Card data (`guarantee`) is never stored. The 0006 triggers mark availability and the worker closes or
reopens the dates on Channex. Sync errors and disconnected channels become alerts. Answers 200 `{ok, stored, status}`
once stored; whatever is left the worker finishes. `GET /bookings` is never used.

## Database functions the browser calls (supabase.rpc)

From `supabase/migrations/0001_core.sql`: `my_context()`, `platform_overview()`, `set_org_status(p_org, p_status)`,
`set_org_plan(p_org, p_plan)`, `reset_org(p_org)`. From `0003_guest.sql`: `guest_get(p_token)`, `guest_act(p_token, p_action, p_args)`.
Check the SQL for the exact argument names.

## Browser-side O.auth (app/server/auth.js) used by pages

`O.auth.enabled()`, `gate()`, `switchWorkspace(key)`, `loadDemo()`, `startEmpty()`, `resetWorkspace()`,
`invite({staffId, name, email, phone, role}) -> Promise<{email, tempPassword, existing}>`,
`setMemberStatus(staffId, 'active'|'suspended')`, `setMemberRole(staffId, role)`, `resetPassword(staffId) -> Promise<{email, tempPassword}>`,
`previewAs(staffId | null)`, `isPlatformAdmin()`, `user()`, `signOut()`.
Pages call them only when they exist (`O.auth && O.auth.enabled && O.auth.enabled() && O.auth.invite`), otherwise they keep the local behaviour.
