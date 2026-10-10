# v4 reports-owner: Reports, Owner portal, Pricing, Automations

Files: `app/pages/reports.js`, `app/pages/owner.js`, `app/pages/pricing.js`, `app/pages/automations.js`.
Nothing else was edited. Tested with the local build at 1440x900 and 390x844, `--now 2026-10-21T15:40`,
the empty workspace (spec rule 5), an empty workspace plus one property, owner (s1), ops (s2), accountant (s7),
front desk (s4), housekeeper (s5), and per-person overrides (no `reports.money` / `reports.export`,
no `pricing.rules`, no `automations.edit`). Zero JS errors from these four files in every run.

## What was built

### Reports (rewritten)
- **Library view**: reports grouped by type in cards (Financial; Bookings & occupancy; Guests & reviews;
  Operations; Owners; Inventory), each with a one-line description. Search box (name, description, group
  and keywords; matches highlighted, Enter opens the first, Escape clears). 3 / 2 / 1 columns by width.
  Reports that need financial access show a lock pill instead of disappearing.
- **Report view**: back to "All reports", a grouped switcher, date range with presets, comparison
  (previous period / same period last month / none), property filter, insight line, KPIs, chart and side
  panel, sortable table with CSV and PDF, Schedule. Opening from elsewhere: `O.go('reports', {report, propertyId})`.
- All 9 v3 reports kept (occupancy, revenue, pace, channels, guests, reviews, operations, tax) plus
  **Expenses** (operating costs vs capital spending, `costClass`) and **Owner payouts** (uses
  `O.ownerFinance` from owner.js, owner names link to the owner portal).
- **New: Stock used by unit** (Inventory group). Built from `D.invMoves` (`dir: 'out'`, `lines[{itemId, qty}]`,
  `propertyId`) and `D.itemById` (cost). Views: *By unit* (stays restocked, items, cost, cost per stay,
  top three products, change vs comparison) and *Unit × product* (single-hue heat table, bold = each
  unit's top product, Quantity / Cost toggle). With a property selected it lists every product that unit used.
  Totals, sort, CSV (long format unit × product with quantity, unit of measure, cost per item and cost,
  then a by-unit block) and a PDF (summary, by unit, top five products per unit). Money columns only with
  `reports.money`.
- Permissions: `reports.money` gates the financial reports and money columns; `reports.export` gates CSV,
  PDF and Schedule (buttons stay visible, disabled, with the reason as a tooltip).
- Empty states: no properties → "Add a property"; a report whose data does not exist yet (no bookings,
  expenses, reviews or stock logged) → one sentence + a button to the page where it gets recorded.
- PDF: wide tables can mark columns `pdf: false` / `pdfLabel` so they fit A4 portrait; the scope goes in
  the closing note (a long subtitle runs into the address line in `O.pdf.start`).
- CSV changes are written as plain numbers (`-7.5%`) so spreadsheets read them.

### Owner portal (rewritten)
- Property label everywhere is "<name> · <location>" (chips, owner-stay picker, CSV adds a Location column).
- Capital spending shown separately (`M.expenses(from, to, 'capex')`): own column when there is any,
  own line in the summary and a short list of the items.
- Permissions: money via `reports.money` or `owner.statements`; Email statement needs `owner.statements`;
  Approve needs `owner.payouts`; replying and messaging need Owner portal edit; owner stay needs `calendar.block`.
- No date literals; months run from the first month with stays (or the first property added) to today, never
  before `D.DATA_START`. Seed owner messages now have ids (OM-1..3); new ones use `O.uid`.
- 4 KPIs, long tables show 8 rows + "Show all", empty state with Add a property / Open properties.
- `O.ownerFinance = { MGMT, notCharged, chargeRule, owners, statement }` is exposed for the Owners report.

### Pricing (updated, not redesigned)
- Permissions: `pricing.change` (apply suggestions, set a night's price, revert, apply all) and
  `pricing.rules` (rules form, reset, copy to all, auto-apply switches). Clear notes when either is missing.
- Today is read at render time (`D.TODAY`), the preset range is recomputed on every render, no cached dates.
- Reading rules no longer writes defaults into `D.pricingRules` (only saving does), so a fresh workspace does
  not sync rule rows just by opening the page.
- Fewer numbers: KPIs 6 → 4 (our average, competitor average with our position, on the books vs market,
  impact if applied); context line is type · area · base price · open nights; night table drops Index,
  "2 years ago", the min–max sub-line and the change %; portfolio drops Index and Market pace.
- Empty workspace → "Add a property" empty state; a property without a base price → message + Open properties.
  Properties without `area` no longer crash (local guards around `D.eventFor` / `D.rateFor` / `D.compPrice`).
  Group name for pace is computed ("all 13 units", "this unit"), not "all 12 units".
- Competitor footer now says "sample figures until a market data feed is connected" (no "simulated").

### Automations (updated, not redesigned)
- Permissions: `automations.toggle` (switches) and `automations.edit` (Edit buttons, New automation, edit
  modals). Clear note for each combination.
- No cached dates: the 30-day window is computed per call; "Next run 1 Nov" is now the next 1st of the month
  from today. `D.automations` is read fresh (`AU()`), never cached at load.
- KPIs 5 → 3 (automations on, sent for you, time saved). Removed the "New" pills and the "New this round" filter.
- New rules get `O.uid('AR')` ids. Null guards for staff, property, wifi, task due and booking dates.
- Empty workspace: a banner with "Add a property"; the edit-step preview works without a sample booking.

## Decisions
- Reports open as a library first; the report itself gets the full width (clearer on phones than v3's
  tab strip). `ctx.fresh` is consumed on first render so internal re-renders keep the open report.
- Inventory report uses one hue (bars) and a sequential single-hue heat table: unit colours stay only as
  dots next to names, never as series colours.
- A percentage change from a zero or negative base shows "–" and the insight says "nothing to compare"
  instead of +420%.
- Kept the v3 wording "Prototype: ... not really sent" wherever someone could think a message went out.

## Left / known gaps
- The Owners report shows payouts for any date range; carried negative balances are only in the monthly
  statements (said in the footnote).
- Owner portal "last year" style history is not shown; Pricing's "last year" figures for a brand-new
  property still come from the model (`D.rateFor` with yearsAgo).
- Schedule is a prototype as in v3: it validates and confirms, says nothing is really sent, and stores nothing.

## Requests for core (app/core.js, app/data.js)
1. `D.eventFor` (and so `D.rateFor`, `D.compPrice`) calls `p.area.indexOf` and crashes for a property
   without `area`; `D.rateFor` returns NaN without `base`. Please guard both in data.js; pricing.js has
   local wrappers until then.
2. `O.pdf.start`: a long subtitle overlaps the address line (both at y=20). Wrap or move the subtitle.
3. `U.empty(msg, icon)` / `.empty .e-icon` has no SVG sizing; an `O.icon()` there renders full width.
   Each of my pages adds its own CSS; a core rule `.empty .e-icon svg{width:26px;height:26px}` would help everyone.
4. Consider moving into core: `propLabel(p)` ("name · location"), the owner statement maths
   (`O.ownerFinance`), and a reusable PDF KPI-box helper (`O.pdf.report` draws them but cannot be reused
   when a page needs custom sections; reports.js has `pdfSummary`).
5. Seed data: if any other `records` collection is seeded without `id`, sync diff gives it random ids and it
   duplicates on reload (I fixed `ownerMessages`).

## Other engineers' files
- During testing `app/pages/guestapp.js` briefly failed to parse ("Unexpected end of input"); it was fine in
  the final runs. No errors from other files in the final sweep.
