/* channexRequest against the in-memory mock (scripts/channex-mock.mjs): answers, error kinds, and the key never leaking. */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createMock } from '../../scripts/channex-mock.mjs';
import { channexRequest, channexConfig, ChannexError, errorKind, taskIds, warnings, logCall, STAGING_URL } from '../../api/_lib/channex.js';

const KEY = 'test-key-not-a-real-secret';
const mock = createMock({ apiKey: KEY, every429: 0, every5xx: 0, latencyMs: 0, rateLimits: false, signingSecret: '', webhookUrl: '' });
let cfg;
const call = (method, path, body, opts = {}) => channexRequest(method, path, body, Object.assign({ config: cfg }, opts));
const control = async (what, body) => (await fetch(cfg.baseUrl.replace(/\/api\/v1$/, '') + '/__mock/' + what, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })).json();

/** Run fn with console.error captured, so a test can check nothing secret is logged. */
async function quietly(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...a) => lines.push(a.map(String).join(' '));
  try { return { value: await fn(), lines }; } catch (e) { return { error: e, lines }; } finally { console.error = orig; }
}

before(async () => {
  const { apiUrl } = await mock.listen(0);
  cfg = Object.assign({}, channexConfig(), { key: KEY, baseUrl: apiUrl });
});
after(() => mock.close());
beforeEach(async () => { await control('reset'); await control('config', { every429: 0, every5xx: 0, latencyMs: 0 }); });

async function setupProperty() {
  const g = await call('POST', '/groups', { group: { title: 'Test org' } });
  const p = await call('POST', '/properties', { property: { title: 'Test Property', currency: 'USD', group_id: g.data.id, timezone: 'Asia/Kuala_Lumpur' } });
  const rt = await call('POST', '/room_types', { room_type: { property_id: p.data.id, title: 'Twin Room', count_of_rooms: 8, occ_adults: 2, occ_children: 0, occ_infants: 0 } });
  const rp = await call('POST', '/rate_plans', { rate_plan: { property_id: p.data.id, room_type_id: rt.data.id, title: 'Best Available Rate', options: [{ occupancy: 2, is_primary: true, rate: '100.00' }] } });
  return { group: g.data.id, property: p.data.id, roomType: rt.data.id, ratePlan: rp.data.id };
}

test('config: staging by default, app url derived from the base url', () => {
  const saved = { b: process.env.CHANNEX_BASE_URL, a: process.env.CHANNEX_APP_URL, k: process.env.CHANNEX_API_KEY, l: process.env.CHANNEX_ORG_ALLOWLIST };
  try {
    delete process.env.CHANNEX_BASE_URL; delete process.env.CHANNEX_APP_URL; delete process.env.CHANNEX_API_KEY;
    process.env.CHANNEX_ORG_ALLOWLIST = ' A1 ,b2,, ';
    let c = channexConfig();
    assert.equal(c.baseUrl, STAGING_URL);
    assert.equal(c.appUrl, 'https://staging.channex.io');
    assert.equal(c.env, 'staging');
    assert.equal(c.key, '');
    assert.deepEqual(c.orgAllowlist, ['a1', 'b2']);
    process.env.CHANNEX_BASE_URL = 'https://app.channex.io/api/v1/';
    c = channexConfig();
    assert.equal(c.baseUrl, 'https://app.channex.io/api/v1');
    assert.equal(c.appUrl, 'https://app.channex.io');
    assert.equal(c.env, 'production');
    process.env.CHANNEX_APP_URL = 'https://channels.example.com/';
    assert.equal(channexConfig().appUrl, 'https://channels.example.com');
  } finally {
    for (const [k, v] of [['CHANNEX_BASE_URL', saved.b], ['CHANNEX_APP_URL', saved.a], ['CHANNEX_API_KEY', saved.k], ['CHANNEX_ORG_ALLOWLIST', saved.l]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('errorKind sorts statuses', () => {
  assert.equal(errorKind(429), 'rate_limited');
  for (const s of [0, 500, 502, 503, 504]) assert.equal(errorKind(s), 'retryable');
  for (const s of [400, 401, 403, 404, 422]) assert.equal(errorKind(s), 'invalid');
});

test('a successful call returns status, data and meta, and sends the key as user-api-key', async () => {
  const ids = await setupProperty();
  const res = await call('GET', '/room_types', null, { query: { 'filter[property_id]': ids.property } });
  assert.equal(res.status, 200);
  assert.equal(res.data.length, 1);
  assert.equal(res.data[0].attributes.title, 'Twin Room');
  assert.equal(res.meta.total, 1);
  const seen = mock.db.calls.find((c) => c.path === '/room_types' && c.method === 'GET');
  assert.equal(seen.query['filter[property_id]'], ids.property);
});

test('ARI answers carry task ids and warnings for dropped items', async () => {
  const ids = await setupProperty();
  const res = await call('POST', '/restrictions', { values: [
    { property_id: ids.property, rate_plan_id: ids.ratePlan, date: '2026-11-22', rate: '333.00' },
    { property_id: ids.property, rate_plan_id: ids.ratePlan, date_from: '2026-11-01', date_to: '2026-11-03', rate: 0 }
  ] });
  assert.equal(res.status, 200);
  assert.equal(taskIds(res).length, 1);
  assert.match(taskIds(res)[0], /^[0-9a-f-]{36}$/);
  assert.equal(warnings(res).length, 1);
  assert.deepEqual(warnings(res)[0].warning, { rate: ['must be greater than 0'] });
  const got = await call('GET', '/restrictions', null, { query: { 'filter[property_id]': ids.property, 'filter[date][gte]': '2026-11-01', 'filter[date][lte]': '2026-11-30' } });
  assert.deepEqual(got.data[ids.ratePlan], { '2026-11-22': { rate: '333.00' } });

  const av = await call('POST', '/availability', { values: [{ property_id: ids.property, room_type_id: ids.roomType, date_from: '2026-11-10', date_to: '2026-11-16', availability: 3 }] });
  assert.equal(taskIds(av).length, 1);
  assert.equal(warnings(av).length, 0);
  const a = await call('GET', '/availability', null, { query: { 'filter[property_id]': ids.property } });
  assert.equal(Object.keys(a.data[ids.roomType]).length, 7);
  assert.equal(a.data[ids.roomType]['2026-11-16'], 3);
});

test('429 is rate_limited', async () => {
  await control('config', { every429: 1 });
  const { error } = await quietly(() => call('POST', '/availability', { values: [] }));
  assert.ok(error instanceof ChannexError);
  assert.equal(error.kind, 'rate_limited');
  assert.equal(error.status, 429);
  assert.equal(error.code, 'http_too_many_requests');
  assert.equal(error.retryable, true);
});

test('5xx is retryable', async () => {
  await control('config', { every5xx: 1 });
  const { error } = await quietly(() => call('GET', '/properties'));
  assert.equal(error.kind, 'retryable');
  assert.equal(error.status, 503);
});

test('every n-th call fails with MOCK_429_EVERY', async () => {
  await control('config', { every429: 3 });
  const kinds = [];
  for (let i = 0; i < 6; i++) {
    const { error } = await quietly(() => call('GET', '/groups'));
    kinds.push(error ? error.kind : 'ok');
  }
  assert.deepEqual(kinds, ['ok', 'ok', 'rate_limited', 'ok', 'ok', 'rate_limited']);
});

test('4xx is invalid, with Channex validation details in the message', async () => {
  const { error } = await quietly(() => call('POST', '/room_types', { room_type: { title: 'No property' } }));
  assert.equal(error.kind, 'invalid');
  assert.equal(error.status, 422);
  assert.equal(error.code, 'validation_error');
  assert.match(error.message, /property_id can't be blank/);
  assert.equal(error.retryable, false);

  const nf = (await quietly(() => call('GET', '/properties/00000000-0000-0000-0000-000000000000'))).error;
  assert.equal(nf.kind, 'invalid');
  assert.equal(nf.status, 404);

  const ids = await setupProperty();
  const taken = (await quietly(() => call('POST', '/room_types', { room_type: { property_id: ids.property, title: 'Twin Room', count_of_rooms: 1, occ_adults: 2, occ_children: 0, occ_infants: 0 } }))).error;
  assert.equal(taken.status, 422);
  assert.match(taken.message, /title has already been taken/);
});

test('a wrong key is invalid (401) and the key is never in the error or the log', async () => {
  const wrong = Object.assign({}, cfg, { key: 'wrong-key-value-123' });
  const { error, lines } = await quietly(() => channexRequest('GET', '/properties', null, { config: wrong }));
  assert.equal(error.kind, 'invalid');
  assert.equal(error.status, 401);
  const everything = JSON.stringify({ m: error.message, e: error.errors, s: error.stack, lines });
  assert.ok(!everything.includes('wrong-key-value-123'));
});

test('no key configured: invalid, nothing sent', async () => {
  const before = mock.db.calls.length;
  const { error } = await quietly(() => channexRequest('GET', '/properties', null, { config: Object.assign({}, cfg, { key: '' }) }));
  assert.equal(error.kind, 'invalid');
  assert.equal(error.code, 'not_configured');
  assert.equal(mock.db.calls.length, before);
});

test('a slow answer times out as retryable', async () => {
  await control('config', { latencyMs: 400 });
  const t0 = Date.now();
  const { error } = await quietly(() => call('GET', '/groups', null, { timeoutMs: 100 }));
  assert.equal(error.kind, 'retryable');
  assert.equal(error.code, 'timeout');
  assert.ok(Date.now() - t0 < 350, 'gave up at the timeout');
});

test('nobody listening is retryable (network)', async () => {
  const srv = http.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await new Promise((r) => srv.close(r));
  const { error, lines } = await quietly(() => channexRequest('GET', '/groups', null, { config: Object.assign({}, cfg, { baseUrl: `http://127.0.0.1:${port}/api/v1` }) }));
  assert.equal(error.kind, 'retryable');
  assert.equal(error.code, 'network');
  assert.ok(!lines.join('\n').includes(KEY));
});

test('a non-JSON error page still classifies', async () => {
  const srv = http.createServer((req, res) => { res.statusCode = 502; res.setHeader('Content-Type', 'text/html'); res.end('<html>Bad gateway</html>'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const { error } = await quietly(() => channexRequest('GET', '/groups', null, { config: Object.assign({}, cfg, { baseUrl: `http://127.0.0.1:${srv.address().port}/api/v1` }) }));
    assert.equal(error.kind, 'retryable');
    assert.equal(error.status, 502);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('logCall shapes a channex_calls row without the key', async () => {
  const row = await logCall(null, { orgId: 'o1', propertyId: 'p1', endpoint: '/restrictions', method: 'post', source: 'delta', itemCount: 3, status: 200, taskIds: ['t1'], warnings: [], durationMs: 12.4 });
  assert.equal(row.method, 'POST');
  assert.equal(row.source, 'delta');
  assert.deepEqual(row.task_ids, ['t1']);
  assert.equal(row.warnings, null);
  assert.equal(row.duration_ms, 12);
  assert.equal((await logCall(null, { source: 'nonsense' })).source, null);
});
