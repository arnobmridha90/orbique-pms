/* The order of the Dashboard's cards, which each person can change by dragging (Arnob, 2026-11-21: "I want to be able
 * to re-organise the dashboard both in the mobile and web app with just drag function").
 *
 * Two layouts per person, because a phone and a computer show the page differently:
 *   wide:   [[left column keys], [right column keys]]   screens wider than 1100px (two columns)
 *   narrow: [keys]                                       phones, the phone app and narrow windows (one column)
 * Saved in the records collection 'dashLayouts', one record per team member: {id: staffId, wide, narrow, at}
 * (app/pages/dashboard.js), so the order follows the person to every device.
 *
 * A card the person may not see (Staff Access) is simply not drawn; its place in the saved order is kept, so it comes
 * back where it was if access is given again. A card added to the Dashboard later, which a saved order does not name,
 * goes in after the card it follows in the default order (merge()).
 *
 * Shared by the page (inlined by scripts/build.mjs as O.dashorder) and node tests (tests/dashorder.test.mjs).
 * No browser or network code. ES5.
 */
'use strict';

var KEYS = ['arrivals', 'sameday', 'departures', 'newtoday', 'inhouse', 'tasks', 'attention', 'costs', 'duesoon'];

/* the default order. o.mineFirst: the person sees only their own tasks (housekeeping, maintenance), so tasks come first;
   o.stays: the person sees bookings (check-ins, check-outs, in-house). Phone order (Arnob asked to fix it, 2026-11-21):
   what has to happen today first (check-ins, same-day bookings, check-outs), then what needs a reply or a hand
   (needs attention, tasks), then what is simply good to know (new bookings, in-house), then the office cards (due soon,
   financials). Wide order: the two columns Arnob set on 2026-11-18. */
function defaults(mode, o) {
  o = o || {};
  var mine = !!o.mineFirst, stays = o.stays !== false;
  if (mode === 'wide') {
    if (!stays) return mine ? [['tasks'], ['costs', 'attention', 'duesoon']] : [['attention', 'tasks'], ['costs', 'duesoon']];
    return mine
      ? [['newtoday', 'sameday', 'arrivals', 'departures'], ['costs', 'tasks', 'attention', 'duesoon', 'inhouse']]
      : [['arrivals', 'sameday', 'departures', 'newtoday', 'inhouse'], ['attention', 'costs', 'duesoon', 'tasks']];
  }
  var list = mine
    ? ['tasks', 'arrivals', 'sameday', 'departures', 'attention', 'newtoday', 'inhouse', 'duesoon', 'costs']
    : ['arrivals', 'sameday', 'departures', 'attention', 'tasks', 'newtoday', 'inhouse', 'duesoon', 'costs'];
  return stays ? list : list.filter(function (k) { return ['arrivals', 'sameday', 'departures', 'newtoday', 'inhouse'].indexOf(k) < 0; });
}

/* known keys only, each once (seen is shared across the columns of a wide layout) */
function clean(list, seen) {
  var out = [];
  (Array.isArray(list) ? list : []).forEach(function (k) {
    if (typeof k !== 'string' || KEYS.indexOf(k) < 0 || seen[k]) return;
    seen[k] = 1; out.push(k);
  });
  return out;
}

/* put every key of ref (the full default for the mode) that the lists do not have after the key it follows in ref */
function fill(lists, refs) {
  var have = {};
  lists.forEach(function (l) { l.forEach(function (k) { have[k] = 1; }); });
  refs.forEach(function (ref, c) {
    ref.forEach(function (k, i) {
      if (have[k]) return;
      var target = lists[c], at = 0;
      for (var j = i - 1; j >= 0; j--) {
        var pos = target.indexOf(ref[j]);
        if (pos >= 0) { at = pos + 1; break; }
      }
      target.splice(at, 0, k); have[k] = 1;
    });
  });
  return lists;
}

/* the order to draw: the saved one (cleaned, with any new card added) or, with nothing usable saved, the default */
function merge(mode, saved, o) {
  o = o || {};
  var full = defaults(mode, { mineFirst: o.mineFirst, stays: true }), seen = {};
  if (mode === 'wide') {
    if (!isWide(saved)) return defaults(mode, o);
    return fill([clean(saved[0], seen), clean(saved[1], seen)], full);
  }
  if (!Array.isArray(saved) || !clean(saved, {}).length) return defaults(mode, o);
  return fill([clean(saved, seen)], [full])[0];
}

function isWide(v) { return Array.isArray(v) && v.length === 2 && Array.isArray(v[0]) && Array.isArray(v[1]) && clean(v[0].concat(v[1]), {}).length > 0; }

/* the order to save after a drag. drawn: what is on screen now (wide: [[...], [...]], narrow: [...]), which leaves out
   the cards this person cannot see or that are empty today. Those keep their place: each one goes back in after the
   card it followed in the previous order, so a drag never loses a hidden card's position */
function afterDrag(mode, drawn, previous) {
  var seen = {};
  if (mode === 'wide') {
    var cols = [clean(drawn && drawn[0], seen), clean(drawn && drawn[1], seen)];
    var prev = isWide(previous) ? previous : defaults('wide', { stays: true });
    return fill(cols, [clean(prev[0], {}), clean(prev[1], {})]);
  }
  var list = clean(drawn, seen);
  return fill([list], [clean(Array.isArray(previous) ? previous : defaults('narrow', { stays: true }), {})])[0];
}

module.exports = { KEYS: KEYS, defaults: defaults, merge: merge, afterDrag: afterDrag, isWide: isWide };
