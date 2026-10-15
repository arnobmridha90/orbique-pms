/* Website builder (v4): 8 complete website designs, each rendered live from the workspace's properties, prices,
   reviews, logo and brand colours. Every design is a full site: hero, intro, homes with "from RM x / night",
   amenities, reviews, location, booking call to action with an enquiry form, and a footer with contact and social links.
   Every site also has a property page (gallery, live availability calendar, booking card) and an about page.

   Saved settings: D.website (config blob registered in core). v3 fields are kept (template, changed, content, featured,
   sections, pageSections, seo, propertyId, published, log); v4 adds optional fields: home (section order shared by every
   design), social ({instagram, facebook, tiktok}) and content.intro / introTitle / location.
   Demo publish history: D.websiteLog (demo blob registered here, so a new workspace starts unpublished).
   Site markup uses w-* classes inside .wbs; the styles are in pages/website.css and never leave .wbs. */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt, C = O.color;
  var st = { view: 'gallery', page: 'home', device: 'desktop', full: null, sel: {}, faqOpen: {}, mtab: 'edit' };
  var gid = 0, cache = null, selfEmit = false, saveTimer = null, pendingRemote = false;

  /* =====================================================================
     SAVED SETTINGS
     ===================================================================== */
  O.sync.blob('websiteLog', 'demo');
  D.websiteLog = D.websiteLog || [
    { template: 'coastal', at: '2026-09-14T16:20', by: 's1', what: 'Published' },
    { template: 'harbour', at: '2026-08-02T11:05', by: 's2', what: 'Published' }
  ];
  var PAGE_SECS = {
    property: ['gallery', 'overview', 'amenities', 'calendar', 'reviews', 'location'],
    about: ['story', 'team', 'stats', 'faq', 'contact']
  };
  function defaults() {
    return {
      template: 'coastal', changed: false,
      content: { headline: '', sub: '', cta: '', intro: '', introTitle: '', story: '', whatsapp: '', location: '' },
      featured: ['bf3b', 'hsg', 'kls', 'hv2', 'bfc', 'mrl'],
      sections: {}, home: null, social: null,
      pageSections: { property: PAGE_SECS.property.map(function (id) { return { id: id, on: true }; }), about: PAGE_SECS.about.map(function (id) { return { id: id, on: true }; }) },
      seo: { title: '', desc: '' }, propertyId: null, published: null, log: []
    };
  }
  D.website = D.website || defaults();

  /* v3 template ids -> the closest v4 design */
  var LEGACY = { harbour: 'coastal', skyline: 'urban', heritage: 'heritage', tropika: 'tropical', mosaic: 'minimal', highlands: 'highland', concierge: 'editorial', metro: 'urban', weekender: 'minimal', storyteller: 'editorial', workstay: 'urban', postcard: 'family' };
  var LEGACY_NAME = { harbour: 'Harbour', skyline: 'Skyline', tropika: 'Tropika', mosaic: 'Mosaic', highlands: 'Highlands', concierge: 'Concierge', metro: 'Metro', weekender: 'Weekender', storyteller: 'Storyteller', workstay: 'Workstay', postcard: 'Postcard' };

  function site() {
    var S = D.website;
    if (!S || typeof S !== 'object' || Array.isArray(S)) S = D.website = defaults();
    if (!S.content || typeof S.content !== 'object') S.content = {};
    if (!Array.isArray(S.featured)) S.featured = [];
    if (!S.seo || typeof S.seo !== 'object') S.seo = { title: '', desc: '' };
    if (!S.pageSections || typeof S.pageSections !== 'object') S.pageSections = {};
    Object.keys(PAGE_SECS).forEach(function (k) {
      var cur = Array.isArray(S.pageSections[k]) ? S.pageSections[k].filter(function (s) { return s && PAGE_SECS[k].indexOf(s.id) >= 0; }) : [];
      PAGE_SECS[k].forEach(function (id) { if (!cur.some(function (s) { return s.id === id; })) cur.push({ id: id, on: true }); });
      if (!Array.isArray(S.pageSections[k]) || cur.length !== S.pageSections[k].length) S.pageSections[k] = cur;
    });
    if (!Array.isArray(S.log)) S.log = [];
    if (!TPL_BY[S.template]) S.template = LEGACY[S.template] || 'coastal';
    return S;
  }
  function cval(k) { var c = site().content; return (c && c[k]) || ''; }
  function canEdit() { return O.can('website.edit'); }
  function canPublish() { return O.can('website.publish'); }
  var NO_EDIT = 'Your access does not include editing the website';
  var NO_PUB = 'Your access does not include publishing the website';
  function dis(ok, why) { return ok ? '' : ' disabled title="' + esc(why) + '"'; }

  /* save: mark the draft changed and let the sync layer save D.website (debounced while typing) */
  function emitNow(type) { clearTimeout(saveTimer); saveTimer = null; selfEmit = true; try { O.emit('data', { type: typeof type === 'string' ? type : 'website' }); } finally { selfEmit = false; } }
  function save(later) { site().changed = true; cache = null; clearTimeout(saveTimer); if (later) saveTimer = setTimeout(emitNow, 600); else emitNow(); }

  /* =====================================================================
     FACTS FROM THE WORKSPACE (computed once per render pass)
     ===================================================================== */
  var CITY_ALIAS = { 'george town': 'Penang', 'georgetown': 'Penang', 'batu ferringhi': 'Penang', 'tanjung bungah': 'Penang', 'gurney drive': 'Penang', 'pulau pinang': 'Penang', 'malacca': 'Melaka', 'kl': 'Kuala Lumpur', 'tanah rata': 'Cameron Highlands', 'brinchang': 'Cameron Highlands', 'genting': 'Genting Highlands', 'kk': 'Kota Kinabalu', 'jb': 'Johor Bahru', 'pj': 'Petaling Jaya' };
  var GEO = { 'Penang': [5.41, 100.33], 'Langkawi': [6.35, 99.8], 'Alor Setar': [6.12, 100.37], 'Ipoh': [4.6, 101.08], 'Cameron Highlands': [4.47, 101.38], 'Genting Highlands': [3.42, 101.79], 'Kuala Lumpur': [3.14, 101.69], 'Petaling Jaya': [3.1, 101.6], 'Shah Alam': [3.07, 101.52], 'Putrajaya': [2.93, 101.69], 'Port Dickson': [2.52, 101.8], 'Melaka': [2.19, 102.25], 'Johor Bahru': [1.49, 103.74], 'Desaru': [1.55, 104.26], 'Kuantan': [3.81, 103.33], 'Cherating': [4.13, 103.39], 'Kuala Terengganu': [5.33, 103.14], 'Kota Bharu': [6.13, 102.24] };
  var CITY_NOTE = {
    'Penang': 'Hawker food, the sea and the heritage streets of George Town.',
    'Kuala Lumpur': 'Train lines, malls and some of the best food in the country, minutes away.',
    'Melaka': 'Jonker Street, the river walk and chicken rice balls around the corner.',
    'Cameron Highlands': 'Cool air, tea plantations and strawberry farms on the doorstep.',
    'Langkawi': 'Beaches, the cable car and island hopping.',
    'Ipoh': 'White coffee, limestone caves and old town murals.',
    'Johor Bahru': 'Close to Singapore, theme parks and the waterfront.',
    'Genting Highlands': 'Cool hills, the cable car and theme parks.',
    'Kota Kinabalu': 'Island hopping, waterfront sunsets and Mount Kinabalu nearby.',
    'Kuching': 'The waterfront, old bazaars and rainforest day trips.',
    'Petaling Jaya': 'Quiet streets, cafes and an easy ride into the city.',
    'Port Dickson': 'Long beaches and easy weekends by the sea.',
    'Kuantan': 'Beaches, waterfalls and fresh seafood on the east coast.'
  };
  function trim(s) { return String(s).trim(); }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function cityOf(p) {
    var parts = String(p.city || p.area || p.location || p.address || '').split(',').map(function (x) { return trim(x).replace(/^\d{5}\s*/, ''); }).filter(Boolean);
    for (var i = parts.length - 1; i >= 0; i--) {
      var k = parts[i].toLowerCase();
      if (CITY_ALIAS[k]) return CITY_ALIAS[k];
      if (GEO[parts[i]] || CITY_NOTE[parts[i]]) return parts[i];
    }
    return parts.length ? parts[parts.length - 1] : 'Malaysia';
  }
  function sceneOf(p) {
    var s = ((p.name || '') + ' ' + (p.type || '') + ' ' + (p.area || '') + ' ' + (p.address || '') + ' ' + (p.city || '')).toLowerCase();
    if (/beach|ferringhi|\bsea|bay|coast|pantai|island|langkawi|desaru|cherating|dickson|tioman|redang|perhentian|kota kinabalu|\blaut\b/.test(s)) return 'sea';
    if (/marina|quay|harbou?r|jetty/.test(s)) return 'marina';
    if (/highland|hill|cameron|genting|fraser|\btea\b|bukit|gunung|ladang/.test(s)) return 'hills';
    if (/heritage|shophouse|george town|armenian|peranakan/.test(s)) return 'heritage';
    if (/river|jonker|melaka|malacca|sungai|kuching/.test(s)) return 'river';
    if (/villa|garden|bungalow|bangsar|terrace|taman|kampung|homestay|farm/.test(s)) return 'garden';
    if (/klcc|skyline|tower|penthouse/.test(s)) return 'night';
    if (/condo|residence|resort|pool|suite/.test(s)) return 'pool';
    return 'city';
  }
  var PHOTO_URLS = typeof Map === 'function' ? new Map() : null;
  /* property photos are data URLs (up to 150 KB each): hand the browser a blob URL so the many previews stay light */
  function photoSrc(v) {
    var src = typeof v === 'string' ? v : (v && (v.url || v.src || v.data)) || '';
    if (!src || src.slice(0, 5) !== 'data:' || src.length < 4000 || !PHOTO_URLS || !window.URL || !URL.createObjectURL) return src;
    var hit = PHOTO_URLS.get(src); if (hit) return hit;
    try {
      var m = /^data:([^;,]*)(;base64)?,/.exec(src), body = src.slice(m[0].length), bin = m[2] ? atob(body) : decodeURIComponent(body);
      var arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([arr], { type: m[1] || 'image/jpeg' }));
      PHOTO_URLS.set(src, url); return url;
    } catch (e) { return src; }
  }
  function price(p, iso) {
    var o = D.priceOverrides && D.priceOverrides[p.id];
    if (o && o[iso]) return o[iso];
    try { var v = D.rateFor(p.id, iso, 0); if (v > 0) return v; } catch (e) { /* new property without a rate model */ }
    var b = +(p.base || p.price || p.nightly || 0); return b > 0 ? b : null;
  }
  function mode(arr) { var c = {}, best = null; arr.forEach(function (x) { if (!x) return; c[x] = (c[x] || 0) + 1; if (best == null || c[x] > c[best]) best = x; }); return best; }
  function hhmm(v) { return /^\d{2}:\d{2}$/.test(v || '') ? v : null; }
  function facts() {
    if (cache) return cache;
    var list = (D.properties || []).filter(function (p) { return p && p.id && !p.archived && p.status !== 'archived'; });
    var ids = {}; list.forEach(function (p) { ids[p.id] = 1; });
    var reviews = (D.reviews || []).filter(function (r) { return r && ids[r.propertyId] && r.stars; });
    var bookings = (D.bookings || []).filter(function (b) { return b && ids[b.propertyId]; });
    /* units of a unit type ("Deluxe") are one listing: "Building · Type", never the unit's own name or number */
    var typed = {}, types = [];
    list.forEach(function (p) { var t = O.typeOf(p); if (t && !t.archived) { if (!typed[t.id]) { typed[t.id] = []; types.push(t); } typed[t.id].push(p); } });
    function one(p) {
      var rs = reviews.filter(function (r) { return r.propertyId === p.id; }), from = null;
      for (var i = 1; i <= 30; i++) { var v = price(p, d.add(D.TODAY, i)); if (v && (from == null || v < from)) from = v; }
      var beds = p.beds != null ? +p.beds || 0 : (p.bedrooms != null ? +p.bedrooms || 0 : 1);
      var cf = bookings.filter(function (b) { return b.propertyId === p.id && b.cleaningFee; }).map(function (b) { return b.cleaningFee; }).sort(function (a, b) { return a - b; });
      var city = cityOf(p);
      return {
        p: p, id: p.id, name: p.name || 'Untitled home', short: p.short || p.name || 'Home', city: city, area: p.area || p.address || city,
        type: p.type || (beds ? beds + '-bedroom home' : 'Studio'), beds: beds, sleeps: +(p.sleeps || p.maxGuests || 0) || Math.max(2, beds * 2),
        from: from, rating: rs.length ? rs.reduce(function (s, r) { return s + r.stars; }, 0) / rs.length : null, nReviews: rs.length,
        cleaning: cf.length ? cf[Math.floor(cf.length / 2)] : ({ 0: 50, 1: 60, 2: 80, 3: 110, 4: 130 }[beds] || 80),
        scene: sceneOf(p), photos: (Array.isArray(p.photos) ? p.photos : []).map(photoSrc).filter(Boolean), slug: slug(p.name),
        parking: !!p.parking && !/^no parking|^street|^none/i.test(String(p.parking)), parkingText: p.parking ? String(p.parking) : '',
        lockBrand: p.lockBrand || 'Smart', checkIn: hhmm(p.checkInTime) || hhmm(p.checkIn), checkOut: hhmm(p.checkOutTime) || hhmm(p.checkOut)
      };
    }
    var props = list.filter(function (p) { var t = O.typeOf(p); return !(t && typed[t.id]); }).map(one).concat(types.map(function (t) {
      var us = typed[t.id].sort(function (a, b) { return O.assign.naturalCompare(a.unitNo || a.name, b.unitNo || b.name); }), x = one(us[0]), bd = O.building(t.buildingId) || {};
      var ids = {}; us.forEach(function (u) { ids[u.id] = 1; });
      var rs = reviews.filter(function (r) { return ids[r.propertyId]; }), froms = us.map(function (u) { return u === us[0] ? x.from : one(u).from; }).filter(Boolean);
      x.id = 'type:' + t.id; x.typeId = t.id; x.unitIds = Object.keys(ids);
      x.name = O.typeTitle(t); x.short = t.name; x.slug = slug(x.name);
      if (bd.city) x.city = bd.city;
      x.area = bd.address || x.area;
      if (t.beds != null) { x.beds = +t.beds || 0; x.type = x.beds ? x.beds + '-bedroom home' : 'Studio'; }
      if (t.maxGuests) x.sleeps = +t.maxGuests;
      if (x.parking) x.parkingText = 'Building car park, your bay is in the guest app'; /* a bay number can point to the unit */
      x.from = froms.length ? Math.min.apply(null, froms) : null;
      x.rating = rs.length ? rs.reduce(function (sm, r) { return sm + r.stars; }, 0) / rs.length : null; x.nReviews = rs.length;
      if (bd.checkInTime) x.checkIn = hhmm(bd.checkInTime);
      if (bd.checkOutTime) x.checkOut = hhmm(bd.checkOutTime);
      return x;
    }));
    var byId = {}; props.forEach(function (x) { byId[x.id] = x; });
    var cmap = {};
    props.forEach(function (x) { (cmap[x.city] = cmap[x.city] || []).push(x); });
    var cities = Object.keys(cmap).map(function (c) {
      var ps = cmap[c], fr = ps.map(function (x) { return x.from; }).filter(Boolean);
      return { name: c, props: ps, from: fr.length ? Math.min.apply(null, fr) : null, scene: mode(ps.map(function (x) { return x.scene; })), geo: GEO[c] || null };
    }).sort(function (a, b) { return b.props.length - a.props.length || (a.name < b.name ? -1 : 1); });
    var good = reviews.filter(function (r) { return r.stars === 5 && r.text && r.text.length >= 50 && r.text.length <= 210; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var seen = {}, top = good.filter(function (r) { if (seen[r.text]) return false; seen[r.text] = 1; return true; });
    var plats = {}; reviews.forEach(function (r) { plats[r.platform] = 1; });
    var froms = props.map(function (x) { return x.from; }).filter(Boolean);
    var firstStay = bookings.reduce(function (m, b) { return b.checkIn && b.checkIn < m ? b.checkIn : m; }, '9999');
    cache = {
      props: props, byId: byId, cities: cities, reviews: reviews, top: top,
      avg: reviews.length ? reviews.reduce(function (s, r) { return s + r.stars; }, 0) / reviews.length : null, nReviews: reviews.length,
      platforms: Object.keys(plats).map(function (k) { return U.platName(k); }),
      hosted: bookings.filter(function (b) { return b.status === 'checked_out' || b.status === 'checked_in'; }).length,
      firstStay: firstStay === '9999' ? null : firstStay, minFrom: froms.length ? Math.min.apply(null, froms) : null,
      checkIn: mode(bookings.map(function (b) { return b.checkInTime; })) || mode(props.map(function (x) { return x.checkIn; })) || '15:00',
      checkOut: mode(bookings.map(function (b) { return b.checkOutTime; })) || mode(props.map(function (x) { return x.checkOut; })) || '11:00',
      withParking: props.filter(function (x) { return x.parking; }).length, taken: {}
    };
    return cache;
  }
  /* nights already booked or blocked for a property, from yesterday on */
  function taken(pid) {
    var F = facts(); if (F.taken[pid]) return F.taken[pid];
    var m = {}, from = d.add(D.TODAY, -1), i, x;
    if (String(pid).indexOf('type:') === 0) {
      O.assign.typeAvailability({ unitTypeId: pid.slice(5), units: D.properties, bookings: D.bookings, blocks: D.blocks || [], from: from, to: d.add(from, 400) }).forEach(function (n) { if (n.availability < 1) m[n.date] = 1; });
      return (F.taken[pid] = m);
    }
    (D.bookings || []).forEach(function (b) { if (b.propertyId !== pid || b.status === 'cancelled' || !b.checkIn || !b.checkOut || b.checkOut <= from) return; for (x = b.checkIn < from ? from : b.checkIn, i = 0; x < b.checkOut && i < 400; x = d.add(x, 1), i++) m[x] = 1; });
    (D.blocks || []).forEach(function (k) { if (k.propertyId !== pid || !k.start || !k.end || k.end <= from) return; for (x = k.start < from ? from : k.start, i = 0; x < k.end && i < 400; x = d.add(x, 1), i++) m[x] = 1; });
    return (F.taken[pid] = m);
  }
  function isBooked(pid, iso) { return !!taken(pid)[iso]; }

  function wsInfo() {
    var w = O.ws() || {}, name = w.name || 'Your company';
    return { raw: w, id: w.id, name: name, legal: w.legal || name, phone: w.phone || '', email: w.email || '', address: w.address || '', domain: w.domain || (slug(name) || 'your-site') + '.orbique.site', logo: w.logo || '' };
  }
  function cityList(F) { var n = F.cities.map(function (c) { return c.name; }); if (!n.length) return 'Malaysia'; if (n.length === 1) return n[0]; return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; }
  function shortCity(c) { return c === 'Kuala Lumpur' ? 'KL' : c === 'Cameron Highlands' ? 'Cameron' : c === 'Genting Highlands' ? 'Genting' : c; }
  function rm(n) { return n == null ? 'RM –' : 'RM ' + fmt.num(n); }
  function plural(n, one, many) { return fmt.plural(n, one, many); }
  function stars(n) { var s = ''; for (var i = 1; i <= 5; i++) s += i <= Math.round(n || 0) ? '★' : '☆'; return s; }
  function firstName(g) { return String(g || 'Guest').replace(/^The /, '').split(' ')[0]; }
  function waNumber() { return cval('whatsapp') || wsInfo().phone; }
  function waHref() { return 'https://wa.me/' + String(waNumber()).replace(/\D/g, ''); }
  function handleOf(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function social() {
    var s = site().social, h = handleOf(wsInfo().name);
    if (!s || typeof s !== 'object') return { instagram: h, facebook: h, tiktok: '' };
    return { instagram: s.instagram || '', facebook: s.facebook || '', tiktok: s.tiktok || '' };
  }
  function introDefault(F, ws) {
    if (!F.props.length) return 'Tell guests who you are and what makes your homes special. Add your properties and this site fills in with your photos, prices and reviews.';
    return ws.name + ' looks after ' + plural(F.props.length, 'serviced home') + ' in ' + cityList(F) + '. Every home is cleaned by our own team and checked before you arrive, with self check-in and a real person on WhatsApp.';
  }
  function storyText() {
    var F = facts(), ws = wsInfo();
    return cval('story') || (ws.name + ' is a local team ' + (F.props.length ? 'looking after ' + plural(F.props.length, 'home') + ' in ' + cityList(F) : 'that looks after holiday homes') + '. We clean and check every home ourselves, answer messages quickly and keep our prices fair, because guests who book direct deserve the best rate.');
  }
  function seoTitle() { var F = facts(), ws = wsInfo(); return site().seo.title || (ws.name + ' | ' + (F.cities.length ? 'Stays in ' + F.cities.slice(0, 4).map(function (c) { return shortCity(c.name); }).join(', ') : 'Book direct')); }
  function seoDesc() { var F = facts(), ws = wsInfo(); return site().seo.desc || ('Book ' + (F.props.length ? F.props.length + ' serviced homes' : 'your stay') + ' directly with ' + ws.name + '. Self check-in, fast Wi-Fi, an invoice for every stay and no platform fees.'); }

  /* =====================================================================
     DESIGNS
     order: default home section order (the owner's own order, D.website.home, is shared by every design)
     v: layout used for each section; header: overlay | bar | center | dark
     ===================================================================== */
  var TPL = [
    { id: 'coastal', name: 'Coastal escape', desc: 'Bright and airy: a full-width sea-view hero, a floating date search and soft sand tones.', best: 'Beach condos and seaside apartments', type: 'Clean modern sans', mood: 'Light and airy', scene: 'sea', header: 'overlay',
      order: ['intro', 'units', 'amenities', 'reviews', 'location', 'book'], v: { intro: 'center', units: 'cards', amenities: 'icons', reviews: 'cards', location: 'map', book: 'split', footer: 'columns' },
      words: { intro: 'Looked after, not just listed', units: ['Stay with us', 'Homes by the water and in town'], amen: ['Every stay includes', 'Thoughtful touches, no surprises'], rev: ['Guest reviews', 'Loved by our guests'], loc: ['Where we are', 'Find your favourite corner'], book: ['Book direct', 'Ready for a few slow days?'] },
      copy: function (F) { return ['Wake up to sea breezes and slow mornings', 'Bright, serviced homes in ' + cityList(F) + '. Book direct for the best rate and a host who answers.', 'Check availability']; } },
    { id: 'urban', name: 'Urban loft', desc: 'Dark and confident: condensed capitals, an index-style homes grid and a moving neighbourhood ticker.', best: 'City apartments, studios and lofts', type: 'Bold capitals and mono', mood: 'Dark and bold', scene: 'night', header: 'dark',
      order: ['intro', 'units', 'amenities', 'reviews', 'location', 'book'], v: { intro: 'split', units: 'grid', amenities: 'list', reviews: 'quote', location: 'map', book: 'band', footer: 'columns' },
      words: { intro: 'Your base in the city', units: ['Stays', 'Choose your base'], amen: ['Included', 'Everything you need, nothing you don\'t'], rev: ['Reviews', 'Guests say'], loc: ['Neighbourhoods', 'Close to everything'], book: ['Book', 'Your keys are waiting'] },
      copy: function (F) { return ['Live like a local in the city', (F.props.length ? F.props.length + ' serviced apartments' : 'Serviced apartments') + ' in ' + cityList(F) + '. Self check-in, fast Wi-Fi and a host on WhatsApp.', 'Find your stay']; } },
    { id: 'highland', name: 'Highland retreat', desc: 'Calm and natural: a panoramic hero, serif headings and roomy rows for each home.', best: 'Villas, retreats and long weekends', type: 'Classic serif with a light sans', mood: 'Calm and natural', scene: 'hills', header: 'overlay',
      order: ['intro', 'units', 'amenities', 'reviews', 'location', 'book'], v: { intro: 'letter', units: 'rows', amenities: 'split', reviews: 'quote', location: 'stops', book: 'split', footer: 'columns' },
      words: { intro: 'Slow down, we have it covered', units: ['Where to stay', 'Homes with room to breathe'], amen: ['Ready when you arrive', 'Everything is taken care of'], rev: ['From our guestbook', 'Kind words'], loc: ['Getting here', 'Easy to reach, hard to leave'], book: ['Plan your stay', 'Come away for the weekend'] },
      copy: function (F) { return ['Cool air, quiet mornings and room to breathe', 'Homes made for long weekends and slow weeks, looked after by a local team in ' + cityList(F) + '.', 'Plan your escape']; } },
    { id: 'heritage', name: 'Heritage shophouse', desc: 'Warm and storied: Peranakan tile borders, arched photos, Didot headlines and a numbered collection.', best: 'Heritage houses and boutique stays', type: 'High-contrast serif', mood: 'Warm and classic', scene: 'heritage', header: 'center',
      order: ['intro', 'units', 'amenities', 'reviews', 'location', 'book'], v: { intro: 'letter', units: 'list', amenities: 'icons', reviews: 'pull', location: 'map', book: 'split', footer: 'centered' },
      words: { intro: 'A home with a past', units: ['The collection', 'Homes with a sense of place'], amen: ['Comforts', 'Old walls, modern comforts'], rev: ['Guestbook', 'In our guests\' words'], loc: ['The neighbourhood', 'Streets worth walking'], book: ['Reservations', 'Stay in a piece of history'] },
      copy: function (F) { return ['Old houses, new stories', 'Restored homes with character in ' + cityList(F) + ', each with a story of its own.', 'Book your stay']; } },
    { id: 'minimal', name: 'Minimal grid', desc: 'Quiet Swiss layout: a bento hero, square photos, hairlines and one confident brand tile.', best: 'Design-led apartments', type: 'Swiss sans and mono', mood: 'Clean and quiet', scene: 'abstract', header: 'bar',
      order: ['intro', 'units', 'amenities', 'reviews', 'location', 'book'], v: { intro: 'split', units: 'grid', amenities: 'list', reviews: 'columns', location: 'list', book: 'split', footer: 'columns' },
      words: { intro: 'Well made. Well kept.', units: ['Homes', 'All homes'], amen: ['Standard', 'In every home'], rev: ['Reviews', 'What guests say'], loc: ['Locations', 'Where we are'], book: ['Book', 'Check your dates'] },
      copy: function (F) { return ['Well-made homes. Nothing extra.', 'Good beds, real kitchens and fast Wi-Fi in ' + cityList(F) + '. Booked in a minute.', 'See the homes']; } },
    { id: 'editorial', name: 'Boutique editorial', desc: 'A magazine cover: large italic serif type, captions, pull quotes and a featured home.', best: 'Boutique collections and host-led brands', type: 'Book serif with italics', mood: 'Refined and literary', scene: 'living', header: 'center',
      order: ['intro', 'units', 'reviews', 'amenities', 'location', 'book'], v: { intro: 'letter', units: 'feature', amenities: 'list', reviews: 'pull', location: 'list', book: 'band', footer: 'centered' },
      words: { intro: 'A letter from the host', units: ['The collection', 'Homes worth the journey'], amen: ['The details', 'What to expect'], rev: ['Notes from guests', 'Overheard'], loc: ['Places', 'Where to find us'], book: ['Reservations', 'Write to us'] },
      copy: function (F) { return ['A collection of homes worth the journey', 'Hand-picked stays in ' + cityList(F) + ', chosen for their light, their streets and the people next door.', 'Explore the collection']; } },
    { id: 'tropical', name: 'Tropical resort', desc: 'Lush and sunny: deep green sections, palm-leaf patterns, rounded photos and a scrolling homes row.', best: 'Pool villas, resorts and holiday condos', type: 'Geometric sans', mood: 'Lush and sunny', scene: 'pool', header: 'overlay',
      order: ['intro', 'units', 'amenities', 'reviews', 'location', 'book'], v: { intro: 'center', units: 'carousel', amenities: 'icons', reviews: 'cards', location: 'map', book: 'band', footer: 'columns' },
      words: { intro: 'Holiday mode, switched on', units: ['Our homes', 'Pick your spot in the sun'], amen: ['Holiday ready', 'Pack light, we have the rest'], rev: ['Happy guests', 'Holiday stories'], loc: ['Destinations', 'Where the holidays happen'], book: ['Book direct', 'Your holiday starts here'] },
      copy: function (F) { return ['Sun, pools and long lazy days', 'Holiday homes in ' + cityList(F) + ' with space to unwind and a host on call.', 'Plan your holiday']; } },
    { id: 'family', name: 'Family stays', desc: 'Friendly and playful: rounded shapes, polaroid photos, sticker highlights and speech-bubble reviews.', best: 'Family holidays and group trips', type: 'Soft rounded sans', mood: 'Friendly and playful', scene: 'garden', header: 'bar',
      order: ['intro', 'units', 'amenities', 'reviews', 'location', 'book'], v: { intro: 'bubble', units: 'polaroid', amenities: 'icons', reviews: 'cards', location: 'map', book: 'split', footer: 'columns' },
      words: { intro: 'Hello from your hosts', units: ['Family homes', 'Room for everyone'], amen: ['Made for families', 'Little things that make it easy'], rev: ['Happy families', 'What parents tell us'], loc: ['Where we are', 'Fun nearby'], book: ['Say hello', 'Plan your family trip'] },
      copy: function (F) { return ['Holidays the whole family will love', 'Spacious homes in ' + cityList(F) + ' with full kitchens, room to play and hosts who think of the little things.', 'Find a family home']; } }
  ];
  var TPL_BY = {}; TPL.forEach(function (t) { TPL_BY[t.id] = t; });
  function tplOf(id) { return TPL_BY[id] || TPL_BY[LEGACY[id]] || TPL[0]; }
  function tplName(id) { return TPL_BY[id] ? TPL_BY[id].name : (LEGACY_NAME[id] || id || ''); }
  var SEC_IDS = ['intro', 'units', 'amenities', 'reviews', 'location', 'book'];
  var SEC_LABEL = { hero: 'Hero', intro: 'Introduction', units: 'Homes and prices', amenities: 'Amenities', reviews: 'Guest reviews', location: 'Location and area', book: 'Booking and enquiry form', footer: 'Footer',
    gallery: 'Photo gallery', overview: 'Overview and facts', calendar: 'Availability calendar and booking', story: 'Our story', team: 'Our team', stats: 'Numbers', faq: 'Questions and answers', contact: 'Contact form and WhatsApp' };
  var SEC_DESC = { hero: 'Always at the top', footer: 'Contact details and social links, always at the bottom', units: 'Featured homes with "from RM x / night"', reviews: 'Recent five-star reviews from your platforms', book: 'Enquiries arrive in Guest inbox', location: 'Your areas on a map, with a line about each',
    calendar: 'Live availability from your calendar, with prices', contact: 'Enquiries arrive in Guest inbox', faq: 'Check-in, door codes, tourism tax, invoices', intro: 'A short welcome and a few key facts', amenities: 'What every stay includes' };
  function homeList(t) {
    var S = site();
    if (!Array.isArray(S.home)) return t.order.map(function (id) { return { id: id, on: true }; });
    var seen = {}, out = S.home.filter(function (s) { if (!s || SEC_IDS.indexOf(s.id) < 0 || seen[s.id]) return false; seen[s.id] = 1; return true; });
    SEC_IDS.forEach(function (id) { if (!seen[id]) out.push({ id: id, on: true }); });
    return out;
  }
  function editHome() { var S = site(), t = tplOf(S.template); S.home = homeList(t).map(function (s) { return { id: s.id, on: s.on !== false }; }); return S.home; }
  function copyOf(t) {
    var F = facts(), dflt = t.copy(F, wsInfo());
    return { headline: cval('headline') || dflt[0], sub: cval('sub') || dflt[1], cta: cval('cta') || dflt[2], introTitle: cval('introTitle') || t.words.intro, intro: cval('intro') || introDefault(F, wsInfo()) };
  }

  /* =====================================================================
     COLOURS: each design applies the workspace brand its own way
     ===================================================================== */
  function hexOr(v, f) { return /^#[0-9a-f]{6}$/i.test(v || '') ? v.toUpperCase() : (/^#[0-9a-f]{3}$/i.test(v || '') ? C.rgbToHex(C.hexToRgb(v)) : f); }
  function brandCols() {
    var b = O.theme.current || (O.ws() && O.ws().brand) || {}, P = hexOr(b.primary, '#0B5D54'), A = hexOr(b.accent, P);
    var dk = hexOr(b.dark, null), deep = dk ? C.setL(dk, Math.min(C.rgbToHsl(C.hexToRgb(dk))[2], 0.2)) : C.setL(P, 0.17);
    return { P: P, A: A, deep: deep };
  }
  function vivid(c) { return C.chroma(c) > 0.05; }
  function palette(t) {
    var b = brandCols(), P = b.P, A = b.A, v;
    switch (t.id) {
      case 'urban':
        v = { bg: '#111315', alt: '#16191C', surf: '#1C2024', text: '#F2F1EE', muted: '#A3A9B0', line: '#2C3137', hl: '#FFFFFF', deep: '#0A0B0D' };
        var cands = [A, P, C.mix(P, '#FFFFFF', 0.35)].filter(function (c) { return vivid(c) && C.contrast(c, v.bg) >= 4.5; });
        v.acc = cands[0] || C.ensure(vivid(A) ? A : P, v.bg, 4.5); v.btn = v.acc; v.link = v.acc;
        break;
      case 'highland':
        v = { bg: '#F6F5F0', alt: C.mix('#E7EDE5', P, 0.08), surf: '#FFFFFF', text: '#1E2823', muted: '#56635B', line: '#DCE0D7', btn: P, acc: A };
        v.hl = C.ensure(C.mix('#1F3B2D', P, 0.35), v.bg, 7); v.deep = C.setL(C.mix('#1F3B2D', P, 0.3), 0.17);
        break;
      case 'heritage':
        v = { bg: '#FBF6EC', alt: C.mix('#F2E6D2', P, 0.05), surf: '#FFFDF7', text: '#2A1E16', muted: '#6B5B4E', line: '#E2D3BC', btn: P, acc: vivid(A) ? A : '#B5523B' };
        v.hl = C.ensure(C.mix('#4A1F14', P, 0.4), v.bg, 7); v.deep = C.setL(C.mix('#3B1F16', P, 0.3), 0.15);
        break;
      case 'minimal':
        v = { bg: '#FFFFFF', alt: '#F4F4F2', surf: '#FFFFFF', text: '#111111', muted: '#6A6A6A', line: '#E4E4E4', hl: '#111111', btn: '#111111', acc: P, deep: '#111111' };
        break;
      case 'editorial':
        v = { bg: '#F6F2EA', alt: '#EDE7DC', surf: '#FBF8F2', text: '#1A1917', muted: '#5D5852', line: '#D8D0C3', hl: '#151413' };
        v.deep = C.setL(b.deep, Math.min(C.rgbToHsl(C.hexToRgb(b.deep))[2], 0.2)); v.btn = v.deep; v.acc = C.ensure(P, v.bg, 4.5);
        break;
      case 'tropical':
        v = { bg: '#FFFCF4', alt: C.mix('#EEF4E6', P, 0.08), surf: '#FFFFFF', text: '#13261D', muted: '#53655B', line: '#DCE4D6', btn: P };
        v.deep = C.setL(C.mix('#0F3D2E', P, 0.35), 0.16); v.hl = C.ensure(C.mix('#0F3D2E', P, 0.3), v.bg, 7);
        v.acc = vivid(A) && C.lum(A) > 0.28 ? A : '#F3C74F';
        break;
      case 'family':
        v = { bg: '#FFFFFF', alt: C.mix('#FFFFFF', P, 0.07), surf: '#FFFFFF', text: '#1F2430', muted: '#5B6170', line: '#ECE9F1', btn: P };
        v.acc = vivid(A) ? A : '#FFB547'; v.hl = C.ensure(C.mix('#1F2430', P, 0.45), v.bg, 7); v.deep = C.setL(C.mix('#1F2430', P, 0.3), 0.18);
        break;
      default: /* coastal */
        v = { bg: '#FFFFFF', alt: C.mix('#F6F1E8', P, 0.05), surf: '#FFFFFF', text: '#1B2631', muted: '#566370', line: '#E7E2D9', btn: P, acc: vivid(A) ? A : C.mix(P, '#FFFFFF', 0.3) };
        v.hl = C.ensure(C.mix('#12304A', P, 0.3), v.bg, 7); v.deep = C.setL(C.mix('#0E2A3E', P, 0.25), 0.16);
    }
    v.hl = v.hl || v.text;
    v.link = v.link || C.ensure(P, v.bg, 4.5);
    v.btnInk = C.ink(v.btn); v.btnH = C.isDark(v.btn) ? C.mix(v.btn, '#000000', 0.18) : C.mix(v.btn, '#000000', 0.08);
    v.accInk = C.ink(v.acc); v.accText = C.ensure(v.acc, v.bg, 4.5);
    v.soft = C.mix(v.bg, P, C.isDark(v.bg) ? 0.16 : 0.09); v.soft2 = C.mix(v.bg, v.acc, 0.18);
    v.deepInk = C.ink(v.deep); v.deepMuted = C.mix(v.deepInk, v.deep, 0.32); v.deepLine = C.mix(v.deep, v.deepInk, 0.16);
    v.deepAcc = C.contrast(v.acc, v.deep) >= 3 ? v.acc : C.ensure(C.mix(P, '#FFFFFF', 0.5), v.deep, 3); v.deepAccInk = C.ink(v.deepAcc);
    v.P = P; v.A = A;
    var map = { bg: '--bg', alt: '--alt', surf: '--surf', text: '--text', muted: '--muted', line: '--line', hl: '--hl', btn: '--btn', btnInk: '--btn-ink', btnH: '--btn-h', link: '--link', acc: '--acc', accInk: '--acc-ink', accText: '--acc-text', soft: '--soft', soft2: '--soft2', deep: '--deep', deepInk: '--deep-ink', deepMuted: '--deep-muted', deepLine: '--deep-line', deepAcc: '--deep-acc', deepAccInk: '--deep-acc-ink', P: '--p', A: '--a' };
    v.css = Object.keys(map).map(function (k) { return map[k] + ':' + v[k]; }).join(';');
    return v;
  }

  /* =====================================================================
     ILLUSTRATIONS (no external images: drawn in SVG, tinted with the brand)
     ===================================================================== */
  function scene(kind, seed, V) {
    var r = D.rng(D.hash(kind + ':' + (seed || 0))), id = 'wsg' + (++gid), s = '', i;
    var P = (V && V.P) || '#0B5D54', A = (V && V.A) || '#C9A227';
    function sky(a, b) { return '<defs><linearGradient id="' + id + 's" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient><linearGradient id="' + id + 'w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3E95BF"/><stop offset="1" stop-color="#1F5F86"/></linearGradient></defs><rect width="400" height="300" fill="url(#' + id + 's)"/>'; }
    function clouds(hero) { var c = ''; for (var k = 0; k < (hero ? 2 : 3); k++) { var x = hero ? (k ? 300 + r() * 60 : 24 + r() * 50) : 30 + r() * 320, y = hero ? 84 + r() * 22 : 25 + r() * 50; c += '<g fill="#FFFFFF" opacity="0.75"><ellipse cx="' + x + '" cy="' + y + '" rx="26" ry="8"/><ellipse cx="' + (x + 14) + '" cy="' + (y - 6) + '" rx="16" ry="9"/></g>'; } return c; }
    function palm(x, y, flip, sc) {
      return '<g transform="translate(' + x + ',' + y + ') scale(' + ((flip ? -1 : 1) * (sc || 1)) + ',' + (sc || 1) + ')"><path d="M0 0 C6 -40 2 -80 14 -120" stroke="#6B4F2A" stroke-width="6" fill="none" stroke-linecap="round"/>' +
        '<g fill="#2F6B3A"><path d="M14 -120 C40 -132 62 -122 74 -104 C52 -116 34 -116 14 -120Z"/><path d="M14 -120 C-10 -136 -34 -128 -44 -110 C-22 -120 -4 -120 14 -120Z"/><path d="M14 -120 C30 -146 52 -152 66 -146 C46 -140 30 -132 14 -120Z"/><path d="M14 -120 C2 -148 -18 -156 -32 -150 C-14 -142 2 -134 14 -120Z"/><path d="M14 -120 C34 -112 44 -92 44 -74 C34 -96 24 -108 14 -120Z"/></g></g>';
    }
    function towers(x0, n, base, col, win) {
      var t = '';
      for (var k = 0; k < n; k++) {
        var w = 26 + r() * 22, h = 70 + r() * 110, x = x0 + k * (w + 4);
        t += '<rect x="' + x + '" y="' + (base - h) + '" width="' + w + '" height="' + h + '" fill="' + col + '"/>';
        if (win) for (var yy = base - h + 8; yy < base - 6; yy += 10) for (var xx = x + 5; xx < x + w - 5; xx += 8) if (r() > 0.35) t += '<rect x="' + xx + '" y="' + yy + '" width="4" height="5" fill="' + win + '"/>';
      }
      return t;
    }
    function room(wall, floor) { return '<rect width="400" height="300" fill="' + wall + '"/><rect y="228" width="400" height="72" fill="' + floor + '"/><rect y="226" width="400" height="4" fill="rgba(0,0,0,0.08)"/>'; }
    function windowView(x, y, w, h) { return '<rect x="' + (x - 6) + '" y="' + (y - 6) + '" width="' + (w + 12) + '" height="' + (h + 12) + '" fill="#FFFFFF"/><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="#A9D3EE"/><rect x="' + x + '" y="' + (y + h * 0.62) + '" width="' + w + '" height="' + (h * 0.38) + '" fill="#7FA8C4"/><path d="M' + (x + w / 2) + ' ' + y + 'V' + (y + h) + 'M' + x + ' ' + (y + h / 2) + 'H' + (x + w) + '" stroke="#FFFFFF" stroke-width="4"/>'; }
    function plant(x, y) { return '<rect x="' + (x - 10) + '" y="' + (y - 22) + '" width="20" height="22" rx="3" fill="#C9B79C"/><g fill="#4E7D46"><ellipse cx="' + x + '" cy="' + (y - 40) + '" rx="9" ry="20"/><ellipse cx="' + (x - 12) + '" cy="' + (y - 34) + '" rx="7" ry="16" transform="rotate(-30 ' + (x - 12) + ' ' + (y - 34) + ')"/><ellipse cx="' + (x + 12) + '" cy="' + (y - 34) + '" rx="7" ry="16" transform="rotate(30 ' + (x + 12) + ' ' + (y - 34) + ')"/></g>'; }
    function leaf(x, y, rot, len, col) { return '<g transform="translate(' + x + ',' + y + ') rotate(' + rot + ') scale(' + len / 120 + ')"><path d="M0 0 C30 -46 92 -44 120 0 C92 44 30 46 0 0Z" fill="' + col + '"/><path d="M4 0 H116" stroke="rgba(0,0,0,0.18)" stroke-width="3"/>' + [24, 44, 64, 84].map(function (q) { return '<path d="M' + q + ' 0 L' + (q + 14) + ' -20 M' + q + ' 0 L' + (q + 14) + ' 20" stroke="rgba(0,0,0,0.14)" stroke-width="2.5"/>'; }).join('') + '</g>'; }
    switch (kind) {
      case 'sea': case 'marina':
        var hero = /hero/.test(String(seed));
        s += sky('#7EC3E8', '#DDF0FA') + '<circle cx="' + (hero ? 318 + r() * 30 : 250 + r() * 90) + '" cy="' + (hero ? 104 : 62) + '" r="24" fill="#FFF3D1"/>' + clouds(hero);
        s += '<path d="M0 170 L60 150 L120 162 L190 142 L260 160 L320 148 L400 166 V180 H0Z" fill="#8DB3A8"/>';
        if (kind === 'marina' || (!hero && r() > 0.4)) s += towers(r() > 0.5 ? 6 : 250, 4, 182, '#E8EDF1', '#B8C6D2');
        s += '<rect y="178" width="400" height="80" fill="url(#' + id + 'w)"/>';
        for (i = 0; i < 9; i++) s += '<rect x="' + (hero ? (i % 2 ? 4 + r() * 90 : 300 + r() * 80) : r() * 380) + '" y="' + (186 + r() * 60) + '" width="' + (10 + r() * 26) + '" height="2" rx="1" fill="#FFFFFF" opacity="' + (hero ? 0.4 : 0.55) + '"/>';
        if (kind === 'marina') { s += '<rect y="240" width="400" height="60" fill="#D9D2C3"/>'; for (i = 0; i < 4; i++) { var bx = 30 + i * 90; s += '<path d="M' + bx + ' 236 h50 l-8 10 h-36z" fill="#FFFFFF"/><path d="M' + (bx + 24) + ' 236 V196 L' + (bx + 44) + ' 230Z" fill="' + (i % 2 ? '#F4F1EA' : C.mix('#FFFFFF', P, 0.25)) + '"/>'; } }
        else { s += '<path d="M0 238 C80 228 160 246 240 236 C300 230 360 240 400 236 V300 H0Z" fill="#EED9AE"/>'; var ux = hero ? 300 + r() * 30 : 120 + r() * 140; s += '<path d="M' + ux + ' 262 V226" stroke="#6B5A49" stroke-width="2.5"/><path d="M' + (ux - 30) + ' 230 Q' + ux + ' 206 ' + (ux + 30) + ' 230Z" fill="' + P + '"/><path d="M' + (ux - 10) + ' 229 Q' + ux + ' 207 ' + (ux + 10) + ' 229Z" fill="' + C.mix(P, '#FFFFFF', 0.6) + '"/><rect x="' + (ux + 8) + '" y="256" width="34" height="6" rx="2" fill="#FFFFFF"/>' + palm(hero || r() > 0.5 ? 60 : 340, 286, r() > 0.5); }
        break;
      case 'city': case 'night':
        var night = kind === 'night';
        s += sky(night ? '#1B2A44' : '#F6C9A3', night ? '#3E5682' : '#A8C8E8');
        if (night) for (i = 0; i < 18; i++) s += '<circle cx="' + (r() * 400) + '" cy="' + (r() * 110) + '" r="' + (0.6 + r()) + '" fill="#FFFFFF" opacity="0.8"/>';
        else s += '<circle cx="320" cy="96" r="30" fill="#FFE2B8" opacity="0.9"/>';
        s += towers(0, 12, 250, night ? '#2B3B58' : '#8EA3BA', null);
        var tx = 170 + r() * 40, tc = night ? '#53698C' : '#5D7088';
        [0, 46].forEach(function (o) { s += '<path d="M' + (tx + o) + ' 250 V100 L' + (tx + o + 6) + ' 84 L' + (tx + o + 12) + ' 70 L' + (tx + o + 18) + ' 84 L' + (tx + o + 24) + ' 100 V250Z" fill="' + tc + '"/><path d="M' + (tx + o + 12) + ' 70 V36" stroke="' + tc + '" stroke-width="2.5"/>'; });
        s += '<rect x="' + (tx + 24) + '" y="150" width="22" height="5" fill="' + tc + '"/>';
        s += towers(10, 9, 300, night ? '#16213A' : '#3E5266', night ? '#F5D58A' : '#C8D6E4');
        break;
      case 'pool':
        s += sky('#86C5EA', '#E4F2FB') + clouds() + towers(0, 11, 196, '#9AAEC2', '#D6E0EA');
        s += '<rect y="196" width="400" height="104" fill="#E9E3D7"/><rect x="40" y="214" width="320" height="58" rx="6" fill="#3FB1D0"/><rect x="40" y="214" width="320" height="10" rx="4" fill="#7FD3E8"/>';
        for (i = 0; i < 3; i++) s += '<g transform="translate(' + (70 + i * 110) + ',282)"><rect width="60" height="8" rx="3" fill="#FFFFFF"/><rect x="40" y="-14" width="22" height="8" rx="3" fill="#FFFFFF" transform="rotate(-24 40 -6)"/><rect x="6" y="-3" width="40" height="5" rx="2" fill="' + (i === 1 ? A : P) + '" opacity="0.85"/></g>';
        s += palm(372, 238, true, 0.8) + plant(20, 230);
        break;
      case 'hills':
        var hh = /hero/.test(String(seed));
        s += sky('#CFE6EF', '#F3F8F5') + '<circle cx="' + (hh ? 120 : 90) + '" cy="' + (hh ? 104 : 70) + '" r="22" fill="#FFF8E6"/>';
        s += '<path d="M0 150 C60 110 120 120 180 96 C240 74 300 104 400 92 V300 H0Z" fill="#9DBAB0"/>';
        s += '<path d="M0 190 C80 150 160 170 230 140 C300 112 350 150 400 140 V300 H0Z" fill="#6E9A6A"/>';
        [[18, 176], [30, 172], [44, 170], [342, 146], [356, 142], [370, 144], [384, 141]].forEach(function (q, k) { var th = 16 + (k % 3) * 5; s += '<path d="M' + q[0] + ' ' + q[1] + ' l-' + th / 3 + ' 0 l' + th / 3 + ' -' + th + ' l' + th / 3 + ' ' + th + 'z" fill="#3E6B4A"/>'; });
        s += '<path d="M0 240 C90 200 200 220 280 190 C330 172 370 188 400 184 V300 H0Z" fill="#4E7D46"/>';
        for (i = 0; i < 7; i++) s += '<path d="M0 ' + (250 + i * 9) + ' C90 ' + (212 + i * 9) + ' 200 ' + (232 + i * 9) + ' 280 ' + (202 + i * 9) + ' C330 ' + (184 + i * 9) + ' 370 ' + (200 + i * 9) + ' 400 ' + (196 + i * 9) + '" stroke="#3B6634" stroke-width="3" fill="none" opacity="0.45"/>';
        s += '<g transform="translate(' + (250 + r() * 60) + ',' + (hh ? 160 : 150) + ') scale(' + (hh ? 0.62 : 1) + ')"><rect width="56" height="32" fill="#F1E7D6"/><path d="M-6 0 L28 -20 L62 0Z" fill="' + C.mix('#8A4B2F', P, 0.3) + '"/><rect x="8" y="10" width="10" height="10" fill="#7FA8C4"/><rect x="36" y="14" width="10" height="18" fill="#6B4F2A"/></g>';
        s += '<path d="M0 128 C90 118 190 138 290 124 C340 118 380 122 400 120 V140 C330 150 240 136 150 148 C90 154 40 146 0 150Z" fill="#FFFFFF" opacity="0.3"/>';
        break;
      case 'heritage':
        var walls = ['#F2D7A6', '#B9DCCF', '#F3C1B5', '#D7E3F1', '#EAD9F0'];
        s += sky('#BFE0F2', '#EAF5FB');
        for (i = 0; i < 3; i++) {
          var hx = -20 + i * 150, wc = walls[(D.hash(kind + seed) + i) % walls.length];
          s += '<rect x="' + hx + '" y="70" width="146" height="230" fill="' + wc + '"/><rect x="' + (hx - 4) + '" y="60" width="154" height="14" fill="#B5523B"/>';
          for (var w2 = 0; w2 < 3; w2++) { var wx = hx + 16 + w2 * 42; s += '<rect x="' + wx + '" y="92" width="26" height="54" rx="13" fill="#FFFFFF" opacity="0.7"/><rect x="' + (wx - 8) + '" y="94" width="8" height="52" fill="' + (i === 1 ? P : '#3F7A5A') + '"/><rect x="' + (wx + 26) + '" y="94" width="8" height="52" fill="' + (i === 1 ? P : '#3F7A5A') + '"/>'; }
          s += '<rect x="' + hx + '" y="170" width="146" height="8" fill="rgba(0,0,0,0.12)"/>';
          for (var a2 = 0; a2 < 2; a2++) s += '<path d="M' + (hx + 14 + a2 * 66) + ' 300 V222 a26 26 0 0 1 52 0 V300Z" fill="rgba(0,0,0,0.18)"/>';
          s += '<circle cx="' + (hx + 73) + '" cy="196" r="8" fill="#C8102E"/><rect x="' + (hx + 71) + '" y="184" width="4" height="5" fill="#8A6A16"/>';
        }
        break;
      case 'river':
        s += sky('#A7D6F0', '#EEF7FC') + clouds();
        var cols = ['#E8A87C', '#F3D27A', '#9CC8B5', '#E57F6E', '#F2EFE6', '#C9B2D9'];
        for (i = 0; i < 8; i++) { var rx = i * 52 - 6, rh = 80 + r() * 40; s += '<rect x="' + rx + '" y="' + (190 - rh) + '" width="52" height="' + rh + '" fill="' + cols[i % cols.length] + '"/><rect x="' + (rx - 2) + '" y="' + (184 - rh) + '" width="56" height="8" fill="#9A4A32"/><rect x="' + (rx + 12) + '" y="' + (204 - rh) + '" width="10" height="16" fill="#FFFFFF" opacity="0.7"/><rect x="' + (rx + 30) + '" y="' + (204 - rh) + '" width="10" height="16" fill="#FFFFFF" opacity="0.7"/>'; }
        s += '<rect y="188" width="400" height="10" fill="#B9A88E"/><rect y="198" width="400" height="102" fill="#4C8FA8"/>';
        for (i = 0; i < 10; i++) s += '<rect x="' + (r() * 380) + '" y="' + (205 + r() * 80) + '" width="' + (12 + r() * 30) + '" height="2" fill="#FFFFFF" opacity="0.4"/>';
        s += '<path d="M150 250 h90 l-12 14 h-66z" fill="#7A4A2A"/><rect x="176" y="236" width="38" height="14" fill="#F2EFE6"/>';
        break;
      case 'garden':
        s += sky('#B7DDF0', '#EFF8F2') + clouds();
        s += '<rect y="200" width="400" height="100" fill="#7DB36A"/>';
        s += '<g transform="translate(120,110)"><rect width="170" height="96" fill="#F5EFE4"/><path d="M-12 0 L85 -46 L182 0Z" fill="' + C.mix('#6E6A64', P, 0.35) + '"/><rect x="18" y="24" width="34" height="30" fill="#7FA8C4"/><rect x="118" y="24" width="34" height="30" fill="#7FA8C4"/><rect x="72" y="44" width="28" height="52" fill="' + C.mix('#8C6A48', A, 0.3) + '"/></g>';
        for (i = 0; i < 5; i++) { var gx = i < 2 ? 20 + i * 50 : 300 + (i - 2) * 40; s += '<rect x="' + (gx - 3) + '" y="170" width="6" height="40" fill="#6B4F2A"/><circle cx="' + gx + '" cy="160" r="' + (22 + r() * 10) + '" fill="#3F7A45"/>'; }
        s += '<path d="M190 300 L200 206 L212 206 L230 300Z" fill="#E6DCC8"/>';
        s += '<g transform="translate(70,262)"><circle r="9" fill="' + A + '"/><circle cx="16" cy="4" r="6" fill="' + C.mix('#FFFFFF', P, 0.5) + '"/></g>';
        break;
      case 'bed':
        s += room('#E9E4DD', '#B9987A') + '<rect x="250" y="40" width="80" height="60" fill="#FFFFFF"/><rect x="256" y="46" width="68" height="48" fill="#C9D8C3"/><circle cx="290" cy="70" r="12" fill="#E7B98A"/>';
        s += '<rect x="60" y="120" width="230" height="70" rx="6" fill="#8C7B6B"/><rect x="50" y="176" width="250" height="60" rx="6" fill="#FAFAF7"/><rect x="50" y="200" width="250" height="36" rx="4" fill="' + C.mix('#C9CED6', P, 0.45) + '"/><rect x="80" y="160" width="70" height="26" rx="10" fill="#FFFFFF"/><rect x="190" y="160" width="70" height="26" rx="10" fill="#FFFFFF"/>';
        s += '<rect x="316" y="186" width="44" height="44" fill="#A88B6E"/><path d="M326 186 L338 150 L350 186Z" fill="#F6E3B4"/><rect x="336" y="150" width="4" height="8" fill="#6B5A49"/>';
        break;
      case 'kitchen':
        s += room('#F2F0EC', '#C7B299') + '<rect x="0" y="40" width="400" height="60" fill="#DCE3E8"/>';
        for (i = 0; i < 6; i++) s += '<rect x="' + (8 + i * 66) + '" y="46" width="58" height="48" rx="3" fill="#E9EEF1"/>';
        s += '<rect y="150" width="400" height="80" fill="' + C.mix('#DCE3E8', P, 0.25) + '"/><rect y="142" width="400" height="10" fill="#F7F7F5"/>';
        for (i = 0; i < 12; i++) s += '<rect x="' + (i * 34) + '" y="104" width="32" height="36" fill="#FFFFFF" stroke="#E4E0D8"/>';
        for (i = 0; i < 3; i++) s += '<path d="M' + (110 + i * 90) + ' 0 V20" stroke="#55606E" stroke-width="2"/><path d="M' + (98 + i * 90) + ' 30 a12 12 0 0 1 24 0Z" fill="#2E3A48"/>';
        s += '<rect x="70" y="232" width="8" height="56" fill="#6B4F2A"/><rect x="58" y="226" width="32" height="8" rx="3" fill="#2E3A48"/><rect x="300" y="232" width="8" height="56" fill="#6B4F2A"/><rect x="288" y="226" width="32" height="8" rx="3" fill="#2E3A48"/>' + plant(200, 142);
        break;
      case 'bath':
        s += '<rect width="400" height="300" fill="#EEF1F3"/>';
        for (i = 0; i < 10; i++) for (var j2 = 0; j2 < 8; j2++) s += '<rect x="' + (i * 40) + '" y="' + (j2 * 38) + '" width="40" height="38" fill="none" stroke="#DDE2E6"/>';
        s += '<rect x="140" y="40" width="120" height="96" rx="48" fill="#CFE0EA" stroke="#B9A88E" stroke-width="4"/><rect x="110" y="170" width="180" height="60" rx="6" fill="#B9A88E"/><ellipse cx="200" cy="172" rx="56" ry="10" fill="#FFFFFF"/><rect x="196" y="148" width="6" height="18" fill="#8A94A3"/>';
        s += '<rect x="310" y="120" width="40" height="80" rx="4" fill="#FFFFFF"/><rect x="310" y="140" width="40" height="6" fill="' + C.mix('#C9CED6', P, 0.5) + '"/>' + plant(70, 230);
        break;
      case 'abstract': /* architectural composition for the minimal design */
        var tint = C.mix('#F1F0EC', P, 0.06);
        s += '<rect width="400" height="300" fill="' + tint + '"/><rect y="236" width="400" height="64" fill="#E2E0DA"/>';
        s += '<rect x="14" y="40" width="104" height="196" fill="#FFFFFF"/><rect x="34" y="70" width="64" height="84" fill="none" stroke="#1A1A1A" stroke-width="2"/><path d="M40 146 L58 120 L70 134 L78 126 L92 146Z" fill="' + C.mix('#C9CED6', P, 0.35) + '"/>';
        s += '<path d="M136 236 V130 a64 64 0 0 1 128 0 V236Z" fill="' + P + '"/><path d="M156 236 V136 a44 44 0 0 1 88 0 V236Z" fill="' + C.mix(P, '#FFFFFF', 0.25) + '"/>';
        s += '<circle cx="' + (236 + r() * 14) + '" cy="42" r="17" fill="' + (vivid(A) ? C.mix(A, '#FFFFFF', 0.2) : '#E9C46A') + '"/>';
        s += '<g fill="#1A1A1A"><rect x="300" y="176" width="5" height="60"/><rect x="290" y="170" width="44" height="7"/><rect x="320" y="176" width="5" height="60"/></g>';
        s += '<rect x="356" y="196" width="18" height="40" fill="#C9B79C"/><ellipse cx="365" cy="182" rx="12" ry="20" fill="#5E7E55"/>';
        break;
      case 'leaves': /* lush pattern for deep green sections */
        var dg = (V && V.deep) || '#0F3D2E';
        s += '<rect width="400" height="300" fill="' + dg + '"/>';
        var lc = [C.mix(dg, '#3E8E5E', 0.55), C.mix(dg, '#2F7A4F', 0.4), C.mix(dg, '#5FA66F', 0.35), C.mix(dg, P, 0.35)];
        for (i = 0; i < 16; i++) { var edge = i % 4, lx = edge === 0 ? -10 + r() * 40 : edge === 1 ? 360 + r() * 50 : r() * 400, ly = edge === 2 ? -10 + r() * 40 : edge === 3 ? 260 + r() * 50 : r() * 300; s += leaf(lx, ly, r() * 360, 70 + r() * 90, lc[i % lc.length]); }
        break;
      case 'house': /* placeholder before the operator adds properties */
        s += '<rect width="400" height="300" fill="' + C.mix('#F4F2EE', P, 0.1) + '"/><circle cx="310" cy="70" r="26" fill="' + C.mix('#FFFFFF', vivid(A) ? A : P, 0.35) + '"/>';
        s += '<path d="M0 230 C90 200 190 214 260 198 C320 186 360 196 400 192 V300 H0Z" fill="' + C.mix('#E7E3DA', P, 0.18) + '"/>';
        s += '<g transform="translate(140,108)"><path d="M-14 62 L60 4 L134 62" fill="none" stroke="' + C.mix(P, '#000000', 0.1) + '" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/><rect x="6" y="56" width="108" height="86" rx="4" fill="#FFFFFF"/><rect x="48" y="92" width="26" height="50" rx="3" fill="' + P + '"/><rect x="18" y="74" width="22" height="22" rx="3" fill="' + C.mix('#FFFFFF', P, 0.3) + '"/><rect x="82" y="74" width="22" height="22" rx="3" fill="' + C.mix('#FFFFFF', P, 0.3) + '"/></g>';
        break;
      default: /* living room */
        var sofa = [P, C.mix(P, '#55606E', 0.4), '#6F8794', C.mix(A, '#8A6A3A', 0.5)][D.hash(kind + seed) % 4];
        s += room('#EFE7DC', '#C9A97E') + windowView(36, 52, 110, 120) + '<rect x="210" y="60" width="90" height="62" fill="#FFFFFF" stroke="#2E3A48" stroke-width="4"/><path d="M216 112 L246 82 L268 102 L280 92 L294 112Z" fill="#8DB3A8"/>';
        s += '<rect x="170" y="160" width="190" height="54" rx="12" fill="' + sofa + '"/><rect x="160" y="190" width="210" height="44" rx="10" fill="' + sofa + '"/><rect x="186" y="170" width="40" height="30" rx="8" fill="#F2EFE6"/><rect x="300" y="170" width="40" height="30" rx="8" fill="' + (vivid(A) ? A : '#E8C66A') + '"/>';
        s += '<ellipse cx="200" cy="268" rx="150" ry="20" fill="#E6DCC8"/><rect x="60" y="234" width="80" height="10" rx="3" fill="#6B4F2A"/><rect x="66" y="244" width="6" height="22" fill="#6B4F2A"/><rect x="128" y="244" width="6" height="22" fill="#6B4F2A"/>' + plant(380, 236);
    }
    return '<svg class="w-scene" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + s + '</svg>';
  }
  /* Peranakan tile strip (heritage design) */
  function tiles(V, h) {
    var id = 'wst' + (++gid), P = V.P, A = V.acc, T = '#B5523B', cream = '#FFF8EC';
    var cell = '<rect width="40" height="40" fill="' + cream + '"/><g transform="translate(20 20)">' + [0, 90, 180, 270].map(function (a) { return '<ellipse cx="0" cy="-9" rx="5.5" ry="9" fill="' + P + '" transform="rotate(' + a + ')"/>'; }).join('') + [45, 135, 225, 315].map(function (a) { return '<ellipse cx="0" cy="-10" rx="3" ry="6" fill="' + A + '" transform="rotate(' + a + ')"/>'; }).join('') + '<circle r="3.6" fill="' + T + '"/></g>' +
      '<path d="M0 0 h10 a10 10 0 0 1 -10 10Z M40 0 v10 a10 10 0 0 1 -10 -10Z M0 40 v-10 a10 10 0 0 1 10 10Z M40 40 h-10 a10 10 0 0 1 10 -10Z" fill="' + T + '" opacity="0.85"/><rect x="0.5" y="0.5" width="39" height="39" fill="none" stroke="' + C.mix(cream, P, 0.3) + '"/>';
    return '<svg class="w-tiles" style="height:' + (h || 28) + 'px" preserveAspectRatio="none" aria-hidden="true"><defs><pattern id="' + id + '" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="scale(' + ((h || 28) / 40) + ')">' + cell + '</pattern></defs><rect width="100%" height="100%" fill="url(#' + id + ')"/></svg>';
  }
  var ROOMS = ['living', 'bed', 'kitchen', 'bath'];
  function photo(X, x, n, cls) {
    var ph = x && x.photos && x.photos.length ? x.photos[(n || 0) % x.photos.length] : null;
    var alt = x ? x.name + (n ? ', photo ' + (n + 1) : '') : 'Photo';
    if (ph) return '<div class="w-img ' + (cls || '') + '"><img src="' + esc(ph) + '" alt="' + esc(alt) + '" decoding="async"></div>';
    var k = !x || x.placeholder ? (x && x.scene) || 'house' : n ? ROOMS[(n - 1) % 4] : x.scene;
    return '<div class="w-img is-art ' + (cls || '') + '" role="img" aria-label="' + esc(alt) + '">' + scene(k, (x ? x.id : 'none') + ':' + (n || 0), X.V) + '</div>';
  }
  function art(X, kind, seed, cls, alt) { return '<div class="w-img is-art ' + (cls || '') + '" role="img" aria-label="' + esc(alt || '') + '">' + scene(kind, seed, X.V) + '</div>'; }
  /* the hero image: the first featured home with photos, else the design's own scene */
  function heroImg(X, cls, n) {
    var withPh = X.feat.filter(function (x) { return x.photos && x.photos.length; });
    if (withPh.length) { var x = withPh[(n || 0) % withPh.length]; return photo(X, x, n >= withPh.length ? 1 : 0, cls); }
    return art(X, n ? (n === 1 ? (X.feat[1] && !X.feat[1].placeholder ? X.feat[1].scene : 'living') : 'bed') : X.t.scene, X.t.id + (n ? n : ':hero'), cls, 'Photo');
  }

  /* map of Peninsular Malaysia with a pin per destination (east Malaysia is listed beside the map) */
  var MAP_PATH = 'M36,7 L60,20 L95,30 L120,28 L140,36 L156,42 L185,70 L210,105 L218,150 L222,210 L238,260 L252,308 L270,350 L276,371 L250,384 L234,386 L222,372 L200,350 L159,322 L132,301 L108,266 L92,230 L84,196 L60,182 L54,140 L48,110 L46,80 L46,49 L36,30 Z';
  function pinXY(g) { return [Math.round(64.6 * g[1] - 6443), Math.round(468.9 - 68.9 * g[0])]; }
  function mapSVG(X) {
    var pins = X.F.cities.filter(function (c) { return c.geo; });
    return '<svg class="w-map" viewBox="-60 -10 400 410" role="img" aria-label="Map of Peninsular Malaysia' + (pins.length ? ' with ' + plural(pins.length, 'destination') : '') + '"><path d="' + MAP_PATH + '" class="m-land"/><ellipse cx="32" cy="98" rx="6" ry="8" class="m-land"/><ellipse cx="6" cy="34" rx="9" ry="7" class="m-land"/>' +
      pins.map(function (c) { var p = pinXY(c.geo), right = p[0] < 150; return '<g class="m-pin"><circle cx="' + p[0] + '" cy="' + p[1] + '" r="15" class="m-halo"/><circle cx="' + p[0] + '" cy="' + p[1] + '" r="6.5" class="m-dot"/><text x="' + (p[0] + (right ? -20 : 20)) + '" y="' + (p[1] + 5) + '" text-anchor="' + (right ? 'end' : 'start') + '">' + esc(shortCity(c.name)) + '</text></g>'; }).join('') + '</svg>';
  }

  /* small icons that core does not have */
  var ICX = {
    snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9 4l3 2 3-2M9 20l3-2 3 2"/>',
    bed: '<path d="M3 19V6M3 14h18v5M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.6"/>',
    pan: '<circle cx="10" cy="13" r="6"/><path d="M16 13h6"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="0.6"/>',
    facebook: '<path d="M14.5 3H13a4 4 0 0 0-4 4v3H6.5v3.5H9V21h3.5v-7.5H15l.5-3.5h-3V7.5a1 1 0 0 1 1-1h1z"/>',
    tiktok: '<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.6 2.7 2.4 4.4 5 4.6"/>',
    quote: '<path d="M6 17c-2 0-3-1.5-3-3.5C3 9 6 6 9 5l.6 1.4C7.7 7.4 6.6 9 6.5 10.5 8.2 10.4 9.5 11.6 9.5 13.5S8 17 6 17zm9 0c-2 0-3-1.5-3-3.5 0-4.5 3-7.5 6-8.5l.6 1.4c-1.9 1-3 2.6-3.1 4.1 1.7-.1 3 1.1 3 3S17 17 15 17z" fill="currentColor" stroke="none"/>'
  };
  function ic(name) { return ICX[name] ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICX[name] + '</svg>' : O.icon(name); }

  /* =====================================================================
     SITE RENDERER
     ===================================================================== */
  var PH_NAMES = ['Your first home', 'Your second home', 'Your third home'];
  function placeholders(t) {
    var sc = [t.scene === 'abstract' ? 'house' : t.scene, 'house', 'living'];
    return PH_NAMES.map(function (n, i) { return { placeholder: true, id: 'ph' + i, name: n, short: n, city: 'Your city', area: 'Area, city', type: 'Bedrooms', beds: 2, sleeps: 4, from: null, rating: null, nReviews: 0, scene: sc[i], photos: [] }; });
  }
  function ctxFor(t, page, opts) {
    var F = facts(), S = site();
    var feat = S.featured.map(function (id) { return F.byId[id]; }).filter(Boolean);
    if (!feat.length) feat = F.props.slice(0, 6);
    var empty = !F.props.length;
    if (empty) feat = placeholders(t);
    var pid = (opts && opts.pid) || (F.byId[S.propertyId] ? S.propertyId : (feat[0] && !empty ? feat[0].id : null));
    return { t: t, page: page, F: F, ws: wsInfo(), copy: copyOf(t), feat: feat, opts: opts || {}, V: palette(t), pid: pid, empty: empty };
  }
  function btn(label, cls, attrs) { return '<button type="button" class="w-btn ' + (cls || '') + '" ' + (attrs || '') + '>' + label + '</button>'; }
  function waBtn(label, cls) { return '<a class="w-btn ' + (cls || '') + '" href="' + esc(waHref()) + '" target="_blank" rel="noopener">' + ic('whatsapp') + '<span>' + esc(label) + '</span></a>'; }
  function eyebrow(t) { return '<div class="w-eyebrow">' + esc(t) + '</div>'; }
  function head2(eb, title, lead, center) { return '<div class="w-head' + (center ? ' c' : '') + '">' + (eb ? eyebrow(eb) : '') + '<h2 class="w-h2">' + esc(title) + '</h2>' + (lead ? '<p class="w-lead">' + esc(lead) + '</p>' : '') + '</div>'; }
  function rating(x) { return x.rating ? '<span class="w-rate">★ ' + x.rating.toFixed(2) + ' <span>(' + x.nReviews + ')</span></span>' : '<span class="w-rate w-new">New</span>'; }
  function bedsTxt(x) { return x.beds ? plural(x.beds, 'bedroom') : 'Studio'; }
  function facts1(x) { return x.placeholder ? 'Bedrooms · sleeps' : esc(bedsTxt(x)) + ' · sleeps ' + x.sleeps; }
  function priceLine(x, cls) { return x.from == null && !x.placeholder ? '<span class="w-price ' + (cls || '') + '">Ask us for rates</span>' : '<span class="w-price ' + (cls || '') + '">from <b>' + rm(x.from) + '</b> / night</span>'; }
  function unitAttr(x) { return x.placeholder ? 'data-wact="addprops"' : 'data-wpid="' + esc(x.id) + '"'; }
  function logo(X, onBg) {
    var ws = X.ws;
    if (ws.logo) return '<span class="w-logo">' + O.theme.logoHTML(ws.raw, onBg) + '</span>';
    return '<span class="w-logo"><span class="w-mono">' + esc(fmt.initials(ws.name)) + '</span></span>';
  }
  function nav(X) {
    var p = X.page;
    return '<button type="button" data-wnav="home"' + (p === 'home' ? ' class="on"' : '') + '>Home</button><button type="button" data-wnav="home" data-anchor="units"' + (p === 'property' ? ' class="on"' : '') + '>Stays</button><button type="button" data-wnav="about"' + (p === 'about' ? ' class="on"' : '') + '>About</button><button type="button" data-wnav="home" data-anchor="book">Contact</button>';
  }
  function header(X) {
    var t = X.t, ws = X.ws, kind = t.header;
    if (kind === 'overlay' && X.page !== 'home') kind = 'bar';
    var onBg = kind === 'dark' ? X.V.bg : kind === 'overlay' ? '#333333' : X.V.bg;
    var brand = '<button type="button" class="w-brand" data-wnav="home">' + logo(X, onBg) + '<span class="w-bname">' + esc(ws.name) + '</span></button>';
    var menu = '<button type="button" class="w-menu" data-wact="menu" aria-label="Open site menu">' + O.icon('menu') + '</button>';
    if (kind === 'center') return '<header class="w-header hd-center"><div class="w-wrap"><div class="hd-top"><span class="hd-meta">' + esc(X.F.cities.slice(0, 4).map(function (c) { return shortCity(c.name); }).join(' · ') || 'Holiday homes in Malaysia') + '</span>' + brand + '<span class="hd-meta r">' + esc(ws.phone) + '</span>' + menu + '</div><nav class="w-nav" aria-label="Site">' + nav(X) + '</nav></div></header>';
    return '<header class="w-header hd-' + kind + '"><div class="w-wrap hd-in">' + brand + '<nav class="w-nav" aria-label="Site">' + nav(X) + '</nav>' + btn('Book direct', 'sm hd-book', 'data-wact="book"') + menu + '</div></header>';
  }
  function renderSite(t, page, opts) {
    opts = opts || {};
    var X = ctxFor(t, page, opts), body;
    if (page === 'property') body = propertyPage(X);
    else if (page === 'about') body = aboutPage(X);
    else {
      var list = [{ id: 'hero', on: true }].concat(homeList(t).filter(function (s) { return s.on !== false; }));
      if (opts.limit) list = list.slice(0, opts.limit);
      body = list.map(function (s) { return section(X, s.id); }).join('');
    }
    return '<div class="wbs t-' + t.id + ' pg-' + page + (X.empty ? ' is-empty' : '') + '" style="' + X.V.css + '">' + header(X) + '<main class="w-main">' + body + '</main>' + (opts.limit ? '' : footer(X)) + '</div>';
  }
  function section(X, id) {
    var v = X.t.v;
    try {
      if (id === 'hero') return HERO[X.t.id](X);
      if (id === 'intro') return INTRO[v.intro](X);
      if (id === 'units') return UNITS[v.units](X);
      if (id === 'amenities') return AMEN[v.amenities](X);
      if (id === 'reviews') return REV[v.reviews](X);
      if (id === 'location') return LOC[v.location](X);
      if (id === 'book') return BOOK[v.book](X);
    } catch (e) { console.warn('website section ' + id, e); }
    return '';
  }
  function sec(id, cls, inner) { return '<section class="w-sec s-' + id + ' ' + (cls || '') + '" data-wsec="' + id + '">' + inner + '</section>'; }

  /* ---------------- shared bits ---------------- */
  function searchBar(X) {
    var a = d.add(D.TODAY, 3), b = d.add(D.TODAY, 5), where = X.F.cities.slice(0, 3).map(function (c) { return shortCity(c.name); }).join(', ') || 'Anywhere';
    return '<div class="w-search"><div class="sf" data-wact="search"><label>Where</label><b>' + esc(where) + '</b></div><div class="sf" data-wact="search"><label>Check in</label><b>' + esc(d.dowName(a) + ' ' + d.fmt(a)) + '</b></div><div class="sf" data-wact="search"><label>Check out</label><b>' + esc(d.dowName(b) + ' ' + d.fmt(b)) + '</b></div><div class="sf" data-wact="search"><label>Guests</label><b>2 adults</b></div>' + btn(O.icon('search') + '<span>Search</span>', '', 'data-wact="search"') + '</div>';
  }
  function ratingLine(X) { return X.F.avg ? '★ ' + X.F.avg.toFixed(1) + ' from ' + fmt.num(X.F.nReviews) + ' guest reviews' : 'Self check-in · Fast Wi-Fi · Local hosts'; }
  function amenItems(X) {
    var F = X.F;
    return [
      ['wifi', 'Fast Wi-Fi', 'Fibre broadband in every home, the password waits in the guest app.'],
      ['key', 'Self check-in', 'A smart lock and your own door code, so you can arrive at any hour.'],
      ['snow', 'Air-conditioning', 'Cool, quiet bedrooms and living spaces.'],
      ['pan', 'Full kitchen', 'Cook a proper meal or reheat your favourite takeaway.'],
      ['bed', 'Fresh linen and towels', 'Hotel-quality sheets for every guest, every stay.'],
      ['car', 'Parking', F.props.length ? (F.withParking ? F.withParking + ' of ' + plural(F.props.length, 'home') + ' include a parking bay.' : 'Public parking close to every home.') : 'Each home page says where to park.'],
      ['chat', 'Host on WhatsApp', 'A real person who answers quickly, day and night.'],
      ['invoices', 'Invoice for every stay', 'Sent when you book, with a receipt as soon as you pay.']
    ];
  }

  /* ---------------- heroes: one per design ---------------- */
  var HERO = {
    coastal: function (X) {
      return '<section class="w-hero h-coastal">' + heroImg(X, 'hc-img') + '<div class="hc-shade"></div><div class="w-wrap hc-in">' + eyebrow(X.F.cities.slice(0, 4).map(function (c) { return c.name; }).join(' · ') || 'Holiday homes') + '<h1>' + esc(X.copy.headline) + '</h1><p>' + esc(X.copy.sub) + '</p><div class="w-row c">' + btn(esc(X.copy.cta), '', 'data-wact="search"') + btn('See the homes', 'glass', 'data-wnav="home" data-anchor="units"') + '</div></div>' +
        '<div class="w-wrap hc-bar">' + searchBar(X) + '</div></section>';
    },
    urban: function (X) {
      var F = X.F, areas = X.F.props.length ? X.F.props.map(function (x) { return x.area.split(',')[0]; }) : ['Your neighbourhood', 'Your city', 'Your street'];
      var uniq = areas.filter(function (a, i) { return areas.indexOf(a) === i; }), row = uniq.map(function (a) { return '<span>' + esc(a) + '</span><i>/</i>'; }).join('');
      return '<section class="w-hero h-urban"><div class="w-wrap hu-grid"><div class="hu-text"><div class="hu-index"><span>01</span><span>' + esc(F.props.length ? plural(F.props.length, 'home') + ' / ' + plural(F.cities.length, 'city', 'cities') : 'City stays') + '</span></div><h1>' + esc(X.copy.headline) + '</h1><p>' + esc(X.copy.sub) + '</p><div class="w-row">' + btn(esc(X.copy.cta) + ' →', '', 'data-wact="search"') + '<button type="button" class="w-link" data-wnav="about">About us</button></div></div>' +
        '<div class="hu-media">' + heroImg(X, 'hu-img') + (F.minFrom ? '<div class="hu-tag"><span>From</span><b>' + rm(F.minFrom) + '</b><span>a night</span></div>' : '') + '</div></div><div class="hu-ticker" aria-hidden="true"><div class="hu-track">' + row + row + row + '</div></div></section>';
    },
    highland: function (X) {
      var F = X.F;
      return '<section class="w-hero h-highland">' + heroImg(X, 'hh-img') + '<div class="w-wrap hh-wrap"><div class="hh-card">' + eyebrow(F.cities.slice(0, 3).map(function (c) { return c.name; }).join(' · ') || 'Retreats') + '<h1>' + esc(X.copy.headline) + '</h1><p>' + esc(X.copy.sub) + '</p><div class="w-row">' + btn(esc(X.copy.cta), '', 'data-wact="search"') + '<button type="button" class="w-link" data-wnav="home" data-anchor="units">See the homes</button></div>' +
        '<div class="hh-facts"><span>' + O.icon('clock') + 'Check-in from ' + esc(fmt.time(F.checkIn)) + '</span><span>' + O.icon('key') + 'Self check-in</span>' + (F.avg ? '<span>' + O.icon('star') + F.avg.toFixed(1) + ' guest rating</span>' : '') + '</div></div></div></section>';
    },
    heritage: function (X) {
      var F = X.F, f = X.feat, yr = F.firstStay ? +F.firstStay.slice(0, 4) : 0, since = yr && yr < +D.TODAY.slice(0, 4) ? 'Hosting since ' + yr : 'Restored homes';
      var mid = f.filter(function (x) { return x.photos && x.photos.length; })[0] || f.filter(function (x) { return x.scene === 'heritage'; })[0] || null;
      var rest = f.filter(function (x) { return x !== mid; }), side = [rest[0] || f[0], rest[1] || rest[0] || f[0]];
      return '<section class="w-hero h-heritage">' + tiles(X.V, 30) + '<div class="w-wrap"><div class="hr-kicker"><i></i><span>' + esc(since + (F.cities.length ? ' · ' + F.cities.slice(0, 3).map(function (c) { return c.name; }).join(' · ') : '')) + '</span><i></i></div><h1>' + esc(X.copy.headline) + '</h1><p>' + esc(X.copy.sub) + '</p><div class="w-row c">' + btn(esc(X.copy.cta), '', 'data-wact="search"') + '<button type="button" class="w-link" data-wnav="about">Read our story</button></div>' +
        '<div class="hr-arches">' + [0, 1, 2].map(function (i) { var x = i === 1 ? mid : side[i ? 1 : 0]; return '<figure class="hr-arch a' + i + '">' + (i === 1 && !mid ? heroImg(X, 'hr-img') : photo(X, x, i === 0 ? 1 : 0, 'hr-img')) + (x ? '<figcaption>' + esc(x.short) + '</figcaption>' : '') + '</figure>'; }).join('') + '</div></div></section>';
    },
    minimal: function (X) {
      var F = X.F, f = X.feat;
      return '<section class="w-hero h-minimal"><div class="w-wrap mn-grid"><div class="mn-title"><div class="mn-meta">' + esc(F.props.length ? 'Index / ' + plural(F.props.length, 'home') : 'Index') + '</div><h1>' + esc(X.copy.headline) + '</h1><p>' + esc(X.copy.sub) + '</p>' + btn(esc(X.copy.cta) + ' ↓', '', 'data-wnav="home" data-anchor="units"') + '</div>' +
        heroImg(X, 'mn-a') + '<div class="mn-tile"><b>' + (F.avg ? F.avg.toFixed(1) : F.props.length ? F.props.length : 'New') + '</b><span>' + (F.avg ? 'average from ' + fmt.num(F.nReviews) + ' reviews' : F.props.length ? (F.props.length === 1 ? 'home' : 'homes') + ' ready to book' : 'homes coming soon') + '</span></div>' + photo(X, f[1] || f[0], 1, 'mn-b') + photo(X, f[2] || f[0], 2, 'mn-c') +
        '<div class="mn-list">' + (F.cities.length ? F.cities.slice(0, 4).map(function (c) { return '<span><b>' + esc(c.name) + '</b><em>' + c.props.length + '</em></span>'; }).join('') : '<span><b>Your cities</b><em>0</em></span>') + '</div></div></section>';
    },
    editorial: function (X) {
      var x = X.feat[0], words = X.copy.headline.split(' '), cut = Math.max(1, words.length - 3);
      return '<section class="w-hero h-editorial"><div class="w-wrap"><div class="ed-mast"><span>' + esc(d.monthName(D.TODAY, true) + ' ' + D.TODAY.slice(0, 4)) + '</span><span>' + esc(X.ws.name) + ' · The collection</span><span>' + esc(X.F.props.length ? plural(X.F.props.length, 'home') : 'New collection') + '</span></div>' +
        '<div class="ed-grid"><div class="ed-copy"><h1>' + esc(words.slice(0, cut).join(' ')) + ' <em>' + esc(words.slice(cut).join(' ')) + '</em></h1><p class="ed-lead">' + esc(X.copy.sub) + '</p><div class="w-row">' + btn(esc(X.copy.cta), '', 'data-wnav="home" data-anchor="units"') + '<button type="button" class="w-link" data-wnav="about">Meet the host</button></div></div>' +
        '<figure class="ed-fig">' + heroImg(X, 'ed-img') + '<figcaption><b>' + esc(x.name) + '</b>, ' + esc(x.area) + '</figcaption></figure></div></div></section>';
    },
    tropical: function (X) {
      var F = X.F;
      return '<section class="w-hero h-tropical"><div class="ht-bg">' + scene('leaves', 'hero', X.V) + '</div><div class="w-wrap ht-grid"><div class="ht-text"><span class="ht-badge">' + esc(F.avg ? '★ ' + F.avg.toFixed(1) + ' from ' + fmt.num(F.nReviews) + ' guests' : 'Holiday homes') + '</span><h1>' + esc(X.copy.headline) + '</h1><p>' + esc(X.copy.sub) + '</p><div class="w-row">' + btn(esc(X.copy.cta), 'sun', 'data-wact="search"') + waBtn('Chat with us', 'glass') + '</div></div>' +
        '<div class="ht-media"><span class="ht-sun"></span>' + heroImg(X, 'ht-a') + heroImg(X, 'ht-b', 1) + '</div></div></section>';
    },
    family: function (X) {
      var F = X.F, f = X.feat, words = X.copy.headline.split(' '), last = words.pop(), maxSleeps = F.props.reduce(function (m, x) { return Math.max(m, x.sleeps); }, 0);
      return '<section class="w-hero h-family"><span class="fm-blob b1"></span><span class="fm-blob b2"></span><div class="w-wrap fm-grid"><div class="fm-text"><span class="fm-sticker">' + esc(maxSleeps ? 'Homes for up to ' + maxSleeps + ' guests' : 'Room for everyone') + '</span><h1>' + esc(words.join(' ')) + ' <mark>' + esc(last) + '</mark></h1><p>' + esc(X.copy.sub) + '</p><div class="w-row">' + btn(esc(X.copy.cta), '', 'data-wact="search"') + waBtn('Ask us anything', 'ghost') + '</div>' +
        '<div class="fm-chips"><span>' + ic('pan') + 'Full kitchens</span><span>' + ic('bed') + 'Cots on request</span><span>' + O.icon('key') + 'Self check-in</span></div></div>' +
        '<div class="fm-pics">' + [0, 1].map(function (i) { var x = f[i] || f[0]; return '<div class="fm-pol p' + i + '">' + (i ? photo(X, x, 0, '') : heroImg(X, '')) + '<span>' + esc(x.short) + '</span></div>'; }).join('') + '<span class="fm-badge">' + esc(F.avg ? '★ ' + F.avg.toFixed(1) : 'New') + '<small>' + esc(F.avg ? 'from families' : 'homes') + '</small></span></div></div>' +
        '<svg class="fm-wave" viewBox="0 0 1200 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 30 C200 70 400 -10 600 30 C800 70 1000 -10 1200 30 V60 H0Z"/></svg></section>';
    }
  };

  /* ---------------- introduction ---------------- */
  function factRow(X) {
    var F = X.F;
    if (!F.props.length) return '';
    var items = [[String(F.props.length), F.props.length === 1 ? 'home' : 'homes'], [F.avg ? F.avg.toFixed(1) + '★' : 'New', F.avg ? 'guest rating' : 'on the site'], [String(F.cities.length), F.cities.length === 1 ? 'destination' : 'destinations'], [fmt.time(F.checkIn).replace(':00', ''), 'self check-in from']];
    return '<div class="w-facts">' + items.map(function (s) { return '<div><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div>'; }).join('') + '</div>';
  }
  var INTRO = {
    center: function (X) { return sec('intro', 'iv-center', '<div class="w-wrap">' + head2('Welcome', X.copy.introTitle, X.copy.intro, true) + factRow(X) + '</div>'); },
    split: function (X) { return sec('intro', 'iv-split', '<div class="w-wrap iv-grid"><div><div class="w-eyebrow">About ' + esc(X.ws.name) + '</div><h2 class="w-h2">' + esc(X.copy.introTitle) + '</h2></div><div><p class="w-lead">' + esc(X.copy.intro) + '</p>' + factRow(X) + '</div></div>'); },
    letter: function (X) { return sec('intro', 'iv-letter', '<div class="w-wrap"><div class="iv-narrow">' + eyebrow('Welcome') + '<h2 class="w-h2">' + esc(X.copy.introTitle) + '</h2><p class="iv-drop">' + esc(X.copy.intro) + '</p><div class="iv-sign">The ' + esc(X.ws.name) + ' team</div></div>' + factRow(X) + '</div>'); },
    bubble: function (X) {
      var host = (D.staff || [])[0];
      return sec('intro', 'iv-bubble', '<div class="w-wrap iv-bgrid"><div class="iv-host"><span class="iv-av">' + esc(fmt.initials(host ? host.name : X.ws.name)) + '</span><b>' + esc(host ? host.name : X.ws.name) + '</b><small>Your host</small></div><div class="iv-bub"><h2 class="w-h2">' + esc(X.copy.introTitle) + '</h2><p class="w-lead">' + esc(X.copy.intro) + '</p></div></div>' + '<div class="w-wrap">' + factRow(X) + '</div>');
    }
  };

  /* ---------------- homes ---------------- */
  function unitsHead(X, center) {
    var w = X.t.words.units, F = X.F;
    return head2(w[0], w[1], F.props.length ? plural(F.props.length, 'home') + ' in ' + cityList(F) + '. Prices are the lowest nightly rate in the next 30 days.' : 'Your properties appear here with photos and prices as soon as you add them.', center);
  }
  function unitCard(X, x, i, cls) {
    return '<button type="button" class="w-unit ' + (cls || '') + (x.placeholder ? ' is-ph' : '') + '" ' + unitAttr(x) + '>' + photo(X, x, 0, 'u-img') + '<span class="u-body"><span class="u-top"><b class="u-name">' + esc(x.name) + '</b>' + (x.placeholder ? '' : rating(x)) + '</span><span class="u-area">' + esc(x.area) + '</span><span class="u-facts">' + facts1(x) + '</span>' + priceLine(x) + '</span></button>';
  }
  var UNITS = {
    cards: function (X) { return sec('units', 'uv-cards', '<div class="w-wrap">' + unitsHead(X, true) + '<div class="w-cards">' + X.feat.map(function (x, i) { return unitCard(X, x, i); }).join('') + '</div></div>'); },
    grid: function (X) {
      return sec('units', 'uv-grid', '<div class="w-wrap">' + unitsHead(X) + '<div class="w-grid">' + X.feat.map(function (x, i) {
        return '<button type="button" class="g-unit' + (x.placeholder ? ' is-ph' : '') + '" ' + unitAttr(x) + '><span class="g-no">' + (i < 9 ? '0' : '') + (i + 1) + '</span>' + photo(X, x, i % 3 === 1 ? 1 : 0, 'g-img') + '<span class="g-row"><b>' + esc(x.name) + '</b><span class="g-p">' + (x.from == null && !x.placeholder ? 'Ask' : rm(x.from)) + '</span></span><span class="g-row s"><span>' + esc(x.area.split(',')[0]) + ' · ' + facts1(x) + '</span><span>' + (x.from == null && !x.placeholder ? 'for rates' : 'per night') + '</span></span></button>';
      }).join('') + '</div></div>');
    },
    rows: function (X) {
      return sec('units', 'uv-rows', '<div class="w-wrap">' + unitsHead(X) + '<div class="w-rows">' + X.feat.map(function (x, i) {
        return '<button type="button" class="r-unit' + (i % 2 ? ' rev' : '') + (x.placeholder ? ' is-ph' : '') + '" ' + unitAttr(x) + '>' + photo(X, x, 0, 'r-img') + '<span class="r-body"><span class="w-eyebrow">' + esc(x.city) + '</span><b class="r-name">' + esc(x.name) + '</b><span class="r-txt">' + esc(x.placeholder ? 'A short line about the home, its view and what is nearby.' : aboutLine(x)) + '</span><span class="r-facts">' + facts1(x) + (x.placeholder ? '' : ' · ' + rating(x)) + '</span>' + priceLine(x) + '<span class="w-link">View home</span></span></button>';
      }).join('') + '</div></div>');
    },
    list: function (X) {
      return sec('units', 'uv-list', '<div class="w-wrap">' + unitsHead(X, true) + '<div class="w-list">' + X.feat.map(function (x, i) {
        return '<button type="button" class="l-unit' + (x.placeholder ? ' is-ph' : '') + '" ' + unitAttr(x) + '><span class="l-no">No. ' + (i < 9 ? '0' : '') + (i + 1) + '</span>' + photo(X, x, 0, 'l-img') + '<span class="l-body"><b class="l-name">' + esc(x.name) + '</b><span class="l-area">' + esc(x.area) + '</span><span class="l-facts">' + facts1(x) + (x.placeholder ? '' : ' · ' + rating(x)) + '</span></span><span class="l-side">' + priceLine(x) + '<span class="w-link">View →</span></span></button>';
      }).join('') + '</div></div>');
    },
    feature: function (X) {
      var f = X.feat, a = f[0], rest = f.slice(1);
      return sec('units', 'uv-feature', '<div class="w-wrap">' + unitsHead(X) + '<button type="button" class="f-main' + (a.placeholder ? ' is-ph' : '') + '" ' + unitAttr(a) + '>' + photo(X, a, 0, 'f-img') + '<span class="f-body"><span class="w-eyebrow">Featured · ' + esc(a.city) + '</span><b class="f-name">' + esc(a.name) + '</b><span class="f-txt">' + esc(a.placeholder ? 'Your most-loved home, told in a few lines.' : aboutLine(a)) + '</span><span class="f-facts">' + facts1(a) + '</span>' + priceLine(a) + '</span></button>' +
        '<div class="f-rest">' + rest.map(function (x, i) { return '<button type="button" class="f-unit' + (x.placeholder ? ' is-ph' : '') + '" ' + unitAttr(x) + '>' + photo(X, x, i % 2, 'f-thumb') + '<span class="f-cap"><b>' + esc(x.name) + '</b><span>' + esc(x.area) + '</span>' + priceLine(x) + '</span></button>'; }).join('') + '</div></div>');
    },
    carousel: function (X) {
      return sec('units', 'uv-carousel', '<div class="w-wrap"><div class="w-headrow">' + unitsHead(X) + '<div class="w-arrows"><button type="button" data-wact="scroll" data-dir="-1" aria-label="Previous homes">' + O.icon('left') + '</button><button type="button" data-wact="scroll" data-dir="1" aria-label="Next homes">' + O.icon('right') + '</button></div></div><div class="w-carousel">' + X.feat.map(function (x) {
        return '<button type="button" class="c-unit' + (x.placeholder ? ' is-ph' : '') + '" ' + unitAttr(x) + '>' + photo(X, x, 0, 'c-img') + '<span class="c-cap"><span class="c-city">' + esc(x.city) + '</span><b>' + esc(x.name) + '</b><span>' + facts1(x) + '</span>' + priceLine(x) + '</span></button>';
      }).join('') + '</div></div>');
    },
    polaroid: function (X) {
      return sec('units', 'uv-polaroid', '<div class="w-wrap">' + unitsHead(X, true) + '<div class="w-pols">' + X.feat.map(function (x, i) {
        return '<button type="button" class="p-unit r' + (i % 3) + (x.placeholder ? ' is-ph' : '') + '" ' + unitAttr(x) + '><span class="p-tag">Sleeps ' + x.sleeps + '</span>' + photo(X, x, 0, 'p-img') + '<b>' + esc(x.name) + '</b><span class="p-area">' + esc(x.city) + ' · ' + esc(bedsTxt(x)) + '</span>' + priceLine(x) + '</button>';
      }).join('') + '</div></div>');
    }
  };

  /* ---------------- amenities ---------------- */
  var AMEN = {
    icons: function (X) { var w = X.t.words.amen; return sec('amenities', 'av-icons', '<div class="w-wrap">' + head2(w[0], w[1], null, true) + '<div class="w-icons">' + amenItems(X).map(function (a) { return '<div class="i-item"><span class="i-ic">' + ic(a[0]) + '</span><b>' + esc(a[1]) + '</b><p>' + esc(a[2]) + '</p></div>'; }).join('') + '</div></div>'); },
    list: function (X) { var w = X.t.words.amen; return sec('amenities', 'av-list', '<div class="w-wrap av-grid"><div>' + head2(w[0], w[1], null) + '</div><ol class="w-alist">' + amenItems(X).map(function (a, i) { return '<li><span class="a-n">' + (i < 9 ? '0' : '') + (i + 1) + '</span><span class="a-ic">' + ic(a[0]) + '</span><span><b>' + esc(a[1]) + '</b><small>' + esc(a[2]) + '</small></span></li>'; }).join('') + '</ol></div>'); },
    split: function (X) {
      var w = X.t.words.amen, x = X.feat[1] || X.feat[0];
      return sec('amenities', 'av-split', '<div class="w-wrap av-sgrid">' + photo(X, x, 1, 'av-img') + '<div>' + head2(w[0], w[1], null) + '<ul class="w-check">' + amenItems(X).slice(0, 7).map(function (a) { return '<li>' + O.icon('check') + '<span><b>' + esc(a[1]) + '.</b> ' + esc(a[2]) + '</span></li>'; }).join('') + '</ul></div></div>');
    }
  };

  /* ---------------- reviews ---------------- */
  function reviewList(X, n, pid) {
    var top = X.F.top.filter(function (r) { return !pid || inListing(r.propertyId, pid); });
    if (pid && top.length < n) top = top.concat(X.F.reviews.filter(function (r) { return inListing(r.propertyId, pid) && r.stars >= 4 && top.indexOf(r) < 0; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; }));
    return top.slice(0, n);
  }
  var PH_REVIEWS = [
    { ph: true, guest: 'Guest name', text: 'Your best five-star reviews from Airbnb, Booking.com and Agoda appear here automatically.', stars: 5 },
    { ph: true, guest: 'Guest name', text: 'Guests read reviews before they book. Recent, specific ones work best.', stars: 5 },
    { ph: true, guest: 'Guest name', text: 'Reply to reviews in the Reviews section and the best ones show up here.', stars: 5 }
  ];
  function inListing(unitId, pid) { if (unitId === pid) return true; var p = D.propById[unitId]; return String(pid).indexOf('type:') === 0 && !!p && p.unitTypeId === pid.slice(5); }
  function revMeta(r) {
    if (r.ph) return 'Guest · Country · Home';
    var x = D.propById[r.propertyId], t = O.typeOf(x);
    return esc(firstName(r.guest)) + ' · ' + esc((D.countryName && D.countryName[r.country]) || r.country || '') + (x ? ' · ' + esc(t ? t.name : x.short || x.name) : '') + (r.date ? ' · ' + esc(d.monthName(r.date) + ' ' + r.date.slice(0, 4)) : '');
  }
  function revHead(X, center) {
    var w = X.t.words.rev, F = X.F;
    return head2(w[0], F.avg ? w[1] : w[1], F.avg ? '★ ' + F.avg.toFixed(1) + ' average from ' + fmt.num(F.nReviews) + ' reviews' + (F.platforms.length ? ' on ' + F.platforms.slice(0, 4).join(', ') : '') + '.' : 'Reviews from your guests appear here once you have stays.', center);
  }
  var REV = {
    cards: function (X) {
      var rs = reviewList(X, 3); if (!rs.length) rs = PH_REVIEWS;
      return sec('reviews', 'rv-cards', '<div class="w-wrap">' + revHead(X, true) + '<div class="w-rcards">' + rs.map(function (r) { return '<figure class="' + (r.ph ? 'is-ph' : '') + '"><div class="q-stars">' + stars(r.stars) + '</div><p>' + esc(r.text) + '</p><figcaption><span class="rc-av">' + esc(r.ph ? '?' : fmt.initials(r.guest)) + '</span><span>' + revMeta(r) + '</span></figcaption></figure>'; }).join('') + '</div></div>');
    },
    quote: function (X) {
      var rs = reviewList(X, 5), r0 = rs[0] || PH_REVIEWS[0], F = X.F;
      return sec('reviews', 'rv-quote', '<div class="w-wrap"><div class="w-quote' + (r0.ph ? ' is-ph' : '') + '"><span class="q-mark">' + ic('quote') + '</span><div class="w-eyebrow">' + esc(X.t.words.rev[0]) + '</div><blockquote>' + esc(r0.text) + '</blockquote><div class="q-by">' + revMeta(r0) + '</div>' +
        (F.avg ? '<div class="q-sum"><b>' + F.avg.toFixed(1) + '</b><span>' + stars(F.avg) + '</span><small>' + fmt.num(F.nReviews) + ' reviews</small></div>' : '') + (rs.length > 1 ? '<div class="q-more">' + rs.slice(1, 3).map(function (r) { return '<p>“' + esc(r.text) + '”<small>' + revMeta(r) + '</small></p>'; }).join('') + '</div>' : '') + '</div></div>');
    },
    pull: function (X) {
      var rs = reviewList(X, 3); if (!rs.length) rs = PH_REVIEWS;
      return sec('reviews', 'rv-pull', '<div class="w-wrap">' + eyebrow(X.t.words.rev[0]) + '<div class="w-pull"><blockquote class="big' + (rs[0].ph ? ' is-ph' : '') + '">“' + esc(rs[0].text) + '”<cite>' + revMeta(rs[0]) + '</cite></blockquote><div class="sm">' + rs.slice(1, 3).map(function (r) { return '<blockquote class="' + (r.ph ? 'is-ph' : '') + '">“' + esc(r.text) + '”<cite>' + revMeta(r) + '</cite></blockquote>'; }).join('') + '</div></div>' + (X.F.avg ? '<div class="pull-sum">' + esc('★ ' + X.F.avg.toFixed(1) + ' from ' + fmt.num(X.F.nReviews) + ' reviews') + '</div>' : '') + '</div>');
    },
    columns: function (X) {
      var rs = reviewList(X, 3); if (!rs.length) rs = PH_REVIEWS;
      return sec('reviews', 'rv-columns', '<div class="w-wrap">' + revHead(X) + '<div class="w-rcols">' + rs.map(function (r) { return '<figure class="' + (r.ph ? 'is-ph' : '') + '"><div class="q-stars">' + stars(r.stars) + '</div><p>' + esc(r.text) + '</p><figcaption>' + revMeta(r) + '</figcaption></figure>'; }).join('') + '</div></div>');
    }
  };

  /* ---------------- location ---------------- */
  function cityNote(c) { return CITY_NOTE[c.name] || (plural(c.props.length, 'home') + ' in ' + c.name + ', close to food, transport and the sights.'); }
  function locLead(X) { return cval('location') || (X.F.cities.length ? 'Homes in ' + cityList(X.F) + ', each close to good food, transport and the things you came to see.' : 'Add properties and your areas appear here with a line about each.'); }
  function cityRows(X, cls) {
    var F = X.F;
    if (!F.cities.length) return '<div class="' + cls + ' is-ph"><div class="lc"><b>Your city</b><span>Homes and prices appear here</span></div></div>';
    return '<div class="' + cls + '">' + F.cities.map(function (c) { return '<button type="button" class="lc" data-wpid="' + esc(c.props[0].id) + '"><span class="lc-top"><b>' + esc(c.name) + '</b><span class="lc-n">' + plural(c.props.length, 'home') + '</span></span><span class="lc-note">' + esc(cityNote(c)) + '</span>' + (c.from ? '<span class="lc-from">from ' + rm(c.from) + ' / night</span>' : '') + '</button>'; }).join('') + '</div>';
  }
  var LOC = {
    map: function (X) { var w = X.t.words.loc; return sec('location', 'lv-map', '<div class="w-wrap lv-grid"><div class="lv-mapbox">' + mapSVG(X) + '</div><div>' + head2(w[0], w[1], locLead(X)) + cityRows(X, 'w-cities') + '</div></div>'); },
    list: function (X) {
      var w = X.t.words.loc, F = X.F;
      return sec('location', 'lv-list', '<div class="w-wrap">' + head2(w[0], w[1], locLead(X)) + '<div class="w-ltable">' + (F.cities.length ? F.cities.map(function (c) { return '<button type="button" class="lt-row" data-wpid="' + esc(c.props[0].id) + '"><b>' + esc(c.name) + '</b><span class="lt-note">' + esc(cityNote(c)) + '</span><span class="lt-n">' + plural(c.props.length, 'home') + '</span><span class="lt-p">' + (c.from ? 'from ' + rm(c.from) : '') + '</span></button>'; }).join('') : '<div class="lt-row is-ph"><b>Your city</b><span class="lt-note">Your areas appear here</span><span class="lt-n">0 homes</span><span class="lt-p"></span></div>') + '</div></div>');
    },
    stops: function (X) {
      var w = X.t.words.loc, F = X.F;
      return sec('location', 'lv-stops', '<div class="w-wrap lv-sgrid"><div>' + head2(w[0], w[1], locLead(X)) + '<div class="lv-mini">' + mapSVG(X) + '</div></div><ol class="w-stops">' + (F.cities.length ? F.cities.map(function (c) { return '<li><button type="button" data-wpid="' + esc(c.props[0].id) + '">' + art(X, c.scene || 'hills', c.name, 'st-img', c.name) + '<span><b>' + esc(c.name) + '</b><small>' + esc(cityNote(c)) + '</small><em>' + plural(c.props.length, 'home') + (c.from ? ' · from ' + rm(c.from) : '') + '</em></span></button></li>'; }).join('') : '<li class="is-ph"><span><b>Your city</b><small>Your areas appear here</small></span></li>') + '</ol></div>');
    }
  };

  /* ---------------- booking call to action + enquiry form ---------------- */
  function enquiryForm(X, title) {
    var a = d.add(D.TODAY, 14), b = d.add(D.TODAY, 17);
    return '<form class="w-form" data-wact="enquire" onsubmit="return false"><h3>' + esc(title || 'Send an enquiry') + '</h3><div class="f2"><label>Name<input placeholder="Your name" autocomplete="off"></label><label>Email or phone<input placeholder="So we can reply" autocomplete="off"></label></div><div class="f2"><label>Check in<input placeholder="' + esc(d.dowName(a) + ' ' + d.fmt(a)) + '" autocomplete="off"></label><label>Check out<input placeholder="' + esc(d.dowName(b) + ' ' + d.fmt(b)) + '" autocomplete="off"></label></div><div class="f2"><label>Guests<input placeholder="2 adults" autocomplete="off"></label><label>Home<select><option>Not sure yet</option>' + X.F.props.map(function (x) { return '<option>' + esc(x.name) + '</option>'; }).join('') + '</select></label></div><label>Message<textarea rows="3" placeholder="Anything we should know?"></textarea></label>' + btn('Send enquiry', 'full', 'data-wact="enquire"') + '<small>We reply within the hour, 8 AM to 11 PM.</small></form>';
  }
  var PERKS = [['star', 'Best rate, no platform fees'], ['invoices', 'Invoice and receipt for every stay'], ['chat', 'A real person on WhatsApp']];
  var BOOK = {
    split: function (X) {
      var w = X.t.words.book;
      return sec('book', 'bv-split', '<div class="w-wrap bv-grid"><div class="bv-copy">' + head2(w[0], w[1], 'Book direct with ' + X.ws.name + ' for the best rate. Questions first? Send an enquiry or message us on WhatsApp.') + '<ul class="w-perks">' + PERKS.map(function (p) { return '<li>' + O.icon(p[0]) + '<span>' + esc(p[1]) + '</span></li>'; }).join('') + '</ul><div class="w-row">' + btn('Check availability', '', 'data-wact="search"') + waBtn('WhatsApp us', 'ghost') + '</div></div>' + enquiryForm(X) + '</div>');
    },
    band: function (X) {
      var w = X.t.words.book;
      return sec('book', 'bv-band', '<div class="bv-strip"><div class="w-wrap bv-in"><div><div class="w-eyebrow">' + esc(w[0]) + '</div><h2 class="w-h2">' + esc(w[1]) + '</h2><p>Same homes, same team, the best rate is always here on ' + esc(X.ws.domain) + '.</p></div><div class="w-row">' + btn('Check availability', '', 'data-wact="search"') + waBtn('WhatsApp', 'glass') + '</div></div></div><div class="w-wrap bv-formwrap"><div class="bv-side"><h3>Prefer to ask first?</h3><p>Tell us your dates and who is coming. We will suggest the right home and hold it while you decide.</p><ul class="w-perks">' + PERKS.map(function (p) { return '<li>' + O.icon(p[0]) + '<span>' + esc(p[1]) + '</span></li>'; }).join('') + '</ul></div>' + enquiryForm(X) + '</div>');
    }
  };

  /* ---------------- footer ---------------- */
  function socialLinks(X) {
    var s = social(), out = [];
    if (s.instagram) out.push(['instagram', 'Instagram', '@' + s.instagram.replace(/^@/, '')]);
    if (s.facebook) out.push(['facebook', 'Facebook', s.facebook.replace(/^@/, '')]);
    if (s.tiktok) out.push(['tiktok', 'TikTok', '@' + s.tiktok.replace(/^@/, '')]);
    return '<div class="w-social">' + out.map(function (o) { return '<button type="button" data-wact="social" data-net="' + o[1] + '" data-h="' + esc(o[2]) + '" aria-label="' + esc(o[1] + ' ' + o[2]) + '" title="' + esc(o[1] + ' ' + o[2]) + '">' + ic(o[0]) + '</button>'; }).join('') + '<a href="' + esc(waHref()) + '" target="_blank" rel="noopener" aria-label="WhatsApp" title="WhatsApp ' + esc(waNumber()) + '">' + ic('whatsapp') + '</a>' + (X.ws.email ? '<button type="button" data-wact="social" data-net="Email" data-h="' + esc(X.ws.email) + '" aria-label="Email ' + esc(X.ws.email) + '" title="' + esc(X.ws.email) + '">' + O.icon('mail') + '</button>' : '') + '</div>';
  }
  function footer(X) {
    var ws = X.ws, F = X.F, year = D.TODAY.slice(0, 4), powered = ws.id === 'orbique' ? '' : ' · Booking system by Orbique';
    var copy = '<div class="wf-copy"><span>© ' + year + ' ' + esc(ws.legal) + powered + '</span><span>Prices in RM · Malaysian tourism tax applies to non-Malaysian guests</span></div>';
    var brand = '<button type="button" class="w-brand" data-wnav="home">' + logo(X, X.V.deep) + '<span class="w-bname">' + esc(ws.name) + '</span></button>';
    var contact = [ws.phone ? '<span>' + O.icon('phone') + esc(ws.phone) + '</span>' : '', ws.email ? '<span>' + O.icon('mail') + esc(ws.email) + '</span>' : '', ws.address ? '<span>' + O.icon('pin') + esc(ws.address) + '</span>' : ''].join('');
    if (X.t.v.footer === 'centered') return '<footer class="w-footer wf-centered"><div class="w-wrap">' + (X.t.id === 'heritage' ? tiles(X.V, 16) : '') + brand + '<nav class="wf-nav">' + nav(X) + '</nav><div class="wf-contact">' + contact + '</div>' + socialLinks(X) + copy + '</div></footer>';
    return '<footer class="w-footer wf-columns"><div class="w-wrap"><div class="wf-cols"><div class="wf-about">' + brand + '<p>' + esc(F.props.length ? plural(F.props.length, 'home') + ' in ' + cityList(F) + '. Book direct with the people who look after them.' : 'Holiday homes, booked direct with the people who look after them.') + '</p>' + socialLinks(X) + '</div>' +
      '<div><h4>Stay</h4>' + (F.cities.length ? F.cities.slice(0, 5).map(function (c) { return '<button type="button" data-wpid="' + esc(c.props[0].id) + '">' + esc(c.name) + ' (' + c.props.length + ')</button>'; }).join('') : '<span>Your cities</span>') + '</div>' +
      '<div><h4>Explore</h4>' + nav(X) + '</div><div class="wf-contact"><h4>Contact</h4>' + contact + '</div></div>' + copy + '</div></footer>';
  }

  /* =====================================================================
     PROPERTY PAGE (one per property): gallery, facts, amenities, live calendar, booking card
     ===================================================================== */
  function aboutLine(x) {
    var t = String(x.type || 'Home'); t = t.charAt(0).toUpperCase() + t.slice(1);
    return t + ' in ' + x.area + '. ' + (CITY_NOTE[x.city] || 'Close to good food, transport and the things you came to see.');
  }
  function firstGap(pid) {
    for (var i = 2; i < 75; i++) { var a = d.add(D.TODAY, i); if (!isBooked(pid, a) && !isBooked(pid, d.add(a, 1)) && !isBooked(pid, d.add(a, 2))) return { from: a, to: d.add(a, 3) }; }
    return { from: null, to: null };
  }
  function defaultSel(x) { var cur = st.sel[x.id]; if (cur && cur.from && cur.from >= D.TODAY) return cur; st.sel[x.id] = firstGap(x.id); return st.sel[x.id]; }
  function quote(x) {
    var sel = defaultSel(x); if (!sel.from || !sel.to) return null;
    var nights = d.diff(sel.from, sel.to), acc = 0; d.range(sel.from, d.add(sel.to, -1)).forEach(function (iso) { acc += price(x.p, iso) || 0; });
    if (!nights || !acc) return null;
    return { nights: nights, acc: acc, avg: Math.round(acc / nights), cleaning: x.cleaning, total: acc + x.cleaning, from: sel.from, to: sel.to };
  }
  function bookingCard(X, x) {
    var q = quote(x), sel = defaultSel(x);
    return '<div class="w-bk"><div class="bk-price"><span>' + (q || x.from != null ? '<b>' + rm(q ? q.avg : x.from) + '</b> / night' : '<b>Ask us for rates</b>') + '</span>' + rating(x) + '</div>' +
      '<div class="bk-dates"><div><label>Check in</label><b>' + (sel.from ? esc(d.dowName(sel.from) + ', ' + d.fmt(sel.from)) : 'Pick a date') + '</b></div><div><label>Check out</label><b>' + (sel.to ? esc(d.dowName(sel.to) + ', ' + d.fmt(sel.to)) : 'Pick a date') + '</b></div><div class="full"><label>Guests</label><b>2 guests · up to ' + x.sleeps + '</b></div></div>' +
      btn('Book these dates', 'full', 'data-wact="book" data-pid="' + esc(x.id) + '"') +
      (q ? '<div class="bk-lines"><div><span>' + plural(q.nights, 'night') + (q.nights > 1 ? ' <small>avg ' + rm(q.avg) + '</small>' : '') + '</span><span>' + rm(q.acc) + '</span></div><div><span>Cleaning fee</span><span>' + rm(q.cleaning) + '</span></div><div class="tot"><span>Total</span><span>' + rm(q.total) + '</span></div></div><p class="bk-note">Non-Malaysian guests also pay tourism tax of RM 10 per night. Your invoice is sent as soon as you book.</p>' : '<p class="bk-note">Pick your check-in and check-out dates on the calendar.</p>') + '</div>';
  }
  function calendar(x) {
    var sel = defaultSel(x), months = [d.monthStart(D.TODAY), d.monthStart(d.addMonths(D.TODAY, 1))];
    return '<div class="w-cal">' + months.map(function (m, mi) {
      var lead = (d.dow(m) + 6) % 7, cells = '';
      for (var i = 0; i < lead; i++) cells += '<span class="cd blank"></span>';
      d.range(m, d.monthEnd(m)).forEach(function (iso) {
        var past = iso < D.TODAY, booked = !past && isBooked(x.id, iso), inR = sel.from && sel.to && iso >= sel.from && iso < sel.to, pr = past || booked ? null : price(x.p, iso);
        var cls = 'cd' + (past ? ' past' : '') + (booked ? ' booked' : '') + (inR ? ' in' : '') + (iso === sel.from ? ' s' : '') + (iso === sel.to ? ' e' : '');
        cells += '<button type="button" class="' + cls + '" ' + (past ? 'disabled' : 'data-wday="' + iso + '" data-pid="' + esc(x.id) + '"') + ' aria-label="' + esc(d.fmtY(iso) + (booked ? ', booked' : past ? '' : pr ? ', ' + rm(pr) : '')) + '"><b>' + d.day(iso) + '</b><em>' + (past ? '' : booked ? '' : pr ? fmt.num(pr) : '') + '</em></button>';
      });
      return '<div class="cm' + (mi ? ' second' : '') + '"><div class="cm-h">' + esc(d.monthName(m, true) + ' ' + m.slice(0, 4)) + '</div><div class="cm-dow">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div><div class="cm-grid">' + cells + '</div></div>';
    }).join('') + '</div><div class="cal-key"><span><i class="k-free"></i>Available, price in RM</span><span><i class="k-booked"></i>Booked</span><span><i class="k-sel"></i>Your dates</span></div>';
  }
  function factTiles(X, x) {
    return '<div class="pp-facts"><span><b>' + (x.beds || 'Studio') + '</b>' + (x.beds ? (x.beds > 1 ? 'bedrooms' : 'bedroom') : '') + '</span><span><b>' + x.sleeps + '</b>guests</span><span><b>' + esc(fmt.time(x.checkIn || X.F.checkIn)) + '</b>check-in</span><span><b>' + esc(fmt.time(x.checkOut || X.F.checkOut)) + '</b>check-out</span></div>';
  }
  function propertyPage(X) {
    var F = X.F, x = F.byId[X.pid] || F.props[0];
    if (!x) return sec('pp', 'pp pp-empty', '<div class="w-wrap"><div class="pp-crumb"><button type="button" data-wnav="home">Home</button> / <b>Property page</b></div><h1 class="pp-title">Your property page</h1><p class="w-lead">Every property gets its own page with a photo gallery, amenities, live availability from your calendar, nightly prices and a booking card. Add your first property to see it here.</p><div class="pp-gal">' + placeholders(X.t).concat(placeholders(X.t).slice(0, 2)).map(function (p, i) { return photo(X, p, 0, 'g' + i); }).join('') + '</div></div>');
    var on = {}; site().pageSections.property.forEach(function (s) { if (s.on !== false) on[s.id] = true; });
    var other = F.props.filter(function (y) { return y.id !== x.id && y.city === x.city; }).concat(F.props.filter(function (y) { return y.city !== x.city; })).slice(0, 3);
    var rs = reviewList(X, 4, x.id);
    var parts = {
      overview: '<div class="pp-block"><h2 class="w-h3">About this home</h2>' + factTiles(X, x) + '<p>' + esc(aboutLine(x)) + '</p></div>',
      amenities: '<div class="pp-block"><h2 class="w-h3">Amenities</h2><ul class="pp-amen">' + amenItems(X).filter(function (a) { return a[0] !== 'car' || x.parking; }).map(function (a) { return '<li>' + ic(a[0]) + '<span>' + esc(a[0] === 'car' ? 'Parking: ' + x.parkingText : a[0] === 'key' ? 'Self check-in (' + x.lockBrand + ' smart lock)' : a[1]) + '</span></li>'; }).join('') + '</ul></div>',
      calendar: '<div class="pp-block" data-wsec="calendar"><h2 class="w-h3">Availability</h2><p class="pp-hint">Prices per night in RM. Tap your check-in date, then your check-out date.</p>' + calendar(x) + '</div>',
      reviews: rs.length ? '<div class="pp-block"><h2 class="w-h3">Guest reviews ' + rating(x) + '</h2><div class="w-rcards two">' + rs.map(function (r) { return '<figure><div class="q-stars">' + stars(r.stars) + '</div><p>' + esc(r.text) + '</p><figcaption><span>' + revMeta(r) + '</span></figcaption></figure>'; }).join('') + '</div></div>' : '',
      location: '<div class="pp-block"><h2 class="w-h3">Location and house info</h2><div class="pp-loc">' + art(X, x.scene, x.id + 'loc', 'pp-map', x.area) + '<dl><dt>Area</dt><dd>' + esc(x.area) + '</dd><dt>Parking</dt><dd>' + esc(x.parkingText || 'Ask us') + '</dd><dt>Entry</dt><dd>' + esc(x.lockBrand) + ' smart lock, code in the guest app</dd><dt>House rules</dt><dd>No smoking, no parties, quiet after 10 PM</dd></dl></div></div>'
    };
    var main = site().pageSections.property.filter(function (s) { return s.on !== false && s.id !== 'gallery'; }).map(function (s) { return parts[s.id] || ''; }).join('');
    return sec('pp', 'pp', '<div class="w-wrap"><div class="pp-crumb"><button type="button" data-wnav="home">Home</button> / <button type="button" data-wnav="home" data-anchor="units">' + esc(x.city) + '</button> / <b>' + esc(x.name) + '</b></div><h1 class="pp-title">' + esc(x.name) + '</h1><div class="pp-sub">' + rating(x) + '<span>' + esc(x.area) + '</span><span>' + facts1(x) + '</span></div>' +
      (on.gallery ? '<div class="pp-gal">' + [0, 1, 2, 3, 4].map(function (n) { return photo(X, x, n, 'g' + n); }).join('') + '</div>' : '') + '<div class="pp-cols"><div class="pp-main">' + main + '</div><aside class="pp-side">' + bookingCard(X, x) + '</aside></div>' +
      (other.length ? '<div class="pp-more"><h2 class="w-h3">More homes you might like</h2><div class="w-cards">' + other.map(function (y, i) { return unitCard(X, y, i); }).join('') + '</div></div>' : '') + '</div>');
  }

  /* =====================================================================
     ABOUT PAGE: story, team, numbers, questions, contact
     ===================================================================== */
  function faqs(X) {
    var F = X.F;
    return [
      ['What time is check-in and check-out?', 'Check-in is from ' + fmt.time(F.checkIn) + ' and check-out is by ' + fmt.time(F.checkOut) + '. Early check-in or late checkout is often possible; message us to ask.'],
      ['How do I get in?', 'Every home has a smart lock. Your door code appears in the guest app once you have accepted the house rules and your ID is verified.'],
      ['Is there a tourism tax?', 'Malaysia charges tourism tax of RM 10 per room per night for non-Malaysian guests. It is shown on your invoice.'],
      ['Will I get an invoice and a receipt?', 'Yes. An invoice is sent when your booking is confirmed and a receipt as soon as payment arrives, by email or WhatsApp.'],
      ['Is there parking?', F.props.length ? (F.withParking + ' of our ' + plural(F.props.length, 'home') + ' include a parking bay. Each home page says exactly where to park.') : 'Each home page says exactly where to park.'],
      ['Why book here instead of a booking platform?', 'Same homes and the same team, without the platform service fee. You also deal with us directly from the start.']
    ];
  }
  function aboutPage(X) {
    var F = X.F, ws = X.ws;
    var team = (D.staff || []).filter(function (s) { return s.status !== 'left' && ['owner', 'ops', 'housekeeping', 'frontdesk'].indexOf(s.role) >= 0; }).slice(0, 4);
    var TITLE = { owner: 'Founder and host', ops: 'Guest experience', housekeeping: 'Housekeeping', frontdesk: 'Guest support' };
    var parts = {
      story: sec('story', 'ab-story', '<div class="w-wrap ab-grid"><div>' + eyebrow('About ' + ws.name) + '<h1 class="ab-h1">' + esc(F.props.length ? 'A small team looking after ' + plural(F.props.length, 'home') : 'A small team that looks after every stay') + '</h1><p class="w-lead">' + esc(storyText()) + '</p></div>' + heroImg(X, 'ab-img') + '</div>'),
      team: team.length ? sec('team', 'ab-team alt', '<div class="w-wrap">' + head2('The team', 'The people looking after you', null) + '<div class="ab-people">' + team.map(function (s) { return '<div class="tm"><span class="tm-av">' + esc(fmt.initials(s.name)) + '</span><b>' + esc(s.name) + '</b><span>' + esc(TITLE[s.role] || s.roleLabel || '') + '</span></div>'; }).join('') + '</div></div>') : '',
      stats: F.props.length ? sec('stats', 'ab-stats', '<div class="w-wrap">' + factRow(X) + '</div>') : '',
      faq: sec('faq', 'ab-faq', '<div class="w-wrap ab-fgrid">' + head2('Questions', 'Good to know', 'Anything else? Ask us on WhatsApp.') + '<div class="w-faq">' + faqs(X).map(function (q, i) { var open = st.faqOpen[i] != null ? st.faqOpen[i] : i === 0; return '<div class="fq' + (open ? ' open' : '') + '"><button type="button" data-wfaq="' + i + '" aria-expanded="' + open + '"><span>' + esc(q[0]) + '</span><i>' + (open ? '−' : '+') + '</i></button><p>' + esc(q[1]) + '</p></div>'; }).join('') + '</div></div>'),
      contact: sec('contact', 'ab-contact alt', '<div class="w-wrap bv-grid"><div>' + head2('Contact', 'Talk to us', 'We usually reply within the hour, 8 AM to 11 PM.') + waBtn('WhatsApp ' + waNumber(), '') + '<dl class="ab-dl">' + (ws.email ? '<dt>Email</dt><dd>' + esc(ws.email) + '</dd>' : '') + (ws.phone ? '<dt>Phone</dt><dd>' + esc(ws.phone) + '</dd>' : '') + (ws.address ? '<dt>Office</dt><dd>' + esc(ws.address) + '</dd>' : '') + '</dl></div>' + enquiryForm(X, 'Send us a message') + '</div>')
    };
    return site().pageSections.about.filter(function (s) { return s.on !== false; }).map(function (s) { return parts[s.id] || ''; }).join('');
  }

  /* =====================================================================
     BUILDER UI
     ===================================================================== */
  function pubState() {
    var S = site();
    var logs = S.log.concat(Array.isArray(D.websiteLog) ? D.websiteLog : []).filter(function (l) { return l && l.at; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    var live = S.published || logs.filter(function (l) { return l.what === 'Published'; })[0] || null;
    return { live: live, logs: logs, changed: !!S.changed || !!(live && tplOf(live.template).id !== S.template) };
  }
  function staffName(id) { var s = D.staffById(id); return s ? s.name : ''; }
  function statusBar() {
    var P = pubState(), ws = wsInfo(), t = tplOf(site().template), F = facts();
    var pill = P.live ? (P.changed ? U.pill('Draft changes', 'warn') : U.pill('Live', 'ok')) : U.pill('Not published', 'neutral');
    var sub = P.live ? 'Published ' + d.fmt(P.live.at.slice(0, 10)) + ', ' + fmt.time(P.live.at) + (staffName(P.live.by) ? ' by ' + staffName(P.live.by) : '') + (tplOf(P.live.template).id !== t.id ? ' · live design: ' + tplName(P.live.template) : '') : 'Pick a design, check the preview, then publish';
    var direct = (D.bookings || []).filter(function (b) { return b.channel === 'direct' && b.status !== 'cancelled' && b.createdAt && b.createdAt.slice(0, 10) >= d.add(D.TODAY, -89) && b.createdAt.slice(0, 10) <= D.TODAY; }).length;
    return '<div class="card wb-status"><span class="wb-globe">' + O.icon('website') + '</span><div class="grow"><div class="row-flex wrap"><b class="wb-domain">' + esc(ws.domain) + '</b>' + pill + '</div><div class="xs muted">' + esc(sub) + '</div></div>' +
      (F.props.length ? '<div class="wb-direct"><b>' + fmt.num(direct) + '</b><span>direct bookings<br>in 90 days</span></div>' : '') + '<div class="wb-cur"><span class="xs muted">Design</span><b>' + esc(t.name) + '</b></div></div>';
  }
  function swatches(t) { var v = palette(t); return '<span class="wb-sw" aria-hidden="true">' + [v.bg, v.alt, v.btn, v.acc, v.deep].map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + '</span>'; }
  function thumb(t, attrs) {
    return '<div role="button" tabindex="0" class="wb-thumb" ' + attrs + ' aria-label="Preview the ' + esc(t.name) + ' design"><div class="wb-shot" aria-hidden="true" inert><div class="wb-fit" data-fit="1280">' + renderSite(t, 'home', { limit: 3 }) + '</div></div>' +
      '<div class="wb-mini-phone" aria-hidden="true" inert><div class="wb-fit" data-fit="390">' + renderSite(t, 'home', { limit: 2 }) + '</div></div><span class="wb-hover">' + O.icon('eye') + 'Preview</span></div>';
  }
  function galleryHTML() {
    var S = site(), P = pubState(), F = facts(), ed = canEdit();
    return (F.props.length ? '' : emptyNote()) + '<div class="wb-ghead"><div><h2>Choose a design</h2><p class="small muted">' + TPL.length + ' complete websites. Every preview uses your logo, colours, homes, prices and reviews, and switching keeps your text and settings.</p></div></div>' +
      '<div class="wb-gallery">' + TPL.map(function (t) {
        var isCur = t.id === S.template, isLive = P.live && tplOf(P.live.template).id === t.id;
        return '<article class="card wb-tcard' + (isCur ? ' cur' : '') + '">' + thumb(t, 'data-act="preview" data-t="' + t.id + '"') +
          '<div class="wb-tinfo"><div class="row-flex wrap"><b class="wb-tname tf-' + t.id + '">' + esc(t.name) + '</b>' + (isLive ? U.pill('Live', 'ok') : '') + (isCur && !isLive ? U.pill('In use', 'brand') : '') + '<span class="spacer"></span>' + swatches(t) + '</div><p class="small">' + esc(t.desc) + '</p>' +
          '<div class="wb-meta xs"><span><span class="muted">Best for</span> <b>' + esc(t.best) + '</b></span><span><span class="muted">Type</span> <b>' + esc(t.type) + '</b></span></div>' +
          '<div class="row-flex wb-tact"><button type="button" class="btn btn-ghost btn-sm" data-act="preview" data-t="' + t.id + '">' + O.icon('eye') + 'Preview</button>' +
          (isCur ? '<button type="button" class="btn btn-ghost btn-sm" data-act="edit">' + O.icon('edit') + 'Edit site</button>' : '<button type="button" class="btn btn-primary btn-sm" data-act="use" data-t="' + t.id + '"' + dis(ed, NO_EDIT) + '>Use this design</button>') + '</div></div></article>';
      }).join('') + '</div>' +
      '<div class="section-title wb-extra-t">Every design also includes these pages</div><div class="grid g2 wb-extra">' +
      [['property', 'Property and booking', 'One page per property (' + F.props.length + ' now): photo gallery, amenities, live availability from your calendar, nightly prices and a booking card.'], ['about', 'About and contact', 'Your story and team, questions and answers, a contact form and a WhatsApp button.']].map(function (p) {
        var cur = tplOf(S.template);
        return '<article class="card wb-tcard wb-pcard"><div role="button" tabindex="0" class="wb-thumb" data-act="preview" data-t="' + cur.id + '" data-page="' + p[0] + '" aria-label="Preview the ' + esc(p[1]) + ' page"><div class="wb-shot" aria-hidden="true" inert><div class="wb-fit" data-fit="1280">' + renderSite(cur, p[0], { limit: 1 }) + '</div></div><span class="wb-hover">' + O.icon('eye') + 'Preview</span></div><div class="wb-tinfo"><div class="row-flex wrap"><b class="wb-tname">' + esc(p[1]) + '</b>' + U.pill('In the ' + cur.name + ' style', 'neutral') + '</div><p class="small muted">' + esc(p[2]) + '</p><div class="row-flex wb-tact"><button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-page="' + p[0] + '">' + O.icon('edit') + 'Edit this page</button></div></div></article>';
      }).join('') + '</div>';
  }
  function emptyNote() {
    var can = O.can('properties.create') && O.can('properties');
    return '<div class="note brand wb-empty"><div class="grow"><b>Your site shows placeholders until you add properties.</b> Each home then appears with its photos, nightly prices, reviews and its own booking page.</div>' + (O.pages.properties && O.can('properties') ? '<button type="button" class="btn btn-primary btn-sm" data-act="props">' + (can ? O.icon('plus') + 'Add properties' : 'Open Properties') + '</button>' : '') + '</div>';
  }
  function secRows(list, kind, ro) {
    var head = kind === 'home' ? '<div class="wb-sec fixed"><span class="wb-ord"></span><div class="grow"><div class="b small">Hero</div><div class="xs muted">' + esc(SEC_DESC.hero) + '</div></div><span class="xs muted">Always on</span></div>' : '';
    var foot = kind === 'home' ? '<div class="wb-sec fixed"><span class="wb-ord"></span><div class="grow"><div class="b small">Footer</div><div class="xs muted">' + esc(SEC_DESC.footer) + '</div></div><span class="xs muted">Always on</span></div>' : '';
    return '<div class="wb-secs">' + head + list.map(function (s, i) {
      var on = s.on !== false, why = ro ? NO_EDIT : '';
      return '<div class="wb-sec' + (on ? '' : ' off') + '"><div class="wb-ord"><button type="button" class="wb-mini" data-act="up" data-kind="' + kind + '" data-i="' + i + '" aria-label="Move ' + esc(SEC_LABEL[s.id]) + ' up"' + (i === 0 || ro ? ' disabled' : '') + (why ? ' title="' + esc(why) + '"' : '') + '>' + O.icon('up') + '</button><button type="button" class="wb-mini" data-act="down" data-kind="' + kind + '" data-i="' + i + '" aria-label="Move ' + esc(SEC_LABEL[s.id]) + ' down"' + (i === list.length - 1 || ro ? ' disabled' : '') + (why ? ' title="' + esc(why) + '"' : '') + '>' + O.icon('down') + '</button></div>' +
        '<div class="grow"><div class="b small">' + esc(SEC_LABEL[s.id] || s.id) + '</div><div class="xs muted">' + esc(SEC_DESC[s.id] || '') + '</div></div>' +
        '<button type="button" class="switch' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '" aria-label="Show ' + esc(SEC_LABEL[s.id]) + '" data-act="toggle" data-kind="' + kind + '" data-i="' + i + '"' + dis(!ro, NO_EDIT) + '></button></div>';
    }).join('') + foot + '</div>';
  }
  function field(name, label, value, ph, opts) {
    opts = opts || {};
    var dd = canEdit() ? '' : ' disabled title="' + esc(NO_EDIT) + '"', max = opts.max ? ' maxlength="' + (opts.max + 40) + '"' : '';
    var input = opts.area ? '<textarea class="textarea" id="wb-f-' + name + '" data-field="' + name + '" rows="' + (opts.rows || 3) + '" placeholder="' + esc(ph) + '"' + dd + '>' + esc(value) + '</textarea>' : '<input class="input" id="wb-f-' + name + '" data-field="' + name + '" value="' + esc(value) + '" placeholder="' + esc(ph) + '"' + max + dd + (opts.type ? ' inputmode="' + opts.type + '"' : '') + '>';
    return '<div class="field"><label for="wb-f-' + name + '">' + esc(label) + (opts.max ? ' <span class="wb-count" data-count="' + name + '" data-max="' + opts.max + '">' + (value || ph).length + '/' + opts.max + '</span>' : '') + '</label>' + input + (opts.hint ? '<div class="hint">' + esc(opts.hint) + '</div>' : '') + '</div>';
  }
  function card(title, sub, body, extra) { return '<div class="card"><div class="card-head"><div><h3>' + esc(title) + '</h3>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>' + (extra || '') + '</div><div class="card-body stack">' + body + '</div></div>'; }
  function editorHTML() {
    var S = site(), t = tplOf(S.template), F = facts(), ro = !canEdit(), dflt = t.copy(F, wsInfo()), C2 = S.content, ws = wsInfo();
    var left = '<div class="card"><div class="card-body wb-tplbox"><div class="wb-tplmini" aria-hidden="true" inert><div class="wb-fit" data-fit="1280">' + renderSite(t, 'home', { limit: 1 }) + '</div></div><div class="grow"><div class="xs muted b">Design</div><div class="b">' + esc(t.name) + '</div><div class="xs muted">' + esc(t.mood) + '</div></div><button type="button" class="btn btn-ghost btn-sm" data-act="gallery">Change</button></div></div>';
    if (!F.props.length) left += emptyNote();
    if (st.page === 'home') {
      left += card('Home page sections', 'Show, hide and reorder. Kept when you change design.', secRows(homeList(t), 'home', ro));
      left += card('Headline and welcome', 'Leave a field empty to use the design\'s wording', field('headline', 'Headline', C2.headline, dflt[0], { max: 70 }) + field('sub', 'Subheadline', C2.sub, dflt[1], { area: true, max: 170 }) + field('cta', 'Button label', C2.cta, dflt[2], { max: 24 }) + field('introTitle', 'Welcome heading', C2.introTitle, t.words.intro, { max: 60 }) + field('intro', 'Welcome text', C2.intro, introDefault(F, ws), { area: true, rows: 4, max: 320 }),
        (C2.headline || C2.sub || C2.cta || C2.intro || C2.introTitle ? '<button type="button" class="btn btn-quiet btn-sm" data-act="reset-copy"' + dis(!ro, NO_EDIT) + '>Reset</button>' : ''));
      left += card('Homes on the home page', F.props.length ? featCount() : 'Add properties to choose which homes to show', F.props.length ? '<div class="wb-feat">' + F.props.map(function (x) { var i = S.featured.indexOf(x.id); return '<label class="check"><input type="checkbox" data-feat="' + esc(x.id) + '"' + (i >= 0 ? ' checked' : '') + dis(!ro, NO_EDIT) + '><span class="grow wb-fname"><b>' + esc(x.name) + '</b><span class="xs muted">' + esc(x.city) + (x.from ? ' · from ' + rm(x.from) + ' / night' : '') + '</span></span>' + (i >= 0 ? '<span class="wb-ordn">' + (featIds().indexOf(x.id) + 1) + '</span>' : '') + '</label>'; }).join('') + '</div><div class="xs muted">None ticked: the first 6 homes are shown.</div>' : '<div class="small muted">Homes appear here once you add properties.</div>');
      left += card('Location text', 'Shown above your areas', field('location', 'About your areas', C2.location, locLead(ctxFor(t, 'home', {})), { area: true, rows: 3, max: 240 }));
    } else if (st.page === 'property') {
      left += card('Property page', F.props.length ? 'The same layout is used for all ' + plural(F.props.length, 'property', 'properties') : 'One page per property', (F.props.length ? '<div class="field"><label for="wb-pp">Preview property</label><select class="select" id="wb-pp" data-act="pp">' + F.props.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === ctxFor(t, 'property', {}).pid ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></div>' : '') + secRows(S.pageSections.property, 'property', ro) + '<div class="note">Availability and prices come from your bookings, blocked dates and Pricing. Booked nights cannot be selected.</div>');
    } else {
      left += card('About and contact sections', 'Show, hide and reorder', secRows(S.pageSections.about, 'about', ro));
      left += card('Your story', null, field('story', 'Our story', C2.story, storyText(), { area: true, rows: 5 }));
    }
    var so = social();
    left += card('Contact and social', 'Shown in the footer of every page', field('whatsapp', 'WhatsApp number', C2.whatsapp, ws.phone || '+60 12-345 6789', { hint: 'The WhatsApp buttons open a chat with this number.', type: 'tel' }) +
      '<div class="wb-two">' + field('instagram', 'Instagram', so.instagram, 'handle', {}) + field('facebook', 'Facebook', so.facebook, 'page name', {}) + '</div>' + field('tiktok', 'TikTok', so.tiktok, 'handle (optional)', {}) +
      '<div class="xs muted">Email, phone and address come from Brand & Setup' + (ws.email || ws.phone ? ': ' + esc([ws.email, ws.phone].filter(Boolean).join(' · ')) : '') + '. Leave a social field empty to hide it.</div>');
    left += card('Search engines', 'How the site appears on Google', field('seoTitle', 'Page title', S.seo.title, seoTitle(), { max: 60 }) + field('seoDesc', 'Meta description', S.seo.desc, seoDesc(), { area: true, max: 160, rows: 4 }) + '<div class="wb-serp" data-serp>' + serpHTML() + '</div>');
    left += '<div class="note brand wb-brandnote"><b>Colours and logo come from Brand & Setup.</b> Every design applies your main colour, second colour and logo in its own way, so a new logo restyles the whole site.' + (O.can('brand') ? '<div><button type="button" class="btn btn-quiet btn-sm" data-act="brand">Open Brand & Setup</button></div>' : '') + '</div>';

    var x0 = F.byId[ctxFor(t, 'property', {}).pid];
    var path = st.page === 'home' ? '/' : st.page === 'property' ? '/stays/' + (x0 ? x0.slug : 'your-home') : '/about';
    var right = '<div class="card wb-prevcard"><div class="wb-prevbar">' + U.seg([['home', 'Home'], ['property', 'Property'], ['about', 'About']], st.page, 'data-pagetab') + '<span class="spacer"></span>' + U.seg([['desktop', 'Desktop'], ['phone', 'Phone']], st.device, 'data-device') + '<button type="button" class="btn btn-ghost btn-sm" data-act="full" aria-label="Full screen preview">' + O.icon('eye') + '<span class="wb-hide-sm">Full screen</span></button></div>' +
      '<div class="wb-stage dev-' + st.device + '">' + (st.device === 'phone' ? '<div class="phone"><div class="phone-screen"><div class="wb-site" id="wb-site">' + renderSite(t, st.page, {}) + '</div></div></div>' :
        '<div class="wb-browser"><div class="wb-chrome"><i></i><i></i><i></i><span class="wb-url">' + O.icon('lock') + '<span>' + esc(ws.domain + path) + '</span></span></div><div class="wb-viewport"><div class="wb-fit" data-fit="1280" id="wb-site">' + renderSite(t, st.page, {}) + '</div></div></div>') + '</div>' +
      '<div class="card-foot">The preview is clickable: open a home, pick dates on the calendar and try the forms. Nothing is booked or sent from the preview.</div></div>';
    return '<div class="wb-mtabs">' + U.seg([['edit', 'Edit'], ['preview', 'Preview']], st.mtab, 'data-mtab') + '</div><div class="wb-editor m-' + st.mtab + '"><div class="wb-left stack">' + left + '</div><div class="wb-right">' + right + publishCard() + '</div></div>';
  }
  function featIds() { var F = facts(); var ids = site().featured.filter(function (id) { return F.byId[id]; }); return ids; }
  function featCount() { var n = featIds().length; return n ? n + ' selected, shown in this order' : 'Showing the first 6 homes'; }
  function serpHTML() { return '<div class="xs muted">' + esc('https://' + wsInfo().domain) + '</div><div class="wb-serp-t">' + esc(seoTitle()) + '</div><div class="small muted">' + esc(seoDesc()) + '</div>'; }
  function publishCard() {
    var P = pubState(), ws = wsInfo();
    return '<div class="card wb-pub"><div class="card-head"><div><h3>Publishing</h3><div class="sub">' + esc(ws.domain) + '</div></div>' + (P.live ? (P.changed ? U.pill('Unpublished changes', 'warn') : U.pill('Up to date', 'ok')) : U.pill('Not published', 'neutral')) + '</div><div class="card-body">' +
      (P.logs.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Design</th><th>By</th></tr></thead><tbody>' + P.logs.slice(0, 4).map(function (l) { return '<tr><td class="nowrap">' + esc(fmt.dateTime(l.at)) + '</td><td>' + esc(tplName(l.template)) + '</td><td>' + esc(staffName(l.by)) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="small muted">Nothing published yet.</div>') +
      '<div class="row-flex wrap" style="margin-top:12px"><button type="button" class="btn btn-primary" data-act="publish"' + dis(canPublish(), NO_PUB) + '>' + O.icon('upload') + 'Publish to ' + esc(ws.domain) + '</button></div><div class="xs muted" style="margin-top:8px">Prototype: publishing is simulated and no site goes live.</div></div></div>';
  }

  /* full-screen preview */
  function fullHTML() {
    var f = st.full, t = tplOf(f.t), S = site(), i = TPL.indexOf(t), small = window.innerWidth < 1000, isCur = t.id === S.template;
    var use = isCur ? U.pill('In use', 'brand') : '<button type="button" class="btn btn-primary btn-sm wb-use" data-act="use" data-t="' + t.id + '"' + dis(canEdit(), NO_EDIT) + '>Use this design</button>';
    var body = f.device === 'phone' ? '<div class="phone"><div class="phone-screen"><div class="wb-site" id="wb-fsite">' + renderSite(t, f.page, {}) + '</div></div></div>' :
      small ? '<div class="wb-fitbox"><div class="wb-fit" data-fit="1280" id="wb-fsite">' + renderSite(t, f.page, {}) + '</div></div>' : '<div class="wb-site wb-fullsite" id="wb-fsite">' + renderSite(t, f.page, {}) + '</div>';
    return '<div class="wb-full" role="dialog" aria-modal="true" aria-label="' + esc(t.name + ' preview') + '"><div class="wb-fullbar"><div class="wb-fnav"><button type="button" class="icon-btn" data-act="step" data-dir="-1" aria-label="Previous design">' + O.icon('left') + '</button><div class="wb-ftitle"><b>' + esc(t.name) + '</b><span class="xs muted">' + (i + 1) + ' of ' + TPL.length + ' · ' + esc(t.best) + '</span></div><button type="button" class="icon-btn" data-act="step" data-dir="1" aria-label="Next design">' + O.icon('right') + '</button></div>' +
      '<span class="spacer"></span><div class="wb-fctl">' + U.seg([['home', 'Home'], ['property', 'Property'], ['about', 'About']], f.page, 'data-fpage') + U.seg([['desktop', 'Desktop'], ['phone', 'Phone']], f.device, 'data-fdevice') + '</div>' + use +
      '<button type="button" class="icon-btn" data-act="close-full" aria-label="Close preview">' + O.icon('x') + '</button></div><div class="wb-fullbody dev-' + f.device + '">' + body + '</div></div>';
  }

  function fitAll(scope) {
    O.$$('[data-fit]', scope || document).forEach(function (el) {
      var w = el.parentElement.clientWidth; if (!w) return;
      el.style.width = el.dataset.fit + 'px';
      el.style.zoom = String(Math.min(1, w / +el.dataset.fit));
    });
  }

  /* =====================================================================
     RENDER + EVENTS
     ===================================================================== */
  function busy(root) { var a = document.activeElement; return !!(a && root.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)); }
  function render(root, ctx) {
    cache = null; gid = 0;
    if (!O.can('website')) { root.innerHTML = U.locked('Website builder', { reason: 'permission' }); return; }
    var S = site(), t = tplOf(S.template), phone = window.innerWidth < 760;
    if (ctx.fresh) { st.full = null; if (ctx.params && ctx.params.tab) st.view = ctx.params.tab; st.device = phone ? 'phone' : 'desktop'; st.mtab = 'edit'; }
    ctx.setActions('<button type="button" class="btn btn-ghost" data-act="full">' + O.icon('eye') + '<span>Preview site</span></button><button type="button" class="btn btn-primary" data-act="publish"' + dis(canPublish(), NO_PUB) + '>' + O.icon('upload') + '<span>Publish</span></button>');
    var P = pubState();
    root.innerHTML = '<div class="pg-website">' + statusBar() +
      (canEdit() ? '' : '<div class="note warn wb-ro">You can browse the designs and previews. Changing the website needs “Edit the website” access in Staff Access.</div>') +
      '<div class="tabs" role="tablist"><button type="button" role="tab" data-view="gallery" aria-selected="' + (st.view === 'gallery') + '" class="' + (st.view === 'gallery' ? 'on' : '') + '">Designs <span class="pill neutral">' + TPL.length + '</span></button><button type="button" role="tab" data-view="editor" aria-selected="' + (st.view === 'editor') + '" class="' + (st.view === 'editor' ? 'on' : '') + '">Edit site' + (P.changed ? ' <span class="pill warn">Draft</span>' : '') + '</button></div>' +
      '<div class="wb-body">' + (st.view === 'gallery' ? galleryHTML() : editorHTML()) + '</div>' + (st.full ? fullHTML() : '') + '</div>';
    document.documentElement.classList.toggle('wb-lock', !!st.full);
    requestAnimationFrame(function () { fitAll(root); });
    ctx.actionsEl.onclick = function (e) { var b = e.target.closest('[data-act]'); if (b && !b.disabled) handle(b, e, root, ctx); };
    root.onclick = function (e) { onClick(e, root, ctx); };
    root.oninput = function (e) { onInput(e, root); };
    root.onchange = function (e) { onChange(e, root, ctx); };
    root.onsubmit = function (e) { e.preventDefault(); };
    root.onkeydown = function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('wb-thumb')) { e.preventDefault(); handle(e.target, e, root, ctx); } };
    root.onfocusout = function () { setTimeout(function () { if (pendingRemote && !busy(root)) { pendingRemote = false; ctx.rerender(); } }, 50); };
    var onKey = function (e) {
      if (!st.full || document.querySelector('.modal-back')) return;
      var typing = e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
      if (e.key === 'Escape') { st.full = null; ctx.rerender(); }
      else if (!typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) step(e.key === 'ArrowLeft' ? -1 : 1, ctx);
    };
    var tmr, onResize = function () { clearTimeout(tmr); tmr = setTimeout(function () { fitAll(root); }, 120); };
    document.addEventListener('keydown', onKey); window.addEventListener('resize', onResize);
    ctx.onLeave(function () { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); document.documentElement.classList.remove('wb-lock'); if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; setTimeout(emitNow, 0); } });
    /* changes from teammates (or other pages) re-render, but never while someone is typing here */
    ctx.on('data', function () { if (selfEmit) return; cache = null; if (busy(root)) { pendingRemote = true; return; } ctx.rerender(); });
  }
  function step(dir, ctx) { var i = TPL.indexOf(tplOf(st.full.t)); st.full.t = TPL[(i + dir + TPL.length) % TPL.length].id; ctx.rerender(); var fb = O.$('.wb-fullbody'); if (fb) fb.scrollTop = 0; }
  function refreshPreview(root) {
    var S = site(), t = tplOf(S.template); cache = null;
    var el = O.$('#wb-site', root); if (el) el.innerHTML = renderSite(t, st.page, {});
    var fe = O.$('#wb-fsite', root); if (fe && st.full) fe.innerHTML = renderSite(tplOf(st.full.t), st.full.page, {});
    var serp = O.$('[data-serp]', root); if (serp) serp.innerHTML = serpHTML();
  }
  function keepScroll(root, fn) {
    var boxes = O.$$('.wb-viewport, .wb-fullbody, .phone-screen, .wb-fitbox', root).map(function (b) { return [b, b.scrollTop]; });
    fn(); boxes.forEach(function (x) { x[0].scrollTop = x[1]; });
  }
  function scrollSiteTop(root) { O.$$('.wb-viewport, .wb-fullbody, .phone-screen, .wb-fitbox', root).forEach(function (b) { b.scrollTop = 0; }); }

  function onInput(e, root) {
    var f = e.target.dataset.field; if (!f || !canEdit()) return;
    var S = site(), v = e.target.value;
    if (f === 'seoTitle') S.seo.title = v;
    else if (f === 'seoDesc') S.seo.desc = v;
    else if (f === 'instagram' || f === 'facebook' || f === 'tiktok') { var so = social(); so[f] = v.trim().replace(/^@/, ''); S.social = so; }
    else S.content[f] = v;
    save(true);
    var cnt = O.$('[data-count="' + f + '"]', root);
    if (cnt) { var max = +cnt.dataset.max, len = (v || e.target.placeholder).length; cnt.textContent = len + '/' + max; cnt.classList.toggle('over', len > max); }
    keepScroll(root, function () { refreshPreview(root); });
  }
  function onChange(e, root, ctx) {
    var t = e.target, S = site();
    if (t.dataset.feat) {
      if (!canEdit()) return;
      var F = facts(), id = t.dataset.feat;
      S.featured = S.featured.filter(function (x) { return F.byId[x]; }); /* drop homes that no longer exist */
      var i = S.featured.indexOf(id);
      if (t.checked && i < 0) S.featured.push(id);
      if (!t.checked && i >= 0) S.featured.splice(i, 1);
      save(); ctx.rerender(); return;
    }
    if (t.dataset.act === 'pp') { S.propertyId = t.value; save(); ctx.rerender(); }
  }
  function moveSec(kind, i, dir) {
    var S = site(), list = kind === 'home' ? editHome() : S.pageSections[kind], j = i + dir;
    if (!list || j < 0 || j >= list.length) return;
    var tmp = list[i]; list[i] = list[j]; list[j] = tmp; save();
  }
  function onClick(e, root, ctx) {
    var S = site(), b;
    var inSite = e.target.closest('.wbs');
    if (inSite && !e.target.closest('.wb-thumb') && !e.target.closest('.wb-tplmini')) {
      if (e.target.closest('a[href]')) return; /* WhatsApp opens in a new tab */
      b = e.target.closest('[data-wfaq]');
      if (b) { var k = +b.dataset.wfaq, open = b.parentElement.classList.toggle('open'); st.faqOpen[k] = open; b.setAttribute('aria-expanded', open); O.$('i', b).textContent = open ? '−' : '+'; return; }
      b = e.target.closest('[data-wday]');
      if (b) { pickDay(b.dataset.pid, b.dataset.wday, root); return; }
      b = e.target.closest('[data-wpid]');
      if (b) { S.propertyId = b.dataset.wpid; goSitePage('property', root, ctx); return; }
      b = e.target.closest('[data-wnav]');
      if (b) { goSitePage(b.dataset.wnav, root, ctx, b.dataset.anchor); return; }
      b = e.target.closest('[data-wact]');
      if (b && b.tagName !== 'FORM') { siteAction(b, root, ctx, inSite); return; }
      return;
    }
    b = e.target.closest('[data-view]'); if (b) { st.view = b.dataset.view; ctx.rerender(); return; }
    b = e.target.closest('[data-pagetab]'); if (b) { st.page = b.dataset.pagetab; ctx.rerender(); return; }
    b = e.target.closest('[data-device]'); if (b) { st.device = b.dataset.device; ctx.rerender(); return; }
    b = e.target.closest('[data-mtab]'); if (b) { st.mtab = b.dataset.mtab; ctx.rerender(); window.scrollTo(0, 0); return; }
    b = e.target.closest('[data-fpage]'); if (b) { st.full.page = b.dataset.fpage; ctx.rerender(); return; }
    b = e.target.closest('[data-fdevice]'); if (b) { st.full.device = b.dataset.fdevice; ctx.rerender(); return; }
    b = e.target.closest('[data-act]'); if (b && b.tagName !== 'SELECT' && !b.disabled) handle(b, e, root, ctx);
  }
  function handle(b, e, root, ctx) {
    var S = site(), a = b.dataset.act;
    if (a === 'preview') { st.full = { t: b.dataset.t, page: b.dataset.page || 'home', device: window.innerWidth < 760 ? 'phone' : 'desktop' }; ctx.rerender(); return; }
    if (a === 'full') { st.full = { t: S.template, page: st.view === 'editor' ? st.page : 'home', device: window.innerWidth < 760 ? 'phone' : (st.view === 'editor' ? st.device : 'desktop') }; ctx.rerender(); return; }
    if (a === 'close-full') { st.full = null; ctx.rerender(); return; }
    if (a === 'step') { step(+b.dataset.dir, ctx); return; }
    if (a === 'use') {
      if (!canEdit()) { U.toast(NO_EDIT, 'bad'); return; }
      var t = tplOf(b.dataset.t), prev = tplOf(S.template);
      if (t.id === prev.id) return;
      S.template = t.id; st.full = null; st.view = 'editor'; st.page = 'home'; st.mtab = 'preview';
      save();
      U.toast('Now using ' + t.name + '. Your text, homes, sections, contact details and SEO carried over from ' + prev.name + '. Publish when you are happy.', 'ok');
      ctx.rerender(); window.scrollTo(0, 0); return;
    }
    if (a === 'edit') { st.view = 'editor'; if (b.dataset.page) st.page = b.dataset.page; ctx.rerender(); return; }
    if (a === 'gallery') { st.view = 'gallery'; ctx.rerender(); return; }
    if (a === 'brand') { O.go('brand'); return; }
    if (a === 'props') { if (O.pages.properties && O.can('properties')) O.go('properties'); return; }
    if (a === 'toggle') { if (!canEdit()) return; var list = b.dataset.kind === 'home' ? editHome() : S.pageSections[b.dataset.kind], s = list[+b.dataset.i]; if (!s) return; s.on = s.on === false; save(); ctx.rerender(); return; }
    if (a === 'up' || a === 'down') { if (!canEdit()) return; moveSec(b.dataset.kind, +b.dataset.i, a === 'up' ? -1 : 1); ctx.rerender(); return; }
    if (a === 'reset-copy') { if (!canEdit()) return; ['headline', 'sub', 'cta', 'intro', 'introTitle'].forEach(function (k) { S.content[k] = ''; }); save(); ctx.rerender(); return; }
    if (a === 'publish') { publish(ctx); return; }
  }
  function goSitePage(page, root, ctx, anchor) {
    if (st.full) st.full.page = page; else st.page = page;
    ctx.rerender(); scrollSiteTop(root);
    if (anchor) setTimeout(function () {
      var host = O.$('#wb-fsite', root) || O.$('#wb-site', root), el = host && O.$('[data-wsec="' + anchor + '"]', host);
      if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 80);
  }
  function pickDay(pid, iso, root) {
    var x = facts().byId[pid]; if (!x) return;
    var sel = defaultSel(x);
    if (!sel.from || sel.to) { if (isBooked(pid, iso)) { U.toast('That night is already booked. Pick another check-in date.', 'bad'); return; } st.sel[pid] = { from: iso, to: null }; }
    else if (iso <= sel.from) { if (isBooked(pid, iso)) return; st.sel[pid] = { from: iso, to: null }; }
    else {
      var clash = d.range(sel.from, d.add(iso, -1)).some(function (n) { return isBooked(pid, n); });
      if (clash) { U.toast('Some nights in between are booked. Pick a shorter stay.', 'bad'); return; }
      st.sel[pid] = { from: sel.from, to: iso };
    }
    keepScroll(root, function () { refreshPreview(root); });
  }
  function siteAction(b, root, ctx, siteEl) {
    var a = b.dataset.wact;
    if (a === 'menu') { var h = b.closest('.w-header'); if (h) h.classList.toggle('open'); return; }
    if (a === 'scroll') { var car = O.$('.w-carousel', b.closest('.w-sec')); if (car) { var c1 = car.firstElementChild; car.scrollBy({ left: (+b.dataset.dir) * ((c1 ? c1.getBoundingClientRect().width : 300) + 20), behavior: 'smooth' }); } return; }
    if (a === 'search') { var F = facts(); if (F.props.length) goSitePage('property', root, ctx); else U.toast('Add properties to let guests search your homes.'); return; }
    if (a === 'addprops') { U.toast('This is a placeholder. Add properties and your homes appear here with photos and prices.'); return; }
    if (a === 'social') { U.toast(b.dataset.net === 'Email' ? 'On the live site this opens an email to ' + b.dataset.h + '.' : 'On the live site this opens ' + b.dataset.net + ' (' + b.dataset.h + ').'); return; }
    if (a === 'enquire') { U.toast('Preview: on the live site this enquiry arrives in Guest inbox.', 'ok'); return; }
    if (a === 'book') {
      var pid = b.dataset.pid; if (!pid) { if (facts().props.length) goSitePage('property', root, ctx); else U.toast('Add properties to take bookings on your site.'); return; }
      var x = facts().byId[pid], q = x && quote(x);
      if (!q && x && x.from == null) { U.toast('No nightly rates yet for this home, so guests would send an enquiry instead. Set rates in Pricing.'); return; }
      if (!q) { U.toast('Pick a check-out date on the calendar first.', 'bad'); return; }
      U.modal({ title: 'Guest checkout (preview)', sub: x.name + ' · ' + d.fmtRange(q.from, q.to),
        body: '<dl class="kv"><dt>Stay</dt><dd>' + esc(d.fmtY(q.from)) + ' → ' + esc(d.fmtY(q.to)) + '</dd><dt>' + plural(q.nights, 'night') + (q.nights > 1 ? ' (avg ' + rm(q.avg) + ' a night)' : '') + '</dt><dd>' + rm(q.acc) + '</dd><dt>Cleaning fee</dt><dd>' + rm(q.cleaning) + '</dd><dt class="tot">Total</dt><dd class="tot">' + rm(q.total) + '</dd></dl><div class="note" style="margin-top:12px">On the live site the guest pays here, the booking lands in Bookings and the calendar as a direct booking, and the invoice is sent automatically. No booking is created from the preview.</div>',
        actions: [{ label: 'Close', kind: 'ghost' }].concat(O.can('bookings') ? [{ label: 'Open Bookings', kind: 'primary', onClick: function () { O.go('bookings'); } }] : []) });
    }
  }
  function publish(ctx) {
    if (!canPublish()) { U.toast(NO_PUB, 'bad'); return; }
    var S = site(), t = tplOf(S.template), ws = wsInfo(), F = facts(), P = pubState();
    var checks = [
      [F.props.length > 0, F.props.length ? plural(F.props.length, 'property page', 'property pages') + ' with live availability' : 'No properties yet: add them so guests have homes to book'],
      [seoTitle().length <= 60, 'Page title is ' + seoTitle().length + ' characters' + (seoTitle().length <= 60 ? '' : ' (Google shows about 60)')],
      [seoDesc().length <= 160, 'Meta description is ' + seoDesc().length + ' characters' + (seoDesc().length <= 160 ? '' : ' (keep it under 160)')],
      F.props.length ? [F.props.filter(function (x) { return x.photos.length; }).length > 0, F.props.filter(function (x) { return x.photos.length; }).length + ' of ' + plural(F.props.length, 'home') + ' have photos' + (F.props.some(function (x) { return !x.photos.length; }) ? ' (illustrations are used for the rest)' : '')] : null,
      [!!waNumber(), waNumber() ? 'WhatsApp button goes to ' + waNumber() : 'Add a WhatsApp number in Contact and social']
    ].filter(Boolean);
    U.modal({ title: 'Publish website', sub: 'https://' + ws.domain,
      body: '<div class="stack"><div class="row-flex wrap"><b>' + esc(t.name) + '</b><span class="xs muted">' + (P.live ? (tplOf(P.live.template).id === t.id ? 'updates the live site' : 'replaces ' + esc(tplName(P.live.template))) + ', last published ' + esc(fmt.dateTime(P.live.at)) : 'first publish') + '</span></div>' +
        '<ul class="wb-checks">' + checks.map(function (c) { return '<li class="' + (c[0] ? 'ok' : 'warn') + '">' + (c[0] ? '✓' : '!') + ' ' + esc(c[1]) + '</li>'; }).join('') + '</ul><div class="xs muted">Pages: Home, ' + (F.props.length ? plural(F.props.length, 'property page', 'property pages') + ', ' : '') + 'About and contact. Colours and logo follow Brand & Setup.</div><div class="note">Prototype: publishing is simulated and no site goes live.</div></div>',
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Publish now', kind: 'primary', onClick: function () {
        S.published = { template: t.id, at: D.NOW, by: O.state.viewer }; S.changed = false;
        S.log.unshift({ template: t.id, at: D.NOW, by: O.state.viewer, what: 'Published' }); if (S.log.length > 30) S.log.length = 30;
        U.toast('Published ' + t.name + ' to https://' + ws.domain, 'ok');
        emitNow('website-published'); ctx.rerender();
      } }] });
  }

  O.page('website', { desc: '8 complete website designs with your logo, colours, homes and prices', noDataRerender: true, render: render });
})();
