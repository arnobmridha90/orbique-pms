/* Orbique Command Center v4: Pricing
   An analyst's view of one property's prices for a date range:
   - KPI strip: our average, competitor average (with our position), occupancy on the books vs the market,
     expected revenue impact.
   - Chart: our price vs competitor average (min–max band) vs suggested; or this year vs last two years.
   - Per-night table with selection + apply (stored in D.priceOverrides[pid][iso], read by bookings/calendar too).
   - Reasoning panel: every suggestion is a chain of factors (in the building's currency) that add up exactly to the suggested price
     (base, season, weekend, local event, competitor gap, booking pace, days until arrival, orphan night,
     min/max rule, rounding).
   - Competitor set (include/exclude listings from the average), same-date history, pricing rules, portfolio overview.
   Competitor prices are sample figures (D.compSet / D.compPrice) until a market feed is connected.
   v4: permissions pricing.change (apply and set prices) and pricing.rules (rules and auto-apply); today is read at
   render time (D.TODAY), never cached; reading rules no longer writes defaults into D.pricingRules; empty workspace
   and properties without a base price or area are handled. */
(function () {
  var O = window.O, D = O.data, M = O.metrics, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  var st = {
    pid: '', from: null, to: null, preset: 'next30',
    view: 'all', chart: 'market', sel: {}, picked: {}, excl: {}, compSort: { k: 'avg', dir: -1 }
  };
  D.priceOverrides = D.priceOverrides || {};      /* {pid: {iso: price in the property's currency}} read by bookings, calendar and website */
  D.priceOverrideMeta = D.priceOverrideMeta || {}; /* {pid: {iso: {how:'suggestion'|'manual', by, at}}} who set an override and how */
  D.pricingRules = D.pricingRules || {};
  D.priceLog = D.priceLog || [];
  /* permissions (Staff access): pricing (view), pricing.change (apply suggestions, set a night's price),
     pricing.rules (edit rules, auto-apply, copy rules) */
  function canView() { return O.can('pricing', 'view'); }
  function canChange() { return O.can('pricing.change'); }
  function canRules() { return O.can('pricing.rules'); }
  var WHY_CHANGE = 'You can view prices. Changing them needs the "Change prices" permission, which an account owner can give in Staff access.';
  var WHY_RULES = 'Changing rules needs the "Edit pricing rules" permission, which an account owner can give in Staff access.';
  function audit(text) { D.auditLog = D.auditLog || []; D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: 'pricing', text: text }); }

  /* ------------------------------------------------------------------ styles */
  O.css('pricing', [
    '.pg-pricing{display:flex;flex-direction:column;gap:14px;}',
    '.pg-pricing .kpis{margin-bottom:0;}',
    '.pg-pricing .empty .e-icon{display:flex;justify-content:center;color:var(--faint);}',
    '.pg-pricing .empty .e-icon svg{width:26px;height:26px;}',
    '.pg-pricing .kpi .k-val small{font-size:12px;font-weight:700;color:var(--muted);margin-left:3px;}',
    '.pg-pricing .toolbar{margin-bottom:0;}',
    '.pg-pricing .pr-prop{min-width:240px;max-width:320px;}',
    '.pg-pricing .pr-ctx{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;color:var(--text-2);}',
    '.pg-pricing .pr-ctx .dot{width:3px;height:3px;border-radius:50%;background:var(--faint);}',
    '.pg-pricing .pr-ctx b{color:var(--text);}',
    '.pg-pricing .pr-auto{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:var(--text-2);background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:0 10px;height:36px;}',
    '.pg-pricing .card-head .hd{min-width:0;}',
    '.pg-pricing .card-head .count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--accent);color:var(--accent-ink);font-size:11px;font-weight:800;margin-left:6px;vertical-align:2px;}',
    '.pg-pricing .seg button{padding:5px 10px;font-size:12px;}',
    /* chart */
    '.pg-pricing .pr-chart-wrap{position:relative;cursor:pointer;}',
    '.pg-pricing .pr-selmark{position:absolute;top:12px;bottom:26px;width:0;border-left:2px solid var(--brand-strong);pointer-events:none;opacity:0.5;}',
    '.pg-pricing .pr-selmark span{position:absolute;top:-12px;left:-1px;transform:translateX(-50%);font-size:10px;font-weight:800;color:var(--brand-text);background:var(--surface);padding:0 4px;border-radius:4px;white-space:nowrap;}',
    '.pg-pricing .pr-chart-foot{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-top:8px;font-size:11.5px;color:var(--muted);}',
    '.pg-pricing .pr-ins{margin-top:14px;padding-top:12px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:6px;}',
    '.pg-pricing .pi{display:flex;gap:9px;align-items:flex-start;font-size:12.5px;color:var(--text-2);line-height:1.5;}',
    '.pg-pricing .pi .btn-xs{padding:0 4px;vertical-align:baseline;}',
    '.pg-pricing .pi-ic{width:22px;height:22px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--surface-2);color:var(--text-2);}',
    '.pg-pricing .pi-ic svg{width:13px;height:13px;}',
    '.pg-pricing .pi-ic.up{background:var(--ok-soft);color:var(--ok);} .pg-pricing .pi-ic.down{background:var(--bad-soft);color:var(--bad);}',
    '.pg-pricing .pi-ic.event{background:var(--accent-soft);color:var(--accent-text);} .pg-pricing .pi-ic.comp{background:var(--brand-soft);color:var(--brand-text);}',
    '.pg-pricing .legend i.lg-dash{width:16px;height:0;border-radius:0;background:none;border-top:2px dashed var(--brand-strong);}',
    /* reasoning */
    '.pg-pricing .pr-top{align-items:start;}',
    '.pg-pricing .pr-left{display:flex;flex-direction:column;gap:14px;min-width:0;}',
    '.pg-pricing .pr-why .card-body{display:flex;flex-direction:column;gap:12px;}',
    '.pg-pricing .pr-head3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}',
    '.pg-pricing .pr-head3 > div{border:1px solid var(--border);border-radius:9px;padding:8px 10px;min-width:0;}',
    '.pg-pricing .pr-head3 .l{font-size:11px;font-weight:700;color:var(--muted);}',
    '.pg-pricing .pr-head3 .v{font-family:var(--font-head);font-weight:800;font-size:18px;margin-top:2px;white-space:nowrap;font-variant-numeric:tabular-nums;}',
    '.pg-pricing .pr-head3 .sug{border-color:var(--brand-strong);background:var(--brand-soft-2);box-shadow:inset 3px 0 0 var(--brand-strong);}',
    '.pg-pricing .wf{display:flex;flex-direction:column;}',
    '.pg-pricing .wf-row{display:grid;grid-template-columns:minmax(0,2.2fr) minmax(56px,0.9fr) 68px;gap:10px;align-items:center;padding:5px 0;border-bottom:1px dashed var(--border);}',
    '.pg-pricing .wf-row:last-child{border-bottom:none;}',
    '.pg-pricing .wf-row .wl{font-size:12.5px;font-weight:700;min-width:0;}',
    '.pg-pricing .wf-row .wd{font-size:11.5px;color:var(--muted);font-weight:500;margin-top:1px;line-height:1.35;}',
    '.pg-pricing .wf-row .wa{text-align:right;font-weight:800;font-size:12.5px;font-variant-numeric:tabular-nums;white-space:nowrap;}',
    '.pg-pricing .wf-row .wa small{display:block;font-size:10.5px;font-weight:600;color:var(--muted);}',
    '.pg-pricing .wf-row.zero .wa{color:var(--faint);}',
    '.pg-pricing .wf-row.zero .wl{color:var(--text-2);}',
    '.pg-pricing .wf-row.tot{border-top:2px solid var(--text);border-bottom:none;margin-top:2px;padding-top:8px;}',
    '.pg-pricing .wf-row.tot .wa{font-size:14px;}',
    '.pg-pricing .wf-track{position:relative;height:12px;background:var(--surface-2);border-radius:3px;}',
    '.pg-pricing .wf-track i{position:absolute;top:0;bottom:0;border-radius:3px;min-width:2px;}',
    '.pg-pricing .wf-track i.base{background:var(--brand-strong);opacity:0.55;}',
    '.pg-pricing .wf-track i.up{background:var(--ok);}',
    '.pg-pricing .wf-track i.down{background:var(--bad);}',
    '.pg-pricing .wf-track i.tot{background:var(--brand-strong);}',
    '.pg-pricing .wf-row.wf-axis{border:none;padding:1px 0 0;}',
    '.pg-pricing .wf-axis .ax{display:flex;justify-content:space-between;gap:4px;font-size:10px;color:var(--faint);font-variant-numeric:tabular-nums;white-space:nowrap;}',
    '.pg-pricing .pos, .pr-modal .pos{color:var(--ok);} .pg-pricing .neg, .pr-modal .neg{color:var(--bad);}',
    /* market strip */
    '.pg-pricing .strip{position:relative;height:58px;margin:4px 8px 0;}',
    '.pg-pricing .strip .ln{position:absolute;left:0;right:0;top:22px;height:2px;background:var(--border);}',
    '.pg-pricing .strip .rg{position:absolute;top:18px;height:10px;background:var(--c-prev2);opacity:0.45;border-radius:5px;}',
    '.pg-pricing .strip .cp{position:absolute;top:17px;width:12px;height:12px;border-radius:50%;background:var(--c-prev1);border:2px solid var(--surface);transform:translateX(-50%);}',
    '.pg-pricing .strip .mk{position:absolute;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;font-size:10.5px;font-weight:800;white-space:nowrap;}',
    '.pg-pricing .strip .mk.us{top:0;color:var(--text-2);}',
    '.pg-pricing .strip .mk.us i{width:2px;height:22px;background:var(--text-2);margin-top:1px;}',
    '.pg-pricing .strip .mk.sg{top:15px;color:var(--brand-text);}',
    '.pg-pricing .strip .mk.sg i{width:14px;height:14px;border-radius:3px;background:var(--brand-strong);border:2px solid var(--surface);transform:rotate(45deg);margin-bottom:3px;}',
    '.pg-pricing .strip .av{position:absolute;top:16px;width:14px;height:14px;border-radius:50%;border:2.5px solid var(--text);background:var(--surface);transform:translateX(-50%);box-sizing:border-box;}',
    '.pg-pricing .strip-key{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11px;color:var(--muted);margin-top:2px;}',
    '.pg-pricing .strip-key span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;}',
    '.pg-pricing .strip-key i{display:inline-block;flex-shrink:0;box-sizing:border-box;}',
    '.pg-pricing .strip-key .k-cp{width:8px;height:8px;border-radius:50%;background:var(--c-prev1);}',
    '.pg-pricing .strip-key .k-av{width:10px;height:10px;border-radius:50%;border:2px solid var(--text);background:var(--surface);}',
    '.pg-pricing .strip-key .k-us{width:2px;height:11px;background:var(--text-2);}',
    '.pg-pricing .strip-key .k-sg{width:8px;height:8px;border-radius:2px;background:var(--brand-strong);transform:rotate(45deg);}',
    '.pg-pricing .note svg{width:13px;height:13px;vertical-align:-2px;}',
    '.pg-pricing .pr-set{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;}',
    '.pg-pricing .pr-set .field{width:130px;}',
    /* table */
    '.pg-pricing .pr-tbl{font-size:12.5px;}',
    '.pg-pricing .pr-tbl th, .pg-pricing .pr-tbl td{padding:7px 7px;}',
    '.pg-pricing .pr-tbl td{vertical-align:middle;}',
    '.pg-pricing .pr-tbl td.num, .pg-pricing .pr-tbl th{white-space:nowrap;}',
    '.pg-pricing .pr-tbl td.dt, .pg-pricing .pr-tbl td.pace{white-space:nowrap;}',
    '.pg-pricing .pr-tbl tr.sel td{background:var(--brand-soft-2);}',
    '.pg-pricing .pr-tbl tr.sel td:first-child{box-shadow:inset 3px 0 0 var(--brand-strong);}',
    '.pg-pricing .pr-tbl tr.bk td{color:var(--muted);}',
    '.pg-pricing .pr-tbl .dt-btn{background:none;border:none;padding:0;font:inherit;font-weight:800;color:var(--text);white-space:nowrap;cursor:pointer;}',
    '.pg-pricing .pr-tbl .dt-btn:hover{color:var(--brand-text);text-decoration:underline;}',
    '.pg-pricing .pr-tbl tr.bk .dt-btn{color:var(--text-2);}',
    '.pg-pricing .pr-tbl tr.picked td{background:var(--brand-soft-2);}',
    '.pg-pricing .pill svg{width:11px;height:11px;vertical-align:-1px;margin-right:3px;}',
    '.pg-pricing .pr-tbl .dt .stl{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);margin-top:2px;}',
    '.pg-pricing .pr-tbl .rng{display:block;font-size:11px;color:var(--muted);}',
    '.pg-pricing .pr-tbl .sg{font-weight:800;}',
    '.pg-pricing .pr-tbl .why{font-size:11.5px;color:var(--text-2);min-width:140px;max-width:200px;line-height:1.35;}',
    '.pg-pricing .pr-tbl .evt{max-width:120px;white-space:normal;line-height:1.3;}',
    '.pg-pricing .pr-tbl .evt .pill{white-space:normal;line-height:1.3;padding:2px 7px;}',
    '.pg-pricing .pr-tbl input[type=checkbox]{width:16px;height:16px;accent-color:var(--brand-strong);}',
    '.pg-pricing .pr-tbl .wkd{font-size:10px;font-weight:800;color:var(--accent-text);background:var(--accent-soft);border-radius:4px;padding:0 4px;margin-left:4px;}',
    '.pg-pricing .pr-tbl .pace{white-space:nowrap;}',
    '.pg-pricing .pr-tbl .pace i{display:inline-block;width:34px;height:6px;border-radius:3px;background:var(--surface-2);border:1px solid var(--border);position:relative;vertical-align:middle;margin-right:5px;overflow:hidden;}',
    '.pg-pricing .pr-tbl .pace i b{position:absolute;left:0;top:0;bottom:0;background:var(--brand-strong);}',
    '.pg-pricing .pr-tbl .pace i em{position:absolute;top:-1px;bottom:-1px;width:2px;background:var(--text);}',
    '.pg-pricing .pr-tbl tbody tr{cursor:pointer;}',
    '.pg-pricing .pr-tbl tbody tr:hover td{background:var(--surface-2);}',
    '.pg-pricing .pr-tbl tbody tr.sel:hover td{background:var(--brand-soft);}',
    '.pg-pricing .pr-bulk{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
    '.pg-pricing .pr-bulk .small{color:var(--muted);}',
    '.pg-pricing .pr-scroll{max-height:640px;overflow:auto;}',
    /* comps */
    '.pg-pricing .th-sort{background:none;border:none;padding:0;font:inherit;color:inherit;font-weight:700;display:inline-flex;align-items:center;gap:3px;}',
    '.pg-pricing .th-sort.on{color:var(--brand-text);}',
    '.pg-pricing .th-sort svg{width:11px;height:11px;}',
    '.pg-pricing tr.us td{background:var(--brand-soft-2);font-weight:700;}',
    '.pg-pricing tr.off td{opacity:0.5;}',
    '.pg-pricing .cmp-nm{display:flex;align-items:center;gap:7px;font-weight:700;white-space:nowrap;}',
    '.pg-pricing .pr-tbl .stars{font-size:12px;letter-spacing:0;}',
    /* history */
    '.pg-pricing .hist{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}',
    '.pg-pricing .hist > div{border:1px solid var(--border);border-radius:9px;padding:9px 11px;min-width:0;}',
    '.pg-pricing .hist .cur{border-color:var(--brand-strong);box-shadow:inset 3px 0 0 var(--brand-strong);}',
    '.pg-pricing .hist .l{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:var(--muted);}',
    '.pg-pricing .hist .v{font-family:var(--font-head);font-weight:800;font-size:19px;margin-top:3px;font-variant-numeric:tabular-nums;}',
    '.pg-pricing .hist .s{font-size:11.5px;color:var(--muted);margin-top:1px;}',
    '.pg-pricing .key{display:inline-block;width:12px;height:3px;border-radius:2px;flex-shrink:0;}',
    '.pg-pricing .key.k0{background:var(--brand-strong);} .pg-pricing .key.k1{background:var(--c-prev1);} .pg-pricing .key.k2{background:var(--c-prev2);}',
    /* rules */
    '.pg-pricing .rules .form-grid{grid-template-columns:repeat(2,minmax(0,1fr));}',
    '.pg-pricing .rules .sec{grid-column:1/-1;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-top:4px;padding-top:8px;border-top:1px solid var(--border);}',
    '.pg-pricing .rules .sec:first-child{border-top:none;padding-top:0;margin-top:0;}',
    '.pg-pricing .inunit{display:flex;align-items:center;border:1px solid var(--border);border-radius:8px;background:var(--surface);overflow:hidden;}',
    '.pg-pricing .inunit:focus-within{outline:2px solid var(--brand-strong);outline-offset:-1px;}',
    '.pg-pricing .inunit span{padding:0 9px;font-size:12px;font-weight:700;color:var(--muted);background:var(--surface-2);align-self:stretch;display:flex;align-items:center;}',
    '.pg-pricing .inunit input{border:none;outline:none;padding:8px 10px;width:100%;min-width:0;font-size:13px;background:none;font-variant-numeric:tabular-nums;}',
    '.pg-pricing .pr-fs{border:none;margin:0;padding:0;min-width:0;display:flex;flex-direction:column;gap:12px;}',
    '.pg-pricing .pr-fs[disabled] .inunit{background:var(--surface-2);}',
    '.pg-pricing .pr-fs[disabled] .btn, .pg-pricing .pr-fs[disabled] .switch{opacity:0.5;cursor:not-allowed;}',
    '.pg-pricing .auto-row{display:flex;align-items:center;gap:10px;justify-content:space-between;}',
    '.pg-pricing .log{font-size:12px;color:var(--text-2);display:flex;flex-direction:column;gap:6px;}',
    '.pg-pricing .log div{display:flex;gap:8px;justify-content:space-between;}',
    '.pg-pricing tr.cur-prop td{background:var(--brand-soft-2);}',
    '.pg-pricing tr.cur-prop td:first-child{box-shadow:inset 3px 0 0 var(--brand-strong);}',
    '@media (max-width:1024px){.pg-pricing .pr-head3{grid-template-columns:repeat(3,minmax(0,1fr));}}',
    '@media (max-width:560px){',
    '  .pg-pricing .pr-prop{min-width:0;max-width:none;width:100%;}',
    '  .pg-pricing .toolbar > *{max-width:100%;}',
    '  .pg-pricing .pr-head3 .v{font-size:15px;}',
    '  .pg-pricing .hist{grid-template-columns:minmax(0,1fr);}',
    '  .pg-pricing .rules .form-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);}',
    '  .pg-pricing .wf-row{grid-template-columns:minmax(0,1.6fr) minmax(40px,0.7fr) 70px;gap:8px;}',
    '}'
  ].join('\n'));

  /* ------------------------------------------------------------------ model helpers */
  var SEASON = { 1: 1.12, 2: 1.08, 3: 0.95, 4: 0.97, 5: 0.98, 6: 1.04, 7: 1.05, 8: 1.02, 9: 0.96, 10: 1.0, 11: 1.0, 12: 1.18 };
  function seasonFactor(iso) { var f = SEASON[d.month(iso)]; if (d.month(iso) === 12 && d.day(iso) >= 20) f += 0.12; return f; }
  function seasonName(f) { return f >= 1.1 ? 'peak season' : f >= 1.03 ? 'high season' : f <= 0.97 ? 'low season' : 'shoulder season'; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function round5(v) { return Math.round(v / 5) * 5; }
  function avg(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : 0; }
  function sum(a) { return a.reduce(function (s, x) { return s + x; }, 0); }
  function signed(n, c) { return (n > 0 ? '+' : n < 0 ? '−' : '±') + fmt.money(Math.abs(n), { cur: c }); }
  function signedPct(x, dp) { dp = dp == null ? 0 : dp; if (x != null && !isNaN(x) && Math.round(Math.abs(x) * 100 * Math.pow(10, dp)) === 0) return '±0%'; return fmt.changeText(x, dp); }
  /* share of a night's final occupancy that is usually on the books at a given lead time (market booking curve) */
  var CURVE = [[0, 1], [3, 0.86], [7, 0.73], [14, 0.59], [30, 0.41], [60, 0.23], [90, 0.11], [150, 0.04]];
  function paceShare(lead) {
    for (var i = 1; i < CURVE.length; i++) {
      if (lead <= CURVE[i][0]) { var a = CURVE[i - 1], b = CURVE[i]; return a[1] + (b[1] - a[1]) * (lead - a[0]) / (b[0] - a[0]); }
    }
    return 0.05;
  }
  function city(p) {
    var a = p.city || p.area || '';
    if (/Penang|George Town/.test(a)) return 'Penang';
    if (/Kuala Lumpur/.test(a)) return 'Kuala Lumpur';
    if (/Cameron/.test(a)) return 'Cameron Highlands';
    if (/Melaka/.test(a)) return 'Melaka';
    return a;
  }
  function bedsLabel(n) { return n === 0 ? 'Studio' : isFinite(n) && n != null ? n + ' BR' : '–'; }
  /* data helpers that tolerate a property saved without an area or a base price (D.eventFor / D.rateFor need both) */
  function eventOf(pid, iso) { var p = D.propById[pid]; return p && typeof p.area === 'string' ? D.eventFor(pid, iso) : null; }
  function rateOf(pid, iso, y) {
    var p = D.propById[pid];
    if (p && typeof p.area === 'string') return D.rateFor(pid, iso, y);
    return round5((Number(p && p.base) || 0) * seasonFactor(iso) * (d.isWeekend(iso) ? 1.18 : 1) * ([1, 0.93, 0.86][y || 0] || 0.8));
  }
  function compPriceOf(c, pid, iso) { var p = D.propById[pid]; return p && typeof p.area === 'string' ? D.compPrice(c, pid, iso) : round5(rateOf(pid, iso) * c.priceFactor); }

  function defaultRules(p) {
    return {
      base: p.base, min: round5(p.base * 0.75), max: round5(p.base * 1.9),
      weekendPct: 18, lastMinDays: 3, lastMinPct: 10, weeklyPct: 8, monthlyPct: 20,
      orphanPct: 15, orphanMax: 1, compWeight: 50, auto: false
    };
  }
  var RULE_LABELS = {
    base: ['Base price', 'RM'], min: ['Minimum price', 'RM'], max: ['Maximum price', 'RM'], compWeight: ['Follow the market', '%'],
    weekendPct: ['Weekend uplift', '%'], orphanPct: ['Orphan-night discount', '%'], lastMinPct: ['Last-minute discount', '%'],
    lastMinDays: ['Last-minute window', 'days'], weeklyPct: ['Weekly stay discount', '%'], monthlyPct: ['Monthly stay discount', '%']
  };
  /* reading never writes: a property without saved rules uses the defaults until someone saves */
  function rules(pid) { return D.pricingRules[pid] || defaultRules(D.propById[pid]); }
  function ownRules(pid) { if (!D.pricingRules[pid]) D.pricingRules[pid] = defaultRules(D.propById[pid]); return D.pricingRules[pid]; }
  function overrides(pid) { return D.priceOverrides[pid] || {}; }

  /* night-by-night occupancy of the whole portfolio (live bookings + blocks) */
  function occupancyIndex() {
    var booked = {}, blocked = {};
    D.properties.forEach(function (p) { booked[p.id] = {}; blocked[p.id] = {}; });
    D.bookings.forEach(function (b) {
      if (!M.live(b) || !booked[b.propertyId]) return;
      for (var x = b.checkIn; x < b.checkOut; x = d.add(x, 1)) booked[b.propertyId][x] = b;
    });
    D.blocks.forEach(function (k) {
      if (!blocked[k.propertyId]) return;
      for (var x = k.start; x < k.end; x = d.add(x, 1)) blocked[k.propertyId][x] = k;
    });
    return { booked: booked, blocked: blocked };
  }
  function statusOf(idx, pid, iso) {
    var b = idx.booked[pid][iso]; if (b) return { kind: 'booked', b: b };
    var k = idx.blocked[pid][iso]; if (k) return { kind: 'blocked', block: k };
    if (iso < D.TODAY) return { kind: 'past' };
    return { kind: 'open' };
  }
  /* length of the open run that contains iso (open = sellable) */
  function openRun(idx, pid, iso) {
    var n = 1, x = d.add(iso, -1), guard = 0;
    while (guard++ < 40 && statusOf(idx, pid, x).kind === 'open') { n++; x = d.add(x, -1); }
    x = d.add(iso, 1); guard = 0;
    while (guard++ < 40 && statusOf(idx, pid, x).kind === 'open') { n++; x = d.add(x, 1); }
    return n;
  }

  /* the pricing model for one property and range */
  function model(pid, from, to, opts) {
    opts = opts || {};
    var P = D.propById[pid], R = rules(pid), ov = overrides(pid), meta = D.priceOverrideMeta[pid] || {}, T = D.TODAY;
    var idx = opts.idx || occupancyIndex();
    var comps = D.compSet(pid), ex = st.excl[pid] || {};
    var used = comps.filter(function (c) { return !ex[c.id]; });
    var mOcc = avg(used.map(function (c) { return c.occ; })) / 100;
    var cy = city(P);
    var group = D.properties.filter(function (q) { return city(q) === cy; });
    var groupName = cy + ' units';
    if (group.length < 3) { group = D.properties.slice(); groupName = group.length === 1 ? 'this unit' : 'all ' + group.length + ' units'; }
    var hFrom = d.add(T, -90), hTo = d.add(T, -1);
    var hSold = sum(group.map(function (q) { return M.nightsSold(hFrom, hTo, { propertyId: q.id }); }));
    var hAvail = sum(group.map(function (q) { return M.availableNights(hFrom, hTo, q.id); }));
    var usualOcc = hAvail ? hSold / hAvail : mOcc;
    var days = d.range(from, to).map(function (iso) {
      var s = statusOf(idx, pid, iso), lead = d.diff(T, iso);
      var cps = used.map(function (c) { return compPriceOf(c, pid, iso); });
      var cAvg = avg(cps), cMin = Math.min.apply(null, cps), cMax = Math.max.apply(null, cps);
      var modelRate = rateOf(pid, iso);
      var manual = ov[iso] != null;
      var our = s.kind === 'booked' ? s.b.nightly : (manual ? ov[iso] : modelRate);
      var ev = eventOf(pid, iso), wk = d.isWeekend(iso);
      var share = paceShare(Math.max(0, lead));
      var mFinal = clamp(mOcc * (wk ? 1.08 : 0.95) * (ev ? 1 + ev.lift / 2 : 1), 0.2, 0.97);
      var expOTB = mFinal * share;
      var usualOTB = clamp(usualOcc * (wk ? 1.08 : 0.95) * (ev ? 1 + ev.lift / 2 : 1), 0.2, 0.97) * share;
      var avail = 0, bk = 0;
      group.forEach(function (q) { if (idx.blocked[q.id][iso]) return; avail++; if (idx.booked[q.id][iso]) bk++; });
      var grpOTB = avail ? bk / avail : 0;
      var n = {
        iso: iso, lead: lead, status: s, our: our, modelRate: modelRate, manual: manual && s.kind === 'open',
        how: manual && s.kind === 'open' ? ((meta[iso] && meta[iso].how) || 'manual') : null,
        cps: cps, cAvg: cAvg, cMin: cMin, cMax: cMax, ev: ev, wk: wk,
        ly: rateOf(pid, d.sameWeekdayYearsAgo(iso, 1), 1), y2: rateOf(pid, d.sameWeekdayYearsAgo(iso, 2), 2),
        mFinal: mFinal, expOTB: expOTB, usualOTB: usualOTB, grpOTB: grpOTB, grpBooked: bk, grpAvail: avail
      };
      if (s.kind === 'open') {
        n.run = openRun(idx, pid, iso);
        n.factors = factors(P, R, n, groupName);
        n.sugg = sum(n.factors.map(function (f) { return f.amt; }));
        n.change = n.sugg - n.our;
        n.pSell = clamp((mFinal - expOTB) / (1 - expOTB), 0.05, 0.95);
      } else if (s.kind === 'booked') {
        /* what the model would ask for this night today, for comparison with the booked rate */
        n.modelSugg = sum(factors(P, R, Object.assign({}, n, { run: 99 }), groupName).map(function (f) { return f.amt; }));
      }
      return n;
    });
    return { P: P, R: R, comps: comps, used: used, mOcc: mOcc, usualOcc: usualOcc, groupName: groupName, group: group, days: days, idx: idx };
  }

  /* the factor chain: each step is an amount in the property's currency, the amounts add up exactly to the suggestion */
  function factors(P, R, n, groupName) {
    var out = [], run = 0;
    function add(key, label, short, amt, detail, always) {
      amt = Math.round(amt);
      if (!amt && !always) return;
      out.push({ key: key, label: label, short: short, amt: amt, pct: run ? amt / run : null, detail: detail, from: run, to: run + amt });
      run += amt;
    }
    var iso = n.iso, mon = d.monthName ? d.monthName(iso, true) : d.MONTHS_LONG[d.month(iso) - 1];
    add('base', 'Base rate', 'Base', R.base, 'Set in pricing rules for ' + (P.short || P.name), true);
    var sf = seasonFactor(iso);
    add('season', 'Season', 'Season', R.base * (sf - 1), mon + ' is ' + seasonName(sf) + ' (demand index ' + sf.toFixed(2) + ')', true);
    add('weekend', 'Weekend', 'Weekend', n.wk ? run * R.weekendPct / 100 : 0, n.wk ? d.dowName(iso) + ' night: weekend uplift ' + R.weekendPct + '%' : d.dowName(iso) + ' night: no weekend uplift', true);
    add('event', 'Local event', n.ev ? n.ev.name : 'Event', n.ev ? run * n.ev.lift : 0, n.ev ? n.ev.name + ': +' + Math.round(n.ev.lift * 100) + '% demand lift' : 'No local event on this date', true);
    var gap = n.cAvg - run, cap = run * 0.15;
    var compAmt = clamp(gap * R.compWeight / 100, -cap, cap);
    add('comp', 'Competitor gap', 'Market', compAmt,
      'Comp avg ' + fmt.money(n.cAvg, { cur: P }) + ' is ' + (Math.abs(gap) < 1 ? 'level with' : fmt.money(Math.abs(gap), { cur: P }) + (gap > 0 ? ' above' : ' below')) + ' the price so far; move ' + R.compWeight + '% of the way' + (Math.abs(gap * R.compWeight / 100) > cap ? ' (capped at 15%)' : ''), true);
    var diff = n.grpOTB - n.usualOTB, pacePct = clamp(diff * 0.25, -0.06, 0.08);
    add('pace', 'Booking pace', 'Pace', run * pacePct,
      groupName.charAt(0).toUpperCase() + groupName.slice(1) + ' ' + fmt.pct(n.grpOTB) + ' booked vs ' + fmt.pct(n.usualOTB) + ' usual at ' + fmt.plural(Math.max(0, n.lead), 'day') + ' out' + (Math.abs(diff) < 0.03 ? ' (on pace)' : diff > 0 ? ' (ahead)' : ' (behind)'), true);
    var leadPct = 0, leadTxt;
    var strong = diff > 0.15, orphan = n.run <= R.orphanMax;
    if (orphan && n.lead <= 7) leadTxt = fmt.plural(n.lead, 'day') + ' to arrival: covered by the orphan-night discount below (they do not stack)';
    else if (n.lead <= R.lastMinDays) { leadPct = strong ? 0 : R.lastMinPct; leadTxt = (n.lead === 0 ? 'Tonight' : fmt.plural(n.lead, 'day') + ' to arrival') + (strong ? ', but demand is strong: last-minute discount waived' : ' and still open: last-minute discount ' + R.lastMinPct + '%'); }
    else if (n.lead <= 7) { leadPct = strong ? 0 : R.lastMinPct / 2; leadTxt = fmt.plural(n.lead, 'day') + ' to arrival' + (strong ? ', demand strong: no discount' : ': half the last-minute discount (' + (R.lastMinPct / 2) + '%)'); }
    else leadTxt = fmt.plural(n.lead, 'day') + ' to arrival: no lead-time adjustment';
    add('lead', 'Days until arrival', 'Last-minute', -run * leadPct / 100, leadTxt, true);
    if (orphan) add('orphan', 'Orphan night', 'Orphan night', -run * R.orphanPct / 100, 'Single open night between stays: orphan-night discount ' + R.orphanPct + '%');
    if (run < R.min) add('rule', 'Minimum price rule', 'Floor', R.min - run, 'Raised to your floor of ' + fmt.money(R.min, { cur: P }));
    else if (run > R.max) add('rule', 'Maximum price rule', 'Ceiling', R.max - run, 'Capped at your ceiling of ' + fmt.money(R.max, { cur: P }));
    add('round', 'Rounding', 'Rounding', round5(run) - run, 'Rounded to the nearest ' + fmt.money(5, { cur: P }));
    return out;
  }
  function shortReason(n) {
    var fs = n.factors.filter(function (f) { return f.key !== 'base' && f.key !== 'round' && f.amt; });
    fs.sort(function (a, b) { return Math.abs(b.amt) - Math.abs(a.amt); });
    if (!fs.length) return 'Base rate holds';
    return fs.slice(0, 2).map(function (f) { return esc(f.short) + ' <b class="' + (f.amt > 0 ? 'pos' : 'neg') + '">' + (f.amt > 0 ? '+' : '−') + Math.abs(f.amt) + '</b>'; }).join(' · ');
  }
  function summary(m) {
    var days = m.days, open = days.filter(function (n) { return n.status.kind === 'open'; });
    var priced = days.filter(function (n) { return n.status.kind === 'open' || n.status.kind === 'booked'; });
    var ourAvg = avg(priced.map(function (n) { return n.our; }));
    var compAvg = avg(priced.map(function (n) { return n.cAvg; }));
    var lyAvg = avg(priced.map(function (n) { return n.ly; }));
    var from = days[0].iso, to = days[days.length - 1].iso, pid = m.P.id;
    var avail = M.availableNights(from, to, pid), sold = M.nightsSold(from, to, { propertyId: pid });
    var otb = avail ? sold / avail : 0;
    var mkt = avg(days.filter(function (n) { return n.status.kind !== 'blocked'; }).map(function (n) { return n.expOTB; }));
    var suggAvg = avg(open.map(function (n) { return n.sugg; }));
    var openOur = avg(open.map(function (n) { return n.our; }));
    var impact = sum(open.map(function (n) { return n.change * n.pSell; }));
    var upside = sum(open.map(function (n) { return n.change; }));
    var review = open.filter(function (n) { return n.our && Math.abs(n.change) / n.our >= 0.05; });
    var changes = open.filter(function (n) { return n.change; });
    var cLo = priced.length ? Math.min.apply(null, priced.map(function (n) { return n.cMin; })) : null;
    var cHi = priced.length ? Math.max.apply(null, priced.map(function (n) { return n.cMax; })) : null;
    return { open: open, priced: priced, changes: changes, ourAvg: ourAvg, compAvg: compAvg, lyAvg: lyAvg, otb: otb, sold: sold, avail: avail, mkt: mkt, suggAvg: suggAvg, openOur: openOur, impact: impact, upside: upside, review: review, cLo: cLo, cHi: cHi, index: compAvg && ourAvg ? ourAvg / compAvg * 100 : null };
  }

  /* ------------------------------------------------------------------ actions */
  /* typed units share one price: the unit type's main rate plan (O.channel, pages/channels.js) */
  function mainPlanOf(P) { return P && P.unitTypeId && O.channel ? O.channel.mainPlan(P.unitTypeId) : null; }
  function typeNote(P) {
    var t = P && P.unitTypeId && O.unitType(P.unitTypeId), n = t ? O.unitsOfType(t.id).length : 0;
    return t && n > 1 && mainPlanOf(P) ? 'Prices apply to all ' + n + ' ' + t.name + ' units' : '';
  }
  function channelNote(P) {
    if (O.channel) return O.channel.notice('price', P && P.unitTypeId ? [P.unitTypeId] : []);
    return 'Channel calendars update within 15 minutes (prototype: nothing is sent).';
  }
  function applyPrices(pid, list, how) {
    if (!canChange()) { U.toast(WHY_CHANGE, 'bad'); return; }
    if (!list.length) { U.toast('Nothing to apply: no open nights selected', 'bad'); return; }
    var mp = mainPlanOf(D.propById[pid]);
    if (mp) O.channel.setDays(list.map(function (x) { return { planId: mp.id, dates: [x.iso], set: { rate: x.price } }; }), { emit: false, audit: false, how: how === 'Price set manually' ? 'manual' : 'suggestion' });
    D.priceOverrides[pid] = D.priceOverrides[pid] || {};
    var meta = D.priceOverrideMeta[pid] = D.priceOverrideMeta[pid] || {};
    var manual = how === 'Price set manually';
    list.forEach(function (x) { D.priceOverrides[pid][x.iso] = x.price; meta[x.iso] = { how: manual ? 'manual' : 'suggestion', by: O.state.viewer, at: D.NOW }; });
    var v = O.viewer(), P = D.propById[pid];
    var range = list.length === 1 ? d.fmt(list[0].iso) : d.fmtRange(list[0].iso, list[list.length - 1].iso);
    D.priceLog.unshift({ at: D.NOW, pid: pid, n: list.length, by: v ? v.name : '', how: how || 'Suggestions applied', first: list[0].iso, last: list[list.length - 1].iso });
    audit((manual ? 'Set the price for ' + range + ' to ' + fmt.money(list[0].price, { cur: pid }) : 'Applied ' + fmt.plural(list.length, 'suggested price') + ' (' + range + ')') + ' for ' + P.name);
    st.picked = {};
    var tn = typeNote(P);
    U.toast((list.length === 1 ? 'New price for ' + d.fmt(list[0].iso) : list.length + ' new prices') + ' saved for ' + (tn ? tn.replace('Prices apply to ', '') : P.short) + '. ' + channelNote(P));
    O.emit('data', { type: 'pricing' });
  }
  function revert(pid, isoList) {
    if (!canChange()) { U.toast(WHY_CHANGE, 'bad'); return; }
    var mp = mainPlanOf(D.propById[pid]);
    if (mp) O.channel.setDays([{ planId: mp.id, dates: isoList, set: { rate: null } }], { emit: false, audit: false });
    var o = D.priceOverrides[pid]; if (!o) { if (mp) O.emit('data', { type: 'pricing' }); return; }
    var meta = D.priceOverrideMeta[pid] || {};
    isoList.forEach(function (iso) { delete o[iso]; delete meta[iso]; });
    D.priceLog.unshift({ at: D.NOW, pid: pid, n: isoList.length, by: (O.viewer() || {}).name || '', how: 'Reverted to model rate', first: isoList[0], last: isoList[isoList.length - 1] });
    audit('Put ' + fmt.plural(isoList.length, 'night') + ' (' + d.fmt(isoList[0]) + ') back on the model rate for ' + D.propById[pid].name);
    var tn = typeNote(D.propById[pid]);
    U.toast('Back on the model rate for ' + fmt.plural(isoList.length, 'night') + (tn ? ' (' + tn.replace('Prices apply to ', '') + ')' : '') + '.' + (O.channel && O.channel.mode() === 'live' && D.propById[pid].unitTypeId && O.channel.typeConnected(D.propById[pid].unitTypeId) ? ' ' + channelNote(D.propById[pid]) : ''));
    O.emit('data', { type: 'pricing' });
  }
  function moneySigned(v, c) { return Math.round(v) === 0 ? fmt.money(0, { cur: c }) : (v > 0 ? '+' : '−') + fmt.money(Math.abs(v), { cur: c }); }

  /* ------------------------------------------------------------------ render pieces */
  function kpiStrip(m, s) {
    var none = !s.priced.length; /* every night in the range is blocked */
    var idxDelta = s.index != null ? s.index / 100 - 1 : null;
    var otbPts = Math.round((s.otb - s.mkt) * 100);
    return U.kpis([
      { label: 'Our average price', value: none ? '–' : fmt.money(s.ourAvg, { cur: m.P }), delta: none ? null : fmt.change(s.ourAvg, s.lyAvg), sub: none ? 'every night is blocked' : 'vs last year', title: 'Booked nights at the booked rate, open nights at the current listed rate' },
      { label: 'Competitor average', value: none ? '–' : fmt.money(s.compAvg, { cur: m.P }), sub: idxDelta == null ? fmt.plural(m.used.length, 'listing') : Math.abs(idxDelta) < 0.01 ? 'we are level with them' : 'we are ' + fmt.pct(Math.abs(idxDelta)) + (idxDelta > 0 ? ' above' : ' below'), title: 'Average of the ' + m.used.length + ' listings in the competitor set' },
      { label: 'On the books', value: s.avail ? fmt.pct(s.otb) : '–', sub: s.avail ? (Math.abs(otbPts) < 1 ? 'on pace with the market' : Math.abs(otbPts) + ' pts ' + (otbPts > 0 ? 'ahead of' : 'behind') + ' the market') : 'no nights to sell', title: s.avail ? s.sold + ' of ' + fmt.plural(s.avail, 'night') + ' booked; the market usually has ' + fmt.pct(s.mkt) + ' booked by now' : '' },
      { label: 'Impact if applied', value: s.changes.length ? moneySigned(s.impact, m.P) : '–', sub: !s.open.length ? 'no open nights in range' : !s.changes.length ? 'all suggestions applied' : 'expected · ' + moneySigned(s.upside, m.P) + ' if all sell', hl: true, title: 'Expected: the sum of price changes on open nights, each weighted by its chance to sell. If all sell: the full sum.' }
    ]);
  }

  function chartCard(m) {
    return '<div class="card pr-chartcard"><div class="card-head"><div class="hd"><h3>' + (st.chart === 'market' ? 'Our price vs the market' : 'Same dates in previous years') + '</h3><div class="sub">' +
      (st.chart === 'market' ? 'Nightly price, competitor average with min–max band, and the suggested price. Click a night to see its reasoning.' : 'This year against the same weekday 1 and 2 years ago (364 and 728 days earlier).') + '</div></div>' +
      U.seg([['market', 'Vs competitors'], ['history', 'Vs last years']], st.chart, 'data-chart') + '</div>' +
      '<div class="card-body"><div class="pr-chart-wrap"><div class="pr-chart"></div><div class="pr-selmark" hidden><span></span></div></div>' +
      (m.days.length < 3 ? '' : '<div class="pr-chart-foot">' + (st.chart === 'market'
        ? '<div class="legend"><span><i style="background:var(--brand-strong)"></i>Our price</span><span><i class="lg-dash"></i>Suggested (open nights)</span><span><i style="background:var(--c-prev1)"></i>Competitor average</span><span><i class="sq" style="background:var(--c-prev2);opacity:.6"></i>Competitor min–max</span></div>'
        : O.chart.legend([{ name: 'This year', tone: 'brand' }, { name: 'Last year', tone: 'prev1' }, { name: 'Two years ago', tone: 'prev2' }])) +
      '<span>' + (st.chart === 'market' ? 'Gaps in the suggested line are nights already booked or blocked.' : 'Hover for the exact dates compared.') + '</span></div>') + insights(m) + '</div></div>';
  }
  function insights(m) {
    var open = m.days.filter(function (n) { return n.status.kind === 'open'; }), out = [];
    function link(n) { return '<button type="button" class="btn btn-quiet btn-xs" data-pick="' + n.iso + '">' + d.dowName(n.iso) + ' ' + d.fmt(n.iso) + '</button>'; }
    var up = open.filter(function (n) { return n.change > 0; }).sort(function (a, b) { return b.change - a.change; });
    var dn = open.filter(function (n) { return n.change < 0; }).sort(function (a, b) { return a.change - b.change; });
    if (up.length) out.push(['up', '<b>' + fmt.plural(up.length, 'open night') + '</b> priced below the suggestion, worth ' + signed(sum(up.map(function (n) { return n.change; })), m.P) + ' if they sell. Largest gap ' + signed(up[0].change, m.P) + ' on', up[0]]);
    if (dn.length) out.push(['down', '<b>' + fmt.plural(dn.length, 'open night') + '</b> look expensive for current demand. Largest cut ' + signed(dn[0].change, m.P) + ' on', dn[0]]);
    var under = open.filter(function (n) { return n.our < n.cAvg * 0.9; });
    if (under.length) {
      /* say why: the biggest discount among those nights (orphan night, last-minute, pace) */
      var why = {}; under.forEach(function (n) { var f = n.factors.filter(function (x) { return x.amt < 0 && x.key !== 'round'; }).sort(function (a, b) { return a.amt - b.amt; })[0]; if (f) why[f.label] = (why[f.label] || 0) + 1; });
      var main = Object.keys(why).sort(function (a, b) { return why[b] - why[a]; })[0];
      var atSugg = under.every(function (n) { return !n.change; });
      out.push(['comp', '<b>' + fmt.plural(under.length, 'open night') + '</b> ' + (under.length === 1 ? 'sits' : 'sit') + ' more than 10% under the competitor average' + (main ? (atSugg ? ' on purpose (mainly ' : ' (mainly ') + esc(main.toLowerCase()) + ')' : '') + ', first on', under[0]]);
    }
    var evs = {}; m.days.forEach(function (n) { if (n.ev) (evs[n.ev.name] = evs[n.ev.name] || []).push(n); });
    Object.keys(evs).forEach(function (k) {
      var ns = evs[k], o = ns.filter(function (n) { return n.status.kind === 'open'; }), b = ns.filter(function (n) { return n.status.kind === 'booked'; });
      var mk = avg(ns.map(function (n) { return n.cAvg; })), parts = [];
      if (b.length) parts.push(fmt.plural(b.length, 'night') + ' booked at ' + fmt.money(avg(b.map(function (n) { return n.our; })), { cur: m.P }));
      if (o.length) parts.push(fmt.plural(o.length, 'night') + ' open, suggested ' + fmt.money(avg(o.map(function (n) { return n.sugg; })), { cur: m.P }));
      if (ns.length > b.length + o.length) parts.push(fmt.plural(ns.length - b.length - o.length, 'night') + ' blocked');
      out.push(['event', '<b>' + esc(k) + '</b>: ' + parts.join(', ') + '; market ' + fmt.money(mk, { cur: m.P }) + '. See', o[0] || ns[0]]);
    });
    var orph = open.filter(function (n) { return n.run <= m.R.orphanMax; });
    if (orph.length) out.push(['orphan', '<b>' + fmt.plural(orph.length, 'orphan night') + '</b> between stays, discounted to help them sell, first on', orph[0]]);
    if (!out.length) return '';
    return '<div class="pr-ins"><div class="label">What stands out in this range</div>' + out.slice(0, 5).map(function (x) {
      return '<div class="pi"><span class="pi-ic ' + x[0] + '" aria-hidden="true">' + O.icon(x[0] === 'up' ? 'up' : x[0] === 'down' ? 'down' : x[0] === 'event' ? 'calendar' : x[0] === 'comp' ? 'pricing' : 'alert') + '</span><span>' + x[1] + ' ' + link(x[2]) + '</span></div>';
    }).join('') + '</div>';
  }
  function drawChart(root, m) {
    var el = O.$('.pr-chart', root); if (!el) return;
    if (m.days.length < 3) { el.innerHTML = U.empty('Pick a range of 3 nights or more to see the price trend. The table and the reasoning panel cover the nights in this range.'); return; }
    var days = m.days, labels = days.map(function (n) { return n.iso; }), series;
    if (st.chart === 'market') {
      series = [
        { name: 'Our price', values: days.map(function (n) { return n.status.kind === 'blocked' ? null : n.our; }), tone: 'brand', width: 2.4 },
        { name: 'Suggested', values: days.map(function (n) { return n.sugg != null ? n.sugg : null; }), tone: 'brand', dash: true, width: 1.6 },
        { name: 'Competitor avg', values: days.map(function (n) { return Math.round(n.cAvg); }), tone: 'prev1' }
      ];
    } else {
      series = [
        { name: 'This year', values: days.map(function (n) { return n.status.kind === 'blocked' ? null : n.our; }), tone: 'brand', width: 2.4 },
        { name: 'Last year', values: days.map(function (n) { return n.ly; }), tone: 'prev1' },
        { name: 'Two years ago', values: days.map(function (n) { return n.y2; }), tone: 'prev2' }
      ];
    }
    var band = st.chart === 'market' ? { lo: days.map(function (n) { return n.cMin; }), hi: days.map(function (n) { return n.cMax; }), name: 'Competitor range' } : null;
    /* fit the axis to the prices (bottom and top on round values) so the lines fill the chart */
    var all = [];
    series.forEach(function (se) { se.values.forEach(function (v) { if (v != null) all.push(v); }); });
    if (band) all = all.concat(band.lo, band.hi);
    var fit = axisFit(all), off = 0;
    O.chart.line(el, {
      labels: labels, height: 290, markers: 'none', yMin: fit.yMin, yMax: fit.yMax, padLeft: 46, series: series, band: band,
      ariaLabel: st.chart === 'market' ? 'Our nightly price, suggested price and competitor average by night' : 'Our nightly price this year, last year and two years ago by night',
      yFormat: function (v, axis) { return axis ? fmt.cur(m.P) + ' ' + Math.round(v + off) : fmt.money(v + off, { cur: m.P }); },
      xFormat: function (l) { return d.fmt(l); },
      tipTitle: function (i) { var n = days[i]; return d.dowName(n.iso) + ' ' + d.fmt(n.iso) + (n.status.kind === 'booked' ? ' · booked' : n.status.kind === 'blocked' ? ' · blocked' : '') + (n.ev ? ' · ' + n.ev.name : ''); }
    });
    placeMark(root, m);
  }
  /* bottom and top of the price axis: 4 equal steps of a round size, with a little room above and below the data */
  var STEPS = [5, 10, 20, 25, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500];
  function axisFit(vals) {
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), best = null;
    STEPS.forEach(function (step) {
      if (best) return;
      var range = 4 * step, B = Math.floor((lo - range * 0.05) / step) * step;
      if (B < 0) B = 0;
      if (B + range >= hi + range * 0.03) best = { yMin: B, yMax: B + range };
    });
    return best || { yMin: 0, yMax: Math.ceil(hi / 100) * 100 };
  }
  function chartIndex(root, n, clientX) {
    var svg = O.$('.pr-chart svg', root); if (!svg) return -1;
    var r = svg.getBoundingClientRect(), W = svg.viewBox.baseVal.width || r.width, pl = 46, pr = 14;
    var sx = (clientX - r.left) * (W / r.width);
    return n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((sx - pl) / ((W - pl - pr) / (n - 1)))));
  }
  function placeMark(root, m) {
    var mk = O.$('.pr-selmark', root), svg = O.$('.pr-chart svg', root); if (!mk || !svg) return;
    var sel = st.sel[m.P.id], i = m.days.map(function (n) { return n.iso; }).indexOf(sel), n = m.days.length;
    if (i < 0) { mk.hidden = true; return; }
    var W = svg.viewBox.baseVal.width, pl = 46, pr = 14;
    var x = n <= 1 ? pl + (W - pl - pr) / 2 : pl + i * (W - pl - pr) / (n - 1);
    mk.style.left = (x / W * 100) + '%'; mk.hidden = false;
    O.$('span', mk).textContent = d.fmt(sel);
  }

  /* one night's market: the competitor prices as dots, their range and average, our price and (optionally) the suggestion */
  function marketStrip(m, n, price, priceLabel, sugg) {
    var pts = n.cps.concat([price]); if (sugg != null) pts.push(sugg);
    var sMin = Math.min.apply(null, pts), sMax = Math.max.apply(null, pts);
    var pad = (sMax - sMin) * 0.08 || 10, a0 = sMin - pad, a1 = sMax + pad;
    function sp(v) { return ((v - a0) / (a1 - a0) * 100).toFixed(1); }
    return '<div><div class="strip" role="img" aria-label="Competitor prices from ' + fmt.money(n.cMin, { cur: m.P }) + ' to ' + fmt.money(n.cMax, { cur: m.P }) + ', average ' + fmt.money(n.cAvg, { cur: m.P }) + '; ' + priceLabel.toLowerCase() + ' ' + fmt.money(price, { cur: m.P }) + (sugg != null ? '; suggested ' + fmt.money(sugg, { cur: m.P }) : '') + '">' +
      '<div class="ln"></div><div class="rg" style="left:' + sp(n.cMin) + '%;width:' + (sp(n.cMax) - sp(n.cMin)).toFixed(1) + '%"></div>' +
      n.cps.map(function (v, i) { return '<span class="cp" style="left:' + sp(v) + '%" title="' + esc(m.used[i].name) + ': ' + fmt.money(v, { cur: m.P }) + '"></span>'; }).join('') +
      '<span class="av" style="left:' + sp(n.cAvg) + '%" title="Competitor average ' + fmt.money(n.cAvg, { cur: m.P }) + '"></span>' +
      '<span class="mk us" style="left:' + sp(price) + '%">' + esc(priceLabel) + '<i></i></span>' +
      (sugg != null ? '<span class="mk sg" style="left:' + sp(sugg) + '%"><i></i>' + fmt.money(sugg, { cur: m.P }) + '</span>' : '') + '</div>' +
      '<div class="strip-key"><span><i class="k-cp"></i>Competitors ' + fmt.money(n.cMin, { cur: m.P }) + '–' + fmt.money(n.cMax, { bare: true }) + '</span><span><i class="k-av"></i>Average ' + fmt.money(n.cAvg, { cur: m.P }) + '</span>' +
      '<span><i class="k-us"></i>' + esc(priceLabel) + ' ' + fmt.money(price, { cur: m.P }) + '</span>' + (sugg != null ? '<span><i class="k-sg"></i>Suggested ' + fmt.money(sugg, { cur: m.P }) + '</span>' : '') + '</div></div>';
  }
  /* the selected night against the competitor set (sits under the chart) */
  function mktCard(m, n) {
    var k = n.status.kind, price = k === 'booked' ? n.status.b.nightly : k === 'open' ? n.our : n.modelRate;
    var lbl = k === 'booked' ? 'Booked' : k === 'open' ? 'Now' : 'Model rate';
    var sugg = k === 'open' && n.change ? n.sugg : null;
    function place(v) { var below = n.cps.filter(function (c) { return c < v; }).length; return below === 0 ? 'the cheapest of the ' + (n.cps.length + 1) + ' listings' : below === n.cps.length ? 'the most expensive of the ' + (n.cps.length + 1) + ' listings' : 'cheaper than ' + (n.cps.length - below) + ' of ' + n.cps.length + ' competitors'; }
    function gap(v) { var g = v / n.cAvg - 1; return Math.abs(g) < 0.01 ? 'level with the average' : fmt.pct(Math.abs(g)) + (g > 0 ? ' above' : ' under') + ' the average'; }
    var line = (k === 'booked' ? 'Booked at ' : k === 'open' ? 'Listed at ' : 'Blocked; the model rate would be ') + fmt.money(price, { cur: m.P }) + ': ' + gap(price) + ', ' + place(price) + '.' +
      (sugg != null ? ' The suggestion of ' + fmt.money(sugg, { cur: m.P }) + ' would be ' + gap(sugg) + ' and ' + place(sugg) + '.' : '');
    return '<div class="card pr-mkt"><div class="card-head"><div class="hd"><h3>Market on ' + d.dowName(n.iso) + ' ' + d.fmt(n.iso) + '</h3><div class="sub">' + fmt.plural(m.used.length, 'competitor') + ' in the average · hover a dot for the listing</div></div></div>' +
      '<div class="card-body stack">' + marketStrip(m, n, price, lbl, sugg) + '<div class="small" style="color:var(--text-2)">' + line + '</div></div></div>';
  }
  function whyCard(m, n) {
    var P = m.P, edit = canChange();
    var head = '<div class="card-head"><div class="hd"><h3>' + (n.status.kind === 'open' ? 'Why this price' : n.status.kind === 'booked' ? 'Booked night' : 'Blocked night') + '</h3><div class="sub">' + d.dowName(n.iso) + ' ' + d.fmtY(n.iso) + ' · ' + esc(P.short || P.name) + '</div></div>' +
      '<div class="row-flex"><button type="button" class="btn btn-ghost btn-xs pr-step" data-step="-1" aria-label="Previous night">' + O.icon('left') + '</button><button type="button" class="btn btn-ghost btn-xs pr-step" data-step="1" aria-label="Next night">' + O.icon('right') + '</button></div></div>';
    var nx = nextOpen(m, n.iso);
    var nextBtn = nx ? '<button type="button" class="btn btn-quiet btn-sm" data-pick="' + nx.iso + '">Next open night: ' + d.dowName(nx.iso) + ' ' + d.fmt(nx.iso) + '</button>' : '';
    if (n.status.kind === 'booked') {
      var b = n.status.b, made = String(b.createdAt || b.checkIn).slice(0, 10), pos = b.nightly / n.cAvg - 1, lead = Math.max(0, d.diff(made, b.checkIn));
      var stayN = d.range(b.checkIn, d.add(b.checkOut, -1)).map(function (x) {
        var inR = null; for (var j = 0; j < m.days.length; j++) if (m.days[j].iso === x) { inR = m.days[j]; break; }
        return { iso: x, cAvg: inR ? inR.cAvg : avg(m.used.map(function (c) { return compPriceOf(c, P.id, x); })) };
      });
      var stayMkt = avg(stayN.map(function (x) { return x.cAvg; })), sp2 = b.nightly / stayMkt - 1;
      var verdict = sp2 < -0.08 ? 'This stay sold ' + fmt.pct(-sp2) + ' under the market average for its nights. If nights keep selling this far ahead at this gap, a higher base price or a bigger "follow the market" share in the rules would close it.'
        : sp2 > 0.05 ? 'This stay sold ' + fmt.pct(sp2) + ' above the market average for its nights.' : 'This stay sold close to the market average for its nights.';
      var body = '<div class="pr-head3"><div><div class="l">Booked rate</div><div class="v">' + fmt.money(b.nightly, { cur: P }) + '</div><div class="small muted">' + esc(U.platName(b.channel)) + '</div></div>' +
        '<div><div class="l">Market average</div><div class="v">' + fmt.money(n.cAvg, { cur: P }) + '</div><div class="small muted">' + signedPct(pos) + ' vs market</div></div>' +
        '<div><div class="l">Model today</div><div class="v">' + fmt.money(n.modelSugg, { cur: P }) + '</div><div class="small muted">if it were open</div></div></div>' +
        '<div class="note">Price locked: ' + esc(b.guest.name) + ' booked ' + fmt.plural(b.nights, 'night') + ' (' + d.fmtRange(b.checkIn, b.checkOut) + ') on ' + d.fmt(made) + ', ' + (lead === 0 ? 'the same day' : fmt.plural(lead, 'day') + ' before arrival') + ', at ' + fmt.money(b.nightly, { cur: P }) + ' a night against a market average of ' + fmt.money(stayMkt, { cur: P }) + ' for those nights.</div>' +
        '<dl class="kv"><dt>Same weekday last year</dt><dd>' + fmt.money(n.ly, { cur: P }) + ' <span class="muted small">(' + d.fmt(d.sameWeekdayYearsAgo(n.iso, 1)) + ')</span></dd><dt>Two years ago</dt><dd>' + fmt.money(n.y2, { cur: P }) + ' <span class="muted small">(' + d.fmt(d.sameWeekdayYearsAgo(n.iso, 2)) + ')</span></dd>' +
        '<dt>Booking revenue</dt><dd>' + fmt.money(b.revenue, { cur: P }) + '</dd></dl>' +
        '<div class="small muted">' + verdict + '</div>' +
        '<div class="row-flex wrap"><button type="button" class="btn btn-ghost btn-sm" data-open-bk="' + esc(b.id) + '">' + O.icon('bookings') + 'Open booking ' + esc(b.id) + '</button>' + nextBtn + '</div>';
      return '<div class="card pr-why">' + head + '<div class="card-body">' + body + '</div></div>';
    }
    if (n.status.kind !== 'open') {
      var k = n.status.block;
      var bodyB = '<div class="note">' + (k ? 'Blocked ' + d.fmtRange(k.start, k.end) + ': ' + esc(k.note || (k.type === 'owner' ? 'Owner stay' : 'Maintenance')) + '.' : 'This night has passed.') + ' No price is published for blocked nights.</div>' +
        '<dl class="kv"><dt>Market average that night</dt><dd>' + fmt.money(n.cAvg, { cur: P }) + '</dd><dt>Model rate if it were open</dt><dd>' + fmt.money(n.modelRate, { cur: P }) + '</dd><dt>Same weekday last year</dt><dd>' + fmt.money(n.ly, { cur: P }) + '</dd></dl>' +
        (nextBtn ? '<div>' + nextBtn + '</div>' : '');
      return '<div class="card pr-why">' + head + '<div class="card-body">' + bodyB + '</div></div>';
    }
    var fs = n.factors;
    var vals = [0].concat(fs.map(function (f) { return f.to; }));
    var lo = Math.min.apply(null, fs.slice(1).map(function (f) { return Math.min(f.from, f.to); }).concat([n.sugg])) * 0.82;
    lo = Math.floor(lo / 10) * 10;
    var hi = Math.ceil(Math.max.apply(null, vals.concat([n.cMax])) * 1.02 / 10) * 10;
    function pos2(v) { return clamp((v - lo) / (hi - lo) * 100, 0, 100); }
    var rows = fs.map(function (f) {
      var a = f.key === 'base' ? lo : Math.min(f.from, f.to), b2 = f.key === 'base' ? f.to : Math.max(f.from, f.to);
      var cls = f.key === 'base' ? 'base' : f.amt >= 0 ? 'up' : 'down';
      return '<div class="wf-row' + (f.amt ? '' : ' zero') + '"><div class="wl">' + esc(f.label) + '<div class="wd">' + esc(f.detail) + '</div></div>' +
        '<div class="wf-track" aria-hidden="true">' + (f.amt ? '<i class="' + cls + '" style="left:' + pos2(a).toFixed(1) + '%;width:' + Math.max(0.8, pos2(b2) - pos2(a)).toFixed(1) + '%"></i>' : '') + '</div>' +
        '<div class="wa">' + (f.key === 'base' ? fmt.money(f.amt, { cur: P }) : f.amt ? '<span class="' + (f.amt > 0 ? 'pos' : 'neg') + '">' + signed(f.amt, P) + '</span>' : fmt.money(0, { cur: P })) +
        (f.key !== 'base' && f.amt && f.pct != null ? '<small>' + signedPct(f.pct, 1) + '</small>' : '') + '</div></div>';
    }).join('');
    rows += '<div class="wf-row tot"><div class="wl">Suggested price<div class="wd">Sum of the ' + fs.length + ' lines above</div></div><div class="wf-track" aria-hidden="true"><i class="tot" style="left:0;width:' + pos2(n.sugg).toFixed(1) + '%"></i></div><div class="wa">' + fmt.money(n.sugg, { cur: P }) + '</div></div>';
    var axis = '<div class="wf-row wf-axis" aria-hidden="true"><div></div><div class="ax" title="Bar scale in ' + esc(fmt.cur(P)) + '"><span>' + fmt.money(lo, { bare: true }) + '</span><span>' + fmt.money(hi, { bare: true }) + '</span></div><div></div></div>';
    var chg = n.change, chgPct = n.our ? chg / n.our : 0;
    var top = '<div class="pr-head3"><div><div class="l">Current price</div><div class="v">' + fmt.money(n.our, { cur: P }) + '</div><div class="small muted">' + (n.how === 'suggestion' ? 'Suggestion applied' : n.how === 'manual' ? 'Set by you' : 'Model rate') + '</div></div>' +
      '<div class="sug"><div class="l">Suggested</div><div class="v">' + fmt.money(n.sugg, { cur: P }) + '</div><div class="small muted">' + (n.ev ? esc(n.ev.name) : n.run <= m.R.orphanMax ? 'Orphan night' : n.wk ? 'Weekend night' : 'Weekday night') + '</div></div>' +
      '<div><div class="l">Change</div><div class="v ' + (chg > 0 ? 'pos' : chg < 0 ? 'neg' : '') + '">' + (chg ? signed(chg, P) : 'None') + '</div><div class="small muted">' + (chg ? signedPct(chgPct, 1) + ' · ' + Math.round(n.pSell * 100) + '% chance to sell' : 'Already at the suggestion') + '</div></div></div>';
    var R = m.R, wk = weekStay(m, n.iso);
    var los = '<div class="small muted">Length-of-stay discounts come off the stay total at booking: ' + R.weeklyPct + '% for 7 nights or more, ' + R.monthlyPct + '% for 28 or more. ' +
      (wk.blockedOn ? 'A 7-night stay cannot start on this date because ' + d.fmt(wk.blockedOn) + ' is taken.' : 'A 7-night stay from this date at suggested prices: <b>' + fmt.money(wk.total * (1 - R.weeklyPct / 100), { cur: P }) + '</b> (' + fmt.money(wk.total, { cur: P }) + ' before the discount).') + '</div>';
    var acts = edit ? '<div class="pr-set">' +
      (chg ? '<button type="button" class="btn btn-primary btn-sm" data-apply-one="' + n.iso + '">' + O.icon('check') + 'Apply ' + fmt.money(n.sugg, { cur: P }) + '</button>' : '') +
      '<div class="field"><label for="pr-own">Set my own price</label><div class="inunit"><span>' + esc(fmt.cur(P)) + '</span><input id="pr-own" type="number" inputmode="numeric" min="' + R.min + '" max="' + R.max + '" step="5" value="' + n.our + '"></div></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-own="' + n.iso + '">Save price</button>' +
      (n.manual ? '<button type="button" class="btn btn-quiet btn-sm" data-revert="' + n.iso + '">Back to model rate (' + fmt.money(n.modelRate, { cur: P }) + ')</button>' : '') + '</div>'
      : '<div class="note">' + O.icon('lock') + ' ' + esc(WHY_CHANGE) + '</div>';
    return '<div class="card pr-why">' + head + '<div class="card-body">' + top + '<div class="wf">' + rows + axis + '</div>' + acts + los + '</div></div>';
  }
  /* a 7-night stay starting on iso: total at suggested (or listed) prices, or the first night that is already taken */
  function weekStay(m, iso) {
    var t = 0, byIso = {};
    m.days.forEach(function (x) { byIso[x.iso] = x; });
    for (var i = 0; i < 7; i++) {
      var x = d.add(iso, i), n = byIso[x];
      var kind = n ? n.status.kind : statusOf(m.idx, m.P.id, x).kind;
      if (kind !== 'open') return { blockedOn: x };
      var ov = overrides(m.P.id)[x];
      t += n ? n.sugg : (ov != null ? ov : rateOf(m.P.id, x));
    }
    return { total: t };
  }
  function nextOpen(m, iso) {
    for (var i = 0; i < m.days.length; i++) if (m.days[i].iso > iso && m.days[i].status.kind === 'open') return m.days[i];
    for (i = m.days.length - 1; i >= 0; i--) if (m.days[i].status.kind === 'open') return m.days[i];
    return null;
  }

  function filteredDays(m) {
    return m.days.filter(function (n) {
      if (st.view === 'open') return n.status.kind === 'open';
      if (st.view === 'booked') return n.status.kind === 'booked';
      if (st.view === 'changes') return n.status.kind === 'open' && n.our && Math.abs(n.change) / n.our >= 0.05;
      if (st.view === 'manual') return n.manual;
      return true;
    });
  }
  function tableCard(m, s) {
    var rows = filteredDays(m), pid = m.P.id, sel = st.sel[pid], edit = canChange();
    var pickable = rows.filter(function (n) { return n.status.kind === 'open' && n.change; });
    var pickedNights = m.days.filter(function (n) { return st.picked[n.iso] && n.status.kind === 'open' && n.change; });
    var allOn = pickable.length && pickable.every(function (n) { return st.picked[n.iso]; });
    var cnt = { all: m.days.length, open: s.open.length, booked: m.days.filter(function (n) { return n.status.kind === 'booked'; }).length, changes: s.review.length, manual: m.days.filter(function (n) { return n.manual; }).length };
    var body = rows.map(function (n) {
      var k = n.status.kind, open = k === 'open';
      var stCell = k === 'booked' ? '<span class="st ' + n.status.b.status + '"><i></i>' + (n.status.b.status === 'pending' ? 'Pending' : 'Booked') + '</span> ' + esc(n.status.b.guest.name.split(' ')[0])
        : k === 'blocked' ? '<span class="st block" title="Blocked"><i></i>' + (n.status.block.type === 'owner' ? 'Owner stay' : 'Maintenance') + '</span>'
          : '<span class="pill ' + (n.manual ? 'brand' : 'ok') + '">' + (n.how === 'suggestion' ? 'Open · applied' : n.how === 'manual' ? 'Open · set by you' : 'Open') + '</span>' + (n.run <= m.R.orphanMax ? ' Orphan night' : '');
      var paceW = Math.round(n.grpOTB * 100), expW = Math.round(n.usualOTB * 100);
      return '<tr data-iso="' + n.iso + '" class="' + (n.iso === sel ? 'sel ' : '') + (k !== 'open' ? 'bk ' : '') + (st.picked[n.iso] && open ? 'picked ' : '') + (n.wk ? 'wk' : '') + '">' +
        '<td>' + (open && edit ? '<input type="checkbox" data-pick-row="' + n.iso + '" aria-label="Select ' + d.fmt(n.iso) + '"' + (st.picked[n.iso] ? ' checked' : '') + (n.change ? '' : ' disabled title="Already at the suggestion"') + '>' : '') + '</td>' +
        '<td class="dt" title="' + (n.lead === 0 ? 'Tonight' : 'In ' + fmt.plural(n.lead, 'day')) + '"><button type="button" class="dt-btn" data-pick="' + n.iso + '" aria-label="Show the reasoning for ' + d.dowName(n.iso) + ' ' + d.fmt(n.iso) + '">' + d.dowName(n.iso) + ' ' + d.fmt(n.iso) + '</button>' + (n.wk ? '<span class="wkd">Weekend</span>' : '') + '<span class="stl">' + stCell + '</span></td>' +
        '<td class="num"><b>' + (k === 'blocked' ? '–' : fmt.money(n.our, { cur: m.P })) + '</b></td>' +
        '<td class="num" title="Competitors ' + fmt.money(n.cMin, { cur: m.P }) + ' to ' + fmt.money(n.cMax, { cur: m.P }) + '">' + fmt.money(n.cAvg, { cur: m.P }) + '</td>' +
        '<td class="num" title="' + d.dowName(n.iso) + ' ' + d.fmtY(d.sameWeekdayYearsAgo(n.iso, 1)) + '">' + fmt.money(n.ly, { cur: m.P }) + '</td>' +
        '<td class="pace" title="' + esc(m.groupName) + ': ' + n.grpBooked + ' of ' + n.grpAvail + ' booked; usually ' + expW + '% at this lead time (last 90 days)"><i><b style="width:' + paceW + '%"></b><em style="left:' + expW + '%"></em></i>' + paceW + '% <span class="faint">/ ' + expW + '%</span></td>' +
        '<td class="evt small">' + (n.ev ? '<span class="pill accent">' + esc(n.ev.name) + '</span>' : '<span class="faint">–</span>') + '</td>' +
        '<td class="num sg">' + (open ? fmt.money(n.sugg, { cur: m.P }) : '<span class="faint">' + (k === 'booked' ? 'Locked' : '–') + '</span>') + '</td>' +
        '<td class="num">' + (open ? (n.change ? '<b class="' + (n.change > 0 ? 'pos' : 'neg') + '" title="' + signedPct(n.change / n.our, 1) + '">' + signed(n.change, m.P) + '</b>' : '<span class="faint">' + (n.how === 'suggestion' ? 'Applied' : 'At suggestion') + '</span>') : '') + '</td>' +
        '<td class="why">' + (open ? shortReason(n) : k === 'booked' ? '<span class="row-flex" style="gap:5px">' + U.platIcon(n.status.b.channel) + '<span class="faint">' + esc(n.status.b.id) + '</span></span>' : '<span class="faint">' + esc((n.status.block && n.status.block.note) || 'Blocked') + '</span>') + '</td></tr>';
    }).join('');
    var pickedChg = sum(pickedNights.map(function (n) { return n.change; }));
    var bulk = !edit ? '<span class="pill neutral">' + O.icon('lock') + 'View only</span>'
      : (pickedNights.length ? '<span class="small"><b>' + fmt.plural(pickedNights.length, 'night') + '</b> selected · ' + signed(pickedChg, m.P) + ' in total</span><button type="button" class="btn btn-ghost btn-sm" data-clear-pick>Clear</button>' : '') +
        '<button type="button" class="btn btn-primary btn-sm" data-apply-picked' + (pickedNights.length ? '' : ' disabled') + '>' + O.icon('check') + 'Apply to selected' + (pickedNights.length ? ' (' + pickedNights.length + ')' : '') + '</button>';
    return '<div class="card pr-tablecard"><div class="card-head"><div class="hd"><h3>Night by night</h3><div class="sub">' + (edit ? 'Tick nights and apply their suggestions, or click a night to see its reasoning.' : 'Click a night to see its reasoning.') + ' Pace: share of ' + esc(m.groupName) + ' booked for that night; the marker shows the usual share at the same lead time.' + (typeNote(m.P) ? ' <b>' + esc(typeNote(m.P)) + '.</b>' : '') + '</div></div>' +
      '<div class="pr-bulk">' + bulk + '</div></div>' +
      '<div class="card-body" style="padding-bottom:10px"><div class="row-flex wrap">' +
      U.seg([['all', 'All nights ' + cnt.all], ['open', 'Open ' + cnt.open], ['booked', 'Booked ' + cnt.booked], ['changes', 'Change ≥ 5% ' + cnt.changes], ['manual', 'Changed by you ' + cnt.manual]], st.view, 'data-view') + '</div></div>' +
      (rows.length ? '<div class="table-wrap pr-scroll"><table class="table pr-tbl"><thead><tr>' +
        '<th>' + (edit ? '<input type="checkbox" data-pick-all aria-label="Select all nights with a suggested change"' + (allOn ? ' checked' : '') + (pickable.length ? '' : ' disabled') + '>' : '') + '</th>' +
        '<th>Night · status</th><th class="num">Our price</th><th class="num" title="Average of the competitor set">Comp avg</th><th class="num" title="Same weekday last year">Last year</th><th title="Share of ' + esc(m.groupName) + ' booked for the night / usual share at this lead time">Pace (now / usual)</th><th>Event</th><th class="num">Suggested</th><th class="num">Change</th><th>Main reasons (' + esc(fmt.cur(m.P)) + ')</th>' +
        '</tr></thead><tbody>' + body + '</tbody></table></div>'
        : U.empty(st.view === 'manual' ? 'No prices in this range have been changed by hand or by applying a suggestion.' : st.view === 'changes' ? 'Every open night is within 5% of its suggestion.' : st.view === 'booked' ? 'No booked nights in this range.' : 'No open nights in this range.')) +
      '</div>';
  }

  function compCard(m, s, n) {
    var pid = m.P.id, ex = st.excl[pid] || {};
    var priced = s.priced;
    var rows = m.comps.map(function (c) {
      var prices = priced.map(function (x) { return compPriceOf(c, pid, x.iso); });
      var a = avg(prices);
      return { c: c, avg: a, vs: s.ourAvg ? a / s.ourAvg - 1 : 0, on: n ? compPriceOf(c, pid, n.iso) : null, dist: c.distanceKm, rating: c.rating, occ: c.occ, reviews: c.reviews };
    });
    var k = st.compSort.k, dir = st.compSort.dir;
    rows.sort(function (a, b) { return (a[k] - b[k]) * dir; });
    var revs = D.reviews.filter(function (r) { return r.propertyId === pid; });
    var ourRating = revs.length ? avg(revs.map(function (r) { return r.stars; })) : null;
    var onLabel = n ? d.fmt(n.iso) : '';
    var ourOn = n ? (n.status.kind === 'booked' ? n.status.b.nightly : n.status.kind === 'open' ? n.our : null) : null;
    function th(key, label, title) { return '<th class="num"' + (title ? ' title="' + esc(title) + '"' : '') + '><button type="button" class="th-sort' + (k === key ? ' on' : '') + '" data-sort="' + key + '" aria-label="Sort by ' + esc(label.toLowerCase()) + '">' + label + (k === key ? O.icon(dir > 0 ? 'up' : 'down') : '') + '</button></th>'; }
    var none = !priced.length;
    var body = '<tr class="us"><td></td><td><div class="cmp-nm">' + U.platIcon('direct', 'Your listing') + esc(m.P.name) + ' <span class="pill brand">You</span></div></td><td class="nowrap">' + bedsLabel(m.P.beds) + '</td><td class="num">–</td><td class="num nowrap">' + (ourRating ? '<span class="stars">★</span> ' + ourRating.toFixed(2) + ' <span class="faint">(' + revs.length + ')</span>' : '–') + '</td><td class="num nowrap">' + (s.avail ? fmt.pct(s.otb) + '<span class="faint"> booked</span>' : '–') + '</td><td class="num">' + (none ? '–' : fmt.money(s.ourAvg, { cur: m.P })) + '</td>' + (n ? '<td class="num">' + (ourOn != null ? fmt.money(ourOn, { cur: m.P }) : '–') + '</td>' : '') + '<td class="num">–</td></tr>' +
      rows.map(function (r) {
        var off = !!ex[r.c.id];
        return '<tr class="' + (off ? 'off' : '') + '"><td><input type="checkbox" data-comp="' + esc(r.c.id) + '" aria-label="Use ' + esc(r.c.name) + ' in the average"' + (off ? '' : ' checked') + '></td>' +
          '<td><div class="cmp-nm">' + U.platIcon(r.c.channel) + esc(r.c.name) + (off ? ' <span class="faint small">left out</span>' : '') + '</div></td><td class="nowrap">' + bedsLabel(r.c.beds) + '</td><td class="num nowrap">' + r.c.distanceKm.toFixed(1) + ' km</td>' +
          '<td class="num nowrap"><span class="stars">★</span> ' + r.c.rating.toFixed(2) + ' <span class="faint">(' + r.c.reviews + ')</span></td><td class="num">' + r.c.occ + '%</td>' +
          '<td class="num"><b>' + (none ? '–' : fmt.money(r.avg, { cur: m.P })) + '</b></td>' + (n ? '<td class="num">' + fmt.money(r.on, { cur: m.P }) + '</td>' : '') +
          '<td class="num">' + (none ? '–' : '<span class="' + (r.vs > 0.02 ? 'pos' : r.vs < -0.02 ? 'neg' : '') + '">' + signedPct(r.vs) + '</span>') + '</td></tr>';
      }).join('');
    return '<div class="card"><div class="card-head"><div class="hd"><h3>Competitor set</h3><div class="sub">' + m.used.length + ' of ' + m.comps.length + ' similar listings within 2.5 km are in the average. Untick a listing to leave it out (at least 3 stay in).</div></div></div>' +
      '<div class="table-wrap"><table class="table pr-tbl"><thead><tr><th><span class="sr-only">Use in average</span></th><th>Listing</th><th>Beds</th>' + th('dist', 'Distance') + th('rating', 'Rating') + th('occ', 'Occupancy', 'Competitors: typical occupancy from the market feed. Your listing: nights booked in this range.') + th('avg', 'Avg price', 'Average nightly price over the booked and open nights in this range') + (n ? '<th class="num" title="Price on the night selected above">' + onLabel + '</th>' : '') + th('vs', 'vs ours', 'Their average compared with ours for the same nights') + '</tr></thead><tbody>' + body + '</tbody>' +
      '<tfoot><tr><td></td><td>Competitor average</td><td></td><td></td><td class="num">' + avg(m.used.map(function (c) { return c.rating; })).toFixed(2) + '</td><td class="num">' + Math.round(m.mOcc * 100) + '%</td><td class="num">' + (none ? '–' : fmt.money(s.compAvg, { cur: m.P })) + '</td>' + (n ? '<td class="num">' + fmt.money(n.cAvg, { cur: m.P }) + '</td>' : '') + '<td class="num">' + (none ? '–' : signedPct(s.compAvg / s.ourAvg - 1)) + '</td></tr></tfoot></table></div>' +
      '<div class="card-foot">Competitor prices and occupancy here are sample figures until a market data feed is connected for listings near each property.</div></div>';
  }
  function historyCard(m, s, n) {
    var days = s.priced.length ? s.priced : m.days;
    var lyAvg = avg(days.map(function (x) { return x.ly; })), y2Avg = avg(days.map(function (x) { return x.y2; }));
    var sel = n || m.days[0];
    var a1 = d.sameWeekdayYearsAgo(sel.iso, 1), a2 = d.sameWeekdayYearsAgo(sel.iso, 2);
    var cur = sel.status.kind === 'blocked' ? null : sel.our;
    function since(prev) { return cur ? ' · ' + U.delta(fmt.change(cur, prev), { suffix: 'since then' }) : ''; }
    var boxes = '<div class="hist">' +
      '<div class="cur"><div class="l"><i class="key k0"></i>This year</div><div class="v">' + (cur ? fmt.money(cur, { cur: m.P }) : '–') + '</div><div class="s">' + d.dowName(sel.iso) + ' ' + d.fmtY(sel.iso) + (sel.status.kind === 'booked' ? ' · booked' : sel.status.kind === 'blocked' ? ' · blocked' : sel.change ? ' · suggested ' + fmt.money(sel.sugg, { cur: m.P }) : '') + '</div></div>' +
      '<div><div class="l"><i class="key k1"></i>Last year</div><div class="v">' + fmt.money(sel.ly, { cur: m.P }) + '</div><div class="s">' + d.dowName(a1) + ' ' + d.fmtY(a1) + since(sel.ly) + '</div></div>' +
      '<div><div class="l"><i class="key k2"></i>Two years ago</div><div class="v">' + fmt.money(sel.y2, { cur: m.P }) + '</div><div class="s">' + d.dowName(a2) + ' ' + d.fmtY(a2) + since(sel.y2) + '</div></div></div>';
    var withSugg = avg(m.days.filter(function (x) { return x.status.kind !== 'blocked'; }).map(function (x) { return x.sugg != null ? x.sugg : x.our; }));
    var sentence = !s.priced.length ? 'Every night in this range is blocked, so there is no price to compare.'
      : 'Across the range our average is ' + fmt.money(s.ourAvg, { cur: m.P }) + ', ' + signedPct(fmt.change(s.ourAvg, lyAvg), 1) + ' on last year and ' + signedPct(fmt.change(s.ourAvg, y2Avg), 1) + ' on two years ago' +
        (s.changes.length ? '. With the suggestions applied it would be ' + fmt.money(withSugg, { cur: m.P }) + ', ' + signedPct(fmt.change(withSugg, lyAvg), 1) + ' on last year.' : '.');
    return '<div class="card"><div class="card-head"><div class="hd"><h3>Same date in previous years</h3><div class="sub">Like-for-like: the same weekday 364 and 728 days earlier</div></div></div><div class="card-body stack">' + boxes +
      '<div><div class="label" style="margin-bottom:6px">Average by night of the week, ' + U.rangeLabel(m.days[0].iso, m.days[m.days.length - 1].iso) + '</div><div class="pr-dow"></div>' +
      O.chart.legend([{ name: 'This year ' + (s.priced.length ? fmt.money(s.ourAvg, { cur: m.P }) : '–'), tone: 'brand', square: true }, { name: 'Last year ' + fmt.money(lyAvg, { cur: m.P }), tone: 'prev1', square: true }, { name: 'Two years ago ' + fmt.money(y2Avg, { cur: m.P }), tone: 'prev2', square: true }]) + '</div>' +
      '<div class="small muted">' + sentence + '</div></div></div>';
  }
  function drawDow(root, m) {
    var el = O.$('.pr-dow', root); if (!el) return;
    var order = [1, 2, 3, 4, 5, 6, 0], names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var by = order.map(function (w) { return m.days.filter(function (x) { return d.dow(x.iso) === w && x.status.kind !== 'blocked'; }); });
    O.chart.bars(el, {
      labels: names, height: 170,
      yFormat: function (v, axis) { return axis ? fmt.cur(m.P) + ' ' + Math.round(v) : fmt.money(v, { cur: m.P }); },
      tipTitle: function (i) { return names[i] + ' nights (' + by[i].length + ')'; },
      series: [
        { name: 'This year', tone: 'brand', values: by.map(function (a) { return Math.round(avg(a.map(function (x) { return x.our; }))); }) },
        { name: 'Last year', tone: 'prev1', values: by.map(function (a) { return Math.round(avg(a.map(function (x) { return x.ly; }))); }) },
        { name: 'Two years ago', tone: 'prev2', values: by.map(function (a) { return Math.round(avg(a.map(function (x) { return x.y2; }))); }) }
      ]
    });
  }

  function rulesCard(m) {
    var R = m.R, pid = m.P.id, edit = canRules();
    function num(name, label, unit, val, hint, step) {
      return '<div class="field"><label for="pr-r-' + name + '">' + label + '</label><div class="inunit">' + (unit === 'RM' ? '<span>' + esc(fmt.cur(m.P)) + '</span>' : '') + '<input id="pr-r-' + name + '" name="' + name + '" type="number" inputmode="numeric" min="0" step="' + (step || 1) + '" value="' + val + '">' + (unit !== 'RM' ? '<span>' + unit + '</span>' : '') + '</div>' + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
    }
    var log = D.priceLog.filter(function (x) { return x.pid === pid; }).slice(0, 5);
    return '<div class="card rules"><div class="card-head"><div class="hd"><h3>Pricing rules</h3><div class="sub">Used by every suggestion for ' + esc(m.P.short || m.P.name) + '</div></div>' + (edit ? '' : '<span class="pill neutral">' + O.icon('lock') + 'View only</span>') + '</div>' +
      '<form class="card-body stack" data-rules novalidate><fieldset class="pr-fs"' + (edit ? '' : ' disabled') + '><legend class="sr-only">Pricing rules for ' + esc(m.P.name) + '</legend>' +
      '<div class="form-grid">' +
      '<div class="sec">Price limits</div>' +
      num('base', 'Base price', 'RM', R.base, 'Before season and demand', 5) + num('min', 'Minimum price', 'RM', R.min, 'Never publish below', 5) +
      num('max', 'Maximum price', 'RM', R.max, 'Never publish above', 5) + num('compWeight', 'Follow the market', '%', R.compWeight, 'Share of the competitor gap to close', 5) +
      '<div class="sec">Uplifts and discounts</div>' +
      num('weekendPct', 'Weekend uplift', '%', R.weekendPct, 'Fri and Sat nights') + num('orphanPct', 'Orphan-night discount', '%', R.orphanPct, 'Single open night between stays') +
      num('lastMinPct', 'Last-minute discount', '%', R.lastMinPct, 'Half of it from 4 to 7 days out') + num('lastMinDays', 'Last-minute window', 'days', R.lastMinDays, 'Waived when demand is strong') +
      num('weeklyPct', 'Weekly stay discount', '%', R.weeklyPct, '7 nights or more') + num('monthlyPct', 'Monthly stay discount', '%', R.monthlyPct, '28 nights or more') +
      '</div>' +
      '<div class="auto-row"><div><div class="b small">Auto-apply suggestions</div><div class="small muted">' + (R.auto ? 'On: next run tomorrow at 6:00 AM for the next 90 nights, within the limits above' : 'Every day at 6:00 AM for the next 90 nights, within the limits above') + '</div></div><button type="button" class="switch' + (R.auto ? ' on' : '') + '" data-auto role="switch" aria-checked="' + (R.auto ? 'true' : 'false') + '" aria-label="Auto-apply suggestions"></button></div>' +
      '<div class="row-flex wrap"><button type="submit" class="btn btn-primary btn-sm">Save rules</button><button type="button" class="btn btn-ghost btn-sm" data-rules-reset>Reset to defaults</button><button type="button" class="btn btn-quiet btn-sm" data-rules-copy>Copy to all properties</button></div></fieldset>' +
      (edit ? '' : '<div class="note">' + O.icon('lock') + ' ' + esc(WHY_RULES) + '</div>') +
      '<div class="log"><div class="label">Recent changes</div>' + (log.length ? log.map(function (x) {
        return '<div><span>' + esc(x.text || (x.how + ': ' + fmt.plural(x.n, 'night') + ' (' + (x.first === x.last ? d.fmt(x.first) : d.fmtRange(x.first, x.last)) + ')')) + '</span><span class="muted nowrap">' + esc(x.by) + '</span></div>';
      }).join('') : '<div class="muted">No price or rule changes for ' + esc(m.P.short || m.P.name) + ' yet.</div>') + '</div>' +
      '</form></div>';
  }

  function portfolioCard(from, to, idx) {
    var rows = D.properties.map(function (p) {
      var m = model(p.id, from, to, { idx: idx }), s = summary(m);
      return { p: p, s: s };
    });
    var tot = { impact: sum(rows.filter(function (r) { return O.inCur(r.p); }).map(function (r) { return r.s.impact; })), review: sum(rows.map(function (r) { return r.s.review.length; })) };
    return '<div class="card"><div class="card-head"><div class="hd"><h3>All properties</h3><div class="sub">Same range, same model. Click a property to analyse it.</div></div><div class="row-flex wrap">' + O.curSwitchHTML() + '<span class="pill accent">' + fmt.plural(tot.review, 'night') + ' to review · ' + moneySigned(tot.impact) + ' expected</span></div></div>' +
      '<div class="table-wrap"><table class="table pr-tbl"><thead><tr><th>Property</th><th class="num">Our avg</th><th class="num">Comp avg</th><th class="num" title="Share of nights booked; the market usually has this share booked by now">On the books</th><th class="num">Avg suggested</th><th class="num" title="Open nights where the suggestion differs by 5% or more">To review</th><th class="num">Expected impact</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var s = r.s, none = !s.priced.length;
        return '<tr data-prop="' + r.p.id + '" class="' + (r.p.id === st.pid ? 'cur-prop' : '') + '"><td><div class="cmp-nm"><span class="prop-dot" style="background:' + U.propColor(r.p.id) + '"></span><button type="button" class="dt-btn" data-prop-go="' + r.p.id + '">' + esc(r.p.short || r.p.name) + '</button></div><span class="rng">' + esc(city(r.p)) + ' · ' + esc(r.p.type || '') + '</span></td>' +
          '<td class="num">' + (none ? '<span class="faint">Blocked</span>' : fmt.money(s.ourAvg, { cur: r.p })) + '</td><td class="num">' + (none ? '–' : fmt.money(s.compAvg, { cur: r.p })) + '</td>' +
          '<td class="num" title="' + (s.avail ? 'Market usually ' + fmt.pct(s.mkt) + ' by now' : '') + '">' + (s.avail ? fmt.pct(s.otb) : '–') + '</td><td class="num">' + (s.open.length ? fmt.money(s.suggAvg, { cur: r.p }) : '–') + '</td><td class="num">' + (s.review.length || '<span class="faint">0</span>') + '</td>' +
          '<td class="num">' + (s.changes.length ? '<b class="' + (s.impact > 0 ? 'pos' : s.impact < 0 ? 'neg' : '') + '">' + moneySigned(s.impact, r.p) + '</b>' : '<span class="faint">' + (s.open.length ? 'Up to date' : 'No open nights') + '</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* ------------------------------------------------------------------ page */
  O.page('pricing', {
    desc: 'Suggested nightly prices with the reasoning behind each one, against competitors and previous years',
    render: function (root, ctx) {
      var p0 = ctx.params || {};
      if (!canView()) { ctx.setActions(''); root.innerHTML = U.locked('Pricing', { reason: 'permission' }); return; }
      var edit = canChange(), editRules = canRules();
      /* empty workspace: nothing to price yet */
      if (!D.properties.length) {
        ctx.setActions('');
        var canAdd = O.allowed('properties') && O.can('properties.create');
        root.innerHTML = '<div class="pg-pricing"><div class="card"><div class="empty"><div class="e-icon">' + O.icon('pricing') + '</div><p style="margin:0 0 12px">Add a property to see suggested nightly prices for it.</p>' +
          (canAdd ? '<button type="button" class="btn btn-primary" data-go-props>' + O.icon('plus') + 'Add a property</button>' : '') + '</div></div></div>';
        var gb = O.$('[data-go-props]', root); if (gb) gb.onclick = function () { O.go('properties'); };
        return;
      }
      if (p0.propertyId && D.propById[p0.propertyId] && ctx.fresh) { st.pid = p0.propertyId; st.picked = {}; }
      if (!D.propById[st.pid]) { st.pid = D.properties[0].id; st.picked = {}; }
      /* the range is worked out from today on every render, so it moves with the clock */
      if (st.preset || !st.from) { var pr = U.preset(st.preset || 'next30'); st.from = pr.from; st.to = pr.to; st.preset = st.preset || 'next30'; }
      if (st.from < D.TODAY) st.from = D.TODAY;
      if (st.to < st.from) st.to = d.add(st.from, 29);
      if (p0.date && ctx.fresh) { st.sel[st.pid] = p0.date; if (p0.date > st.to) { st.to = d.add(p0.date, 14); st.preset = null; } }
      ctx.fresh = false;
      var pid = st.pid, idx = occupancyIndex();
      if (!(Number(D.propById[pid].base) > 0)) {
        /* a property saved without a base price: nothing to build suggestions from */
        ctx.setActions('');
        root.innerHTML = '<div class="pg-pricing"><div class="toolbar"><select class="select pr-prop" data-prop-sel aria-label="Property">' + D.properties.map(function (q) { return '<option value="' + q.id + '"' + (q.id === pid ? ' selected' : '') + '>' + esc(q.name) + '</option>'; }).join('') + '</select></div>' +
          '<div class="card"><div class="empty"><div class="e-icon">' + O.icon('pricing') + '</div><p style="margin:0 0 12px">Set a base price for ' + esc(D.propById[pid].name) + ' to get suggested prices.</p>' + (O.allowed('properties') ? '<button type="button" class="btn btn-primary" data-go-props>Open properties</button>' : '') + '</div></div></div>';
        O.$('[data-prop-sel]', root).onchange = function (e) { st.pid = e.target.value; st.picked = {}; ctx.rerender(); };
        var gp = O.$('[data-go-props]', root); if (gp) gp.onclick = function () { O.go('properties', { propertyId: pid }); };
        return;
      }
      var m = model(pid, st.from, st.to, { idx: idx }), s = summary(m);
      /* selected night: keep if in range, else the open night with the biggest suggested change */
      var isos = m.days.map(function (n) { return n.iso; });
      if (isos.indexOf(st.sel[pid]) < 0) {
        var best = s.open.slice().sort(function (a, b) { return Math.abs(b.change) - Math.abs(a.change); })[0];
        st.sel[pid] = best ? best.iso : isos[0];
      }
      var n = m.days[isos.indexOf(st.sel[pid])];
      var P = m.P;

      root.innerHTML = '<div class="pg-pricing">' +
        '<div class="toolbar"><select class="select pr-prop" data-prop-sel aria-label="Property">' + D.properties.map(function (q) { return '<option value="' + q.id + '"' + (q.id === pid ? ' selected' : '') + '>' + esc(q.name) + '</option>'; }).join('') + '</select>' +
        '<span data-slot="range"></span><span class="spacer"></span>' +
        '<span class="pr-auto"' + (editRules ? '' : ' title="' + esc(WHY_RULES) + '"') + '>Auto-apply <button type="button" class="switch' + (m.R.auto ? ' on' : '') + '" data-auto role="switch" aria-checked="' + (m.R.auto ? 'true' : 'false') + '" aria-label="Auto-apply suggestions daily"' + (editRules ? '' : ' disabled') + '></button></span></div>' +
        '<div class="pr-ctx"><b>' + esc(P.type || '') + '</b>' + (P.area ? '<span class="dot"></span>' + esc(P.area) : '') + '<span class="dot"></span>Base price ' + fmt.money(m.R.base, { cur: P }) + '<span class="dot"></span>' + s.open.length + ' of ' + fmt.plural(m.days.length, 'night') + ' open</div>' +
        kpiStrip(m, s) +
        '<div class="grid g-3-2 pr-top"><div class="pr-left">' + chartCard(m) + mktCard(m, n) + '</div>' + whyCard(m, n) + '</div>' +
        tableCard(m, s) +
        compCard(m, s, n) +
        '<div class="grid g2">' + historyCard(m, s, n) + rulesCard(m) + '</div>' +
        portfolioCard(st.from, st.to, idx) +
        '</div>';

      U.mount(root, 'range', U.dateRange({
        from: st.from, to: st.to, preset: st.preset, presets: 'future',
        onChange: function (r) { st.from = r.from < D.TODAY ? D.TODAY : r.from; st.to = r.to < st.from ? st.from : r.to; st.preset = r.preset; st.picked = {}; ctx.rerender(); }
      }));
      drawChart(root, m);
      drawDow(root, m);
      O.curSwitchWire(root);

      /* top bar actions */
      var openChanges = s.changes;
      ctx.setActions('<button type="button" class="btn btn-ghost btn-sm" data-pr-csv>' + O.icon('download') + 'Export CSV</button>' +
        (edit ? '<button type="button" class="btn btn-primary btn-sm" data-pr-all' + (openChanges.length ? '' : ' disabled') + '>' + O.icon('sparkle') + (openChanges.length ? (openChanges.length === 1 ? 'Apply 1 suggestion' : 'Apply all ' + openChanges.length + ' suggestions') : s.open.length ? 'All suggestions applied' : 'No open nights to price') + '</button>' : ''));
      var A = ctx.actionsEl;
      O.$('[data-pr-csv]', A).onclick = function () {
        var rows = [['Date', 'Day', 'Status', 'Our price (' + fmt.cur(P) + ')', 'Competitor avg (' + fmt.cur(P) + ')', 'Competitor min', 'Competitor max', 'Index', 'Same weekday last year', 'Same weekday 2 years ago', 'Pace ' + m.groupName, 'Usual pace', 'Event', 'Suggested (' + fmt.cur(P) + ')', 'Change (' + fmt.cur(P) + ')', 'Factors']];
        m.days.forEach(function (x) {
          rows.push([x.iso, d.dowName(x.iso), x.status.kind, x.status.kind === 'blocked' ? '' : x.our, Math.round(x.cAvg), x.cMin, x.cMax, x.status.kind === 'blocked' ? '' : Math.round(x.our / x.cAvg * 100), x.ly, x.y2, Math.round(x.grpOTB * 100) + '%', Math.round(x.usualOTB * 100) + '%', x.ev ? x.ev.name : '', x.sugg != null ? x.sugg : '', x.sugg != null ? x.change : '',
            x.factors ? x.factors.map(function (f) { return f.label + ' ' + (f.key === 'base' ? f.amt : (f.amt >= 0 ? '+' : '') + f.amt); }).join('; ') : '']);
        });
        O.downloadCSV('pricing-' + pid + '-' + st.from + '-to-' + st.to + '.csv', rows);
      };
      var allBtn = O.$('[data-pr-all]', A);
      if (allBtn) allBtn.onclick = function () {
        if (!openChanges.length) return;
        var ups = openChanges.filter(function (x) { return x.change > 0; }), dns = openChanges.filter(function (x) { return x.change < 0; });
        var big = openChanges.slice().sort(function (a, b) { return Math.abs(b.change) - Math.abs(a.change); }).slice(0, 4);
        var body = '<div class="stack pr-modal">' +
          '<dl class="kv"><dt>Prices going up</dt><dd><span class="pos">' + fmt.plural(ups.length, 'night') + (ups.length ? ' · ' + signed(sum(ups.map(function (x) { return x.change; })), P) : '') + '</span></dd>' +
          '<dt>Prices going down</dt><dd><span class="neg">' + fmt.plural(dns.length, 'night') + (dns.length ? ' · ' + signed(sum(dns.map(function (x) { return x.change; })), P) : '') + '</span></dd>' +
          '<dt>Expected impact</dt><dd>' + moneySigned(s.impact, P) + '</dd><dt>If every open night sells</dt><dd>' + moneySigned(s.upside, P) + '</dd></dl>' +
          '<div><div class="label" style="margin-bottom:4px">Biggest changes</div>' + big.map(function (x) { return '<div class="row-flex small" style="justify-content:space-between"><span>' + d.dowName(x.iso) + ' ' + d.fmt(x.iso) + '</span><span>' + fmt.money(x.our, { cur: P }) + ' → <b>' + fmt.money(x.sugg, { cur: P }) + '</b> <span class="' + (x.change > 0 ? 'pos' : 'neg') + '">' + signed(x.change, P) + '</span></span></div>'; }).join('') + '</div>' +
          '<div class="small muted">Booked and blocked nights do not change.' + (typeNote(P) ? ' ' + esc(typeNote(P)) + '.' : '') + ' ' + esc(channelNote(P)) + '</div></div>';
        U.modal({
          title: 'Apply ' + fmt.plural(openChanges.length, 'suggested price') + ' to ' + (P.short || P.name) + '?', sub: U.rangeLabel(st.from, st.to) + ' · ' + fmt.plural(s.open.length, 'open night'), body: body,
          actions: [{ label: 'Cancel' }, { label: 'Apply ' + fmt.plural(openChanges.length, 'price'), kind: 'primary', onClick: function () { applyPrices(pid, openChanges.map(function (x) { return { iso: x.iso, price: x.sugg }; }), 'Suggestions applied'); } }]
        });
      };

      /* events */
      function select(iso) { st.sel[pid] = iso; ctx.rerender(); }
      O.$('[data-prop-sel]', root).onchange = function (e) { st.pid = e.target.value; st.picked = {}; ctx.rerender(); };
      var pg = O.$('.pg-pricing', root);
      var cw = O.$('.pr-chart-wrap', root);
      if (cw) cw.addEventListener('click', function (e) { var i = chartIndex(root, m.days.length, e.clientX); if (i >= 0) select(m.days[i].iso); });
      pg.addEventListener('change', function (e) {
        var t = e.target;
        if (t.matches('[data-pick-row]')) { st.picked[t.dataset.pickRow] = t.checked; ctx.rerender(); }
        else if (t.matches('[data-pick-all]')) {
          filteredDays(m).forEach(function (x) { if (x.status.kind === 'open' && x.change) st.picked[x.iso] = t.checked; });
          ctx.rerender();
        } else if (t.matches('[data-comp]')) {
          var ex = st.excl[pid] = st.excl[pid] || {};
          var on = m.comps.filter(function (c) { return !ex[c.id]; }).length;
          if (!t.checked && on <= 3) { t.checked = true; U.toast('Keep at least 3 listings in the competitor set', 'bad'); return; }
          if (t.checked) delete ex[t.dataset.comp]; else ex[t.dataset.comp] = true;
          ctx.rerender();
        }
      });
      pg.addEventListener('submit', function (e) {
        var f = e.target; if (!f.matches('[data-rules]')) return;
        e.preventDefault();
        if (!editRules) { U.toast(WHY_RULES, 'bad'); return; }
        var v = {}, empty = false;
        Object.keys(RULE_LABELS).forEach(function (k) { var raw = String(f.elements[k].value).trim(); if (raw === '') empty = true; v[k] = Number(raw); });
        var bad = Object.keys(v).filter(function (k) { return isNaN(v[k]) || v[k] < 0; });
        if (empty || bad.length) { U.toast('Enter a number of 0 or more in every rule', 'bad'); return; }
        if (v.lastMinDays !== Math.round(v.lastMinDays) || v.lastMinDays > 14) { U.toast('The last-minute window is a whole number of days, 14 at most', 'bad'); return; }
        if (v.min >= v.max) { U.toast('Minimum price must be lower than the maximum', 'bad'); return; }
        if (v.base < v.min || v.base > v.max) { U.toast('Base price must sit between the minimum and maximum', 'bad'); return; }
        if (v.compWeight > 100 || v.weekendPct > 100 || v.lastMinPct > 60 || v.orphanPct > 60 || v.weeklyPct > 60 || v.monthlyPct > 70) { U.toast('One of the percentages is too high; check the rules', 'bad'); return; }
        var changed = Object.keys(v).filter(function (k) { return v[k] !== m.R[k]; });
        if (!changed.length) { U.toast('No changes to save for ' + P.short); return; }
        var what = changed.map(function (k) { var u = RULE_LABELS[k][1]; function f2(x) { return u === 'RM' ? fmt.money(x, { cur: P }) : x + (u === '%' ? '%' : ' days'); } return RULE_LABELS[k][0] + ' ' + f2(m.R[k]) + ' → ' + f2(v[k]); });
        Object.assign(ownRules(pid), v);
        D.priceLog.unshift({ at: D.NOW, pid: pid, by: (O.viewer() || {}).name || '', text: 'Rules: ' + what.join(', ') });
        audit('Changed pricing rules for ' + P.name + ': ' + what.join(', '));
        U.toast('Rules saved for ' + P.short + '. Suggestions recalculated.');
        O.emit('data', { type: 'pricing-rules' });
      });
      pg.addEventListener('click', function (e) {
        var t = e.target.closest('button, tr[data-iso], tr[data-prop]'); if (!t) return;
        if (t.matches('[data-chart]')) { st.chart = t.dataset.chart; ctx.rerender(); return; }
        if (t.matches('[data-view]')) { st.view = t.dataset.view; ctx.rerender(); return; }
        if (t.matches('[data-step]')) {
          var i = isos.indexOf(st.sel[pid]) + Number(t.dataset.step);
          if (i >= 0 && i < isos.length) select(isos[i]); return;
        }
        if (t.matches('[data-pick]')) { select(t.dataset.pick); return; }
        if (t.matches('[data-open-bk]')) { O.booking.open(t.dataset.openBk); return; }
        if (t.matches('[data-apply-one]')) { applyPrices(pid, [{ iso: n.iso, price: n.sugg }], 'Suggestion applied'); return; }
        if (t.matches('[data-own]')) {
          var val = Math.round(Number(O.$('#pr-own', root).value));
          if (!val) { U.toast('Enter a price in ' + fmt.cur(P), 'bad'); return; }
          if (val < m.R.min || val > m.R.max) { U.toast('Price must be between ' + fmt.money(m.R.min, { cur: P }) + ' and ' + fmt.money(m.R.max, { cur: P }) + ' (your rules)', 'bad'); return; }
          if (val === n.our) { U.toast(d.fmt(n.iso) + ' is already listed at ' + fmt.money(val, { cur: P })); return; }
          applyPrices(pid, [{ iso: n.iso, price: val }], 'Price set manually'); return;
        }
        if (t.matches('[data-revert]')) { revert(pid, [t.dataset.revert]); return; }
        if (t.matches('[data-clear-pick]')) { st.picked = {}; ctx.rerender(); return; }
        if (t.matches('[data-apply-picked]')) {
          var list = m.days.filter(function (x) { return st.picked[x.iso] && x.status.kind === 'open' && x.change; });
          applyPrices(pid, list.map(function (x) { return { iso: x.iso, price: x.sugg }; }), 'Suggestions applied'); return;
        }
        if (t.matches('[data-sort]')) {
          var k = t.dataset.sort; st.compSort = { k: k, dir: st.compSort.k === k ? -st.compSort.dir : (k === 'dist' ? 1 : -1) }; ctx.rerender(); return;
        }
        if (t.matches('[data-auto]')) {
          if (!editRules) { U.toast(WHY_RULES, 'bad'); return; }
          m.R = ownRules(pid);
          m.R.auto = !m.R.auto;
          D.priceLog.unshift({ at: D.NOW, pid: pid, by: (O.viewer() || {}).name || '', text: 'Auto-apply turned ' + (m.R.auto ? 'on' : 'off') });
          audit('Turned auto-apply ' + (m.R.auto ? 'on' : 'off') + ' for ' + P.name);
          U.toast(m.R.auto ? 'Auto-apply on for ' + P.short + ': suggestions publish daily at 6:00 AM within your limits' : 'Auto-apply off for ' + P.short + ': prices change only when you apply them');
          ctx.rerender(); return;
        }
        if (t.matches('[data-rules-reset]')) {
          if (!editRules) { U.toast(WHY_RULES, 'bad'); return; }
          D.pricingRules[pid] = Object.assign(defaultRules(P), { auto: m.R.auto });
          D.priceLog.unshift({ at: D.NOW, pid: pid, by: (O.viewer() || {}).name || '', text: 'Rules reset to defaults' });
          audit('Reset the pricing rules for ' + P.name + ' to defaults');
          U.toast('Rules reset to defaults for ' + P.short); O.emit('data', { type: 'pricing-rules' }); return;
        }
        if (t.matches('[data-rules-copy]')) {
          if (!editRules) { U.toast(WHY_RULES, 'bad'); return; }
          var others = D.properties.length - 1;
          if (!others) { U.toast('There are no other properties to copy the rules to'); return; }
          U.confirm('Copy the percentages and the auto-apply setting from ' + P.short + ' to the other ' + fmt.plural(others, 'property', 'properties') + '? Base, minimum and maximum prices stay as they are for each property.', 'Copy rules').then(function (ok) {
            if (!ok) return;
            D.properties.forEach(function (q) { if (q.id === pid) return; var r = ownRules(q.id); ['compWeight', 'weekendPct', 'orphanPct', 'lastMinPct', 'lastMinDays', 'weeklyPct', 'monthlyPct', 'auto'].forEach(function (k) { r[k] = m.R[k]; }); });
            audit('Copied the pricing rules from ' + P.name + ' to the other ' + fmt.plural(others, 'property', 'properties'));
            U.toast('Rules copied to the other ' + fmt.plural(others, 'property', 'properties')); O.emit('data', { type: 'pricing-rules' });
          });
          return;
        }
        if (t.matches('[data-prop-go]')) { st.pid = t.dataset.propGo; st.picked = {}; ctx.rerender(); window.scrollTo(0, 0); return; }
        if (t.matches('tr[data-prop]')) { st.pid = t.dataset.prop; st.picked = {}; ctx.rerender(); window.scrollTo(0, 0); return; }
        if (t.matches('tr[data-iso]')) { if (e.target.closest('input')) return; select(t.dataset.iso); }
      });
    }
  });
})();
