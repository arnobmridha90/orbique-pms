#!/usr/bin/env node
/* The server side of tests/e2e_channex.py: everything the Orbique app needs to run in live channel mode on this
 * machine, with nothing leaving it.
 *
 *   CHANNEX_TEST_PGURL=postgres://postgres@127.0.0.1:54329/postgres POSTGREST_BIN=/path/to/postgrest \
 *     node tests/channex/helpers/e2e-stack.mjs --out /tmp/e2e-channex
 *
 * Starts the Channex mock (scripts/channex-mock.mjs), a throwaway Supabase (local-supabase.mjs: Postgres + PostgREST
 * + a small auth gateway), seeds the certification workspace (plan section 7: "Test Property - Orbique", USD, Twin Room
 * 8 units, Double Room 4 units, bookings and blocks so availability varies, a hold on D-01 17-24 Nov), and serves the
 * production build with the api/ functions through scripts/dev.mjs. Rate plans are left for the test to create in the UI.
 *
 * Prints one JSON line {app, mock, control, org, users} when ready, then serves until stdin closes or SIGTERM.
 * Control endpoints (test only), all JSON:
 *   POST /reset        clear the mock's call list and age channex_calls by 2 minutes (the 9/min limiter)
 *   GET  /calls        the mock's calls since the last reset (writes only)
 *   GET  /state        the mock's stored availability and restrictions
 *   GET  /ids          rate plans and room types with their Channex ids
 *   GET  /outbox       waiting marks
 *   POST /ota-booking  {id, ...booking}  a platform booking as the channel manager would store it
 *   GET  /booking?id=  a booking record as saved
 *   POST /alert        {kind, message, ref}  an open channel manager alert;  GET /alerts  every alert
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createMock } from '../../../scripts/channex-mock.mjs';
import { startLocalSupabase } from './local-supabase.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const OUT = path.resolve(arg('--out', path.join(ROOT, '.e2e-channex')));
const TODAY = '2026-10-15';
const ORG = 'eeeeeeee-0000-4000-8000-00000000e2e1';
const PW = { owner: 'Cert-owner-2026', ops: 'Cert-ops-2026', frontdesk: 'Cert-desk-2026' };

const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const freePort = () => new Promise((resolve, reject) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });

fs.mkdirSync(OUT, { recursive: true });
const mock = createMock({ apiKey: 'test-key', every429: 0, every5xx: 0, latencyMs: 0, rateLimits: false, signingSecret: '', webhookUrl: '' });
const m = await mock.listen(0);
const env = await startLocalSupabase({ dbName: 'orbique_channex_e2e', today: TODAY });
const db = env.db;

async function put(coll, id, data) {
  await db.query(`insert into public.records (org_id, coll, id, data) values ($1, $2, $3, $4)
                  on conflict (org_id, coll, id) do update set data = excluded.data, deleted = false`, [ORG, coll, id, data]);
}

/* ---------- seed ---------- */
await db.query('insert into public.orgs (id, name) values ($1, $2)', [ORG, 'Orbique Cert Hotels']);
const users = {};
for (const [role, staff, name, email] of [['owner', 's1', 'Olivia Owner', 'owner@cert.test'], ['ops', 's2', 'Oscar Ops', 'ops@cert.test'], ['frontdesk', 's3', 'Farah Desk', 'desk@cert.test']]) {
  const u = await env.addUser(email, { name }, { password: PW[role] });
  await db.query('insert into public.members (org_id, user_id, staff_id, role) values ($1, $2, $3, $4)', [ORG, u.id, staff, role]);
  await put('staff', staff, { id: staff, name, initials: name.split(' ').map((w) => w[0]).join(''), role, roleLabel: { owner: 'Account owner', ops: 'Ops manager', frontdesk: 'Front desk' }[role], phone: '+60 12-000 000' + staff.slice(1), email });
  users[role] = { email, password: PW[role] };
}
{ /* a platform admin exists, so the sign-in screen is not the first-run "Set up Orbique" */
  const admin = await env.addUser('admin@cert.test', { name: 'Platform Admin' });
  await db.query('insert into public.platform_admins (user_id) values ($1)', [admin.id]);
}
await db.query(`insert into public.blobs (org_id, key, data) values ($1, 'workspaceMeta', $2)`, [ORG, { v: { storyDate: TODAY, demo: false, startedAt: TODAY + 'T09:00:00.000Z' } }]);
await put('buildings', 'BD-1', { id: 'BD-1', name: 'Test Property - Orbique', address: '1 Jalan Ujian', city: 'Kuala Lumpur', state: 'WP Kuala Lumpur', zip: '50450', country: 'MY', currency: 'USD', propertyType: 'apartment', email: 'ops@cert.test', checkInTime: '15:00', checkOutTime: '11:00', createdAt: '2026-10-01T09:00' });
await put('unitTypes', 'UT-T', { id: 'UT-T', buildingId: 'BD-1', name: 'Twin Room', maxGuests: 2, beds: 2, order: 1, createdAt: '2026-10-01T09:05' });
await put('unitTypes', 'UT-D', { id: 'UT-D', buildingId: 'BD-1', name: 'Double Room', maxGuests: 2, beds: 1, order: 2, createdAt: '2026-10-01T09:06' });
const unit = (id, no, type, base) => ({ id, name: 'Test Property ' + no, short: 'TP ' + no, type: 'Hotel room', beds: 1, maxGuests: 2, area: 'Bukit Bintang, Kuala Lumpur', city: 'Kuala Lumpur', address: 'Room ' + no + ', 1 Jalan Ujian', base, owner: 'Orbique Cert Hotels', lockCode: '1234', lockBrand: 'Igloohome', wifi: ['TestWifi', 'test1234'], parking: 'Street', checkInTime: '15:00', checkOutTime: '11:00', buildingId: 'BD-1', unitTypeId: type, unitNo: no, createdAt: '2026-10-01T09:10' });
for (let i = 1; i <= 8; i++) await put('properties', `T-0${i}`, unit(`T-0${i}`, `T-0${i}`, 'UT-T', 100));
for (let i = 1; i <= 4; i++) await put('properties', `D-0${i}`, unit(`D-0${i}`, `D-0${i}`, 'UT-D', 115));
/* bookings outside 5-27 Nov so the full sync has availability that varies; none inside the certification window */
let n = 0;
const booking = (id, propertyId, typeId, ci, nights, name) => ({
  id, propertyId, unitTypeId: typeId, checkIn: ci, checkOut: addDays(ci, nights), nights, guests: 2, status: 'confirmed', channel: 'direct',
  guest: { name, country: 'MY', countryName: 'Malaysia', foreign: false, phone: '+60 12-555 01' + String(10 + n).slice(-2), email: 'guest' + n + '@example.test' },
  nightly: 100, accommodation: 100 * nights, cleaningFee: 40, tourismTax: 0, total: 100 * nights + 40, revenue: 100 * nights, platformFee: 0, payout: 100 * nights + 40,
  checkInTime: '15:00', checkOutTime: '11:00', createdAt: '2026-10-10T12:00', idVerified: false, codeStatus: 'held', doorCode: '4' + String(100 + n).slice(-3),
  assignment: { how: 'auto', by: null, at: '2026-10-10T12:00', locked: false }, invoiceNo: 'INV-2026-' + (1000 + n)
});
for (let d = '2026-10-18'; d <= '2027-03-31'; d = addDays(d, 11)) {
  if (d >= '2026-11-02' && d <= '2026-11-28') continue;
  n++;
  await put('bookings', `BK-S${n}`, booking(`BK-S${n}`, `T-0${(n % 8) + 1}`, 'UT-T', d, 2, 'Seed Guest ' + n));
  if (n % 2) { n++; await put('bookings', `BK-S${n}`, booking(`BK-S${n}`, `D-0${(n % 4) + 1}`, 'UT-D', addDays(d, 1), 3, 'Seed Guest ' + n)); }
}
/* certification 10 starts from a hold on D-01 for 17-24 Nov (lifted in the test) */
await put('blocks', 'BL-HOLD-D01', { id: 'BL-HOLD-D01', propertyId: 'D-01', start: '2026-11-17', end: '2026-11-25', type: 'maintenance', note: 'Aircon service', createdBy: 's1', createdAt: '2026-10-12T09:00' });
await db.query('update public.channex_meta set last_feed_poll_at = now()');

/* ---------- the app: production build + api/ through scripts/dev.mjs ---------- */
const appPort = await freePort();
const appUrl = `http://127.0.0.1:${appPort}`;
const devEnv = Object.assign({}, process.env, {
  SUPABASE_URL: env.url, SUPABASE_ANON_KEY: env.anonKey, SUPABASE_SERVICE_ROLE_KEY: env.serviceKey,
  CHANNEX_BASE_URL: m.apiUrl, CHANNEX_API_KEY: 'test-key', CHANNEX_TODAY: TODAY, CHANNEX_ORG_ALLOWLIST: ORG,
  CHANNEX_WEBHOOK_TOKEN: 'test-webhook-token', CHANNEX_WORKER_SECRET: '', APP_URL: appUrl
});
for (const k of ['POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'DATABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'CHANNEX_APP_URL', 'CHANNEX_WEBHOOK_SECRET']) delete devEnv[k];
const dev = spawn(process.execPath, [path.join(ROOT, 'scripts/dev.mjs'), '--port', String(appPort), '--dist', path.join(OUT, 'dist')], { cwd: ROOT, env: devEnv, stdio: ['ignore', 'pipe', 'pipe'] });
let devLog = '';
dev.stdout.on('data', (c) => { devLog += c; fs.appendFileSync(path.join(OUT, 'dev.log'), c); });
dev.stderr.on('data', (c) => { devLog += c; fs.appendFileSync(path.join(OUT, 'dev.log'), c); });
for (let i = 0; ; i++) {
  try { const r = await fetch(appUrl + '/api/health'); if (r.ok) break; } catch (e) { /* starting */ }
  if (dev.exitCode !== null || i > 600) { console.error('dev.mjs did not start:\n' + devLog.slice(-3000)); process.exit(1); }
  await new Promise((r) => setTimeout(r, 200));
}

/* ---------- control ---------- */
const control = async (what, method = 'GET', body) => (await fetch(m.url + '/__mock/' + what, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
const ctl = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://ctl');
  const send = (code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || '{}') : {};
    if (u.pathname === '/reset' && req.method === 'POST') {
      await control('calls', 'DELETE');
      await db.query(`update public.channex_calls set at = at - interval '2 minutes'`);
      return send(200, { ok: true });
    }
    if (u.pathname === '/calls') return send(200, { calls: (await control('calls')).calls.filter((c) => c.method !== 'GET') });
    if (u.pathname === '/state') return send(200, await control('state'));
    if (u.pathname === '/ids') {
      const plans = (await db.query(`select r.id as plan_id, r.data->>'name' as name, r.data->>'unitTypeId' as unit_type_id, p.rate_plan_id
          from public.records r left join public.channex_rate_plans p on p.plan_id = r.id and p.org_id = r.org_id
          where r.org_id = $1 and r.coll = 'ratePlans' and not r.deleted order by r.id`, [ORG])).rows;
      const rooms = (await db.query('select unit_type_id, room_type_id from public.channex_room_types where org_id = $1', [ORG])).rows;
      const props = (await db.query('select building_id, channex_property_id, status from public.channex_properties where org_id = $1', [ORG])).rows;
      return send(200, { plans, rooms, props });
    }
    if (u.pathname === '/outbox') return send(200, { marks: (await db.query('select kind, target_id, date_from, date_to, claimed_at from public.channex_outbox where org_id = $1 order by id', [ORG])).rows });
    if (u.pathname === '/ota-booking' && req.method === 'POST') { await put('bookings', body.id, body); return send(200, { ok: true }); }
    if (u.pathname === '/booking') return send(200, { booking: ((await db.query(`select data from public.records where org_id = $1 and coll = 'bookings' and id = $2`, [ORG, u.searchParams.get('id')])).rows[0] || {}).data || null });
    if (u.pathname === '/alert' && req.method === 'POST') {
      const r = await db.query('insert into public.channex_alerts (org_id, kind, message, ref) values ($1, $2, $3, $4) returning id', [ORG, body.kind || 'sync_error', body.message || 'Test alert', body.ref || {}]);
      return send(200, { id: r.rows[0].id });
    }
    if (u.pathname === '/alerts') return send(200, { alerts: (await db.query('select id, kind, resolved_at, resolved_by from public.channex_alerts where org_id = $1 order by id', [ORG])).rows });
    return send(404, { error: 'unknown' });
  } catch (e) { return send(500, { error: e.message }); }
});
const ctlPort = await freePort();
await new Promise((r) => ctl.listen(ctlPort, '127.0.0.1', r));

process.stdout.write(JSON.stringify({ app: appUrl, mock: m.url, control: `http://127.0.0.1:${ctlPort}`, org: ORG, users, supabase: env.url }) + '\n');

let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  try { dev.kill('SIGTERM'); } catch (e) { /* gone */ }
  await new Promise((r) => ctl.close(() => r()));
  await mock.close().catch(() => {});
  await env.close().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.stdin.on('end', shutdown);
process.stdin.resume();
