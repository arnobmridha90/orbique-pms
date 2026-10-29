/* Nearby places for the guest app (api/_lib/shared/geo.cjs, the same module the page uses as O.geo): distances and
 * directions, route simplification, the map tiles saved for offline use, OpenStreetMap suggestions and pasted coordinates.
 *
 *   node --test tests/places.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import G from '../api/_lib/shared/geo.cjs';

const HOME = { lat: 3.0561, lng: 101.6887 };

test('distance and bearing', () => {
  /* one degree of latitude is about 111.2 km */
  const d = G.distance({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(d - 111195) < 5, String(d));
  assert.equal(Math.round(G.bearing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })), 0);
  assert.equal(Math.round(G.bearing({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })), 90);
  assert.equal(Math.round(G.bearing({ lat: 0, lng: 0 }, { lat: -1, lng: 0 })), 180);
  assert.equal(Math.round(G.bearing({ lat: 0, lng: 0 }, { lat: 0, lng: -1 })), 270);
  assert.equal(G.compassWord(44), 'north-east');
  assert.equal(G.compassWord(359), 'north');
  assert.equal(G.compassWord(-90), 'west');
  assert.equal(G.compassWord(200), 'south');
  assert.equal(G.compassWord(250), 'west');
  /* 300 m north-east of the building */
  const ne = { lat: HOME.lat + 0.0019, lng: HOME.lng + 0.0019 };
  assert.match(G.directionText(HOME, ne), /^Walk north-east, 300 m$/);
  assert.equal(G.directionText(HOME, { lat: HOME.lat + 0.00005, lng: HOME.lng }), 'You are here');
});

test('distance and walking time labels', () => {
  assert.equal(G.fmtDistance(5), 'Here');
  assert.equal(G.fmtDistance(134), '130 m');
  assert.equal(G.fmtDistance(449), '450 m');
  assert.equal(G.fmtDistance(1234), '1.2 km');
  assert.equal(G.fmtDistance(12600), '13 km');
  assert.equal(G.fmtDistance(null), '');
  assert.equal(G.walkMinutes(10), 1);
  assert.equal(G.walkMinutes(480), 6);
  assert.equal(G.fmtWalk(6), '6 min walk');
  assert.equal(G.fmtWalk(70), '1 h 10 min walk');
  assert.equal(G.fmtWalk(120), '2 h walk');
});

test('route simplification keeps the ends and the corners, and caps the points', () => {
  /* a straight street with many points, then a right angle */
  const line = [];
  for (let i = 0; i <= 100; i++) line.push([101.6887 + i * 0.00001, 3.0561]);
  for (let i = 1; i <= 100; i++) line.push([101.6897, 3.0561 + i * 0.00001]);
  const s = G.simplify(line, 3, 400);
  assert.deepEqual(s[0], [101.6887, 3.0561]);
  assert.deepEqual(s[s.length - 1], [101.6897, 3.0571]);
  assert.equal(s.length, 3, JSON.stringify(s));
  assert.deepEqual(s[1], [101.6897, 3.0561]);
  /* a wiggly line of 3000 points comes back at no more than the cap */
  const wig = [];
  for (let i = 0; i < 3000; i++) wig.push([101.68 + i * 0.00002, 3.05 + Math.sin(i / 3) * 0.0003]);
  const w = G.simplify(wig, 1, 400);
  assert.ok(w.length <= 400 && w.length >= 2, String(w.length));
  assert.deepEqual(w[0], [101.68, 3.05]);
  /* bad points are dropped, short lines stay as they are */
  assert.deepEqual(G.simplify([[101.6, 3.1], ['x', 2], null, [101.7, 3.2]], 3), [[101.6, 3.1], [101.7, 3.2]]);
  assert.deepEqual(G.simplify([], 3), []);
  /* line length */
  assert.ok(Math.abs(G.lineLength([[0, 0], [0, 1]]) - 111195) < 5);
});

test('an OSRM walking route becomes a stored route', () => {
  const coords = [];
  for (let i = 0; i <= 50; i++) coords.push([101.6887 + i * 0.00002, 3.0561 + i * 0.00001]);
  const r = G.routeFromOsrm({ code: 'Ok', routes: [{ distance: 123.4, duration: 60, geometry: { type: 'LineString', coordinates: coords } }] });
  assert.equal(r.mode, 'foot');
  assert.equal(r.meters, 123);
  assert.equal(r.minutes, 2); /* at least our own walking pace (123 m / 80 m a minute) */
  assert.equal(r.coords.length, 2);
  assert.equal(G.routeFromOsrm({ code: 'NoRoute', routes: [] }), null);
  assert.equal(G.routeFromOsrm(null), null);
  const back = G.reverseRoute(r);
  assert.deepEqual(back.coords[0], r.coords[r.coords.length - 1]);
  assert.equal(back.meters, r.meters);
});

test('progress along a route: distance left, off the route, the point to walk to', () => {
  /* 400 m east, then 400 m north */
  const east = 400 / (111195 * Math.cos(HOME.lat * Math.PI / 180)), north = 400 / 111195;
  const route = [[HOME.lng, HOME.lat], [HOME.lng + east, HOME.lat], [HOME.lng + east, HOME.lat + north]];
  const start = G.progress(route, HOME);
  assert.ok(start.onRoute);
  assert.ok(Math.abs(start.remaining - 800) < 3, String(start.remaining));
  assert.ok(Math.round(G.bearing(HOME, start.ahead)) === 90);
  const half = G.progress(route, { lat: HOME.lat + 0.00001, lng: HOME.lng + east / 2 });
  assert.ok(Math.abs(half.remaining - 600) < 3, String(half.remaining));
  /* at the corner the arrow points north */
  const corner = G.progress(route, { lat: HOME.lat, lng: HOME.lng + east - 0.000001 });
  assert.ok(Math.round(G.bearing({ lat: HOME.lat, lng: HOME.lng + east }, corner.ahead)) === 0);
  /* 300 m away from the line: off the route, straight distance to the end */
  const off = G.progress(route, { lat: HOME.lat - 0.0027, lng: HOME.lng });
  assert.equal(off.onRoute, false);
  assert.ok(off.off > 250);
  assert.deepEqual(off.ahead, { lat: route[2][1], lng: route[2][0] });
  assert.equal(G.progress([[1, 1]], HOME), null);
});

test('map tiles for a bounding box, lowest zoom first, capped', () => {
  /* the tile of the building at zoom 16 */
  assert.equal(G.lngToX(HOME.lng, 16), 51279); /* checked against the textbook formula with asinh */
  assert.equal(G.latToY(HOME.lat, 16), 32211);
  assert.equal(G.lngToX(-180, 1), 0);
  assert.equal(G.latToY(85, 1), 0);
  const bb = G.bbox([HOME, { lat: 3.0662, lng: 101.6972 }], 300);
  assert.ok(bb[0] < HOME.lng && bb[2] > 101.6972 && bb[1] < HOME.lat && bb[3] > 3.0662);
  const all = G.tilesFor(bb, 12, 16, 1000);
  assert.deepEqual(all.zooms, [12, 13, 14, 15, 16]);
  assert.equal(all.skipped, 0);
  assert.ok(all.tiles.every(([z]) => z >= 12 && z <= 16));
  const r16 = G.tileRange(bb, 16);
  const n16 = (r16.x1 - r16.x0 + 1) * (r16.y1 - r16.y0 + 1);
  assert.equal(all.tiles.filter(([z]) => z === 16).length, n16);
  /* a cap below the full count leaves out whole zoom levels from the top */
  const capped = G.tilesFor(bb, 12, 16, all.tiles.length - 1);
  assert.deepEqual(capped.zooms, [12, 13, 14, 15]);
  assert.equal(capped.skipped, n16);
  assert.ok(capped.tiles.length <= all.tiles.length - 1);
  /* a wide box stops early and never passes the default cap */
  const wide = G.tilesFor(G.bbox([HOME, { lat: 3.3, lng: 101.9 }], 300), 12, 16);
  assert.ok(wide.tiles.length <= G.MAX_TILES, String(wide.tiles.length));
  assert.ok(wide.skipped > 0);
  assert.deepEqual(G.tilesFor(null, 12, 16), { tiles: [], zooms: [], skipped: 0 });
  assert.equal(G.bbox([], 10), null);
  assert.equal(G.fillTemplate('https://t/x/{z}/{x}/{y}.pbf', 14, 12817, 8052), 'https://t/x/14/12817/8052.pbf');
  /* the points to cover: building, places and every route point */
  const pts = G.coverPoints(HOME, [{ lat: 3.06, lng: 101.69, route: { coords: [[101.6887, 3.0561], [101.69, 3.06]] } }, { lat: 'x' }]);
  assert.equal(pts.length, 4);
});

test('OpenStreetMap results become suggestions', () => {
  const near = (dLat, dLng) => ({ lat: HOME.lat + dLat, lon: HOME.lng + dLng });
  const els = [
    { type: 'node', id: 1, ...near(0.002, 0), tags: { amenity: 'hospital', name: 'Jalil Hospital', phone: '+60 3 1234 5678', opening_hours: '24/7' } },
    { type: 'way', id: 2, center: { lat: HOME.lat + 0.001, lon: HOME.lng }, tags: { amenity: 'bureau_de_change', name: 'Kedai Tukaran Wang', 'addr:housenumber': '12', 'addr:street': 'Jalan Jalil', 'addr:city': 'Kuala Lumpur' } },
    { type: 'node', id: 3, ...near(0.0005, 0.0005), tags: { amenity: 'food_court', name: 'Medan Selera' } },
    { type: 'node', id: 4, ...near(0.0006, 0.0005), tags: { amenity: 'restaurant', name: 'Nasi Kandar Corner' } },
    { type: 'node', id: 5, ...near(0.0007, 0), tags: { amenity: 'restaurant', name: 'Restoran Hawker Lane' } },
    { type: 'node', id: 6, ...near(0.0003, 0), tags: { amenity: 'atm', operator: 'Maybank' } },
    { type: 'node', id: 7, ...near(0.0003, 0.0001), tags: { amenity: 'restaurant' } },              /* no name: left out */
    { type: 'node', id: 8, ...near(0.05, 0), tags: { amenity: 'pharmacy', name: 'Too far' } },     /* 5.5 km: left out */
    { type: 'node', id: 9, ...near(0.0008, 0), tags: { railway: 'station', name: 'Bukit Jalil' } },
    { type: 'node', id: 10, ...near(0.0004, 0), tags: { shop: 'convenience', name: '24 Mart' } },
    { type: 'node', id: 11, ...near(0.00041, 0), tags: { shop: 'convenience', name: '24 MART' } }, /* the same shop twice */
    { type: 'node', id: 12, ...near(0.001, 0), tags: { leisure: 'park', name: 'Park' } },            /* not a category */
    { type: 'node', id: 13, ...near(0.0012, 0), tags: { amenity: 'clinic', 'name:en': 'Saujana Clinic', name: 'Klinik Saujana' } },
    { type: 'node', id: 14, ...near(0.0013, 0), tags: { shop: 'laundry', name: 'Dobi Express' } },
    null, { type: 'node', id: 15, tags: { amenity: 'police', name: 'No position' } }
  ];
  const s = G.mapOverpass(els, HOME);
  const by = (name) => s.find((x) => x.name === name);
  assert.equal(by('Jalil Hospital').category, 'hospital');
  assert.equal(by('Jalil Hospital').hours, '24/7');
  assert.equal(by('Jalil Hospital').phone, '+60 3 1234 5678');
  assert.equal(by('Jalil Hospital').osmId, 'node/1');
  assert.equal(by('Kedai Tukaran Wang').category, 'money');
  assert.equal(by('Kedai Tukaran Wang').address, '12 Jalan Jalil, Kuala Lumpur');
  assert.equal(by('Kedai Tukaran Wang').osmId, 'way/2');
  assert.equal(by('Medan Selera').category, 'streetfood');
  assert.equal(by('Nasi Kandar Corner').category, 'food');
  assert.equal(by('Restoran Hawker Lane').category, 'streetfood');
  assert.equal(by('Maybank ATM').category, 'atm');
  assert.equal(by('Bukit Jalil').category, 'transport');
  assert.equal(by('Saujana Clinic').category, 'clinic');
  assert.equal(by('Dobi Express').category, 'laundry');
  assert.equal(s.filter((x) => x.category === 'convenience').length, 1);
  assert.ok(!by('Too far') && !by('Park') && !by('No position'));
  /* nearest first */
  for (let i = 1; i < s.length; i++) assert.ok(s[i - 1].meters <= s[i].meters);
  /* at most perCategory of each */
  const many = [];
  for (let i = 0; i < 20; i++) many.push({ type: 'node', id: 100 + i, ...near(0.0001 * i, 0.0002), tags: { amenity: 'cafe', name: 'Cafe ' + i } });
  assert.equal(G.mapOverpass(many, HOME, { perCategory: 5 }).length, 5);
  assert.deepEqual(G.mapOverpass('nope', HOME), []);
  /* the query asks for every category around the building */
  const q = G.overpassQuery(HOME.lat, HOME.lng, 1500);
  assert.match(q, /^\[out:json\]/);
  assert.match(q, /around:1500,3\.0561,101\.6887/);
  for (const k of ['hospital', 'bureau_de_change', 'atm', 'police', 'food_court', 'marketplace', 'convenience', 'supermarket', 'station']) assert.ok(q.includes(k), k);
});

test('pasted coordinates and map links', () => {
  assert.deepEqual(G.parseCoords('3.0561, 101.6887'), { lat: 3.0561, lng: 101.6887 });
  assert.deepEqual(G.parseCoords(' 3.0561 101.6887 '), { lat: 3.0561, lng: 101.6887 });
  assert.deepEqual(G.parseCoords('https://www.google.com/maps/place/X/@3.0561234,101.6887654,17z'), { lat: 3.056123, lng: 101.688765 });
  assert.deepEqual(G.parseCoords('https://maps.google.com/?q=3.0561,101.6887'), { lat: 3.0561, lng: 101.6887 });
  assert.deepEqual(G.parseCoords('-33.8688, 151.2093'), { lat: -33.8688, lng: 151.2093 });
  assert.equal(G.parseCoords('101.6887, 3.0561'), null); /* latitude above 90 */
  assert.equal(G.parseCoords('0, 0'), null);
  assert.equal(G.parseCoords('Jalan Jalil'), null);
  assert.equal(G.parseCoords(''), null);
});

test('the offline sketch fits every point in the box, north up', () => {
  const pts = [HOME, { lat: 3.0601, lng: 101.6927 }];
  const f = G.fit(pts, 300, 200, 20);
  const a = f(pts[0]), b = f(pts[1]);
  for (const [x, y] of [a, b]) { assert.ok(x >= 19.9 && x <= 280.1, String(x)); assert.ok(y >= 19.9 && y <= 180.1, String(y)); }
  assert.ok(b[0] > a[0] && b[1] < a[1]); /* north-east is right and up */
  assert.ok(f.scale > 0);
  /* one point: centred */
  const one = G.fit([HOME], 300, 200, 20);
  assert.deepEqual(one(HOME), [150, 100]);
  assert.equal(G.scaleBar(0.5, 300), 100);
  assert.equal(G.scaleBar(0.05, 300), 1000);
});

test('places as the guest sees them: one building, staff order, public fields only', () => {
  const list = [
    { id: 'p3', buildingId: 'BD-a', name: 'Zeta Cafe', category: 'cafe', lat: 3.06, lng: 101.69, order: 2 },
    { id: 'p1', buildingId: 'BD-a', name: 'clinic one', category: 'clinic', lat: 3.061, lng: 101.691, order: 1, staffNote: 'owner is a friend', osmId: 'node/5', updatedBy: 's1' },
    { id: 'p2', buildingId: 'BD-a', name: 'Alpha', category: 'nope', lat: '3.05', lng: '101.68', order: 1, route: { coords: [[101.6887, 3.0561], [101.68, 3.05]], meters: 900, minutes: 11, mode: 'foot' } },
    { id: 'p4', buildingId: 'BD-b', name: 'Other building', category: 'food', lat: 3.06, lng: 101.69 },
    { id: 'p5', buildingId: 'BD-a', name: 'No position', category: 'food' },
    { id: 'p6', buildingId: 'BD-a', name: 'Archived', category: 'food', lat: 3.06, lng: 101.69, archived: true },
    { id: 'p7', buildingId: 'BD-a', name: 'Bad route', category: 'food', lat: 3.06, lng: 101.69, order: 3, route: { coords: 'x' } }
  ];
  const g = G.guestPlaces(list, 'BD-a');
  assert.deepEqual(g.map((p) => p.id), ['p2', 'p1', 'p3', 'p7']);
  assert.deepEqual(Object.keys(g[1]).sort(), ['address', 'category', 'hours', 'id', 'lat', 'lng', 'name', 'note', 'phone', 'route']);
  assert.equal(g[0].category, 'other');
  assert.equal(g[0].lat, 3.05);
  assert.deepEqual(g[0].route, { coords: [[101.6887, 3.0561], [101.68, 3.05]], meters: 900, minutes: 11, mode: 'foot' });
  assert.equal(g[3].route, null);
  assert.equal(G.guestPlaces(list, 'BD-c').length, 0);
  assert.equal(G.category('money').label, 'Money exchange');
  assert.equal(G.category('x').id, 'other');
});

test('route points reach guests only as real [lng, lat] number pairs', () => {
  assert.deepEqual(G.routeCoords([[101.6887, 3.0561], null, ['a', 1], [500, 3], [1, 2, 3], { x: 1 }, [NaN, 1], [101.69, 3.06]]), [[101.6887, 3.0561], [101.69, 3.06]]);
  assert.equal(G.routeCoords([[101.6887, 3.0561], [null, null], ['101.69', '3.06']]), null);
  assert.equal(G.routeCoords('x'), null);
  assert.equal(G.routeCoords(new Array(1001).fill([101.69, 3.06])), null);
  const p = G.guestPlace({ id: 'p', lat: 3.06, lng: 101.69, route: { coords: [[101.6887, 3.0561], null, [101.69, 3.06]], meters: 500 } });
  assert.deepEqual(p.route, { coords: [[101.6887, 3.0561], [101.69, 3.06]], meters: 500, minutes: null, mode: 'foot' });
});

test('offline map tiles: the close area at every zoom, then the wider view of far places, within the cap', () => {
  const near = [{ lat: 3.0574, lng: 101.6896 }];
  /* close places only: the same as the padded box */
  const a = G.coverTiles(HOME, near, 12, 14, 250, 400), plain = G.tilesFor(G.bbox(G.coverPoints(HOME, near), 400), 12, 14, 250);
  assert.deepEqual(a.tiles, plain.tiles);
  /* a hospital 4 km south: the phone screen fitted to that walk also shows the sides, and those tiles are saved too */
  const far = near.concat([{ lat: HOME.lat - 0.036, lng: HOME.lng }]);
  const b = G.coverTiles(HOME, far, 12, 14, 250, 400);
  const keys = new Set(b.tiles.map((t) => t.join('/')));
  assert.equal(keys.size, b.tiles.length, 'no tile twice');
  const side = { lat: HOME.lat - 0.018, lng: HOME.lng + deg(0.6 * 4000) };
  for (let z = 12; z <= 14; z++) assert.ok(keys.has(z + '/' + G.lngToX(side.lng, z) + '/' + G.latToY(side.lat, z)), 'side of the walk at z' + z);
  /* every close-area tile is still there, and the cap holds */
  plain.tiles.forEach((t) => assert.ok(keys.has(t.join('/'))));
  const c = G.coverTiles(HOME, far.concat([{ lat: HOME.lat + 0.25, lng: HOME.lng + 0.25 }]), 12, 16, 250, 400);
  assert.ok(c.tiles.length <= 250 && c.skipped > 0);
  assert.equal(c.tiles[0][0], 12);
  assert.deepEqual(G.coverTiles(null, [], 12, 14, 250, 400), { tiles: [], skipped: 0 });
  function deg(m) { return m / (6371008.8 * Math.cos(HOME.lat * Math.PI / 180)) * 180 / Math.PI; }
});
