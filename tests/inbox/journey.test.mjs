/* Timed guest messages (api/_lib/shared/journey.cjs, api/_lib/journey.js) and the chat helpers that go with them
 * (phone numbers from guests' messages, linking an inquiry to its booking).
 *
 *   node --test tests/inbox/journey.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { processJourney, routeFor, codeAlreadySent } from '../../api/_lib/journey.js';
import { bookingFromInquiry } from '../../api/_lib/inbox.js';
import { fakeSb, op } from './fake-sb.mjs';

const require = createRequire(import.meta.url);
const J = require('../../api/_lib/shared/journey.cjs');

const ON = (extra = {}) => J.settings(Object.assign({
  since: '2026-11-14T12:00', askPhone: true,
  steps: {
    confirm: { on: true, text: 'Thanks {guest_first}! {phone_ask}' },
    welcome: { on: true, text: 'Unit {unit_no} on level {level}. Door {door_code}. Wi-Fi {wifi_name} / {wifi_password}. Deposit RM300.', airbnb: 'Unit {unit_no}. Door {door_code}.' },
    checkout: { on: true, text: 'Check-out tomorrow, {guest_first}.' }
  }
}, extra));
const BK = (o = {}) => Object.assign({ id: 'B-1', status: 'confirmed', checkIn: '2026-11-16', checkOut: '2026-11-18', createdAt: '2026-11-14T13:00', guest: { name: 'Ana Silva' } }, o);

test('settings: no blob sends nothing, every step present, off unless on: true', () => {
  assert.equal(J.settings(null), null);
  const s = J.settings({ steps: { welcome: { on: true, text: 'x' } } });
  assert.deepEqual(Object.keys(s.steps), J.STEPS);
  assert.equal(s.steps.welcome.on, true);
  assert.equal(s.steps.confirm.on, false);
  assert.equal(s.askPhone, true);
  assert.equal(s.since, null);
});

test('dueWindow: confirm at booking, welcome 24h before check-in, checkout 6 PM the evening before', () => {
  const b = BK();
  assert.deepEqual(J.dueWindow('confirm', b, '15:00'), { at: '2026-11-14T13:00', until: '2026-11-16T15:00' });
  assert.deepEqual(J.dueWindow('welcome', b, '15:00'), { at: '2026-11-15T15:00', until: '2026-11-18T10:00' });
  assert.deepEqual(J.dueWindow('checkout', b, '15:00'), { at: '2026-11-17T18:00', until: '2026-11-18T10:00' });
  /* a one-night stay: the reminder is not before check-in */
  assert.equal(J.dueWindow('checkout', BK({ checkOut: '2026-11-17' }), '19:00').at, '2026-11-16T19:00');
  assert.equal(J.addMinutes('2026-12-31T23:30', 45), '2027-01-01T00:15');
});

test('isDue: the step is on, the stay is live, the moment has come, and it fell after the switch-on', () => {
  const cfg = ON();
  assert.equal(J.isDue('confirm', BK(), cfg, '2026-11-14T13:01', '15:00'), true);
  assert.equal(J.isDue('confirm', BK({ createdAt: '2026-11-14T09:00' }), cfg, '2026-11-14T13:01', '15:00'), false, 'booked before the switch-on');
  assert.equal(J.isDue('welcome', BK(), cfg, '2026-11-15T14:59', '15:00'), false, 'too early');
  assert.equal(J.isDue('welcome', BK(), cfg, '2026-11-15T15:00', '15:00'), true);
  assert.equal(J.isDue('welcome', BK({ status: 'cancelled' }), cfg, '2026-11-15T16:00', '15:00'), false);
  assert.equal(J.isDue('welcome', BK({ status: 'checked_in' }), cfg, '2026-11-16T16:00', '15:00'), true);
  assert.equal(J.isDue('checkout', BK(), cfg, '2026-11-18T10:00', '15:00'), false, 'past');
  const off = ON(); off.steps.checkout.on = false;
  assert.equal(J.isDue('checkout', BK(), off, '2026-11-17T18:30', '15:00'), false);
  /* a stay whose welcome moment was before the switch-on gets none */
  assert.equal(J.isDue('welcome', BK({ checkIn: '2026-11-15' }), cfg, '2026-11-14T16:00', '11:00'), false);
});

test('textFor: Airbnb guests get the Airbnb version when there is one', () => {
  const cfg = ON();
  assert.match(J.textFor(cfg, 'welcome', 'airbnb'), /^Unit \{unit_no\}\. Door/);
  assert.match(J.textFor(cfg, 'welcome', 'booking'), /Deposit/);
  assert.match(J.textFor(cfg, 'checkout', 'airbnb'), /Check-out tomorrow/);
});

test('levelOf', () => {
  assert.equal(J.levelOf('41-1'), '41');
  assert.equal(J.levelOf('26-3A'), '26');
  assert.equal(J.levelOf('A-12-3'), '12');
  assert.equal(J.levelOf('PH'), '');
});

test('fill: the unit lock code wins, the level and Wi-Fi come from the unit, {phone_ask} only when asked', () => {
  const unit = { id: 'u1', unitNo: '12-3', lockCode: '9988', wifi: ['Test-WiFi', 'test-pw'] };
  const r = J.fill(ON().steps.welcome.text, { booking: BK({ doorCode: '1111' }), unit }, { now: '2026-11-15T15:00' });
  assert.equal(r.text, 'Unit 12-3 on level 12. Door 9988. Wi-Fi Test-WiFi / test-pw. Deposit RM300.');
  assert.deepEqual(r.missing, []);
  assert.equal(J.fill('Thanks {guest_first}!\n\n{phone_ask}', { booking: BK() }, { askPhone: true }).text, 'Thanks Ana!\n\n' + J.ASK_PHONE);
  assert.equal(J.fill('Thanks {guest_first}!\n\n{phone_ask}\n\nBye', { booking: BK() }, { askPhone: false }).text, 'Thanks Ana!\n\nBye');
  assert.deepEqual(J.fill('Level {level}', { booking: BK(), unit: { id: 'u2', unitNo: 'PH' } }, {}).missing, ['level']);
});

test('phoneIn: one number the message is about; dates, references and prices are not phones', () => {
  assert.equal(J.phoneIn('012-345 6789'), '+60123456789');
  assert.equal(J.phoneIn('My WhatsApp is +44 7700 900123, thanks'), '+447700900123');
  assert.equal(J.phoneIn('60123456789'), '+60123456789');
  assert.equal(J.phoneIn('我的电话 13812345678'), '+13812345678');
  assert.equal(J.phoneIn('We arrive 2026-11-16 around 3pm, is early check-in possible?'), '');
  assert.equal(J.phoneIn('Booking 1234567890 paid RM 450.00, two of us coming from the airport by grab car'), '');
  assert.equal(J.phoneIn('call 0123456789 or 0198765432'), '', 'two numbers: unclear');
  assert.equal(J.samePhone('+60 12-345 6789', '0123456789'), true);
});

test('routeFor: booking-site chat for Airbnb, Booking.com and Expedia, else email, else nothing', () => {
  const o = { channex: true, email: true, ownDomain: 'orbiquepms.com' };
  const cx = { bookingId: '11111111-2222-4333-8444-555555555555' };
  assert.deepEqual(routeFor({ channel: 'airbnb', channex: cx }, o), { via: 'channex', cxBooking: cx.bookingId });
  assert.deepEqual(routeFor({ channel: 'agoda', channex: cx, guest: { email: ' Guest@Example.com ' } }, o), { via: 'email', to: 'guest@example.com' });
  assert.equal(routeFor({ channel: 'agoda', guest: { email: 'kozi-x@orbiquepms.com' } }, o), null, 'our own inbox address');
  assert.equal(routeFor({ channel: 'direct', guest: {} }, o), null);
  assert.equal(routeFor({ channel: 'airbnb', channex: cx }, { email: true }), null, 'Channex off');
});

test('codeAlreadySent: a staff message with the code, spaces ignored', () => {
  const conv = { messages: [{ from: 'guest', text: 'code 9988?' }, { from: 'staff', text: 'Door code: 99 88' }] };
  assert.equal(codeAlreadySent(conv, '9988'), true);
  assert.equal(codeAlreadySent({ messages: [{ from: 'guest', text: '9988' }] }, '9988'), false);
  assert.equal(codeAlreadySent(conv, '99'), false, 'too short to tell');
});

test('bookingFromInquiry: one live booking with the notice\'s name and dates', () => {
  const conv = { messages: [{ from: 'system', text: 'New inquiry from Jasper Lee, 2026-11-12 to 2026-11-15' }] };
  const bookings = [
    { id: 'A', checkIn: '2026-11-12', checkOut: '2026-11-15', status: 'confirmed', guest: { name: 'Jasper Lee' } },
    { id: 'B', checkIn: '2026-11-12', checkOut: '2026-11-15', status: 'cancelled', guest: { name: 'Jasper Tan' } },
    { id: 'C', checkIn: '2026-11-12', checkOut: '2026-11-16', status: 'confirmed', guest: { name: 'Jasper Lim' } }
  ];
  assert.equal(bookingFromInquiry(conv, bookings).id, 'A');
  assert.equal(bookingFromInquiry(conv, bookings.concat({ id: 'D', checkIn: '2026-11-12', checkOut: '2026-11-15', guest: { name: 'jasper ng' } })), null, 'two match');
});

/* ---------- the worker step, against a stand-in database ---------- */

const ORG = '00000000-0000-4000-8000-000000000001';
const NOW = Date.parse('2026-11-15T07:05:00Z'); /* 15:05 Malaysia time */
const CX = '11111111-2222-4333-8444-555555555555';

function world({ bookings, sent = {}, convMessages = [], cfg }) {
  const rows = { journeySent: Object.assign({}, sent) };
  const writes = [];
  const sb = fakeSb({
    handler: (t, ops) => {
      if (t === 'blobs') {
        const key = op(ops, 'eq', 'key');
        if (key === 'guestJourney') return { data: [{ org_id: ORG, data: { v: cfg } }], error: null };
        if (key === 'workspaceBrand') return { data: { data: { v: { name: 'Kozi' } } }, error: null };
        return { data: null, error: null };
      }
      if (t !== 'records') return { data: [], error: null };
      const ins = ops.find((x) => x[0] === 'insert');
      const coll = op(ops, 'eq', 'coll') || (ins && ins[1].coll);
      const upd = ops.find((x) => x[0] === 'update');
      if (ins) {
        if (rows[coll][ins[1].id]) return { data: null, error: { code: '23505', message: 'duplicate' } };
        rows[coll][ins[1].id] = ins[1].data; writes.push(['insert', ins[1].id, ins[1].data.state]); return { data: null, error: null };
      }
      if (upd) { const id = op(ops, 'eq', 'id'); rows[coll][id] = upd[1].data; writes.push(['update', id, upd[1].data.state]); return { data: [{ id }], error: null }; }
      if (ops.some((x) => x[0] === 'maybeSingle')) {
        const id = op(ops, 'eq', 'id');
        if (coll === 'conversations') return { data: { id, data: { messages: convMessages, cx: 'thread' } }, error: null };
        return { data: rows[coll] && rows[coll][id] ? { data: rows[coll][id] } : null, error: null };
      }
      const list = {
        bookings,
        properties: [{ id: 'u1', unitNo: '12-3', lockCode: '9988', wifi: ['Test-WiFi', 'test-pw'], buildingId: 'BD' }],
        unitTypes: [], buildings: [{ id: 'BD', name: 'Vortex KLCC', checkInTime: '15:00' }], greetings: [],
        journeySent: Object.entries(rows.journeySent).map(([id, data]) => ({ id, data }))
      }[coll] || [];
      return { data: list.map((d) => ({ id: d.id, data: d.data || d })), error: null };
    }
  });
  return { sb, rows, writes };
}

const deps = (sent) => ({
  now: NOW, deadline: Date.now() + 60000,
  channexConfig: { key: 'k', env: 'production', orgs: [ORG] },
  emailConfig: { key: 'e', domain: 'orbiquepms.com' },
  find: async () => 'CONV-1',
  address: async () => 'kozi-x@orbiquepms.com',
  send: async (_sb, ctx) => { sent.push(ctx); }
});

test('processJourney sends a due welcome once, through the booking-site chat', async () => {
  const b = BK({ channel: 'airbnb', propertyId: 'u1', createdAt: '2026-11-10T10:00', channex: { bookingId: CX } });
  const w = world({ bookings: [b], cfg: ON({ since: '2026-11-15T12:00' }) });
  const sent = [];
  const out = await processJourney(w.sb, deps(sent));
  assert.deepEqual(out, { sent: 1, skipped: 0, failed: 0 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].via, 'channex');
  assert.equal(sent[0].journey, 'welcome');
  assert.equal(sent[0].text, 'Unit 12-3. Door 9988.', 'Airbnb version, no deposit');
  assert.equal(w.rows.journeySent['B-1:welcome'].state, 'sent');
  /* the next run sends nothing more */
  const again = [];
  assert.deepEqual(await processJourney(w.sb, deps(again)), { sent: 0, skipped: 0, failed: 0 });
  assert.equal(again.length, 0);
});

test('processJourney: email for Agoda, skipped with no route, skipped when the code was sent by hand, failed is kept for a retry', async () => {
  const agoda = BK({ id: 'B-2', channel: 'agoda', propertyId: 'u1', createdAt: '2026-11-10T10:00', guest: { name: 'Mei Tan', email: 'mei@example.com' } });
  const nowhere = BK({ id: 'B-3', channel: 'direct', propertyId: 'u1', createdAt: '2026-11-10T10:00', guest: { name: 'Li' } });
  const w = world({ bookings: [agoda, nowhere], cfg: ON({ since: '2026-11-15T12:00' }) });
  const sent = [];
  const out = await processJourney(w.sb, deps(sent));
  assert.deepEqual(out, { sent: 1, skipped: 1, failed: 0 });
  assert.equal(sent[0].via, 'email');
  assert.equal(sent[0].fromAddress, 'kozi-x@orbiquepms.com');
  assert.equal(sent[0].fromName, 'Kozi');
  assert.match(sent[0].text, /Deposit RM300/);
  assert.equal(w.rows.journeySent['B-3:welcome'].why, 'no-route');

  const byHand = world({ bookings: [agoda], cfg: ON({ since: '2026-11-15T12:00' }), convMessages: [{ from: 'staff', text: 'Your code is 9988' }] });
  assert.deepEqual(await processJourney(byHand.sb, deps([])), { sent: 0, skipped: 1, failed: 0 });
  assert.equal(byHand.rows.journeySent['B-2:welcome'].why, 'sent-by-hand');

  const failing = world({ bookings: [agoda], cfg: ON({ since: '2026-11-15T12:00' }) });
  const d = deps([]); d.send = async () => { throw new Error('Resend 500'); };
  assert.deepEqual(await processJourney(failing.sb, d), { sent: 0, skipped: 0, failed: 1 });
  assert.equal(failing.rows.journeySent['B-2:welcome'].state, 'failed');
  /* tried again only after RETRY_MIN minutes */
  assert.deepEqual(await processJourney(failing.sb, deps([])), { sent: 0, skipped: 0, failed: 0 });
  const later = deps([]); later.now = NOW + (J.RETRY_MIN + 1) * 60000;
  assert.deepEqual(await processJourney(failing.sb, later), { sent: 1, skipped: 0, failed: 0 });
  assert.equal(failing.rows.journeySent['B-2:welcome'].tries, 2);
});

test('processJourney: no welcome before a unit is assigned, and nothing for a workspace with every step off', async () => {
  const noUnit = BK({ channel: 'agoda', createdAt: '2026-11-10T10:00', guest: { name: 'A', email: 'a@example.com' } });
  const w = world({ bookings: [noUnit], cfg: ON({ since: '2026-11-15T12:00' }) });
  assert.deepEqual(await processJourney(w.sb, deps([])), { sent: 0, skipped: 0, failed: 0 });
  const off = world({ bookings: [noUnit], cfg: { steps: {} } });
  assert.deepEqual(await processJourney(off.sb, deps([])), { sent: 0, skipped: 0, failed: 0 });
});

test('doorCodeOf: the unit lock code wins everywhere (greetings too), else the booking code', () => {
  const GM = require('../../api/_lib/shared/guestmsg.cjs');
  const GR = require('../../api/_lib/shared/greeting.cjs');
  assert.equal(GM.doorCodeOf({ doorCode: '1111' }, { lockCode: ' 9988 ' }), '9988');
  assert.equal(GM.doorCodeOf({ doorCode: '1111' }, { lockCode: '' }), '1111');
  assert.equal(GM.doorCodeOf({ doorCode: 1111 }, null), '1111');
  const r = GR.fill({ id: 'g', text: 'Door {door_code}', fields: [] }, { booking: BK({ doorCode: '1111' }), unit: { id: 'u1', unitNo: '12-3', lockCode: '9988' } }, { now: '2026-11-15T15:00' });
  assert.equal(r.text, 'Door 9988');
});
