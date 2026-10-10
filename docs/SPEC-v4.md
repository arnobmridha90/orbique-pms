# Orbique PMS v4 — build spec

Read this whole file before changing anything. `docs/SPEC-v3.md` and `docs/notes/*.md` describe how the v3 prototype
was built; v4 keeps that code and changes what is listed here.

## 1. What the product is

- **Orbique owns the platform** and sells subscriptions to **operators** (companies that manage short-term-rental units).
  Each operator is a separate, private **workspace** (its own units, bookings, staff, logo and colours).
  The first subscriber is the owner's own unit-management company. Orbique staff run a **platform admin** area
  (add operators, set plan, pause) that shows counts only, never an operator's guests or money.
- Market: Malaysia. Money in RM. Time zone Malaysia (UTC+8). Guests come from Airbnb, Booking.com, Agoda, Vrbo and direct.
- Three ways to use it, all from the same code: **desktop**, **phone** (same app, phone layout with a bottom tab bar,
  installable from the browser), and the **guest app** (one link per booking, no sign-in).
- Real connections to Airbnb, Booking.com, Agoda, WhatsApp, payment gateways and smart locks need partner approval and stay
  **simulated**: the app records what would be sent and shows it, but nothing leaves the app. Say "simulated" nowhere in the UI
  except where a person could think something was really sent (keep v3's wording).

## 2. How the code is put together

```
app/shell.html        page skeleton (sidebar, top bar, tab bar, guest root)
app/data.js           demo data, generated deterministically (D = O.data, d = O.d date helpers, M = O.metrics)
app/core.js           runtime: helpers, UI kit, charts, PDF/CSV, permissions, sync, clock, router, boot
app/core.css          design tokens and shared components
app/pages/<id>.js     one section each: O.page('<id>', {desc, render(root, ctx)})
app/pages/<id>.css    optional extra CSS for a page
app/server/*.js       production only: sign-in, workspaces, Supabase adapter, platform admin (not in local builds)
scripts/build.mjs     node scripts/build.mjs --local --out /tmp/<you>/o.html   (single file for testing)
tests/shot.py         screenshot + JS error check (see its docstring)
supabase/migrations   database schema (production)
api/                  Vercel serverless functions (production; need the service-role key)
```

### Hard rules for every section builder

1. **Edit only the files you own** (listed in your brief). Never edit `app/core.js`, `app/core.css`, `app/data.js`,
   `app/shell.html` or another builder's page. If you need something from core, write a local helper in your page and say
   so in your notes file (`docs/notes/v4-<your-area>.md`); the integrator moves it into core later.
2. **Data**: change `D.<collection>` **in place** (push, splice, edit fields) and then call `O.emit('data')`. The sync layer
   notices and saves the change for the whole team. **Never** reassign a registered array (`D.tasks = [...]` is a bug: other
   pages and metrics hold the original array). New collections are registered at module load with
   `O.sync.records('key', 'demo'|'config')` (array of objects with `id`) or `O.sync.blob('key', 'demo'|'config')`
   (any JSON value). `demo` = demo content a fresh workspace starts without; `config` = defaults a fresh workspace keeps.
   Create the collection at module load too (`D.key = D.key || [...]`).
3. **New records** get ids from `O.uid('XX')` (unique across devices), never `max + 1`. New bookings go through
   `O.bookingDefaults(b)` before you push them (door code + guest link token). After changing properties call `O.reindex()`.
4. **Dates**: the app runs on the real Malaysia clock. Read `D.TODAY`, `D.NOW`, `D.NOW_TIME` **inside functions at render
   time**; never cache them at module load (`var T = D.TODAY` at the top of a module goes stale and is wrong after the
   demo is shifted). The demo is shifted so its "today" (`D.STORY`) lands on the day the workspace loaded it.
   Never write a date literal like `'2026-10-05'` in page code: derive from `D.TODAY` / `D.STORY` (`d.add(D.STORY, -1)`),
   or wrap a demo literal as `D.sd('2026-10-05T16:20')` (evaluated at render time). Seed records you put into `D` at module
   load may use literals: the boot shift moves every date string inside `D`.
   Test with `--now 2026-10-06T10:15` (the demo's own day, the default) **and** `--now 2026-10-21T15:40` (two weeks later):
   nothing may break, show negative ages, or show stale "today" content.
5. **Empty workspaces**: a new operator starts with **no properties, bookings, tasks, reviews, expenses or staff except the
   owner**. Every page must render a helpful empty state (one sentence + the main action button) and never throw on empty
   arrays, missing properties (`D.propById[x]` can be undefined for old records), zero denominators or `null` metrics.
   Test with `--js "O.sync.registered(); Object.keys(O.sync.registered()).forEach(k => { const r = O.sync.registered()[k]; if (r.kind === 'demo') { if (Array.isArray(O.data[k])) O.data[k].length = 0; else if (O.data[k] && typeof O.data[k] === 'object') Object.keys(O.data[k]).forEach(x => delete O.data[k][x]); } }); O.data.staff.push({id:'u1',name:'Test Owner',role:'owner',roleLabel:'Account owner'}); O.state.viewer='u1'; O.reindex(); O.emit('data')"`
   (that empties the workspace the way the server does).
6. **Permissions** come from the catalogue `O.PERMS` in core.js. Check with `O.can('<section>')` (view),
   `O.can('<section>', 'edit')`, and `O.can('<section>.<action>')` for each action listed there. Hide or disable controls the
   viewer cannot use, with a short reason on hover. Use the new keys (`tasks.assign`, `bookings.contacts`, `guestapp.doorCodes`
   ...); the old v3 names still work as aliases but do not add new uses of them. Mask guest phone/email unless
   `O.can('bookings.contacts')`; hide money unless the relevant `.money`/`.value` action is allowed.
7. **Phone**: every page must work at **390 × 844** with no sideways scroll (tests/shot.py warns), tap targets ≥ 40px,
   the bottom tab bar visible, nothing hidden behind it (core adds bottom padding to `.content`). Also check **844 × 390**
   (phone landscape) for calendar-like views.
8. **No** `window.open`, `alert`, `confirm`, `prompt`, `print()`, iframes or `<a download>`. Use `U.modal`, `U.confirm`,
   `U.toast`, `O.download`/`O.downloadCSV`/`O.pdf`.
9. **Cleaner interface** is the v4 theme: fewer numbers per screen, more space, one clear primary action per screen,
   in-depth analysis lives in **Statistics** (and Reports), not on operational pages. Keep the existing design tokens and
   components (`.card`, `.kpis`, `.pill`, `.btn`, `U.*`, `O.chart.*`) so everything looks like one product.
   Charts follow the dataviz rules already in core: current period in brand colour, comparisons in grey, one axis.
10. Text in the UI: plain English, sentence case, no em dashes in new copy, no "simulated"/"demo" jargon in operational screens.
11. When you finish, run `node scripts/build.mjs --local --out /tmp/<you>/o.html` and screenshot your pages: desktop 1440 × 900,
    phone 390 × 844 (`--phone`), the later date, the empty workspace, and at least two roles (`--viewer s5` housekeeper,
    `--viewer s4` front desk, `--viewer s7` accountant, `--viewer s6` maintenance). **Look at every screenshot** (Read the png)
    and fix what looks wrong. Zero JS errors. Then write `docs/notes/v4-<your-area>.md`: what you built, decisions, anything
    you needed from core, and anything you could not finish.

### Core APIs you can use (all in app/core.js)

- `O.can(key, level?)`, `O.PERMS`, `O.permInfo(key)`, `O.sectionLevel(staffId, section)`, `O.ROLES`, `D.rolePerms`, `D.staffMeta`
- `O.sync.records/blob/registered/flush/status`, `O.reindex()`, `O.uid(prefix)`, `O.bookingDefaults(b)`
- `O.clock` (`D.TODAY`, `D.NOW`, `D.NOW_TIME` kept current; events `'tick'` every minute, `'day'` at midnight)
- `O.automation.register(name, fn)` — background jobs run after load, on each new day and on demand. Must be idempotent and
  use deterministic ids so two devices never create duplicates. Only mutate D; core saves.
- `O.checklist.template(id) / byKind('checkout'|'checkin'|'daily') / items(task) / progress(task) / forType(type, title)`
- `O.voice.speak(text, {onend, onpart}) / stop() / available() / speaking()` — read-aloud
- `O.guestLink(booking)` (the link a guest opens), `O.guestToken()`, `O.guestApi` (see guest app)
- `O.notifiers.push(fn)` — add items to the bell: fn returns `[{icon, tone:'bad'|'warn'|'', t, s, go:[page, params]}]`
- `O.EXTRA_PAGES[id] = {allowed: fn}` — a page outside the menu (used by the platform admin page)
- `O.resetTestData()` — local copy back to the demo (server mode is handled by auth.js)
- Everything from v3: `O.fmt.*`, `U.modal/drawer/confirm/toast/dateRange/preset/kpis/avatar/locked/empty/mount`,
  `O.chart.line/bars/spark/hbars`, `O.download/downloadCSV/csv/pdf`, `O.booking.open(id)`, `O.invoice.*`, `O.lock.change`,
  `O.readiness(b)`, `O.prop(id)`, `O.tasksFor(pid, day)`, `M.*` metrics (now `M.expenses(from, to, cls)` and
  `M.expenseTotal(from, to, cls)` take `'opex'|'capex'`).

### Data added in v4 (app/data.js)

- `D.invItems` (33 items: `{id, name, cat, unit, cost, reorder, use:[perStay, perNight, perGuest], active}`), `D.invCats`,
  `D.itemById`, `D.invMoves` (`{id, date, at, dir:'in'|'out'|'adjust', kind:'purchase'|'turnover'|'repair'|'count', lines:[{itemId, qty}], propertyId?, usedBy?, bookingId?, supplier?, cost?, note, by}`;
  `adjust` lines carry signed qty). Opening count on the day before the data starts. Units hv2 (toilet paper), kls (coffee
  capsules) and bgf (drinking water) use clearly more in the last 30 days.
- `D.checklists`: `CL-checkout` (14 items), `CL-checkin` (10), `CL-daily` (8); items `{id, text}`. Tasks now carry
  `checklistId` + `checks` (array of done item ids) or `customChecklist` + `checks`. The old `task.checklist = [done, total]`
  is gone: use `O.checklist.progress(t)`.
- `expense.costClass = 'opex'|'capex'` (`D.capexTypes` lists types that default to capex; the AC unit deposit is capex).
- `booking.guestToken` (guest link), `booking.doorCode`.

## 3. What Arnob asked for (2026-10-10), per area

**Menu** (done in core): Overview (Dashboard, Bookings, Calendar, Reviews) · Operate (Guest Inbox, Tasks & Cleaning) ·
Insights (Statistics, Reports) · Finance (Invoices & Receipts, Expenses, Financials; "Money" renamed) · Grow (Website
Builder, Guest App) · Manage (Properties, Inventory, Pricing, Automations, Owner Portal, Staff Access, Brand & Setup).
Translucent scrollbars are done in core.css.

**Statistics (new page `statistics`)** — "a statistics tab where we can have all the in-depth analysis". Takes the deep
analytics that leave the Dashboard (month-to-date vs the same days of the previous two months, revenue and occupancy charts,
the metric table), the Bookings KPIs (Revenue, ADR, Occupancy, average stay, lead time), the review stats that leave Reviews
(rating trend, by platform, sub-scores, response rate/time), and the invoice stats that leave Invoices (sent, paid, overdue,
collection time). Add booking-channel mix, cancellations, guest countries, operations (tasks done on time, turnover
time) and an opex vs capex view when allowed. Organise it in a few clear tabs with a date range picker and a property filter.
Money figures only with `statistics.money`. CSV export with `statistics.export`.

**Dashboard** — "a glimpse of the whole scenario as concisely as possible... immediately important things only". Keep:
today's arrivals and departures with readiness, same-day bookings, who is in-house, today's open and overdue tasks,
unread guest messages, reviews needing a reply, inventory alerts (low stock and overuse, via `O.inventory`), and one short
money line (this month so far vs last month at the same point) only with `dashboard.money`. Everything else moves to
Statistics (link to it). **Read aloud like Jarvis**: a prominent "Brief me" button that speaks a natural summary of exactly
what the dashboard shows ("Good morning, Mei Fen. It's Monday the 12th, 9:30. Five guests arrive today..."), shows the
text being read with the current sentence highlighted, and a Stop button; stops when leaving the page (`ctx.onLeave`);
respects permissions (no money unless allowed); graceful message where speech is unavailable. Phone first: the brief
button must be easy to reach on a phone.

**Bookings** — remove the Revenue, ADR, Occupancy, average stay and lead time figures (now in Statistics). Cleaner, only the
required info. Show the **property name and location** (e.g. "Bayfront Loft 3B · Gurney Drive, Penang"), never the unit type
("2BR loft"). **Narrower rows** so more bookings fit (compact density, about 44px desktop rows; phone uses compact cards).
Keep grouping by property, date range picker, filters, search, the booking drawer, add booking (`bookings.create`), edit,
cancel, copy guest-app link (`O.guestLink`), CSV (`bookings.export`).

**Calendar** — cleaner. Default window = **today plus the next 6 days (7 days)**, step back/forward by 7 days or pick any
start date ("any 7-day interval"). Same 7 days in portrait and landscape on phones. **Remove the local events** row and
anything event-related. Check how many days are comfortable on a phone and put the finding in your notes (current
estimate: 7 days in portrait at 390px is ~43px per day: enough for a coloured bar with platform mark and guest initials,
not full names; landscape fits 14). Desktop may offer 7 / 14 / 30 days. Keep booking bars coloured by status with the
platform mark, blocks, tap a bar to open the booking, block dates with `calendar.block`.

**Reviews** — remove the stats from the top; keep only **Average rating** and **Needs reply**. Keep filters and replying.

**Guest inbox** — add a **property filter** (all properties or one) to the conversation list, desktop and phone.

**Tasks & cleaning** — "set checklists for check-in and check-out turnovers and also daily housekeeping". A Checklists tab
to view and edit the three templates (`tasks.checklists`); tasks show and tick their template items (photo note optional);
auto-created tasks via `O.automation.register`: a check-out turnover task for every departure (today + next 2 days), a
check-in readiness task for every arrival (today + tomorrow) and a daily housekeeping task for in-house stays of 3+ nights,
each with the right template, deterministic ids (`TO-<bookingId>`, `CI-<bookingId>`, `DH-<bookingId>-<date>`), the
property's housekeeper as assignee, and no duplicates of an existing task of the same type, unit and day. Settings for which
of these run live in a config blob `taskAutomation`. People without `tasks.others` see only their own tasks.

**Pricing and Automations** — moved under Manage (done in core). Update their permission checks to the new keys
(`pricing.change`, `pricing.rules`, `automations.toggle`, `automations.edit`) and remove date literals.

**Invoices & receipts** — remove the statistics strip; only **Awaiting payment** stays ("fine tune if you want to").

**Expenses** — identify **capex vs opex**: a required Cost type field (Operating expense / Capital expense) suggested
from the expense type with a one-line explanation, a filter, split totals, CSV column. **Financials** shows opex in the
profit and loss and capital spending separately (below operating profit and in cash flow).

**Inventory (new page `inventory`, under Manage)** — "a drop down of all possible lists, inventory in, inventory out, used
by and also used for which unit". Item picker grouped by category (searchable), **Stock in** (purchase: items + qty,
supplier, total cost, date), **Stock out** (items + qty, **used by** staff member, **for which unit**, optional booking,
date, note), **Adjust/count**, current stock with reorder alerts, movement log with filters (unit, item, person, in/out,
date range), and the **overuse warning**: for each unit and item compare use in the last 30 days with the average of the
previous three 30-day periods. Arnob's rule is "more than the average of the last three months"; a literal rule flags
about half of all unit/item pairs because stays vary, so the default compares **use per stay** with a **40% margin**
(settings blob `inventorySettings`: basis `'stay'|'total'`, threshold, minimum quantity) and the settings let the owner switch
to total use and 0% to match the literal rule. Each warning explains itself ("Highland Villa 2 used 5.7 toilet rolls per
stay in the last 30 days vs 3.2 on average over the previous three months"). Expose shared helpers at module load:
`O.inventory = {stock(), low(), overuse(opts), usage(from, to, {propertyId}), itemName(id)}` for the dashboard and reports,
and push overuse/low-stock items to `O.notifiers`. Permissions `inventory.in/out/adjust/items`. Housekeepers mostly
record stock out on the phone: make that flow fast (pick unit, tick items, qty steppers).

**Reports** — **group reports by type** (Financial, Bookings & occupancy, Guests & reviews, Operations, Owners, Inventory)
and add an **inventory report**: which unit used which products most (unit × item, quantities and cost, top items per
unit, date range), CSV and PDF.

**Website builder** — "improve the template selection... more wholesome and presentable options". Rework the template
gallery into polished, complete, distinct designs (at least 8) with real-looking previews, good typography and spacing,
brand colours applied, property photos when present (`property.photos`) and tasteful illustrated placeholders otherwise.

**Staff access** — "much more detailed with options to toggle different options on and off within each feature and also
toggle on/off total sections". Per role: every section from `O.PERMS` with a master on/off switch and View/Edit level, and
inside each section a switch per action (from the catalogue), greyed when the section level does not allow it, owner-only
items locked with a reason. Per person: the same controls as overrides on top of their role, with "reset to role".
Invite people (server mode: `O.auth.invite`), suspend, audit log, and "preview as this person". Data: `D.rolePerms[role] =
{sections: {...}, actions: {'bookings.create': true, ...}}`, `D.staffMeta[id].overrides = {'section:inbox': 'none', 'tasks.assign': false}`.

**Properties (new page `properties`, under Manage)** — the operator's units: add, edit, archive, with name, short name,
location/area and address, type, bedrooms, base nightly price, owner, housekeeper, check-in/out times, lock brand and
master code + Wi-Fi + parking (shown only with `properties.access`), and up to 4 photos (compress in the browser to ≤150 KB
each, stored as data URLs in `property.photos`). Empty state invites "Add your first property". New property ids from
`O.uid('P')`; call `O.reindex()`.

**Brand & setup** — keep the logo/colour flow (it now saves via `O.saveBrand`, shared with the whole workspace). Add a
"Workspace data" card for owners (`brand.data`): local copy → "Reset to demo data" (`O.resetTestData()`); server mode →
the buttons `O.auth.loadDemo()`, `O.auth.startEmpty()`, `O.auth.resetWorkspace()` when `O.auth` provides them.

**Guest app** — a standalone guest experience opened from the booking's link (`#guest-<token>` locally,
`/guest/<token>` in production). `O.guestMode(rootEl, token)` renders the whole guest app full screen (phone first, also
good on desktop) with the operator's branding. In guest mode the page must get all data through **`O.guestApi`**
(`get(token) -> Promise<payload>`, `act(token, action, args) -> Promise<result>`), never `D` directly, because in production
guests are not signed in and only the server can read the booking. guestapp.js defines the local `O.guestApi` (reads and
changes `D`, emits `'data'`) and documents the payload and every action in `docs/notes/v4-guestapp.md`; the same builder
writes the matching database functions `guest_get(p_token text)` and `guest_act(p_token text, p_action text, p_args jsonb)`
in `supabase/migrations/0003_guest.sql` against the tables in section 4. The staff-side Guest App page gains "Open guest
app" and "Copy guest link" per booking.

## 4. Server contract (production)

Supabase (Postgres + Auth + Realtime), hosted app on Vercel. The browser uses the public key; RLS enforces access. The
service-role key lives only in Vercel environment variables and is used only by `api/*.js`.

Tables (schema `public`):

```sql
orgs (id uuid pk default gen_random_uuid(), name text not null, plan text not null default 'trial',
      status text not null default 'active' check (status in ('active','paused')), created_at timestamptz default now(), created_by uuid)
members (org_id uuid references orgs on delete cascade, user_id uuid references auth.users on delete cascade,
         staff_id text not null, role text not null, status text not null default 'active', invited_by uuid,
         created_at timestamptz default now(), primary key (org_id, user_id), unique (org_id, staff_id))
platform_admins (user_id uuid primary key references auth.users on delete cascade, created_at timestamptz default now())
subscription_requests (id uuid pk default gen_random_uuid(), user_id uuid default auth.uid(), company text, contact_name text,
         phone text, units int, message text, status text not null default 'new', created_at timestamptz default now())
records (org_id uuid references orgs on delete cascade, coll text not null, id text not null, data jsonb not null,
         deleted boolean not null default false, updated_at timestamptz not null default now(), updated_by uuid default auth.uid(),
         primary key (org_id, coll, id))            -- one row per record of a records collection (bookings, tasks...)
blobs (org_id uuid references orgs on delete cascade, key text not null, data jsonb not null,
       updated_at timestamptz not null default now(), updated_by uuid default auth.uid(), primary key (org_id, key))
index: records ((data->>'guestToken')) where coll = 'bookings'
```

- `records.data` is exactly the JS object (e.g. a booking); `blobs.data` is the JSON value **wrapped** as `{"v": <value>}`
  (blob values can be arrays). Deleted records stay as `deleted = true` rows (`data` = `{}`).
- Workspace metadata blob `workspaceMeta` = `{"v": {storyDate, demo: bool, startedAt}}`; brand blob `workspaceBrand`.
- Realtime: `records` and `blobs` are in the `supabase_realtime` publication (replica identity full).
- RLS: members read their org's rows; active members of an active org write; blobs `rolePerms` and `staffMeta` and
  records in coll `staff` are written only by members with role `owner` (the API also writes them). Paused org = read only.
  Platform admins read `orgs`, counts, `members` (no records or blobs). Guests have no table access at all.
- RPCs (security definer): `my_context()`, `platform_overview()`, `set_org_status(org, status)`, `set_org_plan(org, plan)`,
  `reset_org(org)` (owner), `guest_get(p_token)`, `guest_act(p_token, p_action, p_args)` (granted to `anon`).
- API (Vercel functions, Node 20, `export default async function handler(req, res)`):
  `GET /api/health`, `POST /api/account` with `{action: 'bootstrap'|'signup'|'create-operator'|'invite'|'reset-password', ...}`.
  The first platform owner is created by `bootstrap` only when no platform admin exists **and** the email's SHA-256 is in
  `config/platform-owners.json` (or in env `PLATFORM_OWNER_EMAILS`). Accounts are created already confirmed with a temporary
  password that the inviter shares (WhatsApp), so the app works without an email provider; users change it at first sign-in.
