/* Integration: bookings inbound (milestone M6) against the Channex mock and a real Postgres with PostgREST.
 * The mock's POST /__mock/booking makes a revision and sends a signed webhook to api/channex-webhook.js (served here
 * over real HTTP, so the raw body is read from the stream). Then the 0006 triggers mark availability and the worker
 * closes (or reopens) the dates on Channex.
 *
 * Skipped unless a local database is available:
 *   CHANNEX_TEST_PGURL=postgres://postgres@127.0.0.1:54329/postgres POSTGREST_BIN=/path/to/postgrest \
 *     node --test tests/channex/bookings.integration.test.mjs
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createMock, signWebhook } from '../../scripts/channex-mock.mjs';
import { localSupabaseAvailable, startLocalSupabase } from './helpers/local-supabase.mjs';

const ENABLED = localSupabaseAvailable();
const SKIP = ENABLED ? false : 'set CHANNEX_TEST_PGURL and POSTGREST_BIN to run (see the top of this file)';
const TODAY = '2026-10-15';
const ORG = 'aaaaaaaa-0000-4000-8000-0000000000b6';
const WORKER_SECRET = 'test-worker-secret-bookings-0123456789';
const SIGNING = 'test-signing-secret-0123456789';

let webhookServer;
let webhookUrl;
const mock = createMock({ apiKey: 'test-key', every429: 0, every5xx: 0, latencyMs: 0, rateLimits: false, signingSecret: SIGNING, webhookUrl: '' });
let env;
let db;
let mockUrl;
let channexApi;
let workerApi;
let webhookApi;
let owner;
let ids = { rt: {}, rp: {} };
const S = {}; // state carried between tests

const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dates = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };

async function api(handler, token, body) {
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ''; } };
  const req = { method: 'POST', headers: token ? { authorization: 'Bearer ' + token } : {}, body };
  await handler(req, res);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}
const control = async (what, body, method = 'POST') => (await fetch(mockUrl + '/__mock/' + what, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) })).json();
const calls = async () => (await control('calls', null, 'GET')).calls;
const mockState = async () => control('state', null, 'GET');
const q = async (sql, args) => (await db.query(sql, args)).rows;

async function put(coll, id, data) {
  await db.query(`insert into public.records (org_id, coll, id, data) values ($1, $2, $3, $4)
                  on conflict (org_id, coll, id) do update set data = excluded.data, deleted = false`, [ORG, coll, id, data]);
}
const booking = async (id) => (await q(`select data from public.records where org_id = $1 and coll = 'bookings' and id = $2`, [ORG, id]))[0].data;
const recordIdsOf = async (channexBookingId) => (await q('select record_ids from public.channex_bookings where booking_id = $1', [channexBookingId]))[0].record_ids;
const openAlerts = async (kind) => q(`select kind, message, ref from public.channex_alerts where org_id = $1 and kind = $2 and resolved_at is null order by id`, [ORG, kind]);

/** A booking made on a channel: the mock makes the revision and (unless deliver: false) sends the signed webhook. */
async function channelBooking(body) {
  const r = await control('booking', Object.assign({ property_id: ids.property }, body));
  assert.ok(r.revision, JSON.stringify(r));
  if (body.deliver !== false) assert.deepEqual(r.deliveries.map((d) => d.status), [200], JSON.stringify(r.deliveries));
  return r;
}
const T = (extra) => Object.assign({ room_type_id: ids.rt['UT-T'], rate_plan_id: ids.rp['RP-TB'] }, extra);
const Dd = (extra) => Object.assign({ room_type_id: ids.rt['UT-D'], rate_plan_id: ids.rp['RP-DB'] }, extra);

/** One worker tick, with the quiet window and the per-minute call budget already behind us. */
async function tick(task = 'tick') {
  await db.query(`update public.channex_outbox set created_at = created_at - interval '10 seconds'`);
  await db.query(`update public.channex_calls set at = at - interval '2 minutes'`);
  const r = await api(workerApi, WORKER_SECRET, { task });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}
const availabilityItems = async () => (await calls()).filter((c) => c.method === 'POST' && c.path === '/availability').flatMap((c) => c.body.values);
/** Channex's (the mock's) availability for a unit type on each date. */
async function channexAvail(typeId, from, to) { const s = await mockState(); const t = s.availability[ids.rt[typeId]] || {}; return dates(from, to).map((d) => t[d]); }

/** Post a webhook body ourselves (replays, bad signatures). */
async function postWebhook(obj, { secret = SIGNING, raw } = {}) {
  const body = raw || JSON.stringify(obj);
  const ts = String(Math.floor(Date.now() / 1000));
  const r = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hmac-timestamp': ts, 'x-hmac-signature-256': signWebhook(secret, ts, body) }, body });
  return { status: r.status, json: await r.json(), body, ts };
}

/* ---------- lifecycle ---------- */

before(async () => {
  if (!ENABLED) return;
  const m = await mock.listen(0);
  mockUrl = m.url;
  env = await startLocalSupabase({ dbName: 'orbique_channex_bookings_it', today: TODAY });
  db = env.db;
  Object.assign(process.env, {
    SUPABASE_URL: env.url, SUPABASE_SERVICE_ROLE_KEY: env.serviceKey,
    CHANNEX_BASE_URL: m.apiUrl, CHANNEX_API_KEY: 'test-key', CHANNEX_TODAY: TODAY,
    CHANNEX_ORG_ALLOWLIST: ORG, CHANNEX_WORKER_SECRET: WORKER_SECRET, CHANNEX_WEBHOOK_SECRET: SIGNING
  });
  delete process.env.CHANNEX_WEBHOOK_TOKEN;
  delete process.env.CHANNEX_APP_URL;
  channexApi = (await import('../../api/channex.js')).default;
  workerApi = (await import('../../api/channex-worker.js')).default;
  webhookApi = (await import('../../api/channex-webhook.js')).default;
  webhookServer = http.createServer((req, res) => { webhookApi(req, res).catch((e) => { res.statusCode = 599; res.end(String(e)); }); });
  await new Promise((r) => webhookServer.listen(0, '127.0.0.1', r));
  webhookUrl = `http://127.0.0.1:${webhookServer.address().port}/api/channex-webhook`;
  mock.ctl.webhookUrl = webhookUrl;

  // a workspace with one connected building: Twin Room (3 units), Double Room (1 unit)
  await db.query('insert into public.orgs (id, name) values ($1, $2)', [ORG, 'Bookings Test Sdn Bhd']);
  owner = await env.addUser('owner-bk@example.test', { name: 'Olivia Owner' });
  await db.query('insert into public.members (org_id, user_id, staff_id, role) values ($1, $2, $3, $4)', [ORG, owner.id, 's1', 'owner']);
  await put('staff', 's1', { id: 's1', name: 'Olivia Owner', role: 'owner' });
  await db.query(`insert into public.blobs (org_id, key, data) values ($1, 'workspaceMeta', $2)`, [ORG, { v: { demo: false } }]);
  await put('buildings', 'BD-1', { id: 'BD-1', name: 'Seri Test Residences', address: '2 Jalan Ujian', city: 'Kuala Lumpur', state: 'WP Kuala Lumpur', zip: '50450', country: 'MY', currency: 'MYR', propertyType: 'apartment', checkInTime: '15:00', checkOutTime: '11:00' });
  await put('unitTypes', 'UT-T', { id: 'UT-T', buildingId: 'BD-1', name: 'Twin Room', maxGuests: 2, beds: 2, order: 1 });
  await put('unitTypes', 'UT-D', { id: 'UT-D', buildingId: 'BD-1', name: 'Double Room', maxGuests: 2, beds: 1, order: 2 });
  for (let i = 1; i <= 3; i++) await put('properties', `T-0${i}`, { id: `T-0${i}`, name: `Twin ${i}`, buildingId: 'BD-1', unitTypeId: 'UT-T', unitNo: `21-${i}` });
  await put('properties', 'D-01', { id: 'D-01', name: 'Double 1', buildingId: 'BD-1', unitTypeId: 'UT-D', unitNo: '22-1', checkInTime: '16:00' });
  await put('ratePlans', 'RP-TB', { id: 'RP-TB', unitTypeId: 'UT-T', name: 'Best Available Rate', meal: 'room_only', primary: true, defaultRate: 100, minStay: 1 });
  await put('ratePlans', 'RP-DB', { id: 'RP-DB', unitTypeId: 'UT-D', name: 'Best Available Rate', meal: 'room_only', primary: true, defaultRate: 120, minStay: 1 });
  // a direct booking already in Twin 1
  await put('bookings', 'BK-DIRECT', { id: 'BK-DIRECT', unitTypeId: 'UT-T', propertyId: 'T-01', checkIn: '2026-11-08', checkOut: '2026-11-11', status: 'confirmed', channel: 'direct', guest: { name: 'Direct Guest' } });

  const c = await api(channexApi, owner.token, { action: 'connect', orgId: ORG, buildingId: 'BD-1' });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  ids.property = (await q('select channex_property_id from public.channex_properties where org_id = $1', [ORG]))[0].channex_property_id;
  for (const x of await q('select unit_type_id, room_type_id from public.channex_room_types where org_id = $1', [ORG])) ids.rt[x.unit_type_id] = x.room_type_id;
  for (const x of await q('select plan_id, rate_plan_id from public.channex_rate_plans where org_id = $1', [ORG])) ids.rp[x.plan_id] = x.rate_plan_id;
  // the feed is polled every 15 minutes; tests below decide when
  await db.query('update public.channex_meta set last_feed_poll_at = now()');
});

after(async () => {
  if (!ENABLED) return;
  await new Promise((r) => { webhookServer.closeAllConnections && webhookServer.closeAllConnections(); webhookServer.close(() => r()); });
  await mock.close();
  await env.close();
});

beforeEach(async () => {
  if (!ENABLED) return;
  await control('calls', null, 'DELETE');
});

/* ---------- the booking life cycle ---------- */

test('new booking: saved, auto-assigned, acknowledged after saving; the worker then closes the dates on Channex', { skip: SKIP }, async () => {
  assert.deepEqual(await channexAvail('UT-T', '2026-11-10', '2026-11-12'), [2, 3, 3], 'after the full sync');
  const r = await channelBooking(T({ status: 'new', checkin_date: '2026-11-11', checkout_date: '2026-11-14', amount: '360.00', customer: { name: 'Anna', surname: 'Smith', mail: 'anna@example.com', phone: '+447700900123', country: 'GB' } }));
  assert.deepEqual(r.deliveries.map((d) => [d.status, d.signed]), [[200, true]]);
  S.rev1 = r.revision.attributes;
  const [id] = await recordIdsOf(S.rev1.booking_id);
  S.id1 = id;
  const b = await booking(id);
  assert.match(id, /^BK-[0-9A-Z]+$/);
  assert.equal(b.unitTypeId, 'UT-T');
  assert.equal(b.propertyId, 'T-01', 'best fit: Twin 1 is free from the 11th, right after the direct stay');
  assert.equal(b.assignment.how, 'auto'); assert.equal(b.assignment.locked, false);
  assert.equal(b.channel, 'booking'); assert.equal(b.reservationCode, S.rev1.ota_reservation_code);
  assert.equal(b.guest.name, 'Anna Smith'); assert.equal(b.guest.country, 'UK');
  assert.equal(b.total, 360); assert.equal(b.status, 'confirmed');
  assert.match(b.doorCode, /^\d{4}$/); assert.match(b.guestToken, /^g[A-Za-z0-9_-]{22}$/); assert.equal(b.codeStatus, 'held');
  assert.equal(b.checkInTime, '15:00');
  assert.deepEqual(b.channex, { bookingId: S.rev1.booking_id, revisionId: S.rev1.id, uniqueId: S.rev1.unique_id, propertyId: ids.property, room: 0 });
  // save, then ack: the GET came first, then the ack, and the revision row was saved before it was acked
  const seq = (await calls()).filter((c) => c.path.startsWith('/booking_revisions')).map((c) => c.method + ' ' + c.path);
  assert.deepEqual(seq, [`GET /booking_revisions/${S.rev1.id}`, `POST /booking_revisions/${S.rev1.id}/ack`]);
  const rv = (await q('select saved_at, acked_at, raw from public.channex_revisions where revision_id = $1', [S.rev1.id]))[0];
  assert.ok(rv.saved_at && rv.acked_at && rv.saved_at <= rv.acked_at);
  assert.equal(rv.raw.guarantee, undefined);
  assert.equal((await mockState()).revisions[S.rev1.id].acked, true);
  assert.equal((await q(`select status from public.channex_events where revision_id = $1`, [S.rev1.id]))[0].status, 'done');
  // the trigger marked availability; the worker sends it
  assert.ok((await q(`select count(*)::int n from public.channex_outbox where org_id = $1 and kind = 'availability' and target_id = 'UT-T'`, [ORG]))[0].n >= 1);
  const t = await tick();
  assert.equal(t.ari.sent, 1, JSON.stringify(t));
  const items = await availabilityItems();
  assert.deepEqual(items.map((i) => [i.room_type_id, i.date || i.date_from, i.date_to || i.date, i.availability]), [[ids.rt['UT-T'], '2026-11-11', '2026-11-13', 2]]);
  assert.deepEqual(await channexAvail('UT-T', '2026-11-10', '2026-11-14'), [2, 2, 2, 2, 3]);
});

test('modification: same record, unit kept, dates moved; availability follows', { skip: SKIP }, async () => {
  const r = await channelBooking({ booking_id: S.rev1.booking_id, status: 'modified', checkin_date: '2026-11-12', checkout_date: '2026-11-16', amount: '480.00' });
  assert.equal(r.deliveries[0].status, 200);
  assert.deepEqual(await recordIdsOf(S.rev1.booking_id), [S.id1]);
  const b = await booking(S.id1);
  assert.equal(b.propertyId, 'T-01', 'still free for the new dates: kept');
  assert.equal(b.checkIn, '2026-11-12'); assert.equal(b.checkOut, '2026-11-16'); assert.equal(b.nights, 4); assert.equal(b.total, 480);
  assert.equal(b.channex.revisionId, r.revision.id);
  assert.equal((await q(`select count(*)::int n from public.records where org_id = $1 and coll = 'bookings' and data->'channex'->>'bookingId' = $2`, [ORG, S.rev1.booking_id]))[0].n, 1);
  await tick();
  assert.deepEqual(await channexAvail('UT-T', '2026-11-11', '2026-11-16'), [3, 2, 2, 2, 2, 3]);
  S.rev2 = r.revision.attributes;
});

test('a replayed webhook is stored once and changes nothing; a late older revision is acknowledged but not applied', { skip: SKIP }, async () => {
  const body = { event: 'booking', property_id: ids.property, user_id: null, timestamp: new Date().toISOString(), payload: { booking_id: S.rev1.booking_id, property_id: ids.property, revision_id: S.rev2.id } };
  const a = await postWebhook(body);
  assert.equal(a.status, 200); assert.equal(a.json.status, 'done');
  const before = await booking(S.id1);
  const raw = a.body;
  const ts = String(Math.floor(Date.now() / 1000));
  const again = await fetch(webhookUrl, { method: 'POST', headers: { 'x-hmac-timestamp': ts, 'x-hmac-signature-256': signWebhook(SIGNING, ts, raw) }, body: raw });
  const j = await again.json();
  assert.equal(again.status, 200); assert.equal(j.duplicate, true);
  assert.equal((await q('select count(*)::int n from public.channex_events where revision_id = $1 and payload->>\'timestamp\' = $2', [S.rev2.id, body.timestamp]))[0].n, 1);
  assert.deepEqual(await booking(S.id1), before);
  assert.equal((await q(`select count(*)::int n from public.records where org_id = $1 and coll = 'bookings' and data->'channex'->>'bookingId' = $2`, [ORG, S.rev1.booking_id]))[0].n, 1);
  assert.equal((await calls()).filter((c) => c.method === 'POST' && c.path.endsWith('/ack')).length, 0, 'already acknowledged: nothing to do');
  // the first revision again (as if it arrived late): older than what was applied
  const late = await postWebhook({ event: 'booking', property_id: ids.property, timestamp: new Date().toISOString(), payload: { revision_id: S.rev1.id, booking_id: S.rev1.booking_id, property_id: ids.property } });
  assert.equal(late.status, 200);
  assert.equal((await booking(S.id1)).checkIn, '2026-11-12');
});

test('a bad signature gets 401 and nothing is stored', { skip: SKIP }, async () => {
  const n0 = (await q('select count(*)::int n from public.channex_events'))[0].n;
  const r = await postWebhook({ event: 'booking', payload: { revision_id: S.rev2.id } }, { secret: 'not-the-secret' });
  assert.equal(r.status, 401);
  const unsigned = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"event":"booking"}' });
  assert.equal(unsigned.status, 401);
  assert.equal((await q('select count(*)::int n from public.channex_events'))[0].n, n0);
  assert.equal((await calls()).length, 0);
});

test('a stale revision is acknowledged without being applied', { skip: SKIP }, async () => {
  // two revisions of one booking; the newer one arrives first
  const older = await channelBooking({ booking_id: S.rev1.booking_id, status: 'modified', checkin_date: '2026-11-12', checkout_date: '2026-11-17', deliver: false });
  await new Promise((r) => setTimeout(r, 5));
  const newer = await channelBooking({ booking_id: S.rev1.booking_id, status: 'modified', checkin_date: '2026-11-12', checkout_date: '2026-11-15' });
  assert.equal((await booking(S.id1)).checkOut, '2026-11-15');
  const r = await postWebhook({ event: 'booking', property_id: ids.property, timestamp: new Date().toISOString(), payload: { revision_id: older.revision.id, booking_id: S.rev1.booking_id, property_id: ids.property } });
  assert.equal(r.json.status, 'done');
  assert.equal((await booking(S.id1)).checkOut, '2026-11-15', 'older revision not applied');
  assert.equal((await mockState()).revisions[older.revision.id].acked, true, 'but acknowledged');
  assert.equal((await q('select status from public.channex_revisions where revision_id = $1', [older.revision.id]))[0].status, 'stale');
  S.rev3 = newer.revision.attributes;
  await tick();
  assert.deepEqual(await channexAvail('UT-T', '2026-11-12', '2026-11-16'), [2, 2, 2, 3, 3]);
});

test('cancellation: the booking is cancelled (unit and codes kept for the record) and availability returns', { skip: SKIP }, async () => {
  const r = await channelBooking({ booking_id: S.rev1.booking_id, status: 'cancelled' });
  assert.equal(r.deliveries[0].status, 200);
  const b = await booking(S.id1);
  assert.equal(b.status, 'cancelled'); assert.equal(b.cancelledAt, TODAY); assert.equal(b.codeStatus, 'cancelled');
  assert.equal(b.propertyId, 'T-01');
  const t = await tick();
  assert.equal(t.ari.sent, 1);
  assert.deepEqual(await channexAvail('UT-T', '2026-11-11', '2026-11-15'), [3, 3, 3, 3, 3]);
});

test('overlapping bookings: the second has no unit and raises double_booking and needs_unit; nightly re-assignment fills it later', { skip: SKIP }, async () => {
  const a = await channelBooking(Dd({ status: 'new', checkin_date: '2026-10-20', checkout_date: '2026-10-23', customer: { name: 'First', surname: 'Double', country: 'MY' } }));
  const [ida] = await recordIdsOf(a.revision.attributes.booking_id);
  assert.equal((await booking(ida)).propertyId, 'D-01');
  assert.equal((await booking(ida)).checkInTime, '16:00', 'the unit\'s own check-in time');
  const b = await channelBooking(Dd({ status: 'new', checkin_date: '2026-10-21', checkout_date: '2026-10-24', customer: { name: 'Second', surname: 'Double', country: 'SG' } }));
  const [idb] = await recordIdsOf(b.revision.attributes.booking_id);
  const bb = await booking(idb);
  assert.equal(bb.propertyId, null); assert.equal(bb.needsUnit, true);
  assert.deepEqual(bb.conflict && [bb.conflict.kind, bb.conflict.with], ['double_booking', [ida]]);
  assert.equal((await mockState()).revisions[b.revision.id].acked, true, 'saved, so acknowledged even with a conflict');
  const dbl = await openAlerts('double_booking');
  assert.equal(dbl.length, 1); assert.equal(dbl[0].ref.bookingId, idb); assert.deepEqual(dbl[0].ref.with, [ida]);
  assert.equal((await openAlerts('needs_unit')).filter((x) => x.ref.bookingId === idb).length, 1);
  await tick();
  assert.deepEqual(await channexAvail('UT-D', '2026-10-20', '2026-10-24'), [0, 0, 0, 0, 1], 'oversold shows as 0');
  // the first guest cancels; the nightly pass gives the second one the unit
  await channelBooking({ booking_id: a.revision.attributes.booking_id, status: 'cancelled' });
  const n = await tick('nightly');
  assert.equal(n.reassign.moved, 1, JSON.stringify(n.reassign));
  const after = await booking(idb);
  assert.equal(after.propertyId, 'D-01'); assert.equal(after.needsUnit, undefined); assert.equal(after.assignment.how, 'auto');
  assert.equal((await openAlerts('needs_unit')).filter((x) => x.ref.bookingId === idb).length, 0, 'resolved');
  const log = (await q(`select data from public.blobs where org_id = $1 and key = 'auditLog'`, [ORG]))[0].data.v;
  assert.ok(log.some((e) => e.by === 'system' && /Second Double .* to 22-1 automatically/.test(e.text)), JSON.stringify(log.slice(0, 3)));
  S.idb = idb;
});

test('unmapped room type: saved without a unit type, unmapped_room and unmapped_rate alerts, still acknowledged', { skip: SKIP }, async () => {
  const r = await channelBooking({ room_type_id: '99999999-9999-4999-8999-999999999999', rate_plan_id: null, status: 'new', checkin_date: '2026-12-01', checkout_date: '2026-12-02' });
  const [id] = await recordIdsOf(r.revision.attributes.booking_id);
  const b = await booking(id);
  assert.equal(b.unitTypeId, null); assert.equal(b.propertyId, null); assert.equal(b.needsUnit, true);
  assert.equal((await openAlerts('unmapped_room')).length, 1);
  assert.equal((await openAlerts('unmapped_rate')).length, 1);
  assert.equal((await mockState()).revisions[r.revision.id].acked, true);
});

/* ---------- failures: save first, ack after ---------- */

test('database down while saving: no acknowledgement; the worker saves and acknowledges it later', { skip: SKIP }, async () => {
  await db.query('revoke insert, update on public.records from service_role');
  let r;
  try {
    r = await channelBooking(T({ status: 'new', checkin_date: '2026-11-20', checkout_date: '2026-11-22' }));
  } finally {
    await db.query('grant insert, update on public.records to service_role');
  }
  assert.equal(r.deliveries[0].status, 200, 'the event itself was stored');
  const rid = r.revision.id;
  assert.equal((await mockState()).revisions[rid].acked, false, 'not acknowledged');
  assert.equal((await calls()).filter((c) => c.path.endsWith('/ack')).length, 0);
  assert.equal((await q('select count(*)::int n from public.channex_revisions where revision_id = $1 and saved_at is not null', [rid]))[0].n, 0);
  const ev = (await q('select id, status, error from public.channex_events where revision_id = $1', [rid]))[0];
  assert.equal(ev.status, 'error');
  // a minute later the worker tries again
  await db.query(`update public.channex_events set received_at = received_at - interval '2 minutes' where id = $1`, [ev.id]);
  const t = await tick();
  assert.equal(t.inbound.done, 1, JSON.stringify(t.inbound));
  assert.equal((await mockState()).revisions[rid].acked, true);
  const [id] = await recordIdsOf(r.revision.attributes.booking_id);
  assert.equal((await booking(id)).propertyId !== null, true);
  assert.equal((await q('select status from public.channex_events where id = $1', [ev.id]))[0].status, 'done');
  const seq = (await calls()).filter((c) => c.path.includes(rid)).map((c) => c.method);
  assert.deepEqual(seq, ['GET', 'GET', 'POST'], 'webhook fetch (save failed, no ack), the worker fetches again, then the one ack');
});

test('Channex fails the acknowledgement: the booking stays saved and the worker acknowledges it on the next tick', { skip: SKIP }, async () => {
  await control('config', { every5xx: 2 }); // the webhook's GET is call 1, its ack call 2 -> 503
  let r;
  try {
    r = await channelBooking(T({ status: 'new', checkin_date: '2026-11-25', checkout_date: '2026-11-27' }));
  } finally {
    await control('config', { every5xx: 0 });
  }
  const rid = r.revision.id;
  const [id] = await recordIdsOf(r.revision.attributes.booking_id);
  assert.equal((await booking(id)).status, 'confirmed', 'saved');
  const rv = (await q('select saved_at, acked_at, ack_error from public.channex_revisions where revision_id = $1', [rid]))[0];
  assert.ok(rv.saved_at); assert.equal(rv.acked_at, null); assert.match(rv.ack_error, /^retryable/);
  assert.equal((await mockState()).revisions[rid].acked, false);
  const t = await tick();
  assert.ok(t.inbound.acked >= 1, JSON.stringify(t.inbound));
  assert.equal((await mockState()).revisions[rid].acked, true);
  assert.ok((await q('select acked_at from public.channex_revisions where revision_id = $1', [rid]))[0].acked_at);
});

/* ---------- the feed ---------- */

test('feed polling picks up a revision that never had a webhook (every 15 minutes)', { skip: SKIP }, async () => {
  const r = await channelBooking(T({ status: 'new', checkin_date: '2026-12-10', checkout_date: '2026-12-12', deliver: false }));
  assert.deepEqual(r.deliveries, []);
  // not yet due: nothing polled
  let t = await tick();
  assert.equal(t.feed.polled, false);
  assert.equal((await calls()).filter((c) => c.path === '/booking_revisions/feed').length, 0);
  await db.query(`update public.channex_meta set last_feed_poll_at = now() - interval '16 minutes'`);
  t = await tick();
  assert.equal(t.feed.polled, true); assert.equal(t.feed.saved, 1, JSON.stringify(t.feed)); assert.equal(t.feed.acked, 1);
  const [id] = await recordIdsOf(r.revision.attributes.booking_id);
  const b = await booking(id);
  assert.equal(b.checkIn, '2026-12-10'); assert.ok(b.propertyId);
  assert.equal((await mockState()).revisions[r.revision.id].acked, true);
  // the next tick (after the 5-second quiet window) closes the dates; the poll is claimed, so it does not poll again
  t = await tick();
  assert.equal(t.feed.polled, false);
  assert.deepEqual(await channexAvail('UT-T', '2026-12-10', '2026-12-11'), [2, 2]);
});

test('Orbique never lists bookings: no GET /bookings in the whole run, and no card data stored', { skip: SKIP }, async () => {
  const all = (await q(`select endpoint, method from public.channex_calls`)).map((c) => c.method + ' ' + c.endpoint);
  assert.ok(!all.some((c) => /^GET \/bookings/.test(c)), all.join('\n'));
  assert.ok(all.some((c) => /^GET \/booking_revisions\/feed$/.test(c)));
  assert.ok(all.some((c) => /^POST \/booking_revisions\/.+\/ack$/.test(c)));
  const stored = JSON.stringify(await q(`select data from public.records where org_id = $1 and coll = 'bookings'`, [ORG])) + JSON.stringify(await q('select raw from public.channex_revisions'));
  assert.ok(!/card_number|cardholder|cvv/.test(stored));
});
