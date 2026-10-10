# v4 Bookings & Calendar

Owner: bookings-calendar. Files: `app/pages/bookings.js`, `app/pages/calendar.js` (no separate CSS files; styles are in
`O.css` blocks at the top of each page). Spec: SPEC-v4 §3 "Bookings & Calendar".

## What was built

### Bookings (`bookings.js`, rewritten)
- **KPIs removed** (revenue, ADR, occupancy, average stay, lead time). The summary line reads
  "60 bookings staying between 6 Oct – 4 Nov 2026 + 1 cancelled · See statistics"; the link opens Statistics with
  `{from, to, propertyId}` and only shows when `O.allowed('statistics')`.
- **Grouped by property**, header "name · location" (`p.area`, falling back to location/city/address), never unit type.
  Each group has a count and a quiet "+ Booking" (bookings.create). Groups collapse; Expand all / Collapse all.
  Bookings whose property was removed land in a "Removed property" group and open a plain summary modal (core's drawer
  needs the property).
- **Compact rows ~44px** on desktop: guest (name, id · country, same-day tag), stay (dates · nights, guests or
  "Arrives today, 12 PM"), platform, status, total (only with bookings.value), Next step. Header buttons sort by guest,
  stay, platform, status, total. Under 1180px the platform shows as a mark only and the stay column keeps 150px.
- **Phone (≤760px)**: cards with platform mark, guest, status, dates · nights, total, next step. Filters fold behind a
  "Filters (n)" button; date range shows its dates without the preset name. No sideways scroll at 390 × 844.
- **Kept**: date range (presets), match select (Staying in range / Checking in / Booked in range), property and
  platform selects, search (phone search only with bookings.contacts), status chips with counts, Needs action chip,
  CSV export (bookings.export; phone and email columns only with contacts, money only with value).
- **Next step** column replaces the v3 readiness chips: first issue + "+N" (pending, invoice not sent, awaiting
  payment for direct stays within 7 days, ID pending within 3 days, clean not started for today/tomorrow); otherwise
  "On track" / "Waiting for confirmation" / "In-house until …" / "Stay completed" / "Cancelled …". Invoice and payment
  steps only for viewers with bookings.value.
- **Drawer**: `O.booking.open` plus a footer: Copy guest link (bookings at edit level), Edit (bookings.edit, not
  cancelled/checked out), Cancel booking (bookings.cancel, confirmed/pending). A local `scrubDrawer` re-applies after
  every core re-render: property shown as "name · location", phone/email masked without bookings.contacts, Payment and
  Invoice sections removed without bookings.value, Send invoice / Record payment removed without invoices.send /
  invoices.payments, Mark ID verified removed below bookings edit, door code button and guest code removed without
  guestapp.doorCodes, Message removed without inbox access. (A stopgap: see requests for core.)
- **Edit**: property (name · location), check-in, check-out, arrival/departure time, guests, name, phone/email (masked
  and disabled without contacts), note. Live availability check against bookings and blocks, repricing summary (new
  total and difference to what was paid only with value), OTA note for platform bookings. In-house stays can only
  change check-out. Saves in place, re-sorts `D.bookings` by check-in, runs `O.automation.run('booking')`, emits.
- **Cancel**: U.modal "Keep booking" / "Cancel booking" (danger). Sets status, cancelledAt, cancelledBy, door code
  cancelled, runs automation, emits. Mentions the refund only to viewers with value.
- **Copy guest link**: `O.guestLink(b)`; emits once if a token was just created; clipboard with a toast, or a modal with
  the link selected when the clipboard is blocked.
- **New booking** (`O.newBooking`, shared): id `O.uid('BK')`, `O.bookingDefaults(b)` before the push, kept sorted,
  invoice number next in sequence, invoice "send now" only with invoices.send. The v3 "Prototype: kept until reload"
  line is gone. Tasks for the stay come from the Tasks automation job (v3's same-day turnover task, created here with a
  max + 1 id, was removed so the automation settings decide).
- **Empty states**: no properties: "Bookings appear here once you have added a property." + Add your first property
  (or "Ask an account owner…"). Properties but no bookings: "No bookings yet. They appear here as soon as a guest books
  or you add one." + Add your first booking, with no filters, chips or CSV. No match: reason + Clear filters.
- Params: `propertyId`, `status`, `q`, `from`/`to`, `bookingId` (highlights, scrolls, opens the drawer), `new`.
- `O.bookingTools = {open, edit, cancel, copyLink, propLabel, place, propName}` for calendar and other pages.

### Calendar (`calendar.js`, rewritten)
- **Window**: starts today and shows 7 days (today + 6). Prev/next move 7 days for every length; Today (disabled when
  already there); a date button with an overlaid native date input jumps to any start. A fresh visit resets to today.
- **Lengths**: 7 / 14 / 30 days on desktop, remembered with `O.store` (`calendar.days`). Phones always 7 days, portrait
  and landscape (phone mode = `(max-width:760px), (max-height:500px) and (max-width:960px)`, rerenders on rotation).
- **Removed**: local events row and all event code, density shading, demo preview units, stats header, booked-units
  footer, status/platform filter chips.
- **Grid**: sticky property column (210px desktop, 170px ≤1100, 150px phone landscape, 100px phone portrait with short
  name + first part of the location), sticky day header, weekends shaded, today column and a now line.
- **Bars** coloured by status (confirmed, in-house, pending, checked out) with the platform mark. The label is measured
  with canvas: "Name · n nights" → name → first name → initials; bars under 62px go "tight" (13px mark, initials).
  Blocks are hatched with a lock and "Maintenance" / "Owner stay".
- **Taps**: bar → booking drawer via `O.bookingTools.open` (same footer and guard); viewers without Bookings get a small
  read-only stay summary. Block → block editor (read-only without calendar.block). Free night → small menu: New booking
  (bookings.create), Block dates (calendar.block), nightly price only with value; past nights disabled.
- **Block dates** (`O.blockDates`): property (name · location), from/to, type, note; id `O.uid('BL')`; checks clashes;
  lost value only with bookings.value; Remove block.
- **Actions**: desktop topbar "Block dates" + "New booking"; on a phone they sit in the toolbar (+ Booking, lock icon).
- Property names link to Bookings filtered to that property and window (if the viewer has Bookings).
- Empty state: "Your calendar fills in once you have added a property." + Add your first property.

## How many days fit on a phone (measured)

Measured in Chromium (DejaVu Sans, which is wider than Inter, so real devices have a little more room):

| Viewport | Property column | Px per day (7 days) | 1 night | 2 nights | 3+ nights | Rows visible |
|---|---|---|---|---|---|---|
| 390 × 844 portrait | 100px | 41.4 | mark + initials (tight) | first name | full name | all 12 |
| 360 × 780 portrait | 100px | 37.1 | mark (+ initials when they fit) | initials/first name | full name | 12 |
| 844 × 390 landscape | 150px | 99.1 | first name | full name | name · nights | about 4.5 |
| 780 × 360 landscape | 150px | 90.0 | first name | full name | name · nights | about 4 |

- **Portrait: 7 days.** 14 days would give (390 − 100) / 14 ≈ 20.7px per day, under the 22px minimum for a tappable
  night and a readable bar, so the grid would scroll sideways. 7 days keeps every 1-night stay tappable (≥ 38px with
  the extended hit area) and shows names from 2 nights up.
- **Landscape: 7 days.** 14 days would fit (≈ 49.6px per day: initials for 1 night, first names for 2) but landscape
  only shows about 4–5 property rows under the topbar and toolbar, so height, not width, is the limit; doubling the days
  makes bars harder to hit without showing more of the portfolio. Keeping 7 also means the view does not change when
  the phone is rotated.

## Decisions and why
- Match on stay / check-in / booked is a select, not a segmented control: the segmented control wrapped onto its own
  line at 1440px and ate a row.
- "Next step" (one issue + count) instead of a strip of readiness chips keeps rows at 44px; full readiness is in the
  tooltip and the drawer.
- Copy guest link needs Bookings at edit level (the link opens the guest app with the door code), not a separate key.
- Cancelling keeps the drawer open on the cancelled booking so the person sees the result.
- New/edited/cancelled bookings rely on the Tasks automation job (`O.automation.run('booking')`) for check-in and
  turnover tasks instead of creating tasks in the bookings page.
- Calendar steps by 7 days at every length, so "next" never skips unseen days on the 7-day phone view and the start
  date stays predictable; 14/30 overlap by design.
- Empty workspace with properties but no bookings shows one sentence + one button (spec rule 5), not a toolbar of
  zero-count chips.

## Tested
Desktop 1440 × 900 and 1024 × 768, phone 390 × 844, phone landscape 844 × 390 (and 360/780), `--now 2026-10-21T15:40`,
the empty workspace (spec rule 5) and no-bookings workspace, roles s1 owner, s4 front desk (no export, can
create/edit/cancel/block), s5 housekeeper (view only; masked contacts, no money, no door code), s6 maintenance
(calendar only, read-only stay summary on tap), s7 accountant (bookings with value/contacts/export, calendar locked).
Flows: new booking (incl. from the empty state), edit with repricing, cancel, copy link, free-night menu, block
dates, drawer refresh after `O.emit('data')`. No errors from my files. (Earlier in the session `app/pages/guestapp.js`
had a syntax error, "Unexpected end of input"; it was gone by the final run.)

## What is left / ideas
- Drag to create a booking or move one on the calendar; drag edges to change dates.
- Editing a platform booking only changes Orbique (the form says so); nothing is pushed to the OTA.
- Refunds on cancel are a note only; no credit note is created. Editing a paid booking does not reissue the invoice.
- Invoice numbers for new bookings are still "next in sequence" (they are document numbers, not record ids), so two
  devices adding a booking at the same moment could pick the same number; the server should allocate them.
- The bookings page does not keep the header row sticky against the page scroll.

## Requests for core (`app/core.js`)
1. **Booking drawer permissions** (`O.booking.open`, around line 1103): until these land, `bookings.js` scrubs the drawer
   after each render (`scrubDrawer`), which depends on core's markup and section titles.
   - Guest line: mask phone and email unless `O.can('bookings.contacts')` (same masks as bookings.js: country code +
     "••• ••12", first letter + "•••@domain").
   - Payment and Invoice & receipt sections only with `O.can('bookings.value')`; show platform fee and payout with
     `bookings.value` rather than `O.isOwner()`.
   - "Send invoice…" only with `invoices.send`; "Record payment" only with `invoices.payments`.
   - "Mark ID verified" only with `O.can('bookings', 'edit')`.
   - "Change door code" and the guest code only with `O.can('guestapp.doorCodes')`.
   - "Message" only with `O.can('inbox')`.
2. **Property label** in the drawer: the sub line and the Property row should read "name · area" (`p.area`), e.g.
   "BK-4103 · Bayfront Loft 3B · Gurney Drive, Penang"; never the unit type.
3. **Missing property**: `O.booking.open` throws on `p.name` when the property was removed. Guard it (show
   "Removed property").
4. **Actions hook**: let pages add drawer actions (for example `O.booking.actions.push(fn(b) → buttons)`) or accept
   `{foot}` so Edit / Copy guest link / Cancel booking appear wherever the drawer opens (dashboard, inbox, tasks), not
   only from Bookings and Calendar. Today other pages can call `O.bookingTools.open(id)` to get them.
5. Optional: `O.copy(text, label)` clipboard helper with the modal fallback (bookings.js has a local one).
