/* Orbique Command Center v4: Profit planner (Manage → Profit planner, account owners only)
   One unit's costs and the profit its owner wants each month, turned into nightly rates guests will pay:
   - Costs card: every cost field of the engine, grouped, with live totals and the monthly profit target. Saved to
     D.ratePlanner.units[pid] only when the owner presses Save; reading never writes (a unit without saved costs shows
     empty inputs and the defaults). Expenses recorded for the unit over the last 3 months show as a hint.
   - The engine (O.rateplan, api/_lib/shared/rateplan.cjs) runs once the costs are filled, debounced, with a short
     "Working it out" state: the recommended plan's headline numbers, the rate needed at each occupancy against what
     guests pay (one price axis), one card per plan with its numbers, pros and cons, a slider along the efficient plans
     (R.evaluate), and a preview by month and by night.
   - Push: one O.channel.setDays call on the unit type's main rate plan (as Pricing → Apply; it also sets the price of
     every unit of the type), or D.priceOverrides for a unit without one; then D.priceLog, the audit log, a push record
     in D.ratePlanner.pushes (from/to per night, and a snapshot of each night as it was before: every unit's own price with
     its stamp, and the plan's own price) and one O.emit('data'). Undo puts a night back to that snapshot only while the
     night is still exactly as the push left it; other nights keep their newer price (a later push still in place goes
     first), and the push shows as partly undone until the owner undoes the rest or marks it undone.
   - Price limits (optional, per unit): no plan goes below "Never below" or above "Never above".
   Push and Undo need pricing.change. Spec: docs/notes/profit-planner.md, section "The page". */
(function () {
  var O = window.O, D = O.data, M = O.metrics, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt, R = O.rateplan;
  var CLAIM = 'Paid personally (claim)';
  var MAX_DAYS = 365;            /* "until a date" goes at most a year ahead */
  var HORIZONS = [['next30', 'Next 30 days', 30], ['next60', 'Next 60 days', 60], ['next90', 'Next 90 days', 90], ['next180', 'Next 180 days', 180]];
  var SHORT = { current: 'Today', fill: 'Fill', balanced: 'Balanced', profit: 'Most profit', premium: 'Premium', custom: 'Your own mix' };
  var PER = { month: 'a month', year: 'a year', once: 'once', stay: 'a stay', night: 'a night', pct: '%' };
  var WHY_CHANGE = 'Pushing prices needs the "Change prices" permission, which an account owner can give in Staff access.';
  var st = {
    pid: '', drafts: {}, res: null /* {key, pid, input, res} */, err: null, timer: null,
    sel: null /* option shown in the preview */, view: 'month', nights: 'all', slide: null /* {key, i, card} */, asmOpen: false, ro: null
  };
  function canChange() { return O.can('pricing.change'); }
  function audit(text) { D.auditLog = D.auditLog || []; D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: 'pricing', text: text }); }
  /* a stamp for the save merge (changedAt, handedAt, updatedAt): now, or the stamp already there when it is later (another
     device's, whose clock runs ahead), so a change made after seeing it is never stamped before it */
  function stamp(was) { return typeof was === 'string' && was > D.NOW ? was : D.NOW; }

  /* ------------------------------------------------------------------ styles */
  O.css('planner', [
    '.pg-planner{display:flex;flex-direction:column;gap:14px;}',
    '.pg-planner .toolbar{margin-bottom:0;}',
    '.pg-planner .pp-prop{min-width:240px;max-width:340px;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;}',
    '.pg-planner .pp-hz{width:auto;min-width:150px;}',
    '.pg-planner .pp-until{width:auto;}',
    '.pg-planner .pp-saved .pill{white-space:nowrap;}',
    '.pg-planner .pp-ctx{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;color:var(--text-2);}',
    '.pg-planner .pp-ctx .dot{width:3px;height:3px;border-radius:50%;background:var(--faint);}',
    '.pg-planner .pp-ctx b{color:var(--text);}',
    '.pg-planner .pp-top{display:grid;grid-template-columns:minmax(340px,420px) minmax(0,1fr);gap:14px;align-items:start;}',
    '.pg-planner .pp-right{display:flex;flex-direction:column;gap:14px;min-width:0;}',
    '.pg-planner .card-head .hd{min-width:0;}',
    '.pg-planner .card-head h3{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
    /* costs */
    '.pg-planner .pp-costs .card-body{display:flex;flex-direction:column;gap:12px;}',
    '.pg-planner .pp-sec{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);padding-top:10px;border-top:1px solid var(--border);}',
    '.pg-planner .pp-sec-h{margin-top:-6px;font-size:11.5px;color:var(--text-2);line-height:1.4;}',
    '.pg-planner .inunit{display:flex;align-items:center;border:1px solid var(--border);border-radius:8px;background:var(--surface);overflow:hidden;min-height:36px;}',
    '.pg-planner .inunit:focus-within{outline:2px solid var(--brand-strong);outline-offset:-1px;}',
    '.pg-planner .inunit span{padding:0 8px;font-size:11.5px;font-weight:700;color:var(--muted);background:var(--surface-2);align-self:stretch;display:flex;align-items:center;white-space:nowrap;}',
    '.pg-planner .inunit input{border:none;outline:none;padding:8px 9px;width:100%;min-width:0;font-size:13px;background:none;color:var(--text);font-variant-numeric:tabular-nums;}',
    '.pg-planner .pp-target .inunit{border-color:var(--brand-strong);}',
    '.pg-planner .pp-target .inunit input{font-size:15px;font-weight:800;}',
    '.pg-planner .inunit input::placeholder{color:var(--faint);font-weight:500;}',
    '.pg-planner .field .hint{line-height:1.35;}',
    '.pg-planner .pp-tot{background:var(--brand-soft-2);border:1px solid var(--border);border-radius:9px;padding:10px 12px;font-size:12.5px;color:var(--text-2);line-height:1.5;}',
    '.pg-planner .pp-tot b{color:var(--text);}',
    '.pg-planner .pp-tot .bad{color:var(--bad);font-weight:700;}',
    '.pg-planner .pp-exp{display:flex;gap:8px;align-items:flex-start;}',
    '.pg-planner .pp-exp svg{width:15px;height:15px;flex-shrink:0;color:var(--muted);margin-top:1px;}',
    '.pg-planner .pp-acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}',
    '.pg-planner .inunit.bad{border-color:var(--bad);}',
    /* results */
    '.pg-planner .pp-results{transition:opacity .15s;}',
    '.pg-planner .pp-busy .pp-dim{opacity:0.5;pointer-events:none;}',
    '.pg-planner .pp-working{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:var(--info);background:var(--info-soft);border-radius:20px;padding:3px 10px;white-space:nowrap;}',
    '.pg-planner .pp-working .spinner{width:12px;height:12px;border-width:2px;}',
    '.pg-planner .pp-wait{display:flex;flex-direction:column;align-items:center;gap:10px;padding:34px 16px;color:var(--muted);font-weight:600;text-align:center;}',
    '.pg-planner .pp-prompt{padding:18px 16px;display:flex;flex-direction:column;gap:10px;font-size:13px;color:var(--text-2);line-height:1.5;}',
    '.pg-planner .pp-prompt ol{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px;}',
    '.pg-planner .pp-rec{border-color:var(--brand-strong);box-shadow:inset 0 3px 0 var(--brand-strong),var(--shadow);}',
    '.pg-planner .pp-rec .kpis{margin-bottom:0;}',
    '.pg-planner .pp-rec .kpi .k-label, .pg-planner .pp-rec .kpi .k-sub{white-space:normal;line-height:1.35;}',
    '.pg-planner .pp-notes{display:flex;flex-direction:column;gap:6px;}',
    '.pg-planner .pp-notes .note{display:flex;gap:8px;align-items:flex-start;}',
    '.pg-planner .pp-notes .note svg{width:14px;height:14px;flex-shrink:0;margin-top:1px;}',
    /* the maths */
    '.pg-planner .pp-maths .card-body{display:flex;flex-direction:column;gap:14px;}',
    '.pg-planner .pp-chart{position:relative;}',
    '.pg-planner .pp-chart .opt-dot{stroke:var(--surface);stroke-width:2;}',
    '.pg-planner .pp-chart .opt-dot.rec{fill:var(--brand-strong);}',
    '.pg-planner .pp-chart .opt-dot.other{fill:var(--text-2);}',
    '.pg-planner .pp-chart .opt-lbl{font-size:11px;font-weight:700;fill:var(--text-2);font-family:var(--font-body);paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round;}',
    '.pg-planner .pp-chart .opt-lbl.rec{fill:var(--text);}',
    '.pg-planner .pp-chart .opt-hit{fill:transparent;cursor:pointer;}',
    '.pg-planner .pp-chart-foot{display:flex;flex-direction:column;gap:6px;margin-top:8px;}',
    '.pg-planner .pp-chart-foot .small{color:var(--muted);}',
    '.pg-planner .legend i.lg-dash{background:none;border-top:2px dashed var(--c-prev1);height:0;width:14px;border-radius:0;}',
    '.pg-planner .legend i.lg-dot{width:9px;height:9px;border-radius:50%;background:var(--text-2);}',
    '.pg-planner .pp-req td, .pg-planner .pp-req th{padding:7px 8px;}',
    '.pg-planner .pp-req th{white-space:normal;vertical-align:bottom;}',
    '.pg-planner .pp-req tr.near td{background:var(--brand-soft-2);font-weight:700;}',
    '.pg-planner .pp-req tr.near td:first-child{box-shadow:inset 3px 0 0 var(--brand-strong);}',
    '.pg-planner .pp-req .ok{color:var(--ok);font-weight:700;}',
    '.pg-planner .pp-req-txt{font-size:12px;color:var(--text-2);line-height:1.5;margin-top:8px;}',
    /* option cards */
    '.pg-planner .pp-opts{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:14px;}',
    '.pg-planner .pp-opt{display:flex;flex-direction:column;}',
    '.pg-planner .pp-opt.rec{border-color:var(--brand-strong);box-shadow:inset 0 3px 0 var(--brand-strong),var(--shadow);}',
    '.pg-planner .pp-opt.sel{outline:2px solid var(--brand-strong);outline-offset:1px;}',
    '.pg-planner .pp-opt-h{padding:12px 14px 0;display:flex;flex-direction:column;gap:5px;}',
    '.pg-planner .pp-opt-h h3{font-size:14px;font-weight:800;line-height:1.3;}',
    '.pg-planner .pp-opt-h .pill{align-self:flex-start;}',
    '.pg-planner .pp-opt-sum{font-size:12px;color:var(--text-2);line-height:1.45;}',
    '.pg-planner .pp-nums{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;padding:10px 14px;}',
    '.pg-planner .pp-nums > div{min-width:0;}',
    '.pg-planner .pp-nums .l{display:block;font-size:10.5px;font-weight:700;color:var(--muted);line-height:1.3;}',
    '.pg-planner .pp-nums b{display:block;font-family:var(--font-head);font-size:15px;font-weight:800;margin-top:1px;line-height:1.25;overflow-wrap:anywhere;}',
    /* long amounts (a loss, five figures) shrink, then wrap, instead of being cut off */
    '.pg-planner .pp-nums b.pp-lg{font-size:13px;} .pg-planner .pp-nums b.pp-xl{font-size:11.5px;}',
    '.pg-planner .pp-rec .kpi .k-val{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;line-height:1.2;}',
    '.pg-planner .pp-rec .kpi .k-val .pp-lg{font-size:0.84em;} .pg-planner .pp-rec .kpi .k-val .pp-xl{font-size:0.7em;}',
    '.pg-planner .pp-nums small{display:block;font-size:10.5px;color:var(--muted);line-height:1.3;margin-top:1px;}',
    '.pg-planner .pp-nums small .ln{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.pg-planner .pp-chg{font-size:11.5px;color:var(--muted);padding:0 14px 8px;}',
    '.pg-planner .pp-pc{list-style:none;margin:0;padding:0 14px;display:flex;flex-direction:column;gap:5px;font-size:12px;line-height:1.4;color:var(--text-2);}',
    '.pg-planner .pp-pc li{display:flex;gap:6px;align-items:flex-start;}',
    '.pg-planner .pp-pc svg{width:13px;height:13px;flex-shrink:0;margin-top:2px;}',
    '.pg-planner .pp-pc.pros svg{color:var(--ok);} .pg-planner .pp-pc.cons svg{color:var(--warn);}',
    '.pg-planner .pp-pc + .pp-pc{margin-top:8px;}',
    '.pg-planner .pp-pc-l{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);padding:8px 14px 4px;border-top:1px solid var(--border);margin-top:4px;}',
    '.pg-planner .pp-more{padding:0 14px;}',
    '.pg-planner .pp-more > summary{cursor:pointer;font-size:12px;font-weight:700;color:var(--brand-strong);padding:5px 0 2px 19px;list-style:none;}',
    '.pg-planner .pp-more > summary::-webkit-details-marker{display:none;}',
    '.pg-planner .pp-more[open] > summary{display:none;}',
    '.pg-planner .pp-more .pp-pc{padding:0;margin-top:5px;}',
    '.pg-planner .pp-ft-pc .pp-more{padding:0;}',
    '.pg-planner .pp-opt-f{margin-top:auto;padding:12px 14px;display:flex;gap:8px;flex-wrap:wrap;}',
    '.pg-planner .pp-opt-f .btn{flex:1;justify-content:center;}',
    /* fine-tune */
    '.pg-planner .pp-ft .card-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start;}',
    '.pg-planner .pp-range{width:100%;accent-color:var(--brand-strong);margin:6px 0 2px;min-height:28px;}',
    '.pg-planner .pp-ends{display:flex;justify-content:space-between;font-size:11.5px;font-weight:700;color:var(--muted);}',
    '.pg-planner .pp-ft-out .pp-nums{padding:10px 0;grid-template-columns:repeat(4,minmax(0,1fr));}',
    '.pg-planner .pp-ft-pc .pp-pc{padding:0;}',
    '.pg-planner .pp-ft-pc .pp-pc-l{padding:0 0 4px;border-top:none;margin-top:0;}',
    '.pg-planner .pp-ft-pc .pp-pc-l + .pp-pc{margin-bottom:10px;}',
    /* preview */
    '.pg-planner .pp-keep{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:var(--text-2);}',
    '.pg-planner .pp-tbl{font-size:12.5px;}',
    '.pg-planner .pp-tbl th, .pg-planner .pp-tbl td{padding:7px 9px;white-space:nowrap;}',
    '.pg-planner .pp-tbl tr.chg td{background:var(--brand-soft-2);}',
    '.pg-planner .pp-tbl tr.bk td{color:var(--muted);}',
    '.pg-planner .pp-tbl .pk{font-size:10px;font-weight:800;color:var(--accent-text);background:var(--accent-soft);border-radius:4px;padding:0 4px;margin-left:4px;}',
    '.pg-planner .pp-scroll{max-height:560px;overflow:auto;}',
    '.pg-planner .pp-tbl .sm-o{display:none;}',
    '.pg-planner .pp-tbl .pp-was{display:block;font-size:11px;font-weight:400;color:var(--muted);}',
    '.pg-planner .pos, .pp-modal .pos{color:var(--ok);} .pg-planner .neg, .pp-modal .neg{color:var(--bad);}',
    '.pg-planner .pp-prev-f{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;}',
    '.pg-planner .pp-prev-f .small{color:var(--text-2);}',
    /* history and assumptions */
    '.pg-planner .pp-bottom{display:flex;flex-direction:column;gap:14px;}',
    '.pg-planner .pp-hist{display:flex;flex-direction:column;}',
    '.pg-planner .pp-hrow{display:flex;gap:10px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);}',
    '.pg-planner .pp-hrow:last-child{border-bottom:none;}',
    '.pg-planner .pp-hrow .main{flex:1;min-width:0;}',
    '.pg-planner .pp-hrow .t{font-weight:700;font-size:13px;}',
    '.pg-planner .pp-hrow .s{font-size:12px;color:var(--muted);margin-top:1px;}',
    '.pg-planner .pp-hrow.undone .t{color:var(--muted);}',
    '.pg-planner details.pp-asm > summary{list-style:none;display:flex;align-items:center;gap:10px;justify-content:space-between;padding:13px 16px;cursor:pointer;min-height:44px;}',
    '.pg-planner details.pp-asm > summary::-webkit-details-marker{display:none;}',
    '.pg-planner details.pp-asm > summary h3{font-size:14px;font-weight:800;}',
    '.pg-planner details.pp-asm > summary .sub{font-size:11.5px;color:var(--muted);font-weight:500;margin-top:1px;}',
    '.pg-planner details.pp-asm > summary svg{width:16px;height:16px;color:var(--muted);flex-shrink:0;transition:transform .15s;}',
    '.pg-planner details.pp-asm[open] > summary svg{transform:rotate(180deg);}',
    '.pg-planner details.pp-asm[open] > summary{border-bottom:1px solid var(--border);}',
    '.pg-planner .pp-asm-body{padding:4px 16px 14px;display:flex;flex-direction:column;}',
    '.pg-planner .pp-arows{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));column-gap:28px;}',
    '.pg-planner .pp-arow{padding:11px 0;border-bottom:1px dashed var(--border);display:flex;flex-direction:column;gap:5px;min-width:0;}',
    '.pg-planner .pp-arow.wide{grid-column:1 / -1;}',
    '.pg-planner .pp-arow .al{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:space-between;font-size:12.5px;font-weight:700;}',
    '.pg-planner .pp-arow .inunit{max-width:200px;}',
    '.pg-planner .pp-arow .help{font-size:11.5px;color:var(--text-2);line-height:1.4;}',
    '.pg-planner .pp-arow .src{font-size:11px;color:var(--muted);line-height:1.4;}',
    '.pg-planner .pp-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:6px;}',
    '.pg-planner .pp-list label{display:flex;flex-direction:column;gap:2px;font-size:10.5px;font-weight:700;color:var(--muted);min-width:0;}',
    '.pg-planner .pp-list .inunit{max-width:none;min-height:32px;}',
    '.pg-planner .pp-list .inunit input{padding:6px 6px;font-size:12px;}',
    '.pg-planner .pp-list .inunit span{padding:0 5px;}',
    '.pg-planner .pp-calib{display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--text-2);line-height:1.5;padding:12px 0 4px;}',
    '.pg-planner .pp-calib ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px;}',
    '@media (max-width:1180px){.pg-planner .pp-top{grid-template-columns:minmax(0,1fr);}}',
    '@media (max-width:900px){.pg-planner .pp-ft .card-body{grid-template-columns:minmax(0,1fr);}}',
    '@media (max-width:560px){',
    '  .pg-planner .pp-tbl .sm-x{display:none;} .pg-planner .pp-tbl .sm-o{display:inline;}',
    '  .pg-planner .pp-tbl th{white-space:normal;vertical-align:bottom;}',
    '  .pg-planner .pp-tbl th, .pg-planner .pp-tbl td{padding:7px 6px;}',
    '  .pg-planner .pp-arows{grid-template-columns:minmax(0,1fr);}',
    '  .pg-planner .pp-prop, .pg-planner .pp-hz{min-width:0;max-width:none;width:100%;}',
    '  .pg-planner .toolbar > *{max-width:100%;}',
    '  .pg-planner .pp-ft-out .pp-nums{grid-template-columns:minmax(0,1fr) minmax(0,1fr);}',
    '  .pg-planner .card-head .row-flex{width:100%;}',
    '  .pg-planner .pp-prev-f .btn{width:100%;justify-content:center;}',
    '  .pg-planner .pp-hrow{flex-wrap:wrap;} .pg-planner .pp-hrow .btn{width:100%;justify-content:center;}',
    '}'
  ].join('\n'));

  /* ------------------------------------------------------------------ small helpers */
  var CUR = null; /* the unit on screen: every amount is in its currency */
  /* amounts keep the currency on the same line as the number (a no-break space after "RM") */
  function nb(t) { return String(t).replace(' ', '\u00a0'); }
  function money(n) { return nb(fmt.money(n, { cur: CUR })); }
  function price(n) { return n == null ? '–' : nb(fmt.money(Math.round(n), { cur: CUR })); }
  function signedMoney(n) { var r = Math.round(n); return r === 0 ? money(0) : (r > 0 ? '+' : '−') + money(Math.abs(r)); }
  /* a size class for a headline number, so long amounts shrink before they wrap */
  function fitCls(t) { var n = String(t).length; return n >= 12 ? 'pp-xl' : n >= 9 ? 'pp-lg' : ''; }
  function fitB(t) { var c = fitCls(t); return '<b' + (c ? ' class="' + c + '"' : '') + '>' + t + '</b>'; }
  function pct(x) { return fmt.pct(x); }
  function numOf(v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) && n > 0 ? n : 0; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function joinWords(xs) { return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }
  function staffName(id) { var s = D.staffById && D.staffById(id); return s ? s.name : 'someone'; }
  function canon(v) { return O.sync && O.sync.canon ? O.sync.canon(v) : JSON.stringify(v); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function isArchived(x) { return !!(x && (x.archived === true || x.status === 'archived')); }
  function unitList() { return D.properties.filter(function (p) { return !isArchived(p) && O.inView(p); }); }
  function typeOf(P) { return P && P.unitTypeId && O.unitType ? O.unitType(P.unitTypeId) : null; }
  /* the unit select's words: the unit and its type */
  function unitLabel(P) { var ut = typeOf(P); return P.name + (ut ? ' · ' + ut.name : ''); }
  function mainPlanOf(P) { return P && P.unitTypeId && O.channel ? O.channel.mainPlan(P.unitTypeId) : null; }
  function rangeText(list) { return list.length === 1 ? d.fmt(list[0]) : d.fmtRange(list[0], list[list.length - 1]); }
  function cap1(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
  /* the last night of the plan on screen */
  function lastNight(v) { var ns = v && v.input && v.input.nights; return ns && ns.length ? ns[ns.length - 1].iso : null; }
  /* who a price applies to: "all 3 Deluxe units", "both Premium units", "Saujana 21-1 only". With a range (to: its last
     night, from today), the other units blocked on every night of it are named: they get the prices but cannot sell.
     others: the other units of the type, by name when there are 3 or fewer ("Vortex 47-1 gets the same prices") */
  function unitName(u) { return u.short || u.name; }
  /* the type's units still in use */
  function histUnits(t) { return O.unitsOfType ? O.unitsOfType(t.id).filter(function (u) { return !isArchived(u); }).length : 0; }
  function allUnits(n, name) { return (n === 2 ? 'both ' : 'all ' + n + ' ') + name + ' units'; }
  function blockedAll(uid, to) {
    var T = D.TODAY, k = occIndex(uid).blocked, x, g = 0;
    if (!to || to < T) return false;
    for (x = T; x <= to && g < 800; x = d.add(x, 1), g++) if (!k[x]) return false;
    return true;
  }
  function scopeOf(P, to) {
    var t = typeOf(P), mp = mainPlanOf(P), units = t ? O.unitsOfType(t.id) : [], n = units.length;
    if (t && mp && n > 1) {
      var others = units.filter(function (u) { return u.id !== P.id; }), idle = to ? others.filter(function (u) { return blockedAll(u.id, to); }) : [];
      var idleWords = '';
      if (idle.length) {
        idleWords = joinWords(idle.map(unitName)) + (idle.length === 1 ? ' is' : ' are') + ' blocked on every night of these dates, so ' +
          (idle.length === others.length ? 'only ' + unitName(P) + ' can sell' : (idle.length === 1 ? 'it sells' : 'they sell') + ' nothing');
      }
      return { many: true, n: n, short: allUnits(n, t.name), line: 'Prices apply to ' + allUnits(n, t.name) + ' (the type\'s main rate plan)' + (idleWords ? '; ' + idleWords : ''), name: t.name,
        ctx: (n === 2 ? 'Both units' : n + ' units') + ' share this price' + (idleWords ? '; ' + idleWords : ''), typeWords: n === 2 ? 'both units of the type' : 'all ' + n + ' units of the type',
        others: others, idle: idle, idleWords: idleWords,
        otherWords: others.length <= 3 ? joinWords(others.map(unitName)) + (others.length === 1 ? ' gets' : ' get') : 'the other ' + others.length + ' units get' };
    }
    if (t && mp) return { many: false, n: 1, short: unitName(P), line: 'Prices go to the ' + t.name + ' main rate plan', name: t.name, others: [], idle: [] };
    /* "only" when the unit's type has other units, as Undo says it */
    return { many: false, n: 1, short: unitName(P) + (t && histUnits(t) > 1 ? ' only' : ''), line: 'Prices apply to this unit only', name: unitName(P), others: [], idle: [] };
  }

  /* ------------------------------------------------------------------ saved data and drafts */
  /* D.ratePlanner = {units: {pid: {costs, profitPerMonth, assumptions, horizon, keepPeaks, floor, ceiling, updatedAt, by}}, pushes: [...]} */
  function saved(pid) { var b = D.ratePlanner, u = b && b.units; return u && typeof u === 'object' && u[pid] ? u[pid] : null; }
  function pushList() { var b = D.ratePlanner; return b && Array.isArray(b.pushes) ? b.pushes : []; }
  /* only writers call this: it creates the blob or fixes its shape */
  function ownBlob() {
    if (!D.ratePlanner || typeof D.ratePlanner !== 'object') D.ratePlanner = { units: {}, pushes: [] };
    var b = D.ratePlanner;
    if (!b.units || typeof b.units !== 'object') b.units = {};
    if (!Array.isArray(b.pushes)) b.pushes = [];
    return b;
  }
  /* a preset, or an "until" date from tomorrow on (a saved date that has passed falls back to the default) */
  function validHorizon(h) {
    var i; for (i = 0; i < HORIZONS.length; i++) if (h === HORIZONS[i][0]) return h;
    return typeof h === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h) && h >= d.add(D.TODAY, 1) ? h : null;
  }
  /* a draft from what is saved (or the empty defaults): the inputs keep the text as typed */
  function fromSaved(pid) {
    var s = saved(pid) || {}, costs = {};
    R.COST_FIELDS.forEach(function (f) { var v = s.costs ? numOf(s.costs[f.key]) : 0; costs[f.key] = v ? String(v) : ''; });
    var asm = {};
    if (s.assumptions && typeof s.assumptions === 'object') Object.keys(s.assumptions).forEach(function (k) { if (Object.prototype.hasOwnProperty.call(R.DEFAULTS, k)) asm[k] = clone(s.assumptions[k]); });
    return { costs: costs, target: numOf(s.profitPerMonth) ? String(numOf(s.profitPerMonth)) : '', asm: asm, horizon: validHorizon(s.horizon) || 'next90', keepPeaks: s.keepPeaks !== false,
      floor: numOf(s.floor) ? String(numOf(s.floor)) : '', ceiling: numOf(s.ceiling) ? String(numOf(s.ceiling)) : '' };
  }
  /* what Save stores (numbers only, costs above zero, assumptions changed from the defaults) */
  function toSave(dr) {
    var costs = {};
    R.COST_FIELDS.forEach(function (f) { var v = numOf(dr.costs[f.key]); if (v) costs[f.key] = f.per === 'pct' ? Math.min(100, v) : v; });
    return { costs: costs, profitPerMonth: numOf(dr.target), assumptions: clone(dr.asm), horizon: dr.horizon, keepPeaks: dr.keepPeaks !== false, floor: numOf(dr.floor) || null, ceiling: numOf(dr.ceiling) || null };
  }
  /* the owner's price limits for every night (RM, null for none). ok: false while Never above is not above Never below;
     the plans then leave both out until it is fixed */
  function limitsOf(dr) {
    var f = numOf(dr.floor) || null, c = numOf(dr.ceiling) || null;
    return { floor: f, ceiling: c, ok: !(f && c && c <= f) };
  }
  function draft(pid) {
    var dr = st.drafts[pid], base = canon(toSave(fromSaved(pid)));
    /* an untouched draft follows what is saved (another device may have saved since) */
    if (!dr || (dr.base !== base && canon(toSave(dr)) === dr.base)) { dr = st.drafts[pid] = fromSaved(pid); dr.base = base; }
    return dr;
  }
  function dirty(pid) { var dr = draft(pid); return canon(toSave(dr)) !== canon(toSave(fromSaved(pid))); }
  function hasInputs(dr) { return numOf(dr.target) > 0 || R.COST_FIELDS.some(function (f) { return numOf(dr.costs[f.key]) > 0; }); }
  function costsOf(dr) { return toSave(dr).costs; }
  function payback(dr) { var v = dr.asm.paybackMonths; return v > 0 ? v : R.DEFAULTS.paybackMonths; }
  function horizonEnd(h) {
    var T = D.TODAY, i;
    for (i = 0; i < HORIZONS.length; i++) if (h === HORIZONS[i][0]) return d.add(T, HORIZONS[i][2] - 1);
    if (validHorizon(h)) return h > d.add(T, MAX_DAYS - 1) ? d.add(T, MAX_DAYS - 1) : h;
    return d.add(T, 89);
  }

  /* ------------------------------------------------------------------ the engine's input from Orbique data */
  function modelRate(pid, iso) {
    var r = 0; try { r = D.rateFor(pid, iso); } catch (e) { r = 0; }
    if (r > 0) return r;
    var P = D.propById[pid]; return P && Number(P.base) > 0 ? Number(P.base) : null;
  }
  /* the net price a night sells at now: the unit's own price (Pricing or a push), else its type's main rate plan, else the
     pricing model rate. pc: {mp, map} so a long range reads the channel rates once */
  function priceNow(pid, iso, pc) {
    var ov = D.priceOverrides && D.priceOverrides[pid];
    if (ov && Number(ov[iso]) > 0) return Number(ov[iso]);
    if (pc && pc.mp && O.channel) { var r = O.channel.planRateIn(pc.map, pc.mp, iso); if (r > 0) return r; }
    return modelRate(pid, iso);
  }
  function priceCtx(P) { var mp = mainPlanOf(P); return { mp: mp, map: mp && O.channel ? O.channel.rateMap() : null }; }
  /* this unit's nights: live bookings and blocks */
  function occIndex(pid) {
    var booked = {}, blocked = {};
    D.bookings.forEach(function (b) {
      if (b.propertyId !== pid || !M.live(b) || !b.checkIn || !b.checkOut) return;
      for (var x = b.checkIn, g = 0; x < b.checkOut && g < 400; x = d.add(x, 1), g++) booked[x] = b;
    });
    (D.blocks || []).forEach(function (k) {
      if (k.propertyId !== pid || !k.start || !k.end) return;
      for (var x = k.start, g = 0; x < k.end && g < 800; x = d.add(x, 1), g++) blocked[x] = k;
    });
    return { booked: booked, blocked: blocked };
  }
  /* what a booked night brings in for the room, on the same basis as the nightly price, per night: the payout (else the
     total) less tourism tax and the guest's cleaning fee, and less the commission when the payout is the whole total.
     The booking site's commission is charged on the guest's total, which for Booking.com and Agoda is the room amount
     with their markup on top, so the room amount less the whole commission would count it twice. Without a payout or a
     total: the room amount less the commission. null when nothing is recorded */
  function bookedNet(b) {
    var n = b.nights || d.diff(b.checkIn, b.checkOut) || 1, fee = Number(b.platformFee) || 0;
    var total = Number(b.total) || 0, pay = Number(b.payout) > 0 ? Number(b.payout) : total;
    if (pay > 0) return Math.max(0, (pay - (Number(b.tourismTax) || 0) - (Number(b.cleaningFee) || 0) - (pay === total ? fee : 0)) / n);
    if (Number(b.accommodation) > 0) return Math.max(0, (Number(b.accommodation) - fee) / n);
    return null;
  }
  function buildInput(pid, dr) {
    var P = D.propById[pid], T = D.TODAY, end = horizonEnd(dr.horizon), pc = priceCtx(P), occ = occIndex(pid);
    var nights = d.range(T, end).map(function (iso) {
      var b = occ.booked[iso], k = !b && occ.blocked[iso], bn = b ? bookedNet(b) : 0;
      /* a booking with no amount recorded goes in as null: the engine counts it at today's price and says so */
      var x = { iso: iso, dow: d.dow(iso), lead: d.diff(T, iso), current: priceNow(pid, iso, pc), status: b ? 'booked' : k ? 'blocked' : 'open', booked: b ? (bn == null ? null : round2(bn)) : 0 };
      /* a booked night's stay (it cancels as a whole), and firm once the guest is in */
      if (b) { x.stay = b.id; if (b.status === 'checked_in') x.firm = true; }
      return x;
    });
    /* history: the last 60 nights the unit was selling, sold or not, and the average the sold ones paid per night; the
       engine sets that against its own usual price. The unit was selling from the earliest of when it was added, its
       first live booking and its first night with a price of its own; with none of these there is no history */
    var start = P.createdAt ? String(P.createdAt).slice(0, 10) : '', sold = 0, avail = 0, paid = 0, paidN = 0, own = D.priceOverrides && D.priceOverrides[pid];
    function earlier(iso) { if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && (!start || iso < start)) start = iso; }
    D.bookings.forEach(function (b) { if (b.propertyId === pid && M.live(b) && b.checkIn) earlier(String(b.checkIn).slice(0, 10)); });
    if (own) Object.keys(own).forEach(function (iso) { if (Number(own[iso]) > 0) earlier(iso); });
    d.range(d.add(T, -60), d.add(T, -1)).forEach(function (iso) {
      if (!start || iso < start) return;
      var b = occ.booked[iso];
      if (!b && occ.blocked[iso]) return;
      avail++;
      if (b) { sold++; var bn = bookedNet(b); if (bn != null) { paid += bn; paidN++; } }
    });
    var history = avail ? { sold: sold, available: avail } : null;
    if (history && paidN) history.avgPaid = round2(paid / paidN);
    /* the building's other unit types, priced by their first unit */
    var tiers = [], t = typeOf(P);
    if (t) O.typesOf(t.buildingId).forEach(function (ot) {
      if (ot.id === t.id || ot.listingOf) return;
      var u = O.unitsOfType(ot.id)[0]; if (!u) return;
      var opc = priceCtx(u), prices = {};
      nights.forEach(function (n) { var v = priceNow(u.id, n.iso, opc); if (v) prices[n.iso] = v; });
      tiers.push({ name: ot.name, prices: prices });
    });
    var lim = limitsOf(dr), deal = D.lastMinuteDeal && typeof D.lastMinuteDeal === 'object' ? D.lastMinuteDeal : null;
    /* the workspace's last-minute deal, which the channel manager applies on top of these prices, and its skip dates: the
       owner's own list of special nights, which count as peaks when priced above the usual price */
    return {
      today: T, nights: nights, costs: costsOf(dr), profitPerMonth: numOf(dr.target), assumptions: clone(dr.asm), history: history, otherTiers: tiers,
      keepPeaks: dr.keepPeaks !== false, floor: lim.ok ? lim.floor : null, ceiling: lim.ok ? lim.ceiling : null, seed: 1, draws: 2000, basePrice: Number(P.base) > 0 ? Number(P.base) : null,
      lastMinute: deal ? clone(deal) : null, specialDates: deal && Array.isArray(deal.skip) ? deal.skip.slice() : []
    };
  }
  function keyOf(input) { return JSON.stringify(input); }
  function withMoney(input, P) { var o = {}; Object.keys(input).forEach(function (k) { o[k] = input[k]; }); o.money = function (n) { return nb(fmt.money(n, { cur: P })); }; return o; }

  /* the result on screen: st.res when it belongs to this unit; fresh when its key matches the inputs now */
  function viewFor(pid) {
    var P = D.propById[pid], dr = draft(pid), has = hasInputs(dr), input = has ? buildInput(pid, dr) : null, key = input ? keyOf(input) : null;
    var r = st.res && st.res.pid === pid ? st.res : null;
    return { pid: pid, P: P, dr: dr, has: has, key: key, input: input, res: r ? r.res : null, run: r, fresh: !!(r && r.key === key), err: !!(st.err && st.err.key === key) };
  }

  /* ------------------------------------------------------------------ running the plan (debounced) */
  function schedule(delay) {
    clearTimeout(st.timer);
    var pid = st.pid;
    setBusy(true);
    st.timer = setTimeout(function () {
      st.timer = null;
      if (O.state.page !== 'planner' || st.pid !== pid || !D.propById[pid]) return;
      var dr = draft(pid);
      if (hasInputs(dr)) {
        var input = buildInput(pid, dr), key = keyOf(input);
        /* two units can give the engine the same input: the result is this unit's only when it was run for it */
        if (!st.res || st.res.pid !== pid || st.res.key !== key) {
          var full = withMoney(input, D.propById[pid]);
          try { st.res = { key: key, pid: pid, input: full, res: R.plan(full) }; st.err = null; st.slide = null; }
          catch (e) { console.error('profit planner', e); st.err = { key: key }; }
        }
      }
      paintResults();
    }, delay == null ? 700 : delay);
  }
  function setBusy(on) {
    var pg = O.$('#page-root .pg-planner'); if (!pg) return;
    var box = O.$('.pp-results', pg); if (box) box.classList.toggle('pp-busy', !!on);
    O.$$('.pp-working', pg).forEach(function (w) { w.hidden = !on; });
  }

  /* ------------------------------------------------------------------ costs card */
  function costField(f, dr) {
    var pre = f.per === 'pct' ? '' : fmt.cur(CUR), suf = PER[f.per], id = 'pp-c-' + f.key;
    return '<div class="field"><label for="' + id + '">' + esc(f.label) + '</label><div class="inunit">' + (pre ? '<span>' + esc(pre) + '</span>' : '') +
      '<input id="' + id + '" type="number" inputmode="decimal" min="0"' + (f.per === 'pct' ? ' max="100" step="0.5"' : ' step="1"') + ' data-cost="' + f.key + '" value="' + esc(dr.costs[f.key]) + '" placeholder="0">' +
      '<span>' + esc(suf) + '</span></div><div class="hint">' + esc(f.key === 'furnishing' ? 'Paid back over the months set in the next field.' : f.help) + '</div></div>';
  }
  function costsCard(P, dr) {
    var groups = [], by = {};
    R.COST_FIELDS.forEach(function (f) { if (!by[f.group]) { by[f.group] = []; groups.push(f.group); } by[f.group].push(f); });
    var pb = R.ASSUMPTIONS.filter(function (a) { return a.key === 'paybackMonths'; })[0];
    var body = groups.map(function (g) {
      var fields = by[g].map(function (f) { return costField(f, dr); }).join('');
      if (g === 'One-off' && pb) fields += '<div class="field"><label for="pp-pb">Pay back over</label><div class="inunit"><input id="pp-pb" type="number" inputmode="numeric" min="' + pb.min + '" max="' + pb.max + '" step="1" data-asm="paybackMonths" value="' + esc(String(payback(dr))) + '"><span>months</span></div><div class="hint">' + esc(pb.help) + '</div></div>';
      /* prices are net: each booking site's markup pays its commission, so it is not a cost here */
      var note = g === 'Share of revenue' ? '<div class="pp-sec-h">Leave out booking-site commission: each site\'s markup already covers it.</div>' : '';
      return '<div class="pp-sec">' + esc(g) + '</div>' + note + '<div class="form-grid">' + fields + '</div>';
    }).join('');
    return '<form class="card pp-costs" data-costs novalidate autocomplete="off"><div class="card-head"><div class="hd"><h3>Costs and profit target</h3><div class="sub">What ' + esc(P.short || P.name) + ' costs to run, in ' + esc(fmt.cur(P)) + '. Leave out anything that does not apply.</div></div></div>' +
      '<div class="card-body">' +
      '<div class="field pp-target"><label for="pp-target">Profit you want each month</label><div class="inunit"><span>' + esc(fmt.cur(P)) + '</span><input id="pp-target" type="number" inputmode="numeric" min="0" step="50" data-target value="' + esc(dr.target) + '" placeholder="0"><span>a month</span></div>' +
      '<div class="hint">What should be left after every cost below. Leave it empty to plan for covering costs.</div></div>' +
      body + expenseHint(P) +
      '<div class="pp-tot" data-totals>' + totalsHTML(dr) + '</div>' + limitsHTML(P, dr) +
      '<div class="pp-acts"><button type="submit" class="btn btn-primary">' + O.icon('check') + 'Save costs and target</button><button type="button" class="btn btn-ghost" data-discard>Discard changes</button></div>' +
      '</div></form>';
  }
  /* optional limits on every night's price: the plans never go below or above them */
  var LIMIT_FIELDS = [['floor', 'Never below', 'No plan prices a night lower than this.'], ['ceiling', 'Never above', 'No plan prices a night higher than this.']];
  function limitsHTML(P, dr) {
    var bad = !limitsOf(dr).ok;
    return '<div class="pp-sec">Price limits</div><div class="pp-sec-h">Optional. Leave them empty for no limit.</div><div class="form-grid">' +
      LIMIT_FIELDS.map(function (f) {
        var id = 'pp-l-' + f[0];
        return '<div class="field"><label for="' + id + '">' + esc(f[1]) + '</label><div class="inunit' + (bad ? ' bad' : '') + '"><span>' + esc(fmt.cur(P)) + '</span>' +
          '<input id="' + id + '" type="number" inputmode="numeric" min="0" step="1" data-limit="' + f[0] + '" value="' + esc(dr[f[0]] || '') + '" placeholder="No limit"' + (bad ? ' aria-invalid="true" aria-describedby="pp-l-err"' : '') + '><span>a night</span></div>' +
          '<div class="hint">' + esc(f[2]) + '</div></div>';
      }).join('') + '</div>' +
      '<div class="note warn" id="pp-l-err" data-lim-err' + (bad ? '' : ' hidden') + '>' + esc(LIMIT_ERR) + '</div>';
  }
  var LIMIT_ERR = 'Never above needs to be higher than Never below. Until it is, the plans leave both limits out.';
  /* live totals and the cost maths at the usual occupancy, straight from the inputs */
  function totalsHTML(dr) {
    var c = R.monthlyCosts(costsOf(dr), { paybackMonths: payback(dr) }), target = numOf(dr.target);
    var bits = [money(c.fixedMonthly) + ' fixed a month', money(c.perStay) + ' per stay', money(c.perNight) + ' per night'];
    var out = '<b>' + bits.join(', ') + '</b>' + (c.pct ? ', and ' + fmt.num(c.pct * 100, Math.round(c.pct * 1000) % 10 ? 1 : 0) + '% of revenue' : '') + '.';
    if (c.capexMonthly) out += ' The fixed amount includes ' + money(c.capexMonthly) + ' a month to pay back furnishing over ' + fmt.plural(c.paybackMonths, 'month') + '.';
    if (c.pct >= 1) return out + ' <span class="bad">The shares of revenue add up to 100% or more, so no price can cover them.</span>';
    var a = R.DEFAULTS, occ = dr.asm.baseOcc > 0 ? Math.round(dr.asm.baseOcc * 20) / 20 : a.baseOcc;
    var req = R.requiredRates(costsOf(dr), target, { avgStay: dr.asm.avgStay || a.avgStay, discountLeak: dr.asm.discountLeak != null ? dr.asm.discountLeak : a.discountLeak, paybackMonths: payback(dr) });
    var row = req.filter(function (r) { return Math.abs(r.occ - occ) < 1e-9; })[0];
    var anyCost = c.fixedMonthly || c.perStay || c.perNight;
    if (row && anyCost) out += ' With ' + pct(occ) + ' of nights sold, that needs about <b>' + price(row.breakEven) + '</b> a night to break even' + (target ? ' and <b>' + price(row.target) + '</b> to make ' + money(target) + ' a month' : '') + '.';
    else if (row && target) out += ' With ' + pct(occ) + ' of nights sold, that needs about <b>' + price(row.target) + '</b> a night to make ' + money(target) + ' a month.';
    return out;
  }
  function expenseHint(P) {
    var T = D.TODAY, from = d.addMonths(d.monthStart(T), -3), to = d.add(d.monthStart(T), -1);
    var list = (D.expenses || []).filter(function (e) { return e.propertyId === P.id && e.date >= from && e.date <= to && !(e.method === CLAIM && e.claimStatus === 'rejected'); });
    if (!list.length) return '';
    var op = 0, cap = 0, types = {};
    list.forEach(function (e) { var a = Number(e.amount) || 0; if (e.costClass === 'capex') cap += a; else { op += a; types[e.type] = (types[e.type] || 0) + a; } });
    var top = Object.keys(types).sort(function (a, b) { return types[b] - types[a]; }).slice(0, 3).map(function (t) { return t.toLowerCase(); });
    return '<div class="note pp-exp">' + O.icon('expenses') + '<span>Expenses recorded for ' + esc(P.short || P.name) + ' from ' + d.monthName(from, true) + ' to ' + d.monthName(to, true) + ' come to about <b>' + money(op / 3) + ' a month</b> in running costs' +
      (top.length ? ' (mostly ' + esc(joinWords(top)) + ')' : '') + (cap ? ', plus ' + money(cap) + ' of one-off purchases' : '') + '. Check that the costs above cover them.</span></div>';
  }

  /* ------------------------------------------------------------------ results: headline */
  function recOf(res) { var r = res.options.filter(function (o) { return o.recommended; })[0]; return r || res.options[0]; }
  function curOf(res) { return res.options.filter(function (o) { return o.keys.indexOf('current') >= 0; })[0] || null; }
  function goalLabel(res) { return res.target > 0 ? money(res.target) + ' a month' : 'covering costs'; }
  function chanceLabel(res) { return res.target > 0 ? 'Chance of ' + money(res.target) + ' a month' : 'Chance of covering costs'; }
  function working(on) { return '<span class="pp-working"' + (on ? '' : ' hidden') + '><span class="spinner"></span>Working it out</span>'; }
  function headHTML(v) {
    if (!v.has) {
      return '<div class="card"><div class="card-head"><div class="hd"><h3>Your rates</h3><div class="sub">Worked out from the costs, the profit you want and how guests book</div></div></div>' +
        '<div class="pp-prompt"><div>Enter what ' + esc(v.P.short || v.P.name) + ' costs and the profit you want each month. Orbique then works out:</div><ol>' +
        '<li>the nightly rate needed at each share of nights sold, to break even and to make your profit;</li>' +
        '<li>what guests are likely to pay, from your prices and bookings so far;</li>' +
        '<li>a few complete rate plans for these dates, each with its profit, its risk and its pros and cons, ready to push to every booking site.</li></ol></div></div>';
    }
    if (v.err && !v.fresh) return '<div class="card"><div class="card-body">' + U.empty('Orbique could not work out the plans for these dates. Try other dates or check the costs.', '⚠') + '</div></div>';
    if (!v.res) return '<div class="card"><div class="pp-wait"><span class="spinner"></span>Working it out…<span class="small">This takes a second.</span></div></div>';
    var res = v.res, rec = recOf(res), cur = curOf(res), s = rec.stats, cs = cur ? cur.stats : null, same = cur === rec;
    function kv(t) { var c = fitCls(t); return c ? '<span class="' + c + '">' + t + '</span>' : t; }
    var parts = weekParts(s);
    var kp = U.kpis([
      { label: 'Average nightly rate', value: kv(price(s.avgPrice)), sub: parts.length ? esc(parts.join(', ')) : 'on the open nights', title: 'The average of the new prices on the open nights, peak nights included' },
      { label: 'Nights likely sold', value: pct(s.occ), sub: same || !cs ? fmt.plural(Math.round(s.soldNights), 'night') + ' of ' + s.nights : 'today\'s prices ' + pct(cs.occ), title: 'Expected share of all nights in these dates, booked ones included' },
      { label: 'Profit a month', value: kv(price(s.profitPerMonth)), sub: 'likely ' + price(s.p10) + ' to ' + price(s.p90), hl: true, title: 'Expected profit after every cost. In 8 of 10 outcomes it lands between these two amounts.' },
      { label: chanceLabel(res), value: pct(s.pTarget), sub: same || !cs ? 'with today\'s prices' : 'today\'s prices ' + pct(cs.pTarget), title: 'Share of the simulated outcomes that reach the target' }
    ]);
    var notes = res.notes.map(function (t) {
      var warn = /^On average, no plan|^To reach|^To cover|^Every night|^With nothing to sell|no price today|no amount recorded/.test(t);
      return '<div class="note' + (warn ? ' warn' : '') + '">' + O.icon(warn ? 'alert' : 'sparkle') + '<span>' + esc(t) + '</span></div>';
    }).join('');
    var acts = same ? '<span class="pill neutral">Today\'s prices are already the best plan</span>'
      : '<button type="button" class="btn btn-ghost btn-sm" data-preview="' + esc(rec.key) + '">' + O.icon('eye') + 'Preview</button>' + pushBtn(rec.key, 'btn-primary');
    return '<div class="card pp-rec"><div class="card-head"><div class="hd"><h3>Recommended: ' + esc(rec.name) + ' ' + working(!v.fresh) + '</h3><div class="sub">' + esc(rec.summary) + '</div></div><div class="row-flex wrap">' + acts + '</div></div>' +
      '<div class="card-body stack pp-dim">' + kp + (notes ? '<div class="pp-notes">' + notes + '</div>' : '') + '</div></div>' + mathsCard(v);
  }
  function pushBtn(key, kind) {
    var ok = canChange();
    return '<button type="button" class="btn ' + (kind || 'btn-ghost') + ' btn-sm" data-push="' + esc(key) + '"' + (ok ? '' : ' disabled title="' + esc(WHY_CHANGE) + '"') + '>' + O.icon('upload') + 'Push</button>';
  }

  /* ------------------------------------------------------------------ results: the maths (cost curve against what guests pay) */
  /* the required rate is A / occupancy + B exactly (R.requiredRates), so two of its points give the whole curve */
  function curveOf(req, key) {
    var a = null, b = null;
    req.forEach(function (r) { if (r[key] == null) return; if (!a) a = r; b = r; });
    if (!a || a === b) return null;
    var A = (a[key] - b[key]) / (1 / a.occ - 1 / b.occ), B = a[key] - A / a.occ;
    return function (o) { return A / o + B; };
  }
  /* what guests pay at an occupancy: today's prices scaled up and down together (res.demandCurve), list prices */
  function guestsFn(res) {
    var dem = res.demandCurve.filter(function (r) { return r.occ > 0 && r.listAdr > 0; }).sort(function (a, b) { return a.occ - b.occ; });
    if (dem.length < 2 || dem[dem.length - 1].occ - dem[0].occ < 0.01) return null;
    var f = function (o) {
      if (o < dem[0].occ - 1e-9 || o > dem[dem.length - 1].occ + 1e-9) return null;
      for (var i = 1; i < dem.length; i++) if (o <= dem[i].occ) { var a = dem[i - 1], b = dem[i], t = b.occ > a.occ ? (o - a.occ) / (b.occ - a.occ) : 0; return a.listAdr + (b.listAdr - a.listAdr) * t; }
      return dem[dem.length - 1].listAdr;
    };
    f.lo = dem[0].occ; f.hi = dem[dem.length - 1].occ; f.pts = dem;
    return f;
  }
  function mathsCard(v) {
    var res = v.res, rec = recOf(res), g = guestsFn(res), fT = res.target > 0 ? curveOf(res.required, 'target') : null, near = Math.round(rec.stats.occ * 10) / 10;
    var rows = res.required.filter(function (r) { var p = Math.round(r.occ * 100); return p >= 40 && p <= 90 && p % 10 === 0; });
    var tbl = '<div class="table-wrap"><table class="table pp-req"><thead><tr><th>Nights sold</th><th class="num">Break even</th>' + (res.target > 0 ? '<th class="num">For ' + esc(money(res.target)) + '</th>' : '') + '<th class="num" title="The average price at which guests would book that share of nights">Guests pay</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var gp = g ? g(r.occ) : null, need = res.target > 0 ? r.target : r.breakEven, ok = gp != null && need != null && gp >= need;
        return '<tr' + (Math.abs(r.occ - near) < 1e-9 ? ' class="near" title="About where the recommended plan lands"' : '') + '><td>' + pct(r.occ) + '</td><td class="num">' + (r.breakEven == null ? 'No price works' : price(r.breakEven)) + '</td>' +
          (res.target > 0 ? '<td class="num">' + (r.target == null ? 'No price works' : price(r.target)) + '</td>' : '') +
          '<td class="num' + (ok ? ' ok' : '') + '"' + (ok ? ' title="Guests pay enough at this share of nights"' : '') + '>' + (gp == null ? '–' : price(gp) + (ok ? ' ✓' : '')) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    /* where guests pay at least what the target needs */
    var need = fT || curveOf(res.required, 'breakEven'), lo = null, hi = null, o;
    if (g && need) for (o = Math.ceil(g.lo * 100); o <= Math.floor(g.hi * 100); o++) { if (g(o / 100) >= need(o / 100)) { if (lo == null) lo = o; hi = o; } }
    var txt = !g ? 'There are too few open nights to see how guests react to price.'
      : lo == null ? 'At no share of nights do guests pay the rate needed for ' + goalLabel(res) + ', so you would need lower costs' + (res.target > 0 ? ', a lower target' : '') + ' or more bookings than the forecast expects.'
        : 'Guests pay enough for ' + goalLabel(res) + ' when ' + (lo === hi ? 'about ' + lo + '% of nights sell' : 'between ' + lo + '% and ' + hi + '% of nights sell') + '. Higher prices sell too few nights; lower prices do not earn enough on each.';
    return '<div class="card pp-maths pp-dim"><div class="card-head"><div class="hd"><h3>The rate you need against what guests pay</h3><div class="sub">The price needed at each share of nights sold, from your costs, and the price guests are likely to pay for that many nights</div></div></div>' +
      '<div class="card-body"><div><div class="pp-chart" role="group" aria-label="Chart of the rate needed and the rate guests pay at each share of nights sold"></div>' +
      '<div class="pp-chart-foot">' + legendHTML(res) + '<div class="small">Across: share of nights sold in these dates. Up: the price per night sold. The dots are the plans below, placed by the average price of the nights they sell, booked nights included, so a dot can sit away from the card\'s average rate.</div></div></div>' +
      '<div>' + tbl + '<div class="pp-req-txt">' + esc(txt) + '</div></div></div></div>';
  }
  function legendHTML(res) {
    return '<div class="legend">' + (res.target > 0 ? '<span><i style="background:var(--brand-strong)"></i>Needed for ' + esc(money(res.target)) + ' a month</span>' : '') +
      '<span><i class="lg-dash"></i>Needed to break even</span><span><i style="background:var(--accent)"></i>What guests pay</span><span><i class="lg-dot"></i>Plans</span></div>';
  }
  /* bottom and top of the price axis: 4 equal steps of a round size (as Pricing) */
  var STEPS = [5, 10, 20, 25, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 5000];
  function axisFit(vals) {
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), best = null;
    STEPS.forEach(function (step) {
      if (best) return;
      var range = 4 * step, B = Math.floor((lo - range * 0.05) / step) * step;
      if (B < 0) B = 0;
      if (B + range >= hi + range * 0.03) best = { yMin: B, yMax: B + range };
    });
    return best || { yMin: 0, yMax: Math.ceil(hi / 1000) * 1000 || 100 };
  }
  var CLIP_N = 0; /* a fresh clip-path id for every drawing */
  function drawChart(el, res) {
    if (st.ro) { try { st.ro.disconnect(); } catch (e) { /* gone */ } st.ro = null; }
    el.classList.add('chart');
    var g = guestsFn(res), fT = res.target > 0 ? curveOf(res.required, 'target') : null, fB = curveOf(res.required, 'breakEven');
    var recKey = recOf(res).key;
    var pts = res.options.filter(function (op) { return op.stats.listAdr > 0 && op.stats.occ > 0; }).map(function (op) { return { op: op, x: op.stats.occ, y: op.stats.listAdr }; });
    function draw() {
      var W = Math.max(280, el.clientWidth || 600), H = 270, pt = 16, pb = 26, pr = 14;
      var occs = pts.map(function (p) { return p.x; }).concat(g ? [g.lo] : []).concat([0.6]);
      var x0 = clamp(Math.floor((Math.min.apply(null, occs) - 0.05) * 10) / 10, 0.05, 0.5), x1 = 1;
      var base = pts.map(function (p) { return p.y; }).concat(g ? g.pts.map(function (r) { return r.listAdr; }) : []);
      var hi0 = base.length ? Math.max.apply(null, base) : 100, vals = base.slice(), o;
      [fT, fB].forEach(function (f) { if (!f) return; vals.push(f(1)); for (o = 0.5; o <= 1; o += 0.05) { var y = f(o); if (y <= hi0 * 1.4) vals.push(y); } });
      if (!vals.length) vals = [0, 100];
      var fit = axisFit(vals), ymin = fit.yMin, ymax = fit.yMax;
      var yf = function (v, axis) { return axis ? fmt.cur(CUR) + ' ' + Math.round(v) : price(v); };
      var gl = []; for (var q = 0; q <= 4; q++) gl.push(yf(ymin + (ymax - ymin) * q / 4, true));
      var pl = Math.max(40, Math.round(gl.reduce(function (m, t) { return Math.max(m, t.length); }, 0) * 6.3 + 14));
      function X(v) { return pl + (v - x0) / (x1 - x0) * (W - pl - pr); }
      function Y(v) { return pt + (H - pt - pb) * (1 - (v - ymin) / ((ymax - ymin) || 1)); }
      var cid = 'pp-clip-' + (++CLIP_N);
      var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img" aria-label="' + esc('Rate needed and rate guests pay by share of nights sold') + '"><defs><clipPath id="' + cid + '"><rect x="' + pl + '" y="' + pt + '" width="' + (W - pl - pr) + '" height="' + (H - pt - pb) + '"/></clipPath></defs>';
      for (q = 0; q <= 4; q++) { var gv = ymin + (ymax - ymin) * q / 4, gy = Y(gv); s += '<line class="grid-line" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + gy + '" y2="' + gy + '"/><text class="axis-label" x="' + (pl - 8) + '" y="' + (gy + 3.5) + '" text-anchor="end">' + esc(gl[q]) + '</text>'; }
      var tickStep = (W - pl - pr) / ((x1 - x0) * 10) < 34 ? 0.2 : 0.1;
      for (o = Math.ceil(x0 * 10 - 1e-9) / 10; o <= x1 + 1e-9; o += tickStep) s += '<text class="axis-label" x="' + X(o) + '" y="' + (H - 7) + '" text-anchor="middle">' + Math.round(o * 100) + '%</text>';
      function path(f) {
        var p = '', top = ymax + (ymax - ymin), started = false;
        for (var k = Math.round(x0 * 100); k <= 100; k++) { var y = f(k / 100); if (y == null) { started = false; continue; } p += (started ? 'L' : 'M') + X(k / 100).toFixed(1) + ',' + Y(Math.min(y, top)).toFixed(1); started = true; }
        return p;
      }
      s += '<g clip-path="url(#' + cid + ')">';
      if (fB) s += '<path class="series-line" style="stroke:var(--c-prev1);stroke-dasharray:5 4" d="' + path(fB) + '"/>';
      if (fT) s += '<path class="series-line" style="stroke:var(--brand-strong)" d="' + path(fT) + '"/>';
      if (g) s += '<path class="series-line" style="stroke:var(--accent)" d="' + path(g) + '"/>';
      s += '</g><line class="crosshair" x1="0" x2="0" y1="' + pt + '" y2="' + (H - pb) + '" style="display:none"/><g class="hover-dots"></g>';
      s += '<rect class="hit" x="' + pl + '" y="0" width="' + (W - pl - pr) + '" height="' + (H - pb) + '" fill="transparent"/>';
      /* the plans as dots with short names. The recommended plan is labelled first; each label tries above, below, right and
         left of its dot and is left off when all four would touch another label or dot (the dot still has its tooltip) */
      pts.sort(function (a, b) { return (b.op.key === recKey ? 1 : 0) - (a.op.key === recKey ? 1 : 0); });
      var boxes = pts.map(function (p) { var cx = X(p.x), cy = Y(clamp(p.y, ymin, ymax)); return { x0: cx - 6, x1: cx + 6, y0: cy - 6, y1: cy + 6 }; });
      function free(b) {
        if (b.x0 < pl || b.x1 > W - pr || b.y0 < 0 || b.y1 > H - pb) return false;
        return !boxes.some(function (o) { return b.x0 < o.x1 + 2 && b.x1 > o.x0 - 2 && b.y0 < o.y1 + 1 && b.y1 > o.y0 - 1; });
      }
      /* dots closer than 20px share one hit circle (around all of them), one label and one tooltip, so every dot can
         still be reached; the others keep their own 13px circle, which then covers no other dot */
      var groups = [];
      pts.forEach(function (p) {
        var cx = X(p.x), cy = Y(clamp(p.y, ymin, ymax)), me = { p: p, cx: cx, cy: cy }, near = groups.filter(function (gr) { return gr.m.some(function (q) { return Math.sqrt((q.cx - cx) * (q.cx - cx) + (q.cy - cy) * (q.cy - cy)) < 20; }); });
        var gr = near[0] || { m: [] };
        if (!near.length) groups.push(gr);
        near.slice(1).forEach(function (o) { gr.m = gr.m.concat(o.m); groups.splice(groups.indexOf(o), 1); });
        gr.m.push(me);
      });
      groups.forEach(function (gr) {
        gr.list = gr.m.map(function (q) { return q.p; });
        gr.cx = gr.m.reduce(function (a, q) { return a + q.cx; }, 0) / gr.m.length; gr.cy = gr.m.reduce(function (a, q) { return a + q.cy; }, 0) / gr.m.length;
        gr.r = Math.max(13, 7 + Math.max.apply(null, gr.m.map(function (q) { return Math.sqrt((q.cx - gr.cx) * (q.cx - gr.cx) + (q.cy - gr.cy) * (q.cy - gr.cy)); })));
      });
      function dotText(op) { return op.name + ': average rate ' + price(op.stats.avgPrice) + ', ' + price(op.stats.listAdr) + ' per night sold, ' + pct(op.stats.occ) + ' of nights sold'; }
      var dotsSvg = '', recDot = '', lbls = '';
      pts.forEach(function (p) {
        var cx = X(p.x), cy = Y(clamp(p.y, ymin, ymax)), rec = p.op.key === recKey;
        var dot = '<circle class="opt-dot ' + (rec ? 'rec' : 'other') + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (rec ? 6 : 5) + '"/>';
        if (rec) recDot = dot; else dotsSvg += dot;
      });
      groups.forEach(function (gr, i) {
        var cx = gr.cx, cy = gr.cy, rec = gr.list.some(function (p) { return p.op.key === recKey; });
        var t = joinWords(gr.list.map(function (p) { return SHORT[p.op.key] || p.op.name; })), w = t.length * 6.4 + 2, h = 12;
        var tries = [[cx - w / 2, cy - 10 - h, 'middle'], [cx - w / 2, cy + 9, 'middle'], [cx + 9, cy - h / 2, 'start'], [cx - 9 - w, cy - h / 2, 'start']], spot = null;
        tries.some(function (c) { var b = { x0: c[0], x1: c[0] + w, y0: c[1], y1: c[1] + h }; if (free(b)) { spot = c; boxes.push(b); return true; } return false; });
        if (spot) lbls += '<text class="opt-lbl' + (rec ? ' rec' : '') + '" x="' + (spot[2] === 'middle' ? cx : spot[0]).toFixed(1) + '" y="' + (spot[1] + h - 2).toFixed(1) + '" text-anchor="' + spot[2] + '">' + esc(t) + '</text>';
        lbls += '<circle class="opt-hit" data-g="' + i + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + gr.r.toFixed(1) + '" tabindex="0" role="button" aria-label="' + esc(gr.list.map(function (p) { return dotText(p.op); }).join('. ')) + '"/>';
      });
      s += dotsSvg + recDot + lbls + '</svg>';
      el.innerHTML = s + '<div class="chart-tip"></div>';
      var svg = O.$('svg', el), tip = O.$('.chart-tip', el), ch = O.$('.crosshair', el), dots = O.$('.hover-dots', el);
      function tipRows(title, rows) {
        tip.innerHTML = '<div class="tt-h"></div>' + rows.map(function () { return '<div class="tt-r"><span><i></i><em></em></span><b></b></div>'; }).join('');
        O.$('.tt-h', tip).textContent = title;
        O.$$('.tt-r', tip).forEach(function (r, k) { O.$('i', r).style.background = rows[k].color; O.$('em', r).textContent = rows[k].name; O.$('em', r).style.fontStyle = 'normal'; O.$('b', r).textContent = rows[k].value; });
      }
      function place(px, py) {
        tip.style.display = 'block';
        var w = tip.offsetWidth, left = px + 14; if (left + w > el.clientWidth) left = px - w - 14; if (left < 0) left = 0;
        tip.style.left = left + 'px'; tip.style.top = Math.max(0, py - 10) + 'px';
      }
      function showAt(evt) {
        var r = svg.getBoundingClientRect(), sx = (evt.clientX - r.left) * (W / r.width), occ = clamp(Math.round(((sx - pl) / (W - pl - pr) * (x1 - x0) + x0) * 100) / 100, x0, 1);
        var rows = [], dd = '';
        function add(name, f, color) { var y = f ? f(occ) : null; if (y == null) return; rows.push({ name: name, value: price(y), color: color }); if (y <= ymax && y >= ymin) dd += '<circle class="dot-ring" cx="' + X(occ) + '" cy="' + Y(y) + '" r="4.5" style="fill:' + color + '"/>'; }
        if (fT) add('Needed for ' + money(res.target) + ' a month', fT, 'var(--brand-strong)');
        add('Needed to break even', fB, 'var(--c-prev1)');
        add('Guests pay', g, 'var(--accent)');
        ch.setAttribute('x1', X(occ)); ch.setAttribute('x2', X(occ)); ch.style.display = '';
        dots.innerHTML = dd;
        tipRows(Math.round(occ * 100) + '% of nights sold', rows);
        place(X(occ) * (r.width / W), evt.clientY - r.top);
      }
      function hide() { tip.style.display = 'none'; ch.style.display = 'none'; dots.innerHTML = ''; }
      var hit = O.$('.hit', el);
      hit.addEventListener('mousemove', showAt); hit.addEventListener('mouseleave', hide);
      hit.addEventListener('touchstart', function (e) { showAt(e.touches[0]); }, { passive: true });
      O.$$('.opt-hit', el).forEach(function (c) {
        var gr = groups[+c.getAttribute('data-g')];
        function show(evt) {
          var r = svg.getBoundingClientRect(), rows = [];
          hide();
          if (gr.list.length === 1) {
            var st2 = gr.list[0].op.stats;
            rows = [{ name: 'Average rate', value: price(st2.avgPrice), color: 'transparent' }, { name: 'Per night sold, booked nights included', value: price(st2.listAdr), color: 'var(--text-2)' },
              { name: 'Nights sold', value: pct(st2.occ), color: 'transparent' }, { name: 'Profit a month', value: price(st2.profitPerMonth), color: 'transparent' }];
          } else {
            gr.list.forEach(function (p) { rows.push({ name: p.op.name, value: pct(p.op.stats.occ) + ' sold, ' + price(p.op.stats.profitPerMonth) + ' a month', color: 'var(--text-2)' }); });
          }
          tipRows(gr.list.length === 1 ? gr.list[0].op.name : 'Plans close together', rows);
          place(gr.cx * (r.width / W), evt && evt.clientY != null ? evt.clientY - r.top : gr.cy * (r.height / H));
        }
        c.addEventListener('mouseenter', show); c.addEventListener('focus', function () { show(null); });
        c.addEventListener('mouseleave', function () { tip.style.display = 'none'; }); c.addEventListener('blur', function () { tip.style.display = 'none'; });
        c.addEventListener('click', function () { openPreview(gr.list[0].op.key); });
        c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); openPreview(gr.list[0].op.key); } });
      });
    }
    draw();
    if (window.ResizeObserver) { var w0 = el.clientWidth; st.ro = new ResizeObserver(function () { if (Math.abs(el.clientWidth - w0) > 4 && el.isConnected) { w0 = el.clientWidth; draw(); } }); st.ro.observe(el); }
  }

  /* ------------------------------------------------------------------ results: option cards */
  function numsHTML(card, res) {
    var s = card.stats;
    return '<div class="pp-nums">' +
      '<div><span class="l">Average rate</span>' + fitB(price(s.avgPrice)) + '<small>' + weekText(s) + '</small></div>' +
      '<div><span class="l">Nights likely sold</span><b>' + pct(s.occ) + '</b><small>about ' + Math.round(s.soldNights) + ' of ' + s.nights + '</small></div>' +
      '<div><span class="l">Profit a month</span>' + fitB(price(s.profitPerMonth)) + '<small>likely ' + price(s.p10) + ' to ' + price(s.p90) + '</small></div>' +
      '<div><span class="l">' + esc(chanceLabel(res)) + '</span><b>' + pct(s.pTarget) + '</b><small>' + (s.pLoss >= 0.005 ? pct(s.pLoss) + ' chance of a loss' : 'hardly any chance of a loss') + '</small></div></div>';
  }
  /* the parts of the average rate: "Sun–Thu RM 268", "Fri–Sat RM 290" and "Peak RM 380" (the engine's weekday,
     weekend and peak nights), the same words in the headline and on the cards */
  function weekParts(s) {
    var bits = [];
    if (s.weekday.avgPrice != null) bits.push('Sun–Thu ' + price(s.weekday.avgPrice));
    if (s.weekend.avgPrice != null) bits.push('Fri–Sat ' + price(s.weekend.avgPrice));
    if (s.peak && s.peak.avgPrice != null) bits.push('Peak ' + price(s.peak.avgPrice));
    return bits;
  }
  function weekText(s) {
    var bits = weekParts(s);
    return bits.length ? bits.map(function (t) { return '<span class="ln">' + esc(t) + '</span>'; }).join('') : 'on the open nights';
  }
  /* pros and cons, the engine's most important first: three of each show, the rest behind "N more" */
  var PC_SHOWN = 3;
  function pcHTML(card) {
    function items(xs, icon) { return xs.map(function (t) { return '<li>' + O.icon(icon) + '<span>' + esc(t) + '</span></li>'; }).join(''); }
    function list(xs, cls, icon) {
      var more = xs.length > PC_SHOWN + 1 ? xs.slice(PC_SHOWN) : [], shown = more.length ? xs.slice(0, PC_SHOWN) : xs;
      return '<ul class="pp-pc ' + cls + '">' + items(shown, icon) + '</ul>' +
        (more.length ? '<details class="pp-more"><summary>' + more.length + ' more</summary><ul class="pp-pc ' + cls + '">' + items(more, icon) + '</ul></details>' : '');
    }
    return '<div class="pp-pc-l">Good</div>' + list(card.pros, 'pros', 'check') + '<div class="pp-pc-l">Watch out</div>' + list(card.cons, 'cons', 'alert');
  }
  function changeText(card) {
    var s = card.stats, bits = [];
    if (!card.changes) return 'Keeps every price as it is today';
    if (s.up) bits.push(s.up + ' up'); if (s.down) bits.push(s.down + ' down'); if (s.added) bits.push(s.added + ' new');
    return 'Changes ' + card.changes + ' of ' + fmt.plural(s.openNights, 'open night') + ': ' + bits.join(', ');
  }
  function optionsCard(v) {
    var res = v.res;
    var cards = res.options.map(function (o) {
      var isCur = o.keys.indexOf('current') >= 0, tag = o.tag ? '<span class="pill ' + (o.recommended ? 'brand' : 'warn') + '">' + esc(o.tag) + '</span>' : '';
      return '<div class="card pp-opt' + (o.recommended ? ' rec' : '') + (st.sel === o.key ? ' sel' : '') + '" data-opt="' + esc(o.key) + '"><div class="pp-opt-h"><h3>' + esc(o.name) + '</h3>' + tag + '<div class="pp-opt-sum">' + esc(o.summary) + '</div></div>' +
        numsHTML(o, res) + '<div class="pp-chg">' + esc(changeText(o)) + '</div>' + pcHTML(o) +
        '<div class="pp-opt-f"><button type="button" class="btn btn-ghost btn-sm" data-preview="' + esc(o.key) + '">' + O.icon('eye') + 'Preview</button>' + (isCur || !o.changes ? '' : pushBtn(o.key, o.recommended ? 'btn-primary' : 'btn-ghost')) + '</div></div>';
    }).join('');
    return '<div class="stack pp-dim"><div><div class="section-title" style="margin:4px 0 2px">Plans to choose from</div><div class="small muted">Each plan is a full set of nightly prices for ' + esc(U.rangeLabel(v.input.nights[0].iso, v.input.nights[v.input.nights.length - 1].iso)) + '. Peak nights and booked nights are handled the same way in every plan.</div></div>' +
      '<div class="pp-opts">' + cards + '</div></div>';
  }

  /* ------------------------------------------------------------------ results: fine-tune along the efficient plans */
  function slideCard(v) {
    var res = v.res, fr = res.frontier;
    if (!st.slide || st.slide.key !== v.run.key) {
      var rec = recOf(res), best = 0;
      fr.forEach(function (f, i) { if (Math.abs(f.occ - rec.stats.occ) < Math.abs(fr[best].occ - rec.stats.occ)) best = i; });
      st.slide = { key: v.run.key, i: best, card: null };
    }
    if (!st.slide.card) st.slide.card = evalAt(v, st.slide.i);
    return st.slide.card;
  }
  function evalAt(v, i) {
    var f = v.res.frontier[i];
    return f ? R.evaluate(v.run.input, f.prices, { key: 'custom', name: 'Your own mix' }) : null;
  }
  function ftOutHTML(card, res) {
    var s = card.stats;
    return '<div class="pp-nums">' +
      '<div><span class="l">Average rate</span>' + fitB(price(s.avgPrice)) + '<small>' + weekText(s) + '</small></div>' +
      '<div><span class="l">Nights likely sold</span><b>' + pct(s.occ) + '</b><small>about ' + Math.round(s.soldNights) + ' of ' + s.nights + '</small></div>' +
      '<div><span class="l">Profit a month</span>' + fitB(price(s.profitPerMonth)) + '<small>likely ' + price(s.p10) + ' to ' + price(s.p90) + '</small></div>' +
      '<div><span class="l">' + esc(chanceLabel(res)) + '</span><b>' + pct(s.pTarget) + '</b><small>' + esc(card.changes ? fmt.plural(card.changes, 'night') + (card.changes === 1 ? ' changes' : ' change') : 'No nights change') + '</small></div></div>';
  }
  function ftCard(v) {
    var fr = v.res.frontier;
    if (fr.length < 2) return '';
    var card = slideCard(v);
    if (!card) return '';
    return '<div class="card pp-ft pp-dim"><div class="card-head"><div class="hd"><h3>Fine-tune</h3><div class="sub">Slide between higher rates and more nights sold. Every point is the most profit possible for that many nights.</div></div></div>' +
      '<div class="card-body"><div><input type="range" class="pp-range" min="0" max="' + (fr.length - 1) + '" step="1" value="' + st.slide.i + '" data-slide aria-label="From higher rates to more nights sold" aria-valuetext="' + esc(pct(card.stats.occ) + ' of nights sold') + '">' +
      '<div class="pp-ends"><span>Higher rate</span><span>More nights</span></div><div class="pp-ft-out">' + ftOutHTML(card, v.res) + '</div>' +
      '<div class="row-flex wrap"><button type="button" class="btn btn-ghost btn-sm" data-preview="custom">' + O.icon('eye') + 'Preview this mix</button>' + pushBtn('custom') + '</div></div>' +
      '<div class="pp-ft-pc">' + pcHTML(card) + '</div></div></div>';
  }

  /* ------------------------------------------------------------------ results: preview */
  function cardBy(v, key) {
    if (key === 'custom') return st.slide && st.slide.key === v.run.key ? st.slide.card : null;
    return v.res.options.filter(function (o) { return o.key === key || o.keys.indexOf(key) >= 0; })[0] || null;
  }
  function previewCard(v) {
    var card = cardBy(v, st.sel) || recOf(v.res), res = v.res, sc = scopeOf(v.P, lastNight(v)), peaks = res.calibration.peaks.length;
    if (!cardBy(v, st.sel)) st.sel = card.key;
    var seg = U.seg([['month', 'By month'], ['night', 'By night']], st.view, 'data-pview');
    var keep = '<span class="pp-keep">Keep peak nights at today\'s price<button type="button" class="switch' + (v.dr.keepPeaks ? ' on' : '') + '" role="switch" aria-checked="' + (v.dr.keepPeaks ? 'true' : 'false') + '" aria-label="Keep peak nights at today\'s price" data-keep-peaks></button></span>';
    var body;
    if (st.view === 'month') {
      /* a rate cell: the plan's average for that kind of night in the month, today's average under it when different,
         the range on hover */
      var rate = function (k, peakCount) {
        if (!k || !k.open) return '<span class="faint">–</span>';
        if (k.avgPrice == null) return '<span class="faint">Not priced</span>';
        var range = k.minPrice != null && Math.round(k.maxPrice) !== Math.round(k.minPrice) ? price(k.minPrice) + ' to ' + price(k.maxPrice) : '';
        var was = k.currentAvgPrice != null && Math.round(k.currentAvgPrice) !== Math.round(k.avgPrice) ? '<span class="pp-was">today ' + price(k.currentAvgPrice) + '</span>' : '';
        return '<span' + (range ? ' title="' + esc(range.replace(/ /g, ' ')) + '"' : '') + '><b>' + price(k.avgPrice) + '</b>' + (peakCount ? '<span class="faint"> × ' + peakCount + '</span>' : '') + '</span>' + was;
      };
      var total = function (kind) {
        var t = { open: 0, priced: 0, sum: 0, curN: 0, curSum: 0, minPrice: null, maxPrice: null };
        card.byMonth.forEach(function (m) {
          var k = m[kind]; t.open += k.open;
          if (k.avgPrice != null) { t.priced += k.priced; t.sum += k.avgPrice * k.priced; }
          if (k.currentAvgPrice != null) { t.curN += k.currentN; t.curSum += k.currentAvgPrice * k.currentN; }
          if (k.minPrice != null && (t.minPrice == null || k.minPrice < t.minPrice)) t.minPrice = k.minPrice;
          if (k.maxPrice != null && (t.maxPrice == null || k.maxPrice > t.maxPrice)) t.maxPrice = k.maxPrice;
        });
        return { open: t.open, avgPrice: t.priced ? t.sum / t.priced : null, currentAvgPrice: t.curN ? t.curSum / t.curN : null, minPrice: t.minPrice, maxPrice: t.maxPrice };
      };
      var tp = total('peak');
      body = '<div class="card-body small muted" style="padding-bottom:0">Average nightly rate this plan sets in each month for Sun to Thu nights, Fri and Sat nights, and peak nights (× how many). Today\'s average shows under it when the plan changes it. Booked and blocked nights are left out.</div>' +
        '<div class="table-wrap"><table class="table pp-tbl"><thead><tr><th>Month</th><th class="num">Sun–Thu</th><th class="num">Fri–Sat</th><th class="num">Peak nights</th><th class="num sm-x">Changes</th><th class="num">Likely sold</th><th class="num">Profit in the month</th></tr></thead><tbody>' +
        card.byMonth.map(function (m) {
          return '<tr' + (m.changes ? ' class="chg"' : '') + '><td><b><span class="sm-x">' + esc(m.label) + '</span><span class="sm-o">' + esc(m.label.slice(0, 3) + (/\d{4}$/.test(m.label) ? ' ' + m.label.slice(-4) : '')) + '</span></b><span class="pp-was sm-x">' + fmt.plural(m.nights, 'night') + (m.booked ? ', ' + m.booked + ' booked' : '') + (m.blocked ? ', ' + m.blocked + ' blocked' : '') + '</span></td>' +
            '<td class="num">' + rate(m.weekday) + '</td><td class="num">' + rate(m.weekend) + '</td><td class="num">' + rate(m.peak, m.peak.open) + '</td><td class="num sm-x">' + (m.changes || '<span class="faint">0</span>') + '</td>' +
            '<td class="num">' + pct(m.occ) + '</td><td class="num">' + price(m.profit) + '</td></tr>';
        }).join('') + '</tbody><tfoot><tr><td><span class="sm-x">All dates</span><span class="sm-o">All</span></td><td class="num">' + rate(total('weekday')) + '</td><td class="num">' + rate(total('weekend')) + '</td><td class="num">' + rate(tp, tp.open) + '</td><td class="num sm-x">' + card.changes + '</td><td class="num">' + pct(card.stats.occ) + '</td><td class="num">' + price(card.stats.profit) + '</td></tr></tfoot></table></div>';
    } else {
      var rows = card.nightly.filter(function (n) { return st.nights === 'all' || (n.status === 'open' && n.price != null && n.price !== n.current); });
      body = '<div class="card-body" style="padding-bottom:8px">' + U.seg([['all', 'All nights'], ['changes', 'Only changes']], st.nights, 'data-nview') + '</div>' +
        (rows.length ? '<div class="table-wrap pp-scroll"><table class="table pp-tbl"><thead><tr><th>Night</th><th class="sm-x">Status</th><th class="num">Today</th><th class="num">New</th><th class="num sm-x">Change</th><th class="num"><span class="sm-x">Chance it sells</span><span class="sm-o">Sells</span></th></tr></thead><tbody>' +
          rows.map(function (n) {
            var open = n.status === 'open', chg = open && n.price != null && n.price !== n.current, diff = chg && n.current ? n.price - n.current : null;
            return '<tr class="' + (chg ? 'chg' : '') + (open ? '' : ' bk') + '"><td><b>' + d.dowName(n.iso) + ' ' + d.fmt(n.iso) + '</b>' + (n.peak ? '<span class="pk">Peak</span>' : '') + '</td>' +
              '<td class="sm-x">' + (n.status === 'booked' ? 'Booked' : n.status === 'blocked' ? 'Blocked' : 'Open') + '</td>' +
              '<td class="num">' + price(n.current) + '</td><td class="num">' + (open ? '<b>' + price(n.price) + '</b>' : '<span class="faint">–</span>') + '</td>' +
              '<td class="num sm-x">' + (diff != null ? '<span class="' + (diff > 0 ? 'pos' : 'neg') + '">' + signedMoney(diff) + '</span><span class="faint"> ' + fmt.changeText(diff / n.current, 0) + '</span>' : chg ? 'New price' : '<span class="faint">–</span>') + '</td>' +
              '<td class="num">' + (n.status === 'booked' ? '<span class="faint">Booked</span>' : n.status === 'blocked' ? '<span class="faint">Blocked</span>' : open && n.price != null ? pct(n.chance) : '<span class="faint">–</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="card-body">' + U.empty('No night changes in this plan.') + '</div>');
    }
    var isCur = card.keys.indexOf('current') >= 0;
    var foot = '<div class="card-foot pp-prev-f"><span class="small">' + (isCur || !card.changes ? 'This plan keeps today\'s prices.' : fmt.plural(card.changes, 'night') + ' would change. ' + esc(sc.line) + '.') + (peaks ? ' ' + fmt.plural(peaks, 'peak night') + ' in these dates.' : '') + '</span>' +
      (isCur || !card.changes ? '' : pushBtn(card.key, 'btn-primary').replace('>' + O.icon('upload') + 'Push<', '>' + O.icon('upload') + 'Push ' + fmt.plural(card.changes, 'new price') + '<')) + '</div>';
    return '<div class="card pp-prev pp-dim" id="pp-preview"><div class="card-head"><div class="hd"><h3 tabindex="-1">Preview: ' + esc(card.name) + '</h3><div class="sub">' + esc(changeText(card)) + '. ' + esc(sc.line) + '.</div></div><div class="row-flex wrap">' + seg + keep + '</div></div>' + body + foot + '</div>';
  }

  /* ------------------------------------------------------------------ history and assumptions (outside the repainted results) */
  function historyCard(P) {
    var t = typeOf(P), list = pushList().filter(function (x) { return x.pid === P.id || (t && x.typeId === t.id); }).slice(0, 10), edit = canChange();
    var rows = list.map(function (x) {
      var isos = Object.keys(x.nights || {}).sort(), u = D.propById[x.pid];
      var name = x.name || R.NAMES[x.option] || (x.option === 'custom' ? 'Your own mix' : 'Plan');
      var part = partlyUndone(x);
      var undo = x.undoneAt ? '<span class="pill neutral">Undone ' + esc(d.fmt(x.undoneAt.slice(0, 10))) + '</span>'
        : (part ? '<span class="pill neutral">Partly undone</span>' : '') + '<button type="button" class="btn btn-ghost btn-sm" data-undo="' + esc(x.id) + '"' + (edit ? '' : ' disabled title="' + esc(WHY_CHANGE) + '"') + '>' + O.icon('refresh') + (part ? 'Undo the rest' : 'Undo') + '</button>';
      return '<div class="pp-hrow' + (x.undoneAt ? ' undone' : '') + '"><div class="main"><div class="t">' + esc(name) + ' · ' + fmt.plural(x.n || isos.length, 'night') + (isos.length ? ' (' + esc(rangeText(isos)) + ')' : '') + '</div>' +
        '<div class="s">' + esc(fmt.dateTime(x.at)) + ' by ' + esc(staffName(x.by)) + (u && !x.planId && t && histUnits(t) > 1 ? ' for ' + esc(u.short || u.name) + ' only' : u && u.id !== P.id ? ' from ' + esc(u.short || u.name) : '') + (x.undoneAt && x.undoneBy ? ' · undone by ' + esc(staffName(x.undoneBy)) : '') + '</div></div>' + undo + '</div>';
    }).join('');
    return '<div class="card pp-hist"><div class="card-head"><div class="hd"><h3>Push history</h3><div class="sub">' + (t && histUnits(t) > 1 ? 'Pushes for ' + esc(t.name) + ' units' : 'Pushes for ' + esc(P.short || P.name)) + '. Undo puts back the prices from before a push.</div></div></div>' +
      (rows || '<div class="card-body">' + U.empty('Nothing pushed yet. When you push a plan, it shows here with a way to undo it.') + '</div>') + '</div>';
  }
  function isPctUnit(a) { return a.unit === 'share' || (a.unit === 'list' && a.min >= 0); }
  function shownVal(a, v) { return isPctUnit(a) ? String(Math.round(v * 1000) / 10) : String(Math.round(v * 1000) / 1000); }
  function parsedVal(a, s) {
    var n = parseFloat(String(s).replace(/,/g, '')); if (!isFinite(n)) return null;
    return clamp(isPctUnit(a) ? n / 100 : n, a.min, a.max);
  }
  function asmOf(key) { return R.ASSUMPTIONS.filter(function (a) { return a.key === key; })[0]; }
  function asmInput(a, v, i) {
    var suf = isPctUnit(a) ? '%' : a.unit === 'nights' ? 'nights' : a.unit === 'months' ? 'months' : '', pre = a.unit === 'money' ? fmt.cur(CUR) : '';
    var step = isPctUnit(a) ? Math.max(0.1, a.step * 100) : a.step;
    return '<div class="inunit">' + (pre ? '<span>' + esc(pre) + '</span>' : '') + '<input type="number" inputmode="decimal" step="' + step + '"' + (i == null ? ' id="pp-a-' + a.key + '" data-asm="' + a.key + '"' : ' data-asm-list="' + a.key + '" data-i="' + i + '" aria-label="' + esc(a.label + ': ' + a.items[i]) + '"') + ' value="' + esc(shownVal(a, v)) + '">' + (suf ? '<span>' + suf + '</span>' : '') + '</div>';
  }
  function asmSub(changed) { return (changed ? fmt.plural(changed, 'value') + ' changed from the defaults' : 'All at the defaults') + ', with where each one comes from'; }
  function asmCard(dr) {
    var changed = Object.keys(dr.asm).length;
    var rows = R.ASSUMPTIONS.map(function (a) {
      var v = dr.asm[a.key] != null ? dr.asm[a.key] : R.DEFAULTS[a.key], ch = dr.asm[a.key] != null;
      var input = a.unit === 'list' ? '<div class="pp-list">' + a.items.map(function (lab, i) { return '<label>' + esc(lab) + asmInput(a, v[i], i) + '</label>'; }).join('') + '</div>' : asmInput(a, v);
      return '<div class="pp-arow' + (a.unit === 'list' ? ' wide' : '') + '" data-arow="' + a.key + '"><div class="al">' + (a.unit === 'list' ? '<span>' + esc(a.label) + '</span>' : '<label for="pp-a-' + a.key + '">' + esc(a.label) + '</label>') +
        (ch ? '<span class="row-flex"><span class="pill accent">Changed</span><button type="button" class="btn btn-quiet btn-xs" data-asm-reset="' + a.key + '">Reset</button></span>' : '') + '</div>' +
        input + '<div class="help">' + esc(a.help) + '</div><div class="src">Source: ' + esc(a.source) + '</div></div>';
    }).join('');
    return '<div class="card"><details class="pp-asm"' + (st.asmOpen ? ' open' : '') + '><summary><div><h3>Assumptions behind the forecast</h3><div class="sub">' + esc(asmSub(changed)) + '</div></div>' + O.icon('chevron') + '</summary>' +
      '<div class="pp-asm-body"><div class="pp-calib" data-calib></div><div class="pp-arows">' + rows + '</div>' +
      '<div class="pp-acts" style="padding-top:12px"><button type="button" class="btn btn-ghost btn-sm" data-asm-reset-all' + (changed ? '' : ' disabled') + '>Reset all to the defaults</button><span class="small muted">The plans use these values straight away. Press Save costs and target to keep them for next time.</span></div></div></details></div>';
  }
  /* what calibration used, from the result */
  function calibHTML(v) {
    if (!v.has) return '<div class="label">What your own data changed</div><div>Enter the costs to see how your prices and bookings shape the forecast.</div>';
    if (!v.res) return '<div class="label">What your own data changed</div><div>Working it out…</div>';
    var c = v.res.calibration, from = { weekdays: 'the middle of today\'s Sunday to Thursday prices in these dates', 'all nights': 'the middle of today\'s prices in these dates', 'base price': 'the unit\'s base price', booked: 'from what the booked nights brought in', costs: 'what the costs need', 'default': 'a placeholder, as there are no prices to start from' };
    var items = ['The usual price is ' + money(c.P0) + ', ' + (from[c.P0From] || 'from today\'s prices') + '.'];
    items = items.concat(c.text);
    if (Math.abs(c.baseOccUsed - c.baseOcc) >= 0.005 && !c.history) items.push('The usual occupancy used is ' + pct(c.baseOccUsed) + '.');
    if (c.peaks.length) items.push(fmt.plural(c.peaks.length, 'peak night') + ', priced well above the usual price for that kind of night: ' + c.peaks.slice(0, 6).map(function (p) { return d.fmt(p.iso) + ' ' + price(p.current) + ' (usual ' + price(p.usual) + ')'; }).join(', ') + (c.peaks.length > 6 ? ' and ' + (c.peaks.length - 6) + ' more' : '') + '.');
    return '<div class="label">What your own data changed</div><ul>' + items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
  }

  /* ------------------------------------------------------------------ painting */
  function bodyHTML(v) {
    if (!v.has || !v.res || (v.err && !v.fresh)) return '';
    return optionsCard(v) + ftCard(v) + previewCard(v);
  }
  /* keyboard focus across a redraw: where the focused control is (its id, else what it does), as selectors to try after
     the redraw, in order; the first that exists and is enabled gets the focus back */
  function focusKeys(el, root) {
    if (!el || el === document.body || !root || !root.contains(el) || !el.getAttribute) return null;
    if (el.id) return ['#' + el.id];
    var out = [], ks = ['data-preview', 'data-push', 'data-pview', 'data-nview', 'data-undo'], i, a;
    for (i = 0; i < ks.length; i++) if (el.hasAttribute(ks[i])) { out.push('[' + ks[i] + '="' + String(el.getAttribute(ks[i])).replace(/["\\]/g, '') + '"]'); break; }
    if (el.classList.contains('opt-hit')) out.push('.opt-hit[data-g="' + el.getAttribute('data-g') + '"]');
    if (el.hasAttribute('data-keep-peaks')) out.push('[data-keep-peaks]');
    if ((a = el.getAttribute('data-asm-reset'))) out.push('[data-asm-reset="' + a + '"]', '#pp-a-' + a, '[data-asm-list="' + a + '"]');
    if (el.hasAttribute('data-asm-reset-all')) out.push('[data-asm-reset-all]', 'details.pp-asm > summary');
    if (el.matches('[data-costs] [type="submit"]')) out.push('[data-costs] [type="submit"]');
    return out.length ? out : null;
  }
  function refocus(keys, root) {
    var ae = document.activeElement, i, el;
    if (!keys || (ae && ae !== document.body && root.contains(ae))) return;
    for (i = 0; i < keys.length; i++) {
      el = O.$(keys[i], root);
      if (el && !el.disabled) { try { el.focus({ preventScroll: true }); } catch (e) { /* gone */ } return; }
    }
  }
  function paintResults() {
    var pg = O.$('#page-root .pg-planner'); if (!pg || pg.getAttribute('data-pid') !== st.pid) return;
    var v = viewFor(st.pid), fk = focusKeys(document.activeElement, pg);
    CUR = v.P;
    var head = O.$('.pp-right', pg), body = O.$('.pp-body', pg), cal = O.$('[data-calib]', pg);
    head.innerHTML = headHTML(v);
    body.innerHTML = bodyHTML(v);
    if (cal) cal.innerHTML = calibHTML(v);
    setBusy(v.has && !v.fresh && !(v.err && !v.res));
    var el = O.$('.pp-chart', pg); if (el && v.res) drawChart(el, v.res);
    refocus(fk, pg);
  }
  function openPreview(key) {
    st.sel = key;
    paintResults();
    /* below the sticky top bar, so the plan's name and the month / night switch stay in view; the keyboard focus goes to
       its heading, so the next Tab continues from there */
    var el = O.$('#pp-preview'); if (!el) return;
    var bar = O.$('.topbar'), off = bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
    var y = el.getBoundingClientRect().top + (window.pageYOffset || 0) - off - 12;
    try { window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' }); } catch (e) { window.scrollTo(0, Math.max(0, y)); }
    var h = O.$('h3', el); if (h) { try { h.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
  }
  function paintSaved(pg, pid) {
    var el = O.$('[data-saved]', pg); if (!el) return;
    var s = saved(pid), dt = dirty(pid);
    el.innerHTML = dt ? U.pill('Changes not saved', 'warn') : s ? U.pill('Saved ' + fmt.dateTime(s.updatedAt && s.updatedAt < D.NOW ? s.updatedAt : D.NOW), 'ok') : U.pill('Nothing saved yet', 'neutral');
    var dis = O.$('[data-discard]', pg); if (dis) dis.disabled = !dt;
  }

  /* ------------------------------------------------------------------ push and undo */
  /* Undo works on snapshots. For each night it changes, a push keeps the night as it was before (b) and, only where the
     write left it other than the usual way, as it was after (a; afterOf gives the usual way): the price of each unit it
     wrote, with how, by whom and when that price was set (Pricing's stamp), and through a rate plan that plan's own price
     that day (p; 0 when the day followed the plan's model rate). Undo puts a night back to b only while it is still
     exactly as the push left it, so a price set since (by hand, by an automation or by a later push still in place) is
     never overwritten, and undoing the pushes, latest first, ends on the prices from before them all */
  /* a unit's own price on a night with its stamp: [price, how, by, at], [price] with no stamp, or null with no own price */
  function unitState(id, iso) {
    var ov = D.priceOverrides && D.priceOverrides[id], v = ov ? Number(ov[iso]) : 0, mm, m;
    if (!(v > 0)) return null;
    mm = D.priceOverrideMeta && D.priceOverrideMeta[id]; m = mm && mm[iso];
    return m && typeof m === 'object' ? [v, m.how != null ? m.how : null, m.by != null ? m.by : null, m.at != null ? m.at : null] : [v];
  }
  /* a unit's own price on a night set exactly as unitState reads it */
  function putUnit(id, iso, s) {
    D.priceOverrides = D.priceOverrides || {}; D.priceOverrideMeta = D.priceOverrideMeta || {};
    var o = D.priceOverrides[id] = D.priceOverrides[id] || {}, mm = D.priceOverrideMeta[id] = D.priceOverrideMeta[id] || {}, m;
    if (!s) { delete o[iso]; delete mm[iso]; return; }
    o[iso] = s[0];
    if (s.length < 2) { delete mm[iso]; return; }
    m = {}; if (s[1] != null) m.how = s[1]; if (s[2] != null) m.by = s[2]; if (s[3] != null) m.at = s[3];
    mm[iso] = m;
  }
  /* a rate plan's own price on a night, 0 when the day follows the plan's model rate */
  function planDay(map, planId, iso) { var day = O.channel.dayIn(map, planId, iso); return day && day.src === 'manual' && Number(day.rate) > 0 ? Number(day.rate) : 0; }
  /* a night now on these units and this plan: {p, u} when every unit is the same, else {p, us: {unit id: state}} */
  function snap(ids, iso, plan, map) {
    var s = {}, us = {}, k0 = null, same = true;
    if (plan) s.p = planDay(map, plan.id, iso);
    ids.forEach(function (id, i) { var v = us[id] = unitState(id, iso), k = JSON.stringify(v); if (!i) k0 = k; else if (k !== k0) same = false; });
    if (same) s.u = ids.length ? us[ids[0]] : null; else s.us = us;
    return s;
  }
  function stateIn(s, id) { return s.us ? (Object.prototype.hasOwnProperty.call(s.us, id) ? s.us[id] : null) : s.u != null ? s.u : null; }
  /* whether a night is exactly as snapshot s says, on these units and on the plan while it is there */
  function isAt(s, iso, ids, plan, map) {
    if (plan && s.p != null && planDay(map, plan.id, iso) !== s.p) return false;
    for (var i = 0; i < ids.length; i++) if (JSON.stringify(unitState(ids[i], iso)) !== JSON.stringify(stateIn(s, ids[i]))) return false;
    return true;
  }
  /* a night as the push left it: a where the push kept it, else the usual way: the pushed price, set by the planner, by
     whoever pushed, at the time of the push, on every unit it wrote and as its plan's own price */
  function afterOf(rec, x) {
    if (x.a) return x.a;
    var s = { u: [round2(x.to), 'planner', rec.by != null ? rec.by : null, rec.at != null ? rec.at : null] };
    if (rec.planId) s.p = round2(x.to);
    return s;
  }
  /* the units a push writes: through the type's main plan every unit of the type (setDays writes them all), else the unit */
  function pushIds(P, mp) { return mp && P.unitTypeId ? O.unitsOfType(P.unitTypeId).filter(function (u) { return !isArchived(u); }).map(function (u) { return u.id; }) : [P.id]; }
  /* a push's units still in Orbique, and its plan while it is there and not archived (else Undo leaves the plans alone) */
  function recIds(rec) { return (Array.isArray(rec.units) ? rec.units : [rec.pid]).filter(function (id) { return !!D.propById[id]; }); }
  function recPlan(rec) { var p = rec.planId && O.channel ? O.channel.plan(rec.planId) : null; return p && !isArchived(p) ? p : null; }
  /* the nights a card would change now: open, still free, inside the 500 days the channel manager keeps, and different
     from the price the night sells at right now, each with its snapshot from before the push */
  function pushNights(card, P) {
    var T = D.TODAY, last = d.add(T, 499), pc = priceCtx(P), occ = occIndex(P.id), ids = pushIds(P, pc.mp), out = [];
    card.nightly.forEach(function (n) {
      if (n.status !== 'open' || !(n.price > 0) || n.iso < T || n.iso > last || occ.booked[n.iso] || occ.blocked[n.iso]) return;
      var now = priceNow(P.id, n.iso, pc);
      if (now !== n.price) out.push({ iso: n.iso, from: now, to: n.price, b: snap(ids, n.iso, pc.mp, pc.map) });
    });
    return out;
  }
  /* the primary button of the dialog just opened gets the focus, so Enter there confirms once instead of pressing the
     button behind the dialog again */
  function focusDialog() {
    var all = O.$$('.modal-back'), top = all[all.length - 1], b = top && O.$('.modal-foot .btn-primary', top);
    if (b) { try { b.focus(); } catch (e) { /* gone */ } }
  }
  function planWords(card) { return card.key === 'custom' ? 'your own mix of prices' : 'the ' + card.name + ' plan'; }
  function avgOf(xs) { return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : null; }
  function confirmPush(v, key) {
    if (!canChange()) { U.toast(WHY_CHANGE, 'bad'); return; }
    if (O.$('.modal-back')) return;   /* one dialog at a time */
    var card = cardBy(v, key); if (!card) return;
    var P = v.P, list = pushNights(card, P), sc = scopeOf(P, lastNight(v)), t = typeOf(P), cur = curOf(v.res), mp = mainPlanOf(P);
    if (!list.length) { U.toast('Nothing to push: every night in this plan already has that price.'); return; }
    var up = list.filter(function (x) { return x.from && x.to > x.from; }), dn = list.filter(function (x) { return x.from && x.to < x.from; }), add = list.filter(function (x) { return !x.from; });
    var isos = list.map(function (x) { return x.iso; }), s = card.stats, vs = cur && cur !== card ? cur.stats : null;
    /* "on every booking site" only when the unit's type is connected; the channel note below says what happens otherwise */
    var onSites = !!(O.channel && P.unitTypeId && O.channel.typeConnected(P.unitTypeId));
    var lead = 'Change ' + fmt.plural(list.length, 'night') + ' for ' + (sc.many ? t.name + ' (applies to ' + sc.typeWords + ')' : sc.short) + (onSites ? ' on every booking site.' : ' in Orbique.');
    /* the workspace's last-minute deal still applies on top, as the forecast counted it */
    var dealOn = {}, rd = v.res.deal;
    card.nightly.forEach(function (n) { if (n.deal) dealOn[n.iso] = 1; });
    var nDeal = rd ? list.filter(function (x) { return dealOn[x.iso]; }).length : 0;
    var dealLine = nDeal ? 'Your last-minute deal still takes ' + pct(rd.pct) + ' off ' + (nDeal === list.length ? (nDeal === 1 ? 'this night' : 'these nights') : nDeal + ' of these nights') + ' when ' + (nDeal === 1 ? 'it is' : 'they are') + ' booked in the last ' + fmt.plural(rd.days, 'day') + ' before the night. The forecast counts it.' : '';
    /* by how much prices move, over the nights that change */
    var tos = list.map(function (x) { return x.to; }), was = avgOf(list.filter(function (x) { return x.from > 0; }).map(function (x) { return x.from; }));
    var lo = Math.min.apply(null, tos), hi = Math.max.apply(null, tos);
    var avgLine = (was != null ? price(was) + ' now, ' : '') + price(avgOf(tos)) + ' after the push' + (lo !== hi ? ' (' + price(lo) + ' to ' + price(hi) + ')' : '');
    /* the owner's price limits, when nights of this push sit on them */
    var lim = v.res.limits || {}, one = !!(lim.floor && lim.floor === lim.ceiling), limBits = [];
    var atLo = lim.floor ? list.filter(function (x) { return x.to === lim.floor; }).length : 0, atHi = lim.ceiling && !one ? list.filter(function (x) { return x.to === lim.ceiling; }).length : 0;
    if (atLo) limBits.push(fmt.plural(atLo, 'night') + ' at ' + price(lim.floor) + (one ? ', the only price your limits allow' : ', the lowest price you allow'));
    if (atHi) limBits.push(fmt.plural(atHi, 'night') + ' at ' + price(lim.ceiling) + ', the highest price you allow');
    var body = '<div class="stack pp-modal"><p style="margin:0;line-height:1.5"><b>' + esc(lead) + '</b></p>' +
      '<dl class="kv"><dt>Dates</dt><dd>' + esc(rangeText(isos)) + '</dd>' +
      '<dt>Average price</dt><dd>' + esc(avgLine) + '</dd>' +
      '<dt>Prices going up</dt><dd><span class="pos">' + fmt.plural(up.length, 'night') + '</span></dd><dt>Prices going down</dt><dd><span class="neg">' + fmt.plural(dn.length, 'night') + '</span></dd>' +
      (add.length ? '<dt>Nights getting a price</dt><dd>' + fmt.plural(add.length, 'night') + '</dd>' : '') +
      (limBits.length ? '<dt>Price limits</dt><dd>' + esc(limBits.join('; ')) + '.</dd>' : '') +
      '<dt>Expected profit</dt><dd>' + price(s.profitPerMonth) + ' a month' + (vs ? ' (today\'s prices: ' + price(vs.profitPerMonth) + ')' : '') + '</dd>' +
      '<dt>Nights likely sold</dt><dd>' + pct(s.occ) + (vs ? ' (today\'s prices: ' + pct(vs.occ) + ')' : '') + '</dd></dl>' +
      (sc.many ? '<div class="small">Profit and nights sold are worked out for ' + esc(unitName(P)) + ' only; ' + esc(sc.otherWords) + ' the same prices.' + (sc.idleWords ? ' ' + esc(cap1(sc.idleWords)) + '.' : '') + '</div>' : '') +
      (dealLine ? '<div class="small">' + esc(dealLine) + '</div>' : '') +
      '<div class="small muted">Booked, blocked and peak nights kept at today\'s price do not change. ' + esc(channelNote(P, !!mp)) + ' You can undo this from Push history.</div></div>';
    U.modal({
      title: card.key === 'custom' ? 'Push your own mix of prices?' : 'Push the ' + card.name + ' plan?', sub: (P.short || P.name) + ' · ' + U.rangeLabel(v.input.nights[0].iso, v.input.nights[v.input.nights.length - 1].iso), body: body,
      actions: [{ label: 'Cancel' }, { label: 'Push ' + fmt.plural(list.length, 'price'), kind: 'primary', onClick: function () { doPush(card, P, list, v.key); } }]
    });
    focusDialog();
  }
  /* viaPlan: the prices went through a rate plan (the channel manager's own wording for rate changes), else the units'
     own prices */
  function channelNote(P, viaPlan) { return O.channel ? O.channel.notice(viaPlan ? 'rates' : 'price', P && P.unitTypeId ? [P.unitTypeId] : []) : 'Channel calendars update within 15 minutes (prototype: nothing is sent).'; }
  /* writes a push and files it first in the push history: one setDays on the type's main plan (its days and every unit's
     price, as Pricing → Apply), else the unit's own prices; then each night's snapshot from before, and from after where
     the write left the night other than the usual way */
  function writePush(P, mp, list, option, name) {
    var ids = pushIds(P, mp), t = typeOf(P), b = ownBlob(), map, rec;
    if (mp) O.channel.setDays(list.map(function (x) { return { planId: mp.id, dates: [x.iso], set: { rate: x.to } }; }), { emit: false, audit: false, how: 'planner' });
    else list.forEach(function (x) { putUnit(P.id, x.iso, [round2(x.to), 'planner', O.state.viewer != null ? O.state.viewer : null, D.NOW]); });
    rec = { id: O.uid('PP'), at: D.NOW, by: O.state.viewer, pid: P.id, typeId: t ? t.id : null, planId: mp ? mp.id : null, option: option, name: name, n: list.length, units: ids, nights: {} };
    map = mp ? O.channel.rateMap() : null;
    list.forEach(function (x) {
      var y = rec.nights[x.iso] = { from: x.from, to: x.to, b: x.b }, a = snap(ids, x.iso, mp, map);
      if (canon(a) !== canon(afterOf(rec, y))) y.a = a;
    });
    b.pushes.unshift(rec);
    if (b.pushes.length > 30) b.pushes.length = 30;
    return rec;
  }
  function doPush(card, P, shown, vkey) {
    if (!canChange()) { U.toast(WHY_CHANGE, 'bad'); return; }
    /* prices can change through sync while the dialog is open: push only what the dialog showed */
    var vv = viewFor(P.id);
    if (st.pid !== P.id || !vv.fresh || vv.key !== vkey) {
      U.toast('Prices or bookings changed while this was open. Check the plans again before you push.', 'bad');
      if (st.pid === P.id && O.state.page === 'planner') schedule(30);
      return;
    }
    var list = pushNights(card, P);
    if (!list.length) { U.toast('Nothing to push: every night in this plan already has that price.'); return; }
    if (canon(list) !== canon(shown)) { U.toast('Some prices changed while this was open. Check the preview again before you push.', 'bad'); return; }
    var mp = mainPlanOf(P), sc = scopeOf(P), isos = list.map(function (x) { return x.iso; });
    writePush(P, mp, list, card.key, card.key === 'custom' ? 'Your own mix' : card.name);
    if (!Array.isArray(D.priceLog)) D.priceLog = [];
    D.priceLog.unshift({ at: D.NOW, pid: P.id, n: list.length, by: (O.viewer() || {}).name || '', how: card.key === 'custom' ? 'Your own mix from the profit planner' : card.name + ' plan from the profit planner', first: isos[0], last: isos[isos.length - 1] });
    audit('Pushed ' + planWords(card) + ' from the profit planner: ' + fmt.plural(list.length, 'nightly price') + ' (' + rangeText(isos) + ') for ' + (sc.many ? sc.short : P.name));
    U.toast(fmt.plural(list.length, 'new price') + ' saved for ' + sc.short + '. ' + channelNote(P, !!mp));
    O.emit('data', { type: 'pricing' });
  }
  /* what Undo would do now, night by night: back (exactly as the push left it), done (as before the push: put back by
     hand, or by an Undo on another device), later (a later push, not undone, holds it: undoing that push first brings back
     this one's price), kept (changed since, keeps its newer price), gone (passed). Nights already undone are left out */
  function undoPlan(rec) {
    var list = pushList(), idx = list.indexOf(rec), T = D.TODAY, ids = recIds(rec), plan = recPlan(rec), map = O.channel ? O.channel.rateMap() : null;
    var out = { ids: ids, plan: plan, back: [], done: [], later: [], kept: [], gone: 0, laterN: 0 }, by = {};
    Object.keys(rec.nights || {}).sort().forEach(function (iso) {
      var x = rec.nights[iso], i, nr, y;
      if (!x || x.doneAt) return;
      if (iso < T) { out.gone++; return; }
      if (!x.b) { out.kept.push(iso); return; }
      if (isAt(afterOf(rec, x), iso, ids, plan, map)) { out.back.push(iso); return; }
      if (isAt(x.b, iso, ids, plan, map)) { out.done.push(iso); return; }
      for (i = idx - 1; i >= 0; i--) {
        nr = list[i]; y = nr.nights && nr.nights[iso];
        if (!y || nr.undoneAt || y.doneAt || !y.b) continue;
        if (isAt(afterOf(nr, y), iso, recIds(nr), recPlan(nr), map)) { out.later.push(iso); by[nr.id] = 1; return; }
      }
      out.kept.push(iso);
    });
    out.laterN = Object.keys(by).length;
    return out;
  }
  /* the nights back to the push's snapshot from before it: the plan's own price first (setDays: the plan's days, and on a
     main plan every unit of its type), then each unit exactly as it was, the units setDays wrote that the push did not
     (added to the type since) as they were, and the model days that follow a unit's price */
  function putBack(rec, isos, ids, plan) {
    var keep = [], byP = {}, types = {};
    if (plan) {
      if (plan.primary && O.unitsOfType) O.unitsOfType(plan.unitTypeId).forEach(function (un) {
        if (ids.indexOf(un.id) < 0) isos.forEach(function (iso) { keep.push([un.id, iso, unitState(un.id, iso)]); });
      });
      isos.forEach(function (iso) { var p = rec.nights[iso].b.p > 0 ? rec.nights[iso].b.p : 0; (byP[p] = byP[p] || []).push(iso); });
      O.channel.setDays(Object.keys(byP).map(function (p) { return { planId: plan.id, dates: byP[p], set: { rate: +p > 0 ? +p : null } }; }), { emit: false, audit: false });
      types[plan.unitTypeId] = 1;
    }
    isos.forEach(function (iso) { var b = rec.nights[iso].b; ids.forEach(function (id) { putUnit(id, iso, stateIn(b, id)); }); });
    keep.forEach(function (k) { putUnit(k[0], k[1], k[2]); });
    ids.forEach(function (id) { var u = D.propById[id]; if (u && u.unitTypeId) types[u.unitTypeId] = 1; });
    if (rec.typeId) types[rec.typeId] = 1;
    if (O.channel && Object.keys(types).length) O.channel.fill(Object.keys(types));
  }
  /* nights marked undone, one by one (the save merge keeps each night's mark, whichever device made it); the push is
     undone once no night still to come is left, or when the owner marks it so */
  function markDone(rec, isos, all) {
    var T = D.TODAY, left;
    isos.forEach(function (iso) { rec.nights[iso].doneAt = D.NOW; });
    rec.changedAt = stamp(rec.changedAt);
    left = Object.keys(rec.nights || {}).filter(function (iso) { return iso >= T && rec.nights[iso] && !rec.nights[iso].doneAt; }).length;
    if (!left || all) { rec.undoneAt = D.NOW; rec.undoneBy = O.state.viewer; }
    return left;
  }
  function partlyUndone(rec) { var ns = rec.nights || {}; return !rec.undoneAt && Object.keys(ns).some(function (iso) { return ns[iso] && ns[iso].doneAt; }); }
  /* whose prices an Undo writes, in its words */
  function whoOf(rec, ids, P) {
    var t = rec.typeId && O.unitType ? O.unitType(rec.typeId) : null, n = t ? histUnits(t) : 0, u1, only, w;
    if (ids.length > 1) { w = t ? (ids.length === n ? allUnits(n, t.name) : ids.length + ' ' + t.name + ' units') : fmt.plural(ids.length, 'unit'); return { who: w, full: w }; }
    u1 = D.propById[ids[0]] || P; only = n > 1 ? ' only' : '';
    return { who: (u1.short || u1.name) + only, full: u1.name + only };
  }
  function laterWords(u) { return u.laterN > 1 ? 'later pushes' : 'a later push'; }
  function undoAsk(u, w) {
    var n = u.back.length, out = ['Put back the prices from before this push on ' + fmt.plural(n, 'night') + ' for ' + w.who + '?'];
    if (u.plan && !(u.plan.primary && mainPlanOf(D.propById[u.ids[0]]) === u.plan)) out.push(u.plan.name + ', the rate plan the push went to, gets its prices from before the push back on these nights too.');
    if (u.later.length) out.push(fmt.plural(u.later.length, 'night was', 'nights were') + ' changed again by ' + laterWords(u) + '. Undo ' + (u.laterN > 1 ? 'those' : 'that one') + ' first to put ' + (u.later.length === 1 ? 'it' : 'them') + ' back.');
    if (u.kept.length) out.push(fmt.plural(u.kept.length, 'night was', 'nights were') + ' changed after the push and ' + (u.kept.length === 1 ? 'keeps its' : 'keep their') + ' newer price.');
    if (u.gone) out.push(fmt.plural(u.gone, 'night has', 'nights have') + ' passed.');
    return out.join(' ');
  }
  function findPush(id) { return pushList().filter(function (x) { return x.id === id; })[0] || null; }
  /* nothing to put back now: a later push holds the nights, every night left was changed since (the owner can mark the
     push as undone), or every night left already has its price from before the push or has passed */
  function closeOut(rec, u, P, w) {
    if (u.later.length) { U.toast(cap1(fmt.plural(u.later.length, 'night of this push was', 'nights of this push were')) + ' changed again by ' + laterWords(u) + '. Undo ' + (u.laterN > 1 ? 'those' : 'that one') + ' first, then this one.', 'bad'); return; }
    if (!u.kept.length) {
      if (!u.done.length && !partlyUndone(rec)) { U.toast('These nights have passed, so there is nothing to put back.', 'bad'); return; }
      markDone(rec, u.done, true);
      audit('Marked a profit planner push for ' + w.full + ' as undone: every night left has its price from before the push or has passed');
      U.toast('Every night left already has its price from before the push or has passed, so this push is now marked as undone.');
      O.emit('data', { type: 'pricing' });
      return;
    }
    var id = rec.id, k0 = canon(u);
    U.confirm('Mark this push as undone? ' + (u.kept.length === 1 ? 'The night left was' : 'Every night left was') + ' changed after the push and keeps its newer price, so nothing goes back.' + (u.gone ? ' ' + fmt.plural(u.gone, 'night has', 'nights have') + ' passed.' : ''), 'Mark as undone').then(function (ok) {
      if (!ok) return;
      rec = findPush(id);
      if (!rec || rec.undoneAt) return;
      var u2 = undoPlan(rec);
      if (canon(u2) !== k0) { U.toast('Prices changed while this was open. Press Undo again to see what it would put back.', 'bad'); return; }
      markDone(rec, u2.done, true);
      audit('Marked a profit planner push for ' + w.full + ' as undone: ' + fmt.plural(u2.kept.length, 'night keeps its', 'nights keep their') + ' newer price');
      U.toast('This push is marked as undone. ' + cap1(fmt.plural(u2.kept.length, 'night keeps its', 'nights keep their')) + ' newer price.');
      O.emit('data', { type: 'pricing' });
    });
    focusDialog();
  }
  function undoPush(id) {
    if (!canChange()) { U.toast(WHY_CHANGE, 'bad'); return; }
    if (O.$('.modal-back')) return;   /* one dialog at a time */
    var rec = findPush(id); if (!rec || rec.undoneAt) return;
    var P = D.propById[rec.pid]; if (!P) { U.toast('That unit is no longer in Orbique, so this push cannot be undone.', 'bad'); return; }
    var u0 = undoPlan(rec), w = whoOf(rec, u0.ids, P);
    if (!u0.back.length) { closeOut(rec, u0, P, w); return; }
    U.confirm(undoAsk(u0, w), 'Undo push').then(function (ok) {
      if (!ok) return;
      /* the push history may have arrived from another device while the dialog was open (new objects): work on the record
         as it is now. The dialog may also have been confirmed twice, or prices or rate plans may have changed */
      rec = findPush(id);
      if (!rec) { U.toast('The push history changed while this was open. Press Undo again to see what it would put back.', 'bad'); return; }
      if (rec.undoneAt) return;
      var u = undoPlan(rec);
      if (canon(u.back) !== canon(u0.back) || canon(u.ids) !== canon(u0.ids) || (u.plan && u.plan.id) !== (u0.plan && u0.plan.id)) {
        U.toast('Prices changed while this was open. Press Undo again to see what it would put back.', 'bad'); return;
      }
      putBack(rec, u.back, u.ids, u.plan);
      /* a night counts as undone once it shows exactly what it had before the push */
      var map = O.channel ? O.channel.rateMap() : null, okIsos = [], bad = 0;
      u.back.forEach(function (iso) { if (isAt(rec.nights[iso].b, iso, u.ids, u.plan, map)) okIsos.push(iso); else bad++; });
      var left = markDone(rec, okIsos.concat(u.done)), n = okIsos.length;
      rec.undoneN = (rec.undoneN || 0) + n;
      if (n) {
        if (!Array.isArray(D.priceLog)) D.priceLog = [];
        D.priceLog.unshift({ at: D.NOW, pid: P.id, n: n, by: (O.viewer() || {}).name || '', how: 'Profit planner push undone', first: okIsos[0], last: okIsos[n - 1] });
      }
      var parts = [];
      if (n) parts.push(fmt.plural(n, 'nightly price') + ' (' + rangeText(okIsos) + ') back to what ' + (n === 1 ? 'it was' : 'they were') + ' for ' + w.full);
      if (bad) parts.push(fmt.plural(bad, 'night') + ' could not be put back');
      if (u.later.length) parts.push(fmt.plural(u.later.length, 'night waits', 'nights wait') + ' for ' + laterWords(u) + ' to be undone');
      if (u.kept.length) parts.push(fmt.plural(u.kept.length, 'night keeps its', 'nights keep their') + ' newer price');
      audit('Undid a profit planner push: ' + parts.join('; '));
      var msg = [];
      if (n) msg.push('Prices from before the push are back on ' + fmt.plural(n, 'night') + ' for ' + w.who + '.');
      if (bad) msg.push(cap1(fmt.plural(bad, 'night')) + ' could not be put back. Check ' + (bad === 1 ? 'it' : 'them') + ' in Pricing, then press Undo again.');
      if (u.later.length) msg.push('Undo ' + laterWords(u).replace(/^a /, 'the ') + ', then this one again, for the other ' + fmt.plural(u.later.length, 'night') + '.');
      else if (left && u.kept.length) msg.push(cap1(fmt.plural(u.kept.length, 'night keeps its', 'nights keep their')) + ' newer price, so the push stays in the history as partly undone.');
      U.toast(msg.join(' ') + (n ? ' ' + channelNote(P, !!u.plan) : ''), bad ? 'bad' : undefined);
      O.emit('data', { type: 'pricing' });
    });
    focusDialog();
  }

  /* ------------------------------------------------------------------ page */
  O.page('planner', {
    desc: 'The nightly rates a unit needs to cover its costs and make your profit, with plans to compare and push',
    render: function (root, ctx) {
      var p0 = ctx.params || {}, units = unitList();
      ctx.onLeave(function () { clearTimeout(st.timer); st.timer = null; if (st.ro) { try { st.ro.disconnect(); } catch (e) { /* gone */ } st.ro = null; } });
      if (!units.length) {
        ctx.setActions('');
        var canAdd = O.allowed('properties') && O.can('properties.create');
        root.innerHTML = '<div class="pg-planner"><div class="card"><div class="empty"><div class="e-icon">' + O.icon('planner') + '</div><p style="margin:0 0 12px">Add a unit to plan the nightly rates that cover its costs and make your profit.</p>' +
          (canAdd ? '<button type="button" class="btn btn-primary" data-go-props>' + O.icon('plus') + 'Add a unit</button>' : '') + '</div></div></div>';
        var gb = O.$('[data-go-props]', root); if (gb) gb.onclick = function () { O.go('properties'); };
        return;
      }
      if (p0.propertyId && ctx.fresh && units.some(function (u) { return u.id === p0.propertyId; })) st.pid = p0.propertyId;
      if (!units.some(function (u) { return u.id === st.pid; })) st.pid = units[0].id;
      ctx.fresh = false;
      /* keep the cursor where it was when something else redraws the page */
      var ae = document.activeElement, focusId = ae && root.contains(ae) && ae.id ? ae.id : null, sel = null, fk = focusId ? null : focusKeys(ae, root);
      try { if (focusId && ae.selectionStart != null) sel = [ae.selectionStart, ae.selectionEnd]; } catch (e) { sel = null; }
      var pid = st.pid, P = D.propById[pid], dr = draft(pid), t = typeOf(P), T = D.TODAY;
      CUR = P;
      if (st.res && st.res.pid !== pid) { st.sel = null; st.slide = null; }
      /* a date that has passed since (the page left open overnight) reads as the default, as horizonEnd plans it */
      var hz = validHorizon(dr.horizon) || 'next90', end = horizonEnd(dr.horizon), sc = scopeOf(P, end), isUntil = !HORIZONS.some(function (h) { return h[0] === hz; });
      var occ = occIndex(pid), nN = d.diff(T, end) + 1, nB = 0, nK = 0;
      d.range(T, end).forEach(function (iso) { if (occ.booked[iso]) nB++; else if (occ.blocked[iso]) nK++; });
      var bd = t ? O.building(t.buildingId) : null;

      root.innerHTML = '<div class="pg-planner" data-pid="' + esc(pid) + '">' +
        '<div class="toolbar"><select class="select pp-prop" data-prop aria-label="Unit" title="' + esc(unitLabel(P)) + '">' + units.map(function (u) { return '<option value="' + esc(u.id) + '"' + (u.id === pid ? ' selected' : '') + '>' + esc(unitLabel(u)) + '</option>'; }).join('') + '</select>' +
        '<select class="select pp-hz" data-hz aria-label="Dates">' + HORIZONS.map(function (h) { return '<option value="' + h[0] + '"' + (hz === h[0] ? ' selected' : '') + '>' + h[1] + '</option>'; }).join('') + '<option value="until"' + (isUntil ? ' selected' : '') + '>Until a date…</option></select>' +
        (isUntil ? '<input type="date" class="input pp-until" data-until aria-label="Last night to plan" min="' + d.add(T, 1) + '" max="' + d.add(T, MAX_DAYS - 1) + '" value="' + end + '">' : '') +
        '<span class="pp-saved" data-saved></span></div>' +
        '<div class="pp-ctx">' + (t ? '<b>' + esc(t.name) + '</b><span class="dot" aria-hidden="true"></span> ' + esc(sc.many ? sc.ctx : sc.line) + (bd ? '<span class="dot" aria-hidden="true"></span> ' + esc(bd.name) : '') : '<b>' + esc(P.type || P.name) + '</b>' + (P.area ? '<span class="dot" aria-hidden="true"></span> ' + esc(P.area) : '')) +
        '<span class="dot" aria-hidden="true"></span> ' + esc(U.rangeLabel(T, end)) + ': ' + fmt.plural(nN, 'night') + ', ' + (nN - nB - nK) + ' open, ' + nB + ' booked' + (nK ? ', ' + nK + ' blocked' : '') + '</div>' +
        '<div class="pp-results"><div class="pp-top">' + costsCard(P, dr) + '<div class="pp-right"></div></div><div class="pp-body stack"></div></div>' +
        '<div class="pp-bottom">' + historyCard(P) + asmCard(dr) + '</div>' +
        '</div>';
      var pg = O.$('.pg-planner', root);
      paintSaved(pg, pid);
      paintResults();
      if (focusId) {
        var fe = document.getElementById(focusId);
        if (fe) {
          try { fe.focus({ preventScroll: true }); } catch (e) { /* gone */ }
          /* number inputs have no selection: setting the value again puts the cursor at its end, after what was typed */
          try { if (sel) fe.setSelectionRange(sel[0], sel[1]); else if (fe.type === 'number') { var fv = fe.value; fe.value = ''; fe.value = fv; } } catch (e) { /* no selection on this input */ }
        }
      } else if (fk) refocus(fk, root);

      var v = viewFor(pid);
      if (v.has && !v.fresh && !(v.err)) schedule(v.res ? 250 : 30);
      ctx.setActions('<button type="button" class="btn btn-ghost btn-sm" data-pp-pricing>' + O.icon('pricing') + 'Pricing</button>');
      var gp = O.$('[data-pp-pricing]', ctx.actionsEl); if (gp) gp.onclick = function () { O.go('pricing', { propertyId: pid }); };

      /* ------------------------------------------------------------------ events */
      function edited(delay) {
        O.$('[data-totals]', pg).innerHTML = totalsHTML(dr);
        paintSaved(pg, pid);
        if (hasInputs(dr)) schedule(delay); else { clearTimeout(st.timer); paintResults(); }
      }
      function setAsm(a, val, i) {
        var def = R.DEFAULTS[a.key];
        if (a.unit === 'list') {
          var arr = (dr.asm[a.key] || def).slice(); arr[i] = val;
          if (arr.every(function (x, k) { return Math.abs(x - def[k]) < 1e-9; })) delete dr.asm[a.key]; else dr.asm[a.key] = arr;
        } else if (Math.abs(val - def) < 1e-9) delete dr.asm[a.key]; else dr.asm[a.key] = val;
      }
      pg.addEventListener('input', function (e) {
        var x = e.target, a;
        if (x.matches('[data-cost]')) { dr.costs[x.getAttribute('data-cost')] = x.value; edited(); }
        else if (x.matches('[data-target]')) { dr.target = x.value; edited(); }
        else if (x.matches('[data-limit]')) { dr[x.getAttribute('data-limit')] = x.value; markLimits(); edited(); }
        else if (x.matches('[data-asm]')) {
          a = asmOf(x.getAttribute('data-asm')); var val = parsedVal(a, x.value); if (val == null) return;
          if (a.key === 'paybackMonths') val = Math.round(val);
          setAsm(a, val);
          O.$$('[data-asm="' + a.key + '"]', pg).forEach(function (y) { if (y !== x) y.value = shownVal(a, val); });
          markAsm(a.key); edited();
        } else if (x.matches('[data-asm-list]')) {
          a = asmOf(x.getAttribute('data-asm-list')); var lv = parsedVal(a, x.value); if (lv == null) return;
          setAsm(a, lv, +x.getAttribute('data-i')); markAsm(a.key); edited();
        } else if (x.matches('[data-slide]')) slideTo(+x.value);
      });
      pg.addEventListener('change', function (e) {
        var x = e.target;
        if (x.matches('[data-prop]')) { st.pid = x.value; st.sel = null; st.slide = null; ctx.rerender(); window.scrollTo(0, 0); }
        else if (x.matches('[data-hz]')) { dr.horizon = x.value === 'until' ? d.add(T, 119) : x.value; ctx.rerender(); }
        else if (x.matches('[data-until]')) {
          /* a typed date outside the field's own limits goes to the nearest one */
          if (/^\d{4}-\d{2}-\d{2}$/.test(x.value)) { var lo = d.add(T, 1), hi = d.add(T, MAX_DAYS - 1); dr.horizon = x.value < lo ? lo : x.value > hi ? hi : x.value; ctx.rerender(); }
        }
        else if (x.matches('[data-asm]')) { var a = asmOf(x.getAttribute('data-asm')), v2 = dr.asm[a.key] != null ? dr.asm[a.key] : R.DEFAULTS[a.key]; x.value = shownVal(a, v2); markAsm(a.key); }
        else if (x.matches('[data-asm-list]')) { var al = asmOf(x.getAttribute('data-asm-list')), arr = dr.asm[al.key] || R.DEFAULTS[al.key]; x.value = shownVal(al, arr[+x.getAttribute('data-i')]); markAsm(al.key); }
        else if (x.matches('[data-cost]') && Number(x.value) < 0) { x.value = ''; dr.costs[x.getAttribute('data-cost')] = ''; edited(); }
        else if (x.matches('[data-limit]') && Number(x.value) < 0) { x.value = ''; dr[x.getAttribute('data-limit')] = ''; markLimits(); edited(); }
      });
      /* the price limits' warning, after typing in them */
      function markLimits() {
        var bad = !limitsOf(dr).ok, msg = O.$('[data-lim-err]', pg);
        if (msg) msg.hidden = !bad;
        O.$$('[data-limit]', pg).forEach(function (y) {
          y.parentNode.classList.toggle('bad', bad);
          if (bad) { y.setAttribute('aria-invalid', 'true'); y.setAttribute('aria-describedby', 'pp-l-err'); } else { y.removeAttribute('aria-invalid'); y.removeAttribute('aria-describedby'); }
        });
      }
      /* the Changed tag and Reset button of an assumption, after typing in it */
      function markAsm(key) {
        var row = O.$('[data-arow="' + key + '"] .al', pg); if (!row) return;
        var tag = O.$('.row-flex', row), ch = dr.asm[key] != null;
        if (ch && !tag) row.insertAdjacentHTML('beforeend', '<span class="row-flex"><span class="pill accent">Changed</span><button type="button" class="btn btn-quiet btn-xs" data-asm-reset="' + key + '">Reset</button></span>');
        else if (!ch && tag) tag.remove();
        var n = Object.keys(dr.asm).length, sub = O.$('details.pp-asm > summary .sub', pg), all = O.$('[data-asm-reset-all]', pg);
        if (sub) sub.textContent = asmSub(n);
        if (all) all.disabled = !n;
      }
      pg.addEventListener('submit', function (e) {
        if (!e.target.matches('[data-costs]')) return;
        e.preventDefault();
        var vS = toSave(dr), b = ownBlob();
        if (!hasInputs(dr)) { U.toast('Enter at least one cost or a profit target to save', 'bad'); return; }
        if (!limitsOf(dr).ok) { U.toast('Never above needs to be higher than Never below. Fix the price limits, then save.', 'bad'); var lc = O.$('#pp-l-ceiling', pg); if (lc) lc.focus(); return; }
        b.units[pid] = { costs: vS.costs, profitPerMonth: vS.profitPerMonth, assumptions: vS.assumptions, horizon: vS.horizon, keepPeaks: vS.keepPeaks, floor: vS.floor, ceiling: vS.ceiling, updatedAt: stamp(b.units[pid] && b.units[pid].updatedAt), by: O.state.viewer };
        dr.base = canon(toSave(dr));
        /* the activity log is seen by staff: the costs and the target stay out of it */
        audit('Saved the profit planner costs and target for ' + P.name);
        U.toast('Costs and target saved for ' + (P.short || P.name) + '. Only account owners see them.');
        O.emit('data', { type: 'planner' });
      });
      pg.addEventListener('toggle', function (e) { if (e.target.matches && e.target.matches('details.pp-asm')) st.asmOpen = e.target.open; }, true);
      pg.addEventListener('click', function (e) {
        var x = e.target.closest('button'); if (!x || x.disabled) return;
        if (x.matches('[data-discard]')) { delete st.drafts[pid]; ctx.rerender(); return; }
        if (x.matches('[data-preview]')) { openPreview(x.getAttribute('data-preview')); return; }
        if (x.matches('[data-push]')) { var vv = viewFor(pid); if (vv.res && vv.fresh) confirmPush(vv, x.getAttribute('data-push')); else U.toast('The plans are still being worked out. Try again in a moment.'); return; }
        if (x.matches('[data-pview]')) { st.view = x.getAttribute('data-pview'); paintResults(); return; }
        if (x.matches('[data-nview]')) { st.nights = x.getAttribute('data-nview'); paintResults(); return; }
        if (x.matches('[data-keep-peaks]')) { dr.keepPeaks = !dr.keepPeaks; x.classList.toggle('on', dr.keepPeaks); x.setAttribute('aria-checked', dr.keepPeaks ? 'true' : 'false'); paintSaved(pg, pid); schedule(120); return; }
        if (x.matches('[data-undo]')) { undoPush(x.getAttribute('data-undo')); return; }
        if (x.matches('[data-asm-reset]')) { delete dr.asm[x.getAttribute('data-asm-reset')]; st.asmOpen = true; ctx.rerender(); return; }
        if (x.matches('[data-asm-reset-all]')) { dr.asm = {}; st.asmOpen = true; ctx.rerender(); return; }
      });
      /* the slider: R.evaluate for the plan under the thumb, at most once a frame */
      var raf = null, want = null;
      function slideTo(i) {
        want = i;
        if (raf) return;
        raf = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
          raf = null;
          var vv = viewFor(pid); if (!vv.res || !st.slide) return;
          var card = evalAt(vv, want); if (!card) return;
          st.slide.i = want; st.slide.card = card;
          var out = O.$('.pp-ft-out', pg), pcEl = O.$('.pp-ft-pc', pg), rg = O.$('[data-slide]', pg);
          if (out) out.innerHTML = ftOutHTML(card, vv.res);
          if (pcEl) pcEl.innerHTML = pcHTML(card);
          if (rg) rg.setAttribute('aria-valuetext', pct(card.stats.occ) + ' of nights sold');
          if (st.sel === 'custom') { var pv = O.$('#pp-preview', pg); if (pv) pv.outerHTML = previewCard(vv); }
        });
      }
    }
  });
})();
