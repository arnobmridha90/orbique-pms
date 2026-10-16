/* Bookings inbound, the pure parts (api/_lib/channex-bookings.js): revision -> bookings, merging a modification,
 * double-booking detection, card data stripped, ids and codes in the app's formats, webhook authentication.
 *
 *   node --test tests/channex/bookings.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  revisionToBookings, mergeBooking, detectConflicts, channelOf, stripRevision, revisionAttrs, newBookingFields,
  newBookingId, newDoorCode, newGuestToken, utcIso, myt, CHANNEL_KEYS, revisionNights
} from '../../api/_lib/channex-bookings.js';
import { authentic, eventRow } from '../../api/channex-webhook.js';
import { signature } from '../../api/_lib/channex.js';

const RT_T = '11111111-1111-4111-8111-111111111111';
const RT_D = '22222222-2222-4222-8222-222222222222';
const RP_T = '33333333-3333-4333-8333-333333333333';
const ctx = (extra) => Object.assign({
  roomTypes: new Map([[RT_T, 'UT-T'], [RT_D, 'UT-D']]),
  ratePlans: new Map([[RP_T, 'RP-TB']]),
  checkTimes: (t) => (t ? { checkInTime: '14:00', checkOutTime: '12:00' } : {}),
  newId: (i) => 'BK-NEW' + i,
  now: Date.parse('2026-10-15T04:00:00Z')
}, extra || {});

function rev(over) {
  return Object.assign({
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    booking_id: 'bbbbbbbb-0000-4000-8000-000000000001',
    property_id: 'cccccccc-0000-4000-8000-000000000001',
    unique_id: 'BDC-9996013801', ota_reservation_code: '9996013801', ota_name: 'Booking.com', status: 'new',
    arrival_date: '2026-11-20', departure_date: '2026-11-23', arrival_hour: '10:00',
    amount: '330.00', currency: 'MYR', ota_commission: '45.00', payment_collect: 'ota',
    inserted_at: '2026-10-14T23:30:00.123456', notes: 'Late arrival, high floor please',
    customer: { name: 'Anna', surname: 'Smith', mail: 'anna@example.com', phone: '+44 7700 900123', country: 'GB' },
    guarantee: { card_number: '411111******1111', card_type: 'VI', cardholder_name: 'ANNA SMITH', cvv: '***', expiration_date: '12/2029' },
    services: [{ name: 'Cleaning fee', type: 'cleaning', total_price: '30.00' }],
    rooms: [{
      checkin_date: '2026-11-20', checkout_date: '2026-11-23', room_type_id: RT_T, rate_plan_id: RP_T, amount: '300.00',
      days: { '2026-11-20': '100.00', '2026-11-21': '100.00', '2026-11-22': '100.00' },
      occupancy: { adults: 2, children: 1, infants: 0 },
      taxes: [{ name: 'Tourism tax', type: 'tourism_tax', total_price: '30.00' }, { name: 'VAT', total_price: '5.00' }]
    }]
  }, over || {});
}

test('revisionToBookings: one booking with the plan\'s field mapping', () => {
  const { bookings, problems } = revisionToBookings(rev(), ctx());
  assert.deepEqual(problems, []);
  assert.equal(bookings.length, 1);
  const b = bookings[0];
  assert.equal(b.id, 'BK-NEW0');
  assert.equal(b.unitTypeId, 'UT-T'); assert.equal(b.ratePlanId, 'RP-TB'); assert.equal(b.propertyId, null);
  assert.equal(b.channel, 'booking'); assert.equal(b.otaName, 'Booking.com'); assert.equal(b.reservationCode, '9996013801');
  assert.deepEqual(b.channex, { bookingId: rev().booking_id, revisionId: rev().id, uniqueId: 'BDC-9996013801', propertyId: rev().property_id, room: 0 });
  assert.deepEqual(b.guest, { name: 'Anna Smith', email: 'anna@example.com', phone: '+44 7700 900123', country: 'UK', countryName: 'United Kingdom', foreign: true });
  assert.equal(b.guests, 3);
  assert.equal(b.checkIn, '2026-11-20'); assert.equal(b.checkOut, '2026-11-23'); assert.equal(b.nights, 3);
  assert.equal(b.checkInTime, '14:00', 'the building time, not the OTA arrival estimate'); assert.equal(b.arrivalHour, '10:00');
  assert.equal(b.checkOutTime, '12:00');
  assert.equal(b.createdAt, '2026-10-15T07:30', 'first revision time in Malaysia');
  assert.equal(b.sameDay, false);
  assert.equal(b.accommodation, 300); assert.equal(b.nightly, 100);
  assert.equal(b.cleaningFee, 30); assert.equal(b.tourismTax, 30);
  assert.equal(b.total, 330); assert.equal(b.revenue, 330);
  assert.equal(b.platformFee, 45); assert.equal(b.feeEstimated, undefined);
  assert.equal(b.payout, 285); assert.equal(b.paidAt, '2026-10-15'); assert.equal(b.payMethod, 'Paid via Booking.com');
  assert.equal(b.status, 'confirmed'); assert.equal(b.otaNotes, 'Late arrival, high floor please');
  assert.equal(b.currency, undefined, 'MYR is not written');
  assert.equal(b.groupRef, undefined);
  assert.ok(!JSON.stringify(b).includes('4111'), 'no card data on the booking');
  assert.ok(!('notes' in b), 'staff notes are not channel data');
});

test('revisionToBookings: several rooms share a groupRef and split the amounts; unmapped room and rate are problems', () => {
  const r = rev({
    amount: '500.00', ota_commission: '50.00', currency: 'USD', payment_collect: 'property', services: [],
    rooms: [
      { checkin_date: '2026-11-20', checkout_date: '2026-11-22', room_type_id: RT_T, rate_plan_id: RP_T, amount: '200.00', occupancy: { adults: 1 } },
      { checkin_date: '2026-11-20', checkout_date: '2026-11-22', room_type_id: '99999999-9999-4999-8999-999999999999', rate_plan_id: null, amount: '300.00', occupancy: { adults: 2 } }
    ]
  });
  const { bookings, problems } = revisionToBookings(r, ctx({ recordIds: ['BK-OLD'] }));
  assert.deepEqual(bookings.map((b) => b.id), ['BK-OLD', 'BK-NEW1']);
  assert.equal(bookings[0].groupRef, bookings[1].groupRef);
  assert.match(bookings[0].groupRef, /^CX-BBBBBBBB$/);
  assert.deepEqual(bookings.map((b) => [b.total, b.platformFee, b.payout, b.currency, b.guests]), [[200, 20, 200, 'USD', 1], [300, 30, 300, 'USD', 2]]);
  assert.equal(bookings[0].paidAt, undefined, 'collected by the property: not paid yet');
  assert.equal(bookings[1].unitTypeId, null);
  assert.deepEqual(problems.map((p) => [p.kind, p.room]), [['unmapped_room', 1], ['unmapped_rate', 1]]);
});

test('revisionToBookings: cancelled status, estimated fee without ota_commission, channel from prefix or name', () => {
  const b = revisionToBookings(rev({ status: 'cancelled', ota_commission: null, unique_id: 'EXP-1', ota_name: 'Expedia' }), ctx()).bookings[0];
  assert.equal(b.status, 'cancelled'); assert.equal(b.cancelledAt, '2026-10-15');
  assert.equal(b.channel, 'expedia'); assert.equal(b.feeEstimated, true); assert.equal(b.platformFee, 54);
  assert.equal(channelOf({ unique_id: 'ABB-x' }), 'airbnb');
  assert.equal(channelOf({ unique_id: 'AGO-x' }), 'agoda');
  assert.equal(channelOf({ unique_id: 'CTP-x' }), 'trip');
  assert.equal(channelOf({ unique_id: 'XYZ-1', ota_name: 'Trip.com' }), 'trip');
  assert.equal(channelOf({ unique_id: 'OSA-1', ota_name: 'Hostelworld' }), 'other');
});

test('stripRevision and revisionAttrs: no card data kept; API shape unwrapped', () => {
  const s = stripRevision(rev());
  assert.equal(s.guarantee, undefined);
  assert.ok(!JSON.stringify(s).includes('411111'));
  assert.equal(rev().guarantee.card_type, 'VI', 'the input is not changed');
  const a = revisionAttrs({ type: 'booking_revision', id: 'x1', attributes: { status: 'new' } });
  assert.deepEqual(a, { status: 'new', id: 'x1' });
});

test('newBookingFields: door code and guest token like O.bookingDefaults, held code, ID not verified', () => {
  const b = newBookingFields({ id: 'BK-1', status: 'confirmed' });
  assert.match(b.doorCode, /^[1-9]\d{3}$/);
  assert.match(b.guestToken, /^g[A-Za-z0-9_-]{22}$/);
  assert.equal(b.codeStatus, 'held'); assert.equal(b.idVerified, false); assert.equal(b.notes, '');
  assert.equal(newBookingFields({ status: 'cancelled' }).codeStatus, 'cancelled');
  assert.match(newBookingId(), /^BK-[0-9A-Z]{12,}$/);
  const codes = new Set(Array.from({ length: 200 }, newDoorCode));
  assert.ok(codes.size > 100 && [...codes].every((c) => +c >= 1000 && +c <= 9999));
  assert.notEqual(newGuestToken(), newGuestToken());
});

test('mergeBooking: a modification overwrites channel keys only and keeps unit, codes, staff notes and invoices', () => {
  const first = newBookingFields(revisionToBookings(rev(), ctx()).bookings[0]);
  const existing = Object.assign({}, first, {
    propertyId: 'T-03', assignment: { how: 'manual', by: 's1', at: '2026-10-15T09:00', locked: true }, notes: 'VIP', invoiceNo: 'INV-2026-1201',
    idVerified: true, codeStatus: 'scheduled', checkInTime: '12:00', guest: Object.assign({}, first.guest, { idNumber: 'P123' }), currency: 'USD'
  });
  const mod = revisionToBookings(rev({ id: 'aaaaaaaa-0000-4000-8000-000000000002', status: 'modified', rooms: [Object.assign({}, rev().rooms[0], { checkin_date: '2026-11-21', checkout_date: '2026-11-25', days: { '2026-11-21': '120', '2026-11-22': '120', '2026-11-23': '120', '2026-11-24': '120' } })], customer: { name: 'Anna', surname: 'Smith-Jones', phone: '' } }), ctx({ recordIds: [existing.id] })).bookings[0];
  const m = mergeBooking(existing, mod);
  assert.equal(m.id, existing.id);
  assert.equal(m.checkIn, '2026-11-21'); assert.equal(m.checkOut, '2026-11-25'); assert.equal(m.nights, 4); assert.equal(m.accommodation, 480);
  assert.equal(m.propertyId, 'T-03'); assert.deepEqual(m.assignment, existing.assignment);
  assert.equal(m.doorCode, existing.doorCode); assert.equal(m.guestToken, existing.guestToken);
  assert.equal(m.notes, 'VIP'); assert.equal(m.invoiceNo, 'INV-2026-1201'); assert.equal(m.idVerified, true); assert.equal(m.codeStatus, 'scheduled');
  assert.equal(m.checkInTime, '12:00', 'a time staff agreed stays');
  assert.equal(m.guest.name, 'Anna Smith-Jones'); assert.equal(m.guest.phone, '+44 7700 900123', 'empty values do not wipe'); assert.equal(m.guest.idNumber, 'P123');
  assert.equal(m.currency, undefined, 'back to MYR');
  assert.equal(m.channex.revisionId, 'aaaaaaaa-0000-4000-8000-000000000002');
  assert.equal(m.status, 'confirmed'); assert.equal(m._typeChanged, undefined);
  for (const k of CHANNEL_KEYS) assert.ok(!['propertyId', 'doorCode', 'guestToken', 'notes', 'assignment', 'invoiceNo', 'idVerified', 'codeStatus'].includes(k));
});

test('mergeBooking: status moves only between live and cancelled; a changed type asks for a fresh unit', () => {
  const base = { id: 'B1', status: 'checked_in', codeStatus: 'sent', unitTypeId: 'UT-T', propertyId: 'T-01', createdAt: '2026-10-01T10:00', checkIn: '2026-10-14' };
  assert.equal(mergeBooking(base, { status: 'confirmed', unitTypeId: 'UT-T', checkIn: '2026-10-14' }).status, 'checked_in');
  const c = mergeBooking(base, { status: 'cancelled', cancelledAt: '2026-10-15', unitTypeId: 'UT-T' });
  assert.equal(c.status, 'cancelled'); assert.equal(c.cancelledAt, '2026-10-15'); assert.equal(c.codeStatus, 'cancelled');
  const again = mergeBooking(c, { status: 'cancelled', cancelledAt: '2026-10-20', unitTypeId: 'UT-T' });
  assert.equal(again.cancelledAt, '2026-10-15', 'first cancellation date kept');
  const back = mergeBooking(c, { status: 'confirmed', unitTypeId: 'UT-T' });
  assert.equal(back.status, 'confirmed'); assert.equal(back.cancelledAt, undefined); assert.equal(back.codeStatus, 'held');
  assert.equal(mergeBooking({ id: 'B2', status: 'confirmed', unitTypeId: 'UT-T' }, { status: 'confirmed', unitTypeId: 'UT-D' })._typeChanged, true);
  assert.equal(mergeBooking({ id: 'B2', status: 'confirmed', unitTypeId: 'UT-T', assignment: { locked: true } }, { status: 'confirmed', unitTypeId: 'UT-D' })._typeChanged, undefined);
  assert.deepEqual(mergeBooking(null, { id: 'x', status: 'confirmed' }), { id: 'x', status: 'confirmed' });
});

test('detectConflicts: same unit, oversold type, cancelled bookings and blocks', () => {
  const units = [{ id: 'T-1', unitTypeId: 'UT-T' }, { id: 'T-2', unitTypeId: 'UT-T' }, { id: 'D-1', unitTypeId: 'UT-D' }];
  const bk = (id, propertyId, checkIn, checkOut, extra) => Object.assign({ id, unitTypeId: propertyId && propertyId.startsWith('D') ? 'UT-D' : 'UT-T', propertyId, checkIn, checkOut, status: 'confirmed' }, extra || {});
  const a = bk('A', 'T-1', '2026-11-20', '2026-11-23');
  const b = bk('B', 'T-2', '2026-11-21', '2026-11-22');
  const n = bk('N', null, '2026-11-21', '2026-11-24');
  // two units, three bookings on the 21st: oversold
  let r = detectConflicts(n, { units, bookings: [a, b, n] });
  assert.equal(r.double, true); assert.deepEqual(r.with, ['A', 'B']); assert.deepEqual(r.nights, ['2026-11-21']); assert.equal(r.sameUnit, false);
  // fits once B is cancelled
  r = detectConflicts(n, { units, bookings: [a, Object.assign({}, b, { status: 'cancelled' }), n] });
  assert.equal(r.double, false);
  // a locked booking left on a unit someone else holds
  const l = bk('L', 'T-1', '2026-11-22', '2026-11-24', { assignment: { locked: true } });
  r = detectConflicts(l, { units, bookings: [a, l] });
  assert.equal(r.double, true); assert.equal(r.sameUnit, true); assert.deepEqual(r.with, ['A']);
  // a block takes a unit away
  r = detectConflicts(bk('M', null, '2026-11-21', '2026-11-22'), { units, bookings: [a], blocks: [{ propertyId: 'T-2', start: '2026-11-21', end: '2026-11-22' }] });
  assert.equal(r.double, true); assert.deepEqual(r.with, ['A']);
  // other types and cancelled bookings never conflict
  assert.equal(detectConflicts(bk('D', 'D-1', '2026-11-20', '2026-11-23'), { units, bookings: [a, b] }).double, false);
  assert.equal(detectConflicts(Object.assign({}, n, { status: 'cancelled' }), { units, bookings: [a, b] }).double, false);
});

test('times: Channex UTC timestamps without a zone, Malaysia local time', () => {
  assert.equal(utcIso('2019-04-23T10:03:29.335485'), '2019-04-23T10:03:29.335Z');
  assert.equal(utcIso('2019-04-23T10:03:29Z'), '2019-04-23T10:03:29.000Z');
  assert.equal(utcIso('nonsense'), null);
  assert.equal(myt(Date.parse('2026-10-15T17:30:00Z')), '2026-10-16T01:30');
});

test('webhook: signature, token fallback, nothing configured', () => {
  const raw = Buffer.from(JSON.stringify({ event: 'booking', payload: { revision_id: rev().id } }));
  const now = Date.now();
  const ts = String(Math.floor(now / 1000));
  const req = (h) => ({ headers: h });
  const cfg = { webhookSecret: 'sekret', webhookToken: '' };
  assert.equal(authentic(req({ 'x-hmac-timestamp': ts, 'x-hmac-signature-256': signature('sekret', ts, raw) }), raw, cfg, now), true);
  assert.equal(authentic(req({ 'x-hmac-timestamp': ts, 'x-hmac-signature-256': signature('other', ts, raw) }), raw, cfg, now), false);
  assert.equal(authentic(req({ 'x-hmac-timestamp': String(+ts - 600), 'x-hmac-signature-256': signature('sekret', String(+ts - 600), raw) }), raw, cfg, now), false, 'old timestamp');
  assert.equal(authentic(req({ 'x-hmac-timestamp': ts, 'x-hmac-signature-256': signature('sekret', ts, raw) }), Buffer.concat([raw, Buffer.from(' ')]), cfg, now), false, 'body changed');
  const tok = { webhookSecret: '', webhookToken: 'tok-123456' };
  assert.equal(authentic(req({ 'x-orbique-webhook-token': 'tok-123456' }), raw, tok, now), true);
  assert.equal(authentic(req({ 'x-orbique-webhook-token': 'tok-12345' }), raw, tok, now), false);
  assert.equal(authentic(req({}), raw, { webhookSecret: '', webhookToken: '' }, now), false);
  const row = eventRow({ event: 'booking', property_id: 'not-a-uuid', payload: { revision_id: rev().id, booking_id: rev().booking_id, property_id: rev().property_id } }, 'h');
  assert.deepEqual([row.event, row.channex_property_id, row.revision_id, row.booking_id], ['booking', rev().property_id, rev().id, rev().booking_id]);
});

test('revisionNights: old and new nights of the type sold and the unit\'s type, mapped types only, merged', () => {
  const units = [{ id: 'T-01', unitTypeId: 'UT-T' }, { id: 'D-01', unitTypeId: 'UT-D' }, { id: 'X-01', unitTypeId: 'UT-X' }];
  const mapped = new Set(['UT-T', 'UT-D']);
  // a new booking: its nights (check-out exclusive)
  assert.deepEqual(revisionNights([], [{ unitTypeId: 'UT-T', propertyId: 'T-01', checkIn: '2026-11-21', checkOut: '2026-11-23' }], units, mapped),
    [{ target_id: 'UT-T', date_from: '2026-11-21', date_to: '2026-11-22' }]);
  // a modification that moves the stay: old and new nights, joined when they touch
  assert.deepEqual(revisionNights([{ unitTypeId: 'UT-T', checkIn: '2026-11-21', checkOut: '2026-11-23' }], [{ unitTypeId: 'UT-T', checkIn: '2026-11-23', checkOut: '2026-11-25' }], units, mapped),
    [{ target_id: 'UT-T', date_from: '2026-11-21', date_to: '2026-11-24' }]);
  // apart: two ranges; a cancellation still frees (and so invalidates) the old nights
  assert.deepEqual(revisionNights([{ unitTypeId: 'UT-T', checkIn: '2026-11-01', checkOut: '2026-11-02' }], [{ unitTypeId: 'UT-T', status: 'cancelled', checkIn: '2026-11-10', checkOut: '2026-11-11' }], units, mapped),
    [{ target_id: 'UT-T', date_from: '2026-11-01', date_to: '2026-11-01' }, { target_id: 'UT-T', date_from: '2026-11-10', date_to: '2026-11-10' }]);
  // a booking of one type placed on a unit of another counts for both; unmapped types and bad dates are left out
  assert.deepEqual(revisionNights([], [{ unitTypeId: 'UT-T', propertyId: 'D-01', checkIn: '2026-11-05', checkOut: '2026-11-06' }, { unitTypeId: 'UT-X', propertyId: 'X-01', checkIn: '2026-11-05', checkOut: '2026-11-06' }, { unitTypeId: 'UT-T', checkIn: '2026-11-06', checkOut: '2026-11-06' }], units, mapped),
    [{ target_id: 'UT-D', date_from: '2026-11-05', date_to: '2026-11-05' }, { target_id: 'UT-T', date_from: '2026-11-05', date_to: '2026-11-05' }]);
});
