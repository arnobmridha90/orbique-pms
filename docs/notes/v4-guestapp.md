# v4 Guest App (guestapp)

Files: `app/pages/guestapp.js` (rewritten), `app/pages/guestapp.css` (new, classes `gx-` for the guest app and `ga-` under
`.pg-ga` for the staff page), `supabase/migrations/0003_guest.sql` (new). No other file was edited.

## What it does

### The guest's own app: `O.guestMode(root, token, opts)`
Opened from the booking's link (`#guest-<token>` locally, `/guest/<token>` in production), no sign-in, phone first and
also laid out for desktop (container queries on `.gx`, so it works full screen and inside the staff preview frame).
It reads and writes only through `O.guestApi`, never `D`.

- **Header** with the operator's name, logo and colours (`workspaceBrand`), the unit name.
- **Home**: stage hero ("Arrival day", "Night 3 of 4", "Check-out day", "See you soon"), check-in / check-out card,
  then the **door code card**. The code shows only when every condition is met; otherwise the card says what it waits for
  ("Your door code shows here at 3:00 PM today (in 1 h 45 min)", "once you are checked in", "We are checking your ID")
  with a three-step checklist (online check-in, ID check, code time). "Code not working?" sends a code-help request.
  Wi-Fi with copy, tiles for Getting in, House rules, Check-out, Explore.
- **Online check-in**: guest names (up to 10), arrival time, ID photo (when required), house rules with consent and a
  typed signature. **ID**: the guest picks a photo, it is compressed in the browser to a JPEG data URL (at most
  240,000 characters) and shown as a thumbnail before sending.
- **Your stay**: address, parking, getting-in steps (per unit), house rules, house guide (accordion, per unit),
  check-out steps, problem reports (room, item, description, there on arrival or during the stay, urgent, up to 3
  photos, each compressed to at most 120,000 characters).
- **Explore**: things to do by city (from the unit's area), "Don't do this in Malaysia" (law, etiquette, safety), videos.
- **Requests**: the operator's services (towels and linen, late check-out, early check-in, airport transfer, mid-stay
  clean, SIM, car rental, Touch 'n Go) with their own small forms; the guest's requests and their status.
- **Messages**: the booking's chat (guest and staff messages only, never internal notes or system lines).
- **Feedback** (check-out day and after): 1 to 5 stars and a comment, when `reviewPrompt` is on.
- States: loading, unknown link, expired (30 days after check-out), cancelled, paused workspace (read only, with call /
  WhatsApp buttons), network error with retry. Re-reads every 30 s while visible, on local data changes and after every action.
- `opts.preview` (staff preview): yellow banner, actions are not sent ("Preview only: nothing was sent"), and the
  preview reads the staff's own data through the local API. `opts.hideCode` / `opts.hideWifi` mask the code and Wi-Fi
  for staff without `guestapp.doorCodes` / `properties.access`.

### The staff page `guestapp`
Tabs (param `tab`: `guests`, `requests`, `damage` (alias `problems`), `info`, `tips`, `settings`; param `bookingId`
highlights and scrolls to that booking; `preview: true` with `bookingId` opens its preview):

- **Guests**: Arriving today, Staying now, Next 7 days (and the selected booking). Each row: check-in pill, ID pill,
  door-code pill ("Code showing", "Code from 3:00 PM today", "Code waits for check-in", "No door code set"...),
  **Check ID** (when a photo is waiting), **Preview guest app** (phone-size `U.modal` with `O.guestMode` on a div,
  no iframe), **Copy guest link** (`O.guestLink(b)`, clipboard or a modal with a read-only field). The intro line counts
  arrivals that can already see their code.
- **Check ID** modal: the ID photo from the app, "Ask for a new photo" and "Mark ID verified". Both delete the photo
  from the chat. Without a photo in the app it says to check the ID from WhatsApp or at arrival and still allows verify.
- **Requests**: Open / Done / Declined / All. Confirm, Decline, Mark done; code-help requests get "Change door code"
  (`O.lock.change`) and "Mark solved" (also closed automatically when the code changes). Confirming towels or a clean
  creates a Housekeeping task (clean with checklist `CL-daily`) for the unit's housekeeper (only with `tasks.assign`,
  else unassigned or self); confirming late check-out / early check-in moves `checkOutTime` / `checkInTime`. Hints show
  the next / previous guest of the unit for late / early requests. A staff note goes in the chat.
- **Problems**: To handle / All. Create repair task (Maintenance, first maintenance staff when `tasks.assign`, due in 2 h
  when urgent, photos copied to the task), or "No repair needed" / "Noted, no repair". Photo viewer.
- **House info**: welcome, house rules, getting in, house guide, check-out; edit inline, move, delete, add; steps and
  topics can be limited to one unit.
- **Local tips**: things to do per city, "don't" list, videos.
- **Settings**: door code timing (0, 1, 2, 3 or 6 hours before check-in), require online check-in, require ID (both
  need `guestapp.doorCodes`), require a typed signature, review prompt, contact (phone, WhatsApp, hours; the workspace
  phone is the fallback), services on / off.
- **Bell** (`O.notifiers`): door code not working, new guest requests, ID photos to check (with `guestapp.edit` or
  `bookings.edit`), problems without a task.
- **Permissions**: page needs `guestapp`; editing content and settings `guestapp.edit`; handling requests and problems
  `guestapp.requests` (needs the section at edit level); codes, code timing and the copy-link button
  `guestapp.doorCodes`; ID check `guestapp.edit` or `bookings.edit`; message buttons `inbox.send`; tasks `tasks.create`
  / `tasks.assign`. View-only roles see everything with disabled controls and a short reason. Paused workspace: read only.
- Empty workspace: every tab has an empty state with one sentence and the main action ("Add your first property").

### Data (registered by core: records `guestRequests`, `damageReports`; config blob `guestApp`)
- `D.guestApp` gets every missing default key and service through the automation `guestAppSettings` (sets `v: 4`), so
  the blob is saved once and the database sees full content.
- Demo seeds: 7 guest requests, 2 damage reports (drawn SVG photos), online check-ins for guests whose code went out.
- `O.guestStay(b)` is exported for other pages: `{state, ciTime, coTime, ciAt, coAt, revealAt, unitAt, checkinDone, idVerified,
  waiting, visible}`.
- **Unit types (0008_guest_units.sql)**: for a booking of a typed unit (`unitTypeId` on the booking or the unit) the payload's
  `property.name` is the building name + type name ("Seri Saujana Residences · Deluxe"), `property.address` is the
  building's address, and three fields are added: `unitType` (type name), `unitNo` (the unit number, `null` until
  `unitAt` and after the stay ends) and `unitAt` (check-in time minus 24 hours, `0020_reveal_24h.sql`; it was 30 minutes
  until 2026-10-29). The Wi-Fi follows the unit number (its name may carry the number), also for untyped units, so it shows
  from the day before arrival. The check-in time falls back from the booking to the unit,
  then the building, then 15:00. Untyped units give exactly the payload they gave before (no new fields).

## Decisions and why

- **One rule for the door code**, written once in JS (`stayInfo`) and once in SQL (`guest__stay`, re-created in
  `0008_guest_units.sql`, timing in `0020_reveal_24h.sql`): the code shows from 24 hours before the check-in time (the same
  moment as the unit number, owner decisions 2026-10-15 and 2026-10-29: "We will send 24 hours before checkin"; `codeLeadHours` is kept in the settings and the payload but no longer used) until check-out time, only when
  the booking is not pending or cancelled, the guest checked in online (if required), the ID is verified (if required),
  and a code is set and not cancelled / expired. The guest is told exactly what is missing.
- **The guest API returns a purpose-built payload**, never raw records: no phone, email, amounts, notes, other bookings,
  internal notes, system lines, task details, photo data or tokens. Staff messages appear as "host".
- **Token lookup must match exactly one live booking**; duplicates (for example demo tokens copied into two workspaces)
  give `not_found` instead of guessing. Token format `^[A-Za-z0-9_.~-]{4,80}$`.
- **ID photos go into the booking's chat** as a picture message (`idPhoto: true`), because that is where WhatsApp ID
  photos already land and the inbox shows them. Only the latest keeps its picture, staff delete it when they verify or
  reject, the guest never gets it back, and at most 5 uploads per stay. A separate table was not added because the spec
  limits the server contract to `records` / `blobs`, and the staff sync loads every records row (see requests).
- **Writes have the same shape as the staff app** (a request is a `guestRequests` record, a report a `damageReports`
  record, notes are `{from: 'system', text, time}` in the conversation) so realtime, the inbox and other pages need no
  changes. The database sets `updated_by = null` for guest writes.
- **Caps** stop a leaked link from flooding a workspace: 20 messages an hour and 200 per stay, 20 requests, 10 problem
  reports, 5 ID photos, 100 guest-app notes per stay, field lengths (see contract). One open late check-out request.
- **Paused workspace**: the guest can still read (the door code matters) but cannot send.
- **Expired** 30 days after check-out: only the operator brand comes back.
- `guest__now()` reads Malaysia time; tests can pin it with `set orbique.guest_now`, which is ignored for the API logins
  (`authenticator`, `anon`, `authenticated`), so a guest cannot move the clock.
- Helpers `guest__*` are not executable by `anon` / `authenticated` (Supabase grants new functions to them by default,
  so they are revoked explicitly); only `guest_get` and `guest_act` are security definer and granted.
- The staff preview uses the local API on purpose: it shows the staff's current data, also for a booking whose token
  was just created and not saved yet.

## Tests run

- `node --check` (also as `.cjs` like CI), local build, screenshots read for: staff tabs desktop and phone; preview
  modal desktop and phone; guest app phone and desktop for arrival, in-house, check-out day, upcoming, past, cancelled,
  expired, unknown link; check-in flow with an ID photo; later date `--now 2026-10-21T15:40`; empty workspace;
  viewers s4 (front desk), s5 (housekeeper: view only, code masked, copy link disabled), s6 (locked by core), s7.
  0 JavaScript errors (only blocked font requests).
- Local API script (every action and error), staff interaction script (confirm / decline / tasks / code change /
  check ID / settings / house info) and an ID-photo flow script (guest upload, staff ask again, verify, photo deleted,
  inbox shows it).
- Database: `/tmp/guestapp/apply.mjs` applies 0003 (run twice, re-runnable); `/tmp/guestapp/sqltest.mjs` creates orgs
  `guestapp-test` and `guestapp-test-2` (same record ids, a token shared by both), calls both functions after
  `set role anon`, and deletes the two orgs again. 273 checks pass: helpers not executable by anon, invalid tokens
  (null, short, long, injection, wrong case, deleted booking, duplicate token), unusable dates, door timing (12:59 hidden,
  13:00 shown with 2 h lead, lead 0 / 99 / -5 / "6" / "abc"), cancelled code, every action with its errors and caps,
  record shapes, cancelled / past / expired / pending stages, cross-workspace isolation both ways, paused workspace,
  `guest_get` inside a read-only transaction, and payload keys equal to the local API's.
- 0003 is applied to the shared local database (functions only); `scripts/migrate.mjs --status` still lists it as
  pending, so the next migrate run applies and records it.

## What's left / known differences

- The JS and SQL versions differ in edge cases only: the local API also accepts a booking id as the token (handy in the
  local build); the database returns `null` for content lists when the `guestApp` blob was never saved (the guest app then
  uses its built-in defaults); keys of `vals` beyond 12 are picked in jsonb order, not insertion order; lengths are counted
  in characters in SQL and UTF-16 units in JS; the first conversation is the lowest id in SQL and the first in `D` in JS;
  JSON text containing `\u0000` is rejected by Postgres before the function runs (the app shows the network error).
- ID photos are visible at the API level to every member of the workspace (like all records). See requests.
- No automatic clean-up of old ID photos that staff never checked.
- Guest app strings are English only.

## Requests for core and others

1. **Guest tokens** (core): `O.bookingDefaults` makes `O.uid('g')` tokens (timestamp plus about 20 random bits). Please use
   at least 96 random bits from `crypto.getRandomValues` (the server seed job already does). Built-in demo tokens are
   also identical in every workspace (the database refuses duplicates, so they simply do not open).
2. **Private ID storage** (server): a private Storage bucket or a table readable only by roles that verify IDs, plus
   removal after check-out. Then `guest_act('id')` would write there instead of the chat.
3. **Booking drawer "Mark ID verified"** (core.js): it does not delete the ID photo; the Guest App page does. Could call
   the same clean-up (messages with `idPhoto: true` lose `url`).
4. **Rate limiting** (server): the caps are per booking; per-IP limits on `/rest/v1/rpc/guest_*` need the API gateway.
5. **Guest boot** (core): in guest mode the local build shifts demo dates and starts sync inside `prepareLocal()` in
   guestapp.js; it would be cleaner in `O.boot`'s guest branch. Toasts are not shown in guest mode (the app uses its
   own notices).
6. **Conversation writes** (core / inbox): the staff app saves whole conversation records; a guest message arriving
   while a staff device holds an older copy can be overwritten if that device saves the same conversation. A merge on
   `messages` (append-only by time) would make it safe.
7. **Role defaults** (core): the housekeeper role has `guestapp.requests` but the section at view level, so the action
   can never be used. Either give `guestapp` edit level or drop the action from that role.
8. `O.guestApi = Object.assign({}, O.guestApi, {server: true, ...})` in auth.js keeps `local: true` from the local API;
   harmless today (nothing reads it), but `delete` it to avoid confusion.

## Guest API contract

Both functions take the token from the guest's link and return JSON. Production: `rpc('guest_get', {p_token})` and
`rpc('guest_act', {p_token, p_action, p_args})` as `anon`. Local: `O.guestApi.get(token)` / `.act(token, action, args)`
return Promises with the same JSON. Times are Malaysia local time strings `YYYY-MM-DDTHH:MM`, dates `YYYY-MM-DD`,
clock times `HH:MM`.

### `guest_get(p_token text) returns jsonb`

Errors: `{ok: false, error: 'not_found'}` (bad token, no booking, more than one booking, unusable dates) and
`{ok: false, error: 'expired', brand}` (more than 30 days after check-out).

```
{
  ok: true, v: 1,
  now: 'YYYY-MM-DDTHH:MM',
  state: 'upcoming' | 'arrival' | 'inhouse' | 'checkout' | 'past' | 'cancelled',
  readOnly: boolean,                      // workspace paused: actions return read_only
  brand: { name, logo | null, primary | null, accent | null },
  booking: { ref, guestName, guests, nights, checkIn, checkOut, checkInTime, checkOutTime, channel, status },
  property: null | { name, area, address, type, beds, parking, lockBrand, photo | null,
                     wifi: null | { name, password },            // wifi only for arrival / inhouse / checkout (typed units: from unitAt)
                     unitType, unitNo | null, unitAt },          // typed units only (0008): unitNo from unitAt on arrival / inhouse / checkout
  checkin: { done, at, names: [], arrivalTime, signedName, idSubmitted, idVerified },
  door: { visible, code: string | null,   // code only when visible
          from, until,                    // from = check-in time minus 24 hours (with the unit number); until = check-out
          waitingFor: [],                 // 'confirmation' | 'checkin' | 'id' | 'time' | 'host' | 'ended'
          helpOpen },                     // an open code-help request exists
  app: { requireCheckin, requireId, requireName, codeLeadHours (0-12, no longer used), reviewPrompt, welcome,
         contact: { phone, whatsapp, hours },                    // phone falls back to the workspace phone
         rules: [{id, title, text}], entry: [{id, text}], guide: [{id, title, text}], checkout: [{id, text}],
         todo: {city: [...]}, dont: [...], videos: [...],
         services: [{id, name, icon, price, desc, fields}] },    // switched-off services left out
                                          // content lists are null when the workspace never saved settings
  messages: [{ from: 'guest' | 'host', type: 'text' | 'voice' | 'image' | 'file', text, time }],
                                          // last 100 guest / staff messages; no notes, system lines or ID photos;
                                          // voice -> 'Voice message', image -> caption or 'Photo'; no URLs
  requests: [{ id, type, summary, note, status, at }],          // newest 50; status new | confirmed | delivered | declined
  reports: [{ id, room, item, desc, when, urgent, at, photos (count), status: 'open' | 'logged' | 'fixed' }],
  feedback: null | { stars, text, at }
}
```

States: `expired` after check-out + 30 days; `cancelled` (status); `past` from check-out time or status `checked_out`;
`upcoming` before the check-in day; `arrival` on it; `inhouse` until the check-out day; `checkout` on the check-out day
before check-out time. Default times 15:00 / 11:00. Report status: `fixed` when its task is done, `logged` when it was
there on arrival or staff marked it noted, else `open`.

### `guest_act(p_token text, p_action text, p_args jsonb) returns jsonb`

Result `{ok: true}` or `{ok: true, id}` for created records, else `{ok: false, error}`. Checked in this order:
`not_found`, `expired`, `read_only` (paused workspace), then per action: `not_now` (wrong stage), `invalid`,
`invalid_photo`, `too_many`, `duplicate`. Unknown action: `unknown_action`. `p_args` that is not an object counts as
`{}`. Text is trimmed, control characters removed, then cut to the limit. A "guest app note" is a system line
`{from: 'system', text, time}` in the booking's conversation (created when missing: `{id: 'C-…', bookingId, unread: 0,
messages: [], createdAt}`), at most 100 per stay.

| action | args | allowed in | effect |
|---|---|---|---|
| `checkin` | `names` string[] (first 10, each 80, blanks dropped, at least one), `arrivalTime` 'HH:MM' (optional), `consent` must be `true`, `signedName` (80; at least 3 characters when `requireName`) | upcoming, arrival, inhouse | booking `guestCheckin = {at, names, arrivalTime, consent: true, signedName}` (signedName falls back to the first name), `rulesAccepted = {at, name}`; `codeStatus` held -> scheduled when the ID is verified or not required. Note "Guest app: online check-in done by NAME. Arriving around 2:30 PM." |
| `id` | `photo: {name (80), url}`; url `data:image/(jpeg\|png\|webp);base64,…` up to 240,000 characters | upcoming to checkout | picture message in the chat `{from: 'guest', type: 'image', text: 'ID photo', caption: 'ID photo for check-in', name, url, time, via: 'guestapp', idPhoto: true}`, earlier ID pictures lose `url` (caption "Earlier ID photo, replaced"), `unread` + 1; booking `idSubmittedAt = now`. Max 5 per stay (`too_many`). |
| `message` | `text` (1000, not empty) | any stage | chat message `{from: 'guest', type: 'text', text, time, via: 'guestapp'}`, `unread` + 1. 20 per hour and 200 per stay (`too_many`). |
| `request` | `type` (an enabled service id), `summary` (300, defaults to the service name), `note` (300), `vals` object (keys `^[a-z]{1,20}$`, first 12, values 160) | upcoming to checkout | `guestRequests` record `{id: 'GR-…', bookingId, type, summary, vals, note, status: 'new', at}`; returns `id`. Max 20 per stay; a second late check-out while one is not declined is `duplicate`. Note "Guest app request: SERVICE (SUMMARY)". |
| `codehelp` | none | when the code is visible | `guestRequests` record `{id, bookingId, type: 'code', summary: 'Guest says code 1234 is not opening the door', code, status: 'new', at}`; returns `id`. If one is already open: `{ok: true}` and nothing new. Note "Guest app: door code 1234 reported as not working." |
| `report` | `item` (80, required), `desc` (600, at least 3), `room` (40, default 'Other'), `when` 'arrival' or 'stay', `urgent` true (only for 'stay'), `photos` up to 3 `{name, url}` with url like `id` up to 160,000 characters | arrival, inhouse, checkout | `damageReports` record `{id: 'DR-…', bookingId, propertyId, guest, room, item, desc, when, urgent, photos: [{name, url}], at, taskId: null}`; returns `id`. Max 10 per stay. Note 'Guest app: problem reported, "ITEM" (ROOM), marked urgent, with 2 photos.' |
| `feedback` | `stars` integer 1-5 (a JSON number), `text` (1000) | checkout, past | booking `guestFeedback = {stars, text, at}` (replaces an earlier one). Note 'Guest app feedback: 4 out of 5. "TEXT"' |

Ids are `PREFIX-` + base36 time in ms + 4 random base36 characters, upper case (like `O.uid`).

Staff-side writes the guest sees: request `status` (`confirmed`, `delivered`, `declined`, with `by`, `handledAt`),
booking `idVerified`, `codeStatus`, `doorCode`, `checkInTime` / `checkOutTime`, report `taskId` / `noted: {by, at}`,
and staff messages.
