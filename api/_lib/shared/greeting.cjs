/* Greeting messages: one or more per building, written once and filled for each booking.
 *
 * Arnob: "The subscriber can write greeting messages for a building. Owner and all employees can send this to the
 * customer. The customer can choose which will stay fixed and which will vary: the customer name changes with the
 * booking, the unit number and door passwords can also change."
 *
 * A greeting (records collection 'greetings'):
 *   {id, buildingId, name, text, fields: [{key, label, private, values: {<propertyId>: string}}], updatedAt, updatedBy}
 * text is fixed wording with {placeholders}:
 *   built in (change per booking): BUILTINS below, e.g. {guest_first}, {unit_no}, {door_code}, {checkin_date}
 *   the writer's own fields (change per unit): {f_<key>}, e.g. {f_lobby_code} with a value for each unit
 * Unknown placeholders stay as they are. A unit with no value for a field gives an empty value (listed in `missing`).
 *
 * The owner's rule (O.guestmsg / guestmsg.cjs): the door code, and for a typed unit the unit number and the Wi-Fi, reach
 * the guest only from 30 minutes before check-in. A private field ("like a door code") follows the same rule. Before that
 * the value is replaced by wording that sends the guest to the guest app. A door code held for the ID check stays held too.
 *
 * Shared by the page (inlined by scripts/build.mjs as O.greeting, after O.guestmsg), the server (api/messages.js
 * 'greeting' and 'greeting-preview', so the preview and the message sent match) and node tests (tests/greeting.test.mjs).
 * ES5, no dependencies other than guestmsg.cjs.
 */
'use strict';

var GM = (typeof window !== 'undefined' && window.O && window.O.guestmsg) ? window.O.guestmsg
  : (typeof require === 'function' ? require('./guestmsg.cjs') : null);

/* [key, label shown on the chip, sample value for the preview when no booking is picked] */
var BUILTINS = [
  ['guest_first', 'Guest first name', 'Aisha'],
  ['guest_name', 'Guest full name', 'Aisha Rahman'],
  ['building', 'Building', 'Your building'],
  ['unit_no', 'Unit number', '21-1'],
  ['door_code', 'Door code', '4821'],
  ['checkin_date', 'Check-in date', 'Mon, 2 Nov 2026'],
  ['checkin_time', 'Check-in time', '3:00 PM'],
  ['checkout_date', 'Check-out date', 'Thu, 5 Nov 2026'],
  ['checkout_time', 'Check-out time', '11:00 AM'],
  ['nights', 'Nights', '3'],
  ['guests', 'Guests', '2'],
  ['wifi_name', 'Wi-Fi name', 'Building-WiFi'],
  ['wifi_password', 'Wi-Fi password', 'welcome2026'],
  ['parking', 'Parking', 'Basement P2'],
  ['guest_app_link', 'Guest app link', 'https://example.com/guest/abc']
];
var BUILTIN_KEYS = {};
BUILTINS.forEach(function (b) { BUILTIN_KEYS[b[0]] = true; });

/* what a person without door-code access sees in place of a code that would go to the guest */
var MASK = '[door code hidden]';
var MAX_FIELDS = 20, MAX_TEXT = 4000, MAX_NAME = 60, MAX_LABEL = 40, MAX_VALUE = 200;

/* a new field is private when its label sounds like a code */
function defaultPrivate(label) { return /door|password|passcode|code|pin/i.test(String(label || '')); }

/* "Lobby code" -> "lobby_code" (unique among `taken`, a-z 0-9 _, at most 24 characters) */
function fieldKey(label, taken) {
  var base = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'field';
  var key = base, n = 2, used = {};
  (taken || []).forEach(function (k) { used[k] = true; });
  while (used[key]) { key = base.slice(0, 21) + '_' + n; n++; }
  return key;
}

/* the same name the inbox uses: "Tan Wei Ling" stays whole, "The Lee Family" -> "Lee family", else the first word */
var SURNAME_FIRST = ['Tan', 'Lim', 'Zhang', 'Chen', 'Wang', 'Kim', 'Nguyen', 'Wong', 'Goh', 'Khoo', 'Koh', 'Ong', 'Lee'];
function guestFirst(name) {
  name = String(name || '').trim(); if (!name) return '';
  if (/^The /.test(name)) return name.replace(/^The /, '').replace(/ Family$/, ' family');
  var parts = name.split(/\s+/);
  return SURNAME_FIRST.indexOf(parts[0]) >= 0 ? name : parts[0];
}

var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* '2026-11-02' -> 'Mon, 2 Nov 2026' */
function fmtDate(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); if (!m) return '';
  var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return DOW[dt.getUTCDay()] + ', ' + (+m[3]) + ' ' + MON[+m[2] - 1] + ' ' + m[1];
}
/* '15:00' -> '3:00 PM' (as O.fmt.time) */
function fmtTime(t) {
  var m = /^(\d{2}):(\d{2})$/.exec(String(t || '')); if (!m) return '';
  var h = +m[1]; return ((h % 12) || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
}

/* the placeholders a greeting's text uses, in order, once each */
function keysIn(text) {
  var out = [], seen = {};
  String(text || '').replace(/\{([a-z0-9_]+)\}/g, function (m, k) { if (!seen[k]) { seen[k] = true; out.push(k); } return m; });
  return out;
}

/* a greeting as stored: trimmed, capped, fields with safe keys. Returns a new object. */
function clean(g) {
  g = g && typeof g === 'object' ? g : {};
  var keys = [];
  var fields = (Array.isArray(g.fields) ? g.fields : []).slice(0, MAX_FIELDS).map(function (f) {
    f = f && typeof f === 'object' ? f : {};
    var label = String(f.label || '').trim().slice(0, MAX_LABEL);
    var key = /^[a-z0-9_]{1,24}$/.test(String(f.key || '')) && keys.indexOf(f.key) < 0 ? f.key : fieldKey(label, keys);
    keys.push(key);
    var values = {};
    if (f.values && typeof f.values === 'object') Object.keys(f.values).forEach(function (pid) { var v = f.values[pid]; if (v != null && String(v).trim() !== '') values[String(pid)] = String(v).trim().slice(0, MAX_VALUE); });
    return { key: key, label: label || key, private: f.private === undefined ? defaultPrivate(label) : !!f.private, values: values };
  });
  var out = { id: g.id, buildingId: g.buildingId || null, name: String(g.name || '').trim().slice(0, MAX_NAME), text: String(g.text || '').slice(0, MAX_TEXT), fields: fields };
  if (g.updatedAt) out.updatedAt = g.updatedAt;
  if (g.updatedBy) out.updatedBy = g.updatedBy;
  return out;
}

/* the built-in values for one booking.
   ctx = {booking, unit (the property record), unitType, building, link (guest app link)} -> {vars, typed, ciTime}
   With no booking the samples are used (the editor's preview). */
function builtins(ctx) {
  ctx = ctx || {};
  var b = ctx.booking, p = ctx.unit || null, t = ctx.unitType || null, bd = ctx.building || null;
  var vars = {};
  if (!b) { BUILTINS.forEach(function (x) { vars[x[0]] = x[2]; }); if (bd && bd.name) vars.building = bd.name; return { vars: vars, typed: false, ciTime: '15:00', sample: true }; }
  var wifi = p && Array.isArray(p.wifi) ? p.wifi : ['', ''];
  var ciTime = GM.ciTimeOf(b, p, bd);
  var coTime = /^\d{2}:\d{2}$/.test(String(b.checkOutTime || '')) ? b.checkOutTime : (p && p.checkOutTime) || (bd && bd.checkOutTime) || '11:00';
  var nights = b.nights || (b.checkIn && b.checkOut ? Math.round((Date.parse(b.checkOut + 'T00:00:00Z') - Date.parse(b.checkIn + 'T00:00:00Z')) / 864e5) : '');
  var name = b.guest && b.guest.name ? String(b.guest.name) : '';
  vars.guest_first = guestFirst(name);
  vars.guest_name = name;
  vars.building = (bd && bd.name) || (p && p.name) || '';
  vars.unit_no = p ? String(p.unitNo || '') : '';
  vars.door_code = b.doorCode != null ? String(b.doorCode) : '';
  vars.checkin_date = fmtDate(b.checkIn);
  vars.checkin_time = fmtTime(ciTime);
  vars.checkout_date = fmtDate(b.checkOut);
  vars.checkout_time = fmtTime(coTime);
  vars.nights = nights === '' ? '' : String(nights);
  vars.guests = b.guests != null ? String(b.guests) : '';
  vars.wifi_name = String(wifi[0] || '');
  vars.wifi_password = String(wifi[1] || '');
  vars.parking = p && p.parking ? String(p.parking) : '';
  vars.guest_app_link = ctx.link ? String(ctx.link) : '';
  return { vars: vars, typed: !!(t || (p && p.unitTypeId)), ciTime: ciTime, sample: false };
}

/* the guest-facing words for a held value */
function heldWords(key, link, why) {
  if (why === 'id') return 'in ' + (link ? 'your guest app (' + link + ')' : 'your guest app') + ' once your ID is checked';
  if (key === 'door_code' || key === 'unit_no' || key === 'wifi_name' || key === 'wifi_password') return GM.heldText(key, link);
  return 'sent to you from 30 minutes before check-in';
}

/* Fill a greeting for one booking at one moment.
   ctx as builtins(); o = {now: 'YYYY-MM-DDTHH:MM' (Malaysia time; the server's clock when sending), mask: true to show
   MASK instead of a private value that would be sent (a person without door-code access)}.
   -> {text, parts: [{kind: 'fixed'|'var'|'held'|'missing'|'unknown', key?, text}], held: [keys], missing: [keys], sample}
   The door code and private fields are held before check-in minus 30 minutes and when the send time is unknown; they
   also wait while the booking's ID check is not done (idVerified, codeStatus 'held'), as quick replies do. */
function fill(greeting, ctx, o) {
  o = o || {}; ctx = ctx || {};
  var g = clean(greeting), b = ctx.booking || null;
  var base = builtins(ctx);
  /* the held wording names the guest app link only when the text does not already give it */
  var link = ctx.link && keysIn(g.text).indexOf('guest_app_link') < 0 ? ctx.link : '';
  var guarded = b ? GM.guardVars(base.vars, { b: b, sendAt: o.now, ciTime: base.ciTime, typed: base.typed, link: link }) : { vars: base.vars, held: [] };
  var vals = guarded.vars, held = guarded.held.slice();
  var at = b ? GM.revealAt(b, base.ciTime) : null;
  var early = !!b && (!o.now || !at || String(o.now) < at);
  var idHold = !!b && (!b.idVerified || b.codeStatus === 'held'); /* as the inbox's quick replies: no code before the ID check */
  var privateKeys = { door_code: true };
  if (base.typed) { privateKeys.unit_no = true; privateKeys.wifi_name = true; privateKeys.wifi_password = true; }
  /* the door code also waits for the ID check */
  if (b && idHold && vals.door_code && held.indexOf('door_code') < 0) { vals.door_code = heldWords('door_code', link, 'id'); held.push('door_code'); }
  var fieldBy = {}, missing = [];
  g.fields.forEach(function (f) {
    var k = 'f_' + f.key; fieldBy[k] = f;
    var pid = ctx.unit && ctx.unit.id != null ? String(ctx.unit.id) : '';
    var v = !b ? ((!f.private || !o.mask) && (f.values[pid] || firstValue(f))) || '[' + f.label + ']' : (pid && f.values[pid]) || '';
    if (b && !v) { missing.push(k); vals[k] = ''; return; }
    if (f.private) privateKeys[k] = true;
    if (b && f.private && (early || idHold)) { vals[k] = heldWords(k, link, early ? 'time' : 'id'); held.push(k); return; }
    vals[k] = v;
  });
  var parts = [], text = '', last = 0, src = g.text, re = /\{([a-z0-9_]+)\}/g, m;
  function push(kind, s, key) { if (!s && kind === 'fixed') return; parts.push(key ? { kind: kind, key: key, text: s } : { kind: kind, text: s }); text += s; }
  while ((m = re.exec(src))) {
    push('fixed', src.slice(last, m.index));
    var key = m[1];
    if (!(key in vals) || (!BUILTIN_KEYS[key] && !fieldBy[key])) push('unknown', m[0], key);
    else if (held.indexOf(key) >= 0) push('held', vals[key], key);
    else if (missing.indexOf(key) >= 0 || vals[key] === '') push('missing', '', key);
    else if (o.mask && privateKeys[key] && !base.sample) push('var', MASK, key);
    else push('var', String(vals[key]), key);
    last = re.lastIndex;
  }
  push('fixed', src.slice(last));
  var used = keysIn(src), inText = function (k) { return used.indexOf(k) >= 0; }; /* report only what the text uses */
  return { text: text, parts: parts, held: held.filter(inText), missing: missing.filter(inText), sample: !!base.sample };
}
function firstValue(f) { var ks = Object.keys(f.values || {}); return ks.length ? f.values[ks[0]] : ''; }

/* the greetings of a building, by name */
function forBuilding(list, buildingId) {
  return (list || []).filter(function (g) { return g && g.buildingId === buildingId; })
    .sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')) || (String(a.id) < String(b.id) ? -1 : 1); });
}

var API = {
  BUILTINS: BUILTINS, MASK: MASK, MAX_FIELDS: MAX_FIELDS, MAX_TEXT: MAX_TEXT,
  defaultPrivate: defaultPrivate, fieldKey: fieldKey, guestFirst: guestFirst, fmtDate: fmtDate, fmtTime: fmtTime,
  keysIn: keysIn, clean: clean, builtins: builtins, fill: fill, forBuilding: forBuilding, isBuiltin: function (k) { return !!BUILTIN_KEYS[k]; }
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
