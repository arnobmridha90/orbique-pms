/* WhatsApp numbers that stay on the WhatsApp Business app (Meta's coexistence, through Embedded Signup): settings,
 * the extra webhook fields, connecting, and storing echoes, older chats and contacts.
 *
 *   node --test tests/inbox/*.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { waConfig, withToken, parseWebhook, exchangeCode, signupNumber, sendText } from '../../api/_lib/whatsapp.js';
import { connectWithSignup, accountUpdate } from '../../api/_lib/whatsapp-connect.js';
import { receiveWhatsAppEcho, receiveWhatsAppHistory, receiveWhatsAppContact, sendReply, HISTORY_MAX } from '../../api/_lib/inbox.js';
import handler from '../../api/whatsapp-webhook.js';
import { fakeSb, op } from './fake-sb.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const SECRET = 'app-secret-0123456789';
const BIZ_TOKEN = 'EAAG-business-token-abcdefghijklmnop';
const CFG = waConfig({ WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: 'verify-me', WHATSAPP_APP_ID: '2038856197030268', WHATSAPP_CONFIG_ID: '1128333519665529', WHATSAPP_GRAPH_URL: 'https://graph.test' });

const change = (field, value, id = 'WABA1') => ({ object: 'whatsapp_business_account', entry: [{ id, changes: [{ field, value: Object.assign({ messaging_product: 'whatsapp', metadata: { display_phone_number: '60174698759', phone_number_id: 'PN1' } }, value) }] }] });

/* ---------- settings ---------- */

test('settings: Embedded Signup alone is enough; WHATSAPP_TOKEN is no longer required', () => {
  assert.equal(CFG.configured, true);
  assert.equal(CFG.signup, true);
  assert.equal(CFG.token, '');
  assert.equal(waConfig({ WHATSAPP_APP_SECRET: 's', WHATSAPP_VERIFY_TOKEN: 'v' }).configured, false);
  assert.equal(waConfig({ WHATSAPP_APP_SECRET: 's', WHATSAPP_VERIFY_TOKEN: 'v', WHATSAPP_TOKEN: 't' }).configured, true);
  assert.equal(waConfig({ WHATSAPP_APP_SECRET: 's', WHATSAPP_VERIFY_TOKEN: 'v', WHATSAPP_TOKEN: 't' }).signup, false);
  assert.equal(waConfig({ WHATSAPP_APP_SECRET: 's', WHATSAPP_VERIFY_TOKEN: 'v', WHATSAPP_APP_ID: 'abc', WHATSAPP_CONFIG_ID: '1128333519665529' }).signup, false);
  assert.equal(waConfig({ WHATSAPP_VERIFY_TOKEN: 'v', WHATSAPP_APP_ID: '123456', WHATSAPP_CONFIG_ID: '1128333519665529' }).configured, false);
  assert.equal(withToken(CFG, 'x').token, 'x');
  assert.equal(withToken(CFG, '').token, '');
  assert.equal(CFG.token, '');
});

test('sending without any token says how to fix it, and never calls Meta', async () => {
  let called = false;
  await assert.rejects(sendText(CFG, 'PN1', '60123456789', 'Hi', { fetch: async () => { called = true; } }), /no access token/);
  assert.equal(called, false);
});

/* ---------- webhook fields ---------- */

test('parse: messages sent from the phone app (echoes); edits and deletions skipped', () => {
  const p = parseWebhook(change('smb_message_echoes', { message_echoes: [
    { from: '60174698759', to: '60123456789', id: 'wamid.E1', timestamp: '1761700000', type: 'text', text: { body: 'See you at 3pm' } },
    { from: '60174698759', to: '60123456789', id: 'wamid.E2', timestamp: '1761700001', type: 'image', image: { id: 'MEDIA1', mime_type: 'image/jpeg', caption: 'The lobby' } },
    { from: '60174698759', to: '60123456789', id: 'wamid.E3', timestamp: '1761700002', type: 'revoke', revoke: { original_message_id: 'wamid.E1' } },
    { from: '60174698759', to: '60123456789', id: 'wamid.E4', timestamp: '1761700003', type: 'edit', edit: {} }
  ] }));
  assert.equal(p.echoes.length, 2);
  assert.deepEqual(p.echoes[0], { phoneNumberId: 'PN1', to: '60123456789', id: 'wamid.E1', at: 1761700000000, content: { type: 'text', text: 'See you at 3pm' } });
  assert.equal(p.echoes[1].content.type, 'image');
  assert.equal(p.echoes[1].content.media.id, 'MEDIA1');
  assert.equal(p.messages.length, 0);
});

test('parse: older chats (history), with who wrote each message, media placeholders and progress', () => {
  const p = parseWebhook(change('history', { history: [{ metadata: { phase: 0, chunk_order: 1, progress: 55 }, threads: [
    { id: '60123456789', messages: [
      { from: '60123456789', id: 'wamid.H1', timestamp: '1760000000', type: 'text', text: { body: 'Is it free next week?' }, history_context: { status: 'READ' } },
      { from: '60174698759', id: 'wamid.H2', timestamp: '1760000100', type: 'text', text: { body: 'Yes it is' } },
      { from: '60123456789', id: 'wamid.H3', timestamp: '1760000200', type: 'media_placeholder' }
    ] },
    { id: '60174698759', messages: [{ from: '60174698759', id: 'wamid.SELF', timestamp: '1', type: 'text', text: { body: 'note to self' } }] },
    { id: '60199999999', messages: [] }
  ] }] }));
  assert.equal(p.history.length, 1);
  const t = p.history[0];
  assert.equal(t.guest, '60123456789');
  assert.deepEqual(t.messages.map((m) => [m.id, m.fromGuest]), [['wamid.H1', true], ['wamid.H2', false], ['wamid.H3', true]]);
  assert.match(t.messages[2].content.text, /WhatsApp app/);
  assert.deepEqual(p.historyProgress, [{ phoneNumberId: 'PN1', phase: 0, progress: 55 }]);
  const declined = parseWebhook(change('history', { history: [], errors: [{ code: 2593109, title: 'History sharing declined' }] }));
  assert.deepEqual(declined.historyProgress, [{ phoneNumberId: 'PN1', error: 2593109 }]);
});

test('parse: contacts from the phone app, and the number disconnected on the phone', () => {
  const p = parseWebhook(change('smb_app_state_sync', { state_sync: [
    { type: 'contact', contact: { full_name: 'Ana Lopez', first_name: 'Ana', phone_number: '+60 12-345 6789' }, action: 'add', metadata: { timestamp: '1' } },
    { type: 'contact', contact: { full_name: 'Old', phone_number: '60111111111' }, action: 'remove' },
    { type: 'other' }
  ] }));
  assert.deepEqual(p.contacts, [
    { phoneNumberId: 'PN1', phone: '60123456789', name: 'Ana Lopez', removed: false },
    { phoneNumberId: 'PN1', phone: '60111111111', name: 'Old', removed: true }
  ]);
  const off = parseWebhook({ object: 'whatsapp_business_account', entry: [{ id: '555000111', changes: [{ field: 'account_update', value: { event: 'PARTNER_REMOVED', disconnection_info: { reason: 'Disconnected from the phone', initiated_by: 'USER' } } }] }] });
  assert.deepEqual(off.accounts, [{ wabaId: '555000111', event: 'PARTNER_REMOVED', reason: 'Disconnected from the phone' }]);
});

/* ---------- Meta calls ---------- */

/** A fake Graph API: routes by path, records every call (method, path, query, body, auth). */
function graphFake(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v\d+\.\d+/, '');
    const call = { method: init.method || 'GET', path, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : null, auth: (init.headers || {}).Authorization || null };
    calls.push(call);
    const key = Object.keys(routes).find((k) => k === call.method + ' ' + path);
    const r = key ? routes[key](call) : { status: 404, body: { error: { message: 'no route ' + path, code: 100 } } };
    return new Response(JSON.stringify(r.body), { status: r.status || 200 });
  };
  return { fetch, calls };
}

const ROUTES = (over = {}) => Object.assign({
  'GET /oauth/access_token': () => ({ body: { access_token: BIZ_TOKEN, token_type: 'bearer' } }),
  'GET /debug_token': () => ({ body: { data: { granular_scopes: [{ scope: 'whatsapp_business_messaging', target_ids: ['555000111'] }, { scope: 'whatsapp_business_management', target_ids: ['555000111'] }] } } }),
  'GET /555000111/phone_numbers': () => ({ body: { data: [
    { id: 'PN-CLOUD', display_phone_number: '+60 3-0000 0000', verified_name: 'Old', is_on_biz_app: false, platform_type: 'CLOUD_API' },
    { id: 'PN1', display_phone_number: '+60 17-469 8759', verified_name: 'Kozi', is_on_biz_app: true, platform_type: 'CLOUD_API' }
  ] } }),
  'GET /PN1': () => ({ body: { id: 'PN1', display_phone_number: '+60 17-469 8759', verified_name: 'Kozi', is_on_biz_app: true } }),
  'POST /555000111/subscribed_apps': () => ({ body: { success: true } }),
  'POST /PN1/smb_app_data': (c) => ({ body: { success: true, request_id: 'REQ-' + c.body.sync_type } })
}, over);

test('the code from the pop-up becomes the business token; the app secret never leaks into errors', async () => {
  const g = graphFake(ROUTES());
  assert.equal(await exchangeCode(CFG, 'CODE-1', { fetch: g.fetch }), BIZ_TOKEN);
  assert.deepEqual(g.calls[0].query, { client_id: '2038856197030268', client_secret: SECRET, code: 'CODE-1' });
  assert.equal(g.calls[0].auth, null);
  const bad = graphFake(ROUTES({ 'GET /oauth/access_token': (c) => ({ status: 400, body: { error: { message: 'Invalid code; client_secret=' + c.query.client_secret, code: 100 } } }) }));
  await assert.rejects(exchangeCode(CFG, 'OLD', { fetch: bad.fetch }), (e) => !e.message.includes(SECRET) && /\[token\]/.test(e.message));
  await assert.rejects(exchangeCode(Object.assign({}, CFG, { appId: '' }), 'C', { fetch: g.fetch }), /WHATSAPP_APP_ID/);
});

test('finding the number: from the pop-up, else the account from debug_token and the phone-app number', async () => {
  const g = graphFake(ROUTES());
  const a = await signupNumber(CFG, BIZ_TOKEN, {}, { fetch: g.fetch });
  assert.deepEqual([a.wabaId, a.phoneNumberId, a.info.is_on_biz_app], ['555000111', 'PN1', true]);
  const dbg = g.calls.find((c) => c.path === '/debug_token');
  assert.equal(dbg.query.input_token, BIZ_TOKEN);
  assert.equal(dbg.auth, null);
  const b = await signupNumber(CFG, BIZ_TOKEN, { wabaId: '555000111' }, { fetch: g.fetch });
  assert.equal(b.phoneNumberId, 'PN1');
  const c = await signupNumber(CFG, BIZ_TOKEN, { wabaId: '555000111', phoneNumberId: 'PN1' }, { fetch: g.fetch });
  assert.equal(c.info.verified_name, 'Kozi');
  const two = graphFake(ROUTES({ 'GET /555000111/phone_numbers': () => ({ body: { data: [{ id: 'A', is_on_biz_app: false }, { id: 'B', is_on_biz_app: false }] } }) }));
  await assert.rejects(signupNumber(CFG, BIZ_TOKEN, { wabaId: '555000111' }, { fetch: two.fetch }), /several numbers/);
  const none = graphFake(ROUTES({ 'GET /debug_token': () => ({ body: { data: { granular_scopes: [] } } }) }));
  await assert.rejects(signupNumber(CFG, BIZ_TOKEN, {}, { fetch: none.fetch }), /which WhatsApp account/);
});

/** A database for connecting: whatsapp_numbers (taken by orgOwner), and every write recorded. */
function connectDb({ owner = null } = {}) {
  const writes = [];
  const sb = fakeSb({
    handler: (t, ops) => {
      const kind = ops.find((o) => ['upsert', 'update', 'delete', 'insert'].includes(o[0]));
      if (kind) { writes.push({ table: t, op: kind[0], row: kind[1], ops }); return { data: null, error: null }; }
      if (t === 'whatsapp_numbers') return { data: owner ? { org_id: owner } : null, error: null };
      return { data: null, error: null };
    }
  });
  return { sb, writes };
}

test('connecting: webhooks to this site, never /register, the token kept server-side, contacts and chats asked for once', async () => {
  const g = graphFake(ROUTES());
  const { sb, writes } = connectDb();
  const r = await connectWithSignup(sb, { orgId: ORG, userId: 'U1', code: 'CODE-1', wabaId: '555000111', phoneNumberId: '', callbackUrl: 'https://orbique-pms.vercel.app/api/whatsapp-webhook' }, { config: CFG, fetch: g.fetch, now: Date.parse('2026-10-28T16:30:00Z') });
  assert.deepEqual(r.number, { phone: '+60 17-469 8759', name: 'Kozi', coexist: true });
  assert.deepEqual(r.sync, { contacts: { at: '2026-10-28T16:30:00.000Z', id: 'REQ-smb_app_state_sync' }, history: { at: '2026-10-28T16:30:00.000Z', id: 'REQ-history' } });
  assert.equal(g.calls.some((c) => /register/.test(c.path)), false);
  const sub = g.calls.find((c) => c.path === '/555000111/subscribed_apps');
  assert.deepEqual(sub.body, { override_callback_uri: 'https://orbique-pms.vercel.app/api/whatsapp-webhook', verify_token: 'verify-me' });
  assert.equal(sub.auth, 'Bearer ' + BIZ_TOKEN);
  assert.deepEqual(g.calls.filter((c) => c.path === '/PN1/smb_app_data').map((c) => c.body.sync_type), ['smb_app_state_sync', 'history']);
  const saved = writes.find((w) => w.table === 'whatsapp_numbers' && w.op === 'upsert').row;
  assert.deepEqual([saved.phone_number_id, saved.org_id, saved.waba_id, saved.coexist, saved.display_phone], ['PN1', ORG, '555000111', true, '+60 17-469 8759']);
  assert.equal(JSON.stringify(saved).includes(BIZ_TOKEN), false);
  assert.deepEqual(writes.find((w) => w.table === 'whatsapp_tokens').row.token, BIZ_TOKEN);
  assert.ok(writes.findIndex((w) => w.table === 'whatsapp_numbers' && w.op === 'delete') < writes.findIndex((w) => w.table === 'whatsapp_numbers' && w.op === 'upsert'));
  assert.deepEqual(writes.find((w) => w.table === 'whatsapp_numbers' && w.op === 'update').row.sync.history.id, 'REQ-history');
  assert.equal(JSON.stringify(r).includes(BIZ_TOKEN), false);
});

test('connecting: a refused older-chats request still connects; a number another workspace has is refused', async () => {
  const g = graphFake(ROUTES({ 'POST /PN1/smb_app_data': (c) => (c.body.sync_type === 'history' ? { status: 400, body: { error: { message: 'Sync window has passed', code: 100 } } } : { body: { request_id: 'R1' } }) }));
  const { sb } = connectDb();
  const r = await connectWithSignup(sb, { orgId: ORG, code: 'C', callbackUrl: 'https://x.test/api/whatsapp-webhook' }, { config: CFG, fetch: g.fetch });
  assert.equal(r.sync.contacts.id, 'R1');
  assert.match(r.sync.history.error, /Sync window/);
  const taken = connectDb({ owner: OTHER });
  await assert.rejects(connectWithSignup(taken.sb, { orgId: ORG, code: 'C', callbackUrl: 'https://x.test/api/whatsapp-webhook' }, { config: CFG, fetch: graphFake(ROUTES()).fetch }), /another workspace/);
  assert.equal(taken.writes.length, 0);
});

test('connecting: refused without the settings, an https address or a code; a plain Cloud API number gets no sync', async () => {
  const { sb } = connectDb();
  await assert.rejects(connectWithSignup(sb, { orgId: ORG, code: 'C', callbackUrl: 'https://x.test/h' }, { config: waConfig({ WHATSAPP_APP_SECRET: 's', WHATSAPP_VERIFY_TOKEN: 'v', WHATSAPP_TOKEN: 't' }) }), /not set up/);
  await assert.rejects(connectWithSignup(sb, { orgId: ORG, code: 'C', callbackUrl: '' }, { config: CFG }), /APP_URL/);
  await assert.rejects(connectWithSignup(sb, { orgId: ORG, code: '', callbackUrl: 'https://x.test/h' }, { config: CFG }), /did not finish/);
  const g = graphFake(ROUTES({ 'GET /555000111/phone_numbers': () => ({ body: { data: [{ id: 'PN1', display_phone_number: '+60 3', verified_name: 'K', is_on_biz_app: false }] } }) }));
  const r = await connectWithSignup(sb, { orgId: ORG, code: 'C', wabaId: '555000111', callbackUrl: 'https://x.test/h' }, { config: CFG, fetch: g.fetch });
  assert.equal(r.number.coexist, false);
  assert.deepEqual(r.sync, {});
  assert.equal(g.calls.some((c) => c.path === '/PN1/smb_app_data'), false);
});

test('disconnected on the phone: noted on the number, cleared when it is connected again', async () => {
  const writes = [];
  const sb = fakeSb({ handler: (t, ops) => { if (ops.some((o) => o[0] === 'update')) { writes.push(ops.find((o) => o[0] === 'update')[1]); return { data: null, error: null }; } return { data: [{ phone_number_id: 'PN1', sync: { history: { at: 'x' } } }], error: null }; } });
  assert.equal((await accountUpdate(sb, { wabaId: '555000111', event: 'PARTNER_REMOVED', reason: 'phone' })).status, 'updated');
  assert.equal(writes[0].sync.disconnected.event, 'PARTNER_REMOVED');
  assert.equal(writes[0].sync.history.at, 'x');
  await accountUpdate(sb, { wabaId: '555000111', event: 'ACCOUNT_RECONNECTED' });
  assert.equal(writes[1].sync.disconnected, undefined);
  assert.equal((await accountUpdate(sb, { wabaId: '555000111', event: 'VERIFIED_ACCOUNT' })).status, 'ignored');
  assert.equal((await accountUpdate(sb, { wabaId: 'bad', event: 'PARTNER_REMOVED' })).status, 'ignored');
});

/* ---------- storing ---------- */

function inboxDb({ dup = false, contact = null, token = null } = {}) {
  const rpcs = [];
  const writes = [];
  const sb = fakeSb({
    handler: (t, ops) => {
      if (ops.some((o) => o[0] === 'upsert' || o[0] === 'delete')) { writes.push({ t, ops }); return { data: null, error: null }; }
      if (t === 'whatsapp_numbers') return { data: { org_id: ORG, phone_number_id: 'PN1' }, error: null };
      if (t === 'whatsapp_tokens') return { data: token ? { token } : null, error: null };
      if (t === 'whatsapp_contacts') return { data: contact ? { name: contact } : null, error: null };
      if (t === 'records' && op(ops, 'eq', 'coll') === 'conversations' && op(ops, 'eq', 'data->>wa')) return { data: [{ id: 'C-9', data: { wa: '60123456789', contact: { phone: '+60123456789' } } }, { id: 'C-8', data: { bookingId: 'B-1' } }], error: null };
      if (t === 'records' && op(ops, 'eq', 'coll') === 'conversations') return { data: dup ? [{ id: 'C-1' }] : [], error: null };
      if (t === 'records') return { data: [], error: null };
      return { data: null, error: null };
    },
    rpc: (name, args) => { rpcs.push({ name, args }); return { data: name === 'inbox_conv' ? 'C-1' : name === 'inbox_merge' ? args.p_msgs.length : { id: 'C-1', messages: [] }, error: null }; }
  });
  return { sb, rpcs, writes };
}

test('a message sent from the phone app lands in the chat as the team\'s, once, without opening the 24 hours', async () => {
  const { sb, rpcs } = inboxDb({ contact: 'Ana Lopez' });
  const e = { phoneNumberId: 'PN1', to: '60123456789', id: 'wamid.E1', at: Date.parse('2026-10-28T08:00:00Z'), content: { type: 'text', text: 'See you at 3pm' } };
  assert.equal((await receiveWhatsAppEcho(sb, e)).status, 'stored');
  const conv = rpcs.find((x) => x.name === 'inbox_conv').args;
  assert.deepEqual([conv.p_key, conv.p_val, conv.p_extra.contact.name], ['wa', '60123456789', 'Ana Lopez']);
  assert.equal(conv.p_extra.waLastIn, undefined);
  const add = rpcs.find((x) => x.name === 'inbox_append').args;
  assert.deepEqual(add.p_msg, { from: 'staff', type: 'text', text: 'See you at 3pm', time: '2026-10-28T16:00', via: 'whatsapp', xid: 'wa:wamid.E1', app: true });
  assert.equal(add.p_unread, 0);
  assert.deepEqual(add.p_patch, {});
  const again = inboxDb({ dup: true });
  assert.equal((await receiveWhatsAppEcho(again.sb, e)).status, 'duplicate');
});

test('older chats: one merge per chat, in time order, read, capped, reopening replies only for a recent guest message', async () => {
  const now = Date.parse('2026-10-28T16:00:00Z');
  const { sb, rpcs } = inboxDb();
  const h = { phoneNumberId: 'PN1', guest: '60123456789', messages: [
    { id: 'H2', fromGuest: false, at: now - 3 * 3600e3, content: { type: 'text', text: 'Yes it is' } },
    { id: 'H1', fromGuest: true, at: now - 4 * 3600e3, content: { type: 'text', text: 'Free next week?' } },
    { id: 'H3', fromGuest: true, at: now - 2 * 3600e3, content: { type: 'text', text: 'Great' } }
  ] };
  const r = await receiveWhatsAppHistory(sb, h, { now });
  assert.deepEqual([r.status, r.added], ['stored', 3]);
  const merge = rpcs.filter((x) => x.name === 'inbox_merge');
  assert.equal(merge.length, 1);
  assert.deepEqual(merge[0].args.p_msgs.map((m) => [m.xid, m.from, !!m.app, m.earlier]), [['wa:H1', 'guest', false, true], ['wa:H2', 'staff', true, true], ['wa:H3', 'guest', false, true]]);
  assert.equal(merge[0].args.p_unread, 0);
  assert.equal(merge[0].args.p_patch.waLastIn, new Date(now - 2 * 3600e3).toISOString());
  assert.equal(rpcs.some((x) => x.name === 'inbox_append'), false);
  const old = inboxDb();
  await receiveWhatsAppHistory(old.sb, { phoneNumberId: 'PN1', guest: '60123456789', messages: [{ id: 'X', fromGuest: true, at: now - 30 * 3600e3, content: { type: 'text', text: 'old' } }] }, { now });
  assert.deepEqual(old.rpcs.find((x) => x.name === 'inbox_merge').args.p_patch, {});
  const many = inboxDb();
  const list = Array.from({ length: HISTORY_MAX + 50 }, (_, i) => ({ id: 'M' + i, fromGuest: i % 2 === 0, at: now - (1000 - i) * 60e3, content: { type: 'text', text: 'm' + i } }));
  await receiveWhatsAppHistory(many.sb, { phoneNumberId: 'PN1', guest: '60123456789', messages: list }, { now });
  const kept = many.rpcs.find((x) => x.name === 'inbox_merge').args.p_msgs;
  assert.equal(kept.length, HISTORY_MAX);
  assert.equal(kept[kept.length - 1].xid, 'wa:M' + (HISTORY_MAX + 49));
});

test('contacts: the name is kept, given to a nameless chat with no booking, removed when the phone removes it', async () => {
  const { sb, rpcs, writes } = inboxDb();
  assert.equal((await receiveWhatsAppContact(sb, { phoneNumberId: 'PN1', phone: '60123456789', name: 'Ana Lopez', removed: false })).status, 'saved');
  assert.equal(writes[0].t, 'whatsapp_contacts');
  const named = rpcs.filter((x) => x.name === 'inbox_merge');
  assert.equal(named.length, 1);
  assert.equal(named[0].args.p_cid, 'C-9');
  assert.deepEqual(named[0].args.p_patch.contact, { phone: '+60123456789', name: 'Ana Lopez' });
  assert.deepEqual(named[0].args.p_msgs, []);
  const gone = inboxDb();
  assert.equal((await receiveWhatsAppContact(gone.sb, { phoneNumberId: 'PN1', phone: '60123456789', name: 'Ana', removed: true })).status, 'removed');
  assert.ok(gone.writes[0].ops.some((o) => o[0] === 'delete'));
});

test('a reply from Orbique uses the number\'s own token from Embedded Signup', async () => {
  const { sb } = inboxDb({ token: BIZ_TOKEN });
  let auth = null;
  const fetch = async (url, init) => { auth = init.headers.Authorization; return new Response(JSON.stringify({ messages: [{ id: 'wamid.OUT' }] })); };
  await sendReply(sb, { orgId: ORG, conv: { id: 'C-1', wa: '60123456789', waLastIn: new Date(Date.now() - 3600e3).toISOString() }, via: 'whatsapp', text: 'Hello', waConfig: CFG, fetch });
  assert.equal(auth, 'Bearer ' + BIZ_TOKEN);
});

test('webhook endpoint: stores echoes and older chats from a signed delivery', async () => {
  const { sb, rpcs } = inboxDb();
  const body = change('smb_message_echoes', { message_echoes: [{ from: '60174698759', to: '60123456789', id: 'wamid.E9', timestamp: '1761700000', type: 'text', text: { body: 'Hi from the phone' } }] });
  body.entry[0].changes.push({ field: 'history', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '60174698759', phone_number_id: 'PN1' }, history: [{ metadata: { phase: 0, progress: 100 }, threads: [{ id: '60123456789', messages: [{ from: '60123456789', id: 'wamid.H1', timestamp: '1760000000', type: 'text', text: { body: 'Old' } }] }] }] } });
  const raw = JSON.stringify(body);
  const r = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b || ''; } };
  await handler({ method: 'POST', headers: { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex') }, rawBody: Buffer.from(raw), url: '/api/whatsapp-webhook' }, r, { config: CFG, sb, opts: { translateConfig: { configured: false } } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(JSON.parse(r.body), { ok: true, messages: 0, statuses: 0, echoes: 1, history: 1, contacts: 0 });
  assert.ok(rpcs.some((x) => x.name === 'inbox_append' && x.args.p_msg.app === true));
  assert.ok(rpcs.some((x) => x.name === 'inbox_merge'));
});

test('a delivery sent again is cheap: a chat already merged and an unchanged contact are skipped; no name never clears one', async () => {
  const now = Date.parse('2026-10-28T16:00:00Z');
  const again = inboxDb({ dup: true });
  const r = await receiveWhatsAppHistory(again.sb, { phoneNumberId: 'PN1', guest: '60123456789', messages: [{ id: 'H1', fromGuest: true, at: now - 3600e3, content: { type: 'text', text: 'hi' } }] }, { now, orgId: ORG });
  assert.deepEqual([r.status, r.added], ['duplicate', 0]);
  assert.equal(again.rpcs.length, 0);
  const same = inboxDb({ contact: 'Ana Lopez' });
  assert.equal((await receiveWhatsAppContact(same.sb, { phoneNumberId: 'PN1', phone: '60123456789', name: 'Ana Lopez', removed: false })).status, 'saved');
  assert.deepEqual([same.writes.length, same.rpcs.length], [0, 0]);
  const nameless = inboxDb();
  await receiveWhatsAppEcho(nameless.sb, { phoneNumberId: 'PN1', to: '60123456789', id: 'wamid.E9', at: now, content: { type: 'text', text: 'ok' } });
  assert.equal(nameless.rpcs.find((x) => x.name === 'inbox_conv').args.p_extra.contact, undefined);
});
