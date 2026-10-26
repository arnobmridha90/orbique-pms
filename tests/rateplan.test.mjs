/* Profit planner engine (api/_lib/shared/rateplan.cjs), the same module the page uses as O.rateplan.
 *
 *   node --test tests/rateplan.test.mjs
 *
 * The fixture is modelled on the Kozi Standard unit: 90 nights from 2026-10-27 (today 2026-10-26), net prices RM230
 * Sun-Thu and RM290 Fri-Sat, RM315 on 21-23 and 27-29 Dec, RM565 on 31 Dec, a few nights booked, about RM2,500 fixed
 * a month, RM120 cleaning per stay, RM15 utilities per night. At RM1,500 a month the target is out of reach (the best
 * plan makes about RM1,020); RM800 is the reachable variant used for the option-order checks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../api/_lib/shared/rateplan.cjs');

const TODAY = '2026-10-26';
const DAY = 864e5;
const ms = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const isoOf = (t) => new Date(t).toISOString().slice(0, 10);
const PEAK315 = ['12-21', '12-22', '12-23', '12-27', '12-28', '12-29'];
const BOOKED = { '2026-10-27': 215, '2026-10-30': 270, '2026-10-31': 270, '2026-11-06': 270, '2026-11-07': 270, '2026-11-14': 270, '2026-12-24': 215, '2026-12-25': 270 };
const COSTS = { rent: 1700, maintenance: 350, internet: 130, software: 120, otherMonthly: 50, insurance: 600, propertyTax: 480, furnishing: 1440, cleaning: 120, utilities: 15 };

function nights(from, count, booked, today = TODAY) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const iso = isoOf(ms(from) + i * DAY), dow = new Date(ms(iso)).getUTCDay(), md = iso.slice(5);
    let current = dow === 5 || dow === 6 ? 290 : 230;
    if (PEAK315.includes(md)) current = 315;
    if (md === '12-31') current = 565;
    const b = booked && booked[iso];
    out.push({ iso, dow, lead: Math.round((ms(iso) - ms(today)) / DAY), current, status: b ? 'booked' : 'open', booked: b || 0 });
  }
  return out;
}
const input = (extra) => Object.assign({ today: TODAY, nights: nights('2026-10-27', 90, BOOKED), costs: COSTS, profitPerMonth: 1500, keepPeaks: true, seed: 1, draws: 2000 }, extra || {});
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || '') + ' expected ' + b + ' got ' + a);
const reachedKeys = (r) => r.options.filter((o) => o.stats.profitPerMonth >= r.target);
const optionWith = (r, key) => r.options.find((o) => o.keys.includes(key));
const n10 = (p) => Math.round(p * 10);

/* plans are cached by input inside each test file run; compute the big ones once */
const PLAN = R.plan(input());                              /* RM1,500: out of reach */
const PLAN800 = R.plan(input({ profitPerMonth: 800 }));     /* reachable */

/* ---------------------------------------------------------------- costs */
test('monthlyCosts: monthly, yearly / 12, one-off over payback months, per stay, per night, shares of revenue', () => {
  const c = R.monthlyCosts(COSTS);
  close(c.fixedMonthly, 1700 + 350 + 130 + 120 + 50 + 600 / 12 + 480 / 12 + 1440 / 24, 1e-9);
  close(c.fixedMonthly, 2500, 1e-9);
  close(c.capexMonthly, 60, 1e-9);
  assert.equal(c.perStay, 120);
  assert.equal(c.perNight, 15);
  assert.equal(c.pct, 0);
  assert.equal(c.lines.length, 10);
  assert.deepEqual(c.lines.find((l) => l.key === 'insurance'), { key: 'insurance', label: 'Insurance', per: 'year', amount: 600, monthly: 50 });
  assert.equal(c.lines.find((l) => l.key === 'cleaning').monthly, null);
  const p = R.monthlyCosts({ ownerSharePct: '20', taxPct: 6, paymentFeePct: 'x', rent: '1,200', furnishing: 1200, paybackMonths: 12 });
  close(p.pct, 0.26, 1e-12);
  close(p.fixedMonthly, 1300, 1e-9);
  assert.equal(R.monthlyCosts(null).fixedMonthly, 0);
  assert.equal(R.monthlyCosts({ rent: -500 }).fixedMonthly, 0);
});

test('COST_FIELDS and ASSUMPTIONS describe every value in display order', () => {
  assert.deepEqual(R.COST_FIELDS.map((f) => f.key), ['rent', 'maintenance', 'internet', 'software', 'staff', 'otherMonthly', 'insurance', 'propertyTax', 'otherYearly',
    'furnishing', 'cleaning', 'amenities', 'utilities', 'consumables', 'ownerSharePct', 'paymentFeePct', 'taxPct']);
  for (const f of R.COST_FIELDS) {
    assert.ok(['month', 'year', 'once', 'stay', 'night', 'pct'].includes(f.per), f.key);
    assert.ok(f.label && f.group && f.help, f.key);
  }
  for (const a of R.ASSUMPTIONS) {
    assert.ok(a.key in R.DEFAULTS, a.key);
    assert.ok(a.label && a.help && a.source && a.unit, a.key);
    assert.ok(a.min < a.max && a.step > 0, a.key);
    if (Array.isArray(R.DEFAULTS[a.key])) assert.equal(a.items.length, R.DEFAULTS[a.key].length, a.key);
    for (const s of [a.label, a.help, a.source]) assert.ok(!/—|lambda|logit|log-odds|elasticity/i.test(s), a.key + ': ' + s);
  }
  assert.equal(R.DEFAULTS.baseOcc, 0.6);
  assert.equal(R.DEFAULTS.beta, 4);
  /* the defaults the export of 310 bookings supports (docs/notes/profit-planner.md, Assumptions) */
  assert.deepEqual(R.DEFAULTS.leadShare, [0.10, 0.25, 0.37, 0.46, 0.58, 0.64, 0.70, 0.78, 0.85, 0.92, 0.97, 1]);
  assert.deepEqual(R.DEFAULTS.dow, [-0.07, -0.07, -0.07, -0.07, -0.07, 1.05, 1.10]);
  assert.equal(R.DEFAULTS.cancelRate, 0.11);
  assert.equal(R.DEFAULTS.baseOccSd, 0.12);
  assert.equal(R.DEFAULTS.paceStrength, 25);
  const cancel = R.ASSUMPTIONS.find((a) => a.key === 'cancelRate');
  assert.equal(cancel.label, 'Booked stays that cancel');
  assert.match(cancel.source, /310 bookings/);
});

test('requiredRates: exact against hand-computed values', () => {
  /* fixed 3040 a month, RM100 per stay over 2 nights + RM10 per night = RM60 a night, 20% tax, 20% discounts:
     price = (fixed / (30.4 occ) + 60) / (0.8 x 0.8) */
  const rows = R.requiredRates({ rent: 3040, cleaning: 100, utilities: 10, taxPct: 20 }, 1520, { avgStay: 2, discountLeak: 0.2 });
  assert.deepEqual(rows.map((r) => r.occ), [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1]);
  const at = (o) => rows.find((r) => r.occ === o);
  close(at(0.5).breakEven, 406.25, 1e-9);      /* (3040 / 15.2 + 60) / 0.64 = (200 + 60) / 0.64 */
  close(at(0.5).target, 562.5, 1e-9);          /* (4560 / 15.2 + 60) / 0.64 = (300 + 60) / 0.64 */
  close(at(1).breakEven, 250, 1e-9);           /* (100 + 60) / 0.64 */
  close(at(1).target, 328.125, 1e-9);          /* (150 + 60) / 0.64 */
  close(at(0.2).breakEven, 875, 1e-9);         /* (500 + 60) / 0.64 */
  close(at(0.2).target, 1265.625, 1e-9);       /* (750 + 60) / 0.64 */
  /* the Kozi costs at the defaults (2.7-night stays, 6% discounts): (4000 / 18.24 + 15 + 120 / 2.7) / 0.94 */
  const kozi = R.requiredRates(COSTS, 1500).find((r) => r.occ === 0.6);
  close(kozi.target, (4000 / 18.24 + 15 + 120 / 2.7) / 0.94, 1e-9);
  close(kozi.target, 296.535, 1e-3);
  /* revenue shares of 100%: no price works */
  assert.ok(R.requiredRates({ ownerSharePct: 60, taxPct: 40, rent: 100 }, 0).every((r) => r.breakEven === null && r.target === null));
  /* zero costs and no profit: any price works */
  assert.ok(R.requiredRates({}, 0).every((r) => r.breakEven === 0 && r.target === 0));
});

test('requiredRates: break-even is below the target everywhere, and both fall as occupancy rises', () => {
  const rows = R.requiredRates(COSTS, 1500);
  for (let i = 0; i < rows.length; i++) {
    assert.ok(rows[i].breakEven < rows[i].target, 'occ ' + rows[i].occ);
    if (i) { assert.ok(rows[i].target < rows[i - 1].target); assert.ok(rows[i].breakEven < rows[i - 1].breakEven); }
  }
});

test('rng: seeded, repeatable, in [0, 1), normal draws look normal', () => {
  const a = R.rng(42), b = R.rng(42), c = R.rng(43);
  const xs = Array.from({ length: 5 }, () => a()), ys = Array.from({ length: 5 }, () => b());
  assert.deepEqual(xs, ys);
  assert.notDeepEqual(xs, Array.from({ length: 5 }, () => c()));
  const g = R.rng(7);
  let sum = 0, sq = 0, n = 20000;
  for (let i = 0; i < n; i++) { const u = g(); assert.ok(u >= 0 && u < 1); }
  for (let i = 0; i < n; i++) { const z = g.normal(); sum += z; sq += z * z; }
  close(sum / n, 0, 0.03);
  close(sq / n, 1, 0.04);
});

/* ---------------------------------------------------------------- demand model */
test('selling chance falls as price rises (every open night, and the demand curve)', () => {
  const inp = input({ profitPerMonth: 800 });
  const scaled = (f) => Object.fromEntries(inp.nights.filter((n) => n.status === 'open').map((n) => [n.iso, Math.round(n.current * f / 5) * 5]));
  const lo = R.evaluate(inp, scaled(0.9)), mid = R.evaluate(inp, scaled(1)), hi = R.evaluate(inp, scaled(1.1));
  const open = mid.nightly.filter((n) => n.status === 'open');
  assert.equal(open.length, 82);
  open.forEach((n, i) => {
    const a = lo.nightly.find((x) => x.iso === n.iso), c = hi.nightly.find((x) => x.iso === n.iso);
    assert.ok(a.chance > n.chance && n.chance > c.chance, n.iso + ' ' + a.chance + ' ' + n.chance + ' ' + c.chance);
  });
  assert.ok(lo.stats.occ > mid.stats.occ && mid.stats.occ > hi.stats.occ);
  const dc = PLAN800.demandCurve;
  assert.ok(dc.length >= 20);
  for (let i = 1; i < dc.length; i++) { assert.ok(dc[i].occ < dc[i - 1].occ); assert.ok(dc[i].listAdr > dc[i - 1].listAdr); }
  /* at 60% a 10% higher price loses about 15% of bookings (the label's promise), for a far night with no adjustments */
  const far = { today: TODAY, nights: [{ iso: '2027-03-10', dow: 3, lead: 135, current: 200, status: 'open' }], costs: {}, profitPerMonth: 0,
    assumptions: { dow: [0, 0, 0, 0, 0, 0, 0], month: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], baseOccSd: 0, betaSd: 0, monthSd: 0 } };
  const p1 = R.evaluate(far, { '2027-03-10': 200 }).nightly[0].chance, p2 = R.evaluate(far, { '2027-03-10': 220 }).nightly[0].chance;
  close(p1, 0.6, 1e-9);
  close(1 - p2 / p1, 0.157, 0.005);
});

test('open-night conditioning lowers the chances of near nights and leaves far nights alone', () => {
  /* pace switched off (huge paceStrength) so only the lead time differs */
  const base = nights('2026-10-27', 90, {});
  const real = input({ nights: base, assumptions: { paceStrength: 1e9 } });
  const farOff = input({ nights: base.map((n) => Object.assign({}, n, { lead: n.lead + 100 })), assumptions: { paceStrength: 1e9 } });
  const a = R.evaluate(real, {}).nightly, b = R.evaluate(farOff, {}).nightly;
  let near = 0, far = 0;
  base.forEach((n, i) => {
    if (n.lead < 60) { assert.ok(a[i].chance < b[i].chance, n.iso); near++; }
    else { close(a[i].chance, b[i].chance, 1e-8, n.iso); far++; }   /* only a 1e-9 trace of pace is left */
  });
  assert.ok(near > 50 && far > 20);
  /* tomorrow (lead 1, F = 0.25: three quarters of its nights would have been booked by now) keeps well under its
     unconditioned chance */
  assert.ok(a[0].chance < 0.75 * b[0].chance);
});

test('an open night near its date: guests arrive at random and the first takes it, so the chance is exact at the usual price', () => {
  /* one night, no weekday, month, pace or spread: P = 60% at the usual price, F = the share of its nights booked this
     close (10% same day, 25% a day ahead, 52% four days ahead between 46% and 58%, 92% thirty days ahead). Given the
     night is still open, the chance it sells is P F / (1 - P (1 - F)) */
  const flat = { dow: [0, 0, 0, 0, 0, 0, 0], month: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], baseOccSd: 0, betaSd: 0, monthSd: 0, paceStrength: 1e9 };
  const one = (lead) => ({ today: TODAY, nights: [{ iso: isoOf(ms(TODAY) + lead * DAY), dow: new Date(ms(TODAY) + lead * DAY).getUTCDay(), lead, current: 200, status: 'open' }], costs: {}, profitPerMonth: 0, assumptions: flat });
  for (const [lead, F] of [[0, 0.10], [1, 0.25], [4, 0.52], [30, 0.92], [90, 1]]) {
    close(R.evaluate(one(lead), {}).nightly[0].chance, 0.6 * F / (1 - 0.6 * (1 - F)), 1e-8, 'lead ' + lead);
  }
  /* at another price the same arrivals: the night sells unless every guest still to come passes, 1 - (1 - P)^H, with
     H the share of guests still to come (from F at the usual occupancy) */
  const H = 1 - Math.log(1 - 0.6 * 0.75) / Math.log(0.4), lg = Math.log(0.6 / 0.4);
  for (const p of [160, 220, 260]) {
    const P = 1 / (1 + Math.exp(-(lg - 4 * Math.log(p / 200))));
    const iso = isoOf(ms(TODAY) + DAY);
    close(R.evaluate(one(1), { [iso]: p }).nightly[0].chance, 1 - Math.pow(1 - P, H), 1e-8, 'RM' + p);
  }
});

test('pace: a month with no bookings by now loses demand, a month booked ahead gains it', () => {
  /* no bookings in October or November; three January nights booked already (65+ days ahead) */
  const ahead = { '2027-01-15': 270, '2027-01-16': 270, '2027-01-20': 215 };
  const inp = input({ nights: nights('2026-10-27', 90, ahead), profitPerMonth: 800 });
  const off = Object.assign({}, inp, { assumptions: { paceStrength: 1e9 } });
  const r = R.plan(inp), pace = Object.fromEntries(r.calibration.pace.map((p) => [p.month, p]));
  assert.ok(pace['2026-11'].effect < -0.05, 'November ' + pace['2026-11'].effect);
  assert.equal(pace['2026-11'].booked, 0);
  assert.ok(pace['2026-11'].expected > 1);
  /* nothing expected yet so far ahead: 3 nights (less the 11% that cancel) against 25 nights of evidence */
  close(pace['2027-01'].effect, Math.log(1 + 3 * 0.89 / 25), 1e-12, 'January');
  assert.equal(pace['2027-01'].booked, 3);
  assert.ok(pace['2026-12'].effect < 0 && pace['2026-12'].effect > pace['2026-11'].effect, 'December barely expected anything yet');
  assert.match(pace['2026-11'].text, /^No nights booked in November yet; about \d+(\.\d)? expected by now: November demand lowered\.$/);
  assert.match(pace['2027-01'].text, /^3 nights booked in January; hardly any expected by now: January demand raised\.$/);
  assert.ok(r.calibration.text.includes(pace['2026-11'].text));
  const a = R.evaluate(inp, {}).nightly, b = R.evaluate(off, {}).nightly;
  a.forEach((n, i) => {
    if (n.status !== 'open') return;
    if (n.iso.startsWith('2026-11')) assert.ok(n.chance < b[i].chance, n.iso);
    if (n.iso.startsWith('2027-01')) assert.ok(n.chance > b[i].chance, n.iso);
  });
  /* the cap: never more than 0.7 either way (20 nights against 3 nights of evidence) */
  const many = input({ nights: nights('2026-10-27', 90, Object.fromEntries(nights('2027-01-01', 20).map((n) => [n.iso, 250]))), assumptions: { paceStrength: 3 } });
  close(R.plan(many).calibration.pace.find((p) => p.month === '2027-01').effect, 0.7, 1e-12);
});

test('pace: about 25 nights of evidence, peak nights left out, and the sentence agrees with its own numbers', () => {
  /* 20 January nights booked ahead: 20 x 0.89 against 25, not enough to hit the cap */
  const many = input({ nights: nights('2026-10-27', 90, Object.fromEntries(nights('2027-01-01', 20).map((n) => [n.iso, 250]))) });
  close(R.plan(many).calibration.pace.find((p) => p.month === '2027-01').effect, Math.log(1 + 20 * 0.89 / 25), 1e-12);
  /* a booked peak night (New Year's Eve at RM565) does not count as pace: its premium already stands for its demand */
  const base = R.plan(input({ nights: nights('2026-10-27', 90, {}), profitPerMonth: 800 })).calibration.pace.find((p) => p.month === '2026-12');
  const nye = R.plan(input({ nights: nights('2026-10-27', 90, { '2026-12-31': 565 }), profitPerMonth: 800 })).calibration.pace.find((p) => p.month === '2026-12');
  assert.equal(nye.booked, 0);
  assert.equal(nye.effect, base.effect);
  close(nye.expected, base.expected, 1e-12);
  /* the shown count is on the booked count's footing (cancellations included), one decimal under 10, and the verb
     follows the effect: "left as it is" when the effect is small or the two numbers read the same */
  const rows = [];
  for (const ns of [nights('2026-10-27', 90, BOOKED), nights('2026-10-27', 90, {}), nights('2026-10-27', 90, { '2026-11-02': 230, '2026-11-03': 230, '2026-11-09': 230 }), nights('2026-11-20', 60, BOOKED)]) {
    for (const p of R.plan(input({ nights: ns, profitPerMonth: 800 })).calibration.pace) if (p.text) rows.push(p);
  }
  assert.ok(rows.length >= 8);
  for (const p of rows) {
    const shown = /about ([\d.]+) expected/.exec(p.text), e = shown ? +shown[1] : 0;
    if (shown) close(e, p.expected < 10 ? Math.round(p.expected * 10) / 10 : Math.round(p.expected), 1e-9, p.text);
    if (/raised\.$/.test(p.text)) assert.ok(p.effect >= 0.05 && p.booked > e, p.text);
    else if (/lowered\.$/.test(p.text)) assert.ok(p.effect <= -0.05 && p.booked < e, p.text);
    else assert.ok(/left as it is\.$/.test(p.text) && (Math.abs(p.effect) < 0.05 || p.booked === e), p.text);
  }
});

test('history calibration moves the usual occupancy toward what the unit sold, adjusted for the price paid', () => {
  const used = (h) => R.plan(input({ history: h, draws: 200 })).calibration;
  const busy = used({ sold: 50, available: 60, priceIndex: 1 });
  const quiet = used({ sold: 20, available: 60, priceIndex: 1 });
  const dear = used({ sold: 36, available: 60, priceIndex: 1.1 });
  const cheap = used({ sold: 36, available: 60, priceIndex: 0.9 });
  const lg = (q) => Math.log(q / (1 - q)), sg = (x) => 1 / (1 + Math.exp(-x));
  close(busy.baseOccUsed, sg(0.5 * lg(0.6) + 0.5 * lg(50 / 60)), 1e-12);   /* weight 60 / (60 + 60) */
  assert.ok(busy.baseOccUsed > 0.6 && busy.baseOccUsed < 50 / 60);
  assert.ok(quiet.baseOccUsed < 0.6 && quiet.baseOccUsed > 20 / 60);
  assert.ok(dear.baseOccUsed > 0.6, 'sold 60% at 10% above P0: demand at P0 is higher');
  assert.ok(cheap.baseOccUsed < 0.6, 'sold 60% only with a 10% discount: demand at P0 is lower');
  close(dear.history.weight, 0.5, 1e-12);
  assert.match(busy.text[0], /^Your last 60 nights with a price: 50 sold \(83%\) at about the usual price, so the usual occupancy moves from 60% to 73%\.$/);
  assert.match(dear.text[0], /^Your last 60 nights with a price: 36 sold \(60%\) at about 10% above the usual price, so the usual occupancy moves from 60% to \d+%\.$/);
  /* the average paid per sold night (net after discounts) is set against the engine's own usual price less the usual
     discount: RM230 x 0.94 x 1.1 is 10% above it */
  const paid = used({ sold: 36, available: 60, avgPaid: 230 * 0.94 * 1.1 });
  close(paid.baseOccUsed, dear.baseOccUsed, 1e-12);
  close(paid.history.priceIndex, 1.1, 1e-12);
  assert.equal(paid.text[0], dear.text[0]);
  /* a price that moves the figure is named, even when small */
  assert.equal(used({ sold: 36, available: 60, priceIndex: 0.98 }).text[0], 'Your last 60 nights with a price: 36 sold (60%) at about 2% below the usual price, so the usual occupancy moves from 60% to 59%.');
  assert.equal(used({ sold: 36, available: 60, priceIndex: 0.997 }).text[0], 'Your last 60 nights with a price: 36 sold (60%) at about the usual price, so the usual occupancy stays at 60%.');
  /* more history weighs more */
  assert.ok(used({ sold: 500, available: 600, priceIndex: 1 }).baseOccUsed > busy.baseOccUsed);
  /* no history: the default */
  assert.equal(PLAN.calibration.baseOccUsed, 0.6);
  assert.equal(PLAN.calibration.history, null);
  /* the usual occupancy shows up in the forecast */
  const occ = (h) => R.plan(input({ history: h, draws: 200 })).options[0].stats.occ;
  assert.ok(occ({ sold: 50, available: 60, priceIndex: 1 }) > PLAN.options[0].stats.occ);
});

test('peak nights: today\'s price with keepPeaks, and their premium shape without it', () => {
  assert.deepEqual(PLAN.calibration.peaks.map((p) => p.iso), ['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-27', '2026-12-28', '2026-12-29', '2026-12-31']);
  for (const r of [PLAN, PLAN800]) {
    for (const o of r.options) for (const p of r.calibration.peaks) assert.equal(o.prices[p.iso], p.current, o.name + ' ' + p.iso);
  }
  assert.ok(PLAN800.notes.includes('7 peak nights keep today\'s price in every plan.'));
  const free = R.plan(input({ keepPeaks: false, profitPerMonth: 800 }));
  assert.ok(!free.notes.some((t) => /peak/.test(t)));
  const prof = optionWith(free, 'profit').prices;
  /* the usual Mon-Thu December nights of the same plan */
  const usual = ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17'].map((d) => prof[d]).sort((a, b) => a - b)[5];
  const nye = prof['2026-12-31'] / usual, xmas = ['2026-12-21', '2026-12-22', '2026-12-23'].map((d) => prof[d] / usual);
  close(nye, 565 / 230, 0.25, 'New Year keeps about its premium over a usual night');
  xmas.forEach((x) => close(x, 315 / 230, 0.15, 'Christmas week keeps about its premium'));
  assert.ok(prof['2026-12-31'] !== 565 || xmas.some((x, i) => prof['2026-12-2' + (i + 1)] !== 315), 'without keepPeaks the peak prices are free to move');
});

/* ---------------------------------------------------------------- optimiser and options */
test('frontier: occupancy rises with lambda and ADR falls; every plan is on the rounding grid', () => {
  for (const r of [PLAN, PLAN800]) {
    const f = r.frontier;
    assert.ok(f.length >= 20);
    for (let i = 1; i < f.length; i++) {
      assert.ok(f[i].lambda > f[i - 1].lambda);
      assert.ok(f[i].occ >= f[i - 1].occ - 1e-12, 'occupancy at ' + f[i].lambda);
      assert.ok(f[i].adr <= f[i - 1].adr + 1e-9, 'ADR at ' + f[i].lambda);
    }
    assert.ok(f[f.length - 1].occ > f[0].occ + 0.3);
    /* lambda = 0 is the most profitable point of the frontier */
    const z = f.find((x) => x.lambda === 0);
    assert.ok(f.every((x) => x.profitPerMonth <= z.profitPerMonth + 1e-9));
  }
});

test('options: Most profit has the highest expected profit of all options', () => {
  for (const r of [PLAN, PLAN800]) {
    const p = optionWith(r, 'profit');
    for (const o of r.options) assert.ok(o.stats.profit <= p.stats.profit + 1e-9, o.name);
  }
});

test('options (reachable): Fill sells the most nights and Premium has the highest ADR among the options that reach the target', () => {
  const r = PLAN800;
  assert.equal(r.reachable, true);
  assert.deepEqual(r.options.flatMap((o) => o.keys), ['current', 'fill', 'balanced', 'profit', 'premium']);
  const reached = reachedKeys(r), fill = optionWith(r, 'fill'), prem = optionWith(r, 'premium');
  assert.ok(reached.includes(fill) && reached.includes(prem));
  for (const o of reached) {
    assert.ok(o.stats.occ <= fill.stats.occ + 1e-12, o.name + ' occupancy');
    assert.ok(o.stats.adr <= prem.stats.adr + 1e-9, o.name + ' ADR');
  }
  /* Fill and Premium are close to the edge: at the target, not far above it. Nights alike (the Sunday to Thursday nights
     of a month share one demand) step to their next price together, so the last plan that reaches the target can sit up
     to about RM20 above it */
  close(fill.stats.profitPerMonth, 800, 25);
  close(prem.stats.profitPerMonth, 800, 25);
  assert.ok(fill.stats.occ > optionWith(r, 'balanced').stats.occ && optionWith(r, 'profit').stats.occ > prem.stats.occ);
});

test('options (reachable): every option that reaches the target expects at least the target, and says so', () => {
  const r = PLAN800;
  for (const k of ['fill', 'balanced', 'profit', 'premium']) {
    const o = optionWith(r, k);
    assert.equal(o.reachesTarget, true, k);
    assert.ok(o.stats.profitPerMonth >= 800, k + ' ' + o.stats.profitPerMonth);
  }
  for (const o of r.options) assert.equal(o.reachesTarget, o.stats.profitPerMonth >= 800);
  assert.equal(optionWith(r, 'fill').tag, '');
  /* at the edge the chance is about even: the summary gives it rather than claiming the target as a fact */
  for (const k of ['fill', 'premium']) {
    assert.match(optionWith(r, k).summary, /^The (lowest|highest) prices that still make RM 800 a month on average, .*with (about an even chance|about an? \d in 10 chance) of reaching it\.$/, k);
  }
});

/* chances closer than the Monte Carlo's noise (2 standard errors at 2,000 draws, at most 0.0224) count as equal */
const NOISE = 2 * Math.sqrt(0.25 / 2000);

test('options: Balanced has as good a chance of the target as any option, the most profit among those, and is the recommended card', () => {
  for (const r of [PLAN800, R.plan(input({ profitPerMonth: 600, seed: 9 })), R.plan(input({ profitPerMonth: 1000, keepPeaks: false }))]) {
    const b = optionWith(r, 'balanced');
    for (const o of r.options) {
      assert.ok(b.stats.pTarget >= o.stats.pTarget - NOISE, o.name + ' ' + o.stats.pTarget + ' > ' + b.stats.pTarget);
      if (o.stats.pTarget >= b.stats.pTarget) assert.ok(o.stats.profit <= b.stats.profit + 1e-9, o.name + ' has the same chance and more profit');
    }
    assert.equal(b.recommended, true);
    assert.equal(b.tag, 'Recommended');
    assert.equal(r.recommended, b.key);
    assert.equal(r.options.filter((o) => o.recommended).length, 1);
  }
});

test('options: identical prices merge into one card with both names', () => {
  /* at RM1,500 Balanced (about the best chance of the target on Fill's side, then the most profit) comes out as Most profit */
  const merged = PLAN.options.find((o) => o.keys.length > 1);
  assert.ok(merged, 'a merged card');
  assert.equal(merged.name, merged.names.slice(0, -1).join(', ') + ' and ' + merged.names[merged.names.length - 1]);
  const sigs = PLAN.options.map((o) => JSON.stringify(o.prices));
  assert.equal(new Set(sigs).size, sigs.length, 'no two cards with the same prices');
  const keys = PLAN.options.flatMap((o) => o.keys).sort();
  assert.deepEqual(keys, ['balanced', 'current', 'fill', 'premium', 'profit']);
});

test('same seed gives identical results; a different seed only small differences', () => {
  const a = R.plan(input({ profitPerMonth: 800 }));
  assert.deepEqual(a, PLAN800);
  assert.equal(JSON.stringify(R.plan(input({ profitPerMonth: 800 }))), JSON.stringify(PLAN800));
  const b = R.plan(input({ profitPerMonth: 800, seed: 2 }));
  assert.notEqual(JSON.stringify(b), JSON.stringify(a));
  for (const k of ['current', 'fill', 'profit', 'premium']) {
    const x = optionWith(a, k).stats, y = optionWith(b, k).stats;
    close(y.occ, x.occ, 0.01, k + ' occupancy');
    close(y.profitPerMonth, x.profitPerMonth, 0.02 * Math.abs(x.profitPerMonth) + 10, k + ' profit');
    close(y.pTarget, x.pTarget, 0.05, k + ' chance');
    close(y.p50, x.p50, 0.08 * Math.abs(x.p50) + 30, k + ' P50');
  }
  /* Balanced may move along the flat top of the chance curve, but its chance hardly changes */
  close(optionWith(b, 'balanced').stats.pTarget, optionWith(a, 'balanced').stats.pTarget, 0.04, 'balanced chance');
  close(optionWith(b, 'balanced').stats.profitPerMonth, optionWith(a, 'balanced').stats.profitPerMonth, 120, 'balanced profit');
});

test('the Monte Carlo agrees with the expected numbers', () => {
  for (const o of PLAN800.options) {
    const s = o.stats;
    assert.ok(s.p10 < s.p50 && s.p50 < s.p90, o.name);
    assert.ok(s.p10 < s.profitPerMonth && s.profitPerMonth < s.p90, o.name);
    close(s.p50, s.profitPerMonth, 0.15 * (s.p90 - s.p10), o.name + ' median near the mean');
    close(s.pBreakEven, 1 - s.pLoss, 1e-12);
    close(s.profit, s.revenue - s.costs, 1e-6);
    close(s.profitPerMonth, s.profit / (90 / 30.4), 1e-9);
    close(s.adr, s.revenue / s.soldNights, 1e-9);
    close(s.listAdr, s.adr / 0.94, 1e-9);
    close(s.occ, s.soldNights / 90, 1e-12);
    assert.ok(s.weakDemandProfitPerMonth < s.profitPerMonth);
  }
});

test('evaluate reproduces an option exactly and works for in-between plans', () => {
  const o = optionWith(PLAN800, 'balanced');
  const e = R.evaluate(input({ profitPerMonth: 800 }), o.prices);
  assert.deepEqual(e.stats, o.stats);
  assert.deepEqual(e.byMonth, o.byMonth);
  assert.deepEqual(e.prices, o.prices);
  assert.equal(e.key, 'custom');
  assert.equal(e.name, 'Your plan');
  const f = PLAN800.frontier[Math.floor(PLAN800.frontier.length / 2)];
  const mid = R.evaluate(input({ profitPerMonth: 800 }), f.prices, { key: 'slider', name: 'Slider' });
  close(mid.stats.occ, f.occ, 1e-12);
  close(mid.stats.profitPerMonth, f.profitPerMonth, 1e-9);
  assert.equal(mid.name, 'Slider');
  assert.ok(mid.pros.length && mid.cons.length);
  /* nights left out keep today's price */
  const one = R.evaluate(input({ profitPerMonth: 800 }), { '2026-11-02': 250 });
  assert.equal(one.changes, 1);
  assert.equal(one.prices['2026-11-03'], 230);
});

test('byMonth adds up to the whole', () => {
  for (const o of PLAN800.options) {
    const sum = (k) => o.byMonth.reduce((a, m) => a + m[k], 0);
    assert.deepEqual(o.byMonth.map((m) => m.month), ['2026-10', '2026-11', '2026-12', '2027-01']);
    assert.equal(sum('nights'), 90);
    close(sum('soldNights'), o.stats.soldNights, 1e-9);
    close(sum('revenue'), o.stats.revenue, 1e-6);
    close(sum('profit'), o.stats.profit, 1e-6);
    assert.equal(sum('changes'), o.changes);
  }
});

/* ---------------------------------------------------------------- out of reach and edge cases */
test('the Kozi fixture at RM1,500: out of reach, with notes on the shortfall', () => {
  const r = PLAN;
  assert.equal(r.reachable, false);
  assert.equal(r.P0, 230);
  assert.ok(r.options.every((o) => o.stats.profitPerMonth < 1500));
  const best = optionWith(r, 'profit').stats.profitPerMonth, short = 1500 - best;
  const tens = (x) => 'RM ' + (Math.round(x / 10) * 10).toLocaleString('en-US');
  /* "on average", next to a chance that can be well above zero */
  const lead = 'On average, no plan reaches RM 1,500 a month. The best one makes about ' + tens(best) + ' a month, about ' + tens(short) + ' short';
  assert.ok(r.notes.some((t) => t.startsWith(lead + '; the recommended plan still has ') && t.endsWith(' of reaching it.')), r.notes.join(' | '));
  assert.ok(r.notes.some((t) => t.startsWith('To reach it, costs would need to be about ' + tens(short) + ' a month lower, or about ') && /\d+% more bookings at the same prices\.$/.test(t)));
  /* "Breaks even only" is for plans that make about nothing; Fill makes about RM360 a month */
  for (const k of ['fill', 'premium']) {
    const o = optionWith(r, k);
    assert.equal(o.tag, Math.abs(o.stats.profitPerMonth) < 50 ? 'Breaks even only' : 'Misses the target', k);
    assert.ok(o.stats.profitPerMonth >= 5, k + ' covers its costs with a margin');
  }
  assert.equal(optionWith(r, 'fill').tag, 'Misses the target');
  assert.match(optionWith(r, 'fill').summary, /does not reach RM 1,500 a month/);
  /* Balanced: at least as many nights as Most profit, about the best chance of the target there, and it says that */
  const b = optionWith(r, 'balanced'), p = optionWith(r, 'profit');
  assert.ok(b.stats.occ >= p.stats.occ - 1e-9);
  for (const o of r.options) if (o.stats.occ >= p.stats.occ - 1e-9) assert.ok(b.stats.pTarget >= o.stats.pTarget - NOISE, o.name);
  assert.match(b.summary, /^On average no plan quite makes RM 1,500 a month; this one has the best chance of it, about \d in 10\./);
  assert.ok(!r.options.some((o) => /covering costs/.test(o.summary) && !/does not reach/.test(o.summary)), 'no "best chance of covering costs" when every plan covers them');
});

test('an unreachable target (huge) gives notes and no crash', () => {
  const r = R.plan(input({ profitPerMonth: 1e7 }));
  assert.equal(r.reachable, false);
  assert.ok(r.options.length >= 3);
  assert.ok(r.notes.some((t) => /^On average, no plan reaches RM 10,000,000 a month\./.test(t)));
  assert.ok(r.notes.some((t) => /more bookings alone would not do it, as even selling every open night at those prices makes about RM [\d,]+ a month\./.test(t)), r.notes.join(' | '));
  for (const o of r.options) { assert.equal(o.stats.pTarget, 0); assert.ok(o.cons.some((c) => /^Little chance of making RM 10,000,000 a month/.test(c))); }
  /* not even break-even: Fill and Premium drop out, Balanced is Most profit, the smallest loss */
  const loss = R.plan(input({ costs: Object.assign({}, COSTS, { rent: 9000 }), profitPerMonth: 1500, draws: 300 }));
  assert.ok(loss.notes.includes('On average, no plan covers all costs in these dates either.'));
  assert.ok(!optionWith(loss, 'fill') && !optionWith(loss, 'premium'));
  assert.ok(optionWith(loss, 'balanced'));
  assert.equal(optionWith(loss, 'balanced'), optionWith(loss, 'profit'));
  assert.match(optionWith(loss, 'balanced').summary, /^No plan covers all costs on average, so this is the one that loses the least\. The smallest loss, about RM [\d,]+ a month\.$/);
  assert.ok(loss.notes.some((t) => /The best one loses about RM [\d,]+ a month/.test(t)));
});

test('zero costs and no profit target', () => {
  const r = R.plan(input({ costs: {}, profitPerMonth: 0 }));
  assert.equal(r.reachable, true);
  assert.ok(r.required.every((x) => x.breakEven === 0 && x.target === 0));
  for (const o of r.options) {
    assert.equal(o.stats.pLoss, 0);
    assert.equal(o.stats.pTarget, 1);
    assert.equal(o.stats.costs, 0);
    assert.equal(o.stats.breakEvenOcc, 0);
    close(o.stats.profit, o.stats.revenue, 1e-9);
    assert.ok(o.pros.includes('Almost certain to cover all costs.'));
  }
});

test('all nights booked: nothing to price, one card, exact profit', () => {
  const ns = nights('2026-10-27', 30, {}).map((n) => Object.assign({}, n, { status: 'booked', booked: 216 }));
  const r = R.plan(input({ nights: ns, assumptions: { cancelRate: 0 } }));
  assert.equal(r.open, 0);
  assert.equal(r.options.length, 1);
  assert.deepEqual(r.options[0].keys, ['current', 'fill', 'balanced', 'profit', 'premium']);
  const s = r.options[0].stats;
  assert.equal(s.occ, 1);
  close(s.profit, 30 * (216 - 15 - 120 / 2.7) - 2500 * 30 / 30.4, 1e-6);
  assert.equal(s.pTarget, s.profitPerMonth >= 1500 ? 1 : 0);
  assert.equal(s.p10, s.p90);
  assert.deepEqual(r.options[0].prices, {});
  assert.ok(r.notes.includes('Every night in these dates is booked, so there is nothing to price.'));
});

test('all nights blocked: a loss of the fixed costs, no crash', () => {
  const ns = nights('2026-10-27', 30, {}).map((n) => Object.assign({}, n, { status: 'blocked' }));
  const r = R.plan(input({ nights: ns }));
  assert.equal(r.open, 0);
  assert.equal(r.blocked, 30);
  assert.equal(r.options.length, 1);
  const s = r.options[0].stats;
  assert.equal(s.occ, 0);
  close(s.profitPerMonth, -2500, 1e-9);
  assert.equal(s.pLoss, 1);
  assert.ok(r.notes.includes('Every night in these dates is blocked, so there is nothing to price.'));
  assert.ok(r.notes.includes('With nothing to sell, the unit loses about RM 2,500 a month, short of the RM 1,500 target.'));
  assert.ok(r.options[0].pros.length && r.options[0].cons.length);
});

test('one-night horizon', () => {
  const r = R.plan(input({ nights: nights('2026-10-27', 1, {}) }));
  assert.equal(r.nights, 1);
  assert.ok(r.options.length >= 2);
  for (const o of r.options) {
    assert.ok(o.stats.occ >= 0 && o.stats.occ <= 1);
    assert.equal(Object.keys(o.prices).length, 1);
    assert.ok(o.pros.length && o.cons.length);
  }
  close(r.months, 1 / 30.4, 1e-12);
  /* no dates at all */
  const none = R.plan(input({ nights: [] }));
  assert.deepEqual(none.options, []);
  assert.deepEqual(none.notes, ['Choose some dates to plan.']);
});

test('nights with no current price: priced by every plan except today\'s', () => {
  const ns = nights('2026-10-27', 60, BOOKED).map((n, i) => (i % 4 === 1 && n.status === 'open' ? Object.assign({}, n, { current: null }) : n));
  const missing = ns.filter((n) => n.current === null).map((n) => n.iso);
  assert.ok(missing.length >= 10);
  const r = R.plan(input({ nights: ns, profitPerMonth: 800 }));
  const cur = optionWith(r, 'current');
  for (const iso of missing) assert.equal(cur.prices[iso], undefined);
  assert.ok(cur.cons.includes(missing.length + ' open nights have no price today, so they cannot sell.'));
  for (const o of r.options.filter((x) => !x.keys.includes('current'))) for (const iso of missing) {
    assert.ok(o.prices[iso] >= 0.6 * 230 && o.prices[iso] <= 1.8 * 230, o.name + ' ' + iso + ' ' + o.prices[iso]);
  }
  assert.ok(r.notes.includes(missing.length + ' open nights have no price today. Today\'s prices count them as not selling; the other plans give them a price.'));
  /* no prices at all: the base price, then the costs */
  const bare = nights('2026-10-27', 30, {}).map((n) => Object.assign({}, n, { current: null }));
  assert.equal(R.plan(input({ nights: bare, basePrice: 250, draws: 200 })).P0, 250);
  const fromCosts = R.plan(input({ nights: bare, draws: 200 }));
  assert.equal(fromCosts.P0, 295);   /* RM296.53 needed at 60%, to the nearest RM5 */
  assert.ok(fromCosts.notes.some((t) => /usual price is taken as RM 295, what the costs need\./.test(t)));
});

test('floor and ceiling are respected; prices are multiples of the rounding step', () => {
  const r = R.plan(input({ floor: 203, ceiling: 298, profitPerMonth: 800 }));
  for (const o of r.options.filter((x) => !x.keys.includes('current'))) {
    for (const [iso, p] of Object.entries(o.prices)) {
      assert.ok(p >= 203 && p <= 298, o.name + ' ' + iso + ' ' + p);
      assert.equal(p % 5, 0, o.name + ' ' + iso + ' ' + p);
    }
    assert.ok(o.stats.minPrice >= 205 && o.stats.maxPrice <= 295);
  }
  assert.ok(r.notes.includes('7 peak nights are held at the lowest or highest price allowed instead of today\'s price.'));
  for (const fr of r.frontier) for (const p of Object.values(fr.prices)) assert.ok(p >= 203 && p <= 298 && p % 5 === 0);
  /* a coarser step */
  const ten = R.plan(input({ assumptions: { rounding: 10 }, keepPeaks: false, draws: 300 }));
  for (const o of ten.options.filter((x) => !x.keys.includes('current'))) for (const p of Object.values(o.prices)) assert.equal(p % 10, 0);
  for (const o of PLAN800.options.filter((x) => !x.keys.includes('current'))) for (const p of Object.values(o.prices)) assert.equal(p % 5, 0);
  /* inside 0.6 to 1.8 times today's price */
  for (const o of PLAN800.options) for (const n of o.nightly) if (n.price != null && !n.peak) assert.ok(n.price >= 0.6 * n.current && n.price <= 1.8 * n.current);
});

/* ---------------------------------------------------------------- pros and cons */
test('pros and cons: present, plain, and their numbers match the stats', () => {
  const money = (n) => 'RM ' + Math.round(n).toLocaleString('en-US');
  const tens = (n) => money(Math.round(n / 10) * 10);
  for (const r of [PLAN, PLAN800, R.plan(input({ profitPerMonth: 300, seed: 5, draws: 500 }))]) {
    const tgt = money(r.target);
    for (const o of r.options) {
      assert.ok(o.pros.length > 0 && o.cons.length > 0, o.name);
      const all = o.pros.concat(o.cons), s = o.stats;
      for (const t of all.concat([o.summary])) {
        assert.ok(/^[A-Z0-9]/.test(t) && /\.$/.test(t), 'a full sentence: ' + t);
        assert.ok(!/—|lambda|logit|elasticity|NaN|undefined|Infinity/i.test(t), t);
      }
      /* the chance sentence */
      const p = s.pTarget;
      /* 45% to 55% is an even chance, a con: it could go either way */
      const want = p >= 0.95 ? 'Almost certain to make ' + tgt + ' a month.' : p < 0.05 ? 'Little chance of making ' + tgt + ' a month, less than 1 in 20.'
        : p >= 0.45 && p < 0.55 ? 'About an even chance of making ' + tgt + ' a month.' : 'About ' + n10(p) + ' in 10 chance of making ' + tgt + ' a month.';
      assert.equal(all.filter((t) => t === want).length, 1, o.name + ': ' + want + ' in ' + all.join(' | '));
      assert.equal(p >= 0.55 ? o.pros.includes(want) : o.cons.includes(want), true);
      /* the occupancy sentence, compared as the rounded percentages it shows */
      if (s.targetOcc != null && s.targetOcc <= 1 && s.targetOcc >= 0.005) assert.ok(all.some((t) => t.startsWith('Needs ' + Math.round(s.targetOcc * 100) + '% of nights sold to reach the target')), o.name);
      for (const t of all) {
        let x = /^Needs (\d+)% of nights sold to reach the target, more than the (\d+)% likely to sell\.$/.exec(t);
        if (x) assert.ok(+x[1] > +x[2], t);
        x = /^Needs (\d+)% of nights sold to reach the target, and about (\d+)% are likely to sell\.$/.exec(t);
        if (x) assert.ok(+x[1] < +x[2] && o.pros.includes(t), t);
      }
      /* the weak-demand sentence */
      const w = s.weakDemandProfitPerMonth;
      assert.ok(all.some((t) => (Math.round(w / 10) === 0 ? t.endsWith('% weaker, the unit about breaks even.') : w >= r.target ? t.startsWith('Still makes about ' + tens(w) + ' a month if demand is ') : w >= 0 ? t.endsWith('profit falls to about ' + tens(w) + ' a month.') : t.endsWith('the unit loses about ' + tens(-w) + ' a month.'))), o.name + ' weak demand');
      assert.ok(!all.some((t) => /RM 0 a month/.test(t)), o.name + ' no "RM 0 a month"');
      /* against today's prices */
      if (!o.keys.includes('current')) {
        const d = s.profitPerMonth - optionWith(r, 'current').stats.profitPerMonth;
        if (d >= 20) assert.ok(o.pros.includes('About ' + tens(d) + ' a month more profit than today\'s prices.'), o.name);
        if (d <= -20) assert.ok(o.cons.includes('About ' + tens(-d) + ' a month less profit than today\'s prices.'), o.name);
        /* prices against prices: the cards' Average rate */
        const dp = s.avgPrice - optionWith(r, 'current').stats.avgPrice;
        if (dp >= 5) assert.ok(o.pros.includes('Prices are about ' + money(dp) + ' a night higher than today on average, so each night sold brings in more.'), o.name + ' ' + all.join(' | '));
        if (dp <= -5) assert.ok(o.cons.includes('Prices are about ' + money(-dp) + ' a night lower than today on average, so each night sold brings in less.'), o.name + ' ' + all.join(' | '));
      } else {
        assert.ok(o.pros.includes('Nothing to change: guests keep seeing the prices they see now.'));
      }
    }
  }
  /* cleaning: Fill means more stays than today, Premium fewer */
  assert.ok(optionWith(PLAN800, 'fill').cons.some((t) => /more stays? a month to clean/.test(t)));
  assert.ok(optionWith(PLAN800, 'premium').pros.some((t) => /fewer stays? a month: less cleaning/.test(t)));
  assert.ok(optionWith(PLAN800, 'fill').pros.includes('More stays bring more reviews and better placement on booking sites.'));
  /* Fill's own forecast is above what few similar listings reach: one sentence that says to treat it as optimistic,
     not a con that contradicts the card's own occupancy */
  const fill = optionWith(PLAN800, 'fill');
  assert.ok(fill.stats.occ > 0.75);
  assert.ok(fill.cons.includes('The forecast expects ' + Math.round(fill.stats.occ * 100) + '% of nights sold, and few similar listings sell more than 75%, so treat this plan\'s numbers as optimistic.'), fill.cons.join(' | '));
  assert.ok(!fill.cons.some((t) => /^Needs \d+% of nights sold to reach the target; few/.test(t)));
  /* no city: the same sentences are shown for units anywhere */
  assert.equal(R.DEFAULTS.market, 'similar listings');
  for (const r of [PLAN, PLAN800]) for (const o of r.options) assert.ok(!o.pros.concat(o.cons).some((t) => /Kuala Lumpur/.test(t)), o.name);
});

test('the building\'s other unit types: the plans keep this unit between them, say so, and today\'s prices are flagged when they do not', () => {
  const ns = nights('2026-10-27', 90, BOOKED);
  const better = Object.fromEntries(ns.map((n) => [n.iso, n.current + 30]));   /* RM30 above this unit every night */
  const cheaper = Object.fromEntries(ns.map((n) => [n.iso, 180]));
  const tiers = [{ name: 'Deluxe', prices: better }, { name: 'Studio', prices: cheaper }];
  const inp = input({ profitPerMonth: 800, otherTiers: tiers });
  const r = R.plan(inp);
  for (const o of r.options) {
    assert.deepEqual(o.stats.tierAbove, [], o.name);
    assert.deepEqual(o.stats.tierBelow, [], o.name);
    assert.ok(o.pros.includes('Keeps the other unit types in this building in order, at least 5% apart (or as far apart as today, where that is less).'), o.name);
    /* Deluxe at least 5% dearer, Studio at least 5% cheaper */
    for (const [iso, p] of Object.entries(o.prices)) { assert.ok(p < better[iso], o.name + ' ' + iso); if (!o.keys.includes('current')) assert.ok(p * 1.05 <= better[iso] + 1e-9 && p >= 189, o.name + ' ' + iso); }
  }
  /* 75 open nights that are not peaks (the 7 peaks keep today's price) */
  assert.ok(r.notes.includes('To keep the unit types in this building in order and at least 5% apart (or as far apart as today, where that is less), the plans keep this unit below Deluxe and above Studio. That limits the prices of 75 nights.'), r.notes.join(' | '));
  /* Premium stops at Deluxe's prices, and says that rather than blaming the range of prices tried */
  assert.match(optionWith(r, 'premium').summary, /^The highest prices that keep this unit below Deluxe, which still make RM 800 a month on average\.$/);
  assert.ok(!r.notes.some((t) => /stopped at/.test(t)), r.notes.join(' | '));
  /* prices of your own that break the order get the cons, early enough to be among the three a card shows */
  const dear = R.evaluate(inp, Object.fromEntries(Object.entries(better).map(([iso, p]) => [iso, p + 10])));
  assert.ok(dear.stats.tierAbove.find((t) => t.name === 'Deluxe').nights > 30);
  assert.ok(dear.cons.some((t) => /^On \d+ nights this unit would cost as much as or more than Deluxe, a better unit type in this building\.$/.test(t)));
  assert.ok(dear.cons.findIndex((t) => /Deluxe/.test(t)) < 3, dear.cons.join(' | '));
  const cheap = R.evaluate(inp, Object.fromEntries(ns.map((n) => [n.iso, 170])));
  assert.ok(cheap.stats.tierBelow.find((t) => t.name === 'Studio').nights > 10);
  assert.ok(cheap.cons.some((t) => /^On \d+ nights this unit would cost no more than Studio, a cheaper unit type in this building\.$/.test(t)));
  /* in order, but closer than the gap: its own con, and no order pro */
  const near = R.evaluate(inp, Object.fromEntries(ns.map((n) => [n.iso, 185])));
  assert.deepEqual(near.stats.tierBelow, []);
  assert.ok(near.stats.tierClose.find((t) => t.name === 'Studio').nights > 10);
  assert.ok(near.cons.some((t) => /^On \d+ nights this unit would be priced within 5% of Studio, a cheaper unit type in this building\.$/.test(t)), near.cons.join(' | '));
  assert.ok(!near.pros.some((t) => /in order/.test(t)));
  assert.ok(cheap.cons.findIndex((t) => /Studio/.test(t)) < 3, cheap.cons.join(' | '));
  /* today's prices already above the better type: Today's prices is flagged and takes no other role, and the plans go
     below it on every night but the peaks, which keep today's price */
  const under = Object.fromEntries(ns.map((n) => [n.iso, n.current - 20]));
  const r2 = R.plan(input({ profitPerMonth: 800, otherTiers: [{ name: 'Deluxe', prices: under, better: true }] }));
  const cur = optionWith(r2, 'current');
  assert.deepEqual(cur.keys, ['current']);
  assert.ok(cur.cons.some((t) => /^On 82 nights this unit costs as much as or more than Deluxe, a better unit type in this building\.$/.test(t)), cur.cons.join(' | '));
  for (const o of r2.options.filter((x) => !x.keys.includes('current'))) {
    assert.deepEqual(o.stats.tierAbove, [{ name: 'Deluxe', nights: 7 }], o.name);
    for (const n of ns) if (n.status === 'open' && !r2.calibration.peaks.some((p) => p.iso === n.iso)) assert.ok(o.prices[n.iso] < under[n.iso], o.name + ' ' + n.iso);
  }
  /* no other unit types: no note, and no order pro */
  assert.ok(!PLAN800.notes.some((t) => /unit types/.test(t)));
  assert.ok(!PLAN800.options.some((o) => o.pros.some((t) => /right order|in order/.test(t))));
});

test('the building\'s unit types stay apart: at least tierGap, today\'s gap where smaller, order only at 0', () => {
  const ns = nights('2026-10-27', 90, BOOKED);
  const better = Object.fromEntries(ns.map((n) => [n.iso, n.current + 40]));
  const cheaper = Object.fromEntries(ns.map((n) => [n.iso, n.current - 40]));
  const tiers = [{ name: 'Deluxe', prices: better, better: true }, { name: 'Studio', prices: cheaper, better: false }];
  const r = R.plan(input({ profitPerMonth: 800, otherTiers: tiers }));
  const peaks = new Set(r.calibration.peaks.map((p) => p.iso));
  for (const o of r.options) {
    assert.deepEqual(o.stats.tierClose, [], o.name);
    for (const [iso, p] of Object.entries(o.prices)) {
      if (peaks.has(iso)) continue;
      assert.ok(p * 1.05 <= better[iso] + 1e-9, o.name + ' ' + iso + ' ' + p + ' vs ' + better[iso]);
      assert.ok(p >= cheaper[iso] * 1.05 - 1e-9, o.name + ' ' + iso + ' ' + p + ' vs ' + cheaper[iso]);
    }
  }
  /* a 10% gap from the assumptions */
  const r10 = R.plan(input({ profitPerMonth: 800, otherTiers: tiers, assumptions: { tierGap: 0.1 } }));
  for (const o of r10.options) for (const [iso, p] of Object.entries(o.prices)) {
    if (peaks.has(iso) || o.keys.includes('current')) continue;
    assert.ok(p * 1.1 <= better[iso] + 1e-9 || p === ns.find((n) => n.iso === iso).current, o.name + ' ' + iso);
    assert.ok(p >= cheaper[iso] * 1.1 - 1e-9 || p === ns.find((n) => n.iso === iso).current, o.name + ' ' + iso);
  }
  assert.ok(r10.options[0].pros.concat(r10.options[0].cons).some((t) => /10%/.test(t)) || r10.notes.some((t) => /10% apart/.test(t)), r10.notes.join(' | '));
  /* today's gap when it is smaller: RM5 above today's price stays allowed, nothing dearer */
  const close = Object.fromEntries(ns.map((n) => [n.iso, n.current + 5]));
  const r5 = R.plan(input({ profitPerMonth: 800, otherTiers: [{ name: 'Deluxe', prices: close, better: true }] }));
  for (const o of r5.options) {
    assert.deepEqual(o.stats.tierClose, [], o.name);
    for (const [iso, p] of Object.entries(o.prices)) assert.ok(p <= close[iso] - 5, o.name + ' ' + iso);
  }
  /* at 0, the order only, as before: a step below Deluxe is allowed */
  const r0 = R.plan(input({ profitPerMonth: 800, otherTiers: tiers, assumptions: { tierGap: 0 } }));
  assert.ok(r0.options.every((o) => o.pros.includes('Keeps the right order against the other unit types in this building.')));
  assert.ok(r0.notes.some((t) => /^To keep the unit types in this building in order, the plans/.test(t)), r0.notes.join(' | '));
});

test('unit types too close for the gap: the order still holds, with notes; peers and lost nights are named', () => {
  const ns = nights('2026-10-27', 90, BOOKED);
  const open = ns.filter((n) => n.status === 'open');
  const by = (f) => Object.fromEntries(ns.map((n) => [n.iso, f(n)]));
  const inOrder = (r, lo, hi, skip) => {
    let bad = 0;
    for (const o of r.options) for (const n of open) {
      if (skip && skip.has(n.iso)) continue;
      const p = o.prices[n.iso]; if (!(p > 0)) continue;
      if (!(p > lo[n.iso] && p < hi[n.iso])) bad++;
    }
    return bad;
  };
  /* a middle type squeezed: Standard RM10 under today's price, Premium RM12 over it, today's price off the step */
  const std = by((n) => n.current - 10), prm = by((n) => n.current + 12);
  const off = ns.map((n) => Object.assign({}, n, { current: n.current + 1 }));
  const rq = R.plan(input({ profitPerMonth: 800, nights: off, otherTiers: [{ name: 'Standard', prices: std, better: false }, { name: 'Premium', prices: prm, better: true }] }));
  const peaksQ = new Set(rq.calibration.peaks.map((p) => p.iso));
  assert.equal(inOrder(rq, std, prm, peaksQ), 0);
  assert.ok(rq.notes.some((t) => /^On \d+ nights Standard and Premium are too close in price to keep this unit 5% from both, so there the plans only keep it between them\.$/.test(t)), rq.notes.join(' | '));
  /* the same with no price today on the middle type, and with today's price out of order */
  const none = ns.map((n) => Object.assign({}, n, { current: 0 }));
  const rn = R.plan(input({ profitPerMonth: 800, nights: none, basePrice: 230, otherTiers: [{ name: 'Standard', prices: std, better: false }, { name: 'Premium', prices: prm, better: true }] }));
  /* 31 Dec: Standard's RM555 is above the highest price tried for a unit with no price (180% of RM230), and a note says so */
  assert.equal(inOrder(rn, std, prm, new Set(['2026-12-31'])), 0);
  assert.ok(rn.notes.includes("On 1 night the highest price tried (180% of today's) leaves no room over Standard, so the plans use it there."), rn.notes.join(' | '));
  const low = ns.map((n) => Object.assign({}, n, { current: n.current - 20 }));
  const rl = R.plan(input({ profitPerMonth: 800, nights: low, otherTiers: [{ name: 'Standard', prices: std, better: false }, { name: 'Premium', prices: prm, better: true }] }));
  const peaksL = new Set(rl.calibration.peaks.map((p) => p.iso));
  for (const o of rl.options.filter((x) => !x.keys.includes('current'))) for (const n of open) if (!peaksL.has(n.iso)) assert.ok(o.prices[n.iso] > std[n.iso] && o.prices[n.iso] < prm[n.iso], o.name + ' ' + n.iso);
  /* rounding 10 on a Kozi-like ladder: Standard 230, Boutique 235 today, Premium 250 */
  const ns2 = ns.map((n) => Object.assign({}, n, { current: 235 }));
  const s2 = by(() => 230), p2 = by(() => 250);
  const r10 = R.plan(input({ profitPerMonth: 800, nights: ns2, assumptions: { rounding: 10 }, otherTiers: [{ name: 'Standard', prices: s2, better: false }, { name: 'Premium', prices: p2, better: true }] }));
  assert.equal(inOrder(r10, s2, p2), 0);
  for (const o of r10.options.filter((x) => !x.keys.includes('current'))) for (const n of open) assert.equal(o.prices[n.iso], 240, o.name + ' ' + n.iso);
  /* no step between them at all: one price, and a note */
  const p3 = by(() => 238);
  const r1 = R.plan(input({ profitPerMonth: 800, nights: ns2, assumptions: { rounding: 10 }, otherTiers: [{ name: 'Standard', prices: s2, better: false }, { name: 'Premium', prices: p3, better: true }] }));
  assert.ok(r1.notes.some((t) => /^On \d+ nights no price in steps of RM 10 fits between Standard and Premium, so there the plans use a single price, the step nearest today's price or halfway\.$/.test(t)), r1.notes.join(' | '));
  /* RM235 is halfway between the steps 230 and 240: the lower one, so the unit is never dearer than Premium */
  for (const o of r1.options.filter((x) => !x.keys.includes('current'))) for (const n of open) assert.equal(o.prices[n.iso], 230, o.name + ' ' + n.iso);
});

test('unit types: a type priced like this one is a peer, the floor and the range tried can win, and the gap is written exactly', () => {
  const ns = nights('2026-10-27', 90, BOOKED);
  const same = Object.fromEntries(ns.map((n) => [n.iso, n.current]));
  const rp = R.plan(input({ profitPerMonth: 800, otherTiers: [{ name: 'Twin', prices: same }] }));
  assert.ok(rp.notes.includes('Twin has about the same usual price as this unit, so the plans keep no order against it.'), rp.notes.join(' | '));
  for (const o of rp.options) {
    assert.ok(!o.cons.some((t) => /Twin/.test(t)), o.cons.join(' | '));
    assert.ok(!o.pros.some((t) => /in order/.test(t)), o.pros.join(' | '));
  }
  /* the floor above what keeps this unit under Deluxe */
  const deluxe = Object.fromEntries(ns.map((n) => [n.iso, n.current + 20]));
  const rf = R.plan(input({ profitPerMonth: 800, floor: 250, otherTiers: [{ name: 'Deluxe', prices: deluxe, better: true }] }));
  assert.ok(rf.notes.some((t) => /^On \d+ nights your lowest price, RM 250, leaves no room under Deluxe, so the plans use it there\.$/.test(t)), rf.notes.join(' | '));
  const kept = rf.notes.find((t) => /^To keep the unit types/.test(t));
  const nKept = kept ? +kept.match(/limits the prices of (\d+) night/)[1] : 0;
  const nLost = +rf.notes.find((t) => /your lowest price/.test(t)).match(/^On (\d+) night/)[1];
  assert.ok(nLost > 0 && nKept + nLost <= 82, kept + ' / ' + nLost);
  /* the range tried: Deluxe far below today's price */
  const cheapD = Object.fromEntries(ns.map((n) => [n.iso, Math.round(n.current * 0.5)]));
  const rr = R.plan(input({ profitPerMonth: 800, otherTiers: [{ name: 'Deluxe', prices: cheapD, better: true }] }));
  assert.ok(rr.notes.some((t) => /^On \d+ nights the lowest price tried \(60% of today's\) leaves no room under Deluxe, so the plans use it there\.$/.test(t)), rr.notes.join(' | '));
  assert.ok(!rr.notes.some((t) => /^To keep the unit types/.test(t)), rr.notes.join(' | '));
  /* a gap of 4.5% is written as 4.5%, one under 0.05% counts as none */
  const better = Object.fromEntries(ns.map((n) => [n.iso, n.current + 40]));
  const r45 = R.plan(input({ profitPerMonth: 800, assumptions: { tierGap: 0.045 }, otherTiers: [{ name: 'Deluxe', prices: better, better: true }] }));
  assert.ok(r45.notes.some((t) => /at least 4\.5% apart/.test(t)), r45.notes.join(' | '));
  const r0 = R.plan(input({ profitPerMonth: 800, assumptions: { tierGap: 0.0004 }, otherTiers: [{ name: 'Deluxe', prices: better, better: true }] }));
  assert.ok(r0.notes.some((t) => /^To keep the unit types in this building in order, the plans/.test(t)), r0.notes.join(' | '));
});

test('money in sentences comes from input.money when given', () => {
  const r = R.plan(input({ profitPerMonth: 800, money: (n) => 'MYR' + Math.round(n), draws: 300 }));
  assert.ok(r.options[0].pros.concat(r.options[0].cons).some((t) => /MYR800/.test(t)));
  assert.ok(r.options.every((o) => !o.pros.concat(o.cons).some((t) => /RM /.test(t))));
});

/* ---------------------------------------------------------------- review fixes */
const texts = (r) => r.notes.concat(...r.options.map((o) => o.pros.concat(o.cons, [o.summary])));

test('Balanced: chances within the noise count as equal, so the pick hardly moves with the seed or a small cost change', () => {
  const picks = [];
  for (const seed of [1, 2, 3, 4]) picks.push({ s: optionWith(R.plan(input({ profitPerMonth: 800, seed })), 'balanced').stats, d: 0 });
  for (const d of [-20, 20]) picks.push({ s: optionWith(R.plan(input({ profitPerMonth: 800, costs: Object.assign({}, COSTS, { rent: 1700 + d }) })), 'balanced').stats, d });
  const spread = (f) => Math.max(...picks.map(f)) - Math.min(...picks.map(f));
  assert.ok(spread((x) => x.s.weekday.avgPrice) < 10, 'weekday price spread ' + spread((x) => x.s.weekday.avgPrice));
  /* profit with the rent change taken back out */
  assert.ok(spread((x) => x.s.profitPerMonth + x.d) < 25, 'profit spread ' + spread((x) => x.s.profitPerMonth + x.d));
});

test('Fill or Premium stopped by the prices tried, or by the owner\'s limit, says so', () => {
  const low = R.plan(input({ profitPerMonth: 200, draws: 500 }));
  assert.match(optionWith(low, 'fill').summary, /^The lowest prices the planner tries \(60% of today's\), which still make RM 200 a month on average, to sell the most nights\./);
  assert.ok(low.notes.includes('Fill the calendar stopped at the lowest prices the planner tries (60% of today\'s) and still makes RM 200 a month on average, so even lower prices could sell more nights. Lowest price to try, in the assumptions, sets this limit.'), low.notes.join(' | '));
  const busy = R.plan(input({ assumptions: { baseOcc: 0.9 }, draws: 500 }));
  assert.match(optionWith(busy, 'premium').summary, /^The highest prices the planner tries \(180% of today's\), which still make RM 1,500 a month on average\./);
  assert.ok(busy.notes.some((t) => t.startsWith('Premium rates stopped at the highest prices the planner tries (180% of today\'s)')));
  const floor = R.plan(input({ profitPerMonth: 800, floor: 250, draws: 500 }));
  assert.match(optionWith(floor, 'fill').summary, /^The lowest price you allow \(RM 250\), which still makes RM 800 a month on average, to sell the most nights\./);
  assert.ok(floor.notes.some((t) => t.startsWith('Fill the calendar stopped at the lowest price you allow (RM 250) and still makes RM 800 a month on average')));
  /* the fixture's own plans stop well inside the range */
  assert.ok(!PLAN800.notes.some((t) => /stopped at/.test(t)));
});

test('Today\'s prices take no other role when they break the floor or ceiling, or leave open nights unpriced', () => {
  const floor = R.plan(input({ profitPerMonth: 800, floor: 250, draws: 500 }));
  assert.deepEqual(optionWith(floor, 'current').keys, ['current']);
  for (const o of floor.options.filter((x) => !x.keys.includes('current'))) assert.ok(o.stats.minPrice >= 250, o.name);
  const ceil = R.plan(input({ profitPerMonth: 800, ceiling: 150, draws: 500 }));
  assert.deepEqual(optionWith(ceil, 'current').keys, ['current']);
  for (const o of ceil.options.filter((x) => !x.keys.includes('current'))) assert.ok(o.stats.maxPrice <= 150, o.name);
  /* no prices, no costs, no base price: the usual price comes from the booked nights, and Today's prices (which sells
     only the booked nights) is not Premium */
  const bare = R.plan(input({ nights: nights('2026-10-27', 90, BOOKED).map((n) => Object.assign({}, n, { current: null })), costs: {}, profitPerMonth: 0, draws: 500 }));
  assert.equal(bare.P0, 285);   /* the median booked RM270 / 0.94, to the nearest RM5 */
  assert.equal(bare.calibration.P0From, 'booked');
  assert.ok(bare.notes.includes('There are no prices in these dates to start from, so the usual price is taken as RM 285, from what the booked nights brought in.'));
  assert.deepEqual(optionWith(bare, 'current').keys, ['current']);
  assert.ok(!texts(bare).some((t) => /of today's\)/.test(t)), 'no prices today, so the range is not "of today\'s"');
});

test('no plan covers its costs on average: Balanced is Most profit, the smallest loss, not a long shot at higher prices', () => {
  const inp = input({ nights: nights('2026-10-27', 60, BOOKED), costs: Object.assign({}, COSTS, { rent: 2260, cleaning: 158, ownerSharePct: 20 }), profitPerMonth: 800, assumptions: { baseOcc: 0.57, beta: 2.8 } });
  for (const seed of [1, 9]) {
    const r = R.plan(Object.assign({}, inp, { seed }));
    assert.equal(r.reachable, false);
    const b = optionWith(r, 'balanced');
    assert.equal(b, optionWith(r, 'profit'));
    assert.ok(b.stats.profitPerMonth < 0);
    assert.match(b.summary, /^No plan covers all costs on average, so this is the one that loses the least\./);
    assert.ok(r.notes.includes('On average, no plan covers all costs in these dates either.'));
  }
});

test('short dates: no option beats Balanced clearly on the chance of the target and on profit, and the figures are called rough', () => {
  for (const [from, count, tgt] of [['2026-10-28', 1, 800], ['2026-10-28', 7, 1500], ['2027-02-01', 14, 1100]]) {
    const r = R.plan(input({ nights: nights(from, count, {}), profitPerMonth: tgt }));
    const b = optionWith(r, 'balanced');
    for (const o of r.options) assert.ok(!(o.stats.pTarget > b.stats.pTarget + NOISE && o.stats.profitPerMonth > b.stats.profitPerMonth), count + ' nights: ' + o.name);
    const rough = 'These dates cover only ' + count + (count === 1 ? ' night' : ' nights') + ', so the monthly figures are rough: one booking more or less changes them a lot.';
    assert.equal(r.notes.includes(rough), count < 14, count + ' nights');
  }
  /* one night two days ahead: Most profit has about an even chance of RM800 a month (the night either sells or not),
     and the note says so next to "on average" */
  const one = R.plan(input({ nights: nights('2026-10-28', 1, {}), profitPerMonth: 800 }));
  assert.ok(optionWith(one, 'balanced').stats.pTarget > 0.4);
  assert.ok(one.notes.some((t) => /^On average, no plan reaches RM 800 a month\..*the recommended plan still has (about an? \d in 10|about an even) chance of reaching it\.$/.test(t)), one.notes.join(' | '));
  /* every night it has moved by 15% or more: the con says it of the one night, not "1 of the 1 night" */
  const bal = optionWith(one, 'balanced');
  if (bal.stats.bigMoves === 1) assert.ok(bal.cons.includes('Moves the night with a price today by 15% or more, and the forecast is less sure about prices guests have not seen.'), bal.cons.join(' | '));
});

test('short dates: counts are over the dates, not a month, and shares never read "10 in 10"', () => {
  const one = R.plan(input({ nights: nights('2026-10-28', 1, {}), profitPerMonth: 800 }));
  const all = texts(one);
  assert.ok(!all.some((t) => /(more|fewer) nights? sold a month|(more|fewer) stays? a month|10 in 10/.test(t)), all.join(' | '));
  assert.ok(all.some((t) => / over these dates/.test(t)));
  assert.ok(one.notes.some((t) => /^Guests book late for these dates: almost all of the nights/.test(t)), one.notes.join(' | '));
  /* 90 nights keep the monthly wording */
  assert.ok(texts(PLAN800).some((t) => /(more|fewer) nights? sold a month than with today's prices\./.test(t)));
});

test('a booked night with no amount is counted at today\'s price less the usual discount, and an explicit 0 stays RM0', () => {
  const as = (v) => nights('2026-10-27', 90, BOOKED).map((n) => (n.status === 'booked' ? Object.assign({}, n, { booked: v }) : n));
  const sure = { cancelRate: 0 };   /* no cancellations, so the booked amounts count in full */
  const unknown = R.plan(input({ nights: as(null), profitPerMonth: 800, draws: 500, assumptions: sure }));
  const free = R.plan(input({ nights: as(0), profitPerMonth: 800, draws: 500, assumptions: sure }));
  const missing = R.plan(input({ nights: as(undefined), profitPerMonth: 800, draws: 500, assumptions: sure }));
  assert.ok(unknown.notes.includes('8 booked nights have no amount recorded, so they are counted at today\'s price less the usual discount.'));
  assert.ok(!free.notes.some((t) => /no amount recorded/.test(t)));
  assert.deepEqual(missing.options, unknown.options);
  /* RM230 on 2 weeknights and RM290 on 6 weekend nights, less 6% */
  close(optionWith(unknown, 'current').stats.revenue - optionWith(free, 'current').stats.revenue, (2 * 230 + 6 * 290) * 0.94, 1e-6);
});

test('a negative target counts as 0, and with target 0 the chance of covering costs is said once', () => {
  const neg = R.plan(input({ profitPerMonth: -800, draws: 500 })), zero = R.plan(input({ profitPerMonth: 0, draws: 500 }));
  assert.equal(neg.target, 0);
  assert.deepEqual(neg.options, zero.options);
  assert.deepEqual(neg.notes, zero.notes);
  for (const o of zero.options) {
    const all = o.pros.concat(o.cons);
    assert.ok(!all.some((t) => /lose money over these dates|losing money over these dates|unlikely to lose money/.test(t)), o.name + ': ' + all.join(' | '));
    assert.equal(all.filter((t) => /(chance of|certain to) cover(ing)? all costs/.test(t)).length, 1, o.name + ': ' + all.join(' | '));
  }
  /* with a target above 0 the loss sentence is still there when it matters */
  assert.ok(optionWith(PLAN, 'premium').cons.some((t) => /chance of losing money over these dates\.$/.test(t)));
});

test('target 0 and every plan losing money: no broken sentences', () => {
  /* guests a little more sensitive to price, so Most profit is clearly ahead of today's prices */
  const r = R.plan(input({ costs: Object.assign({}, COSTS, { rent: 8000 }), profitPerMonth: 0, draws: 500, assumptions: { beta: 5 } }));
  const all = texts(r);
  assert.ok(!all.some((t) => /RM 0 a month|make all costs|highest expected profit, about [−-]|more profit than today|either/.test(t)), all.join(' | '));
  const b = optionWith(r, 'balanced');
  assert.equal(b, optionWith(r, 'profit'));
  assert.match(b.summary, /^No plan covers all costs on average, so this is the one that loses the least\. The smallest loss, about RM [\d,]+ a month\.$/);
  assert.ok(b.pros.some((t) => /^About RM [\d,]+ a month less loss than today's prices\.$/.test(t)), b.pros.join(' | '));
  assert.ok(optionWith(r, 'current').cons.some((t) => /^Loses about RM [\d,]+ a month more than the Most profit plan\.$/.test(t)));
  assert.ok(r.notes.some((t) => /^On average, no plan covers all costs in these dates\. The best one loses about RM [\d,]+ a month\.$/.test(t)), r.notes.join(' | '));
  assert.ok(r.notes.some((t) => t.startsWith('To cover them, costs would need to be about ')));
});

test('a wide occupancy margin near either limit widens the range but moves the forecast only a little', () => {
  const at = (q, sd) => R.evaluate(input({ profitPerMonth: 800, draws: 500, assumptions: { baseOcc: q, baseOccSd: sd } }), {}).stats;
  /* near the top */
  let narrow = at(0.95, 0.02), wide = at(0.95, 0.2);
  assert.ok(wide.occ > narrow.occ - 0.08, narrow.occ + ' -> ' + wide.occ);
  assert.ok(wide.p10 < narrow.p10 && wide.p90 >= narrow.p90 - 1e-9);
  assert.ok(wide.p10 > 0, 'P10 ' + wide.p10);
  /* near the bottom: the spread is the narrower side (0.2 up to 0.4, not 0.2 down to 0.01), so the expected forecast
     moves about 3 points here instead of about 8 */
  narrow = at(0.2, 0.02); wide = at(0.2, 0.2);
  assert.ok(wide.occ < narrow.occ + 0.05, narrow.occ + ' -> ' + wide.occ);
  assert.ok(Math.abs(wide.profitPerMonth - narrow.profitPerMonth) < 250, narrow.profitPerMonth + ' -> ' + wide.profitPerMonth);
  assert.ok(wide.p10 < narrow.p10 && wide.p90 > narrow.p90);
  /* in the middle the default margin is about 0.33 in log-odds, as before */
  const mid = at(0.6, 0.08);
  assert.ok(Math.abs(mid.occ - at(0.6, 0.02).occ) < 0.01);
});

test('weak demand that rounds to RM 0 reads "about breaks even": a con short of a target, a pro with no target', () => {
  const prices = optionWith(PLAN800, 'balanced').prices;
  const weakOf = (o) => o.pros.concat(o.cons).filter((t) => /% weaker/.test(t));
  /* profit is linear in the rent, so moving the rent by the weak-demand profit brings that profit to about 0 */
  const w0 = R.evaluate(input({ profitPerMonth: 800, draws: 500 }), prices).stats.weakDemandProfitPerMonth;
  for (const d of [-3, 3]) {
    const costs = Object.assign({}, COSTS, { rent: COSTS.rent + w0 + d });
    const t800 = R.evaluate(input({ profitPerMonth: 800, draws: 500, costs }), prices);
    close(t800.stats.weakDemandProfitPerMonth, -d, 1e-6);
    assert.equal(weakOf(t800).length, 1);
    assert.match(weakOf(t800)[0], /^If demand is \d+% weaker, the unit about breaks even\.$/);
    assert.ok(t800.cons.includes(weakOf(t800)[0]), 'a con with a target');
    const t0 = R.evaluate(input({ profitPerMonth: 0, draws: 500, costs }), prices);
    if (d > 0) {
      /* a small loss with no target: about breaks even, a pro */
      assert.match(weakOf(t0)[0], /^If demand is \d+% weaker, the unit about breaks even\.$/);
      assert.ok(t0.pros.includes(weakOf(t0)[0]));
    } else assert.match(weakOf(t0)[0], /^Still covers its costs if demand is \d+% weaker\.$/);
    assert.ok(!t800.pros.concat(t800.cons, t0.pros, t0.cons).some((t) => /RM 0 a month/.test(t)));
  }
});

test('the owner\'s price limits come back on the result as the prices use them', () => {
  assert.deepEqual(PLAN800.limits, { floor: null, ceiling: null });
  const r = R.plan(input({ floor: 203, ceiling: 298, profitPerMonth: 800, draws: 300 }));
  assert.deepEqual(r.limits, { floor: 205, ceiling: 295 });
  /* no step between them: the floor wins */
  const tight = R.plan(input({ floor: 201, ceiling: 204, profitPerMonth: 800, draws: 300 }));
  assert.deepEqual(tight.limits, { floor: 205, ceiling: 205 });
  for (const o of tight.options.filter((x) => !x.keys.includes('current'))) for (const p of Object.values(o.prices)) assert.equal(p, 205);
});

test('invalid dates are left out, with no NaN or "undefined" anywhere', () => {
  const odd = [{ iso: '2026-13-45', dow: 1, lead: 50, current: 200, status: 'open' }, { iso: '2027-02-30', dow: 2, lead: 100, current: 200, status: 'open' }];
  const r = R.plan(input({ profitPerMonth: 800, draws: 300, nights: nights('2026-10-27', 30, {}).concat(odd) }));
  assert.equal(r.nights, 30);
  assert.ok(!/undefined|NaN|null,"profitPerMonth"/.test(JSON.stringify(r)));
  for (const o of r.options) assert.ok(Number.isFinite(o.stats.profitPerMonth) && Number.isFinite(o.stats.occ), o.name);
  /* an invalid today: leads come from the nights, nothing breaks */
  const t = R.plan(input({ today: '2026-02-30', draws: 200, profitPerMonth: 800 }));
  assert.equal(t.nights, 90);
  assert.ok(!/undefined|NaN/.test(JSON.stringify(t)));
});

test('the demand curve passes through the Today\'s prices card, also with unpriced nights', () => {
  const ns = nights('2026-10-27', 60, BOOKED).map((n, i) => (i % 4 === 1 && n.status === 'open' ? Object.assign({}, n, { current: null }) : n));
  const r = R.plan(input({ nights: ns, profitPerMonth: 800, draws: 500 }));
  const at1 = r.demandCurve.find((x) => Math.abs(x.factor - 1) < 1e-9), cur = optionWith(r, 'current').stats;
  close(at1.occ, cur.occ, 1e-9);
  close(at1.profitPerMonth, cur.profitPerMonth, 1e-6);
});

test('evaluate quotes the same weak-demand figure as the plan, also when no open night has a price', () => {
  const bare = input({ nights: nights('2026-10-27', 60, BOOKED).map((n) => (n.status === 'open' ? Object.assign({}, n, { current: null }) : n)), basePrice: 230, profitPerMonth: 800, draws: 500 });
  const r = R.plan(bare), weak = (o) => o.pros.concat(o.cons).filter((t) => /% weaker/.test(t));
  for (const o of r.options) {
    assert.equal(weak(o).length, 1, o.name);
    assert.deepEqual(weak(R.evaluate(bare, o.prices)), weak(o), o.name);
  }
});

test('Fill and Premium reach the goal with a margin, checked on separate draws, so "reaches the target" does not hinge on noise', () => {
  for (const seed of [3, 7]) {
    const r = R.plan(input({ profitPerMonth: 800, seed }));
    for (const k of ['fill', 'premium']) {
      const o = optionWith(r, k);
      assert.ok(o.stats.profitPerMonth >= 805, seed + ' ' + k + ' ' + o.stats.profitPerMonth);
      const other = [101, 102, 103].map((sd) => R.evaluate(input({ profitPerMonth: 800, seed: sd }), o.prices).stats.profitPerMonth);
      assert.ok(other.reduce((a, b) => a + b, 0) / other.length >= 800, seed + ' ' + k + ' on other draws ' + other.join(', '));
    }
    /* out of reach the goal is covering costs */
    assert.ok(optionWith(R.plan(input({ seed })), 'premium').stats.profitPerMonth >= 5);
  }
});

test('late bookings: one note for the dates, and a con only for a plan that relies on them clearly more than today\'s prices', () => {
  /* 90 nights: almost half of a far night's bookings come in the last 3 days, not enough for the note; the next 10
     nights: most of what still sells comes late */
  const soon = R.plan(input({ nights: nights('2026-10-27', 10, {}), profitPerMonth: 800 }));
  for (const r of [PLAN, PLAN800, soon]) {
    const cur = optionWith(r, 'current').stats, bal = optionWith(r, 'balanced').stats;
    for (const o of r.options) {
      const has = o.cons.some((t) => /^Relies on late bookings/.test(t));
      assert.equal(has, !o.keys.includes('current') && o.stats.lateShare >= 0.6 && o.stats.lateShare >= cur.lateShare + 0.1, o.name);
    }
    assert.equal(r.notes.some((t) => /^Guests book late for these dates/.test(t)), bal.lateShare >= 0.6);
  }
  close(optionWith(PLAN800, 'current').stats.lateShare, 0.45, 0.05);
  assert.ok(soon.notes.some((t) => /^Guests book late for these dates: about \d in 10 of the nights likely to sell usually book in the last 3 days before arrival, so the calendar fills late\.$/.test(t)), soon.notes.join(' | '));
});

test('peaks kept at today\'s price below the ordinary nights get a con', () => {
  const r = R.plan(input({ profitPerMonth: 0, draws: 500 })), prem = optionWith(r, 'premium');
  assert.ok(prem.stats.weekday.avgPrice > prem.stats.peak.avgPrice);
  const con = 'Ordinary nights would cost more than the peak nights, which stay at today\'s price.';
  assert.ok(prem.cons.includes(con), prem.cons.join(' | '));
  for (const o of PLAN800.options) {
    const s = o.stats, above = s.weekday.avgPrice > s.peak.avgPrice || s.weekend.avgPrice > s.peak.avgPrice;
    assert.equal(o.cons.includes(con), above && !o.keys.includes('current'), o.name);
  }
});

test('assumption wording: the pace label reads the right way round, and the sources say where the defaults come from', () => {
  const pace = R.ASSUMPTIONS.find((a) => a.key === 'paceStrength');
  assert.equal(pace.label, 'Bookings it takes to move the forecast');
  assert.match(pace.help, /A higher number takes more bookings to move the forecast\./);
  assert.ok(R.ASSUMPTIONS.filter((a) => /Kuala Lumpur/.test(a.source)).every((a) => /based on Kuala Lumpur data|one Kuala Lumpur operator|same operator/.test(a.source)));
});

/* ---------------------------------------------------------------- second review: model and Kozi fixes */
const bookedRun = (count, extra) => nights('2026-11-02', count, {}).map((n, i) => Object.assign({}, n, { status: 'booked', booked: 250 }, typeof extra === 'function' ? extra(i) : extra || {}));

test('cancellations: a booked stay may cancel and sell again, a stay the guest is in cannot, and a stay cancels as a whole', () => {
  const plan = (ns, c) => R.plan(input({ nights: ns, profitPerMonth: 0, assumptions: { cancelRate: c } })).options[0].stats;
  const sure = plan(bookedRun(10), 0), some = plan(bookedRun(10), 0.5);
  close(sure.occ, 1, 1e-12);
  assert.equal(sure.p10, sure.p90);
  /* half the stays cancel; a cancelled night sells again with its chance now, at today's price */
  assert.ok(some.occ > 0.5 && some.occ < 1, String(some.occ));
  assert.ok(some.profit < sure.profit);
  close(some.p50, some.profitPerMonth, 0.6 * (some.p90 - some.p10));
  /* checked in: firm */
  const firm = plan(bookedRun(10, { firm: true }), 0.5);
  close(firm.occ, 1, 1e-12);
  close(firm.profit, sure.profit, 1e-9);
  assert.equal(firm.p10, firm.p90);
  /* the stay is the booking when given, else a run of booked nights: ten nights of one stay cancel together, ten
     one-night stays one by one (the same average, a wider spread for the one stay) */
  const run = plan(bookedRun(10), 0.5), oneStay = plan(bookedRun(10, { stay: 'B1' }), 0.5), tenStays = plan(bookedRun(10, (i) => ({ stay: 'B' + i })), 0.5);
  assert.deepEqual(run, oneStay);
  close(tenStays.profit, oneStay.profit, 1e-9);
  assert.ok(oneStay.p90 - oneStay.p10 > 1.5 * (tenStays.p90 - tenStays.p10), (oneStay.p90 - oneStay.p10) + ' vs ' + (tenStays.p90 - tenStays.p10));
  /* the default: 11% of the booked nights of the fixture */
  const def = optionWith(PLAN800, 'current').stats, none = optionWith(R.plan(input({ profitPerMonth: 800, assumptions: { cancelRate: 0 } })), 'current').stats;
  assert.ok(def.soldNights < none.soldNights && def.soldNights > none.soldNights - 8 * 0.11);
});

test('last-minute deal: the forecast takes it off the nights it covers, and says so', () => {
  const deal = { pct: 10, days: 3, nights: [0, 1, 2, 3, 4], skip: ['2026-11-03'], until: '2026-12-31' };
  const r = R.plan(input({ profitPerMonth: 800, lastMinute: deal })), cur = optionWith(r, 'current');
  /* Sunday to Thursday, open, up to 31 December, not 3 November */
  const covered = cur.nightly.filter((n) => n.deal).map((n) => n.iso);
  const want = nights('2026-10-27', 90, BOOKED).filter((n) => n.status === 'open' && n.dow <= 4 && n.iso <= '2026-12-31' && n.iso !== '2026-11-03').map((n) => n.iso);
  assert.deepEqual(covered, want);
  assert.deepEqual(r.deal, { pct: 0.1, days: 3, nights: want.length });
  assert.ok(r.notes.includes('Your last-minute deal takes 10% off ' + want.length + ' of the 82 open nights when they are booked in the last 3 days before the night. The forecast counts it, and the prices here are the ones before the deal.'), r.notes.join(' | '));
  assert.ok(cur.stats.revenue < optionWith(PLAN800, 'current').stats.revenue);
  /* the prices stay the ones before the deal; the money is less by the deal on the share of sales inside its window */
  const flat = { dow: [0, 0, 0, 0, 0, 0, 0], month: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], baseOccSd: 0, betaSd: 0, monthSd: 0, paceStrength: 1e9 };
  const one = (lead, lm) => ({ today: TODAY, nights: [{ iso: isoOf(ms(TODAY) + lead * DAY), dow: new Date(ms(TODAY) + lead * DAY).getUTCDay(), lead, current: 200, status: 'open' }], costs: {}, profitPerMonth: 0, assumptions: flat, lastMinute: lm });
  const ratio = (lead) => R.evaluate(one(lead, { pct: 10, days: 3 }), {}).stats.revenue / R.evaluate(one(lead, null), {}).stats.revenue;
  close(ratio(1), 0.9, 1e-9);                       /* inside the window: every sale is at the deal */
  close(ratio(30), 1 - 0.1 * 0.37 / 0.92, 1e-9);    /* 30 days out: the share of its remaining sales in the last 3 days */
  /* a deal the channel manager would not apply does nothing */
  for (const bad of [{ pct: 0, days: 3 }, { pct: 60, days: 3 }, { pct: 10, days: 0 }, { pct: 10, days: 15 }, { pct: 10, days: 2.5 }, null, 'x']) {
    const b = R.plan(input({ profitPerMonth: 800, lastMinute: bad, draws: 200 }));
    assert.equal(b.deal, null, JSON.stringify(bad));
    assert.ok(!b.notes.some((t) => /last-minute deal/.test(t)));
  }
});

test('peak nights: the special dates and the holidays count when priced above the usual price, other nights from 25% above', () => {
  const ns = nights('2026-10-27', 90, BOOKED).map((n) => (['2026-11-18', '2026-11-19'].includes(n.iso) ? Object.assign({}, n, { current: 250 }) : n.iso === '2026-12-24' ? Object.assign({}, n, { current: 240 }) : n));
  const r = R.plan(input({ nights: ns, specialDates: ['2026-11-19'], profitPerMonth: 800, draws: 200 }));
  const pk = Object.fromEntries(r.calibration.peaks.map((p) => [p.iso, p]));
  assert.ok(pk['2026-11-19'] && pk['2026-11-19'].special, 'a special date 9% above the usual price');
  assert.ok(!pk['2026-11-18'], 'an ordinary night 9% above the usual price');
  assert.ok(pk['2026-12-24'] && pk['2026-12-24'].special, 'Christmas Eve, a holiday, above the usual price');
  assert.ok(pk['2026-12-31'].special && !pk['2026-12-21'].special);
  assert.equal(pk['2026-11-19'].usual, 230);
  /* a special date at the usual price is not a peak */
  assert.ok(!R.plan(input({ specialDates: ['2026-11-18'], profitPerMonth: 800, draws: 200 })).calibration.peaks.some((p) => p.iso === '2026-11-18'));
});

test('notes and cons on how sure the forecast is: little history, big moves, and the reaction to price', () => {
  /* little history: the forecast starts from today's prices */
  const little = 'This unit has little sales history yet, so the forecast assumes today\'s Sunday to Thursday price sells about 60% of nights. The plans adjust today\'s prices; they do not work out a market price from scratch.';
  assert.ok(PLAN800.notes.includes(little));
  const hist = R.plan(input({ profitPerMonth: 800, history: { sold: 36, available: 60, priceIndex: 1 } }));
  assert.ok(!hist.notes.some((t) => /little sales history/.test(t)));
  /* the unit's own nights narrow the spread of the usual occupancy, so the range of outcomes narrows too */
  const spread = (r) => { const st = optionWith(r, 'current').stats; return st.p90 - st.p10; };
  assert.equal(hist.calibration.baseOccUsed, 0.6);
  assert.ok(spread(hist) < 0.9 * spread(PLAN800), spread(hist) + ' vs ' + spread(PLAN800));
  /* a plan that moves a third or more of today's prices by 15% or more says the forecast is less sure there */
  for (const r of [PLAN, PLAN800]) {
    for (const o of r.options) {
      const st = o.stats, has = o.cons.some((t) => /by 15% or more, and the forecast is less sure about prices guests have not seen\.$/.test(t));
      assert.equal(has, !o.keys.includes('current') && st.bigMoves > 0 && st.bigMoves * 3 >= st.pricedToday, o.name);
    }
  }
  assert.ok(optionWith(PLAN, 'fill').cons.includes('Moves ' + optionWith(PLAN, 'fill').stats.bigMoves + ' of the 82 nights with a price today by 15% or more, and the forecast is less sure about prices guests have not seen.'));
  /* the reaction to price: with a weaker reaction the most profitable prices go the other way, and the note says what is at stake */
  assert.ok(PLAN800.notes.some((t) => /^How much guests react to price is the least certain part of the forecast\. If they react less than assumed, the most profitable prices would be higher than today's rather than lower\. The difference in profit between the two is about RM [\d,]+ a month\.$/.test(t)), PLAN800.notes.join(' | '));
  assert.ok(!R.plan(input({ profitPerMonth: 800, assumptions: { betaSd: 0 }, draws: 200 })).notes.some((t) => /react to price/.test(t)));
});

test('Fill and Premium missing: the note says why', () => {
  const loss = R.plan(input({ costs: Object.assign({}, COSTS, { rent: 9000 }), profitPerMonth: 1500, draws: 300 }));
  assert.ok(!optionWith(loss, 'fill') && !optionWith(loss, 'premium'));
  assert.ok(loss.notes.includes('There is no Fill the calendar or Premium rates plan: both look for prices that cover all costs, and on average none does in these dates.'));
  assert.ok(!PLAN.notes.some((t) => /^There is no /.test(t)));
});

/* ---------------------------------------------------------------- speed */
test('performance: 180 and 365 nights with 2,000 draws in under 2 seconds each', () => {
  const inp = input({ nights: nights('2026-10-27', 180, BOOKED), seed: 11, draws: 2000 });
  const t0 = performance.now();
  const r = R.plan(inp);
  const ms180 = performance.now() - t0;
  console.log('plan(): 180 nights, 2000 draws: ' + ms180.toFixed(0) + ' ms');
  assert.equal(r.nights, 180);
  assert.ok(r.options.length >= 3);
  assert.ok(ms180 < 2000, ms180 + ' ms');
  const t1 = performance.now();
  R.evaluate(inp, r.frontier[3].prices);
  console.log('evaluate(): 180 nights, 2000 draws, same input: ' + (performance.now() - t1).toFixed(0) + ' ms');
  /* a year ("Until a date") runs on the page's main thread too: about 150 ms here */
  const year = input({ nights: nights('2026-10-27', 365, BOOKED), seed: 12, draws: 2000 });
  const t2 = performance.now();
  const y = R.plan(year);
  const ms365 = performance.now() - t2;
  console.log('plan(): 365 nights, 2000 draws: ' + ms365.toFixed(0) + ' ms');
  assert.equal(y.nights, 365);
  assert.ok(ms365 < 2000, ms365 + ' ms');
});
