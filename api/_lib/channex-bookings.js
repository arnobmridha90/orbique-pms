/* Bookings inbound from Channex (plan sections 4 and 5, milestone M6). Server only.
 * Private module: Vercel does not expose files under api/_lib as endpoints.
 *
 *   ingestRevision(sb, revisionIdOrObject, opts)   fetch (GET /booking_revisions/:id), save the bookings, assign units,
 *                                                  raise alerts, then acknowledge. Save first, ack after, never GET /bookings.
 *   ackRevision(sb, revisionId, opts)              POST /booking_revisions/:id/ack and note it in channex_revisions
 *   pollFeed(sb, opts)                             GET /booking_revisions/feed (every 15 minutes, or now with force)
 *   processEvent(sb, eventRow, opts)               one stored webhook event (channex_events) -> done / error / ignored
 *   retryInbound(sb, opts)                         the worker's retry pass: stored events not done, saved revisions not acked
 *   reassignUpcoming(sb, opts)                     nightly: unit assignment for stays starting in the next 14 days
 * Pure (unit-tested, no database):
 *   revisionToBookings(rev, ctx)                   one Orbique booking per rooms[] item (shared groupRef for several rooms)
 *   mergeBooking(existing, incoming)               a modification overwrites only the keys the channel owns
 *   detectConflicts(booking, ctx)                  double booking: same unit, or more bookings than units of the type
 *   revisionNights(before, after, units, typeIds)  room types and nights a revision touched (their availability is
 *                                                  invalidated and sent again in full, see ingestRevision)
 *   channelOf(rev), stripRevision(rev), newBookingId(), newDoorCode(), newGuestToken()
 *
 * Card data: the revision's `guarantee` (masked card number, card holder, expiry) is removed before anything is stored
 * or logged. Orbique never stores it, not even on the booking.
 */
import { createHash, randomBytes } from 'node:crypto';
import A from './shared/assign.cjs';
import G from './shared/guestmsg.cjs';
import { channexConfig, channelView, ChannexError } from './channex.js';
import { must, records, tracked, addAlert, todayMY, addDays, daysBetween, isIso } from './channex-db.js';
import { CONNECTED } from './channex-sync.js';
import { MESSAGE_EVENTS, receiveChannex } from './inbox.js';

export const FEED_EVERY_MS = 15 * 60 * 1000;
export const EVENT_RETRY_AFTER_MS = 60 * 1000;   // the webhook handles an event inline; the worker picks up what is left
export const EVENT_RETRY_DAYS = 7;
export const REASSIGN_DAYS = 14;
const LIVE_STATUSES = ['confirmed', 'checked_in', 'checked_out', 'pending'];
const BOOKING_EVENTS = ['booking', 'booking_new', 'booking_modification', 'booking_cancellation', 'booking_unmapped_room', 'booking_unmapped_rate', 'non_acked_booking'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);

/* ---------- ids and codes (the same formats as O.uid, O.bookingDefaults and O.newToken in app/core.js) ---------- */

/** 'BK-' + base36 time + 4 random base36 characters, upper-cased (O.uid('BK')). */
export function newBookingId(now = Date.now()) {
  const r = Array.from(randomBytes(4), (x) => (x % 36).toString(36)).join('');
  return ('BK-' + (now.toString(36) + r)).toUpperCase();
}
/** Four digits, 1000-9999 (O.bookingDefaults). */
export const newDoorCode = () => String(1000 + (randomBytes(2).readUInt16BE(0) % 9000));
/** 'g' + base64url of 16 random bytes (O.newToken('g')). */
export const newGuestToken = () => 'g' + randomBytes(16).toString('base64url');

/* ---------- small helpers ---------- */

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (v) => Math.round(num(v) * 100) / 100;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const validTime = (t) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || '')) ? String(t) : null);
const clean = (s, max = 200) => (s === undefined || s === null ? '' : String(s).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max));
const live = (b) => !!b && b.status !== 'cancelled' && b.status !== 'deleted';

/** A Channex timestamp ('2019-04-23T10:03:29.335485', UTC without a zone) as an ISO string with Z, or null. */
export function utcIso(v) {
  if (!v) return null;
  let s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += 'Z';
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
/** UTC ms -> Malaysia local time 'YYYY-MM-DDTHH:MM' (how the app writes createdAt and D.NOW). */
export const myt = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 16);
/** Now in Malaysia, 'YYYY-MM-DDTHH:MM'; the date follows todayMY() so a test can pin it. */
export function nowMY(now = Date.now()) { return todayMY(now) + myt(now).slice(10); }

let regionNames = null;
function countryName(code) {
  try {
    regionNames = regionNames || new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code === 'UK' ? 'GB' : code) || code;
  } catch (e) { return code; }
}

/** The Orbique channel of a revision: from the unique_id prefix (BDC-…), else the OTA name. */
const PREFIX = { BDC: 'booking', ABB: 'airbnb', AGO: 'agoda', EXP: 'expedia', CTP: 'trip' };
export function channelOf(rev) {
  const pre = String((rev && rev.unique_id) || '').split('-')[0].toUpperCase();
  if (PREFIX[pre]) return PREFIX[pre];
  const n = String((rev && rev.ota_name) || '').toLowerCase();
  if (/booking\.?com/.test(n)) return 'booking';
  if (/airbnb/.test(n)) return 'airbnb';
  if (/agoda/.test(n)) return 'agoda';
  if (/expedia/.test(n)) return 'expedia';
  if (/trip\.?com|ctrip/.test(n)) return 'trip';
  return 'other';
}
/** Commission rates the app shows (D.channels in app/data.js), for an estimate when Channex sends no ota_commission. */
export const FEE_PCT = { airbnb: 0.15, booking: 0.15, agoda: 0.15, expedia: 0.18, trip: 0.15, other: 0.15, vrbo: 0.08, direct: 0.03 };
const CHANNEL_NAME = { airbnb: 'Airbnb', booking: 'Booking.com', agoda: 'Agoda', expedia: 'Expedia', trip: 'Trip.com', other: 'the platform' };

/** The revision attributes, whatever shape it came in ({id, attributes} from the API, or plain). */
export function revisionAttrs(x) {
  if (!isObj(x)) return null;
  if (isObj(x.attributes)) return Object.assign({}, x.attributes, { id: x.attributes.id || x.id });
  return Object.assign({}, x);
}

/** A copy of the revision without card data (guarantee), safe to store. */
export function stripRevision(rev) {
  const r = JSON.parse(JSON.stringify(rev || {}));
  delete r.guarantee;
  delete r.payment_guarantee;
  if (Array.isArray(r.rooms)) for (const room of r.rooms) if (isObj(room)) { delete room.guarantee; }
  return r;
}

function priceOf(item) { return money(item && (item.total_price !== undefined ? item.total_price : item.amount !== undefined ? item.amount : item.price)); }
const matches = (item, re) => re.test(String((item && item.name) || '') + ' ' + String((item && item.type) || ''));

/* ---------- revision -> bookings (pure) ---------- */

/**
 * One Orbique booking per rooms[] item.
 *   rev  revision attributes (stripped or not; the guarantee is never read)
 *   ctx  {roomTypes: Map|object room_type_id -> unit_type_id, ratePlans: Map|object rate_plan_id -> plan_id,
 *         recordIds: [existing record ids, by room index], firstInsertedAt (ISO, the booking's first revision),
 *         checkTimes: (unitTypeId) -> {checkInTime, checkOutTime}, newId, now (ms)}
 * -> {bookings: [booking], problems: [{kind: 'unmapped_room'|'unmapped_rate', room: i, roomTypeId, ratePlanId}]}
 * New-booking fields (door code, guest token, id checks) are not set here; see newBookingFields.
 */
export function revisionToBookings(rev, ctx = {}) {
  const get = (m, k) => (k === null || k === undefined ? undefined : m instanceof Map ? m.get(k) : m ? m[k] : undefined);
  const rooms = Array.isArray(rev.rooms) && rev.rooms.length ? rev.rooms : [{ checkin_date: rev.arrival_date, checkout_date: rev.departure_date, amount: rev.amount, occupancy: rev.occupancy }];
  const channel = channelOf(rev);
  const cust = isObj(rev.customer) ? rev.customer : {};
  let country = clean(cust.country, 2).toUpperCase();
  if (country === 'GB') country = 'UK';
  const guest = {
    name: clean([cust.name, cust.surname].filter(Boolean).join(' '), 120) || 'Guest',
    email: clean(cust.mail || cust.email, 254),
    phone: clean(cust.phone, 40),
    country: country || '',
    countryName: country ? countryName(country) : '',
    foreign: !!country && country !== 'MY'
  };
  const firstMs = Date.parse(ctx.firstInsertedAt || utcIso(rev.inserted_at) || '') || ctx.now || Date.now();
  const createdAt = myt(firstMs);
  const currency = clean(rev.currency, 3).toUpperCase();
  const status = rev.status === 'cancelled' ? 'cancelled' : 'confirmed';
  const collect = rev.payment_collect === 'ota' ? 'ota' : rev.payment_collect === 'property' ? 'property' : null;
  const otaNotes = clean(rev.notes, 2000) || null;
  const totalAmount = money(rev.amount);
  const roomShares = rooms.map((r) => money(r && r.amount));
  const shareSum = roomShares.reduce((a, b) => a + b, 0);
  const commission = rev.ota_commission === null || rev.ota_commission === undefined || rev.ota_commission === '' ? null : money(rev.ota_commission);
  const groupRef = rooms.length > 1 ? 'CX-' + String(rev.booking_id || rev.id || '').slice(0, 8).toUpperCase() : undefined;
  const problems = [];
  const bookings = rooms.map((room, i) => {
    room = isObj(room) ? room : {};
    const checkIn = isIso(room.checkin_date) ? room.checkin_date : rev.arrival_date;
    const checkOut = isIso(room.checkout_date) ? room.checkout_date : rev.departure_date;
    const nights = isIso(checkIn) && isIso(checkOut) ? Math.max(0, daysBetween(checkIn, checkOut)) : 0;
    const unitTypeId = get(ctx.roomTypes, room.room_type_id) || null;
    const ratePlanId = get(ctx.ratePlans, room.rate_plan_id) || null;
    if (!unitTypeId) problems.push({ kind: 'unmapped_room', room: i, roomTypeId: room.room_type_id || null });
    if (!ratePlanId) problems.push({ kind: 'unmapped_rate', room: i, ratePlanId: room.rate_plan_id || null });
    const days = isObj(room.days) ? Object.values(room.days) : [];
    const accommodation = days.length ? money(days.reduce((a, v) => a + num(v), 0)) : money(room.amount);
    const services = (Array.isArray(room.services) ? room.services : []).concat(i === 0 && Array.isArray(rev.services) ? rev.services : []);
    const cleaningFee = money(services.filter((s) => matches(s, /clean/i)).reduce((a, s) => a + priceOf(s), 0));
    const taxes = (Array.isArray(room.taxes) ? room.taxes : []).concat(Array.isArray(room.collected_taxes) ? room.collected_taxes : []);
    const tourismTax = money(taxes.filter((t) => matches(t, /tourism/i)).reduce((a, t) => a + priceOf(t), 0));
    const share = rooms.length > 1 ? (shareSum > 0 ? roomShares[i] / shareSum : 1 / rooms.length) : 1;
    let total = rooms.length > 1 ? (roomShares[i] ? money(roomShares[i] + cleaningFee + tourismTax) : money(totalAmount * share)) : totalAmount;
    if (!total) total = money(accommodation + cleaningFee + tourismTax);
    const occ = isObj(room.occupancy) ? room.occupancy : isObj(rev.occupancy) ? rev.occupancy : {};
    const guests = Math.max(1, Math.round(num(occ.adults) + num(occ.children)) || 1);
    const feePct = FEE_PCT[channel] !== undefined ? FEE_PCT[channel] : 0.15;
    const platformFee = commission !== null ? money(commission * share) : Math.round(accommodation * feePct);
    const times = (ctx.checkTimes && ctx.checkTimes(unitTypeId)) || {};
    const b = {
      id: (ctx.recordIds && ctx.recordIds[i]) || (ctx.newId ? ctx.newId(i) : newBookingId()),
      unitTypeId,
      ratePlanId,
      propertyId: null,
      channel,
      otaName: clean(rev.ota_name, 80) || CHANNEL_NAME[channel] || null,
      reservationCode: clean(rev.ota_reservation_code, 80) || clean(rev.unique_id, 80) || null,
      channex: { bookingId: rev.booking_id || null, revisionId: rev.id || null, uniqueId: rev.unique_id || null, propertyId: rev.property_id || null, room: i },
      guest,
      guests,
      checkIn, checkOut, nights,
      checkInTime: times.checkInTime || '15:00',
      checkOutTime: times.checkOutTime || '11:00',
      createdAt,
      sameDay: createdAt.slice(0, 10) === checkIn,
      nightly: nights ? Math.round(accommodation / nights) : accommodation,
      accommodation,
      cleaningFee,
      tourismTax,
      total,
      revenue: money(accommodation + cleaningFee),
      platformFee,
      payout: collect === 'property' ? total : money(total - platformFee),
      status,
      otaNotes
    };
    if (validTime(rev.arrival_hour)) b.arrivalHour = rev.arrival_hour;
    if (groupRef) b.groupRef = groupRef;
    if (currency && currency !== 'MYR') b.currency = currency;
    if (commission === null) b.feeEstimated = true;
    if (collect) b.paymentCollect = collect;
    if (collect !== 'property') { b.paidAt = createdAt.slice(0, 10); b.payMethod = 'Paid via ' + (CHANNEL_NAME[channel] || 'the platform'); }
    if (status === 'cancelled') b.cancelledAt = ctx.today || todayMY(ctx.now || Date.now());
    return b;
  });
  return { bookings, problems };
}

/** The fields a booking gets once, when it is first created (O.bookingDefaults plus the arrival defaults in data.js). */
export function newBookingFields(b) {
  return Object.assign(b, {
    doorCode: b.doorCode || newDoorCode(),
    guestToken: b.guestToken || newGuestToken(),
    idVerified: b.idVerified === true,
    codeStatus: b.status === 'cancelled' ? 'cancelled' : b.codeStatus || 'held',
    notes: b.notes || ''
  });
}

/** Keys a channel revision owns; everything else (unit, door code, guest token, staff notes, invoices…) stays as staff left it. */
export const CHANNEL_KEYS = ['unitTypeId', 'ratePlanId', 'channel', 'otaName', 'reservationCode', 'channex', 'groupRef', 'guests', 'checkIn', 'checkOut',
  'nights', 'nightly', 'accommodation', 'cleaningFee', 'tourismTax', 'total', 'revenue', 'currency', 'platformFee', 'feeEstimated', 'payout',
  'paymentCollect', 'otaNotes', 'arrivalHour'];

/**
 * A modification or cancellation applied to the booking Orbique already has. Pure; returns a new object.
 * Channel-owned keys come from the revision (a key the revision no longer has is removed, e.g. currency back to MYR);
 * the guest's details are merged (staff additions kept); the status only moves between live and cancelled.
 */
export function mergeBooking(existing, incoming) {
  if (!existing) return Object.assign({}, incoming);
  const out = Object.assign({}, existing);
  for (const k of CHANNEL_KEYS) {
    if (incoming[k] === undefined) delete out[k];
    else out[k] = incoming[k];
  }
  const g = {};
  for (const [k, v] of Object.entries(incoming.guest || {})) if (v !== '' && v !== null && v !== undefined) g[k] = v;
  out.guest = Object.assign({}, existing.guest || {}, g);
  if (out.paidAt === undefined || out.paidAt === null) { if (incoming.paidAt) { out.paidAt = incoming.paidAt; out.payMethod = existing.payMethod || incoming.payMethod; } }
  if (incoming.status === 'cancelled') {
    out.status = 'cancelled';
    out.cancelledAt = existing.status === 'cancelled' && existing.cancelledAt ? existing.cancelledAt : incoming.cancelledAt;
    if (out.codeStatus !== 'expired') out.codeStatus = 'cancelled';
  } else if (!live(existing)) {
    out.status = 'confirmed'; // re-instated by a modification
    delete out.cancelledAt;
    if (!out.codeStatus || out.codeStatus === 'cancelled') out.codeStatus = 'held';
  } else if (!LIVE_STATUSES.includes(existing.status)) {
    out.status = 'confirmed';
  }
  // the dates moved: the stay's same-day flag follows the original booking time
  if (existing.createdAt) out.sameDay = String(existing.createdAt).slice(0, 10) === out.checkIn;
  // a different type was sold: the unit is chosen again (assignment.locked is kept; a locked unit of another type stays a conflict)
  if (existing.unitTypeId && incoming.unitTypeId && existing.unitTypeId !== incoming.unitTypeId && !(existing.assignment && existing.assignment.locked)) out._typeChanged = true;
  return out;
}

/**
 * Is this booking double booked?
 *   ctx {bookings (every booking that may overlap, this one included or not), units, blocks}
 * -> {double: bool, with: [booking ids], nights: [dates the type is oversold], sameUnit: bool}
 * Two live bookings on the same unit for a shared night, or more live bookings of the type than its units can hold
 * on some night (assigned or not).
 */
export function detectConflicts(b, ctx = {}) {
  const out = { double: false, with: [], nights: [], sameUnit: false };
  if (!live(b) || !b.checkIn || !b.checkOut || b.checkOut <= b.checkIn) return out;
  const others = (ctx.bookings || []).filter((x) => x && x.id !== b.id && live(x) && x.checkIn < b.checkOut && b.checkIn < x.checkOut);
  const withIds = new Set();
  if (b.propertyId) for (const x of others) if (x.propertyId === b.propertyId) { withIds.add(x.id); out.sameUnit = true; }
  if (b.unitTypeId) {
    const units = (ctx.units || []).filter((u) => A.activeUnit(u) && u.unitTypeId === b.unitTypeId);
    const unitIds = new Set(units.map((u) => u.id));
    const all = others.concat([b]);
    const nights = A.typeAvailability({ unitTypeId: b.unitTypeId, units: ctx.units || [], bookings: all, blocks: ctx.blocks || [], from: b.checkIn, to: addDays(b.checkOut, -1) });
    for (const n of nights) {
      if (n.raw >= 0) continue;
      out.nights.push(n.date);
      for (const x of others) {
        if (!(x.checkIn <= n.date && n.date < x.checkOut)) continue;
        if ((x.propertyId && unitIds.has(x.propertyId)) || (!x.propertyId && x.unitTypeId === b.unitTypeId)) withIds.add(x.id);
      }
    }
  }
  out.with = [...withIds].sort();
  out.double = out.with.length > 0 && (out.sameUnit || out.nights.length > 0);
  return out;
}

/**
 * The room types and nights a revision touched: every night of each booking before it (old) and after it (new), for the
 * type sold and the assigned unit's type, kept to the types this property maps (typeIds). Channex lowers availability
 * by itself when a new booking arrives, so what Orbique last sent for these nights may no longer be what Channex has.
 *   before, after  [booking]; units  [unit records]; typeIds  Set of mapped unit type ids
 * -> [{target_id, date_from, date_to}], consecutive and overlapping nights merged per type
 */
export function revisionNights(before, after, units, typeIds) {
  const unitType = new Map((units || []).map((u) => [u.id, u.unitTypeId]));
  const nights = new Map();
  for (const b of [...(before || []), ...(after || [])]) {
    if (!b || !isIso(b.checkIn) || !isIso(b.checkOut) || b.checkOut <= b.checkIn) continue;
    const last = addDays(b.checkOut, -1);
    for (const t of new Set([b.unitTypeId, b.propertyId && unitType.get(b.propertyId)])) {
      if (!t || !typeIds.has(t)) continue;
      const list = nights.get(t) || [];
      list.push([b.checkIn, last]);
      nights.set(t, list);
    }
  }
  const out = [];
  for (const [t, list] of [...nights].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    let cur = null;
    for (const [a, z] of list) {
      if (cur && a <= addDays(cur.date_to, 1)) { if (z > cur.date_to) cur.date_to = z; continue; }
      cur = { target_id: t, date_from: a, date_to: z };
      out.push(cur);
    }
  }
  return out;
}

/* ---------- database: context, saving, alerts ---------- */

/** The connected (or once connected) building for a Channex property id: {org_id, building_id, channex_property_id, status, env}. */
async function propertyRow(sb, cfg, propertyId) {
  if (!isUuid(propertyId)) return null;
  const r = must(await sb.from('channex_properties').select('org_id, env, building_id, channex_property_id, status').eq('channex_property_id', propertyId).maybeSingle(), 'load property');
  return r || null; // channex_property_id is unique across environments; a disconnected building still takes its bookings
}

async function mappings(sb, cfg, prop) {
  const rts = must(await sb.from('channex_room_types').select('unit_type_id, room_type_id').eq('channex_property_id', prop.channex_property_id).eq('env', cfg.env), 'load room types') || [];
  const typeIds = rts.map((r) => r.unit_type_id);
  const rps = typeIds.length ? must(await sb.from('channex_rate_plans').select('plan_id, rate_plan_id').eq('org_id', prop.org_id).eq('env', cfg.env).in('unit_type_id', typeIds), 'load rate plans') || [] : [];
  return {
    roomTypes: new Map(rts.filter((r) => r.room_type_id).map((r) => [r.room_type_id, r.unit_type_id])),
    ratePlans: new Map(rps.filter((r) => r.rate_plan_id).map((r) => [r.rate_plan_id, r.plan_id]))
  };
}

/** Units, types, buildings, and the bookings and blocks around [from, to) (a month either side, for the best fit). */
async function assignContext(sb, orgId, from, to) {
  const a = addDays(from, -31);
  const z = addDays(to, 31);
  const [units, types, buildings, bookings, blocks] = await Promise.all([
    records(sb, orgId, 'properties'),
    records(sb, orgId, 'unitTypes'),
    records(sb, orgId, 'buildings'),
    records(sb, orgId, 'bookings', (q) => q.lt('data->>checkIn', z).gt('data->>checkOut', a)),
    records(sb, orgId, 'blocks', (q) => q.lt('data->>start', z).gt('data->>end', a))
  ]);
  return { units, types, buildings, bookings, blocks };
}

/** The booking's check-in time the way the guest app and guest messages see it (O.guestmsg.ciTimeOf): its own, the unit's,
 * the building's, else 15:00. The door code and a typed unit's number reach the guest from 30 minutes before it. */
function ciTimeIn(b, ctx) {
  const unit = b.propertyId ? (ctx.units || []).find((u) => u.id === b.propertyId) : null;
  const type = (ctx.types || []).find((t) => t.id === ((unit && unit.unitTypeId) || b.unitTypeId));
  const building = type ? (ctx.buildings || []).find((x) => x.id === type.buildingId) : null;
  return G.ciTimeOf(b, unit, building);
}

function checkTimesFn(ctx) {
  const type = new Map(ctx.types.map((t) => [t.id, t]));
  const bld = new Map(ctx.buildings.map((x) => [x.id, x]));
  return (typeId) => {
    const t = type.get(typeId);
    const b = t && bld.get(t.buildingId);
    return { checkInTime: validTime(b && b.checkInTime) || '15:00', checkOutTime: validTime(b && b.checkOutTime) || '11:00' };
  };
}

async function saveRecords(sb, orgId, list) {
  if (!list.length) return;
  const rows = list.map((b) => ({ org_id: orgId, coll: 'bookings', id: b.id, data: b, deleted: false }));
  must(await sb.from('records').upsert(rows, { onConflict: 'org_id,coll,id' }), 'save bookings');
}

/** Close open alerts of a kind for a key (fixed by now). Never throws. */
export async function resolveAlerts(sb, orgId, kind, key) {
  try {
    const r = await sb.from('channex_alerts').update({ resolved_at: new Date().toISOString() }).eq('org_id', orgId).eq('kind', kind).eq('ref->>key', key).is('resolved_at', null);
    if (r.error) console.error('[channex] resolve alert:', r.error.message);
  } catch (e) { console.error('[channex] resolve alert:', e && e.message); }
}

/** Unit moves in the workspace's activity log (auditLog blob, newest first, at most 500). Never throws. */
async function audit(sb, orgId, entries) {
  if (!entries.length) return;
  try {
    const cur = await sb.from('blobs').select('data').eq('org_id', orgId).eq('key', 'auditLog').maybeSingle();
    if (cur.error) throw cur.error;
    const list = cur.data && cur.data.data && Array.isArray(cur.data.data.v) ? cur.data.data.v : [];
    const next = entries.slice().reverse().concat(list).slice(0, 500);
    const r = await sb.from('blobs').upsert({ org_id: orgId, key: 'auditLog', data: { v: next } }, { onConflict: 'org_id,key' });
    if (r.error) throw r.error;
  } catch (e) { console.error('[channex] audit log:', e && e.message ? e.message : String(e)); }
}

const unitLabel = (units, id) => { const u = units.find((x) => x.id === id); return u ? u.unitNo || u.short || u.name || id : 'no unit'; };
function moveText(b, from, to, units) {
  return 'Assigned ' + ((b.guest && b.guest.name) || 'a guest') + ' (' + b.id + ') ' + (from ? 'from ' + unitLabel(units, from) + ' ' : '') + 'to ' +
    (to ? unitLabel(units, to) : 'no unit (none free for the whole stay)') + ' automatically';
}

/** Assign one booking in place against ctx (whose bookings list holds it). Returns {from, to, changed, res}. */
function assignOne(b, ctx, now, fresh) {
  const from = b.propertyId || null;
  if (!live(b) || !b.unitTypeId) return { from, to: from, changed: false, res: null };
  const res = A.assignUnits({ booking: b, units: ctx.units, bookings: ctx.bookings, blocks: ctx.blocks, now, fresh: !!fresh, ciTime: ciTimeIn(b, ctx) });
  const changed = A.applyResult(b, res, { how: 'auto', by: 'system', at: now });
  if (res.reason !== 'locked' && res.reason !== 'untyped' && !res.unitId) b.needsUnit = true;
  return { from, to: b.propertyId || null, changed, res };
}

/** Alerts after a booking is saved: double booking and needs a unit (raised, or resolved once fixed). */
async function bookingAlerts(sb, orgId, b, ctx, now) {
  const raised = [];
  const conflict = detectConflicts(b, ctx);
  if (conflict.double) {
    if (await addAlert(sb, { orgId, kind: 'double_booking', message: `${b.otaName || 'A platform'} booking ${b.reservationCode || b.id} (${b.checkIn} to ${b.checkOut}) overlaps ${conflict.with.join(', ')}: there are more bookings than units.`, ref: { key: 'double_booking:' + b.id, bookingId: b.id, with: conflict.with, nights: conflict.nights.slice(0, 31) } })) raised.push('double_booking');
  } else await resolveAlerts(sb, orgId, 'double_booking', 'double_booking:' + b.id);
  if (live(b) && b.needsUnit && !b.propertyId) {
    if (await addAlert(sb, { orgId, kind: 'needs_unit', message: `Booking ${b.reservationCode || b.id} (${b.checkIn} to ${b.checkOut}) has no unit: none is free for the whole stay.`, ref: { key: 'needs_unit:' + b.id, bookingId: b.id, urgent: b.checkIn <= addDays(now.slice(0, 10), 2) } })) raised.push('needs_unit');
  } else await resolveAlerts(sb, orgId, 'needs_unit', 'needs_unit:' + b.id);
  return { conflict, raised };
}

/* ---------- ingest ---------- */

/**
 * Save one booking revision, then acknowledge it.
 *   input  a revision id (fetched with GET /booking_revisions/:id) or a revision object (from the feed)
 *   opts   {config, request (tests), ack = true, source: 'booking'|'feed', timeoutMs, now (ms)}
 * -> {status: 'saved'|'duplicate'|'stale'|'unknown_property', revisionId, bookingId, orgId, recordIds, acked, ackError, alerts}
 * Database errors throw (nothing is acked, so Channex keeps the revision in the feed and the worker tries again).
 */
export async function ingestRevision(sb, input, opts = {}) {
  const cfg = opts.config || channexConfig();
  const now = opts.now || Date.now();
  let rev;
  if (typeof input === 'string') {
    if (!isUuid(input)) throw new ChannexError('invalid', 'Not a revision id.', { code: 'bad_id' });
    const res = await tracked(sb, cfg, { method: 'GET', path: '/booking_revisions/' + input, source: opts.source || 'booking', request: opts.request, timeoutMs: opts.timeoutMs, logPayload: null });
    rev = revisionAttrs(res.data);
  } else rev = revisionAttrs(input);
  if (!rev || !isUuid(rev.id)) throw new ChannexError('invalid', 'Channex sent a booking revision without an id.', { code: 'bad_revision' });
  const out = { status: 'saved', revisionId: rev.id, bookingId: rev.booking_id || null, orgId: null, recordIds: [], acked: false, ackError: null, alerts: [] };

  // already handled?
  const seen = must(await sb.from('channex_revisions').select('revision_id, saved_at, acked_at').eq('revision_id', rev.id).maybeSingle(), 'load revision');
  if (seen && seen.saved_at) {
    out.status = 'duplicate';
    if (!seen.acked_at && opts.ack !== false) Object.assign(out, await ackRevision(sb, rev.id, { config: cfg, request: opts.request, timeoutMs: opts.timeoutMs }));
    else out.acked = !!seen.acked_at;
    return out;
  }

  const prop = await propertyRow(sb, cfg, rev.property_id);
  if (!prop) {
    // not one of ours (or not in this environment): leave it unacknowledged, and tell the platform admins (no workspace
    // owns it; one open alert per property, however often Channex sends it again)
    console.error('[channex] revision', rev.id, 'for an unknown property', rev.property_id);
    const pid = clean(rev.property_id, 64) || 'none';
    if (await addAlert(sb, { orgId: null, kind: 'unknown_property', message: `Channex sent ${rev.ota_name || 'a'} booking ${clean(rev.ota_reservation_code || rev.unique_id || rev.id, 60)} for property ${pid}, which no Orbique building is connected to. It stays unacknowledged in Channex.`, ref: { key: 'unknown_property:' + pid, propertyId: pid, revisionId: rev.id } })) out.alerts.push('unknown_property');
    out.status = 'unknown_property';
    return out;
  }
  out.orgId = prop.org_id;
  const insertedAt = utcIso(rev.inserted_at) || new Date(now).toISOString();
  const stripped = stripRevision(rev);
  const bookingId = isUuid(rev.booking_id) ? rev.booking_id : rev.id;

  const link = must(await sb.from('channex_bookings').select('booking_id, record_ids, last_revision_id, last_inserted_at').eq('booking_id', bookingId).maybeSingle(), 'load booking link');
  if (link && link.last_inserted_at && Date.parse(link.last_inserted_at) > Date.parse(insertedAt)) {
    // an older revision arriving late: keep it on file, do not apply it, still acknowledge it
    must(await sb.from('channex_revisions').upsert({ revision_id: rev.id, booking_id: bookingId, org_id: prop.org_id, status: 'stale', inserted_at: insertedAt, saved_at: new Date().toISOString(), raw: stripped }, { onConflict: 'revision_id' }), 'save revision');
    out.status = 'stale';
    out.recordIds = link.record_ids || [];
    if (opts.ack !== false) Object.assign(out, await ackRevision(sb, rev.id, { config: cfg, request: opts.request, timeoutMs: opts.timeoutMs }));
    return out;
  }

  // the first revision's time is the booking's createdAt
  let firstInsertedAt = insertedAt;
  if (link) {
    const first = must(await sb.from('channex_revisions').select('inserted_at').eq('booking_id', bookingId).order('inserted_at', { ascending: true }).limit(1), 'load first revision');
    if (first && first[0] && first[0].inserted_at && Date.parse(first[0].inserted_at) < Date.parse(firstInsertedAt)) firstInsertedAt = first[0].inserted_at;
  }

  const maps = await mappings(sb, cfg, prop);
  const rooms = Array.isArray(rev.rooms) && rev.rooms.length ? rev.rooms : [{}];
  // record ids: the ones on file for this Channex booking, then new ones; claimed in channex_bookings before the
  // records are written, so a retry after a failure reuses them instead of creating a second booking
  let recordIds = (link && Array.isArray(link.record_ids) ? link.record_ids.slice() : []);
  while (recordIds.length < rooms.length) recordIds.push(newBookingId(now + recordIds.length));
  if (!link) {
    must(await sb.from('channex_bookings').upsert({ booking_id: bookingId, org_id: prop.org_id, record_ids: recordIds }, { onConflict: 'booking_id', ignoreDuplicates: true }), 'claim booking ids');
    const won = must(await sb.from('channex_bookings').select('record_ids').eq('booking_id', bookingId).single(), 'load booking ids');
    recordIds = won.record_ids.slice();
    while (recordIds.length < rooms.length) recordIds.push(newBookingId(now + recordIds.length));
  }
  if (!link || link.record_ids.length < recordIds.length) {
    must(await sb.from('channex_bookings').update({ record_ids: recordIds, updated_at: new Date().toISOString() }).eq('booking_id', bookingId), 'save booking ids');
  }

  const dates = rooms.flatMap((r) => [r && r.checkin_date, r && r.checkout_date]).concat([rev.arrival_date, rev.departure_date]).filter(isIso).sort();
  const existingList = await records(sb, prop.org_id, 'bookings', (q) => q.in('id', recordIds));
  const existing = new Map(existingList.map((b) => [b.id, b]));
  for (const b of existingList) { if (b.checkIn && isIso(b.checkIn)) dates.push(b.checkIn); if (b.checkOut && isIso(b.checkOut)) dates.push(b.checkOut); }
  dates.sort();
  const from = dates[0] || todayMY(now);
  const to = dates[dates.length - 1] || addDays(from, 1);
  const ctx = await assignContext(sb, prop.org_id, from, to);
  for (const b of existingList) if (!ctx.bookings.some((x) => x.id === b.id)) ctx.bookings.push(b);

  const { bookings: incoming, problems } = revisionToBookings(rev, { roomTypes: maps.roomTypes, ratePlans: maps.ratePlans, recordIds, firstInsertedAt, checkTimes: checkTimesFn(ctx), now });
  const nowLocal = nowMY(now);
  const saved = [];
  const moves = [];
  for (const inc of incoming) {
    const old = existing.get(inc.id);
    let b;
    if (old) b = mergeBooking(old, inc);
    else {
      b = newBookingFields(inc);
      if (!b.unitTypeId) b.needsUnit = live(b);
    }
    const fresh = !!b._typeChanged;
    delete b._typeChanged;
    if (!b.unitTypeId && live(b) && !b.propertyId) b.needsUnit = true;
    // the context holds this booking's latest version
    const idx = ctx.bookings.findIndex((x) => x.id === b.id);
    if (idx >= 0) ctx.bookings[idx] = b; else ctx.bookings.push(b);
    const r = assignOne(b, ctx, nowLocal, fresh);
    if (r.changed) moves.push({ at: nowLocal, by: 'system', cat: 'bookings', text: moveText(b, r.from, r.to, ctx.units) });
    // a new booking's check-in and check-out times follow the unit, else the building (O.guestmsg.ciTimeOf order), so
    // the door code and unit number reach the guest from 30 minutes before the real check-in time, never the OTA's
    // arrival estimate (kept as arrivalHour). Never changed on a modification: staff may have agreed another time.
    if (!old) {
      const u = b.propertyId ? ctx.units.find((x) => x.id === b.propertyId) : null;
      b.checkInTime = ciTimeIn({ propertyId: b.propertyId, unitTypeId: b.unitTypeId }, ctx);
      if (u && validTime(u.checkOutTime)) b.checkOutTime = u.checkOutTime;
    }
    const c = detectConflicts(b, ctx);
    if (c.double) b.conflict = { kind: 'double_booking', with: c.with, at: nowLocal };
    else if (b.conflict && b.conflict.kind === 'double_booking') delete b.conflict;
    saved.push(b);
  }
  // rooms a modification dropped: cancel their bookings
  for (const id of recordIds.slice(incoming.length)) {
    const old = existing.get(id);
    if (old && live(old)) saved.push(mergeBooking(old, Object.assign({}, old, { status: 'cancelled', cancelledAt: todayMY(now) })));
  }

  await saveRecords(sb, prop.org_id, saved);
  // Channex changed availability on its own for a new booking (and a cancellation or modification may follow before
  // the next send): forget what Orbique last sent for these nights, old and new, so the next send states Orbique's
  // value even when it equals the old one. Before the ack: if this fails, the revision is fetched again.
  if (CONNECTED.includes(prop.status)) {
    for (const r of revisionNights(existingList, saved, ctx.units, new Set(maps.roomTypes.values()))) {
      must(await sb.rpc('channex_invalidate', { p_org: prop.org_id, p_prop: prop.channex_property_id, p_kind: 'availability', p_target: r.target_id, p_from: r.date_from, p_to: r.date_to, p_reason: 'revision' }), 'invalidate availability');
    }
  }
  must(await sb.from('channex_bookings').update({ record_ids: recordIds, last_revision_id: rev.id, last_inserted_at: insertedAt, updated_at: new Date().toISOString() }).eq('booking_id', bookingId), 'save booking link');
  must(await sb.from('channex_revisions').upsert({ revision_id: rev.id, booking_id: bookingId, org_id: prop.org_id, status: rev.status || null, inserted_at: insertedAt, saved_at: new Date().toISOString(), raw: stripped }, { onConflict: 'revision_id' }), 'save revision');
  out.recordIds = recordIds.slice(0, Math.max(incoming.length, recordIds.length));

  // saved: everything below is best effort; the acknowledgement must not wait on it
  if (opts.ack !== false) Object.assign(out, await ackRevision(sb, rev.id, { config: cfg, request: opts.request, timeoutMs: opts.timeoutMs }));
  for (const p of problems) {
    const room = rooms[p.room] || {};
    const what = p.kind === 'unmapped_room' ? 'room type' : 'rate plan';
    if (await addAlert(sb, { orgId: prop.org_id, kind: p.kind, message: `${rev.ota_name || 'A platform'} booking ${rev.ota_reservation_code || rev.unique_id || rev.id} came in for a ${what} that is not mapped in Orbique${p.kind === 'unmapped_room' ? '; it has no unit until someone picks one' : ''}.`, ref: { key: p.kind + ':' + rev.booking_id + ':' + p.room, bookingId: saved[p.room] ? saved[p.room].id : null, roomTypeId: room.room_type_id || null, ratePlanId: room.rate_plan_id || null } })) out.alerts.push(p.kind);
  }
  for (const b of saved) {
    const a = await bookingAlerts(sb, prop.org_id, b, ctx, nowLocal);
    out.alerts.push(...a.raised);
  }
  await audit(sb, prop.org_id, moves);
  return out;
}

/**
 * Acknowledge a revision (only ever after it was saved). Notes the outcome in channex_revisions.
 * -> {acked, ackError}
 */
export async function ackRevision(sb, revisionId, opts = {}) {
  const cfg = opts.config || channexConfig();
  try {
    await tracked(sb, cfg, { method: 'POST', path: '/booking_revisions/' + revisionId + '/ack', source: 'ack', request: opts.request, timeoutMs: opts.timeoutMs || 8000, logPayload: null });
    must(await sb.from('channex_revisions').update({ acked_at: new Date().toISOString(), ack_error: null }).eq('revision_id', revisionId), 'save ack');
    return { acked: true, ackError: null };
  } catch (e) {
    const msg = (e instanceof ChannexError ? e.kind + ': ' : '') + (e && e.message ? e.message : String(e));
    try { await sb.from('channex_revisions').update({ ack_error: msg.slice(0, 500) }).eq('revision_id', revisionId); } catch (x) { /* the worker retries anyway */ }
    console.error('[channex] ack', revisionId + ':', msg);
    return { acked: false, ackError: msg };
  }
}

/* ---------- the feed (backup to webhooks) ---------- */

/**
 * GET /booking_revisions/feed and ingest each revision (save, then ack). Runs when 15 minutes have passed since the
 * last poll (channex_meta.last_feed_poll_at), or now with opts.force.
 *   opts {config, request, force, budgetMs = 8000, propertyId, limit = 25, maxPages = 20}
 * -> {polled, revisions, saved, acked, errors}
 */
export async function pollFeed(sb, opts = {}) {
  const cfg = opts.config || channexConfig();
  const out = { polled: false, revisions: 0, saved: 0, acked: 0, errors: 0 };
  if (!cfg.key) return out;
  const deadline = Date.now() + (opts.budgetMs || 8000);
  if (!opts.force) {
    // compare-and-set on channex_meta.last_feed_poll_at, so two runs never poll at once
    const meta = must(await sb.from('channex_meta').select('last_feed_poll_at').eq('id', 1).maybeSingle(), 'load feed poll time');
    const last = meta && meta.last_feed_poll_at;
    if (last && Date.parse(last) > Date.now() - FEED_EVERY_MS) return out;
    let claim = sb.from('channex_meta').update({ last_feed_poll_at: new Date().toISOString() }).eq('id', 1);
    claim = last ? claim.eq('last_feed_poll_at', last) : claim.is('last_feed_poll_at', null);
    const got = must(await claim.select('id'), 'claim feed poll') || [];
    if (!got.length) return out;
  }
  out.polled = true;
  const seen = new Set();
  let page = 1;
  for (let round = 0; round < (opts.maxPages || 20) && Date.now() < deadline - 1500; round++) {
    const query = { 'pagination[page]': page, 'pagination[limit]': opts.limit || 25, 'order[inserted_at]': 'asc' };
    if (opts.propertyId) query['filter[property_id]'] = opts.propertyId;
    let res;
    try {
      res = await tracked(sb, cfg, { method: 'GET', path: '/booking_revisions/feed', query, source: 'feed', request: opts.request, logPayload: null });
    } catch (e) { out.errors++; break; }
    const list = (Array.isArray(res.data) ? res.data : []).map(revisionAttrs).filter((r) => r && isUuid(r.id));
    if (!list.length) break;
    const fresh = list.filter((r) => !seen.has(r.id));
    // acknowledged revisions leave the feed, so page 1 again; only revisions that stay (failed, unknown) push us onwards
    if (!fresh.length) { page++; continue; }
    for (const rev of fresh) {
      seen.add(rev.id);
      if (Date.now() > deadline - 1000) break;
      out.revisions++;
      try {
        const r = await ingestRevision(sb, rev, { config: cfg, request: opts.request, source: 'feed' });
        if (r.status === 'saved') out.saved++;
        if (r.acked) out.acked++;
      } catch (e) {
        out.errors++;
        console.error('[channex] feed revision', rev.id + ':', e && e.message ? e.message : String(e));
      }
    }
  }
  return out;
}

/* ---------- stored webhook events ---------- */

const payloadOf = (ev) => (isObj(ev.payload) && isObj(ev.payload.payload) ? ev.payload.payload : isObj(ev.payload) ? ev.payload : {});

async function markEvent(sb, id, status, error) {
  const r = await sb.from('channex_events').update({ status, error: error ? String(error).slice(0, 1000) : null, processed_at: new Date().toISOString() }).eq('id', id);
  if (r.error) console.error('[channex] event status:', r.error.message);
}

/**
 * Handle one stored event (a channex_events row: {id, event, channex_property_id, revision_id, payload}).
 * Booking events ingest their revision; sync errors and disconnected channels become alerts; channel changes refresh the
 * cached channel list; guest messages (message, inquiry, reservation_request, message_thread_booking_assigned) go to
 * the booking's conversation in the inbox. -> {status: 'done'|'error'|'ignored', result?, error?}
 */
export async function processEvent(sb, ev, opts = {}) {
  const cfg = opts.config || channexConfig();
  const p = payloadOf(ev);
  const propertyId = ev.channex_property_id || p.property_id || (isObj(ev.payload) ? ev.payload.property_id : null);
  try {
    let result = null;
    let status = 'done';
    if (BOOKING_EVENTS.includes(ev.event)) {
      const revisionId = [ev.revision_id, p.revision_id, p.booking_revision_id].find(isUuid);
      if (ev.event === 'non_acked_booking') {
        const prop = await propertyRow(sb, cfg, propertyId);
        if (prop) await addAlert(sb, { orgId: prop.org_id, kind: 'non_acked', message: `Channex says booking ${p.ota_code || p.booking_unique_id || p.booking_id || ''} was not acknowledged for 30 minutes. Orbique is fetching it again.`, ref: { key: 'non_acked:' + (revisionId || p.booking_id), revisionId: revisionId || null } });
      }
      if (revisionId) result = await ingestRevision(sb, revisionId, { config: cfg, request: opts.request, timeoutMs: opts.timeoutMs });
      else if (isUuid(propertyId)) result = await pollFeed(sb, { config: cfg, request: opts.request, force: true, propertyId, budgetMs: opts.budgetMs || 5000 });
      else status = 'ignored';
      if (result && result.status === 'unknown_property') status = 'ignored';
    } else if (['sync_error', 'disconnect_channel', 'disconnect_listing', 'new_channel', 'updated_channel'].includes(ev.event)) {
      const prop = await propertyRow(sb, cfg, propertyId);
      if (!prop) status = 'ignored';
      else if (ev.event === 'sync_error') {
        await addAlert(sb, { orgId: prop.org_id, kind: 'sync_error', message: `${clean(p.channel || 'A channel', 60)} reported a sync error${p.error_type ? ': ' + clean(p.error_type, 200) : ''}.`, ref: { key: 'channel_sync:' + (p.channel_id || propertyId), channelId: p.channel_id || null, propertyId } });
      } else if (ev.event === 'disconnect_channel' || ev.event === 'disconnect_listing') {
        await addAlert(sb, { orgId: prop.org_id, kind: 'channel_disconnected', message: `${clean(p.channel || p.title || 'A channel', 60)} was disconnected from Channex.`, ref: { key: 'channel:' + (p.channel_id || p.id || propertyId), channelId: p.channel_id || p.id || null, propertyId } });
      }
      if (prop && ev.event !== 'sync_error') {
        try {
          const res = await tracked(sb, cfg, { method: 'GET', path: '/channels', query: { 'filter[property_id]': prop.channex_property_id, 'pagination[limit]': 100 }, orgId: prop.org_id, propertyId: prop.channex_property_id, source: 'channels', request: opts.request });
          must(await sb.from('channex_properties').update({ channels: (Array.isArray(res.data) ? res.data : []).map(channelView) }).eq('channex_property_id', prop.channex_property_id), 'save channels');
        } catch (e) { console.error('[channex] channels after', ev.event + ':', e && e.message); }
      }
    } else if (MESSAGE_EVENTS.includes(ev.event)) {
      // guest messages from the booking sites (the Messages app in Channex): into the booking's conversation
      const prop = await propertyRow(sb, cfg, propertyId);
      if (!prop) status = 'ignored';
      else {
        result = await receiveChannex(sb, prop, ev.event, p, { now: opts.now });
        if (result.status === 'ignored') status = 'ignored';
      }
    } else status = 'ignored';
    await markEvent(sb, ev.id, status, null);
    return { status, result };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await markEvent(sb, ev.id, 'error', msg);
    return { status: 'error', error: msg };
  }
}

/**
 * The worker's retry pass: events not handled yet (the webhook ran out of time, the database or Channex failed), then
 * revisions that were saved but never acknowledged.
 *   opts {config, request, budgetMs = 6000, olderThanMs = 60000}
 */
export async function retryInbound(sb, opts = {}) {
  const cfg = opts.config || channexConfig();
  const out = { events: 0, done: 0, failed: 0, acks: 0, acked: 0 };
  if (!cfg.key) return out;
  const deadline = Date.now() + (opts.budgetMs || 6000);
  const olderThan = new Date(Date.now() - (opts.olderThanMs !== undefined ? opts.olderThanMs : EVENT_RETRY_AFTER_MS)).toISOString();
  const since = new Date(Date.now() - EVENT_RETRY_DAYS * 86400000).toISOString();
  const evs = must(await sb.from('channex_events').select('id, event, channex_property_id, revision_id, payload, status').in('status', ['new', 'error'])
    .lte('received_at', olderThan).gte('received_at', since).order('processed_at', { ascending: true, nullsFirst: true }).order('received_at').limit(10), 'load events') || [];
  for (const ev of evs) {
    if (Date.now() > deadline - 1500) break;
    out.events++;
    const r = await processEvent(sb, ev, { config: cfg, request: opts.request, timeoutMs: 5000 });
    if (r.status === 'error') out.failed++; else out.done++;
  }
  const revs = must(await sb.from('channex_revisions').select('revision_id').not('saved_at', 'is', null).is('acked_at', null)
    .or('ack_error.is.null,ack_error.not.like.invalid*').order('saved_at').limit(20), 'load unacked revisions') || [];
  for (const r of revs) {
    if (Date.now() > deadline - 1000) break;
    out.acks++;
    if ((await ackRevision(sb, r.revision_id, { config: cfg, request: opts.request, timeoutMs: 5000 })).acked) out.acked++;
  }
  return out;
}

/* ---------- nightly re-assignment ---------- */

/**
 * For every workspace with a connected building: stays starting in the next 14 days that have no unit, or a unit they
 * can no longer use (blocked, archived, retagged, double booked), get one when something has freed up. Locked
 * bookings never move. -> {orgs, moved, needsUnit}
 */
export async function reassignUpcoming(sb, opts = {}) {
  const cfg = opts.config || channexConfig();
  const props = must(await sb.from('channex_properties').select('org_id').eq('env', cfg.env).in('status', CONNECTED), 'load properties') || [];
  const out = { orgs: 0, moved: 0, needsUnit: 0 };
  const now = opts.now || Date.now();
  const today = todayMY(now);
  const horizon = addDays(today, opts.days || REASSIGN_DAYS);
  const nowLocal = nowMY(now);
  for (const orgId of [...new Set(props.map((p) => p.org_id))]) {
    out.orgs++;
    const ctx = {
      units: await records(sb, orgId, 'properties'),
      types: await records(sb, orgId, 'unitTypes'),
      buildings: await records(sb, orgId, 'buildings'),
      bookings: await records(sb, orgId, 'bookings', (q) => q.gt('data->>checkOut', today)),
      blocks: await records(sb, orgId, 'blocks', (q) => q.gt('data->>end', today))
    };
    const byId = new Map(ctx.units.map((u) => [u.id, u]));
    const list = ctx.bookings.filter((b) => live(b) && b.unitTypeId && b.checkIn <= horizon && b.status !== 'checked_out')
      .sort((a, b) => (a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : A.naturalCompare(a.id, b.id)));
    const changed = [];
    const moves = [];
    for (const b of list) {
      if (A.lockReason(b, nowLocal, ciTimeIn(b, ctx))) continue;
      const u = b.propertyId ? byId.get(b.propertyId) : null;
      const fine = u && A.activeUnit(u) && u.unitTypeId === b.unitTypeId && !A.clash(u.id, b.checkIn, b.checkOut, ctx, b.id);
      if (fine) continue;
      const r = assignOne(b, ctx, nowLocal, !!(u && u.unitTypeId !== b.unitTypeId));
      if (r.changed) {
        changed.push(b);
        moves.push({ at: nowLocal, by: 'system', cat: 'bookings', text: moveText(b, r.from, r.to, ctx.units) });
        if (b.propertyId) await resolveAlerts(sb, orgId, 'needs_unit', 'needs_unit:' + b.id);
      }
    }
    await saveRecords(sb, orgId, changed);
    await audit(sb, orgId, moves);
    out.moved += moves.length;
    out.needsUnit += list.filter((b) => b.needsUnit && !b.propertyId).length;
  }
  return out;
}

/** sha256 hex of the raw webhook body (channex_events.body_sha256: a replayed delivery is stored once). */
export const bodyHash = (raw) => createHash('sha256').update(raw).digest('hex');
