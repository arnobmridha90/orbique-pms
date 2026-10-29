/* Guest messages: what a message may tell the guest at the moment it is sent.
 *
 * The owner's rule: the door code, and for a unit type the unit number and the unit's own Wi-Fi, reach the guest only
 * from 24 hours before check-in (the same moment the guest app shows them, see supabase/migrations/0020_reveal_24h.sql).
 * Owner, 2026-10-29: guests get everything a day early, so it is saved before they board the flight.
 * A message template or a quick reply sent earlier must not carry them: the placeholder is replaced by guest-app wording.
 *
 * Shared by the page (inlined by scripts/build.mjs as O.guestmsg, after O.assign) and node tests (tests/guestmsg.test.mjs).
 * ES5, no dependencies other than assign.cjs.
 */
'use strict';

var A = (typeof window !== 'undefined' && window.O && window.O.assign) ? window.O.assign
  : (typeof require === 'function' ? require('./assign.cjs') : null);

/* check-in time for a booking: its own, then the unit's, then the building's, then 15:00 (same order as guest_get / guest_act) */
function ciTimeOf(b, unit, building) {
  var ok = function (t) { return /^\d{2}:\d{2}$/.test(String(t || '')) ? String(t) : ''; };
  return ok(b && b.checkInTime) || ok(unit && unit.checkInTime) || ok(building && building.checkInTime) || '15:00';
}

/* the moment the door code (and a typed unit's number) may reach the guest: check-in minus 24 hours */
function revealAt(b, ciTime) {
  if (!b || !b.checkIn) return null;
  return A.unitRevealAt({ checkIn: b.checkIn, checkInTime: ciTime || b.checkInTime }, ciTime);
}

/* when an automated journey step goes out for a booking ('YYYY-MM-DDTHH:MM'), or null when unknown */
function stepSendAt(stepId, b, ciTime) {
  if (!b || !b.checkIn) return null;
  switch (stepId) {
    case 'j1': case 'j2': return b.createdAt ? String(b.createdAt).slice(0, 16) : null;
    case 'j3': return A.addDays(b.checkIn, -3) + 'T09:00';
    case 'j4': return revealAt(b, ciTime); /* the door code step: exactly check-in minus 24 hours */
    case 'j5': return b.checkIn + 'T09:00';
    case 'j6': return A.addDays(b.checkIn, 1) + 'T09:00';
    case 'j7': return b.checkOut ? A.addDays(b.checkOut, -1) + 'T18:00' : null;
    default: return null;
  }
}

/* what a held placeholder says instead */
function heldText(key, link) {
  if (key === 'wifi_password') return 'in your guest app';
  return 'in ' + (link ? 'your guest app (' + link + ')' : 'your guest app') + ' from 24 hours before check-in';
}

/* vars: the template values; o = {b, sendAt, ciTime, typed, link}. Returns {vars, held: [keys]}.
   Before the reveal moment (or when the send time is unknown) door_code is held; for a typed unit also unit_no,
   wifi_name and wifi_password. The input object is not changed. */
function guardVars(vars, o) {
  o = o || {};
  var out = {}, held = [], k;
  for (k in vars) if (Object.prototype.hasOwnProperty.call(vars, k)) out[k] = vars[k];
  var at = revealAt(o.b, o.ciTime), early = !o.sendAt || !at || String(o.sendAt) < at;
  if (!early) return { vars: out, held: held };
  var keys = ['door_code'].concat(o.typed ? ['unit_no', 'wifi_name', 'wifi_password'] : []);
  keys.forEach(function (key) {
    if (out[key] == null || out[key] === '') return;
    out[key] = heldText(key, o.link);
    held.push(key);
  });
  return { vars: out, held: held };
}

/* fill {placeholders} in a template with guarded values; unknown placeholders stay as they are */
function fillTemplate(text, vars, o) {
  var g = guardVars(vars, o);
  return String(text || '').replace(/\{([a-z_]+)\}/g, function (m, key) { return g.vars[key] != null ? String(g.vars[key]) : m; });
}

var API = { ciTimeOf: ciTimeOf, revealAt: revealAt, stepSendAt: stepSendAt, guardVars: guardVars, fillTemplate: fillTemplate, heldText: heldText };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
