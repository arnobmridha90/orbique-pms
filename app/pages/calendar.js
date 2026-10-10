/* Calendar: every property on one timeline.
   Default window: today plus the next 6 days. Step back or forward by 7 days, jump to today, or pick any start date.
   Desktop can show 7, 14 or 30 days (remembered on this device); phones always show 7 days, in portrait and landscape.
   Sticky property column ("name · location"), bars coloured by booking status with the platform mark, hatched blocks.
   Tap a bar to open the booking; tap a free night to add a booking or block dates (calendar.block).
   Exposes O.blockDates(opts) for other sections. */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  var MIN_DW = 22;                       /* below this the timeline scrolls sideways instead of squeezing */
  var LENGTHS = [7, 14, 30];
  var STEP = 7;
  var PHONE_Q = '(max-width:760px), (max-height:500px) and (max-width:960px)';
  var LEGEND = [['confirmed', 'confirmed', 'Confirmed'], ['checked_in', 'inhouse', 'In-house'], ['pending', 'pending', 'Pending'], ['checked_out', 'past', 'Checked out']];

  var st = { start: null, prop: '', flash: null, scroll: null };

  O.css('calendar', `
.pg-calendar{--pc:210px;}
.pg-calendar .cal-tools{display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:12px;}
.pg-calendar .cal-nav{display:inline-flex; align-items:center; gap:4px; min-width:0;}
.pg-calendar .cal-nav .icon-btn{flex:none;}
.pg-calendar .cal-nav .icon-btn svg{width:16px; height:16px;}
.pg-calendar .cal-pick{position:relative; display:inline-flex; align-items:center; gap:8px; height:36px; padding:0 11px; background:var(--surface); border:1px solid var(--border); border-radius:9px; font-size:13px; font-weight:700; white-space:nowrap; cursor:pointer; min-width:0;}
.pg-calendar .cal-pick:hover{border-color:var(--border-strong);}
.pg-calendar .cal-pick:focus-within{outline:2px solid var(--brand-strong); outline-offset:1px;}
.pg-calendar .cal-pick svg{width:15px; height:15px; color:var(--muted); flex:none;}
.pg-calendar .cal-pick .lbl{overflow:hidden; text-overflow:ellipsis;}
.pg-calendar .cal-pick input{position:absolute; inset:0; width:100%; height:100%; opacity:0; border:none; padding:0; margin:0; cursor:pointer; font-size:16px;}
.pg-calendar .cal-pick input::-webkit-calendar-picker-indicator{position:absolute; inset:0; width:100%; height:100%; margin:0; padding:0; cursor:pointer;}
.pg-calendar .cal-today{height:36px;}
.pg-calendar .cal-len button{padding:5px 10px; font-size:12px;}
.pg-calendar .cal-tools .select{width:auto; min-width:180px; max-width:260px; height:36px; padding-top:0; padding-bottom:0;}
.pg-calendar .cal-tools .sp{flex:1 1 0;}
.pg-calendar .cal-act{display:none;}
.pg-calendar .cal-card{overflow:hidden;}
.pg-calendar .cal-empty{padding:34px 16px; text-align:center; color:var(--muted); font-size:13px;}
.pg-calendar .cal-empty > svg{width:26px; height:26px; color:var(--faint);}
.pg-calendar .cal-empty .btn{margin-top:12px;}

/* the timeline */
.pg-calendar .cal-scroll{position:relative; overflow:auto; max-height:calc(100vh - 200px); overscroll-behavior-x:contain;}
.pg-calendar .cal-track{position:relative;}
.pg-calendar .cal-hd{display:flex; position:sticky; top:0; z-index:6; background:var(--surface); border-bottom:1px solid var(--border-strong);}
.pg-calendar .cal-corner{position:sticky; left:0; z-index:7; width:var(--pc); flex:none; background:var(--surface); border-right:1px solid var(--border-strong); padding:6px 8px 7px 14px; display:flex; flex-direction:column; justify-content:flex-end; font-size:11px; font-weight:700; color:var(--muted); white-space:nowrap; overflow:hidden;}
.pg-calendar .cal-days{position:relative; flex:none; height:52px;}
.pg-calendar .cal-mo{position:absolute; top:0; height:20px; display:flex; align-items:center; padding-left:7px; font-size:11px; font-weight:800; color:var(--text-2); border-left:1px solid var(--border-strong); white-space:nowrap; overflow:hidden;}
.pg-calendar .cal-mo:first-child{border-left:none;}
.pg-calendar .cal-d{position:absolute; top:20px; height:32px; display:flex; flex-direction:column; align-items:center; justify-content:center; border-left:1px solid var(--c-grid); font-variant-numeric:tabular-nums; line-height:1.1; gap:1px;}
.pg-calendar .cal-d .w{font-size:9.5px; font-weight:700; color:var(--faint); text-transform:uppercase; letter-spacing:0.03em;}
.pg-calendar .cal-d .n{font-size:12.5px; font-weight:800; color:var(--text-2); border-radius:5px; padding:0 4px; min-width:20px; text-align:center;}
.pg-calendar .cal-d.we{background:var(--bg);}
.pg-calendar .cal-d.today .n{background:var(--brand); color:var(--brand-ink);}
.pg-calendar .cal-d.today .w{color:var(--brand-text);}
.pg-calendar .cal-body{position:relative;}
.pg-calendar .cal-cols{position:absolute; top:0; bottom:0; pointer-events:none; z-index:0;}
.pg-calendar .cal-cols i{position:absolute; top:0; bottom:0;}
.pg-calendar .cal-cols .we{background:var(--bg);}
.pg-calendar .cal-cols .gl{width:1px; background:var(--c-grid);}
.pg-calendar .cal-cols .td{background:var(--brand-soft-2);}
.pg-calendar .cal-cols .now{width:2px; margin-left:-1px; background:var(--brand-strong); opacity:0.85;}
.pg-calendar .cal-row{display:flex; position:relative; z-index:1; border-bottom:1px solid var(--border);}
.pg-calendar .cal-row:last-child{border-bottom:none;}
.pg-calendar .cal-prop{position:sticky; left:0; z-index:5; width:var(--pc); flex:none; background:var(--surface); border:none; border-right:1px solid var(--border-strong); padding:0 8px 0 14px; display:flex; flex-direction:column; justify-content:center; text-align:left; min-width:0; overflow:hidden; font:inherit; color:inherit; border-radius:0;}
.pg-calendar button.cal-prop:hover{background:var(--surface-2);}
.pg-calendar button.cal-prop:hover .pn{color:var(--brand-text);}
.pg-calendar .cal-prop .pn{font-size:12.5px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.25;}
.pg-calendar .cal-prop .pl{font-size:11px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.25; margin-top:1px;}
.pg-calendar .cal-lane{position:relative; flex:none; cursor:cell;}
.pg-calendar .cal-lane.ro{cursor:default;}

/* bars: colour = booking status, mark = platform */
.pg-calendar .cal-bar{position:absolute; display:flex; align-items:center; gap:5px; padding:0 7px 0 3px; border:none; border-radius:7px; font:inherit; text-align:left; overflow:visible; white-space:nowrap; cursor:pointer; box-shadow:0 1px 1px rgba(16,24,40,0.12); z-index:2; min-width:0;}
.pg-calendar .cal-bar::before{content:""; position:absolute; left:0; right:0; top:-5px; bottom:-5px;}
.pg-calendar .cal-bar:hover{filter:brightness(1.06); box-shadow:0 2px 6px rgba(16,24,40,0.22); z-index:3;}
.pg-calendar .cal-bar:focus-visible{outline:2px solid var(--text); outline-offset:1px; z-index:4;}
.pg-calendar .cal-bar.s-confirmed{background:var(--st-confirmed); color:var(--st-confirmed-ink);}
.pg-calendar .cal-bar.s-checked_in{background:var(--st-inhouse); color:var(--st-inhouse-ink);}
.pg-calendar .cal-bar.s-pending{background:var(--st-pending); color:var(--st-pending-ink);}
.pg-calendar .cal-bar.s-checked_out{background:var(--st-past); color:var(--st-past-ink);}
.pg-calendar .cal-bar.s-block{background:repeating-linear-gradient(135deg, var(--st-block) 0 5px, var(--border-strong) 5px 7px); color:var(--st-block-ink); box-shadow:inset 0 0 0 1px var(--border-strong);}
.pg-calendar .cal-bar.s-block svg{width:12px; height:12px; flex:none; margin-left:3px;}
.pg-calendar .cal-bar.clipL{border-top-left-radius:0; border-bottom-left-radius:0;}
.pg-calendar .cal-bar.clipR{border-top-right-radius:0; border-bottom-right-radius:0;}
.pg-calendar .cal-bar .plat-ic{width:var(--ic,18px); height:var(--ic,18px); font-size:calc(var(--ic,18px) * 0.55);}
.pg-calendar .cal-bar .cb{min-width:0; overflow:hidden; text-overflow:ellipsis; font-weight:800; font-size:var(--fs,12px);}
.pg-calendar .cal-bar .cb .nts{font-weight:600; opacity:0.9;}
.pg-calendar .cal-bar .sdm{font-size:10px; margin-right:1px;}
.pg-calendar .cal-bar.tight{gap:3px; padding:0 2px;}
.pg-calendar .cal-bar.tight .cb{letter-spacing:-0.01em;}
.pg-calendar .cal-bar.flash{animation:calflash 1.1s ease-in-out 3;}
@keyframes calflash{0%,100%{box-shadow:0 0 0 0 transparent;} 50%{box-shadow:0 0 0 3px var(--text);}}

/* legend */
.pg-calendar .cal-legend{display:flex; flex-wrap:wrap; align-items:center; gap:8px 16px; padding:10px 14px; border-top:1px solid var(--border); font-size:11.5px; color:var(--text-2); font-weight:600;}
.pg-calendar .cal-legend .lg{display:inline-flex; align-items:center; gap:6px; white-space:nowrap;}
.pg-calendar .cal-legend .sw{width:14px; height:10px; border-radius:3px; display:inline-block;}
.pg-calendar .cal-legend .sw-block{background:repeating-linear-gradient(135deg, var(--st-block) 0 3px, var(--border-strong) 3px 5px); box-shadow:inset 0 0 0 1px var(--border-strong);}
.pg-calendar .cal-legend .plat-ic{width:16px; height:16px; font-size:9px;}
.pg-calendar .cal-legend .lg-sep{width:1px; height:14px; background:var(--border);}
.pg-calendar .cal-legend .hint{color:var(--muted); font-weight:500; margin-left:auto;}

/* tooltip + day menu (fixed, outside the scroller) */
.cal-tip{position:fixed; z-index:150; pointer-events:none; background:var(--surface); border:1px solid var(--border); border-radius:10px; box-shadow:var(--shadow-lg); padding:10px 12px; font-size:12px; width:270px; display:none;}
.cal-tip .ct-n{font-weight:800; font-size:13px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;}
.cal-tip .ct-r{display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:6px;}
.cal-tip .kv{font-size:12px; margin-top:8px; gap:3px 0;}
.cal-tip .ready{margin-top:8px; display:flex; flex-wrap:wrap; gap:4px;}
.cal-tip .ct-f{margin-top:8px; font-size:11px; color:var(--faint);}
.cal-menu{position:fixed; z-index:160; background:var(--surface); border:1px solid var(--border); border-radius:12px; box-shadow:var(--shadow-lg); width:260px; max-width:calc(100vw - 16px); overflow:hidden;}
.cal-menu .cm-h{padding:10px 12px 8px; border-bottom:1px solid var(--border);}
.cal-menu .cm-h b{font-size:13px; display:block;}
.cal-menu .cm-h .s{font-size:11.5px; color:var(--muted); margin-top:2px;}
.cal-menu .cm-o{display:flex; align-items:center; gap:9px; width:100%; background:none; border:none; padding:10px 12px; font-size:13px; font-weight:700; text-align:left; min-height:44px;}
.cal-menu .cm-o + .cm-o{border-top:1px solid var(--border);}
.cal-menu .cm-o:hover:not([disabled]){background:var(--surface-2);}
.cal-menu .cm-o svg{width:16px; height:16px; color:var(--brand-strong); flex:none;}
.cal-menu .cm-o[disabled]{opacity:0.5; cursor:not-allowed;}
.cal-menu .cm-o:focus-visible{outline-offset:-3px; border-radius:8px;}
.cal-menu .cm-o .s{display:block; font-size:11px; font-weight:500; color:var(--muted);}
.cal-menu .cm-x{padding:8px 12px; font-size:11.5px; color:var(--muted); background:var(--surface-2); border-top:1px solid var(--border);}
.blk-sum{font-size:12px; border-radius:8px; padding:8px 10px; line-height:1.45;}
.blk-sum.ok{background:var(--surface-2); color:var(--text-2); border:1px solid var(--border);}
.blk-sum.bad{background:var(--bad-soft); color:var(--bad);}

@media (max-width:1100px){ .pg-calendar{--pc:170px;} }

/* phones (portrait and landscape): 7 days, full-width timeline, actions in the toolbar */
.pg-calendar.is-phone{--pc:150px;}
.pg-calendar.is-phone.is-port{--pc:100px;}
.pg-calendar.is-phone .cal-tools{gap:6px; margin-bottom:10px;}
.pg-calendar.is-phone .cal-nav{flex:1 1 0;}
.pg-calendar.is-phone .cal-nav .icon-btn{width:40px; height:40px;}
.pg-calendar.is-phone .cal-pick{flex:1 1 auto; height:40px; justify-content:center; padding:0 8px;}
.pg-calendar.is-phone .cal-today{height:40px;}
.pg-calendar.is-phone .cal-tools .select{flex:1 1 0; min-width:0; max-width:none; height:40px;}
.pg-calendar.is-phone .cal-tools .sp{display:none;}
.pg-calendar.is-phone .cal-act{display:inline-flex; height:40px; flex:none;}
.pg-calendar.is-phone .cal-act.icon-btn{width:40px;}
.pg-calendar.is-phone .cal-card{margin:0 -14px; border-radius:0; border-left:none; border-right:none; overflow:visible; overflow:clip;}
.pg-calendar.is-phone .cal-scroll{max-height:none; overflow:visible;}
.pg-calendar.is-phone .cal-hd{top:var(--cal-top, 56px);}
.pg-calendar.is-phone .cal-corner{padding-left:12px; padding-right:6px;}
.pg-calendar.is-phone .cal-prop{padding:0 6px 0 12px;}
.pg-calendar.is-phone .cal-prop .pn{font-size:12px;}
.pg-calendar.is-phone .cal-prop .pl{font-size:10.5px;}
.pg-calendar.is-phone.is-port .cal-prop{padding:0 5px 0 10px;}
.pg-calendar.is-phone.is-port .cal-prop .pn{font-size:11.5px;}
.pg-calendar.is-phone.is-port .cal-prop .pl{font-size:10px;}
.pg-calendar.is-phone .cal-corner .cnt{display:none;}
.pg-calendar.is-phone .cal-days{height:50px;}
.pg-calendar.is-phone .cal-mo{height:18px; font-size:10.5px;}
.pg-calendar.is-phone .cal-d{top:18px;}
.pg-calendar.is-phone .cal-legend{padding:10px 12px; gap:6px 12px;}
.pg-calendar.is-phone .cal-legend .hint{margin-left:0; flex-basis:100%;}
.pg-calendar.is-phone.is-port .cal-nav{flex:1 1 210px;}
.pg-calendar.is-phone.is-port .cal-today{flex:none;}
.pg-calendar.is-phone.is-port .cal-tools .select{order:5; flex:1 1 120px;}
.pg-calendar.is-phone.is-port .cal-act{order:6;}
@media (max-width:960px){ .pg-calendar.is-phone .cal-card{margin:0 -14px;} }
`);

  /* ---------------- helpers ---------------- */
  function live(b) { return b.status !== 'cancelled'; }
  function isArchived(p) { return !!(p && (p.archived || p.status === 'archived')); }
  function tools() { return O.bookingTools || null; }
  function place(p) { return tools() ? tools().place(p) : (p && p.area) || ''; }
  function propName(p) { return p ? (p.name || p.short || 'Unnamed property') : 'Removed property'; }
  function propLabel(p) { var l = place(p); return propName(p) + (l ? ' · ' + l : ''); }
  function region(p) { var a = String(place(p) || '').split(', ').pop(); return a === 'George Town' ? 'Penang' : a; }
  function regions(list) { var out = []; list.forEach(function (p) { var r = region(p); if (r && out.indexOf(r) < 0) out.push(r); }); return out; }
  function rateOf(pid, iso) {
    var o = D.priceOverrides && D.priceOverrides[pid]; if (o && o[iso]) return o[iso];
    var r = NaN; try { r = D.rateFor(pid, iso); } catch (e) { /* property without a price model */ }
    var p = D.propById[pid]; return isFinite(r) && r > 0 ? r : (p && +p.base) || 0;
  }
  function isPhone() { try { return window.matchMedia(PHONE_Q).matches; } catch (e) { return window.innerWidth <= 760; } }
  function viewDays() {
    if (isPhone()) return 7;
    var n = +O.store.get('calendar.days', 7);
    return LENGTHS.indexOf(n) >= 0 ? n : 7;
  }
  function shortTime(t) { return fmt.time(t || '15:00').replace(':00 ', ' '); }
  function shownProps() {
    var list = D.properties.filter(function (p) { return !isArchived(p); });
    if (!st.prop) return list;
    if (st.prop.indexOf('area:') === 0) { var a = st.prop.slice(5); return list.filter(function (p) { return region(p) === a; }); }
    return list.filter(function (p) { return p.id === st.prop; });
  }
  function bookingsOf(pid, from, to) { return D.bookings.filter(function (b) { return b.propertyId === pid && live(b) && b.checkIn <= to && b.checkOut > from; }); }
  function blocksOf(pid, from, to) { return (D.blocks || []).filter(function (x) { return x.propertyId === pid && x.start <= to && x.end > from; }); }
  function nightTaken(pid, iso) {
    return D.bookings.some(function (b) { return b.propertyId === pid && live(b) && b.checkIn <= iso && iso < b.checkOut; }) ||
      (D.blocks || []).some(function (x) { return x.propertyId === pid && x.start <= iso && iso < x.end; });
  }
  /* the free stretch starting at a free night: [iso, first taken night) */
  function freeUntil(pid, iso) { var z = iso, i = 0; while (i++ < 120 && !nightTaken(pid, z)) z = d.add(z, 1); return { to: z, capped: i >= 120 }; }
  function initials(name) { return fmt.initials(name || '?'); }

  /* width of a label in the bar font, so a name is only shown when it really fits */
  var measureCtx = null, measureFamily = null, measureCache = {};
  function textW(str, px, weight) {
    var k = weight + '|' + px + '|' + str;
    if (measureCache[k] != null) return measureCache[k];
    if (measureCtx === null) { try { measureCtx = document.createElement('canvas').getContext('2d') || false; } catch (e) { measureCtx = false; } }
    var w = str.length * px * 0.64;
    if (measureCtx) {
      if (!measureFamily) measureFamily = getComputedStyle(document.body).fontFamily || 'sans-serif';
      measureCtx.font = weight + ' ' + px + 'px ' + measureFamily; w = measureCtx.measureText(str).width;
    }
    return (measureCache[k] = w);
  }
  try { if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { measureCache = {}; }); } catch (e) { /* older browsers */ }
  function sizeIcon(svg, px) { return svg.replace('<svg ', '<svg style="width:' + px + 'px;height:' + px + 'px" '); }

  /* ---------------- tooltip (desktop hover) ---------------- */
  function tipFor(b, p) {
    if (b.isBlock) {
      return '<div class="ct-n">' + (b.type === 'owner' ? 'Owner stay' : 'Maintenance') + '</div>' +
        '<div class="ct-r"><span class="st block"><i></i>Blocked</span><span class="small muted">' + esc(p ? p.short || p.name : '') + '</span></div>' +
        '<dl class="kv"><dt>Nights</dt><dd>' + d.fmtRange(b.start, d.add(b.end, -1)) + ' · ' + fmt.plural(d.diff(b.start, b.end), 'night') + '</dd>' + (b.note ? '<dt>Note</dt><dd>' + esc(b.note) + '</dd>' : '') + '</dl>' +
        '<div class="ct-f">Not bookable on any platform.' + (O.can('calendar.block') ? ' Click to change or remove.' : '') + '</div>';
    }
    var T = D.TODAY, full = O.can('bookings');
    var chips = '';
    if (full && b.status !== 'checked_in' && b.status !== 'checked_out' && b.checkOut > T) {
      chips = '<div class="ready">' + O.readiness(b).filter(function (r) { return r.label !== 'No turnover needed'; }).map(function (r) { return '<span class="rd ' + r.state + '">' + esc(r.label) + '</span>'; }).join('') + '</div>';
    }
    return '<div class="ct-n">' + esc(b.guest.name) + (b.sameDay ? '<span class="pill accent">⚡ Same-day</span>' : '') + '</div>' +
      '<div class="ct-r">' + U.status(b.status) + U.plat(b.channel) + '</div>' +
      '<dl class="kv"><dt>Stay</dt><dd>' + d.fmtRange(b.checkIn, b.checkOut) + ' · ' + fmt.plural(b.nights, 'night') + '</dd>' +
      '<dt>Check-in / out</dt><dd>' + shortTime(b.checkInTime) + ' / ' + shortTime(b.checkOutTime || '11:00') + '</dd>' +
      '<dt>Guests</dt><dd>' + b.guests + '</dd>' + (O.can('bookings.value') ? '<dt>Total</dt><dd>' + fmt.money(b.total) + '</dd>' : '') +
      '<dt>Booking</dt><dd>' + esc(b.id) + '</dd></dl>' + chips +
      '<div class="ct-f">Click to open the booking</div>';
  }

  /* a booking for people without access to Bookings: the stay only (no contacts, no money) */
  function stayInfo(b) {
    var p = D.propById[b.propertyId];
    U.modal({
      title: b.guest.name, sub: propLabel(p), size: 'sm',
      body: '<div class="row-flex wrap" style="margin-bottom:10px">' + U.status(b.status) + U.plat(b.channel) + '</div><dl class="kv"><dt>Stay</dt><dd>' + d.fmtY(b.checkIn) + ' → ' + d.fmtY(b.checkOut) + '</dd><dt>Nights · guests</dt><dd>' + b.nights + ' · ' + b.guests + '</dd><dt>Check-in / out</dt><dd>' + fmt.time(b.checkInTime || '15:00') + ' / ' + fmt.time(b.checkOutTime || '11:00') + '</dd>' + (b.notes ? '<dt>Note</dt><dd>' + esc(b.notes) + '</dd>' : '') + '</dl>',
      actions: [{ label: 'Close' }]
    });
  }
  function openBooking(id) {
    var b = D.booking(id); if (!b) return;
    if (!O.can('bookings')) { stayInfo(b); return; }
    if (tools()) tools().open(b); else O.booking.open(b);
  }

  /* ---------------- block dates (new / edit) ---------------- */
  function openBlock(o) {
    o = o || {};
    var T = D.TODAY, bl = o.block || null, canEdit = O.can('calendar.block');
    var props = D.properties.filter(function (p) { return !isArchived(p) || (bl && p.id === bl.propertyId); });
    if (!bl && !canEdit) { U.toast(O.viewer().name + '\'s access does not include blocking dates.', 'bad'); return; }
    if (!props.length) { U.toast('Add a property first.', 'bad'); return; }
    if (bl && !canEdit) { /* read only */
      var bp = D.propById[bl.propertyId];
      U.modal({ title: bl.type === 'owner' ? 'Owner stay' : 'Maintenance', sub: propLabel(bp), size: 'sm', body: '<dl class="kv"><dt>Nights</dt><dd>' + d.fmtY(bl.start) + ' → ' + d.fmtY(d.add(bl.end, -1)) + '</dd><dt>Length</dt><dd>' + fmt.plural(d.diff(bl.start, bl.end), 'night') + '</dd>' + (bl.note ? '<dt>Note</dt><dd>' + esc(bl.note) + '</dd>' : '') + '</dl><div class="xs muted" style="margin-top:10px">Not bookable on any platform. Your access does not include changing blocks.</div>', actions: [{ label: 'Close' }] });
      return;
    }
    var pid0 = bl ? bl.propertyId : (o.propertyId && D.propById[o.propertyId] ? o.propertyId : props[0].id);
    var first0 = bl ? bl.start : (o.start && o.start >= T ? o.start : T);
    var last0 = bl ? d.add(bl.end, -1) : (o.last && o.last >= first0 ? o.last : first0);
    var type = bl ? bl.type : (o.type || 'maintenance');
    var body = O.html('<div class="stack">' +
      '<div class="field"><label>Property</label><select class="select" name="pid">' + props.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === pid0 ? ' selected' : '') + '>' + esc(propLabel(p)) + '</option>'; }).join('') + '</select></div>' +
      '<div class="form-grid"><div class="field"><label>First night</label><input type="date" class="input" name="a" value="' + first0 + '"></div>' +
      '<div class="field"><label>Last night</label><input type="date" class="input" name="z" value="' + last0 + '"></div></div>' +
      '<div class="field"><label>Reason</label>' + U.seg([['maintenance', 'Maintenance'], ['owner', 'Owner stay']], type, 'data-type') + '</div>' +
      '<div class="field"><label>Note</label><input class="input" name="note" maxlength="120" placeholder="For example: aircon service, owner family visit" value="' + esc(bl ? bl.note || '' : '') + '"></div>' +
      '<div class="blk-sum" role="status"></div>' +
      '<div class="xs muted">Blocked nights close the unit for new bookings on your website and every connected platform.</div></div>');
    function vals() { return { pid: O.$('[name=pid]', body).value, a: O.$('[name=a]', body).value, z: O.$('[name=z]', body).value, note: O.$('[name=note]', body).value.trim() }; }
    function problems(v) {
      var err = [], now = D.TODAY;
      if (!v.a || !v.z) { err.push('Choose the first and last night.'); return err; }
      if (v.z < v.a) { err.push('The last night must be on or after the first night.'); return err; }
      if (v.a < now && !(bl && v.a === bl.start)) err.push('Blocks can only start today or later.');
      if (d.diff(v.a, v.z) + 1 > 90) err.push('A block can be at most 90 nights.');
      var end = d.add(v.z, 1), p = D.propById[v.pid];
      D.bookings.forEach(function (b) { if (b.propertyId === v.pid && live(b) && b.checkIn < end && v.a < b.checkOut) err.push(b.guest.name + ' is booked ' + d.fmtRange(b.checkIn, b.checkOut) + ' (' + U.platName(b.channel) + ').'); });
      (D.blocks || []).forEach(function (x) { if (x !== bl && x.propertyId === v.pid && x.start < end && v.a < x.end) err.push((p.short || p.name) + ' is already blocked ' + d.fmtRange(x.start, d.add(x.end, -1)) + '.'); });
      return err;
    }
    function update() {
      var v = vals(), err = problems(v), box = O.$('.blk-sum', body), p = D.propById[v.pid];
      box.className = 'blk-sum ' + (err.length ? 'bad' : 'ok');
      if (err.length) box.innerHTML = '<b>Cannot block these nights.</b> ' + esc(err[0]) + (err.length > 1 ? ' And ' + (err.length - 1) + ' more.' : '');
      else {
        var n = d.diff(v.a, v.z) + 1, lost = d.range(v.a, v.z).reduce(function (s, x) { return s + rateOf(v.pid, x); }, 0);
        box.innerHTML = '<b>' + fmt.plural(n, 'night') + '</b> at ' + esc(p.short || p.name) + ': ' + esc(d.fmtY(v.a)) + (n > 1 ? ' to ' + esc(d.fmtY(v.z)) : '') + '.' + (O.can('bookings.value') && lost ? ' At your current prices that is about <b>' + fmt.money(lost) + '</b> of nights.' : '');
      }
    }
    body.addEventListener('input', update);
    body.addEventListener('change', function (e) { if (e.target.name === 'a') { var z = O.$('[name=z]', body); if (!z.value || z.value < e.target.value) z.value = e.target.value; } update(); });
    body.addEventListener('click', function (e) { var b = e.target.closest('[data-type]'); if (!b) return; type = b.dataset.type; O.$$('[data-type]', body).forEach(function (x) { x.classList.toggle('on', x === b); }); });
    update();
    function save() {
      var v = vals(), err = problems(v);
      if (err.length) { update(); return false; }
      var p = D.propById[v.pid], end = d.add(v.z, 1), n = d.diff(v.a, end);
      if (bl) { bl.propertyId = v.pid; bl.start = v.a; bl.end = end; bl.type = type; bl.note = v.note; bl.updatedBy = O.state.viewer; }
      else D.blocks.push({ id: O.uid('BL'), propertyId: v.pid, start: v.a, end: end, type: type, note: v.note, createdBy: O.state.viewer, createdAt: D.NOW });
      U.toast((bl ? 'Block updated: ' : 'Blocked ') + (p.short || p.name) + ' for ' + fmt.plural(n, 'night') + ' (' + (n === 1 ? d.fmt(v.a) : d.fmtRange(v.a, v.z)) + '). All platform calendars are closed for these nights.');
      O.emit('data', { type: 'block' });
    }
    var actions = [{ label: 'Cancel' }, { label: bl ? 'Save changes' : 'Block dates', kind: 'primary', onClick: save }];
    if (bl) actions.unshift({
      label: 'Remove block', kind: 'danger', onClick: function () {
        var i = D.blocks.indexOf(bl); if (i >= 0) D.blocks.splice(i, 1);
        var bp = D.propById[bl.propertyId];
        U.toast('Block removed. ' + (bp ? bp.short || bp.name : 'The unit') + ' is bookable again for ' + d.fmtRange(bl.start, d.add(bl.end, -1)) + '.');
        O.emit('data', { type: 'block' });
      }
    });
    U.modal({ title: bl ? 'Blocked dates' : 'Block dates', sub: bl ? (bl.type === 'owner' ? 'Owner stay' : 'Maintenance') + ' at ' + propLabel(D.propById[bl.propertyId]) : 'Close a unit for maintenance or an owner stay.', body: body, actions: actions });
  }
  O.blockDates = openBlock; /* other sections may reuse it */

  function newBooking(pid, ci, co) {
    var o = { propertyId: pid, checkIn: ci, checkOut: co, onCreated: function (b) { st.flash = b.id; if (b.checkIn < st.start || b.checkIn > d.add(st.start, viewDays() - 1)) st.start = b.checkIn; } };
    if (O.newBooking) O.newBooking(o); else O.go('bookings', { new: true, propertyId: pid, checkIn: ci });
  }

  /* ---------------- page ---------------- */
  O.page('calendar', {
    desc: 'Every property on one timeline',
    render: function (root, ctx) {
      var T = D.TODAY;
      if (ctx.fresh) { st.start = null; st.scroll = null; }
      if (ctx.fresh && ctx.params) {
        var pp = ctx.params;
        if (pp.propertyId && D.propById[pp.propertyId]) st.prop = pp.propertyId;
        if (pp.from && /^\d{4}-\d{2}-\d{2}$/.test(pp.from)) st.start = pp.from;
        if (pp.bookingId && D.booking(pp.bookingId)) { var fb = D.booking(pp.bookingId); st.flash = fb.id; if (!st.start) st.start = fb.checkIn < T ? fb.checkIn : T; }
      }
      if (!st.start) st.start = T;
      if (st.prop && st.prop.indexOf('area:') !== 0 && !D.propById[st.prop]) st.prop = '';
      var phone = isPhone(), portrait = phone && window.innerWidth < window.innerHeight;
      var canNew = O.can('bookings.create'), canBlock = O.can('calendar.block');
      var all = D.properties.filter(function (p) { return !isArchived(p); });

      ctx.setActions(phone || !all.length ? '' : (canBlock ? '<button type="button" class="btn btn-ghost" data-act="block">' + O.icon('lock') + 'Block dates</button>' : '') + (canNew ? '<button type="button" class="btn btn-primary" data-act="new">' + O.icon('plus') + 'New booking</button>' : ''));
      var ab = O.$('[data-act=block]', ctx.actionsEl), an = O.$('[data-act=new]', ctx.actionsEl);
      if (ab) ab.onclick = function () { openBlock({ propertyId: st.prop && D.propById[st.prop] ? st.prop : undefined }); };
      if (an) an.onclick = function () { newBooking(st.prop && D.propById[st.prop] ? st.prop : undefined); };

      /* re-render when a phone turns or a window crosses the phone size */
      try {
        var mq = window.matchMedia(PHONE_Q), onMq = function () { ctx.rerender(); };
        if (mq.addEventListener) { mq.addEventListener('change', onMq); ctx.onLeave(function () { mq.removeEventListener('change', onMq); }); }
        var mo = window.matchMedia('(orientation: portrait)');
        if (phone && mo.addEventListener) { mo.addEventListener('change', onMq); ctx.onLeave(function () { mo.removeEventListener('change', onMq); }); }
      } catch (e) { /* older browsers */ }

      if (!all.length) {
        var canProp = O.allowed && O.allowed('properties') && O.can('properties.create');
        root.innerHTML = '<div class="pg-calendar"><div class="card"><div class="cal-empty">' + O.icon('calendar') + '<div>Your calendar fills in once you have added a property.</div>' +
          (canProp ? '<button type="button" class="btn btn-primary" data-go="properties">' + O.icon('plus') + 'Add your first property</button>' : '<div class="small" style="margin-top:6px">Ask an account owner to add your properties.</div>') + '</div></div></div>';
        var gp = O.$('[data-go]', root); if (gp) gp.onclick = function () { O.go('properties'); };
        return;
      }

      var days = viewDays(), from = st.start, to = d.add(from, days - 1);
      var areas = regions(all);
      var propOpts = '<option value="">All properties</option>' + (areas.length > 1 ? '<optgroup label="Areas">' + areas.map(function (r) {
        var n = all.filter(function (p) { return region(p) === r; }).length;
        return '<option value="area:' + esc(r) + '"' + (st.prop === 'area:' + r ? ' selected' : '') + '>' + esc(r) + ' (' + n + ')</option>';
      }).join('') + '</optgroup><optgroup label="Properties">' : '') + all.map(function (p) { return '<option value="' + esc(p.id) + '"' + (st.prop === p.id ? ' selected' : '') + '>' + esc(propName(p)) + '</option>'; }).join('') + (areas.length > 1 ? '</optgroup>' : '');

      root.innerHTML = '<div class="pg-calendar' + (phone ? ' is-phone' : '') + (portrait ? ' is-port' : '') + '">' +
        '<div class="cal-tools">' +
        '<div class="cal-nav"><button type="button" class="icon-btn" data-nav="-1" aria-label="Previous ' + STEP + ' days" title="Previous ' + STEP + ' days">' + O.icon('left') + '</button>' +
        '<label class="cal-pick" title="Pick a start date">' + O.icon('calendar') + '<span class="lbl">' + esc(U.rangeLabel(from, to)) + '</span><input type="date" data-f="start" value="' + from + '" aria-label="Start date"></label>' +
        '<button type="button" class="icon-btn" data-nav="1" aria-label="Next ' + STEP + ' days" title="Next ' + STEP + ' days">' + O.icon('right') + '</button></div>' +
        '<button type="button" class="btn btn-ghost btn-sm cal-today" data-nav="0"' + (from === T ? ' disabled title="Already showing today"' : '') + '>Today</button>' +
        (phone ? '' : '<div class="seg cal-len" role="group" aria-label="Days shown">' + LENGTHS.map(function (n) { return '<button type="button" data-len="' + n + '" class="' + (n === days ? 'on' : '') + '" aria-pressed="' + (n === days) + '">' + n + ' days</button>'; }).join('') + '</div>') +
        '<span class="sp"></span>' +
        '<select class="select" data-f="prop" aria-label="Properties">' + propOpts + '</select>' +
        (phone && canNew ? '<button type="button" class="btn btn-primary cal-act" data-act="new">' + O.icon('plus') + 'Booking</button>' : '') +
        (phone && canBlock ? '<button type="button" class="icon-btn cal-act" data-act="block" aria-label="Block dates" title="Block dates">' + O.icon('lock') + '</button>' : '') +
        '</div>' +
        '<div class="card cal-card"><div class="cal-scroll" tabindex="-1"></div>' +
        '<div class="cal-legend">' + LEGEND.map(function (s) { return '<span class="lg"><i class="sw" style="background:var(--st-' + s[1] + ')"></i>' + s[2] + '</span>'; }).join('') +
        '<span class="lg"><i class="sw sw-block"></i>Blocked</span>' +
        (phone ? '' : '<span class="lg-sep"></span>' + D.channelOrder.map(function (c) { return '<span class="lg">' + U.platIcon(c) + esc(U.platName(c)) + '</span>'; }).join('')) +
        '<span class="hint">' + (phone ? 'Tap' : 'Click') + ' a bar to open the booking' + (canNew || canBlock ? ', or a free night to ' + (canNew ? 'add a booking' : 'block it') : '') + '.</span></div>' +
        '</div></div>';
      var wrap = O.$('.pg-calendar', root), scroll = O.$('.cal-scroll', wrap);
      if (phone) { var tb = O.$('.topbar'); if (tb) wrap.style.setProperty('--cal-top', tb.offsetHeight + 'px'); }

      /* tooltip + menu live on the page wrapper (position: fixed) */
      var tip = O.html('<div class="cal-tip" role="tooltip"></div>');
      wrap.appendChild(tip);
      var menu = null;
      function closeMenu() { if (menu) { menu.remove(); menu = null; document.removeEventListener('mousedown', outside, true); document.removeEventListener('touchstart', outside, true); document.removeEventListener('keydown', onEsc); } }
      function outside(e) { if (menu && !menu.contains(e.target)) closeMenu(); }
      function onEsc(e) { if (e.key === 'Escape') closeMenu(); }
      ctx.onLeave(closeMenu);

      var G = { from: from, to: to, days: days, props: shownProps() };

      function paintGrid() {
        var T = D.TODAY, props = G.props, from = G.from, to = G.to, days = G.days;
        var cw = scroll.clientWidth, pc = parseFloat(getComputedStyle(wrap).getPropertyValue('--pc')) || 120;
        var dw = Math.max(MIN_DW, Math.floor((cw - pc) / days * 100) / 100);
        var lw = dw * days;
        var rh = phone ? 44 : props.length > 20 ? 36 : 44;
        var bh = rh - 10, ic = dw >= 34 ? 18 : 16, fs = 12;
        G.cw = cw; G.dw = dw; G.pc = pc;
        var X = function (iso) { return (d.diff(from, iso) + 0.5) * dw; };
        var iToday = d.diff(from, T);

        /* header: months + days */
        var months = '', dayCells = '', seg = null;
        for (var i = 0; i < days; i++) {
          var iso = d.add(from, i);
          if (!seg || iso.slice(0, 7) !== seg.m) { if (seg) months += monthCell(seg); seg = { m: iso.slice(0, 7), i0: i, n: 0, iso: iso }; }
          seg.n++;
          var we = d.isWeekend(iso);
          dayCells += '<div class="cal-d' + (we ? ' we' : '') + (iso === T ? ' today' : '') + '" style="left:' + (i * dw).toFixed(2) + 'px;width:' + dw.toFixed(2) + 'px" title="' + esc(d.dowName(iso) + ' ' + d.fmtY(iso) + (iso === T ? ' · today' : '')) + '">' +
            (dw >= 26 ? '<span class="w">' + d.dowName(iso).slice(0, dw >= 34 ? 3 : 2) + '</span>' : '') + '<span class="n">' + d.day(iso) + '</span></div>';
        }
        if (seg) months += monthCell(seg);
        function monthCell(sg) {
          var w = sg.n * dw, lbl = w >= 100 ? d.monthName(sg.iso, true) + ' ' + sg.iso.slice(0, 4) : w >= 34 ? d.monthName(sg.iso) : '';
          return '<div class="cal-mo" style="left:' + (sg.i0 * dw).toFixed(2) + 'px;width:' + w.toFixed(2) + 'px">' + esc(lbl) + '</div>';
        }

        /* column overlays: weekends, grid lines, today, now */
        var cols = '';
        for (var j = 0; j < days; j++) {
          var dj = d.add(from, j);
          if (d.isWeekend(dj)) cols += '<i class="we" style="left:' + (j * dw).toFixed(2) + 'px;width:' + dw.toFixed(2) + 'px"></i>';
          if (j) cols += '<i class="gl" style="left:' + (j * dw).toFixed(2) + 'px"></i>';
        }
        if (iToday >= 0 && iToday < days) {
          cols += '<i class="td" style="left:' + (iToday * dw).toFixed(2) + 'px;width:' + dw.toFixed(2) + 'px"></i>';
          var hm = String(D.NOW_TIME || '12:00').split(':');
          cols += '<i class="now" style="left:' + ((iToday + (+hm[0] + (+hm[1] || 0) / 60) / 24) * dw).toFixed(2) + 'px" title="Now, ' + esc(fmt.time(D.NOW_TIME)) + '"></i>';
        }

        function clip(a, z) { return { a: Math.max(a, 0), z: Math.min(z, lw), cl: a < 0, cr: z > lw }; }
        function barHTML(b, a, z) {
          var c = clip(a, z), left = c.a + (c.cl ? 0 : 1.5), w = c.z - left - (c.cr ? 0 : 1.5);
          if (w < 6) return '';
          var nm = String(b.guest.name || ''), nts = fmt.plural(b.nights, 'night');
          var tight = w < 62, bfs = fs; /* short bars: smaller mark and tighter padding; initials may drop to 10.5px so they still fit */
          var showIc = w >= 22, icPx = tight ? 13 : Math.max(12, Math.min(ic, bh - 6)), sdOn = b.sameDay && !tight;
          var avail = w - (showIc ? icPx + (tight ? 3 : 5) : 0) - (tight ? 4 : 10) - (sdOn ? 11 : 0);
          var fits = function (str, px) { return textW(str, px || fs, 800) <= avail; };
          var first = nm.replace(/^The /, '').split(' ')[0], ini = initials(nm);
          var label = '', extra = '';
          if (fits(nm) && fits(nm + ' · ' + nts)) { label = nm; extra = nts; }
          else if (fits(nm)) label = nm;
          else if (first.length > 2 && fits(first)) label = first;
          else if (fits(ini)) label = ini;
          else if (tight && fits(ini, 10.5)) { label = ini; bfs = 10.5; }
          var sd = sdOn && label ? '<span class="sdm" aria-hidden="true">⚡</span>' : '';
          var cls = 'cal-bar s-' + b.status + (tight ? ' tight' : '') + (c.cl ? ' clipL' : '') + (c.cr ? ' clipR' : '') + (st.flash === b.id ? ' flash' : '');
          var aria = nm + ', ' + U.platName(b.channel) + ', ' + U.statusLabel(b.status) + ', ' + d.fmtRange(b.checkIn, b.checkOut) + ', ' + nts;
          return '<button type="button" class="' + cls + '" data-id="' + esc(b.id) + '" aria-label="' + esc(aria) + '" style="left:' + left.toFixed(1) + 'px;width:' + w.toFixed(1) + 'px;top:' + ((rh - bh) / 2 - 0.5).toFixed(1) + 'px;height:' + bh + 'px;--ic:' + icPx + 'px;--fs:' + bfs + 'px">' +
            (showIc ? U.platIcon(b.channel) : '') + (label ? '<span class="cb">' + sd + esc(label) + (extra ? ' <span class="nts">· ' + esc(extra) + '</span>' : '') + '</span>' : '') + '</button>';
        }
        function blockHTML(x, a, z) {
          var c = clip(a, z), left = c.a + (c.cl ? 0 : 1.5), w = c.z - left - (c.cr ? 0 : 1.5);
          if (w < 6) return '';
          var lbl = x.type === 'owner' ? 'Owner stay' : 'Maintenance', room = w - 12 - 5 - 12;
          var shown = textW(lbl, fs, 800) <= room ? lbl : (x.type === 'owner' && textW('Owner', fs, 800) <= room ? 'Owner' : '');
          return '<button type="button" class="cal-bar s-block' + (c.cl ? ' clipL' : '') + (c.cr ? ' clipR' : '') + '" data-block="' + esc(x.id) + '" aria-label="' + esc('Blocked: ' + lbl + ', ' + d.fmtRange(x.start, d.add(x.end, -1))) + '" style="left:' + left.toFixed(1) + 'px;width:' + w.toFixed(1) + 'px;top:' + ((rh - bh) / 2 - 0.5).toFixed(1) + 'px;height:' + bh + 'px;--fs:' + fs + 'px">' +
            (w >= 20 ? sizeIcon(O.icon(x.type === 'owner' ? 'home' : 'lock'), 12) : '') + (shown ? '<span class="cb">' + esc(shown) + '</span>' : '') + '</button>';
        }

        var canOpenProp = O.can('bookings'), canAct = canNew || canBlock;
        var rowsHTML = props.map(function (p) {
          var bars = '';
          bookingsOf(p.id, from, to).forEach(function (b) { bars += barHTML(b, X(b.checkIn), X(b.checkOut)); });
          blocksOf(p.id, from, to).forEach(function (x) { bars += blockHTML(x, X(x.start), X(x.end)); });
          var loc = place(p), short = phone && portrait ? (p.short || p.name) : propName(p), locShort = phone && portrait ? String(loc).split(', ')[0] : loc;
          var inner = '<span class="pn">' + esc(short) + '</span>' + (locShort ? '<span class="pl">' + esc(locShort) + '</span>' : '');
          var cell = canOpenProp
            ? '<button type="button" class="cal-prop" data-prop="' + esc(p.id) + '" title="' + esc(propLabel(p) + '. Click to see its bookings.') + '">' + inner + '</button>'
            : '<div class="cal-prop" title="' + esc(propLabel(p)) + '">' + inner + '</div>';
          return '<div class="cal-row" style="height:' + rh + 'px">' + cell +
            '<div class="cal-lane' + (canAct ? '' : ' ro') + '" data-pid="' + esc(p.id) + '" style="width:' + lw.toFixed(2) + 'px">' + bars + '</div></div>';
        }).join('');

        scroll.innerHTML = '<div class="cal-track" style="width:' + (pc + lw).toFixed(2) + 'px">' +
          '<div class="cal-hd"><div class="cal-corner"><span class="cnt">' + fmt.plural(props.length, 'property', 'properties') + '</span></div><div class="cal-days" style="width:' + lw.toFixed(2) + 'px">' + months + dayCells + '</div></div>' +
          '<div class="cal-body"><div class="cal-cols" style="left:' + pc + 'px;width:' + lw.toFixed(2) + 'px">' + cols + '</div>' + rowsHTML + '</div></div>';

        /* keep the scroll position across repaints */
        if (st.scroll && !phone) { scroll.scrollLeft = st.scroll.l; scroll.scrollTop = st.scroll.t; }
        if (st.flash) {
          var fbar = O.$('.cal-bar.flash', scroll);
          if (fbar) {
            var bx = fbar.offsetLeft;
            if (bx < scroll.scrollLeft || bx > scroll.scrollLeft + cw - pc - 40) scroll.scrollLeft = Math.max(0, bx - 60);
            try { fbar.scrollIntoView({ block: 'nearest' }); } catch (e) { /* older browsers */ }
          }
          st.flash = null;
        }
      }
      paintGrid();

      if (window.ResizeObserver) {
        var ro = new ResizeObserver(function () {
          if (!document.body.contains(scroll)) { ro.disconnect(); return; }
          if (Math.abs(scroll.clientWidth - (G.cw || 0)) > 4) paintGrid();
        });
        ro.observe(scroll);
        ctx.onLeave(function () { ro.disconnect(); });
      }
      scroll.addEventListener('scroll', function () { st.scroll = { l: scroll.scrollLeft, t: scroll.scrollTop }; tip.style.display = 'none'; closeMenu(); }, { passive: true });

      function go(start) { st.start = start; st.scroll = null; closeMenu(); ctx.rerender(); }

      /* ---------------- events ---------------- */
      wrap.addEventListener('click', function (e) {
        var t = e.target.closest('button');
        if (t && wrap.contains(t)) {
          if (t.dataset.nav != null) {
            var nv = +t.dataset.nav;
            go(nv === 0 ? D.TODAY : d.add(st.start, nv * STEP)); return;
          }
          if (t.dataset.len) { O.store.set('calendar.days', +t.dataset.len); st.scroll = null; ctx.rerender(); return; }
          if (t.dataset.act === 'new') { newBooking(st.prop && D.propById[st.prop] ? st.prop : undefined); return; }
          if (t.dataset.act === 'block') { openBlock({ propertyId: st.prop && D.propById[st.prop] ? st.prop : undefined }); return; }
          if (t.dataset.prop) { O.go('bookings', { propertyId: t.dataset.prop, from: G.from, to: G.to }); return; }
          if (t.dataset.block) { tip.style.display = 'none'; var bl = (D.blocks || []).filter(function (x) { return x.id === t.dataset.block; })[0]; if (bl) openBlock({ block: bl }); return; }
          if (t.dataset.id) { tip.style.display = 'none'; openBooking(t.dataset.id); return; }
          return;
        }
        /* tap on a free night: small menu */
        var lane = e.target.closest('.cal-lane'); if (!lane || !wrap.contains(lane) || !(canNew || canBlock)) return;
        var rect = lane.getBoundingClientRect(), idx = Math.floor((e.clientX - rect.left) / G.dw);
        if (idx < 0 || idx >= G.days) return;
        var iso = d.add(G.from, idx), p = D.propById[lane.dataset.pid];
        if (!p || nightTaken(p.id, iso)) return;
        openMenu(p, iso, e.clientX, e.clientY);
      });
      var pick = O.$('[data-f=start]', wrap);
      pick.addEventListener('change', function () { if (/^\d{4}-\d{2}-\d{2}$/.test(pick.value)) go(pick.value); });
      if (!phone) pick.addEventListener('click', function () { try { if (pick.showPicker) pick.showPicker(); } catch (e) { /* the native control opens instead */ } });
      O.$('[data-f=prop]', wrap).onchange = function (e) { st.prop = e.target.value; st.scroll = null; ctx.rerender(); };

      function openMenu(p, iso, x, y) {
        closeMenu();
        var now = D.TODAY, past = iso < now, span = freeUntil(p.id, iso), freeN = d.diff(iso, span.to);
        var head = '<div class="cm-h"><b>' + esc(propName(p)) + '</b><div class="s">' + esc(d.dowName(iso) + ' ' + d.fmtY(iso)) + (past ? ' · past night' : ' · free night') + '</div>' +
          (!past ? '<div class="s">' + (span.capped ? 'Free for 120+ nights' : 'Free for ' + fmt.plural(freeN, 'night') + ' (until ' + esc(d.fmt(span.to)) + ')') + (O.can('bookings.value') ? ' · your price ' + fmt.money(rateOf(p.id, iso)) : '') + '</div>' : '') + '</div>';
        menu = O.html('<div class="cal-menu" role="menu">' + head +
          (canNew ? '<button type="button" class="cm-o" role="menuitem" data-m="new"' + (past ? ' disabled' : '') + '>' + O.icon('plus') + '<span>New booking<span class="s">Direct booking from ' + esc(d.fmt(iso)) + '</span></span></button>' : '') +
          (canBlock ? '<button type="button" class="cm-o" role="menuitem" data-m="block"' + (past ? ' disabled' : '') + '>' + O.icon('lock') + '<span>Block dates<span class="s">Maintenance or owner stay</span></span></button>' : '') +
          (past ? '<div class="cm-x">This night has passed. New bookings and blocks start today or later.</div>' : '') + '</div>');
        document.body.appendChild(menu);
        var mw = menu.offsetWidth, mh = menu.offsetHeight;
        menu.style.left = Math.max(8, Math.min(x + 6, window.innerWidth - mw - 8)) + 'px';
        menu.style.top = Math.max(8, (y + 8 + mh > window.innerHeight - 8 ? y - mh - 8 : y + 8)) + 'px';
        menu.addEventListener('click', function (ev) {
          var b = ev.target.closest('[data-m]'); if (!b || b.disabled) return;
          var m = b.dataset.m; closeMenu();
          if (m === 'new') newBooking(p.id, iso, d.add(iso, Math.max(1, Math.min(2, freeN || 1))));
          if (m === 'block') openBlock({ propertyId: p.id, start: iso, last: iso });
        });
        setTimeout(function () { document.addEventListener('mousedown', outside, true); document.addEventListener('touchstart', outside, true); document.addEventListener('keydown', onEsc); }, 0);
        var first = O.$('.cm-o:not([disabled])', menu); if (first) try { first.focus({ preventScroll: true }); } catch (er) { /* ignore */ }
      }

      /* hover tooltip for bars (mouse only) */
      function placeTip(e) {
        var w = tip.offsetWidth, h = tip.offsetHeight, x = e.clientX + 14, y = e.clientY + 14;
        if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
        if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
        tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
      }
      if (!phone) {
        wrap.addEventListener('mouseover', function (e) {
          var bar = e.target.closest('.cal-bar'); if (!bar) return;
          var html;
          if (bar.dataset.block) { var bl = (D.blocks || []).filter(function (x) { return x.id === bar.dataset.block; })[0]; if (!bl) return; html = tipFor(Object.assign({ isBlock: true }, bl), D.propById[bl.propertyId]); }
          else { var b = D.booking(bar.dataset.id); if (!b) return; html = tipFor(b, D.propById[b.propertyId]); }
          tip.innerHTML = html; tip.style.display = 'block'; placeTip(e);
        });
        wrap.addEventListener('mousemove', function (e) { if (tip.style.display === 'block' && e.target.closest('.cal-bar')) placeTip(e); });
        wrap.addEventListener('mouseout', function (e) { var bar = e.target.closest('.cal-bar'); if (bar && !bar.contains(e.relatedTarget)) tip.style.display = 'none'; });
      }
      ctx.on('data', closeMenu);
    }
  });
})();
