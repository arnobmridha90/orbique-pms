/* The bell's notifications as phone notifications (api/_lib/notify-push.js, migration 0033): which phones get a row,
 * what it says, the tone and channel, claiming and sending. No network: a fake fetch and a fake Supabase client.
 *
 *   node --test tests/notify_push.test.mjs
 */
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { fakeSb, op } from './inbox/fake-sb.mjs';
import { KINDS, pushText, wants, toneFor, message, processNotifyPush, QUIET_CHANNEL, GROUP_TONE } from '../api/_lib/notify-push.js';
import { pushConfig, resetTokenCache } from '../api/_lib/alerts.js';
import { notifyPrefs } from '../api/alerts.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const ME = '00000000-0000-4000-8000-0000000000aa', HK = '00000000-0000-4000-8000-0000000000bb';
const ALL = Object.keys(KINDS);
const owner = (extra) => Object.assign({ token: 'tok-owner', user_id: ME, booking_alerts: true, tones: null, notify: { kinds: ALL, quiet: [], allTasks: true, staff: 'S1' } }, extra || {});
const cleaner = (extra) => Object.assign({ token: 'tok-hk', user_id: HK, booking_alerts: false, tones: null, notify: { kinds: ['task_new', 'task_assigned', 'team_msg'], quiet: [], allTasks: false, staff: 'S2' } }, extra || {});
const staffOf = new Map([[ME, 'S1'], [HK, 'S2']]);

test('the server knows every kind the bell shows, with the same group', () => {
  const src = fs.readFileSync(new URL('../app/server/notify.js', import.meta.url), 'utf8');
  const client = {};
  for (const m of src.matchAll(/^\s{4}([a-z_]+): \['([a-z]+)', '[^']*', '((?:[^'\\]|\\.)*)'/gm)) client[m[1]] = [m[2], m[3]];
  assert.ok(Object.keys(client).length >= 50, 'read the bell kinds');
  assert.deepEqual(Object.keys(KINDS).sort(), Object.keys(client).sort());
  for (const k of Object.keys(client)) { assert.equal(KINDS[k][0], client[k][0], k); assert.equal(KINDS[k][2], client[k][1], k); }
  for (const g of new Set(Object.values(KINDS).map((x) => x[0]))) assert.ok(GROUP_TONE[g], g);
});

test('what the phone shows', () => {
  const ctx = { units: new Map([['P1', { id: 'P1', short: '41-1' }], ['P2', { id: 'P2', short: '47-7' }]]), staff: new Map([['S2', { id: 'S2', name: 'Siti' }]]) };
  assert.deepEqual(pushText({ kind: 'bk_new', vars: { guest: 'Li Yinghe', unit: 'P1', in: '2026-12-01', out: '2026-12-03', total: 640, ch: 'airbnb' } }, ctx),
    { title: '🛎️ New booking: Li Yinghe', body: '41-1 · 1 Dec to 3 Dec · RM640 · Airbnb' });
  assert.deepEqual(pushText({ kind: 'bk_moved', vars: { guest: 'Ana', unit: 'P2', oldUnit: 'P1', in: '2026-12-01', out: '2026-12-02' } }, ctx),
    { title: '🔀 Moved to another unit: Ana', body: '41-1 → 47-7 · 1 Dec to 2 Dec' });
  assert.equal(pushText({ kind: 'task_done', vars: { title: 'Clean 41-1', unit: 'P1', doneBy: 'S2' } }, ctx).body, '41-1 · by Siti');
  assert.equal(pushText({ kind: 'gst_msg', vars: { guest: 'Ana', count: 3, unit: 'P1', text: 'Hi!' } }, ctx).title, '💬 3 new messages from Ana');
  assert.equal(pushText({ kind: 'bk_cancelled', vars: {} }, ctx).title, '❌ Booking cancelled: Guest');
  assert.equal(pushText({ kind: 'rates_changed', vars: {}, actor_staff: 'S2' }, ctx).title, '🏷️ Prices changed by Siti');
  assert.equal(pushText({ kind: 'what_is_this', vars: {} }, ctx).title, '🔔 Something changed');
});

test('which phones get a row', () => {
  const row = (extra) => Object.assign({ id: 1, kind: 'bk_edit', vars: {}, actor: null, staff: null }, extra);
  assert.equal(wants(owner(), row(), staffOf), true);
  assert.equal(wants(owner({ notify: null }), row(), staffOf), false, 'not signed up for bell notifications');
  assert.equal(wants(owner(), row({ actor: ME }), staffOf), false, 'your own change');
  assert.equal(wants(owner(), row({ kind: 'bk_new' }), staffOf), false, 'a booking alert already rang on this phone');
  assert.equal(wants(owner({ booking_alerts: false }), row({ kind: 'bk_new' }), staffOf), true);
  assert.equal(wants(owner(), row({ kind: 'bk_new', actor: HK }), staffOf), true, 'a booking the team entered');
  assert.equal(wants(owner(), row({ kind: 'team_msg', staff: ['S1'] }), staffOf), false, 'Team chat has its own');
  assert.equal(wants(cleaner(), row(), staffOf), false, 'access does not cover bookings');
  assert.equal(wants(cleaner(), row({ kind: 'task_new', vars: { to: ['S2'] } }), staffOf), true);
  assert.equal(wants(cleaner(), row({ kind: 'task_new', vars: { to: ['S9'] } }), staffOf), false, 'someone else\'s task');
  assert.equal(wants(owner(), row({ kind: 'task_new', vars: { to: ['S9'] } }), staffOf), true, 'sees every task');
  assert.equal(wants(owner(), row({ kind: 'sys_health', staff: ['S2'] }), staffOf), false, 'only for these people');
});

test('tone and channel: the group\'s tune on this phone, muted groups on the quiet channel', () => {
  assert.deepEqual(toneFor(owner(), { kind: 'bk_edit' }), { channel: 'alerts_change', sound: 'orbique_change' });
  assert.deepEqual(toneFor(owner(), { kind: 'gst_msg' }), { channel: 'alerts_message', sound: 'orbique_message' });
  assert.deepEqual(toneFor(owner(), { kind: 'task_overdue' }), { channel: 'alerts_task', sound: 'orbique_task' });
  assert.deepEqual(toneFor(owner({ tones: { task: 'urgent' } }), { kind: 'task_overdue' }), { channel: 'tone_task_urgent', sound: 'orbique_urgent' });
  assert.deepEqual(toneFor(owner({ notify: { kinds: ALL, quiet: ['tasks'] } }), { kind: 'task_overdue' }), { channel: QUIET_CHANNEL, sound: null });
  const m = message('t', owner({ notify: { kinds: ALL, quiet: ['tasks'] } }), { id: 5, kind: 'task_new', ref: { task: 'T1' } }, { title: 'x', body: 'y' });
  assert.equal(m.android.notification.sound, undefined);
  assert.equal(m.data.kind, 'bell');
  assert.equal(m.data.taskId, 'T1');
  assert.equal(m.android.notification.tag, 'n-5');
});

test('the phone\'s choices are cleaned', () => {
  assert.deepEqual(notifyPrefs({ kinds: ['bk_new', 'nope', 'bk_new', 5], quiet: ['tasks', 'x'], allTasks: 'yes' }, 'S1'), { kinds: ['bk_new'], quiet: ['tasks'], allTasks: false, staff: 'S1' });
});

test('claims the rows, sends each to the right phones, never twice', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const cfg = pushConfig({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'p', client_email: 'a@p.iam', private_key: privateKey }) });
  resetTokenCache();
  const now = Date.now(), iso = new Date(now).toISOString();
  const rows = [
    { id: 11, org_id: ORG, kind: 'task_new', vars: { title: 'Clean', to: ['S2'] }, ref: {}, actor: ME, actor_staff: 'S1', staff: null, created_at: iso },
    { id: 12, org_id: ORG, kind: 'bk_paid', vars: { guest: 'Ana', total: 300 }, ref: { booking: 'B1' }, actor: null, staff: null, created_at: iso },
    { id: 13, org_id: ORG, kind: 'bk_paid', vars: {}, ref: {}, actor: null, staff: null, created_at: new Date(now - 3600e3).toISOString() }
  ];
  let claimedIds = null;
  const sb = fakeSb({ handler: (table, ops) => {
    if (table === 'notifications' && ops[0][0] === 'select') return { data: rows.map((r) => ({ id: r.id })), error: null };
    if (table === 'notifications' && ops[0][0] === 'update') { claimedIds = op(ops, 'in', 'id'); assert.ok(op(ops, 'is', 'pushed_at') === null); return { data: rows, error: null }; }
    if (table === 'records') return { data: [], error: null };
    if (table === 'members') return { data: [{ user_id: ME, staff_id: 'S1', status: 'active' }, { user_id: HK, staff_id: 'S2', status: 'active' }], error: null };
    if (table === 'push_devices') return { data: [owner(), cleaner()], error: null };
    return { data: null, error: null };
  } });
  const sent = [];
  const fetch = async (url, init) => {
    if (/token/.test(url)) return { status: 200, ok: true, json: async () => ({ access_token: 'at', expires_in: 3600 }) };
    sent.push(JSON.parse(init.body).message);
    return { status: 200, ok: true, json: async () => ({ name: 'm' }) };
  };
  const r = await processNotifyPush(sb, { pushConfig: cfg, fetch, now });
  assert.deepEqual(claimedIds, [11, 12, 13]);
  assert.deepEqual(r, { rows: 3, sent: 2, skipped: 1, failed: 0 });
  assert.deepEqual(sent.map((m) => [m.token, m.notification.title]), [['tok-hk', '🧹 New task: Clean'], ['tok-owner', '💰 Payment received: Ana']]);
  assert.equal(sent[1].data.bookingId, 'B1');
});

test('nothing to send: one cheap query', async () => {
  const sb = fakeSb({ handler: () => ({ data: [], error: null }) });
  assert.deepEqual(await processNotifyPush(sb, {}), { rows: 0, sent: 0, skipped: 0, failed: 0 });
  assert.equal(sb.calls.length, 1);
});
