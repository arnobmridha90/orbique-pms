/* WhatsApp Business Platform (Meta's Cloud API) for the api/ functions (server only; the token never reaches the browser).
 * Private module: Vercel does not expose files under api/_lib as endpoints.
 *
 *   waConfig()                                 the WHATSAPP_* settings (see docs/DEPLOY.md); configured only with all three
 *   verifyChallenge(query, cfg)                Meta's webhook check (GET): the challenge to echo, or null
 *   verifyWaSignature(appSecret, raw, header)  X-Hub-Signature-256: "sha256=" + HMAC-SHA256 of the exact body
 *   parseWebhook(body)                         {messages: [...], statuses: [...]} from one webhook delivery
 *   graph(cfg, method, path, body, opts)       one Graph API call; resolves the JSON or throws WhatsAppError
 *   sendText(cfg, phoneNumberId, to, text)     -> the WhatsApp message id
 *   fetchMedia(cfg, mediaId, maxBytes)         -> {mime, bytes}
 *   phoneNumberInfo(cfg, phoneNumberId)        -> {display_phone_number, verified_name}
 *
 * Nothing here logs or returns the token, and error messages never include it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const GRAPH_URL = 'https://graph.facebook.com';
export const DEFAULT_VERSION = 'v23.0';
/** Replies are free-form only within 24 hours of the guest's last message; after that WhatsApp needs an approved template. */
export const WINDOW_MS = 24 * 3600 * 1000;

export function waConfig() {
  const env = process.env;
  const cfg = {
    token: String(env.WHATSAPP_TOKEN || '').trim(),
    appSecret: String(env.WHATSAPP_APP_SECRET || '').trim(),
    verifyToken: String(env.WHATSAPP_VERIFY_TOKEN || '').trim(),
    version: /^v\d+\.\d+$/.test(String(env.WHATSAPP_GRAPH_VERSION || '').trim()) ? String(env.WHATSAPP_GRAPH_VERSION).trim() : DEFAULT_VERSION,
    baseUrl: String(env.WHATSAPP_GRAPH_URL || '').trim().replace(/\/+$/, '') || GRAPH_URL
  };
  cfg.configured = !!(cfg.token && cfg.appSecret && cfg.verifyToken);
  return cfg;
}

const safeEq = (a, b) => {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

/** GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=... -> the challenge, or null. */
export function verifyChallenge(query, cfg) {
  const q = query || {};
  const mode = q['hub.mode'];
  const token = q['hub.verify_token'];
  const challenge = q['hub.challenge'];
  if (!cfg.verifyToken || mode !== 'subscribe' || typeof challenge !== 'string' || !/^[\w.-]{1,200}$/.test(challenge)) return null;
  return safeEq(token, cfg.verifyToken) ? challenge : null;
}

/** True when header is "sha256=<hex>" of HMAC-SHA256(appSecret, raw). */
export function verifyWaSignature(appSecret, raw, header) {
  if (!appSecret || !raw) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header || '').trim());
  if (!m) return false;
  const want = createHmac('sha256', appSecret).update(raw).digest('hex');
  return safeEq(m[1].toLowerCase(), want);
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v, max = 4096) => (typeof v === 'string' ? v.slice(0, max) : v === undefined || v === null ? '' : String(v).slice(0, max));

const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker'];

/** One incoming WhatsApp message as the inbox stores it: {type, text, media?} (type is the app's: text, image, voice, file). */
export function messageContent(m) {
  const t = m.type;
  if (t === 'text') return { type: 'text', text: str(m.text && m.text.body) };
  if (MEDIA_TYPES.includes(t) && isObj(m[t])) {
    const x = m[t];
    const media = { id: str(x.id, 100), mime: str(x.mime_type, 100) };
    if (x.filename) media.name = str(x.filename, 120);
    const caption = str(x.caption, 1024);
    if (t === 'image' || t === 'sticker') return { type: 'image', text: caption || (t === 'sticker' ? 'Sticker' : 'Photo'), caption, media };
    if (t === 'audio') return { type: 'voice', text: 'Voice message', media };
    if (t === 'video') return { type: 'file', text: caption || 'Video', caption, name: media.name || 'video.mp4', media };
    return { type: 'file', text: media.name || caption || 'Document', caption, name: media.name || 'document', media };
  }
  if (t === 'location' && isObj(m.location)) {
    const l = m.location;
    const where = [l.name, l.address].filter(Boolean).map((s) => str(s, 200)).join(', ');
    return { type: 'text', text: 'Location: ' + (where ? where + ' ' : '') + `https://maps.google.com/?q=${Number(l.latitude)},${Number(l.longitude)}` };
  }
  if (t === 'button' && isObj(m.button)) return { type: 'text', text: str(m.button.text) };
  if (t === 'interactive' && isObj(m.interactive)) {
    const r = m.interactive.button_reply || m.interactive.list_reply || {};
    return { type: 'text', text: str(r.title || r.id) };
  }
  if (t === 'reaction' && isObj(m.reaction)) return { type: 'text', text: 'Reacted ' + str(m.reaction.emoji, 16), reaction: true };
  if (t === 'contacts') return { type: 'text', text: 'Shared a contact card' };
  return { type: 'text', text: 'A message WhatsApp could not show here (' + str(t, 30) + ')' };
}

/**
 * One webhook delivery -> {messages: [{phoneNumberId, from, name, id, at (ms), content, contextId}],
 *                          statuses: [{phoneNumberId, id, status, at, recipient, error}]}
 * Anything that is not a WhatsApp messages change is ignored.
 */
export function parseWebhook(body) {
  const out = { messages: [], statuses: [] };
  if (!isObj(body) || body.object !== 'whatsapp_business_account') return out;
  for (const entry of arr(body.entry)) {
    for (const ch of arr(entry && entry.changes)) {
      if (!ch || ch.field !== 'messages' || !isObj(ch.value)) continue;
      const v = ch.value;
      const pnid = str(v.metadata && v.metadata.phone_number_id, 40);
      if (!pnid) continue;
      const names = new Map(arr(v.contacts).filter(isObj).map((c) => [str(c.wa_id, 30), str(c.profile && c.profile.name, 80)]));
      for (const m of arr(v.messages)) {
        if (!isObj(m) || !m.id || !m.from) continue;
        const from = str(m.from, 30).replace(/\D/g, '');
        out.messages.push({
          phoneNumberId: pnid, from, name: names.get(from) || names.get(str(m.from, 30)) || '', id: str(m.id, 200),
          at: Number(m.timestamp) > 0 ? Number(m.timestamp) * 1000 : Date.now(), content: messageContent(m),
          contextId: m.context && m.context.id ? str(m.context.id, 200) : null
        });
      }
      for (const s of arr(v.statuses)) {
        if (!isObj(s) || !s.id || !s.status) continue;
        const e = arr(s.errors)[0];
        out.statuses.push({
          phoneNumberId: pnid, id: str(s.id, 200), status: str(s.status, 20), recipient: str(s.recipient_id, 30).replace(/\D/g, ''),
          at: Number(s.timestamp) > 0 ? Number(s.timestamp) * 1000 : Date.now(),
          error: e ? explain(Number(e.code) || 0, str(e.title || e.message || (e.error_data && e.error_data.details) || 'WhatsApp could not deliver it', 300)) : null
        });
      }
    }
  }
  return out;
}

/** A failed Graph API call. code: Meta's error code (131047 = outside the 24-hour window), status: HTTP status. */
export class WhatsAppError extends Error {
  constructor(message, { status = 0, code = 0, retryable = false } = {}) {
    super(message);
    this.name = 'WhatsAppError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function scrub(text, token) {
  const s = String(text || '');
  return token && token.length >= 8 ? s.split(token).join('[token]') : s;
}

/** Plain English for the errors people will meet. */
export function explain(code, fallback) {
  if (code === 131047) return 'The guest last wrote more than 24 hours ago. WhatsApp only lets a business start a conversation with an approved template, so ask them to message you first, or reply through the booking site.';
  if (code === 131026) return 'This number cannot receive WhatsApp messages (it may not be on WhatsApp).';
  if (code === 131030) return 'This number is not on the allowed list of the WhatsApp test number. Add it in Meta, or use your real business number.';
  if (code === 190) return 'The WhatsApp access token has expired or is wrong. Update WHATSAPP_TOKEN in Vercel.';
  if (code === 131056) return 'Too many messages to this guest in a short time. Wait a minute and try again.';
  if (code === 133010) return 'The WhatsApp number is not registered with the Cloud API yet. Finish its setup in Meta.';
  return fallback;
}

/**
 * One Graph API call: method, path ('/<phone number id>/messages'), JSON body.
 *   opts {timeoutMs = 10000, fetch, raw (resolve the Response itself)}
 */
export async function graph(cfg, method, path, body, opts = {}) {
  if (!cfg.token) throw new WhatsAppError('WhatsApp is not set up on the server yet (WHATSAPP_TOKEN is missing).', { code: -1 });
  const doFetch = opts.fetch || globalThis.fetch;
  const url = /^https:\/\//.test(path) ? path : cfg.baseUrl + '/' + cfg.version + path;
  const headers = { Authorization: 'Bearer ' + cfg.token };
  const init = { method, headers };
  if (body !== undefined && body !== null) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs || 10000);
  init.signal = ctl.signal;
  let res;
  try {
    res = await doFetch(url, init);
    if (opts.raw && res.ok) return res;
    const textBody = await res.text();
    let j = null;
    try { j = textBody ? JSON.parse(textBody) : null; } catch (e) { j = null; }
    if (res.ok) return j || {};
    const err = (j && j.error) || {};
    const code = Number(err.code) || 0;
    const sub = Number(err.error_subcode) || 0;
    const msg = scrub(err.error_user_msg || err.message || `WhatsApp answered ${res.status}.`, cfg.token);
    console.error(`[whatsapp] ${method} ${path.split('?')[0]}: ${res.status} ${code}${sub ? '/' + sub : ''} ${msg}`);
    throw new WhatsAppError(explain(code, 'WhatsApp refused it: ' + msg), { status: res.status, code, retryable: res.status >= 500 || res.status === 429 });
  } catch (e) {
    if (e instanceof WhatsAppError) throw e;
    const timedOut = ctl.signal.aborted;
    console.error(`[whatsapp] ${method} ${path.split('?')[0]}:`, timedOut ? 'timeout' : scrub(e && e.message, cfg.token));
    throw new WhatsAppError(timedOut ? 'WhatsApp did not answer in time. Please try again.' : 'Could not reach WhatsApp. Please try again.', { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

/** Send a text message; resolves the WhatsApp message id ("wamid..."). */
export async function sendText(cfg, phoneNumberId, to, text, opts = {}) {
  const body = { messaging_product: 'whatsapp', recipient_type: 'individual', to: String(to).replace(/\D/g, ''), type: 'text', text: { body: String(text), preview_url: /https?:\/\//.test(String(text)) } };
  if (opts.replyTo) body.context = { message_id: opts.replyTo };
  const j = await graph(cfg, 'POST', '/' + encodeURIComponent(phoneNumberId) + '/messages', body, opts);
  const id = j && Array.isArray(j.messages) && j.messages[0] && j.messages[0].id;
  if (!id) throw new WhatsAppError('WhatsApp did not confirm the message.', { retryable: true });
  return String(id);
}

/** Tell WhatsApp the guest's message was read (blue ticks on their phone). Never throws. */
export async function markRead(cfg, phoneNumberId, messageId, opts = {}) {
  try {
    await graph(cfg, 'POST', '/' + encodeURIComponent(phoneNumberId) + '/messages', { messaging_product: 'whatsapp', status: 'read', message_id: messageId }, Object.assign({ timeoutMs: 4000 }, opts));
    return true;
  } catch (e) {
    return false;
  }
}

/** A file the guest sent: {mime, bytes}. Refuses files larger than maxBytes. */
export async function fetchMedia(cfg, mediaId, maxBytes, opts = {}) {
  const info = await graph(cfg, 'GET', '/' + encodeURIComponent(mediaId), null, opts);
  if (!info || typeof info.url !== 'string' || !/^https:\/\//.test(info.url)) throw new WhatsAppError('WhatsApp no longer has this file (files are kept for 30 days).', { code: 404 });
  if (Number(info.file_size) > maxBytes) throw new WhatsAppError('This file is too large to open here. Ask the guest to send it by email.', { code: 413 });
  const res = await graph(cfg, 'GET', info.url, null, Object.assign({}, opts, { raw: true }));
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > maxBytes) throw new WhatsAppError('This file is too large to open here. Ask the guest to send it by email.', { code: 413 });
  return { mime: String(info.mime_type || res.headers.get('content-type') || 'application/octet-stream'), bytes };
}

/** The number's public details, which also proves the token can use it. */
export async function phoneNumberInfo(cfg, phoneNumberId, opts = {}) {
  return graph(cfg, 'GET', '/' + encodeURIComponent(phoneNumberId) + '?fields=display_phone_number,verified_name', null, opts);
}
