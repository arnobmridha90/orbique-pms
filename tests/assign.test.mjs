/* Unit assignment rules (api/_lib/shared/assign.cjs), the same module the page uses as O.assign.
 *
 *   node --test tests/assign.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import A from '../api/_lib/shared/assign.cjs';

/* one building, two types: Deluxe (21-1, 22-6, 22-9) and Deluxe Supreme (46-1, 49b) */
const units = () => [
  { id: 'u211', unitTypeId: 'UT-d', unitNo: '21-1' },
  { id: 'u226', unitTypeId: 'UT-d', unitNo: '22-6' },
  { id: 'u229', unitTypeId: 'UT-d', unitNo: '22-9' },
  { id: 'u461', unitTypeId: 'UT-s', unitNo: '46-1' },
  { id: 'u49b', unitTypeId: 'UT-s', unitNo: '49b' }
];
const bk = (id, unit, checkIn, checkOut, extra) => Object.assign({ id, unitTypeId: unit && unit.startsWith('u4') ? 'UT-s' : 'UT-d', propertyId: unit, checkIn, checkOut, status: 'confirmed' }, extra || {});
const NOW = '2026-11-01T10:00';

test('best fit: the unit whose neighbouring stays leave the smallest gap', () => {
  const bookings = [
    bk('A', 'u211', '2026-11-05', '2026-11-08'),   /* ends 3 days before the new stay */
    bk('B', 'u226', '2026-11-07', '2026-11-11'),   /* ends the day the new stay starts: perfect on the left */
    bk('C', 'u226', '2026-11-14', '2026-11-16'),   /* starts the day the new stay ends: perfect on the right */
    bk('D', 'u229', '2026-11-20', '2026-11-22')
  ];
  const n = bk('N', null, '2026-11-11', '2026-11-14');
  const r = A.assignUnits({ booking: n, units: units(), bookings: bookings.concat(n), blocks: [], now: NOW });
  assert.equal(r.reason, 'best_fit');
  assert.equal(r.unitId, 'u226');
  assert.deepEqual(r.candidates, ['u226', 'u211', 'u229']);
  assert.deepEqual(r.moved, [{ bookingId: 'N', from: null, to: 'u226' }]);
});

test('best fit ties go to the lower assignPriority, then unit number order', () => {
  const n = bk('N', null, '2026-11-11', '2026-11-14');
  let r = A.assignUnits({ booking: n, units: units(), bookings: [n], blocks: [], now: NOW });
  assert.equal(r.unitId, 'u211'); /* all empty: unit number order */
  const us = units(); us[2].assignPriority = 1;
  r = A.assignUnits({ booking: n, units: us, bookings: [n], blocks: [], now: NOW });
  assert.equal(r.unitId, 'u229');
});

test('blocks and archived units are never candidates; blocks count as neighbours', () => {
  const us = units(); us[0].archived = true;
  const n = bk('N', null, '2026-11-11', '2026-11-14');
  const blocks = [{ id: 'X', propertyId: 'u226', start: '2026-11-12', end: '2026-11-13' }, { id: 'Y', propertyId: 'u229', start: '2026-11-08', end: '2026-11-11' }];
  const r = A.assignUnits({ booking: n, units: us, bookings: [n], blocks, now: NOW });
  assert.equal(r.unitId, 'u229');
});

test('a locked booking is never moved, even when its unit clashes', () => {
  const other = bk('O', 'u211', '2026-11-10', '2026-11-12');
  const lockedB = bk('L', 'u211', '2026-11-11', '2026-11-13', { assignment: { how: 'manual', locked: true } });
  const r = A.assignUnits({ booking: lockedB, units: units(), bookings: [other, lockedB], blocks: [], now: NOW });
  assert.equal(r.reason, 'locked');
  assert.equal(r.lock, 'manual');
  assert.equal(r.unitId, 'u211');
  assert.equal(r.conflict, true);
  assert.equal(A.applyResult(lockedB, r, { how: 'auto' }), false);
  assert.equal(lockedB.propertyId, 'u211');
});

test('locks without a manual pick: guest in-house, door code sent, unit number already shown', () => {
  assert.equal(A.lockReason(bk('a', 'u211', '2026-11-01', '2026-11-03', { status: 'checked_in' }), NOW), 'in_house');
  assert.equal(A.lockReason(bk('b', 'u211', '2026-11-05', '2026-11-07', { codeStatus: 'sent' }), NOW), 'code_sent');
  const c = bk('c', 'u211', '2026-11-01', '2026-11-03', { checkInTime: '15:00' });
  assert.equal(A.lockReason(c, '2026-11-01T14:29'), null);
  assert.equal(A.lockReason(c, '2026-11-01T14:30'), 'revealed');
  assert.equal(A.unitRevealAt(c), '2026-11-01T14:30');
  assert.equal(A.unitRevealAt(bk('d', 'u211', '2026-11-01', '2026-11-03', { checkInTime: '00:10' })), '2026-10-31T23:40');
  assert.equal(A.lockReason(bk('e', null, '2026-11-01', '2026-11-03'), NOW), null); /* nothing to lock without a unit */
});

test('modification keeps the unit while it is still free for the new dates', () => {
  const b = bk('M', 'u229', '2026-11-11', '2026-11-13', { assignment: { how: 'auto', locked: false } });
  const neighbour = bk('P', 'u211', '2026-11-08', '2026-11-11'); /* would be a tighter fit, but the guest keeps 22-9 */
  b.checkOut = '2026-11-15';
  let r = A.assignUnits({ booking: b, units: units(), bookings: [b, neighbour], blocks: [], now: NOW });
  assert.equal(r.reason, 'kept');
  assert.equal(r.unitId, 'u229');
  assert.deepEqual(r.moved, []);
  /* the longer stay now runs into another guest on 22-9: it moves to a free Deluxe unit */
  const later = bk('Q', 'u229', '2026-11-14', '2026-11-16');
  r = A.assignUnits({ booking: b, units: units(), bookings: [b, neighbour, later], blocks: [], now: NOW });
  assert.equal(r.reason, 'best_fit');
  assert.equal(r.unitId, 'u211');
  assert.equal(A.applyResult(b, r, { how: 'auto', by: 'system', at: NOW }), true);
  assert.equal(b.propertyId, 'u211');
  assert.equal(b.assignment.how, 'auto');
  /* "Re-assign" (fresh) ignores the current unit and picks the best fit again */
  const c = bk('R', 'u229', '2026-11-11', '2026-11-13');
  r = A.assignUnits({ booking: c, units: units(), bookings: [c, neighbour], blocks: [], now: NOW, fresh: true });
  assert.equal(r.unitId, 'u211');
});

test('needs_unit: every night has a free unit, but no single unit is free for the whole stay', () => {
  const bookings = [
    bk('A', 'u211', '2026-11-10', '2026-11-12'),
    bk('B', 'u226', '2026-11-12', '2026-11-15'),
    bk('C', 'u229', '2026-11-09', '2026-11-16')
  ];
  const n = bk('N', null, '2026-11-11', '2026-11-14');
  const r = A.assignUnits({ booking: n, units: units(), bookings: bookings.concat(n), blocks: [], now: NOW });
  assert.equal(r.reason, 'needs_unit');
  assert.equal(r.unitId, null);
  assert.equal(r.needsUnit, true);
  assert.equal(r.oversold, false);
  A.applyResult(n, r, { how: 'auto' });
  assert.equal(n.propertyId, null);
  assert.equal(n.needsUnit, true);
  /* the unassigned booking takes the last free place on each night: the type shows 0, not oversold */
  const av = A.typeAvailability({ unitTypeId: 'UT-d', units: units(), bookings: bookings.concat(n), blocks: [], from: '2026-11-11', to: '2026-11-13' });
  assert.deepEqual(av.map((x) => x.availability), [0, 0, 0]);
  assert.deepEqual(av.map((x) => x.raw), [0, 0, 0]);
});

test('oversold: more bookings than units of the type on a night', () => {
  const bookings = [
    bk('A', 'u461', '2026-11-10', '2026-11-13'),
    bk('B', 'u49b', '2026-11-11', '2026-11-12')
  ];
  const n = bk('N', null, '2026-11-11', '2026-11-13', { unitTypeId: 'UT-s' });
  const r = A.assignUnits({ booking: n, units: units(), bookings: bookings.concat(n), blocks: [], now: NOW });
  assert.equal(r.reason, 'oversold');
  assert.equal(r.needsUnit, true);
  assert.equal(r.oversold, true);
  const av = A.typeAvailability({ unitTypeId: 'UT-s', units: units(), bookings: bookings.concat(n), blocks: [], from: '2026-11-11', to: '2026-11-12' });
  assert.deepEqual(av.map((x) => x.raw), [-1, 0]);
  assert.deepEqual(av.map((x) => x.availability), [0, 0]);
});

test('cancelled bookings free their unit; untyped bookings are left alone', () => {
  const gone = bk('G', 'u211', '2026-11-11', '2026-11-13', { status: 'cancelled' });
  const n = bk('N', null, '2026-11-11', '2026-11-13');
  assert.equal(A.assignUnits({ booking: n, units: units(), bookings: [gone, n], blocks: [], now: NOW }).unitId, 'u211');
  const plain = { id: 'P', propertyId: 'bf3b', checkIn: '2026-11-11', checkOut: '2026-11-13', status: 'confirmed' };
  const r = A.assignUnits({ booking: plain, units: units(), bookings: [plain], blocks: [], now: NOW });
  assert.equal(r.reason, 'untyped');
  assert.equal(r.unitId, 'bf3b');
});

test('reassignAll moves unlocked bookings off a blocked unit and fills holes, never touching locked ones', () => {
  const a = bk('A', 'u211', '2026-11-11', '2026-11-13');
  const l = bk('L', 'u226', '2026-11-11', '2026-11-13', { assignment: { how: 'manual', locked: true } });
  const w = bk('W', null, '2026-11-20', '2026-11-22', { needsUnit: true });
  const blocks = [{ id: 'X', propertyId: 'u211', start: '2026-11-12', end: '2026-11-14' }, { id: 'Y', propertyId: 'u226', start: '2026-11-11', end: '2026-11-12' }];
  const bookings = [a, l, w];
  const moves = A.reassignAll({ bookings, units: units(), blocks, now: NOW, by: 'system', at: NOW });
  assert.deepEqual(moves.map((m) => [m.bookingId, m.from, m.to]), [['A', 'u211', 'u229'], ['W', null, 'u211']]);
  assert.equal(l.propertyId, 'u226');
  assert.equal(w.needsUnit, undefined);
});

test('typeAvailability listingOf: one unit\'s own listing is 1 while that unit is free and its type has a unit to sell', () => {
  const units = [{ id: 'P1', unitTypeId: 'UT-P' }, { id: 'P2', unitTypeId: 'UT-P' }];
  const run = (bookings, blocks, listingOf = 'P1') => A.typeAvailability({ unitTypeId: 'LT-1', listingOf, units, bookings, blocks: blocks || [], from: '2026-11-10', to: '2026-11-12' }).map((n) => n.availability).join('');
  assert.equal(run([]), '111');
  assert.equal(run([{ id: 'b1', propertyId: 'P1', unitTypeId: 'UT-P', status: 'confirmed', checkIn: '2026-11-10', checkOut: '2026-11-11' }]), '011');
  assert.equal(run([{ id: 'b1', propertyId: 'P2', unitTypeId: 'UT-P', status: 'confirmed', checkIn: '2026-11-10', checkOut: '2026-11-11' }]), '111');
  assert.equal(run([{ id: 'b1', propertyId: 'P2', unitTypeId: 'UT-P', status: 'confirmed', checkIn: '2026-11-10', checkOut: '2026-11-11' },
    { id: 'b2', propertyId: null, unitTypeId: 'UT-P', status: 'confirmed', checkIn: '2026-11-10', checkOut: '2026-11-12' }]), '011');
  assert.equal(run([{ id: 'b1', propertyId: 'P1', status: 'cancelled', checkIn: '2026-11-10', checkOut: '2026-11-13' }]), '111');
  assert.equal(run([], [{ propertyId: 'P1', start: '2026-11-11', end: '2026-11-12' }]), '101');
  assert.equal(run([], [], 'P9'), '000');
});
