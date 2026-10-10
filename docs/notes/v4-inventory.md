# v4 Inventory (page `inventory`, under Manage)

Files: `app/pages/inventory.js`, `app/pages/inventory.css`. Nothing else was edited.

## What is built

- **Tabs**: Stock · Movements · Overuse (with a count badge) · Items (only with `inventory.items`) · Settings (account owner only).
- **Stock**: one store room. On hand = sum of all moves (in +, out −, adjust signed). A red "Reorder these items" card
  appears when anything is at or below its reorder level, with "Record the purchase" (opens Stock in, prefilled to bring
  each item back to 3 × its reorder level). Otherwise a one-line "Nothing needs reordering". List grouped by category with
  search, category filter, "Low stock only" chip and CSV (CSV is hidden on phones). Columns: in stock, reorder at,
  "lasts about N days" (from the last 30 days of use), and a Reorder / Low soon (≤ 7 days) / Not counted pill.
- **Movements**: log with date range (`U.dateRange`), unit, item, person (used by or recorded by) and In / Used / Adjusted
  chips; "Clear filters"; 60 rows then "Show more"; CSV of the filtered lines (one row per line). Tap a row for the detail
  (lines, booking link, note, value) with "Delete this record" for owners, `inventory.adjust`, or the person who recorded
  it on the same day.
- **Overuse**: the rule in one sentence ("Change the rule" for owners), then one card per warning: the self-explaining
  text, three small bars (last 30 days in brand colour, the unit's 3-month average in grey, other units now in light grey),
  "Compare all units" (every unit's last-30-day figure with a tick at its own average) and "See the records" (Movements
  filtered to that unit and item, last 90 days, used only).
- **Items**: add, edit (name, category or a new category, counted in, cost each, reorder level, optional usual use per
  stay / night / guest), stop tracking / track again. New ids `O.uid('IT')`, pushed into `D.invItems`, then `O.reindex()`.
- **Settings** (owner): per stay vs total, threshold %, minimum quantity, a live preview ("6 warnings right now, out of 322
  unit and item pairs. The strict rule would give 111.") and the explanation that Total use + 0% is the literal
  "more than the average of the last three months" rule. Saved by mutating `D.inventorySettings` in place.
- **Forms** (`U.modal`, bottom sheet on phones):
  - *Stock in*: date, supplier (with a list of past suppliers), total cost (hint: "About RM X at usual prices"), note, items.
  - *Record stock used*: unit (required; "Your units" first), used for (Turnover / Repair / Other; maintenance defaults
    to Repair), used by (default me), optional booking, date, note, items. "The usual restock" fills the average of the
    unit's last 90 days of turnovers (or the items' usual use for the linked booking's nights and guests when a unit has
    no history). The note defaults to "Turnover restock after <guest>".
  - *Count or adjust*: Stock count (enter what is on the shelf; each line shows "Records say 193 · 13 missing"; only
    differences are saved, the line keeps `counted`) or Write off (reason required, saved as negative qty).
  - Item picker on desktop: a searchable list grouped by category (type, arrow keys, Enter adds the item and jumps to its
    quantity, Enter again returns to the search). On phones: a tick list grouped by category with search and 40px
    − / qty / + steppers; ticked items move to the top.
- **Housekeeper phone flow (s5)**: tap "Stock used" (top bar), the unit is preselected from her current task today and
  the departing guest's booking is preselected, tap "Fill in" (the usual restock), tap "Save · 17 items". Three taps.
- **Bell** (`O.notifiers`): low stock and overuse, only for people with `inventory.in` or `inventory.adjust`. Up to two
  items per type are listed one by one; more become one summary ("3 items are low on stock", "6 overuse warnings").

## Shared helpers (`O.inventory`, set at module load)

| call | returns |
|---|---|
| `stock()` | `[{itemId, name, cat, unit, qty, reorder, low, tracked, perDay, daysLeft}]`: every active item, in list order. `low = tracked && qty <= reorder`; `tracked` = the item appears in any move (so a new workspace has nothing "low"); `perDay` = average used per day over the last 30 days; `daysLeft` = whole days at that rate, or null |
| `low()` | the `stock()` entries with `low`, emptiest first |
| `overuse(opts)` | `[{propertyId, itemId, recent, baseline, basis, ratio, change, text, recentQty, baselineQty, recentStays, baselineStays, extraQty, extraCost}]`, sorted by `extraCost` (biggest first). `opts` (optional): `{basis, threshold, minQty, propertyId, itemId, to}`; missing values come from `D.inventorySettings`. `text` has no trailing full stop |
| `usage(from, to, {propertyId, itemId})` | `[{propertyId, itemId, qty, cost}]`: stock out per unit and item, `cost = qty × item cost` (2 dp). `propertyId` may be null or point to a removed unit. `from`/`to` may be null |
| `itemName(id)` | name, or `'Removed item'` |
| `noun(id, n)` | words for sentences: `'rolls of toilet paper'`, `'coffee capsules'`, `'AA batteries'` (singular when n === 1) |
| `settings()` | validated copy of `D.inventorySettings` |
| `onHand()` | `{itemId: qty}` for every item in any move (inactive too) |
| `open(kind, preset)` | opens a form: `'in'`, `'out'`, `'adjust'`; preset `{propertyId, bookingId, use, mode: 'count'|'writeoff', lines: [{itemId, qty}], supplier, note}` |

Page params: `O.go('inventory', {tab: 'stock'|'moves'|'overuse'|'items'|'settings', low: true, propertyId, itemId, action: 'in'|'out'|'adjust'})`.
dashboard.js loads before inventory.js, so callers should check `O.inventory` at render time (dashboard already does).

Move record: `{id: O.uid('MV'), date, at, dir, kind, lines: [{itemId, qty, counted?}], propertyId?, usedBy?, bookingId?, supplier?, cost?, note, by}`.
New `kind` values beside data.js's: out `'other'`, adjust `'writeoff'`. Adjust `'count'` lines carry `counted`.

## Decisions and why

- **Overuse rule**: for each unit and item, last 30 days vs the previous 90 days (three 30-day periods, pooled).
  Per stay = quantity ÷ check-outs in the window (non-cancelled `D.bookings` with `checkOut` in it). Flagged when the
  unit used at least `minQty` in the last 30 days and the rate is above baseline × (1 + threshold), or when there was
  no use before at all. A unit with no check-outs in one window falls back to the total comparison for that pair (the text
  then says "without any check-outs"). The baseline starts no earlier than the first recorded move; with less than 30 days
  of baseline there are no warnings ("Not enough history yet").
- **Result at the demo date with the defaults (per stay, 40%, min 5): 6 warnings**: kls coffee capsules (+140%), hv2 toilet
  paper (+76%, "5.7 vs 3.2"), bgf drinking water (+60%), hsg AA batteries (the 3 Oct lock repair), mkr conditioner (+50%),
  bbs laundry pods (+41%). The literal rule (total, 0%) gives 111 of 322 pairs with min 5, and 191 with min 0.
- **Sorted by extra spend** (extra quantity × item cost), not by percentage: the hsg batteries pair is +1067% on tiny
  numbers and would otherwise lead. The three built-in units come first, which suits the dashboard's top 3.
- **Low stock only for tracked items**: a new workspace keeps the 33 config items, but nothing is "low" until it has been
  counted or bought, so the bell is not full on day one.
- **Money** (purchase totals, item costs, values): shown to owners and anyone with `inventory.in`, `inventory.items`,
  `expenses.viewAll` or `reports.money`. Housekeepers, front desk and maintenance see quantities only.
- **Duplicate guard**: the default booking is the guest who checked out today or yesterday *without* a turnover restock yet.
  Choosing a booking that already has one shows "A turnover restock for this booking is already recorded (… by Siti
  Aminah). Save only what was used on top of it." and hides the usual-restock button.
- **Categories** are `D.invCats` plus any category used by an item, so a new category only needs to live on the item
  (`invCats` is not a registered collection).
- **Stop tracking** instead of delete: moves reference items, and reports need history. Inactive items leave the stock
  list, forms and overuse, but stay in `usage()` and the movement filters.
- **Front desk / accountant** (Inventory = view): no form buttons, one sentence saying recording is not part of their
  access.

## Tested

Desktop 1440 × 900 and phone 390 × 844 for every tab and form; demo date and `--now 2026-10-21T15:40` (both a fresh
load and a demo loaded on 6 Oct opened on 21 Oct via `--storage`); empty workspace (spec rule 5) on every tab and form;
viewers s1, s2, s4, s5, s6, s7. A Playwright run saved one move of each kind and checked the records, the settings blob
(same object), item add plus `O.reindex()`, delete, the bell, and the s5 permission block on Stock in. No JS errors from
inventory.js. `O.inventory.stock() + low() + overuse()` together take about 2 ms.

## Not done / ideas

- Stock in does not create an expense. That would double count anyone who also records the purchase in Expenses, so it
  needs a product decision first ("also add to Expenses" checkbox for people with `expenses.record`).
- No editing of a saved move (delete and record again). No per-location stock (one store room only).
- Overuse could also open a task ("Check toilet paper use at Highland Villa 2") from the card.

## Requests for core / data

1. **Permission key**: an `inventory.money` action ("See stock costs") would replace the combined rule above
   (`canMoney()` in inventory.js).
2. **data.js**: the generator writes turnover moves for today's check-outs at 11:20 / 12:10, which is after the demo's
   10:15. A housekeeper recording today's restock then double counts (overuse goes 6 → 7 after one save). Stop generating
   moves later than `NOW`, or keep them and rely on the duplicate guard above.
3. **invCats**: register it as a `config` record or blob if categories should exist without an item; today they are
   derived from items.
4. **U.modal**: inventory passes `size: 'wide inv-modal'` to add its own class; a documented `cls` option would be cleaner.
5. The tick list with steppers and the grouped item picker could move into core (`U.itemPicker`) if another page needs them.

During testing every build logged `pageerror: Unexpected end of input` from `app/pages/guestapp.js` (another
engineer's file, mid-edit). It did not affect this page.
