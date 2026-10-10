/* Orbique PMS v4: Statistics (new page, Insights)
   The in-depth analysis that left the operational pages: the Dashboard's month-to-date comparison (revenue, occupancy,
   the metric table), the Bookings KPIs (revenue, ADR, occupancy, average stay, lead time), the Reviews stats (rating trend,
   by platform, category scores, response rate and time) and the Invoices stats (sent, paid, overdue, collection time),
   plus channel mix, cancellations, guest countries, operations (tasks on time, turnover time, readiness) and costs.

   One filter row scopes every tab: a date range (core presets incl. "All data") and a property (all or one).
   Comparison periods (grey in charts, deltas on tiles):
     - a range inside one month that starts on the 1st (month to date, last month, a custom 1–15 Sep) compares with the
       same days of the two previous months (a whole month compares with whole months);
     - any other range compares with the period of the same length just before it, and the one before that.
     A comparison that would start before the records start is dropped (shown as "–").
   Each tab: KPI tiles, one or two charts, one table (the table is also what CSV / PDF export).
   Permissions: page = O.can('statistics'); money (revenue, ADR, RevPAR, amounts, the Costs tab) = statistics.money;
   CSV / PDF = statistics.export.
   ctx.params (for links from other pages): {tab, preset, from, to, propertyId}. */
(function () {
  var O = window.O, D = O.data, M = O.metrics, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;

  var TABS = [
    ['overview', 'Overview'], ['revenue', 'Revenue & occupancy'], ['bookings', 'Bookings & guests'], ['reviews', 'Reviews'],
    ['invoices', 'Invoices & payments'], ['operations', 'Operations'], ['costs', 'Costs']
  ];
  var PRESETS = ['last7', 'last30', 'mtd', 'lastMonth', 'last90', 'qtd', 'lastQuarter', 'ytd', 'last12m', 'since'];
  var SUBS = [['cleanliness', 'Cleanliness'], ['communication', 'Communication'], ['checkin', 'Check-in'], ['accuracy', 'Accuracy']];
  var REVIEW_PLATS = ['airbnb', 'booking', 'agoda', 'vrbo', 'google'];
  var LEAD = [[0, 0, 'Same day'], [1, 7, '1–7 days'], [8, 30, '8–30 days'], [31, 90, '31–90 days'], [91, 1e9, '91+ days']];
  var LOS = [[1, 1, '1 night'], [2, 2, '2 nights'], [3, 3, '3 nights'], [4, 6, '4–6 nights'], [7, 1e9, '7+ nights']];
  var PAY = [[0, 0, 'Same day'], [1, 7, '1–7 days'], [8, 30, '8–30 days'], [31, 1e9, '31+ days']];

  var st = { ready: false, tab: 'overview', preset: 'mtd', from: null, to: null, pid: '', model: null };

  /* ------------------------------------------------------------------ small helpers */
  function sum(a, f) { return a.reduce(function (s, x) { var v = f ? f(x) : x; return s + (v && !isNaN(v) ? v : 0); }, 0); }
  function avg(a, f) { return a.length ? sum(a, f) / a.length : null; }
  function ratio(a, b) { return b ? a / b : null; }
  function live(b) { return b.status !== 'cancelled'; }
  function created(b) { return String(b.createdAt || b.checkIn || '').slice(0, 10); }
  function leadDays(b) { return Math.max(0, d.diff(created(b), b.checkIn)); }
  function mins(iso) { return Date.parse(iso + ':00Z') / 6e4; }
  function dur(m) { if (m == null || isNaN(m)) return '–'; m = Math.max(0, Math.round(m)); var h = Math.floor(m / 60), r = m % 60; return h ? h + 'h' + (r ? ' ' + r + 'm' : '') : r + 'm'; }
  function r2(v) { return v.toFixed(2); }
  function int(v) { return fmt.num(Math.round(v)); }
  function days1(v) { return fmt.num(v, 1) + ' days'; }
  function propName(id, short) { var p = D.propById[id]; return p ? (short ? p.short || p.name : p.name) : 'Unknown unit'; }
  function staffName(id) { var s = id && D.staffById(id); return s ? s.name : 'Unassigned'; }
  function foreign(b) { return !!(b.guest && (b.guest.foreign || (b.guest.country && b.guest.country !== 'MY'))); }
  function countryOf(b) { var g = b.guest || {}; return g.countryName || (g.country && D.countryName && D.countryName[g.country]) || g.country || 'Unknown'; }
  function bks(pid) { return pid ? D.bookings.filter(function (b) { return b.propertyId === pid; }) : D.bookings; }
  function madeIn(p, pid) { return bks(pid).filter(function (b) { var c = created(b); return c >= p.from && c <= p.to && (!b.createdAt || b.createdAt <= D.NOW); }); }
  function inBucket(lo, hi) { return function (v) { return v >= lo && v <= hi; }; }
  function tabIndex(id) { for (var i = 0; i < TABS.length; i++) if (TABS[i][0] === id) return i; return -1; }
  function tabName(id) { var i = tabIndex(id); return i >= 0 ? TABS[i][1] : id; }
  function moneyAxis(v, ax) { if (!ax) return fmt.money(v); if (Math.abs(v) < 1000) return 'RM ' + Math.round(v); var k = v / 1000; return 'RM ' + (Math.abs(k - Math.round(k)) < 0.05 ? Math.round(k) : k.toFixed(1)) + 'k'; }
  function countAxis(v, ax) { return ax ? (v % 1 ? v.toFixed(1) : String(v)) : fmt.num(v); }
  function pctAxis(v) { return Math.round(v * 100) + '%'; }

  /* ------------------------------------------------------------------ value formats (screen + CSV) */
  var F = {
    money: [function (v) { return fmt.money(v); }, function (v) { return Math.round(v); }, ' (RM)'],
    num: [function (v) { return fmt.num(v); }, function (v) { return Math.round(v); }, ''],
    dec1: [function (v) { return fmt.num(v, 1); }, function (v) { return v.toFixed(1); }, ''],
    pct: [function (v) { return fmt.pct(v); }, function (v) { return (v * 100).toFixed(1); }, ' (%)'],
    pct1: [function (v) { return fmt.pct(v, 1); }, function (v) { return (v * 100).toFixed(1); }, ' (%)'],
    rating: [function (v) { return v.toFixed(2) + ' ★'; }, function (v) { return v.toFixed(2); }, ' (stars)'],
    days: [function (v) { return fmt.num(v, 1) + ' days'; }, function (v) { return v.toFixed(1); }, ' (days)'],
    nights: [function (v) { return fmt.num(v, 1) + ' nights'; }, function (v) { return v.toFixed(1); }, ' (nights)'],
    dur: [function (v) { return dur(v); }, function (v) { return Math.round(v); }, ' (minutes)']
  };
  function fv(type, v) { return v == null || isNaN(v) ? '–' : (F[type] || F.num)[0](v); }
  function fc(type, v) { return v == null || isNaN(v) ? '' : (F[type] || F.num)[1](v); }

  /* change between two values. o.kind: rel (default) | pts (percentage points of a rate) | abs (o.f formats the gap) */
  function chg(cur, prev, o) {
    o = o || {};
    if (cur == null || prev == null || isNaN(cur) || isNaN(prev)) return null;
    var diff = cur - prev, v, txt;
    if (o.kind === 'pts') { v = diff * 100; txt = Math.abs(v).toFixed(1) + ' pts'; }
    else if (o.kind === 'abs') { v = diff; txt = o.f ? o.f(Math.abs(diff)) : fmt.num(Math.abs(diff), 1); }
    else { if (!prev) return null; v = diff / Math.abs(prev); txt = (Math.abs(v) * 100).toFixed(1) + '%'; }
    var flat = Math.abs(v) < (o.kind === 'abs' ? (o.eps || 0.005) : o.kind === 'pts' ? 0.05 : 0.0005);
    return { v: v, txt: txt, flat: flat, cls: flat || o.neutral ? 'flat' : ((o.invert ? v < 0 : v > 0) ? 'good' : 'bad') };
  }
  function dl(cur, prev, o) { var c = chg(cur, prev, o); if (!c) return '<span class="delta flat">–</span>'; return '<span class="delta ' + c.cls + '">' + (c.flat ? '± ' : c.v > 0 ? '▲ ' : '▼ ') + esc(c.txt) + '</span>'; }
  function dlText(cur, prev, o) { var c = chg(cur, prev, o); if (!c) return ''; return (c.flat ? '±' : c.v > 0 ? '+' : '-') + c.txt; }

  /* the metrics, defined once so tiles, the overview table and the exports agree */
  var MET = {
    revenue: { label: 'Revenue', type: 'money', money: true, title: 'Accommodation and cleaning fees earned on nights stayed in the range. Tourism tax is passed through and not counted.' },
    nights: { label: 'Nights sold', type: 'num', title: 'Nights with a guest in the range (cancelled stays not counted)' },
    occ: { label: 'Occupancy', type: 'pct1', kind: 'pts', title: 'Nights sold ÷ nights available. Blocked nights (owner stays, maintenance) are not available.' },
    adr: { label: 'ADR', type: 'money', money: true, title: 'Average daily rate: revenue ÷ nights sold' },
    revpar: { label: 'RevPAR', type: 'money', money: true, title: 'Revenue per available night' },
    weekend: { label: 'Weekend occupancy', type: 'pct', kind: 'pts', title: 'Occupancy of Friday and Saturday nights' },
    alos: { label: 'Avg length of stay', type: 'nights', kind: 'abs', neutral: true, f: function (v) { return fmt.num(v, 1); }, title: 'Average nights of the stays that arrive in the range' },
    made: { label: 'Bookings made', type: 'num', title: 'New bookings made in the range, whenever the stay is (cancelled ones not counted)' },
    bookedValue: { label: 'Value booked', type: 'money', money: true, title: 'Accommodation and cleaning fees of the bookings made in the range' },
    lead: { label: 'Avg lead time', type: 'days', kind: 'abs', neutral: true, f: days1, title: 'Days between booking and arrival, for bookings made in the range' },
    cancelRate: { label: 'Cancellation rate', type: 'pct1', kind: 'pts', invert: true, title: 'Share of the bookings made in the range that were cancelled' },
    foreign: { label: 'International guests', type: 'pct', kind: 'pts', neutral: true, title: 'Share of arrivals from outside Malaysia' },
    direct: { label: 'Direct bookings', type: 'pct', kind: 'pts', title: 'Share of bookings made directly with you (no platform commission)' },
    rating: { label: 'Average rating', type: 'rating', kind: 'abs', f: r2, title: 'Average stars across every platform for reviews left in the range' },
    reviews: { label: 'Reviews', type: 'num', title: 'Reviews left in the range' },
    respRate: { label: 'Response rate', type: 'pct', kind: 'pts', title: 'Share of the reviews in the range that have a public reply' },
    replyDays: { label: 'Avg reply time', type: 'days', kind: 'abs', invert: true, f: days1, title: 'Days from the review to your reply' },
    five: { label: '5-star share', type: 'pct', kind: 'pts', title: 'Share of reviews with 5 stars' },
    low: { label: '3 stars or lower', type: 'num', kind: 'abs', f: int, eps: 0.5, invert: true, title: 'Reviews of 3 stars or lower' },
    invoices: { label: 'Invoices issued', type: 'num', title: 'Invoices dated in the range (one per booking, cancelled bookings not counted)' },
    sentRate: { label: 'Sent to guest', type: 'pct', kind: 'pts', title: 'Share of the invoices that were sent to the guest' },
    paidRate: { label: 'Paid', type: 'pct', kind: 'pts', title: 'Share of the invoices that are paid' },
    unpaid: { label: 'Awaiting payment', type: 'num', kind: 'abs', f: int, eps: 0.5, invert: true, title: 'Invoices in the range that are not paid yet' },
    overdue: { label: 'Overdue', type: 'num', kind: 'abs', f: int, eps: 0.5, invert: true, title: 'Unpaid invoices past their due date: direct bookings are due before arrival (invoice settings), platform bookings are collected when booked' },
    collect: { label: 'Collection time', type: 'days', kind: 'abs', invert: true, f: days1, title: 'Days from invoice to payment for direct bookings (platforms collect at booking)' },
    deps: { label: 'Turnovers', type: 'num', title: 'Check-outs in the range: each one is a unit to turn around' },
    b2b: { label: 'Back-to-back', type: 'num', title: 'Check-outs with a new guest arriving the same day' },
    turn: { label: 'Avg turnover time', type: 'dur', kind: 'abs', invert: true, f: dur, eps: 1, title: 'From the guest\'s check-out time to the turnover clean being done (or the restock being logged in Inventory)' },
    onTime: { label: 'Tasks done on time', type: 'pct', kind: 'pts', title: 'Tasks due in the range that were done by their due time' },
    tasksDone: { label: 'Tasks done', type: 'num', title: 'Tasks due in the range that are done' },
    opex: { label: 'Operating costs', type: 'money', money: true, invert: true, title: 'Running costs (opex): cleaning, laundry, utilities, repairs and the like' },
    capex: { label: 'Capital spending', type: 'money', money: true, neutral: true, title: 'Assets that last years (capex): furniture, appliances, aircon units, renovation' },
    spend: { label: 'Total spend', type: 'money', money: true, invert: true, title: 'Operating costs plus capital spending (rejected claims not counted)' },
    opexShare: { label: 'Opex share of revenue', type: 'pct1', kind: 'pts', invert: true, title: 'Operating costs ÷ revenue earned in the range' },
    entries: { label: 'Expense entries', type: 'num', neutral: true, title: 'Expenses recorded in the range (rejected claims not counted)' },
    opexNight: { label: 'Opex per night sold', type: 'money', money: true, invert: true, title: 'Operating costs ÷ nights sold' }
  };

  /* ------------------------------------------------------------------ range, comparison periods, buckets */
  function dataStart() {
    var s = D.DATA_START || D.TODAY;
    D.bookings.forEach(function (b) { if (b.checkIn && b.checkIn < s) s = b.checkIn; });
    return s;
  }
  function range() {
    var raw = st.preset ? U.preset(st.preset) : null;
    if (!raw && st.from && st.to) raw = { from: st.from, to: st.to };
    if (!raw) { st.preset = 'mtd'; raw = U.preset('mtd'); }
    var s = dataStart(), r = { from: raw.from, to: raw.to, rawFrom: raw.from, rawTo: raw.to, note: '' };
    if (st.preset === 'since') r.from = s;
    if (r.to < s) { r.from = s; r.to = d.add(s, 29) < D.TODAY ? d.add(s, 29) : D.TODAY; r.note = 'Records start on ' + d.fmtY(s) + ', so the first days of the records are shown.'; }
    else if (r.from < s) { r.from = s; r.note = 'Records start on ' + d.fmtY(s) + ', so the range is counted from then.'; }
    if (r.to > D.TODAY) r.note += (r.note ? ' ' : '') + 'Nights after today are stays already on the books.';
    r.days = d.diff(r.from, r.to) + 1;
    r.label = U.rangeLabel(r.from, r.to); r.short = d.fmtRange(r.from, r.to);
    return r;
  }
  function compare(r) {
    var s = dataStart();
    var monthly = r.from === d.monthStart(r.from) && r.to.slice(0, 7) === r.from.slice(0, 7);
    var whole = monthly && r.to === d.monthEnd(r.to);
    var out = [1, 2].map(function (k) {
      var c;
      if (monthly) {
        var ms = d.addMonths(r.from, -k), me = d.monthEnd(ms);
        c = { from: ms, to: whole ? me : d.add(ms, Math.min(d.day(r.to), d.day(me)) - 1) };
        c.tag = d.monthName(ms); c.long = whole ? d.monthName(ms, true) : 'the same days in ' + d.monthName(ms, true);
      } else {
        c = { from: d.add(r.from, -r.days * k), to: d.add(r.from, -r.days * (k - 1) - 1) };
        c.tag = k === 1 ? 'previous' : 'before that';
        c.long = k === 1 ? 'the previous ' + fmt.plural(r.days, 'day') : 'the ' + fmt.plural(r.days, 'day') + ' before that';
      }
      c.k = k; c.label = U.rangeLabel(c.from, c.to); c.short = d.fmtRange(c.from, c.to);
      return c.from < s ? null : c;
    });
    if (!out[0]) out[1] = null;
    return { c1: out[0], c2: out[1], monthly: monthly };
  }
  /* daily up to 45 days, weekly (counted back from the last day) up to 200, monthly beyond */
  function buckets(r, kind) {
    var n = d.diff(r.from, r.to) + 1, out = [], a = r.from;
    kind = kind || (n <= 45 ? 'day' : n <= 200 ? 'week' : 'month');
    if (kind === 'day') { d.range(r.from, r.to).forEach(function (x) { out.push({ a: x, b: x, label: d.fmt(x), kind: 'day' }); }); return out; }
    if (kind === 'week') { var z = r.to; while (z >= r.from) { var a0 = d.add(z, -6); if (a0 < r.from) a0 = r.from; out.unshift({ a: a0, b: z, label: d.fmt(a0), kind: 'week' }); z = d.add(a0, -1); } return out; }
    while (a <= r.to) { var e = d.monthEnd(a); if (e > r.to) e = r.to; out.push({ a: a, b: e, label: d.monthName(a) + (a.slice(0, 4) !== r.to.slice(0, 4) ? ' ' + a.slice(2, 4) : ''), kind: 'month' }); a = d.add(e, 1); }
    return out;
  }
  function align(bk, c) { /* comparison buckets of the same kind, lined up with the current ones */
    if (!c || !bk.length) return null;
    var kind = bk[0].kind, out = buckets(c, kind);
    if (kind === 'week') { out = out.slice(-bk.length); while (out.length < bk.length) out.unshift(null); }
    else { out = out.slice(0, bk.length); while (out.length < bk.length) out.push(null); }
    return out;
  }
  function bucketTitle(bk) {
    if (!bk) return '';
    var n = d.diff(bk.a, bk.b) + 1;
    return bk.kind === 'day' ? d.dowName(bk.a) + ' ' + d.fmtY(bk.a) : bk.kind === 'week' ? d.fmtRange(bk.a, bk.b) + (n < 7 ? ' (' + fmt.plural(n, 'day') + ')' : '') : U.rangeLabel(bk.a, bk.b);
  }
  function bucketShort(bk) { return !bk ? '' : bk.kind === 'day' ? d.fmt(bk.a) : d.fmtRange(bk.a, bk.b); }
  function unitWord(bk) { return bk.length && bk[0].kind === 'day' ? 'day' : bk.length && bk[0].kind === 'week' ? 'week' : 'month'; }

  function scope() {
    var r = range(), c = compare(r), pid = st.pid && D.propById[st.pid] ? st.pid : '';
    var S = { r: r, c1: c.c1, c2: c.c2, monthly: c.monthly, pid: pid, prop: pid ? D.propById[pid] : null, money: O.can('statistics.money') };
    S.bk = buckets(r); S.bk1 = align(S.bk, S.c1); S.bk2 = align(S.bk, S.c2);
    return S;
  }

  /* ------------------------------------------------------------------ calculations (memoised per paint) */
  var memo = {}, turnIdx = null;
  function get(name, p, pid) {
    if (!p) return null;
    var k = name + '|' + p.from + '|' + p.to + '|' + (pid || '');
    if (!(k in memo)) memo[k] = CALC[name](p, pid);
    return memo[k];
  }
  function restockAt(bookingId) { /* when the turnover restock was logged in Inventory (end of a turnover) */
    if (!turnIdx) { turnIdx = {}; (D.invMoves || []).forEach(function (m) { if (m && m.kind === 'turnover' && m.bookingId && m.at) turnIdx[m.bookingId] = m.at; }); }
    return turnIdx[bookingId] || null;
  }
  var CALC = {
    base: function (p, pid) {
      var f = pid ? { propertyId: pid } : null, o = {};
      o.revenue = M.revenue(p.from, p.to, f);
      o.nights = M.nightsSold(p.from, p.to, f);
      o.avail = M.availableNights(p.from, p.to, pid || undefined);
      o.blocked = M.blockedNights(p.from, p.to, pid || undefined);
      o.occ = ratio(o.nights, o.avail); o.adr = ratio(o.revenue, o.nights); o.revpar = ratio(o.revenue, o.avail);
      var arr = bks(pid).filter(function (b) { return live(b) && b.checkIn >= p.from && b.checkIn <= p.to; });
      o.arr = arr; o.alos = avg(arr, function (b) { return b.nights; });
      o.foreign = arr.length ? arr.filter(foreign).length / arr.length : null;
      var made = madeIn(p, pid), lm = made.filter(live);
      o.madeAll = made; o.madeLive = lm; o.made = lm.length; o.cancelled = made.length - lm.length;
      o.cancelRate = made.length ? o.cancelled / made.length : null;
      o.bookedValue = sum(lm, function (b) { return b.revenue; });
      o.lead = avg(lm, leadDays);
      o.direct = lm.length ? lm.filter(function (b) { return b.channel === 'direct'; }).length / lm.length : null;
      return o;
    },
    week: function (p, pid) { /* weekend (Fri, Sat nights) vs weekday occupancy */
      var f = pid ? { propertyId: pid } : null, we = [0, 0], wd = [0, 0];
      d.range(p.from, p.to).forEach(function (x) { var t = d.isWeekend(x) ? we : wd; t[0] += M.nightsSold(x, x, f); t[1] += M.availableNights(x, x, pid || undefined); });
      return { weekend: ratio(we[0], we[1]), weekday: ratio(wd[0], wd[1]) };
    },
    ahead: function (p, pid) { /* the 30 nights after the range (or after today), as they were booked at that point */
      var asOf = p.to < D.TODAY ? p.to : D.TODAY, from = d.add(asOf, 1), to = d.add(asOf, 30), rev = 0, n = 0;
      bks(pid).forEach(function (b) {
        if (b.createdAt && (b.createdAt > D.NOW || created(b) > asOf)) return;
        if (b.status === 'cancelled' && (asOf >= D.TODAY || !b.cancelledAt || b.cancelledAt <= asOf)) return;
        var k = M.nightsIn(b, from, to); if (!k) return;
        rev += (b.revenue || 0) / b.nights * k; n += k;
      });
      var avail = M.availableNights(from, to, pid || undefined);
      return { from: from, to: to, asOf: asOf, revenue: rev, nights: n, occ: ratio(n, avail) };
    },
    rv: function (p, pid) {
      var list = D.reviews.filter(function (x) { return x.date >= p.from && x.date <= p.to && (!pid || x.propertyId === pid); });
      var replied = list.filter(function (x) { return x.reply; });
      var o = { list: list, n: list.length, rating: avg(list, function (x) { return x.stars; }) };
      o.respRate = ratio(replied.length, list.length);
      o.replyDays = avg(replied.filter(function (x) { return x.reply.date; }), function (x) { return Math.max(0, d.diff(x.date, x.reply.date)); });
      o.five = ratio(list.filter(function (x) { return x.stars === 5; }).length, list.length);
      o.low = list.length ? list.filter(function (x) { return x.stars <= 3; }).length : null;
      o.subs = {}; SUBS.forEach(function (s) { var l = list.filter(function (x) { return x.sub && x.sub[s[0]] != null; }); o.subs[s[0]] = avg(l, function (x) { return x.sub[s[0]]; }); });
      return o;
    },
    inv: function (p, pid) {
      var dueDays = (D.invoiceSettings && +D.invoiceSettings.dueDays) || 7;
      function dueOf(b) { if (b.channel !== 'direct') return b.invoiceDate; var x = d.add(b.checkIn, -dueDays); return x < b.invoiceDate ? b.invoiceDate : x; }
      function payDays(b) { return Math.max(0, d.diff(b.invoiceDate, b.paidAt)); }
      var list = bks(pid).filter(function (b) { return b.invoiceNo && live(b) && b.invoiceDate && b.invoiceDate >= p.from && b.invoiceDate <= p.to; });
      var paid = list.filter(function (b) { return b.paidAt; }), unpaid = list.filter(function (b) { return !b.paidAt; });
      var overdue = unpaid.filter(function (b) { return b.status !== 'pending' && dueOf(b) < D.TODAY; });
      var total = function (b) { return b.total; };
      return {
        list: list, n: list.length, paidList: paid, unpaidList: unpaid, overdueList: overdue, payDays: payDays, isOverdue: function (b) { return overdue.indexOf(b) >= 0; },
        sent: list.filter(function (b) { return b.invoiceSent; }).length, sameDay: list.filter(function (b) { return b.invoiceSent && b.invoiceSent.at === b.invoiceDate; }).length,
        sentRate: ratio(list.filter(function (b) { return b.invoiceSent; }).length, list.length), paidRate: ratio(paid.length, list.length),
        unpaid: list.length ? unpaid.length : null, overdue: list.length ? overdue.length : null,
        billed: sum(list, total), collected: sum(paid, total), outstanding: sum(unpaid, total), overdueAmt: sum(overdue, total),
        collect: avg(paid.filter(function (b) { return b.channel === 'direct'; }), payDays), collectAll: avg(paid, payDays)
      };
    },
    ops: function (p, pid) {
      var tasks = D.tasks.filter(function (t) { var dd = String(t.due || '').slice(0, 10); return dd && dd >= p.from && dd <= p.to && (!pid || t.propertyId === pid); });
      var done = tasks.filter(function (t) { return t.status === 'done'; }), timed = done.filter(function (t) { return t.doneAt && t.due; });
      var onTime = timed.filter(function (t) { return t.doneAt <= t.due; });
      var open = tasks.filter(function (t) { return t.status !== 'done'; });
      var deps = bks(pid).filter(function (b) { return live(b) && b.checkOut >= p.from && b.checkOut <= p.to; }).map(function (b) {
        var next = D.bookings.filter(function (x) { return x !== b && live(x) && x.propertyId === b.propertyId && x.checkIn === b.checkOut; })[0] || null;
        var out = b.checkOut + 'T' + (b.checkOutTime || '11:00'), row = { b: b, next: next, window: null, turn: null };
        if (next) row.window = mins(next.checkIn + 'T' + (next.checkInTime || '15:00')) - mins(out);
        if (out <= D.NOW) {
          var task = D.tasks.filter(function (t) { return t.propertyId === b.propertyId && t.type === 'Turnover' && t.status === 'done' && t.doneAt && String(t.due || '').slice(0, 10) === b.checkOut && t.doneAt >= out; })[0];
          var at = task ? task.doneAt : restockAt(b.id);
          if (at && at >= out) { var m = mins(at) - mins(out); if (m >= 0 && m < 24 * 60) row.turn = m; }
        }
        return row;
      });
      var b2b = deps.filter(function (x) { return x.next; }), turned = deps.filter(function (x) { return x.turn != null; });
      return {
        tasks: tasks, done: done, timed: timed, open: open, tasksN: tasks.length, tasksDone: tasks.length ? done.length : null,
        onTime: ratio(onTime.length, timed.length), onTimeN: onTime.length,
        overdueNow: open.filter(function (t) { return t.due < D.NOW; }).length,
        depRows: deps, deps: deps.length, b2b: deps.length ? b2b.length : null, b2bShare: ratio(b2b.length, deps.length),
        window: avg(b2b.filter(function (x) { return x.window != null; }), function (x) { return x.window; }),
        turn: avg(turned, function (x) { return x.turn; }), turnN: turned.length
      };
    },
    cost: function (p, pid) {
      var all = M.expenses(p.from, p.to).filter(function (e) { return !pid || e.propertyId === pid; });
      var cls = function (e) { return e.costClass === 'capex' ? 'capex' : 'opex'; };
      var opex = all.filter(function (e) { return cls(e) === 'opex'; }), capex = all.filter(function (e) { return cls(e) === 'capex'; });
      var byType = {};
      all.forEach(function (e) { var k = (e.type || 'Others') + '|' + cls(e); var t = byType[k] || (byType[k] = { type: e.type || 'Others', cls: cls(e), amt: 0, n: 0 }); t.amt += e.amount || 0; t.n++; });
      return { list: all, opexList: opex, capexList: capex, n: all.length, opex: sum(opex, function (e) { return e.amount; }), capex: sum(capex, function (e) { return e.amount; }), spend: sum(all, function (e) { return e.amount; }), byType: byType };
    }
  };
  /* one flat record of every headline metric for a period (overview table, tiles) */
  function snap(p, S) {
    if (!p) return null;
    var b = get('base', p, S.pid), r = get('rv', p, S.pid), i = get('inv', p, S.pid), o = get('ops', p, S.pid);
    var x = {
      revenue: b.revenue, nights: b.nights, occ: b.occ, adr: b.adr, revpar: b.revpar, alos: b.alos, made: b.made, bookedValue: b.bookedValue, lead: b.lead,
      cancelRate: b.cancelRate, foreign: b.foreign, direct: b.direct, rating: r.rating, reviews: r.n, respRate: r.respRate, replyDays: r.replyDays,
      invoices: i.n, paidRate: i.paidRate, overdue: i.overdue, collect: i.collect, onTime: o.onTime, turn: o.turn, deps: o.deps
    };
    if (S.money) { var c = get('cost', p, S.pid); x.opex = c.opex; x.capex = c.capex; x.opexShare = ratio(c.opex, b.revenue); }
    return x;
  }

  /* ------------------------------------------------------------------ building blocks */
  function tile(key, cur, prev, S, extra) {
    var m = MET[key], o = extra || {};
    var opts = { kind: m.kind, invert: m.invert, neutral: m.neutral, f: m.f, eps: m.eps };
    var none = cur == null || (typeof cur === 'number' && isNaN(cur));
    if (none && !o.sub) { o.noCmp = true; o.sub = o.none || 'No data in this range'; }
    var sub = S.c1 && prev !== undefined && !o.noCmp ? dl(cur, prev, opts) + ' vs ' + esc(S.c1.tag) : (o.sub || (S.c1 ? '' : 'No earlier period'));
    if (o.after) sub += '<span class="st-after">' + o.after + '</span>';
    return {
      key: key, label: o.label || m.label, value: o.value || esc(fv(m.type, cur)), sub: sub, hl: o.hl, title: (o.title || m.title || '') + (S.c1 && !o.noCmp ? '. Compared with ' + S.c1.label + (prev != null ? ' (' + fv(m.type, prev) + ')' : '') + '.' : ''),
      csv: [o.label || m.label, o.text != null ? o.text : fv(m.type, cur).replace(' ★', ''), o.noCmp ? '' : fv(m.type, prev).replace(' ★', ''), o.noCmp ? '' : dlText(cur, prev, opts)]
    };
  }
  function card(o) { /* {title, sub, legend, body, cls, flush, foot} */
    return '<div class="card st-card ' + (o.cls || '') + '"><div class="card-head"><div class="hd"><h3>' + esc(o.title) + '</h3>' + (o.sub ? '<div class="sub">' + esc(o.sub) + '</div>' : '') + '</div>' + (o.legend || '') + '</div>' +
      '<div class="card-body' + (o.flush ? ' flush' : '') + '">' + o.body + '</div>' + (o.foot ? '<div class="card-foot">' + o.foot + '</div>' : '') + '</div>';
  }
  function chartSlot(id) { return '<div class="st-chart" data-chart="' + id + '"></div>'; }
  function legend(S, n, square) {
    var items = [{ name: S.r.short, tone: 'brand', square: square }];
    if (n >= 2 && S.c1) items.push({ name: S.c1.short, tone: 'prev1', square: square });
    if (n >= 3 && S.c2) items.push({ name: S.c2.short, tone: 'prev2', square: square });
    return items.length > 1 ? O.chart.legend(items) : '';
  }
  function vals(bk, fn) { return bk ? bk.map(function (x) { return x ? fn(x.a, x.b) : null; }) : null; }
  function chartH() { return window.innerWidth <= 560 ? 210 : 240; }
  function tipFor(S) { return function (i) { var t = bucketTitle(S.bk[i]); if (S.bk1 && S.bk1[i]) t += ' vs ' + bucketShort(S.bk1[i]); return t; }; }
  /* current vs previous period, bars */
  function cmpBars(el, S, fn, o) {
    var cur = vals(S.bk, fn), prev = vals(S.bk1, fn);
    var series = [{ name: S.r.short, values: cur, tone: 'brand' }];
    if (prev) series.unshift({ name: S.c1.short, values: prev, tone: 'prev1' });
    O.chart.bars(el, { labels: S.bk.map(function (x) { return x.label; }), series: series, height: chartH(), yFormat: o.yFormat, tipTitle: tipFor(S), ariaLabel: o.aria });
  }
  /* current vs previous period, line */
  function cmpLine(el, S, fn, o) {
    var cur = vals(S.bk, fn), prev = vals(S.bk1, fn);
    var series = [{ name: S.r.short, values: cur, tone: 'brand', width: 2.4 }];
    if (prev) series.push({ name: S.c1.short, values: prev, tone: 'prev1' });
    O.chart.line(el, { labels: S.bk.map(function (x) { return x.label; }), series: series, height: chartH(), yFormat: o.yFormat, yMin: o.yMin, yMax: o.yMax, area: true, markers: S.bk.length <= 16 ? 'all' : undefined, tipTitle: tipFor(S), ariaLabel: o.aria });
  }
  function hb(rows, o) { return rows.length ? '<div class="st-hb">' + O.chart.hbars(rows, o) + '</div>' : U.empty('Nothing in this range'); }
  function stackHb(rows, max) { /* hbars with stacked parts, 2px gaps between the parts */
    return '<div class="st-hb">' + rows.map(function (r) {
      return '<div class="hbar"><div class="hb-label">' + r.label + '</div><div class="hb-track st-stack">' + r.parts.map(function (p) { return p.v ? '<div class="hb-fill" style="width:' + (p.v / max * 100).toFixed(1) + '%;background:' + O.chart.toneColor(p.tone) + '"></div>' : ''; }).join('') + '</div><div class="hb-val">' + r.display + '</div></div>';
    }).join('') + '</div>';
  }
  function propCell(p) { /* the short name on phones keeps the sticky first column narrow */
    var sh = p.short && p.short !== p.name;
    return { html: '<span class="row-flex" title="' + esc(p.name) + '"><span class="prop-dot" style="background:' + U.propColor(p.id) + '"></span><span' + (sh ? ' class="st-long"' : '') + '>' + esc(p.name) + '</span>' + (sh ? '<span class="st-short">' + esc(p.short) + '</span>' : '') + '</span>', text: p.name };
  }
  function shareTxt(n, tot) { return tot ? fmt.pct(n / tot) : '–'; }
  function money(S) { return S.money; }

  /* table: {cols:[{label, type, title}], rows:[[cells] | {group}], foot:[cells]} ; cells: number | {html,text} | {v,t} | {cur,prev,kind...} for 'chg' */
  function isNum(c) { return c.type !== 'text'; }
  function cellHTML(c, v) {
    if (c.type === 'chg') return v ? dl(v.cur, v.prev, v) : '';
    if (v && typeof v === 'object' && 't' in v) return esc(fv(v.t, v.v));
    if (c.type === 'text') return v && typeof v === 'object' ? v.html : esc(v == null ? '' : v);
    return esc(fv(c.type, v));
  }
  function cellText(c, v, pretty) {
    if (c.type === 'chg') return v ? dlText(v.cur, v.prev, v) : '';
    if (v && typeof v === 'object' && 't' in v) return pretty ? fv(v.t, v.v) : fc(v.t, v.v);
    if (c.type === 'text') return v && typeof v === 'object' ? v.text : (v == null ? '' : String(v));
    return pretty ? fv(c.type, v) : fc(c.type, v);
  }
  function tableHTML(t) {
    var n = t.cols.length;
    var row = function (cells, tag) { return t.cols.map(function (c, i) { return '<' + tag + (isNum(c) ? ' class="num"' : '') + '>' + cellHTML(c, cells[i]) + '</' + tag + '>'; }).join(''); };
    return '<div class="table-wrap"><table class="table st-table"><thead><tr>' + t.cols.map(function (c) { return '<th' + (isNum(c) ? ' class="num"' : '') + (c.title ? ' title="' + esc(c.title) + '"' : '') + '>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      t.rows.map(function (r) { return Array.isArray(r) ? '<tr>' + row(r, 'td') + '</tr>' : '<tr class="grp"><td colspan="' + n + '">' + esc(r.group) + '</td></tr>'; }).join('') + '</tbody>' +
      (t.foot ? '<tfoot><tr>' + row(t.foot, 'td') + '</tr></tfoot>' : '') + '</table></div>';
  }
  function prune(t, S) { /* without a comparison period, drop its columns (and their cells) */
    if (!t || (S.c1 && S.c2)) return t;
    var keep = t.cols.map(function (c) { return S.c1 ? !c.cmp2 : !(c.type === 'chg' || c.cmp || c.cmp2); });
    var pick = function (r) { return r.filter(function (x, i) { return keep[i]; }); };
    t.cols = pick(t.cols);
    t.rows = t.rows.map(function (r) { return Array.isArray(r) ? pick(r) : r; });
    if (t.foot) t.foot = pick(t.foot);
    return t;
  }
  function tableCard(t) { return card({ title: t.title, sub: t.sub, body: tableHTML(t), flush: true, cls: 'st-tcard', foot: t.note ? esc(t.note) : '' }); }

  /* empty states: one sentence + the main action */
  function emptyCard(msg, btn, page, act) {
    var b = btn && (act || O.allowed(page)) ? '<button type="button" class="btn btn-primary btn-sm" ' + (act ? 'data-act="' + act + '"' : 'data-go="' + page + '"') + '>' + esc(btn) + '</button>' : '';
    return '<div class="card st-empty">' + U.empty(msg, O.icon('statistics', 'st-eic')) + (b ? '<div class="st-empty-act">' + b + '</div>' : '') + '</div>';
  }
  function rangeEmpty(what) {
    return emptyCard('No ' + what + ' in ' + st.rangeLabel + '. Try a longer date range.', st.preset === 'since' ? null : 'Show all data', null, 'all');
  }
  function noProperties() { return emptyCard('Add your first property to start collecting statistics. Occupancy, revenue, bookings and guests show here as bookings come in.', 'Add your first property', 'properties'); }
  function noBookings() { return emptyCard('No bookings yet. Statistics fill in as soon as the first bookings arrive.', 'Add a booking', 'bookings'); }

  /* ------------------------------------------------------------------ tabs */
  var TAB = {};

  /* Overview: headline tiles, the running total vs the two comparison periods, and the metric table (the old Dashboard hero) */
  TAB.overview = function (S) {
    if (!D.properties.length) return { empty: noProperties() };
    if (!D.bookings.length) return { empty: noBookings() };
    var X = [snap(S.r, S), snap(S.c1, S), snap(S.c2, S)], cur = X[0], p1 = X[1] || {};
    var b0 = get('base', S.r, S.pid);
    if (!b0.nights && !b0.madeAll.length && !get('rv', S.r, S.pid).n) return { empty: rangeEmpty('stays, bookings or reviews') };
    var mon = S.money;
    var kpis = [
      mon ? tile('revenue', cur.revenue, p1.revenue, S, { hl: true }) : tile('nights', cur.nights, p1.nights, S, { hl: true }),
      tile('occ', cur.occ, p1.occ, S),
      mon ? tile('adr', cur.adr, p1.adr, S) : tile('alos', cur.alos, p1.alos, S),
      tile('made', cur.made, p1.made, S),
      tile('rating', cur.rating, p1.rating, S),
      tile('cancelRate', cur.cancelRate, p1.cancelRate, S)
    ];
    var fn = mon ? function (a, b) { return M.revenue(a, b, S.pid ? { propertyId: S.pid } : null); } : function (a, b) { return M.nightsSold(a, b, S.pid ? { propertyId: S.pid } : null); };
    var cmpTxt = S.c1 ? ' vs ' + S.c1.short + (S.c2 ? ' and ' + S.c2.short : '') : '';
    var u = unitWord(S.bk);
    var chart = !S.c1 ? {
      title: (mon ? 'Revenue' : 'Nights sold') + ' per ' + u, sub: (mon ? 'Earned on nights stayed, ' : 'Nights stayed, ') + S.r.label, body: chartSlot('per'), cls: 'st-wide',
      draw: function (el) { cmpBars(el, S, fn, { yFormat: mon ? moneyAxis : countAxis, aria: (mon ? 'Revenue' : 'Nights sold') + ' per ' + u }); }
    } : {
      title: mon ? 'Revenue, running total' : 'Nights sold, running total',
      sub: (mon ? 'Earned on nights stayed, ' : 'Nights stayed, ') + S.r.short + cmpTxt,
      legend: legend(S, 3), body: chartSlot('run'), cls: 'st-wide',
      draw: function (el) {
        var run = function (bk) { if (!bk) return null; var acc = 0; return bk.map(function (x) { if (!x) return null; acc += fn(x.a, x.b); return acc; }); };
        var series = [{ name: S.r.short, values: run(S.bk), tone: 'brand', width: 2.6 }];
        if (S.bk1) series.push({ name: S.c1.short, values: run(S.bk1), tone: 'prev1' });
        if (S.bk2) series.push({ name: S.c2.short, values: run(S.bk2), tone: 'prev2' });
        O.chart.line(el, {
          labels: S.bk.map(function (x) { return x.label; }), series: series, height: window.innerWidth <= 560 ? 230 : 280, area: true,
          yFormat: mon ? moneyAxis : countAxis, markers: S.bk.length <= 16 ? 'all' : 'none', ariaLabel: chart.title,
          tipTitle: function (i) { var t = 'By ' + bucketShort(S.bk[i]).replace(/^.* – /, ''); if (S.bk1 && S.bk1[i]) t += ' vs ' + bucketShort(S.bk1[i]).replace(/^.* – /, ''); if (S.bk2 && S.bk2[i]) t += ', ' + bucketShort(S.bk2[i]).replace(/^.* – /, ''); return t; }
        });
      }
    };
    /* metric table: current, the two comparison periods and the changes */
    var P = [S.r, S.c1, S.c2];
    var cols = [{ label: 'Metric', type: 'text' }].concat(P.map(function (p, i) { return { label: p ? p.short : (i === 1 ? 'Previous' : 'Before that'), type: 'auto', cmp: i === 1, cmp2: i === 2 }; }))
      .concat([{ label: 'vs ' + (S.c1 ? S.c1.tag : 'previous'), type: 'chg' }, { label: 'vs ' + (S.c2 ? S.c2.tag : 'before that'), type: 'chg', cmp2: true }]);
    function row(k) {
      var m = MET[k], o = { kind: m.kind, invert: m.invert, neutral: m.neutral, f: m.f, eps: m.eps };
      return [{ html: '<span title="' + esc(m.title || '') + '">' + esc(m.label) + '</span>', text: m.label + (F[m.type] ? F[m.type][2] : '') }]
        .concat(X.map(function (x) { return x ? { v: x[k], t: m.type } : null; }))
        .concat([X[1] ? Object.assign({ cur: cur[k], prev: X[1][k] }, o) : null, X[2] ? Object.assign({ cur: cur[k], prev: X[2][k] }, o) : null]);
    }
    var rows = [{ group: 'Stays' }];
    (mon ? ['revenue', 'nights', 'occ', 'adr', 'revpar', 'alos'] : ['nights', 'occ', 'alos']).forEach(function (k) { rows.push(row(k)); });
    rows.push({ group: 'Bookings made' });
    (mon ? ['made', 'bookedValue', 'lead', 'cancelRate', 'direct'] : ['made', 'lead', 'cancelRate', 'direct']).forEach(function (k) { rows.push(row(k)); });
    rows.push({ group: 'Guests and reviews' });
    ['foreign', 'rating', 'reviews', 'respRate'].forEach(function (k) { rows.push(row(k)); });
    rows.push({ group: 'Invoices' });
    ['invoices', 'paidRate', 'overdue'].forEach(function (k) { rows.push(row(k)); });
    rows.push({ group: 'Operations' });
    ['deps', 'onTime', 'turn'].forEach(function (k) { rows.push(row(k)); });
    if (mon) { rows.push({ group: 'Costs' }); ['opex', 'capex', 'opexShare'].forEach(function (k) { rows.push(row(k)); }); }
    return {
      kpis: kpis, cards: [chart],
      table: { title: 'All metrics', sub: S.c1 ? S.r.short + ' compared with ' + S.c1.long + (S.c2 ? ' and ' + S.c2.long : '') : S.r.label, cols: cols, rows: rows }
    };
  };

  /* Revenue & occupancy */
  TAB.revenue = function (S) {
    if (!D.properties.length) return { empty: noProperties() };
    if (!D.bookings.length) return { empty: noBookings() };
    var b0 = get('base', S.r, S.pid), b1 = get('base', S.c1, S.pid) || {};
    var w0 = get('week', S.r, S.pid), w1 = get('week', S.c1, S.pid) || {};
    var a0 = get('ahead', S.r, S.pid), a1 = S.c1 && S.c1.to < a0.asOf ? get('ahead', S.c1, S.pid) : null;
    if (!b0.nights && !b0.avail) return { empty: rangeEmpty('available nights') };
    var mon = S.money, f = S.pid ? { propertyId: S.pid } : null;
    var aheadOpts = { label: 'Next 30 nights booked', title: 'Nights ' + d.fmtRange(a0.from, a0.to) + ' already booked on ' + d.fmt(a0.asOf) + (a1 ? ', compared with what was booked for ' + d.fmtRange(a1.from, a1.to) + ' on ' + d.fmt(a1.asOf) : '') };
    var kpis = mon ? [
      tile('revenue', b0.revenue, b1.revenue, S, { hl: true }),
      tile('adr', b0.adr, b1.adr, S),
      tile('revpar', b0.revpar, b1.revpar, S),
      tile('occ', b0.occ, b1.occ, S),
      tile('weekend', w0.weekend, w1.weekend, S),
      tile('revenue', a0.revenue, a1 ? a1.revenue : undefined, S, Object.assign(a1 ? { after: fmt.pct(a0.occ) + ' full' } : { noCmp: true, sub: fmt.pct(a0.occ) + ' of nights full' }, aheadOpts))
    ] : [
      tile('occ', b0.occ, b1.occ, S, { hl: true }),
      tile('nights', b0.nights, b1.nights, S),
      tile('weekend', w0.weekend, w1.weekend, S),
      tile('occ', w0.weekday, w1.weekday, S, { label: 'Weekday occupancy', title: 'Occupancy of Sunday to Thursday nights' }),
      tile('alos', b0.alos, b1.alos, S),
      tile('occ', a0.occ, a1 ? a1.occ : undefined, S, Object.assign(a1 ? { after: fmt.plural(a0.nights, 'night') + ' booked' } : { noCmp: true, sub: fmt.plural(a0.nights, 'night') + ' booked' }, aheadOpts))
    ];
    var u = unitWord(S.bk);
    /* one unit is either full or empty on a given night, so its occupancy reads better per week */
    var So = S;
    if (S.pid && u === 'day' && S.r.days >= 14) { So = Object.assign({}, S, { bk: buckets(S.r, 'week') }); So.bk1 = align(So.bk, S.c1); }
    var uo = unitWord(So.bk);
    var cards = [
      mon ? { title: 'Revenue per ' + u, sub: 'Earned on nights stayed', legend: legend(S, 2, true), body: chartSlot('rev'), draw: function (el) { cmpBars(el, S, function (a, b) { return M.revenue(a, b, f); }, { yFormat: moneyAxis, aria: 'Revenue per ' + u }); } }
        : { title: 'Nights sold per ' + u, sub: 'Nights with a guest', legend: legend(S, 2, true), body: chartSlot('nts'), draw: function (el) { cmpBars(el, S, function (a, b) { return M.nightsSold(a, b, f); }, { yFormat: countAxis, aria: 'Nights sold per ' + u }); } },
      { title: 'Occupancy per ' + uo, sub: 'Share of available nights that were sold', legend: legend(S, 2), body: chartSlot('occ'), draw: function (el) { cmpLine(el, So, function (a, b) { var av = M.availableNights(a, b, S.pid || undefined); return av ? M.nightsSold(a, b, f) / av : null; }, { yFormat: pctAxis, yMin: 0, yMax: 1, aria: 'Occupancy per ' + uo }); } }
    ];
    var table;
    if (!S.pid) {
      var cols = [{ label: 'Property', type: 'text' }];
      if (mon) cols.push({ label: 'Revenue', type: 'money' }, { label: 'vs ' + (S.c1 ? S.c1.tag : 'previous'), type: 'chg' });
      cols.push({ label: 'Nights', type: 'num' }, { label: 'Occupancy', type: 'pct' }, { label: 'vs ' + (S.c1 ? S.c1.tag : 'previous'), type: 'chg' });
      if (mon) cols.push({ label: 'ADR', type: 'money' }, { label: 'RevPAR', type: 'money' });
      cols.push({ label: 'Avg stay', type: 'dec1', title: 'Average nights of stays arriving in the range' }, { label: 'Blocked', type: 'num', title: 'Nights blocked for owner stays or maintenance' });
      var rows = D.properties.filter(function (p) { var x = get('base', S.r, p.id); return !p.archived || x.nights || x.revenue; }).map(function (p) {
        var x = get('base', S.r, p.id), y = S.c1 ? get('base', S.c1, p.id) : null;
        var r = [propCell(p)];
        if (mon) r.push(x.revenue, y ? { cur: x.revenue, prev: y.revenue } : null);
        r.push(x.nights, x.occ, y ? { cur: x.occ, prev: y.occ, kind: 'pts' } : null);
        if (mon) r.push(x.adr, x.revpar);
        r.push(x.alos, x.blocked);
        return { r: r, sort: mon ? x.revenue : x.occ };
      }).sort(function (a, b) { return (b.sort || 0) - (a.sort || 0); }).map(function (x) { return x.r; });
      var foot = [{ html: 'All properties', text: 'All properties' }];
      if (mon) foot.push(b0.revenue, S.c1 ? { cur: b0.revenue, prev: b1.revenue } : null);
      foot.push(b0.nights, b0.occ, S.c1 ? { cur: b0.occ, prev: b1.occ, kind: 'pts' } : null);
      if (mon) foot.push(b0.adr, b0.revpar);
      foot.push(b0.alos, b0.blocked);
      table = { title: 'By property', sub: (mon ? 'Highest revenue first' : 'Highest occupancy first') + ', ' + S.r.label, cols: cols, rows: rows, foot: foot };
    } else {
      var cols2 = [{ label: u.charAt(0).toUpperCase() + u.slice(1), type: 'text' }];
      if (mon) cols2.push({ label: 'Revenue', type: 'money' });
      cols2.push({ label: 'Nights', type: 'num' }, { label: 'Available', type: 'num' }, { label: 'Occupancy', type: 'pct' });
      if (mon) cols2.push({ label: 'ADR', type: 'money' });
      var rows2 = S.bk.map(function (bk) {
        var rev = M.revenue(bk.a, bk.b, f), n = M.nightsSold(bk.a, bk.b, f), av = M.availableNights(bk.a, bk.b, S.pid);
        var r = [{ html: esc(bucketTitle(bk)), text: bucketTitle(bk) }];
        if (mon) r.push(rev);
        r.push(n, av, ratio(n, av));
        if (mon) r.push(ratio(rev, n));
        return r;
      });
      table = { title: 'By ' + u, sub: S.prop.name + ', ' + S.r.label, cols: cols2, rows: rows2 };
    }
    return { kpis: kpis, cards: cards, table: table };
  };

  /* Bookings & guests: bookings made in the range (channel, lead time, cancellations) and guests arriving in it (countries, stay length) */
  TAB.bookings = function (S) {
    if (!D.properties.length) return { empty: noProperties() };
    if (!D.bookings.length) return { empty: noBookings() };
    var b0 = get('base', S.r, S.pid), b1 = get('base', S.c1, S.pid) || {};
    if (!b0.madeAll.length && !b0.arr.length) return { empty: rangeEmpty('bookings made or arrivals') };
    var mon = S.money;
    var kpis = [
      tile('made', b0.made, b1.made, S, { hl: true, after: b0.cancelled ? 'Plus ' + b0.cancelled + ' cancelled' : '' }),
      tile('cancelRate', b0.cancelRate, b1.cancelRate, S),
      tile('lead', b0.lead, b1.lead, S),
      tile('alos', b0.alos, b1.alos, S),
      tile('foreign', b0.foreign, b1.foreign, S),
      tile('direct', b0.direct, b1.direct, S)
    ];
    var made = b0.madeLive, madePrev = b1.madeLive || [];
    var chRows = D.channelOrder.map(function (ch) {
      var n = made.filter(function (b) { return b.channel === ch; }).length, n1 = madePrev.filter(function (b) { return b.channel === ch; }).length;
      return { label: U.plat(ch), value: n, display: '<b>' + shareTxt(n, made.length) + '</b> <span class="xs muted">' + n + '</span>', share: ratio(n, made.length), share1: ratio(n1, madePrev.length) };
    }).filter(function (r) { return r.value || r.share1; }).sort(function (a, b) { return b.value - a.value; });
    var countries = {};
    b0.arr.forEach(function (b) { var c = countryOf(b); countries[c] = (countries[c] || 0) + 1; });
    var cList = Object.keys(countries).map(function (c) { return { c: c, n: countries[c] }; }).sort(function (a, b) { return b.n - a.n || (a.c < b.c ? -1 : 1); });
    var top = cList.slice(0, 7), rest = cList.slice(7);
    if (rest.length) top.push({ c: 'Other (' + rest.length + ')', n: sum(rest, function (x) { return x.n; }) });
    function bucketRows(list, defs, fn, list1) {
      return defs.map(function (k) {
        var t = inBucket(k[0], k[1]), n = list.filter(function (b) { return t(fn(b)); }).length, n1 = list1 ? list1.filter(function (b) { return t(fn(b)); }).length : null;
        return { label: esc(k[2]), value: n, display: n + (n1 != null ? ' <span class="xs muted">(' + (n - n1 >= 0 ? '+' : '−') + Math.abs(n - n1) + ')</span>' : '') };
      });
    }
    var cmpNote = S.c1 ? 'Brackets show the change from ' + S.c1.short + '.' : '';
    var cards = [
      { title: 'Channel mix', sub: 'Share of the ' + fmt.plural(made.length, 'booking') + ' made, ' + S.r.short, body: hb(chRows, {}) },
      { title: 'Guest countries', sub: 'Arrivals ' + S.r.short + ' (' + b0.arr.length + ')', body: hb(top.map(function (x) { return { label: esc(x.c), value: x.n, display: '<b>' + x.n + '</b> <span class="xs muted">' + shareTxt(x.n, b0.arr.length) + '</span>' }; }), {}) },
      {
        title: 'Booking window and stay length', sub: cmpNote || 'Bookings made and arrivals in the range',
        body: '<div class="st-sub-h">How far ahead they booked</div>' + hb(bucketRows(made, LEAD, leadDays, S.c1 ? madePrev : null), {}) +
          '<div class="st-sub-h">Length of stay (arrivals)</div>' + hb(bucketRows(b0.arr, LOS, function (b) { return b.nights; }, S.c1 ? b1.arr : null), {})
      }
    ];
    /* table by channel */
    var cols = [{ label: 'Channel', type: 'text' }, { label: 'Bookings', type: 'num' }, { label: 'Share', type: 'pct' }, { label: 'vs ' + (S.c1 ? S.c1.tag : 'previous'), type: 'chg', title: 'Change in share, percentage points' },
      { label: 'Cancelled', type: 'num' }, { label: 'Cancel rate', type: 'pct' }, { label: 'Avg lead', type: 'days' }, { label: 'Avg stay', type: 'dec1' }];
    if (mon) cols.push({ label: 'Value booked', type: 'money' }, { label: 'Fees', type: 'money', title: 'Platform commission and payment fees on the bookings made' });
    var rows = D.channelOrder.map(function (ch) {
      var all = b0.madeAll.filter(function (b) { return b.channel === ch; }), lv = all.filter(live);
      var s1 = S.c1 ? ratio(madePrev.filter(function (b) { return b.channel === ch; }).length, madePrev.length) : null;
      var r = [{ html: U.plat(ch), text: U.platName(ch) }, lv.length, ratio(lv.length, made.length), S.c1 ? { cur: ratio(lv.length, made.length), prev: s1, kind: 'pts', neutral: true } : null,
        all.length - lv.length, ratio(all.length - lv.length, all.length), avg(lv, leadDays), avg(lv, function (b) { return b.nights; })];
      if (mon) r.push(sum(lv, function (b) { return b.revenue; }), sum(lv, function (b) { return b.platformFee; }));
      return { r: r, n: all.length };
    }).filter(function (x) { return x.n; }).sort(function (a, b) { return b.r[1] - a.r[1]; }).map(function (x) { return x.r; });
    var foot = [{ html: 'All channels', text: 'All channels' }, made.length, made.length ? 1 : null, null, b0.cancelled, b0.cancelRate, b0.lead, avg(made, function (b) { return b.nights; })];
    if (mon) foot.push(b0.bookedValue, sum(made, function (b) { return b.platformFee; }));
    return { kpis: kpis, cards: cards, grid: 'g3', table: { title: 'By channel', sub: 'Bookings made ' + S.r.label, cols: cols, rows: rows, foot: foot } };
  };

  /* Reviews: rating trend, category scores, by platform, response rate and time */
  TAB.reviews = function (S) {
    if (!D.reviews.length) return { empty: emptyCard('No reviews yet. Ratings, reply rates and reply times show here once guests review their stays.', 'Open reviews', 'reviews') };
    var r0 = get('rv', S.r, S.pid), r1 = get('rv', S.c1, S.pid) || {};
    if (!r0.n) return { empty: rangeEmpty('reviews') };
    var kpis = [
      tile('rating', r0.rating, r1.rating, S, { hl: true }),
      tile('reviews', r0.n, r1.n, S),
      tile('respRate', r0.respRate, r1.respRate, S),
      tile('replyDays', r0.replyDays, r1.replyDays, S),
      tile('five', r0.five, r1.five, S),
      tile('low', r0.low, r1.low, S)
    ];
    /* trend: at least 12 weeks so there is a shape, ending on the last day of the range */
    var tFrom = d.add(S.r.to, -83) < S.r.from ? d.add(S.r.to, -83) : S.r.from, ds = dataStart();
    if (tFrom < ds) tFrom = ds;
    var tr = { from: tFrom, to: S.r.to }, tn = d.diff(tFrom, S.r.to) + 1, tb = buckets(tr, tn <= 200 ? 'week' : 'month');
    var revIn = function (a, b) { return D.reviews.filter(function (x) { return x.date >= a && x.date <= b && (!S.pid || x.propertyId === S.pid); }); };
    var trend = tb.map(function (bk) { var l = revIn(bk.a, bk.b); return { bk: bk, n: l.length, v: avg(l, function (x) { return x.stars; }) }; });
    var minV = Math.min.apply(null, trend.filter(function (x) { return x.v != null; }).map(function (x) { return x.v; }).concat([5]));
    var subRows = SUBS.map(function (s) {
      var v = r0.subs[s[0]], p = r1.subs ? r1.subs[s[0]] : null;
      return { label: esc(s[1]), value: v || 0, display: '<b>' + (v != null ? v.toFixed(2) : '–') + '</b>' + (S.c1 ? ' ' + dl(v, p, { kind: 'abs', f: r2 }) : '') };
    });
    var starRows = [5, 4, 3, 2, 1].map(function (k) {
      var n = r0.list.filter(function (x) { return x.stars === k; }).length;
      return { label: k + ' ★', value: n, display: '<b>' + n + '</b> <span class="xs muted">' + shareTxt(n, r0.n) + '</span>', tone: k <= 3 ? 'bad' : undefined };
    });
    var weakest = SUBS.slice().sort(function (a, b) { return (r0.subs[a[0]] || 9) - (r0.subs[b[0]] || 9); })[0];
    var cards = [
      {
        title: 'Rating trend', sub: 'Average stars per ' + (tb[0] && tb[0].kind === 'month' ? 'month' : 'week') + ', ' + d.fmtRange(tr.from, tr.to), body: chartSlot('trend'), cls: 'st-wide2',
        draw: function (el) {
          O.chart.line(el, {
            labels: trend.map(function (x) { return x.bk.label; }), series: [{ name: 'Average rating', values: trend.map(function (x) { return x.v; }), tone: 'brand', width: 2.4 }],
            height: window.innerWidth <= 560 ? 210 : 290, yMin: minV < 3 ? 1 : 3, yMax: 5, area: true, markers: 'all', ariaLabel: 'Average rating per week',
            yFormat: function (v, ax) { return ax ? v.toFixed(1) : v.toFixed(2) + ' ★'; },
            tipTitle: function (i) { return bucketTitle(trend[i].bk) + ' · ' + fmt.plural(trend[i].n, 'review'); }
          });
        }
      },
      {
        title: 'Scores and stars', sub: 'Category averages out of 5' + (S.c1 ? ', change vs ' + S.c1.short : '') + '. Weakest: ' + weakest[1].toLowerCase(),
        body: '<div class="st-sub-h">Category scores</div>' + hb(subRows, { max: 5 }) + '<div class="st-sub-h">Stars given</div>' + hb(starRows, { max: Math.max(1, r0.n) })
      }
    ];
    var plats = REVIEW_PLATS.slice();
    r0.list.concat(r1.list || []).forEach(function (x) { if (plats.indexOf(x.platform) < 0) plats.push(x.platform); });
    var cols = [{ label: 'Platform', type: 'text' }, { label: 'Reviews', type: 'num' }, { label: 'Avg rating', type: 'rating' }, { label: 'vs ' + (S.c1 ? S.c1.tag : 'previous'), type: 'chg' },
      { label: '3 stars or lower', type: 'num' }, { label: 'Response rate', type: 'pct' }, { label: 'Avg reply time', type: 'days' }, { label: 'Waiting for reply', type: 'num' }];
    var rows = plats.map(function (pl) {
      var l = r0.list.filter(function (x) { return x.platform === pl; }), l1 = (r1.list || []).filter(function (x) { return x.platform === pl; });
      if (!l.length) return null;
      var a = avg(l, function (x) { return x.stars; }), a1 = avg(l1, function (x) { return x.stars; }), rep = l.filter(function (x) { return x.reply; });
      return [{ html: U.plat(pl), text: U.platName(pl) }, l.length, a, S.c1 ? { cur: a, prev: a1, kind: 'abs', f: r2 } : null, l.filter(function (x) { return x.stars <= 3; }).length,
        ratio(rep.length, l.length), avg(rep.filter(function (x) { return x.reply.date; }), function (x) { return Math.max(0, d.diff(x.date, x.reply.date)); }), l.length - rep.length];
    }).filter(Boolean).sort(function (a, b) { return b[1] - a[1]; });
    var foot = [{ html: 'All platforms', text: 'All platforms' }, r0.n, r0.rating, S.c1 ? { cur: r0.rating, prev: r1.rating, kind: 'abs', f: r2 } : null, r0.low, r0.respRate, r0.replyDays, r0.n - r0.list.filter(function (x) { return x.reply; }).length];
    return { kpis: kpis, cards: cards, grid: 'g-3-2', table: { title: 'By platform', sub: 'Reviews left ' + S.r.label, cols: cols, rows: rows, foot: foot } };
  };

  /* Invoices & payments: sent, paid, overdue, collection time */
  TAB.invoices = function (S) {
    var any = D.bookings.some(function (b) { return b.invoiceNo; });
    if (!any) return { empty: emptyCard('No invoices yet. An invoice is created for every booking, so this fills in with your first booking.', 'Open invoices', 'invoices') };
    var i0 = get('inv', S.r, S.pid), i1 = get('inv', S.c1, S.pid) || {};
    if (!i0.n) return { empty: rangeEmpty('invoices') };
    var mon = S.money;
    var kpis = [
      tile('invoices', i0.n, i1.n, S, { hl: true, after: mon ? esc(fmt.money(i0.billed)) + ' billed' : '' }),
      tile('sentRate', i0.sentRate, i1.sentRate, S, { after: i0.sameDay + ' sent the same day' }),
      tile('paidRate', i0.paidRate, i1.paidRate, S, { after: mon ? esc(fmt.money(i0.collected)) + ' collected' : '' }),
      tile('unpaid', i0.unpaid, i1.unpaid, S, { after: mon ? esc(fmt.money(i0.outstanding)) + ' to collect' : '' }),
      tile('overdue', i0.overdue, i1.overdue, S, { after: mon && i0.overdue ? esc(fmt.money(i0.overdueAmt)) + ' overdue' : '' }),
      tile('collect', i0.collect, i1.collect, S, { label: 'Collection time (direct)', none: 'No direct invoices paid' })
    ];
    var u = unitWord(S.bk), byDate = function (a, b) { return bks(S.pid).filter(function (x) { return x.invoiceNo && live(x) && x.invoiceDate >= a && x.invoiceDate <= b; }).length; };
    var payRows = PAY.map(function (k) {
      var t = inBucket(k[0], k[1]), n = i0.paidList.filter(function (b) { return t(i0.payDays(b)); }).length;
      return { label: esc(k[2]), value: n, display: '<b>' + n + '</b> <span class="xs muted">' + shareTxt(n, i0.n) + '</span>' };
    });
    var waiting = i0.unpaidList.length - i0.overdueList.length;
    payRows.push({ label: 'Not due yet', value: waiting, display: '<b>' + waiting + '</b> <span class="xs muted">' + shareTxt(waiting, i0.n) + '</span>', tone: 'prev1' });
    payRows.push({ label: 'Overdue', value: i0.overdueList.length, display: '<b>' + i0.overdueList.length + '</b> <span class="xs muted">' + shareTxt(i0.overdueList.length, i0.n) + '</span>', tone: 'bad' });
    var cards = [
      { title: 'Invoices issued per ' + u, sub: 'One invoice per booking, by invoice date', legend: legend(S, 2, true), body: chartSlot('inv'), draw: function (el) { cmpBars(el, S, byDate, { yFormat: countAxis, aria: 'Invoices issued per ' + u }); } },
      { title: 'Time to payment', sub: 'From invoice to payment, ' + fmt.plural(i0.n, 'invoice') + ' dated ' + S.r.short, body: hb(payRows, { max: Math.max(1, i0.n) }) }
    ];
    var cols = [{ label: 'Channel', type: 'text' }, { label: 'Invoices', type: 'num' }, { label: 'Sent', type: 'pct' }, { label: 'Paid', type: 'pct' }, { label: 'Awaiting', type: 'num' }, { label: 'Overdue', type: 'num' }, { label: 'Avg days to pay', type: 'dec1' }];
    if (mon) cols.push({ label: 'Billed', type: 'money' }, { label: 'Collected', type: 'money' }, { label: 'Outstanding', type: 'money' });
    var tot = function (b) { return b.total; };
    var rows = D.channelOrder.map(function (ch) {
      var l = i0.list.filter(function (b) { return b.channel === ch; }); if (!l.length) return null;
      var paid = l.filter(function (b) { return b.paidAt; }), unpaid = l.filter(function (b) { return !b.paidAt; });
      var r = [{ html: U.plat(ch), text: U.platName(ch) }, l.length, ratio(l.filter(function (b) { return b.invoiceSent; }).length, l.length), ratio(paid.length, l.length), unpaid.length, l.filter(i0.isOverdue).length, avg(paid, i0.payDays)];
      if (mon) r.push(sum(l, tot), sum(paid, tot), sum(unpaid, tot));
      return r;
    }).filter(Boolean).sort(function (a, b) { return b[1] - a[1]; });
    var foot = [{ html: 'All channels', text: 'All channels' }, i0.n, i0.sentRate, i0.paidRate, i0.unpaid, i0.overdue, i0.collectAll];
    if (mon) foot.push(i0.billed, i0.collected, i0.outstanding);
    var dueDays = (D.invoiceSettings && +D.invoiceSettings.dueDays) || 7;
    return { kpis: kpis, cards: cards, table: { title: 'By channel', sub: 'Invoices dated ' + S.r.label, cols: cols, rows: rows, foot: foot, note: 'Direct bookings are due ' + fmt.plural(dueDays, 'day') + ' before arrival; platform bookings are collected by the platform when booked.' } };
  };

  /* Operations: turnovers, turnover time, tasks done on time, arrival readiness */
  TAB.operations = function (S) {
    if (!D.properties.length) return { empty: noProperties() };
    if (!D.tasks.length && !D.bookings.length) return { empty: emptyCard('No tasks or turnovers yet. Task timing and turnover times show here once the team starts working through tasks.', 'Open tasks', 'tasks') };
    var o0 = get('ops', S.r, S.pid), o1 = get('ops', S.c1, S.pid) || {};
    if (!o0.deps && !o0.tasksN) return { empty: rangeEmpty('turnovers or tasks') };
    /* readiness: arrivals in the next 7 days with every check green (clean, ID, door code) */
    var nx = bks(S.pid).filter(function (b) { return live(b) && b.checkIn >= D.TODAY && b.checkIn <= d.add(D.TODAY, 6); });
    var states = nx.map(function (b) { /* a clean not started yet or a code held for the ID check is fine before arrival day */
      try { return O.readiness(b).map(function (x) { return x.state === 'todo' && b.checkIn > D.TODAY && (x.key === 'clean' || (x.key === 'code' && b.codeStatus === 'held')) ? 'wait' : x.state; }); } catch (e) { return ['todo']; }
    });
    var action = states.filter(function (l) { return l.indexOf('todo') >= 0; }).length, ready = nx.length - action;
    var allOk = states.filter(function (l) { return l.every(function (x) { return x === 'ok'; }); }).length;
    var kpis = [
      tile('deps', o0.deps, o1.deps, S, { hl: true }),
      tile('b2b', o0.b2b, o1.b2b, S, { after: o0.b2bShare != null ? fmt.pct(o0.b2bShare) + ' of turnovers' : '' }),
      tile('turn', o0.turn, o1.turn, S, o0.turnN ? {} : { noCmp: true, sub: 'No finished turnovers yet' }),
      tile('onTime', o0.onTime, o1.onTime, S, o0.timed.length ? { after: o0.onTimeN + ' of ' + o0.timed.length } : { noCmp: true, sub: 'No tasks done yet' }),
      tile('tasksDone', o0.tasksDone, o1.tasksDone, S, { label: 'Tasks open', value: esc(String(o0.open.length)), text: String(o0.open.length), noCmp: true, sub: o0.overdueNow ? '<span class="delta bad">' + o0.overdueNow + ' overdue</span>' : 'None overdue', title: 'Tasks due in the range that are not done yet' }),
      { key: 'ready', label: 'Arrivals on track, 7 days', value: nx.length ? ready + '<small> of ' + nx.length + '</small>' : '–', sub: (!nx.length ? 'No arrivals in the next 7 days' : action ? '<span class="delta bad">' + action + ' need action</span>' : 'All on track') + (nx.length ? '<span class="st-after">' + allOk + ' fully ready now</span>' : ''), title: 'Arrivals in the next 7 days (from today, whatever the range) where the clean, ID check and door code are done or scheduled. Need action: on arrival day the clean is not booked or not started or the door code is held, or a door code has expired.', csv: ['Arrivals on track, next 7 days', nx.length ? ready + ' of ' + nx.length : '', '', ''] }
    ];
    var u = unitWord(S.bk);
    var depsIn = function (a, b) { return bks(S.pid).filter(function (x) { return live(x) && x.checkOut >= a && x.checkOut <= b; }).length; };
    /* tasks by team member (tasks due in the range) */
    var people = {};
    o0.tasks.forEach(function (t) { var k = t.assigneeId || ''; var p = people[k] || (people[k] = { id: k, done: 0, timed: 0, onTime: 0, open: 0, late: 0 }); if (t.status === 'done') { p.done++; if (t.doneAt && t.due) { p.timed++; if (t.doneAt <= t.due) p.onTime++; } } else if (t.due < D.NOW) p.late++; else p.open++; });
    var pList = Object.keys(people).map(function (k) { var p = people[k]; p.n = p.done + p.open + p.late; return p; }).sort(function (a, b) { return b.n - a.n || b.done - a.done; }).slice(0, 8);
    var pMax = Math.max.apply(null, pList.map(function (p) { return p.n; }).concat([1]));
    var pRows = pList.map(function (p) {
      return { label: '<span class="ellipsis">' + esc(staffName(p.id)) + '</span>', parts: [{ v: p.done, tone: 'brand' }, { v: p.late, tone: 'bad' }, { v: p.open, tone: 'prev2' }],
        display: '<b>' + p.done + ' of ' + p.n + '</b> <span class="xs muted st-hide-sm">' + (p.timed ? fmt.pct(p.onTime / p.timed) + ' on time' : 'done') + '</span>' };
    });
    var cards = [
      { title: 'Turnovers per ' + u, sub: 'Check-outs, each one a unit to turn around', legend: legend(S, 2, true), body: chartSlot('dep'), draw: function (el) { cmpBars(el, S, depsIn, { yFormat: countAxis, aria: 'Turnovers per ' + u }); } },
      { title: 'Tasks by team member', sub: fmt.plural(o0.tasksN, 'task') + ' due ' + S.r.short, legend: O.chart.legend([{ name: 'Done', tone: 'brand', square: true }, { name: 'Overdue', tone: 'bad', square: true }, { name: 'Not due yet', tone: 'prev2', square: true }]), body: pRows.length ? stackHb(pRows, pMax) : U.empty('No tasks due in this range') }
    ];
    var cols = [{ label: 'Property', type: 'text' }, { label: 'Turnovers', type: 'num' }, { label: 'Back-to-back', type: 'num' }, { label: 'Avg window', type: 'dur', title: 'Time between check-out and the next check-in on back-to-back days' },
      { label: 'Avg turnover time', type: 'dur', title: 'From check-out to the clean done or the restock logged' }, { label: 'Tasks done', type: 'num' }, { label: 'On time', type: 'pct' }, { label: 'Open tasks', type: 'num' }];
    var props = S.pid ? [S.prop] : D.properties.filter(function (p) { var x = get('ops', S.r, p.id); return !p.archived || x.deps || x.tasksN; });
    var rows = props.map(function (p) {
      var x = get('ops', S.r, p.id);
      return [propCell(p), x.deps, x.b2b, x.window, x.turn, x.done.length, x.onTime, x.open.length];
    }).sort(function (a, b) { return (b[1] || 0) - (a[1] || 0); });
    var foot = S.pid ? null : [{ html: 'All properties', text: 'All properties' }, o0.deps, o0.b2b, o0.window, o0.turn, o0.done.length, o0.onTime, o0.open.length];
    return { kpis: kpis, cards: cards, table: { title: 'By property', sub: 'Check-outs and tasks due ' + S.r.label, cols: cols, rows: rows, foot: foot, note: 'Turnover time runs from the guest\'s check-out time to the turnover clean marked done, or, without a task, to the restock logged in Inventory.' } };
  };

  /* Costs: operating vs capital spending (statistics.money only) */
  TAB.costs = function (S) {
    if (!S.money) return { empty: '<div class="card">' + U.locked('costs', { reason: 'permission' }) + '</div>' };
    if (!D.expenses.length) return { empty: emptyCard('No expenses recorded yet. Operating costs and capital spending show here once expenses are recorded.', 'Record an expense', 'expenses') };
    var c0 = get('cost', S.r, S.pid), c1 = get('cost', S.c1, S.pid) || {};
    var b0 = get('base', S.r, S.pid), b1 = get('base', S.c1, S.pid) || {};
    if (!c0.n) return { empty: rangeEmpty('expenses') };
    var kpis = [
      tile('opex', c0.opex, c1.opex, S, { hl: true }),
      tile('capex', c0.capex, c1.capex, S, { after: c0.capexList.length ? fmt.plural(c0.capexList.length, 'purchase') : '' }),
      tile('spend', c0.spend, c1.spend, S),
      tile('opexShare', ratio(c0.opex, b0.revenue), S.c1 ? ratio(c1.opex, b1.revenue) : undefined, S),
      tile('opexNight', ratio(c0.opex, b0.nights), S.c1 ? ratio(c1.opex, b1.nights) : undefined, S),
      tile('entries', c0.n, c1.n, S)
    ];
    var u = unitWord(S.bk);
    var opexIn = function (a, b) { return sum(M.expenses(a, b, 'opex').filter(function (e) { return !S.pid || e.propertyId === S.pid; }), function (e) { return e.amount; }); };
    var cap = c0.capexList.slice().sort(function (a, b) { return b.amount - a.amount; });
    var capBody = cap.length ? '<div class="st-list">' + cap.slice(0, 6).map(function (e) {
      return '<div class="list-row"><div class="lr-main"><div class="lr-title">' + esc(e.note || e.type) + '</div><div class="lr-sub">' + esc(d.fmt(e.date) + ' · ' + (e.propertyId ? propName(e.propertyId, true) : 'Company-wide') + ' · ' + e.type) + '</div></div><b class="tnum">' + esc(fmt.money(e.amount)) + '</b></div>';
    }).join('') + (cap.length > 6 ? '<div class="small muted" style="padding-top:8px">and ' + (cap.length - 6) + ' more, ' + esc(fmt.money(sum(cap.slice(6), function (e) { return e.amount; }))) + '</div>' : '') + '</div>'
      : U.empty('No capital spending in this range. Assets such as furniture and appliances show here.');
    var cards = [
      { title: 'Operating costs per ' + u, sub: 'Running costs, by expense date', legend: legend(S, 2, true), body: chartSlot('opex'), draw: function (el) { cmpBars(el, S, opexIn, { yFormat: moneyAxis, aria: 'Operating costs per ' + u }); } },
      { title: 'Capital spending', sub: (cap.length ? fmt.money(c0.capex) + ' on ' + fmt.plural(cap.length, 'purchase') : 'Assets that last years') + ', kept out of operating profit', body: capBody }
    ];
    var cols = [{ label: 'Expense type', type: 'text' }, { label: 'Cost type', type: 'text' }, { label: 'Entries', type: 'num' }, { label: 'Amount', type: 'money' }, { label: 'Share', type: 'pct' },
      { label: S.c1 ? S.c1.short : 'Previous', type: 'money', cmp: true }, { label: 'vs ' + (S.c1 ? S.c1.tag : 'previous'), type: 'chg' }];
    var types = Object.keys(c0.byType); Object.keys(c1.byType || {}).forEach(function (k) { if (types.indexOf(k) < 0) types.push(k); });
    var rows = types.map(function (k) {
      var p = c1.byType ? c1.byType[k] : null, t = c0.byType[k] || { type: p.type, cls: p.cls, amt: 0, n: 0 };
      return [t.type, { html: t.cls === 'capex' ? U.pill('Capital', 'info') : U.pill('Operating', 'neutral'), text: t.cls === 'capex' ? 'Capital expense' : 'Operating expense' }, t.n, t.amt, ratio(t.amt, c0.spend), S.c1 ? (p ? p.amt : 0) : null, S.c1 ? { cur: t.amt, prev: p ? p.amt : 0, invert: true } : null];
    }).sort(function (a, b) { return b[3] - a[3]; });
    var foot = [{ html: 'All expenses', text: 'All expenses' }, '', c0.n, c0.spend, c0.spend ? 1 : null, S.c1 ? c1.spend : null, S.c1 ? { cur: c0.spend, prev: c1.spend, invert: true } : null];
    return { kpis: kpis, cards: cards, table: { title: 'By expense type', sub: S.r.label + (S.pid ? ', ' + S.prop.name : ', including company-wide costs'), cols: cols, rows: rows, foot: foot } };
  };

  /* ------------------------------------------------------------------ export */
  function exportRows(m) {
    var S = m.S, rows = [['Statistics', tabName(m.tab)], ['Range', S.r.label], ['Property', S.prop ? S.prop.name : 'All properties'], ['Compared with', S.c1 ? S.c1.label : 'No comparison']];
    if (m.kpis && m.kpis.length) { rows.push([]); rows.push(['Metric', S.r.label, S.c1 ? S.c1.label : '', 'Change']); m.kpis.forEach(function (k) { rows.push(k.csv); }); }
    if (m.table) {
      var t = m.table;
      rows.push([]); rows.push([t.title + (t.sub ? ' (' + t.sub + ')' : '')]);
      rows.push(t.cols.map(function (c) { return c.label + (c.type !== 'text' && c.type !== 'chg' && c.type !== 'auto' && F[c.type] ? F[c.type][2] : ''); }));
      t.rows.forEach(function (r) { rows.push(Array.isArray(r) ? t.cols.map(function (c, i) { return cellText(c, r[i]); }) : [r.group]); });
      if (t.foot) rows.push(t.cols.map(function (c, i) { return cellText(c, t.foot[i]); }));
    }
    return rows;
  }
  function fileBase(m) { return 'statistics-' + m.tab + '-' + m.S.r.from + '-to-' + m.S.r.to + (m.S.prop ? '-' + m.S.prop.id : ''); }
  function exportCSV() {
    var m = st.model;
    if (!O.can('statistics.export')) { U.toast('Your access does not include downloading statistics', 'bad'); return; }
    if (!m || m.empty) { U.toast('Nothing to export for this range', 'bad'); return; }
    O.downloadCSV(fileBase(m) + '.csv', exportRows(m));
  }
  function exportPDF() {
    var m = st.model;
    if (!O.can('statistics.export')) { U.toast('Your access does not include downloading statistics', 'bad'); return; }
    if (!m || m.empty || !m.table) { U.toast('Nothing to export for this range', 'bad'); return; }
    var t = m.table, rows = [], star = function (x) { return String(x).replace(/ ?★/g, ''); };
    t.rows.forEach(function (r) { rows.push(Array.isArray(r) ? t.cols.map(function (c, i) { return star(cellText(c, r[i], true)); }) : [String(r.group).toUpperCase()]); });
    if (t.foot) rows.push(t.cols.map(function (c, i) { return star(cellText(c, t.foot[i], true)); }));
    /* column widths from the widest text in each column (Helvetica widths in em, 8.5 pt cells = 3 mm/em, bold 8 pt headers), on the 186 mm page */
    var em = function (x) { var w = 0; String(x).replace(/[−–]/g, '-').split('').forEach(function (ch) { w += /[0-9]/.test(ch) ? 0.556 : /[A-Z]/.test(ch) ? (/[MW]/.test(ch) ? 0.85 : 0.68) : /[a-z]/.test(ch) ? (/[mw]/.test(ch) ? 0.8 : /[ijlft]/.test(ch) ? 0.28 : 0.53) : /[ .,:']/.test(ch) ? 0.28 : 0.6; }); return w; };
    var need = t.cols.map(function (c, i) { var n = em(c.label) * 2.95; rows.forEach(function (r) { if (r.length > 1 && r[i] != null) n = Math.max(n, em(r[i]) * 3.1); }); return n + 3.5; });
    var total = need.reduce(function (a, b) { return a + b; }, 0);
    if (total > 186) { var cut = Math.min(total - 186, Math.max(0, need[0] - 30)); need[0] -= cut; total -= cut; }
    var k = 186 / total;
    var cols = t.cols.map(function (c, i) { return { label: c.label, w: need[i] * k, align: i && c.type !== 'text' ? 'right' : undefined }; });
    O.pdf.report({
      filename: fileBase(m) + '.pdf', title: 'Statistics: ' + tabName(m.tab), subtitle: m.S.r.label + (m.S.prop ? ' · ' + (m.S.prop.short || m.S.prop.name) : ''),
      summary: (m.kpis || []).slice(0, 8).map(function (k) { return [k.csv[0], star(k.csv[1] || '-')]; }),
      columns: cols, rows: rows, boldLast: !!t.foot,
      notes: t.title + '. ' + (m.S.c1 ? 'Compared with ' + m.S.c1.label + '. ' : '') + 'Revenue is accommodation plus cleaning fees; tourism tax is passed through and excluded.' + (t.note ? ' ' + t.note : '')
    });
  }

  /* ------------------------------------------------------------------ page */
  function save() {
    O.store.set('statistics:tab', st.tab);
    O.store.set('statistics:range', st.preset ? { preset: st.preset } : { from: st.from, to: st.to });
    O.store.set('statistics:property', st.pid || '');
  }
  function restore() {
    if (st.ready) return; st.ready = true;
    var t = O.store.get('statistics:tab', null); if (tabIndex(t) >= 0) st.tab = t;
    var rg = O.store.get('statistics:range', null);
    if (rg && rg.preset && PRESETS.indexOf(rg.preset) >= 0) st.preset = rg.preset;
    else if (rg && /^\d{4}-\d{2}-\d{2}$/.test(rg.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(rg.to || '')) { st.preset = null; st.from = rg.from; st.to = rg.to; }
    st.pid = O.store.get('statistics:property', '') || '';
  }
  function propOptions() { /* every property, archived ones too: statistics is history (marked, listed last) */
    var list = D.properties.filter(function (p) { return !p.archived; }).concat(D.properties.filter(function (p) { return p.archived; }));
    return '<option value="">All properties</option>' + list.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === st.pid ? ' selected' : '') + '>' + esc(p.name) + (p.archived ? ' (archived)' : '') + '</option>'; }).join('');
  }
  function allowedTab(id) { return id !== 'costs' || O.can('statistics.money'); }
  function cmpSentence(S) {
    if (!S.c1) return 'No comparison: the period before this one falls before your records start (' + d.fmtY(dataStart()) + ').';
    return 'Compared with ' + S.c1.long + ' (' + S.c1.short + ')' + (S.c2 ? ' and ' + S.c2.long + ' (' + S.c2.short + ')' : '') + '.';
  }

  O.page('statistics', {
    desc: 'In-depth analysis of revenue, occupancy, bookings, guests, reviews, invoices, operations and costs',
    render: function (root, ctx) {
      restore();
      var prm = ctx.params || {};
      if (ctx.fresh) {
        if (prm.tab && tabIndex(prm.tab) >= 0) st.tab = prm.tab;
        if (prm.preset && PRESETS.concat(['today', 'yesterday', 'thisMonth', 'lastMonthToDate']).indexOf(prm.preset) >= 0) { st.preset = prm.preset; }
        else if (prm.from && prm.to) { st.preset = null; st.from = prm.from; st.to = prm.to; }
        if (prm.propertyId != null) st.pid = prm.propertyId;
        if (prm.tab || prm.preset || prm.from || prm.propertyId != null) save();
      }
      if (st.pid && !D.propById[st.pid]) st.pid = '';
      var tab = allowedTab(st.tab) ? st.tab : 'overview';

      /* top bar: exports (statistics.export) */
      var canEx = O.can('statistics.export'), why = 'Your access does not include downloading statistics. An account owner can allow it in Staff Access.';
      var acts = ctx.setActions('<button type="button" class="btn btn-ghost btn-sm" data-st-ex="csv"' + (canEx ? ' title="Download this tab as CSV"' : ' disabled title="' + esc(why) + '"') + '>' + O.icon('download') + 'Export CSV</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-st-ex="pdf"' + (canEx ? ' title="Download this tab as PDF"' : ' disabled title="' + esc(why) + '"') + '>' + O.icon('file') + 'PDF</button>');
      O.$$('[data-st-ex]', acts).forEach(function (b) { b.onclick = function () { if (b.dataset.stEx === 'csv') exportCSV(); else exportPDF(); }; });

      var S = scope();
      st.rangeLabel = S.r.label;
      var hasProps = D.properties.length > 0;
      var propSel = '<label class="sr-only" for="st-prop">Property</label><select id="st-prop" class="select st-prop"' + (hasProps ? '' : ' disabled title="No properties yet"') + '>' + propOptions() + '</select>';
      var tabsHTML = TABS.map(function (t) {
        var ok = allowedTab(t[0]);
        return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === tab) + '" class="' + (t[0] === tab ? 'on' : '') + '"' + (ok ? '' : ' disabled title="Your access does not include money figures, so costs are hidden. An account owner can allow it in Staff Access."') + '>' + (ok ? '' : '<span aria-hidden="true">🔒 </span>') + esc(t[1]) + '</button>';
      }).join('');
      root.innerHTML = '<div class="pg-statistics">' +
        '<div class="st-bar"><span data-slot="range"></span>' + propSel + (hasProps && D.bookings.length ? '<div class="st-cmp">' + esc(cmpSentence(S)) + (S.r.note ? ' <span class="st-rnote">' + esc(S.r.note) + '</span>' : '') + '</div>' : '') + '</div>' +
        '<div class="st-tabs" role="tablist" aria-label="Statistics">' + tabsHTML + '</div>' +
        '<div class="st-body" role="tabpanel"></div></div>';
      var page = O.$('.pg-statistics', root);

      U.mount(page, 'range', U.dateRange({
        from: S.r.rawFrom, to: S.r.rawTo, preset: st.preset, presets: PRESETS,
        onChange: function (v) { st.preset = v.preset || null; st.from = v.from; st.to = v.to; save(); ctx.rerender(); }
      }));
      O.$('.st-prop', page).onchange = function (e) { st.pid = e.target.value; save(); ctx.rerender(); };
      var tabsEl = O.$('.st-tabs', page);
      tabsEl.addEventListener('click', function (e) {
        var b = e.target.closest('[data-tab]'); if (!b || b.disabled) return;
        st.tab = tab = b.dataset.tab; save();
        O.$$('[data-tab]', tabsEl).forEach(function (x) { var on = x.dataset.tab === tab; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
        center(); paint();
      });
      function center() { var on = O.$('[data-tab].on', tabsEl); if (on && tabsEl.scrollWidth > tabsEl.clientWidth) tabsEl.scrollLeft = Math.max(0, on.offsetLeft - (tabsEl.clientWidth - on.offsetWidth) / 2); }
      page.addEventListener('click', function (e) {
        var x = e.target.closest('[data-go]'); if (x) { O.go(x.dataset.go); return; }
        x = e.target.closest('[data-act="all"]'); if (x) { st.preset = 'since'; save(); ctx.rerender(); }
      });

      function paint() {
        memo = {}; turnIdx = null;
        var body = O.$('.st-body', page), m;
        try { m = TAB[tab](S) || {}; } catch (err) { console.error(err); m = { empty: '<div class="card">' + U.empty('Something went wrong with this tab: ' + err.message, '⚠') + '</div>' }; }
        prune(m.table, S);
        st.model = { tab: tab, S: S, kpis: m.kpis, table: m.table, empty: !!m.empty };
        O.$$('[data-st-ex]', acts).forEach(function (b) { /* nothing to download on an empty tab */
          if (!canEx) return;
          b.disabled = !!m.empty || (b.dataset.stEx === 'pdf' && !m.table);
          b.title = b.disabled ? 'Nothing to download for this tab and date range' : 'Download this tab as ' + (b.dataset.stEx === 'csv' ? 'CSV' : 'PDF');
        });
        if (m.empty) { body.innerHTML = m.empty; return; }
        var cards = m.cards || [], grid = m.grid || (cards.length === 2 ? 'g2' : 'g1');
        var wide = cards.filter(function (c) { return /st-wide\b/.test(c.cls || ''); }), rest = cards.filter(function (c) { return wide.indexOf(c) < 0; });
        body.innerHTML = U.kpis(m.kpis.map(function (k) { return { label: k.label, value: k.value, sub: k.sub, hl: k.hl, title: k.title }; })) +
          wide.map(card).join('') +
          (rest.length ? '<div class="grid ' + grid + ' st-cards">' + rest.map(card).join('') + '</div>' : '') +
          (m.table ? tableCard(m.table) : '');
        var slots = O.$$('[data-chart]', body), all = wide.concat(rest).filter(function (c) { return c.draw; });
        slots.forEach(function (el, i) { if (all[i]) { try { all[i].draw(el); } catch (err) { console.error(err); el.innerHTML = U.empty('This chart could not be drawn.'); } } });
      }
      paint();
      center();
    }
  });
})();
