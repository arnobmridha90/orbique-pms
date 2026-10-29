/* Nearby places for the guest app: the maths and data rules behind the "Nearby" section, with no browser or network code.
 *
 * Arnob: "In the Guest App, I want a section where we will highlight few popular food joints, streetfood places, other
 * important places like hospitals near by, money exchange nearby, etc. All these will have offline maps to these locations
 * so that when someone does not have internet, they can still use the app to go to these locations and also back to our
 * building location. Remember that this will obviously be different for every building"
 *
 * A place (records collection 'places', one list per building):
 *   {id, buildingId, name, category, note, address, lat, lng, hours, phone, order,
 *    route: {coords: [[lng, lat], ...] (at most MAX_ROUTE_POINTS), meters, minutes, mode: 'foot'} | null, osmId, updatedAt}
 *   (routeStale: true while the building moved and the route is being found again; staff only)
 * A building carries lat / lng (decimal degrees) for its own pin.
 *
 * Shared by the page (inlined by scripts/build.mjs as O.geo), the node tests (tests/places.test.mjs) and, for the limits,
 * the database function guest__nearby (supabase/migrations/0021_guest_places.sql). ES5, no dependencies.
 */
'use strict';

var R = 6371008.8;               /* mean Earth radius in metres */
var WALK_M_PER_MIN = 80;         /* about 4.8 km/h, the speed the walking time is shown at */
var MAX_ROUTE_POINTS = 400;      /* a stored route keeps at most this many points */
var MAX_PLACES = 60;             /* places per building the guest app shows */
var MAX_TILES = 250;             /* map tiles one building saves for offline use */
var SUGGEST_RADIUS = 1500;       /* "Suggest nearby" looks this far from the building, in metres */

/* [id, label, colour, OpenStreetMap tags that map to it] (the order guests see the groups in) */
var CATEGORIES = [
  { id: 'food', label: 'Food', color: '#C2410C' },
  { id: 'streetfood', label: 'Street food', color: '#B45309' },
  { id: 'cafe', label: 'Cafe', color: '#92400E' },
  { id: 'hospital', label: 'Hospital', color: '#B91C1C' },
  { id: 'clinic', label: 'Clinic', color: '#DC2626' },
  { id: 'pharmacy', label: 'Pharmacy', color: '#0F766E' },
  { id: 'money', label: 'Money exchange', color: '#15803D' },
  { id: 'atm', label: 'ATM', color: '#166534' },
  { id: 'convenience', label: 'Convenience store', color: '#1D4ED8' },
  { id: 'supermarket', label: 'Supermarket', color: '#1E40AF' },
  { id: 'transport', label: 'Train and bus', color: '#6D28D9' },
  { id: 'police', label: 'Police', color: '#1E3A8A' },
  { id: 'laundry', label: 'Laundry', color: '#0369A1' },
  { id: 'other', label: 'Other', color: '#475569' }
];
var CAT_BY_ID = {};
CATEGORIES.forEach(function (c) { CAT_BY_ID[c.id] = c; });
function category(id) { return CAT_BY_ID[id] || CAT_BY_ID.other; }

function num(v) { var n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return typeof n === 'number' && isFinite(n) ? n : null; }
function validLatLng(lat, lng) { lat = num(lat); lng = num(lng); return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0); }
function rad(d) { return d * Math.PI / 180; }
function deg(r) { return r * 180 / Math.PI; }
function round(n, dp) { var f = Math.pow(10, dp); return Math.round(n * f) / f; }

/* great-circle distance in metres between {lat, lng} points */
function distance(a, b) {
  var dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/* initial compass bearing from a to b, 0 to 360 (0 = north, 90 = east) */
function bearing(a, b) {
  var y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  var x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
var POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
function compassWord(b) { return POINTS[Math.round((((b % 360) + 360) % 360) / 45) % 8]; }
/* "450 m", "1.2 km" (rounded so the number does not flicker while walking) */
function fmtDistance(m) {
  if (m == null || !isFinite(m)) return '';
  if (m < 20) return 'Here';
  if (m < 1000) return (m < 200 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50) + ' m';
  return (m < 10000 ? round(m / 1000, 1) : Math.round(m / 1000)) + ' km';
}
function walkMinutes(m) { return Math.max(1, Math.round(m / WALK_M_PER_MIN)); }
/* "6 min walk", "1 h 10 min walk" */
function fmtWalk(min) {
  min = Math.max(1, Math.round(min));
  return (min < 60 ? min + ' min' : Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '')) + ' walk';
}
/* the line under a place: "Walk north-east, 450 m" */
function directionText(from, to) {
  var m = distance(from, to);
  if (m < 20) return 'You are here';
  return 'Walk ' + compassWord(bearing(from, to)) + ', ' + fmtDistance(m);
}

/* ---------- route simplification (Douglas-Peucker in local metres) ---------- */
function toXY(c, lat0) { return [rad(c[0]) * R * Math.cos(rad(lat0)), rad(c[1]) * R]; }
function segDist(p, a, b) {
  var dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  var x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return Math.sqrt(x * x + y * y);
}
function dp(xy, tol) {
  var keep = new Array(xy.length), stack = [[0, xy.length - 1]], i;
  keep[0] = keep[xy.length - 1] = true;
  while (stack.length) {
    var s = stack.pop(), a = s[0], b = s[1], best = -1, at = -1;
    for (i = a + 1; i < b; i++) { var dd = segDist(xy[i], xy[a], xy[b]); if (dd > best) { best = dd; at = i; } }
    if (best > tol) { keep[at] = true; stack.push([a, at], [at, b]); }
  }
  var out = [];
  for (i = 0; i < xy.length; i++) if (keep[i]) out.push(i);
  return out;
}
/* coords [[lng, lat], ...] -> fewer points (tolerance in metres, raised until at most maxPoints remain), rounded to 6 decimals */
function simplify(coords, tolMeters, maxPoints) {
  var list = (Array.isArray(coords) ? coords : []).filter(function (c) { return Array.isArray(c) && validLatLng(c[1], c[0]); }).map(function (c) { return [num(c[0]), num(c[1])]; });
  var max = Math.max(2, maxPoints || MAX_ROUTE_POINTS), tol = tolMeters == null ? 3 : tolMeters;
  if (list.length <= 2) return list.map(function (c) { return [round(c[0], 6), round(c[1], 6)]; });
  var lat0 = list[0][1], xy = list.map(function (c) { return toXY(c, lat0); }), idx = dp(xy, tol);
  while (idx.length > max) { tol = tol ? tol * 1.6 : 1; idx = dp(xy, tol); }
  return idx.map(function (i) { return [round(list[i][0], 6), round(list[i][1], 6)]; });
}
/* length of a [[lng, lat], ...] line in metres */
function lineLength(coords) {
  var m = 0;
  for (var i = 1; i < coords.length; i++) m += distance({ lat: coords[i - 1][1], lng: coords[i - 1][0] }, { lat: coords[i][1], lng: coords[i][0] });
  return m;
}
/* an OSRM answer (routing.openstreetmap.de, geometries=geojson) -> a stored route, or null */
function routeFromOsrm(json) {
  var r = json && json.code === 'Ok' && Array.isArray(json.routes) ? json.routes[0] : null;
  var coords = r && r.geometry && Array.isArray(r.geometry.coordinates) ? simplify(r.geometry.coordinates, 3, MAX_ROUTE_POINTS) : [];
  if (coords.length < 2) return null;
  var meters = num(r.distance); if (meters === null) meters = lineLength(coords);
  meters = Math.round(meters);
  /* OSRM's foot profile can be optimistic; show at least our own walking pace */
  var minutes = Math.max(walkMinutes(meters), Math.round((num(r.duration) || 0) / 60));
  return { coords: coords, meters: meters, minutes: minutes, mode: 'foot' };
}
/* the same route walked the other way (back to the building) */
function reverseRoute(route) {
  if (!route || !Array.isArray(route.coords)) return null;
  return { coords: route.coords.slice().reverse(), meters: route.meters, minutes: route.minutes, mode: route.mode || 'foot' };
}

/* where the walker is along a route: {remaining (metres to the end along the route, or straight when off it), off (metres
   from the line), ahead: {lat, lng} (a point about 25 m further on, to point the arrow at), onRoute} */
function progress(coords, pos, offLimit) {
  if (!Array.isArray(coords) || coords.length < 2 || !pos) return null;
  var lat0 = pos.lat, me = toXY([pos.lng, pos.lat], lat0), best = Infinity, seg = 0, t = 0, i;
  var xy = coords.map(function (c) { return toXY(c, lat0); });
  for (i = 0; i < xy.length - 1; i++) {
    var a = xy[i], b = xy[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, u = l ? ((me[0] - a[0]) * dx + (me[1] - a[1]) * dy) / l : 0;
    u = Math.max(0, Math.min(1, u));
    var x = a[0] + u * dx - me[0], y = a[1] + u * dy - me[1], dd = Math.sqrt(x * x + y * y);
    if (dd < best) { best = dd; seg = i; t = u; }
  }
  var end = { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] };
  var limit = offLimit == null ? 60 : offLimit;
  if (best > limit) return { remaining: distance(pos, end), off: best, ahead: end, onRoute: false };
  var segLen = function (k) { return distance({ lat: coords[k][1], lng: coords[k][0] }, { lat: coords[k + 1][1], lng: coords[k + 1][0] }); };
  var rest = segLen(seg) * (1 - t);
  for (i = seg + 1; i < coords.length - 1; i++) rest += segLen(i);
  /* the point about 25 m ahead along the line */
  var need = 25, k = seg, left = segLen(seg) * (1 - t), ahead = end;
  while (k < coords.length - 1) {
    if (left >= need) { var f = 1 - (left - need) / (segLen(k) || 1); ahead = { lat: coords[k][1] + (coords[k + 1][1] - coords[k][1]) * f, lng: coords[k][0] + (coords[k + 1][0] - coords[k][0]) * f }; break; }
    need -= left; k++; if (k < coords.length - 1) left = segLen(k);
  }
  return { remaining: rest, off: best, ahead: ahead, onRoute: true };
}

/* ---------- map tiles for offline use (slippy-map numbering) ---------- */
function lngToX(lng, z) { return Math.floor((lng + 180) / 360 * Math.pow(2, z)); }
function latToY(lat, z) { var r = rad(Math.max(-85.0511, Math.min(85.0511, lat))); return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)); }
/* points [{lat, lng}] -> [west, south, east, north], padded by padMeters on every side */
function bbox(points, padMeters) {
  var w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  (points || []).forEach(function (p) { if (!p || !validLatLng(p.lat, p.lng)) return; w = Math.min(w, p.lng); e = Math.max(e, p.lng); s = Math.min(s, p.lat); n = Math.max(n, p.lat); });
  if (w === Infinity) return null;
  var pad = padMeters || 0, dLat = deg(pad / R), dLng = deg(pad / (R * Math.cos(rad((s + n) / 2))));
  return [w - dLng, Math.max(-85, s - dLat), e + dLng, Math.min(85, n + dLat)];
}
/* the x / y ranges of tiles covering a bbox at zoom z */
function tileRange(bb, z) {
  var n = Math.pow(2, z) - 1;
  return { z: z, x0: Math.max(0, lngToX(bb[0], z)), x1: Math.min(n, lngToX(bb[2], z)), y0: Math.max(0, latToY(bb[3], z)), y1: Math.min(n, latToY(bb[1], z)) };
}
/* every tile [z, x, y] for zooms zmin..zmax, lowest zoom first; a zoom that would pass the cap is left out whole (with
   every zoom above it), so the saved map is complete up to the zoom it reaches. -> {tiles, zooms: [z...], skipped} */
function tilesFor(bb, zmin, zmax, cap) {
  var out = [], zooms = [], skipped = 0, limit = cap == null ? MAX_TILES : cap, full = false;
  if (!bb) return { tiles: out, zooms: zooms, skipped: 0 };
  for (var z = zmin; z <= zmax; z++) {
    var r = tileRange(bb, z), count = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    if (full || out.length + count > limit) { full = true; skipped += count; continue; }
    for (var x = r.x0; x <= r.x1; x++) for (var y = r.y0; y <= r.y1; y++) out.push([z, x, y]);
    zooms.push(z);
  }
  return { tiles: out, zooms: zooms, skipped: skipped };
}
/* the points a building's saved map must cover: the building, every place and every route point */
function coverPoints(building, places) {
  var pts = [];
  if (building && validLatLng(building.lat, building.lng)) pts.push({ lat: num(building.lat), lng: num(building.lng) });
  (places || []).forEach(function (p) {
    if (p && validLatLng(p.lat, p.lng)) pts.push({ lat: num(p.lat), lng: num(p.lng) });
    var c = p && p.route && Array.isArray(p.route.coords) ? p.route.coords : [];
    c.forEach(function (q) { if (Array.isArray(q)) pts.push({ lat: q[1], lng: q[0] }); });
  });
  return pts;
}
/* the tiles a building saves for offline use: first the close area (the building, every place and route, padded by
   padMeters) at every zoom, then, while under the cap, the wider area each place's map screen shows (a phone screen
   fitted to the walk shows up to about 0.65 of its length beyond the line on each side), lowest zoom first.
   -> {tiles: [[z, x, y]], skipped} */
function coverTiles(building, places, zmin, zmax, cap, padMeters) {
  var limit = cap == null ? MAX_TILES : cap, core = bbox(coverPoints(building, places), padMeters == null ? 400 : padMeters);
  var first = tilesFor(core, zmin, zmax, limit), seen = {}, out = first.tiles.slice(), skipped = first.skipped;
  out.forEach(function (t) { seen[t.join('/')] = 1; });
  if (!core) return { tiles: out, skipped: skipped };
  var home = building && validLatLng(building.lat, building.lng) ? { lat: num(building.lat), lng: num(building.lng) } : null, wide = [];
  (places || []).forEach(function (p) {
    if (!p || !home || !validLatLng(p.lat, p.lng)) return;
    var pts = coverPoints(building, [p]), m = distance(home, { lat: num(p.lat), lng: num(p.lng) });
    if (p.route && num(p.route.meters)) m = Math.max(m, num(p.route.meters) * 0.7);
    var pad = 0.65 * m;
    if (pad > (padMeters == null ? 400 : padMeters)) wide.push(bbox(pts, pad));
  });
  for (var z = zmin; z <= zmax; z++) {
    wide.forEach(function (bb) {
      var r = tileRange(bb, z);
      for (var x = r.x0; x <= r.x1; x++) for (var y = r.y0; y <= r.y1; y++) {
        var k = z + '/' + x + '/' + y;
        if (seen[k]) continue;
        seen[k] = 1;
        if (out.length >= limit) skipped++; else out.push([z, x, y]);
      }
    });
  }
  return { tiles: out, skipped: skipped };
}
function fillTemplate(tpl, z, x, y) { return String(tpl).replace('{z}', z).replace('{x}', x).replace('{y}', y); }

/* ---------- OpenStreetMap suggestions (Overpass) ---------- */
/* the Overpass QL that finds the useful places within radius metres of a point */
function overpassQuery(lat, lng, radius) {
  var r = Math.round(radius || SUGGEST_RADIUS), at = '(around:' + r + ',' + round(lat, 6) + ',' + round(lng, 6) + ')';
  var parts = [
    'nwr["amenity"~"^(hospital|clinic|doctors|pharmacy|bureau_de_change|atm|police|restaurant|fast_food|food_court|cafe|marketplace)$"]' + at + ';',
    'nwr["shop"~"^(convenience|supermarket|laundry|dry_cleaning)$"]' + at + ';',
    'nwr["healthcare"~"^(hospital|clinic|pharmacy)$"]' + at + ';',
    'node["railway"="station"]' + at + ';',
    'node["public_transport"="station"]' + at + ';',
    'node["highway"="bus_stop"]["name"]' + at + ';'
  ];
  return '[out:json][timeout:25];(' + parts.join('') + ');out center tags 400;';
}
/* the category for a set of OpenStreetMap tags, or null when it is not one we suggest */
function categoryOfTags(t) {
  t = t || {};
  var a = t.amenity, s = t.shop, h = t.healthcare;
  if (a === 'hospital' || h === 'hospital') return 'hospital';
  if (a === 'clinic' || a === 'doctors' || h === 'clinic') return 'clinic';
  if (a === 'pharmacy' || h === 'pharmacy' || s === 'chemist') return 'pharmacy';
  if (a === 'bureau_de_change' || t.currency_exchange === 'yes') return 'money';
  if (a === 'atm') return 'atm';
  if (a === 'police') return 'police';
  if (a === 'food_court' || a === 'marketplace' || t.street_vendor === 'yes' || /hawker/i.test(t.name || '') || /hawker|street/i.test(t.cuisine || '')) return 'streetfood';
  if (a === 'restaurant' || a === 'fast_food') return 'food';
  if (a === 'cafe') return 'cafe';
  if (s === 'convenience') return 'convenience';
  if (s === 'supermarket') return 'supermarket';
  if (s === 'laundry' || s === 'dry_cleaning') return 'laundry';
  if (t.railway === 'station' || t.public_transport === 'station' || t.highway === 'bus_stop') return 'transport';
  return null;
}
function addressOf(t) {
  var street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  return [street, t['addr:suburb'] || t['addr:city']].filter(Boolean).join(', ');
}
/* Overpass elements -> suggestions sorted by distance from origin {lat, lng}: [{osmId, name, category, lat, lng, address,
   hours, phone, meters}]. Unnamed places, duplicates (same name and category within 60 m) and anything farther than
   radius are left out; at most perCategory of each category (nearest first). */
function mapOverpass(elements, origin, opts) {
  opts = opts || {};
  var radius = opts.radius || SUGGEST_RADIUS, per = opts.perCategory || 8, out = [], count = {};
  (Array.isArray(elements) ? elements : []).forEach(function (e) {
    if (!e || typeof e !== 'object') return;
    var t = e.tags || {}, name = String(t['name:en'] || t.name || '').trim();
    var lat = num(e.lat != null ? e.lat : e.center && e.center.lat), lng = num(e.lon != null ? e.lon : e.center && e.center.lon);
    var cat = categoryOfTags(t);
    if (!cat || !validLatLng(lat, lng)) return;
    if (!name) { if (cat !== 'atm') return; name = t.operator ? t.operator + ' ATM' : 'ATM'; }
    var m = origin ? distance(origin, { lat: lat, lng: lng }) : 0;
    if (origin && m > radius) return;
    out.push({ osmId: (e.type || 'node') + '/' + e.id, name: name.slice(0, 80), category: cat, lat: round(lat, 6), lng: round(lng, 6),
      address: addressOf(t).slice(0, 160), hours: String(t.opening_hours || '').slice(0, 80), phone: String(t.phone || t['contact:phone'] || '').slice(0, 40), meters: Math.round(m) });
  });
  out.sort(function (a, b) { return a.meters - b.meters || (a.name < b.name ? -1 : 1); });
  var kept = [];
  out.forEach(function (p) {
    if (kept.some(function (k) { return k.category === p.category && k.name.toLowerCase() === p.name.toLowerCase() && distance(k, p) < 60; })) return;
    count[p.category] = (count[p.category] || 0) + 1;
    if (count[p.category] <= per) kept.push(p);
  });
  return kept;
}

/* typed or pasted coordinates -> {lat, lng} or null: "3.0561, 101.6887", "3.0561 101.6887", a Google Maps link with
   @3.0561,101.6887 or ?q=3.0561,101.6887 */
function parseCoords(text) {
  var s = String(text || '').trim();
  var m = s.match(/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/) || s.match(/[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i) ||
    s.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  var lat = Number(m[1]), lng = Number(m[2]);
  return validLatLng(lat, lng) ? { lat: round(lat, 6), lng: round(lng, 6) } : null;
}

/* ---------- the drawing for the offline sketch ---------- */
/* points [{lat, lng}] -> a function projecting {lat, lng} to [x, y] inside a w x h box with pad pixels of margin
   (north up, same scale both ways). .scale is pixels per metre. */
function fit(points, w, h, pad) {
  var bb = bbox(points, 0) || [0, 0, 0, 0], lat0 = (bb[1] + bb[3]) / 2, k = Math.cos(rad(lat0));
  var mx = function (lng) { return rad(lng) * R * k; }, my = function (lat) { return rad(lat) * R; };
  var spanX = Math.max(1, mx(bb[2]) - mx(bb[0])), spanY = Math.max(1, my(bb[3]) - my(bb[1]));
  var sc = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
  if (!isFinite(sc) || sc <= 0) sc = 1;
  sc = Math.min(sc, 2.5); /* never closer than 2.5 px a metre, so two pins 10 m apart do not fill the screen */
  var cx = (mx(bb[0]) + mx(bb[2])) / 2, cy = (my(bb[1]) + my(bb[3])) / 2;
  var f = function (p) { return [round(w / 2 + (mx(p.lng) - cx) * sc, 1), round(h / 2 - (my(p.lat) - cy) * sc, 1)]; };
  f.scale = sc;
  return f;
}
/* a round scale-bar length (metres) close to a quarter of the given width in pixels */
function scaleBar(pxPerMeter, widthPx) {
  var want = widthPx / 4 / (pxPerMeter || 1), steps = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  for (var i = steps.length - 1; i >= 0; i--) if (steps[i] <= want) return steps[i];
  return steps[0];
}

/* ---------- places as the guest sees them ---------- */
/* a stored route line as guests get it: only [lng, lat] number pairs that are real coordinates, in order; null when fewer
   than 2 remain or the list is not 2 to 1000 entries long (guest__coords in 0021_guest_places.sql) */
function routeCoords(c) {
  if (!Array.isArray(c) || c.length < 2 || c.length > 1000) return null;
  var out = c.filter(function (q) { return Array.isArray(q) && q.length === 2 && typeof q[0] === 'number' && typeof q[1] === 'number' && isFinite(q[0]) && isFinite(q[1]) && q[0] >= -180 && q[0] <= 180 && q[1] >= -90 && q[1] <= 90; })
    .map(function (q) { return [q[0], q[1]]; });
  return out.length >= 2 ? out : null;
}
/* a stored place -> the fields a guest may see (also what guest__nearby returns), or null when it has no position */
function guestPlace(p) {
  if (!p || typeof p !== 'object' || p.archived === true || !validLatLng(p.lat, p.lng)) return null;
  var str = function (v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; };
  var r = p.route, route = null;
  var coords = r && typeof r === 'object' ? routeCoords(r.coords) : null;
  if (coords) route = { coords: coords, meters: num(r.meters), minutes: num(r.minutes), mode: 'foot' };
  return { id: String(p.id), name: str(p.name, 80) || 'Place', category: CAT_BY_ID[p.category] ? p.category : 'other', note: str(p.note, 240), address: str(p.address, 160),
    lat: num(p.lat), lng: num(p.lng), hours: str(p.hours, 80), phone: str(p.phone, 40), route: route };
}
/* the building's places in the order staff set (then by name), as the guest sees them */
function guestPlaces(list, buildingId) {
  return (Array.isArray(list) ? list : []).filter(function (p) { return p && p.buildingId === buildingId && p.archived !== true; })
    .slice().sort(function (a, b) {
      var oa = num(a.order) || 0, ob = num(b.order) || 0, na = String(a.name || '').toLowerCase(), nb = String(b.name || '').toLowerCase();
      return oa !== ob ? oa - ob : na !== nb ? (na < nb ? -1 : 1) : (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
    })
    .map(guestPlace).filter(Boolean).slice(0, MAX_PLACES);
}

module.exports = {
  CATEGORIES: CATEGORIES, category: category, WALK_M_PER_MIN: WALK_M_PER_MIN, MAX_ROUTE_POINTS: MAX_ROUTE_POINTS, MAX_PLACES: MAX_PLACES, MAX_TILES: MAX_TILES, SUGGEST_RADIUS: SUGGEST_RADIUS,
  num: num, validLatLng: validLatLng, distance: distance, bearing: bearing, compassWord: compassWord, fmtDistance: fmtDistance, walkMinutes: walkMinutes, fmtWalk: fmtWalk, directionText: directionText,
  simplify: simplify, lineLength: lineLength, routeFromOsrm: routeFromOsrm, reverseRoute: reverseRoute, progress: progress,
  lngToX: lngToX, latToY: latToY, bbox: bbox, tileRange: tileRange, tilesFor: tilesFor, coverPoints: coverPoints, coverTiles: coverTiles, fillTemplate: fillTemplate,
  overpassQuery: overpassQuery, categoryOfTags: categoryOfTags, mapOverpass: mapOverpass, parseCoords: parseCoords,
  fit: fit, scaleBar: scaleBar, routeCoords: routeCoords, guestPlace: guestPlace, guestPlaces: guestPlaces
};
