/* Calendar — multi-property timeline.
   Narrow property column (short names only), day columns sized to fit the chosen range, rows that get
   thinner as the number of properties grows, bars coloured by booking status with the platform logo at
   the start. Click a bar to open the booking; click a free night for "New booking / Block dates". */
(function () {
  var O = window.O, D = O.data, M = O.metrics, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  var T = D.TODAY;
  var MIN_DW = 22;                     /* below this the timeline scrolls sideways instead of squeezing */
  var STATUS_KEYS = ['confirmed', 'checked_in', 'pending', 'checked_out', 'cancelled'];
  var ST_VAR = { confirmed: 'confirmed', checked_in: 'inhouse', pending: 'pending', checked_out: 'past', cancelled: 'cancelled' };
  var DENSITY = [['auto', 'Auto'], ['comfortable', 'Comfortable'], ['compact', 'Compact']];
  var DENSITY_PX = { comfortable: 52, compact: 24 };
  var AUTO_STEPS = [[6, 52], [9, 46], [12, 40], [16, 36], [22, 32], [30, 28], [40, 24], [Infinity, 22]];
  var PREVIEW = [12, 30, 60];
  var RANGE_PRESETS = ['today', 'next7', 'next14', 'next30', 'next60', 'next90', 'thisMonth', 'nextMonth'];
  var MAX_DAYS = 184;

  var st = {
    range: null,            /* null = default (next 30 days; next 14 on a phone) until the user picks one */
    density: 'auto', preview: 12, prop: '', status: [], plat: [],
    flash: null, scroll: null
  };

  O.css('calendar', `
.pg-calendar{--pc:120px;}
.pg-calendar .cal-tools{display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:12px;}
.pg-calendar .cal-nav{display:inline-flex; align-items:center; gap:4px;}
.pg-calendar .cal-nav .btn{height:36px;}
.pg-calendar .cal-nav .icon-btn svg{width:16px; height:16px;}
.pg-calendar .cal-tools .select{width:auto; min-width:200px; height:36px;}
.pg-calendar .cal-chips{display:flex; flex-direction:column; gap:8px; margin-bottom:12px;}
.pg-calendar .cal-chips .chip-group-label{min-width:64px; flex-shrink:0;}
.pg-calendar .chip .sw{width:10px; height:10px; border-radius:3px; display:inline-block; flex-shrink:0;}
.pg-calendar .chip.on .sw{box-shadow:0 0 0 1.5px var(--brand-ink);}
.pg-calendar .chip .plat-ic{width:16px; height:16px; font-size:9px;}
.pg-calendar .chip.on .plat-ic{box-shadow:0 0 0 1.5px var(--brand-ink);}
.pg-calendar .sw-block, .pg-calendar .cal-bar.s-block{background:repeating-linear-gradient(135deg, var(--st-block) 0 5px, var(--border-strong) 5px 7px);}
.pg-calendar .cal-card{overflow:hidden;}
.pg-calendar .cal-head-row{display:flex; align-items:flex-start; justify-content:space-between; gap:12px 18px; padding:12px 16px; border-bottom:1px solid var(--border); flex-wrap:wrap;}
.pg-calendar .cal-title h3{font-size:14px; font-weight:800;}
.pg-calendar .cal-stats{display:flex; flex-wrap:wrap; gap:4px 14px; font-size:12px; color:var(--muted); margin-top:3px;}
.pg-calendar .cal-stats b{color:var(--text); font-variant-numeric:tabular-nums;}
.pg-calendar .cal-ctrls{display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center;}
.pg-calendar .cal-ctrl{display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
.pg-calendar .cal-ctrl .lbl{font-size:11.5px; font-weight:700; color:var(--muted); white-space:nowrap;}
.pg-calendar .cal-ctrl .hint{font-size:11px; color:var(--faint); white-space:nowrap;}
.pg-calendar .cal-ctrl .seg button{padding:5px 10px; font-size:12px;}
.pg-calendar .cal-ctrl .seg button[disabled]{opacity:0.45; cursor:not-allowed;}
.pg-calendar .cal-demo{display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:0; border-radius:0; border-width:0 0 1px; padding:8px 16px;}
.pg-calendar .cal-demo .grow{min-width:200px;}

/* the timeline */
.pg-calendar .cal-scroll{position:relative; overflow:auto; max-height:calc(100vh - 150px); scrollbar-gutter:stable; overscroll-behavior-x:contain;}
.pg-calendar .cal-track{position:relative;}
.pg-calendar .cal-hd{display:flex; position:sticky; top:0; z-index:6; background:var(--surface); border-bottom:1px solid var(--border-strong);}
.pg-calendar .cal-corner{position:sticky; left:0; z-index:7; width:var(--pc); flex:none; background:var(--surface); border-right:1px solid var(--border-strong); padding:6px 6px 6px 10px; white-space:nowrap; overflow:hidden; display:flex; flex-direction:column; justify-content:flex-end; font-size:11px; font-weight:700; color:var(--muted);}
.pg-calendar .cal-corner b{color:var(--text); font-size:12px;}
.pg-calendar .cal-days{position:relative; flex:none; height:50px;}
.pg-calendar .cal-mo{position:absolute; top:0; height:20px; display:flex; align-items:center; padding-left:6px; font-size:11px; font-weight:800; color:var(--text-2); border-left:1px solid var(--border-strong); white-space:nowrap; overflow:hidden;}
.pg-calendar .cal-mo:first-child{border-left:none;}
.pg-calendar .cal-d{position:absolute; top:20px; height:30px; display:flex; flex-direction:column; align-items:center; justify-content:center; border-left:1px solid var(--c-grid); font-variant-numeric:tabular-nums; line-height:1.1;}
.pg-calendar .cal-d .n{font-size:11.5px; font-weight:800; color:var(--text-2);}
.pg-calendar .cal-d .w{font-size:9.5px; font-weight:700; color:var(--faint); text-transform:uppercase; letter-spacing:0.02em;}
.pg-calendar .cal-d.we{background:var(--bg);}
.pg-calendar .cal-d.we .w{color:var(--muted);}
.pg-calendar .cal-d.today .n{background:var(--brand); color:var(--brand-ink); border-radius:5px; padding:1px 4px; min-width:18px; text-align:center;}
.pg-calendar .cal-d .ev{position:absolute; top:3px; right:3px; width:5px; height:5px; border-radius:50%; background:var(--accent-text); box-shadow:0 0 0 1px var(--surface);}
.pg-calendar .cal-body{position:relative;}
.pg-calendar .cal-cols{position:absolute; top:0; bottom:0; pointer-events:none; z-index:0;}
.pg-calendar .cal-cols .we{position:absolute; top:0; bottom:0; background:var(--bg);}
.pg-calendar .cal-cols .td{position:absolute; top:0; bottom:0; background:var(--brand-soft-2);}
.pg-calendar .cal-cols .now{position:absolute; top:0; bottom:0; width:2px; margin-left:-1px; background:var(--brand-strong); opacity:0.85;}
.pg-calendar .cal-row{display:flex; position:relative; z-index:1; border-bottom:1px solid var(--border);}
.pg-calendar .cal-prop{position:sticky; left:0; z-index:6; width:var(--pc); flex:none; background:var(--surface); border:none; border-right:1px solid var(--border-strong); padding:0 6px 0 10px; display:flex; flex-direction:column; justify-content:center; text-align:left; min-width:0; overflow:hidden; font:inherit; color:inherit;}
.pg-calendar button.cal-prop:hover{background:var(--surface-2);}
.pg-calendar button.cal-prop:hover .pn{color:var(--brand-text);}
.pg-calendar .cal-prop .pn{display:flex; align-items:center; gap:5px; font-size:11.5px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.2;}
.pg-calendar .cal-prop .pn span{overflow:hidden; text-overflow:ellipsis;}
.pg-calendar .cal-prop .prop-dot{width:7px; height:7px;}
.pg-calendar .cal-prop .ps{font-size:10.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; font-variant-numeric:tabular-nums;}
.pg-calendar .cal-prop .demo-tag{font-size:9px; font-weight:800; letter-spacing:0.04em; color:var(--muted); background:var(--surface-2); border:1px solid var(--border); border-radius:4px; padding:0 3px; flex:none;}
.pg-calendar .cal-lane{position:relative; flex:none; cursor:cell;}
.pg-calendar .cal-lane.past-only{cursor:default;}
.pg-calendar .cal-row.demo .cal-prop .pn{color:var(--text-2); font-weight:700;}

/* bars: colour = booking status, logo = platform */
.pg-calendar .cal-bar{position:absolute; display:flex; align-items:center; gap:5px; padding:0 6px 0 2px; border:none; border-radius:7px; font:inherit; text-align:left; overflow:hidden; white-space:nowrap; cursor:pointer; box-shadow:0 1px 1px rgba(16,24,40,0.12); z-index:2;}
.pg-calendar .cal-bar:hover{filter:brightness(1.06); box-shadow:0 2px 6px rgba(16,24,40,0.22); z-index:3;}
.pg-calendar .cal-bar:focus-visible{outline:2px solid var(--text); outline-offset:1px; z-index:4;}
.pg-calendar .cal-bar.s-confirmed{background:var(--st-confirmed); color:var(--st-confirmed-ink);}
.pg-calendar .cal-bar.s-checked_in{background:var(--st-inhouse); color:var(--st-inhouse-ink);}
.pg-calendar .cal-bar.s-pending{background:var(--st-pending); color:var(--st-pending-ink);}
.pg-calendar .cal-bar.s-checked_out{background:var(--st-past); color:var(--st-past-ink);}
.pg-calendar .cal-bar.s-cancelled{background:var(--st-cancelled); color:var(--st-cancelled-ink); z-index:1;}
.pg-calendar .cal-bar.s-cancelled .cb-n{text-decoration:line-through;}
.pg-calendar .cal-bar.s-block{color:var(--st-block-ink); box-shadow:inset 0 0 0 1px var(--border-strong);}
.pg-calendar .cal-bar.s-block svg{width:12px; height:12px; flex:none; margin-left:3px;}
.pg-calendar .cal-bar.clipL{border-top-left-radius:0; border-bottom-left-radius:0; padding-left:4px;}
.pg-calendar .cal-bar.clipR{border-top-right-radius:0; border-bottom-right-radius:0;}
.pg-calendar .cal-bar .plat-ic{width:var(--ic,18px); height:var(--ic,18px); font-size:calc(var(--ic,18px) * 0.55);}
.pg-calendar .cal-bar .cb-t{display:flex; flex-direction:column; min-width:0; overflow:hidden; line-height:1.15;}
.pg-calendar .cal-bar .cb-n{font-weight:800; font-size:var(--fs,12px); overflow:hidden; text-overflow:ellipsis;}
.pg-calendar .cal-bar .cb-s{font-size:10.5px; font-weight:600; opacity:0.88; overflow:hidden; text-overflow:ellipsis;}
.pg-calendar .cal-bar .sdm{font-size:10px; margin-right:1px;}
.pg-calendar .cal-bar.flash{animation:calflash 1.1s ease-in-out 3;}
@keyframes calflash{0%,100%{box-shadow:0 0 0 0 transparent;} 50%{box-shadow:0 0 0 3px var(--text);}}
.pg-calendar .cal-tight .cal-bar{border-radius:4px; gap:4px; padding-right:4px;}
.pg-calendar .cal-tight .cal-bar.clipL{border-radius:0 4px 4px 0;}
.pg-calendar .cal-tight .cal-bar.clipR{border-radius:4px 0 0 4px;}
.pg-calendar .cal-tight .cal-prop .pn{font-size:11px;}
.pg-calendar .cal-tight .cal-prop .prop-dot{width:6px; height:6px;}

/* daily "booked" row */
.pg-calendar .cal-ft{display:flex; position:sticky; bottom:0; z-index:6; background:var(--surface); border-top:1px solid var(--border-strong);}
.pg-calendar .cal-ft .cal-corner{justify-content:center; padding-top:4px; padding-bottom:4px;}
.pg-calendar .cal-ft .cal-days{height:28px;}
.pg-calendar .cal-oc{position:absolute; top:3px; bottom:3px; display:flex; align-items:center; justify-content:center; font-size:10.5px; font-weight:800; color:var(--text); font-variant-numeric:tabular-nums; border-radius:4px; overflow:hidden;}
.pg-calendar .cal-oc i{position:absolute; inset:0; background:var(--brand-strong);}
.pg-calendar .cal-oc span{position:relative;}

/* legend */
.pg-calendar .cal-legend{display:flex; flex-wrap:wrap; align-items:center; gap:8px 16px; padding:10px 16px; border-top:1px solid var(--border); font-size:11.5px; color:var(--text-2); font-weight:600;}
.pg-calendar .cal-legend .lg{display:inline-flex; align-items:center; gap:6px; white-space:nowrap;}
.pg-calendar .cal-legend .lg:first-child{white-space:normal;}
.pg-calendar .cal-legend-2{border-top:none; padding-top:0; gap:8px 22px;}
.pg-calendar .cal-legend .lg-g{display:inline-flex; flex-wrap:wrap; align-items:center; gap:6px 12px;}
.pg-calendar .cal-legend .lg-t{font-size:10.5px; font-weight:800; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em;}
.pg-calendar .cal-legend .sw{width:16px; height:10px; border-radius:3px; display:inline-block;}
.pg-calendar .cal-legend .plat-ic{width:16px; height:16px; font-size:9px;}
.pg-calendar .cal-legend .lg-now{width:2px; height:12px; background:var(--brand-strong); display:inline-block;}
.pg-calendar .cal-legend .lg-we{width:14px; height:12px; background:var(--bg); border:1px solid var(--border); display:inline-block; border-radius:2px;}
.pg-calendar .cal-legend .lg-ev{width:6px; height:6px; border-radius:50%; background:var(--accent-text); display:inline-block;}
.pg-calendar .cal-legend .lg-bar{flex:none; white-space:nowrap; display:inline-flex; align-items:center; gap:4px; height:18px; padding:0 7px 0 2px; border-radius:6px; background:var(--st-confirmed); color:var(--st-confirmed-ink); font-size:10.5px; font-weight:800;}
.pg-calendar .cal-legend .lg-bar .plat-ic{width:14px; height:14px; font-size:8px;}
.pg-calendar .cal-note{padding:0 16px 12px; font-size:11.5px; color:var(--muted);}

/* tooltip + day menu (fixed, outside the scroller) */
.cal-tip{position:fixed; z-index:150; pointer-events:none; background:var(--surface); border:1px solid var(--border); border-radius:10px; box-shadow:var(--shadow-lg); padding:10px 12px; font-size:12px; width:270px; display:none;}
.cal-tip .ct-n{font-weight:800; font-size:13px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;}
.cal-tip .ct-r{display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:6px;}
.cal-tip .kv{font-size:12px; margin-top:8px; gap:3px 0;}
.cal-tip .ready{margin-top:8px;}
.cal-tip .ct-f{margin-top:8px; font-size:11px; color:var(--faint);}
.cal-menu{position:fixed; z-index:160; background:var(--surface); border:1px solid var(--border); border-radius:12px; box-shadow:var(--shadow-lg); width:260px; overflow:hidden;}
.cal-menu .cm-h{padding:10px 12px 8px; border-bottom:1px solid var(--border);}
.cal-menu .cm-h b{font-size:13px; display:block;}
.cal-menu .cm-h .s{font-size:11.5px; color:var(--muted); margin-top:2px;}
.cal-menu .cm-o{display:flex; align-items:center; gap:9px; width:100%; background:none; border:none; padding:10px 12px; font-size:13px; font-weight:700; text-align:left; min-height:40px;}
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

@media (max-width:760px){
  .pg-calendar{--pc:92px;}
  .pg-calendar .cal-tools .select{flex:1 1 100%; min-width:0;}
  .pg-calendar .cal-chips .chips{flex-wrap:nowrap; overflow-x:auto; scrollbar-width:none; padding-bottom:2px;}
  .pg-calendar .cal-chips .chip-group-label{min-width:0; position:sticky; left:0; background:var(--bg); padding-right:4px; z-index:1;}
  .pg-calendar .cal-head-row{padding:12px;}
  .pg-calendar .cal-ctrl .hint{display:none;}
  .pg-calendar .cal-ctrl .seg button{min-height:36px; padding:6px 12px;}
  .pg-calendar .cal-corner, .pg-calendar .cal-prop{padding-left:8px; padding-right:6px;}
  .pg-calendar .cal-prop .ps{padding-left:0;}
  .pg-calendar .cal-prop .prop-dot{display:none;}
  .pg-calendar .cal-scroll{max-height:calc(100vh - 120px);}
  .pg-calendar .cal-legend{padding:10px 12px; gap:8px 12px;}
}
`);

  /* ---------------- helpers ---------------- */
  function live(b) { return b.status !== 'cancelled'; }
  function region(p) { var a = p.area.split(', ').pop(); return a === 'George Town' ? 'Penang' : a; }
  function regions() { var out = []; D.properties.forEach(function (p) { var r = region(p); if (out.indexOf(r) < 0) out.push(r); }); return out; }
  function rateOf(pid, iso) { var o = D.priceOverrides && D.priceOverrides[pid]; return (o && o[iso]) || D.rateFor(pid, iso); }
  function narrow() { return window.matchMedia ? window.matchMedia('(max-width:760px)').matches : window.innerWidth <= 760; }
  function curRange() {
    if (st.range) return st.range;
    return U.preset(narrow() ? 'next14' : 'next30');
  }
  function presetFor(len) { return { 7: 'next7', 14: 'next14', 30: 'next30', 60: 'next60', 90: 'next90' }[len] || null; }
  function rowHeight(n) {
    if (DENSITY_PX[st.density]) return DENSITY_PX[st.density];
    for (var i = 0; i < AUTO_STEPS.length; i++) if (n <= AUTO_STEPS[i][0]) return AUTO_STEPS[i][1];
    return 22;
  }
  function shortTime(t) { return fmt.time(t).replace(':00 ', ' '); }
  /* width of a label in the bar font. Canvas uses the same fonts as the page, so a name is only shown when it really fits. */
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

  /* ---------------- demo units for the density preview (never added to O.data) ---------------- */
  var DEMO_GUESTS = ['Aiman Hakim', 'Jia Wen Lee', 'Sanjay Pillai', 'Nurul Huda', 'Kevin Teo', 'Laura Schmidt', 'Rina Sato', 'Daniel Park', 'Aisha Rahman', 'Tom Hughes',
    'Mei Chen', 'Hiro Watanabe', 'Sara Lindqvist', 'Imran Shah', 'Chloe Tan', 'Lucas Moreau', 'Ana Souza', 'Vikram Iyer', 'Emily Clarke', 'Faizal Omar',
    'Yong Li Ting', 'Oliver Grant', 'Putri Ayu', 'Jun Ho Lee', 'Elena Rossi', 'Kumar Raj', 'Hana Yamada', 'Ryan Lim', 'Nadia Karim', 'Sophie Weber'];
  var DEMO_TYPES = ['Studio', '1BR apartment', '2BR condo', '2BR loft', '3BR villa'];
  var demoCache = {};
  function demoUnit(k) { /* k = 13, 14, ... */
    if (demoCache['u' + k]) return demoCache['u' + k];
    var r = D.rng(D.hash('demo-unit-' + k));
    var u = { id: 'demo' + k, name: 'Demo unit ' + k, short: 'Unit ' + k, type: DEMO_TYPES[Math.floor(r() * DEMO_TYPES.length)], area: 'Preview only', demo: true };
    var list = [], day = '2026-06-01', n = 0, occ = 0.55 + r() * 0.35;
    while (day < '2027-01-31') {
      var horizon = d.diff(T, day), fill = horizon <= 0 ? occ : horizon < 30 ? occ * 0.92 : horizon < 60 ? occ * 0.6 : occ * 0.3;
      var gap = r() < fill ? (r() < 0.6 ? 0 : 1) : 1 + Math.floor(r() * 4);
      var lr = r(), los = lr < 0.12 ? 1 : lr < 0.42 ? 2 : lr < 0.68 ? 3 : lr < 0.82 ? 4 : lr < 0.9 ? 5 : lr < 0.95 ? 6 : 7;
      var ci = d.add(day, gap), co = d.add(ci, los);
      var x = r(), ch = x < 0.45 ? 'airbnb' : x < 0.67 ? 'booking' : x < 0.8 ? 'agoda' : x < 0.88 ? 'vrbo' : 'direct';
      var status = co <= T ? 'checked_out' : ci < T ? 'checked_in' : (horizon > 3 && r() < 0.04 ? 'pending' : 'confirmed');
      var nightly = 140 + Math.round(r() * 30) * 10;
      list.push({ id: 'DEMO-' + k + '-' + (++n), demo: true, propertyId: u.id, guest: { name: DEMO_GUESTS[Math.floor(r() * DEMO_GUESTS.length)], countryName: '' }, guests: 1 + Math.floor(r() * 4), channel: ch, checkIn: ci, checkOut: co, nights: los, checkInTime: '15:00', checkOutTime: '11:00', status: status, total: nightly * los + 80, sameDay: false });
      day = co;
    }
    u.bookings = list;
    demoCache['u' + k] = u;
    return u;
  }

  /* ---------------- which rows are shown ---------------- */
  function realProps() {
    if (!st.prop) return D.properties.slice();
    if (st.prop.indexOf('area:') === 0) { var a = st.prop.slice(5); return D.properties.filter(function (p) { return region(p) === a; }); }
    return D.properties.filter(function (p) { return p.id === st.prop; });
  }
  function shownProps() {
    var r = realProps();
    if (!st.prop && st.preview > r.length) for (var k = r.length + 1; k <= st.preview; k++) r.push(demoUnit(k));
    return r;
  }
  function bookingsOf(p) { return p.demo ? p.bookings : D.bookings.filter(function (b) { return b.propertyId === p.id; }); }
  function blocksOf(p) { return p.demo ? [] : D.blocks.filter(function (x) { return x.propertyId === p.id; }); }
  function passStatus(b) { return st.status.length ? st.status.indexOf(b.status) >= 0 : live(b); }
  function passPlat(b) { return !st.plat.length || st.plat.indexOf(b.channel) >= 0; }
  function blocksShown() { return !st.status.length || st.status.indexOf('block') >= 0; }
  function filtersActive() { return st.status.length || st.plat.length; }

  /* is the night `iso` taken at property p (live booking or block)? */
  function nightTaken(p, iso) {
    return bookingsOf(p).some(function (b) { return live(b) && b.checkIn <= iso && iso < b.checkOut; }) ||
      blocksOf(p).some(function (x) { return x.start <= iso && iso < x.end; });
  }
  /* the free stretch around a free night: [first free night, first taken night) */
  function freeSpan(p, iso) {
    var a = iso, z = iso, i = 0;
    while (i++ < 120 && !nightTaken(p, d.add(a, -1)) && d.add(a, -1) >= '2026-06-01') a = d.add(a, -1);
    i = 0; while (i++ < 120 && !nightTaken(p, z)) z = d.add(z, 1);
    return { from: a, to: z, capped: i >= 120 };
  }

  /* ---------------- tooltip ---------------- */
  var SHORT = { 'Clean not started': 'Not cleaned', 'Code held until ID': 'Code held', 'House rules accepted': 'Rules accepted' };
  function tipFor(b, p) {
    if (b.isBlock) {
      return '<div class="ct-n">' + (b.type === 'owner' ? 'Owner stay' : 'Maintenance') + '</div>' +
        '<div class="ct-r"><span class="st block"><i></i>Blocked</span><span class="small muted">' + esc(p.short) + '</span></div>' +
        '<dl class="kv"><dt>Nights</dt><dd>' + d.fmtRange(b.start, d.add(b.end, -1)) + ' · ' + fmt.plural(d.diff(b.start, b.end), 'night') + '</dd>' + (b.note ? '<dt>Note</dt><dd>' + esc(b.note) + '</dd>' : '') + '</dl>' +
        '<div class="ct-f">Not bookable on any platform. Click to edit or remove.</div>';
    }
    var arriving = b.status !== 'cancelled' && b.status !== 'checked_out' && b.checkOut > T;
    var chips = '';
    if (!b.demo && arriving && b.status !== 'checked_in') {
      chips = '<div class="ready">' + O.readiness(b).filter(function (r) { return r.label !== 'No turnover needed'; }).map(function (r) { return '<span class="rd ' + r.state + '">' + esc(SHORT[r.label] || r.label) + '</span>'; }).join('') + '</div>';
    }
    return '<div class="ct-n">' + esc(b.guest.name) + (b.sameDay ? '<span class="pill accent">⚡ Same-day</span>' : '') + '</div>' +
      '<div class="ct-r">' + U.status(b.status) + U.plat(b.channel) + '</div>' +
      '<dl class="kv"><dt>Stay</dt><dd>' + d.fmtRange(b.checkIn, b.checkOut) + ' · ' + fmt.plural(b.nights, 'night') + '</dd>' +
      '<dt>Check-in / out</dt><dd>' + shortTime(b.checkInTime) + ' / ' + shortTime(b.checkOutTime) + '</dd>' +
      '<dt>Guests</dt><dd>' + b.guests + '</dd><dt>Total</dt><dd>' + fmt.money(b.total) + '</dd>' +
      (b.demo ? '' : '<dt>Booking</dt><dd>' + esc(b.id) + '</dd>') + '</dl>' + chips +
      '<div class="ct-f">' + (b.demo ? 'Demo booking for the density preview' : 'Click to open the booking') + '</div>';
  }

  /* ---------------- block dates (new / edit) ---------------- */
  function openBlock(o) {
    o = o || {};
    var bl = o.block || null;
    var pid0 = bl ? bl.propertyId : (o.propertyId && D.propById[o.propertyId] ? o.propertyId : D.properties[0].id);
    var first0 = bl ? bl.start : (o.start && o.start >= T ? o.start : T);
    var last0 = bl ? d.add(bl.end, -1) : (o.last && o.last >= first0 ? o.last : first0);
    var type = bl ? bl.type : (o.type || 'maintenance');
    var body = O.html('<div class="stack">' +
      '<div class="field"><label>Property</label><select class="select" name="pid">' + U.propOptions(pid0) + '</select></div>' +
      '<div class="form-grid"><div class="field"><label>First night</label><input type="date" class="input" name="a" value="' + first0 + '"></div>' +
      '<div class="field"><label>Last night</label><input type="date" class="input" name="z" value="' + last0 + '"></div></div>' +
      '<div class="field"><label>Reason</label>' + U.seg([['maintenance', 'Maintenance'], ['owner', 'Owner stay']], type, 'data-type') + '</div>' +
      '<div class="field"><label>Note</label><input class="input" name="note" maxlength="120" placeholder="For example: aircon service, owner family visit" value="' + esc(bl ? bl.note || '' : '') + '"></div>' +
      '<div class="blk-sum" role="status"></div>' +
      '<div class="xs muted">Blocked nights close the unit on Airbnb, Booking.com, Agoda, Vrbo and your website. Prototype: platform calendars are not really updated.</div></div>');
    function vals() { return { pid: O.$('[name=pid]', body).value, a: O.$('[name=a]', body).value, z: O.$('[name=z]', body).value, note: O.$('[name=note]', body).value.trim() }; }
    function problems(v) {
      var err = [];
      if (!v.a || !v.z) { err.push('Choose the first and last night.'); return err; }
      if (v.z < v.a) { err.push('The last night must be on or after the first night.'); return err; }
      if (v.a < T && !(bl && v.a === bl.start)) err.push('Blocks can only start today or later.');
      if (d.diff(v.a, v.z) + 1 > 90) err.push('A block can be at most 90 nights.');
      var end = d.add(v.z, 1), p = D.propById[v.pid];
      D.bookings.forEach(function (b) { if (b.propertyId === v.pid && live(b) && b.checkIn < end && v.a < b.checkOut) err.push(b.guest.name + ' is booked ' + d.fmtRange(b.checkIn, b.checkOut) + ' (' + U.platName(b.channel) + ').'); });
      D.blocks.forEach(function (x) { if (x !== bl && x.propertyId === v.pid && x.start < end && v.a < x.end) err.push(p.short + ' is already blocked ' + d.fmtRange(x.start, d.add(x.end, -1)) + '.'); });
      return err;
    }
    function update() {
      var v = vals(), err = problems(v), box = O.$('.blk-sum', body), p = D.propById[v.pid];
      box.className = 'blk-sum ' + (err.length ? 'bad' : 'ok');
      if (err.length) box.innerHTML = '<b>Cannot block these nights.</b> ' + esc(err[0]) + (err.length > 1 ? ' And ' + (err.length - 1) + ' more.' : '');
      else { var n = d.diff(v.a, v.z) + 1; box.innerHTML = '<b>' + fmt.plural(n, 'night') + '</b> at ' + esc(p.short) + ': ' + esc(d.fmtY(v.a)) + (n > 1 ? ' to ' + esc(d.fmtY(v.z)) : '') + '. Lost at your current prices: about <b>' + fmt.money(d.range(v.a, v.z).reduce(function (s, x) { return s + rateOf(v.pid, x); }, 0)) + '</b>.'; }
    }
    body.addEventListener('input', update);
    body.addEventListener('change', function (e) { if (e.target.name === 'a') { var z = O.$('[name=z]', body); if (!z.value || z.value < e.target.value) z.value = e.target.value; } update(); });
    body.addEventListener('click', function (e) { var b = e.target.closest('[data-type]'); if (!b) return; type = b.dataset.type; O.$$('[data-type]', body).forEach(function (x) { x.classList.toggle('on', x === b); }); });
    update();
    function save(close) {
      var v = vals(), err = problems(v);
      if (err.length) { update(); return false; }
      var p = D.propById[v.pid], end = d.add(v.z, 1), n = d.diff(v.a, end);
      if (bl) { bl.propertyId = v.pid; bl.start = v.a; bl.end = end; bl.type = type; bl.note = v.note; }
      else {
        var max = D.blocks.reduce(function (m, x) { return Math.max(m, +String(x.id).split('-')[1] || 0); }, 0);
        D.blocks.push({ id: 'BL-' + (max + 1), propertyId: v.pid, start: v.a, end: end, type: type, note: v.note });
      }
      U.toast((bl ? 'Block updated: ' : 'Blocked ') + p.short + ' for ' + fmt.plural(n, 'night') + ' (' + (n === 1 ? d.fmt(v.a) : d.fmtRange(v.a, v.z)) + '). All platform calendars are closed for these nights.');
      O.emit('data', { type: 'block' });
    }
    var actions = [{ label: 'Cancel' }, { label: bl ? 'Save changes' : 'Block dates', kind: 'primary', onClick: save }];
    if (bl) actions.unshift({
      label: 'Remove block', kind: 'danger', onClick: function () {
        var i = D.blocks.indexOf(bl); if (i >= 0) D.blocks.splice(i, 1);
        U.toast('Block removed. ' + D.propById[bl.propertyId].short + ' is bookable again for ' + d.fmtRange(bl.start, d.add(bl.end, -1)) + '.');
        O.emit('data', { type: 'block' });
      }
    });
    U.modal({ title: bl ? 'Blocked dates' : 'Block dates', sub: bl ? (bl.type === 'owner' ? 'Owner stay' : 'Maintenance') + ' at ' + D.propById[bl.propertyId].name : 'Close a unit for maintenance or an owner stay.', body: body, actions: actions });
  }
  O.blockDates = openBlock; /* other sections may reuse it */

  function newBooking(pid, ci, co) {
    var o = { propertyId: pid, checkIn: ci, checkOut: co, onCreated: function (b) { st.flash = b.id; } };
    if (O.newBooking) O.newBooking(o); else O.go('bookings', { new: true, propertyId: pid, checkIn: ci });
  }

  /* ---------------- page ---------------- */
  O.page('calendar', {
    desc: 'Every property on one timeline',
    render: function (root, ctx) {
      if (ctx.fresh && ctx.params) {
        var pp = ctx.params;
        if (pp.propertyId && D.propById[pp.propertyId]) st.prop = pp.propertyId;
        if (pp.from && pp.to) st.range = { from: pp.from, to: pp.to, preset: null };
      }
      var R = curRange();
      ctx.setActions('<button type="button" class="btn btn-ghost" data-act="block">' + O.icon('lock') + 'Block dates</button><button type="button" class="btn btn-primary" data-act="new">' + O.icon('plus') + 'New booking</button>');
      O.$('[data-act=block]', ctx.actionsEl).onclick = function () { openBlock({ propertyId: st.prop && D.propById[st.prop] ? st.prop : undefined }); };
      O.$('[data-act=new]', ctx.actionsEl).onclick = function () { newBooking(st.prop && D.propById[st.prop] ? st.prop : undefined); };

      var propOpts = '<option value="">All properties</option><optgroup label="Areas">' + regions().map(function (r) {
        var n = D.properties.filter(function (p) { return region(p) === r; }).length;
        return '<option value="area:' + esc(r) + '"' + (st.prop === 'area:' + r ? ' selected' : '') + '>' + esc(r) + ' (' + n + ')</option>';
      }).join('') + '</optgroup><optgroup label="Properties">' + U.propOptions(st.prop) + '</optgroup>';

      root.innerHTML = '<div class="pg-calendar">' +
        '<div class="cal-tools"><span data-slot="range"></span>' +
        '<div class="cal-nav"><button type="button" class="icon-btn" data-nav="-1" aria-label="Previous period" title="Previous period">' + O.icon('left') + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-nav="0">Today</button>' +
        '<button type="button" class="icon-btn" data-nav="1" aria-label="Next period" title="Next period">' + O.icon('right') + '</button></div>' +
        '<select class="select" data-f="prop" aria-label="Properties">' + propOpts + '</select></div>' +
        '<div class="cal-dyn"></div></div>';
      var wrap = O.$('.pg-calendar', root), dyn = O.$('.cal-dyn', wrap);

      U.mount(wrap, 'range', U.dateRange({
        from: R.from, to: R.to, preset: R.preset, presets: RANGE_PRESETS,
        onChange: function (r) {
          var len = d.diff(r.from, r.to) + 1;
          if (len > MAX_DAYS) { U.toast('Choose up to ' + MAX_DAYS + ' days at a time', 'bad'); r = { from: r.from, to: d.add(r.from, MAX_DAYS - 1), preset: null }; }
          st.range = { from: r.from, to: r.to, preset: r.preset }; st.scroll = null; ctx.rerender();
        }
      }));

      /* tooltip + menu live on the page wrapper (position: fixed) */
      var tip = O.html('<div class="cal-tip" role="tooltip"></div>');
      wrap.appendChild(tip);
      var menu = null;
      function closeMenu() { if (menu) { menu.remove(); menu = null; document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onEsc); } }
      function outside(e) { if (menu && !menu.contains(e.target)) closeMenu(); }
      function onEsc(e) { if (e.key === 'Escape') closeMenu(); }

      var G = {}; /* geometry of the last paint: from, to, days, dw, props */

      function chip(attr, val, on, inner, count, title) {
        return '<button type="button" class="chip' + (on ? ' on' : '') + '" ' + attr + '="' + val + '" aria-pressed="' + (on ? 'true' : 'false') + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + inner + ' <span class="n">' + count + '</span></button>';
      }

      function paint() {
        var from = R.from, to = R.to, days = d.diff(from, to) + 1;
        var props = shownProps(), real = realProps();
        var inR = function (b) { return b.checkIn <= to && b.checkOut >= from; };
        var all = [];
        props.forEach(function (p) { bookingsOf(p).forEach(function (b) { if (inR(b)) all.push(b); }); });
        var blks = [];
        props.forEach(function (p) { blocksOf(p).forEach(function (x) { if (x.start <= to && x.end > from) blks.push(x); }); });

        /* chips: counts reflect the other filter */
        var forSt = all.filter(passPlat), forPl = all.filter(passStatus);
        var stChips = chip('data-st', 'all', !st.status.length, 'All', forSt.filter(live).length + blks.length, 'All bookings except cancelled, plus blocked dates') +
          STATUS_KEYS.map(function (s) {
            return chip('data-st', s, st.status.indexOf(s) >= 0, '<i class="sw" style="background:var(--st-' + ST_VAR[s] + ')"></i>' + esc(U.statusLabel(s)), forSt.filter(function (b) { return b.status === s; }).length);
          }).join('') +
          chip('data-st', 'block', st.status.indexOf('block') >= 0, '<i class="sw sw-block"></i>Blocked', blks.length);
        var plChips = chip('data-pl', 'all', !st.plat.length, 'All', forPl.length) + D.channelOrder.map(function (c) {
          return chip('data-pl', c, st.plat.indexOf(c) >= 0, U.platIcon(c) + esc(U.platName(c)), forPl.filter(function (b) { return b.channel === c; }).length);
        }).join('');

        /* stats for the real properties shown (demo units never count) */
        var sold = 0, avail = 0, blocked = 0;
        real.forEach(function (p) { sold += M.nightsSold(from, to, { propertyId: p.id }); avail += M.availableNights(from, to, p.id); blocked += M.blockedNights(from, to, p.id); });
        var realIds = real.map(function (p) { return p.id; });
        var arr = D.bookings.filter(function (b) { return live(b) && realIds.indexOf(b.propertyId) >= 0 && b.checkIn >= from && b.checkIn <= to; }).length;
        var dep = D.bookings.filter(function (b) { return live(b) && realIds.indexOf(b.propertyId) >= 0 && b.checkOut >= from && b.checkOut <= to; }).length;
        var occ = avail ? sold / avail : 0;
        var rh = rowHeight(props.length);
        var scope = st.prop ? (st.prop.indexOf('area:') === 0 ? st.prop.slice(5) : D.propById[st.prop].short) : 'All properties';

        var demoN = props.length - real.length;
        var previewSeg = '<div class="seg" role="group" aria-label="Preview with more properties">' + PREVIEW.map(function (n) {
          var dis = !!st.prop && n !== 12;
          return '<button type="button" data-prev="' + n + '" class="' + ((st.prop ? 12 : st.preview) === n ? 'on' : '') + '"' + (dis ? ' disabled title="Choose All properties to preview more units"' : '') + '>' + n + '</button>';
        }).join('') + '</div>';

        dyn.innerHTML =
          '<div class="cal-chips"><div class="chips"><span class="chip-group-label">Status</span>' + stChips + '</div>' +
          '<div class="chips"><span class="chip-group-label">Platform</span>' + plChips + '</div></div>' +
          '<div class="card cal-card">' +
          '<div class="cal-head-row"><div class="cal-title"><h3>' + esc(scope) + ' · ' + esc(U.rangeLabel(from, to)) + '</h3>' +
          '<div class="cal-stats"><span><b>' + fmt.pct(occ) + '</b> occupied</span><span><b>' + fmt.num(sold) + '</b> of ' + fmt.num(avail) + ' nights booked</span><span><b>' + arr + '</b> ' + (arr === 1 ? 'arrival' : 'arrivals') + '</span><span><b>' + dep + '</b> ' + (dep === 1 ? 'departure' : 'departures') + '</span><span><b>' + fmt.num(avail - sold) + '</b> open nights</span>' + (blocked ? '<span><b>' + blocked + '</b> blocked</span>' : '') + '</div></div>' +
          '<div class="cal-ctrls"><div class="cal-ctrl"><span class="lbl">Row size</span>' + U.seg(DENSITY, st.density, 'data-dens') + '<span class="hint">' + rh + 'px rows for ' + props.length + ' ' + (props.length === 1 ? 'property' : 'properties') + '</span></div>' +
          '<div class="cal-ctrl"><span class="lbl">Preview with more properties</span>' + previewSeg + '</div></div></div>' +
          (demoN > 0 ? '<div class="note brand cal-demo"><span class="grow"><b>Preview:</b> ' + demoN + ' demo units added after your ' + real.length + ' properties, so you can see rows get thinner as the portfolio grows. Demo units are not saved and are left out of the totals.</span><button type="button" class="btn btn-ghost btn-sm" data-prev="12">Show my ' + real.length + ' properties</button></div>' : '') +
          '<div class="cal-scroll" tabindex="-1"></div>' +
          '<div class="cal-legend">' +
          '<span class="lg"><span class="lg-bar">' + U.platIcon('airbnb') + 'Guest name</span>Bar colour shows the booking status, the logo shows the platform</span></div>' +
          '<div class="cal-legend cal-legend-2"><span class="lg-g"><span class="lg-t">Status</span><span class="lg"><i class="sw" style="background:var(--st-confirmed)"></i>Confirmed</span><span class="lg"><i class="sw" style="background:var(--st-inhouse)"></i>In-house</span><span class="lg"><i class="sw" style="background:var(--st-pending)"></i>Pending</span><span class="lg"><i class="sw" style="background:var(--st-past)"></i>Checked out</span>' + (st.status.indexOf('cancelled') >= 0 ? '<span class="lg"><i class="sw" style="background:var(--st-cancelled)"></i>Cancelled</span>' : '') + '<span class="lg"><i class="sw sw-block"></i>Blocked</span></span>' +
          '<span class="lg-g"><span class="lg-t">Platform</span>' + D.channelOrder.map(function (c) { return '<span class="lg">' + U.platIcon(c) + esc(U.platName(c)) + '</span>'; }).join('') + '</span>' +
          '<span class="lg-g"><span class="lg-t">Grid</span><span class="lg"><i class="lg-now"></i>Now</span><span class="lg"><i class="lg-we"></i>Fri &amp; Sat nights</span><span class="lg"><i class="lg-ev"></i>Local event</span></span>' +
          '</div><div class="cal-note">Bars start at check-in in the afternoon and end at check-out in the morning, so a turnover day shows both guests. Click a free night to add a booking or block dates.</div>' +
          '</div>';

        var scroll = O.$('.cal-scroll', dyn);
        G = { from: from, to: to, days: days, props: props, rh: rh, scroll: scroll };
        paintGrid();

        if (window.ResizeObserver) {
          var ro = new ResizeObserver(function () {
            if (!document.body.contains(scroll)) { ro.disconnect(); return; }
            if (Math.abs(scroll.clientWidth - (G.cw || 0)) > 4) paintGrid();
          });
          ro.observe(scroll);
        }
        scroll.addEventListener('scroll', function () { st.scroll = { l: scroll.scrollLeft, t: scroll.scrollTop }; tip.style.display = 'none'; closeMenu(); }, { passive: true });
      }

      function paintGrid() {
        var scroll = G.scroll; if (!scroll) return;
        var from = G.from, to = G.to, days = G.days, props = G.props, rh = G.rh;
        var cw = scroll.clientWidth, pc = narrow() ? 92 : 120;
        var dw = Math.max(MIN_DW, Math.floor((cw - pc) / days * 100) / 100);
        var lw = dw * days;
        G.cw = cw; G.dw = dw; G.pc = pc;
        var tight = rh < 30, two = rh >= 44;
        var bh = two ? rh - 10 : tight ? Math.max(15, rh - 6) : rh - 8;
        var ic = two ? 20 : tight ? 14 : 17, fs = tight ? 10.5 : 12;
        var X = function (iso) { return (d.diff(from, iso) + 0.5) * dw; };
        var iToday = d.diff(from, T);

        /* header: months + days */
        var months = '', dayCells = '', seg = null;
        for (var i = 0; i < days; i++) {
          var iso = d.add(from, i);
          if (!seg || iso.slice(0, 7) !== seg.m) { if (seg) months += monthCell(seg); seg = { m: iso.slice(0, 7), i0: i, n: 0, iso: iso }; }
          seg.n++;
          var we = d.isWeekend(iso), ev = eventsOn(iso, props);
          dayCells += '<div class="cal-d' + (we ? ' we' : '') + (iso === T ? ' today' : '') + '" style="left:' + (i * dw).toFixed(2) + 'px;width:' + dw.toFixed(2) + 'px" title="' + esc(d.dowName(iso) + ' ' + d.fmtY(iso) + (we ? ' · weekend night' : '') + (ev.length ? ' · ' + ev.join(', ') : '')) + '">' +
            '<span class="n">' + d.day(iso) + '</span>' + (dw >= 26 ? '<span class="w">' + d.dowName(iso).slice(0, dw >= 30 ? 3 : 2) + '</span>' : '') + (ev.length ? '<i class="ev"></i>' : '') + '</div>';
        }
        if (seg) months += monthCell(seg);
        function monthCell(sg) {
          var w = sg.n * dw, lbl = w >= 110 ? d.monthName(sg.iso, true) + ' ' + sg.iso.slice(0, 4) : w >= 34 ? d.monthName(sg.iso) : '';
          return '<div class="cal-mo" style="left:' + (sg.i0 * dw).toFixed(2) + 'px;width:' + w.toFixed(2) + 'px">' + esc(lbl) + '</div>';
        }

        /* column overlays: weekends, today, now */
        var cols = '';
        for (var j = 0; j < days; j++) { var dj = d.add(from, j); if (d.isWeekend(dj)) cols += '<i class="we" style="left:' + (j * dw).toFixed(2) + 'px;width:' + dw.toFixed(2) + 'px"></i>'; }
        if (iToday >= 0 && iToday < days) {
          cols += '<i class="td" style="left:' + (iToday * dw).toFixed(2) + 'px;width:' + dw.toFixed(2) + 'px"></i>';
          var hm = D.NOW_TIME.split(':');
          cols += '<i class="now" style="left:' + ((iToday + (+hm[0] + hm[1] / 60) / 24) * dw).toFixed(2) + 'px" title="Now, ' + fmt.time(D.NOW_TIME) + '"></i>';
        }

        /* rows */
        var occByDay = new Array(days).fill(0);
        var rowsHTML = props.map(function (p) {
          var bars = '';
          var list = bookingsOf(p).filter(function (b) { return b.checkIn <= to && b.checkOut >= from; });
          list.forEach(function (b) {
            if (live(b)) for (var k = Math.max(0, d.diff(from, b.checkIn)); k < Math.min(days, d.diff(from, b.checkOut)); k++) occByDay[k]++;
          });
          var shown = list.filter(function (b) { return passStatus(b) && passPlat(b); });
          shown.sort(function (a, b) { return (a.status === 'cancelled') - (b.status === 'cancelled'); });
          shown.forEach(function (b) { bars += barHTML(b, X(b.checkIn), X(b.checkOut)); });
          if (blocksShown()) blocksOf(p).forEach(function (x) { if (x.start <= to && x.end >= from) bars += blockHTML(x, X(x.start), X(x.end)); });
          var nights = p.demo ? 0 : M.nightsSold(from, to, { propertyId: p.id }), av = p.demo ? 0 : M.availableNights(from, to, p.id);
          var sub = p.demo ? p.type : av ? fmt.pct(nights / av) + ' booked' : 'Blocked';
          var propCell = p.demo
            ? '<div class="cal-prop" title="Demo unit for the density preview"><span class="pn"><span>' + esc(p.short) + '</span><span class="demo-tag">DEMO</span></span>' + (rh >= 36 ? '<span class="ps">' + esc(sub) + '</span>' : '') + '</div>'
            : '<button type="button" class="cal-prop" data-prop="' + p.id + '" title="' + esc(p.name + ' · ' + p.type + ' · ' + p.area + ' · ' + sub + ' in this range. Click to see its bookings.') + '"><span class="pn"><span>' + esc(p.short) + '</span></span>' + (rh >= 36 ? '<span class="ps">' + esc(sub) + '</span>' : '') + '</button>';
          return '<div class="cal-row' + (p.demo ? ' demo' : '') + '" style="height:' + rh + 'px">' + propCell +
            '<div class="cal-lane" data-pid="' + p.id + '" style="width:' + lw.toFixed(2) + 'px">' + bars + '</div></div>';
        }).join('');

        function clip(a, z) { return { a: Math.max(a, 0), z: Math.min(z, lw), cl: a < 0, cr: z > lw }; }
        function barHTML(b, a, z) {
          var c = clip(a, z); var left = c.a + (c.cl ? 0 : 1.5), w = c.z - left - (c.cr ? 0 : 1.5);
          if (w < 4) return '';
          var nm = b.guest.name, nts = fmt.plural(b.nights, 'night');
          var showIc = w >= 14, icPx = Math.max(10, Math.min(ic, bh - 2, Math.floor(w - 4)));
          var avail = w - (showIc ? icPx + 5 : 0) - 10 - (b.sameDay ? 11 : 0);
          var fits = function (str, px, wt) { return textW(str, px || fs, wt || 800) <= avail; };
          var first = nm.replace(/^The /, '').split(' ')[0];
          var label = fits(nm) ? nm : (fits(first) || fits('Mmmmm…')) ? first : ''; /* a cut first name keeps about 5 letters, otherwise logo only */
          var inner = '';
          if (label) {
            var sd = b.sameDay ? '<span class="sdm" aria-hidden="true">⚡</span>' : '';
            if (two) {
              var s2 = nts + ' · ' + fmt.plural(b.guests, 'guest'), sub = fits(s2, 10.5, 600) ? s2 : fits(nts, 10.5, 600) ? nts : '';
              inner = '<span class="cb-t"><span class="cb-n">' + sd + esc(label) + '</span>' + (sub ? '<span class="cb-s">' + sub + '</span>' : '') + '</span>';
            } else {
              inner = '<span class="cb-t"><span class="cb-n">' + sd + esc(label) + (label === nm && fits(nm + ' · ' + nts) ? '<span class="cb-s" style="font-size:inherit"> · ' + nts + '</span>' : '') + '</span></span>';
            }
          }
          var cls = 'cal-bar s-' + b.status + (c.cl ? ' clipL' : '') + (c.cr ? ' clipR' : '') + (st.flash === b.id ? ' flash' : '');
          var lbl = nm + ', ' + U.platName(b.channel) + ', ' + U.statusLabel(b.status) + ', ' + d.fmtRange(b.checkIn, b.checkOut) + ', ' + nts;
          return '<button type="button" class="' + cls + '" data-id="' + esc(b.id) + '" data-pid="' + b.propertyId + '" aria-label="' + esc(lbl) + '" style="left:' + left.toFixed(1) + 'px;width:' + w.toFixed(1) + 'px;top:' + ((rh - bh) / 2 - 0.5).toFixed(1) + 'px;height:' + bh + 'px;--ic:' + icPx + 'px;--fs:' + fs + 'px">' +
            (showIc ? U.platIcon(b.channel) : '') + inner + '</button>';
        }
        function blockHTML(x, a, z) {
          var c = clip(a, z); var left = c.a + (c.cl ? 0 : 1.5), w = c.z - left - (c.cr ? 0 : 1.5);
          if (w < 4) return '';
          var lbl = x.type === 'owner' ? 'Owner stay' : 'Maintenance';
          var room = w - (tight ? 10 : 12) - 3 - 5 - 8;
          var shown = textW(lbl, fs, 800) <= room ? lbl : (x.type === 'owner' && textW('Owner', fs, 800) <= room ? 'Owner' : '');
          return '<button type="button" class="cal-bar s-block' + (c.cl ? ' clipL' : '') + (c.cr ? ' clipR' : '') + '" data-block="' + esc(x.id) + '" aria-label="' + esc('Blocked: ' + lbl + ', ' + d.fmtRange(x.start, d.add(x.end, -1))) + '" style="left:' + left.toFixed(1) + 'px;width:' + w.toFixed(1) + 'px;top:' + ((rh - bh) / 2 - 0.5).toFixed(1) + 'px;height:' + bh + 'px;--fs:' + fs + 'px">' +
            sizeIcon(O.icon(x.type === 'owner' ? 'home' : 'lock'), tight ? 10 : 12) + (shown ? '<span class="cb-t"><span class="cb-n">' + esc(shown) + '</span></span>' : '') + '</button>';
        }

        /* daily booked units */
        var n = props.length, foot = '';
        for (var q = 0; q < days; q++) {
          var v = occByDay[q], share = n ? v / n : 0, dq = d.add(from, q);
          foot += '<div class="cal-oc" title="' + esc(d.dowName(dq) + ' ' + d.fmt(dq) + ': ' + v + ' of ' + n + ' units booked (' + fmt.pct(share) + ')') + '" style="left:' + (q * dw + 1.5).toFixed(2) + 'px;width:' + (dw - 3).toFixed(2) + 'px"><i style="opacity:' + (0.06 + share * 0.34).toFixed(2) + '"></i><span>' + v + '</span></div>';
        }

        scroll.innerHTML = '<div class="cal-track' + (tight ? ' cal-tight' : '') + '" style="width:' + (pc + lw).toFixed(2) + 'px">' +
          '<div class="cal-hd"><div class="cal-corner"><b>' + fmt.plural(n, 'unit') + '</b>' + (days > 1 ? fmt.plural(days, 'day') : '1 day') + '</div><div class="cal-days" style="width:' + lw.toFixed(2) + 'px">' + months + dayCells + '</div></div>' +
          '<div class="cal-body"><div class="cal-cols" style="left:' + pc + 'px;width:' + lw.toFixed(2) + 'px">' + cols + '</div>' + rowsHTML + '</div>' +
          '<div class="cal-ft"><div class="cal-corner" title="Units with a guest staying that night">Booked units</div><div class="cal-days" style="width:' + lw.toFixed(2) + 'px">' + foot + '</div></div>' +
          '</div>';

        /* keep the scroll position across repaints; otherwise start near today */
        if (st.scroll) { scroll.scrollLeft = st.scroll.l; scroll.scrollTop = st.scroll.t; }
        else if (iToday > 1 && iToday < days && pc + lw > cw) scroll.scrollLeft = (iToday - 1) * dw;
        if (st.flash) {
          var fb = O.$('.cal-bar.flash', scroll);
          if (fb) {
            var bx = fb.offsetLeft, by = fb.parentNode.parentNode.offsetTop;
            if (bx < scroll.scrollLeft || bx > scroll.scrollLeft + cw - pc - 40) scroll.scrollLeft = Math.max(0, bx - 60);
            if (by < scroll.scrollTop || by > scroll.scrollTop + scroll.clientHeight - 80) scroll.scrollTop = Math.max(0, by - 80);
            try { scroll.scrollIntoView({ block: 'nearest' }); } catch (e) { /* older browsers */ }
          }
          st.flash = null;
        }
      }

      function eventsOn(iso, props) {
        return D.events.filter(function (e) {
          return iso >= e.date && iso <= e.end && props.some(function (p) { return !p.demo && e.areas.some(function (a) { return p.area.indexOf(a) >= 0; }); });
        }).map(function (e) { return e.name; });
      }

      /* ---------------- events ---------------- */
      function findBooking(id, pid) {
        if (id.indexOf('DEMO-') === 0) { var u = G.props.filter(function (p) { return p.id === pid; })[0]; return u ? u.bookings.filter(function (b) { return b.id === id; })[0] : null; }
        return D.booking(id);
      }
      function propOf(pid) { return D.propById[pid] || G.props.filter(function (p) { return p.id === pid; })[0]; }

      wrap.addEventListener('click', function (e) {
        var t = e.target.closest('button');
        if (t && wrap.contains(t)) {
          if (t.dataset.nav != null) {
            var nv = +t.dataset.nav, len = G.days || (d.diff(R.from, R.to) + 1);
            var wholeMonth = R.from === d.monthStart(R.from) && R.to === d.monthEnd(R.from);
            if (wholeMonth) {
              var ms = nv === 0 ? d.monthStart(T) : d.addMonths(R.from, nv);
              st.range = { from: ms, to: d.monthEnd(ms), preset: ms === d.monthStart(T) ? 'thisMonth' : ms === d.addMonths(d.monthStart(T), 1) ? 'nextMonth' : null };
            } else if (nv === 0) st.range = { from: T, to: d.add(T, len - 1), preset: presetFor(len) };
            else st.range = { from: d.add(R.from, nv * len), to: d.add(R.to, nv * len), preset: null };
            st.scroll = null; ctx.rerender(); return;
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
            else { var jx = st.plat.indexOf(c); if (jx >= 0) st.plat.splice(jx, 1); else st.plat.push(c); }
            paint(); return;
          }
          if (t.dataset.dens) { st.density = t.dataset.dens; paint(); return; }
          if (t.dataset.prev) { if (t.disabled) return; st.preview = +t.dataset.prev; paint(); return; }
          if (t.dataset.prop) { O.go('bookings', { propertyId: t.dataset.prop, from: R.from, to: R.to }); return; }
          if (t.dataset.block) { tip.style.display = 'none'; var bl = D.blocks.filter(function (x) { return x.id === t.dataset.block; })[0]; if (bl) openBlock({ block: bl }); return; }
          if (t.dataset.id) {
            tip.style.display = 'none';
            if (t.dataset.id.indexOf('DEMO-') === 0) { U.toast('This is a demo unit for the density preview. Choose 12 to see only your properties.'); return; }
            O.booking.open(t.dataset.id); return;
          }
          return;
        }
        /* click on a free night → small menu */
        var lane = e.target.closest('.cal-lane'); if (!lane || !wrap.contains(lane)) return;
        var rect = lane.getBoundingClientRect(), idx = Math.floor((e.clientX - rect.left) / G.dw);
        if (idx < 0 || idx >= G.days) return;
        var iso = d.add(G.from, idx), p = propOf(lane.dataset.pid);
        if (!p || nightTaken(p, iso)) return;
        openMenu(p, iso, e.clientX, e.clientY);
      });

      function openMenu(p, iso, x, y) {
        closeMenu();
        var past = iso < T, span = p.demo ? null : freeSpan(p, iso);
        var freeN = span ? d.diff(iso, span.to) : 0;
        var head = '<div class="cm-h"><b>' + esc(p.short) + '</b><div class="s">' + esc(d.dowName(iso) + ' ' + d.fmtY(iso)) + (p.demo ? ' · demo unit' : past ? ' · past night' : ' · free night') + '</div>' +
          (span && !past ? '<div class="s">' + (span.capped ? 'Free for 120+ nights' : 'Free for ' + fmt.plural(freeN, 'night') + ' (until ' + esc(d.fmt(span.to)) + ')') + ' · your price ' + fmt.money(rateOf(p.id, iso)) + '</div>' : '') + '</div>';
        var dis = p.demo || past;
        var why = p.demo ? 'Demo units are for the density preview only.' : past ? 'This night has passed. New bookings and blocks start today or later.' : '';
        menu = O.html('<div class="cal-menu" role="menu">' + head +
          '<button type="button" class="cm-o" role="menuitem" data-m="new"' + (dis ? ' disabled' : '') + '>' + O.icon('plus') + '<span>New booking<span class="s">Direct booking from ' + esc(d.fmt(iso)) + '</span></span></button>' +
          '<button type="button" class="cm-o" role="menuitem" data-m="block"' + (dis ? ' disabled' : '') + '>' + O.icon('lock') + '<span>Block dates<span class="s">Maintenance or owner stay</span></span></button>' +
          (why ? '<div class="cm-x">' + esc(why) + '</div>' : '') + '</div>');
        document.body.appendChild(menu);
        var mw = menu.offsetWidth, mh = menu.offsetHeight;
        menu.style.left = Math.max(8, Math.min(x + 6, window.innerWidth - mw - 8)) + 'px';
        menu.style.top = Math.max(8, (y + 8 + mh > window.innerHeight - 8 ? y - mh - 8 : y + 8)) + 'px';
        menu.addEventListener('click', function (ev) {
          var b = ev.target.closest('[data-m]'); if (!b || b.disabled) return;
          var m = b.dataset.m; closeMenu();
          var co = d.add(iso, Math.max(1, Math.min(2, freeN || 1)));
          if (m === 'new') newBooking(p.id, iso, co);
          if (m === 'block') openBlock({ propertyId: p.id, start: iso, last: iso });
        });
        setTimeout(function () { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', onEsc); }, 0);
        var first = O.$('.cm-o:not([disabled])', menu); if (first) try { first.focus(); } catch (er) { /* ignore */ }
      }

      /* hover tooltip for bars */
      function placeTip(e) {
        var w = tip.offsetWidth, h = tip.offsetHeight, x = e.clientX + 14, y = e.clientY + 14;
        if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
        if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
        tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
      }
      wrap.addEventListener('mouseover', function (e) {
        var bar = e.target.closest('.cal-bar'); if (!bar) return;
        var html;
        if (bar.dataset.block) { var bl = D.blocks.filter(function (x) { return x.id === bar.dataset.block; })[0]; if (!bl) return; html = tipFor(Object.assign({ isBlock: true }, bl), D.propById[bl.propertyId]); }
        else { var b = findBooking(bar.dataset.id, bar.dataset.pid); if (!b) return; html = tipFor(b, propOf(b.propertyId)); }
        tip.innerHTML = html; tip.style.display = 'block'; placeTip(e);
      });
      wrap.addEventListener('mousemove', function (e) { if (tip.style.display === 'block' && e.target.closest('.cal-bar')) placeTip(e); });
      wrap.addEventListener('mouseout', function (e) { var bar = e.target.closest('.cal-bar'); if (bar && !bar.contains(e.relatedTarget)) tip.style.display = 'none'; });

      O.$('[data-f=prop]', wrap).onchange = function (e) { st.prop = e.target.value; st.scroll = null; paint(); };
      ctx.on('data', closeMenu);

      paint();
    }
  });
})();
