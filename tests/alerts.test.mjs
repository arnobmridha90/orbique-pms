/* Booking alerts (api/_lib/alerts.js): what an alert says, the settings, each sender, the outbox and Firebase sign-in.
 * No network: every request goes to a fake fetch, every query to a fake Supabase client.
 *
 *   node --test tests/alerts.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { fakeSb, op } from './inbox/fake-sb.mjs';
import {
  normalizeSettings, describe, moneyText, shortDate, emailConfig, pushConfig, sendEmail, sendWhatsApp, serviceJwt,
  googleAccessToken, resetTokenCache, sendPush, sendRow, processOutbox, MAX_ATTEMPTS
} from '../api/_lib/alerts.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const booking = (extra) => Object.assign({ id: 'B1', channel: 'trip', otaName: 'Trip.com', reservationCode: 'TR-9', guest: { name: 'Li Yinghe' }, guests: 2,
  checkIn: '2026-10-18', checkOut: '2026-10-24', total: 1500, payout: 1200, currency: 'MYR', propertyId: 'P1', unitTypeId: 'T1', status: 'confirmed' }, extra || {});
const ctx = {
  units: new Map([['P1', { id: 'P1', unitNo: '41-1', buildingId: 'BL1', unitTypeId: 'T1' }]]),
  types: new Map([['T1', { id: 'T1', name: 'Standard 2-Bedroom Suite', buildingId: 'BL1' }]]),
  buildings: new Map([['BL1', { id: 'BL1', name: 'Vortex KLCC', currency: 'MYR' }]])
};
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) });

test('settings: everything on by default, bad addresses and numbers dropped', () => {
  assert.deepEqual(normalizeSettings(null), { on: true, kinds: { new: true, cancelled: true, changed: true }, emails: [], whatsapp: [], push: true });
  const s = normalizeSettings({ on: true, kinds: { changed: false }, emails: ['A@Example.com', 'nope', 'a@example.com'], whatsapp: ['+60 12-345 6789', '123'], push: false });
  assert.deepEqual(s.emails, ['a@example.com']);
  assert.deepEqual(s.whatsapp, ['+60123456789']);
  assert.equal(s.kinds.changed, false);
  assert.equal(s.kinds.new, true);
  assert.equal(s.push, false);
});

test('money and dates', () => {
  assert.equal(moneyText(1200, 'MYR'), 'RM1,200');
  assert.equal(moneyText(99.5, 'usd'), 'USD 99.50');
  assert.equal(moneyText(0, 'MYR'), '');
  assert.equal(shortDate('2026-12-01'), '1 Dec');
  assert.equal(shortDate('soon'), '');
});

test('a new booking says the site, guest, stay, unit and payout', () => {
  const m = describe({ kind: 'new', data: { b: booking() } }, ctx);
  assert.equal(m.title, 'New booking · Trip.com');
  assert.deepEqual(m.lines, ['Li Yinghe, 2 guests', '18 Oct to 24 Oct (6 nights)', 'Vortex KLCC 41-1 (Standard 2-Bedroom Suite)', 'Payout RM1,200 · Ref TR-9']);
  assert.equal(m.text, m.lines.join('\n'));
});

test('cancellations leave out the money; date changes show the old dates; no unit yet is said', () => {
  const c = describe({ kind: 'cancelled', data: { b: booking({ propertyId: null }) } }, ctx);
  assert.equal(c.title, 'Cancelled · Trip.com');
  assert.equal(c.lines[2], 'Vortex KLCC no unit assigned yet (Standard 2-Bedroom Suite)');
  assert.equal(c.lines[3], 'Ref TR-9');
  const d = describe({ kind: 'changed', data: { b: booking({ checkOut: '2026-10-25', nights: 7 }), old: { checkIn: '2026-10-18', checkOut: '2026-10-24' } } }, ctx);
  assert.equal(d.title, 'Dates changed · Trip.com');
  assert.equal(d.lines[1], 'Now 18 Oct to 25 Oct (7 nights), was 18 Oct to 24 Oct');
  const x = describe({ kind: 'new', data: { b: { channel: 'airbnb', checkIn: '2026-11-01', checkOut: '2026-11-02' } } }, {});
  assert.equal(x.title, 'New booking · Airbnb');
  assert.deepEqual(x.lines, ['Guest', '1 Nov to 2 Nov (1 night)', 'no unit assigned yet']);
});

test('email: skipped without a key or address, sent through Resend, 4xx is permanent', async () => {
  const msg = describe({ kind: 'test' });
  assert.match(await sendEmail(emailConfig({}), ['a@b.co'], msg), /^skipped/);
  const cfg = emailConfig({ RESEND_API_KEY: 're_test', RESEND_URL: 'http://resend.test/' });
  assert.equal(cfg.from, 'Orbique <onboarding@resend.dev>');
  assert.match(await sendEmail(cfg, [], msg), /^skipped/);
  let seen;
  const ok = await sendEmail(cfg, ['a@b.co'], msg, { appUrl: 'https://app.test', fetch: async (url, init) => { seen = { url, init }; return reply(200, { id: 'e1' }); } });
  assert.equal(ok, 'sent');
  assert.equal(seen.url, 'http://resend.test/emails');
  assert.equal(seen.init.headers.Authorization, 'Bearer re_test');
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(body.to, ['a@b.co']);
  assert.equal(body.subject, 'Test alert from Orbique');
  assert.match(body.html, /Open Orbique/);
  await assert.rejects(sendEmail(cfg, ['a@b.co'], msg, { fetch: async () => reply(403, { message: 'domain not verified' }) }), (e) => e.permanent === true && /domain not verified/.test(e.message) && !/re_test/.test(e.message));
  await assert.rejects(sendEmail(cfg, ['a@b.co'], msg, { fetch: async () => reply(503, {}) }), (e) => e.permanent === false);
  // one address the Resend account may not send to does not stop the others
  const tos = [];
  const part = await sendEmail(cfg, ['owner@b.co', 'other@c.co'], msg, { fetch: async (url, init) => { const t = JSON.parse(init.body).to; tos.push(t); return t[0] === 'owner@b.co' ? reply(200, {}) : reply(403, { message: 'You can only send testing emails to your own email address' }); } });
  assert.deepEqual(tos, [['owner@b.co'], ['other@c.co']]);
  assert.match(part, /^sent to owner@b\.co; not to other@c\.co: You can only send/);
});

test('WhatsApp: skipped until set up; sends the template with the title and details', async () => {
  const msg = describe({ kind: 'new', data: { b: booking() } }, ctx);
  const wa = { template: 'booking_alert', lang: 'en' };
  assert.match(await sendWhatsApp({ configured: false }, wa, 'PN1', ['+60123456789'], msg), /^skipped: WhatsApp is not set up/);
  const cfg = { configured: true, token: 'wa-token', version: 'v21.0', baseUrl: 'http://graph.test' };
  assert.match(await sendWhatsApp(cfg, wa, null, ['+60123456789'], msg), /no WhatsApp number connected/);
  assert.match(await sendWhatsApp(cfg, wa, 'PN1', [], msg), /no WhatsApp number to alert/);
  let seen;
  const r = await sendWhatsApp(cfg, wa, 'PN1', ['+60123456789'], msg, { fetch: async (url, init) => { seen = { url: String(url), body: JSON.parse(init.body) }; return reply(200, { messages: [{ id: 'wamid.1' }] }); } });
  assert.equal(r, 'sent');
  assert.match(seen.url, /\/PN1\/messages$/);
  assert.equal(seen.body.to, '60123456789');
  assert.equal(seen.body.template.name, 'booking_alert');
  assert.deepEqual(seen.body.template.components[0].parameters.map((p) => p.text), ['New booking · Trip.com', msg.lines.join(' · ')]);
});

/* a throwaway service account for the Firebase tests */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { project_id: 'orbique-test', client_email: 'alerts@orbique-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'http://oauth.test/token' };

test('Firebase config: JSON or base64, invalid values reported', () => {
  assert.equal(pushConfig({}).configured, false);
  assert.equal(pushConfig({ FIREBASE_SERVICE_ACCOUNT: '{"nope":1}' }).invalid, true);
  const a = pushConfig({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) });
  const b = pushConfig({ FIREBASE_SERVICE_ACCOUNT: Buffer.from(JSON.stringify(SA)).toString('base64') });
  assert.equal(a.configured, true);
  assert.equal(b.projectId, 'orbique-test');
  assert.equal(a.tokenUrl, 'http://oauth.test/token');
});

test('the service-account JWT is signed RS256 for the messaging scope', () => {
  const cfg = pushConfig({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) });
  const jwt = serviceJwt(cfg, 1_800_000_000);
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.iss, SA.client_email);
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(createVerify('RSA-SHA256').update(h + '.' + c).verify(publicKey, Buffer.from(s, 'base64url')), true);
});

test('push: signs in once, sends to every phone, forgets phones that were removed', async () => {
  resetTokenCache();
  const cfg = pushConfig({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), FCM_URL: 'http://fcm.test' });
  const deleted = [];
  const sb = fakeSb({ handler: (table, ops) => {
    if (table === 'push_devices' && ops[0][0] === 'select') return { data: [{ token: 'tok-good' }, { token: 'tok-gone' }], error: null };
    if (table === 'push_devices' && ops[0][0] === 'delete') { deleted.push(op(ops, 'eq', 'token')); return { data: null, error: null }; }
    return { data: null, error: null };
  } });
  let signIns = 0;
  const sent = [];
  const fetch = async (url, init) => {
    if (url === 'http://oauth.test/token') { signIns++; return reply(200, { access_token: 'ya29.test', expires_in: 3600 }); }
    const m = JSON.parse(init.body).message;
    sent.push(m);
    return m.token === 'tok-gone' ? reply(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }) : reply(200, { name: 'm1' });
  };
  const msg = describe({ kind: 'new', data: { b: booking() } }, ctx);
  assert.equal(await sendPush(sb, cfg, ORG, msg, { bookingId: 'B1', kind: 'new', none: null }, { fetch }), 'sent');
  assert.equal(await sendPush(sb, cfg, ORG, msg, { bookingId: 'B1' }, { fetch }), 'sent');
  assert.equal(signIns, 1);
  assert.deepEqual(deleted, ['tok-gone', 'tok-gone']);
  assert.equal(sent[0].notification.title, 'New booking · Trip.com');
  assert.deepEqual(sent[0].data, { bookingId: 'B1', kind: 'new' });
  assert.equal(sent[0].android.notification.channel_id, 'bookings');
  const none = fakeSb({ handler: () => ({ data: [], error: null }) });
  assert.match(await sendPush(none, cfg, ORG, msg, {}, { fetch }), /^skipped: no phone/);
  assert.match(await sendPush(none, pushConfig({}), ORG, msg, {}, { fetch }), /^skipped: phone alerts are not set up/);
});

test('sendRow: each channel once, a failed channel retried on its own, alerts switched off are skipped', async () => {
  const sb = fakeSb({ handler: () => ({ data: [], error: null }) });
  const settings = normalizeSettings({ emails: ['a@b.co'], whatsapp: ['+60123456789'] });
  let emails = 0;
  let fail = true;
  const fetch = async () => { emails++; return fail ? reply(500, {}) : reply(200, {}); };
  const base = { settings, ctx, appUrl: '', fetch, emailConfig: emailConfig({ RESEND_API_KEY: 're_test' }), waConfig: { configured: false }, pushConfig: pushConfig({}) };
  const row = { org_id: ORG, kind: 'new', booking_id: 'B1', data: { b: booking() }, done: {} };
  const r1 = await sendRow(sb, row, base);
  assert.equal(r1.finished, false);
  assert.match(r1.done.email, /^error: Resend/);
  assert.match(r1.done.whatsapp, /^skipped/);
  assert.match(r1.done.push, /^skipped/);
  fail = false;
  const r2 = await sendRow(sb, Object.assign({}, row, { done: r1.done }), base);
  assert.equal(r2.finished, true);
  assert.equal(r2.done.email, 'sent');
  assert.equal(r2.done.whatsapp, r1.done.whatsapp);
  assert.equal(emails, 2);
  const off = await sendRow(sb, Object.assign({}, row, { kind: 'changed' }), Object.assign({}, base, { settings: normalizeSettings({ emails: ['a@b.co'], kinds: { changed: false } }) }));
  assert.equal(off.finished, true);
  assert.equal(off.done.email, 'skipped: alerts are off for this');
  assert.equal(emails, 2);
});

test('processOutbox: claims each row before sending, retries with a wait, gives up and drops old rows', async () => {
  const now = Date.parse('2026-10-18T12:00:00Z');
  const rows = [
    { id: 1, org_id: ORG, key: 'new:B1', kind: 'new', booking_id: 'B1', data: { b: booking() }, done: {}, attempts: 0, created_at: '2026-10-18T11:59:00Z', next_at: '2026-10-18T11:59:00Z' },
    { id: 2, org_id: ORG, key: 'new:B2', kind: 'new', booking_id: 'B2', data: { b: booking({ id: 'B2' }) }, done: {}, attempts: MAX_ATTEMPTS - 1, created_at: '2026-10-18T10:00:00Z', next_at: '2026-10-18T11:00:00Z' },
    { id: 3, org_id: ORG, key: 'new:B3', kind: 'new', booking_id: 'B3', data: { b: booking({ id: 'B3' }) }, done: {}, attempts: 0, created_at: '2026-10-15T10:00:00Z', next_at: '2026-10-15T10:00:00Z' },
    { id: 4, org_id: ORG, key: 'new:B4', kind: 'new', booking_id: 'B4', data: { b: booking({ id: 'B4' }) }, done: {}, attempts: 0, created_at: '2026-10-18T11:59:00Z', next_at: '2026-10-18T11:59:00Z' }
  ];
  const updates = [];
  const sb = fakeSb({ handler: (table, ops) => {
    if (table === 'alert_outbox' && ops[0][0] === 'select') return { data: rows, error: null };
    if (table === 'alert_outbox' && ops[0][0] === 'update') {
      const id = op(ops, 'eq', 'id'), patch = ops[0][1];
      updates.push({ id, patch, claim: op(ops, 'eq', 'next_at') !== undefined });
      if (id === 4 && op(ops, 'eq', 'next_at') !== undefined) return { data: [], error: null };   // another run took it
      return { data: [{ id }], error: null };
    }
    return { data: [], error: null };
  } });
  const out = await processOutbox(sb, {
    now, settings: normalizeSettings({ emails: ['a@b.co'] }), ctx, appUrl: '',
    fetch: async () => reply(500, {}),
    emailConfig: emailConfig({ RESEND_API_KEY: 're_test' }), waConfig: { configured: false }, pushConfig: pushConfig({})
  });
  assert.deepEqual(out, { sent: 0, retried: 2, dropped: 1 });
  const claim1 = updates.find((u) => u.id === 1 && u.claim);
  assert.equal(claim1.patch.attempts, 1);
  assert.ok(Date.parse(claim1.patch.next_at) > Date.now());
  const save1 = updates.find((u) => u.id === 1 && !u.claim);
  assert.match(save1.patch.done.email, /^error/);
  assert.equal(save1.patch.finished_at, undefined);
  const save2 = updates.find((u) => u.id === 2 && !u.claim);
  assert.ok(save2.patch.finished_at, 'gives up after the last attempt');
  assert.match(updates.find((u) => u.id === 3).patch.last_error, /older than 2 days/);
  assert.equal(updates.filter((u) => u.id === 4).length, 1, 'a row someone else claimed is left alone');
});

test('Firebase sign-in failures do not show the key', async () => {
  resetTokenCache();
  const cfg = pushConfig({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) });
  await assert.rejects(googleAccessToken(cfg, { fetch: async () => reply(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }) }),
    (e) => e.permanent === true && /Invalid JWT Signature/.test(e.message) && !/PRIVATE KEY/.test(e.message));
});
