/* The live guest inbox (server only): messages from WhatsApp and from booking sites through Channex land in the booking's
 * `conversations` record (supabase/migrations/0010_inbox.sql), and replies go back out the way the guest wrote.
 * Private module: Vercel does not expose files under api/_lib as endpoints.
 *
 *   waDigits(phone), samePhone(a, b)            WhatsApp numbers (digits with the country code; Malaysian 01x gets 60)
 *   pickBooking(bookings, phone, today)         the stay a number belongs to: in house, else the next, else the last
 *   receiveWhatsApp(sb, m, opts)                one incoming WhatsApp message (parseWebhook) -> stored
 *   receiveWhatsAppStatus(sb, s)                sent / delivered / read / failed ticks
 *   receiveChannex(sb, prop, event, payload, opts)  Channex message, inquiry, reservation_request, alteration_request,
 *                                               accepted / declined reservation, thread assigned
 *   postNotice(sb, orgId, n, opts)              a platform notification: in the booking's chat, else the platform's feed
 *   sendReply(sb, ctx)                          one reply on WhatsApp, the booking site or email, then stored
 *   canInbox(sb, orgId, member, key)            the app's permission rules (O.can) for inbox.send / inbox.notes
 *
 * Message times are written the way the app writes them: Malaysia time 'YYYY-MM-DDTHH:MM'.
 */
import { createHash } from 'node:crypto';
import { ApiError, bad } from './http.js';
import { must, records, blob, tracked, todayMY, addDays } from './channex-db.js';
import { ChannexError } from './channex.js';
import { waConfig, sendText, WINDOW_MS, WhatsAppError } from './whatsapp.js';
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
  reviews: { ops: 'edit', frontdesk: 'edit' }
};
const ACTION_DEFAULT = {
  'inbox.send': ['ops', 'housekeeping', 'frontdesk'],
  'inbox.notes': ['ops', 'housekeeping', 'frontdesk'],
  'reviews.reply': ['ops', 'frontdesk']
};
const LV = { none: 0, view: 1, edit: 2 };

/** Whether this member may do key ('inbox' = see the inbox, 'inbox.send', 'inbox.notes', 'reviews.reply'). */
export async function canInbox(sb, orgId, member, key) {
  if (!member || member.status !== 'active') return false;
  if (member.role === 'owner') return true;
  const [rolePerms, staffMeta] = await Promise.all([blob(sb, orgId, 'rolePerms'), blob(sb, orgId, 'staffMeta')]);
  const meta = member.staff_id && isObj(staffMeta) ? staffMeta[member.staff_id] : null;
  if (meta && meta.status === 'suspended') return false;
  const ov = meta && isObj(meta.overrides) ? meta.overrides : {};
  const rp = isObj(rolePerms) ? rolePerms[member.role] : null;
  const sec = key.split('.')[0] === 'reviews' ? 'reviews' : 'inbox';
  const section = ('section:' + sec) in ov ? ov['section:' + sec] || 'none'
    : rp && isObj(rp.sections) && sec in rp.sections ? rp.sections[sec] : SECTION_DEFAULT[sec][member.role] || 'none';
  if (key === sec) return LV[section] >= 1;
  if (LV[section] < 2) return false;
  if (key in ov) return !!ov[key];
  if (rp && isObj(rp.actions) && key in rp.actions) return !!rp.actions[key];
  return (ACTION_DEFAULT[key] || []).includes(member.role);
}

/* ---------- replies ---------- */

/** The workspace's WhatsApp number: {phone_number_id, display_phone, verified_name} or null. */
export async function numberOf(sb, orgId) {
  return must(await sb.from('whatsapp_numbers').select('phone_number_id, display_phone, verified_name').eq('org_id', orgId).order('created_at').limit(1).maybeSingle(), 'load WhatsApp number');
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
  const patch = {};
  if (ctx.via === 'whatsapp') {
    const cfg = ctx.waConfig || waConfig();
    if (!cfg.configured) throw new ApiError(503, 'not-configured', 'WhatsApp is not set up on the server yet.');
    const num = await numberOf(sb, ctx.orgId);
    if (!num) throw bad('no-number', 'Connect your WhatsApp business number first (Guest inbox, WhatsApp settings).');
    if (!r.whatsapp) throw bad('no-phone', 'This guest has no phone number to message on WhatsApp.');
    if (!r.whatsapp.open) throw bad('window-closed', 'WhatsApp only allows a reply within 24 hours of the guest\'s last WhatsApp message. Ask the guest to message your WhatsApp number first, or reply through the booking site.');
    let id;
    try {
      id = await sendText(cfg, num.phone_number_id, r.whatsapp.to, text, { fetch: ctx.fetch });
    } catch (e) {
      if (e instanceof WhatsAppError) throw new ApiError(e.retryable ? 502 : 400, 'whatsapp', e.message);
      throw e;
    }
    msg.via = 'whatsapp';
    msg.xid = 'wa:' + id;
    if (!ctx.conv.wa) patch.wa = r.whatsapp.to;
  } else if (ctx.via === 'channex') {
    if (!r.channex) throw bad('no-thread', 'This conversation did not come from a booking site, so there is nowhere to reply there.');
    const path = r.channex.thread ? '/message_threads/' + r.channex.thread + '/messages' : '/bookings/' + r.channex.booking + '/messages';
    let res;
    try {
      res = await tracked(sb, ctx.channexConfig, {
        method: 'POST', path, body: { message: { message: text } }, logPayload: { message: { message: '[' + text.length + ' characters]' } },
        orgId: ctx.orgId, propertyId: (ctx.booking && ctx.booking.channex && ctx.booking.channex.propertyId) || null, source: 'messages', byUser: ctx.userId, request: ctx.request
      });
    } catch (e) {
      throw channexRefusal(e);
    }
    const d = res && res.data;
    const id = (d && (d.id || (d.attributes && d.attributes.id))) || createHash('sha256').update(path + now + text).digest('hex').slice(0, 32);
    const tid = d && d.relationships && d.relationships.message_thread && d.relationships.message_thread.data && d.relationships.message_thread.data.id;
    msg.via = r.channex.via;
    msg.xid = 'cx:' + id;
    if (!ctx.conv.cx && isUuid(tid)) patch.cx = tid;
    if (!ctx.conv.cxBooking && r.channex.booking) patch.cxBooking = r.channex.booking;
  } else if (ctx.via === 'email') {
    const to = typeof ctx.conv.em === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(ctx.conv.em) ? ctx.conv.em : '';
    if (!to) throw bad('no-email', 'This conversation did not come by email, so there is no address to answer.');
    const cfg = ctx.emailConfig || inboundConfig();
    if (!ctx.fromAddress) throw new ApiError(503, 'not-configured', 'Email is not set up for this workspace yet (Guest inbox, Settings).');
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

