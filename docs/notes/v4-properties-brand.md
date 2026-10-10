# v4 Properties and Brand & Setup: notes

Owner: properties-brand engineer. Files: `app/pages/properties.js` (new), `app/pages/brand.js` (reworked). CSS is
inline through `O.css('properties', …)` and `O.css('brand', …)`, so there is no `properties.css`.

## Properties (`app/pages/properties.js`)

### What I built

- **List**: cards (default) or a compact table. The choice is remembered per device in `O.store` key `properties:view`,
  and phone always uses cards. There is a search box (name, short name, area, city, owner, housekeeper) and city chips
  when there are 2 or more cities. An Active/Archived switch appears once anything is archived.
  - Each card has a cover (the first photo, or an SVG placeholder of a tower, house or shophouse tinted with the
    property colour), name, area, type, housekeeper, nightly price and a status pill. The status is one of Guest in,
    Arrives today, Turnover today, Free tonight · next guest Thu, Owner stay, Blocked or Archived, computed from
    `D.TODAY`.
  - Missing setup (no lock code, Wi-Fi or housekeeper) shows as a warning line on the card.
- **Empty state**: "Add your first property", one sentence and the button (or a note for people who cannot create).
- **Drawer** (`U.drawer`), view mode:
  - Gallery and status.
  - Quick links: Bookings · N upcoming (`O.go('bookings',{propertyId})`), Calendar, Directions (from `mapUrl`, otherwise a
    Google Maps search of the address, as a plain `<a target=_blank>`).
  - Sections: Stay, Location, Access (code, Wi-Fi with a copy button, parking), and Team and owner.
- **Drawer, edit mode**: sections Basics, Location, Stay rules, Access, Photos and Owner and team.
  - Friendly inline validation with a red field and a message under it. Focus goes to the first problem and a toast
    says how many fields need a look.
  - Rules: name required and unique; short name 20 characters or fewer and unique; beds 0–30; price RM 20–50,000; city
    required; map link must be https; check-out earlier than check-in; guests 1–50; lock code 4–8 digits and not
    1111/1234; owner required; phone and email format.
  - Unsaved changes ask "Discard your changes?" on ×, the backdrop or Escape.
- **Photos**: up to 4. Each one is compressed on a canvas to a JPEG data URL of 150 KB or less: the first size and
  quality that fits from 1280–480 px and q 0.82–0.52, drawn on white so PNG transparency does not turn black.
  - Photos can be moved left or right and removed. The first photo is the cover.
  - Errors are friendly: not an image, over 40 MB, or cannot be read.
  - Tested: a 4000×3000 noisy image comes out at about 121 KB.
- **New property**: id `O.uid('P')`, pushed into `D.properties`, then `O.reindex()` and `O.emit('data')`.
  - Defaults: the first housekeeper, the most common lock brand, check-in 15:00 and check-out 11:00.
  - The short name is suggested from the name and keeps a trailing unit number ("Seri Bukit Residence 12A" becomes
    "Seri Bukit 12A").
  - Stamps `createdAt` and `createdBy`.
- **Archive instead of delete**: sets `archived:true`, `archivedAt` and `archivedBy`. The confirm warns how many upcoming
  bookings stay in place. Restore removes those fields. Both are written to `D.auditLog` (cat `properties`).
- **Master code change**: writes a `D.lockLog` entry `{at, propertyId, bookingId:null, by, what:'Master code changed', code}`
  and an audit line.
- **Deep links**: `O.go('properties',{propertyId})` opens that drawer, and `O.go('properties',{add:true})` opens the
  add form. The params are cleared after use.
- **Permissions**:
  - `properties.create` shows Add property.
  - `properties.edit` shows Edit details.
  - `properties.archive` shows Archive and Restore.
  - `properties.access` shows the lock code, Wi-Fi and parking, in both the view and the form. Without it they are
    hidden and keep their old values on save.
  - Prices show to `properties.edit` or `pricing` view. Owner contact shows to `properties.edit` or `owner` view.

### Record format (all v3 fields kept as they were)

- **v3 fields**: `id, name, short, type ('2BR loft' / 'Studio'), beds, area ('Hood, City'), base, owner (name string),
  housekeeper (staff id or null), lockCode, lockBrand, wifi [name, pw], parking`.
- **New optional fields**: `city, address, mapUrl, checkInTime, checkOutTime ('HH:MM'), maxGuests, notes, ownerPhone,
  ownerEmail, photos [jpeg data URL…], archived, archivedAt, archivedBy, createdAt, createdBy`.
- Empty optional fields are deleted rather than stored as `''`.

### Decisions and why

- **Owners stay a name string** on `p.owner`, because owner.js groups units by that name.
  - The picker lists existing owners ("Aisyah Rahman · 2 units"), "<workspace> (company owned)" and "Add a new owner…".
  - Owner phone and email are copied onto that owner's other units, so they stay in step.
- **`type` and `area` are composed** from kind and beds ("2BR condo", "Studio") and from hood and city ("Mont Kiara,
  Kuala Lumpur"). Every v3 reader (`D.rateFor`, the website, owner reports) keeps working.
- **Photos are plain data-URL strings in an array** with the first as the cover. They need no new store, and they sync
  with the record. website.js already reads `p.photos`.
- **Archived properties are kept in `D.properties`**, so history, reports, `propById` and `U.propColor` (which is
  index-based) do not change.

## Brand & Setup (`app/pages/brand.js`)

### What I built

- **Kept the v3 flow**: upload a logo, colours picked automatically, sidebar style, contrast check, and undo. Everything
  saves through `O.saveBrand`.
  - Big raster logos are now redrawn as PNG (512 down to 128 px) until they are under 170,000 characters, so they fit
    the 180 KB limit in `O.saveBrand`. The upload limit is 10 MB.
- **Business details** (brand name, legal name, registration number, phone, email, website, address):
  - Validated, then saved to `O.ws()` and to `D.workspaceBrand`, the same blob auth.js `entryFor` reads in server mode.
  - Audited, followed by `O.paintShell()`.
  - Read-only for people without `brand.edit`.
- **Workspace data card**, shown only with `brand.data` (owner):
  - **Local mode**: a "This device" pill and Reset to demo data (`U.confirm`, then `O.resetTestData()`).
  - **Server mode** (`O.auth.enabled()`): a state pill ("Demo data" / "Your own data, started empty on …", from
    `O.auth.workspaceMeta()` or `D.workspaceMeta`). It has one row each for `loadDemo`, `startEmpty` and
    `resetWorkspace`, shown when the function exists, each with a one-line explanation.
  - auth.js already confirms, toasts errors and reloads, so I call it directly to avoid a double confirm. The button shows
    "Working…" and comes back if the call returns false or fails.
- The "How your colours are used" tables are now a collapsible `<details>`.
- Sample logos and "Set up a new subscriber" (the wizard) show only in local mode, the wizard only for the owner.
- **Phone**: 16 px inputs, smaller logo stages, and the contrast table drops the ratio column at 560 px or less.

### Fixes to v3 bugs on this page

- **Click handlers piled up**: they were attached to the persistent `#page-root`, so every re-render added another and
  server actions fired twice. They are now on `.pg-brand`.
- **Duplicate swatches**: an older async swatch extraction could paint into a newer render. It is now guarded by a
  render token.
- **Business details lost on brand save**: `O.saveBrand` rebuilds `D.workspaceBrand` and dropped the details. A local
  `saveBrand()` wrapper copies them back.

## Testing

- Desktop 1440×900 and phone 390×844.
- `--now 2026-10-21T15:40`.
- The empty workspace (SPEC rule 5 snippet): properties shows "Add your first property" and brand renders fully.
- Roles:
  - Owner: everything.
  - s2 ops: no Archive.
  - s4 front desk: no Add button, sees prices.
  - s5 housekeeper and s6 maintenance: see access, no price or owner.
  - s7 accountant: the locked page.
- Flows:
  - Add with validation errors, then save. The record shape was checked in `D.properties`, and it persists in
    localStorage across reload.
  - Photos: add, reorder, remove.
  - Archive and restore, with the audit entries checked.
  - Master code change, which writes the lock log.
  - Discard guard, Escape, and both deep links.
  - Business details persist across reload and a later brand change.
  - A big PNG logo is shrunk to 155 KB.
  - The server buttons were tested with a mocked `O.auth`, and each function is called once.
- No JS errors from my files.
- **Another engineer's error**: every page logs `pageerror: Unexpected end of input`. It comes from
  `app/pages/guestapp.js`, which fails `node --check` (it was mid-edit by its owner at the time I tested).

## Requests for core (I did not edit core; local helpers are in place)

1. **`O.activeProperties()`** = `D.properties.filter(p => !p.archived)`. properties.js has a local `activeProps()`.
2. **`U.propOptions`** (core.js:478) should skip archived properties unless one is the `selected` value. Otherwise every
   picker that uses it offers archived units for new work.
3. **`M.availableNights`** (data.js:651) multiplies by `properties.length`, which counts archived units and lowers
   occupancy. It should count active properties only, or properties not archived during the date range if the history
   needs to stay exact.
4. **`O.saveBrand`** (core.js:1784) should keep the other `D.workspaceBrand` fields, with
   `Object.assign({}, D.workspaceBrand, {brand, logo, logoName})`. brand.js works around it.
5. **Boot should apply `D.workspaceBrand` details** (name, legal, regNo, phone, email, domain, address) to `O.ws()` after
   sync, and re-apply brand and logo on `remote`. brand.js does this with `O.on('sync')` and `O.on('remote')` for now,
   but those hooks only run once brand.js is loaded (it is in the bundle, so they do run today).
6. **`O.lock.change`** (core.js:949) falls back to `D.properties[0].id`, which throws when there are no properties.
   It needs a guard.
7. **Storage size**: photos are 120–150 KB each, so localStorage (about 5 MB) holds roughly 30 photos with the demo data.
   In local mode the sync adapter should catch `QuotaExceededError` and tell the user. Server mode is fine.
8. Optional: a `U.propOptions({activeOnly:true})` flag, plus a shared `O.propertyStatus(p)` if other pages want the
   same "Guest in / Turnover today / Free tonight" line.

## Which pages should filter archived properties, and how

Rule: **hide archived properties for anything new or forward-looking, and keep them for history.** Use
`O.activeProperties()` (or `p.archived` checks) for lists, pickers and counts. Keep `D.propById` lookups as they are, so
old bookings, invoices and tasks still show the name.

- **Already handled**: bookings.js, calendar.js, owner.js and website.js.
- **Dashboard**: property counts and any "free tonight" or occupancy lines should use active properties.
- **Pricing**: the rate grid and suggestions should show active properties only.
- **Statistics and Reports**: occupancy denominators should use active properties (see request 3). Revenue history stays
  as it is.
- **Tasks and automations**: new tasks and auto-created cleans only for active properties. Existing tasks stay.
- **Inbox and guest app**: fine for existing bookings. Property pickers should use active properties.
- **Inventory**: stock per property should list active properties. Stock moves in the past stay.
- **Money** (invoices and expenses): pickers for new items should use active properties. Past items stay.

## Other notes for page owners

- **bookings.js**: a new booking defaults to 15:00 and 11:00. It could use the property's `checkInTime` and
  `checkOutTime`, and `maxGuests` as the guest limit.
- `lockBrand` and `wifi` can now be empty on new properties. Code that shows `p.lockBrand + ' smart lock'` or reads
  `p.wifi[0]` should handle `''`. website.js already falls back to 'Smart'.
- auth.js `entryFor` could use `workspaceBrand.name` for the workspace name, since the details form saves it there.

## What is left

- Owners are still names, not records. If v5 adds an owners table, migrate by grouping on `p.owner`.
- There is no drag-and-drop for photo order (left and right buttons only), and no cropping.
- Local mode has no warning when localStorage is full (request 7).
