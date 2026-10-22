/* The operator's booking email in the inbox (server only). Each workspace gets one Orbique address
 * (e.g. otto-k3f9@orbiquefms.com, inbound_addresses in 0012); the operator forwards their booking mailbox
 * (bookings@their-domain) to it. Resend Inbound receives the mail and calls api/email-inbound.js, which hands it here.
 * Private module: Vercel does not expose files under api/_lib as endpoints.
 *
 *   inboundConfig(env)                       {configured, key, webhookSecret, domain, baseUrl}
 *   verifySvix(secret, raw, headers, now)    Resend signs its webhooks the Svix way
 *   addressFor(sb, cfg, org, userId)         the address replies go from: its own one, else its Orbique one (made the first time)
 *   orgForAddresses(sb, list)                which workspace one of these addresses belongs to
 *   classify(email)                          {platform, kind: 'message' | 'notice', replyTo, name}
 *   bodyText(email), stripQuoted(text)       the readable text of an email
 *   receiveEmail(sb, cfg, orgId, email, opts)  one email -> a guest message (answerable by email) or a notification
 *   sendEmail(cfg, msg, opts)                one reply by email (from the workspace's address, so answers come back)
 *
 * Emails are untrusted: they are stored as plain text (never HTML) and nothing in them is followed or run.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from './http.js';
import { must, records, todayMY, addDays } from './channex-db.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clip = (v, n) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)).slice(0, n);
export const MAX_TEXT = 4096;
export const SVIX_WINDOW_S = 300;

/* ---------- settings ---------- */

function domainOf(from) {
  const m = /@([a-z0-9.-]+\.[a-z]{2,})\s*>?\s*$/i.exec(String(from || '').trim());
  return m ? m[1].toLowerCase() : '';
}

export function inboundConfig(env = process.env) {
  const key = String(env.RESEND_API_KEY || '').trim();
  const webhookSecret = String(env.RESEND_WEBHOOK_SECRET || '').trim();
  const domain = String(env.INBOUND_EMAIL_DOMAIN || '').trim().toLowerCase() || domainOf(env.ALERT_EMAIL_FROM);
  return { configured: !!(key && webhookSecret && domain), key, webhookSecret, domain, baseUrl: String(env.RESEND_BASE_URL || 'https://api.resend.com').replace(/\/+$/, '') };
}

/* ---------- webhook signature (Svix: HMAC-SHA256 of "id.timestamp.body" with the base64 secret after "whsec_") ---------- */

const hdr = (h, name) => { const v = h && (h[name] || h[name.toLowerCase()]); return Array.isArray(v) ? v.join(' ') : v ? String(v) : ''; };

export function verifySvix(secret, raw, headers, now = Date.now()) {
  if (!secret) return false;
  const id = hdr(headers, 'svix-id') || hdr(headers, 'webhook-id');
  const ts = hdr(headers, 'svix-timestamp') || hdr(headers, 'webhook-timestamp');
  const sigs = hdr(headers, 'svix-signature') || hdr(headers, 'webhook-signature');
  if (!id || !/^\d{1,12}$/.test(ts) || !sigs) return false;
  if (Math.abs(now / 1000 - Number(ts)) > SVIX_WINDOW_S) return false;
  let key;
  try { key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64'); } catch (e) { return false; }
  if (!key.length) return false;
  const want = createHmac('sha256', key).update(id + '.' + ts + '.').update(Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw))).digest();
  return sigs.split(/\s+/).some((s) => {
    const [ver, val] = s.split(',');
    if (ver !== 'v1' || !val) return false;
    let got;
    try { got = Buffer.from(val, 'base64'); } catch (e) { return false; }
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

/* ---------- addresses ---------- */

const RESERVED = /^(alerts?|admin|postmaster|abuse|hostmaster|webmaster|no-?reply|support|hello|info|mail|root|security|billing|orbique)$/;

export function slugOf(name) {
  const s = String(name || '').normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20).replace(/-+$/, '');
  return s && !RESERVED.test(s) ? s : 'team';
}

/** The address the workspace answers email from: its own address (kind 'own', 0013) when it has one, else its
 * Orbique address (created the first time, with a short random part so it is not guessed). */
export async function addressFor(sb, cfg, org, userId) {
  const mine = async () => {
    const rows = must(await sb.from('inbound_addresses').select('address, kind').eq('org_id', org.id), 'load email address') || [];
    const own = rows.find((r) => r.kind === 'own');
    return (own || rows[0] || {}).address || null;
  };
  const got = await mine();
  if (got) return got;
  if (!cfg.domain) return null;
  for (let i = 0; i < 5; i++) {
    const tail = randomBytes(4).toString('base64').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 4).padEnd(4, 'x');
    const address = slugOf(org.name) + '-' + tail + '@' + cfg.domain;
    const ins = await sb.from('inbound_addresses').insert({ address, org_id: org.id, created_by: userId || null }).select('address');
    if (!ins.error && ins.data && ins.data[0]) return ins.data[0].address;
    // another request made one at the same moment (one per kind per workspace), or the name was taken: look again / try again
    const again = await mine();
    if (again) return again;
  }
  throw new ApiError(500, 'server', 'Could not make an email address for this workspace. Please try again.');
}

/** Bare, lower-case addresses from "Name <a@b.c>", ["a@b.c", ...] and the like. */
export function addresses(v) {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  const out = [];
  for (const x of list) {
    const s = isObj(x) ? x.email || x.address || '' : String(x || '');
    for (const part of s.split(',')) {
      const m = /<([^<>\s@]+@[^<>\s@]+)>/.exec(part) || /([^\s<>"',;:@]+@[^\s<>"',;:@]+\.[a-z]{2,})/i.exec(part);
      if (m) out.push(m[1].toLowerCase());
    }
  }
  return out.filter((a, i) => out.indexOf(a) === i);
}

/** The workspace one of these addresses belongs to: {orgId, address} or null. */
export async function orgForAddresses(sb, list) {
  const want = addresses(list);
  if (!want.length) return null;
  const r = must(await sb.from('inbound_addresses').select('address, org_id').in('address', want.slice(0, 50)), 'find email address') || [];
  return r[0] ? { orgId: r[0].org_id, address: r[0].address } : null;
}

/* ---------- reading an email ---------- */

const PLATFORMS = [
  ['airbnb', /(^|\.)airbnb\.[a-z.]+$/],
  ['booking', /(^|\.)booking\.com$/],
  ['agoda', /(^|\.)agoda(-messaging)?\.[a-z.]+$|(^|\.)agoda\.net$/],
  ['tripcom', /(^|\.)(trip|ctrip|tripcdn)\.com$/],
  ['expedia', /(^|\.)(expedia|expediapartnercentral|hotels|vrbo|expediagroup)\.[a-z.]+$/]
];
/* addresses the booking sites give each guest, so an email to it reaches the guest */
const RELAY = /(^|\.)(guest\.booking\.com|reply\.expedia\.com|m\.expediapartnercentral\.com|agoda-messaging\.com|messaging\.agoda\.com)$/;
const NOREPLY = /^(no-?reply|do-?not-?reply|donotreply|noreply|notifications?|notify|alerts?|mailer-daemon|postmaster|news(letter)?|marketing|accounts?|security|payments?|payouts?|billing|automated|auto(mail)?|system|bounces?|forwarding-noreply|express|reservations?-noreply|customer\.service)([+._-]|$)/i;

export function platformOfDomain(domain) {
  for (const [p, re] of PLATFORMS) if (re.test(domain)) return p;
  return null;
}

function nameOf(from) {
  const s = String(isObj(from) ? from.name || '' : from || '');
  const m = /^\s*"?([^"<]*?)"?\s*</.exec(s);
  return m && m[1].trim() ? m[1].trim().slice(0, 80) : '';
}

/**
 * What an email is: a guest's message (answerable by email) or a notification.
 * -> {platform: 'airbnb'|'booking'|'agoda'|'tripcom'|'expedia'|null, kind: 'message'|'notice', replyTo, from, name}
 */
export function classify(email) {
  const from = addresses(email.from)[0] || '';
  const replyTo = addresses(email.reply_to)[0] || from;
  const fromDomain = from.split('@')[1] || '';
  const replyDomain = replyTo.split('@')[1] || '';
  const platform = platformOfDomain(fromDomain) || platformOfDomain(replyDomain);
  const relay = RELAY.test(replyDomain) || RELAY.test(fromDomain);
  const local = (replyTo || from).split('@')[0] || '';
  let kind;
  if (relay) kind = 'message';
  else if (platform) kind = 'notice'; // the booking sites' own emails: bookings, payouts, reviews, account notices
  else kind = !from || NOREPLY.test(local) || NOREPLY.test(from.split('@')[0] || '') ? 'notice' : 'message';
  return { platform, kind, replyTo: relay ? (RELAY.test(replyDomain) ? replyTo : from) : replyTo, from, name: nameOf(Array.isArray(email.from) ? email.from[0] : email.from) };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** HTML -> readable plain text (links keep their address). */
export function htmlText(html) {
  return String(html || '')
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<a\s[^>]*href\s*=\s*["']?(https?:[^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi, (m0, href, inner) => {
      const t = inner.replace(/<[^>]+>/g, '').trim();
      return t && t !== href ? t + ' (' + href + ')' : href;
    })
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+|#39);/gi, (m0, e) => {
      if (ENT[e.toLowerCase()] !== undefined) return ENT[e.toLowerCase()];
      if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16) || 32);
      if (/^#\d/.test(e)) return String.fromCodePoint(Number(e.slice(1)) || 32);
      return m0;
    })
    .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* marketing mailers (Trip.com and others) start the text part with "[https://…/open.gif?…]" image and tracking links,
   which can fill the whole message before the code or booking details; drop those and shorten very long links */
const LONG_URL = 200;
export function tidyLinks(t) {
  return String(t || '')
    .replace(/\[(https?:\/\/[^\]\s]*)\]/gi, (m0, u) => (/\.(gif|png|jpe?g|webp|bmp)(\?|$)/i.test(u) || u.length > LONG_URL ? ' ' : m0))
    .replace(/\(?(https?:\/\/[^\s<>()"']{200,})\)?/gi, (m0, u) => '(' + u.slice(0, u.indexOf('/', 8) > 0 ? u.indexOf('/', 8) : 40) + '/…)')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
}

export function bodyText(email) {
  const raw = typeof email.text === 'string' && email.text.trim() ? email.text : '';
  let t = tidyLinks(raw).trim();
  if (!t && email.html) t = tidyLinks(htmlText(email.html.replace(/<img\b[^>]*>/gi, ' ')));
  return String(t || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

/** The new part of a reply: without the quoted earlier email ("On … wrote:", "> …", "-----Original Message-----"). */
export function stripQuoted(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*>/.test(l)) break;
    if (/^\s*-{2,}\s*(original message|forwarded message)/i.test(l)) break;
    if (/^\s*On .{4,200}(wrote|schrieb|a écrit|escribió):\s*$/i.test(l) || (/^\s*On .{4,200}$/i.test(l) && /wrote:\s*$/i.test(lines[i + 1] || ''))) break;
    if (/^\s*From: .+/i.test(l) && /^\s*(Sent|Date|To): /i.test(lines[i + 1] || '')) break;
    out.push(l);
  }
  const s = out.join('\n').trim();
  return s || String(text || '').trim();
}

/* ---------- matching a booking ---------- */

async function bookingsNear(sb, orgId, now) {
  const today = todayMY(now);
  return records(sb, orgId, 'bookings', (q) => q.gte('data->>checkOut', addDays(today, -120)).lte('data->>checkIn', addDays(today, 500)));
}

/** The booking an email is about: its reservation number or Orbique booking id in the subject or text, else the guest's email. */
export function matchBooking(list, { subject, text, from, replyTo }) {
  const hay = ' ' + String(subject || '') + '\n' + String(text || '').slice(0, 20000) + ' ';
  let best = null, bestLen = 0;
  for (const b of list || []) {
    if (!b) continue;
    for (const code of [b.reservationCode, b.id]) {
      const c = String(code || '').trim();
      if (c.length < 5 || c.length <= bestLen) continue;
      const re = new RegExp('(^|[^A-Za-z0-9])' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z0-9])');
      if (re.test(hay)) { best = b; bestLen = c.length; }
    }
  }
  if (best) return best;
  const mails = [from, replyTo].filter(Boolean).map((x) => x.toLowerCase());
  const byMail = (list || []).filter((b) => b && b.status !== 'cancelled' && b.guest && b.guest.email && mails.includes(String(b.guest.email).trim().toLowerCase()))
    .sort((a, c) => (a.checkIn < c.checkIn ? 1 : -1));
  return byMail[0] || null;
}

/* ---------- Resend API ---------- */

async function call(cfg, method, path, body, opts = {}) {
  const fetchFn = opts.fetch || fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs || 8000);
  let res, json = null;
  try {
    res = await fetchFn(cfg.baseUrl + path, { method, headers: { Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    try { json = await res.json(); } catch (e) { json = null; }
  } catch (e) {
    throw new ApiError(502, 'email-unavailable', 'The email service did not answer. Please try again in a minute.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const msg = clip(json && (json.message || json.error), 300) || 'HTTP ' + res.status;
    const e = new ApiError(res.status >= 500 || res.status === 429 ? 502 : 400, 'email', 'The email service refused it: ' + msg);
    e.upstream = res.status;
    throw e;
  }
  return json || {};
}

/** The whole received email (Resend's webhook carries only its id, sender and subject). */
export const fetchEmail = (cfg, id, opts) => call(cfg, 'GET', '/emails/receiving/' + encodeURIComponent(id), null, opts);

/**
 * Send one email reply. msg {fromName, from (the workspace's address), to, subject, text, inReplyTo}
 * -> Resend's email id
 */
export async function sendEmail(cfg, msg, opts = {}) {
  if (!cfg.key) throw new ApiError(503, 'not-configured', 'Email is not set up on the server yet (RESEND_API_KEY).');
  const name = String(msg.fromName || 'Reservations').replace(/["<>\r\n]/g, '').slice(0, 60);
  const subject = String(msg.subject || '').replace(/[\r\n]+/g, ' ').slice(0, 250);
  const body = {
    from: name + ' <' + msg.from + '>', to: [msg.to], reply_to: msg.from,
    subject: /^re:/i.test(subject) ? subject : 'Re: ' + (subject || 'Your stay'),
    text: String(msg.text || '')
  };
  if (msg.inReplyTo && /^<[^<>\s]{3,300}>$/.test(msg.inReplyTo)) body.headers = { 'In-Reply-To': msg.inReplyTo, References: msg.inReplyTo };
  const r = await call(cfg, 'POST', '/emails', body, opts);
  return r.id || null;
}

/* ---------- one email in ---------- */

/**
 * Store one received email for a workspace.
 *   email: Resend's received email ({id, from, to, reply_to, subject, text, html, message_id, attachments, created_at})
 *   opts {now, conv: {findConv, appendMsg, postNotice, translated, inboxSettings} (from inbox.js; tests replace them)}
 * -> {status: 'stored'|'duplicate'|'ignored', kind, conversationId?, bookingId?}
 */
export async function receiveEmail(sb, orgId, email, opts = {}) {
  const now = opts.now || Date.now();
  const k = opts.conv;
  const c = classify(email);
  const subject = clip(String(email.subject || '').replace(/[\r\n]+/g, ' ').trim(), 300) || '(no subject)';
  const full = bodyText(email);
  const list = await bookingsNear(sb, orgId, now);
  const b = matchBooking(list, { subject, text: full, from: c.from, replyTo: c.replyTo });
  const at = Date.parse(email.created_at || '') || now;
  const xid = 'em:' + String(email.id || email.message_id || '').slice(0, 120);
  const files = (Array.isArray(email.attachments) ? email.attachments : []).filter((a) => isObj(a) && a.content_disposition !== 'inline').map((a) => clip(a.filename, 120)).filter(Boolean).slice(0, 10);
  if (c.kind === 'notice') {
    const site = c.platform ? { airbnb: 'Airbnb', booking: 'Booking.com', agoda: 'Agoda', tripcom: 'Trip.com', expedia: 'Expedia' }[c.platform] : (c.name || c.from || 'Email');
    const r = await k.postNotice(sb, orgId, {
      bookingId: b && b.id, feed: c.platform || 'email', via: 'email', xid, at,
      text: site + ': ' + subject, subject, body: clip(full, MAX_TEXT) + (files.length ? '\n\nAttachments (in the original email): ' + files.join(', ') : '')
    }, { now });
    return Object.assign({ kind: 'notice', bookingId: b ? b.id : null }, r);
  }
  if (!c.replyTo) return { status: 'ignored', kind: 'message' };
  const text = clip(stripQuoted(full), MAX_TEXT) || subject;
  const extra = { contact: { name: c.name || c.replyTo, phone: null }, kind: 'email', emSubject: subject, emRef: clip(email.message_id, 300) || null };
  if (c.platform) extra.ota = { airbnb: 'Airbnb', booking: 'Booking.com', agoda: 'Agoda', tripcom: 'Trip.com', expedia: 'Expedia' }[c.platform];
  const convId = await k.findConv(sb, orgId, 'em', c.replyTo, b && b.id, extra, now);
  if (!convId) return { status: 'ignored', kind: 'message' };
  const msg = { from: 'guest', type: 'text', text, time: k.myt(at), via: 'email', xid, subject };
  if (c.name) msg.sender = c.name;
  if (files.length) msg.files = files;
  const tr = k.translated ? await k.translated(text, await k.inboxSettings(sb, orgId), opts) : {};
  Object.assign(msg, tr);
  const v = await k.appendMsg(sb, orgId, convId, msg, 1, tr.lang ? { lang: tr.lang } : null);
  return { status: v ? 'stored' : 'duplicate', kind: 'message', conversationId: convId, bookingId: b ? b.id : null };
}

