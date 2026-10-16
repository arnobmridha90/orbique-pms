/* Channex ARI outbound: availability and rates/restrictions from the outbox to Channex (plan sections 4 and 5).
 * Private module: Vercel does not expose files under api/_lib as endpoints.
 *
 * Pure (unit-tested):
 *   compressValues(rows)                   consecutive dates with equal values -> date_from/date_to runs
 *   diffValues(computed, state, {full})    only what changed since Channex last accepted it, field by field
 *   rejectedItems(warnings, items, ids)    which items of a call Channex dropped (meta.warnings), as target dates
 *   restrictionValue(plan, day, opts)      what one date of a rate plan means for Channex
 *   backoffMs(level)                       429 pause: 60 s x 2^level, at most 16 minutes
 *   toItems(kind, propertyId, runs, ids)   runs -> Channex `values` items
 * With the database:
 *   computeAvailability(sb, prop, marks, ctx), computeRestrictions(sb, prop, marks, ctx)
 *   sendProperty(sb, prop, {kind, full, ...})   one batched call for one kind (claim -> compute -> diff -> send)
 *   fullSync(sb, prop, opts)                    500 days: one availability call + one restrictions call
 *   runWorker(sb, opts)                         setup queue, then every property with marks or a full-sync request
 *   markLastDay(sb, opts)                       nightly: the day that just came into the 500-day window
 *   forceMarks(sb, propertyId)                  resume: pending marks go out with complete values
 *   resendRejected(sb, prop, opts)              Send again: dates Channex dropped (rate_warning alerts) are marked again
 *
 * Outbox protocol (0006): claim marks (claimed_at) -> compute values -> send -> delete the claimed marks on success,
 * release them (claimed_at = null) on any failure, so no change is ever lost. A change made after the claim gets its
 * own new mark (the triggers never coalesce into a claimed mark).
 * Failures (plan 4): 429 -> paused_until = now + backoffMs(backoff_level), level + 1; 5xx / network -> pause 60 s;
 * other 4xx -> status 'error' + sync_error alert (marks kept for Retry).
 * meta.warnings (Channex drops an invalid item but still answers 200): the dropped dates are not saved as accepted and a
 * rate_warning alert names them. Their marks are cleared (the same value would only be refused again); Send again
 * (Retry) or the next change to those dates sends them again.
 * A forced mark (0009: after a booking revision, the nightly new day, resume, Send again) sends the complete value for
 * its dates even when it equals what Channex last accepted.
 */
import { channexConfig, ChannexError, taskIds as taskIdsOf, warnings as warningsOf } from './channex.js';
import { must, selectAll, records, archived, tracked, addAlert, todayMY, addDays, dateRange, isIso, STATE_DAYS } from './channex-db.js';
import { processSetupQueue, pendingSetupRefs } from './channex-setup.js';

export const KINDS = ['availability', 'restrictions'];
export const ENDPOINT = { availability: '/availability', restrictions: '/restrictions' };
export const BACKOFF_BASE_MS = 60 * 1000;
export const BACKOFF_MAX_MS = 16 * 60 * 1000;
export const RETRY_PAUSE_MS = 60 * 1000;
export const CLAIM_LEASE_MS = 2 * 60 * 1000; // a claim older than this (a run that died) may be claimed again
export const PROPERTY_LEASE_S = 60;
export const CONNECTED = ['syncing', 'live', 'paused', 'error'];
export const SENDING = ['syncing', 'live'];

/* ---------- pure helpers ---------- */

/** JSON with sorted keys, so {a, b} and {b, a} compare equal. */
export function stableKey(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(stableKey).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stableKey(v[k])).join(',') + '}';
}

/** 429 pause for a backoff level (0 for the first 429): 60 s, 2, 4, 8, 16 min, then 16 min. */
export function backoffMs(level) {
  const n = Math.max(0, Math.min(30, Math.floor(Number(level) || 0)));
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** n);
}

/**
 * Merge consecutive dates of the same target with equal values.
 *   rows [{target_id, date: 'YYYY-MM-DD', value}] in any order (one row per target and date)
 *   ->   [{target_id, date_from, date_to, value}] ordered by target, then date
 */
export function compressValues(rows) {
  const sorted = (rows || []).filter((r) => r && r.target_id !== undefined && isIso(r.date))
    .map((r) => ({ t: String(r.target_id), d: r.date, k: stableKey(r.value), v: r.value }))
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const out = [];
  let cur = null;
  for (const r of sorted) {
    if (cur && cur.target_id === r.t && cur.key === r.k && addDays(cur.date_to, 1) === r.d) { cur.date_to = r.d; continue; }
    if (cur && cur.target_id === r.t && cur.date_to === r.d) continue; // duplicate date: first one wins
    cur = { target_id: r.t, date_from: r.d, date_to: r.d, value: r.v, key: r.k };
    out.push(cur);
  }
  return out.map(({ key, ...rest }) => rest);
}

/**
 * What changed: for each computed {target_id, date, value} (value: an object of fields), the fields that differ from
 * what Channex last accepted (state: Map `${target_id}|${date}` -> value object). A date Channex never got (or whose
 * state was invalidated) is sent whole; full: send everything; whole: a changed date keeps all its fields. The sender
 * sends only the changed fields (certification test 13: only changed values), so a range edit is one item whenever
 * the change is the same over the range. Rows with nothing changed are left out.
 * A row's `sent` {at, f: [fields]} names the fields a person set on that date (the calendar's Send): when it is newer
 * than what Channex last accepted (sentAt: Map `${target_id}|${date}` -> ISO time), those fields go out even when equal
 * (certification tests 7 and 8 expect every field the person entered, over the whole range they entered).
 */
export function diffValues(computed, state, { full = false, whole = false, sentAt } = {}) {
  const out = [];
  for (const r of computed || []) {
    const key = r.target_id + '|' + r.date;
    const old = full ? undefined : state && state.get(key);
    if (!old || typeof old !== 'object') { out.push({ target_id: r.target_id, date: r.date, value: Object.assign({}, r.value) }); continue; }
    const delta = {};
    const last = sentAt && sentAt.get(key);
    const keep = r.sent && Array.isArray(r.sent.f) && (!last || String(r.sent.at || '') > String(last)) ? r.sent.f : [];
    for (const [k, v] of Object.entries(r.value || {})) if (keep.includes(k) || stableKey(old[k]) !== stableKey(v)) delta[k] = v;
    if (Object.keys(delta).length) out.push({ target_id: r.target_id, date: r.date, value: whole ? Object.assign({}, r.value) : delta });
  }
  return out;
}

const pick = (o, keys) => { if (!o || typeof o !== 'object') return undefined; for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };
const bool = (v) => v === true || v === 1 || v === 'true' || v === '1';
const num = (v) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const posInt = (v) => { const n = num(v); return n !== null && Number.isInteger(n) && n >= 1 ? n : null; };
const nonNegInt = (v) => { const n = num(v); return n !== null && Number.isInteger(n) && n >= 0 ? n : null; };

/** A plan's own rate for a date: the day's rate, else a derived plan's parent rate with its rule, else defaultRate. */
export function planRate(plan, day, ctx = {}, depth = 0) {
  const own = num(pick(day, ['rate']));
  if (own !== null) return own;
  const f = plan && plan.follows;
  if (f && typeof f === 'object' && f.planId && depth < 5 && ctx.plans && ctx.plans.get(f.planId)) {
    const parent = ctx.plans.get(f.planId);
    const pr = planRate(parent, ctx.dayOf ? ctx.dayOf(f.planId) : undefined, ctx, depth + 1);
    const v = num(f.value) || 0;
    if (pr !== null) return Math.round((f.type === 'amount' ? pr + v : pr * (1 + v / 100)) * 100) / 100;
  }
  return num(plan && plan.defaultRate);
}

/**
 * Channex fields for one date of a rate plan (plan 2.1 channelRates.days[iso] = {rate, minStay, maxStay, cta, ctd, stopSell}).
 * Every field is always present except rate (left out when there is none), so the state diff is field by field.
 *   opts {retired: plan or its unit type archived -> stop_sell, ctx (for derived plans)}
 */
export function restrictionValue(plan, day, opts = {}) {
  const d = day && typeof day === 'object' ? day : {};
  const p = plan || {};
  const out = {};
  const rate = planRate(p, d, opts.ctx || {});
  if (rate !== null) out.rate = rate.toFixed(2);
  out.min_stay_arrival = posInt(pick(d, ['minStay', 'min_stay', 'minStayArrival', 'min_stay_arrival'])) || posInt(p.minStay) || 1;
  const ms = nonNegInt(pick(d, ['maxStay', 'max_stay']));
  out.max_stay = ms !== null ? ms : nonNegInt(p.maxStay) || 0;
  out.closed_to_arrival = bool(pick(d, ['cta', 'closedToArrival', 'closed_to_arrival']));
  out.closed_to_departure = bool(pick(d, ['ctd', 'closedToDeparture', 'closed_to_departure']));
  out.stop_sell = !!opts.retired || bool(pick(d, ['stopSell', 'stop_sell', 'closed']));
  return out;
}

/** Runs -> Channex `values`. ids: Map target_id -> Channex room_type_id / rate_plan_id. One date -> `date`, else a range. */
export function toItems(kind, propertyId, runs, ids) {
  const idKey = kind === 'availability' ? 'room_type_id' : 'rate_plan_id';
  const out = [];
  for (const r of runs) {
    const cid = ids.get(r.target_id);
    if (!cid) continue;
    const item = { property_id: propertyId, [idKey]: cid };
    if (r.date_from === r.date_to) item.date = r.date_from;
    else { item.date_from = r.date_from; item.date_to = r.date_to; }
    out.push(Object.assign(item, r.value));
  }
  return out;
}

/**
 * The items of a call that Channex dropped. Each warning echoes the item it refused (rate_plan_id or room_type_id,
 * date or date_from/date_to; fields that were not sent are null) with a `warning` map of field -> messages.
 *   warns  meta.warnings; items  the `values` sent; ids  Map Channex id -> Orbique target id
 * -> {rejected: [{target_id, date_from, date_to, why}], keys: Set `${target_id}|${date}`,
 *     unmatched: warnings that match no item (then nothing in the call can be taken as accepted)}
 */
export function rejectedItems(warns, items, ids) {
  const out = { rejected: [], keys: new Set(), unmatched: 0 };
  const why = (w) => (w.warning && typeof w.warning === 'object' ? Object.entries(w.warning).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(', ') : v}`).join('; ') : '');
  for (const w of warns || []) {
    const key = w && typeof w === 'object' ? (w.rate_plan_id ? 'rate_plan_id' : w.room_type_id ? 'room_type_id' : null) : null;
    const hits = key ? (items || []).filter((it) => {
      if (it[key] !== w[key]) return false;
      const a = it.date || it.date_from;
      const b = it.date || it.date_to;
      if (w.date) return a <= w.date && w.date <= b;
      if (w.date_from || w.date_to) return a === (w.date_from || w.date_to) && b === (w.date_to || w.date_from);
      return true;
    }) : [];
    const mapped = hits.filter((it) => ids.has(it[key]));
    if (!mapped.length) { out.unmatched++; continue; }
    for (const it of mapped) {
      const target = ids.get(it[key]);
      const a = w.date || it.date || it.date_from;
      const b = w.date || it.date || it.date_to;
      out.rejected.push({ target_id: target, date_from: a, date_to: b, why: why(w) });
      for (const d of dateRange(a, b)) out.keys.add(target + '|' + d);
    }
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayText = (iso) => Number(iso.slice(8, 10)) + ' ' + MONTHS[Number(iso.slice(5, 7)) - 1] + ' ' + iso.slice(0, 4);
/** "21 Nov 2026", or "1 Nov 2026 to 10 Nov 2026". */
export const datesText = (a, b) => (a === b ? dayText(a) : dayText(a) + ' to ' + dayText(b));

/** Marks -> Map target_id -> Set of dates (clipped to the window). */
export function markDates(marks, from, to) {
  const out = new Map();
  for (const m of marks || []) {
    const a = m.date_from > from ? m.date_from : from;
    const b = m.date_to < to ? m.date_to : to;
    if (!isIso(a) || !isIso(b) || a > b) continue;
    const set = out.get(m.target_id) || new Set();
    for (const d of dateRange(a, b)) set.add(d);
    out.set(m.target_id, set);
  }
  return out;
}

/* ---------- context: mappings and records of one property ---------- */

/** {roomTypes: Map unit_type_id -> row, ratePlans: Map plan_id -> row, unitTypes: Map, plans: Map, typeIds: [], planIds: []} */
export async function loadContext(sb, prop, cfg) {
  const rts = must(await sb.from('channex_room_types').select('unit_type_id, room_type_id, retired').eq('channex_property_id', prop.channex_property_id).eq('env', cfg.env), 'load room types');
  const typeIds = rts.map((r) => r.unit_type_id);
  const rps = typeIds.length ? must(await sb.from('channex_rate_plans').select('plan_id, unit_type_id, rate_plan_id, retired').eq('org_id', prop.org_id).eq('env', cfg.env).in('unit_type_id', typeIds), 'load rate plans') : [];
  const [types, plans] = typeIds.length ? await Promise.all([
    records(sb, prop.org_id, 'unitTypes', (q) => q.in('id', typeIds)),
    records(sb, prop.org_id, 'ratePlans', (q) => q.in('data->>unitTypeId', typeIds))
  ]) : [[], []];
  // parents of derived plans may live under another type
  const planMap = new Map(plans.map((p) => [p.id, p]));
  const parents = [...new Set(plans.map((p) => p.follows && p.follows.planId).filter((id) => id && !planMap.has(id)))];
  if (parents.length) for (const p of await records(sb, prop.org_id, 'ratePlans', (q) => q.in('id', parents))) planMap.set(p.id, p);
  return {
    roomTypes: new Map(rts.filter((r) => r.room_type_id).map((r) => [r.unit_type_id, r])),
    ratePlans: new Map(rps.filter((r) => r.rate_plan_id).map((r) => [r.plan_id, r])),
    unitTypes: new Map(types.map((t) => [t.id, t])),
    plans: planMap
  };
}

/* ---------- compute ---------- */

/**
 * Availability per unit type and date for the marked dates (plan 2.2, channex_type_availability). A retired or archived
 * unit type sends 0. Resolves {rows: [{target_id, date, value: {availability}}], oversold: [{target_id, dates}]}.
 */
export async function computeAvailability(sb, prop, dates, ctx) {
  const rows = [];
  const oversold = [];
  for (const [typeId, set] of dates) {
    const map = ctx.roomTypes.get(typeId);
    if (!map) continue;
    const list = [...set].sort();
    if (!list.length) continue;
    const type = ctx.unitTypes.get(typeId);
    const closed = map.retired || !type || archived(type);
    let got = new Map();
    if (!closed) {
      const res = await sb.rpc('channex_type_availability', { p_org: prop.org_id, p_unit_type: typeId, p_from: list[0], p_to: list[list.length - 1] });
      for (const r of must(res, 'availability') || []) got.set(String(r.date).slice(0, 10), r);
    }
    const over = [];
    for (const d of list) {
      const r = got.get(d);
      const n = closed || !r ? 0 : Math.max(0, Number(r.availability) || 0);
      if (r && Number(r.raw) < 0) over.push(d);
      rows.push({ target_id: typeId, date: d, value: { availability: n } });
    }
    if (over.length) oversold.push({ target_id: typeId, dates: over });
  }
  return { rows, oversold };
}

/** Load the channelRates days of some plans: Map planId -> {iso: day}. Records are one per plan per month. */
export async function loadDays(sb, orgId, planIds) {
  const out = new Map();
  if (!planIds.length) return out;
  const rows = await records(sb, orgId, 'channelRates', (q) => q.in('data->>planId', planIds));
  for (const r of rows) {
    if (!r.planId || !r.days || typeof r.days !== 'object' || Array.isArray(r.days)) continue;
    const days = out.get(r.planId) || {};
    for (const [iso, v] of Object.entries(r.days)) if (isIso(iso) && v && typeof v === 'object') days[iso] = v;
    out.set(r.planId, days);
  }
  return out;
}

/**
 * Rates and restrictions per rate plan and date for the marked dates. rate = days[iso].rate ?? (derived) ?? defaultRate.
 * A plan that is archived, deleted, retired, or whose unit type is, goes out with stop_sell.
 * Resolves {rows: [{target_id, date, value}]}.
 */
export async function computeRestrictions(sb, prop, dates, ctx) {
  const targets = [...dates.keys()].filter((id) => ctx.ratePlans.has(id));
  const parents = targets.map((id) => ctx.plans.get(id)).filter((p) => p && p.follows && p.follows.planId).map((p) => p.follows.planId);
  const days = await loadDays(sb, prop.org_id, [...new Set([...targets, ...parents])]);
  const rows = [];
  for (const planId of targets) {
    const plan = ctx.plans.get(planId);
    const map = ctx.ratePlans.get(planId);
    const type = plan && ctx.unitTypes.get(plan.unitTypeId);
    const rtm = plan && ctx.roomTypes.get(plan.unitTypeId);
    const retired = !plan || archived(plan) || map.retired || !type || archived(type) || !rtm || rtm.retired;
    const own = days.get(planId) || {};
    for (const d of [...dates.get(planId)].sort()) {
      const c = { plans: ctx.plans, dayOf: (pid) => (days.get(pid) || {})[d] };
      const row = { target_id: planId, date: d, value: restrictionValue(plan || {}, own[d], { retired, ctx: c }) };
      const sent = own[d] && own[d].sent;
      if (sent && typeof sent === 'object' && Array.isArray(sent.f)) row.sent = { at: String(sent.at || ''), f: sent.f.filter((k) => k in row.value) };
      rows.push(row);
    }
  }
  return { rows };
}

/* ---------- outbox ---------- */

const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

/** Claim marks of one property and kind. all: ignore the quiet window (full sync, flush). */
export async function claimMarks(sb, pid, kind, { quietMs = 5000, all = false } = {}) {
  const now = Date.now();
  // claims older than the lease belong to a run that died: free them first. (Not one or= filter on the claim itself:
  // PostgREST re-applies an or= filter to the rows a PATCH returns, and a just-claimed row no longer matches it.)
  must(await sb.from('channex_outbox').update({ claimed_at: null }).eq('channex_property_id', pid).eq('kind', kind)
    .lt('claimed_at', new Date(now - CLAIM_LEASE_MS).toISOString()), 'free stale claims');
  let q = sb.from('channex_outbox').update({ claimed_at: new Date(now).toISOString() })
    .eq('channex_property_id', pid).eq('kind', kind).is('claimed_at', null);
  if (!all && quietMs > 0) q = q.lt('created_at', new Date(now - quietMs).toISOString());
  return must(await q.select('id, target_id, date_from, date_to, force'), 'claim marks') || [];
}

export async function releaseMarks(sb, ids) {
  for (const part of chunks(ids, 300)) must(await sb.from('channex_outbox').update({ claimed_at: null }).in('id', part), 'release marks');
}

export async function deleteMarks(sb, ids) {
  for (const part of chunks(ids, 300)) must(await sb.from('channex_outbox').delete().in('id', part), 'clear marks');
}

/** What Channex last accepted: Map `${target}|${date}` -> value, with out.sentAt: Map of the same keys -> when. */
async function loadState(sb, pid, kind, targets, from, to) {
  const out = new Map();
  out.sentAt = new Map();
  if (!targets.length) return out;
  const rows = await selectAll(() => sb.from('channex_state').select('target_id, date, value, sent_at').eq('channex_property_id', pid).eq('kind', kind)
    .in('target_id', targets).gte('date', from).lte('date', to).order('target_id').order('date'), 'load state');
  for (const r of rows) {
    const k = r.target_id + '|' + String(r.date).slice(0, 10);
    out.set(k, r.value);
    if (r.sent_at) out.sentAt.set(k, new Date(r.sent_at).toISOString());
  }
  return out;
}

async function saveState(sb, prop, kind, rows, callId) {
  const at = new Date().toISOString();
  const list = rows.map((r) => ({ org_id: prop.org_id, channex_property_id: prop.channex_property_id, kind, target_id: r.target_id, date: r.date, value: r.value, sent_at: at, call_id: callId || null }));
  for (const part of chunks(list, 1000)) must(await sb.from('channex_state').upsert(part, { onConflict: 'channex_property_id,kind,target_id,date' }), 'save state');
}

async function updateProperty(sb, pid, patch) {
  must(await sb.from('channex_properties').update(Object.assign({ updated_at: new Date().toISOString() }, patch)).eq('channex_property_id', pid), 'update property');
}

/* ---------- send ---------- */

/**
 * One kind for one property: claim -> compute -> diff -> compress -> take a slot -> POST -> state / backoff.
 *   opts {kind, full, quietMs, source, config, request, ctx, pendingRefs: Set (setup work about to map a target)}
 * Resolves {status: 'idle'|'nothing'|'sent'|'waiting'|'rate_limited'|'retry'|'error', items, taskIds, callId, until, error}
 */
export async function sendProperty(sb, prop, opts) {
  const cfg = opts.config || channexConfig();
  const kind = opts.kind;
  const pid = prop.channex_property_id;
  const ctx = opts.ctx || await loadContext(sb, prop, cfg);
  const full = !!opts.full;
  const t0 = todayMY();
  const last = addDays(t0, STATE_DAYS - 1);

  const marks = await claimMarks(sb, pid, kind, { quietMs: opts.quietMs === undefined ? 5000 : opts.quietMs, all: full });
  if (!full && !marks.length) return { status: 'idle' };
  const ids = marks.map((m) => m.id);
  const mapping = kind === 'availability' ? ctx.roomTypes : ctx.ratePlans;
  try {
    let dates;
    if (full) {
      dates = new Map();
      const all = dateRange(t0, last);
      for (const target of mapping.keys()) dates.set(target, new Set(all));
    } else {
      // marks for targets without a mapping: keep them while setup is about to create the mapping, else drop them
      const unmapped = marks.filter((m) => !mapping.has(m.target_id));
      if (unmapped.length) {
        const pending = opts.pendingRefs || await pendingSetupRefs(sb, prop.org_id);
        const keep = unmapped.filter((m) => pending.has(m.target_id)).map((m) => m.id);
        const drop = unmapped.filter((m) => !pending.has(m.target_id)).map((m) => m.id);
        if (keep.length) await releaseMarks(sb, keep);
        if (drop.length) await deleteMarks(sb, drop);
        const gone = new Set(unmapped.map((m) => m.id));
        for (let i = ids.length - 1; i >= 0; i--) if (gone.has(ids[i])) ids.splice(i, 1);
      }
      dates = markDates(marks.filter((m) => mapping.has(m.target_id)), t0, last);
    }

    const computed = kind === 'availability' ? await computeAvailability(sb, prop, dates, ctx) : await computeRestrictions(sb, prop, dates, ctx);
    if (computed.oversold && computed.oversold.length) {
      for (const o of computed.oversold) {
        const t = ctx.unitTypes.get(o.target_id);
        await addAlert(sb, { orgId: prop.org_id, kind: 'double_booking', message: `${t && t.name ? t.name : 'A unit type'} has more bookings than units on ${o.dates.slice(0, 5).join(', ')}${o.dates.length > 5 ? ' and ' + (o.dates.length - 5) + ' more nights' : ''}.`, ref: { key: 'oversold:' + o.target_id, unitTypeId: o.target_id, dates: o.dates.slice(0, 60) } });
      }
    }
    let rows = computed.rows;
    let delta = rows;
    if (!full && rows.length) {
      const targets = [...new Set(rows.map((r) => r.target_id))];
      const from = rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date);
      const to = rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date);
      const state = await loadState(sb, pid, kind, targets, from, to);
      // forced marks: Channex may no longer hold what it last accepted from Orbique, so these dates go out whole
      for (const [t, set] of markDates(marks.filter((m) => m.force), t0, last)) for (const d of set) state.delete(t + '|' + d);
      delta = diffValues(rows, state, { sentAt: state.sentAt });
    }
    const runs = compressValues(delta);
    const idMap = new Map([...mapping].map(([k, v]) => [k, kind === 'availability' ? v.room_type_id : v.rate_plan_id]));
    const items = toItems(kind, pid, runs, idMap);
    if (!items.length) {
      await deleteMarks(sb, ids);
      return { status: 'nothing', items: [] };
    }

    const slot = must(await sb.rpc('channex_take_slot', { p_property: pid, p_endpoint: ENDPOINT[kind], p_source: full ? 'full' : opts.source || 'delta' }), 'take slot');
    if (!slot) { await releaseMarks(sb, ids); return { status: 'waiting', items: [] }; }

    let res;
    try {
      res = await tracked(sb, cfg, { method: 'POST', path: ENDPOINT[kind], body: { values: items }, orgId: prop.org_id, propertyId: pid, source: full ? 'full' : opts.source || 'delta', callId: slot, taskIds: taskIdsOf, warnings: warningsOf, request: opts.request, timeoutMs: 20000 });
    } catch (e) {
      await releaseMarks(sb, ids);
      return await failed(sb, prop, e);
    }
    const tids = taskIdsOf(res);
    const warns = warningsOf(res);
    // what Channex dropped is not what it holds: those dates stay out of the state (a warning that matches no item
    // keeps the whole call out), so Send again or the next change sends them again
    const byChannexId = new Map([...idMap].map(([k, v]) => [v, k]));
    const rej = rejectedItems(warns, items, byChannexId);
    const changed = new Set(delta.map((r) => r.target_id + '|' + r.date));
    const accepted = rej.unmatched ? [] : rows.filter((r) => changed.has(r.target_id + '|' + r.date) && !rej.keys.has(r.target_id + '|' + r.date));
    await saveState(sb, prop, kind, accepted, slot);
    await deleteMarks(sb, ids);
    const patch = { backoff_level: 0, paused_until: null, last_error: null };
    await updateProperty(sb, pid, patch);
    Object.assign(prop, patch);
    if (warns.length) await warnAlert(sb, prop, kind, ctx, { rej, warns, items, byChannexId, callId: slot });
    return { status: 'sent', items, taskIds: tids, warnings: warns, rejected: rej.rejected, callId: slot };
  } catch (e) {
    // anything unexpected (database, compute): give the marks back
    try { await releaseMarks(sb, ids); } catch (e2) { /* the claim lease frees them */ }
    throw e;
  }
}

/**
 * The rate_warning alert for a call with meta.warnings: which dates Channex did not take, and why. ref.items is what
 * Send again (the retry action) marks again; a warning that matches no item puts every item of the call there.
 */
async function warnAlert(sb, prop, kind, ctx, { rej, warns, items, byChannexId, callId }) {
  const nameOf = (target) => {
    if (kind === 'availability') { const t = ctx.unitTypes.get(target); return (t && t.name) || 'A unit type'; }
    const p = ctx.plans.get(target);
    const t = p && ctx.unitTypes.get(p.unitTypeId);
    return [t && t.name, p && p.name].filter(Boolean).join(' · ') || 'A rate plan';
  };
  const what = kind === 'availability' ? 'availability' : 'rate and restriction';
  const idKey = kind === 'availability' ? 'room_type_id' : 'rate_plan_id';
  let message;
  let list;
  if (rej.unmatched) {
    message = `Channex did not accept ${warns.length} of the ${items.length} ${what} updates and did not say which. Booking sites may still show the old values. Press Send again to send this update again.`;
    list = items.filter((it) => byChannexId.has(it[idKey])).map((it) => ({ target_id: byChannexId.get(it[idKey]), date_from: it.date || it.date_from, date_to: it.date || it.date_to }));
  } else {
    const parts = rej.rejected.slice(0, 6).map((r) => `${nameOf(r.target_id)}, ${datesText(r.date_from, r.date_to)}${r.why ? ' (' + r.why + ')' : ''}`);
    const more = rej.rejected.length > 6 ? ` and ${rej.rejected.length - 6} more` : '';
    message = `Channex did not accept ${rej.rejected.length} of the ${items.length} ${what} updates: ${parts.join('; ')}${more}. Booking sites keep their old values for these dates. Fix the value, then press Send again.`;
    list = rej.rejected.map((r) => ({ target_id: r.target_id, date_from: r.date_from, date_to: r.date_to }));
  }
  await addAlert(sb, { orgId: prop.org_id, kind: 'rate_warning', message, ref: { key: 'warn:' + callId, callId, propertyId: prop.channex_property_id, buildingId: prop.building_id || null, kind, count: warns.length, items: list.slice(0, 200) } });
}

/** A failed send: 429 back off, 5xx / network pause a minute, other 4xx stop with an alert. */
async function failed(sb, prop, e) {
  const pid = prop.channex_property_id;
  const now = Date.now();
  const msg = e && e.message ? e.message : String(e);
  if (e instanceof ChannexError && e.kind === 'rate_limited') {
    const level = Number(prop.backoff_level) || 0;
    const until = new Date(now + backoffMs(level)).toISOString();
    const patch = { paused_until: until, backoff_level: level + 1, last_error: 'Waiting: Channex rate limit', last_error_at: new Date(now).toISOString() };
    await updateProperty(sb, pid, patch);
    Object.assign(prop, patch);
    return { status: 'rate_limited', until, error: msg };
  }
  if (!(e instanceof ChannexError) || e.retryable) {
    const until = new Date(now + RETRY_PAUSE_MS).toISOString();
    const patch = { paused_until: until, last_error: msg.slice(0, 500), last_error_at: new Date(now).toISOString() };
    await updateProperty(sb, pid, patch);
    Object.assign(prop, patch);
    return { status: 'retry', until, error: msg };
  }
  const patch = { status: 'error', last_error: msg.slice(0, 500), last_error_at: new Date(now).toISOString() };
  await updateProperty(sb, pid, patch);
  Object.assign(prop, patch);
  await addAlert(sb, { orgId: prop.org_id, kind: 'sync_error', message: 'Channex refused an update: ' + msg + ' Fix it, then press Retry on the Channels page.', ref: { key: 'sync:' + pid, propertyId: pid, status: e.status, code: e.code } });
  return { status: 'error', error: msg };
}

/**
 * Full sync (certification test 1): 500 days of availability for every room type in one call, then 500 days of
 * rates and restrictions for every rate plan in one call. Progress is kept in full_sync_task_ids, so a run that stops
 * after the first call only sends the second next time.
 */
export async function fullSync(sb, prop, opts = {}) {
  const cfg = opts.config || channexConfig();
  const ctx = opts.ctx || await loadContext(sb, prop, cfg);
  const reqAt = prop.full_sync_requested_at || null;
  const prev = prop.full_sync_task_ids && typeof prop.full_sync_task_ids === 'object' ? prop.full_sync_task_ids : null;
  const done = prev && prev.requestedAt === reqAt ? Object.assign({}, prev) : { requestedAt: reqAt };
  let calls = 0;
  for (const kind of KINDS) {
    if (Array.isArray(done[kind])) continue;
    const r = await sendProperty(sb, prop, Object.assign({}, opts, { kind, full: true, ctx, config: cfg }));
    if (r.status !== 'nothing') calls++;
    if (r.status !== 'sent' && r.status !== 'nothing') return Object.assign({ kind, calls }, r);
    done[kind] = r.taskIds || [];
    must(await sb.from('channex_properties').update({ full_sync_task_ids: done }).eq('channex_property_id', prop.channex_property_id), 'save full sync');
    prop.full_sync_task_ids = done;
  }
  const at = new Date().toISOString();
  // only clear the request if nobody asked again meanwhile
  let q = sb.from('channex_properties').update({ full_sync_at: at, full_sync_requested_at: null, status: prop.status === 'syncing' ? 'live' : prop.status, updated_at: at }).eq('channex_property_id', prop.channex_property_id);
  q = reqAt ? q.eq('full_sync_requested_at', reqAt) : q.is('full_sync_requested_at', null);
  must(await q, 'finish full sync');
  if (prop.status === 'syncing') prop.status = 'live';
  prop.full_sync_at = at;
  prop.full_sync_requested_at = null;
  return { status: 'sent', taskIds: done, calls };
}

/* ---------- the worker loop ---------- */

const PROP_COLS = 'org_id, env, building_id, channex_property_id, currency, status, full_sync_requested_at, full_sync_at, full_sync_task_ids, paused_until, backoff_level, lease_until, last_error';

/**
 * Send everything that is due.
 *   opts {budgetMs = 15000, orgId, propertyIds, quietMs = 5000, config, request, setup = true, now}
 * Properties in 'syncing' or 'live' with marks or a full-sync request, not paused (paused_until) and not leased by
 * another run. Resolves {properties, calls, sent, waiting, errors, pending, waitingUntil, results}.
 */
export async function runWorker(sb, opts = {}) {
  const cfg = opts.config || channexConfig();
  const start = Date.now();
  const deadline = start + (opts.budgetMs || 15000);
  const left = () => deadline - Date.now();
  const out = { properties: 0, calls: 0, sent: 0, waiting: 0, errors: 0, pending: 0, waitingUntil: null, results: [] };
  if (!cfg.key) return out;

  if (opts.setup !== false) {
    try { out.setup = await processSetupQueue(sb, { budgetMs: Math.min(5000, Math.max(1000, left() / 3)), orgId: opts.orgId, config: cfg, request: opts.request }); } catch (e) { console.error('[channex] setup queue:', e && e.message); }
  }

  let pq = sb.from('channex_properties').select(PROP_COLS).eq('env', cfg.env).in('status', SENDING);
  if (opts.orgId) pq = pq.eq('org_id', opts.orgId);
  if (opts.propertyIds && opts.propertyIds.length) pq = pq.in('channex_property_id', opts.propertyIds);
  const props = must(await pq.order('updated_at'), 'load properties') || [];
  if (!props.length) return out;
  const marked = new Set((await selectAll(() => {
    let q = sb.from('channex_outbox').select('channex_property_id').in('channex_property_id', props.map((p) => p.channex_property_id));
    return q.order('id');
  }, 'load outbox')).map((r) => r.channex_property_id));

  const now = opts.now || Date.now();
  const noteWait = (iso) => { if (iso && (!out.waitingUntil || iso < out.waitingUntil)) out.waitingUntil = iso; };
  for (const prop of props) {
    if (!prop.full_sync_requested_at && !marked.has(prop.channex_property_id)) continue;
    if (prop.paused_until && Date.parse(prop.paused_until) > now) { out.waiting++; noteWait(prop.paused_until); continue; }
    if (left() < 2500) break;
    const got = must(await sb.rpc('channex_claim', { p_property: prop.channex_property_id, p_lease_seconds: PROPERTY_LEASE_S }), 'lease property');
    if (!got) continue;
    out.properties++;
    try {
      const ctx = await loadContext(sb, prop, cfg);
      const pendingRefs = await pendingSetupRefs(sb, prop.org_id);
      const common = { config: cfg, request: opts.request, ctx, pendingRefs, quietMs: opts.quietMs, source: opts.source };
      const results = [];
      if (prop.full_sync_requested_at) {
        const r = await fullSync(sb, prop, common);
        results.push(Object.assign({ kind: 'full' }, r));
        if (r.status !== 'sent') { tally(out, r); noteWait(r.until); out.results.push({ propertyId: prop.channex_property_id, results }); continue; }
        out.calls += r.calls; out.sent += r.calls;
      }
      for (const kind of KINDS) {
        if (left() < 2000) break;
        const r = await sendProperty(sb, prop, Object.assign({ kind }, common));
        results.push(Object.assign({ kind }, r));
        tally(out, r);
        if (r.until) noteWait(r.until);
        if (['rate_limited', 'retry', 'error', 'waiting'].includes(r.status)) break;
      }
      out.results.push({ propertyId: prop.channex_property_id, results });
    } catch (e) {
      out.errors++;
      console.error('[channex] worker', prop.channex_property_id + ':', e && e.message ? e.message : String(e));
    } finally {
      try { await sb.rpc('channex_claim', { p_property: prop.channex_property_id, p_lease_seconds: 0 }); } catch (e) { /* the lease expires by itself */ }
    }
  }
  const cnt = opts.orgId
    ? await sb.from('channex_outbox').select('id', { count: 'exact', head: true }).eq('org_id', opts.orgId)
    : await sb.from('channex_outbox').select('id', { count: 'exact', head: true }).in('channex_property_id', props.map((p) => p.channex_property_id));
  out.pending = cnt && !cnt.error ? cnt.count || 0 : 0;
  return out;
}

function tally(out, r) {
  if (r.status === 'sent') { out.calls++; out.sent++; }
  else if (r.status === 'waiting' || r.status === 'rate_limited' || r.status === 'retry') { out.waiting++; if (r.status !== 'waiting') out.calls++; }
  else if (r.status === 'error') { out.errors++; out.calls++; }
}

/**
 * Nightly: mark the day that just came into the 500-day window for every mapped room type and rate plan of every
 * connected property (a delta, not a full sync). The marks are forced, so the new day always goes out complete.
 * Resolves the number of marks added.
 */
export async function markLastDay(sb, opts = {}) {
  const cfg = opts.config || channexConfig();
  const day = addDays(todayMY(), STATE_DAYS - 1);
  const props = must(await sb.from('channex_properties').select('org_id, channex_property_id').eq('env', cfg.env).in('status', CONNECTED), 'load properties') || [];
  let n = 0;
  for (const p of props) {
    const rts = must(await sb.from('channex_room_types').select('unit_type_id').eq('channex_property_id', p.channex_property_id).eq('env', cfg.env).eq('retired', false), 'load room types') || [];
    const typeIds = rts.map((r) => r.unit_type_id);
    const rps = typeIds.length ? must(await sb.from('channex_rate_plans').select('plan_id').eq('org_id', p.org_id).eq('env', cfg.env).eq('retired', false).in('unit_type_id', typeIds), 'load rate plans') || [] : [];
    const rows = [
      ...typeIds.map((t) => ({ org_id: p.org_id, channex_property_id: p.channex_property_id, kind: 'availability', target_id: t, date_from: day, date_to: day, reason: 'nightly', force: true })),
      ...rps.map((r) => ({ org_id: p.org_id, channex_property_id: p.channex_property_id, kind: 'restrictions', target_id: r.plan_id, date_from: day, date_to: day, reason: 'nightly', force: true }))
    ];
    if (rows.length) { must(await sb.from('channex_outbox').insert(rows), 'mark last day'); n += rows.length; }
  }
  return n;
}

/** Resume: every pending mark of a property goes out with complete values, not only what differs from the state. */
export async function forceMarks(sb, propertyId) {
  must(await sb.from('channex_outbox').update({ force: true }).eq('channex_property_id', propertyId), 'force marks');
}

/**
 * Send again (the retry action): the items of a property's open rate_warning alerts get forced marks, and those alerts
 * are resolved. Resolves the number of days marked.
 */
export async function resendRejected(sb, prop, { byUser = null } = {}) {
  const open = must(await sb.from('channex_alerts').select('id, ref').eq('org_id', prop.org_id).eq('kind', 'rate_warning')
    .eq('ref->>propertyId', prop.channex_property_id).is('resolved_at', null), 'load warnings') || [];
  let n = 0;
  for (const a of open) {
    const ref = a.ref || {};
    const items = KINDS.includes(ref.kind) && Array.isArray(ref.items) ? ref.items : [];
    for (const it of items) {
      if (!it || !it.target_id || !isIso(it.date_from) || !isIso(it.date_to)) continue;
      n += Number(must(await sb.rpc('channex_invalidate', { p_org: prop.org_id, p_prop: prop.channex_property_id, p_kind: ref.kind, p_target: String(it.target_id), p_from: it.date_from, p_to: it.date_to, p_reason: 'resend' }), 'mark again')) || 0;
    }
    must(await sb.from('channex_alerts').update({ resolved_at: new Date().toISOString(), resolved_by: byUser }).eq('id', a.id), 'resolve warning');
  }
  return n;
}
