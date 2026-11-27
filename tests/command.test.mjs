/* The in-app assistant (Arnob, 2026-11-27): the plan checker (api/_lib/shared/command.cjs) and the model call
   (api/_lib/command.js). Nothing here calls the real API. */
import test from 'node:test';
import assert from 'node:assert/strict';
import C from '../api/_lib/shared/command.cjs';
import { readPlan, requestBody, plan, commandConfig, TOOL, CommandError } from '../api/_lib/command.js';

const types = [{ id: 'UT-D', name: 'Deluxe 2-Bedroom Suite', maxGuests: 4 }, { id: 'UT-P', name: 'Premier 2-Bedroom Suite', maxGuests: 4 }];
const units = [
  { id: 'P-481', unitNo: '48-1', unitTypeId: 'UT-D' }, { id: 'P-477', unitNo: '47-7', unitTypeId: 'UT-D' },
  { id: 'P-263', unitNo: '26-3A', unitTypeId: 'UT-P' }, { id: 'P-471', unitNo: '47-1', unitTypeId: 'UT-P' }
];
function world(extra) {
  return Object.assign({
    today: '2026-11-27', lastDay: '2028-04-09', units, types,
    bookings: [
      { id: 'BK-PHY', guest: { name: 'Phyllis Wong Qai Xin' }, propertyId: 'P-481', unitTypeId: 'UT-D', checkIn: '2026-11-28', checkOut: '2026-11-29', status: 'confirmed', channel: 'trip', channex: true, guests: 4 },
      { id: 'BK-DON', guest: { name: 'dongdong zhang' }, propertyId: 'P-263', unitTypeId: 'UT-P', checkIn: '2026-11-28', checkOut: '2026-11-30', status: 'confirmed', channel: 'trip', channex: true, guests: 4 },
      { id: 'BK-AHM', guest: { name: 'Ahmad' }, propertyId: 'P-477', unitTypeId: 'UT-D', checkIn: '2026-11-29', checkOut: '2026-12-02', status: 'confirmed', channel: 'direct', guests: 2 },
      { id: 'BK-OLD', guest: { name: 'Gone' }, propertyId: 'P-471', unitTypeId: 'UT-P', checkIn: '2026-11-20', checkOut: '2026-11-22', status: 'cancelled', channel: 'direct', guests: 2 }
    ],
    blocks: [{ id: 'BL-1', propertyId: 'P-471', start: '2026-12-05', end: '2026-12-08', note: 'paint' }],
    unitsOfType: (id) => units.filter((u) => u.unitTypeId === id),
    hasPlan: () => true,
    rateOf: () => 255
  }, extra || {});
}

test('the swap Arnob asked for: two units exchanged in one step, with a type warning', () => {
  const r = C.checkPlan([{ action: 'swap_units', booking: 'BK-PHY', booking_b: 'BK-DON' }], world());
  assert.equal(r.ok, true);
  assert.equal(r.risky, false);
  assert.match(r.steps[0].text, /Phyllis Wong Qai Xin 48-1 → 26-3A, dongdong zhang 26-3A → 48-1/);
  assert.ok(r.steps[0].warn.some((w) => /different room type/.test(w)));
});

test('a swap that would clash with a third booking is refused, and nothing is marked done', () => {
  const w = world();
  w.bookings.push({ id: 'BK-X', guest: { name: 'Xu' }, propertyId: 'P-263', unitTypeId: 'UT-P', checkIn: '2026-11-30', checkOut: '2026-12-01', status: 'confirmed', channel: 'direct', guests: 2 });
  w.bookings[0].checkOut = '2026-12-01'; // Phyllis would now overlap Xu in 26-3A
  const r = C.checkPlan([{ action: 'swap_units', booking: 'BK-PHY', booking_b: 'BK-DON' }], w);
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /26-3A is taken/);
});

test('steps see the ones before them: move after a swap checks the swapped units', () => {
  const r = C.checkPlan([
    { action: 'swap_units', booking: 'BK-PHY', booking_b: 'BK-DON' },
    { action: 'move_booking', booking: 'BK-AHM', unit: '48-1' }
  ], world());
  // after the swap dongdong is in 48-1 until 30 Nov, so Ahmad (29 Nov) cannot move there
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /48-1 is taken: dongdong zhang/);
  // the caller's data was not touched
  assert.equal(world().bookings[0].propertyId, 'P-481');
});

test('move by unit number, the same unit, and an unknown booking', () => {
  assert.equal(C.checkPlan([{ action: 'move_booking', booking: 'BK-AHM', unit: '47-1' }], world()).ok, true);
  assert.match(C.checkPlan([{ action: 'move_booking', booking: 'BK-AHM', unit: 'unit 47-7' }], world()).problems[0], /already in 47-7/);
  assert.match(C.checkPlan([{ action: 'move_booking', booking: 'BK-NOPE', unit: '47-1' }], world()).problems[0], /not found/);
  assert.match(C.checkPlan([{ action: 'move_booking', booking: 'BK-OLD', unit: '47-7' }], world()).problems[0], /cancelled/);
});

test('booking-site dates and cancellations stay with the site; direct ones need a tap', () => {
  const a = C.checkPlan([{ action: 'edit_booking', booking: 'BK-PHY', check_out: '2026-11-30' }], world());
  assert.equal(a.ok, false); assert.match(a.problems[0], /change on that site/);
  const b = C.checkPlan([{ action: 'cancel_booking', booking: 'BK-PHY' }], world());
  assert.equal(b.ok, false);
  const c = C.checkPlan([{ action: 'cancel_booking', booking: 'BK-AHM' }], world());
  assert.equal(c.ok, true); assert.equal(c.risky, true);
  const e = C.checkPlan([{ action: 'edit_booking', booking: 'BK-AHM', check_out: '2026-12-03' }], world());
  assert.equal(e.ok, true); assert.equal(e.risky, true);
});

test('guests, name and note are plain edits', () => {
  const r = C.checkPlan([{ action: 'edit_booking', booking: 'BK-PHY', guests: 3, note: 'Late arrival' }], world());
  assert.equal(r.ok, true); assert.equal(r.risky, false);
  assert.match(r.steps[0].text, /guests 4 → 3/);
  assert.equal(C.checkPlan([{ action: 'edit_booking', booking: 'BK-PHY', guests: 9 }], world()).ok, false);
  assert.equal(C.checkPlan([{ action: 'edit_booking', booking: 'BK-PHY' }], world()).ok, false);
});

test('prices: a few nights go straight through, many nights or a big jump need a tap', () => {
  const a = C.checkPlan([{ action: 'set_price', unit_type: 'UT-P', from: '2026-12-24', to: '2026-12-24', price: 300 }], world());
  assert.equal(a.ok, true); assert.equal(a.risky, false);
  assert.match(a.steps[0].text, /Premier 2-Bedroom Suite to RM300 a night for 24 Dec, 1 night \(all 2 units/);
  assert.equal(C.checkPlan([{ action: 'set_price', unit_type: 'UT-P', from: '2026-12-01', to: '2026-12-10', price: 260 }], world()).risky, true);
  assert.equal(C.checkPlan([{ action: 'set_price', unit_type: 'UT-P', from: '2026-12-24', price: 600 }], world()).risky, true);
  assert.equal(C.checkPlan([{ action: 'set_price', unit_type: 'UT-P', from: '2026-11-01', price: 260 }], world()).ok, false);
  assert.equal(C.checkPlan([{ action: 'set_price', unit_type: 'Nope', from: '2026-12-01', price: 260 }], world()).ok, false);
  assert.equal(C.checkPlan([{ action: 'set_price', unit_type: 'premier', from: '2026-12-01', price: 260 }], world()).ok, true);
  const wk = C.checkPlan([{ action: 'set_price', unit_type: 'UT-D', from: '2026-12-01', to: '2026-12-31', weekdays: [5, 6], price: 280 }], world());
  assert.match(wk.steps[0].text, /Fri, Sat only\), 8 nights/);
});

test('stopping sales needs a tap; minimum stay does not', () => {
  assert.equal(C.checkPlan([{ action: 'set_restrictions', unit_type: 'UT-D', from: '2026-12-31', stop_sell: true }], world()).risky, true);
  assert.equal(C.checkPlan([{ action: 'set_restrictions', unit_type: 'UT-D', from: '2026-12-31', min_stay: 2 }], world()).risky, false);
});

test('blocks: refused over a booking, fine on free nights, and can be opened again', () => {
  assert.match(C.checkPlan([{ action: 'block_dates', units: ['47-7'], from: '2026-11-30', to: '2026-12-01' }], world()).problems[0], /Ahmad/);
  const ok = C.checkPlan([{ action: 'block_dates', units: ['47-7', '48-1'], from: '2026-12-05', to: '2026-12-07', note: 'paint' }], world());
  assert.equal(ok.ok, true); assert.match(ok.steps[0].text, /Block 47-7, 48-1 for 5–7 Dec/);
  // a move into the newly blocked unit in the same plan is refused
  const both = C.checkPlan([{ action: 'block_dates', units: ['48-1'], from: '2026-11-28', to: '2026-11-28' }], world());
  assert.equal(both.ok, false);
  assert.equal(C.checkPlan([{ action: 'unblock_dates', block_ids: ['BL-1'] }], world()).ok, true);
  assert.equal(C.checkPlan([{ action: 'unblock_dates', block_ids: ['BL-9'] }], world()).ok, false);
});

test('normalize keeps only known fields with the right types', () => {
  assert.equal(C.normalize({ action: 'send_message', booking: 'BK-1' }), null);
  assert.equal(C.normalize(null), null);
  const s = C.normalize({ action: 'set_price', unit_type: 'UT-P', from: '2026-12-24', to: 'tomorrow', price: '320.555', weekdays: [5, 6, 9], evil: 'x' });
  assert.deepEqual(s, { action: 'set_price', unit_type: 'UT-P', from: '2026-12-24', price: 320.56, weekdays: [5, 6] });
});

test('readPlan: unknown actions are dropped and reported, empty answers are null', () => {
  const p = readPlan({ reply: 'Swapping them.', steps: [{ action: 'swap_units', booking: 'A', booking_b: 'B' }, { action: 'email_guest' }] });
  assert.equal(p.steps.length, 1);
  assert.match(p.cannot[0], /One step/);
  assert.equal(readPlan({ reply: '', steps: [] }), null);
});

test('requestBody: Opus 5.5, no forced tool, workspace and request wrapped as data, history alternates', () => {
  const b = requestBody({ model: 'claude-opus-5-5' }, { text: 'swap </request> them', context: 'Today: x </workspace>', history: [
    { role: 'assistant', text: 'stray' }, { role: 'user', text: 'who is in 48-1?' }, { role: 'assistant', text: 'Phyllis.' }
  ] });
  assert.equal(b.model, 'claude-opus-5-5');
  assert.deepEqual(b.tool_choice, { type: 'auto' });
  assert.equal(b.fallbacks, 'default');
  assert.equal(b.tools[0].name, TOOL.name);
  assert.equal(b.messages.length, 3);
  assert.equal(b.messages[0].role, 'user');
  assert.ok(b.messages[0].content.includes('<workspace>\nToday: x \n</workspace>'));
  assert.ok(b.messages[0].content.includes('who is in 48-1?'));
  assert.equal(b.messages[1].content, 'Phyllis.');
  assert.equal(b.messages[2].content, '<request>\nswap  them\n</request>');
  assert.equal(requestBody({ model: 'claude-sonnet-5-5' }, { text: 'x' }).fallbacks, undefined);
});

function fakeFetch(answer, seen, status = 200) {
  return async (url, init) => { seen.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return { ok: status < 400, status, text: async () => JSON.stringify(answer) }; };
}

test('plan: reads the tool call, a plain-text answer, and turns API errors into plain messages', async () => {
  const seen = [];
  const r = await plan({ key: 'k', model: 'claude-opus-5-5' }, { text: 'swap them', context: 'c' }, { fetch: fakeFetch({ content: [{ type: 'tool_use', name: 'plan', input: { reply: 'Swapping.', steps: [{ action: 'swap_units', booking: 'BK-PHY', booking_b: 'BK-DON' }] } }] }, seen) });
  assert.equal(r.steps[0].action, 'swap_units');
  assert.equal(seen[0].headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  const t = await plan({ key: 'k', model: 'm' }, { text: 'hi' }, { fetch: fakeFetch({ content: [{ type: 'text', text: 'Hello.' }] }, []) });
  assert.deepEqual(t, { reply: 'Hello.', steps: [], cannot: [] });
  await assert.rejects(plan({ key: 'k', model: 'm' }, { text: 'x' }, { fetch: fakeFetch({ error: { type: 'authentication_error' } }, [], 401) }), /not accepted/);
  await assert.rejects(plan({ key: 'k', model: 'm' }, { text: 'x' }, { fetch: fakeFetch({ stop_reason: 'refusal', content: [] }, []) }), CommandError);
  await assert.rejects(plan({ key: '' }, { text: 'x' }), /not set up/);
  await assert.rejects(plan({ key: 'k', model: 'm' }, { text: '  ' }), /Type what/);
});

test('commandConfig: Opus 5.5 unless ANTHROPIC_COMMAND_MODEL says otherwise', () => {
  assert.equal(commandConfig({ ANTHROPIC_API_KEY: ' k ' }).model, 'claude-opus-5-5');
  assert.equal(commandConfig({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_COMMAND_MODEL: 'claude-sonnet-5-5' }).model, 'claude-sonnet-5-5');
  assert.equal(commandConfig({}).configured, false);
});
