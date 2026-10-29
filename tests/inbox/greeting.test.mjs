/* api/messages.js 'greeting' and 'greeting-preview': who may send the building's greeting, and that the server fills it
 * from the records with its own clock (the door code only from 24 hours before check-in).
 *
 *   node --test tests/inbox/greeting.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { greetingAction, greetingFor, greetingPreview } from '../../api/messages.js';
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

/* who last saved each greeting (records.updated_by): 'writer' is an ops member */
const BY = { GR1: 'writer', GR2: 'writer' };
const MEMBERS = { writer: { staff_id: 's1', role: 'ops' }, mender: { staff_id: 's2', role: 'maintenance' } };

function db(role, blobs = {}, rec = REC, convMessages = null) {
  const rpcs = [];
  const sb = fakeSb({
    handler: (t, ops) => {
      if (t === 'members') {
        const u = op(ops, 'eq', 'user_id'), x = MEMBERS[u];
        return { data: x ? { org_id: ORG, user_id: u, staff_id: x.staff_id, role: x.role, status: 'active' } : { org_id: ORG, user_id: 'user-1', staff_id: 's9', role, status: 'active' }, error: null };
      }
      if (t === 'orgs') return { data: { id: ORG, name: 'Test stays', plan: 'pro', status: 'active' }, error: null };
      if (t === 'blobs') { const k = op(ops, 'eq', 'key'); return { data: blobs[k] !== undefined ? { data: { v: blobs[k] } } : null, error: null }; }
      if (t === 'records') {
        const c = op(ops, 'eq', 'coll'), id = op(ops, 'eq', 'id'); let r = rec[c] && rec[c][id];
        if (r && c === 'conversations' && convMessages) r = Object.assign({}, r, { messages: convMessages });
        return { data: r ? { id, data: r, updated_by: c === 'greetings' ? BY[id] || null : null } : null, error: null };
      }
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
const BEFORE = Date.parse('2026-11-01T06:59:00Z'); // 14:59 the day before in Malaysia, one minute before 24 hours

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

test('greeting: the server clock holds the door code and private fields until 24 hours before check-in', async () => {
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
  const rec = Object.assign({}, REC, { greetings: Object.assign({}, REC.greetings, { GR2: { buildingId: 'OTHER', name: 'x', text: 'x', fields: [] } }) });
  await assert.rejects(greetingFor(db('owner', {}, rec).sb, ORG, Object.assign({}, body, { greetingId: 'GR2' })), /another building/);
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

test('greeting preview: the server decides the masking from the caller\'s door-code access', async () => {
  const m = await greetingPreview(db('maintenance').sb, body, me);
  assert.equal(m.masked, true);
  assert.ok(!/4821|2101/.test(m.text), m.text);
  const f = await greetingPreview(db('frontdesk').sb, body, me);
  assert.equal(f.masked, false);
  assert.ok(Array.isArray(f.parts) && f.parts.length > 0);
  assert.ok('why' in f && 'revealAt' in f);
});

test('greeting: refused when it was last saved by someone who cannot write greetings', async () => {
  BY.GR3 = 'mender';
  try {
    const rec = Object.assign({}, REC, { greetings: Object.assign({}, REC.greetings, { GR3: { buildingId: 'BD', name: 'Spam', text: 'Click this link', fields: [] } }) });
    const { sb, rpcs } = db('owner', {}, rec);
    let called = false;
    const b3 = Object.assign({}, body, { greetingId: 'GR3' });
    await assert.rejects(greetingAction(sb, b3, me, { now: AFTER, fetch: async () => { called = true; }, waConfig: WA }), (e) => e.status === 403 && /not saved by someone/.test(e.message));
    assert.equal(called, false); assert.equal(rpcs.length, 0);
    await assert.rejects(greetingPreview(db('owner', {}, rec).sb, b3, me), (e) => e.status === 403);
  } finally { delete BY.GR3; }
});

test('greeting: without inbox.send the same greeting is not sent to a chat twice within 10 minutes', async () => {
  const recent = [{ from: 'staff', type: 'text', text: 'Hi', time: '2026-11-02T14:25', greeting: 'GR1' }];
  const fetch = async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.J' }] }));
  await assert.rejects(greetingAction(db('maintenance', {}, REC, recent).sb, body, me, { now: AFTER, fetch, waConfig: WA }), (e) => e.status === 429);
  await greetingAction(db('frontdesk', {}, REC, recent).sb, body, me, { now: AFTER, fetch, waConfig: WA }); // inbox.send: no limit
  const old = [{ from: 'staff', type: 'text', text: 'Hi', time: '2026-11-02T14:10', greeting: 'GR1' }];
  await greetingAction(db('maintenance', {}, REC, old).sb, body, me, { now: AFTER, fetch, waConfig: WA });
});
