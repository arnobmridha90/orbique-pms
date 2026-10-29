/* Nearby places, staff side: the "Nearby places" tab of the Guest App page and the building location field (also used by
   the building dialog in app/pages/properties.js). Each building has its own list (records 'places', see
   api/_lib/shared/geo.cjs), shown in the guest app of every stay in that building (app/pages/nearby.js).
   Staff add places by name (OpenStreetMap Nominatim search), by dropping a pin on the map (or pasting coordinates), or by
   ticking suggestions from OpenStreetMap (Overpass, within 1.5 km). On save the walking route from the building is
   worked out (FOSSGIS OSRM foot routing) and stored, so guests need no connection for it; without a route the guest app
   shows the straight line and the direction. These calls run in the staff browser only, lightly (Nominatim and the router
   at most once a second, search only when staff press Search or Enter, never as they type), and every failure is told
   plainly.
   Permissions: the tab needs the guest app section; adding, editing, ordering and removing need guestapp.edit. */
(function () {
  'use strict';
  var O = window.O, D = O.data, U = O.ui, esc = O.esc, G = O.geo, fmt = O.fmt;
  if (!G) return;

  var NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  var OVERPASS = 'https://overpass-api.de/api/interpreter';
  var ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';
  function ic(n) { return O.icon(n); }
  function NB() { return O.nearby; }

  /* ---------- network, politely ---------- */
  function getJSON(url, opts, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = null;
    opts = Object.assign({ headers: { Accept: 'application/json' } }, opts || {});
    if (ctl) { opts.signal = ctl.signal; t = setTimeout(function () { ctl.abort(); }, ms || 15000); }
    return fetch(url, opts).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }, function (e) { clearTimeout(t); throw e; });
  }
  var lastNominatim = 0;
  /* Nominatim usage policy: at most one request a second */
  function nominatim(params) {
    var wait = Math.max(0, lastNominatim + 1100 - Date.now());
    return new Promise(function (res) { setTimeout(res, wait); }).then(function () {
      lastNominatim = Date.now();
      var q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
      return getJSON(NOMINATIM + '?format=jsonv2&limit=8&accept-language=en&' + q, null, 12000);
    });
  }
  function searchPlaces(text, near) {
    var p = { q: text };
    if (near) { var bb = G.bbox([near], 6000); p.viewbox = [bb[0], bb[3], bb[2], bb[1]].map(function (x) { return x.toFixed(4); }).join(','); }
    return nominatim(p).then(function (list) {
      return (Array.isArray(list) ? list : []).map(function (r) {
        var lat = G.num(r.lat), lng = G.num(r.lon), parts = String(r.display_name || '').split(', ');
        if (!G.validLatLng(lat, lng)) return null;
        var tags = {}; if (r.category) tags[r.category] = r.type;
        return { name: (r.name || parts[0] || 'Place').slice(0, 80), address: parts.slice(1, 4).join(', ').slice(0, 160), lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6,
          category: G.categoryOfTags(tags) || 'other', osmId: r.osm_type && r.osm_id ? r.osm_type + '/' + r.osm_id : '', meters: near ? Math.round(G.distance(near, { lat: lat, lng: lng })) : null };
      }).filter(Boolean);
    });
  }
  function suggest(home) {
    var body = 'data=' + encodeURIComponent(G.overpassQuery(home.lat, home.lng, G.SUGGEST_RADIUS));
    return getJSON(OVERPASS, { method: 'POST', body: body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } }, 40000)
      .then(function (j) { return G.mapOverpass(j && j.elements, home, { radius: G.SUGGEST_RADIUS, perCategory: 8 }); });
  }
  /* the walking route building -> place, or null when the routing service has none or cannot be reached. Fair use of the
     FOSSGIS router: one request at a time, at least 1.2 s apart, and a minute's pause after it says "too many" (429) */
  var routeGate = Promise.resolve(), lastRoute = 0, routeBusyUntil = 0;
  function routeLimited() { return Date.now() < routeBusyUntil; }
  function route(home, pl) {
    var url = ROUTER + home.lng + ',' + home.lat + ';' + pl.lng + ',' + pl.lat + '?overview=full&geometries=geojson&steps=false';
    var job = routeGate.then(function () {
      if (routeLimited()) return null;
      var wait = Math.max(0, lastRoute + 1200 - Date.now());
      return new Promise(function (res) { setTimeout(res, wait); }).then(function () {
        lastRoute = Date.now();
        return getJSON(url, null, 15000).then(G.routeFromOsrm);
      }).catch(function (e) {
        if (e && /HTTP 429/.test(e.message)) routeBusyUntil = Date.now() + 60000;
        console.info('Nearby: no walking route', e && e.message); return null;
      });
    });
    routeGate = job.then(function () { return null; });
    return job;
  }

  /* ---------- the building location field (Guest App tab and the building dialog) ---------- */
  function llText(lat, lng) { return G.validLatLng(lat, lng) ? G.num(lat) + ', ' + G.num(lng) : ''; }
  function locFieldHTML(name, lat, lng, o) {
    o = o || {};
    return '<div class="np-loc" data-np-loc><div class="np-loc-row"><input class="input" id="' + esc(o.id || name) + '" name="' + esc(name) + '" value="' + esc(llText(lat, lng)) + '" placeholder="e.g. 3.0561, 101.6887 or a Google Maps link"' + (o.disabled ? ' disabled' : '') + ' inputmode="decimal" autocomplete="off">' +
      (o.disabled ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-np-find>' + ic('search') + 'Find from the address</button><button type="button" class="btn btn-ghost btn-sm" data-np-pick>' + ic('pin') + 'Pick on the map</button>') + '</div>' +
      '<div class="np-loc-res" data-np-res aria-live="polite"></div><div class="np-map np-loc-map" data-np-lmap hidden></div></div>';
  }
  /* el: a container holding locFieldHTML. o.query() -> the address text to search; o.onChange({lat, lng}) */
  function wireLocField(el, o) {
    var box = O.$('[data-np-loc]', el); if (!box || box._wired) return; box._wired = true;
    var input = O.$('input', box), res = O.$('[data-np-res]', box), mapEl = O.$('[data-np-lmap]', box), mapH = null;
    function set(ll, note) {
      input.value = llText(ll.lat, ll.lng);
      res.innerHTML = '<span class="small muted">' + esc(note || 'Location set.') + '</span>';
      if (mapH) mapH.pin(ll);
      if (o.onChange) o.onChange(ll);
    }
    box.addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t || !box.contains(t)) return;
      if (t.hasAttribute('data-np-find')) {
        var q = (o.query && o.query()) || '';
        if (q.replace(/[\s,]/g, '').length < 4) { res.innerHTML = '<span class="small ga-err">Type the street address and city first.</span>'; return; }
        if (navigator.onLine === false) { res.innerHTML = '<span class="small ga-err">You are offline. Paste the coordinates instead, for example from Google Maps.</span>'; return; }
        res.innerHTML = '<span class="small muted">Searching OpenStreetMap...</span>';
        nominatim({ q: q }).then(function (list) {
          list = (Array.isArray(list) ? list : []).filter(function (r) { return G.validLatLng(r.lat, r.lon); }).slice(0, 5);
          if (!list.length) { res.innerHTML = '<span class="small ga-err">Nothing found for that address. Try a shorter address, or pick the spot on the map.</span>'; return; }
          res.innerHTML = '<div class="np-hits">' + list.map(function (r, i) { return '<button type="button" class="np-hit" data-np-hit="' + i + '">' + ic('pin') + '<span>' + esc(String(r.display_name || '').slice(0, 140)) + '</span></button>'; }).join('') + '</div><span class="small muted">Search by OpenStreetMap Nominatim.</span>';
          res._hits = list;
        }, function () { res.innerHTML = '<span class="small ga-err">The map search did not answer. Try again in a minute, or paste the coordinates.</span>'; });
        return;
      }
      if (t.hasAttribute('data-np-hit')) { var h = (res._hits || [])[+t.getAttribute('data-np-hit')]; if (h) set({ lat: Math.round(G.num(h.lat) * 1e6) / 1e6, lng: Math.round(G.num(h.lon) * 1e6) / 1e6 }, 'Location set from the search. Check the pin on the map if you can.'); return; }
      if (t.hasAttribute('data-np-pick')) {
        if (!mapEl.hidden) { mapEl.hidden = true; return; }
        mapEl.hidden = false;
        var cur = G.parseCoords(input.value);
        pickMap(mapEl, cur, null, function (ll) { set(ll, 'Location set from the map.'); }).then(function (h) { mapH = h; }, function () {
          mapEl.hidden = true;
          res.innerHTML = '<span class="small ga-err">The map is not available here. Paste the coordinates instead: in Google Maps, press and hold the spot and copy the numbers.</span>';
        });
      }
    });
    input.addEventListener('change', function () {
      var v = input.value.trim();
      if (!v) { res.innerHTML = ''; if (o.onChange) o.onChange(null); return; }
      var ll = G.parseCoords(v);
      if (!ll) { res.innerHTML = '<span class="small ga-err">Use latitude, longitude like 3.0561, 101.6887, or paste a Google Maps link.</span>'; return; }
      set(ll, 'Location set.');
    });
  }
  /* a small map: tap to drop the pin. -> Promise({pin(ll)}) ; rejects when MapLibre is not available */
  function pickMap(el, at, home, onPick) {
    if (navigator.onLine === false) return Promise.reject(new Error('offline'));
    return NB().loadLib().then(function (ml) {
      el.innerHTML = '';
      var center = at || home || { lat: 3.139, lng: 101.6869 };
      var map = new ml.Map({ container: el, style: NB().STYLE_URL, center: [center.lng, center.lat], zoom: at || home ? 16 : 10, attributionControl: { compact: false }, dragRotate: false });
      var marker = null;
      function pin(ll) { if (!marker) marker = new ml.Marker({ color: '#1D4ED8' }).setLngLat([ll.lng, ll.lat]).addTo(map); else marker.setLngLat([ll.lng, ll.lat]); }
      if (home) { var d = document.createElement('div'); d.className = 'nb-pin'; d.innerHTML = NB().catBadge('home'); new ml.Marker({ element: d, anchor: 'bottom' }).setLngLat([home.lng, home.lat]).addTo(map); }
      if (at) pin(at);
      map.on('click', function (e) { var ll = { lat: Math.round(e.lngLat.lat * 1e6) / 1e6, lng: Math.round(e.lngLat.lng * 1e6) / 1e6 }; pin(ll); onPick(ll); });
      return { pin: pin, map: map };
    });
  }

  /* ---------- the tab ---------- */
  var ST = { bid: null, mode: 'search', q: '', hits: null, searching: false, searchErr: '', sugg: null, suggBusy: false, suggErr: '', pick: {}, pin: null, routing: {}, note: '' };
  var M = null; /* {el, opts} while mounted */
  var pinMap = null;
  function canEdit() { return !!(M && M.opts.canEdit && M.opts.canEdit()); }
  function changed() { if (M && M.opts.changed) M.opts.changed('places'); else O.emit('data', { type: 'places' }); }
  function buildings() { return D.buildings.filter(function (b) { return b && !b.archived; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }); }
  function current() { var list = buildings(); var b = list.filter(function (x) { return x.id === ST.bid; })[0] || list[0] || null; ST.bid = b ? b.id : null; return b; }
  function homeOf(bd) { return bd && G.validLatLng(bd.lat, bd.lng) ? { lat: G.num(bd.lat), lng: G.num(bd.lng) } : null; }
  function placesOf(bid) { return D.places.filter(function (p) { return p && p.buildingId === bid && !p.archived; }).sort(function (a, b) { return (G.num(a.order) || 0) - (G.num(b.order) || 0) || String(a.name).localeCompare(String(b.name)); }); }
  function catOptions(sel) { return G.CATEGORIES.map(function (c) { return '<option value="' + c.id + '"' + (c.id === sel ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join(''); }
  function nearbyTaken(bid, cand) { return placesOf(bid).some(function (p) { return (cand.osmId && p.osmId === cand.osmId) || (String(p.name).toLowerCase() === String(cand.name).toLowerCase() && G.validLatLng(p.lat, p.lng) && G.distance(p, cand) < 60); }); }

  function rowHTML(bd, p, i, n, ed) {
    var nb = NB(), home = homeOf(bd), meta = nb && home ? nb.metaLine({ building: { lat: home.lat, lng: home.lng } }, G.guestPlace(p) || p) : '';
    var routePill = ST.routing[p.id] ? U.pill('Finding the walking route', 'info') : p.routeStale ? U.pill('Needs a new route', 'warn') : p.route && Array.isArray(p.route.coords) ? U.pill('Walking route', 'ok') : U.pill('Straight line', 'neutral');
    return '<div class="np-row"><span class="np-n">' + (i + 1) + '</span>' + (nb ? nb.catBadge(p.category) : '') + '<div class="ga-rm"><div class="ga-rt"><b>' + esc(p.name || 'Place') + '</b>' + routePill + '</div>' +
      '<div class="ga-rs">' + esc([G.category(p.category).label, meta].filter(Boolean).join(' · ')) + '</div>' + (p.note ? '<div class="ga-rx">' + esc(p.note) + '</div>' : '') + '</div>' +
      (ed ? '<div class="ga-ea"><button type="button" class="ga-ib" data-np-move="' + esc(p.id) + ':-1" aria-label="Move ' + esc(p.name) + ' up"' + (i === 0 ? ' disabled' : '') + '>' + ic('up') + '</button>' +
        '<button type="button" class="ga-ib" data-np-move="' + esc(p.id) + ':1" aria-label="Move ' + esc(p.name) + ' down"' + (i === n - 1 ? ' disabled' : '') + '>' + ic('down') + '</button>' +
        '<button type="button" class="ga-ib" data-np-route="' + esc(p.id) + '" aria-label="Find the walking route to ' + esc(p.name) + ' again" title="Find the walking route again"' + (home ? '' : ' disabled') + '>' + ic('refresh') + '</button>' +
        '<button type="button" class="ga-ib" data-np-edit="' + esc(p.id) + '" aria-label="Edit ' + esc(p.name) + '">' + ic('edit') + '</button>' +
        '<button type="button" class="ga-ib" data-np-del="' + esc(p.id) + '" aria-label="Remove ' + esc(p.name) + '">' + ic('trash') + '</button></div>' : '') + '</div>';
  }
  function addHTML(bd, home) {
    var seg = U.seg([['search', 'Search by name'], ['pin', 'Drop a pin'], ['suggest', 'Suggest nearby']], ST.mode, 'data-np-mode');
    var body = '';
    if (ST.mode === 'search') {
      body = '<div class="field"><label for="np-q">Name of the place</label><div class="np-loc-row"><input id="np-q" class="input" data-np-q value="' + esc(ST.q) + '" maxlength="80" placeholder="e.g. nasi lemak, Pavilion, hospital" autocomplete="off" enterkeyhint="search">' +
        '<button type="button" class="btn btn-primary btn-sm" data-np-search' + (ST.searching ? ' disabled' : '') + '>' + ic('search') + 'Search</button></div></div>' +
        '<div class="np-hits" aria-live="polite">' + (ST.searching ? '<span class="small muted">Searching OpenStreetMap...</span>' : ST.searchErr ? '<span class="small ga-err">' + esc(ST.searchErr) + '</span>'
          : ST.hits ? (ST.hits.length ? ST.hits.map(function (h, i) {
            var taken = nearbyTaken(bd.id, h);
            return '<div class="np-hitrow">' + NB().catBadge(h.category) + '<div class="ga-rm"><b>' + esc(h.name) + '</b><span class="small muted">' + esc([h.address, h.meters != null ? G.fmtDistance(h.meters) + ' from ' + bd.name : ''].filter(Boolean).join(' · ')) + '</span></div>' +
              (taken ? U.pill('Added', 'ok') : '<button type="button" class="btn btn-ghost btn-sm" data-np-hit="' + i + '">' + ic('plus') + 'Add</button>') + '</div>';
          }).join('') : '<span class="small muted">Nothing found. Try another spelling, or drop a pin instead.</span>') : '<span class="small muted">Results come from OpenStreetMap, nearest to ' + esc(bd.name) + ' first.</span>') + '</div>';
    } else if (ST.mode === 'pin') {
      body = '<p class="ga-hint">Tap the map where the place is, then add it. No map here? Paste the coordinates or a Google Maps link below.</p>' +
        '<div class="np-map" data-np-pinmap></div>' +
        '<div class="np-loc-row"><input class="input" data-np-ll value="' + esc(ST.pin ? llText(ST.pin.lat, ST.pin.lng) : '') + '" placeholder="e.g. 3.0574, 101.6896" aria-label="Coordinates of the place" inputmode="decimal">' +
        '<button type="button" class="btn btn-primary btn-sm" data-np-pinadd>' + ic('plus') + 'Add this spot</button></div><span class="small ga-err" data-np-pinerr></span>';
    } else {
      body = '<p class="ga-hint">Hospitals, clinics, pharmacies, money changers, ATMs, police, shops, stations and places to eat within ' + G.fmtDistance(G.SUGGEST_RADIUS) + ' of ' + esc(bd.name) + ', from OpenStreetMap. Tick the ones to show guests.</p>' +
        (ST.suggBusy ? '<span class="small muted">Asking OpenStreetMap. This can take up to half a minute...</span>' : ST.suggErr ? '<span class="small ga-err">' + esc(ST.suggErr) + '</span>' : '') +
        (ST.sugg ? suggHTML(bd) : '<button type="button" class="btn btn-ghost btn-sm" data-np-suggest' + (ST.suggBusy ? ' disabled' : '') + '>' + ic('search') + 'Find places nearby</button>');
    }
    return '<section class="card"><div class="card-head"><h3>Add a place</h3></div><div class="card-body stack">' + seg + body + (ST.note ? '<div class="small muted" role="status">' + esc(ST.note) + '</div>' : '') + '</div></section>';
  }
  function suggHTML(bd) {
    if (!ST.sugg.length) return '<span class="small muted">OpenStreetMap has nothing named near here yet. Search by name or drop a pin instead.</span>';
    var n = Object.keys(ST.pick).filter(function (k) { return ST.pick[k]; }).length;
    return '<div class="np-sugg">' + G.CATEGORIES.map(function (c) {
      var list = ST.sugg.filter(function (s) { return s.category === c.id; }); if (!list.length) return '';
      return '<div class="np-sg"><div class="section-title">' + esc(c.label) + '</div>' + list.map(function (s) {
        var i = ST.sugg.indexOf(s), taken = nearbyTaken(bd.id, s);
        return '<label class="np-hitrow' + (taken ? ' taken' : '') + '"><input type="checkbox" data-np-pick="' + i + '"' + (ST.pick[i] ? ' checked' : '') + (taken ? ' disabled' : '') + '>' + NB().catBadge(s.category) +
          '<span class="ga-rm"><b>' + esc(s.name) + '</b><span class="small muted">' + esc([G.fmtDistance(s.meters), s.address, s.hours].filter(Boolean).join(' · ')) + '</span></span>' + (taken ? U.pill('Added', 'ok') : '') + '</label>';
      }).join('') + '</div>';
    }).join('') + '</div><div class="row-flex wrap"><button type="button" class="btn btn-primary btn-sm" data-np-addpicked' + (n ? '' : ' disabled') + '>' + ic('plus') + 'Add ' + (n ? fmt.plural(n, 'place') : 'the ticked places') + '</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-np-suggest>' + ic('refresh') + 'Search again</button><span class="small muted">Data © OpenStreetMap contributors.</span></div>';
  }
  function previewHTML(bd) {
    var nb = NB(); if (!nb) return '';
    var p = { ok: true, nearby: nb.forBuilding(bd) }, S = { nbCat: 'all' };
    return '<section class="card np-pv-card"><div class="card-head"><h3>What guests see</h3><span class="sub">In the Nearby tab of every stay in ' + esc(bd.name) + '</span></div><div class="card-body"><div class="np-pv"><div class="gx np-pv-gx"><main class="gx-main">' +
      (nb.available(p) ? nb.listHTML(p, S, { preview: true }) : '<p class="gx-p">Set the building location and add places to show them here.</p>') + '</main></div></div></div></section>';
  }
  function tabHTML() {
    var list = buildings(), bd = current(), ed = canEdit();
    if (!list.length) return '<div class="card">' + U.empty('Nearby places belong to a building. Add your building in Properties (Buildings & unit types), then pick the places guests should know about.', ic('pin')) +
      (O.can('properties') ? '<div class="ga-empty-act"><button type="button" class="btn btn-primary" data-np-go="properties">' + ic('plus') + 'Add a building</button></div>' : '') + '</div>';
    var home = homeOf(bd), places = placesOf(bd.id);
    var head = '<div class="ga-subbar">' + (list.length > 1 ? '<label class="np-bd"><span class="sr-only">Building</span><select class="select" data-np-bd aria-label="Building">' + list.map(function (b) { return '<option value="' + esc(b.id) + '"' + (b.id === bd.id ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('') + '</select></label>' : '<b>' + esc(bd.name) + '</b>') +
      '<span class="small muted">Food, street food, hospitals, money exchange and more near the building, with walking maps that work without internet. Each building has its own list.</span></div>' +
      (ed ? '' : M.opts.viewOnly('editing the guest app'));
    var loc = '<section class="card"><div class="card-head"><h3>Building location</h3><span class="sub">' + (home ? 'Guests always get directions back here' : 'Needed for the maps and the way back to the building') + '</span></div><div class="card-body">' +
      (home && !ST.editLoc ? '<div class="np-locline">' + ic('pin') + '<span>' + esc(bd.address || '') + ' · ' + esc(llText(home.lat, home.lng)) + '</span>' + (ed ? '<button type="button" class="btn btn-ghost btn-sm" data-np-editloc>Change</button>' : '') + '</div>'
        : (ed ? locFieldHTML('np-bd-ll', bd.lat, bd.lng, { id: 'np-bd-ll' }) + '<div class="row-flex wrap"><button type="button" class="btn btn-primary btn-sm" data-np-saveloc>Save location</button>' + (home ? '<button type="button" class="btn btn-ghost btn-sm" data-np-canceloc>Cancel</button>' : '') + '</div>' : '<p class="ga-ro">No location set yet.</p>')) + '</div></section>';
    var listCard = '<section class="card"><div class="card-head"><h3>Places</h3><span class="sub">' + fmt.plural(places.length, 'place') + ', in the order guests see them in each group</span></div><div class="card-body">' +
      (places.length ? places.map(function (p, i) { return rowHTML(bd, p, i, places.length, ed); }).join('') : U.empty(home ? 'No places yet. Add a few favourites below: where to eat, the nearest clinic, a money changer.' : 'Set the building location first, then add places.')) + '</div></section>';
    return head + '<div class="np-grid"><div class="np-col">' + loc + listCard + (ed && home ? addHTML(bd, home) : '') + '</div><div class="np-col">' + previewHTML(bd) + '</div></div>';
  }
  function draw() {
    if (!M || !document.body.contains(M.el)) { M = null; return; }
    if (pinMap) { try { pinMap.map.remove(); } catch (e) { /* ignore */ } pinMap = null; }
    M.el.innerHTML = tabHTML();
    var bd = current();
    if (bd) wireLocField(M.el, { query: function () { return [bd.address, bd.city, O.countryLabel(O.countryOf(bd))].filter(Boolean).join(', '); }, onChange: function (ll) { ST.locDraft = ll; } });
    var pm = O.$('[data-np-pinmap]', M.el);
    if (pm && bd) {
      pickMap(pm, ST.pin, homeOf(bd), function (ll) { ST.pin = ll; var i = O.$('[data-np-ll]', M.el); if (i) i.value = llText(ll.lat, ll.lng); }).then(function (h) { pinMap = h; }, function () {
        pm.innerHTML = '<div class="np-map-off">' + ic('map') + '<span>The map is not available here' + (navigator.onLine === false ? ' while offline' : '') + '. Paste the coordinates below instead.</span></div>';
      });
    }
  }
  function mount(el, opts) { M = { el: el, opts: opts || {} }; if (!el._npBound) { el._npBound = true; el.addEventListener('click', onClick); el.addEventListener('input', onInput); el.addEventListener('keydown', onKey); el.addEventListener('change', onChange); } draw(); }

  /* ---------- editing ---------- */
  function placeForm(p) {
    return '<form class="form-grid np-form" novalidate autocomplete="off">' +
      '<div class="field full"><label for="np-f-name">Name</label><input id="np-f-name" class="input" name="name" maxlength="80" value="' + esc(p.name || '') + '" placeholder="e.g. Restoran Saujana Corner"><div class="bt-err" data-err="name"></div></div>' +
      '<div class="field"><label for="np-f-cat">Type</label><select id="np-f-cat" class="select" name="category">' + catOptions(p.category || 'food') + '</select></div>' +
      '<div class="field"><label for="np-f-hours">Opening hours <span class="faint">(optional)</span></label><input id="np-f-hours" class="input" name="hours" maxlength="80" value="' + esc(p.hours || '') + '" placeholder="e.g. 7 AM to 11 PM"></div>' +
      '<div class="field full"><label for="np-f-note">Tip for guests <span class="faint">(optional)</span></label><textarea id="np-f-note" class="textarea" name="note" rows="2" maxlength="240" placeholder="e.g. Try the char kway teow">' + esc(p.note || '') + '</textarea></div>' +
      '<div class="field full"><label for="np-f-addr">Address <span class="faint">(optional)</span></label><input id="np-f-addr" class="input" name="address" maxlength="160" value="' + esc(p.address || '') + '"></div>' +
      '<div class="field"><label for="np-f-phone">Phone <span class="faint">(optional)</span></label><input id="np-f-phone" class="input" name="phone" type="tel" maxlength="40" value="' + esc(p.phone || '') + '"></div>' +
      '<div class="field"><label for="np-f-ll">Location</label><input id="np-f-ll" class="input" name="ll" value="' + esc(llText(p.lat, p.lng)) + '" placeholder="3.0574, 101.6896" inputmode="decimal"><div class="bt-err" data-err="ll"></div></div>' +
      '</form>';
  }
  function fval(el, n) { var x = O.$('[name="' + n + '"]', el); return x ? String(x.value).trim() : ''; }
  function editPlace(bd, p, isNew) {
    if (!canEdit()) return;
    var home = homeOf(bd);
    U.modal({ title: isNew ? 'Add a place' : 'Edit ' + (p.name || 'place'), sub: bd.name + (home && G.validLatLng(p.lat, p.lng) ? ' · ' + G.fmtDistance(G.distance(home, p)) + ' away' : ''), body: placeForm(p), autofocus: isNew,
      actions: [{ label: 'Cancel' }, { label: isNew ? 'Add place' : 'Save', kind: 'primary', onClick: function (close, el) {
        var v = { name: fval(el, 'name'), category: fval(el, 'category'), hours: fval(el, 'hours'), note: fval(el, 'note'), address: fval(el, 'address'), phone: fval(el, 'phone') }, ll = G.parseCoords(fval(el, 'll')), E = {};
        if (!v.name) E.name = 'Give the place a name.';
        if (!ll) E.ll = 'Use latitude, longitude like 3.0574, 101.6896, or paste a Google Maps link.';
        O.$$('.bt-err', el).forEach(function (x) { x.textContent = ''; });
        Object.keys(E).forEach(function (k) { var b = O.$('[data-err="' + k + '"]', el); if (b) b.textContent = E[k]; });
        if (Object.keys(E).length) return false;
        var moved = isNew || !G.validLatLng(p.lat, p.lng) || G.distance(p, ll) > 5;
        var rec = isNew ? Object.assign({ id: O.uid('PL'), buildingId: bd.id, order: placesOf(bd.id).length + 1, createdAt: D.NOW, createdBy: O.state.viewer }, p.osmId ? { osmId: p.osmId } : {}) : p;
        Object.keys(v).forEach(function (k) { rec[k] = v[k]; });
        rec.lat = ll.lat; rec.lng = ll.lng; rec.updatedAt = D.NOW; rec.updatedBy = O.state.viewer;
        if (moved) { rec.route = null; delete rec.routeStale; }
        if (isNew) D.places.push(rec);
        changed();
        if (moved) findRoute(bd, rec, true); else { U.toast('Saved ' + rec.name); draw(); }
        return true;
      } }] });
  }
  function findRoute(bd, p, fresh) {
    var home = homeOf(bd); if (!home || !G.validLatLng(p.lat, p.lng)) { draw(); return Promise.resolve(null); }
    if (navigator.onLine === false) { U.toast('Saved ' + p.name + '. You are offline, so guests see a straight line until you find the route.', 'bad'); draw(); return Promise.resolve(null); }
    ST.routing[p.id] = true; draw();
    return route(home, p).then(function (r) {
      delete ST.routing[p.id];
      var live = D.places.filter(function (x) { return x.id === p.id; })[0];
      if (!live) { draw(); return null; }
      if (r) { live.route = r; delete live.routeStale; live.updatedAt = D.NOW; changed(); U.toast((fresh ? 'Saved ' : 'Route updated for ') + live.name + ': ' + G.fmtDistance(r.meters) + ', ' + G.fmtWalk(r.minutes) + '.'); }
      else U.toast((fresh ? 'Saved ' + live.name + '. ' : '') + 'The walking route could not be found, so guests see a straight line and the direction. Try again later.', 'bad');
      draw();
      return r;
    });
  }
  function removePlace(p) {
    U.confirm('Remove ' + (p.name || 'this place') + ' from the guest app?', 'Remove', 'danger').then(function (ok) {
      if (!ok) return;
      var i = D.places.indexOf(p); if (i >= 0) D.places.splice(i, 1);
      renumber(p.buildingId); changed(); U.toast((p.name || 'Place') + ' removed'); draw();
    });
  }
  function renumber(bid) { placesOf(bid).forEach(function (x, i) { x.order = i + 1; }); }
  function addPicked(bd) {
    var picked = Object.keys(ST.pick).filter(function (k) { return ST.pick[k]; }).map(function (k) { return ST.sugg[+k]; }).filter(function (s) { return s && !nearbyTaken(bd.id, s); });
    if (!picked.length) return;
    var start = placesOf(bd.id).length, made = picked.map(function (s, i) {
      var rec = { id: O.uid('PL'), buildingId: bd.id, name: s.name, category: s.category, note: '', address: s.address || '', lat: s.lat, lng: s.lng, hours: s.hours || '', phone: s.phone || '', order: start + i + 1, route: null, osmId: s.osmId, createdAt: D.NOW, createdBy: O.state.viewer, updatedAt: D.NOW, updatedBy: O.state.viewer };
      D.places.push(rec); return rec;
    });
    ST.pick = {}; changed();
    ST.note = 'Added ' + fmt.plural(made.length, 'place') + '. Finding the walking routes...';
    draw();
    /* one route at a time, gently */
    var i = 0, found = 0;
    (function next() {
      if (i >= made.length) { ST.note = 'Added ' + fmt.plural(made.length, 'place') + '. ' + (found === made.length ? 'Every one has a walking route.' : found + ' of ' + made.length + ' have a walking route; the others show a straight line.') + ' Add a tip to each for guests.'; draw(); return; }
      var p = made[i++], home = homeOf(bd);
      ST.routing[p.id] = true;
      route(home, p).then(function (r) {
        delete ST.routing[p.id];
        if (r && D.places.indexOf(p) >= 0) { p.route = r; found++; changed(); }
        if (routeLimited()) { i = made.length; }
        ST.note = 'Finding the walking routes: ' + i + ' of ' + made.length + '...'; draw();
        next();
      });
    })();
  }
  function saveLoc(bd) {
    var input = O.$('#np-bd-ll', M.el), v = input ? input.value.trim() : '', ll = G.parseCoords(v);
    if (!ll) { var r = O.$('[data-np-res]', M.el); if (r) r.innerHTML = '<span class="small ga-err">' + (v ? 'Use latitude, longitude like 3.0561, 101.6887.' : 'Find the building from its address, pick it on the map, or paste its coordinates.') + '</span>'; return; }
    var moved = !G.validLatLng(bd.lat, bd.lng) || G.distance({ lat: G.num(bd.lat), lng: G.num(bd.lng) }, ll) > 5;
    bd.lat = ll.lat; bd.lng = ll.lng; ST.editLoc = false;
    changed(); U.toast('Location saved for ' + bd.name + '.');
    draw();
    if (moved) reroute(bd);
  }
  /* every route starts at the building: when it moves (or gets its first location), every place's route is found again,
     one at a time. A place keeps its old route, marked routeStale, until the new one is in; places left when the browser
     goes offline or the router is busy carry on when it is back online. */
  var rerouteBusy = {};
  function reroute(bd) {
    if (!bd || !homeOf(bd)) return;
    D.places.forEach(function (p) { if (p && p.buildingId === bd.id && !p.archived && G.validLatLng(p.lat, p.lng)) p.routeStale = true; });
    changed();
    resumeReroute(bd);
  }
  function resumeReroute(bd) {
    if (rerouteBusy[bd.id]) return;
    var list = D.places.filter(function (p) { return p && p.buildingId === bd.id && p.routeStale && !p.archived; });
    if (!list.length) return;
    rerouteBusy[bd.id] = true;
    var i = 0;
    (function next() {
      var home = homeOf(bd);
      if (i >= list.length || !home || navigator.onLine === false || routeLimited()) { delete rerouteBusy[bd.id]; if (M) draw(); return; }
      var p = list[i++];
      if (D.places.indexOf(p) < 0 || !p.routeStale) return next();
      ST.routing[p.id] = true;
      route(home, p).then(function (r) {
        delete ST.routing[p.id];
        if (D.places.indexOf(p) >= 0) {
          /* found: the new route. None (too far, no path): a straight line beats a route from the old spot */
          if (r) { p.route = r; delete p.routeStale; p.updatedAt = D.NOW; changed(); }
          else if (navigator.onLine !== false && !routeLimited()) { p.route = null; delete p.routeStale; changed(); }
        }
        if (M) draw();
        next();
      });
    })();
  }
  /* back online: finish any building whose routes were left half done */
  window.addEventListener('online', function () { D.buildings.forEach(function (b) { if (b && !b.archived) resumeReroute(b); }); });
  function doSearch() {
    var bd = current(), q = ST.q.trim();
    if (ST.searching) return;
    if (q.length < 3) { ST.hits = null; ST.searchErr = q ? 'Type at least 3 letters, then press Search.' : ''; ST.searching = false; return redrawKeepInput(); }
    if (navigator.onLine === false) { ST.searchErr = 'You are offline. Drop a pin or paste the coordinates instead.'; return draw(); }
    ST.searching = true; ST.searchErr = ''; draw();
    searchPlaces(q, homeOf(bd)).then(function (hits) {
      ST.searching = false;
      var home = homeOf(bd);
      ST.hits = hits.sort(function (a, b) { return (a.meters == null ? 1e9 : a.meters) - (b.meters == null ? 1e9 : b.meters); }).filter(function (h) { return !home || h.meters < 30000; });
      redrawKeepInput();
    }, function () { ST.searching = false; ST.searchErr = 'The map search did not answer. Try again in a minute, or drop a pin.'; redrawKeepInput(); });
  }
  function redrawKeepInput() {
    var a = document.activeElement, focus = a && a.hasAttribute && a.hasAttribute('data-np-q'), pos = focus ? a.selectionStart : 0;
    draw();
    if (focus) { var i = O.$('[data-np-q]', M.el); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } } }
  }
  function onClick(e) {
    var t = e.target.closest('button, a'); if (!t || !M || !M.el.contains(t) || t.disabled) return;
    var ds = t.dataset, bd = current();
    if (ds.npGo) return O.go(ds.npGo, { tab: 'types' });
    if (!bd || !canEdit()) return;
    if (ds.npMode) { ST.mode = ds.npMode; ST.note = ''; return draw(); }
    if (ds.npEditloc != null) { ST.editLoc = true; return draw(); }
    if (ds.npCanceloc != null) { ST.editLoc = false; return draw(); }
    if (ds.npSaveloc != null) return saveLoc(bd);
    if (ds.npHit != null && ST.hits) { var h = ST.hits[+ds.npHit]; if (h) editPlace(bd, { name: h.name, category: h.category, address: h.address, lat: h.lat, lng: h.lng, osmId: h.osmId }, true); return; }
    if (ds.npPinadd != null) {
      var ll = G.parseCoords((O.$('[data-np-ll]', M.el) || {}).value || '') || ST.pin, err = O.$('[data-np-pinerr]', M.el);
      if (!ll) { if (err) err.textContent = 'Tap the map, or paste coordinates like 3.0574, 101.6896.'; return; }
      ST.pin = ll; return editPlace(bd, { lat: ll.lat, lng: ll.lng, category: 'food' }, true);
    }
    if (ds.npSuggest != null) {
      var home = homeOf(bd); if (!home) return;
      if (navigator.onLine === false) { ST.suggErr = 'You are offline. Suggestions need the internet.'; return draw(); }
      ST.suggBusy = true; ST.suggErr = ''; ST.sugg = null; ST.pick = {}; draw();
      suggest(home).then(function (list) { ST.suggBusy = false; ST.sugg = list; draw(); }, function () { ST.suggBusy = false; ST.suggErr = 'OpenStreetMap did not answer in time. It is busy sometimes: try again in a minute, or search by name.'; draw(); });
      return;
    }
    if (ds.npAddpicked != null) return addPicked(bd);
    if (ds.npSearch != null) { var qi = O.$('[data-np-q]', M.el); if (qi) ST.q = qi.value; return doSearch(); }
    var p, parts;
    if (ds.npEdit) { p = D.places.filter(function (x) { return x.id === ds.npEdit; })[0]; if (p) editPlace(bd, p, false); return; }
    if (ds.npDel) { p = D.places.filter(function (x) { return x.id === ds.npDel; })[0]; if (p) removePlace(p); return; }
    if (ds.npRoute) { p = D.places.filter(function (x) { return x.id === ds.npRoute; })[0]; if (p) findRoute(bd, p, false); return; }
    if (ds.npMove) {
      parts = ds.npMove.split(':'); var list = placesOf(bd.id), i = list.findIndex(function (x) { return x.id === parts[0]; }), j = i + (+parts[1]);
      if (i < 0 || j < 0 || j >= list.length) return;
      var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
      list.forEach(function (x, k) { x.order = k + 1; }); changed(); return draw();
    }
  }
  /* Nominatim's usage policy does not allow search as you type: it runs on Search or Enter only */
  function onInput(e) {
    var t = e.target;
    if (t.hasAttribute('data-np-q')) ST.q = t.value;
  }
  function onKey(e) {
    var t = e.target;
    if (e.key === 'Enter' && t.hasAttribute && t.hasAttribute('data-np-q')) { e.preventDefault(); ST.q = t.value; if (canEdit()) doSearch(); }
  }
  function onChange(e) {
    var t = e.target;
    if (t.hasAttribute('data-np-bd')) { ST.bid = t.value; ST.hits = null; ST.sugg = null; ST.pick = {}; ST.pin = null; ST.note = ''; ST.editLoc = false; return draw(); }
    if (t.hasAttribute('data-np-pick')) { ST.pick[t.getAttribute('data-np-pick')] = t.checked; var b = O.$('[data-np-addpicked]', M.el), n = Object.keys(ST.pick).filter(function (k) { return ST.pick[k]; }).length; if (b) { b.disabled = !n; b.innerHTML = ic('plus') + 'Add ' + (n ? fmt.plural(n, 'place') : 'the ticked places'); } }
    if (t.hasAttribute('data-np-ll')) { var ll = G.parseCoords(t.value); if (ll) { ST.pin = ll; if (pinMap) pinMap.pin(ll); } }
  }

  O.nearbyStaff = { mount: mount, redraw: draw, locFieldHTML: locFieldHTML, wireLocField: wireLocField, route: route, reroute: reroute };
})();
