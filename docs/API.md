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

No sign-in. `{ok: true, db: <the service key and URL are set and the database answers>, needsBootstrap: <no platform admin yet>, channex: <CHANNEX_API_KEY is set>, whatsapp: <the three WHATSAPP_* settings are set>, translate: <ANTHROPIC_API_KEY is set>, commit}`.
Never returns a key or any other setting's value.

## POST /api/account

Body `{action, ...}`. Sign-in is `Authorization: Bearer <the user's Supabase access token>`; the handler checks it with
`auth.getUser(token)`. Actions:

| action | who | body | result |
|---|---|---|---|
| `bootstrap` | anyone, only while no platform admin exists | `{email, password, name}` | `{ok}`. Allowed only when `sha256(lower(trim(email)))` is in `config/platform-owners.json` (`emailSha256`) or the email / its hash is in env `PLATFORM_OWNER_EMAILS` (comma separated). Creates the user already confirmed with that password (or sets the password of an existing user), adds `platform_admins`. |
| `signup` | anyone | `{company, contactName, email, phone, units, message}` | `{ok}`. Inserts `subscription_requests` (an operator asking to subscribe). Validate and cap lengths. |
| `create-operator` | platform admin | `{company, ownerName, ownerEmail, plan?}` | `{ok, orgId, staffId, email, tempPassword \| null, existing}`. Creates the org, the owner's account if new (confirmed, temporary password, `user_metadata = {name, must_change_password: true}`), the `members` row (role `owner`), and the owner's staff record (`records` coll `staff`: `{id: staffId, name, role: 'owner', roleLabel: 'Account owner', email}`). An existing user is added as owner without changing their password (`tempPassword: null, existing: true`). |
| `update-operator` | platform admin | `{orgId, company?, staffId?, ownerName?, ownerEmail?}` | `{ok, emailChanged, otherWorkspaces}`. Renames the org and/or changes one owner's name and sign-in email (confirmed at once; password unchanged), and updates that owner's staff record in this workspace. Checks everything first: the staff id must be an owner of `orgId`, the new email must not belong to another account, and a platform admin's email is never changed here. A changed email applies in every workspace the owner belongs to (`otherWorkspaces` counts the others). |
| `invite` | owner of `orgId` | `{orgId, staffId, name, email?, phone?, role, username?, phoneLogin?, phoneCc?, password?, mustChange?}` | `{ok, email, username, phone, tempPassword \| null, passwordSet, existing}`. Needs an email, a username or `phoneLogin`; without an email the account gets a stand-in address (`staff-…@login.orbiquepms.com`, never mailed). Names for an existing account are only added, never removed, and only when it uses Orbique with this workspace alone. `role` is not `owner`. Creates or reuses the account, adds/updates `members` (org, user, staff_id, role, status active); creates the staff record if the org has none with that id. |
| `reset-password` | owner of `orgId` (for members of that org who use Orbique with this workspace only) or a platform admin (for org owners) | `{orgId, staffId}` | `{ok, email, username, phone, tempPassword}`. New temporary password, `must_change_password: true`; clears the account's wrong tries. |
| `set-login` | owner of `orgId`, for a member (not an owner, not themselves) who uses Orbique with this workspace only | `{orgId, staffId, username?, phoneLogin?, phone?, phoneCc?, password? \| tempPassword?, mustChange?}` | `{ok, email, username, phone, tempPassword, passwordSet}`. Sets the username (`''` removes it) and mobile sign-in (`phoneLogin`, with `phone`; a number starting with 0 gets `phoneCc`, default 60). Usernames and numbers are unique across Orbique; the change is all or nothing (409 when taken). |
| `sign-in` | none | `{login, password}` | `{ok, access_token, refresh_token, expires_in, token_type}` for a mobile number or username (emails sign in with Supabase directly). Unknown and wrong give the same 400 `wrong-login`. Tries are counted before the password check: 8 per account and per unknown name, 40 per address, in 15 minutes (429). |

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

## POST /api/messages

The live guest inbox (`api/messages.js`, `api/_lib/inbox.js`). Signed in, `{action, orgId, ...}`; permissions follow the
app's rules (`inbox` to read and to send a greeting message, `inbox.send` to reply, `guestapp.doorCodes` to see door codes
in a greeting preview; role settings and personal overrides from `rolePerms` / `staffMeta`).
Demo workspaces never send.

| action | who | body | answer |
|---|---|---|---|
| `config` | inbox | `{orgId}` | `{whatsapp: {configured, number: {phone, name} \| null}, channex, translate, lang, autoTranslate, demo}` |
| `send` | inbox.send | `{orgId, conversationId, text, via: 'whatsapp' \| 'channex', orig?, origLang?, lang?}` | `{conversation: {id, data}}` after the reply was sent and added. WhatsApp only within 24 hours of the guest's last WhatsApp message (`window-closed` otherwise); Channex by message thread, else by booking (403: Messages app off, 422: the site does not support messages) |
| `translate` | inbox | `{orgId, conversationId, index, to?}` | Translates one message into `to` (default `inboxSettings.lang`) and saves `{lang, tr: {to, text}}` on it: `{conversation, same, lang, text}` |
| `preview` | inbox.send | `{orgId, text, to}` | `{text, lang, from, same}`: a reply in the guest's language, not saved |
| `media` | inbox | `{orgId, conversationId, index}` | `{mime, name, data}` (base64, at most 3 MB): a file the guest sent on WhatsApp |
| `whatsapp-connect` | owner | `{orgId, phoneNumberId}` | Checks the number with Meta and saves it in `whatsapp_numbers`: `{number: {phone, name}}` |
| `whatsapp-disconnect` | owner | `{orgId}` | `{number: null}` |
| `greeting` | inbox | `{orgId, conversationId, greetingId, via}` | Sends the building's greeting message (records `greetings`, `api/_lib/shared/greeting.cjs`) filled on the server for the chat's booking, unit, unit type and building, by the server's clock: the door code, private fields and for a typed unit the unit number and Wi-Fi only from 30 minutes before check-in (else the guest-app wording; a private field the guest app does not show reads "shared with you closer to check-in"), and the door code and private fields also wait while the booking's ID check is not done. Inbox view is enough: owner and every employee who can open the inbox may send it, even without inbox.send. It goes exactly as written, by the same routes and checks as `send`, and the message carries `greeting: <id>`. `{conversation: {id, data}, held: [keys]}`. Only a greeting whose records row was last saved (`updated_by`, stamped by the database) by an active member with `inbox.greetings` is sent (403 otherwise). Without inbox.send the same greeting goes to a chat at most once in 10 minutes (429 `too-many`). Refused: `no-booking`, `not-found`, `wrong-building`, `empty`, demo workspaces |
| `greeting-preview` | inbox | `{orgId, conversationId, greetingId}` | `{id, name, text, parts, held, why, revealAt, missing, masked}`: the text as `greeting` would send it now; `why` gives each held key's reason (`time` or `id`) and `revealAt` the check-in minus 30 minutes moment. For a caller without guestapp.doorCodes the door code and private field values read `[door code hidden]` (`masked: true`); a typed unit's number and Wi-Fi are not masked. The send still uses the real values. Same writer check as `greeting` |

## GET/POST /api/whatsapp-webhook

Meta's webhook for the WhatsApp business number. GET answers `hub.challenge` when `hub.verify_token` equals
`WHATSAPP_VERIFY_TOKEN`. POST needs `X-Hub-Signature-256` (HMAC-SHA256 of the exact body with `WHATSAPP_APP_SECRET`),
else 401. Messages go to the conversation of the booking whose guest phone matches (in house, else the next stay, else
the last), else to a conversation with no booking (`contact`, linked later in the inbox); each is stored once (`xid`
`wa:<id>`) and translated for the team when `ANTHROPIC_API_KEY` is set and `inboxSettings.autoTranslate` is not false.
Delivery ticks update the message's `status`. A database failure answers 500 so Meta sends it again. Everything is
refused until WHATSAPP_TOKEN, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN are set.

Booking-site chat through Channex (its paid Messages app) is built but switched off (`CHANNEX_MESSAGES` in
`api/messages.js`; the webhook does not subscribe to message events). If switched on, Channex message events (`message`,
`inquiry`, `reservation_request`, `message_thread_booking_assigned`) arrive on `/api/channex-webhook` like booking events and go to the booking's conversation the same way (`xid` `cx:<id>`, the
thread in `cx`). Conversation and message fields are described at the top of `supabase/migrations/0010_inbox.sql`.

## POST /api/site

The workspace's own website content (`api/site.js`, `api/_lib/site.js`), used by the Live website page
(`app/pages/livesite.js`). Signed in, `{action, orgId, ...}`. "May edit" and "may publish" are the app's Staff Access
actions `website.edit` and `website.publish` (owner and Operations by default; role settings and personal overrides
from `rolePerms` / `staffMeta`; a suspended member may do neither), checked against the database.

| action | who | body | answer |
|---|---|---|---|
| `upload-urls` | website.edit | `{orgId, count: 1..30, widths: [640, 1280?, 2400?]}` | `{photos: [{id, base, widths, uploads: [{width, path, signedUrl, token}]}], maxBytes}`. Creates the public Storage bucket `site-photos` on first use (JPEG only, 3 MB a file). The browser sends each file with `PUT <signedUrl>` (form data, header `x-upsert: true`); the files are `<base>-<width>.jpg` under `site-photos/<orgId>/`. |
| `publish` | website.publish | `{orgId, draftHash?}` | Reads the draft (blob `siteContent`), checks it strictly, writes it to `siteContentLive` and refreshes the website's pages: `{publishedAt, publishedBy, live, refreshed, failed: [paths], note, warnings}`. |

Publish refuses with 409 `draft-saving` when `draftHash` (`O.sitecontent.hash` of the draft the person sees) is not
the saved draft's (the last change has not reached the server), 429 after 20 publishes in an hour, and 400
`content-problems` with `problems: [{level, where, field, message}]` when the draft breaks a rule (an unknown building,
a web address used twice, a photo without a description, an uploaded photo outside this workspace's folder, ...).
A shown unit without photos is published with a warning. The content rules are in `api/_lib/shared/sitecontent.cjs`
(also in the browser as `O.sitecontent`); `tests/site-content.test.mjs` and `tests/site.api.test.mjs` cover them.

Refreshing the website: for every page the old and the new content imply (`/`, `/sitemap.xml`, `/views/`, each city,
building and unit page; at most 50), `GET <siteUrl><path>` with header `x-prerender-revalidate: <SITE_REVALIDATE_TOKEN>`
(5 s each, in parallel). `siteUrl` is the `website` blob's. A page that is no longer in the content may answer 404.
The token is sent only when `siteUrl` is `https://` on a host in `SITE_REVALIDATE_HOSTS` (comma separated; default
`www.staykozi.my,staykozi.my`), never to any other address a member saved. Without the token, the address or an
allowed host nothing is refreshed and `note` says, in plain words, that the website shows the change within 5 minutes
(the reason goes to the server log).

Who may write the blobs (migration `0017_site_content.sql`): `siteContent` and `website` (the website settings,
including `siteUrl`) only members `website_can(org, 'edit')` allows (the same rule); `siteContentLive` nobody but the
server. A city's web address cannot be one of the site's own top-level names (`RESERVED` in sitecontent.cjs: `book`,
`booking`, `guides`, `views`, `api`, ...).

## GET /api/public/site?ws=<slug>

No sign-in, any origin (`Access-Control-Allow-Origin: *`), cached for 60 seconds. The published content of the
workspace whose `website.slug` is `ws`: `{ok: true, content: {version: 1, buildings, suites} | null, publishedAt,
contact: {whatsapp}}` (`null` before the first publish). `contact.whatsapp` is the number guests book on, as wa.me
wants it (country code and number, digits only, from `website.whatsapp`), or `null`; it comes whether or not the
content has been published. Hidden buildings and units are included with `visible: false`; the website leaves
them out. The content is checked again on the way out, so anything invalid is dropped. 404 for an unknown `ws`.
The website reads it when it builds or refreshes a page.

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

Channex (Channels page, app/pages/channels.js): `O.auth.call(path, body) -> Promise<json>` (POSTs with the signed-in
token; a failure rejects with an Error carrying `.code`, `.status` and `.body`), `O.auth.channex(action, body)` (the same
for `/api/channex`, with `orgId` added), `O.auth.inbox(action, body)` (the same for `/api/messages`; the Live website page calls `O.auth.call('/api/site', ...)` the same way, or `O.siteApi(action, body)` when a test sets it) and `O.auth.channexRealtime(onChange) -> unsubscribe` (realtime on
channex_properties, channex_outbox and channex_alerts for the current org; the Sync log also polls).

The browser side of Channex is `O.channel` (app/pages/channels.js): `mode()` ('live' on the server with Channex configured,
'simulated' in the local test copy or without a key: nothing leaves the browser and the Sync log shows what would be sent),
`setDays(changes, opts)` (the one writer of channelRates, also used by Calendar → Rates & restrictions and Pricing),
`fill(typeIds)` (model rates into channelRates for 500 days), `kick()` (asks the server to send pending changes after a
save), `conflicts()`, `notice(kind, typeIds)` (mode-aware wording for toasts), plus read helpers (`plansOf`, `mainPlan`,
`planRate`, `day`, `restriction`, `connected`, `typeConnected`, `status`, `problems`).
