/* Team chat (api/_lib/shared/teamchat.cjs, O.teamchat; app/pages/team.js): who is in which chat, unread counts, mark
 * read, groups and direct chats, the words of a phone alert, files, and the Team chat phone alert (api/_lib/alerts.js
 * sendTeamPush). The database applies the same rules: tests/sql/team_chat.sql.
 *
 *   node --test tests/teamchat.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import TC from '../api/_lib/shared/teamchat.cjs';
import { fakeSb, op } from './inbox/fake-sb.mjs';
import { pushConfig, sendTeamPush, sendPush, resetTokenCache, TEAM_CHANNEL } from '../api/_lib/alerts.js';

const T0 = '2026-11-03T02:00:00.000Z';
const at = (min) => new Date(Date.parse(T0) + min * 60000).toISOString();
let n = 0;
const opts = (extra = {}) => Object.assign({ now: at(0), uid: (p) => p + '-' + (++n), active: ['u1', 's2', 's3', 's4', 's5'], isOwner: false }, extra);
const empty = () => TC.ensureAll({}, at(-1000));

test('direct chats: one per pair, either way round, only the two are in it', () => {
  const db = empty();
  assert.equal(TC.dmKey('s3', 's2'), 's2:s3');
  const a = TC.openDirect(db, 's2', 's3', opts());
  const b = TC.openDirect(db, 's3', 's2', opts());
  assert.ok(a.ok && b.ok);
  assert.equal(a.id, b.id);
  assert.equal(b.existed, true);
  assert.equal(db.chats.filter((c) => c.kind === 'direct').length, 1);
  const chat = db.chats.find((c) => c.id === a.id);
  assert.equal(TC.isMember(db, chat, 's2'), true);
  assert.equal(TC.isMember(db, chat, 's4'), false);
  assert.deepEqual(TC.memberIds(db, chat).sort(), ['s2', 's3']);
  assert.equal(TC.openDirect(db, 's2', 's2', opts()).ok, false, 'not with yourself');
  assert.equal(TC.openDirect(db, 's2', 's9', opts()).ok, false, 'not with someone outside the team');
  assert.equal(TC.manage(db, 's2', a.id, { add: ['s4'] }, opts()).ok, false, 'nobody is added to a direct chat');
  assert.equal(TC.chatTitle(chat, 's2', (id) => ({ s3: 'Kavya Nair' })[id]), 'Kavya Nair');
});

test('All staff: everyone with Team chat is in it, nobody else; it lists first', () => {
  const db = empty();
  const all = db.chats.find((c) => c.id === TC.ALL_ID);
  assert.equal(all.kind, 'all');
  const active = ['u1', 's2', 's3'];
  assert.equal(TC.isMember(db, all, 's3', active), true);
  assert.equal(TC.isMember(db, all, 's7', active), false, 'Team chat switched off (not in the active list)');
  assert.deepEqual(TC.memberIds(db, all, active), active);
  TC.openDirect(db, 'u1', 's2', opts());
  TC.addMessage(db, 's2', db.chats[1].id, { body: 'newer' }, opts({ now: at(5) }));
  const list = TC.list(db, 'u1', { active });
  assert.equal(list[0].id, 'all', 'All staff first even when another chat is newer');
  assert.equal(TC.chatTitle(all, 'u1'), 'All staff');
  assert.deepEqual(TC.list(db, 's7', { active }), [], 'someone without Team chat sees nothing');
  assert.equal(TC.ensureAll(db, at(9)).chats.filter((c) => c.id === 'all').length, 1, 'only one All staff');
});

test('groups: the maker or the owner manages, members may leave, outsiders see nothing', () => {
  const db = empty();
  assert.equal(TC.createGroup(db, 's2', '   ', ['s3'], opts()).ok, false, 'needs a name');
  assert.equal(TC.createGroup(db, 's2', 'HK', [], opts()).ok, false, 'needs people');
  assert.equal(TC.createGroup(db, 's2', 'HK', ['s2'], opts()).ok, false, 'the maker alone is not a group');
  assert.equal(TC.createGroup(db, 's2', 'HK', ['s3', 's9'], opts()).ok, false, 'not with someone outside the team');
  const many = Array.from({ length: TC.GROUP_MAX }, (_, i) => 'x' + i);
  assert.match(TC.createGroup(db, 's2', 'Big', many, opts({ active: null })).error, /up to 50/);
  const g = TC.createGroup(db, 's2', '  Housekeeping   team  ', ['s3', 's3', 's4'], opts());
  assert.ok(g.ok);
  const chat = db.chats.find((c) => c.id === g.id);
  assert.equal(chat.name, 'Housekeeping team');
  assert.deepEqual(TC.memberIds(db, chat).sort(), ['s2', 's3', 's4']);
  assert.equal(TC.canManage(db, chat, 's2', false), true);
  assert.equal(TC.canManage(db, chat, 's3', false), false);
  assert.equal(TC.canManage(db, chat, 'u1', true), false, 'the owner manages only a group they are in');
  // a member who did not make it
  assert.equal(TC.manage(db, 's3', g.id, { name: 'Mine' }, opts()).ok, false);
  assert.equal(TC.manage(db, 's3', g.id, { add: ['s5'] }, opts()).ok, false);
  assert.equal(TC.manage(db, 's3', g.id, { remove: ['s4'] }, opts()).ok, false);
  assert.equal(TC.manage(db, 's5', g.id, { remove: ['s5'] }, opts()).ok, false, 'an outsider cannot touch it');
  // the maker
  assert.ok(TC.manage(db, 's2', g.id, { name: 'HK', add: ['u1', 's5'] }, opts()).ok);
  assert.equal(chat.name, 'HK');
  // the owner, now in it
  assert.equal(TC.canManage(db, chat, 'u1', true), true);
  assert.ok(TC.manage(db, 'u1', g.id, { remove: ['s5'] }, opts({ isOwner: true })).ok);
  // leaving
  assert.ok(TC.manage(db, 's3', g.id, { remove: ['s3'] }, opts()).ok);
  assert.equal(TC.isMember(db, chat, 's3'), false);
  assert.equal(TC.list(db, 's3', { active: opts().active }).some((c) => c.id === g.id), false, 'a leaver no longer sees it');
  assert.equal(TC.addMessage(db, 's3', g.id, { body: 'hi' }, opts()).ok, false, 'nor writes in it');
});

test('unread: others\' messages after the last read; own messages never; history before joining is not unread', () => {
  const db = empty();
  const g = TC.createGroup(db, 's2', 'Ops', ['s3'], opts({ now: at(0) }));
  TC.addMessage(db, 's2', g.id, { body: 'one' }, opts({ now: at(1) }));
  TC.addMessage(db, 's2', g.id, { body: 'two' }, opts({ now: at(2) }));
  TC.addMessage(db, 's3', g.id, { body: 'mine' }, opts({ now: at(3) }));
  let s3 = TC.list(db, 's3', opts()).find((c) => c.id === g.id);
  assert.equal(s3.unread, 0, 'writing in a chat reads it');
  TC.addMessage(db, 's2', g.id, { body: 'three' }, opts({ now: at(4) }));
  s3 = TC.list(db, 's3', opts()).find((c) => c.id === g.id);
  assert.equal(s3.unread, 1);
  assert.equal(s3.last.body, 'three');
  assert.equal(TC.list(db, 's2', opts()).find((c) => c.id === g.id).unread, 0, 'the sender has nothing unread');
  // someone added later: earlier messages are history, not unread
  TC.manage(db, 's2', g.id, { add: ['s4'] }, opts({ now: at(5) }));
  assert.equal(TC.list(db, 's4', opts()).find((c) => c.id === g.id).unread, 0);
  TC.addMessage(db, 's2', g.id, { body: 'four' }, opts({ now: at(6) }));
  assert.equal(TC.list(db, 's4', opts()).find((c) => c.id === g.id).unread, 1);
  assert.ok(TC.markRead(db, 's4', g.id, opts({ now: at(7) })).ok);
  assert.equal(TC.list(db, 's4', opts()).find((c) => c.id === g.id).unread, 0);
  assert.equal(TC.markRead(db, 's5', g.id, opts()).ok, false, 'an outsider cannot mark it read');
  // All staff: from when the person joined the team, unless they read it since
  TC.addMessage(db, 's2', 'all', { body: 'hello all' }, opts({ now: at(10) }));
  assert.equal(TC.list(db, 's5', opts()).find((c) => c.id === 'all').unread, 1, 'no read time and no joining time: unread');
  assert.equal(TC.list(db, 's5', Object.assign(opts(), { joinedAt: { s5: at(11) } })).find((c) => c.id === 'all').unread, 0, 'joined after it');
  TC.markRead(db, 's5', 'all', opts({ now: at(12) }));
  assert.equal(TC.list(db, 's5', opts()).find((c) => c.id === 'all').unread, 0);
  // the menu total and its badge
  const total = TC.totalUnread([{ unread: 2 }, { unread: 0 }, { unread: 5 }]);
  assert.equal(total, 7);
  assert.equal(TC.badge(120), '99+');
  assert.equal(TC.unreadCount([{ sender: 'a', at: at(1) }, { sender: 'b', at: at(2) }, { sender: 'b', at: at(0) }], 'a', at(0)), 1);
  assert.equal(TC.readSince({ kind: 'group' }, { addedAt: at(3), lastReadAt: null }, at(1)), at(3));
  assert.equal(TC.readSince({ kind: 'all' }, { addedAt: at(3), lastReadAt: null }, at(1)), at(1));
});

test('messages: newest at the bottom, in order even with the same clock; empty and view-only refused; mute', () => {
  const db = empty();
  const a = TC.addMessage(db, 's2', 'all', { body: '  first  ' }, opts({ now: at(1) }));
  const b = TC.addMessage(db, 's3', 'all', { body: 'second' }, opts({ now: at(1) }));
  assert.equal(a.message.body, 'first');
  assert.ok(Date.parse(b.message.at) > Date.parse(a.message.at), 'a message never sorts before the one it answers');
  assert.deepEqual(TC.thread(db, 'all').map((m) => m.body), ['first', 'second']);
  assert.equal(TC.addMessage(db, 's2', 'all', { body: '   ' }, opts()).ok, false);
  assert.equal(TC.addMessage(db, 's2', 'all', { body: 'x' }, opts({ canSend: false })).ok, false);
  assert.equal(TC.cleanBody('x'.repeat(5000)).length, TC.BODY_MAX);
  assert.ok(TC.addMessage(db, 's2', 'all', { body: '', file: { data: 'data:image/png;base64,AA', name: 'a.png', mime: 'image/png', size: 2 } }, opts({ now: at(3) })).ok, 'a photo alone');
  assert.ok(TC.setMuted(db, 's3', 'all', true, opts()).ok);
  assert.equal(TC.list(db, 's3', opts()).find((c) => c.id === 'all').muted, true);
  assert.equal(TC.list(db, 's2', opts()).find((c) => c.id === 'all').muted, false, 'mute is per person');
});

test('files and words', () => {
  assert.equal(TC.checkFile('image/jpeg', 1000), '');
  assert.match(TC.checkFile('application/x-msdownload', 10), /cannot be sent/);
  assert.match(TC.checkFile('application/pdf', TC.FILE_MAX + 1), /up to 20 MB/);
  assert.match(TC.checkFile('application/pdf', 2e6, TC.LOCAL_FILE_MAX), /up to 1\.5 MB/);
  assert.equal(TC.fileKind('image/heic'), 'image');
  assert.equal(TC.fileKind('video/mp4'), 'video');
  assert.equal(TC.fileKind('application/pdf'), 'file');
  assert.equal(TC.safeName('../Résumé final (1).pdf'), 'Resume-final-1.pdf');
  assert.ok(!/[/\\]/.test(TC.safeName('a/b\\c.jpg')));
  assert.equal(TC.preview({ body: '', file: { mime: 'image/jpeg' } }), 'Photo');
  assert.equal(TC.preview({ body: '', file: { mime: 'application/pdf', name: 'Quote.pdf' } }), 'File: Quote.pdf');
  assert.equal(TC.t('membersN', { n: 4 }), '4 people');
  assert.deepEqual(TC.pushText({ kind: 'direct' }, 'Wei Ling Tan', { body: 'Can you call me?' }), { title: 'Wei Ling Tan', body: 'Can you call me?' });
  assert.deepEqual(TC.pushText({ kind: 'all' }, 'Wei Ling Tan', { body: 'Lift broken' }), { title: 'All staff', body: 'Wei: Lift broken' });
  assert.deepEqual(TC.pushText({ kind: 'group', name: 'Housekeeping' }, 'Kavya Nair', { body: '', file: { mime: 'image/png' } }), { title: 'Housekeeping', body: 'Kavya sent a photo' });
  assert.equal(TC.pushText({ kind: 'group', name: 'G' }, '', { body: 'x'.repeat(300) }).body.length, 'Someone: '.length + 140);
});

test('every word the page shows comes from STR', () => {
  const src = fs.readFileSync(new URL('../app/pages/team.js', import.meta.url), 'utf8');
  const keys = [...src.matchAll(/\bt\('([A-Za-z]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 40);
  const missing = [...new Set(keys)].filter((k) => !Object.prototype.hasOwnProperty.call(TC.STR, k));
  assert.deepEqual(missing, []);
});

test('the Team chat phone alert: only the chosen people\'s phones, the Team chat channel, a chat\'s alerts grouped', async () => {
  resetTokenCache();
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const SA = { project_id: 'orbique-test', client_email: 'alerts@orbique-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'http://oauth.test/token' };
  const cfg = pushConfig({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), FCM_URL: 'http://fcm.test' });
  const asked = [];
  const sb = fakeSb({ handler: (table, ops) => {
    if (table === 'push_devices' && ops[0][0] === 'select') { asked.push(ops); return { data: [{ token: 'tok-a' }, { token: 'tok-b' }], error: null }; }
    return { data: null, error: null };
  } });
  const sent = [];
  const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
  const fetch = async (url, init) => {
    if (url === 'http://oauth.test/token') return reply(200, { access_token: 'ya29.test', expires_in: 3600 });
    sent.push(JSON.parse(init.body).message); return reply(200, { name: 'm' });
  };
  const text = TC.pushText({ kind: 'group', name: 'Housekeeping' }, 'Kavya Nair', { body: 'Towels are in' });
  const r = await sendTeamPush(sb, cfg, 'org-1', ['user-a', 'user-b', 'user-a', null], text, { kind: 'team', chatId: 'g123' }, { fetch });
  assert.equal(r.sent, 2);
  assert.deepEqual(op(asked[0], 'in', 'user_id'), ['user-a', 'user-b'], 'phones of those people only, each once');
  assert.equal(op(asked[0], 'eq', 'org_id'), 'org-1');
  assert.equal(sent[0].notification.title, 'Housekeeping');
  assert.equal(sent[0].notification.body, 'Kavya: Towels are in');
  assert.deepEqual(sent[0].data, { kind: 'team', chatId: 'g123' });
  assert.equal(sent[0].android.notification.channel_id, TEAM_CHANNEL);
  assert.equal(sent[0].android.notification.tag, 'team-g123');
  assert.equal(sent[0].apns.payload.aps.sound, 'default');
  // nobody, or not set up: nothing is sent
  assert.equal((await sendTeamPush(sb, cfg, 'org-1', [], text, {}, { fetch })).sent, 0);
  assert.equal((await sendTeamPush(sb, pushConfig({}), 'org-1', ['user-a'], text, {}, { fetch })).sent, 0);
  // booking alerts go only to the phones registered for them (owners and ops managers)
  const bookingAsk = [];
  const sb2 = fakeSb({ handler: (table, ops) => { if (table === 'push_devices') bookingAsk.push(ops); return { data: [], error: null }; } });
  await sendPush(sb2, cfg, 'org-1', { title: 'x', lines: ['y'] }, {}, { fetch });
  assert.equal(op(bookingAsk[0], 'eq', 'booking_alerts'), true);
});

test('the bridge opens a Team chat alert and the app registers every member\'s phone', () => {
  const src = fs.readFileSync(new URL('../app/native/bridge.js', import.meta.url), 'utf8');
  assert.match(src, /kind === 'team'/);
  assert.match(src, /O\.go\('team', \{ chatId: nd\.chatId \}\)/);
  assert.match(src, /id: 'team_chat'/);
  const api = fs.readFileSync(new URL('../api/alerts.js', import.meta.url), 'utf8');
  assert.match(api, /booking_alerts: bookingAlerts/);
});
