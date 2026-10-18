/* ===================================================================
   Orbique Command Center v4 — core runtime
   O.esc / O.fmt / O.on / O.emit / O.state / O.theme / O.page / O.go / O.uid
   O.ui (modal, drawer, toast, dateRange, kpis, pills, badges, avatar)
   O.chart (line, bars, spark, hbars) · O.download / O.csv / O.pdf
   O.booking.open · O.invoice · O.lock · O.checklist
   O.clock (real Malaysia time) · O.sync (saved data) · O.PERMS / O.can (staff access)
   O.automation (background jobs) · O.voice (read aloud) · O.guestApi (guest app data)
   Loaded after data.js and before every pages/*.js file.
   =================================================================== */
(function () {
  var O = (window.O = window.O || {});
  var D = O.data, d = O.d;

  /* ---------------- tiny helpers ---------------- */
  O.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  O.$ = function (sel, root) { return (root || document).querySelector(sel); };
  O.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  /* unique id for a new record, safe when several people add records at once: O.uid('BK') -> 'BK-LX4K2Q9A' */
  O.uid = function (prefix) {
    var r = ''; try { var a = new Uint8Array(4); crypto.getRandomValues(a); r = Array.prototype.map.call(a, function (x) { return (x % 36).toString(36); }).join(''); } catch (e) { r = Math.random().toString(36).slice(2, 6); }
    return (prefix ? prefix + '-' : '') + (Date.now().toString(36) + r).toUpperCase();
  };
  /* an unguessable token (128 random bits, URL-safe) for links that work without signing in, such as the guest app */
  O.newToken = function (prefix) {
    var a = new Uint8Array(16);
    try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256); }
    var b = ''; for (var j = 0; j < a.length; j++) b += String.fromCharCode(a[j]);
    return (prefix || '') + btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  O.html = function (str) { var t = document.createElement('template'); t.innerHTML = String(str).trim(); return t.content.firstElementChild; };
  O.store = {
    get: function (k, dflt) { try { var v = localStorage.getItem('orbique4:' + k); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; } },
    set: function (k, v) { try { localStorage.setItem('orbique4:' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };
  var CSS_DONE = {};
  O.css = function (id, text) { /* pages inject their own CSS once */
    if (CSS_DONE[id]) return; CSS_DONE[id] = 1;
    var s = document.createElement('style'); s.setAttribute('data-css', id); s.textContent = text; document.head.appendChild(s);
  };

  /* ---------------- formatting ---------------- */
  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  /* ---------------- currency ----------------
     Each building has a currency (building.currency, MYR when not set); its units, bookings, prices, expenses and
     invoices are in it. Money for one thing: O.fmt.money(n, {cur: thing}) where thing is a booking, unit, unit type,
     building, any record with propertyId / unitTypeId / buildingId, an id, or a code. Without cur, money is in the
     view currency: O.viewCur() (the workspace's only currency, else the one picked in O.curSwitchHTML on totals pages).
     Totals never add two currencies: totals pages keep only O.inCur(x) rows. */
  var CUR_SYMBOL = { MYR: 'RM', USD: 'US$', SGD: 'S$', THB: '฿', IDR: 'Rp', PHP: '₱', VND: '₫', EUR: '€', GBP: '£', AUD: 'A$', JPY: '¥', CNY: 'CN¥', HKD: 'HK$', INR: '₹', KRW: '₩', TWD: 'NT$', NZD: 'NZ$' };
  O.curSymbol = function (code) { code = String(code || 'MYR').toUpperCase(); return CUR_SYMBOL[code] || code; };
  function bdCur(bd) { return bd && bd.currency ? String(bd.currency).trim().toUpperCase() || 'MYR' : 'MYR'; }
  O.curOf = function (x) {
    if (x == null || x === '') return O.viewCur();
    if (typeof x === 'string' && /^[A-Za-z]{3}$/.test(x) && !D.propById[x] && !O.building(x) && !O.unitType(x)) return x.toUpperCase();
    var pl = O.placeOf(x);
    if (!pl) return O.baseCur();
    return isBuilding(pl) || pl.currency ? bdCur(pl) : O.baseCur();
  };
  /* the currencies in use (buildings with units), most used first; MYR when there are none */
  O.currencies = function () {
    var n = {};
    (D.buildings || []).forEach(function (bd) { if (!bd.archived) { var c = bdCur(bd); n[c] = (n[c] || 0) + 1; } });
    (D.properties || []).forEach(function (p) { if (p && !p.archived && !p.buildingId && p.currency) { var c = bdCur(p); n[c] = (n[c] || 0) + 1; } });
    var list = Object.keys(n).sort(function (a, b) { return n[b] - n[a] || (a === 'MYR' ? -1 : b === 'MYR' ? 1 : a.localeCompare(b)); });
    return list.length ? list : ['MYR'];
  };
  O.baseCur = function () { return O.currencies()[0]; };
  O.multiCur = function () { return O.currencies().length > 1; };
  O.viewCur = function () { var list = O.currencies(), c = O.store.get('viewCur', ''); return list.indexOf(c) >= 0 ? c : list[0]; };
  O.setViewCur = function (c) { O.store.set('viewCur', String(c || '').toUpperCase()); O.render(); };
  /* true when x (booking, unit, expense, invoice, ...) is in the view currency; always true with one currency */
  O.inCur = function (x) { return O.inView(x) && (!O.multiCur() || O.curOf(x) === O.viewCur()); };
  /* the currency picker for totals pages; empty with one currency. Wire it with O.curSwitchWire(root). */
  O.curSwitchHTML = function () {
    if (!O.multiCur()) return '';
    var v = O.viewCur();
    return '<label class="cur-switch" title="Totals are shown per currency"><span class="small muted">Currency</span><select class="select select-sm" data-cur-switch>' +
      O.currencies().map(function (c) { return '<option value="' + c + '"' + (c === v ? ' selected' : '') + '>' + O.esc(c === 'MYR' ? 'RM (MYR)' : O.curSymbol(c) === c ? c : O.curSymbol(c) + ' (' + c + ')') + '</option>'; }).join('') + '</select></label>';
  };
  O.curSwitchWire = function (root) { (root ? root.querySelectorAll('[data-cur-switch]') : []).forEach(function (s) { s.onchange = function () { O.setViewCur(s.value); }; }); };
  /* Malaysia's tourism tax applies to buildings in Malaysia (building.country MY, or MYR when no country is set) */
  O.buildingOf = function (x) {
    if (!x) return null; if (typeof x === 'string') x = D.propById[x] || O.building(x) || O.unitType(x); if (!x) return null;
    if ((O.raw('buildings') || []).indexOf(x) >= 0) return x;
    var t = x.unitTypeId ? O.unitType(x.unitTypeId) : null, bid = x.buildingId || (t && t.buildingId);
    if (!bid && x.propertyId && D.propById[x.propertyId]) return O.buildingOf(D.propById[x.propertyId]);
    return bid ? O.building(bid) : null;
  };
  /* where x is: its building, or the unit itself when it is not in a building (such a unit can carry its own country and currency) */
  function isBuilding(x) { return (O.raw('buildings') || []).indexOf(x) >= 0; }
  function unitOf(x) {
    if (!x) return null; if (typeof x === 'string') x = D.propById[x] || null; if (!x) return null;
    if (x.id && D.propById[x.id] === x) return x;
    if (x.propertyId && D.propById[x.propertyId]) return D.propById[x.propertyId];
    if (x.bookingId && D.booking) { var b = D.booking(x.bookingId); if (b && b.propertyId) return D.propById[b.propertyId] || null; }
    return null;
  }
  O.placeOf = function (x) { return O.buildingOf(x) || unitOf(x); };
  O.tourismTaxApplies = function (x) { var pl = O.placeOf(x); if (pl && pl.country) return String(pl.country).toUpperCase() === 'MY'; return O.curOf(x) === 'MYR'; };

  O.fmt = {
    money: function (n, opt) {
      opt = opt || {}; if (n == null || isNaN(n)) return '–';
      var dp = opt.dp != null ? opt.dp : 0, neg = n < 0, a = Math.abs(n);
      var s = dp ? a.toFixed(dp).replace(/^(\d+)/, function (m) { return group(m); }) : group(Math.round(a));
      return (neg ? '−' : '') + (opt.bare ? '' : O.curSymbol(O.curOf(opt.cur)) + ' ') + s;
    },
    moneyShort: function (n, cur) {
      if (n == null || isNaN(n)) return '–';
      var a = Math.abs(n), s = a >= 1e6 ? (a / 1e6).toFixed(1) + 'm' : a >= 1e4 ? (a % 100 === 0 && a % 1000 !== 0 && a < 1e5 ? (a / 1e3).toFixed(1) : Math.round(a / 1e3)) + 'k' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'k' : String(Math.round(a));
      return (n < 0 ? '−' : '') + O.curSymbol(O.curOf(cur)) + ' ' + s.replace('.0k', 'k').replace('.0m', 'm');
    },
    /* the symbol for labels such as "Nightly price (RM)" */
    cur: function (x) { return O.curSymbol(O.curOf(x)); },
    num: function (n, dp) { if (n == null || isNaN(n)) return '–'; return dp ? n.toFixed(dp) : group(Math.round(n)); },
    pct: function (x, dp) { if (x == null || isNaN(x)) return '–'; return (x * 100).toFixed(dp == null ? 0 : dp) + '%'; },
    /* signed change between a and b, e.g. +8.6% */
    change: function (cur, prev, dp) { if (!prev) return null; var c = (cur - prev) / Math.abs(prev); return c; },
    changeText: function (c, dp) { if (c == null || isNaN(c)) return '–'; var v = (c * 100).toFixed(dp == null ? 1 : dp); return (c > 0 ? '+' : c < 0 ? '−' : '±') + v.replace('-', '') + '%'; },
    time: function (t) { /* 'HH:MM' or ISO datetime -> '3:00 PM' */
      if (!t) return ''; var hm = t.length > 5 ? t.slice(11, 16) : t; var h = +hm.slice(0, 2), m = hm.slice(3, 5);
      return ((h % 12) || 12) + ':' + m + ' ' + (h < 12 ? 'AM' : 'PM');
    },
    dateTime: function (iso) { return d.fmt(iso.slice(0, 10)) + ', ' + O.fmt.time(iso); },
    ago: function (iso) { /* relative to NOW */
      var now = Date.parse(D.NOW + ':00Z'), t = Date.parse((iso.length === 10 ? iso + 'T00:00' : iso) + ':00Z');
      var m = Math.round((now - t) / 6e4);
      if (m < 1) return 'just now'; if (m < 60) return m + 'm ago'; var h = Math.round(m / 60); if (h < 24) return h + 'h ago';
      var dd = Math.round(h / 24); return dd === 1 ? 'yesterday' : dd + 'd ago';
    },
    plural: function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); },
    initials: function (name) { return String(name).replace(/^The /, '').split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); }
  };

  /* ---------------- events & state ---------------- */
  var handlers = {};
  O.on = function (evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); return function () { handlers[evt] = (handlers[evt] || []).filter(function (f) { return f !== fn; }); }; };
  O.emit = function (evt, payload) { (handlers[evt] || []).slice().forEach(function (fn) { try { fn(payload); } catch (e) { console.error(e); } }); };

  O.state = { workspace: 'orbique', viewer: 's1', lang: 'en', page: 'dashboard' };
  O.viewer = function () { return D.staffById(O.state.viewer); };
  O.isOwner = function () { var v = O.viewer(); return !!v && v.role === 'owner'; };

  /* ===================================================================
     COLOUR + BRAND ENGINE
     =================================================================== */
  var C = O.color = {};
  C.hexToRgb = function (hex) { hex = hex.replace('#', ''); if (hex.length === 3) hex = hex.replace(/./g, '$&$&'); var n = parseInt(hex, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  C.rgbToHex = function (r) { return '#' + r.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join('').toUpperCase(); };
  C.rgbToHsl = function (rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) { var dd = mx - mn; s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn); h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; h *= 60; }
    return [h, s, l];
  };
  C.hslToRgb = function (hsl) {
    var h = ((hsl[0] % 360) + 360) % 360 / 360, s = hsl[1], l = hsl[2];
    function f(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }
    if (s === 0) return [l * 255, l * 255, l * 255];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
  };
  C.lum = function (hex) { /* WCAG relative luminance */
    return C.hexToRgb(hex).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
      .reduce(function (s, v, i) { return s + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
  };
  C.contrast = function (a, b) { var x = C.lum(a), y = C.lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  C.mix = function (a, b, t) { /* t = share of b */ var x = C.hexToRgb(a), y = C.hexToRgb(b); return C.rgbToHex([0, 1, 2].map(function (i) { return x[i] + (y[i] - x[i]) * t; })); };
  C.WHITE = '#FFFFFF'; C.BLACK = '#14181F';
  /* THE TEXT RULE: white text on dark fills, near-black text on light fills — whichever reads better */
  C.ink = function (bg) { return C.contrast(bg, C.WHITE) >= C.contrast(bg, C.BLACK) ? C.WHITE : C.BLACK; };
  C.isDark = function (bg) { return C.ink(bg) === C.WHITE; };
  C.setL = function (hex, l) { var h = C.rgbToHsl(C.hexToRgb(hex)); return C.rgbToHex(C.hslToRgb([h[0], h[1], Math.max(0, Math.min(1, l))])); };
  /* move a colour's lightness until it reaches `ratio` contrast against `bg` */
  C.ensure = function (fg, bg, ratio) {
    if (C.contrast(fg, bg) >= ratio) return fg;
    var hsl = C.rgbToHsl(C.hexToRgb(fg)), darker = C.lum(bg) > 0.4, l = hsl[2];
    for (var i = 0; i < 60; i++) {
      l += darker ? -0.02 : 0.02; if (l < 0 || l > 1) break;
      var c = C.rgbToHex(C.hslToRgb([hsl[0], hsl[1], l]));
      if (C.contrast(c, bg) >= ratio) return c;
    }
    return darker ? C.BLACK : C.WHITE;
  };
  C.oklab = function (hex) {
    var c = C.hexToRgb(hex).map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    var l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
    var m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
    var s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  C.dist = function (a, b) { var x = C.oklab(a), y = C.oklab(b); return Math.sqrt(Math.pow(x[0] - y[0], 2) + Math.pow(x[1] - y[1], 2) + Math.pow(x[2] - y[2], 2)); };
  C.chroma = function (hex) { var x = C.oklab(hex); return Math.sqrt(x[1] * x[1] + x[2] * x[2]); };
  C.alpha = function (hex, a) { var r = C.hexToRgb(hex); return 'rgba(' + r.join(',') + ',' + a + ')'; };

  /* ---------- logos ---------- */
  var KEY_PATH = 'M74,0 A74,74 0 1 1 -74,0 A74,74 0 1 1 74,0M74,0 H296M144,0 V58 A26,26 0 0 0 170,84M214,0 V58 A26,26 0 0 0 240,84M364,0 A34,34 0 1 1 296,0 A34,34 0 1 1 364,0';
  var LOGOS = {
    orbique: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="240" height="240"><circle cx="60" cy="60" r="56" fill="#20395A"/><path d="M60 4 A56 56 0 0 1 116 60 L60 60 Z" fill="#C9A227"/><path d="M116 60 A56 56 0 0 1 32 108.5 L60 60 Z" fill="#0B5D54"/><circle cx="60" cy="60" r="22" fill="#FFFFFF"/></svg>',
    otto: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="240" height="240"><rect width="512" height="512" rx="112" fill="#A97C2F"/><g transform="translate(256,256) rotate(-45) scale(0.8912) translate(-145,0)"><path d="' + KEY_PATH + '" fill="none" stroke="#F4EFE6" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/></g></svg>',
    /* sample logos for trying the brand engine (fictional businesses) */
    coral: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="240" height="240"><circle cx="60" cy="60" r="54" fill="#E8604C"/><path d="M22 74 Q40 58 60 74 T98 74 V96 H22 Z" fill="#1F6F78"/><circle cx="78" cy="42" r="12" fill="#FFD6A5"/></svg>',
    hijau: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="240" height="240"><rect x="8" y="8" width="104" height="104" rx="26" fill="#2E7D32"/><path d="M60 24 L96 56 H84 V94 H36 V56 H24 Z" fill="#F9D949"/><rect x="52" y="70" width="16" height="24" fill="#2E7D32"/></svg>',
    midnight: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="240" height="240"><rect width="120" height="120" rx="60" fill="#2D1B69"/><path d="M78 30 A34 34 0 1 0 90 82 A26 26 0 1 1 78 30 Z" fill="#F472B6"/><circle cx="40" cy="38" r="4" fill="#F472B6"/></svg>',
    lemon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="240" height="240"><rect x="6" y="6" width="108" height="108" rx="18" fill="#FFE14D"/><path d="M30 80 L60 34 L90 80 Z" fill="#111111"/><rect x="54" y="62" width="12" height="18" fill="#FFE14D"/></svg>'
  };
  O.svgUrl = function (svg) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); };
  O.logos = LOGOS;
  O.KEY_PATH = KEY_PATH;

  /* ---------- workspaces (each one has its own logo and brand) ---------- */
  O.workspaces = {
    orbique: {
      id: 'orbique', name: 'Orbique', sub: 'Platform owner', legal: 'Orbique Global Sdn. Bhd.', regNo: '202301045512 (1523344-K)',
      address: 'Level 12, Menara Orbique, Jalan Ampang, 50450 Kuala Lumpur', email: 'stays@orbique.site', phone: '+60 3-2785 1100', domain: 'stay.orbique.site', plan: null,
      logo: O.svgUrl(LOGOS.orbique), logoName: 'orbique-mark.svg',
      brand: { primary: '#0B5D54', accent: '#C9A227', dark: '#20395A', sideStyle: 'deep', source: 'logo' }
    },
    otto: {
      id: 'otto', name: 'Otto', sub: 'Subscriber', legal: 'Otto', regNo: 'Add your registration number in Brand & Setup',
      address: 'Kuala Lumpur, Malaysia', email: 'hello@otto.orbique.site', phone: '+60 12-338 4410', domain: 'otto.orbique.site', plan: 'Subscriber plan',
      logo: O.svgUrl(LOGOS.otto), logoName: 'otto-icon-brass.svg',
      brand: { primary: '#A97C2F', accent: '#F4EFE6', dark: null, sideStyle: 'deep', source: 'logo' }
    }
  };
  O.ws = function () { return O.workspaces[O.state.workspace]; };

  /* ---------- palette extraction from an uploaded logo ---------- */
  function loadImage(src) {
    return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = src; });
  }
  function svgColours(text) { /* fallback when the canvas can't be read: count colours named in the SVG */
    var counts = {}, re = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi, m;
    while ((m = re.exec(text))) { var h = C.rgbToHex(C.hexToRgb(m[1])); counts[h] = (counts[h] || 0) + 1; }
    return Object.keys(counts).map(function (h) { return { hex: h, count: counts[h] }; });
  }
  O.theme = {};
  /* returns {swatches:[{hex, share, chroma, l}], primary, accent, dark} */
  O.theme.extract = function (src) {
    return loadImage(src).then(function (im) {
      var N = 96, cv = document.createElement('canvas'); cv.width = N; cv.height = N;
      var cx = cv.getContext('2d'), w = im.naturalWidth || N, h = im.naturalHeight || N, sc = Math.min(N / w, N / h);
      cx.drawImage(im, (N - w * sc) / 2, (N - h * sc) / 2, w * sc, h * sc);
      var px;
      try { px = cx.getImageData(0, 0, N, N).data; } catch (e) { px = null; }
      var buckets = {}, total = 0, edge = {}, edgeN = 0, opaque = true;
      if (px) {
        for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
          var i = (y * N + x) * 4; if (px[i + 3] < 160) { opaque = false; continue; }
          var key = (px[i] >> 3) + ',' + (px[i + 1] >> 3) + ',' + (px[i + 2] >> 3);
          var bk = buckets[key] || (buckets[key] = { r: 0, g: 0, b: 0, n: 0 });
          bk.r += px[i]; bk.g += px[i + 1]; bk.b += px[i + 2]; bk.n++; total++;
          if (x === 0 || y === 0 || x === N - 1 || y === N - 1) { edge[key] = (edge[key] || 0) + 1; edgeN++; }
        }
      }
      var list = Object.keys(buckets).map(function (k) { var b = buckets[k]; return { key: k, hex: C.rgbToHex([b.r / b.n, b.g / b.n, b.b / b.n]), count: b.n }; });
      /* an opaque image (JPG/PNG without transparency): the colour filling the border is the background — drop it */
      if (px && opaque && edgeN) {
        var top = Object.keys(edge).sort(function (a, b) { return edge[b] - edge[a]; })[0];
        if (edge[top] / edgeN > 0.5) { var bg = list.filter(function (s) { return s.key === top; })[0]; if (bg) list = list.filter(function (s) { return C.dist(s.hex, bg.hex) > 0.08; }); }
      }
      if (!px || !list.length) return null;
      return list;
    }).catch(function () { return null; }).then(function (list) {
      if (!list && /^data:image\/svg/.test(src)) list = svgColours(decodeURIComponent(src.split(',')[1] || ''));
      return O.theme.pickPalette(list || []);
    });
  };
  O.theme.pickPalette = function (list) {
    list.sort(function (a, b) { return b.count - a.count; });
    var merged = [];
    list.forEach(function (s) { /* merge near-identical shades (anti-aliasing) */
      var hit = merged.filter(function (m) { return C.dist(m.hex, s.hex) < 0.07; })[0];
      if (hit) hit.count += s.count; else merged.push({ hex: s.hex, count: s.count });
    });
    var total = merged.reduce(function (s, m) { return s + m.count; }, 0) || 1;
    var sw = merged.filter(function (m) { return m.count / total > 0.01; }).slice(0, 8).map(function (m) {
      var lab = C.oklab(m.hex); return { hex: m.hex, share: m.count / total, chroma: C.chroma(m.hex), l: lab[0] };
    });
    var big = sw.filter(function (s) { return s.share >= 0.03; }); /* ignore anti-aliasing in-betweens */
    var score = function (s) { return s.share * (0.6 + s.chroma * 4); };
    var chromatic = big.filter(function (s) { return s.chroma > 0.045 && s.l > 0.25 && s.l < 0.93; }).sort(function (a, b) { return score(b) - score(a); });
    var darks = big.filter(function (s) { return s.l <= 0.42; }).sort(function (a, b) { return a.l - b.l; });
    var lights = big.filter(function (s) { return s.l >= 0.9 && s.l < 0.995; });
    var primary = chromatic[0] || null, dark = null;
    /* a very dark main colour makes heavy buttons: if a lively mid-tone colour also covers a good part of the logo,
       that one becomes the main colour and the dark one shades the sidebar */
    if (primary && primary.l < 0.4) {
      var mid = chromatic.filter(function (s) { return s !== primary && s.l >= 0.4 && s.share >= 0.15; })[0];
      if (mid) { dark = primary.hex; primary = mid; }
    }
    primary = primary ? primary.hex : (darks[0] ? darks[0].hex : '#334155');
    var accent = null;
    chromatic.forEach(function (s) { if (!accent && s.hex !== primary && s.hex !== dark && C.dist(s.hex, primary) > 0.12) accent = s.hex; });
    lights = lights.filter(function (s) { return s.hex !== primary; });
    if (!accent && lights[0]) accent = lights[0].hex;
    if (!accent && darks[0] && darks[0].hex !== primary) accent = darks[0].hex;
    if (!accent) { var hs = C.rgbToHsl(C.hexToRgb(primary)); accent = C.rgbToHex(C.hslToRgb([hs[0] + 35, Math.min(0.75, hs[1] + 0.1), 0.62])); }
    if (!dark) darks.forEach(function (s) { if (!dark && s.hex !== primary) dark = s.hex; });
    return { swatches: sw, primary: primary, accent: accent, dark: dark };
  };

  /* ---------- turning a palette into UI tokens ---------- */
  O.theme.tokens = function (brand) {
    var P = brand.primary, A = brand.accent, W = C.WHITE;
    var t = {};
    t['--brand'] = P;
    t['--brand-ink'] = C.ink(P);
    t['--brand-hover'] = C.isDark(P) ? C.mix(P, '#000000', 0.14) : C.mix(P, '#000000', 0.08);
    t['--brand-strong'] = C.ensure(P, W, 3);         /* charts, icons, focus rings: 3:1 on white */
    t['--brand-text'] = C.ensure(P, W, 4.6);         /* brand-coloured text and links: 4.5:1 on white */
    t['--brand-soft'] = C.mix(P, W, 0.88);
    t['--brand-soft-2'] = C.mix(P, W, 0.94);
    if (C.contrast(t['--brand-text'], t['--brand-soft']) < 4.5) t['--brand-text'] = C.ensure(P, t['--brand-soft'], 4.6);
    t['--accent'] = A;
    t['--accent-ink'] = C.ink(A);
    t['--accent-text'] = C.ensure(A, W, 4.6);
    t['--accent-soft'] = C.mix(A, W, C.lum(A) > 0.7 ? 0.35 : 0.84);
    /* sidebar */
    var style = brand.sideStyle || 'deep', side;
    if (style === 'light') side = '#FFFFFF';
    else if (style === 'brand') side = P;
    else {
      var base = brand.dark || P, hsl = C.rgbToHsl(C.hexToRgb(base));
      side = C.rgbToHex(C.hslToRgb([hsl[0], Math.min(hsl[1], 0.5), Math.min(hsl[2], 0.17)]));
    }
    var sInk = C.ink(side);
    t['--side-bg'] = side;
    t['--side-ink'] = sInk;
    t['--side-muted'] = C.mix(sInk, side, 0.42);
    t['--side-hover'] = C.alpha(sInk, 0.08);
    t['--side-border'] = C.alpha(sInk, style === 'light' ? 0.12 : 0.12);
    var active = P;
    if (C.contrast(P, side) < 1.6) active = C.contrast(A, side) >= 1.6 ? A : C.mix(side, sInk, 0.2);
    if (style === 'light') active = t['--brand-soft'];
    var badge = C.contrast(A, side) >= 1.6 ? A : P;
    if (C.contrast(badge, side) < 1.6) badge = sInk;
    t['--side-badge'] = badge; t['--side-badge-ink'] = C.ink(badge);
    t['--side-active'] = active;
    t['--side-active-ink'] = style === 'light' ? t['--brand-text'] : C.ink(active);
    return t;
  };
  /* which parts of the UI follow the brand (shown on Brand & Setup) */
  O.theme.MAP = {
    changes: [
      ['Sidebar background', '--side-bg', 'A deep shade of your logo\'s dark or main colour (or light / full-colour, your choice)'],
      ['Active menu item', '--side-active', 'Your main colour'],
      ['Primary buttons', '--brand', 'Your main colour'],
      ['Selected tabs, chips and toggles', '--brand', 'Your main colour'],
      ['Links and highlighted text', '--brand-text', 'Your main colour, darkened until it is readable on white'],
      ['Chart line or bar for the current period', '--brand-strong', 'Your main colour (comparison periods stay grey)'],
      ['Soft highlight backgrounds', '--brand-soft', 'A pale tint of your main colour'],
      ['Badges and counters', '--accent', 'Your second colour'],
      ['Invoice and receipt header', '--brand', 'Your main colour and logo'],
      ['Website templates', '--brand', 'Main colour, second colour and logo'],
      ['Guest app header and buttons', '--brand', 'Main colour, second colour and logo'],
      ['"Direct" booking badge', '--brand', 'Your main colour (direct bookings are your brand)']
    ],
    fixed: [
      ['Text colour rule', 'White on dark backgrounds, near-black on light backgrounds, chosen automatically by contrast'],
      ['Page background, cards, borders', 'Neutral greys so every brand looks clean'],
      ['Body text and secondary text', 'Near-black and grey'],
      ['Booking status colours', 'Blue confirmed, green in-house, amber pending, grey past, red cancelled'],
      ['Good / warning / problem signals', 'Green, amber, red'],
      ['Platform badges', 'Airbnb, Booking.com, Agoda, Vrbo and Google keep their own colours'],
      ['Comparison periods in charts', 'Two greys, so the current period always stands out']
    ]
  };
  O.theme.current = null;
  O.theme.apply = function (brand) {
    var t = O.theme.tokens(brand), root = document.documentElement;
    Object.keys(t).forEach(function (k) { root.style.setProperty(k, t[k]); });
    O.theme.current = Object.assign({}, brand, { tokens: t });
    O.emit('theme', O.theme.current);
  };
  O.theme.get = function (name) { return (O.theme.current && O.theme.current.tokens[name]) || getComputedStyle(document.documentElement).getPropertyValue(name).trim(); };
  /* logo element sized for a given background (adds a white tile when the logo would disappear) */
  O.theme.logoHTML = function (ws, onBg) {
    ws = ws || O.ws();
    var tile = ws.logoTile;
    if (tile == null) tile = false;
    if (onBg && ws.logoLum != null) tile = C.contrast(ws.logoLum > 0.5 ? '#EEEEEE' : '#222222', onBg) < 2.2;
    return '<span class="ws-logo' + (tile ? ' tile' : '') + '"><img src="' + O.esc(ws.logo) + '" alt="' + O.esc(ws.name) + ' logo"></span>';
  };
  O.theme.measureLogo = function (ws) { /* average lightness of the logo's visible pixels */
    return loadImage(ws.logo).then(function (im) {
      var cv = document.createElement('canvas'); cv.width = 48; cv.height = 48; var cx = cv.getContext('2d');
      cx.drawImage(im, 0, 0, 48, 48);
      var px = cx.getImageData(0, 0, 48, 48).data, s = 0, n = 0;
      for (var i = 0; i < px.length; i += 4) if (px[i + 3] > 160) { s += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255; n++; }
      ws.logoLum = n ? s / n : 0.5;
    }).catch(function () { ws.logoLum = null; });
  };
  O.theme.logoPNG = function (ws, size) { /* PNG data URL for jsPDF */
    ws = ws || O.ws(); size = size || 160;
    return loadImage(ws.logo).then(function (im) {
      var cv = document.createElement('canvas'); cv.width = size; cv.height = size; var cx = cv.getContext('2d');
      var w = im.naturalWidth || size, h = im.naturalHeight || size, sc = Math.min(size / w, size / h);
      cx.drawImage(im, (size - w * sc) / 2, (size - h * sc) / 2, w * sc, h * sc);
      return cv.toDataURL('image/png');
    }).catch(function () { return null; });
  };

  /* ===================================================================
     ICONS
     =================================================================== */
  var IC = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    bookings: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v4M16 3v4"/>',
    star: '<path d="M12 17.3 6.2 20l1.1-6.4L2.5 9l6.5-.9L12 2.2l3 5.9 6.5.9-4.8 4.6 1.1 6.4z"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-1 4 8.5 8.5 0 0 1-7.5 4.5 8.4 8.4 0 0 1-4-1L3 20l1-5.5a8.4 8.4 0 0 1-1-4A8.5 8.5 0 0 1 11.5 2a8.5 8.5 0 0 1 9.5 9.5z"/>',
    tasks: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    pricing: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    automations: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    invoices: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    expenses: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
    financials: '<path d="M3 21h18M5 21V10M19 21V10M9 21v-7M15 21v-7M12 3 3 8h18z"/>',
    reports: '<path d="M4 19V5M4 19h16M8 16v-4m4 4V8m4 8v-6"/>',
    statistics: '<path d="M21 12a9 9 0 1 1-9-9v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
    properties: '<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5M9 10h.01M15 10h.01M9 13.5h.01M15 13.5h.01"/>',
    inventory: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    channels: '<circle cx="12" cy="12" r="2.5"/><circle cx="4.5" cy="5.5" r="2"/><circle cx="19.5" cy="5.5" r="2"/><circle cx="4.5" cy="18.5" r="2"/><circle cx="19.5" cy="18.5" r="2"/><path d="M6 7l4.2 3.4M18 7l-4.2 3.4M6 17l4.2-3.4M18 17l-4.2-3.4"/>',
    platform: '<rect x="3" y="3" width="18" height="7" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/><path d="M7 6.5h.01M7 17.5h.01"/>',
    speaker: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    website: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
    guestapp: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    owner: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    staff: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    brand: '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2z"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M17 6l3 3M14 9l2 2"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
    lang: '<path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
    clip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8"/>',
    send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>', down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
    whatsapp: '<path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3z"/><path d="M9 9.5c.5 2 2.5 4 4.5 4.5l1.2-1.2 2 1-.4 1.6c-3.5.4-8-4-7.6-7.6L10.3 7l1 2z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    car: '<path d="M5 17h14M5 17a2 2 0 1 1-4 0v-5l2-5h12l4 5v5a2 2 0 1 1-4 0"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
    sim: '<path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><rect x="8" y="11" width="8" height="7" rx="1"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    rules: '<path d="M9 11l3 3L22 4"/><path d="M4 6h3M4 12h3M4 18h10"/>',
    video: '<rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3z"/>',
    map: '<path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4z"/><path d="M8 2v16M16 6v16"/>',
    wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 20h.01"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>'
  };
  IC.reviews = IC.star; IC.inbox = IC.chat;
  O.icon = function (name, cls) {
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[name] || IC.more) + '</svg>';
  };

  /* ===================================================================
     UI COMPONENTS
     =================================================================== */
  var U = O.ui = {};
  var AV_COLORS = ['#3B5B8C', '#2F7D6D', '#8A5A2B', '#6D4C9F', '#A0414E', '#3F7F3F', '#55606E', '#1F6A8A', '#8C3E7A', '#7A6A2A'];
  U.avatar = function (name, size) {
    var c = AV_COLORS[D.hash(String(name)) % AV_COLORS.length];
    return '<span class="avatar ' + (size || '') + '" style="background:' + c + '" aria-hidden="true">' + O.esc(O.fmt.initials(name)) + '</span>';
  };
  /* platform badge: monogram marks in each platform's colour (stand-ins until official assets are added) */
  var PLAT_MARK = { airbnb: 'a', booking: 'B', agoda: 'ag', vrbo: 'V', google: 'G', expedia: 'E', trip: 'T', other: '•' };
  U.platIcon = function (id, title, size) { /* size: optional pixel size, e.g. 14 inside chips and calendar bars */
    var name = (D.channels[id] && D.channels[id].name) || (id === 'google' ? 'Google' : id);
    var inner = id === 'direct' ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 2 11h3v9h5v-6h4v6h5v-9h3z"/></svg>'
      : id === 'agoda' ? '<span style="display:flex;gap:1px"><i style="width:3px;height:3px;border-radius:50%;background:#E4252B;display:block"></i><i style="width:3px;height:3px;border-radius:50%;background:#F7A600;display:block"></i><i style="width:3px;height:3px;border-radius:50%;background:#2BA84A;display:block"></i><i style="width:3px;height:3px;border-radius:50%;background:#2167C9;display:block"></i></span>'
        : (PLAT_MARK[id] || '?');
    var sz = size ? ' style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.max(7, Math.round(size * 0.45)) + 'px"' : '';
    return '<span class="plat-ic ' + id + '"' + sz + ' title="' + O.esc(title || name) + '" aria-label="' + O.esc(name) + '">' + inner + '</span>';
  };
  U.plat = function (id, opts) {
    opts = opts || {};
    var name = (D.channels[id] && D.channels[id].name) || (id === 'google' ? 'Google' : id);
    return '<span class="plat">' + U.platIcon(id) + (opts.icon ? '' : O.esc(name)) + '</span>';
  };
  /* D.channelOrder without the platforms only the channel manager brings (Expedia, Trip.com, other) until a booking uses them */
  U.channelsInUse = function () {
    var later = { expedia: 1, trip: 1, other: 1 };
    return D.channelOrder.filter(function (c) { return !later[c] || D.bookings.some(function (b) { return b.channel === c; }); });
  };
  U.platName = function (id) { return (D.channels[id] && D.channels[id].name) || (id === 'google' ? 'Google' : id); };
  var ST_LABEL = { confirmed: 'Confirmed', checked_in: 'In-house', pending: 'Pending', checked_out: 'Checked out', cancelled: 'Cancelled', block: 'Blocked' };
  U.statusLabel = function (s) { return ST_LABEL[s] || s; };
  U.status = function (s) { return '<span class="st ' + s + '"><i></i>' + (ST_LABEL[s] || s) + '</span>'; };
  U.pill = function (text, kind) { return '<span class="pill ' + (kind || 'neutral') + '">' + O.esc(text) + '</span>'; };
  U.stars = function (n) { var s = ''; for (var i = 1; i <= 5; i++) s += i <= n ? '★' : '<span class="off">★</span>'; return '<span class="stars" aria-label="' + n + ' stars">' + s + '</span>'; };
  U.delta = function (c, opts) { /* c = fractional change; opts.invert = lower is better */
    opts = opts || {}; if (c == null || isNaN(c)) return '<span class="delta flat">–</span>';
    var good = opts.invert ? c < 0 : c > 0, flat = Math.abs(c) < 0.0005;
    if (flat) return '<span class="delta flat">' + (0).toFixed(opts.dp == null ? 1 : opts.dp) + '%' + (opts.suffix ? ' ' + O.esc(opts.suffix) : '') + '</span>';
    return '<span class="delta ' + (flat ? 'flat' : good ? 'good' : 'bad') + '">' + (c > 0 ? '▲ ' : c < 0 ? '▼ ' : '') + O.fmt.changeText(c, opts.dp).replace(/^[+−]/, '') + (opts.suffix ? ' ' + O.esc(opts.suffix) : '') + '</span>';
  };
  /* U.empty(message, icon, actionHTML) — actionHTML is an optional button the page wires up */
  U.empty = function (msg, icon, action) { return '<div class="empty"><div class="e-icon">' + (icon || '∅') + '</div>' + O.esc(msg) + (action ? '<div>' + action + '</div>' : '') + '</div>'; };
  /* guest contact details for people without bookings.contacts: +60 ••• ••10, s•••@mail.com */
  O.maskPhone = function (ph) { ph = String(ph || ''); if (!ph) return ''; var digits = ph.replace(/\D/g, ''); return (ph.charAt(0) === '+' ? '+' + digits.slice(0, 2) + ' ' : '') + '••• ••' + digits.slice(-2); };
  O.maskEmail = function (em) { em = String(em || ''); var i = em.indexOf('@'); return i < 1 ? (em ? '•••' : '') : em.charAt(0) + '•••' + em.slice(i); };
  O.contact = function (b) { var g = (b && b.guest) || {}, ok = O.can('bookings.contacts'); return { phone: ok ? g.phone || '' : O.maskPhone(g.phone), email: ok ? g.email || '' : O.maskEmail(g.email), masked: !ok }; };
  /* U.locked('Financials') → "Only account owners can see the financials". opts.reason 'permission' = blocked by Staff Access, not ownership */
  U.locked = function (what, opts) {
    opts = opts || {};
    var w = String(what || 'this'); if (!/[A-Z]/.test(w.slice(1))) w = w.charAt(0).toLowerCase() + w.slice(1);
    if (!/^(the|this|these|your|all) /i.test(w) && w !== 'this') w = 'the ' + w;
    var v = O.viewer();
    var head = opts.reason === 'permission' ? 'Your access does not include ' + w : 'Only account owners can see ' + w;
    var tail = opts.reason === 'permission' ? 'You are viewing as ' + v.name + ' (' + v.roleLabel + '). An account owner can change this in Staff Access.' : 'You are viewing as ' + v.name + ' (' + v.roleLabel + '). Switch the viewer at the bottom of the menu to see the owner view.';
    return '<div class="locked"><div class="lk">🔒</div><b>' + O.esc(head) + '</b><div class="small">' + O.esc(tail) + '</div></div>';
  };
  /* compact KPI strip — every card stays on one line on desktop */
  U.kpis = function (items) {
    return '<div class="kpis">' + items.map(function (k) {
      return '<div class="kpi' + (k.hl ? ' hl' : '') + '"' + (k.title ? ' title="' + O.esc(k.title) + '"' : '') + '><div class="k-label">' + O.esc(k.label) + '</div><div class="k-val">' + k.value + '</div>' +
        (k.sub != null || k.delta != null ? '<div class="k-sub">' + (k.delta != null ? U.delta(k.delta, k.deltaOpts) + ' ' : '') + (k.sub || '') + '</div>' : '') +
        (k.spark ? '<div class="k-spark">' + O.chart.spark(k.spark, { h: 22 }) + '</div>' : '') + '</div>';
    }).join('') + '</div>';
  };
  U.seg = function (options, value, attr) { /* options: [[value,label],...] -> segmented control HTML; handle clicks with data attribute */
    return '<div class="seg" role="tablist">' + options.map(function (o) { return '<button type="button" ' + (attr || 'data-v') + '="' + O.esc(o[0]) + '" class="' + (String(o[0]) === String(value) ? 'on' : '') + '">' + O.esc(o[1]) + '</button>'; }).join('') + '</div>';
  };
  /* properties still in use (archived ones keep their history but leave pickers and new work) */
  O.activeProperties = function () { return D.properties.filter(function (p) { return !p.archived; }); };
  /* "Bayfront Loft 3B · Gurney Drive, Penang" — the label pages use for a property */
  O.propLabel = function (p) { if (typeof p === 'string') p = D.propById[p]; if (!p) return 'Removed property'; var loc = p.area || p.location || p.city || ''; return p.name + (loc ? ' · ' + loc : ''); };
  U.propOptions = function (selected, opts) {
    opts = opts || {};
    return (opts.all ? '<option value="">' + O.esc(opts.all) + '</option>' : '') + D.properties.filter(function (p) { return !p.archived || p.id === selected || opts.archived; }).map(function (p) { return '<option value="' + p.id + '"' + (p.id === selected ? ' selected' : '') + '>' + O.esc(p.name) + '</option>'; }).join('');
  };
  /* ---------------- buildings and unit types ----------------
     D.buildings  {id: 'BD-…', name, address, city, state, zip, country, currency, checkInTime, checkOutTime, archived}
     D.unitTypes  {id: 'UT-…', buildingId, name: 'Deluxe', maxGuests, beds, description, order, archived}
     A unit (property) may carry buildingId, unitTypeId, unitNo ('21-1', only the team sees it) and assignPriority.
     A booking of a typed unit carries unitTypeId (what was sold), propertyId (the unit, null while none is free),
     assignment {how: 'auto'|'manual', by, at, locked} and needsUnit. Untyped units and their bookings work as before. */
  D.buildings = D.buildings || [];
  D.unitTypes = D.unitTypes || [];
  /* ---------------- country view ----------------
     With buildings in more than one country, the top bar picks a country (O.viewCountry(), '' = all countries) and
     D.properties, D.buildings, D.unitTypes, D.bookings, D.blocks, D.tasks, D.reviews, D.expenses and D.conversations
     hold that country only. Pages read and change them as before: push / unshift / splice on a country list change the
     full list too (never assign by index or set .length on them). The full lists: O.raw(key), or run code in
     O.unscoped(fn). Saving, background jobs and the channel manager always see every country.
     A building's country is building.country (else the one its currency is from); units, unit types and records follow
     their building. Records with no unit: expenses and bookings belong to the main country, tasks and chats to every country. */
  var SCOPED = ['properties', 'buildings', 'unitTypes', 'bookings', 'blocks', 'tasks', 'reviews', 'expenses', 'conversations'];
  var EVERYWHERE = { tasks: 1, conversations: 1 };
  var CUR_COUNTRY = { MYR: 'MY', SGD: 'SG', THB: 'TH', IDR: 'ID', PHP: 'PH', VND: 'VN', JPY: 'JP', AUD: 'AU', USD: 'US', GBP: 'UK', CNY: 'CN', HKD: 'HK', INR: 'IN', KRW: 'KR', TWD: 'TW', NZD: 'NZ' };
  var RAW = {}, VIEW = {}, SC = { ver: 0, off: 0, list: null, listVer: -1 };
  O.raw = function (k) { return RAW[k] || D[k]; };
  O.unscoped = function (fn) { SC.off++; try { return fn(); } finally { SC.off--; } };
  O.unscopedFn = function (fn) { return function () { var a = arguments, t = this; return O.unscoped(function () { return fn.apply(t, a); }); }; };
  /* the country of a building or a unit outside buildings (a unit with neither country nor currency follows the main country) */
  O.countryOf = function (pl) {
    if (!pl) return O.mainCountry();
    var c = String(pl.country || '').trim().toUpperCase(); if (c) return c;
    if (!isBuilding(pl) && !pl.currency) return O.mainCountry();
    return CUR_COUNTRY[bdCur(pl)] || 'MY';
  };
  O.countryLabel = function (c) { return (D.countryName && D.countryName[c]) || c; };
  O.defaultCurrencyFor = function (c) { var hit = 'MYR'; Object.keys(CUR_COUNTRY).some(function (k) { if (CUR_COUNTRY[k] === c) { hit = k; return true; } return false; }); return ['FR', 'IT', 'ES', 'IE', 'DE'].indexOf(c) >= 0 ? 'EUR' : hit; };
  /* the countries in use (buildings that are not archived), most buildings first */
  O.countries = function () {
    if (SC.list && SC.listVer === SC.ver) return SC.list;
    var n = {};
    (RAW.buildings || []).forEach(function (bd) { if (!bd.archived) { var c = O.countryOf(bd); n[c] = (n[c] || 0) + 1; } });
    (RAW.properties || []).forEach(function (p) { if (p && !p.archived && !p.buildingId && (p.country || p.currency)) { var c = O.countryOf(p); n[c] = (n[c] || 0) + 1; } });
    var list = Object.keys(n).sort(function (a, b) { return n[b] - n[a] || (a === 'MY' ? -1 : b === 'MY' ? 1 : a.localeCompare(b)); });
    SC.list = list.length ? list : ['MY']; SC.listVer = SC.ver; return SC.list;
  };
  O.mainCountry = function () { return O.countries()[0]; };
  O.multiCountry = function () { return O.countries().length > 1; };
  function countryKey() { return 'viewCountry:' + (O.state && O.state.workspace || ''); }
  O.viewCountry = function () {
    if (SC.off || !O._started || !O.multiCountry()) return '';
    var c = O.store.get(countryKey(), ''); return O.countries().indexOf(c) >= 0 ? c : '';
  };
  /* true when x (unit, booking, record or id) is in the country on screen; always true with all countries */
  O.inView = function (x) { var c = O.viewCountry(); if (!c || x == null || x === '') return true; var pl = O.placeOf(x); return pl ? O.countryOf(pl) === c : c === O.mainCountry(); };
  O.setCountry = function (c) { O.store.set(countryKey(), String(c || '').toUpperCase()); SC.ver++; O.emit('country'); };
  function belongs(k, x, c) {
    if (k === 'buildings') return O.countryOf(x) === c;
    var pl = O.placeOf(x);
    if (!pl && x.bookingId && D.booking) pl = O.placeOf(D.booking(x.bookingId));
    if (pl) return O.countryOf(pl) === c;
    return EVERYWHERE[k] ? true : c === O.mainCountry();
  }
  function scopedView(k) {
    var raw = RAW[k], c = O.viewCountry();
    if (!c || !Array.isArray(raw)) return raw;
    var v = VIEW[k];
    if (v && v._ver === SC.ver && v._c === c && v._n === raw.length) return v;
    v = O.unscoped(function () { return raw.filter(function (x) { return x && belongs(k, x, c); }); });
    var AP = Array.prototype;
    Object.defineProperties(v, {
      _ver: { value: SC.ver }, _c: { value: c }, _n: { value: raw.length, writable: true },
      push: { value: function () { AP.push.apply(raw, arguments); this._n = raw.length; return AP.push.apply(this, arguments); } },
      unshift: { value: function () { AP.unshift.apply(raw, arguments); this._n = raw.length; return AP.unshift.apply(this, arguments); } },
      splice: { value: function (start, del) {
        var len = this.length, add = AP.slice.call(arguments, 2);
        start = start < 0 ? Math.max(0, len + start) : Math.min(start || 0, len);
        del = arguments.length < 2 ? len - start : Math.max(0, Math.min(del, len - start));
        var after = this[start + del];
        for (var i = start; i < start + del; i++) { var j = raw.indexOf(this[i]); if (j >= 0) raw.splice(j, 1); }
        if (add.length) { var at = after ? raw.indexOf(after) : -1; AP.splice.apply(raw, [at >= 0 ? at : raw.length, 0].concat(add)); }
        this._n = raw.length;
        return AP.splice.apply(this, [start, del].concat(add));
      } }
    });
    VIEW[k] = v; return v;
  }
  SCOPED.forEach(function (k) {
    RAW[k] = Array.isArray(D[k]) ? D[k] : [];
    Object.defineProperty(D, k, { configurable: true, enumerable: true, get: function () { return scopedView(k); }, set: function (v) { RAW[k] = v; SC.ver++; } });
  });
  O.on('data', function () { SC.ver++; });
  O.on('remote', function () { SC.ver++; });
  O.building = function (id) { var a = RAW.buildings; if (!id || !a) return null; for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; };
  O.unitType = function (id) { var a = RAW.unitTypes; if (!id || !a) return null; for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; };
  /* the country picker in the top bar; empty with one country */
  O.countrySwitchHTML = function () {
    if (!O.multiCountry()) return '';
    var v = O.viewCountry();
    return '<label class="country-switch" title="Show one country"><select class="select select-sm" id="country-switch" aria-label="Country">' +
      '<option value="">All countries</option>' + O.countries().map(function (c) { return '<option value="' + O.esc(c) + '"' + (c === v ? ' selected' : '') + '>' + O.esc(O.countryLabel(c)) + '</option>'; }).join('') + '</select></label>';
  };
  /* the unit type of a unit (property or id), or null for an untyped unit */
  O.typeOf = function (p) { if (typeof p === 'string') p = D.propById[p]; return p && p.unitTypeId ? O.unitType(p.unitTypeId) : null; };
  O.unitsOfType = function (typeId, withArchived) { return D.properties.filter(function (p) { return p && p.unitTypeId === typeId && (withArchived || !p.archived); }).sort(function (a, b) { return O.assign.naturalCompare(a.unitNo || a.name, b.unitNo || b.name); }); };
  O.typesOf = function (buildingId, withArchived) { return D.unitTypes.filter(function (t) { return t.buildingId === buildingId && (withArchived || !t.archived); }).sort(function (a, b) { return (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name)); }); };
  /* "Seri Saujana Residences · Deluxe": what guests, invoices and the website call a typed unit (never its number) */
  O.typeTitle = function (t) { if (typeof t === 'string') t = O.unitType(t); if (!t) return ''; var bd = O.building(t.buildingId); return (bd && bd.name ? bd.name + ' · ' : '') + t.name; };
  /* guest-facing place for a unit or a booking: {name, area, address}. Typed units show building + type and the building's address. */
  O.guestPlace = function (x) {
    var p = x && x.guest ? D.propById[x.propertyId] : (typeof x === 'string' ? D.propById[x] : x);
    var t = x && x.guest && x.unitTypeId ? O.unitType(x.unitTypeId) : O.typeOf(p);
    if (t) { var bd = O.building(t.buildingId) || {}; return { name: O.typeTitle(t), area: (p && p.area) || bd.city || '', address: bd.address || '', typed: true }; }
    if (!p) return { name: 'the property', area: '', address: '', typed: false };
    return { name: p.name || 'the property', area: p.area || '', address: p.address || '', typed: false };
  };
  /* staff label for where a booking stays: "Saujana 21-1", or "Deluxe, no unit yet" */
  O.bookingPlace = function (b) {
    var p = b && D.propById[b.propertyId];
    if (p) return p.name;
    var t = b && O.unitType(b.unitTypeId);
    return t ? t.name + ', no unit yet' : 'Removed property';
  };
  function unitTxt(id) { var p = D.propById[id]; return p ? (p.unitNo || p.short || p.name) : 'no unit'; }
  function ciTimeFor(b) { var p = D.propById[b.propertyId], t = O.unitType(b.unitTypeId), bd = t && O.building(t.buildingId); return (p && p.checkInTime) || (bd && bd.checkInTime) || '15:00'; }
  function auditMove(b, from, to, how) {
    if (!Array.isArray(D.auditLog)) D.auditLog = [];
    D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: 'bookings', text: (how === 'manual' ? 'Moved ' : 'Assigned ') + b.guest.name + ' (' + b.id + ') ' + (from ? 'from ' + unitTxt(from) + ' ' : '') + 'to ' + (to ? unitTxt(to) : 'no unit (none free for the whole stay)') + (how === 'manual' ? '' : ' automatically') });
  }
  /* run unit assignment (O.assign) for one booking with this workspace's data and write the result on it.
     o = {fresh: ignore the current unit, ignoreLock, dry: only work it out}. Untyped bookings are left as they are. */
  O.assignBooking = function (b, o) {
    o = o || {};
    var res = O.assign.assignUnits({ booking: b, units: D.properties, bookings: D.bookings, blocks: D.blocks || [], now: D.NOW, fresh: o.fresh, ignoreLock: o.ignoreLock, ciTime: b ? ciTimeFor(b) : null });
    if (o.dry) return res;
    var from = (b && b.propertyId) || null;
    if (O.assign.applyResult(b, res, { how: 'auto', by: O.state.viewer, at: D.NOW, force: o.ignoreLock })) auditMove(b, from, res.unitId, 'auto');
    return res;
  };
  /* a person picks the unit: always locks the booking */
  O.pickUnit = function (b, unitId) {
    var from = b.propertyId || null, p = D.propById[unitId]; if (!p) return false;
    b.propertyId = unitId; if (b.needsUnit) delete b.needsUnit;
    if (!b.unitTypeId && p.unitTypeId) b.unitTypeId = p.unitTypeId;
    b.assignment = { how: 'manual', by: O.state.viewer, at: D.NOW, locked: true };
    if (from !== unitId) auditMove(b, from, unitId, 'manual');
    return true;
  };
  /* after blocks, retagging or archiving: move unlocked bookings off units they can no longer use, fill bookings without a unit.
     o = {unitTypeIds}. Returns the moves [{bookingId, from, to}]; the caller emits 'data'. */
  O.reassignUnits = function (o) {
    o = o || {};
    if (!D.unitTypes.length) return [];
    var moves = O.assign.reassignAll({ bookings: D.bookings, units: D.properties, blocks: D.blocks || [], now: D.NOW, from: D.TODAY, unitTypeIds: o.unitTypeIds, by: O.state.viewer, at: D.NOW });
    moves.forEach(function (m) { var b = D.booking(m.bookingId); if (b) auditMove(b, m.from, m.to, 'auto'); });
    return moves;
  };
  /* people still on the team (removed people keep their history but leave pickers) */
  O.activeStaff = function () { return D.staff.filter(function (s) { var m = (D.staffMeta || {})[s.id]; return s.status !== 'left' && !(m && m.removed); }); };
  U.staffOptions = function (selected, opts) {
    opts = opts || {};
    return (opts.none ? '<option value="">' + O.esc(opts.none) + '</option>' : '') + D.staff.filter(function (s) { var m = (D.staffMeta || {})[s.id]; return s.id === selected || opts.all || !(s.status === 'left' || (m && m.removed)); }).map(function (s) { return '<option value="' + s.id + '"' + (s.id === selected ? ' selected' : '') + '>' + O.esc(s.name) + ' · ' + O.esc(s.roleLabel) + '</option>'; }).join('');
  };
  var PROP_COLORS = ['#3B82F6', '#14B8A6', '#F59E0B', '#8B5CF6', '#EC4899', '#10B981', '#F97316', '#6366F1', '#84CC16', '#06B6D4', '#EF4444', '#A855F7'];
  U.propColor = function (pid) { var i = D.properties.map(function (p) { return p.id; }).indexOf(pid); return PROP_COLORS[(i < 0 ? 0 : i) % PROP_COLORS.length]; };

  /* toast */
  U.toast = function (msg, kind) {
    var host = O.$('.toasts') || document.body.appendChild(O.html('<div class="toasts" role="status" aria-live="polite"></div>'));
    var t = O.html('<div class="toast ' + (kind || 'ok') + '"></div>'); t.appendChild(document.createTextNode(msg));
    host.appendChild(t); setTimeout(function () { t.remove(); }, kind === 'bad' ? 5200 : 3400);
  };
  /* copy text to the clipboard with a toast; falls back to a selectable box when the browser blocks it */
  U.copy = function (text, what) {
    function fallback() {
      U.modal({ title: 'Copy ' + (what || 'this'), body: '<textarea class="input" rows="4" readonly style="width:100%">' + O.esc(text) + '</textarea><div class="hint">Select the text and copy it.</div>', actions: [{ label: 'Done', kind: 'primary' }], onOpen: function (el) { var t = O.$('textarea', el); t.focus(); t.select(); } });
    }
    try {
      if (navigator.clipboard && window.isSecureContext !== false) return navigator.clipboard.writeText(String(text)).then(function () { U.toast((what ? what.charAt(0).toUpperCase() + what.slice(1) : 'Text') + ' copied'); return true; }, function () { fallback(); return false; });
    } catch (e) {}
    fallback(); return Promise.resolve(false);
  };
  /* modal: returns {el, close} — actions: [{label, kind, onClick(close, el) -> false keeps it open}] */
  U.modal = function (o) {
    var back = O.html('<div class="modal-back"><div class="modal ' + (o.size || '') + (o.cls ? ' ' + o.cls : '') + '" role="dialog" aria-modal="true"><div class="modal-head"><div><h3></h3>' + (o.sub ? '<div class="sub"></div>' : '') + '</div><button class="modal-x" aria-label="Close">×</button></div><div class="modal-body"></div>' + (o.actions && o.actions.length ? '<div class="modal-foot"></div>' : '') + '</div></div>');
    O.$('h3', back).textContent = o.title || '';
    if (o.sub) O.$('.sub', back).textContent = o.sub;
    var body = O.$('.modal-body', back);
    if (typeof o.body === 'string') body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
    function close() { back.remove(); document.removeEventListener('keydown', onKey); if (o.onClose) o.onClose(); }
    function onKey(e) { if (e.key !== 'Escape') return; var all = O.$$('.modal-back'); if (all[all.length - 1] === back) close(); } /* only the top modal */
    document.addEventListener('keydown', onKey);
    if (o.body === '' || o.body == null) body.hidden = true;
    O.$('.modal-x', back).onclick = close;
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    (o.actions || []).forEach(function (a) {
      var b = O.html('<button type="button" class="btn btn-' + (a.kind || 'ghost') + '"></button>'); b.textContent = a.label;
      if (a.id) b.id = a.id;
      b.onclick = function () { var r = a.onClick ? a.onClick(close, back) : undefined; if (r !== false) close(); };
      O.$('.modal-foot', back).appendChild(b);
    });
    document.body.appendChild(back);
    if (o.onOpen) o.onOpen(back, close);
    var f = O.$$('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select', body).filter(function (x) { return x.offsetParent !== null && !x.disabled; })[0]; if (f && o.autofocus !== false) setTimeout(function () { try { f.focus(); } catch (e) {} }, 30);
    return { el: back, close: close };
  };
  /* U.confirm(question, okLabel, kind, title) — short questions sit in the title; longer ones get a title and a body */
  U.confirm = function (msg, okLabel, kind, title) {
    var long = String(msg).length > 64 || title;
    return new Promise(function (res) {
      U.modal({ title: long ? (title || (okLabel ? okLabel + '?' : 'Are you sure?')) : msg, body: long ? '<p style="margin:0;line-height:1.5">' + O.esc(msg) + '</p>' : '', size: 'sm', actions: [{ label: 'Cancel', onClick: function () { res(false); } }, { label: okLabel || 'Confirm', kind: kind || 'primary', onClick: function () { res(true); } }], autofocus: false });
    });
  };
  U.drawer = function (o) {
    var back = O.html('<div class="drawer-back"></div>');
    var dr = O.html('<aside class="drawer" role="dialog" aria-modal="true"><div class="modal-head"><div class="grow"><h3></h3><div class="sub"></div></div><button class="modal-x" aria-label="Close">×</button></div><div class="modal-body"></div>' + (o.foot ? '<div class="modal-foot"></div>' : '') + '</aside>');
    O.$('h3', dr).innerHTML = o.titleHTML || O.esc(o.title || '');
    O.$('.sub', dr).innerHTML = o.subHTML || O.esc(o.sub || '');
    var body = O.$('.modal-body', dr);
    if (typeof o.body === 'string') body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
    if (o.foot) { var f = O.$('.modal-foot', dr); if (typeof o.foot === 'string') f.innerHTML = o.foot; else f.appendChild(o.foot); }
    function close() { back.remove(); dr.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape' && !O.$('.modal-back')) close(); }
    document.addEventListener('keydown', onKey);
    back.onclick = close; O.$('.modal-x', dr).onclick = close;
    document.body.appendChild(back); document.body.appendChild(dr);
    if (o.onOpen) o.onOpen(dr, close);
    return { el: dr, close: close };
  };
  /* simple popover menu toggling (used by the shell; pages may reuse) */
  U.closeOnOutside = function (btn, menu) {
    btn.addEventListener('click', function (e) { e.stopPropagation(); var open = !menu.classList.contains('open'); O.$$('.pop-menu.open, .ws-menu.open, .viewer-menu.open, .dr-pop.open').forEach(function (m) { m.classList.remove('open'); }); if (open) menu.classList.add('open'); });
    menu.addEventListener('click', function (e) { e.stopPropagation(); });
  };
  document.addEventListener('click', function () { O.$$('.pop-menu.open, .ws-menu.open, .viewer-menu.open, .dr-pop.open').forEach(function (m) { m.classList.remove('open'); }); });

  /* ---------------- date ranges ---------------- */
  var T = D.TODAY; /* refreshed on every preset call (the clock moves) */
  var PRESETS = {
    today: ['Today', function () { return [T, T]; }],
    yesterday: ['Yesterday', function () { return [d.add(T, -1), d.add(T, -1)]; }],
    tomorrow: ['Tomorrow', function () { return [d.add(T, 1), d.add(T, 1)]; }],
    last7: ['Last 7 days', function () { return [d.add(T, -6), T]; }],
    last30: ['Last 30 days', function () { return [d.add(T, -29), T]; }],
    last90: ['Last 90 days', function () { return [d.add(T, -89), T]; }],
    next7: ['Next 7 days', function () { return [T, d.add(T, 6)]; }],
    next14: ['Next 14 days', function () { return [T, d.add(T, 13)]; }],
    next30: ['Next 30 days', function () { return [T, d.add(T, 29)]; }],
    next60: ['Next 60 days', function () { return [T, d.add(T, 59)]; }],
    next90: ['Next 90 days', function () { return [T, d.add(T, 89)]; }],
    mtd: ['Month to date', function () { return [d.monthStart(T), T]; }],
    thisMonth: ['This month', function () { return [d.monthStart(T), d.monthEnd(T)]; }],
    lastMonth: ['Last month', function () { var s = d.addMonths(d.monthStart(T), -1); return [s, d.monthEnd(s)]; }],
    nextMonth: ['Next month', function () { var s = d.addMonths(d.monthStart(T), 1); return [s, d.monthEnd(s)]; }],
    lastMonthToDate: ['Last month, same days', function () { var s = d.addMonths(d.monthStart(T), -1); return [s, d.addMonths(T, -1)]; }],
    qtd: ['Quarter to date', function () { var m = d.month(T), qm = m - ((m - 1) % 3); return [T.slice(0, 5) + ('0' + qm).slice(-2) + '-01', T]; }],
    lastQuarter: ['Last quarter', function () { var m = d.month(T), qm = m - ((m - 1) % 3), s = d.addMonths(T.slice(0, 5) + ('0' + qm).slice(-2) + '-01', -3); return [s, d.add(d.addMonths(s, 3), -1)]; }],
    ytd: ['Year to date', function () { return [T.slice(0, 4) + '-01-01', T]; }],
    last12m: ['Last 12 months', function () { return [d.add(d.addMonths(T, -12), 1), T]; }],
    since: ['All data', function () { return [D.DATA_START, T]; }]
  };
  U.PRESET_SETS = {
    past: ['today', 'yesterday', 'last7', 'last30', 'mtd', 'lastMonth', 'last90', 'qtd', 'lastQuarter', 'ytd', 'last12m'],
    future: ['today', 'tomorrow', 'next7', 'next14', 'next30', 'thisMonth', 'nextMonth', 'next60', 'next90'],
    both: ['today', 'last7', 'next7', 'next14', 'mtd', 'thisMonth', 'lastMonth', 'nextMonth', 'last30', 'next30', 'qtd', 'ytd']
  };
  U.preset = function (key) { var p = PRESETS[key]; if (!p) return null; T = D.TODAY; var r = p[1](); return { from: r[0], to: r[1], preset: key, label: p[0] }; };
  U.rangeLabel = function (from, to) { return from === to ? d.fmtY(from) : (from.slice(0, 4) === to.slice(0, 4) ? d.fmtRange(from, to) + ' ' + to.slice(0, 4) : d.fmtY(from) + ' – ' + d.fmtY(to)); };
  /* date range picker: returns an element. o = {from, to, preset, presets:'past'|'future'|'both'|[keys], onChange({from,to,preset,label}), align:'right'} */
  U.dateRange = function (o) {
    var keys = Array.isArray(o.presets) ? o.presets : U.PRESET_SETS[o.presets || 'both'];
    var st = { from: o.from, to: o.to, preset: o.preset || null };
    if (st.preset && !st.from) { var p0 = U.preset(st.preset); st.from = p0.from; st.to = p0.to; }
    var el = O.html('<div class="dr' + (o.align === 'right' ? ' right' : '') + '"><button type="button" class="dr-btn" aria-haspopup="true">' + O.icon('calendar') + '<span class="dr-preset"></span><span class="dr-lbl"></span>' + O.icon('chevron') + '</button>' +
      '<div class="dr-pop"><div class="dr-presets"></div><div class="dr-custom"><div class="label">Custom range</div><div class="field"><label>From</label><input type="date" class="input dr-from"></div><div class="field"><label>To</label><input type="date" class="input dr-to"></div><div class="dr-sum"></div><button type="button" class="btn btn-primary btn-sm dr-apply">Apply range</button></div></div></div>');
    var pop = O.$('.dr-pop', el), btn = O.$('.dr-btn', el);
    function paint() {
      var p = st.preset && PRESETS[st.preset];
      O.$('.dr-preset', el).textContent = p ? p[0] : ''; el.classList.toggle('has-preset', !!p);
      O.$('.dr-lbl', el).textContent = U.rangeLabel(st.from, st.to);
      O.$('.dr-presets', el).innerHTML = keys.map(function (k) { return '<button type="button" data-k="' + k + '" class="' + (k === st.preset ? 'on' : '') + '">' + PRESETS[k][0] + '</button>'; }).join('') + '<button type="button" data-k="custom" class="' + (!st.preset ? 'on' : '') + '">Custom…</button>';
      O.$('.dr-from', el).value = st.from; O.$('.dr-to', el).value = st.to;
      O.$('.dr-sum', el).textContent = (d.diff(st.from, st.to) + 1) + ' days';
    }
    function fire() { paint(); if (o.onChange) o.onChange({ from: st.from, to: st.to, preset: st.preset, label: st.preset ? PRESETS[st.preset][0] : U.rangeLabel(st.from, st.to) }); }
    U.closeOnOutside(btn, pop);
    O.$('.dr-presets', el).addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.k === 'custom') { st.preset = null; paint(); O.$('.dr-from', el).focus(); return; }
      var r = U.preset(b.dataset.k); st.from = r.from; st.to = r.to; st.preset = r.preset; pop.classList.remove('open'); fire();
    });
    O.$('.dr-apply', el).onclick = function () {
      var f = O.$('.dr-from', el).value, t = O.$('.dr-to', el).value; if (!f || !t) return;
      if (f > t) { var x = f; f = t; t = x; }
      st.from = f; st.to = t; st.preset = null; pop.classList.remove('open'); fire();
    };
    paint();
    el.getValue = function () { return { from: st.from, to: st.to, preset: st.preset }; };
    return el;
  };
  /* mount helper: replaces <span data-slot="name"></span> inside root with node */
  U.mount = function (root, slot, node) { var s = O.$('[data-slot="' + slot + '"]', root); if (s) s.replaceWith(node); return node; };

  /* ===================================================================
     CHARTS (SVG, hover tooltips; current period = brand, comparisons = grey)
     =================================================================== */
  var CH = O.chart = {};
  var TONE_VAR = { brand: '--brand-strong', accent: '--accent', prev1: '--c-prev1', prev2: '--c-prev2', ok: '--ok', bad: '--c-bad', info: '--info' };
  CH.toneColor = function (t) { var v = TONE_VAR[t] || t; return v.charAt(0) === '-' ? 'var(' + v + ')' : v; };
  /* axis top with 4 even steps: finer candidates so lines and bars use most of the height; small whole-number data gets whole-number ticks */
  function niceMax(v, ints) {
    if (v <= 0) return ints ? 4 : 1;
    if (ints && v <= 40) return Math.max(4, Math.ceil(v / 4) * 4);
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p, c = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < c.length; i++) if (n <= c[i] + 1e-9) return c[i] * p;
    return 10 * p;
  }
  function allInts(arr) { return arr.every(function (v) { return Math.round(v) === v; }); }
  /* left padding wide enough for the longest axis label (about 6.3px per character at 11px) */
  function autoPad(o, labels) { if (o.padLeft) return o.padLeft; var w = labels.reduce(function (m, t) { return Math.max(m, String(t).length); }, 0); return Math.max(34, Math.round(w * 6.3 + 14)); }
  function watch(el, draw) {
    draw();
    if (window.ResizeObserver) { var w0 = el.clientWidth; var ro = new ResizeObserver(function () { if (Math.abs(el.clientWidth - w0) > 4) { w0 = el.clientWidth; draw(); } }); ro.observe(el); }
  }
  function tipHTML(title, rows) {
    return '<div class="tt-h">' + O.esc(title) + '</div>' + rows.map(function (r) { return '<div class="tt-r"><span><i style="background:' + r.color + '"></i>' + O.esc(r.name) + '</span><b>' + r.value + '</b></div>'; }).join('');
  }
  function placeTip(tip, el, x, y) {
    tip.style.display = 'block';
    var w = tip.offsetWidth, W = el.clientWidth;
    var left = x + 14; if (left + w > W) left = x - w - 14; if (left < 0) left = 0;
    tip.style.left = left + 'px'; tip.style.top = Math.max(0, y - 10) + 'px';
  }
  /* line chart. o = {labels, series:[{name, values, tone, dash, width}], height, yFormat, xFormat(label,i), xTicks, band:{lo,hi,name}, area, yMin, yMaxHint, directLabels, tipTitle(i), markers} */
  CH.line = function (el, o) {
    el.classList.add('chart');
    watch(el, function () {
      var W = Math.max(280, el.clientWidth || 600), H = o.height || 220, pr = o.directLabels ? 86 : 14, pt = 12, pb = 26;
      var n = o.labels.length, all = [];
      o.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) all.push(v); }); });
      if (o.band) o.band.hi.forEach(function (v) { if (v != null) all.push(v); });
      var ymin = o.yMin != null ? o.yMin : 0, ymax = o.yMax != null ? o.yMax : niceMax(Math.max(o.yMaxHint || 0, Math.max.apply(null, all.concat([1]))), allInts(all));
      if (o.yMin == null && o.yMax == null && Math.min.apply(null, all) > ymax * 0.55) { ymin = Math.floor(Math.min.apply(null, all) * 0.8 / (ymax / 10)) * (ymax / 10); }
      var yf0 = o.yFormat || function (v) { return O.fmt.num(v); }, gl = [];
      for (var g0 = 0; g0 <= 4; g0++) gl.push(yf0(ymin + (ymax - ymin) * g0 / 4, true));
      var pl = autoPad(o, gl);
      var X = function (i) { return pl + (n <= 1 ? (W - pl - pr) / 2 : i * (W - pl - pr) / (n - 1)); };
      var Y = function (v) { return pt + (H - pt - pb) * (1 - (v - ymin) / ((ymax - ymin) || 1)); };
      var yf = o.yFormat || function (v) { return O.fmt.num(v); }, xf = o.xFormat || function (l) { return l; };
      var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img" aria-label="' + O.esc(o.ariaLabel || 'Line chart') + '">';
      for (var g = 0; g <= 4; g++) { var gv = ymin + (ymax - ymin) * g / 4, gy = Y(gv); s += '<line class="grid-line" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + gy + '" y2="' + gy + '"/><text class="axis-label" x="' + (pl - 8) + '" y="' + (gy + 3.5) + '" text-anchor="end">' + O.esc(yf(gv, true)) + '</text>'; }
      var ticks = o.xTicks || Math.min(n, Math.max(2, Math.floor((W - pl - pr) / 70)));
      var step = Math.max(1, Math.ceil(n / ticks));
      for (var i = 0; i < n; i += step) s += '<text class="axis-label" x="' + X(i) + '" y="' + (H - 7) + '" text-anchor="middle">' + O.esc(xf(o.labels[i], i)) + '</text>';
      if (o.band) {
        var up = '', lo = '';
        o.band.hi.forEach(function (v, i) { if (v != null) up += (up ? 'L' : 'M') + X(i) + ',' + Y(v); });
        for (var j = o.band.lo.length - 1; j >= 0; j--) if (o.band.lo[j] != null) lo += 'L' + X(j) + ',' + Y(o.band.lo[j]);
        s += '<path class="band" d="' + up + lo + 'Z"/>';
      }
      var labels = [];
      o.series.slice().reverse().forEach(function (se, ri) {
        var path = '', started = false;
        se.values.forEach(function (v, i) { if (v == null) { started = false; return; } path += (started ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); started = true; });
        var col = CH.toneColor(se.tone || 'brand');
        if (o.area && ri === o.series.length - 1 && path) {
          var firstI = se.values.findIndex(function (v) { return v != null; }), lastI = se.values.length - 1; while (lastI > 0 && se.values[lastI] == null) lastI--;
          s += '<path class="area-brand" d="' + path + 'L' + X(lastI) + ',' + Y(ymin) + 'L' + X(firstI) + ',' + Y(ymin) + 'Z"/>';
        }
        s += '<path class="series-line" style="stroke:' + col + ';stroke-width:' + (se.width || 2) + (se.dash ? ';stroke-dasharray:5 4' : '') + '" d="' + path + '"/>';
        if (o.markers === 'all') se.values.forEach(function (v, i) { if (v != null) s += '<circle class="dot-ring" cx="' + X(i) + '" cy="' + Y(v) + '" r="3.5" style="fill:' + col + '"/>'; });
        var li = se.values.length - 1; while (li >= 0 && se.values[li] == null) li--;
        if (li >= 0 && o.markers !== 'none') s += '<circle class="dot-ring" cx="' + X(li) + '" cy="' + Y(se.values[li]) + '" r="4" style="fill:' + col + '"/>';
        if (o.directLabels && li >= 0) labels.push({ x: X(li) + 8, y: Y(se.values[li]) + 4, t: se.short || se.name });
      });
      labels.sort(function (a, b) { return a.y - b.y; });
      for (var q = 1; q < labels.length; q++) if (labels[q].y - labels[q - 1].y < 13) labels[q].y = labels[q - 1].y + 13;
      labels.forEach(function (lb) { s += '<text class="direct-label" x="' + lb.x + '" y="' + lb.y + '" style="fill:var(--text-2)">' + O.esc(lb.t) + '</text>'; });
      s += '<line class="crosshair" x1="0" x2="0" y1="' + pt + '" y2="' + (H - pb) + '" style="display:none"/><g class="hover-dots"></g>';
      s += '<rect x="' + pl + '" y="0" width="' + (W - pl - pr) + '" height="' + H + '" fill="transparent" class="hit"/></svg>';
      el.innerHTML = s + '<div class="chart-tip"></div>';
      var svg = O.$('svg', el), tip = O.$('.chart-tip', el), ch = O.$('.crosshair', el), dots = O.$('.hover-dots', el);
      function show(evt) {
        var r = svg.getBoundingClientRect(), sx = (evt.clientX - r.left) * (W / r.width);
        var i = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((sx - pl) / ((W - pl - pr) / (n - 1)))));
        ch.setAttribute('x1', X(i)); ch.setAttribute('x2', X(i)); ch.style.display = '';
        var rows = [], dd = '';
        o.series.forEach(function (se) { var v = se.values[i]; if (v == null) return; var col = CH.toneColor(se.tone || 'brand'); rows.push({ name: se.name, value: yf(v), color: col }); dd += '<circle class="dot-ring" cx="' + X(i) + '" cy="' + Y(v) + '" r="4.5" style="fill:' + col + '"/>'; });
        if (o.band && o.band.lo[i] != null) rows.push({ name: o.band.name || 'Range', value: yf(o.band.lo[i]) + ' – ' + yf(o.band.hi[i]), color: 'var(--c-prev2)' });
        dots.innerHTML = dd;
        tip.innerHTML = tipHTML(o.tipTitle ? o.tipTitle(i) : xf(o.labels[i], i), rows);
        placeTip(tip, el, X(i) * (r.width / W), (evt.clientY - r.top));
      }
      function hide() { tip.style.display = 'none'; ch.style.display = 'none'; dots.innerHTML = ''; }
      var hit = O.$('.hit', el);
      hit.addEventListener('mousemove', show); hit.addEventListener('mouseleave', hide);
      hit.addEventListener('touchstart', function (e) { show(e.touches[0]); }, { passive: true });
    });
  };
  /* grouped bars. o = {labels, series:[{name, values, tone}], height, yFormat, xFormat, tipTitle(i), stacked} */
  CH.bars = function (el, o) {
    el.classList.add('chart');
    watch(el, function () {
      var W = Math.max(280, el.clientWidth || 600), H = o.height || 220, pr = 10, pt = 12, pb = 26;
      var n = o.labels.length, m = o.series.length, max = 0, min = 0, vals = [];
      for (var i = 0; i < n; i++) { if (o.stacked) { var tot = 0; o.series.forEach(function (s) { tot += Math.max(0, s.values[i] || 0); }); max = Math.max(max, tot); } else o.series.forEach(function (s) { max = Math.max(max, s.values[i] || 0); min = Math.min(min, s.values[i] || 0); }); }
      o.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) vals.push(v); }); });
      var ints = allInts(vals), ymax = o.yMax != null ? o.yMax : niceMax(max, ints), ymin = 0;
      if (min < 0) { /* negatives: same step below zero as above, so zero sits on a grid line */ var stp = ymax / 4; if (max <= 0) { ymax = 0; stp = niceMax(-min, ints) / 4; } ymin = -Math.ceil(-min / stp - 1e-9) * stp; }
      var Y = function (v) { return pt + (H - pt - pb) * (1 - (v - ymin) / ((ymax - ymin) || 1)); };
      var yf = o.yFormat || function (v) { return O.fmt.num(v); }, xf = o.xFormat || function (l) { return l; };
      var gsteps = Math.round((ymax - ymin) / ((ymax || -ymin) / 4)) || 4, gl = [];
      for (var g0 = 0; g0 <= gsteps; g0++) gl.push(yf(ymin + (ymax - ymin) * g0 / gsteps, true));
      var pl = autoPad(o, gl);
      var gw = (W - pl - pr) / n, inner = Math.min(gw * 0.72, o.stacked ? 44 : 22 * m + 2 * (m - 1)), bw = o.stacked ? inner : Math.max(3, (inner - 2 * (m - 1)) / m);
      var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img" aria-label="' + O.esc(o.ariaLabel || 'Bar chart') + '">';
      for (var g = 0; g <= gsteps; g++) { var gv = ymin + (ymax - ymin) * g / gsteps, gy = Y(gv); s += '<line class="grid-line' + (gv === 0 && ymin < 0 ? ' zero' : '') + '" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + gy + '" y2="' + gy + '"' + (gv === 0 && ymin < 0 ? ' style="stroke:var(--border-strong)"' : '') + '/><text class="axis-label" x="' + (pl - 8) + '" y="' + (gy + 3.5) + '" text-anchor="end">' + O.esc(yf(gv, true)) + '</text>'; }
      var labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - pl - pr) / 46))));
      for (i = 0; i < n; i++) {
        var gx = pl + gw * i + (gw - inner) / 2, acc = 0;
        o.series.forEach(function (se, k) {
          var v = se.values[i] || 0; if (!v || (o.stacked && v < 0)) return;
          var x = o.stacked ? gx : gx + k * (bw + 2), y0 = o.stacked ? Y(acc + v) : Y(v), h = o.stacked ? Y(acc) - Y(acc + v) : Math.abs(Y(0) - Y(v));
          var r = Math.min(4, bw / 2, h);
          var col = CH.toneColor(se.tone || (v < 0 ? 'bad' : 'brand'));
          if (o.stacked) s += '<rect x="' + x + '" y="' + (y0 + 1) + '" width="' + bw + '" height="' + Math.max(0, h - 2) + '" style="fill:' + col + '"/>';
          else if (v > 0) s += '<path d="M' + x + ',' + Y(0) + 'V' + (y0 + r) + 'Q' + x + ',' + y0 + ' ' + (x + r) + ',' + y0 + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + y0 + ' ' + (x + bw) + ',' + (y0 + r) + 'V' + Y(0) + 'Z" style="fill:' + col + '"/>';
          else s += '<path d="M' + x + ',' + Y(0) + 'V' + (y0 - r) + 'Q' + x + ',' + y0 + ' ' + (x + r) + ',' + y0 + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + y0 + ' ' + (x + bw) + ',' + (y0 - r) + 'V' + Y(0) + 'Z" style="fill:' + col + '"/>'; /* rounded end at the bottom */
          acc += v;
        });
        if (i % labelEvery === 0) s += '<text class="axis-label" x="' + (pl + gw * i + gw / 2) + '" y="' + (H - 7) + '" text-anchor="middle">' + O.esc(xf(o.labels[i], i)) + '</text>';
        s += '<rect class="hit" data-i="' + i + '" x="' + (pl + gw * i) + '" y="0" width="' + gw + '" height="' + (H - pb) + '" fill="transparent"/>';
      }
      s += '</svg>';
      el.innerHTML = s + '<div class="chart-tip"></div>';
      var svg = O.$('svg', el), tip = O.$('.chart-tip', el);
      O.$$('.hit', el).forEach(function (h) {
        function show(evt) {
          var i = +h.dataset.i, r = svg.getBoundingClientRect();
          var rows = o.series.map(function (se) { return { name: se.name, value: yf(se.values[i] || 0), color: CH.toneColor(se.tone || 'brand') }; });
          if (o.stacked && o.series.length > 1) rows.push({ name: 'Total', value: yf(o.series.reduce(function (s2, se) { return s2 + (se.values[i] || 0); }, 0)), color: 'transparent' });
          tip.innerHTML = tipHTML(o.tipTitle ? o.tipTitle(i) : xf(o.labels[i], i), rows);
          placeTip(tip, el, (pl + gw * i + gw / 2) * (r.width / W), evt.clientY - r.top);
          h.setAttribute('fill', 'rgba(0,0,0,0.035)');
        }
        h.addEventListener('mousemove', show);
        h.addEventListener('mouseleave', function () { tip.style.display = 'none'; h.setAttribute('fill', 'transparent'); });
        h.addEventListener('touchstart', function (e) { show(e.touches[0]); }, { passive: true });
      });
    });
  };
  /* sparkline SVG string */
  CH.spark = function (values, o) {
    o = o || {}; var w = o.w || 100, h = o.h || 24, vs = values.filter(function (v) { return v != null; });
    if (!vs.length) return '';
    var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs), rng = mx - mn || 1;
    var pts = values.map(function (v, i) { return v == null ? null : [(i / Math.max(1, values.length - 1)) * (w - 4) + 2, h - 3 - ((v - mn) / rng) * (h - 6)]; }).filter(Boolean);
    var p = pts.map(function (q, i) { return (i ? 'L' : 'M') + q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join('');
    var last = pts[pts.length - 1];
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" width="100%" height="' + h + '" aria-hidden="true"><path d="' + p + '" fill="none" style="stroke:' + CH.toneColor(o.tone || 'brand') + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.2" style="fill:' + CH.toneColor(o.tone || 'brand') + '"/></svg>';
  };
  /* horizontal bars (HTML). rows: [{label (html), value, display, tone, sub}] */
  CH.hbars = function (rows, o) {
    o = o || {}; var max = o.max || Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
    return rows.map(function (r) {
      return '<div class="hbar"><div class="hb-label">' + r.label + '</div><div class="hb-track"><div class="hb-fill" style="width:' + Math.max(0, Math.min(100, r.value / max * 100)).toFixed(1) + '%;background:' + CH.toneColor(r.tone || 'brand') + '"></div></div><div class="hb-val">' + (r.display != null ? r.display : O.fmt.num(r.value)) + '</div></div>';
    }).join('');
  };
  CH.legend = function (items) { /* [{name, tone, square}] */
    return '<div class="legend">' + items.map(function (i) { return '<span><i class="' + (i.square ? 'sq' : '') + '" style="background:' + CH.toneColor(i.tone) + (i.dash ? ';background:repeating-linear-gradient(90deg,' + CH.toneColor(i.tone) + ' 0 4px,transparent 4px 7px)' : '') + '"></i>' + O.esc(i.name) + '</span>'; }).join('') + '</div>';
  };

  /* ===================================================================
     FILES: download (artifact downloads capability, with a local fallback), CSV, PDF
     =================================================================== */
  var dlPromise = null;
  function downloadsNS() {
    if (!dlPromise) dlPromise = (window.claude && typeof window.claude.use === 'function') ? window.claude.use('downloads').catch(function () { return null; }) : Promise.resolve(null);
    return dlPromise;
  }
  if (window.claude && typeof window.claude.use === 'function') setTimeout(downloadsNS, 0);
  O.download = function (filename, data, mime) {
    return downloadsNS().then(function (ns) {
      if (ns) return ns.save({ filename: filename, data: data }).then(function () { U.toast('Saved ' + filename); return true; }, function (err) {
        var code = err && err.code;
        if (code === 'declined') { U.toast('Download cancelled', 'bad'); return false; }
        if (code === 'rate_limited') { U.toast('Another download is waiting for your confirmation', 'bad'); return false; }
        return localSave();
      });
      return localSave();
    });
    function localSave() {
      try {
        var blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
        U.toast('Downloaded ' + filename); return true;
      } catch (e) { U.toast('Downloads are not available in this view', 'bad'); return false; }
    }
  };
  O.csv = function (rows) { /* rows: array of arrays (first = header) */
    return rows.map(function (r) { return r.map(function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
  };
  O.downloadCSV = function (filename, rows) { return O.download(filename, '﻿' + O.csv(rows), 'text/csv'); };
  /* PDF helpers on top of jsPDF (loaded from cdnjs) */
  O.pdf = {
    ready: function () { return !!(window.jspdf && window.jspdf.jsPDF); },
    /* start an A4 document with the workspace brand header. returns Promise<{doc, y}> */
    start: function (title, subtitle) {
      if (!O.pdf.ready()) { U.toast('The PDF library did not load. Check your connection and try again.', 'bad'); return Promise.reject(new Error('jspdf missing')); }
      var ws = O.ws(), brand = (O.theme.current && O.theme.current.primary) || '#0B5D54', ink = C.ink(brand);
      return O.theme.logoPNG(ws, 160).then(function (png) {
        var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
        var rgb = C.hexToRgb(brand), irgb = C.hexToRgb(ink);
        doc.setFillColor(rgb[0], rgb[1], rgb[2]); doc.rect(0, 0, 210, 30, 'F');
        if (png) { doc.setFillColor(255, 255, 255); doc.roundedRect(12, 6, 18, 18, 3, 3, 'F'); doc.addImage(png, 'PNG', 13, 7, 16, 16); }
        doc.setTextColor(irgb[0], irgb[1], irgb[2]); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(ws.legal || ws.name, png ? 34 : 12, 14);
        /* the address line shares row 20 with the subtitle: keep it to the space left, or move it below */
        var lx = png ? 34 : 12, addr = (ws.address || '') + (ws.email ? '  ·  ' + ws.email : '');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
        var subW = subtitle ? doc.getTextWidth(String(subtitle)) : 0, room = 198 - lx - subW - 6;
        if (addr) { if (room >= 50) doc.text(doc.splitTextToSize(addr, room)[0], lx, 20); else doc.text(doc.splitTextToSize(addr, 198 - lx)[0], lx, 26); }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(String(title).toUpperCase(), 198, 14, { align: 'right' });
        if (subtitle) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(String(subtitle), 198, 20, { align: 'right' }); }
        doc.setTextColor(20, 24, 31);
        return { doc: doc, y: 40 };
      });
    },
    /* draw a table; columns: [{label, w (mm), align:'right'}]; returns new y */
    table: function (doc, y, columns, rows, opts) {
      opts = opts || {}; var x0 = 12, lh = 6.2;
      function header() {
        doc.setFillColor(244, 245, 247); doc.rect(x0, y - 4.3, 186, 6.5, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(95, 107, 122);
        var x = x0 + 1.5; columns.forEach(function (c) { doc.text(String(c.label), c.align === 'right' ? x + c.w - 3 : x, y, { align: c.align === 'right' ? 'right' : 'left' }); x += c.w; });
        y += lh; doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 24, 31); doc.setFontSize(8.5);
      }
      header();
      rows.forEach(function (r, ri) {
        if (y > 280) { doc.addPage(); y = 18; header(); }
        var x = x0 + 1.5, bold = opts.boldLast && ri === rows.length - 1;
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        columns.forEach(function (c, ci) {
          var t = String(r[ci] == null ? '' : r[ci]).replace(/−/g, '-').replace(/–/g, '-');
          var max = c.w - 3; while (t.length > 3 && doc.getTextWidth(t) > max) t = t.slice(0, -2);
          doc.text(t, c.align === 'right' ? x + c.w - 3 : x, y, { align: c.align === 'right' ? 'right' : 'left' }); x += c.w;
        });
        doc.setDrawColor(235, 237, 241); doc.line(x0, y + 2.2, x0 + 186, y + 2.2);
        y += lh;
      });
      return y + 2;
    },
    text: function (doc, y, text, opts) { opts = opts || {}; doc.setFont('helvetica', opts.bold ? 'bold' : 'normal'); doc.setFontSize(opts.size || 9); doc.setTextColor(opts.muted ? 95 : 20, opts.muted ? 107 : 24, opts.muted ? 122 : 31); var lines = doc.splitTextToSize(String(text).replace(/−/g, '-'), opts.width || 186); doc.text(lines, opts.x || 12, y); return y + lines.length * (opts.size || 9) * 0.42 + 2; },
    save: function (doc, filename) {
      var pages = doc.getNumberOfPages();
      for (var p = 1; p <= pages; p++) { doc.setPage(p); doc.setFontSize(7.5); doc.setTextColor(138, 148, 163); doc.text('Generated by ' + O.ws().name + ' on Orbique Command Center · ' + d.fmtY(D.TODAY) + ' · Page ' + p + ' of ' + pages, 105, 290, { align: 'center' }); }
      return O.download(filename, doc.output('arraybuffer'), 'application/pdf');
    }
  };
  /* one-call PDF export of a table report */
  O.pdf.report = function (o) { /* {filename, title, subtitle, summary:[[label,value]], columns, rows, boldLast, notes} */
    return O.pdf.start(o.title, o.subtitle).then(function (r) {
      var doc = r.doc, y = r.y;
      if (o.summary && o.summary.length) {
        var cw = 186 / Math.min(4, o.summary.length);
        o.summary.forEach(function (s, i) {
          var cx = 12 + (i % 4) * cw, cy = y + Math.floor(i / 4) * 16;
          doc.setDrawColor(227, 230, 235); doc.roundedRect(cx, cy - 4, cw - 3, 13, 2, 2, 'S');
          doc.setFontSize(7.5); doc.setTextColor(95, 107, 122); doc.setFont('helvetica', 'normal'); doc.text(String(s[0]), cx + 3, cy + 0.5);
          doc.setFontSize(11); doc.setTextColor(20, 24, 31); doc.setFont('helvetica', 'bold'); doc.text(String(s[1]).replace(/−/g, '-'), cx + 3, cy + 6.5);
        });
        y += Math.ceil(o.summary.length / 4) * 16 + 4;
      }
      y = O.pdf.table(doc, y, o.columns, o.rows, { boldLast: o.boldLast });
      if (o.notes) O.pdf.text(doc, y + 4, o.notes, { muted: true, size: 8 });
      return O.pdf.save(doc, o.filename);
    }).catch(function () { return false; });
  };

  /* ===================================================================
     DOMAIN HELPERS: tasks, readiness, door codes, invoices, booking drawer
     =================================================================== */
  D.bookings.forEach(function (b) { b.doorCode = String(1000 + (D.hash(b.id + 'door') % 9000)); b.guestToken = 'g' + D.hash(b.id + 'guest').toString(36); });
  /* fields every new booking needs (call before pushing a booking you create): door code and guest-app link token */
  O.bookingDefaults = function (b) {
    if (!b.doorCode) { var r = new Uint16Array(1); try { crypto.getRandomValues(r); } catch (e) { r[0] = Math.floor(Math.random() * 65536); } b.doorCode = String(1000 + r[0] % 9000); }
    if (!b.guestToken) b.guestToken = O.newToken('g');
    return b;
  };
  /* task checklists: templates live in D.checklists; a task has checklistId (or customChecklist) and checks = [done item ids] */
  O.checklist = {
    template: function (id) { return D.checklists.filter(function (c) { return c.id === id; })[0] || null; },
    byKind: function (kind) { return D.checklists.filter(function (c) { return c.kind === kind; })[0] || null; },
    items: function (t) { if (t.customChecklist) return t.customChecklist; var c = t.checklistId && O.checklist.template(t.checklistId); return c ? c.items : []; },
    progress: function (t) {
      var items = O.checklist.items(t), done = (t.checks || []).filter(function (id) { return items.some(function (x) { return x.id === id; }); }).length;
      return { done: done, total: items.length, pct: items.length ? done / items.length : 0 };
    },
    /* the template for a task type: Turnover -> checkout, Inspection before arrival -> checkin, Daily/mid-stay -> daily */
    forType: function (type, title) { if (/mid-stay|daily/i.test(title || '')) return 'CL-daily'; return type === 'Turnover' ? 'CL-checkout' : type === 'Inspection' ? 'CL-checkin' : null; }
  };
  D.lockLog = [
    { at: '2026-10-05T18:00', propertyId: 'bf3b', bookingId: null, by: 's2', what: 'Master code changed', code: '4827' },
    { at: '2026-10-04T15:00', propertyId: 'hsg', bookingId: null, by: 'system', what: 'Guest code activated for Olivia Chen', code: null }
  ];
  D.sentLog = []; /* every invoice / receipt / code we send, newest first */
  O.prop = function (id) { return D.propById[id]; };
  O.tasksFor = function (pid, day) { return D.tasks.filter(function (t) { return t.propertyId === pid && String(t.due || '').slice(0, 10) === day; }); };
  /* arrival readiness for a booking: [{key,label,state:'ok'|'wait'|'todo'|'bad'}] */
  O.readiness = function (b) {
    var due = function (t) { return String(t.due || '').slice(0, 10); };
    if (!b.propertyId && b.unitTypeId) {
      return [{ key: 'clean', label: 'No unit yet', state: 'bad' }, { key: 'id', label: b.idVerified ? 'ID verified' : 'ID pending', state: b.idVerified ? 'ok' : 'wait' }];
    }
    var clean = D.tasks.filter(function (t) { return t.propertyId === b.propertyId && t.type === 'Turnover' && due(t) === b.checkIn; })[0];
    var out = [];
    /* the check-in readiness task counts once the clean is done (or when there is no clean that day) */
    var insp = (!clean || clean.status === 'done') && D.tasks.filter(function (t) { return t.propertyId === b.propertyId && (t.type === 'Inspection' || t.checklistId === 'CL-checkin') && due(t) === b.checkIn && b.checkIn >= D.TODAY; })[0];
    var pg = function (t) { var c = O.checklist.progress(t); return c.total ? ' ' + c.done + '/' + c.total : ''; };
    if (insp) out.push({ key: 'clean', label: insp.status === 'done' ? 'Inspected' : insp.status === 'in_progress' ? 'Inspecting' + pg(insp) : 'Inspection not started', state: insp.status === 'done' ? 'ok' : insp.status === 'in_progress' ? 'wait' : 'todo' });
    else if (clean) out.push({ key: 'clean', label: clean.status === 'done' ? 'Cleaned' : clean.status === 'in_progress' ? 'Cleaning' + pg(clean) : 'Clean not started', state: clean.status === 'done' ? 'ok' : clean.status === 'in_progress' ? 'wait' : 'todo' });
    else if (b.checkIn < D.TODAY) out.push({ key: 'clean', label: 'Checked in', state: 'ok' });
    else {
      var turn = D.bookings.some(function (x) { return x !== b && x.propertyId === b.propertyId && x.status !== 'cancelled' && x.checkOut === b.checkIn; });
      out.push(!turn ? { key: 'clean', label: 'Unit ready', state: 'ok' } : b.checkIn === D.TODAY ? { key: 'clean', label: 'No clean booked', state: 'todo' } : { key: 'clean', label: 'Clean set for check-out day', state: 'wait' });
    }
    out.push({ key: 'id', label: b.idVerified ? 'ID verified' : 'ID pending', state: b.idVerified ? 'ok' : 'wait' });
    var cs = b.codeStatus;
    out.push({ key: 'code', label: cs === 'sent' ? 'Code sent' : cs === 'scheduled' ? 'Code scheduled' : cs === 'held' ? 'Code held until ID' : cs === 'expired' ? 'Code expired' : 'Code cancelled', state: cs === 'sent' ? 'ok' : cs === 'scheduled' ? 'wait' : cs === 'held' ? 'todo' : 'todo' });
    if (b.rulesAccepted) out.push({ key: 'rules', label: 'House rules accepted', state: 'ok' });
    return out;
  };
  O.readinessHTML = function (b) { return '<div class="ready">' + O.readiness(b).map(function (r) { return '<span class="rd ' + r.state + '">' + O.esc(r.label) + '</span>'; }).join('') + '</div>'; };

  /* ---------------- door lock codes ---------------- */
  O.lock = {};
  O.lock.activeBooking = function (pid) { /* the in-house or next arriving booking for a property */
    var list = D.bookings.filter(function (b) { return b.propertyId === pid && b.status !== 'cancelled' && b.checkOut > D.TODAY; }).sort(function (a, b) { return a.checkIn < b.checkIn ? -1 : 1; });
    return list[0] || null;
  };
  /* change a door code from anywhere: O.lock.change({propertyId, bookingId}) */
  O.lock.change = function (o) {
    o = o || {};
    if (O.can && !O.can('guestapp.doorCodes')) { U.toast(O.viewer().name + '\'s access does not include changing door codes. An account owner can allow it in Staff Access.', 'bad'); return; }
    var b = o.bookingId ? D.booking(o.bookingId) : null;
    var firstProp = O.activeProperties()[0];
    if (!b && !firstProp) { U.toast('Add a unit first, then you can set its door codes.', 'bad'); return; }
    var pid = o.propertyId || (b && b.propertyId) || firstProp.id;
    var body = O.html('<div class="stack">' +
      '<div class="field"><label for="lk-pid">Property</label><select class="select" name="pid" id="lk-pid">' + U.propOptions(pid) + '</select></div>' +
      '<div class="note lk-info"></div>' +
      '<div class="field"><label>Which code?</label><div class="seg lk-scope"><button type="button" data-v="guest" class="on">Guest code (one stay)</button><button type="button" data-v="master">Master code (staff &amp; cleaners)</button></div></div>' +
      '<div class="field lk-guest-row"><label for="lk-bid">Booking</label><select class="select" name="bid" id="lk-bid"></select></div>' +
      '<div class="field"><label for="lk-code">New code</label><div class="row-flex"><input class="input code-in" name="code" id="lk-code" inputmode="numeric" maxlength="8" style="font-size:20px;font-weight:800;letter-spacing:0.25em;max-width:180px"><button type="button" class="btn btn-ghost btn-sm lk-gen">' + O.icon('refresh') + 'Generate</button></div><div class="hint">4 to 8 digits. Avoid repeating or sequential numbers.</div></div>' +
      '<div class="form-grid lk-valid"><div class="field"><label for="lk-from">Works from</label><input type="datetime-local" class="input" name="from" id="lk-from"></div><div class="field"><label for="lk-to">Until</label><input type="datetime-local" class="input" name="to" id="lk-to"></div></div>' +
      '<label class="check lk-notify"><input type="checkbox" name="notify" checked><span>Send the new code to the guest on WhatsApp (and in their guest app) from 30 minutes before check-in</span></label>' +
      '<div class="lk-err small" style="color:var(--bad)"></div></div>');
    var scope = b ? 'guest' : (o.scope || 'guest');
    function bookingsFor(p) { return D.bookings.filter(function (x) { return x.propertyId === p && x.status !== 'cancelled' && x.checkOut > D.TODAY; }).sort(function (a, c) { return a.checkIn < c.checkIn ? -1 : 1; }).slice(0, 6); }
    function gen() { var c; do { c = String(1000 + Math.floor(Math.random() * 9000)); } while (/(\d)\1\1/.test(c) || '0123456789'.indexOf(c) >= 0); return c; }
    function paint() {
      var p = D.propById[O.$('[name=pid]', body).value];
      var list = bookingsFor(p.id), sel = O.$('[name=bid]', body);
      sel.innerHTML = list.length ? list.map(function (x) { return '<option value="' + x.id + '"' + (b && x.id === b.id ? ' selected' : '') + '>' + O.esc(x.guest.name) + ' · ' + d.fmtRange(x.checkIn, x.checkOut) + (x.status === 'checked_in' ? ' (in-house)' : '') + '</option>'; }).join('') : '<option value="">No upcoming bookings</option>';
      var cur = list.filter(function (x) { return x.id === sel.value; })[0];
      O.$('.lk-info', body).innerHTML = '<b>' + O.esc(p.lockBrand) + ' smart lock</b> · ' + O.esc(p.name) + '<br>Master code <span class="kbd">' + O.esc(p.lockCode) + '</span>' + (cur ? ' · Guest code for ' + O.esc(cur.guest.name) + ' <span class="kbd">' + O.esc(cur.doorCode) + '</span>' : '');
      O.$$('.lk-scope button', body).forEach(function (x) { x.classList.toggle('on', x.dataset.v === scope); });
      O.$('.lk-guest-row', body).hidden = scope !== 'guest';
      O.$('.lk-valid', body).hidden = scope !== 'guest';
      O.$('.lk-notify', body).hidden = scope !== 'guest';
      if (cur && scope === 'guest') { O.$('[name=from]', body).value = cur.checkIn + 'T' + cur.checkInTime; O.$('[name=to]', body).value = cur.checkOut + 'T' + cur.checkOutTime; }
    }
    O.$('[name=pid]', body).onchange = paint;
    O.$('[name=bid]', body).onchange = paint;
    O.$('.lk-scope', body).onclick = function (e) { var x = e.target.closest('button'); if (!x) return; scope = x.dataset.v; paint(); };
    O.$('.lk-gen', body).onclick = function () { O.$('[name=code]', body).value = gen(); };
    O.$('[name=code]', body).value = gen();
    paint();
    U.modal({
      title: 'Change door code', sub: 'Updates the smart lock remotely. Works from every page.', body: body,
      actions: [{ label: 'Cancel' }, {
        label: 'Update lock', kind: 'primary', onClick: function () {
          var code = O.$('[name=code]', body).value.trim(), p = D.propById[O.$('[name=pid]', body).value];
          if (!/^\d{4,8}$/.test(code)) { O.$('.lk-err', body).textContent = 'Enter 4 to 8 digits.'; return false; }
          if (scope === 'master') {
            p.lockCode = code;
            D.lockLog.unshift({ at: D.NOW, propertyId: p.id, bookingId: null, by: O.state.viewer, what: 'Master code changed', code: code });
            U.toast('Master code for ' + p.short + ' changed to ' + code + ' on the ' + p.lockBrand + ' lock');
          } else {
            var bk = D.booking(O.$('[name=bid]', body).value);
            if (!bk) { O.$('.lk-err', body).textContent = 'There is no booking to set a guest code for. Choose the master code instead.'; return false; }
            /* the guest gets the code only from 30 minutes before check-in (O.guestmsg): earlier, it is scheduled for then */
            var notify = O.$('[name=notify]', body).checked, bt = O.unitType(bk.unitTypeId) || O.typeOf(D.propById[bk.propertyId]);
            var at = O.guestmsg.revealAt(bk, O.guestmsg.ciTimeOf(bk, D.propById[bk.propertyId], bt && O.building(bt.buildingId))), later = notify && at && D.NOW < at;
            bk.doorCode = code; if (bk.codeStatus !== 'held' && notify) bk.codeStatus = later ? 'scheduled' : 'sent';
            D.lockLog.unshift({ at: D.NOW, propertyId: p.id, bookingId: bk.id, by: O.state.viewer, what: 'Guest code changed for ' + bk.guest.name, code: code });
            if (notify && !later) D.sentLog.unshift({ at: D.NOW, bookingId: bk.id, kind: 'door code', via: 'WhatsApp', to: bk.guest.phone, by: O.state.viewer });
            U.toast('New code ' + code + ' set for ' + bk.guest.name + (!notify ? '' : later ? '. It goes to the guest on WhatsApp at ' + O.fmt.time(at.slice(11)) + ' on ' + d.fmt(at.slice(0, 10)) + ', 30 minutes before check-in.' : ' and sent on WhatsApp'));
          }
          O.emit('data', { type: 'lock' });
          if (o.onDone) o.onDone({ scope: scope, code: code, propertyId: p.id, bookingId: scope === 'guest' ? O.$('[name=bid]', body).value : null });
        }
      }]
    });
  };

  /* ---------------- invoices & receipts ---------------- */
  O.invoice = {};
  O.invoice.lines = function (b) {
    var p = O.guestPlace(b), mc = { cur: b }, rows = [[d.fmt(b.checkIn) + ' – ' + d.fmt(b.checkOut) + ' · ' + p.name, b.nights + ' night' + (b.nights > 1 ? 's' : '') + ' × ' + O.fmt.money(b.nightly, mc), b.accommodation], ['Cleaning fee', '', b.cleaningFee]];
    if (b.tourismTax && O.tourismTaxApplies(b)) rows.push(['Tourism tax (foreign guests, ' + O.fmt.money(10, mc) + ' per night)', b.nights + ' × ' + O.fmt.money(10, mc), b.tourismTax]);
    return rows;
  };
  O.invoice.canReceipt = function (b) { return !!b.paidAt; };
  /* HTML document preview — kind: 'invoice' | 'receipt' */
  O.invoice.html = function (b, kind) {
    var ws = O.ws(), p = D.propById[b.propertyId] || { name: 'the property', area: '' }, isR = kind === 'receipt', ct = O.contact(b);
    var no = isR ? b.receiptNo : b.invoiceNo, date = isR ? b.paidAt : b.invoiceDate;
    return '<div class="doc"><div class="doc-head"><div class="doc-logo">' + O.theme.logoHTML(ws, O.theme.get('--brand')) + '<span>' + O.esc(ws.legal || ws.name) + '</span></div><div class="doc-kind">' + (isR ? 'Payment receipt' : 'Invoice') + '</div></div>' +
      '<div class="doc-body"><div class="doc-meta"><div><div class="dm-k">Billed to</div><b>' + O.esc(b.guest.name) + '</b><br>' + O.esc(ct.email) + '<br>' + O.esc(ct.phone) + '<br>' + O.esc(b.guest.countryName || '') + '</div>' +
      '<div class="right"><div class="dm-k">' + (isR ? 'Receipt no.' : 'Invoice no.') + '</div><b>' + O.esc(no || 'Not issued yet') + '</b><div class="dm-k" style="margin-top:6px">Date</div>' + (date ? d.fmtY(date) : '–') + '<div class="dm-k" style="margin-top:6px">Booking</div>' + O.esc(b.id) + ' · ' + O.esc(U.platName(b.channel)) + '</div></div>' +
      '<table><thead><tr><th>Description</th><th></th><th class="num">Amount</th></tr></thead><tbody>' +
      O.invoice.lines(b).map(function (r) { return '<tr><td>' + O.esc(r[0]) + '</td><td class="muted">' + O.esc(r[1]) + '</td><td class="num">' + O.fmt.money(r[2], { cur: b, dp: 2 }) + '</td></tr>'; }).join('') +
      '<tr class="doc-total"><td>' + (isR ? 'Amount received' : 'Total due') + '</td><td></td><td class="num">' + O.fmt.money(b.total, { cur: b, dp: 2 }) + '</td></tr></tbody></table>' +
      (isR ? '<div class="row-flex" style="margin-top:14px;justify-content:space-between"><div class="small">Paid ' + d.fmtY(b.paidAt) + ' · ' + O.esc(b.payMethod) + '</div><span class="doc-paid">PAID</span></div>'
        : '<div class="small" style="margin-top:12px">' + (b.paidAt ? 'Paid in full on ' + d.fmtY(b.paidAt) + ' (' + O.esc(b.payMethod) + ').' : b.channel === 'direct' ? 'Please pay by ' + d.fmtY(d.add(b.checkIn, -7)) + ' by FPX, card or DuitNow QR using the payment link.' : 'Collected by ' + O.esc(U.platName(b.channel)) + '.') + '</div>') +
      '</div><div class="doc-foot">' + O.esc(ws.legal || ws.name) + ' · ' + O.esc(ws.regNo || '') + ' · ' + O.esc(ws.address) + ' · ' + O.esc(ws.phone) + '<br>Stay at ' + O.esc(p.name) + (p.area ? ', ' + O.esc(p.area) : '') + '. Check-in ' + O.fmt.time(b.checkInTime) + ', check-out ' + O.fmt.time(b.checkOutTime) + '.</div></div>';
  };
  O.invoice.pdf = function (b, kind) {
    var isR = kind === 'receipt', no = isR ? b.receiptNo : b.invoiceNo;
    if (isR && !b.paidAt) { U.toast('No payment recorded yet, so there is no receipt', 'bad'); return Promise.resolve(false); }
    return O.pdf.start(isR ? 'Payment receipt' : 'Invoice', no + ' · ' + d.fmtY(isR ? b.paidAt : b.invoiceDate)).then(function (r) {
      var doc = r.doc, y = r.y, p = O.guestPlace(b), ct = O.contact(b), sym = O.fmt.cur(b), pdfCur = /^[\x20-\x7e]+$/.test(sym) ? sym : O.curOf(b); /* PDF fonts lack symbols such as ฿, so those show the code */
      y = O.pdf.text(doc, y, 'Billed to', { muted: true, size: 8 });
      y = O.pdf.text(doc, y, b.guest.name, { bold: true, size: 11 });
      y = O.pdf.text(doc, y, [ct.email, ct.phone, b.guest.countryName].filter(Boolean).join('  ·  '), { size: 9 });
      y = O.pdf.text(doc, y + 2, 'Booking ' + b.id + ' via ' + U.platName(b.channel) + ' · ' + p.name + (p.area ? ', ' + p.area : ''), { muted: true, size: 8.5 });
      y = O.pdf.table(doc, y + 4, [{ label: 'Description', w: 110 }, { label: 'Qty', w: 40 }, { label: 'Amount (' + pdfCur + ')', w: 36, align: 'right' }],
        O.invoice.lines(b).map(function (l) { return [l[0], pdfCur === sym ? l[1] : String(l[1]).split(sym + ' ').join(pdfCur + ' '), l[2].toFixed(2)]; }).concat([[isR ? 'Amount received' : 'Total due', '', b.total.toFixed(2)]]), { boldLast: true });
      if (isR) y = O.pdf.text(doc, y + 2, 'PAID on ' + d.fmtY(b.paidAt) + ' by ' + b.payMethod + '.', { bold: true, size: 10 });
      else y = O.pdf.text(doc, y + 2, b.paidAt ? 'Paid in full on ' + d.fmtY(b.paidAt) + ' (' + b.payMethod + ').' : b.channel === 'direct' ? 'Payment due by ' + d.fmtY(d.add(b.checkIn, -7)) + '.' : 'Collected by ' + U.platName(b.channel) + '.', { size: 9 });
      O.pdf.text(doc, y + 4, 'Check-in ' + O.fmt.time(b.checkInTime) + ' on ' + d.fmtY(b.checkIn) + ', check-out ' + O.fmt.time(b.checkOutTime) + ' on ' + d.fmtY(b.checkOut) + '. Thank you for staying with ' + O.ws().name + '.', { muted: true, size: 8.5 });
      return O.pdf.save(doc, (isR ? 'Receipt-' : 'Invoice-') + no + '.pdf');
    }).catch(function () { return false; });
  };
  O.invoice.markPaid = function (b, method) {
    if (b.paidAt) return;
    var max = O.raw('bookings').reduce(function (m, x) { return x.receiptNo ? Math.max(m, +((/(\d+)\D*$/.exec(x.receiptNo) || [0, 0])[1])) : m; }, 1000);
    b.paidAt = D.TODAY; b.receiptNo = 'RCP-' + D.TODAY.slice(0, 4) + '-' + (max + 1); b.payMethod = method || 'Bank transfer';
    if (b.status === 'pending') b.status = 'confirmed';
    O.emit('data', { type: 'payment', bookingId: b.id });
  };
  O.invoice.preview = function (b, kind) {
    var isR = kind === 'receipt';
    var m = U.modal({
      title: (isR ? 'Payment receipt ' + (b.receiptNo || '') : 'Invoice ' + b.invoiceNo), sub: b.guest.name + ' · ' + O.bookingPlace(b), size: 'wide',
      body: isR && !b.paidAt ? '<div class="note warn">No payment has been recorded for this booking yet. The receipt is created automatically when payment arrives, or you can record it now.</div><div class="row-flex" style="margin-top:12px"><select class="select" style="max-width:240px" name="pm">' + ['FPX online banking', 'Card (Visa)', 'DuitNow QR', 'Bank transfer', 'Cash'].map(function (x) { return '<option>' + x + '</option>'; }).join('') + '</select><button type="button" class="btn btn-primary btn-sm mark-paid">Record payment</button></div>' : O.invoice.html(b, kind),
      actions: isR && !b.paidAt ? [{ label: 'Close' }] : [{ label: 'Download PDF', onClick: function () { O.invoice.pdf(b, kind); return false; } }, { label: 'Send to guest', kind: 'primary', onClick: function () { O.invoice.send(b, [kind]); } }],
      onOpen: function (el, close) { var mp = O.$('.mark-paid', el); if (mp) mp.onclick = function () { O.invoice.markPaid(b, O.$('[name=pm]', el).value); close(); U.toast('Payment recorded. Receipt ' + b.receiptNo + ' created.'); O.invoice.preview(b, 'receipt'); }; }
    });
    return m;
  };
  /* send invoice and/or receipt to the guest: kinds = ['invoice','receipt'] */
  O.invoice.send = function (b, kinds) {
    kinds = kinds || ['invoice', 'receipt'];
    var can = { invoice: true, receipt: !!b.paidAt };
    var ws = O.ws();
    var body = O.html('<div class="stack">' +
      '<div class="field"><label>Send by</label><div class="seg snd-via"><button type="button" data-v="WhatsApp" class="on">WhatsApp</button><button type="button" data-v="Email">Email</button></div></div>' +
      '<div class="field"><label>To</label><input class="input snd-to"></div>' +
      '<div class="field"><label>Attach</label><label class="check"><input type="checkbox" name="inv"' + (kinds.indexOf('invoice') >= 0 ? ' checked' : '') + '><span>Invoice ' + O.esc(b.invoiceNo) + ' (PDF)</span></label>' +
      '<label class="check"><input type="checkbox" name="rcp"' + (kinds.indexOf('receipt') >= 0 && can.receipt ? ' checked' : '') + (can.receipt ? '' : ' disabled') + '><span>Payment receipt ' + O.esc(b.receiptNo || '(created when payment arrives)') + ' (PDF)</span></label></div>' +
      '<div class="field"><label>Message</label><textarea class="textarea snd-msg" rows="4"></textarea></div></div>');
    var via = b.channel === 'direct' ? 'WhatsApp' : 'Email';
    function paint() {
      O.$$('.snd-via button', body).forEach(function (x) { x.classList.toggle('on', x.dataset.v === via); });
      O.$('.snd-to', body).value = via === 'WhatsApp' ? b.guest.phone : b.guest.email;
    }
    O.$('.snd-via', body).onclick = function (e) { var x = e.target.closest('button'); if (!x) return; via = x.dataset.v; paint(); };
    O.$('.snd-msg', body).value = 'Hi ' + b.guest.name.split(' ')[0] + ', thank you for booking ' + O.guestPlace(b).name + ' (' + d.fmtRange(b.checkIn, b.checkOut) + '). Your ' + (kinds.length > 1 ? 'invoice and payment receipt are' : kinds[0] === 'receipt' ? 'payment receipt is' : 'invoice is') + ' attached. — ' + ws.name;
    paint();
    U.modal({
      title: 'Send to ' + b.guest.name, sub: 'Booking ' + b.id + ' · total ' + O.fmt.money(b.total, { cur: b }), body: body,
      actions: [{ label: 'Cancel' }, {
        label: 'Send', kind: 'primary', onClick: function () {
          var inv = O.$('[name=inv]', body).checked, rcp = O.$('[name=rcp]', body).checked;
          if (!inv && !rcp) { U.toast('Choose at least one document', 'bad'); return false; }
          var stamp = { via: via, at: D.TODAY, time: D.NOW_TIME, to: O.$('.snd-to', body).value };
          if (inv) { b.invoiceSent = stamp; D.sentLog.unshift({ at: D.NOW, bookingId: b.id, kind: 'invoice', via: via, to: stamp.to, by: O.state.viewer }); }
          if (rcp) { b.receiptSent = stamp; D.sentLog.unshift({ at: D.NOW, bookingId: b.id, kind: 'receipt', via: via, to: stamp.to, by: O.state.viewer }); }
          U.toast((inv && rcp ? 'Invoice and receipt' : inv ? 'Invoice' : 'Receipt') + ' sent to ' + b.guest.name + ' on ' + via);
          O.emit('data', { type: 'sent', bookingId: b.id });
        }
      }]
    });
  };
  O.invoice.statusHTML = function (b, kind) {
    if (b.status === 'cancelled') return '<span class="pill neutral">Cancelled</span>';
    if (kind === 'receipt') { if (!b.paidAt) return '<span class="pill warn">Awaiting payment</span>'; return b.receiptSent ? '<span class="pill ok">Sent · ' + O.esc(b.receiptSent.via) + '</span>' : '<span class="pill info">Ready to send</span>'; }
    return b.invoiceSent ? '<span class="pill ok">Sent · ' + O.esc(b.invoiceSent.via) + '</span>' : '<span class="pill info">Ready to send</span>';
  };

  /* ---------------- booking drawer (used by every page) ---------------- */
  O.booking = {};
  /* buttons any page can add to the booking drawer: {label, icon, kind, show(b) -> bool, disabled(b) -> reason or '', run(b, close)}
     (Bookings adds Edit, Copy guest link, Cancel) */
  O.booking.actions = [];
  /* a booking from a platform through the channel manager: "From Booking.com · Reservation 4012345678" */
  O.booking.source = function (b) {
    if (!b || !b.channel || b.channel === 'direct' || !(b.reservationCode || b.channex || b.otaName)) return '';
    return 'From ' + U.platName(b.channel) + (b.reservationCode ? ' · Reservation ' + b.reservationCode : '');
  };
  /* "Double booking" and "Needs a unit" pills (booking.conflict from the channel manager, needsUnit from unit assignment) */
  O.booking.flags = function (b) {
    if (!b || b.status === 'cancelled') return '';
    var h = '';
    if (b.conflict && b.conflict.kind === 'double_booking') h += '<span class="pill bad" title="' + O.esc('Another booking or a block overlaps these nights' + (b.conflict.with && b.conflict.with.length ? ' (' + b.conflict.with.join(', ') + ')' : '') + '. Move one of them.') + '">Double booking</span>';
    if (b.unitTypeId && !b.propertyId) h += '<span class="pill warn" title="No single unit of the type is free for the whole stay. Pick one by hand.">Needs a unit</span>';
    return h;
  };
  O.booking.open = function (id) {
    var b = typeof id === 'string' ? D.booking(id) : id; if (!b) return;
    function place() { return D.propById[b.propertyId] || { id: b.propertyId, name: O.bookingPlace(b), short: 'Removed' }; }
    var p = place();
    function render() {
      p = place();
      var conv = D.conversations.filter(function (c) { return c.bookingId === b.id; })[0];
      var canMoney = O.can('bookings.value'), canCodes = O.can('guestapp.doorCodes'), canEdit = O.can('bookings.edit'), canContacts = O.can('bookings.contacts');
      var canInv = O.can('invoices'), canSend = O.can('invoices.send'), canPay = O.can('invoices.payments');
      var contact = canContacts ? ' · ' + O.esc(b.guest.phone || '') + ' · ' + O.esc(b.guest.email || '') : ' · <span title="Your access does not include guest contact details">contact details hidden</span>';
      var extra = O.booking.actions.filter(function (x) { try { return !x.show || x.show(b); } catch (e) { return false; } });
      return '<div class="stack">' +
        '<div class="row-flex wrap">' + U.status(b.status) + U.plat(b.channel) + (b.sameDay ? '<span class="pill accent">⚡ Same-day booking</span>' : '') + O.booking.flags(b) + '<span class="muted small">Booked ' + O.fmt.dateTime(b.createdAt) + '</span></div>' +
        (O.booking.source(b) ? '<div class="small muted bk-src">' + O.esc(O.booking.source(b)) + '</div>' : '') +
        (extra.length ? '<div class="row-flex wrap">' + extra.map(function (x, i) { var why = x.disabled ? x.disabled(b) : ''; return '<button class="btn btn-' + (x.kind || 'ghost') + ' btn-sm" data-extra="' + i + '"' + (why ? ' disabled title="' + O.esc(why) + '"' : '') + '>' + (x.icon ? O.icon(x.icon) : '') + O.esc(x.label) + '</button>'; }).join('') + '</div>' : '') +
        '<div class="card"><div class="card-body"><dl class="kv"><dt>Property</dt><dd>' + O.esc(p.area || p.location || p.city ? O.propLabel(p) : p.name) + '</dd><dt>Stay</dt><dd>' + d.fmtY(b.checkIn) + ' → ' + d.fmtY(b.checkOut) + '</dd><dt>Nights · guests</dt><dd>' + b.nights + ' · ' + b.guests + '</dd><dt>Check-in / out</dt><dd>' + O.fmt.time(b.checkInTime) + ' / ' + O.fmt.time(b.checkOutTime) + '</dd>' + (b.notes ? '<dt>Note</dt><dd>' + O.esc(b.notes) + '</dd>' : '') + '</dl></div></div>' +
        (b.status !== 'cancelled' && b.checkOut > D.TODAY ? '<div><div class="section-title" style="margin-top:0">Arrival readiness</div>' + O.readinessHTML(b) + '<div class="row-flex wrap" style="margin-top:8px">' + (!b.idVerified && canEdit ? '<button class="btn btn-ghost btn-sm" data-act="verify">Mark ID verified</button>' : '') + (canCodes ? '<button class="btn btn-ghost btn-sm" data-act="lock">' + O.icon('key') + 'Change door code</button><span class="small muted">Guest code <span class="kbd">' + O.esc(b.doorCode || '') + '</span></span>' : '') + '</div></div>' : '') +
        '<div><div class="section-title" style="margin-top:0">Guest</div><div class="row-flex">' + U.avatar(b.guest.name) + '<div class="grow"><div class="b">' + O.esc(b.guest.name) + '</div><div class="small muted">' + O.esc(b.guest.countryName || '') + contact + '</div></div>' + (conv && O.can('inbox') ? '<button class="btn btn-ghost btn-sm" data-act="chat">' + O.icon('chat') + 'Message</button>' : '') + '</div></div>' +
        (canMoney ? '<div><div class="section-title" style="margin-top:0">Payment</div><dl class="kv"><dt>' + b.nights + ' × ' + O.fmt.money(b.nightly, { cur: b }) + '</dt><dd>' + O.fmt.money(b.accommodation, { cur: b }) + '</dd><dt>Cleaning fee</dt><dd>' + O.fmt.money(b.cleaningFee, { cur: b }) + '</dd>' + (b.tourismTax ? '<dt>Tourism tax</dt><dd>' + O.fmt.money(b.tourismTax, { cur: b }) + '</dd>' : '') + '<dt class="tot">Guest paid</dt><dd class="tot">' + O.fmt.money(b.total, { cur: b }) + '</dd>' +
        (O.isOwner() ? '<dt>' + O.esc(U.platName(b.channel)) + ' fee</dt><dd>−' + O.fmt.money(b.platformFee, { cur: b }) + '</dd><dt class="tot">Payout</dt><dd class="tot">' + O.fmt.money(b.payout, { cur: b }) + '</dd>' : '') + '</dl></div>' : '') +
        (b.status !== 'cancelled' && canInv && canMoney ? '<div><div class="section-title" style="margin-top:0">Invoice &amp; receipt</div>' +
          '<div class="list-row"><div class="lr-main"><div class="lr-title">Invoice ' + O.esc(b.invoiceNo || '') + '</div><div class="lr-sub">Created automatically ' + d.fmtY(b.invoiceDate || b.checkIn) + '</div></div>' + O.invoice.statusHTML(b, 'invoice') + '<button class="btn btn-ghost btn-xs" data-act="inv">View</button></div>' +
          '<div class="list-row"><div class="lr-main"><div class="lr-title">Receipt ' + O.esc(b.receiptNo || '') + '</div><div class="lr-sub">' + (b.paidAt ? 'Created automatically when paid, ' + d.fmtY(b.paidAt) : 'Created automatically when payment arrives') + '</div></div>' + O.invoice.statusHTML(b, 'receipt') + (b.paidAt || canPay ? '<button class="btn btn-ghost btn-xs" data-act="rcp">' + (b.paidAt ? 'View' : 'Record payment') + '</button>' : '') + '</div>' +
          (canSend ? '<button class="btn btn-primary btn-sm" data-act="sendboth" style="margin-top:8px">' + O.icon('send') + 'Send invoice' + (b.paidAt ? ' and receipt' : '') + ' to guest</button>' : '') + '</div>' : '') +
        '</div>';
    }
    var dr = U.drawer({ titleHTML: O.esc(b.guest.name), subHTML: O.esc(b.id) + ' · ' + O.esc(p.name), body: render() });
    function wire() {
      O.$$('[data-extra]', dr.el).forEach(function (x) {
        x.onclick = function () { var list = O.booking.actions.filter(function (y) { try { return !y.show || y.show(b); } catch (e) { return false; } }), act = list[+x.dataset.extra]; if (act && !(act.disabled && act.disabled(b))) act.run(b, dr.close); };
      });
      O.$$('[data-act]', dr.el).forEach(function (x) {
        x.onclick = function () {
          var a = x.dataset.act;
          if (a === 'lock') O.lock.change({ bookingId: b.id });
          if (a === 'verify') { b.idVerified = true; if (b.codeStatus === 'held' && b.rulesAccepted) b.codeStatus = 'scheduled'; U.toast('ID verified for ' + b.guest.name + '. ' + (b.rulesAccepted ? 'The door code will be sent on schedule.' : 'The door code shows once they accept the house rules in the guest app.')); O.emit('data', { type: 'id' }); }
          if (a === 'chat') { dr.close(); O.go('inbox', { bookingId: b.id }); }
          if (a === 'inv') O.invoice.preview(b, 'invoice');
          if (a === 'rcp') O.invoice.preview(b, 'receipt');
          if (a === 'sendboth') O.invoice.send(b, b.paidAt ? ['invoice', 'receipt'] : ['invoice']);
        };
      });
    }
    wire();
    var off = O.on('data', function () { if (!document.body.contains(dr.el)) { off(); return; } O.$('.modal-body', dr.el).innerHTML = render(); wire(); });
    return dr;
  };

  /* ===================================================================
     STAFF ACCESS: one catalogue of sections and the actions inside each.
     O.can('bookings')            -> may open Bookings (view)
     O.can('bookings', 'edit')    -> section level is Edit
     O.can('bookings.create')     -> an action ('do' actions also need the section at Edit; 'see' actions need View)
     Account owners can do everything. Financials and a few actions stay with owners and cannot be granted.
     Role defaults live in D.rolePerms (saved); per-person changes in D.staffMeta[id].overrides
     ({'section:inbox': 'none'|'view'|'edit', 'tasks.assign': true|false}).
     =================================================================== */
  O.ROLES = [['owner', 'Account owner'], ['ops', 'Ops manager'], ['housekeeping', 'Housekeeping'], ['frontdesk', 'Front desk'], ['maintenance', 'Maintenance'], ['accountant', 'Accountant']];
  /* [id, label, actions: [key, label, description, 'do'|'see', ownerOnly?]] — the order is the order in Staff Access */
  O.PERMS = [
    ['dashboard', 'Dashboard', [['money', 'See money on the dashboard', 'Revenue and payouts in the summary and the read-aloud brief', 'see'], ['readAloud', 'Use the read-aloud brief', 'Listen to a spoken summary of the day', 'see']]],
    ['statistics', 'Statistics', [['money', 'See revenue, ADR and RevPAR', 'When off, only occupancy, stays and ratings show', 'see'], ['export', 'Download statistics', 'CSV and PDF exports', 'see']]],
    ['bookings', 'Bookings', [['create', 'Add bookings', 'Direct and walk-in bookings', 'do'], ['edit', 'Edit bookings', 'Dates, guests, times and notes', 'do'], ['cancel', 'Cancel bookings', '', 'do'], ['contacts', 'See guest phone and email', 'When off, contact details are masked', 'see'], ['value', 'See booking value', 'Totals, payouts and platform fees', 'see'], ['export', 'Download bookings', 'CSV export', 'see']]],
    ['calendar', 'Calendar', [['block', 'Block and unblock dates', 'Owner stays and maintenance blocks', 'do']]],
    ['reviews', 'Reviews', [['reply', 'Reply to reviews', 'Public replies on every platform', 'do']]],
    ['inbox', 'Guest inbox', [['send', 'Message guests', 'Reply on WhatsApp, email and platforms', 'do'], ['notes', 'Write internal notes', 'Notes only the team sees', 'do'], ['quickReplies', 'Edit quick replies', 'Saved replies for the whole team', 'do']]],
    ['tasks', 'Tasks & cleaning', [['create', 'Create tasks', '', 'do'], ['assign', 'Assign tasks to others', 'Create tasks for others and reassign them', 'do'], ['others', 'See other people\'s tasks', 'When off, people see only their own tasks', 'see'], ['delete', 'Delete tasks', '', 'do'], ['checklists', 'Edit checklist templates', 'Check-in, check-out and daily housekeeping lists', 'do']]],
    ['invoices', 'Invoices & receipts', [['send', 'Send invoices and receipts', 'To guests by WhatsApp or email', 'do'], ['payments', 'Record payments', 'Mark invoices paid', 'do'], ['settings', 'Change invoice settings', 'Numbering, tax and automatic sending', 'do']]],
    ['expenses', 'Expenses', [['record', 'Record their own expenses', 'Log what they spend and claim it back', 'do'], ['viewAll', 'See everyone\'s expenses', 'When off, people see only their own', 'see'], ['approve', 'Approve expense claims', 'Pay back staff who paid personally', 'do', true]]],
    ['financials', 'Financials', [], true],
    ['reports', 'Reports', [['money', 'Open financial reports', 'Revenue, profit and owner statements', 'see'], ['export', 'Download reports', 'CSV and PDF', 'see']]],
    ['website', 'Website builder', [['edit', 'Edit the website', 'Template, text and photos', 'do'], ['publish', 'Publish changes', '', 'do']]],
    ['guestapp', 'Guest app', [['edit', 'Edit the guest app', 'Guide, house rules, videos and services', 'do'], ['doorCodes', 'See and change door codes', 'Guest codes and master codes on smart locks', 'do'], ['requests', 'Handle guest requests', 'SIM cards, car rental, extra cleaning, damage reports', 'do']]],
    ['properties', 'Properties', [['create', 'Add properties', '', 'do'], ['edit', 'Edit property details', 'Name, address, rooms and owner', 'do'], ['access', 'See lock codes and Wi-Fi passwords', '', 'see'], ['archive', 'Archive properties', '', 'do']]],
    ['channels', 'Channels', [['connect', 'Connect and set up channels', 'Booking.com, Agoda, Airbnb, Expedia, Trip.com', 'do'], ['rates', 'Change rates and restrictions', 'Rates, minimum stay, stop sell, closed to arrival or departure', 'do'], ['sync', 'Send full updates', '', 'do']]],
    ['inventory', 'Inventory', [['in', 'Record stock in', 'Purchases and deliveries', 'do'], ['out', 'Record stock used', 'What was used, by whom, for which unit', 'do'], ['adjust', 'Correct stock counts', 'Stock takes and write-offs', 'do'], ['items', 'Add and edit items', 'The item list and reorder levels', 'do'], ['money', 'See stock costs', 'Purchase prices, stock value and spend', 'see']]],
    ['pricing', 'Pricing', [['change', 'Change prices', 'Apply suggested prices and edit nightly rates', 'do'], ['rules', 'Edit pricing rules', 'Minimums, weekend and event uplifts', 'do']]],
    ['automations', 'Automations', [['toggle', 'Turn automations on or off', '', 'do'], ['edit', 'Edit messages and rules', '', 'do']]],
    ['owner', 'Owner portal', [['statements', 'Send owner statements', '', 'do'], ['payouts', 'Approve owner payouts', '', 'do', true]]],
    ['staff', 'Staff access', [['invite', 'Invite people', '', 'do'], ['roles', 'Change roles and permissions', '', 'do', true]]],
    ['brand', 'Brand & setup', [['edit', 'Change logo and colours', '', 'do'], ['data', 'Load or reset demo data', '', 'do', true]]]
  ];
  var PERM_INDEX = {};
  O.PERMS.forEach(function (sec) { PERM_INDEX[sec[0]] = { label: sec[1], ownerOnly: !!sec[3], actions: {} }; sec[2].forEach(function (a) { PERM_INDEX[sec[0]].actions[a[0]] = { label: a[1], desc: a[2], kind: a[3], ownerOnly: !!a[4] }; }); });
  O.permInfo = function (key) { var i = key.indexOf('.'); if (i < 0) return PERM_INDEX[key] || null; var sec = PERM_INDEX[key.slice(0, i)]; return sec ? sec.actions[key.slice(i + 1)] || null : null; };
  var PERM_ALIAS = { assignTasks: 'tasks.assign', recordExpenses: 'expenses.record', approveClaims: 'expenses.approve', changeDoorCodes: 'guestapp.doorCodes', sendInvoices: 'invoices.send', messageGuests: 'inbox.send', replyReviews: 'reviews.reply', editPricing: 'pricing.change', seeGuestContacts: 'bookings.contacts' };
  var LV = { none: 0, view: 1, edit: 2 };
  function roleDefaults(sections, actions) {
    var out = { sections: {}, actions: {} };
    O.PERMS.forEach(function (sec) { out.sections[sec[0]] = sec[3] ? 'none' : (sections[sec[0]] || 'none'); sec[2].forEach(function (a) { var k = sec[0] + '.' + a[0]; out.actions[k] = !a[4] && !!actions[k]; }); });
    return out;
  }
  function all(keys) { var o = {}; keys.split(' ').forEach(function (k) { o[k] = true; }); return o; }
  O.DEFAULT_ROLE_PERMS = {
    ops: roleDefaults({ dashboard: 'edit', statistics: 'view', bookings: 'edit', calendar: 'edit', reviews: 'edit', inbox: 'edit', tasks: 'edit', invoices: 'edit', expenses: 'edit', reports: 'view', website: 'edit', guestapp: 'edit', properties: 'edit', channels: 'edit', inventory: 'edit', pricing: 'edit', automations: 'edit', owner: 'view', staff: 'view', brand: 'view' },
      all('dashboard.money dashboard.readAloud statistics.money statistics.export bookings.create bookings.edit bookings.cancel bookings.contacts bookings.value bookings.export calendar.block reviews.reply inbox.send inbox.notes inbox.quickReplies tasks.create tasks.assign tasks.others tasks.delete tasks.checklists invoices.send invoices.payments expenses.record expenses.viewAll reports.money reports.export website.edit website.publish guestapp.edit guestapp.doorCodes guestapp.requests properties.create properties.edit properties.access channels.connect channels.rates channels.sync inventory.in inventory.out inventory.adjust inventory.items inventory.money pricing.change pricing.rules automations.toggle automations.edit owner.statements staff.invite')),
    housekeeping: roleDefaults({ dashboard: 'view', bookings: 'view', calendar: 'view', inbox: 'edit', tasks: 'edit', expenses: 'edit', guestapp: 'edit', properties: 'view', inventory: 'edit' },
      all('dashboard.readAloud inbox.send inbox.notes tasks.create expenses.record guestapp.requests properties.access inventory.out')),
    frontdesk: roleDefaults({ dashboard: 'view', bookings: 'edit', calendar: 'edit', reviews: 'edit', inbox: 'edit', tasks: 'edit', pricing: 'view', channels: 'view', automations: 'view', invoices: 'edit', expenses: 'edit', guestapp: 'edit', properties: 'view', inventory: 'view' },
      all('dashboard.readAloud bookings.create bookings.edit bookings.cancel bookings.contacts bookings.value calendar.block reviews.reply inbox.send inbox.notes inbox.quickReplies tasks.create tasks.assign tasks.others invoices.send invoices.payments expenses.record guestapp.edit guestapp.doorCodes guestapp.requests properties.access')),
    maintenance: roleDefaults({ dashboard: 'view', calendar: 'view', inbox: 'view', tasks: 'edit', expenses: 'edit', properties: 'view', inventory: 'edit' },
      all('dashboard.readAloud tasks.create expenses.record properties.access inventory.out')),
    accountant: roleDefaults({ dashboard: 'view', statistics: 'view', bookings: 'view', invoices: 'edit', expenses: 'edit', reports: 'view', owner: 'view', inventory: 'view' },
      all('dashboard.money dashboard.readAloud statistics.money statistics.export bookings.contacts bookings.value bookings.export invoices.send invoices.payments invoices.settings expenses.record expenses.viewAll reports.money reports.export owner.statements inventory.money'))
  };
  D.rolePerms = D.rolePerms || JSON.parse(JSON.stringify(O.DEFAULT_ROLE_PERMS));
  function SM(id) { return (D.staffMeta || {})[id]; }
  O.sectionLevel = function (staffId, sec) {
    var s = D.staffById(staffId || O.state.viewer); if (!s) return 'none';
    var m = SM(s.id); if (m && m.status === 'suspended') return 'none';
    if (s.role === 'owner') return 'edit';
    if (PERM_INDEX[sec] && PERM_INDEX[sec].ownerOnly) return 'none';
    if (m && m.overrides && ('section:' + sec) in m.overrides) return m.overrides['section:' + sec] || 'none';
    var rp = D.rolePerms[s.role]; if (rp && rp.sections && !(sec in rp.sections)) rp = O.DEFAULT_ROLE_PERMS[s.role]; /* a section added after the role was saved */
    return (rp && rp.sections && rp.sections[sec]) || 'none';
  };
  O.can = function (key, level, staffId) {
    var s = D.staffById(staffId || O.state.viewer); if (!s) return false;
    var m = SM(s.id); if (m && m.status === 'suspended') return false;
    if (s.role === 'owner') return true;
    key = PERM_ALIAS[key] || key;
    var i = key.indexOf('.');
    if (i < 0) return LV[O.sectionLevel(s.id, key)] >= LV[level || 'view'];
    var info = O.permInfo(key); if (!info || info.ownerOnly) return false;
    var sec = key.slice(0, i), need = info.kind === 'do' ? 2 : 1;
    if (LV[O.sectionLevel(s.id, sec)] < need) return false;
    if (m && m.overrides && key in m.overrides) return !!m.overrides[key];
    var rp = D.rolePerms[s.role]; if (rp && rp.actions && !(key in rp.actions)) rp = O.DEFAULT_ROLE_PERMS[s.role]; /* an action added after the role was saved */
    return !!(rp && rp.actions && rp.actions[key]);
  };
  O.permLabel = function (key) { var info = O.permInfo(PERM_ALIAS[key] || key); return info ? info.label : key; };

  /* ===================================================================
     CLOCK — the app runs on real Malaysia time (UTC+8).
     Tests pin the clock with window.ORBIQUE_NOW = '2026-10-11T10:15' before the app loads.
     D.TODAY ('YYYY-MM-DD'), D.NOW ('YYYY-MM-DDTHH:MM') and D.NOW_TIME ('HH:MM') are kept current;
     'tick' fires every minute and 'day' when the date changes. Read them inside functions, never cache them at load.
     =================================================================== */
  O.clock = {
    now: function () { if (window.ORBIQUE_NOW) return String(window.ORBIQUE_NOW).slice(0, 16); return new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 16); },
    apply: function () { var n = O.clock.now(), day = D.TODAY !== n.slice(0, 10); D.NOW = n; D.TODAY = n.slice(0, 10); D.NOW_TIME = n.slice(11, 16); return day; },
    start: function () {
      if (O.clock._t) return;
      O.clock._t = setInterval(function () {
        var before = D.NOW, newDay = O.clock.apply();
        if (D.NOW === before) return;
        if (newDay) { O.rollStatuses(); O.automation.run('day'); O.emit('day'); O.emit('data'); }
        O.emit('tick');
      }, 15000);
    }
  };

  /* every date or date-time string inside the demo moves by `days` (also object keys that are dates) */
  var DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?)?$/;
  function shiftStr(v, days) { return O.d.add(v.slice(0, 10), days) + v.slice(10); }
  O.shiftDates = function (root, days, seen) {
    if (!days || !root || typeof root !== 'object') return root;
    seen = seen || new WeakSet(); if (seen.has(root)) return root; seen.add(root);
    if (Array.isArray(root)) { for (var i = 0; i < root.length; i++) { var v = root[i]; if (typeof v === 'string' && DATE_RE.test(v)) root[i] = shiftStr(v, days); else if (v && typeof v === 'object') O.shiftDates(v, days, seen); } return root; }
    Object.keys(root).forEach(function (k) {
      var v = root[k];
      if (typeof v === 'string' && DATE_RE.test(v)) v = root[k] = shiftStr(v, days);
      else if (v && typeof v === 'object') O.shiftDates(v, days, seen);
      if (DATE_RE.test(k)) { delete root[k]; root[shiftStr(k, days)] = v; }
    });
    return root;
  };

  /* bookings move along as time passes: confirmed -> in-house after the check-in day, -> checked out after check-out time */
  O.rollStatuses = O.unscopedFn(function () {
    var N = D.NOW, T = D.TODAY;
    D.bookings.forEach(function (b) {
      if (b.status !== 'confirmed' && b.status !== 'checked_in') return;
      if (N >= b.checkOut + 'T' + (b.checkOutTime || '11:00')) { b.status = 'checked_out'; if (b.codeStatus && b.codeStatus !== 'cancelled') b.codeStatus = 'expired'; }
      else if (b.status === 'confirmed' && b.checkIn < T) b.status = 'checked_in';
    });
  });


  /* background jobs (create turnover tasks, reminders...). Pages register at load:
     O.automation.register('turnovers', function (reason) { ...mutate D in place, deterministic ids so two devices never duplicate... })
     They run once the data has loaded, on every new day, and when O.automation.run() is called. Keep them idempotent. */
  var JOBS = [];
  O.automation = {
    register: function (name, fn) { JOBS = JOBS.filter(function (j) { return j[0] !== name; }); JOBS.push([name, fn]); },
    run: function (reason) { if (!O.sync.canWrite()) return; O.unscoped(function () { JOBS.forEach(function (j) { try { j[1](reason || 'manual'); } catch (e) { console.error('automation ' + j[0], e); } }); }); }
  };

  /* ===================================================================
     SYNC — saves every change for the whole team.
     Pages keep working the old way: change D in place, then O.emit('data'). A short moment later the sync
     compares every registered collection with what was last saved and writes only what changed.
     Changes from other people arrive the same way and re-render the page (held while someone is typing).
       record collections: arrays of objects with an `id` (bookings, tasks...) — saved one row per record
       blob collections: any other JSON value (settings objects, logs) — saved as one row
     Register a NEW collection at module load, before boot:  O.sync.records('invCounts', 'demo')  /  O.sync.blob('inventorySettings', 'config')
       'demo'   = belongs to the demo; a fresh workspace starts with it empty
       'config' = defaults that a fresh workspace keeps (checklists, item list, settings)
     Never replace a registered array (D.x = [...]) after boot — mutate it (push / splice / length = 0).
     Backends ("adapters"): local (this browser, over the built-in demo) and server (Supabase, see app/server/auth.js).
     adapter = {name, replace (true: the backend holds the whole workspace), load() -> {rows:[{coll,id,data,deleted}], blobs:[{key,data}], readOnly},
                write({rows, blobs}) -> {rejected:[{coll,id}|{key}], readOnly}  (reject the promise only for network/server errors),
                subscribe(cb(rows, blobs)) -> unsubscribe}
     =================================================================== */
  var REG = {}; /* key -> {type:'records'|'blob', kind:'demo'|'config', cap} */
  function canon(v) { /* stable JSON: sorted keys, so the server's key order never looks like a change */
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).filter(function (k) { return v[k] !== undefined && typeof v[k] !== 'function'; }).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }
  var S = O.sync = {
    canon: canon,
    adapter: null, status: 'starting', started: false, readOnly: false, error: null,
    records: function (key, kind) { REG[key] = { type: 'records', kind: kind || 'demo' }; },
    blob: function (key, kind, cap) { REG[key] = { type: 'blob', kind: kind || 'config', cap: cap || 0 }; },
    registered: function () { return REG; },
    use: function (adapter) { S.adapter = adapter; },
    canWrite: function () { return S.started && !S.readOnly; },
    /* {records: {key: {id: canon}}, blobs: {key: canon}} as last saved / loaded */
    last: { records: {}, blobs: {} },
    pending: false, pendingRemote: false, _timer: null, _writing: null, _demo: null
  };
  ['bookings', 'blocks', 'tasks', 'reviews', 'conversations', 'quickReplies', 'expenses', 'staff', 'properties', 'buildings', 'unitTypes', 'invMoves', 'guestRequests', 'damageReports', 'staffInvites', 'ownerMessages'].forEach(function (k) { S.records(k, 'demo'); });
  ['invItems', 'checklists'].forEach(function (k) { S.records(k, 'config'); });
  ['lockLog', 'sentLog', 'auditLog', 'priceLog'].forEach(function (k) { REG[k] = { type: 'blob', kind: 'demo', cap: 500 }; });
  ['priceOverrides', 'priceOverrideMeta', 'pricingRules', 'ownerPayouts', 'staffMeta'].forEach(function (k) { REG[k] = { type: 'blob', kind: 'demo' }; });
  /* channel manager (pages/channels.js): rate plans per unit type, rates and restrictions per plan and month, and in practice
     mode the connections (channelSim) and what would have been sent (channelLog, newest first) */
  ['ratePlans', 'channelRates'].forEach(function (k) { S.records(k, 'demo'); });
  REG.channelLog = { type: 'blob', kind: 'demo', cap: 500 };
  REG.channelSim = { type: 'blob', kind: 'demo' };
  ['rolePerms', 'automations', 'invoiceSettings', 'guestApp', 'website', 'expenseTypes', 'workspaceBrand', 'workspaceMeta', 'invCats', 'inboxSettings', 'alertSettings'].forEach(function (k) { REG[k] = { type: 'blob', kind: 'config' }; });

  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function capBlob(key, v) { var r = REG[key]; return r && r.cap && Array.isArray(v) && v.length > r.cap ? v.slice(0, r.cap) : v; }
  function snapshotAll() {
    var out = { records: {}, blobs: {} };
    Object.keys(REG).forEach(function (k) {
      var r = REG[k];
      if (r.type === 'records') { var m = out.records[k] = {}; (D[k] || []).forEach(function (x) { if (x && x.id != null) m[String(x.id)] = canon(x); }); }
      else if (D[k] !== undefined) out.blobs[k] = canon(capBlob(k, D[k]));
    });
    return out;
  }
  O.reindex = function () { O.unscoped(reindex); };
  function reindex() { /* D.propById / D.itemById follow D.properties / D.invItems (same objects) */
    Object.keys(D.propById).forEach(function (k) { delete D.propById[k]; }); D.properties.forEach(function (p) { D.propById[p.id] = p; });
    if (D.itemById) { Object.keys(D.itemById).forEach(function (k) { delete D.itemById[k]; }); D.invItems.forEach(function (x) { D.itemById[x.id] = x; }); }
  };
  /* apply rows from a backend: rows = [{coll, id, data, deleted}], blobs = [{key, data}] */
  function applyRows(rows, blobs) {
    var touched = false;
    (rows || []).forEach(function (row) {
      var r = REG[row.coll]; if (!r || r.type !== 'records') return;
      var arr = Array.isArray(D[row.coll]) ? D[row.coll] : (D[row.coll] = []), idx = -1;
      for (var i = 0; i < arr.length; i++) if (String(arr[i].id) === String(row.id)) { idx = i; break; }
      var lastMap = S.last.records[row.coll] = S.last.records[row.coll] || {};
      if (row.deleted || !row.data) { if (idx >= 0) { arr.splice(idx, 1); touched = true; } delete lastMap[String(row.id)]; return; }
      var c = canon(row.data);
      if (idx >= 0 && canon(arr[idx]) === c) { lastMap[String(row.id)] = c; return; }
      var obj = clone(row.data);
      if (idx >= 0) { /* keep the same object so references held by pages stay valid */ var cur = arr[idx]; Object.keys(cur).forEach(function (k) { delete cur[k]; }); Object.assign(cur, obj); } else arr.push(obj);
      lastMap[String(row.id)] = c; touched = true;
    });
    (blobs || []).forEach(function (b) {
      if (!REG[b.key] || REG[b.key].type !== 'blob') return;
      var c = canon(b.data);
      if (S.last.blobs[b.key] === c && canon(capBlob(b.key, D[b.key])) === c) return;
      var v = clone(b.data), cur = D[b.key];
      if (cur && v && typeof cur === 'object' && typeof v === 'object' && Array.isArray(cur) === Array.isArray(v)) {
        if (Array.isArray(cur)) { cur.length = 0; Array.prototype.push.apply(cur, v); } else { Object.keys(cur).forEach(function (k) { delete cur[k]; }); Object.assign(cur, v); }
      } else D[b.key] = v;
      S.last.blobs[b.key] = c; touched = true;
    });
    if (touched) O.reindex();
    return touched;
  }
  function diff() {
    var rows = [], blobs = [];
    Object.keys(REG).forEach(function (k) {
      var r = REG[k];
      if (r.type === 'records') {
        var lastMap = S.last.records[k] = S.last.records[k] || {}, seen = {};
        (D[k] || []).forEach(function (x) {
          if (!x || typeof x !== 'object') return;
          if (x.id == null || x.id === '') x.id = O.uid(k.slice(0, 2).toUpperCase());
          var id = String(x.id), c = canon(x); seen[id] = 1;
          if (lastMap[id] !== c) { rows.push({ coll: k, id: id, data: JSON.parse(c), deleted: false }); lastMap[id] = c; }
        });
        Object.keys(lastMap).forEach(function (id) { if (!seen[id]) { rows.push({ coll: k, id: id, data: null, deleted: true }); delete lastMap[id]; } });
      } else if (D[k] !== undefined) {
        var v = capBlob(k, D[k]), c = canon(v);
        if (S.last.blobs[k] !== c) { blobs.push({ key: k, data: JSON.parse(c) }); S.last.blobs[k] = c; }
      }
    });
    return { rows: rows, blobs: blobs };
  }
  snapshotAll = O.unscopedFn(snapshotAll); applyRows = O.unscopedFn(applyRows); diff = O.unscopedFn(diff);
  function setStatus(st, err) { S.status = st; S.error = err || null; O.emit('sync'); }
  S.flush = function () {
    clearTimeout(S._timer); S._timer = null;
    if (!S.started || !S.adapter) return Promise.resolve();
    if (S._writing) { S.pending = true; return S._writing; }
    var batch = diff();
    if (!batch.rows.length && !batch.blobs.length) return Promise.resolve();
    if (S.readOnly) { setStatus('readonly'); return Promise.resolve(); }
    setStatus('saving');
    /* adapter.write resolves {rejected: [{coll, id} | {key}], readOnly} — rows the server refused (no permission) are not retried */
    S._writing = Promise.resolve().then(function () { return S.adapter.write(batch); }).then(function (res) {
      S._writing = null;
      if (res && res.readOnly) { S.readOnly = true; setStatus('readonly'); U.toast('This workspace is view only right now, so changes are not saved.'); return; }
      if (res && res.rejected && res.rejected.length) U.toast('Some changes were not saved because your access does not allow them (' + res.rejected.map(function (r) { return r.coll || r.key; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ') + ').', 'bad');
      setStatus(S.adapter.name === 'local' ? 'local' : 'saved');
      /* 'synced': this batch is saved (the channel manager sends what changed); {colls, blobs} name what it touched */
      var colls = [], keys = [];
      batch.rows.forEach(function (r) { if (colls.indexOf(r.coll) < 0) colls.push(r.coll); });
      batch.blobs.forEach(function (b) { if (keys.indexOf(b.key) < 0) keys.push(b.key); });
      O.emit('synced', { colls: colls, blobs: keys, adapter: S.adapter.name });
      if (S.pending) { S.pending = false; return S.flush(); }
    }, function (e) {
      S._writing = null; console.error('save failed', e);
      if (e && (e.code === 'forbidden' || e.code === 'invalid_argument' || e.code === 'not_granted')) { S.readOnly = true; setStatus('readonly'); U.toast('You can view this workspace but not change it, so this change was not saved.'); return; }
      /* put the batch back so the next attempt sends it again */
      batch.rows.forEach(function (r) { var m = S.last.records[r.coll] = S.last.records[r.coll] || {}; if (r.deleted) m[r.id] = '__retry__'; else delete m[r.id]; });
      batch.blobs.forEach(function (b) { delete S.last.blobs[b.key]; });
      if (e && e.code === 'quota' && !S._quotaWarned) { S._quotaWarned = true; U.toast('This browser has run out of space for saved changes (photos take the most room). Remove some photos, or use the online version of Orbique.', 'bad'); }
      setStatus('error', e && e.message); S._timer = setTimeout(S.flush, 8000);
    });
    return S._writing;
  };
  S.schedule = function () { if (!S.started) return; clearTimeout(S._timer); S._timer = setTimeout(S.flush, 400); };
  O.on('data', function () { S.schedule(); });
  /* remote changes: apply now, re-render when nobody is typing or has a window open */
  function busy() { var a = document.activeElement; return !!(O.$('.modal-back, .drawer') || (a && a !== document.body && /INPUT|TEXTAREA|SELECT/.test(a.tagName) || (a && a.isContentEditable))); }
  S.remote = function (rows, blobs) {
    if (!applyRows(rows, blobs)) return;
    if (busy()) { S.pendingRemote = true; return; }
    O.emit('remote'); O.emit('data');
  };
  setInterval(function () { if (S.pendingRemote && !busy()) { S.pendingRemote = false; O.emit('remote'); O.emit('data'); } }, 1200);
  window.addEventListener('beforeunload', function (e) { if (S._writing || S._timer) { S.flush(); e.preventDefault(); e.returnValue = ''; } });

  /* the built-in demo, kept so a fresh workspace can load it later (server mode) */
  S.captureDemo = O.unscopedFn(function () {
    var out = {}; Object.keys(REG).forEach(function (k) { if (REG[k].kind === 'demo' && D[k] !== undefined) out[k] = clone(D[k]); });
    S._demo = out; return out;
  });
  /* start: load from the adapter, merge, remember what is saved, then keep saving */
  S.start = function () {
    var A = S.adapter || (S.adapter = O.localAdapter());
    setStatus('loading');
    return Promise.resolve(A.load()).then(O.unscopedFn(function (res) {
      res = res || {};
      if (A.replace) {
        /* the server holds the whole workspace: start from empty demo collections and defaults */
        var hasRows = {}; (res.rows || []).forEach(function (r) { hasRows[r.coll] = 1; });
        Object.keys(REG).forEach(function (k) {
          var r = REG[k];
          if (r.type === 'records' && (r.kind === 'demo' || hasRows[k])) { if (Array.isArray(D[k])) D[k].length = 0; else D[k] = []; }
          else if (r.type === 'blob' && r.kind === 'demo') { var v = D[k]; if (Array.isArray(v)) v.length = 0; else if (v && typeof v === 'object') Object.keys(v).forEach(function (x) { delete v[x]; }); }
        });
      }
      O.clock.apply(); O.rollStatuses(); /* the demo's own status changes are not saved, only real edits */
      S.last = snapshotAll();
      applyRows((res.rows || []).filter(function (r) { return !r.deleted || !A.replace; }), res.blobs || []);
      O.reindex();
      S.readOnly = !!res.readOnly;
      S.started = true;
      setStatus(A.name === 'local' ? 'local' : S.readOnly ? 'readonly' : 'saved');
      if (A.subscribe) S._unsub = A.subscribe(S.remote);
      SC.ver++;
    }));
  };

  /* local adapter: this browser's storage, layered over the built-in demo. Other tabs see changes through 'storage' events. */
  O.localAdapter = function () {
    var P = 'orbique4:db:';
    function readAll() {
      var rows = [], blobs = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i); if (k.indexOf(P) !== 0) continue;
          var rest = k.slice(P.length), v = JSON.parse(localStorage.getItem(k));
          if (rest.indexOf('rec:') === 0) { var coll = rest.slice(4); Object.keys(v).forEach(function (id) { rows.push(v[id] === null ? { coll: coll, id: id, deleted: true } : { coll: coll, id: id, data: v[id] }); }); }
          else if (rest.indexOf('blob:') === 0) blobs.push({ key: rest.slice(5), data: v });
        }
      } catch (e) { /* storage blocked: the app still runs, nothing is kept */ }
      return { rows: rows, blobs: blobs };
    }
    return {
      name: 'local', replace: false,
      load: function () { return readAll(); },
      write: function (batch) {
        try {
          var byColl = {};
          batch.rows.forEach(function (r) { (byColl[r.coll] = byColl[r.coll] || []).push(r); });
          Object.keys(byColl).forEach(function (coll) {
            var key = P + 'rec:' + coll, cur = JSON.parse(localStorage.getItem(key) || '{}');
            byColl[coll].forEach(function (r) { cur[r.id] = r.deleted ? null : r.data; });
            localStorage.setItem(key, JSON.stringify(cur));
          });
          batch.blobs.forEach(function (b) { localStorage.setItem(P + 'blob:' + b.key, JSON.stringify(b.data)); });
        } catch (e) { return Promise.reject({ code: 'quota', message: 'This browser is out of storage space' }); }
        return Promise.resolve();
      },
      subscribe: function (cb) {
        function on(e) {
          if (!e.key || e.key.indexOf(P) !== 0 || e.newValue == null) return;
          var rest = e.key.slice(P.length), v = JSON.parse(e.newValue);
          if (rest.indexOf('rec:') === 0) { var coll = rest.slice(4); cb(Object.keys(v).map(function (id) { return v[id] === null ? { coll: coll, id: id, deleted: true } : { coll: coll, id: id, data: v[id] }; }), []); }
          else if (rest.indexOf('blob:') === 0) cb([], [{ key: rest.slice(5), data: v }]);
        }
        window.addEventListener('storage', on);
        return function () { window.removeEventListener('storage', on); };
      },
      /* wipe this browser's saved changes (back to the demo) */
      reset: function () { try { Object.keys(localStorage).filter(function (k) { return k.indexOf(P) === 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {} }
    };
  };

  /* ===================================================================
     GUEST APP DATA — one booking's guest-facing view, reached with the booking's guestToken.
     guestapp.js defines O.guestApi.get / .act for this browser (local mode); auth.js swaps in the server
     version (Supabase RPC guest_get / guest_act) so real guests can use it without signing in.
     =================================================================== */
  O.guestApi = O.guestApi || null;
  O.guestToken = function () {
    var h = (location.hash || '').replace(/^#/, ''), m = h.match(/^guest-([A-Za-z0-9_.~-]+)$/);
    if (m) return m[1];
    var p = (location.pathname || '').match(/\/guest\/([A-Za-z0-9_.~-]+)\/?$/);
    return p ? p[1] : null;
  };
  /* the link a guest opens: production /guest/<token>; in a local file #guest-<token> */
  O.guestLink = function (b) {
    O.bookingDefaults(b);
    var base = O.APP_URL || (location.origin && location.origin !== 'null' && !/^file:/.test(location.href) ? location.origin : '');
    return base && !/claude\.ai/.test(base) ? base.replace(/\/$/, '') + '/guest/' + b.guestToken : (base || location.href.split('#')[0]) + '#guest-' + b.guestToken;
  };

  /* ===================================================================
     READ ALOUD (Jarvis-style brief). O.voice.speak(text, {onend, onboundary}) / O.voice.stop() / O.voice.available()
     Uses the browser's built-in speech; prefers a calm British or Malaysian English voice.
     =================================================================== */
  O.voice = {
    available: function () { return 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function'; },
    pick: function () {
      if (!O.voice.available()) return null;
      var vs = speechSynthesis.getVoices() || [], pref = [/en-GB.*(Daniel|Arthur|George|Male)/i, /Google UK English Male/i, /en-GB/i, /en-MY|en-SG|en-IN/i, /en-AU/i, /en-US/i, /^en/i];
      for (var i = 0; i < pref.length; i++) { var v = vs.filter(function (x) { return pref[i].test(x.lang + ' ' + x.name); })[0]; if (v) return v; }
      return vs[0] || null;
    },
    speak: function (text, o) {
      o = o || {}; if (!O.voice.available()) { if (o.onend) o.onend(false); return false; }
      O.voice.stop();
      /* text: one string (split into sentences) or an array of sentences (kept as given, so "4.5" is not split) */
      var parts = Array.isArray(text) ? text.filter(function (x) { return String(x).trim(); }) : (String(text).match(/(?:\d\.\d|[^.!?])+[.!?]*/g) || [text]), i = 0, started = false;
      /* each read-aloud ends exactly once (finish), also when stopped; a cancelled sentence's late onerror must not
         carry the old chain on into a newer read-aloud */
      var me = O.voice._run = (O.voice._run || 0) + 1, job = O.voice._job = { o: o, over: false };
      O.voice._on = true;
      function next() {
        if (me !== O.voice._run) return;
        if (i >= parts.length) { O.voice._finish(job, true); return; }
        var u = new SpeechSynthesisUtterance(parts[i].trim()), v = O.voice.pick();
        if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-GB';
        u.rate = o.rate || 1.02; u.pitch = o.pitch || 0.95;
        var idx = i; u.onstart = function () { if (!started) { started = true; if (o.onstart) o.onstart(); } if (o.onpart) o.onpart(idx, parts.length); };
        u.onend = function () { i++; next(); }; u.onerror = function () { i++; next(); };
        speechSynthesis.speak(u);
      }
      next(); return true;
    },
    stop: function () {
      O.voice._run = (O.voice._run || 0) + 1;
      var j = O.voice._job; O.voice._job = null; O.voice._on = false;
      try { speechSynthesis.cancel(); } catch (e) {}
      O.voice._finish(j, true);
    },
    _finish: function (j, ok) {
      if (!j || j.over) return;
      j.over = true;
      if (O.voice._job === j) { O.voice._job = null; O.voice._on = false; }
      if (j.o.onend) { try { j.o.onend(ok); } catch (e) { if (window.console) console.error(e); } }
    },
    speaking: function () { return !!O.voice._on; },
    /* true once the device has at least one voice (some phones load them a moment after the page) */
    hasVoices: function () { try { return O.voice.available() && speechSynthesis.getVoices().length > 0; } catch (e) { return false; } }
  };
  if (O.voice.available()) { try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = function () {}; } catch (e) {} }

  /* ===================================================================
     I18N (menu + page titles; pages render in English)
     =================================================================== */
  O.LANGS = [['en', 'English', 'EN'], ['bn', 'বাংলা', 'Bangla'], ['ms', 'Bahasa Malaysia', 'MS'], ['zh', '中文（福建話）', 'Hokkien']];
  var NAV_I18N = {
    en: { overview: 'Overview', operate: 'Operate', insights: 'Insights', finance: 'Finance', grow: 'Grow', manage: 'Manage', dashboard: 'Dashboard', bookings: 'Bookings', calendar: 'Calendar', reviews: 'Reviews', inbox: 'Guest Inbox', tasks: 'Tasks & Cleaning', statistics: 'Statistics', reports: 'Reports', invoices: 'Invoices & Receipts', expenses: 'Expenses', financials: 'Financials', website: 'Website Builder', guestapp: 'Guest App', properties: 'Properties', channels: 'Channels', inventory: 'Inventory', pricing: 'Pricing', automations: 'Automations', owner: 'Owner Portal', staff: 'Staff Access', brand: 'Brand & Setup', more: 'More', home: 'Home', platform: 'Platform admin' },
    bn: { overview: 'ওভারভিউ', operate: 'পরিচালনা', insights: 'বিশ্লেষণ', finance: 'ফাইন্যান্স', grow: 'প্রবৃদ্ধি', manage: 'ব্যবস্থাপনা', dashboard: 'ড্যাশবোর্ড', bookings: 'বুকিং', calendar: 'ক্যালেন্ডার', reviews: 'রিভিউ', inbox: 'গেস্ট ইনবক্স', tasks: 'কাজ ও পরিষ্কার', statistics: 'পরিসংখ্যান', reports: 'রিপোর্ট', invoices: 'ইনভয়েস ও রসিদ', expenses: 'খরচ', financials: 'আর্থিক হিসাব', website: 'ওয়েবসাইট নির্মাতা', guestapp: 'গেস্ট অ্যাপ', properties: 'প্রপার্টি', channels: 'চ্যানেল', inventory: 'ইনভেন্টরি', pricing: 'মূল্য নির্ধারণ', automations: 'স্বয়ংক্রিয়তা', owner: 'মালিক পোর্টাল', staff: 'স্টাফ অ্যাক্সেস', brand: 'ব্র্যান্ড ও সেটআপ', more: 'আরও', home: 'হোম', platform: 'প্ল্যাটফর্ম অ্যাডমিন' },
    ms: { overview: 'Gambaran', operate: 'Operasi', insights: 'Analisis', finance: 'Kewangan', grow: 'Perkembangan', manage: 'Pengurusan', dashboard: 'Papan Pemuka', bookings: 'Tempahan', calendar: 'Kalendar', reviews: 'Ulasan', inbox: 'Peti Masuk Tetamu', tasks: 'Tugasan & Pembersihan', statistics: 'Statistik', reports: 'Laporan', invoices: 'Invois & Resit', expenses: 'Perbelanjaan', financials: 'Penyata Kewangan', website: 'Pembina Laman Web', guestapp: 'Aplikasi Tetamu', properties: 'Hartanah', channels: 'Saluran', inventory: 'Inventori', pricing: 'Harga', automations: 'Automasi', owner: 'Portal Pemilik', staff: 'Akses Kakitangan', brand: 'Jenama & Persediaan', more: 'Lagi', home: 'Utama', platform: 'Pentadbir platform' },
    zh: { overview: '总览', operate: '营运', insights: '分析', finance: '财务', grow: '拓展', manage: '管理', dashboard: '仪表板', bookings: '订单', calendar: '日历', reviews: '评价', inbox: '住客收件箱', tasks: '任务与清洁', statistics: '统计', reports: '报表', invoices: '发票与收据', expenses: '支出', financials: '财务报表', website: '网站建设器', guestapp: '住客应用', properties: '房源', channels: '渠道', inventory: '库存', pricing: '定价', automations: '自动化', owner: '业主门户', staff: '员工权限', brand: '品牌与设置', more: '更多', home: '首页', platform: '平台管理' }
  };
  O.t = function (key) { return (NAV_I18N[O.state.lang] || NAV_I18N.en)[key] || NAV_I18N.en[key] || key; };

  /* ===================================================================
     ROUTER + SHELL
     =================================================================== */
  O.NAV = [
    ['overview', ['dashboard', 'bookings', 'calendar', 'reviews']],
    ['operate', ['inbox', 'tasks']],
    ['insights', ['statistics', 'reports']],
    ['finance', ['invoices', 'expenses', 'financials']],
    ['grow', ['website', 'guestapp']],
    ['manage', ['properties', 'channels', 'inventory', 'pricing', 'automations', 'owner', 'staff', 'brand']]
  ];
  O.OWNER_ONLY = { financials: true };
  O.allowed = function (id) { if (O.EXTRA_PAGES && O.EXTRA_PAGES[id]) return O.EXTRA_PAGES[id].allowed ? O.EXTRA_PAGES[id].allowed() : true; return O.OWNER_ONLY[id] ? O.isOwner() : O.can(id, 'view'); };
  /* pages outside the menu groups (e.g. the platform admin area added by auth.js): {id: {allowed: fn}} */
  O.EXTRA_PAGES = O.EXTRA_PAGES || {};
  O.pages = {};
  O.page = function (id, def) { O.pages[id] = def; if (O._started && O.state.page === id) O.render(); };
  var cleanup = [], current = { id: null, params: {} };
  O.go = function (id, params) {
    current = { id: id, params: params || {} };
    O.state.page = id; O.store.set('page', id);
    O.render(true);
    window.scrollTo(0, 0);
    closeSide(); paintTabs();
  };
  var held = false, deferred = false;
  O.render = function (fresh) {
    if (!O._started) return;
    var id = current.id || O.state.page, def = O.pages[id];
    cleanup.forEach(function (f) { try { f(); } catch (e) {} }); cleanup = [];
    O.$$('.nav-item').forEach(function (n) { n.classList.toggle('active', n.dataset.page === id); });
    var root = O.$('#page-root'), actions = O.$('#tb-actions');
    O.$('#tb-title').textContent = O.t(id);
    O.$('#tb-desc').textContent = (def && def.desc) || '';
    document.title = O.t(id) + ' · ' + O.ws().name;
    actions.innerHTML = '';
    root.className = 'page-root';
    if (O.OWNER_ONLY[id] && !O.isOwner()) { root.innerHTML = U.locked(O.t(id)); return; }
    if (!O.allowed(id)) { root.innerHTML = U.locked(O.t(id), { reason: 'permission' }); return; } /* Staff Access */
    if (!def) { root.innerHTML = U.empty('This section did not load. Reload the page to try again.', '⚠'); return; }
    var ctx = {
      params: current.params, fresh: !!fresh,
      setActions: function (h) { actions.innerHTML = ''; if (typeof h === 'string') actions.innerHTML = h; else if (h) actions.appendChild(h); return actions; },
      actionsEl: actions,
      on: function (evt, fn) { cleanup.push(O.on(evt, fn)); },
      onLeave: function (fn) { cleanup.push(fn); }, /* runs before the next render: stop timers, recorders, observers, speech */
      rerender: function () { O.render(false); },
      /* hold(true): changes from elsewhere do not redraw this page until hold(false) (e.g. while reading aloud) */
      hold: function (on) { held = !!on; if (!held && deferred) { deferred = false; O.render(false); } }
    };
    held = false; deferred = false;
    try { def.render(root, ctx); }
    catch (e) { console.error(e); root.innerHTML = U.empty('Something went wrong showing this section: ' + e.message, '⚠'); }
  };
  ['theme', 'viewer', 'lang', 'workspace', 'country', 'data'].forEach(function (evt) {
    O.on(evt, function () { if (!O._started) return; if (evt !== 'data') paintShell(); if (evt === 'data') { paintBadges(); paintTabs(); paintCountry(); } var def = O.pages[O.state.page]; if (evt === 'data' && def && def.noDataRerender) return; if (held && (evt === 'data' || evt === 'lang' || evt === 'theme')) { deferred = true; return; } O.render(false); });
  });
  O.on('sync', paintSync);

  function closeSide() { var s = O.$('.side'); if (s) { s.classList.remove('open'); O.$('.scrim').classList.remove('open'); } }
  function navBadge(id) {
    if (!O.allowed(id)) return '<span class="nav-lock">🔒</span>';
    if (id === 'inbox') { var n = D.conversations.reduce(function (s, c) { return s + (c.unread || 0); }, 0); return n ? '<span class="nav-badge">' + n + '</span>' : ''; }
    if (id === 'reviews') { var r = D.reviews.filter(function (x) { return !x.reply; }).length; return r ? '<span class="nav-badge">' + r + '</span>' : ''; }
    if (id === 'tasks') { var t = D.tasks.filter(function (x) { return x.status !== 'done' && x.due.slice(0, 10) <= D.TODAY && (O.can('tasks.others') || x.assigneeId === O.state.viewer); }).length; return t ? '<span class="nav-badge">' + t + '</span>' : ''; }
    return '';
  }
  function paintBadges() { O.$$('.nav-item').forEach(function (n) { var b = O.$('.nav-badge, .nav-lock', n); if (b) b.remove(); n.insertAdjacentHTML('beforeend', navBadge(n.dataset.page)); }); }

  /* phone: bottom tab bar with the four sections this person uses most, plus More (opens the full menu) */
  var TAB_SETS = {
    owner: ['dashboard', 'calendar', 'inbox', 'tasks'], ops: ['dashboard', 'calendar', 'inbox', 'tasks'], frontdesk: ['dashboard', 'bookings', 'inbox', 'calendar'],
    housekeeping: ['tasks', 'calendar', 'inventory', 'inbox'], maintenance: ['tasks', 'inventory', 'calendar', 'inbox'], accountant: ['dashboard', 'invoices', 'expenses', 'reports']
  };
  O.tabsFor = function () {
    var v = O.viewer(), want = TAB_SETS[(v && v.role) || 'owner'] || TAB_SETS.owner, out = want.filter(O.allowed);
    O.NAV.forEach(function (g) { g[1].forEach(function (id) { if (out.length < 4 && out.indexOf(id) < 0 && O.allowed(id)) out.push(id); }); });
    return out.slice(0, 4);
  };
  function paintTabs() {
    var bar = O.$('#tabbar'); if (!bar) return;
    var tabs = O.tabsFor(), cur = O.state.page, inTabs = tabs.indexOf(cur) >= 0;
    bar.innerHTML = tabs.map(function (id) { return '<button class="tab' + (id === cur ? ' on' : '') + '" data-page="' + id + '">' + O.icon(id) + '<span>' + O.esc(O.t(id)) + '</span>' + navBadge(id).replace('nav-badge', 'tab-badge') + '</button>'; }).join('') +
      '<button class="tab' + (inTabs ? '' : ' on') + '" data-more="1">' + O.icon('menu') + '<span>' + O.esc(O.t('more')) + '</span></button>';
  }
  function paintSync() {
    var el = O.$('#sync-pill'); if (!el) return;
    var st = O.sync.status, map = { local: ['On this device', 'This test copy saves to this browser only'], loading: ['Loading…', ''], saving: ['Saving…', ''], saved: ['Saved', 'Everyone in the workspace sees your changes'], error: ['Not saved, retrying', O.sync.error || 'Check the connection'], readonly: ['View only', 'Your access lets you look but not change things'], starting: ['', ''] };
    var m = map[st] || ['', '']; el.textContent = m[0]; el.title = m[1]; el.className = 'sync-pill s-' + st; el.hidden = !m[0];
  }
  O.notifications = function () {
    var out = [], P = function (id) { return D.propById[id] ? D.propById[id].short : 'Unknown unit'; };
    D.bookings.filter(function (b) { return b.sameDay && b.checkIn === D.TODAY && b.status !== 'cancelled'; }).forEach(function (b) { out.push({ icon: '⚡', tone: 'warn', t: 'Same-day booking: ' + b.guest.name, s: P(b.propertyId) + ' · confirmed ' + O.fmt.time(b.createdAt) + ', arrives ' + O.fmt.time(b.checkInTime), go: ['dashboard'] }); });
    var nr = D.reviews.filter(function (r) { return !r.reply; });
    if (nr.length && O.can('reviews')) out.push({ icon: '★', tone: 'bad', t: nr.length + ' reviews need a reply', s: nr.filter(function (r) { return r.stars <= 3; }).length + ' of them are 3 stars or lower', go: ['reviews', { needsReply: true }] });
    var mine = function (t) { return O.can('tasks.others') || t.assigneeId === O.state.viewer; };
    D.tasks.filter(function (t) { return t.status !== 'done' && t.due.slice(0, 10) < D.TODAY && mine(t); }).forEach(function (t) { out.push({ icon: '⏰', tone: 'bad', t: 'Overdue: ' + t.title, s: (t.propertyId ? P(t.propertyId) : 'General') + ' · due ' + O.fmt.dateTime(t.due), go: ['tasks'] }); });
    if (O.can('tasks.assign')) D.tasks.filter(function (t) { return t.status !== 'done' && !t.assigneeId; }).forEach(function (t) { out.push({ icon: '👤', tone: 'warn', t: 'Unassigned task: ' + t.title, s: (t.propertyId ? P(t.propertyId) : 'General') + ' · due ' + O.fmt.dateTime(t.due), go: ['tasks'] }); });
    if (O.can('invoices')) D.bookings.filter(function (b) { return b.status !== 'cancelled' && !b.invoiceSent && b.invoiceNo && b.createdAt.slice(0, 10) >= d.add(D.TODAY, -1); }).forEach(function (b) { out.push({ icon: '🧾', tone: '', t: 'Invoice not sent: ' + b.guest.name, s: b.invoiceNo + ' · ' + O.fmt.money(b.total, { cur: b }), go: ['invoices'] }); });
    if (O.can('bookings')) D.bookings.filter(function (b) { return b.status === 'pending'; }).slice(0, 2).forEach(function (b) { out.push({ icon: '⏳', tone: 'warn', t: 'Pending booking: ' + b.guest.name, s: P(b.propertyId) + ' · ' + d.fmtRange(b.checkIn, b.checkOut), go: ['bookings'] }); });
    (O.notifiers || []).forEach(function (fn) { try { out.push.apply(out, fn() || []); } catch (e) { console.error(e); } });
    return out;
  };
  /* pages add their own bell items: O.notifiers.push(function () { return [{icon, tone, t, s, go:[page, params]}]; }) */
  O.notifiers = O.notifiers || [];
  O.paintShell = function () { paintShell(); };
  function paintShell() {
    var lb = O.$('#lock-btn'); if (lb) lb.hidden = !O.can('guestapp.doorCodes');
    var ws = O.ws(), v = O.viewer() || { name: 'Guest', roleLabel: 'Viewer', role: 'none' };
    O.$('#ws-logo').outerHTML = O.theme.logoHTML(ws, O.theme.get('--side-bg')).replace('class="ws-logo', 'id="ws-logo" class="ws-logo');
    O.$('#ws-name').textContent = ws.name;
    O.$('#ws-sub').textContent = ws.sub;
    var wsList = O.workspaceList ? O.workspaceList() : Object.keys(O.workspaces).map(function (k) { return O.workspaces[k]; });
    O.$('#ws-menu').innerHTML = '<div class="menu-label">Switch workspace</div>' + wsList.map(function (w) { return '<button class="ws-opt' + (w.id === O.state.workspace ? ' sel' : '') + '" data-ws="' + O.esc(w.id) + '">' + O.theme.logoHTML(w) + '<span><span class="t" style="display:block">' + O.esc(w.name) + '</span><span class="d" style="display:block">' + O.esc(w.sub) + '</span></span></button>'; }).join('') +
      (O.workspaceExtras ? O.workspaceExtras() : '<button class="ws-opt" data-ws="__new"><span class="ws-logo" style="border:1px dashed var(--border-strong);color:var(--muted)">' + O.icon('plus') + '</span><span><span class="t" style="display:block">Set up a new subscriber</span><span class="d" style="display:block">Upload a logo, colours are picked for you</span></span></button>');
    O.$('#nav').innerHTML = O.NAV.map(function (g) {
      return '<div class="nav-group">' + O.esc(O.t(g[0])) + '</div>' + g[1].map(function (id) { return '<button class="nav-item' + (id === O.state.page ? ' active' : '') + '" data-page="' + id + '">' + O.icon(id) + '<span>' + O.esc(O.t(id)) + '</span>' + navBadge(id) + '</button>'; }).join('');
    }).join('') + (O.navExtras ? O.navExtras() : '');
    O.$('#viewer-btn').innerHTML = U.avatar(v.name) + '<span class="grow"><span class="nm" style="display:block">' + O.esc(v.name) + '</span><span class="rl" style="display:block">' + (O.viewerNote ? O.esc(O.viewerNote()) : 'Viewing as ' + O.esc(String(v.roleLabel || '').toLowerCase())) + '</span>' + (ws.plan ? '<span class="plan-pill">' + O.esc(ws.plan) + '</span>' : '') + '</span><span class="ws-caret">▴</span>';
    O.$('#viewer-menu').innerHTML = O.viewerMenu ? O.viewerMenu() : '<div class="menu-label">View the app as</div>' + viewerChoices().map(function (s) { return '<button class="pop-opt' + (s.id === O.state.viewer ? ' sel' : '') + '" data-viewer="' + s.id + '"><span class="row-flex">' + U.avatar(s.name, 'sm') + '<span>' + O.esc(s.name) + '<br><span class="xs muted">' + O.esc(s.roleLabel) + '</span></span></span>' + (s.role === 'owner' ? '<span class="pill accent">Owner</span>' : '') + '</button>'; }).join('');
    O.$('#lang-menu').innerHTML = O.LANGS.map(function (l) { return '<button class="pop-opt' + (l[0] === O.state.lang ? ' sel' : '') + '" data-lang="' + l[0] + '">' + O.esc(l[1]) + ' <span class="xs muted">' + O.esc(l[2]) + '</span></button>'; }).join('');
    var ns = O._started ? O.notifications() : [];
    O.$('#bell-menu').innerHTML = '<div class="menu-label">Notifications</div>' + (ns.length ? ns.map(function (n, i) { return '<button class="notif" data-n="' + i + '"><span class="ni" style="background:' + (n.tone === 'bad' ? 'var(--bad-soft)' : n.tone === 'warn' ? 'var(--warn-soft)' : 'var(--surface-2)') + '">' + n.icon + '</span><span><span class="nt" style="display:block">' + O.esc(n.t) + '</span><span class="ns" style="display:block">' + O.esc(n.s) + '</span></span></button>'; }).join('') : '<div class="small muted" style="padding:10px 12px">Nothing needs you right now.</div>');
    if (window.innerWidth >= 640) O.$('#bell-menu').style.minWidth = '320px';
    O.$('#bell-btn .dot').hidden = !ns.length;
    O.$('#lock-btn').hidden = !O.can('guestapp.doorCodes');
    paintCountry(); paintTabs(); paintSync();
  }
  function paintCountry() {
    var cs = O.$('#country-slot'); if (!cs) return;
    var h = O.countrySwitchHTML(); if (cs._h === h) return; cs._h = h; cs.innerHTML = h;
    var sel = O.$('#country-switch', cs); if (sel) sel.onchange = function () { O.setCountry(sel.value); };
  }
  /* local test mode: pick anyone on the team (one person per role) */
  function viewerChoices() { var seen = {}; return D.staff.filter(function (s) { if (s.status === 'left' || seen[s.role + (s.role === 'housekeeping' ? s.id : '')]) return false; seen[s.role + (s.role === 'housekeeping' ? s.id : '')] = 1; return true; }); }

  function loaderHTML(msg) { return '<div class="boot-loader"><div class="spinner"></div><div>' + O.esc(msg || 'Loading your workspace…') + '</div></div>'; }
  O.showLoader = function (msg) { var r = O.$('#page-root'); if (r) r.innerHTML = loaderHTML(msg); };
  var wired = false;
  function wireShell() {
    if (wired) return; wired = true;
    O.$('#nav').addEventListener('click', function (e) { var b = e.target.closest('.nav-item'); if (b) O.go(b.dataset.page); });
    O.$('#tabbar').addEventListener('click', function (e) { var b = e.target.closest('.tab'); if (!b) return; if (b.dataset.more) { O.$('.side').classList.add('open'); O.$('.scrim').classList.add('open'); return; } O.go(b.dataset.page); });
    U.closeOnOutside(O.$('#ws-btn'), O.$('#ws-menu'));
    O.$('#ws-menu').addEventListener('click', function (e) {
      var b = e.target.closest('.ws-opt, [data-ws-action]'); if (!b) return; O.$('#ws-menu').classList.remove('open');
      if (b.dataset.wsAction && O.onWorkspaceAction) { O.onWorkspaceAction(b.dataset.wsAction); return; }
      if (b.dataset.ws === '__new') { O.go('brand', { wizard: true }); return; }
      O.setWorkspace(b.dataset.ws);
    });
    U.closeOnOutside(O.$('#viewer-btn'), O.$('#viewer-menu'));
    O.$('#viewer-menu').addEventListener('click', function (e) {
      if (O.onViewerMenu && O.onViewerMenu(e) === false) return;
      var b = e.target.closest('[data-viewer]'); if (!b) return; O.$('#viewer-menu').classList.remove('open'); O.state.viewer = b.dataset.viewer; O.store.set('viewer', O.state.viewer); U.toast('Now viewing as ' + O.viewer().name + ' (' + O.viewer().roleLabel + ')'); O.emit('viewer');
    });
    U.closeOnOutside(O.$('#lang-btn'), O.$('#lang-menu'));
    O.$('#lang-menu').addEventListener('click', function (e) { var b = e.target.closest('[data-lang]'); if (!b) return; O.$('#lang-menu').classList.remove('open'); O.state.lang = b.dataset.lang; O.store.set('lang', O.state.lang); O.emit('lang'); });
    U.closeOnOutside(O.$('#bell-btn'), O.$('#bell-menu'));
    O.$('#bell-btn').addEventListener('click', function () {
      paintShell();
      var m = O.$('#bell-menu');
      /* on a phone the bell is not at the screen's right edge, so a right-aligned 320px list runs off the left: pin it to the screen */
      if (window.innerWidth < 640) { var r = O.$('#bell-btn').getBoundingClientRect(); m.style.position = 'fixed'; m.style.left = '12px'; m.style.right = '12px'; m.style.top = Math.round(r.bottom + 6) + 'px'; m.style.minWidth = '0'; m.style.maxHeight = 'calc(100vh - ' + Math.round(r.bottom + 24) + 'px)'; m.style.overflowY = 'auto'; }
      else { m.style.position = m.style.left = m.style.right = m.style.top = m.style.maxHeight = m.style.overflowY = ''; m.style.minWidth = '320px'; }
      /* closeOnOutside has already toggled the list, so a second tap on the bell closes it */
    });
    O.$('#bell-menu').addEventListener('click', function (e) { var b = e.target.closest('[data-n]'); if (!b) return; O.$('#bell-menu').classList.remove('open'); var n = O.notifications()[+b.dataset.n]; if (n) O.go(n.go[0], n.go[1]); });
    O.$('#lock-btn').onclick = function () { O.lock.change({ propertyId: O.state.lockProp || null }); };
    O.$('#menu-btn').onclick = function () { O.$('.side').classList.add('open'); O.$('.scrim').classList.add('open'); };
    O.$('.scrim').onclick = closeSide;
  }

  /* ===================================================================
     BOOT
     1. guest link (#guest-<token> or /guest/<token>) -> the guest app only, no staff shell
     2. O.auth.gate() when auth.js is present and configured (sign in, pick workspace, set the server adapter)
     3. load saved data (O.sync.start), move the demo to the story date, start the clock, run background jobs, render
     =================================================================== */
  O.boot = function () {
    var app = O.$('#app');
    var gt = O.guestToken();
    if (gt) {
      document.documentElement.classList.add('guest-mode');
      var gr = O.$('#guest-root'); gr.hidden = false; app.hidden = true;
      O.clock.apply();
      if (O.guestMode) O.guestMode(gr, gt); else gr.innerHTML = U.empty('The guest app did not load. Reload the page to try again.', '⚠');
      return;
    }
    O.state.lang = O.store.get('lang', 'en');
    var savedWs = O.store.get('workspace', 'orbique'); if (O.workspaces[savedWs]) O.state.workspace = savedWs;
    Object.keys(O.workspaces).forEach(function (k) { var sl = O.store.get('logo:' + k, null); if (sl && sl.logo) { O.workspaces[k].logo = sl.logo; O.workspaces[k].logoName = sl.name; } });
    var savedBrand = O.store.get('brand:' + O.state.workspace, null); if (savedBrand && savedBrand.primary) O.ws().brand = savedBrand;
    O.theme.apply(O.ws().brand);
    O.sync.captureDemo();
    var gate = O.auth && O.auth.enabled && O.auth.enabled() ? O.auth.gate() : Promise.resolve({ mode: 'local' });
    return Promise.resolve(gate).then(function (ctx) {
      if (!ctx || ctx.stop) return; /* auth.js is showing its own screen (sign-in, onboarding, platform admin) */
      app.hidden = false;
      wireShell(); paintShell(); O.showLoader();
      app.removeAttribute('aria-busy');
      /* local test copy: the demo's "today" lands on the day this browser first opened the app (kept until reset) */
      var shift = 0;
      if (ctx.mode === 'local') {
        O.clock.apply();
        var story = O.store.get('story', null); if (!story) { story = D.TODAY; O.store.set('story', story); }
        shift = d.diff(D.STORY0, story);
        if (shift) Object.keys(D).forEach(function (k) { if (['TODAY', 'NOW', 'NOW_TIME', 'STORY0', 'STORY', 'SHIFT', 'DATA_START'].indexOf(k) < 0 && D[k] && typeof D[k] === 'object') O.shiftDates(D[k], shift); });
      } else if (ctx.storyDate) shift = d.diff(D.STORY0, ctx.storyDate);
      D.SHIFT = shift; D.STORY = d.add(D.STORY0, shift); D.DATA_START = d.add('2026-06-01', shift);
      O.clock.apply();
      return O.sync.start().then(function () {
        if (ctx.viewer) O.state.viewer = ctx.viewer;
        else { var sv = O.store.get('viewer', null); if (sv && D.staffById(sv)) O.state.viewer = sv; }
        if (!D.staffById(O.state.viewer) && D.staff[0]) O.state.viewer = D.staff[0].id;
        if (D.workspaceBrand && D.workspaceBrand.brand && D.workspaceBrand.brand.primary) { var w = O.ws(); w.brand = D.workspaceBrand.brand; if (D.workspaceBrand.logo) { w.logo = D.workspaceBrand.logo; w.logoName = D.workspaceBrand.logoName; } O.theme.apply(w.brand); }
        if (D.workspaceBrand) ['name', 'legal', 'regNo', 'phone', 'email', 'domain', 'address'].forEach(function (k) { if (D.workspaceBrand[k]) O.ws()[k] = D.workspaceBrand[k]; });
        O.rollStatuses();
        O._started = true;
        O.automation.run('boot');
        var savedPage = O.store.get('page', 'dashboard');
        var known = function (p) { return O.pages[p] && (O.NAV.some(function (g) { return g[1].indexOf(p) >= 0; }) || O.EXTRA_PAGES[p]); };
        O.state.page = known(savedPage) && O.allowed(savedPage) ? savedPage : (O.tabsFor()[0] || 'dashboard');
        current = { id: O.state.page, params: {} };
        paintShell();
        O.render(true);
        O.clock.start();
        O.sync.schedule();
        Promise.all(Object.keys(O.workspaces).map(function (k) { return O.theme.measureLogo(O.workspaces[k]); })).then(function () { paintShell(); });
      });
    }).catch(function (e) {
      console.error(e); app.hidden = false; app.removeAttribute('aria-busy');
      O.$('#page-root').innerHTML = U.empty('The app could not load your workspace: ' + (e && e.message || e) + '. Check your connection and reload.', '⚠');
    });
  };
  O.setWorkspace = function (key, opts) {
    if (O.auth && O.auth.switchWorkspace && O.auth.enabled && O.auth.enabled()) { O.auth.switchWorkspace(key); return; }
    O.state.workspace = key; O.store.set('workspace', key);
    var w = O.ws(); var saved = O.store.get('brand:' + key, null); if (saved && saved.primary) w.brand = saved;
    O.theme.apply(w.brand);
    if (!(opts && opts.silent)) U.toast('Switched to ' + w.name + '. The interface now uses its logo colours.');
    O.emit('workspace');
  };
  O.addWorkspace = function (w) { O.workspaces[w.id] = w; O.theme.measureLogo(w).then(paintShell); };
  /* brand colours + logo are saved for the whole workspace (D.workspaceBrand) and on this device */
  O.saveBrand = function (brand) {
    var w = O.ws(); w.brand = brand; O.store.set('brand:' + O.state.workspace, brand); O.theme.apply(brand);
    /* keep the business details (name, legal name, registration, contact, address) that live in the same blob */
    var wb = D.workspaceBrand && typeof D.workspaceBrand === 'object' && !Array.isArray(D.workspaceBrand) ? D.workspaceBrand : (D.workspaceBrand = {});
    wb.brand = brand; wb.logo = w.logo && String(w.logo).length < 180000 ? w.logo : null; wb.logoName = w.logoName || null;
    O.emit('data');
  };
  /* test data: back to the demo, with "today" moved to the real today (local) — server mode is handled by auth.js */
  O.resetTestData = function () {
    if (O.auth && O.auth.resetWorkspace && O.auth.enabled && O.auth.enabled()) return O.auth.resetWorkspace();
    var A = O.sync.adapter; if (A && A.reset) A.reset();
    O.store.set('story', null); O.store.set('page', 'dashboard');
    location.reload();
  };
})();
