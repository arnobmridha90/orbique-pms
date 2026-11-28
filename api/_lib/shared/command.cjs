/* The in-app assistant's plan checker (Arnob, 2026-11-27: "I can write inside the app what I want and it gets done").
 * Shared by the page (app/server/assistant.js, as O.command) and the server (api/_lib/command.js, which reads the model's
 * plan with normalize()).
 *
 * The model (Claude, api/_lib/command.js) turns what the owner typed into a list of steps. Nothing here trusts it: every
 * step is checked against the workspace's own data before anything changes, and a plan with one bad step is not applied
 * at all.
 *
 *   ACTIONS                      what a step may do
 *   normalize(raw)               the model's step -> a clean step (known fields, right types), or null
 *   check(step, w)               -> {ok, problems[], warn[], risky, text}: is the step possible, and in plain words what it does
 *   checkPlan(steps, w)          -> {ok, steps: [check results], risky, problems[]}; steps are checked in order, as if the
 *                                   earlier ones were already done (a swap then a move sees the swap)
 *
 * w (the workspace as the page holds it): {today, lastDay?, bookings, units, types, blocks, rateOf(typeId, iso)?, unitsOfType(typeId)?, hasPlan(typeId)?}
 *   booking {id, guest: {name}, propertyId, unitTypeId, checkIn, checkOut, status, channel, channex, guests, revealed?}
 *   unit {id, unitNo, name, short, unitTypeId, archived}; type {id, name, maxGuests}; block {id, propertyId, start, end (exclusive), note}
 *
 * risky: the owner taps Confirm first (cancellations, date changes that move money, prices over more than 7 nights or
 * more than 30% away from today's price, stopping sales). Everything else is applied straight away and can be undone.
 * Guest messages are never part of a plan: the owner sends those by hand.
 */
'use strict';

const ACTIONS = ['move_booking', 'swap_units', 'edit_booking', 'cancel_booking', 'set_price', 'reset_price', 'set_restrictions', 'block_dates', 'unblock_dates'];
const MAX_STEPS = 20;
const MAX_NIGHTS = 366;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n || 200) : '');
const iso = (v) => (typeof v === 'string' && ISO.test(v.trim()) && !isNaN(Date.parse(v.trim() + 'T00:00:00Z')) ? v.trim() : '');
function toUTC(d) { const p = d.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
function addDays(d, n) { return new Date(toUTC(d) + n * 864e5).toISOString().slice(0, 10); }
function diff(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 864e5); }
function dow(d) { return new Date(toUTC(d)).getUTCDay(); }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmt(d) { return +d.slice(8, 10) + ' ' + MON[+d.slice(5, 7) - 1]; }
function fmtRange(a, b) { return a === b ? fmt(a) : (a.slice(0, 7) === b.slice(0, 7) ? +a.slice(8, 10) + '–' + fmt(b) : fmt(a) + ' – ' + fmt(b)); }
function money(n) { return 'RM' + (Math.round(n * 100) / 100).toLocaleString('en-US'); }
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function normalize(raw) {
  if (!isObj(raw) || ACTIONS.indexOf(raw.action) < 0) return null;
  const s = { action: raw.action };
  ['booking', 'booking_b', 'unit', 'unit_type'].forEach((k) => { const v = str(raw[k], 80); if (v) s[k] = v; });
  ['from', 'to', 'check_in', 'check_out'].forEach((k) => { const v = iso(raw[k]); if (v) s[k] = v; });
  if (Array.isArray(raw.units)) { const u = raw.units.map((x) => str(x, 80)).filter(Boolean).slice(0, 30); if (u.length) s.units = u; }
  if (Array.isArray(raw.block_ids)) { const u = raw.block_ids.map((x) => str(x, 80)).filter(Boolean).slice(0, 60); if (u.length) s.block_ids = u; }
  if (Array.isArray(raw.weekdays)) { const w = raw.weekdays.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6); if (w.length && w.length < 7) s.weekdays = Array.from(new Set(w)).sort(); }
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() && isFinite(+v) ? +v : null);
  if (num(raw.price) !== null) s.price = Math.round(num(raw.price) * 100) / 100;
  if (num(raw.guests) !== null) s.guests = Math.round(num(raw.guests));
  if (num(raw.min_stay) !== null) s.min_stay = Math.round(num(raw.min_stay));
  if (typeof raw.stop_sell === 'boolean') s.stop_sell = raw.stop_sell;
  const gn = str(raw.guest_name, 120); if (gn) s.guest_name = gn;
  const ph = str(raw.phone, 40); if (ph) s.phone = ph;
  const em = str(raw.email, 120); if (em) s.email = em;
  if (typeof raw.note === 'string') s.note = raw.note.trim().slice(0, 1000);
  ['arrival_time', 'departure_time'].forEach((k) => { const v = str(raw[k], 5); if (TIME.test(v)) s[k] = v; });
  return s;
}

/* ---------- lookups ---------- */
function unitLabel(u) { return u ? (u.unitNo ? u.unitNo : u.short || u.name || u.id) : 'no unit'; }
function findUnit(w, key) {
  if (!key) return null;
  const k = String(key).trim().toLowerCase().replace(/^unit\s+/, '');
  return w.units.find((u) => u.id === key) || w.units.find((u) => u.unitNo && String(u.unitNo).toLowerCase() === k) || null;
}
function findType(w, key) {
  if (!key) return null;
  const k = String(key).trim().toLowerCase();
  return w.types.find((t) => t.id === key) || w.types.find((t) => String(t.name).toLowerCase() === k) || w.types.find((t) => String(t.name).toLowerCase().indexOf(k) === 0) || null;
}
function findBooking(w, key) { return key ? w.bookings.find((b) => b.id === key) || w.bookings.find((b) => b.reservationCode && String(b.reservationCode) === String(key)) || null : null; }
const live = (b) => b && b.status !== 'cancelled' && b.status !== 'no_show';
const otaLocked = (b) => !!(b && b.channel && b.channel !== 'direct' && b.channex);
const gname = (b) => (b && b.guest && b.guest.name) || 'the guest';
function typeName(w, id) { const t = w.types.find((x) => x.id === id); return t ? t.name : ''; }

/* what else is at the unit on those nights, in the plan's working copy */
function clash(w, unitId, ci, co, skip) {
  const b = w.bookings.find((o) => skip.indexOf(o.id) < 0 && o.propertyId === unitId && live(o) && o.status !== 'checked_out' && o.checkIn < co && ci < o.checkOut);
  if (b) return gname(b) + ' ' + fmtRange(b.checkIn, addDays(b.checkOut, -1));
  const k = (w.blocks || []).find((x) => x.propertyId === unitId && x.start < co && ci < x.end);
  return k ? 'a block ' + fmtRange(k.start, addDays(k.end, -1)) : '';
}
function nightsIn(from, to, weekdays) {
  const out = []; let d = from;
  while (d <= to && out.length <= MAX_NIGHTS) { if (!weekdays || weekdays.indexOf(dow(d)) >= 0) out.push(d); d = addDays(d, 1); }
  return out;
}

/* ---------- one step ---------- */
function check(step, w) {
  const r = { ok: true, problems: [], warn: [], risky: false, text: '', step: step };
  const no = (m) => { r.ok = false; r.problems.push(m); };
  if (!step || ACTIONS.indexOf(step.action) < 0) { no('Orbique cannot do this step.'); return r; }
  const today = w.today;
  const bookingFor = (key, label) => {
    const b = findBooking(w, key);
    if (!b) { no('Booking ' + (key || '(not named)') + ' was not found.'); return null; }
    if (label !== 'any' && !live(b)) no(gname(b) + "'s booking is " + (b.status === 'cancelled' ? 'cancelled' : 'not active') + '.');
    return b;
  };
  const shown = (b) => (b.revealed || b.codeStatus === 'sent' || b.status === 'checked_in');

  switch (step.action) {
    case 'move_booking': {
      const b = bookingFor(step.booking); const u = findUnit(w, step.unit);
      if (!u) no('Unit ' + (step.unit || '(not named)') + ' was not found.');
      if (!b || !u) break;
      r.text = 'Move ' + gname(b) + ' (' + fmtRange(b.checkIn, b.checkOut) + ') from ' + unitLabel(w.units.find((x) => x.id === b.propertyId)) + ' to ' + unitLabel(u);
      if (b.status === 'checked_out') no(gname(b) + ' has already checked out.');
      if (u.archived) no(unitLabel(u) + ' is archived.');
      if (u.id === b.propertyId) { no(gname(b) + ' is already in ' + unitLabel(u) + '.'); break; }
      const c = clash(w, u.id, b.checkIn, b.checkOut, [b.id]); if (c) no(unitLabel(u) + ' is taken: ' + c + '.');
      if (b.unitTypeId && u.unitTypeId && u.unitTypeId !== b.unitTypeId) r.warn.push(gname(b) + ' booked ' + (typeName(w, b.unitTypeId) || 'another type') + '; ' + unitLabel(u) + ' is ' + (typeName(w, u.unitTypeId) || 'another type') + '.');
      if (shown(b)) r.warn.push(gname(b) + ' may already have the old unit number: tell them.');
      if (r.ok) { b.propertyId = u.id; }
      break;
    }
    case 'swap_units': {
      const a = bookingFor(step.booking), b = bookingFor(step.booking_b);
      if (!a || !b) break;
      if (a.id === b.id) { no('Pick two different bookings to swap.'); break; }
      const ua = w.units.find((x) => x.id === a.propertyId), ub = w.units.find((x) => x.id === b.propertyId);
      if (!ua || !ub) { no((ua ? gname(b) : gname(a)) + ' has no unit yet, so there is nothing to swap.'); break; }
      r.text = 'Swap units: ' + gname(a) + ' ' + unitLabel(ua) + ' → ' + unitLabel(ub) + ', ' + gname(b) + ' ' + unitLabel(ub) + ' → ' + unitLabel(ua);
      if (a.status === 'checked_out' || b.status === 'checked_out') no('One of these guests has already checked out.');
      const c1 = clash(w, ub.id, a.checkIn, a.checkOut, [a.id, b.id]); if (c1) no(unitLabel(ub) + ' is taken for ' + gname(a) + "'s dates: " + c1 + '.');
      const c2 = clash(w, ua.id, b.checkIn, b.checkOut, [a.id, b.id]); if (c2) no(unitLabel(ua) + ' is taken for ' + gname(b) + "'s dates: " + c2 + '.');
      if (ua.unitTypeId !== ub.unitTypeId) r.warn.push(unitLabel(ua) + ' is ' + (typeName(w, ua.unitTypeId) || 'one type') + ' and ' + unitLabel(ub) + ' is ' + (typeName(w, ub.unitTypeId) || 'another') + ': each guest gets a different room type than they booked.');
      [a, b].forEach((x) => { if (shown(x)) r.warn.push(gname(x) + ' may already have the old unit number: tell them.'); });
      if (r.ok) { a.propertyId = ub.id; b.propertyId = ua.id; }
      break;
    }
    case 'edit_booking': {
      const b = bookingFor(step.booking, 'any'); if (!b) break;
      const bits = [];
      const ci = step.check_in || b.checkIn, co = step.check_out || b.checkOut;
      const dates = ci !== b.checkIn || co !== b.checkOut;
      if (dates) {
        bits.push('dates ' + fmtRange(b.checkIn, b.checkOut) + ' → ' + fmtRange(ci, co));
        if (!live(b) || b.status === 'checked_out') no('Only an upcoming or current stay can change dates.');
        if (otaLocked(b)) no('Dates of a ' + (b.channel || 'booking site') + ' booking change on that site; the change then arrives here by itself.');
        if (co <= ci) no('Check-out must be after check-in.');
        else if (diff(ci, co) > 90) no('A booking can be at most 90 nights.');
        if (ci !== b.checkIn && (ci < today || b.status === 'checked_in')) no('The check-in date cannot change to the past or after the guest arrived.');
        if (co !== b.checkOut && co <= today) no('Check-out cannot be in the past.');
        if (b.propertyId && co > ci) { const c = clash(w, b.propertyId, ci, co, [b.id]); if (c) no(unitLabel(w.units.find((x) => x.id === b.propertyId)) + ' is taken: ' + c + '.'); }
        r.risky = true; /* the price follows the nights */
        r.warn.push('The price follows the new number of nights: check it, and settle any difference with the guest.');
      }
      if (step.guests !== undefined) {
        const t = w.types.find((x) => x.id === b.unitTypeId), max = t && +t.maxGuests > 0 ? +t.maxGuests : 8;
        if (step.guests < 1 || step.guests > max) no('Guests must be between 1 and ' + max + '.');
        else if (step.guests !== b.guests) bits.push('guests ' + (b.guests || '?') + ' → ' + step.guests);
      }
      if (step.guest_name && step.guest_name !== gname(b)) bits.push('name → ' + step.guest_name);
      if (step.phone !== undefined && step.phone !== ((b.guest || {}).phone || '')) bits.push('phone → ' + step.phone);
      if (step.email !== undefined) { if (step.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(step.email)) no('The email address does not look right.'); else bits.push('email → ' + step.email); }
      if (step.note !== undefined && step.note !== (b.notes || '')) bits.push(step.note ? 'note → "' + step.note.slice(0, 80) + '"' : 'note removed');
      if (step.arrival_time && step.arrival_time !== b.checkInTime) bits.push('arrival ' + step.arrival_time);
      if (step.departure_time && step.departure_time !== b.checkOutTime) bits.push('departure ' + step.departure_time);
      r.text = 'Edit ' + gname(b) + "'s booking: " + (bits.join(', ') || 'nothing to change');
      if (!bits.length) no('Nothing would change on ' + gname(b) + "'s booking.");
      if (r.ok && dates) { b.checkIn = ci; b.checkOut = co; }
      break;
    }
    case 'cancel_booking': {
      const b = bookingFor(step.booking, 'any'); if (!b) break;
      r.text = 'Cancel ' + gname(b) + "'s booking (" + fmtRange(b.checkIn, b.checkOut) + ')';
      r.risky = true;
      if (b.status !== 'confirmed' && b.status !== 'pending') no('Only an upcoming booking can be cancelled.');
      if (otaLocked(b)) no('Cancel this on ' + (b.channel || 'the booking site') + '; the cancellation then arrives here by itself.');
      if (b.paidAt) r.warn.push('The guest has paid: arrange any refund with them.');
      if (r.ok) b.status = 'cancelled';
      break;
    }
    case 'set_price': case 'reset_price': case 'set_restrictions': {
      const t = findType(w, step.unit_type);
      if (!t) { no('Room type ' + (step.unit_type || '(not named)') + ' was not found.'); break; }
      const from = step.from, to = step.to || step.from;
      if (!from) { no('Say which nights.'); break; }
      if (to < from) { no('The last night is before the first.'); break; }
      if (from < today) no('Prices can only change from today on.');
      if (w.lastDay && to > w.lastDay) no('Prices can be set up to ' + fmt(w.lastDay) + ' only.');
      const nights = nightsIn(from, to, step.weekdays);
      if (nights.length > MAX_NIGHTS) { no('That is more than a year of nights.'); break; }
      if (!nights.length) { no('No nights match.'); break; }
      if (w.hasPlan && !w.hasPlan(t.id)) no(t.name + ' has no main rate plan yet (Channels), so its price cannot be set here.');
      const when = fmtRange(from, to) + (step.weekdays ? ' (' + step.weekdays.map((d) => DOW[d]).join(', ') + ' only)' : '') + ', ' + nights.length + (nights.length === 1 ? ' night' : ' nights');
      const n = w.unitsOfType ? w.unitsOfType(t.id).length : 0, all = n > 1 ? ' (all ' + n + ' units, every booking site)' : ' (every booking site)';
      if (step.action === 'set_price') {
        if (!(step.price > 0)) { no('Say the new price.'); break; }
        r.text = 'Set ' + t.name + ' to ' + money(step.price) + ' a night for ' + when + all;
        const now = w.rateOf ? nights.map((d) => w.rateOf(t.id, d)).filter((x) => x > 0) : [];
        const far = now.some((x) => Math.abs(step.price - x) / x > 0.3);
        if (nights.length > 7 || far) r.risky = true;
        if (far) r.warn.push('This is more than 30% away from the price now (' + money(Math.min.apply(null, now)) + (Math.min.apply(null, now) !== Math.max.apply(null, now) ? '–' + money(Math.max.apply(null, now)) : '') + ').');
        if (step.price < 100 || step.price > 5000) { r.risky = true; r.warn.push('Check the amount: ' + money(step.price) + ' a night.'); }
      } else if (step.action === 'reset_price') {
        r.text = 'Put ' + t.name + ' back on the normal price for ' + when + all;
        if (nights.length > 7) r.risky = true;
      } else {
        const bits = [];
        if (step.min_stay !== undefined) { if (step.min_stay < 1 || step.min_stay > 30) no('Minimum stay must be 1 to 30 nights.'); else bits.push('minimum stay ' + step.min_stay + (step.min_stay === 1 ? ' night' : ' nights')); }
        if (step.stop_sell !== undefined) { bits.push(step.stop_sell ? 'stop selling (closed on every site)' : 'open for sale again'); if (step.stop_sell) r.risky = true; }
        if (!bits.length) no('Say what to change: minimum stay, or open / close for sale.');
        r.text = t.name + ': ' + bits.join(', ') + ' for ' + when;
      }
      break;
    }
    case 'block_dates': {
      const keys = step.units || (step.unit ? [step.unit] : []);
      const us = keys.map((k) => findUnit(w, k));
      if (!keys.length) no('Say which units.');
      keys.forEach((k, i) => { if (!us[i]) no('Unit ' + k + ' was not found.'); });
      const from = step.from, to = step.to || step.from;
      if (!from) { no('Say which nights.'); break; }
      if (to < from) { no('The last night is before the first.'); break; }
      if (to < today) no('Those nights are in the past.');
      if (diff(from, to) > MAX_NIGHTS) no('That is more than a year of nights.');
      const end = addDays(to, 1);
      us.filter(Boolean).forEach((u) => { const c = clash(w, u.id, from, end, []); if (c) no(unitLabel(u) + ' has ' + c + ' then. Move or cancel it first.'); });
      r.text = 'Block ' + us.filter(Boolean).map(unitLabel).join(', ') + ' for ' + fmtRange(from, to) + (step.note ? ' (' + step.note.slice(0, 60) + ')' : '');
      if (r.ok) us.forEach((u, i) => w.blocks.push({ id: '_new' + i + '_' + u.id, propertyId: u.id, start: from, end: end }));
      break;
    }
    case 'unblock_dates': {
      const ids = step.block_ids || [];
      if (!ids.length) { no('Say which blocks to open.'); break; }
      const found = ids.map((id) => (w.blocks || []).find((x) => x.id === id));
      ids.forEach((id, i) => { if (!found[i]) no('Block ' + id + ' was not found.'); });
      r.text = 'Open again: ' + found.filter(Boolean).map((k) => unitLabel(w.units.find((u) => u.id === k.propertyId)) + ' ' + fmtRange(k.start, addDays(k.end, -1))).join('; ');
      if (r.ok) w.blocks = w.blocks.filter((x) => ids.indexOf(x.id) < 0);
      break;
    }
  }
  return r;
}

/* the whole plan, in order, on a working copy (the page's data is not touched) */
function checkPlan(steps, w0) {
  const w = Object.assign({}, w0, {
    bookings: (w0.bookings || []).map((b) => Object.assign({}, b)),
    blocks: (w0.blocks || []).map((b) => Object.assign({}, b))
  });
  const list = (Array.isArray(steps) ? steps : []).slice(0, MAX_STEPS);
  const out = list.map((s) => check(s, w));
  const problems = [];
  out.forEach((r) => r.problems.forEach((p) => problems.push(p)));
  return { ok: out.length > 0 && problems.length === 0, steps: out, risky: out.some((r) => r.risky), problems: problems };
}

module.exports = { ACTIONS, MAX_STEPS, normalize, check, checkPlan, findUnit, findType, findBooking, nightsIn, otaLocked, addDays };
