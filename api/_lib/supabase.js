/* Server-side Supabase access for the api/ functions (service-role key; never sent to the browser).
 * Private module: Vercel does not expose files under api/_lib as endpoints.
 */
import { createClient } from '@supabase/supabase-js';
import { ApiError, unauthorized, forbidden } from './http.js';

export function config() {
  const env = process.env;
  return {
    url: (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, ''),
    key: (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '').trim()
  };
}

let cached = null;

/** The admin client, or null when the URL or the service key is missing. */
export function adminClient() {
  const { url, key } = config();
  if (!url || !key) return null;
  if (cached && cached.url === url && cached.key === key) return cached.client;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'orbique-api' } }
  });
  cached = { url, key, client };
  return client;
}

export function requireAdminClient() {
  const sb = adminClient();
  if (!sb) throw new ApiError(500, 'not-configured', 'The server is not connected to the database yet. Check the Supabase settings in Vercel.');
  return sb;
}

/** Throw a generic server error for a failed Supabase call, logging only the message. */
export function check(result, what) {
  if (result && result.error) {
    console.error(`[api] ${what}:`, result.error.code || '', result.error.message || result.error);
    throw new ApiError(500, 'server', 'Something went wrong on our side. Please try again in a minute.');
  }
  return result ? result.data : null;
}

/** The signed-in caller (from the Authorization bearer token), or a 401. */
export async function caller(sb, token) {
  if (!token) throw unauthorized('Please sign in first.');
  let res;
  try {
    res = await sb.auth.getUser(token);
  } catch (e) {
    throw unauthorized();
  }
  if (res.error || !res.data || !res.data.user) {
    // A network or server failure is not the caller's fault
    if (res.error && (res.error.status >= 500 || res.error.name === 'AuthRetryableFetchError')) {
      console.error('[api] getUser:', res.error.message);
      throw new ApiError(500, 'server', 'Could not check your sign-in. Please try again in a minute.');
    }
    throw unauthorized('Your sign-in has expired. Please sign in again.');
  }
  return res.data.user;
}

export async function isPlatformAdmin(sb, userId) {
  const data = check(await sb.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(), 'platform admin check');
  return !!data;
}

export async function platformAdminCount(sb) {
  const res = await sb.from('platform_admins').select('user_id', { count: 'exact', head: true });
  check(res, 'platform admin count');
  return res.count || 0;
}

/** The org row, or a 400 when it does not exist. */
export async function getOrg(sb, orgId) {
  const org = check(await sb.from('orgs').select('id, name, plan, status').eq('id', orgId).maybeSingle(), 'load workspace');
  if (!org) throw new ApiError(400, 'no-workspace', 'That workspace was not found.');
  return org;
}

/** The caller's active membership row in an org, or null. */
export async function membership(sb, orgId, userId) {
  return check(await sb.from('members').select('org_id, user_id, staff_id, role, status').eq('org_id', orgId).eq('user_id', userId).maybeSingle(), 'load membership');
}

export async function requireOwner(sb, orgId, userId) {
  const m = await membership(sb, orgId, userId);
  if (!m || m.role !== 'owner' || m.status !== 'active') throw forbidden('Only the account owner of this workspace can do that.');
  return m;
}

/* ---------- auth users ---------- */

/** Find an auth user id by email (lower-case). Uses the private SQL helper from 0002 when present, else pages through the users list. */
export async function findUserByEmail(sb, emailLower) {
  const rpc = await sb.rpc('api_user_by_email', { p_email: emailLower });
  if (!rpc.error) {
    if (!rpc.data) return null;
    const got = await sb.auth.admin.getUserById(rpc.data);
    if (got.error) { check(got, 'load user'); }
    return got.data && got.data.user ? got.data.user : null;
  }
  // Fallback (database helper missing): scan the users list page by page
  for (let page = 1; page <= 50; page++) {
    const res = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    const data = check(res, 'list users');
    const users = (data && data.users) || [];
    const hit = users.find((u) => (u.email || '').toLowerCase() === emailLower);
    if (hit) return hit;
    if (users.length < 1000) break;
  }
  return null;
}

/** Create a confirmed user. Returns the user, or null if the email is already registered (race). */
export async function createUser(sb, { email, password, metadata }) {
  const res = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: metadata || {} });
  if (res.error) {
    const msg = String(res.error.message || '').toLowerCase();
    if (res.error.code === 'email_exists' || res.error.code === 'user_already_exists' || /already (been )?registered|already exists/.test(msg)) return null;
    if (res.error.code === 'weak_password' || /password/.test(msg)) {
      console.error('[api] createUser password rejected:', res.error.message);
      throw new ApiError(400, 'weak-password', 'That password is not accepted by the sign-in settings. Please choose a longer one with letters and numbers.');
    }
    if (res.error.code === 'email_address_invalid' || /invalid.*email|email.*invalid/.test(msg)) {
      throw new ApiError(400, 'bad-email', 'That email address was not accepted. Please check it.');
    }
    check(res, 'create user');
  }
  return res.data.user;
}

export async function deleteUserQuietly(sb, userId) {
  try {
    const res = await sb.auth.admin.deleteUser(userId);
    if (res.error) console.error('[api] rollback delete user:', res.error.message);
  } catch (e) {
    console.error('[api] rollback delete user:', e.message);
  }
}
