/* Unit requests — "Repair > Basin > Master bathroom", "Replacement > Sofa > Living room", "Service > Internet connection".
   A request is raised for a unit (the "Requests" tab of a unit in Properties, or the "Requests" tab in Tasks & Cleaning,
   which lists them across units) and makes its task in Tasks at once. When the task is done, the request is ticked.

   Arnob: "We also need a section where we make request for a unit ... This should automatically go to tasks also.
           When task is completed, the request for the unit is also ticked" ... "Request>Internet Connection...like that"

   Kept in the synced workspace data: records collection 'unitRequests' (shape and rules in api/_lib/shared/unitreq.cjs,
   O.unitreq; docs/notes/beds-and-requests.md). The task is an ordinary task in D.tasks with requestId; the request has taskId.

   THE SYNC lives in one place, sync() below: it runs O.unitreq.reconcile() after every change of the data (here or from
   another device, a 'data' listener) and as a background job, so a task marked done from the task detail, the board,
   the list, a bulk action or the dashboard ticks its request, reopening the task reopens it, cancelling a request removes
   its open task, and a deleted task leaves the request open with no task ("Make a task" puts one back).

   Who: raising a request needs "Create tasks" (tasks.create) or "Edit property details" (properties.edit), so housekeeping
   and maintenance staff can report what they find. Cancelling: properties.edit, tasks.delete, or the person who
   raised it while its task is still to do and unassigned or theirs (R.canCancel).
   The task goes to the person the Tasks page would suggest (maintenance staff for repairs, replacements and services,
   the unit's housekeeper for cleaning and new items), otherwise unassigned so it shows on the dashboard.

   O.unitReq: sync(), forUnit(pid), openCount(pid), canCreate(), create(preset), view / click (the Properties drawer),
   pageHTML(st) / pageClick(e, rerender) (the Tasks page), taskLineHTML(task) (the task detail). */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt, R = O.unitreq;
  var UQ = O.unitReq = {};
  if (O.sync && O.sync.records) O.sync.records('unitRequests', 'demo');

  /* demo units only: an open repair with its task, a finished internet service, a replacement waiting */
  if (!D.unitRequests) {
    D.unitRequests = [
      { id: 'RQ-D101', propertyId: 'or4', kind: 'repair', item: 'Basin', location: 'Master bathroom', priority: 'high', notes: 'Basin drains slowly and the tap drips.', status: 'open', at: '2026-10-06T08:40', by: 's3', taskId: 'T-RQ-D101' },
      { id: 'RQ-D102', propertyId: 'or4', kind: 'service', item: 'Internet connection', location: 'Whole unit', priority: 'medium', status: 'done', at: '2026-10-03T10:05', by: 's3', taskId: 'T-RQ-D102', doneAt: '2026-10-04T15:20', doneBy: 's6' },
      { id: 'RQ-D103', propertyId: 'bf3b', kind: 'replace', item: 'Plates', location: 'Kitchen', priority: 'low', notes: 'Two dinner plates chipped. Same white set, 27 cm.', status: 'open', at: '2026-10-05T17:30', by: 's5', taskId: 'T-RQ-D103' }
    ];
    var seedTask = function (r, extra) {
      if (D.tasks.some(function (t) { return t.id === r.taskId; })) return;
      var t = R.taskFor(r, { now: r.at, by: r.by }); Object.keys(extra).forEach(function (k) { t[k] = extra[k]; }); D.tasks.push(t);
    };
    seedTask(D.unitRequests[0], { assigneeId: 's6' });
    seedTask(D.unitRequests[1], { assigneeId: 's6', status: 'done', doneAt: '2026-10-04T15:20', doneBy: 's6' });
    seedTask(D.unitRequests[2], { assigneeId: 's6' });
  }

  O.css('unitreq', `
.rq-list{display:flex;flex-direction:column;gap:8px;}
.rq-row{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--surface);min-width:0;}
.rq-row.pri-high{box-shadow:inset 3px 0 0 var(--bad);}
.rq-tick{width:22px;height:22px;border-radius:50%;border:2px solid var(--border-strong);display:flex;align-items:center;justify-content:center;flex:none;margin-top:1px;color:#FFFFFF;}
.rq-tick svg{width:13px;height:13px;}
.rq-row.done .rq-tick{background:var(--ok);border-color:var(--ok);}
.rq-row.in_progress .rq-tick{border-color:var(--info);}
.rq-row.cancelled .rq-tick{border-style:dashed;}
.rq-row .grow{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;}
.rq-trail{font-weight:800;font-size:13.5px;line-height:1.35;overflow-wrap:anywhere;}
.rq-trail i{font-style:normal;color:var(--faint);margin:0 5px;font-weight:600;}
.rq-row.done .rq-trail, .rq-row.cancelled .rq-trail{color:var(--text-2);}
.rq-row.cancelled .rq-trail{text-decoration:line-through;}
.rq-meta{font-size:12px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;}
.rq-note{font-size:12.5px;color:var(--text-2);overflow-wrap:anywhere;}
.rq-ph{width:64px;height:64px;border-radius:8px;object-fit:cover;border:1px solid var(--border);display:block;margin-top:4px;}
.rq-acts{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;flex:none;max-width:45%;}
.rq-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;}
.rq-head .grow{flex:1;}
.rq-head .select{width:auto;min-width:0;max-width:230px;height:36px;}
.rq-sub{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:16px 0 8px;}
.rq-form .rq-kinds{display:flex;flex-wrap:wrap;gap:6px;}
.rq-form .rq-kinds label{display:flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:20px;padding:6px 12px;font-size:12.5px;font-weight:700;cursor:pointer;min-height:38px;}
.rq-form .rq-kinds input{accent-color:var(--brand-strong);margin:0;}
.rq-form .rq-kinds label:has(input:checked){border-color:var(--brand-strong);background:var(--brand-soft);}
.rq-form .rq-prev{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:12.5px;color:var(--text-2);line-height:1.5;}
.rq-form .rq-prev b{color:var(--text);}
.rq-form .rq-phwrap{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.rq-form .rq-phwrap img{width:72px;height:72px;border-radius:8px;object-fit:cover;border:1px solid var(--border);}
.rq-form .pp-err{color:var(--bad);font-size:12px;font-weight:600;min-height:0;}
.tk-modal .rq-from{display:flex;gap:10px;align-items:flex-start;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:9px 12px;font-size:12.5px;color:var(--text-2);}
.tk-modal .rq-from b{color:var(--text);}
.tk-modal .rq-from img{width:56px;height:56px;border-radius:8px;object-fit:cover;flex:none;}
@media (max-width:760px){
  .rq-row{flex-wrap:wrap;}
  .rq-acts{max-width:none;width:100%;justify-content:flex-start;padding-left:32px;}
  .rq-acts .btn{min-height:40px;}
  .rq-head .select{flex:1 1 140px;max-width:none;height:40px;}
}
`);

  /* ---------------- helpers ---------------- */
  function reqs() { return O.raw('unitRequests') || D.unitRequests || []; }
  function byId(id) { return reqs().filter(function (r) { return r && r.id === id; })[0] || null; }
  function taskOf(r) { return r && r.taskId ? (O.raw('tasks') || D.tasks).filter(function (t) { return t && t.id === r.taskId; })[0] || null : null; }
  function staffName(id) { var s = id && D.staffById(id); return s ? s.name : ''; }
  function first(id) { var n = staffName(id); return n ? n.split(' ')[0] : ''; }
  function propShort(pid) { var p = D.propById[pid]; return p ? p.short || p.name : 'Removed property'; }
  function audit(text) { if (!Array.isArray(D.auditLog)) D.auditLog = []; D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: 'tasks', text: text }); }
  function noAccess() { return 'Your access does not include raising requests. It needs "' + O.permLabel('tasks.create') + '" or "' + O.permLabel('properties.edit') + '".'; }
  UQ.canCreate = function () { return O.can('tasks.create') || O.can('properties.edit'); };
  /* the rule is R.canCancel: the raiser alone may cancel only while the task is to do and unassigned or theirs */
  function canCancel(r) { return R.canCancel(r, taskOf(r), { viewer: O.state.viewer, propsEdit: O.can('properties.edit'), tasksDelete: O.can('tasks.delete'), canCreate: UQ.canCreate() }); }
  function canSeeTask(t) { return !!t && O.can('tasks') && (O.can('tasks.others') || t.assigneeId === O.state.viewer); }
  UQ.forUnit = function (pid) { return R.sort(reqs().filter(function (r) { return r && r.propertyId === pid; })); };
  UQ.openCount = function (pid) { return reqs().filter(function (r) { return r && (!pid || r.propertyId === pid) && R.isOpen(r); }).length; };

  /* ---------------- THE SYNC: requests follow their tasks ---------------- */
  var SEEN = {}; /* ids of request tasks this device has seen: one that disappears was deleted */
  UQ.sync = function () {
    if (!O.sync || !O.sync.canWrite() || !Array.isArray(D.unitRequests)) return 0;
    return O.unscoped(function () {
      var out = R.reconcile(D.unitRequests, D.tasks, { now: D.NOW, seen: function (id) { return !!SEEN[id]; } });
      D.tasks.forEach(function (t) { if (t && t.requestId) SEEN[t.id] = 1; });
      out.events.forEach(function (ev) {
        if (ev.type === 'task-removed') audit('Removed task "' + ev.task.title + '" because its request ' + R.trail(ev.request) + ' (' + propShort(ev.request.propertyId) + ') was cancelled');
        if (ev.type === 'uncancelled') audit('Reopened request ' + R.trail(ev.request) + ' (' + propShort(ev.request.propertyId) + ') because its task "' + ev.task.title + '" was reopened');
      });
      return out.changed.length + out.removed.length;
    });
  };
  if (O.automation && O.automation.register) O.automation.register('unitRequests', function (reason) {
    if (UQ.sync() && reason !== 'boot' && reason !== 'day') O.emit('data', { type: 'request-sync' });
  });
  var syncTimer = null;
  O.on('data', function (ev) {
    if (!O._started || !O.sync || !O.sync.canWrite()) return;
    if (ev && ev.type === 'request-sync') return;
    clearTimeout(syncTimer);
    /* a moment after the change, so rows that arrive together from another device are all in */
    syncTimer = setTimeout(function () { if (UQ.sync()) O.emit('data', { type: 'request-sync' }); }, 400);
  });

  /* ---------------- making a request and its task ---------------- */
  function assigneeFor(type, pid) {
    var sg = O.taskHelpers && O.taskHelpers.suggestFor ? O.taskHelpers.suggestFor(type, pid) : null;
    return sg && D.staffById(sg[0]) ? sg : null;
  }
  function addTask(r) {
    var type = R.taskType(r), sg = assigneeFor(type, r.propertyId);
    var t = R.taskFor(r, { assigneeId: sg ? sg[0] : null, by: O.state.viewer, now: D.NOW });
    O.unscoped(function () { var i = D.tasks.map(function (x) { return x.id; }).indexOf(t.id); if (i >= 0) D.tasks.splice(i, 1); D.tasks.push(t); });
    r.taskId = t.id; delete r.taskGone;
    SEEN[t.id] = 1;
    return t;
  }
  function kindsHTML(sel) {
    return '<div class="rq-kinds" role="radiogroup" aria-label="Kind of request">' + R.KINDS.map(function (k) {
      return '<label' + (k.hint ? ' title="' + esc(k.hint) + '"' : '') + '><input type="radio" name="kind" value="' + k.id + '"' + (k.id === sel ? ' checked' : '') + '>' + esc(k.label) + '</label>';
    }).join('') + '</div>';
  }
  function locList(pid) { return R.locations(O.unitRooms ? O.unitRooms.roomNames(pid) : []); }
  /* the form; preset {propertyId, kind, item, location} */
  UQ.create = function (preset) {
    if (!UQ.canCreate()) { U.toast(noAccess(), 'bad'); return; }
    preset = preset || {};
    var pid = preset.propertyId || '', photo = null;
    var body = '<form class="rq-form tk-modal stack" novalidate autocomplete="off"><div class="form-grid">' +
      (preset.propertyId ? '' : '<div class="field full"><label for="rq-prop">Unit</label><select class="select" id="rq-prop" name="propertyId"><option value="">Choose the unit</option>' + U.propOptions(pid) + '</select><div class="pp-err" data-err="propertyId"></div></div>') +
      '<div class="field full"><span class="label">What kind</span>' + kindsHTML(preset.kind || 'repair') + '</div>' +
      '<div class="field"><label for="rq-item">What</label><input class="input" id="rq-item" name="item" list="rq-dl-items" maxlength="60" value="' + esc(preset.item || '') + '" placeholder="e.g. Basin, Sofa, Plates, Internet connection"><div class="pp-err" data-err="item"></div></div>' +
      '<div class="field"><label for="rq-loc">Where</label><input class="input" id="rq-loc" name="location" list="rq-dl-locs" maxlength="40" value="' + esc(preset.location || '') + '" placeholder="e.g. Master bathroom"></div>' +
      '<datalist id="rq-dl-items">' + R.ITEMS.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist><datalist id="rq-dl-locs"></datalist>' +
      '<div class="field full"><span class="label">Priority</span><div class="pseg" role="radiogroup" aria-label="Priority">' + R.PRIORITIES.map(function (p) { return '<label title="' + esc(p.hint) + '"><input type="radio" name="priority" value="' + p.id + '"' + (p.id === 'medium' ? ' checked' : '') + '>' + esc(p.label) + '</label>'; }).join('') + '</div></div>' +
      '<div class="field full"><label for="rq-notes">Notes <span class="opt">(optional)</span></label><textarea class="textarea" id="rq-notes" name="notes" maxlength="600" placeholder="What is wrong, size or model, anything the person fixing it needs"></textarea></div>' +
      '<div class="field full"><span class="label">Photo <span class="opt">(optional)</span></span><div class="rq-phwrap" data-ph><label class="btn btn-ghost btn-sm" style="cursor:pointer">' + O.icon('camera') + 'Add photo<input type="file" accept="image/*" capture="environment" data-photo hidden></label></div></div>' +
      '<div class="field full"><div class="rq-prev" data-prev></div></div>' +
      '</div></form>';
    U.modal({
      title: 'New request', sub: preset.propertyId ? propShort(preset.propertyId) : 'It goes to Tasks as soon as you save it', body: body, size: 'wide', autofocus: false,
      onOpen: function (el) {
        var f = function (n) { return O.$('[name=' + n + ']', el); };
        function curPid() { return preset.propertyId || (f('propertyId') ? f('propertyId').value : ''); }
        function locs() { O.$('#rq-dl-locs', el).innerHTML = locList(curPid()).map(function (x) { return '<option value="' + esc(x) + '">'; }).join(''); }
        function read() { var k = O.$('[name=kind]:checked', el), p = O.$('[name=priority]:checked', el); return { propertyId: curPid(), kind: k ? k.value : 'repair', item: f('item').value, location: f('location').value, priority: p ? p.value : 'medium', notes: f('notes').value, photo: photo }; }
        function prev() {
          var v = read(), r = R.make(v, { id: 'x', now: D.NOW }), type = R.taskType(r), sg = v.propertyId ? assigneeFor(type, v.propertyId) : null;
          O.$('[data-prev]', el).innerHTML = '<b>' + esc(R.trail(r)) + '</b><br>Creates the task <b>' + esc(R.taskTitle(r)) + '</b> (' + esc(type) + ', due ' + esc(fmt.dateTime(R.dueFor(r.priority, D.NOW))) + ')' +
            (v.propertyId ? (sg ? ', for <b>' + esc(staffName(sg[0])) + '</b> who ' + esc(sg[1]) : ', unassigned until someone takes it') : '') + '. When the task is done, this request is ticked.';
        }
        locs(); prev();
        el.addEventListener('input', prev);
        el.addEventListener('change', function (e) {
          if (e.target.name === 'propertyId') locs();
          if (e.target.matches('[data-photo]') && e.target.files && e.target.files[0]) {
            var file = e.target.files[0];
            if (!/^image\//.test(file.type || 'image/') || !O.taskHelpers || !O.taskHelpers.compressPhoto) { U.toast('Choose a photo', 'bad'); return; }
            O.taskHelpers.compressPhoto(file, function (src) {
              if (!src) { U.toast('That photo could not be read. Try another one.', 'bad'); return; }
              photo = src;
              O.$('[data-ph]', el).innerHTML = '<img src="' + esc(src) + '" alt="Photo for this request"><button type="button" class="btn btn-quiet btn-xs" data-ph-rm>' + O.icon('trash') + 'Remove photo</button>';
            });
          }
          prev();
        });
        el.addEventListener('click', function (e) {
          if (e.target.closest('[data-ph-rm]')) { photo = null; O.$('[data-ph]', el).innerHTML = '<label class="btn btn-ghost btn-sm" style="cursor:pointer">' + O.icon('camera') + 'Add photo<input type="file" accept="image/*" capture="environment" data-photo hidden></label>'; }
        });
        el._rqRead = read;
      },
      actions: [{ label: 'Cancel', kind: 'ghost' }, {
        label: 'Create request', kind: 'primary', onClick: function (close, el) {
          var v = el._rqRead(), E = R.errors(v);
          O.$$('.pp-err', el).forEach(function (x) { x.textContent = ''; });
          if (Object.keys(E).length) { Object.keys(E).forEach(function (k) { var b = O.$('[data-err="' + k + '"]', el); if (b) b.textContent = E[k]; }); var i = O.$('[name=' + Object.keys(E)[0] + ']', el); if (i) i.focus(); return false; }
          var r = R.make(v, { id: O.uid('RQ'), by: O.state.viewer, now: D.NOW });
          var t = addTask(r);
          O.unscoped(function () { D.unitRequests.push(r); });
          audit('Raised request ' + R.trail(r) + ' for ' + propShort(r.propertyId) + ' and created the task "' + t.title + '"' + (t.assigneeId ? ' for ' + staffName(t.assigneeId) : ', unassigned'));
          O.emit('data', { type: 'request-new', id: r.id });
          U.toast('Request saved. Task "' + t.title + '" is in Tasks' + (t.assigneeId ? ' for ' + staffName(t.assigneeId) + '.' : ', unassigned.'));
        }
      }]
    });
  };

  function cancelReq(r) {
    var t = taskOf(r);
    U.confirm(R.trail(r) + ' is cancelled' + (t && t.status !== 'done' ? ' and its open task "' + t.title + '" is removed from Tasks' : '') + '.', 'Cancel request', 'danger', 'Cancel this request?').then(function (ok) {
      if (!ok || r.status === 'cancelled') return;
      if (!canCancel(r)) { U.toast('Your access does not include cancelling this request any more: its task has been started or taken.', 'bad'); return; }
      var cur = taskOf(r);
      r.status = 'cancelled'; r.cancelledAt = D.NOW; r.cancelledBy = O.state.viewer;
      if (cur && cur.status === 'done') r.keptTask = true; else delete r.keptTask;
      audit('Cancelled request ' + R.trail(r) + ' for ' + propShort(r.propertyId));
      UQ.sync();
      O.emit('data', { type: 'request-cancel', id: r.id });
      U.toast('Request cancelled');
    });
  }
  function reopenReq(r) {
    delete r.cancelledAt; delete r.cancelledBy; delete r.keptTask; r.status = 'open';
    var t = taskOf(r);
    if (!t) t = addTask(r); else if (t.status === 'done') { t.status = 'todo'; delete t.doneAt; delete t.doneBy; delete t.doneReason; }
    UQ.sync();
    audit('Reopened request ' + R.trail(r) + ' for ' + propShort(r.propertyId) + ' with the task "' + t.title + '"');
    O.emit('data', { type: 'request-reopen', id: r.id });
    U.toast('Request reopened. The task is back in Tasks.');
  }
  function retask(r) {
    var t = addTask(r);
    UQ.sync();
    audit('Made a new task "' + t.title + '" for request ' + R.trail(r) + ' (' + propShort(r.propertyId) + ')');
    O.emit('data', { type: 'request-task', id: r.id });
    U.toast('Task "' + t.title + '" is in Tasks' + (t.assigneeId ? ' for ' + staffName(t.assigneeId) : '') + '.');
  }

  /* ---------------- one request ---------------- */
  function taskText(r, t) {
    if (!t) return r.taskGone && R.isOpen(r) ? 'Its task was deleted' : '';
    var st = t.status === 'done' ? 'done' : t.status === 'in_progress' ? 'in progress' : 'to do';
    return 'Task ' + st + (t.assigneeId ? ', ' + first(t.assigneeId) : ', unassigned') + (t.status !== 'done' && t.due ? ', due ' + fmt.dateTime(t.due) : '');
  }
  function rowHTML(r, opts) {
    opts = opts || {};
    var t = taskOf(r), parts = [R.kind(r.kind).label, r.item, r.location].filter(Boolean);
    var meta = [];
    if (opts.unit) meta.push('<b>' + esc(propShort(r.propertyId)) + '</b>');
    if (R.isOpen(r) && r.priority === 'high') meta.push(U.pill('High', 'bad'));
    if (r.status === 'in_progress') meta.push(U.pill('In progress', 'info'));
    if (r.status === 'cancelled') meta.push(U.pill('Cancelled', 'neutral'));
    meta.push('<span>' + esc(r.status === 'done' && r.doneAt ? 'Done ' + fmt.dateTime(r.doneAt) + (r.doneBy ? ' by ' + first(r.doneBy) : '') : 'Raised ' + fmt.dateTime(r.at) + (r.by ? ' by ' + first(r.by) : '')) + '</span>');
    var tt = taskText(r, t); if (tt && r.status !== 'done') meta.push('<span' + (r.taskGone && !t ? ' style="color:var(--warn)"' : '') + '>' + esc(tt) + '</span>');
    var acts = [];
    if (t && canSeeTask(t)) acts.push('<button type="button" class="btn btn-ghost btn-xs" data-rq="task" data-id="' + esc(r.id) + '">Open task</button>');
    if (R.isOpen(r) && !t && UQ.canCreate()) acts.push('<button type="button" class="btn btn-ghost btn-xs" data-rq="retask" data-id="' + esc(r.id) + '">' + O.icon('plus') + 'Make a task</button>');
    if (R.isOpen(r) && canCancel(r)) acts.push('<button type="button" class="btn btn-quiet btn-xs" data-rq="cancel" data-id="' + esc(r.id) + '">Cancel</button>');
    if (r.status === 'cancelled' && UQ.canCreate()) acts.push('<button type="button" class="btn btn-quiet btn-xs" data-rq="reopen" data-id="' + esc(r.id) + '">Reopen</button>');
    return '<div class="rq-row ' + esc(r.status) + (R.isOpen(r) ? ' pri-' + esc(r.priority || 'medium') : '') + '" data-req="' + esc(r.id) + '">' +
      '<span class="rq-tick" role="img" aria-label="' + esc(R.label(R.STATUSES, r.status) || 'Open') + '">' + (r.status === 'done' ? O.icon('check') : '') + '</span>' +
      '<div class="grow"><div class="rq-trail">' + parts.map(esc).join('<i aria-hidden="true">›</i>') + '</div>' +
      '<div class="rq-meta">' + meta.join('') + '</div>' +
      (r.notes ? '<div class="rq-note">' + esc(r.notes) + '</div>' : '') +
      (r.photo ? '<img class="rq-ph" src="' + esc(r.photo) + '" alt="Photo for ' + esc(R.trail(r)) + '">' : '') + '</div>' +
      (acts.length ? '<div class="rq-acts">' + acts.join('') + '</div>' : '') + '</div>';
  }
  function listHTML(list, opts, emptyText) {
    if (!list.length) return '<div class="small muted">' + esc(emptyText) + '</div>';
    return '<div class="rq-list">' + list.map(function (r) { return rowHTML(r, opts); }).join('') + '</div>';
  }
  /* a click on a request's buttons -> true when handled */
  function onClick(e) {
    var b = e.target.closest('[data-rq]'); if (!b) return false;
    var r = byId(b.dataset.id), a = b.dataset.rq;
    if (a === 'new') { UQ.create({ propertyId: b.dataset.pid || '' }); return true; }
    if (!r) return true;
    if (a === 'task') { var t = taskOf(r); if (t && O.taskHelpers && O.taskHelpers.detail) O.taskHelpers.detail(t.id); else if (t) O.go('tasks', { taskId: t.id }); }
    if (a === 'cancel') { if (canCancel(r)) cancelReq(r); else U.toast('Your access does not include cancelling this request.', 'bad'); }
    if (a === 'reopen') { if (UQ.canCreate()) reopenReq(r); else U.toast(noAccess(), 'bad'); }
    if (a === 'retask') { if (UQ.canCreate()) retask(r); else U.toast(noAccess(), 'bad'); }
    return true;
  }

  /* ---------------- the Properties drawer: the unit's "Requests" tab ---------------- */
  UQ.view = function (X, p, host) {
    var all = UQ.forUnit(p.id), open = all.filter(R.isOpen), closed = all.filter(function (r) { return !R.isOpen(r); });
    var h = host.tabsHTML + '<div class="pp-vbody" data-rq-view>';
    h += '<div class="xs muted" style="margin-bottom:10px">Repairs, replacements, new items and services this unit needs. Each one is a task in Tasks; it is ticked here when the task is done.</div>';
    h += '<section class="pp-vs"><h4>Open' + (open.length ? ' · ' + open.length : '') + '</h4>' + listHTML(open, {}, 'Nothing open for ' + (p.short || p.name) + '.') + '</section>';
    if (closed.length) h += '<section class="pp-vs"><h4>Done and cancelled</h4>' + listHTML(closed.slice(0, 20), {}, '') + (closed.length > 20 ? '<div class="xs muted" style="margin-top:6px">And ' + (closed.length - 20) + ' older. See them all in Tasks, Requests.</div>' : '') + '</section>';
    X.body.innerHTML = h + '</div>';
    X.foot.innerHTML = '<button type="button" class="btn btn-ghost" data-rqd="close">Close</button><div class="r">' + (UQ.canCreate() && !p.archived ? '<button type="button" class="btn btn-primary" data-rq="new" data-pid="' + esc(p.id) + '">' + O.icon('plus') + 'New request</button>' : '') + '</div>';
  };
  UQ.click = function (e, p, host) {
    if (e.target.closest('[data-rqd="close"]')) { host.close(); return true; }
    return onClick(e);
  };

  /* ---------------- the Tasks page: "Requests" tab across units ---------------- */
  /* st: {rqShow: 'open'|'done'|'cancelled'|'all', rqProp} (the Tasks page keeps it) */
  UQ.pageHTML = function (st) {
    var show = st.rqShow || 'open', pid = st.rqProp || '';
    var all = reqs().filter(function (r) { return r && (!pid || r.propertyId === pid) && O.inView(r.propertyId); });
    var n = function (k) { return all.filter(function (r) { return k === 'open' ? R.isOpen(r) : k === 'all' ? true : r.status === k; }).length; };
    var list = R.sort(all.filter(function (r) { return show === 'all' ? true : show === 'open' ? R.isOpen(r) : r.status === show; }));
    var head = '<div class="rq-head">' + U.seg([['open', 'Open ' + n('open')], ['done', 'Done ' + n('done')], ['cancelled', 'Cancelled'], ['all', 'All']], show, 'data-rqshow') +
      (D.properties.length ? '<select class="select" data-rqprop aria-label="Unit">' + U.propOptions(pid, { all: 'All units' }) + '</select>' : '') + '<span class="grow"></span>' +
      (UQ.canCreate() && D.properties.length ? '<button type="button" class="btn btn-primary btn-sm" data-rq="new" data-pid="' + esc(pid) + '">' + O.icon('plus') + 'New request</button>' : '') + '</div>';
    var empty = show === 'open' ? 'No open requests. Raise one when something in a unit needs fixing, replacing or buying, and it goes to Tasks.' : 'Nothing here.';
    return head + '<div class="card" style="padding:12px">' + listHTML(list.slice(0, 200), { unit: !pid }, empty) + '</div>' +
      '<div class="tk-foot-note">A request makes its task as soon as it is saved. Marking that task done, anywhere, ticks the request; reopening the task reopens it.</div>';
  };
  UQ.pageClick = function (e, st, rerender) {
    var s = e.target.closest('[data-rqshow]'); if (s) { st.rqShow = s.dataset.rqshow; rerender(); return true; }
    return onClick(e);
  };
  UQ.pageChange = function (e, st, rerender) {
    if (e.target.matches('[data-rqprop]')) { st.rqProp = e.target.value; rerender(); return true; }
    return false;
  };

  /* ---------------- the task detail: where a task came from ---------------- */
  UQ.taskLineHTML = function (t) {
    var r = t && t.requestId ? byId(t.requestId) : null; if (!r) return '';
    return '<div class="rq-from">' + (r.photo ? '<img src="' + esc(r.photo) + '" alt="Photo for this request">' : '') + '<div><b>From a unit request: ' + esc(R.trail(r)) + '</b><br>' +
      esc('Raised ' + fmt.dateTime(r.at) + (r.by ? ' by ' + staffName(r.by) : '') + '. When this task is done the request is ticked.') + '</div></div>';
  };
})();
