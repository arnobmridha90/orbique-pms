/* Website builder — 12 landing page templates + 2 extra pages (Property & booking, About & contact).
   Every template is rendered live from O.data with the workspace logo and brand tokens, so it follows Brand & Setup.
   Site styles live in pages/website.css (selectors .pg-website and .wbs). State lives in D.website (in memory). */
(function () {
  var O = window.O, D = O.data, M = O.metrics, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt, C = O.color;
  var st = { view: 'gallery', style: 'all', page: 'home', device: 'desktop', full: null, sel: {}, faqOpen: {} };
  var gid = 0;

  /* =====================================================================
     DATA HELPERS
     ===================================================================== */
  function cityOf(p) {
    var a = p.area;
    if (/Penang|George Town/.test(a)) return 'Penang';
    if (/Kuala Lumpur/.test(a)) return 'Kuala Lumpur';
    if (/Cameron/.test(a)) return 'Cameron Highlands';
    if (/Melaka/.test(a)) return 'Melaka';
    return a.split(',').pop().trim();
  }
  var CITY_ORDER = ['Penang', 'Kuala Lumpur', 'Melaka', 'Cameron Highlands'];
  var SCENE_OF = { bf3b: 'sea', bf1a: 'sea', mrs: 'marina', hv2: 'hills', or4: 'city', kls: 'night', bbs: 'city', mkr: 'pool', bgf: 'garden', hsg: 'heritage', bfc: 'sea', mrl: 'river' };
  var CITY_SCENE = { 'Penang': 'heritage', 'Kuala Lumpur': 'night', 'Melaka': 'river', 'Cameron Highlands': 'hills' };
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function price(pid, iso) { var o = D.priceOverrides && D.priceOverrides[pid]; return (o && o[iso]) || D.rateFor(pid, iso, 0); }
  function isBooked(pid, iso) {
    for (var i = 0; i < D.bookings.length; i++) { var b = D.bookings[i]; if (b.propertyId === pid && b.status !== 'cancelled' && b.checkIn <= iso && iso < b.checkOut) return true; }
    for (var j = 0; j < D.blocks.length; j++) { var k = D.blocks[j]; if (k.propertyId === pid && k.start <= iso && iso < k.end) return true; }
    return false;
  }
  function mode(arr) { var c = {}, best = null; arr.forEach(function (x) { c[x] = (c[x] || 0) + 1; if (best == null || c[x] > c[best]) best = x; }); return best; }
  var cache = null;
  function facts() { /* computed once per render pass */
    if (cache) return cache;
    var reviews = D.reviews;
    var props = D.properties.map(function (p) {
      var rs = reviews.filter(function (r) { return r.propertyId === p.id; });
      var from = Infinity; for (var i = 1; i <= 30; i++) { var iso = d.add(D.TODAY, i); from = Math.min(from, price(p.id, iso)); }
      var cf = D.bookings.filter(function (b) { return b.propertyId === p.id && b.cleaningFee; }).map(function (b) { return b.cleaningFee; }).sort(function (a, b) { return a - b; });
      return {
        p: p, id: p.id, name: p.name, short: p.short, city: cityOf(p), area: p.area, type: p.type, beds: p.beds, sleeps: Math.max(2, p.beds * 2),
        from: from, rating: rs.length ? rs.reduce(function (s, r) { return s + r.stars; }, 0) / rs.length : null, nReviews: rs.length,
        cleaning: cf.length ? cf[Math.floor(cf.length / 2)] : 80, scene: SCENE_OF[p.id] || 'living', slug: slug(p.name),
        parking: !/^No parking|^Street/.test(p.parking), lockBrand: p.lockBrand
      };
    });
    var byId = {}; props.forEach(function (x) { byId[x.id] = x; });
    var cities = CITY_ORDER.map(function (c) { var ps = props.filter(function (x) { return x.city === c; }); return { name: c, props: ps, from: Math.min.apply(null, ps.map(function (x) { return x.from; })), scene: CITY_SCENE[c] }; }).filter(function (c) { return c.props.length; });
    var avg = reviews.reduce(function (s, r) { return s + r.stars; }, 0) / (reviews.length || 1);
    var good = reviews.filter(function (r) { return r.stars === 5 && r.text.length >= 50 && r.text.length <= 210; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var seen = {}, top = good.filter(function (r) { if (seen[r.text]) return false; seen[r.text] = 1; return true; });
    var hosted = D.bookings.filter(function (b) { return b.status === 'checked_out' || b.status === 'checked_in'; }).length;
    var firstStay = D.bookings.reduce(function (m, b) { return b.checkIn < m ? b.checkIn : m; }, '9999');
    cache = {
      props: props, byId: byId, cities: cities, avg: avg, nReviews: reviews.length, top: top, hosted: hosted, firstStay: firstStay,
      checkIn: mode(D.bookings.map(function (b) { return b.checkInTime; })) || '15:00',
      checkOut: mode(D.bookings.map(function (b) { return b.checkOutTime; })) || '11:00',
      noParking: props.filter(function (x) { return !x.parking; }).length
    };
    return cache;
  }
  function cityList(F) { var n = F.cities.map(function (c) { return c.name; }); return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; }
  function rmoney(n) { return 'RM ' + fmt.num(n); }
  function stars(n) { var s = ''; for (var i = 1; i <= 5; i++) s += i <= Math.round(n) ? '★' : '☆'; return s; }
  function firstName(g) { return String(g).replace(/^The /, '').split(' ')[0]; }

  /* =====================================================================
     SITE STATE (in memory, shared by every viewer of this prototype)
     ===================================================================== */
  function site() {
    if (!D.website) {
      D.website = {
        template: 'harbour', changed: false,
        content: { headline: '', sub: '', cta: '', story: '', whatsapp: '' },
        featured: ['bf3b', 'hsg', 'kls', 'hv2', 'bfc', 'mrl'],
        sections: {},
        pageSections: {
          property: [{ id: 'gallery', on: true }, { id: 'overview', on: true }, { id: 'amenities', on: true }, { id: 'calendar', on: true }, { id: 'reviews', on: true }, { id: 'location', on: true }],
          about: [{ id: 'story', on: true }, { id: 'team', on: true }, { id: 'stats', on: true }, { id: 'faq', on: true }, { id: 'contact', on: true }]
        },
        seo: { title: '', desc: '' },
        propertyId: 'bf3b',
        published: { template: 'harbour', at: '2026-09-14T16:20', by: 's1' },
        log: [{ template: 'harbour', at: '2026-09-14T16:20', by: 's1', what: 'Published' }, { template: 'harbour', at: '2026-08-02T11:05', by: 's2', what: 'Published' }]
      };
    }
    return D.website;
  }
  function tplSections(t) {
    var S = site();
    if (!S.sections[t.id]) S.sections[t.id] = t.sections.map(function (x) { return { id: x[0], v: x[1], on: true }; });
    return S.sections[t.id];
  }
  function copyOf(t) {
    var c = site().content, F = facts(), ws = O.ws();
    var dflt = typeof t.copy === 'function' ? t.copy(F, ws) : t.copy;
    return { headline: c.headline || dflt[0], sub: c.sub || dflt[1], cta: c.cta || dflt[2] };
  }
  function storyText() {
    var F = facts(), ws = O.ws();
    return site().content.story || (ws.name + ' started with one loft on Gurney Drive. Today we look after ' + F.props.length + ' homes in ' + cityList(F) + ', from a heritage shophouse in George Town to a villa in the tea hills. Every home is cleaned by our own team and checked before you arrive, and a real person answers your messages.');
  }
  function waNumber() { return site().content.whatsapp || O.ws().phone; }
  function seoTitle() { var F = facts(); return site().seo.title || (O.ws().name + ' | Stays in ' + F.cities.map(function (c) { return c.name === 'Kuala Lumpur' ? 'KL' : c.name; }).join(', ')); }
  function seoDesc() { var F = facts(); return site().seo.desc || ('Book ' + F.props.length + ' serviced homes directly with ' + O.ws().name + '. Self check-in, fast Wi-Fi, an invoice for every stay and no platform fees.'); }
  function touch() { site().changed = true; }
  function canEdit() { return O.can ? O.can('website', 'edit') : true; }
  function canView() { return O.can ? O.can('website', 'view') : true; }

  /* =====================================================================
     ILLUSTRATED "PHOTOS" (no external images: drawn in SVG)
     ===================================================================== */
  function scene(kind, seed) {
    var r = D.rng(D.hash(kind + ':' + (seed || 0))), id = 'wbg' + (++gid), s = '', i;
    function sky(a, b) { return '<defs><linearGradient id="' + id + 's" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient><linearGradient id="' + id + 'w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3E95BF"/><stop offset="1" stop-color="#1F5F86"/></linearGradient></defs><rect width="400" height="300" fill="url(#' + id + 's)"/>'; }
    function clouds() { var c = ''; for (var k = 0; k < 3; k++) { var x = 30 + r() * 320, y = 25 + r() * 50; c += '<g fill="#FFFFFF" opacity="0.75"><ellipse cx="' + x + '" cy="' + y + '" rx="26" ry="8"/><ellipse cx="' + (x + 14) + '" cy="' + (y - 6) + '" rx="16" ry="9"/></g>'; } return c; }
    function palm(x, y, flip) {
      var f = flip ? -1 : 1;
      return '<g transform="translate(' + x + ',' + y + ') scale(' + f + ',1)"><path d="M0 0 C6 -40 2 -80 14 -120" stroke="#6B4F2A" stroke-width="6" fill="none" stroke-linecap="round"/>' +
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
    switch (kind) {
      case 'sea': case 'marina':
        s += sky('#7EC3E8', '#DDF0FA') + '<circle cx="' + (250 + r() * 90) + '" cy="62" r="24" fill="#FFF3D1"/>' + clouds();
        s += '<path d="M0 170 L60 150 L120 162 L190 142 L260 160 L320 148 L400 166 V180 H0Z" fill="#8DB3A8"/>';
        if (kind === 'marina' || r() > 0.4) s += towers(r() > 0.5 ? 6 : 250, 4, 182, '#E8EDF1', '#B8C6D2');
        s += '<rect y="178" width="400" height="80" fill="url(#' + id + 'w)"/>';
        for (i = 0; i < 9; i++) s += '<rect x="' + (r() * 380) + '" y="' + (186 + r() * 60) + '" width="' + (10 + r() * 26) + '" height="2" rx="1" fill="#FFFFFF" opacity="0.55"/>';
        if (kind === 'marina') { s += '<rect y="240" width="400" height="60" fill="#D9D2C3"/>'; for (i = 0; i < 4; i++) { var bx = 30 + i * 90; s += '<path d="M' + bx + ' 236 h50 l-8 10 h-36z" fill="#FFFFFF"/><path d="M' + (bx + 24) + ' 236 V196 L' + (bx + 44) + ' 230Z" fill="#F4F1EA"/>'; } }
        else s += '<path d="M0 238 C80 228 160 246 240 236 C300 230 360 240 400 236 V300 H0Z" fill="#EED9AE"/>' + palm(r() > 0.5 ? 60 : 340, 286, r() > 0.5);
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
        for (i = 0; i < 3; i++) s += '<g transform="translate(' + (70 + i * 110) + ',282)"><rect width="60" height="8" rx="3" fill="#FFFFFF"/><rect x="40" y="-14" width="22" height="8" rx="3" fill="#FFFFFF" transform="rotate(-24 40 -6)"/></g>';
        s += plant(380, 230) + plant(20, 230);
        break;
      case 'hills':
        s += sky('#CFE6EF', '#F3F8F5') + '<circle cx="90" cy="70" r="22" fill="#FFF8E6"/>';
        s += '<path d="M0 150 C60 110 120 120 180 96 C240 74 300 104 400 92 V300 H0Z" fill="#9DBAB0"/>';
        s += '<path d="M0 190 C80 150 160 170 230 140 C300 112 350 150 400 140 V300 H0Z" fill="#6E9A6A"/>';
        s += '<path d="M0 240 C90 200 200 220 280 190 C330 172 370 188 400 184 V300 H0Z" fill="#4E7D46"/>';
        for (i = 0; i < 7; i++) s += '<path d="M0 ' + (250 + i * 9) + ' C90 ' + (212 + i * 9) + ' 200 ' + (232 + i * 9) + ' 280 ' + (202 + i * 9) + ' C330 ' + (184 + i * 9) + ' 370 ' + (200 + i * 9) + ' 400 ' + (196 + i * 9) + '" stroke="#3B6634" stroke-width="3" fill="none" opacity="0.45"/>';
        s += '<g transform="translate(' + (250 + r() * 60) + ',150)"><rect width="56" height="32" fill="#F1E7D6"/><path d="M-6 0 L28 -20 L62 0Z" fill="#8A4B2F"/><rect x="8" y="10" width="10" height="10" fill="#7FA8C4"/><rect x="36" y="14" width="10" height="18" fill="#6B4F2A"/></g>';
        s += '<rect y="120" width="400" height="40" fill="#FFFFFF" opacity="0.25"/>';
        break;
      case 'heritage':
        var walls = ['#F2D7A6', '#B9DCCF', '#F3C1B5', '#D7E3F1', '#EAD9F0'];
        s += sky('#BFE0F2', '#EAF5FB');
        for (i = 0; i < 3; i++) {
          var hx = -20 + i * 150, wc = walls[(D.hash(kind + seed) + i) % walls.length];
          s += '<rect x="' + hx + '" y="70" width="146" height="230" fill="' + wc + '"/><rect x="' + (hx - 4) + '" y="60" width="154" height="14" fill="#B5523B"/>';
          for (var w2 = 0; w2 < 3; w2++) { var wx = hx + 16 + w2 * 42; s += '<rect x="' + wx + '" y="92" width="26" height="54" rx="13" fill="#FFFFFF" opacity="0.7"/><rect x="' + (wx - 8) + '" y="94" width="8" height="52" fill="#3F7A5A"/><rect x="' + (wx + 26) + '" y="94" width="8" height="52" fill="#3F7A5A"/>'; }
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
        s += '<g transform="translate(120,110)"><rect width="170" height="96" fill="#F5EFE4"/><path d="M-12 0 L85 -46 L182 0Z" fill="#6E6A64"/><rect x="18" y="24" width="34" height="30" fill="#7FA8C4"/><rect x="118" y="24" width="34" height="30" fill="#7FA8C4"/><rect x="72" y="44" width="28" height="52" fill="#8C6A48"/></g>';
        for (i = 0; i < 5; i++) { var gx = i < 2 ? 20 + i * 50 : 300 + (i - 2) * 40; s += '<rect x="' + (gx - 3) + '" y="170" width="6" height="40" fill="#6B4F2A"/><circle cx="' + gx + '" cy="160" r="' + (22 + r() * 10) + '" fill="#3F7A45"/>'; }
        s += '<path d="M190 300 L200 206 L212 206 L230 300Z" fill="#E6DCC8"/>';
        break;
      case 'bed':
        s += room('#E9E4DD', '#B9987A') + '<rect x="250" y="40" width="80" height="60" fill="#FFFFFF"/><rect x="256" y="46" width="68" height="48" fill="#C9D8C3"/><circle cx="290" cy="70" r="12" fill="#E7B98A"/>';
        s += '<rect x="60" y="120" width="230" height="70" rx="6" fill="#8C7B6B"/><rect x="50" y="176" width="250" height="60" rx="6" fill="#FAFAF7"/><rect x="50" y="200" width="250" height="36" rx="4" fill="#C9CED6"/><rect x="80" y="160" width="70" height="26" rx="10" fill="#FFFFFF"/><rect x="190" y="160" width="70" height="26" rx="10" fill="#FFFFFF"/>';
        s += '<rect x="316" y="186" width="44" height="44" fill="#A88B6E"/><path d="M326 186 L338 150 L350 186Z" fill="#F6E3B4"/><rect x="336" y="150" width="4" height="8" fill="#6B5A49"/>';
        break;
      case 'kitchen':
        s += room('#F2F0EC', '#C7B299') + '<rect x="0" y="40" width="400" height="60" fill="#DCE3E8"/>';
        for (i = 0; i < 6; i++) s += '<rect x="' + (8 + i * 66) + '" y="46" width="58" height="48" rx="3" fill="#E9EEF1"/>';
        s += '<rect y="150" width="400" height="80" fill="#DCE3E8"/><rect y="142" width="400" height="10" fill="#F7F7F5"/>';
        for (i = 0; i < 12; i++) s += '<rect x="' + (i * 34) + '" y="104" width="32" height="36" fill="#FFFFFF" stroke="#E4E0D8"/>';
        for (i = 0; i < 3; i++) s += '<path d="M' + (110 + i * 90) + ' 0 V20" stroke="#55606E" stroke-width="2"/><path d="M' + (98 + i * 90) + ' 30 a12 12 0 0 1 24 0Z" fill="#2E3A48"/>';
        s += '<rect x="70" y="232" width="8" height="56" fill="#6B4F2A"/><rect x="58" y="226" width="32" height="8" rx="3" fill="#2E3A48"/><rect x="300" y="232" width="8" height="56" fill="#6B4F2A"/><rect x="288" y="226" width="32" height="8" rx="3" fill="#2E3A48"/>' + plant(200, 142);
        break;
      case 'bath':
        s += '<rect width="400" height="300" fill="#EEF1F3"/>';
        for (i = 0; i < 10; i++) for (var j2 = 0; j2 < 8; j2++) s += '<rect x="' + (i * 40) + '" y="' + (j2 * 38) + '" width="40" height="38" fill="none" stroke="#DDE2E6"/>';
        s += '<rect x="140" y="40" width="120" height="96" rx="48" fill="#CFE0EA" stroke="#B9A88E" stroke-width="4"/><rect x="110" y="170" width="180" height="60" rx="6" fill="#B9A88E"/><ellipse cx="200" cy="172" rx="56" ry="10" fill="#FFFFFF"/><rect x="196" y="148" width="6" height="18" fill="#8A94A3"/>';
        s += '<rect x="310" y="120" width="40" height="80" rx="4" fill="#FFFFFF"/><rect x="310" y="140" width="40" height="6" fill="#C9CED6"/>' + plant(70, 230);
        break;
      default: /* living */
        var sofa = ['#6F8794', '#A0414E', '#3F6E5A', '#8A6A3A', '#55606E'][D.hash(kind + seed) % 5];
        s += room('#EFE7DC', '#C9A97E') + windowView(36, 52, 110, 120) + '<rect x="210" y="60" width="90" height="62" fill="#FFFFFF" stroke="#2E3A48" stroke-width="4"/><path d="M216 112 L246 82 L268 102 L280 92 L294 112Z" fill="#8DB3A8"/>';
        s += '<rect x="170" y="160" width="190" height="54" rx="12" fill="' + sofa + '"/><rect x="160" y="190" width="210" height="44" rx="10" fill="' + sofa + '"/><rect x="186" y="170" width="40" height="30" rx="8" fill="#F2EFE6"/><rect x="300" y="170" width="40" height="30" rx="8" fill="#E8C66A"/>';
        s += '<ellipse cx="200" cy="268" rx="150" ry="20" fill="#E6DCC8"/><rect x="60" y="234" width="80" height="10" rx="3" fill="#6B4F2A"/><rect x="66" y="244" width="6" height="22" fill="#6B4F2A"/><rect x="128" y="244" width="6" height="22" fill="#6B4F2A"/>' + plant(380, 236);
    }
    return '<svg class="wbs-ph" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + s + '</svg>';
  }
  function img(kind, seed, cls, alt) { return '<div class="wbs-img ' + (cls || '') + '" role="img" aria-label="' + esc(alt || 'Photo') + '">' + scene(kind, seed) + '</div>'; }
  function propImg(x, n, cls) { var k = n ? ['living', 'bed', 'kitchen', 'bath'][(n - 1) % 4] : x.scene; return img(k, x.id + n, cls, x.name); }
  var MAP_PATH = 'M36,7 L60,20 L95,30 L120,28 L140,36 L156,42 L185,70 L210,105 L218,150 L222,210 L238,260 L252,308 L270,350 L276,371 L250,384 L234,386 L222,372 L200,350 L159,322 L132,301 L108,266 L92,230 L84,196 L60,182 L54,140 L48,110 L46,80 L46,49 L36,30 Z';
  var PIN = { 'Penang': [38, 96], 'Cameron Highlands': [107, 163], 'Kuala Lumpur': [126, 255], 'Melaka': [162, 318] };

  /* =====================================================================
     TEMPLATES — each has its own hero, header, skin and section mix
     ===================================================================== */
  var STYLES = ['Minimal', 'Bold', 'Editorial', 'Luxury', 'Playful', 'Calm', 'Practical'];
  var TPL = [
    { id: 'harbour', name: 'Harbour', style: 'Minimal', best: 'City and seaside apartments', desc: 'Split hero with a photo collage, search bar and clean property cards.', skin: 'clean', header: 'bar', footer: 'big',
      sections: [['hero'], ['search', 'pill'], ['properties', 'cards'], ['highlights', 'icons'], ['reviews', 'quote'], ['cta', 'band']],
      copy: function (F) { return ['Calm, well-kept homes by the sea and in the city', 'Serviced apartments, villas and heritage houses across ' + cityList(F) + '. Book direct for the best rate.', 'Check availability']; } },
    { id: 'skyline', name: 'Skyline', style: 'Bold', best: 'Multi-city portfolios', desc: 'Full-bleed night skyline, oversized headline and a floating booking bar.', skin: 'bold', header: 'overlay', footer: 'big',
      sections: [['hero'], ['locations', 'tiles'], ['properties', 'carousel'], ['stats', 'band'], ['reviews', 'cards'], ['cta', 'band']],
      copy: function (F) { return ['Your base in the city', F.props.length + ' homes in ' + F.cities.length + ' destinations. Self check-in from ' + fmt.time(F.checkIn) + '.', 'Find a stay']; } },
    { id: 'heritage', name: 'Heritage', style: 'Editorial', best: 'Heritage houses and boutique stays', desc: 'Magazine masthead, serif type, drop-cap story and long-form listings.', skin: 'serif', header: 'center', footer: 'simple',
      sections: [['hero'], ['story', 'editorial'], ['properties', 'list'], ['reviews', 'serif'], ['cta', 'card']],
      copy: ['Old houses, new stories', 'Restored shophouses, riverside lofts and quiet city homes, each with a story of its own.', 'Book your stay'] },
    { id: 'tropika', name: 'Tropika', style: 'Playful', best: 'Beach and family holidays', desc: 'Rounded shapes, wavy dividers, polaroid photos and sticker highlights.', skin: 'round', header: 'pill', footer: 'big',
      sections: [['hero'], ['highlights', 'stickers'], ['properties', 'polaroid'], ['reviews', 'cards'], ['cta', 'whatsapp']],
      copy: ['Holidays that start the moment you arrive', 'Beach condos in Batu Ferringhi, a villa in the tea hills and lofts by the river in Melaka.', 'Plan your trip'] },
    { id: 'mosaic', name: 'Mosaic', style: 'Minimal', best: 'Design-led apartments', desc: 'Bento photo grid hero with a brand tile, image-first property mosaic.', skin: 'clean', header: 'thin', footer: 'simple',
      sections: [['hero'], ['properties', 'mosaic'], ['reviews', 'wall'], ['cta', 'band']],
      copy: ['Designed for slow mornings', 'Hand-picked homes with real kitchens, good beds and fast Wi-Fi.', 'Browse homes'] },
    { id: 'highlands', name: 'Highlands', style: 'Calm', best: 'Retreats, villas and long weekends', desc: 'Side navigation, panoramic hero and a step-by-step stay timeline.', skin: 'calm', header: 'side', footer: 'simple',
      sections: [['hero'], ['story', 'timeline'], ['properties', 'duo'], ['highlights', 'checklist'], ['reviews', 'quote'], ['cta', 'card']],
      copy: ['Cool air, tea hills and room to breathe', 'Escape the heat in the Cameron Highlands, or pick a quiet city home for the week.', 'Plan your escape'] },
    { id: 'concierge', name: 'Concierge', style: 'Luxury', best: 'Premium suites and villas', desc: 'Dark, hairline details, arched photography and numbered residences.', skin: 'deep', header: 'deep', footer: 'deep',
      sections: [['hero'], ['properties', 'numbered'], ['highlights', 'services'], ['reviews', 'serif'], ['cta', 'card']],
      copy: ['Private residences, personally looked after', 'A small collection of suites and villas, with a host on call from arrival to checkout.', 'Reserve a residence'] },
    { id: 'metro', name: 'Metro', style: 'Practical', best: 'Operators in several cities', desc: 'Map-led hero with city pins, stays grouped by city and quick facts.', skin: 'clean', header: 'bar', footer: 'big',
      sections: [['hero'], ['properties', 'bycity'], ['highlights', 'icons'], ['reviews', 'cards'], ['cta', 'band']],
      copy: function (F) { return ['Stay where you need to be', 'Homes in ' + cityList(F) + ', all with self check-in and a local host on WhatsApp.', 'Search stays']; } },
    { id: 'weekender', name: 'Weekender', style: 'Practical', best: 'One standout property', desc: 'Single-property page with photo grid, live prices and a sticky booking card.', skin: 'clean', header: 'bar', footer: 'simple',
      sections: [['hero'], ['availability', 'strip'], ['highlights', 'amenities'], ['reviews', 'scores'], ['cta', 'band']],
      copy: ['Your weekend, sorted', 'Everything you need for a few easy nights away, booked directly with the host.', 'Reserve these dates'] },
    { id: 'storyteller', name: 'Storyteller', style: 'Editorial', best: 'Host-led, personal brands', desc: 'Host introduction, zig-zag story blocks and a wall of guest words.', skin: 'warm', header: 'split', footer: 'big',
      sections: [['hero'], ['story', 'zigzag'], ['properties', 'carousel'], ['reviews', 'wall'], ['cta', 'whatsapp']],
      copy: ['Homes we would happily stay in ourselves', 'We are a small local team. Every home is cleaned by people we know and checked before you arrive.', 'Meet our homes'] },
    { id: 'workstay', name: 'Workstay', style: 'Practical', best: 'Business travel and long stays', desc: 'Enquiry form in the hero, comparison table and invoice-first copy.', skin: 'clean', header: 'bar', footer: 'big',
      sections: [['hero'], ['properties', 'table'], ['highlights', 'icons'], ['reviews', 'quote'], ['cta', 'band']],
      copy: ['Short and long stays for teams on the move', 'Furnished homes near KLCC, Bangsar, Mont Kiara and George Town, with an invoice for every stay.', 'Request a quote'] },
    { id: 'postcard', name: 'Postcard', style: 'Bold', best: 'Young, social-first brands', desc: 'Oversized type, hard borders, offset shadows and a scrolling city ticker.', skin: 'brutal', header: 'brutal', footer: 'big',
      sections: [['hero'], ['ticker', 'marquee'], ['properties', 'brutal'], ['stats', 'band'], ['reviews', 'quote'], ['cta', 'band']],
      copy: ['Pick a city. We handle the keys.', 'Self check-in homes in four of the best places to visit in Malaysia.', 'Book now'] }
  ];
  var TPL_BY = {}; TPL.forEach(function (t) { TPL_BY[t.id] = t; });
  var SEC_LABEL = { hero: 'Hero', search: 'Search bar', properties: 'Featured properties', highlights: 'Why stay with us', reviews: 'Guest reviews', locations: 'Destinations', story: 'Our story', stats: 'Numbers', cta: 'Call to action', availability: 'Prices for the next 2 weeks', ticker: 'City ticker',
    gallery: 'Photo gallery', overview: 'Overview and facts', amenities: 'Amenities', calendar: 'Availability calendar and booking', location: 'Location and house info', team: 'Our team', faq: 'Questions and answers', contact: 'Contact form and WhatsApp' };
  var VLABEL = { 'properties.cards': 'card grid', carousel: 'scrolling row', list: 'numbered list', polaroid: 'polaroids', mosaic: 'photo mosaic', numbered: 'arched trio', bycity: 'grouped by city', table: 'comparison table', brutal: 'bold cards', duo: 'two-up', pill: 'rounded bar', icons: 'icon row', checklist: 'checklist with photo', stickers: 'sticker cards', services: 'service columns', amenities: 'amenity list', quote: 'single quote', 'reviews.cards': 'three cards', wall: 'review wall', serif: 'pull quotes', scores: 'scores and reviews', band: 'colour band', card: 'centred card', whatsapp: 'WhatsApp panel', tiles: 'city tiles', timeline: 'timeline', zigzag: 'alternating blocks', editorial: 'editorial columns', marquee: 'moving ticker', strip: '14-day strip' };
  var SEC_DESC = { hero: 'Always shown at the top', calendar: 'Live availability from your calendar, with prices', contact: 'Enquiries arrive in Guest inbox', faq: 'Check-in, door codes, tourism tax, invoices', reviews: 'Recent 5-star reviews from your platforms' };

  /* =====================================================================
     SITE RENDERER
     ===================================================================== */
  function vars() {
    var b = (O.theme.current || O.ws().brand), P = b.primary, A = b.accent;
    var deep = b.dark ? C.setL(b.dark, Math.min(C.rgbToHsl(C.hexToRgb(b.dark))[2], 0.16)) : C.setL(P, 0.14);
    var ink = C.ink(deep);
    var acc = C.contrast(A, deep) >= 3 ? A : C.ensure(P, deep, 3);
    return { deep: deep, css: '--deep:' + deep + ';--deep-ink:' + ink + ';--deep-acc:' + acc + ';--deep-acc-ink:' + C.ink(acc) + ';--deep-muted:' + C.mix(ink, deep, 0.38) + ';--deep-2:' + C.mix(deep, ink, 0.07) + ';--deep-line:' + C.mix(deep, ink, 0.18) + ';' };
  }
  function ctxFor(t, page, opts) {
    var F = facts(), S = site();
    var feat = S.featured.map(function (id) { return F.byId[id]; }).filter(Boolean);
    if (!feat.length) feat = F.props.slice(0, 3);
    return { t: t, page: page, F: F, ws: O.ws(), copy: copyOf(t), feat: feat, opts: opts || {}, V: vars(), pid: (opts && opts.pid) || S.propertyId || feat[0].id };
  }
  /* WhatsApp buttons are real links: the artifact frame blocks window.open for most viewers */
  function waBtn(label, cls) { return '<a class="wbs-btn ' + (cls || '') + '" href="https://wa.me/' + String(waNumber()).replace(/\D/g, '') + '" target="_blank" rel="noopener">' + label + '</a>'; }
  function btn(label, cls, attrs) { return '<button type="button" class="wbs-btn ' + (cls || '') + '" ' + (attrs || '') + '>' + label + '</button>'; }
  function logo(X, bg) { return '<span class="wbs-logo">' + O.theme.logoHTML(X.ws, bg) + '</span>'; }
  function nav(X) {
    return '<button type="button" data-wnav="home" class="' + (X.page === 'home' ? 'on' : '') + '">Home</button><button type="button" data-wnav="property" class="' + (X.page === 'property' ? 'on' : '') + '">Stays</button><button type="button" data-wnav="about" class="' + (X.page === 'about' ? 'on' : '') + '">About</button><button type="button" data-wnav="about" data-anchor="contact">Contact</button>';
  }
  function header(X) {
    var h = X.t.header, ws = X.ws, menu = '<button type="button" class="wh-menu" data-wact="menu" aria-label="Open site menu">' + O.icon('menu') + '</button>';
    var brand = function (bg) { return '<button type="button" class="wh-brand" data-wnav="home">' + logo(X, bg) + '<span>' + esc(ws.name) + '</span></button>'; };
    var book = btn('Book direct', 'sm', 'data-wact="book"');
    if (h === 'center') return '<header class="wh wh-center"><div class="wbs-wrap"><div class="wh-top"><span class="wh-meta">' + esc(X.F.cities.map(function (c) { return c.name; }).join(' · ')) + '</span>' + brand('#FFFFFF') + '<span class="wh-meta r">' + esc(ws.phone) + '</span>' + menu + '</div><nav class="wh-nav">' + nav(X) + '</nav></div></header>';
    if (h === 'split') return '<header class="wh wh-split"><div class="wbs-wrap wh-in"><nav class="wh-nav">' + nav(X) + '</nav>' + brand('#FFFFFF') + '<div class="wh-r">' + book + '</div>' + menu + '</div></header>';
    if (h === 'side') return '';
    var bg = h === 'deep' ? X.V.deep : h === 'overlay' ? '#1B2A44' : '#FFFFFF';
    return '<header class="wh wh-' + h + '"><div class="wbs-wrap wh-in">' + brand(bg) + '<nav class="wh-nav">' + nav(X) + '</nav>' + (h === 'brutal' ? btn('Book', 'sm', 'data-wact="book"') : book) + menu + '</div></header>';
  }
  function sideNav(X) {
    return '<aside class="wh-side"><button type="button" class="wh-brand" data-wnav="home">' + logo(X, '#FFFFFF') + '<span>' + esc(X.ws.name) + '</span></button><nav class="wh-vnav">' + nav(X) + '</nav>' + btn('Book direct', 'full', 'data-wact="book"') +
      '<div class="wh-sidefoot"><div>' + esc(X.ws.phone) + '</div><div>' + esc(X.ws.email) + '</div></div></aside>';
  }
  function footer(X) {
    var ws = X.ws, F = X.F, f = X.t.footer, year = D.TODAY.slice(0, 4);
    var powered = ws.id === 'orbique' ? '' : ' · Booking system by Orbique';
    if (f === 'simple') return '<footer class="wf wf-simple"><div class="wbs-wrap wf-in"><button type="button" class="wh-brand" data-wnav="home">' + logo(X, '#FFFFFF') + '<span>' + esc(ws.name) + '</span></button><nav class="wf-links">' + nav(X) + '</nav><div class="wf-copy">© ' + year + ' ' + esc(ws.legal) + powered + '</div></div></footer>';
    return '<footer class="wf wf-big"><div class="wbs-wrap"><div class="wf-cols"><div><button type="button" class="wh-brand" data-wnav="home">' + logo(X, X.V.deep) + '<span>' + esc(ws.name) + '</span></button><p class="wf-about">' + esc(F.props.length + ' homes in ' + cityList(F) + '. Book direct with the people who look after them.') + '</p></div>' +
      '<div><h4>Destinations</h4>' + F.cities.map(function (c) { return '<button type="button" data-wpid="' + c.props[0].id + '">' + esc(c.name) + ' (' + c.props.length + ')</button>'; }).join('') + '</div>' +
      '<div><h4>Popular homes</h4>' + X.feat.slice(0, 5).map(function (x) { return '<button type="button" data-wpid="' + x.id + '">' + esc(x.name) + '</button>'; }).join('') + '</div>' +
      '<div><h4>Contact</h4><span>' + esc(ws.phone) + '</span><span>' + esc(ws.email) + '</span><span>' + esc(ws.address) + '</span></div></div><div class="wf-copy">© ' + year + ' ' + esc(ws.legal) + powered + '</div></div></footer>';
  }
  function renderSite(t, page, opts) {
    var X = ctxFor(t, page, opts), body;
    if (page === 'property') body = propertyPage(X);
    else if (page === 'about') body = aboutPage(X);
    else body = tplSections(t).filter(function (s) { return s.on || s.id === 'hero'; }).slice(0, X.opts.limit || 99).map(function (s) { return section(X, s); }).join('');
    var cls = 'wbs sk-' + t.skin + ' tp-' + t.id + ' hd-' + t.header + ' pg-' + page;
    if (t.header === 'side') return '<div class="' + cls + '" style="' + X.V.css + '"><div class="wbs-sidewrap">' + sideNav(X) + '<div class="wbs-main"><div class="wh wh-sidebar-m"><div class="wh-in">' + '<button type="button" class="wh-brand" data-wnav="home">' + logo(X, '#FFFFFF') + '<span>' + esc(X.ws.name) + '</span></button><button type="button" class="wh-menu" data-wact="menu" aria-label="Open site menu">' + O.icon('menu') + '</button></div><nav class="wh-nav">' + nav(X) + '</nav></div>' + body + footer(X) + '</div></div></div>';
    return '<div class="' + cls + '" style="' + X.V.css + '">' + header(X) + body + footer(X) + '</div>';
  }
  function section(X, s) {
    if (s.id === 'hero') return (HERO[X.t.id] || HERO.harbour)(X);
    var f = SEC[s.id]; return f ? f(X, s.v) : '';
  }
  function eyebrow(t) { return '<div class="wbs-eyebrow">' + esc(t) + '</div>'; }
  function head2(eb, title, lead, center) { return '<div class="wbs-head' + (center ? ' c' : '') + '">' + (eb ? eyebrow(eb) : '') + '<h2 class="wbs-h2">' + esc(title) + '</h2>' + (lead ? '<p class="wbs-lead">' + esc(lead) + '</p>' : '') + '</div>'; }
  function rating(x) { return x.rating ? '<span class="wbs-rate">★ ' + x.rating.toFixed(2) + ' <span>(' + x.nReviews + ')</span></span>' : '<span class="wbs-rate">New</span>'; }
  function facts1(x) { return esc(x.type) + ' · ' + (x.beds ? x.beds + ' bedroom' + (x.beds > 1 ? 's' : '') : 'Studio') + ' · sleeps ' + x.sleeps; }

  /* ---------------- heroes (one per template) ---------------- */
  var HERO = {
    harbour: function (X) {
      var f = X.feat;
      return '<section class="hero h-harbour"><div class="wbs-wrap hh-grid"><div class="hh-text">' + eyebrow(X.F.cities.map(function (c) { return c.name; }).join(' · ')) + '<h1>' + esc(X.copy.headline) + '</h1><p>' + esc(X.copy.sub) + '</p><div class="wbs-row">' + btn(esc(X.copy.cta), '', 'data-wact="search"') + btn('See all stays', 'ghost', 'data-wnav="property"') + '</div>' +
        '<div class="hh-proof"><b>★ ' + X.F.avg.toFixed(1) + '</b> from ' + fmt.num(X.F.nReviews) + ' guest reviews <span>·</span> Self check-in <span>·</span> No platform fees</div></div>' +
        '<div class="hh-collage">' + propImg(f[0], 0, 'c1') + propImg(f[1] || f[0], 1, 'c2') + propImg(f[2] || f[0], 0, 'c3') + '</div></div></section>';
    },
    skyline: function (X) {
      return '<section class="hero h-skyline">' + img('night', 'hero', 'hs-bg', 'City skyline at night') + '<div class="hs-shade"></div><div class="wbs-wrap hs-in"><div class="hs-kicker">' + X.F.props.length + ' homes · ' + X.F.cities.length + ' destinations</div><h1>' + esc(X.copy.headline) + '</h1><p>' + esc(X.copy.sub) + '</p></div>' +
        '<div class="wbs-wrap hs-barwrap">' + searchBar(X, 'card') + '</div></section>';
    },
    heritage: function (X) {
      var x = X.F.byId.hsg || X.feat[0];
      return '<section class="hero h-heritage"><div class="wbs-wrap"><div class="hr-dateline"><span>No. ' + (d.month(D.TODAY) + 2) + '</span><span>' + esc(d.monthName(D.TODAY, true) + ' ' + D.TODAY.slice(0, 4)) + '</span><span>Stays, stories and local notes</span></div>' +
        '<div class="hr-grid"><div class="hr-text"><h1>' + esc(X.copy.headline) + '</h1><p class="hr-lead">' + esc(X.copy.sub) + '</p><div class="wbs-row">' + btn(esc(X.copy.cta), '', 'data-wact="search"') + '<button type="button" class="wbs-link" data-wnav="about">Read our story →</button></div></div>' +
        '<figure class="hr-fig">' + img('heritage', 'hr', 'hr-img', x.name) + '<figcaption>' + esc(x.name) + ', ' + esc(x.area) + '</figcaption></figure></div></div></section>';
    },
    tropika: function (X) {
      var f = X.feat, words = X.copy.headline.split(' '), last = words.pop();
      return '<section class="hero h-tropika"><span class="tk-blob b1"></span><span class="tk-blob b2"></span><div class="wbs-wrap tk-grid"><div class="tk-text"><span class="tk-sticker">★ ' + X.F.avg.toFixed(1) + ' guest rating</span><h1>' + esc(words.join(' ')) + ' <mark>' + esc(last) + '</mark></h1><p>' + esc(X.copy.sub) + '</p><div class="wbs-row">' + btn(esc(X.copy.cta), '', 'data-wact="search"') + waBtn('Chat with us', 'ghost') + '</div></div>' +
        '<div class="tk-pics">' + [0, 1, 2].map(function (i) { var x = f[i] || f[0]; return '<div class="tk-pol p' + i + '">' + propImg(x, 0) + '<span>' + esc(x.short) + '</span></div>'; }).join('') + '</div></div>' +
        '<svg class="tk-wave" viewBox="0 0 1200 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 30 C200 70 400 -10 600 30 C800 70 1000 -10 1200 30 V60 H0Z"/></svg></section>';
    },
    mosaic: function (X) {
      var f = X.feat;
      return '<section class="hero h-mosaic"><div class="wbs-wrap mz-grid">' + propImg(f[0], 0, 'mz-a') +
        '<div class="mz-brand"><h1>' + esc(X.copy.headline) + '</h1><p>' + esc(X.copy.sub) + '</p>' + btn(esc(X.copy.cta), 'light', 'data-wact="search"') + '</div>' +
        propImg(f[1] || f[0], 1, 'mz-b') + propImg(f[2] || f[0], 2, 'mz-c') +
        '<div class="mz-acc"><b>' + X.F.avg.toFixed(1) + '</b><span>' + stars(X.F.avg) + '</span><small>' + fmt.num(X.F.nReviews) + ' reviews</small></div>' + propImg(f[3] || f[0], 0, 'mz-d') + '</div></section>';
    },
    highlands: function (X) {
      return '<section class="hero h-highlands">' + img('hills', 'hero', 'hl-bg', 'Tea hills in the Cameron Highlands') + '<div class="hl-panel">' + eyebrow('Cameron Highlands · ' + X.F.cities.filter(function (c) { return c.name !== 'Cameron Highlands'; }).map(function (c) { return c.name; }).join(' · ')) + '<h1>' + esc(X.copy.headline) + '</h1><p>' + esc(X.copy.sub) + '</p>' + btn(esc(X.copy.cta), '', 'data-wact="search"') + '</div></section>';
    },
    concierge: function (X) {
      var x = X.feat[0];
      return '<section class="hero h-concierge"><div class="wbs-wrap cc-in"><div class="cc-eb"><i></i>' + esc(X.ws.name) + ' residences<i></i></div><h1>' + esc(X.copy.headline) + '</h1><p>' + esc(X.copy.sub) + '</p>' + btn(esc(X.copy.cta), 'outline', 'data-wact="search"') +
        '<div class="cc-arches">' + propImg(X.feat[1] || x, 1, 'cc-arch s') + propImg(x, 0, 'cc-arch') + propImg(X.feat[2] || x, 2, 'cc-arch s') + '</div></div></section>';
    },
    metro: function (X) {
      var F = X.F;
      return '<section class="hero h-metro"><div class="wbs-wrap mt-grid"><div class="mt-text"><h1>' + esc(X.copy.headline) + '</h1><p>' + esc(X.copy.sub) + '</p><div class="mt-cities">' +
        F.cities.map(function (c) { return '<button type="button" class="mt-city" data-wpid="' + c.props[0].id + '"><span class="mt-dot"></span><span class="grow"><b>' + esc(c.name) + '</b><small>' + c.props.length + ' home' + (c.props.length > 1 ? 's' : '') + '</small></span><span class="mt-from">from <b>' + rmoney(c.from) + '</b></span></button>'; }).join('') +
        '</div>' + btn(esc(X.copy.cta), '', 'data-wact="search"') + '</div><div class="mt-map"><svg class="wbs-map" viewBox="-10 -10 320 410" aria-label="Map of Peninsular Malaysia with ' + F.cities.length + ' destinations"><path d="' + MAP_PATH + '" class="land"/><ellipse cx="32" cy="98" rx="6" ry="8" class="land"/>' +
        F.cities.map(function (c) { var p = PIN[c.name] || [150, 200]; var right = p[0] < 100; return '<g class="pin"><circle cx="' + p[0] + '" cy="' + p[1] + '" r="14" class="halo"/><circle cx="' + p[0] + '" cy="' + p[1] + '" r="6" class="dot"/><text x="' + (p[0] + (right ? 18 : -18)) + '" y="' + (p[1] + 4) + '" text-anchor="' + (right ? 'start' : 'end') + '">' + esc(c.name) + ' · ' + c.props.length + '</text></g>'; }).join('') + '</svg></div></div></section>';
    },
    weekender: function (X) {
      var x = X.F.byId[X.feat[0].id];
      return '<section class="hero h-weekender"><div class="wbs-wrap"><div class="wk-title">' + eyebrow(X.copy.headline) + '<h1>' + esc(x.name) + '</h1><div class="wk-meta wbs-meta"><span>' + rating(x) + '</span><span>' + esc(x.area) + '</span><span>' + facts1(x) + '</span></div></div>' +
        '<div class="wk-gal">' + propImg(x, 0, 'g0') + propImg(x, 1, 'g1') + propImg(x, 2, 'g2') + propImg(x, 3, 'g3') + propImg(x, 4, 'g4') + '</div>' +
        '<div class="wk-cols"><div class="wk-desc"><p>' + esc(X.copy.sub) + '</p>' + factTiles(X, x) + '<p class="wk-about">' + esc(aboutLine(x)) + '</p></div>' + bookingCard(X, x, esc(X.copy.cta)) + '</div></div></section>';
    },
    storyteller: function (X) {
      var host = D.staff[0];
      return '<section class="hero h-storyteller"><div class="wbs-wrap sy-grid">' + propImg(X.feat[0], 1, 'sy-img') + '<div class="sy-card"><div class="sy-host"><span class="sy-av">' + esc(fmt.initials(host.name)) + '</span><span><b>' + esc(host.name) + '</b><small>Your host · ' + esc(X.ws.name) + '</small></span></div><h1>“' + esc(X.copy.headline) + '”</h1><p>' + esc(X.copy.sub) + '</p><div class="wbs-row">' + btn(esc(X.copy.cta), '', 'data-wact="search"') + waBtn('Say hello on WhatsApp', 'ghost') + '</div></div></div></section>';
    },
    workstay: function (X) {
      var F = X.F;
      return '<section class="hero h-workstay"><div class="wbs-wrap ws-grid"><div class="ws-text">' + eyebrow('For companies and long stays') + '<h1>' + esc(X.copy.headline) + '</h1><p>' + esc(X.copy.sub) + '</p><ul class="ws-checks"><li>' + O.icon('check') + 'Invoice on confirmation, receipt on payment</li><li>' + O.icon('check') + 'Fast Wi-Fi and a proper work table</li><li>' + O.icon('check') + 'Self check-in at any hour</li></ul><div class="ws-chips"><span><b>' + F.props.length + '</b> homes</span><span><b>' + F.cities.length + '</b> cities</span><span><b>' + F.avg.toFixed(1) + '★</b> average</span></div></div>' +
        '<form class="ws-form" data-wact="enquire" onsubmit="return false"><h3>' + esc(X.copy.cta) + '</h3><label>Company<input value="" placeholder="Company name"></label><label>Work email<input value="" placeholder="name@company.com"></label><div class="ws-two"><label>Arriving<input value="' + esc(d.fmt(d.add(D.TODAY, 14))) + '"></label><label>Nights<input value="14"></label></div><label>Guests<input value="3"></label>' + btn('Send enquiry', 'full', 'data-wact="enquire"') + '<small>We reply within one working day with a quote and invoice details.</small></form></div></section>';
    },
    postcard: function (X) {
      var F = X.F, words = F.cities.map(function (c) { return c.name === 'Kuala Lumpur' ? 'KL' : c.name === 'Cameron Highlands' ? 'Cameron' : c.name; });
      return '<section class="hero h-postcard"><div class="wbs-wrap pc-grid"><div class="pc-words">' + words.map(function (w, i) { return '<span class="w' + i + '">' + esc(w) + '.</span>'; }).join('') + '</div><div class="pc-side"><h1>' + esc(X.copy.headline) + '</h1><p>' + esc(X.copy.sub) + '</p>' + btn(esc(X.copy.cta) + ' →', '', 'data-wact="search"') + '<div class="pc-photo">' + propImg(X.feat[0], 0) + '<span class="pc-stamp">From ' + rmoney(Math.min.apply(null, F.props.map(function (x) { return x.from; }))) + '</span></div></div></div></section>';
    }
  };

  /* ---------------- shared building blocks ---------------- */
  function searchBar(X, v) {
    var F = X.F;
    return '<div class="wbs-search ' + (v || '') + '"><div class="sf" data-wact="search"><label>Where</label><b>' + esc(F.cities.map(function (c) { return c.name === 'Kuala Lumpur' ? 'KL' : c.name.split(' ')[0]; }).join(', ')) + '</b></div><div class="sf" data-wact="search"><label>Check in</label><b>' + esc(d.dowName(d.add(D.TODAY, 3)) + ' ' + d.fmt(d.add(D.TODAY, 3))) + '</b></div><div class="sf" data-wact="search"><label>Check out</label><b>' + esc(d.dowName(d.add(D.TODAY, 5)) + ' ' + d.fmt(d.add(D.TODAY, 5))) + '</b></div><div class="sf" data-wact="search"><label>Guests</label><b>2 adults</b></div>' + btn(O.icon('search') + '<span>Search</span>', '', 'data-wact="search"') + '</div>';
  }
  var AMEN = [['wifi', 'Fast Wi-Fi'], ['key', 'Self check-in'], ['home', 'Full kitchen'], ['sparkle', 'Air-conditioning'], ['refresh', 'Washer'], ['video', 'Smart TV'], ['car', 'Parking'], ['clock', 'Late checkout on request'], ['user', 'Host on WhatsApp'], ['invoices', 'Invoice for your stay']];
  function amenitiesOf(x) {
    return AMEN.filter(function (a) { return a[0] !== 'car' || x.parking; }).map(function (a) { return a[0] === 'key' ? [a[0], 'Self check-in (' + x.lockBrand + ' smart lock)'] : a[0] === 'car' ? [a[0], 'Parking: ' + x.p.parking] : a; });
  }
  function amenityList(x, n) { return '<ul class="wbs-amen">' + amenitiesOf(x).slice(0, n || 10).map(function (a) { return '<li>' + O.icon(a[0]) + '<span>' + esc(a[1]) + '</span></li>'; }).join('') + '</ul>'; }
  function propCard(x, cls) {
    return '<button type="button" class="wbs-pcard ' + (cls || '') + '" data-wpid="' + x.id + '">' + propImg(x, 0, 'pc-img') + '<span class="pc-body"><span class="pc-top"><b>' + esc(x.name) + '</b>' + rating(x) + '</span><span class="pc-sub">' + esc(x.area) + '</span><span class="pc-sub">' + facts1(x) + '</span><span class="pc-price">from <b>' + rmoney(x.from) + '</b> / night</span></span></button>';
  }
  /* first 3 free nights starting at least 2 days out (independent of what the visitor picked) */
  function firstGap(pid) {
    for (var i = 2; i < 60; i++) { var a = d.add(D.TODAY, i); if (!isBooked(pid, a) && !isBooked(pid, d.add(a, 1)) && !isBooked(pid, d.add(a, 2))) return { from: a, to: d.add(a, 3) }; }
    return { from: null, to: null };
  }
  function defaultSel(x) {
    var cur = st.sel[x.id]; if (cur && cur.from) return cur;
    st.sel[x.id] = firstGap(x.id); return st.sel[x.id];
  }
  function quote(x) {
    var sel = defaultSel(x); if (!sel.from || !sel.to) return null;
    var nights = d.diff(sel.from, sel.to), acc = 0; d.range(sel.from, d.add(sel.to, -1)).forEach(function (iso) { acc += price(x.id, iso); });
    return { nights: nights, acc: acc, avg: Math.round(acc / nights), cleaning: x.cleaning, total: acc + x.cleaning, from: sel.from, to: sel.to };
  }
  function bookingCard(X, x, label) {
    var q = quote(x), sel = defaultSel(x);
    return '<div class="wbs-bk"><div class="bk-price"><span><b>' + rmoney(q ? q.avg : x.from) + '</b> / night</span>' + rating(x) + '</div>' +
      '<div class="bk-dates"><div><label>Check in</label><b>' + (sel.from ? esc(d.dowName(sel.from) + ', ' + d.fmt(sel.from)) : 'Pick a date') + '</b></div><div><label>Check out</label><b>' + (sel.to ? esc(d.dowName(sel.to) + ', ' + d.fmt(sel.to)) : 'Pick a date') + '</b></div><div class="full"><label>Guests</label><b>2 guests · up to ' + x.sleeps + '</b></div></div>' +
      btn(label || 'Book these dates', 'full', 'data-wact="book" data-pid="' + x.id + '"') +
      (q ? '<div class="bk-lines"><div><span>' + fmt.plural(q.nights, 'night') + (q.nights > 1 ? ' <small>avg ' + rmoney(q.avg) + '</small>' : '') + '</span><span>' + rmoney(q.acc) + '</span></div><div><span>Cleaning fee</span><span>' + rmoney(q.cleaning) + '</span></div><div class="tot"><span>Total</span><span>' + rmoney(q.total) + '</span></div></div><p class="bk-note">Non-Malaysian guests also pay tourism tax of RM 10 per night. Invoice sent as soon as you book.</p>' : '<p class="bk-note">Pick your check-in and check-out dates on the calendar.</p>') + '</div>';
  }

  /* mosaic tiles: blocks of 6 (2x2, 1, 1, 2, 2, 2) fill 3 rows of a 4-column grid; the last block is sized so no hole is left */
  function mzSpan(i, n) {
    var full = Math.floor(n / 6) * 6, r = n - full;
    if (i < full) return ['z22', 'z1', 'z1', 'z2', 'z2', 'z2'][i % 6];
    return ({ 1: ['z4'], 2: ['z2', 'z2'], 3: ['z2', 'z1', 'z1'], 4: ['z22', 'z1', 'z1', 'z2'], 5: ['z22', 'z1', 'z1', 'z2', 'z4'] })[r][i - full];
  }

  /* ---------------- sections ---------------- */
  var SEC = {};
  SEC.search = function (X) { return '<section class="wbs-sec tight"><div class="wbs-wrap">' + searchBar(X, 'pill') + '</div></section>'; };
  SEC.properties = function (X, v) {
    var f = X.feat, F = X.F;
    if (v === 'carousel') return '<section class="wbs-sec"><div class="wbs-wrap"><div class="wbs-headrow">' + head2('Our homes', 'Stay a night or a month', null) + '<div class="wbs-arrows"><button type="button" data-wact="scroll" data-dir="-1" aria-label="Previous homes">' + O.icon('left') + '</button><button type="button" data-wact="scroll" data-dir="1" aria-label="Next homes">' + O.icon('right') + '</button></div></div><div class="wbs-carousel">' + f.map(function (x) { return propCard(x); }).join('') + '</div></div></section>';
    if (v === 'list') return '<section class="wbs-sec"><div class="wbs-wrap">' + head2('The collection', 'Homes with a sense of place', 'Each one chosen for its street, its light and the people next door.') + '<div class="wbs-plist">' + f.map(function (x, i) { return '<button type="button" class="pl-row" data-wpid="' + x.id + '">' + propImg(x, 0, 'pl-img') + '<span class="pl-body"><span class="pl-no">' + (i < 9 ? '0' : '') + (i + 1) + '</span><b class="pl-name">' + esc(x.name) + '</b><span class="pl-area">' + esc(x.area) + '</span><span class="pl-facts">' + facts1(x) + ' · ' + rating(x) + '</span><span class="pl-price">From ' + rmoney(x.from) + ' a night <u>View home →</u></span></span></button>'; }).join('') + '</div></div></section>';
    if (v === 'duo') return '<section class="wbs-sec"><div class="wbs-wrap">' + head2('Where to stay', 'Quiet homes, near and far', 'From the tea hills to the city, every home is cleaned by our own team.') + '<div class="wbs-duo">' + f.map(function (x) { return '<button type="button" class="duo" data-wpid="' + x.id + '">' + propImg(x, 0, 'duo-img') + '<span class="duo-body"><span class="duo-l"><b>' + esc(x.name) + '</b><span>' + esc(x.area) + ' · sleeps ' + x.sleeps + '</span></span><span class="duo-r"><b>' + rmoney(x.from) + '</b><span>per night</span></span></span></button>'; }).join('') + '</div></div></section>';
    if (v === 'polaroid') return '<section class="wbs-sec soft"><div class="wbs-wrap">' + head2('Pick your spot', 'Where will you wake up?', null, true) + '<div class="wbs-pols">' + f.map(function (x, i) { return '<button type="button" class="pol r' + (i % 3) + '" data-wpid="' + x.id + '">' + propImg(x, 0) + '<b>' + esc(x.short) + '</b><span>' + esc(x.city) + '</span><i>' + rmoney(x.from) + '</i></button>'; }).join('') + '</div></div></section>';
    if (v === 'mosaic') return '<section class="wbs-sec"><div class="wbs-wrap">' + head2(null, 'The homes', F.props.length + ' homes, ' + F.cities.length + ' destinations. Tap one to see dates and prices.') + '<div class="wbs-mz">' + f.map(function (x, i) { return '<button type="button" class="mzc ' + mzSpan(i, f.length) + '" data-wpid="' + x.id + '">' + propImg(x, i % 3 === 1 ? 1 : 0) + '<span class="mzc-cap"><b>' + esc(x.name) + '</b><span>' + esc(x.city) + ' · from ' + rmoney(x.from) + '</span></span></button>'; }).join('') + '</div></div></section>';
    if (v === 'numbered') return '<section class="wbs-sec"><div class="wbs-wrap">' + head2('The residences', 'Chosen, furnished and looked after by us', null, true) + '<div class="wbs-num">' + f.slice(0, 3).map(function (x, i) { return '<button type="button" class="nm" data-wpid="' + x.id + '"><span class="nm-n">' + ['I', 'II', 'III'][i] + '</span>' + propImg(x, i === 1 ? 1 : 0, 'nm-img') + '<b>' + esc(x.name) + '</b><span>' + esc(x.area) + '</span><span class="nm-from">From ' + rmoney(x.from) + ' a night</span></button>'; }).join('') + '</div></div></section>';
    if (v === 'bycity') return '<section class="wbs-sec soft"><div class="wbs-wrap">' + head2('By destination', 'Every home, city by city', null) + '<div class="wbs-bycity">' + F.cities.map(function (c) { return '<div class="bc-col"><div class="bc-head">' + img(c.scene, c.name, 'bc-img', c.name) + '<b>' + esc(c.name) + '</b><span>' + c.props.length + ' home' + (c.props.length > 1 ? 's' : '') + '</span></div>' + c.props.map(function (x) { return '<button type="button" class="bc-row" data-wpid="' + x.id + '"><span><b>' + esc(x.short) + '</b><small>' + (x.beds ? x.beds + ' BR' : 'Studio') + ' · sleeps ' + x.sleeps + '</small></span><span class="bc-p">' + rmoney(x.from) + '</span></button>'; }).join('') + '</div>'; }).join('') + '</div></div></section>';
    if (v === 'table') return '<section class="wbs-sec"><div class="wbs-wrap">' + head2('Compare homes', 'Pick the right home for the team', 'Nightly rates are the lowest in the next 30 days. Ask us about stays of a month or longer.') + '<div class="wbs-tablewrap"><table class="wbs-table"><thead><tr><th>Home</th><th>City</th><th>Bedrooms</th><th>Sleeps</th><th>Parking</th><th>Rating</th><th class="r">Nightly from</th><th></th></tr></thead><tbody>' +
      F.props.map(function (x) { return '<tr><td><b>' + esc(x.name) + '</b><small>' + esc(x.area.split(',')[0]) + '</small></td><td>' + esc(x.city) + '</td><td>' + (x.beds || 'Studio') + '</td><td>' + x.sleeps + '</td><td>' + (x.parking ? '✓ Included' : '<span class="muted">Nearby</span>') + '</td><td>' + (x.rating ? '★ ' + x.rating.toFixed(1) : 'New') + '</td><td class="r"><b>' + rmoney(x.from) + '</b></td><td class="r"><button type="button" class="wbs-link" data-wpid="' + x.id + '">View</button></td></tr>'; }).join('') + '</tbody></table></div></div></section>';
    if (v === 'brutal') return '<section class="wbs-sec"><div class="wbs-wrap">' + head2('Homes', 'Choose your base', null) + '<div class="wbs-brut">' + f.map(function (x, i) { return '<button type="button" class="br" data-wpid="' + x.id + '"><span class="br-tag">' + esc(x.city.toUpperCase()) + '</span>' + propImg(x, i % 2) + '<b>' + esc(x.name) + '</b><span class="br-f">' + (x.beds ? x.beds + ' BR' : 'STUDIO') + ' / SLEEPS ' + x.sleeps + '</span><span class="br-p">' + rmoney(x.from) + '<small>/night</small></span></button>'; }).join('') + '</div></div></section>';
    return '<section class="wbs-sec"><div class="wbs-wrap">' + head2('Featured homes', 'Find your stay', 'Hand-picked homes with self check-in, fast Wi-Fi and a host on WhatsApp.') + '<div class="wbs-cards">' + f.map(function (x) { return propCard(x); }).join('') + '</div></div></section>';
  };
  SEC.highlights = function (X, v) {
    var F = X.F;
    var items = [['key', 'Self check-in', 'Your own door code, ready in the guest app before you arrive.'], ['wifi', 'Fast Wi-Fi', 'In every home, with the password waiting for you in the app.'], ['chat', 'A host on WhatsApp', 'A real person in ' + (F.cities[0] ? F.cities[0].name : 'town') + ' or KL who answers your messages.'], ['invoices', 'Invoice for every stay', 'Sent when you book, with a receipt as soon as you pay.']];
    if (v === 'checklist') return '<section class="wbs-sec"><div class="wbs-wrap wbs-split">' + img('living', 'chk', 'sp-img', 'Living room') + '<div>' + head2('Included', 'Everything is ready when you arrive', null) + '<ul class="wbs-check">' + ['Fresh linen and towels for every guest', 'Door code in the guest app after you accept the house rules', 'Wi-Fi, kitchen basics and drinking water', 'Check-in from ' + fmt.time(F.checkIn) + ', check-out by ' + fmt.time(F.checkOut), 'Local guide to things to do in ' + cityList(F)].map(function (t) { return '<li>' + O.icon('check') + '<span>' + esc(t) + '</span></li>'; }).join('') + '</ul></div></div></section>';
    if (v === 'stickers') return '<section class="wbs-sec"><div class="wbs-wrap">' + head2('Why families love it', 'Easy holidays, sorted', null, true) + '<div class="wbs-stick">' + [['home', 'Room for everyone', 'Two and three-bedroom homes with real kitchens.'], ['key', 'No key handover', 'Arrive late? Your door code works from check-in time.'], ['car', 'Car, SIM, Touch \'n Go', 'Request them in the guest app before you land.'], ['star', '★ ' + F.avg.toFixed(1) + ' from guests', fmt.num(F.nReviews) + ' reviews across Airbnb, Booking.com and more.']].map(function (s, i) { return '<div class="sk s' + i + '"><span class="sk-ic">' + O.icon(s[0]) + '</span><b>' + esc(s[1]) + '</b><p>' + esc(s[2]) + '</p></div>'; }).join('') + '</div></div></section>';
    if (v === 'services') return '<section class="wbs-sec"><div class="wbs-wrap">' + head2('Services', 'Arranged before you arrive', null, true) + '<div class="wbs-svc">' + [['car', 'Car rental', 'Delivered to the residence or the airport.'], ['sim', 'Local SIM card', 'Ready on arrival, data included.'], ['card', 'Touch \'n Go card', 'Topped up for tolls, trains and parking.'], ['chat', 'Host on call', 'One message on WhatsApp, day or night.']].map(function (s) { return '<div class="svc"><span class="svc-ic">' + O.icon(s[0]) + '</span><b>' + esc(s[1]) + '</b><p>' + esc(s[2]) + '</p></div>'; }).join('') + '</div></div></section>';
    if (v === 'amenities') { var x = X.F.byId[X.feat[0].id]; return '<section class="wbs-sec soft"><div class="wbs-wrap">' + head2('What this home offers', 'Amenities', null) + amenityList(x, 10) + '</div></section>'; }
    return '<section class="wbs-sec soft"><div class="wbs-wrap">' + head2('Why book with us', 'Hotel-level care, the space of a home', null, true) + '<div class="wbs-icons">' + items.map(function (s) { return '<div class="ic"><span class="ic-c">' + O.icon(s[0]) + '</span><b>' + esc(s[1]) + '</b><p>' + esc(s[2]) + '</p></div>'; }).join('') + '</div></div></section>';
  };
  function reviewList(X, n, pid) {
    var top = X.F.top.filter(function (r) { return !pid || r.propertyId === pid; });
    if (pid && top.length < n) top = top.concat(D.reviews.filter(function (r) { return r.propertyId === pid && r.stars >= 4 && top.indexOf(r) < 0; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; }));
    return top.slice(0, n);
  }
  function revMeta(r) { var x = D.propById[r.propertyId]; return esc(firstName(r.guest)) + ' · ' + esc((D.countryName && D.countryName[r.country]) || r.country) + ' · ' + esc(x ? x.short : '') + ' · ' + esc(d.monthName(r.date) + ' ' + r.date.slice(0, 4)); }
  SEC.reviews = function (X, v, pid) {
    var rs = reviewList(X, 6, pid), F = X.F;
    if (!rs.length) return '';
    if (v === 'quote') { var r0 = rs[0]; return '<section class="wbs-sec rq"><div class="wbs-wrap"><div class="wbs-quote"><div class="q-stars">' + stars(5) + '</div><blockquote>“' + esc(r0.text) + '”</blockquote><div class="q-by">' + revMeta(r0) + '</div><div class="q-dots">' + rs.slice(0, 5).map(function (_, i) { return '<i class="' + (i ? '' : 'on') + '"></i>'; }).join('') + '</div><div class="q-sum">★ ' + F.avg.toFixed(1) + ' average from ' + fmt.num(F.nReviews) + ' reviews</div></div></div></section>'; }
    if (v === 'serif') return '<section class="wbs-sec"><div class="wbs-wrap"><div class="wbs-serif"><blockquote class="big">“' + esc(rs[0].text) + '”<cite>' + revMeta(rs[0]) + '</cite></blockquote><div class="sm">' + rs.slice(1, 3).map(function (r) { return '<blockquote>“' + esc(r.text) + '”<cite>' + revMeta(r) + '</cite></blockquote>'; }).join('') + '</div></div></div></section>';
    if (v === 'wall') return '<section class="wbs-sec soft"><div class="wbs-wrap">' + head2('In their words', 'What guests tell us', null, true) + '<div class="wbs-wall">' + rs.map(function (r) { return '<figure><div class="q-stars">' + stars(r.stars) + '</div><p>' + esc(r.text) + '</p><figcaption>' + revMeta(r) + '</figcaption></figure>'; }).join('') + '</div></div></section>';
    if (v === 'scores') {
      var x = X.F.byId[pid || X.feat[0].id], all = D.reviews.filter(function (r) { return r.propertyId === x.id; });
      var subs = [['cleanliness', 'Cleanliness'], ['communication', 'Communication'], ['checkin', 'Check-in'], ['accuracy', 'Accuracy']].map(function (k) { var a = all.filter(function (r) { return r.sub; }); var v2 = a.length ? a.reduce(function (s, r) { return s + r.sub[k[0]]; }, 0) / a.length : 0; return '<div class="sc"><span>' + k[1] + '</span><i><b style="width:' + Math.round(v2 / 5 * 100) + '%"></b></i><em>' + v2.toFixed(1) + '</em></div>'; }).join('');
      var rs2 = reviewList(X, 4, x.id);
      return '<section class="wbs-sec"><div class="wbs-wrap"><div class="wbs-scores"><div class="sc-big"><b>★ ' + (x.rating || 0).toFixed(2) + '</b><span>' + all.length + ' reviews</span>' + subs + '</div><div class="wbs-rcards two">' + rs2.map(function (r) { return '<figure><div class="q-stars">' + stars(r.stars) + '</div><p>' + esc(r.text) + '</p><figcaption>' + revMeta(r) + '</figcaption></figure>'; }).join('') + '</div></div></div></section>';
    }
    return '<section class="wbs-sec"><div class="wbs-wrap"><div class="wbs-headrow">' + head2('Guest reviews', '★ ' + F.avg.toFixed(1) + ' from ' + fmt.num(F.nReviews) + ' reviews', 'Collected from Airbnb, Booking.com, Agoda, Vrbo and Google.') + '</div><div class="wbs-rcards">' + rs.slice(0, 3).map(function (r) { return '<figure><div class="q-stars">' + stars(r.stars) + '</div><p>' + esc(r.text) + '</p><figcaption><span class="rc-av">' + esc(fmt.initials(r.guest)) + '</span><span>' + revMeta(r) + '</span></figcaption></figure>'; }).join('') + '</div></div></section>';
  };
  SEC.locations = function (X) {
    return '<section class="wbs-sec"><div class="wbs-wrap">' + head2('Destinations', (['One place', 'Two places', 'Three places', 'Four places', 'Five places', 'Six places'][X.F.cities.length - 1] || X.F.cities.length + ' places') + ' worth the trip', null) + '<div class="wbs-tiles">' + X.F.cities.map(function (c) { return '<button type="button" class="tl" data-wpid="' + c.props[0].id + '">' + img(c.scene, c.name + 't', 'tl-img', c.name) + '<span class="tl-cap"><b>' + esc(c.name) + '</b><span>' + c.props.length + ' home' + (c.props.length > 1 ? 's' : '') + ' · from ' + rmoney(c.from) + '</span></span></button>'; }).join('') + '</div></div></section>';
  };
  SEC.story = function (X, v) {
    var F = X.F, txt = storyText();
    if (v === 'timeline') return '<section class="wbs-sec soft"><div class="wbs-wrap">' + head2('Your stay', 'Simple from start to finish', null) + '<ol class="wbs-steps">' + [['Book', 'Pick dates and pay securely. Your invoice arrives straight away.'], ['Arrive', 'Accept the house rules in the guest app and your door code appears. Check-in from ' + fmt.time(F.checkIn) + '.'], ['Unwind', 'Wi-Fi, parking and local tips are all in the app. Message us any time.'], ['Leave', 'Check out by ' + fmt.time(F.checkOut) + '. Just close the door, we take care of the rest.']].map(function (s, i) { return '<li><span class="n">' + (i + 1) + '</span><b>' + s[0] + '</b><p>' + esc(s[1]) + '</p></li>'; }).join('') + '</ol></div></section>';
    if (v === 'zigzag') return '<section class="wbs-sec"><div class="wbs-wrap wbs-zz">' + [['bed', 'Cleaned by people we know', 'Our own housekeeping team prepares every home, and each one is inspected before you arrive.'], ['living', 'A host who answers', 'Questions about parking, late arrivals or the best laksa nearby? Message us on WhatsApp and a real person replies.'], [X.feat[0].scene, 'Homes in the right places', 'From Gurney Drive to Jonker Street, every home is close to food, transport and the things you came to see.']].map(function (z, i) { return '<div class="zz' + (i % 2 ? ' rev' : '') + '">' + img(z[0], 'zz' + i, 'zz-img', z[1]) + '<div><span class="zz-n">0' + (i + 1) + '</span><h3>' + esc(z[1]) + '</h3><p>' + esc(z[2]) + '</p></div></div>'; }).join('') + '</div></section>';
    return '<section class="wbs-sec"><div class="wbs-wrap"><div class="wbs-ed"><div class="ed-l">' + eyebrow('Our story') + '<h2 class="wbs-h2">Looked after, not just listed</h2>' + img('heritage', 'ed', 'ed-img', 'Shophouse street') + '</div><div class="ed-r"><p class="dropcap">' + esc(txt) + '</p><p>We still visit every home each week. If something is not right, we fix it before the next guest arrives, and we read every review, good or bad.</p><p class="ed-sign">— The ' + esc(X.ws.name) + ' team</p></div></div></div></section>';
  };
  SEC.stats = function (X) {
    var F = X.F;
    return '<section class="wbs-sec stats"><div class="wbs-wrap wbs-stats">' + [[F.avg.toFixed(1) + '★', 'average guest rating'], [F.props.length, 'homes to choose from'], [F.cities.length, 'destinations'], [fmt.num(F.hosted), 'stays hosted since ' + d.monthName(F.firstStay, true)]].map(function (s) { return '<div><b>' + esc(String(s[0])) + '</b><span>' + esc(s[1]) + '</span></div>'; }).join('') + '</div></section>';
  };
  SEC.ticker = function (X) {
    var items = X.F.props.map(function (x) { return x.city.toUpperCase() + ' — ' + x.short.toUpperCase(); });
    var row = items.map(function (t) { return '<span>' + esc(t) + '</span><i>★</i>'; }).join('');
    return '<div class="wbs-ticker" aria-hidden="true"><div class="tk-track">' + row + row + '</div></div>';
  };
  SEC.availability = function (X) {
    var x = X.F.byId[X.feat[0].id], days = d.range(d.add(D.TODAY, 1), d.add(D.TODAY, 14));
    var nBooked = days.filter(function (iso) { return isBooked(x.id, iso); }).length, gap = firstGap(x.id);
    var lead = (nBooked === 0 ? 'Every night is free right now. Tap a night to start your booking.' : nBooked === days.length ? 'All 14 nights are booked.' : nBooked + ' of the next 14 nights are booked. Tap a free night to start your booking.') + (nBooked && gap.from && gap.to ? ' Next free 3 nights: ' + d.dowName(gap.from) + ' ' + d.fmt(gap.from) + ' to ' + d.dowName(gap.to) + ' ' + d.fmt(gap.to) + '.' : '');
    return '<section class="wbs-sec tight"><div class="wbs-wrap">' + head2(null, 'Prices for the next two weeks', lead) + '<div class="wbs-strip">' + days.map(function (iso) { var b = isBooked(x.id, iso), sl = st.sel[x.id] || {}, on = sl.from && iso >= sl.from && (sl.to ? iso < sl.to : iso === sl.from); return '<button type="button" class="ds' + (b ? ' off' : '') + (on ? ' sel' : '') + (d.isWeekend(iso) ? ' we' : '') + '" ' + (b ? 'disabled' : 'data-wstrip="' + iso + '" data-pid="' + x.id + '" aria-label="' + esc(d.fmtY(iso) + ', ' + rmoney(price(x.id, iso))) + '"') + '><span>' + d.dowName(iso) + '</span><b>' + d.day(iso) + '</b><em>' + (b ? 'Booked' : rmoney(price(x.id, iso))) + '</em></button>'; }).join('') + '</div></div></section>';
  };
  SEC.cta = function (X, v) {
    var ws = X.ws;
    if (v === 'card') return '<section class="wbs-sec"><div class="wbs-wrap"><div class="wbs-ctacard"><h2 class="wbs-h2">Ready when you are</h2><p class="wbs-lead">Book direct and pay no platform fees. Questions first? We answer on WhatsApp.</p><div class="wbs-row c">' + btn('Check availability', '', 'data-wact="search"') + waBtn('WhatsApp us', 'ghost') + '</div></div></div></section>';
    if (v === 'whatsapp') return '<section class="wbs-sec"><div class="wbs-wrap"><div class="wbs-wa"><span class="wa-ic">' + O.icon('whatsapp') + '</span><div class="grow"><h2 class="wbs-h2">Not sure which home?</h2><p>Tell us your dates and who is coming. We will suggest the right place.</p></div>' + '<a class="wbs-btn" href="https://wa.me/' + String(waNumber()).replace(/\D/g, '') + '" target="_blank" rel="noopener">' + O.icon('whatsapp') + '<span>Chat on WhatsApp</span></a>' + '</div></div></section>';
    return '<section class="wbs-band"><div class="wbs-wrap band-in"><div><h2>Book direct and save the platform fees</h2><p>Same homes, same team. The best rate is always here on ' + esc(ws.domain) + '.</p></div>' + btn('Check availability', 'light', 'data-wact="search"') + '</div></section>';
  };

  /* =====================================================================
     EXTRA PAGE 1: PROPERTY & BOOKING (one per property)
     ===================================================================== */
  function calendar(x) {
    var sel = defaultSel(x), months = [d.monthStart(D.TODAY), d.monthStart(d.addMonths(D.TODAY, 1))];
    return '<div class="wbs-cal">' + months.map(function (m, mi) {
      var start = m, lead = (d.dow(start) + 6) % 7, days = d.range(start, d.monthEnd(start)), cells = '';
      for (var i = 0; i < lead; i++) cells += '<span class="cd blank"></span>';
      days.forEach(function (iso) {
        var past = iso <= D.TODAY, booked = !past && isBooked(x.id, iso), inR = sel.from && sel.to && iso >= sel.from && iso < sel.to;
        var cls = 'cd' + (past ? ' past' : '') + (booked ? ' booked' : '') + (inR ? ' in' : '') + (iso === sel.from ? ' s' : '') + (iso === sel.to ? ' e' : '');
        cells += '<button type="button" class="' + cls + '" ' + (past ? 'disabled' : 'data-wday="' + iso + '" data-pid="' + x.id + '"') + ' aria-label="' + esc(d.fmtY(iso) + (booked ? ', booked' : past ? '' : ', ' + rmoney(price(x.id, iso)))) + '"><b>' + d.day(iso) + '</b><em>' + (past ? '' : booked ? '—' : fmt.num(price(x.id, iso))) + '</em></button>';
      });
      return '<div class="cm' + (mi ? ' second' : '') + '"><div class="cm-h">' + esc(d.monthName(m, true) + ' ' + m.slice(0, 4)) + '</div><div class="cm-dow">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div><div class="cm-grid">' + cells + '</div></div>';
    }).join('') + '</div><div class="cal-key"><span><i class="k-free"></i>Available, price in RM</span><span><i class="k-booked"></i>Booked</span><span><i class="k-sel"></i>Your dates</span></div>';
  }
  function aboutLine(x) {
    return x.type.replace(/^\w/, function (c) { return c.toUpperCase(); }) + ' in ' + x.area + '. ' + (x.city === 'Cameron Highlands' ? 'Cool mornings, tea plantations on the doorstep and room for the whole family.' : x.city === 'Melaka' ? 'Steps from Jonker Street, the river walk and the best chicken rice balls in town.' : x.city === 'Penang' ? 'Close to hawker food, the sea and the heritage streets of George Town.' : 'A short walk to the train, malls and some of the best food in Kuala Lumpur.');
  }
  function factTiles(X, x) {
    return '<div class="pp-facts"><span><b>' + (x.beds || 'Studio') + '</b>' + (x.beds ? 'bedroom' + (x.beds > 1 ? 's' : '') : '') + '</span><span><b>' + x.sleeps + '</b>guests</span><span><b>' + fmt.time(X.F.checkIn) + '</b>check-in</span><span><b>' + fmt.time(X.F.checkOut) + '</b>check-out</span></div>';
  }
  function propertyPage(X) {
    var x = X.F.byId[X.pid] || X.F.byId[X.feat[0].id], secs = site().pageSections.property.filter(function (s) { return s.on; }), on = {};
    secs.forEach(function (s) { on[s.id] = true; });
    var other = X.F.props.filter(function (y) { return y.id !== x.id && y.city === x.city; }).concat(X.F.props.filter(function (y) { return y.city !== x.city; })).slice(0, 3);
    var parts = {
      gallery: '<div class="pp-gal g-' + X.t.skin + '">' + propImg(x, 0, 'g0') + propImg(x, 1, 'g1') + propImg(x, 2, 'g2') + propImg(x, 3, 'g3') + propImg(x, 4, 'g4') + '</div>',
      overview: '<div class="pp-block"><h2 class="wbs-h3">About this home</h2>' + factTiles(X, x) + '<p>' + esc(aboutLine(x)) + '</p></div>',
      amenities: '<div class="pp-block"><h2 class="wbs-h3">Amenities</h2>' + amenityList(x, 10) + '</div>',
      calendar: '<div class="pp-block" id="wbs-cal"><h2 class="wbs-h3">Availability</h2><p class="muted-s">Prices per night in RM. Tap your check-in date, then your check-out date.</p>' + calendar(x) + '</div>',
      reviews: (function () { var rs = reviewList(X, 4, x.id); return rs.length ? '<div class="pp-block"><h2 class="wbs-h3">Guest reviews ' + rating(x) + '</h2><div class="wbs-rcards two">' + rs.map(function (r) { return '<figure><div class="q-stars">' + stars(r.stars) + '</div><p>' + esc(r.text) + '</p><figcaption>' + revMeta(r) + '</figcaption></figure>'; }).join('') + '</div></div>' : ''; })(),
      location: '<div class="pp-block"><h2 class="wbs-h3">Location and house info</h2><div class="pp-loc">' + img(x.scene, x.id + 'loc', 'pp-map', x.area) + '<dl><dt>Area</dt><dd>' + esc(x.area) + '</dd><dt>Parking</dt><dd>' + esc(x.p.parking) + '</dd><dt>Entry</dt><dd>' + esc(x.lockBrand) + ' smart lock, code in the guest app</dd><dt>House rules</dt><dd>No smoking, no parties, quiet after 10 PM</dd></dl></div></div>'
    };
    var main = secs.filter(function (s) { return s.id !== 'gallery'; }).map(function (s) { return parts[s.id] || ''; }).join('');
    return '<section class="wbs-sec pp"><div class="wbs-wrap"><div class="pp-crumb"><button type="button" data-wnav="home">Home</button> / <span>' + esc(x.city) + '</span> / <b>' + esc(x.name) + '</b></div><h1 class="pp-title">' + esc(x.name) + '</h1><div class="pp-sub wbs-meta"><span>' + rating(x) + '</span><span>' + esc(x.area) + '</span><span>' + facts1(x) + '</span></div>' +
      (on.gallery ? parts.gallery : '') + '<div class="pp-cols"><div class="pp-main">' + main + '</div><aside class="pp-side">' + bookingCard(X, x) + '</aside></div>' +
      '<div class="pp-more"><h2 class="wbs-h3">More homes you might like</h2><div class="wbs-cards">' + other.map(function (y) { return propCard(y); }).join('') + '</div></div></div></section>';
  }

  /* =====================================================================
     EXTRA PAGE 2: ABOUT & CONTACT
     ===================================================================== */
  function faqs(X) {
    var F = X.F;
    return [
      ['What time is check-in and check-out?', 'Check-in is from ' + fmt.time(F.checkIn) + ' and check-out is by ' + fmt.time(F.checkOut) + '. Early check-in or late checkout is often possible; message us to ask.'],
      ['How do I get in?', 'Every home has a smart lock. Your door code appears in the guest app once you have accepted the house rules and your ID is verified.'],
      ['Is there a tourism tax?', 'Malaysia charges tourism tax of RM 10 per room per night for non-Malaysian guests. It is shown on your invoice.'],
      ['Will I get an invoice and a receipt?', 'Yes. An invoice is sent when your booking is confirmed and a receipt as soon as payment arrives, by email or WhatsApp.'],
      ['Is there parking?', (F.props.length - F.noParking) + ' of our ' + F.props.length + ' homes include a parking bay. Each home page says exactly where to park.'],
      ['Why book here instead of a booking platform?', 'Same homes and the same team, without the platform service fee. You also deal with us directly from the start.']
    ];
  }
  function aboutPage(X) {
    var F = X.F, ws = X.ws, secs = site().pageSections.about.filter(function (s) { return s.on; });
    var team = D.staff.filter(function (s) { return ['owner', 'ops', 'housekeeping', 'frontdesk'].indexOf(s.role) >= 0; }).slice(0, 4);
    var TITLE = { owner: 'Founder and host', ops: 'Guest experience', housekeeping: 'Housekeeping', frontdesk: 'Guest support' };
    var wa = 'https://wa.me/' + String(waNumber()).replace(/\D/g, '');
    var parts = {
      story: '<section class="wbs-sec"><div class="wbs-wrap ab-story">' + '<div>' + eyebrow('About ' + ws.name) + '<h1 class="ab-h1">' + esc('A small team looking after ' + F.props.length + ' homes') + '</h1><p class="wbs-lead">' + esc(storyText()) + '</p></div>' + img(X.feat[0].scene, 'about', 'ab-img', 'One of our homes') + '</div></section>',
      team: '<section class="wbs-sec soft"><div class="wbs-wrap">' + head2('The team', 'The people looking after you', null) + '<div class="ab-team">' + team.map(function (s) { return '<div class="tm"><span class="tm-av">' + esc(fmt.initials(s.name)) + '</span><b>' + esc(s.name) + '</b><span>' + esc(TITLE[s.role] || s.roleLabel) + '</span></div>'; }).join('') + '</div></div></section>',
      stats: SEC.stats(X),
      faq: '<section class="wbs-sec"><div class="wbs-wrap ab-faqwrap">' + head2('Questions', 'Good to know', 'Anything else? Ask us on WhatsApp.') + '<div class="ab-faq">' + faqs(X).map(function (q, i) { var open = st.faqOpen[i] != null ? st.faqOpen[i] : i === 0; return '<div class="fq' + (open ? ' open' : '') + '"><button type="button" data-wfaq="' + i + '" aria-expanded="' + open + '"><span>' + esc(q[0]) + '</span><i>' + (open ? '−' : '+') + '</i></button><p>' + esc(q[1]) + '</p></div>'; }).join('') + '</div></div></section>',
      contact: '<section class="wbs-sec soft" id="wbs-contact"><div class="wbs-wrap ab-contact"><div>' + head2('Contact', 'Talk to us', 'We usually reply within the hour, 8 AM to 11 PM.') + '<a class="wbs-btn wa" href="' + esc(wa) + '" target="_blank" rel="noopener">' + O.icon('whatsapp') + '<span>WhatsApp ' + esc(waNumber()) + '</span></a><dl class="ab-dl"><dt>Email</dt><dd>' + esc(ws.email) + '</dd><dt>Phone</dt><dd>' + esc(ws.phone) + '</dd><dt>Office</dt><dd>' + esc(ws.address) + '</dd></dl></div>' +
        '<form class="ab-form" onsubmit="return false"><label>Your name<input placeholder="Full name"></label><label>Email or phone<input placeholder="So we can reply"></label><label>Which home?<select>' + '<option>Not sure yet</option>' + F.props.map(function (x) { return '<option>' + esc(x.name) + '</option>'; }).join('') + '</select></label><label>Message<textarea rows="4" placeholder="Dates, number of guests, questions"></textarea></label>' + btn('Send message', 'full', 'data-wact="enquire"') + '</form></div></section>'
    };
    return secs.map(function (s) { return parts[s.id] || ''; }).join('');
  }

  /* =====================================================================
     PAGE UI
     ===================================================================== */
  function directStats() {
    var from = d.add(D.TODAY, -89), bs = M.bookingsCreated(from, D.TODAY).filter(function (b) { return b.status !== 'cancelled'; });
    var dir = bs.filter(function (b) { return b.channel === 'direct'; });
    var ota = ['airbnb', 'booking', 'agoda'].map(function (k) { return D.channels[k].feePct; });
    var otaFee = ota.reduce(function (s, x) { return s + x; }, 0) / ota.length;
    var saved = dir.reduce(function (s, b) { return s + b.accommodation * (otaFee - D.channels.direct.feePct); }, 0);
    var weeks = []; for (var w = 12; w >= 0; w--) { var a = d.add(D.TODAY, -w * 7 - 6), z = d.add(D.TODAY, -w * 7); weeks.push(dir.filter(function (b) { var c = b.createdAt.slice(0, 10); return c >= a && c <= z; }).length); }
    return { n: dir.length, share: bs.length ? dir.length / bs.length : 0, saved: saved, otaFee: otaFee, rev: dir.reduce(function (s, b) { return s + b.accommodation; }, 0), weeks: weeks };
  }
  function kpiStrip() {
    var S = site(), ds = directStats(), live = TPL_BY[S.published ? S.published.template : S.template];
    var items = [
      { label: 'Site status', value: S.published ? (S.changed ? 'Draft changes' : 'Live') : 'Not published', sub: S.published ? 'Published ' + d.fmt(S.published.at.slice(0, 10)) + ', ' + fmt.time(S.published.at) : 'Publish to go live', hl: true },
      { label: 'Live template', value: esc(live ? live.name : '–'), sub: esc(O.ws().domain) },
      { label: 'Direct bookings', value: fmt.num(ds.n), sub: 'Last 90 days, by week', spark: ds.weeks },
      { label: 'Direct share', value: fmt.pct(ds.share), sub: 'of bookings, 90 days' }
    ];
    if (O.isOwner()) items.push({ label: 'Fees saved, 90 days', value: fmt.money(ds.saved), sub: 'vs ' + Math.round(ds.otaFee * 100) + '% platform fee', title: 'Direct accommodation ' + fmt.money(ds.rev) + ' × (platform fee ' + Math.round(ds.otaFee * 100) + '% − direct card fee ' + Math.round(D.channels.direct.feePct * 100) + '%)' });
    items.push({ label: 'Pages', value: (1 + D.properties.length + 1) + '', sub: 'Home, About, ' + D.properties.length + ' stays' });
    return U.kpis(items);
  }
  function styleCounts() { var c = { all: TPL.length }; TPL.forEach(function (t) { c[t.style] = (c[t.style] || 0) + 1; }); return c; }
  function galleryHTML() {
    var S = site(), c = styleCounts(), list = TPL.filter(function (t) { return st.style === 'all' || t.style === st.style; });
    var cur = TPL_BY[S.template];
    return '<div class="toolbar wb-filters"><div class="chips" role="group" aria-label="Filter templates by style"><span class="chip-group-label">Style</span>' + [['all', 'All']].concat(STYLES.map(function (s) { return [s, s]; })).map(function (s) { return '<button type="button" class="chip' + (st.style === s[0] ? ' on' : '') + '" data-style="' + s[0] + '">' + esc(s[1]) + ' <span class="n">' + (c[s[0]] || 0) + '</span></button>'; }).join('') + '</div><span class="spacer"></span><span class="small muted">' + esc(list.length + ' of ' + TPL.length + ' layouts · previews use your logo, colours and properties') + '</span></div>' +
      '<div class="wb-gallery">' + list.map(function (t) {
        var isCur = t.id === S.template, isLive = S.published && S.published.template === t.id;
        return '<article class="card wb-tcard' + (isCur ? ' cur' : '') + '"><div role="button" tabindex="0" class="wb-thumb" data-act="preview" data-t="' + t.id + '" aria-label="Preview the ' + esc(t.name) + ' template"><div class="wb-fit" data-fit="1280" aria-hidden="true" inert>' + renderSite(t, 'home', { limit: 3 }) + '</div></div>' +
          '<div class="wb-tinfo"><div class="row-flex"><b class="wb-tname">' + esc(t.name) + '</b>' + U.pill(t.style, 'neutral') + (isLive ? U.pill('Live', 'ok') : '') + (isCur && !isLive ? U.pill('Editing', 'brand') : '') + '</div><p class="small muted">' + esc(t.desc) + '</p><div class="xs"><span class="muted">Best for:</span> <b>' + esc(t.best) + '</b></div>' +
          '<div class="row-flex wb-tact"><button type="button" class="btn btn-ghost btn-sm" data-act="preview" data-t="' + t.id + '">' + O.icon('eye') + 'Preview</button>' + (isCur ? '<button type="button" class="btn btn-ghost btn-sm" data-act="edit">' + O.icon('edit') + 'Edit site</button>' : '<button type="button" class="btn btn-primary btn-sm" data-act="use" data-t="' + t.id + '"' + (canEdit() ? '' : ' disabled') + '>Use this template</button>') + '</div></div></article>';
      }).join('') + (list.length ? '' : U.empty('No templates in this style.')) + '</div>' +
      '<div class="section-title">Every site also gets these 2 pages</div><div class="grid g2 wb-extra">' +
      [['property', 'Property & booking', 'One page per property (' + D.properties.length + ' in total): photo gallery, amenities, live availability calendar from your bookings, nightly prices and a book button.'], ['about', 'About & contact', 'Your story and team, questions and answers, a contact form and a WhatsApp button.']].map(function (p) {
        return '<article class="card wb-tcard"><div role="button" tabindex="0" class="wb-thumb" data-act="preview" data-t="' + cur.id + '" data-page="' + p[0] + '" aria-label="Preview the ' + esc(p[1]) + ' page"><div class="wb-fit" data-fit="1280" aria-hidden="true" inert>' + renderSite(cur, p[0], {}) + '</div></div><div class="wb-tinfo"><div class="row-flex"><b class="wb-tname">' + esc(p[1]) + '</b>' + U.pill('In the ' + cur.name + ' style', 'brand') + '</div><p class="small muted">' + esc(p[2]) + '</p><div class="row-flex wb-tact"><button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-page="' + p[0] + '">' + O.icon('edit') + 'Edit this page</button></div></div></article>';
      }).join('') + '</div>';
  }
  function secRows(list, kind) {
    var ro = !canEdit();
    return '<div class="wb-secs">' + list.map(function (s, i) {
      var locked = s.id === 'hero';
      return '<div class="wb-sec' + (s.on || locked ? '' : ' off') + '"><div class="wb-ord"><button type="button" class="wb-mini" data-act="up" data-kind="' + kind + '" data-i="' + i + '" aria-label="Move ' + esc(SEC_LABEL[s.id]) + ' up"' + (i === 0 || locked || ro || (list[i - 1] && list[i - 1].id === 'hero') ? ' disabled' : '') + '>' + O.icon('up') + '</button><button type="button" class="wb-mini" data-act="down" data-kind="' + kind + '" data-i="' + i + '" aria-label="Move ' + esc(SEC_LABEL[s.id]) + ' down"' + (i === list.length - 1 || locked || ro ? ' disabled' : '') + '>' + O.icon('down') + '</button></div>' +
        '<div class="grow"><div class="b small">' + esc(SEC_LABEL[s.id] || s.id) + '</div><div class="xs muted">' + esc(SEC_DESC[s.id] || (s.v ? 'Layout: ' + (VLABEL[s.id + '.' + s.v] || VLABEL[s.v] || s.v) : '')) + '</div></div>' +
        (locked ? '<span class="xs muted">Always on</span>' : '<button type="button" class="switch' + (s.on ? ' on' : '') + '" role="switch" aria-checked="' + s.on + '" aria-label="Show ' + esc(SEC_LABEL[s.id]) + '" data-act="toggle" data-kind="' + kind + '" data-i="' + i + '"' + (ro ? ' disabled' : '') + '></button>') + '</div>';
    }).join('') + '</div>';
  }
  function field(name, label, value, ph, opts) {
    opts = opts || {};
    var dis = canEdit() ? '' : ' disabled', max = opts.max ? ' maxlength="' + (opts.max + 40) + '"' : '';
    var input = opts.area ? '<textarea class="textarea" id="wb-f-' + name + '" data-field="' + name + '" rows="' + (opts.rows || 3) + '" placeholder="' + esc(ph) + '"' + dis + '>' + esc(value) + '</textarea>' : '<input class="input" id="wb-f-' + name + '" data-field="' + name + '" value="' + esc(value) + '" placeholder="' + esc(ph) + '"' + max + dis + '>';
    return '<div class="field"><label for="wb-f-' + name + '">' + esc(label) + (opts.max ? ' <span class="wb-count" data-count="' + name + '">' + (value || ph).length + '/' + opts.max + '</span>' : '') + '</label>' + input + (opts.hint ? '<div class="hint">' + esc(opts.hint) + '</div>' : '') + '</div>';
  }
  function editorHTML() {
    var S = site(), t = TPL_BY[S.template], cp = copyOf(t), F = facts(), ro = !canEdit();
    var dflt = typeof t.copy === 'function' ? t.copy(F, O.ws()) : t.copy;
    var left = '';
    left += '<div class="card"><div class="card-body wb-tplbox"><div class="wb-tplmini" aria-hidden="true"><div class="wb-fit" data-fit="1280" inert>' + renderSite(t, 'home', { limit: 1 }) + '</div></div><div class="grow"><div class="xs muted b">Template</div><div class="b">' + esc(t.name) + '</div><div class="xs muted">' + esc(t.style + ' · ' + t.best) + '</div></div><button type="button" class="btn btn-ghost btn-sm" data-act="gallery">Change</button></div></div>';
    if (st.page === 'home') {
      left += '<div class="card"><div class="card-head"><div><h3>Home page sections</h3><div class="sub">Show, hide and reorder</div></div></div><div class="card-body">' + secRows(tplSections(t), 'home') + '</div></div>';
      left += '<div class="card"><div class="card-head"><div><h3>Headline and button</h3><div class="sub">Leave empty to use the template wording</div></div>' + (S.content.headline || S.content.sub || S.content.cta ? '<button type="button" class="btn btn-quiet btn-sm" data-act="reset-copy"' + (ro ? ' disabled' : '') + '>Reset</button>' : '') + '</div><div class="card-body stack">' +
        field('headline', 'Headline', S.content.headline, dflt[0], { max: 70 }) + field('sub', 'Subheadline', S.content.sub, dflt[1], { area: true, max: 160 }) + field('cta', 'Button label', S.content.cta, dflt[2], { max: 24 }) + '</div></div>';
      left += '<div class="card"><div class="card-head"><div><h3>Featured properties</h3><div class="sub">' + S.featured.length + ' selected · shown in this order on the home page</div></div></div><div class="card-body wb-feat">' + F.props.map(function (x) { var i = S.featured.indexOf(x.id); return '<label class="check"><input type="checkbox" data-feat="' + x.id + '"' + (i >= 0 ? ' checked' : '') + (ro ? ' disabled' : '') + '><span class="grow"><b>' + esc(x.name) + '</b> <span class="xs muted">' + esc(x.city) + ' · from ' + rmoney(x.from) + '</span></span>' + (i >= 0 ? '<span class="wb-ordn">' + (i + 1) + '</span>' : '') + '</label>'; }).join('') + '</div></div>';
    } else if (st.page === 'property') {
      left += '<div class="card"><div class="card-head"><div><h3>Property page</h3><div class="sub">The same layout is used for all ' + F.props.length + ' properties</div></div></div><div class="card-body stack"><div class="field"><label for="wb-pp">Preview property</label><select class="select" id="wb-pp" data-act="pp">' + F.props.map(function (x) { return '<option value="' + x.id + '"' + (x.id === S.propertyId ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></div>' + secRows(S.pageSections.property, 'property') + '<div class="note">Availability and prices come from your bookings, blocked dates and Pricing. Booked nights cannot be selected.</div></div></div>';
    } else {
      left += '<div class="card"><div class="card-head"><div><h3>About & contact sections</h3><div class="sub">Show, hide and reorder</div></div></div><div class="card-body">' + secRows(S.pageSections.about, 'about') + '</div></div>';
      left += '<div class="card"><div class="card-head"><div><h3>Your story and contact</h3></div></div><div class="card-body stack">' + field('story', 'Our story', S.content.story, storyText(), { area: true, rows: 5 }) + field('whatsapp', 'WhatsApp number', S.content.whatsapp, O.ws().phone, { hint: 'The WhatsApp button opens a chat with this number.' }) + '<div class="xs muted">Email, phone and address come from Brand & Setup: ' + esc(O.ws().email) + ' · ' + esc(O.ws().address) + '</div></div></div>';
    }
    left += '<div class="card"><div class="card-head"><div><h3>Search engines (SEO)</h3><div class="sub">How the site appears on Google</div></div></div><div class="card-body stack">' + field('seoTitle', 'Page title', S.seo.title, seoTitle(), { max: 60 }) + field('seoDesc', 'Meta description', S.seo.desc, seoDesc(), { area: true, max: 160, rows: 4 }) + '<div class="wb-serp" data-serp>' + serpHTML() + '</div></div></div>';
    left += '<div class="note brand wb-brandnote"><b>Colours and logo come from Brand & Setup automatically.</b> Every template uses your main colour, second colour and logo, so a new logo restyles the whole site.<div><button type="button" class="btn btn-quiet btn-sm" data-act="brand">Open Brand & Setup</button></div></div>';

    var path = st.page === 'home' ? '/' : st.page === 'property' ? '/stays/' + F.byId[S.propertyId].slug : '/about';
    var right = '<div class="card wb-prevcard"><div class="wb-prevbar">' + U.seg([['home', 'Home'], ['property', 'Property & booking'], ['about', 'About & contact']], st.page, 'data-pagetab') + '<span class="spacer"></span>' + U.seg([['desktop', 'Desktop'], ['phone', 'Phone']], st.device, 'data-device') + '<button type="button" class="btn btn-ghost btn-sm" data-act="full">' + O.icon('eye') + 'Full screen</button></div>' +
      '<div class="wb-stage dev-' + st.device + '">' + (st.device === 'phone' ? '<div class="phone"><div class="phone-screen"><div class="wb-site" id="wb-site">' + renderSite(t, st.page, {}) + '</div></div></div>' :
        '<div class="wb-browser"><div class="wb-chrome"><i></i><i></i><i></i><span class="wb-url">' + O.icon('lock') + '<span>' + esc(O.ws().domain + path) + '</span></span></div><div class="wb-viewport"><div class="wb-fit" data-fit="1280" id="wb-site">' + renderSite(t, st.page, {}) + '</div></div></div>') + '</div>' +
      '<div class="card-foot">Preview is clickable: open stays, pick dates on the calendar, try the booking button. Prototype: nothing is really booked or sent.</div></div>';
    return '<div class="wb-editor"><div class="wb-left stack">' + left + '</div><div class="wb-right">' + right + publishCard() + '</div></div>';
  }
  function serpHTML() { return '<div class="xs muted">' + esc('https://' + O.ws().domain) + '</div><div class="wb-serp-t">' + esc(seoTitle()) + '</div><div class="small muted">' + esc(seoDesc()) + '</div>'; }
  function publishCard() {
    var S = site(), live = S.published ? TPL_BY[S.published.template] : null;
    return '<div class="card wb-pub"><div class="card-head"><div><h3>Publishing</h3><div class="sub">' + esc(O.ws().domain) + '</div></div>' + (S.changed ? U.pill('Unpublished changes', 'warn') : U.pill('Up to date', 'ok')) + '</div><div class="card-body"><div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Template</th><th>By</th></tr></thead><tbody>' +
      S.log.slice(0, 4).map(function (l) { return '<tr><td class="nowrap">' + esc(fmt.dateTime(l.at)) + '</td><td>' + esc((TPL_BY[l.template] || {}).name || l.template) + '</td><td>' + esc((D.staffById(l.by) || {}).name || '') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div class="row-flex wrap" style="margin-top:12px"><button type="button" class="btn btn-primary" data-act="publish"' + (canEdit() ? '' : ' disabled') + '>' + O.icon('upload') + 'Publish to ' + esc(O.ws().domain) + '</button>' + (live ? '<span class="xs muted">Live now: ' + esc(live.name) + '</span>' : '') + '</div><div class="xs muted" style="margin-top:8px">Prototype: publishing is simulated and no site goes live.</div></div></div>';
  }

  /* full-screen preview overlay */
  function fullHTML() {
    var f = st.full, t = TPL_BY[f.t], S = site();
    return '<div class="wb-full" role="dialog" aria-modal="true" aria-label="' + esc(t.name + ' template preview') + '"><div class="wb-fullbar"><b>' + esc(t.name) + '</b><span class="xs muted wb-hide-sm">' + esc(t.style + ' · ' + t.best) + '</span><span class="spacer"></span>' + U.seg([['home', 'Home'], ['property', 'Property'], ['about', 'About']], f.page, 'data-fpage') + U.seg([['desktop', 'Desktop'], ['phone', 'Phone']], f.device, 'data-fdevice') +
      (t.id !== S.template && canEdit() ? '<button type="button" class="btn btn-primary btn-sm" data-act="use" data-t="' + t.id + '">Use this template</button>' : '') + '<button type="button" class="icon-btn" data-act="close-full" aria-label="Close preview">' + O.icon('x') + '</button></div>' +
      '<div class="wb-fullbody dev-' + f.device + '">' + (f.device === 'phone' ? '<div class="phone"><div class="phone-screen"><div class="wb-site" id="wb-fsite">' + renderSite(t, f.page, {}) + '</div></div></div>' : '<div class="wb-site wb-fullsite" id="wb-fsite">' + renderSite(t, f.page, {}) + '</div>') + '</div></div>';
  }

  function fitAll(scope) {
    O.$$('[data-fit]', scope || document).forEach(function (el) {
      var w = el.parentElement.clientWidth; if (!w) return;
      el.style.width = el.dataset.fit + 'px';
      el.style.zoom = String(Math.min(1, w / +el.dataset.fit));
    });
  }
  var resizeBound = false;
  function bindResize() {
    if (resizeBound) return; resizeBound = true;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st.full && O.state.page === 'website' && !document.querySelector('.modal-back')) { st.full = null; O.render(false); } });
    var tmr; window.addEventListener('resize', function () { clearTimeout(tmr); tmr = setTimeout(function () { if (O.state.page === 'website') fitAll(); }, 120); });
  }

  /* =====================================================================
     RENDER + EVENTS
     ===================================================================== */
  function render(root, ctx) {
    cache = null; gid = 0;
    if (!canView()) { var v = O.viewer(); root.innerHTML = '<div class="pg-website"><div class="locked"><div class="lk">🔒</div><b>Website builder is not part of your access</b><div class="small">You are viewing as ' + esc(v.name) + ' (' + esc(v.roleLabel) + '). The account owner can grant website access in Staff Access.</div></div></div>'; return; }
    var S = site();
    if (!TPL_BY[S.template]) S.template = 'harbour';
    if (ctx.params && ctx.params.tab && ctx.fresh) { st.view = ctx.params.tab; }
    if (ctx.fresh) st.full = null;
    if (window.innerWidth < 700 && ctx.fresh) st.device = 'phone';
    ctx.setActions('<button type="button" class="btn btn-ghost" data-act="full">' + O.icon('eye') + '<span>Preview site</span></button><button type="button" class="btn btn-primary" data-act="publish"' + (canEdit() ? '' : ' disabled') + '>' + O.icon('upload') + '<span>Publish</span></button>');
    root.innerHTML = '<div class="pg-website">' + kpiStrip() +
      (canEdit() ? '' : '<div class="note warn" style="margin-bottom:14px">You can look at templates and previews. Editing and publishing the website needs website edit access (Staff Access).</div>') +
      '<div class="tabs" role="tablist"><button type="button" role="tab" data-view="gallery" class="' + (st.view === 'gallery' ? 'on' : '') + '">Templates <span class="pill neutral">' + TPL.length + '</span></button><button type="button" role="tab" data-view="editor" class="' + (st.view === 'editor' ? 'on' : '') + '">Edit site: ' + esc(TPL_BY[S.template].name) + (S.changed ? ' <span class="pill warn">Draft</span>' : '') + '</button></div>' +
      '<div class="wb-body">' + (st.view === 'gallery' ? galleryHTML() : editorHTML()) + '</div>' + (st.full ? fullHTML() : '') + '</div>';
    bindResize();
    requestAnimationFrame(function () { fitAll(root); });
    var acts = ctx.actionsEl;
    if (acts && !acts._wb) { acts._wb = true; }
    acts.onclick = function (e) { var b = e.target.closest('[data-act]'); if (b) handle(b, e, root, ctx); };
    root.onclick = function (e) { onClick(e, root, ctx); };
    root.oninput = function (e) { onInput(e, root); };
    root.onchange = function (e) { onChange(e, root, ctx); };
    root.onsubmit = function (e) { e.preventDefault(); };
    root.onkeydown = function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('wb-thumb')) { e.preventDefault(); handle(e.target, e, root, ctx); } };

  }
  function refreshPreview(root) {
    var S = site(), t = TPL_BY[S.template]; cache = null;
    var el = O.$('#wb-site', root); if (el) el.innerHTML = renderSite(t, st.page, {});
    var fe = O.$('#wb-fsite', root); if (fe && st.full) fe.innerHTML = renderSite(TPL_BY[st.full.t], st.full.page, {});
    var serp = O.$('[data-serp]', root); if (serp) serp.innerHTML = serpHTML();
  }
  function scrollSiteTop(root) { var vp = O.$('.wb-viewport', root) || O.$('.phone-screen', root); if (vp) vp.scrollTop = 0; var fb = O.$('.wb-fullbody', root); if (fb) fb.scrollTop = 0; var ps = O.$('.wb-fullbody .phone-screen', root); if (ps) ps.scrollTop = 0; }

  function onInput(e, root) {
    var f = e.target.dataset.field; if (!f || !canEdit()) return;
    var S = site(), v = e.target.value;
    if (f === 'seoTitle') S.seo.title = v; else if (f === 'seoDesc') S.seo.desc = v; else S.content[f] = v;
    touch();
    var cnt = O.$('[data-count="' + f + '"]', root); if (cnt) { var max = +cnt.textContent.split('/')[1]; var len = (v || e.target.placeholder).length; cnt.textContent = len + '/' + max; cnt.classList.toggle('over', len > max); }
    refreshPreview(root);
  }
  function onChange(e, root, ctx) {
    var t = e.target, S = site();
    if (t.dataset.feat) {
      var id = t.dataset.feat, i = S.featured.indexOf(id);
      if (t.checked && i < 0) S.featured.push(id);
      if (!t.checked && i >= 0) { if (S.featured.length === 1) { t.checked = true; U.toast('Keep at least one featured property.', 'bad'); return; } S.featured.splice(i, 1); }
      touch(); ctx.rerender(); return;
    }
    if (t.dataset.act === 'pp') { S.propertyId = t.value; ctx.rerender(); }
  }
  function moveSec(kind, i, dir) {
    var S = site(), list = kind === 'home' ? tplSections(TPL_BY[S.template]) : S.pageSections[kind], j = i + dir;
    if (j < 0 || j >= list.length || list[j].id === 'hero' || list[i].id === 'hero') return;
    var tmp = list[i]; list[i] = list[j]; list[j] = tmp; touch();
  }
  function onClick(e, root, ctx) {
    var S = site(), b;
    /* inside a site preview */
    var inSite = e.target.closest('.wbs');
    if (inSite && !e.target.closest('.wb-thumb') && !e.target.closest('.wb-tplmini')) {
      if (e.target.closest('a[href]')) return; /* WhatsApp link opens in a new tab */
      b = e.target.closest('[data-wfaq]');
      if (b) { var k = +b.dataset.wfaq, open = b.parentElement.classList.toggle('open'); st.faqOpen[k] = open; b.setAttribute('aria-expanded', open); O.$('i', b).textContent = open ? '−' : '+'; return; }
      b = e.target.closest('[data-wstrip]');
      if (b) { pickStrip(b.dataset.pid, b.dataset.wstrip, root); return; }
      b = e.target.closest('[data-wday]');
      if (b) { pickDay(b.dataset.pid, b.dataset.wday, root); return; }
      b = e.target.closest('[data-wpid]');
      if (b) { S.propertyId = b.dataset.wpid; goSitePage('property', root, ctx); return; }
      b = e.target.closest('[data-wnav]');
      if (b) { goSitePage(b.dataset.wnav, root, ctx, b.dataset.anchor); return; }
      b = e.target.closest('[data-wact]');
      if (b) { siteAction(b, root, ctx); return; }
      if (e.target.closest('input,select,textarea,label')) return;
      return;
    }
    b = e.target.closest('[data-view]'); if (b) { st.view = b.dataset.view; ctx.rerender(); return; }
    b = e.target.closest('[data-style]'); if (b) { st.style = b.dataset.style; ctx.rerender(); return; }
    b = e.target.closest('[data-pagetab]'); if (b) { st.page = b.dataset.pagetab; ctx.rerender(); return; }
    b = e.target.closest('[data-device]'); if (b) { st.device = b.dataset.device; ctx.rerender(); return; }
    b = e.target.closest('[data-fpage]'); if (b) { st.full.page = b.dataset.fpage; ctx.rerender(); return; }
    b = e.target.closest('[data-fdevice]'); if (b) { st.full.device = b.dataset.fdevice; ctx.rerender(); return; }
    b = e.target.closest('[data-act]'); if (b && b.tagName !== 'SELECT') handle(b, e, root, ctx);
  }
  function handle(b, e, root, ctx) {
    var S = site(), a = b.dataset.act;
    if (a === 'preview') { st.full = { t: b.dataset.t, page: b.dataset.page || 'home', device: window.innerWidth < 700 ? 'phone' : 'desktop' }; ctx.rerender(); return; }
    if (a === 'full') { st.full = { t: S.template, page: st.view === 'editor' ? st.page : 'home', device: window.innerWidth < 700 ? 'phone' : (st.view === 'editor' ? st.device : 'desktop') }; ctx.rerender(); return; }
    if (a === 'close-full') { st.full = null; ctx.rerender(); return; }
    if (a === 'use') {
      if (!canEdit()) return;
      var t = TPL_BY[b.dataset.t], prev = TPL_BY[S.template];
      S.template = t.id; touch(); st.full = null; st.view = 'editor'; st.page = 'home';
      var own = S.content.headline || S.content.sub || S.content.cta;
      U.toast('Now editing ' + t.name + '. ' + (own ? 'Your headline, featured' : 'Featured') + ' properties, property and about page settings and SEO carry over from ' + prev.name + '.', 'ok');
      ctx.rerender(); return;
    }
    if (a === 'edit') { st.view = 'editor'; if (b.dataset.page) st.page = b.dataset.page; ctx.rerender(); return; }
    if (a === 'gallery') { st.view = 'gallery'; ctx.rerender(); return; }
    if (a === 'brand') { O.go('brand'); return; }
    if (a === 'toggle') { if (!canEdit()) return; var list = b.dataset.kind === 'home' ? tplSections(TPL_BY[S.template]) : S.pageSections[b.dataset.kind]; var s = list[+b.dataset.i]; s.on = !s.on; touch(); ctx.rerender(); return; }
    if (a === 'up' || a === 'down') { if (!canEdit()) return; moveSec(b.dataset.kind, +b.dataset.i, a === 'up' ? -1 : 1); ctx.rerender(); return; }
    if (a === 'reset-copy') { S.content.headline = ''; S.content.sub = ''; S.content.cta = ''; touch(); ctx.rerender(); return; }
    if (a === 'publish') { publish(ctx); return; }
  }
  function goSitePage(page, root, ctx, anchor) {
    if (st.full) st.full.page = page; else st.page = page;
    if (st.full) { ctx.rerender(); scrollSiteTop(root); }
    else {
      /* editor: update the tabs + preview without losing scroll position of the editor */
      ctx.rerender(); scrollSiteTop(root);
    }
    if (anchor) setTimeout(function () { var el = O.$('#wbs-contact', root); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 60);
  }
  function pickDay(pid, iso, root) {
    var x = facts().byId[pid], sel = defaultSel(x);
    if (!sel.from || sel.to) { if (isBooked(pid, iso)) { U.toast('That night is already booked. Pick another check-in date.', 'bad'); return; } st.sel[pid] = { from: iso, to: null }; }
    else if (iso <= sel.from) { if (isBooked(pid, iso)) return; st.sel[pid] = { from: iso, to: null }; }
    else {
      var clash = d.range(sel.from, d.add(iso, -1)).some(function (n) { return isBooked(pid, n); });
      if (clash) { U.toast('Some nights in between are booked. Pick a shorter stay.', 'bad'); return; }
      st.sel[pid] = { from: sel.from, to: iso };
    }
    var keep = O.$('.wb-viewport', root) || O.$('.wb-fullbody', root), top = keep ? keep.scrollTop : 0, ps = O.$('.phone-screen', root), ptop = ps ? ps.scrollTop : 0;
    refreshPreview(root);
    if (keep) keep.scrollTop = top; if (ps) ps.scrollTop = ptop;
  }
  /* 14-day strip on the home page has no calendar for a check-out date: book 2 nights from the tapped night (1 if the next is taken) */
  function pickStrip(pid, iso, root) {
    var n = isBooked(pid, d.add(iso, 1)) ? 1 : 2;
    st.sel[pid] = { from: iso, to: d.add(iso, n) };
    var keep = O.$('.wb-viewport', root) || O.$('.wb-fullbody', root), top = keep ? keep.scrollTop : 0, ps = O.$('.phone-screen', root), ptop = ps ? ps.scrollTop : 0;
    refreshPreview(root);
    if (keep) keep.scrollTop = top; if (ps) ps.scrollTop = ptop;
    U.toast(fmt.plural(n, 'night') + ' from ' + d.dowName(iso) + ' ' + d.fmt(iso) + ' added to the booking card.', 'ok');
  }
  function siteAction(b, root, ctx) {
    var a = b.dataset.wact, S = site();
    if (a === 'menu') { var h = b.closest('.wh, .wh-sidebar-m'); if (h) h.classList.toggle('open'); return; }
    if (a === 'scroll') { var sec = b.closest('.wbs-sec'), car = sec && O.$('.wbs-carousel', sec); if (car) { var card = car.firstElementChild; car.scrollBy({ left: (+b.dataset.dir) * ((card ? card.getBoundingClientRect().width : 300) + 22), behavior: 'smooth' }); } return; }
    if (a === 'search') { goSitePage('property', root, ctx); return; }
    if (a === 'enquire') { U.toast('Preview: on the live site this enquiry arrives in Guest inbox.', 'ok'); return; }
    if (a === 'book') {
      var pid = b.dataset.pid; if (!pid) { goSitePage('property', root, ctx); return; }
      var x = facts().byId[pid], q = quote(x);
      if (!q) { U.toast('Pick a check-out date on the calendar first.', 'bad'); return; }
      U.modal({ title: 'Guest checkout (preview)', sub: x.name + ' · ' + d.fmtRange(q.from, q.to),
        body: '<dl class="kv"><dt>Stay</dt><dd>' + esc(d.fmtY(q.from)) + ' → ' + esc(d.fmtY(q.to)) + '</dd><dt>' + fmt.plural(q.nights, 'night') + (q.nights > 1 ? ' (avg ' + rmoney(q.avg) + ' a night)' : '') + '</dt><dd>' + rmoney(q.acc) + '</dd><dt>Cleaning fee</dt><dd>' + rmoney(q.cleaning) + '</dd><dt class="tot">Total</dt><dd class="tot">' + rmoney(q.total) + '</dd></dl><div class="note" style="margin-top:12px">On the live site the guest pays here, the booking lands in Bookings and the calendar as a Direct booking, and the invoice is sent automatically. Prototype: no booking is created from the preview.</div>',
        actions: [{ label: 'Close', kind: 'ghost' }, { label: 'Open Bookings', kind: 'primary', onClick: function () { O.go('bookings'); } }] });
    }
  }
  function publish(ctx) {
    if (!canEdit()) return;
    var S = site(), t = TPL_BY[S.template], ws = O.ws();
    var checks = [
      [seoTitle().length <= 60, 'Page title is ' + seoTitle().length + ' characters' + (seoTitle().length <= 60 ? '' : ' (Google shows about 60)')],
      [seoDesc().length <= 160, 'Meta description is ' + seoDesc().length + ' characters' + (seoDesc().length <= 160 ? '' : ' (keep it under 160)')],
      [S.featured.length >= 3, S.featured.length + ' featured propert' + (S.featured.length === 1 ? 'y' : 'ies') + (S.featured.length >= 3 ? '' : ' (3 or more looks best)')],
      [true, D.properties.length + ' property pages with live availability'],
      [!!waNumber(), 'WhatsApp button goes to ' + waNumber()]
    ];
    U.modal({ title: 'Publish website', sub: 'https://' + ws.domain,
      body: '<div class="stack"><div class="row-flex"><b>' + esc(t.name) + '</b>' + U.pill(t.style, 'neutral') + '<span class="xs muted">' + (S.published ? (S.published.template === t.id ? 'updates the live site' : 'replaces ' + esc(TPL_BY[S.published.template].name)) + ', last published ' + esc(fmt.dateTime(S.published.at)) : 'first publish') + '</span></div>' +
        '<ul class="wb-checks">' + checks.map(function (c) { return '<li class="' + (c[0] ? 'ok' : 'warn') + '">' + (c[0] ? '✓' : '!') + ' ' + esc(c[1]) + '</li>'; }).join('') + '</ul><div class="xs muted">Pages: Home, ' + D.properties.length + ' property pages, About & contact. Colours and logo follow Brand & Setup.</div><div class="note">Prototype: publishing is simulated and no site goes live.</div></div>',
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Publish now', kind: 'primary', onClick: function () {
        S.published = { template: t.id, at: D.NOW, by: O.state.viewer }; S.changed = false;
        S.log.unshift({ template: t.id, at: D.NOW, by: O.state.viewer, what: 'Published' });
        U.toast('Published ' + t.name + ' to https://' + ws.domain, 'ok');
        O.emit('data', { type: 'website-published' });
      } }] });
  }

  O.page('website', { desc: '12 landing page layouts plus property and about pages, styled by your logo and colours', render: render });
})();
