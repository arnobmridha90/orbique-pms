/* Orbique Command Center v4 — shared demo data.
   Everything is generated deterministically (seeded), so every page shows the same numbers.
   The demo is generated as if "today" were Tuesday 6 October 2026, 10:15 AM (Malaysia time) = D.STORY0.
   At boot core.js shifts every date in the data so the demo's "today" lands on the workspace's story date
   (the day the demo was loaded), then switches D.TODAY / D.NOW to the real Malaysia clock. */
(function () {
  var O = (window.O = window.O || {});

  /* ---------------- dates ---------------- */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function toUTC(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function fromUTC(ms) { return new Date(ms).toISOString().slice(0, 10); }
  O.d = {
    MONTHS: MONTHS, MONTHS_LONG: MONTHS_LONG, DOWS: DOWS,
    add: function (iso, n) { return fromUTC(toUTC(iso) + n * 864e5); },
    diff: function (a, b) { return Math.round((toUTC(b) - toUTC(a)) / 864e5); }, /* days from a to b */
    dow: function (iso) { return new Date(toUTC(iso)).getUTCDay(); },
    dowName: function (iso) { return DOWS[new Date(toUTC(iso)).getUTCDay()]; },
    isWeekend: function (iso) { var w = new Date(toUTC(iso)).getUTCDay(); return w === 5 || w === 6; }, /* Fri & Sat nights */
    day: function (iso) { return +iso.slice(8, 10); },
    month: function (iso) { return +iso.slice(5, 7); },
    year: function (iso) { return +iso.slice(0, 4); },
    monthStart: function (iso) { return iso.slice(0, 8) + '01'; },
    monthEnd: function (iso) { var y = +iso.slice(0, 4), m = +iso.slice(5, 7); return fromUTC(Date.UTC(y, m, 0)); },
    addMonths: function (iso, n) {
      var y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + n, d = +iso.slice(8, 10);
      var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      return fromUTC(Date.UTC(y, m, Math.min(d, last)));
    },
    addYears: function (iso, n) { return O.d.addMonths(iso, 12 * n); },
    /* same weekday one year earlier (364 days back) — used for like-for-like pricing comparisons */
    sameWeekdayYearsAgo: function (iso, n) { return O.d.add(iso, -364 * n); },
    range: function (from, to) { var out = [], x = from; while (x <= to) { out.push(x); x = O.d.add(x, 1); } return out; },
    fmt: function (iso) { return O.d.day(iso) + ' ' + MONTHS[O.d.month(iso) - 1]; },
    fmtY: function (iso) { return O.d.day(iso) + ' ' + MONTHS[O.d.month(iso) - 1] + ' ' + O.d.year(iso); },
    fmtDM: function (iso) { return ('0' + O.d.day(iso)).slice(-2) + '/' + ('0' + O.d.month(iso)).slice(-2); },
    fmtRange: function (a, b) {
      if (a.slice(0, 7) === b.slice(0, 7)) return O.d.day(a) + '–' + O.d.day(b) + ' ' + MONTHS[O.d.month(b) - 1];
      return O.d.fmt(a) + ' – ' + O.d.fmt(b);
    },
    monthName: function (iso, long) { return (long ? MONTHS_LONG : MONTHS)[O.d.month(iso) - 1]; }
  };

  var TODAY = '2026-10-06';
  var NOW = '2026-10-06T10:15';

  /* ---------------- seeded random ---------------- */
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  var R = rng(20261006);
  function pick(arr, r) { return arr[Math.floor((r || R)() * arr.length)]; }
  function weighted(pairs, r) { var x = (r || R)(), acc = 0; for (var i = 0; i < pairs.length; i++) { acc += pairs[i][1]; if (x <= acc) return pairs[i][0]; } return pairs[pairs.length - 1][0]; }
  function round5(x) { return Math.round(x / 5) * 5; }

  /* ---------------- reference lists ---------------- */
  var channels = {
    airbnb: { id: 'airbnb', name: 'Airbnb', feePct: 0.15 },
    booking: { id: 'booking', name: 'Booking.com', feePct: 0.15 },
    agoda: { id: 'agoda', name: 'Agoda', feePct: 0.15 },
    vrbo: { id: 'vrbo', name: 'Vrbo', feePct: 0.08 },
    expedia: { id: 'expedia', name: 'Expedia', feePct: 0.18 },
    trip: { id: 'trip', name: 'Trip.com', feePct: 0.15 },
    other: { id: 'other', name: 'Other platform', feePct: 0.15 },
    direct: { id: 'direct', name: 'Direct', feePct: 0.03 }
  };
  /* expedia, trip and other arrive through the channel manager (api/_lib/channex-bookings.js); lists hide them while unused */
  var channelOrder = ['airbnb', 'booking', 'agoda', 'vrbo', 'expedia', 'trip', 'other', 'direct'];

  var staff = [
    { id: 's1', name: 'Mei Fen Lim', initials: 'MF', role: 'owner', roleLabel: 'Account owner', phone: '+60 12-338 4410' },
    { id: 's2', name: 'Wei Ling Tan', initials: 'WL', role: 'ops', roleLabel: 'Ops manager', phone: '+60 16-221 0934' },
    { id: 's3', name: 'Kavya Nair', initials: 'KN', role: 'housekeeping', roleLabel: 'Housekeeping lead', phone: '+60 11-5520 7781' },
    { id: 's4', name: 'Arif Hakim', initials: 'AH', role: 'frontdesk', roleLabel: 'Front desk', phone: '+60 13-774 1209' },
    { id: 's5', name: 'Siti Aminah', initials: 'SA', role: 'housekeeping', roleLabel: 'Housekeeper', phone: '+60 19-402 6631' },
    { id: 's6', name: 'Raju Kumar', initials: 'RK', role: 'maintenance', roleLabel: 'Maintenance', phone: '+60 17-889 2045' },
    { id: 's7', name: 'Grace Ong', initials: 'GO', role: 'accountant', roleLabel: 'Accountant', phone: '+60 12-601 7718' }
  ];

  var properties = [
    { id: 'bf3b', name: 'Bayfront Loft 3B', short: 'Bayfront 3B', type: '2BR loft', beds: 2, area: 'Gurney Drive, Penang', base: 240, owner: 'Rajan Pillai', housekeeper: 's3', lockCode: '4827', lockBrand: 'Yale', wifi: ['Bayfront3B_Guest', 'sunrise2026'], parking: 'Bay B2-14' },
    { id: 'bf1a', name: 'Bayfront Loft 1A', short: 'Bayfront 1A', type: '1BR loft', beds: 1, area: 'Gurney Drive, Penang', base: 165, owner: 'Rajan Pillai', housekeeper: 's5', lockCode: '1593', lockBrand: 'Yale', wifi: ['Bayfront1A_Guest', 'seabreeze88'], parking: 'Bay B2-03' },
    { id: 'mrs', name: 'Marina Suite', short: 'Marina', type: '2BR suite', beds: 2, area: 'Straits Quay, Penang', base: 260, owner: 'Chen Li Hua', housekeeper: 's3', lockCode: '7310', lockBrand: 'Igloohome', wifi: ['MarinaSuite', 'harbour2026'], parking: 'Visitor bay 11' },
    { id: 'hv2', name: 'Highland Villa 2', short: 'Highland 2', type: '3BR villa', beds: 3, area: 'Tanah Rata, Cameron Highlands', base: 420, owner: 'Lim Boon Keat', housekeeper: 's5', lockCode: '2468', lockBrand: 'Nuki', wifi: ['HighlandVilla2', 'teagarden42'], parking: 'Driveway, 2 cars' },
    { id: 'or4', name: 'Orchid Residence 4', short: 'Orchid 4', type: '2BR condo', beds: 2, area: 'Bukit Bintang, Kuala Lumpur', base: 230, owner: 'Norhayati Ismail', housekeeper: 's3', lockCode: '5051', lockBrand: 'Yale', wifi: ['Orchid4_Guest', 'bintang505'], parking: 'P3-218' },
    { id: 'kls', name: 'KLCC Skyline 28F', short: 'KLCC 28F', type: '1BR apartment', beds: 1, area: 'KLCC, Kuala Lumpur', base: 290, owner: 'Ahmad Faizal', housekeeper: 's5', lockCode: '2828', lockBrand: 'Igloohome', wifi: ['Skyline28F', 'twintowers28'], parking: 'P2-077' },
    { id: 'bbs', name: 'Bukit Bintang Studio 12', short: 'BB Studio 12', type: 'Studio', beds: 0, area: 'Bukit Bintang, Kuala Lumpur', base: 150, owner: 'Tan Sri Wong', housekeeper: 's3', lockCode: '1212', lockBrand: 'Yale', wifi: ['BBStudio12', 'jalanalor12'], parking: 'No parking' },
    { id: 'mkr', name: 'Mont Kiara Residence 9', short: 'Mont Kiara 9', type: '3BR condo', beds: 3, area: 'Mont Kiara, Kuala Lumpur', base: 380, owner: 'Priya Menon', housekeeper: 's5', lockCode: '9090', lockBrand: 'Nuki', wifi: ['MontKiara9', 'kiarahills9'], parking: 'P1-046, P1-047' },
    { id: 'bgf', name: 'Bangsar Garden Flat', short: 'Bangsar Garden', type: '2BR flat', beds: 2, area: 'Bangsar, Kuala Lumpur', base: 210, owner: 'Daniel Yap', housekeeper: 's3', lockCode: '3344', lockBrand: 'Yale', wifi: ['BangsarGarden', 'telawi2026'], parking: 'Street parking' },
    { id: 'hsg', name: 'Heritage Shophouse', short: 'Heritage House', type: '3BR shophouse', beds: 3, area: 'Armenian Street, George Town', base: 450, owner: 'Khoo Siew Lan', housekeeper: 's5', lockCode: '1786', lockBrand: 'Igloohome', wifi: ['HeritageHouse', 'armenian1786'], parking: 'Public lot, 2 min walk' },
    { id: 'bfc', name: 'Batu Ferringhi Beach Condo', short: 'Ferringhi Beach', type: '2BR condo', beds: 2, area: 'Batu Ferringhi, Penang', base: 310, owner: 'Rajan Pillai', housekeeper: 's3', lockCode: '6161', lockBrand: 'Yale', wifi: ['FerringhiBeach', 'sunset6161'], parking: 'B1-22' },
    { id: 'mrl', name: 'Melaka Riverside Loft', short: 'Melaka Loft', type: '2BR loft', beds: 2, area: 'Jonker Street, Melaka', base: 220, owner: 'Goh Ai Ling', housekeeper: 's5', lockCode: '1511', lockBrand: 'Nuki', wifi: ['RiversideLoft', 'jonker1511'], parking: 'Riverside lot' }
  ];
  var propById = {}; properties.forEach(function (p) { propById[p.id] = p; });

  var guestPool = [
    ['Tan Wei Jie', 'MY'], ['Nur Aisyah', 'MY'], ['Muthu Krishnan', 'MY'], ['Lim Mei Ling', 'MY'], ['Siti Rahman', 'MY'], ['Farah Ibrahim', 'MY'],
    ['Kenji Mori', 'JP'], ['Hannah Ong', 'SG'], ['Marcus Lee', 'SG'], ['Olivia Chen', 'AU'], ['Yuki Tanaka', 'JP'], ['Kim Min-jun', 'KR'],
    ['Aditya Rao', 'IN'], ['Mohammed Al-Farsi', 'OM'], ['Zhang Wei', 'CN'], ['Chloe Martin', 'FR'], ['Noah Williams', 'US'], ['Anna Kowalska', 'PL'],
    ['Dewi Lestari', 'ID'], ['Nguyen Thi Lan', 'VN'], ['Somchai Prasert', 'TH'], ['Grace Lim', 'MY'], ['Amira Hassan', 'MY'], ['Priya Nair', 'MY'],
    ['Ben Carter', 'UK'], ['Sofia Rossi', 'IT'], ['Lucas Silva', 'BR'], ['Aiko Suzuki', 'JP'], ['Ravi Shankar', 'IN'], ['Isabella Garcia', 'ES'],
    ['Ahmad Zulkifli', 'MY'], ['Jasmine Koh', 'SG'], ['Wang Fang', 'CN'], ['Liam O\'Brien', 'IE'], ['Fatimah Zahra', 'MY'], ['Tom Becker', 'DE'],
    ['Mia Johansson', 'SE'], ['Haruto Sato', 'JP'], ['Chen Jia Hui', 'TW'], ['Arjun Patel', 'IN'], ['Nadia Petrova', 'BG'], ['Ethan Wong', 'HK']
  ];
  var COUNTRY = { MY: 'Malaysia', SG: 'Singapore', JP: 'Japan', AU: 'Australia', KR: 'South Korea', IN: 'India', OM: 'Oman', CN: 'China', FR: 'France', US: 'United States', PL: 'Poland', ID: 'Indonesia', VN: 'Vietnam', TH: 'Thailand', UK: 'United Kingdom', IT: 'Italy', BR: 'Brazil', ES: 'Spain', IE: 'Ireland', DE: 'Germany', SE: 'Sweden', TW: 'Taiwan', BG: 'Bulgaria', HK: 'Hong Kong', PH: 'Philippines' };

  var PHONE = { MY: '+60 1#-### ####', SG: '+65 9### ####', JP: '+81 90-#### ####', AU: '+61 4## ### ###', KR: '+82 10-#### ####', IN: '+91 9#### #####', OM: '+968 9### ####', CN: '+86 13# #### ####', FR: '+33 6 ## ## ## ##', US: '+1 415-###-####', PL: '+48 5## ### ###', ID: '+62 81#-####-####', VN: '+84 9# ### ####', TH: '+66 8#-###-####', UK: '+44 7### ######', IT: '+39 3## ### ####', BR: '+55 11 9####-####', ES: '+34 6## ### ###', IE: '+353 8# ### ####', DE: '+49 15# #######', SE: '+46 7#-### ## ##', TW: '+886 9## ### ###', BG: '+359 8## ### ###', HK: '+852 9### ####', PH: '+63 9## ### ####' };
  /* one draw from the shared generator per number, so the rest of the seeded data stays the same */
  function phoneFor(country, x) { var lr = rng(Math.floor(x * 2147483647)); return (PHONE[country] || '+65 9### ####').replace(/#/g, function () { return String(Math.floor(lr() * 10)); }); }

  /* ---------------- pricing model ---------------- */
  function seasonFactor(iso) {
    var m = O.d.month(iso), day = O.d.day(iso);
    var f = { 1: 1.12, 2: 1.08, 3: 0.95, 4: 0.97, 5: 0.98, 6: 1.04, 7: 1.05, 8: 1.02, 9: 0.96, 10: 1.0, 11: 1.0, 12: 1.18 }[m];
    if (m === 12 && day >= 20) f += 0.12;
    return f;
  }
  /* local events that move prices (demo data) */
  var events = [
    { date: '2026-10-10', end: '2026-10-11', name: 'Concert at Bukit Jalil Stadium', areas: ['Kuala Lumpur'], lift: 0.22 },
    { date: '2026-10-17', end: '2026-10-18', name: 'Penang Food & Culture Festival', areas: ['Penang', 'George Town'], lift: 0.18 },
    { date: '2026-10-24', end: '2026-10-25', name: 'KL Marathon weekend', areas: ['Kuala Lumpur'], lift: 0.12 },
    { date: '2026-11-07', end: '2026-11-08', name: 'Deepavali long weekend', areas: ['Kuala Lumpur', 'Penang', 'George Town', 'Melaka', 'Cameron Highlands'], lift: 0.15 },
    { date: '2026-12-19', end: '2026-12-31', name: 'Year-end school holidays', areas: ['Kuala Lumpur', 'Penang', 'George Town', 'Melaka', 'Cameron Highlands'], lift: 0.2 }
  ];
  function eventFor(pid, iso) {
    var p = propById[pid]; if (!p || !p.area) return null;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (iso >= e.date && iso <= e.end && e.areas.some(function (a) { return p.area.indexOf(a) >= 0; })) return e;
    }
    return null;
  }
  /* the rate we actually charged / will charge for a night (yearsAgo = 0, 1, 2) */
  function rateFor(pid, iso, yearsAgo) {
    yearsAgo = yearsAgo || 0;
    var p = propById[pid], r = rng(hash(String(pid) + iso + 'y' + yearsAgo));
    var growth = [1, 0.93, 0.86][yearsAgo] || 0.8;
    var f = seasonFactor(iso) * (O.d.isWeekend(iso) ? 1.18 : 1) * growth * (0.94 + r() * 0.12);
    var ev = yearsAgo === 0 ? eventFor(pid, iso) : null;
    if (ev) f *= 1 + ev.lift;
    return p && p.base > 0 ? round5(p.base * f) : 0;
  }

  /* ---------------- bookings ---------------- */
  var bookings = [];
  var seq = 4100;
  function makeBooking(o) {
    var p = propById[o.propertyId];
    var nights = O.d.diff(o.checkIn, o.checkOut);
    var nightly = o.nightly || Math.round(O.d.range(o.checkIn, O.d.add(o.checkOut, -1)).reduce(function (s, d) { return s + rateFor(p.id, d); }, 0) / nights);
    var cleaning = { 0: 50, 1: 60, 2: 80, 3: 110, 4: 130 }[p.beds] || 80;
    var country = o.country || 'MY';
    var b = {
      id: 'BK-' + (seq++),
      propertyId: p.id,
      guest: {
        name: o.guest, country: country, countryName: COUNTRY[country] || country, foreign: country !== 'MY',
        phone: o.phone || phoneFor(country, R()),
        email: o.email || (o.guest.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '') + '@mail.com')
      },
      guests: o.guests || Math.max(1, Math.min(2 + p.beds * 2, 1 + Math.floor(R() * (p.beds * 2 + 1)))),
      channel: o.channel,
      checkIn: o.checkIn, checkOut: o.checkOut, nights: nights,
      checkInTime: o.checkInTime || '15:00', checkOutTime: o.checkOutTime || '11:00',
      createdAt: o.createdAt,
      nightly: nightly,
      accommodation: nightly * nights,
      cleaningFee: cleaning,
      tourismTax: country !== 'MY' ? 10 * nights : 0, /* RM10 per room per night for foreign guests (the demo buildings are all in Malaysia; new bookings use O.tourismTaxApplies) */
      status: o.status,
      idVerified: o.idVerified,
      codeStatus: o.codeStatus,
      sameDay: !!o.sameDay,
      notes: o.notes || ''
    };
    b.total = b.accommodation + b.cleaningFee + b.tourismTax;
    b.platformFee = Math.round(b.accommodation * channels[b.channel].feePct);
    b.payout = b.total - b.platformFee;
    b.revenue = b.accommodation + b.cleaningFee; /* revenue we report (tourism tax is passed through) */
    return b;
  }

  /* handcrafted bookings around "today" so the dashboard tells a clear story */
  var fixed = [
    /* checked out this morning */
    { propertyId: 'bf3b', guest: 'Ahmad Razak', country: 'MY', channel: 'airbnb', checkIn: '2026-10-02', checkOut: '2026-10-06', createdAt: '2026-09-14T21:10', checkOutTime: '10:00' },
    { propertyId: 'or4', guest: 'Lukas Brandt', country: 'DE', channel: 'booking', checkIn: '2026-10-03', checkOut: '2026-10-06', createdAt: '2026-08-29T08:44' },
    { propertyId: 'bf1a', guest: 'James Cole', country: 'UK', channel: 'airbnb', checkIn: '2026-10-02', checkOut: '2026-10-06', createdAt: '2026-09-20T13:05', checkOutTime: '10:00' },
    /* check-ins known before today */
    { propertyId: 'bf3b', guest: 'Sarah Tan', country: 'SG', channel: 'airbnb', checkIn: '2026-10-06', checkOut: '2026-10-09', createdAt: '2026-09-21T19:32', checkInTime: '12:00', idVerified: true, codeStatus: 'sent', notes: 'Early check-in 12:00 approved' },
    { propertyId: 'mrs', guest: 'The Reyes Family', country: 'PH', channel: 'direct', checkIn: '2026-10-06', checkOut: '2026-10-08', createdAt: '2026-09-02T11:18', checkInTime: '16:30', idVerified: false, codeStatus: 'held', guests: 4 },
    { propertyId: 'hv2', guest: 'Daniel Wei', country: 'SG', channel: 'vrbo', checkIn: '2026-10-06', checkOut: '2026-10-11', createdAt: '2026-08-11T09:02', checkInTime: '15:00', idVerified: true, codeStatus: 'sent', guests: 5 },
    /* same-day bookings: confirmed this morning, arriving today */
    { propertyId: 'bf1a', guest: 'Hafiz Aziz', country: 'MY', channel: 'airbnb', checkIn: '2026-10-06', checkOut: '2026-10-07', createdAt: '2026-10-06T09:02', checkInTime: '12:00', idVerified: false, codeStatus: 'held', sameDay: true },
    { propertyId: 'kls', guest: 'Emma Laurent', country: 'FR', channel: 'booking', checkIn: '2026-10-06', checkOut: '2026-10-08', createdAt: '2026-10-06T09:47', checkInTime: '15:00', idVerified: true, codeStatus: 'sent', sameDay: true },
    /* in-house guests */
    { propertyId: 'mkr', guest: 'Mohammed Al-Farsi', country: 'OM', channel: 'booking', checkIn: '2026-10-03', checkOut: '2026-10-09', createdAt: '2026-08-02T16:40', idVerified: true, codeStatus: 'sent', guests: 6 },
    { propertyId: 'hsg', guest: 'Olivia Chen', country: 'AU', channel: 'airbnb', checkIn: '2026-10-04', checkOut: '2026-10-08', createdAt: '2026-07-19T07:55', idVerified: true, codeStatus: 'sent', guests: 5 },
    { propertyId: 'bfc', guest: 'Noah Williams', country: 'US', channel: 'agoda', checkIn: '2026-10-05', checkOut: '2026-10-10', createdAt: '2026-09-01T22:03', idVerified: true, codeStatus: 'sent' },
    { propertyId: 'bbs', guest: 'Kim Min-jun', country: 'KR', channel: 'agoda', checkIn: '2026-10-04', checkOut: '2026-10-07', createdAt: '2026-09-25T10:10', idVerified: true, codeStatus: 'sent', guests: 1 },
    /* checking out tomorrow */
    { propertyId: 'bgf', guest: 'Lim Mei Ling', country: 'MY', channel: 'direct', checkIn: '2026-10-04', checkOut: '2026-10-07', createdAt: '2026-09-30T12:12', idVerified: true, codeStatus: 'sent' },
    /* earlier this month */
    { propertyId: 'hv2', guest: 'Grace Lim', country: 'MY', channel: 'direct', checkIn: '2026-10-01', checkOut: '2026-10-04', createdAt: '2026-09-12T20:18', guests: 6 },
    { propertyId: 'hsg', guest: 'Tom Becker', country: 'DE', channel: 'airbnb', checkIn: '2026-09-30', checkOut: '2026-10-03', createdAt: '2026-09-04T06:51', guests: 4 },
    { propertyId: 'bfc', guest: 'Jasmine Koh', country: 'SG', channel: 'booking', checkIn: '2026-10-02', checkOut: '2026-10-05', createdAt: '2026-09-17T14:26' },
    { propertyId: 'mrl', guest: 'Ravi Shankar', country: 'IN', channel: 'agoda', checkIn: '2026-10-04', checkOut: '2026-10-07', createdAt: '2026-09-23T11:37', idVerified: true, codeStatus: 'sent' },
    /* past stays referenced by reviews and messages */
    { propertyId: 'or4', guest: 'Amira Hassan', country: 'MY', channel: 'booking', checkIn: '2026-09-25', checkOut: '2026-09-30', createdAt: '2026-09-03T15:20' },
    { propertyId: 'mrs', guest: 'Priya Nair', country: 'MY', channel: 'vrbo', checkIn: '2026-09-26', checkOut: '2026-09-28', createdAt: '2026-09-10T18:47' },
    /* upcoming */
    { propertyId: 'bf3b', guest: 'Marcus Lee', country: 'SG', channel: 'direct', checkIn: '2026-10-10', checkOut: '2026-10-13', createdAt: '2026-09-28T08:15', idVerified: true, codeStatus: 'scheduled' },
    { propertyId: 'or4', guest: 'Siti Rahman', country: 'MY', channel: 'airbnb', checkIn: '2026-10-08', checkOut: '2026-10-11', createdAt: '2026-10-01T20:41', idVerified: false, codeStatus: 'held' },
    { propertyId: 'mrs', guest: 'Farah Ibrahim', country: 'MY', channel: 'booking', checkIn: '2026-10-09', checkOut: '2026-10-12', createdAt: '2026-10-05T23:05', idVerified: false, codeStatus: 'held', status: 'pending' }
  ];
  /* maintenance and owner blocks */
  var blocks = [
    { id: 'BL-1', propertyId: 'or4', start: '2026-10-06', end: '2026-10-08', type: 'maintenance', note: 'AC unit replacement, bedroom 2' },
    { id: 'BL-2', propertyId: 'mrs', start: '2026-10-15', end: '2026-10-18', type: 'owner', note: 'Owner stay (Chen Li Hua)' },
    { id: 'BL-3', propertyId: 'hsg', start: '2026-10-19', end: '2026-10-21', type: 'maintenance', note: 'Roof tile repair' },
    { id: 'BL-4', propertyId: 'mkr', start: '2026-10-22', end: '2026-10-26', type: 'owner', note: 'Owner stay (Priya Menon)' }
  ];

  function statusFor(ci, co) {
    if (co < TODAY) return 'checked_out';
    if (co === TODAY) return 'checked_out';
    if (ci < TODAY) return 'checked_in';
    if (ci === TODAY) return 'confirmed';
    return 'confirmed';
  }

  fixed.forEach(function (f) {
    var b = makeBooking(Object.assign({ status: f.status || statusFor(f.checkIn, f.checkOut) }, f));
    if (b.idVerified === undefined) b.idVerified = b.checkIn <= TODAY;
    if (b.codeStatus === undefined) b.codeStatus = b.checkOut <= TODAY ? 'expired' : (b.checkIn <= TODAY ? 'sent' : 'scheduled');
    bookings.push(b);
  });

  function overlaps(pid, a, b) {
    return bookings.some(function (x) { return x.propertyId === pid && x.status !== 'cancelled' && x.checkIn < b && a < x.checkOut; }) ||
      blocks.some(function (x) { return x.propertyId === pid && x.start < b && a < x.end; });
  }

  /* fill the calendar for every property from 1 June 2026 to 31 Jan 2027 */
  var GEN_FROM = '2026-06-01', GEN_TO = '2027-01-31';
  var occTarget = { bf3b: 0.86, bf1a: 0.8, mrs: 0.78, hv2: 0.66, or4: 0.74, kls: 0.84, bbs: 0.82, mkr: 0.62, bgf: 0.72, hsg: 0.6, bfc: 0.76, mrl: 0.64 };
  properties.forEach(function (p, pi) {
    var r = rng(1000 + pi * 77);
    var d = GEN_FROM;
    while (d < GEN_TO) {
      var target = occTarget[p.id];
      /* nights further out are less booked; the past and near future are fuller */
      var horizon = O.d.diff(TODAY, d);
      var fill = horizon <= 0 ? target : horizon < 30 ? target * 0.92 : horizon < 60 ? target * 0.62 : horizon < 90 ? target * 0.38 : target * 0.18;
      var gap = r() < fill ? (r() < 0.6 ? 0 : 1) : 1 + Math.floor(r() * 4);
      var ci = O.d.add(d, gap);
      var los = weighted([[1, 0.12], [2, 0.3], [3, 0.26], [4, 0.14], [5, 0.08], [6, 0.05], [7, 0.05]], r);
      if (p.id === 'hv2' || p.id === 'hsg' || p.id === 'mkr') los += 1;
      var co = O.d.add(ci, los);
      if (co > GEN_TO) break;
      if (overlaps(p.id, ci, co)) { d = O.d.add(ci, 1); continue; }
      var lead = weighted([[1, 0.12], [4, 0.18], [10, 0.22], [21, 0.22], [40, 0.16], [75, 0.1]], r) + Math.floor(r() * 5);
      var created = O.d.add(ci, -lead);
      if (created > TODAY) { d = co; continue; }        /* not booked yet — leave the night open */
      var g = guestPool[Math.floor(r() * guestPool.length)];
      var ch = weighted([['airbnb', 0.38], ['booking', 0.22], ['agoda', 0.18], ['direct', 0.14], ['vrbo', 0.08]], r);
      var st = statusFor(ci, co);
      if (r() < 0.05) st = 'cancelled';
      else if (ci > TODAY && r() < 0.06) st = 'pending';
      var hh = 7 + Math.floor(r() * 15), mm = Math.floor(r() * 60);
      if (created === TODAY && hh * 60 + mm > 10 * 60 + 15) hh = 7 + (hh % 3); /* booked today: before "now" (10:15) */
      var b = makeBooking({
        propertyId: p.id, guest: g[0], country: g[1], channel: ch, checkIn: ci, checkOut: co,
        createdAt: created + 'T' + ('0' + hh).slice(-2) + ':' + ('0' + mm).slice(-2), status: st
      });
      b.idVerified = ci <= TODAY ? true : r() < 0.55;
      b.codeStatus = st === 'cancelled' ? 'cancelled' : co <= TODAY ? 'expired' : ci <= TODAY ? 'sent' : (b.idVerified && O.d.diff(TODAY, ci) <= 1 ? 'scheduled' : (b.idVerified ? 'scheduled' : 'held'));
      if (st === 'cancelled') b.cancelledAt = O.d.add(created, Math.max(1, Math.floor(lead / 2)));
      bookings.push(b);
      d = co;
    }
  });
  bookings.sort(function (a, b) { return a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0; });

  /* invoice + receipt numbers, generated automatically from the booking */
  var invSeq = 1000, rcpSeq = 1000;
  bookings.forEach(function (b) {
    if (b.status === 'cancelled') return;
    b.invoiceNo = 'INV-' + b.createdAt.slice(0, 4) + '-' + (invSeq++);
    b.invoiceDate = b.createdAt.slice(0, 10);
    /* OTA bookings are paid at booking; direct bookings pay 7 days before arrival */
    var paidOn = b.channel === 'direct' ? O.d.add(b.checkIn, -7) : b.createdAt.slice(0, 10);
    if (b.status === 'pending') paidOn = null;
    if (paidOn && paidOn < b.createdAt.slice(0, 10)) paidOn = b.createdAt.slice(0, 10);
    if (paidOn && paidOn <= TODAY) {
      b.paidAt = paidOn;
      b.receiptNo = 'RCP-' + paidOn.slice(0, 4) + '-' + (rcpSeq++);
      b.payMethod = b.channel === 'direct' ? pick(['FPX online banking', 'Card (Visa)', 'DuitNow QR'], rng(hash(b.id))) : 'Paid via ' + channels[b.channel].name;
    }
    /* what has already been sent to the guest */
    var ageDays = O.d.diff(b.createdAt.slice(0, 10), TODAY);
    b.invoiceSent = ageDays >= 1 || b.sameDay ? (b.sameDay && b.guest.name === 'Hafiz Aziz' ? null : { via: b.channel === 'direct' ? 'WhatsApp' : 'Email', at: b.createdAt.slice(0, 10) }) : null;
    b.receiptSent = b.paidAt && O.d.diff(b.paidAt, TODAY) >= 1 ? { via: 'Email', at: b.paidAt } : null;
  });

  /* ---------------- tasks ---------------- */
  var tasks = [
    { id: 'T-301', title: 'Turnover clean', type: 'Turnover', propertyId: 'bf3b', assigneeId: 's3', due: '2026-10-06T11:45', priority: 'high', status: 'in_progress', checklist: [9, 14], note: 'Sarah Tan arrives 12:00 (early check-in)', photos: 2 },
    { id: 'T-302', title: 'Turnover clean', type: 'Turnover', propertyId: 'bf1a', assigneeId: 's5', due: '2026-10-06T11:45', priority: 'high', status: 'todo', checklist: [0, 12], note: 'Same-day booking: Hafiz Aziz arrives 12:00' },
    { id: 'T-303', title: 'Deep clean after checkout', type: 'Turnover', propertyId: 'or4', assigneeId: 's4', due: '2026-10-06T14:00', priority: 'medium', status: 'todo', checklist: [0, 18] },
    { id: 'T-304', title: 'Replace AC unit, bedroom 2', type: 'Maintenance', propertyId: 'or4', assigneeId: 's6', due: '2026-10-07T12:00', priority: 'medium', status: 'todo', note: 'Unit blocked until 8 Oct' },
    { id: 'T-305', title: 'Pre-arrival inspection', type: 'Inspection', propertyId: 'kls', assigneeId: 's2', due: '2026-10-06T13:30', priority: 'high', status: 'todo', checklist: [0, 10], note: 'Same-day booking: Emma Laurent arrives 15:00' },
    { id: 'T-306', title: 'Restock welcome kit', type: 'Restock', propertyId: 'mrs', assigneeId: 's2', due: '2026-10-06T09:30', priority: 'low', status: 'done', doneAt: '2026-10-06T09:12', photos: 3 },
    { id: 'T-307', title: 'Quarterly inspection', type: 'Inspection', propertyId: 'mrl', assigneeId: 's3', due: '2026-10-05T17:00', priority: 'medium', status: 'todo', checklist: [0, 22], note: 'Overdue since yesterday' },
    { id: 'T-308', title: 'Fix slow kitchen drain', type: 'Maintenance', propertyId: 'hsg', assigneeId: 's6', due: '2026-10-06T16:00', priority: 'medium', status: 'todo', note: 'Reported by guest Olivia Chen' },
    { id: 'T-309', title: 'Mid-stay clean', type: 'Turnover', propertyId: 'mkr', assigneeId: 's5', due: '2026-10-06T15:00', priority: 'low', status: 'todo', checklist: [0, 8], note: 'Paid extra, requested in guest app' },
    { id: 'T-310', title: 'Collect laundry from vendor', type: 'Restock', propertyId: null, assigneeId: 's4', due: '2026-10-06T17:00', priority: 'low', status: 'todo' },
    { id: 'T-311', title: 'Turnover clean', type: 'Turnover', propertyId: 'bbs', assigneeId: 's3', due: '2026-10-07T14:00', priority: 'medium', status: 'todo', checklist: [0, 10] },
    { id: 'T-312', title: 'Turnover clean', type: 'Turnover', propertyId: 'bgf', assigneeId: 's5', due: '2026-10-07T14:00', priority: 'medium', status: 'todo', checklist: [0, 12] },
    { id: 'T-313', title: 'Replace shower head', type: 'Maintenance', propertyId: 'bfc', assigneeId: null, due: '2026-10-08T12:00', priority: 'low', status: 'todo', note: 'Unassigned' },
    { id: 'T-314', title: 'Turnover clean', type: 'Turnover', propertyId: 'bf3b', assigneeId: 's3', due: '2026-10-05T14:00', priority: 'high', status: 'done', doneAt: '2026-10-05T13:20', photos: 4 },
    { id: 'T-315', title: 'Check smoke alarm batteries', type: 'Inspection', propertyId: 'hv2', assigneeId: 's2', due: '2026-10-06T12:00', priority: 'medium', status: 'done', doneAt: '2026-10-06T08:40', photos: 1 }
  ];

  /* ---------------- reviews ---------------- */
  var reviewTexts = {
    5: ['Spotless unit and the check-in steps were the clearest we have had. Would book again.', 'Beautiful view, comfy beds, and the host replied within minutes every time.', 'Everything was exactly like the photos. The guidebook coffee picks were great.', 'Perfect location, very clean, smooth self check-in. Highly recommend.', 'Lovely stay. Kids loved the pool and the kitchen had everything we needed.', 'Great value for the area. Quiet at night and super fast Wi-Fi.'],
    4: ['Very good stay overall. Parking instructions could be clearer.', 'Nice and clean, but the towels were a bit thin. Location is excellent.', 'Good apartment, a little street noise at night. Host was responsive.', 'Comfortable and well equipped. Check-in took a while to find the lockbox.'],
    3: ['Location and interior were great, but the AC in the second bedroom was loud and took a day to fix.', 'Decent place, but the bathroom needed a better clean and the Wi-Fi dropped often.', 'OK for a short stay. The photos make it look bigger than it is.'],
    2: ['Hot water stopped on the second day and it took too long to sort out.', 'Not as clean as expected. Hair in the shower and dusty shelves.'],
    1: ['We could not get in for an hour because the door code did not work.']
  };
  var replyTexts = {
    5: 'Thank you so much! We are glad you enjoyed the stay and hope to host you again soon.',
    4: 'Thanks for the kind words and the helpful feedback. We have passed it to the team.',
    3: 'Thank you for telling us. We are sorry about this and have fixed it for future guests.'
  };
  var reviews = [];
  var past = bookings.filter(function (b) { return b.status === 'checked_out' && b.checkOut >= '2026-07-01'; });
  var rr = rng(4242);
  past.forEach(function (b, i) {
    if (rr() > 0.62) return;
    var stars = weighted([[5, 0.66], [4, 0.2], [3, 0.08], [2, 0.04], [1, 0.02]], rr);
    var platform = b.channel === 'direct' ? 'google' : b.channel;
    var date = O.d.add(b.checkOut, 1 + Math.floor(rr() * 4));
    if (date > TODAY) return;
    var age = O.d.diff(date, TODAY);
    var replied = age > 6 ? rr() < 0.92 : age > 2 ? rr() < 0.5 : false;
    if (stars <= 3 && age < 12) replied = false;
    var tagsBy = { 5: ['Cleanliness', 'Check-in', 'Location', 'Communication'], 4: ['Location', 'Value', 'Parking'], 3: ['Maintenance', 'Noise', 'Cleanliness'], 2: ['Maintenance', 'Cleanliness'], 1: ['Check-in', 'Door code'] };
    var text = pick(reviewTexts[stars], rr);
    reviews.push({
      id: 'RV-' + (500 + i), bookingId: b.id, guest: b.guest.name, country: b.guest.country, propertyId: b.propertyId, platform: platform,
      stars: stars, date: date, text: text,
      tags: tagsBy[stars].filter(function () { return rr() < 0.6; }).slice(0, 2),
      sub: { cleanliness: Math.min(5, stars + (rr() < 0.3 ? 0 : 0)), communication: Math.min(5, stars + (rr() < 0.5 ? 1 : 0)), checkin: Math.min(5, stars + (rr() < 0.4 ? 1 : 0)), accuracy: Math.min(5, stars + (rr() < 0.3 ? 1 : 0)) },
      reply: replied ? { text: replyTexts[Math.max(3, stars)] || replyTexts[3], date: O.d.add(date, 1), by: 's2' } : null
    });
  });
  /* make sure the story reviews exist */
  var amira = bk('Amira Hassan', 'or4');
  reviews.push({ id: 'RV-901', bookingId: amira.id, guest: 'Amira Hassan', country: 'MY', propertyId: 'or4', platform: 'booking', stars: 3, date: '2026-10-01', text: 'Location and interior were great, but the air conditioning in the second bedroom was quite loud at night and it took a day for someone to look at it.', tags: ['Maintenance', 'Noise'], sub: { cleanliness: 4, communication: 4, checkin: 5, accuracy: 4 }, reply: null });
  var priya = bk('Priya Nair', 'mrs');
  reviews.push({ id: 'RV-902', bookingId: priya.id, guest: 'Priya Nair', country: 'MY', propertyId: 'mrs', platform: 'vrbo', stars: 5, date: '2026-09-29', text: 'Effortless from booking to checkout. Loved the digital guidebook with the local coffee recommendations and used three of them!', tags: ['Communication', 'Guidebook'], sub: { cleanliness: 5, communication: 5, checkin: 5, accuracy: 5 }, reply: null });
  reviews.push({ id: 'RV-903', bookingId: null, guest: 'Ben Carter', country: 'UK', propertyId: 'bf1a', platform: 'airbnb', stars: 2, date: '2026-10-04', text: 'Hot water stopped on the second day and it took too long to sort out. The view is lovely though.', tags: ['Maintenance'], sub: { cleanliness: 4, communication: 3, checkin: 4, accuracy: 3 }, reply: null });
  reviews.push({ id: 'RV-904', bookingId: null, guest: 'Yuki Tanaka', country: 'JP', propertyId: 'kls', platform: 'airbnb', stars: 4, date: '2026-10-03', text: 'Amazing view of the towers. The building lift was slow at peak times.', tags: ['Location'], sub: { cleanliness: 5, communication: 5, checkin: 4, accuracy: 4 }, reply: null });
  reviews.sort(function (a, b) { return a.date < b.date ? 1 : -1; });

  /* ---------------- guest inbox ---------------- */
  /* the story booking for a guest name: the stay nearest today (several generated guests share names) */
  function stayGap(b) { return b.checkIn <= TODAY && TODAY < b.checkOut ? 0 : Math.min(Math.abs(O.d.diff(b.checkIn, TODAY)), Math.abs(O.d.diff(b.checkOut, TODAY))); }
  function bk(name, pid) { return bookings.filter(function (b) { return b.guest.name === name && b.status !== 'cancelled' && (!pid || b.propertyId === pid); }).sort(function (a, c) { return stayGap(a) - stayGap(c); })[0]; }
  var conversations = [
    { id: 'C-1', bookingId: bk('Hafiz Aziz').id, unread: 2, pinned: true, messages: [
      { from: 'system', text: 'New Airbnb booking confirmed at 9:02 AM: today 12:00 to tomorrow 11:00.', time: '2026-10-06T09:02' },
      { from: 'guest', text: 'Hi, I just booked for today. Can I check in at 12?', time: '2026-10-06T09:05' },
      { from: 'guest', text: 'Also is there parking?', time: '2026-10-06T09:06' }
    ] },
    { id: 'C-2', bookingId: bk('Sarah Tan').id, unread: 0, messages: [
      { from: 'guest', text: 'Hi! Is early check-in possible tomorrow? We land at 10am.', time: '2026-10-05T09:14' },
      { from: 'staff', staffId: 's3', text: 'Let me check the cleaning schedule and get back to you within the hour.', time: '2026-10-05T09:16' },
      { from: 'note', staffId: 's1', text: '@Kavya the guest before checks out at 10:00 and the clean finishes by 11:45, so we can offer 12:00.', time: '2026-10-05T09:20' },
      { from: 'staff', staffId: 's3', text: 'Good news, you can check in from 12:00 noon tomorrow, no extra charge!', time: '2026-10-05T09:22' },
      { from: 'guest', type: 'voice', duration: 14, text: 'Voice note', time: '2026-10-05T09:24' },
      { from: 'staff', staffId: 's3', text: 'You are welcome! Your door code arrives tomorrow at 11:00.', time: '2026-10-05T09:26' }
    ] },
    { id: 'C-3', bookingId: bk('Olivia Chen').id, unread: 1, messages: [
      { from: 'guest', text: 'The kitchen sink is draining very slowly.', time: '2026-10-06T08:31' },
      { from: 'guest', type: 'image', text: 'Photo: kitchen sink', time: '2026-10-06T08:32' },
      { from: 'system', text: 'Maintenance task created and assigned to Raju Kumar.', time: '2026-10-06T08:33' }
    ] },
    { id: 'C-4', bookingId: bk('Emma Laurent').id, unread: 1, messages: [
      { from: 'system', text: 'New Booking.com booking confirmed at 9:47 AM: today 15:00 to 8 Oct.', time: '2026-10-06T09:47' },
      { from: 'guest', text: 'Bonjour! Is there a place to leave luggage before 3pm?', time: '2026-10-06T09:58' }
    ] },
    { id: 'C-5', bookingId: bk('Daniel Wei').id, unread: 0, messages: [
      { from: 'staff', staffId: 's4', text: 'Hi Daniel, the road to Tanah Rata is slow on weekends. Your code works from 3 PM.', time: '2026-10-05T18:02' },
      { from: 'guest', text: 'Thank you, see you tomorrow!', time: '2026-10-05T18:40' }
    ] },
    { id: 'C-6', bookingId: bk('Amira Hassan', 'or4').id, unread: 1, messages: [
      { from: 'guest', text: 'I left a review, but wanted to tell you directly that the AC really needs a look.', time: '2026-10-06T07:12' }
    ] },
    { id: 'C-7', bookingId: bk('The Reyes Family').id, unread: 0, messages: [
      { from: 'staff', staffId: 's4', text: 'Hi! Please verify your ID with this link so we can send your door code.', time: '2026-10-05T10:00' },
      { from: 'guest', text: 'Perfect, we will arrive around 4:30.', time: '2026-10-05T12:20' }
    ] },
    { id: 'C-8', bookingId: bk('Mohammed Al-Farsi').id, unread: 0, messages: [
      { from: 'guest', type: 'file', text: 'Passport_scan.pdf', size: '412 KB', time: '2026-10-03T13:10' },
      { from: 'staff', staffId: 's4', text: 'Thank you, your ID is verified.', time: '2026-10-03T13:25' }
    ] }
  ];

  var quickReplies = [
    { id: 'Q-1', title: 'Wi-Fi details', text: 'Wi-Fi: {wifi_name}, password {wifi_password}. It is also in your guest app.', propertyIds: [] },
    { id: 'Q-2', title: 'Parking', text: 'Parking for {property}: {parking}. Show the guard your booking name.', propertyIds: [] },
    { id: 'Q-3', title: 'Late checkout offer', text: 'You can stay until 2 PM for RM 60. Reply YES and we will add it.', propertyIds: [] },
    { id: 'Q-4', title: 'Early check-in yes', text: 'Good news, your unit is ready early. You can check in from {checkin_time}.', propertyIds: [] },
    { id: 'Q-5', title: 'Pool hours (Bayfront)', text: 'The pool is on level 7 and open 7 AM to 10 PM. Towels are in the hall cupboard.', propertyIds: ['bf3b', 'bf1a'] },
    { id: 'Q-6', title: 'Road to the villa', text: 'From Tanah Rata, take the second left after the tea shop. The gate code is the same as your door code.', propertyIds: ['hv2'] },
    { id: 'Q-7', title: 'Luggage storage (KLCC)', text: 'You can leave luggage with the concierge at lobby level from 9 AM. Mention unit 28F.', propertyIds: ['kls'] },
    { id: 'Q-8', title: 'Heritage house rules', text: 'Please remove shoes inside and keep the antique doors closed when the AC is on.', propertyIds: ['hsg'] }
  ];

  /* ---------------- expenses ---------------- */
  var expenseTypes = ['Cleaning supplies', 'Laundry', 'Repairs & maintenance', 'Utilities', 'Internet & TV', 'Toiletries & amenities', 'Furniture & equipment', 'Transport', 'Marketing', 'Software & subscriptions', 'Others'];
  var payMethods = ['Company card', 'Cash (petty cash)', 'Bank transfer', 'Paid personally (claim)'];
  var expenses = [];
  var er = rng(777), eseq = 300;
  var expSpec = [
    ['Cleaning supplies', ['s3', 's5'], [60, 220], 0.9],
    ['Laundry', ['s4', 's3'], [180, 420], 0.9],
    ['Repairs & maintenance', ['s6', 's2'], [80, 900], 0.7],
    ['Utilities', ['s7'], [180, 520], 0.5],
    ['Internet & TV', ['s7'], [129, 199], 0.4],
    ['Toiletries & amenities', ['s3', 's2'], [90, 260], 0.7],
    ['Furniture & equipment', ['s1', 's2'], [150, 1800], 0.25],
    ['Transport', ['s4', 's6', 's1'], [20, 90], 0.7],
    ['Marketing', ['s1'], [100, 600], 0.3],
    ['Software & subscriptions', ['s1'], [99, 349], 0.3]
  ];
  var expNotes = {
    'Cleaning supplies': ['Floor cleaner and disinfectant', 'Microfibre cloths and sponges', 'Bin bags and toilet cleaner', 'Glass cleaner, mop heads'],
    'Laundry': ['Linen and towels, weekly wash', 'Duvet covers and bath mats', 'Express wash for back-to-back stays', 'Pillow protectors'],
    'Repairs & maintenance': ['Leaking tap, washer replaced', 'Aircon service and gas top-up', 'Door lock batteries', 'Shower mixer repair', 'Water heater check', 'Repaint scuffed wall'],
    'Utilities': ['TNB electricity bill', 'Air Selangor / water bill', 'Indah Water sewerage', 'Gas cylinder refill'],
    'Internet & TV': ['Fibre broadband, monthly', 'Streaming subscription', 'Router replacement'],
    'Toiletries & amenities': ['Shampoo, soap and lotion refills', 'Coffee, tea and sugar sachets', 'Toilet rolls and tissues', 'Welcome snacks'],
    'Furniture & equipment': ['Bedside lamp', 'Replacement kettle', 'Mattress protector set', 'Extra dining chairs', 'Vacuum cleaner'],
    'Transport': ['Grab to the unit for an inspection', 'Parking and toll', 'Petrol for the linen run'],
    'Marketing': ['Instagram promotion', 'Photo shoot for listings', 'Google ads, direct bookings'],
    'Software & subscriptions': ['Smart lock app plan', 'Accounting software', 'Pricing data subscription']
  };
  /* spread each type's items evenly through the month, so the first days of every month are comparable */
  ['2026-06-', '2026-07-', '2026-08-', '2026-09-', '2026-10-'].forEach(function (mon) {
    var monthLen = mon === '2026-06-' || mon === '2026-09-' ? 30 : 31, lastDay = mon === '2026-10-' ? 6 : monthLen;
    expSpec.forEach(function (sp) {
      var n = Math.max(1, Math.round(3 * sp[3] + er()));
      for (var i = 0; i < n; i++) {
        var day = 1 + Math.floor((i + er()) / n * monthLen);
        var prop = sp[0] === 'Marketing' || sp[0] === 'Software & subscriptions' ? null : properties[Math.floor(er() * properties.length)].id;
        var who = sp[1][Math.floor(er() * sp[1].length)];
        var amt = Math.round(sp[2][0] + er() * (sp[2][1] - sp[2][0])), meth = who === 's1' ? 'Company card' : pick(payMethods, er), rec = er() < 0.85, note = pick(expNotes[sp[0]], er);
        if (day > lastDay) continue;
        expenses.push({ id: 'EX-' + (eseq++), date: mon + ('0' + day).slice(-2), propertyId: prop, type: sp[0], amount: amt, paidBy: who, method: meth, receipt: rec, note: note });
      }
    });
  });
  expenses.push({ id: 'EX-' + (eseq++), date: '2026-10-05', propertyId: 'or4', type: 'Repairs & maintenance', amount: 700, paidBy: 's1', method: 'Company card', receipt: true, note: 'Deposit (30%) for a new 1.5HP inverter AC, bedroom 2. Balance RM 1,650 due on installation' });
  expenses.push({ id: 'EX-' + (eseq++), date: '2026-10-04', propertyId: 'hv2', type: 'Others', otherType: 'Pest control', amount: 280, paidBy: 's2', method: 'Bank transfer', receipt: true, note: 'Quarterly termite check' });
  expenses.push({ id: 'EX-' + (eseq++), date: '2026-10-06', propertyId: 'bf1a', type: 'Laundry', amount: 96, paidBy: 's5', method: 'Paid personally (claim)', receipt: true, note: 'Rush linen for same-day booking' });
  expenses.sort(function (a, b) { return a.date < b.date ? 1 : -1; });

  /* capex = buying or replacing an asset that lasts years (furniture, appliances, aircon units, renovation);
     opex = the running cost of operating the units. Every expense carries costClass; the form suggests it from the type. */
  var CAPEX_TYPES = ['Furniture & equipment'];
  expenses.forEach(function (e) { e.costClass = CAPEX_TYPES.indexOf(e.type) >= 0 ? 'capex' : 'opex'; });
  expenses.forEach(function (e) { if (/new 1\.5HP inverter AC/.test(e.note)) e.costClass = 'capex'; });

  /* ---------------- inventory ---------------- */
  /* one central store; stock goes OUT to a unit (used by a staff member, usually at a turnover) and comes IN from purchases.
     A move: {id, date, at, dir:'in'|'out'|'adjust', lines:[{itemId, qty}], propertyId (out), usedBy (out), bookingId?, supplier?, cost? (in, total in the main currency), note, by} */
  var invCats = ['Toiletries & amenities', 'Kitchen & consumables', 'Cleaning supplies', 'Linen & towels', 'Maintenance parts', 'Welcome & guest supplies'];
  /* use: per stay = a + b*nights + c*guests (fractions accumulate per unit, so 0.12 per stay = about one every 8 stays) */
  var invItems = [
    { id: 'IT-TP', name: 'Toilet paper', cat: 'Toiletries & amenities', unit: 'roll', cost: 1.1, reorder: 120, use: [1, 0.5, 0] },
    { id: 'IT-SH', name: 'Shampoo 30 ml', cat: 'Toiletries & amenities', unit: 'bottle', cost: 0.9, reorder: 120, use: [0, 0.15, 0.5] },
    { id: 'IT-CD', name: 'Conditioner 30 ml', cat: 'Toiletries & amenities', unit: 'bottle', cost: 0.9, reorder: 100, use: [0, 0.1, 0.4] },
    { id: 'IT-BW', name: 'Body wash 30 ml', cat: 'Toiletries & amenities', unit: 'bottle', cost: 0.9, reorder: 120, use: [0, 0.15, 0.5] },
    { id: 'IT-HS', name: 'Hand soap refill 500 ml', cat: 'Toiletries & amenities', unit: 'bottle', cost: 6.5, reorder: 12, use: [0.25, 0, 0] },
    { id: 'IT-DK', name: 'Dental kit', cat: 'Toiletries & amenities', unit: 'kit', cost: 1.2, reorder: 80, use: [0, 0, 1] },
    { id: 'IT-TS', name: 'Tissue box', cat: 'Toiletries & amenities', unit: 'box', cost: 2.4, reorder: 40, use: [0.6, 0.1, 0] },
    { id: 'IT-CF', name: 'Coffee capsules', cat: 'Kitchen & consumables', unit: 'capsule', cost: 1.6, reorder: 200, use: [0, 0.6, 0.6] },
    { id: 'IT-TE', name: 'Tea bags', cat: 'Kitchen & consumables', unit: 'bag', cost: 0.25, reorder: 200, use: [0, 0.4, 0.4] },
    { id: 'IT-SU', name: 'Sugar sachets', cat: 'Kitchen & consumables', unit: 'sachet', cost: 0.08, reorder: 300, use: [0, 0.6, 0.6] },
    { id: 'IT-CR', name: 'Creamer sachets', cat: 'Kitchen & consumables', unit: 'sachet', cost: 0.15, reorder: 200, use: [0, 0.4, 0.4] },
    { id: 'IT-WA', name: 'Drinking water 500 ml', cat: 'Kitchen & consumables', unit: 'bottle', cost: 0.7, reorder: 200, use: [0, 0.5, 1] },
    { id: 'IT-DL', name: 'Dishwashing liquid 900 ml', cat: 'Kitchen & consumables', unit: 'bottle', cost: 5.9, reorder: 10, use: [0.18, 0.02, 0] },
    { id: 'IT-SP', name: 'Kitchen sponge', cat: 'Kitchen & consumables', unit: 'piece', cost: 0.6, reorder: 40, use: [1, 0, 0] },
    { id: 'IT-PT', name: 'Paper towels', cat: 'Kitchen & consumables', unit: 'roll', cost: 2.2, reorder: 30, use: [0.4, 0.05, 0] },
    { id: 'IT-FC', name: 'Floor cleaner 2 L', cat: 'Cleaning supplies', unit: 'bottle', cost: 9.9, reorder: 8, use: [0.15, 0, 0] },
    { id: 'IT-DS', name: 'Disinfectant spray', cat: 'Cleaning supplies', unit: 'can', cost: 12.5, reorder: 8, use: [0.12, 0, 0] },
    { id: 'IT-GC', name: 'Glass cleaner 500 ml', cat: 'Cleaning supplies', unit: 'bottle', cost: 6.9, reorder: 6, use: [0.08, 0, 0] },
    { id: 'IT-TC', name: 'Toilet bowl cleaner', cat: 'Cleaning supplies', unit: 'bottle', cost: 5.5, reorder: 8, use: [0.12, 0, 0] },
    { id: 'IT-BB', name: 'Bin bags', cat: 'Cleaning supplies', unit: 'bag', cost: 0.18, reorder: 150, use: [3, 0, 0] },
    { id: 'IT-MC', name: 'Microfibre cloth', cat: 'Cleaning supplies', unit: 'piece', cost: 2.5, reorder: 20, use: [0.1, 0, 0] },
    { id: 'IT-BT', name: 'Bath towel', cat: 'Linen & towels', unit: 'piece', cost: 28, reorder: 20, use: [0.04, 0, 0] },
    { id: 'IT-HT', name: 'Hand towel', cat: 'Linen & towels', unit: 'piece', cost: 12, reorder: 20, use: [0.04, 0, 0] },
    { id: 'IT-SS', name: 'Bedsheet set (queen)', cat: 'Linen & towels', unit: 'set', cost: 89, reorder: 8, use: [0.015, 0, 0] },
    { id: 'IT-PC', name: 'Pillowcase', cat: 'Linen & towels', unit: 'piece', cost: 15, reorder: 20, use: [0.03, 0, 0] },
    { id: 'IT-BM', name: 'Bath mat', cat: 'Linen & towels', unit: 'piece', cost: 18, reorder: 10, use: [0.02, 0, 0] },
    { id: 'IT-AA', name: 'AA batteries (door lock)', cat: 'Maintenance parts', unit: 'piece', cost: 1.5, reorder: 24, use: [0.12, 0, 0] },
    { id: 'IT-LB', name: 'LED bulb E27', cat: 'Maintenance parts', unit: 'piece', cost: 7.9, reorder: 10, use: [0.03, 0, 0] },
    { id: 'IT-AF', name: 'Aircon filter', cat: 'Maintenance parts', unit: 'piece', cost: 25, reorder: 6, use: [0.01, 0, 0] },
    { id: 'IT-9V', name: '9V battery (smoke alarm)', cat: 'Maintenance parts', unit: 'piece', cost: 6.5, reorder: 6, use: [0.01, 0, 0] },
    { id: 'IT-WS', name: 'Welcome snack pack', cat: 'Welcome & guest supplies', unit: 'pack', cost: 8.5, reorder: 30, use: [1, 0, 0] },
    { id: 'IT-SL', name: 'Slippers', cat: 'Welcome & guest supplies', unit: 'pair', cost: 2.8, reorder: 60, use: [0, 0, 1] },
    { id: 'IT-LD', name: 'Laundry detergent pod', cat: 'Welcome & guest supplies', unit: 'pod', cost: 0.9, reorder: 60, use: [0, 0.3, 0] }
  ];
  var itemById = {}; invItems.forEach(function (it) { itemById[it.id] = it; it.active = true; });
  var invMoves = [];
  (function genInventory() {
    var ir = rng(31337), mseq = 1000, INV_FROM = '2026-06-01';
    var stock = {}, acc = {};
    function mv(o) { o.id = 'MV-' + (mseq++); invMoves.push(o); return o; }
    /* opening count the day before the data starts */
    var open = mv({ date: '2026-05-31', at: '2026-05-31T18:00', dir: 'in', kind: 'count', lines: [], note: 'Opening stock count', by: 's2' });
    invItems.forEach(function (it) { var q = Math.max(4, Math.round(it.reorder * 2.5)); stock[it.id] = q; open.lines.push({ itemId: it.id, qty: q }); });
    /* the units that use more than usual in the last 30 days (so the overuse warning has something to show) */
    var OVER = { 'hv2|IT-TP': 1.75, 'kls|IT-CF': 1.8, 'bgf|IT-WA': 1.6 };
    var outs = bookings.filter(function (b) { return b.status !== 'cancelled' && b.checkOut >= INV_FROM && b.checkOut < TODAY; }) /* today's check-outs are restocked after 10:15, so not yet */
      .sort(function (a, b) { return a.checkOut < b.checkOut ? -1 : 1; });
    var day = INV_FROM, oi = 0;
    while (day <= TODAY) {
      /* purchases on Mondays: top every item below 1.5x its reorder level back up to 3x */
      if (O.d.dow(day) === 1) {
        var lines = [], cost = 0;
        invItems.forEach(function (it) { if (stock[it.id] < it.reorder * 1.5) { var q = Math.round(it.reorder * 3 - stock[it.id]); lines.push({ itemId: it.id, qty: q }); stock[it.id] += q; cost += q * it.cost; } });
        if (lines.length) mv({ date: day, at: day + 'T10:30', dir: 'in', kind: 'purchase', lines: lines, supplier: pick(['Mydin wholesale', 'Lotus\'s', 'Shopee', 'Mr DIY', 'Hotel supplies distributor'], ir), cost: Math.round(cost * 100) / 100, note: 'Weekly restock', by: pick(['s2', 's4'], ir) });
      }
      while (oi < outs.length && outs[oi].checkOut === day) {
        var b = outs[oi++], p = propById[b.propertyId], ls = [];
        var recent = O.d.diff(day, TODAY) < 30;
        invItems.forEach(function (it) {
          var k = p.id + '|' + it.id, want = it.use[0] + it.use[1] * b.nights + it.use[2] * b.guests;
          want *= 0.85 + ir() * 0.3;
          if (recent && OVER[k]) want *= OVER[k];
          acc[k] = (acc[k] || 0) + want;
          var q = Math.floor(acc[k]); if (q > 0) { acc[k] -= q; ls.push({ itemId: it.id, qty: q }); stock[it.id] -= q; }
        });
        if (ls.length) mv({ date: day, at: day + 'T' + (b.checkOutTime === '10:00' ? '11:20' : '12:10'), dir: 'out', kind: 'turnover', lines: ls, propertyId: p.id, usedBy: p.housekeeper, bookingId: b.id, note: 'Turnover restock after ' + b.guest.name, by: p.housekeeper });
      }
      day = O.d.add(day, 1);
    }
    /* a couple of hand-entered moves so the log is not only turnovers */
    mv({ date: '2026-10-03', at: '2026-10-03T15:40', dir: 'out', kind: 'repair', lines: [{ itemId: 'IT-LB', qty: 2 }, { itemId: 'IT-AA', qty: 4 }], propertyId: 'hsg', usedBy: 's6', note: 'Two bulbs out in the hallway, lock batteries low', by: 's6' });
    mv({ date: '2026-10-05', at: '2026-10-05T17:05', dir: 'adjust', kind: 'count', lines: [{ itemId: 'IT-BT', qty: -2 }], note: 'Stock count: 2 stained bath towels written off', by: 's3' });
  })();

  /* ---------------- checklists ---------------- */
  /* task.checklistId + task.checks (array of done item ids). Owners edit these templates in Tasks & Cleaning. */
  var checklists = [
    { id: 'CL-checkout', kind: 'checkout', name: 'Check-out turnover', desc: 'After every check-out, before the next guest', items: [
      'Air the unit and check for items left behind', 'Photograph and report any damage', 'Strip beds and bag linen for the laundry', 'Make beds with fresh linen',
      'Replace bath towels, hand towels and bath mat', 'Clean and disinfect bathroom, toilet and shower', 'Wash dishes, wipe kitchen counters and appliances', 'Clear the fridge and wipe it inside',
      'Take out rubbish and put in new bin bags', 'Vacuum and mop every floor', 'Dust surfaces, switches and remote controls', 'Restock toiletries, coffee, tea and water (log it in Inventory)',
      'Test aircon, lights, TV and Wi-Fi', 'Lock up, test the door code and upload final photos'] },
    { id: 'CL-checkin', kind: 'checkin', name: 'Check-in readiness', desc: 'Inspection before a guest arrives', items: [
      'Check-out turnover checklist is complete', 'Beds made and towels laid out for the guest count', 'Welcome pack and drinking water in place', 'Aircon on 30 minutes before arrival',
      'Hot water, lights and Wi-Fi tested', 'New door code tested on the lock', 'Parking pass or access card ready', 'No damage or missing items',
      'Unit smells fresh', 'Photos of living room and bedroom uploaded'] },
    { id: 'CL-daily', kind: 'daily', name: 'Daily housekeeping', desc: 'Light daily service for longer stays, and daily checks of empty units', items: [
      'Tidy living areas and make beds if the guest asked', 'Empty the bins', 'Wipe the bathroom and swap used towels', 'Wash dishes left in the sink',
      'Top up toilet paper, coffee and water', 'Sweep or vacuum floors', 'Look for anything that needs repair', 'Note any guest requests'] }
  ];
  checklists.forEach(function (c) { c.items = c.items.map(function (t, i) { return { id: c.kind[0] + (i + 1), text: t }; }); });
  var CL_FOR = { 'T-301': 'CL-checkout', 'T-302': 'CL-checkout', 'T-303': 'CL-checkout', 'T-305': 'CL-checkin', 'T-309': 'CL-daily', 'T-311': 'CL-checkout', 'T-312': 'CL-checkout', 'T-314': 'CL-checkout' };
  tasks.forEach(function (t) {
    var cl = CL_FOR[t.id] && checklists.filter(function (c) { return c.id === CL_FOR[t.id]; })[0];
    if (cl) {
      var n = t.status === 'done' ? cl.items.length : t.checklist ? Math.round(t.checklist[0] / t.checklist[1] * cl.items.length) : 0;
      t.checklistId = cl.id; t.checks = cl.items.slice(0, n).map(function (x) { return x.id; });
    } else if (t.checklist) {
      /* one-off list (quarterly inspection): items written on the task itself */
      t.customChecklist = ['Smoke alarm and fire extinguisher', 'Aircon filters', 'Water heater and taps', 'Door lock batteries', 'Furniture and fittings', 'Windows and grilles', 'Pest signs', 'Inventory count'].map(function (x, i) { return { id: 'x' + (i + 1), text: x }; });
      t.checks = [];
    }
    delete t.checklist;
  });

  /* ---------------- competitor sets for pricing ---------------- */
  var compNames = ['Sky Suites', 'Harbour View', 'The Residences', 'Urban Nest', 'Garden Court', 'Vista Tower', 'Palm Loft', 'Seri Duplex', 'Casa Verde', 'Lumina Stay'];
  function compSet(pid) {
    var p = propById[pid], r = rng(hash('comp' + pid)), out = [];
    for (var i = 0; i < 7; i++) {
      out.push({
        id: pid + '-c' + i,
        name: compNames[(i + p.name.length) % compNames.length] + ' ' + (1 + Math.floor(r() * 30)) + String.fromCharCode(65 + Math.floor(r() * 6)),
        beds: Math.max(0, p.beds + (r() < 0.25 ? (r() < 0.5 ? -1 : 1) : 0)),
        distanceKm: Math.round((0.2 + r() * 2.3) * 10) / 10,
        rating: Math.round((4.4 + r() * 0.55) * 100) / 100,
        reviews: 20 + Math.floor(r() * 400),
        channel: pick(['airbnb', 'booking', 'agoda'], r),
        priceFactor: 0.85 + r() * 0.35,
        occ: Math.round((0.6 + r() * 0.3) * 100)
      });
    }
    return out;
  }
  function compPrice(comp, pid, iso) {
    var r = rng(hash(comp.id + iso));
    return round5(rateFor(pid, iso) * comp.priceFactor * (0.95 + r() * 0.1));
  }

  /* ---------------- a building with unit types (Channex plan 2.1) ----------------
     Seri Saujana Residences sells two unit types: Deluxe (units 21-1, 22-6, 22-9) and Deluxe Supreme (46-1, 49b).
     Platforms sell the type; Orbique picks the unit (O.assign). Unit numbers are for the team only.
     Generated after everything else, with their own random streams, so the rest of the demo stays exactly as it was. */
  var buildings = [
    { id: 'BD-saujana', name: 'Seri Saujana Residences', address: '2 Jalan Saujana Indah, Bukit Jalil, 57000 Kuala Lumpur', city: 'Kuala Lumpur', state: 'Wilayah Persekutuan', zip: '57000', country: 'MY', currency: 'MYR', lat: 3.0561, lng: 101.6887, propertyType: 'apartment', email: 'stays@orbique.site', phone: '+60 3-2785 1100', checkInTime: '15:00', checkOutTime: '11:00', createdAt: '2026-07-20T10:00' }
  ];
  var unitTypes = [
    { id: 'UT-deluxe', buildingId: 'BD-saujana', name: 'Deluxe', maxGuests: 4, beds: 2, description: 'Two bedrooms, city view, on the middle floors.', order: 1, createdAt: '2026-07-20T10:05' },
    { id: 'UT-supreme', buildingId: 'BD-saujana', name: 'Deluxe Supreme', maxGuests: 6, beds: 3, description: 'Three bedrooms on the high floors, with a balcony.', order: 2, createdAt: '2026-07-20T10:06' }
  ];
  var SAUJANA = [
    ['ss211', '21-1', 'UT-deluxe', 's3', '6721', ['Saujana21-1', 'jalil2026']], ['ss226', '22-6', 'UT-deluxe', 's5', '8264', ['Saujana22-6', 'saujana226']],
    ['ss229', '22-9', 'UT-deluxe', 's3', '9312', ['Saujana22-9', 'indah229']], ['ss461', '46-1', 'UT-supreme', 's5', '4617', ['Saujana46-1', 'skyline461']],
    ['ss49b', '49b', 'UT-supreme', 's3', '4925', ['Saujana49b', 'tower49b']]
  ];
  SAUJANA.forEach(function (u) {
    var sup = u[2] === 'UT-supreme';
    var p = { id: u[0], name: 'Saujana ' + u[1], short: 'Saujana ' + u[1], type: sup ? '3BR apartment' : '2BR apartment', beds: sup ? 3 : 2, area: 'Bukit Jalil, Kuala Lumpur', city: 'Kuala Lumpur',
      address: 'Unit ' + u[1] + ', Seri Saujana Residences, 2 Jalan Saujana Indah, 57000 Kuala Lumpur', base: sup ? 380 : 260, maxGuests: sup ? 6 : 4, owner: 'Saujana Holdings', housekeeper: u[3],
      lockCode: u[4], lockBrand: 'Igloohome', wifi: u[5], parking: 'Basement P2', checkInTime: '15:00', checkOutTime: '11:00',
      buildingId: 'BD-saujana', unitTypeId: u[2], unitNo: u[1], createdAt: '2026-07-20T10:10' };
    properties.push(p); propById[p.id] = p;
  });
  /* a greeting message for Seri Saujana Residences (pages/greetings.js, api/_lib/shared/greeting.cjs): fixed wording, the
     parts that change per booking ({guest_first}, {unit_no}, {door_code} ...) and two fields of its own with a value per unit */
  var greetings = [
    { id: 'GR-saujana-arrival', buildingId: 'BD-saujana', name: 'Arrival', updatedAt: '2026-10-01T10:00', updatedBy: 's1',
      text: 'Hi {guest_first}, welcome to {building}!\n\nYour stay: {checkin_date} {checkin_time} to {checkout_date} {checkout_time} ({nights} nights).\n' +
        'Your unit is {unit_no}. The lobby code is {f_lobby_code} and the door code is {door_code}.\nParking: {f_parking_bay}. Wi-Fi: {wifi_name}, password {wifi_password}.\n\n' +
        'Everything for your stay is in your guest app: {guest_app_link}\nSee you soon!',
      fields: [
        { key: 'lobby_code', label: 'Lobby code', private: true, values: { ss211: '2101', ss226: '2206', ss229: '2209', ss461: '4601', ss49b: '4902' } },
        { key: 'parking_bay', label: 'Parking bay', private: false, values: { ss211: 'P2, bay 21', ss226: 'P2, bay 26', ss229: 'P2, bay 29', ss461: 'P3, bay 46', ss49b: 'P3, bay 49' } }
      ] }
  ];
  /* nearby places for the guest app (pages/nearby.js, api/_lib/shared/geo.cjs): demo picks around Seri Saujana Residences.
     The names are made up for the demo. Walking routes are drawn street-style here (staff get real ones from the routing
     service when they save a place); the exchange counter has none, so the guest app shows its straight-line fallback. */
  function demoRoute(from, to, bend) {
    var mid = from[0] + (to[0] - from[0]) * bend, pts = [from, [mid, from[1]], [mid, to[1]], to];
    var m = 0, rad = Math.PI / 180;
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], x = (b[0] - a[0]) * rad * Math.cos((a[1] + b[1]) / 2 * rad), y = (b[1] - a[1]) * rad;
      m += Math.sqrt(x * x + y * y) * 6371008.8;
    }
    return { coords: pts.map(function (c) { return [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6]; }), meters: Math.round(m), minutes: Math.max(1, Math.round(m / 80)), mode: 'foot' };
  }
  var HOME_LL = [101.6887, 3.0561];
  var places = [
    ['PL-sj-1', 'food', 'Restoran Saujana Corner', 'Nasi lemak and roti canai from 7 AM. Ask for the sambal on the side.', 'Jalan Saujana Indah 3', 3.0574, 101.6896, '7 AM to 11 PM', 0.5],
    ['PL-sj-2', 'streetfood', 'Tuesday night market', 'Every Tuesday from 5 PM. Try the apam balik and grilled satay.', 'Car park beside Jalan Jalil Perkasa', 3.0598, 101.6862, 'Tuesdays 5 PM to 11 PM', 0.3],
    ['PL-sj-3', 'cafe', 'Kopi Jalil', 'Local kopi and kaya toast. Quiet in the mornings.', 'Jalan Saujana Indah 7', 3.0552, 101.6905, '8 AM to 6 PM', 0.6],
    ['PL-sj-4', 'hospital', 'Jalil Specialist Hospital', 'Emergency department open 24 hours. For an ambulance call 999.', 'Jalan Jalil Utama', 3.0622, 101.6958, 'Open 24 hours', 0.4],
    ['PL-sj-5', 'clinic', 'Klinik Saujana 24 Jam', 'Walk-in doctor for fevers, stomach upsets and small cuts.', 'Jalan Saujana Indah 11', 3.0546, 101.6874, 'Open 24 hours', 0.5],
    ['PL-sj-6', 'pharmacy', 'Farmasi Indah', 'Plasters, sunscreen, mosquito repellent and medicine.', 'Jalan Saujana Indah 5', 3.0569, 101.6879, '9 AM to 10 PM', 0.5],
    ['PL-sj-7', 'money', 'Jalil Money Changer', 'Better rates than the airport. Bring your passport.', 'Ground floor, Jalil Square', 3.0531, 101.6921, '10 AM to 8 PM', 0],
    ['PL-sj-8', 'atm', 'ATM at Saujana Mart', 'Takes foreign cards. Next to the convenience store.', 'Jalan Saujana Indah 2', 3.0565, 101.6891, 'Open 24 hours', 0.5],
    ['PL-sj-9', 'convenience', 'Saujana Mart', 'Drinks, snacks, SIM top-ups and Touch \'n Go reloads.', 'Jalan Saujana Indah 2', 3.0566, 101.6892, 'Open 24 hours', 0.5],
    ['PL-sj-10', 'transport', 'Bukit Jalil LRT station', 'Sri Petaling line to the city centre, about 30 minutes to Masjid Jamek.', 'Jalan Jalil Perkasa 1', 3.0583, 101.6923, '6 AM to midnight', 0.7]
  ].map(function (x, i) {
    return { id: x[0], buildingId: 'BD-saujana', category: x[1], name: x[2], note: x[3], address: x[4], lat: x[5], lng: x[6], hours: x[7], phone: '', order: i + 1,
      route: x[8] ? demoRoute(HOME_LL, [x[6], x[5]], x[8]) : null, updatedAt: '2026-10-01T10:00', updatedBy: 's1' };
  });
  var typedFrom = bookings.length;
  function typed(b, typeId) { b.unitTypeId = typeId; b.assignment = { how: 'auto', by: null, at: b.createdAt, locked: false }; return b; }
  var sr = rng(5150);
  function saujanaBooking(o) {
    var p = propById[o.propertyId] || propById[o.unitOf], country = o.country || 'MY';
    /* phone and guest count from this stream, never the shared one (the rest of the demo must not change) */
    var opts = Object.assign({}, o, { propertyId: p.id, phone: phoneFor(country, sr()) });
    if (!opts.guests) opts.guests = 1 + Math.floor(sr() * (p.beds * 2));
    if (!opts.status) opts.status = statusFor(o.checkIn, o.checkOut);
    var b = makeBooking(opts);
    if (o.unassigned) { b.propertyId = null; b.needsUnit = true; }
    if (b.idVerified === undefined) b.idVerified = b.checkIn <= TODAY;
    if (b.codeStatus === undefined) b.codeStatus = b.status === 'cancelled' ? 'cancelled' : b.checkOut <= TODAY ? 'expired' : b.checkIn < TODAY ? 'sent' : (b.idVerified ? 'scheduled' : 'held');
    bookings.push(typed(b, propById[o.unitOf || o.propertyId].unitTypeId));
    return b;
  }
  /* the story: one Deluxe guest arrives today (unit number shows at 2:30 PM), a Deluxe Supreme family is in-house, and an
     Agoda booking for Deluxe on 11 to 14 Oct has no unit yet: each night one Deluxe unit is free, but never the same one */
  saujanaBooking({ propertyId: 'ss211', guest: 'Aiko Suzuki', country: 'JP', channel: 'booking', checkIn: '2026-10-06', checkOut: '2026-10-09', createdAt: '2026-09-18T22:14', checkInTime: '15:00', guests: 2, idVerified: true, codeStatus: 'sent' });
  saujanaBooking({ propertyId: 'ss461', guest: 'Wang Fang', country: 'CN', channel: 'agoda', checkIn: '2026-10-04', checkOut: '2026-10-08', createdAt: '2026-09-09T08:31', guests: 5, idVerified: true, codeStatus: 'sent' });
  saujanaBooking({ propertyId: 'ss211', guest: 'Nur Aisyah', country: 'MY', channel: 'airbnb', checkIn: '2026-10-10', checkOut: '2026-10-12', createdAt: '2026-09-27T13:02', guests: 3 });
  saujanaBooking({ propertyId: 'ss226', guest: 'Haruto Sato', country: 'JP', channel: 'booking', checkIn: '2026-10-12', checkOut: '2026-10-15', createdAt: '2026-09-30T19:45', guests: 2 });
  saujanaBooking({ propertyId: 'ss229', guest: 'Chen Jia Hui', country: 'TW', channel: 'airbnb', checkIn: '2026-10-09', checkOut: '2026-10-16', createdAt: '2026-09-15T07:20', guests: 4 });
  saujanaBooking({ unitOf: 'ss226', unassigned: true, guest: 'Lucas Silva', country: 'BR', channel: 'agoda', checkIn: '2026-10-11', checkOut: '2026-10-14', createdAt: '2026-10-05T21:18', guests: 2, idVerified: false, codeStatus: 'held' });
  saujanaBooking({ propertyId: 'ss49b', guest: 'Mia Johansson', country: 'SE', channel: 'booking', checkIn: '2026-10-09', checkOut: '2026-10-12', createdAt: '2026-10-02T16:40', guests: 4, status: 'pending', idVerified: false, codeStatus: 'held' });
  /* the rest of the calendar, like the other units */
  SAUJANA.forEach(function (u, i) {
    var r = rng(9100 + i * 31), pid = u[0], dd = '2026-08-01';
    while (dd < GEN_TO) {
      var gap = r() < 0.7 ? (r() < 0.6 ? 0 : 1) : 1 + Math.floor(r() * 4);
      var ci = O.d.add(dd, gap), co = O.d.add(ci, weighted([[1, 0.14], [2, 0.32], [3, 0.26], [4, 0.14], [5, 0.08], [7, 0.06]], r));
      if (co > GEN_TO) break;
      var held = u[2] === 'UT-deluxe' && ci < '2026-10-17' && co > '2026-10-08'; /* keep the story above as it is */
      if (held || overlaps(pid, ci, co)) { dd = O.d.add(ci, 1); continue; }
      var lead = weighted([[2, 0.15], [7, 0.25], [14, 0.25], [30, 0.2], [60, 0.15]], r) + Math.floor(r() * 4);
      var created = O.d.add(ci, -lead);
      if (created > TODAY) { dd = co; continue; }
      var g = guestPool[Math.floor(r() * guestPool.length)], st = statusFor(ci, co);
      if (r() < 0.04) st = 'cancelled'; else if (ci > TODAY && r() < 0.05) st = 'pending';
      var hh = 7 + Math.floor(r() * 3), mm = Math.floor(r() * 60);
      var b = saujanaBooking({ propertyId: pid, guest: g[0], country: g[1], channel: weighted([['booking', 0.34], ['agoda', 0.3], ['airbnb', 0.26], ['direct', 0.1]], r), checkIn: ci, checkOut: co, status: st, createdAt: created + 'T' + pad2(hh) + ':' + pad2(mm), idVerified: ci <= TODAY ? true : r() < 0.55 });
      if (st === 'cancelled') b.cancelledAt = O.d.add(created, Math.max(1, Math.floor(lead / 2)));
      dd = co;
    }
  });
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /* invoices for the building's bookings continue the numbering */
  bookings.slice(typedFrom).sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; }).forEach(function (b) {
    if (b.status === 'cancelled') return;
    b.invoiceNo = 'INV-' + b.createdAt.slice(0, 4) + '-' + (invSeq++);
    b.invoiceDate = b.createdAt.slice(0, 10);
    var paidOn = b.status === 'pending' ? null : b.channel === 'direct' ? O.d.add(b.checkIn, -7) : b.createdAt.slice(0, 10);
    if (paidOn && paidOn < b.createdAt.slice(0, 10)) paidOn = b.createdAt.slice(0, 10);
    if (paidOn && paidOn <= TODAY) {
      b.paidAt = paidOn; b.receiptNo = 'RCP-' + paidOn.slice(0, 4) + '-' + (rcpSeq++);
      b.payMethod = b.channel === 'direct' ? 'FPX online banking' : 'Paid via ' + channels[b.channel].name;
    }
    b.invoiceSent = O.d.diff(b.createdAt.slice(0, 10), TODAY) >= 1 ? { via: b.channel === 'direct' ? 'WhatsApp' : 'Email', at: b.createdAt.slice(0, 10) } : null;
    b.receiptSent = b.paidAt && O.d.diff(b.paidAt, TODAY) >= 1 ? { via: 'Email', at: b.paidAt } : null;
  });
  bookings.sort(function (a, b) { return a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0; });

  /* ---------------- metrics (shared so every page agrees) ---------------- */
  function live(b) { return b.status !== 'cancelled'; }
  function nightsIn(b, from, to) { /* nights of booking b that fall within [from, to] inclusive */
    var a = b.checkIn > from ? b.checkIn : from;
    var z = O.d.add(b.checkOut, -1) < to ? O.d.add(b.checkOut, -1) : to;
    return a > z ? 0 : O.d.diff(a, z) + 1;
  }
  var M = {
    live: live,
    nightsIn: nightsIn,
    /* revenue earned on nights from..to (inclusive), optional filter {propertyId, channel} */
    revenue: function (from, to, f) {
      f = f || {};
      return O.data.bookings.reduce(function (s, b) {
        if (!live(b) || (f.propertyId && b.propertyId !== f.propertyId) || (f.channel && b.channel !== f.channel)) return s;
        var n = nightsIn(b, from, to); return s + (n ? b.revenue / b.nights * n : 0);
      }, 0);
    },
    nightsSold: function (from, to, f) {
      f = f || {};
      return O.data.bookings.reduce(function (s, b) {
        if (!live(b) || (f.propertyId && b.propertyId !== f.propertyId) || (f.channel && b.channel !== f.channel)) return s;
        return s + nightsIn(b, from, to);
      }, 0);
    },
    blockedNights: function (from, to, pid) {
      return O.data.blocks.reduce(function (s, x) {
        if (pid && x.propertyId !== pid) return s;
        var a = x.start > from ? x.start : from, z = O.d.add(x.end, -1) < to ? O.d.add(x.end, -1) : to;
        return s + (a > z ? 0 : O.d.diff(a, z) + 1);
      }, 0);
    },
    availableNights: function (from, to, pid) {
      /* each unit counts from the day it was added until the day before it was archived */
      var list = pid ? O.data.properties.filter(function (p) { return p.id === pid; }) : properties;
      if (pid && !list.length) return O.d.diff(from, to) + 1 - M.blockedNights(from, to, pid);
      var days = list.reduce(function (s, p) {
        var a = p.createdAt && String(p.createdAt).slice(0, 10) > from ? String(p.createdAt).slice(0, 10) : from;
        var z = p.archived && p.archivedAt && O.d.add(String(p.archivedAt).slice(0, 10), -1) < to ? O.d.add(String(p.archivedAt).slice(0, 10), -1) : to;
        return s + (a > z ? 0 : O.d.diff(a, z) + 1);
      }, 0);
      return Math.max(0, days - M.blockedNights(from, to, pid));
    },
    occupancy: function (from, to, pid) { var a = M.availableNights(from, to, pid); return a ? M.nightsSold(from, to, pid ? { propertyId: pid } : null) / a : 0; },
    adr: function (from, to, f) { var n = M.nightsSold(from, to, f); return n ? M.revenue(from, to, f) / n : 0; },
    revpar: function (from, to, pid) { var a = M.availableNights(from, to, pid); return a ? M.revenue(from, to, pid ? { propertyId: pid } : null) / a : 0; },
    /* daily revenue series for a date range (array of {date, value}) */
    dailyRevenue: function (from, to, f) { return O.d.range(from, to).map(function (d) { return { date: d, value: M.revenue(d, d, f) }; }); },
    bookingsCreated: function (from, to) { return O.data.bookings.filter(function (b) { var c = b.createdAt.slice(0, 10); return c >= from && c <= to; }); },
    stays: function (from, to, f) { /* bookings with at least one night in range */
      f = f || {};
      return O.data.bookings.filter(function (b) {
        return (!f.propertyId || b.propertyId === f.propertyId) && (!f.status || f.status.indexOf(b.status) >= 0) && b.checkIn <= to && b.checkOut > from;
      });
    },
    /* rejected claims are not company spend; cls = 'opex' | 'capex' | undefined (both) */
    expenses: function (from, to, cls) { return O.data.expenses.filter(function (e) { return e.date >= from && e.date <= to && e.claimStatus !== 'rejected' && (!cls || (e.costClass || 'opex') === cls); }); },
    expenseTotal: function (from, to, cls) { return M.expenses(from, to, cls).reduce(function (s, e) { return s + e.amount; }, 0); },
    platformFees: function (from, to) {
      return O.data.bookings.reduce(function (s, b) { if (!live(b)) return s; var n = nightsIn(b, from, to); return s + (n ? b.platformFee / b.nights * n : 0); }, 0);
    },
    avgRating: function (from, to, pid) {
      var rs = O.data.reviews.filter(function (r) { return r.date >= from && r.date <= to && (!pid || r.propertyId === pid); });
      return rs.length ? rs.reduce(function (s, r) { return s + r.stars; }, 0) / rs.length : null;
    }
  };

  O.data = {
    /* STORY0: the demo's built-in "today". STORY: the same moment after core.js shifts the demo (the story date).
       TODAY / NOW / NOW_TIME: the real Malaysia clock once core.js boots (core keeps them current). */
    STORY0: TODAY, STORY: TODAY, SHIFT: 0, DATA_START: '2026-06-01',
    TODAY: TODAY, NOW: NOW, NOW_TIME: '10:15',
    /* a demo date literal written in page code, moved to match the story date: D.sd('2026-10-05T16:20'). Call it at render time. */
    sd: function (iso) { var D = O.data; if (!iso || !D.SHIFT) return iso; return O.d.add(iso.slice(0, 10), D.SHIFT) + iso.slice(10); },
    invCats: invCats, invItems: invItems, invMoves: invMoves, itemById: itemById, checklists: checklists, capexTypes: CAPEX_TYPES,
    channels: channels, channelOrder: channelOrder, staff: staff, properties: properties, propById: propById, buildings: buildings, unitTypes: unitTypes, places: places,
    bookings: bookings, blocks: blocks, tasks: tasks, reviews: reviews, conversations: conversations, quickReplies: quickReplies, greetings: greetings,
    expenses: expenses, expenseTypes: expenseTypes, payMethods: payMethods, events: events,
    rateFor: rateFor, eventFor: eventFor, compSet: compSet, compPrice: compPrice, countryName: COUNTRY,
    staffById: function (id) { return staff.filter(function (s) { return s.id === id; })[0] || null; },
    booking: function (id) { return bookings.filter(function (b) { return b.id === id; })[0] || null; },
    rng: rng, hash: hash
  };
  O.metrics = M;
})();
