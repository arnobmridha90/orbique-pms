/* Integration: api/channex.js and the worker against the Channex mock and a real Postgres (with PostgREST).
 * A certification rehearsal at the API level (plan section 7, tests 1-10): each test makes the data change the
 * Orbique UI will make (records writes; the 0006 triggers add the marks), sends with `flush` like the UI's kick, and
 * asserts exactly one batched Channex call with the expected values. Then 429 backoff with no lost changes, the
 * setup queue, pause/resume, and the worker endpoint.
 *
 * Skipped unless a local database is available:
 *   CHANNEX_TEST_PGURL=postgres://postgres@127.0.0.1:54329/postgres POSTGREST_BIN=/path/to/postgrest \
 *     node --test tests/channex/worker.integration.test.mjs
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMock } from '../../scripts/channex-mock.mjs';
import { localSupabaseAvailable, startLocalSupabase } from './helpers/local-supabase.mjs';

const ENABLED = localSupabaseAvailable();
const SKIP = ENABLED ? false : 'set CHANNEX_TEST_PGURL and POSTGREST_BIN to run (see the top of this file)';
const TODAY = '2026-10-15';
const LAST = '2028-02-26'; // TODAY + 499
const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001'; // allowlisted
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002'; // not allowlisted
const ORG_C = 'cccccccc-0000-4000-8000-000000000003'; // allowlisted, demo workspace
const WORKER_SECRET = 'test-worker-secret-0123456789abcdef';

const mock = createMock({ apiKey: 'test-key', every429: 0, every5xx: 0, latencyMs: 0, rateLimits: false, signingSecret: '', webhookUrl: '' });
let env;
let mockUrl;
let channexApi;
let workerApi;
let owner;
let opsUser;
let hkUser;
let ownerC;
let ownerB;
let db;
let ids = {}; // Channex ids from the mock: rt.UT-T, rp.RP-TB, property, group

const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dates = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };

/* ---------- helpers ---------- */

async function api(handler, token, body) {
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ''; } };
  const req = { method: 'POST', headers: token ? { authorization: 'Bearer ' + token } : {}, body };
  await handler(req, res);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}
const channex = (user, body) => api(channexApi, user && user.token, body);

const control = async (what, body, method = 'POST') => (await fetch(mockUrl + '/__mock/' + what, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) })).json();
const calls = async () => (await control('calls', null, 'GET')).calls;
const posts = async (path) => (await calls()).filter((c) => c.method === 'POST' && c.path === path);
const writes = async () => (await calls()).filter((c) => c.method !== 'GET');
const mockState = async () => control('state', null, 'GET');

async function put(org, coll, id, data) {
  await db.query(`insert into public.records (org_id, coll, id, data) values ($1, $2, $3, $4)
                  on conflict (org_id, coll, id) do update set data = excluded.data, deleted = false`, [org, coll, id, data]);
}
async function remove(org, coll, id) { await db.query('update public.records set deleted = true where org_id = $1 and coll = $2 and id = $3', [org, coll, id]); }

/** What the UI's rates editor will do: one write per month record touched, merging day values. */
async function setDays(planId, changes) {
  const byMonth = new Map();
  for (const [iso, patch] of Object.entries(changes)) {
    const m = iso.slice(0, 7);
    byMonth.set(m, Object.assign(byMonth.get(m) || {}, { [iso]: patch }));
  }
  for (const [month, days] of byMonth) {
    const id = `CR-${planId}-${month}`;
    const cur = (await db.query(`select data from public.records where org_id = $1 and coll = 'channelRates' and id = $2`, [ORG_A, id])).rows[0];
    const data = cur ? cur.data : { planId, unitTypeId: PLAN_TYPE[planId], month, days: {} };
    for (const [iso, patch] of Object.entries(days)) data.days[iso] = Object.assign({}, data.days[iso], patch, { src: 'manual' });
    await put(ORG_A, 'channelRates', id, data);
  }
}
const range = (a, b, patch) => Object.fromEntries(dates(a, b).map((d) => [d, patch]));

/** The UI kick (flush) honours a 2 s gap per workspace; wait it out between tests. */
let lastFlush = 0;
async function flush(user = owner, org = ORG_A) {
  const wait = lastFlush + 2100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFlush = Date.now();
  const r = await channex(user, { action: 'flush', orgId: org });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}

/** Items of the only call to path made since the last clear (asserts it was exactly one). */
async function onlyCall(path) {
  const list = await posts(path);
  assert.equal(list.length, 1, `expected exactly one POST ${path}, got ${list.length}`);
  assert.equal(list[0].status, 200);
  const other = path === '/restrictions' ? '/availability' : '/restrictions';
  assert.equal((await posts(other)).length, 0, `no POST ${other} expected`);
  return list[0].body.values;
}

/** Find the item for a target and dates; check the fields given. */
function item(items, idKey, id, when, fields) {
  const hit = items.filter((i) => i[idKey] === id && (when.date ? i.date === when.date : i.date_from === when.from && i.date_to === when.to));
  assert.equal(hit.length, 1, `one item for ${id} ${JSON.stringify(when)} in ${JSON.stringify(items)}`);
  for (const [k, v] of Object.entries(fields)) assert.deepEqual(hit[0][k], v, `${id} ${JSON.stringify(when)} ${k}`);
  assert.equal(hit[0].property_id, ids.property);
  return hit[0];
}
const rp = (planId) => ids.rp[planId];
const rt = (typeId) => ids.rt[typeId];

/** Channex (mock) values for a plan / room type on a date. */
async function channexRestriction(planId, iso) { const s = await mockState(); return (s.restrictions[rp(planId)] || {})[iso]; }
async function channexAvailability(typeId, iso) { const s = await mockState(); return (s.availability[rt(typeId)] || {})[iso]; }

/* ---------- the certification property ---------- */

const PLAN_TYPE = { 'RP-TB': 'UT-T', 'RP-TBB': 'UT-T', 'RP-DB': 'UT-D', 'RP-DBB': 'UT-D' };
const PLANS = [
  { id: 'RP-TB', unitTypeId: 'UT-T', name: 'Best Available Rate', meal: 'room_only', primary: true, defaultRate: 100, minStay: 1 },
  { id: 'RP-TBB', unitTypeId: 'UT-T', name: 'Bed & Breakfast', meal: 'breakfast', defaultRate: 120, minStay: 1 },
  { id: 'RP-DB', unitTypeId: 'UT-D', name: 'Best Available Rate', meal: 'room_only', primary: true, defaultRate: 100, minStay: 1 },
  { id: 'RP-DBB', unitTypeId: 'UT-D', name: 'Bed & Breakfast', meal: 'breakfast', defaultRate: 120, minStay: 1 }
];
/** The materialised model (what O.channel.fill writes): rates vary by weekday, season and type, like a live hotel. */
function modelRate(plan, iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const weekend = d.getUTCDay() === 5 || d.getUTCDay() === 6 ? 30 : 0;
  const season = d.getUTCMonth() === 11 ? 20 : 0;
  return plan.defaultRate + (plan.unitTypeId === 'UT-D' ? 15 : 0) + weekend + season + (d.getUTCDate() % 3) * 5;
}

async function seed() {
  for (const [org, name] of [[ORG_A, 'Orbique Test Hotels'], [ORG_B, 'Not Allowed Sdn Bhd'], [ORG_C, 'Demo Workspace']]) {
    await db.query('insert into public.orgs (id, name) values ($1, $2)', [org, name]);
  }
  owner = await env.addUser('owner@example.test', { name: 'Olivia Owner' });
  opsUser = await env.addUser('ops@example.test', { name: 'Oscar Ops' });
  hkUser = await env.addUser('hk@example.test', { name: 'Hana Housekeeping' });
  ownerB = await env.addUser('owner-b@example.test');
  ownerC = await env.addUser('owner-c@example.test');
  const mem = [[ORG_A, owner, 's1', 'owner'], [ORG_A, opsUser, 's2', 'ops'], [ORG_A, hkUser, 's3', 'housekeeping'], [ORG_B, ownerB, 's1', 'owner'], [ORG_C, ownerC, 's1', 'owner']];
  for (const [org, u, staff, role] of mem) await db.query('insert into public.members (org_id, user_id, staff_id, role) values ($1, $2, $3, $4)', [org, u.id, staff, role]);
  await put(ORG_A, 'staff', 's1', { id: 's1', name: 'Olivia Owner', role: 'owner' });
  await db.query(`insert into public.blobs (org_id, key, data) values ($1, 'workspaceMeta', $2), ($3, 'workspaceMeta', $4)`,
    [ORG_A, { v: { demo: false } }, ORG_C, { v: { demo: true } }]);

  for (const org of [ORG_A, ORG_B, ORG_C]) {
    await put(org, 'buildings', 'BD-1', { id: 'BD-1', name: 'Test Property - Orbique', address: '1 Jalan Ujian', city: 'Kuala Lumpur', state: 'WP Kuala Lumpur', zip: '50450', country: 'MY', currency: 'USD', propertyType: 'apartment', email: 'ops@example.test', checkInTime: '15:00', checkOutTime: '11:00' });
    await put(org, 'unitTypes', 'UT-T', { id: 'UT-T', buildingId: 'BD-1', name: 'Twin Room', maxGuests: 2, beds: 2, order: 1 });
    await put(org, 'unitTypes', 'UT-D', { id: 'UT-D', buildingId: 'BD-1', name: 'Double Room', maxGuests: 2, beds: 1, order: 2 });
    for (let i = 1; i <= 8; i++) await put(org, 'properties', `T-0${i}`, { id: `T-0${i}`, name: `Twin ${i}`, buildingId: 'BD-1', unitTypeId: 'UT-T', unitNo: `21-${i}` });
    for (let i = 1; i <= 4; i++) await put(org, 'properties', `D-0${i}`, { id: `D-0${i}`, name: `Double ${i}`, buildingId: 'BD-1', unitTypeId: 'UT-D', unitNo: `22-${i}` });
    for (const p of PLANS) await put(org, 'ratePlans', p.id, p);
  }
  // the model for 500 days, one record per plan per month
  for (const p of PLANS) {
    const months = new Map();
    for (const iso of dates(TODAY, LAST)) {
      const m = iso.slice(0, 7);
      if (!months.has(m)) months.set(m, {});
      months.get(m)[iso] = { rate: modelRate(p, iso), src: 'model', minStay: 1 };
    }
    for (const [m, days] of months) await put(ORG_A, 'channelRates', `CR-${p.id}-${m}`, { planId: p.id, unitTypeId: p.unitTypeId, month: m, days });
  }
  // availability that varies: bookings outside 10-25 Nov, the holds tests 9 and 10 start from
  let n = 0;
  for (let d = '2026-10-16'; d <= '2028-02-20'; d = addDays(d, 9)) {
    if (d >= '2026-11-05' && d <= '2026-11-27') continue;
    n++;
    await put(ORG_A, 'bookings', `BK-S${n}`, { id: `BK-S${n}`, unitTypeId: 'UT-T', propertyId: `T-0${(n % 8) + 1}`, checkIn: d, checkOut: addDays(d, 2), status: 'confirmed', channel: 'direct' });
    if (n % 2) await put(ORG_A, 'bookings', `BK-D${n}`, { id: `BK-D${n}`, unitTypeId: 'UT-D', propertyId: null, checkIn: addDays(d, 1), checkOut: addDays(d, 4), status: 'confirmed', channel: 'direct' });
  }
  // test 9 starts from Double 1 free on 25 Nov; test 10 from a hold on D-01 17-24 Nov
  for (const u of ['D-02', 'D-03', 'D-04']) await put(ORG_A, 'blocks', `BL-25-${u}`, { id: `BL-25-${u}`, propertyId: u, start: '2026-11-25', end: '2026-11-26', reason: 'owner' });
  await put(ORG_A, 'blocks', 'BL-HOLD-D01', { id: 'BL-HOLD-D01', propertyId: 'D-01', start: '2026-11-17', end: '2026-11-25', reason: 'maintenance' });
}

/* ---------- lifecycle ---------- */

before(async () => {
  if (!ENABLED) return;
  const m = await mock.listen(0);
  mockUrl = m.url;
  env = await startLocalSupabase({ dbName: 'orbique_channex_it', today: TODAY });
  db = env.db;
  Object.assign(process.env, {
    SUPABASE_URL: env.url, SUPABASE_SERVICE_ROLE_KEY: env.serviceKey,
    CHANNEX_BASE_URL: m.apiUrl, CHANNEX_API_KEY: 'test-key', CHANNEX_TODAY: TODAY,
    CHANNEX_ORG_ALLOWLIST: `${ORG_A},${ORG_C}`, CHANNEX_WORKER_SECRET: WORKER_SECRET,
    CHANNEX_WEBHOOK_TOKEN: 'test-webhook-token', APP_URL: 'https://orbique.example'
  });
  delete process.env.CHANNEX_APP_URL;
  channexApi = (await import('../../api/channex.js')).default;
  workerApi = (await import('../../api/channex-worker.js')).default;
  await seed();
});

after(async () => {
  if (!ENABLED) return;
  await mock.close();
  await env.close();
});

beforeEach(async () => {
  if (!ENABLED) return;
  await control('calls', null, 'DELETE');
  // the per-minute limiter is tested on its own; keep earlier calls from counting against the next test
  await db.query(`update public.channex_calls set at = at - interval '2 minutes'`);
});

/* ---------- M4: setup ---------- */

test('config: live for the allowlisted workspace, practice for demo and others', { skip: SKIP }, async () => {
  assert.deepEqual((await channex(owner, { action: 'config', orgId: ORG_A })).json, { ok: true, configured: true, env: 'staging', allowed: true, demo: false });
  assert.equal((await channex(ownerB, { action: 'config', orgId: ORG_B })).json.allowed, false);
  assert.deepEqual((await channex(ownerC, { action: 'config', orgId: ORG_C })).json, { ok: true, configured: true, env: 'staging', allowed: false, demo: true });
  assert.equal((await channex(ownerB, { action: 'config', orgId: ORG_A })).status, 403, 'not a member');
  assert.equal((await channex(null, { action: 'config', orgId: ORG_A })).status, 401);
});

test('connect is refused for a demo workspace, a workspace not on the allowlist, and staff without the role', { skip: SKIP }, async () => {
  const c = await channex(ownerC, { action: 'connect', orgId: ORG_C, buildingId: 'BD-1' });
  assert.equal(c.status, 403); assert.match(c.json.message, /demo workspace/);
  const b = await channex(ownerB, { action: 'connect', orgId: ORG_B, buildingId: 'BD-1' });
  assert.equal(b.status, 403); assert.match(b.json.message, /not switched on/);
  const h = await channex(hkUser, { action: 'connect', orgId: ORG_A, buildingId: 'BD-1' });
  assert.equal(h.status, 403);
  assert.equal((await writes()).length, 0, 'nothing reached Channex');
});

test('certification 1: connect creates group, property, 2 room types (8/4), 4 rate plans, then one full sync (1 availability + 1 restrictions call, 500 days)', { skip: SKIP }, async () => {
  const r = await channex(opsUser, { action: 'connect', orgId: ORG_A, buildingId: 'BD-1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.property.status, 'live');
  const all = await writes();
  const by = (p) => all.filter((c) => c.method === 'POST' && c.path === p);
  assert.equal(by('/groups').length, 1);
  assert.equal(by('/groups')[0].body.group.title, `Orbique Test Hotels · ${ORG_A.slice(0, 8)}`);
  assert.equal(by('/properties').length, 1);
  const prop = by('/properties')[0].body.property;
  assert.equal(prop.currency, 'USD'); assert.equal(prop.timezone, 'Asia/Kuala_Lumpur'); assert.equal(prop.settings.min_stay_type, 'arrival'); assert.equal(prop.settings.state_length, 500);
  assert.equal(prop.settings.allow_availability_autoupdate_on_confirmation, true); assert.equal(prop.settings.allow_availability_autoupdate_on_cancellation, false);
  const rts = by('/room_types').map((c) => c.body.room_type);
  assert.deepEqual(rts.map((x) => [x.title, x.count_of_rooms, x.occ_adults]).sort(), [['Double Room', 4, 2], ['Twin Room', 8, 2]]);
  const rps = by('/rate_plans').map((c) => c.body.rate_plan);
  assert.deepEqual(rps.map((x) => [x.title, x.meal_type, x.options[0].rate, x.currency]).sort(), [['Bed & Breakfast', 'breakfast', '120.00', 'USD'], ['Bed & Breakfast', 'breakfast', '120.00', 'USD'], ['Best Available Rate', 'room_only', '100.00', 'USD'], ['Best Available Rate', 'room_only', '100.00', 'USD']]);
  assert.equal(all.filter((c) => c.method === 'PUT').length, 0);

  // ids for the rest of the tests
  const map = await db.query(`select (select channex_property_id from public.channex_properties where org_id = $1) p, (select group_id from public.channex_groups where org_id = $1) g`, [ORG_A]);
  ids = { property: map.rows[0].p, group: map.rows[0].g, rt: {}, rp: {} };
  for (const x of (await db.query('select unit_type_id, room_type_id from public.channex_room_types where org_id = $1', [ORG_A])).rows) ids.rt[x.unit_type_id] = x.room_type_id;
  for (const x of (await db.query('select plan_id, rate_plan_id from public.channex_rate_plans where org_id = $1', [ORG_A])).rows) ids.rp[x.plan_id] = x.rate_plan_id;
  assert.equal(Object.keys(ids.rp).length, 4);

  // full sync: exactly one availability and one restrictions call, covering 500 days of every room type and plan
  const av = by('/availability');
  const rs = by('/restrictions');
  assert.equal(av.length, 1); assert.equal(rs.length, 1);
  assert.ok(all.indexOf(av[0]) > all.indexOf(by('/rate_plans')[3]), 'ARI after setup');
  const s = await mockState();
  for (const t of ['UT-T', 'UT-D']) assert.deepEqual(Object.keys(s.availability[rt(t)]).sort(), dates(TODAY, LAST), t + ' 500 days');
  for (const p of Object.keys(PLAN_TYPE)) assert.deepEqual(Object.keys(s.restrictions[rp(p)]).sort(), dates(TODAY, LAST), p + ' 500 days');
  // data varies by day and room like a live hotel
  assert.ok(new Set(Object.values(s.availability[rt('UT-T')])).size > 1 && new Set(Object.values(s.availability[rt('UT-D')])).size > 1);
  assert.ok(new Set(Object.values(s.restrictions[rp('RP-TB')]).map((x) => x.rate)).size > 3);
  assert.equal(s.availability[rt('UT-T')]['2026-11-21'], 8);
  assert.equal(s.availability[rt('UT-D')]['2026-11-25'], 1);
  assert.equal(s.availability[rt('UT-D')]['2026-11-20'], 3);
  assert.equal(s.restrictions[rp('RP-TB')]['2026-11-22'].rate, modelRate(PLANS[0], '2026-11-22').toFixed(2));
  // task ids are kept for the certification form; the call log has them too
  const fs = r.json.fullSync;
  assert.equal(fs.availability.length, 1); assert.equal(fs.restrictions.length, 1);
  const logged = (await db.query(`select endpoint, source, http_status, task_ids, item_count from public.channex_calls where org_id = $1 and source = 'full' order by id`, [ORG_A])).rows;
  assert.deepEqual(logged.map((x) => [x.endpoint, x.http_status, x.task_ids.length]), [['/availability', 200, 1], ['/restrictions', 200, 1]]);
  assert.equal((await db.query('select count(*)::int n from public.channex_outbox where org_id = $1', [ORG_A])).rows[0].n, 0, 'nothing left to send');
});

test('reconnect is idempotent: no new Channex objects, no second full sync', { skip: SKIP }, async () => {
  const r = await channex(owner, { action: 'connect', orgId: ORG_A, buildingId: 'BD-1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.created, { roomTypes: 0, ratePlans: 0 });
  assert.equal((await writes()).length, 0, JSON.stringify(await writes()));
  assert.equal((await db.query('select count(*)::int n from public.channex_room_types')).rows[0].n, 2);
});

test('full-sync is refused within 24 hours of the last one', { skip: SKIP }, async () => {
  const r = await channex(owner, { action: 'full-sync', orgId: ORG_A, buildingId: 'BD-1', confirm: true });
  assert.equal(r.status, 429); assert.equal(r.json.error, 'full-sync-recent');
  assert.equal((await channex(owner, { action: 'full-sync', orgId: ORG_A, buildingId: 'BD-1' })).status, 400, 'needs confirm');
  assert.equal((await writes()).length, 0);
});

test('iframe: one-time token URL for the channel screen; the API key is never returned', { skip: SKIP }, async () => {
  const r = await channex(owner, { action: 'iframe', orgId: ORG_A, buildingId: 'BD-1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(!JSON.stringify(r.json).includes('test-key'));
  const u = new URL(r.json.url);
  assert.equal(u.origin + u.pathname, mockUrl + '/auth/exchange');
  assert.equal(u.searchParams.get('app_mode'), 'headless'); assert.equal(u.searchParams.get('redirect_to'), '/channels');
  assert.equal(u.searchParams.get('property_id'), ids.property); assert.equal(u.searchParams.get('group_id'), ids.group);
  assert.equal(u.searchParams.get('channels'), 'BDC,AGO,ABB,EXP,CTP'); assert.equal(u.searchParams.get('lng'), 'en');
  const tok = (await posts('/auth/one_time_token'))[0].body.one_time_token;
  assert.deepEqual(tok, { property_id: ids.property, username: 'Olivia Owner', group_id: ids.group });
  const page = await fetch(r.json.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Test Property - Orbique/);
  assert.equal((await fetch(r.json.url)).status, 401, 'single use');
  const logged = (await db.query(`select payload from public.channex_calls where source = 'iframe'`)).rows;
  assert.ok(logged.length === 1 && !JSON.stringify(logged).includes(u.searchParams.get('oauth_session_key')), 'token not stored');
  assert.ok(Date.parse(r.json.expiresAt) > Date.now());
  assert.equal((await channex(hkUser, { action: 'iframe', orgId: ORG_A, buildingId: 'BD-1' })).status, 403);
});

test('channels: listed from Channex and cached', { skip: SKIP }, async () => {
  await control('channel', { property_id: ids.property, channel: 'BDC' });
  const r = await channex(hkUser, { action: 'channels', orgId: ORG_A, buildingId: 'BD-1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.channels.length, 1);
  assert.equal(r.json.channels[0].channel, 'BDC'); assert.equal(r.json.channels[0].isActive, true);
  assert.equal((await db.query(`select jsonb_array_length(channels) n from public.channex_properties where org_id = $1`, [ORG_A])).rows[0].n, 1);
});

/* ---------- M5: certification tests 2-10, one batched call each ---------- */

const DEFAULTS = { min_stay_arrival: 1, max_stay: 0, closed_to_arrival: false, closed_to_departure: false, stop_sell: false };

test('certification 2: single date, single rate (Twin/BAR 22 Nov -> 333)', { skip: SKIP }, async () => {
  await setDays('RP-TB', { '2026-11-22': { rate: 333 } });
  const out = await flush();
  assert.equal(out.sent, 1); assert.equal(out.pending, 0);
  const items = await onlyCall('/restrictions');
  assert.deepEqual(items, [Object.assign({ property_id: ids.property, rate_plan_id: rp('RP-TB'), date: '2026-11-22', rate: '333.00' }, DEFAULTS)]);
  assert.equal((await channexRestriction('RP-TB', '2026-11-22')).rate, '333.00');
});

test('certification 3: single date, multiple rates batched into one call', { skip: SKIP }, async () => {
  await setDays('RP-TB', { '2026-11-21': { rate: 333 } });
  await setDays('RP-DB', { '2026-11-25': { rate: 444 } });
  await setDays('RP-DBB', { '2026-11-29': { rate: 456.23 } });
  await flush();
  const items = await onlyCall('/restrictions');
  assert.equal(items.length, 3);
  item(items, 'rate_plan_id', rp('RP-TB'), { date: '2026-11-21' }, { rate: '333.00' });
  item(items, 'rate_plan_id', rp('RP-DB'), { date: '2026-11-25' }, { rate: '444.00' });
  item(items, 'rate_plan_id', rp('RP-DBB'), { date: '2026-11-29' }, { rate: '456.23' });
});

test('certification 4: multiple dates, multiple rates (one ranged item each)', { skip: SKIP }, async () => {
  await setDays('RP-TB', range('2026-11-01', '2026-11-10', { rate: 241 }));
  await setDays('RP-DB', range('2026-11-10', '2026-11-16', { rate: 312.66 }));
  await setDays('RP-DBB', range('2026-11-01', '2026-11-20', { rate: 111 }));
  await flush();
  const items = await onlyCall('/restrictions');
  assert.equal(items.length, 3, JSON.stringify(items));
  item(items, 'rate_plan_id', rp('RP-TB'), { from: '2026-11-01', to: '2026-11-10' }, Object.assign({ rate: '241.00' }, DEFAULTS));
  item(items, 'rate_plan_id', rp('RP-DB'), { from: '2026-11-10', to: '2026-11-16' }, { rate: '312.66' });
  item(items, 'rate_plan_id', rp('RP-DBB'), { from: '2026-11-01', to: '2026-11-20' }, { rate: '111.00' });
});

test('certification 5: min stay on three plans', { skip: SKIP }, async () => {
  await setDays('RP-TB', { '2026-11-23': { minStay: 3 } });
  await setDays('RP-DB', { '2026-11-25': { minStay: 2 } });
  await setDays('RP-DBB', { '2026-11-15': { minStay: 5 } });
  await flush();
  const items = await onlyCall('/restrictions');
  assert.equal(items.length, 3);
  item(items, 'rate_plan_id', rp('RP-TB'), { date: '2026-11-23' }, { min_stay_arrival: 3 });
  item(items, 'rate_plan_id', rp('RP-DB'), { date: '2026-11-25' }, { min_stay_arrival: 2, rate: '444.00' });
  item(items, 'rate_plan_id', rp('RP-DBB'), { date: '2026-11-15' }, { min_stay_arrival: 5, rate: '111.00' });
});

test('certification 6: stop sell on three plans', { skip: SKIP }, async () => {
  await setDays('RP-TB', { '2026-11-14': { stopSell: true } });
  await setDays('RP-DB', { '2026-11-16': { stopSell: true } });
  await setDays('RP-DBB', { '2026-11-20': { stopSell: true } });
  await flush();
  const items = await onlyCall('/restrictions');
  assert.equal(items.length, 3);
  item(items, 'rate_plan_id', rp('RP-TB'), { date: '2026-11-14' }, { stop_sell: true });
  item(items, 'rate_plan_id', rp('RP-DB'), { date: '2026-11-16' }, { stop_sell: true, rate: '312.66' });
  item(items, 'rate_plan_id', rp('RP-DBB'), { date: '2026-11-20' }, { stop_sell: true });
});

test('certification 7: multiple restrictions in one call', { skip: SKIP }, async () => {
  await setDays('RP-TB', range('2026-11-01', '2026-11-10', { cta: true, ctd: false, maxStay: 4, minStay: 1 }));
  await setDays('RP-TBB', range('2026-11-12', '2026-11-16', { cta: false, ctd: true, minStay: 6 }));
  await setDays('RP-DB', range('2026-11-10', '2026-11-16', { cta: true, minStay: 2 }));
  await setDays('RP-DBB', range('2026-11-01', '2026-11-20', { minStay: 10 }));
  await flush();
  const items = await onlyCall('/restrictions');
  item(items, 'rate_plan_id', rp('RP-TB'), { from: '2026-11-01', to: '2026-11-10' }, { rate: '241.00', closed_to_arrival: true, closed_to_departure: false, max_stay: 4, min_stay_arrival: 1 });
  for (const iso of dates('2026-11-12', '2026-11-16')) {
    const v = await channexRestriction('RP-TBB', iso);
    assert.equal(v.closed_to_arrival, false); assert.equal(v.closed_to_departure, true); assert.equal(v.min_stay_arrival, 6);
  }
  for (const iso of dates('2026-11-10', '2026-11-16')) {
    const v = await channexRestriction('RP-DB', iso);
    assert.equal(v.closed_to_arrival, true); assert.equal(v.min_stay_arrival, 2);
  }
  item(items, 'rate_plan_id', rp('RP-DB'), { from: '2026-11-10', to: '2026-11-15' }, { rate: '312.66', closed_to_arrival: true, min_stay_arrival: 2, stop_sell: false });
  item(items, 'rate_plan_id', rp('RP-DB'), { date: '2026-11-16' }, { closed_to_arrival: true, stop_sell: true }); // test 6's stop sell stays
  for (const iso of dates('2026-11-01', '2026-11-20')) assert.equal((await channexRestriction('RP-DBB', iso)).min_stay_arrival, 10);
  // only what changed was sent: Twin/B&B outside 12-16 Nov untouched
  assert.ok(!items.some((i) => i.rate_plan_id === rp('RP-TBB') && (i.date || i.date_from) < '2026-11-12'));
});

test('certification 8: half-year update is one call, one item per plan', { skip: SKIP }, async () => {
  await setDays('RP-TB', range('2026-12-01', '2027-05-01', { rate: 432, cta: false, ctd: false, minStay: 2 }));
  await setDays('RP-DB', range('2026-12-01', '2027-05-01', { rate: 342, minStay: 3 }));
  const marks = (await db.query('select count(*)::int n from public.channex_outbox where org_id = $1', [ORG_A])).rows[0].n;
  assert.ok(marks >= 12, 'one write per month record, each marked: ' + marks);
  await flush();
  const items = await onlyCall('/restrictions');
  assert.equal(items.length, 2, JSON.stringify(items.map((i) => [i.rate_plan_id, i.date_from, i.date_to])));
  item(items, 'rate_plan_id', rp('RP-TB'), { from: '2026-12-01', to: '2027-05-01' }, Object.assign({}, DEFAULTS, { rate: '432.00', min_stay_arrival: 2 }));
  item(items, 'rate_plan_id', rp('RP-DB'), { from: '2026-12-01', to: '2027-05-01' }, Object.assign({}, DEFAULTS, { rate: '342.00', min_stay_arrival: 3 }));
});

test('certification 9: single date availability (Twin 21 Nov -> 7, Double 25 Nov -> 0) in one call', { skip: SKIP }, async () => {
  // a direct booking for a Twin on 21 Nov, and a block on the last free Double on 25 Nov
  await put(ORG_A, 'bookings', 'BK-T9', { id: 'BK-T9', unitTypeId: 'UT-T', propertyId: 'T-03', checkIn: '2026-11-21', checkOut: '2026-11-22', status: 'confirmed', channel: 'direct', guest: { name: 'Cert Nine' } });
  await put(ORG_A, 'blocks', 'BL-T9', { id: 'BL-T9', propertyId: 'D-01', start: '2026-11-25', end: '2026-11-26', reason: 'owner' });
  await flush();
  const items = await onlyCall('/availability');
  assert.deepEqual(items.sort((a, b) => (a.date < b.date ? -1 : 1)), [
    { property_id: ids.property, room_type_id: rt('UT-T'), date: '2026-11-21', availability: 7 },
    { property_id: ids.property, room_type_id: rt('UT-D'), date: '2026-11-25', availability: 0 }
  ]);
});

test('certification 10: multiple date availability (Twin 10-16 Nov -> 3, Double 17-24 Nov -> 4) in one call', { skip: SKIP }, async () => {
  // block 5 Twin units 10-16 Nov in one dialog; lift the earlier hold on a Double unit 17-24 Nov
  for (const u of ['T-01', 'T-02', 'T-04', 'T-05', 'T-06']) await put(ORG_A, 'blocks', `BL-T10-${u}`, { id: `BL-T10-${u}`, propertyId: u, start: '2026-11-10', end: '2026-11-17', reason: 'owner', group: 'BL-T10' });
  await remove(ORG_A, 'blocks', 'BL-HOLD-D01');
  await flush();
  const items = await onlyCall('/availability');
  assert.equal(items.length, 2, JSON.stringify(items));
  item(items, 'room_type_id', rt('UT-T'), { from: '2026-11-10', to: '2026-11-16' }, { availability: 3 });
  item(items, 'room_type_id', rt('UT-D'), { from: '2026-11-17', to: '2026-11-24' }, { availability: 4 });
});

test('a change that does not alter what Channex has sends nothing', { skip: SKIP }, async () => {
  await setDays('RP-TB', { '2026-11-22': { rate: 333, note: 'same rate, new note' } });
  await put(ORG_A, 'bookings', 'BK-T9', { id: 'BK-T9', unitTypeId: 'UT-T', propertyId: 'T-03', checkIn: '2026-11-21', checkOut: '2026-11-22', status: 'confirmed', channel: 'direct', guest: { name: 'Renamed' } });
  const out = await flush();
  assert.equal(out.sent, 0);
  assert.equal((await writes()).length, 0);
  assert.equal((await db.query('select count(*)::int n from public.channex_outbox where org_id = $1', [ORG_A])).rows[0].n, 0, 'marks cleared');
});

/* ---------- limits, backoff and errors ---------- */

test('rate limiter: no slot -> nothing sent, marks kept, sent when a slot frees up', { skip: SKIP }, async () => {
  await db.query(`insert into public.channex_calls (org_id, channex_property_id, endpoint, method, source, at) select $1, $2, '/restrictions', 'POST', 'delta', now() from generate_series(1, 9)`, [ORG_A, ids.property]);
  await setDays('RP-TBB', { '2026-12-24': { rate: 199 } });
  let out = await flush();
  assert.equal(out.sent, 0); assert.equal(out.pending, 1);
  assert.equal((await writes()).length, 0);
  await db.query(`update public.channex_calls set at = at - interval '2 minutes'`);
  out = await flush();
  assert.equal(out.sent, 1); assert.equal(out.pending, 0);
  item(await onlyCall('/restrictions'), 'rate_plan_id', rp('RP-TBB'), { date: '2026-12-24' }, { rate: '199.00' });
});

test('MOCK_429_EVERY=2: backoff 60 s x 2^n, nothing sent while paused, no change lost', { skip: SKIP }, async () => {
  await control('config', { every429: 2 }); // counts from here: every 2nd API call answers 429
  const tick = async () => {
    await db.query(`update public.channex_calls set at = at - interval '2 minutes'`);
    const r = await api(workerApi, WORKER_SECRET, { task: 'tick' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json;
  };
  const prop = async () => (await db.query('select paused_until, backoff_level, last_error, status from public.channex_properties where org_id = $1', [ORG_A])).rows[0];
  const unpause = () => db.query(`update public.channex_properties set paused_until = now() - interval '1 second' where org_id = $1`, [ORG_A]);
  const quiet = () => db.query(`update public.channex_outbox set created_at = created_at - interval '10 seconds'`);

  await setDays('RP-TB', { '2027-01-05': { rate: 501 } }); await quiet();
  let t = await tick();
  assert.equal(t.ari.sent, 1, JSON.stringify(t)); // call 1: ok

  await setDays('RP-TB', { '2027-01-06': { rate: 502 } }); await quiet();
  const t0 = Date.now();
  t = await tick(); // call 2: 429
  let p = await prop();
  assert.equal(p.backoff_level, 1);
  const pause1 = Date.parse(p.paused_until) - t0;
  assert.ok(pause1 > 55000 && pause1 < 65000, 'first pause about 60 s: ' + pause1);
  assert.equal((await db.query(`select count(*)::int n from public.channex_outbox where org_id = $1 and claimed_at is null`, [ORG_A])).rows[0].n, 1, 'mark kept and released');

  await setDays('RP-TB', { '2027-01-07': { rate: 503 } }); await quiet(); // changed while paused
  const before = (await posts('/restrictions')).length;
  t = await tick();
  assert.equal((await posts('/restrictions')).length, before, 'nothing sent while paused');
  assert.ok(t.ari.waiting >= 1);

  // a second 429 in a row doubles the pause
  await control('config', { every429: 1 });
  await unpause();
  const t1 = Date.now();
  await tick();
  p = await prop();
  assert.equal(p.backoff_level, 2);
  const pause2 = Date.parse(p.paused_until) - t1;
  assert.ok(pause2 > 115000 && pause2 < 125000, 'second pause about 120 s: ' + pause2);

  // Channex is happy again: everything still pending goes in one call and the backoff resets
  await control('config', { every429: 0 });
  await unpause();
  await control('calls', null, 'DELETE');
  t = await tick();
  const items = await onlyCall('/restrictions');
  item(items, 'rate_plan_id', rp('RP-TB'), { date: '2027-01-06' }, { rate: '502.00' });
  item(items, 'rate_plan_id', rp('RP-TB'), { date: '2027-01-07' }, { rate: '503.00' });
  p = await prop();
  assert.equal(p.backoff_level, 0); assert.equal(p.paused_until, null); assert.equal(p.status, 'live');
  for (const [iso, rate] of [['2027-01-05', '501.00'], ['2027-01-06', '502.00'], ['2027-01-07', '503.00']]) assert.equal((await channexRestriction('RP-TB', iso)).rate, rate, 'no lost change on ' + iso);
  assert.equal((await db.query('select count(*)::int n from public.channex_outbox where org_id = $1', [ORG_A])).rows[0].n, 0);
  const statuses = (await db.query(`select http_status from public.channex_calls where org_id = $1 and endpoint = '/restrictions' and http_status = 429`, [ORG_A])).rows;
  assert.equal(statuses.length, 2, 'the 429s are in the call log');
});

test('5xx pauses a minute and keeps the marks; warnings become an alert; a 4xx stops with an alert until Retry', { skip: SKIP }, async () => {
  await control('config', { every5xx: 1 });
  await setDays('RP-DBB', { '2027-02-01': { rate: 250 } });
  let out = await flush();
  assert.equal(out.sent, 0);
  let p = (await db.query('select paused_until, status, last_error from public.channex_properties where org_id = $1', [ORG_A])).rows[0];
  assert.equal(p.status, 'live');
  const pause = Date.parse(p.paused_until) - Date.now();
  assert.ok(pause > 50000 && pause <= 60000, 'paused about a minute: ' + pause);
  await control('config', { every5xx: 0 });
  await db.query(`update public.channex_properties set paused_until = null where org_id = $1`, [ORG_A]);

  // Channex drops invalid items but answers 200 with meta.warnings: a rate of 0 -> rate_warning alert
  await setDays('RP-DBB', { '2027-02-02': { rate: 0 } });
  out = await flush();
  assert.equal(out.sent, 1);
  const alerts = (await db.query(`select kind, message from public.channex_alerts where org_id = $1 and kind = 'rate_warning'`, [ORG_A])).rows;
  assert.equal(alerts.length, 1); assert.match(alerts[0].message, /rate must be greater than 0/);
  assert.equal((await channexRestriction('RP-DBB', '2027-02-01')).rate, '250.00', 'the 5xx change arrived after all');

  // a real 4xx: Channex refuses the call itself (simulate with an unknown key)
  mock.ctl.apiKey = 'another-key';
  await setDays('RP-DBB', { '2027-02-03': { rate: 260 } });
  out = await flush();
  mock.ctl.apiKey = 'test-key';
  p = (await db.query('select status, last_error from public.channex_properties where org_id = $1', [ORG_A])).rows[0];
  assert.equal(p.status, 'error');
  assert.equal((await db.query(`select count(*)::int n from public.channex_alerts where org_id = $1 and kind = 'sync_error' and resolved_at is null`, [ORG_A])).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int n from public.channex_outbox where org_id = $1', [ORG_A])).rows[0].n, 1, 'mark kept for Retry');
  const r = await channex(opsUser, { action: 'retry', orgId: ORG_A, buildingId: 'BD-1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.property.status, 'live');
  assert.equal((await channexRestriction('RP-DBB', '2027-02-03')).rate, '260.00');
  assert.equal((await db.query(`select count(*)::int n from public.channex_alerts where org_id = $1 and kind = 'sync_error' and resolved_at is null`, [ORG_A])).rows[0].n, 0, 'alert resolved by Retry');
});

test('pause keeps marks building up; resume sends them', { skip: SKIP }, async () => {
  assert.equal((await channex(opsUser, { action: 'pause', orgId: ORG_A, buildingId: 'BD-1' })).status, 403, 'owner only');
  assert.equal((await channex(owner, { action: 'pause', orgId: ORG_A, buildingId: 'BD-1' })).json.property.status, 'paused');
  await setDays('RP-TBB', { '2027-03-01': { rate: 180 } });
  const out = await flush();
  assert.equal(out.sent, 0);
  assert.equal((await writes()).length, 0);
  assert.equal((await db.query('select count(*)::int n from public.channex_outbox where org_id = $1', [ORG_A])).rows[0].n, 1);
  const r = await channex(owner, { action: 'resume', orgId: ORG_A, buildingId: 'BD-1' });
  assert.equal(r.json.property.status, 'live');
  item(await onlyCall('/restrictions'), 'rate_plan_id', rp('RP-TBB'), { date: '2027-03-01' }, { rate: '180.00' });
});

test('setup queue: renaming a unit type and retagging a unit update Channex through the worker', { skip: SKIP }, async () => {
  await put(ORG_A, 'unitTypes', 'UT-D', { id: 'UT-D', buildingId: 'BD-1', name: 'Double Room Deluxe', maxGuests: 2, beds: 1, order: 2 });
  await put(ORG_A, 'properties', 'T-08', { id: 'T-08', name: 'Twin 8', buildingId: 'BD-1', unitTypeId: 'UT-D', unitNo: '21-8' });
  await db.query(`update public.channex_outbox set created_at = created_at - interval '10 seconds'`);
  const r = await api(workerApi, WORKER_SECRET, { task: 'tick' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const puts = (await calls()).filter((c) => c.method === 'PUT' && c.path.startsWith('/room_types/'));
  const s = await mockState();
  assert.equal(s.room_types[rt('UT-D')].title, 'Double Room Deluxe');
  assert.equal(s.room_types[rt('UT-D')].count_of_rooms, 5);
  assert.equal(s.room_types[rt('UT-T')].count_of_rooms, 7);
  assert.ok(puts.length >= 2 && puts.length <= 3, 'PUT per changed room type: ' + puts.length);
  assert.equal((await db.query('select count(*)::int n from public.channex_setup_queue')).rows[0].n, 0);
  // the retag moved a unit: both types' availability goes in one call
  const av = await posts('/availability');
  assert.equal(av.length, 1);
  assert.equal(s.availability[rt('UT-D')]['2026-12-30'], (await db.query(`select availability from public.channex_type_availability($1, 'UT-D', '2026-12-30', '2026-12-30')`, [ORG_A])).rows[0].availability);
});

test('worker endpoint: bearer secret required; nightly marks day 500 and prunes', { skip: SKIP }, async () => {
  assert.equal((await api(workerApi, null, { task: 'tick' })).status, 401);
  assert.equal((await api(workerApi, 'wrong-secret-wrong-secret-wrong', { task: 'tick' })).status, 401);
  assert.equal((await api(workerApi, WORKER_SECRET, { task: 'nope' })).status, 400);
  await db.query(`insert into public.channex_calls (org_id, endpoint, method, source, at) values ($1, '/old', 'GET', 'setup', now() - interval '61 days')`, [ORG_A]);
  // make day 500 differ from what Channex has, so the nightly delta has something to send
  await setDays('RP-TB', { [LAST]: { rate: 777 } });
  await db.query('delete from public.channex_outbox');
  await control('calls', null, 'DELETE');
  const r = await api(workerApi, WORKER_SECRET, { task: 'nightly' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.marked, 6, '2 room types + 4 rate plans');
  assert.equal(r.json.pruned.calls, 1, JSON.stringify(r.json));
  assert.equal((await posts('/restrictions')).length, 1, 'day 500 sent as a delta');
  item((await posts('/restrictions'))[0].body.values, 'rate_plan_id', rp('RP-TB'), { date: LAST }, { rate: '777.00' });
  assert.equal((await posts('/availability')).length, 0, 'availability on day 500 unchanged: nothing sent');
  assert.equal(r.json.tick.inbound.skipped, 'M6');
  assert.equal(r.json.reassign.skipped, 'M2/M6');
});

test('disconnect stops sending and clears marks; connecting again requests a full sync', { skip: SKIP }, async () => {
  const d = await channex(owner, { action: 'disconnect', orgId: ORG_A, buildingId: 'BD-1' });
  assert.equal(d.json.property.status, 'disconnected');
  await setDays('RP-TB', { '2027-04-01': { rate: 999 } });
  assert.equal((await db.query('select count(*)::int n from public.channex_outbox where org_id = $1', [ORG_A])).rows[0].n, 0, 'no marks while disconnected');
  const c = await channex(owner, { action: 'connect', orgId: ORG_A, buildingId: 'BD-1' });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal(c.json.property.status, 'live');
  assert.equal((await posts('/groups')).length + (await posts('/properties')).length + (await posts('/room_types')).length + (await posts('/rate_plans')).length, 0, 'mapping reused');
  assert.equal((await posts('/availability')).length, 1);
  assert.equal((await posts('/restrictions')).length, 1);
  assert.equal((await channexRestriction('RP-TB', '2027-04-01')).rate, '999.00');
});
