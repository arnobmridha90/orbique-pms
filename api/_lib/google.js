/* Google Business Profile (server only): sign-in with Google, then the profile's reviews and replies.
 * Private module: Vercel does not expose files under api/_lib as endpoints.
 *
 *   googleConfig(env)                       {configured, clientId, clientSecret, redirectUri}: set in Vercel, never sent out
 *   authUrl(cfg, state)                     the Google sign-in address (scope business.manage, offline, consent)
 *   signState(cfg, s) / readState(cfg, t)   the signed `state` that carries {orgId, userId} through Google and back
 *   exchangeCode(cfg, code, g)              code -> {accessToken, refreshToken, expiresAt, email}
 *   refreshAccess(cfg, refreshToken, g)     -> {accessToken, expiresAt}
 *   listLocations(token, g)                 every location of every account the signed-in Google user manages
 *   listReviews(token, location, opts, g)   one page of a location's reviews, newest change first
 *   putReply(token, reviewName, text, g)    post or replace the public reply
 *
 * Google gives the Business Profile API only to approved Cloud projects: until the access request is approved the
 * project's quota is 0 and every call answers 429 (or 403). That comes back as a GoogleError with `notApproved`, which
 * the app explains instead of a raw error. g = {fetch} so tests can stand in for Google.
 */
import crypto from 'node:crypto';
import { appUrl } from './alerts.js';

export const SCOPE = 'https://www.googleapis.com/auth/business.manage';
export const STATE_LIFE_MS = 10 * 60 * 1000;
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const ACCOUNTS = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const V4 = 'https://mybusiness.googleapis.com/v4';

export class GoogleError extends Error {
  constructor(status, message, opts = {}) {
    super(message);
    this.status = status;
    this.reason = opts.reason || '';
    this.retryable = status >= 500 || status === 0;
    this.notApproved = !!opts.notApproved;
    this.revoked = !!opts.revoked;
  }
}

const clean = (v, n = 400) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);

export function googleConfig(env = process.env) {
  const clientId = clean(env.GOOGLE_CLIENT_ID);
  const clientSecret = clean(env.GOOGLE_CLIENT_SECRET);
  const base = appUrl(env);
  const redirectUri = clean(env.GOOGLE_REDIRECT_URI) || (base ? base + '/api/messages' : '');
  return { configured: !!(clientId && clientSecret && /^https?:\/\//.test(redirectUri)), clientId, clientSecret, redirectUri, appUrl: base };
}

/* ---------- the signed state ---------- */

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const mac = (cfg, body) => b64u(crypto.createHmac('sha256', 'orbique-google-state:' + cfg.clientSecret).update(body).digest());

/** s {orgId, userId}, now -> "body.mac" (valid for 10 minutes). */
export function signState(cfg, s, now = Date.now()) {
  const body = b64u(JSON.stringify({ o: s.orgId, u: s.userId, x: now + STATE_LIFE_MS, n: b64u(crypto.randomBytes(9)) }));
  return body + '.' + mac(cfg, body);
}

/** -> {orgId, userId} or null (bad signature, expired, malformed). */
export function readState(cfg, token, now = Date.now()) {
  const t = String(token || '');
  const dot = t.indexOf('.');
  if (!cfg.clientSecret || dot < 1 || t.length > 1000) return null;
  const body = t.slice(0, dot), sig = t.slice(dot + 1);
  const want = mac(cfg, body);
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let s;
  try { s = JSON.parse(unb64u(body).toString('utf8')); } catch (e) { return null; }
  if (!s || typeof s !== 'object' || typeof s.o !== 'string' || typeof s.u !== 'string' || !(Number(s.x) > now)) return null;
  return { orgId: s.o, userId: s.u };
}

export function authUrl(cfg, state) {
  const q = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: SCOPE + ' openid email',
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state
  });
  return AUTH + '?' + q.toString();
}

/* ---------- calls ---------- */

async function call(g, url, init, what) {
  const f = (g && g.fetch) || fetch;
  let res;
  try { res = await f(url, init); } catch (e) { throw new GoogleError(0, 'Google did not answer (' + what + ').'); }
  const raw = await res.text();
  let j = null;
  try { j = raw ? JSON.parse(raw) : null; } catch (e) { j = null; }
  if (res.ok) return j || {};
  const err = j && j.error;
  const msg = clean((err && (err.message || err.error_description)) || (j && j.error_description) || (typeof err === 'string' ? err : '') || res.statusText || 'error', 300);
  const reason = clean(err && Array.isArray(err.details) ? (err.details.find((d) => d && d.reason) || {}).reason : (typeof err === 'string' ? err : ''), 80);
  const status = res.status;
  // An unapproved project has 0 requests a minute (429 RESOURCE_EXHAUSTED) or the API refused for the project (403 SERVICE_DISABLED / PERMISSION_DENIED on a disabled API)
  const notApproved = status === 429 || (status === 403 && /SERVICE_DISABLED|API_DISABLED|has not been used|is disabled|quota/i.test(msg + ' ' + reason));
  const revoked = (status === 400 && /invalid_grant/.test(raw)) || status === 401;
  throw new GoogleError(status, msg, { reason, notApproved, revoked });
}

const bearer = (token) => ({ Authorization: 'Bearer ' + token });

function form(body) { return { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() }; }

/** The email in Google's id_token (read only, it came straight from Google over TLS). */
function emailOf(idToken) {
  try { const p = JSON.parse(unb64u(String(idToken).split('.')[1]).toString('utf8')); return clean(p.email, 200) || null; } catch (e) { return null; }
}

export async function exchangeCode(cfg, code, g) {
  const j = await call(g, TOKEN, form({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code' }), 'sign-in');
  if (!j.access_token) throw new GoogleError(502, 'Google did not send a sign-in token.');
  const scopes = String(j.scope || '').split(/\s+/);
  if (j.scope && !scopes.includes(SCOPE)) throw new GoogleError(400, 'The Google sign-in did not allow managing the Business Profile. Connect again and tick every box Google asks about.', { reason: 'scope' });
  return { accessToken: j.access_token, refreshToken: j.refresh_token || null, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000, email: emailOf(j.id_token) };
}

export async function refreshAccess(cfg, refreshToken, g) {
  const j = await call(g, TOKEN, form({ refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' }), 'renew sign-in');
  if (!j.access_token) throw new GoogleError(502, 'Google did not renew the sign-in.');
  return { accessToken: j.access_token, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
}

/** -> [{account: 'accounts/1', location: 'locations/2', title, address}] (at most 100) */
export async function listLocations(token, g) {
  const out = [];
  let pt = '';
  for (let i = 0; i < 5; i++) {
    const a = await call(g, ACCOUNTS + '/accounts?pageSize=20' + (pt ? '&pageToken=' + encodeURIComponent(pt) : ''), { headers: bearer(token) }, 'accounts');
    for (const acc of Array.isArray(a.accounts) ? a.accounts : []) {
      let lt = '';
      for (let k = 0; k < 5 && out.length < 100; k++) {
        const l = await call(g, INFO + '/' + acc.name + '/locations?readMask=name,title,storefrontAddress&pageSize=100' + (lt ? '&pageToken=' + encodeURIComponent(lt) : ''), { headers: bearer(token) }, 'locations');
        for (const loc of Array.isArray(l.locations) ? l.locations : []) {
          const ad = loc.storefrontAddress || {};
          out.push({ account: acc.name, location: loc.name, title: clean(loc.title, 160) || 'Business', address: clean([].concat(ad.addressLines || [], ad.locality || []).join(', '), 200) });
        }
        lt = l.nextPageToken || '';
        if (!lt) break;
      }
    }
    pt = a.nextPageToken || '';
    if (!pt) break;
  }
  return out;
}

/** loc {account, location} -> {reviews, next, average, total} */
export async function listReviews(token, loc, opts = {}, g) {
  const id = String(loc.location).replace(/^locations\//, '');
  const q = new URLSearchParams({ pageSize: String(opts.pageSize || 50), orderBy: 'updateTime desc' });
  if (opts.pageToken) q.set('pageToken', opts.pageToken);
  const j = await call(g, V4 + '/' + loc.account + '/locations/' + id + '/reviews?' + q.toString(), { headers: bearer(token) }, 'reviews');
  return { reviews: Array.isArray(j.reviews) ? j.reviews : [], next: j.nextPageToken || null, average: j.averageRating || null, total: j.totalReviewCount || 0 };
}

/** reviewName 'accounts/1/locations/2/reviews/abc' -> {comment, updateTime} */
export async function putReply(token, reviewName, text, g) {
  if (!/^accounts\/[^/]+\/locations\/[^/]+\/reviews\/[^/]+$/.test(String(reviewName))) throw new GoogleError(400, 'This is not a Google review.');
  return call(g, V4 + '/' + reviewName + '/reply', { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, bearer(token)), body: JSON.stringify({ comment: text }) }, 'reply');
}
