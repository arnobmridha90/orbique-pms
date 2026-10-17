/* Pure parts of the ARI sender and setup (api/_lib/channex-sync.js, channex-setup.js, api/channex.js helpers). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compressValues, diffValues, backoffMs, restrictionValue, planRate, toItems, markDates, stableKey, rejectedItems, datesText, BACKOFF_MAX_MS } from '../../api/_lib/channex-sync.js';
import { propertyBody, roomTypeBody, ratePlanBody, occupancy, groupTitle, buildingProblems, propertyType, PROPERTY_TYPES, PROPERTY_SETTINGS } from '../../api/_lib/channex-setup.js';
import { allowedOrg, webhookBody, appUrl, IFRAME_CHANNELS } from '../../api/channex.js';
import { todayMY, addDays } from '../../api/_lib/channex-db.js';

const row = (target_id, date, value) => ({ target_id, date, value });

test('compressValues: consecutive equal values become one range, per target', () => {
  const rows = [
    row('A', '2026-11-03', { rate: '100.00' }), row('A', '2026-11-01', { rate: '100.00' }), row('A', '2026-11-02', { rate: '100.00' }),
    row('A', '2026-11-04', { rate: '120.00' }),
    row('B', '2026-11-01', { availability: 3 }), row('B', '2026-11-03', { availability: 3 }) // gap on the 2nd
  ];
  assert.deepEqual(compressValues(rows), [
    { target_id: 'A', date_from: '2026-11-01', date_to: '2026-11-03', value: { rate: '100.00' } },
    { target_id: 'A', date_from: '2026-11-04', date_to: '2026-11-04', value: { rate: '120.00' } },
    { target_id: 'B', date_from: '2026-11-01', date_to: '2026-11-01', value: { availability: 3 } },
    { target_id: 'B', date_from: '2026-11-03', date_to: '2026-11-03', value: { availability: 3 } }
  ]);
});

test('compressValues: key order does not matter, month and year ends join, bad dates are dropped', () => {
  const rows = [row('A', '2026-12-31', { a: 1, b: true }), row('A', '2027-01-01', { b: true, a: 1 }), row('A', '2027-02-30', { a: 1, b: true }), row('A', 'x', {})];
  assert.deepEqual(compressValues(rows), [{ target_id: 'A', date_from: '2026-12-31', date_to: '2027-01-01', value: { a: 1, b: true } }]);
  assert.deepEqual(compressValues([]), []);
  assert.deepEqual(compressValues(null), []);
});

test('compressValues: a half year of one value is one item (certification test 8)', () => {
  const rows = [];
  for (let d = '2026-12-01'; d <= '2027-05-01'; d = addDays(d, 1)) rows.push(row('TB', d, { rate: '432.00', min_stay_arrival: 2 }));
  const out = compressValues(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].date_from, '2026-12-01');
  assert.equal(out[0].date_to, '2027-05-01');
});

test('diffValues: fields a person set go out even when Channex has them, once (certification tests 7 and 8)', () => {
  const v = { rate: '241.00', min_stay_arrival: 1, max_stay: 4, closed_to_arrival: true, closed_to_departure: false, stop_sell: false };
  const old = { rate: '241.00', min_stay_arrival: 1, max_stay: 0, closed_to_arrival: false, closed_to_departure: false, stop_sell: false };
  const sent = { at: '2026-10-16T12:00:00.000Z', f: ['min_stay_arrival', 'max_stay', 'closed_to_arrival', 'closed_to_departure'] };
  const state = new Map([['A|2026-11-01', old], ['A|2026-11-02', v]]);
  const computed = [{ ...row('A', '2026-11-01', v), sent }, { ...row('A', '2026-11-02', v), sent }];
  // never sent after the person's change: every field they set, also the unchanged min stay and CTD
  const before = new Map([['A|2026-11-01', '2026-10-16T09:00:00.000Z'], ['A|2026-11-02', '2026-10-16T09:00:00.000Z']]);
  assert.deepEqual(diffValues(computed, state, { sentAt: before }), [
    row('A', '2026-11-01', { min_stay_arrival: 1, max_stay: 4, closed_to_arrival: true, closed_to_departure: false }),
    row('A', '2026-11-02', { min_stay_arrival: 1, max_stay: 4, closed_to_arrival: true, closed_to_departure: false })
  ]);
  // Channex accepted them after the change: back to only what differs
  const after = new Map([['A|2026-11-01', '2026-10-16T12:00:05.000Z'], ['A|2026-11-02', '2026-10-16T12:00:05.000Z']]);
  assert.deepEqual(diffValues(computed, state, { sentAt: after }), [row('A', '2026-11-01', { max_stay: 4, closed_to_arrival: true })]);
});

test('diffValues: field by field against what Channex has; unknown dates go whole; full sends all', () => {
  const state = new Map([
    ['A|2026-11-22', { rate: '100.00', min_stay_arrival: 1, stop_sell: false }],
    ['A|2026-11-23', { rate: '100.00', min_stay_arrival: 1, stop_sell: false }]
  ]);
  const computed = [
    row('A', '2026-11-22', { rate: '333.00', min_stay_arrival: 1, stop_sell: false }),
    row('A', '2026-11-23', { rate: '100.00', min_stay_arrival: 1, stop_sell: false }),
    row('A', '2026-11-24', { rate: '100.00', min_stay_arrival: 1, stop_sell: false })
  ];
  assert.deepEqual(diffValues(computed, state), [
    row('A', '2026-11-22', { rate: '333.00' }),
    row('A', '2026-11-24', { rate: '100.00', min_stay_arrival: 1, stop_sell: false })
  ]);
  assert.equal(diffValues(computed, state, { full: true }).length, 3);
  assert.deepEqual(diffValues(computed, state, { whole: true })[0], row('A', '2026-11-22', { rate: '333.00', min_stay_arrival: 1, stop_sell: false }));
  assert.deepEqual(diffValues([row('X', '2026-11-01', { availability: 2 })], new Map([['X|2026-11-01', { availability: 2 }]])), []);
});

test('backoffMs: 60 s x 2^n, capped at 16 minutes', () => {
  assert.equal(backoffMs(0), 60000);
  assert.equal(backoffMs(1), 120000);
  assert.equal(backoffMs(2), 240000);
  assert.equal(backoffMs(3), 480000);
  assert.equal(backoffMs(4), 960000);
  assert.equal(backoffMs(5), BACKOFF_MAX_MS);
  assert.equal(backoffMs(50), 16 * 60000);
  assert.equal(backoffMs(-3), 60000);
  assert.equal(backoffMs('x'), 60000);
});

test('restrictionValue: day values win, the plan fills the rest, archived means stop sell', () => {
  const plan = { id: 'RP', defaultRate: 100, minStay: 2 };
  assert.deepEqual(restrictionValue(plan, undefined), { rate: '100.00', min_stay_arrival: 2, max_stay: 0, closed_to_arrival: false, closed_to_departure: false, stop_sell: false });
  assert.deepEqual(restrictionValue(plan, { rate: '456.23', minStay: 5, maxStay: 4, cta: true, ctd: 'true', stopSell: 1, src: 'manual' }),
    { rate: '456.23', min_stay_arrival: 5, max_stay: 4, closed_to_arrival: true, closed_to_departure: true, stop_sell: true });
  assert.equal(restrictionValue(plan, {}, { retired: true }).stop_sell, true);
  // no rate anywhere: the field is left out rather than sent as 0
  assert.equal('rate' in restrictionValue({ id: 'X' }, { minStay: 3 }), false);
  // nonsense is ignored defensively
  assert.deepEqual(restrictionValue({ defaultRate: 'abc', minStay: -1 }, { minStay: 0, maxStay: -2 }), { min_stay_arrival: 1, max_stay: 0, closed_to_arrival: false, closed_to_departure: false, stop_sell: false });
});

test('planRate: derived plans follow their parent (pct or amount) when not materialised', () => {
  const plans = new Map([['P', { id: 'P', defaultRate: 100 }], ['C', { id: 'C', defaultRate: 1, follows: { planId: 'P', type: 'pct', value: 20 } }], ['D', { id: 'D', follows: { planId: 'P', type: 'amount', value: -15.5 } }]]);
  const day = { P: { rate: 200 } };
  const ctx = { plans, dayOf: (id) => day[id] };
  assert.equal(planRate(plans.get('C'), undefined, ctx), 240);
  assert.equal(planRate(plans.get('D'), undefined, ctx), 184.5);
  assert.equal(planRate(plans.get('C'), { rate: 99 }, ctx), 99); // materialised day wins
});

test('toItems: one date -> date, a run -> date_from/date_to, unmapped targets dropped', () => {
  const runs = [{ target_id: 'UT-T', date_from: '2026-11-21', date_to: '2026-11-21', value: { availability: 7 } }, { target_id: 'UT-D', date_from: '2026-11-17', date_to: '2026-11-24', value: { availability: 4 } }, { target_id: 'UT-X', date_from: '2026-11-01', date_to: '2026-11-01', value: { availability: 1 } }];
  const ids = new Map([['UT-T', 'rt-twin'], ['UT-D', 'rt-double']]);
  assert.deepEqual(toItems('availability', 'p1', runs, ids), [
    { property_id: 'p1', room_type_id: 'rt-twin', date: '2026-11-21', availability: 7 },
    { property_id: 'p1', room_type_id: 'rt-double', date_from: '2026-11-17', date_to: '2026-11-24', availability: 4 }
  ]);
  assert.deepEqual(toItems('restrictions', 'p1', [{ target_id: 'RP', date_from: '2026-11-22', date_to: '2026-11-22', value: { rate: '333.00' } }], new Map([['RP', 'rp1']])),
    [{ property_id: 'p1', rate_plan_id: 'rp1', date: '2026-11-22', rate: '333.00' }]);
});

test('markDates: overlapping marks are unioned and clipped to the 500-day window', () => {
  const m = markDates([{ target_id: 'A', date_from: '2026-10-10', date_to: '2026-10-17' }, { target_id: 'A', date_from: '2026-10-16', date_to: '2026-10-18' }, { target_id: 'B', date_from: '2028-01-01', date_to: '2028-02-01' }], '2026-10-15', '2028-01-02');
  assert.deepEqual([...m.get('A')].sort(), ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  assert.deepEqual([...m.get('B')].sort(), ['2028-01-01', '2028-01-02']);
});

test('stableKey ignores key order and undefined', () => {
  assert.equal(stableKey({ b: 1, a: [1, { y: 2, x: 1 }], c: undefined }), stableKey({ a: [1, { x: 1, y: 2 }], b: 1 }));
});

test('setup bodies follow the mapping table (plan section 5)', () => {
  const b = { id: 'BD-1', name: 'Test Property - Orbique', address: '1 Jalan Test', city: 'Kuala Lumpur', state: 'WP', zip: '50450', country: 'my', currency: 'usd', propertyType: 'nonsense' };
  const p = propertyBody(b, { email: 'ops@example.test' });
  assert.equal(p.title, 'Test Property - Orbique');
  assert.equal(p.currency, 'USD');
  assert.equal(p.country, 'MY');
  assert.equal(p.zip_code, '50450');
  assert.equal(p.timezone, 'Asia/Kuala_Lumpur');
  assert.equal(p.property_type, 'apartment');
  assert.equal(p.email, 'ops@example.test');
  assert.equal('phone' in p, false);
  assert.deepEqual(p.settings, { min_stay_type: 'arrival', allow_availability_autoupdate_on_confirmation: true, allow_availability_autoupdate_on_modification: false, allow_availability_autoupdate_on_cancellation: false, state_length: 500 });
  assert.deepEqual(PROPERTY_SETTINGS, p.settings);

  assert.equal(occupancy({ maxGuests: 2 }), 2);
  assert.equal(occupancy({ beds: 3 }), 6);
  assert.equal(occupancy({}), 2);
  assert.equal(occupancy({ maxGuests: 40 }), 18);
  const rt = roomTypeBody({ id: 'UT-T', name: 'Twin Room', maxGuests: 2, description: 'Two beds' }, 8, 'p1');
  assert.deepEqual(rt, { property_id: 'p1', title: 'Twin Room', count_of_rooms: 8, occ_adults: 2, occ_children: 0, occ_infants: 0, room_kind: 'room', meta: { orbique_type_id: 'UT-T' }, content: { description: 'Two beds' } });
  assert.equal(roomTypeBody({ id: 'x', name: 'Empty' }, 0, 'p1').count_of_rooms, 1);
  const rp = ratePlanBody({ id: 'RP-1', name: 'Bed & Breakfast', meal: 'breakfast', defaultRate: 120, minStay: 1 }, { propertyId: 'p1', roomTypeId: 'rt1', occAdults: 2, currency: 'USD' });
  assert.deepEqual(rp, { title: 'Bed & Breakfast', property_id: 'p1', room_type_id: 'rt1', sell_mode: 'per_room', rate_mode: 'manual', currency: 'USD', meal_type: 'breakfast', options: [{ occupancy: 2, is_primary: true, rate: '120.00' }], meta: { orbique_plan_id: 'RP-1' }, min_stay_arrival: 1 });
  assert.equal(groupTitle({ id: 'abcdef12-3456-7890-abcd-ef1234567890', name: 'Acme Stays' }), 'Acme Stays · abcdef12');
});

test('buildingProblems: untagged units, empty types, missing plans and address', () => {
  const b = { id: 'BD', name: 'B', address: 'A', city: 'C', email: 'b@example.test', phone: '+60 3-1234 5678' };
  const types = [{ id: 'T1', buildingId: 'BD', name: 'Twin' }, { id: 'T2', buildingId: 'BD', name: 'Double' }];
  const units = [{ id: 'u1', buildingId: 'BD', unitTypeId: 'T1' }, { id: 'u2', buildingId: 'BD', unitNo: '9-9' }, { id: 'u3', buildingId: 'BD', unitTypeId: 'T2', archived: true }];
  const plans = [{ id: 'P1', unitTypeId: 'T1', name: 'BAR' }];
  const p = buildingProblems(b, types, units, plans);
  assert.ok(p.some((x) => /unit type for every unit.*9-9/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /"Double" has no units/.test(x)));
  assert.ok(p.some((x) => /"Double" needs a rate plan/.test(x)));
  assert.deepEqual(buildingProblems(b, types.slice(0, 1), units.slice(0, 1), plans), []);
  assert.ok(buildingProblems({ id: 'BD', name: 'B' }, types.slice(0, 1), units.slice(0, 1), plans).some((x) => /address/.test(x)));
  assert.deepEqual(buildingProblems(null, [], [], []), ['That building was not found.']);
});

test('buildingProblems: Channex needs an email and a phone before channels connect (building, else Brand)', () => {
  const types = [{ id: 'T1', buildingId: 'BD', name: 'Twin' }];
  const units = [{ id: 'u1', buildingId: 'BD', unitTypeId: 'T1' }];
  const plans = [{ id: 'P1', unitTypeId: 'T1', name: 'BAR' }];
  const b = { id: 'BD', name: 'B', address: 'A', city: 'C' };
  const p = buildingProblems(b, types, units, plans);
  assert.ok(p.some((x) => /^Add an email address for the building/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /^Add a phone number for the building/.test(x)), p.join('\n'));
  assert.deepEqual(buildingProblems(b, types, units, plans, { email: 'brand@example.test', phone: '+60 3-1234 5678' }), [], 'the Brand details count');
  assert.deepEqual(buildingProblems(Object.assign({}, b, { email: 'b@example.test', phone: '0312345678' }), types, units, plans, {}), []);
  const bad = buildingProblems(Object.assign({}, b, { email: 'nope', phone: 'call me' }), types, units, plans);
  assert.ok(bad.some((x) => /Check the building email address \(nope\)/.test(x)) && bad.some((x) => /Check the building phone number/.test(x)), bad.join('\n'));
});

test('propertyType: only values Channex accepts; ours map to the nearest; default apartment', () => {
  assert.equal(propertyType('hotel'), 'hotel');
  assert.equal(propertyType('aparthotel'), 'apart_hotel');
  assert.equal(propertyType('serviced_apartment'), 'apart_hotel');
  assert.equal(propertyType('Serviced apartment'), 'apart_hotel');
  assert.equal(propertyType('bed_and_breakfast'), 'guest_house');
  assert.equal(propertyType('boutique_hotel'), 'hotel');
  assert.equal(propertyType(''), 'apartment');
  assert.equal(propertyType('castle'), 'apartment');
  for (const k of ['aparthotel', 'serviced_apartment', 'bed_and_breakfast', 'boutique_hotel', 'x', undefined]) assert.ok(PROPERTY_TYPES.includes(propertyType(k)), k);
  assert.equal(PROPERTY_TYPES.length, 22);
  assert.equal(propertyBody({ name: 'X', propertyType: 'aparthotel' }).property_type, 'apart_hotel');
});

test('rejectedItems: a warning echoes the item it refused; only those dates are left out of the state', () => {
  const ids = new Map([['rp-tb', 'TB'], ['rp-db', 'DB']]);
  const items = [
    { property_id: 'p', rate_plan_id: 'rp-tb', date: '2026-11-21', rate: '333.00' },
    { property_id: 'p', rate_plan_id: 'rp-db', date_from: '2026-11-10', date_to: '2026-11-12', rate: '0.00' }
  ];
  // the documented shape: the item's fields (null when not sent) and a warning map
  const warns = [{ property_id: 'p', rate_plan_id: 'rp-db', date: null, date_from: '2026-11-10', date_to: '2026-11-12', rate: '0.00', stop_sell: null, warning: { rate: ['must be greater than 0'] } }];
  const r = rejectedItems(warns, items, ids);
  assert.equal(r.unmatched, 0);
  assert.deepEqual(r.rejected, [{ target_id: 'DB', date_from: '2026-11-10', date_to: '2026-11-12', why: 'rate must be greater than 0' }]);
  assert.deepEqual([...r.keys].sort(), ['DB|2026-11-10', 'DB|2026-11-11', 'DB|2026-11-12']);
  // one date inside a ranged item
  const one = rejectedItems([{ rate_plan_id: 'rp-db', date: '2026-11-11', warning: { min_stay_arrival: 'bad' } }], items, ids);
  assert.deepEqual([...one.keys], ['DB|2026-11-11']);
  // availability items
  const av = rejectedItems([{ room_type_id: 'rt', date: '2026-11-21', availability: -1, warning: { availability: ['must be greater than or equal to 0'] } }], [{ room_type_id: 'rt', date: '2026-11-21', availability: -1 }], new Map([['rt', 'UT-T']]));
  assert.deepEqual([...av.keys], ['UT-T|2026-11-21']);
  // a warning we cannot match: nothing of the call may be taken as accepted
  assert.equal(rejectedItems([{ warning: { values: ['invalid'] } }], items, ids).unmatched, 1);
  assert.equal(rejectedItems([{ rate_plan_id: 'rp-zz', date: '2026-11-21' }], items, ids).unmatched, 1);
  assert.equal(rejectedItems([], items, ids).rejected.length, 0);
  assert.equal(datesText('2026-11-21', '2026-11-21'), '21 Nov 2026');
  assert.equal(datesText('2026-11-01', '2026-11-10'), '1 Nov 2026 to 10 Nov 2026');
});

test('changed fields only: certification tests 4 and 7 come out as one item per row of the sheet', () => {
  const day = (rate, extra) => Object.assign({ rate, min_stay_arrival: 1, max_stay: 0, closed_to_arrival: false, closed_to_departure: false, stop_sell: false }, extra);
  const state = new Map();
  const rows = [];
  // Double B&B 1-20 Nov: rates vary by day, 15 Nov has min stay 5 and 20 Nov stop sell (tests 5 and 6)
  for (let d = '2026-11-01'; d <= '2026-11-20'; d = addDays(d, 1)) {
    const n = Number(d.slice(8));
    const old = day((100 + n).toFixed(2), d === '2026-11-15' ? { min_stay_arrival: 5 } : d === '2026-11-20' ? { stop_sell: true } : {});
    state.set('DBB|' + d, old);
    rows.push(row('DBB', d, Object.assign({}, old, { min_stay_arrival: 10 })));
  }
  const runs = compressValues(diffValues(rows, state));
  assert.deepEqual(runs, [{ target_id: 'DBB', date_from: '2026-11-01', date_to: '2026-11-20', value: { min_stay_arrival: 10 } }]);
  // whole values would have split it per night
  assert.equal(compressValues(diffValues(rows, state, { whole: true })).length, 20);
});

test('allowlist: listed orgs only; empty list allows none in staging and all in production; no key, nobody', () => {
  const base = { key: 'k', env: 'staging', orgAllowlist: ['aaaaaaaa-0000-0000-0000-000000000001'] };
  assert.equal(allowedOrg(base, 'AAAAAAAA-0000-0000-0000-000000000001'), true);
  assert.equal(allowedOrg(base, 'bbbbbbbb-0000-0000-0000-000000000002'), false);
  assert.equal(allowedOrg(Object.assign({}, base, { orgAllowlist: [] }), 'x'), false);
  assert.equal(allowedOrg(Object.assign({}, base, { orgAllowlist: [], env: 'production' }), 'x'), true);
  assert.equal(allowedOrg(Object.assign({}, base, { key: '' }), 'aaaaaaaa-0000-0000-0000-000000000001'), false);
});

test('webhook body per plan: global, active, data, token header, signing key when set', () => {
  const w = webhookBody({ webhookToken: 'tok' }, 'https://orbique.example', { CHANNEX_SIGNING_KEY_ID: 'sk-1' });
  assert.equal(w.callback_url, 'https://orbique.example/api/channex-webhook');
  assert.equal(w.event_mask, 'booking;booking_unmapped_room;booking_unmapped_rate;non_acked_booking;sync_error;new_channel;updated_channel;disconnect_channel;disconnect_listing;message;inquiry;reservation_request;message_thread_booking_assigned');
  assert.equal(w.is_global, true); assert.equal(w.is_active, true); assert.equal(w.send_data, true); assert.equal(w.property_id, null);
  assert.deepEqual(w.headers, { 'X-Orbique-Webhook-Token': 'tok' });
  assert.equal(w.is_signed, true); assert.equal(w.signing_key_id, 'sk-1');
  assert.equal('is_signed' in webhookBody({ webhookToken: '' }, 'https://x', {}), false);
  assert.equal(appUrl({ APP_URL: 'https://a.example/' }), 'https://a.example');
  assert.equal(appUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'orbique.vercel.app' }), 'https://orbique.vercel.app');
  assert.equal(IFRAME_CHANNELS, 'BDC,AGO,ABB,EXP,CTP');
});

test('todayMY: Malaysia date; CHANNEX_TODAY is honoured only against a local mock', () => {
  const saved = { t: process.env.CHANNEX_TODAY, b: process.env.CHANNEX_BASE_URL };
  try {
    process.env.CHANNEX_TODAY = '2026-10-15';
    process.env.CHANNEX_BASE_URL = 'https://staging.channex.io/api/v1';
    assert.equal(todayMY(Date.parse('2026-12-31T16:30:00Z')), '2027-01-01');
    process.env.CHANNEX_BASE_URL = 'http://127.0.0.1:8899/api/v1';
    assert.equal(todayMY(Date.parse('2026-12-31T16:30:00Z')), '2026-10-15');
  } finally {
    for (const [k, v] of [['CHANNEX_TODAY', saved.t], ['CHANNEX_BASE_URL', saved.b]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
