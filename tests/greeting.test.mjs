/* Greeting messages (api/_lib/shared/greeting.cjs), the same module the page uses as O.greeting and the server sends with:
 * fixed wording stays, the parts that change per booking and per unit are filled, and a greeting always goes in full
 * (owner, 2026-10-29): the door code, private fields, unit number and Wi-Fi with no time or ID-check hold.
 *
 *   node --test tests/greeting.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import G from '../api/_lib/shared/greeting.cjs';

const booking = (extra) => Object.assign({ id: 'B1', propertyId: 'u1', checkIn: '2026-11-02', checkOut: '2026-11-05', nights: 3, guests: 2, guest: { name: 'Ana Silva' }, doorCode: '4821', idVerified: true, codeStatus: 'scheduled', guestToken: 'tok12345' }, extra || {});
const unit = { id: 'u1', name: 'Saujana 21-1', unitNo: '21-1', wifi: ['Saujana21-1', 'pw-2026'], parking: 'Basement P2' };
const unit2 = { id: 'u2', name: 'Saujana 22-6', unitNo: '22-6', wifi: ['Saujana22-6', 'pw-226'] };
const building = { id: 'BD', name: 'Seri Saujana Residences', checkInTime: '15:00' };
const greeting = (text, fields) => ({ id: 'GR1', buildingId: 'BD', name: 'Arrival', text, fields: fields || [] });
const LOBBY = { key: 'lobby_code', label: 'Lobby code', private: true, values: { u1: '2101', u2: '2206' } };
const BAY = { key: 'bay', label: 'Parking bay', private: false, values: { u1: 'P2-21' } };
const ctx = (extra) => Object.assign({ booking: booking(), unit, building, link: 'https://app.example/guest/tok12345' }, extra || {});
const EARLY = '2026-10-30T09:00';  /* days before check-in (2 Nov 15:00) */
const BEFORE = '2026-11-01T14:59'; /* one minute more than 24 hours before check-in */
const AT = '2026-11-01T15:00';     /* exactly 24 hours before check-in */

test('fixed text goes untouched', () => {
  const text = 'Welcome! Breakfast is at 8. No smoking, please.\n\nThank you.';
  const r = G.fill(greeting(text), ctx(), { now: AT });
  assert.equal(r.text, text);
  assert.deepEqual(r.parts, [{ kind: 'fixed', text }]);
});

test('built-in parts are filled from the booking, unit and building', () => {
  const r = G.fill(greeting('Hi {guest_first} ({guest_name}) at {building}, unit {unit_no}: {checkin_date} {checkin_time} to {checkout_date} {checkout_time}, {nights} nights, {guests} guests. Wi-Fi {wifi_name} / {wifi_password}. Parking {parking}. App {guest_app_link}'), ctx(), { now: AT });
  assert.equal(r.text, 'Hi Ana (Ana Silva) at Seri Saujana Residences, unit 21-1: Mon, 2 Nov 2026 3:00 PM to Thu, 5 Nov 2026 11:00 AM, 3 nights, 2 guests. Wi-Fi Saujana21-1 / pw-2026. Parking Basement P2. App https://app.example/guest/tok12345');
  assert.equal(r.held, undefined, 'nothing is held, so there is no held list');
});

test('custom fields take the value of the booking\'s unit', () => {
  const g = greeting('Bay {f_bay}, lobby {f_lobby_code}', [LOBBY, BAY]);
  assert.equal(G.fill(g, ctx(), { now: AT }).text, 'Bay P2-21, lobby 2101');
  assert.equal(G.fill(g, ctx({ booking: booking({ propertyId: 'u2' }), unit: unit2 }), { now: AT }).text, 'Bay , lobby 2206');
});

test('the door code and private fields are sent in full at any time, even days before check-in', () => {
  const g = greeting('Door {door_code}, lobby {f_lobby_code}, bay {f_bay}', [LOBBY, BAY]);
  for (const now of [EARLY, BEFORE, AT, '2026-11-03T09:00']) assert.equal(G.fill(g, ctx(), { now }).text, 'Door 4821, lobby 2101, bay P2-21', now);
  assert.equal(G.fill(g, ctx(), {}).text, 'Door 4821, lobby 2101, bay P2-21', 'no send time: still in full');
  assert.ok(!/guest app|closer to check-in|once your ID/.test(G.fill(g, ctx(), { now: EARLY }).text), 'no held wording');
});

test('a typed unit\'s number and Wi-Fi are sent in full before the 24-hour moment too', () => {
  const r = G.fill(greeting('Unit {unit_no}, Wi-Fi {wifi_name} {wifi_password}'), ctx({ unitType: { id: 'T1', buildingId: 'BD' } }), { now: EARLY });
  assert.equal(r.text, 'Unit 21-1, Wi-Fi Saujana21-1 pw-2026');
  assert.ok(r.parts.every((p) => p.kind === 'fixed' || p.kind === 'var'));
});

test('no ID-check hold: the door code and private fields go even when the ID is not checked yet', () => {
  const g = greeting('Door {door_code}, lobby {f_lobby_code}', [LOBBY]);
  for (const b of [booking({ idVerified: false }), booking({ codeStatus: 'held' })]) assert.equal(G.fill(g, ctx({ booking: b }), { now: EARLY }).text, 'Door 4821, lobby 2101');
});

test('early: true while check-in is more than 24 hours away (the preview note), false from 24 hours before', () => {
  const g = greeting('Door {door_code}');
  const at = (now) => G.fill(g, ctx(), { now });
  assert.equal(at(EARLY).early, true);
  assert.equal(at(BEFORE).early, true, 'one minute before the 24-hour moment');
  assert.equal(at(AT).early, false, 'exactly 24 hours before');
  assert.equal(at('2026-11-02T14:30').early, false);
  assert.equal(at(EARLY).checkInAt, '2026-11-02T15:00');
  assert.equal(at(EARLY).text, 'Door 4821', 'early changes the note only, never the text');
  assert.equal(G.fill(g, ctx(), {}).early, false, 'no clock: no note');
  assert.equal(G.fill(g, { building }, { now: EARLY }).early, false, 'sample preview: no note');
  assert.equal(G.fill(g, ctx({ unit: { id: 'u1', checkInTime: '16:00' }, building: null }), { now: '2026-11-01T15:30' }).early, true, 'the unit\'s own 16:00 check-in');
});

test('unknown placeholders stay as they are', () => {
  const r = G.fill(greeting('Hi {guest_first}, {pool_hours} and {f_nope}'), ctx(), { now: AT });
  assert.equal(r.text, 'Hi Ana, {pool_hours} and {f_nope}');
  assert.deepEqual(r.parts.filter((p) => p.kind === 'unknown').map((p) => p.key), ['pool_hours', 'f_nope']);
});

test('a unit with no value, or a booking with no unit yet, is blank-safe', () => {
  const g = greeting('Lobby [{f_lobby_code}] bay [{f_bay}] unit [{unit_no}] parking [{parking}]', [LOBBY, BAY]);
  const r = G.fill(g, ctx({ booking: booking({ propertyId: null }), unit: null }), { now: AT });
  assert.equal(r.text, 'Lobby [] bay [] unit [] parking []');
  assert.deepEqual(r.missing.sort(), ['f_bay', 'f_lobby_code']);
  assert.ok(!r.text.includes('undefined') && !r.text.includes('null'));
});

test('mask: people without door-code access see "[door code hidden]" for values that would be sent', () => {
  const g = greeting('Door {door_code}, lobby {f_lobby_code}, bay {f_bay}', [LOBBY, BAY]);
  assert.equal(G.fill(g, ctx(), { now: AT, mask: true }).text, 'Door [door code hidden], lobby [door code hidden], bay P2-21');
});

test('no booking: sample values for the editor preview', () => {
  const r = G.fill(greeting('Hi {guest_first} at {building}, lobby {f_lobby_code}', [LOBBY]), { building }, {});
  assert.equal(r.sample, true);
  assert.equal(r.text, 'Hi Aisha at Seri Saujana Residences, lobby 2101');
  assert.equal(G.fill(greeting('{f_lobby_code}', [LOBBY]), {}, { mask: true }).text, '[Lobby code]', 'a private value is not shown in a masked sample');
});

test('fields: keys from labels, private by default for codes, cleaned on save', () => {
  assert.equal(G.fieldKey('Lobby code'), 'lobby_code');
  assert.equal(G.fieldKey('Lobby code', ['lobby_code']), 'lobby_code_2');
  assert.equal(G.fieldKey('!!!'), 'field');
  for (const l of ['Door password', 'Lobby code', 'Gate PIN', 'Passcode']) assert.equal(G.defaultPrivate(l), true, l);
  for (const l of ['Parking bay', 'Floor', 'Pool hours']) assert.equal(G.defaultPrivate(l), false, l);
  const c = G.clean({ id: 'X', buildingId: 'BD', name: '  Arrival ', text: 'x', fields: [{ label: 'Gate PIN', values: { u1: ' 12 ', u2: '' } }, { key: 'bad key', label: 'Floor' }] });
  assert.equal(c.name, 'Arrival');
  assert.deepEqual(c.fields, [{ key: 'gate_pin', label: 'Gate PIN', private: true, values: { u1: '12' } }, { key: 'floor', label: 'Floor', private: false, values: {} }]);
  assert.deepEqual(G.keysIn('{a} {b} {a}'), ['a', 'b']);
  assert.deepEqual(G.forBuilding([{ id: '2', buildingId: 'BD', name: 'Long stay' }, { id: '1', buildingId: 'BD', name: 'Arrival' }, { id: '3', buildingId: 'X', name: 'A' }], 'BD').map((g) => g.id), ['1', '2']);
});

test('mask: the preview hides private values from people without door-code access, the send does not', () => {
  const g = greeting('Door {door_code}, lobby {f_lobby_code}', [LOBBY]);
  assert.equal(G.fill(g, ctx(), { now: EARLY, mask: true }).text, 'Door [door code hidden], lobby [door code hidden]');
  assert.equal(G.fill(g, ctx(), { now: EARLY }).text, 'Door 4821, lobby 2101');
});

test('mask: a typed unit\'s number and Wi-Fi are not shown as a door code', () => {
  const g = greeting('Unit {unit_no}, wifi {wifi_name}, door {door_code}');
  const r = G.fill(g, ctx({ unitType: { id: 'T1', buildingId: 'BD' } }), { now: AT, mask: true });
  assert.equal(r.text, 'Unit 21-1, wifi Saujana21-1, door [door code hidden]');
});

test('inherited names like {constructor} and {__proto__} are unknown, not filled', () => {
  const r = G.fill(greeting('{constructor} {__proto__} {hasownproperty}'), ctx(), { now: AT });
  assert.equal(r.text, '{constructor} {__proto__} {hasownproperty}');
  assert.deepEqual(r.parts.filter((p) => p.kind === 'unknown').map((p) => p.key), ['constructor', '__proto__', 'hasownproperty']);
  assert.deepEqual(G.keysIn('{constructor} {__proto__}'), ['constructor', '__proto__']); /* the editor's unknown-part check sees them */
  assert.equal(G.isBuiltin('constructor'), false);
});

test('private by default only for whole words that sound like a code', () => {
  for (const l of ['Lobby code', 'Door password', 'PIN', 'Doorcode', 'Gate passcode']) assert.equal(G.defaultPrivate(l), true, l);
  for (const l of ['Shopping mall', 'Postcode', 'Spinning class', 'Parking bay']) assert.equal(G.defaultPrivate(l), false, l);
});
