/* Bookings — every reservation grouped by property, with a date range, filters, CSV export
   and the "New booking" (direct booking) form. The form is shared: O.newBooking(opts) is also
   used by the Calendar page (click an empty day) and can be used by any other section. */
(function () {
  var O = window.O, D = O.data, M = O.metrics, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  var T = D.TODAY;
  var STATUS_ORDER = ['confirmed', 'checked_in', 'pending', 'checked_out', 'cancelled'];
  var MATCH = [['stay', 'Stay dates'], ['checkin', 'Check-in date'], ['booked', 'Booked date']];
  var CLEANING = { 0: 50, 1: 60, 2: 80, 3: 110, 4: 130 }; /* same cleaning fees as the rest of the data */

  var st = {
    range: U.preset('next30'), match: 'stay',
    status: [], plat: [], action: false, prop: '', q: '',
    collapsed: {}, sort: { key: 'checkIn', dir: 1 }, highlight: null
  };

  O.css('bookings', `
.pg-bookings .bk-tools{display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:12px;}
.pg-bookings .bk-tools .spacer{flex:1;}
.pg-bookings .bk-tools .select{width:auto; min-width:190px; height:36px;}
.pg-bookings .bk-tools .search{min-width:220px; flex:1 1 240px; max-width:420px;}
.pg-bookings .bk-tools .select{min-width:170px;}
.pg-bookings .bk-match{display:flex; align-items:center; gap:8px;}
.pg-bookings .bk-match .lbl{font-size:11.5px; font-weight:700; color:var(--muted); white-space:nowrap;}
.pg-bookings .bk-chips{display:flex; flex-direction:column; gap:8px; margin-bottom:14px;}
.pg-bookings .bk-chips .chips{gap:6px;}
.pg-bookings .bk-chips .chip-group-label{min-width:64px; flex-shrink:0;}
.pg-bookings .chip .sw{width:8px; height:8px; border-radius:2px; display:inline-block; flex-shrink:0;}
.pg-bookings .chip.on .plat-ic{box-shadow:0 0 0 1.5px var(--brand-ink);}
.pg-bookings .chip .plat-ic{width:16px; height:16px; font-size:9px;}
.pg-bookings .chip.warnchip:not(.on){border-color:var(--warn-soft); background:var(--warn-soft); color:var(--warn);}
.pg-bookings .bk-sum{display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:0 0 10px;}
.pg-bookings .bk-sum .txt{font-size:12.5px; color:var(--text-2); flex:1; min-width:220px;}
.pg-bookings .bk-sum .txt b{color:var(--text);}
.pg-bookings .bk-card{overflow:hidden;}
.pg-bookings .bk-table{min-width:1080px; table-layout:auto;}
.pg-bookings .bk-table th{padding:8px 8px;}
.pg-bookings .bk-table td{padding:8px 8px;}
.pg-bookings .bk-table th:first-child, .pg-bookings .bk-table td.c-guest{padding-left:14px;}
.pg-bookings .c-total, .pg-bookings .c-n, .pg-bookings .c-g{white-space:nowrap;}
.pg-bookings .th-sort{background:none; border:none; padding:0; font:inherit; color:inherit; font-weight:700; display:inline-flex; align-items:center; gap:4px; cursor:pointer;}
.pg-bookings .th-sort:hover{color:var(--text);}
.pg-bookings .th-sort.on{color:var(--brand-text);}
.pg-bookings .th-sort .arr{font-size:9px; opacity:0.9;}
.pg-bookings th.num .th-sort{flex-direction:row-reverse;}
.pg-bookings .grp-head td{background:var(--surface-2); padding:0; border-bottom:1px solid var(--border); border-top:1px solid var(--border);}
.pg-bookings tbody:first-of-type .grp-head td{border-top:none;}
.pg-bookings .gh{display:flex; align-items:center; gap:12px; padding:9px 10px 9px 6px; flex-wrap:wrap;}
.pg-bookings .gh-toggle{display:flex; align-items:center; gap:8px; background:none; border:none; padding:4px 6px; border-radius:8px; text-align:left; min-width:0; min-height:36px;}
.pg-bookings .gh-toggle:hover{background:var(--surface);}
.pg-bookings .gh-toggle svg{width:16px; height:16px; color:var(--muted); transition:transform .15s; flex-shrink:0;}
.pg-bookings .gh-toggle[aria-expanded="false"] svg{transform:rotate(-90deg);}
.pg-bookings .gh-name{font-weight:800; font-size:13.5px; font-family:var(--font-head);}
.pg-bookings .gh-area{font-size:11.5px; color:var(--muted); font-weight:500;}
.pg-bookings .gh-stats{display:flex; gap:16px; align-items:center; flex-wrap:wrap; margin-left:auto; font-size:12px; color:var(--muted);}
.pg-bookings .gh-stats b{color:var(--text); font-variant-numeric:tabular-nums;}
.pg-bookings .gh-occ{display:inline-flex; align-items:center; gap:7px;}
.pg-bookings .gh-occ .progress{width:64px;}
.pg-bookings .gh .btn-quiet{min-height:32px;}
.pg-bookings .bk-row td{background:var(--surface);}
.pg-bookings .bk-row.cx td{color:var(--muted);}
.pg-bookings .bk-row.cx .gn, .pg-bookings .bk-row.cx .c-total{text-decoration:line-through; text-decoration-color:var(--faint);}
.pg-bookings .bk-row.flash td{background:var(--brand-soft) !important; transition:background 1.2s;}
.pg-bookings .g{display:flex; align-items:center; gap:9px; min-width:0;}
.pg-bookings .gn{font-weight:700; font-size:13px; white-space:nowrap;}
.pg-bookings .gs{font-size:11.5px; color:var(--muted); white-space:nowrap;}
.pg-bookings .sd{font-size:10.5px; font-weight:800; color:var(--accent-text); background:var(--accent-soft); border-radius:20px; padding:0 6px; white-space:nowrap;}
.pg-bookings .stay b{white-space:nowrap;}
.pg-bookings .stay .xs{white-space:nowrap; color:var(--muted);}
.pg-bookings .stay .xs.soon{color:var(--brand-text); font-weight:700;}
.pg-bookings .c-status{white-space:nowrap;}
.pg-bookings .c-docs .ready{flex-direction:column; align-items:flex-start;}
.pg-bookings .c-ready .ready{flex-wrap:wrap; max-width:230px; min-width:150px;}
.pg-bookings .ph-only{display:none;}
.pg-bookings .ready-alt, .pg-bookings .lbl-narrow{display:none;}
.pg-bookings .grp-empty td{color:var(--muted); font-size:12.5px; padding:12px 16px;}
.pg-bookings .bk-note{margin-top:10px;}
@media (max-width:1140px) and (min-width:961px){
  .pg-bookings .kpis{grid-auto-flow:row; grid-template-columns:repeat(4,minmax(0,1fr));}
}
@media (max-width:1420px){
  .pg-bookings .bk-table .c-n, .pg-bookings .bk-table .c-g{display:none;}
  .pg-bookings .bk-table .stay .ph-only{display:block; white-space:nowrap; font-size:11.5px;}
  .pg-bookings .bk-table .stay .ph-only .sep{display:none;}
  .pg-bookings .bk-table{min-width:900px;}
  .pg-bookings .bk-table th, .pg-bookings .bk-table td{padding-left:6px; padding-right:6px;}
  .pg-bookings .bk-table .gn{white-space:normal; max-width:150px;}
  .pg-bookings .bk-table .stay .xs{white-space:normal; max-width:150px;}
  .pg-bookings .kpi{padding:10px 10px;}
  .pg-bookings .kpi .k-val{font-size:17px;}
}
@media (max-width:1240px) and (min-width:761px){
  .pg-bookings .bk-table{min-width:0;}
  .pg-bookings .bk-table .c-ready{display:none;}
  .pg-bookings .bk-table .ready-alt{display:block; margin-top:4px;}
  .pg-bookings .bk-table .ready-alt .ready{max-width:none; min-width:0;}
  .pg-bookings .bk-table .ready-alt .dash{font-size:11px;}
  .pg-bookings .bk-table .lbl-wide{display:none;} .pg-bookings .bk-table .lbl-narrow{display:inline;}
  .pg-bookings .bk-table .c-plat .plat{font-size:0; gap:0;}
  .pg-bookings .bk-table .gs{white-space:normal;}
  .pg-bookings .bk-table th.c-docs{white-space:normal;}
  .pg-bookings .gh-occ .progress{display:none;}
  .pg-bookings .bk-table .c-docs .ready{flex-direction:row; flex-wrap:wrap;}
}
@media (max-width:560px){
  .pg-bookings .kpis .kpi:nth-child(7){display:none;} /* lead time: keeps the phone strip to three rows */
}
@media (max-width:760px){
  .pg-bookings .bk-tools .select, .pg-bookings .bk-tools .search{flex:1 1 100%; min-width:0;}
  .pg-bookings .bk-match{flex:1 1 100%; flex-wrap:wrap;}
  .pg-bookings .bk-chips .chips{flex-wrap:nowrap; overflow-x:auto; scrollbar-width:none; padding-bottom:2px;}
  .pg-bookings .bk-chips .chip-group-label{min-width:0; position:sticky; left:0; background:var(--bg); padding-right:4px; z-index:1;}
  .pg-bookings .table-wrap{overflow:visible;}
  .pg-bookings .bk-table{min-width:0;}
  .pg-bookings .bk-table thead{display:none;}
  .pg-bookings .bk-table, .pg-bookings .bk-table tbody, .pg-bookings .bk-table tr, .pg-bookings .bk-table td{display:block;}
  .pg-bookings .bk-row{display:grid !important; grid-template-columns:minmax(0,1fr) auto; grid-template-areas:"guest total" "stay status" "plat plat" "docs docs" "ready ready"; gap:6px 10px; padding:12px 14px; border-bottom:1px solid var(--border);}
  .pg-bookings .bk-row td, .pg-bookings .bk-table td.c-guest{padding:0; border:none; background:none;}
  .pg-bookings .bk-row.flash{background:var(--brand-soft);}
  .pg-bookings .c-guest{grid-area:guest;} .pg-bookings .c-total{grid-area:total; font-weight:800;} .pg-bookings .c-stay{grid-area:stay;}
  .pg-bookings .c-status{grid-area:status; text-align:right;} .pg-bookings .c-plat{grid-area:plat;}
  .pg-bookings .c-docs{grid-area:docs;} .pg-bookings .c-ready{grid-area:ready;}
  .pg-bookings .c-ready:empty, .pg-bookings .c-ready .dash{display:none;}
  .pg-bookings .c-n, .pg-bookings .c-g{display:none !important;}
  .pg-bookings .ph-only{display:inline;}
  .pg-bookings .gh{padding:8px 8px 8px 4px; gap:6px;}
  .pg-bookings .gh-stats{margin-left:36px; gap:10px; width:100%;}
  .pg-bookings .gh{position:relative;}
  .pg-bookings .gh-toggle{max-width:calc(100% - 96px);}
  .pg-bookings .gh .btn-quiet{position:absolute; top:10px; right:8px; min-height:36px;}
  .pg-bookings .grp-head td, .pg-bookings .grp-empty td{display:block;}
  .pg-bookings .gn, .pg-bookings .gs{white-space:normal;}
  .pg-bookings .c-docs .ready, .pg-bookings .c-ready .ready{max-width:none;}
  .pg-bookings .c-docs .ready{flex-direction:row; flex-wrap:wrap;}
}
.nb-wrap{display:grid; grid-template-columns:minmax(0,1fr) 250px; gap:16px; align-items:start;}
.nb-side{position:sticky; top:0; display:flex; flex-direction:column; gap:10px;}
.nb-sum{border:1px solid var(--border); border-radius:10px; padding:12px; background:var(--surface-2);}
.nb-sum h4{font-size:13px; margin-bottom:2px;}
.nb-sum .kv{font-size:12.5px; margin-top:10px;}
.nb-sum .muted.small{margin-top:1px;}
.nb-avail{font-size:12px; font-weight:600; border-radius:8px; padding:7px 9px; line-height:1.4;}
.nb-avail.ok{background:var(--ok-soft); color:var(--ok);}
.nb-avail.bad{background:var(--bad-soft); color:var(--bad);}
.nb-docs{font-size:11.5px; color:var(--text-2); line-height:1.5;}
.nb-docs b{color:var(--text);}
.nb-sugg{display:flex; gap:6px; align-items:center; flex-wrap:wrap;}
.nb-sugg .btn{padding:2px 8px;}
.nb-err{color:var(--bad); font-size:12.5px; font-weight:600; line-height:1.5;}
.nb-err:not(:empty){background:var(--bad-soft); border-radius:8px; padding:8px 10px;}
.nb-sec{font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin:4px 0 -2px;}
.nb-pay{display:flex; gap:10px; flex-wrap:wrap; align-items:center;}
.nb-pay .select{width:auto; min-width:180px;}
.nb-proto{font-size:11px; color:var(--muted);}
@media (max-width:760px){ .nb-wrap{grid-template-columns:minmax(0,1fr);} .nb-side{display:contents;} .nb-avail{order:-1;} }
`);

  /* ---------------- helpers ---------------- */
  function live(b) { return b.status !== 'cancelled'; }
  function sum(list, f) { return list.reduce(function (s, x) { return s + f(x); }, 0); }
  function created(b) { return b.createdAt.slice(0, 10); }
  /* needs action = still pending, invoice not sent yet, or ID not verified for an arrival in the next 3 days */
  var ACTION_DAYS = 3;
  function needsAction(b) { return live(b) && b.checkIn >= T && (b.status === 'pending' || !b.invoiceSent || (!b.idVerified && b.checkIn <= d.add(T, ACTION_DAYS))); }
  var ACTION_TITLE = 'Upcoming bookings that are still pending, have an invoice that was not sent, or arrive in the next ' + ACTION_DAYS + ' days without a verified ID';
  function inRange(b, r) {
    r = r || st.range;
    if (st.match === 'checkin') return b.checkIn >= r.from && b.checkIn <= r.to;
    if (st.match === 'booked') { var c = created(b); return c >= r.from && c <= r.to; }
    return b.checkIn <= r.to && b.checkOut >= r.from; /* any night in the range, plus departures inside it */
  }
  function matchQ(b) {
    if (!st.q) return true;
    var q = st.q.trim().toLowerCase(); if (!q) return true;
    if (b.guest.name.toLowerCase().indexOf(q) >= 0 || b.id.toLowerCase().indexOf(q) >= 0 || (b.invoiceNo || '').toLowerCase().indexOf(q) >= 0) return true;
    var digits = q.replace(/\D/g, '');
    return digits.length >= 4 && b.guest.phone.replace(/\D/g, '').indexOf(digits) >= 0;
  }
  function passStatus(b) { return !st.status.length || st.status.indexOf(b.status) >= 0; }
  function passPlat(b) { return !st.plat.length || st.plat.indexOf(b.channel) >= 0; }
  function passAction(b) { return !st.action || needsAction(b); }
  function baseList() { return D.bookings.filter(function (b) { return (!st.prop || b.propertyId === st.prop) && inRange(b) && matchQ(b); }); }
  /* nights and revenue: inside the range when matching on stay dates, the whole stay otherwise */
  function nightsOf(b) { return st.match === 'stay' ? M.nightsIn(b, st.range.from, st.range.to) : b.nights; }
  function revOf(b) { var n = nightsOf(b); return n ? b.revenue / b.nights * n : 0; }
  function filtersActive() { return st.status.length || st.plat.length || st.action || st.q; }
  function rateOf(pid, iso) { var o = D.priceOverrides && D.priceOverrides[pid]; return (o && o[iso]) || D.rateFor(pid, iso); }
  function tShort(t) { var s = fmt.time(t); return s.replace(':00 ', ' '); } /* '15:00' -> '3 PM', '10:30' -> '10:30 AM' */
  function rangeText() { return U.rangeLabel(st.range.from, st.range.to); }

  var SORTS = {
    guest: function (a, b) { return a.guest.name.localeCompare(b.guest.name); },
    checkIn: function (a, b) { return a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : a.id < b.id ? -1 : 1; },
    nights: function (a, b) { return a.nights - b.nights; },
    guests: function (a, b) { return a.guests - b.guests; },
    channel: function (a, b) { return U.platName(a.channel).localeCompare(U.platName(b.channel)); },
    status: function (a, b) { return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status); },
    total: function (a, b) { return a.total - b.total; }
  };
  function sorted(list) {
    var f = SORTS[st.sort.key] || SORTS.checkIn, dir = st.sort.dir;
    return list.slice().sort(function (a, b) { var r = f(a, b); if (!r) r = SORTS.checkIn(a, b); return r * dir; });
  }

  /* ---------------- cells ---------------- */
  function stayCell(b) {
    var sub, soon = false;
    if (b.status === 'cancelled') sub = 'Booked ' + d.fmt(created(b));
    else if (b.checkIn === T) { sub = 'Arrives today, ' + tShort(b.checkInTime); soon = true; }
    else if (b.checkIn === d.add(T, 1)) { sub = 'Arrives tomorrow, ' + tShort(b.checkInTime); soon = true; }
    else if (b.checkOut === T) { sub = 'Leaves today, ' + tShort(b.checkOutTime); soon = true; }
    else sub = 'Booked ' + d.fmt(created(b));
    return '<div class="stay"><b>' + d.fmtRange(b.checkIn, b.checkOut) + '</b><span class="ph-only muted small"><span class="sep"> · </span>' + fmt.plural(b.nights, 'night') + ' · ' + fmt.plural(b.guests, 'guest') + '</span><div class="xs' + (soon ? ' soon' : '') + '">' + esc(sub) + '</div></div>';
  }
  function rd(state, label, title) { return '<span class="rd ' + state + '" title="' + esc(title || label) + '">' + esc(label) + '</span>'; }
  function docsCell(b) {
    if (b.status === 'cancelled') return '<span class="xs muted">No invoice (cancelled)</span>';
    var inv = b.invoiceSent ? rd('ok', 'Invoice sent', 'Invoice ' + b.invoiceNo + ' sent by ' + b.invoiceSent.via + (b.invoiceSent.at ? ' on ' + d.fmt(b.invoiceSent.at) : ''))
      : rd('wait', 'Invoice not sent', 'Invoice ' + b.invoiceNo + ' was created automatically and is ready to send');
    var rc = !b.paidAt ? rd('todo', 'Awaiting payment', 'The receipt is created automatically when payment arrives')
      : b.receiptSent ? rd('ok', 'Receipt sent', 'Receipt ' + b.receiptNo + ' sent by ' + b.receiptSent.via)
        : rd('wait', 'Receipt not sent', 'Receipt ' + b.receiptNo + ' is ready to send');
    return '<div class="ready">' + inv + rc + '</div>';
  }
  var SHORT = { 'Clean not started': 'Not cleaned', 'Code held until ID': 'Code held', 'House rules accepted': 'Rules accepted' };
  function readyCell(b) {
    if (b.status === 'cancelled') return '<span class="xs muted dash">' + (b.cancelledAt ? 'Cancelled ' + d.fmt(b.cancelledAt) : 'Cancelled') + '</span>';
    if (b.status === 'checked_out') return '<span class="xs muted dash">Stay completed</span>';
    if (b.status === 'checked_in') return '<span class="xs muted dash">In-house until ' + d.fmt(b.checkOut) + '</span>';
    var chips = O.readiness(b).filter(function (r) { return r.label !== 'No turnover needed'; });
    return '<div class="ready">' + chips.map(function (r) { return rd(r.state, SHORT[r.label] || r.label, r.label); }).join('') + '</div>';
  }
  function rowHTML(b) {
    var cx = b.status === 'cancelled';
    return '<tr class="click bk-row' + (cx ? ' cx' : '') + '" data-id="' + b.id + '" tabindex="0" aria-label="' + esc(b.guest.name + ', ' + d.fmtRange(b.checkIn, b.checkOut)) + '">' +
      '<td class="c-guest"><div class="g">' + U.avatar(b.guest.name, 'sm') + '<div style="min-width:0"><div class="gn">' + esc(b.guest.name) + '</div><div class="gs">' + esc(b.id) + ' · ' + (b.sameDay ? '<span class="sd" title="Booked today (' + fmt.time(b.createdAt) + ') for arrival today">⚡ Same-day</span>' : esc(b.guest.countryName)) + '</div></div></div></td>' +
      '<td class="c-stay">' + stayCell(b) + '</td>' +
      '<td class="num c-n">' + b.nights + '</td>' +
      '<td class="num c-g">' + b.guests + '</td>' +
      '<td class="c-plat">' + U.plat(b.channel) + '</td>' +
      '<td class="c-status">' + U.status(b.status) + '</td>' +
      '<td class="num c-total">' + fmt.money(b.total) + '</td>' +
      '<td class="c-docs">' + docsCell(b) + '<div class="ready-alt">' + readyCell(b) + '</div></td>' +
      '<td class="c-ready">' + readyCell(b) + '</td></tr>';
  }

  /* ---------------- page ---------------- */
  O.page('bookings', {
    desc: 'Every reservation, grouped by property',
    render: function (root, ctx) {
      var owner = O.isOwner();
      if (ctx.fresh && ctx.params) {
        var p = ctx.params;
        if (p.propertyId) st.prop = p.propertyId;
        if (p.status) st.status = [].concat(p.status);
        if (p.q) st.q = p.q;
        if (p.from && p.to) { st.range = { from: p.from, to: p.to, preset: null }; st.match = 'stay'; }
        if (p.propertyId || p.from) st.collapsed = {};
      }
      ctx.setActions('<button type="button" class="btn btn-ghost" data-act="csv">' + O.icon('download') + 'Export CSV</button><button type="button" class="btn btn-primary" data-act="new">' + O.icon('plus') + 'New booking</button>');
      O.$('[data-act=csv]', ctx.actionsEl).onclick = exportCSV;
      O.$('[data-act=new]', ctx.actionsEl).onclick = function () { openNew({ propertyId: st.prop || undefined }); };

      root.innerHTML = '<div class="pg-bookings">' +
        '<div class="bk-tools"><span data-slot="range"></span>' +
        '<div class="bk-match"><span class="lbl">Match on</span>' + U.seg(MATCH, st.match, 'data-match') + '</div>' +
        '<select class="select" data-f="prop" aria-label="Property">' + U.propOptions(st.prop, { all: 'All properties' }) + '</select>' +
        '<label class="search">' + O.icon('search') + '<input type="search" data-f="q" placeholder="Guest name, booking ID or phone" aria-label="Search bookings" value="' + esc(st.q) + '"></label>' +
        '</div><div class="bk-dyn"></div></div>';
      var wrap = O.$('.pg-bookings', root), dyn = O.$('.bk-dyn', wrap);

      U.mount(wrap, 'range', U.dateRange({
        from: st.range.from, to: st.range.to, preset: st.range.preset, presets: 'both',
        onChange: function (r) { st.range = { from: r.from, to: r.to, preset: r.preset }; paint(); }
      }));

      function chip(attr, val, on, inner, count, extra, title) {
        return '<button type="button" class="chip' + (on ? ' on' : '') + (extra || '') + '" ' + attr + '="' + val + '" aria-pressed="' + (on ? 'true' : 'false') + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + inner + ' <span class="n">' + count + '</span></button>';
      }

      function paint() {
        var base = baseList();
        var forStatus = base.filter(function (b) { return passPlat(b) && passAction(b); });
        var forPlat = base.filter(function (b) { return passStatus(b) && passAction(b); });
        var forAction = base.filter(function (b) { return passStatus(b) && passPlat(b); });
        var rows = base.filter(function (b) { return passStatus(b) && passPlat(b) && passAction(b); });
        var L = rows.filter(live);

        /* chips (counts reflect the other active filters) */
        var stChips = chip('data-st', 'all', !st.status.length, 'All', forStatus.length) + STATUS_ORDER.map(function (s) {
          var n = forStatus.filter(function (b) { return b.status === s; }).length;
          return chip('data-st', s, st.status.indexOf(s) >= 0, '<i class="sw" style="background:var(--st-' + ({ confirmed: 'confirmed', checked_in: 'inhouse', pending: 'pending', checked_out: 'past', cancelled: 'cancelled' })[s] + ')"></i>' + esc(U.statusLabel(s)), n);
        }).join('') + chip('data-action', '1', st.action, O.icon('alert').replace('<svg ', '<svg style="width:13px;height:13px" ') + 'Needs action', forAction.filter(needsAction).length, ' warnchip', ACTION_TITLE);
        var plChips = chip('data-pl', 'all', !st.plat.length, 'All', forPlat.length) + D.channelOrder.map(function (c) {
          return chip('data-pl', c, st.plat.indexOf(c) >= 0, U.platIcon(c) + esc(U.platName(c)), forPlat.filter(function (b) { return b.channel === c; }).length);
        }).join('');

        /* KPI strip for the filtered list */
        var nights = sum(L, nightsOf), rev = sum(L, revOf);
        var occ = M.occupancy(st.range.from, st.range.to, st.prop || undefined);
        var avgStay = L.length ? sum(L, function (b) { return b.nights; }) / L.length : 0;
        var lead = L.length ? sum(L, function (b) { return Math.max(0, d.diff(created(b), b.checkIn)); }) / L.length : 0;
        var cancelled = rows.length - L.length;
        var nightsLbl = st.match === 'stay' ? 'Nights in range' : 'Nights booked';
        var k = [
          { label: 'Bookings', value: fmt.num(L.length), sub: cancelled ? '+' + cancelled + ' cancelled' : 'none cancelled', title: cancelled ? cancelled + ' cancelled booking' + (cancelled > 1 ? 's are' : ' is') + ' not counted' : '' },
          { label: nightsLbl, value: fmt.num(nights), sub: st.match === 'stay' ? 'inside the range' : 'whole stays' }
        ];
        if (owner) {
          k.push({ label: st.match === 'stay' ? 'Revenue' : 'Booking value', value: fmt.money(rev), sub: 'stay + cleaning', hl: true, title: 'Accommodation and cleaning fees' + (st.match === 'stay' ? ' earned on nights inside the range' : '') + '. Tourism tax is passed through and not counted.' });
          k.push({ label: 'ADR', value: nights ? fmt.money(rev / nights) : '–', sub: 'per night sold' });
        } else {
          k.push({ label: 'Guests', value: fmt.num(sum(L, function (b) { return b.guests; })), sub: 'in these bookings' });
          k.push({ label: 'Arrivals', value: fmt.num(L.filter(function (b) { return b.checkIn >= st.range.from && b.checkIn <= st.range.to; }).length), sub: 'check-ins in range' });
        }
        k.push({ label: 'Occupancy', value: fmt.pct(occ), sub: (st.prop ? D.propById[st.prop].short : 'all ' + D.properties.length + ' units') + (st.match === 'stay' ? '' : ', nights in range'), title: 'Nights sold ÷ available nights in ' + rangeText() + ', all channels, blocked nights excluded. It does not change with the status, platform or search filters.' });
        k.push({ label: 'Avg stay', value: avgStay ? avgStay.toFixed(1) : '–', sub: 'nights per booking' });
        k.push({ label: 'Lead time', value: L.length ? Math.round(lead) + ' days' : '–', sub: 'booked → check-in' });

        /* groups */
        var props = D.properties.filter(function (p) { return !st.prop || p.id === st.prop; });
        var showEmpty = !filtersActive();
        var groups = props.map(function (p) { return { p: p, list: sorted(rows.filter(function (b) { return b.propertyId === p.id; })) }; })
          .filter(function (g) { return g.list.length || showEmpty; });

        var head = [['guest', 'Guest'], ['checkIn', 'Stay'], ['nights', 'Nights', 1, 'c-n'], ['guests', 'Guests', 1, 'c-g'], ['channel', 'Platform', 0, 'c-plat'], ['status', 'Status'], ['total', 'Total', 1], [null, '<span class="lbl-wide">Invoice / receipt</span><span class="lbl-narrow">Invoice and readiness</span>', 0, 'c-docs'], [null, 'Arrival readiness', 0, 'c-ready']];
        var thead = '<thead><tr>' + head.map(function (h) {
          if (!h[0]) return '<th class="' + (h[3] || '') + '">' + h[1] + '</th>';
          var on = st.sort.key === h[0];
          return '<th class="' + (h[2] ? 'num ' : '') + (h[3] || '') + '" aria-sort="' + (on ? (st.sort.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="th-sort' + (on ? ' on' : '') + '" data-sort="' + h[0] + '">' + h[1] + '<span class="arr">' + (on ? (st.sort.dir > 0 ? '▲' : '▼') : '') + '</span></button></th>';
        }).join('') + '</tr></thead>';

        var body = groups.map(function (g) {
          var p = g.p, list = g.list, gl = list.filter(live);
          var open = !st.collapsed[p.id];
          var gN = sum(gl, nightsOf), gR = sum(gl, revOf), gOcc = M.occupancy(st.range.from, st.range.to, p.id);
          var cx = list.length - gl.length;
          var stats = '<span><b>' + gl.length + '</b> ' + (gl.length === 1 ? 'booking' : 'bookings') + (cx ? ' <span class="faint">+' + cx + ' cancelled</span>' : '') + '</span>' +
            '<span><b>' + gN + '</b> ' + (gN === 1 ? 'night' : 'nights') + '</span>' +
            (owner ? '<span title="Revenue ' + (st.match === 'stay' ? 'earned on nights inside the range' : 'of these bookings') + '"><b>' + fmt.money(gR) + '</b></span>' : '') +
            '<span class="gh-occ" title="Occupancy of ' + esc(p.short) + ' for ' + esc(rangeText()) + ', all channels, blocked nights excluded"><span class="progress"><i style="width:' + Math.round(gOcc * 100) + '%"></i></span><b>' + fmt.pct(gOcc) + '</b> occupied</span>';
          var h = '<tbody class="bk-grp" data-pid="' + p.id + '"><tr class="grp-head"><td colspan="9"><div class="gh">' +
            '<button type="button" class="gh-toggle" data-toggle="' + p.id + '" aria-expanded="' + open + '">' + O.icon('chevron') + '<span class="prop-dot" style="background:' + U.propColor(p.id) + '"></span><span><span class="gh-name">' + esc(p.name) + '</span><br><span class="gh-area">' + esc(p.type) + ' · ' + esc(p.area) + '</span></span></button>' +
            '<div class="gh-stats">' + stats + '</div>' +
            '<button type="button" class="btn btn-quiet btn-xs" data-new="' + p.id + '">' + O.icon('plus') + 'Booking</button></div></td></tr>';
          if (open) {
            if (!list.length) h += '<tr class="grp-empty"><td colspan="9">' + (st.match === 'booked' ? 'No bookings were made for this property between ' : st.match === 'checkin' ? 'No check-ins between ' : 'No stays between ') + esc(rangeText()) + '.</td></tr>';
            else h += list.map(rowHTML).join('');
          }
          return h + '</tbody>';
        }).join('');

        var matchTxt = st.match === 'stay' ? 'staying between' : st.match === 'checkin' ? 'checking in between' : 'booked between';
        var anyOpen = groups.some(function (g) { return !st.collapsed[g.p.id]; }), anyClosed = groups.some(function (g) { return st.collapsed[g.p.id]; });
        var empty = !rows.length;
        var emptyMsg = st.match === 'booked' && st.range.from > T ? 'No bookings can be made in the future. Choose a past range such as Last 30 days.'
          : 'No bookings match these filters for ' + rangeText() + '.';

        dyn.innerHTML =
          '<div class="bk-chips"><div class="chips"><span class="chip-group-label">Status</span>' + stChips + '</div>' +
          '<div class="chips"><span class="chip-group-label">Platform</span>' + plChips + '</div></div>' +
          U.kpis(k) +
          '<div class="bk-sum"><div class="txt"><b>' + fmt.plural(L.length, 'booking') + '</b> ' + matchTxt + ' <b>' + esc(rangeText()) + '</b>' +
          (groups.length ? ' in ' + fmt.plural(groups.filter(function (g) { return g.list.length; }).length, 'property', 'properties') : '') +
          (cancelled ? ', plus ' + cancelled + ' cancelled' : '') +
          (st.match === 'stay' ? '<span class="muted"> · nights and revenue count only the nights inside the range</span>' : '') + '</div>' +
          (filtersActive() ? '<button type="button" class="btn btn-ghost btn-sm" data-act="clear">' + O.icon('x') + 'Clear filters</button>' : '') +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="expand"' + (anyClosed ? '' : ' disabled') + '>Expand all</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="collapse"' + (anyOpen ? '' : ' disabled') + '>Collapse all</button></div>' +
          '<div class="card bk-card">' + (empty && !groups.length ? '<div class="empty"><div class="e-icon">' + O.icon('bookings').replace('<svg ', '<svg style="width:24px;height:24px" ') + '</div>' + esc(emptyMsg) + (filtersActive() ? '<div style="margin-top:10px"><button type="button" class="btn btn-ghost btn-sm" data-act="clear">Clear filters</button></div>' : '') + '</div>'
            : '<div class="table-wrap"><table class="table bk-table">' + thead + body + '</table></div>') + '</div>' +
          (owner ? '' : '<div class="note bk-note">Revenue totals are visible to account owners only. You can still see each booking\'s total and its invoice.</div>');

        if (st.highlight) {
          var tr = O.$('.bk-row[data-id="' + st.highlight + '"]', dyn);
          if (tr) {
            tr.classList.add('flash');
            setTimeout(function () { try { tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }, 60);
            setTimeout(function () { tr.classList.remove('flash'); }, 2600);
          }
          st.highlight = null;
        }
      }

      /* one delegated listener on this page's own wrapper */
      wrap.addEventListener('click', function (e) {
        var t = e.target.closest('button, tr.bk-row'); if (!t || !wrap.contains(t)) return;
        if (t.dataset.match) {
          var prev = st.match; st.match = t.dataset.match;
          if (st.match === 'booked' && st.range.to > T) st.range = U.preset('last30');
          else if (prev === 'booked' && st.match !== 'booked' && st.range.to <= T) st.range = U.preset('next30');
          ctx.rerender(); return;
        }
        if (t.dataset.st) {
          var s = t.dataset.st;
          if (s === 'all') st.status = [];
          else { var i = st.status.indexOf(s); if (i >= 0) st.status.splice(i, 1); else st.status.push(s); }
          paint(); return;
        }
        if (t.dataset.pl) {
          var c = t.dataset.pl;
          if (c === 'all') st.plat = [];
          else { var j = st.plat.indexOf(c); if (j >= 0) st.plat.splice(j, 1); else st.plat.push(c); }
          paint(); return;
        }
        if (t.dataset.action) { st.action = !st.action; paint(); return; }
        if (t.dataset.sort) {
          var key = t.dataset.sort;
          if (st.sort.key === key) st.sort.dir = -st.sort.dir; else st.sort = { key: key, dir: key === 'total' || key === 'nights' || key === 'guests' ? -1 : 1 };
          paint(); return;
        }
        if (t.dataset.toggle) { st.collapsed[t.dataset.toggle] = !st.collapsed[t.dataset.toggle]; paint(); return; }
        if (t.dataset.new) { openNew({ propertyId: t.dataset.new }); return; }
        var a = t.dataset.act;
        if (a === 'expand') { st.collapsed = {}; paint(); return; }
        if (a === 'collapse') { D.properties.forEach(function (p) { st.collapsed[p.id] = true; }); paint(); return; }
        if (a === 'clear') { st.status = []; st.plat = []; st.action = false; st.q = ''; var qi = O.$('[data-f=q]', wrap); if (qi) qi.value = ''; paint(); return; }
        if (t.classList.contains('bk-row')) O.booking.open(t.dataset.id);
      });
      wrap.addEventListener('keydown', function (e) {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('bk-row')) { e.preventDefault(); O.booking.open(e.target.dataset.id); }
      });
      O.$('[data-f=prop]', wrap).onchange = function (e) { st.prop = e.target.value; paint(); };
      O.$('[data-f=q]', wrap).oninput = function (e) { st.q = e.target.value; paint(); };

      paint();
      if (ctx.fresh && ctx.params && ctx.params.new) openNew({ propertyId: ctx.params.propertyId, checkIn: ctx.params.checkIn });
    }
  });

  /* make sure a booking just created is visible in the list */
  function reveal(b) {
    st.highlight = b.id; st.status = []; st.plat = []; st.action = false; st.q = '';
    if (st.prop && st.prop !== b.propertyId) st.prop = '';
    st.collapsed[b.propertyId] = false;
    if (!inRange(b)) {
      var key = st.match === 'booked' ? T : b.checkIn;
      st.range = { from: key < st.range.from ? key : st.range.from, to: key > st.range.to ? key : st.range.to, preset: null };
    }
  }
  function openNew(o) { o = o || {}; o.onCreated = reveal; O.newBooking(o); }

  /* ---------------- CSV export ---------------- */
  function exportCSV() {
    var owner = O.isOwner();
    var rows = sorted(baseList().filter(function (b) { return passStatus(b) && passPlat(b) && passAction(b); }));
    if (!rows.length) { U.toast('There are no bookings to export with these filters', 'bad'); return; }
    rows.sort(function (a, b) { return D.properties.indexOf(D.propById[a.propertyId]) - D.properties.indexOf(D.propById[b.propertyId]); });
    var head = ['Booking ID', 'Property', 'Guest', 'Country', 'Phone', 'Email', 'Check-in', 'Check-out', 'Nights', 'Guests', 'Platform', 'Status', 'Booked at', 'Total (RM)', 'Tourism tax (RM)'];
    if (owner) head = head.concat(['Revenue (RM)', 'Platform fee (RM)', 'Payout (RM)']);
    head = head.concat(['Invoice no.', 'Invoice sent', 'Receipt no.', 'Paid on', 'Receipt sent', 'ID verified', 'Door code status']);
    var out = [head].concat(rows.map(function (b) {
      var r = [b.id, D.propById[b.propertyId].name, b.guest.name, b.guest.countryName, b.guest.phone, b.guest.email, b.checkIn, b.checkOut, b.nights, b.guests, U.platName(b.channel), U.statusLabel(b.status), b.createdAt.replace('T', ' '), b.total, b.tourismTax];
      if (owner) r = r.concat([b.revenue, b.platformFee, b.payout]);
      return r.concat([b.invoiceNo || '', b.invoiceSent ? b.invoiceSent.via + ' ' + (b.invoiceSent.at || '') : 'No', b.receiptNo || '', b.paidAt || '', b.receiptSent ? b.receiptSent.via + ' ' + (b.receiptSent.at || '') : 'No', b.idVerified ? 'Yes' : 'No', b.codeStatus || '']);
    }));
    O.downloadCSV('bookings-' + st.match + '-' + st.range.from + '-to-' + st.range.to + '.csv', out);
  }

  /* ===================================================================
     New booking (direct) — shared form: O.newBooking({propertyId, checkIn, checkOut, onCreated(b)})
     =================================================================== */
  function conflictsFor(pid, ci, co) {
    var out = [];
    D.bookings.forEach(function (b) {
      if (b.propertyId === pid && live(b) && b.checkIn < co && ci < b.checkOut) out.push(b.guest.name + ' is booked ' + d.fmtRange(b.checkIn, b.checkOut) + ' (' + U.platName(b.channel) + ')');
    });
    D.blocks.forEach(function (x) {
      if (x.propertyId === pid && x.start < co && ci < x.end) out.push('Blocked ' + d.fmtRange(x.start, x.end) + ' for ' + (x.type === 'owner' ? 'an owner stay' : 'maintenance') + (x.note ? ' (' + x.note + ')' : ''));
    });
    return out;
  }
  function nextNo(field, prefix) {
    var max = D.bookings.reduce(function (m, b) { var v = b[field]; return v ? Math.max(m, +String(v).split('-').pop() || 0) : m; }, 1000);
    return prefix + (max + 1);
  }
  O.newBooking = function (o) {
    o = o || {};
    var pid0 = o.propertyId && D.propById[o.propertyId] ? o.propertyId : null;
    var ci0 = o.checkIn && o.checkIn >= T ? o.checkIn : null;
    var co0 = ci0 && o.checkOut && o.checkOut > ci0 ? o.checkOut : null;
    /* no dates given: start on the first free 2-night window (of the chosen property, or of any property) */
    if (!ci0) {
      var cands = pid0 ? [pid0] : D.properties.map(function (p) { return p.id; }), found = null;
      for (var off = 0; off < 120 && !found; off++) {
        var c = d.add(T, off);
        for (var k = 0; k < cands.length && !found; k++) if (!conflictsFor(cands[k], c, d.add(c, 2)).length) found = [cands[k], c];
      }
      if (found) { pid0 = found[0]; ci0 = found[1]; } else ci0 = T;
    }
    pid0 = pid0 || D.properties[0].id;
    co0 = co0 || d.add(ci0, 2);
    var countries = Object.keys(D.countryName).sort(function (a, b) { return a === 'MY' ? -1 : b === 'MY' ? 1 : D.countryName[a].localeCompare(D.countryName[b]); });
    var methods = ['FPX online banking', 'Card (Visa)', 'DuitNow QR', 'Bank transfer', 'Cash'];
    function f(label, input, cls, hint) { return '<div class="field ' + (cls || '') + '"><label>' + label + '</label>' + input + (hint || '') + '</div>'; }
    var body = O.html('<div class="nb-wrap"><div class="stack">' +
      '<div class="nb-sec">Stay</div>' +
      '<div class="form-grid">' +
      f('Property', '<select class="select" name="pid">' + U.propOptions(pid0) + '</select>', 'full') +
      f('Check-in', '<input type="date" class="input" name="ci" min="' + T + '" value="' + ci0 + '">') +
      f('Check-out', '<input type="date" class="input" name="co" min="' + d.add(T, 1) + '" value="' + co0 + '">') +
      f('Guests', '<input type="number" class="input" name="guests" min="1" value="2">', '', '<div class="hint nb-maxg"></div>') +
      f('Arrival time', '<input type="time" class="input" name="time" value="15:00">', '', '<div class="hint">Standard check-in is 3:00 PM</div>') +
      f('Nightly price (RM)', '<input type="number" class="input" name="price" min="1" step="5">', 'full', '<div class="hint nb-sugg"></div>') +
      '</div>' +
      '<div class="nb-sec">Guest</div>' +
      '<div class="form-grid">' +
      f('Guest name', '<input class="input" name="name" autocomplete="off" placeholder="Full name as on ID">') +
      f('Country', '<select class="select" name="country">' + countries.map(function (c) { return '<option value="' + c + '">' + esc(D.countryName[c]) + '</option>'; }).join('') + '</select>', '', '<div class="hint nb-tax"></div>') +
      f('Phone (WhatsApp)', '<input class="input" name="phone" inputmode="tel" autocomplete="off" placeholder="+60 12-345 6789">') +
      f('Email', '<input class="input" name="email" type="email" autocomplete="off" placeholder="name@example.com">') +
      f('Note', '<textarea class="textarea" name="notes" rows="2" placeholder="Optional: arrival details or requests"></textarea>', 'full') +
      '</div>' +
      '<div class="nb-sec">Payment</div>' +
      '<div class="nb-pay">' + U.seg([['no', 'Not paid yet'], ['yes', 'Paid now']], 'no', 'data-paid') + '<select class="select" name="method" aria-label="Payment method" hidden>' + methods.map(function (m) { return '<option>' + m + '</option>'; }).join('') + '</select></div>' +
      '<label class="check"><input type="checkbox" name="send"><span>Open the send window for the invoice after saving</span></label>' +
      '<div class="nb-err" role="alert"></div>' +
      '</div><div class="nb-side"><div class="nb-avail"></div><div class="nb-sum"></div><div class="nb-proto">Prototype: the booking is kept until you reload the page. Direct bookings carry a 3% payment fee.</div></div></div>');
    var $ = function (s) { return O.$(s, body); };
    var priceDirty = false, paid = false;

    function vals() {
      return { pid: $('[name=pid]').value, ci: $('[name=ci]').value, co: $('[name=co]').value, guests: +$('[name=guests]').value || 0, time: $('[name=time]').value || '15:00', price: +$('[name=price]').value || 0, name: $('[name=name]').value.trim(), country: $('[name=country]').value, phone: $('[name=phone]').value.trim(), email: $('[name=email]').value.trim(), notes: $('[name=notes]').value.trim() };
    }
    function suggestion(pid, ci, co) {
      if (!ci || !co || co <= ci) return null;
      var nights = d.range(ci, d.add(co, -1)).slice(0, 60), wk = [], we = [];
      nights.forEach(function (x) { (d.isWeekend(x) ? we : wk).push(rateOf(pid, x)); });
      var all = wk.concat(we), avg = Math.round(sum(all, function (v) { return v; }) / all.length / 5) * 5;
      return { avg: avg, wk: wk.length ? Math.round(sum(wk, function (v) { return v; }) / wk.length) : null, we: we.length ? Math.round(sum(we, function (v) { return v; }) / we.length) : null };
    }
    function update() {
      var v = vals(), p = D.propById[v.pid], maxG = Math.max(2, 2 + p.beds * 2);
      $('.nb-maxg').textContent = 'Up to ' + maxG + ' guests (' + p.type + ')';
      var sg = suggestion(v.pid, v.ci, v.co);
      if (sg && !priceDirty) $('[name=price]').value = sg.avg;
      v = vals();
      $('.nb-sugg').innerHTML = sg ? '<span>Suggested <b>' + fmt.money(sg.avg) + '</b> a night from your pricing' + (sg.wk && sg.we ? ' (weekdays ' + fmt.money(sg.wk) + ', Fri–Sat nights ' + fmt.money(sg.we) + ')' : '') + '.</span>' + (priceDirty && v.price !== sg.avg ? '<button type="button" class="btn btn-quiet btn-xs" data-use>Use suggested</button>' : '') : 'Choose the dates to see the suggested price.';
      var foreign = v.country !== 'MY';
      $('.nb-tax').textContent = foreign ? 'Tourism tax RM 10 per night applies' : 'No tourism tax for Malaysian guests';
      var ok = v.ci && v.co && v.co > v.ci, nights = ok ? d.diff(v.ci, v.co) : 0;
      var cf = ok ? conflictsFor(v.pid, v.ci, v.co) : [];
      var av = $('.nb-avail');
      av.className = 'nb-avail ' + (!ok ? 'bad' : cf.length ? 'bad' : 'ok');
      av.innerHTML = !ok ? 'Check-out must be after check-in.' : cf.length ? '<b>Not available.</b> ' + esc(cf[0]) + (cf.length > 1 ? ' and ' + (cf.length - 1) + ' more.' : '.') : '<b>Available</b> for all ' + fmt.plural(nights, 'night') + ' at ' + esc(p.short) + '.';
      var acc = nights * v.price, clean = CLEANING[p.beds] || 80, tax = foreign ? 10 * nights : 0;
      var invNo = nextNo('invoiceNo', 'INV-' + T.slice(0, 4) + '-');
      $('.nb-sum').innerHTML = '<h4>' + esc(p.name) + '</h4><div class="muted small">' + (ok ? d.fmtY(v.ci) + ' → ' + d.fmtY(v.co) + ' · ' + fmt.plural(nights, 'night') : 'Choose dates') + '</div>' +
        '<dl class="kv"><dt>' + nights + ' × ' + fmt.money(v.price) + '</dt><dd>' + fmt.money(acc) + '</dd><dt>Cleaning fee</dt><dd>' + fmt.money(clean) + '</dd>' + (tax ? '<dt>Tourism tax</dt><dd>' + fmt.money(tax) + '</dd>' : '') +
        '<dt class="tot">Guest pays</dt><dd class="tot">' + fmt.money(acc + clean + tax) + '</dd></dl>' +
        '<div class="nb-docs" style="margin-top:10px">' + O.icon('invoices').replace('<svg ', '<svg style="width:13px;height:13px;vertical-align:-2px" ') + ' Invoice <b>' + esc(invNo) + '</b> is created automatically when you save.' +
        (paid ? ' Receipt <b>' + esc(nextNo('receiptNo', 'RCP-' + T.slice(0, 4) + '-')) + '</b> is created too.' : ' The receipt is created when payment arrives.') + '</div>';
    }
    body.addEventListener('input', function (e) { if (e.target.name === 'price') priceDirty = true; $('.nb-err').innerHTML = ''; update(); });
    body.addEventListener('change', function (e) {
      if (e.target.name === 'ci') { var ci = e.target.value, co = $('[name=co]'); if (ci && (!co.value || co.value <= ci)) co.value = d.add(ci, 2); }
      if (e.target.name === 'pid' || e.target.name === 'ci' || e.target.name === 'co') priceDirty = false;
      update();
    });
    body.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.paid) { paid = b.dataset.paid === 'yes'; O.$$('[data-paid]', body).forEach(function (x) { x.classList.toggle('on', x === b); }); $('[name=method]').hidden = !paid; update(); }
      if (b.hasAttribute('data-use')) { priceDirty = false; update(); }
    });
    update();

    var created = null;
    U.modal({
      title: 'New direct booking', sub: 'The invoice is created automatically from the booking and guest details.', size: 'wide', body: body,
      actions: [{ label: 'Cancel' }, {
        label: 'Create booking', kind: 'primary', onClick: function (close) {
          var v = vals(), p = D.propById[v.pid], err = [];
          var maxG = Math.max(2, 2 + p.beds * 2);
          if (!v.ci || !v.co || v.co <= v.ci) err.push('Check-out must be after check-in.');
          else {
            if (v.ci < T) err.push('Check-in cannot be in the past.');
            if (d.diff(v.ci, v.co) > 60) err.push('A direct booking can be at most 60 nights.');
            var cf = conflictsFor(v.pid, v.ci, v.co); if (cf.length) err.push(p.short + ' is not available: ' + cf[0] + '.');
          }
          if (!v.name) err.push('Enter the guest\'s name.');
          if (!v.phone && !v.email) err.push('Enter a phone number or an email so the invoice can be sent.');
          if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) err.push('The email address does not look right.');
          if (v.guests < 1 || v.guests > maxG) err.push('Guests must be between 1 and ' + maxG + ' for this unit.');
          if (!(v.price > 0)) err.push('Enter the nightly price.');
          if (err.length) {
            var eb = $('.nb-err'); eb.innerHTML = '<b>Please check ' + (err.length === 1 ? 'this' : 'these') + ':</b><br>' + err.map(esc).join('<br>');
            try { eb.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (x) {}
            var first = !v.name ? '[name=name]' : (!v.phone && !v.email) ? '[name=phone]' : (v.email && err.join(' ').indexOf('email') >= 0) ? '[name=email]' : null;
            if (first) try { $(first).focus({ preventScroll: true }); } catch (x) {}
            return false;
          }
          created = createBooking(v, paid ? $('[name=method]').value : null, o.onCreated);
          if ($('[name=send]').checked) setTimeout(function () { O.invoice.send(created, created.paidAt ? ['invoice', 'receipt'] : ['invoice']); }, 50);
        }
      }]
    });
  };

  function createBooking(v, payMethod, onCreated) {
    var p = D.propById[v.pid], nights = d.diff(v.ci, v.co), foreign = v.country !== 'MY';
    var maxId = D.bookings.reduce(function (m, b) { return Math.max(m, +b.id.split('-')[1] || 0); }, 4100);
    var b = {
      id: 'BK-' + (maxId + 1), propertyId: p.id,
      guest: { name: v.name, country: v.country, countryName: D.countryName[v.country] || v.country, foreign: foreign, phone: v.phone || '', email: v.email || '' },
      guests: v.guests, channel: 'direct', checkIn: v.ci, checkOut: v.co, nights: nights,
      checkInTime: v.time, checkOutTime: '11:00', createdAt: D.NOW,
      nightly: Math.round(v.price), accommodation: Math.round(v.price) * nights, cleaningFee: CLEANING[p.beds] || 80, tourismTax: foreign ? 10 * nights : 0,
      status: 'confirmed', idVerified: false, codeStatus: 'held', sameDay: v.ci === T, notes: v.notes || ''
    };
    b.total = b.accommodation + b.cleaningFee + b.tourismTax;
    b.platformFee = Math.round(b.accommodation * D.channels.direct.feePct);
    b.payout = b.total - b.platformFee;
    b.revenue = b.accommodation + b.cleaningFee;
    b.doorCode = String(1000 + (D.hash(b.id + 'door') % 9000));
    b.invoiceNo = nextNo('invoiceNo', 'INV-' + T.slice(0, 4) + '-');
    b.invoiceDate = T; b.paidAt = null; b.receiptNo = null; b.payMethod = null; b.invoiceSent = null; b.receiptSent = null;
    /* keep D.bookings sorted by check-in (metrics read the same array) */
    var at = 0; while (at < D.bookings.length && D.bookings[at].checkIn <= b.checkIn) at++;
    D.bookings.splice(at, 0, b);
    /* a same-day arrival needs an urgent turnover */
    var taskMsg = '';
    if (b.sameDay && !D.tasks.some(function (t) { return t.propertyId === p.id && t.type === 'Turnover' && t.due.slice(0, 10) === T && t.status !== 'done'; })) {
      var tMax = D.tasks.reduce(function (m, t) { return Math.max(m, +t.id.split('-')[1] || 0); }, 300);
      var hh = +v.time.slice(0, 2), mm = +v.time.slice(3, 5), due = Math.max(hh * 60 + mm - 30, 11 * 60);
      D.tasks.push({ id: 'T-' + (tMax + 1), title: 'Turnover clean', type: 'Turnover', propertyId: p.id, assigneeId: p.housekeeper, due: T + 'T' + ('0' + Math.floor(due / 60)).slice(-2) + ':' + ('0' + due % 60).slice(-2), priority: 'high', status: 'todo', checklist: [0, 12], note: 'Same-day booking: ' + b.guest.name + ' arrives ' + fmt.time(v.time) });
      var hk = D.staffById(p.housekeeper); taskMsg = ' Urgent turnover assigned to ' + (hk ? hk.name : 'housekeeping') + '.';
    }
    if (onCreated) onCreated(b);
    if (payMethod) O.invoice.markPaid(b, payMethod); /* creates the receipt and refreshes every view */
    else O.emit('data', { type: 'booking', bookingId: b.id });
    U.toast('Booking ' + b.id + ' created for ' + b.guest.name + '. Invoice ' + b.invoiceNo + (b.receiptNo ? ' and receipt ' + b.receiptNo + ' created.' : ' created automatically.') + taskMsg);
    return b;
  }
})();
