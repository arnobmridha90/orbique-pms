/* POST /api/messages  {action, orgId, ...}   the live inbox for one workspace
 *
 *   config                                      inbox viewer   {whatsapp: {configured, number}, channex, translate, lang};
 *                                                              also empties Deleted of chats older than 30 days (purgeTrash)
 *   send        {conversationId, text, via ('whatsapp' | 'channex'), orig?, origLang?, lang?}
 *                                               inbox.send     -> {conversation}: the record after the reply was added
 *   translate   {conversationId, index, to?}    inbox viewer   one message into the team's language (or `to`), saved
 *   preview     {text, to}                      inbox.send     a reply in the guest's language, to check before sending
 *   media       {conversationId, index}         inbox viewer   a file in the chat: one the guest sent on WhatsApp ->
 *                                                              {mime, name, data (base64)}, or for photos and videos over
 *                                                              MEDIA_MAX (up to MEDIA_BIG; other files stay at MEDIA_MAX)
 *                                                              and photos / videos the team sent (m.file.path in
 *                                                              Storage) {mime, name, url (signed, one hour)}
 *   media-upload {conversationId, via, mime, size, name}
 *                                               inbox.send     where the browser uploads one photo or video before sending:
 *                                                              {bucket, path, token} for Storage's uploadToSignedUrl. Type and
 *                                                              size are checked here and again in send-media (MEDIA). A file
 *                                                              not sent within a day is removed (0022 inbox_uploads).
 *   send-media  {conversationId, via, path, caption?, name?}
 *                                               inbox.send     send that file to the guest -> {conversation}; WhatsApp gets a
 *                                                              signed link, email an attachment, booking sites (photos only)
 *                                                              a Channex attachment
 *   organize    {conversationIds | conversationId, op, listId?}
 *                                               inbox.edit     op pin / unpin, archive / unarchive, read / unread, list-add /
 *                                                              list-remove (listId), delete (to Deleted) / restore;
 *                                               inbox viewer   favourite / unfavourite (personal: by the caller's user id)
 *                                                              -> {conversations: [{id, data}]} (at most 200 chats per call)
 *   purge       {conversationIds | conversationId}
 *                                               inbox.edit     remove chats in Deleted for good: their files, then the record
 *                                                              (kept as a tombstone, deleted = true, so other devices drop it)
 *                                                              -> {removed, failed} (failed: Storage refused; still in Deleted)
 *   lists       {op: 'add' | 'rename' | 'remove', id?, name?}
 *                                               inbox.edit     the workspace's named lists (blob inboxLists [{id, name}]);
 *                                                              removing one takes it off every chat -> {lists, conversations}
 *   whatsapp-connect    {phoneNumberId}         owner          this workspace answers on that WhatsApp business number
 *   whatsapp-disconnect                         owner
 *   sites-on                                    owner          switch on booking-site messages and reviews (the Channex
 *                                                              Messaging & Reviews app) for every connected building, then
 *                                                              fetch the reviews and recent conversations already there
 *   review-reply        {reviewId, text}        reviews.reply  the public reply to a booking-site review
 *   greeting    {conversationId, greetingId, via}
 *                                               inbox viewer   send the building's greeting message, filled here for the
 *                                                              chat's booking (api/_lib/shared/greeting.cjs) at the server's
 *                                                              clock, exactly as written -> {conversation}. Owner and every
 *                                                              employee who can open the inbox may send it, even without
 *                                                              inbox.send (who has inbox.send may edit it and use `send`).
 *                                                              It always goes in full: door code, private fields, unit
 *                                                              number and Wi-Fi, with no time or ID-check hold.
 *                                                              Only a greeting last saved by someone who may write greetings
 *                                                              (inbox.greetings) is sent. Without inbox.send the same greeting
 *                                                              goes to a chat at most once in GREETING_REPEAT_MS.
 *   greeting-preview {conversationId, greetingId}
 *                                               inbox viewer   the text as it would go now ->
 *                                                              {id, name, text, parts, checkInAt, early, missing, masked};
 *                                                              door codes and private fields are "[door code hidden]" for a
 *                                                              caller without guestapp.doorCodes (the send uses the real ones)
 *
 * `send` also takes via 'email': the reply goes from the workspace's Orbique address (config.email.address), so the
 * guest's answer comes back into the same conversation.
 *
 * A chat in Archived or Deleted comes back to the main list when the guest writes again (0022 inbox_append). Chats stay
 * in Deleted for TRASH_DAYS (30) and are then removed for good, with their files.
 *
 * Sign-in: "Authorization: Bearer <Supabase access token>"; the caller must be an active member of an active workspace.
 * Demo workspaces never send anything. Tokens and keys never leave the server; nothing here returns them.
 */
import { ApiError, ok, fail, send, cors, readJson, bearer, bad, forbidden, conflict, tooMany, id as idField, uuid as uuidField } from './_lib/http.js';
import { requireAdminClient, caller, getOrg, membership } from './_lib/supabase.js';
import { channexConfig } from './_lib/channex.js';
import { must, record, blob, tracked } from './_lib/channex-db.js';
import { waConfig, withToken, fetchMedia, phoneNumberInfo, WhatsAppError } from './_lib/whatsapp.js';
import { connectWithSignup } from './_lib/whatsapp-connect.js';
import { appUrl } from './_lib/alerts.js';
import { translateConfig, translate, langCode, TranslateError, MAX_CHARS } from './_lib/translate.js';
import { canInbox, sendReply, patchMsg, numberOf, tokenOf, inboxSettings, receiveChannex, myt, routes, VIA_NAME, MEDIA_BUCKET, checkMedia, mediaKind, mediaPath, ownsPath, signedUrl, sendMediaReply, markConv, purgeTrash, forgetConv, noteUpload, uploadSent } from './_lib/inbox.js';
import { allowedOrg } from './channex.js';
import { inboundConfig, addressFor } from './_lib/email-in.js';
import { pullReviews, replyReview } from './_lib/reviews.js';
import GREETING from './_lib/shared/greeting.cjs';

export const SITES_BUDGET_MS = 15000; // Vercel stops api functions at 20 s (vercel.json)
export const BACKFILL_THREADS = 15;
export const GREETING_REPEAT_MS = 10 * 60000; // without inbox.send: the same greeting to the same chat at most once in 10 minutes
export const MEDIA_MAX = 3 * 1024 * 1024; // base64 grows it by a third; Vercel answers at most 4.5 MB
export const MEDIA_BIG = 16 * 1024 * 1024; // a guest's WhatsApp video up to this goes through Storage instead
export const ORGANIZE_MAX = 200;
export const LISTS_MAX = 30;

// Booking-site chat and reviews through Channex's Messaging & Reviews app (switched on 2026-10-19). A building without
// the app answers 403, which the inbox explains; `sites-on` installs it.
export const CHANNEX_MESSAGES = true;
function channexMessages(cx, orgId) { return CHANNEX_MESSAGES && allowedOrg(cx, orgId); }

async function workspace(sb, body, me, need) {
  const orgId = uuidField(body.orgId);
  const m = await membership(sb, orgId, me.id);
  if (!m || m.status !== 'active') throw forbidden('You are not a member of this workspace.');
  const org = await getOrg(sb, orgId);
  if (org.status !== 'active') throw forbidden('This workspace is paused. Please contact Orbique.');
  if (need === 'owner') { if (m.role !== 'owner') throw forbidden('Only the account owner of this workspace can do that.'); }
  else if (!(await canInbox(sb, orgId, m, need || 'inbox'))) throw forbidden(need === 'inbox.send' ? 'Your access does not include messaging guests.' : need === 'reviews.reply' ? 'Your access does not include replying to reviews.' : need === 'inbox.edit' ? 'Your access to the inbox is read only.' : 'Your access does not include the inbox.');
  return { org, member: m };
}

async function isDemo(sb, orgId) {
  const meta = await blob(sb, orgId, 'workspaceMeta');
  return !!(meta && typeof meta === 'object' && meta.demo === true);
}

async function conversation(sb, orgId, id) {
  const c = await record(sb, orgId, 'conversations', idField(id, 'Conversation'));
  if (!c) throw bad('not-found', 'This conversation is no longer there. Refresh the inbox.');
  return c;
}

function message(c, index) {
  const i = Number(index);
  const list = Array.isArray(c.messages) ? c.messages : [];
  if (!Number.isInteger(i) || i < 0 || i >= list.length || !list[i] || typeof list[i] !== 'object') throw bad('not-found', 'This message is no longer there. Refresh the inbox.');
  return { i, m: list[i] };
}

function translateFailure(e) {
  if (e instanceof TranslateError) return new ApiError(e.retryable ? 502 : 400, 'translate', e.message);
  return e;
}

/* ---------- actions ---------- */

async function config(sb, body, me) {
  const ws = await workspace(sb, body, me);
  const wa = waConfig();
  const num = await numberOf(sb, ws.org.id);
  const cx = channexConfig();
  const settings = await inboxSettings(sb, ws.org.id);
  const demo = await isDemo(sb, ws.org.id);
  const em = inboundConfig();
  let address = null;
  if (!demo && em.domain) { try { address = await addressFor(sb, em, ws.org, me.id); } catch (e) { console.error('[messages] email address:', e && e.message); } }
  const sites = await blob(sb, ws.org.id, 'inboxSites').catch(() => null);
  try { await purgeTrash(sb, ws.org.id); } catch (e) { console.error('[messages] empty Deleted:', e && e.message); } // lazy: the nightly job does it too
  return {
    whatsapp: {
      configured: wa.configured, manual: wa.configured && !!wa.token,
      signup: wa.signup ? { appId: wa.appId, configId: wa.configId, version: wa.version } : null,
      number: num ? { phone: num.display_phone || null, name: num.verified_name || null, coexist: !!num.coexist, sync: syncView(num.sync) } : null
    },
    channex: channexMessages(cx, ws.org.id),
    translate: translateConfig().configured,
    lang: settings.lang, autoTranslate: settings.autoTranslate,
    email: { configured: em.configured, address, reply: !!em.key && !!address },
    sites: sites && typeof sites === 'object' ? { on: !!sites.on, at: sites.at || null, buildings: Array.isArray(sites.buildings) ? sites.buildings : [] } : null,
    demo
  };
}

/** What the settings show about the phone app's contacts and older chats, and a disconnection from the phone. */
function syncView(v) {
  if (!v || typeof v !== 'object') return null;
  const one = (x) => (x && typeof x === 'object' ? { at: x.at || null, ok: !x.error } : null);
  return { contacts: one(v.contacts), history: one(v.history), disconnected: v.disconnected && typeof v.disconnected === 'object' ? { at: v.disconnected.at || null } : null };
}

/** The route a reply goes by: {via, cx, fromAddress} (the same checks for `send` and `greeting`). */
async function replyRoute(sb, ws, body, me) {
  const via = body.via === 'whatsapp' || body.via === 'channex' || body.via === 'email' ? body.via : null;
  if (!via) throw bad('bad-via', 'Choose how to send it.');
  const cx = channexConfig();
  if (via === 'channex' && !channexMessages(cx, ws.org.id)) throw forbidden('Booking site messages are not switched on for this workspace yet.');
  let fromAddress = null;
  if (via === 'email') {
    const em = inboundConfig();
    if (!em.key || !em.domain) throw new ApiError(503, 'not-configured', 'Email is not set up on the server yet.');
    fromAddress = await addressFor(sb, em, ws.org, me.id);
  }
  return { via, cx, fromAddress };
}

async function sendAction(sb, body, me) {
  const ws = await workspace(sb, body, me, 'inbox.send');
  if (await isDemo(sb, ws.org.id)) throw forbidden('This is a demo workspace, so nothing is sent to guests.');
  const conv = await conversation(sb, ws.org.id, body.conversationId);
  const booking = conv.bookingId ? await record(sb, ws.org.id, 'bookings', String(conv.bookingId)) : null;
  const { via, cx, fromAddress } = await replyRoute(sb, ws, body, me);
  const data = await sendReply(sb, {
    orgId: ws.org.id, conv, booking, via, text: typeof body.text === 'string' ? body.text : '',
    orig: typeof body.orig === 'string' ? body.orig.slice(0, 4096) : null, origLang: body.origLang, lang: body.lang,
    staffId: ws.member.staff_id || null, userId: me.id, channexConfig: cx, fromAddress, fromName: ws.org.name
  });
  return { conversation: { id: conv.id, data } };
}

/* ---------- greeting messages (api/_lib/shared/greeting.cjs) ---------- */

/**
 * The greeting filled for a chat's booking, from the records as they are now (never from what the page sent):
 * -> {conv, booking, greeting, filled: {text, parts, checkInAt, early, missing}}. o = {mask, now (ms)}.
 */
export async function greetingFor(sb, orgId, body, o = {}) {
  const conv = await conversation(sb, orgId, body.conversationId);
  const booking = conv.bookingId ? await record(sb, orgId, 'bookings', String(conv.bookingId)) : null;
  if (!booking || !booking.guest) throw bad('no-booking', 'This chat is not linked to a booking, so there is no greeting to fill.');
  const unit = booking.propertyId ? await record(sb, orgId, 'properties', String(booking.propertyId)) : null;
  const typeId = booking.unitTypeId || (unit && unit.unitTypeId) || null;
  const unitType = typeId ? await record(sb, orgId, 'unitTypes', String(typeId)) : null;
  const buildingId = (unit && unit.buildingId) || (unitType && unitType.buildingId) || null;
  const building = buildingId ? await record(sb, orgId, 'buildings', String(buildingId)) : null;
  const row = must(await sb.from('records').select('id, data, updated_by').eq('org_id', orgId).eq('coll', 'greetings').eq('id', idField(body.greetingId, 'Greeting')).eq('deleted', false).maybeSingle(), 'load greeting');
  const g = row && row.data && typeof row.data === 'object' ? Object.assign({}, row.data, { id: row.id }) : null;
  if (!g) throw bad('not-found', 'This greeting message is no longer there. Refresh the page.');
  /* every member can write records rows, and this greeting is sent with inbox view only: send it only when the person
     who last saved it (updated_by, stamped by the database, never by the page) may still write greetings */
  const writer = row.updated_by ? await membership(sb, orgId, row.updated_by) : null;
  if (!writer || !(await canInbox(sb, orgId, writer, 'inbox.greetings'))) throw forbidden('This greeting was not saved by someone who can write greeting messages. Ask the owner to open it under Greeting Messages and save it again.');
  if (!building || g.buildingId !== building.id) throw bad('wrong-building', 'This greeting is for another building than this guest\'s stay.');
  if (!String(g.text || '').trim()) throw bad('empty', 'This greeting has no text yet. Write it under Greeting Messages first.');
  const base = appUrl();
  const link = base && typeof booking.guestToken === 'string' && /^[A-Za-z0-9_.~-]{8,}$/.test(booking.guestToken) ? base + '/guest/' + booking.guestToken : '';
  const filled = GREETING.fill(g, { booking, unit, unitType, building, link }, { now: myt(o.now || Date.now()), mask: !!o.mask });
  return { conv, booking, greeting: g, filled };
}

export async function greetingPreview(sb, body, me) {
  const ws = await workspace(sb, body, me);
  const mask = !(await canInbox(sb, ws.org.id, ws.member, 'guestapp.doorCodes'));
  const { greeting, filled } = await greetingFor(sb, ws.org.id, body, { mask });
  return { id: greeting.id, name: greeting.name || '', text: filled.text, parts: filled.parts, checkInAt: filled.checkInAt, early: filled.early, missing: filled.missing, masked: mask };
}

export async function greetingAction(sb, body, me, opts = {}) {
  const ws = await workspace(sb, body, me); // inbox view is enough: "Owner and all employees can send this"
  if (await isDemo(sb, ws.org.id)) throw forbidden('This is a demo workspace, so nothing is sent to guests.');
  const { conv, booking, greeting, filled } = await greetingFor(sb, ws.org.id, body, { now: opts.now });
  if (!(await canInbox(sb, ws.org.id, ws.member, 'inbox.send'))) {
    /* view-only senders: no flooding a guest with the same greeting */
    const since = myt((opts.now || Date.now()) - GREETING_REPEAT_MS);
    const again = (Array.isArray(conv.messages) ? conv.messages : []).some((m) => m && m.greeting === greeting.id && String(m.time || '') >= since);
    if (again) throw tooMany('This greeting was sent to this guest a few minutes ago. Please wait before sending it again.');
  }
  if (!filled.text.trim()) throw bad('empty', 'This greeting has no text yet. Write it under Greeting Messages first.');
  const { via, cx, fromAddress } = await replyRoute(sb, ws, body, me);
  const data = await sendReply(sb, {
    orgId: ws.org.id, conv, booking, via, text: filled.text, greeting: greeting.id, now: opts.now, fetch: opts.fetch, waConfig: opts.waConfig,
    staffId: ws.member.staff_id || null, userId: me.id, channexConfig: cx, fromAddress, fromName: ws.org.name
  });
  return { conversation: { id: conv.id, data } };
}

async function translateAction(sb, body, me) {
  const ws = await workspace(sb, body, me);
  const cfg = translateConfig();
  if (!cfg.configured) throw new ApiError(503, 'not-configured', 'Translation is not set up on the server yet.');
  const conv = await conversation(sb, ws.org.id, body.conversationId);
  const { i, m } = message(conv, body.index);
  const source = String(m.caption || m.text || '').trim();
  if (!source) throw bad('empty', 'There is no text to translate.');
  const to = langCode(body.to) || (await inboxSettings(sb, ws.org.id)).lang;
  let r;
  try { r = await translate(cfg, source.slice(0, MAX_CHARS), to); } catch (e) { throw translateFailure(e); }
  const patch = r.same ? { lang: r.lang || to } : { lang: r.lang || undefined, tr: { to, text: r.text } };
  const saved = await patchMsg(sb, ws.org.id, { convId: conv.id, index: i, text: typeof m.text === 'string' ? m.text : '', patch });
  return { conversation: saved ? { id: saved.id, data: saved.data } : null, same: r.same, lang: r.lang, text: r.text };
}

async function preview(sb, body, me) {
  await workspace(sb, body, me, 'inbox.send');
  const cfg = translateConfig();
  if (!cfg.configured) throw new ApiError(503, 'not-configured', 'Translation is not set up on the server yet.');
  const to = langCode(body.to);
  if (!to) throw bad('no-lang', 'Choose the guest\'s language.');
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw bad('empty', 'Write a message first.');
  try {
    const r = await translate(cfg, text, to);
    return { text: r.same ? text : r.text, lang: to, from: r.lang || null, same: r.same };
  } catch (e) {
    throw translateFailure(e);
  }
}

/* only photos and videos the inbox-media bucket takes (0022) go through Storage; other large files (PDFs, voice notes,
 * stickers) are refused from Meta's file size, before anything is downloaded */
const baseMime = (mime) => String(mime || '').split(';')[0].trim().toLowerCase();
const storable = (mime) => !!mediaKind(baseMime(mime));
const bigLimit = (mime) => (storable(mime) ? MEDIA_BIG : MEDIA_MAX);

export async function media(sb, body, me, opts = {}) {
  const ws = await workspace(sb, body, me);
  const conv = await conversation(sb, ws.org.id, body.conversationId);
  const { m } = message(conv, body.index);
  if (m.file && typeof m.file.path === 'string') {
    if (!ownsPath(ws.org.id, conv.id, m.file.path)) throw bad('no-file', 'This message has no file to open.');
    return { mime: m.mime || null, name: m.name || null, url: await signedUrl(sb, m.file.path, 3600) };
  }
  if (!m.media || typeof m.media.id !== 'string') throw bad('no-file', 'This message has no file to open.');
  const base = opts.waConfig || waConfig();
  if (!base.configured) throw new ApiError(503, 'not-configured', 'WhatsApp is not set up on the server yet.');
  const num = await numberOf(sb, ws.org.id);
  const cfg = withToken(base, num ? await tokenOf(sb, num.phone_number_id) : '');
  let f;
  try {
    f = await fetchMedia(cfg, m.media.id, bigLimit, { fetch: opts.fetch });
  } catch (e) {
    if (e instanceof WhatsAppError) throw new ApiError(e.retryable ? 502 : 400, 'whatsapp', e.message);
    throw e;
  }
  const name = m.media.name || m.name || null;
  if (f.bytes.length <= MEDIA_MAX) return { mime: f.mime, name, data: f.bytes.toString('base64') };
  if (!storable(f.mime)) throw bad('too-big', 'This file is too large to open here. Open it in the WhatsApp app.');
  /* too big for the answer (videos): kept in Storage next to the chat, and opened from a signed address */
  const path = ws.org.id + '/' + String(conv.id).replace(/[^A-Za-z0-9_-]/g, '_') + '/in-' + String(m.media.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
  const up = await sb.storage.from(MEDIA_BUCKET).upload(path, f.bytes, { contentType: baseMime(f.mime), upsert: true });
  if (up && up.error) throw bad('too-big', 'This file is too large to open here. Open it in the WhatsApp app.');
  return { mime: f.mime, name, url: await signedUrl(sb, path, 3600) };
}

/* ---------- photos and videos to guests (the file goes from the browser to Storage, never through here) ---------- */

export async function mediaUpload(sb, body, me) {
  const ws = await workspace(sb, body, me, 'inbox.send');
  if (await isDemo(sb, ws.org.id)) throw forbidden('This is a demo workspace, so nothing is sent to guests.');
  const conv = await conversation(sb, ws.org.id, body.conversationId);
  const booking = conv.bookingId ? await record(sb, ws.org.id, 'bookings', String(conv.bookingId)) : null;
  const r = routes(conv, booking);
  const via = body.via === 'whatsapp' || body.via === 'channex' || body.via === 'email' ? body.via : null;
  if (!via) throw bad('bad-via', 'Choose how to send it.');
  checkMedia(via, body.mime, body.size, r.channex ? VIA_NAME[r.channex.via] : null);
  const path = mediaPath(ws.org.id, conv.id, String(body.mime).toLowerCase());
  await noteUpload(sb, ws.org.id, path); // removed after a day if it is never sent
  const up = await sb.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (up.error || !up.data || !up.data.token) throw new ApiError(502, 'storage', 'The upload could not be started. Please try again.');
  return { bucket: MEDIA_BUCKET, path, token: up.data.token };
}

export async function sendMediaAction(sb, body, me, opts = {}) {
  const ws = await workspace(sb, body, me, 'inbox.send');
  if (await isDemo(sb, ws.org.id)) throw forbidden('This is a demo workspace, so nothing is sent to guests.');
  const conv = await conversation(sb, ws.org.id, body.conversationId);
  const booking = conv.bookingId ? await record(sb, ws.org.id, 'bookings', String(conv.bookingId)) : null;
  const { via, cx, fromAddress } = await replyRoute(sb, ws, body, me);
  const data = await sendMediaReply(sb, {
    orgId: ws.org.id, conv, booking, via, path: body.path, caption: typeof body.caption === 'string' ? body.caption : '', name: body.name,
    staffId: ws.member.staff_id || null, userId: me.id, channexConfig: opts.channexConfig || cx, request: opts.request, fetch: opts.fetch, waConfig: opts.waConfig,
    emailConfig: opts.emailConfig, fromAddress, fromName: ws.org.name, now: opts.now
  });
  await uploadSent(sb, body.path);
  return { conversation: { id: conv.id, data } };
}

/* ---------- organising: pin, archive, lists, favourites, Deleted ---------- */

function convIds(body) {
  const raw = Array.isArray(body.conversationIds) ? body.conversationIds : [body.conversationId];
  const ids = [...new Set(raw.map((x) => idField(x, 'Conversation')))];
  if (!ids.length) throw bad('no-chat', 'Choose a chat first.');
  if (ids.length > ORGANIZE_MAX) throw bad('too-many', 'Choose at most ' + ORGANIZE_MAX + ' chats at a time.');
  return ids;
}

async function listsOf(sb, orgId) {
  const v = await blob(sb, orgId, 'inboxLists');
  return (Array.isArray(v) ? v : []).filter((l) => l && typeof l.id === 'string' && typeof l.name === 'string');
}

export async function organize(sb, body, me, opts = {}) {
  const op = typeof body.op === 'string' ? body.op : '';
  const personal = op === 'favourite' || op === 'unfavourite';
  const ws = await workspace(sb, body, me, personal ? 'inbox' : 'inbox.edit');
  const ids = convIds(body);
  const now = opts.now || Date.now();
  let change;
  if (op === 'pin') change = { set: { pinned: true } };
  else if (op === 'unpin') change = { unset: ['pinned'] };
  else if (op === 'archive') change = { set: { archived: true } };
  else if (op === 'unarchive') change = { unset: ['archived'] };
  else if (op === 'read') change = { set: { unread: 0 } };
  else if (op === 'unread') change = { unreadMin: 1 };
  else if (op === 'favourite') change = { add: { favBy: me.id } };
  else if (op === 'unfavourite') change = { remove: { favBy: me.id } };
  else if (op === 'delete') change = { set: { trashedAt: myt(now), trashedBy: ws.member.staff_id || me.id } };
  else if (op === 'restore') change = { unset: ['trashedAt', 'trashedBy'] };
  else if (op === 'list-add' || op === 'list-remove') {
    const listId = typeof body.listId === 'string' ? body.listId : '';
    if (op === 'list-add' && !(await listsOf(sb, ws.org.id)).some((l) => l.id === listId)) throw bad('no-list', 'This list is no longer there. Refresh the inbox.');
    if (!listId) throw bad('no-list', 'Choose a list.');
    change = op === 'list-add' ? { add: { lists: listId } } : { remove: { lists: listId } };
  } else throw bad('bad-op', 'Unknown request.');
  const out = [];
  for (const id of ids) {
    const r = await markConv(sb, ws.org.id, id, change);
    if (r && r.id) out.push({ id: r.id, data: r.data });
  }
  if (!out.length) throw bad('not-found', 'This conversation is no longer there. Refresh the inbox.');
  return { conversations: out };
}

export async function purge(sb, body, me) {
  const ws = await workspace(sb, body, me, 'inbox.edit');
  const ids = convIds(body);
  const removed = [], failed = [];
  for (const id of ids) {
    const c = await record(sb, ws.org.id, 'conversations', id);
    if (!c) continue;
    if (!c.trashedAt) throw bad('not-deleted', 'Only chats in Deleted can be removed for good. Delete the chat first.');
    const r = await forgetConv(sb, ws.org.id, id);
    if (r === 'removed') removed.push(id); else if (r === 'files') failed.push(id);
  }
  if (failed.length && !removed.length) throw new ApiError(502, 'storage', 'The photos and videos of this chat could not be removed just now, so the chat is still in Deleted. Please try again.');
  return { removed, failed };
}

const listName = (v) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

export async function listsAction(sb, body, me) {
  const ws = await workspace(sb, body, me, 'inbox.edit');
  const op = typeof body.op === 'string' ? body.op : '';
  if (op !== 'add' && op !== 'rename' && op !== 'remove') throw bad('bad-op', 'Unknown request.');
  const name = listName(body.name);
  const id = typeof body.id === 'string' ? body.id : '';
  if (op !== 'remove' && !name) throw bad('no-name', 'Give the list a name.');
  /* one locked step in the database (0022 inbox_lists), so two people changing lists at once both count */
  const r = must(await sb.rpc('inbox_lists', {
    p_org: ws.org.id, p_op: op, p_id: op === 'add' ? null : id, p_name: op === 'remove' ? null : name,
    p_new_id: op === 'add' ? 'L-' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36) : null, p_max: LISTS_MAX
  }), 'save lists') || {};
  if (r.error === 'taken') throw conflict('list-taken', 'There is already a list called "' + name + '".');
  if (r.error === 'full') throw bad('too-many', 'You can have up to ' + LISTS_MAX + ' lists. Remove one first.');
  if (r.error === 'missing') throw bad('no-list', 'This list is no longer there. Refresh the inbox.');
  if (r.error || !Array.isArray(r.lists)) throw new ApiError(500, 'server', 'The lists could not be saved. Please try again.');
  const conversations = [];
  if (op === 'remove') {
    const rows = must(await sb.from('records').select('id').eq('org_id', ws.org.id).eq('coll', 'conversations').eq('deleted', false).contains('data', { lists: [id] }).limit(1000), 'load chats') || [];
    for (const row of rows) { const c = await markConv(sb, ws.org.id, row.id, { remove: { lists: id } }); if (c && c.id) conversations.push({ id: c.id, data: c.data }); }
  }
  return { lists: r.lists, conversations };
}

async function connectNumber(sb, body, me) {
  const ws = await workspace(sb, body, me, 'owner');
  const cfg = waConfig();
  if (!cfg.configured || !cfg.token) throw new ApiError(503, 'not-configured', 'Connecting by Phone number ID needs WHATSAPP_TOKEN, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN in Vercel. Use Connect with Facebook instead, or add them and redeploy.');
  const pnid = String(body.phoneNumberId || '').trim();
  if (!/^\d{6,25}$/.test(pnid)) throw bad('bad-id', 'Enter the Phone number ID from Meta (WhatsApp, API Setup): only digits.');
  const taken = must(await sb.from('whatsapp_numbers').select('org_id').eq('phone_number_id', pnid).maybeSingle(), 'load WhatsApp number');
  if (taken && taken.org_id !== ws.org.id) throw conflict('number-taken', 'This WhatsApp number is already connected to another workspace.');
  let info;
  try {
    info = await phoneNumberInfo(cfg, pnid);
  } catch (e) {
    if (e instanceof WhatsAppError) throw bad('whatsapp', e.status === 400 || e.status === 404 ? 'Meta does not know this Phone number ID, or the token cannot use it. Check the ID and that the system user has the WhatsApp account.' : e.message);
    throw e;
  }
  must(await sb.from('whatsapp_numbers').delete().eq('org_id', ws.org.id).neq('phone_number_id', pnid), 'replace WhatsApp number');
  must(await sb.from('whatsapp_numbers').upsert({ phone_number_id: pnid, org_id: ws.org.id, display_phone: String(info.display_phone_number || '').slice(0, 40) || null, verified_name: String(info.verified_name || '').slice(0, 120) || null, created_by: me.id }, { onConflict: 'phone_number_id' }), 'save WhatsApp number');
  return { number: { phone: info.display_phone_number || null, name: info.verified_name || null } };
}

/** The owner finished Meta's Embedded Signup pop-up: body {code, wabaId?, phoneNumberId?}. */
async function signupNumberAction(sb, body, me) {
  const ws = await workspace(sb, body, me, 'owner');
  if (await isDemo(sb, ws.org.id)) throw forbidden('This is a demo workspace, so no WhatsApp number can be connected.');
  const base = appUrl();
  return connectWithSignup(sb, {
    orgId: ws.org.id, userId: me.id, code: body.code, wabaId: body.wabaId, phoneNumberId: body.phoneNumberId,
    callbackUrl: base ? base + '/api/whatsapp-webhook' : ''
  }, { config: waConfig() });
}

async function disconnectNumber(sb, body, me) {
  const ws = await workspace(sb, body, me, 'owner');
  must(await sb.from('whatsapp_numbers').delete().eq('org_id', ws.org.id), 'remove WhatsApp number');
  return { number: null };
}

/* ---------- booking-site messages and reviews (Channex Messaging & Reviews) ---------- */

const NO_TRANSLATE = { configured: false };
const relId = (o, k) => (o && o.relationships && o.relationships[k] && o.relationships[k].data ? o.relationships[k].data.id : null);

/** The building's recent booking-site conversations, so chats from before the switch-on show up too. -> messages stored */
async function pullThreads(sb, cx, prop, userId, deadline) {
  const res = await tracked(sb, cx, { method: 'GET', path: '/message_threads', query: { 'filter[property_id]': prop.channex_property_id, 'pagination[limit]': 50, order_by: 'last_message_received_at', order_direction: 'desc' }, orgId: prop.org_id, propertyId: prop.channex_property_id, source: 'messages', byUser: userId });
  const since = Date.now() - 90 * 86400000;
  const threads = (Array.isArray(res && res.data) ? res.data : [])
    .filter((t) => !relId(t, 'property') || relId(t, 'property') === prop.channex_property_id)
    .filter((t) => { const a = t.attributes || {}; const at = Date.parse(a.last_message_received_at || a.updated_at || ''); return !Number.isFinite(at) || at >= since; })
    .slice(0, BACKFILL_THREADS);
  let n = 0;
  for (const t of threads) {
    if (Date.now() > deadline - 2000) break;
    const r = await tracked(sb, cx, { method: 'GET', path: '/message_threads/' + t.id + '/messages', query: { 'pagination[limit]': 50, order_by: 'inserted_at', order_direction: 'desc' }, orgId: prop.org_id, propertyId: prop.channex_property_id, source: 'messages', byUser: userId });
    const list = (Array.isArray(r && r.data) ? r.data : []).map((m) => Object.assign({ id: m.id }, m.attributes || {}))
      .sort((a, b) => (String(a.inserted_at) < String(b.inserted_at) ? -1 : 1));
    const provider = t.attributes && t.attributes.provider;
    for (const m of list) {
      const out = await receiveChannex(sb, prop, 'message', Object.assign({}, m, { message_thread_id: t.id, booking_id: relId(t, 'booking'), ota_name: provider }), { translateConfig: NO_TRANSLATE, baseUrl: cx.baseUrl });
      if (out.status === 'stored') n++;
    }
  }
  return n;
}

async function sitesOn(sb, body, me) {
  const ws = await workspace(sb, body, me, 'owner');
  if (await isDemo(sb, ws.org.id)) throw forbidden('This is a demo workspace, so nothing is connected to the booking sites.');
  const cx = channexConfig();
  if (!allowedOrg(cx, ws.org.id)) throw forbidden('Channel connections are not switched on for this workspace yet. Please contact Orbique.');
  const props = must(await sb.from('channex_properties').select('org_id, env, building_id, channex_property_id, status').eq('org_id', ws.org.id).eq('env', cx.env).neq('status', 'disconnected'), 'load buildings') || [];
  if (!props.length) throw bad('no-buildings', 'No building is connected to the channel manager yet. Connect one on the Channels page first.');
  const deadline = Date.now() + SITES_BUDGET_MS;
  const inst = await tracked(sb, cx, { method: 'GET', path: '/applications/installed', query: { 'pagination[limit]': 100 }, orgId: ws.org.id, source: 'apps', byUser: me.id });
  const have = new Set((Array.isArray(inst && inst.data) ? inst.data : []).map((r) => r.attributes || {}).filter((a) => a.application_code === 'channex_messages').map((a) => a.property_id));
  const out = [];
  for (const p of props) {
    const row = { buildingId: p.building_id, installed: have.has(p.channex_property_id), reviews: 0, messages: 0, error: null };
    if (!row.installed) {
      try {
        await tracked(sb, cx, { method: 'POST', path: '/applications/install', body: { application_installation: { property_id: p.channex_property_id, application_code: 'channex_messages' } }, orgId: ws.org.id, propertyId: p.channex_property_id, source: 'apps', byUser: me.id });
        row.installed = true; row.added = true;
      } catch (e) {
        row.error = 'Channex did not switch on the Messaging & Reviews app: ' + String(e && e.message || e).slice(0, 200);
        out.push(row);
        continue;
      }
    }
    try { if (Date.now() < deadline - 3000) row.reviews = (await pullReviews(sb, cx, p, { byUser: me.id })).saved; } catch (e) { row.error = 'Reviews could not be fetched yet: ' + String(e && e.message || e).slice(0, 200); }
    try { if (Date.now() < deadline - 3000) row.messages = await pullThreads(sb, cx, p, me.id, deadline); } catch (e) { row.error = row.error || 'Earlier conversations could not be fetched yet: ' + String(e && e.message || e).slice(0, 200); }
    out.push(row);
  }
  const saved = { on: out.some((r) => r.installed), at: new Date().toISOString(), buildings: out.map((r) => ({ buildingId: r.buildingId, installed: r.installed, error: r.error })) };
  must(await sb.from('blobs').upsert({ org_id: ws.org.id, key: 'inboxSites', data: { v: saved } }, { onConflict: 'org_id,key' }), 'save settings');
  return { buildings: out, sites: saved };
}

async function reviewReplyAction(sb, body, me) {
  const ws = await workspace(sb, body, me, 'reviews.reply');
  if (await isDemo(sb, ws.org.id)) throw forbidden('This is a demo workspace, so nothing is posted to the booking sites.');
  const cx = channexConfig();
  if (!channexMessages(cx, ws.org.id)) throw forbidden('Booking-site reviews are not switched on for this workspace yet.');
  const review = await replyReview(sb, cx, ws.org.id, body.reviewId, body.text, ws.member.staff_id || null, { userId: me.id });
  return { review: { id: review.id, data: review } };
}

const ACTIONS = {
  config, send: sendAction, translate: translateAction, preview, media,
  'media-upload': mediaUpload, 'send-media': sendMediaAction, organize, purge, lists: listsAction,
  'whatsapp-connect': connectNumber, 'whatsapp-signup': signupNumberAction, 'whatsapp-disconnect': disconnectNumber,
  'sites-on': sitesOn, 'review-reply': reviewReplyAction,
  greeting: greetingAction, 'greeting-preview': greetingPreview
};

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, { ok: false, error: 'method', message: 'Use POST for this address.' });
    }
    const body = await readJson(req);
    const action = typeof body.action === 'string' ? body.action : '';
    const run = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    if (!run) throw bad('bad-action', 'Unknown request.');
    const sb = requireAdminClient();
    const me = await caller(sb, bearer(req));
    return ok(res, await run(sb, body, me));
  } catch (err) {
    return fail(res, err);
  }
}

