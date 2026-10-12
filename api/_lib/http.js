/* Small HTTP helpers shared by the api/ functions.
 * Files and folders whose names start with "_" inside api/ are not turned into endpoints by Vercel,
 * so this module is private to the functions that import it.
 *
 * Everything here works with a plain Node http.ServerResponse (scripts/dev.mjs) and with Vercel's
 * response object: we only use res.statusCode, res.setHeader and res.end.
 */

/** An error whose message is safe to show to the person on screen. */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const bad = (code, message) => new ApiError(400, code, message);
export const unauthorized = (message) => new ApiError(401, 'not-signed-in', message || 'Please sign in again.');
export const forbidden = (message) => new ApiError(403, 'not-allowed', message || 'You are not allowed to do that.');
export const conflict = (code, message) => new ApiError(409, code, message);
export const tooMany = (message) => new ApiError(429, 'too-many', message || 'Too many requests. Please wait a few minutes and try again.');

export function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(body);
}

/* The phone app (docs/MOBILE.md) runs from its own local address and calls these functions across origins:
 * Android https://localhost, iOS capacitor://localhost. Sign-in travels as a bearer token, never a cookie,
 * so answering these origins gives them nothing a bearer token would not already give. */
const APP_ORIGINS = new Set(['https://localhost', 'capacitor://localhost']);

/** Cross-origin headers for the phone app. Returns true when it answered a preflight (OPTIONS) request. */
export function cors(req, res) {
  const origin = req.headers && req.headers.origin;
  if (origin && APP_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  res.setHeader('Vary', 'Origin');
  if (req.method !== 'OPTIONS') return false;
  res.statusCode = 204;
  res.end();
  return true;
}

export const ok = (res, data) => send(res, 200, Object.assign({ ok: true }, data || {}));

/** Answer with a plain-English error. Unknown errors are logged (message only) and shown generically. */
export function fail(res, err) {
  if (err instanceof ApiError) return send(res, err.status, { ok: false, error: err.code, message: err.message });
  console.error('[api] unexpected error:', err && err.message ? err.message : String(err));
  return send(res, 500, { ok: false, error: 'server', message: 'Something went wrong on our side. Please try again in a minute.' });
}

const MAX_BODY = 64 * 1024;

/** The JSON body as an object. Handles Vercel's parsed req.body, a string or Buffer body, or the raw stream. */
export async function readJson(req) {
  let body;
  try {
    body = req.body; // Vercel's getter throws on invalid JSON
  } catch (e) {
    throw bad('bad-json', 'The request could not be read. Please try again.');
  }
  if (body === undefined || body === null) {
    if (typeof req.on !== 'function' || req.readableEnded) return {};
    body = await new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(bad('too-large', 'The request is too large.')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (body.length > MAX_BODY) throw bad('too-large', 'The request is too large.');
    if (!body.trim()) return {};
    try { body = JSON.parse(body); } catch (e) { throw bad('bad-json', 'The request could not be read. Please try again.'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('bad-json', 'The request could not be read. Please try again.');
  return body;
}

/** The bearer token from the Authorization header, or ''. */
export function bearer(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(h));
  return m && m[1].length < 8192 ? m[1] : '';
}

/* ---------- input validation (trim, cap, plain-English errors) ---------- */

/** A text field: trimmed, control characters removed, at most `max` characters. */
export function text(value, label, { max = 120, required = false, multiline = false } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value === 'number') value = String(value);
  if (typeof value !== 'string') throw bad('bad-input', `${label} is not valid.`);
  let v = multiline ? value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '') : value.replace(/[\u0000-\u001F\u007F]/g, ' ');
  v = multiline ? v.trim() : v.replace(/\s+/g, ' ').trim();
  if (required && !v) throw bad('missing', `Please enter ${label.toLowerCase()}.`);
  if (v.length > max) throw bad('too-long', `${label} is too long (at most ${max} characters).`);
  return v;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** An email address, lower-cased. */
export function email(value, label = 'Email address') {
  const v = text(value, label, { max: 254, required: true }).toLowerCase();
  if (!EMAIL_RE.test(v) || v.split('@')[0].length > 64) throw bad('bad-email', `${label} doesn't look right. Please check it.`);
  return v;
}

export function phone(value, label = 'Phone number') {
  const v = text(value, label, { max: 40 });
  if (v && !/^[0-9+()\-.\s/]{6,40}$/.test(v)) throw bad('bad-phone', `${label} doesn't look right. Use digits, spaces, + and -.`);
  return v;
}

/** An id the app generated (staff ids like "s3" or "S-LX4K2Q9A", uuids). */
export function id(value, label) {
  const v = text(value, label, { max: 64, required: true });
  if (!/^[A-Za-z0-9_.:-]+$/.test(v)) throw bad('bad-id', `${label} is not valid.`);
  return v;
}

export function uuid(value, label = 'Workspace') {
  const v = text(value, label, { max: 36, required: true }).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)) throw bad('bad-id', `${label} is not valid.`);
  return v;
}

export function password(value) {
  if (typeof value !== 'string' || !value) throw bad('missing', 'Please choose a password.');
  if (value.length < 8) throw bad('weak-password', 'The password needs at least 8 characters.');
  if (value.length > 72) throw bad('too-long', 'The password is too long (at most 72 characters).');
  if (/^\s|\s$/.test(value)) throw bad('bad-password', 'The password cannot start or end with a space.');
  return value;
}
