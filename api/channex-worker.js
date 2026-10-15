/* POST /api/channex-worker  {task: 'tick' | 'nightly'}   the Channex sending job (plan section 4)
 *
 * Called by pg_cron through pg_net (migration 0007) every minute ('tick') and at 03:00 Malaysia time ('nightly'),
 * or locally by scripts/dev.mjs --worker. Authorization: "Bearer <CHANNEX_WORKER_SECRET>" (compared in constant time).
 *
 * tick (budget about 15 s):
 *   1. [M6] retry booking events and revisions that were saved but not acknowledged       (hook below)
 *   2. [M6] poll /booking_revisions/feed when 15 minutes have passed                       (hook below)
 *   3. setup queue (edits to buildings, unit types and rate plans of connected buildings)
 *   4. every property with marks or a full-sync request: availability, then rates and restrictions
 * nightly:
 *   mark the day that just came into the 500-day window (a delta, never a full sync), refresh channel lists,
 *   prune the call log and events older than 60 days, raise needs_unit alerts for unassigned arrivals within 48 h,
 *   [M2/M6] re-run unit assignment for the next 14 days (hook below), then a normal tick.
 * Answers {ok, task, ...summary}. Never returns keys or payloads.
 */
import { send, cors, readJson, bearer } from './_lib/http.js';
import { requireAdminClient } from './_lib/supabase.js';
import { channexConfig, safeEqual, channelView } from './_lib/channex.js';
import { must, tracked, records, addAlert, todayMY, addDays } from './_lib/channex-db.js';
import { runWorker, markLastDay, CONNECTED } from './_lib/channex-sync.js';

export const TICK_BUDGET_MS = 15000;
const PRUNE_DAYS = 60;

/* ---------- [M6] bookings inbound: hooks for the next milestone ---------- */
// M6 (api/_lib/channex-bookings.js) plugs in here: retry channex_events with status 'new'/'error' and channex_revisions
// saved but not acked, then poll the feed (channex_meta.last_feed_poll_at older than 15 minutes). Until then both are
// no-ops, so the tick only sends ARI.
export const bookingHooks = {
  async retryInbound(sb, opts) { return { skipped: 'M6' }; }, // eslint-disable-line no-unused-vars
  async pollFeed(sb, opts) { return { skipped: 'M6' }; }, // eslint-disable-line no-unused-vars
  async reassignUpcoming(sb, opts) { return { skipped: 'M2/M6' }; } // eslint-disable-line no-unused-vars
};

export async function tick(sb, opts = {}) {
  const cfg = opts.config || channexConfig();
  const start = Date.now();
  const out = { inbound: await bookingHooks.retryInbound(sb, { config: cfg }), feed: await bookingHooks.pollFeed(sb, { config: cfg }) };
  const budget = Math.max(3000, (opts.budgetMs || TICK_BUDGET_MS) - (Date.now() - start));
  out.ari = summary(await runWorker(sb, { config: cfg, budgetMs: budget, request: opts.request, quietMs: opts.quietMs }));
  return out;
}

const summary = (r) => ({ properties: r.properties, calls: r.calls, sent: r.sent, waiting: r.waiting, errors: r.errors, pending: r.pending, waitingUntil: r.waitingUntil, setup: r.setup || null });

export async function nightly(sb, opts = {}) {
  const cfg = opts.config || channexConfig();
  const out = {};
  out.marked = await markLastDay(sb, { config: cfg });
  out.reassign = await bookingHooks.reassignUpcoming(sb, { config: cfg });
  out.channels = await refreshChannels(sb, cfg, opts);
  out.pruned = await prune(sb);
  out.needsUnit = await flagNeedsUnit(sb, cfg);
  // the nightly marks are not someone's edit in progress: no quiet window
  out.tick = await tick(sb, Object.assign({}, opts, { budgetMs: 10000, quietMs: 0 }));
  return out;
}

/** Refresh the cached channel list of every connected property (skipped on errors; tomorrow tries again). */
async function refreshChannels(sb, cfg, opts) {
  const props = must(await sb.from('channex_properties').select('org_id, channex_property_id, channels').eq('env', cfg.env).in('status', CONNECTED), 'load properties') || [];
  let n = 0;
  for (const p of props.slice(0, 30)) {
    try {
      const res = await tracked(sb, cfg, { method: 'GET', path: '/channels', query: { 'filter[property_id]': p.channex_property_id, 'pagination[limit]': 100 }, orgId: p.org_id, propertyId: p.channex_property_id, source: 'channels', request: opts.request });
      const list = (Array.isArray(res.data) ? res.data : []).map(channelView);
      const before = new Map((Array.isArray(p.channels) ? p.channels : []).map((c) => [c.id, c]));
      for (const c of before.values()) {
        const now = list.find((x) => x.id === c.id);
        if (c.isActive && (!now || !now.isActive)) {
          await addAlert(sb, { orgId: p.org_id, kind: 'channel_disconnected', message: `${c.title || c.channel || 'A channel'} is no longer active.`, ref: { key: 'channel:' + c.id, channelId: c.id, propertyId: p.channex_property_id } });
        }
      }
      must(await sb.from('channex_properties').update({ channels: list }).eq('channex_property_id', p.channex_property_id), 'save channels');
      n++;
    } catch (e) {
      console.error('[channex] channels', p.channex_property_id + ':', e && e.message ? e.message : String(e));
    }
  }
  return n;
}

async function prune(sb) {
  const before = new Date(Date.now() - PRUNE_DAYS * 86400000).toISOString();
  const calls = await sb.from('channex_calls').delete({ count: 'exact' }).lt('at', before);
  const events = await sb.from('channex_events').delete({ count: 'exact' }).lt('received_at', before).in('status', ['done', 'ignored']);
  if (calls.error) console.error('[channex] prune calls:', calls.error.message);
  if (events.error) console.error('[channex] prune events:', events.error.message);
  return { calls: calls.count || 0, events: events.count || 0 };
}

/** Bookings without a unit arriving within 48 hours, for workspaces with a connected building. */
async function flagNeedsUnit(sb, cfg) {
  const props = must(await sb.from('channex_properties').select('org_id').eq('env', cfg.env).in('status', CONNECTED), 'load properties') || [];
  const t0 = todayMY();
  const t2 = addDays(t0, 2);
  let n = 0;
  for (const orgId of [...new Set(props.map((p) => p.org_id))]) {
    const list = await records(sb, orgId, 'bookings', (q) => q.eq('data->>needsUnit', 'true').gte('data->>checkIn', t0).lte('data->>checkIn', t2));
    for (const b of list) {
      if (['cancelled', 'deleted'].includes(b.status) || b.propertyId) continue;
      if (await addAlert(sb, { orgId, kind: 'needs_unit', message: `Booking ${b.reservationCode || b.id} arrives on ${b.checkIn} and has no unit yet.`, ref: { key: 'needs_unit:' + b.id, bookingId: b.id, urgent: true } })) n++;
    }
  }
  return n;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, { ok: false, error: 'method', message: 'Use POST for this address.' });
    }
    const cfg = channexConfig();
    // no secret configured -> nobody gets in (safeEqual refuses empty strings)
    if (!safeEqual(bearer(req), cfg.workerSecret)) return send(res, 401, { ok: false, error: 'not-signed-in', message: 'Not allowed.' });
    const body = await readJson(req);
    const task = body.task === 'nightly' ? 'nightly' : body.task === 'tick' || body.task === undefined ? 'tick' : null;
    if (!task) return send(res, 400, { ok: false, error: 'bad-task', message: 'Unknown task.' });
    if (!cfg.key) return send(res, 200, { ok: true, task, skipped: 'not-configured' });
    const sb = requireAdminClient();
    const result = task === 'nightly' ? await nightly(sb, { config: cfg }) : await tick(sb, { config: cfg });
    return send(res, 200, Object.assign({ ok: true, task }, result));
  } catch (err) {
    console.error('[channex] worker:', err && err.message ? err.message : String(err));
    return send(res, 500, { ok: false, error: 'server', message: 'The worker failed; it runs again in a minute.' });
  }
}
