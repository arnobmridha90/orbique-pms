/* Nearby places in the guest app (owner request 2026-10-29: food, street food, hospitals, money exchange and more near each
   building, with maps that work without internet, to each place and back to the building).
   1. Data: records 'places' (registered in core.js, rules and maths in api/_lib/shared/geo.cjs as O.geo), the building's
      lat / lng. O.nearby.forBooking(b) is the payload's 'nearby' for the local O.guestApi; the database builds the same in
      guest__nearby (supabase/migrations/0021_guest_places.sql).
   2. Offline: the guest's own phone keeps the last payload (localStorage) and saves the building's map (MapLibre files, the
      OpenFreeMap style, sprites, Latin glyphs and the vector tiles around the building and its places, at most 250) in the
      Cache Storage cache 'orbique-maps-<buildingId>', which public/sw.js answers from first. Once per building per 30 days.
   3. The guest screens, drawn by guestapp.js (tab 'nearby', view 'place'): the list by category and a map screen with the
      stored walking route, the guest's live position (GPS works without internet), the distance left and an arrow. When the
      vector map cannot show (offline with no saved map, no MapLibre, an old browser) a drawn sketch of the route takes its
      place, from the payload alone.
   The staff tab "Nearby places" is app/pages/nearby-staff.js. Network calls to map services happen only on the staff side
   (search, suggestions, routes) and, for the guest, the map tiles. */
(function () {
  'use strict';
  var O = window.O, U = O.ui, esc = O.esc, G = O.geo;
  if (!G) return;

  var STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
  var TILE_HOST = 'tiles.openfreemap.org';
  var MAPS_CACHE = 'orbique-maps-';
  var MAPS_EVERY = 30 * 864e5; /* saved maps are refreshed after 30 days */
  var GLYPH_RANGES = ['0-255', '256-511'];
  var ZMIN = 12, ZMAX = 16;

  /* category icons (24 x 24 stroke paths) */
  var CAT_IC = {
    food: '<path d="M4 2v7a3 3 0 0 0 6 0V2M7 2v20M17 2c-2 2-3 5-3 8h3v12"/>',
    streetfood: '<path d="M3 11h18a9 9 0 0 1-18 0zM8 7c0-1 1-1 1-2s-1-1-1-2M12 7c0-1 1-1 1-2s-1-1-1-2M16 7c0-1 1-1 1-2s-1-1-1-2"/>',
    cafe: '<path d="M3 8h14v5a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6zM17 9h2a2 2 0 0 1 0 4h-2M7 2v3M11 2v3"/>',
    hospital: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/>',
    clinic: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    pharmacy: '<path d="M10.5 3.5a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7-7zM7 7l7 7"/>',
    money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/>',
    atm: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    convenience: '<path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
    supermarket: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h11L21 7H6"/>',
    transport: '<rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10h14M9 13h.01M15 13h.01M8 16l-2 5M16 16l2 5"/>',
    police: '<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z"/>',
    laundry: '<rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M8 6h.01M11 6h.01"/>',
    other: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    home: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h4M8 11h4M8 15h4"/>'
  };
  function catIcon(id) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (CAT_IC[id] || CAT_IC.other) + '</svg>'; }
  function catBadge(id, cls) { var c = id === 'home' ? { color: '#0B5D54' } : G.category(id); return '<span class="nb-ic' + (cls ? ' ' + cls : '') + '" style="background:' + esc(c.color) + '">' + catIcon(id) + '</span>'; }
  var ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 19.5 21 12 16.8 4.5 21z" fill="currentColor"/></svg>';

  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } return null; }

  /* =================================================================
     1. DATA
     ================================================================= */
  /* the building a booking stays in: the unit type's building, else the unit's (O.buildingOf); null for a unit outside buildings */
  function buildingFor(b) { return b ? O.buildingOf(b) : null; }
  function homeOf(bd) {
    var ok = G.validLatLng(bd.lat, bd.lng);
    return { id: String(bd.id), name: typeof bd.name === 'string' ? bd.name : '', address: typeof bd.address === 'string' ? bd.address : '', lat: ok ? G.num(bd.lat) : null, lng: ok ? G.num(bd.lng) : null };
  }
  /* the payload's 'nearby' (the same in guest__nearby): {building: {id, name, address, lat, lng}, places: [...]}, or null */
  function forBuilding(bd) { return bd ? { building: homeOf(bd), places: G.guestPlaces(O.raw('places') || [], bd.id) } : null; }
  function forBooking(b) { return forBuilding(buildingFor(b)); }
  function available(p) { var n = p && p.nearby; return !!(n && n.building && (n.places && n.places.length || G.validLatLng(n.building.lat, n.building.lng))); }
  function hasHome(n) { return !!(n && n.building && G.validLatLng(n.building.lat, n.building.lng)); }
  function placeById(n, id) { return (n && n.places || []).filter(function (x) { return x.id === id; })[0] || null; }
  function homePt(n) { return hasHome(n) ? { lat: n.building.lat, lng: n.building.lng } : null; }
  /* metres and minutes from the building: the walking route when there is one, else the straight line */
  function legOf(n, pl) {
    if (pl.route && pl.route.meters) return { meters: pl.route.meters, minutes: pl.route.minutes || G.walkMinutes(pl.route.meters), route: true };
    var h = homePt(n); if (!h) return null;
    var m = G.distance(h, pl); return { meters: m, minutes: G.walkMinutes(m * 1.3), route: false };
  }

  /* =================================================================
     2. OFFLINE: the last payload and the saved map
     ================================================================= */
  function payloadKey(token) { return 'orbique-guest:' + token; }
  /* the guest's own phone keeps the last payload, so the app (and Nearby) opens without internet */
  function remember(token, p) {
    if (!p || !p.ok) return;
    store(payloadKey(token), { at: Date.now(), p: p });
  }
  function recall(token) {
    var s = store(payloadKey(token));
    if (!s || !s.p || !s.p.ok || !s.p.booking) return null;
    /* the link stops working 30 days after check-out; the saved copy goes with it */
    var end = Date.parse(String(s.p.booking.checkOut) + 'T00:00:00Z') + 31 * 864e5;
    if (!(end > Date.now())) { store(payloadKey(token), null); return null; }
    return s;
  }
  function mapsKey(bid) { return 'orbique-maps:' + bid; }
  function bboxSig(n) { var bb = G.bbox(G.coverPoints(n.building, n.places), 0); return bb ? bb.map(function (x) { return x.toFixed(3); }).join(',') : ''; }
  var SAVE = { busy: {}, done: {}, total: {}, err: {} };
  function cachesOk() { return typeof window.caches !== 'undefined' && !!window.caches.open && typeof fetch === 'function'; }
  /* 'saved' | 'saving' | 'none' | 'old' (places moved since) | 'unsupported' */
  function mapsState(n) {
    if (!n || !hasHome(n)) return 'unsupported';
    var bid = n.building.id;
    if (SAVE.busy[bid]) return 'saving';
    if (!cachesOk() || !vendorBase()) return 'unsupported';
    var m = store(mapsKey(bid));
    if (!m || !m.ok) return 'none';
    if (m.sig !== bboxSig(n) || Date.now() - m.at > MAPS_EVERY) return 'old';
    return 'saved';
  }
  function fetchOk(url, opts) { return fetch(url, opts || {}).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url); return r; }); }
  /* run fns (each returning a promise) a few at a time; failures count but do not stop the rest */
  function pool(fns, size, onEach) {
    var i = 0, ok = 0, bad = 0;
    return new Promise(function (resolve) {
      var running = 0;
      function next() {
        if (i >= fns.length && !running) return resolve({ ok: ok, bad: bad });
        while (running < size && i < fns.length) {
          var fn = fns[i++]; running++;
          Promise.resolve().then(fn).then(function () { ok++; }, function () { bad++; }).then(function () { running--; if (onEach) onEach(ok + bad); next(); });
        }
      }
      next();
    });
  }
  function fontsOf(style) {
    var seen = {};
    (style.layers || []).forEach(function (l) {
      var f = l && l.layout && l.layout['text-font'];
      if (Array.isArray(f) && f.every(function (x) { return typeof x === 'string'; })) seen[f.join(',')] = 1;
      else if (Array.isArray(f)) JSON.stringify(f).replace(/"([^"]*(?:Regular|Bold|Italic|Medium|Semibold|Light)[^"]*)"/g, function (m, name) { seen[name] = 1; return m; });
    });
    var list = Object.keys(seen);
    return list.length ? list : ['Noto Sans Regular'];
  }
  function spriteUrls(sprite) {
    var list = typeof sprite === 'string' ? [sprite] : Array.isArray(sprite) ? sprite.map(function (s) { return s && s.url; }).filter(Boolean) : [];
    var out = [];
    list.forEach(function (u) { ['.json', '.png', '@2x.json', '@2x.png'].forEach(function (x) { out.push(u + x); }); });
    return out;
  }
  /* save the building's map for offline use on this phone. onProgress(done, total). -> Promise({ok, tiles, skipped}) */
  function saveMaps(n, onProgress, force) {
    if (!n || !hasHome(n)) return Promise.resolve({ ok: false, why: 'nolocation' });
    var bid = n.building.id, st = mapsState(n);
    if (st === 'unsupported') return Promise.resolve({ ok: false, why: 'unsupported' });
    if (SAVE.busy[bid]) return SAVE.busy[bid];
    if (st === 'saved' && !force) return Promise.resolve({ ok: true, cached: true });
    if (navigator.onLine === false) return Promise.resolve({ ok: false, why: 'offline' });
    var name = MAPS_CACHE + String(bid).replace(/[^A-Za-z0-9_-]/g, '_'), cache, urls = [], vb = vendorBase();
    SAVE.done[bid] = 0; SAVE.total[bid] = 0; SAVE.err[bid] = null;
    var bb = G.bbox(G.coverPoints(n.building, n.places), 400), tiles = { tiles: [], skipped: 0 };
    var job = caches.delete(name).then(function () { return caches.open(name); }).then(function (c) {
      cache = c;
      urls.push(vb + 'maplibre-gl.js', vb + 'maplibre-gl.css');
      return fetchOk(STYLE_URL).then(function (r) { cache.put(STYLE_URL, r.clone()); return r.json(); });
    }).then(function (style) {
      urls = urls.concat(spriteUrls(style.sprite));
      if (typeof style.glyphs === 'string') fontsOf(style).forEach(function (f) { GLYPH_RANGES.forEach(function (rg) { urls.push(style.glyphs.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', rg)); }); });
      /* vector sources: their TileJSON, then the tiles over the building, its places and their routes */
      var srcs = Object.keys(style.sources || {}).map(function (k) { return style.sources[k]; }).filter(function (s) { return s && s.type === 'vector'; });
      return Promise.all(srcs.map(function (s) {
        if (Array.isArray(s.tiles)) return { tiles: s.tiles, maxzoom: s.maxzoom };
        if (!s.url) return null;
        return fetchOk(s.url).then(function (r) { cache.put(s.url, r.clone()); return r.json(); }).catch(function () { return null; });
      })).then(function (tjs) {
        tjs.forEach(function (tj) {
          if (!tj || !Array.isArray(tj.tiles) || !tj.tiles.length) return;
          var top = Math.min(ZMAX, typeof tj.maxzoom === 'number' ? tj.maxzoom : ZMAX), t = G.tilesFor(bb, ZMIN, Math.max(ZMIN, top), G.MAX_TILES);
          tiles.tiles = tiles.tiles.concat(t.tiles); tiles.skipped += t.skipped;
          t.tiles.forEach(function (z) { urls.push(G.fillTemplate(tj.tiles[0], z[0], z[1], z[2])); });
        });
        if (tiles.skipped) console.info('Nearby maps: ' + tiles.skipped + ' map tiles left out to stay under ' + G.MAX_TILES + '.');
      });
    }).then(function () {
      SAVE.total[bid] = urls.length;
      if (onProgress) onProgress(0, urls.length);
      return pool(urls.map(function (u) { return function () { return fetchOk(u).then(function (r) { return cache.put(u, r); }); }; }), 4, function (k) { SAVE.done[bid] = k; if (onProgress) onProgress(k, urls.length); });
    }).then(function (res) {
      /* most of the map is enough: a few missing labels or tiles at the edge do not stop it working */
      var ok = res.ok > 0 && res.bad <= Math.max(3, Math.round(urls.length * 0.1));
      store(mapsKey(bid), { at: Date.now(), ok: ok, sig: bboxSig(n), tiles: tiles.tiles.length, skipped: tiles.skipped, missed: res.bad });
      delete SAVE.busy[bid];
      return { ok: ok, tiles: tiles.tiles.length, skipped: tiles.skipped, missed: res.bad };
    }, function (e) {
      console.warn('Nearby maps could not be saved', e);
      delete SAVE.busy[bid]; SAVE.err[bid] = String(e && e.message || e);
      return { ok: false, why: 'network' };
    });
    SAVE.busy[bid] = job;
    return job;
  }
  /* once per building per 30 days, on the guest's own phone, when the app opens online */
  var autoTried = {};
  function autoSave(p) {
    var n = p && p.nearby;
    if (!n || !hasHome(n) || autoTried[n.building.id]) return;
    var st = mapsState(n);
    if (st !== 'none' && st !== 'old') return;
    autoTried[n.building.id] = true;
    saveMaps(n, progressPaint).then(progressPaint);
  }

  /* MapLibre GL JS from /vendor (production build) or vendor/ (phone app); not in the single-file local copy */
  function vendorBase() {
    var cfg = window.ORBIQUE_CONFIG;
    if (!cfg) return '';
    return cfg.native ? 'vendor/' : '/vendor/';
  }
  var libP = null;
  function loadLib() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (libP) return libP;
    var base = vendorBase();
    if (!base) return Promise.reject(new Error('The map library is not in this copy of the app'));
    libP = new Promise(function (resolve, reject) {
      if (!document.querySelector('link[data-maplibre]')) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = base + 'maplibre-gl.css'; l.setAttribute('data-maplibre', '1'); document.head.appendChild(l); }
      var s = document.createElement('script'); s.src = base + 'maplibre-gl.js'; s.async = true;
      s.onload = function () { if (window.maplibregl) resolve(window.maplibregl); else reject(new Error('The map library did not start')); };
      s.onerror = function () { reject(new Error('The map library could not load')); };
      document.head.appendChild(s);
    });
    libP.catch(function () { libP = null; });
    return libP;
  }
  /* can the full map work here? WebGL and either a connection or a saved map */
  function webgl() { try { var c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; } }
  function vectorPossible(n) { return !!vendorBase() && webgl() && (navigator.onLine !== false || mapsState(n) === 'saved' || mapsState(n) === 'old'); }

  /* =================================================================
     3. GUEST SCREENS (drawn by guestapp.js)
     ================================================================= */
  var CUR = { root: null, p: null, st: null, opts: null };
  function saveLineHTML(n, preview) {
    if (preview) return '<div class="gx-nb-save info">' + O.icon('download') + '<span>Guests can save these maps on their phone and use them without internet.</span></div>';
    var st = mapsState(n), bid = n.building.id;
    if (st === 'unsupported') return hasHome(n) ? '<div class="gx-nb-save info">' + O.icon('map') + '<span>Without internet you still get the walking line and the direction from your location.</span></div>' : '';
    if (st === 'saving') { var t = SAVE.total[bid] || 0, k = SAVE.done[bid] || 0; return '<div class="gx-nb-save wait" data-nb-save>' + O.icon('download') + '<span>Saving maps for offline use' + (t ? ' (' + Math.round(k / t * 100) + '%)' : '') + '...</span></div>'; }
    if (st === 'saved') return '<div class="gx-nb-save ok" data-nb-save>' + O.icon('check') + '<span>Maps saved for offline use</span></div>';
    return '<div class="gx-nb-save" data-nb-save>' + O.icon('download') + '<span>' + (SAVE.err[bid] ? 'The maps could not be saved. Try again on Wi-Fi.' : st === 'old' ? 'The saved maps are out of date.' : 'Save the maps now to use them without internet.') + '</span><button type="button" class="btn btn-ghost btn-sm" data-nb-act="savemaps">Save maps for offline</button></div>';
  }
  function progressPaint() {
    var r = CUR.root, el = r && O.$('[data-nb-save]', r), n = CUR.p && CUR.p.nearby;
    if (!el || !n) return;
    var tmp = document.createElement('div'); tmp.innerHTML = saveLineHTML(n, CUR.opts && CUR.opts.preview);
    if (tmp.firstChild) el.parentNode.replaceChild(tmp.firstChild, el);
  }
  function metaLine(n, pl) {
    var leg = legOf(n, pl), bits = [];
    if (leg) bits.push(G.fmtDistance(leg.meters), G.fmtWalk(leg.minutes));
    if (pl.hours) bits.push(pl.hours);
    return bits.join(' · ');
  }
  /* the Nearby list */
  function listHTML(p, S, opts) {
    var n = p.nearby, bd = n.building, places = n.places || [], cat = S.nbCat || 'all';
    var cats = G.CATEGORIES.filter(function (c) { return places.some(function (x) { return x.category === c.id; }); });
    if (cat !== 'all' && !cats.some(function (c) { return c.id === cat; })) cat = 'all';
    var out = '<h1 class="gx-h1">Nearby</h1><p class="gx-p">' + (places.length ? 'Places our team likes around ' + esc(bd.name || 'your building') + ', with walking directions.' : 'Walking directions back to ' + esc(bd.name || 'your building') + ' from wherever you are.') + '</p>' + saveLineHTML(n, opts && opts.preview);
    if (hasHome(n)) out += '<button type="button" class="gx-nb-home" data-gx-view="place" data-gx-place="home">' + catBadge('home') + '<span class="gx-grow"><b>Back to ' + esc(bd.name || 'your building') + '</b><span>' + esc(bd.address || 'Directions from where you are') + '</span></span>' + O.icon('right') + '</button>';
    if (cats.length > 1) out += '<div class="gx-chips">' + [{ id: 'all', label: 'All' }].concat(cats).map(function (c) { return '<button type="button" class="chip' + (cat === c.id ? ' on' : '') + '" data-nb-cat="' + esc(c.id) + '">' + esc(c.label) + '</button>'; }).join('') + '</div>';
    if (!places.length) return out;
    var groups = G.CATEGORIES.filter(function (c) { return cat === 'all' ? cats.indexOf(c) >= 0 : c.id === cat; });
    return out + '<div class="gx-nb-groups">' + groups.map(function (c) {
      var list = places.filter(function (x) { return x.category === c.id; });
      return '<section class="gx-card gx-nb-grp"><h2>' + esc(c.label) + '</h2>' + list.map(function (pl) {
        return '<button type="button" class="gx-nb-row" data-gx-view="place" data-gx-place="' + esc(pl.id) + '">' + catBadge(pl.category) + '<span class="gx-grow"><b>' + esc(pl.name) + '</b>' + (pl.note ? '<span>' + esc(pl.note) + '</span>' : '') + '<span class="gx-nb-meta">' + esc(metaLine(n, pl)) + '</span></span>' + O.icon('right') + '</button>';
      }).join('') + '</section>';
    }).join('') + '</div>';
  }
  /* the target and the line for the map screen */
  function legFor(n, id, dir) {
    var home = homePt(n), bd = n.building;
    if (id === 'home' || !id) return { target: home, targetName: bd.name || 'your building', targetCat: 'home', from: null, fromName: '', coords: null, meters: null, minutes: null, toHome: true };
    var pl = placeById(n, id); if (!pl) return null;
    var r = pl.route && Array.isArray(pl.route.coords) && pl.route.coords.length >= 2 ? pl.route : null;
    if (dir === 'back') return { target: home, targetName: bd.name || 'your building', targetCat: 'home', from: { lat: pl.lat, lng: pl.lng }, fromName: pl.name, fromCat: pl.category, coords: r ? r.coords.slice().reverse() : null, meters: r ? r.meters : null, minutes: r ? r.minutes : null, place: pl, toHome: true };
    return { target: { lat: pl.lat, lng: pl.lng }, targetName: pl.name, targetCat: pl.category, from: home, fromName: bd.name || 'your building', fromCat: 'home', coords: r ? r.coords : null, meters: r ? r.meters : null, minutes: r ? r.minutes : null, place: pl, toHome: false };
  }
  function gmapsLink(t) { return 'https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=' + encodeURIComponent(t.lat + ',' + t.lng); }
  function placeHTML(p, S, opts) {
    var n = p.nearby, id = S.nbId || 'home', pl = id === 'home' ? null : placeById(n, id);
    if (id !== 'home' && !pl) return '<section class="gx-card"><h1 class="gx-h1">Place not found</h1><p class="gx-p">This place was removed. Go back to see the others.</p></section>';
    if (id === 'home' && !hasHome(n)) return '<section class="gx-card"><h1 class="gx-h1">No map yet</h1><p class="gx-p">Your host has not set the building location yet. Message us and we will help you find your way.</p></section>';
    var dir = pl && S.nbDir === 'back' && hasHome(n) ? 'back' : 'to', bd = n.building, c = pl ? G.category(pl.category) : null;
    var head = pl ? '<div class="gx-nb-head">' + catBadge(pl.category, 'lg') + '<div class="gx-grow"><h1 class="gx-h1">' + esc(pl.name) + '</h1><span class="gx-k2">' + esc([c.label, pl.hours].filter(Boolean).join(' · ')) + '</span></div></div>' +
        (pl.note ? '<p class="gx-p">' + esc(pl.note) + '</p>' : '') +
        (pl.address || pl.phone ? '<div class="gx-nb-facts">' + (pl.address ? '<span>' + O.icon('pin') + esc(pl.address) + '</span>' : '') + (pl.phone ? '<a href="tel:' + esc(String(pl.phone).replace(/[^\d+]/g, '')) + '">' + O.icon('phone') + esc(pl.phone) + '</a>' : '') + '</div>' : '')
      : '<div class="gx-nb-head">' + catBadge('home', 'lg') + '<div class="gx-grow"><h1 class="gx-h1">Back to ' + esc(bd.name || 'your building') + '</h1><span class="gx-k2">' + esc(bd.address || '') + '</span></div></div>';
    var seg = pl && hasHome(n) ? '<div class="gx-seg two gx-nb-dir" role="radiogroup" aria-label="Direction"><button type="button" role="radio" aria-checked="' + (dir === 'to') + '" data-nb-dir="to" class="' + (dir === 'to' ? 'on' : '') + '">To ' + esc(pl.name) + '</button><button type="button" role="radio" aria-checked="' + (dir === 'back') + '" data-nb-dir="back" class="' + (dir === 'back' ? 'on' : '') + '">Back to ' + esc(bd.name || 'the building') + '</button></div>' : '';
    var leg = legFor(n, id, dir);
    return '<section class="gx-card gx-nb-view" data-nb-view>' + head + seg +
      '<div class="gx-nb-guide" aria-live="polite"><span class="gx-nb-arrow" data-nb-arrow>' + ARROW + '</span><div class="gx-grow"><b data-nb-dist></b><span data-nb-hint></span></div></div>' +
      '<div class="gx-nb-map" data-nb-map role="img" aria-label="Map from ' + esc(leg.fromName || 'your location') + ' to ' + esc(leg.targetName) + '"></div>' +
      '<div class="gx-nb-tools"><button type="button" class="btn btn-ghost btn-sm" data-nb-act="compass" hidden>' + O.icon('refresh') + 'Use compass</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-nb-act="mode" hidden></button>' +
        '<a class="btn btn-ghost btn-sm" data-nb-online href="' + esc(gmapsLink(leg.target)) + '" target="_blank" rel="noopener">' + O.icon('map') + 'Open in Google Maps</a></div>' +
      '<p class="gx-p gx-fine" data-nb-gps>' + (opts && opts.preview ? 'In the guest\'s own app this shows their live position too.' : 'Finding where you are...') + '</p></section>';
  }

  /* ---------- the map screen controller ---------- */
  var CTL = null;
  function stop() {
    if (!CTL) return;
    var c = CTL; CTL = null;
    if (c.watch != null && navigator.geolocation) try { navigator.geolocation.clearWatch(c.watch); } catch (e) { /* ignore */ }
    if (c.onOrient) { window.removeEventListener('deviceorientationabsolute', c.onOrient, true); window.removeEventListener('deviceorientation', c.onOrient, true); }
    if (c.map) try { c.map.remove(); } catch (e) { /* ignore */ }
    clearTimeout(c.failT);
  }
  function startMap(el, n, S, opts) {
    var dir = S.nbDir === 'back' ? 'back' : 'to', leg = legFor(n, S.nbId || 'home', dir);
    if (!leg || !leg.target) return;
    var c = CTL = { el: el, n: n, leg: leg, pos: null, acc: null, heading: null, watch: null, map: null, mode: null, markers: {}, preview: !!(opts && opts.preview) };
    var box = O.$('[data-nb-map]', el);
    c.mode = S.nbMode === 'sketch' || !vectorPossible(n) ? 'sketch' : 'vector';
    drawMap(c, box, S);
    guide(c);
    /* live position: GPS works without internet */
    if (!c.preview && navigator.geolocation && navigator.geolocation.watchPosition) {
      try {
        c.watch = navigator.geolocation.watchPosition(function (pos) {
          if (CTL !== c) return;
          c.pos = { lat: pos.coords.latitude, lng: pos.coords.longitude }; c.acc = pos.coords.accuracy; c.gpsErr = null;
          if (pos.coords.heading != null && !isNaN(pos.coords.heading) && pos.coords.speed > 0.6 && c.heading == null) c.course = pos.coords.heading;
          guide(c); moveMe(c);
        }, function (err) { if (CTL !== c) return; c.gpsErr = err && err.code === 1 ? 'denied' : 'unavailable'; guide(c); }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
      } catch (e) { c.gpsErr = 'unavailable'; }
    } else if (!c.preview) c.gpsErr = 'unsupported';
    /* compass: Android gives it straight away; iOS asks first (the button) */
    var DOE = window.DeviceOrientationEvent;
    if (!c.preview && DOE) {
      c.onOrient = function (e) {
        var h = typeof e.webkitCompassHeading === 'number' ? e.webkitCompassHeading : (e.absolute && typeof e.alpha === 'number' ? 360 - e.alpha : null);
        if (h == null || isNaN(h) || CTL !== c) return;
        c.heading = (h + 360) % 360; guide(c);
      };
      if (typeof DOE.requestPermission === 'function') { var cb = O.$('[data-nb-act=compass]', el); if (cb) cb.hidden = false; }
      else { window.addEventListener('deviceorientationabsolute', c.onOrient, true); window.addEventListener('deviceorientation', c.onOrient, true); }
    }
    modeButton(c);
  }
  function modeButton(c) {
    var b = O.$('[data-nb-act=mode]', c.el); if (!b) return;
    var canVector = vectorPossible(c.n);
    b.hidden = !(c.mode === 'vector' || canVector);
    b.innerHTML = c.mode === 'vector' ? O.icon('file') + 'Simple map' : O.icon('map') + 'Full map';
    var g = O.$('[data-nb-online]', c.el); if (g) g.hidden = navigator.onLine === false;
  }
  /* the arrow, the distance and the hint */
  function guide(c) {
    var el = c.el, leg = c.leg, dist = O.$('[data-nb-dist]', el), hint = O.$('[data-nb-hint]', el), arrow = O.$('[data-nb-arrow]', el), gps = O.$('[data-nb-gps]', el);
    if (!dist) return;
    var aim, remaining, b, text, from = c.pos || leg.from;
    if (c.pos) {
      var prog = leg.coords ? G.progress(leg.coords, c.pos) : null;
      remaining = prog ? prog.remaining : G.distance(c.pos, leg.target);
      aim = prog && prog.onRoute ? prog.ahead : leg.target;
      b = G.bearing(c.pos, aim);
      if (remaining < 25) { dist.textContent = 'You are there'; text = leg.toHome ? 'Welcome back.' : 'Look around for ' + leg.targetName + '.'; }
      else {
        dist.textContent = G.fmtDistance(remaining) + ' to go';
        text = (prog && prog.onRoute ? 'Follow the line, heading ' : 'Walk ') + G.compassWord(b) + (prog && !prog.onRoute ? '. You are away from the line, so the arrow points straight there.' : '.');
      }
    } else if (from) {
      remaining = leg.meters || G.distance(from, leg.target);
      b = G.bearing(from, leg.coords ? { lat: leg.coords[Math.min(1, leg.coords.length - 1)][1], lng: leg.coords[Math.min(1, leg.coords.length - 1)][0] } : leg.target);
      dist.textContent = G.fmtDistance(remaining) + ' · ' + G.fmtWalk(leg.minutes || G.walkMinutes(remaining * (leg.coords ? 1 : 1.3)));
      text = 'From ' + leg.fromName + ': walk ' + G.compassWord(G.bearing(from, leg.target)) + (leg.coords ? ' along the line.' : ' in a straight line, ' + G.fmtDistance(G.distance(from, leg.target)) + '.');
    } else {
      dist.textContent = leg.targetName;
      text = 'Allow location to see the way from where you are.';
    }
    hint.textContent = text;
    if (arrow) {
      var rot = b == null ? 0 : c.heading != null ? b - c.heading : b;
      arrow.style.transform = 'rotate(' + Math.round(rot) + 'deg)';
      arrow.classList.toggle('dim', b == null);
      arrow.title = c.heading != null ? 'Points the way to go' : 'Points the way to go, with north at the top';
    }
    if (gps && !c.preview) {
      gps.textContent = c.gpsErr === 'denied' ? 'Location is off. Allow location for this site in your browser settings to see where you are.'
        : c.gpsErr === 'unsupported' ? 'This browser cannot share your location. Follow the line from ' + (leg.fromName || 'the start') + '.'
          : c.gpsErr && !c.pos ? 'Your location is not found yet. Step outside for a clearer GPS signal.'
            : c.pos ? 'Your location' + (c.acc ? ', accurate to about ' + (c.acc < 1000 ? Math.max(5, Math.round(c.acc / 5) * 5) + ' m' : G.fmtDistance(c.acc)) : '') + '.' + (c.heading != null ? ' The arrow follows your compass.' : ' North is at the top.')
              : 'Finding where you are...';
    }
  }

  /* ---------- the drawn sketch (works with nothing but the payload) ---------- */
  var SW = 360, SH = 300;
  function sketchSVG(c) {
    var leg = c.leg, pts = [], coords = leg.coords;
    if (coords) coords.forEach(function (q) { pts.push({ lat: q[1], lng: q[0] }); });
    if (leg.from) pts.push(leg.from);
    pts.push(leg.target);
    if (c.pos && G.distance(c.pos, leg.target) < 8000) pts.push(c.pos);
    var f = G.fit(pts, SW, SH, 34), line = function (list) { return list.map(function (p) { var xy = f(p); return xy[0] + ',' + xy[1]; }).join(' '); };
    var s = '<svg class="gx-nb-sketch" viewBox="0 0 ' + SW + ' ' + SH + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">';
    s += '<rect width="' + SW + '" height="' + SH + '" class="sk-bg"/>';
    for (var gx = 30; gx < SW; gx += 60) s += '<path d="M' + gx + ' 0V' + SH + '" class="sk-grid"/>';
    for (var gy = 30; gy < SH; gy += 60) s += '<path d="M0 ' + gy + 'H' + SW + '" class="sk-grid"/>';
    if (coords) { var pl = line(coords.map(function (q) { return { lat: q[1], lng: q[0] }; })); s += '<polyline points="' + pl + '" class="sk-casing"/><polyline points="' + pl + '" class="sk-route"/>'; }
    else if (leg.from) s += '<polyline points="' + line([leg.from, leg.target]) + '" class="sk-straight"/>';
    if (c.pos) s += '<polyline points="' + line([c.pos, leg.target]) + '" class="sk-me-line"/>';
    var pin = function (p, cat, label) {
      var xy = f(p), col = cat === 'home' ? '#0B5D54' : G.category(cat).color;
      return '<g transform="translate(' + xy[0] + ' ' + xy[1] + ')"><path d="M0 0c-6-8-10-12-10-17a10 10 0 0 1 20 0c0 5-4 9-10 17z" fill="' + col + '" stroke="#fff" stroke-width="2"/><circle cy="-17" r="3.5" fill="#fff"/>' +
        '<text y="12" text-anchor="middle" class="sk-label">' + esc(String(label || '').slice(0, 28)) + '</text></g>';
    };
    if (leg.from) s += pin(leg.from, leg.fromCat || 'home', leg.fromName);
    s += pin(leg.target, leg.targetCat, leg.targetName);
    if (c.pos) {
      var me = f(c.pos), r = Math.max(6, Math.min(60, (c.acc || 0) * f.scale));
      s += '<circle cx="' + me[0] + '" cy="' + me[1] + '" r="' + r.toFixed(1) + '" class="sk-acc"/><circle cx="' + me[0] + '" cy="' + me[1] + '" r="7" class="sk-me"/>';
    }
    var bar = G.scaleBar(f.scale, SW), barPx = Math.round(bar * f.scale);
    s += '<g transform="translate(12 ' + (SH - 14) + ')"><path d="M0 -4V0H' + barPx + 'V-4" class="sk-bar"/><text x="' + (barPx + 6) + '" y="0" class="sk-small">' + G.fmtDistance(bar).replace('Here', bar + ' m') + '</text></g>';
    s += '<g transform="translate(' + (SW - 22) + ' 24)"><path d="M0 -14 6 4 0 0-6 4z" class="sk-north"/><text y="16" text-anchor="middle" class="sk-small">N</text></g>';
    return s + '</svg>';
  }
  function drawSketch(c, box) {
    box.classList.add('sketch'); box.classList.remove('vector');
    box.innerHTML = sketchSVG(c) + '<div class="gx-nb-note">' + (c.leg.coords ? 'Simple map from the saved route. Streets are not drawn: follow the line and the arrow.' : 'Simple map: the straight line and the direction. Streets are not drawn.') + (c.leg.coords ? ' Route data © OpenStreetMap contributors.' : '') + '</div>';
  }

  /* ---------- the full map (MapLibre with OpenFreeMap tiles) ---------- */
  function pinEl(cat, title, me) {
    var d = document.createElement('div');
    if (me) { d.className = 'nb-me-dot'; d.title = 'You'; return d; }
    d.className = 'nb-pin'; d.title = title || '';
    d.innerHTML = catBadge(cat === 'home' ? 'home' : cat);
    return d;
  }
  function drawVector(c, box, S) {
    box.classList.add('vector'); box.classList.remove('sketch');
    box.innerHTML = '<div class="gx-nb-loading"><div class="spinner" role="status" aria-label="Loading the map"></div></div>';
    var leg = c.leg, fail = function (why) {
      if (CTL !== c || c.mode !== 'vector') return;
      console.info('Nearby: the full map is not available (' + why + '), showing the simple map.');
      if (c.map) { try { c.map.remove(); } catch (e) { /* ignore */ } c.map = null; }
      c.mode = 'sketch'; drawSketch(c, box); modeButton(c);
    };
    c.failT = setTimeout(function () { if (!c.loaded) fail('timeout'); }, 12000);
    loadLib().then(function (ml) {
      if (CTL !== c || c.mode !== 'vector') return;
      var pts = [leg.target]; if (leg.from) pts.push(leg.from); if (leg.coords) leg.coords.forEach(function (q) { pts.push({ lat: q[1], lng: q[0] }); });
      var bb = G.bbox(pts, 80);
      box.innerHTML = '';
      var map;
      try {
        map = c.map = new ml.Map({ container: box, style: STYLE_URL, bounds: [[bb[0], bb[1]], [bb[2], bb[3]]], fitBoundsOptions: { padding: 36, maxZoom: 17 }, attributionControl: { compact: false }, dragRotate: false, pitchWithRotate: false });
      } catch (e) { return fail(e && e.message || 'no WebGL'); }
      map.touchZoomRotate && map.touchZoomRotate.disableRotation && map.touchZoomRotate.disableRotation();
      map.on('error', function (e) { if (!c.loaded) fail(e && e.error && e.error.message || 'style'); });
      map.on('load', function () {
        if (CTL !== c) return;
        c.loaded = true; clearTimeout(c.failT);
        var line = leg.coords || (leg.from ? [[leg.from.lng, leg.from.lat], [leg.target.lng, leg.target.lat]] : null);
        if (line) {
          map.addSource('nb-route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } } });
          map.addLayer({ id: 'nb-route-casing', type: 'line', source: 'nb-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': 9 } });
          map.addLayer({ id: 'nb-route', type: 'line', source: 'nb-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1D4ED8', 'line-width': 5, 'line-dasharray': leg.coords ? [1, 0] : [2, 1.5] } });
        }
        if (leg.from) c.markers.from = new ml.Marker({ element: pinEl(leg.fromCat || 'home', leg.fromName), anchor: 'bottom' }).setLngLat([leg.from.lng, leg.from.lat]).addTo(map);
        c.markers.to = new ml.Marker({ element: pinEl(leg.targetCat, leg.targetName), anchor: 'bottom' }).setLngLat([leg.target.lng, leg.target.lat]).addTo(map);
        moveMe(c);
      });
    }, function (e) { fail(e && e.message || 'library'); });
  }
  function moveMe(c) {
    if (!c.pos) return;
    if (c.mode === 'sketch') {
      var now = Date.now(); if (c.lastSketch && now - c.lastSketch < 1000) return; c.lastSketch = now;
      var box = O.$('[data-nb-map]', c.el); if (box) { var svg = O.$('svg', box); if (svg) svg.outerHTML = sketchSVG(c); }
      return;
    }
    if (!c.map || !c.loaded || !window.maplibregl) return;
    if (!c.markers.me) c.markers.me = new window.maplibregl.Marker({ element: pinEl(null, 'You', true) }).setLngLat([c.pos.lng, c.pos.lat]).addTo(c.map);
    else c.markers.me.setLngLat([c.pos.lng, c.pos.lat]);
  }
  function drawMap(c, box, S) { if (c.mode === 'vector') drawVector(c, box, S); else drawSketch(c, box); }

  /* after every paint of the guest app: start the map screen, or stop it when it is gone */
  function after(root, S, p, opts) {
    CUR.root = root; CUR.p = p; CUR.st = S; CUR.opts = opts || {};
    if (!root._nbBound) { root._nbBound = true; root.addEventListener('click', onClick); }
    var view = O.$('[data-nb-view]', root);
    if (!view || !p || !p.nearby) { stop(); return; }
    if (CTL && CTL.el === view) return;
    stop();
    startMap(view, p.nearby, S, opts);
  }
  function onClick(e) {
    var t = e.target.closest('[data-nb-act],[data-nb-dir],[data-nb-cat]'); if (!t || !CUR.root || !CUR.root.contains(t)) return;
    var ds = t.dataset, S = CUR.st, p = CUR.p;
    if (!S || !p || !p.nearby) return;
    if (ds.nbCat) { S.nbCat = ds.nbCat; if (CUR.opts && CUR.opts.repaint) CUR.opts.repaint(); return; }
    if (ds.nbDir) {
      if (S.nbDir === ds.nbDir) return;
      S.nbDir = ds.nbDir;
      var v = O.$('[data-nb-view]', CUR.root); if (!v) return;
      stop();
      var tmp = document.createElement('div'); tmp.innerHTML = placeHTML(p, S, CUR.opts);
      var nv = tmp.firstChild; v.parentNode.replaceChild(nv, v);
      startMap(nv, p.nearby, S, CUR.opts);
      return;
    }
    var a = ds.nbAct;
    if (a === 'savemaps') { saveMaps(p.nearby, progressPaint, true).then(progressPaint); progressPaint(); return; }
    if (a === 'mode' && CTL) {
      S.nbMode = CTL.mode === 'vector' ? 'sketch' : 'vector';
      CTL.mode = S.nbMode === 'vector' && vectorPossible(CTL.n) ? 'vector' : 'sketch';
      if (CTL.map) { try { CTL.map.remove(); } catch (x) { /* ignore */ } CTL.map = null; CTL.loaded = false; CTL.markers = {}; }
      drawMap(CTL, O.$('[data-nb-map]', CTL.el), S); modeButton(CTL); moveMe(CTL);
      return;
    }
    if (a === 'compass' && CTL) {
      var c = CTL;
      window.DeviceOrientationEvent.requestPermission().then(function (res) {
        if (res === 'granted') { window.addEventListener('deviceorientation', c.onOrient, true); t.hidden = true; }
      }, function () { /* refused: keep north up */ });
    }
  }

  O.nearby = {
    forBooking: forBooking, forBuilding: forBuilding, available: available, hasHome: hasHome,
    listHTML: listHTML, placeHTML: placeHTML, after: after, stop: stop,
    remember: remember, recall: recall, autoSave: autoSave, saveMaps: saveMaps, mapsState: mapsState,
    loadLib: loadLib, vendorBase: vendorBase, catBadge: catBadge, catIcon: catIcon, legOf: legOf, metaLine: metaLine,
    STYLE_URL: STYLE_URL, TILE_HOST: TILE_HOST
  };
})();
