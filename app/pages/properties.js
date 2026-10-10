/* Properties — the operator's units: add, edit, archive (never delete), photos compressed in the browser.
   A property record in D.properties (records collection 'properties'):
     v3 fields every page reads (names and formats unchanged):
       id, name, short, type ('2BR loft' | 'Studio'), beds, area ('Gurney Drive, Penang'), base (RM per night), owner (owner's name),
       housekeeper (staff id | null), lockCode ('4827'), lockBrand ('Yale'), wifi ([name, password]), parking (text)
     v4 optional fields (old records work without them):
       city ('Penang'), address, mapUrl, checkInTime / checkOutTime ('HH:MM', defaults 15:00 / 11:00), maxGuests, notes,
       ownerPhone, ownerEmail, photos ([JPEG data URL, ...] max 4, first = cover, each about 150 KB or less),
       archived (true), archivedAt, archivedBy, createdAt, createdBy
   Open from anywhere: O.go('properties', {propertyId: 'bf3b'}) shows that unit; O.go('properties', {add: true}) opens the new-property form. */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, C = O.color, esc = O.esc, fmt = O.fmt;
  var st = { q: '', show: 'active', city: '', view: O.store.get('properties:view', 'cards') };
  var DR = null; /* the open drawer: {dr, mode: 'view'|'edit', id, draft, dirty, pic, busy, off} */
  var MAX_PHOTOS = 4, PHOTO_LIMIT = 150 * 1024;
  var KINDS = ['Apartment', 'Condo', 'Loft', 'Suite', 'Flat', 'Studio', 'Townhouse', 'House', 'Villa', 'Bungalow', 'Chalet', 'Shophouse'];
  var LOCKS = ['Yale', 'Igloohome', 'Nuki', 'Samsung', 'Philips', 'Schlage', 'Key box'];
  var CITIES = ['Kuala Lumpur', 'Petaling Jaya', 'Putrajaya', 'Penang', 'George Town', 'Melaka', 'Johor Bahru', 'Ipoh', 'Cameron Highlands', 'Genting Highlands', 'Langkawi', 'Port Dickson', 'Kota Kinabalu', 'Kuching'];
  var NEW_OWNER = '__new';

  O.css('properties', `
.pg-props .pp-tools{display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:12px;}
.pg-props .pp-tools .search{flex:1 1 260px; max-width:380px;}
.pg-props .pp-tools .spacer{flex:1;}
.pg-props .pp-cities{margin:0 0 14px;}
.pg-props .pp-sum{font-size:12px; color:var(--muted); margin:-4px 0 12px;}
.pg-props .pp-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:14px;}
.pg-props .pp-card{display:flex; flex-direction:column; text-align:left; padding:0; background:var(--surface); border:1px solid var(--border); border-radius:var(--r); box-shadow:var(--shadow); overflow:hidden; min-width:0; font:inherit; color:inherit; transition:border-color .15s, box-shadow .15s;}
.pg-props .pp-card:hover{border-color:var(--border-strong); box-shadow:0 6px 18px rgba(16,24,40,.08);}
.pg-props .pp-card.arch .pp-ph{filter:grayscale(.85); opacity:.75;}
.pp-ph{position:relative; display:block; aspect-ratio:16/10; background:var(--surface-2); overflow:hidden;}
.pp-ph > img, .pp-ph > svg{position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block;}
.pp-ph .pill{position:absolute; top:10px; left:10px; box-shadow:0 1px 3px rgba(16,24,40,.16);}
.pp-cnt{position:absolute; right:8px; bottom:8px; background:rgba(20,24,31,.72); color:#FFFFFF; font-size:11px; font-weight:700; border-radius:20px; padding:2px 8px; display:inline-flex; gap:4px; align-items:center;}
.pp-cnt svg{width:12px; height:12px;}
.pg-props .pp-b{display:flex; flex-direction:column; gap:3px; padding:12px 14px; min-width:0;}
.pg-props .pp-nm{font-family:var(--font-head); font-weight:800; font-size:14.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.pg-props .pp-loc{font-size:12px; color:var(--muted); display:flex; gap:4px; align-items:center; min-width:0;}
.pg-props .pp-loc svg{width:13px; height:13px; flex:none;}
.pg-props .pp-loc span, .pg-props .pp-meta span{overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.pg-props .pp-meta{font-size:12px; color:var(--text-2); display:flex; gap:6px; align-items:center; min-width:0;}
.pg-props .pp-meta .pill{flex:none;}
.pg-props .pp-warn{display:flex; align-items:center; gap:5px; font-size:11.5px; font-weight:700; color:var(--warn); min-width:0;}
.pg-props .pp-warn svg{width:13px; height:13px; flex:none;}
.pg-props .pp-warn span{overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.pg-props .pp-ft{display:flex; align-items:center; gap:8px; margin-top:8px; padding-top:10px; border-top:1px solid var(--border); font-size:12px; color:var(--text-2); min-width:0;}
.pg-props .pp-ft .who{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.pg-props .pp-ft .who.none{color:var(--faint);}
.pp-price{font-weight:800; color:var(--text); white-space:nowrap; font-variant-numeric:tabular-nums;}
.pp-price small{font-weight:600; color:var(--muted); font-size:11px;}
.pg-props .pp-tbl td{padding:8px 12px;}
.pg-props .pp-tbl .th{width:56px; height:38px; border-radius:7px; overflow:hidden; position:relative; display:block; background:var(--surface-2);}
.pg-props .pp-tbl .th > img, .pg-props .pp-tbl .th > svg{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
.pg-props .pp-tbl .t1{font-weight:700;} .pg-props .pp-tbl .t2{font-size:11.5px; color:var(--muted);}
.pg-props .pp-tbl tr.arch td{color:var(--muted);}
.pg-props .pp-empty{display:flex; flex-direction:column; align-items:center; text-align:center; gap:10px; padding:44px 20px 40px;}
.pg-props .pp-empty .art{width:220px; max-width:70%; aspect-ratio:16/10; border-radius:14px; overflow:hidden; position:relative; margin-bottom:6px;}
.pg-props .pp-empty .art svg{position:absolute; inset:0; width:100%; height:100%;}
.pg-props .pp-empty h3{font-size:18px;}
.pg-props .pp-empty p{margin:0; color:var(--muted); max-width:440px; line-height:1.5; font-size:13px;}
.pg-props .pp-empty .btn{margin-top:6px;}
.pg-props .pp-none{padding:30px 16px; text-align:center; color:var(--muted); font-size:13px;}
.pg-props .pp-none .btn{margin-top:10px;}
.pg-props .view-seg{flex:none;}
.pg-props .pp-meta .st-sm{display:none;}

/* drawer: view */
.pp-dr .modal-body{padding:0;}
.pp-dr .pp-gal{background:var(--surface-2); border-bottom:1px solid var(--border);}
.pp-dr .pp-gal .pp-ph{aspect-ratio:16/9;}
.pp-dr .pp-gal .pp-ph.art{aspect-ratio:5/2;}
.pp-dr .pp-thumbs{display:flex; gap:6px; padding:8px 18px;}
.pp-dr .pp-thumbs button{width:58px; height:40px; border-radius:7px; overflow:hidden; padding:0; border:2px solid transparent; background:none; flex:none;}
.pp-dr .pp-thumbs button.on{border-color:var(--brand-strong);}
.pp-dr .pp-thumbs img{width:100%; height:100%; object-fit:cover; display:block;}
.pp-dr .pp-vbody{padding:14px 18px 20px; display:flex; flex-direction:column; gap:16px;}
.pp-dr .pp-now{display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:12.5px; color:var(--text-2);}
.pp-dr .pp-quick{display:flex; gap:8px; flex-wrap:wrap;}
.pp-dr .pp-vs h4{font-size:11.5px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:0 0 8px; font-family:var(--font-body);}
.pp-dr .pp-kv{display:grid; grid-template-columns:132px minmax(0,1fr); gap:7px 12px; font-size:13px; margin:0;}
.pp-dr .pp-kv dt{color:var(--muted); font-weight:600;}
.pp-dr .pp-kv dd{margin:0; font-weight:600; min-width:0; overflow-wrap:anywhere;}
.pp-dr .pp-kv dd .xs{font-weight:500;}
.pp-dr .pp-kv .kbd{font-size:13px; font-weight:700; letter-spacing:.06em;}
.pp-dr .pp-inl{display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;}
.pp-dr .pp-person{display:flex; align-items:center; gap:10px;}
.pp-dr .pp-person .grow b{display:block; font-size:13px;} .pp-dr .pp-person .grow span{font-size:12px; color:var(--muted);}
.pp-dr .pp-miss{display:flex; gap:8px; align-items:flex-start;}
.pp-dr .modal-foot{justify-content:space-between;}
.pp-dr .modal-foot .r{display:flex; gap:8px; margin-left:auto;}

/* drawer: edit */
.pp-dr .pp-form{padding:4px 18px 24px;}
.pp-dr .pp-sec{padding:16px 0 4px; border-top:1px solid var(--border); margin-top:14px;}
.pp-dr .pp-sec:first-child{border-top:none; margin-top:0;}
.pp-dr .pp-sec h4{font-size:14px; font-weight:800; margin:0;}
.pp-dr .pp-sec .sd{font-size:12px; color:var(--muted); margin:2px 0 12px;}
.pp-dr .field > label .opt{font-weight:600; color:var(--faint);}
.pp-dr .pp-err{font-size:11.5px; color:var(--bad); font-weight:600;}
.pp-dr .pp-err:empty{display:none;}
.pp-dr .input.bad, .pp-dr .select.bad, .pp-dr .textarea.bad{border-color:var(--bad); box-shadow:0 0 0 1px var(--bad) inset;}
.pp-dr .pp-money{position:relative;}
.pp-dr .pp-money span{position:absolute; left:10px; top:50%; transform:translateY(-50%); font-size:13px; color:var(--muted); font-weight:700; pointer-events:none;}
.pp-dr .pp-money .input{padding-left:38px;}
.pp-dr .pp-photos{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px;}
.pp-dr .pp-pt{position:relative; aspect-ratio:4/3; border-radius:10px; overflow:hidden; background:var(--surface-2); border:1px solid var(--border);}
.pp-dr .pp-pt img{width:100%; height:100%; object-fit:cover; display:block;}
.pp-dr .pp-pt .cover{position:absolute; top:7px; left:7px; background:var(--brand); color:var(--brand-ink); font-size:10.5px; font-weight:800; border-radius:20px; padding:2px 8px;}
.pp-dr .pp-pt .bar{position:absolute; right:6px; bottom:6px; display:flex; gap:4px;}
.pp-dr .pp-pt .bar button{width:32px; height:32px; border-radius:8px; border:none; background:rgba(20,24,31,.72); color:#FFFFFF; display:inline-flex; align-items:center; justify-content:center; padding:0;}
.pp-dr .pp-pt .bar button svg{width:15px; height:15px;}
.pp-dr .pp-pt .bar button[disabled]{opacity:.35; cursor:default;}
.pp-dr .pp-pt.add{border:1.5px dashed var(--border-strong); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; cursor:pointer; color:var(--text-2); font-size:12px; text-align:center; padding:8px;}
.pp-dr .pp-pt.add:hover{border-color:var(--brand-strong); background:var(--brand-soft-2);}
.pp-dr .pp-pt.add svg{width:22px; height:22px; color:var(--brand-strong);}
.pp-dr .pp-pt.add span{color:var(--muted); font-size:11px;}
.pp-dr .pp-pt.busy{display:flex; flex-direction:column; gap:8px; align-items:center; justify-content:center; font-size:12px; color:var(--muted);}
.pp-dr .pp-pt.busy .spinner{width:22px; height:22px; border-width:2px;}
.pp-dr .pp-newown{display:contents;}
.pp-dr .pp-newown[hidden]{display:none !important;}

@media (max-width:760px){
  .pg-props .pp-tools .search{max-width:none; flex:1 1 100%; order:-1;}
  .pg-props .view-seg{display:none;}
  .pg-props .pp-cities{flex-wrap:nowrap; overflow-x:auto; margin-left:-14px; margin-right:-14px; padding:0 14px 2px; scrollbar-width:none;}
  .pg-props .pp-cities::-webkit-scrollbar{display:none;}
  .pg-props .pp-cities .chip{min-height:36px;}
  .pg-props .pp-grid{grid-template-columns:minmax(0,1fr); gap:10px;}
  .pg-props .pp-card{flex-direction:row; align-items:stretch;}
  .pg-props .pp-card .pp-ph{width:104px; flex:none; aspect-ratio:auto; min-height:100%;}
  .pg-props .pp-card .pp-ph .pill, .pg-props .pp-card .pp-cnt{display:none;}
  .pg-props .pp-b{padding:10px 12px; flex:1;}
  .pg-props .pp-warn{display:flex; align-items:center; gap:5px; font-size:11.5px; font-weight:700; color:var(--warn); min-width:0;}
.pg-props .pp-warn svg{width:13px; height:13px; flex:none;}
.pg-props .pp-warn span{overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.pg-props .pp-ft{margin-top:6px; padding-top:7px;}
  .pg-props .pp-meta .st-sm{display:inline-flex;}
  .pp-dr .pp-kv{grid-template-columns:110px minmax(0,1fr);}
  .pp-dr .input, .pp-dr .select, .pp-dr .textarea{font-size:16px;}
  .pp-dr .pp-pt .bar button{width:40px; height:40px;}
  .pp-dr .modal-foot .btn{min-height:42px;}
  .pp-dr .pp-quick .btn{min-height:40px;}
}
`);

  /* ------------------------------------------------------------------ data helpers */
  function activeProps() { return D.properties.filter(function (p) { return p && !p.archived; }); } /* suggested for core as O.activeProperties() */
  function canAccess() { return O.can('properties.access'); }
  function canEdit() { return O.can('properties.edit'); }
  function canSeePrice() { return O.can('properties.edit') || O.can('pricing'); }
  function canSeeOwner() { return O.can('properties.edit') || O.can('owner'); }
  function cityOf(p) {
    if (p.city) return p.city;
    var a = String(p.area || ''), i = a.lastIndexOf(',');
    return (i >= 0 ? a.slice(i + 1) : a).trim();
  }
  function hoodOf(p) {
    var a = String(p.area || '').trim(), c = cityOf(p);
    if (c && a.slice(-c.length) === c) return a.slice(0, a.length - c.length).replace(/,\s*$/, '').trim();
    var i = a.lastIndexOf(',');
    return i >= 0 ? a.slice(0, i).trim() : '';
  }
  function cap(s) { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; }
  function kindOf(p) {
    var t = String(p.type || '').trim(), m = t.match(/^\d+\s*BR\s+(.+)$/i);
    if (m) return cap(m[1]);
    if (/^studio\s+\S/i.test(t)) return cap(t.replace(/^studio\s+/i, ''));
    return cap(t) || 'Apartment';
  }
  function typeText(kind, beds) {
    kind = kind || 'Apartment';
    if (kind === 'Studio') return 'Studio';
    return beds > 0 ? beds + 'BR ' + kind.toLowerCase() : 'Studio ' + kind.toLowerCase();
  }
  function bedsText(p) { var b = +p.beds || 0; return b ? fmt.plural(b, 'bedroom') : 'Studio'; }
  function suggestShort(name) { /* 'Seri Bukit Residence 12A' -> 'Seri Bukit 12A' (keeps a unit number at the end) */
    name = String(name || '').trim(); if (name.length <= 16) return name;
    var words = name.split(/\s+/), unit = /\d/.test(words[words.length - 1]) && words.length > 1 ? words.pop() : '', room = 16 - (unit ? unit.length + 1 : 0), out = '';
    words.some(function (w) { if ((out + ' ' + w).trim().length > room) return true; out = (out + ' ' + w).trim(); return false; });
    out = out || words[0].slice(0, room);
    return unit ? out + ' ' + unit : out;
  }
  function staffName(id) { var s = id && D.staffById(id); return s ? s.name : ''; }
  function activeStaff() { return D.staff.filter(function (s) { var m = D.staffMeta && D.staffMeta[s.id]; return !(m && m.status === 'suspended'); }); }
  function owners() { /* property owners are modelled as names on each property (owner.js groups by p.owner) */
    var map = {};
    D.properties.forEach(function (p) { if (p && p.owner) { var o = map[p.owner] = map[p.owner] || { name: p.owner, units: [], phone: '', email: '' }; o.units.push(p); if (!o.phone && p.ownerPhone) o.phone = p.ownerPhone; if (!o.email && p.ownerEmail) o.email = p.ownerEmail; } });
    return Object.keys(map).sort(function (a, b) { return a.localeCompare(b); }).map(function (k) { return map[k]; });
  }
  function liveBookings(pid) { return D.bookings.filter(function (b) { return b.propertyId === pid && b.status !== 'cancelled'; }); }
  function upcoming(pid) { var T = D.TODAY; return liveBookings(pid).filter(function (b) { return b.checkOut > T; }).sort(function (a, b) { return a.checkIn < b.checkIn ? -1 : 1; }); }
  /* what is happening at the unit today */
  function statusOf(p) {
    if (p.archived) return { kind: 'neutral', t: 'Archived', s: p.archivedAt ? 'Archived ' + d.fmtY(String(p.archivedAt).slice(0, 10)) : '' };
    var T = D.TODAY;
    var blk = D.blocks.filter(function (x) { return x.propertyId === p.id && x.start <= T && x.end > T; })[0];
    if (blk) return { kind: 'neutral', t: blk.type === 'owner' ? 'Owner stay' : 'Blocked', s: (blk.note ? blk.note + ', ' : '') + 'until ' + d.fmt(blk.end) };
    var bs = liveBookings(p.id);
    var stay = bs.filter(function (b) { return b.checkIn < T && b.checkOut > T; })[0];
    var arr = bs.filter(function (b) { return b.checkIn === T; })[0];
    var dep = bs.filter(function (b) { return b.checkOut === T; })[0];
    if (stay) return { kind: 'ok', t: 'Guest in', s: stay.guest.name + ' until ' + d.fmt(stay.checkOut) };
    if (arr && dep) return { kind: 'warn', t: 'Turnover today', s: dep.guest.name + ' out ' + fmt.time(dep.checkOutTime) + ', ' + arr.guest.name + ' in ' + fmt.time(arr.checkInTime) };
    if (arr) return { kind: arr.status === 'checked_in' ? 'ok' : 'info', t: arr.status === 'checked_in' ? 'Guest in' : 'Arrives today', s: arr.guest.name + ', ' + fmt.time(arr.checkInTime) };
    var next = bs.filter(function (b) { return b.checkIn > T; }).sort(function (a, b) { return a.checkIn < b.checkIn ? -1 : 1; })[0];
    return { kind: 'neutral', t: 'Free tonight', s: next ? 'Next guest ' + d.fmt(next.checkIn) : 'No upcoming bookings' };
  }
  function missing(p) { /* details the operation needs every day */
    var m = [];
    if (canAccess() && !p.lockCode) m.push('lock code');
    if (canAccess() && !(p.wifi && p.wifi[0])) m.push('Wi-Fi');
    if (!p.housekeeper) m.push('housekeeper');
    return m;
  }
  function audit(text) { if (!Array.isArray(D.auditLog)) D.auditLog = []; D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: 'properties', text: text }); }

  /* ------------------------------------------------------------------ pictures */
  var HOUSE = /House|Villa|Bungalow|Chalet|Townhouse/i, ROW = /Shophouse/i;
  function art(p) { /* tasteful illustrated placeholder, tinted with the unit's calendar colour */
    var hue = C.mix(U.propColor(p.id), '#55606E', 0.3), base = C.mix(hue, '#FFFFFF', 0.12), bg = C.mix(hue, '#FFFFFF', 0.88), mid = C.mix(hue, '#FFFFFF', 0.58), lt = C.mix(hue, '#FFFFFF', 0.74), k = kindOf(p), s = '';
    s += '<rect width="320" height="200" fill="' + bg + '"/><circle cx="252" cy="54" r="24" fill="#FFFFFF" opacity=".75"/>';
    if (ROW.test(k)) {
      for (var i = 0; i < 4; i++) {
        var x = 20 + i * 72;
        s += '<rect x="' + x + '" y="88" width="68" height="104" fill="' + (i % 2 ? mid : base) + '"/><rect x="' + (x - 2) + '" y="82" width="72" height="8" fill="' + C.mix(base, '#14181F', 0.25) + '"/>' +
          '<path d="M' + (x + 14) + ' 136 v-14 a20 20 0 0 1 40 0 v14 z" fill="#FFFFFF" opacity=".75"/><rect x="' + (x + 24) + '" y="158" width="20" height="34" fill="#FFFFFF" opacity=".55"/>';
      }
    } else if (HOUSE.test(k)) {
      s += '<circle cx="54" cy="160" r="30" fill="' + mid + '"/><circle cx="270" cy="164" r="24" fill="' + mid + '"/>' +
        '<rect x="100" y="112" width="120" height="80" fill="' + lt + '"/><path d="M84 116 L160 60 L236 116 Z" fill="' + base + '"/>' +
        '<rect x="148" y="150" width="24" height="42" rx="2" fill="' + base + '"/><rect x="114" y="128" width="24" height="20" rx="2" fill="#FFFFFF" opacity=".8"/><rect x="182" y="128" width="24" height="20" rx="2" fill="#FFFFFF" opacity=".8"/>';
    } else {
      s += '<rect x="34" y="104" width="54" height="96" fill="' + lt + '"/><rect x="214" y="92" width="72" height="108" fill="' + lt + '"/>' +
        '<rect x="112" y="44" width="88" height="156" rx="3" fill="' + base + '"/>';
      for (var r = 0; r < 6; r++) for (var c = 0; c < 3; c++) s += '<rect x="' + (123 + c * 25) + '" y="' + (56 + r * 22) + '" width="14" height="12" rx="1.5" fill="#FFFFFF" opacity=".6"/>';
      for (var r2 = 0; r2 < 4; r2++) s += '<rect x="226" y="' + (104 + r2 * 22) + '" width="48" height="10" rx="1.5" fill="#FFFFFF" opacity=".7"/>';
    }
    s += '<rect y="192" width="320" height="8" fill="' + mid + '"/>';
    return '<svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true">' + s + '</svg>';
  }
  function cover(p) { var ph = Array.isArray(p.photos) ? p.photos : []; return ph[0] ? '<img src="' + esc(ph[0]) + '" alt="" loading="lazy">' : art(p); }

  /* compress a photo in the browser: JPEG data URL of PHOTO_LIMIT characters or less */
  function compressPhoto(file) {
    return new Promise(function (res, rej) {
      if (!file || !/^image\//.test(file.type || '')) { rej(new Error('type')); return; }
      if (file.size > 40 * 1024 * 1024) { rej(new Error('size')); return; }
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        URL.revokeObjectURL(url);
        var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, best = null;
        if (!w || !h) { rej(new Error('decode')); return; }
        var sizes = [1280, 1024, 820, 640, 480], qs = [0.82, 0.72, 0.62, 0.52];
        for (var i = 0; i < sizes.length; i++) {
          var k = Math.min(1, sizes[i] / Math.max(w, h)), cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
          var cx = cv.getContext('2d'); cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0, cv.width, cv.height);
          for (var j = 0; j < qs.length; j++) {
            var out = cv.toDataURL('image/jpeg', qs[j]);
            if (!best || out.length < best.length) best = out;
            if (out.length <= PHOTO_LIMIT) { res(out); return; }
          }
        }
        res(best);
      };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('decode')); };
      im.src = url;
    });
  }

  /* ------------------------------------------------------------------ page */
  function filtered() {
    var q = st.q.trim().toLowerCase();
    return D.properties.filter(function (p) {
      if (!p) return false;
      if ((st.show === 'archived') !== !!p.archived) return false;
      if (st.city && cityOf(p) !== st.city) return false;
      if (!q) return true;
      return [p.name, p.short, p.area, p.address, p.type, p.owner, staffName(p.housekeeper)].some(function (x) { return x && String(x).toLowerCase().indexOf(q) >= 0; });
    });
  }
  function cardHTML(p) {
    var s = statusOf(p), photos = Array.isArray(p.photos) ? p.photos.length : 0, miss = canEdit() && !p.archived ? missing(p) : [];
    var hk = staffName(p.housekeeper);
    return '<button type="button" class="pp-card' + (p.archived ? ' arch' : '') + '" data-open="' + esc(p.id) + '" aria-label="' + esc(p.name + ', ' + s.t) + '">' +
      '<span class="pp-ph">' + cover(p) + U.pill(s.t, s.kind) + (photos > 1 ? '<span class="pp-cnt">' + O.icon('image') + photos + '</span>' : '') + '</span>' +
      '<span class="pp-b"><span class="pp-nm">' + esc(p.name) + '</span>' +
      '<span class="pp-loc">' + O.icon('pin') + '<span>' + esc(p.area || 'Location not set') + '</span></span>' +
      '<span class="pp-meta"><span>' + esc(p.type || bedsText(p)) + (p.maxGuests ? ' · sleeps ' + esc(p.maxGuests) : '') + '</span><span class="st-sm">' + U.pill(s.t, s.kind) + '</span></span>' +
      (miss.length ? '<span class="pp-warn">' + O.icon('alert') + '<span>Add the ' + esc(miss.join(', ')) + '</span></span>' : '') +
      '<span class="pp-ft"><span class="who' + (hk ? '' : ' none') + '">' + (hk ? U.avatar(hk, 'sm') + ' ' + esc(hk) : 'No housekeeper yet') + '</span>' +
      (canSeePrice() ? '<span class="pp-price">' + fmt.money(+p.base || 0) + '<small> / night</small></span>' : '') + '</span>' +
      '</span></button>';
  }
  function tableHTML(list) {
    var price = canSeePrice(), own = canSeeOwner();
    return '<div class="card"><div class="table-wrap"><table class="table pp-tbl"><thead><tr><th></th><th>Property</th><th>Location</th><th>Type</th>' + (price ? '<th class="num">Base / night</th>' : '') + '<th>Housekeeper</th>' + (own ? '<th>Owner</th>' : '') + '<th>Today</th></tr></thead><tbody>' +
      list.map(function (p) {
        var s = statusOf(p), hk = staffName(p.housekeeper);
        return '<tr class="click' + (p.archived ? ' arch' : '') + '" data-open="' + esc(p.id) + '" tabindex="0"><td><span class="th">' + cover(p) + '</span></td>' +
          '<td><div class="t1">' + esc(p.name) + '</div><div class="t2">' + esc(p.short || '') + '</div></td>' +
          '<td><div>' + esc(hoodOf(p) || cityOf(p)) + '</div><div class="t2">' + esc(hoodOf(p) ? cityOf(p) : '') + '</div></td>' +
          '<td>' + esc(p.type || '') + '</td>' + (price ? '<td class="num">' + fmt.money(+p.base || 0) + '</td>' : '') +
          '<td>' + (hk ? esc(hk) : '<span class="faint">Not set</span>') + '</td>' + (own ? '<td>' + esc(p.owner || '') + '</td>' : '') +
          '<td>' + U.pill(s.t, s.kind) + '<div class="t2">' + esc(s.s) + '</div></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  function emptyHTML(canCreate) {
    var demo = { id: '__empty', type: '2BR condo' };
    return '<div class="card pp-empty"><div class="art">' + art(demo) + '</div><h3>Add your first property</h3>' +
      '<p>Each unit you manage lives here with its address, lock, Wi-Fi and photos. Bookings, cleaning and the guest app all start here.</p>' +
      (canCreate ? '<button type="button" class="btn btn-primary" data-act="add">' + O.icon('plus') + 'Add your first property</button>' : '<p class="small">An account owner or ops manager can add properties.</p>') + '</div>';
  }

  function render(root, ctx) {
    var canCreate = O.can('properties.create');
    ctx.setActions(canCreate && D.properties.length ? '<button type="button" class="btn btn-primary" data-act="add">' + O.icon('plus') + 'Add property</button>' : '');
    var addBtn = O.$('[data-act=add]', ctx.actionsEl); if (addBtn) addBtn.onclick = function () { openDrawer('edit', null); };

    if (!D.properties.length) {
      root.innerHTML = '<div class="pg-props">' + emptyHTML(canCreate) + '</div>';
      var b = O.$('[data-act=add]', root); if (b) b.onclick = function () { openDrawer('edit', null); };
    } else {
      var nArch = D.properties.filter(function (p) { return p && p.archived; }).length, nAct = D.properties.length - nArch;
      if (!nArch) st.show = 'active';
      root.innerHTML = '<div class="pg-props">' +
        '<div class="pp-tools"><label class="search">' + O.icon('search') + '<input type="search" data-q placeholder="Search name, area, owner or housekeeper" aria-label="Search properties" value="' + esc(st.q) + '"></label>' +
        (nArch ? U.seg([['active', 'Active ' + nAct], ['archived', 'Archived ' + nArch]], st.show, 'data-show') : '') +
        '<span class="spacer"></span><span class="view-seg">' + U.seg([['cards', 'Cards'], ['list', 'List']], st.view, 'data-view') + '</span></div>' +
        '<div class="chips pp-cities" data-cities></div><div data-list></div></div>';
      var wrap = O.$('.pg-props', root);
      var paint = function () {
        var pool = D.properties.filter(function (p) { return p && (st.show === 'archived') === !!p.archived; });
        var cities = []; pool.forEach(function (p) { var c = cityOf(p); if (c && cities.indexOf(c) < 0) cities.push(c); });
        if (st.city && cities.indexOf(st.city) < 0) st.city = '';
        O.$('[data-cities]', wrap).innerHTML = cities.length > 1 ? ['<button type="button" class="chip' + (st.city ? '' : ' on') + '" data-city="">All <span class="n">' + pool.length + '</span></button>'].concat(cities.map(function (c) {
          return '<button type="button" class="chip' + (st.city === c ? ' on' : '') + '" data-city="' + esc(c) + '">' + esc(c) + ' <span class="n">' + pool.filter(function (p) { return cityOf(p) === c; }).length + '</span></button>';
        })).join('') : '';
        var list = filtered(), box = O.$('[data-list]', wrap);
        if (!list.length) {
          box.innerHTML = '<div class="card pp-none">' + (st.q ? 'No properties match "' + esc(st.q) + '".' : 'No properties here.') + '<div><button type="button" class="btn btn-ghost btn-sm" data-clear>Clear search</button></div></div>';
          return;
        }
        var phone = window.matchMedia && window.matchMedia('(max-width:760px)').matches;
        box.innerHTML = st.view === 'list' && !phone ? tableHTML(list) : '<div class="pp-grid">' + list.map(cardHTML).join('') + '</div>';
      };
      paint();
      var qIn = O.$('[data-q]', wrap);
      qIn.addEventListener('input', function () { st.q = qIn.value; paint(); });
      wrap.addEventListener('click', function (e) {
        var o = e.target.closest('[data-open]'); if (o) { openDrawer('view', o.dataset.open); return; }
        var sh = e.target.closest('[data-show]'); if (sh) { st.show = sh.dataset.show; st.city = ''; ctx.rerender(); return; }
        var v = e.target.closest('[data-view]'); if (v) { st.view = v.dataset.view; O.store.set('properties:view', st.view); ctx.rerender(); return; }
        var c = e.target.closest('[data-city]'); if (c) { st.city = c.dataset.city; paint(); return; }
        if (e.target.closest('[data-clear]')) { st.q = ''; st.city = ''; qIn.value = ''; paint(); }
      });
      wrap.addEventListener('keydown', function (e) { var o = e.target.closest('tr[data-open]'); if (o && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDrawer('view', o.dataset.open); } });
    }

    /* deep links: {propertyId} opens a unit, {add: true} opens the form */
    var P = ctx.params || {};
    if (P.propertyId && D.propById[P.propertyId]) { var pid = P.propertyId; P.propertyId = null; setTimeout(function () { openDrawer('view', pid); }, 0); }
    else if (P.add) { P.add = false; if (canCreate) setTimeout(function () { openDrawer('edit', null); }, 0); }
  }

  /* ------------------------------------------------------------------ drawer */
  function openDrawer(mode, id) {
    if (DR && !document.body.contains(DR.dr.el)) { if (DR.off) DR.off(); DR = null; }
    if (!DR) {
      var dr = U.drawer({ title: '', body: '', foot: '<span></span>' });
      dr.el.classList.add('pp-dr');
      DR = { dr: dr };
      var guard = function () {
        if (DR && DR.mode === 'edit' && DR.dirty) U.confirm('Discard your changes?', 'Discard', 'danger').then(function (ok) { if (ok) closeDrawer(); });
        else closeDrawer();
      };
      var back = dr.el.previousElementSibling; if (back && back.classList.contains('drawer-back')) back.onclick = guard;
      O.$('.modal-x', dr.el).onclick = guard;
      DR.off = O.on('data', function () {
        if (!DR) return;
        if (!document.body.contains(DR.dr.el)) { if (DR.off) DR.off(); DR = null; return; }
        if (DR.mode === 'view') paintView();
      });
      dr.el.addEventListener('click', onDrawerClick);
      dr.el.addEventListener('input', function (e) { if (DR && DR.mode === 'edit') { DR.dirty = true; onFormInput(e); } });
      dr.el.addEventListener('change', function (e) { if (DR && DR.mode === 'edit') { DR.dirty = true; onFormInput(e); } });
    }
    DR.mode = mode; DR.id = id; DR.dirty = false; DR.pic = 0; DR.busy = 0;
    if (mode === 'view') paintView(); else startEdit();
    O.$('.modal-body', DR.dr.el).scrollTop = 0;
  }
  function closeDrawer() { if (!DR) return; var x = DR; DR = null; if (x.off) x.off(); x.dr.close(); }
  function parts() { var el = DR.dr.el; return { h: O.$('.modal-head h3', el), sub: O.$('.modal-head .sub', el), body: O.$('.modal-body', el), foot: O.$('.modal-foot', el) }; }

  /* ---- view ---- */
  function kv(rows) { return '<dl class="pp-kv">' + rows.filter(Boolean).map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>'; }
  function galleryHTML(p) {
    var ph = Array.isArray(p.photos) ? p.photos : [], i = Math.min(DR.pic || 0, Math.max(0, ph.length - 1));
    return '<div class="pp-gal"><div class="pp-ph' + (ph.length ? '' : ' art') + '">' + (ph.length ? '<img src="' + esc(ph[i]) + '" alt="Photo ' + (i + 1) + ' of ' + esc(p.name) + '">' : art(p)) + '</div>' +
      (ph.length > 1 ? '<div class="pp-thumbs">' + ph.map(function (src, k) { return '<button type="button" class="' + (k === i ? 'on' : '') + '" data-pic="' + k + '" aria-label="Show photo ' + (k + 1) + '"><img src="' + esc(src) + '" alt=""></button>'; }).join('') + '</div>' : '') + '</div>';
  }
  function paintView() {
    var p = D.propById[DR.id], X = parts();
    if (!p) { closeDrawer(); return; }
    var s = statusOf(p), up = upcoming(p.id), hk = p.housekeeper && D.staffById(p.housekeeper), access = canAccess();
    X.h.textContent = p.name;
    X.sub.textContent = [p.short, p.area].filter(Boolean).join(' · ');
    var mapHref = p.mapUrl || (p.address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.address) : '');
    var others = p.owner ? D.properties.filter(function (x) { return x !== p && x.owner === p.owner && !x.archived; }) : [];
    var miss = canEdit() && !p.archived ? missing(p) : [];
    var html = galleryHTML(p) + '<div class="pp-vbody">' +
      '<div class="pp-now">' + U.pill(s.t, s.kind) + '<span>' + esc(s.s) + '</span></div>' +
      (miss.length ? '<div class="note warn pp-miss">' + O.icon('alert').replace('<svg ', '<svg style="width:15px;height:15px;flex:none;margin-top:1px" ') + '<span>Add the ' + esc(miss.join(', ')) + ' so cleaning tasks and the guest app have what they need.</span></div>' : '') +
      (canEdit() && !p.archived && !(p.photos && p.photos.length) ? '<div class="note">Add a few photos. The website and the guest app show them.</div>' : '') +
      '<div class="pp-quick">' +
      (O.can('bookings') ? '<button type="button" class="btn btn-ghost btn-sm" data-dv="bookings">' + O.icon('bookings') + 'Bookings' + (up.length ? ' · ' + up.length + ' upcoming' : '') + '</button>' : '') +
      (O.can('calendar') ? '<button type="button" class="btn btn-ghost btn-sm" data-dv="calendar">' + O.icon('calendar') + 'Calendar</button>' : '') +
      (mapHref ? '<a class="btn btn-ghost btn-sm" href="' + esc(mapHref) + '" target="_blank" rel="noopener">' + O.icon('map') + 'Directions</a>' : '') +
      '</div>' +
      '<section class="pp-vs"><h4>Stay</h4>' + kv([
        ['Type', esc(p.type || '') + (p.type && /BR|Studio/i.test(p.type) ? '' : ' · ' + esc(bedsText(p)))],
        p.maxGuests ? ['Sleeps', esc(fmt.plural(+p.maxGuests, 'guest'))] : null,
        canSeePrice() ? ['Base price', '<span class="pp-price">' + fmt.money(+p.base || 0) + '</span> <span class="xs muted">per night</span>'] : null,
        ['Check-in', 'From ' + esc(fmt.time(p.checkInTime || '15:00'))],
        ['Check-out', 'By ' + esc(fmt.time(p.checkOutTime || '11:00'))],
        p.notes ? ['Team notes', esc(p.notes)] : null
      ]) + '</section>' +
      '<section class="pp-vs"><h4>Location</h4>' + kv([
        ['Area', esc(p.area || 'Not set')],
        ['Address', p.address ? esc(p.address).replace(/\n/g, '<br>') : '<span class="faint">Not added yet</span>']
      ]) + '</section>' +
      '<section class="pp-vs"><h4>Access</h4>' + (access ? kv([
        ['Lock', '<span class="pp-inl">' + (p.lockBrand ? esc(p.lockBrand) + ' smart lock' : '<span class="faint">No lock added</span>') + '</span>'],
        ['Master code', p.lockCode ? '<span class="pp-inl"><span class="kbd">' + esc(p.lockCode) + '</span>' + (O.can('guestapp.doorCodes') && !p.archived ? '<button type="button" class="btn btn-quiet btn-xs" data-dv="lock">Change on the lock</button>' : '') + '</span>' : '<span class="faint">Not set</span>'],
        ['Wi-Fi', p.wifi && p.wifi[0] ? esc(p.wifi[0]) : '<span class="faint">Not set</span>'],
        p.wifi && p.wifi[1] ? ['Password', '<span class="pp-inl"><span class="kbd">' + esc(p.wifi[1]) + '</span><button type="button" class="btn btn-quiet btn-xs" data-dv="copywifi">' + O.icon('copy') + 'Copy</button></span>'] : null,
        ['Parking', p.parking ? esc(p.parking) : '<span class="faint">Not set</span>']
      ]) : '<div class="note">Lock codes, Wi-Fi passwords and parking are hidden for your role. An account owner can allow them in Staff Access.</div>') + '</section>' +
      '<section class="pp-vs"><h4>Team' + (canSeeOwner() ? ' and owner' : '') + '</h4><div class="stack" style="gap:10px">' +
      '<div class="pp-person">' + (hk ? U.avatar(hk.name) : '<span class="avatar" style="background:var(--border-strong)">?</span>') + '<div class="grow"><b>' + esc(hk ? hk.name : 'No housekeeper yet') + '</b><span>' + esc(hk ? 'Housekeeper' + (hk.phone ? ' · ' + hk.phone : '') : 'Turnover tasks for this unit are created unassigned') + '</span></div></div>' +
      (canSeeOwner() ? '<div class="pp-person">' + U.avatar(p.owner || '?') + '<div class="grow"><b>' + esc(p.owner || 'Owner not set') + '</b><span>' + esc(['Owner'].concat([p.ownerPhone, p.ownerEmail].filter(Boolean)).join(' · ')) + '</span>' + (others.length ? '<span class="xs" style="display:block">Also owns ' + esc(others.map(function (x) { return x.short || x.name; }).join(', ')) + '</span>' : '') + '</div></div>' : '') +
      '</div></section></div>';
    X.body.innerHTML = html;
    var left = '', right = '';
    if (O.can('properties.archive')) left = p.archived ? '<button type="button" class="btn btn-ghost" data-dv="restore">' + O.icon('refresh') + 'Restore</button>' : '<button type="button" class="btn btn-ghost" data-dv="archive">Archive</button>';
    if (canEdit() && !p.archived) right = '<button type="button" class="btn btn-primary" data-dv="edit">' + O.icon('edit') + 'Edit details</button>';
    else if (canEdit() && p.archived) right = '<span class="small muted">Restore it to edit the details.</span>';
    X.foot.innerHTML = left + '<div class="r">' + (right || '<button type="button" class="btn btn-ghost" data-dv="close">Close</button>') + '</div>';
  }

  function copyText(text, msg) {
    var done = function () { U.toast(msg); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () { U.toast('Copying is blocked here. The password is ' + text, 'bad'); }); return; }
    } catch (e) { /* fall through */ }
    U.toast('Copying is blocked here. The password is ' + text, 'bad');
  }

  function archive(p) {
    var up = upcoming(p.id);
    var msg = p.name + ' leaves the property pickers and cannot take new bookings. ' +
      (up.length ? 'Its ' + fmt.plural(up.length, 'upcoming booking') + ' stay as they are and still need hosting. ' : 'It has no upcoming bookings. ') +
      'Past bookings, reports and statements keep it. You can restore it any time from Archived.';
    U.confirm(msg, 'Archive', up.length ? 'danger' : 'primary', 'Archive ' + p.name + '?').then(function (ok) {
      if (!ok) return;
      p.archived = true; p.archivedAt = D.NOW; p.archivedBy = O.state.viewer;
      audit('Archived ' + p.name);
      O.emit('data');
      U.toast(p.name + ' archived. Find it under Archived.');
    });
  }
  function restore(p) {
    delete p.archived; delete p.archivedAt; delete p.archivedBy;
    audit('Restored ' + p.name);
    O.emit('data');
    U.toast(p.name + ' is active again');
  }

  /* ---- edit ---- */
  function startEdit() {
    var p = DR.id ? D.propById[DR.id] : null;
    if (DR.id && !p) { closeDrawer(); return; }
    if (p ? !canEdit() : !O.can('properties.create')) { U.toast('Your access does not include ' + (p ? 'editing' : 'adding') + ' properties.', 'bad'); if (p) { DR.mode = 'view'; paintView(); } else closeDrawer(); return; }
    var hkDefault = (activeStaff().filter(function (s) { return s.role === 'housekeeping'; })[0] || {}).id || '';
    var lockDefault = (function () { var c = {}, best = ''; D.properties.forEach(function (x) { if (x.lockBrand) { c[x.lockBrand] = (c[x.lockBrand] || 0) + 1; if (!best || c[x.lockBrand] > c[best]) best = x.lockBrand; } }); return best; })();
    DR.draft = p ? {
      name: p.name || '', short: p.short || '', kind: kindOf(p), beds: +p.beds || 0, base: p.base || '', maxGuests: p.maxGuests || '',
      checkInTime: p.checkInTime || '15:00', checkOutTime: p.checkOutTime || '11:00', notes: p.notes || '',
      hood: hoodOf(p), city: cityOf(p), address: p.address || '', mapUrl: p.mapUrl || '',
      lockBrand: p.lockBrand || '', lockCode: p.lockCode || '', wifiName: (p.wifi && p.wifi[0]) || '', wifiPw: (p.wifi && p.wifi[1]) || '', parking: p.parking || '',
      photos: Array.isArray(p.photos) ? p.photos.slice(0, MAX_PHOTOS) : [], owner: p.owner || '', ownerPhone: p.ownerPhone || '', ownerEmail: p.ownerEmail || '', housekeeper: p.housekeeper || ''
    } : {
      name: '', short: '', kind: 'Apartment', beds: 1, base: '', maxGuests: '', checkInTime: '15:00', checkOutTime: '11:00', notes: '',
      hood: '', city: '', address: '', mapUrl: '', lockBrand: lockDefault, lockCode: '', wifiName: '', wifiPw: '', parking: '',
      photos: [], owner: '', ownerPhone: '', ownerEmail: '', housekeeper: hkDefault
    };
    var X = parts();
    X.h.textContent = p ? 'Edit ' + p.name : 'Add a property';
    X.sub.textContent = p ? 'Changes show everywhere straight away' : 'Fill in what you know now. You can add the rest later.';
    X.body.innerHTML = formHTML(DR.draft, !p);
    X.foot.innerHTML = '<button type="button" class="btn btn-ghost" data-de="cancel">Cancel</button><div class="r"><button type="button" class="btn btn-primary" data-de="save">' + (p ? 'Save changes' : 'Add property') + '</button></div>';
    syncForm();
    if (!p) setTimeout(function () { var f = O.$('[name=name]', DR && DR.dr.el); if (f && window.matchMedia && !window.matchMedia('(max-width:760px)').matches) f.focus(); }, 40);
  }
  function opt(label) { return ' <span class="opt">(optional)</span>'; }
  function fld(name, label, input, o) {
    o = o || {};
    return '<div class="field' + (o.full ? ' full' : '') + '"' + (o.attr || '') + '><label for="pp-' + name + '">' + esc(label) + (o.opt ? opt() : '') + '</label>' + input +
      (o.hint ? '<div class="hint">' + esc(o.hint) + '</div>' : '') + '<div class="pp-err" data-err="' + name + '"></div></div>';
  }
  function inp(name, val, attrs) { return '<input class="input" id="pp-' + name + '" name="' + name + '" value="' + esc(val == null ? '' : val) + '"' + (attrs || '') + '>'; }
  function datalist(id, items) { return '<datalist id="' + id + '">' + items.map(function (x) { return '<option value="' + esc(x) + '"></option>'; }).join('') + '</datalist>'; }
  function formHTML(f, isNew) {
    var kinds = KINDS.indexOf(f.kind) >= 0 ? KINDS : KINDS.concat([f.kind]);
    var cityList = CITIES.slice(); D.properties.forEach(function (x) { var c = cityOf(x); if (c && cityList.indexOf(c) < 0) cityList.push(c); });
    var lockList = LOCKS.slice(); D.properties.forEach(function (x) { if (x.lockBrand && lockList.indexOf(x.lockBrand) < 0) lockList.push(x.lockBrand); });
    var ows = owners(), wsName = O.ws().name, known = ows.some(function (o) { return o.name === f.owner; });
    var ownOpts = '<option value="">Choose the owner</option>' + ows.map(function (o) { return '<option value="' + esc(o.name) + '"' + (o.name === f.owner ? ' selected' : '') + '>' + esc(o.name) + ' · ' + fmt.plural(o.units.length, 'unit') + '</option>'; }).join('') +
      (ows.some(function (o) { return o.name === wsName; }) ? '' : '<option value="' + esc(wsName) + '"' + (f.owner === wsName ? ' selected' : '') + '>' + esc(wsName) + ' (company owned)</option>') +
      '<option value="' + NEW_OWNER + '"' + (f.owner && !known && f.owner !== wsName ? ' selected' : '') + '>Add a new owner…</option>';
    var staff = activeStaff(), hkG = staff.filter(function (s) { return s.role === 'housekeeping'; }), others = staff.filter(function (s) { return s.role !== 'housekeeping'; });
    if (f.housekeeper && !staff.some(function (s) { return s.id === f.housekeeper; }) && D.staffById(f.housekeeper)) others.push(D.staffById(f.housekeeper));
    var so = function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === f.housekeeper ? ' selected' : '') + '>' + esc(s.name) + ' · ' + esc(s.roleLabel || s.role) + '</option>'; };
    var hkOpts = '<option value="">Not assigned yet</option>' + (hkG.length ? '<optgroup label="Housekeeping">' + hkG.map(so).join('') + '</optgroup>' : '') + (others.length ? '<optgroup label="' + (hkG.length ? 'Everyone else' : 'Team') + '">' + others.map(so).join('') + '</optgroup>' : '');
    var access = canAccess();
    return '<form class="pp-form" data-form novalidate autocomplete="off">' +
      '<div class="pp-sec"><h4>Basics</h4><div class="sd">How the unit appears across the app.</div><div class="form-grid">' +
      fld('name', 'Property name', inp('name', f.name, ' maxlength="60" placeholder="e.g. Bayfront Loft 3B"'), { full: true }) +
      fld('short', 'Short name', inp('short', f.short, ' maxlength="20" placeholder="' + esc(suggestShort(f.name) || 'e.g. Bayfront 3B') + '"'), { opt: true, hint: 'For the calendar and phone screens. Left empty, we shorten the name.' }) +
      fld('kind', 'Kind of home', '<select class="select" id="pp-kind" name="kind">' + kinds.map(function (k) { return '<option' + (k === f.kind ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select>') +
      fld('beds', 'Bedrooms', inp('beds', f.beds, ' type="number" min="0" max="30" step="1" inputmode="numeric"'), { hint: '0 for a studio' }) +
      fld('base', 'Base nightly price', '<div class="pp-money"><span>RM</span>' + inp('base', f.base, ' type="number" min="0" step="5" inputmode="decimal" placeholder="220"') + '</div>', { hint: 'Pricing starts from this and adjusts by day.' }) +
      '</div></div>' +

      '<div class="pp-sec"><h4>Location</h4><div class="sd">Shown to guests and used for local events in pricing.</div><div class="form-grid">' +
      fld('hood', 'Area or neighbourhood', inp('hood', f.hood, ' maxlength="60" placeholder="e.g. Gurney Drive"'), { opt: true }) +
      fld('city', 'City or state', inp('city', f.city, ' maxlength="40" list="pp-cities" placeholder="e.g. Penang"') + datalist('pp-cities', cityList)) +
      fld('address', 'Full address', '<textarea class="textarea" id="pp-address" name="address" rows="2" maxlength="240" placeholder="Unit, building, street, postcode">' + esc(f.address) + '</textarea>', { full: true, opt: true }) +
      fld('mapUrl', 'Map link', inp('mapUrl', f.mapUrl, ' type="url" inputmode="url" maxlength="400" placeholder="https://maps.app.goo.gl/..."'), { full: true, opt: true, hint: 'Paste a Google Maps or Waze link. Without one, directions use the address.' }) +
      '</div></div>' +

      '<div class="pp-sec"><h4>Stay rules</h4><div class="sd">New bookings for this unit start with these times.</div><div class="form-grid">' +
      fld('checkInTime', 'Check-in from', inp('checkInTime', f.checkInTime, ' type="time" step="900"')) +
      fld('checkOutTime', 'Check-out by', inp('checkOutTime', f.checkOutTime, ' type="time" step="900"')) +
      fld('maxGuests', 'Sleeps up to', inp('maxGuests', f.maxGuests, ' type="number" min="1" max="50" step="1" inputmode="numeric" placeholder="e.g. 4"'), { opt: true }) +
      '<div></div>' +
      fld('notes', 'Notes for the team', '<textarea class="textarea" id="pp-notes" name="notes" rows="2" maxlength="500" placeholder="e.g. Spare towels in the hall cupboard. Shoes off inside.">' + esc(f.notes) + '</textarea>', { full: true, opt: true }) +
      '</div></div>' +

      '<div class="pp-sec"><h4>Access</h4><div class="sd">The lock, Wi-Fi and parking guests and cleaners need.</div>' +
      (access ? '<div class="form-grid">' +
        fld('lockBrand', 'Smart lock', inp('lockBrand', f.lockBrand, ' maxlength="30" list="pp-locks" placeholder="e.g. Yale"') + datalist('pp-locks', lockList), { opt: true }) +
        fld('lockCode', 'Master code', inp('lockCode', f.lockCode, ' maxlength="8" inputmode="numeric" placeholder="4 to 8 digits"'), { opt: true, hint: isNew ? 'For staff and cleaners. Guests get their own code per stay.' : 'Changing it here updates the lock remotely.' }) +
        fld('wifiName', 'Wi-Fi name', inp('wifiName', f.wifiName, ' maxlength="40"'), { opt: true }) +
        fld('wifiPw', 'Wi-Fi password', inp('wifiPw', f.wifiPw, ' maxlength="63"'), { opt: true }) +
        fld('parking', 'Parking', inp('parking', f.parking, ' maxlength="80" placeholder="e.g. Bay B2-14, or No parking"'), { full: true, opt: true }) +
        '</div>' : '<div class="note">Lock codes, Wi-Fi passwords and parking are hidden for your role, so they stay as they are.</div>') + '</div>' +

      '<div class="pp-sec"><h4>Photos</h4><div class="sd">Up to 4. The first is the cover on the website and in the guest app. Photos are made smaller on this device before saving.</div><div data-photos>' + photosHTML() + '</div></div>' +

      '<div class="pp-sec"><h4>Owner and team</h4><div class="sd">Owner statements group units by owner. The housekeeper gets this unit\'s cleaning tasks.</div><div class="form-grid">' +
      fld('owner', 'Owner', '<select class="select" id="pp-owner" name="ownerSel">' + ownOpts + '</select>', { full: true }) +
      '<div class="pp-newown" data-newown' + (f.owner && !known && f.owner !== wsName ? '' : ' hidden') + '>' + fld('ownerName', 'New owner\'s name', inp('ownerName', known || f.owner === wsName ? '' : f.owner, ' maxlength="60" placeholder="e.g. Rajan Pillai"'), { full: true }) + '</div>' +
      fld('ownerPhone', 'Owner\'s phone', inp('ownerPhone', f.ownerPhone, ' type="tel" inputmode="tel" maxlength="24" placeholder="+60 12-345 6789"'), { opt: true }) +
      fld('ownerEmail', 'Owner\'s email', inp('ownerEmail', f.ownerEmail, ' type="email" inputmode="email" maxlength="80"'), { opt: true }) +
      fld('housekeeper', 'Housekeeper', '<select class="select" id="pp-housekeeper" name="housekeeper">' + hkOpts + '</select>', { full: true, hint: staff.length < 2 ? 'Invite your team in Staff Access to assign a housekeeper.' : '' }) +
      '</div></div>' +
      '</form>';
  }
  function photosHTML() {
    var f = DR.draft, n = f.photos.length;
    return '<div class="pp-photos">' + f.photos.map(function (src, i) {
      return '<div class="pp-pt"><img src="' + esc(src) + '" alt="Photo ' + (i + 1) + '">' + (i === 0 ? '<span class="cover">Cover</span>' : '') +
        '<div class="bar"><button type="button" data-ph="left" data-i="' + i + '" aria-label="Move photo ' + (i + 1) + ' earlier"' + (i === 0 ? ' disabled' : '') + '>' + O.icon('left') + '</button>' +
        '<button type="button" data-ph="right" data-i="' + i + '" aria-label="Move photo ' + (i + 1) + ' later"' + (i === n - 1 ? ' disabled' : '') + '>' + O.icon('right') + '</button>' +
        '<button type="button" data-ph="del" data-i="' + i + '" aria-label="Remove photo ' + (i + 1) + '">' + O.icon('trash') + '</button></div></div>';
    }).join('') +
      (DR.busy ? '<div class="pp-pt busy"><span class="spinner"></span>Preparing photo…</div>' : '') +
      (n + (DR.busy ? 1 : 0) < MAX_PHOTOS ? '<label class="pp-pt add">' + O.icon('camera') + '<b>' + (n ? 'Add more photos' : 'Add photos') + '</b><span>' + (n ? (MAX_PHOTOS - n) + ' more can go here' : 'Up to ' + MAX_PHOTOS + ', JPG or PNG') + '</span><input type="file" accept="image/*" multiple hidden data-phfile aria-label="Add property photos"></label>' : '') +
      '</div>';
  }
  function paintPhotos() { var box = DR && O.$('[data-photos]', DR.dr.el); if (box) box.innerHTML = photosHTML(); }
  function addPhotos(files) {
    files = Array.prototype.slice.call(files || []);
    var room = MAX_PHOTOS - DR.draft.photos.length, take = files.slice(0, Math.max(0, room)), errs = [];
    if (files.length > room) U.toast(room > 0 ? 'Only ' + fmt.plural(room, 'more photo') + ' fit, so the first ' + room + ' were added.' : 'Up to 4 photos per property. Remove one to add another.', 'bad');
    var ref = DR;
    (function next() {
      if (DR !== ref || DR.mode !== 'edit') return;
      var file = take.shift();
      if (!file) {
        DR.busy = 0; paintPhotos();
        if (errs.length) U.toast(errs[0], 'bad');
        return;
      }
      DR.busy = 1; paintPhotos();
      compressPhoto(file).then(function (url) {
        if (DR !== ref || DR.mode !== 'edit') return;
        if (DR.draft.photos.length < MAX_PHOTOS) { DR.draft.photos.push(url); DR.dirty = true; }
        next();
      }, function (e) {
        errs.push(e.message === 'type' ? '"' + (file.name || 'That file') + '" is not a photo. Choose a JPG, PNG or WebP image.' : e.message === 'size' ? '"' + (file.name || 'That photo') + '" is over 40 MB. Choose a smaller photo.' : '"' + (file.name || 'That photo') + '" could not be read here. Save it as JPG or PNG and try again.');
        next();
      });
    })();
  }
  function val(name) { var el = O.$('[name="' + name + '"]', DR.dr.el); return el ? String(el.value).trim() : null; }
  function syncForm() { /* live parts of the form: studio bedrooms, new owner fields, short name hint */
    var el = DR.dr.el, kind = O.$('[name=kind]', el), beds = O.$('[name=beds]', el);
    if (kind && beds) { var studio = kind.value === 'Studio'; if (studio) beds.value = 0; beds.disabled = studio; }
    var sel = O.$('[name=ownerSel]', el), box = O.$('[data-newown]', el);
    if (sel && box) box.hidden = sel.value !== NEW_OWNER;
    var sh = O.$('[name=short]', el), nm = O.$('[name=name]', el);
    if (sh && nm) sh.placeholder = suggestShort(nm.value) || 'e.g. Bayfront 3B';
  }
  function onFormInput(e) {
    var t = e.target; if (!t) return;
    if (t.matches('[data-phfile]')) { if (e.type === 'change') { addPhotos(t.files); t.value = ''; } return; }
    if (!t.name) return;
    var err = O.$('[data-err="' + (t.name === 'ownerSel' ? 'owner' : t.name) + '"]', DR.dr.el); if (err) err.textContent = '';
    t.classList.remove('bad');
    if (t.name === 'ownerSel' && e.type === 'change') {
      var o = owners().filter(function (x) { return x.name === t.value; })[0], ph = O.$('[name=ownerPhone]', DR.dr.el), em = O.$('[name=ownerEmail]', DR.dr.el);
      if (o) { if (ph && !ph.value) ph.value = o.phone; if (em && !em.value) em.value = o.email; }
      if (t.value === NEW_OWNER) setTimeout(function () { var n = O.$('[name=ownerName]', DR && DR.dr.el); if (n) n.focus(); }, 30);
    }
    syncForm();
  }
  function readForm() {
    var sel = val('ownerSel');
    return {
      name: val('name') || '', short: val('short') || '', kind: val('kind') || 'Apartment', beds: val('beds'), base: val('base'), maxGuests: val('maxGuests'),
      checkInTime: val('checkInTime') || '', checkOutTime: val('checkOutTime') || '', notes: val('notes') || '',
      hood: (val('hood') || '').replace(/,\s*$/, ''), city: val('city') || '', address: val('address') || '', mapUrl: val('mapUrl') || '',
      lockBrand: val('lockBrand'), lockCode: val('lockCode'), wifiName: val('wifiName'), wifiPw: val('wifiPw'), parking: val('parking'),
      ownerName: sel === NEW_OWNER ? (val('ownerName') || '') : (sel || ''), ownerNew: sel === NEW_OWNER, ownerPhone: val('ownerPhone') || '', ownerEmail: val('ownerEmail') || '',
      housekeeper: val('housekeeper') || ''
    };
  }
  function validate(v, p) {
    var E = {}, low = function (s) { return String(s || '').trim().toLowerCase(); };
    var others = D.properties.filter(function (x) { return x !== p; });
    if (!v.name) E.name = 'Give the property a name, for example "Bayfront Loft 3B".';
    else if (others.some(function (x) { return low(x.name) === low(v.name); })) E.name = 'Another property is already called "' + v.name + '". Add a unit number to tell them apart.';
    var short = v.short || suggestShort(v.name);
    if (v.short && v.short.length > 20) E.short = 'Keep the short name to 20 characters so it fits on the calendar.';
    else if (short && others.some(function (x) { return low(x.short) === low(short); })) E.short = v.short ? 'Another property already uses this short name.' : 'The shortened name "' + short + '" is already used. Type a different short name.';
    var beds = v.beds === '' || v.beds == null ? NaN : Number(v.beds);
    if (!(beds >= 0 && beds <= 30 && Math.floor(beds) === beds)) E.beds = 'Enter the number of bedrooms, 0 for a studio.';
    var base = v.base === '' || v.base == null ? NaN : Number(v.base);
    if (!(base > 0)) E.base = 'Enter the usual price for one night in RM, for example 220.';
    else if (base < 20 || base > 50000) E.base = 'That looks unusual. Enter a nightly price between RM 20 and RM 50,000.';
    if (!v.city) E.city = 'Add the city or state, for example Penang.';
    if (v.mapUrl && !/^https?:\/\/\S+$/i.test(v.mapUrl)) E.mapUrl = 'Paste the full link, starting with https://';
    if (!/^\d{2}:\d{2}$/.test(v.checkInTime)) E.checkInTime = 'Choose a check-in time.';
    if (!/^\d{2}:\d{2}$/.test(v.checkOutTime)) E.checkOutTime = 'Choose a check-out time.';
    else if (!E.checkInTime && v.checkOutTime >= v.checkInTime) E.checkOutTime = 'Check-out should be earlier than check-in so there is time to clean between guests.';
    if (v.maxGuests) { var g = Number(v.maxGuests); if (!(g >= 1 && g <= 50 && Math.floor(g) === g)) E.maxGuests = 'Enter how many guests can stay, from 1 to 50.'; }
    if (v.lockCode && !/^\d{4,8}$/.test(v.lockCode)) E.lockCode = 'Master codes are 4 to 8 digits.';
    else if (v.lockCode && (/^(\d)\1+$/.test(v.lockCode) || '01234567890'.indexOf(v.lockCode) >= 0 || '9876543210'.indexOf(v.lockCode) >= 0)) E.lockCode = 'That code is easy to guess. Avoid repeated or running digits.';
    if (!v.ownerName) E[v.ownerNew ? 'ownerName' : 'owner'] = v.ownerNew ? 'Type the new owner\'s name.' : 'Choose who owns this property, or add a new owner.';
    if (v.ownerPhone && !/^\+?[\d\s()-]{7,20}$/.test(v.ownerPhone)) E.ownerPhone = 'Check the phone number. Use digits, spaces and +.';
    if (v.ownerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.ownerEmail)) E.ownerEmail = 'Check the email address.';
    return E;
  }
  function showErrors(E) {
    var el = DR.dr.el, first = null;
    O.$$('.pp-err', el).forEach(function (x) { x.textContent = ''; });
    O.$$('.bad', el).forEach(function (x) { x.classList.remove('bad'); });
    Object.keys(E).forEach(function (k) {
      var box = O.$('[data-err="' + k + '"]', el); if (box) box.textContent = E[k];
      var input = O.$('[name="' + (k === 'owner' ? 'ownerSel' : k) + '"]', el); if (input) { input.classList.add('bad'); if (!first) first = input; }
    });
    if (first) { first.scrollIntoView({ block: 'center', behavior: 'smooth' }); try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }
    var n = Object.keys(E).length;
    U.toast(n === 1 ? E[Object.keys(E)[0]] : 'Check the ' + n + ' highlighted fields.', 'bad');
  }
  function setOpt(p, k, v) { if (v === '' || v == null) delete p[k]; else p[k] = v; }
  function save() {
    if (DR.busy) { U.toast('Wait a moment, a photo is still being prepared.', 'bad'); return; }
    var p = DR.id ? D.propById[DR.id] : null, isNew = !p, v = readForm(), E = validate(v, p);
    if (Object.keys(E).length) { showErrors(E); return; }
    var access = canAccess();
    if (isNew) p = { id: O.uid('P') };
    var oldCode = p.lockCode || '';
    p.name = v.name; p.short = v.short || suggestShort(v.name);
    p.beds = v.kind === 'Studio' ? 0 : Number(v.beds); p.type = typeText(v.kind, p.beds); p.base = Math.round(Number(v.base));
    p.city = v.city; p.area = v.hood ? v.hood + ', ' + v.city : v.city;
    setOpt(p, 'address', v.address); setOpt(p, 'mapUrl', v.mapUrl);
    p.checkInTime = v.checkInTime; p.checkOutTime = v.checkOutTime;
    setOpt(p, 'maxGuests', v.maxGuests ? Number(v.maxGuests) : null); setOpt(p, 'notes', v.notes);
    if (access) { p.lockBrand = v.lockBrand || ''; p.lockCode = v.lockCode || ''; p.wifi = [v.wifiName || '', v.wifiPw || '']; p.parking = v.parking || ''; }
    else if (isNew) { p.lockBrand = ''; p.lockCode = ''; p.wifi = ['', '']; p.parking = ''; }
    p.owner = v.ownerName; setOpt(p, 'ownerPhone', v.ownerPhone); setOpt(p, 'ownerEmail', v.ownerEmail);
    /* the same owner's contact details on their other units */
    if (v.ownerPhone || v.ownerEmail) D.properties.forEach(function (x) { if (x !== p && x.owner === p.owner) { if (v.ownerPhone) x.ownerPhone = v.ownerPhone; if (v.ownerEmail) x.ownerEmail = v.ownerEmail; } });
    p.housekeeper = v.housekeeper || null;
    if (DR.draft.photos.length) p.photos = DR.draft.photos.slice(0, MAX_PHOTOS); else delete p.photos;
    if (isNew) { p.createdAt = D.NOW; p.createdBy = O.state.viewer; D.properties.push(p); }
    O.reindex();
    if (access && !isNew && p.lockCode && p.lockCode !== oldCode) {
      if (Array.isArray(D.lockLog)) D.lockLog.unshift({ at: D.NOW, propertyId: p.id, bookingId: null, by: O.state.viewer, what: 'Master code changed', code: p.lockCode });
      audit('Changed the master code for ' + p.name);
    }
    audit((isNew ? 'Added property ' : 'Updated the details of ') + p.name);
    DR.mode = 'view'; DR.id = p.id; DR.dirty = false; DR.pic = 0;
    if (isNew) { st.show = 'active'; st.q = ''; st.city = ''; }
    O.emit('data');
    if (DR) O.$('.modal-body', DR.dr.el).scrollTop = 0;
    U.toast(isNew ? p.name + ' added. It is ready for bookings and cleaning tasks.' : 'Saved ' + p.name + (access && p.lockCode !== oldCode && !isNew && p.lockCode ? '. The lock has the new master code.' : ''));
  }

  function onDrawerClick(e) {
    if (!DR) return;
    var p = DR.id ? D.propById[DR.id] : null;
    var pic = e.target.closest('[data-pic]'); if (pic) { DR.pic = +pic.dataset.pic; paintView(); return; }
    var v = e.target.closest('[data-dv]');
    if (v && p) {
      var a = v.dataset.dv;
      if (a === 'edit') { DR.mode = 'edit'; startEdit(); O.$('.modal-body', DR.dr.el).scrollTop = 0; }
      if (a === 'close') closeDrawer();
      if (a === 'archive') archive(p);
      if (a === 'restore') restore(p);
      if (a === 'bookings') { closeDrawer(); O.go('bookings', { propertyId: p.id }); }
      if (a === 'calendar') { closeDrawer(); O.go('calendar', { propertyId: p.id }); }
      if (a === 'lock') O.lock.change({ propertyId: p.id, scope: 'master' });
      if (a === 'copywifi') copyText(p.wifi[1], 'Wi-Fi password copied');
      return;
    }
    var ph = e.target.closest('[data-ph]');
    if (ph && DR.mode === 'edit') {
      var i = +ph.dataset.i, list = DR.draft.photos, t;
      if (ph.dataset.ph === 'del') list.splice(i, 1);
      if (ph.dataset.ph === 'left' && i > 0) { t = list[i - 1]; list[i - 1] = list[i]; list[i] = t; }
      if (ph.dataset.ph === 'right' && i < list.length - 1) { t = list[i + 1]; list[i + 1] = list[i]; list[i] = t; }
      DR.dirty = true; paintPhotos(); return;
    }
    var de = e.target.closest('[data-de]');
    if (de) {
      if (de.dataset.de === 'save') save();
      if (de.dataset.de === 'cancel') {
        var back = function () { if (!DR) return; if (DR.id) { DR.mode = 'view'; DR.dirty = false; paintView(); } else closeDrawer(); };
        if (DR.dirty) U.confirm('Discard your changes?', 'Discard', 'danger').then(function (ok) { if (ok) back(); }); else back();
      }
    }
  }

  O.page('properties', {
    desc: 'Your units: details, access, photos and owners',
    render: render
  });
})();
