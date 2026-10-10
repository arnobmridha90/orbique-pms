# v4 Statistics (builder note)

Owner of: `app/pages/statistics.js` (new), `app/pages/statistics.css` (new). No other files edited.

## What I built

A new page, `statistics`, for the in-depth analysis that is moving out of the other pages.

- **One filter row** scopes every tab:
  - A date range: core `U.dateRange` with the presets last 7, last 30, month to date, last month, last 90, quarter to
    date, last quarter, year to date, last 12 months and All data (`since`), plus a custom range.
  - A property select: all properties or one. Archived properties are listed last and marked "(archived)", because
    statistics are history.
  - A sentence under the filters names the comparison periods.
- **Seven tabs.** Each has KPI tiles with the change against the comparison period, one or two charts and one table:
  - **Overview** (the old Dashboard hero)
    - Tiles: revenue, occupancy, ADR, bookings made, rating and cancellation rate.
    - Chart: a revenue running total against the two comparison periods.
    - Table: "All metrics", with each period and both changes, grouped into stays, bookings made, guests and reviews,
      invoices, operations and costs.
  - **Revenue & occupancy**
    - Tiles: revenue, ADR, RevPAR, occupancy, weekend occupancy, and the next 30 nights already booked (compared with
      what was booked at the same point last period).
    - Charts: revenue bars per day, week or month, and an occupancy line.
    - Table: one row per property with a totals row. With one property selected it becomes a table per day, week or
      month.
  - **Bookings & guests**
    - Tiles: bookings made, cancellation rate, lead time, length of stay, international guests and direct share.
    - Charts: channel mix, guest countries (top 7 plus "Other"), and booking window and stay length (with the change in
      brackets).
    - Table: one row per channel (share and its change, cancellations, lead time, stay length, value booked and fees).
  - **Reviews**
    - Tiles: rating, review count, response rate, reply time, 5-star share and 3 stars or lower.
    - Charts: a weekly rating trend (at least 12 weeks), plus category scores with their change and the stars given.
    - Table: one row per platform.
  - **Invoices & payments**
    - Tiles: invoices issued, sent, paid, awaiting payment, overdue and collection time for direct bookings.
    - Charts: invoices issued per day, week or month, and time to payment (including "Not due yet" and "Overdue").
    - Table: one row per channel.
  - **Operations**
    - Tiles: turnovers, back-to-back, average turnover time, tasks done on time, open or overdue tasks, and arrivals
      on track in the next 7 days (from `O.readiness`).
    - Charts: turnovers per day, week or month, and tasks per team member (stacked bars: done, overdue, not due yet).
    - Table: one row per property.
  - **Costs** (needs `statistics.money`)
    - Tiles: opex, capex, total spend, opex share of revenue, opex per night sold, and the number of expense entries.
    - Charts: operating costs per day, week or month, and a list of capital spending.
    - Table: one row per expense type, with an Operating or Capital pill and the change against the comparison period.
- **Exports.** CSV and PDF export the current tab: header lines, the KPI tiles (current, comparison, change) and the
  table.
  - CSV headers carry their unit, for example "Revenue (RM)" or "Occupancy (%)".
  - The PDF uses `O.pdf.report`. Column widths are measured from the text so money columns are not cut.
  - Both are disabled when the tab is empty.
- **Permissions**
  - The page itself is gated by core (`U.locked`). I checked this with s4 and s5.
  - Without `statistics.money`:
    - Revenue, ADR, RevPAR and every amount are replaced with nights or occupancy figures.
    - The Costs tab is shown disabled with a lock and a reason on hover.
  - Without `statistics.export`, the CSV and PDF buttons are disabled and give a reason on hover.
- **Saved state.** The tab, range and property are kept in `O.store`:
  - `statistics:tab`
  - `statistics:range` (`{preset}` or `{from,to}`)
  - `statistics:property`
- **Links from other pages:** `O.go('statistics', {tab, preset, from, to, propertyId})`. The params apply on a fresh
  render and are then saved. invoices.js and reviews.js already link to their own tab, and bookings.js passes `{from, to, propertyId}`.
- **Phone**
  - Below 1100px the tabs become chips. At 760px and below they become one scrollable chip row that bleeds to the
    screen edges, and the active chip is scrolled into view.
  - Tiles show 3 per row below 1280px and 2 per row at 560px and below.
  - Table cards scroll sideways inside the card, with a sticky first column that uses the property's short name.
  - Tap targets are at least 40px: the chips, the date button, the property select and the export buttons.
- **Empty states.** Each tab shows one sentence and its main action:
  - No properties: "Add your first property".
  - No bookings: "Add a booking".
  - No reviews, invoices, tasks or expenses: a button that opens that page.
  - Nothing in the range: "Show all data", which switches to the All data preset.

## Decisions and why

- **Comparison periods** (grey in charts, deltas on tiles):
  - A range that starts on the 1st and stays inside one month (month to date, last month, 1–15 Sep) is compared with
    the same days of the two months before. A whole month is compared with whole months. This reproduces the old
    Dashboard month-to-date hero.
  - Any other range is compared with the period of the same length just before it, and the one before that.
  - A comparison that would start before the records start (`min(D.DATA_START, first check-in)`) is dropped. Its
    columns are then removed from the tables and CSV, and the sentence says why.
  - Without a comparison, the Overview chart switches from the running total to bars per bucket.
- **Buckets.** Daily up to 45 days, weekly up to 200 days (counted back from the last day, so the last week is complete),
  and monthly after that. With one property and a range of 14 days or more, occupancy is shown per week, because a
  single unit is either 0% or 100% on any given night.
- **What counts in which tab:**
  - Stays are counted on nights stayed: revenue, occupancy, ADR and RevPAR come from `M.*`, so they match the
    Dashboard and Reports.
  - Bookings are counted on the date they were made: channel mix, lead time, cancellations and value booked.
  - Guests are counted on arrival: countries, length of stay and international share.
  - Invoices are counted on the invoice date.
- **Overdue invoice:** unpaid, not pending, and past its due date.
  - Direct bookings are due `invoiceSettings.dueDays` (default 7) before check-in, but never before the invoice date.
  - Platform bookings are due on the invoice date, because the platform collects.
  - "Collection time" covers direct bookings only, because platforms show 0 days.
- **Turnover time:** from the guest's check-out time to the done Turnover task's `doneAt`, falling back to the
  Inventory turnover restock (`D.invMoves` kind `turnover`, `at`).
  - The demo has only a few done tasks, so most times come from the restock record (about 1h 10m everywhere).
- **Arrivals on track:**
  - No readiness item may be `todo`. A clean not yet started, or a door code held for the ID check, counts as fine
    before arrival day.
  - "Fully ready" means every item is `ok`.
- **Costs:** rejected claims are excluded, as in `M.expenses`. Company-wide expenses (`propertyId` null) are included
  only under "All properties".
- **Change types:**
  - Rates change in percentage points ("pts").
  - Averages such as stay, lead time, rating and turnover time change by an absolute amount.
  - Counts of problems (overdue, awaiting, 3 stars or lower) change by an absolute count.
  - Everything else changes in %.
  - Neutral metrics (stay length, lead time, international share, capex, entries) are shown in grey, never good or bad.

## Tested

- Desktop 1440x900, 1280 and 1024, and phone 390x844, on every tab.
- The later date (`--now 2026-10-21T15:40`): month to date, All data and last 90 days.
- Single property, custom range via `ctx.params`, and the "range has no data" empty state.
- The empty workspace (spec rule 5) on every tab, a workspace with properties but no bookings, reviews or tasks, and
  Otto.
- Viewers:
  - s7 (accountant) and s2 (ops).
  - s2 with `statistics.money` and `statistics.export` turned off.
  - s4 and s5, which see the page locked.
- Archived property.
- CSV and PDF downloads for all 7 tabs. I read the CSV files and rendered the PDFs.
- Zero JS errors and no sideways scroll everywhere. The checkout builds clean now. Earlier, `app/pages/guestapp.js`
  did not parse for a while (mid-edit by its owner); I tested against a copy with the v3 version swapped in.

## Left

- Small multiples per property (one chart for each unit) were not built; the per-property tables cover it.
- Charts have no table toggle of their own. The table on each tab and the CSV are the table views.
- Revenue by channel over time, and a pacing chart (on the books by lead time), would be good next additions.
- Reply time in the demo data is always 1 day, and task timing has very few done tasks. The figures are correct, just
  flat.

## Requests for core (not edited; local helpers are in place)

1. **Invoice due date and overdue rule.** Add a shared `O.invoiceDue(b)` and `O.isOverdue(b)`. statistics.js has a
   local `dueOf` (direct: check-in minus `invoiceSettings.dueDays`, never before the invoice date; platforms: the
   invoice date). Invoices, the dashboard and statistics should agree.
2. **`M.availableNights` and archived units.** It multiplies by `properties.length`. This is the same request as
   properties-brand request 3. Statistics only hides archived units from the per-property tables when they have no
   data.
3. **`.g1` grid class** (one column) in core.css. statistics.css defines `.pg-statistics .g1`.
4. **Points deltas in `U.kpis` and `U.delta`.** A `pts` kind for rates and an `abs` kind with a formatter would help.
   statistics.js has `chg()` and `dl()` with kinds `rel`, `pts` and `abs`, plus `invert` and `neutral`.
5. **Stacked bars in `O.chart.hbars`.** Rows with `parts: [{v, tone}]` would help. statistics.js has a local
   `stackHb()` (2px gaps between parts).
6. **Turnover time source.** A `doneAt` on Turnover tasks (or `O.turnoverTime(booking)`) would make turnover time exact.
   Today it falls back to the Inventory restock time.
7. **`O.pdf.report` column widths and header.**
   - It could size columns from content. statistics.js measures them itself.
   - The right-hand subtitle overlaps the company address when it is long, so statistics keeps it short.
   - Helvetica has no ★, so it is stripped from PDF text.
8. **`U.dateRange` on phones.** The preset label plus the range does not fit in a narrow button. Statistics gives it a
   full-width row at 560px and below.
