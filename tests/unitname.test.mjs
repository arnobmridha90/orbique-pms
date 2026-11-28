/* Renaming a property carries the new unit number into its unit number and short name (api/_lib/shared/unitname.cjs,
   the same module the Properties page uses as O.unitname), so the calendar shows the new name. */
import test from 'node:test';
import assert from 'node:assert/strict';
import N from '../api/_lib/shared/unitname.cjs';

const OLD = 'Deluxe 2BR Suite 33-3, Kozi @ Vortex KLCC', NEW = 'Deluxe 2BR Suite 33A-3A, Kozi @ Vortex KLCC';

test('the case Arnob reported: 33-3 renamed to 33A-3A', () => {
  const cur = { unitNo: '33-3', short: 'Vortex Deluxe 33-3' };
  assert.deepEqual(N.followRename(OLD, NEW, cur), { unitNo: '33A-3A', short: 'Vortex Deluxe 33A-3A', change: { from: '33-3', to: '33A-3A' } });
});

test('fields the person changed in the same edit are kept as typed', () => {
  const cur = { unitNo: '33-3', short: 'Vortex Deluxe 33-3' };
  const r = N.followRename(OLD, NEW, cur, { unitNo: '33-3', short: 'Deluxe 33A' });
  assert.equal(r.unitNo, '33A-3A');
  assert.equal(r.short, 'Deluxe 33A');
  assert.equal(N.followRename(OLD, NEW, cur, { unitNo: '99-9', short: 'Vortex Deluxe 33-3' }).unitNo, '99-9');
});

test('a rename that does not touch the number changes nothing', () => {
  const cur = { unitNo: '43-6', short: 'Vortex Deluxe 43-6' };
  const r = N.followRename('Deluxe 2BR Suite 43-6, Kozi @ Vortex KLCC', 'Deluxe 2BR Suite 43-6 with KL Tower Views, Kozi @ Vortex KLCC', cur);
  assert.deepEqual(r, { unitNo: '43-6', short: 'Vortex Deluxe 43-6', change: null });
});

test('the 2BR in a name is not mistaken for the unit number', () => {
  const r = N.followRename('Deluxe 2BR Suite 47-7', 'Deluxe 3BR Suite 47-7', { unitNo: '47-7', short: 'Vortex 47-7' });
  assert.equal(r.unitNo, '47-7');
  assert.equal(r.short, 'Vortex 47-7');
});

test('a unit number that is not in the old name is left alone', () => {
  const r = N.followRename('Bayfront Loft 1A', 'Bayfront Loft 2A', { unitNo: '', short: 'Bayfront 1A' });
  assert.equal(r.unitNo, '');
  assert.equal(r.short, 'Bayfront 2A');
});

test('words added around the number still find it', () => {
  const r = N.followRename('Suite 26-3A', 'Premier Suite 26-3B, Kozi', { unitNo: '26-3A', short: 'Premier 26-3A' });
  assert.equal(r.unitNo, '26-3B');
  assert.equal(r.short, 'Premier 26-3B');
});

test('a short name that would grow past 20 characters is kept', () => {
  const r = N.followRename('Suite 1-1', 'Suite 1-1ABCDEFGH', { unitNo: '1-1', short: 'Vortex Deluxe KL 1-1' });
  assert.equal(r.unitNo, '1-1ABCDEFGH');
  assert.equal(r.short, 'Vortex Deluxe KL 1-1');
});
