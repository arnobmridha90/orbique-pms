/* Timed guest messages: three messages that go out by themselves for every booking.
 *
 * Arnob, 2026-11-14: "send them the house rules and the welcome and checkout messages automatically" and "Three timed
 * messages will be automatic and on by default until I turn it off manually from the app". Guests' questions are
 * always answered by people (no automatic replies).
 *
 *   confirm   right after the booking comes in (only bookings that came in after the switch-on, `since`)
 *   welcome   24 hours before check-in, with the unit, door code and Wi-Fi (the same moment the guest app shows them)
 *   checkout  6:00 PM the evening before check-out
 *
 * Settings: blob 'guestJourney'
 *   {since: 'YYYY-MM-DDTHH:MM' (Malaysia time; nothing due before it is sent), askPhone: bool,
 *    steps: {confirm|welcome|checkout: {on: bool, text: string, airbnb: string}}}
 * A workspace without the blob sends nothing. text is the message, with the greeting placeholders ({guest_first},
 * {unit_no}, {door_code}, {wifi_name} ...) plus {level} (the part of the unit number before the dash). airbnb is the
 * version for Airbnb guests (Airbnb does not allow a deposit taken outside Airbnb); empty means text.
 *
 * Shared by the page (inlined by scripts/build.mjs as O.journey, after O.greeting: Inbox settings and its preview),
 * the server (api/_lib/journey.js, which sends them from the worker) and node tests (tests/inbox/journey.test.mjs).
 * ES5, no dependencies other than greeting.cjs.
 */
'use strict';

var GR = (typeof window !== 'undefined' && window.O && window.O.greeting) ? window.O.greeting
  : (typeof require === 'function' ? require('./greeting.cjs') : null);

var STEPS = ['confirm', 'welcome', 'checkout'];
var NAMES = { confirm: 'Booking confirmed', welcome: 'Welcome, 24 hours before check-in', checkout: 'Check-out reminder, the evening before' };
var MAX_TEXT = 4000;
var CHECKOUT_EVE = '18:00';
var RETRY_MIN = 10, MAX_TRIES = 3;

function pad(n) { return (n < 10 ? '0' : '') + n; }
/* 'YYYY-MM-DDTHH:MM' plus minutes, as wall-clock time (no time zone involved) */
function addMinutes(at, min) {
  var t = Date.parse(at + ':00Z') + min * 60000, d = new Date(t);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
}
function isAt(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s); }
function isDay(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function validTime(t) { return /^\d{2}:\d{2}$/.test(String(t || '')) ? String(t) : ''; }

/* the settings with every step present; a missing blob gives null (nothing is sent) */
function settings(v) {
  if (!v || typeof v !== 'object') return null;
  var steps = v.steps && typeof v.steps === 'object' ? v.steps : {};
  var out = { since: isAt(v.since) ? v.since : null, askPhone: v.askPhone !== false, steps: {} };
  STEPS.forEach(function (k) {
    var s = steps[k] && typeof steps[k] === 'object' ? steps[k] : {};
    out.steps[k] = { on: s.on === true, text: String(s.text || '').slice(0, MAX_TEXT), airbnb: String(s.airbnb || '').slice(0, MAX_TEXT) };
  });
  return out;
}

/* when a step goes out for a booking ('YYYY-MM-DDTHH:MM' Malaysia time), and until when it still may:
   {at, until} or null. ciTime: the stay's check-in time (guestmsg.ciTimeOf). */
function dueWindow(step, b, ciTime) {
  if (!b || !isDay(b.checkIn) || !isDay(b.checkOut)) return null;
  var ci = b.checkIn + 'T' + (validTime(ciTime) || '15:00');
  if (step === 'confirm') {
    if (!isAt(b.createdAt)) return null;
    return { at: b.createdAt, until: ci };
  }
  if (step === 'welcome') return { at: addMinutes(ci, -24 * 60), until: b.checkOut + 'T10:00' };
  if (step === 'checkout') {
    var eve = addMinutes(b.checkOut + 'T' + CHECKOUT_EVE, -24 * 60);
    if (eve < ci) eve = ci; /* a one-night stay: not before check-in */
    return { at: eve, until: b.checkOut + 'T10:00' };
  }
  return null;
}

/* whether a step is due now for a booking: the step is on, the booking is a live stay, the moment has come and has not
   passed, and it fell after the switch-on (confirm: the booking came in after it). now: 'YYYY-MM-DDTHH:MM' */
function isDue(step, b, cfg, now, ciTime) {
  if (!cfg || !cfg.steps[step] || !cfg.steps[step].on || !b) return false;
  if (b.status && b.status !== 'confirmed' && b.status !== 'checked_in') return false; /* not cancelled, pending or gone */
  var w = dueWindow(step, b, ciTime);
  if (!w || now < w.at || now >= w.until) return false;
  if (cfg.since && w.at < cfg.since) return false;
  return true;
}

/* the text of a step for a booking's channel */
function textFor(cfg, step, channel) {
  var s = cfg && cfg.steps[step];
  if (!s) return '';
  return channel === 'airbnb' && s.airbnb.trim() ? s.airbnb : s.text;
}

/* the floor from a unit number: '41-1' -> '41', '26-3A' -> '26', 'A-12-3' -> '12' */
function levelOf(unitNo) {
  var parts = String(unitNo || '').split(/[-\s]/).filter(Boolean);
  if (parts.length < 2) return '';
  var nums = parts.filter(function (p) { return /^\d+[A-Za-z]?$/.test(p); });
  return nums.length >= 2 ? nums[0].replace(/[A-Za-z]$/, '') : (/^\d+$/.test(parts[parts.length - 2]) ? parts[parts.length - 2] : '');
}

var ASK_PHONE = 'Could you send us your WhatsApp number? It helps our team reach you on your arrival day.';

/* Fill a step for a booking. ctx = {booking, unit, unitType, building, link, fields (the building's greeting fields)}
   The door code is the unit's own lock code when it has one (a fixed code on the door), else the booking's.
   -> {text, missing: [keys]} */
function fill(text, ctx, o) {
  o = o || {}; ctx = ctx || {};
  var b = ctx.booking ? Object.assign({}, ctx.booking) : null, unit = ctx.unit || null;
  if (b && unit && unit.lockCode != null && String(unit.lockCode).trim()) b.doorCode = String(unit.lockCode).trim();
  var level = levelOf(unit && unit.unitNo);
  var src = String(text || '').replace(/\{level\}/g, level || '{level}');
  if (o.askPhone !== undefined) src = src.replace(/\{phone_ask\}/g, o.askPhone ? ASK_PHONE : '');
  var r = GR.fill({ id: 'journey', buildingId: null, name: '', text: src, fields: ctx.fields || [] }, { booking: b, unit: unit, unitType: ctx.unitType, building: ctx.building, link: ctx.link }, { now: o.now, mask: !!o.mask });
  var missing = r.missing.slice();
  if (/\{level\}/.test(String(text || '')) && !level) missing.push('level');
  /* tidy: an empty {phone_ask} or empty value leaves no run of blank lines */
  var out = r.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: out, missing: missing };
}

/* ---------- phone numbers in guest messages ---------- */

/* A WhatsApp number in a guest's message, as +<digits>, or ''. Conservative: the message must be mostly the number,
   or name it (phone, WhatsApp, number, contact, call, mobile, HP, 电话, 手机, nombor). A Malaysian number written with
   a leading 0 gets +60. Dates, booking references and prices are not numbers. */
function phoneIn(text) {
  var s = String(text || '');
  if (!s || s.length > 400) return '';
  var re = /(\+?\d[\d\s().-]{6,18}\d)/g, m, found = [];
  while ((m = re.exec(s))) found.push(m[1]);
  if (found.length !== 1) return '';
  var raw = found[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) || /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(raw)) return '';
  var digits = raw.replace(/\D/g, '');
  var rest = s.replace(raw, '').replace(/[\s.,:;!?()+\-]/g, '');
  var named = /(phone|whats\s?app|\bwa\b|number|contact|call|mobile|\bhp\b|\btel\b|nombor|telefon|电话|手机|微信|号码)/i.test(s);
  if (rest.length > 24 && !named) return '';
  var plus = /^\s*\+/.test(raw);
  if (plus) return digits.length >= 8 && digits.length <= 15 ? '+' + digits : '';
  if (/^0\d{8,10}$/.test(digits)) return '+60' + digits.slice(1); /* 012-345 6789, 03-2142 8800 */
  if (/^60\d{8,10}$/.test(digits)) return '+' + digits;
  if (digits.length >= 10 && digits.length <= 15 && named) return '+' + digits;
  return '';
}
function samePhone(a, b) {
  var x = String(a || '').replace(/\D/g, ''), y = String(b || '').replace(/\D/g, '');
  if (!x || !y) return false;
  return x === y || x.slice(-9) === y.slice(-9);
}

var API = {
  STEPS: STEPS, NAMES: NAMES, MAX_TEXT: MAX_TEXT, RETRY_MIN: RETRY_MIN, MAX_TRIES: MAX_TRIES, ASK_PHONE: ASK_PHONE,
  addMinutes: addMinutes, settings: settings, dueWindow: dueWindow, isDue: isDue, textFor: textFor, levelOf: levelOf,
  fill: fill, phoneIn: phoneIn, samePhone: samePhone
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
