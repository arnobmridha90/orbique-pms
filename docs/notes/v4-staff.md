# v4 Staff Access (staff)

Files: `app/pages/staff.js` (rewritten), `app/pages/staff.css` (new; the page no longer injects CSS with `O.css`).

## What it does

Four tabs, one primary action ("Add person", shown to people with `staff.invite`).

- **People**: everyone on the team (owner first, then by role), role, personal-change count, properties, last active,
  status (Active / Invited / Suspended). Removed people sit behind "Show N former team members". Select a row to open
  the **person drawer**. Phone: one card row per person (name, job title and properties, personal-change note), no
  sideways scroll. Empty workspace: only the owner plus one sentence and an "Add person" button.
- **Roles & access**: pick a role (left list on desktop, wrapping chips on phone). Every section from `O.PERMS` in
  catalogue order, each with a master on/off switch and a View / Edit level (greyed while off). Expand a section (or
  "Show all actions") to get one switch per action with its catalogue description. Actions are greyed with a reason when
  the section is off or the level does not allow them ('do' actions need Edit): tag "Needs Edit", or "On with Edit"
  when the stored value is on, so nothing looks on that is not. Owner-only items (Financials, `expenses.approve`,
  `owner.payouts`, `staff.roles`, `brand.data`) are locked with a one-line reason. People whose personal change differs
  from the role are named under the item ("Kavya: on (personal change)"). Header shows people with the role, a one-line
  summary ("Opens 9 of 19 sections with 7 actions on · 2 settings changed from the default"), an "Edited" tag on changed
  roles and **Reset role to default** (confirm). The Account owner role shows what only owners can do; it cannot be limited.
  Phone: the matrix is stacked section cards: name + switch on the first row, a full-width View / Edit control
  (40px targets) on the second, actions below.
- **Invites**: people added who have not signed in yet (and the seeded legacy invite). Share again (copy the message),
  New password / Try again in server mode, Withdraw (confirm; takes the person off the team and suspends the sign-in).
- **Activity**: the audit log: `D.auditLog` plus door codes (`D.lockLog`), documents sent (`D.sentLog`), tasks done
  and review replies in the last 7 days. Day headers, filters (person: by or about them, type, search), CSV.

**Person drawer** (`U.drawer`, tabs Profile / Access / Activity, footer "Preview as <name>" + Done):
- Profile: role (confirm; job title becomes the new role's name), job title, mobile, email, properties they work on
  (Save details), Account card with Suspend / Reactivate, Create sign-in and New password (server only), Remove from team
  (confirm; unassigns open tasks, sets `staffMeta.removed`, `status: 'suspended'` and `staff.status = 'left'` so core's
  viewer menu hides them), Bring back. You cannot suspend or remove yourself or an owner.
- Access: the same section/action list as the role page, but as overrides on top of the role. Rows that differ are
  marked (gold bar) with "Changed for Siti. The role has it off. **Use the role**". "Reset to role" removes all overrides.
  A change that equals the role value deletes the override instead of storing it, so overrides only hold real differences.
- Activity: entries by or about the person.
- Read-only (anyone without `staff.roles`): plain values, level pills, no switches, no account buttons, no preview.

## Data and permission model (not forked)

- Reads/writes only `D.rolePerms[role].sections/actions` and `D.staffMeta[id].overrides` (`'section:x'` levels,
  `'sec.action'` booleans), mutated in place, then `O.emit('data')`. Every change unshifts an entry into `D.auditLog`
  `{at, by, cat:'access', text, staffId?, role?}` (`staffId`/`role` let the drawer and filters find entries about someone).
- Effective values shown in the UI mirror `O.can` (owner-only never; 'do' needs Edit, 'see' needs View; overrides win).
  Checked against `O.can` for s3/s5 after changes.
- Who can change what: `O.can('staff.roles')` (owner-only in the catalogue) for all access/people management;
  `O.can('staff.invite')` for Add person, and in server mode also `O.isOwner()` (the invite API and RLS on `staffMeta`
  are owner-only). Ops sees the page read-only by default (staff = View); other roles get core's locked page.
- Module-load collections (seed literals are shifted by boot): `D.staffMeta` (status, since, scope, lastActive; Kavya
  has the override `tasks.assign: true`), `D.staffInvites` (one legacy invite), `D.auditLog` seeded only when empty.
  The v3 role default object and the `stampLogs` hack (which attributed log entries to whoever was viewing) are gone.
- New person (local): `D.staff.push({id: O.uid('S'), name, role, roleLabel, phone, email, initials})`, staffMeta entry,
  `D.staffInvites.push({id: O.uid('INV'), staffId, ...})`, audit, then a "Share the invite" modal with a ready-to-send
  message and Copy (nothing is sent from the app, so no "simulated" wording is needed).
- Server mode (`O.auth.enabled()`): Add person requires an email, pushes the staff record, emits, then
  `O.auth.invite({staffId, name, email, phone, role})` → modal with the temporary password (Copy password) and the
  message (Copy message). `existing: true` marks the invite accepted. Failure marks the invite "Account not created" with
  Try again. Suspend/reactivate/remove call `setMemberStatus`, role change calls `setMemberRole`, New password calls
  `resetPassword`, Preview calls `previewAs`. The app change is applied first (so `O.can` follows at once, also for demo
  staff who have no sign-in); if the server refuses, a toast says "Saved in the app, but their sign-in was not updated: …".
  Tested with a mocked `O.auth` (calls and arguments checked); matches `app/server/auth.js` as of today.
- Preview (local): `O.state.viewer = id`, `O.store.set('viewer', id)`, `O.emit('viewer')`, then go to their first tab.

## Verified

Desktop 1440×900, phone 390×844, `--now 2026-10-21T15:40`, empty workspace (all four tabs + drawer + add modal),
viewers s1, s2 (read-only), s4/s5/s6/s7 (core locked page). Turned off Inventory and "Create tasks" for Housekeeping as
owner, then as `--viewer s5` (with `--storage`): Inventory locked in the menu, no New task button, `O.can('inventory')`
false, Kavya's personal `tasks.assign` still true; then Reset role to default restored it. Person override, undo,
reset to role, suspend, reactivate, role change, add person, withdraw, preview, keyboard focus kept on the toggled control
after the re-render. Zero JS errors from staff.js.

## Requests for core

1. `O.copy(text, okMsg)`: clipboard with a fallback. staff.js has a local `copyText`; guestapp.js and owner.js roll their own.
2. Router: pages blocked by Staff Access show `U.locked`; the text reads "Your access does not include the staff Access"
   (`U.locked` lowercases the first letter of "Staff Access"). Consider keeping the page title's case.
3. Let everyone open Staff access read-only for **their own** access ("Your access" view), or add a small "Your access"
   entry in the viewer menu; today people without `staff` view see only the lock.
4. `U.staffOptions` and other people pickers should skip removed people (`staff.status === 'left'` or
   `staffMeta.removed`), like `viewerChoices` already does.
5. `staffMeta[id].lastActive` is never updated in v4. Server: stamp it from sign-in/activity (auth.js or a members
   column); staff.js must not write it because `staffMeta` is owner-only under RLS.
6. `staffMeta[id].scope` (properties a person works on) is not enforced anywhere. If wanted, add `O.staffScope(id)` in
   core and let Tasks/Calendar/Inventory filter by it.
7. `D.sentLog` entries written by invoices.js and guestapp.js have no `by`; Activity shows "A team member" for them.
8. Shift note: `D.auditLog` seed entries are added only when the log is empty at module load; if another page ever seeds
   `D.auditLog` at load, move all seeds into data.js.

## Other files at test time

`app/pages/guestapp.js` (another builder, in progress) had a syntax error ("Unexpected end of input"), which made every
shot.py run exit 1. I tested with a copy of the repo in `/tmp/staff/repo` where that one file was replaced by its v3
version (`/tmp/staff/b.sh`). No other errors.

## Left / ideas

- Custom roles (only the six roles in `O.ROLES` exist; the database checks the same list).
- Bulk "copy access from another role", and a per-section "differs from default" dot.
- Server: show whether each person already has a sign-in (needs a members list from auth.js).
