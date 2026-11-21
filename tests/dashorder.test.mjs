// Each person's Dashboard card order (api/_lib/shared/dashorder.cjs): defaults, reading a saved order, new cards,
// and keeping hidden cards' places when a drag saves what is on screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import L from '../api/_lib/shared/dashorder.cjs';

const all = (o) => (Array.isArray(o[0]) ? o[0].concat(o[1]) : o).slice().sort();

test('defaults name every card once, phone order starts with what happens today', () => {
  for (const mineFirst of [false, true]) {
    assert.deepEqual(all(L.defaults('narrow', { mineFirst })), L.KEYS.slice().sort());
    assert.deepEqual(all(L.defaults('wide', { mineFirst })), L.KEYS.slice().sort());
  }
  assert.deepEqual(L.defaults('narrow', {}).slice(0, 3), ['arrivals', 'sameday', 'departures']);
  assert.equal(L.defaults('narrow', { mineFirst: true })[0], 'tasks');
  assert.deepEqual(L.defaults('wide', {})[0], ['arrivals', 'sameday', 'departures', 'newtoday', 'inhouse']);
});

test('nothing saved or junk saved gives the default for this person', () => {
  assert.deepEqual(L.merge('narrow', null, {}), L.defaults('narrow', {}));
  assert.deepEqual(L.merge('narrow', ['nope', 3], { mineFirst: true }), L.defaults('narrow', { mineFirst: true }));
  assert.deepEqual(L.merge('wide', ['tasks'], {}), L.defaults('wide', {}));
  assert.deepEqual(L.merge('wide', null, { stays: false }), L.defaults('wide', { stays: false }));
});

test('a saved order is kept, cleaned, and a card it does not name goes after the card it follows by default', () => {
  const saved = ['costs', 'tasks', 'tasks', 'arrivals', 'bogus', 'sameday', 'departures', 'attention', 'newtoday', 'inhouse'];
  const out = L.merge('narrow', saved, {});
  assert.deepEqual(out, ['costs', 'tasks', 'arrivals', 'sameday', 'departures', 'attention', 'newtoday', 'inhouse', 'duesoon']);
  const wide = L.merge('wide', [['tasks', 'arrivals'], ['attention', 'arrivals']], {});
  assert.deepEqual(all(wide), L.KEYS.slice().sort());
  assert.deepEqual(wide[0].slice(0, 2), ['tasks', 'arrivals']);
  assert.equal(wide[1][0], 'attention');
  assert.ok(wide[0].indexOf('sameday') === wide[0].indexOf('arrivals') + 1);
});

test('a drag saves the new order and keeps hidden cards where they were', () => {
  const prev = ['arrivals', 'sameday', 'departures', 'attention', 'tasks', 'newtoday', 'inhouse', 'duesoon', 'costs'];
  // sameday and costs were not drawn (empty today / no access); tasks moved to the top
  const next = L.afterDrag('narrow', ['tasks', 'arrivals', 'departures', 'attention', 'newtoday', 'inhouse', 'duesoon'], prev);
  assert.deepEqual(next, ['tasks', 'arrivals', 'sameday', 'departures', 'attention', 'newtoday', 'inhouse', 'duesoon', 'costs']);
  const wPrev = L.defaults('wide', {});
  const w = L.afterDrag('wide', [['tasks', 'arrivals', 'departures'], ['attention', 'costs', 'duesoon', 'newtoday']], wPrev);
  assert.deepEqual(all(w), L.KEYS.slice().sort());
  assert.deepEqual(w[0].slice(0, 2), ['tasks', 'arrivals']);
  assert.equal(w[0][2], 'sameday');
  assert.ok(w[1].indexOf('newtoday') >= 0 && w[0].indexOf('newtoday') < 0);
});
