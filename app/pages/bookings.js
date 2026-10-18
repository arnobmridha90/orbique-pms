/* Bookings: every reservation grouped by property: date range, filters, search, compact rows (cards on a phone),
   the booking drawer with Edit / Copy guest link / Cancel, CSV export and the "New booking" (direct booking) form.
   Shared with other sections (Calendar uses both):
     O.newBooking({propertyId, checkIn, checkOut, onCreated(b)})  the direct-booking form
     O.bookingTools = {open(idOrBooking), edit(b), cancel(b), copyLink(b), propLabel(p), place(p)}
   Permissions: bookings.create / edit / cancel / export / contacts (phone and email) / value (money). */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  var STATUS_ORDER = ['confirmed', 'checked_in', 'pending', 'checked_out', 'cancelled'];
  var ST_VAR = { confirmed: 'confirmed', checked_in: 'inhouse', pending: 'pending', checked_out: 'past', cancelled: 'cancelled' };
  var MATCH = [['stay', 'Staying in range'], ['checkin', 'Checking in'], ['booked', 'Booked in range']];
  var CLEANING = { 0: 50, 1: 60, 2: 80, 3: 110, 4: 130 }; /* same cleaning fees as the rest of the data */
  var ACTION_DAYS = 3;
  var NO = {
    create: 'Your access does not include adding bookings',
    edit: 'Your access does not include editing bookings',
    cancel: 'Your access does not include cancelling bookings',
    link: 'Your access does not include sharing guest links'
  };

  /* page state survives re-renders; dates are filled in at render time (never at load) */
  var st = {
    range: null, match: 'stay', status: [], plat: '', action: false, prop: '', q: '',
    collapsed: {}, sort: { key: 'checkIn', dir: 1 }, highlight: null, filtersOpen: false
  };

  O.css('bookings', `
.pg-bookings{--bk-cols:minmax(0,2fr) minmax(0,1.45fr) minmax(112px,1fr) 106px minmax(84px,.75fr) minmax(0,1.45fr);}
.pg-bookings .bk-list.nov{--bk-cols:minmax(0,2fr) minmax(0,1.45fr) minmax(112px,1fr) 106px minmax(0,1.6fr);}
.pg-bookings .bk-tools{display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px;}
.pg-bookings .bk-tools .select{width:auto; min-width:150px; max-width:250px; height:36px; padding-top:0; padding-bottom:0;}
.pg-bookings .bk-tools .search{flex:1 1 200px; max-width:380px;}
.pg-bookings .bk-fbtn{display:none; height:36px;}
.pg-bookings .bk-fbtn[aria-expanded="true"]{border-color:var(--brand-strong); color:var(--brand-text); background:var(--brand-soft);}
.pg-bookings .bk-fbtn .n{background:var(--brand); color:var(--brand-ink); border-radius:10px; font-size:10.5px; padding:0 6px; line-height:17px;}
.pg-bookings .bk-chips{display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-bottom:12px;}
.pg-bookings .bk-chips .chip{padding:5px 10px; font-size:12px;}
.pg-bookings .bk-chips .sp{flex:1 1 12px;}
.pg-bookings .chip .sw{width:8px; height:8px; border-radius:2px; display:inline-block; flex-shrink:0;}
.pg-bookings .chip.warnchip:not(.on){border-color:var(--warn-soft); background:var(--warn-soft); color:var(--warn);}
.pg-bookings .chip svg{width:13px; height:13px;}
.pg-bookings .bk-tools .bk-msel{min-width:0; width:158px;}
.pg-bookings .bk-sum{display:flex; align-items:center; gap:6px 10px; flex-wrap:wrap; margin:0 0 10px; font-size:12.5px; color:var(--text-2);}
.pg-bookings .bk-sum .txt{flex:1 1 260px; min-width:0;}
.pg-bookings .bk-sum .txt b{color:var(--text);}
.pg-bookings .bk-link{background:none; border:none; padding:0; font:inherit; font-weight:700; color:var(--brand-text); white-space:nowrap;}
.pg-bookings .bk-link:hover{text-decoration:underline;}
.pg-bookings .bk-list{overflow:hidden;}
.pg-bookings .bk-hrow, .pg-bookings .bk-row{display:grid; grid-template-columns:var(--bk-cols); column-gap:12px; align-items:center; padding:0 16px;}
.pg-bookings .bk-hrow{height:34px; background:var(--surface); border-bottom:1px solid var(--border); font-size:11px; font-weight:700; color:var(--muted);}
.pg-bookings .bk-hrow .c-total{text-align:right; font-size:11px; font-weight:700;}
.pg-bookings .bk-hrow .c-total .th-sort{flex-direction:row-reverse;}
.pg-bookings .th-sort{background:none; border:none; padding:0; font:inherit; color:inherit; font-weight:700; display:inline-flex; align-items:center; gap:4px; min-height:28px;}
.pg-bookings .th-sort:hover{color:var(--text);}
.pg-bookings .th-sort.on{color:var(--brand-text);}
.pg-bookings .th-sort .arr{font-size:9px;}
.pg-bookings .bk-gh{display:flex; align-items:center; gap:10px; padding:0 12px 0 6px; min-height:42px; background:var(--surface-2); border-bottom:1px solid var(--border);}
.pg-bookings .gh-toggle{display:flex; align-items:center; gap:8px; min-height:40px; background:none; border:none; padding:0 8px 0 6px; border-radius:8px; text-align:left; min-width:0; flex:1 1 auto;}
.pg-bookings .gh-toggle:hover .gh-name{color:var(--brand-text);}
.pg-bookings .gh-toggle > svg{width:16px; height:16px; color:var(--muted); transition:transform .15s; flex-shrink:0;}
.pg-bookings .gh-toggle[aria-expanded="false"] > svg{transform:rotate(-90deg);}
.pg-bookings .gh-t{min-width:0;}
.pg-bookings .gh-name{font-family:var(--font-head); font-weight:800; font-size:13.5px;}
.pg-bookings .gh-loc{font-size:12px; color:var(--muted); font-weight:500;}
.pg-bookings .gh-n{font-size:12px; color:var(--muted); white-space:nowrap;}
.pg-bookings .gh-n b{color:var(--text); font-variant-numeric:tabular-nums;}
.pg-bookings .bk-gh .btn-quiet{min-height:32px; flex-shrink:0;}
.pg-bookings .bk-row{min-height:44px; padding-top:4px; padding-bottom:4px; border-bottom:1px solid var(--border); cursor:pointer; background:var(--surface);}
.pg-bookings .bk-row:hover{background:var(--surface-2);}
.pg-bookings .bk-row:focus-visible{outline-offset:-2px;}
.pg-bookings .bk-row > div{min-width:0;}
.pg-bookings .l1{font-size:13px; font-weight:700; line-height:17px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.pg-bookings .l2{font-size:11.5px; color:var(--muted); line-height:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.pg-bookings .l2.soon{color:var(--brand-text); font-weight:700;}
.pg-bookings .c-stay .l1 .nts{font-weight:500; color:var(--text-2);}
.pg-bookings .sd{font-size:10.5px; font-weight:800; color:var(--accent-text); background:var(--accent-soft); border-radius:20px; padding:0 6px; margin-left:6px; vertical-align:1px;}
.pg-bookings .c-plat .plat{max-width:100%; overflow:hidden;}
.pg-bookings .c-total{text-align:right; font-weight:700; font-size:13px; font-variant-numeric:tabular-nums; white-space:nowrap;}
.pg-bookings .c-ready{display:flex; gap:4px; align-items:center; overflow:hidden;}
.pg-bookings .c-ready .rd{overflow:hidden; text-overflow:ellipsis;}
.pg-bookings .c-ready .rd.more{flex-shrink:0;}
.pg-bookings .c-ready .ontrack{font-size:11.5px; font-weight:600; color:var(--ok); white-space:nowrap;}
.pg-bookings .c-ready .dash{font-size:11.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.pg-bookings .bk-row.cx .l1{color:var(--muted);}
.pg-bookings .bk-row.cx .c-guest .l1, .pg-bookings .bk-row.cx .c-total{text-decoration:line-through; text-decoration-color:var(--faint);}
.pg-bookings .bk-row.flash{background:var(--brand-soft); transition:background 1.2s;}
.pg-bookings .bk-none{padding:0 16px 0 44px; min-height:34px; display:flex; align-items:center; font-size:12px; color:var(--muted); border-bottom:1px solid var(--border);}
.pg-bookings .bk-empty{padding:34px 16px; text-align:center; color:var(--muted); font-size:13px;}
.pg-bookings .bk-empty .e-icon svg{width:26px; height:26px; color:var(--faint);}
.pg-bookings .bk-empty .btn{margin-top:12px;}
@media (max-width:1180px){
  .pg-bookings{--bk-cols:minmax(0,1.5fr) minmax(150px,1.5fr) 22px 106px 84px minmax(0,1.3fr);}
  .pg-bookings .bk-list.nov{--bk-cols:minmax(0,1.6fr) minmax(150px,1.5fr) 22px 106px minmax(0,1.4fr);}
  .pg-bookings .c-plat .plat{font-size:0; gap:0;}
  .pg-bookings .bk-hrow .c-plat .th-sort{font-size:0;}
}
@media (max-width:760px){
  .pg-bookings .bk-tools .dr{flex:1 1 0; min-width:0;}
  .pg-bookings .bk-tools .dr-btn{width:100%; overflow:hidden; height:40px;}
  .pg-bookings .bk-tools .dr-btn .dr-preset{display:none;}
  .pg-bookings .bk-tools .dr-btn .dr-lbl{overflow:hidden; text-overflow:ellipsis; flex:1; text-align:left;}
  .pg-bookings .bk-fbtn{display:inline-flex; min-height:40px;}
  .pg-bookings .bk-tools .search{flex:1 1 100%; max-width:none; order:5; height:40px;}
  .pg-bookings .bk-tools .select{flex:1 1 calc(50% - 4px); max-width:none; min-width:0; height:40px; order:6;}
  .pg-bookings:not(.f-open) .bk-tools .select, .pg-bookings:not(.f-open) .bk-chips{display:none;}
  .pg-bookings .bk-chips .chip{min-height:36px;}
  .pg-bookings .bk-sum .xp{display:none;}
  .pg-bookings .bk-hrow{display:none;}
  .pg-bookings .bk-row{grid-template-columns:20px minmax(0,1fr) auto; grid-template-areas:"plat guest status" "plat stay total" "plat ready ready"; column-gap:10px; row-gap:1px; padding:9px 12px; min-height:52px;}
  .pg-bookings .bk-row .c-plat{grid-area:plat; align-self:start; padding-top:1px;}
  .pg-bookings .bk-row .c-plat .plat{font-size:0; gap:0;}
  .pg-bookings .bk-row .c-guest{grid-area:guest;} .pg-bookings .bk-row .c-guest .l2{display:none;}
  .pg-bookings .bk-row .c-stay{grid-area:stay;} .pg-bookings .bk-row .c-stay .l1{font-weight:600;}
  .pg-bookings .bk-row .c-stay .l2:not(.soon){display:none;}
  .pg-bookings .bk-row .c-status{grid-area:status; justify-self:end;}
  .pg-bookings .bk-row .c-total{grid-area:total; font-size:12.5px; font-weight:600; color:var(--text-2);}
  .pg-bookings .bk-row .c-ready{grid-area:ready; margin-top:3px;}
  .pg-bookings .bk-row .c-ready:not(.has-issue){display:none;}
  .pg-bookings .bk-gh{padding:3px 4px 3px 2px; gap:4px;}
  .pg-bookings .gh-toggle{flex:1 1 auto; padding:4px 4px 4px 6px; align-items:flex-start;}
  .pg-bookings .gh-toggle > svg, .pg-bookings .gh-toggle .prop-dot{margin-top:3px;}
  .pg-bookings .gh-loc{display:block; font-size:11.5px;}
  .pg-bookings .gh-sep{display:none;}
  .pg-bookings .bk-gh .btn-quiet{min-height:40px; min-width:40px; padding:0 8px;}
  .pg-bookings .bk-gh .btn-quiet .lbl{display:none;}
  .pg-bookings .bk-none{padding-left:40px;}
}
.bk-dfoot{justify-content:flex-start;}
.bk-dfoot .sp{flex:1;}
.bk-dfoot .btn-danger-ghost{background:var(--surface); color:var(--bad); border-color:var(--border);}
.bk-dfoot .btn-danger-ghost:hover{background:var(--bad-soft); border-color:transparent;}
.nb-wrap{display:grid; grid-template-columns:minmax(0,1fr) 250px; gap:16px; align-items:start;}
.nb-side{position:sticky; top:0; display:flex; flex-direction:column; gap:10px;}
.nb-sum{border:1px solid var(--border); border-radius:10px; padding:12px; background:var(--surface-2);}
.nb-sum h4{font-size:13px; margin-bottom:2px;}
.nb-sum .kv{font-size:12.5px; margin-top:10px;}
.nb-avail{font-size:12px; font-weight:600; border-radius:8px; padding:7px 9px; line-height:1.4;}
.nb-avail.ok{background:var(--ok-soft); color:var(--ok);}
.nb-avail.bad{background:var(--bad-soft); color:var(--bad);}
.nb-avail.info{background:var(--surface-2); color:var(--text-2); border:1px solid var(--border);}
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
.bk-linkbox{display:flex; gap:8px; align-items:center;}
.bk-linkbox .input{font-size:12px;}
.bk-unit .bu-top{display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
.bk-unit .bu-no{font-size:15px;}
.bk-unit .bu-how{margin-top:4px; line-height:1.45;}
.bu-list{display:flex; flex-direction:column; border:1px solid var(--border); border-radius:10px; overflow:hidden;}
.bu-opt{display:flex; align-items:center; gap:10px; padding:9px 12px; cursor:pointer; min-height:44px;}
.bu-opt + .bu-opt{border-top:1px solid var(--border);}
.bu-opt:hover{background:var(--surface-2);}
.bu-opt.off{cursor:not-allowed; opacity:.6;}
.bu-opt input{width:17px; height:17px; flex:none;}
.bu-opt .grow{display:flex; flex-direction:column; min-width:0;}
.bu-opt b{font-size:13px;}
@media (max-width:760px){ .nb-wrap{grid-template-columns:minmax(0,1fr);} .nb-side{display:contents;} .nb-avail{order:-1;} }
`);

  /* ---------------- helpers ---------------- */
  function live(b) { return b.status !== 'cancelled'; }
  function sum(list, f) { return list.reduce(function (s, x) { return s + (f(x) || 0); }, 0); }
  function created(b) { return String(b.createdAt || '').slice(0, 10); }
  function isArchived(p) { return !!(p && (p.archived || p.status === 'archived')); }
  /* where the property is ("Gurney Drive, Penang"). The Properties page stores it in `area`; older or imported records may use another field. */
  function place(p) { return p ? (p.area || p.location || p.city || p.address || '') : ''; }
  function propName(p) { return p ? (p.name || p.short || 'Unnamed property') : 'Removed property'; }
  function propLabel(p) { var l = place(p); return propName(p) + (l ? ' · ' + l : ''); }
  function maxGuests(p) { var t = O.typeOf(p); if (t && +t.maxGuests > 0) return +t.maxGuests; return Math.max(2, 2 + (+(p && p.beds) || 0) * 2); }
  function cleaningFor(p) { return CLEANING[p && p.beds] || 80; }
  function feePct(ch) { return (D.channels[ch] && D.channels[ch].feePct) || 0; }
  function rateOf(pid, iso) {
    var o = D.priceOverrides && D.priceOverrides[pid];
    if (o && o[iso]) return o[iso];
    var r = NaN; try { r = D.rateFor(pid, iso); } catch (e) { /* property without a price model */ }
    var p = D.propById[pid];
    return isFinite(r) && r > 0 ? r : (p && +p.base) || 0;
  }
  function tShort(t) { return fmt.time(t || '15:00').replace(':00 ', ' '); } /* '15:00' -> '3 PM' */
  function rangeText() { return U.rangeLabel(st.range.from, st.range.to); }
  function canValue() { return O.can('bookings.value'); }
  function canContacts() { return O.can('bookings.contacts'); }
  function maskPhone(s) {
    s = String(s || ''); var dg = s.replace(/\D/g, ''); if (!dg) return '';
    var cc = (s.match(/^\+\d{1,3}/) || [''])[0];
    return (cc ? cc + ' ' : '') + '••• ••' + dg.slice(-2);
  }
  function maskEmail(s) { s = String(s || ''); var at = s.indexOf('@'); return at > 0 ? s.charAt(0) + '•••' + s.slice(at) : (s ? '•••' : ''); }

  /* things to do before an upcoming arrival, most important first: [state, short label, explanation] */
  function issues(b) {
    var T = D.TODAY, out = [];
    if (!live(b) || b.status === 'checked_in' || b.status === 'checked_out' || b.checkIn < T) return out;
    if (b.conflict && b.conflict.kind === 'double_booking') out.push(['bad', 'Double booking', 'Another booking or a block overlaps these nights' + (b.conflict.with && b.conflict.with.length ? ' (' + b.conflict.with.join(', ') + ')' : '') + '. Move one of them.']);
    if (!b.propertyId && b.unitTypeId) out.push(['bad', 'Needs a unit', 'No single ' + ((O.unitType(b.unitTypeId) || {}).name || '') + ' unit is free for the whole stay. Pick one by hand.']);
    if (b.status === 'pending') out.push(['wait', 'Pending', 'Waiting for confirmation or payment']);
    var money = canValue(); /* invoice and payment steps only for people who see booking values */
    if (money && !b.invoiceSent && b.invoiceNo) out.push(['wait', 'Invoice not sent', 'Invoice ' + b.invoiceNo + ' is ready to send']);
    if (money && !b.paidAt && b.channel === 'direct' && b.status !== 'pending' && b.checkIn <= d.add(T, 7)) out.push(['wait', 'Awaiting payment', 'Direct booking, payment is due 7 days before arrival']);
    if (b.checkIn <= d.add(T, ACTION_DAYS)) {
      if (!b.idVerified) out.push(['wait', 'ID pending', 'The guest has not verified their ID yet']);
      if (b.checkIn <= d.add(T, 1)) {
        var clean = O.readiness(b).filter(function (r) { return r.key === 'clean'; })[0];
        if (clean && clean.state === 'todo') out.push(['todo', clean.label, 'Unit not ready yet: ' + clean.label.toLowerCase()]);
      }
    }
    return out;
  }
  function needsAction(b) { return issues(b).length > 0; }
  function actionTitle() {
    return 'Upcoming bookings that are pending' + (canValue() ? ', have an invoice that was not sent, are waiting for payment,' : '') + ' or arrive in the next ' + ACTION_DAYS + ' days without a verified ID or a ready unit';
  }

  function inRange(b, r) {
    r = r || st.range;
    if (st.match === 'checkin') return b.checkIn >= r.from && b.checkIn <= r.to;
    if (st.match === 'booked') { var c = created(b); return c >= r.from && c <= r.to; }
    return b.checkIn <= r.to && b.checkOut >= r.from; /* any night in the range, plus departures inside it */
  }
  function matchQ(b) {
    var q = (st.q || '').trim().toLowerCase(); if (!q) return true;
    if (String(b.guest.name || '').toLowerCase().indexOf(q) >= 0 || String(b.id).toLowerCase().indexOf(q) >= 0 || String(b.invoiceNo || '').toLowerCase().indexOf(q) >= 0 || String(b.reservationCode || '').toLowerCase().indexOf(q) >= 0) return true;
    if (!canContacts()) return false; /* phone and email search only for people who may see them */
    if (String(b.guest.email || '').toLowerCase().indexOf(q) >= 0) return true;
    var digits = q.replace(/\D/g, '');
    return digits.length >= 4 && String(b.guest.phone || '').replace(/\D/g, '').indexOf(digits) >= 0;
  }
  function passStatus(b) { return !st.status.length || st.status.indexOf(b.status) >= 0; }
  function passPlat(b) { return !st.plat || b.channel === st.plat; }
  function passAction(b) { return !st.action || needsAction(b); }
  function baseList() { return D.bookings.filter(function (b) { return (!st.prop || b.propertyId === st.prop) && inRange(b) && matchQ(b); }); }
  function filtersActive() { return !!(st.status.length || st.plat || st.action || (st.q && st.q.trim())); }
  function filterCount() { return st.status.length + (st.plat ? 1 : 0) + (st.action ? 1 : 0) + (st.prop ? 1 : 0) + (st.match !== 'stay' ? 1 : 0); }

  var SORTS = {
    guest: function (a, b) { return String(a.guest.name).localeCompare(String(b.guest.name)); },
    checkIn: function (a, b) { return a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : a.id < b.id ? -1 : 1; },
    channel: function (a, b) { return U.platName(a.channel).localeCompare(U.platName(b.channel)); },
    status: function (a, b) { return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status); },
    total: function (a, b) { return (a.total || 0) - (b.total || 0); }
  };
  function sorted(list) {
    var f = SORTS[st.sort.key] || SORTS.checkIn, dir = st.sort.dir;
    return list.slice().sort(function (a, b) { var r = f(a, b); if (!r) r = SORTS.checkIn(a, b); return r * dir; });
  }

  /* ---------------- cells ---------------- */
  function rd(state, label, title) { return '<span class="rd ' + state + '" title="' + esc(title || label) + '">' + esc(label) + '</span>'; }
  function staySub(b) {
    var T = D.TODAY;
    if (live(b) && b.status !== 'checked_out') {
      if (b.checkIn === T) return ['soon', 'Arrives today, ' + tShort(b.checkInTime)];
      if (b.checkIn === d.add(T, 1)) return ['soon', 'Arrives tomorrow, ' + tShort(b.checkInTime)];
      if (b.checkOut === T) return ['soon', 'Leaves today, ' + tShort(b.checkOutTime)];
    }
    return ['', fmt.plural(b.guests || 0, 'guest')];
  }
  function readyCell(b) {
    var T = D.TODAY;
    if (b.status === 'cancelled') return '<div class="c-ready"><span class="dash">' + (b.cancelledAt ? 'Cancelled ' + d.fmt(b.cancelledAt) : 'Cancelled') + '</span></div>';
    if (b.status === 'checked_out' || b.checkOut < T) return '<div class="c-ready"><span class="dash">Stay completed</span></div>';
    if (b.status === 'checked_in' || b.checkIn < T) return '<div class="c-ready"><span class="dash">In-house until ' + d.fmt(b.checkOut) + '</span></div>';
    var is = issues(b).filter(function (x) { return x[1] !== 'Pending'; }); /* the status pill already says pending */
    var full = O.readiness(b).map(function (r) { return r.label; }).concat(canValue() ? [b.invoiceSent ? 'Invoice sent' : 'Invoice not sent', b.paidAt ? 'Paid' : 'Not paid yet'] : []).join(' · ');
    if (!is.length) return '<div class="c-ready">' + (b.status === 'pending' ? '<span class="dash" title="' + esc(full) + '">Waiting for confirmation</span>' : '<span class="ontrack" title="' + esc(full) + '">On track</span>') + '</div>';
    return '<div class="c-ready has-issue">' + rd(is[0][0], is[0][1], is[0][2]) + (is.length > 1 ? rd('todo more', '+' + (is.length - 1), is.slice(1).map(function (x) { return x[1]; }).join(', ')) : '') + '</div>';
  }
  function rowHTML(b, showValue) {
    var cx = b.status === 'cancelled', sub = staySub(b);
    return '<div class="bk-row' + (cx ? ' cx' : '') + '" data-id="' + esc(b.id) + '" role="button" tabindex="0" aria-label="' + esc(b.guest.name + ', ' + d.fmtRange(b.checkIn, b.checkOut) + ', ' + U.statusLabel(b.status)) + '">' +
      '<div class="c-guest"><div class="l1">' + esc(b.guest.name) + (b.sameDay ? '<span class="sd" title="Booked today (' + esc(fmt.time(b.createdAt)) + ') for arrival today">⚡ Same-day</span>' : '') + '</div><div class="l2">' + esc(b.id) + (b.reservationCode ? ' · ' + esc(U.platName(b.channel) + ' ' + b.reservationCode) : '') + (b.guest.countryName ? ' · ' + esc(b.guest.countryName) : '') + '</div></div>' +
      '<div class="c-stay"><div class="l1">' + d.fmtRange(b.checkIn, b.checkOut) + ' <span class="nts">· ' + fmt.plural(b.nights, 'night') + '</span></div><div class="l2' + (sub[0] ? ' soon' : '') + '">' + esc(sub[1]) + '</div></div>' +
      '<div class="c-plat">' + U.plat(b.channel) + '</div>' +
      '<div class="c-status">' + U.status(b.status) + '</div>' +
      (showValue ? '<div class="c-total">' + fmt.money(b.total, { cur: b }) + '</div>' : '') +
      readyCell(b) + '</div>';
  }

  /* ---------------- page ---------------- */
  O.page('bookings', {
    desc: 'Every reservation, grouped by property',
    render: function (root, ctx) {
      var T = D.TODAY;
      if (!st.range) st.range = U.preset('next30');
      if (ctx.fresh && ctx.params) {
        var p = ctx.params;
        if (p.propertyId) st.prop = p.propertyId;
        if (p.status) st.status = [].concat(p.status);
        if (p.q) st.q = p.q;
        if (p.from && p.to) { st.range = { from: p.from, to: p.to, preset: null }; st.match = 'stay'; }
        if (p.propertyId || p.from) st.collapsed = {};
        if (p.bookingId && D.booking(p.bookingId)) { var pb = D.booking(p.bookingId); st.highlight = pb.id; if (!inRange(pb)) st.range = { from: pb.checkIn, to: d.add(pb.checkIn, 29), preset: null }; }
      }
      var canNew = O.can('bookings.create'), canCSV = O.can('bookings.export');
      var noProps = !D.properties.length, noBk = !D.bookings.length;
      ctx.setActions((canCSV && !noProps && !noBk ? '<button type="button" class="btn btn-ghost" data-act="csv">' + O.icon('download') + 'Export CSV</button>' : '') +
        (canNew && !noProps ? '<button type="button" class="btn btn-primary" data-act="new">' + O.icon('plus') + 'New booking</button>' : ''));
      var csvBtn = O.$('[data-act=csv]', ctx.actionsEl), newBtn = O.$('[data-act=new]', ctx.actionsEl);
      if (csvBtn) csvBtn.onclick = exportCSV;
      if (newBtn) newBtn.onclick = function () { openNew({ propertyId: st.prop || undefined }); };

      /* empty workspace: no properties yet */
      if (noProps) {
        var canProp = O.allowed && O.allowed('properties') && O.can('properties.create');
        root.innerHTML = '<div class="pg-bookings"><div class="card"><div class="bk-empty"><div class="e-icon">' + O.icon('bookings') + '</div>' +
          'Bookings appear here once you have added a property.' +
          (canProp ? '<div><button type="button" class="btn btn-primary" data-go="properties">' + O.icon('plus') + 'Add your first property</button></div>' : '<div class="small" style="margin-top:6px">Ask an account owner to add your properties.</div>') + '</div></div></div>';
        var gp = O.$('[data-go]', root); if (gp) gp.onclick = function () { O.go('properties'); };
        return;
      }
      /* properties but no bookings yet: one sentence and the main action, no filters */
      if (noBk) {
        root.innerHTML = '<div class="pg-bookings"><div class="card"><div class="bk-empty"><div class="e-icon">' + O.icon('bookings') + '</div>' +
          'No bookings yet. They appear here as soon as a guest books' + (canNew ? ' or you add one.' : '.') +
          (canNew ? '<div><button type="button" class="btn btn-primary" data-act="first">' + O.icon('plus') + 'Add your first booking</button></div>' : '') + '</div></div></div>';
        var fb0 = O.$('[data-act=first]', root); if (fb0) fb0.onclick = function () { openNew({}); };
        return;
      }
      if (st.prop && (!D.propById[st.prop] || !O.inView(st.prop))) st.prop = '';

      var plats = D.channelOrder.map(function (c) { return '<option value="' + c + '"' + (st.plat === c ? ' selected' : '') + '>' + esc(U.platName(c)) + '</option>'; }).join('');
      root.innerHTML = '<div class="pg-bookings' + (st.filtersOpen ? ' f-open' : '') + '">' +
        '<div class="bk-tools"><span data-slot="range"></span>' +
        '<button type="button" class="btn btn-ghost bk-fbtn" data-act="filters" aria-expanded="' + st.filtersOpen + '">' + O.icon('filter') + 'Filters<span class="n"' + (filterCount() ? '' : ' hidden') + '>' + filterCount() + '</span></button>' +
        '<select class="select bk-msel" data-f="match" aria-label="Which dates the range matches" title="Match the date range on stay dates, check-in date or the date the booking was made">' + MATCH.map(function (m) { return '<option value="' + m[0] + '"' + (st.match === m[0] ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select>' +
        '<select class="select" data-f="prop" aria-label="Property">' + '<option value="">All properties</option>' + D.properties.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === st.prop ? ' selected' : '') + '>' + esc(propName(x)) + '</option>'; }).join('') + '</select>' +
        '<select class="select" data-f="plat" aria-label="Platform"><option value="">All platforms</option>' + plats + '</select>' +
        '<label class="search">' + O.icon('search') + '<input type="search" data-f="q" placeholder="' + (canContacts() ? 'Guest, booking ID or phone' : 'Guest name or booking ID') + '" aria-label="Search bookings" value="' + esc(st.q) + '"></label>' +
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
        T = D.TODAY;
        var showValue = canValue();
        var base = baseList();
        var forStatus = base.filter(function (b) { return passPlat(b) && passAction(b); });
        var forAction = base.filter(function (b) { return passStatus(b) && passPlat(b); });
        var rows = base.filter(function (b) { return passStatus(b) && passPlat(b) && passAction(b); });
        var L = rows.filter(live), cancelled = rows.length - L.length;

        var chips = chip('data-st', 'all', !st.status.length, 'All', forStatus.length) + STATUS_ORDER.map(function (s) {
          var n = forStatus.filter(function (b) { return b.status === s; }).length;
          return chip('data-st', s, st.status.indexOf(s) >= 0, '<i class="sw" style="background:var(--st-' + ST_VAR[s] + ')"></i>' + esc(U.statusLabel(s)), n);
        }).join('') + chip('data-action', '1', st.action, O.icon('alert') + 'Needs action', forAction.filter(needsAction).length, ' warnchip', actionTitle());

        /* groups by property (property order from Properties); bookings of a removed property go last */
        var props = D.properties.filter(function (p) { return !st.prop || p.id === st.prop; });
        var showEmpty = !filtersActive();
        var groups = props.map(function (p) { return { id: p.id, p: p, list: sorted(rows.filter(function (b) { return b.propertyId === p.id; })) }; })
          .filter(function (g) { return g.list.length || (showEmpty && !isArchived(g.p)); });
        var orphans = rows.filter(function (b) { return !D.propById[b.propertyId]; });
        if (orphans.length && !st.prop) {
          /* bookings sold as a unit type that no unit can take yet: one group per type, first, since they need someone */
          var byType = {}, rest = [];
          orphans.forEach(function (b) { var t = !b.propertyId && O.unitType(b.unitTypeId); if (t) (byType[t.id] = byType[t.id] || []).push(b); else rest.push(b); });
          Object.keys(byType).reverse().forEach(function (id) { var t = O.unitType(id), bd = O.building(t.buildingId); groups.unshift({ id: '_type:' + id, p: null, label: t.name + ' · no unit yet', loc: bd ? bd.name : '', list: sorted(byType[id]) }); });
          if (rest.length) groups.push({ id: '_none', p: null, list: sorted(rest) });
        }
        var canAdd = O.can('bookings.create');

        var head = [['guest', 'Guest', 'c-guest'], ['checkIn', 'Stay', 'c-stay'], ['channel', 'Platform', 'c-plat'], ['status', 'Status', 'c-status']];
        if (showValue) head.push(['total', 'Total', 'c-total']);
        head.push([null, 'Next step', 'c-ready', 'Pending items before arrival, or where the stay is now']);
        var hrow = '<div class="bk-hrow" role="row">' + head.map(function (h) {
          if (!h[0]) return '<div class="' + h[2] + '" title="' + esc(h[3] || '') + '">' + h[1] + '</div>';
          var on = st.sort.key === h[0];
          return '<div class="' + h[2] + '"><button type="button" class="th-sort' + (on ? ' on' : '') + '" data-sort="' + h[0] + '" aria-label="Sort by ' + h[1].toLowerCase() + '">' + h[1] + '<span class="arr">' + (on ? (st.sort.dir > 0 ? '▲' : '▼') : '') + '</span></button></div>';
        }).join('') + '</div>';

        var body = groups.map(function (g) {
          var p = g.p, list = g.list, open = !st.collapsed[g.id], n = list.filter(live).length, cx = list.length - n;
          var count = list.length ? '<b>' + n + '</b> ' + (n === 1 ? 'booking' : 'bookings') + (cx ? ' <span class="faint">+' + cx + ' cancelled</span>' : '') : 'No stays';
          var h = '<div class="bk-grp" data-pid="' + esc(g.id) + '"><div class="bk-gh">' +
            '<button type="button" class="gh-toggle" data-toggle="' + esc(g.id) + '" aria-expanded="' + open + '" title="' + esc(g.label ? g.label + (g.loc ? ' · ' + g.loc : '') : propLabel(p)) + '">' + O.icon('chevron') +
            (p ? '<span class="prop-dot" style="background:' + U.propColor(p.id) + '"></span>' : '') +
            '<span class="gh-t"><span class="gh-name">' + esc(g.label || propName(p)) + '</span>' + ((g.label ? g.loc : place(p)) ? '<span class="gh-loc"><span class="gh-sep"> · </span>' + esc(g.label ? g.loc : place(p)) + '</span>' : '') + (isArchived(p) ? '<span class="gh-loc"> (archived)</span>' : '') + '</span></button>' +
            '<span class="gh-n">' + count + '</span>' +
            (canAdd && p && !isArchived(p) ? '<button type="button" class="btn btn-quiet btn-xs" data-new="' + esc(p.id) + '" aria-label="New booking at ' + esc(propName(p)) + '">' + O.icon('plus') + '<span class="lbl">Booking</span></button>' : '') + '</div>';
          if (open && list.length) h += list.map(function (b) { return rowHTML(b, showValue); }).join('');
          return h + '</div>';
        }).join('');

        var matchTxt = st.match === 'stay' ? 'staying between' : st.match === 'checkin' ? 'checking in between' : 'booked between';
        var anyOpen = groups.some(function (g) { return !st.collapsed[g.id] && g.list.length; }), anyClosed = groups.some(function (g) { return st.collapsed[g.id]; });
        var statsLink = O.allowed && O.allowed('statistics') ? ' · <button type="button" class="bk-link" data-go="statistics" title="Revenue, occupancy, average stay and lead time">See statistics</button>' : '';
        var listHTML;
        if (!D.bookings.length) {
          listHTML = '<div class="bk-empty"><div class="e-icon">' + O.icon('bookings') + '</div>No bookings yet. They appear here as soon as a guest books or you add one.' +
            (canAdd ? '<div><button type="button" class="btn btn-primary" data-act="new">' + O.icon('plus') + 'Add your first booking</button></div>' : '') + '</div>';
        } else if (!groups.length) {
          var why = st.match === 'booked' && st.range.from > T ? 'No bookings can be made in the future. Choose a past range such as Last 30 days.' : 'No bookings match these filters for ' + rangeText() + '.';
          listHTML = '<div class="bk-empty"><div class="e-icon">' + O.icon('search') + '</div>' + esc(why) + (filtersActive() ? '<div><button type="button" class="btn btn-ghost btn-sm" data-act="clear">Clear filters</button></div>' : '') + '</div>';
        } else {
          listHTML = (rows.length ? hrow : '') + body;
        }

        dyn.innerHTML =
          '<div class="bk-chips">' + chips + '</div>' +
          (D.bookings.length ? '<div class="bk-sum"><div class="txt"><b>' + fmt.plural(L.length, 'booking') + '</b> ' + matchTxt + ' <b>' + esc(rangeText()) + '</b>' +
            (cancelled ? ' <span class="muted">+ ' + cancelled + ' cancelled</span>' : '') + statsLink + '</div>' +
            (filtersActive() ? '<button type="button" class="btn btn-ghost btn-sm" data-act="clear">' + O.icon('x') + 'Clear filters</button>' : '') +
            '<button type="button" class="btn btn-ghost btn-sm xp" data-act="expand"' + (anyClosed ? '' : ' disabled') + '>Expand all</button>' +
            '<button type="button" class="btn btn-ghost btn-sm xp" data-act="collapse"' + (anyOpen ? '' : ' disabled') + '>Collapse all</button></div>' : '') +
          '<div class="card bk-list' + (showValue ? '' : ' nov') + '">' + listHTML + '</div>';

        var fb = O.$('.bk-fbtn .n', wrap); if (fb) { fb.textContent = filterCount(); fb.hidden = !filterCount(); }

        if (st.highlight) {
          var row = O.$('.bk-row[data-id="' + st.highlight + '"]', dyn);
          if (row) {
            row.classList.add('flash');
            setTimeout(function () { try { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* older browsers */ } }, 60);
            setTimeout(function () { row.classList.remove('flash'); }, 2600);
          }
          st.highlight = null;
        }
      }

      /* one delegated listener on this page's own wrapper */
      wrap.addEventListener('click', function (e) {
        var t = e.target.closest('button, .bk-row'); if (!t || !wrap.contains(t)) return;
        if (t.dataset.st) {
          var s = t.dataset.st;
          if (s === 'all') st.status = [];
          else { var i = st.status.indexOf(s); if (i >= 0) st.status.splice(i, 1); else st.status.push(s); }
          paint(); return;
        }
        if (t.dataset.action) { st.action = !st.action; paint(); return; }
        if (t.dataset.sort) {
          var key = t.dataset.sort;
          if (st.sort.key === key) st.sort.dir = -st.sort.dir; else st.sort = { key: key, dir: key === 'total' ? -1 : 1 };
          paint(); return;
        }
        if (t.dataset.toggle) { st.collapsed[t.dataset.toggle] = !st.collapsed[t.dataset.toggle]; paint(); return; }
        if (t.dataset.new) { openNew({ propertyId: t.dataset.new }); return; }
        if (t.dataset.go) { O.go(t.dataset.go, { from: st.range.from, to: st.range.to, propertyId: st.prop || undefined }); return; }
        var a = t.dataset.act;
        if (a === 'filters') { st.filtersOpen = !st.filtersOpen; wrap.classList.toggle('f-open', st.filtersOpen); t.setAttribute('aria-expanded', st.filtersOpen); return; }
        if (a === 'new') { openNew({ propertyId: st.prop || undefined }); return; }
        if (a === 'expand') { st.collapsed = {}; paint(); return; }
        if (a === 'collapse') { D.properties.forEach(function (p) { st.collapsed[p.id] = true; }); st.collapsed._none = true; D.unitTypes.forEach(function (t) { st.collapsed['_type:' + t.id] = true; }); paint(); return; }
        if (a === 'clear') { st.status = []; st.plat = ''; st.action = false; st.q = ''; var qi = O.$('[data-f=q]', wrap); if (qi) qi.value = ''; var ps = O.$('[data-f=plat]', wrap); if (ps) ps.value = ''; paint(); return; }
        if (t.classList.contains('bk-row')) openBooking(t.dataset.id);
      });
      wrap.addEventListener('keydown', function (e) {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('bk-row')) { e.preventDefault(); openBooking(e.target.dataset.id); }
      });
      O.$('[data-f=prop]', wrap).onchange = function (e) { st.prop = e.target.value; paint(); };
      O.$('[data-f=plat]', wrap).onchange = function (e) { st.plat = e.target.value; paint(); };
      O.$('[data-f=match]', wrap).onchange = function (e) {
        var prev = st.match; st.match = e.target.value;
        if (st.match === 'booked' && st.range.to > D.TODAY) st.range = U.preset('last30');
        else if (prev === 'booked' && st.match !== 'booked' && st.range.to <= D.TODAY) st.range = U.preset('next30');
        ctx.rerender();
      };
      O.$('[data-f=q]', wrap).oninput = function (e) { st.q = e.target.value; paint(); };

      paint();
      if (ctx.fresh && ctx.params) {
        if (ctx.params.new && canNew) openNew({ propertyId: ctx.params.propertyId, checkIn: ctx.params.checkIn });
        else if (ctx.params.bookingId && D.booking(ctx.params.bookingId)) openBooking(ctx.params.bookingId);
      }
    }
  });

  /* make sure a booking just created (or changed) is visible in the list */
  function reveal(b) {
    st.highlight = b.id; st.status = []; st.plat = ''; st.action = false; st.q = '';
    if (st.prop && st.prop !== b.propertyId) st.prop = '';
    st.collapsed[b.propertyId] = false;
    if (!st.range) st.range = U.preset('next30');
    if (!inRange(b)) {
      var key = st.match === 'booked' ? D.TODAY : b.checkIn;
      st.range = { from: key < st.range.from ? key : st.range.from, to: key > st.range.to ? key : st.range.to, preset: null };
    }
  }
  function openNew(o) { o = o || {}; o.onCreated = reveal; O.newBooking(o); }

  /* ---------------- CSV export ---------------- */
  function exportCSV() {
    if (!O.can('bookings.export')) { U.toast(O.viewer().name + '\'s access does not include downloading bookings.', 'bad'); return; }
    var money = canValue(), contacts = canContacts();
    var order = {}; D.properties.forEach(function (p, i) { order[p.id] = i; });
    var rows = sorted(baseList().filter(function (b) { return passStatus(b) && passPlat(b) && passAction(b); }));
    if (!rows.length) { U.toast('There are no bookings to export with these filters', 'bad'); return; }
    rows.sort(function (a, b) { return (order[a.propertyId] == null ? 999 : order[a.propertyId]) - (order[b.propertyId] == null ? 999 : order[b.propertyId]); });
    var head = ['Booking ID', 'Property', 'Location', 'Unit type', 'Unit no.', 'Guest', 'Country'];
    if (contacts) head = head.concat(['Phone', 'Email']);
    head = head.concat(['Check-in', 'Check-out', 'Nights', 'Guests', 'Platform', 'Reservation code', 'Status', 'Booked at']);
    if (money) head = head.concat(['Currency', 'Total', 'Tourism tax', 'Revenue', 'Platform fee', 'Payout']);
    head = head.concat(['Invoice no.', 'Invoice sent', 'Receipt no.', 'Paid on', 'Receipt sent', 'ID verified', 'Cancelled on']);
    var out = [head].concat(rows.map(function (b) {
      var p = D.propById[b.propertyId];
      var ut = O.unitType(b.unitTypeId);
      var r = [b.id, p ? propName(p) : O.bookingPlace(b), place(p), ut ? O.typeTitle(ut) : '', (p && p.unitNo) || '', b.guest.name, b.guest.countryName || ''];
      if (contacts) r = r.concat([b.guest.phone || '', b.guest.email || '']);
      r = r.concat([b.checkIn, b.checkOut, b.nights, b.guests, U.platName(b.channel), b.reservationCode || '', U.statusLabel(b.status), String(b.createdAt || '').replace('T', ' ')]);
      if (money) r = r.concat([O.curOf(b), b.total, b.tourismTax, b.revenue, b.platformFee, b.payout]);
      return r.concat([b.invoiceNo || '', b.invoiceSent ? b.invoiceSent.via + ' ' + (b.invoiceSent.at || '') : 'No', b.receiptNo || '', b.paidAt || '', b.receiptSent ? b.receiptSent.via + ' ' + (b.receiptSent.at || '') : 'No', b.idVerified ? 'Yes' : 'No', b.cancelledAt || '']);
    }));
    O.downloadCSV('bookings-' + st.match + '-' + st.range.from + '-to-' + st.range.to + '.csv', out);
  }

  /* ===================================================================
     Booking drawer with actions. The drawer itself is core's O.booking.open; this adds a footer with
     Edit, Copy guest link and Cancel booking (per permission). Used by Bookings and Calendar.
     =================================================================== */
  function canEditB(b) { return b.status !== 'cancelled' && b.status !== 'checked_out'; }
  function canCancelB(b) { return b.status === 'confirmed' || b.status === 'pending'; }
  /* a platform booking that came through the channel manager (or sits on a connected unit type in live mode): its dates,
     price and cancellation belong to the platform, and changes made there arrive here automatically */
  function otaLocked(b) {
    if (!b || !b.channel || b.channel === 'direct') return false;
    if (b.channex) return true;
    return !!(O.channel && b.unitTypeId && O.channel.mode() === 'live' && O.channel.typeConnected(b.unitTypeId));
  }
  function otaWhy(b, what) { return (what || 'Change') + ' this on ' + U.platName(b.channel) + '; changes arrive here automatically.'; }
  function canLink() { return O.can('bookings', 'edit'); }
  function openBooking(id) {
    var b = typeof id === 'string' ? D.booking(id) : id; if (!b) return null;
    if (!D.propById[b.propertyId] && !O.unitType(b.unitTypeId)) { infoModal(b); return null; } /* core's drawer needs the property (or the unit type) */
    var dr = O.booking.open(b);
    if (!dr || !dr.el) return dr;
    scrubDrawer(dr, b);
    /* core re-renders the drawer body on 'data' first (its listener is older), then this runs */
    var off = O.on('data', function () { if (!document.body.contains(dr.el)) { off(); return; } scrubDrawer(dr, b); });
    return dr;
  }
  /* Edit, Copy guest link and Cancel appear in the booking drawer on every page (core's O.booking.actions) */
  if (O.booking && O.booking.actions && !O.booking.actions.some(function (x) { return x.from === 'bookings'; })) {
    O.booking.actions.push(
      { from: 'bookings', label: 'Copy guest link', icon: 'copy', show: function (b) { return b.status !== 'cancelled' && canLink(); }, run: function (b) { copyLink(b); } },
      { from: 'bookings', label: 'Edit', icon: 'edit', show: function (b) { return canEditB(b) && O.can('bookings.edit'); }, run: function (b) { editBooking(b); } },
      { from: 'bookings', label: 'Cancel booking', kind: 'danger-ghost', show: function (b) { return canCancelB(b) && O.can('bookings.cancel'); }, disabled: function (b) { return otaLocked(b) ? otaWhy(b, 'Cancel') : ''; }, run: function (b) { cancelBooking(b, function () {}); } }
    );
  }
  /* Local guard on core's booking drawer until core does this itself (see docs/notes/v4-bookings-calendar.md):
     "name · location" for the property, masked contacts without bookings.contacts, no money without bookings.value,
     and no buttons the viewer may not use. */
  function scrubDrawer(dr, b) {
    var p = D.propById[b.propertyId], body = O.$('.modal-body', dr.el); if (!body) return;
    var sub = O.$('.modal-head .sub', dr.el); if (sub) sub.textContent = b.id + ' · ' + (p ? propLabel(p) : O.bookingPlace(b));
    O.$$('.kv dt', body).forEach(function (dt) {
      if (dt.textContent === 'Property' && p && dt.nextElementSibling) dt.nextElementSibling.textContent = propLabel(p);
    });
    function section(title) {
      return O.$$('.section-title', body).filter(function (x) { return x.textContent.trim().toLowerCase() === title; }).map(function (x) { return x.parentNode; })[0];
    }
    if (!canContacts()) {
      var g = section('guest'), line = g && O.$('.small.muted', g);
      if (line) line.textContent = [b.guest.countryName, maskPhone(b.guest.phone), maskEmail(b.guest.email)].filter(Boolean).join(' · ');
    }
    if (!canValue()) {
      var pay = section('payment'); if (pay) pay.remove();
      var inv = section('invoice & receipt'); if (inv) inv.remove();
    } else {
      if (!O.can('invoices.send')) O.$$('[data-act=sendboth]', body).forEach(function (x) { x.remove(); });
      if (!b.paidAt && !O.can('invoices.payments')) O.$$('[data-act=rcp]', body).forEach(function (x) { x.remove(); });
    }
    if (!O.can('bookings', 'edit')) O.$$('[data-act=verify]', body).forEach(function (x) { x.remove(); });
    if (!O.can('guestapp.doorCodes')) {
      O.$$('[data-act=lock]', body).forEach(function (x) {
        var row = x.parentNode; x.remove();
        O.$$('.kbd', row).forEach(function (k) { var sp = k.parentNode; if (sp && sp !== row) sp.remove(); else k.remove(); });
        if (!row.children.length) row.remove();
      });
    }
    if (!O.can('inbox')) O.$$('[data-act=chat]', body).forEach(function (x) { x.remove(); });
    if (!p) O.$$('[data-act=lock]', body).forEach(function (x) { x.remove(); }); /* no unit yet, so no lock to change */
    unitSection(dr, b, body);
  }
  /* ---------------- unit of a typed booking ----------------
     A booking sold as a unit type ("Deluxe") gets a unit from Orbique (O.assignBooking, best fit). The drawer shows which unit,
     how it was chosen and whether it is held there; the team can pick another unit by hand (held from then on) or let
     Orbique pick again. */
  var LOCK_TXT = {
    manual: 'Held here: a person picked this unit, so automatic assignment leaves it alone.',
    in_house: 'Held here: the guest is in-house.',
    code_sent: 'Held here: the door code was already sent.',
    revealed: 'Held here: the guest can already see the unit number.'
  };
  function lockOf(b) { var p = D.propById[b.propertyId]; return O.assign.lockReason(b, D.NOW, (p && p.checkInTime) || null); }
  function whoName(id) { var s = id && D.staffById && D.staffById(id); return s ? s.name : ''; }
  function unitSection(dr, b, body) {
    var t = O.unitType(b.unitTypeId); if (!t) return;
    var old = O.$('.bk-unit', body); if (old) old.remove();
    var p = D.propById[b.propertyId], bd = O.building(t.buildingId), a = b.assignment || {}, lk = p ? lockOf(b) : null;
    var how = !p ? 'No single ' + t.name + ' unit is free for the whole stay. Pick one by hand, or free a unit and let Orbique pick again.'
      : a.how === 'manual' ? 'Picked by ' + (whoName(a.by) || 'the team') + (a.at ? ' on ' + d.fmt(String(a.at).slice(0, 10)) : '') + '.'
        : 'Picked by Orbique: the unit that leaves the smallest gaps between stays.';
    var canMove = O.can('bookings.edit') && canEditB(b);
    var html = '<div class="bk-unit"><div class="section-title" style="margin-top:0">Unit</div>' +
      '<div class="bu-top">' + (p ? '<b class="bu-no">' + esc(p.unitNo ? 'Unit ' + p.unitNo : propName(p)) + '</b>' : '<span class="pill bad">Needs a unit</span>') +
      '<span class="small muted">' + esc(t.name + (bd ? ' · ' + bd.name : '')) + (p && p.unitTypeId && p.unitTypeId !== t.id ? ' · ' + esc('in a ' + ((O.unitType(p.unitTypeId) || {}).name || 'other') + ' unit') : '') + '</span></div>' +
      '<div class="small muted bu-how">' + esc(how) + (lk ? ' ' + esc(LOCK_TXT[lk] || '') : p ? ' It can still move to another ' + esc(t.name) + ' unit if that makes room for other guests.' : '') + '</div>' +
      (canMove ? '<div class="row-flex wrap" style="margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" data-unit="pick">' + O.icon('home') + (p ? 'Change unit' : 'Pick a unit') + '</button>' +
        '<button type="button" class="btn btn-quiet btn-sm" data-unit="auto">' + O.icon('refresh') + 'Re-assign</button></div>' : '') + '</div>';
    var anchor = O.$('.card', body);
    if (anchor) anchor.insertAdjacentHTML('afterend', html); else body.insertAdjacentHTML('afterbegin', html);
    O.$$('[data-unit]', body).forEach(function (x) { x.onclick = function () { if (x.dataset.unit === 'pick') unitPicker(b); else reassign(b); }; });
  }
  function clashText(pid, b) {
    var x = D.bookings.filter(function (o) { return o !== b && o.propertyId === pid && live(o) && o.checkIn < b.checkOut && b.checkIn < o.checkOut; })[0];
    if (x) return x.guest.name + ' ' + d.fmtRange(x.checkIn, x.checkOut);
    var k = (D.blocks || []).filter(function (o) { return o.propertyId === pid && o.start < b.checkOut && b.checkIn < o.end; })[0];
    return k ? 'Blocked ' + d.fmtRange(k.start, d.add(k.end, -1)) : '';
  }
  function unitPicker(b) {
    var t = O.unitType(b.unitTypeId); if (!t) return;
    if (!O.can('bookings.edit')) { U.toast(NO.edit, 'bad'); return; }
    var others = O.typesOf(t.buildingId).filter(function (x) { return x.id !== t.id; });
    var best = O.assignBooking(b, { fresh: true, ignoreLock: true, dry: true }).unitId;
    function row(p) {
      var busy = p.id === b.propertyId ? '' : clashText(p.id, b), cur = p.id === b.propertyId;
      return '<label class="bu-opt' + (busy ? ' off' : '') + '"><input type="radio" name="unit" value="' + esc(p.id) + '"' + (busy ? ' disabled' : '') + (cur ? ' checked' : '') + '>' +
        '<span class="grow"><b>' + esc(p.unitNo ? 'Unit ' + p.unitNo : propName(p)) + '</b><span class="small muted">' + esc(cur ? 'Current unit' : busy ? 'Taken: ' + busy : p.id === best ? 'Free · best fit' : 'Free for the whole stay') + '</span></span></label>';
    }
    var body = '<div class="stack"><div class="bu-list">' + O.unitsOfType(t.id).map(row).join('') + '</div>' +
      (others.length ? '<div class="section-title" style="margin:6px 0 0">Another type (upgrade or move)</div><div class="bu-list">' + others.map(function (x) { return O.unitsOfType(x.id).map(function (p) { return row(p).replace('</b>', ' · ' + esc(x.name) + '</b>'); }).join(''); }).join('') + '</div>' : '') +
      '<div class="xs muted">Picking a unit holds the booking there: automatic assignment will not move it. The guest sees the unit number from 30 minutes before check-in.</div></div>';
    U.modal({ title: 'Choose a unit', sub: b.guest.name + ' · ' + t.name + ' · ' + d.fmtRange(b.checkIn, b.checkOut), body: body, actions: [{ label: 'Cancel' }, { label: 'Use this unit', kind: 'primary', onClick: function (close, el) {
      var c = O.$('[name=unit]:checked', el); if (!c) { U.toast('Choose a unit.', 'bad'); return false; }
      var p = D.propById[c.value]; if (!p) return false;
      if (p.id === b.propertyId) { if (!(b.assignment && b.assignment.how === 'manual')) { O.pickUnit(b, p.id); O.emit('data', { type: 'booking', bookingId: b.id }); U.toast(b.guest.name + ' is held in ' + (p.unitNo || p.name) + '.'); } return; }
      var go = function () {
        var lk = b.propertyId ? lockOf(b) : null;
        O.pickUnit(b, p.id);
        var moves = O.reassignUnits(); /* the unit it left may take a booking that had none */
        O.emit('data', { type: 'booking', bookingId: b.id });
        U.toast(b.guest.name + ' moved to ' + (p.unitNo ? 'unit ' + p.unitNo : p.name) + '.' + (lk === 'code_sent' || lk === 'revealed' || lk === 'in_house' ? ' Tell the guest: they may already have the old unit number.' : '') + (moves.length ? ' ' + fmt.plural(moves.length, 'other booking') + ' also moved or got a unit.' : ''));
      };
      var lk0 = b.propertyId ? lockOf(b) : null;
      if (p.unitTypeId !== t.id || lk0 === 'code_sent' || lk0 === 'revealed' || lk0 === 'in_house') {
        U.confirm((p.unitTypeId !== t.id ? 'This guest booked ' + t.name + '. ' + (p.unitNo || p.name) + ' is ' + ((O.unitType(p.unitTypeId) || {}).name || 'another type') + '. ' : '') + (lk0 && lk0 !== 'manual' ? LOCK_TXT[lk0] + ' ' : '') + 'Move them anyway?', 'Move guest', 'primary', 'Move ' + b.guest.name + ' to ' + (p.unitNo || p.name) + '?').then(function (ok) { if (ok) go(); });
      } else go();
    } }] });
  }
  function reassign(b) {
    var t = O.unitType(b.unitTypeId); if (!t) return;
    if (!O.can('bookings.edit')) { U.toast(NO.edit, 'bad'); return; }
    var run = function () {
      var before = b.propertyId, res = O.assignBooking(b, { fresh: true, ignoreLock: true }), p = D.propById[res.unitId];
      O.emit('data', { type: 'booking', bookingId: b.id });
      if (!p) U.toast('No single ' + t.name + ' unit is free for the whole stay, so ' + b.guest.name + ' still needs a unit.', 'bad');
      else if (p.id === before) U.toast((p.unitNo || p.name) + ' is still the best fit. Orbique may move the booking later if that makes room.');
      else U.toast(b.guest.name + ' is now in ' + (p.unitNo ? 'unit ' + p.unitNo : p.name) + ', the best fit.');
    };
    var lk = b.propertyId ? lockOf(b) : null;
    if (lk) U.confirm(LOCK_TXT[lk] + ' Let Orbique pick the best unit again? It may move the guest and will no longer hold this unit.', 'Re-assign', 'primary', 'Re-assign ' + b.guest.name + '?').then(function (ok) { if (ok) run(); });
    else run();
  }

  /* a booking whose property was removed: a plain summary instead of the drawer */
  function infoModal(b) {
    U.modal({
      title: b.guest.name, sub: b.id + ' · property no longer in the list',
      body: '<dl class="kv"><dt>Stay</dt><dd>' + d.fmtY(b.checkIn) + ' → ' + d.fmtY(b.checkOut) + '</dd><dt>Nights · guests</dt><dd>' + b.nights + ' · ' + b.guests + '</dd><dt>Platform</dt><dd>' + esc(U.platName(b.channel)) + '</dd><dt>Status</dt><dd>' + esc(U.statusLabel(b.status)) + '</dd></dl>',
      actions: [{ label: 'Close' }]
    });
  }

  /* copy the guest-app link (one link per booking, no sign-in) */
  function copyLink(b) {
    if (!canLink()) { U.toast(NO.link, 'bad'); return; }
    var had = !!b.guestToken, url = O.guestLink(b);
    if (!had) O.emit('data', { type: 'booking', bookingId: b.id }); /* a new token was just created: save it */
    function fallback() {
      U.modal({
        title: 'Guest app link', sub: b.guest.name + ' · ' + d.fmtRange(b.checkIn, b.checkOut),
        body: '<div class="stack"><div class="small muted">Copy this link and send it to the guest. It opens their stay guide, check-in steps and door code (once their ID is verified).</div><div class="bk-linkbox"><input class="input" readonly value="' + esc(url) + '" aria-label="Guest app link"></div></div>',
        actions: [{ label: 'Done', kind: 'primary' }],
        onOpen: function (el) { var i = O.$('input', el); setTimeout(function () { try { i.focus(); i.select(); } catch (e) { /* ignore */ } }, 40); }
      });
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { U.toast('Guest app link for ' + b.guest.name + ' copied'); }, fallback);
      else fallback();
    } catch (e) { fallback(); }
  }

  /* cancel a booking: frees the dates on every platform */
  function cancelBooking(b, done) {
    if (!O.can('bookings.cancel')) { U.toast(NO.cancel, 'bad'); return; }
    if (!canCancelB(b)) { U.toast('Only upcoming bookings can be cancelled', 'bad'); return; }
    if (otaLocked(b)) { U.toast(otaWhy(b, 'Cancel'), 'bad'); return; }
    var p = D.propById[b.propertyId];
    var paidNote = b.paidAt && canValue() ? ' The guest paid ' + fmt.money(b.total, { cur: b }) + ': arrange any refund with them' + (b.channel === 'direct' ? '' : ' on ' + U.platName(b.channel)) + '.' : '';
    U.modal({
      title: 'Cancel this booking?', sub: b.id + ' · ' + b.guest.name, size: 'sm',
      body: '<p style="margin:0;line-height:1.5">' + esc(b.guest.name + ' at ' + (p ? propName(p) : O.bookingPlace(b)) + ', ' + d.fmtRange(b.checkIn, b.checkOut) + '. The nights open again on every platform and the door code stops working.' + paidNote) + '</p>',
      autofocus: false,
      actions: [{ label: 'Keep booking' }, {
        label: 'Cancel booking', kind: 'danger', onClick: function () {
          b.status = 'cancelled'; b.cancelledAt = D.TODAY; b.cancelledBy = O.state.viewer;
          if (b.codeStatus) b.codeStatus = 'cancelled';
          if (b.unitTypeId || (p && p.unitTypeId)) O.reassignUnits(); /* the freed unit may take a booking that had none */
          if (O.automation && O.automation.run) O.automation.run('booking');
          O.emit('data', { type: 'booking', bookingId: b.id });
          U.toast('Booking ' + b.id + ' for ' + b.guest.name + ' cancelled. ' + (p ? p.short || p.name : 'The unit') + ' is open again for ' + d.fmtRange(b.checkIn, b.checkOut) + '.');
          if (done) done(b);
        }
      }]
    });
  }

  /* bookings and blocks that overlap [ci, co) at a property, except the booking being edited */
  function conflictsFor(pid, ci, co, skip) {
    var out = [];
    D.bookings.forEach(function (b) {
      if (b !== skip && b.propertyId === pid && live(b) && b.checkIn < co && ci < b.checkOut) out.push(b.guest.name + ' is booked ' + d.fmtRange(b.checkIn, b.checkOut) + ' (' + U.platName(b.channel) + ')');
    });
    (D.blocks || []).forEach(function (x) {
      if (x.propertyId === pid && x.start < co && ci < x.end) out.push('Blocked ' + d.fmtRange(x.start, x.end) + ' for ' + (x.type === 'owner' ? 'an owner stay' : 'maintenance') + (x.note ? ' (' + x.note + ')' : ''));
    });
    return out;
  }
  /* keep D.bookings ordered by check-in (in place: other pages and metrics hold this array) */
  function placeSorted(b) {
    var i = D.bookings.indexOf(b); if (i >= 0) D.bookings.splice(i, 1);
    var at = 0; while (at < D.bookings.length && D.bookings[at].checkIn <= b.checkIn) at++;
    D.bookings.splice(at, 0, b);
  }
  function reprice(b, p) { /* money follows nights and unit; the nightly price stays what the guest agreed */
    b.accommodation = Math.round((b.nightly || 0) * b.nights);
    b.cleaningFee = b.cleaningFee != null && p.id === b.propertyId ? b.cleaningFee : cleaningFor(p);
    b.tourismTax = b.guest.foreign && O.tourismTaxApplies(p) ? 10 * b.nights : 0;
    b.total = b.accommodation + b.cleaningFee + b.tourismTax;
    b.platformFee = Math.round(b.accommodation * feePct(b.channel));
    b.payout = b.total - b.platformFee;
    b.revenue = b.accommodation + b.cleaningFee;
  }

  /* ---------------- unit picker of the booking forms ----------------
     Untagged units are listed as before. With unit types, each type gets a group that starts with "Any free Deluxe unit":
     Orbique then picks the best-fit unit (and may move it later). Choosing a unit of a type holds the booking there. */
  function typeSel(v) { v = String(v || ''); return v.indexOf('type:') === 0 ? v.slice(5) : null; }
  function liveTypesOf(props) { return D.unitTypes.filter(function (t) { return !t.archived && props.some(function (p) { return p.unitTypeId === t.id; }); }); }
  function unitOptions(props, selected) {
    var types = liveTypesOf(props);
    var opt = function (p, lbl) { return '<option value="' + esc(p.id) + '"' + (p.id === selected ? ' selected' : '') + '>' + esc(lbl || propLabel(p)) + '</option>'; };
    if (!types.length) return props.map(function (p) { return opt(p); }).join('');
    var tids = {}; types.forEach(function (t) { tids[t.id] = 1; });
    return props.filter(function (p) { return !tids[p.unitTypeId]; }).map(function (p) { return opt(p); }).join('') + types.map(function (t) {
      var us = props.filter(function (p) { return p.unitTypeId === t.id; }).sort(function (a, b) { return O.assign.naturalCompare(a.unitNo || a.name, b.unitNo || b.name); });
      return '<optgroup label="' + esc(O.typeTitle(t)) + '"><option value="type:' + esc(t.id) + '"' + (selected === 'type:' + t.id ? ' selected' : '') + '>Any free ' + esc(t.name) + ' unit (Orbique picks)</option>' +
        us.map(function (p) { return opt(p, (p.unitNo ? 'Unit ' + p.unitNo + ' · ' : '') + propName(p)); }).join('') + '</optgroup>';
    }).join('');
  }
  /* what a choice in the picker means for these dates: {p (unit for prices and limits), typeId, auto, unitId} */
  function resolveUnit(val, ci, co, b) {
    var tid = typeSel(val);
    if (!tid) { var q = D.propById[val]; return { p: q, typeId: q && O.unitType(q.unitTypeId) ? q.unitTypeId : null, auto: false, unitId: q ? q.id : null }; }
    var cur = b && D.propById[b.propertyId], ok = ci && co && co > ci;
    var sh = { id: b ? b.id : '_new', unitTypeId: tid, propertyId: cur && cur.unitTypeId === tid ? cur.id : null, checkIn: ci, checkOut: co, status: 'confirmed' };
    var res = ok ? O.assign.assignUnits({ booking: sh, units: D.properties, bookings: D.bookings, blocks: D.blocks || [], now: D.NOW, ignoreLock: true }) : null;
    var p = res && D.propById[res.unitId];
    return { p: p || cur || O.unitsOfType(tid)[0], typeId: tid, t: O.unitType(tid), auto: true, unitId: p ? p.id : null };
  }
  function unitWord(p) { return p ? (p.unitNo ? 'unit ' + p.unitNo : (p.short || p.name)) : ''; }

  /* ---------------- edit booking ---------------- */
  function editBooking(b) {
    if (!O.can('bookings.edit')) { U.toast(NO.edit, 'bad'); return; }
    if (!canEditB(b)) { U.toast('Completed and cancelled bookings cannot be changed', 'bad'); return; }
    var T = D.TODAY, inHouse = b.status === 'checked_in' || b.checkIn < T, contacts = canContacts(), money = canValue(), ota = otaLocked(b);
    function f(label, input, cls, hint) { return '<div class="field ' + (cls || '') + '"><label>' + label + '</label>' + input + (hint || '') + '</div>'; }
    var props = D.properties.filter(function (p) { return !isArchived(p) || p.id === b.propertyId; });
    var body = O.html('<div class="nb-wrap"><div class="stack">' +
      '<div class="nb-sec">Stay</div><div class="form-grid">' +
      f('Property', '<select class="select" name="pid"' + (inHouse ? ' disabled' : '') + '>' + unitOptions(props, b.unitTypeId && O.unitType(b.unitTypeId) && !inHouse && !(b.assignment && b.assignment.locked) && !(b.propertyId && lockOf(b)) ? 'type:' + b.unitTypeId : b.propertyId) + '</select>', 'full', inHouse ? '<div class="hint">The guest is already in-house, so the unit and check-in date stay as they are.</div>' : '') +
      f('Check-in', '<input type="date" class="input" name="ci" value="' + b.checkIn + '"' + (inHouse || ota ? ' disabled' : ' min="' + T + '"') + '>') +
      f('Check-out', '<input type="date" class="input" name="co" value="' + b.checkOut + '"' + (ota ? ' disabled' : '') + ' min="' + d.add(inHouse ? T : b.checkIn, 1) + '">', '', ota ? '<div class="hint">' + esc(otaWhy(b)) + '</div>' : '') +
      f('Arrival time', '<input type="time" class="input" name="tin" value="' + esc(b.checkInTime || '15:00') + '">') +
      f('Departure time', '<input type="time" class="input" name="tout" value="' + esc(b.checkOutTime || '11:00') + '">') +
      f('Guests', '<input type="number" class="input" name="guests" min="1" value="' + b.guests + '">', '', '<div class="hint nb-maxg"></div>') +
      '</div><div class="nb-sec">Guest</div><div class="form-grid">' +
      f('Guest name', '<input class="input" name="name" autocomplete="off" value="' + esc(b.guest.name) + '">', 'full') +
      (contacts ? f('Phone (WhatsApp)', '<input class="input" name="phone" inputmode="tel" autocomplete="off" value="' + esc(b.guest.phone || '') + '">') + f('Email', '<input class="input" name="email" type="email" autocomplete="off" value="' + esc(b.guest.email || '') + '">')
        : f('Phone', '<input class="input" disabled value="' + esc(maskPhone(b.guest.phone)) + '">') + f('Email', '<input class="input" disabled value="' + esc(maskEmail(b.guest.email)) + '">', '', '<div class="hint">Contact details are hidden for your access.</div>')) +
      f('Note', '<textarea class="textarea" name="notes" rows="2" placeholder="Optional: arrival details or requests">' + esc(b.notes || '') + '</textarea>', 'full') +
      '</div><div class="nb-err" role="alert"></div></div>' +
      '<div class="nb-side"><div class="nb-avail"></div><div class="nb-sum"></div>' + (ota ? '<div class="nb-proto">' + esc(U.platName(b.channel) + (b.reservationCode ? ' reservation ' + b.reservationCode : ' booking') + '. Dates and price: ' + otaWhy(b).charAt(0).toLowerCase() + otaWhy(b).slice(1)) + ' You can still change the unit, times, guests and notes.</div>' : b.channel !== 'direct' ? '<div class="nb-proto">Booked on ' + esc(U.platName(b.channel)) + ': make the same change there so both calendars match.</div>' : '') + '</div></div>');
    var $ = function (s) { return O.$(s, body); };
    function vals() {
      return { pid: $('[name=pid]').value, ci: $('[name=ci]').value, co: $('[name=co]').value, guests: +$('[name=guests]').value || 0, tin: $('[name=tin]').value || '15:00', tout: $('[name=tout]').value || '11:00',
        name: $('[name=name]').value.trim(), phone: contacts ? $('[name=phone]').value.trim() : b.guest.phone, email: contacts ? $('[name=email]').value.trim() : b.guest.email, notes: $('[name=notes]').value.trim() };
    }
    function update() {
      var v = vals(), ok = v.ci && v.co && v.co > v.ci, r = resolveUnit(v.pid, v.ci, v.co, b), p = r.p || D.propById[b.propertyId];
      $('.nb-maxg').textContent = 'Up to ' + maxGuests(p) + ' guests';
      var nights = ok ? d.diff(v.ci, v.co) : 0;
      var cf = ok && !r.auto ? conflictsFor(v.pid, v.ci, v.co, b) : [];
      var changed = v.ci !== b.checkIn || v.co !== b.checkOut || (r.auto ? r.unitId !== (b.propertyId || null) : v.pid !== b.propertyId);
      var av = $('.nb-avail');
      if (ok && r.auto && !r.unitId) {
        av.className = 'nb-avail bad';
        av.innerHTML = '<b>No single ' + esc(r.t.name) + ' unit is free for all ' + fmt.plural(nights, 'night') + '.</b> You can still save: the booking waits under "' + esc(r.t.name) + ' · no unit yet" until you pick a unit.';
      } else {
        av.className = 'nb-avail ' + (!ok || cf.length ? 'bad' : changed ? 'ok' : 'info');
        av.innerHTML = !ok ? 'Check-out must be after check-in.' : cf.length ? '<b>Not available.</b> ' + esc(cf[0]) + (cf.length > 1 ? ' and ' + (cf.length - 1) + ' more.' : '.')
          : r.auto ? (r.unitId === b.propertyId ? '<b>Available.</b> The guest keeps ' + esc(unitWord(p)) + '.' : '<b>Available.</b> Orbique puts the guest in ' + esc(unitWord(p)) + ', the best fit.')
            : changed ? '<b>Available</b> for all ' + fmt.plural(nights, 'night') + ' at ' + esc(p.short || p.name) + '.' : 'Same dates and unit as now.';
      }
      var acc = Math.round((b.nightly || 0) * nights), clean = v.pid === b.propertyId ? b.cleaningFee : cleaningFor(p), tax = b.guest.foreign && O.tourismTaxApplies(p) ? 10 * nights : 0, tot = acc + clean + tax, mc = { cur: p };
      $('.nb-sum').innerHTML = '<h4>' + esc(propName(p)) + '</h4><div class="muted small">' + esc(place(p)) + '</div><div class="muted small">' + (ok ? d.fmtY(v.ci) + ' → ' + d.fmtY(v.co) + ' · ' + fmt.plural(nights, 'night') : 'Choose dates') + '</div>' +
        (money ? '<dl class="kv"><dt>' + nights + ' × ' + fmt.money(b.nightly, mc) + '</dt><dd>' + fmt.money(acc, mc) + '</dd><dt>Cleaning fee</dt><dd>' + fmt.money(clean, mc) + '</dd>' + (tax ? '<dt>Tourism tax</dt><dd>' + fmt.money(tax, mc) + '</dd>' : '') +
          '<dt class="tot">New total</dt><dd class="tot">' + fmt.money(tot, mc) + '</dd></dl>' + (ok && tot !== b.total ? '<div class="nb-docs" style="margin-top:8px">Was ' + fmt.money(b.total, { cur: b }) + '.' + (b.paidAt ? ' The guest has paid, so settle the difference of ' + fmt.money(Math.abs(tot - b.total), mc) + (tot > b.total ? ' with them.' : ' back to them.') : '') + '</div>' : '') : '');
    }
    body.addEventListener('input', function () { $('.nb-err').innerHTML = ''; update(); });
    body.addEventListener('change', function (e) {
      if (e.target.name === 'ci') { var co = $('[name=co]'); if (e.target.value && (!co.value || co.value <= e.target.value)) co.value = d.add(e.target.value, b.nights || 1); co.min = d.add(e.target.value || T, 1); }
      update();
    });
    update();
    U.modal({
      title: 'Edit booking', sub: b.id + ' · ' + b.guest.name, size: 'wide', body: body,
      actions: [{ label: 'Cancel' }, {
        label: 'Save changes', kind: 'primary', onClick: function () {
          var v = vals(), r = resolveUnit(v.pid, v.ci, v.co, b), p = r.p, err = [];
          if (!p) err.push('Choose a property.');
          if (!v.ci || !v.co || v.co <= v.ci) err.push('Check-out must be after check-in.');
          else if (p) {
            if (!inHouse && v.ci < D.TODAY && v.ci !== b.checkIn) err.push('Check-in cannot be in the past.');
            if (inHouse && v.co < D.TODAY) err.push('Check-out cannot be in the past.');
            if (d.diff(v.ci, v.co) > 90) err.push('A booking can be at most 90 nights.');
            var cf = r.auto ? [] : conflictsFor(v.pid, v.ci, v.co, b); if (cf.length) err.push((p.short || p.name) + ' is not available: ' + cf[0] + '.');
          }
          if (ota && (v.ci !== b.checkIn || v.co !== b.checkOut)) err.push(otaWhy(b));
          if (ota && b.unitTypeId && r.typeId !== b.unitTypeId && !(p && p.unitTypeId === b.unitTypeId)) err.push('This ' + U.platName(b.channel) + ' booking was sold as ' + ((O.unitType(b.unitTypeId) || {}).name || 'its unit type') + ', so it stays with that unit type.');
          if (!v.name) err.push('Enter the guest\'s name.');
          if (contacts && v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) err.push('The email address does not look right.');
          if (p && (v.guests < 1 || v.guests > maxGuests(p))) err.push('Guests must be between 1 and ' + maxGuests(p) + ' for this unit.');
          if (err.length) { $('.nb-err').innerHTML = '<b>Please check ' + (err.length === 1 ? 'this' : 'these') + ':</b><br>' + err.map(esc).join('<br>'); try { $('.nb-err').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (x) { /* ignore */ } return false; }
          var from = b.propertyId || null;
          var moved = v.ci !== b.checkIn || v.co !== b.checkOut || (r.auto ? r.unitId !== from : v.pid !== from);
          b.nights = d.diff(v.ci, v.co);
          if (!ota) reprice(b, p); /* a platform booking keeps the price the platform sent */
          b.checkIn = v.ci; b.checkOut = v.co; b.guests = v.guests; b.checkInTime = v.tin; b.checkOutTime = v.tout;
          if (r.auto) { b.unitTypeId = r.typeId; O.assignBooking(b, { ignoreLock: true }); } /* keeps the unit while it is still free */
          else if (r.typeId || b.unitTypeId) { if (v.pid !== from) O.pickUnit(b, v.pid); }
          else b.propertyId = v.pid;
          if (b.unitTypeId) O.reassignUnits(); /* a freed unit may now take a booking that had none */
          b.guest.name = v.name; b.notes = v.notes;
          if (contacts) { b.guest.phone = v.phone; b.guest.email = v.email; }
          b.updatedAt = D.NOW; b.updatedBy = O.state.viewer;
          if (moved) placeSorted(b);
          if (moved && O.automation && O.automation.run) O.automation.run('booking');
          reveal(b);
          O.emit('data', { type: 'booking', bookingId: b.id });
          U.toast('Booking ' + b.id + ' updated' + (moved ? ': ' + O.bookingPlace(b) + ', ' + d.fmtRange(b.checkIn, b.checkOut) : '') + '.' + (b.unitTypeId && !b.propertyId ? ' No unit is free for the whole stay yet, so pick one by hand.' : ''), b.unitTypeId && !b.propertyId ? 'bad' : undefined);
        }
      }]
    });
  }

  O.bookingTools = { open: openBooking, edit: editBooking, cancel: cancelBooking, copyLink: copyLink, propLabel: propLabel, place: place, propName: propName };

  /* ===================================================================
     New booking (direct), shared form: O.newBooking({propertyId, checkIn, checkOut, onCreated(b)})
     =================================================================== */
  function nextNo(field, prefix) {
    var max = O.raw('bookings').reduce(function (m, b) { var v = b[field]; return v ? Math.max(m, +String(v).split('-').pop() || 0) : m; }, 1000);
    return prefix + (max + 1);
  }
  /* invoices for platform bookings that the channel manager created on the server (they arrive without a number):
     the same numbering as direct bookings. Runs with the other automations and when such a booking arrives. */
  function channelInvoices() {
    if (!(O.isOwner() || O.can('bookings', 'edit'))) return 0;
    var n = 0, T = D.TODAY;
    D.bookings.forEach(function (b) {
      if (!b || !b.channex || b.invoiceNo || b.status === 'cancelled' || b.channel === 'direct') return;
      b.invoiceNo = nextNo('invoiceNo', 'INV-' + T.slice(0, 4) + '-'); n++;
    });
    return n;
  }
  O.automation.register('channel-invoices', function () { if (channelInvoices()) O.emit('data', { type: 'invoices' }); });
  var invT = null;
  O.on('remote', O.unscopedFn(function () {
    if (!D.bookings.some(function (b) { return b && b.channex && !b.invoiceNo && b.status !== 'cancelled'; })) return;
    clearTimeout(invT); invT = setTimeout(O.unscopedFn(function () { if (O.sync.canWrite() && channelInvoices()) O.emit('data', { type: 'invoices' }); }), 1500);
  }));

  O.newBooking = function (o) {
    o = o || {};
    var T = D.TODAY;
    if (!O.can('bookings.create')) { U.toast(NO.create, 'bad'); return; }
    var props = D.properties.filter(function (p) { return !isArchived(p); });
    if (!props.length) { U.toast('Add a unit first, then you can take bookings for it.', 'bad'); return; }
    var pid0 = o.propertyId && D.propById[o.propertyId] && !isArchived(D.propById[o.propertyId]) ? o.propertyId : null;
    var ci0 = o.checkIn && o.checkIn >= T ? o.checkIn : null;
    var co0 = ci0 && o.checkOut && o.checkOut > ci0 ? o.checkOut : null;
    /* no dates given: start on the first free 2-night window (of the chosen property, or of any property) */
    if (!ci0) {
      var cands = pid0 ? [pid0] : props.map(function (p) { return p.id; }), found = null;
      for (var off = 0; off < 120 && !found; off++) {
        var c = d.add(T, off);
        for (var k = 0; k < cands.length && !found; k++) if (!conflictsFor(cands[k], c, d.add(c, 2)).length) found = [cands[k], c];
      }
      if (found) { pid0 = found[0]; ci0 = found[1]; } else ci0 = T;
    }
    pid0 = pid0 || props[0].id;
    co0 = co0 || d.add(ci0, 2);
    var countries = Object.keys(D.countryName).sort(function (a, b) { return a === 'MY' ? -1 : b === 'MY' ? 1 : D.countryName[a].localeCompare(D.countryName[b]); });
    var methods = ['FPX online banking', 'Card (Visa)', 'DuitNow QR', 'Bank transfer', 'Cash'];
    function f(label, input, cls, hint) { return '<div class="field ' + (cls || '') + '"><label>' + label + '</label>' + input + (hint || '') + '</div>'; }
    var body = O.html('<div class="nb-wrap"><div class="stack">' +
      '<div class="nb-sec">Stay</div>' +
      '<div class="form-grid">' +
      f('Property', '<select class="select" name="pid">' + unitOptions(props, pid0) + '</select>', 'full') +
      f('Check-in', '<input type="date" class="input" name="ci" min="' + T + '" value="' + ci0 + '">') +
      f('Check-out', '<input type="date" class="input" name="co" min="' + d.add(T, 1) + '" value="' + co0 + '">') +
      f('Guests', '<input type="number" class="input" name="guests" min="1" value="2">', '', '<div class="hint nb-maxg"></div>') +
      f('Arrival time', '<input type="time" class="input" name="time" value="15:00">', '', '<div class="hint">Standard check-in is 3:00 PM</div>') +
      f('Nightly price (<span class="nb-cur">' + esc(fmt.cur(pid0)) + '</span>)', '<input type="number" class="input" name="price" min="1" step="5">', 'full', '<div class="hint nb-sugg"></div>') +
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
      (O.can('invoices.send') ? '<label class="check"><input type="checkbox" name="send"><span>Open the send window for the invoice after saving</span></label>' : '') +
      '<div class="nb-err" role="alert"></div>' +
      '</div><div class="nb-side"><div class="nb-avail"></div><div class="nb-sum"></div><div class="nb-proto">Direct bookings carry a 3% payment fee.</div></div></div>');
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
      if (!avg) return null;
      return { avg: avg, wk: wk.length ? Math.round(sum(wk, function (v) { return v; }) / wk.length) : null, we: we.length ? Math.round(sum(we, function (v) { return v; }) / we.length) : null };
    }
    function update() {
      var v = vals(), r = resolveUnit(v.pid, v.ci, v.co), p = r.p;
      $('.nb-maxg').textContent = 'Up to ' + maxGuests(p) + ' guests';
      var sg = suggestion(p.id, v.ci, v.co);
      if (sg && !priceDirty) $('[name=price]').value = sg.avg;
      v = vals();
      var mc = { cur: p }; $('.nb-cur').textContent = fmt.cur(p);
      $('.nb-sugg').innerHTML = sg ? '<span>Suggested <b>' + fmt.money(sg.avg, mc) + '</b> a night from your pricing' + (sg.wk && sg.we ? ' (weekdays ' + fmt.money(sg.wk, mc) + ', Fri–Sat nights ' + fmt.money(sg.we, mc) + ')' : '') + '.</span>' + (priceDirty && v.price !== sg.avg ? '<button type="button" class="btn btn-quiet btn-xs" data-use>Use suggested</button>' : '') : 'Enter the nightly price for this stay.';
      var foreign = v.country !== 'MY', ttax = O.tourismTaxApplies(p);
      $('.nb-tax').textContent = !ttax ? '' : foreign ? 'Tourism tax ' + fmt.money(10, mc) + ' per night applies' : 'No tourism tax for Malaysian guests';
      var ok = v.ci && v.co && v.co > v.ci, nights = ok ? d.diff(v.ci, v.co) : 0;
      var cf = !ok ? [] : r.auto ? (r.unitId ? [] : ['No single ' + r.t.name + ' unit is free for all of these nights']) : conflictsFor(v.pid, v.ci, v.co);
      var av = $('.nb-avail');
      av.className = 'nb-avail ' + (!ok ? 'bad' : cf.length ? 'bad' : 'ok');
      av.innerHTML = !ok ? 'Check-out must be after check-in.' : cf.length ? '<b>Not available.</b> ' + esc(cf[0]) + (cf.length > 1 ? ' and ' + (cf.length - 1) + ' more.' : '.')
        : r.auto ? '<b>Available</b> for all ' + fmt.plural(nights, 'night') + '. Orbique puts the guest in ' + esc(unitWord(p)) + ', the best fit.' : '<b>Available</b> for all ' + fmt.plural(nights, 'night') + ' at ' + esc(p.short || p.name) + '.';
      var acc = nights * v.price, clean = cleaningFor(p), tax = foreign && ttax ? 10 * nights : 0;
      var invNo = nextNo('invoiceNo', 'INV-' + T.slice(0, 4) + '-');
      $('.nb-sum').innerHTML = '<h4>' + esc(propName(p)) + '</h4><div class="muted small">' + esc(place(p)) + '</div><div class="muted small">' + (ok ? d.fmtY(v.ci) + ' → ' + d.fmtY(v.co) + ' · ' + fmt.plural(nights, 'night') : 'Choose dates') + '</div>' +
        '<dl class="kv"><dt>' + nights + ' × ' + fmt.money(v.price, mc) + '</dt><dd>' + fmt.money(acc, mc) + '</dd><dt>Cleaning fee</dt><dd>' + fmt.money(clean, mc) + '</dd>' + (tax ? '<dt>Tourism tax</dt><dd>' + fmt.money(tax, mc) + '</dd>' : '') +
        '<dt class="tot">Guest pays</dt><dd class="tot">' + fmt.money(acc + clean + tax, mc) + '</dd></dl>' +
        '<div class="nb-docs" style="margin-top:10px">Invoice <b>' + esc(invNo) + '</b> is created automatically when you save.' +
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

    U.modal({
      title: 'New direct booking', sub: 'The invoice is created automatically from the booking and guest details.', size: 'wide', body: body,
      actions: [{ label: 'Cancel' }, {
        label: 'Create booking', kind: 'primary', onClick: function () {
          var v = vals(), r = resolveUnit(v.pid, v.ci, v.co), p = r.p, err = [], now = D.TODAY;
          if (!v.ci || !v.co || v.co <= v.ci) err.push('Check-out must be after check-in.');
          else {
            if (v.ci < now) err.push('Check-in cannot be in the past.');
            if (d.diff(v.ci, v.co) > 60) err.push('A direct booking can be at most 60 nights.');
            if (r.auto) { if (!r.unitId) err.push('No single ' + r.t.name + ' unit is free for all of these nights. Try other dates or another type.'); }
            else { var cf = conflictsFor(v.pid, v.ci, v.co); if (cf.length) err.push((p.short || p.name) + ' is not available: ' + cf[0] + '.'); }
          }
          if (!v.name) err.push('Enter the guest\'s name.');
          if (!v.phone && !v.email) err.push('Enter a phone number or an email so the invoice can be sent.');
          if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) err.push('The email address does not look right.');
          if (v.guests < 1 || v.guests > maxGuests(p)) err.push('Guests must be between 1 and ' + maxGuests(p) + ' for this unit.');
          if (!(v.price > 0)) err.push('Enter the nightly price.');
          if (err.length) {
            var eb = $('.nb-err'); eb.innerHTML = '<b>Please check ' + (err.length === 1 ? 'this' : 'these') + ':</b><br>' + err.map(esc).join('<br>');
            try { eb.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (x) { /* ignore */ }
            var first = !v.name ? '[name=name]' : (!v.phone && !v.email) ? '[name=phone]' : (v.email && err.join(' ').indexOf('email') >= 0) ? '[name=email]' : null;
            if (first) try { $(first).focus({ preventScroll: true }); } catch (x) { /* ignore */ }
            return false;
          }
          var made = createBooking(v, paid ? $('[name=method]').value : null, o.onCreated);
          var sendBox = $('[name=send]');
          if (sendBox && sendBox.checked) setTimeout(function () { O.invoice.send(made, made.paidAt ? ['invoice', 'receipt'] : ['invoice']); }, 50);
        }
      }]
    });
  };

  function createBooking(v, payMethod, onCreated) {
    var T = D.TODAY, r = resolveUnit(v.pid, v.ci, v.co), p = r.p, nights = d.diff(v.ci, v.co), foreign = v.country !== 'MY';
    var b = {
      id: O.uid('BK'), propertyId: p.id,
      guest: { name: v.name, country: v.country, countryName: D.countryName[v.country] || v.country, foreign: foreign, phone: v.phone || '', email: v.email || '' },
      guests: v.guests, channel: 'direct', checkIn: v.ci, checkOut: v.co, nights: nights,
      checkInTime: v.time, checkOutTime: p.checkOutTime || '11:00', createdAt: D.NOW, createdBy: O.state.viewer,
      nightly: Math.round(v.price), cleaningFee: cleaningFor(p),
      status: 'confirmed', idVerified: false, codeStatus: 'held', sameDay: v.ci === T, notes: v.notes || ''
    };
    reprice(b, p);
    b.invoiceNo = nextNo('invoiceNo', 'INV-' + T.slice(0, 4) + '-');
    b.invoiceDate = T; b.paidAt = null; b.receiptNo = null; b.payMethod = null; b.invoiceSent = null; b.receiptSent = null;
    O.bookingDefaults(b); /* door code + guest link token */
    placeSorted(b);
    if (r.typeId) { /* sold as a unit type: Orbique picks the unit (best fit), or the person picked one and it is held there */
      b.unitTypeId = r.typeId;
      if (r.auto) { b.propertyId = null; O.assignBooking(b); } else O.pickUnit(b, p.id);
    }
    /* background jobs (Tasks & cleaning) create the check-in readiness and turnover tasks for it */
    if (O.automation && O.automation.run) O.automation.run('booking');
    var taskMsg = '';
    if (b.sameDay) {
      var tk = D.tasks.filter(function (t) { return t.bookingId === b.id && String(t.due).slice(0, 10) === T; })[0];
      var hk = tk && tk.assigneeId && D.staffById(tk.assigneeId);
      if (tk) taskMsg = ' ' + (tk.title || 'Unit check') + ' assigned to ' + (hk ? hk.name : 'housekeeping') + '.';
    }
    if (onCreated) onCreated(b);
    if (payMethod) O.invoice.markPaid(b, payMethod); /* creates the receipt and refreshes every view */
    else O.emit('data', { type: 'booking', bookingId: b.id });
    U.toast('Booking created for ' + b.guest.name + '. Invoice ' + b.invoiceNo + (b.receiptNo ? ' and receipt ' + b.receiptNo + ' created.' : ' created automatically.') + taskMsg);
    return b;
  }
})();
