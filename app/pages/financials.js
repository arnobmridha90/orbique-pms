/* Orbique Command Center v4 — Financials (account owners only; the router blocks everyone else, and render checks again)
   4 cards (revenue, operating expenses, operating profit, capital spending, each vs the comparison period), PDF + CSV export,
   cash flow by month, profit and loss, by property, spending by person (owner included), tourism tax collected (passed through).
   v4: the profit and loss counts operating expenses only (expense.costClass 'opex'). Capital spending (costClass 'capex':
   long-lasting purchases such as furniture, appliances, an AC unit or renovation) is shown below operating profit and in the
   cash flow, never inside profit. Expenses come from M.expenses(from, to, cls), so anything recorded on Expenses shows here. */
(function () {
  var O = window.O, D = O.data, M = O.metrics, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;

  /* ---- shared money setup (identical block in invoices.js, expenses.js, financials.js; runs once) ---- */
  var CLAIM = 'Paid personally (claim)';
  (function moneyInit() {
    if (D._moneyReady) return; D._moneyReady = true;
    D.expenses.forEach(function (e) {
      if (e.method !== CLAIM || e.claimStatus) return;
      var age = d.diff(e.date, D.STORY0 || D.TODAY); /* seed data, relative to the demo's own day (shifted later with D) */
      if (age <= 10) e.claimStatus = 'pending';
      else if (age <= 18) { e.claimStatus = 'approved'; e.approvedAt = d.add(e.date, 2); e.approvedBy = 's1'; }
      else { e.claimStatus = 'reimbursed'; e.approvedAt = d.add(e.date, 2); e.approvedBy = 's1'; e.reimbursedAt = d.add(e.date, 6); }
    });
    D.invoiceSettings = D.invoiceSettings || {
      autoInvoice: 'auto', autoReceipt: 'auto', invPattern: 'INV-{YYYY}-{seq}', rcpPattern: 'RCP-{YYYY}-{seq}',
      tourismTax: true, sst: false, sstNo: '', sstRate: 8, dueDays: 7
    };
  })();

  var CAP_HELP = 'Capital spending is a long-lasting purchase for a property, such as furniture, an AC unit or renovation. It is kept out of operating profit and shown in the cash flow.';
  var PRESETS = ['last7', 'last30', 'mtd', 'lastMonth', 'last90', 'qtd', 'lastQuarter', 'ytd', 'since'];
  var st = { preset: 'mtd', from: null, to: null, cmp: 'auto', psort: 'net', pdir: -1 };

  O.css('financials', [
    '.pg-financials{display:flex;flex-direction:column;gap:14px;}',
    '.pg-financials .kpis{margin-bottom:0;}',
    '.pg-financials .k-sub .sm{display:none;} @media (max-width:560px){.pg-financials .k-sub .lg{display:none;} .pg-financials .k-sub .sm{display:inline;}}',
    '.pg-financials .fin-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}',
    '.pg-financials .fin-bar .grow{min-width:0;}',
    '.pg-financials .fin-lock{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);font-weight:600;}',
    '.pg-financials .fin-lock svg{width:14px;height:14px;}',
    '.pg-financials .fin-bar .seg button{padding:6px 10px;font-size:12px;}',
    '.pg-financials .fin-main{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:14px;align-items:start;}',
    '.pg-financials .fin-col{display:flex;flex-direction:column;gap:14px;min-width:0;}',
    '.pg-financials .pl td, .pg-financials .pl th{padding:7px 12px;}',
    '.pg-financials .pl th:first-child, .pg-financials .pl td:first-child{padding-left:16px;}',
    '.pg-financials .pl th:last-child, .pg-financials .pl td:last-child{padding-right:16px;}',
    '.pg-financials .pl tr.sec td{background:var(--surface-2);font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);padding-top:8px;padding-bottom:6px;}',
    '.pg-financials .pl tr.sub td:first-child{padding-left:30px;color:var(--text-2);}',
    '.pg-financials .pl tr.tot td{font-weight:800;border-top:1px solid var(--border-strong);}',
    '.pg-financials .pl tr.net td{font-weight:800;font-size:14px;background:var(--brand-soft-2);border-top:2px solid var(--brand-strong);}',
    '.pg-financials .pl tr.sec.cap td{background:var(--accent-soft);color:var(--accent-text);}',
    '.pg-financials .pl tr.cash td{font-weight:800;border-top:2px solid var(--border-strong);}',
    '.pg-financials .fin-cap{display:flex;gap:10px;align-items:flex-start;}',
    '.pg-financials .fin-cap .cc-dot{width:10px;height:10px;border-radius:3px;background:var(--accent);flex-shrink:0;margin-top:4px;}',
    '.pg-financials .fin-empty{text-align:center;padding:8px 16px 26px;}',
    '.pg-financials .pl td.neg{color:var(--text-2);}',
    '.pg-financials .pl .prev{color:var(--muted);}',
    '.pg-financials .chart-legend{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px;}',
    '.pg-financials .mon td, .pg-financials .mon th{padding:6px 7px;font-size:12px;}',
    '.pg-financials .mon th:last-child, .pg-financials .mon td:last-child{padding-right:16px;}',
    '.pg-financials .mon th:first-child, .pg-financials .mon td:first-child{padding-left:16px;}',
    '.pg-financials .mon tr.cur td{background:var(--brand-soft-2);font-weight:700;}',
    '.pg-financials th.sortable{cursor:pointer;user-select:none;}',
    '.pg-financials th.sortable:hover{color:var(--text);}',
    '.pg-financials th.sortable .ar{font-size:9px;margin-left:3px;}',
    '.pg-financials th.sorted{color:var(--brand-text);}',
    '.pg-financials .bp td, .pg-financials .bp th, .pg-financials .ppl td, .pg-financials .ppl th{padding:8px 10px;}',
    '.pg-financials .bp td:first-child, .pg-financials .bp th:first-child, .pg-financials .ppl td:first-child, .pg-financials .ppl th:first-child{padding-left:16px;}',
    '.pg-financials .bp td:last-child, .pg-financials .bp th:last-child, .pg-financials .ppl td:last-child, .pg-financials .ppl th:last-child{padding-right:16px;}',
    '.pg-financials .pn{display:flex;align-items:center;gap:8px;font-weight:700;white-space:nowrap;}',
    '.pg-financials .pn small{display:block;font-weight:500;color:var(--muted);font-size:11.5px;}',
    '.pg-financials .mbar{display:inline-block;width:52px;height:6px;border-radius:3px;background:var(--surface-2);border:1px solid var(--border);vertical-align:middle;margin-right:6px;overflow:hidden;}',
    '.pg-financials .mbar i{display:block;height:100%;background:var(--brand-strong);}',
    '.pg-financials .m-neg{color:var(--bad);font-weight:700;}',
    '.pg-financials .share{display:flex;align-items:center;gap:8px;min-width:120px;}',
    '.pg-financials .share .progress{flex:1;}',
    '.pg-financials .tt{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px;}',
    '.pg-financials .tt .k{font-size:11px;font-weight:700;color:var(--muted);} .pg-financials .tt .v{font-family:var(--font-head);font-weight:800;font-size:18px;margin-top:2px;font-variant-numeric:tabular-nums;}',
    '.pg-financials .ppl tr.click:hover td{background:var(--surface-2);}',
    '.pg-financials td.num{white-space:nowrap;} .pg-financials .ppl td.small{min-width:180px;}',
    '@media (max-width:1180px){.pg-financials .fin-main{grid-template-columns:minmax(0,1fr);}}',
    '@media (max-width:760px){ .pg-financials .btn, .pg-financials .chip, .pg-financials .select, .pg-financials .input, .pg-financials .dr-btn, .pg-financials .seg button{min-height:40px;} .pg-financials .search{height:40px;} .pg-financials .switch::before{content:"";position:absolute;inset:-10px -4px;} .pg-financials .ppl tr.click td{padding-top:11px;padding-bottom:11px;}}',
    '@media (max-width:560px){.pg-financials .pn small{display:none;} .pg-financials .pn{white-space:normal;min-width:140px;} .pg-financials .tt{grid-template-columns:minmax(0,1fr) minmax(0,1fr);} .pg-financials .fin-bar .dr, .pg-financials .fin-bar .dr-btn{max-width:100%;} .pg-financials .fin-bar .dr-btn{overflow:hidden;}}'
  ].join('\n'));

  /* ------------------------------------------------------------------ numbers */
  function range() { if (st.preset) { var p = U.preset(st.preset); return { from: p.from, to: p.to }; } return { from: st.from, to: st.to }; }
  function cmpRange(r) {
    var monthAligned = r.from === d.monthStart(r.from) && (r.to === d.monthEnd(r.to) || r.to === D.TODAY) && r.from.slice(0, 7) === r.to.slice(0, 7);
    if (st.cmp === 'month' || (st.cmp === 'auto' && monthAligned)) {
      var f = d.addMonths(r.from, -1), t = d.addMonths(r.to, -1);
      if (r.to === d.monthEnd(r.to)) t = d.monthEnd(f);
      return { from: f, to: t, why: 'same days last month' };
    }
    var n = d.diff(r.from, r.to) + 1;
    return { from: d.add(r.from, -n), to: d.add(r.from, -1), why: 'previous ' + n + ' days' };
  }
  function countable(e) { return !(e.method === CLAIM && e.claimStatus === 'rejected'); }
  /* M.expenses leaves out rejected claims and, with cls, keeps one cost type ('opex' when costClass is missing) */
  function expIn(from, to, cls) { return M.expenses(from, to, cls).filter(function (e) { return countable(e) && O.inCur(e); }); } /* several currencies: the view currency's only */
  function isGeneral(e) { return !e.propertyId || !D.propById[e.propertyId]; } /* company costs, and costs of a removed property */
  function forProp(list, pid) { return pid === undefined ? list : list.filter(function (e) { return pid === null ? isGeneral(e) : e.propertyId === pid; }); }
  function prop(id) { return D.propById[id] || { id: id, name: 'Removed property', short: 'Removed', area: '' }; }
  function firstMonth() { /* the first month with data, at most 12 months back */
    var first = D.DATA_START || D.TODAY;
    D.expenses.forEach(function (e) { if (e.date && e.date < first) first = e.date; });
    var m = d.monthStart(first), cap = d.addMonths(d.monthStart(D.TODAY), -11);
    return m < cap ? cap : m;
  }
  function sum(list, f) { return list.reduce(function (s, x) { return s + (f ? f(x) : x.amount); }, 0); }
  function pnl(from, to, pid) {
    var o = { acc: 0, cln: 0, tax: 0, nights: 0, taxNights: 0, fees: {}, feeTotal: 0, stays: 0 };
    D.channelOrder.forEach(function (c) { o.fees[c] = 0; });
    D.bookings.forEach(function (b) {
      if (!M.live(b) || (pid ? b.propertyId !== pid : !O.inCur(b))) return;
      var n = M.nightsIn(b, from, to); if (!n) return;
      var k = n / b.nights;
      o.acc += b.accommodation * k; o.cln += b.cleaningFee * k; o.tax += b.tourismTax * k; o.nights += n; o.stays++;
      if (b.tourismTax) o.taxNights += n;
      o.fees[b.channel] += b.platformFee * k; o.feeTotal += b.platformFee * k;
    });
    o.revenue = o.acc + o.cln;
    var ex = forProp(expIn(from, to, 'opex'), pid), cap = forProp(expIn(from, to, 'capex'), pid);
    o.exp = ex; o.expTotal = sum(ex);                 /* operating expenses: inside profit */
    o.cap = cap; o.capTotal = sum(cap);               /* capital spending: below operating profit */
    o.byType = {}; o.capByType = {};
    ex.forEach(function (e) { o.byType[e.type] = (o.byType[e.type] || 0) + e.amount; });
    cap.forEach(function (e) { o.capByType[e.type] = (o.capByType[e.type] || 0) + e.amount; });
    o.net = o.revenue - o.feeTotal - o.expTotal;      /* operating profit */
    o.margin = o.revenue ? o.net / o.revenue : null;
    o.cash = o.net - o.capTotal;                      /* what is left after capital purchases */
    return o;
  }
  function months() {
    var out = [], m = firstMonth();
    while (m <= D.TODAY) {
      var to = d.monthEnd(m) < D.TODAY ? d.monthEnd(m) : D.TODAY, p = pnl(m, to);
      out.push({ from: m, to: to, label: d.MONTHS[d.month(m) - 1] + (m.slice(0, 4) !== D.TODAY.slice(0, 4) ? ' ' + m.slice(0, 4) : '') + (to !== d.monthEnd(m) ? ' (1–' + d.day(to) + ')' : ''), short: d.MONTHS[d.month(m) - 1] + (m.slice(0, 4) !== D.TODAY.slice(0, 4) ? ' ’' + m.slice(2, 4) : ''), p: p, partial: to !== d.monthEnd(m) });
      m = d.addMonths(m, 1);
    }
    return out;
  }
  function money(n) { return fmt.money(Math.round(n)); }
  function occAll(r) { /* several currencies: the view currency's units only */
    if (!O.multiCur()) return M.occupancy(r.from, r.to);
    var ps = D.properties.filter(O.inCur), av = sum(ps, function (p) { return M.availableNights(r.from, r.to, p.id); });
    return av ? sum(ps, function (p) { return M.nightsSold(r.from, r.to, { propertyId: p.id }); }) / av : 0;
  }
  function neg(n) { return n ? '−' + money(n) : money(0); }
  function pctTxt(x) { return x == null ? '–' : (x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(1) + '%'; }
  function deltaCell(cur, prev, invert) { return U.delta(fmt.change(cur, prev), { invert: invert }); }

  /* ------------------------------------------------------------------ sections */
  function pnlRows(a, b) { /* rows: [label, cur, prev, kind, invert] — kind: sec | sub | tot | net | row | pct */
    var rows = [['Revenue', null, null, 'sec'],
      ['Accommodation', a.acc, b.acc, 'sub'], ['Cleaning fees', a.cln, b.cln, 'sub'], ['Total revenue', a.revenue, b.revenue, 'tot'],
      ['Platform fees', null, null, 'sec']];
    D.channelOrder.forEach(function (c) { if (a.fees[c] || b.fees[c]) rows.push([U.platName(c) + ' (' + Math.round(D.channels[c].feePct * 100) + '%)', -a.fees[c], -b.fees[c], 'sub', true]); });
    rows.push(['Total platform fees', -a.feeTotal, -b.feeTotal, 'tot', true]);
    rows.push(['Net revenue after fees', a.revenue - a.feeTotal, b.revenue - b.feeTotal, 'tot']);
    rows.push(['Operating expenses', null, null, 'sec']);
    typesOf(a.byType, b.byType).forEach(function (t) { rows.push([t, -(a.byType[t] || 0), -(b.byType[t] || 0), 'sub', true]); });
    rows.push(['Total operating expenses', -a.expTotal, -b.expTotal, 'tot', true]);
    rows.push(['Operating profit', a.net, b.net, 'net']);
    rows.push(['Operating margin', a.margin, b.margin, 'pct']);
    rows.push(['Capital spending (not in profit)', null, null, 'sec cap']);
    typesOf(a.capByType, b.capByType).forEach(function (t) { rows.push([t, -(a.capByType[t] || 0), -(b.capByType[t] || 0), 'sub', true]); });
    rows.push(['Total capital spending', -a.capTotal, -b.capTotal, 'tot', true]);
    rows.push(['Net cash', a.cash, b.cash, 'cash']);
    return rows;
  }
  function typesOf(x, y) { /* expense types in the usual order, then any others */
    var ks = D.expenseTypes.filter(function (t) { return x[t] || y[t]; });
    Object.keys(x).concat(Object.keys(y)).forEach(function (t) { if ((x[t] || y[t]) && ks.indexOf(t) < 0) ks.push(t); });
    return ks;
  }
  function pnlCard(a, b, r, c) {
    var rows = pnlRows(a, b);
    return '<div class="card"><div class="card-head"><div><h3>Profit and loss</h3><div class="sub">' + esc(U.rangeLabel(r.from, r.to)) + ' vs ' + esc(U.rangeLabel(c.from, c.to)) + '</div></div></div>' +
      '<div class="table-wrap"><table class="table pl"><thead><tr><th>Line</th><th class="num">This period</th><th class="num">Comparison</th><th class="num">Change</th></tr></thead><tbody>' +
      rows.map(function (x) {
        if (x[3].indexOf('sec') === 0) return '<tr class="' + x[3] + '"><td colspan="4">' + esc(x[0]) + '</td></tr>';
        if (x[3] === 'pct') return '<tr><td>' + esc(x[0]) + '</td><td class="num b">' + pctTxt(x[1]) + '</td><td class="num prev">' + pctTxt(x[2]) + '</td><td class="num">' + (x[1] != null && x[2] != null ? '<span class="delta ' + (x[1] >= x[2] ? 'good' : 'bad') + '">' + (x[1] >= x[2] ? '▲ ' : '▼ ') + Math.abs((x[1] - x[2]) * 100).toFixed(1) + ' pts</span>' : '–') + '</td></tr>';
        var cur = x[1], prev = x[2];
        return '<tr class="' + x[3] + '"><td>' + esc(x[0]) + '</td><td class="num' + (cur < 0 ? ' neg' : '') + '">' + (cur < 0 ? neg(-cur) : money(cur)) + '</td><td class="num prev">' + (prev < 0 ? neg(-prev) : money(prev)) + '</td><td class="num">' + deltaCell(Math.abs(cur), Math.abs(prev), !!x[4]) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="card-foot"><div class="fin-cap"><span class="cc-dot" aria-hidden="true"></span><span>' + CAP_HELP + '</span></div><div style="margin-top:6px">Revenue counts the nights stayed in the period (accommodation and cleaning, excluding tourism tax). Expenses count by the date paid; rejected claims are left out.</div></div></div>';
  }
  function monthSpan(ms) { var a = ms[0], z = ms[ms.length - 1]; return d.MONTHS_LONG[d.month(a.from) - 1] + (a.from.slice(0, 4) !== z.from.slice(0, 4) ? ' ' + a.from.slice(0, 4) : '') + ' to ' + d.MONTHS_LONG[d.month(z.from) - 1] + ' ' + z.from.slice(0, 4); }
  function signed(n) { return n < 0 ? neg(-n) : money(n); }
  function chartCard(ms, r) {
    var z = ms[ms.length - 1];
    return '<div class="card"><div class="card-head"><div><h3>Cash flow by month</h3><div class="sub">' + esc(monthSpan(ms)) + (z.partial ? ' · * ' + d.MONTHS[d.month(z.from) - 1] + ' is month to date (1 to ' + d.day(z.to) + ')' : '') + '</div></div></div><div class="card-body">' +
      '<div class="chart-legend">' + O.chart.legend([{ name: 'Revenue', tone: 'brand', square: true }, { name: 'Platform fees', tone: 'prev2', square: true }, { name: 'Operating expenses', tone: 'prev1', square: true }, { name: 'Capital spending', tone: 'accent', square: true }]) + '</div>' +
      '<div class="fin-chart"></div></div>' +
      '<div class="table-wrap"><table class="table mon"><thead><tr><th>Month</th><th class="num">Revenue</th><th class="num">Fees</th><th class="num">Operating</th><th class="num" title="Operating profit">Profit</th><th class="num">Capital</th><th class="num">Net cash</th></tr></thead><tbody>' +
      ms.map(function (m) {
        var on = m.from <= r.to && m.to >= r.from;
        return '<tr class="' + (on ? 'cur' : '') + '"><td class="nowrap"' + (m.partial ? ' title="' + esc(m.label) + '"' : '') + '>' + esc(m.short + (m.partial ? '*' : '')) + '</td><td class="num">' + money(m.p.revenue) + '</td><td class="num">' + neg(m.p.feeTotal) + '</td><td class="num">' + neg(m.p.expTotal) + '</td><td class="num b' + (m.p.net < 0 ? ' m-neg' : '') + '">' + signed(m.p.net) + '</td><td class="num">' + neg(m.p.capTotal) + '</td><td class="num b' + (m.p.cash < 0 ? ' m-neg' : '') + '">' + signed(m.p.cash) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="card-foot">Profit is operating profit. Net cash is operating profit minus capital spending: capital purchases lower the cash for the month but not the profit.</div></div>';
  }
  function taxCard(a, r) {
    var foreign = D.bookings.filter(function (b) { return M.live(b) && b.tourismTax && O.inCur(b) && O.tourismTaxApplies(b) && M.nightsIn(b, r.from, r.to); });
    var byP = {}; foreign.forEach(function (b) { var n = M.nightsIn(b, r.from, r.to); byP[b.propertyId] = (byP[b.propertyId] || 0) + b.tourismTax / b.nights * n; });
    var top = Object.keys(byP).sort(function (x, y) { return byP[y] - byP[x]; });
    return '<div class="card"><div class="card-head"><div><h3>Tourism tax collected</h3><div class="sub">Passed through to the government, not counted as revenue</div></div></div><div class="card-body">' +
      '<div class="tt"><div><div class="k">Collected</div><div class="v">' + money(a.tax) + '</div></div><div><div class="k">Foreign guest nights</div><div class="v">' + fmt.num(a.taxNights) + '</div></div><div><div class="k">Stays</div><div class="v">' + fmt.num(foreign.length) + '</div></div></div>' +
      (top.length ? O.chart.hbars(top.slice(0, 6).map(function (pid) { return { label: '<span class="prop-dot" style="background:' + U.propColor(pid) + '"></span>' + esc(prop(pid).short), value: byP[pid], display: money(byP[pid]) }; })) : U.empty('No foreign guests stayed in this period.')) +
      '</div><div class="card-foot">' + fmt.money(10, { cur: 'MYR' }) + ' per room per night for foreign guests. Malaysians are exempt. Declare and pay it with your monthly tourism tax return.</div></div>';
  }
  function propRows(r) {
    var out = D.properties.filter(O.inCur).map(function (p) {
      var x = pnl(r.from, r.to, p.id);
      return { id: p.id, name: p.name, short: p.short, area: p.area, nights: x.nights, occ: M.occupancy(r.from, r.to, p.id), revenue: x.revenue, fees: x.feeTotal, exp: x.expTotal, net: x.net, margin: x.margin, cap: x.capTotal };
    });
    var g = pnl(r.from, r.to, null);
    var general = { id: null, name: 'General / company', short: 'General', area: 'Not tied to a unit', nights: 0, occ: null, revenue: 0, fees: 0, exp: g.expTotal, net: -g.expTotal, margin: null, cap: g.capTotal };
    var k = st.psort, dir = st.pdir;
    out.sort(function (a, b) { var va = a[k], vb = b[k]; if (typeof va === 'string') return dir * va.localeCompare(vb); return dir * ((va || 0) - (vb || 0)); });
    return { rows: out, general: general };
  }
  function propCard(r) {
    var pr = propRows(r), all = pr.rows.concat([pr.general]);
    var T = { nights: sum(all, function (x) { return x.nights; }), revenue: sum(all, function (x) { return x.revenue; }), fees: sum(all, function (x) { return x.fees; }), exp: sum(all, function (x) { return x.exp; }), cap: sum(all, function (x) { return x.cap; }) };
    T.net = T.revenue - T.fees - T.exp;
    var maxM = Math.max.apply(null, pr.rows.map(function (x) { return x.margin || 0; }).concat([0.01]));
    function th(key, label, num) { var on = st.psort === key; return '<th class="sortable' + (num ? ' num' : '') + (on ? ' sorted' : '') + '" data-sort="' + key + '" aria-sort="' + (on ? (st.pdir > 0 ? 'ascending' : 'descending') : 'none') + '">' + label + (on ? '<span class="ar">' + (st.pdir > 0 ? '▲' : '▼') + '</span>' : '') + '</th>'; }
    return '<div class="card"><div class="card-head"><div><h3>By property</h3><div class="sub">' + esc(U.rangeLabel(r.from, r.to)) + ' · select a column to sort</div></div></div>' +
      '<div class="table-wrap"><table class="table bp"><thead><tr>' + th('name', 'Property') + th('nights', 'Nights', 1) + th('occ', 'Occupancy', 1) + th('revenue', 'Revenue', 1) + th('fees', 'Platform fees', 1) + th('exp', 'Operating expenses', 1) + th('net', 'Operating profit', 1) + th('margin', 'Margin', 1) + th('cap', 'Capital', 1) + '</tr></thead><tbody>' +
      all.map(function (x) {
        return '<tr><td><div class="pn">' + (x.id ? '<span class="prop-dot" style="background:' + U.propColor(x.id) + '"></span>' : '<span class="prop-dot" style="background:var(--border-strong)"></span>') + '<span>' + esc(x.name) + '<small>' + esc(x.area) + '</small></span></div></td>' +
          '<td class="num">' + (x.id ? fmt.num(x.nights) : '–') + '</td><td class="num">' + (x.occ == null ? '–' : fmt.pct(x.occ)) + '</td><td class="num">' + (x.id ? money(x.revenue) : '–') + '</td><td class="num">' + (x.id ? neg(x.fees) : '–') + '</td><td class="num">' + neg(x.exp) + '</td>' +
          '<td class="num b' + (x.net < 0 ? ' m-neg' : '') + '">' + (x.net < 0 ? neg(-x.net) : money(x.net)) + '</td>' +
          '<td class="num nowrap' + (x.margin != null && x.margin < 0 ? ' m-neg' : '') + '">' + (x.margin == null ? '–' : '<span class="mbar" aria-hidden="true"><i style="width:' + Math.max(0, x.margin / maxM * 100).toFixed(0) + '%"></i></span>' + pctTxt(x.margin)) + '</td>' +
          '<td class="num">' + (x.cap ? neg(x.cap) : '–') + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td>All properties</td><td class="num">' + fmt.num(T.nights) + '</td><td class="num">' + fmt.pct(occAll(r)) + '</td><td class="num">' + money(T.revenue) + '</td><td class="num">' + neg(T.fees) + '</td><td class="num">' + neg(T.exp) + '</td><td class="num">' + signed(T.net) + '</td><td class="num">' + pctTxt(T.revenue ? T.net / T.revenue : null) + '</td><td class="num">' + neg(T.cap) + '</td></tr></tfoot></table></div>' +
      '<div class="card-foot">Operating profit is revenue minus platform fees and operating expenses. Capital purchases are listed on their own.</div></div>';
  }
  function peopleRows(r) {
    var ex = expIn(r.from, r.to), total = sum(ex) || 1;
    return D.staff.map(function (s) {
      var mine = ex.filter(function (e) { return e.paidBy === s.id; }), capMine = mine.filter(function (e) { return e.costClass === 'capex'; });
      var types = {}; mine.forEach(function (e) { var k = e.type === 'Others' ? (e.otherType || 'Others') : e.type; types[k] = (types[k] || 0) + e.amount; });
      var top = Object.keys(types).sort(function (a, b) { return types[b] - types[a]; }).slice(0, 2);
      var pend = D.expenses.filter(function (e) { return e.paidBy === s.id && e.method === CLAIM && e.claimStatus === 'pending' && O.inCur(e); });
      var appr = D.expenses.filter(function (e) { return e.paidBy === s.id && e.method === CLAIM && e.claimStatus === 'approved' && O.inCur(e); });
      var claimsIn = mine.filter(function (e) { return e.method === CLAIM; });
      return { s: s, total: sum(mine), cap: sum(capMine), n: mine.length, top: top, types: types, share: sum(mine) / total, pend: pend, appr: appr, claimed: sum(claimsIn) };
    }).filter(function (x) { return x.n || x.pend.length || x.appr.length || x.s.role === 'owner'; }).sort(function (a, b) { return b.total - a.total || (a.s.role === 'owner' ? -1 : 1); });
  }
  function peopleCard(r) {
    var rows = peopleRows(r);
    return '<div class="card"><div class="card-head"><div><h3>Spending by person</h3><div class="sub">Everyone who spent money in ' + esc(U.rangeLabel(r.from, r.to)) + ', including the account owner. Totals include capital purchases. Select a person to see their expenses.</div></div></div>' +
      '<div class="table-wrap"><table class="table ppl"><thead><tr><th>Person</th><th class="num">Total</th><th class="num">Expenses</th><th>Share</th><th>Top types</th><th class="num">Paid personally</th><th>Claims open now</th></tr></thead><tbody>' +
      rows.map(function (x) {
        return '<tr class="click" data-person="' + x.s.id + '" tabindex="0"><td><div class="pn">' + U.avatar(x.s.name, 'sm') + '<span>' + esc(x.s.name) + '<small>' + esc(x.s.roleLabel) + '</small></span></div></td>' +
          '<td class="num b">' + money(x.total) + (x.cap ? '<div class="small muted" style="font-weight:500">' + money(x.cap) + ' capital</div>' : '') + '</td><td class="num">' + x.n + '</td>' +
          '<td><div class="share"><div class="progress" aria-hidden="true"><i style="width:' + (x.share * 100).toFixed(1) + '%"></i></div><span class="small nowrap">' + fmt.pct(x.share) + '</span></div></td>' +
          '<td class="small">' + (x.top.length ? x.top.map(function (t) { return esc(t) + ' <span class="muted">' + money(x.types[t]) + '</span>'; }).join('<br>') : '<span class="faint">Nothing in this period</span>') + '</td>' +
          '<td class="num">' + (x.claimed ? money(x.claimed) : '–') + '</td>' +
          '<td>' + (x.pend.length ? U.pill(x.pend.length + ' to approve · ' + money(sum(x.pend)), 'warn') + ' ' : '') + (x.appr.length ? U.pill(money(sum(x.appr)) + ' to pay back', 'info') : '') + (!x.pend.length && !x.appr.length ? '<span class="faint small">None</span>' : '') + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td>Everyone</td><td class="num">' + money(sum(rows, function (x) { return x.total; })) + '</td><td class="num">' + sum(rows, function (x) { return x.n; }) + '</td><td></td><td></td><td class="num">' + money(sum(rows, function (x) { return x.claimed; })) + '</td><td></td></tr></tfoot></table></div></div>';
  }

  /* ------------------------------------------------------------------ export */
  function exportCSV(r, c, a, b) {
    var C = fmt.cur();
    var out = [['Profit and loss', U.rangeLabel(r.from, r.to), 'Comparison: ' + U.rangeLabel(c.from, c.to)], [], ['Line', 'This period (' + C + ')', 'Comparison (' + C + ')', 'Change']];
    pnlRows(a, b).forEach(function (x) {
      if (x[3].indexOf('sec') === 0) { out.push([x[0].toUpperCase()]); return; }
      if (x[3] === 'pct') { out.push([x[0], pctTxt(x[1]), pctTxt(x[2]), '']); return; }
      var ch = fmt.change(Math.abs(x[1]), Math.abs(x[2]));
      out.push([(x[3] === 'sub' ? '  ' : '') + x[0], x[1].toFixed(2), x[2].toFixed(2), fmt.changeText(ch).replace('−', '-')]);
    });
    out.push(['Tourism tax collected (passed through, not revenue)', a.tax.toFixed(2), b.tax.toFixed(2), '']);
    out.push([CAP_HELP]);
    out.push([], ['BY PROPERTY'], ['Property', 'Nights', 'Occupancy', 'Revenue (' + C + ')', 'Platform fees (' + C + ')', 'Operating expenses (' + C + ')', 'Operating profit (' + C + ')', 'Margin', 'Capital spending (' + C + ')']);
    var pr = propRows(r); pr.rows.concat([pr.general]).forEach(function (x) { out.push([x.name, x.nights, x.occ == null ? '' : fmt.pct(x.occ), x.revenue.toFixed(2), x.fees.toFixed(2), x.exp.toFixed(2), x.net.toFixed(2), pctTxt(x.margin), x.cap.toFixed(2)]); });
    out.push([], ['CASH FLOW BY MONTH'], ['Month', 'Revenue (' + C + ')', 'Platform fees (' + C + ')', 'Operating expenses (' + C + ')', 'Operating profit (' + C + ')', 'Capital spending (' + C + ')', 'Net cash (' + C + ')']);
    months().forEach(function (m) { out.push([m.label, m.p.revenue.toFixed(2), m.p.feeTotal.toFixed(2), m.p.expTotal.toFixed(2), m.p.net.toFixed(2), m.p.capTotal.toFixed(2), m.p.cash.toFixed(2)]); });
    out.push([], ['SPENDING BY PERSON (operating and capital)'], ['Person', 'Role', 'Total (' + C + ')', 'Of which capital (' + C + ')', 'Expenses', 'Share', 'Top types', 'Paid personally (' + C + ')', 'Claims to approve now', 'Approved, to pay back (' + C + ')']);
    peopleRows(r).forEach(function (x) { out.push([x.s.name, x.s.roleLabel, x.total.toFixed(2), x.cap.toFixed(2), x.n, fmt.pct(x.share), x.top.join('; '), x.claimed.toFixed(2), x.pend.length, sum(x.appr).toFixed(2)]); });
    O.downloadCSV('Financials-' + r.from + '-to-' + r.to + '.csv', out);
  }
  function exportPDF(r, c, a, b) {
    var m2 = function (n) { return (n < 0 ? '-' : '') + fmt.cur() + ' ' + fmt.num(Math.abs(n)); };
    return O.pdf.start('Profit and loss', U.rangeLabel(r.from, r.to)).then(function (res) {
      var doc = res.doc, y = res.y;
      var summary = [['Revenue', m2(a.revenue)], ['Operating expenses', m2(a.expTotal)], ['Operating profit', m2(a.net) + '  (' + pctTxt(a.margin) + ')'], ['Capital spending', m2(a.capTotal)]];
      var cw = 186 / 4;
      summary.forEach(function (s, i) {
        var cx = 12 + i * cw;
        doc.setDrawColor(227, 230, 235); doc.roundedRect(cx, y - 4, cw - 3, 13, 2, 2, 'S');
        doc.setFontSize(7.5); doc.setTextColor(95, 107, 122); doc.setFont('helvetica', 'normal'); doc.text(s[0], cx + 3, y + 0.5);
        doc.setFontSize(10.5); doc.setTextColor(20, 24, 31); doc.setFont('helvetica', 'bold'); doc.text(s[1], cx + 3, y + 6.5);
      });
      y += 18;
      y = O.pdf.text(doc, y, 'Compared with ' + U.rangeLabel(c.from, c.to) + '. Revenue counts nights stayed in the period, excluding tourism tax. ' + CAP_HELP, { muted: true, size: 8 });
      y = O.pdf.table(doc, y + 3, [{ label: 'Line', w: 90 }, { label: 'This period', w: 34, align: 'right' }, { label: 'Comparison', w: 34, align: 'right' }, { label: 'Change', w: 28, align: 'right' }],
        pnlRows(a, b).map(function (x) {
          if (x[3].indexOf('sec') === 0) return [x[0].toUpperCase(), '', '', ''];
          if (x[3] === 'pct') return [x[0], pctTxt(x[1]), pctTxt(x[2]), ''];
          return [(x[3] === 'sub' ? '   ' : '') + x[0], m2(x[1]), m2(x[2]), fmt.changeText(fmt.change(Math.abs(x[1]), Math.abs(x[2])))];
        }).concat([['Tourism tax collected (passed through)', m2(a.tax), m2(b.tax), '']]));
      if (y > 220) { doc.addPage(); y = 18; }
      y = O.pdf.text(doc, y + 4, 'By property', { bold: true, size: 10.5 });
      var pr = propRows(r);
      y = O.pdf.table(doc, y + 3, [{ label: 'Property', w: 46 }, { label: 'Nights', w: 14, align: 'right' }, { label: 'Occ.', w: 14, align: 'right' }, { label: 'Revenue', w: 24, align: 'right' }, { label: 'Fees', w: 21, align: 'right' }, { label: 'Operating', w: 22, align: 'right' }, { label: 'Op. profit', w: 24, align: 'right' }, { label: 'Capital', w: 21, align: 'right' }],
        pr.rows.concat([pr.general]).map(function (x) { return [x.name, x.id ? x.nights : '', x.occ == null ? '' : fmt.pct(x.occ), x.id ? m2(x.revenue) : '', x.id ? m2(-x.fees) : '', m2(-x.exp), m2(x.net), x.cap ? m2(-x.cap) : '-']; })
          .concat([['All properties', a.nights, fmt.pct(occAll(r)), m2(a.revenue), m2(-a.feeTotal), m2(-a.expTotal), m2(a.net), m2(-a.capTotal)]]), { boldLast: true });
      if (y > 220) { doc.addPage(); y = 18; }
      y = O.pdf.text(doc, y + 4, 'Spending by person (operating and capital)', { bold: true, size: 10.5 });
      y = O.pdf.table(doc, y + 3, [{ label: 'Person', w: 44 }, { label: 'Role', w: 34 }, { label: 'Total', w: 26, align: 'right' }, { label: 'Count', w: 16, align: 'right' }, { label: 'Top type', w: 42 }, { label: 'Open claims', w: 24, align: 'right' }],
        peopleRows(r).map(function (x) { return [x.s.name, x.s.roleLabel, m2(x.total), x.n, x.top[0] || '-', x.pend.length ? m2(sum(x.pend)) : '-']; })
          .concat([['Everyone', '', m2(a.expTotal + a.capTotal), a.exp.length + a.cap.length, '', '']]), { boldLast: true });
      O.pdf.text(doc, y + 4, 'Confidential: Financials are visible to account owners only.', { muted: true, size: 8 });
      return O.pdf.save(doc, 'Financials-' + r.from + '-to-' + r.to + '.pdf');
    }).catch(function () { return false; });
  }

  /* ------------------------------------------------------------------ page */
  O.page('financials', {
    desc: 'Profit and loss, cash flow, by property and by person. Account owners only.',
    render: function (root, ctx) {
      if (!O.isOwner()) { ctx.setActions(''); root.innerHTML = U.locked('Financials'); return; } /* the router already blocks this; never show money by mistake */
      if (!D.bookings.length && !D.expenses.length) { /* empty workspace: one sentence plus the main action */
        ctx.setActions('');
        root.innerHTML = '<div class="pg-financials"><div class="card"><div class="fin-empty">' + U.empty('Your profit and loss fills in as bookings and expenses come in.', '📊') +
          (D.properties.length ? '<button type="button" class="btn btn-primary" data-go="bookings">' + O.icon('plus') + 'Add a booking</button>' : '<button type="button" class="btn btn-primary" data-go="properties">' + O.icon('plus') + 'Add your first property</button>') + '</div></div></div>';
        O.$('.pg-financials', root).addEventListener('click', function (e) { var g = e.target.closest('[data-go]'); if (g) O.go(g.dataset.go); });
        return;
      }
      var r = range(), c = cmpRange(r), a = pnl(r.from, r.to), b = pnl(c.from, c.to), ms = months();
      var span = monthSpan(ms);
      function perDay(k) { return ms.map(function (m) { return m.p[k] / (d.diff(m.from, m.to) + 1); }); }
      var vs = '<span class="lg">vs ' + esc(U.rangeLabel(c.from, c.to)) + '</span><span class="sm">vs ' + esc(c.from === c.to ? d.fmt(c.from) : d.fmtRange(c.from, c.to)) + '</span>';
      ctx.setActions('<button type="button" class="btn btn-ghost" data-top="csv">' + O.icon('download') + 'Export CSV</button><button type="button" class="btn btn-primary" data-top="pdf">' + O.icon('file') + 'Export PDF</button>');
      root.innerHTML = '<div class="pg-financials">' +
        '<div class="fin-bar"><span data-slot="range"></span>' +
        '<span class="small muted">Compare with</span>' + U.seg([['auto', 'Auto'], ['prev', 'Previous period'], ['month', 'Same days last month']], st.cmp, 'data-cmp') +
        O.curSwitchHTML() + '<span class="grow"></span><span class="fin-lock">' + O.icon('lock') + 'Only account owners can open Financials. Staff Access cannot grant it.</span></div>' +
        U.kpis([
          { label: 'Revenue', value: money(a.revenue), delta: fmt.change(a.revenue, b.revenue), sub: vs, spark: perDay('revenue'), hl: true, title: 'Spark line: revenue per day, ' + span },
          { label: 'Operating expenses', value: money(a.expTotal), delta: fmt.change(a.expTotal, b.expTotal), deltaOpts: { invert: true }, sub: vs, spark: perDay('expTotal'), title: 'The running costs of the month. Spark line: per day, ' + span },
          { label: 'Operating profit', value: signed(a.net) + ' <span class="small muted" style="font-weight:700">' + pctTxt(a.margin) + '</span>', delta: fmt.change(a.net, b.net), sub: vs, spark: perDay('net'), title: 'Revenue minus platform fees and operating expenses. Spark line: per day, ' + span },
          { label: 'Capital spending', value: money(a.capTotal), sub: a.cap.length ? fmt.plural(a.cap.length, 'purchase') + '<span class="lg"> · not in profit</span>' : 'None in this period', title: 'Long-lasting purchases for a property, kept out of operating profit. Platform fees: ' + money(a.feeTotal) }
        ]) +
        '<div class="fin-main"><div class="fin-col">' + chartCard(ms, r) + (D.properties.some(function (p) { return O.inCur(p) && O.tourismTaxApplies(p); }) ? taxCard(a, r) : '') + '</div><div class="fin-col">' + pnlCard(a, b, r, c) + '</div></div>' +
        peopleCard(r) + propCard(r) + '</div>';

      O.curSwitchWire(root);
      U.mount(root, 'range', U.dateRange({
        preset: st.preset, from: st.from, to: st.to, presets: PRESETS,
        onChange: function (x) { st.preset = x.preset; st.from = x.from; st.to = x.to; ctx.rerender(); }
      }));
      O.chart.bars(O.$('.fin-chart', root), {
        labels: ms.map(function (m) { return m.short + (m.partial ? '*' : ''); }), height: 230,
        series: [{ name: 'Revenue', tone: 'brand', values: ms.map(function (m) { return Math.round(m.p.revenue); }) },
          { name: 'Platform fees', tone: 'prev2', values: ms.map(function (m) { return Math.round(m.p.feeTotal); }) },
          { name: 'Operating expenses', tone: 'prev1', values: ms.map(function (m) { return Math.round(m.p.expTotal); }) },
          { name: 'Capital spending', tone: 'accent', values: ms.map(function (m) { return Math.round(m.p.capTotal); }) }],
        yFormat: function (v) { return fmt.moneyShort(v); },
        tipTitle: function (i) { return ms[i].label + ' · operating profit ' + signed(ms[i].p.net) + ' · net cash ' + signed(ms[i].p.cash); },
        ariaLabel: 'Revenue, platform fees, operating expenses and capital spending by month'
      });
      ctx.actionsEl.onclick = function (e) {
        var x = e.target.closest('[data-top]'); if (!x) return;
        if (x.dataset.top === 'csv') exportCSV(r, c, a, b);
        if (x.dataset.top === 'pdf') { x.disabled = true; exportPDF(r, c, a, b).then(function () { x.disabled = false; }); }
      };
      var page = O.$('.pg-financials', root);
      page.addEventListener('click', function (e) {
        var t = e.target;
        var cm = t.closest('[data-cmp]'); if (cm) { st.cmp = cm.dataset.cmp; ctx.rerender(); return; }
        var so = t.closest('[data-sort]'); if (so) { var k = so.dataset.sort; if (st.psort === k) st.pdir = -st.pdir; else { st.psort = k; st.pdir = k === 'name' ? 1 : -1; } ctx.rerender(); return; }
        var pp = t.closest('[data-person]'); if (pp) O.go('expenses', { person: pp.dataset.person, from: r.from, to: r.to });
      });
      page.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('[data-person]')) e.target.click(); });
    }
  });
})();
