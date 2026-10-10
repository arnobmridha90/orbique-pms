/* Tasks & Cleaning (v4)
   Arnob: "Make sure I have the option of assigning tasks to staff."
          "Set checklists for check-in and check-out turnovers and also daily housekeeping."
   Tasks tab:      board or list, people chips (filter + workload), filters, bulk actions, task detail with
                   checklist ticking, photo note, mark done (all required items ticked, or with a reason).
   Checklists tab: the three templates in D.checklists (view; edit with tasks.checklists) and the switches for
                   automatic tasks (D.taskAutomation, config blob; change with automations.toggle).
   Background job O.automation.register('tasks'): check-out turnovers, check-in readiness and daily housekeeping,
                   ids TO-<bookingId>, CI-<bookingId>, DH-<bookingId>-<date>. Runs at boot, each new day and whenever
                   bookings change (a 'data' listener below compares a booking signature). */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;

  var TYPES = ['Turnover', 'Housekeeping', 'Inspection', 'Maintenance', 'Restock'];
  var STATUS = [['todo', 'To do'], ['in_progress', 'In progress'], ['done', 'Done']];
  var PRI = { high: ['High', 'bad'], medium: ['Medium', 'warn'], low: ['Low', 'neutral'] };
  var PRI_RANK = { high: 0, medium: 1, low: 2 };
  /* automatic task kinds; each one uses the checklist template of the same kind */
  var KIND = {
    checkout: { prefix: 'TO', title: 'Turnover clean', type: 'Turnover', label: 'Check-out turnover' },
    checkin: { prefix: 'CI', title: 'Check-in readiness', type: 'Inspection', label: 'Check-in readiness' },
    daily: { prefix: 'DH', title: 'Daily housekeeping', type: 'Housekeeping', label: 'Daily housekeeping' }
  };
  var KIND_ORDER = ['checkout', 'checkin', 'daily'];

  /* ---------- settings blob for automatic tasks (config: a fresh workspace keeps these defaults) ---------- */
  var AUTO_DEFAULTS = { checkout: true, checkin: true, daily: true, checkoutDaysAhead: 2, checkinDaysAhead: 1, dailyMinNights: 3, dailyTime: '12:00', dismissed: {} };
  if (O.sync && O.sync.blob) O.sync.blob('taskAutomation', 'config');
  D.taskAutomation = D.taskAutomation || JSON.parse(JSON.stringify(AUTO_DEFAULTS));
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  /* read: merged with defaults, never writes (so just looking does not save anything) */
  function autoCfg() {
    var s = isObj(D.taskAutomation) ? D.taskAutomation : {}, o = {};
    Object.keys(AUTO_DEFAULTS).forEach(function (k) { o[k] = s[k] == null ? AUTO_DEFAULTS[k] : s[k]; });
    o.checkoutDaysAhead = clampInt(o.checkoutDaysAhead, 0, 7, 2); o.checkinDaysAhead = clampInt(o.checkinDaysAhead, 0, 7, 1); o.dailyMinNights = clampInt(o.dailyMinNights, 1, 30, 3);
    if (!/^\d{2}:\d{2}$/.test(o.dailyTime)) o.dailyTime = AUTO_DEFAULTS.dailyTime;
    o.dismissed = isObj(s.dismissed) ? s.dismissed : {};
    return o;
  }
  /* write: the blob itself, completed with defaults */
  function autoBlob() {
    if (!isObj(D.taskAutomation)) D.taskAutomation = {};
    var s = D.taskAutomation;
    Object.keys(AUTO_DEFAULTS).forEach(function (k) { if (s[k] == null) s[k] = JSON.parse(JSON.stringify(AUTO_DEFAULTS[k])); });
    if (!isObj(s.dismissed)) s.dismissed = {};
    return s;
  }
  function clampInt(v, lo, hi, dflt) { v = parseInt(v, 10); return isNaN(v) ? dflt : Math.max(lo, Math.min(hi, v)); }

  /* ---------- small helpers ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toMin(hm) { var p = String(hm || '').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }
  function toHM(m) { m = Math.max(0, Math.min(23 * 60 + 59, Math.round(m))); return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function dayOf(t) { return String(t.due || '').slice(0, 10); }
  function staff(id) { return id ? D.staffById(id) : null; }
  function staffName(id) { var s = staff(id); return s ? s.name : id ? 'Former team member' : 'Unassigned'; }
  function first(name) { var w = String(name || '').split(' '); return w.length >= 3 && w[0].length <= 3 ? w[0] + ' ' + w[1] : w[0]; }
  function prop(id) { return id ? D.propById[id] : null; }
  function propShort(id) { var p = prop(id); return p ? p.short || p.name : id ? 'Removed property' : 'General'; }
  function taskById(id) { return D.tasks.filter(function (x) { return x.id === id; })[0] || null; }
  function isOpen(t) { return t.status !== 'done'; }
  function isOverdue(t) { return isOpen(t) && !!t.due && t.due < D.NOW; }
  function isToday(t) { return dayOf(t) === D.TODAY; }
  function liveBooking(b) { return !!b && b.status !== 'cancelled' && b.status !== 'pending'; }
  function weekBounds() { var dw = d.dow(D.TODAY), mon = d.add(D.TODAY, dw === 0 ? -6 : 1 - dw); return [mon, d.add(mon, 6)]; }
  function noteShown(t) { return t.note && !/^(unassigned|overdue\b)/i.test(t.note) ? t.note : ''; }
  function audit(text) { if (!Array.isArray(D.auditLog)) return; D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: 'tasks', text: text }); }
  function changed(type) { O.emit('data', { type: type || 'tasks' }); }
  function isPhone() { return window.matchMedia && window.matchMedia('(max-width: 760px)').matches; }
  function noAccess(key) { return 'Your access does not include "' + O.permLabel(key) + '". An account owner can change this in Staff Access.'; }

  /* permissions (new keys from O.PERMS) */
  var can = {
    see: function () { return O.can('tasks'); },
    edit: function () { return O.can('tasks', 'edit'); },
    create: function () { return O.can('tasks.create'); },
    assign: function () { return O.can('tasks.assign'); },
    others: function () { return O.can('tasks.others'); },
    del: function () { return O.can('tasks.delete'); },
    lists: function () { return O.can('tasks.checklists'); },
    auto: function () { return O.can('automations.toggle'); }
  };
  /* people who can be given tasks: their access includes Tasks at Edit (keeps the current assignee listed) */
  function assignable(keepId) {
    return D.staff.filter(function (s) { return s.id === keepId || O.can('tasks', 'edit', s.id); });
  }

  /* ---------- checklists ---------- */
  function tplOfKind(kind) { return O.checklist.byKind(kind); }
  function items(t) { return O.checklist.items(t) || []; }
  function progress(t) { return O.checklist.progress(t); }
  function missingRequired(t) { var ck = t.checks || []; return items(t).filter(function (x) { return !x.optional && ck.indexOf(x.id) < 0; }); }
  /* the automatic-task kind of any task: its template's kind, else guessed from type and title */
  function kindOf(t) {
    if (t.auto && KIND[t.auto]) return t.auto;
    var tpl = t.checklistId && O.checklist.template(t.checklistId);
    if (tpl && KIND[tpl.kind]) return tpl.kind;
    if (t.customChecklist) return null;
    if (t.type === 'Housekeeping' || (t.type === 'Turnover' && /daily|mid-stay/i.test(t.title || ''))) return 'daily';
    if (t.type === 'Turnover') return 'checkout';
    if (t.type === 'Inspection' && /arriv|check-?in|readiness/i.test(t.title || '')) return 'checkin';
    return null;
  }
  function defaultChecklistId(type, title) {
    if (type === 'Housekeeping') { var h = tplOfKind('daily'); return h ? h.id : null; }
    var id = O.checklist.forType(type, title);
    return id && O.checklist.template(id) ? id : null;
  }
  /* tasks made by older code carry checklist: [done, total]; turn them into checklistId + checks */
  function normalize(t) {
    var touched = false;
    if (Array.isArray(t.checklist)) {
      if (!t.checklistId && !t.customChecklist) {
        var cid = defaultChecklistId(t.type, t.title), tpl = cid && O.checklist.template(cid);
        if (tpl) {
          var n = t.status === 'done' ? tpl.items.length : Math.round((+t.checklist[0] || 0) / (+t.checklist[1] || 1) * tpl.items.length);
          t.checklistId = tpl.id; t.checks = tpl.items.slice(0, n).map(function (x) { return x.id; });
        }
      }
      delete t.checklist; touched = true;
    }
    if ((t.checklistId || t.customChecklist) && !Array.isArray(t.checks)) { t.checks = []; touched = true; }
    return touched;
  }

  /* ===================================================================
     AUTOMATIC TASKS
     =================================================================== */
  function housekeeperOf(p) {
    var s = p && p.housekeeper ? staff(p.housekeeper) : null; if (!s) return null;
    var m = (D.staffMeta || {})[s.id]; if (m && (m.status === 'suspended' || m.removed)) return null;
    return s.id;
  }
  function autoId(kind, b, day) { return KIND[kind].prefix + '-' + b.id + (kind === 'daily' ? '-' + day : ''); }
  function sameDayArrival(pid, day, exceptId) {
    return D.bookings.filter(function (x) { return x.id !== exceptId && x.propertyId === pid && liveBooking(x) && x.checkIn === day; })[0] || null;
  }
  /* the task a booking should have; everything comes from the booking, property and settings so two devices build the same record */
  function plan(kind, b, day, cfg) {
    var p = prop(b.propertyId), k = KIND[kind], tpl = tplOfKind(kind), due, pri = 'medium';
    if (kind === 'checkout') {
      var out = toMin(b.checkOutTime || '11:00'), nx = sameDayArrival(b.propertyId, day, b.id);
      due = nx ? Math.max(out + 45, toMin(nx.checkInTime || '15:00') - 45) : out + 180;
      if (nx) pri = 'high';
    } else if (kind === 'checkin') {
      due = toMin(b.checkInTime || '15:00') - 15;
    } else {
      due = toMin(cfg.dailyTime); pri = 'low';
    }
    var dueStr = day + 'T' + toHM(due);
    return {
      id: autoId(kind, b, day), title: k.title, type: k.type, propertyId: b.propertyId, assigneeId: housekeeperOf(p),
      due: dueStr, priority: pri, status: 'todo', checklistId: tpl ? tpl.id : null, checks: [],
      bookingId: b.id, auto: kind, autoDue: dueStr
    };
  }
  /* nobody has touched an automatic task yet: safe to move with its booking or remove when the booking goes */
  function untouched(t) { return !!t.auto && t.status === 'todo' && !(t.checks || []).length && t.due === t.autoDue && !t.photoNote; }
  /* automatic ids a deleted task stands for (so deleting a manual turnover does not bring an automatic one back) */
  function slotIds(kind, pid, day) {
    if (!kind || !pid || !day) return [];
    return D.bookings.filter(function (b) {
      if (b.propertyId !== pid || b.status === 'cancelled') return false;
      return kind === 'checkout' ? b.checkOut === day : kind === 'checkin' ? b.checkIn === day : b.checkIn < day && day < b.checkOut;
    }).map(function (b) { return autoId(kind, b, day); });
  }
  function dismiss(t) {
    var ids = slotIds(kindOf(t), t.propertyId, dayOf(t));
    if (t.auto) ids.push(t.id);
    if (!ids.length) return 0;
    var dis = autoBlob().dismissed;
    ids.forEach(function (id) { dis[id] = dayOf(t) || D.TODAY; });
    return ids.length;
  }

  var lastSig = null;
  function signature() {
    var c = autoCfg();
    return D.TODAY + '|' + [c.checkout, c.checkin, c.daily, c.checkoutDaysAhead, c.checkinDaysAhead, c.dailyMinNights, c.dailyTime].join(',') + '|' +
      D.properties.map(function (p) { return p.id + ':' + (p.housekeeper || ''); }).join(',') + '|' +
      D.checklists.map(function (c) { return c.id; }).join(',') + '|' +
      D.bookings.map(function (b) { return [b.id, b.propertyId, b.checkIn, b.checkOut, b.checkInTime, b.checkOutTime, b.status].join(':'); }).join(';');
  }
  /* returns {changed, created: [tasks]} — idempotent: running it twice changes nothing the second time */
  function runAuto() {
    var res = { changed: 0, created: [] };
    if (!Array.isArray(D.tasks) || !Array.isArray(D.bookings)) return res;
    var c = autoCfg(), T = D.TODAY;
    D.tasks.forEach(function (t) { if (t && normalize(t)) res.changed++; });
    /* forget dismissals older than 30 days */
    if (isObj(D.taskAutomation) && isObj(D.taskAutomation.dismissed)) {
      var dis = D.taskAutomation.dismissed, old = d.add(T, -30);
      Object.keys(dis).forEach(function (k) { if (typeof dis[k] !== 'string' || dis[k] < old) { delete dis[k]; res.changed++; } });
    }
    var byId = {}; D.tasks.forEach(function (t) { if (t && t.id) byId[t.id] = t; });
    function taken(kind, pid, day) { return D.tasks.some(function (t) { return t.propertyId === pid && dayOf(t) === day && kindOf(t) === kind; }); }
    function want(kind, b, day, inWindow) {
      var t = byId[autoId(kind, b, day)];
      if (!t && !inWindow) return;
      var pl = plan(kind, b, day, c);
      if (t) { /* follow date or time changes of the booking while nobody has started it */
        if (untouched(t) && t.due !== pl.due) { t.due = pl.due; t.autoDue = pl.due; res.changed++; }
        return;
      }
      if (!inWindow || c.dismissed[pl.id] || taken(kind, b.propertyId, day)) return;
      D.tasks.push(pl); byId[pl.id] = pl; res.created.push(pl); res.changed++;
    }
    function drop(t) { var i = D.tasks.indexOf(t); if (i >= 0) { D.tasks.splice(i, 1); delete byId[t.id]; res.changed++; } }
    D.bookings.slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }).forEach(function (b) {
      if (!b || !b.id || !prop(b.propertyId)) return;
      if (!liveBooking(b)) { /* cancelled (or back to pending): remove automatic tasks nobody started, from today on */
        D.tasks.slice().forEach(function (t) { if (t.bookingId === b.id && t.auto && untouched(t) && dayOf(t) >= T) drop(t); });
        return;
      }
      want('checkout', b, b.checkOut, c.checkout && b.checkOut >= T && b.checkOut <= d.add(T, c.checkoutDaysAhead));
      want('checkin', b, b.checkIn, c.checkin && b.checkIn >= T && b.checkIn <= d.add(T, c.checkinDaysAhead));
      var nights = b.nights || d.diff(b.checkIn, b.checkOut);
      if (c.daily && nights >= c.dailyMinNights && b.checkIn < T && T < b.checkOut) want('daily', b, T, true);
      /* daily tasks for days the stay no longer covers (dates changed) */
      D.tasks.slice().forEach(function (t) { if (t.bookingId === b.id && t.auto === 'daily' && untouched(t) && dayOf(t) >= T && !(b.checkIn < dayOf(t) && dayOf(t) < b.checkOut)) drop(t); });
    });
    lastSig = signature();
    return res;
  }
  /* core runs jobs after load ('boot', then saves) and on a new day ('day', then emits 'data'); other reasons emit here */
  if (O.automation && O.automation.register) O.automation.register('tasks', function (reason) {
    var r = runAuto();
    if (r.changed && reason !== 'boot' && reason !== 'day') changed('task-auto');
  });
  /* bookings changed (added, moved, cancelled; here or on another device): run again */
  var sigTimer = null;
  O.on('data', function () {
    if (!O._started || !O.sync || !O.sync.canWrite()) return;
    clearTimeout(sigTimer);
    sigTimer = setTimeout(function () {
      var legacy = D.tasks.some(function (t) { return t && Array.isArray(t.checklist); });
      if (!legacy && signature() === lastSig) return;
      var r = runAuto();
      if (r.changed) changed('task-auto');
    }, 80);
  });

  /* ===================================================================
     PAGE STATE + CSS
     =================================================================== */
  var st = { tab: 'tasks', view: 'board', col: 'todo', assignee: 'all', propertyId: '', type: '', due: 'today', q: '', sel: {}, sort: 'due', dir: 1, showAllDone: false, viewerSeen: null };

  O.css('tasks', `
.pg-tasks .tk-tabs{margin-bottom:14px;}
.pg-tasks .tk-today{display:flex; align-items:center; gap:6px 14px; flex-wrap:wrap; font-size:13px; color:var(--text-2); margin-bottom:12px;}
.pg-tasks .tk-today b{color:var(--text);}
.pg-tasks .tk-today .tk-q{background:none; border:none; padding:0; font:inherit; font-weight:700; color:var(--text-2); text-decoration:underline; text-decoration-color:var(--border-strong); text-underline-offset:3px;}
.pg-tasks .tk-today .tk-q.bad{color:var(--bad); text-decoration-color:currentColor;}
.pg-tasks .tk-today .tk-q.warn{color:var(--warn); text-decoration-color:currentColor;}
.pg-tasks .tk-today .tk-q:hover{color:var(--text);}
.pg-tasks .tk-today .sep{color:var(--border-strong);}
.pg-tasks .tk-people{display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;}
.pg-tasks .tk-people .chip{padding:4px 11px 4px 5px; min-height:34px;}
.pg-tasks .tk-people .chip.all{padding-left:12px;}
.pg-tasks .tk-people .chip .n{min-width:18px; text-align:center;}
.pg-tasks .tk-people .chip.un{border-style:dashed; border-color:var(--warn); color:var(--warn); padding-left:12px;}
.pg-tasks .tk-people .chip.un.on{background:var(--warn); color:#FFFFFF; border-style:solid;}
.pg-tasks .tk-people .chip.on .avatar{box-shadow:0 0 0 2px var(--brand-ink);}
.pg-tasks .tk-filters{display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:12px;}
.pg-tasks .tk-filters .select{width:auto; min-width:150px; max-width:230px; height:36px;}
.pg-tasks .tk-filters .search{flex:0 1 220px; min-width:160px;}
.pg-tasks .tk-filters .grow{flex:1;}
.pg-tasks .tk-fbtn{display:none;}
.pg-tasks .tk-mine{font-size:12px; color:var(--muted); margin:-4px 0 12px;}
.pg-tasks .tk-colsw{display:none; margin-bottom:10px;}
.pg-tasks .tk-colsw .seg{display:flex; width:100%;}
.pg-tasks .tk-colsw .seg button{flex:1; padding-left:4px; padding-right:4px; white-space:nowrap; min-height:38px;}
.pg-tasks .tk-bulk{display:flex; align-items:center; gap:8px; flex-wrap:wrap; background:var(--brand-soft); border:1px solid var(--brand-strong); border-radius:10px; padding:8px 12px; margin-bottom:12px; position:sticky; top:72px; z-index:5;}
.pg-tasks .tk-bulk .select{width:auto; min-width:190px; height:32px; padding-top:4px; padding-bottom:4px;}
.pg-tasks .tk-board{display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; align-items:start;}
.pg-tasks .tk-col{background:var(--surface-2); border:1px solid var(--border); border-radius:12px; padding:10px; min-width:0;}
.pg-tasks .tk-col-h{display:flex; align-items:center; gap:8px; padding:2px 4px 10px; font-weight:800; font-size:13px;}
.pg-tasks .tk-col-h .cnt{background:var(--surface); border:1px solid var(--border); border-radius:20px; font-size:11px; padding:0 8px; font-weight:700; color:var(--text-2);}
.pg-tasks .tk-col-h .dot{width:9px; height:9px; border-radius:50%;}
.pg-tasks .tk-col-list{display:flex; flex-direction:column; gap:8px;}
.pg-tasks .tk-day{font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:var(--muted); padding:6px 4px 0;}
.pg-tasks .tk-day.od{color:var(--bad);}
.pg-tasks .tk-day:first-child{padding-top:0;}
.pg-tasks .tk-card{background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:10px 12px; box-shadow:var(--shadow); display:flex; flex-direction:column; gap:6px; min-width:0;}
.pg-tasks .tk-card.od{box-shadow:inset 3px 0 0 var(--bad), var(--shadow);}
.pg-tasks .tk-card.un{box-shadow:inset 3px 0 0 var(--warn), var(--shadow); border-style:dashed; border-color:var(--warn);}
.pg-tasks .tk-card.sel{outline:2px solid var(--brand-strong); outline-offset:-1px;}
.pg-tasks .tk-card.done{background:var(--surface);}
.pg-tasks .tk-card.done .tk-title{color:var(--text-2);}
.pg-tasks .tk-top{display:flex; align-items:center; gap:6px; font-size:11px; color:var(--muted); font-weight:700; min-width:0;}
.pg-tasks .tk-top input{width:16px; height:16px; accent-color:var(--brand-strong); margin:0; flex-shrink:0;}
.pg-tasks .tk-top .tk-type{white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.pg-tasks .tk-auto{display:inline-flex; color:var(--faint); flex-shrink:0;}
.pg-tasks .tk-auto svg{width:12px; height:12px;}
.pg-tasks .tk-title{background:none; border:none; padding:0; text-align:left; font-weight:800; font-size:14px; color:var(--text); line-height:1.3;}
.pg-tasks .tk-title:hover{color:var(--brand-text); text-decoration:underline;}
.pg-tasks .tk-where{display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-2); font-weight:600; min-width:0;}
.pg-tasks .tk-where span{white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.pg-tasks .tk-ctx{font-size:11.5px; color:var(--muted); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
.pg-tasks .tk-prog{display:flex; align-items:center; gap:8px; font-size:11px; color:var(--muted); font-weight:700; font-variant-numeric:tabular-nums;}
.pg-tasks .tk-prog .progress{flex:1;}
.pg-tasks .tk-prog.full .progress > i{background:var(--ok);}
.pg-tasks .tk-foot{display:flex; align-items:center; gap:6px; border-top:1px solid var(--border); padding-top:8px; min-width:0;}
.pg-tasks .tk-foot .select{flex:1 1 120px; min-width:0; height:32px; padding-top:4px; padding-bottom:4px; font-size:12px; font-weight:600;}
.pg-tasks .tk-who{flex:1; min-width:0; display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:var(--text-2);}
.pg-tasks .tk-who span{white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.pg-tasks .select.unassigned{border-color:var(--warn); background-color:var(--warn-soft); color:var(--warn); font-weight:700;}
.pg-tasks .due{font-size:11px; font-weight:700; white-space:nowrap; margin-left:auto; flex-shrink:0;}
.pg-tasks .due.od{color:var(--bad);} .pg-tasks .due.soon{color:var(--warn);} .pg-tasks .due.norm{color:var(--text-2);}
.pg-tasks .tk-more{width:100%;}
.pg-tasks .tk-table .tt{background:none; border:none; padding:0; font-weight:700; text-align:left; color:var(--text);}
.pg-tasks .tk-table .tt:hover{color:var(--brand-text); text-decoration:underline;}
.pg-tasks .tk-table th, .pg-tasks .tk-table td{padding-left:10px; padding-right:10px;}
.pg-tasks .tk-table .select{min-width:140px; max-width:180px; height:32px; padding-top:4px; padding-bottom:4px; font-size:12px;}
.pg-tasks .tk-table th.sortable{cursor:pointer; user-select:none;}
.pg-tasks .tk-table th.sortable:hover{color:var(--text);}
.pg-tasks .tk-table tr.od td:first-child{box-shadow:inset 3px 0 0 var(--bad);}
.pg-tasks .tk-table tr.un td:first-child{box-shadow:inset 3px 0 0 var(--warn);}
.pg-tasks .tk-table input[type=checkbox]{width:16px; height:16px; accent-color:var(--brand-strong);}
.pg-tasks .tk-table .pc{display:inline-flex; align-items:center; gap:6px; white-space:nowrap;}
.pg-tasks .tk-table .st-cell{display:flex; align-items:center; gap:8px; min-width:150px;}
.pg-tasks .tk-table .st-cell .progress{width:60px;}
.pg-tasks .btn svg{width:14px; height:14px;}
.pg-tasks .tk-foot-note{font-size:11.5px; color:var(--faint); margin-top:14px;}
.pg-tasks .tk-empty{padding:34px 18px; text-align:center;}
.pg-tasks .tk-empty p{margin:0 auto 14px; max-width:460px; color:var(--text-2); font-size:13.5px; line-height:1.5;}
/* checklists tab */
.pg-tasks .tk-cl-grid{display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; align-items:start;}
.pg-tasks .tk-tpl .card-head{align-items:flex-start; flex-wrap:nowrap;}
.pg-tasks .tk-tpl .card-head > div{min-width:0;}
.pg-tasks .tk-tpl .card-head .btn{flex-shrink:0;}
.pg-tasks .tk-auto-row{display:flex; gap:10px; align-items:flex-start; padding:12px 16px; border-bottom:1px solid var(--border); background:var(--surface-2); font-size:12.5px;}
.pg-tasks .tk-auto-row .switch{margin-top:1px;}
.pg-tasks .tk-auto-row .switch[disabled]{opacity:0.5; cursor:not-allowed;}
.pg-tasks .tk-auto-row b{display:block; font-size:13px;}
.pg-tasks .tk-auto-row .muted{line-height:1.45;}
.pg-tasks .tk-auto-row .grow{flex:1; min-width:0;}
.pg-tasks .tk-auto-sets{display:flex; flex-wrap:wrap; gap:8px 14px; margin-top:8px;}
.pg-tasks .tk-auto-set{display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700; color:var(--text-2); white-space:nowrap; min-width:0;}
.pg-tasks .tk-auto-set .select{width:auto; height:32px; padding-top:2px; padding-bottom:2px; font-size:12.5px; font-weight:700;}
.pg-tasks .tk-auto-set .input{width:auto; height:32px; padding-top:2px; padding-bottom:2px; font-size:12.5px;}
.pg-tasks .tk-items{list-style:none; margin:0; padding:6px 16px 10px; counter-reset:tki;}
.pg-tasks .tk-items li{counter-increment:tki; display:flex; gap:10px; align-items:baseline; padding:7px 0; border-bottom:1px solid var(--border); font-size:13px; line-height:1.4;}
.pg-tasks .tk-items li:last-child{border-bottom:none;}
.pg-tasks .tk-items li::before{content:counter(tki); font-size:11px; font-weight:800; color:var(--faint); min-width:16px; text-align:right; font-variant-numeric:tabular-nums;}
.pg-tasks .tk-items .pill{margin-left:auto;}
.pg-tasks .tk-tpl .card-foot{display:flex; justify-content:space-between; align-items:center; gap:8px;}
.pg-tasks .tk-cl-note{font-size:12px; color:var(--muted); margin-top:14px; line-height:1.5;}
/* modals */
.tk-modal .tk-head{display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
.tk-modal .tk-head .due{font-size:12px; font-weight:700; white-space:nowrap;}
.tk-modal .due.od{color:var(--bad);} .tk-modal .due.soon{color:var(--warn);} .tk-modal .due.norm{color:var(--text-2);}
.tk-modal .tk-bk{display:flex; align-items:center; gap:10px; width:100%; text-align:left; background:var(--surface-2); border:1px solid var(--border); border-radius:10px; padding:9px 12px; font-size:12.5px; color:var(--text-2);}
.tk-modal .tk-bk:hover{border-color:var(--border-strong);}
.tk-modal .tk-bk svg{width:16px; height:16px; color:var(--muted); flex-shrink:0;}
.tk-modal .tk-bk b{color:var(--text);}
.tk-modal .tk-prog-h{display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin-bottom:6px;}
.tk-modal .tk-prog-h b{font-size:13px;}
.tk-modal .tk-prog-h span{font-size:12px; color:var(--muted); font-weight:700; font-variant-numeric:tabular-nums;}
.tk-modal .tk-bar{height:8px; margin-bottom:10px;}
.tk-modal .tk-bar.full > i{background:var(--ok);}
.tk-modal .tk-cl{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px;}
.tk-modal .tk-ci{display:flex; gap:10px; align-items:center; min-height:44px; padding:8px 10px; border:1px solid var(--border); border-radius:9px; font-size:13px; line-height:1.35; cursor:pointer; background:var(--surface);}
.tk-modal .tk-ci:hover{border-color:var(--border-strong);}
.tk-modal .tk-ci input{width:20px; height:20px; accent-color:var(--brand-strong); margin:0; flex-shrink:0;}
.tk-modal .tk-ci.done{background:var(--ok-soft); border-color:transparent;}
.tk-modal .tk-ci.done .tk-ci-t{color:var(--muted); text-decoration:line-through;}
.tk-modal .tk-ci .pill{margin-left:auto;}
.tk-modal .tk-ci.ro{cursor:default;}
.tk-modal .tk-ready{display:flex; align-items:center; gap:10px; justify-content:space-between; flex-wrap:wrap; margin-top:10px; padding:9px 12px; border-radius:10px; background:var(--ok-soft); color:var(--ok); font-weight:700; font-size:12.5px;}
.tk-modal .tk-pn{display:flex; gap:12px; align-items:flex-start;}
.tk-modal .tk-pn .tile{width:96px; height:96px; border-radius:10px; flex-shrink:0; overflow:hidden; border:1px solid var(--border); background:var(--surface-2); position:relative;}
.tk-modal .tk-pn .tile img{width:100%; height:100%; object-fit:cover; display:block;}
.tk-modal .tk-pn label.tile{display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; border-style:dashed; color:var(--brand-text); font-size:11.5px; font-weight:700; cursor:pointer; background:var(--surface);}
.tk-modal .tk-pn label.tile svg{width:22px; height:22px;}
.tk-modal .tk-pn label.tile input{position:absolute; width:1px; height:1px; opacity:0; pointer-events:none;}
.tk-modal .tk-pn .tk-pn-side{flex:1; min-width:0; display:flex; flex-direction:column; gap:6px;}
.tk-modal .tk-pn textarea{min-height:64px;}
.tk-modal .tk-pn .tk-pn-meta{font-size:11px; color:var(--faint);}
.tk-modal .tk-done{font-size:12.5px;}
.tk-modal .pseg{display:flex; gap:6px;}
.tk-modal .pseg label{flex:1; display:flex; align-items:center; justify-content:center; gap:6px; border:1px solid var(--border); border-radius:8px; padding:7px; font-size:12.5px; font-weight:700; cursor:pointer; min-height:38px;}
.tk-modal .pseg input{accent-color:var(--brand-strong);}
.tk-modal .pseg label:has(input:checked){border-color:var(--brand-strong); background:var(--brand-soft);}
.tk-modal .load{font-size:11.5px; color:var(--muted); margin-top:4px;}
.tk-modal .load b{color:var(--text);}
.tk-modal .sugg{display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:12px; background:var(--brand-soft); border-radius:8px; padding:7px 10px; margin-top:6px;}
.tk-modal .tk-reasons{display:flex; gap:6px; flex-wrap:wrap;}
.tk-modal .tk-miss{margin:6px 0 0; padding-left:18px; font-size:12.5px; color:var(--text-2); line-height:1.5;}
/* checklist editor */
.tk-ed .tk-ed-list{display:flex; flex-direction:column; gap:6px;}
.tk-ed .tk-ed-row{display:flex; align-items:center; gap:6px;}
.tk-ed .tk-ed-n{width:20px; text-align:right; font-size:11px; font-weight:800; color:var(--faint); flex-shrink:0; font-variant-numeric:tabular-nums;}
.tk-ed .tk-ed-row .input{flex:1; min-width:0; height:38px;}
.tk-ed .icon-btn{width:34px; height:34px; display:inline-flex; align-items:center; justify-content:center; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--text-2); flex-shrink:0; padding:0;}
.tk-ed .icon-btn:hover{border-color:var(--border-strong); color:var(--text);}
.tk-ed .icon-btn[disabled]{opacity:0.35; cursor:not-allowed;}
.tk-ed .icon-btn svg{width:15px; height:15px;}
.tk-ed .tk-opt-btn{height:34px; border:1px solid var(--border); border-radius:8px; background:var(--surface); font-size:11.5px; font-weight:700; color:var(--muted); padding:0 9px; flex-shrink:0; white-space:nowrap;}
.tk-ed .tk-opt-btn.on{background:var(--surface-2); color:var(--text); border-color:var(--border-strong);}
.tk-ed .tk-ed-add{display:flex; gap:8px; margin-top:10px;}
.tk-ed .tk-ed-add .input{flex:1; min-width:0; height:38px;}
@media (max-width:1100px){
  .pg-tasks .tk-board{grid-template-columns:minmax(0,1fr);}
  .pg-tasks .tk-colsw{display:block;}
  .pg-tasks .tk-board .tk-col:not(.cur){display:none;}
  .pg-tasks .tk-board .tk-col-h{display:none;}
  .pg-tasks .tk-cl-grid{grid-template-columns:minmax(0,1fr);}
}
@media (min-width:761px) and (max-width:1100px){
  .pg-tasks .tk-col-list{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); align-items:start;}
  .pg-tasks .tk-day, .pg-tasks .tk-more, .pg-tasks .tk-col-list > .empty{grid-column:1/-1;}
}
@media (max-width:760px){
  .pg-tasks .tk-viewsw{display:none;}
  .pg-tasks .tk-people{flex-wrap:nowrap; overflow-x:auto; margin-left:-14px; margin-right:-14px; padding:0 14px 2px; scrollbar-width:none;}
  .pg-tasks .tk-people::-webkit-scrollbar{display:none;}
  .pg-tasks .tk-people .chip{flex-shrink:0; min-height:40px;}
  .pg-tasks .tk-filters .select{flex:1 1 140px; min-width:0; max-width:none; height:40px;}
  .pg-tasks .tk-filters .seg{display:flex; flex:1; min-width:0; flex-wrap:nowrap;}
  .pg-tasks .tk-filters .seg button{flex:1 1 auto; min-height:36px; padding-left:3px; padding-right:3px; white-space:nowrap;}
  .pg-tasks .tk-filters .search{flex:1 1 100%; height:40px;}
  .pg-tasks .tk-fbtn{display:inline-flex; width:42px; height:42px; padding:0; gap:2px; flex-shrink:0;}
  .pg-tasks .tk-fbtn.on{border-color:var(--brand-strong); color:var(--brand-text);}
  .pg-tasks .tk-filters .tk-fx{display:none;}
  .pg-tasks .tk-filters.open .tk-fx{display:flex;}
  .pg-tasks .tk-autoinfo, .pg-tasks .tk-autoinfo-sep{display:none;}
  .pg-tasks .tk-auto-set{flex:1 1 100%;}
  .pg-tasks .tk-auto-set .select{flex:1; min-width:0; height:40px;}
  .pg-tasks .tk-auto-set .input{height:40px;}
  .pg-tasks .tk-auto-set > span{min-width:64px;}
  .tk-csv{display:none !important;}
  .pg-tasks .tk-filters .grow{display:none;}
  .pg-tasks .tk-bulk{position:static;}
  .pg-tasks .tk-bulk .select{flex:1 1 100%;}
  .pg-tasks .tk-card{padding:12px;}
  .pg-tasks .tk-foot .btn{min-height:40px; padding-left:12px; padding-right:12px;}
  .pg-tasks .tk-foot .select{height:40px;}
  .pg-tasks .tk-col{padding:8px; border-radius:12px;}
  .tk-modal .tk-cl{grid-template-columns:minmax(0,1fr);}
  .tk-modal .tk-ci{min-height:52px; font-size:14px; padding:10px 12px;}
  .tk-modal .tk-ci input{width:24px; height:24px;}
  .tk-ed .icon-btn, .tk-ed .tk-opt-btn{height:40px;} .tk-ed .icon-btn{width:40px;}
  .tk-ed .tk-ed-row{flex-wrap:wrap;}
  .tk-ed .tk-ed-row .input{flex:1 1 calc(100% - 30px); height:42px;}
  .tk-ed .tk-ed-n{display:none;}
  .tk-ed .tk-ed-row .tk-opt-btn{margin-right:auto;}
  .tk-ed .tk-ed-row{padding-bottom:8px; border-bottom:1px solid var(--border);}
}
`);

  /* ===================================================================
     PIECES
     =================================================================== */
  function dueLabel(t) {
    if (!t.due) return { cls: 'norm', txt: 'No due date' };
    var day = dayOf(t), tm = fmt.time(t.due);
    if (t.status === 'done') {
      var by = t.doneBy || t.assigneeId;
      return { cls: 'norm', txt: (t.doneAt ? 'Done ' + (t.doneAt.slice(0, 10) === D.TODAY ? fmt.time(t.doneAt) : d.fmt(t.doneAt.slice(0, 10))) : 'Done') + (by && staff(by) ? ' by ' + first(staff(by).name) : '') };
    }
    if (t.due < D.NOW) {
      var late = day < D.TODAY ? (d.diff(day, D.TODAY) === 1 ? 'since yesterday' : 'since ' + d.fmt(day)) : 'since ' + tm;
      return { cls: 'od', txt: 'Overdue ' + late };
    }
    var mins = (Date.parse(t.due + ':00Z') - Date.parse(D.NOW + ':00Z')) / 6e4;
    if (day === D.TODAY) return { cls: mins <= 120 ? 'soon' : 'norm', txt: 'Today ' + tm + (mins <= 120 ? ' · in ' + (mins < 60 ? Math.max(1, Math.round(mins)) + 'm' : (mins / 60).toFixed(1).replace('.0', '') + 'h') : '') };
    if (d.diff(D.TODAY, day) === 1) return { cls: 'norm', txt: 'Tomorrow ' + tm };
    return { cls: 'norm', txt: d.dowName(day) + ' ' + d.fmt(day) + ', ' + tm };
  }
  function dayHeading(day) {
    if (day === D.TODAY) return 'Today';
    if (d.diff(D.TODAY, day) === 1) return 'Tomorrow';
    return d.dowName(day) + ' ' + d.fmt(day);
  }
  /* one short line about the stay behind a task (live from the booking, so it never goes stale) */
  function stayLine(t, long) {
    var k = kindOf(t), day = dayOf(t), pid = t.propertyId; if (!pid || !k) return '';
    var b = t.bookingId ? D.booking(t.bookingId) : null;
    if (k === 'checkout') {
      b = b || D.bookings.filter(function (x) { return x.propertyId === pid && x.status !== 'cancelled' && x.checkOut === day; })[0];
      var nx = sameDayArrival(pid, day, b && b.id), out = [];
      if (b) out.push((long ? b.guest.name + ' checks out ' : 'Guest out ') + fmt.time(b.checkOutTime));
      if (nx) out.push((long ? 'next guest ' + nx.guest.name + ' arrives ' : 'next in ') + fmt.time(nx.checkInTime));
      else if (long && b) out.push('no arrival the same day');
      return out.join(' · ');
    }
    if (k === 'checkin') {
      b = b || D.bookings.filter(function (x) { return x.propertyId === pid && liveBooking(x) && x.checkIn === day; })[0];
      return b ? b.guest.name + ' arrives ' + fmt.time(b.checkInTime) + ' · ' + fmt.plural(b.guests || 1, 'guest') : '';
    }
    b = b || D.bookings.filter(function (x) { return x.propertyId === pid && liveBooking(x) && x.checkIn < day && day < x.checkOut; })[0];
    if (!b) return '';
    var n = b.nights || d.diff(b.checkIn, b.checkOut);
    return b.guest.name + ' · night ' + (d.diff(b.checkIn, day) + 1) + ' of ' + n;
  }
  function stayBooking(t) {
    if (t.bookingId && D.booking(t.bookingId)) return D.booking(t.bookingId);
    var k = kindOf(t), day = dayOf(t), pid = t.propertyId; if (!pid || !k) return null;
    if (k === 'checkout') return sameDayArrival(pid, day) || D.bookings.filter(function (x) { return x.propertyId === pid && x.status !== 'cancelled' && x.checkOut === day; })[0] || null;
    if (k === 'checkin') return sameDayArrival(pid, day);
    return D.bookings.filter(function (x) { return x.propertyId === pid && liveBooking(x) && x.checkIn < day && day < x.checkOut; })[0] || null;
  }

  function visible() {
    var v = O.state.viewer, all = can.others();
    return D.tasks.filter(function (t) { return t && (all || t.assigneeId === v); });
  }
  function filtered() {
    var v = O.state.viewer, wk = weekBounds(), q = st.q.trim().toLowerCase();
    return visible().filter(function (t) {
      if (st.assignee === 'me' && t.assigneeId !== v) return false;
      if (st.assignee === 'unassigned' && t.assigneeId) return false;
      if (/^(?!all$|me$|unassigned$)/.test(st.assignee) && t.assigneeId !== st.assignee) return false;
      if (st.propertyId && t.propertyId !== st.propertyId) return false;
      if (st.type && t.type !== st.type) return false;
      var day = dayOf(t);
      if (st.due === 'overdue' && !isOverdue(t)) return false;
      if (st.due === 'today' && !(day === D.TODAY || isOverdue(t))) return false;
      if (st.due === 'week' && (day < wk[0] || day > wk[1])) return false;
      if (q) {
        var p = prop(t.propertyId), s = staff(t.assigneeId);
        var hay = [t.id, t.title, t.type, t.note || '', p ? p.name + ' ' + (p.short || '') : 'general', s ? s.name : 'unassigned', stayLine(t, true)].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function byDue(a, b) { return (a.due || '') < (b.due || '') ? -1 : (a.due || '') > (b.due || '') ? 1 : (PRI_RANK[a.priority] || 1) - (PRI_RANK[b.priority] || 1); }

  function todayLine() {
    var vis = visible(), due = vis.filter(isToday), done = due.filter(function (t) { return t.status === 'done'; }).length;
    var od = vis.filter(isOverdue).length, un = can.others() ? vis.filter(function (t) { return isOpen(t) && !t.assigneeId; }).length : 0;
    var auto = vis.filter(function (t) { return t.auto && isToday(t); }).length;
    var parts = ['<span><b>Today</b> ' + fmt.plural(due.length, 'task') + (due.length ? ', ' + done + ' done' : '') + '</span>'];
    if (od) parts.push('<button type="button" class="tk-q bad" data-quick="overdue">' + od + ' overdue</button>');
    if (un) parts.push('<button type="button" class="tk-q warn" data-quick="unassigned">' + un + ' unassigned</button>');
    var html = parts.join('<span class="sep" aria-hidden="true">·</span>');
    if (auto) html += '<span class="sep tk-autoinfo-sep" aria-hidden="true">·</span><span class="muted tk-autoinfo">' + auto + ' created automatically from bookings</span>';
    return '<div class="tk-today">' + html + '</div>';
  }

  function peopleChips() {
    if (!can.others()) return '';
    var people = assignable().filter(function (s) { return s.role !== 'accountant'; });
    var open = visible().filter(isOpen);
    if (people.length < 2 && !open.length) return '';
    var un = open.filter(function (t) { return !t.assigneeId; }).length;
    function chip(id, inner, cls, title) { return '<button type="button" class="chip ' + (cls || '') + (st.assignee === id ? ' on' : '') + '" data-who="' + id + '" aria-pressed="' + (st.assignee === id) + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + inner + '</button>'; }
    return '<div class="tk-people" role="group" aria-label="Filter by person">' +
      chip('all', 'Everyone <span class="n">' + open.length + '</span>', 'all', open.length + ' open tasks') +
      people.map(function (s) {
        var mine = open.filter(function (t) { return t.assigneeId === s.id; }), now = mine.filter(function (t) { return dayOf(t) <= D.TODAY; }).length;
        return chip(s.id, U.avatar(s.name, 'sm') + esc(s.id === O.state.viewer ? 'You' : first(s.name)) + ' <span class="n">' + mine.length + '</span>', '',
          s.name + ', ' + s.roleLabel + ': ' + fmt.plural(mine.length, 'open task') + ', ' + now + ' due today or overdue');
      }).join('') +
      (un || st.assignee === 'unassigned' ? chip('unassigned', 'Unassigned <span class="n">' + un + '</span>', 'un', 'Open tasks nobody has yet') : '') +
      '</div>';
  }

  function filtersHTML() {
    var active = st.propertyId || st.type || st.due !== 'today' || st.q || (st.assignee !== 'all' && !st.autoMe);
    var extra = (st.propertyId ? 1 : 0) + (st.type ? 1 : 0) + (st.q ? 1 : 0);
    return '<div class="tk-filters' + (st.fopen || extra ? ' open' : '') + '">' +
      U.seg([['today', 'Today'], ['overdue', 'Overdue'], ['week', 'This week'], ['all', 'Any day']], st.due, 'data-due') +
      '<button type="button" class="btn btn-ghost tk-fbtn' + (extra ? ' on' : '') + '" data-act="fopen" aria-expanded="' + !!(st.fopen || extra) + '" aria-label="More filters' + (extra ? ', ' + extra + ' on' : '') + '">' + O.icon('filter') + (extra ? '<b>' + extra + '</b>' : '') + '</button>' +
      (D.properties.length ? '<select class="select tk-fx" data-f="propertyId" aria-label="Property">' + U.propOptions(st.propertyId, { all: 'All properties' }) + '</select>' : '') +
      '<select class="select tk-fx" data-f="type" aria-label="Type"><option value="">All types</option>' + TYPES.map(function (t) { return '<option' + (st.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>' +
      '<label class="search tk-fx"><span class="sr-only">Search tasks</span>' + O.icon('search') + '<input type="search" data-f="q" placeholder="Search tasks" value="' + esc(st.q) + '"></label>' +
      (active ? '<button type="button" class="btn btn-quiet btn-sm" data-act="clear">Clear</button>' : '') +
      '<span class="grow"></span><span class="tk-viewsw">' + U.seg([['board', 'Board'], ['list', 'List']], st.view, 'data-view') + '</span>' +
      '</div>';
  }

  function bulkBar() {
    var ids = Object.keys(st.sel).filter(function (k) { return st.sel[k]; });
    if (!ids.length) return '';
    return '<div class="tk-bulk" role="region" aria-label="Bulk actions"><b>' + fmt.plural(ids.length, 'task') + ' selected</b>' +
      (can.assign() ? '<select class="select" data-bulk-who aria-label="Assign selected to">' + assigneeOptions('', { noneLabel: 'Assign to…' }) + '</select><button type="button" class="btn btn-primary btn-sm" data-act="bulk-assign">Assign</button>' : '') +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="bulk-move" data-to="in_progress">' + O.icon('play') + 'Start</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="bulk-move" data-to="done">' + O.icon('check') + 'Mark done</button>' +
      '<button type="button" class="btn btn-quiet btn-sm" data-act="bulk-clear">Clear selection</button></div>';
  }

  function load(id) { return D.tasks.filter(function (t) { return isOpen(t) && t.assigneeId === id; }).length; }
  function assigneeOptions(selId, opts) {
    opts = opts || {};
    return '<option value=""' + (!selId ? ' selected' : '') + '>' + esc(opts.noneLabel || 'Unassigned') + '</option>' + assignable(selId).map(function (s) {
      var l = load(s.id);
      return '<option value="' + s.id + '"' + (s.id === selId ? ' selected' : '') + '>' + esc(opts.short ? first(s.name) : s.name) + (opts.short ? '' : ' · ' + esc(s.roleLabel)) + ' · ' + (l ? l + ' open' : 'free') + '</option>';
    }).join('');
  }
  function whoHTML(t) {
    if (can.edit() && can.assign()) return '<select class="select' + (!t.assigneeId ? ' unassigned' : '') + '" data-assign="' + esc(t.id) + '" aria-label="Assigned to, ' + esc(t.title) + '">' + assigneeOptions(t.assigneeId, { noneLabel: 'Assign someone', short: true }) + '</select>';
    var s = staff(t.assigneeId);
    return '<span class="tk-who" title="' + esc(can.assign() ? 'View only' : noAccess('tasks.assign')) + '">' + (s ? U.avatar(s.name, 'sm') + '<span>' + esc(s.id === O.state.viewer ? 'You' : s.name) + '</span>' : '<span style="color:var(--warn)">Unassigned</span>') + '</span>';
  }
  function moveButtons(t, size) {
    if (!can.edit()) return '';
    var c = 'btn btn-' + (size || 'xs');
    if (t.status === 'todo') return '<button type="button" class="' + c + ' btn-ghost" data-move="' + t.id + '" data-to="in_progress">' + O.icon('play') + 'Start</button><button type="button" class="' + c + ' btn-ghost" data-move="' + t.id + '" data-to="done" aria-label="Mark done, ' + esc(t.title) + '">' + O.icon('check') + 'Done</button>';
    if (t.status === 'in_progress') return '<button type="button" class="' + c + ' btn-primary" data-move="' + t.id + '" data-to="done" aria-label="Mark done, ' + esc(t.title) + '">' + O.icon('check') + 'Done</button>';
    return '<button type="button" class="' + c + ' btn-ghost" data-move="' + t.id + '" data-to="todo">' + O.icon('refresh') + 'Reopen</button>';
  }
  function progHTML(t) {
    var pg = progress(t); if (!pg.total || !pg.done || t.status === 'done') return '';
    return '<div class="tk-prog' + (pg.done === pg.total ? ' full' : '') + '"><div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="' + pg.total + '" aria-valuenow="' + pg.done + '" aria-label="Checklist"><i style="width:' + Math.round(pg.pct * 100) + '%"></i></div>' + pg.done + '/' + pg.total + '</div>';
  }
  function autoMark(t) { return t.auto ? '<span class="tk-auto" title="Created automatically from booking ' + esc(t.bookingId || '') + '">' + O.icon('automations') + '</span>' : ''; }

  function card(t) {
    var dl = dueLabel(t), od = isOverdue(t), un = isOpen(t) && !t.assigneeId, ctxLine = noteShown(t) || stayLine(t);
    var pick = can.edit() && can.others();
    return '<article class="tk-card' + (od ? ' od' : un ? ' un' : '') + (t.status === 'done' ? ' done' : '') + (st.sel[t.id] ? ' sel' : '') + '">' +
      '<div class="tk-top">' + (pick ? '<input type="checkbox" data-pick="' + esc(t.id) + '"' + (st.sel[t.id] ? ' checked' : '') + ' aria-label="Select ' + esc(t.title) + '">' : '') +
      (t.priority === 'high' && isOpen(t) ? U.pill('High', 'bad') : '') + '<span class="tk-type">' + esc(t.type) + '</span>' + autoMark(t) +
      (t.photoNote ? '<span class="tk-auto" title="Has a photo note">' + O.icon('camera') + '</span>' : '') +
      '<span class="due ' + dl.cls + '">' + esc(dl.txt) + '</span></div>' +
      '<button type="button" class="tk-title" data-open="' + esc(t.id) + '">' + esc(t.title) + '</button>' +
      '<div class="tk-where"><span class="prop-dot" style="background:' + (t.propertyId ? U.propColor(t.propertyId) : 'var(--border-strong)') + '"></span><span>' + esc(propShort(t.propertyId)) + '</span></div>' +
      (ctxLine ? '<div class="tk-ctx">' + esc(ctxLine) + '</div>' : '') +
      progHTML(t) +
      '<div class="tk-foot">' + whoHTML(t) + moveButtons(t) + '</div></article>';
  }

  function boardHTML(list) {
    return '<div class="tk-board">' + STATUS.map(function (s) {
      var its = list.filter(function (t) { return t.status === s[0]; });
      if (s[0] === 'done') its.sort(function (a, b) { return (b.doneAt || b.due || '') < (a.doneAt || a.due || '') ? -1 : 1; });
      else its.sort(function (a, b) { var ao = isOverdue(a), bo = isOverdue(b); if (ao !== bo) return ao ? -1 : 1; return byDue(a, b); });
      var shown = s[0] === 'done' && !st.showAllDone ? its.slice(0, 6) : its;
      var dot = s[0] === 'done' ? 'var(--ok)' : s[0] === 'in_progress' ? 'var(--info)' : 'var(--border-strong)';
      var emptyMsg = s[0] === 'todo' ? 'Nothing waiting.' : s[0] === 'in_progress' ? 'Nothing in progress.' : 'Nothing finished yet.';
      var html = '', lastHead = null;
      shown.forEach(function (t) {
        if (s[0] === 'todo') {
          var head = isOverdue(t) ? 'Overdue' : dayHeading(dayOf(t));
          if (head !== lastHead && (lastHead !== null || head !== 'Today')) html += '<div class="tk-day' + (head === 'Overdue' ? ' od' : '') + '">' + esc(head) + '</div>';
          lastHead = head;
        }
        html += card(t);
      });
      return '<section class="tk-col' + (st.col === s[0] ? ' cur' : '') + '" aria-label="' + s[1] + '"><div class="tk-col-h"><span class="dot" style="background:' + dot + '"></span>' + s[1] + '<span class="cnt">' + its.length + '</span></div><div class="tk-col-list">' +
        (shown.length ? html : '<div class="empty" style="padding:18px 8px">' + esc(emptyMsg) + '</div>') +
        (its.length > shown.length ? '<button type="button" class="btn btn-ghost btn-sm tk-more" data-act="more-done">Show ' + (its.length - shown.length) + ' more</button>' : '') +
        '</div></section>';
    }).join('') + '</div>';
  }

  function listHTML(list) {
    var key = st.sort, dir = st.dir;
    var val = {
      due: function (t) { return t.due || ''; }, title: function (t) { return t.title; },
      property: function (t) { return t.propertyId ? propShort(t.propertyId) : 'zz'; }, assignee: function (t) { return t.assigneeId ? staffName(t.assigneeId) : 'zz'; },
      status: function (t) { return ['todo', 'in_progress', 'done'].indexOf(t.status) * 2 - progress(t).pct; }
    }[key] || function (t) { return t.due || ''; };
    list = list.slice().sort(function (a, b) { var x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : byDue(a, b)) * dir; });
    function th(k, label) { return '<th class="sortable" data-sort="' + k + '" aria-sort="' + (st.sort === k ? (dir > 0 ? 'ascending' : 'descending') : 'none') + '">' + label + (st.sort === k ? (dir > 0 ? ' ↑' : ' ↓') : '') + '</th>'; }
    if (!list.length) return '<div class="card">' + U.empty('No tasks match these filters.', '✓') + '</div>';
    var pick = can.edit() && can.others(), allSel = list.every(function (t) { return st.sel[t.id]; });
    return '<div class="card"><div class="table-wrap"><table class="table tk-table"><thead><tr>' + (pick ? '<th style="width:34px"><input type="checkbox" data-pick-all' + (allSel ? ' checked' : '') + ' aria-label="Select all"></th>' : '') +
      th('title', 'Task') + th('property', 'Property') + th('due', 'Due') + th('assignee', 'Assigned to') + th('status', 'Progress') + (can.edit() ? '<th><span class="sr-only">Actions</span></th>' : '') + '</tr></thead><tbody>' +
      list.map(function (t) {
        var dl = dueLabel(t), pg = progress(t);
        var stCell = t.status === 'done' ? U.pill('Done', 'ok') : (pg.total ? '<div class="progress"><i style="width:' + Math.round(pg.pct * 100) + '%"></i></div><span class="xs muted">' + pg.done + '/' + pg.total + '</span>' : '') + (t.status === 'in_progress' ? U.pill('In progress', 'info') : pg.total ? '' : U.pill('To do', 'neutral'));
        return '<tr class="' + (isOverdue(t) ? 'od' : isOpen(t) && !t.assigneeId ? 'un' : '') + '">' + (pick ? '<td><input type="checkbox" data-pick="' + esc(t.id) + '"' + (st.sel[t.id] ? ' checked' : '') + ' aria-label="Select ' + esc(t.title) + '"></td>' : '') +
          '<td><button type="button" class="tt" data-open="' + esc(t.id) + '">' + esc(t.title) + '</button> ' + (t.priority === 'high' && isOpen(t) ? U.pill('High', 'bad') : '') + '<div class="xs muted">' + esc(t.type) + (t.auto ? ' · automatic' : '') + '</div></td>' +
          '<td><span class="pc"><span class="prop-dot" style="background:' + (t.propertyId ? U.propColor(t.propertyId) : 'var(--border-strong)') + '"></span>' + esc(propShort(t.propertyId)) + '</span></td>' +
          '<td class="nowrap"><span class="due ' + dl.cls + '" style="margin:0">' + esc(dl.txt) + '</span></td>' +
          '<td>' + whoHTML(t) + '</td>' +
          '<td><div class="st-cell">' + stCell + '</div></td>' +
          (can.edit() ? '<td class="nowrap"><div class="row-flex" style="justify-content:flex-end">' + moveButtons(t) + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* ===================================================================
     ACTIONS
     =================================================================== */
  function assign(t, who, quiet) {
    var prev = t.assigneeId; t.assigneeId = who || null;
    var where = propShort(t.propertyId);
    if (who) {
      audit('Assigned "' + t.title + '" (' + where + ') to ' + staffName(who) + (prev ? ', was ' + staffName(prev) : ''));
      if (!quiet) U.toast(t.title + ' at ' + where + ' assigned to ' + staffName(who) + '. ' + first(staffName(who)) + ' was notified on WhatsApp.');
    } else {
      audit('Unassigned "' + t.title + '" (' + where + ')');
      if (!quiet) U.toast(t.title + ' at ' + where + ' is now unassigned', 'bad');
    }
  }
  function move(t, to, reason) {
    t.status = to;
    if (to === 'done') { t.doneAt = D.NOW; t.doneBy = O.state.viewer; if (reason) t.doneReason = reason; else delete t.doneReason; }
    else { delete t.doneAt; delete t.doneBy; delete t.doneReason; }
    audit((to === 'done' ? 'Completed' : to === 'in_progress' ? 'Started' : 'Reopened') + ' "' + t.title + '"' + (t.propertyId ? ' (' + propShort(t.propertyId) + ')' : '') + (reason ? '. Reason: ' + reason : ''));
  }
  /* mark tasks done; asks for a reason when required checklist items are still open. cb(true) when done */
  function finish(list, cb) {
    var short = list.filter(function (t) { return missingRequired(t).length; });
    function apply(reason) {
      list.forEach(function (t) { move(t, 'done', short.indexOf(t) >= 0 ? reason : null); });
      U.toast(list.length === 1 ? list[0].title + ' marked done' + (list[0].type === 'Turnover' ? '. The unit shows as clean on arrivals.' : '') : fmt.plural(list.length, 'task') + ' marked done');
      changed('task-move'); if (cb) cb(true);
    }
    if (!short.length) { apply(null); return; }
    var miss = short.length === 1 ? missingRequired(short[0]) : [];
    var body = '<div class="tk-modal stack">' +
      (short.length === 1 ? '<div class="small">' + fmt.plural(miss.length, 'required item is', 'required items are') + ' not ticked on <b>' + esc(short[0].title) + '</b>:</div><ul class="tk-miss">' + miss.slice(0, 5).map(function (x) { return '<li>' + esc(x.text) + '</li>'; }).join('') + (miss.length > 5 ? '<li>and ' + (miss.length - 5) + ' more</li>' : '') + '</ul>'
        : '<div class="small">' + fmt.plural(short.length, 'of these tasks has', 'of these tasks have') + ' required checklist items that are not ticked.</div>') +
      '<div class="field"><label for="tk-reason">Why is it done anyway?</label><div class="tk-reasons">' + ['Done without the app', 'Guest asked us not to enter', 'Not needed this time'].map(function (r) { return '<button type="button" class="chip" data-reason="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div>' +
      '<textarea class="textarea" id="tk-reason" name="reason" placeholder="A short reason the team can see"></textarea></div></div>';
    U.modal({
      title: 'Mark done without every item?', body: body, size: 'sm', autofocus: false,
      onOpen: function (el) { el.addEventListener('click', function (e) { var c = e.target.closest('[data-reason]'); if (c) { O.$('[name=reason]', el).value = c.dataset.reason; } }); },
      actions: [{ label: 'Cancel', kind: 'ghost' }, {
        label: 'Mark done', kind: 'primary', onClick: function (close, el) {
          var r = O.$('[name=reason]', el).value.trim();
          if (!r) { U.toast('Add a short reason first', 'bad'); O.$('[name=reason]', el).focus(); return false; }
          apply(r.slice(0, 300));
        }
      }]
    });
  }
  function removeTask(t, done) {
    U.confirm('Delete "' + t.title + '"' + (t.propertyId ? ' at ' + propShort(t.propertyId) : '') + '? This cannot be undone.', 'Delete task', 'danger').then(function (ok) {
      if (!ok) return;
      var i = D.tasks.indexOf(t); if (i < 0) return;
      var n = dismiss(t);
      D.tasks.splice(i, 1);
      audit('Deleted "' + t.title + '"' + (t.propertyId ? ' (' + propShort(t.propertyId) + ')' : ''));
      U.toast(n ? 'Task deleted. It will not be created again automatically.' : 'Task deleted');
      if (done) done();
      changed('task-delete');
    });
  }

  /* ---------- task form (new + edit) ---------- */
  function suggestFor(type, pid) {
    var p = prop(pid), hk = housekeeperOf(p);
    var by = function (role) { return assignable().filter(function (s) { return s.role === role; })[0]; };
    if ((type === 'Turnover' || type === 'Housekeeping' || type === 'Restock') && hk) return [hk, 'is the housekeeper for ' + (p.short || p.name)];
    if (type === 'Maintenance' && by('maintenance')) return [by('maintenance').id, 'handles maintenance'];
    if (type === 'Inspection') { if (hk) return [hk, 'looks after ' + (p.short || p.name)]; if (by('ops')) return [by('ops').id, 'runs inspections']; }
    return null;
  }
  function checklistSelect(t) {
    var cur = t.customChecklist ? '__own' : (t.checklistId || '');
    return '<select class="select" id="tk-cl" name="checklistId"><option value="">No checklist</option>' +
      D.checklists.map(function (c) { return '<option value="' + esc(c.id) + '"' + (cur === c.id ? ' selected' : '') + '>' + esc(c.name) + ' (' + c.items.length + ' items)</option>'; }).join('') +
      (t.customChecklist ? '<option value="__own" selected>Its own list (' + t.customChecklist.length + ' items)</option>' : '') + '</select>';
  }
  function formHTML(t) {
    var mine = !can.assign();
    var date = dayOf(t) || D.TODAY, time = (t.due || '').slice(11, 16) || '16:00';
    return '<div class="tk-modal stack"><div class="form-grid">' +
      '<div class="field full"><label for="tk-title">Task</label><input class="input" id="tk-title" name="title" value="' + esc(t.title) + '" placeholder="For example: Turnover clean, Fix shower head" maxlength="120" required></div>' +
      '<div class="field"><label for="tk-type">Type</label><select class="select" id="tk-type" name="type">' + TYPES.concat(TYPES.indexOf(t.type) < 0 && t.type ? [t.type] : []).map(function (x) { return '<option' + (x === t.type ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="tk-prop">Property</label><select class="select" id="tk-prop" name="propertyId"><option value="">General, no property</option>' + U.propOptions(t.propertyId) + '</select></div>' +
      '<div class="field full"><label for="tk-who">Assign to</label><select class="select" id="tk-who" name="assigneeId"' + (mine ? ' disabled title="' + esc(noAccess('tasks.assign')) + '"' : '') + '>' + assigneeOptions(t.assigneeId, { noneLabel: 'Unassigned (decide later)' }) + '</select>' +
      '<div class="load" data-load></div><div data-sugg></div>' + (mine ? '<div class="hint">Giving tasks to other people needs the "' + esc(O.permLabel('tasks.assign')) + '" permission, so this one stays with ' + (t.assigneeId && t.assigneeId !== O.state.viewer ? esc(staffName(t.assigneeId)) : 'you') + '.</div>' : '') + '</div>' +
      '<div class="field"><label for="tk-date">Due date</label><input class="input" type="date" id="tk-date" name="date" value="' + esc(date) + '" required></div>' +
      '<div class="field"><label for="tk-time">Due time</label><input class="input" type="time" id="tk-time" name="time" value="' + esc(time) + '" required></div>' +
      '<div class="field full"><span class="label">Priority</span><div class="pseg" role="radiogroup" aria-label="Priority">' + ['high', 'medium', 'low'].map(function (p) { return '<label><input type="radio" name="priority" value="' + p + '"' + ((t.priority || 'medium') === p ? ' checked' : '') + '>' + PRI[p][0] + '</label>'; }).join('') + '</div></div>' +
      '<div class="field full"><label for="tk-cl">Checklist</label>' + checklistSelect(t) + '<span class="hint">Templates are edited in the Checklists tab. Changing the list clears ticks on this task.</span></div>' +
      '<div class="field full"><label for="tk-note">Notes</label><textarea class="textarea" id="tk-note" name="note" maxlength="600" placeholder="Anything the person needs to know: arrival time, access, parts to bring">' + esc(t.note || '') + '</textarea></div>' +
      (mine ? '' : '<label class="check full"><input type="checkbox" name="notify" checked> Send the assignee a WhatsApp message</label>') +
      '</div></div>';
  }
  function wireForm(el, t, isNew) {
    var f = function (n) { return O.$('[name=' + n + ']', el); };
    function paint() {
      var who = f('assigneeId').value, box = O.$('[data-load]', el), sg = O.$('[data-sugg]', el);
      if (who && staff(who)) {
        var s = staff(who), day = f('date').value;
        var same = D.tasks.filter(function (x) { return isOpen(x) && x.assigneeId === who && dayOf(x) === day && x.id !== t.id; });
        box.innerHTML = (who === O.state.viewer ? '<b>You</b> have ' : '<b>' + esc(first(s.name)) + '</b> has ') + fmt.plural(load(who) - (t.assigneeId === who && isOpen(t) && !isNew ? 1 : 0), 'other open task') + (day ? ', ' + same.length + ' due ' + (day === D.TODAY ? 'today' : d.fmt(day)) : '') + (same.length ? ': ' + esc(same.slice(0, 3).map(function (x) { return x.title + ' ' + fmt.time(x.due); }).join(', ')) : '') + '.';
      } else box.innerHTML = can.assign() ? 'Unassigned tasks show on the dashboard until someone takes them.' : '';
      var sug = can.assign() ? suggestFor(f('type').value, f('propertyId').value) : null;
      sg.innerHTML = sug && sug[0] !== who && staff(sug[0]) ? '<div class="sugg">' + U.avatar(staff(sug[0]).name, 'sm') + '<span>Suggested: <b>' + esc(staff(sug[0]).name) + '</b> ' + esc(sug[1]) + '</span><button type="button" class="btn btn-quiet btn-xs" data-use="' + sug[0] + '">Assign</button></div>' : '';
    }
    el.addEventListener('change', function (e) {
      if (e.target.name === 'type' && isNew) {
        var ty = f('type').value;
        if (!f('title').dataset.touched) f('title').value = { Turnover: 'Turnover clean', Housekeeping: 'Daily housekeeping', Inspection: 'Check-in readiness', Restock: 'Restock welcome kit', Maintenance: '' }[ty] || '';
        var cid = defaultChecklistId(ty, f('title').value); f('checklistId').value = cid || '';
      }
      if (e.target.name === 'propertyId' && isNew && can.assign() && !f('assigneeId').value) { var sg = suggestFor(f('type').value, f('propertyId').value); if (sg) f('assigneeId').value = sg[0]; }
      paint();
    });
    el.addEventListener('input', function (e) { if (e.target.name === 'title') e.target.dataset.touched = '1'; });
    el.addEventListener('click', function (e) { var u = e.target.closest('[data-use]'); if (u) { f('assigneeId').value = u.dataset.use; paint(); } });
    paint();
  }
  function readForm(el, t) {
    var f = function (n) { return O.$('[name=' + n + ']', el); };
    var title = f('title').value.trim(), date = f('date').value, time = f('time').value;
    if (!title) { U.toast('Give the task a name', 'bad'); f('title').focus(); return null; }
    if (!date || !time) { U.toast('Choose a due date and time', 'bad'); return null; }
    var pr = O.$('[name=priority]:checked', el);
    return {
      title: title, type: f('type').value, propertyId: f('propertyId').value || null,
      assigneeId: f('assigneeId').disabled ? (t.assigneeId || O.state.viewer) : (f('assigneeId').value || null),
      priority: pr ? pr.value : 'medium', due: date + 'T' + time, checklistId: f('checklistId').value, note: f('note').value.trim(), notify: !!(f('notify') && f('notify').checked)
    };
  }

  function newTask(preset) {
    if (!can.create()) { U.toast(noAccess('tasks.create'), 'bad'); return; }
    preset = preset || {};
    var base = { id: '', title: 'Turnover clean', type: 'Turnover', propertyId: preset.propertyId || '', assigneeId: can.assign() ? (preset.assigneeId || '') : O.state.viewer, priority: 'medium', due: D.TODAY + 'T' + toHM(Math.min(23 * 60, Math.ceil((toMin(D.NOW_TIME) + 120) / 30) * 30)), checklistId: defaultChecklistId('Turnover', 'Turnover clean'), note: '' };
    if (base.propertyId && can.assign() && !base.assigneeId) { var sg = suggestFor(base.type, base.propertyId); if (sg) base.assigneeId = sg[0]; }
    U.modal({
      title: 'New task', sub: can.assign() ? 'Pick who does it now, or leave it unassigned and assign later' : 'It will be on your list', body: formHTML(base), size: 'wide',
      onOpen: function (el) { wireForm(el, base, true); O.$('[name=title]', el).select(); },
      actions: [{ label: 'Cancel', kind: 'ghost' }, {
        label: 'Create task', kind: 'primary', onClick: function (close, el) {
          var v = readForm(el, base); if (!v) return false;
          var t = { id: O.uid('T'), title: v.title, type: v.type, propertyId: v.propertyId, assigneeId: v.assigneeId, due: v.due, priority: v.priority, status: 'todo', createdAt: D.NOW, createdBy: O.state.viewer };
          if (v.checklistId && v.checklistId !== '__own') { t.checklistId = v.checklistId; t.checks = []; }
          if (v.note) t.note = v.note;
          D.tasks.push(t);
          if (st.due !== 'all' && filtered().indexOf(t) < 0) st.due = 'all'; /* keep the new task in view */
          audit('Created "' + t.title + '"' + (t.propertyId ? ' (' + propShort(t.propertyId) + ')' : '') + (t.assigneeId ? ' for ' + staffName(t.assigneeId) : ', unassigned'));
          U.toast(t.assigneeId ? t.title + ' created' + (t.assigneeId !== O.state.viewer ? ' and assigned to ' + staffName(t.assigneeId) + (v.notify ? '. ' + first(staffName(t.assigneeId)) + ' was notified on WhatsApp.' : '.') : '.') : t.title + ' created. It is unassigned, so it shows on the dashboard until someone takes it.', t.assigneeId ? 'ok' : 'bad');
          changed('task-new');
        }
      }]
    });
  }

  function editTask(t, after) {
    U.modal({
      title: 'Edit task', sub: t.title + (t.propertyId ? ' · ' + propShort(t.propertyId) : ''), body: formHTML(t), size: 'wide',
      onOpen: function (el) { wireForm(el, t, false); },
      actions: [{ label: 'Cancel', kind: 'ghost' }, {
        label: 'Save changes', kind: 'primary', onClick: function (close, el) {
          var v = readForm(el, t); if (!v) return false;
          t.title = v.title; t.type = v.type; t.propertyId = v.propertyId; t.priority = v.priority; t.due = v.due;
          if (v.note) t.note = v.note; else delete t.note;
          if (v.checklistId !== '__own') {
            var was = t.customChecklist ? '__own' : t.checklistId || '';
            if (was !== v.checklistId) { delete t.customChecklist; if (v.checklistId) { t.checklistId = v.checklistId; t.checks = []; } else { delete t.checklistId; delete t.checks; } }
          }
          if ((v.assigneeId || null) !== (t.assigneeId || null)) assign(t, v.assigneeId, !v.notify); else U.toast('Task saved');
          changed('task-edit');
          if (after) after();
        }
      }]
    });
  }

  /* ---------- photo note: one compressed photo + a short note per task ---------- */
  function compressPhoto(file, cb) {
    var url; try { url = URL.createObjectURL(file); } catch (e) { cb(null); return; }
    var img = new Image();
    img.onload = function () {
      try {
        var max = 900, w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, out = null, last = null;
        for (var pass = 0; pass < 5 && !out; pass++) {
          var k = Math.min(1, max / Math.max(w, h)), cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
          var cx = cv.getContext('2d'); cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
          for (var q = 0.72; q >= 0.4; q -= 0.08) { var s = cv.toDataURL('image/jpeg', q); last = s; if (s.length <= 110000) { out = s; break; } }
          max = Math.round(max * 0.75);
        }
        URL.revokeObjectURL(url); cb(out || (last && last.length < 160000 ? last : null));
      } catch (e) { URL.revokeObjectURL(url); cb(null); }
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }

  /* ---------- task detail ---------- */
  function detail(id) {
    var t = taskById(id);
    if (!t) { U.toast('That task no longer exists. Someone may have deleted it.', 'bad'); return; }
    if (!can.others() && t.assigneeId !== O.state.viewer) { U.toast('That task belongs to someone else. Your access shows only your own tasks.', 'bad'); return; }
    normalize(t);
    var p = prop(t.propertyId), ed = can.edit(), m = null;
    function clHTML() {
      var its = items(t), pg = progress(t), ck = t.checks || [];
      if (!its.length) return '';
      var tpl = t.checklistId && O.checklist.template(t.checklistId), full = pg.done === pg.total;
      var miss = missingRequired(t).length;
      return '<div><div class="tk-prog-h"><b>' + esc(tpl ? tpl.name : 'Checklist') + '</b><span>' + pg.done + ' of ' + pg.total + ' done</span></div>' +
        '<div class="progress tk-bar' + (full ? ' full' : '') + '"><i style="width:' + Math.round(pg.pct * 100) + '%"></i></div>' +
        '<div class="tk-cl" role="group" aria-label="Checklist">' + its.map(function (x) {
          var dn = ck.indexOf(x.id) >= 0;
          return '<label class="tk-ci' + (dn ? ' done' : '') + (ed ? '' : ' ro') + '"><input type="checkbox" data-ck="' + esc(x.id) + '"' + (dn ? ' checked' : '') + (ed ? '' : ' disabled') + '><span class="tk-ci-t">' + esc(x.text) + '</span>' + (x.optional ? U.pill('Optional', 'neutral') : '') + '</label>';
        }).join('') + '</div>' +
        (ed && isOpen(t) && !miss ? '<div class="tk-ready"><span>' + (full ? 'Everything is ticked.' : 'All required items are ticked.') + '</span><button type="button" class="btn btn-primary btn-sm" data-finish>' + O.icon('check') + 'Mark done</button></div>' : '') +
        '</div>';
    }
    function pnHTML() {
      var pn = t.photoNote || {};
      var meta = pn.at ? 'Added ' + (pn.at.slice(0, 10) === D.TODAY ? fmt.time(pn.at) : fmt.dateTime(pn.at)) + (pn.by && staff(pn.by) ? ' by ' + first(staff(pn.by).name) : '') : '';
      if (!ed) return pn.src || pn.text ? '<div class="tk-pn">' + (pn.src ? '<div class="tile"><img src="' + esc(pn.src) + '" alt="Photo note"></div>' : '') + '<div class="tk-pn-side"><div class="small">' + esc(pn.text || '') + '</div><div class="tk-pn-meta">' + esc(meta) + '</div></div></div>' : '<div class="small muted">No photo note.</div>';
      return '<div class="tk-pn">' + (pn.src ? '<div class="tile"><img src="' + esc(pn.src) + '" alt="Photo note"></div>' : '<label class="tile">' + O.icon('camera') + 'Add photo<input type="file" accept="image/*" capture="environment" data-photo></label>') +
        '<div class="tk-pn-side"><textarea class="textarea" data-pn-text maxlength="400" placeholder="Optional note, for example: stain on the sofa cushion, photo attached">' + esc(pn.text || '') + '</textarea>' +
        '<div class="row-flex" style="justify-content:space-between;gap:8px"><span class="tk-pn-meta">' + esc(meta) + '</span>' + (pn.src ? '<span class="row-flex" style="gap:4px"><label class="btn btn-quiet btn-xs" style="cursor:pointer">' + O.icon('camera') + 'Replace<input type="file" accept="image/*" capture="environment" data-photo hidden></label><button type="button" class="btn btn-quiet btn-xs" data-pn-rm>' + O.icon('trash') + 'Remove photo</button></span>' : '') + '</div></div></div>';
    }
    function headHTML() {
      var dl = dueLabel(t);
      return '<div class="tk-head">' + (t.status === 'done' ? U.pill('Done', 'ok') : t.status === 'in_progress' ? U.pill('In progress', 'info') : U.pill('To do', 'neutral')) +
        (t.status !== 'done' ? U.pill(PRI[t.priority] ? PRI[t.priority][0] + ' priority' : 'Medium priority', PRI[t.priority] ? PRI[t.priority][1] : 'warn') : '') +
        (t.status !== 'done' ? '<span class="due ' + dl.cls + '">' + esc(dl.txt) + '</span>' : '') + '</div>';
    }
    function bodyHTML() {
      var b = stayBooking(t), line = stayLine(t, true);
      return '<div class="tk-modal stack">' + headHTML() +
        (b && line ? '<button type="button" class="tk-bk" data-bk="' + esc(b.id) + '">' + O.icon('bookings') + '<span><b>' + esc(line) + '</b></span></button>' : '') +
        (noteShown(t) ? '<div class="note">' + esc(noteShown(t)) + '</div>' : '') +
        '<div data-cl>' + clHTML() + '</div>' +
        (t.status === 'done' ? '<div class="note tk-done">' + esc(dueLabel(t).txt) + (t.doneReason ? '. Reason: ' + t.doneReason : '') + '</div>' : '') +
        '<div><div class="label" style="margin-bottom:6px">Photo note <span class="faint" style="font-weight:600">· optional</span></div><div data-pn>' + pnHTML() + '</div></div>' +
        (t.auto ? '<div class="xs faint">Created automatically from booking ' + esc(t.bookingId || '') + '. ' + (untouched(t) ? 'It follows the booking if its dates change until someone starts it.' : '') + '</div>' : '') +
        '</div>';
    }
    function repaint(part) {
      if (!m || !document.body.contains(m.el)) return;
      if (part === 'cl') O.$('[data-cl]', m.el).innerHTML = clHTML();
      if (part === 'pn') O.$('[data-pn]', m.el).innerHTML = pnHTML();
    }
    var actions = [];
    if (ed && can.del()) actions.push({ label: 'Delete', kind: 'ghost', onClick: function (close) { removeTask(t, close); return false; } });
    if (ed) actions.push({ label: 'Edit', kind: 'ghost', onClick: function (close) { close(); editTask(t, function () { detail(t.id); }); return false; } });
    if (!ed) actions.push({ label: 'Close', kind: 'ghost' });
    else if (t.status === 'done') actions.push({ label: 'Reopen', kind: 'ghost', onClick: function () { move(t, 'todo'); U.toast(t.title + ' reopened'); changed('task-move'); } });
    else {
      if (t.status === 'todo') actions.push({ label: 'Start', kind: 'ghost', onClick: function () { move(t, 'in_progress'); U.toast(t.title + ' started'); changed('task-move'); } });
      actions.push({ label: 'Mark done', kind: 'primary', onClick: function (close) { finish([t], function () { close(); }); return false; } });
    }
    m = U.modal({
      title: t.title, sub: [t.type, p ? p.name : t.propertyId ? 'Removed property' : 'General', t.assigneeId ? staffName(t.assigneeId) : 'Unassigned'].join(' · '), body: bodyHTML(), size: 'wide', autofocus: false, actions: actions,
      onOpen: function (el, close) {
        el.addEventListener('change', function (e) {
          var c = e.target.closest('[data-ck]');
          if (c && ed) {
            var ck = t.checks = Array.isArray(t.checks) ? t.checks : [], i = ck.indexOf(c.dataset.ck);
            if (c.checked && i < 0) ck.push(c.dataset.ck); if (!c.checked && i >= 0) ck.splice(i, 1);
            if (t.status === 'todo' && ck.length) { t.status = 'in_progress'; audit('Started "' + t.title + '"' + (p ? ' (' + (p.short || p.name) + ')' : '') + ' by ticking the checklist'); }
            repaint('cl'); changed('task-check');
            return;
          }
          if (e.target.matches('[data-photo]') && e.target.files && e.target.files[0]) {
            var f = e.target.files[0];
            if (!/^image\//.test(f.type || 'image/')) { U.toast('Choose a photo', 'bad'); return; }
            compressPhoto(f, function (src) {
              if (!src) { U.toast('That photo could not be read. Try another one.', 'bad'); return; }
              t.photoNote = { src: src, text: (t.photoNote && t.photoNote.text) || '', at: D.NOW, by: O.state.viewer };
              audit('Added a photo note to "' + t.title + '"' + (p ? ' (' + (p.short || p.name) + ')' : ''));
              repaint('pn'); changed('task-photo'); U.toast('Photo saved with the task');
            });
            return;
          }
          if (e.target.matches('[data-pn-text]')) {
            var txt = e.target.value.trim().slice(0, 400), pn = t.photoNote || {};
            if (!txt && !pn.src) delete t.photoNote; else t.photoNote = { src: pn.src || null, text: txt, at: D.NOW, by: O.state.viewer };
            repaint('pn'); changed('task-photo');
          }
        });
        el.addEventListener('click', function (e) {
          var b;
          if ((b = e.target.closest('[data-bk]'))) { close(); O.booking.open(b.dataset.bk); return; }
          if (e.target.closest('[data-finish]')) { finish([t], function () { close(); }); return; }
          if (e.target.closest('[data-pn-rm]')) { if (t.photoNote) { if (t.photoNote.text) { t.photoNote.src = null; } else delete t.photoNote; } repaint('pn'); changed('task-photo'); }
        });
      }
    });
  }

  /* ===================================================================
     CHECKLISTS TAB
     =================================================================== */
  function aheadTxt(n) { return n === 0 ? 'today only' : 'today and the next ' + (n === 1 ? 'day' : n + ' days'); }
  function nightsTxt(n) { return n + (n === 1 ? ' night' : ' nights') + ' or more'; }
  var KIND_COPY = {
    checkout: function (c) { return 'For every check-out ' + aheadTxt(c.checkoutDaysAhead) + ', due before the next guest arrives.'; },
    checkin: function (c) { return 'For every arrival ' + aheadTxt(c.checkinDaysAhead) + ', due 15 minutes before check-in.'; },
    daily: function (c) { return 'Every day of stays of ' + nightsTxt(c.dailyMinNights) + ', due at ' + fmt.time(c.dailyTime) + '.'; }
  };
  function numSelect(key, val, from, to, labelFn, label) {
    var o = ''; for (var i = from; i <= to; i++) o += '<option value="' + i + '"' + (i === val ? ' selected' : '') + '>' + esc(labelFn(i)) + '</option>';
    return '<select class="select" data-auto-n="' + key + '" aria-label="' + esc(label) + '">' + o + '</select>';
  }
  function autoSettings(k, c) {
    if (k === 'checkout') return '<label class="tk-auto-set"><span>Create for</span>' + numSelect('checkoutDaysAhead', c.checkoutDaysAhead, 0, 7, aheadTxt, 'Check-outs to create tasks for') + '</label>';
    if (k === 'checkin') return '<label class="tk-auto-set"><span>Create for</span>' + numSelect('checkinDaysAhead', c.checkinDaysAhead, 0, 7, aheadTxt, 'Arrivals to create tasks for') + '</label>';
    return '<label class="tk-auto-set"><span>Stays of</span>' + numSelect('dailyMinNights', c.dailyMinNights, 1, 14, nightsTxt, 'Shortest stay that gets daily housekeeping') + '</label>' +
      '<label class="tk-auto-set"><span>Due at</span><input class="input" type="time" data-auto-t="dailyTime" value="' + esc(c.dailyTime) + '" aria-label="Daily housekeeping due time"></label>';
  }
  function checklistsHTML() {
    var c = autoCfg(), canAuto = can.auto(), canLists = can.lists(), dis = canAuto ? '' : ' disabled title="' + esc(noAccess('automations.toggle')) + '"';
    var tpls = KIND_ORDER.map(function (k) { return tplOfKind(k); }).filter(Boolean);
    D.checklists.forEach(function (x) { if (tpls.indexOf(x) < 0) tpls.push(x); });
    if (!tpls.length) return '<div class="card tk-empty"><p>No checklist templates in this workspace.</p></div>';
    return '<div class="tk-cl-grid">' + tpls.map(function (tpl) {
      var k = tpl.kind, on = KIND[k] && c[k];
      var used = D.tasks.filter(function (t) { return isOpen(t) && t.checklistId === tpl.id; }).length;
      return '<section class="card tk-tpl" aria-label="' + esc(tpl.name) + '"><div class="card-head"><div><h3>' + esc(tpl.name) + '</h3><div class="sub">' + esc(tpl.desc || '') + '</div></div>' +
        (canLists ? '<button type="button" class="btn btn-ghost btn-sm" data-edit-tpl="' + esc(tpl.id) + '">' + O.icon('edit') + 'Edit</button>' : '') + '</div>' +
        (KIND[k] ? '<div class="tk-auto-row"><button type="button" class="switch' + (on ? ' on' : '') + '" role="switch" aria-checked="' + !!on + '" data-auto="' + k + '" aria-label="Create ' + esc(KIND[k].label.toLowerCase()) + ' tasks automatically"' + dis + '></button>' +
          '<div class="grow"><b>' + (on ? 'Created automatically' : 'Not created automatically') + '</b><div class="muted">' + (on ? esc(KIND_COPY[k](c)) + ' Assigned to the property\'s housekeeper.' : 'Turn on to create these tasks from bookings.') + '</div>' +
          (on && canAuto ? '<div class="tk-auto-sets">' + autoSettings(k, c) + '</div>' : '') + '</div></div>' : '') +
        '<ol class="tk-items">' + tpl.items.map(function (x) { return '<li><span>' + esc(x.text) + '</span>' + (x.optional ? U.pill('Optional', 'neutral') : '') + '</li>'; }).join('') + '</ol>' +
        '<div class="card-foot"><span>' + fmt.plural(tpl.items.length, 'item') + (used ? ' · used by ' + fmt.plural(used, 'open task') : '') + '</span></div></section>';
    }).join('') + '</div>' +
      '<div class="tk-cl-note">' + (canLists ? 'Editing a list keeps the ticks already made on tasks: renamed items stay ticked and removed items stop counting. ' : 'Only people allowed to edit checklist templates can change these lists. ') +
      'Automatic tasks are skipped when the unit already has a task of the same kind that day, and a task someone deletes is not created again.</div>';
  }
  function setAuto(key, val) {
    if (!can.auto()) { U.toast(noAccess('automations.toggle'), 'bad'); return; }
    var s = autoBlob(); s[key] = val;
    var msg = '';
    if (KIND[key]) {
      if (val) {
        var r = runAuto(); var n = r.created.filter(function (t) { return t.auto === key; }).length;
        msg = KIND[key].label + ' tasks are created automatically again' + (n ? '. ' + fmt.plural(n, 'task was', 'tasks were') + ' added now.' : '.');
      } else {
        /* stop: remove today's and future automatic tasks of this kind that nobody started */
        var gone = D.tasks.filter(function (t) { return t.auto === key && untouched(t) && dayOf(t) >= D.TODAY; });
        gone.forEach(function (t) { D.tasks.splice(D.tasks.indexOf(t), 1); });
        msg = KIND[key].label + ' tasks are no longer created automatically' + (gone.length ? '. ' + fmt.plural(gone.length, 'task nobody had started was', 'tasks nobody had started were') + ' removed.' : '.');
      }
      audit((val ? 'Turned on' : 'Turned off') + ' automatic ' + KIND[key].label.toLowerCase() + ' tasks');
    } else {
      var r2 = runAuto(), lbl = { checkoutDaysAhead: 'check-outs ahead', checkinDaysAhead: 'arrivals ahead', dailyMinNights: 'shortest stay for daily housekeeping', dailyTime: 'daily housekeeping time' }[key] || key;
      msg = 'Saved' + (r2.created.length ? '. ' + fmt.plural(r2.created.length, 'task was', 'tasks were') + ' added.' : '. Tasks not started yet follow the new setting.');
      audit('Changed automatic tasks: ' + lbl + ' set to ' + (key === 'dailyTime' ? fmt.time(val) : val));
    }
    U.toast(msg);
    changed('task-auto-settings');
  }

  /* template editor: works on a copy, saves all at once */
  function editTemplate(id) {
    var tpl = O.checklist.template(id); if (!tpl) return;
    if (!can.lists()) { U.toast(noAccess('tasks.checklists'), 'bad'); return; }
    var draft = { name: tpl.name, desc: tpl.desc || '', items: tpl.items.map(function (x) { return { id: x.id, text: x.text, optional: !!x.optional }; }) };
    var prefix = (tpl.kind || 'x').charAt(0);
    function rows() {
      return draft.items.map(function (x, i) {
        return '<div class="tk-ed-row" data-i="' + i + '"><span class="tk-ed-n">' + (i + 1) + '</span>' +
          '<input class="input" data-txt="' + i + '" value="' + esc(x.text) + '" maxlength="140" aria-label="Item ' + (i + 1) + '">' +
          '<button type="button" class="tk-opt-btn' + (x.optional ? ' on' : '') + '" data-opt="' + i + '" aria-pressed="' + x.optional + '" title="Optional items do not block marking the task done">' + (x.optional ? 'Optional' : 'Required') + '</button>' +
          '<button type="button" class="icon-btn" data-mv="' + i + '" data-dir="-1" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>' + O.icon('up') + '</button>' +
          '<button type="button" class="icon-btn" data-mv="' + i + '" data-dir="1" aria-label="Move down"' + (i === draft.items.length - 1 ? ' disabled' : '') + '>' + O.icon('down') + '</button>' +
          '<button type="button" class="icon-btn" data-rm="' + i + '" aria-label="Remove item ' + (i + 1) + '">' + O.icon('trash') + '</button></div>';
      }).join('');
    }
    var body = '<div class="tk-modal tk-ed stack">' +
      '<div class="form-grid"><div class="field"><label for="tk-ed-name">Name</label><input class="input" id="tk-ed-name" name="name" value="' + esc(draft.name) + '" maxlength="60"></div>' +
      '<div class="field"><label for="tk-ed-desc">When it is used</label><input class="input" id="tk-ed-desc" name="desc" value="' + esc(draft.desc) + '" maxlength="120"></div></div>' +
      '<div><div class="label" style="margin-bottom:6px">Items, in the order the team works through them</div><div class="tk-ed-list" data-rows>' + rows() + '</div>' +
      '<div class="tk-ed-add"><input class="input" name="add" placeholder="Add an item, for example: Check the balcony door is locked" maxlength="140" aria-label="New item"><button type="button" class="btn btn-ghost" data-add>' + O.icon('plus') + 'Add</button></div></div>' +
      '<div class="xs muted">Ticks already made on tasks stay with their items. Renaming keeps an item ticked; removing it stops it counting.</div></div>';
    U.modal({
      title: 'Edit checklist', sub: tpl.name, body: body, size: 'wide', autofocus: false,
      onOpen: function (el) {
        var list = O.$('[data-rows]', el);
        function redraw(focusSel) { list.innerHTML = rows(); if (focusSel) { var f = O.$(focusSel, el); if (f) f.focus(); } }
        function add() {
          var inp = O.$('[name=add]', el), v = inp.value.trim(); if (!v) { inp.focus(); return; }
          draft.items.push({ id: O.uid(prefix).toLowerCase(), text: v, optional: false }); inp.value = ''; redraw(); inp.focus();
        }
        el.addEventListener('input', function (e) {
          if (e.target.matches('[data-txt]')) draft.items[+e.target.dataset.txt].text = e.target.value;
          if (e.target.name === 'name') draft.name = e.target.value;
          if (e.target.name === 'desc') draft.desc = e.target.value;
        });
        el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.name === 'add') { e.preventDefault(); add(); } });
        el.addEventListener('click', function (e) {
          var b;
          if ((b = e.target.closest('[data-add]'))) { add(); return; }
          if ((b = e.target.closest('[data-opt]'))) { var it = draft.items[+b.dataset.opt]; it.optional = !it.optional; redraw('[data-opt="' + b.dataset.opt + '"]'); return; }
          if ((b = e.target.closest('[data-mv]'))) {
            var i = +b.dataset.mv, j = i + (+b.dataset.dir); if (j < 0 || j >= draft.items.length) return;
            var x = draft.items[i]; draft.items[i] = draft.items[j]; draft.items[j] = x;
            redraw('[data-mv="' + j + '"][data-dir="' + b.dataset.dir + '"]:not([disabled])') ; return;
          }
          if ((b = e.target.closest('[data-rm]'))) { draft.items.splice(+b.dataset.rm, 1); redraw(); }
        });
      },
      actions: [{ label: 'Cancel', kind: 'ghost' }, {
        label: 'Save checklist', kind: 'primary', onClick: function (close, el) {
          var pending = O.$('[name=add]', el).value.trim();
          if (pending) draft.items.push({ id: O.uid(prefix).toLowerCase(), text: pending, optional: false });
          var its = draft.items.map(function (x) { return { id: x.id, text: String(x.text || '').trim(), optional: x.optional }; }).filter(function (x) { return x.text; });
          if (!its.length) { U.toast('Keep at least one item on the list', 'bad'); return false; }
          if (!draft.name.trim()) { U.toast('Give the checklist a name', 'bad'); return false; }
          var before = tpl.items.length;
          tpl.name = draft.name.trim(); tpl.desc = draft.desc.trim();
          tpl.items = its.map(function (x) { var o = { id: x.id, text: x.text }; if (x.optional) o.optional = true; return o; });
          audit('Edited the "' + tpl.name + '" checklist (' + before + ' → ' + tpl.items.length + ' items)');
          U.toast(tpl.name + ' saved. Open tasks using it show the new list.');
          changed('checklists');
        }
      }]
    });
  }

  /* ===================================================================
     PAGE
     =================================================================== */
  O.page('tasks', {
    desc: 'Turnovers, housekeeping, inspections and repairs, and who is doing them',
    render: function (root, ctx) {
      var p = ctx.params || {};
      if (ctx.fresh && (p.assignee || p.due || p.propertyId || p.tab || p.taskId)) {
        /* links from the dashboard or bell: start from clean filters so old ones do not hide the result */
        st.tab = p.tab === 'checklists' ? 'checklists' : 'tasks';
        if (p.assignee || p.due || p.propertyId) {
          st.assignee = p.assignee || 'all'; st.due = p.due || 'all'; st.propertyId = p.propertyId || ''; st.type = ''; st.q = ''; st.autoMe = false;
          st.col = p.due === 'overdue' || p.assignee === 'unassigned' ? 'todo' : st.col;
        }
      }
      if (st.viewerSeen !== O.state.viewer) {
        st.viewerSeen = O.state.viewer; st.sel = {};
        if (can.others() && !can.assign() && !p.assignee) { st.assignee = 'me'; st.autoMe = true; }
        else if (st.autoMe || !can.others()) { st.assignee = 'all'; st.autoMe = false; }
      }
      if (!can.others() && st.assignee !== 'all') st.assignee = 'all';
      if (st.propertyId && !prop(st.propertyId)) st.propertyId = '';
      Object.keys(st.sel).forEach(function (k) { if (!taskById(k)) delete st.sel[k]; });
      D.tasks.forEach(normalize);

      if (!can.see()) { ctx.setActions(''); root.innerHTML = U.locked('Tasks & Cleaning', { reason: 'permission' }); return; }

      var tabs = '<div class="tabs tk-tabs" role="tablist">' + [['tasks', 'Tasks'], ['checklists', 'Checklists']].map(function (x) { return '<button type="button" role="tab" data-tab="' + x[0] + '" aria-selected="' + (st.tab === x[0]) + '" class="' + (st.tab === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>';

      if (st.tab === 'checklists') {
        ctx.setActions('');
        root.innerHTML = '<div class="pg-tasks">' + tabs + checklistsHTML() + '</div>';
        var cp = O.$('.pg-tasks', root);
        cp.addEventListener('click', function (e) {
          var b;
          if ((b = e.target.closest('[data-tab]'))) { st.tab = b.dataset.tab; ctx.rerender(); return; }
          if ((b = e.target.closest('[data-edit-tpl]'))) { editTemplate(b.dataset.editTpl); return; }
          if ((b = e.target.closest('[data-auto]'))) { if (b.disabled) return; setAuto(b.dataset.auto, !autoCfg()[b.dataset.auto]); }
        });
        cp.addEventListener('change', function (e) {
          var s = e.target.closest('[data-auto-n]'); if (s) { setAuto(s.dataset.autoN, clampInt(s.value, 0, 30, 0)); return; }
          var tm = e.target.closest('[data-auto-t]'); if (tm && /^\d{2}:\d{2}$/.test(tm.value)) setAuto('dailyTime', tm.value);
        });
        return;
      }

      var edit = can.edit(), phone = isPhone(), view = phone ? 'board' : st.view;
      ctx.setActions((visible().length ? '<button type="button" class="btn btn-ghost tk-csv" data-act="csv">' + O.icon('download') + 'Export CSV</button>' : '') +
        (edit && can.create() && visible().length ? '<button type="button" class="btn btn-primary" data-act="new">' + O.icon('plus') + 'New task</button>' : ''));
      ctx.actionsEl.onclick = function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'new') newTask({ propertyId: st.propertyId, assigneeId: /^(all|me|unassigned)$/.test(st.assignee) ? '' : st.assignee });
        if (b.dataset.act === 'csv') {
          var rows = [['Task ID', 'Task', 'Type', 'Property', 'Due', 'Priority', 'Status', 'Assigned to', 'Checklist done', 'Checklist items', 'Automatic', 'Booking', 'Done at', 'Reason', 'Note']].concat(filtered().sort(byDue).map(function (t) {
            var pg = progress(t);
            return [t.id, t.title, t.type, prop(t.propertyId) ? prop(t.propertyId).name : 'General', (t.due || '').replace('T', ' '), PRI[t.priority] ? PRI[t.priority][0] : '', { todo: 'To do', in_progress: 'In progress', done: 'Done' }[t.status] || t.status, t.assigneeId ? staffName(t.assigneeId) : 'Unassigned',
              pg.total ? pg.done : '', pg.total || '', t.auto ? 'Yes' : 'No', t.bookingId || '', (t.doneAt || '').replace('T', ' '), t.doneReason || '', t.note || ''];
          }));
          O.downloadCSV('tasks-' + D.TODAY + '.csv', rows);
          U.toast(fmt.plural(rows.length - 1, 'task') + ' exported to CSV');
        }
      };

      var vis = visible(), list = filtered();
      var body;
      if (!vis.length) {
        var noProps = !D.properties.length;
        body = '<div class="card tk-empty"><p>' + (can.others()
          ? (noProps ? 'No tasks yet: once you add properties and bookings, turnovers, arrival checks and daily housekeeping appear here on their own.' : 'No tasks yet: turnovers, arrival checks and daily housekeeping appear here on their own as bookings come in.')
          : 'Nothing is assigned to you right now, and new tasks show up here as soon as someone gives you one.') + '</p>' +
          (edit && can.create() ? '<button type="button" class="btn btn-primary" data-act2="new">' + O.icon('plus') + 'New task</button>' : '') + '</div>';
      } else {
        var colCount = function (k) { return list.filter(function (t) { return t.status === k; }).length; };
        body = todayLine() + peopleChips() +
          (!can.others() ? '<div class="tk-mine">Showing your tasks.' + (edit ? '' : ' You can look but not change them.') + '</div>' : !edit ? '<div class="tk-mine">You can look at tasks but not change them.</div>' : '') +
          filtersHTML() + (edit ? bulkBar() : '') +
          (view === 'board' ? '<div class="tk-colsw">' + U.seg(STATUS.map(function (x) { return [x[0], x[1] + ' ' + colCount(x[0])]; }), st.col, 'data-col') + '</div>' + boardHTML(list) : listHTML(list)) +
          (can.assign() ? '<div class="tk-foot-note">WhatsApp messages to staff are not really sent in this version.</div>' : '');
      }
      root.innerHTML = '<div class="pg-tasks">' + tabs + body + '</div>';

      if (ctx.fresh && p.taskId) setTimeout(function () { detail(p.taskId); }, 0);

      var pg = O.$('.pg-tasks', root);
      pg.addEventListener('click', function (e) {
        var b;
        if ((b = e.target.closest('[data-tab]'))) { st.tab = b.dataset.tab; ctx.rerender(); return; }
        if ((b = e.target.closest('[data-act2]'))) { newTask({}); return; }
        if ((b = e.target.closest('[data-view]'))) { st.view = b.dataset.view; ctx.rerender(); return; }
        if ((b = e.target.closest('[data-col]'))) { st.col = b.dataset.col; ctx.rerender(); return; }
        if ((b = e.target.closest('[data-due]'))) { st.due = b.dataset.due; ctx.rerender(); return; }
        if ((b = e.target.closest('[data-quick]'))) { if (b.dataset.quick === 'overdue') { st.due = 'overdue'; st.assignee = can.others() ? 'all' : st.assignee; } else { st.assignee = 'unassigned'; st.due = 'all'; } st.col = 'todo'; st.autoMe = false; ctx.rerender(); return; }
        if ((b = e.target.closest('[data-who]'))) { st.assignee = st.assignee === b.dataset.who && b.dataset.who !== 'all' ? 'all' : b.dataset.who; st.autoMe = false; ctx.rerender(); return; }
        if ((b = e.target.closest('[data-open]'))) { detail(b.dataset.open); return; }
        if ((b = e.target.closest('[data-sort]'))) { if (st.sort === b.dataset.sort) st.dir = -st.dir; else { st.sort = b.dataset.sort; st.dir = 1; } ctx.rerender(); return; }
        if ((b = e.target.closest('[data-move]'))) {
          var t = taskById(b.dataset.move); if (!t) return;
          if (b.dataset.to === 'done') { finish([t]); return; }
          move(t, b.dataset.to); U.toast(b.dataset.to === 'in_progress' ? t.title + ' started' : t.title + ' moved back to to do'); changed('task-move'); return;
        }
        if ((b = e.target.closest('[data-act]'))) {
          var a = b.dataset.act, ids = Object.keys(st.sel).filter(function (k) { return st.sel[k]; });
          var sel = D.tasks.filter(function (x) { return ids.indexOf(x.id) >= 0; });
          if (a === 'clear') { st.assignee = 'all'; st.propertyId = ''; st.type = ''; st.due = 'today'; st.q = ''; st.autoMe = false; ctx.rerender(); }
          if (a === 'more-done') { st.showAllDone = true; ctx.rerender(); }
          if (a === 'fopen') { st.fopen = !st.fopen; ctx.rerender(); }
          if (a === 'bulk-clear') { st.sel = {}; ctx.rerender(); }
          if (a === 'bulk-assign') {
            var who = O.$('[data-bulk-who]', pg).value;
            if (!who) { U.toast('Choose who to assign them to', 'bad'); return; }
            var moved = sel.filter(function (t) { return t.assigneeId !== who; });
            moved.forEach(function (t) { assign(t, who, true); });
            U.toast(moved.length ? fmt.plural(moved.length, 'task') + ' assigned to ' + staffName(who) + '. ' + first(staffName(who)) + ' got one WhatsApp message with the list.' : 'Those tasks are already with ' + staffName(who) + '.');
            st.sel = {}; changed('task-assign');
          }
          if (a === 'bulk-move') {
            var todo = sel.filter(function (t) { return t.status !== b.dataset.to; });
            if (!todo.length) { st.sel = {}; ctx.rerender(); return; }
            if (b.dataset.to === 'done') { finish(todo, function () { st.sel = {}; ctx.rerender(); }); return; }
            todo.forEach(function (t) { move(t, b.dataset.to); });
            U.toast(fmt.plural(todo.length, 'task') + ' started');
            st.sel = {}; changed('task-move');
          }
        }
      });
      pg.addEventListener('change', function (e) {
        var el = e.target;
        if (el.matches('[data-assign]')) { var t = taskById(el.dataset.assign); if (t && can.assign()) { assign(t, el.value); changed('task-assign'); } return; }
        if (el.matches('[data-pick]')) { st.sel[el.dataset.pick] = el.checked; ctx.rerender(); return; }
        if (el.matches('[data-pick-all]')) { list.forEach(function (t) { st.sel[t.id] = el.checked; }); ctx.rerender(); return; }
        if (el.matches('[data-f]') && el.dataset.f !== 'q') { st[el.dataset.f] = el.value; ctx.rerender(); }
      });
      var q = O.$('[data-f=q]', pg), qt;
      if (q) q.addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(function () { st.q = q.value; ctx.rerender(); var n = O.$('.pg-tasks [data-f=q]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); });
      ctx.onLeave(function () { clearTimeout(qt); });
    }
  });
})();
