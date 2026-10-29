/* The live inbox (server only): messages from WhatsApp and from booking sites through Channex land in the booking's
 * `conversations` record (supabase/migrations/0010_inbox.sql), and replies go back out the way the guest wrote.
 * Private module: Vercel does not expose files under api/_lib as endpoints.
 *
 *   waDigits(phone), samePhone(a, b)            WhatsApp numbers (digits with the country code; Malaysian 01x gets 60)
 *   pickBooking(bookings, phone, today)         the stay a number belongs to: in house, else the next, else the last
 *   receiveWhatsApp(sb, m, opts)                one incoming WhatsApp message (parseWebhook) -> stored
 *   receiveWhatsAppStatus(sb, s)                sent / delivered / read / failed ticks
 *   receiveWhatsAppEcho(sb, e)                  a message the team sent from the WhatsApp Business app (coexistence)
 *   receiveWhatsAppHistory(sb, h)               one older chat WhatsApp shared when the phone-app number was connected
 *   receiveWhatsAppContact(sb, c)               a contact from the phone app: the name of chats with that number
 *   receiveChannex(sb, prop, event, payload, opts)  Channex message, inquiry, reservation_request, alteration_request,
 *                                               accepted / declined reservation, thread assigned
 *   postNotice(sb, orgId, n, opts)              a platform notification: in the booking's chat, else the platform's feed
 *   sendReply(sb, ctx)                          one reply on WhatsApp, the booking site or email, then stored
 *                                               (ctx.greeting: the greeting it was filled from, kept on the message)
 *   sendMediaReply(sb, ctx)                     one photo or video (already in Storage, MEDIA_BUCKET) on WhatsApp, the
 *                                               booking site (photos only) or email, then stored as an image / video message
 *   checkMedia(via, mime, size), mediaKind(mime) what each route takes (MEDIA): photos JPEG / PNG up to 5 MB, videos MP4 /
 *                                               3GPP up to 16 MB (WhatsApp's limits); booking sites take photos only
 *   markConv(sb, orgId, id, change)             the chat's own flags in one step (0022 inbox_mark): pinned, archived,
 *                                               unread, lists, favBy, trashedAt / trashedBy
 *   purgeTrash(sb, orgId, now)                  removes for good what has been in Deleted for TRASH_DAYS, with its files
 *   removeConvFiles(sb, orgId, id)              the chat's files in Storage (-> false when Storage failed)
 *   forgetConv(sb, orgId, id, before?)          one chat in Deleted for good: files first, then a tombstone record
 *   noteUpload / uploadSent / dropStaleUploads  uploads handed out and not sent: their files go after UPLOAD_HOURS
 *   canInbox(sb, orgId, member, key)            the app's permission rules (O.can) for inbox.send / inbox.notes /
 *                                               inbox.greetings / reviews.reply / guestapp.doorCodes, and inbox.edit (the
 *                                               inbox's edit level: pin, archive, lists, delete, assign)
 *
 * Message times are written the way the app writes them: Malaysia time 'YYYY-MM-DDTHH:MM'.
 */
import { createHash, randomBytes } from 'node:crypto';
import { ApiError, bad } from './http.js';
import { must, records, record, blob, tracked, todayMY, addDays } from './channex-db.js';
import { ChannexError } from './channex.js';
import { waConfig, withToken, sendText, sendMedia, WINDOW_MS, WhatsAppError } from './whatsapp.js';
import { translateConfig, translate, langCode } from './translate.js';
import { inboundConfig, sendEmail } from './email-in.js';

export const myt = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 16);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clip = (v, n) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)).slice(0, n);
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const MAX_TEXT = 4096;
export const OTA_VIA = { booking: 'booking', airbnb: 'airbnb', expedia: 'expedia' };
export const VIA_NAME = { whatsapp: 'WhatsApp', booking: 'Booking.com', airbnb: 'Airbnb', expedia: 'Expedia', channex: 'the booking site', email: 'email', agoda: 'Agoda', tripcom: 'Trip.com' };
/* the conversations that hold a platform's notifications no booking matched (feed key -> the name shown) */
export const FEED_NAME = { airbnb: 'Airbnb', booking: 'Booking.com', agoda: 'Agoda', tripcom: 'Trip.com', expedia: 'Expedia', channex: 'Channel manager', email: 'Email' };

/* ---------- phone numbers ---------- */

/** "+60 12-345 6789" / "012-345 6789" / "0060123456789" -> "60123456789" ('' when it cannot be a number). */
export function waDigits(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (/^0[1-9]/.test(d)) d = '6' + d; // a Malaysian number written without the country code
  return d.length >= 8 && d.length <= 15 ? d : '';
}

/** The same number, however it was written (the last 9 digits agree). */
export function samePhone(a, b) {
  const x = waDigits(a);
  const y = waDigits(b);
  return !!x && !!y && (x === y || (x.length >= 9 && y.length >= 9 && x.slice(-9) === y.slice(-9)));
}

/** From a guest's bookings: the stay going on, else the next one, else the latest that ended. -> booking or null */
export function pickBooking(bookings, phone, today) {
  const mine = (bookings || []).filter((b) => b && b.status !== 'cancelled' && b.guest && samePhone(b.guest.phone, phone));
  const now = mine.filter((b) => b.checkIn <= today && b.checkOut > today).sort((a, b) => (a.checkIn < b.checkIn ? 1 : -1));
  if (now.length) return now[0];
  const next = mine.filter((b) => b.checkIn > today).sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1));
  if (next.length) return next[0];
  const past = mine.filter((b) => b.checkOut <= today).sort((a, b) => (a.checkOut < b.checkOut ? 1 : -1));
  return past[0] || null;
}

async function bookingForPhone(sb, orgId, phone, now) {
  const today = todayMY(now);
  const list = await records(sb, orgId, 'bookings', (q) => q.gte('data->>checkOut', addDays(today, -60)).lte('data->>checkIn', addDays(today, 400)));
  return pickBooking(list, phone, today);
}

/* ---------- conversations (0010) ---------- */

async function rpc(sb, name, args, what) {
  return must(await sb.rpc(name, args), what);
}

export const findConv = (sb, orgId, key, val, bookingId, extra, now) =>
  rpc(sb, 'inbox_conv', { p_org: orgId, p_key: key, p_val: val, p_bid: bookingId || null, p_extra: extra || {}, p_now: myt(now) }, 'find conversation');

export const appendMsg = (sb, orgId, convId, msg, unread, patch) =>
  rpc(sb, 'inbox_append', { p_org: orgId, p_cid: convId, p_msg: msg, p_unread: unread || 0, p_patch: patch || {} }, 'add message');

export const patchMsg = (sb, orgId, { convId = null, xid = null, index = null, text = null, patch }) =>
  rpc(sb, 'inbox_patch', { p_org: orgId, p_cid: convId, p_xid: xid, p_index: index, p_text: text, p_patch: patch || {} }, 'update message');

/** True when a message with this xid is already stored (a delivery sent twice is not translated twice). */
async function stored(sb, orgId, xid) {
  const r = await sb.from('records').select('id').eq('org_id', orgId).eq('coll', 'conversations').eq('deleted', false)
    .contains('data', { messages: [{ xid }] }).limit(1);
  return !r.error && !!(r.data && r.data.length);
}

/** The workspace's inbox settings: {lang: the team's language, autoTranslate}. */
export async function inboxSettings(sb, orgId) {
  const v = await blob(sb, orgId, 'inboxSettings').catch(() => null);
  return { lang: langCode(v && v.lang) || 'en', autoTranslate: !(v && v.autoTranslate === false) };
}

/** {lang, tr} for a guest's message in the team's language, or {} (no key, same language, or it failed / took too long). */
export async function translated(text, settings, opts = {}) {
  const cfg = opts.translateConfig || translateConfig();
  if (!cfg.configured || !settings.autoTranslate || !String(text || '').trim()) return {};
  try {
    const r = await translate(cfg, text, settings.lang, { timeoutMs: opts.timeoutMs || 6000, fetch: opts.fetch });
    if (r.same) return r.lang ? { lang: r.lang } : {};
    return { lang: r.lang || undefined, tr: { to: settings.lang, text: clip(r.text, MAX_TEXT) } };
  } catch (e) {
    return {};
  }
}

/* ---------- WhatsApp in ---------- */

/** The workspace a WhatsApp business number belongs to (whatsapp_numbers), or null. */
export async function orgForNumber(sb, phoneNumberId) {
  const r = must(await sb.from('whatsapp_numbers').select('org_id, phone_number_id').eq('phone_number_id', String(phoneNumberId)).maybeSingle(), 'load WhatsApp number');
  return r ? r.org_id : null;
}

/**
 * Store one incoming WhatsApp message (an item of parseWebhook().messages).
 *   opts {now, translateConfig, fetch (translation, tests)}
 * -> {status: 'stored'|'duplicate'|'unknown_number', orgId?, conversationId?, bookingId?}
 */
export async function receiveWhatsApp(sb, m, opts = {}) {
  const orgId = await orgForNumber(sb, m.phoneNumberId);
  if (!orgId) { console.error('[whatsapp] message for a number no workspace has connected'); return { status: 'unknown_number' }; }
  const xid = 'wa:' + m.id;
  if (await stored(sb, orgId, xid)) return { status: 'duplicate', orgId };
  const now = opts.now || Date.now();
  const b = await bookingForPhone(sb, orgId, m.from, now);
  const c = m.content || { type: 'text', text: '' };
  const lastIn = new Date(m.at || now).toISOString();
  const convId = await findConv(sb, orgId, 'wa', m.from, b && b.id, { contact: { name: clip(m.name, 80) || null, phone: '+' + m.from }, waLastIn: lastIn }, now);
  if (!convId) throw new ApiError(500, 'server', 'Could not store the message.');
  const msg = { from: 'guest', type: c.type, text: clip(c.text, MAX_TEXT), time: myt(m.at || now), via: 'whatsapp', xid };
  for (const k of ['caption', 'name']) if (c[k]) msg[k] = clip(c[k], 1024);
  if (c.media && c.media.id) msg.media = c.media;
  if (m.name) msg.sender = clip(m.name, 80);
  const tr = c.type === 'text' && !c.reaction ? await translated(msg.text, await inboxSettings(sb, orgId), opts) : c.caption ? await translated(c.caption, await inboxSettings(sb, orgId), opts) : {};
  Object.assign(msg, tr);
  const patch = { waLastIn: lastIn };
  if (tr.lang) patch.lang = tr.lang;
  const v = await appendMsg(sb, orgId, convId, msg, 1, patch);
  return { status: v ? 'stored' : 'duplicate', orgId, conversationId: convId, bookingId: b ? b.id : null };
}

/** The name the phone app's contacts give this number (whatsapp_contacts), or ''. */
async function contactName(sb, orgId, phone) {
  const r = await sb.from('whatsapp_contacts').select('name').eq('org_id', orgId).eq('phone', phone).maybeSingle();
  return !r.error && r.data && r.data.name ? clip(r.data.name, 80) : '';
}

/** The contact for a chat the team's phone app wrote in: only with a name, so a guest's WhatsApp name already on the chat stays. */
async function appContact(sb, orgId, phone) {
  const name = await contactName(sb, orgId, phone);
  return name ? { contact: { name, phone: '+' + phone } } : {};
}

/**
 * A message the team sent from the WhatsApp Business app on the phone (smb_message_echoes): stored in the guest's chat
 * as the team's, marked as sent from the app. It does not open WhatsApp's 24 hours for replies from Orbique.
 * -> {status: 'stored'|'duplicate'|'unknown_number', conversationId?}
 */
export async function receiveWhatsAppEcho(sb, e, opts = {}) {
  const orgId = await orgForNumber(sb, e.phoneNumberId);
  if (!orgId) return { status: 'unknown_number' };
  const xid = 'wa:' + e.id;
  if (await stored(sb, orgId, xid)) return { status: 'duplicate' };
  const now = opts.now || Date.now();
  const b = await bookingForPhone(sb, orgId, e.to, now);
  const convId = await findConv(sb, orgId, 'wa', e.to, b && b.id, await appContact(sb, orgId, e.to), now);
  if (!convId) throw new ApiError(500, 'server', 'Could not store the message.');
  const c = e.content || { type: 'text', text: '' };
  const msg = { from: 'staff', type: c.type, text: clip(c.text, MAX_TEXT), time: myt(e.at || now), via: 'whatsapp', xid, app: true };
  for (const k of ['caption', 'name']) if (c[k]) msg[k] = clip(c[k], 1024);
  if (c.media && c.media.id) msg.media = c.media;
  const v = await appendMsg(sb, orgId, convId, msg, 0, null);
  return { status: v ? 'stored' : 'duplicate', conversationId: convId };
}

/** At most this many older messages per chat come in from the phone app (the latest ones). */
export const HISTORY_MAX = 200;

/**
 * One older chat from the phone app (the history webhook, sent once after connecting): its messages go into the guest's
 * chat in time order, read, untranslated (Translate in the inbox), skipping any already there.
 * -> {status: 'stored'|'duplicate'|'unknown_number', added, conversationId?}
 */
export async function receiveWhatsAppHistory(sb, h, opts = {}) {
  const orgId = opts.orgId || await orgForNumber(sb, h.phoneNumberId);
  if (!orgId) return { status: 'unknown_number', added: 0 };
  const now = opts.now || Date.now();
  const list = (h.messages || []).slice().sort((a, b) => a.at - b.at).slice(-HISTORY_MAX);
  if (!list.length) return { status: 'duplicate', added: 0 };
  // a chat is merged in one go, so when its newest message is here the whole chat is (Meta sending a delivery again)
  if (await stored(sb, orgId, 'wa:' + list[list.length - 1].id)) return { status: 'duplicate', added: 0 };
  const b = await bookingForPhone(sb, orgId, h.guest, now);
  const lastGuest = list.filter((m) => m.fromGuest).pop();
  const convId = await findConv(sb, orgId, 'wa', h.guest, b && b.id, await appContact(sb, orgId, h.guest), now);
  if (!convId) throw new ApiError(500, 'server', 'Could not store the chat.');
  const msgs = list.map((m) => {
    const c = m.content || { type: 'text', text: '' };
    const msg = { from: m.fromGuest ? 'guest' : 'staff', type: c.type, text: clip(c.text, MAX_TEXT), time: myt(m.at), via: 'whatsapp', xid: 'wa:' + m.id, earlier: true };
    if (!m.fromGuest) msg.app = true;
    for (const k of ['caption', 'name']) if (c[k]) msg[k] = clip(c[k], 1024);
    if (c.media && c.media.id) msg.media = c.media;
    return msg;
  });
  // replies stay possible for 24 hours after the guest's last message, even one sent before Orbique was connected
  const patch = lastGuest && now - lastGuest.at < WINDOW_MS ? { waLastIn: new Date(lastGuest.at).toISOString() } : {};
  const added = Number(await rpc(sb, 'inbox_merge', { p_org: orgId, p_cid: convId, p_msgs: msgs, p_unread: 0, p_patch: patch }, 'add earlier messages')) || 0;
  return { status: added ? 'stored' : 'duplicate', added, conversationId: convId };
}

/**
 * A contact in the phone app (smb_app_state_sync): its name is kept for chats with that number, and given to the ones
 * already here that are not linked to a booking and have no name. -> {status: 'saved'|'removed'|'unknown_number'}
 */
export async function receiveWhatsAppContact(sb, c, opts = {}) {
  const orgId = opts.orgId || await orgForNumber(sb, c.phoneNumberId);
  if (!orgId) return { status: 'unknown_number' };
  if (c.removed || !c.name) {
    must(await sb.from('whatsapp_contacts').delete().eq('org_id', orgId).eq('phone', c.phone), 'remove contact');
    return { status: 'removed' };
  }
  if (await contactName(sb, orgId, c.phone) === clip(c.name, 80)) return { status: 'saved' }; // already here (a delivery sent again)
  must(await sb.from('whatsapp_contacts').upsert({ org_id: orgId, phone: c.phone, name: clip(c.name, 80), updated_at: new Date().toISOString() }, { onConflict: 'org_id,phone' }), 'save contact');
  const convs = must(await sb.from('records').select('id, data').eq('org_id', orgId).eq('coll', 'conversations').eq('deleted', false).eq('data->>wa', c.phone).limit(5), 'load chats');
  for (const r of convs || []) {
    const d = isObj(r.data) ? r.data : {};
    if (d.bookingId || (isObj(d.contact) && d.contact.name)) continue;
    await rpc(sb, 'inbox_merge', { p_org: orgId, p_cid: r.id, p_msgs: [], p_unread: 0, p_patch: { contact: Object.assign({}, isObj(d.contact) ? d.contact : {}, { name: clip(c.name, 80) }) } }, 'name chat');
  }
  return { status: 'saved' };
}

const TICK = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };

/** A delivery tick for a message the team sent. -> {status: 'updated'|'unknown'|'ignored'} */
export async function receiveWhatsAppStatus(sb, s) {
  const status = TICK[s.status];
  if (!status) return { status: 'ignored' };
  const orgId = await orgForNumber(sb, s.phoneNumberId);
  if (!orgId) return { status: 'unknown' };
  const patch = { status };
  if (status === 'failed') patch.error = clip(s.error || 'WhatsApp could not deliver it.', 300);
  const r = await patchMsg(sb, orgId, { xid: 'wa:' + s.id, patch });
  return { status: r ? 'updated' : 'unknown' };
}

/* ---------- Channex in ---------- */

export const MESSAGE_EVENTS = ['message', 'inquiry', 'reservation_request', 'alteration_request', 'accepted_reservation', 'declined_reservation', 'message_thread_booking_assigned'];

/* ---------- notifications ---------- */

/**
 * One platform notification as a line in the inbox: in the booking's conversation when there is a booking, else in the
 * platform's notifications feed ('airbnb', 'booking', 'agoda', 'tripcom', 'expedia', 'channex', 'email').
 *   n {bookingId, feed, via, xid (once only), text, subject, body, link {page, id}, unread (default 1)}
 * -> {status: 'stored'|'duplicate'|'ignored', conversationId?}
 */
export async function postNotice(sb, orgId, n, opts = {}) {
  const now = opts.now || Date.now();
  const text = clip(n.text, 1000);
  if (!text) return { status: 'ignored' };
  if (n.xid && (await stored(sb, orgId, n.xid))) return { status: 'duplicate' };
  const feed = FEED_NAME[n.feed] ? n.feed : 'channex';
  const convId = n.bookingId
    ? await findConv(sb, orgId, 'nk', 'bk:' + n.bookingId, n.bookingId, {}, now)
    : await findConv(sb, orgId, 'feed', feed, null, { kind: 'feed', contact: { name: FEED_NAME[feed] + ' notifications', phone: null } }, now);
  if (!convId) return { status: 'ignored' };
  const msg = { from: 'system', text, time: myt(n.at || now), via: n.via || feed };
  if (n.xid) msg.xid = n.xid;
  if (n.subject) msg.subject = clip(n.subject, 300);
  if (n.body) msg.body = clip(n.body, MAX_TEXT);
  if (n.link && typeof n.link.page === 'string') msg.link = { page: clip(n.link.page, 30), id: clip(n.link.id, 80) || undefined };
  const v = await appendMsg(sb, orgId, convId, msg, n.unread === 0 ? 0 : 1, null);
  return { status: v ? 'stored' : 'duplicate', conversationId: convId };
}

const NOTICE_TEXT = {
  alteration_request: (site, who) => `${who || 'The guest'} asked ${site} to change the reservation. Accept or decline it on ${site}.`,
  accepted_reservation: (site, who) => `The reservation request${who ? ' from ' + who : ''} was accepted on ${site}.`,
  declined_reservation: (site, who) => `The reservation request${who ? ' from ' + who : ''} was declined on ${site}.`
};

/** The Orbique booking (records) for a Channex booking id, or null. */
async function bookingForChannex(sb, orgId, channexBookingId) {
  if (!isUuid(channexBookingId)) return null;
  const r = must(await sb.from('channex_bookings').select('record_ids').eq('booking_id', channexBookingId).eq('org_id', orgId).maybeSingle(), 'load booking link');
  const id = r && Array.isArray(r.record_ids) ? r.record_ids[0] : null;
  if (!id) return null;
  const rec = must(await sb.from('records').select('id, data').eq('org_id', orgId).eq('coll', 'bookings').eq('id', id).eq('deleted', false).maybeSingle(), 'load booking');
  return rec && isObj(rec.data) ? Object.assign({}, rec.data, { id: rec.id }) : null;
}

const viaOf = (b, p) => {
  const ch = b && b.channel;
  if (OTA_VIA[ch]) return OTA_VIA[ch];
  const n = String((p && (p.ota_name || p.channel || p.provider)) || '').toLowerCase();
  if (/booking/.test(n)) return 'booking';
  if (/airbnb/.test(n)) return 'airbnb';
  if (/expedia/.test(n)) return 'expedia';
  return 'channex';
};

function channexTime(p, now) {
  const t = Date.parse(p.inserted_at || p.created_at || p.sent_at || '');
  return Number.isFinite(t) ? t : now;
}

function attachmentsOf(p, base) {
  const list = Array.isArray(p.attachments) ? p.attachments : [];
  const host = String(base || '').replace(/\/api\/v1\/?$/, '');
  return list.map((a) => (typeof a === 'string' ? { url: a } : isObj(a) ? { url: a.url || a.file || a.link, name: a.file_name || a.name, mime: a.content_type || a.type } : null))
    .map((a) => (a && typeof a.url === 'string' && /^\//.test(a.url) && /^https:\/\//.test(host) ? Object.assign(a, { url: host + a.url }) : a)) // Channex sends links relative to its site
    .filter((a) => a && typeof a.url === 'string' && /^https:\/\//.test(a.url)).slice(0, 10);
}

/**
 * One Channex message event for a connected property (prop: a channex_properties row).
 * -> {status: 'stored'|'duplicate'|'ignored', conversationId?}
 */
export async function receiveChannex(sb, prop, event, p, opts = {}) {
  const orgId = prop.org_id;
  const now = opts.now || Date.now();
  const thread = isUuid(p.message_thread_id) ? p.message_thread_id : isUuid(p.thread_id) ? p.thread_id : null;
  const b = await bookingForChannex(sb, orgId, p.booking_id);
  const via = viaOf(b, p);
  const extra = { cxBooking: isUuid(p.booking_id) ? p.booking_id : null, ota: VIA_NAME[via] !== 'the booking site' ? VIA_NAME[via] : null };
  if (event === 'message_thread_booking_assigned') {
    if (!thread || !b) return { status: 'ignored' };
    return { status: 'stored', conversationId: await findConv(sb, orgId, 'cx', thread, b.id, extra, now) };
  }
  const det = isObj(p.booking_details) ? p.booking_details : isObj(p.bms) ? p.bms : {};
  const cust = isObj(p.customer) ? p.customer : isObj(det.customer) ? det.customer : null;
  const name = clip(p.guest_name || det.guest_name || (cust && [cust.name, cust.surname].filter(Boolean).join(' ')) || '', 80);
  const at0 = channexTime(p, now);
  if (NOTICE_TEXT[event]) {
    const text = NOTICE_TEXT[event](VIA_NAME[via] === 'the booking site' ? 'the booking site' : VIA_NAME[via], name);
    const xid = 'cx:' + event + ':' + (p.id || p.live_feed_event_id || p.booking_id || thread || createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0, 24));
    if (thread) {
      const cid = await findConv(sb, orgId, 'cx', thread, b && b.id, Object.assign({}, extra, { contact: { name: name || 'Guest from ' + VIA_NAME[via], phone: null } }), now);
      if (!cid) return { status: 'ignored' };
      const v = await appendMsg(sb, orgId, cid, { from: 'system', text, time: myt(at0), via, xid }, 1, null);
      return { status: v ? 'stored' : 'duplicate', conversationId: cid };
    }
    return postNotice(sb, orgId, { bookingId: b && b.id, feed: via === 'channex' ? 'channex' : via, via, xid, text, at: at0 }, { now });
  }
  if (!thread && !b) {
    if (event === 'inquiry' || event === 'reservation_request') {
      const what = event === 'inquiry' ? 'New inquiry' : 'New reservation request';
      const xid = 'cx:' + event + ':' + (p.id || p.live_feed_event_id || createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0, 24));
      return postNotice(sb, orgId, { feed: via === 'channex' ? 'airbnb' : via, via, xid, text: `${what} on ${VIA_NAME[via] === 'the booking site' ? 'Airbnb' : VIA_NAME[via]}${name ? ' from ' + name : ''}. Answer it on the site.`, at: at0 }, { now });
    }
    return { status: 'ignored' };
  }
  extra.contact = { name: name || 'Guest from ' + VIA_NAME[via], phone: null };
  const convId = thread ? await findConv(sb, orgId, 'cx', thread, b && b.id, extra, now) : await findConv(sb, orgId, 'cx', 'booking:' + p.booking_id, b.id, extra, now);
  if (!convId) return { status: 'ignored' };
  const at = channexTime(p, now);
  if (event === 'inquiry' || event === 'reservation_request') {
    const what = event === 'inquiry' ? 'New inquiry' : 'New reservation request';
    const cin = p.checkin_date || det.checkin_date || det.arrival_date, cout = p.checkout_date || det.checkout_date || det.departure_date;
    const dates = cin && cout ? `, ${clip(cin, 10)} to ${clip(cout, 10)}` : '';
    const xid = 'cx:' + event + ':' + (p.id || p.booking_id || thread);
    const v = await appendMsg(sb, orgId, convId, { from: 'system', text: `${what} on ${VIA_NAME[via]}${name ? ' from ' + name : ''}${dates}. Reply here to answer.`, time: myt(at), via, xid }, 1, null);
    return { status: v ? 'stored' : 'duplicate', conversationId: convId };
  }
  const text = clip(p.message, MAX_TEXT);
  const files = attachmentsOf(p, opts.baseUrl);
  if (!text && !files.length) return { status: 'ignored' };
  const id = p.id || p.message_id || p.ota_message_id || createHash('sha256').update([thread, p.booking_id, p.message, p.inserted_at || p.created_at].join('|')).digest('hex').slice(0, 32);
  const xid = 'cx:' + id;
  if (await stored(sb, orgId, xid)) return { status: 'duplicate', conversationId: convId };
  if (p.sender === 'system') {
    const v = await appendMsg(sb, orgId, convId, { from: 'system', text: clip(text || 'The booking site sent a file.', 1000), time: myt(at), via, xid }, 1, null);
    return { status: v ? 'stored' : 'duplicate', conversationId: convId };
  }
  const fromGuest = !p.sender || p.sender === 'guest';
  const out = [];
  if (text) out.push({ from: fromGuest ? 'guest' : 'staff', type: 'text', text, time: myt(at), via, xid });
  files.forEach((f, i) => {
    const image = /^image\//.test(f.mime || '') || /\.(jpe?g|png|gif|webp|heic)(\?|$)/i.test(f.url);
    out.push({ from: fromGuest ? 'guest' : 'staff', type: image ? 'image' : 'file', text: f.name || (image ? 'Photo' : 'File'), name: f.name || (image ? 'photo' : 'file'), url: f.url, time: myt(at), via, xid: xid + ':' + i });
  });
  if (!fromGuest) out.forEach((m) => { m.status = 'sent'; });
  const settings = fromGuest ? await inboxSettings(sb, orgId) : null;
  let first = true;
  for (const m of out) {
    if (fromGuest && m.type === 'text') Object.assign(m, await translated(m.text, settings, opts));
    await appendMsg(sb, orgId, convId, m, fromGuest && first ? 1 : 0, m.lang ? { lang: m.lang } : null);
    first = false;
  }
  return { status: 'stored', conversationId: convId };
}

/* ---------- permissions (the same rules as O.can in app/core.js) ---------- */

const SECTION_DEFAULT = {
  inbox: { ops: 'edit', housekeeping: 'edit', frontdesk: 'edit', maintenance: 'view', accountant: 'none' },
  reviews: { ops: 'edit', frontdesk: 'edit' },
  guestapp: { ops: 'edit', housekeeping: 'edit', frontdesk: 'edit' }
};
const ACTION_DEFAULT = {
  'inbox.send': ['ops', 'housekeeping', 'frontdesk'],
  'inbox.notes': ['ops', 'housekeeping', 'frontdesk'],
  'inbox.greetings': ['ops', 'frontdesk'],
  'reviews.reply': ['ops', 'frontdesk'],
  'guestapp.doorCodes': ['ops', 'frontdesk']
};
const LV = { none: 0, view: 1, edit: 2 };

/** Whether this member may do key ('inbox' = see the inbox, 'inbox.edit' = its edit level, 'inbox.send', 'inbox.notes',
 *  'inbox.greetings', 'reviews.reply', 'guestapp.doorCodes'). */
export async function canInbox(sb, orgId, member, key) {
  if (!member || member.status !== 'active') return false;
  if (member.role === 'owner') return true;
  const [rolePerms, staffMeta] = await Promise.all([blob(sb, orgId, 'rolePerms'), blob(sb, orgId, 'staffMeta')]);
  const meta = member.staff_id && isObj(staffMeta) ? staffMeta[member.staff_id] : null;
  if (meta && meta.status === 'suspended') return false;
  const ov = meta && isObj(meta.overrides) ? meta.overrides : {};
  const rp = isObj(rolePerms) ? rolePerms[member.role] : null;
  const sec = Object.prototype.hasOwnProperty.call(SECTION_DEFAULT, key.split('.')[0]) ? key.split('.')[0] : 'inbox';
  const section = ('section:' + sec) in ov ? ov['section:' + sec] || 'none'
    : rp && isObj(rp.sections) && sec in rp.sections ? rp.sections[sec] : SECTION_DEFAULT[sec][member.role] || 'none';
  if (key === sec) return LV[section] >= 1;
  if (key === sec + '.edit') return LV[section] >= 2; // the section's edit level (O.can('inbox', 'edit'))
  if (LV[section] < 2) return false;
  if (key in ov) return !!ov[key];
  if (rp && isObj(rp.actions) && key in rp.actions) return !!rp.actions[key];
  return (ACTION_DEFAULT[key] || []).includes(member.role);
}

/* ---------- replies ---------- */

/** The workspace's WhatsApp number: {phone_number_id, display_phone, verified_name, waba_id, coexist, sync} or null. */
export async function numberOf(sb, orgId) {
  return must(await sb.from('whatsapp_numbers').select('phone_number_id, display_phone, verified_name, waba_id, coexist, sync').eq('org_id', orgId).order('created_at').limit(1).maybeSingle(), 'load WhatsApp number');
}

/** The token for a number connected with Embedded Signup (whatsapp_tokens), or '' (WHATSAPP_TOKEN is used). */
export async function tokenOf(sb, phoneNumberId) {
  const r = await sb.from('whatsapp_tokens').select('token').eq('phone_number_id', String(phoneNumberId)).maybeSingle();
  return !r.error && r.data && typeof r.data.token === 'string' ? r.data.token : '';
}

/** How this conversation can be answered: {whatsapp: {to, open (inside the 24 hours)} | null, channex: {thread, booking} | null}. */
export function routes(conv, booking, now = Date.now()) {
  const to = waDigits(conv.wa) || waDigits(booking && booking.guest && booking.guest.phone) || waDigits(conv.contact && conv.contact.phone);
  const lastIn = Date.parse(conv.waLastIn || '');
  const thread = isUuid(conv.cx) ? conv.cx : null;
  const cxBooking = isUuid(conv.cxBooking) ? conv.cxBooking : booking && booking.channex && isUuid(booking.channex.bookingId) ? booking.channex.bookingId : null;
  return {
    whatsapp: to ? { to, open: Number.isFinite(lastIn) && now - lastIn < WINDOW_MS } : null,
    channex: thread || cxBooking ? { thread, booking: cxBooking, via: viaOf(booking, { ota_name: conv.ota }) } : null
  };
}

function channexRefusal(e) {
  if (e instanceof ChannexError) {
    if (e.status === 403) return bad('messages-off', 'Messages are not switched on for this building in Channex yet (the Messages app). Reply on WhatsApp for now.');
    if (e.status === 422) return bad('messages-unsupported', 'This booking site does not take messages through the channel manager (Agoda, Trip.com and Vrbo do not). Reply on WhatsApp or by email.');
    if (e.status === 404) return bad('messages-unknown', 'The booking site no longer has this conversation.');
    if (e.retryable) return new ApiError(502, 'channex-unavailable', 'The booking site did not answer. Please try again in a minute.');
    return new ApiError(502, 'channex-refused', 'The booking site refused the message: ' + e.message);
  }
  return e;
}

/**
 * Send one reply and store it in the conversation.
 *   ctx {orgId, conv (record data with id), booking (or null), via 'whatsapp' | 'channex', text, orig, origLang, lang,
 *        staffId, userId, now, channexConfig, request (Channex, tests), fetch (WhatsApp, tests), waConfig}
 * -> the conversation's data after the message was added
 */
export async function sendReply(sb, ctx) {
  const now = ctx.now || Date.now();
  const text = String(ctx.text || '').trim();
  if (!text) throw bad('empty', 'Write a message first.');
  if (text.length > MAX_TEXT) throw bad('too-long', 'This message is too long. Split it into two.');
  const r = routes(ctx.conv, ctx.booking, now);
  const msg = { from: 'staff', type: 'text', text, time: myt(now), status: 'sent' };
  if (ctx.staffId) msg.staffId = ctx.staffId;
  if (ctx.orig && ctx.orig !== text) { msg.orig = clip(ctx.orig, MAX_TEXT); if (langCode(ctx.origLang)) msg.origLang = langCode(ctx.origLang); }
  if (langCode(ctx.lang)) msg.lang = langCode(ctx.lang);
  if (ctx.greeting) msg.greeting = clip(ctx.greeting, 80); // sent as a greeting message (api/messages.js 'greeting')
  const patch = {};
  if (ctx.via === 'whatsapp') {
    const { cfg, num } = await waRoute(sb, ctx, r);
    const id = await waCall(() => sendText(cfg, num.phone_number_id, r.whatsapp.to, text, { fetch: ctx.fetch }));
    msg.via = 'whatsapp';
    msg.xid = 'wa:' + id;
    if (!ctx.conv.wa) patch.wa = r.whatsapp.to;
  } else if (ctx.via === 'channex') {
    const res = await channexPost(sb, ctx, r, { message: { message: text } }, { message: { message: '[' + text.length + ' characters]' } });
    channexSent(ctx, r, res, msg, patch, now, text);
  } else if (ctx.via === 'email') {
    const { to, cfg } = emailRoute(ctx);
    const id = await sendEmail(cfg, { fromName: ctx.fromName, from: ctx.fromAddress, to, subject: ctx.conv.emSubject, text, inReplyTo: ctx.conv.emRef }, { fetch: ctx.fetch });
    msg.via = 'email';
    msg.xid = 'em:out:' + (id || createHash('sha256').update(to + now + text).digest('hex').slice(0, 32));
  } else {
    throw bad('bad-via', 'Choose how to send it.');
  }
  const v = await appendMsg(sb, ctx.orgId, ctx.conv.id, msg, 0, patch);
  if (!v) throw new ApiError(500, 'server', 'The message was sent, but Orbique could not save it. Refresh to see it.');
  return v;
}

/* ---------- the routes, shared by text and media replies ---------- */

/** The workspace's WhatsApp number and settings for a reply inside the 24 hours, or a refusal. -> {cfg, num} */
async function waRoute(sb, ctx, r) {
  const base = ctx.waConfig || waConfig();
  if (!base.configured) throw new ApiError(503, 'not-configured', 'WhatsApp is not set up on the server yet.');
  const num = await numberOf(sb, ctx.orgId);
  if (!num) throw bad('no-number', 'Connect your WhatsApp business number first (Inbox, Settings).');
  const cfg = withToken(base, await tokenOf(sb, num.phone_number_id));
  if (!r.whatsapp) throw bad('no-phone', 'This guest has no phone number to message on WhatsApp.');
  if (!r.whatsapp.open) throw bad('window-closed', 'WhatsApp only allows a reply within 24 hours of the guest\'s last WhatsApp message. Ask the guest to message your WhatsApp number first, or reply through the booking site.');
  return { cfg, num };
}

async function waCall(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof WhatsAppError) throw new ApiError(e.retryable ? 502 : 400, 'whatsapp', e.message);
    throw e;
  }
}

/** POST to the chat's Channex thread (or the booking's messages when there is no thread yet). */
/* byBooking: the booking's own address first when there is a booking (Channex documents attachment_id only on
 * POST /bookings/:id/messages); otherwise the thread's, as for text */
async function channexPost(sb, ctx, r, body, logPayload, byBooking = false) {
  if (!r.channex) throw bad('no-thread', 'This conversation did not come from a booking site, so there is nowhere to reply there.');
  const viaBooking = r.channex.thread ? byBooking && !!r.channex.booking : true;
  const path = viaBooking ? '/bookings/' + r.channex.booking + '/messages' : '/message_threads/' + r.channex.thread + '/messages';
  try {
    const res = await tracked(sb, ctx.channexConfig, {
      method: 'POST', path, body, logPayload,
      orgId: ctx.orgId, propertyId: (ctx.booking && ctx.booking.channex && ctx.booking.channex.propertyId) || null, source: 'messages', byUser: ctx.userId, request: ctx.request
    });
    return Object.assign({ path }, res || {});
  } catch (e) {
    throw channexRefusal(e);
  }
}

/** The message's xid and the thread / booking keys from Channex's answer. */
function channexSent(ctx, r, res, msg, patch, now, salt) {
  const d = res && res.data;
  const id = (d && (d.id || (d.attributes && d.attributes.id))) || createHash('sha256').update(res.path + now + salt).digest('hex').slice(0, 32);
  const tid = d && d.relationships && d.relationships.message_thread && d.relationships.message_thread.data && d.relationships.message_thread.data.id;
  msg.via = r.channex.via;
  msg.xid = 'cx:' + id;
  if (!ctx.conv.cx && isUuid(tid)) patch.cx = tid;
  if (!ctx.conv.cxBooking && r.channex.booking) patch.cxBooking = r.channex.booking;
}

function emailRoute(ctx) {
  const to = typeof ctx.conv.em === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(ctx.conv.em) ? ctx.conv.em : '';
  if (!to) throw bad('no-email', 'This conversation did not come by email, so there is no address to answer.');
  if (!ctx.fromAddress) throw new ApiError(503, 'not-configured', 'Email is not set up for this workspace yet (Inbox, Settings).');
  return { to, cfg: ctx.emailConfig || inboundConfig() };
}

/* ---------- photos and videos to guests ---------- */

/** The private Storage bucket (0022) for files the team sends and guests' large WhatsApp videos: <org>/<conversation>/<file>. */
export const MEDIA_BUCKET = 'inbox-media';
/** What WhatsApp takes (Meta's Cloud API media limits: images JPEG / PNG up to 5 MB, videos MP4 / 3GPP (H.264 and AAC) up to
 *  16 MB). Email and booking sites get the same files; booking sites through Channex take photos only (POST /attachments). */
export const MEDIA = {
  image: { mimes: ['image/jpeg', 'image/png'], max: 5 * 1024 * 1024, ext: { 'image/jpeg': 'jpg', 'image/png': 'png' } },
  video: { mimes: ['video/mp4', 'video/3gpp'], max: 16 * 1024 * 1024, ext: { 'video/mp4': 'mp4', 'video/3gpp': '3gp' } }
};
export const CAPTION_MAX = 1024;
const MB = (n) => Math.round(n / 1048576) + ' MB';

/** 'image', 'video' or null. */
export function mediaKind(mime) {
  const m = String(mime || '').toLowerCase();
  return MEDIA.image.mimes.includes(m) ? 'image' : MEDIA.video.mimes.includes(m) ? 'video' : null;
}

/** The kind of file, or a clear refusal: the type, the size, or a route that does not take it. */
export function checkMedia(via, mime, size, site) {
  const kind = mediaKind(mime);
  if (!kind) throw bad('media-type', 'Send photos as JPEG or PNG, and videos as MP4 or 3GP.');
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) throw bad('media-empty', 'This file is empty.');
  if (n > MEDIA[kind].max) throw bad('media-too-big', (kind === 'image' ? 'Photos' : 'Videos') + ' can be up to ' + MB(MEDIA[kind].max) + '. This one is ' + (n / 1048576).toFixed(1) + ' MB.');
  if (via === 'channex' && kind === 'video') throw bad('media-unsupported', 'Videos cannot be sent on ' + (site || 'the booking site') + '. Send it on WhatsApp or by email instead.');
  if (via !== 'whatsapp' && via !== 'channex' && via !== 'email') throw bad('bad-via', 'Choose how to send it.');
  return kind;
}

/** Where a new file for this chat goes: <org>/<conversation>/<time>-<random>.<ext>. */
export function mediaPath(orgId, convId, mime, now = Date.now()) {
  const kind = mediaKind(mime);
  return orgId + '/' + String(convId).replace(/[^A-Za-z0-9_-]/g, '_') + '/' + now.toString(36) + '-' + randomBytes(6).toString('hex') + '.' + MEDIA[kind].ext[String(mime).toLowerCase()];
}

/** True when path is one of this chat's files (never another workspace's or another chat's). */
export function ownsPath(orgId, convId, path) {
  const pre = orgId + '/' + String(convId).replace(/[^A-Za-z0-9_-]/g, '_') + '/';
  return typeof path === 'string' && path.startsWith(pre) && /^[A-Za-z0-9_.-]{1,80}$/.test(path.slice(pre.length));
}

const bucket = (sb) => sb.storage.from(MEDIA_BUCKET);

/** A short-lived address to read one file (WhatsApp fetches it; the app shows it). */
export async function signedUrl(sb, path, seconds = 3600) {
  const r = await bucket(sb).createSignedUrl(path, seconds);
  if (r.error || !r.data || !r.data.signedUrl) throw new ApiError(502, 'storage', 'The file could not be opened. Please try again.');
  return r.data.signedUrl;
}

/** What Storage holds at path: {size, mime}, or a refusal when nothing was uploaded there. */
export async function storedFile(sb, path) {
  const r = await bucket(sb).info(path);
  const d = r && r.data;
  if (r.error || !d) throw bad('media-missing', 'The file did not finish uploading. Please try again.');
  const meta = d.metadata && typeof d.metadata === 'object' ? d.metadata : {};
  return { size: Number(d.size !== undefined ? d.size : meta.size) || 0, mime: String(d.contentType || d.content_type || meta.mimetype || '').toLowerCase() };
}

/**
 * Send one photo or video the browser uploaded to Storage, and store it in the conversation.
 *   ctx {orgId, conv, booking, via, path, caption, name, staffId, userId, now, channexConfig, request, fetch, waConfig,
 *        emailConfig, fromAddress, fromName}
 * The file's type and size are checked again from Storage (never from what the page said).
 * -> the conversation's data after the message was added
 */
export async function sendMediaReply(sb, ctx) {
  const now = ctx.now || Date.now();
  if (!ownsPath(ctx.orgId, ctx.conv.id, ctx.path)) throw bad('media-missing', 'The file did not finish uploading. Please try again.');
  const caption = String(ctx.caption || '').trim();
  if (caption.length > CAPTION_MAX) throw bad('too-long', 'The caption can be up to ' + CAPTION_MAX + ' characters.');
  const r = routes(ctx.conv, ctx.booking, now);
  const site = r.channex ? VIA_NAME[r.channex.via] : null;
  const f = await storedFile(sb, ctx.path);
  const kind = checkMedia(ctx.via, f.mime, f.size, site);
  const name = clip(String(ctx.name || '').replace(/[\\/\r\n"<>]/g, '').trim(), 120) || (kind === 'image' ? 'photo.' : 'video.') + MEDIA[kind].ext[f.mime];
  const msg = { from: 'staff', type: kind, text: caption || (kind === 'image' ? 'Photo' : 'Video'), name, mime: f.mime, size: f.size, file: { path: ctx.path }, time: myt(now), status: 'sent' };
  if (caption) msg.caption = caption;
  if (ctx.staffId) msg.staffId = ctx.staffId;
  const patch = {};
  const extra = [];
  if (ctx.via === 'whatsapp') {
    const { cfg, num } = await waRoute(sb, ctx, r);
    const link = await signedUrl(sb, ctx.path, 3600);
    const id = await waCall(() => sendMedia(cfg, num.phone_number_id, r.whatsapp.to, kind, link, caption, { fetch: ctx.fetch }));
    msg.via = 'whatsapp';
    msg.xid = 'wa:' + id;
    if (!ctx.conv.wa) patch.wa = r.whatsapp.to;
  } else if (ctx.via === 'channex') {
    if (!r.channex) throw bad('no-thread', 'This conversation did not come from a booking site, so there is nowhere to reply there.');
    const dl = await bucket(sb).download(ctx.path);
    if (dl.error || !dl.data) throw new ApiError(502, 'storage', 'The file could not be read. Please try again.');
    const b64 = Buffer.from(await dl.data.arrayBuffer()).toString('base64');
    let up;
    try {
      up = await tracked(sb, ctx.channexConfig, {
        method: 'POST', path: '/attachments', body: { attachment: { file: b64, file_name: name, file_type: f.mime } }, logPayload: { attachment: { file_name: name, file_type: f.mime, bytes: f.size } },
        orgId: ctx.orgId, propertyId: (ctx.booking && ctx.booking.channex && ctx.booking.channex.propertyId) || null, source: 'messages', byUser: ctx.userId, request: ctx.request
      });
    } catch (e) {
      throw channexRefusal(e);
    }
    const att = up && up.data && (up.data.id || (up.data.attributes && up.data.attributes.id));
    if (!att) throw new ApiError(502, 'channex-refused', 'The booking site did not take the photo. Please try again.');
    // Channex ignores an attachment sent with text, so a caption goes as its own message after the photo
    const res = await channexPost(sb, ctx, r, { message: { attachment_id: String(att) } }, { message: { attachment_id: String(att) } }, true);
    channexSent(ctx, r, res, msg, patch, now, ctx.path);
    if (caption) {
      const res2 = await channexPost(sb, ctx, r, { message: { message: caption } }, { message: { message: '[' + caption.length + ' characters]' } });
      const m2 = { from: 'staff', type: 'text', text: caption, time: myt(now), status: 'sent' };
      if (ctx.staffId) m2.staffId = ctx.staffId;
      channexSent(ctx, r, res2, m2, patch, now, caption);
      delete msg.caption;
      msg.text = 'Photo';
      extra.push(m2);
    }
  } else if (ctx.via === 'email') {
    const { to, cfg } = emailRoute(ctx);
    const link = await signedUrl(sb, ctx.path, 3600);
    const text = caption || (kind === 'image' ? 'Please see the attached photo.' : 'Please see the attached video.');
    const id = await sendEmail(cfg, { fromName: ctx.fromName, from: ctx.fromAddress, to, subject: ctx.conv.emSubject, text, inReplyTo: ctx.conv.emRef, attachments: [{ filename: name, path: link }] }, { fetch: ctx.fetch });
    msg.via = 'email';
    msg.xid = 'em:out:' + (id || createHash('sha256').update(to + now + ctx.path).digest('hex').slice(0, 32));
  } else {
    throw bad('bad-via', 'Choose how to send it.');
  }
  let v = await appendMsg(sb, ctx.orgId, ctx.conv.id, msg, 0, patch);
  for (const m of extra) v = (await appendMsg(sb, ctx.orgId, ctx.conv.id, m, 0, null)) || v;
  if (!v) throw new ApiError(500, 'server', 'The file was sent, but Orbique could not save it. Refresh to see it.');
  return v;
}

/* ---------- organising: pin, archive, lists, favourites, Deleted (0022) ---------- */

/** Days a chat stays in Deleted before it is removed for good. */
export const TRASH_DAYS = 30;

/**
 * Change a conversation's own flags in one step. change {set, unset: [keys], add: {key: value}, remove: {key: value},
 * unreadMin}. -> {id, data} or null when the conversation is gone.
 */
export async function markConv(sb, orgId, id, change) {
  return rpc(sb, 'inbox_mark', {
    p_org: orgId, p_cid: id, p_set: change.set || {}, p_unset: change.unset || [], p_add: change.add || {}, p_remove: change.remove || {},
    p_unread_min: Number.isInteger(change.unreadMin) ? change.unreadMin : null
  }, 'update conversation');
}

/** Every file this chat has in Storage goes (before a chat is removed for good). Never throws. -> true when the folder
 * is empty now, false when Storage refused or failed (the chat is then kept, to try again later). */
export async function removeConvFiles(sb, orgId, convId) {
  try {
    const dir = orgId + '/' + String(convId).replace(/[^A-Za-z0-9_-]/g, '_');
    for (let i = 0; i < 20; i++) {
      const r = await bucket(sb).list(dir, { limit: 100 });
      if (!r || r.error) return false;
      const names = (Array.isArray(r.data) ? r.data : []).map((x) => x && x.name).filter((n) => typeof n === 'string' && n);
      if (!names.length) return true;
      const del = await bucket(sb).remove(names.map((n) => dir + '/' + n));
      if (del && del.error) return false;
      if (names.length < 100) return true;
    }
    return false;
  } catch (e) {
    console.error('[inbox] remove files:', e && e.message);
    return false;
  }
}

/** Remove one chat in Deleted for good: its files first, then the record (a tombstone, 0022 inbox_forget). before:
 * only if it went into Deleted before then (null: any time). -> 'removed', 'kept' (no longer in Deleted) or 'files'
 * (Storage failed; nothing removed from the records, so a later try finds the folder again). */
export async function forgetConv(sb, orgId, id, before = null) {
  if (!(await removeConvFiles(sb, orgId, id))) return 'files';
  return (await rpc(sb, 'inbox_forget', { p_org: orgId, p_cid: id, p_before: before }, 'remove conversation')) === true ? 'removed' : 'kept';
}

/** Chats removed per purgeTrash call: one inbox opening or one nightly run (the rest go next time). */
export const PURGE_BATCH = 50;

/** Remove for good the chats in Deleted for more than TRASH_DAYS (orgId null: every workspace), and uploads never
 * sent (dropStaleUploads). -> how many chats */
export async function purgeTrash(sb, orgId, now = Date.now()) {
  const before = myt(now - TRASH_DAYS * 86400000);
  const rows = await rpc(sb, 'inbox_purge_due', { p_org: orgId || null, p_before: before, p_limit: PURGE_BATCH }, 'empty Deleted');
  let n = 0;
  for (const r of Array.isArray(rows) ? rows : []) if (r && r.org_id && r.id && (await forgetConv(sb, r.org_id, r.id, before)) === 'removed') n++;
  await dropStaleUploads(sb, orgId, now);
  return n;
}

/* ---------- uploads never sent (0022 inbox_uploads) ---------- */

/** An upload address was handed out for path: remembered until the file is sent. */
export async function noteUpload(sb, orgId, path) {
  must(await sb.from('inbox_uploads').upsert({ path, org_id: orgId }, { onConflict: 'path' }), 'note upload');
}

/** The file at path was sent: it is the chat's now. Never throws (a row left behind is checked again before removal). */
export async function uploadSent(sb, path) {
  try { must(await sb.from('inbox_uploads').delete().eq('path', path), 'upload sent'); } catch (e) { console.error('[inbox] upload sent:', e && e.message); }
}

/** Hours an upload may wait to be sent before its file is removed. */
export const UPLOAD_HOURS = 24;

/** Remove the files of uploads older than UPLOAD_HOURS that no message in their chat refers to (orgId null: every
 * workspace), at most PURGE_BATCH per call. Never throws. -> how many files went */
export async function dropStaleUploads(sb, orgId, now = Date.now()) {
  try {
    let q = sb.from('inbox_uploads').select('path, org_id').lt('created_at', new Date(now - UPLOAD_HOURS * 3600000).toISOString());
    if (orgId) q = q.eq('org_id', orgId);
    const rows = must(await q.order('created_at').limit(PURGE_BATCH), 'load uploads') || [];
    let n = 0;
    for (const u of rows) {
      const conv = String(u.path).split('/')[1] || '';
      const c = conv ? await record(sb, u.org_id, 'conversations', conv) : null;
      const used = c && Array.isArray(c.messages) && c.messages.some((m) => m && m.file && m.file.path === u.path);
      if (!used) {
        const del = await bucket(sb).remove([u.path]);
        if (del && del.error) continue;
        n++;
      }
      await uploadSent(sb, u.path);
    }
    return n;
  } catch (e) {
    console.error('[inbox] old uploads:', e && e.message);
    return 0;
  }
}
