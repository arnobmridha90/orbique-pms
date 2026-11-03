/* Who a task is assigned to. A task can have several people (Arnob: "in new task, need to be able to assign multiple
 * staff at the same time").
 *
 * A task record keeps:
 *   assigneeIds: [staffId, ...]  every person on the task, in the order they were added (no repeats)
 *   assigneeId:  staffId | null  always assigneeIds[0] (or null), for older records and anything that reads one person
 * Older tasks have only assigneeId. A device still on older code may change assigneeId alone; the rule below spots
 * that (assigneeId no longer equals assigneeIds[0]) and believes assigneeId, so an old device's change wins over a
 * stale list instead of being hidden by it.
 *
 * Every reader goes through ids()/has(); every writer goes through set(), which keeps the two fields in step.
 * One assignee marking the task done completes it for everyone (there is one status per task).
 *
 * Shared by the page (inlined by scripts/build.mjs as O.taskwho, before O.unitreq) and node tests
 * (tests/taskwho.test.mjs). No browser or network code. ES5.
 */
'use strict';

function clean(list) {
  var seen = {}, out = [];
  (Array.isArray(list) ? list : []).forEach(function (id) {
    if (typeof id !== 'string' || !id || seen[id]) return;
    seen[id] = 1; out.push(id);
  });
  return out;
}

/* everyone assigned to task t, first one first; [] when unassigned */
function ids(t) {
  if (!t) return [];
  var one = typeof t.assigneeId === 'string' && t.assigneeId ? t.assigneeId : null;
  var list = clean(t.assigneeIds);
  if (list.length && list[0] === one) return list;
  /* no list, or a writer that only knows assigneeId changed it: assigneeId is the truth */
  return one ? [one] : [];
}

/* is staff id one of the task's assignees? */
function has(t, id) { return !!id && ids(t).indexOf(id) >= 0; }

/* number of people on the task */
function count(t) { return ids(t).length; }

/* nobody is on the task */
function none(t) { return !ids(t).length; }

/* the task is unassigned, or id is its only assignee (used where "someone else's work" must not be touched) */
function soleOrNone(t, id) { var l = ids(t); return !l.length || (l.length === 1 && l[0] === id); }

/* put exactly these people on the task. Returns {added: [...], removed: [...], changed: bool} */
function set(t, list) {
  var before = ids(t), next = clean(list);
  t.assigneeIds = next;
  t.assigneeId = next[0] || null;
  var added = next.filter(function (x) { return before.indexOf(x) < 0; });
  var removed = before.filter(function (x) { return next.indexOf(x) < 0; });
  return { added: added, removed: removed, changed: !!(added.length || removed.length || before.join(',') !== next.join(',')) };
}

/* add one person (kept after the ones already there) */
function add(t, id) { return set(t, ids(t).concat([id])); }

/* take one person off (e.g. a removed team member) */
function remove(t, id) { return set(t, ids(t).filter(function (x) { return x !== id; })); }

/* the fields a new task record starts with */
function fields(list) { var l = clean(list); return { assigneeId: l[0] || null, assigneeIds: l }; }

module.exports = { ids: ids, has: has, count: count, none: none, soleOrNone: soleOrNone, set: set, add: add, remove: remove, fields: fields, clean: clean };
