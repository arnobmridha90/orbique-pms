/* Guest App — interactive phone preview of the guest web app + the admin panel that runs it.
   House rules gate the door code (plus ID), requests and damage reports flow to the admin side,
   damage reports create maintenance tasks with photos, door codes can be changed from everywhere. */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;

  /* =================================================================
     DATA (added once on load so other pages can read it too)
     ================================================================= */
  var CITY = { kl: 'Kuala Lumpur', penang: 'Penang', melaka: 'Melaka', cameron: 'Cameron Highlands' };
  var CITY_ORDER = ['kl', 'penang', 'melaka', 'cameron'];
  function cityOf(p) {
    var a = (p && p.area) || '';
    if (/Kuala Lumpur/.test(a)) return 'kl';
    if (/Penang|George Town/.test(a)) return 'penang';
    if (/Melaka/.test(a)) return 'melaka';
    if (/Cameron/.test(a)) return 'cameron';
    return 'kl';
  }

  var GA = D.guestApp = D.guestApp || {
    requireName: true,
    requireId: true,
    rules: [
      { id: 'hr1', title: 'No smoking or vaping indoors', text: 'This includes the balcony. A RM 300 cleaning fee applies if smoke is detected.' },
      { id: 'hr2', title: 'Quiet hours from 10 PM to 8 AM', text: 'Neighbours live here all year. Keep music and voices low, including in the corridors.' },
      { id: 'hr3', title: 'Only registered guests stay overnight', text: 'Your booking is for {guests}. No parties or events, and visitors leave by 10 PM.' },
      { id: 'hr4', title: 'No durian inside the unit', text: 'The smell stays in the furniture for days. Enjoy it at the stalls outside.' },
      { id: 'hr5', title: 'Shoes off inside, please', text: 'Leave shoes on the rack by the door, as is the custom in Malaysian homes.' },
      { id: 'hr6', title: 'Report damage with photos straight away', text: 'Anything already damaged when you arrive should be reported in this app within 2 hours, so you are not charged for it.' },
      { id: 'hr7', title: 'Check out by {checkout}', text: 'Leave the key card on the table, switch off the air-conditioning and close the windows. Late check-out can be requested in the app.' },
      { id: 'hr8', title: 'No pets', text: 'Assistance animals are welcome. Tell us before you arrive.' }
    ],
    videos: [
      { id: 'v1', vlogger: 'Mark Wiens', title: 'Penang street food tour in George Town', city: 'penang', dur: '18:42' },
      { id: 'v2', vlogger: 'Best Ever Food Review Show', title: 'Malaysian food you will not find anywhere else', city: 'kl', dur: '21:10' },
      { id: 'v3', vlogger: 'Kara and Nate', title: 'First impressions of Kuala Lumpur', city: 'kl', dur: '16:24' },
      { id: 'v4', vlogger: 'Luke Martin', title: 'Jalan Alor night market food walk', city: 'kl', dur: '24:05' },
      { id: 'v5', vlogger: 'Drew Binsky', title: 'Melaka in one day', city: 'melaka', dur: '9:48' },
      { id: 'v6', vlogger: 'Lost LeBlanc', title: 'Cameron Highlands tea country road trip', city: 'cameron', dur: '13:36' },
      { id: 'v7', vlogger: 'The Food Ranger', title: 'Penang breakfast: char kway teow and roti canai', city: 'penang', dur: '19:57' },
      { id: 'v8', vlogger: 'Lost LeBlanc', title: 'Malaysia travel guide: what to know before you go', city: 'all', dur: '12:05' }
    ],
    todo: {
      kl: [
        { name: 'Petronas Twin Towers skybridge', cat: 'Sights', tip: 'Book a timed ticket online for the skybridge on level 41 and the deck on level 86. Closed on Mondays.', time: '1 to 2 hours' },
        { name: 'Batu Caves', cat: 'Culture', tip: '272 colourful steps up to the Temple Cave. Free entry. Cover shoulders and knees, and keep food away from the monkeys.', time: '2 hours' },
        { name: 'Jalan Alor food street', cat: 'Food', tip: 'Best after 6 PM: satay, grilled chicken wings, stingray and fresh fruit.', time: 'Evening' },
        { name: 'KL Forest Eco Park canopy walk', cat: 'Nature', tip: 'Rainforest in the city centre, below KL Tower. Go in the morning before the heat.', time: '1 hour' },
        { name: 'Thean Hou Temple', cat: 'Culture', tip: 'Six-tiered Chinese temple with city views. Beautiful at dusk when the lanterns are lit.', time: '1 hour' },
        { name: 'Central Market and Petaling Street', cat: 'Shopping', tip: 'Batik, handicrafts and Chinatown street food in one walk.', time: '2 hours' },
        { name: 'Islamic Arts Museum Malaysia', cat: 'Culture', tip: 'One of the largest collections of Islamic art in Southeast Asia, next to the Perdana Botanical Gardens.', time: '2 hours' }
      ],
      penang: [
        { name: 'George Town street art', cat: 'Culture', tip: 'Start on Armenian Street, where "Children on a Bicycle" is painted. Early morning is cooler and quieter.', time: '2 to 3 hours' },
        { name: 'Penang Hill funicular', cat: 'Nature', tip: 'Go early on a weekday to avoid queues. It is cooler at the top, with The Habitat rainforest walk.', time: 'Half a day' },
        { name: 'Kek Lok Si Temple', cat: 'Culture', tip: 'The largest Buddhist temple in Malaysia, in Air Itam. An inclined lift goes up to the giant Kuan Yin statue.', time: '2 hours' },
        { name: 'Gurney Drive hawker centre', cat: 'Food', tip: 'Char kway teow, asam laksa and oyster omelette. Evenings only.', time: 'Evening' },
        { name: 'Chew Jetty', cat: 'Culture', tip: 'A clan jetty of stilt houses on the waterfront. Families live here, so keep voices low.', time: '45 minutes' },
        { name: 'Batu Ferringhi night market', cat: 'Shopping', tip: 'Stalls along the beach road every evening. Bargain politely.', time: 'Evening' },
        { name: 'Penang National Park', cat: 'Nature', tip: 'Hike or take a boat to Monkey Beach. Register at the park office before you set off.', time: 'Half a day' }
      ],
      melaka: [
        { name: 'Jonker Street night market', cat: 'Shopping', tip: 'Friday to Sunday evenings. Try chicken rice balls and cendol.', time: 'Evening' },
        { name: 'Christ Church and Dutch Square', cat: 'Culture', tip: 'The red Dutch-era square at the heart of the UNESCO World Heritage city.', time: '1 hour' },
        { name: "St Paul's Hill and A Famosa", cat: 'Sights', tip: 'Ruins of a 16th-century Portuguese church and the fort gate below it.', time: '1 hour' },
        { name: 'Melaka River cruise', cat: 'Sights', tip: 'About 45 minutes past murals and old warehouses. Lovely after dark.', time: '45 minutes' },
        { name: 'Baba & Nyonya Heritage Museum', cat: 'Culture', tip: 'A restored Peranakan townhouse on Jalan Tun Tan Cheng Lock. Visits are by guided tour.', time: '1 hour' },
        { name: 'Cendol and Nyonya laksa', cat: 'Food', tip: 'Shaved ice with palm sugar is the best fix for the afternoon heat.', time: '30 minutes' }
      ],
      cameron: [
        { name: 'BOH Sungei Palas tea centre', cat: 'Nature', tip: 'Tea terraces and a café with a valley view. Closed on Mondays.', time: '2 hours' },
        { name: 'Mossy Forest boardwalk', cat: 'Nature', tip: 'Cloud forest near Gunung Brinchang. Bring a jacket and check opening before you go, as parts close for repairs.', time: '2 hours' },
        { name: 'Strawberry farms', cat: 'Food', tip: 'Pick your own around Brinchang and Kea Farm, then try the strawberry scones.', time: '1 hour' },
        { name: 'Golden Hills night market', cat: 'Shopping', tip: 'Evening stalls at Kea Farm with grilled corn, strawberries and local produce. Busiest at weekends.', time: 'Evening' },
        { name: 'Jungle trails', cat: 'Nature', tip: 'Some trails are steep and badly marked. Go with a licensed guide and tell us your route.', time: 'Half a day' },
        { name: 'Cameron Bharat tea house', cat: 'Food', tip: 'Roadside tea house with terrace views, on the way in from Tanah Rata.', time: '1 hour' }
      ]
    },
    dont: [
      { id: 'n1', kind: 'Law', title: 'Do not carry or use illegal drugs', text: 'Penalties are severe and can include long prison sentences, caning and the death penalty for trafficking.' },
      { id: 'n2', kind: 'Law', title: 'Do not overstay your visa or work on a tourist pass', text: 'Overstaying can lead to fines, detention and deportation.' },
      { id: 'n3', kind: 'Law', title: 'Do not insult the royal family, race or religion', text: 'Malaysia has laws covering these topics, and they apply to social media posts too.' },
      { id: 'n4', kind: 'Law', title: 'Do not smoke at restaurants or hawker stalls', text: 'Smoking is banned at all eateries, including open-air stalls and within 3 metres of the tables.' },
      { id: 'n5', kind: 'Law', title: 'Do not eat or drink on LRT, MRT or monorail trains', text: 'It is against the rail rules and you can be fined.' },
      { id: 'n6', kind: 'Etiquette', title: 'Do not wear shoes inside homes, temples or mosques', text: 'Leave them at the door. Mosques lend robes and headscarves to visitors who need them.' },
      { id: 'n7', kind: 'Etiquette', title: 'Do not point with your index finger', text: 'Point with your right thumb, fingers folded, instead.' },
      { id: 'n8', kind: 'Etiquette', title: "Do not touch someone's head or hand things over with your left hand", text: 'Use your right hand to give, receive and eat.' },
      { id: 'n9', kind: 'Etiquette', title: 'Do not expect alcohol everywhere', text: 'Halal restaurants do not serve it. Drink discreetly and never near a mosque.' },
      { id: 'n10', kind: 'Etiquette', title: 'Do not bring durian into hotels, trains or taxis', text: 'It is banned in most of them because of the smell.' },
      { id: 'n11', kind: 'Safety', title: 'Do not take unmetered taxis', text: 'Use Grab or a metered taxi. If there is no meter, agree the fare before you get in.' },
      { id: 'n12', kind: 'Safety', title: 'Do not ignore a high fever after mosquito bites', text: 'Dengue is common. Use repellent and see a doctor if you get a fever.' },
      { id: 'n13', kind: 'Safety', title: 'Do not feed or tease the monkeys', text: 'Macaques at Batu Caves, Penang Hill and Penang National Park snatch food and bags, and can bite.' },
      { id: 'n14', kind: 'Etiquette', title: 'Do not kiss or cuddle in public', text: 'Holding hands is fine, but more than that is frowned upon, especially in rural and religious areas.' }
    ],
    services: [
      { id: 'sim', name: 'Tourist SIM card', icon: 'sim', on: true, price: 'From RM 35', desc: 'Prepaid 5G SIM delivered to your unit. Malaysian law requires registration with your passport.',
        fields: [{ k: 'plan', label: 'Plan', opts: ['7 days unlimited data · RM 35', '15 days unlimited data · RM 55', '30 days unlimited data · RM 75'] }, { k: 'qty', label: 'How many SIM cards', opts: ['1', '2', '3', '4'] }, { k: 'when', label: 'Deliver', opts: ['As soon as possible', 'When I arrive', 'Tomorrow morning'] }] },
      { id: 'car', name: 'Car rental', icon: 'car', on: true, price: 'From RM 140 a day', desc: 'Insured car delivered to the building or the airport. An International Driving Permit is needed if your licence is not in English or Malay.',
        fields: [{ k: 'car', label: 'Car', opts: ['Perodua Myvi, 5 seats · RM 140/day', 'Proton X50 SUV, 5 seats · RM 220/day', 'Toyota Innova, 7 seats · RM 280/day'] }, { k: 'from', label: 'Pick-up date', type: 'date', def: 'in' }, { k: 'to', label: 'Return date', type: 'date', def: 'out' }, { k: 'where', label: 'Pick-up', opts: ['Delivered to the building', 'At the airport'] }] },
      { id: 'tng', name: "Touch 'n Go card", icon: 'card', on: true, price: 'RM 10 + top-up', desc: 'For tolls, trains, buses and parking across Malaysia. Delivered with the top-up already loaded.',
        fields: [{ k: 'topup', label: 'Top-up', opts: ['RM 20', 'RM 50', 'RM 100'] }, { k: 'qty', label: 'How many cards', opts: ['1', '2', '3', '4'] }] },
      { id: 'transfer', name: 'Airport transfer', icon: 'car', on: true, price: 'From RM 95', desc: 'Private car with a driver who meets you at arrivals with your name.',
        fields: [{ k: 'dir', label: 'Direction', opts: ['Airport to the unit', 'Unit to the airport'] }, { k: 'date', label: 'Date', type: 'date', def: 'in' }, { k: 'time', label: 'Time', type: 'time', def: '14:00' }, { k: 'flight', label: 'Flight number', type: 'text', ph: 'e.g. MH 1142' }] },
      { id: 'late', name: 'Late check-out', icon: 'clock', on: true, price: 'From RM 30', desc: 'Stay longer on your departure day, subject to the next booking.',
        fields: [{ k: 'until', label: 'Check out at', opts: ['12:00 PM · RM 30', '2:00 PM · RM 60'] }] },
      { id: 'clean', name: 'Mid-stay clean', icon: 'sparkle', on: true, price: 'RM 80', desc: 'Fresh towels and linen, bins emptied and a full clean.',
        fields: [{ k: 'date', label: 'Day', type: 'date', def: 'tomorrow' }, { k: 'slot', label: 'Time', opts: ['Morning, 9 AM to 12 PM', 'Afternoon, 1 PM to 5 PM'] }] }
    ]
  };
  var SVC_EXTRA = { code: { id: 'code', name: 'Door code help', icon: 'key', on: true } };
  function svc(id) { return GA.services.filter(function (s) { return s.id === id; })[0] || SVC_EXTRA[id] || { id: id, name: id, icon: 'more' }; }

  /* every booking whose code has already been sent must have accepted the house rules (code is released only after) */
  if (!D._gaSeeded) {
    D._gaSeeded = true;
    D.bookings.forEach(function (b) {
      if (b.codeStatus === 'sent' && b.status !== 'cancelled' && b.checkOut >= D.TODAY && !b.rulesAccepted) {
        var at = d.add(b.checkIn, -1) + 'T' + ['18:', '20:', '21:', '19:'][D.hash(b.id) % 4] + String(10 + D.hash(b.id + 'm') % 50);
        if (at > D.NOW) at = D.TODAY + 'T08:' + String(10 + D.hash(b.id) % 40);
        b.rulesAccepted = { at: at, name: b.guest.name.replace(/^The /, '') };
      }
    });
  }
  D.guestRequests = D.guestRequests || [
    { id: 'GR-1045', bookingId: 'BK-4105', type: 'car', summary: 'Proton X50 SUV, 5 seats · 7 Oct to 10 Oct · delivered to the building', status: 'new', at: '2026-10-06T07:55' },
    { id: 'GR-1044', bookingId: 'BK-4110', type: 'sim', summary: '7 days unlimited data · RM 35 · 2 SIM cards · as soon as possible', status: 'new', at: '2026-10-06T08:40' },
    { id: 'GR-1043', bookingId: 'BK-4108', type: 'clean', summary: '6 Oct · afternoon, 1 PM to 5 PM', status: 'confirmed', at: '2026-10-05T20:02', by: 's2', taskId: 'T-309' },
    { id: 'GR-1042', bookingId: 'BK-4108', type: 'car', summary: 'Toyota Innova, 7 seats · 7 Oct to 9 Oct · delivered to the building', status: 'confirmed', at: '2026-10-05T19:20', by: 's2' },
    { id: 'GR-1041', bookingId: 'BK-4111', type: 'tng', summary: 'RM 50 top-up · 1 card', status: 'delivered', at: '2026-10-04T16:05', by: 's4' },
    { id: 'GR-1040', bookingId: 'BK-4109', type: 'transfer', summary: 'Airport to the unit · 4 Oct 1:30 PM · MH 1142', status: 'delivered', at: '2026-10-02T11:12', by: 's4' }
  ];

  /* drawn stand-in "photos" for the demo reports (no external images) */
  function fakePhoto(kind) {
    var svg;
    if (kind === 'sink') svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#C9CED6"/><rect y="70" width="160" height="50" fill="#8E969F"/><ellipse cx="80" cy="66" rx="52" ry="22" fill="#6C747D"/><ellipse cx="80" cy="64" rx="46" ry="17" fill="#A9B1BA"/><ellipse cx="80" cy="66" rx="30" ry="9" fill="#7F8A6E" opacity="0.8"/><circle cx="80" cy="67" r="4" fill="#3B4048"/><rect x="74" y="18" width="12" height="30" rx="4" fill="#B8BEC6"/><rect x="74" y="16" width="34" height="8" rx="4" fill="#B8BEC6"/></svg>';
    else if (kind === 'sink2') svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#7C858F"/><circle cx="80" cy="60" r="34" fill="#9AA3AD"/><circle cx="80" cy="60" r="12" fill="#2E3238"/><path d="M80 48v24M68 60h24" stroke="#5B636C" stroke-width="3"/><ellipse cx="80" cy="62" rx="26" ry="20" fill="#6E7A5C" opacity="0.55"/></svg>';
    else svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#E9ECEF"/><g stroke="#C4CAD1" stroke-width="2"><path d="M0 40h160M0 80h160M40 0v120M80 0v120M120 0v120"/></g><path d="M58 44 70 58 64 66 78 80" stroke="#4A4F57" stroke-width="2.5" fill="none"/><path d="M70 58 84 54" stroke="#4A4F57" stroke-width="1.5" fill="none"/><rect x="0" y="100" width="160" height="20" fill="#D5DADF"/></svg>';
    return O.svgUrl(svg);
  }
  function nextTaskId() {
    var n = D.tasks.reduce(function (m, t) { var x = parseInt(String(t.id).replace(/\D/g, ''), 10); return isNaN(x) ? m : Math.max(m, x); }, 300);
    return 'T-' + (n + 1);
  }
  if (!D.damageReports) {
    var tile = { id: nextTaskId(), title: 'Replace cracked bathroom tile', type: 'Maintenance', propertyId: 'bbs', assigneeId: 's6', due: '2026-10-05T12:00', priority: 'low', status: 'done', doneAt: '2026-10-05T11:20', photos: 1, note: 'Damage report DR-201 from the guest app (Kim Min-jun): already cracked on arrival, guest not charged.' };
    D.tasks.push(tile);
    D.damageReports = [
      { id: 'DR-202', bookingId: 'BK-4109', propertyId: 'hsg', guest: 'Olivia Chen', room: 'Kitchen', item: 'Kitchen sink drain', desc: 'Water drains very slowly and there is a smell from the sink.', when: 'stay', urgent: false, photos: [{ name: 'sink-1.jpg', url: fakePhoto('sink') }, { name: 'sink-2.jpg', url: fakePhoto('sink2') }], at: '2026-10-05T21:40', taskId: 'T-308' },
      { id: 'DR-201', bookingId: 'BK-4111', propertyId: 'bbs', guest: 'Kim Min-jun', room: 'Bathroom', item: 'Cracked tile beside the shower', desc: 'Already cracked when I arrived. Sharp edge at the corner.', when: 'arrival', urgent: false, photos: [{ name: 'tile.jpg', url: fakePhoto('tile') }], at: '2026-10-04T15:32', taskId: tile.id }
    ];
    tile.photoUrls = D.damageReports[1].photos.map(function (ph) { return ph.url; });
    /* the seeded drain report is the guest's report behind task T-308: give the task its photos */
    D.damageReports.forEach(function (r) {
      var t = D.tasks.filter(function (x) { return x.id === r.taskId; })[0];
      if (t && !t.photoUrls) { t.photoUrls = r.photos.map(function (ph) { return ph.url; }); t.photos = Math.max(t.photos || 0, r.photos.length); }
    });
  }

  /* =================================================================
     PAGE STATE + HELPERS
     ================================================================= */
  var st = {
    bid: null, screen: 'home', tab: 'requests', reqFilter: 'open', dmgFilter: 'all', guideTab: 'todo', guideCity: null, vidCity: 'all',
    exploreTab: 'todo', exploreCity: null, signName: '', agree: false, reqForm: null, reqVals: {}, reqDone: null,
    dmg: null, dmgItems: [], dmgErr: '', dmgSent: null, scroll: 0, resetScroll: false
  };
  function newDmg(when, room) { return { when: when || 'stay', room: room || 'Living room', item: '', desc: '', urgent: false, photos: [] }; }
  var ROOMS = ['Living room', 'Bedroom 1', 'Bedroom 2', 'Bedroom 3', 'Kitchen', 'Bathroom', 'Balcony', 'Entrance', 'Other'];

  function live(b) { return b.status !== 'cancelled' && b.status !== 'checked_out'; }
  function previewList() {
    var lim = d.add(D.TODAY, 3);
    return D.bookings.filter(function (b) { return live(b) && b.checkOut > D.TODAY && (b.status === 'checked_in' || (b.checkIn >= D.TODAY && b.checkIn <= lim)); })
      .sort(function (a, b) { return a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : a.checkInTime < b.checkInTime ? -1 : 1; });
  }
  /* permissions come from Staff Access (O.can, defined in pages/staff.js); fall back to the default role matrix */
  var ROLE_FALLBACK = { owner: 'edit', ops: 'edit', frontdesk: 'edit', housekeeping: 'view' };
  function role() { return (O.viewer() || {}).role; }
  function canSee() { return typeof O.can === 'function' ? O.can('guestapp', 'view') : !!ROLE_FALLBACK[role()]; }
  function canEdit() { return typeof O.can === 'function' ? O.can('guestapp', 'edit') : ROLE_FALLBACK[role()] === 'edit'; }
  function canCode() { return typeof O.can === 'function' ? O.can('changeDoorCodes') : ROLE_FALLBACK[role()] === 'edit'; }
  function canMsg() { return typeof O.can === 'function' ? O.can('messageGuests') : !!ROLE_FALLBACK[role()]; }
  function firstName(n) { return /^The /.test(n) ? n.replace(/^The /, '').replace(/ Family$/, ' family') : n.split(' ')[0]; }
  function codeVisible(b) { return !!b.rulesAccepted && (!GA.requireId || b.idVerified) && live(b); }
  function guestLink(b) { return O.ws().domain + '/g/' + b.id.toLowerCase(); }
  function fillVars(s, b) {
    return String(s).replace(/\{guests\}/g, fmt.plural(b.guests, 'guest')).replace(/\{checkout\}/g, fmt.time(b.checkOutTime || '11:00'));
  }
  function ic(name, cls) { return O.icon(name, cls); }
  function reqStatusPill(s) { return s === 'new' ? U.pill('New', 'warn') : s === 'confirmed' ? U.pill('Confirmed', 'info') : s === 'delivered' ? U.pill('Done', 'ok') : U.pill('Declined', 'neutral'); }
  function taskStatusLabel(t) { return !t ? 'No task' : t.status === 'done' ? 'Done' : t.status === 'in_progress' ? 'In progress' : 'To do'; }
  function convFor(bid) { return D.conversations.filter(function (c) { return c.bookingId === bid; })[0]; }
  function sysMsg(bid, text) {
    var c = convFor(bid);
    if (!c) { /* first guest-app event for this stay: open a chat for it so the team sees it in the inbox */
      c = { id: 'C-' + (D.conversations.reduce(function (m, x) { var n = +String(x.id).replace(/\D/g, ''); return n > m ? n : m; }, 0) + 1), bookingId: bid, unread: 0, messages: [], assigneeId: O.state.viewer };
      D.conversations.push(c);
    }
    c.messages.push({ from: 'system', text: text, time: D.NOW });
  }
  /* "Restart preview": remember a booking's guest-app state before the preview first changes it */
  var orig = {};
  function snap(b) { if (!orig[b.id]) orig[b.id] = { rulesAccepted: b.rulesAccepted || null, idVerified: b.idVerified, idSubmittedAt: b.idSubmittedAt || null, codeStatus: b.codeStatus }; }
  function changedInPreview(b) { return !!orig[b.id]; }
  function codeReq(b) { return D.guestRequests.filter(function (r) { return r.bookingId === b.id && r.type === 'code'; })[0]; }
  function lastCodeChange(b) { return (D.lockLog || []).filter(function (l) { return l.bookingId === b.id && /code changed/i.test(l.what || ''); })[0]; }
  function stayDays(b) { return { min: b.checkIn > D.TODAY ? b.checkIn : D.TODAY, max: b.checkOut }; }
  function ytLink(v) { return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(v.vlogger + ' ' + v.title); }
  function mapLink(name, city) { return 'https://www.google.com/maps/search/' + encodeURIComponent(name + ', ' + CITY[city]); }
  function waLink() { return 'https://wa.me/' + String(O.ws().phone || '').replace(/\D/g, ''); }

  /* city thumbnails drawn with SVG (fixed illustration colours, not brand) */
  function thumbSVG(city) {
    var s = '<svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">';
    if (city === 'kl') s += '<defs><linearGradient id="gk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1D2B4F"/><stop offset="1" stop-color="#E58E5A"/></linearGradient></defs><rect width="160" height="90" fill="url(#gk)"/><g fill="#0E1626"><rect x="10" y="58" width="16" height="32"/><rect x="28" y="50" width="12" height="40"/><rect x="118" y="54" width="14" height="36"/><rect x="134" y="62" width="20" height="28"/><path d="M62 90V30l4-6 4 6v60zM90 90V30l4-6 4 6v60z"/><rect x="65" y="12" width="2" height="12"/><rect x="93" y="12" width="2" height="12"/><rect x="70" y="50" width="20" height="3"/><rect x="104" y="40" width="3" height="50"/><circle cx="105.5" cy="38" r="4"/></g>';
    else if (city === 'penang') s += '<defs><linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6C66B"/><stop offset="1" stop-color="#E77D4E"/></linearGradient></defs><rect width="160" height="90" fill="url(#gp)"/><circle cx="118" cy="34" r="12" fill="#FFF1C9"/><path d="M0 52 40 34 70 46 110 30 160 48V90H0z" fill="#3F6B4A"/><rect y="64" width="160" height="26" fill="#2D5E77"/><g fill="#5B3A29"><rect x="18" y="52" width="26" height="12"/><path d="M15 53 31 44 47 53z"/><rect x="60" y="54" width="22" height="10"/><path d="M57 55 71 47 85 55z"/><g stroke="#5B3A29" stroke-width="1.5"><path d="M22 64v12M40 64v12M64 64v12M78 64v12"/></g></g><path d="M0 80q10-3 20 0t20 0 20 0 20 0 20 0 20 0 20 0 20 0" stroke="#9CC5D6" stroke-width="1.5" fill="none"/>';
    else if (city === 'melaka') s += '<rect width="160" height="90" fill="#8FC3DF"/><rect y="70" width="160" height="20" fill="#5C8C6B"/><g fill="#A63A2B"><rect x="30" y="40" width="62" height="34"/><path d="M26 42 61 22 96 42z"/><rect x="54" y="14" width="14" height="28"/></g><g fill="#F3E3D3"><rect x="40" y="52" width="8" height="14" rx="4"/><rect x="58" y="52" width="8" height="14" rx="4"/><rect x="76" y="52" width="8" height="14" rx="4"/></g><g fill="#F5F0E8"><path d="M118 74l6-36h8l6 36z"/></g><g stroke="#5A4636" stroke-width="3" stroke-linecap="round"><path d="M128 36l-14-12M128 36l14 12M128 36l12-14M128 36l-12 14"/></g>';
    else if (city === 'cameron') s += '<rect width="160" height="90" fill="#CFE3E6"/><path d="M0 46 34 26 70 40 104 22 160 40V90H0z" fill="#7FAE84"/><path d="M0 60 40 44 86 58 130 42 160 52V90H0z" fill="#4E8A57"/><g stroke="#3B6E44" stroke-width="2" fill="none" opacity="0.8"><path d="M0 70q40-14 80 0t80 0"/><path d="M0 78q40-14 80 0t80 0"/><path d="M0 86q40-14 80 0t80 0"/></g><rect y="20" width="160" height="8" fill="#FFFFFF" opacity="0.45"/>';
    else s += '<defs><linearGradient id="ga0" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#244A72"/><stop offset="1" stop-color="#2F8C82"/></linearGradient></defs><rect width="160" height="90" fill="url(#ga0)"/><g fill="#F2D27A"><circle cx="34" cy="30" r="10"/></g><g fill="#10263D"><path d="M96 90V40l3-4 3 4v50z"/><circle cx="99" cy="34" r="5"/><rect x="98" y="16" width="2" height="14"/><rect x="60" y="64" width="18" height="26"/><rect x="112" y="58" width="16" height="32"/><rect x="132" y="68" width="22" height="22"/></g><path d="M18 90c4-20 10-30 20-34M38 56c-8-2-14 0-18 4M38 56c4-6 10-8 16-6M38 56c-2-6-8-10-14-10" stroke="#0E3B2E" stroke-width="3" fill="none"/>';
    return s + '</svg>';
  }

  /* image file -> downscaled data URL */
  function readPhoto(file) {
    return new Promise(function (res) {
      var fr = new FileReader();
      fr.onload = function () {
        var url = fr.result, im = new Image();
        im.onload = function () {
          try {
            var sc = Math.min(1, 640 / Math.max(im.width, im.height)), cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(im.width * sc)); cv.height = Math.max(1, Math.round(im.height * sc));
            cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
            res({ name: file.name || 'photo.jpg', url: cv.toDataURL('image/jpeg', 0.82) });
          } catch (e) { res({ name: file.name || 'photo.jpg', url: url }); }
        };
        im.onerror = function () { res(null); };
        im.src = url;
      };
      fr.onerror = function () { res(null); };
      fr.readAsDataURL(file);
    });
  }

  /* =================================================================
     CSS
     ================================================================= */
  O.css('guestapp', `
.pg-guestapp svg{width:16px; height:16px; flex-shrink:0;}
.pg-guestapp .ga-layout{display:grid; grid-template-columns:372px minmax(0,1fr); gap:14px; align-items:start;}
.pg-guestapp .ga-left{position:sticky; top:12px; display:flex; flex-direction:column; gap:10px; min-width:0;}
.pg-guestapp .ga-right{display:flex; flex-direction:column; gap:14px; min-width:0;}
.pg-guestapp .ga-pick{display:flex; flex-direction:column; gap:6px;}
.pg-guestapp .ga-pick .row-flex .select{flex:1; min-width:0;}
.pg-guestapp .ga-under{display:flex; align-items:center; gap:8px; justify-content:space-between; flex-wrap:wrap; font-size:12px; color:var(--muted);}
.pg-guestapp .phone{max-width:350px;}
.pg-guestapp .phone-screen{display:flex; flex-direction:column; background:var(--bg); color:var(--text);}
/* inside the phone */
.pg-guestapp .gp-top{position:sticky; top:0; z-index:3;}
.pg-guestapp .gp-sb{display:flex; justify-content:space-between; align-items:center; padding:9px 20px 5px; font-size:11.5px; font-weight:700; background:var(--brand); color:var(--brand-ink);}
.pg-guestapp .gp-sb svg{width:13px; height:13px;}
.pg-guestapp .gp-head{background:var(--brand); color:var(--brand-ink); padding:6px 14px 12px; display:flex; align-items:center; gap:9px;}
.pg-guestapp .gp-head .ws-logo{width:30px; height:30px; border-radius:8px;}
.pg-guestapp .gp-head .gp-nm{text-align:left; font-family:var(--font-head); font-weight:800; font-size:15px; line-height:1.1;}
.pg-guestapp .gp-head .gp-sbt{text-align:left; font-size:11px; opacity:0.85;}
.pg-guestapp .gp-head .gp-back{background:none; border:none; color:inherit; padding:4px; margin-left:-6px; display:flex; align-items:center;}
.pg-guestapp .gp-head .gp-back svg{width:20px; height:20px;}
.pg-guestapp .gp-body{flex:1; padding:12px; display:flex; flex-direction:column; gap:10px;}
.pg-guestapp .gp-card{background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:12px;}
.pg-guestapp .gp-card h4{font-size:13.5px; font-weight:800; margin:0 0 4px;}
.pg-guestapp .gp-h2{font-family:var(--font-head); font-size:19px; font-weight:800; line-height:1.2; margin:2px 0 0;}
.pg-guestapp .gp-p{font-size:12.5px; color:var(--text-2); line-height:1.45; margin:0;}
.pg-guestapp .gp-steps{display:flex; gap:6px; font-size:11px; font-weight:800;}
.pg-guestapp .gp-steps span{flex:1; white-space:nowrap; padding:5px 6px; border-radius:20px; text-align:center; background:var(--surface); border:1px solid var(--border); color:var(--muted);}
.pg-guestapp .gp-steps span.on{background:var(--brand); color:var(--brand-ink); border-color:var(--brand);}
.pg-guestapp .gp-steps span.done{background:var(--ok-soft); color:var(--ok); border-color:transparent;}
.pg-guestapp .gp-lockt{display:flex; align-items:center; gap:10px; border:1.5px dashed var(--border-strong); background:var(--surface); border-radius:14px; padding:10px 12px;}
.pg-guestapp .gp-lockt .lk{width:34px; height:34px; border-radius:10px; background:var(--surface-2); display:flex; align-items:center; justify-content:center; color:var(--muted);}
.pg-guestapp .gp-lockt .lk svg{width:18px; height:18px;}
.pg-guestapp .gp-lockt .dots{font-family:var(--font-head); font-weight:800; letter-spacing:0.3em; color:var(--faint); font-size:18px;}
.pg-guestapp .gp-rules{list-style:none; margin:0; padding:0; display:flex; flex-direction:column;}
.pg-guestapp .gp-rules li{display:flex; gap:10px; padding:9px 0; border-bottom:1px solid var(--border);}
.pg-guestapp .gp-rules li:last-child{border-bottom:none;}
.pg-guestapp .gp-rules .n{width:22px; height:22px; border-radius:50%; background:var(--brand-soft); color:var(--brand-text); font-weight:800; font-size:11px; display:flex; align-items:center; justify-content:center; flex-shrink:0;}
.pg-guestapp .gp-rules b{display:block; font-size:12.5px;}
.pg-guestapp .gp-rules span.t{font-size:11.5px; color:var(--muted); line-height:1.4;}
.pg-guestapp .gp-sign{display:flex; flex-direction:column; gap:9px;}
.pg-guestapp .gp-sign .check{font-size:12.5px; line-height:1.35;}
.pg-guestapp .gp-sign .check input{width:18px; height:18px;}
.pg-guestapp .gp-btn{width:100%; min-height:42px; font-size:13.5px; border-radius:11px;}
.pg-guestapp .gp-fine{font-size:10.5px; color:var(--faint); text-align:center; line-height:1.4;}
.pg-guestapp .gp-code{background:var(--brand); color:var(--brand-ink); border-radius:16px; padding:14px; display:flex; flex-direction:column; gap:6px;}
.pg-guestapp .gp-code .lbl{font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; opacity:0.85; display:flex; align-items:center; gap:6px;}
.pg-guestapp .gp-code .lbl svg{width:14px; height:14px;}
.pg-guestapp .gp-code .digits{font-family:var(--font-head); font-size:34px; font-weight:800; letter-spacing:0.28em; line-height:1.1; font-variant-numeric:tabular-nums;}
.pg-guestapp .gp-code .sub{font-size:11.5px; opacity:0.9; line-height:1.4;}
.pg-guestapp .gp-code .gp-link{color:inherit; text-decoration:underline; background:none; border:none; padding:0; font-size:11.5px; font-weight:700; align-self:flex-start; min-height:24px;}
.pg-guestapp .gp-code .gp-fix{background:var(--surface); color:var(--text); border-radius:10px; padding:8px 10px; font-size:11.5px; line-height:1.4; display:flex; gap:7px; align-items:flex-start;}
.pg-guestapp .gp-code .gp-fix svg{width:14px; height:14px; margin-top:1px; color:var(--warn);}
.pg-guestapp .gp-code .gp-fix.ok svg{color:var(--ok);}
.pg-guestapp .gp-gate{border-radius:14px; padding:12px; background:var(--warn-soft); display:flex; flex-direction:column; gap:8px;}
.pg-guestapp .gp-gate h4{margin:0; font-size:13.5px;}
.pg-guestapp .gp-checks{display:flex; flex-direction:column; gap:4px; font-size:12px;}
.pg-guestapp .gp-checks div{display:flex; align-items:center; gap:6px;}
.pg-guestapp .gp-checks .ok{color:var(--ok); font-weight:700;}
.pg-guestapp .gp-checks .no{color:var(--warn); font-weight:700;}
.pg-guestapp .gp-checks svg{width:14px; height:14px;}
.pg-guestapp .gp-upload{position:relative; overflow:hidden;}
.pg-guestapp .gp-upload input[type=file]{position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; height:100%;}
.pg-guestapp .gp-prompt{display:flex; gap:10px; align-items:flex-start; background:var(--brand-soft-2); border:1px solid var(--brand-soft); border-radius:14px; padding:11px 12px;}
.pg-guestapp .gp-prompt .pi{width:30px; height:30px; border-radius:9px; background:var(--brand); color:var(--brand-ink); display:flex; align-items:center; justify-content:center; flex-shrink:0;}
.pg-guestapp .gp-prompt b{font-size:12.5px; display:block;}
.pg-guestapp .gp-prompt .gp-p{font-size:11.5px; color:var(--text-2);}
.pg-guestapp .gp-prompt .btn{margin-top:7px;}
.pg-guestapp .gp-wifi{display:flex; align-items:center; gap:10px;}
.pg-guestapp .gp-wifi .wi{width:34px; height:34px; border-radius:10px; background:var(--brand-soft); color:var(--brand-text); display:flex; align-items:center; justify-content:center; flex-shrink:0;}
.pg-guestapp .gp-wifi .wi svg{width:18px; height:18px;}
.pg-guestapp .gp-wifi .k{font-size:10.5px; color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:0.04em;}
.pg-guestapp .gp-wifi .v{font-weight:800; font-size:13px; word-break:break-all;}
.pg-guestapp .gp-facts{display:grid; grid-template-columns:1fr 1fr; gap:8px;}
.pg-guestapp .gp-fact{background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:9px 10px; min-width:0;}
.pg-guestapp .gp-fact .k{font-size:10.5px; color:var(--muted); font-weight:700; display:flex; align-items:center; gap:5px;}
.pg-guestapp .gp-fact .k svg{width:12px; height:12px;}
.pg-guestapp .gp-fact .v{font-weight:800; font-size:12.5px; margin-top:2px; line-height:1.3;}
.pg-guestapp .gp-tiles{display:grid; grid-template-columns:repeat(3,1fr); gap:8px;}
.pg-guestapp .gp-tile{background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:10px 6px; display:flex; flex-direction:column; align-items:center; gap:6px; font-size:11px; font-weight:700; text-align:center; color:var(--text); min-height:72px; justify-content:center; line-height:1.2;}
.pg-guestapp .gp-tile:hover{border-color:var(--brand-strong);}
.pg-guestapp .gp-tile .ti{width:30px; height:30px; border-radius:9px; background:var(--brand-soft); color:var(--brand-text); display:flex; align-items:center; justify-content:center;}
.pg-guestapp .gp-tile .ti svg{width:16px; height:16px;}
.pg-guestapp .gp-contact{display:grid; grid-template-columns:1fr 1fr; gap:8px;}
.pg-guestapp .gp-contact .btn{min-height:40px;}
.pg-guestapp .gp-nav{position:sticky; bottom:0; background:var(--surface); border-top:1px solid var(--border); display:grid; grid-template-columns:repeat(5,1fr); padding:6px 4px 10px; margin-top:auto; z-index:2;}
.pg-guestapp .gp-nav button{background:none; border:none; display:flex; flex-direction:column; align-items:center; gap:3px; font-size:10px; font-weight:700; color:var(--muted); padding:4px 0; min-height:40px; position:relative;}
.pg-guestapp .gp-nav button svg{width:19px; height:19px;}
.pg-guestapp .gp-nav button.on{color:var(--brand-text);}
.pg-guestapp .gp-nav .bd{position:absolute; top:0; right:calc(50% - 18px); min-width:15px; height:15px; border-radius:8px; background:var(--accent); color:var(--accent-ink); font-size:9.5px; display:flex; align-items:center; justify-content:center; padding:0 3px;}
.pg-guestapp .gp-chips{display:flex; gap:6px; overflow-x:auto; scrollbar-width:none; padding-bottom:2px;}
.pg-guestapp .gp-chips .chip{padding:6px 10px; font-size:11.5px;}
.pg-guestapp .gp-vid{display:block; background:var(--surface); border:1px solid var(--border); border-radius:14px; overflow:hidden; color:var(--text); text-decoration:none;}
.pg-guestapp .gp-vid .ga-thumb{position:relative; aspect-ratio:16/9; background:#222;}
.pg-guestapp .ga-thumb svg{width:100%; height:100%; display:block;}
.pg-guestapp .ga-thumb .play{position:absolute; left:50%; top:50%; width:40px; height:40px; margin:-20px 0 0 -20px; border-radius:50%; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; color:#FFFFFF;}
.pg-guestapp .ga-thumb .play svg{width:18px; height:18px; margin-left:2px;}
.pg-guestapp .ga-thumb .dur{position:absolute; right:7px; bottom:7px; background:rgba(0,0,0,0.75); color:#FFFFFF; font-size:10.5px; font-weight:700; padding:1px 6px; border-radius:5px;}
.pg-guestapp .ga-thumb .cty{position:absolute; left:7px; top:7px; background:rgba(0,0,0,0.6); color:#FFFFFF; font-size:10px; font-weight:700; padding:1px 7px; border-radius:10px;}
.pg-guestapp .gp-vid .vm{padding:9px 11px;}
.pg-guestapp .gp-vid .vt{font-weight:800; font-size:12.5px; line-height:1.3;}
.pg-guestapp .gp-vid .vs{font-size:11px; color:var(--muted); margin-top:2px; display:flex; align-items:center; gap:4px;}
.pg-guestapp .gp-vid .vs svg{width:11px; height:11px;}
.pg-guestapp .gp-item{background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:10px 11px; display:flex; flex-direction:column; gap:4px;}
.pg-guestapp .gp-item .it{display:flex; align-items:center; justify-content:space-between; gap:8px;}
.pg-guestapp .gp-item b{font-size:12.5px;}
.pg-guestapp .gp-item .tx{font-size:11.5px; color:var(--text-2); line-height:1.45;}
.pg-guestapp .gp-item .mt{display:flex; gap:10px; align-items:center; font-size:11px; color:var(--muted);}
.pg-guestapp .gp-item .mt a{color:var(--brand-text); font-weight:700; text-decoration:none; display:inline-flex; align-items:center; gap:3px;}
.pg-guestapp .gp-item .mt svg{width:11px; height:11px;}
.pg-guestapp .gp-dont{border-left:3px solid var(--border-strong);}
.pg-guestapp .gp-dont.Law{border-left-color:var(--bad);}
.pg-guestapp .gp-dont.Safety{border-left-color:var(--warn);}
.pg-guestapp .gp-dont.Etiquette{border-left-color:var(--info);}
.pg-guestapp .gp-svcs{display:grid; grid-template-columns:1fr 1fr; gap:8px;}
.pg-guestapp .gp-svc{background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:10px; text-align:left; display:flex; flex-direction:column; gap:5px; min-height:92px; color:var(--text);}
.pg-guestapp .gp-svc:hover{border-color:var(--brand-strong);}
.pg-guestapp .gp-svc.feat{border-color:var(--brand-strong); background:var(--brand-soft-2);}
.pg-guestapp .gp-svc .ti{width:28px; height:28px; border-radius:8px; background:var(--brand-soft); color:var(--brand-text); display:flex; align-items:center; justify-content:center;}
.pg-guestapp .gp-svc b{font-size:12px; line-height:1.2;}
.pg-guestapp .gp-svc span{font-size:11px; color:var(--muted);}
.pg-guestapp .gp-form{display:flex; flex-direction:column; gap:9px;}
.pg-guestapp .gp-form .input, .pg-guestapp .gp-form .select, .pg-guestapp .gp-form .textarea{font-size:13px; min-height:38px;}
.pg-guestapp .gp-form .two{display:grid; grid-template-columns:1fr 1fr; gap:8px;}
.pg-guestapp .gp-req{display:flex; align-items:center; gap:9px; padding:9px 0; border-bottom:1px solid var(--border);}
.pg-guestapp .gp-req:last-child{border-bottom:none;}
.pg-guestapp .gp-req .ti{width:28px; height:28px; border-radius:8px; background:var(--surface-2); display:flex; align-items:center; justify-content:center; flex-shrink:0; color:var(--text-2);}
.pg-guestapp .gp-req .rm{flex:1; min-width:0; font-size:12px;}
.pg-guestapp .gp-req .rm b{display:block; font-size:12.5px;}
.pg-guestapp .gp-req .rm span{color:var(--muted); font-size:11px;}
.pg-guestapp .gp-shots{display:grid; grid-template-columns:repeat(3,1fr); gap:6px;}
.pg-guestapp .gp-shot{position:relative; aspect-ratio:1; border-radius:10px; overflow:hidden; background:var(--surface-2); border:1px solid var(--border);}
.pg-guestapp .gp-shot img{width:100%; height:100%; object-fit:cover; display:block;}
.pg-guestapp .gp-shot button{position:absolute; top:3px; right:3px; width:22px; height:22px; border-radius:50%; border:none; background:rgba(0,0,0,0.6); color:#FFFFFF; font-size:14px; line-height:1; display:flex; align-items:center; justify-content:center; padding:0;}
.pg-guestapp .gp-cam{aspect-ratio:1; border-radius:10px; border:1.5px dashed var(--brand-strong); background:var(--brand-soft-2); color:var(--brand-text); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; font-size:10.5px; font-weight:800; text-align:center; position:relative; overflow:hidden; cursor:pointer;}
.pg-guestapp .gp-cam svg{width:20px; height:20px;}
.pg-guestapp .gp-cam input{position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; height:100%;}
.pg-guestapp .gp-err{font-size:11.5px; color:var(--bad); font-weight:700;}
.pg-guestapp .gp-ok{display:flex; flex-direction:column; align-items:center; text-align:center; gap:6px; padding:16px 12px; background:var(--ok-soft); border-radius:14px;}
.pg-guestapp .gp-ok .oi{width:38px; height:38px; border-radius:50%; background:var(--ok); color:#FFFFFF; display:flex; align-items:center; justify-content:center;}
.pg-guestapp .gp-ok .oi svg{width:20px; height:20px;}
.pg-guestapp .gp-ok b{font-size:14px;}
.pg-guestapp .gp-seg{display:grid; grid-template-columns:1fr 1fr; gap:4px; background:var(--surface-2); border:1px solid var(--border); border-radius:10px; padding:3px;}
.pg-guestapp .gp-seg button{border:none; background:none; border-radius:8px; padding:7px 6px; font-size:11.5px; font-weight:700; color:var(--muted); min-height:34px; line-height:1.2;}
.pg-guestapp .gp-seg button.on{background:var(--surface); color:var(--text); box-shadow:var(--shadow);}
.pg-guestapp .gp-ditem{display:flex; gap:9px; align-items:center; padding:8px 0; border-bottom:1px solid var(--border);}
.pg-guestapp .gp-ditem:last-child{border-bottom:none;}
.pg-guestapp .gp-ditem img{width:40px; height:40px; border-radius:8px; object-fit:cover; flex-shrink:0;}
.pg-guestapp .gp-ditem .rm{flex:1; min-width:0; font-size:12px;}
.pg-guestapp .gp-ditem .rm b{display:block; font-size:12.5px;}
.pg-guestapp .gp-ditem .rm span{color:var(--muted); font-size:11px;}
/* admin side */
.pg-guestapp .ga-steps{display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px;}
.pg-guestapp .ga-step{border:1px solid var(--border); border-radius:10px; padding:10px 11px; display:flex; flex-direction:column; gap:5px; min-width:0; background:var(--surface);}
.pg-guestapp .ga-step.ok{border-color:transparent; background:var(--ok-soft);}
.pg-guestapp .ga-step.wait{border-color:transparent; background:var(--warn-soft);}
.pg-guestapp .ga-step .sh{display:flex; align-items:center; gap:6px; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted);}
.pg-guestapp .ga-step.ok .sh{color:var(--ok);} .pg-guestapp .ga-step.wait .sh{color:var(--warn);}
.pg-guestapp .ga-step .sv{font-weight:800; font-size:13px;}
.pg-guestapp .ga-step .ss{font-size:11.5px; color:var(--text-2);}
.pg-guestapp .ga-step .btn{align-self:flex-start; margin-top:2px;}
.pg-guestapp .ga-door{display:flex; gap:14px; align-items:center; flex-wrap:wrap;}
.pg-guestapp .ga-door .code-big{color:var(--text);}
.pg-guestapp .ga-door .meta{flex:1; min-width:180px; font-size:12px; color:var(--text-2); line-height:1.5;}
.pg-guestapp .ga-linkrow{display:flex; gap:8px; align-items:center; flex-wrap:wrap;}
.pg-guestapp .ga-linkrow .input{flex:1; min-width:180px; font-family:ui-monospace,Menlo,monospace; font-size:12px;}
.pg-guestapp .ga-row{display:flex; gap:12px; align-items:flex-start; padding:11px 0; border-bottom:1px solid var(--border);}
.pg-guestapp .ga-row:last-child{border-bottom:none;}
.pg-guestapp .ga-row .ri{width:32px; height:32px; border-radius:9px; background:var(--brand-soft); color:var(--brand-text); display:flex; align-items:center; justify-content:center; flex-shrink:0;}
.pg-guestapp .ga-row .ri.bad{background:var(--bad-soft); color:var(--bad);}
.pg-guestapp .ga-row .rm{flex:1; min-width:0;}
.pg-guestapp .ga-row .rt{font-weight:700; font-size:13px; display:flex; gap:6px; align-items:center; flex-wrap:wrap;}
.pg-guestapp .ga-row .rs{font-size:12px; color:var(--text-2); margin-top:2px; line-height:1.4;}
.pg-guestapp .ga-row .rx{font-size:11.5px; color:var(--muted); margin-top:3px;}
.pg-guestapp .ga-row .ra{display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; align-items:center; flex-shrink:0; max-width:46%;}
.pg-guestapp .ga-link{background:none; border:none; padding:0; color:var(--brand-text); font-weight:700; font-size:inherit;}
.pg-guestapp .ga-link:hover{text-decoration:underline;}
.pg-guestapp .ga-pics{display:flex; gap:6px; margin-top:7px; flex-wrap:wrap;}
.pg-guestapp .ga-pics button{width:58px; height:58px; border-radius:8px; overflow:hidden; border:1px solid var(--border); padding:0; background:var(--surface-2);}
.pg-guestapp .ga-pics img{width:100%; height:100%; object-fit:cover; display:block;}
.pg-guestapp .ga-edit{display:flex; gap:8px; align-items:flex-start; padding:9px 0; border-bottom:1px solid var(--border);}
.pg-guestapp .ga-edit:last-child{border-bottom:none;}
.pg-guestapp .ga-edit .n{width:22px; height:22px; border-radius:50%; background:var(--surface-2); border:1px solid var(--border); font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-top:8px; color:var(--muted);}
.pg-guestapp .ga-edit .fl{flex:1; min-width:0; display:flex; flex-direction:column; gap:5px;}
.pg-guestapp .ga-edit .fl .input{font-weight:700;}
.pg-guestapp .ga-edit .fl .textarea{min-height:40px; font-size:12.5px; resize:vertical;}
.pg-guestapp .ga-edit .ea{display:flex; gap:4px; flex-shrink:0; margin-top:4px;}
.pg-guestapp .ga-ib{width:32px; height:32px; border-radius:8px; border:1px solid var(--border); background:var(--surface); display:inline-flex; align-items:center; justify-content:center; color:var(--text-2); padding:0;}
.pg-guestapp .ga-ib:hover{background:var(--surface-2);}
.pg-guestapp .ga-ib[disabled]{opacity:0.35; cursor:not-allowed;}
.pg-guestapp .ga-ib svg{width:14px; height:14px;}
.pg-guestapp .ga-vrow{display:flex; gap:10px; align-items:center; padding:8px 0; border-bottom:1px solid var(--border);}
.pg-guestapp .ga-vrow:last-child{border-bottom:none;}
.pg-guestapp .ga-vrow .ga-thumb{position:relative; width:96px; aspect-ratio:16/9; border-radius:8px; overflow:hidden; flex-shrink:0;}
.pg-guestapp .ga-vrow .ga-thumb .dur{font-size:9.5px; right:4px; bottom:4px;}
.pg-guestapp .ga-vrow .rm{flex:1; min-width:0;}
.pg-guestapp .ga-vrow b{font-size:13px; display:block;}
.pg-guestapp .ga-vrow span{font-size:11.5px; color:var(--muted);}
.pg-guestapp .ga-add{border-top:1px solid var(--border); margin-top:6px; padding-top:12px;}
.pg-guestapp .ga-svc{display:flex; gap:12px; align-items:center; padding:10px 0; border-bottom:1px solid var(--border);}
.pg-guestapp .ga-svc:last-child{border-bottom:none;}
.pg-guestapp .ga-svc .rm{flex:1; min-width:0;}
.pg-guestapp .ga-svc b{font-size:13px;}
.pg-guestapp .ga-svc .rs{font-size:12px; color:var(--muted); margin-top:2px;}
.pg-guestapp .ga-svc .ri{width:32px; height:32px; border-radius:9px; background:var(--brand-soft); color:var(--brand-text); display:flex; align-items:center; justify-content:center; flex-shrink:0;}
.pg-guestapp .ga-tabs-card .tabs{margin:0; padding:0 8px;}
.pg-guestapp .switch[disabled]{opacity:0.5; cursor:not-allowed;}
.pg-guestapp .ga-ro{display:flex; gap:10px; padding:9px 0; border-bottom:1px solid var(--border);}
.pg-guestapp .ga-ro:last-child{border-bottom:none;}
.pg-guestapp .ga-ro .n{width:22px; height:22px; border-radius:50%; background:var(--surface-2); border:1px solid var(--border); font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center; flex-shrink:0; color:var(--muted);}
.pg-guestapp .ga-ro b{display:block; font-size:13px;}
.pg-guestapp .ga-ro span.t{font-size:12px; color:var(--text-2);}
.pg-guestapp .ga-optrow{display:flex; gap:16px; flex-wrap:wrap; align-items:center;}
.pg-guestapp .ga-optrow label{display:flex; align-items:center; gap:8px; font-size:12.5px; min-height:36px;}
.pg-guestapp .ga-hint{font-size:11.5px; color:var(--muted); margin-top:3px;}
.pg-guestapp .tabs .tn{display:inline-block; min-width:18px; padding:0 5px; margin-left:5px; border-radius:9px; background:var(--accent); color:var(--accent-ink); font-size:10.5px; line-height:17px; text-align:center;}
.pg-guestapp .ga-subbar{display:flex; gap:8px; align-items:center; justify-content:space-between; flex-wrap:wrap; margin-bottom:6px;}
.ga-photo-modal img{width:100%; border-radius:10px; display:block; background:var(--surface-2);}
.ga-photo-modal .ga-pm-grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px;}
@media (max-width:1180px){
  .pg-guestapp .ga-layout{grid-template-columns:minmax(0,1fr);}
  .pg-guestapp .ga-left{position:static; max-width:372px; width:100%; margin:0 auto;}
}
@media (max-width:640px){
  .pg-guestapp .ga-steps{grid-template-columns:minmax(0,1fr);}
  .pg-guestapp .ga-row{flex-wrap:wrap;}
  .pg-guestapp .ga-row .ra{max-width:none; width:100%; justify-content:flex-start; padding-left:44px;}
  .pg-guestapp .ga-edit{flex-wrap:wrap;}
  .pg-guestapp .ga-edit .fl{flex:1 1 calc(100% - 30px);}
  .pg-guestapp .ga-edit .fl .textarea{min-height:66px;}
  .pg-guestapp .ga-edit .ea{width:100%; justify-content:flex-end; margin-top:0;}
  .pg-guestapp .ga-subbar > .small{width:100%;}
  .pg-guestapp .phone{border-radius:34px; padding:9px;}
  .pg-guestapp .phone-screen{height:640px; border-radius:26px;}
}
`);

  /* =================================================================
     PHONE (guest view)
     ================================================================= */
  function phoneHTML(b) {
    var p = D.propById[b.propertyId], ws = O.ws();
    var gated = !b.rulesAccepted;
    var sc = gated ? 'rules' : st.screen;
    var back = !gated && ['home'].indexOf(sc) < 0 && ['videos', 'explore', 'requests', 'damage'].indexOf(sc) < 0;
    var head = '<div class="gp-top"><div class="gp-sb"><span>' + fmt.time(D.NOW_TIME).replace(' ', ' ') + '</span><span class="row-flex" style="gap:5px">' + ic('sim') + ic('wifi') + '<span>84%</span></span></div>' +
      '<div class="gp-head">' + (back ? '<button type="button" class="gp-back" data-gp="home" aria-label="Back to home">' + ic('left') + '</button>' : '') +
      O.theme.logoHTML(ws, O.theme.get('--brand')) + '<div class="grow"><div class="gp-nm">' + esc(ws.name) + '</div><div class="gp-sbt">' + esc(p.name) + '</div></div></div></div>';
    var body = gated ? rulesGateHTML(b, p) : sc === 'videos' ? videosHTML(b, p) : sc === 'explore' ? exploreHTML(b, p) : sc === 'requests' ? requestsHTML(b, p) : sc === 'damage' ? damageHTML(b, p) : sc === 'rules' ? rulesViewHTML(b, p) : homeHTML(b, p);
    var openReq = D.guestRequests.filter(function (r) { return r.bookingId === b.id && (r.status === 'new' || r.status === 'confirmed'); }).length;
    var navItems = [['home', 'home', 'Home'], ['videos', 'video', 'Videos'], ['explore', 'map', 'Explore'], ['requests', 'sparkle', 'Requests'], ['damage', 'camera', 'Report']].filter(function (n) { return n[0] !== 'videos' || GA.videos.length; });
    var nav = gated ? '' : '<nav class="gp-nav" aria-label="Guest app menu" style="grid-template-columns:repeat(' + navItems.length + ',1fr)">' + navItems.map(function (n) {
      return '<button type="button" data-gp="' + n[0] + '" class="' + (sc === n[0] ? 'on' : '') + '">' + ic(n[1]) + n[2] + (n[0] === 'requests' && openReq ? '<span class="bd">' + openReq + '</span>' : '') + '</button>';
    }).join('') + '</nav>';
    return '<div class="phone" aria-label="Guest app preview"><div class="phone-screen" id="ga-screen">' + head + '<div class="gp-body">' + body + '</div>' + nav + '</div></div>';
  }

  function rulesListHTML(b) {
    return '<ol class="gp-rules">' + GA.rules.map(function (r, i) { return '<li><span class="n">' + (i + 1) + '</span><div><b>' + esc(fillVars(r.title, b)) + '</b><span class="t">' + esc(fillVars(r.text, b)) + '</span></div></li>'; }).join('') + '</ol>';
  }
  function rulesGateHTML(b, p) {
    var needId = GA.requireId && !b.idVerified;
    var valid = st.agree && (!GA.requireName || st.signName.trim().length >= 3);
    var steps = GA.requireId ? '<span class="on">1 Rules</span><span class="' + (needId ? '' : 'done') + '">2 ' + (needId ? 'Verify ID' : 'ID ✓') + '</span><span>3 Door code</span>' : '<span class="on">1 House rules</span><span>2 Door code</span>';
    return '<div class="gp-steps">' + steps + '</div>' +
      '<div><div class="gp-h2">Welcome, ' + esc(firstName(b.guest.name)) + '</div><p class="gp-p" style="margin-top:4px">Before anything else, please read the house rules for ' + esc(p.name) + '. Your door code unlocks once you accept them' + (needId ? ' and your ID is verified' : '') + '.</p></div>' +
      '<div class="gp-lockt"><span class="lk">' + ic('lock') + '</span><div class="grow"><div class="b" style="font-size:12.5px">Door code locked</div><div class="small muted" style="font-size:11px">Unlocks after you accept the rules</div></div><span class="dots">••••</span></div>' +
      '<div class="gp-card"><h4>House rules · ' + GA.rules.length + '</h4>' + (GA.rules.length ? rulesListHTML(b) : '<p class="gp-p">No house rules have been set for this home.</p>') + '</div>' +
      '<div class="gp-card gp-sign"><label class="check"><input type="checkbox" data-ga-agree' + (st.agree ? ' checked' : '') + '><span>I have read the house rules and agree to them' + (b.guests > 1 ? ' for all ' + b.guests + ' guests on this booking' : '') + '.</span></label>' +
      (GA.requireName ? '<div class="field"><label for="ga-sign">Type your full name to sign</label><input id="ga-sign" class="input" data-ga-sign autocomplete="name" placeholder="Full name" value="' + esc(st.signName) + '"></div>' : '') +
      '<button type="button" class="btn btn-primary gp-btn" data-ga="accept"' + (valid ? '' : ' disabled') + '>' + ic('check') + 'Accept and continue</button>' +
      '<div class="gp-fine">Your acceptance is saved with booking ' + esc(b.id) + ' and shared with your host.</div></div>';
  }
  function rulesViewHTML(b) {
    var a = b.rulesAccepted;
    return '<div class="gp-h2">House rules</div>' +
      '<div class="note" style="background:var(--ok-soft); border-color:transparent; font-size:11.5px">Accepted by ' + esc(a.name) + ' on ' + esc(fmt.dateTime(a.at)) + '</div>' +
      '<div class="gp-card">' + rulesListHTML(b) + '</div>';
  }

  function doorCardHTML(b, p) {
    if (codeVisible(b)) {
      var future = b.checkIn > D.TODAY;
      return '<div class="gp-code"><div class="lbl">' + ic('key') + 'Your door code</div>' +
        '<div class="digits" data-ga-code>' + esc(b.doorCode) + '</div>' +
        '<div class="sub">' + esc(p.lockBrand) + ' smart lock. Works from ' + esc(d.fmt(b.checkIn)) + ', ' + esc(fmt.time(b.checkInTime)) + ' until ' + esc(d.fmt(b.checkOut)) + ', ' + esc(fmt.time(b.checkOutTime)) + '.' + (future ? ' It will not open the door before then.' : ' Enter the code, then press the tick key.') + '</div>' +
        codeHelpHTML(b) + '</div>';
    }
    var idSub = b.idSubmittedAt && !b.idVerified;
    return '<div class="gp-gate"><h4>' + ic('lock') + ' Your door code is almost ready</h4>' +
      '<div class="gp-checks"><div class="ok">' + ic('check') + 'House rules accepted</div>' +
      '<div class="' + (b.idVerified ? 'ok' : 'no') + '">' + (b.idVerified ? ic('check') + 'ID verified' : ic('clock') + (idSub ? 'ID submitted ' + fmt.time(b.idSubmittedAt) + ', being checked' : 'ID not verified yet')) + '</div></div>' +
      (idSub ? '<p class="gp-p" style="font-size:11.5px">We usually check IDs within 15 minutes. Your code appears here as soon as it is approved.</p>'
        : '<p class="gp-p" style="font-size:11.5px">Malaysian law requires us to register every guest. Upload a photo of your passport or MyKad and the code unlocks once it is checked.</p>' +
        '<label class="btn btn-primary gp-btn gp-upload">' + ic('camera') + 'Upload passport or MyKad<input type="file" accept="image/*" capture="environment" data-ga-id aria-label="Upload passport or MyKad photo"></label>') + '</div>';
  }
  function codeHelpHTML(b) {
    var r = codeReq(b), ch = lastCodeChange(b);
    if (r && (r.status === 'new' || r.status === 'confirmed')) return '<div class="gp-fix">' + ic('clock') + '<span><b>We are on it.</b> You reported this code at ' + esc(fmt.time(r.at.slice(11, 16))) + '. Your host will call you and a new code will appear here.</span></div>';
    if (ch && ch.at.slice(0, 10) === D.TODAY) return '<div class="gp-fix ok">' + ic('check') + '<span>New code set at ' + esc(fmt.time(ch.at.slice(11, 16))) + '. The old code no longer works.</span></div><button type="button" class="gp-link" data-ga="codehelp">Still not working?</button>';
    return '<button type="button" class="gp-link" data-ga="codehelp">Code not working?</button>';
  }
  function homeHTML(b, p) {
    var arrivalWindow = b.checkIn >= d.add(D.TODAY, -1) && b.checkIn <= D.TODAY;
    var hasArrivalReport = D.damageReports.some(function (r) { return r.bookingId === b.id && r.when === 'arrival'; });
    var openReq = D.guestRequests.filter(function (r) { return r.bookingId === b.id && r.status !== 'declined'; }).slice(0, 2);
    return '<div><div class="gp-h2">Hi ' + esc(firstName(b.guest.name)) + '</div><p class="gp-p" style="margin-top:3px">' + esc(d.fmtRange(b.checkIn, b.checkOut)) + ' · ' + fmt.plural(b.nights, 'night') + ' · ' + fmt.plural(b.guests, 'guest') + '</p></div>' +
      doorCardHTML(b, p) +
      (arrivalWindow && !hasArrivalReport ? '<div class="gp-prompt"><span class="pi">' + ic('camera') + '</span><div><b>' + (b.checkIn === D.TODAY && D.NOW_TIME < b.checkInTime ? 'When you arrive, check for damage first' : b.checkIn === D.TODAY ? 'Just arrived? Check for damage first' : 'Found something already damaged?') + '</b><p class="gp-p">' + (b.checkIn < D.TODAY ? 'Report anything that was broken or marked before you arrived, with photos, so you are not charged for it.' : 'Take photos of anything already broken or marked so you are not charged for it.') + '</p><button type="button" class="btn btn-ghost btn-sm" data-ga="arrivaldmg">Report existing damage</button></div></div>' : '') +
      '<div class="gp-card gp-wifi"><span class="wi">' + ic('wifi') + '</span><div class="grow"><div class="k">Wi-Fi</div><div class="v">' + esc(p.wifi[0]) + '</div><div class="small muted" style="font-size:11.5px">Password <b style="color:var(--text)">' + esc(p.wifi[1]) + '</b></div></div><button type="button" class="btn btn-ghost btn-sm" data-ga="copywifi" aria-label="Copy Wi-Fi password">' + ic('copy') + 'Copy</button></div>' +
      '<div class="gp-facts">' +
      '<div class="gp-fact"><div class="k">' + ic('clock') + 'Check-in</div><div class="v">' + esc(d.fmt(b.checkIn)) + ', ' + esc(fmt.time(b.checkInTime)) + '</div></div>' +
      '<div class="gp-fact"><div class="k">' + ic('clock') + 'Check-out</div><div class="v">' + esc(d.fmt(b.checkOut)) + ', ' + esc(fmt.time(b.checkOutTime)) + '</div></div>' +
      '<div class="gp-fact"><div class="k">' + ic('map') + 'Address</div><div class="v">' + esc(p.name) + ', ' + esc(p.area) + '</div></div>' +
      '<div class="gp-fact"><div class="k">' + ic('car') + 'Parking</div><div class="v">' + esc(p.parking) + '</div></div></div>' +
      '<div class="gp-tiles">' + [['videos', 'video', 'Videos'], ['explore:todo', 'map', 'Things to do'], ['explore:dont', 'alert', 'Things not to do'], ['requests', 'sparkle', 'SIM, car & more'], ['damage', 'camera', 'Report damage'], ['rules', 'rules', 'House rules']].filter(function (t) { return t[0] !== 'videos' || GA.videos.length; }).map(function (t) {
        return '<button type="button" class="gp-tile" data-gp="' + t[0] + '"><span class="ti">' + ic(t[1]) + '</span>' + t[2] + '</button>';
      }).join('') + '</div>' +
      (openReq.length ? '<div class="gp-card"><h4>Your requests</h4>' + openReq.map(reqRowHTML).join('') + '</div>' : '') +
      '<div class="gp-card"><h4>Need help?</h4><p class="gp-p" style="font-size:11.5px; margin-bottom:8px">' + esc(O.ws().name) + ' team, 8 AM to 11 PM. Emergencies any time.</p><div class="gp-contact"><a class="btn btn-primary" href="' + esc(waLink()) + '" target="_blank" rel="noopener">' + ic('whatsapp') + 'WhatsApp</a><a class="btn btn-ghost" href="tel:' + esc(String(O.ws().phone || '').replace(/[^\d+]/g, '')) + '">' + ic('user') + 'Call</a></div></div>';
  }

  function videosHTML(b, p) {
    var cities = ['all'].concat(CITY_ORDER);
    var list = GA.videos.filter(function (v) { return st.vidCity === 'all' || v.city === st.vidCity || v.city === 'all'; });
    return '<div class="gp-h2">Videos</div><p class="gp-p">Travel vlogs about Malaysia, picked by your host. They open on YouTube.</p>' +
      '<div class="gp-chips" role="tablist">' + cities.map(function (c) { return '<button type="button" class="chip' + (st.vidCity === c ? ' on' : '') + '" data-ga-vcity="' + c + '">' + (c === 'all' ? 'All' : esc(CITY[c])) + '</button>'; }).join('') + '</div>' +
      (list.length ? list.map(function (v) {
        return '<a class="gp-vid" href="' + esc(ytLink(v)) + '" target="_blank" rel="noopener"><div class="ga-thumb">' + thumbSVG(v.city) + '<span class="cty">' + esc(v.city === 'all' ? 'Malaysia' : CITY[v.city]) + '</span><span class="play">' + ic('play') + '</span><span class="dur">' + esc(v.dur) + '</span></div>' +
          '<div class="vm"><div class="vt">' + esc(v.title) + '</div><div class="vs">' + esc(v.vlogger) + ' · YouTube ' + ic('up') + '</div></div></a>';
      }).join('') : '<div class="gp-card">' + U.empty('No videos for ' + CITY[st.vidCity] + ' yet.') + '</div>');
  }

  function exploreHTML(b, p) {
    var city = st.exploreCity || cityOf(p);
    var out = '<div class="gp-h2">Explore Malaysia</div><div class="gp-seg"><button type="button" data-ga-ex="todo" class="' + (st.exploreTab === 'todo' ? 'on' : '') + '">Things to do</button><button type="button" data-ga-ex="dont" class="' + (st.exploreTab === 'dont' ? 'on' : '') + '">Things not to do</button></div>';
    if (st.exploreTab === 'todo') {
      var items = GA.todo[city] || [];
      out += '<div class="gp-chips">' + CITY_ORDER.map(function (c) { return '<button type="button" class="chip' + (c === city ? ' on' : '') + '" data-ga-ecity="' + c + '">' + esc(CITY[c]) + (c === cityOf(p) ? ' · you' : '') + '</button>'; }).join('') + '</div>' +
        (items.length ? items.map(function (t) {
          return '<div class="gp-item"><div class="it"><b>' + esc(t.name) + '</b>' + U.pill(t.cat, 'brand') + '</div><div class="tx">' + esc(t.tip) + '</div><div class="mt">' + (t.time ? '<span>' + ic('clock') + ' ' + esc(t.time) + '</span>' : '') + '<a href="' + esc(mapLink(t.name, city)) + '" target="_blank" rel="noopener">' + ic('map') + 'Map</a></div></div>';
        }).join('') : '<div class="gp-card">' + U.empty('No places listed for ' + CITY[city] + ' yet.') + '</div>');
    } else {
      out += '<p class="gp-p">Laws and customs worth knowing. Most locals are very forgiving of visitors, but the laws are strict.</p>' +
        (GA.dont.length ? GA.dont.map(function (n) {
          return '<div class="gp-item gp-dont ' + esc(n.kind) + '"><div class="it"><b>' + esc(n.title) + '</b>' + U.pill(n.kind, n.kind === 'Law' ? 'bad' : n.kind === 'Safety' ? 'warn' : 'info') + '</div><div class="tx">' + esc(n.text) + '</div></div>';
        }).join('') : '<div class="gp-card">' + U.empty('Nothing listed yet.') + '</div>');
    }
    return out;
  }

  function reqRowHTML(r) {
    var s = svc(r.type);
    return '<div class="gp-req"><span class="ti">' + ic(s.icon) + '</span><div class="rm"><b>' + esc(s.name) + '</b><span>' + esc(r.summary) + '</span></div>' + reqStatusPill(r.status) + '</div>';
  }
  function fieldDefault(f, b) {
    if (f.opts) return f.opts[0];
    if (f.def === 'in') return b.checkIn < D.TODAY ? d.add(D.TODAY, 1) : b.checkIn;
    if (f.def === 'out') return b.checkOut;
    if (f.def === 'tomorrow') return d.add(D.TODAY, 1) < b.checkOut ? d.add(D.TODAY, 1) : D.TODAY;
    if (f.def === 'in' || f.def === 'out') return f.def === 'in' ? stayDays(b).min : b.checkOut;
    return f.def || '';
  }
  function requestsHTML(b) {
    if (st.reqDone) {
      var r0 = D.guestRequests.filter(function (r) { return r.id === st.reqDone; })[0];
      if (r0) return '<div class="gp-ok"><span class="oi">' + ic('check') + '</span><b>Request sent</b><p class="gp-p">' + esc(svc(r0.type).name) + ': ' + esc(r0.summary) + '.<br>We will confirm here and on WhatsApp, usually within 30 minutes.</p><button type="button" class="btn btn-ghost btn-sm" data-ga="reqback">Back to requests</button></div>';
    }
    if (st.reqForm) {
      var s = svc(st.reqForm);
      return '<div class="gp-card gp-form"><div class="row-flex"><span class="ti" style="width:30px;height:30px;border-radius:9px;background:var(--brand-soft);color:var(--brand-text);display:flex;align-items:center;justify-content:center">' + ic(s.icon) + '</span><div class="grow"><h4 style="margin:0">' + esc(s.name) + '</h4><div class="small muted" style="font-size:11px">' + esc(s.price || '') + '</div></div></div>' +
        '<p class="gp-p" style="font-size:11.5px">' + esc(s.desc || '') + '</p>' +
        (s.fields || []).map(function (f) {
          var v = st.reqVals[f.k] != null ? st.reqVals[f.k] : fieldDefault(f, b);
          st.reqVals[f.k] = v;
          var idf = 'ga-rf-' + f.k;
          if (f.opts) return '<div class="field"><label for="' + idf + '">' + esc(f.label) + '</label><select id="' + idf + '" class="select" data-ga-rf="' + f.k + '">' + f.opts.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></div>';
          var lim = f.type === 'date' ? stayDays(b) : null;
          return '<div class="field"><label for="' + idf + '">' + esc(f.label) + '</label><input id="' + idf + '" class="input" type="' + (f.type || 'text') + '" data-ga-rf="' + f.k + '" value="' + esc(v) + '"' + (lim ? ' min="' + lim.min + '" max="' + lim.max + '"' : '') + (f.ph ? ' placeholder="' + esc(f.ph) + '"' : '') + '></div>';
        }).join('') +
        '<div class="field"><label for="ga-rf-note">Anything else? (optional)</label><input id="ga-rf-note" class="input" data-ga-rf="note" value="' + esc(st.reqVals.note || '') + '" placeholder="e.g. child seat, delivery after 6 PM"></div>' +
        '<div class="gp-err" data-ga-rferr></div>' +
        '<div class="gp-form two"><button type="button" class="btn btn-ghost" data-ga="reqcancel">Cancel</button><button type="button" class="btn btn-primary" data-ga="reqsend">' + ic('send') + 'Send request</button></div></div>';
    }
    var on = GA.services.filter(function (s) { return s.on; });
    var mine = D.guestRequests.filter(function (r) { return r.bookingId === b.id; }).sort(function (a, c) { return a.at < c.at ? 1 : -1; });
    return '<div class="gp-h2">Requests</div><p class="gp-p">Order anything you need for your stay. Your host confirms each request here.</p>' +
      (on.length ? '<div class="gp-svcs">' + on.map(function (s) {
        return '<button type="button" class="gp-svc' + (['sim', 'car', 'tng'].indexOf(s.id) >= 0 ? ' feat' : '') + '" data-ga-req="' + s.id + '"><span class="ti">' + ic(s.icon) + '</span><b>' + esc(s.name) + '</b><span>' + esc(s.price) + '</span></button>';
      }).join('') + '</div>' : '<div class="gp-card">' + U.empty('Your host has not switched on any requests.') + '</div>') +
      '<div class="gp-card"><h4>Your requests</h4>' + (mine.length ? mine.map(reqRowHTML).join('') : '<p class="gp-p" style="font-size:11.5px">Nothing requested yet.</p>') + '</div>';
  }

  function damageHTML(b, p) {
    if (st.dmgSent) {
      var n = st.dmgSent;
      return '<div class="gp-ok"><span class="oi">' + ic('check') + '</span><b>Damage report sent</b><p class="gp-p">' + fmt.plural(n.items, 'item') + ' with ' + fmt.plural(n.photos, 'photo') + '. ' + (n.when === 'arrival' ? 'It is logged as already damaged when you arrived, so you will not be charged for it.' : 'Our maintenance team has it and will contact you to arrange a visit.') + '</p><button type="button" class="btn btn-ghost btn-sm" data-ga="dmgagain">Report another item</button></div>' + pastDamageHTML(b);
    }
    var f = st.dmg || (st.dmg = newDmg());
    var rooms = p.beds ? ROOMS.filter(function (r) { return !/Bedroom (\d)/.test(r) || +r.slice(-1) <= p.beds; }) : ROOMS.filter(function (r) { return !/Bedroom/.test(r); }).map(function (r) { return r === 'Living room' ? 'Main room' : r; });
    if (rooms.indexOf(f.room) < 0) f.room = rooms[0];
    return '<div class="gp-h2">Report damage</div><p class="gp-p">Every damaged item needs at least one photo. Report what you find as soon as you see it.</p>' +
      '<div class="gp-seg"><button type="button" data-ga-when="arrival" class="' + (f.when === 'arrival' ? 'on' : '') + '">Already damaged when I arrived</button><button type="button" data-ga-when="stay" class="' + (f.when === 'stay' ? 'on' : '') + '">Happened during my stay</button></div>' +
      (st.dmgItems.length ? '<div class="gp-card"><h4>In this report · ' + fmt.plural(st.dmgItems.length, 'item') + '</h4>' + st.dmgItems.map(function (it, i) {
        return '<div class="gp-ditem"><img src="' + esc(it.photos[0].url) + '" alt=""><div class="rm"><b>' + esc(it.item) + '</b><span>' + esc(it.room) + ' · ' + fmt.plural(it.photos.length, 'photo') + '</span></div><button type="button" class="ga-ib" data-ga-rmitem="' + i + '" aria-label="Remove ' + esc(it.item) + '">' + ic('trash') + '</button></div>';
      }).join('') + '</div>' : '') +
      '<div class="gp-card gp-form"><h4 style="margin:0">' + (st.dmgItems.length ? 'Next item' : 'Damaged item') + '</h4>' +
      '<div class="field"><label>Photos (required)</label><div class="gp-shots">' + f.photos.map(function (ph, i) {
        return '<div class="gp-shot"><img src="' + esc(ph.url) + '" alt="Photo ' + (i + 1) + '"><button type="button" data-ga-rmphoto="' + i + '" aria-label="Remove photo ' + (i + 1) + '">×</button></div>';
      }).join('') + (f.photos.length < 6 ? '<label class="gp-cam">' + ic('camera') + (f.photos.length ? 'Add photo' : 'Take photo') + '<input type="file" accept="image/*" capture="environment" multiple data-ga-photo aria-label="Take a photo of the damaged item"></label>' : '') + '</div></div>' +
      '<div class="gp-form two"><div class="field"><label for="ga-dm-room">Room</label><select id="ga-dm-room" class="select" data-ga-dm="room">' + rooms.map(function (r) { return '<option' + (r === f.room ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="ga-dm-item">Item</label><input id="ga-dm-item" class="input" data-ga-dm="item" value="' + esc(f.item) + '" placeholder="e.g. Coffee table"></div></div>' +
      '<div class="field"><label for="ga-dm-desc">What is wrong? (required)</label><textarea id="ga-dm-desc" class="textarea" data-ga-dm="desc" rows="2" placeholder="e.g. Glass top has a crack in the corner">' + esc(f.desc) + '</textarea></div>' +
      (f.when === 'stay' ? '<label class="check" style="font-size:12px"><input type="checkbox" data-ga-dm="urgent"' + (f.urgent ? ' checked' : '') + '><span>It is unsafe or stops us using something</span></label>' : '') +
      '<div class="gp-err" data-ga-dmerr>' + esc(st.dmgErr) + '</div>' +
      '<button type="button" class="btn btn-primary gp-btn" data-ga="dmgsend">' + ic('send') + 'Send report' + (st.dmgItems.length ? ' · ' + fmt.plural(st.dmgItems.length + (f.photos.length || f.item ? 1 : 0), 'item') : '') + '</button>' +
      '<button type="button" class="btn btn-ghost gp-btn" data-ga="dmgadd">' + ic('plus') + 'Save and add another item</button></div>' +
      pastDamageHTML(b);
  }
  function pastDamageHTML(b) {
    var mine = D.damageReports.filter(function (r) { return r.bookingId === b.id; });
    if (!mine.length) return '';
    return '<div class="gp-card"><h4>Reported by you</h4>' + mine.map(function (r) {
      var t = D.tasks.filter(function (x) { return x.id === r.taskId; })[0];
      return '<div class="gp-ditem"><img src="' + esc(r.photos[0].url) + '" alt=""><div class="rm"><b>' + esc(r.item) + '</b><span>' + esc(r.room) + ' · ' + esc(fmt.dateTime(r.at)) + '</span></div>' + (t && t.status === 'done' ? U.pill('Fixed', 'ok') : r.when === 'arrival' ? U.pill('Logged', 'info') : U.pill('With maintenance', 'warn')) + '</div>';
    }).join('') + '</div>';
  }

  /* =================================================================
     ADMIN PANEL
     ================================================================= */
  function kpisHTML() {
    var arr = D.bookings.filter(function (b) { return live(b) && (b.status === 'checked_in' || b.checkIn === D.TODAY); });
    var acc = arr.filter(function (b) { return b.rulesAccepted; }).length;
    var soon = D.bookings.filter(function (b) { return live(b) && b.checkIn >= D.TODAY && b.checkIn <= d.add(D.TODAY, 1); });
    var held = soon.filter(function (b) { return !codeVisible(b); });
    var open = D.guestRequests.filter(function (r) { return r.status === 'new' || r.status === 'confirmed'; });
    var nw = open.filter(function (r) { return r.status === 'new'; }).length;
    var wk = D.damageReports.filter(function (r) { return r.at.slice(0, 10) >= d.add(D.TODAY, -6); });
    var openTasks = wk.filter(function (r) { var t = D.tasks.filter(function (x) { return x.id === r.taskId; })[0]; return t && t.status !== 'done'; }).length;
    return U.kpis([
      { label: 'House rules accepted', value: acc + ' of ' + arr.length, sub: "today's guests", title: 'Bookings in-house now or checking in today whose guest has accepted the house rules in the app', hl: true },
      { label: 'Codes still hidden', value: String(held.length), sub: held.length ? held.slice(0, 2).map(function (b) { return esc(firstName(b.guest.name)); }).join(', ') + (held.length > 2 ? ' +' + (held.length - 2) : '') : 'none today or tomorrow', title: 'Arrivals today and tomorrow who cannot see their door code yet: ' + held.map(function (b) { return b.guest.name + ' (' + (!b.rulesAccepted ? 'rules' : 'ID') + ')'; }).join(', ') },
      { label: 'Open requests', value: String(open.length), sub: nw + ' waiting for a reply' },
      { label: 'Damage reports', value: String(wk.length), sub: openTasks + ' open ' + (openTasks === 1 ? 'task' : 'tasks') + ' · last 7 days' }
    ]);
  }

  function guestCardHTML(b) {
    var p = D.propById[b.propertyId], a = b.rulesAccepted, vis = codeVisible(b);
    var idState = b.idVerified ? 'ok' : GA.requireId ? 'wait' : '';
    var steps = '<div class="ga-steps">' +
      '<div class="ga-step ' + (a ? 'ok' : 'wait') + '"><div class="sh">' + ic(a ? 'check' : 'rules') + '1 · House rules</div><div class="sv">' + (a ? 'Accepted' : 'Not accepted yet') + '</div><div class="ss">' + (a ? 'Signed "' + esc(a.name) + '" · ' + esc(fmt.dateTime(a.at)) : 'Shown first when the guest opens the app') + '</div>' + (changedInPreview(b) ? '<button type="button" class="btn btn-ghost btn-xs" data-ga="resetrules">Restart preview</button>' : '') + '</div>' +
      '<div class="ga-step ' + idState + '"><div class="sh">' + ic(b.idVerified ? 'check' : 'user') + '2 · ID check</div><div class="sv">' + (b.idVerified ? 'ID verified' : b.idSubmittedAt ? 'ID photo received' : 'ID pending') + '</div><div class="ss">' + (b.idVerified ? esc(b.guest.countryName) + ' · ' + (b.guest.foreign ? 'passport' : 'MyKad') : b.idSubmittedAt ? 'Uploaded in the app ' + esc(fmt.time(b.idSubmittedAt)) : 'Guest has not uploaded an ID yet') + (!b.idVerified && !GA.requireId ? '. Not needed for the door code.' : '') + '</div>' +
      (!b.idVerified && canEdit() ? '<button type="button" class="btn btn-' + (b.idSubmittedAt ? 'primary' : 'ghost') + ' btn-xs" data-ga="verify">Mark ID verified</button>' : '') + '</div>' +
      '<div class="ga-step ' + (vis ? 'ok' : 'wait') + '"><div class="sh">' + ic(vis ? 'check' : 'lock') + '3 · Door code</div><div class="sv">' + (vis ? 'Shown in the app' : 'Hidden in the app') + '</div><div class="ss">' + (vis ? 'Guest can see code ' + esc(b.doorCode) : !a && !b.idVerified ? 'Unlocks after rules and ID' : !a ? 'Unlocks after the rules are accepted' : 'Unlocks after the ID check') + '</div></div></div>';
    var door = '<div class="ga-door"><div><div class="label" style="margin-bottom:2px">Guest code</div><div class="code-big">' + esc(b.doorCode) + '</div></div>' +
      '<div class="meta"><b>' + esc(p.lockBrand) + ' smart lock</b> · ' + esc(p.short) + '<br>Valid ' + esc(d.fmt(b.checkIn)) + ' ' + esc(fmt.time(b.checkInTime)) + ' to ' + esc(d.fmt(b.checkOut)) + ' ' + esc(fmt.time(b.checkOutTime)) + '<br>' + O.readinessHTML(b) + '</div>' +
      (canCode() ? '<button type="button" class="btn btn-primary" data-ga="lock">' + ic('key') + 'Change door code</button>' : '<span class="small muted">Your role cannot change door codes</span>') + '</div>';
    var sent = (D.sentLog || []).filter(function (l) { return l.bookingId === b.id && l.kind === 'guest app link'; })[0];
    var link = '<div class="ga-linkrow"><input class="input" readonly value="' + esc(guestLink(b)) + '" aria-label="Guest app link"><button type="button" class="btn btn-ghost btn-sm" data-ga="copylink">' + ic('copy') + 'Copy</button>' + (canEdit() ? '<button type="button" class="btn btn-ghost btn-sm" data-ga="sendlink">' + ic('whatsapp') + (sent ? 'Send again' : 'Send to guest') + '</button>' : '') + '</div>' +
      '<div class="ga-hint">' + (sent ? 'Sent on ' + esc(sent.via) + ' ' + esc(fmt.dateTime(sent.at)) + '.' : b.checkIn > D.TODAY ? 'Goes out automatically with the pre-arrival message.' : 'Included in the booking confirmation message. Send it again if the guest cannot find it.') + '</div>';
    return '<div class="card"><div class="card-head"><div class="row-flex" style="min-width:0">' + U.avatar(b.guest.name) + '<div style="min-width:0"><h3>' + esc(b.guest.name) + '</h3><div class="sub">' + esc(b.id) + ' · ' + esc(p.name) + ' · ' + esc(d.fmtRange(b.checkIn, b.checkOut)) + ' · ' + fmt.plural(b.guests, 'guest') + '</div></div></div>' +
      '<div class="row-flex wrap">' + U.status(b.status) + U.plat(b.channel) + '<button type="button" class="btn btn-ghost btn-sm" data-ga="openbk">Open booking</button></div></div>' +
      '<div class="card-body stack" style="gap:14px">' + steps + door + '<div><div class="label" style="margin-bottom:5px">Guest app link · no download needed</div>' + link + '</div></div></div>';
  }

  function requestsTabHTML() {
    var all = D.guestRequests.slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    var groups = { open: function (r) { return r.status === 'new' || r.status === 'confirmed'; }, done: function (r) { return r.status === 'delivered'; }, declined: function (r) { return r.status === 'declined'; }, all: function () { return true; } };
    var list = all.filter(groups[st.reqFilter]);
    var chips = '<div class="chips">' + [['open', 'Open'], ['done', 'Done'], ['declined', 'Declined'], ['all', 'All']].map(function (c) { return '<button type="button" class="chip' + (st.reqFilter === c[0] ? ' on' : '') + '" data-ga-rfilt="' + c[0] + '">' + c[1] + ' <span class="n">' + all.filter(groups[c[0]]).length + '</span></button>'; }).join('') + '</div>';
    var ed = canEdit();
    return '<div class="ga-subbar">' + chips + '<span class="small muted">Guests are notified in the app when you update a request.</span></div>' +
      (ed ? '' : '<div class="note" style="margin:4px 0 6px">View only: ' + esc(O.viewer().roleLabel) + ' can see guest requests but not confirm or decline them.</div>') +
      (list.length ? list.map(function (r) {
        var b = D.booking(r.bookingId), p = b && D.propById[b.propertyId], s = svc(r.type);
        if (!b) return '';
        var acts = '';
        var openR = r.status === 'new' || r.status === 'confirmed';
        if (r.type === 'code' && openR) {
          if (canCode()) acts += '<button type="button" class="btn btn-primary btn-xs" data-ga-rlock="' + r.id + '">' + ic('key') + 'Change door code</button>';
          if (ed) acts += '<button type="button" class="btn btn-ghost btn-xs" data-ga-rset="' + r.id + ':delivered">Mark solved</button>';
        } else if (ed) {
          if (r.status === 'new') acts += '<button type="button" class="btn btn-primary btn-xs" data-ga-rset="' + r.id + ':confirmed">Confirm</button><button type="button" class="btn btn-ghost btn-xs" data-ga-rset="' + r.id + ':declined">Decline</button>';
          else if (r.status === 'confirmed') acts += '<button type="button" class="btn btn-ghost btn-xs" data-ga-rset="' + r.id + ':delivered">Mark done</button>';
        }
        if (canMsg()) acts += '<button type="button" class="btn btn-ghost btn-xs" data-ga-msg="' + b.id + '" aria-label="Message ' + esc(b.guest.name) + '" title="Message ' + esc(b.guest.name) + '">' + ic('chat') + '</button>';
        var extra = '';
        if (r.type === 'late' && openR) {
          var nxt = D.bookings.filter(function (x) { return x.propertyId === b.propertyId && x.id !== b.id && x.status !== 'cancelled' && x.checkIn === b.checkOut; })[0];
          extra = '<div class="rx" style="color:' + (nxt ? 'var(--warn)' : 'var(--ok)') + '">' + (nxt ? 'Next guest ' + esc(nxt.guest.name) + ' arrives the same day at ' + esc(fmt.time(nxt.checkInTime)) + ', so check the clean can still finish.' : 'Nobody arrives at ' + esc(p.short) + ' on ' + esc(d.fmt(b.checkOut)) + ', so a late check-out is safe.') + '</div>';
        }
        return '<div class="ga-row"><span class="ri' + (r.type === 'code' ? ' bad' : '') + '">' + ic(s.icon) + '</span><div class="rm"><div class="rt">' + esc(s.name) + ' ' + reqStatusPill(r.status) + (isFlash(r.id) ? U.pill('Just now', 'accent') : '') + '</div><div class="rs">' + esc(r.summary) + (r.note ? ' · "' + esc(r.note) + '"' : '') + '</div>' +
          '<div class="rx"><button type="button" class="ga-link" data-ga-bk="' + b.id + '">' + esc(b.guest.name) + '</button> · ' + esc(p.short) + ' · ' + esc(r.id) + ' · ' + esc(fmt.ago(r.at)) + (r.by ? ' · handled by ' + esc(D.staffById(r.by).name) : '') + (r.taskId ? ' · task ' + esc(r.taskId) : '') + '</div>' + extra + '</div><div class="ra">' + acts + '</div></div>';
      }).join('') : U.empty(st.reqFilter === 'open' ? 'No open requests. New ones from the guest app appear here.' : 'No requests in this view.'));
  }

  function damageTabHTML() {
    var all = D.damageReports.slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    var f = { all: function () { return true; }, arrival: function (r) { return r.when === 'arrival'; }, stay: function (r) { return r.when === 'stay'; } };
    var list = all.filter(f[st.dmgFilter]);
    var chips = '<div class="chips">' + [['all', 'All'], ['arrival', 'Damaged before arrival'], ['stay', 'During the stay']].map(function (c) { return '<button type="button" class="chip' + (st.dmgFilter === c[0] ? ' on' : '') + '" data-ga-dfilt="' + c[0] + '">' + c[1] + ' <span class="n">' + all.filter(f[c[0]]).length + '</span></button>'; }).join('') + '</div>';
    return '<div class="ga-subbar">' + chips + '<span class="small muted">Each report creates a maintenance task with the photos.</span></div>' +
      (list.length ? list.map(function (r) {
        var b = D.booking(r.bookingId), p = D.propById[r.propertyId], t = D.tasks.filter(function (x) { return x.id === r.taskId; })[0];
        var who = t && t.assigneeId ? D.staffById(t.assigneeId).name : 'unassigned';
        return '<div class="ga-row"><span class="ri bad">' + ic('camera') + '</span><div class="rm"><div class="rt">' + esc(r.item) + ' ' + (r.when === 'arrival' ? U.pill('Before arrival', 'info') : U.pill('During stay', 'warn')) + (r.urgent ? U.pill('Unsafe', 'bad') : '') + (isFlash(r.id) ? U.pill('Just now', 'accent') : '') + '</div>' +
          '<div class="rs">' + esc(r.room) + ' · ' + esc(r.desc || 'No description') + '</div>' +
          '<div class="rx">' + (b ? '<button type="button" class="ga-link" data-ga-bk="' + b.id + '">' + esc(r.guest) + '</button>' : esc(r.guest)) + ' · ' + esc(p.short) + ' · ' + esc(fmt.dateTime(r.at)) + ' · ' + fmt.plural(r.photos.length, 'photo') + '</div>' +
          '<div class="ga-pics">' + r.photos.map(function (ph, i) { return '<button type="button" data-ga-pic="' + r.id + ':' + i + '" aria-label="View photo ' + (i + 1) + ' of ' + esc(r.item) + '"><img src="' + esc(ph.url) + '" alt=""></button>'; }).join('') + '</div></div>' +
          '<div class="ra">' + (t ? '<span class="small muted">Task ' + esc(t.id) + ' · ' + esc(who) + '</span>' + (t.status === 'done' ? U.pill('Done', 'ok') : t.status === 'in_progress' ? U.pill('In progress', 'info') : U.pill('To do', 'warn')) + '<button type="button" class="btn btn-ghost btn-xs" data-ga-task="' + t.id + '">Open task</button>' : U.pill('No task', 'neutral')) + '</div></div>';
      }).join('') : U.empty('No damage reports in this view.'));
  }

  function optSwitch(key, label, ed) {
    return '<label><button type="button" class="switch' + (GA[key] ? ' on' : '') + '" data-ga-opt="' + key + '" role="switch" aria-checked="' + !!GA[key] + '" aria-label="' + esc(label) + '"' + (ed ? '' : ' disabled') + '></button>' + esc(label) + (ed ? '' : ' · ' + (GA[key] ? 'on' : 'off')) + '</label>';
  }
  function rulesTabHTML() {
    var ed = canEdit();
    var opts = '<div class="ga-optrow">' + optSwitch('requireName', 'Guests type their full name to accept', ed) + optSwitch('requireId', 'Door code also needs a verified ID', ed) + '</div>' +
      '<div class="note brand">House rules are the first screen every guest sees. The door code stays hidden until they tick agree' + (GA.requireName ? ' and sign with their name' : '') + (GA.requireId ? ', and until their ID is verified' : '') + '.' + (ed ? ' Use {guests} and {checkout} to fill in booking details.' : '') + '</div>';
    if (!ed) {
      var b = cur();
      return '<div class="stack" style="gap:10px">' + opts + (GA.rules.length ? '<div>' + GA.rules.map(function (r, i) {
        return '<div class="ga-ro"><span class="n">' + (i + 1) + '</span><div><b>' + esc(b ? fillVars(r.title, b) : r.title) + '</b><span class="t">' + esc(b ? fillVars(r.text, b) : r.text) + '</span></div></div>';
      }).join('') + '</div>' : U.empty('No house rules have been set.')) + '</div>';
    }
    return '<div class="stack" style="gap:10px">' + opts +
      '<div>' + GA.rules.map(function (r, i) {
        return '<div class="ga-edit"><span class="n">' + (i + 1) + '</span><div class="fl"><input class="input" data-ga-rule="' + r.id + ':title" value="' + esc(r.title) + '" aria-label="Rule ' + (i + 1) + ' title"><textarea class="textarea" rows="2" data-ga-rule="' + r.id + ':text" aria-label="Rule ' + (i + 1) + ' details">' + esc(r.text) + '</textarea></div>' +
          '<div class="ea"><button type="button" class="ga-ib" data-ga-rmove="' + r.id + ':-1" aria-label="Move rule ' + (i + 1) + ' up"' + (i === 0 ? ' disabled' : '') + '>' + ic('up') + '</button><button type="button" class="ga-ib" data-ga-rmove="' + r.id + ':1" aria-label="Move rule ' + (i + 1) + ' down"' + (i === GA.rules.length - 1 ? ' disabled' : '') + '>' + ic('down') + '</button><button type="button" class="ga-ib" data-ga-rdel="' + r.id + '" aria-label="Delete rule ' + (i + 1) + '">' + ic('trash') + '</button></div></div>';
      }).join('') + (GA.rules.length ? '' : U.empty('No rules yet. Add at least one so guests have something to accept.')) + '</div>' +
      '<div><button type="button" class="btn btn-ghost btn-sm" data-ga="addrule">' + ic('plus') + 'Add a rule</button></div></div>';
  }

  function videosTabHTML() {
    var ed = canEdit();
    return '<div>' + (GA.videos.length ? GA.videos.map(function (v) {
      return '<div class="ga-vrow"><a class="ga-thumb" href="' + esc(ytLink(v)) + '" target="_blank" rel="noopener" aria-label="Open ' + esc(v.title) + ' on YouTube">' + thumbSVG(v.city) + '<span class="dur">' + esc(v.dur) + '</span></a><div class="rm"><b>' + esc(v.title) + '</b><span>' + esc(v.vlogger) + ' · ' + esc(v.city === 'all' ? 'All Malaysia' : CITY[v.city]) + ' · ' + esc(v.dur) + '</span></div>' +
        (ed ? '<button type="button" class="ga-ib" data-ga-vdel="' + v.id + '" aria-label="Remove ' + esc(v.title) + '">' + ic('trash') + '</button>' : '') + '</div>';
    }).join('') : U.empty('No videos. The Videos section is hidden from guests until you add one.')) + '</div>' +
      (ed ? '<div class="ga-add"><div class="section-title" style="margin-top:0">Add a video</div><div class="form-grid">' +
        '<div class="field"><label for="ga-v-vlogger">Vlogger or channel</label><input id="ga-v-vlogger" class="input" data-ga-vf="vlogger" placeholder="e.g. Mark Wiens"></div>' +
        '<div class="field"><label for="ga-v-title">Video title</label><input id="ga-v-title" class="input" data-ga-vf="title" placeholder="e.g. Best nasi lemak in Kuala Lumpur"></div>' +
        '<div class="field"><label for="ga-v-city">City</label><select id="ga-v-city" class="select" data-ga-vf="city"><option value="all">All Malaysia</option>' + CITY_ORDER.map(function (c) { return '<option value="' + c + '">' + esc(CITY[c]) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="ga-v-dur">Length (min:sec)</label><input id="ga-v-dur" class="input" data-ga-vf="dur" inputmode="numeric" placeholder="12:30"></div></div>' +
        '<div class="row-flex wrap" style="margin-top:10px"><button type="button" class="btn btn-primary btn-sm" data-ga="addvideo">' + ic('plus') + 'Add video</button><span class="small" style="color:var(--bad)" data-ga-verr></span></div><div class="ga-hint" style="margin-top:6px">Guests tap a video to open a YouTube search for it in a new tab.</div></div>' : '');
  }

  var PLACE_PH = { kl: 'e.g. Perdana Botanical Gardens', penang: 'e.g. Penang Botanic Gardens', melaka: 'e.g. Melaka Straits Mosque', cameron: 'e.g. Time Tunnel museum' };
  function guideTabHTML() {
    var ed = canEdit(), city = st.guideCity || cityOf(D.propById[(cur() || {}).propertyId]);
    var out = '<div class="ga-subbar">' + U.seg([['todo', 'Things to do'], ['dont', 'Things not to do']], st.guideTab, 'data-ga-gtab') + '<span class="small muted">Changes show in the guest app straight away.</span></div>';
    if (st.guideTab === 'todo') {
      var items = GA.todo[city] || [];
      out += '<div class="chips" style="margin-bottom:6px">' + CITY_ORDER.map(function (c) { return '<button type="button" class="chip' + (c === city ? ' on' : '') + '" data-ga-gcity="' + c + '">' + esc(CITY[c]) + ' <span class="n">' + (GA.todo[c] || []).length + '</span></button>'; }).join('') + '</div>' +
        (items.length ? items.map(function (t, i) {
          return '<div class="ga-vrow"><div class="rm"><b>' + esc(t.name) + ' ' + U.pill(t.cat, 'brand') + '</b><span>' + esc(t.tip) + (t.time ? ' · ' + esc(t.time) : '') + '</span></div>' + (ed ? '<button type="button" class="ga-ib" data-ga-tdel="' + city + ':' + i + '" aria-label="Remove ' + esc(t.name) + '">' + ic('trash') + '</button>' : '') + '</div>';
        }).join('') : U.empty('No places for ' + CITY[city] + ' yet.')) +
        (ed ? '<div class="ga-add"><div class="section-title" style="margin-top:0">Add a place in ' + esc(CITY[city]) + '</div><div class="form-grid"><div class="field"><label for="ga-t-name">Place</label><input id="ga-t-name" class="input" data-ga-tf="name" placeholder="' + esc(PLACE_PH[city] || '') + '"></div>' +
          '<div class="field"><label for="ga-t-cat">Type</label><select id="ga-t-cat" class="select" data-ga-tf="cat">' + ['Sights', 'Food', 'Nature', 'Culture', 'Shopping'].map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label for="ga-t-tip">Tip for guests</label><input id="ga-t-tip" class="input" data-ga-tf="tip" placeholder="When to go, what to bring, how to get there"></div>' +
          '<div class="field"><label for="ga-t-time">Time needed (optional)</label><input id="ga-t-time" class="input" data-ga-tf="time" placeholder="e.g. 2 hours"></div></div>' +
          '<div class="row-flex wrap" style="margin-top:10px"><button type="button" class="btn btn-primary btn-sm" data-ga="addtodo">' + ic('plus') + 'Add place</button><span class="small" style="color:var(--bad)" data-ga-terr></span></div></div>' : '');
    } else {
      out += (GA.dont.length ? GA.dont.map(function (n) {
        return '<div class="ga-vrow"><div class="rm"><b>' + esc(n.title) + ' ' + U.pill(n.kind, n.kind === 'Law' ? 'bad' : n.kind === 'Safety' ? 'warn' : 'info') + '</b><span>' + esc(n.text) + '</span></div>' + (ed ? '<button type="button" class="ga-ib" data-ga-ndel="' + n.id + '" aria-label="Remove ' + esc(n.title) + '">' + ic('trash') + '</button>' : '') + '</div>';
      }).join('') : U.empty('Nothing listed yet.')) +
        (ed ? '<div class="ga-add"><div class="section-title" style="margin-top:0">Add a point</div><div class="form-grid"><div class="field"><label for="ga-n-title">Do not…</label><input id="ga-n-title" class="input" data-ga-nf="title" placeholder="e.g. Do not swim at beaches with jellyfish warnings"></div>' +
          '<div class="field"><label for="ga-n-kind">Type</label><select id="ga-n-kind" class="select" data-ga-nf="kind"><option>Law</option><option>Etiquette</option><option>Safety</option></select></div>' +
          '<div class="field full"><label for="ga-n-text">Why</label><input id="ga-n-text" class="input" data-ga-nf="text" placeholder="One short sentence"></div></div>' +
          '<div class="row-flex wrap" style="margin-top:10px"><button type="button" class="btn btn-primary btn-sm" data-ga="adddont">' + ic('plus') + 'Add point</button><span class="small" style="color:var(--bad)" data-ga-nerr></span></div></div>' : '');
    }
    return out;
  }

  function servicesTabHTML() {
    var ed = canEdit(), from = d.add(D.TODAY, -29);
    return '<div class="note" style="margin-bottom:6px">Switch off anything you cannot supply. Guests only see the requests that are on. Door code help is always available.</div>' + GA.services.map(function (s) {
      var n = D.guestRequests.filter(function (r) { return r.type === s.id && r.at.slice(0, 10) >= from; }).length;
      return '<div class="ga-svc"><span class="ri">' + ic(s.icon) + '</span><div class="rm"><b>' + esc(s.name) + '</b>' + (['sim', 'car', 'tng'].indexOf(s.id) >= 0 ? ' ' + U.pill('Featured', 'accent') : '') + '<div class="rs">' + esc(s.price) + ' · ' + esc(s.desc) + '</div><div class="rs">' + fmt.plural(n, 'request') + ' in the last 30 days</div></div>' +
        (ed ? '<button type="button" class="switch' + (s.on ? ' on' : '') + '" data-ga-svc="' + s.id + '" role="switch" aria-checked="' + s.on + '" aria-label="Offer ' + esc(s.name) + ' to guests"></button>' : U.pill(s.on ? 'On' : 'Off', s.on ? 'ok' : 'neutral')) + '</div>';
    }).join('');
  }

  function adminHTML(b) {
    var openReq = D.guestRequests.filter(function (r) { return r.status === 'new'; }).length;
    var dmgOpen = D.damageReports.filter(function (r) { var t = D.tasks.filter(function (x) { return x.id === r.taskId; })[0]; return t && t.status !== 'done'; }).length;
    var tabs = [['requests', 'Requests', openReq], ['damage', 'Damage reports', dmgOpen], ['rules', 'House rules'], ['videos', 'Videos'], ['guide', 'Local guide'], ['services', 'Request types']];
    var body = st.tab === 'damage' ? damageTabHTML() : st.tab === 'rules' ? rulesTabHTML() : st.tab === 'videos' ? videosTabHTML() : st.tab === 'guide' ? guideTabHTML() : st.tab === 'services' ? servicesTabHTML() : requestsTabHTML();
    return kpisHTML() + guestCardHTML(b) +
      '<div class="card ga-tabs-card"><div class="tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" data-ga-tab="' + t[0] + '" class="' + (st.tab === t[0] ? 'on' : '') + '">' + t[1] + (t[2] ? '<span class="tn">' + t[2] + '</span>' : '') + '</button>'; }).join('') + '</div>' +
      '<div class="card-body">' + (!canEdit() && ['rules', 'videos', 'guide', 'services'].indexOf(st.tab) >= 0 ? '<div class="note" style="margin-bottom:10px">View only: ' + esc(O.viewer().roleLabel) + ' cannot edit guest app content. The account owner can change this in Staff Access.</div>' : '') + body + '</div></div>' +
      '<div class="small muted">Prototype: requests, photos and messages stay in this browser tab; nothing is really sent to guests or to the smart lock.</div>';
  }

  /* =================================================================
     ACTIONS
     ================================================================= */
  function cur() { return D.booking(st.bid); }
  function isFlash(id) { return st.flash === id || (Array.isArray(st.flash) && st.flash.indexOf(id) >= 0); }
  function changed(type, keepScroll) { if (!keepScroll) st.resetScroll = true; O.emit('data', { type: type || 'guestapp' }); }

  function acceptRules() {
    var b = cur(); if (!b) return;
    var name = st.signName.trim() || b.guest.name;
    snap(b);
    b.rulesAccepted = { at: D.NOW, name: name, viaPreview: true };
    var released = false;
    if ((b.idVerified || !GA.requireId) && b.codeStatus === 'held') { b.codeStatus = 'sent'; released = true; }
    if (released) D.lockLog.unshift({ at: D.NOW, propertyId: b.propertyId, bookingId: b.id, by: 'system', what: 'Guest code released to ' + b.guest.name + ' after house rules were accepted', code: null });
    sysMsg(b.id, 'Guest app: house rules accepted by ' + name + (codeVisible(b) ? '. Door code now shown in the app.' : '. Door code waits for the ID check.'));
    st.agree = false; st.signName = ''; st.screen = 'home';
    U.toast(codeVisible(b) ? 'House rules accepted. Door code ' + b.doorCode + ' is now shown to ' + b.guest.name : 'House rules accepted. The door code unlocks after the ID check.');
    changed('rules');
  }
  function resetRules() {
    var b = cur(); if (!b || !orig[b.id]) return;
    var o = orig[b.id]; delete orig[b.id];
    if (o.rulesAccepted) b.rulesAccepted = o.rulesAccepted; else delete b.rulesAccepted;
    b.idVerified = o.idVerified; b.codeStatus = o.codeStatus;
    if (o.idSubmittedAt) b.idSubmittedAt = o.idSubmittedAt; else delete b.idSubmittedAt;
    st.screen = 'home'; st.agree = false; st.signName = '';
    U.toast('Preview restarted: ' + b.guest.name + (b.rulesAccepted ? ' is back to where they started' : ' sees the house rules again'));
    changed('rules');
  }
  function verifyId() {
    var b = cur(); if (!b) return;
    snap(b);
    b.idVerified = true;
    var vis = codeVisible(b);
    if (b.codeStatus === 'held' && b.rulesAccepted) { b.codeStatus = 'sent'; D.lockLog.unshift({ at: D.NOW, propertyId: b.propertyId, bookingId: b.id, by: O.state.viewer, what: 'Guest code released to ' + b.guest.name + ' after ID check', code: null }); }
    sysMsg(b.id, 'ID verified by ' + O.viewer().name + '.' + (vis ? ' Door code now shown in the guest app.' : ' Door code waits for the house rules.'));
    U.toast('ID verified for ' + b.guest.name + (vis ? '. Door code is now shown in their app.' : '. Door code unlocks once they accept the house rules.'));
    changed('id', true);
  }
  function sendRequest() {
    var b = cur(), s = svc(st.reqForm); if (!b || !s) return;
    var vals = st.reqVals, err = '';
    var lim = stayDays(b);
    (s.fields || []).forEach(function (f) {
      if (f.type === 'date' && !vals[f.k]) err = 'Choose a date.';
      else if (f.type === 'date' && (vals[f.k] < lim.min || vals[f.k] > lim.max)) err = 'Choose a date between ' + d.fmt(lim.min) + ' and ' + d.fmt(lim.max) + ', during your stay.';
    });
    if (!err && s.id === 'car' && vals.from && vals.to && vals.to < vals.from) err = 'The return date must be after the pick-up date.';
    if (!err && s.id === 'clean' && vals.date >= b.checkOut) err = 'A mid-stay clean must be before your check-out day.';
    if (!err && s.id === 'late' && D.guestRequests.some(function (r) { return r.bookingId === b.id && r.type === 'late' && r.status !== 'declined'; })) err = 'You have already asked for a late check-out. We will confirm it here.';
    if (err) { var e = O.$('[data-ga-rferr]'); if (e) e.textContent = err; return; }
    var parts = (s.fields || []).map(function (f) {
      var v = vals[f.k]; if (!v) return null;
      if (f.type === 'date') return d.fmt(v);
      if (f.type === 'time') return fmt.time(v);
      if (f.k === 'qty') return v + ' ' + (s.id === 'sim' ? (v === '1' ? 'SIM card' : 'SIM cards') : (v === '1' ? 'card' : 'cards'));
      return ['when', 'where', 'dir', 'slot'].indexOf(f.k) >= 0 ? v.charAt(0).toLowerCase() + v.slice(1) : v;
    }).filter(Boolean);
    if (s.id === 'car' && parts.length >= 3) parts.splice(1, 2, d.fmt(vals.from) + ' to ' + d.fmt(vals.to));
    if (s.id === 'late') parts = ['Check out at ' + String(vals.until || '').replace(' · ', ' on ' + d.fmt(b.checkOut) + ' · ')];
    var id = 'GR-' + (1001 + D.guestRequests.reduce(function (m, r) { return Math.max(m, parseInt(r.id.slice(3), 10) - 1000); }, 0));
    var r = { id: id, bookingId: b.id, type: s.id, summary: parts.join(' · '), vals: Object.assign({}, vals), note: (vals.note || '').trim() || null, status: 'new', at: D.NOW };
    D.guestRequests.unshift(r);
    sysMsg(b.id, 'Guest app request: ' + s.name + ' (' + r.summary + ')');
    st.reqDone = id; st.reqForm = null; st.reqVals = {}; st.flash = id; st.tab = 'requests'; st.reqFilter = 'open';
    U.toast(s.name + ' request from ' + b.guest.name + ' is now in Requests');
    changed('request');
  }
  function codeHelp() {
    var b = cur(); if (!b) return;
    var exists = D.guestRequests.some(function (r) { return r.bookingId === b.id && r.type === 'code' && r.status === 'new'; });
    if (!exists) {
      var id = 'GR-' + (1001 + D.guestRequests.reduce(function (m, r) { return Math.max(m, parseInt(r.id.slice(3), 10) - 1000); }, 0));
      D.guestRequests.unshift({ id: id, bookingId: b.id, type: 'code', summary: 'Guest says code ' + b.doorCode + ' is not opening the door', code: b.doorCode, status: 'new', at: D.NOW });
      sysMsg(b.id, 'Guest app: door code ' + b.doorCode + ' reported as not working.');
      st.flash = id;
    }
    st.tab = 'requests'; st.reqFilter = 'open';
    U.toast('Door code problem sent to the team. Change the code from Requests or the guest card.');
    changed('request', true);
  }
  function setReq(id, status) {
    var r = D.guestRequests.filter(function (x) { return x.id === id; })[0]; if (!r) return;
    var b = D.booking(r.bookingId), s = svc(r.type), extra = '';
    r.status = status; r.by = O.state.viewer;
    if (status === 'confirmed' && r.type === 'clean' && !r.taskId) {
      var cv = r.vals || {}, day = cv.date && cv.date >= D.TODAY ? cv.date : D.TODAY, hr = /Morning/.test(cv.slot || r.summary) ? '09:00' : '13:00';
      var p = D.propById[b.propertyId], t = { id: nextTaskId(), title: 'Mid-stay clean', type: 'Turnover', propertyId: b.propertyId, assigneeId: p.housekeeper, due: day + 'T' + hr, priority: 'low', status: 'todo', checklist: [0, 8], note: 'Requested in the guest app (' + r.id + '): ' + r.summary };
      D.tasks.push(t); r.taskId = t.id; extra = ' Task ' + t.id + ' assigned to ' + D.staffById(p.housekeeper).name + '.';
    }
    if (status === 'confirmed' && r.type === 'late') { var late = /2:00/.test(r.summary) ? '14:00' : '12:00'; b.checkOutTime = late; extra = ' Check-out moved to ' + fmt.time(late) + '.'; }
    var verb = status === 'confirmed' ? 'confirmed' : status === 'delivered' ? (r.type === 'code' ? 'marked solved' : 'marked done') : 'declined';
    sysMsg(b.id, s.name + ' request ' + verb + ' by ' + O.viewer().name + '.');
    U.toast(s.name + ' for ' + b.guest.name + ' ' + verb + '. Guest notified in the app.' + extra);
    changed('request', true);
  }
  function addPhotos(files) {
    var list = Array.prototype.slice.call(files || []).slice(0, 6);
    if (!list.length) return;
    Promise.all(list.map(readPhoto)).then(function (res) {
      var f = st.dmg || (st.dmg = newDmg());
      var ok = res.filter(Boolean), bad = res.length - ok.length;
      ok.forEach(function (ph) { if (f.photos.length < 6) f.photos.push(ph); });
      st.dmgErr = bad ? 'One photo could not be read. Try a JPG or PNG.' : '';
      refresh(true);
    });
  }
  function validItem(f) {
    if (!f.photos.length) return 'Add at least one photo of this item.';
    if (!f.item.trim()) return 'Name the damaged item.';
    if (f.desc.trim().length < 3) return 'Say what is wrong with it.';
    return '';
  }
  function dmgAdd() {
    var f = st.dmg, err = validItem(f);
    if (err) { st.dmgErr = err; refresh(true); return; }
    st.dmgItems.push(f); st.dmg = newDmg(f.when); st.dmgErr = '';
    refresh(false);
  }
  function dmgSend() {
    var b = cur(); if (!b) return;
    var f = st.dmg, items = st.dmgItems.slice();
    var started = f.photos.length || f.item.trim() || f.desc.trim();
    if (started || !items.length) { var err = validItem(f); if (err) { st.dmgErr = err; refresh(true); return; } items.push(f); }
    var p = D.propById[b.propertyId], photos = 0, taskIds = [], newIds = [];
    items.forEach(function (it) {
      var n = D.damageReports.reduce(function (m, r) { return Math.max(m, parseInt(r.id.slice(3), 10)); }, 200) + 1;
      var urgent = it.when === 'stay' && it.urgent;
      var t = { id: nextTaskId(), title: (it.when === 'arrival' ? 'Check pre-existing damage: ' : 'Repair: ') + it.item.trim().toLowerCase(), type: 'Maintenance', propertyId: b.propertyId, assigneeId: 's6', due: urgent ? D.TODAY + 'T13:00' : (it.when === 'arrival' ? (b.checkOut + 'T12:00') : d.add(D.TODAY, 1) + 'T12:00'), priority: urgent ? 'high' : it.when === 'arrival' ? 'low' : 'medium', status: 'todo', photos: it.photos.length, note: 'Damage report DR-' + n + ' from the guest app (' + b.guest.name + ', ' + it.room + '): ' + (it.desc.trim() || it.item.trim()) + (it.when === 'arrival' ? ' Already damaged on arrival, do not charge the guest.' : '') };
      t.photoUrls = it.photos.map(function (ph) { return ph.url; });
      D.tasks.push(t); taskIds.push(t.id);
      D.damageReports.unshift({ id: 'DR-' + n, bookingId: b.id, propertyId: b.propertyId, guest: b.guest.name, room: it.room, item: it.item.trim(), desc: it.desc.trim(), when: it.when, urgent: urgent, photos: it.photos, at: D.NOW, taskId: t.id });
      photos += it.photos.length; newIds.push('DR-' + n);
    });
    st.flash = newIds;
    sysMsg(b.id, 'Guest app: damage report with ' + fmt.plural(photos, 'photo') + '. Maintenance ' + (taskIds.length === 1 ? 'task ' : 'tasks ') + taskIds.join(', ') + ' created for Raju Kumar.');
    st.dmgSent = { items: items.length, photos: photos, when: items[0].when }; st.dmgItems = []; st.dmg = newDmg(); st.dmgErr = ''; st.tab = 'damage'; st.dmgFilter = 'all';
    U.toast('Damage report sent: ' + fmt.plural(items.length, 'maintenance task') + ' created at ' + p.short + ' with ' + fmt.plural(photos, 'photo'));
    changed('damage');
  }
  function photoModal(rid, idx) {
    var r = D.damageReports.filter(function (x) { return x.id === rid; })[0]; if (!r) return;
    U.modal({ title: r.item, sub: r.room + ' · ' + r.guest + ' · ' + fmt.dateTime(r.at), size: r.photos.length > 1 ? 'wide' : '',
      body: '<div class="ga-photo-modal"><div class="ga-pm-grid">' + r.photos.map(function (ph, i) { return '<img src="' + esc(ph.url) + '" alt="Photo ' + (i + 1) + ' of ' + esc(r.item) + '">'; }).join('') + '</div>' + (r.desc ? '<p class="small" style="margin:10px 0 0">' + esc(r.desc) + '</p>' : '') + '</div>',
      actions: [{ label: 'Close' }, { label: 'Open task', kind: 'primary', onClick: function () { O.go('tasks', { taskId: r.taskId }); } }] });
  }
  function copyText(text, msg) {
    try { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {}); } catch (e) {}
    U.toast(msg);
  }

  /* =================================================================
     RENDER + WIRING
     ================================================================= */
  var rootEl = null, ctxRef = null;
  function refresh(keep) {
    if (!rootEl || !document.body.contains(rootEl)) return;
    if (keep === false) st.resetScroll = true;
    draw();
  }
  function draw() {
    var scr = O.$('#ga-screen', rootEl);
    var top = st.resetScroll ? 0 : (scr ? scr.scrollTop : 0);
    st.resetScroll = false;
    var list = previewList();
    if (!st.bid || !list.some(function (b) { return b.id === st.bid; })) {
      var pick = list.filter(function (b) { return b.checkIn === D.TODAY && !b.rulesAccepted; })[0] || list[0];
      st.bid = pick ? pick.id : null;
    }
    var b = cur();
    if (!b) { rootEl.innerHTML = '<div class="pg-guestapp-empty">' + U.empty('No guests are in-house or arriving in the next three days, so there is nobody to preview the guest app for.') + '</div>'; return; }
    var groups = [['Arriving today', function (x) { return x.checkIn === D.TODAY; }], ['In-house', function (x) { return x.status === 'checked_in'; }], ['Arriving soon', function (x) { return x.checkIn > D.TODAY; }]];
    var opts = groups.map(function (g) {
      var items = list.filter(g[1]); if (!items.length) return '';
      return '<optgroup label="' + g[0] + '">' + items.map(function (x) { return '<option value="' + x.id + '"' + (x.id === b.id ? ' selected' : '') + '>' + esc(x.guest.name) + ' · ' + esc(D.propById[x.propertyId].short) + (x.checkIn > D.TODAY ? ' · ' + d.fmt(x.checkIn) : x.sameDay && x.checkIn === D.TODAY ? ' · booked today' : '') + (x.status === 'pending' ? ' · pending' : '') + '</option>'; }).join('') + '</optgroup>';
    }).join('');
    var vis = codeVisible(b);
    rootEl.innerHTML = '<div class="pg-guestapp"><div class="ga-layout">' +
      '<div class="ga-left"><div class="ga-pick"><label class="label" for="ga-bk">Preview the app as</label><div class="row-flex"><select id="ga-bk" class="select" data-ga-bk-select>' + opts + '</select>' + (canCode() ? '<button type="button" class="btn btn-ghost btn-sm" data-ga="lock" aria-label="Change this guest\'s door code" title="Change door code">' + ic('key') + '</button>' : '') + '</div></div>' +
      phoneHTML(b) +
      '<div class="ga-under"><span>' + (b.rulesAccepted ? (vis ? U.pill('Door code visible', 'ok') : U.pill('Waiting for ID', 'warn')) : U.pill('Rules not accepted', 'warn')) + ' Tap through the app as the guest</span>' + (changedInPreview(b) ? '<button type="button" class="ga-link small" data-ga="resetrules">Restart preview</button>' : '') + '</div></div>' +
      '<div class="ga-right">' + adminHTML(b) + '</div></div></div>';
    var s2 = O.$('#ga-screen', rootEl); if (s2) s2.scrollTop = top;
    wire(O.$('.pg-guestapp', rootEl));
  }

  function wire(el) {
    if (!el) return;
    el.addEventListener('click', function (e) {
      var t = e.target.closest('button, a'); if (!t || !el.contains(t)) return;
      var ds = t.dataset, b = cur();
      if (t.disabled) return;
      if (ds.gp) {
        var parts = ds.gp.split(':'); st.screen = parts[0];
        if (parts[0] === 'explore' && parts[1]) st.exploreTab = parts[1];
        if (parts[0] === 'requests') { st.reqDone = null; }
        if (parts[0] === 'damage') { st.dmgSent = null; }
        refresh(false); return;
      }
      if (ds.ga) {
        var a = ds.ga;
        if (a === 'accept') return acceptRules();
        if (a === 'resetrules') return resetRules();
        if (a === 'verify') return verifyId();
        if (a === 'lock') return O.lock.change({ bookingId: b.id });
        if (a === 'openbk') return O.booking.open(b.id);
        if (a === 'copywifi') { var p = D.propById[b.propertyId]; return copyText(p.wifi[1], 'Wi-Fi password copied'); }
        if (a === 'copylink') return copyText('https://' + guestLink(b), 'Guest app link copied');
        if (a === 'sendlink') { D.sentLog.unshift({ at: D.NOW, bookingId: b.id, kind: 'guest app link', via: 'WhatsApp', to: b.guest.phone }); sysMsg(b.id, 'Guest app link sent on WhatsApp.'); U.toast('Guest app link sent to ' + b.guest.name + ' on WhatsApp (' + b.guest.phone + ')'); return changed('link', true); }
        if (a === 'arrivaldmg') { st.screen = 'damage'; st.dmgSent = null; st.dmg = newDmg('arrival'); return refresh(false); }
        if (a === 'codehelp') return codeHelp();
        if (a === 'reqcancel') { st.reqForm = null; st.reqVals = {}; return refresh(false); }
        if (a === 'reqsend') return sendRequest();
        if (a === 'reqback') { st.reqDone = null; return refresh(false); }
        if (a === 'dmgadd') return dmgAdd();
        if (a === 'dmgsend') return dmgSend();
        if (a === 'dmgagain') { st.dmgSent = null; return refresh(false); }
        if (a === 'addrule') { GA.rules.push({ id: 'hr' + Date.now().toString(36), title: 'New rule', text: 'Explain the rule in one sentence.' }); U.toast('Rule added. Edit the wording, guests see it straight away.'); refresh(true); var ins = O.$$('[data-ga-rule$=":title"]', rootEl); if (ins.length) { ins[ins.length - 1].focus(); ins[ins.length - 1].select(); } return; }
        if (a === 'addvideo') {
          var vf = {}; O.$$('[data-ga-vf]', el).forEach(function (i) { vf[i.dataset.gaVf] = i.value.trim(); });
          var verr = !vf.vlogger || !vf.title ? 'Enter the vlogger and the video title.' : vf.dur && !/^\d{1,3}:\d{2}$/.test(vf.dur) ? 'Length must look like 12:30.' : '';
          if (verr) { O.$('[data-ga-verr]', el).textContent = verr; return; }
          GA.videos.unshift({ id: 'v' + Date.now().toString(36), vlogger: vf.vlogger, title: vf.title, city: vf.city || 'all', dur: vf.dur || '10:00' });
          st.screen = 'videos'; st.vidCity = 'all';
          U.toast('Video added. It is the first one guests see.'); return refresh(false);
        }
        if (a === 'addtodo') {
          var tf = {}; O.$$('[data-ga-tf]', el).forEach(function (i) { tf[i.dataset.gaTf] = i.value.trim(); });
          if (!tf.name || !tf.tip) { O.$('[data-ga-terr]', el).textContent = 'Enter the place and a tip.'; return; }
          var c = st.guideCity || cityOf(D.propById[b.propertyId]); (GA.todo[c] = GA.todo[c] || []).push({ name: tf.name, cat: tf.cat, tip: tf.tip, time: tf.time || '' });
          st.screen = 'explore'; st.exploreTab = 'todo'; st.exploreCity = c;
          U.toast(tf.name + ' added to things to do in ' + CITY[c]); return refresh(false);
        }
        if (a === 'adddont') {
          var nf = {}; O.$$('[data-ga-nf]', el).forEach(function (i) { nf[i.dataset.gaNf] = i.value.trim(); });
          if (!nf.title || !nf.text) { O.$('[data-ga-nerr]', el).textContent = 'Enter the point and why.'; return; }
          GA.dont.push({ id: 'n' + Date.now().toString(36), kind: nf.kind, title: nf.title, text: nf.text });
          st.screen = 'explore'; st.exploreTab = 'dont';
          U.toast('Added to things not to do'); return refresh(false);
        }
        return;
      }
      if (ds.gaVcity) { st.vidCity = ds.gaVcity; return refresh(true); }
      if (ds.gaEx) { st.exploreTab = ds.gaEx; return refresh(true); }
      if (ds.gaEcity) { st.exploreCity = ds.gaEcity; return refresh(true); }
      if (ds.gaGtab) { st.guideTab = ds.gaGtab; st.screen = 'explore'; st.exploreTab = ds.gaGtab; return refresh(true); }
      if (ds.gaGcity) { st.guideCity = ds.gaGcity; if (st.screen === 'explore') { st.exploreTab = 'todo'; st.exploreCity = ds.gaGcity; } return refresh(true); }
      if (ds.gaReq) { st.reqForm = ds.gaReq; st.reqVals = {}; st.reqDone = null; return refresh(false); }
      if (ds.gaWhen) { st.dmg.when = ds.gaWhen; return refresh(true); }
      if (ds.gaRmphoto != null) { st.dmg.photos.splice(+ds.gaRmphoto, 1); return refresh(true); }
      if (ds.gaRmitem != null) { st.dmgItems.splice(+ds.gaRmitem, 1); return refresh(true); }
      if (ds.gaTab) { st.tab = ds.gaTab; return refresh(true); }
      if (ds.gaRfilt) { st.reqFilter = ds.gaRfilt; return refresh(true); }
      if (ds.gaDfilt) { st.dmgFilter = ds.gaDfilt; return refresh(true); }
      if (ds.gaRset) { var rs = ds.gaRset.split(':'); return setReq(rs[0], rs[1]); }
      if (ds.gaRlock) { var rq = D.guestRequests.filter(function (x) { return x.id === ds.gaRlock; })[0]; if (rq) O.lock.change({ bookingId: rq.bookingId }); return; }
      if (ds.gaMsg) return O.go('inbox', { bookingId: ds.gaMsg });
      if (ds.gaBk) return O.booking.open(ds.gaBk);
      if (ds.gaTask) return O.go('tasks', { taskId: ds.gaTask });
      if (ds.gaPic) { var pp = ds.gaPic.split(':'); return photoModal(pp[0], +pp[1]); }
      if (ds.gaOpt) { GA[ds.gaOpt] = !GA[ds.gaOpt]; U.toast(ds.gaOpt === 'requireId' ? (GA.requireId ? 'Door code now also needs a verified ID' : 'Door code shows as soon as the rules are accepted') : (GA.requireName ? 'Guests sign with their full name' : 'Guests only tick agree')); return changed('guestapp-settings', true); }
      if (ds.gaSvc) { var sv = svc(ds.gaSvc); sv.on = !sv.on; if (!sv.on && st.reqForm === sv.id) st.reqForm = null; U.toast(sv.name + (sv.on ? ' is now offered in the guest app' : ' is hidden from guests')); st.screen = 'requests'; st.reqDone = null; return refresh(false); }
      if (ds.gaRmove) { var mv = ds.gaRmove.split(':'), i = GA.rules.findIndex(function (r) { return r.id === mv[0]; }), j = i + (+mv[1]); if (i < 0 || j < 0 || j >= GA.rules.length) return; var tmp = GA.rules[i]; GA.rules[i] = GA.rules[j]; GA.rules[j] = tmp; return refresh(true); }
      if (ds.gaRdel) { var rr = GA.rules.filter(function (r) { return r.id === ds.gaRdel; })[0]; GA.rules = GA.rules.filter(function (r) { return r.id !== ds.gaRdel; }); U.toast('Rule removed: ' + (rr ? rr.title : '')); return refresh(true); }
      if (ds.gaVdel) { GA.videos = GA.videos.filter(function (v) { return v.id !== ds.gaVdel; }); U.toast('Video removed from the guest app'); return refresh(true); }
      if (ds.gaTdel) { var td = ds.gaTdel.split(':'); var rmv = GA.todo[td[0]].splice(+td[1], 1)[0]; U.toast((rmv ? rmv.name : 'Place') + ' removed'); return refresh(true); }
      if (ds.gaNdel) { GA.dont = GA.dont.filter(function (n) { return n.id !== ds.gaNdel; }); U.toast('Removed from things not to do'); return refresh(true); }
    });
    el.addEventListener('input', function (e) {
      var t = e.target, ds = t.dataset;
      if (ds.gaSign != null) { st.signName = t.value; syncAccept(); }
      if (ds.gaRf) st.reqVals[ds.gaRf] = t.value;
      if (ds.gaDm && ds.gaDm !== 'urgent' && ds.gaDm !== 'room') { st.dmg[ds.gaDm] = t.value; }
      if (ds.gaRule) { var k = ds.gaRule.split(':'), r = GA.rules.filter(function (x) { return x.id === k[0]; })[0]; if (r) r[k[1]] = t.value; }
    });
    el.addEventListener('change', function (e) {
      var t = e.target, ds = t.dataset;
      if (ds.gaAgree != null) { st.agree = t.checked; syncAccept(); return; }
      if (ds.gaBkSelect != null) { st.bid = t.value; st.screen = 'home'; st.reqForm = null; st.reqDone = null; st.dmgSent = null; st.dmg = null; st.dmgItems = []; st.dmgErr = ''; st.agree = false; st.signName = ''; st.exploreCity = null; return refresh(false); }
      if (ds.gaRf) st.reqVals[ds.gaRf] = t.value;
      if (ds.gaRf === 'dir' && st.reqForm === 'transfer') { var bb = cur(); st.reqVals.date = /to the airport/.test(t.value) ? bb.checkOut : stayDays(bb).min; st.reqVals.time = /to the airport/.test(t.value) ? '09:00' : '14:00'; return refresh(true); }
      if (ds.gaDm === 'urgent') st.dmg.urgent = t.checked;
      if (ds.gaDm === 'room') st.dmg.room = t.value;
      if (ds.gaRule) refresh(true); /* repaint the phone with the new wording */
      if (ds.gaPhoto != null) { addPhotos(t.files); t.value = ''; }
      if (ds.gaId != null && t.files && t.files.length) { var b = cur(); snap(b); b.idSubmittedAt = D.NOW; sysMsg(b.id, 'Guest app: ID photo uploaded for checking.'); U.toast('ID photo received. Mark it verified in the guest card to release the code.'); t.value = ''; changed('id', true); }
    });
  }
  function syncAccept() {
    var btn = O.$('[data-ga="accept"]', rootEl); if (!btn) return;
    btn.disabled = !(st.agree && (!GA.requireName || st.signName.trim().length >= 3));
  }

  /* a door-code problem reported in the app is closed as soon as anyone changes that guest's code (from any page) */
  O.on('data', function (pl) {
    if (!pl || pl.type !== 'lock') return;
    D.guestRequests.forEach(function (r) {
      var bk = r.type === 'code' && (r.status === 'new' || r.status === 'confirmed') && D.booking(r.bookingId);
      if (bk && r.code && bk.doorCode !== r.code) { r.status = 'delivered'; r.by = O.state.viewer; r.summary = 'Code ' + r.code + ' did not open the door · new code ' + bk.doorCode + ' set'; }
    });
  });

  O.page('guestapp', {
    desc: 'The web app each guest opens from their booking link: house rules, door code, local guide, requests and damage reports',
    noDataRerender: true,
    render: function (root, ctx) {
      rootEl = root; ctxRef = ctx;
      if (ctx.fresh && ctx.params && ctx.params.bookingId) { st.bid = ctx.params.bookingId; st.screen = 'home'; }
      if (ctx.fresh && ctx.params && ctx.params.tab) st.tab = ctx.params.tab;
      if (!canSee()) {
        ctx.setActions('');
        root.innerHTML = '<div class="pg-guestapp"><div class="locked"><div class="lk">🔒</div><b>The guest app is not part of the ' + esc(O.viewer().roleLabel) + ' role</b><div class="small">You are viewing as ' + esc(O.viewer().name) + '. An account owner can give this role access in Staff Access.</div></div></div>';
        return;
      }
      draw();
      ctx.setActions('<button type="button" class="btn btn-ghost btn-sm" data-ga-top="copy">' + ic('copy') + '<span>Copy guest link</span></button>' + (canCode() ? '<button type="button" class="btn btn-primary btn-sm" data-ga-top="lock">' + ic('key') + '<span>Change door code</span></button>' : ''));
      O.$$('[data-ga-top]', ctx.actionsEl).forEach(function (bt) {
        bt.onclick = function () { var b = cur(); if (!b) return O.lock.change({}); if (bt.dataset.gaTop === 'lock') O.lock.change({ bookingId: b.id }); else copyText('https://' + guestLink(b), 'Guest app link for ' + b.guest.name + ' copied'); };
      });
      ctx.on('data', function () {
        if (O.state.page !== 'guestapp' || !canSee()) return;
        draw();
      });
    }
  });
})();
