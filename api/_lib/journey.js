/* Timed guest messages (api/_lib/shared/journey.cjs): the worker sends the confirmation, the welcome 24 hours before
 * check-in and the check-out reminder by themselves, through the booking's own channel:
 *   Airbnb, Booking.com and Expedia bookings: the booking site's chat (Channex messages)
 *   every other booking with a guest email (Agoda, Trip.com, direct): an email from the workspace's address, so the
 *   guest's answer comes back into the inbox
 *   none of these: not sent (marked 'skipped', so it is not tried again)
 * WhatsApp comes later, once the workspace's number is connected.
 *
 * Each (booking, step) is claimed once in records collection 'journeySent' (id '<bookingId>:<step>') before it is
 * sent, so two worker runs at the same moment never send it twice. A failed send is tried again after RETRY_MIN
 * minutes, at most MAX_TRIES times. A welcome is not sent when the team already sent that guest the door code.
 */
import { createRequire } from 'node:module';
import { must, records, blob, todayMY, addDays } from './channex-db.js';
import { findConv, sendReply, myt, OTA_VIA, VIA_NAME } from './inbox.js';
import { inboundConfig, addressFor } from './email-in.js';

const require = createRequire(import.meta.url);
const J = require('./shared/journey.cjs');
const GM = require('./shared/guestmsg.cjs');

export const BOOKINGS_PER_TICK = 8; // sends per worker run, so a run stays inside its budget
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isEmail = (v) => typeof v === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(v);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** How a booking's timed messages go: {via: 'channex', cxBooking} | {via: 'email', to} | null */
export function routeFor(b, o = {}) {
  const cxId = b && isObj(b.channex) && isUuid(b.channex.bookingId) ? b.channex.bookingId : null;
  if (OTA_VIA[b && b.channel] && cxId && o.channex) return { via: 'channex', cxBooking: cxId };
  const to = b && isObj(b.guest) ? String(b.guest.email || '').trim().toLowerCase() : '';
  if (isEmail(to) && o.email && !(o.ownDomain && to.endsWith('@' + o.ownDomain))) return { via: 'email', to };
  return null;
}

/** Whether the team already sent this guest the door code (a welcome by hand): any staff message with it. */
export function codeAlreadySent(conv, code) {
  const c = String(code || '').trim();
  if (!c || c.length < 3) return false;
  const squash = (s) => String(s || '').replace(/\s+/g, '');
  return (Array.isArray(conv && conv.messages) ? conv.messages : []).some((m) => m && m.from === 'staff' && squash(m.text).includes(squash(c)));
}

async function claim(sb, orgId, id, rows, now) {
  const have = rows.get(id);
  if (have) {
    if (have.state !== 'failed' || (have.tries || 0) >= J.MAX_TRIES || String(have.at || '') > myt(now - J.RETRY_MIN * 60000)) return false;
    const next = Object.assign({}, have, { state: 'sending', tries: (have.tries || 0) + 1, at: myt(now) });
    const r = await sb.from('records').update({ data: next }).eq('org_id', orgId).eq('coll', 'journeySent').eq('id', id).eq('data->>state', 'failed').select('id');
    return !r.error && !!(r.data && r.data.length);
  }
  const data = { id, state: 'sending', tries: 1, at: myt(now) };
  const r = await sb.from('records').insert({ org_id: orgId, coll: 'journeySent', id, data });
  return !r.error; // a duplicate key: another run has it
}

async function settle(sb, orgId, id, patch, now) {
  const r = await sb.from('records').select('data').eq('org_id', orgId).eq('coll', 'journeySent').eq('id', id).maybeSingle();
  const data = Object.assign({}, r.data && r.data.data, patch, { id, at: myt(now) });
  await sb.from('records').update({ data }).eq('org_id', orgId).eq('coll', 'journeySent').eq('id', id);
}

/**
 * The timed messages due now, for every workspace that has them. deps (tests replace them): {now, deadline,
 * channexConfig, emailConfig, fetch, send (sendReply), find (findConv), address (addressFor)}
 * -> {sent, skipped, failed}
 */
export async function processJourney(sb, deps = {}) {
  const now = deps.now || Date.now();
  const deadline = deps.deadline || now + 8000;
  const out = { sent: 0, skipped: 0, failed: 0 };
  const rows = must(await sb.from('blobs').select('org_id, data').eq('key', 'guestJourney'), 'load timed messages') || [];
  let budget = BOOKINGS_PER_TICK;
  for (const row of rows) {
    const cfg = J.settings(row.data && row.data.v !== undefined ? row.data.v : row.data);
    if (!cfg || !J.STEPS.some((k) => cfg.steps[k].on)) continue;
    if (Date.now() > deadline || budget <= 0) break;
    const orgId = row.org_id;
    const meta = await blob(sb, orgId, 'workspaceMeta');
    if (meta && meta.demo === true) continue;
    budget -= await orgJourney(sb, orgId, cfg, Object.assign({}, deps, { now, deadline, budget }), out);
  }
  return out;
}

async function orgJourney(sb, orgId, cfg, deps, out) {
  const now = deps.now, at = myt(now), today = todayMY(now);
  const bookings = (await records(sb, orgId, 'bookings')).filter((b) => b && b.checkOut >= addDays(today, -1) && b.checkIn <= addDays(today, 2) || (b && b.createdAt && b.createdAt >= myt(now - 2 * 86400000)));
  if (!bookings.length) return 0;
  const ctx = { units: new Map(), types: new Map(), buildings: new Map(), fields: new Map() };
  for (const p of await records(sb, orgId, 'properties')) ctx.units.set(p.id, p);
  for (const t of await records(sb, orgId, 'unitTypes')) ctx.types.set(t.id, t);
  for (const b of await records(sb, orgId, 'buildings')) ctx.buildings.set(b.id, b);
  for (const g of await records(sb, orgId, 'greetings')) {
    const list = ctx.fields.get(g.buildingId) || [];
    (Array.isArray(g.fields) ? g.fields : []).forEach((f) => { if (f && f.key && !list.some((x) => x.key === f.key)) list.push(f); });
    ctx.fields.set(g.buildingId, list);
  }
  const sentRows = new Map((await records(sb, orgId, 'journeySent')).map((r) => [r.id, r]));
  const cx = deps.channexConfig || null;
  const em = deps.emailConfig || inboundConfig();
  const brand = await blob(sb, orgId, 'workspaceBrand');
  const fromName = (isObj(brand) && String(brand.name || '').trim()) || 'Reservations';
  let fromAddress;
  const routeOpts = { channex: !!(cx && cx.key), email: !!(em.key && em.domain), ownDomain: em.domain };
  let used = 0;
  for (const b of bookings) {
    if (used >= deps.budget || Date.now() > deps.deadline - 1500) break;
    const unit = b.propertyId ? ctx.units.get(b.propertyId) : null;
    const type = ctx.types.get(b.unitTypeId || (unit && unit.unitTypeId)) || null;
    const building = ctx.buildings.get((unit && unit.buildingId) || (type && type.buildingId)) || null;
    const ciTime = GM.ciTimeOf(b, unit, building);
    for (const step of J.STEPS) {
      if (!J.isDue(step, b, cfg, at, ciTime)) continue;
      const id = b.id + ':' + step;
      const prev = sentRows.get(id);
      if (prev && prev.state !== 'failed') continue;
      if (step === 'welcome' && !unit) continue; // no unit yet: wait for the assignment
      const route = routeFor(b, routeOpts);
      if (!(await claim(sb, orgId, id, sentRows, now))) continue;
      used++;
      if (!route) { await settle(sb, orgId, id, { state: 'skipped', why: 'no-route' }, now); out.skipped++; continue; }
      try {
        const find = deps.find || findConv;
        const conv = route.via === 'channex'
          ? await convOf(sb, orgId, find(sb, orgId, 'cx', 'booking:' + route.cxBooking, b.id, { cxBooking: route.cxBooking, ota: VIA_NAME[OTA_VIA[b.channel]] }, now))
          : await convOf(sb, orgId, find(sb, orgId, 'em', route.to, b.id, { emSubject: 'Your stay' + (building && building.name ? ' at ' + building.name : '') }, now));
        if (!conv) throw new Error('no conversation');
        const filled = J.fill(J.textFor(cfg, step, b.channel), { booking: b, unit, unitType: type, building, fields: ctx.fields.get(building && building.id) || [] }, { now: at, askPhone: cfg.askPhone && !(isObj(b.guest) && String(b.guest.phone || '').replace(/\D/g, '').length >= 8) });
        if (!filled.text) { await settle(sb, orgId, id, { state: 'skipped', why: 'empty' }, now); out.skipped++; continue; }
        if (step === 'welcome' && codeAlreadySent(conv, (unit && unit.lockCode) || b.doorCode)) { await settle(sb, orgId, id, { state: 'skipped', why: 'sent-by-hand' }, now); out.skipped++; continue; }
        if (route.via === 'email' && fromAddress === undefined) fromAddress = await (deps.address || addressFor)(sb, em, { id: orgId, name: fromName }, null);
        await (deps.send || sendReply)(sb, {
          orgId, conv, booking: b, via: route.via, text: filled.text, journey: step, now, fetch: deps.fetch,
          channexConfig: cx, emailConfig: em, fromAddress, fromName, fresh: route.via === 'email'
        });
        await settle(sb, orgId, id, { state: 'sent', via: route.via }, now);
        out.sent++;
      } catch (e) {
        await settle(sb, orgId, id, { state: 'failed', error: String(e && e.message || e).slice(0, 200) }, now);
        out.failed++;
      }
    }
  }
  return used;
}

async function convOf(sb, orgId, idPromise) {
  const id = await idPromise;
  if (!id) return null;
  const r = must(await sb.from('records').select('id, data').eq('org_id', orgId).eq('coll', 'conversations').eq('id', id).maybeSingle(), 'load conversation');
  return r && isObj(r.data) ? Object.assign({}, r.data, { id: r.id }) : null;
}
