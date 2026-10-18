/* Booking alerts to the team: email (Resend), WhatsApp (Meta's Cloud API) and the phone app (Firebase Cloud Messaging).
 * Server only. Private module: Vercel does not expose files under api/_lib as endpoints.
 *
 * The database queues the alerts (migration 0011: a trigger adds one alert_outbox row when a booking site, the guest
 * website or the guest app creates a booking, cancels it or moves its dates). This module sends them:
 *
 *   alertSettings(sb, orgId)            the workspace's alertSettings blob with defaults
 *   describe(row, ctx)                  {title, lines, text}: what an alert says (pure)
 *   processOutbox(sb, opts)             send the alerts that are due; each channel once, failed channels retried
 *   queueTest(sb, orgId, by)            a test alert, sent to every channel now
 *   channelStatus(sb, orgId)            which channels are set up, for the Automations page
 *   emailConfig(), pushConfig()         RESEND_API_KEY / ALERT_EMAIL_FROM, FIREBASE_SERVICE_ACCOUNT (never returned)
 *   googleAccessToken(cfg, opts)        an OAuth token for Firebase from the service account (signed JWT, cached)
 *
 * WhatsApp alerts use an approved message template (WHATSAPP_ALERT_TEMPLATE, default "booking_alert", language
 * WHATSAPP_ALERT_LANG, default "en") with two body values: the title and the details. WhatsApp only lets a business
 * write first with a template. Sent from the workspace's WhatsApp number (whatsapp_numbers).
 * Nothing here logs or returns a key, and error messages never include one.
 */
import { createSign } from 'node:crypto';
import { must, records, blob } from './channex-db.js';
import { waConfig, graph } from './whatsapp.js';

export const MAX_ATTEMPTS = 6;
export const MAX_AGE_MS = 2 * 86400000;           // an alert that could not go out for 2 days is dropped, not sent late
const BACKOFF_MS = [60e3, 2 * 60e3, 5 * 60e3, 15 * 60e3, 60 * 60e3];
export const CHANNELS = ['email', 'whatsapp', 'push'];
const CHANNEL_NAME = { airbnb: 'Airbnb', booking: 'Booking.com', agoda: 'Agoda', expedia: 'Expedia', trip: 'Trip.com', vrbo: 'Vrbo', direct: 'Direct', other: 'Another site' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clean = (s, max = 200) => (s === undefined || s === null ? '' : String(s).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max));
const errText = (e) => clean(e && e.message ? e.message : String(e), 300);
const digits = (p) => String(p || '').replace(/\D/g, '');

/* ---------- settings ---------- */

/** The workspace's alert settings with defaults: alerts on for every kind, phone app on, no email or WhatsApp yet. */
export function normalizeSettings(v) {
  const s = isObj(v) ? v : {};
  const kinds = isObj(s.kinds) ? s.kinds : {};
  const list = (a, ok, norm) => [...new Set((Array.isArray(a) ? a : []).map((x) => clean(x, 254)).filter(ok).map(norm))].slice(0, 10);
  return {
    on: s.on !== false,
    kinds: { new: kinds.new !== false, cancelled: kinds.cancelled !== false, changed: kinds.changed !== false },
    emails: list(s.emails, (x) => EMAIL_RE.test(x), (x) => x.toLowerCase()),
    whatsapp: list(s.whatsapp, (x) => digits(x).length >= 8 && digits(x).length <= 15, (x) => '+' + digits(x)),
    push: s.push !== false
  };
}
export async function alertSettings(sb, orgId) {
  return normalizeSettings(await blob(sb, orgId, 'alertSettings').catch(() => null));
}

/* ---------- config (from Vercel's environment; never sent anywhere) ---------- */

export function emailConfig(env = process.env) {
  const key = String(env.RESEND_API_KEY || '').trim();
  const from = clean(env.ALERT_EMAIL_FROM, 200) || 'Orbique <onboarding@resend.dev>';
  return { key, from, configured: !!key, baseUrl: String(env.RESEND_URL || '').trim().replace(/\/+$/, '') || 'https://api.resend.com' };
}

export function pushConfig(env = process.env) {
  let sa = null;
  const raw = String(env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (raw) {
    try {
      sa = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    } catch (e) { sa = null; }
  }
  const ok = !!(sa && sa.client_email && sa.private_key && sa.project_id);
  return {
    configured: ok,
    invalid: !!raw && !ok,
    projectId: ok ? String(sa.project_id) : null,
    clientEmail: ok ? String(sa.client_email) : null,
    privateKey: ok ? String(sa.private_key).replace(/\\n/g, '\n') : null,
    tokenUrl: (ok && sa.token_uri) || 'https://oauth2.googleapis.com/token',
    fcmUrl: String(env.FCM_URL || '').trim().replace(/\/+$/, '') || 'https://fcm.googleapis.com'
  };
}

/** The live site's address for the "Open Orbique" link (APP_URL, else Vercel's production address). */
export function appUrl(env = process.env) {
  const u = String(env.APP_URL || '').trim() || (env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + env.VERCEL_PROJECT_PRODUCTION_URL : '');
  return u.replace(/\/+$/, '');
}

export function waAlertConfig(env = process.env) {
  return {
    template: clean(env.WHATSAPP_ALERT_TEMPLATE, 100) || 'booking_alert',
    lang: clean(env.WHATSAPP_ALERT_LANG, 10) || 'en'
  };
}

/* ---------- what an alert says ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] : '';
}
function nightsBetween(a, b) {
  const n = Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
export function moneyText(v, cur) {
  const n = Number(v);
  if (!Number.isFinite(n) || !n) return '';
  const c = clean(cur, 3).toUpperCase() || 'MYR';
  return (c === 'MYR' ? 'RM' : c + ' ') + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

/**
 * The words of one alert. row {kind, data: {b, old}}; ctx {units: Map(id -> property), types: Map, buildings: Map}.
 * -> {title, lines: [..], text}  (text: the lines joined by new lines, for email and the phone; WhatsApp joins with " · ")
 */
export function describe(row, ctx = {}) {
  if (row.kind === 'test') {
    const title = 'Test alert from Orbique';
    const lines = ['This is how booking alerts will look.', 'New bookings, cancellations and date changes from every booking site arrive like this.'];
    return { title, lines, text: lines.join('\n') };
  }
  const b = isObj(row.data && row.data.b) ? row.data.b : {};
  const old = isObj(row.data && row.data.old) ? row.data.old : {};
  const get = (m, k) => (k && m ? (m instanceof Map ? m.get(k) : m[k]) : undefined);
  const site = clean(b.otaName, 60) || CHANNEL_NAME[b.channel] || 'Direct';
  const title = (row.kind === 'cancelled' ? 'Cancelled' : row.kind === 'changed' ? 'Dates changed' : 'New booking') + ' · ' + site;
  const guest = clean(b.guest && b.guest.name, 80) || 'Guest';
  const n = Number(b.nights) || nightsBetween(b.checkIn, b.checkOut);
  const stay = shortDate(b.checkIn) + ' to ' + shortDate(b.checkOut) + (n ? ' (' + n + (n === 1 ? ' night' : ' nights') + ')' : '');
  const lines = [guest + (Number(b.guests) > 1 ? ', ' + Number(b.guests) + ' guests' : '')];
  if (row.kind === 'changed' && (old.checkIn || old.checkOut)) lines.push('Now ' + stay + ', was ' + shortDate(old.checkIn) + ' to ' + shortDate(old.checkOut));
  else lines.push(stay);
  const unit = get(ctx.units, b.propertyId);
  const type = get(ctx.types, b.unitTypeId) || (unit && get(ctx.types, unit.unitTypeId));
  const building = (unit && get(ctx.buildings, unit.buildingId)) || (type && get(ctx.buildings, type.buildingId));
  const where = [building && clean(building.name, 60), unit ? clean(unit.unitNo || unit.short || unit.name, 60) : 'no unit assigned yet'].filter(Boolean).join(' ');
  lines.push(where + (type && type.name ? ' (' + clean(type.name, 60) + ')' : ''));
  const money = [];
  const cur = b.currency || (building && building.currency);
  if (row.kind !== 'cancelled') {
    const payout = moneyText(b.payout, cur), total = moneyText(b.total, cur);
    if (payout) money.push('Payout ' + payout);
    else if (total) money.push('Total ' + total);
  }
  if (b.reservationCode) money.push('Ref ' + clean(b.reservationCode, 40));
  if (money.length) lines.push(money.join(' · '));
  return { title, lines, text: lines.join('\n') };
}

/** Units, unit types and buildings of a workspace, for describe(). */
export async function placeContext(sb, orgId) {
  const [units, types, buildings] = await Promise.all(['properties', 'unitTypes', 'buildings'].map((c) => records(sb, orgId, c).catch(() => [])));
  const map = (list) => new Map(list.map((x) => [x.id, x]));
  return { units: map(units), types: map(types), buildings: map(buildings) };
}

/* ---------- senders: each resolves "sent" or "skipped: why", or throws (retried) ---------- */

async function fetchJson(fetchFn, url, init, timeoutMs = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, Object.assign({}, init, { signal: ctl.signal }));
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { status: res.status, ok: res.ok, body };
  } finally { clearTimeout(t); }
}

export class AlertError extends Error {
  constructor(message, { permanent = false } = {}) { super(message); this.permanent = permanent; }
}

function emailHtml(msg, appUrl) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d2433">' +
    '<h2 style="font-size:18px;margin:0 0 10px">' + esc(msg.title) + '</h2>' +
    msg.lines.map((l) => '<div>' + esc(l) + '</div>').join('') +
    (appUrl ? '<p style="margin-top:16px"><a href="' + esc(appUrl) + '" style="color:#0B5D54">Open Orbique</a></p>' : '') +
    '<p style="margin-top:16px;font-size:12px;color:#6b7280">You get this because your workspace sends booking alerts to this address. Change it in Orbique under Automations.</p></div>';
}

export async function sendEmail(cfg, to, msg, opts = {}) {
  if (!cfg.configured) return 'skipped: email is not set up (RESEND_API_KEY)';
  if (!to.length) return 'skipped: no email address';
  const fetchFn = opts.fetch || fetch;
  const r = await fetchJson(fetchFn, cfg.baseUrl + '/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: cfg.from, to, subject: msg.title, text: msg.text + (opts.appUrl ? '\n\n' + opts.appUrl : ''), html: emailHtml(msg, opts.appUrl) })
  });
  if (r.ok) return 'sent';
  const why = clean(r.body && (r.body.message || r.body.error), 200) || 'HTTP ' + r.status;
  // 4xx other than rate limits will not get better by retrying (wrong key, address not allowed)
  throw new AlertError('Resend: ' + why, { permanent: r.status >= 400 && r.status < 500 && r.status !== 429 });
}

export async function sendWhatsApp(cfg, waCfg, number, to, msg, opts = {}) {
  if (!cfg.configured) return 'skipped: WhatsApp is not set up';
  if (!number) return 'skipped: no WhatsApp number connected to this workspace';
  if (!to.length) return 'skipped: no WhatsApp number to alert';
  const param = (s) => ({ type: 'text', text: clean(s, 1000) || '-' });
  const failed = [];
  let retry = false;
  for (const phone of to) {
    try {
      await graph(cfg, 'POST', '/' + encodeURIComponent(number) + '/messages', {
        messaging_product: 'whatsapp', to: digits(phone), type: 'template',
        template: { name: waCfg.template, language: { code: waCfg.lang }, components: [{ type: 'body', parameters: [param(msg.title), param(msg.lines.join(' · '))] }] }
      }, { fetch: opts.fetch, timeoutMs: 8000 });
    } catch (e) {
      failed.push(errText(e));
      if (e && e.retryable) retry = true;
    }
  }
  if (!failed.length) return 'sent';
  // a missing template or a number that is not allowed will not get better by retrying
  throw new AlertError('WhatsApp: ' + failed[0], { permanent: !retry });
}

/* Firebase: an access token from the service account (RS256 JWT, OAuth 2.0 JWT bearer grant), cached until near expiry */
let tokenCache = null;
export function serviceJwt(cfg, nowSec = Math.floor(Date.now() / 1000)) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'RS256', typ: 'JWT' });
  const claims = enc({ iss: cfg.clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: cfg.tokenUrl, iat: nowSec, exp: nowSec + 3600 });
  const sig = createSign('RSA-SHA256').update(head + '.' + claims).sign(cfg.privateKey).toString('base64url');
  return head + '.' + claims + '.' + sig;
}
export async function googleAccessToken(cfg, opts = {}) {
  const now = Date.now();
  if (tokenCache && tokenCache.email === cfg.clientEmail && tokenCache.until > now + 60e3) return tokenCache.token;
  const r = await fetchJson(opts.fetch || fetch, cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: serviceJwt(cfg) }).toString()
  });
  if (!r.ok || !r.body || !r.body.access_token) throw new AlertError('Firebase sign-in failed: ' + (clean(r.body && (r.body.error_description || r.body.error), 200) || 'HTTP ' + r.status), { permanent: r.status === 400 || r.status === 401 });
  tokenCache = { email: cfg.clientEmail, token: r.body.access_token, until: now + (Number(r.body.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}
export const resetTokenCache = () => { tokenCache = null; };

export async function sendPush(sb, cfg, orgId, msg, data, opts = {}) {
  if (!cfg.configured) return cfg.invalid ? 'skipped: FIREBASE_SERVICE_ACCOUNT is not a valid service account key' : 'skipped: phone alerts are not set up (FIREBASE_SERVICE_ACCOUNT)';
  const devices = must(await sb.from('push_devices').select('token').eq('org_id', orgId), 'load phones') || [];
  if (!devices.length) return 'skipped: no phone has turned on alerts yet';
  const token = await googleAccessToken(cfg, opts);
  const url = cfg.fcmUrl + '/v1/projects/' + encodeURIComponent(cfg.projectId) + '/messages:send';
  let sent = 0;
  const failed = [];
  for (const d of devices) {
    const r = await fetchJson(opts.fetch || fetch, url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: {
        token: d.token,
        notification: { title: msg.title, body: msg.lines.join('\n') },
        data: Object.fromEntries(Object.entries(data || {}).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, String(v)])),
        android: { priority: 'high', notification: { channel_id: 'bookings', sound: 'default' } }
      } })
    });
    if (r.ok) { sent++; continue; }
    const status = r.body && r.body.error && (r.body.error.status || (r.body.error.details || []).map((x) => x.errorCode).join(','));
    if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(String(status))) {
      // the app was removed or the token replaced: forget this phone
      await sb.from('push_devices').delete().eq('token', d.token);
      continue;
    }
    failed.push(clean(r.body && r.body.error && r.body.error.message, 200) || 'HTTP ' + r.status);
  }
  if (sent || !failed.length) return sent ? 'sent' : 'skipped: no phone has turned on alerts yet';
  throw new AlertError('Firebase: ' + failed[0], { permanent: false });
}

/* ---------- the outbox ---------- */

async function waNumber(sb, orgId) {
  const r = await sb.from('whatsapp_numbers').select('phone_number_id').eq('org_id', orgId).limit(1);
  return !r.error && r.data && r.data[0] ? r.data[0].phone_number_id : null;
}

const finalState = (v) => typeof v === 'string' && (v === 'sent' || v.startsWith('skipped') || v.startsWith('failed'));

/**
 * Send one outbox row on the channels not done yet. -> {done, error, finished}
 * Channel results: "sent", "skipped: why" (nothing to do), "failed: why" (permanent), "error: why" (retried).
 */
export async function sendRow(sb, row, opts = {}) {
  const settings = opts.settings || await alertSettings(sb, row.org_id);
  const done = Object.assign({}, isObj(row.done) ? row.done : {});
  const test = row.kind === 'test';
  const wanted = test || (settings.on && settings.kinds[row.kind] !== false);
  const msg = describe(row, test ? {} : opts.ctx || await placeContext(sb, row.org_id));
  const link = opts.appUrl !== undefined ? opts.appUrl : appUrl();
  const jobs = {
    email: () => sendEmail(opts.emailConfig || emailConfig(), settings.emails, msg, { fetch: opts.fetch, appUrl: link }),
    whatsapp: async () => sendWhatsApp(opts.waConfig || waConfig(), waAlertConfig(), await waNumber(sb, row.org_id), settings.whatsapp, msg, { fetch: opts.fetch }),
    push: () => (settings.push || test ? sendPush(sb, opts.pushConfig || pushConfig(), row.org_id, msg, { bookingId: row.booking_id, kind: row.kind }, { fetch: opts.fetch }) : 'skipped: phone alerts are off')
  };
  let lastError = null;
  for (const ch of CHANNELS) {
    if (finalState(done[ch])) continue;
    if (!wanted) { done[ch] = 'skipped: alerts are off for this'; continue; }
    try {
      done[ch] = await jobs[ch]();
    } catch (e) {
      const why = errText(e);
      done[ch] = (e && e.permanent ? 'failed: ' : 'error: ') + why;
      lastError = ch + ': ' + why;
    }
  }
  return { done, error: lastError, finished: CHANNELS.every((ch) => finalState(done[ch])) };
}

/**
 * Send what is due. opts {budgetMs, limit, now, fetch, ...configs}. -> {sent, retried, dropped}
 * A row is claimed by moving next_at forward first, so two runs (webhook and worker) never send it twice.
 */
export async function processOutbox(sb, opts = {}) {
  const start = Date.now();
  const budget = opts.budgetMs || 8000;
  const out = { sent: 0, retried: 0, dropped: 0 };
  const now = opts.now || Date.now();
  const due = must(await sb.from('alert_outbox').select('id, org_id, key, kind, booking_id, data, done, attempts, created_at, next_at')
    .is('finished_at', null).lte('next_at', new Date(now).toISOString()).order('id').limit(opts.limit || 20), 'load alerts') || [];
  const ctxCache = new Map();
  for (const row of due) {
    if (Date.now() - start > budget) break;
    const iso = new Date().toISOString();
    if (Date.parse(row.created_at) < now - MAX_AGE_MS && row.kind !== 'test') {
      await sb.from('alert_outbox').update({ finished_at: iso, last_error: 'dropped: older than 2 days' }).eq('id', row.id);
      out.dropped++;
      continue;
    }
    const wait = BACKOFF_MS[Math.min(row.attempts, BACKOFF_MS.length - 1)];
    const claim = await sb.from('alert_outbox').update({ attempts: row.attempts + 1, next_at: new Date(Date.now() + wait).toISOString() })
      .eq('id', row.id).eq('next_at', row.next_at).is('finished_at', null).select('id');
    if (claim.error || !claim.data || !claim.data.length) continue;      // someone else took it
    if (!ctxCache.has(row.org_id)) ctxCache.set(row.org_id, row.kind === 'test' ? {} : await placeContext(sb, row.org_id));
    let r;
    try {
      r = await sendRow(sb, row, Object.assign({}, opts, { ctx: ctxCache.get(row.org_id) }));
    } catch (e) {
      r = { done: row.done || {}, error: errText(e), finished: false };
    }
    const giveUp = !r.finished && row.attempts + 1 >= MAX_ATTEMPTS;
    const patch = { done: r.done, last_error: r.error };
    if (r.finished || giveUp) patch.finished_at = new Date().toISOString();
    must(await sb.from('alert_outbox').update(patch).eq('id', row.id), 'save alert');
    if (r.error) console.error('[alerts]', row.key, r.error);
    if (r.finished) out.sent++; else out.retried++;
  }
  return out;
}

/** A test alert from the Automations page: queued, then sent straight away. -> the row's channel results */
export async function queueTest(sb, orgId, by, opts = {}) {
  const key = 'test:' + orgId + ':' + Date.now();
  const ins = must(await sb.from('alert_outbox').insert({ org_id: orgId, key, kind: 'test', data: { by: by || null } }).select('id, org_id, key, kind, booking_id, data, done, attempts, created_at, next_at').single(), 'queue test alert');
  must(await sb.from('alert_outbox').update({ attempts: 1, next_at: new Date(Date.now() + BACKOFF_MS[0]).toISOString() }).eq('id', ins.id), 'claim test alert');
  const r = await sendRow(sb, ins, opts);
  must(await sb.from('alert_outbox').update({ done: r.done, last_error: r.error, finished_at: new Date().toISOString() }).eq('id', ins.id), 'save test alert');
  return r.done;
}

/** Which channels can send, for the settings card. Never includes a key. */
export async function channelStatus(sb, orgId, userId) {
  const [devices, number, last] = await Promise.all([
    sb.from('push_devices').select('token, user_id, platform, updated_at').eq('org_id', orgId),
    waNumber(sb, orgId),
    sb.from('alert_outbox').select('kind, done, created_at, finished_at, last_error').eq('org_id', orgId).order('id', { ascending: false }).limit(5)
  ]);
  const list = devices.error ? [] : devices.data || [];
  const p = pushConfig();
  return {
    email: emailConfig().configured,
    emailFrom: emailConfig().from,
    whatsapp: waConfig().configured && !!number,
    whatsappConfigured: waConfig().configured,
    whatsappNumber: !!number,
    whatsappTemplate: waAlertConfig().template,
    push: p.configured,
    pushInvalid: p.invalid,
    phones: list.length,
    myPhones: list.filter((d) => d.user_id === userId).length,
    recent: last.error ? [] : (last.data || []).map((r) => ({ kind: r.kind, done: r.done, at: r.created_at, finished: !!r.finished_at }))
  };
}
