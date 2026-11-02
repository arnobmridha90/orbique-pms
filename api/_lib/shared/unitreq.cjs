/* Unit requests: something a unit needs (a repair, a replacement, a new item, a service, a cleaning), and the task that
 * gets it done. No browser or network code.
 *
 * Arnob: "We also need a section where we make request for a unit, for example repair request>Basin> Toilet Masted Bed
 *         Replacement>Sofa Living Room / Replacement>Plates. This should automatically go to tasks also. When task is
 *         completed, the request for the unit is also ticked" ... "Request>Internet Connection...like that"
 *
 * A request (synced records collection 'unitRequests', app/pages/unitreq.js; docs/notes/beds-and-requests.md):
 *   {id: 'RQ-…', propertyId, kind (KINDS id), item, location, priority ('high'|'medium'|'low'), notes, photo (JPEG data URL),
 *    status ('open'|'in_progress'|'done'|'cancelled'), at, by (staff id), taskId ('T-' + id while a task is linked),
 *    doneAt, doneBy (copied from the task), cancelledAt, cancelledBy, taskGone (true: its task was deleted)}
 * Its task in D.tasks carries requestId.
 *
 * THE SYNC RULE (reconcile, run by app/pages/unitreq.js after every change, on every device):
 *   - while a request has a task, the request's status follows the task: todo -> open, in_progress -> in_progress,
 *     done -> done (doneAt / doneBy from the task). Reopening the task reopens the request.
 *   - a cancelled request removes its task if the task is not done (a done task stays as history).
 *   - a task that was deleted: the request stays (open again if it was not done), its taskId is cleared and taskGone set,
 *     so someone can make a new task from it. "Deleted" = the device saw the task and it is gone now, or the task is
 *     still missing GRACE_MIN minutes after the request was made (a task row that has not arrived yet is not "deleted").
 * Everything it writes comes from the request and its task, so two devices reach the same record. ES5.
 *
 * Shared by the page (inlined by scripts/build.mjs as O.unitreq) and the node tests (tests/beds-requests.test.mjs).
 */
'use strict';

/* task: the task type it makes (pages/tasks.js TYPES); short: the start of the task title */
var KINDS = [
  { id: 'repair', label: 'Repair', short: 'Repair', task: 'Maintenance' },
  { id: 'replace', label: 'Replacement', short: 'Replace', task: 'Maintenance' },
  { id: 'purchase', label: 'New item / purchase', short: 'New item', task: 'Restock' },
  { id: 'service', label: 'Service', short: 'Service', task: 'Maintenance', hint: 'Internet connection, pest control, aircon service' },
  { id: 'cleaning', label: 'Cleaning', short: 'Cleaning', task: 'Housekeeping' },
  { id: 'other', label: 'Other', short: 'Request', task: 'Maintenance' }
];
var ITEMS = ['Basin', 'Toilet', 'Toilet flush', 'Shower', 'Water heater', 'Tap', 'Drain', 'Aircon', 'Ceiling fan', 'Bed', 'Bed frame', 'Mattress', 'Pillows', 'Bedsheets', 'Towels', 'Sofa', 'Dining table', 'Chairs', 'Wardrobe', 'Curtains', 'Plates', 'Bowls', 'Cutlery', 'Glasses', 'Mugs', 'Pots and pans', 'Kettle', 'Rice cooker', 'Microwave', 'Induction hob', 'Fridge', 'Washer', 'Dryer', 'Iron', 'Hair dryer', 'Vacuum', 'TV', 'TV remote', 'Internet connection', 'Wi-Fi router', 'Lights', 'Light bulb', 'Power socket', 'Door lock', 'Smart lock battery', 'Window', 'Pest control', 'Aircon service', 'Deep cleaning'];
var LOCATIONS = ['Kitchen', 'Master bathroom', 'Bathroom 1', 'Bathroom 2', 'Living room', 'Dining area', 'Balcony', 'Laundry area', 'Entrance', 'Whole unit'];
var STATUSES = [{ id: 'open', label: 'Open' }, { id: 'in_progress', label: 'In progress' }, { id: 'done', label: 'Done' }, { id: 'cancelled', label: 'Cancelled' }];
var PRIORITIES = [{ id: 'high', label: 'High', hint: 'Due in 4 hours' }, { id: 'medium', label: 'Medium', hint: 'Due tomorrow 5 PM' }, { id: 'low', label: 'Low', hint: 'Due in 3 days, 5 PM' }];
var GRACE_MIN = 10;

function kind(id) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i].id === id) return KINDS[i]; return KINDS[KINDS.length - 1]; }
function label(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].label; return ''; }
function str(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 80); }
function isOpen(r) { return !!r && (r.status === 'open' || r.status === 'in_progress'); }

/* 'Repair > Basin > Master bathroom' */
function trail(r) { return [kind(r.kind).label, str(r.item), str(r.location)].filter(Boolean).join(' > '); }
/* 'Repair: Basin (Master bathroom)' */
function taskTitle(r) { var it = str(r.item) || kind(r.kind).label; return (kind(r.kind).short + ': ' + it + (str(r.location) ? ' (' + str(r.location) + ')' : '')).slice(0, 120); }
function taskType(r) { return kind(r.kind).task; }
function taskId(r) { return 'T-' + r.id; }

/* 'YYYY-MM-DDTHH:MM' plus minutes, on the wall clock (no time zones) */
function addMin(at, min) {
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(at || ''));
  if (!m) return at;
  var t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + min * 60e3);
  return t.toISOString().slice(0, 16);
}
function minutesBetween(a, b) {
  var p = function (s) { var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : NaN; };
  return (p(b) - p(a)) / 60e3;
}
/* when the task is due: high in 4 hours, medium tomorrow 17:00, low in 3 days 17:00 */
function dueFor(priority, now) {
  if (priority === 'high') return addMin(now, 240);
  var day = addMin(String(now).slice(0, 10) + 'T00:00', (priority === 'low' ? 3 : 1) * 1440).slice(0, 10);
  return day + 'T17:00';
}

/* the task a new request makes. opts: {assigneeId, by, now} */
function taskFor(r, opts) {
  opts = opts || {};
  var note = [str(r.notes, 600), 'From unit request ' + r.id + ': ' + trail(r) + '.'].filter(Boolean).join('\n');
  return {
    id: taskId(r), title: taskTitle(r), type: taskType(r), propertyId: r.propertyId || null, assigneeId: opts.assigneeId || null,
    due: dueFor(r.priority, opts.now || r.at), priority: r.priority || 'medium', status: 'todo', createdAt: opts.now || r.at, createdBy: opts.by || r.by || null,
    requestId: r.id, note: note
  };
}

/* a new request from what was typed. f: {propertyId, kind, item, location, priority, notes, photo}; ctx: {id, by, now} */
function make(f, ctx) {
  var r = {
    id: ctx.id, propertyId: f.propertyId, kind: kind(f.kind).id, item: str(f.item, 60), location: str(f.location, 40),
    priority: f.priority === 'high' || f.priority === 'low' ? f.priority : 'medium', status: 'open', at: ctx.now, by: ctx.by || null
  };
  if (str(f.notes, 600)) r.notes = str(f.notes, 600);
  if (f.photo) r.photo = f.photo;
  return r;
}
/* what is wrong with a request form, {field: message} */
function errors(f) {
  var E = {};
  if (!f.propertyId) E.propertyId = 'Choose the unit.';
  if (!str(f.item) && kind(f.kind).id !== 'cleaning') E.item = 'Say what it is about, for example Basin or Internet connection.';
  return E;
}

var FROM_TASK = { todo: 'open', in_progress: 'in_progress', done: 'done' };
function setStatus(r, s, t) {
  var ch = false;
  if (r.status !== s) { r.status = s; ch = true; }
  if (s === 'done') {
    if (t && r.doneAt !== (t.doneAt || null)) { r.doneAt = t.doneAt || null; ch = true; }
    if (t && r.doneBy !== (t.doneBy || null)) { r.doneBy = t.doneBy || null; ch = true; }
  } else {
    if ('doneAt' in r) { delete r.doneAt; ch = true; }
    if ('doneBy' in r) { delete r.doneBy; ch = true; }
  }
  return ch;
}

/* apply the sync rule to requests and tasks in place.
 * opts: {now, seen(taskId) -> true when this device has seen that task before, graceMin}
 * returns {changed: [request], removed: [task], events: [{type: 'done'|'reopened'|'started'|'unlinked'|'task-removed', request, task}]} */
function reconcile(requests, tasks, opts) {
  opts = opts || {};
  var grace = opts.graceMin == null ? GRACE_MIN : opts.graceMin;
  var byId = {}, out = { changed: [], removed: [], events: [] };
  (tasks || []).forEach(function (t) { if (t && t.id) byId[t.id] = t; });
  (requests || []).forEach(function (r) {
    if (!r || !r.id) return;
    var t = r.taskId ? byId[r.taskId] : null, ch = false;
    if (r.status === 'cancelled') {
      if (t && t.status !== 'done') {
        var i = tasks.indexOf(t); if (i >= 0) tasks.splice(i, 1);
        delete byId[t.id]; out.removed.push(t); out.events.push({ type: 'task-removed', request: r, task: t });
      }
      if (r.taskId && !byId[r.taskId]) { delete r.taskId; ch = true; }
    } else if (t) {
      if (t.requestId !== r.id) t.requestId = r.id;
      var want = FROM_TASK[t.status] || 'open', was = r.status;
      if (r.taskGone) { delete r.taskGone; ch = true; }
      if (setStatus(r, want, t)) {
        ch = true;
        out.events.push({ type: want === 'done' ? 'done' : was === 'done' ? 'reopened' : want === 'in_progress' ? 'started' : 'reopened', request: r, task: t });
      }
    } else if (r.taskId) {
      var gone = (opts.seen && opts.seen(r.taskId)) || (opts.now && minutesBetween(r.at, opts.now) >= grace);
      if (gone) {
        delete r.taskId; r.taskGone = true; ch = true;
        if (r.status !== 'done') setStatus(r, 'open');
        out.events.push({ type: 'unlinked', request: r, task: null });
      }
    }
    if (ch) out.changed.push(r);
  });
  return out;
}

/* open requests first (high priority, oldest first), then the rest newest first */
function sort(list) {
  var pr = { high: 0, medium: 1, low: 2 };
  return list.slice().sort(function (a, b) {
    var ao = isOpen(a), bo = isOpen(b);
    if (ao !== bo) return ao ? -1 : 1;
    if (ao) return (pr[a.priority] == null ? 1 : pr[a.priority]) - (pr[b.priority] == null ? 1 : pr[b.priority]) || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
    var ad = a.doneAt || a.cancelledAt || a.at, bd = b.doneAt || b.cancelledAt || b.at;
    return ad < bd ? 1 : ad > bd ? -1 : 0;
  });
}

/* where a request can be in a unit: its rooms (pages/unitrooms.js), then the usual places, no repeats */
function locations(roomNames) {
  var seen = {}, out = [];
  (roomNames || []).concat(LOCATIONS).forEach(function (n) { n = str(n, 40); var k = n.toLowerCase(); if (n && !seen[k]) { seen[k] = 1; out.push(n); } });
  return out;
}

module.exports = {
  KINDS: KINDS, ITEMS: ITEMS, LOCATIONS: LOCATIONS, STATUSES: STATUSES, PRIORITIES: PRIORITIES, GRACE_MIN: GRACE_MIN,
  kind: kind, label: label, isOpen: isOpen, trail: trail, taskTitle: taskTitle, taskType: taskType, taskId: taskId,
  addMin: addMin, dueFor: dueFor, taskFor: taskFor, make: make, errors: errors, reconcile: reconcile, sort: sort, locations: locations
};
