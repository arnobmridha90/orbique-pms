/* Organising the inbox and photos / videos to guests (api/messages.js organize, purge, lists, media-upload, send-media,
 * media; api/_lib/inbox.js sendMediaReply, checkMedia, purgeTrash): who may do what, the flags each action changes, type
 * and size refusals, and what goes to WhatsApp, email and the booking site.
 *
 *   node --test tests/inbox/organize.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { organize, purge, listsAction, mediaUpload, sendMediaAction, media } from '../../api/messages.js';
import { checkMedia, mediaKind, ownsPath, mediaPath, sendMediaReply, purgeTrash, dropStaleUploads, UPLOAD_HOURS, canInbox, myt, MEDIA_BUCKET, TRASH_DAYS, PURGE_BATCH } from '../../api/_lib/inbox.js';
import { messageContent } from '../../api/_lib/whatsapp.js';
import { fakeSb, op } from './fake-sb.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const WA = { token: 'test-token-1234567890', appSecret: 'app-secret', verifyToken: 'verify-me', version: 'v23.0', baseUrl: 'https://graph.test', configured: true };
const NOW = Date.parse('2026-11-02T06:00:00Z'); // 14:00 in Malaysia
const me = { id: 'user-1' };
const MB = 1024 * 1024;

/* a workspace: the caller's role, blobs, conversations; inbox_mark applied in memory like the SQL function (0022) */
function db(role, { blobs = {}, convs = null, files = {}, storageFails = false } = {}) {
  const conv = convs || {
    'C-1': { id: 'C-1', bookingId: 'B-1', wa: '60123456789', waLastIn: '2026-11-02T05:00:00Z', unread: 0, messages: [{ from: 'guest', text: 'Hi', time: '2026-11-02T13:00' }] },
    'C-2': { id: 'C-2', bookingId: 'B-2', unread: 3, messages: [], trashedAt: '2026-10-30T10:00' }
  };
  const store = { blobs: Object.assign({}, blobs), deleted: [], tombstones: [], removed: [], uploads: [] };
  const sb = fakeSb({
    handler: (t, ops) => {
      if (t === 'members') return { data: { org_id: ORG, user_id: me.id, staff_id: 's9', role, status: 'active' }, error: null };
      if (t === 'orgs') return { data: { id: ORG, name: 'Test stays', plan: 'pro', status: 'active' }, error: null };
      if (t === 'blobs') {
        const up = ops.find((x) => x[0] === 'upsert');
        if (up) { store.blobs[up[1].key] = up[1].data.v; return { data: null, error: null }; }
        const k = op(ops, 'eq', 'key'); return { data: store.blobs[k] !== undefined ? { data: { v: store.blobs[k] } } : null, error: null };
      }
      if (t === 'records') {
        if (ops.some((x) => x[0] === 'delete')) { const id = op(ops, 'eq', 'id'); store.deleted.push(id); delete conv[id]; return { data: null, error: null }; }
        const c = op(ops, 'eq', 'coll'), id = op(ops, 'eq', 'id');
        const has = ops.find((x) => x[0] === 'contains');
        if (has) return { data: Object.values(conv).filter((x) => (x.lists || []).includes(has[2].lists[0])).map((x) => ({ id: x.id })), error: null };
        if (c === 'conversations') return { data: conv[id] ? { id, data: conv[id] } : null, error: null };
        if (c === 'bookings') return { data: { id, data: { guest: { name: 'Ana Silva', phone: '+60 12-345 6789' }, channel: 'direct' } }, error: null };
        return { data: null, error: null };
      }
      if (t === 'whatsapp_numbers') return { data: { phone_number_id: '1234567', display_phone: '60300000000' }, error: null };
      return { data: null, error: null };
    },
    rpc: (name, a) => {
      if (name === 'inbox_mark') {
        const v = conv[a.p_cid]; if (!v) return { data: null, error: null };
        for (const k of a.p_unset) delete v[k];
        Object.assign(v, a.p_set);
        for (const [k, x] of Object.entries(a.p_add)) { v[k] = v[k] || []; if (!v[k].includes(x)) v[k].push(x); }
        for (const [k, x] of Object.entries(a.p_remove)) { if (Array.isArray(v[k])) { v[k] = v[k].filter((y) => y !== x); if (!v[k].length) delete v[k]; } }
        if (a.p_unread_min !== null) v.unread = Math.max(v.unread || 0, a.p_unread_min);
        return { data: { id: a.p_cid, data: JSON.parse(JSON.stringify(v)) }, error: null };
      }
      if (name === 'inbox_append') { const v = conv[a.p_cid]; v.messages = v.messages.concat([a.p_msg]); Object.assign(v, a.p_patch || {}); return { data: v, error: null }; }
      if (name === 'inbox_lists') { // as the SQL function (0022), on store.blobs.inboxLists
        const L = (store.blobs.inboxLists || []).slice(), hit = L.find((l) => l.id === a.p_id);
        if ((a.p_op === 'add' || a.p_op === 'rename') && L.some((l) => l.name.toLowerCase() === a.p_name.toLowerCase() && (a.p_op === 'add' || l.id !== a.p_id))) return { data: { error: 'taken' }, error: null };
        if (a.p_op !== 'add' && !hit) return { data: { error: 'missing' }, error: null };
        if (a.p_op === 'add') { if (L.length >= a.p_max) return { data: { error: 'full' }, error: null }; L.push({ id: a.p_new_id, name: a.p_name }); }
        if (a.p_op === 'rename') L[L.indexOf(hit)] = { id: hit.id, name: a.p_name };
        if (a.p_op === 'remove') L.splice(L.indexOf(hit), 1);
        store.blobs.inboxLists = L; return { data: { lists: L }, error: null };
      }
      if (name === 'inbox_purge_due') return { data: [{ org_id: ORG, id: 'C-9' }], error: null };
      if (name === 'inbox_forget') { // as the SQL function: only while in Deleted; the row stays as a tombstone
        const v = conv[a.p_cid]; if (!v || !v.trashedAt || (a.p_before && v.trashedAt >= a.p_before)) return { data: false, error: null };
        store.tombstones.push(a.p_cid); delete conv[a.p_cid]; return { data: true, error: null };
      }
      return { data: null, error: null };
    },
    storage: (bucket, method, args) => {
      if (method === 'info') { const f = files[args[0]]; return f ? { data: { size: f.size, contentType: f.mime }, error: null } : { data: null, error: { message: 'not found' } }; }
      if (method === 'createSignedUrl') return { data: { signedUrl: 'https://store.test/sign/' + args[0] + '?token=t' }, error: null };
      if (method === 'createSignedUploadUrl') return { data: { token: 'up-token', path: args[0] }, error: null };
      if (method === 'download') return { data: new Blob([Buffer.from('jpegbytes')]), error: null };
      if (method === 'list') return storageFails ? { data: null, error: { message: 'storage down' } } : { data: store.removed.length ? [] : [{ name: 'a.jpg' }, { name: 'b.mp4' }], error: null };
      if (method === 'remove') { store.removed.push(...args[0]); return { data: [], error: null }; }
      if (method === 'upload') { store.uploads.push(args[0]); return { data: { path: args[0] }, error: null }; }
      return { data: null, error: null };
    }
  });
  return { sb, conv, store };
}
const body = (x) => Object.assign({ orgId: ORG, conversationId: 'C-1' }, x);

/* ---------- permissions ---------- */

test('inbox.edit: the inbox\'s edit level (owner, ops, front desk; maintenance only views)', async () => {
  const m = (role) => ({ role, status: 'active', staff_id: 's9' });
  const sb = db('ops').sb;
  assert.equal(await canInbox(sb, ORG, m('owner'), 'inbox.edit'), true);
  assert.equal(await canInbox(sb, ORG, m('ops'), 'inbox.edit'), true);
  assert.equal(await canInbox(sb, ORG, m('frontdesk'), 'inbox.edit'), true);
  assert.equal(await canInbox(sb, ORG, m('maintenance'), 'inbox.edit'), false);
  assert.equal(await canInbox(sb, ORG, m('maintenance'), 'inbox'), true);
  assert.equal(await canInbox(db('ops', { blobs: { rolePerms: { ops: { sections: { inbox: 'view' } } } } }).sb, ORG, m('ops'), 'inbox.edit'), false);
});

/* ---------- organize ---------- */

test('organize: pin, archive, read / unread, delete and restore change only the chat\'s flags', async () => {
  const { sb, conv } = db('frontdesk');
  let r = await organize(sb, body({ op: 'archive' }), me);
  assert.equal(r.conversations[0].data.archived, true);
  r = await organize(sb, body({ op: 'pin' }), me);
  assert.equal(conv['C-1'].pinned, true);
  await organize(sb, body({ op: 'unarchive' }), me);
  await organize(sb, body({ op: 'unpin' }), me);
  assert.equal('archived' in conv['C-1'], false); assert.equal('pinned' in conv['C-1'], false);
  await organize(sb, body({ op: 'unread' }), me);
  assert.equal(conv['C-1'].unread, 1);
  await organize(sb, body({ op: 'unread', conversationId: 'C-2' }), me);
  assert.equal(conv['C-2'].unread, 3, 'mark as unread keeps a higher count');
  await organize(sb, body({ op: 'read', conversationIds: ['C-1', 'C-2'] }), me);
  assert.equal(conv['C-1'].unread, 0); assert.equal(conv['C-2'].unread, 0);
  await organize(sb, body({ op: 'delete' }), me, { now: NOW });
  assert.equal(conv['C-1'].trashedAt, '2026-11-02T14:00'); assert.equal(conv['C-1'].trashedBy, 's9');
  await organize(sb, body({ op: 'restore' }), me);
  assert.equal('trashedAt' in conv['C-1'], false); assert.equal('trashedBy' in conv['C-1'], false);
  assert.equal(conv['C-1'].messages.length, 1, 'messages untouched');
});

test('organize: favourites are personal (the caller\'s user id) and open to anyone who can see the inbox', async () => {
  const { sb, conv } = db('maintenance');
  await organize(sb, body({ op: 'favourite' }), me);
  await organize(sb, body({ op: 'favourite' }), { id: 'user-2' });
  assert.deepEqual(conv['C-1'].favBy, ['user-1', 'user-2']);
  await organize(sb, body({ op: 'unfavourite' }), me);
  assert.deepEqual(conv['C-1'].favBy, ['user-2']);
  await assert.rejects(organize(db('accountant').sb, body({ op: 'favourite' }), me), (e) => e.status === 403);
});

test('organize: view-only people cannot pin, archive, mark, list or delete; unknown ops and chats are refused', async () => {
  for (const o of ['pin', 'archive', 'read', 'unread', 'delete', 'restore', 'list-add']) {
    const { sb, conv } = db('maintenance', { blobs: { inboxLists: [{ id: 'L1', name: 'VIP' }] } });
    await assert.rejects(organize(sb, body({ op: o, listId: 'L1' }), me), (e) => e.status === 403 && /read only/.test(e.message), o);
    assert.equal(conv['C-1'].pinned, undefined);
  }
  await assert.rejects(organize(db('ops').sb, body({ op: 'explode' }), me), /Unknown request/);
  await assert.rejects(organize(db('ops').sb, body({ op: 'pin', conversationId: 'C-404' }), me), /no longer there/);
  await assert.rejects(organize(db('ops').sb, body({ op: 'read', conversationIds: Array.from({ length: 201 }, (_, i) => 'C-' + i) }), me), /at most 200/);
});

test('organize: a chat goes on a list only when the list exists, and comes off it', async () => {
  const { sb, conv } = db('ops', { blobs: { inboxLists: [{ id: 'L1', name: 'VIP' }] } });
  await assert.rejects(organize(sb, body({ op: 'list-add', listId: 'L-gone' }), me), /no longer there/);
  await organize(sb, body({ op: 'list-add', listId: 'L1' }), me);
  await organize(sb, body({ op: 'list-add', listId: 'L1' }), me);
  assert.deepEqual(conv['C-1'].lists, ['L1']);
  await organize(sb, body({ op: 'list-remove', listId: 'L1' }), me);
  assert.equal('lists' in conv['C-1'], false);
});

/* ---------- lists ---------- */

test('lists: add, rename (names unique, any case), remove takes the list off every chat', async () => {
  const { sb, conv, store } = db('owner');
  let r = await listsAction(sb, { orgId: ORG, op: 'add', name: '  VIP   guests ' }, me);
  assert.equal(r.lists[0].name, 'VIP guests');
  const id = r.lists[0].id;
  await assert.rejects(listsAction(sb, { orgId: ORG, op: 'add', name: 'vip GUESTS' }, me), (e) => e.status === 409);
  await assert.rejects(listsAction(sb, { orgId: ORG, op: 'add', name: '   ' }, me), /Give the list a name/);
  r = await listsAction(sb, { orgId: ORG, op: 'rename', id, name: 'Returning' }, me);
  assert.equal(store.blobs.inboxLists[0].name, 'Returning');
  await organize(sb, body({ op: 'list-add', listId: id }), me);
  r = await listsAction(sb, { orgId: ORG, op: 'remove', id }, me);
  assert.deepEqual(r.lists, []);
  assert.equal(r.conversations.length, 1);
  assert.equal('lists' in conv['C-1'], false);
  await assert.rejects(listsAction(sb, { orgId: ORG, op: 'remove', id }, me), /no longer there/);
  assert.equal(sb.calls.some((c) => c.table === 'blobs' && c.ops && c.ops.some((x) => x[0] === 'upsert')), false, 'lists change in one locked SQL step, never a read-then-write');
  await assert.rejects(listsAction(db('maintenance').sb, { orgId: ORG, op: 'add', name: 'X' }, me), (e) => e.status === 403);
});

test('lists: at most LISTS_MAX', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: 'L' + i, name: 'List ' + i }));
  const { sb } = db('owner', { blobs: { inboxLists: many } });
  await assert.rejects(listsAction(sb, { orgId: ORG, op: 'add', name: 'One more' }, me), /up to 30 lists/);
});

/* ---------- Deleted ---------- */

test('purge: only chats in Deleted, files first, then a tombstone record (never a hard delete); edit level only', async () => {
  const { sb, store } = db('ops');
  await assert.rejects(purge(sb, body({}), me), /Only chats in Deleted/);
  const r = await purge(sb, body({ conversationId: 'C-2' }), me);
  assert.deepEqual(r.removed, ['C-2']);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(store.tombstones, ['C-2']);
  assert.deepEqual(store.deleted, [], 'no hard delete: other devices learn of it from the tombstone');
  assert.deepEqual(store.removed, [ORG + '/C-2/a.jpg', ORG + '/C-2/b.mp4']);
  const iRemove = sb.calls.findIndex((c) => c.storage === 'remove'), iForget = sb.calls.findIndex((c) => c.rpc === 'inbox_forget');
  assert.ok(iRemove >= 0 && iRemove < iForget, 'files go before the record');
  assert.equal(sb.calls[iForget].args.p_before, null);
  await assert.rejects(purge(db('maintenance').sb, body({ conversationId: 'C-2' }), me), (e) => e.status === 403);
});

test('purge: when Storage fails the chat stays in Deleted, to try again', async () => {
  const { sb, conv, store } = db('ops', { storageFails: true });
  await assert.rejects(purge(sb, body({ conversationId: 'C-2' }), me), (e) => e.status === 502 && /still in Deleted/.test(e.message));
  assert.ok(conv['C-2'] && conv['C-2'].trashedAt);
  assert.equal(sb.calls.some((c) => c.rpc === 'inbox_forget'), false);
  assert.deepEqual(store.tombstones, []);
});

test('purgeTrash: what has been in Deleted for 30 days goes, files first; Storage errors keep the chat', async () => {
  const { sb, store } = db('ops', { convs: { 'C-9': { id: 'C-9', unread: 0, messages: [], trashedAt: '2026-09-01T10:00' } } });
  assert.equal(await purgeTrash(sb, ORG, NOW), 1);
  const call = sb.calls.find((c) => c.rpc === 'inbox_purge_due');
  assert.equal(call.args.p_org, ORG);
  assert.equal(call.args.p_before, myt(NOW - TRASH_DAYS * 86400000));
  assert.equal(call.args.p_before, '2026-10-03T14:00');
  assert.equal(call.args.p_limit, PURGE_BATCH);
  assert.deepEqual(store.removed, [ORG + '/C-9/a.jpg', ORG + '/C-9/b.mp4']);
  assert.deepEqual(store.tombstones, ['C-9']);
  assert.equal(sb.calls.find((c) => c.rpc === 'inbox_forget').args.p_before, '2026-10-03T14:00');
  await purgeTrash(sb, null, NOW);
  assert.equal(sb.calls.filter((c) => c.rpc === 'inbox_purge_due')[1].args.p_org, null);
  const bad = db('ops', { storageFails: true, convs: { 'C-9': { id: 'C-9', unread: 0, messages: [], trashedAt: '2026-09-01T10:00' } } });
  assert.equal(await purgeTrash(bad.sb, ORG, NOW), 0);
  assert.ok(bad.conv['C-9']);
});

test('uploads never sent: removed after a day, unless a message in the chat refers to the file', async () => {
  const sent = ORG + '/C-1/sent.jpg', lost = ORG + '/C-1/lost.jpg', gone = ORG + '/C-77/x.mp4';
  const convs = { 'C-1': { id: 'C-1', unread: 0, messages: [{ from: 'staff', type: 'image', file: { path: sent } }] } };
  const { sb, store } = db('ops', { convs });
  const base = sb.from.bind(sb), cleared = [];
  let asked = null;
  sb.from = (t) => {
    if (t !== 'inbox_uploads') return base(t);
    const q = { ops: [], then: (res, rej) => Promise.resolve(q.ops[0] === 'delete' ? (cleared.push(q.path), { data: null, error: null }) : { data: [sent, lost, gone].map((path) => ({ path, org_id: ORG })), error: null }).then(res, rej) };
    q.select = () => q; q.order = () => q; q.limit = () => q;
    q.lt = (k, v) => { asked = v; return q; }; q.eq = (k, v) => { if (k === 'path') q.path = v; return q; };
    q.delete = () => { q.ops.push('delete'); return q; };
    return q;
  };
  assert.equal(await dropStaleUploads(sb, ORG, NOW), 2);
  assert.equal(asked, new Date(NOW - UPLOAD_HOURS * 3600000).toISOString());
  assert.deepEqual(store.removed, [lost, gone]);
  assert.deepEqual(cleared, [sent, lost, gone]);
});

/* ---------- photos and videos ---------- */

test('checkMedia: JPEG / PNG photos up to 5 MB, MP4 / 3GP videos up to 16 MB, no videos to booking sites', () => {
  assert.equal(checkMedia('whatsapp', 'image/jpeg', 5 * MB), 'image');
  assert.equal(checkMedia('email', 'video/mp4', 16 * MB), 'video');
  assert.equal(checkMedia('channex', 'image/png', MB), 'image');
  assert.throws(() => checkMedia('whatsapp', 'image/jpeg', 5 * MB + 1), /Photos can be up to 5 MB/);
  assert.throws(() => checkMedia('whatsapp', 'video/mp4', 17 * MB), /Videos can be up to 16 MB/);
  assert.throws(() => checkMedia('whatsapp', 'image/gif', 100), /JPEG or PNG/);
  assert.throws(() => checkMedia('whatsapp', 'video/quicktime', 100), /MP4 or 3GP/);
  assert.throws(() => checkMedia('whatsapp', 'image/jpeg', 0), /empty/);
  assert.throws(() => checkMedia('channex', 'video/mp4', MB, 'Airbnb'), /Videos cannot be sent on Airbnb/);
  assert.equal(mediaKind('IMAGE/PNG'), 'image');
  const p = mediaPath(ORG, 'C-1', 'image/png', NOW);
  assert.ok(ownsPath(ORG, 'C-1', p), p);
  assert.match(p, /\.png$/);
  assert.equal(ownsPath(ORG, 'C-2', p), false);
  assert.equal(ownsPath('00000000-0000-4000-8000-000000000002', 'C-1', p), false);
  assert.equal(ownsPath(ORG, 'C-1', ORG + '/C-1/../C-2/x.jpg'), false);
});

test('media-upload: a signed upload address under the workspace and chat, after the permission and file checks', async () => {
  const { sb } = db('frontdesk');
  const run = (role, b, blobs) => (role ? db(role, { blobs }).sb : sb);
  const act = (s, b) => mediaUpload(s, body(b), me);
  const r = await act(sb, { via: 'whatsapp', mime: 'image/jpeg', size: 2 * MB, name: 'door.jpg' });
  assert.equal(r.bucket, MEDIA_BUCKET);
  assert.equal(r.token, 'up-token');
  assert.ok(ownsPath(ORG, 'C-1', r.path), r.path);
  await assert.rejects(act(sb, { via: 'whatsapp', mime: 'image/jpeg', size: 6 * MB }), /up to 5 MB/);
  await assert.rejects(act(sb, { via: 'whatsapp', mime: 'application/pdf', size: MB }), /JPEG or PNG/);
  await assert.rejects(act(sb, { via: 'fax', mime: 'image/jpeg', size: MB }), /Choose how to send it/);
  await assert.rejects(act(run('maintenance'), { via: 'whatsapp', mime: 'image/jpeg', size: MB }), (e) => e.status === 403 && /messaging guests/.test(e.message));
  await assert.rejects(act(run('owner', {}, { workspaceMeta: { demo: true } }), { via: 'whatsapp', mime: 'image/jpeg', size: MB }), /demo workspace/);
});

test('send-media on WhatsApp: a signed link with the caption, stored as a photo with its Storage path', async () => {
  const path = ORG + '/C-1/abc-123.jpg';
  const { sb, conv } = db('frontdesk', { files: { [path]: { size: 2 * MB, mime: 'image/jpeg' } } });
  let sent, url;
  const fetch = async (u, init) => { url = u; sent = JSON.parse(init.body); return new Response(JSON.stringify({ messages: [{ id: 'wamid.P1' }] })); };
  const r = await sendMediaAction(sb, body({ via: 'whatsapp', path, caption: 'The parking entrance', name: 'IMG_1.jpg' }), me, { now: NOW, fetch, waConfig: WA });
  assert.equal(url, 'https://graph.test/v23.0/1234567/messages');
  assert.equal(sent.type, 'image');
  assert.equal(sent.to, '60123456789');
  assert.deepEqual(sent.image, { link: 'https://store.test/sign/' + path + '?token=t', caption: 'The parking entrance' });
  const m = conv['C-1'].messages[1];
  assert.equal(m.type, 'image'); assert.equal(m.caption, 'The parking entrance'); assert.equal(m.xid, 'wa:wamid.P1');
  assert.deepEqual(m.file, { path }); assert.equal(m.mime, 'image/jpeg'); assert.equal(m.status, 'sent'); assert.equal(m.staffId, 's9');
  assert.equal(r.conversation.id, 'C-1');
});

test('send-media: the file is checked again from Storage; another chat\'s file, a closed window and no access are refused', async () => {
  const path = ORG + '/C-1/big.mp4';
  const files = { [path]: { size: 20 * MB, mime: 'video/mp4' }, [ORG + '/C-1/gif.jpg']: { size: MB, mime: 'image/gif' }, [ORG + '/C-1/ok.mp4']: { size: 10 * MB, mime: 'video/mp4' } };
  const send = sendMediaAction;
  let called = false;
  const fetch = async () => { called = true; return new Response(JSON.stringify({ messages: [{ id: 'x' }] })); };
  await assert.rejects(send(db('ops', { files }).sb, body({ via: 'whatsapp', path }), me, { now: NOW, fetch, waConfig: WA }), /Videos can be up to 16 MB/);
  await assert.rejects(send(db('ops', { files }).sb, body({ via: 'whatsapp', path: ORG + '/C-1/gif.jpg' }), me, { now: NOW, fetch, waConfig: WA }), /JPEG or PNG/);
  await assert.rejects(send(db('ops', { files }).sb, body({ via: 'whatsapp', path: ORG + '/C-2/ok.mp4' }), me, { now: NOW, fetch, waConfig: WA }), /did not finish uploading/);
  await assert.rejects(send(db('ops', { files }).sb, body({ via: 'whatsapp', path: ORG + '/C-1/missing.jpg' }), me, { now: NOW, fetch, waConfig: WA }), /did not finish uploading/);
  await assert.rejects(send(db('ops', { files }).sb, body({ via: 'whatsapp', path: ORG + '/C-1/ok.mp4' }), me, { now: Date.parse('2026-11-04T06:00:00Z'), fetch, waConfig: WA }), /24 hours/);
  await assert.rejects(send(db('maintenance', { files }).sb, body({ via: 'whatsapp', path: ORG + '/C-1/ok.mp4' }), me, { now: NOW, fetch, waConfig: WA }), (e) => e.status === 403);
  assert.equal(called, false);
  const { sb, conv } = db('ops', { files });
  let sent;
  await send(sb, body({ via: 'whatsapp', path: ORG + '/C-1/ok.mp4' }), me, { now: NOW, waConfig: WA, fetch: async (u, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ messages: [{ id: 'wamid.V' }] })); } });
  assert.equal(sent.type, 'video'); assert.equal(sent.video.caption, undefined);
  assert.equal(conv['C-1'].messages[1].type, 'video'); assert.equal(conv['C-1'].messages[1].text, 'Video');
});

test('send-media by email: the file goes as an attachment Resend fetches from a signed address', async () => {
  const path = ORG + '/C-1/p.png';
  const { sb, conv } = db('ops', { files: { [path]: { size: MB, mime: 'image/png' } } });
  let sent;
  const fetch = async (u, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ id: 'em_1' })); };
  conv['C-1'].em = 'guest-8812@agoda-messaging.com'; conv['C-1'].emSubject = 'Booking 123';
  await sendMediaReply(sb, { orgId: ORG, conv: conv['C-1'], booking: null, via: 'email', path, caption: '', name: 'map.png', fromAddress: 'otto-ab12@orbiquefms.com', fromName: 'Otto', emailConfig: { key: 'k', baseUrl: 'https://resend.test' }, fetch, now: NOW });
  assert.deepEqual(sent.attachments, [{ filename: 'map.png', path: 'https://store.test/sign/' + path + '?token=t' }]);
  assert.equal(sent.to[0], 'guest-8812@agoda-messaging.com');
  assert.match(sent.text, /attached photo/);
  const m = conv['C-1'].messages[1];
  assert.equal(m.via, 'email'); assert.equal(m.xid, 'em:out:em_1'); assert.equal(m.type, 'image');
});

test('send-media on a booking site: the photo is uploaded to Channex, then sent; the caption follows as its own message', async () => {
  const path = ORG + '/C-1/p.jpg';
  const { sb, conv } = db('ops', { files: { [path]: { size: MB, mime: 'image/jpeg' } } });
  const seen = [];
  const request = async (method, p, b) => {
    seen.push({ method, path: p, body: b });
    if (p === '/attachments') return { status: 201, data: { id: '99999999-9999-4999-8999-999999999999' } };
    return { status: 201, data: { id: seen.length === 2 ? '77777777-7777-4777-8777-777777777777' : '88888888-8888-4888-8888-888888888888' } };
  };
  const c = Object.assign(conv['C-1'], { cx: '44444444-4444-4444-8444-444444444444' });
  const booking = { channel: 'airbnb' };
  await sendMediaReply(sb, { orgId: ORG, conv: c, booking, via: 'channex', path, caption: 'Your parking bay', channexConfig: { key: 'k' }, request, now: NOW });
  assert.equal(seen[0].path, '/attachments');
  assert.deepEqual(seen[0].body.attachment, { file: Buffer.from('jpegbytes').toString('base64'), file_name: 'photo.jpg', file_type: 'image/jpeg' });
  assert.deepEqual(seen[1], { method: 'POST', path: '/message_threads/44444444-4444-4444-8444-444444444444/messages', body: { message: { attachment_id: '99999999-9999-4999-8999-999999999999' } } });
  assert.deepEqual(seen[2].body, { message: { message: 'Your parking bay' } });
  const [photo, cap] = conv['C-1'].messages.slice(1);
  assert.equal(photo.type, 'image'); assert.equal(photo.via, 'airbnb'); assert.equal(photo.xid, 'cx:77777777-7777-4777-8777-777777777777'); assert.equal(photo.caption, undefined);
  assert.equal(cap.text, 'Your parking bay'); assert.equal(cap.xid, 'cx:88888888-8888-4888-8888-888888888888');
  const vpath = ORG + '/C-1/v.mp4';
  const v = db('ops', { files: { [vpath]: { size: MB, mime: 'video/mp4' } } });
  await assert.rejects(sendMediaReply(v.sb, { orgId: ORG, conv: Object.assign(v.conv['C-1'], { cx: c.cx }), booking, via: 'channex', path: vpath, channexConfig: { key: 'k' }, request, now: NOW }), /Videos cannot be sent on Airbnb/);
  // with a booking: the photo goes to the booking's address (where Channex documents attachment_id), text to the thread
  const B = '55555555-5555-4555-8555-555555555555';
  const w = db('ops', { files: { [path]: { size: MB, mime: 'image/jpeg' } } });
  seen.length = 0;
  await sendMediaReply(w.sb, { orgId: ORG, conv: Object.assign(w.conv['C-1'], { cx: c.cx, cxBooking: B }), booking, via: 'channex', path, caption: 'Bay 12', channexConfig: { key: 'k' }, request, now: NOW });
  assert.equal(seen[1].path, '/bookings/' + B + '/messages');
  assert.equal(seen[2].path, '/message_threads/44444444-4444-4444-8444-444444444444/messages');
});

/* ---------- opening files ---------- */

test('media: a file the team sent opens from a signed address; a guest\'s large WhatsApp video goes through Storage', async () => {
  const path = ORG + '/C-1/abc.jpg';
  const msgs = [{ from: 'staff', type: 'image', file: { path }, mime: 'image/jpeg', name: 'door.jpg' }, { from: 'staff', type: 'image', file: { path: ORG + '/C-2/x.jpg' } }, { from: 'guest', type: 'video', media: { id: 'VID1', mime: 'video/mp4' } }];
  const { sb, store } = db('maintenance', { convs: { 'C-1': { id: 'C-1', messages: msgs } } });
  const r = await media(sb, body({ index: 0 }), me);
  assert.deepEqual(r, { mime: 'image/jpeg', name: 'door.jpg', url: 'https://store.test/sign/' + path + '?token=t' });
  await assert.rejects(media(sb, body({ index: 1 }), me), /no file to open/);
  const big = Buffer.alloc(4 * MB, 1);
  const fetch = async (u) => (/VID1$/.test(u) ? new Response(JSON.stringify({ url: 'https://lookaside.test/v', mime_type: 'video/mp4', file_size: big.length })) : new Response(big, { headers: { 'content-type': 'video/mp4' } }));
  const v = await media(sb, body({ index: 2 }), me, { fetch, waConfig: WA });
  assert.equal(v.mime, 'video/mp4'); assert.equal(v.data, undefined);
  assert.deepEqual(store.uploads, [ORG + '/C-1/in-VID1']);
  assert.equal(v.url, 'https://store.test/sign/' + ORG + '/C-1/in-VID1?token=t');
});

test('media: a large PDF or voice note is refused from Meta\'s size, before any download', async () => {
  for (const mime of ['application/pdf', 'audio/ogg; codecs=opus', 'image/webp']) {
    const msgs = [{ from: 'guest', type: 'document', media: { id: 'DOC1', mime } }];
    const { sb, store } = db('maintenance', { convs: { 'C-1': { id: 'C-1', messages: msgs } } });
    const asked = [];
    const fetch = async (u) => { asked.push(u); return /DOC1$/.test(u) ? new Response(JSON.stringify({ url: 'https://lookaside.test/d', mime_type: mime, file_size: 5 * MB })) : new Response(Buffer.alloc(5 * MB)); };
    await assert.rejects(media(sb, body({ index: 0 }), me, { fetch, waConfig: WA }), /too large/);
    assert.equal(asked.some((u) => /lookaside/.test(u)), false, mime + ': not downloaded');
    assert.deepEqual(store.uploads, []);
  }
});

test('incoming WhatsApp videos are videos (they play in the chat)', () => {
  const c = messageContent({ type: 'video', video: { id: 'V1', mime_type: 'video/mp4', caption: 'The view' } });
  assert.equal(c.type, 'video'); assert.equal(c.text, 'The view'); assert.equal(c.media.id, 'V1');
});
