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
   plan (Calendar → Rates & restrictions, the same path as Pricing → Apply), so every booking site gets them.
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

## Saved data: blob `ratePlanner`

```
D.ratePlanner = {
  units: { [propertyId]: { costs: {…}, profitPerMonth: 1500, assumptions: { only the values changed from the defaults },
                           horizon: 'next90' | 'next30' | 'next60' | 'next180' | 'YYYY-MM-DD' (an end date),
                           keepPeaks: true, updatedAt, by } },
  pushes: [ { id, at, by, pid, typeId, planId, option, n, nights: { iso: { from, to } }, undoneAt } ]   // newest first, at most 30
}
```

Reading never writes: a unit without saved costs shows empty inputs and the defaults until the owner saves (same rule as
pricing rules). Costs are only kept in this blob; they are not copied anywhere else.

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
  today: 'YYYY-MM-DD',
  nights: [ { iso, dow /* 0 = Sunday */, lead /* days from today, 0 = tonight */, current /* net price now or null */,
              status: 'open' | 'booked' | 'blocked', booked /* net revenue of that night when booked, else 0 */ } ],
  costs: {…}, profitPerMonth: number,
  assumptions: {…},                 // merged over DEFAULTS
  history: { sold, available, priceIndex } | null,   // this unit's own past nights (see Calibration)
  otherTiers: [ { name, prices: {iso: price} } ],      // the building's other unit types, for the tier-order check
  keepPeaks: true,                  // peak nights keep today's price in every option
  floor: null, ceiling: null,       // optional absolute limits (RM)
  seed: 1, draws: 2000
}
```

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

- `P0`, the reference price: the median of today's prices on Sun–Thu non-peak nights in the chosen dates (falls back to
  the property's base price).
- `a = logit(baseOcc)`: `baseOcc` is the share of nights the unit sells at `P0` on an average night. Default 0.60
  (Kuala Lumpur: AirDNA 57% and Airbtics 56% for the trailing year to Sep 2026; well-run 2-bedrooms 60–75%).
  Updated from the unit's own history (Calibration).
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

Each draw `j` (seeded, `draws` default 2000): `a_j = a + N(0, sdA)` with `sdA` from `baseOccSd` (default 0.08 in
occupancy, about 0.33 in log-odds at 60%); `β_j = β · exp(N(0, 0.3))`; a month shock `N(0, 0.15)` per month; then each
open night sells with probability `P_open` (Bernoulli). Booked nights are certain (cancellations are not modelled).
From the draws: profit per month P10, P50, P90, chance of reaching the target, chance of a loss. A "weak demand"
check re-runs the expectation with `a − 0.45` (about 20% fewer bookings at the same prices).

### Optimiser and the options

Per open night, candidate prices from `minFactor · base` to `maxFactor · base` (defaults 0.6 and 1.8, where `base` is
today's price, or `P0` for nights with none), in steps of `rounding` (RM5), inside `floor` and `ceiling`. For each
candidate the mean selling chance over K = 48 parameter draws, `P̄(p)`, is computed once. For a value `λ` (RM placed on
each extra night sold, on top of its profit) the night's price is

```
argmax_p  P̄(p) · contribution(p) + λ · P̄(p)
```

Every `λ` gives an efficient plan: the most profit possible for its occupancy. The frontier is a grid of `λ` from
`−0.6 · P0` (rate first) to `+1.2 · P0` (occupancy first), about 25 steps, each with expected occupancy, net ADR,
profit per month and chance of the target (400 draws while searching).

The options, in display order:

| key | Name | Which plan |
|---|---|---|
| `current` | Today's prices | What Orbique has now, through the same model. |
| `fill` | Fill the calendar | The highest expected occupancy whose expected profit still reaches the target. If no plan reaches the target, the highest occupancy that still breaks even (labelled so). |
| `balanced` | Balanced | The plan with the highest chance of reaching the target (between `profit` and `fill`). Recommended. |
| `profit` | Most profit | `λ = 0`, the highest expected profit. |
| `premium` | Premium rates | The highest net ADR whose expected profit still reaches the target. |

Options that come out with the same prices are merged into one card with both names. When the target is out of
reach, `fill`/`premium` say so, `balanced` maximises the chance of breaking even, and `notes` says how far the best plan
falls short and how much lower the costs or higher the demand would need to be.

Each option: `{key, name, summary, prices: {iso: price}, changes, stats, byMonth, pros, cons}` where `stats` has
`occ` (all nights in the dates), `occOpen`, `soldNights`, `adr` (net after discounts), `listAdr`, `revpar`,
`revenue`, `costs`, `profit`, `profitPerMonth`, `p10`, `p50`, `p90`, `pTarget`, `pLoss`, `breakEvenOcc`, `targetOcc`,
`stays`, `weekday`, `weekend`, `peak`, `minPrice`, `maxPrice`, `weakDemandProfitPerMonth`, and `vsCurrent`.

### Pros and cons

Written by the engine from the numbers, in plain words, one sentence each, for example:

- the chance of reaching the target ("About 8 in 10 chance of making RM1,500 a month");
- the occupancy it needs against the market ("Needs 72% of nights sold to reach the target; few Kuala Lumpur
  2-bedrooms sell more than 75%");
- profit and ADR against today's prices;
- cleanings and turnovers (more stays: more cleaning, wear and messages; fewer: less work);
- weak demand ("If demand is 20% weaker, profit falls to RM400 a month");
- reviews and ranking (more stays bring more reviews and better placement on booking sites);
- how far it moves from today's prices (the model knows less about prices guests haven't seen);
- reliance on last-minute bookings;
- tier order: nights priced at or above a better unit type in the same building, or below a cheaper one.

### Calibration

- History: the page passes this unit's last 60 days of nights that had a price: sold, available, and the average of
  paid net ÷ `P0`. `a` moves toward the observed level in log-odds, adjusted for the price paid
  (`logit q_ref = logit q_obs + β · ln priceIndex`), weighted `available / (available + 60)`.
- Pace (above) for the coming months.
- `result.calibration` reports what was used, so the page can show it ("3 nights booked in November; about 5 expected
  by now: November demand lowered").

## The page

1. Toolbar: unit picker (units in view, not archived), dates (next 30, 60, 90, 180 days, or until a date), saved state.
2. Costs card: the fields grouped as above, live totals ("RM2,450 fixed a month, RM120 per stay, RM18 per night"), the
   monthly profit target. When Expenses has entries for this unit, show the last 3 months' monthly average as a hint.
3. Headline (the recommended option): average nightly rate, expected occupancy, profit a month with its P10–P90 range,
   chance of reaching the target.
4. The maths: required rate at 40–90% occupancy (break-even and target), and a chart of the rate needed at each
   occupancy (cost curve) against what the demand model says guests will pay (uniform scaling of today's prices), with
   the options as points. One y-axis.
5. Options: one card per option with the key numbers, pros and cons, and "Preview" / "Push".
6. Fine-tune: a slider along the frontier from "Higher rate" to "More nights" with live numbers (`R.evaluate`).
7. Preview: by month and by night (date, today, new, change, status), toggle "Keep peak nights at today's price".
   Push asks to confirm: "Change N nights for Standard (applies to all N units of the type) on every booking site".
8. Push history with Undo (restores the `from` prices).
9. Assumptions (collapsed): every `R.ASSUMPTIONS` value with its source and a reset, plus what calibration used.

Push: one `O.channel.setDays` call on the unit type's main plan (`O.channel.mainPlan(typeId)`) with
`{planId, dates: [iso], set: {rate}}` per changed night (it also writes `priceOverrides` for every unit of the type),
`opts {emit: false, audit: false, how: 'planner'}`; a unit without a main plan writes `D.priceOverrides` /
`D.priceOverrideMeta` directly like `applyPrices` in pricing.js. Then `D.priceLog`, the audit log, the push record in
`D.ratePlanner.pushes`, and one `O.emit('data', {type: 'pricing'})`. Pushing needs the `pricing.change` permission;
the page itself is owner-only.
