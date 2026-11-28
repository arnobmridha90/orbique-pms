/* When a property is renamed, carry the new unit number into the fields that the calendar and phone screens show
 * (Arnob, 2026-11-26: "Property name changes in the PMS does not reflect in the calendar. Check 33A-3A").
 *
 * The calendar labels a unit of a unit type by its unit number ("Unit 33-3") and, on phones, by its short name. Both are
 * separate fields on the property, so renaming "Deluxe 2BR Suite 33-3, ..." to "Deluxe 2BR Suite 33A-3A, ..." left the
 * calendar on 33-3. followRename() works out the old and new unit number from the two names and swaps it in the unit
 * number and short name, unless the person changed those fields themselves in the same edit.
 *
 * Shared by the page (inlined by scripts/build.mjs as O.unitname) and node tests (tests/unitname.test.mjs).
 * No browser or network code. ES5.
 */
'use strict';

var MAX_NO = 12, MAX_SHORT = 20;

/* the words of a name that could be unit numbers: '33-3', '26-3A', '12B', 'A-1-2' (letters, digits, - and /) */
function tokens(name) { return String(name || '').match(/[A-Za-z0-9]+(?:[-\/][A-Za-z0-9]+)*/g) || []; }
function hasDigit(s) { return /\d/.test(s); }
function low(s) { return String(s || '').toLowerCase(); }
function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&'); }

/* the unit number the rename changed: { from, to } or null. `hint` is the unit number saved on the property (it tells
   which word of the old name is the unit number when the name has several numbers, such as "2BR"). */
function numberChange(oldName, newName, hint) {
  var a = tokens(oldName), b = tokens(newName);
  if (!a.length || !b.length || low(oldName) === low(newName)) return null;
  var i = -1;
  if (hint) a.forEach(function (w, k) { if (i < 0 && low(w) === low(hint)) i = k; });
  /* same number of words: the word at the same place */
  if (a.length === b.length) {
    var diff = [];
    a.forEach(function (w, k) { if (low(w) !== low(b[k]) && hasDigit(w) && hasDigit(b[k])) diff.push(k); });
    if (i >= 0) return low(a[i]) !== low(b[i]) && hasDigit(b[i]) ? { from: a[i], to: b[i] } : null;
    return diff.length === 1 ? { from: a[diff[0]], to: b[diff[0]] } : null;
  }
  /* words added or removed: one numbered word went away and one came in */
  var inA = {}, inB = {};
  a.forEach(function (w) { inA[low(w)] = 1; }); b.forEach(function (w) { inB[low(w)] = 1; });
  var gone = a.filter(function (w) { return hasDigit(w) && !inB[low(w)]; }), came = b.filter(function (w) { return hasDigit(w) && !inA[low(w)]; });
  if (i >= 0) gone = inB[low(a[i])] ? [] : [a[i]];
  return gone.length === 1 && came.length === 1 ? { from: gone[0], to: came[0] } : null;
}

/* what the unit number and short name become after renaming oldName to newName.
   cur: { unitNo, short } as saved; typed: { unitNo, short } as the form holds them now (left as typed when they differ
   from the saved values, because the person changed them on purpose). Returns { unitNo, short, change }. */
function followRename(oldName, newName, cur, typed) {
  cur = cur || {}; typed = typed || cur;
  var out = { unitNo: typed.unitNo || '', short: typed.short || '', change: null };
  var ch = numberChange(oldName, newName, cur.unitNo);
  if (!ch) return out;
  out.change = ch;
  if (low(typed.unitNo) === low(cur.unitNo) && cur.unitNo && low(cur.unitNo) === low(ch.from) && ch.to.length <= MAX_NO) out.unitNo = ch.to;
  if ((typed.short || '') === (cur.short || '') && cur.short) {
    var re = new RegExp('(^|[^A-Za-z0-9])' + esc(ch.from) + '(?![A-Za-z0-9])', 'i');
    var s = cur.short;
    if (re.test(s)) s = s.replace(re, function (m, pre) { return pre + ch.to; });
    if (s.length <= MAX_SHORT) out.short = s;
  }
  return out;
}

module.exports = { tokens: tokens, numberChange: numberChange, followRename: followRename };
