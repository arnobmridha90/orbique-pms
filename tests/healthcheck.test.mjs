/* System health (api/_lib/healthcheck.js, /api/alerts 'health', migration 0027): the checks say what is wrong in plain English,
 * the safe fixes only run when switched on and are logged, and the watch warns the owner once per new set of red items.
 *
 *   node --test tests/healthcheck.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runHealth, autoFix, applyFix, healthSettings, saveHealthSettings, healthLog, watchHealth, WATCH_EVERY_MS } from '../api/_lib/healthcheck.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const NOW = Date.parse('2026-11-18T12:00:00Z');
const MIN = 60000, HOUR = 3600000;
const iso = (agoMs) => new Date(NOW - agoMs).toISOString();

/* a small stand-in for the Supabase client: tables as arrays, filters eq / is / lt / gt / not / or (or is not applied), update, upsert, rpc */
function fake(tables, rpcs = {}) {
  const T = JSON.parse(JSON.stringify(tables));
  const get = (r, k) => (k.startsWith('data->>') ? (r.data || {})[k.slice(7)] : r[k]);
  function from(name) {
    T[name] = T[name] || [];
    const f = [];
    let patch = null, orderKey = null, orderAsc = true, lim = Infinity, rng = null, upsertRow = null;
    const q = {
      select() { return q; },
      eq(k, v) { f.push((r) => get(r, k) === v); return q; },
      is(k, v) { f.push((r) => (v === null ? get(r, k) == null : get(r, k) === v)); return q; },
      lt(k, v) { f.push((r) => get(r, k) != null && String(get(r, k)) < String(v)); return q; },
      gt(k, v) { f.push((r) => get(r, k) != null && (typeof get(r, k) === 'number' ? get(r, k) > v : String(get(r, k)) > String(v))); return q; },
      not(k, op, v) { f.push((r) => !(get(r, k) == null && v === null)); return q; },
      or() { return q; },
      order(k, o) { orderKey = k; orderAsc = !(o && o.ascending === false); return q; },
      limit(n) { lim = n; return q; },
      range(a, b) { rng = [a, b]; return q; },
      update(p) { patch = p; return q; },
      upsert(row) { upsertRow = row; return q; },
      maybeSingle() { return run().then((r) => ({ data: r.data && r.data[0] ? r.data[0] : null, error: null })); },
      then(res, rej) { return run().then(res, rej); }
    };
    async function run() {
      if (upsertRow) {
        const keyOf = (r) => [r.org_id, r.key].join('|');
        const i = T[name].findIndex((r) => keyOf(r) === keyOf(upsertRow));
        if (i >= 0) T[name][i] = Object.assign({}, T[name][i], upsertRow); else T[name].push(Object.assign({}, upsertRow));
        return { data: null, error: null };
      }
      let rows = T[name].filter((r) => f.every((fn) => fn(r)));
      if (patch) { rows.forEach((r) => Object.assign(r, patch)); return { data: rows.map((r) => Object.assign({}, r)), error: null }; }
      if (orderKey) rows = rows.slice().sort((a, b) => (String(a[orderKey]) < String(b[orderKey]) ? -1 : 1) * (orderAsc ? 1 : -1));
      if (rng) rows = rows.slice(rng[0], rng[1] + 1);
      return { data: rows.slice(0, lim).map((r) => Object.assign({}, r)), error: null };
    }
    return q;
  }
  return { T, from, rpc: (n) => Promise.resolve(rpcs[n] ? { data: rpcs[n], error: null } : { data: null, error: { message: 'not found' } }) };
}

const blobRow = (key, v) => ({ org_id: ORG, key, data: { v } });
const okFetch = (domains) => async (url) => {
  if (String(url).includes('resend.com')) return { ok: true, status: 200, json: async () => ({ data: domains }) };
  return { ok: true, status: 200, json: async () => ({}) };
};
const env = { RESEND_API_KEY: 're_x', ALERT_EMAIL_FROM: 'Orbique <a@b.co>', ANTHROPIC_API_KEY: 'sk-ant-abc123', VERCEL_GIT_COMMIT_SHA: 'abcdef1234' };
const cron = [
  { jobname: 'channex-tick', schedule: '* * * * *', active: true, last_start: iso(30000), last_status: 'succeeded', last_end: iso(29000) },
  { jobname: 'channex-nightly', schedule: '0 19 * * *', active: true, last_start: iso(10 * HOUR), last_status: 'succeeded', last_end: iso(10 * HOUR) }
];
const healthy = () => ({
  channex_properties: [{ org_id: ORG, channex_property_id: 'P1', status: 'live', paused_until: null, backoff_level: 0, last_error: null, last_error_at: null, lease_until: null, updated_at: iso(MIN), channels: [{ id: 'c1', title: 'Airbnb - Vortex', channel: 'Airbnb', isActive: true }] }],
  channex_outbox: [], channex_alerts: [], inbound_emails: [{ org_id: ORG, received_at: iso(2 * HOUR), status: 'done', error: null }],
  inbound_addresses: [{ org_id: ORG, address: 'hello@x.co' }], alert_outbox: [], push_devices: [{ org_id: ORG, token: 't', booking_alerts: true }],
  whatsapp_numbers: [], team_message_translations: [{ created_at: iso(HOUR) }], blobs: [blobRow('alertSettings', { emails: ['owner@x.co'] })],
  records: []
});
const find = (rep, id) => rep.items.find((i) => i.id === id);
const run = (sb, extra = {}) => runHealth(sb, ORG, Object.assign({ now: NOW, env, fetch: okFetch([{ name: 'staykozi.com', status: 'verified' }]) }, extra));

test('a healthy workspace is green; unset-up parts are grey, not red', async () => {
  const rep = await run(fake(healthy(), { health_cron: cron, health_net: [{ status_code: 200, created: iso(30000), timed_out: false }] }));
  assert.equal(rep.overall, 'ok', JSON.stringify(rep.items.filter((i) => i.status !== 'ok' && i.status !== 'off')));
  assert.equal(find(rep, 'job-tick').status, 'ok');
  assert.equal(find(rep, 'domain-staykozi.com').status, 'ok');
  assert.equal(find(rep, 'stripe').status, 'off');
  assert.equal(find(rep, 'whatsapp').status, 'off');
  assert.equal(find(rep, 'translate').status, 'ok');
});

test('every kind of break shows as its own red or amber row, in plain English', async () => {
  const t = healthy();
  t.channex_outbox = [{ org_id: ORG, id: 1, created_at: iso(HOUR), claimed_at: iso(40 * MIN) }];
  t.channex_alerts = [{ org_id: ORG, kind: 'rate_warning', message: 'x', resolved_at: null }];
  t.inbound_emails = [{ org_id: ORG, received_at: iso(120 * HOUR), status: 'done', error: null }];
  t.alert_outbox = [{ org_id: ORG, id: 1, created_at: iso(HOUR), next_at: iso(50 * MIN), finished_at: null }];
  t.records = [{ org_id: ORG, coll: 'journeySent', id: 'BK1:welcome', deleted: false, data: { id: 'BK1:welcome', state: 'failed', at: '2026-11-17T10:00', error: 'The email service refused it' } }];
  const sb = fake(t, { health_cron: [Object.assign({}, cron[0], { last_start: iso(20 * MIN) }), cron[1]], health_net: [{ status_code: 500, created: iso(MIN), timed_out: false }] });
  const rep = await run(sb, { fetch: okFetch([{ name: 'staykozi.com', status: 'failed' }]), env: Object.assign({}, env, { ANTHROPIC_API_KEY: 'sk-ant bad key' }) });
  assert.equal(rep.overall, 'bad');
  assert.equal(find(rep, 'job-tick').status, 'bad');
  assert.equal(find(rep, 'worker-answers').status, 'bad');
  assert.equal(find(rep, 'queue').status, 'warn');
  assert.equal(find(rep, 'queue').fix, 'unstick-queue');
  assert.match(find(rep, 'sync-alerts').detail, /rate_warning|rates or availability a booking site refused/);
  assert.equal(find(rep, 'mail-in').status, 'bad');
  assert.equal(find(rep, 'domain-staykozi.com').status, 'bad');
  assert.equal(find(rep, 'timed').status, 'bad');
  assert.match(find(rep, 'timed').detail, /email service refused/);
  assert.equal(find(rep, 'alerts').fix, 'retry-alerts');
  assert.equal(find(rep, 'translate').status, 'bad');
});

test('a check that breaks becomes a red row, never a crash', async () => {
  const sb = fake(healthy());
  const bad = await run(sb, { fetch: async () => { throw new Error('boom'); } });
  assert.equal(find(bad, 'check-resend').status, 'bad');
  assert.match(find(bad, 'check-resend').detail, /could not run/);
  assert.ok(bad.items.length > 5);
});

test('safe fixes run only when switched on, change only stale items, and are logged', async () => {
  const t = healthy();
  t.channex_outbox = [{ org_id: ORG, id: 1, created_at: iso(HOUR), claimed_at: iso(40 * MIN) }, { org_id: ORG, id: 2, created_at: iso(MIN), claimed_at: iso(MIN) }];
  const sb = fake(t);
  const items = [{ id: 'queue', fix: 'unstick-queue' }];
  assert.deepEqual((await healthSettings(sb, ORG)).auto, { 'unstick-queue': true, 'clear-pause': true, 'retry-alerts': true });
  await saveHealthSettings(sb, ORG, { auto: { 'unstick-queue': false } });
  assert.deepEqual(await autoFix(sb, ORG, items, { now: NOW }), []);
  assert.equal(sb.T.channex_outbox[0].claimed_at, iso(40 * MIN), 'switched off: untouched');
  await saveHealthSettings(sb, ORG, { auto: { 'unstick-queue': true } });
  const done = await autoFix(sb, ORG, items, { now: NOW });
  assert.equal(done.length, 1);
  assert.equal(sb.T.channex_outbox[0].claimed_at, null);
  assert.equal(sb.T.channex_outbox[1].claimed_at, iso(MIN), 'a recent lock is left alone');
  const log = await healthLog(sb, ORG);
  assert.equal(log.length, 1);
  assert.match(log[0].detail, /automatic/);
  await applyFix(sb, ORG, 'retry-alerts', { now: NOW });
  await assert.rejects(() => applyFix(sb, ORG, 'send-guest-messages', { now: NOW }), /Unknown fix/);
});

test('the watch tells the owner once about newly red items, and not again until the set changes', async () => {
  const cron = [{ jobname: 'channex-tick', active: true, last_start: iso(-60 * MIN), last_status: 'succeeded' }, { jobname: 'channex-nightly', active: true, last_start: iso(-60 * MIN), last_status: 'succeeded' }]; // fresh for the whole test
  const t = healthy();
  t.inbound_emails = [{ org_id: ORG, received_at: iso(120 * HOUR), status: 'done', error: null }];
  const sb = fake(t, { health_cron: cron, health_net: [{ status_code: 200, created: iso(1000), timed_out: false }] });
  const sent = [];
  const opts = { now: NOW, env, fetch: okFetch([{ name: 'a.co', status: 'verified' }]), sendEmail: async (c, to, msg) => { sent.push(['email', to, msg.title]); return 'sent'; }, sendPush: async (s, c, o, msg) => { sent.push(['push', msg.title]); return 'sent'; } };
  const r1 = await watchHealth(sb, opts);
  assert.equal(r1.checked, 1);
  assert.equal(r1.alerted, 1);
  assert.equal(sent.filter((s) => s[0] === 'email').length, 1);
  assert.deepEqual(sent[0][1], ['owner@x.co']);
  // within 15 minutes: not even checked again
  const r2 = await watchHealth(sb, Object.assign({}, opts, { now: NOW + 5 * MIN }));
  assert.equal(r2.checked, 0);
  // later, same red set: checked, but the owner is not told twice
  const r3 = await watchHealth(sb, Object.assign({}, opts, { now: NOW + WATCH_EVERY_MS + MIN }));
  assert.equal(r3.checked, 1);
  assert.equal(r3.alerted, 0);
  // a failed send is retried next time instead of being forgotten
  const t2 = healthy();
  t2.inbound_emails = [{ org_id: ORG, received_at: iso(120 * HOUR), status: 'done', error: null }];
  const sb2 = fake(t2, { health_cron: cron, health_net: [] });
  const failing = Object.assign({}, opts, { sendEmail: async () => 'failed: no', sendPush: async () => 'skipped: none' });
  assert.equal((await watchHealth(sb2, failing)).alerted, 0);
  assert.equal((await watchHealth(sb2, Object.assign({}, opts, { now: NOW + WATCH_EVERY_MS + MIN }))).alerted, 1);
  // switched off by the owner: no message
  const sb3 = fake(Object.assign(healthy(), { inbound_emails: [{ org_id: ORG, received_at: iso(120 * HOUR), status: 'done', error: null }] }), { health_cron: cron, health_net: [] });
  await saveHealthSettings(sb3, ORG, { alert: false });
  assert.equal((await watchHealth(sb3, opts)).alerted, 0);
});
