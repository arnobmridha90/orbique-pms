# v4 server-app: notes

Owner: server-app engineer. Files: `app/server/auth.js`, `app/server/platform.js`, `app/server/server.css`,
`supabase/migrations/0004_app.sql`, `tests/e2e_server.py`, this note. Nothing else was edited.

## What I built

### `app/server/auth.js` (production builds only; `O.auth` per docs/API.md)
- `O.auth.enabled()` is true when `ORBIQUE_CONFIG` has `supabaseUrl` + `supabaseKey` and `window.supabase` loaded.
  When false the file stops after defining it, so a misconfigured production build behaves like the local copy.
- `O.auth.gate()` resolves `{mode: 'server', viewer, storyDate}` or `{stop: true}` while it shows its own screen.
  Screens (Orbique brand, phone first, 46px fields at 16px so iOS does not zoom, `#auth-root`, `html.auth-mode`):
  - **Sign in**, with "Forgot your password? Ask your workspace owner to reset it" and "New operator? Request access".
  - **Request access** (company, name, email, WhatsApp number, units, message) -> `/api/account` `signup`.
  - **Set up Orbique** when `/api/health` says `needsBootstrap` -> `bootstrap`, then signs in.
  - **Choose your password** when `user_metadata.must_change_password` -> `updateUser({password, data: {must_change_password: false}})`.
  - **Choose a workspace** when the person is in several (plus "Orbique / Platform admin" for platform admins). The
    choice is remembered per user on the device (`srv:ws:<userId>`); a remembered choice that is gone falls back to the picker.
  - **Onboarding** for an owner whose workspace has no `workspaceMeta`: "Load demo data" or "Start empty". Anyone
    else sees "Your workspace owner is still setting things up" (Check again / Sign out).
  - **Paused workspace**: opens read-only with a banner. A paused workspace that was never set up shows a message instead of onboarding.
  - **Suspended member**: "Your access is paused" with Sign out. Connection failures: "Orbique cannot connect right now" with Try again.
- Context from `my_context()`; workspaces become `O.workspaces[orgId]` entries (name, role label, logo/brand from the
  `workspaceBrand` blob, else a monogram on a colour picked from the org id). The local demo workspaces are removed.
- **Server adapter** (`O.sync.use` before the gate resolves, `replace: true`):
  - `load()`: records (`deleted = false`) and blobs, 1000 rows per page; blobs unwrapped from `{"v": value}`;
    `readOnly` when the org is paused or the member is not active. If the viewer's own staff record is missing it is
    synthesised (the core would otherwise fall back to `D.staff[0]`), and its role follows `members.role`.
  - `write()`: upserts in chunks of 500 (records first, then blobs); deleted rows as `data {}`, `deleted: true`; blobs
    wrapped. On a permission error it checks the org and member: paused or access removed -> `{readOnly: true}` and a
    banner ("is paused" / "Your access has changed. Reload"); otherwise the chunk is retried row by row and refused rows
    are returned as `{rejected}`. Refused rows are put back to the server's copy (or the copy loaded at start, or
    removed when the server never had them) so the screen shows the truth. Only network/server errors reject.
  - `subscribe()`: Realtime `postgres_changes` on `records` and `blobs` filtered by `org_id`, batched every 120 ms.
    Own echoes are dropped by remembering what this device sent (`coll+id` -> canonical JSON, noted *before* the
    request, because the echo can beat the HTTP answer). After a reconnect, or when the tab comes back after 20 s
    hidden, it fetches rows changed since the last seen `updated_at`. A `workspaceMeta` change from elsewhere (reset,
    demo loaded again) reloads with a toast. A sign-out elsewhere returns to the sign-in screen.
- **Demo data**: `loadDemo()` writes `workspaceMeta {storyDate: today in Malaysia, demo: true, seedPending: true}` and
  reloads. On boot the owner's device runs the `orbique-demo-seed` job: restores the captured demo (`O.sync._demo`) in
  place, shifts it by `D.SHIFT`, maps the demo owner `s1` to the real owner's staff id everywhere (values and keys),
  gives every booking a new random guest token (`g` + 16 chars from `crypto.getRandomValues`) and replaces the old
  tokens elsewhere, keeps the real staff records, reindexes, `rollStatuses()`, sets `seedPending: false`, emits data,
  and shows "Loading demo data..." with a progress bar until the writes are done (~1,100 rows, 3 to 4 s locally).
  `startEmpty()`, `resetWorkspace()` (U.confirm, `reset_org`, reload) as specified; loading demo data over a started
  workspace asks first and resets it.
- **Members**: `invite`, `setMemberStatus`, `setMemberRole` (also update the app's staff record / `staffMeta`),
  `resetPassword`, `previewAs` (banner "Previewing as <name> (role). Changes you make are saved as you." with Stop),
  `isPlatformAdmin`, `user`, `orgId`, `role`, `staffId`, `readOnly`, `isPreviewing`, `workspaceMeta`, `signOut`,
  `changePassword`, `api(action, body)`, `supabase()`.
  `setMemberStatus`/`setMemberRole` resolve `true` when the sign-in was updated and `false` when the person has no
  sign-in in this workspace (nothing to update; the Staff page then shows no error).
- **Guest API**: `O.guestApi.get(token)` -> `rpc guest_get {p_token}`, `act(token, action, args)` -> `rpc guest_act
  {p_token, p_action, p_args}`, through a separate client with no session, payload returned unchanged.
- **Shell hooks**: workspace switcher (`O.workspaceList`, "Add an operator" for platform admins), viewer menu (signed-in
  person, Preview as... for owners, Change password, Sign out), `O.viewerNote`, `O.navExtras` (Platform admin link).
  The plan pill under the viewer is shown to owners only. Locked sections say "You are signed in as X (role)" instead
  of the local copy's "Switch the viewer at the bottom of the menu" (wraps `U.locked`).

### `app/server/platform.js`
`O.page('platform')` + `O.EXTRA_PAGES.platform`: KPIs (operators, units, bookings, new requests), Operators tab
(search, All/Active/Paused, table on desktop and cards on phones: name, owner, plan, status, members, units,
bookings, created, last activity), Manage (change plan, pause/resume with confirm, reset an owner's password),
Add operator (`create-operator`, then a credentials sheet with Copy buttons and a ready-to-send message), Access
requests tab (New/Handled/All; Set up operator prefills the form, Mark handled, Decline, Move back to new). A platform
admin with no workspace lands here. Counts only: no guest or money data.

### `supabase/migrations/0004_app.sql` (applied; recorded in `public._migrations`)
- `platform_operators()`: security definer, platform admins only, one JSON row per org with the counts above, owners
  (staff id, email, name, status) and how far it is set up (`none` / `demo` / `live`). Execute revoked from public and anon.
  platform.js falls back to `platform_overview()` when the function is missing.
- **Column limits (security fix)**: 0001 grants `UPDATE` on whole rows of `orgs` and `members`, so an owner could
  change their own plan and **resume a workspace Orbique paused** through the REST API (verified). Now
  `authenticated` may update only `orgs.name` and `members.role, status`. Plan and status change only through
  `set_org_plan` / `set_org_status`; member identity only through `/api/account`.

## Test results (`tests/e2e_server.py`, local stack, production build through `scripts/dev.mjs`)
```
SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... DATABASE_URL=... python3 tests/e2e_server.py --out /tmp/e2e
```
All 15 steps pass (three runs in a row), 0 JavaScript errors. Covered: Set up Orbique (health intercepted);
request access; admin signs in, sees the request, creates operator A from it (credentials sheet); owner A first
sign-in, temporary password, onboarding, demo data (1,112 rows / 417 bookings in the database, real owner id,
unique guest tokens); realtime both ways between two browsers (about 1 s, no stale echo); workspace switcher, viewer
menu, preview as housekeeper; invited housekeeper sees only allowed sections, an allowed task write is saved, a
forbidden staff + rolePerms write is refused, reported in a toast, put back on screen and unchanged in the database;
admin pauses A (open tab turns view only, reload opens read-only with the banner, nothing written), resumes, changes
the plan; operator B starts empty and renders; isolation both ways (no reads of records/blobs/orgs/members, inserts
and `reset_org` refused with 42501) and an owner cannot change plan/status or a member's identity in their own
workspace; owner role changes; picker for a person in two workspaces, switch from the menu, choice remembered;
admin resets an owner's password and the owner must choose a new one; suspended member message; "still setting
things up" and "cannot connect" screens; guest link `/guest/<token>` of an in-house guest opens the guest app with no
session (0003 `guest_get`), a message sent by the guest (`guest_act`) reaches the owner's open app through Realtime,
and a wrong token shows nothing; sign out.
Screenshots (desktop 1440x900 and phone 390x844) of every screen, all reviewed. Local build: `tests/sweep.py`
desktop/phone/housekeeper, 0 problems (auth.js and platform.js are not in local builds; server.css uses only its own classes).

## Decisions
- One Supabase client for staff (`storageKey: orbique-auth`) and a session-less one for guests, so a guest link on a
  staff phone never acts as the staff member, and the guest page never needs a session.
- Seeding runs on the owner's device (no service-side seeding); other members see the rows arrive through Realtime.
  `seedPending` survives a reload mid-seed: the job runs again on the next open and upserts are idempotent.
- The platform admin area is the `orbique` workspace key with no sections in `O.NAV`; the sync pill, tab bar, lock
  and bell are hidden there (`html.orb-platform`).
- Plan names (Trial, Starter, Growth, Pro) live in platform.js; unknown plans in the database still display.

## Needs from others
- **Guest app engineer**: 0003 works with the server guest API as is. It is in the local database but not recorded in
  `public._migrations` (applied by hand), so the next `node scripts/migrate.mjs` will run it again (it is re-runnable).
  The test applies 0003 itself (node + pg) only when `guest_get` is missing and `DATABASE_URL` is set.
- **Core**:
  - `O.bookingDefaults` makes guest tokens from a timestamp plus 4 base36 characters. In production that is guessable;
    please use `crypto.getRandomValues` (as the seed job does). The built-in demo tokens are the same in every
    workspace, which is why the seed job replaces them.
  - In server mode the boot shifts only synced collections. Static data that is not a collection (for example local
    events, comp sets) stays on the original story dates.
  - Demo statuses are written for the story's time of day; opened at 5 AM, today's 10 AM check-outs already show
    "Checked out". `rollStatuses()` could take the clock time into account.
  - `U.locked` could take a hook for the viewer line (auth.js wraps it today).
  - The workspace menu clips the check mark for long names ("Bukit Homes (S2 test)").
- **Lead / 0001**: `members_owner_update` lets an owner demote a co-owner (new role must not be owner, which passes).
  Fine if intended. 0001 revokes its functions from `anon` but not `public` (0004 revokes from both for its own function).
