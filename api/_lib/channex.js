/* Channex.io client for the api/ functions (server only; the API key never reaches the browser).
 * Private module: Vercel does not expose files under api/_lib as endpoints.
 *
 *   channexConfig()                               the CHANNEX_* settings (see docs/DEPLOY.md)
 *   channexRequest(method, path, body, opts)      one call; resolves {status, data, meta, errors} or throws ChannexError
 *   verifySignature(secret, raw, ts, sigs, opts)  checks a signed webhook (HMAC-SHA256 over `${ts}.${raw}`)
 *   logCall(sb, row)                              the call log (channex_calls); a stub until the table exists
 *
 * Errors are sorted into three kinds the worker acts on:
 *   rate_limited  429: pause the property and back off
 *   retryable     5xx, network failure, timeout: pause a minute and try again, keep the changes
 *   invalid       any other 4xx (or no key configured): needs a person; retrying will not help
 * Nothing here logs or returns the API key, and error messages never include it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const STAGING_URL = 'https://staging.channex.io/api/v1';
export const PRODUCTION_URL = 'https://app.channex.io/api/v1';

const trimUrl = (v) => String(v || '').trim().replace(/\/+$/, '');
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

export function channexConfig() {
  const env = process.env;
  const baseUrl = trimUrl(env.CHANNEX_BASE_URL) || STAGING_URL;
  return {
    key: String(env.CHANNEX_API_KEY || '').trim(),
    baseUrl,
    // The channel screen (iframe) lives on the same host as the API, without /api/v1
    appUrl: trimUrl(env.CHANNEX_APP_URL) || baseUrl.replace(/\/api\/v1$/i, ''),
    // Mapping rows carry this so staging and production ids never mix
    env: /^https:\/\/app\.channex\.io(\/|$)/i.test(baseUrl) ? 'production' : 'staging',
    webhookSecret: String(env.CHANNEX_WEBHOOK_SECRET || '').trim(),
    webhookToken: String(env.CHANNEX_WEBHOOK_TOKEN || '').trim(),
    workerSecret: String(env.CHANNEX_WORKER_SECRET || '').trim(),
    orgAllowlist: list(env.CHANNEX_ORG_ALLOWLIST).map((s) => s.toLowerCase())
  };
}

/** True when an API key is set (what /api/health reports; never the value). */
export const channexConfigured = () => !!channexConfig().key;

/** A failed Channex call. kind: 'rate_limited' | 'retryable' | 'invalid'. */
export class ChannexError extends Error {
  constructor(kind, message, { status = 0, code = '', errors = null, meta = null, method = '', path = '' } = {}) {
    super(message);
    this.name = 'ChannexError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.errors = errors;
    this.meta = meta;
    this.method = method;
    this.path = path;
  }
  get retryable() { return this.kind !== 'invalid'; }
}

/** The error kind for an HTTP status (0 = no answer: network failure or timeout). */
export function errorKind(status) {
  if (status === 429) return 'rate_limited';
  if (!status || status >= 500) return 'retryable';
  return 'invalid';
}

/** "/rate_plans" + {'filter[property_id]': id} -> "/rate_plans?filter%5Bproperty_id%5D=..." */
function withQuery(path, query) {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) qs.append(k, String(v));
  const s = qs.toString();
  return s ? path + (path.includes('?') ? '&' : '?') + s : path;
}

/** Remove the key from any text that might be logged or shown. */
function scrub(textValue, key) {
  const s = String(textValue || '');
  return key && key.length >= 4 ? s.split(key).join('[key]') : s;
}

/**
 * One Channex API call.
 *   method  'GET' | 'POST' | 'PUT' | 'DELETE'
 *   path    '/availability', '/booking_revisions/<id>/ack' ... (relative to CHANNEX_BASE_URL)
 *   body    an object sent as JSON, or null
 *   opts    {timeoutMs = 10000, query, config (channexConfig() override), fetch (for tests)}
 * Resolves {status, data, meta, errors} for 2xx; throws ChannexError otherwise.
 */
export async function channexRequest(method, path, body, opts = {}) {
  const cfg = opts.config || channexConfig();
  const timeoutMs = opts.timeoutMs || 10000;
  const doFetch = opts.fetch || globalThis.fetch;
  method = String(method || 'GET').toUpperCase();
  const rel = withQuery(String(path || '/'), opts.query);
  const where = { method, path: rel.split('?')[0] };
  if (!cfg.key) throw new ChannexError('invalid', 'The channel manager is not set up on the server (CHANNEX_API_KEY is missing).', Object.assign({ code: 'not_configured' }, where));
  if (!rel.startsWith('/') || rel.startsWith('//')) throw new ChannexError('invalid', 'Bad Channex path.', Object.assign({ code: 'bad_path' }, where));

  const headers = { 'user-api-key': cfg.key, Accept: 'application/json' };
  const init = { method, headers };
  if (body !== undefined && body !== null && method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  init.signal = ctl.signal;

  let res;
  let raw = '';
  try {
    res = await doFetch(cfg.baseUrl + rel, init);
    raw = await res.text();
  } catch (e) {
    const timedOut = ctl.signal.aborted;
    const msg = timedOut ? `Channex did not answer within ${Math.round(timeoutMs / 100) / 10} s.` : 'Could not reach Channex: ' + scrub(e && e.cause && e.cause.code ? e.cause.code : e && e.message, cfg.key);
    console.error(`[channex] ${method} ${where.path}:`, timedOut ? 'timeout' : msg);
    throw new ChannexError('retryable', msg, Object.assign({ code: timedOut ? 'timeout' : 'network' }, where));
  } finally {
    clearTimeout(timer);
  }

  let json = null;
  if (raw) { try { json = JSON.parse(raw); } catch (e) { json = null; } }
  const out = { status: res.status, data: json ? json.data : undefined, meta: json ? json.meta : undefined, errors: json ? json.errors : undefined };
  if (res.status >= 200 && res.status < 300) return out;

  const kind = errorKind(res.status);
  const e = out.errors && typeof out.errors === 'object' ? out.errors : {};
  const code = String(e.code || (kind === 'rate_limited' ? 'http_too_many_requests' : 'http_' + res.status));
  let msg = e.title || (kind === 'rate_limited' ? 'Too Many Requests' : `Channex answered ${res.status}`);
  if (e.details && typeof e.details === 'object') {
    const parts = Object.entries(e.details).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(', ') : v}`);
    if (parts.length) msg += ': ' + parts.join('; ');
  }
  msg = scrub(msg, cfg.key).slice(0, 500);
  console.error(`[channex] ${method} ${where.path}: ${res.status} ${code}`);
  throw new ChannexError(kind, msg, Object.assign({ status: res.status, code, errors: out.errors || null, meta: out.meta || null }, where));
}

/** Task ids from an ARI answer ({data: [{id, type: 'task'}]}); certification asks for these. */
export function taskIds(result) {
  const d = result && result.data;
  return (Array.isArray(d) ? d : d ? [d] : []).filter((x) => x && x.id && (!x.type || x.type === 'task')).map((x) => x.id);
}

/** Warnings from an ARI answer: Channex drops invalid items but still answers 200. */
export const warnings = (result) => (result && result.meta && Array.isArray(result.meta.warnings) ? result.meta.warnings : []);

/* ---------- webhook signatures ---------- */

export const SIGNATURE_WINDOW_S = 300;

/** Lower-case hex HMAC-SHA256(secret, `${timestamp}.${raw}`), the way Channex signs webhooks. */
export function signature(secret, timestamp, raw) {
  const h = createHmac('sha256', String(secret));
  h.update(`${timestamp}.`);
  h.update(Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8'));
  return h.digest('hex');
}

/**
 * True when one of the signatures (comma separated, as during key rotation) matches the raw body and
 * the timestamp (unix seconds) is within 300 s of now. Constant-time; raw must be the exact bytes received.
 *   opts {now: ms since epoch, windowS}
 */
export function verifySignature(secret, raw, timestamp, signatures, opts = {}) {
  if (!secret || raw === undefined || raw === null) return false;
  const ts = String(timestamp || '').trim();
  if (!/^\d{1,12}$/.test(ts)) return false;
  const now = opts.now !== undefined ? opts.now : Date.now();
  const windowS = opts.windowS !== undefined ? opts.windowS : SIGNATURE_WINDOW_S;
  if (Math.abs(now / 1000 - Number(ts)) > windowS) return false;
  const expected = Buffer.from(signature(secret, ts, raw), 'hex');
  let match = false;
  for (const part of String(signatures || '').split(',')) {
    const sig = part.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sig)) continue;
    const got = Buffer.from(sig, 'hex');
    if (got.length === expected.length && timingSafeEqual(got, expected)) match = true; // keep checking: same time either way
  }
  return match;
}

/** Constant-time string comparison for shared secrets (webhook token header, worker bearer). */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (!x.length || !y.length) return false;
  const len = Math.max(x.length, y.length);
  const xa = Buffer.alloc(len); x.copy(xa);
  const ya = Buffer.alloc(len); y.copy(ya);
  return timingSafeEqual(xa, ya) && x.length === y.length;
}

/* ---------- call log ---------- */

const SOURCES = ['delta', 'full', 'setup', 'booking', 'ack', 'feed', 'iframe', 'channels'];

/** The channex_calls row for one call. Payloads are kept as sent; the key is never part of a row. */
export function callRow(row) {
  const r = row || {};
  return {
    org_id: r.orgId || null,
    channex_property_id: r.propertyId || null,
    endpoint: String(r.endpoint || '').slice(0, 200),
    method: String(r.method || '').toUpperCase().slice(0, 10),
    source: SOURCES.includes(r.source) ? r.source : null,
    item_count: Number.isInteger(r.itemCount) ? r.itemCount : null,
    payload: r.payload === undefined ? null : r.payload,
    http_status: Number.isInteger(r.status) ? r.status : null,
    task_ids: r.taskIds && r.taskIds.length ? r.taskIds : null,
    warnings: r.warnings && r.warnings.length ? r.warnings : null,
    error: r.error ? String(r.error).slice(0, 1000) : null,
    duration_ms: Number.isFinite(r.durationMs) ? Math.round(r.durationMs) : null,
    by_user: r.byUser || null
  };
}

/** Record a call in channex_calls. Stub until the table exists (migration 0006): it only shapes the row. */
export async function logCall(sb, row) {
  return callRow(row);
}
