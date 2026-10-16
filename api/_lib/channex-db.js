/* Database and call-log helpers shared by the Channex modules (server only).
 * Private module: Vercel does not expose files under api/_lib as endpoints.
 *
 *   selectAll(build, what)           every row of a query, 1000 at a time (Supabase answers at most 1000 rows per request)
 *   records(sb, orgId, coll, where)  the live (not deleted) records of one collection as plain objects, id included
 *   tracked(sb, cfg, call)           one Channex call, logged in channex_calls (key never logged)
 *   addAlert(sb, row)                an alert for the Channels page, skipped when the same one is still open
 *   todayMY(), addDays(), daysBetween(), archived()
 */
import { ApiError } from './http.js';
import { channexRequest, logCall, ChannexError } from './channex.js';

export const PAGE = 1000;

/** A database error as a generic 500 (the message is logged, never shown). */
export function dbFail(error, what) {
  console.error(`[channex] ${what}:`, (error && (error.code || '')) || '', (error && error.message) || String(error));
  return new ApiError(500, 'server', 'Something went wrong on our side. Please try again in a minute.');
}

/** The data of a Supabase result, or throw. */
export function must(result, what) {
  if (result && result.error) throw dbFail(result.error, what);
  return result ? result.data : null;
}

/** All rows of a query. build() returns a fresh query builder each time (a builder can only run once). */
export async function selectAll(build, what) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const res = await build().range(from, from + PAGE - 1);
    const rows = must(res, what) || [];
    for (const r of rows) out.push(r);
    if (rows.length < PAGE) break;
  }
  return out;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Live records of a collection: [{...data, id}]. where(q) may add filters. Records whose data is not an object are skipped. */
export async function records(sb, orgId, coll, where) {
  const rows = await selectAll(() => {
    let q = sb.from('records').select('id, data').eq('org_id', orgId).eq('coll', coll).eq('deleted', false).order('id');
    return where ? where(q) : q;
  }, 'load ' + coll);
  return rows.filter((r) => isObj(r.data)).map((r) => Object.assign({}, r.data, { id: r.id }));
}

/** One record (live), or null. */
export async function record(sb, orgId, coll, id) {
  const r = must(await sb.from('records').select('id, data').eq('org_id', orgId).eq('coll', coll).eq('id', id).eq('deleted', false).maybeSingle(), 'load ' + coll);
  return r && isObj(r.data) ? Object.assign({}, r.data, { id: r.id }) : null;
}

/** A blob value (blobs.data = {v: value}), or null. */
export async function blob(sb, orgId, key) {
  const r = must(await sb.from('blobs').select('data').eq('org_id', orgId).eq('key', key).maybeSingle(), 'load ' + key);
  return r && r.data && typeof r.data === 'object' ? (r.data.v !== undefined ? r.data.v : null) : null;
}

/** Archived the way 0006 sees it (channex__archived): archived: true or status 'archived'. */
export const archived = (d) => !!d && (d.archived === true || d.status === 'archived');

/* ---------- dates (Malaysia has no daylight saving: UTC+8 all year) ---------- */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isIso = (s) => typeof s === 'string' && ISO.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
export const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/** Every date from a to b inclusive. */
export function dateRange(a, b) {
  const out = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Today in Malaysia. CHANNEX_TODAY (YYYY-MM-DD) pins it, but only while CHANNEX_BASE_URL points at a local mock
 * (http://127.0.0.1 or localhost), so tests can match the database's orbique.channex_today and production never can.
 */
export function todayMY(now = Date.now()) {
  const pin = String(process.env.CHANNEX_TODAY || '').trim();
  const base = String(process.env.CHANNEX_BASE_URL || '');
  if (pin && isIso(pin) && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base)) return pin;
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}

/** Inventory length Channex keeps (property setting state_length) and therefore the full-sync window. */
export const STATE_DAYS = 500;

/* ---------- Channex calls with the call log ---------- */

/**
 * One Channex call, logged in channex_calls.
 *   call {method, path, body, query, orgId, propertyId, source, byUser, logPayload (what to store; default body),
 *         callId (an existing row to fill in, e.g. from channex_take_slot), timeoutMs, request (tests)}
 * Resolves the channexRequest result; a ChannexError is logged and re-thrown.
 */
export async function tracked(sb, cfg, call) {
  const t0 = Date.now();
  const request = call.request || channexRequest;
  const row = {
    orgId: call.orgId, propertyId: call.propertyId, endpoint: call.path.split('?')[0], method: call.method, source: call.source,
    byUser: call.byUser, payload: call.logPayload !== undefined ? call.logPayload : call.body === undefined ? null : call.body,
    itemCount: call.body && Array.isArray(call.body.values) ? call.body.values.length : undefined
  };
  try {
    const res = await request(call.method, call.path, call.body, { config: cfg, query: call.query, timeoutMs: call.timeoutMs });
    row.status = res.status;
    row.durationMs = Date.now() - t0;
    row.taskIds = call.taskIds ? call.taskIds(res) : undefined;
    row.warnings = call.warnings ? call.warnings(res) : undefined;
    await saveCall(sb, call.callId, row);
    return res;
  } catch (e) {
    row.status = e instanceof ChannexError ? e.status || undefined : undefined;
    row.error = e && e.message ? e.message : String(e);
    row.durationMs = Date.now() - t0;
    await saveCall(sb, call.callId, row);
    throw e;
  }
}

/** Insert a call-log row, or fill in a reserved one. Never throws (the log must not break a send). */
async function saveCall(sb, callId, row) {
  if (!sb) return;
  try {
    if (callId) {
      const r = await logCall(null, row); // shape only
      for (const k of ['org_id', 'channex_property_id', 'source', 'by_user']) if (r[k] === null) delete r[k]; // keep what the reservation set
      const res = await sb.from('channex_calls').update(r).eq('id', callId);
      if (res.error) console.error('[channex] call log:', res.error.message);
    } else {
      await logCall(sb, row);
    }
  } catch (e) {
    console.error('[channex] call log:', e && e.message ? e.message : String(e));
  }
}

/* ---------- alerts ---------- */

/**
 * Add an alert unless an open one of the same kind with the same ref.key exists.
 *   row {orgId, kind, message, ref: {key, ...}}   orgId null: an alert for platform admins (no workspace owns it)
 */
export async function addAlert(sb, row) {
  try {
    const key = row.ref && row.ref.key;
    if (key) {
      let q = sb.from('channex_alerts').select('id');
      q = row.orgId ? q.eq('org_id', row.orgId) : q.is('org_id', null);
      const open = await q.eq('kind', row.kind).is('resolved_at', null).eq('ref->>key', String(key)).limit(1);
      if (!open.error && open.data && open.data.length) return false;
    }
    const res = await sb.from('channex_alerts').insert({ org_id: row.orgId || null, kind: row.kind, message: String(row.message || '').slice(0, 1000), ref: row.ref || null });
    if (res.error) { console.error('[channex] alert:', res.error.message); return false; }
    return true;
  } catch (e) {
    console.error('[channex] alert:', e && e.message ? e.message : String(e));
    return false;
  }
}
