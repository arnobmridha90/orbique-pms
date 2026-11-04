/* Team chat: staff messaging inside a workspace (app/pages/team.js; docs/notes/team-chat.md). No browser or network code.
 *
 * Arnob: "we need a different messaging section for staff messaging between all the staff or selected staff"
 *
 * Three kinds of chat:
 *   all     one per workspace, id 'all', "All staff": every active staff member who has Team chat in Staff Access is in
 *           it automatically (no member rows needed; a row only keeps that person's read time and mute)
 *   direct  two people; one per pair (dmKey: the two staff ids sorted, joined by ':')
 *   group   a name and the staff chosen by whoever made it; the maker or the account owner renames it and adds or
 *           removes people; anyone in it may leave
 *
 * The same shapes as the database (supabase/migrations/0024_team_chat.sql), camelCase:
 *   chat    {id, kind, name, dmKey, createdBy, createdAt, lastAt}
 *   member  {chatId, staffId, addedBy, addedAt, lastReadAt, muted}
 *   message {id, chatId, sender, body, file: {path | data, name, mime, size} | null, at}
 * Times are ISO strings (UTC). Signed in, the database applies these rules (row level security and the team_* functions);
 * in the local test copy, the page keeps a db = {chats, members, messages} in the browser and uses the functions below.
 *
 * Every word the page and the phone alert show is in STR (one place, for the translation pass later).
 * Shared by the page (inlined by scripts/build.mjs as O.teamchat), api/alerts.js (the phone alert's words) and the node
 * tests (tests/teamchat.test.mjs). ES5.
 */
'use strict';

var ALL_ID = 'all';
var NAME_MAX = 80;
var BODY_MAX = 4000;
var GROUP_MAX = 50;                      // people in one group, the maker included
var FILE_MAX = 20 * 1024 * 1024;         // signed in (Storage bucket team-files)
var LOCAL_FILE_MAX = 1.5 * 1024 * 1024;  // the local test copy keeps files in the browser's storage
var MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'video/mp4', 'video/quicktime'];

var STR = {
  title: 'Team chat',
  desc: 'Messages between the staff of this workspace. Guests never see these.',
  allStaff: 'All staff',
  allStaffSub: 'Everyone on the team',
  newChat: 'New chat',
  newGroup: 'New group',
  newDirect: 'Message one person',
  search: 'Search chats',
  noChats: 'No chats match.',
  pickChat: 'Pick a chat to read it',
  pickChatSub: 'Chats are only for the people in them. The All staff chat has everyone on the team.',
  noMessages: 'No messages yet. Say hello.',
  typeHere: 'Write a message',
  send: 'Send',
  attach: 'Attach a photo or file',
  back: 'Back',
  you: 'You',
  photo: 'Photo',
  video: 'Video',
  file: 'File',
  today: 'Today',
  yesterday: 'Yesterday',
  members: 'People',
  membersN: '{n} people',
  memberYou: '{name} (you)',
  maker: 'made this group',
  rename: 'Rename group',
  addPeople: 'Add people',
  removePerson: 'Remove',
  leave: 'Leave group',
  leaveQ: 'Leave this group? You will not see its messages any more.',
  removeQ: 'Remove {name} from this group?',
  mute: 'Mute phone alerts',
  unmute: 'Unmute phone alerts',
  muted: 'Muted',
  groupName: 'Group name',
  groupNameHint: 'For example Housekeeping or Penang team',
  choosePeople: 'Choose people',
  choosePerson: 'Choose a person',
  create: 'Create group',
  save: 'Save',
  cancel: 'Cancel',
  done: 'Done',
  details: 'Chat details',
  needName: 'Give the group a name.',
  needPeople: 'Choose at least one person.',
  tooMany: 'A group can have up to {n} people.',
  nobody: 'There is nobody else on the team yet.',
  viewOnly: 'You can read this chat but not write in it (Staff Access).',
  paused: 'This workspace is paused, so messages cannot be sent right now.',
  notMember: 'You are not in this chat.',
  fileTooBig: 'Files can be up to {mb} MB.',
  fileType: 'This kind of file cannot be sent. Send photos, PDF, Word, Excel, text or MP4 videos.',
  sendFailed: 'The message could not be sent. Please try again.',
  loadFailed: 'Team chat could not be loaded. Please try again.',
  offline: 'Orbique could not be reached. Check your connection and try again.',
  noAccess: 'Your access does not include this chat.',
  retry: 'Try again',
  openFile: 'Open',
  sentPhoto: 'sent a photo',
  sentFile: 'sent a file',
  sentVideo: 'sent a video',
  newMessage: 'New message in Team chat',
  renamed: 'Group renamed',
  added: 'Added to the group',
  removed: 'Removed from the group',
  left: 'You left the group',
  created: 'Group created',
  mutedToast: 'Phone alerts for this chat are off',
  unmutedToast: 'Phone alerts for this chat are on',
  loading: 'Loading…',
  sending: 'Sending…',
  translated: 'Translated',
  translatedFrom: 'Translated from {lang}',
  seeOriginal: 'See original',
  seeTranslation: 'See translation',
  someone: 'Someone',
  formerStaff: 'Former staff'
};
/* STR[key] with {name} style values filled in */
function t(key, vars) {
  var s = Object.prototype.hasOwnProperty.call(STR, key) ? STR[key] : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] == null ? m : String(vars[k]); });
  return s;
}

function ms(iso) { var n = Date.parse(iso || ''); return isNaN(n) ? 0 : n; }
function str(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max || 200); }
function cleanName(s) { return str(s, 400).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX); }
function cleanBody(s) { return str(s, BODY_MAX + 400).replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, BODY_MAX); }
function validId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id); }
function dmKey(a, b) { return a < b ? a + ':' + b : b + ':' + a; }
function uniq(list) { var out = []; (list || []).forEach(function (x) { if (validId(x) && out.indexOf(x) < 0) out.push(x); }); return out; }

/* a file name that is safe in a Storage path */
function safeName(name) {
  var n = String(name || 'file').normalize ? String(name || 'file').normalize('NFKD') : String(name || 'file');
  n = n.replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/-+\./g, '.').replace(/^[-.]+|[-.]+$/g, '').slice(-80);
  return n || 'file';
}
function fileKind(mime) { mime = String(mime || ''); return /^image\//.test(mime) ? 'image' : /^video\//.test(mime) ? 'video' : 'file'; }
/* why a file cannot be sent ('' when it can); max: bytes */
function checkFile(mime, size, max) {
  if (MIMES.indexOf(String(mime || '').toLowerCase()) < 0) return t('fileType');
  var lim = max || FILE_MAX;
  if (!(size > 0) || size > lim) return t('fileTooBig', { mb: Math.round(lim / 104857.6) / 10 });
  return '';
}

/* ---------- who is in a chat ---------- */
function rowOf(db, chatId, staffId) {
  var m = db.members || [];
  for (var i = 0; i < m.length; i++) if (m[i].chatId === chatId && m[i].staffId === staffId) return m[i];
  return null;
}
/* the staff ids in a chat. active: the staff ids who have Team chat (for 'all', they are all of it; elsewhere, people
   who left the team or lost access drop out of the list but their member row stays) */
function memberIds(db, chat, active) {
  if (!chat) return [];
  if (chat.kind === 'all') return (active || []).slice();
  var act = active ? {} : null; if (act) active.forEach(function (id) { act[id] = 1; });
  return (db.members || []).filter(function (m) { return m.chatId === chat.id && (!act || act[m.staffId]); }).map(function (m) { return m.staffId; });
}
function isMember(db, chat, staffId, active) {
  if (!chat || !staffId) return false;
  if (active && active.indexOf(staffId) < 0) return false;   // no Team chat access, or not active staff
  return chat.kind === 'all' || !!rowOf(db, chat.id, staffId);
}
/* rename, add and remove others: groups only, by the person who made it or the account owner, while in it */
function canManage(db, chat, me, isOwner, active) {
  return !!chat && chat.kind === 'group' && isMember(db, chat, me, active) && (chat.createdBy === me || !!isOwner);
}

/* ---------- unread ---------- */
/* messages from others after `since` (ISO; '' = all of them) */
function unreadCount(messages, me, since) {
  var s = ms(since), n = 0;
  (messages || []).forEach(function (m) { if (m.sender !== me && ms(m.at) > s) n++; });
  return n;
}
/* from when a person's unread count starts in a chat: the last time they read it, else when they joined it (All staff:
   when they joined the team, joinedAt) */
function readSince(chat, row, joinedAt) {
  if (row && row.lastReadAt) return row.lastReadAt;
  if (chat && chat.kind !== 'all' && row && row.addedAt) return row.addedAt;
  return joinedAt || '';
}
function totalUnread(list) { return (list || []).reduce(function (s, c) { return s + (c.unread || 0); }, 0); }
function badge(n) { return n > 99 ? '99+' : String(n); }

/* ---------- words ---------- */
function firstName(name) { return String(name || '').trim().split(/\s+/)[0] || ''; }
/* the chat's name as one person sees it; nameOf(staffId) -> name */
function chatTitle(chat, me, nameOf, members) {
  if (!chat) return '';
  if (chat.kind === 'all') return t('allStaff');
  if (chat.kind === 'direct') {
    var ids = (chat.dmKey || '').split(':'), other = ids[0] === me ? ids[1] : ids[0];
    if (!other && members) other = members.filter(function (x) { return x !== me; })[0];
    return (nameOf && nameOf(other)) || t('formerStaff');
  }
  return chat.name || t('title');
}
function preview(msg) {
  if (!msg) return '';
  var body = String(msg.body || '').replace(/\s+/g, ' ').trim();
  if (body) return body.length > 90 ? body.slice(0, 89) + '…' : body;
  if (msg.file) { var k = fileKind(msg.file.mime); return k === 'image' ? t('photo') : k === 'video' ? t('video') : t('file') + ': ' + str(msg.file.name, 60); }
  return '';
}
/* the phone alert for one message: title and one line */
function pushText(chat, senderName, msg) {
  var who = firstName(senderName) || t('someone'), body = String(msg && msg.body || '').replace(/\s+/g, ' ').trim();
  var what = body ? (body.length > 140 ? body.slice(0, 139) + '…' : body)
    : msg && msg.file ? (fileKind(msg.file.mime) === 'image' ? t('sentPhoto') : fileKind(msg.file.mime) === 'video' ? t('sentVideo') : t('sentFile')) : '';
  if (chat && chat.kind === 'direct') return { title: str(senderName, 80) || t('someone'), body: body ? what : who + ' ' + what };
  var name = chat ? (chat.kind === 'all' ? t('allStaff') : cleanName(chat.name) || t('title')) : t('title');
  return { title: name, body: body ? who + ': ' + what : who + ' ' + what };
}

/* ---------- the list one person sees ----------
   o = {active: [staff ids with Team chat], joinedAt: {staffId: ISO}, isOwner}
   -> [{id, kind, name, dmKey, createdBy, createdAt, lastAt, members: [ids], unread, muted, last: message|null, canManage}]
   All staff first, then the most recent first. */
function list(db, me, o) {
  o = o || {};
  var active = o.active || null, out = [];
  (db.chats || []).forEach(function (c) {
    if (!isMember(db, c, me, active)) return;
    var msgs = (db.messages || []).filter(function (m) { return m.chatId === c.id; });
    var row = rowOf(db, c.id, me), last = null;
    msgs.forEach(function (m) { if (!last || ms(m.at) >= ms(last.at)) last = m; });
    out.push({ id: c.id, kind: c.kind, name: c.name || '', dmKey: c.dmKey || null, createdBy: c.createdBy || null, createdAt: c.createdAt,
      lastAt: last ? last.at : c.lastAt || c.createdAt, members: memberIds(db, c, active),
      unread: unreadCount(msgs, me, readSince(c, row, o.joinedAt && o.joinedAt[me])), muted: !!(row && row.muted), last: last,
      canManage: canManage(db, c, me, o.isOwner, active) });
  });
  return sortChats(out);
}
function sortChats(arr) {
  return arr.sort(function (a, b) {
    if ((a.kind === 'all') !== (b.kind === 'all')) return a.kind === 'all' ? -1 : 1;
    return ms(b.lastAt) - ms(a.lastAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}
/* a chat's messages, oldest first (newest at the bottom) */
function thread(db, chatId) {
  return (db.messages || []).filter(function (m) { return m.chatId === chatId; }).sort(function (a, b) { return ms(a.at) - ms(b.at) || (a.id < b.id ? -1 : 1); });
}

/* ---------- changes (the local test copy; the database's team_* functions apply the same rules) ----------
   Each returns {ok: true, ...} or {ok: false, error: STR text}; o = {now: ISO, uid: fn(prefix) -> id, active, isOwner} */
function fail(key, vars) { return { ok: false, error: t(key, vars) }; }
function ensureAll(db, now) {
  db.chats = db.chats || []; db.members = db.members || []; db.messages = db.messages || [];
  if (!db.chats.some(function (c) { return c.id === ALL_ID; })) db.chats.push({ id: ALL_ID, kind: 'all', name: '', dmKey: null, createdBy: null, createdAt: now, lastAt: now });
  return db;
}
function openDirect(db, me, other, o) {
  ensureAll(db, o.now);
  if (!validId(other) || other === me) return fail('choosePerson');
  if (o.active && (o.active.indexOf(me) < 0 || o.active.indexOf(other) < 0)) return fail('noAccess');
  var key = dmKey(me, other), hit = db.chats.filter(function (c) { return c.kind === 'direct' && c.dmKey === key; })[0];
  if (hit) {
    [me, other].forEach(function (id) { if (!rowOf(db, hit.id, id)) db.members.push({ chatId: hit.id, staffId: id, addedBy: me, addedAt: o.now, lastReadAt: null, muted: false }); });
    return { ok: true, id: hit.id, existed: true };
  }
  var id = o.uid('d');
  db.chats.push({ id: id, kind: 'direct', name: '', dmKey: key, createdBy: me, createdAt: o.now, lastAt: o.now });
  [me, other].forEach(function (sid) { db.members.push({ chatId: id, staffId: sid, addedBy: me, addedAt: o.now, lastReadAt: null, muted: false }); });
  return { ok: true, id: id, existed: false };
}
function createGroup(db, me, name, staffIds, o) {
  ensureAll(db, o.now);
  var n = cleanName(name); if (!n) return fail('needName');
  var ids = uniq(staffIds).filter(function (x) { return x !== me; });
  if (!ids.length) return fail('needPeople');
  if (ids.length + 1 > GROUP_MAX) return fail('tooMany', { n: GROUP_MAX });
  if (o.active && ids.concat([me]).some(function (x) { return o.active.indexOf(x) < 0; })) return fail('noAccess');
  var id = o.uid('g');
  db.chats.push({ id: id, kind: 'group', name: n, dmKey: null, createdBy: me, createdAt: o.now, lastAt: o.now });
  [me].concat(ids).forEach(function (sid) { db.members.push({ chatId: id, staffId: sid, addedBy: me, addedAt: o.now, lastReadAt: sid === me ? o.now : null, muted: false }); });
  return { ok: true, id: id };
}
/* ch = {name?, add?: [ids], remove?: [ids]}; anyone in a group may remove themselves (leave) */
function manage(db, me, chatId, ch, o) {
  var chat = (db.chats || []).filter(function (c) { return c.id === chatId; })[0];
  if (!chat || !isMember(db, chat, me, o.active)) return fail('notMember');
  if (chat.kind !== 'group') return fail('noAccess');
  var boss = canManage(db, chat, me, o.isOwner, o.active), add = uniq(ch.add), remove = uniq(ch.remove);
  var onlySelf = ch.name == null && !add.length && remove.length === 1 && remove[0] === me;
  if (!boss && !onlySelf) return fail('noAccess');
  if (ch.name != null) { var n = cleanName(ch.name); if (!n) return fail('needName'); chat.name = n; }
  if (add.length) {
    if (o.active && add.some(function (x) { return o.active.indexOf(x) < 0; })) return fail('noAccess');
    var now = db.members.filter(function (m) { return m.chatId === chatId; }).length;
    var fresh = add.filter(function (x) { return !rowOf(db, chatId, x); });
    if (now + fresh.length > GROUP_MAX) return fail('tooMany', { n: GROUP_MAX });
    fresh.forEach(function (x) { db.members.push({ chatId: chatId, staffId: x, addedBy: me, addedAt: o.now, lastReadAt: null, muted: false }); });
  }
  if (remove.length) db.members = db.members.filter(function (m) { return !(m.chatId === chatId && remove.indexOf(m.staffId) >= 0); });
  return { ok: true };
}
function upsertRow(db, chatId, me, now) {
  var row = rowOf(db, chatId, me);
  if (!row) { row = { chatId: chatId, staffId: me, addedBy: me, addedAt: now, lastReadAt: null, muted: false }; db.members.push(row); }
  return row;
}
function markRead(db, me, chatId, o) {
  var chat = (db.chats || []).filter(function (c) { return c.id === chatId; })[0];
  if (!chat || !isMember(db, chat, me, o.active)) return fail('notMember');
  upsertRow(db, chatId, me, o.now).lastReadAt = o.now;
  return { ok: true };
}
function setMuted(db, me, chatId, muted, o) {
  var chat = (db.chats || []).filter(function (c) { return c.id === chatId; })[0];
  if (!chat || !isMember(db, chat, me, o.active)) return fail('notMember');
  upsertRow(db, chatId, me, o.now).muted = !!muted;
  return { ok: true };
}
/* msg = {body, file}; o.canSend: false for view-only access */
function addMessage(db, me, chatId, msg, o) {
  var chat = (db.chats || []).filter(function (c) { return c.id === chatId; })[0];
  if (!chat || !isMember(db, chat, me, o.active)) return fail('notMember');
  if (o.canSend === false) return fail('viewOnly');
  var body = cleanBody(msg && msg.body), file = msg && msg.file ? msg.file : null;
  if (!body && !file) return fail('typeHere');
  var last = thread(db, chatId).pop(), at = o.now;
  if (last && ms(at) <= ms(last.at)) at = new Date(ms(last.at) + 1000).toISOString();   // stays after the last one
  var m = { id: o.uid('m'), chatId: chatId, sender: me, body: body, file: file, at: at };
  db.messages.push(m); chat.lastAt = at;
  upsertRow(db, chatId, me, at).lastReadAt = at;
  return { ok: true, message: m };
}

module.exports = {
  ALL_ID: ALL_ID, NAME_MAX: NAME_MAX, BODY_MAX: BODY_MAX, GROUP_MAX: GROUP_MAX, FILE_MAX: FILE_MAX, LOCAL_FILE_MAX: LOCAL_FILE_MAX, MIMES: MIMES,
  STR: STR, t: t, ms: ms, cleanName: cleanName, cleanBody: cleanBody, validId: validId, dmKey: dmKey, safeName: safeName,
  fileKind: fileKind, checkFile: checkFile, memberIds: memberIds, isMember: isMember, canManage: canManage,
  unreadCount: unreadCount, readSince: readSince, totalUnread: totalUnread, badge: badge, firstName: firstName,
  chatTitle: chatTitle, preview: preview, pushText: pushText, list: list, sortChats: sortChats, thread: thread,
  ensureAll: ensureAll, openDirect: openDirect, createGroup: createGroup, manage: manage, markRead: markRead, setMuted: setMuted,
  addMessage: addMessage
};
