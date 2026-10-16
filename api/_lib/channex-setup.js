/* Channex setup: the group, property, room types and rate plans that mirror an Orbique building (plan sections 4 and 5).
 * Private module: Vercel does not expose files under api/_lib as endpoints.
 *
 *   ensureGroup(sb, org, opts)                         one Channex group per org
 *   ensureProperty(sb, org, building, opts)            one Channex property per building
 *   ensureRoomType(sb, org, prop, unitType, count, opts) one room type per unit type (count_of_rooms = active tagged units)
 *   ensureRatePlan(sb, org, prop, plan, opts)          one rate plan per Orbique rate plan
 *   setupBuilding(sb, org, buildingId, opts)           all of the above for one building (Connect)
 *   processSetupQueue(sb, opts)                        the worker's pass over channex_setup_queue (edits after connecting)
 *   buildingProblems(...)                              why a building cannot be connected yet, in plain English
 *
 * Every ensure* is idempotent: it looks in the mapping table first, updates Channex only when what Orbique would send
 * changed (synced_hash), and on a Channex "title has already been taken" adopts the existing object instead of failing.
 * Mapping rows carry env ('staging' or 'production') from CHANNEX_BASE_URL, so staging ids never mix with production.
 * opts: {config (channexConfig() override), byUser (auth user id for the call log), request (tests)}
 */
import { createHash } from 'node:crypto';
import { ApiError, conflict } from './http.js';
import { channexConfig, ChannexError } from './channex.js';
import { must, records, record, blob, archived, tracked, addAlert, todayMY, addDays, STATE_DAYS, selectAll } from './channex-db.js';

export const TIMEZONE = 'Asia/Kuala_Lumpur';
export const PROPERTY_SETTINGS = Object.freeze({
  min_stay_type: 'arrival',
  allow_availability_autoupdate_on_confirmation: true,
  allow_availability_autoupdate_on_modification: false,
  allow_availability_autoupdate_on_cancellation: false,
  state_length: STATE_DAYS
});
const MEALS = ['none', 'room_only', 'breakfast', 'half_board', 'full_board', 'all_inclusive', 'dinner', 'lunch', 'breakfast_and_lunch', 'lunch_and_dinner'];
// The property_type values Channex accepts (Create Property; any other value is refused with a 422). It affects
// billing: apartment is a vacation rental, hotel a hotel.
export const PROPERTY_TYPES = ['apart_hotel', 'apartment', 'boat', 'camping', 'capsule_hotel', 'chalet', 'country_house', 'farm_stay', 'guest_house',
  'holiday_home', 'holiday_park', 'homestay', 'hostel', 'hotel', 'inn', 'lodge', 'motel', 'resort', 'riad', 'ryokan', 'tent', 'villa'];
// Orbique names Channex does not have -> the nearest Channex type
const PROPERTY_TYPE_ALIASES = { aparthotel: 'apart_hotel', serviced_apartment: 'apart_hotel', bed_and_breakfast: 'guest_house', boutique_hotel: 'hotel' };
/** The Channex property_type for an Orbique building type; apartment when it has none or one Channex does not know. */
export function propertyType(v) {
  const k = String(v || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return PROPERTY_TYPES.includes(k) ? k : PROPERTY_TYPE_ALIASES[k] || 'apartment';
}

const str = (v, max = 255) => (v === undefined || v === null ? '' : String(v)).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const hash = (obj) => createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 32);
const cfgOf = (opts) => (opts && opts.config) || channexConfig();
const money = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null; };
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 ? n : null; };

/* ---------- what Orbique sends (pure) ---------- */

/** Group title: "<org name> · <first 8 of the org id>", unique per org. */
export const groupTitle = (org) => `${str(org.name, 200) || 'Orbique workspace'} · ${String(org.id).slice(0, 8)}`;

/** The property body (plan section 5). contact: {email, phone} fallbacks from the workspace brand or the caller. */
export function propertyBody(building, contact = {}) {
  const b = building || {};
  const out = {
    title: str(b.name, 255),
    currency: str(b.currency || 'MYR', 3).toUpperCase(),
    address: str(b.address, 255),
    city: str(b.city, 255),
    state: str(b.state, 255),
    zip_code: str(b.zip, 20),
    country: str(b.country || 'MY', 2).toUpperCase(),
    email: str(b.email || contact.email, 255),
    phone: str(b.phone || contact.phone, 32),
    timezone: TIMEZONE,
    property_type: propertyType(b.propertyType),
    settings: Object.assign({}, PROPERTY_SETTINGS)
  };
  for (const k of ['address', 'city', 'state', 'zip_code', 'email', 'phone']) if (!out[k]) delete out[k];
  return out;
}

/** Adults a unit type sleeps: maxGuests, else max(2, beds x 2); 1..18. */
export function occupancy(unitType) {
  const t = unitType || {};
  let n = posInt(t.maxGuests);
  if (!n) { const beds = Number(Array.isArray(t.beds) ? t.beds.length : t.beds); n = Math.max(2, (Number.isFinite(beds) ? beds : 1) * 2); }
  return Math.min(18, Math.max(1, Math.round(n)));
}

/** The room type body. count is the number of active units of the type (Channex needs at least 1). */
export function roomTypeBody(unitType, count, propertyId) {
  const out = {
    property_id: propertyId,
    title: str(unitType.name, 255) || 'Room',
    count_of_rooms: Math.max(1, Number.isInteger(count) ? count : 1),
    occ_adults: occupancy(unitType),
    occ_children: 0,
    occ_infants: 0,
    room_kind: 'room',
    meta: { orbique_type_id: unitType.id }
  };
  const d = str(unitType.description, 2000);
  if (d) out.content = { description: d };
  return out;
}

/** The rate plan body: per room, manual rates, one primary option at the room type's occupancy. */
export function ratePlanBody(plan, { propertyId, roomTypeId, occAdults, currency }) {
  const option = { occupancy: occAdults, is_primary: true };
  const rate = money(plan.defaultRate);
  if (rate) option.rate = rate;
  const out = {
    title: str(plan.name, 255) || 'Best Available Rate',
    property_id: propertyId,
    room_type_id: roomTypeId,
    sell_mode: 'per_room',
    rate_mode: 'manual',
    currency: str(currency || 'MYR', 3).toUpperCase(),
    meal_type: MEALS.includes(plan.meal) ? plan.meal : 'room_only',
    options: [option],
    meta: { orbique_plan_id: plan.id }
  };
  const ms = posInt(plan.minStay);
  if (ms) out.min_stay_arrival = ms;
  return out;
}

/** Fields that may change after creation (Channex keeps property_id, room_type_id, currency and sell_mode). */
const roomTypeUpdate = (body) => { const b = Object.assign({}, body); delete b.property_id; return b; };
const ratePlanUpdate = (body) => { const b = Object.assign({}, body); for (const k of ['property_id', 'room_type_id', 'currency', 'sell_mode']) delete b[k]; return b; };

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const PHONE_RE = /^\+?[\d\s()-]{7,20}$/;

/**
 * Why a building cannot be connected yet ([] when it can). units: every unit (properties record) of the workspace.
 * contact: the workspace brand's {email, phone}, used when the building has none. Channex needs an email and a phone
 * before a booking site can be connected to the property.
 */
export function buildingProblems(building, unitTypes, units, plans, contact = {}) {
  const out = [];
  if (!building) return ['That building was not found.'];
  if (archived(building)) out.push('This building is archived.');
  if (!str(building.name)) out.push('Give the building a name (it is the name guests see on booking sites).');
  if (!str(building.address)) out.push('Add the building address.');
  if (!str(building.city)) out.push('Add the city.');
  const email = str(building.email || (contact && contact.email));
  const phone = str(building.phone || (contact && contact.phone));
  if (!email) out.push('Add an email address for the building (or the business email in Brand). Booking sites need it.');
  else if (!EMAIL_RE.test(email)) out.push(`Check the building email address (${email}).`);
  if (!phone) out.push('Add a phone number for the building (or the business phone in Brand). Booking sites need it.');
  else if (!PHONE_RE.test(phone)) out.push(`Check the building phone number (${phone}). Use digits, spaces and +.`);
  if (!/^[A-Za-z]{2}$/.test(str(building.country || 'MY'))) out.push('The country should be a two-letter code such as MY.');
  if (!/^[A-Za-z]{3}$/.test(str(building.currency || 'MYR'))) out.push('The currency should be a three-letter code such as MYR.');
  const types = unitTypes.filter((t) => !archived(t));
  if (!types.length) out.push('Add at least one unit type to this building.');
  const typeIds = new Set(types.map((t) => t.id));
  const allTypeIds = new Set(unitTypes.map((t) => t.id));
  const names = new Map();
  for (const t of types) {
    const n = str(t.name).toLowerCase();
    if (!n) out.push('Every unit type needs a name.');
    else if (names.has(n)) out.push(`Two unit types are called "${str(t.name)}". Give each one its own name.`);
    names.set(n, t.id);
  }
  const live = units.filter((u) => !archived(u));
  const untagged = live.filter((u) => u.buildingId === building.id && !typeIds.has(u.unitTypeId));
  if (untagged.length) out.push(`Choose a unit type for every unit in this building (${untagged.slice(0, 5).map((u) => str(u.unitNo || u.name || u.id)).join(', ')}${untagged.length > 5 ? ' and ' + (untagged.length - 5) + ' more' : ''}).`);
  for (const t of types) {
    const n = live.filter((u) => u.unitTypeId === t.id).length;
    if (!n) out.push(`"${str(t.name)}" has no units yet.`);
    const ps = plans.filter((p) => p.unitTypeId === t.id && !archived(p));
    if (!ps.length) out.push(`"${str(t.name)}" needs a rate plan.`);
    const pn = new Set();
    for (const p of ps) { const k = str(p.name).toLowerCase(); if (pn.has(k)) out.push(`"${str(t.name)}" has two rate plans called "${str(p.name)}".`); pn.add(k); }
  }
  // a unit of another building tagged with this building's type would be counted here: say so
  const foreign = live.filter((u) => allTypeIds.has(u.unitTypeId) && u.buildingId && u.buildingId !== building.id);
  if (foreign.length) out.push(`Some units of another building use this building's unit types (${foreign.slice(0, 3).map((u) => str(u.unitNo || u.name || u.id)).join(', ')}).`);
  return [...new Set(out)];
}

/* ---------- Channex helpers ---------- */

const titleTaken = (e) => e instanceof ChannexError && e.status === 422 && e.errors && e.errors.details && Object.prototype.hasOwnProperty.call(e.errors.details, 'title');

/** Find an object by exact title in a Channex list (paged, up to 2000 objects). */
async function findByTitle(sb, cfg, call, path, query, title) {
  for (let page = 1; page <= 20; page++) {
    const res = await tracked(sb, cfg, Object.assign({}, call, { method: 'GET', path, body: null, query: Object.assign({}, query, { 'pagination[page]': page, 'pagination[limit]': 100 }) }));
    const rows = Array.isArray(res.data) ? res.data : [];
    const hit = rows.find((r) => r && r.attributes && r.attributes.title === title);
    if (hit) return hit.id || hit.attributes.id;
    const total = res.meta && Number(res.meta.total);
    if (rows.length < 100 || (total && page * 100 >= total)) break;
  }
  return null;
}

/** When a Channex id is already mapped to another Orbique object, say so instead of mixing them. */
async function assertFree(sb, table, idCol, channexId, keyCol, key, label) {
  const other = must(await sb.from(table).select(keyCol).eq(idCol, channexId).maybeSingle(), 'check ' + table);
  if (other && other[keyCol] !== key) throw conflict('channex-clash', `${label} is already linked to something else in Orbique. Rename it in Orbique and try again.`);
}

/* ---------- ensure* ---------- */

/** The org's Channex group id (created on first use). */
export async function ensureGroup(sb, org, opts = {}) {
  const cfg = cfgOf(opts);
  const row = must(await sb.from('channex_groups').select('group_id').eq('org_id', org.id).eq('env', cfg.env).maybeSingle(), 'load group');
  if (row) return row.group_id;
  const title = groupTitle(org);
  const call = { orgId: org.id, source: 'setup', byUser: opts.byUser, request: opts.request };
  let groupId;
  try {
    const res = await tracked(sb, cfg, Object.assign({}, call, { method: 'POST', path: '/groups', body: { group: { title } } }));
    groupId = res.data && res.data.id;
  } catch (e) {
    if (!titleTaken(e)) throw e;
    groupId = await findByTitle(sb, cfg, call, '/groups', {}, title);
    if (!groupId) throw e;
  }
  if (!groupId) throw new ApiError(502, 'channex', 'Channex did not return the new group. Please try again.');
  const ins = await sb.from('channex_groups').upsert({ org_id: org.id, env: cfg.env, group_id: groupId }, { onConflict: 'org_id,env', ignoreDuplicates: true });
  must(ins, 'save group');
  const again = must(await sb.from('channex_groups').select('group_id').eq('org_id', org.id).eq('env', cfg.env).maybeSingle(), 'load group');
  return again ? again.group_id : groupId;
}

/** The workspace brand's business email and phone (Brand page): {email, phone}. */
export async function brandContact(sb, orgId) {
  const brand = await blob(sb, orgId, 'workspaceBrand');
  const b = brand && typeof brand === 'object' ? brand : {};
  return { email: str(b.email, 255), phone: str(b.phone, 32) };
}

/** Contact fallbacks for the property: the workspace brand, then the person connecting. */
async function contactFor(sb, org, opts) {
  const b = await brandContact(sb, org.id);
  return { email: b.email || opts.email || '', phone: b.phone || '' };
}

/**
 * The building's channex_properties row (created on first use, status 'setup').
 * opts.update: send the current building details to Channex (after a building edit).
 */
export async function ensureProperty(sb, org, building, opts = {}) {
  const cfg = cfgOf(opts);
  const sel = 'org_id, env, building_id, channex_property_id, currency, status, full_sync_at, full_sync_requested_at';
  const row = must(await sb.from('channex_properties').select(sel).eq('org_id', org.id).eq('env', cfg.env).eq('building_id', building.id).maybeSingle(), 'load property');
  const call = { orgId: org.id, source: 'setup', byUser: opts.byUser, request: opts.request };
  const body = propertyBody(building, await contactFor(sb, org, opts));
  if (row) {
    if (opts.update) {
      const upd = Object.assign({}, body);
      delete upd.currency; // rate plans keep the currency they were created with
      await tracked(sb, cfg, Object.assign({}, call, { propertyId: row.channex_property_id, method: 'PUT', path: '/properties/' + row.channex_property_id, body: { property: upd } }));
    }
    return row;
  }
  const groupId = await ensureGroup(sb, org, opts);
  // adopt a property of the same title in our group (a connect that stopped before saving the mapping)
  let propertyId = await findByTitle(sb, cfg, call, '/properties', { 'filter[group_id]': groupId }, body.title);
  if (propertyId) {
    await assertFree(sb, 'channex_properties', 'channex_property_id', propertyId, 'building_id', building.id, `The Channex property "${body.title}"`);
    await tracked(sb, cfg, Object.assign({}, call, { propertyId, method: 'PUT', path: '/properties/' + propertyId, body: { property: Object.assign({}, body, { currency: undefined }) } }));
  } else {
    const res = await tracked(sb, cfg, Object.assign({}, call, { method: 'POST', path: '/properties', body: { property: Object.assign({}, body, { group_id: groupId }) } }));
    propertyId = res.data && res.data.id;
  }
  if (!propertyId) throw new ApiError(502, 'channex', 'Channex did not return the new property. Please try again.');
  must(await sb.from('channex_properties').upsert({ org_id: org.id, env: cfg.env, building_id: building.id, channex_property_id: propertyId, currency: body.currency, status: 'setup' },
    { onConflict: 'org_id,env,building_id', ignoreDuplicates: true }), 'save property');
  return must(await sb.from('channex_properties').select(sel).eq('org_id', org.id).eq('env', cfg.env).eq('building_id', building.id).single(), 'load property');
}

/**
 * The unit type's channex_room_types row, created or brought up to date. prop: the channex_properties row.
 * Resolves {row, created}.
 */
export async function ensureRoomType(sb, org, prop, unitType, count, opts = {}) {
  const cfg = cfgOf(opts);
  const pid = prop.channex_property_id;
  const row = must(await sb.from('channex_room_types').select('*').eq('org_id', org.id).eq('env', cfg.env).eq('unit_type_id', unitType.id).maybeSingle(), 'load room type');
  const call = { orgId: org.id, propertyId: pid, source: 'setup', byUser: opts.byUser, request: opts.request };
  if (archived(unitType)) {
    // Channex cannot delete a room type that channels map; keep it, mark it retired (availability 0 goes out)
    if (row && !row.retired) must(await sb.from('channex_room_types').update({ retired: true }).eq('org_id', org.id).eq('env', cfg.env).eq('unit_type_id', unitType.id), 'retire room type');
    return { row: row ? Object.assign({}, row, { retired: true }) : null, created: false };
  }
  const body = roomTypeBody(unitType, count, pid);
  const h = hash(roomTypeUpdate(body));
  if (row && row.room_type_id && row.channex_property_id === pid) {
    if (row.synced_hash !== h || row.retired) {
      if (row.synced_hash !== h) await tracked(sb, cfg, Object.assign({}, call, { method: 'PUT', path: '/room_types/' + row.room_type_id, body: { room_type: roomTypeUpdate(body) } }));
      must(await sb.from('channex_room_types').update({ synced_hash: h, count_of_rooms: body.count_of_rooms, retired: false }).eq('org_id', org.id).eq('env', cfg.env).eq('unit_type_id', unitType.id), 'save room type');
    }
    return { row: Object.assign({}, row, { synced_hash: h, count_of_rooms: body.count_of_rooms, retired: false }), created: false };
  }
  let id;
  try {
    const res = await tracked(sb, cfg, Object.assign({}, call, { method: 'POST', path: '/room_types', body: { room_type: body } }));
    id = res.data && res.data.id;
  } catch (e) {
    if (!titleTaken(e)) throw e;
    id = await findByTitle(sb, cfg, call, '/room_types', { 'filter[property_id]': pid }, body.title);
    if (!id) throw e;
    await assertFree(sb, 'channex_room_types', 'room_type_id', id, 'unit_type_id', unitType.id, `The room type "${body.title}"`);
    await tracked(sb, cfg, Object.assign({}, call, { method: 'PUT', path: '/room_types/' + id, body: { room_type: roomTypeUpdate(body) } }));
  }
  if (!id) throw new ApiError(502, 'channex', 'Channex did not return the new room type. Please try again.');
  const saved = { org_id: org.id, env: cfg.env, unit_type_id: unitType.id, channex_property_id: pid, room_type_id: id, count_of_rooms: body.count_of_rooms, synced_hash: h, retired: false };
  must(await sb.from('channex_room_types').upsert(saved, { onConflict: 'org_id,env,unit_type_id' }), 'save room type');
  return { row: saved, created: true };
}

/**
 * The plan's channex_rate_plans row, created or brought up to date.
 *   opts.roomType  the channex_room_types row of the plan's unit type (required), opts.unitType  its record
 * Resolves {row, created}.
 */
export async function ensureRatePlan(sb, org, prop, plan, opts = {}) {
  const cfg = cfgOf(opts);
  const pid = prop.channex_property_id;
  const rt = opts.roomType;
  const row = must(await sb.from('channex_rate_plans').select('*').eq('org_id', org.id).eq('env', cfg.env).eq('plan_id', plan.id).maybeSingle(), 'load rate plan');
  const call = { orgId: org.id, propertyId: pid, source: 'setup', byUser: opts.byUser, request: opts.request };
  if (archived(plan) || !rt || rt.retired) {
    if (row && !row.retired) must(await sb.from('channex_rate_plans').update({ retired: true }).eq('org_id', org.id).eq('env', cfg.env).eq('plan_id', plan.id), 'retire rate plan');
    return { row: row ? Object.assign({}, row, { retired: true }) : null, created: false };
  }
  const body = ratePlanBody(plan, { propertyId: pid, roomTypeId: rt.room_type_id, occAdults: occupancy(opts.unitType || {}), currency: prop.currency });
  const h = hash(ratePlanUpdate(body));
  if (row && row.rate_plan_id && row.unit_type_id === plan.unitTypeId) {
    if (row.synced_hash !== h || row.retired) {
      if (row.synced_hash !== h) await tracked(sb, cfg, Object.assign({}, call, { method: 'PUT', path: '/rate_plans/' + row.rate_plan_id, body: { rate_plan: ratePlanUpdate(body) } }));
      must(await sb.from('channex_rate_plans').update({ synced_hash: h, retired: false }).eq('org_id', org.id).eq('env', cfg.env).eq('plan_id', plan.id), 'save rate plan');
    }
    return { row: Object.assign({}, row, { synced_hash: h, retired: false }), created: false };
  }
  // a plan moved to another unit type: Channex's room_type_id is fixed, so it gets a new rate plan
  let id;
  try {
    const res = await tracked(sb, cfg, Object.assign({}, call, { method: 'POST', path: '/rate_plans', body: { rate_plan: body } }));
    id = res.data && res.data.id;
  } catch (e) {
    if (!titleTaken(e)) throw e;
    const list = await selectChannexRatePlans(sb, cfg, call, pid);
    const hit = list.find((r) => r.title === body.title && r.room_type_id === rt.room_type_id);
    if (!hit) throw e;
    id = hit.id;
    await assertFree(sb, 'channex_rate_plans', 'rate_plan_id', id, 'plan_id', plan.id, `The rate plan "${body.title}"`);
    await tracked(sb, cfg, Object.assign({}, call, { method: 'PUT', path: '/rate_plans/' + id, body: { rate_plan: ratePlanUpdate(body) } }));
  }
  if (!id) throw new ApiError(502, 'channex', 'Channex did not return the new rate plan. Please try again.');
  const saved = { org_id: org.id, env: cfg.env, plan_id: plan.id, unit_type_id: plan.unitTypeId, rate_plan_id: id, synced_hash: h, retired: false };
  must(await sb.from('channex_rate_plans').upsert(saved, { onConflict: 'org_id,env,plan_id' }), 'save rate plan');
  return { row: saved, created: true };
}

/** Rate plans of a Channex property: [{id, title, room_type_id}] (title is unique per room type, not per property). */
async function selectChannexRatePlans(sb, cfg, call, propertyId) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const res = await tracked(sb, cfg, Object.assign({}, call, { method: 'GET', path: '/rate_plans', body: null, query: { 'filter[property_id]': propertyId, 'pagination[page]': page, 'pagination[limit]': 100 } }));
    const rows = Array.isArray(res.data) ? res.data : [];
    for (const r of rows) if (r && r.attributes) out.push({ id: r.id || r.attributes.id, title: r.attributes.title, room_type_id: r.attributes.room_type_id });
    if (rows.length < 100) break;
  }
  return out;
}

/** Mark 500 days of a new room type or rate plan for sending (the triggers marked them before the mapping existed). */
export async function markAll(sb, prop, kind, targetId, reason = 'setup') {
  const t0 = todayMY();
  must(await sb.from('channex_outbox').insert({ org_id: prop.org_id, channex_property_id: prop.channex_property_id, kind, target_id: targetId, date_from: t0, date_to: addDays(t0, STATE_DAYS - 1), reason }), 'mark ' + kind);
}

/* ---------- a whole building ---------- */

/** The building's unit types, units and plans: {building, unitTypes, units, plans}. units: every unit in the workspace. */
export async function loadBuilding(sb, orgId, buildingId) {
  const [building, unitTypes, units, plans] = await Promise.all([
    record(sb, orgId, 'buildings', buildingId),
    records(sb, orgId, 'unitTypes', (q) => q.eq('data->>buildingId', buildingId)),
    records(sb, orgId, 'properties'),
    records(sb, orgId, 'ratePlans')
  ]);
  const typeIds = new Set(unitTypes.map((t) => t.id));
  return { building, unitTypes, units, plans: plans.filter((p) => typeIds.has(p.unitTypeId)) };
}

const activeCount = (units, typeId) => units.filter((u) => !archived(u) && u.unitTypeId === typeId).length;

/**
 * Connect step 1: group, property, room types and rate plans for a building. Safe to run again after a partial failure.
 * New room types or plans of an already connected building get 500 days marked for sending.
 * Resolves {property, roomTypes: [row], ratePlans: [row], created: {roomTypes, ratePlans}}.
 */
export async function setupBuilding(sb, org, buildingId, opts = {}) {
  const data = opts.data || await loadBuilding(sb, org.id, buildingId);
  if (!data.building) throw new ApiError(404, 'no-building', 'That building was not found.');
  const prop = await ensureProperty(sb, org, data.building, opts);
  const connected = ['syncing', 'live', 'paused', 'error'].includes(prop.status);
  const out = { property: prop, roomTypes: [], ratePlans: [], created: { roomTypes: 0, ratePlans: 0 } };
  const rts = new Map();
  for (const t of data.unitTypes) {
    const r = await ensureRoomType(sb, org, prop, t, activeCount(data.units, t.id), opts);
    if (r.row) { rts.set(t.id, r.row); out.roomTypes.push(r.row); }
    if (r.created) { out.created.roomTypes++; if (connected) await markAll(sb, prop, 'availability', t.id); }
  }
  const typeById = new Map(data.unitTypes.map((t) => [t.id, t]));
  for (const p of data.plans) {
    const r = await ensureRatePlan(sb, org, prop, p, Object.assign({}, opts, { roomType: rts.get(p.unitTypeId), unitType: typeById.get(p.unitTypeId) }));
    if (r.row) out.ratePlans.push(r.row);
    if (r.created) { out.created.ratePlans++; if (connected) await markAll(sb, prop, 'restrictions', p.id); }
  }
  return out;
}

/* ---------- the setup queue (worker) ---------- */

/**
 * Work through channex_setup_queue (filled by the 0006 triggers after a building is connected).
 *   opts {budgetMs = 8000, orgId, config, request}
 * A retryable Channex failure stops the pass and leaves the rest for the next tick; anything else becomes a
 * sync_error alert and the row is dropped. Resolves {done, failed, left}.
 */
export async function processSetupQueue(sb, opts = {}) {
  const cfg = cfgOf(opts);
  const deadline = Date.now() + (opts.budgetMs || 8000);
  const rows = must(await (opts.orgId ? sb.from('channex_setup_queue').select('*').eq('org_id', opts.orgId) : sb.from('channex_setup_queue').select('*')).order('id').limit(200), 'load setup queue');
  const out = { done: 0, failed: 0, left: 0 };
  const orgs = new Map();
  for (let i = 0; i < rows.length; i++) {
    if (Date.now() > deadline) { out.left = rows.length - i; break; }
    const q = rows[i];
    try {
      if (!orgs.has(q.org_id)) orgs.set(q.org_id, must(await sb.from('orgs').select('id, name, status').eq('id', q.org_id).maybeSingle(), 'load workspace'));
      const org = orgs.get(q.org_id);
      if (org) await setupOne(sb, org, q, Object.assign({}, opts, { config: cfg }));
      must(await sb.from('channex_setup_queue').delete().eq('id', q.id), 'clear setup row');
      out.done++;
    } catch (e) {
      if (e instanceof ChannexError && e.retryable) { out.left = rows.length - i; break; }
      out.failed++;
      console.error('[channex] setup', q.kind, q.ref + ':', e && e.message ? e.message : String(e));
      await addAlert(sb, { orgId: q.org_id, kind: 'sync_error', message: 'Could not update the channel manager: ' + (e && e.message ? e.message : 'unknown error'), ref: { key: 'setup:' + q.kind + ':' + q.ref, kind: q.kind, ref: q.ref } });
      if (!(e instanceof ApiError && e.status >= 500)) must(await sb.from('channex_setup_queue').delete().eq('id', q.id), 'clear setup row');
    }
  }
  return out;
}

const CONNECTED = ['syncing', 'live', 'paused', 'error'];

async function connectedProperty(sb, org, cfg, buildingId) {
  if (!buildingId) return null;
  const p = must(await sb.from('channex_properties').select('org_id, env, building_id, channex_property_id, currency, status').eq('org_id', org.id).eq('env', cfg.env).eq('building_id', buildingId).maybeSingle(), 'load property');
  return p && CONNECTED.includes(p.status) ? p : null;
}

/** One queue row. Rows for buildings that are not connected (any more) are simply dropped. */
async function setupOne(sb, org, q, opts) {
  const cfg = opts.config;
  if (q.kind === 'building_update') {
    const prop = await connectedProperty(sb, org, cfg, q.ref);
    const b = prop && await record(sb, org.id, 'buildings', q.ref);
    if (b) await ensureProperty(sb, org, b, Object.assign({}, opts, { update: true }));
    // Channex keeps the currency its rate plans were created with; the Properties page locks it while connected, so
    // a change can only come from elsewhere: say so instead of letting the prices change meaning
    const cur = b && str(b.currency || 'MYR', 3).toUpperCase();
    if (b && prop.currency && cur !== prop.currency) {
      await addAlert(sb, { orgId: org.id, kind: 'currency_changed', message: `${str(b.name) || 'A building'} now uses ${cur}, but its channels still get prices in ${prop.currency}. Channex cannot change the currency of rate plans it already has, so change the building back to ${prop.currency}, or contact Orbique to move it to ${cur}.`, ref: { key: 'currency:' + prop.channex_property_id + ':' + cur, propertyId: prop.channex_property_id, buildingId: b.id, from: prop.currency, to: cur } });
    }
    return;
  }
  let typeId = q.ref;
  let plan = null;
  if (q.kind === 'rate_plan_create' || q.kind === 'rate_plan_update') {
    plan = await record(sb, org.id, 'ratePlans', q.ref);
    if (!plan) { // deleted: retire the mapping
      must(await sb.from('channex_rate_plans').update({ retired: true }).eq('org_id', org.id).eq('env', cfg.env).eq('plan_id', q.ref), 'retire rate plan');
      return;
    }
    typeId = plan.unitTypeId;
  }
  const type = typeId && await record(sb, org.id, 'unitTypes', typeId);
  if (!type) {
    if (q.kind !== 'rate_plan_create' && q.kind !== 'rate_plan_update') must(await sb.from('channex_room_types').update({ retired: true }).eq('org_id', org.id).eq('env', cfg.env).eq('unit_type_id', q.ref), 'retire room type');
    return;
  }
  const prop = await connectedProperty(sb, org, cfg, type.buildingId);
  if (!prop) return;
  const units = await records(sb, org.id, 'properties', (x) => x.eq('data->>unitTypeId', type.id));
  const rt = await ensureRoomType(sb, org, prop, type, activeCount(units, type.id), opts);
  if (rt.created) await markAll(sb, prop, 'availability', type.id);
  const plans = plan ? [plan] : q.kind === 'unit_type_create' || q.kind === 'unit_type_update' ? await records(sb, org.id, 'ratePlans', (x) => x.eq('data->>unitTypeId', type.id)) : [];
  for (const p of plans) {
    const r = await ensureRatePlan(sb, org, prop, p, Object.assign({}, opts, { roomType: rt.row, unitType: type }));
    if (r.created) await markAll(sb, prop, 'restrictions', p.id);
  }
}

/** Pending setup work for an org's targets (the sender keeps marks for objects that are about to be created). */
export async function pendingSetupRefs(sb, orgId) {
  const rows = await selectAll(() => sb.from('channex_setup_queue').select('kind, ref').eq('org_id', orgId).order('id'), 'load setup queue');
  return new Set(rows.map((r) => r.ref));
}
