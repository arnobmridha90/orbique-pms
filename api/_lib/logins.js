/* Signing in with a mobile number or a username (server only). Private module: Vercel does not expose api/_lib.
 *
 * Supabase accounts sign in with an email, so a person without one gets a stand-in address that is never written to
 * (LOGIN_DOMAIN), and their mobile number and username are kept in login_names (0019). Signing in with either goes
 * through the server: it finds the account, signs in with its email and hands the session to the app.
 *
 *   loginKind(text)                       'email' | 'phone' | 'username' | null (what someone typed to sign in)
 *   phoneLogin(text, cc) / username(text)  the stored form of a mobile number or username (or a 400)
 *   setLoginNames(sb, userId, {phone, username})   undefined = leave, null = remove; 409 when someone else has it
 *   loginNamesOf(sb, userId)              {phone, username}
 *   signInWithLogin(sb, {login, password}, opts)   -> {access_token, refresh_token, expires_in, token_type}
 */
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { ApiError, bad, conflict, tooMany } from './http.js';
import { check, config } from './supabase.js';

/** Stand-in sign-in emails for people without one (never sent to; the domain is Orbique's own). */
export const LOGIN_DOMAIN = 'login.orbiquepms.com';
export const standInEmail = () => 'staff-' + crypto.randomBytes(9).toString('hex') + '@' + LOGIN_DOMAIN;
export const isStandIn = (email) => String(email || '').toLowerCase().endsWith('@' + LOGIN_DOMAIN);

/** Country codes tried for a number typed without one (0123456789): the countries Orbique is set up for. */
const LOCAL_CODES = ['60', '65', '66', '62', '63', '84'];
export const FAIL_LIMIT = 8;
export const FAIL_WINDOW_MS = 15 * 60 * 1000;
export const IP_LIMIT = 40; // tries from one address in the window, over all names
const NOBODY = 'nobody@' + LOGIN_DOMAIN; // an account that never exists, for the password check of an unknown name

const USERNAME = /^[a-z][a-z0-9._-]{2,31}$/;

export function loginKind(text) {
  const v = String(text || '').trim();
  if (!v) return null;
  if (v.includes('@')) return 'email';
  if (/^[+0-9][0-9\s()\-.]{5,30}$/.test(v)) return 'phone';
  if (USERNAME.test(v.toLowerCase())) return 'username';
  return null;
}

/** A mobile number as stored: digits with the country code. cc is used for a number that starts with 0. */
export function phoneLogin(text, cc = '60') {
  const v = String(text || '').trim();
  if (!/^[+0-9][0-9\s()\-.]{5,30}$/.test(v)) throw bad('bad-phone', 'The mobile number does not look right. Use digits, spaces, + and -.');
  let d = v.replace(/\D/g, '');
  if (v.startsWith('+')) { /* has its country code */ } else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = String(cc || '60') + d.slice(1);
  if (d.length < 8 || d.length > 15) throw bad('bad-phone', 'The mobile number does not look right. Include the country code, for example +60 12-345 6789.');
  return d;
}

/** The numbers a typed mobile number may be (one without a country code may be from any of LOCAL_CODES). */
function phoneCandidates(text) {
  const v = String(text || '').trim(), d = v.replace(/\D/g, '');
  if (v.startsWith('+')) return [d];
  if (d.startsWith('00')) return [d.slice(2)];
  if (d.startsWith('0')) return LOCAL_CODES.map((cc) => cc + d.slice(1));
  return [d];
}

export function username(text) {
  const v = String(text || '').trim().toLowerCase();
  if (!USERNAME.test(v)) throw bad('bad-username', 'Usernames are 3 to 32 letters, digits, dots, dashes or underscores, starting with a letter. For example aina.k');
  return v;
}

export const showPhone = (d) => (d ? '+' + d : null);

export async function loginNamesOf(sb, userId) {
  const rows = check(await sb.from('login_names').select('kind, login').eq('user_id', userId), 'load sign-in names') || [];
  const out = { phone: null, username: null };
  for (const r of rows) out[r.kind] = r.login;
  return out;
}

const takenMsg = (kind) => (kind === 'phone' ? 'Someone else on Orbique already signs in with this mobile number.' : 'That username is taken on Orbique. Try another, for example with your company name in front.');

/** names: {phone, username}: a stored form (phoneLogin / username), null to remove, undefined to leave as it is.
 *  All or nothing (set_login_names, 0019): when a name is taken nothing changes, so nobody is left without a sign-in. */
export async function setLoginNames(sb, userId, names) {
  const kinds = ['phone', 'username'].filter((k) => names[k] !== undefined);
  if (!kinds.length) return;
  for (const kind of kinds) {
    if (!names[kind]) continue;
    const owner = check(await sb.from('login_names').select('user_id').eq('kind', kind).eq('login', names[kind]).maybeSingle(), 'check sign-in name');
    if (owner && owner.user_id !== userId) throw conflict(kind + '-taken', takenMsg(kind));
  }
  const r = await sb.rpc('set_login_names', { p_user: userId, p_kinds: kinds, p_logins: kinds.map((k) => names[k] || null) });
  if (r.error && r.error.code === '23505') { const kind = /^phone/.test(r.error.message || '') ? 'phone' : 'username'; throw conflict(kind + '-taken', takenMsg(kind)); }
  check(r, 'save sign-in names');
}

/** Forget the wrong tries of an account (after the owner sets a new password). */
export async function clearFailures(sb, userId) {
  await sb.from('login_failures').delete().eq('key', 'user:' + userId);
}

const WRONG = 'That login and password do not match. Check them and try again.';

/** One try against each key (login_try, 0019: counted atomically, so parallel tries cannot slip past the limit). */
async function tryOrRefuse(sb, keys, limits) {
  const r = await sb.rpc('login_try', { p_keys: keys, p_limits: limits, p_window_secs: FAIL_WINDOW_MS / 1000 });
  check(r, 'check sign-in tries');
  if (r.data !== true) throw tooMany('Too many wrong tries. Wait 15 minutes, or ask your workspace owner for a new password.');
}

/** The session for a mobile number or username and password. Wrong details, unknown or not, give the same answer.
 *  Tries are counted before the password is checked: per account (FAIL_LIMIT), per typed name for names nobody has, and
 *  per address (IP_LIMIT). An unknown name still runs a password check, so the answer takes as long either way. */
export async function signInWithLogin(sb, body, opts = {}) {
  const typed = String((body && body.login) || '').trim().slice(0, 64);
  const password = typeof (body && body.password) === 'string' ? body.password : '';
  const kind = loginKind(typed);
  if (kind === 'email') throw bad('use-email', 'Sign in with an email in the app.');
  if (!kind) throw bad('bad-login', 'Enter your email, mobile number or username.');
  if (!password) throw bad('bad-password', 'Enter your password.');
  const keys = kind === 'phone' ? phoneCandidates(typed) : [typed.toLowerCase()];
  const typedKey = kind + ':' + keys.slice().sort()[0];
  const client = (opts.client || authClient)(opts.ip);

  await tryOrRefuse(sb, opts.ip ? [typedKey, 'ip:' + opts.ip] : [typedKey], opts.ip ? [FAIL_LIMIT, IP_LIMIT] : [FAIL_LIMIT]);
  const rows = check(await sb.from('login_names').select('user_id, login').eq('kind', kind).in('login', keys), 'find sign-in name') || [];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  if (ids.length > 1) throw bad('add-country-code', 'Add your country code to the number, for example +60 12-345 6789.');
  const got = ids.length ? await sb.auth.admin.getUserById(ids[0]) : null;
  const user = got && check(got, 'load user') && got.data.user;
  if (!user || !user.email) {
    await client.auth.signInWithPassword({ email: NOBODY, password }).catch(() => null); // same time as a real check
    throw new ApiError(400, 'wrong-login', WRONG);
  }
  // a name someone has: the account's own count decides (however the number was typed)
  await sb.from('login_failures').delete().eq('key', typedKey);
  const userKey = 'user:' + user.id;
  await tryOrRefuse(sb, [userKey], [FAIL_LIMIT]);

  const res = await client.auth.signInWithPassword({ email: user.email, password });
  if (res.error || !res.data || !res.data.session) {
    if (res.error && (res.error.status >= 500 || res.error.name === 'AuthRetryableFetchError')) {
      console.error('[api] sign-in:', res.error.message);
      throw new ApiError(500, 'server', 'Could not sign you in right now. Please try again in a minute.');
    }
    if (res.error && /rate limit|too many/i.test(res.error.message || '')) throw tooMany('Too many sign-ins right now. Please wait a few minutes.');
    throw new ApiError(400, 'wrong-login', WRONG);
  }
  await sb.from('login_failures').delete().eq('key', userKey);
  const s = res.data.session;
  return { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, token_type: s.token_type };
}

/** A client for one sign-in only (never the shared admin client: a session on it would replace the service key). */
function authClient(ip) {
  const env = process.env, { url, key } = config();
  const anon = (env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '').trim();
  return createClient(url, anon || key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: Object.assign({ 'X-Client-Info': 'orbique-api' }, ip ? { 'X-Forwarded-For': ip } : {}) }
  });
}
