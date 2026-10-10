/* Orbique Command Center v3 — Dashboard
   Hero: month-to-date revenue (day 1 → today) compared with the same days in the two previous months.
   Today: same-day bookings (separate from the morning's arrivals), check-ins, check-outs, open tasks with reassignment.
   Depth: KPI strip, next-14-nights heat strip, booking pace, revenue by property, channel mix, alerts.
   Money panels are owner-only (U.locked for everyone else). */
(function () {
  var O = window.O, D = O.data, M = O.metrics, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  var st = { mode: 'earned', span: 'mtd', chart: 'cum' };

  /* ------------------------------------------------------------------ styles */
  O.css('dashboard', `
.pg-dashboard{display:flex;flex-direction:column;gap:14px;}
.pg-dashboard svg.ico{width:14px;height:14px;flex-shrink:0;}
.pg-dashboard .kpis{margin-bottom:0;gap:8px;}
.pg-dashboard .kpi{padding:10px 11px;}
.pg-dashboard .kpi .k-val small{font-size:12px;font-weight:700;color:var(--muted);margin-left:3px;}

/* brief */
.pg-dashboard .dsh-brief{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
.pg-dashboard .dsh-brief h2{font-size:17px;font-weight:800;}
.pg-dashboard .dsh-brief p{margin:2px 0 0;font-size:13px;color:var(--text-2);}
.pg-dashboard .dsh-now{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--muted);background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:5px 11px;white-space:nowrap;}

/* card head extras */
.pg-dashboard .card-head .hd{min-width:0;flex:1 1 260px;}
.pg-dashboard .card-head .count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--accent);color:var(--accent-ink);box-shadow:inset 0 0 0 1px var(--accent-text);font-size:11px;font-weight:800;margin-left:7px;vertical-align:2px;}
.pg-dashboard .card-head .count.muted-c{background:var(--surface-2);color:var(--text-2);box-shadow:inset 0 0 0 1px var(--border);}
.pg-dashboard .dsh-link{background:none;border:none;padding:0;font:inherit;font-weight:700;color:var(--text);text-align:left;cursor:pointer;}
.pg-dashboard .dsh-link:hover{color:var(--brand-text);text-decoration:underline;}
.pg-dashboard .ib{width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border);background:var(--surface);border-radius:8px;color:var(--text-2);flex-shrink:0;padding:0;}
.pg-dashboard .ib:hover{background:var(--surface-2);border-color:var(--border-strong);color:var(--text);}
.pg-dashboard .ib svg{width:15px;height:15px;}
.pg-dashboard .dsh-col-h{font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;}
.pg-dashboard .key{display:inline-block;width:14px;height:3px;border-radius:2px;flex-shrink:0;vertical-align:middle;}
.pg-dashboard .key.k0{background:var(--brand-strong);}
.pg-dashboard .key.k1{background:var(--c-prev1);}
.pg-dashboard .key.k2{background:var(--c-prev2);}
.pg-dashboard .key.kd{background:repeating-linear-gradient(90deg,var(--brand-strong) 0 4px,transparent 4px 7px);}
.pg-dashboard .dsh-insight{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--text-2);margin-top:12px;line-height:1.5;}
.pg-dashboard .dsh-insight svg{width:15px;height:15px;color:var(--brand-strong);flex-shrink:0;margin-top:2px;}
.pg-dashboard .dsh-legend{display:flex;gap:6px 14px;flex-wrap:wrap;font-size:11.5px;color:var(--text-2);font-weight:600;margin-top:12px;}
.pg-dashboard .dsh-legend span{display:inline-flex;align-items:center;gap:6px;}
.pg-dashboard .dsh-legend i{width:12px;height:12px;border-radius:3px;display:inline-block;flex-shrink:0;}
.pg-dashboard .lg-tick{display:inline-block;width:3px;height:12px;background:var(--text-2);border-radius:1px;}

/* hero: month-to-date revenue */
.pg-dashboard .dsh-hero .card-head{align-items:flex-start;}
.pg-dashboard .dsh-tiles{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr);gap:10px;margin-bottom:18px;}
.pg-dashboard .dsh-tile{border:1px solid var(--border);border-radius:10px;padding:11px 13px;min-width:0;background:var(--surface);}
.pg-dashboard .dsh-tile.cur{border-color:var(--brand-strong);background:var(--brand-soft-2);box-shadow:inset 3px 0 0 var(--brand-strong);}
.pg-dashboard .dsh-tile.out{background:var(--surface-2);}
.pg-dashboard .dsh-tile .t-label{display:flex;align-items:center;gap:7px;font-size:11.5px;font-weight:700;color:var(--muted);}
.pg-dashboard .dsh-tile .t-val{font-family:var(--font-head);font-weight:800;font-size:22px;margin-top:4px;letter-spacing:-0.01em;white-space:nowrap;font-variant-numeric:tabular-nums;}
.pg-dashboard .dsh-tile.cur .t-val{font-size:30px;line-height:1.1;}
.pg-dashboard .dsh-tile .t-line{font-size:12px;margin-top:4px;color:var(--text-2);display:flex;gap:4px 10px;flex-wrap:wrap;}
.pg-dashboard .dsh-tile .t-foot{font-size:11.5px;color:var(--muted);margin-top:6px;line-height:1.45;}
.pg-dashboard .dsh-hb{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.12fr);gap:24px;align-items:start;}
.pg-dashboard .dsh-chart-ctl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;}
.pg-dashboard .dsh-chart-ctl .seg button{padding:5px 10px;font-size:12px;}
.pg-dashboard .dsh-chart-ctl .legend{margin-left:auto;}
.pg-dashboard .dsh-foot{font-size:11.5px;color:var(--muted);margin-top:10px;line-height:1.5;}
.pg-dashboard .dsh-cmp{font-size:12.5px;}
.pg-dashboard .dsh-cmp th, .pg-dashboard .dsh-cmp td{padding:6px 9px;}
.pg-dashboard .dsh-cmp td.num, .pg-dashboard .dsh-cmp th.num{white-space:nowrap;}
.pg-dashboard .dsh-cmp th .key{margin-right:5px;}
.pg-dashboard .dsh-cmp td:first-child{color:var(--text-2);font-weight:600;min-width:118px;}
.pg-dashboard .dsh-cmp td.cur{font-weight:800;color:var(--text);}
.pg-dashboard .dsh-cmp tr.grp td{background:var(--surface-2);font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);padding-top:7px;padding-bottom:5px;}
.pg-dashboard .dsh-cmp tr.grp.on td{background:var(--brand-soft);color:var(--brand-text);}
.pg-dashboard .dsh-cmp tr.in td{background:var(--brand-soft-2);}

/* same-day bookings */
.pg-dashboard .dsh-sameday{border-color:var(--brand-strong);box-shadow:inset 0 3px 0 var(--brand-strong),var(--shadow);overflow:hidden;}
.pg-dashboard .dsh-sameday > .card-head{background:var(--brand-soft-2);}
.pg-dashboard .dsh-sameday .pill svg{width:12px;height:12px;}
.pg-dashboard .dsh-sd{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr);gap:12px 22px;padding:14px 16px;border-bottom:1px solid var(--border);align-items:start;}
.pg-dashboard .dsh-who .nm{display:flex;align-items:center;gap:7px;font-size:14px;}
.pg-dashboard .dsh-who .sb{font-size:12px;color:var(--muted);margin-top:3px;line-height:1.4;}
.pg-dashboard .dsh-who .sb.b2b{color:var(--text-2);}
.pg-dashboard .dsh-tl-top{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:12px;color:var(--muted);white-space:nowrap;}
.pg-dashboard .dsh-tl-top b{color:var(--text);font-weight:800;font-variant-numeric:tabular-nums;}
.pg-dashboard .dsh-tl-track{position:relative;height:8px;border-radius:5px;background:var(--surface-2);border:1px solid var(--border);margin:7px 0 7px;}
.pg-dashboard .dsh-tl-track i{position:absolute;left:0;top:0;bottom:0;border-radius:5px;background:var(--brand-strong);}
.pg-dashboard .dsh-tl-track em{position:absolute;top:-4px;width:2px;height:14px;background:var(--text);border-radius:1px;transform:translateX(-1px);}
.pg-dashboard .dsh-tl-sub{font-size:11.5px;color:var(--muted);display:flex;justify-content:space-between;align-items:center;gap:4px 8px;flex-wrap:wrap;}
.pg-dashboard .dsh-owner .select{width:100%;padding-top:6px;padding-bottom:6px;font-size:12.5px;}
.pg-dashboard .dsh-owner .os{font-size:11.5px;color:var(--muted);margin-top:5px;line-height:1.4;}
.pg-dashboard .dsh-owner .warnline{font-size:12px;color:var(--warn);font-weight:700;}
.pg-dashboard .dsh-acts{grid-column:1 / -1;display:flex;gap:6px;flex-wrap:wrap;}
.pg-dashboard .dsh-note-line{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--muted);padding:9px 16px;background:var(--surface-2);}

/* arrivals and departures */
.pg-dashboard .dsh-row{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-bottom:1px solid var(--border);}
.pg-dashboard .dsh-row:last-child{border-bottom:none;}
.pg-dashboard .dsh-when{width:76px;flex-shrink:0;}
.pg-dashboard .dsh-when b{display:block;font-size:13.5px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap;}
.pg-dashboard .dsh-when span{display:block;font-size:11.5px;color:var(--muted);margin-top:1px;}
.pg-dashboard .dsh-row .nm{display:flex;align-items:center;gap:4px 7px;flex-wrap:wrap;}
.pg-dashboard .dsh-row .sb{font-size:12px;color:var(--muted);margin-top:2px;}
.pg-dashboard .dsh-row .ready{margin-top:6px;}
.pg-dashboard .dsh-row .own{display:flex;align-items:center;gap:6px 8px;margin-top:8px;flex-wrap:wrap;font-size:12px;color:var(--muted);}
.pg-dashboard .dsh-row .own .select{width:auto;max-width:100%;padding:5px 28px 5px 8px;font-size:12px;}
.pg-dashboard .dsh-row .row-flex{gap:6px;}

/* today's tasks (incomplete only) */
.pg-dashboard .dsh-g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start;}
.pg-dashboard .dsh-g2.stretch{align-items:stretch;}
.pg-dashboard .dsh-ta{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:14px;align-items:start;}
.pg-dashboard .dsh-task{display:grid;grid-template-columns:80px minmax(0,1fr) 180px 146px;gap:8px 12px;align-items:center;padding:11px 16px;border-bottom:1px solid var(--border);}
.pg-dashboard .dsh-task:last-child{border-bottom:none;}
.pg-dashboard .dsh-task.od{background:linear-gradient(90deg,var(--bad-soft),transparent 45%);box-shadow:inset 3px 0 0 var(--bad);}
.pg-dashboard .dsh-task.un{box-shadow:inset 3px 0 0 var(--warn);}
.pg-dashboard .dsh-task .due b{display:block;font-weight:800;font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap;}
.pg-dashboard .dsh-task .due span{display:block;font-size:11.5px;color:var(--muted);margin-top:1px;line-height:1.3;}
.pg-dashboard .dsh-task .due span.bad{color:var(--bad);font-weight:700;}
.pg-dashboard .dsh-task .due span.warn{color:var(--warn);font-weight:700;}
.pg-dashboard .dsh-task .tt{display:flex;align-items:center;gap:4px 7px;flex-wrap:wrap;font-weight:700;font-size:13px;}
.pg-dashboard .dsh-task .ts{font-size:12px;color:var(--muted);margin-top:2px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.pg-dashboard .dsh-task .select{width:100%;padding-top:6px;padding-bottom:6px;font-size:12.5px;}
.pg-dashboard .select.unassigned{border-color:var(--warn);background-color:var(--warn-soft);color:var(--warn);font-weight:700;}
.pg-dashboard .dsh-task .tact{display:flex;gap:6px;justify-content:flex-end;}
.pg-dashboard .dsh-task .tact .btn{min-height:32px;}

/* alerts */
.pg-dashboard .dsh-alerts{display:grid;grid-template-columns:minmax(0,1fr);}
.pg-dashboard .dsh-alert{display:flex;align-items:center;gap:11px;width:100%;background:none;border:none;border-bottom:1px solid var(--border);padding:10px 16px;text-align:left;min-height:52px;}
.pg-dashboard .dsh-alert:hover{background:var(--surface-2);}
.pg-dashboard .dsh-alert .ai{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.pg-dashboard .dsh-alert .ai svg{width:15px;height:15px;}
.pg-dashboard .dsh-alert .ai.bad{background:var(--bad-soft);color:var(--bad);}
.pg-dashboard .dsh-alert .ai.warn{background:var(--warn-soft);color:var(--warn);}
.pg-dashboard .dsh-alert .ai.info{background:var(--info-soft);color:var(--info);}
.pg-dashboard .dsh-alert .at{display:block;font-weight:700;font-size:13px;}
.pg-dashboard .dsh-alert .as{display:block;font-size:11.5px;color:var(--muted);margin-top:1px;line-height:1.35;}
.pg-dashboard .dsh-alert .an{font-family:var(--font-head);font-weight:800;font-size:17px;margin-left:auto;padding-left:8px;font-variant-numeric:tabular-nums;}
.pg-dashboard .dsh-alert .chev{width:14px;height:14px;color:var(--faint);flex-shrink:0;transform:rotate(-90deg);}

/* next 14 nights heat strip */
.pg-dashboard .dsh-heat{display:grid;grid-template-columns:122px repeat(14,minmax(0,1fr)) 40px;gap:3px 2px;align-items:center;font-size:12px;}
.pg-dashboard .dsh-heat .hn{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:6px;font-size:12px;}
.pg-dashboard .dsh-heat .hp{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;font-size:12px;}
.pg-dashboard .dsh-heat .hd{text-align:center;font-size:10px;color:var(--muted);line-height:1.15;padding:6px 0 3px;position:relative;}
.pg-dashboard .dsh-heat .hd b{display:block;font-size:11.5px;color:var(--text-2);}
.pg-dashboard .dsh-heat .hd.we b{color:var(--text);}
.pg-dashboard .dsh-heat .hd.today b{color:var(--brand-text);}
.pg-dashboard .dsh-heat .hd .ev{position:absolute;top:0;left:50%;margin-left:-3px;width:6px;height:6px;border-radius:50%;background:var(--accent-text);}
.pg-dashboard .dsh-heat .c{height:20px;border-radius:3px;border:none;padding:0;display:block;width:100%;}
.pg-dashboard .dsh-heat .c.bk{background:var(--brand-strong);cursor:pointer;}
.pg-dashboard .dsh-heat .c.bk:hover{opacity:0.8;}
.pg-dashboard .dsh-heat .c.pd{background:var(--brand-soft);box-shadow:inset 0 0 0 1.5px var(--brand-strong);cursor:pointer;}
.pg-dashboard .dsh-heat .c.bl, .pg-dashboard .dsh-legend i.bl{background:repeating-linear-gradient(135deg,var(--c-prev2) 0 2px,var(--st-block) 2px 5px);}
.pg-dashboard .dsh-heat .c.op, .pg-dashboard .dsh-legend i.op{background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--border);}
.pg-dashboard .dsh-heat .c.op.we, .pg-dashboard .dsh-legend i.op.we{background:radial-gradient(circle,var(--text-2) 0 1.6px,transparent 2.2px),var(--surface);box-shadow:inset 0 0 0 1px var(--border-strong);}
.pg-dashboard .dsh-heat .ft{text-align:center;font-size:10.5px;font-weight:700;color:var(--text-2);font-variant-numeric:tabular-nums;padding-top:5px;border-top:1px solid var(--border);}
.pg-dashboard .dsh-heat .ft.hn, .pg-dashboard .dsh-heat .ft.hp{font-size:11px;}
.pg-dashboard .dsh-heat .ft.hn{text-align:left;}
.pg-dashboard .dsh-heat .ft.hp{text-align:right;}
.pg-dashboard .dsh-heat .ftb{display:none;position:relative;height:16px;margin:0 1px;background:var(--surface-2);border-radius:2px;overflow:hidden;}
.pg-dashboard .dsh-heat .ftb i{position:absolute;left:0;right:0;bottom:0;background:var(--brand-strong);}

/* booking pace */
.pg-dashboard .dsh-mini{display:flex;gap:10px 22px;flex-wrap:wrap;margin-bottom:12px;}
.pg-dashboard .dsh-mini .mv{font-family:var(--font-head);font-weight:800;font-size:20px;font-variant-numeric:tabular-nums;white-space:nowrap;}
.pg-dashboard .dsh-mini .mv > .delta{font-size:15px;}
.pg-dashboard .dsh-mini .ml{font-size:11.5px;color:var(--muted);font-weight:600;}
.pg-dashboard .dsh-pace-legend{margin:8px 0 2px;}
.pg-dashboard .dsh-lead{margin-top:14px;padding-top:12px;border-top:1px solid var(--border);}
.pg-dashboard .dsh-lead .hbar{grid-template-columns:minmax(90px,120px) 1fr 92px;padding:4px 0;}

/* revenue by property (bullet rows) */
.pg-dashboard .dsh-bul{display:grid;grid-template-columns:minmax(92px,130px) minmax(0,1fr) 78px 64px;gap:10px;align-items:center;padding:5px 0;font-size:12.5px;}
.pg-dashboard .dsh-bul.h{font-size:10.5px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;padding-bottom:6px;border-bottom:1px solid var(--border);margin-bottom:3px;}
.pg-dashboard .dsh-bul .bn{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pg-dashboard .dsh-bul .bt{position:relative;height:12px;background:var(--surface-2);border-radius:3px;}
.pg-dashboard .dsh-bul .bt i{position:absolute;left:0;top:0;bottom:0;background:var(--brand-strong);border-radius:0 4px 4px 0;}
.pg-dashboard .dsh-bul .bt em{position:absolute;top:-3px;width:3px;height:18px;background:var(--text-2);border-radius:1px;border:1px solid var(--surface);transform:translateX(-1.5px);}
.pg-dashboard .dsh-bul .bv{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;}
.pg-dashboard .dsh-bul .bd{text-align:right;}
.pg-dashboard .dsh-bul.tot{border-top:1px solid var(--border);margin-top:4px;padding-top:8px;font-weight:800;}

/* channel mix */
.pg-dashboard .dsh-ch th, .pg-dashboard .dsh-ch td{padding:8px 10px;}
.pg-dashboard .dsh-ch td.num, .pg-dashboard .dsh-ch th.num{white-space:nowrap;}
.pg-dashboard .dsh-ch .shr{display:flex;align-items:center;gap:8px;}
.pg-dashboard .dsh-ch .shr b{width:34px;text-align:right;font-variant-numeric:tabular-nums;}
.pg-dashboard .dsh-ch .sharebar{flex:1;height:8px;background:var(--surface-2);border-radius:3px;min-width:50px;position:relative;overflow:hidden;}
.pg-dashboard .dsh-ch .sharebar i{position:absolute;left:0;top:0;bottom:0;background:var(--brand-strong);border-radius:0 3px 3px 0;}
.pg-dashboard .dsh-ch .rate{display:block;font-size:11px;color:var(--muted);font-weight:600;}

/* responsive */
@media (max-width:1400px){
  .pg-dashboard .kpi{padding:9px 9px;}
  .pg-dashboard .kpi .k-label, .pg-dashboard .kpi .k-sub{font-size:10.5px;}
  .pg-dashboard .kpi .k-val{font-size:18px;}
  .pg-dashboard .dsh-ch .sharebar{display:none;}
  .pg-dashboard .dsh-ch th, .pg-dashboard .dsh-ch td{padding:8px 8px;}
  .pg-dashboard .dsh-hb{grid-template-columns:minmax(0,1fr);}
  .pg-dashboard .dsh-ta{grid-template-columns:minmax(0,1fr);}
  .pg-dashboard .dsh-alerts{grid-template-columns:repeat(2,minmax(0,1fr));}
  .pg-dashboard .dsh-alerts .dsh-alert:nth-child(odd){border-right:1px solid var(--border);}
}
@media (max-width:1200px){
  .pg-dashboard .kpis{grid-auto-flow:row;grid-template-columns:repeat(4,minmax(0,1fr));}
  .pg-dashboard .dsh-tiles{grid-template-columns:repeat(2,minmax(0,1fr));}
}
@media (max-width:1100px){
  .pg-dashboard .dsh-g2{grid-template-columns:minmax(0,1fr);}
  .pg-dashboard .dsh-sd{grid-template-columns:repeat(2,minmax(0,1fr));}
}
@media (max-width:960px){
  .pg-dashboard .dsh-ch .sharebar{display:block;}
}
@media (max-width:760px){
  .pg-dashboard .dsh-sd{grid-template-columns:minmax(0,1fr);gap:14px;}
  .pg-dashboard .dsh-task{grid-template-columns:70px minmax(0,1fr);gap:8px 10px;}
  .pg-dashboard .dsh-task .asg, .pg-dashboard .dsh-task .tact{grid-column:2;}
  .pg-dashboard .dsh-task .tact{justify-content:flex-start;}
  .pg-dashboard .dsh-alerts{grid-template-columns:minmax(0,1fr);}
  .pg-dashboard .dsh-alerts .dsh-alert:nth-child(odd){border-right:none;}
  .pg-dashboard .dsh-chart-ctl .legend{margin-left:0;width:100%;}
  .pg-dashboard .dsh-cmp td:first-child, .pg-dashboard .dsh-cmp th:first-child,
  .pg-dashboard .dsh-ch td:first-child, .pg-dashboard .dsh-ch th:first-child{position:sticky;left:0;z-index:1;background:var(--surface);}
  .pg-dashboard .dsh-cmp th:first-child, .pg-dashboard .dsh-ch th:first-child{background:var(--surface-2);z-index:2;}
  .pg-dashboard .dsh-ch tfoot td:first-child{background:var(--surface-2);}
}
@media (max-width:560px){
  .pg-dashboard .btn-sm, .pg-dashboard .dsh-task .tact .btn{min-height:36px;}
  .pg-dashboard .btn-xs{min-height:32px;}
  .pg-dashboard .ib{width:36px;height:36px;}
  .pg-dashboard .dsh-task .select, .pg-dashboard .dsh-owner .select, .pg-dashboard .dsh-row .own .select{min-height:36px;}
  .pg-dashboard .kpis{grid-template-columns:repeat(2,minmax(0,1fr));}
  .pg-dashboard .dsh-heat .hn:not(.ft), .pg-dashboard .dsh-bul .bn{white-space:normal;line-height:1.15;overflow-wrap:anywhere;}
  .pg-dashboard .dsh-heat .hn:not(.ft){font-size:10.5px;}
  .pg-dashboard .dsh-ch .sharebar, .pg-dashboard .dsh-ch .vs, .pg-dashboard .dsh-ch .rl{display:none;}
  .pg-dashboard .dsh-ch th, .pg-dashboard .dsh-ch td{padding:8px 7px;}
  .pg-dashboard .dsh-tiles{grid-template-columns:repeat(2,minmax(0,1fr));}
  .pg-dashboard .dsh-tile.cur, .pg-dashboard .dsh-tile.out{grid-column:1 / -1;}
  .pg-dashboard .dsh-tile .t-val{font-size:18px;}
  .pg-dashboard .dsh-tile.cur .t-val{font-size:28px;}
  .pg-dashboard .dsh-hero .card-head .seg{display:flex;width:100%;flex-wrap:nowrap;}
  .pg-dashboard .dsh-hero .card-head .seg button{flex:1 1 0;min-width:0;padding:7px 4px;font-size:11.5px;white-space:nowrap;}
  .pg-dashboard .dsh-cmp{font-size:12px;}
  .pg-dashboard .dsh-cmp th, .pg-dashboard .dsh-cmp td{padding:6px 7px;}
  .pg-dashboard .dsh-cmp td:first-child{min-width:96px;}
  .pg-dashboard .dsh-heat{grid-template-columns:78px repeat(14,minmax(0,1fr)) 32px;gap:3px 1.5px;}
  .pg-dashboard .dsh-heat .hn{font-size:11px;padding-right:4px;}
  .pg-dashboard .dsh-heat .hd{font-size:8.5px;}
  .pg-dashboard .dsh-heat .hd b{font-size:10px;}
  .pg-dashboard .dsh-heat .hp{font-size:11px;}
  .pg-dashboard .dsh-heat .c{height:18px;}
  .pg-dashboard .dsh-heat .ftn{display:none;}
  .pg-dashboard .dsh-heat .ftb{display:block;}
  .pg-dashboard .dsh-bul{grid-template-columns:92px minmax(0,1fr) 66px 54px;gap:8px;font-size:12px;}
  .pg-dashboard .dsh-row{padding:12px 14px;}
  .pg-dashboard .dsh-when{width:64px;}
  .pg-dashboard .dsh-brief h2{font-size:16px;}
  .pg-dashboard .dsh-now{display:none;}
}
`);

  /* ------------------------------------------------------------------ helpers */
  function T() { return D.TODAY; }
  function sum(a, f) { return a.reduce(function (s, x) { return s + (f ? f(x) : x); }, 0); }
  function avg(a, f) { return a.length ? sum(a, f) / a.length : null; }
  function mins(iso) { return Date.parse(iso + ':00Z') / 6e4; } /* 'YYYY-MM-DDTHH:MM' → minutes */
  function dur(m) { m = Math.max(0, Math.round(m)); var h = Math.floor(m / 60), r = m % 60; return h ? h + 'h' + (r ? ' ' + r + 'm' : '') : r + 'm'; }
  function money(v) { return fmt.money(v); }
  function first(name) { var w = String(name).split(' '); return w.length > 2 ? w.slice(0, -1).join(' ') : w[0]; } /* 'Mei Fen Lim' → 'Mei Fen' */
  function prop(pid) { return D.propById[pid] || { short: 'General', name: 'General' }; }
  function staffName(id) { var s = D.staffById(id); return s ? s.name : 'Unassigned'; }
  function taskById(id) { return D.tasks.filter(function (k) { return k.id === id; })[0] || null; }
  /* bookings made by "now". The demo data stamps a couple of bookings later today (after 10:15), which have not happened yet. */
  function madeIn(from, to) { return M.bookingsCreated(from, to).filter(function (b) { return b.createdAt <= D.NOW; }); }
  /* signed change. kind: pct (relative, default) | pts (percentage points) | abs */
  function dl(cur, prev, o) {
    o = o || {};
    if (cur == null || prev == null || isNaN(cur) || isNaN(prev)) return '<span class="delta flat">–</span>';
    var diff = cur - prev, v, txt;
    if (o.kind === 'pts') { v = diff * 100; txt = Math.abs(v).toFixed(1) + ' pts'; }
    else if (o.kind === 'abs') { v = diff; txt = o.f ? o.f(Math.abs(diff)) : fmt.num(Math.abs(diff), o.dp); }
    else { if (!prev) return '<span class="delta flat">–</span>'; v = diff / Math.abs(prev); txt = (Math.abs(v) * 100).toFixed(1) + '%'; }
    var flat = Math.abs(v) < (o.kind === 'abs' ? 0.005 : o.kind === 'pts' ? 0.05 : 0.0005);
    var cls = flat || o.neutral ? 'flat' : ((o.invert ? v < 0 : v > 0) ? 'good' : 'bad');
    return '<span class="delta ' + cls + '">' + (flat ? '± ' : v > 0 ? '▲ ' : '▼ ') + txt + (o.suffix ? ' ' + esc(o.suffix) : '') + '</span>';
  }
  function pctChangeText(cur, prev) { if (!prev) return '–'; return fmt.changeText((cur - prev) / Math.abs(prev)); }

  /* ------------------------------------------------------------------ periods & stats */
  function periods() {
    var t = T(), day = d.day(t);
    return [0, 1, 2].map(function (k) {
      var ms = d.addMonths(d.monthStart(t), -k), me = d.monthEnd(ms);
      var to = d.add(ms, Math.min(day, d.day(me)) - 1);
      return { k: k, from: ms, to: to, monthEnd: me, label: d.fmtRange(ms, to), labelY: d.fmtRange(ms, to) + ' ' + d.year(ms), mon: d.monthName(ms), monLong: d.monthName(ms, true), days: d.day(to), monthDays: d.day(me) };
    });
  }
  /* revenue + nights of stays in from..to that were on the books by the end of asOf (current month: by now) */
  function onBooks(from, to, asOf) {
    var cur = asOf >= T(), r = { rev: 0, nights: 0 };
    D.bookings.forEach(function (b) {
      if (b.createdAt > D.NOW || b.createdAt.slice(0, 10) > asOf) return;
      if (b.status === 'cancelled' && (cur || !b.cancelledAt || b.cancelledAt <= asOf)) return;
      var n = M.nightsIn(b, from, to); if (!n) return;
      r.rev += b.revenue / b.nights * n; r.nights += n;
    });
    return r;
  }
  function stats(p) {
    var s = { p: p };
    s.revenue = M.revenue(p.from, p.to);
    s.nights = M.nightsSold(p.from, p.to);
    s.occ = M.occupancy(p.from, p.to);
    s.adr = M.adr(p.from, p.to);
    s.revpar = M.revpar(p.from, p.to);
    var arrivals = D.bookings.filter(function (b) { return M.live(b) && b.checkIn >= p.from && b.checkIn <= p.to; });
    s.alos = avg(arrivals, function (b) { return b.nights; });
    var made = madeIn(p.from, p.to), live = made.filter(M.live);
    s.made = live.length;
    s.bookedValue = sum(live, function (b) { return b.revenue; });
    s.lead = avg(live, function (b) { return d.diff(b.createdAt.slice(0, 10), b.checkIn); });
    s.cancelled = made.length - live.length;
    s.otb = onBooks(p.from, p.monthEnd, p.to).rev;
    s.final = p.k ? M.revenue(p.from, p.monthEnd) : null;
    /* daily series for the whole month */
    s.earnedDaily = M.dailyRevenue(p.from, p.monthEnd).map(function (x) { return x.value; });
    var byDay = {};
    madeIn(p.from, p.monthEnd).filter(M.live).forEach(function (b) { var k = b.createdAt.slice(0, 10); byDay[k] = (byDay[k] || 0) + b.revenue; });
    s.bookedDaily = d.range(p.from, p.monthEnd).map(function (x) { return x > T() ? null : (byDay[x] || 0); });
    return s;
  }
  function projection(S) { /* whole-month pace projection: this month's on-the-books × average pickup of the two previous months */
    var ratios = [S[1], S[2]].filter(function (s) { return s.otb > 0 && s.final; }).map(function (s) { return s.final / s.otb; });
    return ratios.length ? S[0].otb * avg(ratios) : null;
  }

  /* ------------------------------------------------------------------ today: arrivals, departures, tasks */
  function byTime(k) { return function (a, b) { return a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0; }; }
  function sameDayBookings() {
    var t = T();
    return D.bookings.filter(function (b) { return M.live(b) && b.checkIn === t && b.createdAt.slice(0, 10) === t && b.createdAt <= D.NOW; }).sort(byTime('checkInTime'));
  }
  function knownArrivals() {
    var t = T();
    return D.bookings.filter(function (b) { return M.live(b) && b.checkIn === t && b.createdAt.slice(0, 10) < t; }).sort(byTime('checkInTime'));
  }
  function departures() {
    var t = T();
    return D.bookings.filter(function (b) { return M.live(b) && b.checkOut === t; }).sort(byTime('checkOutTime'));
  }
  function prepTask(pid, day) {
    var list = D.tasks.filter(function (t) { return t.propertyId === pid && t.due.slice(0, 10) === day && (t.type === 'Turnover' || t.type === 'Inspection'); });
    list.sort(function (a, b) { return (a.type === 'Turnover' ? 0 : 1) - (b.type === 'Turnover' ? 0 : 1); });
    return list[0] || null;
  }
  function prevStay(b) {
    var list = D.bookings.filter(function (x) { return x.id !== b.id && x.propertyId === b.propertyId && M.live(x) && x.checkOut <= b.checkIn; })
      .sort(function (a, c) { return a.checkOut < c.checkOut ? 1 : -1; });
    return list[0] || null;
  }
  function nextStay(b) {
    var list = D.bookings.filter(function (x) { return x.id !== b.id && x.propertyId === b.propertyId && M.live(x) && x.checkIn >= b.checkOut; })
      .sort(function (a, c) { return a.checkIn < c.checkIn ? -1 : 1; });
    return list[0] || null;
  }
  function openTasksToday() { /* incomplete tasks due today or earlier (overdue first) */
    var t = T();
    return D.tasks.filter(function (x) { return x.status !== 'done' && x.due.slice(0, 10) <= t; })
      .sort(function (a, b) {
        var ao = a.due.slice(0, 10) < t ? 0 : 1, bo = b.due.slice(0, 10) < t ? 0 : 1;
        return ao - bo || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
      });
  }
  function loadToday() { /* open tasks per person for today (incl. overdue) */
    var m = {}; openTasksToday().forEach(function (x) { if (x.assigneeId) m[x.assigneeId] = (m[x.assigneeId] || 0) + 1; }); return m;
  }
  var ROLE_GROUP = [['housekeeping', 'Housekeeping'], ['ops', 'Operations'], ['frontdesk', 'Front desk'], ['maintenance', 'Maintenance'], ['owner', 'Owner'], ['accountant', 'Accounts']];
  /* assignee dropdown, grouped by role so the closed control stays short ("Kavya Nair · 2 open") */
  function staffOpts(selected, load) {
    var seen = {};
    var groups = ROLE_GROUP.map(function (g) {
      var people = D.staff.filter(function (s) { return s.role === g[0]; });
      people.forEach(function (s) { seen[s.id] = 1; });
      return people.length ? [g[1], people] : null;
    }).filter(Boolean);
    var rest = D.staff.filter(function (s) { return !seen[s.id]; });
    if (rest.length) groups.push(['Other', rest]);
    return groups.map(function (g) {
      return '<optgroup label="' + esc(g[0]) + '">' + g[1].map(function (s) {
        var n = load[s.id] || 0;
        return '<option value="' + esc(s.id) + '"' + (s.id === selected ? ' selected' : '') + ' title="' + esc(s.roleLabel) + '">' + esc(s.name) + ' · ' + (n ? n + ' open' : 'free') + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
  }
  function assigneeSelect(task, load) {
    return '<select class="select' + (!task.assigneeId ? ' unassigned' : '') + '" data-assign="' + esc(task.id) + '" aria-label="Assigned to, ' + esc(task.title) + (task.propertyId ? ' at ' + esc(prop(task.propertyId).short) : '') + '">' +
      '<option value=""' + (!task.assigneeId ? ' selected' : '') + '>Unassigned</option>' + staffOpts(task.assigneeId, load || loadToday()) + '</select>';
  }
  function taskState(t) {
    if (t.status === 'done') return 'Done';
    if (t.status === 'in_progress') return 'In progress' + (t.checklist ? ' ' + t.checklist[0] + '/' + t.checklist[1] : '');
    return 'Not started';
  }
  function timeLeftPill(b) {
    var left = mins(b.checkIn + 'T' + b.checkInTime) - mins(D.NOW);
    if (left <= 0) return '<span class="pill bad">Arrival time reached</span>';
    return '<span class="pill ' + (left < 60 ? 'bad' : left < 180 ? 'warn' : 'info') + '">' + dur(left) + ' left to prepare</span>';
  }

  /* ------------------------------------------------------------------ KPI strip */
  function kpiStrip(owner, S) {
    var t = T(), P = S[0].p, P1 = S[1].p;
    var sold = M.nightsSold(t, t), avail = M.availableNights(t, t), blocked = M.blockedNights(t, t);
    var occT = M.occupancy(t, t), yOcc = M.occupancy(d.add(t, -1), d.add(t, -1));
    var items = [{ label: 'Booked tonight', value: fmt.pct(occT), sub: sold + ' of ' + avail + ' units', hl: true, title: 'Occupancy tonight: units with a guest tonight out of the units available' + (blocked ? ' (' + blocked + ' blocked unit excluded)' : '') + '. Last night: ' + fmt.pct(yOcc) + '.' }];
    items.push({ label: 'Occupancy MTD', value: fmt.pct(S[0].occ, 1), sub: dl(S[0].occ, S[1].occ, { kind: 'pts' }) + ' vs ' + esc(P1.mon), title: 'Nights sold ÷ nights available, ' + P.label + ', compared with ' + P1.label });
    if (owner) {
      var restFrom = d.add(t, 1), restTo = P.monthEnd, hasRest = restFrom <= restTo;
      var ob = hasRest ? onBooks(restFrom, restTo, t) : { rev: 0, nights: 0 };
      var ob1 = onBooks(d.add(P1.to, 1), P1.monthEnd, P1.to);
      var restOcc = hasRest ? ob.nights / M.availableNights(restFrom, restTo) : 0;
      items.push({ label: 'ADR MTD', value: money(S[0].adr), sub: dl(S[0].adr, S[1].adr) + ' vs ' + esc(P1.mon), title: 'Average daily rate: revenue ÷ nights sold, ' + P.label });
      items.push({ label: 'RevPAR MTD', value: money(S[0].revpar), sub: dl(S[0].revpar, S[1].revpar) + ' vs ' + esc(P1.mon), title: 'Revenue per available night, ' + P.label });
      items.push({ label: hasRest ? 'Booked ' + d.fmtRange(restFrom, restTo) : 'Booked rest of ' + P.mon, value: fmt.moneyShort(ob.rev), sub: dl(ob.rev, ob1.rev) + ' · ' + fmt.pct(restOcc) + ' full', title: 'Revenue already on the books for the rest of ' + P.monLong + ', compared with what was on the books for the rest of ' + P1.monLong + ' on ' + d.fmt(P1.to) + '. ' + fmt.pct(restOcc) + ' of the remaining nights are booked.' });
    } else {
      var arr = D.bookings.filter(function (b) { return M.live(b) && b.checkIn === t; });
      var sd = sameDayBookings().length, dep = departures();
      var open = openTasksToday(), od = open.filter(function (x) { return x.due.slice(0, 10) < t; }).length;
      items.push({ label: 'Arrivals today', value: String(arr.length), sub: sd ? sd + ' same-day' : 'All known before today', title: 'Guests arriving today, including same-day bookings made this morning' });
      items.push({ label: 'Departures', value: String(dep.length), sub: dep.filter(function (b) { return b.checkOutTime <= D.NOW_TIME; }).length + ' already out', title: 'Guests leaving today' });
      items.push({ label: 'Open tasks', value: String(open.length), sub: od ? '<span class="delta bad">' + od + ' overdue</span>' : 'None overdue', title: 'Incomplete tasks due today, including overdue ones from earlier days' });
    }
    var leadNow = S[0].lead, leadPrev = S[1].lead;
    items.push({ label: 'Avg lead time', value: leadNow == null ? '–' : fmt.num(leadNow, 1) + '<small>days</small>', sub: dl(leadNow, leadPrev, { neutral: true }) + ' vs ' + esc(P1.mon), title: 'Days between booking and arrival, for bookings made ' + P.label + ' vs ' + P1.label });
    if (owner) {
      var c0 = madeIn(d.add(t, -29), t), c1 = madeIn(d.add(t, -59), d.add(t, -30));
      var cr0 = c0.length ? c0.filter(function (b) { return !M.live(b); }).length / c0.length : 0, cr1 = c1.length ? c1.filter(function (b) { return !M.live(b); }).length / c1.length : 0;
      items.push({ label: 'Cancel rate 30d', value: fmt.pct(cr0, 1), sub: dl(cr0, cr1, { kind: 'pts', invert: true }) + ' vs prior', title: 'Share of bookings made in the last 30 days that were cancelled, vs the 30 days before' });
    } else {
      var unread = sum(D.conversations, function (c) { return c.unread || 0; });
      items.push({ label: 'Messages', value: unread + '<small>unread</small>', sub: 'in ' + fmt.plural(D.conversations.filter(function (c) { return c.unread; }).length, 'chat'), title: 'Unread guest messages in the inbox' });
    }
    var r0 = M.avgRating(d.add(t, -29), t), r1 = M.avgRating(d.add(t, -59), d.add(t, -30));
    var nR = D.reviews.filter(function (r) { return r.date >= d.add(t, -29) && r.date <= t; }).length;
    items.push({ label: 'Rating 30d', value: r0 == null ? '–' : r0.toFixed(2) + '<small>★</small>', sub: r0 != null && r1 != null ? dl(r0, r1, { kind: 'abs', dp: 2, f: function (x) { return x.toFixed(2); } }) + ' vs prior' : fmt.plural(nR, 'review'), title: 'Average stars across all platforms from ' + fmt.plural(nR, 'review') + ' in the last 30 days' + (r1 != null ? ' (' + r1.toFixed(2) + ' the 30 days before)' : '') });
    return U.kpis(items);
  }

  /* ------------------------------------------------------------------ hero */
  function heroHTML(S) {
    var P = S.map(function (s) { return s.p; }), earned = st.mode === 'earned';
    var key = earned ? 'revenue' : 'bookedValue';
    var proj = projection(S);
    function cmpLine(s) {
      var diff = S[0][key] - s[key];
      if (!s[key]) return '<span>No ' + (earned ? 'revenue' : 'bookings') + ' in these days</span>';
      return '<span>' + esc(P[0].mon) + ' is <b>' + money(Math.abs(diff)) + '</b> ' + (diff >= 0 ? 'higher' : 'lower') + ' (' + pctChangeText(S[0][key], s[key]) + ')</span>';
    }
    function foot(s) {
      return earned ? s.nights + ' nights · ' + fmt.pct(s.occ, 1) + ' occupied · ADR ' + money(s.adr)
        : fmt.plural(s.made, 'booking') + ' · lead ' + (s.lead == null ? '–' : fmt.num(s.lead, 1) + ' days') + (s.cancelled ? ' · ' + s.cancelled + ' cancelled' : '');
    }
    var tiles = '<div class="dsh-tiles">' +
      '<div class="dsh-tile cur"><div class="t-label"><span class="key k0"></span>' + esc(P[0].labelY) + ' · month to date</div>' +
      '<div class="t-val">' + money(S[0][key]) + '</div>' +
      '<div class="t-line"><span>' + dl(S[0][key], S[1][key]) + ' vs ' + esc(P[1].label) + '</span><span>' + dl(S[0][key], S[2][key]) + ' vs ' + esc(P[2].label) + '</span></div>' +
      '<div class="t-foot">' + foot(S[0]) + '</div></div>' +
      [1, 2].map(function (k) {
        return '<div class="dsh-tile"><div class="t-label"><span class="key k' + k + '"></span>' + esc(P[k].labelY) + '</div><div class="t-val">' + money(S[k][key]) + '</div>' +
          '<div class="t-line">' + cmpLine(S[k]) + '</div><div class="t-foot">' + foot(S[k]) + '</div></div>';
      }).join('') +
      '<div class="dsh-tile out" title="On the books = revenue of every night in the month that was already booked at this point. Projection applies the average pickup of the two previous months.">' +
      '<div class="t-label"><span class="key kd"></span>All of ' + esc(P[0].monLong) + ', on the books</div><div class="t-val">' + money(S[0].otb) + '</div>' +
      '<div class="t-line"><span>' + dl(S[0].otb, S[1].otb) + ' vs ' + esc(P[1].mon) + ' at the same point</span></div>' +
      '<div class="t-foot">' + (proj ? 'Pace projection about <b>' + fmt.moneyShort(proj) + '</b> · ' : '') + esc(P[1].mon) + ' closed at ' + fmt.moneyShort(S[1].final) + '</div></div>' +
      '</div>';

    var spanSeg = U.seg([['mtd', 'Days 1–' + P[0].days], ['month', 'Whole month']], st.span, 'data-span');
    var chartSeg = U.seg([['cum', 'Running total'], ['daily', 'Daily']], st.chart, 'data-chart');
    var leg = [{ name: P[0].monLong + ' ' + d.year(P[0].from), tone: 'brand' }, { name: P[1].monLong, tone: 'prev1' }, { name: P[2].monLong, tone: 'prev2' }];
    if (earned && st.span === 'month' && st.chart === 'cum') leg.splice(1, 0, { name: P[0].mon + ' nights booked ahead', tone: 'brand', dash: true });
    var chart = '<div class="dsh-chart-ctl">' + spanSeg + chartSeg + O.chart.legend(leg) + '</div><div class="dsh-chart"></div>' +
      '<div class="dsh-foot">' + (earned
        ? 'Earned revenue counts the nights stayed from day 1 to today (' + esc(P[0].label) + ', ' + esc(P[1].label) + ', ' + esc(P[2].label) + '), so the three periods always cover the same number of days.'
        : 'Booked revenue is the value of new bookings made from day 1 to today, whenever the stay is. Bookings cancelled since are left out.') +
      ' Revenue is accommodation plus cleaning fees; tourism tax is passed through and excluded.</div>';

    function row(label, k, f, o, title) {
      o = o || {};
      return '<tr' + (o.cls ? ' class="' + o.cls + '"' : '') + '><td' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(label) + '</td>' +
        S.map(function (s, i) { var v = s[k]; return '<td class="num' + (i === 0 ? ' cur' : '') + '">' + (v == null ? (k === 'final' && i === 0 ? '<span class="muted">In progress</span>' : '–') : f(v)) + '</td>'; }).join('') +
        '<td class="num">' + (o.noDelta ? '' : dl(S[0][k], S[1][k], o)) + '</td><td class="num">' + (o.noDelta ? '' : dl(S[0][k], S[2][k], o)) + '</td></tr>';
    }
    var m = function (v) { return money(v); }, n = function (v) { return fmt.num(v); };
    var table = '<div class="table-wrap"><table class="table dsh-cmp"><thead><tr><th>Metric</th>' +
      P.map(function (p, i) { return '<th class="num"><span class="key k' + i + '"></span>' + esc(p.label) + '</th>'; }).join('') +
      '<th class="num">' + esc(P[0].mon) + ' vs ' + esc(P[1].mon) + '</th><th class="num">' + esc(P[0].mon) + ' vs ' + esc(P[2].mon) + '</th></tr></thead><tbody>' +
      '<tr class="grp' + (earned ? ' on' : '') + '"><td colspan="6">Earned · nights stayed</td></tr>' +
      row('Revenue', 'revenue', m, { cls: earned ? 'in' : '' }) +
      row('Nights sold', 'nights', n) +
      row('Occupancy', 'occ', function (v) { return fmt.pct(v, 1); }, { kind: 'pts' }) +
      row('ADR', 'adr', m, {}, 'Average daily rate: revenue ÷ nights sold') +
      row('RevPAR', 'revpar', m, {}, 'Revenue per available night') +
      row('Avg length of stay', 'alos', function (v) { return fmt.num(v, 1) + ' nights'; }, { neutral: true }, 'Average nights of stays arriving in the period') +
      '<tr class="grp' + (!earned ? ' on' : '') + '"><td colspan="6">Booked · new bookings made</td></tr>' +
      row('Bookings made', 'made', n) +
      row('Value booked', 'bookedValue', m, { cls: !earned ? 'in' : '' }) +
      row('Avg lead time', 'lead', function (v) { return fmt.num(v, 1) + ' days'; }, { neutral: true }, 'Days between booking and arrival') +
      row('Cancelled since', 'cancelled', n, { kind: 'abs', invert: true }, 'Bookings made in the period that were later cancelled') +
      '<tr class="grp"><td colspan="6">Whole month</td></tr>' +
      row('On the books by day ' + P[0].days, 'otb', m, {}, 'Revenue of every night in the month that was booked by day ' + P[0].days) +
      row('Final revenue', 'final', m, { noDelta: true }) +
      '</tbody></table></div>';

    return '<div class="card-head"><div class="hd"><h3>Month-to-date revenue</h3><div class="sub">' + esc(P[0].labelY) + ' compared with the same days in ' + esc(P[1].monLong) + ' and ' + esc(P[2].monLong) + '</div></div>' +
      U.seg([['earned', 'Earned (nights stayed)'], ['booked', 'Booked (new bookings)']], st.mode, 'data-mode') + '</div>' +
      '<div class="card-body">' + tiles + '<div class="dsh-hb"><div>' + chart + '</div><div>' + table + '</div></div></div>';
  }
  function drawHeroChart(el, S) {
    if (!el) return;
    var earned = st.mode === 'earned', whole = st.span === 'month', cum = st.chart === 'cum';
    var P = S.map(function (s) { return s.p; });
    var n = whole ? Math.max.apply(null, P.map(function (p) { return p.monthDays; })) : P[0].days;
    var labels = []; for (var i = 1; i <= n; i++) labels.push(i);
    var today = P[0].days;
    function series(s, k) {
      var raw = (earned ? s.earnedDaily : s.bookedDaily).slice(0, n);
      var out = [], acc = 0;
      for (var j = 0; j < n; j++) {
        var v = raw[j];
        if (v == null || j >= raw.length) { out.push(null); continue; }
        if (k === 0 && j >= today) { out.push(null); continue; }
        acc += v; out.push(cum ? acc : v);
      }
      return out;
    }
    var names = [P[0].monLong + ' ' + d.year(P[0].from), P[1].monLong, P[2].monLong];
    var ser = [0, 1, 2].map(function (k) { return { name: names[k], values: series(S[k], k), tone: ['brand', 'prev1', 'prev2'][k], width: k === 0 ? 2.6 : 2 }; });
    var tip = function (i) { return 'Day ' + (i + 1) + (cum ? ' · running total' : '') + (whole && i >= today ? ' · ' + P[0].mon + ' figure is booked ahead' : ''); };
    if (earned && whole && cum) { /* the rest of the current month: nights already booked, dashed */
      var raw0 = S[0].earnedDaily, acc0 = 0, ahead = [];
      for (var j = 0; j < n; j++) { if (j >= raw0.length) { ahead.push(null); continue; } acc0 += raw0[j]; ahead.push(j >= today - 1 ? acc0 : null); }
      ser.splice(1, 0, { name: P[0].mon + ', booked ahead', values: ahead, tone: 'brand', dash: true, width: 2 });
    }
    var yf = function (v, axis) { if (!axis) return money(v); if (Math.abs(v) < 1000) return 'RM ' + Math.round(v); var k = v / 1000; return 'RM ' + (Math.abs(k - Math.round(k)) < 0.05 ? Math.round(k) : k.toFixed(1)) + 'k'; };
    if (cum) {
      O.chart.line(el, { labels: labels, series: ser, height: whole ? 300 : 290, yFormat: yf, xFormat: function (l) { return whole ? String(l) : 'Day ' + l; }, tipTitle: tip, area: true, markers: whole ? 'none' : 'all', ariaLabel: 'Cumulative revenue by day of month for ' + names.join(', ') });
    } else {
      O.chart.bars(el, { labels: labels, series: ser.map(function (s) { return { name: s.name, tone: s.tone, values: s.values.map(function (v) { return v == null ? 0 : v; }) }; }), height: 290, yFormat: yf, xFormat: function (l) { return whole ? String(l) : 'Day ' + l; }, tipTitle: function (i) { return 'Day ' + (i + 1) + (whole && i >= today ? ' (' + P[0].mon + ' not reached yet)' : ''); }, ariaLabel: 'Daily revenue by day of month' });
    }
  }

  /* ------------------------------------------------------------------ same-day + arrivals + departures */
  function ownerCell(b, load) {
    var task = prepTask(b.propertyId, b.checkIn), prev = prevStay(b);
    var backToBack = prev && prev.checkOut === b.checkIn;
    if (task) {
      return '<div class="dsh-col-h">' + esc(task.type === 'Turnover' ? 'Turnover owner' : 'Prep owner') + '</div>' + assigneeSelect(task, load) +
        '<div class="os">' + esc(task.title) + ' · ' + esc(taskState(task)) + ' · due ' + fmt.time(task.due) + '</div>';
    }
    return '<div class="dsh-col-h">Turnover owner</div>' +
      (backToBack ? '<div class="warnline">No clean booked after ' + esc(prev.guest.name) + '</div>' : '<div class="os" style="margin-top:0">Unit empty since ' + (prev ? d.fmt(prev.checkOut) : 'earlier') + ', no clean booked</div>') +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="addclean" data-b="' + esc(b.id) + '" style="margin-top:7px">' + O.icon('plus') + 'Assign clean</button>';
  }
  function sameDayHTML(load) {
    var list = sameDayBookings(), known = knownArrivals().length;
    var sub = list.length
      ? 'Booked today for arrival today. This morning\'s list had ' + fmt.plural(known, 'check-in') + '; these ' + list.length + ' came in after it, so ' + (known + list.length) + ' guests arrive today.'
      : 'Bookings confirmed today for arrival today show here, apart from this morning\'s ' + fmt.plural(known, 'check-in') + '.';
    var head = '<div class="card-head"><div class="hd"><h3>Same-day bookings<span class="count">' + list.length + '</span></h3><div class="sub">' + esc(sub) + '</div></div>' +
      (list.length ? '<span class="pill accent">' + O.icon('bell') + 'Not on this morning\'s list</span>' : '') + '</div>';
    if (!list.length) return '<div class="card dsh-sameday">' + head + U.empty('No same-day bookings so far today.', '✓') + '</div>';
    var rows = list.map(function (b) {
      var p = prop(b.propertyId);
      var booked = mins(b.createdAt), arrive = mins(b.checkIn + 'T' + b.checkInTime), now = mins(D.NOW);
      var frac = Math.max(0, Math.min(1, (now - booked) / Math.max(1, arrive - booked)));
      var prev = prevStay(b), b2b = prev && prev.checkOut === b.checkIn;
      var acts = '<button type="button" class="btn btn-ghost btn-sm" data-act="open" data-b="' + esc(b.id) + '">' + O.icon('eye') + 'Open booking</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="lock" data-b="' + esc(b.id) + '">' + O.icon('key') + 'Change door code</button>' +
        (b.invoiceSent ? '<button type="button" class="btn btn-ghost btn-sm" data-act="inv" data-b="' + esc(b.id) + '" title="Invoice ' + esc(b.invoiceNo) + ' sent by ' + esc(b.invoiceSent.via) + '">' + O.icon('check') + 'Invoice sent · view</button>'
          : '<button type="button" class="btn btn-primary btn-sm" data-act="send" data-b="' + esc(b.id) + '">' + O.icon('send') + 'Send invoice ' + esc(b.invoiceNo) + '</button>') +
        (!b.idVerified ? '<button type="button" class="btn btn-ghost btn-sm" data-act="idlink" data-b="' + esc(b.id) + '"' + (b.idLinkSent ? ' title="ID link sent at ' + fmt.time(b.idLinkSent) + '"' : '') + '>' + O.icon('user') + (b.idLinkSent ? 'ID link sent · resend' : 'Send ID link') + '</button>' : '');
      return '<div class="dsh-sd">' +
        '<div class="dsh-who"><div class="dsh-col-h">Guest</div><div class="nm">' + U.platIcon(b.channel) + '<button type="button" class="dsh-link" data-act="open" data-b="' + esc(b.id) + '">' + esc(b.guest.name) + '</button></div>' +
        '<div class="sb">' + esc(p.short) + ' · ' + fmt.plural(b.nights, 'night') + ' · ' + fmt.plural(b.guests, 'guest') + ' · ' + esc(U.platName(b.channel)) + '</div>' +
        '<div class="sb' + (b2b ? ' b2b' : '') + '">' + (b2b ? 'Back-to-back after ' + esc(prev.guest.name) + ' (out ' + fmt.time(prev.checkOutTime) + ')' : 'Unit empty since ' + (prev ? d.fmt(prev.checkOut) : 'earlier')) + '</div></div>' +
        '<div class="dsh-tl"><div class="dsh-col-h">Booked → arrival</div><div class="dsh-tl-top"><span>Booked <b>' + fmt.time(b.createdAt) + '</b></span><span>Arrives <b>' + fmt.time(b.checkInTime) + '</b></span></div>' +
        '<div class="dsh-tl-track" role="img" aria-label="' + Math.round(frac * 100) + '% of the preparation window has passed"><i style="width:' + (frac * 100).toFixed(1) + '%"></i><em style="left:' + (frac * 100).toFixed(1) + '%"></em></div>' +
        '<div class="dsh-tl-sub">' + timeLeftPill(b) + '<span>' + dur(arrive - booked) + ' notice</span></div></div>' +
        '<div><div class="dsh-col-h">Readiness</div>' + O.readinessHTML(b) + '</div>' +
        '<div class="dsh-owner">' + ownerCell(b, load) + '</div>' +
        '<div class="dsh-acts">' + acts + '</div>' +
        '</div>';
    }).join('');
    return '<div class="card dsh-sameday">' + head + rows + '<div class="dsh-note-line">' + O.icon('alert', 'ico') + 'Prototype: invoices, ID links and door codes are not really sent.</div></div>';
  }
  function arrivalsHTML(load) {
    var list = knownArrivals(), sd = sameDayBookings().length;
    var head = '<div class="card-head"><div class="hd"><h3>Check-ins today<span class="count muted-c">' + list.length + '</span></h3><div class="sub">On this morning\'s list' + (sd ? ' · ' + fmt.plural(sd, 'same-day booking') + ' shown separately above' : '') + '</div></div>' +
      '<button type="button" class="btn btn-quiet btn-sm" data-go="calendar">Calendar</button></div>';
    if (!list.length) return '<div class="card">' + head + U.empty('No check-ins were expected today.', '–') + '</div>';
    return '<div class="card">' + head + list.map(function (b) {
      var p = prop(b.propertyId), left = mins(b.checkIn + 'T' + b.checkInTime) - mins(D.NOW);
      var task = prepTask(b.propertyId, b.checkIn), prev = prevStay(b), b2b = prev && prev.checkOut === b.checkIn;
      var own = task ? '<span>' + esc(task.type === 'Turnover' ? 'Turnover owner' : 'Prep owner') + '</span>' + assigneeSelect(task, load) + '<span>' + esc(taskState(task)) + ', due ' + fmt.time(task.due) + '</span>'
        : (b2b ? '<span style="color:var(--warn);font-weight:700">No clean booked after ' + esc(prev.guest.name) + '</span>' : '<span>Unit empty since ' + (prev ? d.fmt(prev.checkOut) : 'earlier') + '</span>') + '<button type="button" class="btn btn-ghost btn-xs" data-act="addclean" data-b="' + esc(b.id) + '">' + O.icon('plus') + 'Assign clean</button>';
      return '<div class="dsh-row"><div class="dsh-when"><b>' + fmt.time(b.checkInTime) + '</b><span>' + (left > 0 ? 'in ' + dur(left) : 'Due now') + '</span></div>' +
        '<div class="grow"><div class="nm">' + U.platIcon(b.channel) + '<button type="button" class="dsh-link" data-act="open" data-b="' + esc(b.id) + '">' + esc(b.guest.name) + '</button><span class="small muted">' + esc(p.short) + ' · ' + fmt.plural(b.nights, 'night') + ' · ' + fmt.plural(b.guests, 'guest') + '</span></div>' +
        (b.notes ? '<div class="sb">' + esc(b.notes) + '</div>' : '') +
        O.readinessHTML(b) + '<div class="own">' + own + '</div></div>' +
        '<div class="row-flex"><button type="button" class="ib" data-act="lock" data-b="' + esc(b.id) + '" aria-label="Change door code for ' + esc(b.guest.name) + '" title="Change door code">' + O.icon('key') + '</button>' +
        '<button type="button" class="ib" data-act="open" data-b="' + esc(b.id) + '" aria-label="Open booking for ' + esc(b.guest.name) + '" title="Open booking">' + O.icon('eye') + '</button></div></div>';
    }).join('') + '</div>';
  }
  function departuresHTML(load) {
    var list = departures();
    var out = list.filter(function (b) { return b.checkOutTime <= D.NOW_TIME; }).length;
    var head = '<div class="card-head"><div class="hd"><h3>Check-outs today<span class="count muted-c">' + list.length + '</span></h3><div class="sub">' + (list.length ? out + ' already out · ' + (list.length - out) + ' still due' : 'Nobody leaves today') + '</div></div></div>';
    if (!list.length) return '<div class="card">' + head + U.empty('No check-outs today.', '–') + '</div>';
    return '<div class="card">' + head + list.map(function (b) {
      var p = prop(b.propertyId), gone = b.checkOutTime <= D.NOW_TIME;
      var task = D.tasks.filter(function (t) { return t.propertyId === b.propertyId && t.type === 'Turnover' && t.due.slice(0, 10) === D.TODAY; })[0];
      var nx = nextStay(b);
      var blk = D.blocks.filter(function (x) { return x.propertyId === b.propertyId && x.start === b.checkOut; })[0];
      var next = blk ? 'Blocked until ' + d.fmt(blk.end) + ': ' + esc(blk.note)
        : nx ? (nx.checkIn === b.checkOut ? '<b style="color:var(--text)">Back-to-back:</b> ' + esc(nx.guest.name) + ' arrives ' + fmt.time(nx.checkInTime) + (nx.createdAt.slice(0, 10) === D.TODAY ? ' (same-day booking)' : '') : 'Next guest ' + esc(nx.guest.name) + ' on ' + d.fmt(nx.checkIn)) : 'No next booking yet';
      if (!task && blk) task = D.tasks.filter(function (t) { return t.propertyId === b.propertyId && t.due.slice(0, 10) === D.TODAY; })[0];
      return '<div class="dsh-row"><div class="dsh-when"><b>' + fmt.time(b.checkOutTime) + '</b><span>' + (gone ? 'Checked out' : 'Due out') + '</span></div>' +
        '<div class="grow"><div class="nm">' + U.platIcon(b.channel) + '<button type="button" class="dsh-link" data-act="open" data-b="' + esc(b.id) + '">' + esc(b.guest.name) + '</button><span class="small muted">' + esc(p.short) + ' · ' + fmt.plural(b.nights, 'night') + '</span></div>' +
        '<div class="sb">' + next + '</div>' +
        '<div class="own">' + (task ? '<span>' + esc(task.title) + '</span>' + assigneeSelect(task, load) + '<span class="rd ' + (task.status === 'done' ? 'ok' : task.status === 'in_progress' ? 'wait' : 'todo') + '">' + esc(taskState(task)) + '</span>' : '<span>No turnover task</span>') + '</div></div>' +
        '<button type="button" class="ib" data-act="open" data-b="' + esc(b.id) + '" aria-label="Open booking for ' + esc(b.guest.name) + '" title="Open booking">' + O.icon('eye') + '</button></div>';
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------------------ tasks (incomplete only) */
  function tasksHTML(load) {
    var t = T(), list = openTasksToday();
    var overdue = list.filter(function (x) { return x.due.slice(0, 10) < t; }).length;
    var unassigned = list.filter(function (x) { return !x.assigneeId; }).length;
    var doneToday = D.tasks.filter(function (x) { return x.status === 'done' && (x.doneAt || x.due).slice(0, 10) === t; }).length;
    var head = '<div class="card-head"><div class="hd"><h3>Today\'s tasks<span class="count">' + list.length + '</span></h3><div class="sub">Only what is still to do' + (overdue ? ' · <span style="color:var(--bad);font-weight:700">' + overdue + ' overdue from earlier</span>' : '') + (unassigned ? ' · <span style="color:var(--warn);font-weight:700">' + unassigned + ' unassigned</span>' : '') + ' · ' + doneToday + ' done today, hidden</div></div>' +
      '<button type="button" class="btn btn-quiet btn-sm" data-go="tasks">All tasks</button></div>';
    if (!list.length) return '<div class="card">' + head + U.empty('Everything due today is done.', '✓') + '</div>';
    var PRIO = { high: ['High', 'bad'], medium: ['Medium', 'warn'], low: ['Low', 'neutral'] };
    return '<div class="card">' + head + list.map(function (x) {
      var od = x.due.slice(0, 10) < t, late = !od && x.due < D.NOW;
      var where = x.propertyId ? prop(x.propertyId).short : 'General';
      var due = od ? '<b>' + fmt.time(x.due) + '</b><span class="bad">Overdue</span><span>since ' + d.fmt(x.due.slice(0, 10)) + '</span>'
        : '<b>' + fmt.time(x.due) + '</b>' + (late ? '<span class="warn">Late</span>' : '<span>in ' + dur(mins(x.due) - mins(D.NOW)) + '</span>');
      var prio = PRIO[x.priority] || ['Normal', 'neutral'];
      var stt = x.status === 'in_progress' ? '<span class="pill info">In progress' + (x.checklist ? ' ' + x.checklist[0] + '/' + x.checklist[1] : '') + '</span>' : '';
      var meta = where + ' · ' + x.type + (x.note ? ' · ' + x.note : '');
      return '<div class="dsh-task' + (od ? ' od' : !x.assigneeId ? ' un' : '') + '">' +
        '<div class="due">' + due + '</div>' +
        '<div style="min-width:0"><div class="tt"><span>' + esc(x.title) + '</span><span class="pill ' + prio[1] + '">' + prio[0] + '</span>' + stt + '</div><div class="ts" title="' + esc(meta) + '">' + esc(meta) + '</div></div>' +
        '<div class="asg">' + assigneeSelect(x, load) + '</div>' +
        '<div class="tact">' + (x.status === 'todo' ? '<button type="button" class="btn btn-ghost btn-sm" data-act="start" data-t="' + esc(x.id) + '" aria-label="Start ' + esc(x.title) + ' at ' + esc(where) + '">' + O.icon('play') + 'Start</button>' : '') +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="done" data-t="' + esc(x.id) + '" aria-label="Mark ' + esc(x.title) + ' at ' + esc(where) + ' done">' + O.icon('check') + 'Done</button></div>' +
        '</div>';
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------------------ alerts */
  function alertsList() {
    var t = T(), out = [];
    var nr = D.reviews.filter(function (r) { return !r.reply; });
    if (nr.length) { var low = nr.filter(function (r) { return r.stars <= 3; }).length; out.push({ tone: low ? 'bad' : 'warn', icon: 'star', n: nr.length, t: 'Reviews need a reply', s: low ? low + ' of them are 3 stars or lower' : 'All 4 stars or higher', go: ['reviews', { needsReply: true }] }); }
    var idp = D.bookings.filter(function (b) { return M.live(b) && !b.idVerified && b.checkIn >= t && b.checkIn <= d.add(t, 2) && b.createdAt <= D.NOW; }).sort(byTime('checkIn'));
    if (idp.length) out.push({ tone: idp.some(function (b) { return b.checkIn === t; }) ? 'bad' : 'warn', icon: 'user', n: idp.length, t: 'ID checks pending', s: 'Arriving by ' + d.fmt(d.add(t, 2)) + ': ' + idp.slice(0, 3).map(function (b) { return b.guest.name; }).join(', ') + (idp.length > 3 ? '…' : ''), go: ['bookings', { from: t, to: d.add(t, 2) }] });
    var od = D.tasks.filter(function (x) { return x.status !== 'done' && x.due.slice(0, 10) < t; });
    if (od.length) out.push({ tone: 'bad', icon: 'clock', n: od.length, t: 'Overdue tasks', s: od.slice(0, 2).map(function (x) { return x.title + (x.propertyId ? ' · ' + prop(x.propertyId).short : ''); }).join('; '), go: ['tasks', { due: 'overdue' }] });
    var un = D.tasks.filter(function (x) { return x.status !== 'done' && !x.assigneeId; });
    if (un.length) out.push({ tone: 'warn', icon: 'tasks', n: un.length, t: 'Unassigned tasks', s: un.slice(0, 2).map(function (x) { return x.title + (x.propertyId ? ' · ' + prop(x.propertyId).short : '') + ' · due ' + d.fmt(x.due.slice(0, 10)); }).join('; '), go: ['tasks', { assignee: 'unassigned' }] });
    var pend = D.bookings.filter(function (b) { return b.status === 'pending'; });
    if (pend.length) out.push({ tone: 'warn', icon: 'bookings', n: pend.length, t: 'Pending bookings', s: 'Waiting for confirmation or payment · next ' + d.fmt(pend.slice().sort(byTime('checkIn'))[0].checkIn), go: ['bookings', { status: 'pending' }] });
    var inv = D.bookings.filter(function (b) { return M.live(b) && !b.invoiceSent && b.createdAt <= D.NOW && b.checkOut >= t; });
    if (inv.length) out.push({ tone: 'info', icon: 'invoices', n: inv.length, t: 'Invoices not sent', s: inv.slice(0, 2).map(function (b) { return b.guest.name + ' · ' + b.invoiceNo; }).join(', ') + (inv.length > 2 ? '…' : ''), go: ['invoices', { status: 'notsent' }] });
    var unread = D.conversations.filter(function (c) { return c.unread; });
    if (unread.length) out.push({ tone: 'info', icon: 'chat', n: sum(unread, function (c) { return c.unread; }), t: 'Unread guest messages', s: 'In ' + fmt.plural(unread.length, 'conversation'), go: ['inbox'] });
    var r0 = M.avgRating(d.add(t, -29), t), r1 = M.avgRating(d.add(t, -59), d.add(t, -30));
    if (r0 != null && r1 != null && r1 - r0 >= 0.15) out.push({ tone: 'warn', icon: 'alert', n: r0.toFixed(2) + '★', t: 'Rating is slipping', s: 'Last 30 days ' + r0.toFixed(2) + '★, down from ' + r1.toFixed(2) + '★ the 30 days before', go: ['reviews'] });
    var rank = { bad: 0, warn: 1, info: 2 };
    return out.map(function (a, i) { a.i = i; return a; }).sort(function (a, b) { return rank[a.tone] - rank[b.tone] || a.i - b.i; });
  }
  function alertsHTML(list) {
    var head = '<div class="card-head"><div class="hd"><h3>Needs attention<span class="count">' + list.length + '</span></h3><div class="sub">Open one to deal with it</div></div></div>';
    if (!list.length) return '<div class="card">' + head + U.empty('Nothing needs attention right now.', '✓') + '</div>';
    return '<div class="card">' + head + '<div class="dsh-alerts">' + list.map(function (a, i) {
      return '<button type="button" class="dsh-alert" data-alert="' + i + '"><span class="ai ' + a.tone + '">' + O.icon(a.icon) + '</span><span class="grow"><span class="at">' + esc(a.t) + '</span><span class="as">' + esc(a.s) + '</span></span><span class="an">' + esc(a.n) + '</span>' + O.icon('chevron', 'chev') + '</button>';
    }).join('') + '</div></div>';
  }

  /* ------------------------------------------------------------------ next 14 nights heat strip */
  function heatHTML() {
    var t = T(), days = d.range(t, d.add(t, 13)), last = days[days.length - 1];
    var grid = {};
    D.properties.forEach(function (p) { grid[p.id] = {}; });
    D.blocks.forEach(function (x) { if (!grid[x.propertyId]) return; days.forEach(function (dd) { if (x.start <= dd && dd < x.end) grid[x.propertyId][dd] = { block: x }; }); });
    D.bookings.forEach(function (b) {
      if (!M.live(b) || b.checkOut <= t || b.checkIn > last || !grid[b.propertyId]) return;
      days.forEach(function (dd) { if (b.checkIn <= dd && dd < b.checkOut) grid[b.propertyId][dd] = { b: b }; });
    });
    var evDays = {};
    days.forEach(function (dd) { var names = []; D.events.forEach(function (e) { if (dd >= e.date && dd <= e.end) names.push(e.name + ' (' + e.areas.join(', ') + ')'); }); if (names.length) evDays[dd] = names; });
    var html = '<div class="dsh-heat" role="group" aria-label="Occupancy for the next 14 nights by property"><span class="hn"></span>' +
      days.map(function (dd) {
        var cls = (d.isWeekend(dd) ? ' we' : '') + (dd === t ? ' today' : '');
        return '<span class="hd' + cls + '" title="' + esc(d.dowName(dd) + ' ' + d.fmt(dd) + (evDays[dd] ? ': ' + evDays[dd].join('; ') : '')) + '">' + (evDays[dd] ? '<i class="ev"></i>' : '') + d.dowName(dd).slice(0, 1) + '<b>' + d.day(dd) + '</b></span>';
      }).join('') + '<span class="hp xs muted">Occ.</span>';
    var dayTot = days.map(function () { return { sold: 0, avail: 0 }; });
    var openWeekend = 0, openEvent = 0, openTotal = 0, totSold = 0, totAvail = 0;
    D.properties.forEach(function (p) {
      var sold = 0, avail = 0;
      html += '<span class="hn" title="' + esc(p.name) + '">' + esc(p.short) + '</span>';
      days.forEach(function (dd, i) {
        var c = grid[p.id][dd], lbl = d.dowName(dd) + ' ' + d.fmt(dd) + ', ' + p.short + ': ';
        if (c && c.block) { html += '<span class="c bl" title="' + esc(lbl + (c.block.type === 'owner' ? 'owner stay' : 'maintenance') + ' · ' + c.block.note) + '"></span>'; return; }
        avail++; dayTot[i].avail++;
        if (c && c.b) {
          sold++; dayTot[i].sold++;
          var b = c.b, pend = b.status === 'pending';
          html += '<button type="button" class="c ' + (pend ? 'pd' : 'bk') + '" data-act="open" data-b="' + esc(b.id) + '" title="' + esc(lbl + b.guest.name + ' · ' + U.platName(b.channel) + ' · ' + d.fmtRange(b.checkIn, b.checkOut) + (pend ? ' · pending' : '')) + '" aria-label="' + esc(lbl + b.guest.name + (pend ? ', pending' : '')) + '"></button>';
        } else {
          openTotal++;
          var ev = D.eventFor(p.id, dd);
          if (ev) openEvent++; else if (d.isWeekend(dd)) openWeekend++;
          html += '<span class="c op' + (d.isWeekend(dd) || ev ? ' we' : '') + '" title="' + esc(lbl + 'open' + (ev ? ' · ' + ev.name : d.isWeekend(dd) ? ' · weekend night' : '')) + '"></span>';
        }
      });
      totSold += sold; totAvail += avail;
      html += '<span class="hp">' + (avail ? fmt.pct(sold / avail) : '–') + '</span>';
    });
    html += '<span class="ft hn">All units</span>' + dayTot.map(function (x, i) {
      var v = x.avail ? Math.round(x.sold / x.avail * 100) : 0;
      return '<span class="ft" title="' + esc(d.fmt(days[i]) + ': ' + x.sold + ' of ' + x.avail + ' units booked (' + v + '%)') + '"><span class="ftn">' + v + '</span><span class="ftb"><i style="height:' + v + '%"></i></span></span>';
    }).join('') + '<span class="ft hp">' + (totAvail ? fmt.pct(totSold / totAvail) : '–') + '</span></div>';
    var legend = '<div class="dsh-legend"><span><i style="background:var(--brand-strong)"></i>Booked</span><span><i style="background:var(--brand-soft);box-shadow:inset 0 0 0 1.5px var(--brand-strong)"></i>Pending</span><span><i class="op"></i>Open</span><span><i class="op we"></i>Open Fri/Sat or event night</span><span><i class="bl"></i>Blocked</span><span><i style="background:var(--accent-text);border-radius:50%;width:7px;height:7px"></i>Local event</span></div>';
    var insight = '<div class="dsh-insight">' + O.icon('sparkle') + '<span>' + openTotal + ' open nights in the next 14 days' + (openWeekend + openEvent ? ', including <b>' + (openWeekend + openEvent) + ' on Fri/Sat or local event dates</b>' + (openEvent ? ' (' + openEvent + ' during events)' : '') + '. These are the best nights to review prices.' : '.') + ' <button type="button" class="btn btn-quiet btn-xs" data-go="pricing">Open pricing</button></span></div>';
    return '<div class="card"><div class="card-head"><div class="hd"><h3>Next 14 nights by property</h3><div class="sub">' + d.fmtRange(t, last) + ' · ' + fmt.pct(totAvail ? totSold / totAvail : 0) + ' booked so far · tap a booked night to open it</div></div><button type="button" class="btn btn-quiet btn-sm" data-go="calendar">Calendar</button></div><div class="card-body">' + html + legend + insight + '</div></div>';
  }

  /* ------------------------------------------------------------------ booking pace */
  var LEAD_BUCKETS = [[0, 0, 'Same day'], [1, 7, '1–7 days'], [8, 30, '8–30 days'], [31, 90, '31–90 days'], [91, 9999, '90+ days']];
  function paceData() {
    var t = T(), cur = [], prev = [], curV = 0, prevV = 0, days = [], pdays = [], curB = [], prevB = [];
    for (var i = 13; i >= 0; i--) {
      var a = d.add(t, -i), b = d.add(t, -i - 14);
      var ca = madeIn(a, a).filter(M.live), cb = madeIn(b, b).filter(M.live);
      days.push(a); pdays.push(b); cur.push(ca.length); prev.push(cb.length);
      curB = curB.concat(ca); prevB = prevB.concat(cb);
      curV += sum(ca, function (x) { return x.revenue; }); prevV += sum(cb, function (x) { return x.revenue; });
    }
    function bucket(list) { return LEAD_BUCKETS.map(function (k) { return list.filter(function (x) { var l = d.diff(x.createdAt.slice(0, 10), x.checkIn); return l >= k[0] && l <= k[1]; }).length; }); }
    return { days: days, pdays: pdays, cur: cur, prev: prev, curN: sum(cur), prevN: sum(prev), curV: curV, prevV: prevV, lead: bucket(curB), leadPrev: bucket(prevB) };
  }
  function paceHTML(owner, pd) {
    var mini = '<div class="dsh-mini"><div><div class="ml">Last 14 days</div><div class="mv">' + fmt.plural(pd.curN, 'booking') + '</div></div>' +
      '<div><div class="ml">Previous 14 days</div><div class="mv">' + pd.prevN + '</div></div>' +
      '<div><div class="ml">Change</div><div class="mv">' + dl(pd.curN, pd.prevN) + '</div></div>' +
      (owner ? '<div><div class="ml">Value booked</div><div class="mv">' + fmt.moneyShort(pd.curV) + ' <span class="small">' + dl(pd.curV, pd.prevV) + '</span></div></div>' : '') + '</div>';
    var maxL = Math.max.apply(null, pd.lead.concat(pd.leadPrev).concat([1]));
    var lead = '<div class="dsh-lead"><div class="dsh-col-h">How far ahead they booked (last 14 days)</div>' + O.chart.hbars(LEAD_BUCKETS.map(function (k, i) {
      var n = pd.lead[i], p = pd.leadPrev[i];
      return { label: esc(k[2]), value: n, display: n + ' <span class="xs muted">(' + (n - p >= 0 ? '+' : '−') + Math.abs(n - p) + ')</span>', tone: 'brand' };
    }), { max: maxL }) + '<div class="xs muted" style="margin-top:4px">Brackets show the change from the previous 14 days.</div></div>';
    return '<div class="card"><div class="card-head"><div class="hd"><h3>Booking pace</h3><div class="sub">New bookings made per day, ' + d.fmtRange(pd.days[0], pd.days[13]) + ' vs ' + d.fmtRange(pd.pdays[0], pd.pdays[13]) + ' (cancelled ones excluded)</div></div></div>' +
      '<div class="card-body">' + mini + O.chart.legend([{ name: 'Last 14 days', tone: 'brand', square: true }, { name: 'Previous 14 days', tone: 'prev1', square: true }]).replace('class="legend"', 'class="legend dsh-pace-legend"') + '<div class="dsh-pace"></div>' + lead + '</div></div>';
  }
  function drawPace(el, pd) {
    if (!el) return;
    O.chart.bars(el, {
      labels: pd.days, height: 190, ariaLabel: 'Bookings made per day, last 14 days vs the 14 days before',
      series: [{ name: 'Last 14 days', values: pd.cur, tone: 'brand' }, { name: 'Previous 14 days', values: pd.prev, tone: 'prev1' }],
      yFormat: function (v, axis) { return axis ? (v % 1 ? v.toFixed(1) : String(v)) : fmt.plural(v, 'booking'); },
      xFormat: function (l) { return d.fmt(l); },
      tipTitle: function (i) { return d.dowName(pd.days[i]) + ' ' + d.fmt(pd.days[i]) + ' vs ' + d.dowName(pd.pdays[i]) + ' ' + d.fmt(pd.pdays[i]); }
    });
  }

  /* ------------------------------------------------------------------ revenue by property & channel mix (owner) */
  function propertyHTML(S) {
    var P0 = S[0].p, P1 = S[1].p;
    var rows = D.properties.map(function (p) {
      return { p: p, cur: M.revenue(P0.from, P0.to, { propertyId: p.id }), prev: M.revenue(P1.from, P1.to, { propertyId: p.id }), occ: M.occupancy(P0.from, P0.to, p.id) };
    }).sort(function (a, b) { return b.cur - a.cur; });
    var max = Math.max.apply(null, rows.map(function (r) { return Math.max(r.cur, r.prev); }).concat([1]));
    var up = rows.filter(function (r) { return r.cur > r.prev; }).length;
    var best = rows.slice().sort(function (a, b) { return (b.cur - b.prev) - (a.cur - a.prev); });
    var html = '<div class="dsh-bul h"><span>Property</span><span>' + esc(P0.mon) + ' vs ' + esc(P1.mon) + '</span><span class="right">Revenue</span><span class="right">Change</span></div>' +
      rows.map(function (r) {
        return '<div class="dsh-bul" title="' + esc(r.p.name + ': ' + money(r.cur) + ' (' + P0.label + ') vs ' + money(r.prev) + ' (' + P1.label + ') · occupancy ' + fmt.pct(r.occ)) + '"><span class="bn">' + esc(r.p.short) + '</span>' +
          '<span class="bt"><i style="width:' + (r.cur / max * 100).toFixed(1) + '%"></i><em style="left:' + (r.prev / max * 100).toFixed(1) + '%"></em></span>' +
          '<span class="bv">' + money(r.cur) + '</span><span class="bd">' + dl(r.cur, r.prev) + '</span></div>';
      }).join('') +
      '<div class="dsh-bul tot"><span>All properties</span><span></span><span class="bv">' + money(S[0].revenue) + '</span><span class="bd">' + dl(S[0].revenue, S[1].revenue) + '</span></div>';
    var note = '<div class="dsh-insight">' + O.icon('sparkle') + '<span>' + up + ' of ' + rows.length + ' properties are ahead of last month. Biggest gain: <b>' + esc(best[0].p.short) + '</b> (' + fmt.changeText(fmt.change(best[0].cur, best[0].prev)) + '). Biggest drop: <b>' + esc(best[best.length - 1].p.short) + '</b> (' + fmt.changeText(fmt.change(best[best.length - 1].cur, best[best.length - 1].prev)) + ').</span></div>';
    return '<div class="card"><div class="card-head"><div class="hd"><h3>Revenue by property</h3><div class="sub">' + esc(P0.labelY) + ' vs the same days last month</div></div>' +
      '<div class="dsh-legend" style="margin-top:0"><span><i style="background:var(--brand-strong)"></i>' + esc(P0.label) + '</span><span><span class="lg-tick"></span>' + esc(P1.label) + '</span></div></div>' +
      '<div class="card-body">' + html + note + '</div></div>';
  }
  function channelHTML(S) {
    var P0 = S[0].p, P1 = S[1].p;
    function commission(ch, from, to) {
      return D.bookings.reduce(function (s, b) { if (!M.live(b) || b.channel !== ch) return s; var n = M.nightsIn(b, from, to); return s + (n ? b.platformFee / b.nights * n : 0); }, 0);
    }
    var tot = S[0].revenue || 1, tot1 = S[1].revenue || 1;
    var rows = D.channelOrder.map(function (ch) {
      var rev = M.revenue(P0.from, P0.to, { channel: ch }), rev1 = M.revenue(P1.from, P1.to, { channel: ch });
      return { ch: ch, rev: rev, share: rev / tot, share1: rev1 / tot1, nights: M.nightsSold(P0.from, P0.to, { channel: ch }), fee: commission(ch, P0.from, P0.to) };
    }).sort(function (a, b) { return b.rev - a.rev; });
    var fees = M.platformFees(P0.from, P0.to);
    var direct = rows.filter(function (r) { return r.ch === 'direct'; })[0];
    var otaRate = (function () { var ota = rows.filter(function (r) { return r.ch !== 'direct'; }); var rv = sum(ota, function (r) { return r.rev; }); return rv ? sum(ota, function (r) { return r.fee; }) / rv : 0; })();
    var saved = direct ? direct.rev * otaRate - direct.fee : 0;
    var body = '<div class="table-wrap"><table class="table dsh-ch"><thead><tr><th>Channel</th><th>Share</th><th class="num">Revenue</th><th class="num vs" title="Change in share of revenue, percentage points">vs ' + esc(P1.mon) + '</th><th class="num">Commission</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr title="' + esc(U.platName(r.ch) + ': ' + fmt.plural(r.nights, 'night') + ' sold, ' + P0.label) + '"><td>' + U.plat(r.ch) + '</td><td><div class="shr"><span class="sharebar"><i style="width:' + (r.share * 100).toFixed(1) + '%"></i></span><b>' + fmt.pct(r.share) + '</b></div></td><td class="num">' + money(r.rev) + '</td><td class="num vs">' + dl(r.share, r.share1, { kind: 'pts', neutral: true }) + '</td><td class="num">' + money(r.fee) + '<span class="rate">' + (r.rev ? fmt.pct(r.fee / r.rev, 1) + '<span class="rl"> of revenue</span>' : '–') + '</span></td></tr>';
      }).join('') + '</tbody><tfoot><tr><td>Total</td><td>100%</td><td class="num">' + money(S[0].revenue) + '</td><td class="vs"></td><td class="num">' + money(fees) + '<span class="rate">' + fmt.pct(fees / tot, 1) + '<span class="rl"> of revenue</span></span></td></tr></tfoot></table></div>';
    var note = '<div class="dsh-insight" style="padding:0 16px 14px">' + O.icon('sparkle') + '<span>Commission is <b>' + fmt.pct(fees / tot, 1) + '</b> of revenue this month (' + money(fees) + ').' +
      (direct && direct.rev ? ' Direct bookings brought in ' + fmt.pct(direct.share) + ' and saved about <b>' + money(saved) + '</b> compared with OTA commission.' : '') + '</span></div>';
    return '<div class="card"><div class="card-head"><div class="hd"><h3>Channel mix</h3><div class="sub">' + esc(P0.labelY) + ' · share of earned revenue and commission paid</div></div></div>' + body + note + '</div>';
  }
  function lockedCard(title, sub, what) {
    return '<div class="card"><div class="card-head"><div class="hd"><h3>' + esc(title) + '</h3><div class="sub">' + esc(sub) + '</div></div></div><div class="card-body">' + U.locked(what) + '</div></div>';
  }

  /* ------------------------------------------------------------------ brief */
  function briefHTML() {
    var v = O.viewer(), t = T();
    var h = +D.NOW_TIME.slice(0, 2), hello = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    var arr = D.bookings.filter(function (b) { return M.live(b) && b.checkIn === t; }).length, sd = sameDayBookings().length;
    var dep = departures(), out = dep.filter(function (b) { return b.checkOutTime <= D.NOW_TIME; }).length;
    var open = openTasksToday(), od = open.filter(function (x) { return x.due.slice(0, 10) < t; }).length;
    var s = fmt.plural(arr, 'guest arrival', 'guest arrivals') + ' today' + (sd ? ' (' + sd + ' booked this morning)' : '') + ', ' + fmt.plural(dep.length, 'departure') + (dep.length ? ' (' + out + ' already out)' : '') + ' and ' + fmt.plural(open.length, 'open task') + (od ? ', ' + od + ' of them overdue' : '') + '.';
    return '<div class="dsh-brief"><div><h2>' + hello + ', ' + esc(first(v.name)) + '</h2><p>' + esc(s) + '</p></div><span class="dsh-now">' + O.icon('clock', 'ico') + esc(d.dowName(t)) + ' ' + esc(d.fmtY(t)) + ' · ' + fmt.time(D.NOW_TIME) + '</span></div>';
  }

  /* ------------------------------------------------------------------ actions */
  function addClean(b) {
    var p = prop(b.propertyId), load = loadToday();
    var due = b.checkIn + 'T' + (function () { var m = Math.max(0, mins(b.checkIn + 'T' + b.checkInTime) - mins(b.checkIn + 'T00:00') - 30); return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); })();
    var opts = D.staff.slice().sort(function (a, c) { return (a.role === 'housekeeping' ? 0 : 1) - (c.role === 'housekeeping' ? 0 : 1); }).map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (s.id === p.housekeeper ? ' selected' : '') + '>' + esc(s.name) + ' · ' + esc(s.roleLabel) + ' · ' + (load[s.id] || 0) + ' open today</option>';
    }).join('');
    U.modal({
      title: 'Assign a clean', sub: p.name + ' · before ' + b.guest.name + ' arrives at ' + fmt.time(b.checkInTime),
      body: '<div class="form-grid"><div class="field full"><label for="dsh-ac-who">Assign to</label><select class="select" id="dsh-ac-who" name="who">' + opts + '</select></div>' +
        '<div class="field"><label for="dsh-ac-type">Type</label><select class="select" id="dsh-ac-type" name="type"><option value="Turnover">Turnover clean</option><option value="Inspection">Pre-arrival inspection</option></select></div>' +
        '<div class="field"><label for="dsh-ac-due">Finish by</label><input class="input" type="time" id="dsh-ac-due" name="due" value="' + esc(due.slice(11)) + '"></div>' +
        '<div class="field full"><label for="dsh-ac-note">Note for the cleaner</label><input class="input" id="dsh-ac-note" name="note" value="' + esc((b.createdAt.slice(0, 10) === D.TODAY ? 'Same-day booking: ' : '') + b.guest.name + ' arrives ' + fmt.time(b.checkInTime)) + '"></div></div>',
      actions: [{ label: 'Cancel' }, {
        label: 'Assign clean', kind: 'primary', onClick: function (close, el) {
          var who = O.$('[name=who]', el).value, type = O.$('[name=type]', el).value, tm = O.$('[name=due]', el).value || due.slice(11);
          var maxN = D.tasks.reduce(function (m, x) { var n = +String(x.id).replace(/\D/g, ''); return n > m ? n : m; }, 300);
          D.tasks.push({ id: 'T-' + (maxN + 1), title: type === 'Turnover' ? 'Turnover clean' : 'Pre-arrival inspection', type: type, propertyId: b.propertyId, assigneeId: who, due: b.checkIn + 'T' + tm, priority: 'high', status: 'todo', checklist: [0, type === 'Turnover' ? 12 : 10], note: O.$('[name=note]', el).value });
          U.toast((type === 'Turnover' ? 'Turnover clean' : 'Inspection') + ' at ' + p.short + ' assigned to ' + staffName(who) + '. ' + first(staffName(who)) + ' was notified.');
          O.emit('data', { type: 'task' });
        }
      }]
    });
  }
  function sendIdLink(b) {
    var conv = D.conversations.filter(function (c) { return c.bookingId === b.id; })[0];
    var link = 'https://' + O.ws().domain + '/verify/' + b.id;
    var text = 'Hi ' + b.guest.name.split(' ')[0] + ', please verify your ID here so we can send your door code before you arrive: ' + link;
    if (conv) conv.messages.push({ from: 'staff', staffId: O.state.viewer, text: text, time: D.NOW });
    D.sentLog.unshift({ at: D.NOW, bookingId: b.id, kind: 'ID link', via: 'WhatsApp', to: b.guest.phone, by: O.state.viewer });
    b.idLinkSent = D.NOW;
    U.toast('ID verification link sent to ' + b.guest.name + ' on WhatsApp');
    O.emit('data', { type: 'message', bookingId: b.id });
  }
  function exportCSV(S) {
    var P = S.map(function (s) { return s.p; });
    var head = ['Metric'].concat(P.map(function (p) { return p.labelY; })).concat(['Change vs ' + P[1].label, 'Change vs ' + P[2].label]);
    function r(lbl, k, dp, pts) {
      var v = S.map(function (s) { return s[k] == null ? '' : pts ? (s[k] * 100).toFixed(1) : (dp != null ? (+s[k]).toFixed(dp) : Math.round(s[k])); });
      function c(i) { if (S[0][k] == null || S[i][k] == null) return ''; return pts ? ((S[0][k] - S[i][k]) * 100).toFixed(1) + ' pts' : (S[i][k] ? ((S[0][k] - S[i][k]) / S[i][k] * 100).toFixed(1) + '%' : ''); }
      return [lbl].concat(v).concat([c(1), c(2)]);
    }
    var rows = [head,
      r('Revenue earned (RM)', 'revenue'), r('Nights sold', 'nights'), r('Occupancy (%)', 'occ', 3, true), r('ADR (RM)', 'adr'), r('RevPAR (RM)', 'revpar'), r('Avg length of stay (nights)', 'alos', 1),
      r('Bookings made', 'made'), r('Value booked (RM)', 'bookedValue'), r('Avg lead time (days)', 'lead', 1), r('Cancelled since', 'cancelled'),
      r('Whole month on the books at this point (RM)', 'otb'), r('Final month revenue (RM)', 'final'), [],
      ['Day of month', 'Revenue earned ' + P[0].monLong, 'Revenue earned ' + P[1].monLong, 'Revenue earned ' + P[2].monLong, 'Value booked ' + P[0].monLong, 'Value booked ' + P[1].monLong, 'Value booked ' + P[2].monLong]];
    for (var i = 0; i < P[0].days; i++) rows.push([i + 1].concat(S.map(function (s) { return Math.round(s.earnedDaily[i] || 0); })).concat(S.map(function (s) { return Math.round(s.bookedDaily[i] || 0); })));
    O.downloadCSV('month-to-date-comparison-' + D.TODAY + '.csv', rows);
  }
  function exportPDF(S) {
    var P = S.map(function (s) { return s.p; });
    function pc(k, i, pts) { if (S[0][k] == null || S[i][k] == null) return ''; return pts ? (S[0][k] - S[i][k] >= 0 ? '+' : '-') + Math.abs((S[0][k] - S[i][k]) * 100).toFixed(1) + ' pts' : pctChangeText(S[0][k], S[i][k]); }
    function r(lbl, k, f, pts) { return [lbl].concat(S.map(function (s) { return s[k] == null ? (k === 'final' ? 'In progress' : '-') : f(s[k]); })).concat(k === 'final' ? ['', ''] : [pc(k, 1, pts), pc(k, 2, pts)]); }
    var m = function (v) { return money(v); }, n = function (v) { return fmt.num(v); };
    O.pdf.report({
      filename: 'month-to-date-revenue-' + D.TODAY + '.pdf', title: 'Month-to-date revenue',
      subtitle: P[0].labelY + ' vs ' + P[1].label + ' and ' + P[2].label,
      summary: [['Revenue ' + P[0].label, money(S[0].revenue)], ['vs ' + P[1].label, pctChangeText(S[0].revenue, S[1].revenue)], ['vs ' + P[2].label, pctChangeText(S[0].revenue, S[2].revenue)], [P[0].monLong + ' on the books', money(S[0].otb)]],
      columns: [{ label: 'Metric', w: 58 }, { label: P[0].label, w: 27, align: 'right' }, { label: P[1].label, w: 27, align: 'right' }, { label: P[2].label, w: 27, align: 'right' }, { label: 'vs ' + P[1].mon, w: 23.5, align: 'right' }, { label: 'vs ' + P[2].mon, w: 23.5, align: 'right' }],
      rows: [r('Revenue earned', 'revenue', m), r('Nights sold', 'nights', n), r('Occupancy', 'occ', function (v) { return fmt.pct(v, 1); }, true), r('ADR', 'adr', m), r('RevPAR', 'revpar', m), r('Avg length of stay', 'alos', function (v) { return fmt.num(v, 1) + ' nights'; }),
        r('Bookings made', 'made', n), r('Value booked', 'bookedValue', m), r('Avg lead time', 'lead', function (v) { return fmt.num(v, 1) + ' days'; }), r('Cancelled since', 'cancelled', n),
        r('Whole month on the books', 'otb', m), r('Final month revenue', 'final', m)],
      notes: 'Each period runs from day 1 of the month to day ' + P[0].days + ' (today). Revenue is accommodation plus cleaning fees; tourism tax is excluded. "Value booked" counts new bookings made in the period, whenever the stay is. "On the books" is the revenue for the whole month that was already booked at the same point in each month.'
    });
  }
  function runSheetPDF() {
    var t = T(), rows = [];
    departures().forEach(function (b) { rows.push([b.checkOutTime, 'Check-out', b.guest.name, prop(b.propertyId).short, b.checkOutTime <= D.NOW_TIME ? 'Checked out' : 'Due out', '']); });
    knownArrivals().concat(sameDayBookings()).forEach(function (b) {
      var task = prepTask(b.propertyId, b.checkIn);
      rows.push([b.checkInTime, b.createdAt.slice(0, 10) === t ? 'Check-in (same-day)' : 'Check-in', b.guest.name, prop(b.propertyId).short, O.readiness(b).map(function (r) { return r.label; }).join(', '), task && task.assigneeId ? staffName(task.assigneeId) : '']);
    });
    openTasksToday().forEach(function (x) { rows.push([x.due.slice(0, 10) < t ? 'Overdue' : x.due.slice(11), 'Task', x.title, x.propertyId ? prop(x.propertyId).short : 'General', x.note || taskState(x), staffName(x.assigneeId)]); });
    rows.sort(function (a, b) { var ka = a[0] === 'Overdue' ? '00:00' : a[0], kb = b[0] === 'Overdue' ? '00:00' : b[0]; return ka < kb ? -1 : ka > kb ? 1 : 0; });
    rows = rows.map(function (r) { return [r[0] === 'Overdue' ? 'Overdue' : fmt.time(r[0])].concat(r.slice(1)); });
    O.pdf.report({
      filename: 'run-sheet-' + t + '.pdf', title: 'Run sheet', subtitle: d.dowName(t) + ' ' + d.fmtY(t) + ' · printed ' + fmt.time(D.NOW_TIME),
      summary: [['Check-ins', String(knownArrivals().length + sameDayBookings().length)], ['Same-day', String(sameDayBookings().length)], ['Check-outs', String(departures().length)], ['Open tasks', String(openTasksToday().length)]],
      columns: [{ label: 'Time', w: 20 }, { label: 'What', w: 30 }, { label: 'Guest / task', w: 36 }, { label: 'Property', w: 26 }, { label: 'Details', w: 46 }, { label: 'Owner', w: 28 }],
      rows: rows, notes: 'Completed tasks are not listed. Same-day bookings were confirmed this morning and were not on the original arrivals list.'
    });
  }

  /* ------------------------------------------------------------------ page */
  O.page('dashboard', {
    desc: 'Today at a glance and how this month compares, across all ' + D.properties.length + ' properties',
    render: function (root, ctx) {
      var owner = O.isOwner();
      var S = periods().map(stats);
      var pd = paceData();
      var load = loadToday();
      var alerts = alertsList();
      var acts = '<button type="button" class="btn btn-ghost btn-sm" data-top="run">' + O.icon('printer') + 'Run sheet</button>' +
        (owner ? '<button type="button" class="btn btn-ghost btn-sm" data-top="csv">' + O.icon('download') + 'CSV</button><button type="button" class="btn btn-ghost btn-sm" data-top="pdf">' + O.icon('download') + 'PDF</button>' : '');
      var actEl = ctx.setActions(acts);
      O.$$('[data-top]', actEl).forEach(function (btn) {
        btn.onclick = function () { var k = btn.dataset.top; if (k === 'run') runSheetPDF(); if (k === 'csv') exportCSV(S); if (k === 'pdf') exportPDF(S); };
        btn.title = { run: 'Download today\'s run sheet (PDF): arrivals, departures and open tasks', csv: 'Download the month-to-date comparison as CSV', pdf: 'Download the month-to-date comparison as PDF' }[btn.dataset.top];
      });

      var hero = owner ? '<div class="card dsh-hero">' + heroHTML(S) + '</div>' : '';
      var ops = sameDayHTML(load) +
        '<div class="dsh-g2">' + arrivalsHTML(load) + departuresHTML(load) + '</div>' +
        '<div class="dsh-ta">' + tasksHTML(load) + alertsHTML(alerts) + '</div>';
      var depth = '<div class="dsh-g2 stretch">' + heatHTML() + paceHTML(owner, pd) + '</div>';
      var moneyRow = owner ? '<div class="dsh-g2 stretch">' + propertyHTML(S) + channelHTML(S) + '</div>'
        : '<div class="grid g3">' + lockedCard('Month-to-date revenue', S[0].p.labelY + ' vs the same days in the two previous months', 'Revenue') + lockedCard('Revenue by property', S[0].p.labelY + ' vs the same days last month', 'Revenue by property') + lockedCard('Channel mix', 'Revenue share and commission paid', 'Channel revenue') + '</div>';

      root.innerHTML = '<div class="pg-dashboard">' + briefHTML() + kpiStrip(owner, S) + hero + ops + depth + moneyRow + '</div>';
      var page = O.$('.pg-dashboard', root);

      drawHeroChart(O.$('.dsh-chart', page), S);
      drawPace(O.$('.dsh-pace', page), pd);

      page.addEventListener('click', function (e) {
        var x;
        if ((x = e.target.closest('[data-mode]'))) { st.mode = x.dataset.mode; repaintHero(); return; }
        if ((x = e.target.closest('[data-span]'))) { st.span = x.dataset.span; repaintHero(); return; }
        if ((x = e.target.closest('[data-chart]'))) { st.chart = x.dataset.chart; repaintHero(); return; }
        if ((x = e.target.closest('[data-go]'))) { O.go(x.dataset.go); return; }
        if ((x = e.target.closest('[data-alert]'))) { var a = alerts[+x.dataset.alert]; if (a) O.go(a.go[0], a.go[1]); return; }
        if ((x = e.target.closest('[data-act]'))) {
          var act = x.dataset.act, b = x.dataset.b ? D.booking(x.dataset.b) : null, task = x.dataset.t ? taskById(x.dataset.t) : null;
          var where = task && task.propertyId ? ' at ' + prop(task.propertyId).short : '';
          if (act === 'open' && b) O.booking.open(b.id);
          else if (act === 'lock' && b) O.lock.change({ bookingId: b.id, propertyId: b.propertyId });
          else if (act === 'send' && b) O.invoice.send(b, ['invoice']);
          else if (act === 'inv' && b) O.invoice.preview(b, 'invoice');
          else if (act === 'idlink' && b) sendIdLink(b);
          else if (act === 'addclean' && b) addClean(b);
          else if (act === 'start' && task) {
            task.status = 'in_progress';
            U.toast(task.title + where + ' started' + (task.assigneeId ? ' by ' + staffName(task.assigneeId) : ''));
            O.emit('data', { type: 'task', id: task.id });
          } else if (act === 'done' && task) {
            task.status = 'done'; task.doneAt = D.NOW; if (task.checklist) task.checklist[0] = task.checklist[1];
            U.toast(task.title + where + ' marked done. Completed tasks are hidden here.');
            O.emit('data', { type: 'task', id: task.id });
          }
        }
      });
      page.addEventListener('change', function (e) {
        var sel = e.target.closest('[data-assign]'); if (!sel) return;
        var task = taskById(sel.dataset.assign); if (!task) return;
        task.assigneeId = sel.value || null;
        var where = task.propertyId ? ' at ' + prop(task.propertyId).short : '';
        U.toast(task.assigneeId ? task.title + where + ' assigned to ' + staffName(task.assigneeId) + '. ' + first(staffName(task.assigneeId)) + ' was notified on WhatsApp.' : task.title + where + ' is now unassigned', task.assigneeId ? 'ok' : 'bad');
        O.emit('data', { type: 'task', id: task.id });
      });
      function repaintHero() {
        var card = O.$('.dsh-hero', page); if (!card) return;
        card.innerHTML = heroHTML(S);
        drawHeroChart(O.$('.dsh-chart', card), S);
      }
    }
  });
})();
