/* Rooms and beds (api/_lib/shared/beds.cjs, O.beds) and unit requests with their tasks (api/_lib/shared/unitreq.cjs,
 * O.unitreq): linen per change, bed defaults, the request -> task fields, and the request <-> task sync rule.
 *
 *   node --test tests/beds-requests.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import B from '../api/_lib/shared/beds.cjs';
import R from '../api/_lib/shared/unitreq.cjs';

const NOW = '2026-11-02T10:15';

/* a Vortex KLCC style 2-bedroom: one queen room, one room with a queen and a single, and a foldable extra bed */
function vortex() {
  const q = B.newBed('queen', 'b1'), q2 = B.newBed('queen', 'b2'), s = B.newBed('single', 'b3'), x = B.newBed('extra', 'b4');
  x.protector = false;
  return B.clean([
    { id: 'r1', kind: 'master', beds: [q] },
    { id: 'r2', kind: 'bed2', beds: [q2, s] },
    { id: 'r3', kind: 'living', name: 'Living room', beds: [x] }
  ]);
}

test('beds: type defaults, retyping keeps what was typed, clean bounds the numbers', () => {
  const q = B.newBed('queen');
  assert.equal(q.mattress, '152x190');
  assert.equal(q.pillows, 2);
  const k = B.retype(q, 'king');
  assert.equal(k.mattress, '183x190', 'a default follows the new type');
  assert.equal(k.pillows, 4);
  const custom = Object.assign(B.newBed('queen'), { mattress: '150x200', pillows: 3 });
  const k2 = B.retype(custom, 'king');
  assert.equal(k2.mattress, '150x200', 'a size the operator typed stays');
  assert.equal(k2.pillows, 3);
  const c = B.clean([{ kind: 'nope', beds: [{ type: 'x', qty: 99, pillows: -2, thick: 'abc', notes: ' a  b ' }] }]);
  assert.equal(c[0].kind, 'other');
  assert.equal(c[0].name, 'Other');
  assert.equal(c[0].beds[0].type, 'other');
  assert.equal(c[0].beds[0].qty, B.MAX_QTY);
  assert.equal(c[0].beds[0].pillows, 0);
  assert.equal(c[0].beds[0].thick, '');
  assert.equal(c[0].beds[0].notes, 'a b');
  assert.equal(B.sizeText('152x190'), 'Queen 152 x 190 cm');
  assert.equal(B.sizeText('150x200'), '150 x 200 cm');
  assert.equal(B.sizeText('custom long'), 'custom long');
});

test('beds: capacity and linen per change for a 2-bedroom with an extra bed', () => {
  const rooms = vortex();
  assert.deepEqual(B.capacity(rooms), { beds: 4, sleeps: 6 });
  const L = B.linen(rooms);
  const n = (key, size) => (L.find((x) => x.key === key && x.size === size) || { n: 0 }).n;
  assert.equal(n('fitted', '152x190'), 2, 'two queen fitted sheets');
  assert.equal(n('fitted', '91x190'), 2, 'single + extra bed');
  assert.equal(n('flat', '210x210'), 2);
  assert.equal(n('flat', '140x210'), 2);
  assert.equal(n('pcase', '48x74'), 6, '2 + 2 + 1 + 1 pillows');
  assert.equal(n('protector', '152x190'), 2);
  assert.equal(n('protector', '91x190'), 1, 'the extra bed has no protector');
  assert.ok(L.filter((x) => x.perChange).every((x, i, a) => a.indexOf(x) === i));
  const firstStay = L.findIndex((x) => !x.perChange);
  assert.ok(firstStay > 0 && L.slice(firstStay).every((x) => !x.perChange), 'comforters and pillows come after what is changed');
  /* a fitted sheet size of its own wins over the mattress size; quantity multiplies */
  const two = B.clean([{ kind: 'bed3', beds: [Object.assign(B.newBed('single'), { qty: 2, fitted: '91x190x20', pcase: '50x75' })] }]);
  const L2 = B.linen(two);
  assert.equal(L2.find((x) => x.key === 'fitted').size, '91x190x20');
  assert.equal(L2.find((x) => x.key === 'fitted').n, 2);
  assert.equal(L2.find((x) => x.key === 'pcase').size, '50x75');
  assert.deepEqual(B.linen([]), []);
});

test('requests: breadcrumb, task title, type and due by priority', () => {
  const r = R.make({ propertyId: 'or4', kind: 'repair', item: ' Basin ', location: 'Master bathroom', priority: 'high' }, { id: 'RQ-1', by: 's3', now: NOW });
  assert.equal(R.trail(r), 'Repair > Basin > Master bathroom');
  assert.equal(R.taskTitle(r), 'Repair: Basin (Master bathroom)');
  const t = R.taskFor(r, { assigneeId: 's6', now: NOW });
  assert.equal(t.id, 'T-RQ-1');
  assert.equal(t.type, 'Maintenance');
  assert.equal(t.requestId, 'RQ-1');
  assert.equal(t.status, 'todo');
  assert.equal(t.assigneeId, 's6');
  assert.equal(t.due, '2026-11-02T14:15', 'high: in 4 hours');
  assert.equal(R.dueFor('medium', NOW), '2026-11-03T17:00');
  assert.equal(R.dueFor('low', '2026-12-30T22:00'), '2027-01-02T17:00');
  assert.equal(R.dueFor('high', '2026-12-31T22:30'), '2027-01-01T02:30');
  assert.equal(R.taskType({ kind: 'purchase' }), 'Restock');
  assert.equal(R.taskType({ kind: 'cleaning' }), 'Housekeeping');
  assert.equal(R.taskType({ kind: 'service' }), 'Maintenance');
  assert.equal(R.taskTitle({ kind: 'service', item: 'Internet connection', location: 'Whole unit' }), 'Service: Internet connection (Whole unit)');
  assert.equal(R.trail({ kind: 'replace', item: 'Plates' }), 'Replacement > Plates');
  assert.deepEqual(Object.keys(R.errors({ kind: 'repair' })).sort(), ['item', 'propertyId']);
  assert.deepEqual(R.errors({ kind: 'cleaning', propertyId: 'x' }), {});
  assert.deepEqual(R.locations(['Master bedroom', 'kitchen']).slice(0, 3), ['Master bedroom', 'kitchen', 'Master bathroom']);
});

function pair() {
  const r = R.make({ propertyId: 'or4', kind: 'replace', item: 'Sofa', location: 'Living room' }, { id: 'RQ-2', by: 's5', now: NOW });
  const t = R.taskFor(r, { now: NOW });
  r.taskId = t.id;
  return { r, t, reqs: [r], tasks: [t] };
}

test('sync: the request follows its task (start, done, reopen) and is idempotent', () => {
  const { r, t, reqs, tasks } = pair();
  let out = R.reconcile(reqs, tasks, { now: NOW });
  assert.equal(out.changed.length, 0, 'nothing to do while both are open');
  t.status = 'in_progress';
  out = R.reconcile(reqs, tasks, { now: NOW });
  assert.equal(r.status, 'in_progress');
  assert.equal(out.events[0].type, 'started');
  t.status = 'done'; t.doneAt = '2026-11-02T12:00'; t.doneBy = 's6';
  out = R.reconcile(reqs, tasks, { now: NOW });
  assert.equal(r.status, 'done');
  assert.equal(r.doneAt, '2026-11-02T12:00');
  assert.equal(r.doneBy, 's6');
  assert.equal(out.events[0].type, 'done');
  const snap = JSON.stringify(reqs);
  out = R.reconcile(reqs, tasks, { now: NOW });
  assert.equal(out.changed.length, 0, 'a second run changes nothing');
  assert.equal(JSON.stringify(reqs), snap);
  /* reopen the task -> the request is open again, without done fields */
  t.status = 'todo'; delete t.doneAt; delete t.doneBy;
  out = R.reconcile(reqs, tasks, { now: NOW });
  assert.equal(r.status, 'open');
  assert.ok(!('doneAt' in r) && !('doneBy' in r));
  assert.equal(out.events[0].type, 'reopened');
});

test('sync: two devices reach the same request', () => {
  const a = pair(), b = pair();
  for (const x of [a, b]) { x.t.status = 'done'; x.t.doneAt = '2026-11-02T12:00'; x.t.doneBy = 's6'; }
  R.reconcile(a.reqs, a.tasks, { now: NOW });
  R.reconcile(b.reqs, b.tasks, { now: '2026-11-02T13:00' });
  assert.deepEqual(a.reqs, b.reqs);
});

test('sync: cancelling a request removes its open task, keeps a done one', () => {
  const { r, reqs, tasks } = pair();
  r.status = 'cancelled';
  let out = R.reconcile(reqs, tasks, { now: NOW });
  assert.equal(tasks.length, 0);
  assert.equal(out.removed.length, 1);
  assert.equal(out.events[0].type, 'task-removed');
  assert.equal(r.status, 'cancelled');
  const p = pair();
  p.t.status = 'done'; p.r.status = 'cancelled';
  out = R.reconcile(p.reqs, p.tasks, { now: NOW });
  assert.equal(p.tasks.length, 1, 'a finished task stays as history');
  assert.equal(p.r.status, 'cancelled', 'the request stays cancelled');
  assert.equal(p.r.keptTask, true);
});

const AT = '2026-11-02T10:00';
test('sync: a request that lost its taskId links back to its task and follows it', () => {
  /* task deleted on device A (request: taskGone), done on device B and synced back */
  const reqs = [{ id: 'RQ-1', status: 'open', taskGone: true, at: AT }];
  const tasks = [{ id: 'T-RQ-1', requestId: 'RQ-1', status: 'done', doneAt: '2026-11-02T12:00', doneBy: 's6' }];
  const out = R.reconcile(reqs, tasks, { now: NOW, seen: () => true });
  assert.equal(reqs[0].status, 'done');
  assert.equal(reqs[0].taskId, 'T-RQ-1');
  assert.equal(reqs[0].taskGone, undefined);
  assert.equal(out.events[0].type, 'done');
  /* unlinked because seen and missing, then the done task arrives */
  const q = [{ id: 'RQ-2', status: 'open', taskId: 'T-RQ-2', at: AT }], qt = [];
  R.reconcile(q, qt, { now: NOW, seen: () => true });
  assert.equal(q[0].taskGone, true);
  qt.push({ id: 'T-RQ-2', requestId: 'RQ-2', status: 'done', doneAt: '2026-11-02T12:00' });
  R.reconcile(q, qt, { now: NOW, seen: () => true });
  assert.equal(q[0].status, 'done');
  assert.equal(q[0].taskId, 'T-RQ-2');
  assert.equal(q[0].taskGone, undefined);
  /* found by requestId even when the task id is not the usual one */
  const z = [{ id: 'RQ-5', status: 'open', at: AT }];
  R.reconcile(z, [{ id: 'T-other', requestId: 'RQ-5', status: 'in_progress' }], { now: NOW });
  assert.equal(z[0].status, 'in_progress');
  assert.equal(z[0].taskId, 'T-other');
});

test('sync: a task that arrives after its request was cancelled is removed', () => {
  const reqs = [{ id: 'RQ-9', status: 'cancelled', taskId: 'T-RQ-9', at: AT }], tasks = [];
  let out = R.reconcile(reqs, tasks, { now: NOW, seen: () => true });
  assert.equal(reqs[0].taskId, 'T-RQ-9', 'taskId is kept for the task that has not arrived');
  tasks.push({ id: 'T-RQ-9', requestId: 'RQ-9', status: 'todo' });
  out = R.reconcile(reqs, tasks, { now: NOW, seen: () => true });
  assert.equal(out.removed.length, 1);
  assert.equal(tasks.length, 0);
  assert.equal(reqs[0].status, 'cancelled');
  /* also when the request had lost its taskId */
  const r2 = [{ id: 'RQ-8', status: 'cancelled', at: AT }], t2 = [{ id: 'T-RQ-8', requestId: 'RQ-8', status: 'in_progress' }];
  out = R.reconcile(r2, t2, { now: NOW });
  assert.equal(t2.length, 0);
});

test('sync: reopening the kept done task of a cancelled request reopens the request, the task stays', () => {
  const reqs = [{ id: 'RQ-3', status: 'cancelled', taskId: 'T-RQ-3', at: AT, cancelledAt: '2026-11-02T11:00', cancelledBy: 's1' }];
  const tasks = [{ id: 'T-RQ-3', requestId: 'RQ-3', status: 'done', doneAt: '2026-11-02T10:30' }];
  R.reconcile(reqs, tasks, { now: NOW });
  assert.equal(reqs[0].keptTask, true);
  assert.equal(tasks.length, 1);
  tasks[0].status = 'todo'; delete tasks[0].doneAt;
  const out = R.reconcile(reqs, tasks, { now: NOW });
  assert.equal(out.removed.length, 0);
  assert.equal(tasks.length, 1);
  assert.equal(reqs[0].status, 'open');
  assert.equal(reqs[0].keptTask, undefined);
  assert.equal(reqs[0].cancelledAt, undefined);
  assert.equal(out.events[0].type, 'uncancelled');
  assert.equal(R.reconcile(reqs, tasks, { now: NOW }).changed.length, 0, 'idempotent');
});

test('requests: who may cancel', () => {
  const r = { id: 'RQ-4', status: 'open', by: 'hk1' };
  const raiser = { viewer: 'hk1', canCreate: true };
  assert.equal(R.canCancel(r, { status: 'todo', assigneeId: null }, raiser), true);
  assert.equal(R.canCancel(r, { status: 'todo', assigneeId: 'hk1' }, raiser), true);
  assert.equal(R.canCancel(r, null, raiser), true);
  assert.equal(R.canCancel(r, { status: 'todo', assigneeId: 'mt1' }, raiser), false, 'taken by someone else');
  assert.equal(R.canCancel(r, { status: 'in_progress', assigneeId: 'hk1' }, raiser), false, 'already started');
  assert.equal(R.canCancel(r, { status: 'in_progress', assigneeId: 'mt1' }, { viewer: 'x', tasksDelete: true }), true);
  assert.equal(R.canCancel(r, { status: 'in_progress', assigneeId: 'mt1' }, { viewer: 'x', propsEdit: true }), true);
  assert.equal(R.canCancel(r, { status: 'todo' }, { viewer: 'x', canCreate: true }), false, 'not the raiser');
  assert.equal(R.canCancel({ id: 'a', status: 'done', by: 'hk1' }, null, { viewer: 'hk1', propsEdit: true }), false, 'only open requests');
});

test('requests: a Cleaning request with no item', () => {
  assert.equal(R.taskTitle({ kind: 'cleaning', item: '' }), 'Cleaning: Whole unit');
  assert.equal(R.taskTitle({ kind: 'cleaning', item: '', location: 'Kitchen' }), 'Cleaning: Kitchen');
});

test('beds: a bunk needs bottom linen for both mattresses', () => {
  const rooms = [{ beds: [B.newBed('bunk', 'B1')] }];
  const L = B.linen(rooms), n = (k) => L.filter((x) => x.key === k).reduce((a, x) => a + x.n, 0);
  assert.equal(B.capacity(rooms).sleeps, 2);
  assert.equal(n('fitted'), 2);
  assert.equal(n('flat'), 2);
  assert.equal(n('protector'), 2);
  assert.equal(n('duvet'), 2);
  assert.equal(n('pcase'), 2);
  const two = B.newBed('bunk', 'B2'); two.qty = 2;
  assert.equal(B.linen([{ beds: [two] }]).filter((x) => x.key === 'fitted')[0].n, 4);
});

test('sync: a deleted task leaves the request open without a task; a task not arrived yet does not', () => {
  const { r, reqs } = pair();
  /* the task row has not arrived from the other device: request made 2 minutes ago, never seen here */
  let out = R.reconcile(reqs, [], { now: '2026-11-02T10:17', seen: () => false });
  assert.equal(out.changed.length, 0);
  assert.equal(r.taskId, 'T-RQ-2');
  /* this device saw the task, now it is gone: deleted */
  r.status = 'in_progress';
  out = R.reconcile(reqs, [], { now: '2026-11-02T10:17', seen: (id) => id === 'T-RQ-2' });
  assert.equal(r.status, 'open');
  assert.equal(r.taskId, undefined);
  assert.equal(r.taskGone, true);
  assert.equal(out.events[0].type, 'unlinked');
  /* after the grace period a missing task counts as deleted too; a done request stays done */
  const q = pair();
  q.r.status = 'done'; q.r.doneAt = '2026-11-02T11:00';
  R.reconcile(q.reqs, [], { now: '2026-11-02T10:40', seen: () => false });
  assert.equal(q.r.status, 'done');
  assert.equal(q.r.taskId, undefined);
  /* a new task for it links again and clears taskGone */
  const t2 = R.taskFor(r, { now: NOW }); r.taskId = t2.id;
  R.reconcile(reqs, [t2], { now: NOW });
  assert.equal(r.taskGone, undefined);
  assert.equal(r.status, 'open');
});

test('requests: open first by priority, then newest closed', () => {
  const list = [
    { id: 'a', status: 'done', at: '2026-10-01T10:00', doneAt: '2026-10-02T10:00' },
    { id: 'b', status: 'open', priority: 'low', at: '2026-10-01T10:00' },
    { id: 'c', status: 'open', priority: 'high', at: '2026-10-03T10:00' },
    { id: 'd', status: 'cancelled', at: '2026-10-05T10:00', cancelledAt: '2026-10-05T11:00' },
    { id: 'e', status: 'in_progress', priority: 'high', at: '2026-10-01T09:00' }
  ];
  assert.deepEqual(R.sort(list).map((x) => x.id), ['e', 'c', 'b', 'd', 'a']);
});
