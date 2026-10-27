# Profit planner (Manage → Profit Planner)

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
| `app/core.js` | Nav entry after `pricing` in the Manage group, owner-only (`O.OWNER_ONLY.planner = true`: it shows costs and profit), the label in all four nav dictionaries (en "Profit Planner" in Title Case like the other English labels, bn, ms, zh), an icon, and the `ratePlanner` blob registered as a `config` blob. It also registers `lastMinuteDeal` (the workspace's last-minute deal, which the channel manager applies) as a `config` blob, so the page can read it. |
| `app/pages/pricing.js` | Knows the planner's `how: 'planner'`: the night panel says "Set by the profit planner", the table "Open · profit planner". A "Profit Planner" button in the page's own toolbar, next to Auto-apply, opens the planner for the same unit (the top bar keeps its two buttons, so it does not wrap on tablets and phones). Below 560px it is a 40px icon button (named "Profit Planner") beside the unit select, so the date range and Auto-apply keep their row. |
| `supabase/migrations/0016_planner_owner_only.sql` | The `ratePlanner` blob is read and written by owners only (RLS on `public.blobs`), and an app save of it is merged with what is saved (below). Applies on deploy; re-runnable. |
| `tests/sql/planner.sql` | The 0016 rules and the merge, run by `tests/sql/run.sh` ("== profit planner (0016)"), which also re-runs 0016 to check it is re-runnable. |

## Saved data: blob `ratePlanner`

```
D.ratePlanner = {
  units: { [propertyId]: { costs: {…}, profitPerMonth: 1500, assumptions: { only the values changed from the defaults },
                           horizon: 'next90' | 'next30' | 'next60' | 'next180' | 'YYYY-MM-DD' (an end date),
                           keepPeaks: true, floor: 200 | null, ceiling: 600 | null,   // price limits, RM a night
                           updatedAt, by } },
  pushes: [ { id, at, by, pid, typeId, planId, option, name, n,   // name: the card's name ("Balanced and Most profit")
              nights: { iso: { from, to, own, how, by, at, handedAt } },   // own, how, by and at only for a night that had
                                                                // its own price before (by and at: who set it and when);
                                                                // handedAt: when an Undo of an earlier push handed it on
              undoneAt, undoneBy, undoneN, handedN, planN,
              changedAt } ]   // set by Undo on the push it undoes and on a later push it hands nights to; newest first, at most 30
}
```

A blob is last-write-wins, so a device that missed another device's push (its live connection was down) would drop that
push record when it saved costs, and the pushed prices could no longer be undone. Migration 0016 therefore merges every
app save of `ratePlanner` with what is saved (`blobs_planner_merge`, a `before update` trigger): every unit either copy
has, the one saved last (`updatedAt`) where both have it; every push record either copy has, by `id`, the undone copy
where only one is undone (an Undo is never lost), else the copy changed last (`changedAt`, else `undoneAt`; a copy that
never changed has neither and loses to one that did, even in the same minute; the new copy on a tie), so a device that
missed an Undo cannot bring back a stale copy of the later push the Undo handed nights to. Within that record each night
comes from the copy that handed it on last (`handedAt`; the picked copy on a tie), so two devices that each handed
different nights to the same push keep both. Saved records without an `id` are dropped (the app gives every push one).
Newest first, at most 30. ISO
times compare byte by byte (`collate "C"`), whatever the database's collation. The merged value comes back to every device through the live
connection like any other change. Writes from the server (no signed-in user) are stored as sent. The practice copy has
no server, so two tabs of it still work last-write-wins.

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
              booked /* net revenue of that night when booked; null or missing when no amount is recorded */,
              stay /* booked: the booking it belongs to (its nights cancel together) */,
              firm /* booked: true once the guest is in, so it can no longer cancel */ } ],
  costs: {…}, profitPerMonth: number,   // below 0 counts as 0, "cover all costs"
  assumptions: {…},                 // merged over DEFAULTS
  history: { sold, available, avgPaid, priceIndex } | null,   // this unit's own past nights (see Calibration)
  otherTiers: [ { name, prices: {iso: price}, better? } ],   // the building's other unit types, for the tier order;
                                    // the page sends no `better`, so it is worked out from the usual (median) prices
  keepPeaks: true,                  // peak nights keep today's price in every option
  floor: null, ceiling: null,       // optional absolute limits (RM); the result's `limits` gives them as the prices
                                    // use them, on the rounding step ({floor: 205, ceiling: 295}; null when not set;
                                    // the floor wins when no step fits between them)
  basePrice: null,                  // the unit's base price, a fallback for P0
  lastMinute: null,                 // the workspace's last-minute deal (blob lastMinuteDeal): {pct, days, nights, skip, until}
  specialDates: [],                 // the owner's special nights (the page passes the deal's skip dates)
  money: fn,                        // optional: formats money in the sentences (the page passes fmt.money)
  seed: 1, draws: 2000
}
```

A booked night with no amount (`null`, missing, not a number) is counted at today's price (or `P0`) less the usual
discount, and a note says how many; an explicit 0 stays RM0.

The result also has `deal: {pct, days, nights}` (the last-minute deal as the forecast counted it, `nights` the open
nights it covers) or `null`, and each option's `nightly` rows carry `deal: true` on the open nights the deal covers.

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
contribution(p) = p · R · (1 − leak) · (1 − pct) − perNight − perStay / avgStay
fixed per month = monthly + yearly / 12 + furnishing / paybackMonths
profit (dates)  = Σ booked nights [keep · (booked · (1 − pct) − perNight − perStay / avgStay)
                                   + (1 − keep) · resell · contribution(today's price)]
                + Σ open nights  [sold · contribution(p)]
                − fixed per month · nights / 30.4
profit per month = profit (dates) / (nights / 30.4)
```

`leak` is the average discount off the stored price (non-refundable −10%, weekly −15%, last-minute −10%), default 6%.
With a last-minute deal it can be 2 to 3 points lower, as the deal is then counted night by night as well (its help
says so).

`keep = 1 − cancelRate` for a booked night (1 once the guest is in, `firm`); a cancelled night sells again with
`resell`, its open chance now at today's price (below).

`R`, the last-minute deal, mirrors `lastMinuteFactor` in `api/_lib/channex-sync.js`: the deal (`pct` above 0 and
under 60, `days` a whole number from 1 to 14) covers a night up to `until`, not in `skip`, on one of its weekdays
(`nights`, 0 = Sunday; all when not given), and takes `pct` off when the night is booked `days − 1` days or less before
it. The prices stay the ones before the deal; the money is less by the share of the night's remaining sales that come
in that window: `R = 1 − pct` inside the window, else `R = 1 − pct · F(days − 1) / F(lead)`. A note says how many nights
it covers: "Your last-minute deal takes 10% off 45 of the 82 open nights when they are booked in the last 3 days before
the night. The forecast counts it, and the prices here are the ones before the deal." The lower price could also sell a
few more late nights; the forecast leaves that out, so it errs on the side of less.

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
- `dow` (log-odds, Sun..Sat), default `[−0.07, −0.07, −0.07, −0.07, −0.07, +1.05, +1.10]`: from 310 past bookings
  (Booking.com and Trip.com exports, Jul 2025 to Oct 2026), room-nights by weekday Mon 84, Tue 82, Wed 83, Thu 105,
  Fri 104, Sat 108, Sun 100. Sunday to Thursday differ by no more than the small counts allow, so they share one value.
  Friday and Saturday sold as many nights as Thursday at prices about 27% higher (`ln 1.27 ≈ 0.24`), so at the same
  price they would sell far more: their values are the count difference plus `β · 0.24 ≈ 0.96`, so at their own higher
  prices they sell a little more often than a weekday at its price, as the counts show. The weekday value centres the seven around 0. (The earlier
  values had Fri and Sat only +0.25 and +0.30, so at today's 26% weekend premium they forecast weekends selling far less
  than weekdays, which the bookings do not show, and they gave Thursday and Sunday a lift the counts do not support.)
- `month` (log-odds, Jan..Dec), default `[+0.10, −0.10, −0.05, −0.15, −0.10, +0.05, +0.10, +0.20, −0.15, −0.15, −0.10,
  +0.30]`: strongest December, August, January and July; softest April, September, October and Ramadan
  (AirROI and AirDNA month patterns plus last year's bookings).
- `peak[d]`: nights whose current price is at least `peakThreshold` (25%) above the usual price for that kind of night
  are peak nights (concerts, Christmas, New Year, Chinese New Year). Special nights are peaks whenever they are priced
  above the usual price: the owner's own (`specialDates`, the last-minute deal's skip dates) and the holidays every
  year (24, 25 and 31 December, 1 January). The usual price for a kind of night (Sun–Thu or Fri–Sat) is the lower of
  the median of today's prices on the ordinary (not special) nights of the same month, when there are at least 3, and
  the median of that kind of night over all the dates, so a month full of events (December) does not make its events
  look usual. The premium is taken as revealed demand: `peak[d] = β · ln(current / usual)`, so at today's price a peak
  night sells as often as a usual night sells at its usual price. Every option keeps that premium shape; with
  `keepPeaks` on, peak nights keep today's price exactly. `calibration.peaks` lists them with `special`.
- `pace[m]`, from bookings already made: for each month in the dates, the nights already booked `B` against the
  nights the model expects to be booked by now at today's prices,
  `E = Σ P(d, current) · (1 − F(lead d))`, where `F(t)` is the share of a night's bookings made `t` days or less before
  it. Peak nights are left out of both (their premium already stands for their demand, and they book further ahead
  than the all-year curve), and blocked nights too. A booked night counts as `1 − cancelRate`, as the curve counts the
  stays that went ahead. `θ = (s + B) / (s + E)` with `s = paceStrength`, default 25 nights (about 9 stays: a few early
  bookings move a month only a little), `pace = clamp(ln θ, −0.7, +0.7)`. The sentence shows `E / (1 − cancelRate)`,
  on the same footing as the booked count, to one decimal under 10 ("No nights booked in November yet; about 3.4
  expected by now: November demand lowered."), says "left as it is" when the effect is under 0.05 or the two numbers it
  shows are the same, and is left out for a month with nothing booked, under 0.5 expected and no effect.
- Nights still unsold `t` days before arrival. Guests looking for a night arrive at random over time and the first one
  who accepts the price takes it. With `H` the share of those guests still to come, an open night sells with
  `P_open = 1 − (1 − P)^H`. `H` comes from the lead-time curve at the usual occupancy `q = baseOcc`, where the curve
  was measured: `H = 1 − ln(1 − q · (1 − F(t))) / ln(1 − q)`. At the usual price this gives exactly the share of nights
  still to sell, `q · F / (1 − q · (1 − F))`; at other prices the same guests are still to come, so a dearer night
  loses more of its late chance than a cheaper one. (The earlier `P · F / (1 − P · (1 − F))` is the same at the usual
  price but treats the curve as if it changed with the price.)
- `F` (lead-time curve), default from the same 310 bookings, each spread over its nights (a 3-night stay booked 2
  days ahead is booked 2, 3 and 4 days before its nights): share of nights booked within 0, 1, 2, 3, 5, 7, 10, 14, 21,
  30, 45, 60 days = 0.10, 0.25, 0.37, 0.46, 0.58, 0.64, 0.70, 0.78, 0.85, 0.92, 0.97, 1.00 (linear in between). A
  quarter of the nights are booked 1 day or less before the night and almost half 3 days or less, so this is a
  late-booking market. (The earlier curve, 0.28 same day and 0.54 within a day, counted stays by their first night.)
- `avgStay`, default 2.7 nights (same bookings; 37% one-night stays).
- `cancelRate`, default 0.11: the share of the stays already booked that cancel before arrival. In the same bookings
  about 16% of the nights on Booking.com's books later cancelled, and Trip.com bookings cancelled about half as often;
  11% is the blend. A booked night counts as `1 − cancelRate` sold plus `cancelRate ·` its open chance now at today's
  price (it may sell again); a stay the guest is in (`firm`) does not cancel.

### Uncertainty (Monte Carlo)

Each draw `j` (seeded, `draws` default 2000): `a_j = a + N(0, sdA)`, where `sdA` is the narrower one-sided width,
`min(logit(baseOcc + baseOccSd) − logit(baseOcc), logit(baseOcc) − logit(baseOcc − baseOccSd))`, with each end kept
inside 1% to 99% (the other side alone when one end is past a limit). Default 0.12 in occupancy, about 0.49 in log-odds
at 60%: a unit with little history of its own could sell well above or below the market figures. The unit's own
history narrows it as it moves `a`: with history weight `w`, `sdA · √(1 − w)` (60 nights of history, `w = 0.5`, give
about 0.34). Log-odds stretch towards 0% and 100%, so the wider side would spread the draws far out near either limit; with
the narrower one a wide margin near a limit widens the range and moves the expected forecast only a little (at 20% with
±20 points, about 3 points instead of about 8). `β_j = β · exp(N(0, 0.3))`; a month shock `N(0, 0.15)` per month; then each
open night sells with probability `P_open` (Bernoulli), as the uniform `U` below `1 − (1 − P)^H`, stored as the
threshold `1 − (1 − U)^(1/H)` in log-odds. Booked nights: each stay (a booking, `stay`; without one, a run of booked
nights) cancels with `cancelRate` unless the guest is in, and a cancelled night then sells again with its open chance
now. These are drawn after every other stream, so the other draws do not change with the bookings.
From the draws: profit per month P10, P50, P90, chance of reaching the target, chance of a loss. A "weak demand"
check re-runs the expectation with `a − 0.45` (about 20% fewer bookings at the same prices). The percentage the
sentences quote is worked out once per model, from today's prices (or Most profit's when no night has a price), so the
cards and the slider say the same.

### Optimiser and the options

Per open night, candidate prices from `minFactor · base` to `maxFactor · base` (defaults 0.6 and 1.8, where `base` is
today's price, or `P0` for nights with none), in steps of `rounding` (RM5), inside `floor` and `ceiling`, and in order
with the building's other unit types that night and apart from them by `tierGap` (5%): at most `price / (1 + tierGap)`
of every better type and at least `price · (1 + tierGap)` of every cheaper type, so the better type is at least 5%
dearer than the cheaper one. Where the two are closer than that today, today's gap is the limit instead, so today's
prices stay allowed when they are on the rounding step; and always strictly below a better type and strictly above a
cheaper one. `tierGap` is kept to a tenth of a percent and written exactly ("4.5%"); at 0 the order alone is kept (one
step apart). Which type is better is worked out from the usual (median) prices over the dates; a type whose usual price
is less than one rounding step from this unit's (at most 2%, at least 1%) is a peer, with no order kept against it and
a note ("Twin has about the same usual price as this unit, so the plans keep no order against it"). The notes name only
the types whose limit set the bound that night, not every type with a price.

When a cheaper and a better type are too close for the gap (no step fits both limits), that night keeps the order only,
with a note ("On 75 nights Standard and Premium are too close in price to keep this unit 5% from both, so there the
plans only keep it between them"); when no step fits strictly between them at all, the night takes one price, the step
nearest today's price when it is between them, else nearest halfway, the lower step on a tie and never above the better
type's price, so this unit is never dearer than the better type; it then has no choice of price (like a night whose own
limits leave one), and a note says so ("On 24 nights no price in steps of RM 10 fits between Standard and Premium, so
there the plans use a single price, the step nearest today's price or halfway, never above the dearer type"). When the
owner's floor or ceiling, or the range of prices tried, leaves no price inside the limits, the night takes the end of
that range nearest them (the floor and ceiling win) and its own note names the cause ("On 12 nights your lowest price,
RM 250, leaves no room under Deluxe, so the plans use it there"; "the lowest price tried (60% of today's)", "(60% of
the usual price)" when none of those nights has a price today; "your highest price"; "the highest price tried (180% of
today's)"). Each night is in one of these notes at most, and only nights that keep the gap count in the order note
below.

Each type is still planned on its own, against the others' prices at the time, so the gap is a minimum, not a target.
Pushing the recommended plan of each type in turn keeps the building's ladder (Standard below Boutique below Premium)
with gaps of about `tierGap`: on the Kozi copy, pushing Standard, Boutique and Premium in turn left median gaps of RM15
and RM15 (today RM45 and RM40; one step, RM5, before the gap), stable on a second round. Pushing Premium first left
RM35 and RM45, but planning again lowers Boutique and Premium for two more rounds (Premium's average RM369, then 359,
then 346) until every rung sits at the minimum gap (medians about 6.8% and 6.5%). A note says which limits applied: "To
keep the unit types in this building in order and at least 5% apart (or as far apart as today, where that is less),
the plans keep this unit below Deluxe and above Studio. That limits the prices of 75 nights." A plan's pro says the
same only when every priced open night keeps the limits (beside a peer it names the types instead: "Keeps this unit in
order against Deluxe and Studio, at least 5% apart …"); prices that break the order get a con ("would cost as much as
or more than Deluxe", "no more than Studio"), and prices in order but closer than the limit another ("would be priced
within 5% of Deluxe"). Peak nights kept at today's price are not moved. For each
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
price inside the prices the planner tries (`floor` and `ceiling`, and the other unit types' order); otherwise a card
named for the planner would show prices it would not choose.

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
most nights' range, else the other unit types' prices when they did, counting the nights where they left no room and
the lowest or highest price allowed was used, else Lowest or Highest price to try), the summary names that limit ("The
highest prices that keep this unit below Deluxe, which still make RM 800 a month on average."; "…below Deluxe, or your
lowest price where that leaves no room, …") and, except for the unit types (their notes say it), a note says lower or
higher prices could still work.

`notes`, in this order: nothing to price; dates under 14 nights ("the monthly figures are rough"); open nights with no
price today; booked nights with no amount; where `P0` came from when not today's prices; little history (when the
unit's own nights weigh under a quarter): "This unit has little sales history yet, so the forecast assumes today's
Sunday to Thursday price sells about 60% of nights. The plans adjust today's prices; they do not work out a market price
from scratch."; peak nights kept or held; the other unit types' limits; the last-minute deal; Fill or Premium stopped
at a limit; a late-booking market (6 in 10 or more of Balanced's likely nights usually book in the last 3 days); and
out of reach "On average, no plan reaches RM 1,500 a month. The best one makes about RM 900 a month, about RM 600 short;
…", what it would take (lower costs, or more bookings when that alone can do it), "On average, no plan covers all costs
in these dates either." when that is true too, and, when Fill and Premium drop out, "There is no Fill the calendar or
Premium rates plan: both look for prices that cover all costs, and on average none does in these dates." With a target
of 0 the words are about covering all costs. Last, the reaction to price: the least certain assumption. With `β`
lowered by `betaSd` (`β · e^−0.3`), the most profitable prices are worked out again; when they move the other way from
today's than Balanced does, the note says so and what is at stake: "How much guests react to price is the least
certain part of the forecast. If they react less than assumed, the most profitable prices would be higher than today's
rather than lower. The difference in profit between the two is about RM 130 a month." (the larger of what each plan
loses if the other assumption is right, at least RM 10).

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
  or "no more than" a cheaper one ("costs" for Today's prices), and "would be priced within 5% of Deluxe" for prices in
  order but inside the gap. The plans keep the order and the gap where they can (above), so these are for Today's
  prices, your own mix, peak nights kept at today's price, and nights where the floor, ceiling or range tried wins or
  the neighbouring types leave no room (each with its note). When every priced open night keeps the limits, a pro:
  "Keeps the other unit types in this building in order, at least 5% apart (or as far apart as today, where that is
  less)"; at `tierGap` 0, "Keeps the right order against the other unit types in this building".
- The occupancy it needs against what is likely to sell and the market ("Needs 72% of nights sold to reach the target;
  few similar listings sell more than 75%"), and, when the plan's own forecast is above `marketOcc`, "treat this plan's
  numbers as optimistic".
- Against today's prices: profit, prices ("Prices are about RM 20 a night higher than today on average", the cards'
  Average rate), nights sold, stays to clean, reviews and placement, and how far it moves from today. Under 30 nights
  the counts are "over these dates", not "a month". A plan that moves a third or more of the nights with a price today
  by 15% or more gets "Moves 40 of the 82 nights with a price today by 15% or more, and the forecast is less sure about
  prices guests have not seen." ("Moves all 82 nights …", "Moves the night …"); a plan within 5% on average gets "Stays
  close to today's prices, so the forecast is on firmer ground." `stats` carries `bigMoves` and `pricedToday`.
- With peak nights kept at today's price: a con when ordinary weekday or weekend nights would cost more than the peaks.
- Weak demand ("If demand is 20% weaker, profit falls to about RM 400 a month"). When the amount rounds to RM0 it says
  "If demand is 20% weaker, the unit about breaks even.", a con when the target is above 0 and a pro with a target of 0.
- Late bookings: a con only when the plan relies on them clearly more than today's prices (6 in 10 or more of its
  nights, and 1 in 10 more than today); the dates' own pattern is a note.

### Calibration

- History: the page passes this unit's last 60 days of nights it was selling (from the earliest of when it was added,
  its first live booking and its first night with a price of its own; no history without any of these), less blocked
  nights: `sold`, `available` and `avgPaid`, the average net per sold night (as `booked` below). The engine sets it against `P0 · (1 − leak)`, the same kind of amount,
  for the price index (else the caller's `priceIndex`, else 1). `a` moves toward the observed level in log-odds,
  adjusted for the price paid (`logit q_ref = logit q_obs + β · ln priceIndex`), weighted `available / (available + 60)`.
  The sentence says both: "Your last 60 nights with a price: 36 sold (60%) at about 2% below the usual price, so the
  usual occupancy moves from 60% to 59%." (or "stays at 60%").
- Pace (above) for the coming months.
- `result.calibration` reports what was used, so the page can show it ("3 nights booked in November; about 5.2
  expected by now: November demand lowered").

## The page

1. Toolbar: unit picker (units in view, not archived), dates (next 30, 60, 90, 180 days, or until a date), saved state.
   An until-date runs from tomorrow to a year ahead; a typed date outside that goes to the nearest end, and a saved
   date that has passed falls back to the next 90 days (the select shows it), so a passed date never plans one night.
   The context line under it says who shares the price ("4 units share this price; 47-5, 47-7 and 48-1 are blocked on
   every night of these dates, so only 43-6 can sell"; "Both units share this price" for two).
2. Costs card: the fields grouped as above, live totals ("RM2,450 fixed a month, RM120 per stay, RM18 per night"), the
   monthly profit target. When Expenses has entries for this unit, show the last 3 months' monthly average as a hint.
   Under Share of revenue: "Leave out booking-site commission: each site's markup already covers it."
   Then Price limits (optional): "Never below" and "Never above", RM a night, saved per unit with the rest and passed to
   `R.plan` and `R.evaluate` as `floor` and `ceiling`. While Never above is not above Never below, both fields are
   flagged with "Never above needs to be higher than Never below. Until it is, the plans leave both limits out.", the
   plans run without limits and Save says to fix them first.
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
8. Push history with Undo. Each row names the plan as its card did ("Balanced and Most profit"); the subtitle names the unit type when it has more than one unit, else the unit.
9. Assumptions (collapsed): every `R.ASSUMPTIONS` value with its source and a reset, plus what calibration used. The
   summary ("1 value changed from the defaults") and "Reset all" follow every edit; the plans use the values straight
   away, and Save costs and target keeps them for next time.

A redraw while a number field has focus puts the focus and the cursor back at the end of the field; any other control
that is redrawn (Preview, By month / By night, All nights / Only changes, the Keep peak nights switch, a chart dot,
Save costs and target) gets the focus back, an assumption's Reset passes it to that assumption's field, and Preview
moves it to the preview's heading as it scrolls there. The chart's plan dots are buttons: Tab reaches them, and Enter
or Space opens the preview, as a click does. The plans on screen belong to the unit they were worked out for: two
units with the same input each get their own run. If the engine
throws, the page shows "Orbique could not work out the plans for these dates. Try other dates or check the costs." and
the error goes to the console only.

The input the page builds: each night's price now and status; a booked night's `booked` is the booking's net per night,
`(payout − tourismTax − cleaningFee) / nights`, with the total in place of a missing payout and then less
`platformFee` too; `(accommodation − platformFee) / nights` when the booking has neither; and `null` when it has no
amounts. The booking site's commission is charged on the guest's total, which for Booking.com and Agoda is the room
amount with their markup on top, so the room amount less the whole commission counted it twice (a Booking.com stay at
RM 1,097 for the room, RM 1,426 total and RM 308 commission is RM 280 a night, not RM 197). A booked night also carries
its booking (`stay`) and `firm` once the guest has checked in. History `avgPaid` is the same figure averaged over the
sold nights that have one. The workspace's `lastMinuteDeal` goes in as `lastMinute`, and its skip dates as
`specialDates`.

Push. The confirm says what changes ("Change 60 nights for Deluxe (applies to all 3 units of the type) on every booking
site.", "both units of the type" for two, or "in Orbique." when the type is not connected), the dates, the average
price now and after with its range, how many nights go up, down or get a price, how many sit on the owner's price
limits when any do ("Price limits: 12 nights at RM 200, the lowest price you allow; 3 nights at RM 600, the highest
price you allow.", from `res.limits`), and expected profit and nights sold against today's prices; for a unit type it
says these are worked out for this unit and names the others when there are 3 or fewer ("Vortex Premium 47-1 gets the
same prices"; else "the other 5 units get the same prices"), and which of them are blocked on every night of the
dates. When the last-minute deal covers some of the nights: "Your last-minute deal still takes 10% off 20 of these
nights when they are booked in the last 3 days before the night. The forecast counts it." The channel sentence is the
channel manager's own for rate changes when the push goes through the main rate plan (`O.channel.notice('rates')`:
"Practice mode: nothing goes to booking sites. Channels → Sync log shows what would be sent."), and the one for a
unit's own price otherwise (`notice('price')`). Its Push button takes the focus,
and only one dialog opens at a time. On Push the page checks that the plans are still the ones the dialog showed and
that the nights and their prices now are the same; if not, it says so and pushes nothing (stale plans are worked out
again).

Then one `O.channel.setDays` call on the unit type's main plan (`O.channel.mainPlan(typeId)`) with
`{planId, dates: [iso], set: {rate}}` per changed night (it also writes `priceOverrides` for every unit of the type),
`opts {emit: false, audit: false, how: 'planner'}`; a unit without a main plan writes `D.priceOverrides` /
`D.priceOverrideMeta` directly like `applyPrices` in pricing.js. Then `D.priceLog`, the audit log, the push record in
`D.ratePlanner.pushes` (for a night that had its own price, `own: true`, its `how`, and who set it and when, `by` and
`at`, so Undo can put the label and Pricing's history back too), and one `O.emit('data', {type: 'pricing'})`. The
price log's `how` is "Fill the calendar plan from the profit planner" ("Your own mix from the profit planner"), so
Pricing's Recent changes reads "Fill the calendar plan from the profit planner: 63 nights (11 Oct – 3 Jan)".

Undo puts back the nights still at the push's price:

- An own price goes back with its old `how` (one `setDays` per `how`) and then its old `by` and `at` on every unit
  Undo writes, so Pricing does not date the old price to the undo; a night with no own price before is cleared (back
  to the model; for a plan that is not the main plan, its default rate or the plan it follows).
- The push's own plan (`planId`), while it exists and is not archived:
  - still the type's main plan: one `setDays` on it puts back its days and every unit's price together;
  - no longer the main plan: its own days still at the push's price go back by themselves (a plan that is not the main
    plan writes no unit prices), so it stops selling the pushed prices and the plans that follow it (Bed & Breakfast =
    Best Available Rate + RM40) recompute. This happens even on nights whose unit prices were changed since.
- The units' prices, when the push's plan is not the main plan any more, go back directly in `priceOverrides` (every
  unit of the type when the push went through a plan, else the unit alone), and `O.channel.fill` brings the main plan's
  model days along:
  - another plan is the main plan now: the units follow it, so the pushed price only comes off (their own prices from
    before the push are not put back) and Undo never writes that plan's days. The confirm and the toast say so: "Since
    the push, Room Only Flex has become the main rate plan for Deluxe, so the prices of all 3 Deluxe units now come from
    it. On 61 nights the pushed price comes off the units and Room Only Flex's price applies, not the one from before
    the push. Undo does not change the prices set on Room Only Flex."
  - no main plan now: back to their own price from before the push, or cleared.
- The confirm, the toast and the audit line name the units Undo writes ("for all 3 Deluxe units", "for Studio 3A only"
  when the type has other units) and the push's own plan when it goes back by itself.
- A night a later push (not undone, same unit or type) changed again from this push's price is handed over: the later
  push takes this push's `from` (and gets `changedAt`, for the save merge), so undoing it later puts back the price
  from before both, in any order.
- Nights changed by hand since keep their newer price and past nights are skipped; the confirm says how many, and for
  a unit type which units.
- After the confirm closes it looks the push record up again by its id (the push history may have arrived from another
  device while the dialog was open, as new objects; if the record is gone it says to press Undo again) and checks again
  (a second Enter, or prices or rate plans that changed while it was open),
  and the record is marked undone (`undoneAt`, `changedAt`, `undoneN` unit nights, `handedN`, `planN` nights put back on the push's
  own plan by itself) only once every night shows its old price again (with another main plan now: the units have no
  own price left on those nights).

Audit lines and the price log name the plan ("the Balanced plan", "your own mix of prices") and the nights, never
costs, targets or profits. Pushing needs the `pricing.change` permission; the page itself is owner-only.
