/* Guest message timing (api/_lib/shared/guestmsg.cjs), the same module the page uses as O.guestmsg:
 * the door code (and for a unit type the unit number and Wi-Fi) only in messages sent from 30 minutes before check-in.
 *
 *   node --test tests/guestmsg.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import G from '../api/_lib/shared/guestmsg.cjs';

const bk = (extra) => Object.assign({ id: 'B1', checkIn: '2026-11-02', checkOut: '2026-11-05', createdAt: '2026-10-01T08:15:00Z' }, extra || {});
const LINK = 'stay.example.com/stay/b1';
const vars = () => ({ guest_first: 'Ana', door_code: '4821', unit_no: '21-1', wifi_name: 'Saujana21-1', wifi_password: 'pw-2026', parking: 'P2-21' });

test('check-in time: booking, then unit, then building, then 15:00', () => {
  assert.equal(G.ciTimeOf({ checkInTime: '14:00' }, { checkInTime: '16:00' }, { checkInTime: '17:00' }), '14:00');
  assert.equal(G.ciTimeOf({}, { checkInTime: '16:00' }, { checkInTime: '17:00' }), '16:00');
  assert.equal(G.ciTimeOf({ checkInTime: '' }, {}, { checkInTime: '17:00' }), '17:00');
  assert.equal(G.ciTimeOf({ checkInTime: 'soon' }, null, null), '15:00');
  assert.equal(G.ciTimeOf(null, null, null), '15:00');
});

test('reveal moment is check-in minus 30 minutes', () => {
  assert.equal(G.revealAt(bk(), '15:00'), '2026-11-02T14:30');
  assert.equal(G.revealAt(bk({ checkInTime: '16:00' }), '16:00'), '2026-11-02T15:30');
  assert.equal(G.revealAt(bk({ checkInTime: '00:15' }), '00:15'), '2026-11-01T23:45');
  assert.equal(G.revealAt({}, '15:00'), null);
});

test('the door-code step (j4) goes out at check-in minus 30 minutes; other steps keep their times', () => {
  const b = bk();
  assert.equal(G.stepSendAt('j4', b, '16:00'), '2026-11-02T15:30');
  assert.equal(G.stepSendAt('j1', b, '16:00'), '2026-10-01T08:15');
  assert.equal(G.stepSendAt('j3', b, '16:00'), '2026-10-30T09:00');
  assert.equal(G.stepSendAt('j5', b, '16:00'), '2026-11-02T09:00');
  assert.equal(G.stepSendAt('j6', b, '16:00'), '2026-11-03T09:00');
  assert.equal(G.stepSendAt('j7', b, '16:00'), '2026-11-04T18:00');
  assert.equal(G.stepSendAt('custom', b, '16:00'), null);
});

test('before the reveal moment the door code is held and points to the guest app', () => {
  const g = G.guardVars(vars(), { b: bk(), sendAt: '2026-11-02T14:29', ciTime: '15:00', typed: false, link: LINK });
  assert.deepEqual(g.held, ['door_code']);
  assert.equal(g.vars.door_code, 'in your guest app (' + LINK + ') from 30 minutes before check-in');
  assert.equal(g.vars.wifi_name, 'Saujana21-1', 'an untyped unit keeps its Wi-Fi');
  assert.equal(g.vars.unit_no, '21-1');
});

test('at and after the reveal moment nothing is held', () => {
  for (const at of ['2026-11-02T14:30', '2026-11-02T20:00', '2026-11-03T09:00']) {
    const g = G.guardVars(vars(), { b: bk(), sendAt: at, ciTime: '15:00', typed: true, link: LINK });
    assert.deepEqual(g.held, [], at);
    assert.equal(g.vars.door_code, '4821');
    assert.equal(g.vars.unit_no, '21-1');
  }
});

test('a typed unit also holds the unit number and the Wi-Fi', () => {
  const g = G.guardVars(vars(), { b: bk(), sendAt: '2026-10-30T09:00', ciTime: '15:00', typed: true, link: '' });
  assert.deepEqual(g.held, ['door_code', 'unit_no', 'wifi_name', 'wifi_password']);
  assert.equal(g.vars.unit_no, 'in your guest app from 30 minutes before check-in');
  assert.equal(g.vars.wifi_password, 'in your guest app');
  assert.equal(g.vars.parking, 'P2-21');
  assert.ok(!JSON.stringify(g.vars).includes('4821') && !JSON.stringify(g.vars).includes('21-1'));
});

test('an unknown send time holds, and the input is not changed', () => {
  const v = vars();
  const g = G.guardVars(v, { b: bk(), sendAt: null, ciTime: '15:00' });
  assert.deepEqual(g.held, ['door_code']);
  assert.equal(v.door_code, '4821');
  assert.deepEqual(G.guardVars(v, { b: {}, sendAt: '2026-11-02T20:00' }).held, ['door_code']);
});

test('empty values are not replaced', () => {
  const g = G.guardVars({ door_code: '', unit_no: null }, { b: bk(), sendAt: '2026-10-01T00:00', typed: true });
  assert.deepEqual(g.held, []);
});

test('templates: each journey step for a booking with a 16:00 unit check-in', () => {
  const b = bk(), ci = G.ciTimeOf(b, { checkInTime: '16:00' }, { checkInTime: '15:00' });
  const text = 'Hi {guest_first}, your code is {door_code}. {unknown}';
  const at = (step) => G.fillTemplate(text, vars(), { b, sendAt: G.stepSendAt(step, b, ci), ciTime: ci, link: LINK });
  assert.equal(at('j4'), 'Hi Ana, your code is 4821. {unknown}');
  for (const step of ['j1', 'j3', 'j5']) assert.ok(!at(step).includes('4821'), step);
  assert.ok(at('j5').includes(LINK));
  assert.ok(at('j6').includes('4821'), 'after check-in the code may be repeated');
});
