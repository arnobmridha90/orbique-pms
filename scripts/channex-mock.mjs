#!/usr/bin/env node
/* An in-memory Channex for working without a Channex key (local runs and tests). No dependencies.
 *
 *   node scripts/channex-mock.mjs [--port 8899] [--host 127.0.0.1]
 *   then run Orbique with CHANNEX_BASE_URL=http://127.0.0.1:8899/api/v1 and any CHANNEX_API_KEY
 *
 * API (under /api/v1, header user-api-key required; JSON:API-like answers as in docs.channex.io):
 *   groups, properties, room_types, rate_plans          GET list (filter[property_id], filter[room_type_id], pagination), GET/PUT/DELETE :id, POST
 *   POST /availability, POST /restrictions               {values: [...]} -> {data: [{id, type: 'task'}], meta: {message, warnings}}
 *                                                        invalid items (e.g. rate <= 0) are dropped with a warning, like Channex
 *   GET /availability, GET /restrictions                 filter[property_id], filter[date][gte|lte]
 *   POST /auth/one_time_token                            {one_time_token: {property_id, group_id?, username}} -> {data: {token}}
 *   GET /booking_revisions/feed, GET /booking_revisions/:id, POST /booking_revisions/:id/ack
 *   GET /channels (filter[property_id]), GET /channels/:id
 *   webhooks                                             GET list, GET/PUT/DELETE :id, POST
 * Pages:
 *   GET /auth/exchange?oauth_session_key=...&property_id=...   the channel screen stand-in (token is single use, 15 min)
 * Test controls (not part of Channex):
 *   GET /__mock/calls[?path=/availability]   every API call: {method, path, query, body, status, at}; DELETE clears the list
 *   POST /__mock/booking {property_id, room_type_id, rate_plan_id?, status: new|modified|cancelled, booking_id?, checkin_date,
 *        checkout_date, amount?, currency?, customer?, ota_name?, deliver?}
 *        creates a booking revision and sends a signed `booking` webhook to every active webhook that wants it, else to
 *        MOCK_WEBHOOK_URL, else APP_URL + /api/channex-webhook. Answers {revision, deliveries}. A new booking lowers
 *        the room type's availability by one for its nights, as Channex does on its own.
 *   POST /__mock/channel {property_id, channel: 'BDC', title?}   adds a channel to the property
 *   POST /__mock/config {every429, every5xx, latencyMs, rateLimits}   change the controls below while running
 *   POST /__mock/reset   empties everything;  GET /__mock/state   everything stored
 *
 * Environment:
 *   MOCK_PORT (8899), MOCK_API_KEY (when set, user-api-key must equal it; otherwise any non-empty key works)
 *   MOCK_429_EVERY=n      every n-th API call answers 429 Too Many Requests
 *   MOCK_5XX=n            every n-th API call answers 503
 *   MOCK_LATENCY_MS=ms    wait before answering each API call
 *   MOCK_RATE_LIMITS=1    enforce Channex's limits: 10/min per property per ARI endpoint, 20 ARI/min in total
 *   MOCK_SIGNING_SECRET   webhook signing secret (falls back to CHANNEX_WEBHOOK_SECRET); without one webhooks go unsigned
 *   MOCK_WEBHOOK_URL, APP_URL   where booking webhooks go when no webhook is registered
 */
import http from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const json = (res, status, obj) => {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(body);
};
const errBody = (code, title, details) => ({ errors: Object.assign({ code, title }, details ? { details } : {}) });
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowIso = () => new Date().toISOString().replace('Z', '');

function datesOf(item) {
  if (item.date !== undefined) return isDate(item.date) ? [item.date] : null;
  if (!isDate(item.date_from) || !isDate(item.date_to) || item.date_to < item.date_from) return null;
  const out = [];
  for (let d = item.date_from; d <= item.date_to && out.length < 1000; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Signature the way Channex sends it: lower-case hex HMAC-SHA256(secret, `${timestamp}.${body}`). */
export function signWebhook(secret, timestamp, body) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

const RESOURCES = {
  groups: { type: 'group', wrap: 'group', required: ['title'] },
  properties: { type: 'property', wrap: 'property', required: ['title', 'currency'] },
  room_types: { type: 'room_type', wrap: 'room_type', required: ['property_id', 'title', 'count_of_rooms', 'occ_adults'] },
  rate_plans: { type: 'rate_plan', wrap: 'rate_plan', required: ['property_id', 'room_type_id', 'title', 'options'] },
  webhooks: { type: 'webhook', wrap: 'webhook', required: ['callback_url', 'event_mask'] }
};
const IMMUTABLE = { room_types: ['property_id'], rate_plans: ['property_id', 'room_type_id', 'currency', 'sell_mode'], properties: ['group_id'] };
const ARI_RESTRICTION_KEYS = ['rate', 'rates', 'min_stay', 'min_stay_arrival', 'min_stay_through', 'max_stay', 'closed_to_arrival', 'closed_to_departure', 'stop_sell'];

export function createMock(options = {}) {
  const env = process.env;
  const ctl = {
    apiKey: options.apiKey !== undefined ? options.apiKey : (env.MOCK_API_KEY || ''),
    every429: Number(options.every429 !== undefined ? options.every429 : env.MOCK_429_EVERY) || 0,
    every5xx: Number(options.every5xx !== undefined ? options.every5xx : env.MOCK_5XX) || 0,
    latencyMs: Number(options.latencyMs !== undefined ? options.latencyMs : env.MOCK_LATENCY_MS) || 0,
    rateLimits: options.rateLimits !== undefined ? !!options.rateLimits : env.MOCK_RATE_LIMITS === '1',
    signingSecret: options.signingSecret !== undefined ? options.signingSecret : (env.MOCK_SIGNING_SECRET || env.CHANNEX_WEBHOOK_SECRET || ''),
    webhookUrl: options.webhookUrl !== undefined ? options.webhookUrl : (env.MOCK_WEBHOOK_URL || (env.APP_URL ? env.APP_URL.replace(/\/+$/, '') + '/api/channex-webhook' : ''))
  };
  let db;
  const reset = () => {
    db = { groups: {}, properties: {}, room_types: {}, rate_plans: {}, webhooks: {}, channels: {}, availability: {}, restrictions: {}, tokens: {}, revisions: {}, calls: [], seq: 0, ari: [] };
  };
  reset();

  const record = (coll, id) => db[coll][id];
  const view = (coll, obj) => {
    const out = { type: RESOURCES[coll] ? RESOURCES[coll].type : coll.replace(/s$/, ''), id: obj.id, attributes: Object.assign({}, obj) };
    if (coll === 'groups') out.relationships = { properties: { data: Object.values(db.properties).filter((p) => p.group_id === obj.id).map((p) => ({ type: 'property', id: p.id })) }, users: { data: [] } };
    return out;
  };

  function validate(coll, attrs, creating) {
    const details = {};
    if (creating) for (const k of RESOURCES[coll].required) if (attrs[k] === undefined || attrs[k] === null || attrs[k] === '') details[k] = ["can't be blank"];
    if (coll === 'properties' && attrs.group_id && !db.groups[attrs.group_id]) details.group_id = ['not found'];
    if (coll === 'room_types') {
      if (attrs.property_id && !db.properties[attrs.property_id]) details.property_id = ['not found'];
      if (attrs.count_of_rooms !== undefined && !(Number.isInteger(attrs.count_of_rooms) && attrs.count_of_rooms >= 1)) details.count_of_rooms = ['must be greater than or equal to 1'];
      if (attrs.occ_adults !== undefined && !(Number.isInteger(attrs.occ_adults) && attrs.occ_adults >= 1)) details.occ_adults = ['must be greater than or equal to 1'];
    }
    if (coll === 'rate_plans') {
      if (attrs.room_type_id && !db.room_types[attrs.room_type_id]) details.room_type_id = ['not found'];
      if (attrs.options !== undefined && (!Array.isArray(attrs.options) || attrs.options.filter((o) => o && o.is_primary).length !== 1)) details.options = ['must have exactly one primary option'];
    }
    return details;
  }

  function titleTaken(coll, attrs, selfId) {
    if (!attrs.title) return false;
    const same = (o) => o.id !== selfId && o.title === attrs.title;
    if (coll === 'room_types') return Object.values(db.room_types).some((o) => same(o) && o.property_id === attrs.property_id);
    if (coll === 'rate_plans') return Object.values(db.rate_plans).some((o) => same(o) && o.room_type_id === attrs.room_type_id);
    return false;
  }

  function listOf(coll, q) {
    let rows = Object.values(db[coll]);
    for (const [k, v] of Object.entries(q)) {
      const m = /^filter\[([a-z_]+)\]$/.exec(k);
      if (m && v !== '') { const ids = String(v).split(','); rows = rows.filter((r) => ids.includes(String(r[m[1]]))); }
    }
    rows.sort((a, b) => String(a.title || a.inserted_at || '').localeCompare(String(b.title || b.inserted_at || '')));
    const page = Math.max(1, Number(q['pagination[page]']) || 1);
    const limit = Math.min(100, Math.max(1, Number(q['pagination[limit]']) || 10));
    return { data: rows.slice((page - 1) * limit, page * limit).map((r) => view(coll, r)), meta: { page, limit, total: rows.length } };
  }

  function rateLimited(propertyId, endpoint) {
    if (!ctl.rateLimits) return false;
    const now = Date.now();
    db.ari = db.ari.filter((c) => now - c.at < 60000);
    if (db.ari.length >= 20 || db.ari.filter((c) => c.property === propertyId && c.endpoint === endpoint).length >= 10) return true;
    db.ari.push({ at: now, property: propertyId, endpoint });
    return false;
  }

  function ari(kind, body) {
    const values = body && Array.isArray(body.values) ? body.values : null;
    if (!values) return [422, errBody('validation_error', 'Validation Error', { values: ["can't be blank"] })];
    const warnings = [];
    const accepted = [];
    for (const item of values) {
      const w = {};
      if (!item || typeof item !== 'object') { warnings.push({ item, warning: { item: ['is not an object'] } }); continue; }
      const prop = db.properties[item.property_id];
      if (!prop) w.property_id = ['not found'];
      const dates = datesOf(item);
      if (!dates) w.date = ['is invalid'];
      if (kind === 'availability') {
        const rt = db.room_types[item.room_type_id];
        if (!rt || (prop && rt.property_id !== prop.id)) w.room_type_id = ['not found'];
        if (!(Number.isInteger(item.availability) && item.availability >= 0)) w.availability = ['must be greater than or equal to 0'];
      } else {
        const rp = db.rate_plans[item.rate_plan_id];
        if (!rp || (prop && rp.property_id !== prop.id)) w.rate_plan_id = ['not found'];
        if (!ARI_RESTRICTION_KEYS.some((k) => item[k] !== undefined)) w.restrictions = ['at least one restriction is required'];
        if (item.rate !== undefined && !(Number(item.rate) > 0)) w.rate = ['must be greater than 0'];
        for (const k of ['min_stay', 'min_stay_arrival', 'min_stay_through']) if (item[k] !== undefined && !(Number.isInteger(Number(item[k])) && Number(item[k]) >= 1)) w[k] = ['must be greater than 0'];
        if (item.max_stay !== undefined && !(Number.isInteger(Number(item.max_stay)) && Number(item.max_stay) >= 0)) w.max_stay = ['must be greater than or equal to 0'];
      }
      if (Object.keys(w).length) { warnings.push(Object.assign({}, item, { warning: w })); continue; }
      accepted.push([item, dates]);
    }
    for (const [item, dates] of accepted) {
      if (kind === 'availability') {
        const t = db.availability[item.room_type_id] || (db.availability[item.room_type_id] = {});
        for (const d of dates) t[d] = item.availability;
      } else {
        const t = db.restrictions[item.rate_plan_id] || (db.restrictions[item.rate_plan_id] = {});
        const set = {};
        for (const k of ARI_RESTRICTION_KEYS) if (item[k] !== undefined) set[k] = k === 'rate' ? Number(item.rate).toFixed(2) : item[k];
        if (set.min_stay !== undefined) { set.min_stay_arrival = set.min_stay; delete set.min_stay; }
        for (const d of dates) t[d] = Object.assign({}, t[d], set);
      }
    }
    return [200, { data: [{ id: randomUUID(), type: 'task' }], meta: { message: 'Success', warnings } }];
  }

  function readAri(kind, q) {
    const props = String(q['filter[property_id]'] || '').split(',').filter(Boolean);
    if (!props.length) return [422, errBody('validation_error', 'Validation Error', { property_id: ["can't be blank"] })];
    const gte = q['filter[date][gte]'] || '0000-00-00';
    const lte = q['filter[date][lte]'] || '9999-99-99';
    const coll = kind === 'availability' ? 'room_types' : 'rate_plans';
    const data = {};
    for (const o of Object.values(db[coll])) {
      if (!props.includes(o.property_id)) continue;
      const vals = db[kind][o.id] || {};
      data[o.id] = Object.fromEntries(Object.entries(vals).filter(([d]) => d >= gte && d <= lte).sort());
    }
    return [200, { data }];
  }

  /* ---------- the API, one call ---------- */
  function api(method, parts, q, body) {
    const [top, id, sub] = parts;
    if (RESOURCES[top]) {
      const spec = RESOURCES[top];
      if (!id && method === 'GET') return [200, listOf(top, q)];
      if (!id && method === 'POST') {
        const attrs = body && body[spec.wrap];
        if (!attrs || typeof attrs !== 'object') return [400, errBody('bad_request', 'Bad Request')];
        const details = validate(top, attrs, true);
        if (titleTaken(top, attrs)) details.title = ['has already been taken'];
        if (Object.keys(details).length) return [422, errBody('validation_error', 'Validation Error', details)];
        const obj = Object.assign({}, attrs, { id: randomUUID() });
        if (top === 'properties') obj.is_active = true;
        if (top === 'rate_plans' && !obj.currency) obj.currency = (db.properties[obj.property_id] || {}).currency;
        if (top === 'webhooks') { obj.is_active = !!attrs.is_active; obj.send_data = !!attrs.send_data; }
        db[top][obj.id] = obj;
        return [201, { data: view(top, obj) }];
      }
      const obj = id && record(top, id);
      if (!obj) return [404, errBody('resource_not_found', 'Resource Not Found')];
      if (method === 'GET' && !sub) return [200, { data: view(top, obj) }];
      if (method === 'PUT' && !sub) {
        const attrs = (body && body[spec.wrap]) || {};
        const details = validate(top, attrs, false);
        for (const k of IMMUTABLE[top] || []) if (attrs[k] !== undefined && attrs[k] !== obj[k]) details[k] = ['can not be changed'];
        if (titleTaken(top, Object.assign({}, obj, attrs), obj.id)) details.title = ['has already been taken'];
        if (Object.keys(details).length) return [422, errBody('validation_error', 'Validation Error', details)];
        Object.assign(obj, attrs, { id: obj.id });
        return [200, { data: view(top, obj) }];
      }
      if (method === 'DELETE' && !sub) {
        if (top === 'groups' && Object.values(db.properties).some((p) => p.group_id === id)) return [422, errBody('validation_error', 'Validation Error', { group: ['has properties'] })];
        delete db[top][id];
        return [200, { meta: { message: 'Success' } }];
      }
      return [404, errBody('resource_not_found', 'Resource Not Found')];
    }
    if ((top === 'availability' || top === 'restrictions') && !id) {
      if (method === 'GET') return readAri(top, q);
      if (method === 'POST') {
        const first = body && Array.isArray(body.values) && body.values[0];
        if (rateLimited(first ? first.property_id : '', top)) return [429, errBody('http_too_many_requests', 'Too Many Requests')];
        return ari(top, body);
      }
    }
    if (top === 'auth' && id === 'one_time_token' && method === 'POST') {
      const t = body && body.one_time_token;
      if (!t || !t.property_id) return [422, errBody('validation_error', 'Validation Error', { property_id: ["can't be blank"] })];
      if (!db.properties[t.property_id]) return [422, errBody('validation_error', 'Validation Error', { property_id: ['not found'] })];
      const token = randomUUID();
      db.tokens[token] = { property_id: t.property_id, group_id: t.group_id || null, username: t.username || '', expires: Date.now() + 15 * 60000, used: false };
      return [200, { data: { token }, meta: { message: 'Success' } }];
    }
    if (top === 'booking_revisions') {
      if (id === 'feed' && method === 'GET') {
        let rows = Object.values(db.revisions).filter((r) => !r.acked);
        if (q['filter[property_id]']) { const ids = String(q['filter[property_id]']).split(','); rows = rows.filter((r) => ids.includes(r.property_id)); }
        rows.sort((a, b) => a.inserted_at.localeCompare(b.inserted_at));
        const page = Math.max(1, Number(q['pagination[page]']) || 1);
        const limit = Math.min(100, Math.max(1, Number(q['pagination[limit]']) || 10));
        return [200, { data: rows.slice((page - 1) * limit, page * limit).map(revisionView), meta: { page, limit, total: rows.length } }];
      }
      const rev = id && db.revisions[id];
      if (!rev) return [404, errBody('resource_not_found', 'Resource Not Found')];
      if (method === 'GET' && !sub) return [200, { data: revisionView(rev) }];
      if (method === 'POST' && sub === 'ack') { rev.acked = true; rev.acked_at = nowIso(); return [200, { meta: { message: 'Success' } }]; }
    }
    if (top === 'channels' && method === 'GET') {
      if (!id) return [200, listOf('channels', q)];
      const ch = db.channels[id];
      return ch ? [200, { data: view('channels', ch) }] : [404, errBody('resource_not_found', 'Resource Not Found')];
    }
    return [404, errBody('resource_not_found', 'Resource Not Found')];
  }

  function revisionView(rev) {
    const attrs = Object.assign({}, rev);
    delete attrs.acked; delete attrs.acked_at;
    return { type: 'booking_revision', id: rev.id, attributes: attrs };
  }

  /* ---------- test controls ---------- */
  async function deliver(rev) {
    const payload = { booking_id: rev.booking_id, property_id: rev.property_id, revision_id: rev.id };
    const targets = Object.values(db.webhooks).filter((w) => w.is_active && (w.is_global || w.property_id === rev.property_id) &&
      (w.event_mask === '*' || String(w.event_mask).split(';').map((s) => s.trim()).includes('booking')));
    const list = targets.length ? targets : ctl.webhookUrl ? [{ callback_url: ctl.webhookUrl, send_data: true, headers: {} }] : [];
    const out = [];
    for (const w of list) {
      const event = { event: 'booking', property_id: rev.property_id, user_id: null, timestamp: new Date().toISOString() };
      if (w.send_data !== false) event.payload = payload;
      const body = JSON.stringify(event);
      const headers = Object.assign({ 'Content-Type': 'application/json' }, w.headers || {});
      if (ctl.signingSecret) {
        const ts = String(Math.floor(Date.now() / 1000));
        headers['x-hmac-timestamp'] = ts;
        headers['x-hmac-signature-256'] = signWebhook(ctl.signingSecret, ts, body);
        headers['x-hmac-keys-256'] = 'mock-key-1';
      }
      try {
        const r = await fetch(w.callback_url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
        out.push({ url: w.callback_url, status: r.status, signed: !!ctl.signingSecret });
      } catch (e) {
        out.push({ url: w.callback_url, status: 0, error: e && e.message ? e.message : String(e), signed: !!ctl.signingSecret });
      }
    }
    return out;
  }

  async function mockBooking(b) {
    if (!b || !db.properties[b.property_id]) return [422, errBody('validation_error', 'Validation Error', { property_id: ['not found'] })];
    const status = b.status || 'new';
    if (!['new', 'modified', 'cancelled'].includes(status)) return [422, errBody('validation_error', 'Validation Error', { status: ['is invalid'] })];
    const prev = b.booking_id ? Object.values(db.revisions).filter((r) => r.booking_id === b.booking_id).sort((x, y) => x.inserted_at.localeCompare(y.inserted_at)).pop() : null;
    if (b.booking_id && !prev) return [422, errBody('validation_error', 'Validation Error', { booking_id: ['not found'] })];
    const base = prev ? JSON.parse(JSON.stringify(prev)) : {};
    const checkin = b.checkin_date || (base.rooms && base.rooms[0].checkin_date);
    const checkout = b.checkout_date || (base.rooms && base.rooms[0].checkout_date);
    if (!isDate(checkin) || !isDate(checkout) || checkout <= checkin) return [422, errBody('validation_error', 'Validation Error', { checkin_date: ['is invalid'] })];
    const nights = Math.round((Date.parse(checkout) - Date.parse(checkin)) / 86400000);
    const amount = Number(b.amount || (base.amount ? base.amount : 100 * nights)).toFixed(2);
    const days = {};
    for (let i = 0; i < nights; i++) days[addDays(checkin, i)] = (Number(amount) / nights).toFixed(2);
    const bookingId = prev ? prev.booking_id : randomUUID();
    const code = prev ? prev.ota_reservation_code : String(9000000000 + Math.floor(Math.random() * 999999999));
    const rev = {
      id: randomUUID(), booking_id: bookingId, property_id: b.property_id, system_id: code,
      unique_id: (b.unique_prefix || (prev ? prev.unique_id.split('-')[0] : 'BDC')) + '-' + code,
      ota_reservation_code: code, ota_name: b.ota_name || base.ota_name || 'Booking.com', status,
      arrival_date: checkin, departure_date: checkout, arrival_hour: b.arrival_hour || base.arrival_hour || '15:00',
      amount, currency: b.currency || base.currency || db.properties[b.property_id].currency, ota_commission: b.ota_commission || null,
      payment_collect: b.payment_collect || base.payment_collect || 'ota', payment_type: b.payment_type || null, notes: b.notes || base.notes || null,
      customer: b.customer || base.customer || { name: 'Test', surname: 'Guest', mail: 'guest@example.com', phone: '+60123456789', country: 'MY' },
      occupancy: { adults: 2, children: 0, infants: 0 }, services: [], guarantee: null,
      rooms: [{
        checkin_date: checkin, checkout_date: checkout,
        room_type_id: b.room_type_id !== undefined ? b.room_type_id : (base.rooms ? base.rooms[0].room_type_id : null),
        rate_plan_id: b.rate_plan_id !== undefined ? b.rate_plan_id : (base.rooms ? base.rooms[0].rate_plan_id : null),
        amount, days, occupancy: b.occupancy || { adults: 2, children: 0, infants: 0 }, guests: [], services: [], taxes: []
      }],
      inserted_at: nowIso(), acked: false
    };
    db.revisions[rev.id] = rev;
    // like Channex (allow_availability_autoupdate_on_confirmation is always true): a new booking lowers availability
    // by itself; modifications and cancellations do not (Orbique sets those two to false)
    const rt = rev.rooms[0].room_type_id;
    if (status === 'new' && rt && db.availability[rt]) for (const d of Object.keys(days)) if (Number.isInteger(db.availability[rt][d])) db.availability[rt][d] = Math.max(0, db.availability[rt][d] - 1);
    const deliveries = b.deliver === false ? [] : await deliver(rev);
    return [200, { revision: revisionView(rev), deliveries }];
  }

  function exchangePage(q) {
    const t = db.tokens[q.oauth_session_key];
    if (!t || t.used || t.expires < Date.now() || (q.property_id && q.property_id !== t.property_id)) {
      return [401, '<!doctype html><meta charset="utf-8"><title>Session expired</title><body style="font-family:system-ui;padding:24px"><h1>Session expired</h1><p>Open the channel screen again from Orbique.</p></body>'];
    }
    t.used = true;
    const prop = db.properties[t.property_id];
    const chans = Object.values(db.channels).filter((c) => c.property_id === t.property_id);
    const rows = chans.length ? chans.map((c) => `<li>${esc(c.title)} (${esc(c.channel)}) · ${c.is_active ? 'active' : 'inactive'}</li>`).join('') : '<li>No channels yet.</li>';
    return [200, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Channels (mock)</title>
<body style="font-family:system-ui;padding:24px;max-width:640px">
<h1>Channels</h1><p>Mock Channex channel screen for <b>${esc(prop ? prop.title : t.property_id)}</b>${t.username ? ' · signed in as ' + esc(t.username) : ''}.</p>
<p>Filter: ${esc(q.channels || 'all')} · mode ${esc(q.app_mode || 'full')} · ${esc(q.redirect_to || '/channels')}</p>
<ul id="channels">${rows}</ul>
<button id="add" style="padding:10px 16px">Add a Booking.com test channel</button>
<script>document.getElementById('add').onclick=async()=>{await fetch('/__mock/channel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({property_id:${JSON.stringify(t.property_id)},channel:'BDC'})});document.getElementById('channels').insertAdjacentHTML('beforeend','<li>Booking.com (BDC) · active</li>')};</script>
</body>`];
  }

  const NAMES = { BDC: 'Booking.com', AGO: 'Agoda', ABB: 'Airbnb', EXP: 'Expedia', CTP: 'Trip.com' };

  /* ---------- server ---------- */
  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 10 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
  let apiCount = 0;

  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://mock'); } catch (e) { res.statusCode = 400; return res.end(); }
    const q = Object.fromEntries(url.searchParams);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    let raw = '';
    try { raw = await readBody(req); } catch (e) { return json(res, 413, errBody('payload_too_large', 'Payload Too Large')); }
    let body = null;
    if (raw) { try { body = JSON.parse(raw); } catch (e) { body = undefined; } }

    if (p.startsWith('/__mock/')) {
      if (body === undefined) return json(res, 400, { error: 'bad json' });
      const what = p.slice(8);
      if (what === 'calls' && req.method === 'GET') return json(res, 200, { calls: q.path ? db.calls.filter((c) => c.path === q.path) : db.calls });
      if (what === 'calls' && req.method === 'DELETE') { db.calls = []; return json(res, 200, { ok: true }); }
      if (what === 'state' && req.method === 'GET') { const s = Object.assign({}, db); delete s.calls; return json(res, 200, s); }
      if (what === 'reset' && req.method === 'POST') { reset(); apiCount = 0; return json(res, 200, { ok: true }); }
      if (what === 'config' && req.method === 'POST') {
        const b = body || {};
        if (b.every429 !== undefined) ctl.every429 = Number(b.every429) || 0;
        if (b.every5xx !== undefined) ctl.every5xx = Number(b.every5xx) || 0;
        if (b.latencyMs !== undefined) ctl.latencyMs = Number(b.latencyMs) || 0;
        if (b.rateLimits !== undefined) ctl.rateLimits = !!b.rateLimits;
        if (b.signingSecret !== undefined) ctl.signingSecret = String(b.signingSecret || '');
        if (b.webhookUrl !== undefined) ctl.webhookUrl = String(b.webhookUrl || '');
        apiCount = 0;
        const shown = Object.assign({}, ctl, { apiKey: ctl.apiKey ? 'set' : '', signingSecret: ctl.signingSecret ? 'set' : '' });
        return json(res, 200, { ok: true, config: shown });
      }
      if (what === 'booking' && req.method === 'POST') { const [s, o] = await mockBooking(body); return json(res, s, o); }
      if (what === 'channel' && req.method === 'POST') {
        const b = body || {};
        if (!db.properties[b.property_id]) return json(res, 422, errBody('validation_error', 'Validation Error', { property_id: ['not found'] }));
        const code = String(b.channel || 'BDC').toUpperCase();
        const ch = { id: randomUUID(), property_id: b.property_id, group_id: db.properties[b.property_id].group_id || null, channel: code, title: b.title || NAMES[code] || code, is_active: b.is_active !== false, rate_plans: [] };
        db.channels[ch.id] = ch;
        return json(res, 200, { data: view('channels', ch) });
      }
      return json(res, 404, { error: 'unknown mock control' });
    }

    if (p === '/auth/exchange' && req.method === 'GET') {
      const [s, html] = exchangePage(q);
      res.statusCode = s;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(html);
    }

    if (!p.startsWith('/api/v1/')) return json(res, 404, errBody('resource_not_found', 'Resource Not Found'));
    const path = p.slice(7);
    const call = { at: new Date().toISOString(), method: req.method, path, query: q, body: body === undefined ? raw : body, status: 0 };
    db.calls.push(call);
    if (ctl.latencyMs) await new Promise((r) => setTimeout(r, ctl.latencyMs));
    const finish = (status, obj) => { call.status = status; if (!res.destroyed) json(res, status, obj); };

    const key = req.headers['user-api-key'];
    if (!key || (ctl.apiKey && key !== ctl.apiKey)) return finish(401, errBody('unauthorized', 'Unauthorized'));
    apiCount++;
    if (ctl.every429 && apiCount % ctl.every429 === 0) return finish(429, errBody('http_too_many_requests', 'Too Many Requests'));
    if (ctl.every5xx && apiCount % ctl.every5xx === 0) return finish(503, errBody('service_unavailable', 'Service Unavailable'));
    if (body === undefined) return finish(400, errBody('bad_request', 'Bad Request'));
    const [status, out] = api(req.method, path.split('/').filter(Boolean), q, body);
    return finish(status, out);
  });

  return {
    server,
    ctl,
    get db() { return db; },
    reset,
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          const a = server.address();
          resolve({ port: a.port, url: `http://${host}:${a.port}`, apiUrl: `http://${host}:${a.port}/api/v1` });
        });
      });
    },
    close() { return new Promise((resolve) => { server.closeAllConnections && server.closeAllConnections(); server.close(() => resolve()); }); }
  };
}

/* ---------- command line ---------- */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
  const mock = createMock();
  const port = Number(arg('--port', process.env.MOCK_PORT || 8899));
  const host = arg('--host', '127.0.0.1');
  mock.listen(port, host).then(({ apiUrl, url }) => {
    const c = mock.ctl;
    console.log(`\nChannex mock: ${apiUrl}`);
    console.log(`  run Orbique with CHANNEX_BASE_URL=${apiUrl} and CHANNEX_API_KEY=${c.apiKey ? '<MOCK_API_KEY>' : '<anything>'}`);
    console.log(`  calls: ${url}/__mock/calls · 429 every ${c.every429 || '-'} · 5xx every ${c.every5xx || '-'} · latency ${c.latencyMs} ms · rate limits ${c.rateLimits ? 'on' : 'off'}`);
    console.log(`  webhooks ${c.signingSecret ? 'signed' : 'unsigned'}${c.webhookUrl ? ' -> ' + c.webhookUrl : ''}\n`);
  }, (e) => { console.error('channex mock:', e.message); process.exit(1); });
}
