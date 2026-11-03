// Several assignees on a task (api/_lib/shared/taskwho.cjs): reading old single-assignee tasks, writing both fields,
// spotting a change made by older code, and the unit-request cancel rule that depends on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import W from '../api/_lib/shared/taskwho.cjs';
import R from '../api/_lib/shared/unitreq.cjs';

test('an old task with only assigneeId reads as that one person', () => {
  assert.deepEqual(W.ids({ assigneeId: 's3' }), ['s3']);
  assert.deepEqual(W.ids({ assigneeId: null }), []);
  assert.deepEqual(W.ids({}), []);
  assert.deepEqual(W.ids(null), []);
  assert.equal(W.has({ assigneeId: 's3' }, 's3'), true);
  assert.equal(W.has({ assigneeId: 's3' }, 's4'), false);
  assert.equal(W.none({ assigneeId: null }), true);
});

test('a task with assigneeIds reads every person, first one first, without repeats or junk', () => {
  const t = { assigneeId: 's4', assigneeIds: ['s4', 's5', 's5', '', null, 7] };
  assert.deepEqual(W.ids(t), ['s4', 's5']);
  assert.equal(W.has(t, 's5'), true);
  assert.equal(W.count(t), 2);
});

test('set writes the list and keeps assigneeId as the first person', () => {
  const t = { assigneeId: 's3' };
  const r = W.set(t, ['s4', 's5', 's4']);
  assert.deepEqual(t.assigneeIds, ['s4', 's5']);
  assert.equal(t.assigneeId, 's4');
  assert.deepEqual(r.added, ['s4', 's5']);
  assert.deepEqual(r.removed, ['s3']);
  assert.equal(r.changed, true);
  const r2 = W.set(t, ['s4', 's5']);
  assert.equal(r2.changed, false);
  assert.deepEqual(r2.added, []);
  W.set(t, []);
  assert.equal(t.assigneeId, null);
  assert.deepEqual(t.assigneeIds, []);
  assert.equal(W.none(t), true);
});

test('newly added people are only the ones not on the task before (each is told once)', () => {
  const t = { assigneeId: 's4', assigneeIds: ['s4', 's5'] };
  const r = W.set(t, ['s5', 's6']);
  assert.deepEqual(r.added, ['s6']);
  assert.deepEqual(r.removed, ['s4']);
  assert.equal(t.assigneeId, 's5');
});

test('add and remove', () => {
  const t = { assigneeId: 's4' };
  W.add(t, 's5'); W.add(t, 's5');
  assert.deepEqual(W.ids(t), ['s4', 's5']);
  W.remove(t, 's4');
  assert.deepEqual(W.ids(t), ['s5']);
  assert.equal(t.assigneeId, 's5');
  W.remove(t, 's5');
  assert.deepEqual(W.ids(t), []);
});

test('a change made by older code (assigneeId only) wins over the stale list', () => {
  /* an older app version reassigned the task to s6 */
  assert.deepEqual(W.ids({ assigneeId: 's6', assigneeIds: ['s4', 's5'] }), ['s6']);
  /* an older app version unassigned it */
  assert.deepEqual(W.ids({ assigneeId: null, assigneeIds: ['s4', 's5'] }), []);
  /* an empty list next to a single person is an old record touched by new code before: one person */
  assert.deepEqual(W.ids({ assigneeId: 's4', assigneeIds: [] }), ['s4']);
});

test('soleOrNone: unassigned, or this person alone', () => {
  assert.equal(W.soleOrNone({ assigneeId: null }, 'hk1'), true);
  assert.equal(W.soleOrNone({ assigneeId: 'hk1' }, 'hk1'), true);
  assert.equal(W.soleOrNone({ assigneeId: 'hk1', assigneeIds: ['hk1'] }, 'hk1'), true);
  assert.equal(W.soleOrNone({ assigneeId: 'hk1', assigneeIds: ['hk1', 'mt1'] }, 'hk1'), false);
  assert.equal(W.soleOrNone({ assigneeId: 'mt1', assigneeIds: ['mt1', 'hk1'] }, 'hk1'), false);
  assert.equal(W.soleOrNone({ assigneeId: 'mt1' }, 'hk1'), false);
});

test('fields: the start of a new task record', () => {
  assert.deepEqual(W.fields(['s2', 's3']), { assigneeId: 's2', assigneeIds: ['s2', 's3'] });
  assert.deepEqual(W.fields([]), { assigneeId: null, assigneeIds: [] });
  assert.deepEqual(W.fields(null), { assigneeId: null, assigneeIds: [] });
});

test('unit request tasks: taskFor takes one or several people; the raiser may cancel only when alone on it', () => {
  const r = R.make({ propertyId: 'p1', kind: 'repair', item: 'Basin', priority: 'medium' }, { id: 'RQ-9', by: 'hk1', now: '2026-10-06T10:00' });
  const one = R.taskFor(r, { assigneeId: 'hk1', now: '2026-10-06T10:00' });
  assert.equal(one.assigneeId, 'hk1');
  assert.deepEqual(one.assigneeIds, ['hk1']);
  const two = R.taskFor(r, { assigneeIds: ['mt1', 'hk1'], now: '2026-10-06T10:00' });
  assert.equal(two.assigneeId, 'mt1');
  assert.deepEqual(two.assigneeIds, ['mt1', 'hk1']);
  const none = R.taskFor(r, { now: '2026-10-06T10:00' });
  assert.equal(none.assigneeId, null);
  assert.deepEqual(none.assigneeIds, []);
  const raiser = { viewer: 'hk1', canCreate: true };
  assert.equal(R.canCancel(r, { status: 'todo', assigneeId: 'hk1', assigneeIds: ['hk1'] }, raiser), true, 'raiser alone');
  assert.equal(R.canCancel(r, { status: 'todo', assigneeId: 'hk1', assigneeIds: ['hk1', 'mt1'] }, raiser), false, 'someone else is on it too');
  assert.equal(R.canCancel(r, { status: 'todo', assigneeId: 'mt1', assigneeIds: ['mt1', 'hk1'] }, raiser), false, 'raiser among others');
  assert.equal(R.canCancel(r, { status: 'todo', assigneeId: null, assigneeIds: [] }, raiser), true, 'nobody');
  assert.equal(R.canCancel(r, { status: 'todo', assigneeId: 'hk1', assigneeIds: ['hk1', 'mt1'] }, { viewer: 'x', tasksDelete: true }), true, 'tasks.delete always');
});
