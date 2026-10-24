/* Bookings from a workspace's own website (api/public.js). Server only.
 * Private module: Vercel does not expose files under api/_lib as endpoints.
 *
 * Settings: the workspace's `website` blob (edited by Orbique; see DEFAULTS):
 *   {slug, enabled, origins: [extra https origins], types: {key: {typeId, name, plans: {flexible, nonref, weekly}}},
 *    publicMarkupPct, baseGuests, maxGuests, extraBedFee, holdMinutes, freeCancelDays, emailFrom, brand}
 * Prices: a night's rate is the plan's own Orbique rate (channelRates days, else its parent plan with the rule, else
 * defaultRate) with the workspace's last-minute deal, the same number the booking sites get before their markup.
 * Members pay that; everyone else pays it plus publicMarkupPct. A fifth guest adds the extra bed fee per night.
 *
 *   quoteStay(input)            pure: one unit type's options for a stay (unit-tested)
 *   calendarDays(input)         pure: nightly prices and restrictions for a date picker
 *   memberToken / readMemberToken, stripeSignatureOk, formEncode   pure helpers
 *   loadSite, availability, calendar, checkout, memberStart, memberVerify, stripeEvent, releaseHolds   database
 *
 * Holds: checkout saves a pending booking with webHold: true (it closes the nights on every site straight away, but
 * raises no alert, see 0015), assigns a unit, then opens a Stripe Checkout Session in MYR. Payment confirms it (the
 * alert goes out then); an expired session, or the worker after holdMinutes plus a margin, cancels it.
 */
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { ApiError, bad, conflict, tooMany, text, email as emailField, phone as phoneField } from './http.js';
import { config as sbConfig } from './supabase.js';
import { must, records, record, blob, todayMY, addDays, daysBetween, isIso, archived } from './channex-db.js';
import { planRate, restrictionValue, lastMinuteFactor } from './channex-sync.js';
import {
  newBookingId, newBookingFields, nowMY, countryName, FEE_PCT, assignContext, assignOne, ciTimeIn, saveRecords,
  bookingAlerts, detectConflicts, audit, moveText
} from './channex-bookings.js';
import { emailConfig } from './alerts.js';

export const DEFAULTS = {
  enabled: true,
  publicMarkupPct: 0,
  baseGuests: 4,
  maxGuests: 5,
  extraBedFee: 60,
  holdMinutes: 30,
  freeCancelDays: 7,
  maxNights: 60,
  currency: 'MYR'
};
export const OPTION_ORDER = ['flexible', 'weekly', 'nonref'];
const OPTION_NAME = { flexible: 'Flexible', weekly: 'Weekly stay (7+ nights)', nonref: 'Non-refundable' };
const MAX_CALENDAR_DAYS = 400;
const MAX_OPEN_HOLDS = 20;            // per workspace: a hold blocks real nights, so a flood of them must stop early
const MAX_HOLDS_PER_EMAIL = 2;
const CODE_MINUTES = 10;
const CODE_TRIES = 5;
const CODES_PER_15_MIN = 3;
export const MEMBER_DAYS = 30;
const HOLD_MARGIN_MIN = 15;           // the worker releases a hold this long after Stripe's session should have expired

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (v) => Math.round(num(v) * 100) / 100;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const live = (b) => !!b && b.status !== 'cancelled' && b.status !== 'deleted';

/* ---------- settings ---------- */

/** The website settings with defaults filled in. */
export function siteSettings(v) {
  const s = Object.assign({}, DEFAULTS, isObj(v) ? v : {});
  s.publicMarkupPct = Math.min(100, Math.max(0, num(s.publicMarkupPct)));
  s.baseGuests = Math.max(1, Math.round(num(s.baseGuests)) || DEFAULTS.baseGuests);
  s.maxGuests = Math.max(s.baseGuests, Math.round(num(s.maxGuests)) || s.baseGuests);
  s.extraBedFee = Math.max(0, num(s.extraBedFee));
  s.holdMinutes = Math.min(120, Math.max(30, Math.round(num(s.holdMinutes)) || DEFAULTS.holdMinutes)); // Stripe: at least 30
  s.freeCancelDays = Math.max(0, Math.round(num(s.freeCancelDays)));
  s.maxNights = Math.min(180, Math.max(1, Math.round(num(s.maxNights)) || DEFAULTS.maxNights));
  s.types = isObj(s.types) ? s.types : {};
  s.siteUrl = typeof s.siteUrl === 'string' && /^https:\/\/[a-z0-9.-]+$/i.test(s.siteUrl) ? s.siteUrl : null;
  s.origins = Array.isArray(s.origins) ? s.origins.filter((o) => typeof o === 'string' && /^https:\/\/[a-z0-9.-]+$/i.test(o)) : [];
  return s;
}

const DEFAULT_ORIGINS = ['https://staykozi.com', 'https://www.staykozi.com', 'https://staykozi.my', 'https://www.staykozi.my'];
const PREVIEW = /^https:\/\/(stay)?kozi[a-z0-9-]*\.vercel\.app$/;

/** Is this browser origin allowed to call the public API (for the workspace's settings, or any site when null)? */
export function originAllowed(origin, site) {
  if (!origin || typeof origin !== 'string') return false;
  if (DEFAULT_ORIGINS.includes(origin) || PREVIEW.test(origin)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true; // the website's own dev server
  return !!site && site.origins.includes(origin);
}

/* ---------- pricing (pure) ---------- */

/**
 * One unit type's ways to book a stay.
 *   input {plans: Map id -> plan, days: Map planId -> {iso: day}, type: {plans: {flexible, nonref, weekly}},
 *          checkIn, checkOut, guests, today, lastMinute, settings}
 * -> {nights: n, options: [{plan, planId, name, refundable, bookable, why, nightly: [{date, member, public}],
 *     extraBed, memberTotal, publicTotal, freeCancelUntil}], best: the first bookable option in OPTION_ORDER, or null}
 * Totals are rounded per night to sen; the extra bed is per night for guests above baseGuests.
 */
export function quoteStay(input) {
  const s = input.settings || siteSettings(null);
  const nights = daysBetween(input.checkIn, input.checkOut);
  const dates = [];
  for (let d = input.checkIn; d < input.checkOut; d = addDays(d, 1)) dates.push(d);
  const extraGuests = Math.max(0, (input.guests || 1) - s.baseGuests);
  const extraBed = money(extraGuests * s.extraBedFee * nights);
  const options = [];
  for (const key of OPTION_ORDER) {
    const planId = input.type && input.type.plans && input.type.plans[key];
    const plan = planId && input.plans.get(planId);
    if (!plan || archived(plan)) continue;
    const ctx = (d) => ({ plans: input.plans, dayOf: (pid) => ((input.days.get(pid) || {})[d]) });
    const own = input.days.get(planId) || {};
    const opt = { plan: key, planId, name: OPTION_NAME[key], refundable: key !== 'nonref', bookable: true, why: null, nightly: [], extraBed, memberTotal: 0, publicTotal: 0 };
    const first = restrictionValue(plan, own[input.checkIn], { ctx: ctx(input.checkIn) });
    const last = restrictionValue(plan, own[input.checkOut], { ctx: ctx(input.checkOut) });
    if (nights < first.min_stay_arrival) { opt.bookable = false; opt.why = 'min_stay'; opt.minStay = first.min_stay_arrival; }
    else if (first.max_stay && nights > first.max_stay) { opt.bookable = false; opt.why = 'max_stay'; opt.maxStay = first.max_stay; }
    else if (first.closed_to_arrival) { opt.bookable = false; opt.why = 'no_arrival'; }
    else if (last.closed_to_departure) { opt.bookable = false; opt.why = 'no_departure'; }
    let memberSum = 0, publicSum = 0;
    for (const d of dates) {
      const r = restrictionValue(plan, own[d], { ctx: ctx(d) });
      if (r.stop_sell && opt.bookable) { opt.bookable = false; opt.why = 'closed'; }
      let rate = r.rate !== undefined ? Number(r.rate) : null;
      if (rate === null || !(rate > 0)) { if (opt.bookable) { opt.bookable = false; opt.why = 'no_rate'; } rate = 0; }
      const f = lastMinuteFactor(input.lastMinute, d, input.today);
      const member = money(rate * f);
      const pub = money(member * (1 + s.publicMarkupPct / 100));
      opt.nightly.push({ date: d, member, public: pub });
      memberSum += member; publicSum += pub;
    }
    opt.memberTotal = money(memberSum + extraBed);
    opt.publicTotal = money(publicSum + extraBed);
    if (opt.refundable && s.freeCancelDays > 0) {
      const until = addDays(input.checkIn, -s.freeCancelDays);
      opt.freeCancelUntil = until > input.today ? until : null;
    }
    options.push(opt);
  }
  // the weekly plan is only worth showing once it applies
  const shown = options.filter((o) => o.plan !== 'weekly' || o.bookable);
  const best = shown.find((o) => o.bookable) || null;
  return { nights, options: shown, best };
}

/**
 * Nightly prices for a date picker: the flexible plan, else the non-refundable one when flexible is closed that night.
 *   input {plans, days, type, dates: [iso], avail: Map iso -> free units, today, lastMinute, settings}
 * -> [{date, available, member, public, refundable, minStay, noArrival, noDeparture}] (prices null when closed)
 */
export function calendarDays(input) {
  const s = input.settings || siteSettings(null);
  const out = [];
  const pick = (key) => { const id = input.type && input.type.plans && input.type.plans[key]; const p = id && input.plans.get(id); return p && !archived(p) ? [id, p] : null; };
  const flex = pick('flexible'), nonref = pick('nonref');
  for (const d of input.dates) {
    const row = { date: d, available: Math.max(0, input.avail.get(d) || 0), member: null, public: null, refundable: null, minStay: 1, noArrival: false, noDeparture: false };
    for (const [key, hit] of [['flexible', flex], ['nonref', nonref]]) {
      if (!hit) continue;
      const [id, plan] = hit;
      const r = restrictionValue(plan, (input.days.get(id) || {})[d], { ctx: { plans: input.plans, dayOf: (pid) => ((input.days.get(pid) || {})[d]) } });
      if (r.stop_sell || r.rate === undefined || !(Number(r.rate) > 0)) continue;
      row.member = money(Number(r.rate) * lastMinuteFactor(input.lastMinute, d, input.today));
      row.public = money(row.member * (1 + s.publicMarkupPct / 100));
      row.refundable = key === 'flexible';
      row.minStay = r.min_stay_arrival;
      row.noArrival = r.closed_to_arrival;
      row.noDeparture = r.closed_to_departure;
      break;
    }
    if (row.member === null) row.available = 0;
    out.push(row);
  }
  return out;
}

export function notes(s) {
  return {
    tourismTax: 'Malaysia charges a tourism tax of RM10 per room per night to guests who are not Malaysian. It is paid at check-in and is not included in the price.',
    cancellation: s.freeCancelDays > 0 ? `Free cancellation until ${s.freeCancelDays} days before arrival.` : 'Cancellation terms are shown at booking.',
    nonRefundable: 'Non-refundable: the lower price cannot be refunded if you cancel or change your dates.',
    extraBed: s.extraBedFee > 0 ? `A ${s.baseGuests + 1}th guest sleeps on an extra bed for RM${s.extraBedFee} a night.` : null,
    currency: 'Prices are in Malaysian ringgit (MYR).'
  };
}

/* ---------- members (pure helpers) ---------- */

function tokenSecret(env = process.env) {
  const own = String(env.MEMBER_TOKEN_SECRET || '').trim();
  if (own) return own;
  const key = sbConfig().key;
  if (!key) throw new ApiError(500, 'not-configured', 'Member sign-in is not set up yet.');
  return createHmac('sha256', key).update('orbique-web-member-v1').digest('base64url');
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');

/** A signed member token: v1.<payload>.<signature>. payload {o: orgId, e: email, x: expiry (unix seconds)}. */
export function memberToken(orgId, email, opts = {}) {
  const exp = Math.floor((opts.now || Date.now()) / 1000) + (opts.days || MEMBER_DAYS) * 86400;
  const payload = b64(JSON.stringify({ o: orgId, e: email, x: exp }));
  const sig = createHmac('sha256', opts.secret || tokenSecret()).update('v1.' + payload).digest('base64url');
  return { token: 'v1.' + payload + '.' + sig, expiresAt: new Date(exp * 1000).toISOString() };
}

/** The token's {orgId, email} when it is ours, unexpired and for this workspace; otherwise null. */
export function readMemberToken(token, orgId, opts = {}) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const m = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!m) return null;
  const want = createHmac('sha256', opts.secret || tokenSecret()).update('v1.' + m[1]).digest();
  const got = Buffer.from(m[2], 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!isObj(p) || p.o !== orgId || typeof p.e !== 'string' || !(p.x * 1000 > (opts.now || Date.now()))) return null;
  return { orgId: p.o, email: p.e };
}

const codeHash = (orgId, email, code) => createHash('sha256').update(orgId + ':' + email + ':' + code).digest('hex');

/* ---------- Stripe (pure helpers) ---------- */

/** application/x-www-form-urlencoded with Stripe's nested keys (a[b][0][c]=v). */
export function formEncode(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? prefix + '[' + k + ']' : k;
    if (Array.isArray(v)) v.forEach((x, i) => (isObj(x) ? formEncode(x, key + '[' + i + ']', out) : out.push(encodeURIComponent(key + '[' + i + ']') + '=' + encodeURIComponent(String(x)))));
    else if (isObj(v)) formEncode(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  }
  return prefix ? out : out.join('&');
}

/** Check a Stripe-Signature header (t=…,v1=…) against the raw body; at most 5 minutes old. */
export function stripeSignatureOk(raw, header, secret, nowMs = Date.now()) {
  if (!secret || typeof header !== 'string') return false;
  const parts = header.split(',').map((x) => x.trim().split('='));
  const t = Number((parts.find((p) => p[0] === 't') || [])[1]);
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > 300) return false;
  const want = createHmac('sha256', secret).update(t + '.' + Buffer.from(raw).toString('utf8')).digest();
  return parts.filter((p) => p[0] === 'v1' && /^[0-9a-f]{64}$/.test(p[1] || '')).some((p) => {
    const got = Buffer.from(p[1], 'hex');
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

export function stripeConfig(env = process.env) {
  const key = String(env.STRIPE_SECRET_KEY || '').trim();
  return {
    key,
    webhookSecret: String(env.STRIPE_WEBHOOK_SECRET || '').trim(),
    configured: /^(sk|rk)_(live|test)_/.test(key),
    baseUrl: String(env.STRIPE_API_URL || '').trim().replace(/\/+$/, '') || 'https://api.stripe.com'
  };
}

async function stripeCall(cfg, method, path, params, opts = {}) {
  const fetchFn = opts.fetch || fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs || 10000);
  try {
    const res = await fetchFn(cfg.baseUrl + path, {
      method,
      headers: Object.assign({ Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/x-www-form-urlencoded' }, opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
      body: params ? formEncode(params) : undefined,
      signal: ctl.signal
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[website] stripe', path, res.status, body && body.error && (body.error.code || body.error.type));
      throw new ApiError(502, 'payments-failed', 'The payment page could not be opened. Please try again in a minute.');
    }
    return body;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    console.error('[website] stripe', path + ':', e && e.message);
    throw new ApiError(502, 'payments-failed', 'The payment page could not be opened. Please try again in a minute.');
  } finally { clearTimeout(timer); }
}

/* ---------- database ---------- */

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The workspace behind a website slug and its settings, or a 404. */
export async function loadSite(sb, ws) {
  const slug = String(ws || '').trim().toLowerCase();
  if (!SLUG.test(slug)) throw bad('bad-site', 'Unknown website.');
  const rows = must(await sb.from('blobs').select('org_id, data').eq('key', 'website').eq('data->v->>slug', slug).limit(2), 'load website');
  if (!rows || rows.length !== 1) throw new ApiError(404, 'no-site', 'Unknown website.');
  const s = siteSettings(rows[0].data && rows[0].data.v);
  if (!s.enabled) throw new ApiError(404, 'no-site', 'Online booking is switched off for this website.');
  const org = must(await sb.from('orgs').select('id, status').eq('id', rows[0].org_id).maybeSingle(), 'load workspace');
  if (!org || (org.status && !['active', 'trial'].includes(org.status))) throw new ApiError(404, 'no-site', 'Online booking is switched off for this website.');
  return { orgId: org.id, settings: s };
}

function typeOf(site, key) {
  const k = String(key || '').trim().toLowerCase();
  const t = site.settings.types[k];
  if (!isObj(t) || !t.typeId) throw bad('bad-type', 'Unknown room type.');
  return Object.assign({ key: k }, t);
}

/** Check a stay's dates and guests; throws plain-English errors. */
export function stayInput(q, s, today) {
  const checkIn = String(q.in || q.checkIn || '');
  const checkOut = String(q.out || q.checkOut || '');
  if (!isIso(checkIn) || !isIso(checkOut)) throw bad('bad-dates', 'Please choose your check-in and check-out dates.');
  if (checkIn < today) throw bad('past-dates', 'The check-in date has already passed.');
  if (checkOut <= checkIn) throw bad('bad-dates', 'Check-out must be after check-in.');
  if (checkIn > addDays(today, 499)) throw bad('far-dates', 'Bookings open up to 500 days ahead.');
  const nights = daysBetween(checkIn, checkOut);
  if (nights > s.maxNights) throw bad('too-long', `Stays can be at most ${s.maxNights} nights online. Please contact us for longer stays.`);
  const guests = q.guests === undefined || q.guests === '' ? 2 : Math.round(Number(q.guests));
  if (!Number.isFinite(guests) || guests < 1) throw bad('bad-guests', 'Please choose the number of guests.');
  if (guests > s.maxGuests) throw bad('too-many-guests', `Each apartment sleeps at most ${s.maxGuests} guests.`);
  return { checkIn, checkOut, nights, guests };
}

async function priceContext(sb, orgId, types) {
  const planIds = [...new Set(types.flatMap((t) => Object.values(t.plans || {})).filter(Boolean))];
  const plans = new Map((planIds.length ? await records(sb, orgId, 'ratePlans', (q) => q.in('id', planIds)) : []).map((p) => [p.id, p]));
  const parents = [...new Set([...plans.values()].map((p) => p.follows && p.follows.planId).filter((id) => id && !plans.has(id)))];
  if (parents.length) for (const p of await records(sb, orgId, 'ratePlans', (q) => q.in('id', parents))) plans.set(p.id, p);
  const ids = [...plans.keys()];
  const days = new Map();
  for (const r of ids.length ? await records(sb, orgId, 'channelRates', (q) => q.in('data->>planId', ids)) : []) {
    if (!r.planId || !isObj(r.days)) continue;
    const d = days.get(r.planId) || {};
    for (const [iso, v] of Object.entries(r.days)) if (isIso(iso) && isObj(v)) d[iso] = v;
    days.set(r.planId, d);
  }
  return { plans, days, lastMinute: await blob(sb, orgId, 'lastMinuteDeal') };
}

async function freeUnits(sb, orgId, typeId, from, to) {
  const rows = must(await sb.rpc('channex_type_availability', { p_org: orgId, p_unit_type: typeId, p_from: from, p_to: to }), 'availability') || [];
  return new Map(rows.map((r) => [String(r.date).slice(0, 10), Number(r.raw)]));
}

async function unitType(sb, orgId, typeId) {
  const t = await record(sb, orgId, 'unitTypes', typeId);
  return t && !archived(t) ? t : null;
}

function typeView(type, t, quote, free) {
  const best = quote.best;
  return {
    type: type.key,
    name: type.name || (t && t.name) || type.key,
    available: !!best && free >= 1,
    freeUnits: Math.max(0, free),
    refundable: best ? best.refundable : null,
    plan: best ? best.plan : null,
    nightly: best ? best.nightly : [],
    extraBed: best ? best.extraBed : 0,
    memberTotal: best ? best.memberTotal : null,
    publicTotal: best ? best.publicTotal : null,
    freeCancelUntil: best ? best.freeCancelUntil || null : null,
    options: quote.options.map((o) => ({ plan: o.plan, name: o.name, refundable: o.refundable, bookable: o.bookable, why: o.why, minStay: o.minStay, nightly: o.nightly, extraBed: o.extraBed, memberTotal: o.memberTotal, publicTotal: o.publicTotal, freeCancelUntil: o.freeCancelUntil || null }))
  };
}

/** GET availability: every unit type of the site for one stay. */
export async function availability(sb, site, q, opts = {}) {
  const today = opts.today || todayMY();
  const stay = stayInput(q, site.settings, today);
  const types = Object.entries(site.settings.types).filter(([, t]) => isObj(t) && t.typeId).map(([key, t]) => Object.assign({ key }, t));
  const pc = await priceContext(sb, site.orgId, types);
  const out = [];
  for (const type of types) {
    const t = await unitType(sb, site.orgId, type.typeId);
    if (!t) continue;
    const quote = quoteStay(Object.assign({ type, today, settings: site.settings }, pc, stay));
    const free = await freeUnits(sb, site.orgId, type.typeId, stay.checkIn, addDays(stay.checkOut, -1));
    const min = Math.min(...[...free.values()]);
    out.push(typeView(type, t, quote, Number.isFinite(min) ? min : 0));
  }
  return { checkIn: stay.checkIn, checkOut: stay.checkOut, nights: stay.nights, guests: stay.guests, currency: 'MYR', types: out, notes: notes(site.settings) };
}

/** GET calendar: nightly availability and prices of one unit type. */
export async function calendar(sb, site, q, opts = {}) {
  const today = opts.today || todayMY();
  const type = typeOf(site, q.type);
  const from = isIso(q.from) && q.from >= today ? q.from : today;
  let to = isIso(q.to) ? q.to : addDays(from, 89);
  if (to < from) throw bad('bad-dates', 'The end date is before the start date.');
  if (daysBetween(from, to) >= MAX_CALENDAR_DAYS) to = addDays(from, MAX_CALENDAR_DAYS - 1);
  const t = await unitType(sb, site.orgId, type.typeId);
  if (!t) throw bad('bad-type', 'Unknown room type.');
  const pc = await priceContext(sb, site.orgId, [type]);
  const free = await freeUnits(sb, site.orgId, type.typeId, from, to);
  const dates = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const avail = new Map(dates.map((d) => [d, Math.max(0, free.has(d) ? free.get(d) : 0)]));
  return { type: type.key, name: type.name || t.name, from, to, currency: 'MYR', days: calendarDays(Object.assign({ type, dates, avail, today, settings: site.settings }, pc)) };
}

function guestInput(g) {
  if (!isObj(g)) throw bad('missing', 'Please enter your name and email address.');
  const name = text(g.name, 'Your name', { max: 120, required: true });
  const mail = emailField(g.email, 'Email address');
  const phone = phoneField(g.phone, 'Phone number');
  let country = text(g.country, 'Country', { max: 2 }).toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) throw bad('bad-country', 'Please choose your country.');
  if (country === 'GB') country = 'UK';
  return { name, email: mail, phone, country, countryName: country ? countryName(country) : '', foreign: !!country && country !== 'MY' };
}

function returnUrl(u, origin, fallbackPath) {
  if (typeof u === 'string' && u.length < 600) {
    try {
      const x = new URL(u);
      const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(x.origin);
      if (x.origin === origin && (x.protocol === 'https:' || local)) return x.toString().replace(/%7BCHECKOUT_SESSION_ID%7D/g, '{CHECKOUT_SESSION_ID}');
    } catch (e) { /* fall through */ }
  }
  return origin + fallbackPath;
}

/**
 * POST checkout {type, in, out, guests, plan?, guest: {name, email, phone, country}, memberToken?, successUrl?, cancelUrl?}
 * -> {url (Stripe Checkout), bookingId, total, price: 'member'|'public', expiresAt}
 */
export async function checkout(sb, site, body, opts = {}) {
  const stripe = opts.stripe || stripeConfig();
  if (!stripe.configured) throw new ApiError(503, 'payments-off', 'Online payment is not switched on yet. Please contact us to book.');
  const today = opts.today || todayMY();
  const now = opts.now || Date.now();
  const s = site.settings;
  const type = typeOf(site, body.type);
  const stay = stayInput(body, s, today);
  const guest = guestInput(body.guest);
  if (!opts.origin && !s.siteUrl) throw bad('no-origin', 'Please book from the website.');
  const member = body.memberToken ? readMemberToken(String(body.memberToken), site.orgId, { now }) : null;
  if (body.memberToken && !member) throw new ApiError(401, 'member-expired', 'Your member sign-in has expired. Please sign in again to get the member price.');
  if (member) {
    const m = must(await sb.from('web_members').select('email').eq('org_id', site.orgId).eq('email', member.email).maybeSingle(), 'load member');
    if (!m) throw new ApiError(401, 'member-expired', 'Your member sign-in has expired. Please sign in again to get the member price.');
  }

  const t = await unitType(sb, site.orgId, type.typeId);
  if (!t) throw bad('bad-type', 'Unknown room type.');
  const pc = await priceContext(sb, site.orgId, [type]);
  const quote = quoteStay(Object.assign({ type, today, settings: s }, pc, stay));
  const want = body.plan ? String(body.plan) : null;
  const opt = want ? quote.options.find((o) => o.plan === want && o.bookable) : quote.best;
  if (!opt) throw conflict('not-bookable', want ? 'That rate is not available for these dates. Please choose another.' : 'These dates are not available. Please choose other dates.');

  // a flood of holds would close real nights on every booking site
  const holds = await records(sb, site.orgId, 'bookings', (q) => q.eq('data->>webHold', 'true'));
  const open = holds.filter((b) => live(b));
  if (open.length >= MAX_OPEN_HOLDS) throw tooMany('Many guests are booking right now. Please try again in a few minutes.');
  if (open.filter((b) => b.guest && b.guest.email === guest.email).length >= MAX_HOLDS_PER_EMAIL) throw tooMany('You already have a booking waiting for payment. Please finish it, or wait a few minutes and try again.');

  const free = await freeUnits(sb, site.orgId, type.typeId, stay.checkIn, addDays(stay.checkOut, -1));
  if ([...free.values()].some((n) => n < 1)) throw conflict('sold-out', 'Sorry, these dates were just booked. Please choose other dates.');

  const price = member ? 'member' : 'public';
  const accommodation = money(opt.nightly.reduce((a, n) => a + (member ? n.member : n.public), 0));
  const total = money(accommodation + opt.extraBed);
  const platformFee = money(total * FEE_PCT.direct);
  const nowLocal = nowMY(now);
  const holdUntil = new Date(now + s.holdMinutes * 60000).toISOString();
  const b = newBookingFields({
    id: newBookingId(now),
    unitTypeId: type.typeId,
    ratePlanId: opt.planId,
    propertyId: null,
    channel: 'direct',
    otaName: 'Website',
    reservationCode: null,
    guest,
    guests: stay.guests,
    checkIn: stay.checkIn, checkOut: stay.checkOut, nights: stay.nights,
    createdAt: nowLocal,
    sameDay: nowLocal.slice(0, 10) === stay.checkIn,
    nightly: Math.round(accommodation / stay.nights),
    accommodation,
    cleaningFee: 0,
    tourismTax: 0,
    extraBed: opt.extraBed,
    total,
    revenue: total,
    platformFee,
    payout: money(total - platformFee),
    status: 'pending',
    paymentCollect: 'property',
    webHold: true,
    web: { price, plan: opt.plan, refundable: opt.refundable, freeCancelUntil: opt.freeCancelUntil || null, member: member ? member.email : null, holdUntil, currency: 'MYR' }
  });
  b.reservationCode = b.id;

  const ctx = await assignContext(sb, site.orgId, stay.checkIn, stay.checkOut);
  ctx.bookings.push(b);
  assignOne(b, ctx, nowLocal, true);
  b.checkInTime = ciTimeIn({ propertyId: b.propertyId, unitTypeId: b.unitTypeId }, ctx);
  const unit = b.propertyId ? ctx.units.find((u) => u.id === b.propertyId) : null;
  b.checkOutTime = (unit && /^([01]\d|2[0-3]):[0-5]\d$/.test(unit.checkOutTime || '') && unit.checkOutTime) || '11:00';
  await saveRecords(sb, site.orgId, [b]);

  // another guest may have taken the last unit between the check and the save
  const after = await freeUnits(sb, site.orgId, type.typeId, stay.checkIn, addDays(stay.checkOut, -1));
  if ([...after.values()].some((n) => n < 0)) {
    await release(sb, site.orgId, b, 'sold_out');
    throw conflict('sold-out', 'Sorry, these dates were just booked. Please choose other dates.');
  }

  const origin = opts.origin || s.siteUrl;
  let session;
  try {
    session = await stripeCall(stripe, 'POST', '/v1/checkout/sessions', {
      mode: 'payment',
      customer_email: guest.email,
      client_reference_id: b.id,
      expires_at: Math.floor(now / 1000) + s.holdMinutes * 60 + 60, // Stripe wants at least 30 minutes
      success_url: returnUrl(body.successUrl, origin, '/booking/thank-you?booking=' + encodeURIComponent(b.id) + '&session_id={CHECKOUT_SESSION_ID}'),
      cancel_url: returnUrl(body.cancelUrl, origin, '/booking/cancelled?booking=' + encodeURIComponent(b.id)),
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'myr',
          unit_amount: Math.round(total * 100),
          product_data: {
            name: (type.name || t.name || 'Apartment') + ', ' + stay.nights + (stay.nights === 1 ? ' night' : ' nights'),
            description: `${stay.checkIn} to ${stay.checkOut} · ${stay.guests} ${stay.guests === 1 ? 'guest' : 'guests'} · ${opt.refundable ? 'free cancellation' + (opt.freeCancelUntil ? ' until ' + opt.freeCancelUntil : '') : 'non-refundable'}`
          }
        }
      }],
      metadata: { booking_id: b.id, org_id: site.orgId },
      payment_intent_data: { metadata: { booking_id: b.id, org_id: site.orgId }, description: 'Booking ' + b.id }
    }, { fetch: opts.fetch, idempotencyKey: 'checkout-' + b.id });
  } catch (e) {
    await release(sb, site.orgId, b, 'payment_page_failed');
    throw e;
  }
  b.web.session = String(session.id || '').slice(0, 200);
  await saveRecords(sb, site.orgId, [b]);
  return { url: session.url, bookingId: b.id, total, currency: 'MYR', price, plan: opt.plan, refundable: opt.refundable, expiresAt: holdUntil };
}

/** Cancel an unpaid hold (its nights open again on every site). */
async function release(sb, orgId, b, why) {
  const now = nowMY();
  const next = Object.assign({}, b, { status: 'cancelled', cancelledAt: now.slice(0, 10), codeStatus: 'cancelled' });
  delete next.webHold;
  next.web = Object.assign({}, b.web || {}, { released: why, releasedAt: now });
  await saveRecords(sb, orgId, [next]);
  return next;
}

/** Stripe webhook event (already verified). Confirms a paid booking, releases an expired hold. */
export async function stripeEvent(sb, event) {
  const type = event && event.type;
  const obj = event && event.data && event.data.object;
  if (!isObj(obj)) return { handled: false };
  const meta = isObj(obj.metadata) ? obj.metadata : {};
  const bookingId = String(meta.booking_id || obj.client_reference_id || '');
  const orgId = String(meta.org_id || '');
  if (!/^BK-[A-Z0-9]+$/.test(bookingId) || !/^[0-9a-f-]{36}$/.test(orgId)) return { handled: false, why: 'not ours' };
  const b = await record(sb, orgId, 'bookings', bookingId);
  if (!b || b.channel !== 'direct') return { handled: false, why: 'no booking' };
  if (b.web && b.web.session && obj.id && b.web.session !== obj.id) return { handled: false, why: 'other session' };

  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    if (obj.payment_status !== 'paid' && obj.payment_status !== 'no_payment_required') return { handled: true, status: 'waiting' };
    if (b.paidAt && b.status !== 'pending') return { handled: true, status: 'already' };
    return { handled: true, status: await confirmPaid(sb, orgId, b, obj) };
  }
  if (type === 'checkout.session.expired' || type === 'checkout.session.async_payment_failed') {
    if (b.webHold && live(b)) { await release(sb, orgId, b, type === 'checkout.session.expired' ? 'expired' : 'payment_failed'); return { handled: true, status: 'released' }; }
    return { handled: true, status: 'unchanged' };
  }
  return { handled: false };
}

async function confirmPaid(sb, orgId, b, session) {
  const nowLocal = nowMY();
  const next = Object.assign({}, b);
  const wasReleased = !live(b);
  delete next.webHold;
  next.status = 'confirmed';
  next.paidAt = nowLocal.slice(0, 10);
  next.payMethod = 'Card online (Stripe)';
  const paid = money(num(session.amount_total) / 100);
  next.web = Object.assign({}, b.web || {}, { paidAt: nowLocal, paid, paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent.slice(0, 200) : null });
  if (paid && Math.abs(paid - num(b.total)) >= 0.01) next.web.paidDiffers = true;
  if (wasReleased) {
    // paid after the hold was released: take it back if the nights are still free; otherwise it shows as a double booking
    delete next.cancelledAt;
    next.codeStatus = 'held';
    next.web.reinstated = nowLocal;
  }
  const ctx = await assignContext(sb, orgId, next.checkIn, next.checkOut);
  const i = ctx.bookings.findIndex((x) => x.id === next.id);
  if (i >= 0) ctx.bookings[i] = next; else ctx.bookings.push(next);
  const r = assignOne(next, ctx, nowLocal, wasReleased);
  const c = detectConflicts(next, ctx);
  if (c.double) next.conflict = { kind: 'double_booking', with: c.with, at: nowLocal };
  await saveRecords(sb, orgId, [next]);
  await bookingAlerts(sb, orgId, next, ctx, nowLocal).catch((e) => console.error('[website] alerts:', e && e.message));
  if (r.changed) await audit(sb, orgId, [{ at: nowLocal, by: 'system', cat: 'bookings', text: moveText(next, r.from, r.to, ctx.units) }]);
  return wasReleased ? 'reinstated' : 'confirmed';
}

/** The worker's pass: cancel website holds whose payment window has passed (in case Stripe's event never came). */
export async function releaseHolds(sb, opts = {}) {
  const now = opts.now || Date.now();
  const rows = must(await sb.from('records').select('org_id, id, data').eq('coll', 'bookings').eq('deleted', false).eq('data->>webHold', 'true').limit(200), 'load holds') || [];
  let n = 0;
  for (const r of rows) {
    const b = Object.assign({}, r.data, { id: r.id });
    const until = Date.parse(b.web && b.web.holdUntil);
    if (!live(b) || !Number.isFinite(until) || until + HOLD_MARGIN_MIN * 60000 > now) continue;
    await release(sb, r.org_id, b, 'timed_out');
    n++;
  }
  return { released: n };
}

/* ---------- member sign-in ---------- */

function codeEmail(site, code) {
  const brand = text(site.settings.brand, 'Brand', { max: 60 }) || 'our website';
  const title = `Your ${brand} sign-in code: ${code}`;
  const lines = [`Your sign-in code is ${code}.`, `It works for ${CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email.`];
  const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d2433">' +
    '<p>Your sign-in code is</p><p style="font-size:28px;letter-spacing:6px;font-weight:700;margin:8px 0 16px">' + code + '</p>' +
    '<p style="color:#6b7280;font-size:13px">' + lines[1] + '</p></div>';
  return { subject: title, text: lines.join('\n'), html };
}

/** POST member/start {email}: email a 6-digit code. Always answers the same way, whether the address is a member or not. */
export async function memberStart(sb, site, body, opts = {}) {
  const mail = emailField(body.email);
  const cfg = opts.email || emailConfig();
  if (!cfg.configured) throw new ApiError(503, 'email-off', 'Member sign-in is not available yet.');
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const recent = await sb.from('web_member_codes').select('id', { count: 'exact', head: true }).eq('org_id', site.orgId).eq('email', mail).gte('created_at', since);
  if (recent.error) must(recent, 'count codes');
  if ((recent.count || 0) >= CODES_PER_15_MIN) throw tooMany('We have sent several codes already. Please check your inbox, or wait 15 minutes and try again.');
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  must(await sb.from('web_member_codes').insert({ org_id: site.orgId, email: mail, code_hash: codeHash(site.orgId, mail, code), expires_at: new Date(Date.now() + CODE_MINUTES * 60000).toISOString() }), 'save code');
  const msg = codeEmail(site, code);
  const from = text(site.settings.emailFrom, 'From', { max: 200 }) || cfg.from;
  const fetchFn = opts.fetch || fetch;
  const res = await fetchFn(cfg.baseUrl + '/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [mail], subject: msg.subject, text: msg.text, html: msg.html })
  }).catch((e) => ({ ok: false, status: 0, e }));
  if (!res.ok) {
    console.error('[website] member code email failed:', res.status);
    throw new ApiError(502, 'email-failed', 'We could not send the code. Please check the address and try again.');
  }
  return { sent: true, expiresInMinutes: CODE_MINUTES };
}

/** POST member/verify {email, code} -> {token, expiresAt, email}. */
export async function memberVerify(sb, site, body, opts = {}) {
  const mail = emailField(body.email);
  const code = String(body.code === undefined || body.code === null ? '' : body.code).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) throw bad('bad-code', 'Please enter the 6-digit code from the email.');
  const rows = must(await sb.from('web_member_codes').select('id, code_hash, expires_at, attempts, used_at').eq('org_id', site.orgId).eq('email', mail)
    .is('used_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1), 'load code') || [];
  const row = rows[0];
  const wrong = () => bad('wrong-code', 'That code is not right, or it has expired. Please try again or ask for a new code.');
  if (!row || (row.attempts || 0) >= CODE_TRIES) throw wrong();
  const a = Buffer.from(row.code_hash, 'hex'), b = Buffer.from(codeHash(site.orgId, mail, code), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    must(await sb.from('web_member_codes').update({ attempts: (row.attempts || 0) + 1 }).eq('id', row.id), 'count try');
    throw wrong();
  }
  must(await sb.from('web_member_codes').update({ used_at: new Date().toISOString() }).eq('id', row.id), 'use code');
  must(await sb.from('web_members').upsert({ org_id: site.orgId, email: mail, last_login_at: new Date().toISOString() }, { onConflict: 'org_id,email' }), 'save member');
  return Object.assign({ email: mail }, memberToken(site.orgId, mail, { now: opts.now }));
}
