/* Tasks & Cleaning — board and list of turnovers, inspections, maintenance and restocks.
   Arnob: "Make sure I have the option of assigning tasks to staff."
   Assign on create, reassign on every card, bulk assign, workload strip per person. */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  var st = { view: 'board', col: 'todo', assignee: 'all', propertyId: '', type: '', due: 'all', q: '', sel: {}, sort: 'due', dir: 1, showAllDone: false, defaulted: false };
  var TYPES = ['Turnover', 'Maintenance', 'Inspection', 'Restock'];
  var STATUS = [['todo', 'To do'], ['in_progress', 'In progress'], ['done', 'Done']];
  var PRI = { high: ['High', 'bad'], medium: ['Medium', 'warn'], low: ['Low', 'neutral'] };
  var PRI_RANK = { high: 0, medium: 1, low: 2 };
  var CHECK = {
    Turnover: ['Strip beds and start laundry', 'Make beds with fresh linen', 'Clean and dry the bathroom', 'Fresh towels and bath mat', 'Restock toiletries', 'Kitchen: dishes, hob and sink', 'Empty fridge and bins', 'Vacuum and mop all floors', 'Wipe surfaces, switches and handles', 'Restock coffee, tea and water', 'Check AC, remotes and batteries', 'Check Wi-Fi and TV', 'Photo of every room', 'Set AC to 24°C, lights off, lock up', 'Check balcony and windows', 'Replace kitchen sponge and towels', 'Clean mirrors and glass', 'Report any damage with photos'],
    Inspection: ['Front door and smart lock', 'Smoke alarm test', 'Fire extinguisher date', 'AC filters', 'Water pressure and hot water', 'Under-sink leaks', 'Electrical sockets', 'Light bulbs', 'Wi-Fi speed test', 'Mattress and pillow protectors', 'Curtains and blinds', 'Furniture condition', 'Walls and paint marks', 'Kitchen appliances', 'Crockery and cutlery count', 'Linen stock count', 'Towel stock count', 'Toiletry stock count', 'Balcony and windows', 'Parking access card', 'House manual and Wi-Fi card', 'Photos for the owner report'],
    Restock: ['Toiletries', 'Toilet paper', 'Coffee and tea', 'Drinking water', 'Cleaning supplies', 'Bin bags', 'Welcome snacks', 'Laundry detergent'],
    Maintenance: ['Diagnose the problem', 'Photo before', 'Fix or replace part', 'Test it works', 'Photo after', 'Log parts and cost in Expenses']
  };
  var DEF_CHECK = { Turnover: 12, Inspection: 10, Restock: 6, Maintenance: 4 };

  O.css('tasks', `
.pg-tasks .wl{display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:8px; margin-bottom:14px;}
@media (min-width:1100px){ .pg-tasks .wl{grid-template-columns:repeat(4,minmax(0,1fr));} }
@media (max-width:560px){ .pg-tasks .wl{grid-template-columns:repeat(2,minmax(0,1fr));} }
.pg-tasks .wl-p{display:flex; align-items:center; gap:9px; min-width:0; background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:8px 10px; text-align:left; box-shadow:var(--shadow);}
.pg-tasks .wl-p:hover{border-color:var(--border-strong);}
.pg-tasks .wl-p.on{border-color:var(--brand-strong); box-shadow:inset 0 0 0 1px var(--brand-strong);}
.pg-tasks .wl-p .wl-m{min-width:0; flex:1;}
.pg-tasks .wl-p .wl-n{font-weight:800; font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.pg-tasks .wl-p .wl-n .s{display:none;}
.pg-tasks .wl-p .wl-r{font-size:11px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.pg-tasks .wl-p .wl-c{flex-shrink:0; text-align:right; padding-left:4px;}
.pg-tasks .wl-p .wl-c b{font-family:var(--font-head); font-size:18px; display:block; line-height:1;}
.pg-tasks .wl-p .wl-c span{font-size:10.5px; color:var(--muted); white-space:nowrap;}
.pg-tasks .wl-bar{height:4px; border-radius:3px; background:var(--surface-2); margin-top:4px; overflow:hidden;}
.pg-tasks .wl-bar i{display:block; height:100%; background:var(--brand-strong);}
.pg-tasks .wl-bar i.hi{background:var(--warn);}
.pg-tasks .wl-p.un{border-style:dashed; border-color:var(--warn); background:var(--warn-soft);}
.pg-tasks .wl-p.un .wl-ic{width:30px; height:30px; border-radius:50%; background:var(--surface); color:var(--warn); display:flex; align-items:center; justify-content:center; flex-shrink:0;}
.pg-tasks .wl-p.un .wl-ic svg{width:16px; height:16px;}
.pg-tasks .filters{display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:10px;}
.pg-tasks .filters .select{width:auto; min-width:140px; max-width:230px; height:36px;}
.pg-tasks .filters .search{min-width:180px; flex:0 1 220px;}
.pg-tasks .sumrow{display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:10px;}
.pg-tasks .colsw{display:none; margin-bottom:10px;}
.pg-tasks .colsw .seg{display:flex; width:100%;}
.pg-tasks .colsw .seg button{flex:1; padding-left:4px; padding-right:4px; white-space:nowrap;}
.pg-tasks .bulk{display:flex; align-items:center; gap:8px; flex-wrap:wrap; background:var(--brand-soft); border:1px solid var(--brand-strong); border-radius:10px; padding:8px 12px; margin-bottom:12px; position:sticky; top:72px; z-index:5;}
.pg-tasks .bulk .select{width:auto; min-width:190px; height:32px; padding-top:4px; padding-bottom:4px;}
.pg-tasks .board{display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; align-items:start;}
.pg-tasks .col{background:var(--surface-2); border:1px solid var(--border); border-radius:12px; padding:10px; min-width:0;}
.pg-tasks .col-h{display:flex; align-items:center; gap:8px; padding:2px 4px 10px; font-weight:800; font-size:13px;}
.pg-tasks .col-h .cnt{background:var(--surface); border:1px solid var(--border); border-radius:20px; font-size:11px; padding:0 8px; font-weight:700; color:var(--text-2);}
.pg-tasks .col-h .dot{width:9px; height:9px; border-radius:50%;}
.pg-tasks .col-list{display:flex; flex-direction:column; gap:8px;}
.pg-tasks .tc{background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:10px 11px; box-shadow:var(--shadow); display:flex; flex-direction:column; gap:7px; min-width:0;}
.pg-tasks .tc.od{box-shadow:inset 3px 0 0 var(--bad), var(--shadow);}
.pg-tasks .tc.un{box-shadow:inset 3px 0 0 var(--warn), var(--shadow); border-style:dashed; border-color:var(--warn);}
.pg-tasks .tc.sel{outline:2px solid var(--brand-strong); outline-offset:-1px;}
.pg-tasks .tc.done{opacity:0.92;}
.pg-tasks .tc-top{display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size:11px; color:var(--muted); font-weight:600;}
.pg-tasks .tc-top input{width:16px; height:16px; accent-color:var(--brand-strong); margin:0;}
.pg-tasks .tc-title{background:none; border:none; padding:0; text-align:left; font-weight:800; font-size:13.5px; color:var(--text); line-height:1.3;}
.pg-tasks .tc-title:hover{color:var(--brand-text); text-decoration:underline;}
.pg-tasks .tc-prop{display:flex; align-items:center; flex-wrap:wrap; gap:6px; font-size:12px; color:var(--text-2); font-weight:600;}
.pg-tasks .tc-note{font-size:11.5px; color:var(--muted); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
.pg-tasks .tc-prog{display:flex; align-items:center; gap:8px; font-size:11px; color:var(--muted); font-weight:700;}
.pg-tasks .tc-prog .progress{flex:1;}
.pg-tasks .tc-foot{display:flex; align-items:center; gap:6px; flex-wrap:wrap; border-top:1px solid var(--border); padding-top:8px;}
.pg-tasks .tc-foot .select{flex:1 1 150px; min-width:0; height:32px; padding-top:4px; padding-bottom:4px; font-size:12px; font-weight:600;}
.pg-tasks .select.unassigned{border-color:var(--warn); background-color:var(--warn-soft); color:var(--warn); font-weight:700;}
.pg-tasks .due{font-size:11px; font-weight:700; white-space:nowrap; margin-left:auto;}
.pg-tasks .due.od{color:var(--bad);} .pg-tasks .due.soon{color:var(--warn);} .pg-tasks .due.norm{color:var(--text-2);}
.pg-tasks .more-done{width:100%;}
.pg-tasks .tbl .tt{background:none; border:none; padding:0; font-weight:700; text-align:left; color:var(--text); white-space:nowrap;}
.pg-tasks .tbl .pc{display:inline-flex; align-items:center; gap:6px;}
.pg-tasks .tbl .tt:hover{color:var(--brand-text); text-decoration:underline;}
.pg-tasks .tbl th, .pg-tasks .tbl td{padding-left:10px; padding-right:10px;}
.pg-tasks .tbl .select{min-width:140px; max-width:180px; height:32px; padding-top:4px; padding-bottom:4px; font-size:12px;}
.pg-tasks .tbl th.sortable{cursor:pointer; user-select:none;}
.pg-tasks .tbl th.sortable:hover{color:var(--text);}
.pg-tasks .tbl tr.od td:first-child{box-shadow:inset 3px 0 0 var(--bad);}
.pg-tasks .tbl tr.un td:first-child{box-shadow:inset 3px 0 0 var(--warn);}
.pg-tasks .tbl input[type=checkbox]{width:16px; height:16px; accent-color:var(--brand-strong);}
.pg-tasks .btn svg{width:14px; height:14px;}
.tk-modal .load{font-size:11.5px; color:var(--muted); margin-top:4px;}
.tk-modal .load b{color:var(--text);}
.tk-modal .sugg{display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:12px; background:var(--brand-soft); border-radius:8px; padding:7px 10px;}
.tk-modal .cl{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px 14px;}
.tk-modal .cl label{display:flex; gap:8px; align-items:flex-start; font-size:12.5px; padding:4px 0;}
.tk-modal .cl input{width:16px; height:16px; accent-color:var(--brand-strong); margin:1px 0 0; flex-shrink:0;}
.tk-modal .cl label.done span{color:var(--muted); text-decoration:line-through;}
.tk-modal .ph{display:flex; gap:8px; flex-wrap:wrap;}
.tk-modal .ph .tile{width:72px; height:72px; border-radius:8px; background:linear-gradient(135deg,var(--surface-2),var(--border)); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; color:var(--faint); overflow:hidden;}
.tk-modal .ph .tile svg{width:20px; height:20px;}
.tk-modal .ph .tile img{width:100%; height:100%; object-fit:cover;}
.tk-modal .ph label.tile{cursor:pointer; border-style:dashed; flex-direction:column; gap:2px; font-size:10.5px; font-weight:700; color:var(--brand-text); background:var(--surface);}
.tk-modal .ph label.tile input{display:none;}
.tk-modal .pseg{display:flex; gap:6px;}
.tk-modal .pseg label{flex:1; display:flex; align-items:center; justify-content:center; gap:6px; border:1px solid var(--border); border-radius:8px; padding:7px; font-size:12.5px; font-weight:700; cursor:pointer;}
.tk-modal .pseg input{accent-color:var(--brand-strong);}
.tk-modal .pseg label:has(input:checked){border-color:var(--brand-strong); background:var(--brand-soft);}
.pg-tasks .tbl .st-cell{display:flex; flex-direction:column; align-items:flex-start; gap:3px;}
@media (max-width:1100px){
  .pg-tasks .board{grid-template-columns:minmax(0,1fr);}
  .pg-tasks .colsw{display:block;}
  .pg-tasks .board .col:not(.cur){display:none;}
}
@media (max-width:560px){
  .pg-tasks .wl-p .wl-n .f{display:none;} .pg-tasks .wl-p .wl-n .s{display:inline;}
  .pg-tasks .wl-p{padding:8px; gap:7px;}
  .pg-tasks .filters .select{flex:1 1 140px; min-width:0; max-width:none;}
  .pg-tasks .filters .search{flex:1 1 100%;}
  .pg-tasks .bulk{top:auto; position:static;}
  .pg-tasks .bulk .select{flex:1 1 100%;}
  .tk-modal .cl{grid-template-columns:minmax(0,1fr);}
}
`);

  /* ---------- helpers ---------- */
  function staff(id) { return id ? D.staffById(id) : null; }
  function first(name) { var w = String(name || '').split(' '); return w.length >= 3 ? w[0] + ' ' + w[1] : w[0]; }
  function prop(id) { return id ? D.propById[id] : null; }
  function isOpen(t) { return t.status !== 'done'; }
  function isOverdue(t) { return isOpen(t) && t.due < D.NOW; }
  function isToday(t) { return t.due.slice(0, 10) === D.TODAY; }
  function weekBounds() { var dw = d.dow(D.TODAY), mon = d.add(D.TODAY, dw === 0 ? -6 : 1 - dw); return [mon, d.add(mon, 6)]; }
  function can(perm) {
    if (O.can) return O.can(perm);
    var r = (O.viewer() || {}).role; return r === 'owner' || r === 'ops' || r === 'frontdesk';
  }
  /* section access from Staff Access (None / View / Edit); falls back to open access if staff.js is missing */
  function canSee() { return O.can ? O.can('tasks', 'view') : true; }
  function canEdit() { return O.can ? O.can('tasks', 'edit') : true; }
  function noteShown(t) { return t.note && !/^(unassigned|overdue\b)/i.test(t.note) ? t.note : ''; }
  function audit(text, cat) { D.auditLog = D.auditLog || []; D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: cat || 'tasks', text: text }); }
  function nextId() { var mx = D.tasks.reduce(function (m, t) { var n = +String(t.id).replace(/\D/g, ''); return n > m ? n : m; }, 300); return 'T-' + (mx + 1); }
  /* open tasks per person: everything not done; "today" = due today or overdue */
  function load(id) {
    var o = D.tasks.filter(function (t) { return isOpen(t) && t.assigneeId === id; });
    return { open: o.length, today: o.filter(function (t) { return t.due.slice(0, 10) <= D.TODAY; }).length };
  }
  function dueLabel(t) {
    var day = t.due.slice(0, 10), tm = fmt.time(t.due);
    if (t.status === 'done') return { cls: 'norm', txt: t.doneAt ? 'Done ' + (t.doneAt.slice(0, 10) === D.TODAY ? fmt.time(t.doneAt) : d.fmt(t.doneAt.slice(0, 10))) : 'Done' };
    if (t.due < D.NOW) {
      var late = day < D.TODAY ? (d.diff(day, D.TODAY) === 1 ? 'since yesterday' : 'since ' + d.fmt(day)) : 'since ' + tm;
      return { cls: 'od', txt: 'Overdue ' + late };
    }
    var mins = (Date.parse(t.due + ':00Z') - Date.parse(D.NOW + ':00Z')) / 6e4;
    if (day === D.TODAY) return { cls: mins <= 120 ? 'soon' : 'norm', txt: 'Today ' + tm + (mins <= 120 ? ' · in ' + (mins < 60 ? Math.round(mins) + 'm' : (mins / 60).toFixed(1).replace('.0', '') + 'h') : '') };
    if (d.diff(D.TODAY, day) === 1) return { cls: 'norm', txt: 'Tomorrow ' + tm };
    return { cls: 'norm', txt: d.dowName(day) + ' ' + d.fmt(day) + ', ' + tm };
  }
  function assigneeOptions(selId, opts) {
    opts = opts || {};
    return '<option value=""' + (!selId ? ' selected' : '') + '>' + (opts.noneLabel || 'Unassigned') + '</option>' + D.staff.map(function (s) {
      var l = load(s.id);
      return '<option value="' + s.id + '"' + (s.id === selId ? ' selected' : '') + '>' + esc(opts.short ? first(s.name) : s.name) + (opts.short ? '' : ' · ' + esc(s.roleLabel)) + ' · ' + (l.open ? l.open + ' open' : 'free') + '</option>';
    }).join('');
  }
  function assigneeSelect(t) {
    var dis = !canEdit() ? ' disabled title="View only"' : !can('assignTasks') ? ' disabled title="You need the Assign tasks permission to reassign"' : '';
    return '<select class="select' + (!t.assigneeId ? ' unassigned' : '') + '" data-assign="' + esc(t.id) + '" aria-label="Assigned to, ' + esc(t.title) + '"' + dis + '>' + assigneeOptions(t.assigneeId, { noneLabel: 'Assign someone', short: true }) + '</select>';
  }
  function priPill(p) { return '<span class="pill ' + PRI[p][1] + '">' + PRI[p][0] + '</span>'; }
  function statusPill(s) { return s === 'done' ? U.pill('Done', 'ok') : s === 'in_progress' ? U.pill('In progress', 'info') : U.pill('To do', 'neutral'); }
  function propCell(pid) {
    var p = prop(pid);
    return p ? '<span class="prop-dot" style="background:' + U.propColor(pid) + '"></span>' + esc(p.short) : '<span class="prop-dot" style="background:var(--border-strong)"></span>General';
  }

  function filtered() {
    var v = O.state.viewer, wk = weekBounds(), q = st.q.trim().toLowerCase();
    return D.tasks.filter(function (t) {
      if (st.assignee === 'me' && t.assigneeId !== v) return false;
      if (st.assignee === 'unassigned' && t.assigneeId) return false;
      if (st.assignee !== 'all' && st.assignee !== 'me' && st.assignee !== 'unassigned' && t.assigneeId !== st.assignee) return false;
      if (st.propertyId && t.propertyId !== st.propertyId) return false;
      if (st.type && t.type !== st.type) return false;
      var day = t.due.slice(0, 10);
      if (st.due === 'overdue' && !isOverdue(t)) return false;
      if (st.due === 'today' && day !== D.TODAY) return false;
      if (st.due === 'week' && (day < wk[0] || day > wk[1])) return false;
      if (q) {
        var p = prop(t.propertyId), s = staff(t.assigneeId);
        var hay = [t.id, t.title, t.type, t.note || '', p ? p.name : 'general', s ? s.name : 'unassigned'].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function byDue(a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : PRI_RANK[a.priority] - PRI_RANK[b.priority]; }

  /* ---------- pieces ---------- */
  function kpis() {
    var open = D.tasks.filter(isOpen), od = open.filter(isOverdue), today = open.filter(isToday);
    var doneToday = D.tasks.filter(function (t) { return t.status === 'done' && t.doneAt && t.doneAt.slice(0, 10) === D.TODAY; });
    var dueTodayAll = D.tasks.filter(isToday);
    var un = open.filter(function (t) { return !t.assigneeId; });
    var turn = D.tasks.filter(function (t) { return t.type === 'Turnover' && isToday(t); });
    return U.kpis([
      { label: 'Open tasks', value: fmt.num(open.length), sub: open.filter(function (t) { return t.status === 'in_progress'; }).length + ' in progress' },
      { label: 'Due today', value: today.length + '', sub: (dueTodayAll.length - today.length) + ' of ' + dueTodayAll.length + ' already done' },
      { label: 'Overdue', value: '<span style="color:' + (od.length ? 'var(--bad)' : 'inherit') + '">' + od.length + '</span>', sub: od.length ? 'Oldest ' + dueLabel(od.sort(byDue)[0]).txt.replace('Overdue ', '') : 'Nothing late' },
      { label: 'Unassigned', value: '<span style="color:' + (un.length ? 'var(--warn)' : 'inherit') + '">' + un.length + '</span>', sub: un.length ? 'Needs an owner' : 'Everyone has an owner' },
      { label: 'Turnovers today', value: turn.length + '', sub: turn.filter(function (t) { return t.status === 'done'; }).length + ' done, ' + turn.filter(function (t) { return t.status === 'in_progress'; }).length + ' cleaning now' },
      { label: 'Done today', value: doneToday.length + '', sub: doneToday.reduce(function (s, t) { return s + (t.photos || 0); }, 0) + ' photos uploaded' }
    ]);
  }

  function workload() {
    var people = D.staff.filter(function (s) { return s.role !== 'accountant'; });
    var max = Math.max.apply(null, people.map(function (s) { return load(s.id).today; }).concat([4]));
    var un = D.tasks.filter(function (t) { return isOpen(t) && !t.assigneeId; }).length;
    return '<div class="wl" role="group" aria-label="Open tasks per person today">' + people.map(function (s) {
      var l = load(s.id), pct = Math.round(l.today / max * 100);
      return '<button type="button" class="wl-p' + (st.assignee === s.id ? ' on' : '') + '" data-who="' + s.id + '" title="' + esc(s.name + ', ' + s.roleLabel + ': ' + l.today + ' due today or overdue, ' + l.open + ' open in total') + '" aria-pressed="' + (st.assignee === s.id) + '">' + U.avatar(s.name) +
        '<div class="wl-m"><div class="wl-n"><span class="f">' + esc(s.name) + (s.id === O.state.viewer ? ' (you)' : '') + '</span><span class="s">' + (s.id === O.state.viewer ? 'You' : esc(first(s.name))) + '</span></div><div class="wl-r">' + esc(s.roleLabel) + '</div><div class="wl-bar"><i class="' + (l.today >= 4 ? 'hi' : '') + '" style="width:' + pct + '%"></i></div></div>' +
        '<div class="wl-c"><b>' + l.today + '</b><span>' + (l.open > l.today ? 'of ' + l.open + ' open' : 'open') + '</span></div></button>';
    }).join('') +
      '<button type="button" class="wl-p un' + (st.assignee === 'unassigned' ? ' on' : '') + '" data-who="unassigned" aria-pressed="' + (st.assignee === 'unassigned') + '"><span class="wl-ic">' + O.icon('user') + '</span><div class="wl-m"><div class="wl-n">Unassigned</div><div class="wl-r">Needs an owner</div></div><div class="wl-c"><b>' + un + '</b><span>open</span></div></button></div>';
  }

  function filtersHTML() {
    var people = '<option value="all"' + (st.assignee === 'all' ? ' selected' : '') + '>Everyone</option><option value="me"' + (st.assignee === 'me' ? ' selected' : '') + '>Assigned to me</option><option value="unassigned"' + (st.assignee === 'unassigned' ? ' selected' : '') + '>Unassigned</option>' +
      D.staff.map(function (s) { return '<option value="' + s.id + '"' + (st.assignee === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('');
    var active = st.assignee !== 'all' || st.propertyId || st.type || st.due !== 'all' || st.q;
    return '<div class="filters">' +
      '<select class="select" data-f="assignee" aria-label="Assignee">' + people + '</select>' +
      '<select class="select" data-f="propertyId" aria-label="Property">' + U.propOptions(st.propertyId, { all: 'All properties' }) + '</select>' +
      '<select class="select" data-f="type" aria-label="Type"><option value="">All types</option>' + TYPES.map(function (t) { return '<option' + (st.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>' +
      U.seg([['all', 'Any time'], ['overdue', 'Overdue'], ['today', 'Today'], ['week', 'This week']], st.due, 'data-due') +
      '<label class="search"><span class="sr-only">Search tasks</span>' + O.icon('search') + '<input type="search" data-f="q" placeholder="Search tasks" value="' + esc(st.q) + '"></label>' +
      (active ? '<button type="button" class="btn btn-quiet btn-sm" data-act="clear">Clear filters</button>' : '') +
      '</div>';
  }

  function bulkBar() {
    var ids = Object.keys(st.sel).filter(function (k) { return st.sel[k]; });
    if (!ids.length) return '';
    return '<div class="bulk" role="region" aria-label="Bulk actions"><b>' + fmt.plural(ids.length, 'task') + ' selected</b>' +
      (can('assignTasks') ? '<select class="select" data-bulk-who aria-label="Assign selected to">' + assigneeOptions('', { noneLabel: 'Assign to…' }) + '</select><button type="button" class="btn btn-primary btn-sm" data-act="bulk-assign">Assign</button>' : '') +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="bulk-move" data-to="in_progress">' + O.icon('play') + 'Start</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="bulk-move" data-to="done">' + O.icon('check') + 'Mark done</button>' +
      '<button type="button" class="btn btn-quiet btn-sm" data-act="bulk-clear">Clear selection</button></div>';
  }

  function moveButtons(t) {
    if (!canEdit()) return '';
    if (t.status === 'todo') return '<button type="button" class="btn btn-ghost btn-xs" data-move="' + t.id + '" data-to="in_progress">' + O.icon('play') + 'Start</button><button type="button" class="btn btn-ghost btn-xs" data-move="' + t.id + '" data-to="done" aria-label="Mark done">' + O.icon('check') + 'Done</button>';
    if (t.status === 'in_progress') return '<button type="button" class="btn btn-ghost btn-xs" data-move="' + t.id + '" data-to="todo" aria-label="Back to to do">' + O.icon('left') + '</button><button type="button" class="btn btn-primary btn-xs" data-move="' + t.id + '" data-to="done">' + O.icon('check') + 'Done</button>';
    return '<button type="button" class="btn btn-ghost btn-xs" data-move="' + t.id + '" data-to="todo">' + O.icon('refresh') + 'Reopen</button>';
  }

  function card(t) {
    var dl = dueLabel(t), od = isOverdue(t), un = isOpen(t) && !t.assigneeId, cl = t.checklist;
    var doneBy = t.status === 'done' && t.assigneeId ? ' by ' + first(staff(t.assigneeId).name) : '';
    return '<article class="tc' + (od ? ' od' : un ? ' un' : '') + (t.status === 'done' ? ' done' : '') + (st.sel[t.id] ? ' sel' : '') + '">' +
      '<div class="tc-top">' + (canEdit() ? '<input type="checkbox" data-pick="' + t.id + '"' + (st.sel[t.id] ? ' checked' : '') + ' aria-label="Select ' + esc(t.title) + '">' : '') + priPill(t.priority) + '<span>' + esc(t.type) + ' · ' + esc(t.id) + '</span></div>' +
      '<button type="button" class="tc-title" data-open="' + t.id + '">' + esc(t.title) + '</button>' +
      '<div class="tc-prop">' + propCell(t.propertyId) + (t.photos ? '<span class="faint xs">· ' + fmt.plural(t.photos, 'photo') + '</span>' : '') + '<span class="due ' + dl.cls + '">' + esc(dl.txt + doneBy) + '</span></div>' +
      (noteShown(t) ? '<div class="tc-note">' + esc(noteShown(t)) + '</div>' : '') +
      (cl && cl[1] ? '<div class="tc-prog"><div class="progress"><i style="width:' + Math.round(cl[0] / cl[1] * 100) + '%"></i></div>' + cl[0] + '/' + cl[1] + '</div>' : '') +
      '<div class="tc-foot">' + assigneeSelect(t) + moveButtons(t) + '</div></article>';
  }

  function boardHTML(list) {
    return '<div class="board">' + STATUS.map(function (s) {
      var items = list.filter(function (t) { return t.status === s[0]; });
      if (s[0] === 'done') items.sort(function (a, b) { return (b.doneAt || b.due) < (a.doneAt || a.due) ? -1 : 1; }); else items.sort(function (a, b) { var ao = isOverdue(a), bo = isOverdue(b); if (ao !== bo) return ao ? -1 : 1; return byDue(a, b); });
      var shown = s[0] === 'done' && !st.showAllDone ? items.slice(0, 6) : items;
      var dot = s[0] === 'done' ? 'var(--ok)' : s[0] === 'in_progress' ? 'var(--info)' : 'var(--border-strong)';
      var emptyMsg = s[0] === 'todo' ? 'Nothing waiting. New tasks land here.' : s[0] === 'in_progress' ? 'Nobody has started a task yet.' : 'No finished tasks for these filters.';
      return '<section class="col' + (st.col === s[0] ? ' cur' : '') + '" aria-label="' + s[1] + '"><div class="col-h"><span class="dot" style="background:' + dot + '"></span>' + s[1] + '<span class="cnt">' + items.length + '</span></div><div class="col-list">' +
        (shown.length ? shown.map(card).join('') : '<div class="empty" style="padding:18px 8px">' + esc(emptyMsg) + '</div>') +
        (items.length > shown.length ? '<button type="button" class="btn btn-ghost btn-sm more-done" data-act="more-done">Show ' + (items.length - shown.length) + ' more</button>' : '') +
        '</div></section>';
    }).join('') + '</div>';
  }

  function listHTML(list) {
    var key = st.sort, dir = st.dir;
    var val = {
      due: function (t) { return t.due; }, priority: function (t) { return PRI_RANK[t.priority]; }, title: function (t) { return t.title; },
      property: function (t) { return prop(t.propertyId) ? prop(t.propertyId).short : 'zz'; }, assignee: function (t) { return staff(t.assigneeId) ? staff(t.assigneeId).name : ''; },
      status: function (t) { return ['todo', 'in_progress', 'done'].indexOf(t.status); }
    }[key];
    list = list.slice().sort(function (a, b) { var x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : byDue(a, b)) * dir; });
    function th(k, label, cls) { return '<th class="sortable ' + (cls || '') + '" data-sort="' + k + '" aria-sort="' + (st.sort === k ? (dir > 0 ? 'ascending' : 'descending') : 'none') + '">' + label + (st.sort === k ? (dir > 0 ? ' ↑' : ' ↓') : '') + '</th>'; }
    var allSel = list.length && list.every(function (t) { return st.sel[t.id]; });
    if (!list.length) return '<div class="card">' + U.empty('No tasks match these filters.', '✓') + '</div>';
    var ed = canEdit();
    return '<div class="card"><div class="table-wrap"><table class="table tbl"><thead><tr>' + (ed ? '<th style="width:34px"><input type="checkbox" data-pick-all' + (allSel ? ' checked' : '') + ' aria-label="Select all"></th>' : '') +
      th('title', 'Task') + th('property', 'Property') + th('due', 'Due') + th('priority', 'Priority') + th('assignee', 'Assigned to') + th('status', 'Status') + (ed ? '<th><span class="sr-only">Actions</span></th>' : '') + '</tr></thead><tbody>' +
      list.map(function (t) {
        var dl = dueLabel(t), cl = t.checklist;
        return '<tr class="' + (isOverdue(t) ? 'od' : isOpen(t) && !t.assigneeId ? 'un' : '') + '">' + (ed ? '<td><input type="checkbox" data-pick="' + t.id + '"' + (st.sel[t.id] ? ' checked' : '') + ' aria-label="Select ' + esc(t.title) + '"></td>' : '') +
          '<td><button type="button" class="tt" data-open="' + t.id + '">' + esc(t.title) + '</button><div class="xs muted">' + esc(t.type) + ' · ' + esc(t.id) + '</div></td>' +
          '<td class="nowrap"><span class="pc">' + propCell(t.propertyId) + '</span></td>' +
          '<td class="nowrap"><span class="due ' + dl.cls + '" style="margin:0">' + esc(dl.txt) + '</span></td>' +
          '<td>' + priPill(t.priority) + '</td><td>' + assigneeSelect(t) + '</td>' +
          '<td><div class="st-cell">' + statusPill(t.status) + (cl && cl[1] && t.status !== 'done' ? '<span class="xs muted nowrap">Checklist ' + cl[0] + '/' + cl[1] + '</span>' : '') + '</div></td>' +
          (ed ? '<td class="nowrap"><div class="row-flex" style="justify-content:flex-end">' + moveButtons(t) + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* ---------- actions ---------- */
  function assign(t, who, quiet) {
    var prev = t.assigneeId; t.assigneeId = who || null;
    var where = prop(t.propertyId) ? prop(t.propertyId).short : 'General';
    if (who) {
      audit('Assigned "' + t.title + '" (' + where + ') to ' + staff(who).name + (prev ? ', was ' + staff(prev).name : ''));
      if (!quiet) U.toast(t.title + ' at ' + where + ' assigned to ' + staff(who).name + '. ' + first(staff(who).name) + ' was notified on WhatsApp.');
    } else {
      audit('Unassigned "' + t.title + '" (' + where + ')');
      if (!quiet) U.toast(t.title + ' at ' + where + ' is now unassigned', 'bad');
    }
  }
  function move(t, to, quiet) {
    var from = t.status; t.status = to;
    if (to === 'done') { t.doneAt = D.NOW; if (t.checklist) t.checklist = [t.checklist[1], t.checklist[1]]; }
    else { delete t.doneAt; }
    if (to === 'in_progress' && t.checklist && from === 'done') t.checklist = [Math.max(0, t.checklist[1] - 1), t.checklist[1]];
    audit((to === 'done' ? 'Completed' : to === 'in_progress' ? 'Started' : 'Reopened') + ' "' + t.title + '"' + (prop(t.propertyId) ? ' (' + prop(t.propertyId).short + ')' : ''));
    if (!quiet) U.toast(to === 'done' ? t.title + ' marked done' + (t.type === 'Turnover' ? '. The unit shows as clean on arrivals.' : '') : to === 'in_progress' ? t.title + ' started' : t.title + ' moved back to to do');
  }
  function changed(type) { O.emit('data', { type: type || 'tasks' }); }

  /* ---------- task form (new + edit) ---------- */
  function suggestFor(type, pid) {
    var p = prop(pid);
    if (type === 'Turnover' && p) return [p.housekeeper, 'is the housekeeper for ' + p.short];
    if (type === 'Maintenance') return ['s6', 'handles maintenance'];
    if (type === 'Inspection') return ['s2', 'runs inspections'];
    if (type === 'Restock') return [p ? p.housekeeper : 's4', p ? 'restocks ' + p.short : 'collects supplies'];
    return null;
  }
  function formHTML(t) {
    var mine = !can('assignTasks');
    var date = t.due.slice(0, 10), time = t.due.slice(11, 16);
    return '<div class="tk-modal stack"><div class="form-grid">' +
      '<div class="field full"><label for="tk-title">Task</label><input class="input" id="tk-title" name="title" value="' + esc(t.title) + '" placeholder="For example: Turnover clean, Fix shower head" required></div>' +
      '<div class="field"><label for="tk-type">Type</label><select class="select" id="tk-type" name="type">' + TYPES.map(function (x) { return '<option' + (x === t.type ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="tk-prop">Property</label><select class="select" id="tk-prop" name="propertyId"><option value="">General / no property</option>' + U.propOptions(t.propertyId) + '</select></div>' +
      '<div class="field full"><label for="tk-who">Assign to</label><select class="select" id="tk-who" name="assigneeId"' + (mine ? ' disabled' : '') + '>' + assigneeOptions(t.assigneeId, { noneLabel: 'Unassigned (decide later)' }) + '</select>' +
      '<div class="load" data-load></div><div data-sugg></div>' + (mine ? '<div class="hint">Only people with the Assign tasks permission can give tasks to others. This one will be yours.</div>' : '') + '</div>' +
      '<div class="field full"><span class="label">Priority</span><div class="pseg" role="radiogroup" aria-label="Priority">' + ['high', 'medium', 'low'].map(function (p) { return '<label><input type="radio" name="priority" value="' + p + '"' + (t.priority === p ? ' checked' : '') + '>' + PRI[p][0] + '</label>'; }).join('') + '</div></div>' +
      '<div class="field"><label for="tk-date">Due date</label><input class="input" type="date" id="tk-date" name="date" value="' + date + '" required></div>' +
      '<div class="field"><label for="tk-time">Due time</label><input class="input" type="time" id="tk-time" name="time" value="' + time + '" required></div>' +
      '<div class="field"><label for="tk-cl">Checklist items</label><input class="input" type="number" min="0" max="22" id="tk-cl" name="checklist" value="' + (t.checklist ? t.checklist[1] : 0) + '"><span class="hint">Standard list for the type; 0 for none</span></div>' +
      '<div class="field" style="justify-content:flex-end"><label class="check"><input type="checkbox" name="notify" checked> Notify the assignee on WhatsApp</label></div>' +
      '<div class="field full"><label for="tk-note">Notes</label><textarea class="textarea" id="tk-note" name="note" placeholder="Anything the assignee needs to know: arrival time, access, parts to bring">' + esc(t.note || '') + '</textarea></div>' +
      '</div></div>';
  }
  function wireForm(el, t, isNew) {
    var f = function (n) { return O.$('[name=' + n + ']', el); };
    function paintLoad() {
      var who = f('assigneeId').value, box = O.$('[data-load]', el), sg = O.$('[data-sugg]', el);
      if (who) {
        var s = staff(who), l = load(who), day = f('date').value;
        var sameDay = D.tasks.filter(function (x) { return isOpen(x) && x.assigneeId === who && x.due.slice(0, 10) === day && x.id !== t.id; });
        box.innerHTML = '<b>' + esc(first(s.name)) + '</b> has ' + fmt.plural(l.open, 'open task') + (day ? ', ' + sameDay.length + ' due ' + (day === D.TODAY ? 'today' : d.fmt(day)) : '') + (sameDay.length ? ': ' + esc(sameDay.slice(0, 3).map(function (x) { return x.title + ' ' + fmt.time(x.due); }).join(', ')) : '') + '. ' + esc(s.phone);
      } else box.innerHTML = 'Unassigned tasks are flagged on the dashboard until someone takes them.';
      var sug = suggestFor(f('type').value, f('propertyId').value);
      sg.innerHTML = sug && sug[0] !== who && !f('assigneeId').disabled ? '<div class="sugg" style="margin-top:6px">' + U.avatar(staff(sug[0]).name, 'sm') + '<span>Suggested: <b>' + esc(staff(sug[0]).name) + '</b> ' + esc(sug[1]) + ' (' + load(sug[0]).open + ' open)</span><button type="button" class="btn btn-quiet btn-xs" data-use="' + sug[0] + '">Assign</button></div>' : '';
    }
    el.addEventListener('change', function (e) {
      if (e.target.name === 'type' && isNew) {
        f('checklist').value = DEF_CHECK[f('type').value];
        if (!f('title').dataset.touched) f('title').value = { Turnover: 'Turnover clean', Inspection: 'Pre-arrival inspection', Restock: 'Restock welcome kit', Maintenance: '' }[f('type').value];
      }
      paintLoad();
    });
    el.addEventListener('input', function (e) { if (e.target.name === 'title') e.target.dataset.touched = '1'; });
    el.addEventListener('click', function (e) { var u = e.target.closest('[data-use]'); if (u) { f('assigneeId').value = u.dataset.use; paintLoad(); } });
    paintLoad();
  }
  function readForm(el, t) {
    var f = function (n) { return O.$('[name=' + n + ']', el); };
    var title = f('title').value.trim(), date = f('date').value, time = f('time').value;
    if (!title) { U.toast('Give the task a name', 'bad'); f('title').focus(); return null; }
    if (!date || !time) { U.toast('Choose a due date and time', 'bad'); return null; }
    var n = Math.max(0, Math.min(22, parseInt(f('checklist').value, 10) || 0));
    var pr = O.$('[name=priority]:checked', el);
    return {
      title: title, type: f('type').value, propertyId: f('propertyId').value || null,
      assigneeId: f('assigneeId').disabled ? (t.assigneeId || O.state.viewer) : (f('assigneeId').value || null),
      priority: pr ? pr.value : 'medium', due: date + 'T' + time, checklistN: n, note: f('note').value.trim(), notify: f('notify').checked
    };
  }

  function newTask(preset) {
    preset = preset || {};
    var base = { id: '', title: 'Turnover clean', type: 'Turnover', propertyId: preset.propertyId || '', assigneeId: can('assignTasks') ? (preset.assigneeId || '') : O.state.viewer, priority: 'medium', due: D.TODAY + 'T16:00', checklist: [0, 12], note: '' };
    U.modal({
      title: 'New task', sub: 'Pick who does it now, or leave it unassigned and assign later', body: formHTML(base), size: 'wide',
      onOpen: function (el) { wireForm(el, base, true); O.$('[name=title]', el).select(); },
      actions: [{ label: 'Cancel', kind: 'ghost' }, {
        label: 'Create task', kind: 'primary', onClick: function (close, el) {
          var v = readForm(el, base); if (!v) return false;
          var t = { id: nextId(), title: v.title, type: v.type, propertyId: v.propertyId, assigneeId: v.assigneeId, due: v.due, priority: v.priority, status: 'todo' };
          if (v.checklistN) t.checklist = [0, v.checklistN];
          if (v.note) t.note = v.note;
          D.tasks.push(t);
          audit('Created "' + t.title + '"' + (t.propertyId ? ' (' + prop(t.propertyId).short + ')' : '') + (t.assigneeId ? ' for ' + staff(t.assigneeId).name : ', unassigned'));
          U.toast(t.assigneeId ? t.title + ' created and assigned to ' + staff(t.assigneeId).name + (v.notify ? '. ' + first(staff(t.assigneeId).name) + ' was notified on WhatsApp.' : '.') : t.title + ' created. It is unassigned, so it is flagged until someone takes it.', t.assigneeId ? 'ok' : 'bad');
          changed('task-new');
        }
      }]
    });
  }

  function detail(id) {
    var t = D.tasks.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    var p = prop(t.propertyId), labels = CHECK[t.type] || [], ed = canEdit();
    var arrive = p && t.type !== 'Maintenance' ? D.bookings.filter(function (b) { return b.propertyId === p.id && b.status !== 'cancelled' && b.checkIn >= t.due.slice(0, 10) && b.checkIn <= d.add(t.due.slice(0, 10), 1); })[0] : null;
    function clHTML() {
      if (!t.checklist || !t.checklist[1]) return '<div class="muted small">No checklist for this task.</div>';
      return '<div class="cl">' + labels.slice(0, t.checklist[1]).map(function (lb, i) { var dn = i < t.checklist[0]; return '<label class="' + (dn ? 'done' : '') + '"><input type="checkbox" data-cl="' + i + '"' + (dn ? ' checked' : '') + (ed ? '' : ' disabled') + '><span>' + esc(lb) + '</span></label>'; }).join('') + '</div>';
    }
    function phHTML() {
      var tiles = '', urls = t.photoUrls || [], n = Math.max(t.photos || 0, urls.length);
      for (var i = 0; i < n; i++) tiles += '<div class="tile">' + (urls[i] ? '<img src="' + urls[i] + '" alt="Task photo ' + (i + 1) + '">' : O.icon('camera')) + '</div>';
      return '<div class="ph">' + tiles + (ed ? '<label class="tile">' + O.icon('camera') + 'Add photo<input type="file" accept="image/*" capture="environment" data-photo></label>' : (n ? '' : '<span class="small muted">No photos yet.</span>')) + '</div>';
    }
    var body = '<div class="tk-modal stack">' +
      '<div class="row-flex wrap">' + statusPill(t.status) + priPill(t.priority) + '<span class="due ' + dueLabel(t).cls + '" style="margin:0">' + esc(dueLabel(t).txt) + '</span>' + (arrive ? '<button type="button" class="btn btn-quiet btn-xs" data-bk="' + arrive.id + '" style="margin-left:auto">' + O.icon('bookings') + 'Next arrival: ' + esc(arrive.guest.name) + ', ' + d.fmt(arrive.checkIn) + ' ' + fmt.time(arrive.checkInTime) + '</button>' : '') + '</div>' +
      (t.checklist && t.checklist[1] ? '<div><div class="row-flex" style="justify-content:space-between;margin-bottom:6px"><span class="label">Checklist</span><span class="small muted" data-clc>' + t.checklist[0] + ' of ' + t.checklist[1] + ' done</span></div><div class="progress" style="margin-bottom:8px"><i data-clbar style="width:' + Math.round(t.checklist[0] / t.checklist[1] * 100) + '%"></i></div><div data-clbox>' + clHTML() + '</div></div>' : '') +
      '<div><span class="label">Photos</span><div data-phbox style="margin-top:6px">' + phHTML() + '</div></div>' +
      (noteShown(t) ? '<div><span class="label">Notes</span><div class="small" style="margin-top:4px">' + esc(noteShown(t)) + '</div></div>' : '') +
      (ed ? '<details><summary class="small b" style="cursor:pointer;padding:4px 0">Edit details and assignee</summary><div style="margin-top:10px">' + formHTML(t) + '</div></details>' : '') +
      '</div>';
    U.modal({
      title: t.title, sub: t.id + ' · ' + t.type + ' · ' + (p ? p.name : 'General') + (t.assigneeId ? ' · ' + staff(t.assigneeId).name : ' · Unassigned'), body: body, size: 'wide',
      onOpen: function (el, close) {
        if (ed) wireForm(el, t, false);
        el.addEventListener('change', function (e) {
          var c = e.target.closest('[data-cl]');
          if (c) {
            var i = +c.dataset.cl; t.checklist[0] = c.checked ? Math.max(t.checklist[0], i + 1) : i;
            O.$('[data-clbox]', el).innerHTML = clHTML();
            O.$('[data-clc]', el).textContent = t.checklist[0] + ' of ' + t.checklist[1] + ' done';
            O.$('[data-clbar]', el).style.width = Math.round(t.checklist[0] / t.checklist[1] * 100) + '%';
            if (t.status === 'todo' && t.checklist[0] > 0) { t.status = 'in_progress'; audit('Started "' + t.title + '"' + (p ? ' (' + p.short + ')' : '') + ' by ticking the checklist'); U.toast('Checklist started, task moved to in progress'); }
            st.dirty = true;
          }
          if (e.target.matches('[data-photo]') && e.target.files[0]) {
            t.photoUrls = t.photoUrls || []; var n0 = Math.max(t.photos || 0, t.photoUrls.length);
            while (t.photoUrls.length < n0) t.photoUrls.push(null);
            t.photoUrls.push(URL.createObjectURL(e.target.files[0])); t.photos = t.photoUrls.length;
            O.$('[data-phbox]', el).innerHTML = phHTML(); st.dirty = true;
            U.toast('Photo added to ' + t.id);
          }
        });
        el.addEventListener('click', function (e) { var b = e.target.closest('[data-bk]'); if (b) { close(); O.booking.open(b.dataset.bk); } });
      },
      onClose: function () { if (st.dirty) { st.dirty = false; changed('task-edit'); } },
      actions: !ed ? [{ label: 'Close', kind: 'ghost' }] : [
        { label: 'Delete', kind: 'ghost', onClick: function (close) { U.confirm('Delete "' + t.title + '"? This cannot be undone.', 'Delete task', 'danger').then(function (ok) { if (!ok) return; D.tasks.splice(D.tasks.indexOf(t), 1); audit('Deleted "' + t.title + '"'); U.toast('Task deleted'); close(); changed('task-delete'); }); return false; } },
        t.status === 'done' ? { label: 'Reopen', kind: 'ghost', onClick: function () { move(t, 'todo'); st.dirty = true; } } : { label: 'Mark done', kind: 'ghost', onClick: function () { move(t, 'done'); st.dirty = true; } },
        {
          label: 'Save changes', kind: 'primary', onClick: function (close, el) {
            var v = readForm(el, t); if (!v) return false;
            var who = v.assigneeId;
            t.title = v.title; t.type = v.type; t.propertyId = v.propertyId; t.priority = v.priority; t.due = v.due; t.note = v.note || undefined;
            if (v.checklistN) t.checklist = [Math.min(t.checklist ? t.checklist[0] : 0, v.checklistN), v.checklistN]; else delete t.checklist;
            if (who !== t.assigneeId) assign(t, who, !v.notify); else U.toast('Task saved');
            st.dirty = true;
          }
        }
      ]
    });
  }

  /* ---------- page ---------- */
  O.page('tasks', {
    desc: 'Turnovers, inspections and repairs across every property, and who is doing them',
    render: function (root, ctx) {
      var p = ctx.params || {};
      if (ctx.fresh && (p.assignee || p.due || p.propertyId)) {
        /* links from the dashboard or bell: start from clean filters so old ones do not hide the result */
        st.assignee = p.assignee || 'all'; st.due = p.due || 'all'; st.propertyId = p.propertyId || ''; st.type = ''; st.q = '';
        st.autoMe = false; st.col = p.due === 'overdue' || p.assignee === 'unassigned' ? 'todo' : st.col;
      }
      if (!st.defaulted || st.viewerSeen !== O.state.viewer) {
        st.defaulted = true; st.viewerSeen = O.state.viewer; st.sel = {};
        if (!can('assignTasks') && !p.assignee) { st.assignee = 'me'; st.autoMe = true; }
        else if (st.autoMe) { st.assignee = 'all'; st.autoMe = false; }
      }
      Object.keys(st.sel).forEach(function (k) { if (!D.tasks.some(function (t) { return t.id === k; })) delete st.sel[k]; });

      if (!canSee()) {
        ctx.setActions('');
        var mine = D.tasks.filter(function (t) { return isOpen(t) && t.assigneeId === O.state.viewer; });
        root.innerHTML = '<div class="pg-tasks stack"><div class="locked"><div class="lk">🔒</div><b>Tasks are not part of the ' + esc(O.viewer().roleLabel) + ' role</b><div class="small">You are viewing as ' + esc(O.viewer().name) + '. An account owner can turn on Tasks for this role in Staff Access.</div></div>' +
          (mine.length ? '<div class="note">' + fmt.plural(mine.length, 'task is', 'tasks are') + ' still assigned to you. Ask the ops manager to reassign ' + (mine.length === 1 ? 'it' : 'them') + '.</div>' : '') + '</div>';
        return;
      }
      var edit = canEdit();
      ctx.setActions('<button type="button" class="btn btn-ghost" data-act="csv">' + O.icon('download') + 'Export CSV</button>' + (edit ? '<button type="button" class="btn btn-primary" data-act="new">' + O.icon('plus') + 'New task</button>' : ''));
      ctx.actionsEl.onclick = function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'new') newTask({ propertyId: st.propertyId, assigneeId: /^s\d/.test(st.assignee) ? st.assignee : '' });
        if (b.dataset.act === 'csv') {
          var rows = [['Task ID', 'Task', 'Type', 'Property', 'Due', 'Priority', 'Status', 'Assigned to', 'Checklist', 'Note']].concat(filtered().sort(byDue).map(function (t) {
            return [t.id, t.title, t.type, prop(t.propertyId) ? prop(t.propertyId).name : 'General', t.due.replace('T', ' '), PRI[t.priority][0], { todo: 'To do', in_progress: 'In progress', done: 'Done' }[t.status], staff(t.assigneeId) ? staff(t.assigneeId).name : 'Unassigned', t.checklist ? t.checklist[0] + '/' + t.checklist[1] : '', t.note || ''];
          }));
          O.downloadCSV('tasks-' + D.TODAY + '.csv', rows);
          U.toast(fmt.plural(rows.length - 1, 'task') + ' exported to CSV');
        }
      };

      var list = filtered();
      var mineNote = !edit ? '<div class="note" style="margin-bottom:12px">You are viewing as ' + esc(O.viewer().name) + '. Your role can see tasks but not change them (Tasks is set to View in Staff Access).</div>'
        : !can('assignTasks') ? '<div class="note" style="margin-bottom:12px">You are viewing as ' + esc(O.viewer().name) + '. You can update and finish your tasks; reassigning to other people needs the <b>Assign tasks</b> permission in Staff Access.</div>' : '';
      var openN = list.filter(isOpen).length, odN = list.filter(isOverdue).length, unN = list.filter(function (t) { return isOpen(t) && !t.assigneeId; }).length;
      var colCount = function (k) { return list.filter(function (t) { return t.status === k; }).length; };
      root.innerHTML = '<div class="pg-tasks">' + kpis() + mineNote +
        '<div class="section-title" style="margin-top:0">Open tasks per person today <span class="faint" style="text-transform:none;letter-spacing:0;font-weight:600">· due today or overdue. Click a person to filter.</span></div>' + workload() +
        filtersHTML() +
        '<div class="sumrow"><div class="small muted">' + fmt.plural(list.length, 'task') + ' shown · ' + openN + ' open' + (odN ? ' · <b style="color:var(--bad)">' + odN + ' overdue</b>' : '') + (unN ? ' · <b style="color:var(--warn)">' + unN + ' unassigned</b>' : '') + '</div>' +
        U.seg([['board', 'Board'], ['list', 'List']], st.view, 'data-view') + '</div>' +
        (edit ? bulkBar() : '') +
        (st.view === 'board' ? '<div class="colsw">' + U.seg(STATUS.map(function (x) { return [x[0], x[1] + ' (' + colCount(x[0]) + ')']; }), st.col, 'data-col') + '</div>' + boardHTML(list) : listHTML(list)) +
        '<div class="small faint" style="margin-top:12px">Prototype: WhatsApp notifications to staff are not really sent.</div>' +
        '</div>';

      if (ctx.fresh && p.taskId) setTimeout(function () { detail(p.taskId); }, 0);

      var pg = O.$('.pg-tasks', root);
      pg.addEventListener('click', function (e) {
        var b;
        if ((b = e.target.closest('[data-view]'))) { st.view = b.dataset.view; ctx.rerender(); return; }
        if ((b = e.target.closest('[data-col]'))) { st.col = b.dataset.col; ctx.rerender(); return; }
        if ((b = e.target.closest('[data-due]'))) { st.due = b.dataset.due; ctx.rerender(); return; }
        if ((b = e.target.closest('[data-who]'))) { st.assignee = st.assignee === b.dataset.who ? 'all' : b.dataset.who; ctx.rerender(); return; }
        if ((b = e.target.closest('[data-open]'))) { detail(b.dataset.open); return; }
        if ((b = e.target.closest('[data-sort]'))) { if (st.sort === b.dataset.sort) st.dir = -st.dir; else { st.sort = b.dataset.sort; st.dir = 1; } ctx.rerender(); return; }
        if ((b = e.target.closest('[data-move]'))) { var t = D.tasks.filter(function (x) { return x.id === b.dataset.move; })[0]; if (t) { move(t, b.dataset.to); changed(); } return; }
        if ((b = e.target.closest('[data-act]'))) {
          var a = b.dataset.act, ids = Object.keys(st.sel).filter(function (k) { return st.sel[k]; });
          var sel = D.tasks.filter(function (x) { return ids.indexOf(x.id) >= 0; });
          if (a === 'clear') { st.assignee = 'all'; st.propertyId = ''; st.type = ''; st.due = 'all'; st.q = ''; ctx.rerender(); }
          if (a === 'more-done') { st.showAllDone = true; ctx.rerender(); }
          if (a === 'bulk-clear') { st.sel = {}; ctx.rerender(); }
          if (a === 'bulk-assign') {
            var who = O.$('[data-bulk-who]', pg).value;
            if (!who) { U.toast('Choose who to assign them to', 'bad'); return; }
            var moved = sel.filter(function (t) { return t.assigneeId !== who; });
            moved.forEach(function (t) { assign(t, who, true); });
            U.toast(moved.length ? fmt.plural(moved.length, 'task') + ' assigned to ' + staff(who).name + '. ' + first(staff(who).name) + ' got one WhatsApp message with the list.' : 'Those tasks are already with ' + staff(who).name + '.');
            st.sel = {}; changed('task-assign');
          }
          if (a === 'bulk-move') {
            sel.forEach(function (t) { if (t.status !== b.dataset.to) move(t, b.dataset.to, true); });
            U.toast(fmt.plural(sel.length, 'task') + (b.dataset.to === 'done' ? ' marked done' : ' started'));
            st.sel = {}; changed('task-move');
          }
        }
      });
      pg.addEventListener('change', function (e) {
        var el = e.target;
        if (el.matches('[data-assign]')) { var t = D.tasks.filter(function (x) { return x.id === el.dataset.assign; })[0]; if (t) { assign(t, el.value); changed('task-assign'); } return; }
        if (el.matches('[data-pick]')) { st.sel[el.dataset.pick] = el.checked; ctx.rerender(); return; }
        if (el.matches('[data-pick-all]')) { list.forEach(function (t) { st.sel[t.id] = el.checked; }); ctx.rerender(); return; }
        if (el.matches('[data-f]') && el.dataset.f !== 'q') { st[el.dataset.f] = el.value; ctx.rerender(); }
      });
      var q = O.$('[data-f=q]', pg), qt;
      q.addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(function () { st.q = q.value; ctx.rerender(); var n = O.$('.pg-tasks [data-f=q]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); });
    }
  });
})();
