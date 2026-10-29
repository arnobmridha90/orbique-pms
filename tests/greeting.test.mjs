/* Greeting messages (api/_lib/shared/greeting.cjs), the same module the page uses as O.greeting and the server sends with:
 * fixed wording stays, the parts that change per booking and per unit are filled, and the door code and private fields
 * only reach the guest from 24 hours before check-in.
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
const BEFORE = '2026-11-01T14:59';
const AT = '2026-11-01T15:00';

test('fixed text goes untouched', () => {
  const text = 'Welcome! Breakfast is at 8. No smoking, please.\n\nThank you.';
  const r = G.fill(greeting(text), ctx(), { now: AT });
  assert.equal(r.text, text);
  assert.deepEqual(r.parts, [{ kind: 'fixed', text }]);
});

test('built-in parts are filled from the booking, unit and building', () => {
  const r = G.fill(greeting('Hi {guest_first} ({guest_name}) at {building}, unit {unit_no}: {checkin_date} {checkin_time} to {checkout_date} {checkout_time}, {nights} nights, {guests} guests. Wi-Fi {wifi_name} / {wifi_password}. Parking {parking}. App {guest_app_link}'), ctx(), { now: AT });
  assert.equal(r.text, 'Hi Ana (Ana Silva) at Seri Saujana Residences, unit 21-1: Mon, 2 Nov 2026 3:00 PM to Thu, 5 Nov 2026 11:00 AM, 3 nights, 2 guests. Wi-Fi Saujana21-1 / pw-2026. Parking Basement P2. App https://app.example/guest/tok12345');
  assert.deepEqual(r.held, []);
});

test('custom fields take the value of the booking\'s unit', () => {
  const g = greeting('Bay {f_bay}, lobby {f_lobby_code}', [LOBBY, BAY]);
  assert.equal(G.fill(g, ctx(), { now: AT }).text, 'Bay P2-21, lobby 2101');
  assert.equal(G.fill(g, ctx({ booking: booking({ propertyId: 'u2' }), unit: unit2 }), { now: AT }).text, 'Bay , lobby 2206');
});

test('before check-in minus 24 hours the door code and private fields are held; at that moment they are revealed', () => {
  const g = greeting('Door {door_code}, lobby {f_lobby_code}, bay {f_bay}', [LOBBY, BAY]);
  const early = G.fill(g, ctx(), { now: BEFORE });
  assert.deepEqual(early.held.sort(), ['door_code', 'f_lobby_code']);
  assert.ok(!early.text.includes('4821') && !early.text.includes('2101'), early.text);
  assert.match(early.text, /Door in your guest app \(https:\/\/app\.example\/guest\/tok12345\) from 24 hours before check-in/);
  assert.match(early.text, /bay P2-21$/, 'a field that is not private is sent at once');
  assert.equal(G.fill(g, ctx(), { now: AT }).text, 'Door 4821, lobby 2101, bay P2-21');
  assert.equal(G.fill(g, ctx(), { now: '2026-11-03T09:00' }).text, 'Door 4821, lobby 2101, bay P2-21');
  const unknownTime = G.fill(g, ctx(), {});
  assert.ok(!unknownTime.text.includes('4821') && !unknownTime.text.includes('2101'), 'no send time: held');
});

test('the held wording leaves the link out when the greeting already gives it', () => {
  const r = G.fill(greeting('Code {door_code}. App: {guest_app_link}'), ctx(), { now: BEFORE });
  assert.equal(r.text, 'Code in your guest app from 24 hours before check-in. App: https://app.example/guest/tok12345');
});

test('a typed unit also holds the unit number and the Wi-Fi before the reveal moment', () => {
  const r = G.fill(greeting('Unit {unit_no}, Wi-Fi {wifi_name} {wifi_password}'), ctx({ unitType: { id: 'T1', buildingId: 'BD' } }), { now: BEFORE });
  assert.deepEqual(r.held, ['unit_no', 'wifi_name', 'wifi_password']);
  assert.ok(!/21-1|Saujana21-1|pw-2026/.test(r.text), r.text);
  assert.equal(G.fill(greeting('Unit {unit_no}'), ctx({ unitType: { id: 'T1' } }), { now: AT }).text, 'Unit 21-1');
});

test('the door code and private fields wait for the ID check, even after the reveal moment', () => {
  const g = greeting('Door {door_code}, lobby {f_lobby_code}', [LOBBY]);
  for (const b of [booking({ idVerified: false }), booking({ codeStatus: 'held' })]) {
    const r = G.fill(g, ctx({ booking: b }), { now: AT });
    assert.ok(!r.text.includes('4821') && !r.text.includes('2101'), r.text);
    assert.match(r.text, /once your ID is checked/);
  }
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

test('held reasons: each held part says whether it waits for the time or the ID check, with the reveal time', () => {
  const g = greeting('Door {door_code}, lobby {f_lobby_code}', [LOBBY]);
  const early = G.fill(g, ctx(), { now: BEFORE });
  assert.deepEqual(early.why, { door_code: 'time', f_lobby_code: 'time' });
  assert.equal(early.revealAt, AT);
  assert.match(early.text, /lobby shared with you closer to check-in/); /* not in the guest app, so no promise of it there */
  const id = G.fill(g, ctx({ booking: booking({ idVerified: false }) }), { now: AT });
  assert.deepEqual(id.why, { door_code: 'id', f_lobby_code: 'id' });
  assert.match(id.text, /lobby shared with you once your ID is checked/);
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
