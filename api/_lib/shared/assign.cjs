/* Unit assignment: which unit of a unit type a booking stays in.
 *
 * One file for both sides. The server requires it (CommonJS); scripts/build.mjs inlines it into the page as O.assign,
 * so the browser (direct bookings, manual moves, blocks, demo mode) and the server (platform bookings) follow the same
 * rules. Plain ES5 on purpose: it runs as a classic script in the page. No dates from the clock: callers pass `now`.
 *
 * Data it reads (the same objects the app keeps in D):
 *   unit     {id, unitTypeId, unitNo, assignPriority, archived}            (a property record)
 *   booking  {id, unitTypeId, propertyId, checkIn, checkOut, checkInTime, status, codeStatus,
 *             assignment: {how: 'auto'|'manual', by, at, locked}, needsUnit}
 *   block    {id, propertyId, start, end}                                  (end is the first free night, like checkOut)
 *
 * Rules (docs: notes/channex-build-plan.md, section 2.3):
 *   1. A locked booking never moves (picked by hand, guest in the unit, door code sent, or unit number shown to the guest).
 *   2. A changed booking keeps its unit when that unit is still free for the new dates.
 *   3. Candidates are active units of the booking's type that are free for every night (no live booking, no block).
 *   4. Best fit: the smallest gap to the stays before and after, then the lower assignPriority, then unit number order.
 *   5. No single unit free for the whole stay: no unit (needsUnit). If the type has fewer free units than bookings on
 *      some night, the type is oversold as well.
 */
'use strict';

var REVEAL_MINUTES = 30;   /* the guest sees the unit number this many minutes before check-in */
var GAP_CAP = 30;          /* a neighbour further away than this (or none) counts as this many days */
var DEAD = { cancelled: 1, deleted: 1 };

function live(b) { return !!b && !DEAD[b.status]; }
function activeUnit(u) { return !!u && !u.archived && u.status !== 'archived'; }
function ms(iso) { var p = String(iso).slice(0, 10).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
function addDays(iso, n) { return new Date(ms(iso) + n * 864e5).toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((ms(b) - ms(a)) / 864e5); }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function validTime(t) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '') ? t : null; }
/* 'YYYY-MM-DDTHH:MM' plus minutes */
function addMinutes(iso, mins) {
  var t = (+iso.slice(11, 13)) * 60 + (+iso.slice(14, 16)) + mins, days = Math.floor(t / 1440);
  t -= days * 1440;
  return addDays(iso.slice(0, 10), days) + 'T' + pad(Math.floor(t / 60)) + ':' + pad(t % 60);
}
function naturalCompare(a, b) { return String(a == null ? '' : a).localeCompare(String(b == null ? '' : b), 'en', { numeric: true, sensitivity: 'base' }); }

/* when the guest may see the unit number: check-in time minus 30 minutes (ciTime falls back to 15:00) */
function unitRevealAt(b, ciTime) {
  if (!b || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.checkIn || ''))) return null;
  return addMinutes(b.checkIn + 'T' + (validTime(b.checkInTime) || validTime(ciTime) || '15:00'), -REVEAL_MINUTES);
}

/* why a booking must stay where it is, or null: 'manual' | 'in_house' | 'code_sent' | 'revealed' */
function lockReason(b, now, ciTime) {
  if (!b || !b.propertyId) return null;
  if (b.assignment && b.assignment.locked) return 'manual';
  if (b.status === 'checked_in' || b.status === 'checked_out') return 'in_house';
  if (b.codeStatus === 'sent') return 'code_sent';
  if (now) { var at = unitRevealAt(b, ciTime); if (at && String(now) >= at && String(now).slice(0, 10) < b.checkOut) return 'revealed'; }
  return null;
}

/* what keeps a unit busy between from and to ([from, to) nights), ignoring booking skipId: {kind, booking|block} or null */
function clash(unitId, from, to, ctx, skipId) {
  var i, x;
  var bs = ctx.bookings || [], bl = ctx.blocks || [];
  for (i = 0; i < bs.length; i++) {
    x = bs[i];
    if (x && x.id !== skipId && x.propertyId === unitId && live(x) && x.checkIn < to && from < x.checkOut) return { kind: 'booking', booking: x };
  }
  for (i = 0; i < bl.length; i++) {
    x = bl[i];
    if (x && x.propertyId === unitId && x.start < to && from < x.end) return { kind: 'block', block: x };
  }
  return null;
}

/* days between this stay and the unit's stays (or blocks) right before and after it; smaller is a tighter fit */
function gapScore(unitId, b, ctx) {
  var before = GAP_CAP, after = GAP_CAP;
  function look(start, end) {
    if (end <= b.checkIn) before = Math.min(before, daysBetween(end, b.checkIn));
    if (start >= b.checkOut) after = Math.min(after, daysBetween(b.checkOut, start));
  }
  (ctx.bookings || []).forEach(function (x) { if (x && x.id !== b.id && x.propertyId === unitId && live(x)) look(x.checkIn, x.checkOut); });
  (ctx.blocks || []).forEach(function (x) { if (x && x.propertyId === unitId) look(x.start, x.end); });
  return before + after;
}
function priority(u) { var n = Number(u.assignPriority); return u.assignPriority === '' || u.assignPriority == null || !isFinite(n) ? Infinity : n; }

/* per night from..to (inclusive): how many units of the type can still be sold.
   raw = free units (active, not blocked, no assigned live booking) - unassigned live bookings of the type; availability = max(0, raw) */
function typeAvailability(o) {
  var units = (o.units || []).filter(function (u) { return activeUnit(u) && u.unitTypeId === o.unitTypeId; });
  var ids = {}; units.forEach(function (u) { ids[u.id] = 1; });
  var out = [], day = o.from, n = 0;
  while (day <= o.to && n++ < 800) {
    var next = addDays(day, 1), busy = {}, waiting = 0;
    (o.bookings || []).forEach(function (b) {
      if (!b || b.id === o.skipId || !live(b) || !(b.checkIn <= day && day < b.checkOut)) return;
      if (b.propertyId && ids[b.propertyId]) busy[b.propertyId] = 1;
      else if (!b.propertyId && b.unitTypeId === o.unitTypeId) waiting++;
    });
    (o.blocks || []).forEach(function (x) { if (x && ids[x.propertyId] && x.start < next && day < x.end) busy[x.propertyId] = 1; });
    var free = units.length - Object.keys(busy).length, raw = free - waiting;
    out.push({ date: day, units: units.length, free: free, unassigned: waiting, raw: raw, availability: Math.max(0, raw) });
    day = next;
  }
  return out;
}

/* choose a unit for one booking. o = {booking, units, bookings, blocks, now, fresh, ignoreLock, ciTime}
   fresh: ignore the current unit (rule 2), e.g. the "Re-assign" button. ignoreLock: treat a locked booking as unlocked.
   -> {unitId, reason: 'untyped'|'locked'|'kept'|'best_fit'|'needs_unit'|'oversold', lock, conflict, needsUnit, oversold,
       candidates: [unit ids, best first], moved: [{bookingId, from, to}]} */
function assignUnits(o) {
  var b = o.booking, ctx = { bookings: o.bookings || [], blocks: o.blocks || [] }, units = o.units || [];
  var cur = (b && b.propertyId) || null;
  var res = { unitId: cur, reason: '', lock: null, conflict: false, needsUnit: false, oversold: false, candidates: [], moved: [] };
  if (!b || !b.unitTypeId) { res.reason = 'untyped'; return res; }
  if (!b.checkIn || !b.checkOut || b.checkOut <= b.checkIn) { res.reason = 'untyped'; return res; }
  var byId = {}; units.forEach(function (u) { if (u && u.id != null) byId[u.id] = u; });
  if (!o.ignoreLock) {
    var lk = lockReason(b, o.now, o.ciTime);
    if (lk) { res.reason = 'locked'; res.lock = lk; res.conflict = !!clash(cur, b.checkIn, b.checkOut, ctx, b.id); return res; }
  }
  if (!o.fresh && cur && activeUnit(byId[cur]) && !clash(cur, b.checkIn, b.checkOut, ctx, b.id)) { res.reason = 'kept'; res.candidates = [cur]; return res; }
  var cands = units.filter(function (u) { return activeUnit(u) && u.unitTypeId === b.unitTypeId && !clash(u.id, b.checkIn, b.checkOut, ctx, b.id); });
  cands = cands.map(function (u) { return { u: u, gap: gapScore(u.id, b, ctx), pr: priority(u) }; }).sort(function (x, y) {
    return x.gap - y.gap || (x.pr === y.pr ? 0 : x.pr < y.pr ? -1 : 1) || naturalCompare(x.u.unitNo, y.u.unitNo) || naturalCompare(x.u.id, y.u.id);
  });
  res.candidates = cands.map(function (c) { return c.u.id; });
  if (cands.length) { res.unitId = cands[0].u.id; res.reason = 'best_fit'; }
  else {
    res.unitId = null; res.needsUnit = true;
    var nights = typeAvailability({ unitTypeId: b.unitTypeId, units: units, bookings: ctx.bookings, blocks: ctx.blocks, from: b.checkIn, to: addDays(b.checkOut, -1), skipId: b.id });
    res.oversold = nights.some(function (n) { return n.raw < 1; });
    res.reason = res.oversold ? 'oversold' : 'needs_unit';
  }
  if (res.unitId !== cur) res.moved.push({ bookingId: b.id, from: cur, to: res.unitId });
  return res;
}

/* write a result onto the booking. meta = {how: 'auto'|'manual', by, at, locked}. Returns true when the unit changed. */
function applyResult(b, res, meta) {
  meta = meta || {};
  if (!b || !res || res.reason === 'untyped' || res.reason === 'locked') return false;
  var changed = (b.propertyId || null) !== (res.unitId || null);
  if (res.unitId) { b.propertyId = res.unitId; if (b.needsUnit) delete b.needsUnit; }
  else { b.propertyId = null; b.needsUnit = true; }
  if (changed || !b.assignment || meta.how === 'manual' || meta.force) {
    b.assignment = { how: meta.how || 'auto', by: meta.by || null, at: meta.at || null, locked: !!meta.locked };
  }
  return changed;
}

/* re-run assignment for every unlocked typed booking that has no unit or whose unit is no longer usable
   (blocked, archived, retagged, double booked). Changes the bookings in place, earliest check-in first.
   o = {bookings, units, blocks, now, from (only stays ending after this day), unitTypeIds (optional filter), by, at}
   -> [{bookingId, from, to, reason}] */
function reassignAll(o) {
  var bs = o.bookings || [], units = o.units || [], ctx = { bookings: bs, blocks: o.blocks || [] }, moves = [];
  var byId = {}; units.forEach(function (u) { if (u && u.id != null) byId[u.id] = u; });
  var only = o.unitTypeIds ? {} : null; (o.unitTypeIds || []).forEach(function (t) { only[t] = 1; });
  var list = bs.filter(function (b) { return live(b) && b.unitTypeId && (!only || only[b.unitTypeId]) && (!o.from || b.checkOut > o.from) && b.status !== 'checked_out'; })
    .sort(function (a, b) { return a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : naturalCompare(a.id, b.id); });
  list.forEach(function (b) {
    if (lockReason(b, o.now, o.ciTime)) return;
    var u = b.propertyId ? byId[b.propertyId] : null;
    var fine = u && activeUnit(u) && u.unitTypeId === b.unitTypeId && !clash(u.id, b.checkIn, b.checkOut, ctx, b.id);
    if (fine) return;
    var res = assignUnits({ booking: b, units: units, bookings: bs, blocks: ctx.blocks, now: o.now, fresh: !!(u && u.unitTypeId !== b.unitTypeId) });
    var from = b.propertyId || null;
    if (applyResult(b, res, { how: 'auto', by: o.by || null, at: o.at || null })) moves.push({ bookingId: b.id, from: from, to: res.unitId, reason: res.reason });
  });
  return moves;
}

var API = {
  REVEAL_MINUTES: REVEAL_MINUTES,
  live: live, activeUnit: activeUnit, addDays: addDays, addMinutes: addMinutes, naturalCompare: naturalCompare,
  unitRevealAt: unitRevealAt, lockReason: lockReason, clash: clash, gapScore: gapScore,
  typeAvailability: typeAvailability, assignUnits: assignUnits, applyResult: applyResult, reassignAll: reassignAll
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
