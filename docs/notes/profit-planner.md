# Profit planner (Manage → Profit planner)

## The ask

Arnob, 2026-10-26: "We need to create a system, where I will input all the costs for 1 unit, with certain amount of
profit that I want for this unit, what should be the per night rate to ensure we can get the maximum rent per night with
the highest occupancy. Think deeply and create such a system that will have high statistical and analytical ability and
create different per night rates that when decided we can push to the system. It must mention the pros and cons of
each combination."

So, for one unit:

1. The owner enters what the unit costs (monthly, yearly, one-off, per stay, per night, share of revenue) and the profit
   they want from it each month.
2. Orbique works out the nightly rate needed at each occupancy (pure cost maths), and then, with a demand model, which
   rates guests will actually pay how often (statistics).
3. It offers several rate plans ("combinations") for the chosen dates, each a full set of nightly rates, with expected
   occupancy, profit, a risk range, the chance of reaching the target, and pros and cons in plain words.
4. The owner picks one, previews the nights that change, and pushes it: the prices go into the unit type's main rate
   plan (Calendar → Rates & restrictions, the same path as Pricing → Apply), so every connected booking site gets them.
   Each push can be undone.

"Maximum rent per night with the highest occupancy" pulls two ways: a higher price sells fewer nights. There is no
single price that maximises both, so the planner shows the trade-off as a set of efficient options (each the most profit
possible for its occupancy) and recommends the one with the best chance of reaching the target.

## Files

| File | What |
|---|---|
| `api/_lib/shared/rateplan.cjs` | The engine: cost maths, demand model, optimiser, Monte Carlo, pros and cons. Plain ES5, CommonJS, no clock, no randomness except its own seeded generator. `scripts/build.mjs` inlines it as `O.rateplan` (add it to `SHARED`). |
| `tests/rateplan.test.mjs` | `node --test` unit tests for the engine; add to the "Unit tests" step in `.github/workflows/ci.yml`. |
| `app/pages/planner.js` | The page (`O.page('planner', …)`), styles with `O.css('planner', …)` like the other pages. |
| `app/core.js` | Nav entry after `pricing` in the Manage group, owner-only (`O.OWNER_ONLY.planner = true`: it shows costs and profit), the label in all four nav dictionaries (en, bn, ms, zh), an icon, and the `ratePlanner` blob registered as a `config` blob. |
| `app/pages/pricing.js` | Knows the planner's `how: 'planner'`: the night panel says "Set by the profit planner", the table "Open · profit planner". |
| `supabase/migrations/0016_planner_owner_only.sql` | The `ratePlanner` blob is read and written by owners only (RLS on `public.blobs`). Applies on deploy. |

## Saved data: blob `ratePlanner`

```
D.ratePlanner = {
  units: { [propertyId]: { costs: {…}, profitPerMonth: 1500, assumptions: { only the values changed from the defaults },
                           horizon: 'next90' | 'next30' | 'next60' | 'next180' | 'YYYY-MM-DD' (an end date),
                           keepPeaks: true, updatedAt, by } },
  pushes: [ { id, at, by, pid, typeId, planId, option, n,
              nights: { iso: { from, to, own, how } },   // own and how only for a night that had its own price before
              undoneAt, undoneBy, undoneN, handedN } ]     // newest first, at most 30
}
```

Reading never writes: a unit without saved costs shows empty inputs and the defaults until the owner saves (same rule as
pricing rules). Costs are only kept in this blob; they are not copied anywhere else. Only owners can read or write it
(migration 0016: `blobs_read` hides it from other members, and `blobs_insert` / `blobs_update` add it to the owner-only
keys with `rolePerms` and `staffMeta`), so other members' browsers never load it. The Save audit line names the unit
only ("Saved the profit planner costs and target for Studio 3A"), never amounts, because Activity is open to other staff.

## Engine (`O.rateplan`)

### API

```
R.DEFAULTS            assumption defaults (below)
R.ASSUMPTIONS         [{key, label, help, source, unit, min, max, step}] for the assumptions panel
R.COST_FIELDS         [{key, label, group, per: 'month'|'year'|'once'|'stay'|'night'|'pct', help}] in display order
R.monthlyCosts(costs) {fixedMonthly, capexMonthly, perStay, perNight, pct, lines: [{key, label, monthly}]}
R.requiredRates(costs, profitPerMonth, opts)
                      [{occ, breakEven, target}] for occ = 0.20, 0.25, … 1.00 (net nightly price Orbique stores, before
                      discounts; null where no price works). opts {avgStay, discountLeak}
R.plan(input)         the full analysis (below)
R.evaluate(input, prices, opts)
                      the same stats, risk and pros/cons for any price map {iso: price} (the slider's in-between plans)
R.rng(seed)           the seeded generator (mulberry32), exported for tests
```

`input`:

```
{
  today: 'YYYY-MM-DD',              // not a real date: ignored (each night's lead is then used as given)
  nights: [ { iso /* a real date; others are dropped */, dow /* 0 = Sunday */, lead /* days from today, 0 = tonight */,
              current /* net price now or null */, status: 'open' | 'booked' | 'blocked',
              booked /* net revenue of that night when booked; null or missing when no amount is recorded */ } ],
  costs: {…}, profitPerMonth: number,   // below 0 counts as 0, "cover all costs"
  assumptions: {…},                 // merged over DEFAULTS
  history: { sold, available, avgPaid, priceIndex } | null,   // this unit's own past nights (see Calibration)
  otherTiers: [ { name, prices: {iso: price} } ],      // the building's other unit types, for the tier-order check
  keepPeaks: true,                  // peak nights keep today's price in every option
  floor: null, ceiling: null,       // optional absolute limits (RM)
  basePrice: null,                  // the unit's base price, a fallback for P0
  money: fn,                        // optional: formats money in the sentences (the page passes fmt.money)
  seed: 1, draws: 2000
}
```

A booked night with no amount (`null`, missing, not a number) is counted at today's price (or `P0`) less the usual
discount, and a note says how many; an explicit 0 stays RM0.

### Costs

`R.COST_FIELDS` (all in the building's currency):

- Every month: rent or loan instalment (`rent`), maintenance fee and sinking fund (`maintenance`), internet and TV
  (`internet`), software and channel manager (`software`), staff and management share (`staff`), other monthly
  (`otherMonthly`).
- Every year (÷ 12): insurance (`insurance`), quit rent and assessment (`propertyTax`), other yearly (`otherYearly`).
- One-off, paid back over months: furnishing and renovation (`furnishing`) over `paybackMonths` (default 24).
- Every stay: cleaning and laundry (`cleaning`), guest amenities and welcome pack (`amenities`).
- Every occupied night: electricity and water (`utilities`), consumables (`consumables`).
- Share of revenue (%): owner's share (`ownerSharePct`), payment and bank fees not covered by the channel markups
  (`paymentFeePct`), taxes on revenue (`taxPct`).

Orbique prices are net: what the business takes home after the booking site (each site's markup covers its
commission). So channel commission is not a cost here.

Per sold night, at net price `p`:

```
contribution(p) = p · (1 − leak) · (1 − pct) − perNight − perStay / avgStay
fixed per month = monthly + yearly / 12 + furnishing / paybackMonths
profit (dates)  = Σ booked nights [booked · (1 − pct) − perNight − perStay / avgStay]
                + Σ open nights  [sold · contribution(p)]
                − fixed per month · nights / 30.4
profit per month = profit (dates) / (nights / 30.4)
```

`leak` is the average discount off the stored price (non-refundable −10%, weekly −15%, last-minute −10%), default 6%.

Required rate at occupancy `o` (the cost maths, no demand model):

```
target(o) = ((fixed + profitPerMonth) / (30.4 · o) + perNight + perStay / avgStay) / ((1 − leak) · (1 − pct))
breakEven(o) is the same with profitPerMonth = 0
```

### Demand model

For a night `d` at net price `p`, the chance it sells (at the end, counting every booking site):

```
logit P(d, p) = a + dow[d] + month[d] + peak[d] + pace[month of d] − β · ln(p / P0)
```

- `P0`, the reference price: the median of today's prices on Sun–Thu non-peak nights in the chosen dates; failing that,
  of all non-peak nights; then `basePrice`; then what the booked nights brought in (their median ÷ (1 − leak), rounded
  to `rounding`); then what the costs need at `baseOcc`; RM100 last. `calibration.P0From` says which, and a note says
  so when it is not today's prices.
- `a = logit(baseOcc)`: `baseOcc` is the share of nights the unit sells at `P0` on an average night. Default 0.60
  (Kuala Lumpur: AirDNA 57% and Airbtics 56% for the trailing year to Sep 2026; well-run 2-bedrooms 60–75%).
  Updated from the unit's own history (Calibration). The sentences never name a city: they say `market` (default
  "similar listings") and `marketOcc` (75%); the assumption sources say where Orbique's starting values come from and
  that the bookings behind `dow`, `leadShare` and `avgStay` are one Kuala Lumpur operator's.
- `β`, price sensitivity, default 4: at 60% occupancy a 10% higher price loses about 15% of the bookings
  (elasticity −β(1 − P) ≈ −1.6, inside the −1 to −3 range for a single listing among close substitutes). With costs
  ignored, the revenue-maximising occupancy is 1 − 1/β = 75%, which is where top-decile Kuala Lumpur listings sit.
- `dow` (log-odds, Sun..Sat), default `[+0.05, −0.15, −0.18, −0.15, +0.10, +0.25, +0.30]`: from 310 past bookings
  (Booking.com and Trip.com exports, Jul 2025 to Oct 2026), room-nights by weekday Mon 84, Tue 82, Wed 83, Thu 105,
  Fri 104, Sat 108, Sun 100, shrunk about halfway to zero because the counts are small, with Fri and Sat raised since
  those nights sold at higher prices.
- `month` (log-odds, Jan..Dec), default `[+0.10, −0.10, −0.05, −0.15, −0.10, +0.05, +0.10, +0.20, −0.15, −0.15, −0.10,
  +0.30]`: strongest December, August, January and July; softest April, September, October and Ramadan
  (AirROI and AirDNA month patterns plus last year's bookings).
- `peak[d]`: nights whose current price is at least 25% above the usual price for that kind of night (the median of
  today's prices in the same month and weekday group, Sun–Thu or Fri–Sat) are peak nights (concerts, Christmas, New
  Year, Chinese New Year). The premium is taken as revealed demand: `peak[d] = β · ln(current / usual)`, so at today's
  price a peak night sells as often as a usual night sells at its usual price. Every option keeps that premium shape;
  with `keepPeaks` on, peak nights keep today's price exactly.
- `pace[m]`, from bookings already made: for each month in the dates, the nights already booked `B` against the
  nights the model expects to be booked by now at today's prices,
  `E = Σ P(d, current) · (1 − F(lead d))`, where `F(t)` is the share of bookings made `t` days or less before arrival.
  `θ = (s + B) / (s + E)` with `s = paceStrength` (default 3), `pace = clamp(ln θ, −0.7, +0.7)`.
- Nights still unsold `t` days before arrival: `P_open = P · F(t) / (1 − P · (1 − F(t)))` (the chance it still sells,
  given it hasn't yet).
- `F` (lead-time curve), default from the same 310 bookings: share booked within 0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 45,
  60 days = 0.28, 0.54, 0.64, 0.69, 0.73, 0.77, 0.83, 0.89, 0.93, 0.94, 0.98, 1.00 (linear in between). Median lead time
  1 day, so this is a last-minute market.
- `avgStay`, default 2.7 nights (same bookings; 37% one-night stays).

### Uncertainty (Monte Carlo)

Each draw `j` (seeded, `draws` default 2000): `a_j = a + N(0, sdA)`, where `sdA` is half the width of
`logit(baseOcc ± baseOccSd)` with each end kept inside 1% to 99% (default 0.08 in occupancy, about 0.33 in log-odds at
60%; near the limits a wide margin widens the range without moving the expected forecast); `β_j = β · exp(N(0, 0.3))`; a month shock `N(0, 0.15)` per month; then each
open night sells with probability `P_open` (Bernoulli). Booked nights are certain (cancellations are not modelled).
From the draws: profit per month P10, P50, P90, chance of reaching the target, chance of a loss. A "weak demand"
check re-runs the expectation with `a − 0.45` (about 20% fewer bookings at the same prices). The percentage the
sentences quote is worked out once per model, from today's prices (or Most profit's when no night has a price), so the
cards and the slider say the same.

### Optimiser and the options

Per open night, candidate prices from `minFactor · base` to `maxFactor · base` (defaults 0.6 and 1.8, where `base` is
today's price, or `P0` for nights with none), in steps of `rounding` (RM5), inside `floor` and `ceiling`. For each
candidate the mean selling chance over K = 48 parameter draws, `P̄(p)`, is computed once. For a value `λ` (RM placed on
each extra night sold, on top of its profit) the night's price is

```
argmax_p  P̄(p) · contribution(p) + λ · P̄(p)
```

Every `λ` gives an efficient plan: the most profit possible for its occupancy. The frontier is a grid of `λ` from
`−0.6 · P0` (rate first) to `+1.2 · P0` (occupancy first), 25 steps with `λ = 0` among them, each with expected
occupancy, net ADR, profit per month and chance of the target (400 draws while searching). The target is reachable
when some plan's expected profit reaches it; otherwise the goal is 0 (covering all costs).

An edge plan (Fill, Premium) must reach the goal with a margin, `max(RM5, 0.5% of the goal)`, on the 48 draws that
chose it and again on KC = 144 fresh stratified draws, so "reaches the target" does not hang on the noise of the draws
that put it at the edge. The last plan that passes on each side of `λ = 0` is found by halving the gap to the first
plan that fails (12 halvings); when even the grid's ends pass, the grid is extended outwards until the prices stop
moving. By construction an edge plan reaches the goal on about half the draws, so its summary says "on average" and
quotes its chance.

The options, in display order:

| key | Name | Which plan |
|---|---|---|
| `current` | Today's prices | What Orbique has now, through the same model. |
| `fill` | Fill the calendar | The highest expected occupancy that still passes the goal check. Out of reach, the highest occupancy that still covers costs on average. |
| `balanced` | Balanced | Recommended; see below. |
| `profit` | Most profit | `λ = 0`, the highest expected profit (the smallest loss when every plan loses). |
| `premium` | Premium rates | The highest net ADR that still passes the goal check. Out of reach, the highest ADR that still covers costs on average. |

Then, with all the draws, an option that beats Most profit on profit, or (reaching the goal) Fill on occupancy or
Premium on ADR, takes that role, and the two merge. Today's prices take another role only when every open night has a
price inside `floor` and `ceiling`; otherwise a card named for the planner would show prices it would not choose.

Balanced counts chances within the Monte Carlo's own noise, `max(0.01, 2 · √(p(1 − p) / draws))`, as equal; among
equals the higher expected profit (then the better P10) wins, so the pick does not swing with the seed on the flat top
of the chance curve. The rules:

- The target is reachable on average, or some plan has an even chance or better: the best chance of the target.
- Otherwise, among the plans with at least Most profit's occupancy (Fill's side): the best chance of covering all costs
  while the plans really differ on it (below 95%), unless another plan has a clearly better chance of the target; with
  no real chance of the target anywhere (under 5%), the most profit. When a dearer plan has a clearly better long-shot
  chance, the summary says so ("Higher prices could raise that chance a little, but would make less on average").
- No plan covers its costs on average: Most profit, the smallest loss, so the recommended plan is never beaten on
  occupancy, profit and P10 at once.

It is searched on the frontier with 400 draws; the best three, their neighbours and the other options are then compared
with all the draws.

Options that come out with the same prices are merged into one card with both names (`keys`, `names`). Tags:
"Recommended" on Balanced; out of reach, Fill and Premium say "Misses the target", or "Breaks even only" when they make
less than RM50 a month either way. When Fill or Premium stopped at a limit (the owner's floor or ceiling when it cut
most nights' range, else Lowest or Highest price to try), the summary names that limit and a note says lower or higher
prices could still work.

`notes`, in this order: nothing to price; dates under 14 nights ("the monthly figures are rough"); open nights with no
price today; booked nights with no amount; where `P0` came from when not today's prices; peak nights kept or held;
Fill or Premium stopped at a limit; a late-booking market (6 in 10 or more of Balanced's likely nights usually book in
the last 3 days); and out of reach "On average, no plan reaches RM 1,500 a month. The best one makes about RM 900 a
month, about RM 600 short; …", what it would take (lower costs, or more bookings when that alone can do it), and "On
average, no plan covers all costs in these dates either." when that is true too. With a target of 0 the words are about
covering all costs.

`demandCurve`: today's prices scaled together from `minFactor` to `maxFactor`. Open nights with no price today stay
unpriced and do not sell, as in Today's prices, so at factor 1 the curve passes through that card; with no prices at
all, every night starts from `P0`.

Each option: `{key, keys, name, names, summary, tag, recommended, reachesTarget, prices: {iso: price}, changes, stats,
byMonth, nightly, pros, cons}` where `stats` has `occ` (all nights in the dates), `occOpen`, `soldNights`, `adr` (net
after discounts), `listAdr`, `avgPrice` (mean of the open nights' prices, the cards' Average rate), `revpar`,
`revenue`, `costs`, `profit`, `profitPerMonth`, `p10`, `p50`, `p90`, `pTarget`, `pLoss`, `pBreakEven`, `breakEvenOcc`,
`targetOcc`, `stays`, `weekday`, `weekend`, `peak`, `minPrice`, `maxPrice`, `lateShare`, `weakDemandProfitPerMonth`, and
`vsCurrent`.

`R.plan` for 365 nights takes about 0.2 to 0.3 s on the test container (a test keeps it under 2 s), so it runs on the
page's main thread.

### Pros and cons

Written by the engine from the numbers, in plain words, one sentence each. Order: the chance of the target, losing
money, the order against the building's other unit types, then the rest; the page shows three of each, so these come
first. Numbers are compared as rounded, the way they are shown, so no sentence says "73% … more than the 73%".

- The chance of the target: "Almost certain to make RM 1,500 a month" (95% or more), "About 7 in 10 chance of making
  RM 1,500 a month" (a pro from 55%), "About an even chance of …" (45% to 55%, a con: it could go either way), a con
  below that, and "Little chance of …, less than 1 in 20" under 5%.
- Losing money, only when the target is above 0 (with a target of 0 the chance above already says it).
- Tier order: "On 4 nights this unit would cost as much as or more than Deluxe, a better unit type in this building",
  or less than a cheaper one ("costs" for Today's prices).
- The occupancy it needs against what is likely to sell and the market ("Needs 72% of nights sold to reach the target;
  few similar listings sell more than 75%"), and, when the plan's own forecast is above `marketOcc`, "treat this plan's
  numbers as optimistic".
- Against today's prices: profit, prices ("Prices are about RM 20 a night higher than today on average", the cards'
  Average rate), nights sold, stays to clean, reviews and placement, and how far it moves from today. Under 30 nights
  the counts are "over these dates", not "a month".
- With peak nights kept at today's price: a con when ordinary weekday or weekend nights would cost more than the peaks.
- Weak demand ("If demand is 20% weaker, profit falls to about RM 400 a month").
- Late bookings: a con only when the plan relies on them clearly more than today's prices (6 in 10 or more of its
  nights, and 1 in 10 more than today); the dates' own pattern is a note.

### Calibration

- History: the page passes this unit's last 60 days of nights that had a price: `sold`, `available` and `avgPaid`, the
  average net per sold night (as `booked` below). The engine sets it against `P0 · (1 − leak)`, the same kind of amount,
  for the price index (else the caller's `priceIndex`, else 1). `a` moves toward the observed level in log-odds,
  adjusted for the price paid (`logit q_ref = logit q_obs + β · ln priceIndex`), weighted `available / (available + 60)`.
  The sentence says both: "Your last 60 nights with a price: 36 sold (60%) at about 2% below the usual price, so the
  usual occupancy moves from 60% to 59%." (or "stays at 60%").
- Pace (above) for the coming months.
- `result.calibration` reports what was used, so the page can show it ("3 nights booked in November; about 5 expected
  by now: November demand lowered").

## The page

1. Toolbar: unit picker (units in view, not archived), dates (next 30, 60, 90, 180 days, or until a date), saved state.
2. Costs card: the fields grouped as above, live totals ("RM2,450 fixed a month, RM120 per stay, RM18 per night"), the
   monthly profit target. When Expenses has entries for this unit, show the last 3 months' monthly average as a hint.
   Under Share of revenue: "Leave out booking-site commission: each site's markup already covers it."
3. Headline (the recommended option): average nightly rate with its parts (Sun–Thu, Fri–Sat, Peak), expected
   occupancy, profit a month with its P10–P90 range, chance of reaching the target. Long amounts get a smaller size
   instead of being cut, and "RM" never wraps away from its number.
4. The maths: required rate at 40–90% occupancy (break-even and target), and a chart of the rate needed at each
   occupancy (cost curve) against what the demand model says guests will pay (uniform scaling of today's prices), with
   the options as dots. One y-axis: the price per night sold. The dots sit at each plan's `listAdr`, the average price
   of the nights it sells with booked nights included, and the chart says so (a dot can sit away from the card's
   Average rate). Dots closer than 20px share one hit circle and one tooltip ("Plans close together").
5. Options: one card per option with the key numbers, pros and cons, and "Preview" / "Push".
6. Fine-tune: a slider along the frontier from "Higher rate" to "More nights" with live numbers (`R.evaluate`), shown
   as "Your own mix".
7. Preview: by month ("Profit in the month", with a total row for all the dates) and by night (date, today, new,
   change, status; the change column is left out on phones), toggle "Keep peak nights at today's price". Opening it
   scrolls its title to just below the top bar.
8. Push history with Undo.
9. Assumptions (collapsed): every `R.ASSUMPTIONS` value with its source and a reset, plus what calibration used. The
   summary ("1 value changed from the defaults") and "Reset all" follow every edit; the plans use the values straight
   away, and Save costs and target keeps them for next time.

A redraw while a number field has focus puts the focus and the cursor back at the end of the field. If the engine
throws, the page shows "Orbique could not work out the plans for these dates. Try other dates or check the costs." and
the error goes to the console only.

The input the page builds: each night's price now and status; a booked night's `booked` is the booking's net per night,
`(accommodation − platformFee) / nights` when the booking has `accommodation`, else `(payout or total − tourismTax −
cleaningFee − platformFee when it is still in the total) / nights`, and `null` when the booking has no amounts. History
`avgPaid` is the same figure averaged over the sold nights that have one.

Push. The confirm says what changes ("Change 60 nights for Deluxe (applies to all 3 units of the type) on every booking
site.", or "in Orbique." when the type is not connected), the dates, the average price now and after with its range,
how many nights go up, down or get a price, and expected profit and nights sold against today's prices; for a unit type
it says these are worked out for this unit and the other units get the same prices. Its Push button takes the focus,
and only one dialog opens at a time. On Push the page checks that the plans are still the ones the dialog showed and
that the nights and their prices now are the same; if not, it says so and pushes nothing (stale plans are worked out
again).

Then one `O.channel.setDays` call on the unit type's main plan (`O.channel.mainPlan(typeId)`) with
`{planId, dates: [iso], set: {rate}}` per changed night (it also writes `priceOverrides` for every unit of the type),
`opts {emit: false, audit: false, how: 'planner'}`; a unit without a main plan writes `D.priceOverrides` /
`D.priceOverrideMeta` directly like `applyPrices` in pricing.js. Then `D.priceLog`, the audit log, the push record in
`D.ratePlanner.pushes` (for a night that had its own price, `own: true` and its `how`, so Undo can put the label back
too), and one `O.emit('data', {type: 'pricing'})`.

Undo puts back the nights still at the push's price:

- An own price goes back with its old `how` (one `setDays` per `how`); a night with no own price before is cleared.
- Through the plan the push used while it is still the type's main plan, else the type's main plan now; with no main
  plan, the units' `priceOverrides` directly (every unit of the type when the push went through a plan).
- A night a later push (not undone, same unit or type) changed again from this push's price is handed over: the later
  push takes this push's `from`, so undoing it later puts back the price from before both, in any order.
- Nights changed by hand since keep their newer price and past nights are skipped; the confirm says how many, and for
  a unit type which units.
- After the confirm closes it checks again (a second Enter, or prices that changed while it was open), and the record
  is marked undone (`undoneAt`, `undoneN`, `handedN`) only once every night shows its old price again.

Audit lines and the price log name the plan ("the Balanced plan", "your own mix of prices") and the nights, never
costs, targets or profits. Pushing needs the `pricing.change` permission; the page itself is owner-only.
