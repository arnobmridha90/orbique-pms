/* POST /api/channex  {action, orgId, ...}   the channel manager (Channex) for one workspace
 *
 *   config                     member        {configured, env, allowed, demo}: live or practice (simulated) mode
 *   connect     {buildingId}   owner, ops    group -> property -> room types -> rate plans, then the first full sync
 *   iframe      {buildingId}   owner, ops    {url, expiresAt}: the Channex channel screen, signed in with a one-time token
 *   full-sync   {buildingId, confirm: true}  owner, ops   500 days again; at most once every 5 minutes
 *   flush                      member        send this workspace's pending changes now: {sent, pending, waitingUntil}
 *   channels    {buildingId}   member        the building's channels (Booking.com, Agoda, ...), also cached
 *   pause / resume / disconnect {buildingId}  owner
 *   retry       {buildingId}   owner, ops    clear a pause or an error and send again
 *   admin-setup                platform admin   the global Channex webhook, and which settings are present
 *
 * Sign-in: "Authorization: Bearer <Supabase access token>"; the caller must be an active member of an active workspace.
 * Only workspaces in CHANNEX_ORG_ALLOWLIST may connect (in staging an empty list allows none; in production an empty
 * list allows every workspace). Demo workspaces always stay in practice mode. The Channex API key never leaves the
 * server; nothing here returns it.
 */
import { ApiError, ok, fail, send, cors, readJson, bearer, bad, forbidden, conflict, tooMany, id as idField, uuid as uuidField } from './_lib/http.js';
import { requireAdminClient, caller, isPlatformAdmin, getOrg, membership } from './_lib/supabase.js';
import { channexConfig, ChannexError, channelView } from './_lib/channex.js';
import { must, record, blob, tracked } from './_lib/channex-db.js';
import { setupBuilding, loadBuilding, buildingProblems, brandContact } from './_lib/channex-setup.js';
import { runWorker, forceMarks, resendRejected, CONNECTED } from './_lib/channex-sync.js';

export const IFRAME_CHANNELS = 'BDC,AGO,ABB,EXP,CTP';
export const WEBHOOK_EVENTS = 'booking;booking_unmapped_room;booking_unmapped_rate;non_acked_booking;sync_error;new_channel;updated_channel;disconnect_channel;disconnect_listing';
const FULL_SYNC_GAP_MS = 5 * 60 * 1000; // a guard against double clicks: Channex asks that a full sync be possible at any time
const FLUSH_GAP_MS = 2000;
const TOKEN_LIFE_MS = 15 * 60 * 1000;

/* ---------- who may do what ---------- */

const MANAGE = ['owner', 'ops'];

/** The caller's workspace context: {org, member, cfg}. Refuses non-members and paused workspaces. */
async function workspace(sb, body, me, roles) {
  const orgId = uuidField(body.orgId);
  const m = await membership(sb, orgId, me.id);
  if (!m || m.status !== 'active') throw forbidden('You are not a member of this workspace.');
  if (roles && !roles.includes(m.role)) throw forbidden(roles.length === 1 ? 'Only the account owner of this workspace can do that.' : 'Only the account owner or an ops manager can do that.');
  const org = await getOrg(sb, orgId);
  if (org.status !== 'active') throw forbidden('This workspace is paused. Please contact Orbique.');
  return { org, member: m, cfg: channexConfig() };
}

export function allowedOrg(cfg, orgId) {
  if (!cfg.key) return false;
  if (cfg.orgAllowlist.length) return cfg.orgAllowlist.includes(String(orgId).toLowerCase());
  return cfg.env === 'production';
}

async function isDemo(sb, orgId) {
  const meta = await blob(sb, orgId, 'workspaceMeta');
  return !!(meta && typeof meta === 'object' && meta.demo === true);
}

/** Live mode is only for configured, allowlisted, non-demo workspaces. */
async function requireLive(sb, ws) {
  if (!ws.cfg.key) throw new ApiError(503, 'not-configured', 'The channel manager is not set up on the server yet. Please contact Orbique.');
  if (!allowedOrg(ws.cfg, ws.org.id)) throw forbidden('Channel connections are not switched on for this workspace yet. Please contact Orbique.');
  if (await isDemo(sb, ws.org.id)) throw forbidden('This is a demo workspace, so channels stay in practice mode and nothing is sent to booking sites.');
}

const PROP_COLS = 'org_id, env, building_id, channex_property_id, currency, status, full_sync_requested_at, full_sync_at, full_sync_task_ids, paused_until, backoff_level, lease_until, last_error, last_error_at, channels, updated_at';

async function propertyOf(sb, ws, buildingId, { required = true } = {}) {
  const p = must(await sb.from('channex_properties').select(PROP_COLS).eq('org_id', ws.org.id).eq('env', ws.cfg.env).eq('building_id', buildingId).maybeSingle(), 'load property');
  if (!p && required) throw bad('not-connected', 'This building is not connected to channels yet.');
  return p;
}

/** What the Channels page shows about a building (never the API key or tokens). */
const view = (p) => p && {
  buildingId: p.building_id, propertyId: p.channex_property_id, status: p.status, currency: p.currency,
  fullSyncAt: p.full_sync_at || null, fullSyncRequestedAt: p.full_sync_requested_at || null,
  pausedUntil: p.paused_until || null, lastError: p.last_error || null
};

async function staffName(sb, orgId, member, me) {
  const s = member.staff_id ? await record(sb, orgId, 'staff', member.staff_id) : null;
  const meta = me.user_metadata || {};
  return String((s && s.name) || meta.name || me.email || 'Orbique user').slice(0, 80);
}

const RUN_BUDGET_MS = 12000;

/* ---------- actions ---------- */

async function config(sb, body, me) {
  const ws = await workspace(sb, body, me);
  const demo = await isDemo(sb, ws.org.id);
  return { configured: !!ws.cfg.key, env: ws.cfg.env, allowed: allowedOrg(ws.cfg, ws.org.id) && !demo, demo };
}

async function connect(sb, body, me) {
  const ws = await workspace(sb, body, me, MANAGE);
  await requireLive(sb, ws);
  const buildingId = idField(body.buildingId, 'Building');
  const data = await loadBuilding(sb, ws.org.id, buildingId);
  const problems = buildingProblems(data.building, data.unitTypes, data.units, data.plans, await brandContact(sb, ws.org.id));
  if (problems.length) {
    const e = bad('not-ready', problems.length === 1 ? problems[0] : 'Before connecting: ' + problems.join(' '));
    e.problems = problems;
    throw e;
  }
  let setup;
  try {
    setup = await setupBuilding(sb, ws.org, buildingId, { config: ws.cfg, byUser: me.id, email: me.email, data });
  } catch (e) {
    throw channexFailure(e, 'Could not set up the channel manager');
  }
  const p = setup.property;
  const patch = { updated_at: new Date().toISOString(), last_error: null, paused_until: null, backoff_level: 0 };
  if (['paused', 'error'].includes(p.status) && p.full_sync_at) {
    // still connected, only stopped: queued changes go out with complete values, no new full sync (Full update is the button for that)
    patch.status = 'live';
    await forceMarks(sb, p.channex_property_id);
  } else if (!['syncing', 'live'].includes(p.status)) {
    // first connect, or back after a disconnect: everything goes again
    Object.assign(patch, { status: 'syncing', full_sync_requested_at: new Date().toISOString(), full_sync_task_ids: null });
  }
  must(await sb.from('channex_properties').update(patch).eq('channex_property_id', p.channex_property_id), 'start syncing');
  const run = await runWorker(sb, { config: ws.cfg, orgId: ws.org.id, propertyIds: [p.channex_property_id], budgetMs: RUN_BUDGET_MS, quietMs: 0, setup: false });
  const after = await propertyOf(sb, ws, buildingId);
  return {
    property: view(after),
    roomTypes: setup.roomTypes.length, ratePlans: setup.ratePlans.length, created: setup.created,
    fullSync: after.full_sync_task_ids || null, pending: run.pending, waitingUntil: run.waitingUntil
  };
}

async function iframe(sb, body, me) {
  const ws = await workspace(sb, body, me, MANAGE);
  await requireLive(sb, ws);
  const buildingId = idField(body.buildingId, 'Building');
  const p = await propertyOf(sb, ws, buildingId);
  if (p.status === 'disconnected') throw bad('not-connected', 'Connect this building again first.');
  const g = must(await sb.from('channex_groups').select('group_id').eq('org_id', ws.org.id).eq('env', ws.cfg.env).maybeSingle(), 'load group');
  const username = await staffName(sb, ws.org.id, ws.member, me);
  const req = { property_id: p.channex_property_id, username };
  if (g) req.group_id = g.group_id;
  let res;
  try {
    res = await tracked(sb, ws.cfg, { method: 'POST', path: '/auth/one_time_token', body: { one_time_token: req }, logPayload: { one_time_token: req }, orgId: ws.org.id, propertyId: p.channex_property_id, source: 'iframe', byUser: me.id });
  } catch (e) {
    throw channexFailure(e, 'Could not open the channel screen');
  }
  const token = res.data && (res.data.token || (res.data.attributes && res.data.attributes.token));
  if (!token) throw new ApiError(502, 'channex', 'Channex did not answer with a sign-in token. Please try again.');
  const q = new URLSearchParams({ oauth_session_key: token, app_mode: 'headless', redirect_to: '/channels', property_id: p.channex_property_id });
  if (g) q.set('group_id', g.group_id);
  q.set('channels', IFRAME_CHANNELS);
  // availability is only ever set from Orbique: the Channex inventory screen shows it but cannot change it
  q.set('read_only_availability', 'true');
  q.set('lng', 'en');
  return { url: ws.cfg.appUrl + '/auth/exchange?' + q.toString().replace(/%2F/g, '/').replace(/%2C/g, ','), expiresAt: new Date(Date.now() + TOKEN_LIFE_MS).toISOString() };
}

async function fullSyncAction(sb, body, me) {
  const ws = await workspace(sb, body, me, MANAGE);
  await requireLive(sb, ws);
  const buildingId = idField(body.buildingId, 'Building');
  if (body.confirm !== true) throw bad('confirm', 'Please confirm that you want to send everything again.');
  const p = await propertyOf(sb, ws, buildingId);
  if (!['syncing', 'live'].includes(p.status)) throw conflict('not-live', p.status === 'paused' ? 'Sending is paused for this building. Resume it first.' : 'Sending has stopped for this building. Press Retry first.');
  if (p.status !== 'syncing' && p.full_sync_at && Date.now() - Date.parse(p.full_sync_at) < FULL_SYNC_GAP_MS) {
    const next = new Date(Date.parse(p.full_sync_at) + FULL_SYNC_GAP_MS).toISOString();
    const e = tooMany('A full update was sent less than 5 minutes ago. Changes still go out on their own; a full update is possible again after ' + next + '.');
    e.code = 'full-sync-recent';
    throw e;
  }
  if (!p.full_sync_requested_at) must(await sb.from('channex_properties').update({ full_sync_requested_at: new Date().toISOString(), full_sync_task_ids: null, updated_at: new Date().toISOString() }).eq('channex_property_id', p.channex_property_id), 'request full sync');
  const run = await runWorker(sb, { config: ws.cfg, orgId: ws.org.id, propertyIds: [p.channex_property_id], budgetMs: RUN_BUDGET_MS, quietMs: 0, setup: false });
  const after = await propertyOf(sb, ws, buildingId);
  return { property: view(after), fullSync: after.full_sync_task_ids || null, done: !after.full_sync_requested_at, waitingUntil: run.waitingUntil };
}

/* one flush per org every 2 s on this server instance (the worker's per-property lease covers the rest) */
const lastFlush = new Map();

async function flush(sb, body, me) {
  const ws = await workspace(sb, body, me);
  if (!ws.cfg.key || !allowedOrg(ws.cfg, ws.org.id)) return { sent: 0, pending: 0, waitingUntil: null, live: false };
  const now = Date.now();
  const prev = lastFlush.get(ws.org.id) || 0;
  if (now - prev < FLUSH_GAP_MS) {
    const e = tooMany('Sending already. Please wait a moment.');
    e.code = 'flush-busy';
    throw e;
  }
  lastFlush.set(ws.org.id, now);
  if (lastFlush.size > 5000) for (const [k, t] of lastFlush) if (now - t > 60000) lastFlush.delete(k);
  const run = await runWorker(sb, { config: ws.cfg, orgId: ws.org.id, budgetMs: 8000, quietMs: 0 });
  return { sent: run.sent, pending: run.pending, waitingUntil: run.waitingUntil, live: true };
}

async function channels(sb, body, me) {
  const ws = await workspace(sb, body, me);
  const buildingId = idField(body.buildingId, 'Building');
  const p = await propertyOf(sb, ws, buildingId);
  if (!ws.cfg.key || !allowedOrg(ws.cfg, ws.org.id)) return { channels: p.channels || [], cached: true };
  const list = [];
  try {
    for (let page = 1; page <= 10; page++) {
      const res = await tracked(sb, ws.cfg, { method: 'GET', path: '/channels', query: { 'filter[property_id]': p.channex_property_id, 'pagination[page]': page, 'pagination[limit]': 100 }, orgId: ws.org.id, propertyId: p.channex_property_id, source: 'channels', byUser: me.id });
      const rows = Array.isArray(res.data) ? res.data : [];
      for (const r of rows) list.push(channelView(r));
      if (rows.length < 100) break;
    }
  } catch (e) {
    if (e instanceof ChannexError && e.retryable) return { channels: p.channels || [], cached: true };
    throw channexFailure(e, 'Could not load the channels');
  }
  must(await sb.from('channex_properties').update({ channels: list }).eq('channex_property_id', p.channex_property_id), 'save channels');
  return { channels: list, cached: false };
}


async function setStatus(sb, body, me, action) {
  const ws = await workspace(sb, body, me, action === 'retry' ? MANAGE : ['owner']);
  const buildingId = idField(body.buildingId, 'Building');
  const p = await propertyOf(sb, ws, buildingId);
  const now = new Date().toISOString();
  let patch;
  if (action === 'pause') {
    if (!['syncing', 'live', 'error'].includes(p.status)) throw conflict('not-live', 'This building is not sending to channels.');
    patch = { status: 'paused' };
  } else if (action === 'resume') {
    if (p.status !== 'paused') throw conflict('not-paused', 'This building is not paused.');
    await requireLive(sb, ws);
    patch = { status: p.full_sync_at ? 'live' : 'syncing', paused_until: null, backoff_level: 0, last_error: null };
    if (!p.full_sync_at) patch.full_sync_requested_at = p.full_sync_requested_at || now;
  } else if (action === 'retry') {
    if (!CONNECTED.includes(p.status)) throw conflict('not-connected', 'This building is not connected.');
    await requireLive(sb, ws);
    patch = { paused_until: null, backoff_level: 0, last_error: null };
    if (p.status === 'error') patch.status = p.full_sync_at ? 'live' : 'syncing';
  } else { // disconnect
    if (p.status === 'disconnected') return { property: view(p) };
    patch = { status: 'disconnected', paused_until: null, lease_until: null, full_sync_requested_at: null };
  }
  must(await sb.from('channex_properties').update(Object.assign({ updated_at: now }, patch)).eq('channex_property_id', p.channex_property_id), action);
  if (action === 'disconnect') {
    // nothing is sent any more; Channex keeps the property so a later connect can reuse it
    must(await sb.from('channex_outbox').delete().eq('channex_property_id', p.channex_property_id), 'clear marks');
    // the building's link in the other Channex (staging after the switch to production) is not shown anywhere, but
    // it would still count as connected and block Start empty (reset_org), so it goes too
    const other = must(await sb.from('channex_properties').update(Object.assign({ updated_at: now }, patch)).eq('org_id', ws.org.id).eq('building_id', buildingId).neq('env', ws.cfg.env).neq('status', 'disconnected').select('channex_property_id'), 'disconnect other environment') || [];
    for (const o of other) must(await sb.from('channex_outbox').delete().eq('channex_property_id', o.channex_property_id), 'clear marks');
  }
  // resume: what queued up while paused goes out with complete values; retry (Send again): dates Channex dropped too
  if (action === 'resume') await forceMarks(sb, p.channex_property_id);
  if (action === 'retry') await resendRejected(sb, p, { byUser: me.id });
  if (action === 'retry' || action === 'resume') {
    must(await sb.from('channex_alerts').update({ resolved_at: now, resolved_by: me.id }).eq('org_id', ws.org.id).eq('kind', 'sync_error').eq('ref->>propertyId', p.channex_property_id).is('resolved_at', null), 'resolve alerts');
    await runWorker(sb, { config: ws.cfg, orgId: ws.org.id, propertyIds: [p.channex_property_id], budgetMs: 8000, quietMs: 0, setup: false });
  }
  return { property: view(await propertyOf(sb, ws, buildingId)) };
}

/* ---------- admin-setup: the global webhook ---------- */

export function appUrl(env = process.env) {
  const raw = String(env.APP_URL || '').trim() || (env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + String(env.VERCEL_PROJECT_PRODUCTION_URL).trim() : '');
  return raw.replace(/\/+$/, '');
}

/** The webhook Orbique wants Channex to have. */
export function webhookBody(cfg, url, env = process.env) {
  const w = {
    callback_url: url + '/api/channex-webhook',
    event_mask: WEBHOOK_EVENTS,
    property_id: null,
    is_global: true,
    is_active: true,
    send_data: true,
    headers: cfg.webhookToken ? { 'X-Orbique-Webhook-Token': cfg.webhookToken } : {}
  };
  const keyId = String(env.CHANNEX_SIGNING_KEY_ID || '').trim();
  if (keyId) { w.is_signed = true; w.signing_key_id = keyId; }
  return w;
}

const sameWebhook = (a, want) => a && a.callback_url === want.callback_url && a.event_mask === want.event_mask && a.is_active === true && a.send_data === true &&
  a.is_global === true && JSON.stringify(a.headers || {}) === JSON.stringify(want.headers) && (!want.is_signed || (a.is_signed === true && a.signing_key_id === want.signing_key_id));

async function adminSetup(sb, body, me) {
  if (!(await isPlatformAdmin(sb, me.id))) throw forbidden('Only Orbique platform admins can do that.');
  const cfg = channexConfig();
  const url = appUrl();
  const settings = {
    apiKey: !!cfg.key, baseUrl: cfg.baseUrl, env: cfg.env, appUrl: url || null,
    webhookSecret: !!cfg.webhookSecret, webhookToken: !!cfg.webhookToken, signingKeyId: !!String(process.env.CHANNEX_SIGNING_KEY_ID || '').trim(),
    workerSecret: !!cfg.workerSecret, allowlist: cfg.orgAllowlist.length
  };
  // pg_cron cannot be read through the API; the worker's call log shows whether ticks arrive
  const recent = await sb.from('channex_calls').select('at').order('at', { ascending: false }).limit(1);
  settings.lastCallAt = recent && !recent.error && recent.data && recent.data[0] ? recent.data[0].at : null;
  // bookings Channex sent for properties no building is connected to (left unacknowledged, so Channex keeps sending them)
  const unknown = await sb.from('channex_alerts').select('id, message, ref, created_at').is('org_id', null).eq('kind', 'unknown_property').is('resolved_at', null).order('created_at', { ascending: false }).limit(20);
  const unknownProperties = unknown && !unknown.error ? (unknown.data || []).map((a) => ({ propertyId: (a.ref && a.ref.propertyId) || null, message: a.message, at: a.created_at })) : [];
  if (!cfg.key) return { settings, unknownProperties, webhook: null, message: 'Set CHANNEX_API_KEY first.' };
  if (!url) return { settings, unknownProperties, webhook: null, message: 'Set APP_URL (or deploy to production) so Channex knows where to send bookings.' };
  if (!cfg.webhookSecret && !cfg.webhookToken) return { settings, unknownProperties, webhook: null, message: 'Set CHANNEX_WEBHOOK_SECRET (with CHANNEX_SIGNING_KEY_ID) or CHANNEX_WEBHOOK_TOKEN first, so Orbique can tell real booking messages from fake ones.' };
  const want = webhookBody(cfg, url);
  const call = { orgId: null, source: 'setup', byUser: me.id };
  try {
    let found = null;
    for (let page = 1; page <= 10 && !found; page++) {
      const res = await tracked(sb, cfg, Object.assign({}, call, { method: 'GET', path: '/webhooks', query: { 'pagination[page]': page, 'pagination[limit]': 100 } }));
      const rows = Array.isArray(res.data) ? res.data : [];
      found = rows.find((r) => r && r.attributes && r.attributes.callback_url === want.callback_url) || null;
      if (rows.length < 100) break;
    }
    const logged = Object.assign({}, want, { headers: want.headers['X-Orbique-Webhook-Token'] ? { 'X-Orbique-Webhook-Token': '[set]' } : {} });
    let state;
    let id;
    if (found && sameWebhook(found.attributes, want)) { state = 'ok'; id = found.id; }
    else if (found) {
      await tracked(sb, cfg, Object.assign({}, call, { method: 'PUT', path: '/webhooks/' + found.id, body: { webhook: want }, logPayload: { webhook: logged } }));
      state = 'updated'; id = found.id;
    } else {
      const res = await tracked(sb, cfg, Object.assign({}, call, { method: 'POST', path: '/webhooks', body: { webhook: want }, logPayload: { webhook: logged } }));
      state = 'created'; id = res.data && res.data.id;
    }
    if (id) must(await sb.from('channex_meta').upsert({ id: 1, webhook_id: id }, { onConflict: 'id' }), 'save webhook');
    return { settings, unknownProperties, webhook: { id: id || null, state, callbackUrl: want.callback_url, signed: !!want.is_signed } };
  } catch (e) {
    throw channexFailure(e, 'Could not set up the Channex webhook');
  }
}

/** A Channex failure as a plain-English answer (never the key: ChannexError messages are scrubbed). */
function channexFailure(e, what) {
  if (e instanceof ApiError) return e;
  if (e instanceof ChannexError) {
    if (e.kind === 'rate_limited') return tooMany(what + ': Channex is busy. Please try again in a minute.');
    if (e.retryable) return new ApiError(502, 'channex-unavailable', what + ': Channex did not answer. Please try again in a minute.');
    return new ApiError(502, 'channex-refused', what + ': ' + e.message);
  }
  return e;
}

const ACTIONS = {
  config: config,
  connect: connect,
  iframe: iframe,
  'full-sync': fullSyncAction,
  flush: flush,
  channels: channels,
  pause: (sb, body, me) => setStatus(sb, body, me, 'pause'),
  resume: (sb, body, me) => setStatus(sb, body, me, 'resume'),
  disconnect: (sb, body, me) => setStatus(sb, body, me, 'disconnect'),
  retry: (sb, body, me) => setStatus(sb, body, me, 'retry'),
  'admin-setup': adminSetup
};

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, { ok: false, error: 'method', message: 'Use POST for this address.' });
    }
    const body = await readJson(req);
    const action = typeof body.action === 'string' ? body.action : '';
    const run = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    if (!run) throw bad('bad-action', 'Unknown request.');
    const sb = requireAdminClient();
    const me = await caller(sb, bearer(req));
    const result = await run(sb, body, me);
    return ok(res, result);
  } catch (err) {
    if (err instanceof ApiError && err.problems) return send(res, err.status, { ok: false, error: err.code, message: err.message, problems: err.problems });
    return fail(res, err);
  }
}
