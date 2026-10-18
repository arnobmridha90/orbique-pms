/* Reports: a library of reports grouped by type (Financial; Bookings & occupancy; Guests & reviews; Operations;
   Owners; Inventory) with a short description and a search box. Opening a report shows a date range with presets,
   a comparison choice, a property filter, then the report: insight line, KPIs, chart, breakdown, sortable table,
   CSV and PDF export.
   Permissions: reports (view), reports.money (financial reports and money columns), reports.export (CSV, PDF, schedule).
   The Inventory report reads D.invMoves ('out' moves) and D.itemById directly; the Owners report uses O.ownerFinance
   from pages/owner.js. */
(function () {
  var O = window.O, D = O.data, M = O.metrics, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  var st = { view: 'library', q: '', report: 'occupancy', preset: 'last30', from: null, to: null, compare: 'prev', pid: '', sort: null, invView: 'unit', invMetric: 'qty' };

  O.css('reports', [
    /* library */
    '.pg-reports .rl-top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;}',
    '.pg-reports .rl-top .search{width:380px;max-width:100%;height:40px;}',
    '.pg-reports .rl-top .search input{font-size:14px;}',
    '.pg-reports .rl-top .cnt{font-size:12.5px;color:var(--muted);}',
    '.pg-reports .rl-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:stretch;}',
    '.pg-reports .rl-group{display:flex;flex-direction:column;}',
    '.pg-reports .rl-gh{display:flex;align-items:center;gap:11px;min-width:0;}',
    '.pg-reports .rl-gi{width:34px;height:34px;border-radius:10px;background:var(--brand-soft);color:var(--brand-text);display:flex;align-items:center;justify-content:center;flex-shrink:0;}',
    '.pg-reports .rl-gi svg{width:17px;height:17px;}',
    '.pg-reports .rl-item{display:flex;align-items:center;gap:12px;width:100%;padding:12px 16px;min-height:56px;border:none;border-top:1px solid var(--border);background:none;text-align:left;font:inherit;color:var(--text);cursor:pointer;}',
    '.pg-reports .rl-list .rl-item:first-child{border-top:none;}',
    '.pg-reports .rl-item:hover{background:var(--surface-2);}',
    '.pg-reports .rl-item:focus-visible{outline:2px solid var(--brand-strong);outline-offset:-2px;}',
    '.pg-reports .rl-item .tx{flex:1;min-width:0;}',
    '.pg-reports .rl-item .nm{font-weight:700;font-size:13.5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}',
    '.pg-reports .rl-item .ds{font-size:12px;color:var(--muted);margin-top:2px;line-height:1.4;}',
    '.pg-reports .rl-item .go{color:var(--faint);flex-shrink:0;display:flex;}',
    '.pg-reports .rl-item .go svg{width:16px;height:16px;}',
    '.pg-reports .rl-item mark{background:var(--accent-soft);color:inherit;border-radius:3px;padding:0 1px;}',
    '.pg-reports .empty .e-icon{display:flex;justify-content:center;color:var(--faint);}',
    '.pg-reports .empty .e-icon svg{width:26px;height:26px;}',
    '.pg-reports .rl-start{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:16px;}',
    '.pg-reports .rl-start .tx{flex:1;min-width:220px;}',
    /* report header */
    '.pg-reports .rp-head{display:flex;align-items:center;gap:14px;margin-bottom:14px;flex-wrap:wrap;}',
    '.pg-reports .rp-head .rp-ttl{flex:1;min-width:220px;}',
    '.pg-reports .rp-head .crumb{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);}',
    '.pg-reports .rp-head h2{font-family:var(--font-head);font-size:19px;font-weight:800;margin:1px 0 0;}',
    '.pg-reports .rp-head .ds{font-size:12.5px;color:var(--text-2);margin-top:2px;}',
    '.pg-reports .rp-head .rp-switch{width:auto;min-width:220px;}',
    '.pg-reports .rp-head .btn svg{width:15px;height:15px;}',
    '.pg-reports .rp-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;}',
    '.pg-reports .rp-bar .lbl{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;}',
    '.pg-reports .rp-bar .grp{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
    '.pg-reports .rp-bar .select{width:auto;min-width:170px;}',
    '.pg-reports .rp-sum{font-size:12.5px;color:var(--text-2);margin:-4px 0 12px;line-height:1.5;}',
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
    '.pg-reports .rp-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}',
    '.pg-reports .rp-actions .btn svg,.rp-actions-top .btn svg{width:15px;height:15px;}',
    '.pg-reports .rp-actions .seg button{padding:5px 10px;font-size:12px;}',
    '@media (max-width:760px){.pg-reports .tbl .table td:first-child{white-space:nowrap;}}',
    '.pg-reports .mini-table td,.pg-reports .mini-table th{padding:7px 10px;}',
    /* horizontal bar chart (units, owners) */
    '.pg-reports .rp-hb{display:flex;flex-direction:column;gap:9px;}',
    '.pg-reports .rp-hb-row{display:grid;grid-template-columns:minmax(90px,170px) minmax(0,1fr) auto;gap:10px;align-items:center;font-size:12.5px;}',
    '.pg-reports .rp-hb-row .l{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.pg-reports .rp-hb-row .l .prop-dot{margin-right:7px;vertical-align:0;}',
    '.pg-reports .rp-hb-row .bars{display:flex;flex-direction:column;gap:2px;}',
    '.pg-reports .rp-hb-row .bars i{display:block;height:10px;border-radius:0 4px 4px 0;min-width:2px;}',
    '.pg-reports .rp-hb-row .bars i.cur{background:var(--brand-strong);}',
    '.pg-reports .rp-hb-row .bars i.prev{background:var(--c-prev1);height:5px;}',
    '.pg-reports .rp-hb-row .v{font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap;text-align:right;min-width:56px;}',
    /* unit x product matrix */
    '.pg-reports .rp-matrix th.uc{white-space:normal;min-width:66px;max-width:92px;line-height:1.25;vertical-align:bottom;}',
    '.pg-reports .rp-matrix td.hc{font-variant-numeric:tabular-nums;}',
    '.pg-reports .rp-matrix td.hc.top{font-weight:800;}',
    '.pg-reports .rp-matrix td:first-child{min-width:190px;}',
    '.pg-reports .rp-matrix td,.pg-reports .rp-matrix th{padding-left:8px;padding-right:8px;}',
    '.pg-reports .rp-matrix td:first-child,.pg-reports .rp-matrix th:first-child{padding-left:16px;}',
    '.pg-reports .rp-matrix .cat{display:block;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;}',
    '.pg-reports .top-items{font-size:12px;color:var(--text-2);min-width:180px;}',
    '.pg-reports .lnk{background:none;border:none;padding:0;font:inherit;font-weight:700;color:var(--text);cursor:pointer;text-align:left;}',
    '.pg-reports .lnk:hover{color:var(--brand-text);text-decoration:underline;}',
    '.pg-reports .rl-item .pill svg{width:11px;height:11px;}',
    '@media (max-width:1100px){.pg-reports .rl-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}',
    '@media (max-width:640px){.pg-reports .rl-grid{grid-template-columns:minmax(0,1fr);}.pg-reports .rl-top .search{width:100%;}}',
    '@media (max-width:560px){.pg-reports .rp-bar .select{flex:1;min-width:0;}.pg-reports .rp-bar .grp{width:100%;}.pg-reports .rp-bar .lbl{width:100%;}.pg-reports .rp-cmp{flex:1;flex-wrap:nowrap;}.pg-reports .rp-cmp button{flex:1;white-space:nowrap;}.pg-reports .rp-cmp .l{display:none;}.pg-reports .rp-cmp .s{display:inline;}' +
      '.pg-reports .rp-head{gap:10px;}.pg-reports .rp-head .rp-ttl{order:3;flex-basis:100%;}.pg-reports .rp-head .rp-switch{flex:1;min-width:0;}.pg-reports .rp-head h2{font-size:17px;}.pg-reports .rp-hb-row{grid-template-columns:minmax(80px,110px) minmax(0,1fr) auto;}.pg-reports .card-head{flex-wrap:wrap;}}'
  ].join('\n'));

  /* ------------------------------------------------------------------ the library */
  var GROUPS = [
    { id: 'financial', name: 'Financial', icon: 'financials', desc: 'Money earned, spent and passed through' },
    { id: 'bookings', name: 'Bookings & occupancy', icon: 'bookings', desc: 'How full the units are and how guests book' },
    { id: 'guests', name: 'Guests & reviews', icon: 'star', desc: 'Who stays and what they say' },
    { id: 'operations', name: 'Operations', icon: 'tasks', desc: 'Turnovers, changeovers and tasks' },
    { id: 'owners', name: 'Owners', icon: 'owner', desc: 'What each property owner earns' },
    { id: 'inventory', name: 'Inventory', icon: 'inventory', desc: 'Supplies used in each unit' }
  ];
  var REPORTS = [
    { id: 'revenue', need: 'bookings', group: 'financial', name: 'Revenue', icon: 'financials', money: true, desc: 'Revenue, ADR, RevPAR and platform fees by property', kw: 'income sales adr revpar fees commission earnings' },
    { id: 'expenses', need: 'expenses', group: 'financial', name: 'Expenses', icon: 'expenses', money: true, desc: 'Spending by type and person, operating costs and capital spending', kw: 'costs spend opex capex claims receipts' },
    { id: 'tax', need: 'bookings', group: 'financial', name: 'Tourism tax', icon: 'invoices', money: true, desc: 'Tax collected from foreign guests and the monthly returns', kw: 'ttx customs myttx foreign levy' },
    { id: 'occupancy', need: 'bookings', group: 'bookings', name: 'Occupancy', icon: 'calendar', desc: 'Nights sold against nights available, weekends and length of stay', kw: 'nights sold available blocked weekend' },
    { id: 'pace', need: 'bookings', group: 'bookings', name: 'Booking pace', icon: 'clock', desc: 'Bookings made, how far ahead guests book and cancellations', kw: 'lead time cancellations same-day new bookings' },
    { id: 'channels', need: 'bookings', group: 'bookings', name: 'Channels', icon: 'website', desc: 'Where nights come from: Airbnb, Booking.com, Agoda, Vrbo and direct', kw: 'airbnb booking.com agoda vrbo direct ota platforms mix' },
    { id: 'guests', need: 'bookings', group: 'guests', name: 'Guests & origin', icon: 'user', desc: 'Arrivals by country, party size and length of stay', kw: 'countries nationality international domestic party' },
    { id: 'reviews', need: 'reviews', group: 'guests', name: 'Reviews', icon: 'star', desc: 'Ratings, sub-scores and replies by property and platform', kw: 'ratings stars cleanliness replies feedback' },
    { id: 'operations', need: 'bookings', group: 'operations', name: 'Turnovers & tasks', icon: 'tasks', desc: 'Check-ins, turnovers, back-to-back changeovers and tasks done on time', kw: 'cleaning housekeeping turnover check-in tasks overdue' },
    { id: 'owners', need: 'bookings', group: 'owners', name: 'Owner payouts', icon: 'owner', money: true, desc: 'Revenue, fees, costs and payout for each property owner', kw: 'owner statements payouts management fee landlord' },
    { id: 'inventory', need: 'stock', group: 'inventory', name: 'Stock used by unit', icon: 'inventory', desc: 'Which unit used which products most, with quantities and cost', kw: 'inventory stock supplies toiletries consumables products items usage' }
  ];
  var REP = {}; REPORTS.forEach(function (r) { REP[r.id] = r; });
  var GRP = {}; GROUPS.forEach(function (g) { GRP[g.id] = g; });
  var COMPARE = [['prev', 'Previous period', 'Previous'], ['lastMonth', 'Same period last month', 'Last month'], ['none', 'No comparison', 'None']];
  var TAX_PER_NIGHT = 10;

  /* ------------------------------------------------------------------ permissions */
  function canMoney() { return O.can('reports.money'); }
  function canExport() { return O.can('reports.export'); }
  function locked(rep) { return !!rep.money && !canMoney(); }
  var WHY_EXPORT = 'Downloading reports needs the "Download reports" permission (Staff access)';

  /* 'Fee rates: Airbnb, Booking.com and Agoda 15%, Vrbo 8%, direct bookings 3% card fees.' built from D.channels */
  function feeNote() {
    var g = {}, order = [];
    U.channelsInUse().forEach(function (ch) { if (ch === 'direct' || !D.channels[ch]) return; var k = String(Math.round(D.channels[ch].feePct * 100)); if (!g[k]) { g[k] = []; order.push(k); } g[k].push(D.channels[ch].name); });
    var parts = order.map(function (k) { var n = g[k]; return (n.length > 1 ? n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1] : n[0]) + ' ' + k + '%'; });
    return 'Fee rates: ' + parts.join(', ') + ' commission on the room rate; direct bookings ' + Math.round(((D.channels.direct || {}).feePct || 0) * 100) + '% card fees.';
  }

  /* records start on D.DATA_START (moved with the demo); ranges are counted from then so empty months do not dilute the numbers */
  var clampNote = '';
  function dataStart() { return D.bookings.length || D.expenses.length || (D.invMoves || []).length ? D.DATA_START : null; }
  function range() {
    if (!st.from) { var p = U.preset(st.preset || 'last30'); st.from = p.from; st.to = p.to; }
    clampNote = '';
    var ds = dataStart(), from = st.from, to = st.to > D.TODAY ? D.TODAY : st.to;
    if (ds && to < ds) { to = d.add(ds, 29); if (to > D.TODAY) to = D.TODAY; clampNote = 'Records start on ' + d.fmtY(ds) + ', so the first 30 days are shown.'; from = ds; }
    else if (ds && from < ds) { from = ds; clampNote = 'Records start on ' + d.fmtY(ds) + ', so the range is counted from then.'; }
    if (to < from) to = from;
    return { from: from, to: to };
  }
  function compRange(r) {
    if (st.compare === 'none') return null;
    var c, ds = dataStart();
    if (st.compare === 'lastMonth') c = { from: d.addMonths(r.from, -1), to: d.addMonths(r.to, -1) };
    else { var len = d.diff(r.from, r.to) + 1; c = { from: d.add(r.from, -len), to: d.add(r.from, -1) }; }
    if (ds && c.from < ds) { clampNote += (clampNote ? ' ' : '') + 'No comparison: the ' + compName() + ' falls before records start on ' + d.fmtY(ds) + '.'; return null; }
    return c;
  }
  function rangeText(r) { return U.rangeLabel(r.from, r.to); }
  function compName() { return st.compare === 'lastMonth' ? 'same period last month' : 'previous period'; }
  function moneyAxis(v, ax) { if (!ax || v < 10000) return fmt.money(v); var k = v / 1000; return fmt.cur() + ' ' + (k % 1 === 0 ? k : (k * 10) % 1 === 0 ? k.toFixed(1) : k.toFixed(2)) + 'k'; }
  function countAxis(v, ax) { return v % 1 ? (ax ? '' : v.toFixed(1)) : String(v); }
  /* what a report needs before it can say anything: shown as an empty state when the workspace has none at all */
  var NEEDS = {
    bookings: { has: function () { return D.bookings.length > 0; }, text: 'No bookings yet, so this report has nothing to show.', page: 'bookings', label: 'Open bookings' },
    expenses: { has: function () { return D.expenses.length > 0; }, text: 'No expenses recorded yet, so this report has nothing to show.', page: 'expenses', label: 'Open expenses' },
    reviews: { has: function () { return D.reviews.length > 0; }, text: 'No reviews yet, so this report has nothing to show.', page: 'reviews', label: 'Open reviews' },
    stock: { has: function () { return (D.invMoves || []).some(function (m) { return m.dir === 'out'; }); }, text: 'No stock has been logged as used yet, so this report has nothing to show.', page: 'inventory', label: 'Open inventory' }
  };
  function chg(cur, prev) { return prev > 0 ? (cur - prev) / prev : null; } /* a change from zero or a negative base is not meaningful */
  /* 'up 8.0%' / 'down 8.0%' / 'level' for sentences */
  /* 'up 8.0% on the previous period', or 'nothing to compare in the previous period' when that period had none */
  function cmpPhrase(cur, prev) { return prev > 0 ? chgWords(chg(cur, prev)) + ' on the ' + compName() : 'nothing to compare in the ' + compName(); }
  function chgWords(c) { if (c == null || isNaN(c)) return 'no change'; if (Math.abs(c) < 0.0005) return 'level'; return (c > 0 ? 'up ' : 'down ') + fmt.changeText(c).replace(/^[+−±]/, ''); }
  function f(pid) { return pid ? { propertyId: pid } : null; }
  /* with several currencies a report covers the units in the view currency (O.curSwitchHTML); M's all-unit totals mix
     currencies, so they are summed unit by unit here. One currency: these are M's own functions. */
  function inPid(x, pid) { return pid ? x.propertyId === pid : O.inCur(x); }
  function perUnit(pid) { return !pid && O.multiCur(); }
  function curIds() { return D.properties.filter(O.inCur).map(function (p) { return p.id; }); }
  function mRev(a, z, ff) { ff = ff || {}; return perUnit(ff.propertyId) ? sum(curIds(), function (id) { return M.revenue(a, z, { propertyId: id, channel: ff.channel }); }) : M.revenue(a, z, ff); }
  function mSold(a, z, ff) { ff = ff || {}; return perUnit(ff.propertyId) ? sum(curIds(), function (id) { return M.nightsSold(a, z, { propertyId: id, channel: ff.channel }); }) : M.nightsSold(a, z, ff); }
  function mAvail(a, z, pid) { return perUnit(pid) ? sum(curIds(), function (id) { return M.availableNights(a, z, id); }) : M.availableNights(a, z, pid); }
  function mBlocked(a, z, pid) { return perUnit(pid) ? sum(curIds(), function (id) { return M.blockedNights(a, z, id); }) : M.blockedNights(a, z, pid); }
  function mOcc(a, z, pid) { if (!perUnit(pid)) return M.occupancy(a, z, pid); var n = mAvail(a, z); return n ? mSold(a, z) / n : 0; }
  function mAdr(a, z, ff) { var n = mSold(a, z, ff); return n ? mRev(a, z, ff) / n : 0; }
  function mRevpar(a, z, pid) { if (!perUnit(pid)) return M.revpar(a, z, pid); var n = mAvail(a, z); return n ? mRev(a, z) / n : 0; }
  function props() { return st.pid ? (D.propById[st.pid] ? [D.propById[st.pid]] : []) : D.properties.filter(O.inCur); }
  function placeOf(p) { return (p && (p.area || p.location)) || ''; }
  function propLabel(p) { if (!p) return 'Unknown unit'; var l = placeOf(p); return p.name + (l ? ' · ' + l : ''); }
  function propCell(p) { return '<span title="' + esc(propLabel(p)) + '"><span class="prop-dot" style="background:' + U.propColor(p.id) + '"></span>' + esc(p.name) + '</span>'; }
  function sum(arr, fn) { return arr.reduce(function (s, x) { return s + (fn ? fn(x) : x); }, 0); }
  function live(b) { return M.live(b); }
  function pidOk(b) { return inPid(b, st.pid); }
  function isCapex(e) { return (e.costClass || 'opex') === 'capex'; }
  function goBtn(page, label) { return O.allowed(page) ? '<button type="button" class="btn btn-ghost btn-sm rp-sfoot" data-go="' + page + '">' + esc(label) + '</button>' : ''; }
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
    if (cb && bk.length && bk[0].kind === 'week' && cb.length !== bk.length) cb = cb.slice(Math.max(0, cb.length - bk.length));
    if (cb) while (cb.length < bk.length) cb.unshift(null);
    var cur = bk.map(function (x) { return fn(x.a, x.b); });
    var prev = cb ? bk.map(function (x, i) { return cb[i] ? fn(cb[i].a, cb[i].b) : null; }) : null;
    return {
      unit: bucketUnit(bk),
      legend: prev ? O.chart.legend([{ name: rangeText(r), tone: 'brand', square: kind === 'bars' }, { name: rangeText(c), tone: 'prev1', square: kind === 'bars' }]) : '',
      draw: function (el) {
        var o = {
          labels: bk.map(function (x) { return x.label; }), height: chartH(el), yFormat: opt.yFormat, padLeft: opt.yFormat === moneyAxis ? 62 : undefined,
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
        if (!labels.length) { el.innerHTML = U.empty(opt.empty || 'Nothing to chart for this range.'); return; }
        O.chart.bars(el, {
          labels: labels, height: chartH(el), yFormat: opt.yFormat, padLeft: opt.yFormat === moneyAxis ? 62 : undefined, xFormat: opt.xFormat, ariaLabel: opt.aria,
          series: prev ? [{ name: rangeText(c), values: prev, tone: 'prev1' }, { name: rangeText(r), values: cur, tone: 'brand' }] : [{ name: rangeText(r), values: cur, tone: 'brand' }]
        });
      }
    };
  }
  /* horizontal bars for long category names (units, owners): rows [{label (html), name, cur, prev, display, prevDisplay}] */
  function hbarChart(rows, r, c, opt) {
    opt = opt || {};
    var max = Math.max.apply(null, rows.map(function (x) { return Math.max(x.cur || 0, c ? x.prev || 0 : 0); }).concat([1]));
    function w(v) { return Math.max(0, Math.min(100, (v || 0) / max * 100)).toFixed(1); }
    return {
      unit: '',
      legend: c && rows.length ? O.chart.legend([{ name: rangeText(r), tone: 'brand', square: true }, { name: rangeText(c), tone: 'prev1', square: true }]) : '',
      draw: function (el) {
        el.innerHTML = rows.length ? '<div class="rp-hb" role="list" aria-label="' + esc(opt.aria || '') + '">' + rows.map(function (x) {
          var tip = x.name + ': ' + x.display + (c ? ' (' + rangeText(c) + ': ' + x.prevDisplay + ')' : '');
          return '<div class="rp-hb-row" role="listitem" title="' + esc(tip) + '"><div class="l">' + x.label + '</div><div class="bars"><i class="cur" style="width:' + w(x.cur) + '%"></i>' + (c ? '<i class="prev" style="width:' + w(x.prev) + '%"></i>' : '') + '</div><div class="v">' + x.display + '</div></div>';
        }).join('') + '</div>' : U.empty(opt.empty || 'Nothing to chart for this range.');
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
      case 'delta': return (v * 100).toFixed(1) + '%'; /* plain number so spreadsheets read it */
      case 'pts': return (v * 100).toFixed(1) + ' pts';
      default: return v;
    }
  }
  function isNum(col) { return col.type && col.type !== 'text' && col.type !== 'html'; }

  function weekendOcc(r, pid) {
    var sold = 0, avail = 0;
    d.range(r.from, r.to).forEach(function (x) { if (!d.isWeekend(x)) return; sold += mSold(x, x, f(pid)); avail += mAvail(x, x, pid || undefined); });
    return avail ? sold / avail : 0;
  }
  function staysStarting(r, pid) { return D.bookings.filter(function (b) { return live(b) && inPid(b, pid) && b.checkIn >= r.from && b.checkIn <= r.to; }); }
  function fees(r, pid, ch) {
    return D.bookings.reduce(function (s, b) { if (!live(b) || !inPid(b, pid) || (ch && b.channel !== ch)) return s; var n = M.nightsIn(b, r.from, r.to); return s + (n ? b.platformFee / b.nights * n : 0); }, 0);
  }
  function taxIn(r, pid) {
    return D.bookings.reduce(function (s, b) { if (!live(b) || !b.guest || !b.guest.foreign || !inPid(b, pid) || !O.tourismTaxApplies(b)) return s; return s + M.nightsIn(b, r.from, r.to) * TAX_PER_NIGHT; }, 0);
  }
  function foreignNights(r, pid) {
    return D.bookings.reduce(function (s, b) { if (!live(b) || !b.guest || !b.guest.foreign || !inPid(b, pid) || !O.tourismTaxApplies(b)) return s; return s + M.nightsIn(b, r.from, r.to); }, 0);
  }
  function created(r, pid, incCancelled) {
    return D.bookings.filter(function (b) { var c = String(b.createdAt || '').slice(0, 10); return c >= r.from && c <= r.to && inPid(b, pid) && (incCancelled || live(b)); });
  }
  function leadDays(b) { return Math.max(0, d.diff(String(b.createdAt || b.checkIn).slice(0, 10), b.checkIn)); }
  function reviewsIn(r, pid) { return D.reviews.filter(function (x) { return x.date >= r.from && x.date <= r.to && inPid(x, pid); }); }
  function expensesIn(r, pid) { return M.expenses(r.from, r.to).filter(function (e) { return inPid(e, pid); }); }
  function avg(arr, fn) { return arr.length ? sum(arr, fn) / arr.length : null; }
  function turnoversIn(r, pid) { return D.bookings.filter(function (b) { return live(b) && inPid(b, pid) && b.checkOut >= r.from && b.checkOut <= r.to; }); }
  function backToBack(r, pid) {
    return turnoversIn(r, pid).filter(function (b) { return D.bookings.some(function (x) { return live(x) && x.propertyId === b.propertyId && x.checkIn === b.checkOut && x.id !== b.id; }); });
  }
  function shortT(t) { return t.replace(' & maintenance', '').replace(' & amenities', '').replace(' & equipment', '').replace(' & subscriptions', '').replace('Cleaning supplies', 'Cleaning').replace('Internet & TV', 'Internet'); }

  /* ------------------------------------------------------------------ the reports */
  var BUILD = {};

  BUILD.occupancy = function (r, c) {
    var pid = st.pid, occ = mOcc(r.from, r.to, pid || undefined), occP = c ? mOcc(c.from, c.to, pid || undefined) : null;
    var sold = mSold(r.from, r.to, f(pid)), soldP = c ? mSold(c.from, c.to, f(pid)) : null;
    var avail = mAvail(r.from, r.to, pid || undefined), blocked = mBlocked(r.from, r.to, pid || undefined);
    var we = weekendOcc(r, pid), weP = c ? weekendOcc(c, pid) : null;
    var ss = staysStarting(r, pid), los = avg(ss, function (b) { return b.nights; }), ssP = c ? staysStarting(c, pid) : [], losP = c ? avg(ssP, function (b) { return b.nights; }) : null;
    var weekday = (function () { var s = 0, a = 0; d.range(r.from, r.to).forEach(function (x) { if (d.isWeekend(x)) return; s += mSold(x, x, f(pid)); a += mAvail(x, x, pid || undefined); }); return a ? s / a : 0; })();
    var kpis = [
      { label: 'Occupancy', value: fmt.pct(occ, 1), sub: c ? ptsHTML(occ - occP) + ' vs ' + fmt.pct(occP, 1) : null, hl: true },
      { label: 'Nights sold', value: fmt.num(sold), delta: c ? chg(sold, soldP) : null, sub: c ? 'vs ' + fmt.num(soldP) : null },
      { label: 'Nights available', value: fmt.num(avail), sub: blocked ? fmt.num(blocked) + ' blocked' : 'none blocked' },
      { label: 'Weekend occupancy', value: fmt.pct(we), sub: c ? ptsHTML(we - weP) + ' Fri and Sat' : 'Fri and Sat nights' },
      { label: 'Weekday occupancy', value: fmt.pct(weekday), sub: 'Sun to Thu nights' },
      { label: 'Avg length of stay', value: los ? los.toFixed(1) + ' nights' : '–', delta: c && los && losP ? chg(los, losP) : null, sub: fmt.plural(ss.length, 'arrival') }
    ];
    var chart = seriesChart('line', r, c, function (a, b) { return mOcc(a, b, pid || undefined) * 100; }, { yFormat: function (v) { return Math.round(v) + '%'; }, aria: 'Occupancy over time', yMin: 0 });
    var rows = props().map(function (p) {
      var o = mOcc(r.from, r.to, p.id), oP = c ? mOcc(c.from, c.to, p.id) : null;
      var sl = staysStarting(r, p.id);
      return { pid: p.id, v: [p.name, mSold(r.from, r.to, { propertyId: p.id }), mAvail(r.from, r.to, p.id), o, oP, c ? o - oP : null, weekendOcc(r, p.id), avg(sl, function (b) { return b.nights; })], h: { 0: propCell(p) } };
    });
    var cols = [{ label: 'Property', type: 'text', w: 52 }, { label: 'Nights sold', type: 'num', w: 20 }, { label: 'Available', type: 'num', w: 18 }, { label: 'Occupancy', type: 'pct', dp: 1, w: 20 }];
    if (c) cols.push({ label: 'Before', type: 'pct', dp: 1, w: 18 }, { label: 'Change', type: 'pts', w: 20 });
    cols.push({ label: 'Weekend', type: 'pct', w: 18 }, { label: 'Avg stay', type: 'dec1', w: 18 });
    if (!c) rows.forEach(function (x) { x.v.splice(4, 2); });
    var total = { v: ['All properties' + (st.pid ? '' : ' (' + props().length + ')'), sold, avail, occ].concat(c ? [occP, occ - occP] : []).concat([we, los]) };
    /* side: occupancy by property, sorted */
    var ranked = props().map(function (p) { return { p: p, o: mOcc(r.from, r.to, p.id) }; }).sort(function (a, b) { return b.o - a.o; });
    var side = { title: 'Occupancy by property', sub: 'Highest first', html: '<div class="side-list">' + O.chart.hbars(ranked.map(function (x) { return { label: esc(x.p.short), value: x.o * 100, display: fmt.pct(x.o) }; }), { max: 100 }) + '</div>' };
    return {
      kpis: kpis, chartTitle: 'Occupancy ' + chart.unit, chartSub: 'Share of available nights that were sold', chart: chart, side: side,
      table: { title: 'By property', sub: 'Nights sold, availability and stay length', cols: cols, rows: rows, total: total },
      summary: [['Occupancy', fmt.pct(occ, 1)], ['Nights sold', fmt.num(sold)], ['Nights available', fmt.num(avail)], ['Weekend occupancy', fmt.pct(we)]],
      insight: c ? 'Occupancy is <b>' + fmt.pct(occ, 1) + '</b>, ' + (occ >= occP ? 'up ' : 'down ') + ptsText(Math.abs(occ - occP)).replace(/^[+−±]/, '') + ' on the ' + compName() + '. Weekends run at ' + fmt.pct(we) + ' against ' + fmt.pct(weekday) + ' on weekdays.' : 'Occupancy is <b>' + fmt.pct(occ, 1) + '</b>. Weekends run at ' + fmt.pct(we) + ' against ' + fmt.pct(weekday) + ' on weekdays.'
    };
  };

  BUILD.revenue = function (r, c) {
    var pid = st.pid, rev = mRev(r.from, r.to, f(pid)), revP = c ? mRev(c.from, c.to, f(pid)) : null;
    var adr = mAdr(r.from, r.to, f(pid)), adrP = c ? mAdr(c.from, c.to, f(pid)) : null;
    var rp = mRevpar(r.from, r.to, pid || undefined), rpP = c ? mRevpar(c.from, c.to, pid || undefined) : null;
    var fe = fees(r, pid), feP = c ? fees(c, pid) : null;
    var nights = mSold(r.from, r.to, f(pid));
    var kpis = [
      { label: 'Revenue', value: fmt.money(rev), delta: c ? chg(rev, revP) : null, sub: c ? 'vs ' + fmt.money(revP) : null, hl: true },
      { label: 'ADR', value: fmt.money(adr), delta: c ? chg(adr, adrP) : null, sub: 'per night sold' },
      { label: 'RevPAR', value: fmt.money(rp), delta: c ? chg(rp, rpP) : null, sub: 'per available night' },
      { label: 'Platform fees', value: fmt.money(fe), delta: c ? chg(fe, feP) : null, deltaOpts: { invert: true }, sub: rev ? fmt.pct(fe / rev, 1) + ' of revenue' : null },
      { label: 'Revenue after fees', value: fmt.money(rev - fe), delta: c ? chg(rev - fe, revP - feP) : null },
      { label: 'Nights sold', value: fmt.num(nights), sub: fmt.pct(mOcc(r.from, r.to, pid || undefined)) + ' occupancy' }
    ];
    var chart = seriesChart('bars', r, c, function (a, b) { return mRev(a, b, f(pid)); }, { yFormat: moneyAxis, aria: 'Revenue over time' });
    var rows = props().map(function (p) {
      var rv = mRev(r.from, r.to, { propertyId: p.id }), rvP = c ? mRev(c.from, c.to, { propertyId: p.id }) : null;
      var v = [p.name, rv, mSold(r.from, r.to, { propertyId: p.id }), mAdr(r.from, r.to, { propertyId: p.id }), mRevpar(r.from, r.to, p.id), fees(r, p.id), rv - fees(r, p.id)];
      if (c) v.push(rvP, chg(rv, rvP));
      return { pid: p.id, v: v, h: { 0: propCell(p) } };
    });
    var cols = [{ label: 'Property', type: 'text', w: 44 }, { label: 'Revenue', type: 'money', w: 22 }, { label: 'Nights', type: 'num', w: 13 }, { label: 'ADR', type: 'money', w: 18 }, { label: 'RevPAR', type: 'money', w: 18 }, { label: 'Fees', type: 'money', w: 18 }, { label: 'After fees', type: 'money', w: 22 }];
    if (c) cols.push({ label: 'Before', type: 'money', w: 21 }, { label: 'Change', type: 'delta', w: 14 });
    else cols[0].w = 74;
    var total = { v: ['All properties', rev, nights, adr, rp, fe, rev - fe].concat(c ? [revP, chg(rev, revP)] : []) };
    var byCh = U.channelsInUse().map(function (ch) { return { ch: ch, v: mRev(r.from, r.to, { propertyId: pid, channel: ch }) }; }).sort(function (a, b) { return b.v - a.v; });
    var side = { title: 'Revenue by channel', sub: 'Before platform fees', html: '<div class="side-list">' + O.chart.hbars(byCh.map(function (x) { return { label: U.plat(x.ch), value: x.v, display: fmt.moneyShort(x.v) }; })) + '</div>' };
    return {
      kpis: kpis, chartTitle: 'Revenue ' + chart.unit, chartSub: 'Accommodation and cleaning fees earned on nights in the range', chart: chart, side: side,
      table: { title: 'By property', sub: 'Revenue, rates and fees', cols: cols, rows: rows, total: total },
      summary: [['Revenue', fmt.money(rev)], ['ADR', fmt.money(adr)], ['RevPAR', fmt.money(rp)], ['Platform fees', fmt.money(fe)]],
      insight: 'Revenue is <b>' + fmt.money(rev) + '</b>' + (c ? ', ' + cmpPhrase(rev, revP) : '') + '. ADR ' + fmt.money(adr) + ' on ' + fmt.num(nights) + ' nights sold; platforms kept ' + fmt.money(fe) + '.'
    };
  };

  var LEAD = [['Same day', 0, 0], ['1–3 days', 1, 3], ['4–7 days', 4, 7], ['8–14 days', 8, 14], ['15–30 days', 15, 30], ['31–60 days', 31, 60], ['Over 60 days', 61, 9999]];
  BUILD.pace = function (r, c) {
    var pid = st.pid, money = canMoney();
    var cr = created(r, pid), crP = c ? created(c, pid) : [], all = created(r, pid, true), allP = c ? created(c, pid, true) : [];
    var canc = all.length - cr.length, cancP = allP.length - crP.length;
    var nights = sum(cr, function (b) { return b.nights; }), nightsP = sum(crP, function (b) { return b.nights; });
    var lead = avg(cr, leadDays), leadP = c ? avg(crP, leadDays) : null;
    var value = sum(cr, function (b) { return b.revenue; }), valueP = sum(crP, function (b) { return b.revenue; });
    var same = cr.filter(function (b) { return String(b.createdAt || '').slice(0, 10) === b.checkIn; }).length;
    var kpis = [
      { label: 'Bookings made', value: fmt.num(cr.length), delta: c ? chg(cr.length, crP.length) : null, sub: c ? 'vs ' + crP.length : null, hl: true },
      { label: 'Nights booked', value: fmt.num(nights), delta: c ? chg(nights, nightsP) : null },
      money ? { label: 'Booked value', value: fmt.money(value), delta: c ? chg(value, valueP) : null, sub: 'of new bookings' } : { label: 'Avg stay booked', value: cr.length ? (nights / cr.length).toFixed(1) + ' nights' : '–' },
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
      if (money) v.push(gn ? sum(g, function (b) { return b.accommodation; }) / gn : null);
      if (c) v.push(gP.length);
      return { v: v };
    });
    var cols = [{ label: 'Booked ahead', type: 'text', w: 46 }, { label: 'Bookings', type: 'num', w: 22 }, { label: 'Share', type: 'pct', w: 22 }, { label: 'Nights', type: 'num', w: 22 }, { label: 'Avg stay', type: 'dec1', w: 22 }];
    if (money) cols.push({ label: 'Avg nightly', type: 'money', w: 26 });
    if (c) cols.push({ label: 'Before', type: 'num', w: 20 });
    var tot = ['All bookings', cr.length, cr.length ? 1 : 0, nights, cr.length ? nights / cr.length : null];
    if (money) tot.push(nights ? sum(cr, function (b) { return b.accommodation; }) / nights : null);
    if (c) tot.push(crP.length);
    /* side: which months the new bookings are for */
    var months = {}; cr.forEach(function (b) { var k = b.checkIn.slice(0, 7); months[k] = (months[k] || 0) + 1; });
    var mk = Object.keys(months).sort();
    var side = { title: 'Arrival month of new bookings', sub: 'Where the new demand lands', html: mk.length ? '<div class="side-list">' + O.chart.hbars(mk.map(function (k) { return { label: esc(d.monthName(k + '-01', true) + ' ' + k.slice(0, 4)), value: months[k], display: months[k] + ' bookings' }; })) + '</div>' : U.empty('No bookings were made in this range.') };
    return {
      kpis: kpis, chartTitle: 'Bookings made ' + chart.unit, chartSub: 'By the date the booking was made (cancelled bookings excluded)', chart: chart, side: side,
      table: { title: 'Lead time', sub: 'How far ahead guests booked', cols: cols, rows: rows, total: { v: tot } },
      summary: [['Bookings made', fmt.num(cr.length)], ['Nights booked', fmt.num(nights)], ['Avg lead time', lead != null ? Math.round(lead) + ' days' : '–'], ['Cancellations', fmt.num(canc)]],
      insight: '<b>' + fmt.plural(cr.length, 'booking') + '</b> made' + (c ? ' (' + cmpPhrase(cr.length, crP.length) + ')' : '') + (lead != null ? ', booked on average ' + fmt.plural(Math.round(lead), 'day') + ' before arrival. ' : '. ') + (same ? (same === 1 ? 'One was a same-day booking, made on the day of arrival.' : same + ' were same-day bookings, made on the day of arrival.') : 'No same-day bookings.')
    };
  };

  BUILD.channels = function (r, c) {
    var pid = st.pid, money = canMoney();
    var totN = mSold(r.from, r.to, f(pid)), totR = mRev(r.from, r.to, f(pid));
    var data = U.channelsInUse().map(function (ch) {
      var ff = { propertyId: pid, channel: ch };
      var st0 = D.bookings.filter(function (b) { return live(b) && b.channel === ch && pidOk(b) && M.nightsIn(b, r.from, r.to) > 0; });
      var mk = created(r, pid, true).filter(function (b) { return b.channel === ch; });
      return {
        ch: ch, stays: st0.length, nights: mSold(r.from, r.to, ff), nightsP: c ? mSold(c.from, c.to, ff) : null,
        rev: mRev(r.from, r.to, ff), fee: fees(r, pid, ch), lead: avg(st0, leadDays),
        cancel: mk.length ? mk.filter(function (b) { return !live(b); }).length / mk.length : null
      };
    });
    var top = data.slice().sort(function (a, b) { return b.nights - a.nights; })[0];
    var direct = data.filter(function (x) { return x.ch === 'direct'; })[0];
    var directP = c ? mSold(c.from, c.to, { propertyId: pid, channel: 'direct' }) / (mSold(c.from, c.to, f(pid)) || 1) : null;
    var feeT = sum(data, function (x) { return x.fee; });
    var ota = data.filter(function (x) { return x.ch !== 'direct'; });
    var otaFee = sum(ota, function (x) { return x.fee; }), otaRev = sum(ota, function (x) { return x.rev; });
    var allStays = D.bookings.filter(function (b) { return live(b) && pidOk(b) && M.nightsIn(b, r.from, r.to) > 0; });
    var made = created(r, pid, true), leadAll = avg(allStays, leadDays);
    var kpis = [
      { label: 'Top channel', value: top && top.nights ? esc(U.platName(top.ch)) : '–', sub: top && totN ? fmt.pct(top.nights / totN) + ' of nights' : null, hl: true },
      { label: 'Direct share', value: totN ? fmt.pct(direct.nights / totN, 1) : '–', sub: c && totN ? ptsHTML(direct.nights / totN - directP) + ' vs ' + fmt.pct(directP, 1) : 'no OTA commission' },
      { label: 'Nights sold', value: fmt.num(totN), delta: c ? chg(totN, mSold(c.from, c.to, f(pid))) : null },
      money ? { label: 'OTA commission', value: fmt.money(otaFee), sub: otaRev ? fmt.pct(otaFee / otaRev, 1) + ' of OTA revenue' : null } : { label: 'Channels used', value: String(data.filter(function (x) { return x.nights; }).length), sub: 'of ' + data.length + ' connected' },
      { label: 'OTA share', value: totN ? fmt.pct(1 - direct.nights / totN) : '–', sub: 'of nights, via OTAs', title: 'Airbnb, Booking.com, Agoda and Vrbo' }
    ];
    var chart = catChart(data.map(function (x) { return U.platName(x.ch); }), data.map(function (x) { return x.nights; }), c ? data.map(function (x) { return x.nightsP; }) : null, r, c, { aria: 'Nights sold by channel', yFormat: countAxis });
    var cols = [{ label: 'Channel', type: 'text', w: 30 }, { label: 'Stays', type: 'num', w: 14 }, { label: 'Nights', type: 'num', w: 16 }, { label: 'Share', type: 'pct', w: 16 }];
    if (money) cols.push({ label: 'Revenue', type: 'money', w: 22 }, { label: 'Fees', type: 'money', w: 22 }, { label: 'After fees', type: 'money', w: 22 }, { label: 'ADR', type: 'money', w: 16 });
    cols.push({ label: 'Lead (days)', type: 'num', w: 16 }, { label: 'Cancelled', type: 'pct', w: 14 });
    if (!money) { cols[0].w = 60; cols.forEach(function (x, i) { if (i) x.w = 21; }); }
    var rows = data.map(function (x) {
      var v = [U.platName(x.ch), x.stays, x.nights, totN ? x.nights / totN : 0];
      if (money) v.push(x.rev, x.fee, x.rev - x.fee, x.nights ? x.rev / x.nights : null);
      v.push(x.lead != null ? Math.round(x.lead) : null, x.cancel);
      return { v: v, h: { 0: U.plat(x.ch) } };
    });
    var tot = ['All channels', sum(data, function (x) { return x.stays; }), totN, totN ? 1 : 0];
    if (money) tot.push(totR, feeT, totR - feeT, totN ? totR / totN : null);
    tot.push(leadAll != null ? Math.round(leadAll) : null, made.length ? made.filter(function (b) { return !live(b); }).length / made.length : null);
    var side = { title: 'Share of nights', sub: rangeText(r), html: '<div class="side-list">' + O.chart.hbars(data.slice().sort(function (a, b) { return b.nights - a.nights; }).map(function (x) { return { label: U.plat(x.ch), value: totN ? x.nights / totN * 100 : 0, display: totN ? fmt.pct(x.nights / totN) : '0%' }; }), { max: 100 }) + '</div>' + (money ? '<div class="note rp-sfoot">' + feeNote() + '</div>' : '') };
    return {
      kpis: kpis, chartTitle: 'Nights sold by channel', chartSub: c ? 'This period against the ' + compName() : rangeText(r), chart: chart, side: side,
      table: { title: 'By channel', sub: money ? 'Volume, revenue and fees (OTA commission, or card fees on direct bookings)' : 'Volume and booking behaviour', cols: cols, rows: rows, total: { v: tot } },
      summary: [['Top channel', top && top.nights ? U.platName(top.ch) : '–'], ['Direct share', totN ? fmt.pct(direct.nights / totN, 1) : '–'], ['Nights sold', fmt.num(totN)]].concat(money ? [['OTA commission', fmt.money(otaFee)]] : []),
      notes: 'Lead time is the average number of days between booking and arrival. Cancelled is the share of bookings made in the range that were later cancelled.',
      pdfNote: money ? feeNote() : '',
      insight: top && totN ? '<b>' + esc(U.platName(top.ch)) + '</b> brings ' + fmt.pct(top.nights / totN) + ' of nights. Direct bookings are ' + fmt.pct(direct.nights / totN, 1) + ' of nights' + (money ? ', and OTAs kept ' + fmt.money(otaFee) + ' in commission.' : '.') : 'No nights sold in this range.'
    };
  };

  BUILD.guests = function (r, c) {
    var pid = st.pid, money = canMoney();
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
    if (money) cols.push({ label: 'Booking value', type: 'money', w: 26 });
    if (c) cols.push({ label: 'Before', type: 'num', w: 16 });
    var rows = keys.map(function (k) {
      var g = ctry[k], v = [k, g.length, g.length / ss.length, sum(g, function (b) { return b.guests; }), sum(g, function (b) { return b.nights; }), avg(g, function (b) { return b.nights; })];
      if (money) v.push(sum(g, function (b) { return b.revenue; }));
      if (c) v.push(ctryP[k] || 0);
      return { v: v, h: { 0: esc(k) + (g[0].guest.foreign ? '' : ' <span class="xs muted">(domestic, no tourism tax)</span>') } };
    });
    var tot = ['All countries', ss.length, ss.length ? 1 : 0, guests, sum(ss, function (b) { return b.nights; }), avg(ss, function (b) { return b.nights; })];
    if (money) tot.push(sum(ss, function (b) { return b.revenue; }));
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
    var side = { title: 'Rating by platform', sub: 'Average stars and review count', html: plats.length ? '<div class="side-list">' + O.chart.hbars(plats.map(function (x) { return { label: U.plat(x.pl), value: x.a, display: x.a.toFixed(2) + ' · ' + x.n }; }), { max: 5 }) + '</div>' + goBtn('reviews', 'Open reviews') : U.empty('No reviews in this range.') };
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
    var same = ins.filter(function (b) { return String(b.createdAt || '').slice(0, 10) === b.checkIn; });
    var days = d.diff(r.from, r.to) + 1;
    var tasks = D.tasks.filter(function (t) { var x = String(t.due || '').slice(0, 10); return x >= r.from && x <= r.to && inPid(t, pid); });
    var done = tasks.filter(function (t) { return t.status === 'done'; }), onTime = done.filter(function (t) { return t.doneAt && t.doneAt <= t.due; });
    var overdue = tasks.filter(function (t) { return t.status !== 'done' && t.due < D.NOW; });
    var kpis = [
      { label: 'Check-ins', value: fmt.num(ins.length), delta: c ? chg(ins.length, insP.length) : null, hl: true },
      { label: 'Turnovers', value: fmt.num(outs.length), delta: c ? chg(outs.length, outsP.length) : null, sub: (outs.length / days).toFixed(1) + ' per day' },
      { label: 'Back-to-back', value: fmt.num(b2b.length), delta: c ? chg(b2b.length, b2bP.length) : null, deltaOpts: { invert: true }, sub: 'same-day changeovers' },
      { label: 'Same-day bookings', value: fmt.num(same.length), sub: 'booked on arrival day' },
      { label: 'Tasks done on time', value: done.length ? fmt.pct(onTime.length / done.length) : '–', sub: done.length ? onTime.length + ' of ' + done.length + ' finished tasks' : 'none finished yet' },
      { label: 'Overdue tasks', value: fmt.num(overdue.length), sub: overdue.length ? 'still open' : 'none' }
    ];
    var chart = seriesChart('bars', r, c, function (a, b) { return turnoversIn({ from: a, to: b }, pid).length; }, { aria: 'Turnovers over time', yFormat: countAxis });
    var cols = [{ label: 'Property', type: 'text', w: 46 }, { label: 'Housekeeper', type: 'text', w: 34 }, { label: 'Check-ins', type: 'num', w: 18 }, { label: 'Turnovers', type: 'num', w: 20 }, { label: 'Back-to-back', type: 'num', w: 24 }, { label: 'Blocked', type: 'num', w: 18 }, { label: 'ID checked', type: 'pct', w: 26 }];
    var rows = props().map(function (p) {
      var i = staysStarting(r, p.id), hk = D.staffById(p.housekeeper);
      return { pid: p.id, v: [p.name, hk ? hk.name : 'Unassigned', i.length, turnoversIn(r, p.id).length, backToBack(r, p.id).length, mBlocked(r.from, r.to, p.id), i.length ? i.filter(function (b) { return b.idVerified; }).length / i.length : null], h: { 0: propCell(p) } };
    });
    var tot = ['All properties', '', ins.length, outs.length, b2b.length, mBlocked(r.from, r.to, pid || undefined), ins.length ? ins.filter(function (b) { return b.idVerified; }).length / ins.length : null];
    var taskKV = '<div class="section-title">Tasks due in this range</div><dl class="kv"><dt>Done</dt><dd>' + done.length + '</dd><dt>In progress</dt><dd>' + tasks.filter(function (t) { return t.status === 'in_progress'; }).length + '</dd><dt>To do</dt><dd>' + tasks.filter(function (t) { return t.status === 'todo'; }).length + '</dd><dt>Unassigned</dt><dd>' + tasks.filter(function (t) { return t.status !== 'done' && !t.assigneeId; }).length + '</dd><dt class="tot">Total</dt><dd class="tot">' + tasks.length + '</dd></dl>';
    var hk = {}; outs.forEach(function (b) { var pp = D.propById[b.propertyId], k = (pp && pp.housekeeper) || ''; hk[k] = (hk[k] || 0) + 1; });
    var hkKeys = Object.keys(hk).sort(function (a, b) { return hk[b] - hk[a]; });
    var side = { title: 'Turnovers by housekeeper', sub: 'Who cleaned between stays', html: hkKeys.length ? '<div class="side-list">' + O.chart.hbars(hkKeys.map(function (k) { var s = D.staffById(k); return { label: esc(s ? s.name : k ? k : 'Unassigned'), value: hk[k], display: hk[k] + ' cleans' }; })) + '</div>' + taskKV + goBtn('tasks', 'Open tasks') : U.empty('No turnovers in this range.') };
    return {
      kpis: kpis, chartTitle: 'Turnovers ' + chart.unit, chartSub: 'Check-outs that needed a clean', chart: chart, side: side,
      table: { title: 'By property', sub: 'Arrivals, turnovers and blocked nights', cols: cols, rows: rows, total: { v: tot } },
      summary: [['Check-ins', fmt.num(ins.length)], ['Turnovers', fmt.num(outs.length)], ['Back-to-back', fmt.num(b2b.length)], ['Same-day bookings', fmt.num(same.length)]],
      insight: '<b>' + fmt.plural(outs.length, 'turnover') + '</b> in ' + fmt.plural(days, 'day') + ', ' + b2b.length + ' of them back-to-back with a new arrival the same day.'
    };
  };

  BUILD.expenses = function (r, c) {
    var pid = st.pid, ex = expensesIn(r, pid), exP = c ? expensesIn(c, pid) : [];
    var tot = sum(ex, function (e) { return e.amount; }), totP = sum(exP, function (e) { return e.amount; });
    var capex = ex.filter(isCapex), capT = sum(capex, function (e) { return e.amount; }), opT = tot - capT;
    var opP = sum(exP.filter(function (e) { return !isCapex(e); }), function (e) { return e.amount; });
    var nights = mSold(r.from, r.to, f(pid));
    var noRcpt = ex.filter(function (e) { return !e.receipt; });
    var claims = ex.filter(function (e) { return e.method === 'Paid personally (claim)'; });
    var byType = {}, capByType = {}; ex.forEach(function (e) { byType[e.type] = (byType[e.type] || 0) + e.amount; if (isCapex(e)) capByType[e.type] = (capByType[e.type] || 0) + e.amount; });
    var byTypeP = {}; exP.forEach(function (e) { byTypeP[e.type] = (byTypeP[e.type] || 0) + e.amount; });
    var typeList = (D.expenseTypes || []).slice(); Object.keys(byType).concat(Object.keys(byTypeP)).forEach(function (t) { if (typeList.indexOf(t) < 0) typeList.push(t); });
    var types = typeList.filter(function (t) { return byType[t] || byTypeP[t]; });
    var topType = types.slice().sort(function (a, b) { return (byType[b] || 0) - (byType[a] || 0); })[0];
    var kpis = [
      { label: 'Total spent', value: fmt.money(tot), delta: c ? chg(tot, totP) : null, deltaOpts: { invert: true }, sub: c ? 'vs ' + fmt.money(totP) : null, hl: true },
      { label: 'Operating costs', value: fmt.money(opT), delta: c ? chg(opT, opP) : null, deltaOpts: { invert: true }, sub: nights ? fmt.money(opT / nights) + ' per night sold' : 'running the units' },
      { label: 'Capital spending', value: fmt.money(capT), sub: capex.length ? fmt.plural(capex.length, 'purchase') + ' that last years' : 'none in this range', title: 'Furniture, appliances, aircon units and renovation: assets that last years' },
      { label: 'Biggest type', value: topType ? esc(shortT(topType)) : '–', title: topType || '', sub: topType && tot ? fmt.pct((byType[topType] || 0) / tot) + ' of spend' : null },
      { label: 'Staff claims', value: fmt.money(sum(claims, function (e) { return e.amount; })), sub: fmt.plural(claims.length, 'claim') },
      { label: 'Missing receipts', value: fmt.num(noRcpt.length), sub: noRcpt.length ? fmt.money(sum(noRcpt, function (e) { return e.amount; })) : 'all have receipts' }
    ];
    var chart = catChart(types.map(shortT), types.map(function (t) { return byType[t] || 0; }), c ? types.map(function (t) { return byTypeP[t] || 0; }) : null, r, c, { aria: 'Expenses by type', yFormat: moneyAxis });
    var cols = [{ label: 'Type', type: 'text', w: 50 }, { label: 'Entries', type: 'num', w: 18 }, { label: 'Total', type: 'money', w: 26 }, { label: 'Capital', type: 'money', w: 24 }, { label: 'Share', type: 'pct', w: 18 }];
    if (c) cols.push({ label: 'Before', type: 'money', w: 26 }, { label: 'Change', type: 'delta', invert: true, w: 24 });
    var rows = types.map(function (t) {
      var v = [t, ex.filter(function (e) { return e.type === t; }).length, byType[t] || 0, capByType[t] || 0, tot ? (byType[t] || 0) / tot : 0];
      if (c) v.push(byTypeP[t] || 0, chg(byType[t] || 0, byTypeP[t] || 0));
      return { v: v, h: capByType[t] ? {} : { 3: '<span class="faint">–</span>' } };
    }).sort(function (a, b) { return b.v[2] - a.v[2]; });
    var totRow = ['All types', ex.length, tot, capT, tot ? 1 : 0].concat(c ? [totP, chg(tot, totP)] : []);
    var byP = {}; ex.forEach(function (e) { byP[e.paidBy] = (byP[e.paidBy] || 0) + e.amount; });
    var pk = Object.keys(byP).sort(function (a, b) { return byP[b] - byP[a]; });
    var acct = D.staff.filter(function (s) { return s.role === 'owner'; })[0];
    var side = { title: 'By person', sub: 'Who paid, including the owner', html: pk.length ? '<div class="side-list">' + O.chart.hbars(pk.map(function (k) { var s = D.staffById(k); return { label: esc(s ? s.name : k || 'Not recorded'), value: byP[k], display: fmt.money(byP[k]) }; })) + '</div>' + (acct ? '<div class="xs muted rp-sfoot">Includes ' + esc(acct.name) + ', the account owner.</div>' : '') + (O.allowed('expenses') ? '<button type="button" class="btn btn-ghost btn-sm rp-sfoot" data-go="expenses">Open expenses</button>' : '') : U.empty('No expenses in this range.') };
    return {
      kpis: kpis, chartTitle: 'Expenses by type', chartSub: c ? 'This period against the ' + compName() : rangeText(r), chart: chart, side: side,
      table: { title: 'By type', sub: 'Spending from recorded expenses; capital spending is part of the total', cols: cols, rows: rows, total: { v: totRow } },
      summary: [['Total spent', fmt.money(tot)], ['Operating costs', fmt.money(opT)], ['Capital spending', fmt.money(capT)], ['Staff claims', fmt.money(sum(claims, function (e) { return e.amount; }))]],
      notes: 'Operating costs keep the units running (cleaning, laundry, utilities, repairs). Capital spending buys things that last years (furniture, appliances, aircon units) and is shown apart in Financials.',
      insight: ex.length ? 'Spent <b>' + fmt.money(tot) + '</b> across ' + fmt.plural(ex.length, 'entry', 'entries') + (c ? ' (' + cmpPhrase(tot, totP) + ')' : '') + ', of which ' + fmt.money(capT) + ' was capital spending. ' + esc(topType) + ' is the biggest line.' : 'No expenses recorded in this range.'
    };
  };

  BUILD.tax = function (r, c) {
    if (!props().some(O.tourismTaxApplies)) return { empty: 'Tourism tax applies to units in Malaysia only, and ' + (st.pid ? 'this unit is not in Malaysia.' : 'none of the units in ' + O.viewCur() + ' are.') };
    var pid = st.pid, tax = taxIn(r, pid), taxP = c ? taxIn(c, pid) : null, fn = foreignNights(r, pid);
    var nightsAll = mSold(r.from, r.to, f(pid));
    var stays = D.bookings.filter(function (b) { return live(b) && pidOk(b) && O.tourismTaxApplies(b) && M.nightsIn(b, r.from, r.to) > 0; });
    var fs = stays.filter(function (b) { return b.guest.foreign; }), ds = stays.filter(function (b) { return !b.guest.foreign; });
    var kpis = [
      { label: 'Tax collected', value: fmt.money(tax), delta: c ? chg(tax, taxP) : null, sub: c ? 'vs ' + fmt.money(taxP) : null, hl: true },
      { label: 'Foreign room-nights', value: fmt.num(fn), sub: fmt.money(TAX_PER_NIGHT, { cur: 'MYR' }) + ' each' },
      { label: 'Foreign stays', value: fmt.num(fs.length), sub: 'taxable' },
      { label: 'Malaysian stays', value: fmt.num(ds.length), sub: 'exempt' },
      { label: 'Taxable share', value: nightsAll ? fmt.pct(fn / nightsAll) : '–', sub: 'of nights sold' }
    ];
    var chart = seriesChart('bars', r, c, function (a, b) { return taxIn({ from: a, to: b }, pid); }, { aria: 'Tourism tax over time', yFormat: moneyAxis });
    var cols = [{ label: 'Property', type: 'text', w: 56 }, { label: 'Foreign stays', type: 'num', w: 26 }, { label: 'Room-nights', type: 'num', w: 26 }, { label: 'Exempt nights', type: 'num', w: 26 }, { label: 'Tax', type: 'money', w: 26 }];
    if (c) { cols.push({ label: 'Before', type: 'money', w: 22 }); cols[0].w = 46; cols.slice(1, 4).forEach(function (x) { x.w = 22; }); }
    var rows = props().filter(O.tourismTaxApplies).map(function (p) {
      var fsP = fs.filter(function (b) { return b.propertyId === p.id; });
      var v = [p.name, fsP.length, foreignNights(r, p.id), mSold(r.from, r.to, { propertyId: p.id }) - foreignNights(r, p.id), taxIn(r, p.id)];
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
    var side = { title: 'Monthly returns', sub: 'Paid through MyTTx by the end of the next month', flush: true, html: '<div class="table-wrap"><table class="table mini-table"><thead><tr><th>Month</th><th class="num">Tax</th><th>Status</th></tr></thead><tbody>' + fileRows + '</tbody></table></div>' + '<div class="card-body"><dl class="kv"><dt>Paid to Customs</dt><dd>' + fmt.money(paidT) + '</dd><dt>Due, not yet paid</dt><dd>' + fmt.money(dueT) + '</dd><dt>Still collecting</dt><dd>' + fmt.money(collT) + '</dd><dt class="tot">Total in range</dt><dd class="tot">' + fmt.money(tax) + '</dd></dl><div class="note rp-sfoot">Foreign guests pay ' + fmt.money(TAX_PER_NIGHT, { cur: 'MYR' }) + ' per room per night on top of the stay. It shows as a separate line on every invoice.</div></div>' };
    return {
      kpis: kpis, chartTitle: 'Tourism tax ' + chart.unit, chartSub: 'Charged on foreign guests’ nights in the range', chart: chart, side: side,
      table: { title: 'By property', sub: 'Taxable and exempt nights', cols: cols, rows: rows, total: { v: totRow } },
      summary: [['Tax collected', fmt.money(tax)], ['Foreign room-nights', fmt.num(fn)], ['Foreign stays', fmt.num(fs.length)], ['Malaysian stays (exempt)', fmt.num(ds.length)]],
      notes: 'Tourism tax is ' + fmt.money(TAX_PER_NIGHT, { cur: 'MYR' }) + ' per room per night for foreign guests; Malaysian guests are exempt. It is collected for the Royal Malaysian Customs Department, passed through and not counted as revenue.',
      insight: '<b>' + fmt.money(tax) + '</b> collected on ' + fmt.num(fn) + ' foreign room-nights. This is passed through to Customs and is not revenue.'
    };
  };


  /* ---------- Owners: payouts per property owner (statement maths from pages/owner.js) ---------- */
  BUILD.owners = function (r, c) {
    var F = O.ownerFinance;
    if (!F) return { unavailable: 'Owner figures did not load. Reload the page to try again.' };
    var pid = st.pid;
    function totals(S) {
      var t = { units: 0, gross: 0, fee: 0, mgmt: 0, opex: 0, capex: 0, payout: 0, nights: 0, avail: 0 };
      S.lines.forEach(function (l) { if (!inPid({ propertyId: l.p.id }, pid)) return; t.units++; ['gross', 'fee', 'mgmt', 'opex', 'capex', 'payout', 'nights', 'avail'].forEach(function (k) { t[k] += l[k]; }); });
      t.occ = t.avail ? t.nights / t.avail : 0; return t;
    }
    var list = F.owners().filter(function (o) { return o.units.some(function (p) { return inPid({ propertyId: p.id }, pid); }); }).map(function (o) {
      return { name: o.name, t: totals(F.statement(o.name, r.from, r.to)), p: c ? totals(F.statement(o.name, c.from, c.to)) : null };
    }).sort(function (a, b) { return b.t.payout - a.t.payout; });
    if (!list.length) return { empty: pid ? 'This property has no owner set. Add one in Properties.' : 'No property has an owner set yet. Add owners in Properties to see their payouts.' };
    var T = { gross: 0, fee: 0, mgmt: 0, opex: 0, capex: 0, payout: 0, units: 0, nights: 0, avail: 0 }, TP = { payout: 0, gross: 0 };
    list.forEach(function (x) { Object.keys(T).forEach(function (k) { T[k] += x.t[k]; }); if (x.p) { TP.payout += x.p.payout; TP.gross += x.p.gross; } });
    var link = O.allowed('owner');
    function ownerCell(n) { return link ? '<button type="button" class="lnk" data-go-owner="' + esc(n) + '" title="Open ' + esc(n) + '’s owner portal">' + esc(n) + '</button>' : esc(n); }
    var kpis = [
      { label: 'Owner payouts', value: fmt.money(T.payout), delta: c ? chg(T.payout, TP.payout) : null, sub: c ? 'vs ' + fmt.money(TP.payout) : null, hl: true },
      { label: 'Revenue', value: fmt.money(T.gross), delta: c ? chg(T.gross, TP.gross) : null, sub: fmt.plural(T.units, 'unit') },
      { label: 'Management fee', value: fmt.money(T.mgmt), sub: Math.round(F.MGMT * 100) + '% after platform fees' },
      { label: 'Costs charged', value: fmt.money(T.opex + T.capex), sub: T.capex ? fmt.money(T.capex) + ' capital spending' : 'running costs only' },
      { label: 'Owners', value: fmt.num(list.length), sub: T.avail ? fmt.pct(T.nights / T.avail) + ' occupancy' : null }
    ];
    var chart = hbarChart(list.map(function (x) { return { label: esc(x.name), name: x.name, cur: Math.max(0, x.t.payout), prev: x.p ? Math.max(0, x.p.payout) : 0, display: fmt.moneyShort(x.t.payout), prevDisplay: x.p ? fmt.moneyShort(x.p.payout) : '–' }; }), r, c, { aria: 'Owner payout by owner' });
    /* pdf:false leaves a column out of the PDF (A4 portrait fits about nine money columns); pdfLabel shortens a header */
    var cols = [{ label: 'Owner', type: 'text', w: 36 }, { label: 'Units', type: 'num', w: 12, pdf: false }, { label: 'Occupancy', type: 'pct', w: 17 }, { label: 'Revenue', type: 'money', w: 22 }, { label: 'Platform fees', pdfLabel: 'Fees', type: 'money', w: 21 }, { label: 'Mgmt fee', type: 'money', w: 19 }, { label: 'Running costs', pdfLabel: 'Costs', type: 'money', w: 21 }, { label: 'Capital', type: 'money', w: 17 }, { label: 'Payout', type: 'money', w: 21 }];
    if (c) cols.push({ label: 'Before', type: 'money', w: 20, pdf: false }, { label: 'Change', type: 'delta', w: 16 });
    var rows = list.map(function (x) {
      var v = [x.name, x.t.units, x.t.occ, x.t.gross, x.t.fee, x.t.mgmt, x.t.opex, x.t.capex, x.t.payout];
      if (c) v.push(x.p.payout, chg(x.t.payout, x.p.payout));
      return { v: v, h: { 0: ownerCell(x.name), 7: x.t.capex ? null : '<span class="faint">–</span>' } };
    });
    var tot = ['All owners', T.units, T.avail ? T.nights / T.avail : 0, T.gross, T.fee, T.mgmt, T.opex, T.capex, T.payout].concat(c ? [TP.payout, chg(T.payout, TP.payout)] : []);
    var side = { title: 'Where the revenue went', sub: rangeText(r), html: '<dl class="kv"><dt>Revenue</dt><dd>' + fmt.money(T.gross) + '</dd><dt>Platform fees</dt><dd>−' + fmt.money(T.fee) + '</dd><dt>Management fee</dt><dd>−' + fmt.money(T.mgmt) + '</dd><dt>Running costs</dt><dd>−' + fmt.money(T.opex) + '</dd>' + (T.capex ? '<dt>Capital spending</dt><dd>−' + fmt.money(T.capex) + '</dd>' : '') + '<dt class="tot">Owner payouts</dt><dd class="tot">' + fmt.money(T.payout) + '</dd></dl><div class="xs muted rp-sfoot">' + esc(F.chargeRule) + '</div>' + goBtn('owner', 'Open owner portal') };
    var best = list[0];
    return {
      kpis: kpis, chartTitle: 'Payout by owner', chartSub: 'After platform fees, the management fee and costs charged', chart: chart, side: side,
      table: { title: 'By owner', sub: 'Statement figures for the selected dates', cols: cols, rows: rows, total: { v: tot } },
      summary: [['Owner payouts', fmt.money(T.payout)], ['Revenue', fmt.money(T.gross)], ['Management fee', fmt.money(T.mgmt)], ['Costs charged', fmt.money(T.opex + T.capex)]],
      notes: 'Payouts here cover the selected dates and leave out balances carried between months. Monthly statements, approvals and carried balances are in the Owner portal.',
      insight: 'Owners earn <b>' + fmt.money(T.payout) + '</b> from ' + fmt.money(T.gross) + ' of revenue' + (c ? ' (' + cmpPhrase(T.payout, TP.payout) + ')' : '') + '; the management fee comes to ' + fmt.money(T.mgmt) + '. ' + (best && best.t.payout > 0 ? esc(best.name) + ' has the largest payout, ' + fmt.money(best.t.payout) + '.' : '')
    };
  };

  /* ---------- Inventory: which unit used which products most ('out' moves in D.invMoves, cost from D.itemById) ---------- */
  function itemOf(id) { return (D.itemById && D.itemById[id]) || null; }
  function itemName(id) { var it = itemOf(id); return it ? it.name : 'Item no longer listed'; }
  function qtyUnit(id, q) { var it = itemOf(id), u = it && it.unit; if (!u) return fmt.num(q); return fmt.num(q) + ' ' + (q === 1 ? u : /(x|s|sh|ch)$/.test(u) ? u + 'es' : u + 's'); }
  function unitName(u) { var p = D.propById[u]; return p ? p.name : u ? 'Removed unit' : 'Not linked to a unit'; }
  function unitShort(u) { var p = D.propById[u]; return p ? (p.short || p.name) : unitName(u); }
  function unitCell(u) { var p = D.propById[u]; return p ? propCell(p) : '<span class="muted">' + esc(unitName(u)) + '</span>'; }
  function invUse(r, pid) {
    var units = {}, items = {}, out = { units: units, items: items, qty: 0, cost: 0, stays: 0, moves: 0 };
    (D.invMoves || []).forEach(function (mv) {
      if (!mv || mv.dir !== 'out' || !mv.date || mv.date < r.from || mv.date > r.to) return;
      var u = mv.propertyId || '';
      if (!inPid(mv, pid)) return;
      var x = units[u] || (units[u] = { qty: 0, cost: 0, items: {}, stays: {}, moves: 0 });
      x.moves++; out.moves++;
      if (mv.bookingId) x.stays[mv.bookingId] = 1;
      (mv.lines || []).forEach(function (l) {
        var q = Number(l.qty) || 0; if (q <= 0) return;
        var it = itemOf(l.itemId), cost = q * ((it && Number(it.cost)) || 0);
        x.qty += q; x.cost += cost; out.qty += q; out.cost += cost;
        var xi = x.items[l.itemId] || (x.items[l.itemId] = { qty: 0, cost: 0 }); xi.qty += q; xi.cost += cost;
        var g = items[l.itemId] || (items[l.itemId] = { qty: 0, cost: 0 }); g.qty += q; g.cost += cost;
      });
    });
    Object.keys(units).forEach(function (k) { units[k].nStays = Object.keys(units[k].stays).length; out.stays += units[k].nStays; });
    return out;
  }
  var NO_UNIT = { qty: 0, cost: 0, items: {}, nStays: 0, moves: 0 };
  BUILD.inventory = function (r, c) {
    var pid = st.pid, money = canMoney(), rank = money ? 'cost' : 'qty';
    var metric = money && st.invMetric === 'cost' ? 'cost' : 'qty';
    var A = invUse(r, pid), B = c ? invUse(c, pid) : null;
    function mf(v) { return money ? fmt.money(v) : fmt.num(v); }
    function byRank(obj) { return Object.keys(obj).sort(function (a, b) { return obj[b][rank] - obj[a][rank] || (itemName(a) < itemName(b) ? -1 : 1); }); }
    var ids = pid ? [pid] : props().map(function (p) { return p.id; });
    Object.keys(A.units).forEach(function (k) { if (ids.indexOf(k) < 0) ids.push(k); });
    var urows = ids.map(function (u) { var y = B && B.units[u]; return { u: u, x: A.units[u] || NO_UNIT, prev: y ? y[rank] : 0 }; }).sort(function (a, b) { return b.x[rank] - a.x[rank]; });
    var top = urows[0] && urows[0].x[rank] ? urows[0] : null;
    var itemIds = byRank(A.items), topItem = itemIds[0];
    function topNames(x, n) { return byRank(x.items).slice(0, n).map(itemName); }
    var share = function (v) { return A[rank] ? v / A[rank] : 0; };

    var kpis = [
      money ? { label: 'Stock used', value: fmt.money(A.cost), delta: c ? chg(A.cost, B.cost) : null, deltaOpts: { invert: true }, sub: c ? 'vs ' + fmt.money(B.cost) : 'at current item cost', hl: true }
        : { label: 'Items used', value: fmt.num(A.qty), delta: c ? chg(A.qty, B.qty) : null, deltaOpts: { invert: true }, sub: c ? 'vs ' + fmt.num(B.qty) : fmt.plural(itemIds.length, 'product'), hl: true },
      money ? { label: 'Items used', value: fmt.num(A.qty), sub: fmt.plural(itemIds.length, 'product') } : { label: 'Stays restocked', value: fmt.num(A.stays), sub: 'turnovers with stock logged' },
      money ? { label: 'Cost per stay', value: A.stays ? fmt.money(A.cost / A.stays) : '–', sub: fmt.plural(A.stays, 'stay') + ' restocked' } : { label: 'Items per stay', value: A.stays ? (A.qty / A.stays).toFixed(1) : '–', sub: fmt.plural(A.stays, 'stay') }
    ];
    if (!pid) kpis.push({ label: 'Top unit', value: top ? esc(unitShort(top.u)) : '–', title: top ? unitName(top.u) : '', sub: top ? mf(top.x[rank]) + ' · ' + fmt.pct(share(top.x[rank])) + ' of ' + (money ? 'stock cost' : 'items') : null });
    kpis.push({ label: 'Top product', value: topItem ? esc(itemName(topItem)) : '–', title: topItem ? itemName(topItem) : '', sub: topItem ? (money ? fmt.money(A.items[topItem].cost) + ' · ' : '') + qtyUnit(topItem, A.items[topItem].qty) : null });

    /* chart: units (all properties) or products (one property) */
    var chart;
    if (!pid) {
      chart = hbarChart(urows.filter(function (x) { return x.x[rank] || x.prev; }).map(function (x) { var p = D.propById[x.u]; return { label: p ? '<span class="prop-dot" style="background:' + U.propColor(p.id) + '"></span>' + esc(unitShort(x.u)) : esc(unitName(x.u)), name: unitName(x.u), cur: x.x[rank], prev: x.prev, display: mf(x.x[rank]), prevDisplay: mf(x.prev) }; }), r, c, { aria: 'Stock used by unit', empty: 'No stock was recorded as used in this range.' });
    } else {
      chart = hbarChart(itemIds.slice(0, 10).map(function (id) { var y = B && B.items[id]; return { label: esc(itemName(id)), name: itemName(id), cur: A.items[id][rank], prev: y ? y[rank] : 0, display: mf(A.items[id][rank]), prevDisplay: mf(y ? y[rank] : 0) }; }), r, c, { aria: 'Products used', empty: 'No stock was recorded as used at this unit in this range.' });
    }
    /* side: most used products (all units) or categories (one unit) */
    var side;
    if (!pid) {
      side = { title: 'Most used products', sub: money ? 'By cost, across all units' : 'By quantity, across all units', html: itemIds.length ? '<div class="side-list">' + O.chart.hbars(itemIds.slice(0, 8).map(function (id) { return { label: esc(itemName(id)), value: A.items[id][rank], display: money ? fmt.money(A.items[id].cost) : qtyUnit(id, A.items[id].qty) }; })) + '</div>' + goBtn('inventory', 'Open inventory') : U.empty('No stock used in this range.') };
    } else {
      var cats = {}; itemIds.forEach(function (id) { var k = (itemOf(id) || {}).cat || 'Other'; cats[k] = (cats[k] || 0) + A.items[id][rank]; });
      var ck = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; });
      side = { title: 'By category', sub: money ? 'Cost of products used' : 'Items used', html: ck.length ? '<div class="side-list">' + O.chart.hbars(ck.map(function (k) { return { label: esc(k), value: cats[k], display: mf(cats[k]) }; })) + '</div>' + goBtn('inventory', 'Open inventory') : U.empty('No stock used in this range.') };
    }

    /* tables */
    var view = pid ? 'products' : (st.invView === 'matrix' ? 'matrix' : 'unit'), table;
    if (view === 'unit') {
      var cols = [{ label: 'Unit', type: 'text', w: 40 }, { label: 'Stays', type: 'num', w: 13 }, { label: 'Items used', type: 'num', w: 18 }];
      if (money) cols.push({ label: 'Cost', type: 'money', w: 20 }, { label: 'Per stay', type: 'money', w: 18 });
      cols.push({ label: 'Top products', type: 'text', w: money ? 77 : 115 });
      if (c) { cols.push({ label: 'Before', type: money ? 'money' : 'num', w: 18 }, { label: 'Change', type: 'delta', invert: true, w: 16 }); cols[cols.length - 3].w -= 34; }
      var rows = urows.map(function (x) {
        var tn = topNames(x.x, 3), v = [unitName(x.u), x.x.nStays, x.x.qty];
        if (money) v.push(x.x.cost, x.x.nStays ? x.x.cost / x.x.nStays : null);
        v.push(tn.join(', '));
        if (c) v.push(x.prev, chg(x.x[rank], x.prev));
        var h = { 0: unitCell(x.u) }; h[money ? 5 : 3] = tn.length ? '<div class="top-items">' + esc(tn.join(' · ')) + '</div>' : '<span class="faint">None used</span>';
        return { v: v, h: h };
      });
      var tv = ['All units', A.stays, A.qty]; if (money) tv.push(A.cost, A.stays ? A.cost / A.stays : null); tv.push(itemIds.slice(0, 3).map(itemName).join(', '));
      if (c) tv.push(B[rank], chg(A[rank], B[rank]));
      table = { title: 'By unit', sub: 'Stays restocked, items used and the products each unit used most', cols: cols, rows: rows, total: { v: tv }, tools: 'unit' };
    } else if (view === 'matrix') {
      var ucols = urows.filter(function (x) { return x.x.qty > 0; });
      var mcols = [{ label: 'Product', type: 'text', w: 40 }].concat(ucols.map(function (x) { return { label: unitShort(x.u), type: metric === 'cost' ? 'money' : 'num', cls: 'uc', title: unitName(x.u), w: 12 }; }));
      mcols.push({ label: 'Total', type: metric === 'cost' ? 'money' : 'num', w: 16 });
      if (money && metric === 'qty') mcols.push({ label: 'Cost', type: 'money', w: 18 });
      var colMax = ucols.map(function (x) { var m = 0; Object.keys(x.x.items).forEach(function (id) { m = Math.max(m, x.x.items[id][metric]); }); return m; });
      var mrows = itemIds.map(function (id) {
        var it = itemOf(id), v = [itemName(id)], h = { 0: '<span title="' + esc(itemName(id) + (it && it.unit ? ', counted per ' + it.unit : '')) + '">' + esc(itemName(id)) + '</span><span class="cat">' + esc((it && it.cat) || '') + '</span>' }, td = {};
        ucols.forEach(function (x, i) {
          var val = (x.x.items[id] || {})[metric] || 0, ci = i + 1; v.push(val);
          if (!val) { h[ci] = '<span class="faint">–</span>'; return; }
          var a = colMax[i] ? Math.round(val / colMax[i] * 34) : 0;
          td[ci] = { cls: 'hc' + (val === colMax[i] ? ' top' : ''), style: 'background:color-mix(in srgb, var(--brand-strong) ' + a + '%, transparent)', title: unitName(x.u) + ': ' + qtyUnit(id, (x.x.items[id] || {}).qty || 0) + (money ? ', ' + fmt.money((x.x.items[id] || {}).cost || 0) : '') };
        });
        v.push(A.items[id][metric]);
        if (money && metric === 'qty') v.push(A.items[id].cost);
        return { v: v, h: h, td: td };
      });
      var mt = ['All products'].concat(ucols.map(function (x) { return x.x[metric]; })).concat([A[metric]]);
      if (money && metric === 'qty') mt.push(A.cost);
      table = { title: 'Unit × product', sub: (metric === 'cost' ? 'Cost' : 'Quantity') + ' of each product used in each unit; the darkest cell is each unit’s top product', cols: mcols, rows: mrows, total: { v: mt }, tools: 'matrix', cls: 'rp-matrix' };
    } else {
      var pcols = [{ label: 'Product', type: 'text', w: 56 }, { label: 'Category', type: 'text', w: 44 }, { label: 'Quantity', type: 'num', w: 20 }];
      if (money) pcols.push({ label: 'Cost', type: 'money', w: 22 });
      pcols.push({ label: 'Share', type: 'pct', w: 18 });
      if (c) pcols.push({ label: 'Before', type: money ? 'money' : 'num', w: 22 });
      var prow = itemIds.map(function (id) {
        var it = itemOf(id), y = B && B.items[id], v = [itemName(id), (it && it.cat) || '', A.items[id].qty];
        if (money) v.push(A.items[id].cost);
        v.push(share(A.items[id][rank]));
        if (c) v.push(y ? y[rank] : 0);
        return { v: v, h: { 2: esc(qtyUnit(id, A.items[id].qty)) } };
      });
      var pt = ['All products', '', A.qty]; if (money) pt.push(A.cost); pt.push(A[rank] ? 1 : 0); if (c) pt.push(B[rank]);
      table = { title: 'Products used at ' + unitShort(pid), sub: 'Every product taken out for this unit', cols: pcols, rows: prow, total: { v: pt } };
    }

    var unitWord = pid ? unitName(pid) : null;
    var insight = !A.qty ? 'No stock was recorded as used in this range. Stock used is logged in Inventory, usually at each turnover.'
      : pid ? '<b>' + esc(unitWord) + '</b> used ' + fmt.num(A.qty) + ' items' + (money ? ' worth ' + fmt.money(A.cost) : '') + ' over ' + fmt.plural(A.stays, 'stay') + (c ? ' (' + cmpPhrase(A[rank], B[rank]) + ')' : '') + ', mostly ' + topNames(A.units[pid] || NO_UNIT, 2).map(function (s) { return esc(s.toLowerCase()); }).join(' and ') + '.'
        : '<b>' + esc(unitName(top.u)) + '</b> used the most stock (' + mf(top.x[rank]) + '), mostly ' + topNames(top.x, 2).map(function (s) { return esc(s.toLowerCase()); }).join(' and ') + '. All units used ' + fmt.num(A.qty) + ' items' + (money ? ' worth ' + fmt.money(A.cost) : '') + ' over ' + fmt.plural(A.stays, 'stay') + (c ? ', ' + cmpPhrase(A[rank], B[rank]) : '') + '.';
    var summary = money ? [['Stock used', fmt.money(A.cost)], ['Items used', fmt.num(A.qty)], ['Cost per stay', A.stays ? fmt.money(A.cost / A.stays) : '–'], pid ? ['Stays restocked', fmt.num(A.stays)] : ['Top unit', top ? unitShort(top.u) : '–']]
      : [['Items used', fmt.num(A.qty)], ['Stays restocked', fmt.num(A.stays)], ['Items per stay', A.stays ? (A.qty / A.stays).toFixed(1) : '–'], pid ? ['Products', fmt.num(itemIds.length)] : ['Top unit', top ? unitShort(top.u) : '–']];
    var note = 'Counts every stock-out recorded for a unit (turnover restocks and repairs) in the range.' + (money ? ' Cost uses each product’s current unit cost.' : '');

    /* CSV: one line per unit and product (quantities and cost), then the per-unit summary */
    function csvRows() {
      var head = ['Unit', 'Location', 'Product', 'Category', 'Quantity', 'Unit of measure'].concat(money ? ['Cost per item (' + fmt.cur() + ')', 'Cost (' + fmt.cur() + ')'] : []);
      var out = [['Stock used by unit report', rangeText(r)], ['Scope', scopeText()], []].concat(summary.map(function (s) { return [s[0], s[1]]; })).concat([[], head]);
      urows.forEach(function (x) {
        byRank(x.x.items).forEach(function (id) {
          var it = itemOf(id), q = x.x.items[id];
          out.push([unitName(x.u), placeOf(D.propById[x.u]), itemName(id), (it && it.cat) || '', q.qty, (it && it.unit) || ''].concat(money ? [it ? Number(it.cost).toFixed(2) : '', q.cost.toFixed(2)] : []));
        });
      });
      out.push(['All units', '', '', '', A.qty, ''].concat(money ? ['', A.cost.toFixed(2)] : []));
      if (!pid) {
        out.push([], ['By unit'], ['Unit', 'Stays restocked', 'Items used'].concat(money ? ['Cost (' + fmt.cur() + ')', 'Cost per stay (' + fmt.cur() + ')'] : []).concat(['Top products']));
        urows.forEach(function (x) { out.push([unitName(x.u), x.x.nStays, x.x.qty].concat(money ? [Math.round(x.x.cost), x.x.nStays ? Math.round(x.x.cost / x.x.nStays) : ''] : []).concat([topNames(x.x, 3).join(', ')])); });
      }
      return out;
    }
    /* PDF: summary, the per-unit table and each unit's top five products */
    function pdf() {
      return O.pdf.start('Stock used by unit', rangeText(r)) /* scope goes in the closing note: a long subtitle runs into the address line */.then(function (o) {
        var doc = o.doc, y = pdfSummary(doc, o.y, summary);
        function heading(t) { if (y > 258) { doc.addPage(); y = 18; } y = O.pdf.text(doc, y, t, { bold: true, size: 10 }) + 3; }
        if (!pid) {
          heading('By unit');
          var cw = money ? [46, 14, 18, 20, 18, 70] : [56, 18, 20, 92];
          var c1 = [{ label: 'Unit', w: cw[0] }, { label: 'Stays', w: cw[1], align: 'right' }, { label: 'Items', w: cw[2], align: 'right' }].concat(money ? [{ label: 'Cost', w: cw[3], align: 'right' }, { label: 'Per stay', w: cw[4], align: 'right' }] : []).concat([{ label: 'Top products', w: cw[cw.length - 1] }]);
          var r1 = urows.map(function (x) { return [unitName(x.u), fmt.num(x.x.nStays), fmt.num(x.x.qty)].concat(money ? [fmt.money(x.x.cost), x.x.nStays ? fmt.money(x.x.cost / x.x.nStays) : '-'] : []).concat([topNames(x.x, 3).join(', ')]); });
          r1.push(['All units', fmt.num(A.stays), fmt.num(A.qty)].concat(money ? [fmt.money(A.cost), A.stays ? fmt.money(A.cost / A.stays) : '-'] : []).concat(['']));
          y = O.pdf.table(doc, y, c1, r1, { boldLast: true }) + 4;
        }
        heading(pid ? 'Products used at ' + unitName(pid) : 'Top five products per unit');
        var c2 = [{ label: 'Unit', w: 52 }, { label: 'Product', w: 64 }, { label: 'Quantity', w: money ? 36 : 70, align: 'right' }].concat(money ? [{ label: 'Cost', w: 34, align: 'right' }] : []);
        var r2 = [];
        urows.forEach(function (x) { byRank(x.x.items).slice(0, pid ? 999 : 5).forEach(function (id, i) { var q = x.x.items[id]; r2.push([i ? '' : unitName(x.u), itemName(id), qtyUnit(id, q.qty)].concat(money ? [fmt.money(q.cost)] : [])); }); });
        if (!r2.length) r2.push(['', 'No stock used in this range', '']);
        y = O.pdf.table(doc, y, c2, r2);
        if (y > 270) { doc.addPage(); y = 18; }
        O.pdf.text(doc, y + 4, 'Covers ' + scopeText().replace(/^All /, 'all ') + '. ' + note + (pid ? '' : ' Every unit and product, with quantities and cost, is in the CSV export.') + (c ? ' Comparison: ' + rangeText(c) + ' (' + compName() + ').' : ''), { muted: true, size: 8 });
        return O.pdf.save(doc, fileBase(r) + '.pdf');
      }).catch(function () { return false; });
    }

    return {
      kpis: kpis, chartTitle: pid ? 'Products used' : 'Stock used by unit', chartSub: (money ? 'Cost of products used' : 'Number of items used') + (pid ? ', top 10' : ', highest first'), chart: chart, side: side,
      table: table, summary: summary, notes: note, insight: insight, csvRows: csvRows, pdf: pdf
    };
  };

  /* ------------------------------------------------------------------ rendering */
  function sortKey() { return st.report + (st.report === 'inventory' ? ':' + (st.pid ? 'p' : st.invView) + ':' + st.invMetric : ''); }
  function sortedRows(rep) {
    var rows = rep.table.rows.slice(), s = st.sort;
    if (!s || s.key !== sortKey() || s.col >= rep.table.cols.length) return rows;
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
    var t = rep.table, s = st.sort && st.sort.key === sortKey() ? st.sort : null;
    if (!t.rows.length) return U.empty('Nothing to show for this range.');
    var head = '<tr>' + t.cols.map(function (c, i) { return '<th class="sort' + (isNum(c) ? ' num' : '') + (c.cls ? ' ' + c.cls : '') + '" data-sort="' + i + '"' + (c.title ? ' title="' + esc(c.title) + '"' : '') + ' aria-sort="' + (s && s.col === i ? (s.dir > 0 ? 'ascending' : 'descending') : 'none') + '">' + esc(c.label) + (s && s.col === i ? '<span class="ar">' + (s.dir > 0 ? '▲' : '▼') + '</span>' : '') + '</th>'; }).join('') + '</tr>';
    var body = sortedRows(rep).map(function (r) {
      return '<tr>' + t.cols.map(function (c, i) {
        var td = r.td && r.td[i];
        return '<td class="' + (isNum(c) ? 'num' : '') + (td && td.cls ? ' ' + td.cls : '') + '"' + (td && td.style ? ' style="' + td.style + '"' : '') + (td && td.title ? ' title="' + esc(td.title) + '"' : '') + '>' + (r.h && r.h[i] != null ? r.h[i] : cellHTML(c, r.v[i])) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var foot = t.total && t.rows.length > 1 ? '<tfoot><tr>' + t.cols.map(function (c, i) { var v = t.total.v[i]; return '<td class="' + (isNum(c) ? 'num' : '') + '">' + (v === '' ? '' : cellHTML(c, v)) + '</td>'; }).join('') + '</tr></tfoot>' : '';
    return '<div class="table-wrap"><table class="table' + (t.cls ? ' ' + t.cls : '') + '"><thead>' + head + '</thead><tbody>' + body + '</tbody>' + foot + '</table></div>';
  }
  function toolsHTML(rep) {
    var k = rep.table.tools; if (!k) return '';
    var h = U.seg([['unit', 'By unit'], ['matrix', 'Unit × product']], st.invView, 'data-inv-view');
    if (k === 'matrix' && canMoney()) h += U.seg([['qty', 'Quantity'], ['cost', 'Cost']], st.invMetric, 'data-inv-metric');
    return h;
  }

  function exportRows(rep) {
    var t = rep.table;
    var rows = [t.cols.map(function (c) { return c.label; })];
    sortedRows(rep).forEach(function (r) { rows.push(t.cols.map(function (c, i) { return cellCSV(c, r.v[i]); })); });
    if (t.total && t.rows.length > 1) rows.push(t.cols.map(function (c, i) { return t.total.v[i] === '' ? '' : cellCSV(c, t.total.v[i]); }));
    return rows;
  }
  function fileBase(r) { return (O.ws().name + '-' + REP[st.report].name + '-report-' + r.from + '-to-' + r.to).toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
  function scopeText() { return st.pid && D.propById[st.pid] ? propLabel(D.propById[st.pid]) : 'All ' + fmt.plural(props().length, 'property', 'properties') + (O.multiCur() ? ' in ' + O.viewCur() : ''); }
  /* the KPI boxes at the top of a PDF (same look as O.pdf.report) */
  function pdfSummary(doc, y, summary) {
    if (!summary || !summary.length) return y;
    var cw = 186 / Math.min(4, summary.length);
    summary.forEach(function (s, i) {
      var cx = 12 + (i % 4) * cw, cy = y + Math.floor(i / 4) * 16;
      doc.setDrawColor(227, 230, 235); doc.roundedRect(cx, cy - 4, cw - 3, 13, 2, 2, 'S');
      doc.setFontSize(7.5); doc.setTextColor(95, 107, 122); doc.setFont('helvetica', 'normal'); doc.text(String(s[0]), cx + 3, cy + 0.5);
      doc.setFontSize(11); doc.setTextColor(20, 24, 31); doc.setFont('helvetica', 'bold'); doc.text(String(s[1]).replace(/−/g, '-'), cx + 3, cy + 6.5);
    });
    return y + Math.ceil(summary.length / 4) * 16 + 4;
  }

  function doCSV(rep, r) {
    if (!canExport()) { U.toast(WHY_EXPORT, 'bad'); return; }
    var rows = rep.csvRows ? rep.csvRows() : [[REP[st.report].name + ' report', rangeText(r)], ['Scope', scopeText()], []].concat(rep.summary.map(function (s) { return [s[0], s[1]]; })).concat([[]]).concat(exportRows(rep));
    O.downloadCSV(fileBase(r) + '.csv', rows);
  }
  function doPDF(rep, r, c) {
    if (!canExport()) { U.toast(WHY_EXPORT, 'bad'); return; }
    if (rep.pdf) { rep.pdf(); return; }
    var t = rep.table, keep = [];
    t.cols.forEach(function (x, i) { if (x.pdf !== false) keep.push(i); });
    var totalW = sum(keep, function (i) { return t.cols[i].w || 20; });
    var cols = keep.map(function (i) { var x = t.cols[i]; return { label: x.pdfLabel || x.label, w: (x.w || 20) * 186 / totalW, align: isNum(x) ? 'right' : undefined }; });
    var rows = sortedRows(rep).map(function (row) { return keep.map(function (i) { return cellText(t.cols[i], row.v[i]); }); });
    if (t.total && t.rows.length > 1) rows.push(keep.map(function (i) { return t.total.v[i] === '' ? '' : cellText(t.cols[i], t.total.v[i]); }));
    O.pdf.report({
      filename: fileBase(r) + '.pdf', title: REP[st.report].name + ' report', subtitle: rangeText(r),
      summary: rep.summary, columns: cols, rows: rows, boldLast: !!t.total && t.rows.length > 1,
      notes: 'Covers ' + scopeText().replace(/^All /, 'all ') + '. ' + (c ? 'Comparison: ' + rangeText(c) + ' (' + compName() + '). ' : '') + (rep.pdfNote ? rep.pdfNote + ' ' : '') + (rep.notes || '') + ' Figures come from bookings, reviews, tasks, expenses and stock records in ' + O.ws().name + '.'
    });
  }

  function scheduleModal() {
    if (!canExport()) { U.toast(WHY_EXPORT, 'bad'); return; }
    var rep = REP[st.report];
    U.modal({
      title: 'Email this report on a schedule', sub: rep.name + ' report · ' + scopeText(),
      body: '<div class="form-grid"><div class="field"><label for="rp-freq">How often</label><select id="rp-freq" class="select"><option>Every Monday (last 7 days)</option><option selected>1st of each month (last month)</option><option>Every quarter (last quarter)</option></select></div>' +
        '<div class="field"><label for="rp-fmt">Format</label><select id="rp-fmt" class="select"><option>PDF and CSV</option><option>PDF only</option><option>CSV only</option></select></div>' +
        '<div class="field full"><label for="rp-to">Send to</label><input id="rp-to" class="input" value="' + esc(String(O.viewer().name || '').toLowerCase().replace(/\s+/g, '.') + '@' + String(O.ws().domain || 'example.com').replace(/^stay\.|^otto\./, '')) + '"><div class="hint">Separate several addresses with commas.</div></div></div>' +
        '<div class="note" style="margin-top:12px">Prototype: scheduled emails are not really sent.</div>',
      actions: [{ label: 'Cancel' }, {
        label: 'Save schedule', kind: 'primary', onClick: function (close, el) {
          var to = O.$('#rp-to', el).value.trim(); if (!to) { U.toast('Add at least one email address', 'bad'); return false; }
          U.toast(rep.name + ' report scheduled: ' + O.$('#rp-freq', el).value.toLowerCase() + ' to ' + to + ' (prototype: nothing is really sent)');
        }
      }]
    });
  }

  /* ---------- library view ---------- */
  function words() { return st.q.trim().toLowerCase().split(/\s+/).filter(Boolean); }
  function hl(text, ws) {
    if (!ws.length) return esc(text);
    var re = new RegExp('(' + ws.map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')', 'ig');
    return String(text).split(re).map(function (part, i) { return i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part); }).join('');
  }
  function libraryBody() {
    var ws = words();
    function match(r) { if (!ws.length) return true; var hay = (r.name + ' ' + r.desc + ' ' + GRP[r.group].name + ' ' + (r.kw || '')).toLowerCase(); return ws.every(function (w) { return hay.indexOf(w) >= 0; }); }
    var groups = GROUPS.map(function (g) { return { g: g, items: REPORTS.filter(function (r) { return r.group === g.id && match(r); }) }; }).filter(function (x) { return x.items.length; });
    var n = sum(groups, function (x) { return x.items.length; });
    var cnt = ws.length ? fmt.plural(n, 'report') + ' found' : fmt.plural(REPORTS.length, 'report') + ' in ' + GROUPS.length + ' groups';
    var grid = groups.length ? '<div class="rl-grid">' + groups.map(function (x) {
      return '<section class="card rl-group" aria-label="' + esc(x.g.name) + '"><div class="card-head"><div class="rl-gh"><span class="rl-gi">' + O.icon(x.g.icon) + '</span><div><h3>' + esc(x.g.name) + '</h3><div class="sub">' + esc(x.g.desc) + '</div></div></div></div><div class="rl-list">' +
        x.items.map(function (r) {
          var lk = locked(r);
          return '<button type="button" class="rl-item" data-open="' + r.id + '"' + (lk ? ' title="Needs the &quot;Open financial reports&quot; permission"' : '') + '><span class="tx"><span class="nm">' + hl(r.name, ws) + (lk ? '<span class="pill neutral">' + O.icon('lock') + 'Financial access</span>' : '') + '</span><span class="ds" style="display:block">' + hl(r.desc, ws) + '</span></span><span class="go">' + O.icon('right') + '</span></button>';
        }).join('') + '</div></section>';
    }).join('') + '</div>' : '<div class="card">' + U.empty('No report matches “' + st.q.trim() + '”. Try revenue, occupancy, reviews, owners or stock.', '⌕') + '</div>';
    return { cnt: cnt, grid: grid };
  }
  function startHTML() {
    if (D.properties.length) return '';
    var canAdd = O.allowed('properties') && O.can('properties.create');
    return '<div class="card"><div class="card-body rl-start"><div class="tx"><b>Reports fill in as bookings, reviews, expenses and stock records come in.</b><div class="small muted" style="margin-top:2px">Start by adding your first property.</div></div>' +
      (canAdd ? '<button type="button" class="btn btn-primary" data-go="properties">' + O.icon('plus') + 'Add a unit</button>' : '') + '</div></div>';
  }
  function renderLibrary(root, ctx) {
    ctx.setActions('');
    var b = libraryBody();
    root.innerHTML = '<div class="pg-reports">' + startHTML() +
      '<div class="rl-top"><label class="search">' + O.icon('search') + '<input type="search" data-q placeholder="Search reports" aria-label="Search reports" value="' + esc(st.q) + '" autocomplete="off"></label><span class="cnt" aria-live="polite">' + esc(b.cnt) + '</span></div>' +
      '<div class="rl-body">' + b.grid + '</div></div>';
    var inp = O.$('[data-q]', root);
    inp.addEventListener('input', function () { st.q = inp.value; var x = libraryBody(); O.$('.rl-body', root).innerHTML = x.grid; O.$('.rl-top .cnt', root).textContent = x.cnt; });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var first = O.$('[data-open]', root); if (first) first.click(); }
      if (e.key === 'Escape' && inp.value) { inp.value = ''; inp.dispatchEvent(new Event('input')); }
    });
    root.onclick = function (e) {
      var t = e.target.closest('[data-open]');
      if (t) { openReport(t.dataset.open, root, ctx); return; }
      t = e.target.closest('[data-go]');
      if (t) O.go(t.dataset.go);
    };
  }
  function openReport(id, root, ctx) {
    if (!REP[id]) return;
    if (st.report !== id) st.sort = null;
    st.report = id; st.view = 'report'; render(root, ctx); window.scrollTo(0, 0);
  }

  /* ---------- report view ---------- */
  function renderReport(root, ctx) {
    var rep = REP[st.report] || REPORTS[0]; st.report = rep.id;
    var r = range(), c = compRange(r), lk = locked(rep), exp = canExport();
    var head = '<div class="rp-head"><button type="button" class="btn btn-ghost btn-sm" data-lib>' + O.icon('left') + 'All reports</button>' +
      '<div class="rp-ttl"><div class="crumb">' + esc(GRP[rep.group].name) + '</div><h2>' + esc(rep.name) + '</h2><div class="ds">' + esc(rep.desc) + '</div></div>' +
      '<select class="select rp-switch" data-switch aria-label="Switch to another report">' + GROUPS.map(function (g) {
        return '<optgroup label="' + esc(g.name) + '">' + REPORTS.filter(function (x) { return x.group === g.id; }).map(function (x) { return '<option value="' + x.id + '"' + (x.id === rep.id ? ' selected' : '') + '>' + esc(x.name) + (locked(x) ? ' (financial access)' : '') + '</option>'; }).join('') + '</optgroup>';
      }).join('') + '</select></div>';
    var bar = '<div class="rp-bar"><div class="grp"><span data-slot="range"></span></div>' +
      '<div class="grp"><span class="lbl">Compare with</span><div class="seg rp-cmp" role="group" aria-label="Compare with">' + COMPARE.map(function (x) { return '<button type="button" data-cmp="' + x[0] + '" class="' + (x[0] === st.compare ? 'on' : '') + '" aria-pressed="' + (x[0] === st.compare) + '"><span class="l">' + esc(x[1]) + '</span><span class="s">' + esc(x[2]) + '</span></button>'; }).join('') + '</div></div>' +
      '<div class="grp"><label class="sr-only" for="rp-prop">Property</label><select id="rp-prop" class="select"><option value="">All properties</option>' + D.properties.filter(function (p) { return (!p.archived || p.id === st.pid) && O.inCur(p); }).map(function (p) { return '<option value="' + p.id + '"' + (p.id === st.pid ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select>' + O.curSwitchHTML() + '</div></div>';

    var html = '<div class="pg-reports">' + head + (lk ? '' : bar), built = null;
    if (lk) {
      html += '<div class="card"><div class="card-body">' + U.locked(rep.name + ' report', { reason: 'permission' }) + '</div></div>';
    } else if (!D.properties.length) {
      var canAdd = O.allowed('properties') && O.can('properties.create');
      html += '<div class="card"><div class="empty"><div class="e-icon">' + O.icon(rep.icon) + '</div><p style="margin:0 0 12px">This report fills in once you have properties and bookings.</p>' + (canAdd ? '<button type="button" class="btn btn-primary" data-go="properties">' + O.icon('plus') + 'Add a unit</button>' : '') + '</div></div>';
    } else if (NEEDS[rep.need] && !NEEDS[rep.need].has()) {
      var nd = NEEDS[rep.need];
      html += '<div class="card"><div class="empty"><div class="e-icon">' + O.icon(rep.icon) + '</div><p style="margin:0 0 12px">' + esc(nd.text) + '</p>' + (O.allowed(nd.page) ? '<button type="button" class="btn btn-primary" data-go="' + nd.page + '">' + esc(nd.label) + '</button>' : '') + '</div></div>';
    } else {
      built = BUILD[rep.id](r, c);
      if (built.unavailable || built.empty) {
        html += '<div class="card"><div class="empty"><div class="e-icon">' + O.icon(rep.icon) + '</div><p style="margin:0 0 12px">' + esc(built.unavailable || built.empty) + '</p>' + (built.empty && O.allowed('properties') ? '<button type="button" class="btn btn-primary" data-go="properties">Open properties</button>' : '') + '</div></div>';
        built = null;
      } else {
        var dis = exp ? '' : ' disabled title="' + esc(WHY_EXPORT) + '"';
        html += '<div class="rp-sum">' + built.insight + (c ? ' <span class="muted">Compared with ' + esc(rangeText(c)) + '.</span>' : '') + (clampNote ? ' <span class="muted">' + esc(clampNote) + '</span>' : '') + '</div>' +
          U.kpis(built.kpis) +
          '<div class="grid g-2-1 rp-main">' +
          '<div class="card"><div class="card-head"><div class="hd"><h3>' + esc(built.chartTitle) + '</h3><div class="sub">' + esc(built.chartSub) + '</div></div></div><div class="card-body"><div class="rp-chart"></div>' + (built.chart.legend ? '<div class="rp-legend">' + built.chart.legend + '</div>' : '') + '</div></div>' +
          '<div class="card"><div class="card-head"><div class="hd"><h3>' + esc(built.side.title) + '</h3><div class="sub">' + esc(built.side.sub) + '</div></div></div><div class="card-body' + (built.side.flush ? ' flush' : '') + '">' + built.side.html + '</div></div>' +
          '</div>' +
          '<div class="card" style="margin-top:14px"><div class="card-head"><div class="hd"><h3>' + esc(built.table.title) + '</h3><div class="sub">' + esc(built.table.sub) + ' · ' + esc(rangeText(r)) + ' · tap a column to sort</div></div>' +
          '<div class="rp-actions">' + toolsHTML(built) + '<button type="button" class="btn btn-ghost btn-sm" data-act="csv"' + dis + '>' + O.icon('download') + 'CSV</button><button type="button" class="btn btn-ghost btn-sm" data-act="pdf"' + dis + '>' + O.icon('file') + 'PDF</button></div></div>' +
          '<div class="card-body flush tbl">' + tableHTML(built) + '</div>' +
          (built.notes ? '<div class="card-foot">' + esc(built.notes) + '</div>' : '') + '</div>';
      }
    }
    html += '</div>';
    root.innerHTML = html;

    if (!lk) U.mount(root, 'range', U.dateRange({
      from: st.from, to: st.to, preset: st.preset, presets: 'past',
      onChange: function (v) { st.from = v.from; st.to = v.to; st.preset = v.preset; render(root, ctx); }
    }));
    if (built) {
      built.chart.draw(O.$('.rp-chart', root));
      O.$('.rp-main', root).classList.add('drawn');
    }

    var off = !built || !exp, why = !exp ? WHY_EXPORT : 'Nothing to export';
    var acts = O.html('<div class="row-flex rp-actions-top" style="gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-top="schedule"' + (off ? ' disabled title="' + esc(why) + '"' : '') + '>' + O.icon('mail') + 'Schedule</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-top="csv"' + (off ? ' disabled title="' + esc(why) + '"' : '') + '>' + O.icon('download') + 'Export CSV</button>' +
      '<button type="button" class="btn btn-primary btn-sm" data-top="pdf"' + (off ? ' disabled title="' + esc(why) + '"' : '') + '>' + O.icon('file') + 'Export PDF</button></div>');
    acts.addEventListener('click', function (e) {
      var b = e.target.closest('[data-top]'); if (!b || !built || b.disabled) return;
      if (b.dataset.top === 'csv') doCSV(built, r); else if (b.dataset.top === 'pdf') doPDF(built, r, c); else scheduleModal();
    });
    ctx.setActions(acts);

    root.onclick = function (e) {
      var t = e.target.closest('[data-lib]');
      if (t) { st.view = 'library'; render(root, ctx); window.scrollTo(0, 0); return; }
      t = e.target.closest('[data-cmp]');
      if (t) { st.compare = t.dataset.cmp; render(root, ctx); return; }
      t = e.target.closest('[data-inv-view]');
      if (t) { st.invView = t.dataset.invView; render(root, ctx); return; }
      t = e.target.closest('[data-inv-metric]');
      if (t) { st.invMetric = t.dataset.invMetric; render(root, ctx); return; }
      t = e.target.closest('[data-sort]');
      if (t && built) { var i = +t.dataset.sort, s = st.sort, k = sortKey(); st.sort = { key: k, col: i, dir: s && s.key === k && s.col === i ? -s.dir : (isNum(built.table.cols[i]) ? -1 : 1) }; O.$('.tbl', root).innerHTML = tableHTML(built); return; }
      t = e.target.closest('[data-act]');
      if (t && built && !t.disabled) { if (t.dataset.act === 'csv') doCSV(built, r); else doPDF(built, r, c); return; }
      t = e.target.closest('[data-go-owner]');
      if (t) { O.go('owner', { owner: t.dataset.goOwner }); return; }
      t = e.target.closest('[data-go]');
      if (t) O.go(t.dataset.go);
    };
    O.$('[data-switch]', root).onchange = function (e) { openReport(e.target.value, root, ctx); };
    O.curSwitchWire(root);
    var sel = O.$('#rp-prop', root);
    if (sel) sel.onchange = function () { st.pid = sel.value; render(root, ctx); };
  }

  function render(root, ctx) {
    var p0 = ctx.params || {};
    if (ctx.fresh) {
      if (p0.report && REP[p0.report]) { st.report = p0.report; st.view = 'report'; } else st.view = 'library';
      if (p0.propertyId && D.propById[p0.propertyId]) { st.pid = p0.propertyId; if (!O.inCur(st.pid)) O.store.set('viewCur', O.curOf(st.pid)); } /* open in that unit's currency */
      ctx.fresh = false; /* internal re-renders reuse this ctx */
    }
    if (st.pid && (!D.propById[st.pid] || !O.inCur(st.pid))) st.pid = ''; /* the currency was switched: back to all units */
    if (st.view === 'report') renderReport(root, ctx); else renderLibrary(root, ctx);
  }

  O.page('reports', {
    desc: 'Reports by type, with date ranges, comparisons and CSV or PDF export',
    render: render
  });
})();
