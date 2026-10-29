/* api/messages.js 'greeting' and 'greeting-preview': who may send the building's greeting, and that the server fills it
 * from the records with its own clock (the door code only from 30 minutes before check-in).
 *
 *   node --test tests/inbox/greeting.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { greetingAction, greetingFor } from '../../api/messages.js';
import { fakeSb, op } from './fake-sb.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const WA = { token: 'test-token-1234567890', appSecret: 'app-secret', verifyToken: 'verify-me', version: 'v23.0', baseUrl: 'https://graph.test', configured: true };
const REC = {
  conversations: { 'C-1': { bookingId: 'B-1', wa: '60123456789', waLastIn: '2026-11-02T05:00:00Z', messages: [] } },
  bookings: { 'B-1': { guest: { name: 'Ana Silva', phone: '+60 12-345 6789' }, propertyId: 'u1', checkIn: '2026-11-02', checkOut: '2026-11-05', doorCode: '4821', idVerified: true, codeStatus: 'scheduled' } },
  properties: { u1: { name: 'Saujana 21-1', unitNo: '21-1', buildingId: 'BD' } },
  buildings: { BD: { name: 'Seri Saujana Residences' } },
  greetings: { GR1: { buildingId: 'BD', name: 'Arrival', text: 'Hi {guest_first}, door {door_code}, lobby {f_lobby}', fields: [{ key: 'lobby', label: 'Lobby code', private: true, values: { u1: '2101' } }] } }
};

function db(role, blobs = {}) {
  const rpcs = [];
  const sb = fakeSb({
    handler: (t, ops) => {
      if (t === 'members') return { data: { org_id: ORG, user_id: 'user-1', staff_id: 's9', role, status: 'active' }, error: null };
      if (t === 'orgs') return { data: { id: ORG, name: 'Test stays', plan: 'pro', status: 'active' }, error: null };
      if (t === 'blobs') { const k = op(ops, 'eq', 'key'); return { data: blobs[k] !== undefined ? { data: { v: blobs[k] } } : null, error: null }; }
      if (t === 'records') { const c = op(ops, 'eq', 'coll'), id = op(ops, 'eq', 'id'); const r = REC[c] && REC[c][id]; return { data: r ? { id, data: r } : null, error: null }; }
      if (t === 'whatsapp_numbers') return { data: { phone_number_id: '1234567', display_phone: '60300000000' }, error: null };
      return { data: null, error: null };
    },
    rpc: (name, args) => { rpcs.push({ name, args }); return { data: { id: 'C-1', messages: [args.p_msg] }, error: null }; }
  });
  return { sb, rpcs };
}
const body = { orgId: ORG, conversationId: 'C-1', greetingId: 'GR1', via: 'whatsapp' };
const me = { id: 'user-1' };
const AFTER = Date.parse('2026-11-02T06:31:00Z'); // 14:31 in Malaysia, check-in 15:00
const BEFORE = Date.parse('2026-11-02T06:29:00Z');

test('greeting: inbox view is enough, without inbox.send (maintenance can open the inbox but not reply)', async () => {
  const { sb, rpcs } = db('maintenance');
  let sent;
  const fetch = async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ messages: [{ id: 'wamid.G' }] })); };
  const r = await greetingAction(sb, body, me, { now: AFTER, fetch, waConfig: WA });
  assert.equal(sent.text.body, 'Hi Ana, door 4821, lobby 2101');
  const add = rpcs.find((x) => x.name === 'inbox_append').args.p_msg;
  assert.equal(add.greeting, 'GR1');
  assert.equal(add.text, 'Hi Ana, door 4821, lobby 2101');
  assert.equal(r.conversation.id, 'C-1');
});

test('greeting: the same with inbox.send switched off for the role', async () => {
  const { sb } = db('frontdesk', { rolePerms: { frontdesk: { sections: { inbox: 'edit' }, actions: { 'inbox.send': false } } } });
  const fetch = async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.H' }] }));
  await greetingAction(sb, body, me, { now: AFTER, fetch, waConfig: WA });
});

test('greeting: no inbox access is refused before anything is sent', async () => {
  for (const [role, blobs] of [['accountant', {}], ['frontdesk', { staffMeta: { s9: { overrides: { 'section:inbox': 'none' } } } }], ['ops', { staffMeta: { s9: { status: 'suspended' } } }]]) {
    const { sb, rpcs } = db(role, blobs);
    let called = false;
    await assert.rejects(greetingAction(sb, body, me, { now: AFTER, fetch: async () => { called = true; }, waConfig: WA }), (e) => e.status === 403, role);
    assert.equal(called, false); assert.equal(rpcs.length, 0);
  }
});

test('greeting: the server clock holds the door code and private fields until 30 minutes before check-in', async () => {
  const { sb } = db('owner');
  let sent;
  const fetch = async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ messages: [{ id: 'wamid.I' }] })); };
  const r = await greetingAction(sb, body, me, { now: BEFORE, fetch, waConfig: WA });
  assert.ok(!/4821|2101/.test(sent.text.body), sent.text.body);
  assert.deepEqual(r.held.sort(), ['door_code', 'f_lobby']);
});

test('greeting: demo workspaces send nothing; a greeting for another building is refused', async () => {
  const { sb } = db('owner', { workspaceMeta: { demo: true } });
  await assert.rejects(greetingAction(sb, body, me, { now: AFTER, waConfig: WA }), /demo workspace/);
  const other = db('owner').sb;
  REC.greetings.GR2 = { buildingId: 'OTHER', name: 'x', text: 'x', fields: [] };
  await assert.rejects(greetingFor(other, ORG, Object.assign({}, body, { greetingId: 'GR2' })), /another building/);
});

test('greeting preview: masked for people without door-code access, real for the send', async () => {
  const masked = await greetingFor(db('maintenance').sb, ORG, body, { now: AFTER, mask: true });
  assert.equal(masked.filled.text, 'Hi Ana, door [door code hidden], lobby [door code hidden]');
  const real = await greetingFor(db('maintenance').sb, ORG, body, { now: AFTER });
  assert.equal(real.filled.text, 'Hi Ana, door 4821, lobby 2101');
});

test('permissions: inbox.greetings and guestapp.doorCodes follow the app defaults', async () => {
  const { canInbox } = await import('../../api/_lib/inbox.js');
  const m = (role) => ({ role, staff_id: 's9', status: 'active' });
  const sb = db('x').sb;
  assert.equal(await canInbox(sb, ORG, m('frontdesk'), 'inbox.greetings'), true);
  assert.equal(await canInbox(sb, ORG, m('housekeeping'), 'inbox.greetings'), false);
  assert.equal(await canInbox(sb, ORG, m('frontdesk'), 'guestapp.doorCodes'), true);
  assert.equal(await canInbox(sb, ORG, m('housekeeping'), 'guestapp.doorCodes'), false);
  assert.equal(await canInbox(sb, ORG, m('maintenance'), 'guestapp.doorCodes'), false);
  assert.equal(await canInbox(sb, ORG, m('owner'), 'guestapp.doorCodes'), true);
});
