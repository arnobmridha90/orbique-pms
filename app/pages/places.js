/* ===================================================================
   PLACES — country, state and city pickers for buildings and units.
   O.places.html({country, state, city}, opts) draws three linked dropdowns (State is "Region" in Singapore);
   O.places.wire(root, onChange) makes them follow each other; O.places.read(root) -> {country, state, city}.
   Countries without a list here, and "Other" in a list, take typed text.
   Field names: country, state, city (with stateOther / cityOther for typed values). opts.prefix sets the
   element ids (e.g. 'pp-' -> pp-country) so labels stay linked.
   =================================================================== */
(function () {
  'use strict';
  var O = window.O, OTHER = '__other';
  /* states (or regions) and their main cities, towns and areas */
  var P = {
    MY: {
      'Johor': ['Johor Bahru', 'Iskandar Puteri', 'Pasir Gudang', 'Kulai', 'Desaru', 'Kota Tinggi', 'Batu Pahat', 'Muar', 'Kluang', 'Segamat', 'Mersing', 'Pontian'],
      'Kedah': ['Langkawi', 'Alor Setar', 'Sungai Petani', 'Kulim', 'Jitra'],
      'Kelantan': ['Kota Bharu', 'Pasir Mas', 'Tumpat', 'Tanah Merah', 'Gua Musang'],
      'Kuala Lumpur': ['Kuala Lumpur'],
      'Labuan': ['Labuan'],
      'Melaka': ['Melaka', 'Ayer Keroh', 'Klebang', 'Alor Gajah', 'Jasin'],
      'Negeri Sembilan': ['Seremban', 'Port Dickson', 'Nilai', 'Kuala Pilah', 'Bahau'],
      'Pahang': ['Kuantan', 'Genting Highlands', 'Cameron Highlands', 'Bentong', 'Fraser\'s Hill', 'Cherating', 'Tioman Island', 'Temerloh', 'Raub'],
      'Penang': ['George Town', 'Batu Ferringhi', 'Tanjung Bungah', 'Tanjung Tokong', 'Gelugor', 'Air Itam', 'Bayan Lepas', 'Balik Pulau', 'Butterworth', 'Bukit Mertajam'],
      'Perak': ['Ipoh', 'Taiping', 'Lumut', 'Pangkor Island', 'Sitiawan', 'Kampar', 'Teluk Intan'],
      'Perlis': ['Kangar', 'Arau', 'Padang Besar'],
      'Putrajaya': ['Putrajaya'],
      'Sabah': ['Kota Kinabalu', 'Kundasang', 'Ranau', 'Sandakan', 'Semporna', 'Tawau', 'Lahad Datu', 'Kudat'],
      'Sarawak': ['Kuching', 'Miri', 'Sibu', 'Bintulu', 'Mukah'],
      'Selangor': ['Petaling Jaya', 'Shah Alam', 'Subang Jaya', 'Cyberjaya', 'Puchong', 'Seri Kembangan', 'Sepang', 'Klang', 'Port Klang', 'Ampang', 'Kajang', 'Bangi', 'Rawang'],
      'Terengganu': ['Kuala Terengganu', 'Redang Island', 'Perhentian Islands', 'Kemaman', 'Dungun', 'Besut']
    },
    SG: {
      'Central': ['Orchard', 'Marina Bay', 'Downtown Core', 'River Valley', 'Tanjong Pagar', 'Chinatown', 'Bugis', 'Novena', 'Newton', 'Bukit Timah', 'Tiong Bahru', 'Queenstown', 'Kallang', 'Toa Payoh', 'Bishan', 'Sentosa'],
      'East': ['Katong', 'Marine Parade', 'Geylang', 'Bedok', 'Tampines', 'Pasir Ris', 'Changi'],
      'North': ['Woodlands', 'Yishun', 'Sembawang'],
      'North-East': ['Ang Mo Kio', 'Serangoon', 'Hougang', 'Sengkang', 'Punggol'],
      'West': ['Jurong East', 'Jurong West', 'Clementi', 'Bukit Batok', 'Bukit Panjang', 'Choa Chu Kang']
    },
    TH: {
      'Bangkok': ['Sukhumvit', 'Silom', 'Sathorn', 'Siam', 'Riverside', 'Ratchathewi', 'Chatuchak', 'Khao San'],
      'Chiang Mai': ['Chiang Mai', 'Nimman', 'Mae Rim', 'Doi Saket'],
      'Chiang Rai': ['Chiang Rai'],
      'Chon Buri': ['Pattaya', 'Jomtien', 'Na Jomtien', 'Si Racha'],
      'Krabi': ['Ao Nang', 'Krabi Town', 'Railay', 'Koh Lanta'],
      'Mae Hong Son': ['Pai', 'Mae Hong Son'],
      'Phang Nga': ['Khao Lak', 'Koh Yao'],
      'Phuket': ['Patong', 'Kata', 'Karon', 'Kamala', 'Bang Tao', 'Rawai', 'Phuket Town'],
      'Prachuap Khiri Khan': ['Hua Hin', 'Pranburi'],
      'Surat Thani': ['Koh Samui', 'Koh Phangan', 'Koh Tao', 'Surat Thani']
    },
    ID: {
      'Bali': ['Seminyak', 'Canggu', 'Ubud', 'Kuta', 'Legian', 'Sanur', 'Nusa Dua', 'Uluwatu', 'Jimbaran', 'Denpasar', 'Nusa Penida'],
      'East Java': ['Surabaya', 'Malang', 'Batu'],
      'Jakarta': ['Central Jakarta', 'South Jakarta', 'North Jakarta', 'West Jakarta', 'East Jakarta'],
      'North Sumatra': ['Medan', 'Lake Toba'],
      'Riau Islands': ['Batam', 'Bintan'],
      'West Java': ['Bandung', 'Bogor', 'Depok', 'Bekasi'],
      'West Nusa Tenggara': ['Lombok', 'Gili Islands', 'Mataram'],
      'Yogyakarta': ['Yogyakarta', 'Sleman']
    },
    PH: {
      'Aklan': ['Boracay'],
      'Benguet': ['Baguio'],
      'Bohol': ['Panglao', 'Tagbilaran'],
      'Cebu': ['Cebu City', 'Mactan', 'Moalboal'],
      'Metro Manila': ['Makati', 'Taguig (BGC)', 'Pasay', 'Manila', 'Quezon City', 'Mandaluyong', 'Pasig'],
      'Palawan': ['El Nido', 'Coron', 'Puerto Princesa']
    },
    VN: {
      'Da Nang': ['Da Nang'],
      'Hanoi': ['Hoan Kiem', 'Ba Dinh', 'Tay Ho', 'Cau Giay'],
      'Ho Chi Minh City': ['District 1', 'District 3', 'Binh Thanh', 'District 7', 'Thu Duc'],
      'Khanh Hoa': ['Nha Trang', 'Cam Ranh'],
      'Kien Giang': ['Phu Quoc'],
      'Lam Dong': ['Da Lat'],
      'Quang Nam': ['Hoi An']
    }
  };
  function esc(s) { return O.esc(s == null ? '' : String(s)); }
  function states(c) { return P[c] ? Object.keys(P[c]).sort() : null; }
  function cities(c, st) { return P[c] && P[c][st] ? P[c][st] : null; }
  /* the state a city is in, when the unit was saved before states were asked */
  function stateOf(c, city) {
    if (!P[c] || !city) return '';
    var low = String(city).toLowerCase(), hit = '';
    Object.keys(P[c]).some(function (st) { if (st.toLowerCase() === low || P[c][st].some(function (x) { return x.toLowerCase() === low; })) { hit = st; return true; } return false; });
    return hit;
  }
  function stateWord(c) { return c === 'SG' ? 'Region' : c === 'TH' || c === 'PH' || c === 'VN' || c === 'ID' ? 'Province or state' : 'State'; }
  function countries(sel) {
    var names = (O.data && O.data.countryName) || {}, used = O.countries ? O.countries().slice() : [];
    Object.keys(P).forEach(function (c) { if (used.indexOf(c) < 0) used.push(c); });
    if (sel && used.indexOf(sel) < 0) used.push(sel);
    return used.concat(Object.keys(names).filter(function (c) { return used.indexOf(c) < 0; }).sort(function (a, b) { return String(names[a]).localeCompare(String(names[b])); }));
  }
  function label(c) { return O.countryLabel ? O.countryLabel(c) : c; }
  /* <select> with "Other" + a text box for typed values; no list -> just the text box */
  function pick(name, id, list, value, ph, other) {
    var known = list && list.indexOf(value) >= 0, typed = !!value && !known;
    if (!list) return '<select class="select" name="' + name + '" id="' + id + '" hidden><option value="' + OTHER + '" selected></option></select>' +
      '<input class="input" name="' + name + 'Other" maxlength="40" value="' + esc(value) + '" placeholder="' + esc(ph) + '" aria-label="' + esc(other) + '">';
    return '<select class="select" name="' + name + '" id="' + id + '">' + '<option value=""' + (!value ? ' selected' : '') + '>Choose…</option>' +
      list.map(function (x) { return '<option' + (x === value ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') +
      '<option value="' + OTHER + '"' + (typed ? ' selected' : '') + '>Other (type it)</option></select>' +
      '<input class="input pl-other" name="' + name + 'Other" maxlength="40" value="' + esc(typed ? value : '') + '" placeholder="' + esc(ph) + '" aria-label="' + esc(other) + '"' + (typed ? '' : ' hidden') + '>';
  }
  function stateBox(c, st, pre) { return pick('state', pre + 'state', states(c), st, c === 'MY' ? 'e.g. Selangor' : 'State, province or region', 'Type the state'); }
  function cityBox(c, st, city, pre) { return pick('city', pre + 'city', cities(c, st), city, c === 'MY' ? 'e.g. Kuala Lumpur' : 'City or town', 'Type the city'); }
  O.places = {
    states: states, cities: cities, stateOf: stateOf,
    /* fld(name, label, inputHTML, opts) is the form's own field builder */
    html: function (v, fld, o) {
      o = o || {}; var pre = o.prefix || '', c = v.country || 'MY', st = v.state || stateOf(c, v.city);
      return fld('country', 'Country', '<select class="select" name="country" id="' + pre + 'country">' + countries(c).map(function (x) { return '<option value="' + esc(x) + '"' + (x === c ? ' selected' : '') + '>' + esc(label(x)) + '</option>'; }).join('') + '</select>', o.countryOpts) +
        fld('state', stateWord(c), '<div class="pl-pick" data-pl="state">' + stateBox(c, st, pre) + '</div>', { opt: o.stateOptional }) +
        fld('city', c === 'SG' ? 'Area' : 'City or town', '<div class="pl-pick" data-pl="city">' + cityBox(c, st, v.city, pre) + '</div>');
    },
    read: function (root) {
      function get(n) { var s = root.querySelector('[name="' + n + '"]'), t = root.querySelector('[name="' + n + 'Other"]'); if (!s) return ''; return String(s.value === OTHER ? (t ? t.value : '') : s.value).trim(); }
      var c = root.querySelector('[name=country]');
      return { country: c ? c.value : '', state: get('state'), city: get('city') };
    },
    /* follow changes: a new country redraws state and city, a new state redraws city; onChange(field) after each */
    wire: function (root, onChange, o) {
      o = o || {}; var pre = o.prefix || '';
      function lab(n, t) { var l = root.querySelector('label[for="' + pre + n + '"]'); if (l && l.firstChild) l.firstChild.nodeValue = t; }
      root.addEventListener('change', function (e) {
        var t = e.target; if (!t || !t.name) return;
        var cur = O.places.read(root);
        if (t.name === 'country') {
          root.querySelector('[data-pl=state]').innerHTML = stateBox(cur.country, '', pre);
          root.querySelector('[data-pl=city]').innerHTML = cityBox(cur.country, '', '', pre);
          lab('state', stateWord(cur.country)); lab('city', cur.country === 'SG' ? 'Area' : 'City or town');
        } else if (t.name === 'state') {
          var box = root.querySelector('[name=stateOther]'); if (box && t.tagName === 'SELECT') { box.hidden = t.value !== OTHER; if (!box.hidden) box.focus(); }
          root.querySelector('[data-pl=city]').innerHTML = cityBox(cur.country, t.value === OTHER ? '' : t.value, '', pre);
        } else if (t.name === 'city' && t.tagName === 'SELECT') {
          var cb = root.querySelector('[name=cityOther]'); if (cb) { cb.hidden = t.value !== OTHER; if (!cb.hidden) cb.focus(); }
        } else return;
        if (onChange) onChange(t.name);
      });
    }
  };
})();
