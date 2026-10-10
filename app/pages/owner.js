/* Owner portal — what each property owner sees: monthly statement, payouts, unit performance,
   upcoming stays (no guest contact details), maintenance log, owner stays and messages to the manager. */
(function () {
  var O = window.O, D = O.data, M = O.metrics, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  var MGMT = 0.2; /* management fee: 20% of rental income after platform fees */
  var FIRST_MONTH = '2026-06-01';
  /* expense types the manager absorbs under the management fee; every other cost recorded against a unit is charged to its owner */
  var NOT_CHARGED = ['Transport', 'Marketing', 'Software & subscriptions'];
  var CHARGE_RULE = 'Costs recorded against your units are charged at cost. Staff transport, marketing and software are covered by the management fee.';
  var st = { owner: null, month: null, tab: 'upcoming' };

  D.ownerPayouts = D.ownerPayouts || {};   /* key owner|YYYY-MM -> {approvedAt, by} */
  D.ownerMessages = D.ownerMessages || [
    { owner: 'Rajan Pillai', from: 'owner', text: 'Could you check the balcony door at Ferringhi Beach? The last guest mentioned it sticks.', at: '2026-10-02T09:14' },
    { owner: 'Rajan Pillai', from: 'manager', by: 's2', text: 'Raju looked at it on Saturday and planed the frame. It closes smoothly now.', at: '2026-10-03T16:40' },
    { owner: 'Chen Li Hua', from: 'manager', by: 's2', text: 'Your owner stay on 15–18 Oct is blocked on every channel. The unit will be cleaned before you arrive.', at: '2026-09-28T11:05' }
  ];

  O.css('owner', [
    '.pg-owner .op-hero{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 16px;border-radius:var(--r);background:var(--brand);color:var(--brand-ink);margin-bottom:14px;}',
    '.pg-owner .op-hero .ws-logo{width:42px;height:42px;border-radius:10px;flex-shrink:0;background:var(--surface);padding:4px;}',
    '.pg-owner .op-row{align-items:start;margin-top:14px;}',
    '.pg-owner .op-col{display:flex;flex-direction:column;gap:14px;min-width:0;}',
    '.pg-owner .split .label{margin-bottom:8px;}',
    '.pg-owner .sp-bar{display:flex;height:12px;border-radius:6px;overflow:hidden;background:var(--surface-2);margin-bottom:10px;}',
    '.pg-owner .sp-bar i{display:block;height:100%;}',
    '.pg-owner .sp-bar i + i{box-shadow:inset 1px 0 0 var(--surface);}',
    '.pg-owner .sp-row{display:flex;align-items:center;gap:8px;font-size:12.5px;padding:3px 0;color:var(--text-2);}',
    '.pg-owner .sp-row b{color:var(--text);font-variant-numeric:tabular-nums;}',
    '.pg-owner .sp-row .sw{width:10px;height:10px;border-radius:3px;flex-shrink:0;}',
    '.pg-owner .up-g{font-weight:700;white-space:nowrap;}',
    '.pg-owner .up-s{font-size:11.5px;color:var(--muted);white-space:nowrap;margin-top:1px;}',
    '.pg-owner .op-hero .who{flex:1;min-width:200px;}',
    '.pg-owner .op-hero .who .t{font-family:var(--font-head);font-size:17px;font-weight:800;}',
    '.pg-owner .op-hero .who .s{font-size:12px;opacity:.85;margin-top:2px;}',
    '.pg-owner .op-hero .ctl{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}',
    '.pg-owner .op-hero .select{width:auto;min-width:150px;background-color:var(--surface);color:var(--text);}',
    '.pg-owner .op-hero label{font-size:11px;font-weight:700;opacity:.85;display:block;margin-bottom:3px;}',
    '.pg-owner .op-units{display:flex;gap:6px;flex-wrap:wrap;margin:-4px 0 14px;}',
    '.pg-owner .op-units .chip{cursor:default;white-space:normal;max-width:100%;display:inline-block;line-height:1.4;}',
    '.pg-owner .nw td{white-space:nowrap;}',
    '@media (max-width:760px){.pg-owner .stmt td:first-child,.pg-owner .perf td:first-child{white-space:nowrap;min-width:0;}}',
    '.pg-owner .op-units .prop-dot{margin-right:2px;}',
    '.pg-owner .stmt td:first-child{min-width:150px;}',
    '.pg-owner .stmt-sum{padding:14px 16px;border-top:1px solid var(--border);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:28px;align-items:start;}',
    '.pg-owner .stmt-sum .note{grid-column:1/-1;}',
    '@media (max-width:640px){.pg-owner .stmt-sum{grid-template-columns:minmax(0,1fr);gap:16px;}}',
    '.pg-owner .stmt-sum .kv dd.neg{color:var(--text-2);}',
    '.pg-owner .pay-row td{vertical-align:middle;}',
    '.pg-owner .table td.num,.pg-owner .table th.num{white-space:nowrap;}',
    '.pg-owner .pay-row .pill{white-space:nowrap;}',
    '.pg-owner .pay-row.sel td{background:var(--brand-soft-2);}',
    '.pg-owner .op-chart{min-height:200px;}',
    '.pg-owner .stay-g{font-weight:700;}',
    '.pg-owner .msg{padding:9px 11px;border-radius:10px;font-size:12.5px;line-height:1.45;max-width:88%;margin-bottom:8px;}',
    '.pg-owner .msg.owner{background:var(--surface-2);border:1px solid var(--border);}',
    '.pg-owner .msg.manager{background:var(--brand-soft);margin-left:auto;}',
    '.pg-owner .msg .m-by{font-size:10.5px;color:var(--muted);margin-top:3px;font-weight:600;}',
    '.pg-owner .btn svg{width:15px;height:15px;}',
    '.pg-owner .card-head .hd{min-width:0;}',
    '.pg-owner .tabs{display:flex;gap:4px;padding:0 12px;border-bottom:1px solid var(--border);overflow-x:auto;}',
    '.pg-owner .ml-ic{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-2);flex-shrink:0;}',
    '.pg-owner .ml-ic svg{width:14px;height:14px;}',
    '.pg-owner .ml-work{min-width:230px;}',
    '@media (max-width:560px){.pg-owner .op-hero .ctl{width:100%;}.pg-owner .op-hero .ctl > div{flex:1;min-width:0;}.pg-owner .op-hero .select{width:100%;min-width:0;}}'
  ].join('\n'));

  /* ------------------------------------------------------------------ data */
  function owners() {
    var map = {};
    D.properties.forEach(function (p) { (map[p.owner] = map[p.owner] || []).push(p); });
    return Object.keys(map).sort(function (a, b) { return map[b].length - map[a].length || (a < b ? -1 : 1); }).map(function (k) { return { name: k, units: map[k] }; });
  }
  function ownerUnits(name) { return D.properties.filter(function (p) { return p.owner === name; }); }
  function months() { var out = [], m = FIRST_MONTH; while (m <= D.TODAY) { out.push(m); m = d.addMonths(m, 1); } return out; }
  function monthEnd(ms) { var e = d.monthEnd(ms); return e > D.TODAY ? D.TODAY : e; }
  function monthLabel(ms) { return d.monthName(ms, true) + ' ' + ms.slice(0, 4); }
  function fees(pid, a, b) {
    return D.bookings.reduce(function (s, x) { if (!M.live(x) || x.propertyId !== pid) return s; var n = M.nightsIn(x, a, b); return s + (n ? x.platformFee / x.nights * n : 0); }, 0);
  }
  function unitExpenses(pid, a, b) { return D.expenses.filter(function (e) { return e.propertyId === pid && e.date >= a && e.date <= b && NOT_CHARGED.indexOf(e.type) < 0; }); }
  function rateOf(pid, iso) { var o = D.priceOverrides && D.priceOverrides[pid]; return (o && o[iso]) || D.rateFor(pid, iso, 0); }
  function manager() { return D.staff.filter(function (x) { return x.role === 'ops'; })[0] || D.staff[0]; }
  /* where each ringgit of revenue went: payout, management fee, platform fees, expenses */
  function splitHTML(t) {
    /* this month's own figures only (t.raw excludes any balance carried from last month) */
    var over = t.raw < 0, parts = [['Owner payout', Math.max(0, t.raw), 'var(--brand-strong)'], ['Management fee', t.mgmt, 'var(--text-2)'], ['Platform fees', t.fee, 'var(--c-prev1)'], ['Expenses charged', t.exp, 'var(--c-prev2)']];
    if (over) parts.shift();
    var tot = parts.reduce(function (s2, x) { return s2 + x[1]; }, 0);
    if (!tot) return '<div class="split"></div>';
    return '<div class="split"><div class="label">' + (over ? 'Costs this month, above the revenue' : 'Where the revenue went') + '</div><div class="sp-bar" role="img" aria-label="' + esc(parts.map(function (x) { return x[0] + ' ' + fmt.pct(x[1] / tot); }).join(', ')) + '">' +
      parts.map(function (x) { return x[1] > 0 ? '<i style="width:' + (x[1] / tot * 100).toFixed(2) + '%;background:' + x[2] + '"></i>' : ''; }).join('') + '</div>' +
      parts.map(function (x) { return '<div class="sp-row"><span class="sw" style="background:' + x[2] + '"></span><span class="grow">' + esc(x[0]) + '</span><b>' + fmt.pct(x[1] / tot) + '</b></div>'; }).join('') + '</div>';
  }
  function statement(name, ms, toOverride) {
    var a = ms, b = toOverride || monthEnd(ms);
    var lines = ownerUnits(name).map(function (p) {
      var gross = M.revenue(a, b, { propertyId: p.id }), fee = fees(p.id, a, b), net = gross - fee, mg = net * MGMT;
      var ex = unitExpenses(p.id, a, b), exT = ex.reduce(function (s, e) { return s + e.amount; }, 0);
      return { p: p, gross: gross, fee: fee, net: net, mgmt: mg, exp: exT, expList: ex, payout: net - mg - exT, nights: M.nightsSold(a, b, { propertyId: p.id }), occ: M.occupancy(a, b, p.id), adr: M.adr(a, b, { propertyId: p.id }), rating: M.avgRating(a, b, p.id), reviews: D.reviews.filter(function (r) { return r.propertyId === p.id && r.date >= a && r.date <= b; }).length };
    });
    var t = { gross: 0, fee: 0, net: 0, mgmt: 0, exp: 0, payout: 0, nights: 0, avail: 0 };
    lines.forEach(function (l) { ['gross', 'fee', 'net', 'mgmt', 'exp', 'payout', 'nights'].forEach(function (k) { t[k] += l[k]; }); t.avail += M.availableNights(a, b, l.p.id); });
    t.occ = t.avail ? t.nights / t.avail : 0; t.adr = t.nights ? t.gross / t.nights : 0;
    var rv = D.reviews.filter(function (r) { return r.date >= a && r.date <= b && lines.some(function (l) { return l.p.id === r.propertyId; }); });
    t.rating = rv.length ? rv.reduce(function (s, r) { return s + r.stars; }, 0) / rv.length : null; t.reviews = rv.length;
    /* a negative balance from last month is carried forward and deducted from this payout */
    t.carry = 0; t.raw = t.payout;
    var pm = d.addMonths(ms, -1);
    if (pm >= FIRST_MONTH) { var pS = statement(name, pm); if (pS.t.payout < 0) t.carry = pS.t.payout; }
    t.payout = t.raw + t.carry;
    return { from: a, to: b, partial: b < d.monthEnd(ms), lines: lines, t: t };
  }
  function payoutDate(ms) { return d.add(d.addMonths(ms, 1), 6); } /* 7th of the following month */
  function payoutState(name, ms) {
    var key = name + '|' + ms.slice(0, 7), ap = D.ownerPayouts[key], pd = payoutDate(ms);
    if (d.monthEnd(ms) >= D.TODAY) return { k: 'open', label: 'Month in progress', short: 'In progress', pill: 'info', key: key };
    if (pd < D.TODAY) return { k: 'paid', label: 'Paid ' + d.fmt(pd), short: 'Paid ' + d.fmt(pd), pill: 'ok', key: key };
    if (ap) return { k: 'approved', label: 'Approved, pays ' + d.fmt(pd), short: 'Approved', pill: 'brand', key: key, ap: ap };
    return { k: 'review', label: 'Awaiting approval', short: 'To approve', pill: 'warn', key: key };
  }
  function guestShort(n) { var p = String(n).replace(/^The /, '').split(/\s+/); return p.length > 1 && n.indexOf('The ') !== 0 ? p[0] + ' ' + p[p.length - 1][0] + '.' : n; }
  function propCell(p) { return '<span class="prop-dot" style="background:' + U.propColor(p.id) + '"></span> ' + esc(p.name); }
  function pts(c) { if (c == null || isNaN(c)) return '<span class="delta flat">–</span>'; var flat = Math.abs(c) < 0.0005; return '<span class="delta ' + (flat ? 'flat' : c > 0 ? 'good' : 'bad') + '">' + (flat ? '' : c > 0 ? '▲ ' : '▼ ') + Math.abs(c * 100).toFixed(1) + ' pts</span>'; }
  function minus(v) { return v ? '−' + fmt.money(v) : fmt.money(0); } /* deductions: never show −RM 0 */
  function portalLink() { return 'https://' + O.ws().domain + '/owners'; }

  /* ------------------------------------------------------------------ actions */
  function statementRows(S) {
    return S.lines.map(function (l) { return [l.p.name, l.nights, Math.round(l.gross), Math.round(l.fee), Math.round(l.mgmt), Math.round(l.exp), Math.round(l.payout)]; });
  }
  function fileBase(name, ms) { return ('owner-statement-' + name + '-' + ms.slice(0, 7)).toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
  function downloadCSV(name, ms) {
    var S = statement(name, ms), t = S.t;
    var rows = [['Owner statement', name], ['Period', U.rangeLabel(S.from, S.to)], ['Management fee', (MGMT * 100) + '% of rental income after platform fees'], ['Expenses', CHARGE_RULE], [],
      ['Unit', 'Nights', 'Revenue (RM)', 'Platform fees (RM)', 'Management fee (RM)', 'Expenses charged (RM)', 'Owner payout (RM)']]
      .concat(statementRows(S)).concat(t.carry ? [['Carried from ' + d.monthName(d.addMonths(ms, -1), true), '', '', '', '', '', Math.round(t.carry)]] : []).concat([['Total', t.nights, Math.round(t.gross), Math.round(t.fee), Math.round(t.mgmt), Math.round(t.exp), Math.round(t.payout)]]);
    var ex = []; S.lines.forEach(function (l) { l.expList.forEach(function (e) { ex.push([e.date, l.p.name, e.type === 'Others' && e.otherType ? e.otherType : e.type, e.note || '', e.amount]); }); });
    if (ex.length) rows = rows.concat([[], ['Expenses charged'], ['Date', 'Unit', 'Type', 'Note', 'Amount (RM)']]).concat(ex);
    O.downloadCSV(fileBase(name, ms) + '.csv', rows);
  }
  function downloadPDF(name, ms) {
    var S = statement(name, ms), t = S.t, ps = payoutState(name, ms);
    var rows = S.lines.map(function (l) { return [l.p.name, fmt.num(l.nights), fmt.money(l.gross), fmt.money(l.fee), fmt.money(l.mgmt), fmt.money(l.exp), fmt.money(l.payout)]; });
    if (t.carry) rows.push(['Carried from ' + d.monthName(d.addMonths(ms, -1), true), '', '', '', '', '', fmt.money(t.carry)]);
    rows.push(['Total', fmt.num(t.nights), fmt.money(t.gross), fmt.money(t.fee), fmt.money(t.mgmt), fmt.money(t.exp), fmt.money(t.payout)]);
    O.pdf.report({
      filename: fileBase(name, ms) + '.pdf', title: 'Owner statement', subtitle: name + ' · ' + monthLabel(ms) + (S.partial ? ' (to ' + d.fmt(S.to) + ')' : ''),
      summary: [['Revenue', fmt.money(t.gross)], ['Management fee', fmt.money(t.mgmt)], ['Expenses charged', fmt.money(t.exp)], ['Owner payout', fmt.money(t.payout)]],
      columns: [{ label: 'Unit', w: 50 }, { label: 'Nights', w: 16, align: 'right' }, { label: 'Revenue', w: 24, align: 'right' }, { label: 'Platform fees', w: 24, align: 'right' }, { label: 'Mgmt fee', w: 22, align: 'right' }, { label: 'Expenses', w: 22, align: 'right' }, { label: 'Payout', w: 28, align: 'right' }],
      rows: rows, boldLast: true,
      notes: 'Revenue is accommodation and cleaning fees for nights stayed in the period. Management fee is ' + (MGMT * 100) + '% of revenue after platform fees. ' + CHARGE_RULE + ' Payout status: ' + ps.label + '. Payouts go to the bank account on file on the 7th of the following month.'
    });
  }
  function messageModal(name) {
    U.modal({
      title: 'Message the manager', sub: 'From ' + name + ' to the ' + O.ws().name + ' team',
      body: '<div class="field"><label for="om-topic">Topic</label><select id="om-topic" class="select"><option>Question about my statement</option><option>Maintenance or repairs</option><option>Owner stay</option><option>Pricing and availability</option><option>Something else</option></select></div>' +
        '<div class="field" style="margin-top:10px"><label for="om-text">Message</label><textarea id="om-text" class="textarea" rows="4" placeholder="Write your message"></textarea></div>' +
        '<div class="note" style="margin-top:10px">' + esc(manager().name) + ' (' + esc(manager().roleLabel) + ') usually replies within a few hours. Prototype: messages are not really sent.</div>',
      actions: [{ label: 'Cancel' }, {
        label: 'Send message', kind: 'primary', onClick: function (close, el) {
          var txt = O.$('#om-text', el).value.trim();
          if (!txt) { U.toast('Write a message first', 'bad'); return false; }
          D.ownerMessages.push({ owner: name, from: 'owner', topic: O.$('#om-topic', el).value, text: txt, at: D.NOW });
          U.toast('Message sent to ' + manager().name);
          O.emit('data', { type: 'owner-message' });
        }
      }]
    });
  }
  function replyModal(name) {
    U.modal({
      title: 'Reply to ' + name, sub: 'Shown in their owner portal and sent by email',
      body: '<div class="field"><label for="om-r">Reply</label><textarea id="om-r" class="textarea" rows="4"></textarea></div><div class="note" style="margin-top:10px">Prototype: emails are not really sent.</div>',
      actions: [{ label: 'Cancel' }, {
        label: 'Send reply', kind: 'primary', onClick: function (close, el) {
          var txt = O.$('#om-r', el).value.trim(); if (!txt) { U.toast('Write a reply first', 'bad'); return false; }
          D.ownerMessages.push({ owner: name, from: 'manager', by: O.viewer().id, text: txt, at: D.NOW });
          U.toast('Reply sent to ' + name); O.emit('data', { type: 'owner-message' });
        }
      }]
    });
  }
  function ownerStayModal(name) {
    var units = ownerUnits(name);
    U.modal({
      title: 'Request an owner stay', sub: 'Blocks the dates on every channel so no guest can book them',
      body: '<div class="form-grid"><div class="field full"><label for="os-unit">Unit</label><select id="os-unit" class="select">' + units.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="os-from">Arrive</label><input id="os-from" type="date" class="input" value="' + d.add(D.TODAY, 21) + '" min="' + D.TODAY + '"></div>' +
        '<div class="field"><label for="os-to">Leave</label><input id="os-to" type="date" class="input" value="' + d.add(D.TODAY, 24) + '" min="' + d.add(D.TODAY, 1) + '"></div>' +
        '<div class="field full"><label for="os-note">Note for the team (optional)</label><input id="os-note" class="input" placeholder="e.g. arriving late, please leave extra towels"></div></div>' +
        '<div class="os-msg note" style="margin-top:10px">Pick the dates to check availability.</div>',
      onOpen: function (el) {
        function check() {
          var pid = O.$('#os-unit', el).value, a = O.$('#os-from', el).value, b = O.$('#os-to', el).value, box = O.$('.os-msg', el);
          if (!a || !b || b <= a) { box.className = 'os-msg note warn'; box.textContent = 'The leave date must be after the arrive date.'; return false; }
          var clash = D.bookings.filter(function (x) { return M.live(x) && x.propertyId === pid && x.checkIn < b && a < x.checkOut; });
          var bl = D.blocks.filter(function (x) { return x.propertyId === pid && x.start < b && a < x.end; });
          if (clash.length || bl.length) { box.className = 'os-msg note warn'; box.textContent = clash.length ? 'These dates overlap ' + fmt.plural(clash.length, 'guest booking') + ' (' + clash.map(function (x) { return d.fmtRange(x.checkIn, x.checkOut); }).join(', ') + '). Choose other dates.' : 'These dates are already blocked.'; return false; }
          box.className = 'os-msg note brand'; box.textContent = 'Available: ' + fmt.plural(d.diff(a, b), 'night') + ', ' + d.fmtRange(a, b) + '. Lost revenue estimate ' + fmt.money(d.range(a, d.add(b, -1)).reduce(function (s, x) { return s + rateOf(pid, x); }, 0)) + ' at current prices.';
          return true;
        }
        el.addEventListener('change', check); el.addEventListener('input', check); check();
        el._check = check;
      },
      actions: [{ label: 'Cancel' }, {
        label: 'Block these dates', kind: 'primary', onClick: function (close, el) {
          if (!el._check()) { U.toast('Choose dates that are free', 'bad'); return false; }
          var pid = O.$('#os-unit', el).value, a = O.$('#os-from', el).value, b = O.$('#os-to', el).value, note = O.$('#os-note', el).value.trim();
          D.blocks.push({ id: 'BL-' + (D.blocks.length + 1) + '-' + D.hash(pid + a) % 1000, propertyId: pid, start: a, end: b, type: 'owner', note: 'Owner stay (' + name + ')' + (note ? ': ' + note : '') });
          U.toast('Owner stay blocked on all channels: ' + D.propById[pid].short + ', ' + d.fmtRange(a, b));
          O.emit('data', { type: 'block' });
        }
      }]
    });
  }

  /* ------------------------------------------------------------------ render */
  function render(root, ctx) {
    var list = owners();
    if (ctx.params && ctx.params.owner && ctx.fresh) st.owner = ctx.params.owner;
    if (!st.owner || !list.some(function (o) { return o.name === st.owner; })) st.owner = list[0].name;
    var ms_ = months();
    if (!st.month) st.month = ms_[ms_.length - 2] || ms_[0]; /* last complete month */
    var name = st.owner, units = ownerUnits(name), isOwner = O.isOwner(), ws = O.ws();
    var S = statement(name, st.month), t = S.t;
    var prevMs = d.addMonths(st.month, -1), P = prevMs >= FIRST_MONTH ? statement(name, prevMs, S.partial ? d.addMonths(S.to, -1) : null) : null;
    var vsTxt = P ? 'vs ' + (S.partial ? d.fmtRange(P.from, P.to) : d.monthName(prevMs)) : null;
    var ps = payoutState(name, st.month);
    function dl(cur, prev) { return P && prev ? (cur - prev) / Math.abs(prev) : null; }

    var hero = '<div class="op-hero">' + O.theme.logoHTML(ws, O.theme.get('--brand')) +
      '<div class="who"><div class="t">' + esc(name) + '</div><div class="s">Owner portal preview · ' + fmt.plural(units.length, 'unit') + ' managed by ' + esc(ws.name) + ' · ' + esc(portalLink().replace('https://', '')) + '</div></div>' +
      '<div class="ctl"><div><label for="op-owner">Owner</label><select id="op-owner" class="select">' + list.map(function (o) { return '<option value="' + esc(o.name) + '"' + (o.name === name ? ' selected' : '') + '>' + esc(o.name) + ' (' + o.units.length + ')</option>'; }).join('') + '</select></div>' +
      '<div><label for="op-month">Statement month</label><select id="op-month" class="select">' + ms_.slice().reverse().map(function (m) { return '<option value="' + m + '"' + (m === st.month ? ' selected' : '') + '>' + monthLabel(m) + (d.monthEnd(m) >= D.TODAY ? ' (to date)' : '') + '</option>'; }).join('') + '</select></div></div></div>';

    var chips = '<div class="op-units">' + units.map(function (p) { return '<span class="chip"><span class="prop-dot" style="background:' + U.propColor(p.id) + '"></span>' + esc(p.name) + ' <span class="n">' + esc(p.type) + ' · ' + esc(p.area.split(',').pop().trim()) + '</span></span>'; }).join('') + '</div>';

    var kp = [];
    if (isOwner) {
      kp.push({ label: 'Revenue', value: fmt.money(t.gross), delta: dl(t.gross, P && P.t.gross), sub: vsTxt, hl: true });
      kp.push({ label: 'Owner payout', value: fmt.money(t.payout), delta: t.payout > 0 ? dl(t.payout, P && P.t.payout > 0 ? P.t.payout : null) : null, sub: ps.short });
    }
    kp.push({ label: 'Occupancy', value: fmt.pct(t.occ), sub: P ? pts(t.occ - P.t.occ) + ' vs ' + fmt.pct(P.t.occ) : null, hl: !isOwner });
    kp.push({ label: 'Nights sold', value: fmt.num(t.nights), delta: dl(t.nights, P && P.t.nights) });
    if (isOwner) kp.push({ label: 'ADR', value: fmt.money(t.adr), delta: dl(t.adr, P && P.t.adr), sub: 'per night sold' });
    kp.push({ label: 'Guest rating', value: t.rating ? t.rating.toFixed(2) + ' ★' : '–', sub: fmt.plural(t.reviews, 'review') });

    var html = '<div class="pg-owner">' + hero + chips + U.kpis(kp);

    /* statement + payouts */
    if (isOwner) {
      var stmt = '<div class="card"><div class="card-head"><div class="hd"><h3>Statement · ' + esc(monthLabel(st.month)) + (S.partial ? ' to date' : '') + '</h3><div class="sub">' + esc(U.rangeLabel(S.from, S.to)) + ' · management fee ' + (MGMT * 100) + '% of revenue after platform fees</div></div>' +
        '<div class="row-flex" style="gap:8px;flex-wrap:wrap">' + U.pill(ps.label, ps.pill) + '<button type="button" class="btn btn-ghost btn-sm" data-act="csv">' + O.icon('download') + 'CSV</button><button type="button" class="btn btn-ghost btn-sm" data-act="pdf">' + O.icon('file') + 'PDF</button></div></div>' +
        '<div class="card-body flush"><div class="table-wrap"><table class="table stmt"><thead><tr><th>Unit</th><th class="num">Nights</th><th class="num">Revenue</th><th class="num">Platform fees</th><th class="num">Mgmt fee</th><th class="num">Expenses</th><th class="num">Payout</th></tr></thead><tbody>' +
        S.lines.map(function (l) { return '<tr><td>' + propCell(l.p) + '</td><td class="num">' + l.nights + '</td><td class="num">' + fmt.money(l.gross) + '</td><td class="num">' + minus(l.fee) + '</td><td class="num">' + minus(l.mgmt) + '</td><td class="num">' + (l.exp ? minus(l.exp) : '<span class="faint">–</span>') + '</td><td class="num b">' + fmt.money(l.payout) + '</td></tr>'; }).join('') +
        '</tbody>' + (S.lines.length > 1 ? '<tfoot><tr><td>Total</td><td class="num">' + t.nights + '</td><td class="num">' + fmt.money(t.gross) + '</td><td class="num">' + minus(t.fee) + '</td><td class="num">' + minus(t.mgmt) + '</td><td class="num">' + (t.exp ? minus(t.exp) : '<span class="faint">–</span>') + '</td><td class="num">' + fmt.money(t.raw) + '</td></tr></tfoot>' : '') + '</table></div>' +
        '<div class="stmt-sum">' + splitHTML(t) + '<dl class="kv"><dt>Revenue from ' + fmt.plural(t.nights, 'night') + '</dt><dd>' + fmt.money(t.gross) + '</dd><dt>Platform fees</dt><dd class="neg">' + minus(t.fee) + '</dd><dt>Management fee (' + (MGMT * 100) + '%)</dt><dd class="neg">' + minus(t.mgmt) + '</dd><dt>Expenses charged</dt><dd' + (t.exp ? ' class="neg"' : '') + '>' + minus(t.exp) + '</dd>' + (t.carry ? '<dt>Carried from ' + esc(d.monthName(d.addMonths(st.month, -1), true)) + '</dt><dd class="neg">' + fmt.money(t.carry) + '</dd>' : '') + '<dt class="tot">Owner payout</dt><dd class="tot">' + fmt.money(t.payout) + '</dd></dl>' + (t.payout < 0 ? '<div class="note warn" style="margin-top:10px">' + (S.partial ? 'So far this month, costs are higher than the rental income. If that holds at month end, ' + fmt.money(-t.payout) + ' is carried forward' : 'Costs this month are higher than the rental income, so ' + fmt.money(-t.payout) + ' is carried forward') + ' and deducted from the next payout. Nothing is charged to the owner\u2019s bank account.</div>' : '') + '</div></div><div class="card-foot">' + esc(CHARGE_RULE) + '</div></div>';

      var hist = ms_.map(function (m) {
        var s = statement(name, m), p = payoutState(name, m);
        var act = p.k === 'review' ? '<button type="button" class="btn btn-primary btn-xs" data-approve="' + m + '">Approve</button>' : '';
        return '<tr class="pay-row click' + (m === st.month ? ' sel' : '') + '" data-month="' + m + '"><td><b>' + d.monthName(m) + '</b>' + (s.partial ? ' <span class="xs muted">to date</span>' : '') + '</td><td class="num b">' + fmt.money(s.t.payout) + '</td><td><div class="row-flex" style="gap:6px;flex-wrap:wrap">' + U.pill(p.label, p.pill) + act + '</div></td></tr>';
      }).reverse().join('');
      var payCard = '<div class="card"><div class="card-head"><div class="hd"><h3>Payouts</h3><div class="sub">Paid on the 7th of the following month after approval</div></div></div>' +
        '<div class="card-body flush"><div class="table-wrap"><table class="table"><thead><tr><th>Month</th><th class="num">Payout</th><th>Status</th></tr></thead><tbody>' + hist + '</tbody></table></div></div>' +
        '<div class="card-body"><div class="op-chart"></div><div class="legend-slot"></div></div></div>';
    } else {
      html += '<div class="card"><div class="card-body">' + U.locked('The owner statement and payouts') + '</div></div>';
    }

    /* unit performance + messages */
    var perf = '<div class="card"><div class="card-head"><div class="hd"><h3>Unit performance · ' + esc(monthLabel(st.month)) + (S.partial ? ' to date' : '') + '</h3><div class="sub">Occupancy, rates and guest ratings for each unit' + (P ? ' · change ' + esc(vsTxt) : '') + '</div></div></div>' +
      '<div class="card-body flush"><div class="table-wrap"><table class="table perf"><thead><tr><th>Unit</th><th class="num">Occupancy</th><th class="num">Change</th><th class="num">Nights</th>' + (isOwner ? '<th class="num">ADR</th>' : '') + '<th class="num">Rating</th><th class="num">Reviews</th></tr></thead><tbody>' +
      S.lines.map(function (l, i) {
        var pl = P ? P.lines[i] : null, c = pl ? l.occ - pl.occ : null;
        return '<tr><td>' + propCell(l.p) + '</td><td class="num"><div class="row-flex" style="justify-content:flex-end;gap:8px"><div class="progress" style="width:60px"><i style="width:' + Math.round(l.occ * 100) + '%"></i></div>' + fmt.pct(l.occ) + '</div></td><td class="num">' + pts(c) + '</td><td class="num">' + l.nights + '</td>' + (isOwner ? '<td class="num">' + fmt.money(l.adr) + '</td>' : '') + '<td class="num">' + (l.rating ? l.rating.toFixed(2) + ' <span style="color:var(--warn)">★</span>' : '<span class="faint">–</span>') + '</td><td class="num">' + l.reviews + '</td></tr>';
      }).join('') + '</tbody></table></div></div></div>';

    var msgs = D.ownerMessages.filter(function (m) { return m.owner === name; }).slice(-4);
    var msgCard = '<div class="card"><div class="card-head"><div class="hd"><h3>Messages with the manager</h3><div class="sub">' + (msgs.length ? fmt.plural(D.ownerMessages.filter(function (m) { return m.owner === name; }).length, 'message') : 'No messages yet') + '</div></div>' +
      '<div class="row-flex" style="gap:6px;flex-wrap:wrap">' + (msgs.length ? '<button type="button" class="btn btn-ghost btn-sm" data-act="reply">Reply as team</button>' : '') + '<button type="button" class="btn btn-primary btn-sm" data-act="msg">' + O.icon('chat') + 'Message the manager</button></div></div>' +
      '<div class="card-body">' + (msgs.length ? msgs.map(function (m) { var s = m.by ? D.staffById(m.by) : null; return '<div class="msg ' + m.from + '">' + (m.topic ? '<b>' + esc(m.topic) + '</b><br>' : '') + esc(m.text) + '<div class="m-by">' + esc(m.from === 'owner' ? name : (s ? s.name : ws.name)) + ' · ' + esc(fmt.dateTime(m.at)) + '</div></div>'; }).join('') : U.empty('Questions about statements, repairs or owner stays go straight to the operations team.')) + '</div></div>';

    /* upcoming stays + maintenance log (tabs) */
    var horizon = d.add(D.TODAY, 59);
    var stays = D.bookings.filter(function (b) { return M.live(b) && b.checkOut > D.TODAY && b.checkIn <= horizon && units.some(function (p) { return p.id === b.propertyId; }); });
    var ublocks = D.blocks.filter(function (x) { return x.end > D.TODAY && x.start <= horizon && units.some(function (p) { return p.id === x.propertyId; }); });
    function unitCell(p) { return '<span title="' + esc(p.name) + '"><span class="prop-dot" style="background:' + U.propColor(p.id) + '"></span> ' + esc(p.short) + '</span>'; }
    var rows = stays.map(function (b) { return { date: b.checkIn, html: '<tr><td>' + esc(d.fmtRange(b.checkIn, b.checkOut)) + '</td><td>' + unitCell(D.propById[b.propertyId]) + '</td><td><div class="up-g">' + esc(guestShort(b.guest.name)) + '</div><div class="up-s">' + esc(b.guest.countryName) + ' · ' + fmt.plural(b.guests, 'guest') + '</div></td><td class="num">' + b.nights + '</td><td>' + U.plat(b.channel) + '</td><td>' + U.status(b.status) + '</td></tr>' }; })
      .concat(ublocks.map(function (x) { var nt = x.note.replace(/^Owner stay \([^)]*\):?\s*/, ''); return { date: x.start, html: '<tr><td>' + esc(d.fmtRange(x.start, x.end)) + '</td><td>' + unitCell(D.propById[x.propertyId]) + '</td><td><div class="up-g">' + (x.type === 'owner' ? 'Owner stay' : 'Maintenance') + '</div><div class="up-s">' + esc(nt || (x.type === 'owner' ? name : 'Unit closed')) + '</div></td><td class="num">' + d.diff(x.start, x.end) + '</td><td><span class="xs muted">All channels closed</span></td><td><span class="st block"><i></i>Blocked</span></td></tr>' }; }))
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var upTable = rows.length ? '<div class="table-wrap"><table class="table nw"><thead><tr><th>Dates</th><th>Unit</th><th>Guest</th><th class="num">Nights</th><th>Channel</th><th>Status</th></tr></thead><tbody>' + rows.map(function (r) { return r.html; }).join('') + '</tbody></table></div>' : U.empty('No stays booked in the next 60 days.');

    var log = [];
    D.tasks.forEach(function (tk) {
      if ((tk.type === 'Maintenance' || tk.type === 'Inspection') && units.some(function (p) { return p.id === tk.propertyId; })) {
        var who = tk.assigneeId ? D.staffById(tk.assigneeId) : null;
        log.push({ date: (tk.doneAt || tk.due).slice(0, 10), ic: tk.type === 'Inspection' ? 'check' : 'tasks', unit: D.propById[tk.propertyId], what: tk.title + (tk.note && tk.note !== 'Unassigned' ? ' · ' + tk.note : ''), who: who ? who.name : 'Not assigned yet', cost: null, status: tk.status === 'done' ? U.pill('Done', 'ok') : tk.status === 'in_progress' ? U.pill('In progress', 'info') : (tk.due < D.NOW ? U.pill('Overdue', 'bad') : U.pill('Scheduled', 'neutral')) });
      }
    });
    D.expenses.forEach(function (e) {
      if ((e.type === 'Repairs & maintenance' || e.type === 'Furniture & equipment' || e.type === 'Others') && units.some(function (p) { return p.id === e.propertyId; })) {
        var who = D.staffById(e.paidBy);
        log.push({ date: e.date, ic: 'expenses', unit: D.propById[e.propertyId], what: (e.type === 'Others' && e.otherType ? e.otherType : e.type) + (e.note ? ' · ' + e.note : ''), who: who ? who.name : '', cost: e.amount, status: U.pill('Charged', 'neutral') });
      }
    });
    D.blocks.forEach(function (x) { if (x.type === 'maintenance' && units.some(function (p) { return p.id === x.propertyId; })) log.push({ date: x.start, ic: 'lock', unit: D.propById[x.propertyId], what: 'Unit closed ' + d.fmtRange(x.start, x.end) + ' · ' + x.note, who: 'Operations', cost: null, status: x.start > D.TODAY ? U.pill('Scheduled', 'neutral') : x.end > D.TODAY ? U.pill('In progress', 'info') : U.pill('Done', 'ok') }); });
    log.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var logTable = log.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Unit</th><th>Work</th><th>By</th>' + (isOwner ? '<th class="num">Cost to you</th>' : '') + '<th>Status</th></tr></thead><tbody>' + log.slice(0, 25).map(function (l) {
      return '<tr><td style="white-space:nowrap">' + esc(d.fmt(l.date)) + '</td><td style="white-space:nowrap">' + unitCell(l.unit) + '</td><td class="ml-work"><div class="row-flex" style="gap:8px;flex-wrap:nowrap"><span class="ml-ic">' + O.icon(l.ic) + '</span><span>' + esc(l.what) + '</span></div></td><td style="white-space:nowrap">' + esc(l.who) + '</td>' + (isOwner ? '<td class="num">' + (l.cost != null ? fmt.money(l.cost) : '<span class="faint">–</span>') + '</td>' : '') + '<td>' + l.status + '</td></tr>';
    }).join('') + '</tbody></table></div>' : U.empty('No maintenance recorded for these units.');

    var tabCard = '<div class="card"><div class="card-head"><div class="hd"><h3>' + (st.tab === 'upcoming' ? 'Upcoming stays' : 'Maintenance log') + '</h3><div class="sub">' + (st.tab === 'upcoming' ? 'Next 60 days · ' + fmt.plural(stays.length, 'booking') + ', guest contact details are never shared with owners' : 'Repairs, inspections and closures' + (isOwner ? ' with the cost charged to your statement' : '')) + '</div></div>' +
      '<div class="row-flex" style="gap:8px;flex-wrap:wrap">' + U.seg([['upcoming', 'Upcoming stays'], ['maint', 'Maintenance log']], st.tab, 'data-tab') + (st.tab === 'upcoming' ? '<button type="button" class="btn btn-ghost btn-sm" data-act="stay">' + O.icon('home') + 'Request owner stay</button>' : '') + '</div></div>' +
      '<div class="card-body flush">' + (st.tab === 'upcoming' ? upTable : logTable) + '</div></div>';
    if (isOwner) {
      html += '<div class="grid g-2-1 op-row"><div class="op-col">' + stmt + perf + '</div><div class="op-col">' + payCard + '</div></div>';
      html += '<div class="grid g-2-1 op-row"><div class="op-col">' + tabCard + '</div><div class="op-col">' + msgCard + '</div></div>';
    } else {
      html += '<div class="grid g-2-1 op-row"><div class="op-col">' + perf + tabCard + '</div><div class="op-col">' + msgCard + '</div></div>';
    }
    html += '<div class="note" style="margin-top:14px">Owners sign in at ' + esc(portalLink()) + ' with their email. They see only their own units, in ' + esc(ws.name) + '’s colours and logo. Prototype: owner sign-in is simulated.</div></div>';

    root.innerHTML = html;

    /* payout chart: revenue (grey) and payout (brand) by month */
    var chEl = O.$('.op-chart', root);
    if (chEl) {
      var all = ms_.map(function (m) { return statement(name, m); });
      O.chart.bars(chEl, {
        labels: ms_.map(function (m) { return d.monthName(m); }), height: 190, padLeft: 62, ariaLabel: 'Revenue and payout by month',
        yFormat: function (v, ax) { if (!ax || v < 10000) return fmt.money(v); var k = v / 1000; return 'RM ' + (k % 1 === 0 ? k : (k * 10) % 1 === 0 ? k.toFixed(1) : k.toFixed(2)) + 'k'; },
        tipTitle: function (i) { return monthLabel(ms_[i]) + (all[i].partial ? ' (to date)' : ''); },
        series: [{ name: 'Revenue', values: all.map(function (s) { return s.t.gross; }), tone: 'prev1' }, { name: 'Owner payout', values: all.map(function (s) { return Math.max(0, s.t.payout); }), tone: 'brand' }]
      });
      O.$('.legend-slot', root).innerHTML = O.chart.legend([{ name: 'Revenue', tone: 'prev1', square: true }, { name: 'Owner payout', tone: 'brand', square: true }]);
    }

    var acts = O.html('<div class="row-flex" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-ghost btn-sm" data-top="link">' + O.icon('copy') + 'Copy portal link</button>' + (isOwner ? '<button type="button" class="btn btn-primary btn-sm" data-top="pdf">' + O.icon('download') + 'Statement PDF</button>' : '') + '</div>');
    acts.addEventListener('click', function (e) {
      var b = e.target.closest('[data-top]'); if (!b) return;
      if (b.dataset.top === 'pdf') downloadPDF(name, st.month);
      else { try { navigator.clipboard.writeText(portalLink()).then(function () { U.toast('Portal link copied: ' + portalLink()); }, function () { U.toast('Portal link: ' + portalLink()); }); } catch (err) { U.toast('Portal link: ' + portalLink()); } }
    });
    ctx.setActions(acts);

    function approveModal(m) {
      var p = payoutState(name, m), s = statement(name, m), x = s.t;
      U.modal({
        title: 'Approve payout · ' + monthLabel(m), sub: name + ' · ' + fmt.plural(s.lines.length, 'unit') + ' · ' + U.rangeLabel(s.from, s.to),
        body: '<dl class="kv"><dt>Revenue from ' + fmt.plural(x.nights, 'night') + '</dt><dd>' + fmt.money(x.gross) + '</dd><dt>Platform fees</dt><dd>' + minus(x.fee) + '</dd><dt>Management fee (' + (MGMT * 100) + '%)</dt><dd>' + minus(x.mgmt) + '</dd><dt>Expenses charged</dt><dd>' + minus(x.exp) + '</dd>' +
          (x.carry ? '<dt>Carried from ' + esc(d.monthName(d.addMonths(m, -1), true)) + '</dt><dd>' + fmt.money(x.carry) + '</dd>' : '') + '<dt class="tot">Owner payout</dt><dd class="tot">' + fmt.money(x.payout) + '</dd></dl>' +
          '<div class="note' + (x.payout < 0 ? ' warn' : ' brand') + '" style="margin-top:12px">' + (x.payout > 0 ? esc(fmt.money(x.payout)) + ' goes to ' + esc(name) + '\u2019s bank account on file on ' + esc(d.fmt(payoutDate(m))) + '. They get the statement PDF by email when you approve.' : 'Nothing is paid this month. ' + (x.payout < 0 ? esc(fmt.money(-x.payout)) + ' is carried forward and deducted from the next payout. ' : '') + 'The statement is emailed to ' + esc(name) + ' when you approve.') + ' Prototype: no money moves.</div>',
        actions: [{ label: 'Cancel' }, {
          label: 'Approve payout', kind: 'primary', onClick: function () {
            D.ownerPayouts[p.key] = { approvedAt: D.NOW, by: O.viewer().id };
            U.toast(x.payout > 0 ? 'Payout approved. ' + name + ' is paid ' + fmt.money(x.payout) + ' on ' + d.fmt(payoutDate(m)) + '.' : 'Statement approved and emailed to ' + name + '.');
            O.emit('data', { type: 'owner-payout' });
          }
        }]
      });
    }
    O.$('#op-owner', root).onchange = function (e) { st.owner = e.target.value; render(root, ctx); };
    O.$('#op-month', root).onchange = function (e) { st.month = e.target.value; render(root, ctx); };
    root.onclick = function (e) {
      var t = e.target.closest('[data-approve]');
      if (t) {
        e.stopPropagation();
        approveModal(t.dataset.approve);
        return;
      }
      t = e.target.closest('[data-month]');
      if (t) { st.month = t.dataset.month; render(root, ctx); return; }
      t = e.target.closest('[data-tab]');
      if (t) { st.tab = t.dataset.tab; render(root, ctx); return; }
      t = e.target.closest('[data-act]');
      if (!t) return;
      var a = t.dataset.act;
      if (a === 'csv') downloadCSV(name, st.month);
      else if (a === 'pdf') downloadPDF(name, st.month);
      else if (a === 'msg') messageModal(name);
      else if (a === 'reply') replyModal(name);
      else if (a === 'stay') ownerStayModal(name);
    };
  }

  O.page('owner', {
    desc: 'What your property owners see: statements, payouts, stays and maintenance',
    render: render
  });
})();
