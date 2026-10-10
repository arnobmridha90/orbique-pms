/* Reports — nine small report cards in one row, a date range with presets, a comparison choice,
   and the selected report below (KPIs, chart, breakdown, table, CSV and PDF export). */
(function () {
  var O = window.O, D = O.data, M = O.metrics, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  var st = { report: 'occupancy', preset: 'last30', from: null, to: null, compare: 'prev', pid: '', sort: null };

  O.css('reports', [
    '.pg-reports .rp-cards{display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:8px;margin-bottom:14px;}',
    '.pg-reports .rp-card{display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:0;padding:8px 9px;border:1px solid var(--border);border-radius:10px;background:var(--surface);box-shadow:var(--shadow);text-align:left;cursor:pointer;color:var(--text);font:inherit;}',
    '.pg-reports .rp-card:hover{border-color:var(--border-strong);}',
    '.pg-reports .rp-card.on{border-color:var(--brand-strong);background:var(--brand-soft-2);box-shadow:inset 0 -3px 0 var(--brand-strong),var(--shadow);}',
    '.pg-reports .rp-card .rc-top{display:flex;align-items:center;gap:5px;width:100%;min-width:0;}',
    '.pg-reports .rp-card .rc-top svg{width:14px;height:14px;flex-shrink:0;color:var(--brand-strong);}',
    '.pg-reports .rp-card .rc-name{font-size:11.5px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.pg-reports .rp-card .rc-val{font-family:var(--font-head);font-size:15px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;font-variant-numeric:tabular-nums;}',
    '.pg-reports .rp-card .rc-sub{font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}',
    '.pg-reports .rp-card .rc-lock{font-size:11px;color:var(--muted);font-weight:700;}',
    '.pg-reports .rp-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;}',
    '.pg-reports .rp-bar .lbl{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;}',
    '.pg-reports .rp-bar .grp{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
    '.pg-reports .rp-bar .select{width:auto;min-width:170px;}',
    '.pg-reports .rp-bar .spacer{flex:1;}',
    '.pg-reports .rp-sum{font-size:12.5px;color:var(--text-2);margin:-4px 0 12px;}',
    '.pg-reports .rp-sum b{color:var(--text);}',
    '.pg-reports .rp-chart{min-height:240px;}',
    '.pg-reports .rp-main{align-items:start;}',
    '.pg-reports .rp-main.drawn{align-items:stretch;}',
    '.pg-reports .rp-legend{margin-top:8px;}',
    '.pg-reports .table th.sort{cursor:pointer;user-select:none;}',
    '.pg-reports .table td.num{white-space:nowrap;}',
    '.pg-reports .rp-cmp .s{display:none;}',
    '.pg-reports .table th.sort:hover{color:var(--text);}',
    '.pg-reports .table th .ar{font-size:9px;margin-left:3px;}',
    '.pg-reports .table td .prop-dot{margin-right:7px;vertical-align:0;}',
    '.pg-reports .side-list .hbar{margin-bottom:8px;}',
    '.pg-reports .rp-sfoot{margin-top:10px;}',
    '.pg-reports .card-head .hd{min-width:0;}',
    '.pg-reports .rp-actions{display:flex;gap:8px;flex-wrap:wrap;}',
    '.pg-reports .rp-actions .btn svg,.rp-actions-top .btn svg{width:15px;height:15px;}',
    '@media (max-width:760px){.pg-reports .tbl .table td:first-child{white-space:nowrap;}}',
    '.pg-reports .mini-table td,.pg-reports .mini-table th{padding:7px 10px;}',
    '@media (max-width:1200px){.pg-reports .rp-cards{display:flex;overflow-x:auto;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity;padding-bottom:4px;}.pg-reports .rp-card{flex:0 0 128px;scroll-snap-align:start;}}',
    '@media (max-width:560px){.pg-reports .rp-bar .select{flex:1;min-width:0;}.pg-reports .rp-bar .grp{width:100%;}.pg-reports .rp-bar .lbl{width:100%;}.pg-reports .rp-cmp{flex:1;flex-wrap:nowrap;}.pg-reports .rp-cmp button{flex:1;white-space:nowrap;}.pg-reports .rp-cmp .l{display:none;}.pg-reports .rp-cmp .s{display:inline;}}'
  ].join('\n'));

  /* ------------------------------------------------------------------ helpers */
  var REPORTS = [
    { id: 'occupancy', name: 'Occupancy', icon: 'calendar', desc: 'Nights sold against nights available' },
    { id: 'revenue', name: 'Revenue', icon: 'financials', desc: 'Revenue, ADR and RevPAR', owner: true },
    { id: 'pace', name: 'Booking pace', short: 'Pace', icon: 'clock', desc: 'Bookings made and how far ahead' },
    { id: 'channels', name: 'Channels', icon: 'website', desc: 'Where nights and revenue come from' },
    { id: 'guests', name: 'Guests & origin', short: 'Guests', icon: 'user', desc: 'Who stays and where they come from' },
    { id: 'reviews', name: 'Reviews', icon: 'star', desc: 'Ratings, sub-scores and replies' },
    { id: 'operations', name: 'Operations', icon: 'tasks', desc: 'Arrivals, turnovers and tasks' },
    { id: 'expenses', name: 'Expenses', icon: 'expenses', desc: 'Spending by type and person', owner: true },
    { id: 'tax', name: 'Tourism tax', icon: 'invoices', desc: 'Tourism tax collected from foreign guests', owner: true }
  ];
  var REP = {}; REPORTS.forEach(function (r) { REP[r.id] = r; });
  var COMPARE = [['prev', 'Previous period', 'Previous'], ['lastMonth', 'Same period last month', 'Last month'], ['none', 'No comparison', 'None']];
  var TAX_PER_NIGHT = 10;
  /* 'Fee rates: Airbnb, Booking.com and Agoda 15%, Vrbo 8%, direct bookings 3% card fees.' built from D.channels */
  function feeNote() {
    var g = {}, order = [];
    D.channelOrder.forEach(function (ch) { if (ch === 'direct') return; var k = String(Math.round(D.channels[ch].feePct * 100)); if (!g[k]) { g[k] = []; order.push(k); } g[k].push(D.channels[ch].name); });
    var parts = order.map(function (k) { var n = g[k]; return (n.length > 1 ? n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1] : n[0]) + ' ' + k + '%'; });
    return 'Fee rates: ' + parts.join(', ') + ' commission on the room rate; direct bookings ' + Math.round(D.channels.direct.feePct * 100) + '% card fees.';
  }

  /* records start on 1 June 2026; ranges are counted from then so empty months do not dilute the numbers */
  var DATA_START = '2026-06-01', clampNote = '';
  function range() {
    if (!st.from) { var p = U.preset(st.preset || 'last30'); st.from = p.from; st.to = p.to; }
    clampNote = '';
    var from = st.from, to = st.to > D.TODAY ? D.TODAY : st.to;
    if (to < DATA_START) { to = d.add(DATA_START, 29); clampNote = 'Records start on 1 June 2026, so the first 30 days are shown.'; from = DATA_START; }
    else if (from < DATA_START) { from = DATA_START; clampNote = 'Records start on 1 June 2026, so the range is counted from then.'; }
    if (to < from) to = from;
    return { from: from, to: to };
  }
  function compRange(r) {
    if (st.compare === 'none') return null;
    var c;
    if (st.compare === 'lastMonth') c = { from: d.addMonths(r.from, -1), to: d.addMonths(r.to, -1) };
    else { var len = d.diff(r.from, r.to) + 1; c = { from: d.add(r.from, -len), to: d.add(r.from, -1) }; }
    if (c.from < DATA_START) { clampNote += (clampNote ? ' ' : '') + 'No comparison: the ' + compName() + ' falls before records start on 1 June 2026.'; return null; }
    return c;
  }
  function rangeText(r) { return U.rangeLabel(r.from, r.to); }
  function compName() { return st.compare === 'lastMonth' ? 'same period last month' : 'previous period'; }
  function moneyAxis(v, ax) { if (!ax || v < 10000) return fmt.money(v); var k = v / 1000; return 'RM ' + (k % 1 === 0 ? k : (k * 10) % 1 === 0 ? k.toFixed(1) : k.toFixed(2)) + 'k'; }
  function countAxis(v, ax) { return v % 1 ? (ax ? '' : v.toFixed(1)) : String(v); }
  function chg(cur, prev) { return prev ? (cur - prev) / Math.abs(prev) : null; }
  /* 'up 8.0%' / 'down 8.0%' / 'level' for sentences */
  function chgWords(c) { if (c == null || isNaN(c)) return 'no change'; if (Math.abs(c) < 0.0005) return 'level'; return (c > 0 ? 'up ' : 'down ') + fmt.changeText(c).replace(/^[+−±]/, ''); }
  function f(pid) { return pid ? { propertyId: pid } : null; }
  function props() { return st.pid ? [D.propById[st.pid]] : D.properties; }
  function propCell(p) { return '<span class="prop-dot" style="background:' + U.propColor(p.id) + '"></span>' + esc(p.name); }
  function sum(arr, fn) { return arr.reduce(function (s, x) { return s + (fn ? fn(x) : x); }, 0); }
  function live(b) { return M.live(b); }
  function pidOk(b) { return !st.pid || b.propertyId === st.pid; }
  function ptsText(c) { if (c == null || isNaN(c)) return '–'; var v = (c * 100).toFixed(1); return (c > 0 ? '+' : c < 0 ? '−' : '±') + v.replace('-', '') + ' pts'; }
  function ptsHTML(c) { if (c == null || isNaN(c)) return '<span class="delta flat">–</span>'; var flat = Math.abs(c) < 0.0005; return '<span class="delta ' + (flat ? 'flat' : c > 0 ? 'good' : 'bad') + '">' + (c > 0 ? '▲ ' : c < 0 ? '▼ ' : '') + ptsText(c).replace(/^[+−±]/, '') + '</span>'; }

  /* buckets: daily up to 45 days, weekly up to 200 days, monthly beyond */
  function buckets(r) {
    var n = d.diff(r.from, r.to) + 1, out = [], a = r.from;
    if (n <= 45) { d.range(r.from, r.to).forEach(function (x) { out.push({ a: x, b: x, label: d.fmt(x), kind: 'day' }); }); return out; }
    if (n <= 200) { var z = r.to; while (z >= r.from) { var a0 = d.add(z, -6); if (a0 < r.from) a0 = r.from; out.unshift({ a: a0, b: z, label: d.fmt(a0), kind: 'week' }); z = d.add(a0, -1); } return out; }
    while (a <= r.to) { var e = d.monthEnd(a); if (e > r.to) e = r.to; out.push({ a: a, b: e, label: d.monthName(a) + (a.slice(0, 4) !== r.to.slice(0, 4) ? ' ' + a.slice(2, 4) : ''), kind: 'month' }); a = d.add(e, 1); }
    return out;
  }
  function bucketTitle(bk) { var n = d.diff(bk.a, bk.b) + 1; return bk.kind === 'day' ? d.dowName(bk.a) + ' ' + d.fmtY(bk.a) : bk.kind === 'week' ? d.fmtRange(bk.a, bk.b) + (n < 7 ? ' (' + fmt.plural(n, 'day') + ')' : '') : U.rangeLabel(bk.a, bk.b) + (bk.b < d.monthEnd(bk.a) || bk.a.slice(8) !== '01' ? ' (' + fmt.plural(n, 'day') + ')' : ''); }
  function bucketUnit(bks) { return bks.length && bks[0].kind === 'day' ? 'per day' : bks.length && bks[0].kind === 'week' ? 'per week' : 'per month'; }

  /* chart height: fill the card next to the side panel on wide screens */
  function chartH(el) {
    var card = el.closest('.card'), grid = card && card.parentNode, side = grid && grid.children[1];
    if (!side || window.innerWidth <= 1024) return 240;
    /* the grid is not stretched yet (align-items:start), so these are natural heights */
    var extra = card.offsetHeight - el.offsetHeight;
    return Math.max(240, Math.min(440, side.offsetHeight - extra));
  }
  /* chart builder: current period vs comparison on the same buckets */
  function seriesChart(kind, r, c, fn, opt) {
    opt = opt || {};
    var bk = buckets(r), cb = c ? buckets(c) : null;
    /* weekly buckets are counted back from the last day, so line the comparison up from the end */
    if (cb && bk.length && bk[0].kind === 'week' && cb.length !== bk.length) cb = cb.slice(cb.length - bk.length).concat([]);
    if (cb) while (cb.length < bk.length) cb.unshift(null);
    var cur = bk.map(function (x) { return fn(x.a, x.b); });
    var prev = cb ? bk.map(function (x, i) { return cb[i] ? fn(cb[i].a, cb[i].b) : null; }) : null;
    var series = [{ name: opt.name || 'This period', short: 'Now', values: cur, tone: 'brand', width: 2.4 }];
    if (prev) series.push({ name: opt.prevName || ('Comparison (' + compName() + ')'), short: 'Before', values: prev, tone: 'prev1' });
    return {
      unit: bucketUnit(bk),
      legend: prev ? O.chart.legend([{ name: rangeText(r), tone: 'brand', square: kind === 'bars' }, { name: rangeText(c), tone: 'prev1', square: kind === 'bars' }]) : '',
      draw: function (el) {
        var o = {
          labels: bk.map(function (x) { return x.label; }), series: prev ? [series[0], series[1]] : [series[0]], height: chartH(el), yFormat: opt.yFormat, padLeft: opt.yFormat === moneyAxis ? 62 : undefined,
          tipTitle: function (i) { return bucketTitle(bk[i]) + (cb && cb[i] ? '  vs  ' + (cb[i].kind === 'day' ? d.fmt(cb[i].a) : d.fmtRange(cb[i].a, cb[i].b)) : ''); },
          markers: bk.length <= 16 ? 'all' : undefined, ariaLabel: opt.aria
        };
        if (kind === 'bars') {
          o.series = prev ? [{ name: rangeText(c), values: prev, tone: 'prev1' }, { name: rangeText(r), values: cur, tone: 'brand' }] : [{ name: rangeText(r), values: cur, tone: 'brand' }];
          O.chart.bars(el, o);
        } else {
          o.series = prev ? [{ name: rangeText(r), values: cur, tone: 'brand', width: 2.4 }, { name: rangeText(c), values: prev, tone: 'prev1' }] : [{ name: rangeText(r), values: cur, tone: 'brand', width: 2.4 }];
          o.area = true; o.yMin = opt.yMin;
          O.chart.line(el, o);
        }
      }
    };
  }
  /* bar chart over categories (channels, stars, expense types) */
  function catChart(labels, cur, prev, r, c, opt) {
    opt = opt || {};
    return {
      unit: '',
      legend: prev ? O.chart.legend([{ name: rangeText(r), tone: 'brand', square: true }, { name: rangeText(c), tone: 'prev1', square: true }]) : '',
      draw: function (el) {
        O.chart.bars(el, {
          labels: labels, height: chartH(el), yFormat: opt.yFormat, padLeft: opt.yFormat === moneyAxis ? 62 : undefined, xFormat: opt.xFormat, ariaLabel: opt.aria,
          series: prev ? [{ name: rangeText(c), values: prev, tone: 'prev1' }, { name: rangeText(r), values: cur, tone: 'brand' }] : [{ name: rangeText(r), values: cur, tone: 'brand' }]
        });
      }
    };
  }

  /* column formatting: cols = [{label, type:'text'|'money'|'num'|'pct'|'dec1'|'delta'|'pts'|'rating'|'html', w (mm in PDF)}] */
  function cellHTML(col, v) {
    if (v == null || (typeof v === 'number' && isNaN(v))) return '<span class="faint">–</span>';
    switch (col.type) {
      case 'money': return fmt.money(v);
      case 'num': return fmt.num(v);
      case 'pct': return fmt.pct(v, col.dp == null ? 0 : col.dp);
      case 'dec1': return v.toFixed(1);
      case 'rating': return v.toFixed(2) + ' <span style="color:var(--warn)">★</span>';
      case 'delta': return U.delta(v, { invert: col.invert });
      case 'pts': return ptsHTML(v);
      default: return esc(v);
    }
  }
  function cellText(col, v) {
    if (v == null || (typeof v === 'number' && isNaN(v))) return '–';
    switch (col.type) {
      case 'money': return fmt.money(v);
      case 'num': return fmt.num(v);
      case 'pct': return fmt.pct(v, col.dp == null ? 0 : col.dp);
      case 'dec1': return v.toFixed(1);
      case 'rating': return v.toFixed(2);
      case 'delta': return fmt.changeText(v);
      case 'pts': return ptsText(v);
      default: return String(v);
    }
  }
  function cellCSV(col, v) {
    if (v == null || (typeof v === 'number' && isNaN(v))) return '';
    switch (col.type) {
      case 'money': return Math.round(v);
      case 'pct': return (v * 100).toFixed(1) + '%';
      case 'dec1': return v.toFixed(1);
      case 'rating': return v.toFixed(2);
      case 'delta': return fmt.changeText(v);
      case 'pts': return ptsText(v);
      default: return v;
    }
  }
  function isNum(col) { return col.type && col.type !== 'text' && col.type !== 'html'; }

  /* nights per date map for the occupancy calendar (rebuilt every render so new bookings count) */
  function soldOn(iso, pid) {
    return D.bookings.reduce(function (s, b) { return s + (live(b) && (!pid || b.propertyId === pid) && b.checkIn <= iso && b.checkOut > iso ? 1 : 0); }, 0);
  }
  function weekendOcc(r, pid) {
    var sold = 0, avail = 0;
    d.range(r.from, r.to).forEach(function (x) { if (!d.isWeekend(x)) return; sold += M.nightsSold(x, x, f(pid)); avail += M.availableNights(x, x, pid || undefined); });
    return avail ? sold / avail : 0;
  }
  function staysStarting(r, pid) { return D.bookings.filter(function (b) { return live(b) && (!pid || b.propertyId === pid) && b.checkIn >= r.from && b.checkIn <= r.to; }); }
  function fees(r, pid, ch) {
    return D.bookings.reduce(function (s, b) { if (!live(b) || (pid && b.propertyId !== pid) || (ch && b.channel !== ch)) return s; var n = M.nightsIn(b, r.from, r.to); return s + (n ? b.platformFee / b.nights * n : 0); }, 0);
  }
  function taxIn(r, pid) {
    return D.bookings.reduce(function (s, b) { if (!live(b) || !b.guest.foreign || (pid && b.propertyId !== pid)) return s; return s + M.nightsIn(b, r.from, r.to) * TAX_PER_NIGHT; }, 0);
  }
  function foreignNights(r, pid) {
    return D.bookings.reduce(function (s, b) { if (!live(b) || !b.guest.foreign || (pid && b.propertyId !== pid)) return s; return s + M.nightsIn(b, r.from, r.to); }, 0);
  }
  function created(r, pid, incCancelled) {
    return D.bookings.filter(function (b) { var c = b.createdAt.slice(0, 10); return c >= r.from && c <= r.to && (!pid || b.propertyId === pid) && (incCancelled || live(b)); });
  }
  function leadDays(b) { return Math.max(0, d.diff(b.createdAt.slice(0, 10), b.checkIn)); }
  function reviewsIn(r, pid) { return D.reviews.filter(function (x) { return x.date >= r.from && x.date <= r.to && (!pid || x.propertyId === pid); }); }
  function expensesIn(r, pid) { return M.expenses(r.from, r.to).filter(function (e) { return !pid || e.propertyId === pid; }); }
  function avg(arr, fn) { return arr.length ? sum(arr, fn) / arr.length : null; }
  function turnoversIn(r, pid) { return D.bookings.filter(function (b) { return live(b) && (!pid || b.propertyId === pid) && b.checkOut >= r.from && b.checkOut <= r.to; }); }
  function backToBack(r, pid) {
    return turnoversIn(r, pid).filter(function (b) { return D.bookings.some(function (x) { return live(x) && x.propertyId === b.propertyId && x.checkIn === b.checkOut && x.id !== b.id; }); });
  }

  /* ------------------------------------------------------------------ headline value on each card */
  function headline(id, r) {
    var pid = st.pid;
    switch (id) {
      case 'occupancy': return [fmt.pct(M.occupancy(r.from, r.to, pid || undefined)), fmt.num(M.nightsSold(r.from, r.to, f(pid))) + ' nights sold'];
      case 'revenue': return [fmt.moneyShort(M.revenue(r.from, r.to, f(pid))), 'ADR ' + fmt.money(M.adr(r.from, r.to, f(pid)))];
      case 'pace': var cr = created(r, pid); return [fmt.num(cr.length), 'bookings made'];
      case 'channels':
        var best = null, tot = M.nightsSold(r.from, r.to, f(pid));
        D.channelOrder.forEach(function (ch) { var n = M.nightsSold(r.from, r.to, { propertyId: pid, channel: ch }); if (!best || n > best[1]) best = [ch, n]; });
        return best && tot ? [fmt.pct(best[1] / tot), U.platName(best[0]) + ' share'] : ['–', 'No nights sold'];
      case 'guests': var ss = staysStarting(r, pid); var intl = ss.filter(function (b) { return b.guest.foreign; }).length; return [ss.length ? fmt.pct(intl / ss.length) : '–', 'international stays'];
      case 'reviews': var rv = reviewsIn(r, pid); var a = avg(rv, function (x) { return x.stars; }); return [a ? a.toFixed(2) + ' ★' : '–', fmt.plural(rv.length, 'review')];
      case 'operations': return [fmt.num(turnoversIn(r, pid).length), 'turnovers'];
      case 'expenses': return [fmt.moneyShort(sum(expensesIn(r, pid), function (e) { return e.amount; })), fmt.plural(expensesIn(r, pid).length, 'entry', 'entries')];
      case 'tax': return [fmt.moneyShort(taxIn(r, pid)), fmt.num(foreignNights(r, pid)) + ' foreign nights'];
    }
    return ['', ''];
  }

  /* ------------------------------------------------------------------ the reports */
  var BUILD = {};

  BUILD.occupancy = function (r, c) {
    var pid = st.pid, occ = M.occupancy(r.from, r.to, pid || undefined), occP = c ? M.occupancy(c.from, c.to, pid || undefined) : null;
    var sold = M.nightsSold(r.from, r.to, f(pid)), soldP = c ? M.nightsSold(c.from, c.to, f(pid)) : null;
    var avail = M.availableNights(r.from, r.to, pid || undefined), blocked = M.blockedNights(r.from, r.to, pid || undefined);
    var we = weekendOcc(r, pid), weP = c ? weekendOcc(c, pid) : null;
    var ss = staysStarting(r, pid), los = avg(ss, function (b) { return b.nights; }), ssP = c ? staysStarting(c, pid) : [], losP = c ? avg(ssP, function (b) { return b.nights; }) : null;
    var weekday = (function () { var s = 0, a = 0; d.range(r.from, r.to).forEach(function (x) { if (d.isWeekend(x)) return; s += M.nightsSold(x, x, f(pid)); a += M.availableNights(x, x, pid || undefined); }); return a ? s / a : 0; })();
    var kpis = [
      { label: 'Occupancy', value: fmt.pct(occ, 1), sub: c ? ptsHTML(occ - occP) + ' vs ' + fmt.pct(occP, 1) : null, hl: true },
      { label: 'Nights sold', value: fmt.num(sold), delta: c ? chg(sold, soldP) : null, sub: c ? 'vs ' + fmt.num(soldP) : null },
      { label: 'Nights available', value: fmt.num(avail), sub: blocked ? fmt.num(blocked) + ' blocked' : 'none blocked' },
      { label: 'Weekend occupancy', value: fmt.pct(we), sub: c ? ptsHTML(we - weP) + ' Fri and Sat' : 'Fri and Sat nights' },
      { label: 'Weekday occupancy', value: fmt.pct(weekday), sub: 'Sun to Thu nights' },
      { label: 'Avg length of stay', value: los ? los.toFixed(1) + ' nights' : '–', delta: c && los && losP ? chg(los, losP) : null, sub: fmt.plural(ss.length, 'arrival') }
    ];
    var chart = seriesChart('line', r, c, function (a, b) { return M.occupancy(a, b, pid || undefined) * 100; }, { yFormat: function (v) { return Math.round(v) + '%'; }, aria: 'Occupancy over time', yMin: 0 });
    var rows = props().map(function (p) {
      var o = M.occupancy(r.from, r.to, p.id), oP = c ? M.occupancy(c.from, c.to, p.id) : null;
      var sl = staysStarting(r, p.id);
      return { pid: p.id, v: [p.name, M.nightsSold(r.from, r.to, { propertyId: p.id }), M.availableNights(r.from, r.to, p.id), o, oP, c ? o - oP : null, weekendOcc(r, p.id), avg(sl, function (b) { return b.nights; })], h: { 0: propCell(p) } };
    });
    var cols = [{ label: 'Property', type: 'text', w: 52 }, { label: 'Nights sold', type: 'num', w: 20 }, { label: 'Available', type: 'num', w: 18 }, { label: 'Occupancy', type: 'pct', dp: 1, w: 20 }];
    if (c) cols.push({ label: 'Before', type: 'pct', dp: 1, w: 18 }, { label: 'Change', type: 'pts', w: 20 });
    cols.push({ label: 'Weekend', type: 'pct', w: 18 }, { label: 'Avg stay', type: 'dec1', w: 18 });
    if (!c) rows.forEach(function (x) { x.v.splice(4, 2); });
    var total = { v: ['All properties' + (st.pid ? '' : ' (' + D.properties.length + ')'), sold, avail, occ].concat(c ? [occP, occ - occP] : []).concat([we, los]) };
    /* side: occupancy by property, sorted */
    var ranked = props().map(function (p) { return { p: p, o: M.occupancy(r.from, r.to, p.id) }; }).sort(function (a, b) { return b.o - a.o; });
    var side = { title: 'Occupancy by property', sub: 'Highest first', html: '<div class="side-list">' + O.chart.hbars(ranked.map(function (x) { return { label: esc(x.p.short), value: x.o * 100, display: fmt.pct(x.o) }; }), { max: 100 }) + '</div>' };
    return {
      kpis: kpis, chartTitle: 'Occupancy ' + chart.unit, chartSub: 'Share of available nights that were sold', chart: chart, side: side,
      table: { title: 'By property', sub: 'Nights sold, availability and stay length', cols: cols, rows: rows, total: total },
      summary: [['Occupancy', fmt.pct(occ, 1)], ['Nights sold', fmt.num(sold)], ['Nights available', fmt.num(avail)], ['Weekend occupancy', fmt.pct(we)]],
      insight: c ? 'Occupancy is <b>' + fmt.pct(occ, 1) + '</b>, ' + (occ >= occP ? 'up ' : 'down ') + ptsText(Math.abs(occ - occP)).replace(/^[+−±]/, '') + ' on the ' + compName() + '. Weekends run at ' + fmt.pct(we) + ' against ' + fmt.pct(weekday) + ' on weekdays.' : 'Occupancy is <b>' + fmt.pct(occ, 1) + '</b>. Weekends run at ' + fmt.pct(we) + ' against ' + fmt.pct(weekday) + ' on weekdays.'
    };
  };

  BUILD.revenue = function (r, c) {
    var pid = st.pid, rev = M.revenue(r.from, r.to, f(pid)), revP = c ? M.revenue(c.from, c.to, f(pid)) : null;
    var adr = M.adr(r.from, r.to, f(pid)), adrP = c ? M.adr(c.from, c.to, f(pid)) : null;
    var rp = M.revpar(r.from, r.to, pid || undefined), rpP = c ? M.revpar(c.from, c.to, pid || undefined) : null;
    var fe = fees(r, pid), feP = c ? fees(c, pid) : null;
    var nights = M.nightsSold(r.from, r.to, f(pid));
    var kpis = [
      { label: 'Revenue', value: fmt.money(rev), delta: c ? chg(rev, revP) : null, sub: c ? 'vs ' + fmt.money(revP) : null, hl: true },
      { label: 'ADR', value: fmt.money(adr), delta: c ? chg(adr, adrP) : null, sub: 'per night sold' },
      { label: 'RevPAR', value: fmt.money(rp), delta: c ? chg(rp, rpP) : null, sub: 'per available night' },
      { label: 'Platform fees', value: fmt.money(fe), delta: c ? chg(fe, feP) : null, deltaOpts: { invert: true }, sub: rev ? fmt.pct(fe / rev, 1) + ' of revenue' : null },
      { label: 'Revenue after fees', value: fmt.money(rev - fe), delta: c ? chg(rev - fe, revP - feP) : null },
      { label: 'Nights sold', value: fmt.num(nights), sub: fmt.pct(M.occupancy(r.from, r.to, pid || undefined)) + ' occupancy' }
    ];
    var chart = seriesChart('bars', r, c, function (a, b) { return M.revenue(a, b, f(pid)); }, { yFormat: moneyAxis, aria: 'Revenue over time' });
    var rows = props().map(function (p) {
      var rv = M.revenue(r.from, r.to, { propertyId: p.id }), rvP = c ? M.revenue(c.from, c.to, { propertyId: p.id }) : null;
      var v = [p.name, rv, M.nightsSold(r.from, r.to, { propertyId: p.id }), M.adr(r.from, r.to, { propertyId: p.id }), M.revpar(r.from, r.to, p.id), fees(r, p.id), rv - fees(r, p.id)];
      if (c) v.push(rvP, chg(rv, rvP));
      return { pid: p.id, v: v, h: { 0: propCell(p) } };
    });
    var cols = [{ label: 'Property', type: 'text', w: 44 }, { label: 'Revenue', type: 'money', w: 22 }, { label: 'Nights', type: 'num', w: 14 }, { label: 'ADR', type: 'money', w: 18 }, { label: 'RevPAR', type: 'money', w: 18 }, { label: 'Fees', type: 'money', w: 18 }, { label: 'After fees', type: 'money', w: 22 }];
    if (c) cols.push({ label: 'Before', type: 'money', w: 16 }, { label: 'Change', type: 'delta', w: 14 });
    else cols[0].w = 74;
    var total = { v: ['All properties', rev, nights, adr, rp, fe, rev - fe].concat(c ? [revP, chg(rev, revP)] : []) };
    var byCh = D.channelOrder.map(function (ch) { return { ch: ch, v: M.revenue(r.from, r.to, { propertyId: pid, channel: ch }) }; }).sort(function (a, b) { return b.v - a.v; });
    var side = { title: 'Revenue by channel', sub: 'Before platform fees', html: '<div class="side-list">' + O.chart.hbars(byCh.map(function (x) { return { label: U.plat(x.ch), value: x.v, display: fmt.moneyShort(x.v) }; })) + '</div>' };
    return {
      kpis: kpis, chartTitle: 'Revenue ' + chart.unit, chartSub: 'Accommodation and cleaning fees earned on nights in the range', chart: chart, side: side,
      table: { title: 'By property', sub: 'Revenue, rates and fees', cols: cols, rows: rows, total: total },
      summary: [['Revenue', fmt.money(rev)], ['ADR', fmt.money(adr)], ['RevPAR', fmt.money(rp)], ['Platform fees', fmt.money(fe)]],
      insight: 'Revenue is <b>' + fmt.money(rev) + '</b>' + (c ? ', ' + chgWords(chg(rev, revP)) + ' on the ' + compName() : '') + '. ADR ' + fmt.money(adr) + ' on ' + fmt.num(nights) + ' nights sold; platforms kept ' + fmt.money(fe) + '.'
    };
  };

  var LEAD = [['Same day', 0, 0], ['1–3 days', 1, 3], ['4–7 days', 4, 7], ['8–14 days', 8, 14], ['15–30 days', 15, 30], ['31–60 days', 31, 60], ['Over 60 days', 61, 9999]];
  BUILD.pace = function (r, c) {
    var pid = st.pid, owner = O.isOwner();
    var cr = created(r, pid), crP = c ? created(c, pid) : [], all = created(r, pid, true), allP = c ? created(c, pid, true) : [];
    var canc = all.length - cr.length, cancP = allP.length - crP.length;
    var nights = sum(cr, function (b) { return b.nights; }), nightsP = sum(crP, function (b) { return b.nights; });
    var lead = avg(cr, leadDays), leadP = c ? avg(crP, leadDays) : null;
    var value = sum(cr, function (b) { return b.revenue; }), valueP = sum(crP, function (b) { return b.revenue; });
    var same = cr.filter(function (b) { return b.createdAt.slice(0, 10) === b.checkIn; }).length;
    var kpis = [
      { label: 'Bookings made', value: fmt.num(cr.length), delta: c ? chg(cr.length, crP.length) : null, sub: c ? 'vs ' + crP.length : null, hl: true },
      { label: 'Nights booked', value: fmt.num(nights), delta: c ? chg(nights, nightsP) : null },
      owner ? { label: 'Booked value', value: fmt.money(value), delta: c ? chg(value, valueP) : null, sub: 'of new bookings' } : { label: 'Avg stay booked', value: cr.length ? (nights / cr.length).toFixed(1) + ' nights' : '–' },
      { label: 'Avg lead time', value: lead != null ? Math.round(lead) + ' days' : '–', sub: c && leadP != null ? 'vs ' + Math.round(leadP) + ' days' : 'booking to arrival' },
      { label: 'Cancellations', value: fmt.num(canc), delta: c ? chg(canc, cancP) : null, deltaOpts: { invert: true }, sub: all.length ? fmt.pct(canc / all.length) + ' cancelled' : null },
      { label: 'Same-day bookings', value: fmt.num(same), sub: 'booked for arrival that day' }
    ];
    var chart = seriesChart('bars', r, c, function (a, b) { return created({ from: a, to: b }, pid).length; }, { aria: 'Bookings made over time', yFormat: countAxis });
    var rows = LEAD.map(function (L) {
      var g = cr.filter(function (b) { var x = leadDays(b); return x >= L[1] && x <= L[2]; });
      var gP = crP.filter(function (b) { var x = leadDays(b); return x >= L[1] && x <= L[2]; });
      var gn = sum(g, function (b) { return b.nights; });
      var v = [L[0], g.length, cr.length ? g.length / cr.length : 0, gn, avg(g, function (b) { return b.nights; })];
      if (owner) v.push(gn ? sum(g, function (b) { return b.accommodation; }) / gn : null);
      if (c) v.push(gP.length);
      return { v: v };
    });
    var cols = [{ label: 'Booked ahead', type: 'text', w: 46 }, { label: 'Bookings', type: 'num', w: 22 }, { label: 'Share', type: 'pct', w: 22 }, { label: 'Nights', type: 'num', w: 22 }, { label: 'Avg stay', type: 'dec1', w: 22 }];
    if (owner) cols.push({ label: 'Avg nightly', type: 'money', w: 26 });
    if (c) cols.push({ label: 'Before', type: 'num', w: 20 });
    var tot = ['All bookings', cr.length, cr.length ? 1 : 0, nights, cr.length ? nights / cr.length : null];
    if (owner) tot.push(nights ? sum(cr, function (b) { return b.accommodation; }) / nights : null);
    if (c) tot.push(crP.length);
    /* side: which months the new bookings are for */
    var months = {}; cr.forEach(function (b) { var k = b.checkIn.slice(0, 7); months[k] = (months[k] || 0) + 1; });
    var mk = Object.keys(months).sort();
    var side = { title: 'Arrival month of new bookings', sub: 'Where the new demand lands', html: mk.length ? '<div class="side-list">' + O.chart.hbars(mk.map(function (k) { return { label: esc(d.monthName(k + '-01', true) + ' ' + k.slice(0, 4)), value: months[k], display: months[k] + ' bookings' }; })) + '</div>' : U.empty('No bookings were made in this range.') };
    return {
      kpis: kpis, chartTitle: 'Bookings made ' + chart.unit, chartSub: 'By the date the booking was made (cancelled bookings excluded)', chart: chart, side: side,
      table: { title: 'Lead time', sub: 'How far ahead guests booked', cols: cols, rows: rows, total: { v: tot } },
      summary: [['Bookings made', fmt.num(cr.length)], ['Nights booked', fmt.num(nights)], ['Avg lead time', lead != null ? Math.round(lead) + ' days' : '–'], ['Cancellations', fmt.num(canc)]],
      insight: '<b>' + fmt.plural(cr.length, 'booking') + '</b> made' + (c ? ' (' + chgWords(chg(cr.length, crP.length)) + ' on the ' + compName() + ')' : '') + (lead != null ? ', booked on average ' + fmt.plural(Math.round(lead), 'day') + ' before arrival. ' : '. ') + (same ? (same === 1 ? 'One was a same-day booking, made on the day of arrival.' : same + ' were same-day bookings, made on the day of arrival.') : 'No same-day bookings.')
    };
  };

  BUILD.channels = function (r, c) {
    var pid = st.pid, owner = O.isOwner();
    var totN = M.nightsSold(r.from, r.to, f(pid)), totR = M.revenue(r.from, r.to, f(pid));
    var data = D.channelOrder.map(function (ch) {
      var ff = { propertyId: pid, channel: ch };
      var st0 = D.bookings.filter(function (b) { return live(b) && b.channel === ch && pidOk(b) && M.nightsIn(b, r.from, r.to) > 0; });
      var mk = created(r, pid, true).filter(function (b) { return b.channel === ch; });
      return {
        ch: ch, stays: st0.length, nights: M.nightsSold(r.from, r.to, ff), nightsP: c ? M.nightsSold(c.from, c.to, ff) : null,
        rev: M.revenue(r.from, r.to, ff), fee: fees(r, pid, ch), lead: avg(st0, leadDays),
        cancel: mk.length ? mk.filter(function (b) { return !live(b); }).length / mk.length : null
      };
    });
    var top = data.slice().sort(function (a, b) { return b.nights - a.nights; })[0];
    var direct = data.filter(function (x) { return x.ch === 'direct'; })[0];
    var directP = c ? M.nightsSold(c.from, c.to, { propertyId: pid, channel: 'direct' }) / (M.nightsSold(c.from, c.to, f(pid)) || 1) : null;
    var feeT = sum(data, function (x) { return x.fee; });
    var ota = data.filter(function (x) { return x.ch !== 'direct'; });
    var otaFee = sum(ota, function (x) { return x.fee; }), otaRev = sum(ota, function (x) { return x.rev; });
    var allStays = D.bookings.filter(function (b) { return live(b) && pidOk(b) && M.nightsIn(b, r.from, r.to) > 0; });
    var made = created(r, pid, true), leadAll = avg(allStays, leadDays);
    var kpis = [
      { label: 'Top channel', value: top && top.nights ? esc(U.platName(top.ch)) : '–', sub: top && totN ? fmt.pct(top.nights / totN) + ' of nights' : null, hl: true },
      { label: 'Direct share', value: totN ? fmt.pct(direct.nights / totN, 1) : '–', sub: c && totN ? ptsHTML(direct.nights / totN - directP) + ' vs ' + fmt.pct(directP, 1) : 'no OTA commission' },
      { label: 'Nights sold', value: fmt.num(totN), delta: c ? chg(totN, M.nightsSold(c.from, c.to, f(pid))) : null },
      owner ? { label: 'OTA commission', value: fmt.money(otaFee), sub: otaRev ? fmt.pct(otaFee / otaRev, 1) + ' of OTA revenue' : null } : { label: 'Channels used', value: String(data.filter(function (x) { return x.nights; }).length), sub: 'of ' + data.length + ' connected' },
      { label: 'OTA share', value: totN ? fmt.pct(1 - direct.nights / totN) : '–', sub: 'of nights, via OTAs', title: 'Airbnb, Booking.com, Agoda and Vrbo' }
    ];
    var chart = catChart(data.map(function (x) { return U.platName(x.ch); }), data.map(function (x) { return x.nights; }), c ? data.map(function (x) { return x.nightsP; }) : null, r, c, { aria: 'Nights sold by channel', yFormat: countAxis });
    var cols = [{ label: 'Channel', type: 'text', w: 30 }, { label: 'Stays', type: 'num', w: 14 }, { label: 'Nights', type: 'num', w: 16 }, { label: 'Share', type: 'pct', w: 16 }];
    if (owner) cols.push({ label: 'Revenue', type: 'money', w: 22 }, { label: 'Fees', type: 'money', w: 22 }, { label: 'After fees', type: 'money', w: 22 }, { label: 'ADR', type: 'money', w: 16 });
    cols.push({ label: 'Lead (days)', type: 'num', w: 16 }, { label: 'Cancelled', type: 'pct', w: 14 });
    if (!owner) { cols[0].w = 60; cols.forEach(function (x, i) { if (i) x.w = 21; }); }
    var rows = data.map(function (x) {
      var v = [U.platName(x.ch), x.stays, x.nights, totN ? x.nights / totN : 0];
      if (owner) v.push(x.rev, x.fee, x.rev - x.fee, x.nights ? x.rev / x.nights : null);
      v.push(x.lead != null ? Math.round(x.lead) : null, x.cancel);
      return { v: v, h: { 0: U.plat(x.ch) } };
    });
    var tot = ['All channels', sum(data, function (x) { return x.stays; }), totN, totN ? 1 : 0];
    if (owner) tot.push(totR, feeT, totR - feeT, totN ? totR / totN : null);
    tot.push(leadAll != null ? Math.round(leadAll) : null, made.length ? made.filter(function (b) { return !live(b); }).length / made.length : null);
    var side = { title: 'Share of nights', sub: rangeText(r), html: '<div class="side-list">' + O.chart.hbars(data.slice().sort(function (a, b) { return b.nights - a.nights; }).map(function (x) { return { label: U.plat(x.ch), value: totN ? x.nights / totN * 100 : 0, display: totN ? fmt.pct(x.nights / totN) : '0%' }; }), { max: 100 }) + '</div>' + (owner ? '<div class="note rp-sfoot">' + feeNote() + '</div>' : '') };
    return {
      kpis: kpis, chartTitle: 'Nights sold by channel', chartSub: c ? 'This period against the ' + compName() : rangeText(r), chart: chart, side: side,
      table: { title: 'By channel', sub: owner ? 'Volume, revenue and fees (OTA commission, or card fees on direct bookings)' : 'Volume and booking behaviour', cols: cols, rows: rows, total: { v: tot } },
      summary: [['Top channel', top && top.nights ? U.platName(top.ch) : '–'], ['Direct share', totN ? fmt.pct(direct.nights / totN, 1) : '–'], ['Nights sold', fmt.num(totN)]].concat(owner ? [['OTA commission', fmt.money(otaFee)]] : []),
      notes: 'Lead time is the average number of days between booking and arrival. Cancelled is the share of bookings made in the range that were later cancelled.',
      pdfNote: owner ? feeNote() : '',
      insight: top && totN ? '<b>' + esc(U.platName(top.ch)) + '</b> brings ' + fmt.pct(top.nights / totN) + ' of nights. Direct bookings are ' + fmt.pct(direct.nights / totN, 1) + ' of nights' + (owner ? ', and OTAs kept ' + fmt.money(otaFee) + ' in commission.' : '.') : 'No nights sold in this range.'
    };
  };

  BUILD.guests = function (r, c) {
    var pid = st.pid, owner = O.isOwner();
    var ss = staysStarting(r, pid), ssP = c ? staysStarting(c, pid) : [];
    var intl = ss.filter(function (b) { return b.guest.foreign; }), intlP = ssP.filter(function (b) { return b.guest.foreign; });
    var guests = sum(ss, function (b) { return b.guests; });
    var groups = ss.filter(function (b) { return b.guests >= 3; });
    var ctry = {}; ss.forEach(function (b) { var k = b.guest.countryName; (ctry[k] = ctry[k] || []).push(b); });
    var ctryP = {}; ssP.forEach(function (b) { ctryP[b.guest.countryName] = (ctryP[b.guest.countryName] || 0) + 1; });
    var keys = Object.keys(ctry).sort(function (a, b) { return ctry[b].length - ctry[a].length || (a < b ? -1 : 1); });
    var kpis = [
      { label: 'Arrivals', value: fmt.num(ss.length), delta: c ? chg(ss.length, ssP.length) : null, sub: fmt.num(guests) + ' guests', hl: true },
      { label: 'International', value: ss.length ? fmt.pct(intl.length / ss.length) : '–', sub: c && ss.length && ssP.length ? ptsHTML(intl.length / ss.length - intlP.length / ssP.length) + ' of arrivals' : 'of arrivals' },
      { label: 'Countries', value: fmt.num(keys.length), sub: keys.length ? 'top: ' + keys[0] : null },
      { label: 'Avg party size', value: ss.length ? (guests / ss.length).toFixed(1) : '–', sub: 'guests per stay' },
      { label: 'Avg length of stay', value: ss.length ? avg(ss, function (b) { return b.nights; }).toFixed(1) + ' nights' : '–' },
      { label: 'Groups of 3 or more', value: fmt.num(groups.length), sub: ss.length ? fmt.pct(groups.length / ss.length) + ' of arrivals' : null }
    ];
    var chart = seriesChart('bars', r, c, function (a, b) { return staysStarting({ from: a, to: b }, pid).length; }, { aria: 'Arrivals over time', yFormat: countAxis });
    var cols = [{ label: 'Country', type: 'text', w: 46 }, { label: 'Arrivals', type: 'num', w: 18 }, { label: 'Share', type: 'pct', w: 16 }, { label: 'Guests', type: 'num', w: 16 }, { label: 'Nights', type: 'num', w: 16 }, { label: 'Avg stay', type: 'dec1', w: 18 }];
    if (owner) cols.push({ label: 'Booking value', type: 'money', w: 26 });
    if (c) cols.push({ label: 'Before', type: 'num', w: 16 });
    var rows = keys.map(function (k) {
      var g = ctry[k], v = [k, g.length, g.length / ss.length, sum(g, function (b) { return b.guests; }), sum(g, function (b) { return b.nights; }), avg(g, function (b) { return b.nights; })];
      if (owner) v.push(sum(g, function (b) { return b.revenue; }));
      if (c) v.push(ctryP[k] || 0);
      return { v: v, h: { 0: esc(k) + (g[0].guest.foreign ? '' : ' <span class="xs muted">(domestic, no tourism tax)</span>') } };
    });
    var tot = ['All countries', ss.length, ss.length ? 1 : 0, guests, sum(ss, function (b) { return b.nights; }), avg(ss, function (b) { return b.nights; })];
    if (owner) tot.push(sum(ss, function (b) { return b.revenue; }));
    if (c) tot.push(ssP.length);
    var side = { title: 'Top countries', sub: 'Arrivals in the range', html: keys.length ? '<div class="side-list">' + O.chart.hbars(keys.slice(0, 8).map(function (k) { return { label: esc(k), value: ctry[k].length, display: ctry[k].length + ' (' + fmt.pct(ctry[k].length / ss.length) + ')' }; })) + '</div>' : U.empty('No arrivals in this range.') };
    return {
      kpis: kpis, chartTitle: 'Arrivals ' + chart.unit, chartSub: 'Stays by check-in date', chart: chart, side: side,
      table: { title: 'By country', sub: 'Guest origin from booking details', cols: cols, rows: rows, total: { v: tot } },
      summary: [['Arrivals', fmt.num(ss.length)], ['International', ss.length ? fmt.pct(intl.length / ss.length) : '–'], ['Countries', fmt.num(keys.length)], ['Groups of 3 or more', fmt.num(groups.length)]],
      insight: ss.length ? '<b>' + fmt.pct(intl.length / ss.length) + '</b> of ' + fmt.plural(ss.length, 'arrival') + ' came from abroad, from ' + fmt.plural(keys.length, 'country', 'countries') + '. ' + esc(keys[0]) + ' is the biggest market.' : 'No arrivals in this range.'
    };
  };

  BUILD.reviews = function (r, c) {
    var pid = st.pid, rv = reviewsIn(r, pid), rvP = c ? reviewsIn(c, pid) : [];
    var a = avg(rv, function (x) { return x.stars; }), aP = c ? avg(rvP, function (x) { return x.stars; }) : null;
    var five = rv.filter(function (x) { return x.stars === 5; }).length, low = rv.filter(function (x) { return x.stars <= 3; }).length;
    var replied = rv.filter(function (x) { return x.reply; }).length;
    var kpis = [
      { label: 'Average rating', value: a ? a.toFixed(2) + ' ★' : '–', delta: c && a && aP ? chg(a, aP) : null, sub: c && aP ? 'vs ' + aP.toFixed(2) : null, hl: true },
      { label: 'Reviews', value: fmt.num(rv.length), delta: c ? chg(rv.length, rvP.length) : null },
      { label: '5-star share', value: rv.length ? fmt.pct(five / rv.length) : '–' },
      { label: '3 stars or lower', value: fmt.num(low), sub: low ? 'check the comments' : 'none', deltaOpts: { invert: true } },
      { label: 'Response rate', value: rv.length ? fmt.pct(replied / rv.length) : '–', sub: (rv.length - replied) + ' need a reply' }
    ];
    var stars = [5, 4, 3, 2, 1];
    var chart = catChart(stars.map(function (s) { return s + ' stars'; }), stars.map(function (s) { return rv.filter(function (x) { return x.stars === s; }).length; }), c ? stars.map(function (s) { return rvP.filter(function (x) { return x.stars === s; }).length; }) : null, r, c, { aria: 'Reviews by star rating', yFormat: countAxis, xFormat: function (l) { return l.replace(' stars', '★'); } });
    var cols = [{ label: 'Property', type: 'text', w: 46 }, { label: 'Reviews', type: 'num', w: 16 }, { label: 'Rating', type: 'rating', w: 16 }, { label: 'Clean', type: 'dec1', w: 16 }, { label: 'Comms', type: 'dec1', w: 16 }, { label: 'Check-in', type: 'dec1', w: 18 }, { label: 'Accuracy', type: 'dec1', w: 18 }, { label: 'Need reply', type: 'num', w: 20 }, { label: '1–3 stars', type: 'num', w: 20 }];
    function subAvg(list, k) { var l = list.filter(function (x) { return x.sub && x.sub[k] != null; }); return l.length ? avg(l, function (x) { return x.sub[k]; }) : null; }
    function row(name, list) { return [name, list.length, avg(list, function (x) { return x.stars; }), subAvg(list, 'cleanliness'), subAvg(list, 'communication'), subAvg(list, 'checkin'), subAvg(list, 'accuracy'), list.filter(function (x) { return !x.reply; }).length, list.filter(function (x) { return x.stars <= 3; }).length]; }
    var rows = props().map(function (p) { var l = rv.filter(function (x) { return x.propertyId === p.id; }); return { pid: p.id, v: row(p.name, l), h: { 0: propCell(p) } }; });
    var plats = ['airbnb', 'booking', 'agoda', 'vrbo', 'google'].map(function (pl) { var l = rv.filter(function (x) { return x.platform === pl; }); return { pl: pl, n: l.length, a: avg(l, function (x) { return x.stars; }) }; }).filter(function (x) { return x.n; });
    var side = { title: 'Rating by platform', sub: 'Average stars and review count', html: plats.length ? '<div class="side-list">' + O.chart.hbars(plats.map(function (x) { return { label: U.plat(x.pl), value: x.a, display: x.a.toFixed(2) + ' · ' + x.n }; }), { max: 5 }) + '</div><button type="button" class="btn btn-ghost btn-sm rp-sfoot" data-go="reviews">Open reviews</button>' : U.empty('No reviews in this range.') };
    return {
      kpis: kpis, chartTitle: 'Reviews by star rating', chartSub: c ? 'This period against the ' + compName() : rangeText(r), chart: chart, side: side,
      table: { title: 'By property', sub: 'Ratings and sub-scores (out of 5)', cols: cols, rows: rows, total: { v: row('All properties', rv) } },
      summary: [['Average rating', a ? a.toFixed(2) : '–'], ['Reviews', fmt.num(rv.length)], ['5-star share', rv.length ? fmt.pct(five / rv.length) : '–'], ['Response rate', rv.length ? fmt.pct(replied / rv.length) : '–']],
      insight: rv.length ? 'Guests rated stays <b>' + a.toFixed(2) + ' out of 5</b> across ' + fmt.plural(rv.length, 'review') + '. ' + (rv.length - replied ? (rv.length - replied) + ' still need a reply.' : 'Every review has a reply.') : 'No reviews in this range.'
    };
  };

  BUILD.operations = function (r, c) {
    var pid = st.pid;
    var ins = staysStarting(r, pid), insP = c ? staysStarting(c, pid) : [];
    var outs = turnoversIn(r, pid), outsP = c ? turnoversIn(c, pid) : [];
    var b2b = backToBack(r, pid), b2bP = c ? backToBack(c, pid) : [];
    var same = ins.filter(function (b) { return b.createdAt.slice(0, 10) === b.checkIn; });
    var days = d.diff(r.from, r.to) + 1;
    var tasks = D.tasks.filter(function (t) { var x = t.due.slice(0, 10); return x >= r.from && x <= r.to && (!pid || t.propertyId === pid); });
    var done = tasks.filter(function (t) { return t.status === 'done'; }), onTime = done.filter(function (t) { return t.doneAt && t.doneAt <= t.due; });
    var overdue = tasks.filter(function (t) { return t.status !== 'done' && t.due < D.NOW; });
    var kpis = [
      { label: 'Check-ins', value: fmt.num(ins.length), delta: c ? chg(ins.length, insP.length) : null, hl: true },
      { label: 'Turnovers', value: fmt.num(outs.length), delta: c ? chg(outs.length, outsP.length) : null, sub: (outs.length / days).toFixed(1) + ' per day' },
      { label: 'Back-to-back', value: fmt.num(b2b.length), delta: c ? chg(b2b.length, b2bP.length) : null, deltaOpts: { invert: true }, sub: 'same-day changeovers' },
      { label: 'Same-day bookings', value: fmt.num(same.length), sub: 'booked on arrival day' },
      { label: 'Tasks done on time', value: done.length ? fmt.pct(onTime.length / done.length) : '–', sub: done.length + ' of ' + tasks.length + ' tasks done' },
      { label: 'Overdue tasks', value: fmt.num(overdue.length), sub: overdue.length ? 'still open' : 'none' }
    ];
    var chart = seriesChart('bars', r, c, function (a, b) { return turnoversIn({ from: a, to: b }, pid).length; }, { aria: 'Turnovers over time', yFormat: countAxis });
    var cols = [{ label: 'Property', type: 'text', w: 46 }, { label: 'Housekeeper', type: 'text', w: 34 }, { label: 'Check-ins', type: 'num', w: 18 }, { label: 'Turnovers', type: 'num', w: 20 }, { label: 'Back-to-back', type: 'num', w: 24 }, { label: 'Blocked', type: 'num', w: 18 }, { label: 'ID checked', type: 'pct', w: 26 }];
    var rows = props().map(function (p) {
      var i = staysStarting(r, p.id), hk = D.staffById(p.housekeeper);
      return { pid: p.id, v: [p.name, hk ? hk.name : 'Unassigned', i.length, turnoversIn(r, p.id).length, backToBack(r, p.id).length, M.blockedNights(r.from, r.to, p.id), i.length ? i.filter(function (b) { return b.idVerified; }).length / i.length : null], h: { 0: propCell(p) } };
    });
    var tot = ['All properties', '', ins.length, outs.length, b2b.length, M.blockedNights(r.from, r.to, pid || undefined), ins.length ? ins.filter(function (b) { return b.idVerified; }).length / ins.length : null];
    var taskKV = '<div class="section-title">Tasks due in this range</div><dl class="kv"><dt>Done</dt><dd>' + done.length + '</dd><dt>In progress</dt><dd>' + tasks.filter(function (t) { return t.status === 'in_progress'; }).length + '</dd><dt>To do</dt><dd>' + tasks.filter(function (t) { return t.status === 'todo'; }).length + '</dd><dt>Unassigned</dt><dd>' + tasks.filter(function (t) { return t.status !== 'done' && !t.assigneeId; }).length + '</dd><dt class="tot">Total</dt><dd class="tot">' + tasks.length + '</dd></dl>';
    var hk = {}; outs.forEach(function (b) { var k = D.propById[b.propertyId].housekeeper; hk[k] = (hk[k] || 0) + 1; });
    var hkKeys = Object.keys(hk).sort(function (a, b) { return hk[b] - hk[a]; });
    var side = { title: 'Turnovers by housekeeper', sub: 'Who cleaned between stays', html: hkKeys.length ? '<div class="side-list">' + O.chart.hbars(hkKeys.map(function (k) { var s = D.staffById(k); return { label: esc(s ? s.name : k), value: hk[k], display: hk[k] + ' cleans' }; })) + '</div>' + taskKV + '<button type="button" class="btn btn-ghost btn-sm rp-sfoot" data-go="tasks">Open tasks</button>' : U.empty('No turnovers in this range.') };
    return {
      kpis: kpis, chartTitle: 'Turnovers ' + chart.unit, chartSub: 'Check-outs that needed a clean', chart: chart, side: side,
      table: { title: 'By property', sub: 'Arrivals, turnovers and blocked nights', cols: cols, rows: rows, total: { v: tot } },
      summary: [['Check-ins', fmt.num(ins.length)], ['Turnovers', fmt.num(outs.length)], ['Back-to-back', fmt.num(b2b.length)], ['Same-day bookings', fmt.num(same.length)]],
      insight: '<b>' + fmt.plural(outs.length, 'turnover') + '</b> in ' + fmt.plural(days, 'day') + ', ' + b2b.length + ' of them back-to-back with a new arrival the same day.'
    };
  };

  function shortT (t) { return t.replace(' & maintenance', '').replace(' & amenities', '').replace(' & equipment', '').replace(' & subscriptions', '').replace('Cleaning supplies', 'Cleaning').replace('Internet & TV', 'Internet'); }
  BUILD.expenses = function (r, c) {
    var pid = st.pid, ex = expensesIn(r, pid), exP = c ? expensesIn(c, pid) : [];
    var tot = sum(ex, function (e) { return e.amount; }), totP = sum(exP, function (e) { return e.amount; });
    var nights = M.nightsSold(r.from, r.to, f(pid));
    var noRcpt = ex.filter(function (e) { return !e.receipt; });
    var claims = ex.filter(function (e) { return e.method === 'Paid personally (claim)'; });
    var byType = {}; ex.forEach(function (e) { byType[e.type] = (byType[e.type] || 0) + e.amount; });
    var byTypeP = {}; exP.forEach(function (e) { byTypeP[e.type] = (byTypeP[e.type] || 0) + e.amount; });
    var types = D.expenseTypes.filter(function (t) { return byType[t] || byTypeP[t]; });
    var topType = types.slice().sort(function (a, b) { return (byType[b] || 0) - (byType[a] || 0); })[0];
    var kpis = [
      { label: 'Total spent', value: fmt.money(tot), delta: c ? chg(tot, totP) : null, deltaOpts: { invert: true }, sub: c ? 'vs ' + fmt.money(totP) : null, hl: true },
      { label: 'Entries', value: fmt.num(ex.length), sub: ex.length ? 'avg ' + fmt.money(tot / ex.length) : null },
      { label: 'Per night sold', value: nights ? fmt.money(tot / nights) : '–', sub: fmt.num(nights) + ' nights' },
      { label: 'Biggest type', value: topType ? esc(shortT(topType)) : '–', title: topType || '', sub: topType && tot ? fmt.pct((byType[topType] || 0) / tot) + ' of spend' : null },
      { label: 'Staff claims', value: fmt.money(sum(claims, function (e) { return e.amount; })), sub: fmt.plural(claims.length, 'claim') },
      { label: 'Missing receipts', value: fmt.num(noRcpt.length), sub: noRcpt.length ? fmt.money(sum(noRcpt, function (e) { return e.amount; })) : 'all have receipts' }
    ];
    var chart = catChart(types.map(shortT), types.map(function (t) { return byType[t] || 0; }), c ? types.map(function (t) { return byTypeP[t] || 0; }) : null, r, c, { aria: 'Expenses by type', yFormat: moneyAxis });
    var cols = [{ label: 'Type', type: 'text', w: 56 }, { label: 'Entries', type: 'num', w: 20 }, { label: 'Total', type: 'money', w: 30 }, { label: 'Share', type: 'pct', w: 20 }];
    if (c) cols.push({ label: 'Before', type: 'money', w: 30 }, { label: 'Change', type: 'delta', invert: true, w: 30 });
    var rows = types.map(function (t) {
      var v = [t, ex.filter(function (e) { return e.type === t; }).length, byType[t] || 0, tot ? (byType[t] || 0) / tot : 0];
      if (c) v.push(byTypeP[t] || 0, chg(byType[t] || 0, byTypeP[t] || 0));
      return { v: v };
    }).sort(function (a, b) { return b.v[2] - a.v[2]; });
    var totRow = ['All types', ex.length, tot, tot ? 1 : 0].concat(c ? [totP, chg(tot, totP)] : []);
    var byP = {}; ex.forEach(function (e) { byP[e.paidBy] = (byP[e.paidBy] || 0) + e.amount; });
    var pk = Object.keys(byP).sort(function (a, b) { return byP[b] - byP[a]; });
    var side = { title: 'By person', sub: 'Who paid, including the owner', html: pk.length ? '<div class="side-list">' + O.chart.hbars(pk.map(function (k) { var s = D.staffById(k); return { label: esc(s ? s.name : k), value: byP[k], display: fmt.money(byP[k]) }; })) + '</div><div class="xs muted rp-sfoot">Includes ' + esc(D.staff[0].name) + ', the account owner.</div><button type="button" class="btn btn-ghost btn-sm rp-sfoot" data-go="expenses">Open expenses</button>' : U.empty('No expenses in this range.') };
    return {
      kpis: kpis, chartTitle: 'Expenses by type', chartSub: c ? 'This period against the ' + compName() : rangeText(r), chart: chart, side: side,
      table: { title: 'By type', sub: 'Spending from recorded expenses', cols: cols, rows: rows, total: { v: totRow } },
      summary: [['Total spent', fmt.money(tot)], ['Entries', fmt.num(ex.length)], ['Per night sold', nights ? fmt.money(tot / nights) : '–'], ['Staff claims', fmt.money(sum(claims, function (e) { return e.amount; }))]],
      insight: ex.length ? 'Spent <b>' + fmt.money(tot) + '</b> across ' + fmt.plural(ex.length, 'entry', 'entries') + (c ? ' (' + chgWords(chg(tot, totP)) + ' on the ' + compName() + ')' : '') + '. ' + esc(topType) + ' is the biggest line.' : 'No expenses recorded in this range.'
    };
  };

  BUILD.tax = function (r, c) {
    var pid = st.pid, tax = taxIn(r, pid), taxP = c ? taxIn(c, pid) : null, fn = foreignNights(r, pid);
    var nightsAll = M.nightsSold(r.from, r.to, f(pid));
    var stays = D.bookings.filter(function (b) { return live(b) && pidOk(b) && M.nightsIn(b, r.from, r.to) > 0; });
    var fs = stays.filter(function (b) { return b.guest.foreign; }), ds = stays.filter(function (b) { return !b.guest.foreign; });
    var kpis = [
      { label: 'Tax collected', value: fmt.money(tax), delta: c ? chg(tax, taxP) : null, sub: c ? 'vs ' + fmt.money(taxP) : null, hl: true },
      { label: 'Foreign room-nights', value: fmt.num(fn), sub: 'RM ' + TAX_PER_NIGHT + ' each' },
      { label: 'Foreign stays', value: fmt.num(fs.length), sub: 'taxable' },
      { label: 'Malaysian stays', value: fmt.num(ds.length), sub: 'exempt' },
      { label: 'Taxable share', value: nightsAll ? fmt.pct(fn / nightsAll) : '–', sub: 'of nights sold' }
    ];
    var chart = seriesChart('bars', r, c, function (a, b) { return taxIn({ from: a, to: b }, pid); }, { aria: 'Tourism tax over time', yFormat: moneyAxis });
    var cols = [{ label: 'Property', type: 'text', w: 56 }, { label: 'Foreign stays', type: 'num', w: 26 }, { label: 'Room-nights', type: 'num', w: 26 }, { label: 'Exempt nights', type: 'num', w: 26 }, { label: 'Tax', type: 'money', w: 26 }];
    if (c) { cols.push({ label: 'Before', type: 'money', w: 26 }); cols[0].w = 30; }
    var rows = props().map(function (p) {
      var fsP = fs.filter(function (b) { return b.propertyId === p.id; });
      var v = [p.name, fsP.length, foreignNights(r, p.id), M.nightsSold(r.from, r.to, { propertyId: p.id }) - foreignNights(r, p.id), taxIn(r, p.id)];
      if (c) v.push(taxIn(c, p.id));
      return { pid: p.id, v: v, h: { 0: propCell(p) } };
    });
    var totRow = ['All properties', fs.length, fn, nightsAll - fn, tax].concat(c ? [taxP] : []);
    /* filing months: tax is paid by the last day of the following month */
    var mths = [], m = d.monthStart(r.from);
    while (m <= r.to) { mths.push(m); m = d.addMonths(m, 1); }
    var paidT = 0, dueT = 0, collT = 0;
    var fileRows = mths.map(function (ms) {
      var me = d.monthEnd(ms), a = ms < r.from ? r.from : ms, z = me > r.to ? r.to : me;
      var due = d.monthEnd(d.addMonths(ms, 1));
      var amt = taxIn({ from: a, to: z }, pid);
      if (me >= D.TODAY) collT += amt; else if (due < D.TODAY) paidT += amt; else dueT += amt;
      var status = me >= D.TODAY ? U.pill('Collecting', 'info') : due < D.TODAY ? U.pill('Paid', 'ok') : U.pill('Due ' + d.fmt(due), 'warn');
      return '<tr><td>' + d.monthName(ms, true) + ' ' + ms.slice(0, 4) + (a !== ms || z !== me ? ' <span class="xs muted">(' + d.fmtRange(a, z) + ')</span>' : '') + '</td><td class="num">' + fmt.money(amt) + '</td><td>' + status + '</td></tr>';
    }).join('');
    var side = { title: 'Monthly returns', sub: 'Paid through MyTTx by the end of the next month', flush: true, html: '<div class="table-wrap"><table class="table mini-table"><thead><tr><th>Month</th><th class="num">Tax</th><th>Status</th></tr></thead><tbody>' + fileRows + '</tbody></table></div>' + '<div class="card-body"><dl class="kv"><dt>Paid to Customs</dt><dd>' + fmt.money(paidT) + '</dd><dt>Due, not yet paid</dt><dd>' + fmt.money(dueT) + '</dd><dt>Still collecting</dt><dd>' + fmt.money(collT) + '</dd><dt class="tot">Total in range</dt><dd class="tot">' + fmt.money(tax) + '</dd></dl><div class="note rp-sfoot">Foreign guests pay RM ' + TAX_PER_NIGHT + ' per room per night on top of the stay. It shows as a separate line on every invoice.</div></div>' };
    return {
      kpis: kpis, chartTitle: 'Tourism tax ' + chart.unit, chartSub: 'Charged on foreign guests’ nights in the range', chart: chart, side: side,
      table: { title: 'By property', sub: 'Taxable and exempt nights', cols: cols, rows: rows, total: { v: totRow } },
      summary: [['Tax collected', fmt.money(tax)], ['Foreign room-nights', fmt.num(fn)], ['Foreign stays', fmt.num(fs.length)], ['Malaysian stays (exempt)', fmt.num(ds.length)]],
      notes: 'Tourism tax is RM ' + TAX_PER_NIGHT + ' per room per night for foreign guests; Malaysian guests are exempt. It is collected for the Royal Malaysian Customs Department, passed through and not counted as revenue.',
      insight: '<b>' + fmt.money(tax) + '</b> collected on ' + fmt.num(fn) + ' foreign room-nights. This is passed through to Customs and is not revenue.'
    };
  };

  /* ------------------------------------------------------------------ rendering */
  function sortedRows(rep) {
    var rows = rep.table.rows.slice(), s = st.sort;
    if (!s || s.report !== st.report || s.col >= rep.table.cols.length) return rows;
    var col = rep.table.cols[s.col];
    rows.sort(function (a, b) {
      var x = a.v[s.col], y = b.v[s.col];
      if (x == null) return 1; if (y == null) return -1;
      var r = isNum(col) ? x - y : String(x).localeCompare(String(y));
      return s.dir * r;
    });
    return rows;
  }
  function tableHTML(rep) {
    var t = rep.table, s = st.sort && st.sort.report === st.report ? st.sort : null;
    if (!t.rows.length) return U.empty('Nothing to show for this range.');
    var head = '<tr>' + t.cols.map(function (c, i) { return '<th class="sort' + (isNum(c) ? ' num' : '') + '" data-sort="' + i + '" aria-sort="' + (s && s.col === i ? (s.dir > 0 ? 'ascending' : 'descending') : 'none') + '">' + esc(c.label) + (s && s.col === i ? '<span class="ar">' + (s.dir > 0 ? '▲' : '▼') + '</span>' : '') + '</th>'; }).join('') + '</tr>';
    var body = sortedRows(rep).map(function (r) {
      return '<tr>' + t.cols.map(function (c, i) { return '<td class="' + (isNum(c) ? 'num' : '') + '">' + (r.h && r.h[i] != null ? r.h[i] : cellHTML(c, r.v[i])) + '</td>'; }).join('') + '</tr>';
    }).join('');
    var foot = t.total && t.rows.length > 1 ? '<tfoot><tr>' + t.cols.map(function (c, i) { var v = t.total.v[i]; return '<td class="' + (isNum(c) ? 'num' : '') + '">' + (v === '' ? '' : cellHTML(c, v)) + '</td>'; }).join('') + '</tr></tfoot>' : '';
    return '<div class="table-wrap"><table class="table"><thead>' + head + '</thead><tbody>' + body + '</tbody>' + foot + '</table></div>';
  }

  function exportRows(rep) {
    var t = rep.table;
    var rows = [t.cols.map(function (c) { return c.label; })];
    sortedRows(rep).forEach(function (r) { rows.push(t.cols.map(function (c, i) { return cellCSV(c, r.v[i]); })); });
    if (t.total && t.rows.length > 1) rows.push(t.cols.map(function (c, i) { return t.total.v[i] === '' ? '' : cellCSV(c, t.total.v[i]); }));
    return rows;
  }
  function fileBase(r) { return (O.ws().name + '-' + REP[st.report].name + '-report-' + r.from + '-to-' + r.to).toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
  function scopeText() { return st.pid ? D.propById[st.pid].name : 'All ' + D.properties.length + ' properties'; }

  function doCSV(rep, r) {
    var rows = [[REP[st.report].name + ' report', rangeText(r)], ['Scope', scopeText()], []].concat(rep.summary.map(function (s) { return [s[0], s[1]]; })).concat([[]]).concat(exportRows(rep));
    O.downloadCSV(fileBase(r) + '.csv', rows);
  }
  function doPDF(rep, r, c) {
    var t = rep.table, totalW = sum(t.cols, function (x) { return x.w || 20; });
    var cols = t.cols.map(function (x) { return { label: x.label, w: (x.w || 20) * 186 / totalW, align: isNum(x) ? 'right' : undefined }; });
    var rows = sortedRows(rep).map(function (row) { return t.cols.map(function (x, i) { return cellText(x, row.v[i]); }); });
    if (t.total && t.rows.length > 1) rows.push(t.cols.map(function (x, i) { return t.total.v[i] === '' ? '' : cellText(x, t.total.v[i]); }));
    O.pdf.report({
      filename: fileBase(r) + '.pdf', title: REP[st.report].name + ' report', subtitle: rangeText(r) + ' · ' + scopeText(),
      summary: rep.summary, columns: cols, rows: rows, boldLast: !!t.total && t.rows.length > 1,
      notes: (c ? 'Comparison: ' + rangeText(c) + ' (' + compName() + '). ' : '') + (rep.pdfNote ? rep.pdfNote + ' ' : '') + (rep.notes || '') + ' Figures come from bookings, reviews, tasks and expenses recorded in ' + O.ws().name + '.'
    });
  }

  function scheduleModal() {
    var rep = REP[st.report];
    U.modal({
      title: 'Email this report on a schedule', sub: rep.name + ' report · ' + scopeText(),
      body: '<div class="form-grid"><div class="field"><label for="rp-freq">How often</label><select id="rp-freq" class="select"><option>Every Monday (last 7 days)</option><option selected>1st of each month (last month)</option><option>Every quarter (last quarter)</option></select></div>' +
        '<div class="field"><label for="rp-fmt">Format</label><select id="rp-fmt" class="select"><option>PDF and CSV</option><option>PDF only</option><option>CSV only</option></select></div>' +
        '<div class="field full"><label for="rp-to">Send to</label><input id="rp-to" class="input" value="' + esc(O.viewer().name.toLowerCase().replace(/\s+/g, '.') + '@' + O.ws().domain.replace(/^stay\.|^otto\./, '')) + '"><div class="hint">Separate several addresses with commas.</div></div></div>' +
        '<div class="note" style="margin-top:12px">Prototype: scheduled emails are not really sent.</div>',
      actions: [{ label: 'Cancel' }, {
        label: 'Save schedule', kind: 'primary', onClick: function (close, el) {
          var to = O.$('#rp-to', el).value.trim(); if (!to) { U.toast('Add at least one email address', 'bad'); return false; }
          U.toast(rep.name + ' report scheduled: ' + O.$('#rp-freq', el).value.toLowerCase() + ' to ' + to);
        }
      }]
    });
  }

  function render(root, ctx) {
    if (ctx.params && ctx.params.report && REP[ctx.params.report] && ctx.fresh) st.report = ctx.params.report;
    var r = range(), c = compRange(r), owner = O.isOwner();
    var rep = REP[st.report], locked = rep.owner && !owner;

    var cards = REPORTS.map(function (x) {
      var lk = x.owner && !owner, h = lk ? null : headline(x.id, r);
      return '<button type="button" class="rp-card' + (x.id === st.report ? ' on' : '') + '" data-rep="' + x.id + '" aria-pressed="' + (x.id === st.report) + '" title="' + esc(x.desc) + '">' +
        '<span class="rc-top">' + O.icon(x.icon) + '<span class="rc-name">' + esc(x.short || x.name) + '</span></span>' +
        (lk ? '<span class="rc-val">🔒</span><span class="rc-sub">Owners only</span>' : '<span class="rc-val">' + h[0] + '</span><span class="rc-sub">' + esc(h[1]) + '</span>') + '</button>';
    }).join('');

    var bar = '<div class="rp-bar"><div class="grp"><span data-slot="range"></span></div>' +
      '<div class="grp"><span class="lbl">Compare with</span><div class="seg rp-cmp" role="group" aria-label="Compare with">' + COMPARE.map(function (x) { return '<button type="button" data-cmp="' + x[0] + '" class="' + (x[0] === st.compare ? 'on' : '') + '" aria-pressed="' + (x[0] === st.compare) + '"><span class="l">' + esc(x[1]) + '</span><span class="s">' + esc(x[2]) + '</span></button>'; }).join('') + '</div></div>' +
      '<div class="grp"><label class="sr-only" for="rp-prop">Property</label><select id="rp-prop" class="select">' + U.propOptions(st.pid, { all: 'All properties' }) + '</select></div></div>';

    var html = '<div class="pg-reports">' + '<div class="rp-cards" role="tablist" aria-label="Reports">' + cards + '</div>' + bar;
    var built = null;
    if (locked) {
      html += '<div class="card"><div class="card-body">' + U.locked(rep.name + ' report') + '</div></div>';
    } else {
      built = BUILD[st.report](r, c);
      html += '<div class="rp-sum">' + built.insight + (c ? ' <span class="muted">Compared with ' + esc(rangeText(c)) + '.</span>' : '') + (clampNote ? ' <span class="muted">' + esc(clampNote) + '</span>' : '') + '</div>' +
        U.kpis(built.kpis) +
        '<div class="grid g-2-1 rp-main">' +
        '<div class="card"><div class="card-head"><div class="hd"><h3>' + esc(built.chartTitle) + '</h3><div class="sub">' + esc(built.chartSub) + '</div></div></div><div class="card-body"><div class="rp-chart"></div>' + (built.chart.legend ? '<div class="rp-legend">' + built.chart.legend + '</div>' : '') + '</div></div>' +
        '<div class="card"><div class="card-head"><div class="hd"><h3>' + esc(built.side.title) + '</h3><div class="sub">' + esc(built.side.sub) + '</div></div></div><div class="card-body' + (built.side.flush ? ' flush' : '') + '">' + built.side.html + '</div></div>' +
        '</div>' +
        '<div class="card" style="margin-top:14px"><div class="card-head"><div class="hd"><h3>' + esc(built.table.title) + '</h3><div class="sub">' + esc(built.table.sub) + ' · ' + esc(rangeText(r)) + ' · tap a column to sort</div></div>' +
        '<div class="rp-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="csv">' + O.icon('download') + 'CSV</button><button type="button" class="btn btn-ghost btn-sm" data-act="pdf">' + O.icon('file') + 'PDF</button></div></div>' +
        '<div class="card-body flush tbl">' + tableHTML(built) + '</div>' +
        (built.notes ? '<div class="card-foot">' + esc(built.notes) + '</div>' : '') + '</div>';
    }
    html += '</div>';
    root.innerHTML = html;

    U.mount(root, 'range', U.dateRange({
      from: st.from, to: st.to, preset: st.preset, presets: 'past',
      onChange: function (v) { st.from = v.from; st.to = v.to; st.preset = v.preset; render(root, ctx); }
    }));
    if (built) {
      var chEl = O.$('.rp-chart', root);
      built.chart.draw(chEl);
      O.$('.rp-main', root).classList.add('drawn');
    }

    var acts = O.html('<div class="row-flex rp-actions-top" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-ghost btn-sm" data-top="schedule"' + (locked ? ' disabled' : '') + '>' + O.icon('mail') + 'Schedule</button><button type="button" class="btn btn-ghost btn-sm" data-top="csv"' + (locked ? ' disabled' : '') + '>' + O.icon('download') + 'Export CSV</button><button type="button" class="btn btn-primary btn-sm" data-top="pdf"' + (locked ? ' disabled' : '') + '>' + O.icon('file') + 'Export PDF</button></div>');
    acts.addEventListener('click', function (e) {
      var b = e.target.closest('[data-top]'); if (!b || !built) return;
      if (b.dataset.top === 'csv') doCSV(built, r); else if (b.dataset.top === 'pdf') doPDF(built, r, c); else scheduleModal();
    });
    ctx.setActions(acts);

    root.onclick = function (e) {
      var t = e.target.closest('[data-rep]');
      if (t) { st.report = t.dataset.rep; render(root, ctx); var on = O.$('.rp-card.on', root); if (on && on.scrollIntoView && window.innerWidth <= 1200) on.scrollIntoView({ inline: 'center', block: 'nearest' }); return; }
      t = e.target.closest('[data-cmp]');
      if (t) { st.compare = t.dataset.cmp; render(root, ctx); return; }
      t = e.target.closest('[data-sort]');
      if (t) { var i = +t.dataset.sort, s = st.sort; st.sort = { report: st.report, col: i, dir: s && s.report === st.report && s.col === i ? -s.dir : (isNum(built.table.cols[i]) ? -1 : 1) }; O.$('.tbl', root).innerHTML = tableHTML(built); return; }
      t = e.target.closest('[data-act]');
      if (t && built) { if (t.dataset.act === 'csv') doCSV(built, r); else doPDF(built, r, c); return; }
      t = e.target.closest('[data-go]');
      if (t) O.go(t.dataset.go);
    };
    var sel = O.$('#rp-prop', root);
    sel.onchange = function () { st.pid = sel.value; render(root, ctx); };
  }

  O.page('reports', {
    desc: 'Portfolio reports with a date range, comparisons and CSV or PDF export',
    render: render
  });
})();
