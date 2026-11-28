// Expense types and categories (api/_lib/shared/exptypes.cjs): Settings adds, renames, groups and removes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import X from '../api/_lib/shared/exptypes.cjs';

const BUILT = ['Rent', 'Salaries & wages', 'Cleaning supplies', 'Laundry', 'Repairs & maintenance', 'Utilities', 'Internet & TV', 'Toiletries & amenities', 'Furniture & equipment', 'Transport', 'Marketing', 'Software & subscriptions', 'Insurance', 'Others'];

test('a workspace that never saved a setup gets the default categories and keeps every type', () => {
  const n = X.normalize(BUILT, null);
  assert.deepEqual(n.list, BUILT);
  assert.equal(n.setup.types.Rent.cat, 'property');
  assert.equal(n.setup.types.Rent.fixed, true);
  assert.equal(n.setup.types['Furniture & equipment'].cls, 'capex');
  assert.equal(X.grouped(n.list, n.setup).reduce((s, g) => s + g.types.length, 0), BUILT.length);
});

test('junk is cleaned: duplicates, Others last, unknown categories go to Other', () => {
  const n = X.normalize(['Others', 'Rent', 'rent', ' Pest  control '], { cats: [{ id: 'x', name: 'X' }], types: { 'Pest control': { cat: 'gone', cls: 'capex' } } });
  assert.deepEqual(n.list, ['Rent', 'Pest control', 'Others']);
  assert.equal(n.setup.types['Pest control'].cat, 'other');
  assert.equal(n.setup.types['Pest control'].cls, 'capex');
  assert.ok(n.setup.cats.some((c) => c.id === 'other'));
});

test('add, rename, move and remove types; built-in types stay', () => {
  const st = X.normalize(BUILT, null);
  assert.equal(X.addType(st, 'Pest control', { cat: 'property', fixed: true }), '');
  assert.equal(st.list[st.list.length - 2], 'Pest control');
  assert.equal(st.list[st.list.length - 1], 'Others');
  assert.match(X.addType(st, 'pest CONTROL'), /already a type/);
  assert.match(X.addType(st, '   '), /Type a name/);
  assert.match(X.addType(st, 'x'.repeat(41)), /40 letters/);
  assert.equal(X.renameType(st, 'Laundry', 'Laundry service'), '');
  assert.ok(st.list.includes('Laundry service') && !st.list.includes('Laundry'));
  assert.equal(st.setup.types['Laundry service'].cat, 'supplies');
  assert.match(X.renameType(st, 'Rent', 'Lease'), /built in/);
  assert.match(X.removeType(st, 'Others'), /built in/);
  assert.equal(X.removeType(st, 'Marketing'), '');
  assert.ok(!st.list.includes('Marketing') && !st.setup.types.Marketing);
  X.moveType(st, 'Rent', -1); assert.equal(st.list[0], 'Rent');
  X.moveType(st, 'Rent', 1); assert.equal(st.list[1], 'Rent');
  X.moveType(st, 'Pest control', 1); assert.equal(st.list[st.list.length - 1], 'Others');
});

test('categories: add before Other, rename, delete moves its types to Other', () => {
  const st = X.normalize(BUILT, null);
  assert.equal(X.addCat(st, 'Building fees'), '');
  assert.equal(st.setup.cats[st.setup.cats.length - 1].id, 'other');
  assert.equal(st.lastCat, 'building-fees');
  assert.match(X.addCat(st, 'building FEES'), /already a category/);
  assert.equal(X.setType(st, 'Utilities', { cat: 'building-fees' }), '');
  assert.equal(X.renameCat(st, 'building-fees', 'Building & JMB'), '');
  assert.equal(X.removeCat(st, 'building-fees'), '');
  assert.equal(st.setup.types.Utilities.cat, 'other');
  assert.match(X.removeCat(st, 'other'), /stays/);
});
