/* The Channex mock's own behaviour (tokens, the channel screen, booking revisions, signed webhooks, call log),
 * and rawBody + verifySignature on a webhook as it arrives over HTTP. */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createMock } from '../../scripts/channex-mock.mjs';
import { channexRequest, channexConfig, verifySignature } from '../../api/_lib/channex.js';
import { rawBody } from '../../api/_lib/http.js';

const KEY = 'mock-test-key';
const SECRET = 'whsec_mock_test';
const mock = createMock({ apiKey: KEY, every429: 0, every5xx: 0, latencyMs: 0, rateLimits: false, signingSecret: SECRET, webhookUrl: '' });
let cfg, root;
const call = (method, path, body, opts = {}) => channexRequest(method, path, body, Object.assign({ config: cfg }, opts));
const control = async (what, body, method = 'POST') => (await fetch(root + '/__mock/' + what, method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })).json();

/* A stand-in for api/channex-webhook: reads the raw body and checks the signature. */
const received = [];
const receiver = http.createServer(async (req, res) => {
  const raw = await rawBody(req, 256 * 1024);
  const okSig = verifySignature(SECRET, raw, req.headers['x-hmac-timestamp'], req.headers['x-hmac-signature-256']);
  received.push({ headers: req.headers, raw: raw.toString('utf8'), okSig });
  res.statusCode = okSig ? 200 : 401;
  res.end();
});
let hookUrl;

before(async () => {
  const m = await mock.listen(0);
  root = m.url;
  cfg = Object.assign({}, channexConfig(), { key: KEY, baseUrl: m.apiUrl });
  await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
  hookUrl = `http://127.0.0.1:${receiver.address().port}/api/channex-webhook`;
});
after(async () => { await mock.close(); receiver.closeAllConnections(); await new Promise((r) => receiver.close(r)); });
beforeEach(async () => { received.length = 0; await control('reset'); await control('config', { signingSecret: SECRET, webhookUrl: hookUrl }); });

async function property() {
  const p = await call('POST', '/properties', { property: { title: 'Test Property', currency: 'USD' } });
  const rt = await call('POST', '/room_types', { room_type: { property_id: p.data.id, title: 'Double Room', count_of_rooms: 4, occ_adults: 2, occ_children: 0, occ_infants: 0 } });
  return { property: p.data.id, roomType: rt.data.id };
}

test('one-time token opens the channel screen once', async () => {
  const { property: pid } = await property();
  const t = await call('POST', '/auth/one_time_token', { one_time_token: { property_id: pid, username: 'Aisha' } });
  const token = t.data.token;
  assert.match(token, /^[0-9a-f-]{36}$/);
  const url = `${root}/auth/exchange?oauth_session_key=${token}&app_mode=headless&redirect_to=/channels&property_id=${pid}&channels=BDC,AGO,ABB,EXP,CTP&lng=en`;
  const first = await fetch(url);
  assert.equal(first.status, 200);
  const html = await first.text();
  assert.match(html, /Test Property/);
  assert.match(html, /Aisha/);
  assert.equal((await fetch(url)).status, 401, 'single use');
});

test('channels list per property', async () => {
  const { property: pid } = await property();
  await control('channel', { property_id: pid, channel: 'BDC' });
  await control('channel', { property_id: pid, channel: 'ABB' });
  const res = await call('GET', '/channels', null, { query: { 'filter[property_id]': pid } });
  assert.deepEqual(res.data.map((c) => c.attributes.title).sort(), ['Airbnb', 'Booking.com']);
});

test('a mock booking sends a signed webhook, then feed, get and ack work', async () => {
  const { property: pid, roomType } = await property();
  const made = await control('booking', { property_id: pid, room_type_id: roomType, checkin_date: '2026-11-21', checkout_date: '2026-11-23', amount: 300 });
  assert.equal(made.deliveries.length, 1);
  assert.equal(made.deliveries[0].status, 200, 'the receiver accepted the signature');
  assert.equal(received.length, 1);
  const hook = JSON.parse(received[0].raw);
  assert.equal(hook.event, 'booking');
  assert.equal(hook.payload.revision_id, made.revision.id);
  assert.equal(received[0].headers['x-hmac-keys-256'], 'mock-key-1');

  const feed = await call('GET', '/booking_revisions/feed', null, { query: { 'filter[property_id]': pid } });
  assert.equal(feed.data.length, 1);
  const rev = feed.data[0].attributes;
  assert.equal(rev.status, 'new');
  assert.equal(rev.rooms[0].room_type_id, roomType);
  assert.deepEqual(rev.rooms[0].days, { '2026-11-21': '150.00', '2026-11-22': '150.00' });

  const got = await call('GET', `/booking_revisions/${made.revision.id}`);
  assert.equal(got.data.attributes.booking_id, rev.booking_id);
  await call('POST', `/booking_revisions/${made.revision.id}/ack`);
  assert.equal((await call('GET', '/booking_revisions/feed')).data.length, 0, 'acked revisions leave the feed');

  const mod = await control('booking', { property_id: pid, booking_id: rev.booking_id, status: 'modified', checkout_date: '2026-11-24' });
  assert.equal(mod.revision.attributes.booking_id, rev.booking_id);
  assert.equal(mod.revision.attributes.rooms[0].checkin_date, '2026-11-21', 'unchanged fields carry over');
  assert.equal(mod.revision.attributes.departure_date, '2026-11-24');
  assert.equal((await call('GET', '/booking_revisions/feed')).data.length, 1);
});

test('a wrong signing secret is refused by the receiver', async () => {
  const { property: pid, roomType } = await property();
  await control('config', { signingSecret: 'whsec_someone_else' });
  const made = await control('booking', { property_id: pid, room_type_id: roomType, checkin_date: '2026-11-21', checkout_date: '2026-11-22' });
  assert.equal(made.deliveries[0].status, 401);
  assert.equal(received[0].okSig, false);
});

test('registered webhooks get the booking with their own headers', async () => {
  const { property: pid, roomType } = await property();
  await call('POST', '/webhooks', { webhook: { callback_url: hookUrl, event_mask: 'booking;non_acked_booking', property_id: null, is_global: true, is_active: true, send_data: true, headers: { 'X-Orbique-Webhook-Token': 'tok' } } });
  await control('config', { webhookUrl: '' });
  await control('booking', { property_id: pid, room_type_id: roomType, checkin_date: '2026-12-01', checkout_date: '2026-12-02' });
  assert.equal(received.length, 1);
  assert.equal(received[0].headers['x-orbique-webhook-token'], 'tok');
});

test('/__mock/calls records method, path and body', async () => {
  const { property: pid, roomType } = await property();
  await call('POST', '/availability', { values: [{ property_id: pid, room_type_id: roomType, date: '2026-11-25', availability: 0 }] });
  const { calls } = await control('calls?path=/availability', null, 'GET');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].status, 200);
  assert.equal(calls[0].body.values[0].availability, 0);
  await fetch(root + '/__mock/calls', { method: 'DELETE' });
  assert.equal((await control('calls', null, 'GET')).calls.length, 0);
});

test('MOCK_RATE_LIMITS: the 11th availability call in a minute for one property is 429', async () => {
  const { property: pid, roomType } = await property();
  await control('config', { rateLimits: true });
  const kinds = [];
  for (let i = 0; i < 11; i++) {
    const orig = console.error; console.error = () => {};
    try { await call('POST', '/availability', { values: [{ property_id: pid, room_type_id: roomType, date: '2026-11-25', availability: i % 4 }] }); kinds.push('ok'); } catch (e) { kinds.push(e.kind); } finally { console.error = orig; }
  }
  await control('config', { rateLimits: false });
  assert.deepEqual(kinds, Array(10).fill('ok').concat('rate_limited'));
});

test('rawBody: req.rawBody first, then a Buffer or string body; a parsed object is refused', async () => {
  const buf = Buffer.from('{"a":1}');
  assert.equal((await rawBody({ rawBody: buf, body: { a: 1 } })).toString(), '{"a":1}');
  assert.equal((await rawBody({ body: '{"a": 1}' })).toString(), '{"a": 1}');
  assert.equal((await rawBody({ body: buf })).toString(), '{"a":1}');
  assert.equal((await rawBody({})).length, 0);
  await assert.rejects(rawBody({ body: { a: 1 } }), (e) => e.status === 500);
  await assert.rejects(rawBody({ rawBody: Buffer.alloc(20) }, 10), (e) => e.status === 413 && e.code === 'too-large');
});
