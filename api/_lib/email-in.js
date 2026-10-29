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
 *   agodaMessage(email)                      an Agoda guest email: the guest's words, Agoda's translation, a special request's answer links
 *   receiveEmail(sb, cfg, orgId, email, opts)  one email -> a guest message (answerable by email) or a notification
 *   sendEmail(cfg, msg, opts)                one reply by email (from the workspace's address, so answers come back);
 *                                            msg.attachments [{filename, path}]: files Resend fetches from https addresses
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

/* a character reference as text: a space for one that names no character */
const codePoint = (n) => (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ');

/* script, style, head and title blocks taken out, in one pass (a regex with a lazy match would scan to the end of the
   email again for every block left open) */
function dropBlocks(html) {
  const re = /<(script|style|head|title)\b/gi, done = {};
  let out = '', at = 0, m;
  while ((m = re.exec(html))) {
    const name = m[1].toLowerCase();
    if (done[name] || m.index < at) continue;
    const close = new RegExp('</' + name + '\\s*>', 'gi');
    close.lastIndex = m.index;
    const c = close.exec(html);
    if (!c) { done[name] = 1; continue; }   // never closed: as the regex did, leave it
    out += html.slice(at, m.index) + ' ';
    at = c.index + c[0].length; re.lastIndex = at;
  }
  return out + html.slice(at);
}

/** HTML -> readable plain text (links keep their address). Tags never span a '<', so every pattern stays linear. */
export function htmlText(html) {
  return dropBlocks(String(html || ''))
    .replace(/<a\s[^<>]*href\s*=\s*["']?(https?:[^"'\s<>]+)["']?[^<>]*>([\s\S]{0,8000}?)<\/a>/gi, (m0, href, inner) => {
      const t = inner.replace(/<[^<>]+>/g, '').trim();
      return t && t !== href ? t + ' (' + href + ')' : href;
    })
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n').replace(/<li[^<>]*>/gi, '• ')
    .replace(/<[^<>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+|#39);/gi, (m0, e) => {
      if (ENT[e.toLowerCase()] !== undefined) return ENT[e.toLowerCase()];
      if (/^#x/i.test(e)) return codePoint(parseInt(e.slice(2), 16));
      if (/^#\d/.test(e)) return codePoint(Number(e.slice(1)));
      return m0;
    })
    .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- Agoda's guest emails ---------- */

/* Agoda sends each guest message in an email of its own: a logo with a tracking link, "New message from …" or "New
   inquiry from …", the guest's name and the time, the message and Google's translation of it, buttons, tips, the
   booking, the earlier messages and a legal footer. agodaMessage keeps what the guest wrote, Agoda's translation when
   it differs, and the answer buttons of a special request (links to Agoda's own site only). It reads the HTML part by
   the ids Agoda gives it, else the text part, and gives null for an email laid out some other way (that one shows
   whole, as before). */

/* the inner HTML of the first element with this id, or null */
function byId(html, id) {
  const m = new RegExp('<([a-z][a-z0-9]*)\\b[^<>]{0,2000}?\\bid\\s*=\\s*["\']?' + id + '(?=["\'\\s/>])[^<>]{0,2000}>', 'i').exec(html);
  if (!m) return null;
  const tag = new RegExp('<(/?)' + m[1] + '\\b[^<>]{0,2000}>', 'gi'), start = m.index + m[0].length;
  tag.lastIndex = start;
  let depth = 1, x;
  while ((x = tag.exec(html))) {
    if (!x[1]) { if (!/\/>$/.test(x[0])) depth++; } else if (--depth === 0) return html.slice(start, x.index);
  }
  return html.slice(start);
}
const AG_ENT = { rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', eacute: '\u00e9', egrave: '\u00e8', aacute: '\u00e1', agrave: '\u00e0', iacute: '\u00ed', oacute: '\u00f3', uacute: '\u00fa', ntilde: '\u00f1', ccedil: '\u00e7', uuml: '\u00fc', ouml: '\u00f6', auml: '\u00e4', bull: '\u2022', middot: '\u00b7', times: '\u00d7', euro: '\u20ac', pound: '\u00a3', copy: '\u00a9', reg: '\u00ae', trade: '\u2122', deg: '\u00b0' };
const unEnt = (s) => String(s || '').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m0, e) => {
  const k = e.toLowerCase();
  if (ENT[k] !== undefined) return ENT[k];
  if (AG_ENT[e] !== undefined) return AG_ENT[e];
  if (/^#x/i.test(e)) return codePoint(parseInt(e.slice(2), 16));
  if (/^#\d/.test(e)) return codePoint(Number(e.slice(1)));
  return m0;
});
const tidyText = (t) => String(t || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  .split('\n').map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const asText = (h) => tidyText(unEnt(htmlText(String(h || '').replace(/<img\b[^<>]{0,2000}>/gi, ' ').replace(/&amp;/gi, '&#38;'))));
const AG_CONFIRM = /^please confirm below if you agree to the special requests\.?$/i;
const dropConfirm = (t) => t.split('\n').filter((l) => !AG_CONFIRM.test(l)).join('\n').trim();

function agodaHtml(html) {
  // a reply or an inquiry: the message as translated, then the original
  const orig = byId(html, 'mainMessageContent'), tl = byId(html, 'mainTranslatedMessageContent');
  if (orig !== null || tl !== null) return { text: asText(orig !== null ? orig : tl), translated: orig !== null && tl !== null ? asText(tl) : null };
  // a new message or a special request: a card with the sender, a rule, the message, Google's translation, buttons
  const card = byId(html, 'card');
  const hr = card ? card.search(/<hr\b[^>]*>/i) : -1;
  if (hr < 0) return null;
  let body = card.slice(hr).replace(/^<hr\b[^>]*>/i, '');
  const end = body.search(/<[a-z][^<>]{0,2000}?\bid\s*=\s*["']?(translated-message|special-request-button|replyLink|nudge-property-notice-card)/i);
  if (end >= 0) body = body.slice(0, end);
  const special = /special-request-button/i.test(card);
  body = body.replace(/<p\b[^<>]{0,2000}?\bid\s*=\s*["']?salutation\b[^<>]{0,2000}>[\s\S]{0,2000}?<\/p>/i, ' ');
  const box = byId(html, 'translated-message');
  return { text: special ? dropConfirm(asText(body)) : asText(body), translated: box !== null ? asText(box).replace(/^google translate\s*/i, '').trim() : null };
}

const AG_HEAD = /^(new (message|inquiry|request|reply) from|reply from|message from)\b/i;
const AG_TIME = /\b\d{1,2}:\d{2}\s*(?:[AP]M\s+)?(?:[A-Z]{2,5}\b|GMT[+-]\d{1,2}(?::?\d{2})?)/;
const AG_ZONE = '(?:[A-Z]{2,5}|GMT[+-]\\d{1,2}(?::?\\d{2})?)';
/* a time line, or the end of one wrapped onto the next line ("PM ICT") */
const AG_STAMP = new RegExp('^(([A-Z][a-z]{2,8}\\.? \\d{1,2},? (\\d{4} )?)?\\d{1,2}:\\d{2}\\s*([AP]M\\s+)?' + AG_ZONE + '|[AP]M ' + AG_ZONE + ')( [A-Z][a-z]{2,8}\\.? \\d{1,2},? (\\d{4} )?\\d{1,2}:\\d{2}(\\s*([AP]M\\s+)?' + AG_ZONE + ')?)*$');
const AG_XL = /^the above text was translated automatically\b/i;
const AG_END = /^(did you know\?|reply in ycs app|reply through ycs\b|booking details$|responding to this inquiry is easy|important: this feature allows direct communication|except to the extent that agoda|this email was sent by: agoda)/i;

function agodaPlain(text) {
  const L = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim());
  const next = (i) => { while (i < L.length && !L[i]) i++; return i; };
  const google = (i) => /^google translate$/i.test(L[i]) || (/^google$/i.test(L[i]) && /^translate$/i.test(L[next(i + 1)] || ''));
  const stop = (i) => /^-{8,}$/.test(L[i]) || AG_XL.test(L[i]) || AG_END.test(L[i]) || google(i) || (/^accepted\b/i.test(L[i]) && /^subject to\b/i.test(L[next(i + 1)] || ''));
  const take = (i) => { const out = []; for (; i < L.length && !stop(i); i++) out.push(L[i]); return { text: tidyText(out.join('\n')), end: i }; };
  const h = L.findIndex((l) => AG_HEAD.test(l));
  if (h < 0) return null;
  let s = -1;
  for (let i = next(h + 1), seen = 0; i < L.length && seen < 3; i = next(i + 1), seen++) if (AG_TIME.test(L[i])) { s = i + 1; break; }
  if (s < 0) return null;
  while (s < L.length && (!L[s] || /^-{8,}$/.test(L[s]) || AG_STAMP.test(L[s]) || /^booking id:? *\d+$/i.test(L[s]))) s++;
  const a = take(s);
  let msg = a.text, translated = null;
  if (a.end < L.length && AG_XL.test(L[a.end])) {
    // the message as translated, "… from the original message below:", the original
    let j = a.end;
    while (j < L.length && j - a.end < 3 && !/below:$/i.test(L[j])) j++;
    if (j < L.length && /below:$/i.test(L[j])) { translated = msg; msg = take(j + 1).text || msg; }
  } else if (a.end < L.length && google(a.end)) {
    // the message, then "Google translate" and the translation
    translated = take((/^google$/i.test(L[a.end]) ? next(a.end + 1) : a.end) + 1).text || null;
  }
  if (L.some((l) => AG_CONFIRM.test(l))) msg = dropConfirm(msg.replace(/^dear [^\n]{1,120},\n/i, ''));
  return { text: msg, translated };
}

/* the answer buttons of a special request: [{kind, label, url}], links to agoda.com over https only */
const AG_ACTS = [['accepted', 'Accepted'], ['subject-to-availability', 'Subject to availability'], ['not-approved', 'Not accepted']];
export function agodaUrl(raw) {
  const s = unEnt(String(raw || '').trim());
  if (!s || s.length > 2000 || /[\s"'<>\\]/.test(s)) return null;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hostname.toLowerCase() !== 'portal.agoda.com' || !/^\/[^?#]*\/propertymessage\//i.test(u.pathname)) return null;
  return u.href;
}
export function agodaActions(html) {
  const found = {};
  const re = /<a\b([^<>]{0,4000})>([\s\S]{0,4000}?)<\/a>/gi;
  let m;
  const src = String(html || ''), card = byId(src, 'card'), part = card !== null ? card : src;   // not the earlier messages quoted below
  while ((m = re.exec(part))) {
    const attrs = m[1];
    const id = (/\bid\s*=\s*["']?([\w-]+)/i.exec(attrs) || [])[1] || '';
    const label = asText(m[2]).toLowerCase();
    const act = AG_ACTS.find(([k]) => id === 'special-request-button-' + k) ||
      (/\bclass\s*=\s*["'][^"']*special-request-button/i.test(attrs) ? AG_ACTS.find(([, t]) => t.toLowerCase() === label) : null);
    if (!act || found[act[0]]) continue;
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const url = href && agodaUrl(href[1] || href[2] || href[3]);
    if (url) found[act[0]] = { kind: act[0], label: act[1], url };
  }
  return AG_ACTS.map(([k]) => found[k]).filter(Boolean);
}

/** An Agoda guest email -> {text, translated (Agoda's, when it differs), actions} or null (not laid out the way Agoda does). */
const AG_MAX_HTML = 400000;
export function agodaMessage(email) {
  try { return agodaRead(email); } catch (e) { return null; }   // then the email shows whole, as before
}
function agodaRead(email) {
  let html = typeof email.html === 'string' ? email.html : '';
  if (html.length > AG_MAX_HTML) html = '';   // far bigger than Agoda's: its text part only
  const got = (html && agodaHtml(html)) || agodaPlain(email.text) || (html && agodaPlain(asText(html))) || null;
  if (!got || !got.text) return null;
  const same = (a, b) => String(a || '').replace(/\s+/g, ' ').trim().toLowerCase() === String(b || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return { text: got.text, translated: got.translated && !same(got.translated, got.text) ? got.translated : null, actions: html ? agodaActions(html) : [] };
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

/** A sign-in or verification code in the email ("Here's your verification code: 741225"), so it shows without opening the email. */
const CODE_EMAIL = /verif|\bcode\b|\botp\b|one[- ]time|passcode|security code|sign[- ]?in|log[- ]?in/i;
export function codeIn(subject, text) {
  if (!CODE_EMAIL.test(String(subject || ''))) return null;
  const t = String(text || '').replace(/\(?https?:\/\/\S+/g, ' ');
  const m = t.match(/(?:code|otp|passcode|pin)\b[^0-9\n]{0,40}(?:\n\s*){0,3}\b(\d{4,8})\b/i) || t.match(/^\s*(\d{4,8})\s*$/m);
  return m ? m[1] : null;
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
  const files = (Array.isArray(msg.attachments) ? msg.attachments : []).filter((a) => a && typeof a.path === 'string' && /^https:\/\//.test(a.path)).slice(0, 5);
  if (files.length) body.attachments = files.map((a) => ({ filename: String(a.filename || 'file').replace(/[\\/\r\n"<>]/g, '').slice(0, 120) || 'file', path: a.path }));
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
      text: site + ': ' + subject + (codeIn(subject, full) ? ' · Code ' + codeIn(subject, full) : ''), subject, body: clip(full, MAX_TEXT) + (files.length ? '\n\nAttachments (in the original email): ' + files.join(', ') : '')
    }, { now });
    return Object.assign({ kind: 'notice', bookingId: b ? b.id : null }, r);
  }
  if (!c.replyTo) return { status: 'ignored', kind: 'message' };
  const ag = c.platform === 'agoda' ? agodaMessage(email) : null;
  const text = clip(ag ? ag.text : stripQuoted(full), MAX_TEXT) || subject;
  const extra = { contact: { name: c.name || c.replyTo, phone: null }, kind: 'email', emSubject: subject, emRef: clip(email.message_id, 300) || null };
  if (c.platform) extra.ota = { airbnb: 'Airbnb', booking: 'Booking.com', agoda: 'Agoda', tripcom: 'Trip.com', expedia: 'Expedia' }[c.platform];
  const convId = await k.findConv(sb, orgId, 'em', c.replyTo, b && b.id, extra, now);
  if (!convId) return { status: 'ignored', kind: 'message' };
  const msg = { from: 'guest', type: 'text', text, time: k.myt(at), via: 'email', xid, subject };
  if (c.name) msg.sender = c.name;
  if (files.length) msg.files = files;
  if (ag && ag.actions.length) msg.actions = ag.actions;
  const set = k.translated ? await k.inboxSettings(sb, orgId) : null;
  const tr = set ? await k.translated(text, set, opts) : {};
  Object.assign(msg, tr);
  // Agoda's own translation (into English) when there is no other
  if (ag && ag.translated && !msg.tr && set && set.autoTranslate && set.lang === 'en') msg.tr = { to: 'en', text: clip(ag.translated, MAX_TEXT) };
  const v = await k.appendMsg(sb, orgId, convId, msg, 1, tr.lang ? { lang: tr.lang } : null);
  return { status: v ? 'stored' : 'duplicate', kind: 'message', conversationId: convId, bookingId: b ? b.id : null };
}

