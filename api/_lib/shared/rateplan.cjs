/* Profit planner engine (Manage → Profit planner): the nightly rates one unit needs to make its owner's profit target,
 * what guests will actually pay how often, and a few complete rate plans with their risk, pros and cons.
 *
 * One file for both sides, like assign.cjs: scripts/build.mjs inlines it into the page as O.rateplan, node tests require
 * it. Plain ES5 on purpose: it runs as a classic script in the page. No clock (callers pass today and each night's lead
 * time) and no Math.random (R.rng is its own seeded generator), so the same input always gives the same answer.
 *
 * Spec: docs/notes/profit-planner.md, section Engine. In short:
 *   costs      monthly, yearly, one-off (paid back), per stay, per occupied night, share of revenue  -> R.monthlyCosts
 *   cost maths the stored price needed at each occupancy to break even or reach the target         -> R.requiredRates
 *   demand     logit P(night sells at p) = a + dow + month + peak + pace - beta ln(p / P0); a night still unsold
 *              t days before arrival sells with 1 - (1 - P)^H(t), H(t) the share of the guests looking for that night
 *              who are still to come (from the lead-time curve F, the share of nights booked t days or less ahead)
 *   optimiser  per open night, the price maximising Pbar(p) (contribution(p) + lambda), Pbar the mean over 48
 *              stratified parameter draws (computed once per candidate price); a grid of lambda is the frontier
 *   risk       Monte Carlo: parameter draws, then each open night sells or not. Every plan uses the same draws, so
 *              plans differ only by their prices.                                                   -> R.plan, R.evaluate
 *   words      pros and cons written from the numbers, one plain sentence each
 *
 * "Expected" numbers (occupancy, ADR, profit) are exact means over the 48 parameter draws, the same numbers the
 * optimiser maximises; the range (P10 to P90), the chance of the target and the chance of a loss come from the Monte Carlo.
 *
 * Money in sentences: input.money(n) when given (the page passes O.fmt.money with the unit's currency), else
 * O.fmt.money in the page, else 'RM 1,500'.
 */
'use strict';

var DAYS_PER_MONTH = 30.4;     /* nights in an average month */
var K = 48;                    /* parameter draws behind each night's selling chance */
var KC = 144;                  /* fresh parameter draws that check the edge plans (Fill, Premium) */
var SEARCH_DRAWS = 400;        /* Monte Carlo draws while searching the frontier */
var SHORT_NIGHTS = 30;         /* under this many nights, counts in the sentences are over the dates, not a month */
var ROUGH_NIGHTS = 14;         /* under this many nights, the monthly figures are flagged as rough */
var LATE_DAYS = 3;             /* a late booking comes this many days or less before arrival */
var LEAD_DAYS = [0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60];   /* where the lead-time curve (leadShare) is given */
var HOLIDAYS = ['12-24', '12-25', '12-31', '01-01'];   /* special nights every year: peak nights when priced above usual */
var BIG_MOVE = 0.15;           /* a price 15% or more away from today's is a big move */
var ORDER = ['current', 'fill', 'balanced', 'profit', 'premium'];   /* display order of the options */
var NAMES = { current: "Today's prices", fill: 'Fill the calendar', balanced: 'Balanced', profit: 'Most profit', premium: 'Premium rates' };
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

var DEFAULTS = {
  baseOcc: 0.60,          /* share of nights sold at P0 on an average night */
  baseOccSd: 0.12,        /* uncertainty of baseOcc, in occupancy, for a unit with no history (its own nights narrow it) */
  beta: 4,                /* price sensitivity: at 60% a 10% higher price loses about 15% of bookings */
  betaSd: 0.3,            /* beta draws are beta x exp(N(0, betaSd)) */
  monthSd: 0.15,          /* a month's own shock, in log-odds */
  dow: [-0.07, -0.07, -0.07, -0.07, -0.07, 1.05, 1.10],                                 /* Sun..Sat, log-odds */
  month: [0.10, -0.10, -0.05, -0.15, -0.10, 0.05, 0.10, 0.20, -0.15, -0.15, -0.10, 0.30], /* Jan..Dec, log-odds */
  peakThreshold: 0.25,    /* a night priced 25% or more above the usual price for its kind of night is a peak */
  paceStrength: 25,       /* nights of evidence the bookings so far must outweigh (about 9 stays) */
  paceCap: 0.7,           /* pace stays within +-0.7 log-odds */
  leadShare: [0.10, 0.25, 0.37, 0.46, 0.58, 0.64, 0.70, 0.78, 0.85, 0.92, 0.97, 1.00],  /* F at LEAD_DAYS, per night */
  avgStay: 2.7,
  cancelRate: 0.11,       /* share of the stays already booked that cancel before arrival */
  discountLeak: 0.06,     /* average discount off the stored price */
  paybackMonths: 24,      /* one-off costs are spread over this many months */
  minFactor: 0.6,         /* candidate prices from 0.6 to 1.8 times each night's price today */
  maxFactor: 1.8,
  rounding: 5,            /* every suggested price is a multiple of this */
  tierGap: 0.05,          /* a better unit type stays at least 5% dearer than a cheaper one, or as far apart as today */
  weakDemand: 0.45,       /* the weak-demand check lowers a by this (about 20% fewer bookings) */
  historyPrior: 60,       /* the unit's own history weighs available / (available + 60) */
  marketOcc: 0.75,        /* few listings in the market sell more than this */
  market: 'similar listings'
};

var ASSUMPTIONS = [
  { key: 'baseOcc', label: 'Nights sold at the usual price', unit: 'share', min: 0.2, max: 0.95, step: 0.01,
    help: 'The share of nights the unit sells at its usual weekday price on an average night. Your own last 60 days move it.',
    source: 'Orbique\'s starting value, based on Kuala Lumpur data: AirDNA 57% and Airbtics 56% for the year to September 2026; well-run 2-bedrooms there sell 60 to 75%.' },
  { key: 'baseOccSd', label: 'How sure that is, plus or minus', unit: 'share', min: 0, max: 0.2, step: 0.01,
    help: 'A wider margin gives a wider range of outcomes and a less certain chance of reaching the target.',
    source: 'Judgement: 12 points either way for a unit with little history of its own; your own nights narrow it.' },
  { key: 'beta', label: 'How much guests react to price', unit: 'number', min: 1, max: 8, step: 0.1,
    help: 'At 4, a 10% higher price loses about 15% of bookings. A higher number means guests compare prices more.',
    source: 'Studies of single listings among close alternatives: a 10% higher price loses 10 to 30% of bookings. In this forecast, at 4 and leaving costs aside, the price that brings in the most sells about 75% of nights.' },
  { key: 'betaSd', label: 'How sure that is', unit: 'number', min: 0, max: 0.8, step: 0.05,
    help: 'At 0.3, the reaction to price could be about a third weaker or stronger.',
    source: 'Judgement.' },
  { key: 'monthSd', label: 'Month-to-month swings', unit: 'number', min: 0, max: 0.5, step: 0.05,
    help: 'How much a single month can be busier or quieter than usual for no visible reason. 0.15 is about 4 nights in 100.',
    source: 'Judgement.' },
  { key: 'dow', label: 'Busier or quieter by weekday', unit: 'list', items: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], min: -1, max: 1, step: 0.05,
    help: 'Plus sells more often than an average night, minus less often. 0.1 is about 2 more or fewer nights sold in 100.',
    source: '310 bookings from one Kuala Lumpur operator (Booking.com and Trip.com, July 2025 to October 2026). Sunday to Thursday sold about the same once the small counts are allowed for, so they share one value. Friday and Saturday sold as many nights as Thursday at prices about 27% higher, so their values include that price difference at a reaction to price of 4.' },
  { key: 'month', label: 'Busier or quieter by month', unit: 'list', items: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], min: -1, max: 1, step: 0.05,
    help: 'Plus sells more often than an average month, minus less often. Bookings already made adjust the coming months as well.',
    source: 'AirROI and AirDNA month patterns for Kuala Lumpur plus the same operator\'s bookings: December, August, January and July strongest; April, September, October and Ramadan softest.' },
  { key: 'peakThreshold', label: 'Peak night when priced above usual by', unit: 'share', min: 0.1, max: 1, step: 0.05,
    help: 'Nights priced this much above the usual price for that kind of night (concerts, Christmas, New Year, Chinese New Year) are peak nights. Their higher price is taken as extra demand. The dates your last-minute deal skips, and 24, 25 and 31 December and 1 January, are peak nights whenever they are priced above the usual price.',
    source: 'Judgement.' },
  { key: 'paceStrength', label: 'Bookings it takes to move the forecast', unit: 'nights', min: 0, max: 60, step: 1,
    help: 'Months with more bookings than expected by now get more demand, months with fewer get less. A higher number takes more bookings to move the forecast.',
    source: 'Judgement: about 25 nights, roughly 9 stays.' },
  { key: 'leadShare', label: 'How far ahead guests book', unit: 'list', items: ['Same day', '1 day', '2 days', '3 days', '5 days', '7 days', '10 days', '14 days', '21 days', '30 days', '45 days', '60 days'], min: 0, max: 1, step: 0.01,
    help: 'The share of nights booked this many days or less before the night. A night still empty close to the date has less time left to sell.',
    source: '310 bookings from one Kuala Lumpur operator, July 2025 to October 2026, each spread over its nights: a quarter of the nights are booked 1 day or less before the night, and almost half 3 days or less.' },
  { key: 'avgStay', label: 'Average stay', unit: 'nights', min: 1, max: 14, step: 0.1,
    help: 'Spreads cleaning and the other per-stay costs over the nights of a stay.',
    source: 'The same operator\'s 310 bookings; 37% are one-night stays.' },
  { key: 'cancelRate', label: 'Booked stays that cancel', unit: 'share', min: 0, max: 0.6, step: 0.01,
    help: 'The share of the stays already booked that cancel before arrival. Their nights may then sell again.',
    source: 'The same operator\'s 310 bookings: about 16% of the nights on Booking.com\'s books later cancelled, and Trip.com bookings cancelled about half as often. 11% is the blend.' },
  { key: 'discountLeak', label: 'Average discount off the price', unit: 'share', min: 0, max: 0.3, step: 0.01,
    help: 'Non-refundable, weekly and last-minute discounts, averaged over all bookings. When the workspace has a last-minute deal, the forecast also counts that deal night by night, so this can then be about 2 to 3 points lower.',
    source: 'Non-refundable 10%, weekly 15% and last-minute 10%, used by some of the bookings.' },
  { key: 'paybackMonths', label: 'Pay back furnishing over', unit: 'months', min: 1, max: 120, step: 1,
    help: 'One-off costs such as furnishing are spread over this many months.',
    source: 'Judgement: 2 years.' },
  { key: 'minFactor', label: 'Lowest price to try', unit: 'share', min: 0.3, max: 1, step: 0.05,
    help: 'As a share of each night\'s price today.',
    source: 'Judgement.' },
  { key: 'maxFactor', label: 'Highest price to try', unit: 'share', min: 1, max: 3, step: 0.05,
    help: 'As a share of each night\'s price today.',
    source: 'Judgement.' },
  { key: 'rounding', label: 'Round prices to', unit: 'money', min: 1, max: 50, step: 1,
    help: 'Every suggested price is a multiple of this.',
    source: 'Judgement.' },
  { key: 'tierGap', label: 'Gap kept between unit types', unit: 'share', min: 0, max: 0.3, step: 0.01,
    help: 'On every night, a better unit type in the building stays at least this much dearer than a cheaper one. Where the two are closer than that today, today\'s gap is kept instead. At 0, the plans keep the order only.',
    source: 'Judgement: 5%, so that each step up in the building is still worth something to a guest.' },
  { key: 'marketOcc', label: 'The busiest listings in the area sell', unit: 'share', min: 0.5, max: 1, step: 0.01,
    help: 'Plans that need more nights sold than this are flagged.',
    source: 'Orbique\'s starting value, based on Kuala Lumpur data: the top tenth of listings there sit at about 75%.' }
];

var COST_FIELDS = [
  { key: 'rent', label: 'Rent or loan instalment', group: 'Every month', per: 'month', help: 'What you pay each month for the unit itself.' },
  { key: 'maintenance', label: 'Maintenance fee and sinking fund', group: 'Every month', per: 'month', help: 'Paid to the building management.' },
  { key: 'internet', label: 'Internet and TV', group: 'Every month', per: 'month', help: 'The monthly plans.' },
  { key: 'software', label: 'Software and channel manager', group: 'Every month', per: 'month', help: 'Orbique, the channel manager and other subscriptions, for this unit.' },
  { key: 'staff', label: 'Staff and management share', group: 'Every month', per: 'month', help: 'This unit\'s share of salaries or of a management fee.' },
  { key: 'otherMonthly', label: 'Other monthly costs', group: 'Every month', per: 'month', help: 'Anything else paid every month.' },
  { key: 'insurance', label: 'Insurance', group: 'Every year', per: 'year', help: 'The yearly premium.' },
  { key: 'propertyTax', label: 'Quit rent and assessment', group: 'Every year', per: 'year', help: 'Both together, for the year.' },
  { key: 'otherYearly', label: 'Other yearly costs', group: 'Every year', per: 'year', help: 'Licences, deep cleaning, air-conditioner servicing.' },
  { key: 'furnishing', label: 'Furnishing and renovation', group: 'One-off', per: 'once', help: 'Paid back over the payback months (24 unless changed).' },
  { key: 'cleaning', label: 'Cleaning and laundry', group: 'Every stay', per: 'stay', help: 'For each checkout.' },
  { key: 'amenities', label: 'Guest amenities and welcome pack', group: 'Every stay', per: 'stay', help: 'Toiletries, water and snacks, for each stay.' },
  { key: 'utilities', label: 'Electricity and water', group: 'Every occupied night', per: 'night', help: 'The extra cost of a night with guests.' },
  { key: 'consumables', label: 'Consumables', group: 'Every occupied night', per: 'night', help: 'Coffee, tissue and refills, for each night.' },
  { key: 'ownerSharePct', label: 'Owner\'s share', group: 'Share of revenue', per: 'pct', help: 'Percent of revenue paid to the owner, when you run the unit for someone.' },
  { key: 'paymentFeePct', label: 'Payment and bank fees', group: 'Share of revenue', per: 'pct', help: 'Percent of revenue not already covered by the booking sites\' markups.' },
  { key: 'taxPct', label: 'Taxes on revenue', group: 'Share of revenue', per: 'pct', help: 'Percent of revenue, such as service tax.' }
];

/* ---------------------------------------------------------------- small helpers */
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function num(x) { var n = typeof x === 'string' ? parseFloat(x.replace(/,/g, '')) : Number(x); return isFinite(n) ? n : 0; }
function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function logit(q) { return Math.log(q / (1 - q)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function median(xs) {
  if (!xs.length) return null;
  var s = xs.slice().sort(function (a, b) { return a - b; }), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
function ms(iso) { var p = String(iso).slice(0, 10).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
/* a real calendar date written YYYY-MM-DD (not 2026-13-45 or 2027-02-30) */
function validIso(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  var t = ms(iso);
  return isFinite(t) && new Date(t).toISOString().slice(0, 10) === iso;
}
function dowOf(iso) { return new Date(ms(iso)).getUTCDay(); }
function daysBetween(a, b) { return Math.round((ms(b) - ms(a)) / 864e5); }
function group3(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function round10(x) { return Math.round(x / 10) * 10; }
function pct(x) { return Math.round(x * 100) + '%'; }
/* the gap kept between unit types, exactly (settings keep it to a tenth of a percent) */
function gapPct(x) { var v = Math.round(x * 1000) / 10; return (v % 1 ? v.toFixed(1) : String(v)) + '%'; }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
/* a chance in words for the middle of a sentence: 'about a 6 in 10 chance', 'about an even chance' */
function chanceNoun(p) {
  if (p >= 0.95) return 'a very high chance';
  if (p < 0.05) return 'a very small chance (less than 1 in 20)';
  if (p >= 0.45 && p < 0.55) return 'about an even chance';
  var n = clamp(Math.round(p * 10), 1, 9);
  return 'about ' + (n === 8 ? 'an ' : 'a ') + n + ' in 10 chance';
}
/* a share in tenths for 'about 6 in 10 of ...', 'almost all of ...' */
function tenthsOf(x) { return x >= 0.95 ? 'almost all' : 'about ' + clamp(Math.round(x * 10), 1, 9) + ' in 10'; }
function joinWords(xs) { return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }
function sig(prices) { return Array.prototype.join.call(prices, ','); }

function moneyFn(input) {
  if (input && typeof input.money === 'function') return input.money;
  var O = typeof window !== 'undefined' && window.O;
  if (O && O.fmt && typeof O.fmt.money === 'function') return function (n) { return O.fmt.money(n); };
  return function (n) {
    if (n == null || isNaN(n)) return '–';
    var a = Math.round(Math.abs(n));
    return (n < 0 && a ? '−' : '') + 'RM ' + group3(a);
  };
}

/* mulberry32: a small, fast seeded generator. rng(seed)() -> [0, 1); rng(seed).normal() -> N(0, 1) (Box-Muller) */
function rng(seed) {
  var t = (Number(seed) >>> 0), spare = null;
  function next() {
    t = (t + 0x6D2B79F5) | 0;
    var r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  }
  next.normal = function () {
    if (spare !== null) { var z = spare; spare = null; return z; }
    var u = next(), w = next();
    while (u <= 0) u = next();
    var rad = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * w;
    spare = rad * Math.sin(th);
    return rad * Math.cos(th);
  };
  return next;
}

/* inverse of the standard normal distribution (Acklam's approximation, error below 1e-9) */
function normInv(p) {
  var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
  var b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  var c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  var d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  var q, r;
  if (p < 0.02425 || p > 0.97575) {
    q = Math.sqrt(-2 * Math.log(p < 0.5 ? p : 1 - p));
    r = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    return p < 0.5 ? r : -r;
  }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
function shuffled(n, next) {
  var p = [], i, j, t;
  for (i = 0; i < n; i++) p.push(i);
  for (i = n - 1; i > 0; i--) { j = Math.floor(next() * (i + 1)); t = p[i]; p[i] = p[j]; p[j] = t; }
  return p;
}

/* the assumptions in use: DEFAULTS with the owner's changes over them (unknown keys and bad values are ignored) */
function settings(over) {
  var s = {}, k, v;
  for (k in DEFAULTS) if (has(DEFAULTS, k)) s[k] = Array.isArray(DEFAULTS[k]) ? DEFAULTS[k].slice() : DEFAULTS[k];
  over = over || {};
  for (k in over) {
    if (!has(over, k) || !has(DEFAULTS, k) || over[k] == null || over[k] === '') continue;
    if (Array.isArray(DEFAULTS[k])) {
      if (Array.isArray(over[k]) && over[k].length === DEFAULTS[k].length && over[k].every(function (x) { return isFinite(Number(x)); })) s[k] = over[k].map(Number);
    } else if (typeof DEFAULTS[k] === 'number') {
      v = Number(over[k]); if (isFinite(v)) s[k] = v;
    } else s[k] = String(over[k]);
  }
  s.baseOcc = clamp(s.baseOcc, 0.01, 0.99);
  s.baseOccSd = clamp(s.baseOccSd, 0, 0.3);
  s.beta = clamp(s.beta, 0.1, 20);
  s.betaSd = clamp(s.betaSd, 0, 1.5);
  s.monthSd = clamp(s.monthSd, 0, 1.5);
  s.peakThreshold = Math.max(0.01, s.peakThreshold);
  s.paceStrength = Math.max(0, s.paceStrength);
  s.paceCap = Math.max(0, s.paceCap);
  s.avgStay = Math.max(1, s.avgStay);
  s.cancelRate = clamp(s.cancelRate, 0, 0.9);
  s.discountLeak = clamp(s.discountLeak, 0, 0.9);
  s.paybackMonths = s.paybackMonths > 0 ? s.paybackMonths : DEFAULTS.paybackMonths;
  s.minFactor = clamp(s.minFactor, 0.05, 1);
  s.maxFactor = Math.max(1, s.maxFactor);
  s.rounding = s.rounding > 0 ? s.rounding : 1;
  s.tierGap = Math.round(clamp(s.tierGap, 0, 1) * 1000) / 1000;
  s.historyPrior = Math.max(0, s.historyPrior);
  s.marketOcc = clamp(s.marketOcc, 0.05, 1);
  /* the lead-time curve: never falling, ending at 1 */
  var last = s.leadShare[s.leadShare.length - 1] > 0 ? s.leadShare[s.leadShare.length - 1] : 1, top = 0;
  s.leadShare = s.leadShare.map(function (x) { top = Math.max(top, clamp(x / last, 0, 1)); return top; });
  return s;
}

/* F(t): the share of nights booked t days or less before the night (linear between the given points, 1 from 60 days) */
function leadF(t, share) {
  if (t <= 0) return share[0];
  for (var i = 1; i < LEAD_DAYS.length; i++) {
    if (t <= LEAD_DAYS[i]) return share[i - 1] + (share[i] - share[i - 1]) * (t - LEAD_DAYS[i - 1]) / (LEAD_DAYS[i] - LEAD_DAYS[i - 1]);
  }
  return 1;
}
/* H(t): the share of the guests looking for a night who are still to come t days before it. Guests arrive at random
   and the first one takes the night, so a night that sells with P overall sells in its last t days with
   1 - (1 - P)^H. F counts the bookings that happened, and an early guest takes a night before later ones can, so at
   the usual occupancy q: F = ((1 - q)^(1 - H) - (1 - q)) / q, that is H = 1 - ln(1 - q (1 - F)) / ln(1 - q). */
function leadH(F, q) {
  if (F >= 1) return 1;
  if (F <= 0) return 0;
  q = clamp(q, 0.01, 0.99);
  return clamp(1 - Math.log(1 - q * (1 - F)) / Math.log(1 - q), 0, 1);
}
/* the chance a night still unsold sells, from its chance P over the whole booking window, given as log-odds x:
   1 - (1 - P)^H = 1 - exp(-H ln(1 + e^x)) */
function openChance(x, H) {
  if (H >= 1) return 1 / (1 + Math.exp(-x));
  if (!(H > 0)) return 0;
  var sp = x > 30 ? x : x < -30 ? Math.exp(x) : Math.log(1 + Math.exp(x));
  return 1 - Math.exp(-H * sp);
}
/* the workspace's last-minute deal (blob lastMinuteDeal, applied by the channel manager as lastMinuteFactor in
   api/_lib/channex-sync.js): {pct, days, nights: [weekdays], skip: [iso], until: iso}, or null when it does nothing */
function dealOf(x) {
  if (!x || typeof x !== 'object') return null;
  var p = num(x.pct), days = Math.floor(num(x.days));
  if (!(p > 0) || p >= 60 || days < 1 || days > 14 || num(x.days) !== days) return null;
  var skip = {};
  (Array.isArray(x.skip) ? x.skip : []).forEach(function (iso) { skip[String(iso).slice(0, 10)] = 1; });
  return { pct: p / 100, days: days, nights: Array.isArray(x.nights) ? x.nights.map(Number) : null, skip: skip,
    until: validIso(String(x.until || '').slice(0, 10)) ? String(x.until).slice(0, 10) : null };
}
function dealCovers(deal, n) {
  if (!deal) return false;
  if (deal.until && n.iso > deal.until) return false;
  if (deal.skip[n.iso]) return false;
  return !deal.nights || deal.nights.indexOf(n.dow) >= 0;
}

/* ---------------------------------------------------------------- cost maths */
/* costs (the COST_FIELDS values; percentages as 10 for 10%) -> per month and per unit of work.
   fixedMonthly includes capexMonthly (one-off costs over paybackMonths); pct is a fraction (0.1).
   lines: every cost entered, with its monthly equivalent (null for per-stay, per-night and percentage costs). */
function monthlyCosts(costs, assumptions) {
  costs = costs || {};
  var payback = num(costs.paybackMonths) > 0 ? num(costs.paybackMonths)
    : assumptions && num(assumptions.paybackMonths) > 0 ? num(assumptions.paybackMonths) : DEFAULTS.paybackMonths;
  var out = { fixedMonthly: 0, capexMonthly: 0, perStay: 0, perNight: 0, pct: 0, paybackMonths: payback, lines: [] };
  COST_FIELDS.forEach(function (f) {
    var v = Math.max(0, num(costs[f.key])), monthly = null;
    if (!v) return;
    if (f.per === 'month') monthly = v;
    else if (f.per === 'year') monthly = v / 12;
    else if (f.per === 'once') { monthly = v / payback; out.capexMonthly += monthly; }
    else if (f.per === 'stay') out.perStay += v;
    else if (f.per === 'night') out.perNight += v;
    else if (f.per === 'pct') out.pct += v / 100;
    if (monthly != null) out.fixedMonthly += monthly;
    out.lines.push({ key: f.key, label: f.label, per: f.per, amount: v, monthly: monthly });
  });
  return out;
}

/* the stored (net, before discounts) nightly price needed at occupancy 20%, 25%, ... 100% of all nights:
   target(o) = ((fixed + profit) / (30.4 o) + perNight + perStay / avgStay) / ((1 - leak) (1 - pct)); breakEven with profit 0.
   null where no price works (revenue shares of 100% or more). opts {avgStay, discountLeak, paybackMonths} */
function requiredRates(costs, profitPerMonth, opts) {
  opts = opts || {};
  var mc = monthlyCosts(costs, opts);
  var avgStay = num(opts.avgStay) >= 1 ? num(opts.avgStay) : DEFAULTS.avgStay;
  var leak = opts.discountLeak != null && opts.discountLeak !== '' && isFinite(Number(opts.discountLeak)) ? clamp(Number(opts.discountLeak), 0, 0.9) : DEFAULTS.discountLeak;
  var k = (1 - leak) * (1 - mc.pct), v = mc.perNight + mc.perStay / avgStay, profit = num(profitPerMonth), out = [];
  function rate(extra, occ) { return k > 0 ? Math.max(0, ((mc.fixedMonthly + extra) / (DAYS_PER_MONTH * occ) + v) / k) : null; }
  for (var i = 4; i <= 20; i++) {
    var occ = i * 5 / 100;
    out.push({ occ: occ, breakEven: rate(0, occ), target: rate(profit, occ) });
  }
  return out;
}

/* ---------------------------------------------------------------- the model */
/* everything that depends on the input but not on the prices: nights, costs, demand terms, the parameter draws,
   each open night's candidate prices with their selling chances, and the Monte Carlo draws */
function prepare(input) {
  input = input || {};
  var s = settings(input.assumptions), costs = monthlyCosts(input.costs, s), i, j, k;
  /* a negative target would read as "covering all costs" in every sentence: 0 is the lowest target */
  var m = { s: s, costs: costs, target: Math.max(0, num(input.profitPerMonth)), today: String(input.today || '').slice(0, 10) };
  if (!validIso(m.today)) m.today = '';
  m.leak = s.discountLeak; m.pct = costs.pct; m.kNet = (1 - m.leak) * (1 - m.pct);
  m.v = costs.perNight + costs.perStay / s.avgStay;   /* variable cost of one sold night */
  m.step = s.rounding;
  m.floor = num(input.floor) > 0 ? num(input.floor) : 0;
  m.ceiling = num(input.ceiling) > 0 ? Math.max(num(input.ceiling), m.floor) : Infinity;
  m.keepPeaks = input.keepPeaks !== false;
  m.seed = input.seed != null && input.seed !== '' && isFinite(Number(input.seed)) ? Number(input.seed) : 1;
  m.draws = Math.round(clamp(num(input.draws) || 2000, 100, 20000));
  /* the last-minute deal only acts on nights counted from a real today */
  m.deal = m.today ? dealOf(input.lastMinute) : null;

  /* the nights, in date order (a booked night with no amount, null or missing, is counted at its price today later on;
     an explicit 0 stays RM0). firm: a booked night that can no longer cancel (the guest is in); stay: the booking it
     belongs to, so its nights cancel together */
  var all = [];
  (input.nights || []).forEach(function (x) {
    var iso = x && String(x.iso || '').slice(0, 10);
    if (!iso || !validIso(iso)) return;
    var st = x.status === 'booked' || x.status === 'blocked' ? x.status : 'open';
    var lead = x.lead != null && x.lead !== '' && isFinite(Number(x.lead)) ? Number(x.lead) : m.today ? daysBetween(m.today, iso) : 0;
    var dw = x.dow != null && x.dow !== '' && isFinite(Number(x.dow)) ? ((Math.round(Number(x.dow)) % 7) + 7) % 7 : dowOf(iso);
    var unknown = st === 'booked' && (x.booked == null || x.booked === '' || !isFinite(Number(String(x.booked).replace(/,/g, ''))));
    all.push({ iso: iso, dow: dw, lead: Math.max(0, Math.round(lead)), current: num(x.current) > 0 ? num(x.current) : null,
      status: st, booked: st === 'booked' && !unknown ? Math.max(0, num(x.booked)) : 0, bookedUnknown: unknown, month: iso.slice(0, 7), g: dw === 5 || dw === 6 ? 1 : 0,
      firm: st === 'booked' && x.firm === true, stay: st === 'booked' && x.stay != null && x.stay !== '' ? String(x.stay) : null });
  });
  all.sort(function (a, b) { return a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0; });
  m.all = all; m.N = all.length; m.months = m.N / DAYS_PER_MONTH;
  m.monthKeys = []; var mIdx = {};
  all.forEach(function (n) { if (!has(mIdx, n.month)) { mIdx[n.month] = m.monthKeys.length; m.monthKeys.push(n.month); } n.mi = mIdx[n.month]; });
  var M = m.monthKeys.length, years = {};
  m.monthKeys.forEach(function (key) { years[key.slice(5)] = (years[key.slice(5)] || 0) + 1; });
  m.monthLabels = m.monthKeys.map(function (key) { return MONTHS[+key.slice(5) - 1] + (years[key.slice(5)] > 1 ? ' ' + key.slice(0, 4) : ''); });

  /* peak nights. Special nights are the owner's own (input.specialDates: the last-minute deal's skip dates) and the
     holidays every year (24, 25 and 31 December, 1 January). The usual price for a kind of night (Sun-Thu or Fri-Sat)
     is the lower of the median of today's prices on the ordinary nights of the same month (with at least 3 of them) and
     on the ordinary nights of that kind over all the dates, so a month full of events does not make its events look
     usual. A night is a peak when it is priced peakThreshold or more above the usual price, or is special and priced
     above it. */
  var special = {};
  (Array.isArray(input.specialDates) ? input.specialDates : []).forEach(function (iso) { iso = String(iso).slice(0, 10); if (validIso(iso)) special[iso] = 1; });
  all.forEach(function (n) { n.special = !!special[n.iso] || HOLIDAYS.indexOf(n.iso.slice(5)) >= 0; });
  var byMG = {}, byG = [[], []], anyG = [[], []];
  all.forEach(function (n) {
    if (!n.current) return;
    anyG[n.g].push(n.current);
    if (n.special) return;
    var key = n.month + '|' + n.g; (byMG[key] = byMG[key] || []).push(n.current); byG[n.g].push(n.current);
  });
  var gMed = [median(byG[0]) || median(anyG[0]), median(byG[1]) || median(anyG[1])];
  all.forEach(function (n) {
    n.usual = null; n.peak = false; n.peakLn = 0;
    if (!n.current) return;
    var arr = byMG[n.month + '|' + n.g], usual = arr && arr.length >= 3 ? Math.min(median(arr), gMed[n.g]) : gMed[n.g];
    n.usual = usual;
    if (usual > 0 && (n.current >= usual * (1 + s.peakThreshold) || (n.special && n.current > usual))) { n.peak = true; n.peakLn = Math.log(n.current / usual); }
  });

  /* P0, the reference price: median of today's Sun-Thu non-peak prices */
  var P0 = median(all.filter(function (n) { return n.current && !n.peak && n.g === 0; }).map(function (n) { return n.current; })), P0From = 'weekdays';
  if (!P0) { P0 = median(all.filter(function (n) { return n.current && !n.peak; }).map(function (n) { return n.current; })); P0From = 'all nights'; }
  if (!P0 && num(input.basePrice) > 0) { P0 = num(input.basePrice); P0From = 'base price'; }
  if (!P0) {
    /* what the booked nights brought in, back to a price before discounts */
    var paidMid = median(all.filter(function (n) { return n.status === 'booked' && !n.bookedUnknown && n.booked > 0; }).map(function (n) { return n.booked; }));
    if (paidMid) { P0 = Math.max(m.step, Math.round(paidMid / (1 - m.leak) / m.step) * m.step); P0From = 'booked'; }
  }
  if (!P0 && m.kNet > 0) {
    var need = ((costs.fixedMonthly + Math.max(0, m.target)) / (DAYS_PER_MONTH * s.baseOcc) + m.v) / m.kNet;
    if (need > 0) { P0 = Math.max(m.step, Math.round(need / m.step) * m.step); P0From = 'costs'; }
  }
  if (!P0) { P0 = 100; P0From = 'default'; }
  m.P0 = P0; m.lnP0 = Math.log(P0);
  m.bookedUnknown = 0;
  all.forEach(function (n) { if (n.bookedUnknown) { n.booked = (n.current || P0) * (1 - m.leak); m.bookedUnknown++; } });

  /* calibration from the unit's own history: a moves toward the observed level, adjusted for the price paid */
  var a0 = logit(s.baseOcc), a = a0, hist = null, h = input.history;
  if (h && num(h.available) > 0) {
    var avail = num(h.available), sold = clamp(num(h.sold), 0, avail);
    var qObs = clamp(sold / avail, Math.max(0.02, 0.5 / avail), Math.min(0.98, 1 - 0.5 / avail));
    /* the price paid against the usual price: avgPaid (net after discounts, per sold night) against P0 less the usual
       discount, so both sides are the same kind of amount; else the caller's own priceIndex */
    var pIdx = num(h.avgPaid) > 0 && P0 > 0 && m.leak < 1 ? num(h.avgPaid) / (P0 * (1 - m.leak)) : num(h.priceIndex) > 0 ? num(h.priceIndex) : 1;
    var w = avail / (avail + s.historyPrior);
    a = (1 - w) * a0 + w * (logit(qObs) + s.beta * Math.log(pIdx));
    hist = { sold: sold, available: avail, priceIndex: pIdx, observed: sold / avail, weight: w, baseOcc: sigmoid(a) };
  }
  m.a = a; m.baseOcc = sigmoid(a);
  /* the occupancy spread in log-odds: the narrower side of baseOcc +- baseOccSd (each end kept inside 1% to 99%). Log-odds
     stretch towards 0% and 100%, so the wider side would spread the draws far out near either limit and move the expected
     forecast; the narrower side keeps a wide margin to a wider range (the other side alone when one end is past a limit).
     The unit's own history narrows it as it moves a: with weight w, by the square root of 1 - w */
  var lq = logit(m.baseOcc), wUp = logit(Math.min(0.99, m.baseOcc + s.baseOccSd)) - lq, wDn = lq - logit(Math.max(0.01, m.baseOcc - s.baseOccSd));
  m.sdA = wUp > 0 && wDn > 0 ? Math.min(wUp, wDn) : Math.max(0, wUp, wDn);
  if (hist) m.sdA *= Math.sqrt(1 - hist.weight);

  /* each night's demand terms (without a and price), the lead-time curve F, the share of guests still to come H (at the
     usual occupancy the curve comes from), and the share of a night's remaining sales that come in the deal's window */
  all.forEach(function (n) {
    n.eff = s.dow[n.dow] + s.month[+n.month.slice(5) - 1];
    n.F = leadF(n.lead, s.leadShare);
    n.H = leadH(n.F, s.baseOcc);
    n.deal = dealCovers(m.deal, n);
    n.R = 1;
    if (n.deal) { var inWin = n.lead <= m.deal.days - 1 ? 1 : n.F > 0 ? leadF(m.deal.days - 1, s.leadShare) / n.F : 0; n.R = 1 - m.deal.pct * clamp(inWin, 0, 1); }
  });

  /* pace: bookings already made against those expected by now at today's prices, per month. Peak nights are left out
     (their premium already stands for their demand, and they book further ahead than the all-year curve). A booked night
     counts as 1 - cancelRate, as the curve counts the stays that went ahead; the expected count shown is on the same
     footing as the booked count (stays that will cancel included) */
  var keepB = 1 - s.cancelRate, pace = [], paceRows = [];
  for (i = 0; i < M; i++) { pace.push(0); paceRows.push({ month: m.monthKeys[i], label: m.monthLabels[i], booked: 0, expected: 0, effect: 0, text: '' }); }
  all.forEach(function (n) {
    if (n.status === 'blocked' || n.peak) return;
    var p = n.current || P0, P = sigmoid(a + n.eff - s.beta * Math.log(p / P0));
    paceRows[n.mi].expected += P * (1 - n.F);
    if (n.status === 'booked') paceRows[n.mi].booked++;
  });
  paceRows.forEach(function (r, mi) {
    var B = r.booked * keepB, den = s.paceStrength + r.expected, theta = den > 0 ? (s.paceStrength + B) / den : B > 0 ? Infinity : 1;
    r.effect = theta > 0 ? clamp(Math.log(theta), -s.paceCap, s.paceCap) : -s.paceCap;
    pace[mi] = r.effect;
    r.expected = keepB > 0 ? r.expected / keepB : r.expected;
    /* the expected count as the sentence shows it: one decimal under 10 */
    var e = r.expected < 10 ? Math.round(r.expected * 10) / 10 : Math.round(r.expected);
    if (!r.booked && e < 0.5 && Math.abs(r.effect) < 0.05) return;
    var verb = Math.abs(r.effect) < 0.05 || e === r.booked ? ' demand left as it is.' : r.effect < 0 ? ' demand lowered.' : ' demand raised.';
    r.text = (r.booked ? plural(r.booked, 'night') + ' booked in ' + r.label : 'No nights booked in ' + r.label + ' yet') + '; ' +
      (e >= 0.05 ? 'about ' + e + ' expected by now' : 'hardly any expected by now') + ': ' + r.label + verb;
  });
  m.pace = pace;

  /* the building's other unit types: the tier-order check, and the limits that keep this unit between them (better:
     priced above this unit, unless told). A type whose usual price is less than a rounding step from this unit's (at
     most 2%, at least 1%) is a peer: no order is kept against it */
  m.tiers = []; m.peers = [];
  (input.otherTiers || []).forEach(function (t) {
    if (!t || !t.prices) return;
    var mine = [], theirs = [], name = String(t.name || 'another unit type');
    all.forEach(function (n) { var tp = num(t.prices[n.iso]); if (tp > 0) { theirs.push(tp); if (n.current) mine.push(n.current); } });
    if (!theirs.length) return;
    var mm = median(mine) || P0, mt = median(theirs);
    if (t.better == null && Math.abs(mt - mm) < Math.max(0.01 * mm, Math.min(s.rounding, 0.02 * mm)) - 1e-9) { m.peers.push(name); return; }
    m.tiers.push({ name: name, prices: t.prices, better: t.better != null ? !!t.better : mt > mm });
  });

  /* the open nights the planner prices. Booked nights are certain unless their stay cancels (cancelRate); a cancelled
     night may sell again at today's price with its open chance now */
  var open = all.filter(function (n) { return n.status === 'open'; }), nOpen = open.length;
  m.open = open; m.n = nOpen;
  m.bookedN = 0; m.bookedSold = 0; m.bookedRev = 0; m.bookedContrib = 0; m.blockedN = 0;
  all.forEach(function (n) {
    if (n.status === 'blocked') { m.blockedN++; return; }
    if (n.status !== 'booked') return;
    var keep = n.firm ? 1 : keepB, p = n.current || P0;
    var q = openChance(a + n.eff + pace[n.mi] + s.beta * n.peakLn - s.beta * Math.log(p / P0), n.H);
    n.keep = keep; n.resell = q; n.resellCt = p * n.R * m.kNet - m.v;
    n.bSold = keep + (1 - keep) * q;
    n.bRev = keep * n.booked + (1 - keep) * q * p * n.R * (1 - m.leak);
    n.bCt = keep * (n.booked * (1 - m.pct) - m.v) + (1 - keep) * q * n.resellCt;
    m.bookedN++; m.bookedSold += n.bSold; m.bookedRev += n.bRev; m.bookedContrib += n.bCt;
  });
  m.fixedDates = costs.fixedMonthly * m.N / DAYS_PER_MONTH;
  m.missing = open.filter(function (n) { return !n.current; }).length;
  m.F = new Float64Array(nOpen); m.H = new Float64Array(nOpen); m.R = new Float64Array(nOpen); m.G = new Float64Array(nOpen); m.lateW = new Float64Array(nOpen);
  var baseTerm = new Float64Array(nOpen), mOf = new Int32Array(nOpen);
  open.forEach(function (n, x) {
    m.F[x] = n.F; m.H[x] = n.H; m.R[x] = n.R;
    m.G[x] = n.peakLn + m.lnP0;                     /* logit = a + base + beta (G - ln p) */
    m.lateW[x] = n.F > 0 ? leadF(Math.min(n.lead, LATE_DAYS), s.leadShare) / n.F : 0;
    baseTerm[x] = n.eff + pace[n.mi];
    mOf[x] = n.mi;
  });
  m.dealN = open.filter(function (n) { return n.deal; }).length;

  /* the 48 parameter draws behind each selling chance: stratified (one draw per 1/48 slice of each distribution,
     paired at random), so their mean is close to the exact expectation */
  var next = rng(m.seed), pa = shuffled(K, next), pbt = shuffled(K, next), pm = [];
  for (i = 0; i < M; i++) pm.push(shuffled(K, next));
  m.kB = new Float64Array(K); m.LK = new Float64Array(K * nOpen);
  for (k = 0; k < K; k++) {
    var ak = a + m.sdA * normInv((pa[k] + 0.5) / K), shocks = [];
    m.kB[k] = s.beta * Math.exp(s.betaSd * normInv((pbt[k] + 0.5) / K));
    for (i = 0; i < M; i++) shocks.push(s.monthSd * normInv((pm[i][k] + 0.5) / K));
    for (j = 0; j < nOpen; j++) m.LK[k * nOpen + j] = ak + baseTerm[j] + shocks[mOf[j]];
  }

  /* the price each other unit type allows this unit on each open night: a better type stays at least tierGap dearer than
     this unit (as a share of this unit's price), a cheaper type at least tierGap cheaper (as a share of its own); where
     the two are closer than that today, today's gap is the limit. Always strictly below a better type and above a
     cheaper one. NaN: that type has no price that night */
  m.tiers.forEach(function (t) {
    t.lim = new Float64Array(nOpen);
    open.forEach(function (n, x) {
      var tp = num(t.prices[n.iso]), cur = n.current, lim;
      if (!(tp > 0)) { t.lim[x] = NaN; return; }
      if (t.better) { lim = tp / (1 + s.tierGap); if (cur > lim && cur < tp) lim = cur; }
      else { lim = tp * (1 + s.tierGap); if (cur > tp && cur < lim) lim = cur; }
      t.lim[x] = lim;
    });
  });

  /* candidate prices per open night, multiples of the rounding step inside minFactor..maxFactor of the night's price
     today (P0 for nights with none), inside floor and ceiling, and inside the other unit types' limits that night (when
     that leaves nothing, the nearest price to them); peak nights keep today's price with keepPeaks */
  var step = m.step, kF = m.floor ? Math.ceil(m.floor / step - 1e-9) : 1, kC = m.ceiling < Infinity ? Math.floor(m.ceiling / step + 1e-9) : Infinity;
  if (kF < 1) kF = 1;
  /* the owner's limits as the prices use them: on the rounding step, and the floor wins when the two leave no step between */
  m.limits = { floor: m.floor ? kF * step : null, ceiling: m.ceiling < Infinity ? Math.max(kF, kC) * step : null };
  var cP = [], cOff = new Int32Array(nOpen), cN = new Int32Array(nOpen), cK0 = new Float64Array(nOpen);
  /* nights with a choice of prices; of them, the ones whose lowest price is the floor or the lowest price tried
     (minFactor), and whose highest is the ceiling or the highest price tried (maxFactor) */
  m.nVar = 0; m.nFloorLo = 0; m.nCeilHi = 0; m.nAtMin = 0; m.nAtMax = 0;
  m.nFree = 0;                                /* open nights the plans price (not kept at today's price as a peak) */
  m.nTier = 0;                                /* nights whose prices the other unit types limited, with the gap kept */
  m.tierUp = {}; m.tierDn = {};               /* the types that set the top or the bottom (with the gap or the order only) */
  m.nTierHi = 0; m.nTierLo = 0;               /* nights whose highest or lowest price they cut, the gap kept or not */
  /* nights where the gap does not fit between a cheaper and a better type (the order only, or one price when not even
     that fits), and nights where the owner's floor or ceiling, or the range of prices tried, leaves no price inside the
     limits (the plans take the nearest price allowed): counts and the types involved */
  m.squeeze = { n: 0, one: 0, up: {}, dn: {}, oneUp: {}, oneDn: {} };
  m.lost = { floor: 0, low: 0, ceiling: 0, high: 0, lowNoP: 0, highNoP: 0, up: {}, dn: {}, upF: {}, upL: {}, dnC: {}, dnH: {} };
  m.gapUp = {}; m.gapDn = {};                 /* the types the order note names: the ones that set a limit kept with the gap */
  function namesWhere(list, f) { return list.filter(f).map(function (q) { return q.name; }); }
  function addNames(o, names) { names.forEach(function (nm) { o[nm] = 1; }); }
  open.forEach(function (n, x) {
    cOff[x] = cP.length;
    if (m.keepPeaks && n.peak) {
      var keep = n.current;
      if (keep < m.floor) keep = kF * step;                       /* the floor and ceiling win over today's price */
      else if (keep > m.ceiling) keep = Math.max(kF, kC) * step;
      cP.push(keep); cN[x] = 1; cK0[x] = NaN;
      return;
    }
    m.nFree++;
    var bp = n.current || P0, lo0 = Math.ceil(bp * s.minFactor / step - 1e-9), hi0 = Math.floor(bp * s.maxFactor / step + 1e-9);
    var lo = Math.max(kF, lo0), hi = Math.min(kC, hi0), cntd = false;
    if (hi < lo) { lo = hi = kF > kC ? kF : clamp(Math.round(bp / step), kF, kC); }
    else {
      m.nVar++; cntd = true;
      var floorCut = kF > lo0, ceilCut = kC < hi0;
      if (floorCut) m.nFloorLo++;
      if (ceilCut) m.nCeilHi++;
      /* tHi, tLo: the gap limits on the step; oHi, oLo: the order only (strictly below, strictly above) */
      var tHi = Infinity, tLo = -Infinity, oHi = Infinity, oLo = -Infinity, pHi = Infinity, pLo = -Infinity, ups = [], dns = [];
      m.tiers.forEach(function (t) {
        var tp = num(t.prices[n.iso]), lim = t.lim[x]; if (!(tp > 0)) return;
        if (t.better) {
          var o1 = Math.ceil(tp / step - 1e-9) - 1, c1 = Math.min(Math.floor(lim / step + 1e-9), o1);
          if (c1 < tHi) tHi = c1; if (o1 < oHi) oHi = o1; if (tp < pHi) pHi = tp; ups.push({ name: t.name, c: c1, o: o1 });
        } else {
          var o2 = Math.floor(tp / step + 1e-9) + 1, c2 = Math.max(Math.ceil(lim / step - 1e-9), o2);
          if (c2 > tLo) tLo = c2; if (o2 > oLo) oLo = o2; if (tp > pLo) pLo = tp; dns.push({ name: t.name, c: c2, o: o2 });
        }
      });
      /* a cheaper and a better type too close for the gap: the order only (sqz 1); too close for a price between them on
         the step: one price (sqz 2), the step nearest today's when it is between them, else nearest halfway, the lower on a
         tie and never above the better type's price. sqUp, sqDn: the types whose gap limits clash */
      var sqz = 0, sqUp = namesWhere(ups, function (q) { return q.c === tHi; }), sqDn = namesWhere(dns, function (q) { return q.c === tLo; });
      if (tLo > tHi) {
        sqz = 1; tLo = oLo; tHi = oHi;
        if (tLo > tHi) {
          var mid = n.current > pLo && n.current < pHi ? n.current : (pLo + pHi) / 2, k1 = Math.ceil(mid / step - 0.5 - 1e-9);
          k1 = Math.min(k1, Math.floor(pHi / step + 1e-9));
          var oLo0 = tLo, oHi0 = tHi;
          sqUp = namesWhere(ups, function (q) { return q.o < oLo0; }); sqDn = namesWhere(dns, function (q) { return q.o > oHi0; });
          tLo = tHi = Math.max(1, k1); sqz = 2;
        }
      }
      var key = sqz ? 'o' : 'c';
      if (tHi < hi || tLo > lo) {
        var lo2 = Math.max(lo, tLo), hi2 = Math.min(hi, tHi);
        if (lo2 > hi2) {
          /* the floor or ceiling, or the range tried, wins: the window's end nearest the limits, and the types it fails */
          if (tLo > hi) {
            lo2 = hi2 = hi;
            if (ceilCut && hi === kC) m.lost.ceiling++; else { m.lost.high++; if (!n.current) m.lost.highNoP++; }
            if (floorCut && hi !== kF) m.nFloorLo--;
            addNames(m.lost.dn, namesWhere(dns, function (q) { return q[key] > hi; })); addNames(ceilCut && hi === kC ? m.lost.dnC : m.lost.dnH, namesWhere(dns, function (q) { return q[key] > hi; }));
          } else {
            lo2 = hi2 = lo;
            if (floorCut && lo === kF) m.lost.floor++; else { m.lost.low++; if (!n.current) m.lost.lowNoP++; }
            if (ceilCut && lo !== kC) m.nCeilHi--;
            addNames(m.lost.up, namesWhere(ups, function (q) { return q[key] < lo; })); addNames(floorCut && lo === kF ? m.lost.upF : m.lost.upL, namesWhere(ups, function (q) { return q[key] < lo; }));
          }
        } else if (sqz === 2) {
          /* one price: no choice left, so not a night with a choice (like a night whose own limits leave none) */
          m.squeeze.one++; addNames(m.squeeze.oneUp, sqUp); addNames(m.squeeze.oneDn, sqDn);
          m.nVar--; if (floorCut) m.nFloorLo--; if (ceilCut) m.nCeilHi--; cntd = false;
        } else {
          /* the limits hold: the top or bottom they cut, and the types that set them */
          var upB = namesWhere(ups, function (q) { return q[key] === tHi; }), dnB = namesWhere(dns, function (q) { return q[key] === tLo; });
          if (hi2 < hi) { m.nTierHi++; addNames(m.tierUp, upB); if (ceilCut) m.nCeilHi--; }
          if (lo2 > lo) { m.nTierLo++; addNames(m.tierDn, dnB); if (floorCut) m.nFloorLo--; }
          if (sqz) { m.squeeze.n++; addNames(m.squeeze.up, sqUp); addNames(m.squeeze.dn, sqDn); }
          else { m.nTier++; if (hi2 < hi) addNames(m.gapUp, upB); if (lo2 > lo) addNames(m.gapDn, dnB); }
        }
        lo = lo2; hi = hi2;
      } else if (sqz) {
        /* the night's own range already sits inside the order */
        if (sqz === 2) {
          m.squeeze.one++; addNames(m.squeeze.oneUp, sqUp); addNames(m.squeeze.oneDn, sqDn);
          m.nVar--; if (floorCut) m.nFloorLo--; if (ceilCut) m.nCeilHi--; cntd = false;
        } else { m.squeeze.n++; addNames(m.squeeze.up, sqUp); addNames(m.squeeze.dn, sqDn); }
      }
    }
    /* the range tried sets that end of the final window (the floor, ceiling and other types did not) */
    if (cntd) { if (lo === lo0) m.nAtMin++; if (hi === hi0) m.nAtMax++; }
    for (var c = lo; c <= hi; c++) cP.push(c * step);
    cN[x] = hi - lo + 1; cK0[x] = lo;
  });
  m.cP = new Float64Array(cP); m.cOff = cOff; m.cN = cN; m.cK0 = cK0;
  m.cPb = new Float64Array(cP.length); m.cCt = new Float64Array(cP.length);
  for (j = 0; j < nOpen; j++) {
    for (i = cOff[j]; i < cOff[j] + cN[j]; i++) { m.cPb[i] = pbar(m, j, m.cP[i], 0); m.cCt[i] = m.cP[i] * m.R[j] * m.kNet - m.v; }
  }

  /* the Monte Carlo draws: a, beta and a shock per month, then one uniform U per open night. The night sells when U is
     below its chance 1 - (1 - P)^H, which is the same as P above 1 - (1 - U)^(1 / H): so each uniform is stored as that
     threshold in log-odds (V), and a draw needs no exp, only a comparison with a + ... + beta (G - ln p) */
  var J = m.draws;
  m.mB = new Float64Array(J); m.L = new Float64Array(J * nOpen); m.V = new Float64Array(J * nOpen);
  for (j = 0; j < J; j++) {
    var aj = a + m.sdA * next.normal(), sh = [];
    m.mB[j] = s.beta * Math.exp(s.betaSd * next.normal());
    for (i = 0; i < M; i++) sh.push(s.monthSd * next.normal());
    for (k = 0; k < nOpen; k++) m.L[j * nOpen + k] = aj + baseTerm[k] + sh[mOf[k]];
  }
  for (i = 0; i < J * nOpen; i++) {
    var u = next(), Hx = m.H[i % nOpen], thr = Hx >= 1 ? u : Hx > 0 ? 1 - Math.pow(1 - u, 1 / Hx) : 1;
    m.V[i] = thr <= 0 ? -Infinity : thr >= 1 ? Infinity : Math.log(thr / (1 - thr));
  }
  m.riskCache = {};

  /* KC fresh parameter draws (stratified like the 48), only to check that the edge plans reach the goal */
  var qa = shuffled(KC, next), qb = shuffled(KC, next), qm = [];
  for (i = 0; i < M; i++) qm.push(shuffled(KC, next));
  m.kBC = new Float64Array(KC); m.LC = new Float64Array(KC * nOpen);
  for (k = 0; k < KC; k++) {
    var ck = a + m.sdA * normInv((qa[k] + 0.5) / KC), cs = [];
    m.kBC[k] = s.beta * Math.exp(s.betaSd * normInv((qb[k] + 0.5) / KC));
    for (i = 0; i < M; i++) cs.push(s.monthSd * normInv((qm[i][k] + 0.5) / KC));
    for (j = 0; j < nOpen; j++) m.LC[k * nOpen + j] = ck + baseTerm[j] + cs[mOf[j]];
  }

  /* the booked nights in each Monte Carlo draw: each stay (a booking, else a run of booked nights) cancels with
     cancelRate unless the guest is in; a cancelled night then sells again with its chance now. Drawn last, so the other
     draws do not depend on it */
  m.bookedDraw = new Float64Array(J);
  var stays = [], last = null;
  all.forEach(function (n) {
    if (n.status !== 'booked') { last = null; return; }
    if (!last || (n.stay ? n.stay !== last.id : last.id != null || daysBetween(last.end, n.iso) !== 1) || n.firm !== last.firm) { last = { id: n.stay, firm: n.firm, nights: [] }; stays.push(last); }
    last.nights.push(n); last.end = n.iso;
  });
  var keepSum = stays.map(function (st) { return st.nights.reduce(function (t, n) { return t + n.booked * (1 - m.pct) - m.v; }, 0); });
  for (j = 0; j < J; j++) {
    var tot = 0;
    for (i = 0; i < stays.length; i++) {
      if (stays[i].firm || !(s.cancelRate > 0) || next() >= s.cancelRate) { tot += keepSum[i]; continue; }
      stays[i].nights.forEach(function (n) { if (next() < n.resell) tot += n.resellCt; });
    }
    m.bookedDraw[j] = tot;
  }

  /* what calibration used, for the page */
  var text = [];
  if (hist) {
    text.push('Your last ' + plural(Math.round(hist.available), 'night') + ' with a price: ' + Math.round(hist.sold) + ' sold (' + pct(hist.observed) + ') at ' +
      (Math.abs(hist.priceIndex - 1) < 0.005 ? 'about the usual price' : 'about ' + pct(Math.abs(hist.priceIndex - 1)) + (hist.priceIndex > 1 ? ' above' : ' below') + ' the usual price') +
      ', so the usual occupancy ' + (Math.abs(hist.baseOcc - s.baseOcc) < 0.005 ? 'stays at ' + pct(s.baseOcc) : 'moves from ' + pct(s.baseOcc) + ' to ' + pct(hist.baseOcc)) + '.');
  }
  paceRows.forEach(function (r) { if (r.text) text.push(r.text); });
  m.calibration = {
    P0: P0, P0From: P0From, baseOcc: s.baseOcc, baseOccUsed: m.baseOcc, history: hist, pace: paceRows,
    peaks: all.filter(function (n) { return n.peak; }).map(function (n) { return { iso: n.iso, current: n.current, usual: n.usual, premium: n.current / n.usual - 1, status: n.status, special: n.special }; }),
    text: text
  };
  return m;
}

/* one open night's selling chance at price p: the mean over the 48 parameter draws, given it is still unsold now.
   shift moves a (the weak-demand check); bScale scales the reaction to price (1 unless given) */
function pbar(m, x, p, shift, bScale) {
  var lnp = Math.log(p), H = m.H[x], g = m.G[x], n = m.n, sum = 0, bs = bScale || 1;
  for (var k = 0; k < K; k++) sum += openChance(m.LK[k * n + x] + shift + bs * m.kB[k] * (g - lnp), H);
  return sum / K;
}
/* the same, from the candidate table when p is one of the night's candidates */
function chanceAt(m, x, p) {
  var off = m.cOff[x], cnt = m.cN[x];
  if (cnt === 1) { if (m.cP[off] === p) return m.cPb[off]; }
  else {
    var c = Math.round(p / m.step) - m.cK0[x];
    if (c >= 0 && c < cnt && m.cP[off + c] === p) return m.cPb[off + c];
  }
  return pbar(m, x, p, 0);
}

/* expected profit per month on the KC check draws (independent of the 48 the optimiser works with), so an edge plan's
   "reaches the goal" does not rest on the same draws that chose it */
function checkPPM(m, prices) {
  var n = m.n, contrib = 0;
  for (var x = 0; x < n; x++) {
    var p = prices[x];
    if (!(p > 0)) continue;
    var H = m.H[x], g = m.G[x] - Math.log(p), sum = 0;
    for (var k = 0; k < KC; k++) sum += openChance(m.LC[k * n + x] + m.kBC[k] * g, H);
    contrib += sum / KC * (p * m.R[x] * m.kNet - m.v);
  }
  return m.months ? (m.bookedContrib + contrib - m.fixedDates) / m.months : 0;
}

/* the plan for one lambda: per open night argmax_p Pbar(p) (contribution(p) + lambda); ties go to the lower price */
function planFor(m, lambda) {
  var out = new Float64Array(m.n);
  for (var x = 0; x < m.n; x++) {
    var off = m.cOff[x], end = off + m.cN[x], best = -Infinity, bp = 0;
    for (var c = off; c < end; c++) { var val = m.cPb[c] * (m.cCt[c] + lambda); if (val > best) { best = val; bp = m.cP[c]; } }
    out[x] = bp;
  }
  return out;
}

/* expected sales of the open nights at these prices (0 = no price, does not sell) */
function expect(m, prices, shift) {
  var pb = new Float64Array(m.n), sold = 0, rev = 0, contrib = 0, late = 0;
  for (var x = 0; x < m.n; x++) {
    var p = prices[x];
    if (!(p > 0)) continue;
    var q = shift ? pbar(m, x, p, shift) : chanceAt(m, x, p);
    pb[x] = q; sold += q; rev += q * p * m.R[x] * (1 - m.leak); contrib += q * (p * m.R[x] * m.kNet - m.v); late += q * m.lateW[x];
  }
  return { pb: pb, sold: sold, rev: rev, contrib: contrib, late: late };
}
function quick(m, e) {
  var sold = m.bookedSold + e.sold;
  return { occ: m.N ? sold / m.N : 0, adr: sold > 0 ? (m.bookedRev + e.rev) / sold : 0,
    profitPerMonth: m.months ? (m.bookedContrib + e.contrib - m.fixedDates) / m.months : 0 };
}

/* Monte Carlo over the first J draws: profit per month per draw, then P10/P50/P90 and the chances */
function risk(m, prices, J) {
  J = Math.min(J, m.draws);
  var key = J + ':' + sig(prices);
  if (m.riskCache[key]) return m.riskCache[key];
  /* a night with no price never sells: its log-price term is -Infinity, below every threshold */
  var n = m.n, gl = new Float64Array(n), ct = new Float64Array(n), x, j, L = m.L, V = m.V, mB = m.mB;
  for (x = 0; x < n; x++) { if (prices[x] > 0) { gl[x] = m.G[x] - Math.log(prices[x]); ct[x] = prices[x] * m.R[x] * m.kNet - m.v; } else gl[x] = -Infinity; }
  var out = new Float64Array(J), bd = m.bookedDraw, months = m.months || 1, hit = 0, loss = 0;
  for (j = 0; j < J; j++) {
    var b = mB[j], row = j * n, tot = bd[j] - m.fixedDates;
    for (x = 0; x < n; x++) if (L[row + x] + b * gl[x] > V[row + x]) tot += ct[x];   /* sold in this draw (see prepare) */
    out[j] = tot / months;
    if (out[j] >= m.target) hit++;
    if (out[j] < 0) loss++;
  }
  out.sort();
  function q(p) { var pos = p * (J - 1), lo = Math.floor(pos), hi = Math.min(J - 1, lo + 1); return out[lo] + (out[hi] - out[lo]) * (pos - lo); }
  var r = { p10: q(0.1), p50: q(0.5), p90: q(0.9), pTarget: hit / J, pLoss: loss / J, pBreakEven: 1 - loss / J };
  m.riskCache[key] = r;
  return r;
}

/* ---------------------------------------------------------------- one plan's numbers */
function currentPrices(m) {
  var out = new Float64Array(m.n);
  m.open.forEach(function (n, x) { out[x] = n.current || 0; });
  return out;
}

/* the stats, byMonth and per-night table for one plan (prices aligned with m.open) */
function summarise(m, prices, rk) {
  var e = expect(m, prices, 0), weak = expect(m, prices, -m.s.weakDemand), q = quick(m, e);
  var sold = m.bookedSold + e.sold, rev = m.bookedRev + e.rev, profit = m.bookedContrib + e.contrib - m.fixedDates;
  var margin = q.adr * (1 - m.pct) - m.v, fixed = m.costs.fixedMonthly;
  function occNeeded(extra) { if (fixed + extra <= 0) return 0; return margin > 0 ? (fixed + extra) / (DAYS_PER_MONTH * margin) : null; }
  var groups = { weekday: { nights: 0, open: 0, sold: 0, sum: 0, priced: 0 }, weekend: { nights: 0, open: 0, sold: 0, sum: 0, priced: 0 }, peak: { nights: 0, open: 0, sold: 0, sum: 0, priced: 0 } };
  var mon = m.monthKeys.map(function (key, i) { return { month: key, label: m.monthLabels[i], nights: 0, open: 0, booked: 0, blocked: 0, soldNights: 0, revenue: 0, contrib: 0, sum: 0, priced: 0, curSum: 0, curN: 0, changes: 0 }; });
  var prMap = {}, nightly = [], changes = 0, up = 0, down = 0, added = 0, moveSum = 0, moveN = 0, chgSum = 0, bigN = 0, minP = null, maxP = null;
  var tierAbove = {}, tierBelow = {}, tierClose = {}, x = 0;
  m.all.forEach(function (n) {
    var gk = n.peak ? 'peak' : n.g ? 'weekend' : 'weekday', gr = groups[gk], mo = mon[n.mi], price = null, chance = 0;
    gr.nights++; mo.nights++;
    if (n.status === 'open') {
      var p = prices[x], pb = e.pb[x], xo = x;
      x++;
      gr.open++; mo.open++;
      if (n.current) { mo.curSum += n.current; mo.curN++; }
      if (p > 0) {
        price = p; chance = pb; prMap[n.iso] = p;
        gr.sold += pb; gr.sum += p; gr.priced++;
        mo.soldNights += pb; mo.revenue += pb * p * n.R * (1 - m.leak); mo.contrib += pb * (p * n.R * m.kNet - m.v); mo.sum += p; mo.priced++;
        if (minP == null || p < minP) minP = p;
        if (maxP == null || p > maxP) maxP = p;
        if (p !== n.current) { changes++; mo.changes++; if (!n.current) added++; else if (p > n.current) up++; else down++; }
        if (n.current) { moveSum += Math.abs(p / n.current - 1); chgSum += p / n.current - 1; moveN++; if (Math.abs(p / n.current - 1) >= BIG_MOVE - 1e-9) bigN++; }
        m.tiers.forEach(function (t) {
          var tp = num(t.prices[n.iso]), lim = t.lim[xo];
          if (!(tp > 0)) return;
          if (t.better && p >= tp) tierAbove[t.name] = (tierAbove[t.name] || 0) + 1;
          else if (!t.better && p <= tp) tierBelow[t.name] = (tierBelow[t.name] || 0) + 1;
          else if (t.better ? p > lim + 1e-9 : p < lim - 1e-9) tierClose[t.name] = (tierClose[t.name] || 0) + 1;
        });
      }
    } else if (n.status === 'booked') {
      chance = n.bSold; gr.sold += n.bSold; mo.booked++; mo.soldNights += n.bSold; mo.revenue += n.bRev; mo.contrib += n.bCt;
    } else mo.blocked++;
    var row = { iso: n.iso, dow: n.dow, status: n.status, peak: n.peak, current: n.current, price: price, chance: chance };
    if (n.deal && n.status === 'open') row.deal = true;
    nightly.push(row);
  });
  function grp(g) { return { nights: g.nights, open: g.open, avgPrice: g.priced ? g.sum / g.priced : null, occ: g.nights ? g.sold / g.nights : 0 }; }
  function tierList(o) { return Object.keys(o).map(function (k) { return { name: k, nights: o[k] }; }); }
  var stats = {
    nights: m.N, openNights: m.n, bookedNights: m.bookedN, blockedNights: m.blockedN,
    occ: q.occ, occOpen: m.n ? e.sold / m.n : 0, soldNights: sold,
    adr: q.adr, listAdr: q.adr / (1 - m.leak), revpar: m.N ? rev / m.N : 0,
    revenue: rev, costs: m.pct * rev + m.v * sold + m.fixedDates, profit: profit, profitPerMonth: q.profitPerMonth,
    p10: rk.p10, p50: rk.p50, p90: rk.p90, pTarget: rk.pTarget, pLoss: rk.pLoss, pBreakEven: rk.pBreakEven,
    breakEvenOcc: occNeeded(0), targetOcc: occNeeded(m.target),
    stays: sold / m.s.avgStay, staysPerMonth: m.months ? sold / m.s.avgStay / m.months : 0,
    weekday: grp(groups.weekday), weekend: grp(groups.weekend), peak: grp(groups.peak),
    avgPrice: (groups.weekday.priced + groups.weekend.priced + groups.peak.priced) ? (groups.weekday.sum + groups.weekend.sum + groups.peak.sum) / (groups.weekday.priced + groups.weekend.priced + groups.peak.priced) : null,
    minPrice: minP, maxPrice: maxP,
    weakDemandProfitPerMonth: m.months ? (m.bookedContrib + weak.contrib - m.fixedDates) / m.months : 0,
    weakDemandSold: m.bookedSold + weak.sold,
    lateShare: sold > 0 ? e.late / sold : 0,
    avgMove: moveN ? moveSum / moveN : 0, avgChange: moveN ? chgSum / moveN : 0, bigMoves: bigN, pricedToday: moveN,
    up: up, down: down, added: added,
    tierAbove: tierList(tierAbove), tierBelow: tierList(tierBelow), tierClose: tierList(tierClose),
    reachesTarget: q.profitPerMonth >= m.target,
    vsCurrent: null
  };
  var byMonth = mon.map(function (r) {
    var share = m.costs.fixedMonthly * r.nights / DAYS_PER_MONTH;
    return { month: r.month, label: r.label, nights: r.nights, open: r.open, booked: r.booked, blocked: r.blocked,
      soldNights: r.soldNights, occ: r.nights ? r.soldNights / r.nights : 0, revenue: r.revenue, profit: r.contrib - share,
      avgPrice: r.priced ? r.sum / r.priced : null, currentAvgPrice: r.curN ? r.curSum / r.curN : null, changes: r.changes };
  });
  return { stats: stats, byMonth: byMonth, nightly: nightly, prices: prMap, changes: changes };
}

function versus(st, cur) {
  return { profitPerMonth: st.profitPerMonth - cur.profitPerMonth, occ: st.occ - cur.occ, adr: st.adr - cur.adr,
    pTarget: st.pTarget - cur.pTarget, soldNights: st.soldNights - cur.soldNights, staysPerMonth: st.staysPerMonth - cur.staysPerMonth,
    avgPrice: st.avgPrice != null && cur.avgPrice != null ? st.avgPrice - cur.avgPrice : null };
}

/* ---------------------------------------------------------------- pros and cons */
/* ctx {current: today's stats, isCurrent, best: the Most profit stats, bestName, weakPct}. Order: the chance of the
   target, losing money, the order against the building's other unit types, then the rest (the page shows three of each). */
function prosCons(m, st, ctx) {
  var pros = [], cons = [], money = m.money, target = m.target, months = m.months || 1, cur = ctx.current;
  var goalWords = target > 0 ? 'making ' + money(target) + ' a month' : 'covering all costs';
  var reachWords = target > 0 ? 'reach the target' : 'cover all costs';
  /* on short dates, counts of nights and stays are over the dates: "a month" would claim more nights than there are */
  var shortDates = m.N < SHORT_NIGHTS, per = shortDates ? ' over these dates' : ' a month';
  function about(x) { return money(round10(x)); }
  function count(x) { return Math.max(1, Math.round(x)); }

  /* the chance of reaching the target; 45% to 55% is an even chance, a con, as it could go either way */
  var p = st.pTarget;
  if (p >= 0.95) pros.push('Almost certain to ' + (target > 0 ? 'make ' + money(target) + ' a month' : 'cover all costs') + '.');
  else if (p < 0.05) cons.push('Little chance of ' + goalWords + ', less than 1 in 20.');
  else if (p >= 0.45 && p < 0.55) cons.push('About an even chance of ' + goalWords + '.');
  else (p >= 0.55 ? pros : cons).push('About ' + Math.round(p * 10) + ' in 10 chance of ' + goalWords + '.');

  /* losing money (with no target, the chance above already says it) */
  if (target > 0) {
    if (st.pLoss >= 0.95) cons.push('Almost certain to lose money over these dates.');
    else if (st.pLoss >= 0.15) cons.push('About ' + Math.round(st.pLoss * 10) + ' in 10 chance of losing money over these dates.');
    else if (st.pLoss < 0.05 && p < 0.95) pros.push('Very unlikely to lose money.');
  }

  /* tier order in the building */
  if (m.tiers.length) {
    var verb = ctx.isCurrent ? ' costs ' : ' would cost ';
    st.tierAbove.forEach(function (t) { cons.push('On ' + plural(t.nights, 'night') + ' this unit' + verb + 'as much as or more than ' + t.name + ', a better unit type in this building.'); });
    st.tierBelow.forEach(function (t) { cons.push('On ' + plural(t.nights, 'night') + ' this unit' + (ctx.isCurrent ? ' costs ' : ' would cost ') + 'no more than ' + t.name + ', a cheaper unit type in this building.'); });
    var gapW = gapPct(m.s.tierGap), better = {};
    m.tiers.forEach(function (t) { better[t.name] = t.better; });
    st.tierClose.forEach(function (t) {
      cons.push('On ' + plural(t.nights, 'night') + ' this unit' + (ctx.isCurrent ? ' is' : ' would be') + ' priced within ' + gapW + ' of ' + t.name + ', ' + (better[t.name] ? 'a better' : 'a cheaper') + ' unit type in this building.');
    });
    if (!st.tierAbove.length && !st.tierBelow.length && !st.tierClose.length) {
      /* beside a peer (no order kept against it), the types it does keep in order, by name */
      var tn = joinWords(m.tiers.map(function (t) { return t.name; }));
      if (m.peers.length) pros.push('Keeps this unit in order against ' + tn + (m.s.tierGap > 0 ? ', at least ' + gapW + ' apart (or as far apart as today, where that is less).' : '.'));
      else pros.push(m.s.tierGap > 0 ? 'Keeps the other unit types in this building in order, at least ' + gapW + ' apart (or as far apart as today, where that is less).'
        : 'Keeps the right order against the other unit types in this building.');
    }
  }

  /* the occupancy it needs, against what is likely to sell and the market, compared as the rounded percentages shown */
  var need = st.targetOcc, needP = need != null ? Math.round(need * 100) : null, occP = Math.round(st.occ * 100);
  if (need === 0) pros.push('Covers its costs from the first night sold.');
  else if (need != null && need < 0.005) pros.push('Needs under 1% of nights sold to ' + reachWords + '.');
  else if (need == null || need > 1) cons.push('Even with every night sold, these prices would not ' + reachWords + '.');
  else if (need > m.s.marketOcc && st.occ <= m.s.marketOcc) cons.push('Needs ' + needP + '% of nights sold to ' + reachWords + '; few ' + m.s.market + ' sell more than ' + pct(m.s.marketOcc) + '.');
  else if (needP < occP) pros.push('Needs ' + needP + '% of nights sold to ' + reachWords + ', and about ' + occP + '% are likely to sell.');
  else if (needP === occP) cons.push('Needs ' + needP + '% of nights sold to ' + reachWords + ', about as many as are likely to sell, so there is no room to spare.');
  else cons.push('Needs ' + needP + '% of nights sold to ' + reachWords + ', more than the ' + occP + '% likely to sell.');
  if (st.occ > m.s.marketOcc) cons.push('The forecast expects ' + occP + '% of nights sold, and few ' + m.s.market + ' sell more than ' + pct(m.s.marketOcc) + ', so treat this plan\'s numbers as optimistic.');

  /* against today's prices */
  if (ctx.isCurrent) {
    pros.push('Nothing to change: guests keep seeing the prices they see now.');
    if (m.missing) cons.push(plural(m.missing, 'open night has', 'open nights have') + ' no price today, so ' + (m.missing === 1 ? 'it cannot' : 'they cannot') + ' sell.');
    if (ctx.best && ctx.best.profitPerMonth - st.profitPerMonth >= 50) {
      cons.push((st.profitPerMonth < 0 && ctx.best.profitPerMonth < 0 ? 'Loses about ' + about(ctx.best.profitPerMonth - st.profitPerMonth) + ' a month more than ' : 'Makes about ' + about(ctx.best.profitPerMonth - st.profitPerMonth) + ' a month less than ') + ctx.bestName + '.');
    }
  } else if (cur) {
    var dP = st.profitPerMonth - cur.profitPerMonth, dN = st.soldNights - cur.soldNights, dS = st.stays - cur.stays;
    var dPr = st.avgPrice != null && cur.avgPrice != null ? st.avgPrice - cur.avgPrice : null;
    if (!shortDates) { dN /= months; dS /= months; }
    if (dP >= 20) pros.push('About ' + about(dP) + ' a month ' + (st.profitPerMonth < 0 ? 'less loss' : 'more profit') + ' than today\'s prices.');
    else if (dP <= -20) cons.push('About ' + about(-dP) + ' a month ' + (cur.profitPerMonth < 0 ? 'more loss' : 'less profit') + ' than today\'s prices.');
    /* prices against prices (the cards' Average rate), not revenue per night sold */
    if (dPr != null && dPr >= 5) pros.push('Prices are about ' + money(Math.round(dPr)) + ' a night higher than today on average, so each night sold brings in more.');
    else if (dPr != null && dPr <= -5) cons.push('Prices are about ' + money(Math.round(-dPr)) + ' a night lower than today on average, so each night sold brings in less.');
    if (dN >= 0.5) pros.push('About ' + plural(count(dN), 'more night') + ' sold' + per + ' than with today\'s prices.');
    else if (dN <= -0.5) cons.push('About ' + plural(count(-dN), 'fewer night') + ' sold' + per + ' than with today\'s prices.');
    if (dS >= 0.5) cons.push('About ' + plural(count(dS), 'more stay') + per + ' to clean, with more wear and more guest messages.');
    else if (dS <= -0.5) pros.push('About ' + plural(count(-dS), 'fewer stay') + per + ': less cleaning, wear and guest messages.');
    if (dS >= 1) pros.push('More stays bring more reviews and better placement on booking sites.');
    else if (dS <= -1) cons.push('Fewer stays mean fewer new reviews, which can lower placement on booking sites.');
    if (st.bigMoves > 0 && st.bigMoves * 3 >= st.pricedToday) {
      cons.push((st.bigMoves === st.pricedToday ? (st.pricedToday === 1 ? 'Moves the night with a price today' : 'Moves all ' + st.pricedToday + ' nights with a price today')
        : 'Moves ' + st.bigMoves + ' of the ' + st.pricedToday + ' nights with a price today') + ' by ' + pct(BIG_MOVE) + ' or more, and the forecast is less sure about prices guests have not seen.');
    }
    else if (st.avgMove <= 0.05 && st.up + st.down > 0) pros.push('Stays close to today\'s prices, so the forecast is on firmer ground.');
    /* peak nights kept at today's price while ordinary nights go above them */
    if (m.keepPeaks && st.peak.avgPrice != null && ((st.weekday.avgPrice != null && st.weekday.avgPrice > st.peak.avgPrice) || (st.weekend.avgPrice != null && st.weekend.avgPrice > st.peak.avgPrice))) {
      cons.push('Ordinary nights would cost more than the peak nights, which stay at today\'s price.');
    }
  }

  /* weak demand */
  var wd = st.weakDemandProfitPerMonth, wp = ctx.weakPct;
  if (target <= 0 && wd >= 0) pros.push('Still covers its costs if demand is ' + wp + '% weaker.');
  /* an amount that rounds to nothing is "about breaks even", not "about RM 0 a month"; short of a target, a con */
  else if (round10(wd) === 0) (target > 0 ? cons : pros).push('If demand is ' + wp + '% weaker, the unit about breaks even.');
  else if (target > 0 && wd >= target) pros.push('Still makes about ' + about(wd) + ' a month if demand is ' + wp + '% weaker.');
  else if (wd >= 0) cons.push('If demand is ' + wp + '% weaker, profit falls to about ' + about(wd) + ' a month.');
  else cons.push('If demand is ' + wp + '% weaker, the unit loses about ' + about(-wd) + ' a month.');

  /* reliance on last-minute bookings: only when clearly more than with today's prices (the dates' own pattern is a note) */
  var lateMore = cur && !ctx.isCurrent ? st.lateShare - cur.lateShare : 0;
  if (st.lateShare >= 0.6 && lateMore >= 0.1) cons.push('Relies on late bookings more than today\'s prices: ' + tenthsOf(st.lateShare) + ' of the nights it sells usually book in the last ' + LATE_DAYS + ' days before arrival.');
  else if (st.lateShare <= 0.3 && st.soldNights > 0) pros.push('Much of it is already booked or usually books well ahead.');

  if (!pros.length) {
    if (st.p50 >= 0) pros.push('Most likely profit is about ' + about(st.p50) + ' a month.');
    else pros.push(st.p90 >= 0 ? 'In a good run (about 1 in 10) profit could reach ' + about(st.p90) + ' a month.' : 'In a good run (about 1 in 10) the loss could be as small as ' + about(-st.p90) + ' a month.');
  }
  if (!cons.length) cons.push(st.p10 >= 0 ? 'In a bad run (about 1 in 10) profit could be as low as ' + about(st.p10) + ' a month.' : 'In a bad run (about 1 in 10) the unit could lose ' + about(-st.p10) + ' a month or more.');
  return { pros: pros, cons: cons };
}

/* the weak-demand percentage the sentences quote: how many fewer nights sell with a lowered by weakDemand. Worked out once
   per model, from today's prices (or, with none, the Most profit plan), so plan() and evaluate() quote the same figure */
function weakPctOf(m, prices) {
  var e = expect(m, prices, 0), w = expect(m, prices, -m.s.weakDemand);
  if (!(e.sold > 0)) return 20;
  return clamp(Math.round((1 - w.sold / e.sold) * 20) * 5, 5, 60);
}
function weakPctFor(m) {
  if (m.weakPct == null) m.weakPct = weakPctOf(m, m.missing < m.n ? currentPrices(m) : planFor(m, 0));
  return m.weakPct;
}

/* ---------------------------------------------------------------- the whole analysis */
var cache = { key: null, m: null };
function model(input) {
  input = input || {};
  var key;
  try {
    key = JSON.stringify([input.today, input.nights, input.costs, input.profitPerMonth, input.assumptions, input.history, input.otherTiers,
      input.keepPeaks, input.floor, input.ceiling, input.seed, input.draws, input.basePrice, input.lastMinute, input.specialDates]);
  } catch (e) { key = null; }
  var m = key && cache.key === key ? cache.m : prepare(input);
  if (key) { cache.key = key; cache.m = m; }
  m.money = moneyFn(input);
  return m;
}

function copySettings(s) { var o = {}; for (var k in s) if (has(s, k)) o[k] = Array.isArray(s[k]) ? s[k].slice() : s[k]; return o; }

function plan(input) {
  var m = model(input), s = m.s, money = m.money, x, i;
  var res = {
    today: m.today, nights: m.N, open: m.n, booked: m.bookedN, blocked: m.blockedN, months: m.months, target: m.target, P0: m.P0,
    costs: JSON.parse(JSON.stringify(m.costs)), required: requiredRates(input && input.costs, m.target, { avgStay: s.avgStay, discountLeak: s.discountLeak, paybackMonths: m.costs.paybackMonths }),
    assumptions: copySettings(s), calibration: JSON.parse(JSON.stringify(m.calibration)), seed: m.seed, draws: m.draws,
    limits: { floor: m.limits.floor, ceiling: m.limits.ceiling },
    deal: m.deal ? { pct: m.deal.pct, days: m.deal.days, nights: m.dealN } : null,
    reachable: false, recommended: null, options: [], frontier: [], demandCurve: [], notes: []
  };
  if (!m.N) { res.notes.push('Choose some dates to plan.'); return res; }
  var J = m.draws, JS = Math.min(SEARCH_DRAWS, J), target = m.target, cur = currentPrices(m);

  /* the frontier: lambda from -0.6 P0 (rate first) to +1.2 P0 (occupancy first), 25 steps, lambda = 0 included */
  function node(lambda) { var pr = planFor(m, lambda), e = expect(m, pr, 0); return { lambda: lambda, prices: pr, e: e, q: quick(m, e), sig: sig(pr) }; }
  var grid = [];
  for (i = 0; i <= 24; i++) grid.push(node((i - 8) * 0.075 * m.P0));
  var best = grid.reduce(function (b, nd) { return nd.q.profitPerMonth > b ? nd.q.profitPerMonth : b; }, -Infinity);
  var reachable = best >= target, goal = reachable ? target : 0, ext, k2;
  res.reachable = reachable;
  /* an edge plan (Fill, Premium) reaches the goal with a small margin, on the 48 draws that chose it and again on the KC
     check draws, so "reaches the target" does not hang on the noise of the draws that put it at the edge */
  var margin = Math.max(5, 0.005 * goal);
  function passes(nd) {
    if (!(nd.q.profitPerMonth >= goal + margin)) return false;
    if (nd.chk == null) nd.chk = checkPPM(m, nd.prices);
    return nd.chk >= goal + margin;
  }
  /* when even the ends of the grid still reach the goal, look further out until the prices stop moving */
  for (k2 = 0; k2 < 5 && passes(grid[0]); k2++) { ext = node(grid[0].lambda * 2); if (ext.sig === grid[0].sig) break; grid.unshift(ext); }
  for (k2 = 0; k2 < 5 && passes(grid[grid.length - 1]); k2++) { ext = node(grid[grid.length - 1].lambda * 2); if (ext.sig === grid[grid.length - 1].sig) break; grid.push(ext); }
  /* an end that still reaches the goal: the candidate prices (minFactor to maxFactor) stop Premium or Fill there */
  var endHigh = passes(grid[0]) ? grid[0] : null, endLow = passes(grid[grid.length - 1]) ? grid[grid.length - 1] : null;
  var zi = 0;
  grid.forEach(function (nd, gi) { if (nd.lambda === 0) zi = gi; });
  var cands = grid.slice();
  /* expected profit falls as lambda moves away from 0 either way, so the last plan that still reaches the goal can be
     found by halving the gap between grid points */
  function refine(passNd, failL) {
    var passL = passNd.lambda;
    for (var t = 0; t < 12; t++) { var mid = (passL + failL) / 2, nd = node(mid); if (passes(nd)) { passL = mid; passNd = nd; } else failL = mid; }
    return passNd;
  }
  if (passes(grid[zi])) {
    var up = zi, dn = zi;
    while (up + 1 < grid.length && passes(grid[up + 1])) up++;
    while (dn - 1 >= 0 && passes(grid[dn - 1])) dn--;
    if (up + 1 < grid.length) cands.push(refine(grid[up], grid[up + 1].lambda));
    if (dn - 1 >= 0) cands.push(refine(grid[dn], grid[dn - 1].lambda));
  }
  function pickBy(list, ok, score) {
    var out = null, bs = -Infinity;
    list.forEach(function (nd) {
      if (ok && !ok(nd)) return;
      var v = score(nd);
      if (v > bs + 1e-12 || (Math.abs(v - bs) <= 1e-12 && out && nd.q.profitPerMonth > out.q.profitPerMonth)) { bs = v; out = nd; }
    });
    return out;
  }
  var profitN = pickBy(cands, null, function (nd) { return nd.q.profitPerMonth; });
  var fillN = pickBy(cands, passes, function (nd) { return nd.q.occ; });
  var premN = pickBy(cands, passes, function (nd) { return nd.q.adr; });
  /* the goal is reached only just: Fill and Premium are the Most profit plan */
  if (!fillN && profitN.q.profitPerMonth >= goal) fillN = profitN;
  if (!premN && profitN.q.profitPerMonth >= goal) premN = profitN;

  /* Most profit, Fill and Premium, then the guarantees: Most profit has the highest expected profit, Fill the highest
     occupancy and Premium the highest ADR among the options that reach the goal (an option that beats one of them on
     its own measure takes its place, and the two merge into one card). Today's prices take another role only when they
     price every open night inside the prices the planner tries (the floor and ceiling, and the other unit types'
     prices): otherwise a card named for the planner would show prices the planner would not choose (no price at all,
     outside the owner's limits, or out of order with the building's other unit types). */
  var curOK = !m.missing && m.open.every(function (n, xx) {
    var lo = m.cP[m.cOff[xx]], hi = m.cP[m.cOff[xx] + m.cN[xx] - 1];
    return n.current >= m.floor && n.current <= m.ceiling && n.current >= lo - 1e-9 && n.current <= hi + 1e-9;
  });
  var picks = { current: cur, fill: fillN && fillN.prices, balanced: null, profit: profitN.prices, premium: premN && premN.prices };
  var S = {};
  function full(pr) { var key = sig(pr); if (!S[key]) S[key] = summarise(m, pr, risk(m, pr, J)); return S[key]; }
  function st(k) { return full(picks[k]).stats; }
  function eligible(k) { return k !== 'current' || curOK; }
  function reaches(pr) { return full(pr).stats.profitPerMonth >= goal + margin && checkPPM(m, pr) >= goal + margin; }
  ORDER.forEach(function (k) { if (picks[k] && eligible(k) && st(k).profit > st('profit').profit + 1e-9) picks.profit = picks[k]; });
  ORDER.forEach(function (k) {
    if (!picks[k] || !eligible(k) || !reaches(picks[k])) return;
    if (!picks.fill || st(k).occ > st('fill').occ + 1e-12) picks.fill = picks[k];
    if (!picks.premium || st(k).adr > st('premium').adr + 1e-9) picks.premium = picks[k];
  });
  var fillAtEnd = !!(endLow && picks.fill && sig(picks.fill) === endLow.sig), premAtEnd = !!(endHigh && picks.premium && sig(picks.premium) === endHigh.sig);
  var profitSt = st('profit'), why;

  /* Balanced. Chances within the Monte Carlo's own noise count as equal, and among equals the higher expected profit
     (then the better P10) wins, so the pick does not swing on a few draws along the flat top of the chance curve.
     - On average the target is reached, or some plan has an even chance or better: the best chance of the target.
     - Otherwise between Most profit and Fill (at least as many nights as Most profit): the best chance of breaking even
       when the plans really differ on it (below 95%), unless a plan outside that band has a clearly better chance of
       the target; with no real chance of the target anywhere, the most profit.
     - No plan covers its costs on average: Most profit, the smallest loss.
     Searched over the frontier with JS draws; the best few, their neighbours and the other options are then compared with
     all the draws, so no other option is clearly ahead of Balanced on its measure. */
  function bandOf(p, draws) { return Math.max(0.01, 2 * Math.sqrt(p * (1 - p) / draws)); }
  function top(list, k) { return list.reduce(function (b, t) { return Math.max(b, t.r[k]); }, 0); }
  function near(list, k, draws) { var t = top(list, k), b = bandOf(t, draws); return list.filter(function (x) { return x.r[k] >= t - b; }); }
  function richest(list) { return list.slice().sort(function (A, B) { return (B.q.profitPerMonth - A.q.profitPerMonth) || (B.r.p10 - A.r.p10); }); }
  function choose(list, draws) {
    if (!reachable) { var side = list.filter(function (t) { return t.q.occ >= profitSt.occ - 1e-9; }); if (side.length) list = side; }
    var topT = top(list, 'pTarget');
    if (reachable || topT >= 0.5) return { list: richest(near(list, 'pTarget', draws)), why: 'target' };
    var safe = list, w = 'profit';
    if (top(list, 'pBreakEven') < 0.95) { safe = near(list, 'pBreakEven', draws); w = 'breakEven'; }
    var topSafe = top(safe, 'pTarget');
    if (topT >= 0.05 && topT > topSafe + bandOf(topSafe, draws)) { safe = list; w = 'target'; }
    if (top(safe, 'pTarget') < 0.05) return { list: richest(safe), why: w };
    return { list: richest(near(safe, 'pTarget', draws)), why: w === 'profit' ? 'target' : w };
  }
  if (!reachable && profitSt.profitPerMonth < 0) { picks.balanced = picks.profit; why = 'loss'; }
  else {
    var seen = {}, scored = [];
    cands.forEach(function (nd) { if (!seen[nd.sig]) { seen[nd.sig] = 1; scored.push({ nd: nd, prices: nd.prices, q: nd.q, r: risk(m, nd.prices, JS) }); } });
    var ranked = choose(scored, JS).list, shortlist = ranked.slice(0, 3);
    var byL = cands.slice().sort(function (A, B) { return A.lambda - B.lambda; }), topNd = ranked[0].nd;
    byL.forEach(function (nd, bi) { if (nd === topNd) { if (byL[bi - 1]) shortlist.push({ prices: byL[bi - 1].prices }); if (byL[bi + 1]) shortlist.push({ prices: byL[bi + 1].prices }); } });
    ORDER.forEach(function (k) { if (picks[k] && eligible(k)) shortlist.push({ prices: picks[k] }); });
    var pool = [], inPool = {};
    shortlist.forEach(function (t) {
      var key = sig(t.prices);
      if (inPool[key]) return;
      inPool[key] = 1;
      var fs = full(t.prices).stats;
      pool.push({ prices: t.prices, q: fs, r: fs });
    });
    var fin = choose(pool, J);
    picks.balanced = fin.list[0].prices; why = fin.why;
  }

  /* cards: options with the same prices merge into one card with both names */
  var curStats = st('current'), weakPct = weakPctFor(m), bySig = {}, cards = [], topCardT = 0;
  ORDER.forEach(function (k) {
    if (!picks[k]) return;
    var key = sig(picks[k]);
    if (bySig[key]) { bySig[key].keys.push(k); return; }
    bySig[key] = { keys: [k], prices: picks[k] };
    cards.push(bySig[key]);
    topCardT = Math.max(topCardT, st(k).pTarget);
  });
  var goalText = target > 0 ? money(target) + ' a month' : 'all costs';
  var makes = target > 0 ? 'make ' + goalText : 'cover all costs', reachIt = target > 0 ? 'of reaching it' : 'of covering them';
  /* "the lowest price you allow ... makes", "the lowest prices the planner tries ... make" */
  function makesFor(one) { return one ? (target > 0 ? 'makes ' + goalText : 'covers all costs') : makes; }
  /* where Fill or Premium stopped: the limit that sets that end of the final range on most nights with a choice, the
     owner's floor or ceiling, the other unit types (below) or the range tried (minFactor, maxFactor); with none on most
     nights, "the lowest/highest prices allowed". When most of the nights priced have no choice of price (one price
     between the other types, or limits that leave none), the plans are mostly one set of prices: no end is named and
     nothing is said to have stopped */
  if (!m.nVar || m.nVar * 2 < m.nFree) fillAtEnd = premAtEnd = false;
  var byFloor = m.nVar > 0 && m.floor > 0 && m.nFloorLo * 2 >= m.nVar, byCeil = m.nVar > 0 && m.ceiling < Infinity && m.nCeilHi * 2 >= m.nVar;
  var byMin = m.nVar > 0 && m.nAtMin * 2 >= m.nVar, byMax = m.nVar > 0 && m.nAtMax * 2 >= m.nVar;
  /* or the building's other unit types, when they cut most nights' range at that end: where the limits held, and where
     they left no room and the lowest (or highest) price allowed was used instead */
  var ls = m.lost, lostTop = ls.floor + ls.low, lostBot = ls.ceiling + ls.high;
  var tu = Object.keys(m.tierUp).concat(Object.keys(ls.up).filter(function (k) { return !m.tierUp[k]; }));
  var td = Object.keys(m.tierDn).concat(Object.keys(ls.dn).filter(function (k) { return !m.tierDn[k]; }));
  var byTierLo = !byFloor && td.length > 0 && (m.nTierLo + lostBot) * 2 >= m.nVar, byTierHi = !byCeil && tu.length > 0 && (m.nTierHi + lostTop) * 2 >= m.nVar;
  var ofWhat = m.missing === m.n ? ' of the usual price)' : ' of today\'s)';
  /* ", or your lowest price where that leaves no room": the price used on the nights the limits left no room */
  function orAllowed(end, own, tried) { return own + tried ? ', or ' + (own && tried ? 'the ' + end + ' price allowed' : own ? 'your ' + end + ' price' : 'the ' + end + ' price tried') + ' where that leaves no room' : ''; }
  var lowWords = byFloor ? 'the lowest price you allow (' + money(Math.ceil(m.floor / m.step - 1e-9) * m.step) + ')' : byTierLo ? 'the lowest prices that keep this unit above ' + joinWords(td) + orAllowed('highest', ls.ceiling, ls.high) : byMin ? 'the lowest prices the planner tries (' + pct(s.minFactor) + ofWhat : 'the lowest prices allowed';
  var highWords = byCeil ? 'the highest price you allow (' + money(Math.floor(m.ceiling / m.step + 1e-9) * m.step) + ')' : byTierHi ? 'the highest prices that keep this unit below ' + joinWords(tu) + orAllowed('lowest', ls.floor, ls.low) : byMax ? 'the highest prices the planner tries (' + pct(s.maxFactor) + ofWhat : 'the highest prices allowed';
  function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
  function chanceShort(p) { return p >= 0.95 ? 'almost certain' : p < 0.05 ? 'less than 1 in 20' : p >= 0.45 && p < 0.55 ? 'about even' : 'about ' + Math.round(p * 10) + ' in 10'; }
  function summaryOf(k, stt) {
    if (k === 'current') return 'Today\'s prices, run through the same forecast.';
    if (k === 'profit') return stt.profitPerMonth >= 0 ? 'The highest expected profit, about ' + money(round10(stt.profitPerMonth)) + ' a month.' : 'The smallest loss, about ' + money(round10(-stt.profitPerMonth)) + ' a month.';
    if (k === 'balanced') {
      if (why === 'loss') return 'No plan covers all costs on average, so this is the one that loses the least.';
      if (reachable) {
        return (stt.pTarget >= 0.95 ? 'Almost certain to ' + makes + ', and more profit than the other plans that are as sure.'
          : 'As good a chance of ' + (target > 0 ? 'making ' + goalText : 'covering all costs') + ' as any plan here (' + chanceShort(stt.pTarget) + '), and more profit than the others with about that chance.');
      }
      if (why === 'breakEven') return 'On average no plan makes ' + goalText + '; this one has the best chance of covering all costs, ' + chanceShort(stt.pBreakEven) + '.';
      if (why === 'profit') return 'On average no plan makes ' + goalText + ' and none has a real chance of it, so this is the plan with the most profit.';
      /* Balanced keeps to Fill's side of Most profit: a dearer plan can have a clearly better long-shot chance */
      if (topCardT > stt.pTarget + bandOf(topCardT, J)) return 'On average no plan quite makes ' + goalText + '; this one has ' + chanceNoun(stt.pTarget) + ' of it. Higher prices could raise that chance a little, but would make less on average.';
      return 'On average no plan quite makes ' + goalText + '; this one has the best chance of it, ' + chanceShort(stt.pTarget) + '.';
    }
    var lossWords = stt.pLoss >= 0.15 ? ', with ' + chanceNoun(stt.pLoss) + ' of a loss' : '';
    if (k === 'fill') {
      if (reachable) return fillAtEnd ? cap(lowWords) + ', which still ' + makesFor(byFloor) + ' on average, to sell the most nights.' : 'The lowest prices that still ' + makes + ' on average, to sell the most nights, with ' + chanceNoun(stt.pTarget) + ' ' + reachIt + '.';
      return (fillAtEnd ? cap(lowWords) + ', which still ' + (byFloor ? 'covers' : 'cover') + ' costs on average' : 'Sells the most nights while covering costs on average' + lossWords) + '; it does not reach ' + goalText + '.';
    }
    if (reachable) return premAtEnd ? cap(highWords) + ', which still ' + makesFor(byCeil) + ' on average.' : 'The highest prices that still ' + makes + ' on average, with ' + chanceNoun(stt.pTarget) + ' ' + reachIt + '.';
    return (premAtEnd ? cap(highWords) + ', which still ' + (byCeil ? 'covers' : 'cover') + ' costs on average' : 'The highest prices that still cover costs on average' + lossWords) + '; it does not reach ' + goalText + '.';
  }
  res.options = cards.map(function (c) {
    var sm = full(c.prices), stt = JSON.parse(JSON.stringify(sm.stats));
    stt.vsCurrent = versus(stt, curStats);
    var isCur = c.keys.indexOf('current') >= 0, names = c.keys.map(function (k) { return NAMES[k]; });
    var pc = prosCons(m, stt, { current: curStats, isCurrent: isCur, best: c.keys.indexOf('profit') >= 0 ? null : profitSt, bestName: 'the ' + NAMES.profit + ' plan', weakPct: weakPct });
    /* out of reach, Fill and Premium miss the target; "Breaks even only" is kept for the ones that make about nothing */
    var tag = c.keys.indexOf('balanced') >= 0 ? 'Recommended' : !reachable && (c.keys.indexOf('fill') >= 0 || c.keys.indexOf('premium') >= 0) ? (Math.abs(stt.profitPerMonth) < 50 ? 'Breaks even only' : 'Misses the target') : '';
    return {
      key: c.keys[0], keys: c.keys, name: joinWords(names), names: names,
      summary: c.keys.map(function (k) { return summaryOf(k, stt); }).join(' '),
      tag: tag, recommended: c.keys.indexOf('balanced') >= 0, reachesTarget: stt.reachesTarget,
      prices: sm.prices, changes: sm.changes, stats: stt, byMonth: sm.byMonth, nightly: sm.nightly, pros: pc.pros, cons: pc.cons
    };
  });
  res.options.forEach(function (o) { if (o.recommended) res.recommended = o.key; });

  /* the frontier for the slider (higher rate first), with each plan's search-draw chances */
  var lastSig = null;
  grid.forEach(function (nd) {
    if (nd.sig === lastSig) return;
    lastSig = nd.sig;
    var r = risk(m, nd.prices, JS), mp = {};
    m.open.forEach(function (n, xx) { if (nd.prices[xx] > 0) mp[n.iso] = nd.prices[xx]; });
    res.frontier.push({ lambda: nd.lambda, prices: mp, occ: nd.q.occ, adr: nd.q.adr, listAdr: nd.q.adr / (1 - m.leak), profitPerMonth: nd.q.profitPerMonth,
      pTarget: r.pTarget, pBreakEven: r.pBreakEven, reachesTarget: nd.q.profitPerMonth >= target });
  });

  /* what guests will pay: today's prices scaled up and down together. An open night with no price today does not sell,
     as in Today's prices, so the curve passes through that card; with no prices at all, every night starts from P0 */
  var steps = Math.min(60, Math.round((s.maxFactor - s.minFactor) / 0.05)), noneLeft = m.missing === m.n;
  for (i = 0; i <= steps; i++) {
    var f = s.minFactor + (s.maxFactor - s.minFactor) * i / (steps || 1), pr = new Float64Array(m.n);
    for (x = 0; x < m.n; x++) pr[x] = (m.open[x].current || (noneLeft ? m.P0 : 0)) * f;
    var q = quick(m, expect(m, pr, 0));
    res.demandCurve.push({ factor: f, occ: q.occ, adr: q.adr, listAdr: q.adr / (1 - m.leak), profitPerMonth: q.profitPerMonth });
    if (!steps) break;
  }

  /* notes */
  var balSt = st('balanced');
  if (!m.n) res.notes.push('Every night in these dates is ' + (m.bookedN ? (m.blockedN ? 'booked or blocked' : 'booked') : 'blocked') + ', so there is nothing to price.');
  if (m.N < ROUGH_NIGHTS) res.notes.push('These dates cover only ' + plural(m.N, 'night') + ', so the monthly figures are rough: one booking more or less changes them a lot.');
  if (m.missing) res.notes.push(plural(m.missing, 'open night has', 'open nights have') + ' no price today. Today\'s prices count ' + (m.missing === 1 ? 'it' : 'them') + ' as not selling; the other plans give ' + (m.missing === 1 ? 'it' : 'them') + ' a price.');
  if (m.bookedUnknown) res.notes.push(plural(m.bookedUnknown, 'booked night has', 'booked nights have') + ' no amount recorded, so ' + (m.bookedUnknown === 1 ? 'it is' : 'they are') + ' counted at today\'s price less the usual discount.');
  var P0From = m.calibration.P0From;
  if (P0From !== 'weekdays' && P0From !== 'all nights') res.notes.push('There are no prices in these dates to start from, so the usual price is taken as ' + money(m.P0) + (P0From === 'base price' ? ', the unit\'s base price.' : P0From === 'booked' ? ', from what the booked nights brought in.' : P0From === 'costs' ? ', what the costs need.' : '.'));
  /* without the unit's own history the level comes from the market figure, and the plans only adjust today's prices */
  var hst = m.calibration.history;
  if (m.n && (P0From === 'weekdays' || P0From === 'all nights') && (!hst || hst.weight < 0.25)) {
    res.notes.push('This unit has little sales history yet, so the forecast assumes today\'s ' + (P0From === 'weekdays' ? 'Sunday to Thursday price' : 'usual price') + ' sells about ' + pct(m.baseOcc) + ' of nights. The plans adjust today\'s prices; they do not work out a market price from scratch.');
  }
  if (m.keepPeaks) {
    var kept = 0, held = 0;
    m.open.forEach(function (n, xx) { if (n.peak) { if (m.cP[m.cOff[xx]] === n.current) kept++; else held++; } });
    if (kept) res.notes.push(plural(kept, 'peak night keeps', 'peak nights keep') + ' today\'s price in every plan.');
    if (held) res.notes.push(plural(held, 'peak night is', 'peak nights are') + ' held at the lowest or highest price allowed instead of today\'s price.');
  }
  /* the building's other unit types limited the prices */
  var gapW = gapPct(m.s.tierGap);
  var gu = Object.keys(m.gapUp), gd = Object.keys(m.gapDn);
  if (m.nTier && (gu.length || gd.length)) {
    res.notes.push('To keep the unit types in this building in order' + (m.s.tierGap > 0 ? ' and at least ' + gapW + ' apart (or as far apart as today, where that is less)' : '') +
      ', the plans keep this unit ' + [gu.length ? 'below ' + joinWords(gu) : '', gd.length ? 'above ' + joinWords(gd) : ''].filter(Boolean).join(' and ') +
      '. That limits the prices of ' + plural(m.nTier, 'night') + '.');
  }
  /* the cheaper and the better types too close for the gap, or for any price between them */
  var sq = m.squeeze;
  function bothW(dn, up) { return joinWords(Object.keys(dn).concat(Object.keys(up).filter(function (k) { return !dn[k]; }))); }
  if (sq.n) res.notes.push('On ' + plural(sq.n, 'night') + ' ' + bothW(sq.dn, sq.up) + ' are too close in price to keep this unit ' + gapW + ' from both, so there the plans only keep it between them.');
  if (sq.one) res.notes.push('On ' + plural(sq.one, 'night') + ' no price in steps of ' + money(m.step) + ' fits between ' + bothW(sq.oneDn, sq.oneUp) + ', so there the plans use a single price, the step nearest today\'s price or halfway, never above the dearer type.');
  /* the owner's floor or ceiling, or the range of prices tried, leaves no price that keeps the order and the gap */
  /* the range tried is a share of today's price, or of the usual price on nights with none */
  function ofNights(nN, all) { return nN === all ? ' of the usual price)' : nN ? ' of today\'s price, or of the usual price on nights with none)' : ' of today\'s)'; }
  if (ls.floor) res.notes.push('On ' + plural(ls.floor, 'night') + ' your lowest price, ' + money(m.limits.floor) + ', leaves no room under ' + joinWords(Object.keys(ls.upF)) + ', so the plans use it there.');
  if (ls.low) res.notes.push('On ' + plural(ls.low, 'night') + ' the lowest price tried (' + pct(m.s.minFactor) + ofNights(ls.lowNoP, ls.low) + ' leaves no room under ' + joinWords(Object.keys(ls.upL)) + ', so the plans use it there.');
  if (ls.ceiling) res.notes.push('On ' + plural(ls.ceiling, 'night') + ' your highest price, ' + money(m.limits.ceiling) + ', leaves no room over ' + joinWords(Object.keys(ls.dnC)) + ', so the plans use it there.');
  if (ls.high) res.notes.push('On ' + plural(ls.high, 'night') + ' the highest price tried (' + pct(m.s.maxFactor) + ofNights(ls.highNoP, ls.high) + ' leaves no room over ' + joinWords(Object.keys(ls.dnH)) + ', so the plans use it there.');
  /* types priced like this unit */
  if (m.peers.length) res.notes.push(joinWords(m.peers) + (m.peers.length === 1 ? ' has' : ' have') + ' about the same usual price as this unit, so the plans keep no order against ' + (m.peers.length === 1 ? 'it' : 'them') + '.');
  /* the workspace's last-minute deal still applies on top of these prices; the forecast counts it */
  if (m.dealN) {
    res.notes.push('Your last-minute deal takes ' + pct(m.deal.pct) + ' off ' + (m.dealN === m.n ? (m.n === 1 ? 'the open night' : 'every open night') : m.dealN + ' of the ' + plural(m.n, 'open night')) + ' when ' + (m.dealN === 1 ? 'it is' : 'they are') + ' booked in the last ' + plural(m.deal.days, 'day') +
      ' before the night. The forecast counts it, and the prices here are the ones before the deal.');
  }
  var still = reachable ? (target > 0 ? 'makes ' + goalText : 'covers all costs') : 'covers costs';
  /* (stopped by the other unit types: the note on them above says it) */
  if (fillAtEnd && !byTierLo) res.notes.push(NAMES.fill + ' stopped at ' + lowWords + ' and still ' + still + ' on average, so even lower prices could sell more nights.' + (byFloor || !byMin ? '' : ' Lowest price to try, in the assumptions, sets this limit.'));
  if (premAtEnd && !byTierHi) res.notes.push(NAMES.premium + ' stopped at ' + highWords + ' and still ' + still + ' on average, so higher prices might still work.' + (byCeil || !byMax ? '' : ' Highest price to try, in the assumptions, sets this limit.'));
  if (m.n && balSt.lateShare >= 0.6) res.notes.push('Guests book late for these dates: ' + tenthsOf(balSt.lateShare) + ' of the nights likely to sell usually book in the last ' + LATE_DAYS + ' days before arrival, so the calendar fills late.');
  if (!reachable && m.n) {
    var bestPlan = profitSt, short = target - bestPlan.profitPerMonth;
    if (target > 0) {
      res.notes.push('On average, no plan reaches ' + money(target) + ' a month. The best one ' + (bestPlan.profitPerMonth >= 0 ? 'makes about ' + money(round10(bestPlan.profitPerMonth)) : 'loses about ' + money(round10(-bestPlan.profitPerMonth))) + ' a month, about ' + money(round10(short)) + ' short' +
        (balSt.pTarget >= 0.05 ? '; the recommended plan still has ' + chanceNoun(balSt.pTarget) + ' of reaching it.' : '.'));
    } else res.notes.push('On average, no plan covers all costs in these dates. The best one loses about ' + money(round10(-bestPlan.profitPerMonth)) + ' a month.');
    var e = expect(m, picks.profit, 0), openPM = e.contrib / m.months, allSold = 0;
    for (x = 0; x < m.n; x++) if (picks.profit[x] > 0) allSold += picks.profit[x] * m.R[x] * m.kNet - m.v;
    var allSoldPM = (m.bookedContrib + allSold - m.fixedDates) / m.months;
    var more = openPM > 0 ? short / openPM : null;
    res.notes.push((target > 0 ? 'To reach it' : 'To cover them') + ', costs would need to be about ' + money(round10(short)) + ' a month lower' +
      (allSoldPM < target || more == null ? '; more bookings alone would not do it, as even selling every open night at those prices ' + (allSoldPM >= 0 ? 'makes about ' + money(round10(allSoldPM)) : 'loses about ' + money(round10(-allSoldPM))) + ' a month.'
        : ', or about ' + Math.max(5, Math.round(more * 20) * 5) + '% more bookings at the same prices.'));
    if (bestPlan.profitPerMonth < 0 && target > 0) res.notes.push('On average, no plan covers all costs in these dates either.');
    /* Fill and Premium look for prices that cover all costs: say why their cards are missing */
    if (!picks.fill || !picks.premium) res.notes.push('There is no ' + NAMES.fill + ' or ' + NAMES.premium + ' plan: both look for prices that cover all costs, and on average none does in these dates.');
  } else if (!reachable) {
    var bp = curStats.profitPerMonth;
    res.notes.push((m.bookedN ? 'The booked nights ' : 'With nothing to sell, the unit ') + (bp >= 0 ? 'make about ' + money(round10(bp)) : 'loses about ' + money(round10(-bp))) + ' a month' + (target > 0 ? ', short of the ' + money(target) + ' target.' : '.'));
  }
  /* how much guests react to price is the least certain part of the forecast: with a weaker reaction (beta lowered by
     betaSd), would the most profitable prices move the other way from today's? Then say so, with what is at stake */
  if (m.n && s.betaSd > 0 && balSt.pricedToday) {
    var bLow = Math.exp(-s.betaSd), lowPr = new Float64Array(m.n), recPr = picks.balanced, chgLow = 0, nLow = 0;
    var lowCt = function (pr) { var t = 0; for (var xx = 0; xx < m.n; xx++) if (pr[xx] > 0) t += pbar(m, xx, pr[xx], 0, bLow) * (pr[xx] * m.R[xx] * m.kNet - m.v); return t; };
    for (x = 0; x < m.n; x++) {
      var off = m.cOff[x], bestV = -Infinity;
      for (var c = off; c < off + m.cN[x]; c++) { var val = pbar(m, x, m.cP[c], 0, bLow) * m.cCt[c]; if (val > bestV) { bestV = val; lowPr[x] = m.cP[c]; } }
      if (m.open[x].current) { chgLow += lowPr[x] / m.open[x].current - 1; nLow++; }
    }
    chgLow = nLow ? chgLow / nLow : 0;
    if (Math.abs(chgLow) >= 0.01 && Math.abs(balSt.avgChange) >= 0.01 && (chgLow > 0) !== (balSt.avgChange > 0)) {
      var d1 = (expect(m, recPr, 0).contrib - expect(m, lowPr, 0).contrib) / m.months, d2 = (lowCt(lowPr) - lowCt(recPr)) / m.months;
      res.notes.push('How much guests react to price is the least certain part of the forecast. If they react less than assumed, the most profitable prices would be ' + (chgLow > 0 ? 'higher' : 'lower') + ' than today\'s rather than ' + (chgLow > 0 ? 'lower' : 'higher') +
        '. The difference in profit between the two is about ' + money(Math.max(10, round10(Math.max(d1, d2)))) + ' a month.');
    }
  }
  return res;
}

/* the same stats, risk and pros/cons for any price map {iso: price}; open nights left out keep today's price.
   opts {key, name}. -> one option card (key 'custom', name 'Your plan' unless given) */
function evaluate(input, prices, opts) {
  opts = opts || {};
  prices = prices || {};
  var m = model(input), J = m.draws, cur = currentPrices(m), pr = new Float64Array(m.n);
  m.open.forEach(function (n, x) { var v = num(prices[n.iso]); pr[x] = v > 0 ? v : cur[x]; });
  var cs = summarise(m, cur, risk(m, cur, J)).stats, sm = summarise(m, pr, risk(m, pr, J)), stt = JSON.parse(JSON.stringify(sm.stats));
  stt.vsCurrent = versus(stt, cs);
  var same = sig(pr) === sig(cur);
  var pc = prosCons(m, stt, { current: cs, isCurrent: same, best: null, weakPct: weakPctFor(m) });
  return {
    key: opts.key || 'custom', keys: [opts.key || 'custom'], name: opts.name || 'Your plan', names: [opts.name || 'Your plan'],
    summary: same ? 'Today\'s prices, run through the same forecast.' : 'Your own mix of prices.', tag: '', recommended: false,
    reachesTarget: stt.reachesTarget, prices: sm.prices, changes: sm.changes, stats: stt, byMonth: sm.byMonth, nightly: sm.nightly, pros: pc.pros, cons: pc.cons
  };
}

var R = {
  DEFAULTS: DEFAULTS, ASSUMPTIONS: ASSUMPTIONS, COST_FIELDS: COST_FIELDS, DAYS_PER_MONTH: DAYS_PER_MONTH, NAMES: NAMES,
  monthlyCosts: monthlyCosts, requiredRates: requiredRates, plan: plan, evaluate: evaluate, rng: rng
};
if (typeof module !== 'undefined' && module.exports) module.exports = R;
