# v4 Dashboard: notes

Owner: dashboard engineer. Files: `app/pages/dashboard.js` (CSS inline via `O.css('dashboard', …)`, no separate .css file).

## What I built

The dashboard is now a short daily glance (SPEC section 3, "Dashboard"). All the v3 analytics were removed: the month-to-date hero,
chart and metric table, KPI strip, 14-night heat strip, booking pace, revenue by property, channel mix, and the CSV/PDF
exports. They now live in Statistics.

Page, top to bottom:

1. **Hero card**: date and time in Malaysia, "Good morning/afternoon/evening, <first name>", a one-line summary
   ("5 arrivals (2 same-day), 3 departures, 17 open tasks (1 overdue) and 5 unread messages today."), and the primary
   action **Brief me**. The footer holds the one money line, only with `dashboard.money`: "October so far RM 18,914, ▼ 2% below
   the same days in September". It compares earned revenue from the 1st to today with the same days last month. The footer
   also has quiet links: **Run sheet** (the PDF of today's check-outs, check-ins and open tasks, kept from v3) and
   **See statistics** (`O.go('statistics')`, only when the viewer may open Statistics).
2. **Brief panel** (only after Brief me is tapped): the brief text in short paragraphs, one per topic, with the current
   sentence highlighted, a Stop button, then Read again or Close.
3. **Same-day bookings** (only when there are any; accent card): bookings made today for arrival today. Each row shows
   booked time, notice, time left (warn under 3 h, red under 1 h) and the readiness chips.
4. **Check-ins today**: arrivals on this morning's list, with readiness chips. When `O.readiness` says "No clean booked",
   the row has an **Add clean** button, shown to people with `tasks.create` and Tasks edit access.
5. **Check-outs today**: time, out or due, the turnover task (assignee, progress from `O.checklist.progress`), and
   "next guest <time>" for back-to-back stays. It warns "No turnover clean booked" when a guest arrives the same day.
6. **Today's tasks** / **Your tasks today**: open and overdue tasks. Overdue tasks come first with a red edge, then tasks
   by due time, with "Late" once the due time has passed. Start or Done buttons need Tasks edit access. Unassigned tasks
   get an "Assign to…" select, only with `tasks.assign`. People without `tasks.others` see only their own tasks, and on a
   phone that card moves to the top. Six tasks show, then "Show N more".
7. **Needs attention**: unread guest messages (`inbox`), reviews needing a reply (`reviews`), and inventory alerts from
   `O.inventory`. Low stock goes to `inventory {tab:'stock', low:true}` and overuse warnings go to
   `inventory {tab:'overuse'}`. Up to 3 overuse warnings show, then "N more usage warnings". When the list is empty it says
   "all caught up".
8. **In-house**: guests staying on tonight who are not arriving or leaving today, with "Leaves tomorrow" or
   "Until Thu 8 Oct". Four show, then "Show N more".

Desktop has two columns: same-day, check-ins and check-outs on the left; tasks, attention and in-house on the right. At 1100px
and below the columns become one list (`display:contents` plus `order`), sorted by importance.

**Empty workspace** (no properties): a welcome card with 3 steps. **Add your first property** is the primary action and
calls `O.go('properties', {add:true})`, which opens the add form (checked). **Go to Bookings** and **Invite people**
(with `staff.invite`) are the other two steps. Brief me is hidden there so the page has one primary action.

## Read aloud ("Brief me")

- `O.dashboardBrief()` returns the brief as an array of sentences, plus `.breaks`, the indexes where a new topic starts.
  `O.dashboardBrief.speech()` returns the same sentences as spoken. Both are built from the same `model()` the page renders,
  so the brief says exactly what this viewer's dashboard shows:
  - Arrivals are mentioned only with `bookings` or `calendar` view.
  - The viewer hears their own tasks when they lack `tasks.others`.
  - Messages need `inbox`, reviews need `reviews`, and stock needs `inventory`. Overuse warnings also need
    `inventory.in`, `.adjust` or `.items`.
  - Money needs `dashboard.money`. The Brief me button needs `dashboard.readAloud`.
- Greeting by Malaysia time (`D.NOW_TIME`): morning 5–11, afternoon 12–17, evening otherwise. Date spoken naturally:
  "It's Tuesday the 6th of October, 10:15 AM." Times read as "noon", "4 PM", "11:45 AM".
- The spoken text says "18,914 ringgit" instead of "RM 18,914", "5 point 7" for decimals and "versus" for "vs". No stray full
  stops are left inside a sentence, so `O.voice.speak`'s splitter gives exactly one part per sentence and `onpart(i)` maps to
  the highlighted sentence. Checked: 15 sentences gave 15 parts. If the part count ever differs, the highlight falls back to
  proportional mapping.
- **Speech unavailable**: if `O.voice.available()` is false, if no sentence starts within 4 s, or if the voice ends without
  starting (headless Chromium gives "not-allowed" and has 0 voices), the panel shows "Reading aloud isn't available on this
  device or browser, so here is your brief to read." with the full text. This was tested in headless.
- **Highlight path**: tested with a stand-in `O.voice` that steps through the parts. Checked: highlight, Stop, finishing,
  Read again, leaving the page mid-read (`ctx.onLeave` stops and closes the panel), and changing the viewer mid-read (stops
  and closes).
- While the brief is reading, data changes from other people do not redraw the page, because a redraw would cut the voice.
  `noDataRerender` is a getter on the page definition that returns true while reading. The page redraws once the brief ends
  or is stopped. The `tick` event updates the clock every minute and redraws every 5 minutes, but never while reading or
  while a select or input on the page has focus.
- Speech is started directly in the click handler, so iOS Safari treats it as a user gesture.

Sample briefs (demo day, 10:15):

- Owner s1: "Good morning, Mei Fen. / It's Tuesday the 6th of October, 10:15 AM. / Five guests arrive today, including two
  same-day bookings. / Next up, at noon: Hafiz Aziz at Bayfront 1A and Sarah Tan at Bayfront 3B. / Unit prep is still under
  way for four of them. / Hafiz Aziz and The Reyes Family still need to verify their ID. / Three guests check out today, and
  all of them have already left. / Six other guests are staying on tonight. / There are 17 open tasks today, one overdue
  from earlier. / Overdue: quarterly inspection at Melaka Loft. / You have five unread guest messages in four conversations.
  / 25 reviews are waiting for a reply, seven of them rated three stars or lower. / There are six usage warnings. / The
  first: KLCC Skyline 28F used 6.1 coffee capsules per stay … / October so far: RM 18,914 in revenue, 2% below the same days
  in September. / That's everything for now. / Have a good morning."
- Housekeeper s5: same stays part, then "You have six open tasks today. / First up, due 11:45 AM: turnover clean at
  Bayfront 1A. / You have five unread guest messages in four conversations." No reviews, money or overuse.
- Accountant s7: stays part, then "October so far: RM 18,914 in revenue, 2% below …". No tasks, inbox or reviews.
- At the later date (15:40) the brief says "Good afternoon", next up "at 4:30 PM: The Reyes Family at Marina", and late
  tasks read "late since 11:45 AM". Empty workspace: "Your workspace is ready, but it has no properties yet. / Add your
  first property, then your bookings, and I'll brief you on each day from here."

## Decisions

- **Same-day bookings stay a separate card.** Arnob asked for this in v3. It shows only when there are same-day bookings;
  otherwise the check-ins card says "no same-day bookings so far".
- **Readiness in the brief is grouped by what needs doing**: no clean booked, unit prep under way, and ID still to verify.
  This beats listing every chip. "Code scheduled" is not treated as a problem.
- **"In-house" means staying on tonight**: `checkIn < today < checkOut`. Today's arrivals and departures already have
  their own cards, and status `checked_in` only flips the day after arrival.
- **Bookings stamped later than now are left out.** The demo data has a couple of bookings stamped after the current
  time; they are hidden until that time comes (same rule as v3).
- **Inventory**: low stock is shown to anyone with Inventory view. Overuse warnings are shown only to people who buy or
  count stock, matching inventory.js's own bell rule. Inventory alerts appear only once `O.inventory` exists, so the
  dashboard never says "stock looks fine" without data.
- **Guest names open the booking drawer** only with `bookings` view. Maintenance staff can see arrivals through Calendar
  access but cannot open bookings.
- **Add clean** creates `{id: O.uid('T'), type 'Turnover'|'Inspection', checklistId: O.checklist.forType(...), checks: []}`.
  It assigns to the property's housekeeper when the viewer has `tasks.assign`, and to the viewer otherwise.
- **Done from the dashboard** marks the task done without ticking its checklist items, so the checklist shows real
  progress. Ticking items is the Tasks page's job.
- **No top-bar actions**, so the phone top bar stays one row. Brief me sits about 170px from the top on a 390 × 844 phone,
  at full width and 52px tall.
- On phones the task buttons are icon-only 42px squares on the right, with the label kept for screen readers. This keeps
  each task row to two lines.

## Tested

Desktop 1440 × 900, phone 390 × 844, landscape 844 × 390, Otto workspace (black text on the brass button),
`--now 2026-10-21T15:40`, 21:05 evening, the empty workspace, and viewers s1, s2, s4, s5, s6 and s7. Also tested:
a per-person override turning off `dashboard.readAloud`, a tasks-only viewer (calendar removed), a booking and a task whose
property was deleted ("Removed unit"), assign, start and done, show more and show fewer, Add clean, Run sheet, the
Add-your-first-property deep link and See statistics. My file produced no JavaScript errors and no sideways scroll.

## Errors seen from other files

- `app/pages/guestapp.js` was mid-edit during my last runs: "Unexpected end of input" (node --check fails at line 475).
  That is the guest app engineer's file, not this page.

## Requests for core

1. **`O.voice.speak` onend on stop**: when stopped, `onend(true)` still fires because cancel triggers each utterance's
   onerror. I guard with a run counter. It would be cleaner if core called `onend(false)` or not at all after `stop()`,
   and reported whether any part actually started. Suggested signature: `onend(completed, startedAny)`.
2. **`O.voice` sentence splitting**: `O.voice.speak` splits on `.!?`, so "2.3%" or "St. Regis" breaks a sentence in two.
   Consider `O.voice.speakParts(arrayOfSentences, opts)` so pages pass sentences directly. I clean the text in
   `speakable()` for now.
3. **Router: data redraw while a page is busy**: I use a getter for `def.noDataRerender`. A documented
   `ctx.holdRerender(bool)` would be clearer for any page that plays audio or records.
4. **`O.booking.open` does not mask guest phone and email** without `bookings.contacts` (spec rule 6). The dashboard only
   opens the drawer for people with Bookings access, but the drawer itself should mask them.
5. Small shared helpers that could move to core: `sayTime` ('noon', '4 PM'), `sayDate` ('Tuesday the 6th of October'),
   `words`/`count` for spoken numbers, and `firstName` ('Mei Fen Lim' → 'Mei Fen').

## Left to do

- The 4 s watchdog is a guess for slow first voice loads on desktop Chrome; adjust it if real devices show false
  "unavailable" messages.
- Reading aloud on real phones (iOS Safari, Android Chrome) still needs testing on hardware. Headless has no voices.
