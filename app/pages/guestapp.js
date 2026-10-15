/* Guest App (v4)
   1. Settings and content of the guest app (D.guestApp, config blob), guest requests and damage reports (demo seeds).
   2. stayInfo(): the stage of a stay and the door-code timing rule. supabase/migrations/0003_guest.sql mirrors it exactly
      (0008_guest_units.sql re-creates guest__stay and guest__payload: unit types, unit number and door code from 30 minutes before check-in).
   3. O.guestApi (local): get(token) / act(token, action, args) over D. In production app/server/auth.js replaces it with
      the database functions guest_get / guest_act, which return the same payload. Contract: docs/notes/v4-guestapp.md.
   4. O.guestMode(root, token, opts): the guest's own app (no sign-in), full screen, phone first. Reads only O.guestApi.
   5. The staff page: guests with "Preview guest app" and "Copy guest link", requests, damage reports, house info,
      local tips and settings. */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function ic(n, c) { return O.icon(n, c); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function nz(v) { return v === undefined ? null : v; }

  /* =================================================================
     1. DATA
     ================================================================= */
  var CITY = { kl: 'Kuala Lumpur', penang: 'Penang', melaka: 'Melaka', cameron: 'Cameron Highlands' };
  var CITY_ORDER = ['kl', 'penang', 'melaka', 'cameron'];
  function cityOf(area) {
    var a = String(area || '');
    if (/Kuala Lumpur|KLCC|Bangsar|Mont Kiara|Bukit Bintang|Selangor|Petaling/i.test(a)) return 'kl';
    if (/Penang|George Town|Gurney|Ferringhi/i.test(a)) return 'penang';
    if (/Melaka|Malacca|Jonker/i.test(a)) return 'melaka';
    if (/Cameron|Tanah Rata|Brinchang/i.test(a)) return 'cameron';
    return null;
  }

  /* defaults: a fresh workspace keeps these (config). The automation below writes them to the workspace once,
     with v: 4, so the database function reads the same values the staff app shows. */
  var DEFAULTS = {
    requireCheckin: true,      /* online check-in must be done before the door code shows */
    requireId: true,           /* and a verified ID */
    requireName: true,         /* guests type their full name to sign the house rules */
    codeLeadHours: 0,          /* no longer used: the code shows 30 minutes before check-in, with the unit number (owner decision 2026-10-15) */
    reviewPrompt: true,        /* ask for feedback after check-out */
    welcome: 'Everything for your stay is here: online check-in, your door code, Wi-Fi, the house guide and a direct line to our team.',
    contact: { phone: '', whatsapp: '', hours: '8 AM to 11 PM' },
    rules: [
      { id: 'hr1', title: 'No smoking or vaping indoors', text: 'This includes the balcony. A RM 300 cleaning fee applies if smoke is detected.' },
      { id: 'hr2', title: 'Quiet hours from 10 PM to 8 AM', text: 'Neighbours live here all year. Keep music and voices low, including in the corridors.' },
      { id: 'hr3', title: 'Only registered guests stay overnight', text: 'Your booking is for {guests}. No parties or events, and visitors leave by 10 PM.' },
      { id: 'hr4', title: 'No durian inside the unit', text: 'The smell stays in the furniture for days. Enjoy it at the stalls outside.' },
      { id: 'hr5', title: 'Shoes off inside, please', text: 'Leave shoes on the rack by the door, as is the custom in Malaysian homes.' },
      { id: 'hr6', title: 'Report damage with photos straight away', text: 'Anything already damaged when you arrive should be reported in this app within 2 hours, so you are not charged for it.' },
      { id: 'hr7', title: 'Check out by {checkout}', text: 'Switch off the air-conditioning and close the windows. Late check-out can be requested in the app.' },
      { id: 'hr8', title: 'No pets', text: 'Assistance animals are welcome. Tell us before you arrive.' }
    ],
    entry: [
      { id: 'en1', text: 'Tell the guard at the lobby the unit you are staying in if you are asked.', propertyIds: [] },
      { id: 'en2', text: 'Go up to your floor and find the unit door with the {lock} keypad.', propertyIds: [] },
      { id: 'en3', text: 'Touch the keypad to wake it, enter your door code, then press the tick key.', propertyIds: [] },
      { id: 'en4', text: 'The door locks by itself when you close it. Use the same code every time during your stay.', propertyIds: [] }
    ],
    guide: [
      { id: 'gd1', title: 'Air-conditioning', text: 'Remotes are in the bedside drawers. 24 to 25 °C is comfortable. Please switch it off when you go out.', propertyIds: [] },
      { id: 'gd2', title: 'Hot water', text: 'Switch on the water heater on the bathroom wall about 10 minutes before your shower. The red light shows it is on.', propertyIds: [] },
      { id: 'gd3', title: 'Rubbish', text: 'Bins are under the kitchen sink. Take full bags to the refuse room next to the lift on your floor.', propertyIds: [] },
      { id: 'gd4', title: 'Kitchen', text: 'Pots, pans, plates and cutlery are in the cupboards. Coffee, tea and drinking water are on the counter.', propertyIds: [] },
      { id: 'gd5', title: 'Laundry', text: 'The washing machine is in the utility area. Detergent pods are in the cupboard above it.', propertyIds: [] },
      { id: 'gd6', title: 'Emergencies', text: 'Police and ambulance 999, fire 994. Then message us here so we can help straight away.', propertyIds: [] }
    ],
    checkout: [
      { id: 'co1', text: 'Check out by {checkout}. Ask for a late check-out in Requests if you need more time.' },
      { id: 'co2', text: 'Switch off the air-conditioning, lights and water heater.' },
      { id: 'co3', text: 'Leave used towels in the bathroom and put the rubbish in the bins.' },
      { id: 'co4', text: 'Close the windows and the balcony door.' },
      { id: 'co5', text: 'Pull the door shut behind you. It locks by itself.' }
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
      { id: 'towels', name: 'Extra towels and linen', icon: 'sparkle', on: true, price: 'Free', desc: 'Fresh towels or bed linen brought to your door.',
        fields: [{ k: 'what', label: 'What do you need', opts: ['2 bath towels', '4 bath towels', 'Fresh bed linen', 'Towels and bed linen'] }, { k: 'when', label: 'Bring it', opts: ['As soon as possible', 'This evening', 'Tomorrow morning'] }] },
      { id: 'late', name: 'Late check-out', icon: 'clock', on: true, price: 'From RM 30', desc: 'Stay longer on your departure day, if the next guest allows it.',
        fields: [{ k: 'until', label: 'Check out at', opts: ['12:00 PM · RM 30', '2:00 PM · RM 60'] }] },
      { id: 'early', name: 'Early check-in', icon: 'clock', on: true, price: 'From RM 20', desc: 'Get in before the normal check-in time when the unit is ready. Your door code then shows earlier too.',
        fields: [{ k: 'time', label: 'Arrive at', opts: ['12:00 PM · RM 30', '1:00 PM · RM 20', '2:00 PM · RM 20'] }] },
      { id: 'transfer', name: 'Airport transfer', icon: 'car', on: true, price: 'From RM 95', desc: 'Private car with a driver who meets you at arrivals with your name.',
        fields: [{ k: 'dir', label: 'Direction', opts: ['Airport to the unit', 'Unit to the airport'] }, { k: 'date', label: 'Date', type: 'date', def: 'in' }, { k: 'time', label: 'Time', type: 'time', def: '14:00' }, { k: 'flight', label: 'Flight number', type: 'text', ph: 'e.g. MH 1142' }] },
      { id: 'clean', name: 'Mid-stay clean', icon: 'sparkle', on: true, price: 'RM 80', desc: 'Fresh towels and linen, bins emptied and a full clean.',
        fields: [{ k: 'date', label: 'Day', type: 'date', def: 'tomorrow' }, { k: 'slot', label: 'Time', opts: ['Morning, 9 AM to 12 PM', 'Afternoon, 1 PM to 5 PM'] }] },
      { id: 'sim', name: 'Tourist SIM card', icon: 'sim', on: true, price: 'From RM 35', desc: 'Prepaid 5G SIM delivered to your unit. Malaysian law requires registration with your passport.',
        fields: [{ k: 'plan', label: 'Plan', opts: ['7 days unlimited data · RM 35', '15 days unlimited data · RM 55', '30 days unlimited data · RM 75'] }, { k: 'qty', label: 'How many SIM cards', opts: ['1', '2', '3', '4'] }, { k: 'when', label: 'Deliver', opts: ['As soon as possible', 'When I arrive', 'Tomorrow morning'] }] },
      { id: 'car', name: 'Car rental', icon: 'car', on: true, price: 'From RM 140 a day', desc: 'Insured car delivered to the building or the airport. An International Driving Permit is needed if your licence is not in English or Malay.',
        fields: [{ k: 'car', label: 'Car', opts: ['Perodua Myvi, 5 seats · RM 140/day', 'Proton X50 SUV, 5 seats · RM 220/day', 'Toyota Innova, 7 seats · RM 280/day'] }, { k: 'from', label: 'Pick-up date', type: 'date', def: 'in' }, { k: 'to', label: 'Return date', type: 'date', def: 'out' }, { k: 'where', label: 'Pick-up', opts: ['Delivered to the building', 'At the airport'] }] },
      { id: 'tng', name: "Touch 'n Go card", icon: 'card', on: true, price: 'RM 10 + top-up', desc: 'For tolls, trains, buses and parking across Malaysia. Delivered with the top-up already loaded.',
        fields: [{ k: 'topup', label: 'Top-up', opts: ['RM 20', 'RM 50', 'RM 100'] }, { k: 'qty', label: 'How many cards', opts: ['1', '2', '3', '4'] }] }
    ]
  };
  var CONTENT_KEYS = ['rules', 'entry', 'guide', 'checkout', 'videos', 'todo', 'dont', 'services'];
  D.guestApp = D.guestApp || clone(DEFAULTS);
  /* read view: the saved settings with the defaults under them (never mutated) */
  function cfg() {
    var g = isObj(D.guestApp) ? D.guestApp : {}, out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = g[k] !== undefined ? g[k] : DEFAULTS[k]; });
    return out;
  }
  /* before an edit: make sure the saved settings hold their own copy of key k */
  function own(k) {
    if (!isObj(D.guestApp)) D.guestApp = clone(DEFAULTS);
    if (D.guestApp[k] === undefined) D.guestApp[k] = clone(DEFAULTS[k]);
    return D.guestApp[k];
  }
  var SVC_EXTRA = { code: { id: 'code', name: 'Door code help', icon: 'key' } };
  function svcDef(id, services) {
    var list = services || cfg().services || [];
    return list.filter(function (s) { return s.id === id; })[0] || SVC_EXTRA[id] || DEFAULTS.services.filter(function (s) { return s.id === id; })[0] || { id: id, name: id, icon: 'more' };
  }

  /* fill in v4 settings once per workspace (saved, so the database sees the same settings the staff app shows) */
  O.automation.register('guestAppSettings', function () {
    if (!isObj(D.guestApp)) return;
    var g = D.guestApp;
    if (g.v === 4) return;
    Object.keys(DEFAULTS).forEach(function (k) { if (g[k] === undefined) g[k] = clone(DEFAULTS[k]); });
    if (Array.isArray(g.services)) DEFAULTS.services.forEach(function (s) { if (!g.services.some(function (x) { return x.id === s.id; })) g.services.push(clone(s)); });
    g.v = 4;
  });

  /* demo: online check-in already done for guests whose code went out, and for some guests arriving in the next days */
  (function seedCheckins() {
    var T0 = D.STORY0, N0 = D.STORY0 + 'T10:15';
    D.bookings.forEach(function (b) {
      if (b.status === 'cancelled' || b.guestCheckin || b.rulesAccepted) return;
      var sent = b.codeStatus === 'sent' && b.checkOut >= T0;
      var soon = b.idVerified && b.checkIn > T0 && b.checkIn <= d.add(T0, 3) && D.hash(b.id + 'ci') % 2 === 0;
      if (!sent && !soon) return;
      var at = d.add(b.checkIn, -1) + 'T' + ['18:', '20:', '21:', '19:'][D.hash(b.id) % 4] + String(10 + D.hash(b.id + 'm') % 50);
      if (at > N0) at = T0 + 'T08:' + String(10 + D.hash(b.id) % 40);
      var name = b.guest.name.replace(/^The /, '');
      b.guestCheckin = { at: at, names: [name], arrivalTime: b.checkInTime, consent: true, signedName: name };
      b.rulesAccepted = { at: at, name: name };
    });
  })();

  D.guestRequests = D.guestRequests || [
    { id: 'GR-1046', bookingId: 'BK-4109', type: 'towels', summary: '4 bath towels · as soon as possible', vals: { what: '4 bath towels', when: 'As soon as possible' }, note: null, status: 'new', at: '2026-10-06T09:40' },
    { id: 'GR-1045', bookingId: 'BK-4105', type: 'car', summary: 'Proton X50 SUV, 5 seats · RM 220/day · 3 days · delivered to the building', vals: { car: 'Proton X50 SUV, 5 seats · RM 220/day', from: '2026-10-07', to: '2026-10-10', where: 'Delivered to the building' }, status: 'new', at: '2026-10-06T07:55' },
    { id: 'GR-1044', bookingId: 'BK-4110', type: 'sim', summary: '7 days unlimited data · RM 35 · 2 SIM cards · as soon as possible', status: 'new', at: '2026-10-06T08:40' },
    { id: 'GR-1043', bookingId: 'BK-4108', type: 'clean', summary: 'Afternoon, 1 PM to 5 PM', vals: { date: '2026-10-06', slot: 'Afternoon, 1 PM to 5 PM' }, status: 'confirmed', at: '2026-10-05T20:02', by: 's2', taskId: 'T-309' },
    { id: 'GR-1042', bookingId: 'BK-4108', type: 'car', summary: 'Toyota Innova, 7 seats · RM 280/day · 2 days · delivered to the building', vals: { car: 'Toyota Innova, 7 seats · RM 280/day', from: '2026-10-07', to: '2026-10-09', where: 'Delivered to the building' }, status: 'confirmed', at: '2026-10-05T19:20', by: 's2' },
    { id: 'GR-1041', bookingId: 'BK-4111', type: 'tng', summary: 'RM 50 · 1 card', status: 'delivered', at: '2026-10-04T16:05', by: 's4' },
    { id: 'GR-1040', bookingId: 'BK-4109', type: 'transfer', summary: 'Airport to the unit · arrival day · 1:30 PM · MH 1142', vals: { dir: 'Airport to the unit', date: '2026-10-04', time: '13:30', flight: 'MH 1142' }, status: 'delivered', at: '2026-10-02T11:12', by: 's4' }
  ];

  /* drawn stand-in "photos" for the demo reports (no external images) */
  function fakePhoto(kind) {
    var svg;
    if (kind === 'sink') svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#C9CED6"/><rect y="70" width="160" height="50" fill="#8E969F"/><ellipse cx="80" cy="66" rx="52" ry="22" fill="#6C747D"/><ellipse cx="80" cy="64" rx="46" ry="17" fill="#A9B1BA"/><ellipse cx="80" cy="66" rx="30" ry="9" fill="#7F8A6E" opacity="0.8"/><circle cx="80" cy="67" r="4" fill="#3B4048"/><rect x="74" y="18" width="12" height="30" rx="4" fill="#B8BEC6"/><rect x="74" y="16" width="34" height="8" rx="4" fill="#B8BEC6"/></svg>';
    else if (kind === 'sink2') svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#7C858F"/><circle cx="80" cy="60" r="34" fill="#9AA3AD"/><circle cx="80" cy="60" r="12" fill="#2E3238"/><path d="M80 48v24M68 60h24" stroke="#5B636C" stroke-width="3"/><ellipse cx="80" cy="62" rx="26" ry="20" fill="#6E7A5C" opacity="0.55"/></svg>';
    else svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#E9ECEF"/><g stroke="#C4CAD1" stroke-width="2"><path d="M0 40h160M0 80h160M40 0v120M80 0v120M120 0v120"/></g><path d="M58 44 70 58 64 66 78 80" stroke="#4A4F57" stroke-width="2.5" fill="none"/><path d="M70 58 84 54" stroke="#4A4F57" stroke-width="1.5" fill="none"/><rect x="0" y="100" width="160" height="20" fill="#D5DADF"/></svg>';
    return O.svgUrl(svg);
  }
  if (!D.damageReports) {
    D.damageReports = [
      { id: 'DR-202', bookingId: 'BK-4109', propertyId: 'hsg', guest: 'Olivia Chen', room: 'Kitchen', item: 'Kitchen sink drain', desc: 'Water drains very slowly and there is a smell from the sink.', when: 'stay', urgent: false, photos: [{ name: 'sink-1.jpg', url: fakePhoto('sink') }, { name: 'sink-2.jpg', url: fakePhoto('sink2') }], at: '2026-10-05T21:40', taskId: 'T-308' },
      { id: 'DR-201', bookingId: 'BK-4111', propertyId: 'bbs', guest: 'Kim Min-jun', room: 'Bathroom', item: 'Cracked tile beside the shower', desc: 'Already cracked when I arrived. Sharp edge at the corner.', when: 'arrival', urgent: false, photos: [{ name: 'tile.jpg', url: fakePhoto('tile') }], at: '2026-10-04T15:32', taskId: 'T-316' }
    ];
    if (!D.tasks.some(function (t) { return t.id === 'T-316'; })) {
      D.tasks.push({ id: 'T-316', title: 'Replace cracked bathroom tile', type: 'Maintenance', propertyId: 'bbs', assigneeId: 's6', due: '2026-10-05T12:00', priority: 'low', status: 'done', doneAt: '2026-10-05T11:20', photos: 1, note: 'Damage report DR-201 from the guest app (Kim Min-jun): already cracked on arrival, guest not charged.' });
    }
    D.damageReports.forEach(function (r) {
      var t = D.tasks.filter(function (x) { return x.id === r.taskId; })[0];
      if (t && !t.photoUrls) { t.photoUrls = r.photos.map(function (ph) { return ph.url; }); t.photos = Math.max(t.photos || 0, r.photos.length); }
    });
  }

  /* =================================================================
     2. STAY STAGE AND DOOR-CODE TIMING (mirrored in 0003_guest.sql: guest__stay)
     ================================================================= */
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  function hhmm(t, dflt) { return TIME_RE.test(t || '') ? t : dflt; }
  function addMinutes(iso, mins) { /* 'YYYY-MM-DDTHH:MM' + minutes */
    var t = (+iso.slice(11, 13)) * 60 + (+iso.slice(14, 16)) + mins, days = Math.floor(t / 1440);
    t -= days * 1440;
    return d.add(iso.slice(0, 10), days) + 'T' + pad(Math.floor(t / 60)) + ':' + pad(t % 60);
  }
  function minutesBetween(a, b) { return Math.round((Date.parse(b + ':00Z') - Date.parse(a + ':00Z')) / 6e4); }
  function leadHours(c) { var n = parseInt(c && c.codeLeadHours, 10); return isNaN(n) ? 0 : Math.max(0, Math.min(12, n)); }
  function on(c, k) { return !(c && c[k] === false); } /* settings that default to on */
  var ACTIVE = ['arrival', 'inhouse', 'checkout'];
  /* the guest sees the unit number (typed units) from this many minutes before check-in; the door code shows at the same time */
  var UNIT_REVEAL_MIN = 30;
  /* b: booking, c: guest app settings, now: 'YYYY-MM-DDTHH:MM' Malaysia time, ciFallback: the unit's or building's check-in time */
  function stayInfo(b, c, now, ciFallback) {
    var ciT = hhmm(b.checkInTime, hhmm(ciFallback, '15:00')), coT = hhmm(b.checkOutTime, '11:00');
    var ciAt = b.checkIn + 'T' + ciT, coAt = b.checkOut + 'T' + coT, today = now.slice(0, 10);
    var unitAt = addMinutes(ciAt, -UNIT_REVEAL_MIN);
    /* door code timing (owner decision): from the unit reveal time, for every booking. codeLeadHours is no longer used. */
    var reveal = unitAt;
    var state = today > d.add(b.checkOut, 30) ? 'expired' : b.status === 'cancelled' ? 'cancelled'
      : (now >= coAt || b.status === 'checked_out') ? 'past' : today < b.checkIn ? 'upcoming'
        : today === b.checkIn ? 'arrival' : today < b.checkOut ? 'inhouse' : 'checkout';
    var done = isObj(b.guestCheckin) || isObj(b.rulesAccepted), idOk = b.idVerified === true, waiting = [];
    if (state === 'upcoming' || ACTIVE.indexOf(state) >= 0) {
      if (b.status === 'pending') waiting.push('confirmation');
      if (on(c, 'requireCheckin') && !done) waiting.push('checkin');
      if (on(c, 'requireId') && !idOk) waiting.push('id');
      if (now < reveal) waiting.push('time');
      if (b.codeStatus === 'cancelled' || b.codeStatus === 'expired' || !b.doorCode) waiting.push('host');
    } else waiting.push('ended');
    return { state: state, ciTime: ciT, coTime: coT, ciAt: ciAt, coAt: coAt, revealAt: reveal, unitAt: unitAt, checkinDone: done, idVerified: idOk, waiting: waiting, visible: !waiting.length };
  }

  /* =================================================================
     3. LOCAL O.guestApi (this browser). Same payload and actions as guest_get / guest_act.
     ================================================================= */
  var TOKEN_RE = /^[A-Za-z0-9_.~-]{4,80}$/;
  var LIM = { text: 1000, name: 80, names: 10, summary: 300, note: 300, valKeys: 12, val: 160, room: 40, item: 80, desc: 600, photos: 3, photoChars: 160000, idChars: 240000, idPhotos: 5, requests: 20, reports: 10, perHour: 20, msgTotal: 200, notes: 100 };
  var PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  function clip(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '').slice(0, n); }
  function errRes(code) { return { ok: false, error: code }; }
  var prepared = null;
  /* a guest link opened on its own in this browser: load the saved data the way boot does for the staff app
     (move the demo to the story date, start the local sync) so staff and guest see the same stay */
  function prepareLocal() {
    if (O._started || (O.sync && O.sync.started)) return Promise.resolve();
    if (prepared) return prepared;
    prepared = Promise.resolve().then(function () {
      O.clock.apply();
      if (!D.SHIFT) {
        var story = O.store.get('story', null); if (!story) { story = D.TODAY; O.store.set('story', story); }
        var shift = d.diff(D.STORY0, story);
        if (shift) Object.keys(D).forEach(function (k) { if (['TODAY', 'NOW', 'NOW_TIME', 'STORY0', 'STORY', 'SHIFT', 'DATA_START'].indexOf(k) < 0 && D[k] && typeof D[k] === 'object') O.shiftDates(D[k], shift); });
        D.SHIFT = shift; D.STORY = d.add(D.STORY0, shift); D.DATA_START = d.add('2026-06-01', shift);
      }
      O.clock.apply();
      return O.sync.start();
    }).catch(function (e) { console.warn('guest app: saved data could not be loaded', e); });
    return prepared;
  }
  function nowLocal() { if (!O.clock._t) O.clock.apply(); return D.NOW; }
  function findBooking(token) {
    token = String(token || '');
    if (!TOKEN_RE.test(token)) return null;
    var hits = D.bookings.filter(function (b) { return b.guestToken === token; });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null; /* never guess between two stays */
    return D.booking(token) || null; /* local test copy only: a booking id works too (the database accepts tokens only) */
  }
  function convFor(bid) { return D.conversations.filter(function (c) { return c.bookingId === bid; })[0] || null; }
  function localBrand() {
    var ws = O.ws() || {}, wb = isObj(D.workspaceBrand) ? D.workspaceBrand : {}, br = isObj(wb.brand) ? wb.brand : (ws.brand || {});
    return { name: ws.name || 'Your host', logo: wb.logo || ws.logo || null, primary: br.primary || null, accent: br.accent || null };
  }
  function wifiOf(p) {
    if (!p) return null;
    var w = p.wifi;
    if (Array.isArray(w)) return { name: nz(w[0]), password: nz(w[1]) };
    if (isObj(w)) return { name: nz(w.name), password: nz(w.password != null ? w.password : w.pass) };
    if (p.wifiName || p.wifiPassword) return { name: nz(p.wifiName), password: nz(p.wifiPassword) };
    return null;
  }
  function photoOf(p) { var ph = p && Array.isArray(p.photos) ? p.photos[0] : null; return typeof ph === 'string' ? ph : isObj(ph) ? nz(ph.url) : null; }
  function appFor(c, pid, phone) { /* phone: the workspace phone, used when the guest app has none of its own */
    var forProp = function (x) { return !Array.isArray(x.propertyIds) || !x.propertyIds.length || x.propertyIds.indexOf(pid) >= 0; };
    var str = function (v) { return typeof v === 'string' ? v : ''; };
    return {
      requireCheckin: on(c, 'requireCheckin'), requireId: on(c, 'requireId'), requireName: on(c, 'requireName'), codeLeadHours: leadHours(c), reviewPrompt: on(c, 'reviewPrompt'),
      welcome: typeof c.welcome === 'string' ? c.welcome : null,
      contact: isObj(c.contact) ? { phone: str(c.contact.phone) || str(phone), whatsapp: str(c.contact.whatsapp), hours: str(c.contact.hours) } : null,
      rules: Array.isArray(c.rules) ? c.rules.filter(isObj).map(function (r) { return { id: nz(r.id), title: nz(r.title), text: nz(r.text) }; }) : null,
      entry: Array.isArray(c.entry) ? c.entry.filter(isObj).filter(forProp).map(function (x) { return { id: nz(x.id), text: nz(x.text) }; }) : null,
      guide: Array.isArray(c.guide) ? c.guide.filter(isObj).filter(forProp).map(function (x) { return { id: nz(x.id), title: nz(x.title), text: nz(x.text) }; }) : null,
      checkout: Array.isArray(c.checkout) ? c.checkout.filter(isObj).map(function (x) { return { id: nz(x.id), text: nz(x.text) }; }) : null,
      todo: isObj(c.todo) ? c.todo : null,
      dont: Array.isArray(c.dont) ? c.dont : null,
      videos: Array.isArray(c.videos) ? c.videos : null,
      services: Array.isArray(c.services) ? c.services.filter(function (s) { return isObj(s) && s.on !== false; }).map(function (s) { return { id: nz(s.id), name: nz(s.name), icon: nz(s.icon), price: nz(s.price), desc: nz(s.desc), fields: nz(s.fields) }; }) : null
    };
  }
  function byAtDesc(a, c) { return a.at < c.at ? 1 : a.at > c.at ? -1 : (String(a.id) < String(c.id) ? -1 : 1); }
  function msgOut(m) {
    var type = ['voice', 'image', 'file'].indexOf(m.type) >= 0 ? m.type : 'text';
    return { from: m.from === 'guest' ? 'guest' : 'host', type: type, text: type === 'voice' ? 'Voice message' : type === 'image' ? (m.caption || 'Photo') : String(m.text || ''), time: nz(m.time) };
  }
  function reportStatus(r) {
    var t = r.taskId ? D.tasks.filter(function (x) { return x.id === r.taskId; })[0] : null;
    return t && t.status === 'done' ? 'fixed' : (r.when === 'arrival' || isObj(r.noted)) ? 'logged' : 'open';
  }
  /* the guest's payload: only what this guest may see */
  /* typed units (mirrored in 0008_guest_units.sql): guests see the building + type name and the building's address; the unit
     number (and the Wi-Fi, whose name may carry it) only from s.unitAt (30 minutes before check-in) while the stay is on */
  function guestProperty(b, p, s) {
    var t = (b.unitTypeId && O.unitType(b.unitTypeId)) || O.typeOf(p);
    var on = ACTIVE.indexOf(s.state) >= 0, shown = on && nowLocal() >= s.unitAt;
    if (!t) return p ? { name: nz(p.name), area: p.area || '', address: p.address || '', type: p.type || '', beds: p.beds == null ? null : p.beds, parking: p.parking || '', lockBrand: p.lockBrand || '', photo: photoOf(p), wifi: on ? wifiOf(p) : null } : null;
    var bd = O.building(t.buildingId) || {};
    return {
      name: O.typeTitle(t), area: (p && p.area) || bd.city || '', address: bd.address || '', type: (p && p.type) || '', beds: p && p.beds != null ? p.beds : (t.beds == null ? null : t.beds),
      parking: (p && p.parking) || '', lockBrand: (p && p.lockBrand) || '', photo: photoOf(p), wifi: shown && p ? wifiOf(p) : null,
      unitType: t.name || '', unitNo: shown && p ? nz(p.unitNo) : null, unitAt: s.unitAt
    };
  }
  function ciFallbackOf(b) {
    var p = D.propById[b.propertyId], t = (b.unitTypeId && O.unitType(b.unitTypeId)) || O.typeOf(p), bd = t ? O.building(t.buildingId) : null;
    return (p && hhmm(p.checkInTime, null)) || (bd && hhmm(bd.checkInTime, null)) || null;
  }
  function buildPayload(b) {
    var c = cfg(), now = nowLocal(), s = stayInfo(b, c, now, ciFallbackOf(b)), p = D.propById[b.propertyId] || null, brand = localBrand();
    if (s.state === 'expired') return { ok: false, error: 'expired', brand: brand };
    var conv = convFor(b.id), gc = isObj(b.guestCheckin) ? b.guestCheckin : null, ra = isObj(b.rulesAccepted) ? b.rulesAccepted : null;
    var msgs = conv && Array.isArray(conv.messages) ? conv.messages.filter(function (m) { return isObj(m) && (m.from === 'guest' || m.from === 'staff') && m.idPhoto !== true; }).slice(-100).map(msgOut) : [];
    var reqs = (D.guestRequests || []).filter(function (r) { return r.bookingId === b.id; }).sort(byAtDesc).slice(0, 50);
    var reps = (D.damageReports || []).filter(function (r) { return r.bookingId === b.id; }).sort(byAtDesc).slice(0, 50);
    var fb = isObj(b.guestFeedback) ? b.guestFeedback : null;
    return {
      ok: true, v: 1, now: now, state: s.state, readOnly: !!(O.sync && O.sync.readOnly),
      brand: brand,
      booking: { ref: b.id, guestName: (b.guest && b.guest.name) || 'Guest', guests: +b.guests || 1, nights: +b.nights || d.diff(b.checkIn, b.checkOut), checkIn: b.checkIn, checkOut: b.checkOut, checkInTime: s.ciTime, checkOutTime: s.coTime, channel: b.channel || 'direct', status: b.status || 'confirmed' },
      property: guestProperty(b, p, s),
      checkin: { done: s.checkinDone, at: gc ? nz(gc.at) : ra ? nz(ra.at) : null, names: gc && Array.isArray(gc.names) ? gc.names : [], arrivalTime: gc ? nz(gc.arrivalTime) : null, signedName: gc ? nz(gc.signedName) : ra ? nz(ra.name) : null, idSubmitted: !!b.idSubmittedAt, idVerified: s.idVerified },
      door: { visible: s.visible, code: s.visible ? String(b.doorCode) : null, from: s.revealAt, until: s.coAt, waitingFor: s.waiting, helpOpen: (D.guestRequests || []).some(function (r) { return r.bookingId === b.id && r.type === 'code' && r.status === 'new'; }) },
      app: appFor(c, b.propertyId, (O.ws() || {}).phone),
      messages: msgs,
      requests: reqs.map(function (r) { return { id: r.id, type: nz(r.type), summary: nz(r.summary), note: r.note || null, status: nz(r.status), at: nz(r.at) }; }),
      reports: reps.map(function (r) { return { id: r.id, room: nz(r.room), item: nz(r.item), desc: nz(r.desc), when: nz(r.when), urgent: r.urgent === true, at: nz(r.at), photos: Array.isArray(r.photos) ? r.photos.length : 0, status: reportStatus(r) }; }),
      feedback: fb ? { stars: nz(fb.stars), text: nz(fb.text), at: nz(fb.at) } : null
    };
  }
  /* a line in the booking's chat for the team (created when the stay has no chat yet) */
  function chatFor(b, now) {
    var c = convFor(b.id);
    if (!c) { c = { id: O.uid('C'), bookingId: b.id, unread: 0, messages: [], createdAt: now }; D.conversations.push(c); }
    if (!Array.isArray(c.messages)) c.messages = [];
    return c;
  }
  /* a note for the team in the booking's chat. Notes the guest's own actions create stop at LIM.notes per stay; staff notes always go in. */
  /* ID photos live in the booking's chat (where WhatsApp ID photos also land); only the latest keeps its picture,
     and staff remove it once the ID is checked */
  function stripIdPhotos(c, caption) {
    var n = 0;
    (c && Array.isArray(c.messages) ? c.messages : []).forEach(function (m) { if (isObj(m) && m.idPhoto === true && m.url) { delete m.url; m.caption = caption; n++; } });
    return n;
  }
  function sysNote(b, text, now, staff) {
    var c = chatFor(b, now);
    if (!staff && c.messages.filter(function (m) { return m && m.from === 'system' && /^Guest app/.test(m.text || ''); }).length >= LIM.notes) return;
    c.messages.push({ from: 'system', text: text, time: now });
  }
  function photosPlural(n) { return n + ' photo' + (n === 1 ? '' : 's'); }
  function localAct(b, action, args) {
    args = isObj(args) ? args : {};
    var c = cfg(), now = nowLocal(), s = stayInfo(b, c, now, ciFallbackOf(b)), st = s.state, i;
    if (st === 'expired') return errRes('expired');
    if (O.sync && O.sync.readOnly) return errRes('read_only');
    var during = ['upcoming', 'arrival', 'inhouse', 'checkout'].indexOf(st) >= 0;
    if (action === 'checkin') {
      if (['upcoming', 'arrival', 'inhouse'].indexOf(st) < 0) return errRes('not_now');
      var names = (Array.isArray(args.names) ? args.names : []).slice(0, LIM.names).map(function (n) { return clip(n, LIM.name); }).filter(Boolean);
      var arr = TIME_RE.test(args.arrivalTime || '') ? args.arrivalTime : null, signed = clip(args.signedName, LIM.name);
      if (!names.length || args.consent !== true || (on(c, 'requireName') && signed.length < 3)) return errRes('invalid');
      var who = signed || names[0];
      b.guestCheckin = { at: now, names: names, arrivalTime: arr, consent: true, signedName: who };
      b.rulesAccepted = { at: now, name: who };
      if (b.codeStatus === 'held' && (b.idVerified === true || !on(c, 'requireId'))) b.codeStatus = 'scheduled';
      sysNote(b, 'Guest app: online check-in done by ' + who + (arr ? '. Arriving around ' + fmt.time(arr) : '') + '.', now);
      return { ok: true };
    }
    if (action === 'id') {
      if (!during) return errRes('not_now');
      var idp = args.photo;
      if (!isObj(idp) || typeof idp.url !== 'string' || idp.url.length > LIM.idChars || !PHOTO_RE.test(idp.url)) return errRes('invalid_photo');
      var ichat = chatFor(b, now);
      if (ichat.messages.filter(function (m) { return isObj(m) && m.idPhoto === true; }).length >= LIM.idPhotos) return errRes('too_many');
      stripIdPhotos(ichat, 'Earlier ID photo, replaced');
      ichat.messages.push({ from: 'guest', type: 'image', text: 'ID photo', caption: 'ID photo for check-in', name: clip(idp.name, LIM.name) || 'id-photo.jpg', url: idp.url, time: now, via: 'guestapp', idPhoto: true });
      ichat.unread = (+ichat.unread || 0) + 1;
      b.idSubmittedAt = now;
      return { ok: true };
    }
    if (action === 'message') {
      var text = clip(args.text, LIM.text); if (!text) return errRes('invalid');
      var chat = chatFor(b, now), mine = chat.messages.filter(function (m) { return isObj(m) && m.from === 'guest' && m.via === 'guestapp' && m.idPhoto !== true; }), hourAgo = addMinutes(now, -60);
      if (mine.length >= LIM.msgTotal || mine.filter(function (m) { return (m.time || '') >= hourAgo; }).length >= LIM.perHour) return errRes('too_many');
      chat.messages.push({ from: 'guest', type: 'text', text: text, time: now, via: 'guestapp' });
      chat.unread = (+chat.unread || 0) + 1;
      return { ok: true };
    }
    if (action === 'request') {
      if (!during) return errRes('not_now');
      var svc = (Array.isArray(c.services) ? c.services : []).filter(function (x) { return isObj(x) && typeof x.id === 'string' && x.id === args.type && x.on !== false; })[0];
      if (!svc) return errRes('invalid');
      var mineR = (D.guestRequests || []).filter(function (r) { return r.bookingId === b.id; });
      if (mineR.length >= LIM.requests) return errRes('too_many');
      if (svc.id === 'late' && mineR.some(function (r) { return r.type === 'late' && r.status !== 'declined'; })) return errRes('duplicate');
      var vals = {}, keys = isObj(args.vals) ? Object.keys(args.vals) : [];
      for (i = 0; i < keys.length && Object.keys(vals).length < LIM.valKeys; i++) if (/^[a-z]{1,20}$/.test(keys[i])) vals[keys[i]] = clip(args.vals[keys[i]], LIM.val);
      var r = { id: O.uid('GR'), bookingId: b.id, type: svc.id, summary: clip(args.summary, LIM.summary) || String(svc.name || svc.id), vals: vals, note: clip(args.note, LIM.note) || null, status: 'new', at: now };
      D.guestRequests.unshift(r);
      sysNote(b, 'Guest app request: ' + (svc.name || svc.id) + ' (' + r.summary + ')', now);
      return { ok: true, id: r.id };
    }
    if (action === 'codehelp') {
      if (!s.visible) return errRes('not_now');
      if (D.guestRequests.some(function (x) { return x.bookingId === b.id && x.type === 'code' && x.status === 'new'; })) return { ok: true };
      var code = String(b.doorCode), cr = { id: O.uid('GR'), bookingId: b.id, type: 'code', summary: 'Guest says code ' + code + ' is not opening the door', code: code, status: 'new', at: now };
      D.guestRequests.unshift(cr);
      sysNote(b, 'Guest app: door code ' + code + ' reported as not working.', now);
      return { ok: true, id: cr.id };
    }
    if (action === 'report') {
      if (ACTIVE.indexOf(st) < 0) return errRes('not_now');
      if ((D.damageReports || []).filter(function (x) { return x.bookingId === b.id; }).length >= LIM.reports) return errRes('too_many');
      var item = clip(args.item, LIM.item), desc = clip(args.desc, LIM.desc), when = args.when === 'arrival' ? 'arrival' : 'stay';
      if (!item || desc.length < 3) return errRes('invalid');
      var photos = [], list = Array.isArray(args.photos) ? args.photos : [];
      if (list.length > LIM.photos) return errRes('invalid_photo');
      for (i = 0; i < list.length; i++) {
        var ph = list[i];
        if (!isObj(ph) || typeof ph.url !== 'string' || ph.url.length > LIM.photoChars || !PHOTO_RE.test(ph.url)) return errRes('invalid_photo');
        photos.push({ name: clip(ph.name, LIM.name) || 'photo.jpg', url: ph.url });
      }
      var rep = { id: O.uid('DR'), bookingId: b.id, propertyId: b.propertyId, guest: (b.guest && b.guest.name) || 'Guest', room: clip(args.room, LIM.room) || 'Other', item: item, desc: desc, when: when, urgent: when === 'stay' && args.urgent === true, photos: photos, at: now, taskId: null };
      D.damageReports.unshift(rep);
      sysNote(b, 'Guest app: problem reported, "' + item + '" (' + rep.room + ')' + (rep.urgent ? ', marked urgent' : '') + ', with ' + photosPlural(photos.length) + '.', now);
      return { ok: true, id: rep.id };
    }
    if (action === 'feedback') {
      if (st !== 'checkout' && st !== 'past') return errRes('not_now');
      var stars = args.stars;
      if (typeof stars !== 'number' || stars % 1 !== 0 || stars < 1 || stars > 5) return errRes('invalid');
      var ftext = clip(args.text, LIM.text);
      b.guestFeedback = { stars: stars, text: ftext, at: now };
      sysNote(b, 'Guest app feedback: ' + stars + ' out of 5' + (ftext ? '. "' + ftext + '"' : '.'), now);
      return { ok: true };
    }
    return errRes('unknown_action');
  }
  var localApi = {
    local: true,
    get: function (token) {
      return prepareLocal().then(function () {
        var b = findBooking(token);
        return b ? buildPayload(b) : errRes('not_found');
      });
    },
    act: function (token, action, args) {
      return prepareLocal().then(function () {
        var b = findBooking(token);
        if (!b) return errRes('not_found');
        var res = localAct(b, String(action || ''), args);
        if (res.ok) O.emit('data', { type: 'guestapp-guest', bookingId: b.id });
        return res;
      });
    }
  };
  O.guestApi = localApi;
  O.guestStay = function (b) { return stayInfo(b, cfg(), D.NOW, ciFallbackOf(b)); }; /* for other pages: stage and door-code timing of a booking */

  /* =================================================================
     4. THE GUEST APP: O.guestMode(root, token, opts)
        opts.preview: staff preview (actions are not sent); opts.hideCode / opts.hideWifi: mask for staff without access
     ================================================================= */
  var GERR = {
    not_found: 'This link does not open a stay. Check that you used the whole link from your booking messages.',
    expired: 'This stay has ended, so the link no longer works.',
    read_only: 'You can look but not send anything right now. Please call or message us on WhatsApp if you need help.',
    not_now: 'That is not available at this point of your stay.',
    invalid: 'Please check the form and try again.',
    invalid_photo: 'One of the photos could not be used. Please try another photo.',
    too_many: 'You have sent a lot in a short time. Please wait a little, or call us if it is urgent.',
    duplicate: 'You have already asked for this. We will confirm it here.',
    unknown_action: 'Something went wrong. Please try again.',
    network: 'We could not reach the server. Check your connection and try again.'
  };
  function firstName(n) { n = String(n || 'Guest'); return /^The /.test(n) ? n.replace(/^The /, '').replace(/ Family$/, ' family') : n.split(' ')[0]; }
  function dayLabel(iso) { return d.dowName(iso) + ' ' + d.fmt(iso); }
  function atLabel(iso, now) { /* '3:00 PM today' / '3:00 PM tomorrow' / '3:00 PM on Tue 6 Oct' */
    var day = iso.slice(0, 10), today = now.slice(0, 10), t = fmt.time(iso.slice(11, 16));
    return day === today ? t + ' today' : day === d.add(today, 1) ? t + ' tomorrow' : t + ' on ' + dayLabel(day);
  }
  function inLabel(mins) {
    if (mins <= 0) return 'now';
    if (mins < 60) return 'in ' + mins + ' min';
    if (mins < 24 * 60) { var h = Math.floor(mins / 60), m = mins % 60; return 'in ' + h + ' h' + (m ? ' ' + m + ' min' : ''); }
    var dd = Math.round(mins / 1440); return 'in ' + dd + ' day' + (dd === 1 ? '' : 's');
  }
  function fillVars(text, p) {
    var b = p.booking, pr = p.property || {};
    return String(text == null ? '' : text).replace(/\{guests\}/g, fmt.plural(b.guests, 'guest')).replace(/\{checkout\}/g, fmt.time(b.checkOutTime))
      .replace(/\{checkin\}/g, fmt.time(b.checkInTime)).replace(/\{lock\}/g, pr.lockBrand || 'door').replace(/\{property\}/g, pr.name || 'the unit');
  }
  function roomsFor(beds) {
    var r = ['Living room'];
    if (beds) for (var i = 1; i <= Math.min(+beds || 0, 4); i++) r.push(beds > 1 ? 'Bedroom ' + i : 'Bedroom');
    else r = ['Main room'];
    return r.concat(['Kitchen', 'Bathroom', 'Balcony', 'Entrance', 'Building or lift', 'Other']);
  }
  function digits(s) { return String(s || '').replace(/[^\d+]/g, ''); }
  function mapsLink(pr) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([pr.name, pr.address || pr.area].filter(Boolean).join(', ')); }
  function ytLink(v) { return 'https://www.youtube.com/results?search_query=' + encodeURIComponent((v.vlogger || '') + ' ' + (v.title || '')); }
  function placeLink(name, city) { return 'https://www.google.com/maps/search/' + encodeURIComponent(name + ', ' + (CITY[city] || 'Malaysia')); }
  function brandVars(br) {
    var hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i, P = hex.test((br && br.primary) || '') ? br.primary : '#0B5D54', A = hex.test((br && br.accent) || '') ? br.accent : '#C9A227';
    var t = O.theme.tokens({ primary: P, accent: A, dark: null, sideStyle: 'deep' });
    return Object.keys(t).filter(function (k) { return /^--(brand|accent)/.test(k); }).map(function (k) { return k + ':' + t[k]; }).join(';');
  }
  /* city thumbnails drawn with SVG (fixed illustration colours) */
  function thumbSVG(city) {
    var s = '<svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">';
    if (city === 'kl') s += '<rect width="160" height="90" fill="#3A4E78"/><rect y="60" width="160" height="30" fill="#E58E5A" opacity="0.55"/><g fill="#0E1626"><rect x="10" y="58" width="16" height="32"/><rect x="28" y="50" width="12" height="40"/><rect x="118" y="54" width="14" height="36"/><rect x="134" y="62" width="20" height="28"/><path d="M62 90V30l4-6 4 6v60zM90 90V30l4-6 4 6v60z"/><rect x="65" y="12" width="2" height="12"/><rect x="93" y="12" width="2" height="12"/><rect x="70" y="50" width="20" height="3"/><rect x="104" y="40" width="3" height="50"/><circle cx="105.5" cy="38" r="4"/></g>';
    else if (city === 'penang') s += '<rect width="160" height="90" fill="#F0A85E"/><circle cx="118" cy="34" r="12" fill="#FFF1C9"/><path d="M0 52 40 34 70 46 110 30 160 48V90H0z" fill="#3F6B4A"/><rect y="64" width="160" height="26" fill="#2D5E77"/><g fill="#5B3A29"><rect x="18" y="52" width="26" height="12"/><path d="M15 53 31 44 47 53z"/><rect x="60" y="54" width="22" height="10"/><path d="M57 55 71 47 85 55z"/></g>';
    else if (city === 'melaka') s += '<rect width="160" height="90" fill="#8FC3DF"/><rect y="70" width="160" height="20" fill="#5C8C6B"/><g fill="#A63A2B"><rect x="30" y="40" width="62" height="34"/><path d="M26 42 61 22 96 42z"/><rect x="54" y="14" width="14" height="28"/></g><g fill="#F3E3D3"><rect x="40" y="52" width="8" height="14" rx="4"/><rect x="58" y="52" width="8" height="14" rx="4"/><rect x="76" y="52" width="8" height="14" rx="4"/></g>';
    else if (city === 'cameron') s += '<rect width="160" height="90" fill="#CFE3E6"/><path d="M0 46 34 26 70 40 104 22 160 40V90H0z" fill="#7FAE84"/><path d="M0 60 40 44 86 58 130 42 160 52V90H0z" fill="#4E8A57"/><g stroke="#3B6E44" stroke-width="2" fill="none" opacity="0.8"><path d="M0 70q40-14 80 0t80 0"/><path d="M0 78q40-14 80 0t80 0"/></g>';
    else s += '<rect width="160" height="90" fill="#2F6B7A"/><circle cx="34" cy="30" r="10" fill="#F2D27A"/><g fill="#10263D"><path d="M96 90V40l3-4 3 4v50z"/><circle cx="99" cy="34" r="5"/><rect x="60" y="64" width="18" height="26"/><rect x="112" y="58" width="16" height="32"/><rect x="132" y="68" width="22" height="22"/></g>';
    return s + '</svg>';
  }
  /* photo file -> small JPEG data URL (at most maxChars characters), or null */
  function compressPhoto(file, maxChars) {
    return new Promise(function (res) {
      var fr = new FileReader();
      fr.onload = function () {
        var im = new Image();
        im.onload = function () {
          var out = null, sides = [1280, 1024, 800, 640, 480], qs = [0.75, 0.62, 0.5];
          try {
            for (var i = 0; i < sides.length && !out; i++) {
              var sc = Math.min(1, sides[i] / Math.max(im.width || 1, im.height || 1)), cv = document.createElement('canvas');
              cv.width = Math.max(1, Math.round((im.width || 1) * sc)); cv.height = Math.max(1, Math.round((im.height || 1) * sc));
              var cx = cv.getContext('2d'); cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0, cv.width, cv.height);
              for (var j = 0; j < qs.length && !out; j++) { var u = cv.toDataURL('image/jpeg', qs[j]); if (u.length <= maxChars) out = u; }
            }
          } catch (e) { out = null; }
          res(out ? { name: String(file.name || 'photo').replace(/\.[^.]*$/, '').slice(0, 60) + '.jpg', url: out } : null);
        };
        im.onerror = function () { res(null); };
        im.src = fr.result;
      };
      fr.onerror = function () { res(null); };
      fr.readAsDataURL(file);
    });
  }
  var TABS = { home: ['home', 'Home'], stay: ['key', 'Your stay'], explore: ['map', 'Explore'], requests: ['sparkle', 'Requests'], chat: ['chat', 'Messages'] };

  O.guestMode = function (root, token, opts) {
    opts = opts || {};
    var preview = !!opts.preview, full = !preview;
    var S = { p: null, err: null, tab: 'home', view: null, svc: null, vals: {}, rep: null, ci: null, idPhoto: null, idBusy: false, draft: '', notice: null, busy: false, exTab: 'todo', exCity: null, vCity: 'all', stars: 0, fbText: '', anchor: null, formErr: '' };
    var alive = true, lastJSON = '', poll = null, offData = null, noticeT = null;
    /* the staff preview reads the staff's own data (also right for a booking the server has not saved yet) */
    function api() { return preview ? localApi : (O.guestApi || localApi); }
    function scroller() { return full ? (document.scrollingElement || document.documentElement) : root; }
    function typing() { var a = document.activeElement; return S.busy || !!S.view || !!(a && root.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)); }
    function stop() { alive = false; clearInterval(poll); if (offData) offData(); clearTimeout(noticeT); }
    function load(quiet) {
      return Promise.resolve().then(function () { return api().get(token); }).then(function (p) {
        if (!alive) return;
        var j = JSON.stringify(p);
        if (quiet && (j === lastJSON || typing())) return;
        lastJSON = j; S.p = p; S.err = null; paint(quiet);
      }, function (e) {
        if (!alive) return;
        console.warn('guest app: load failed', e);
        if (quiet && S.p) return;
        S.p = null; S.err = 'network'; paint();
      });
    }
    function flash(text, kind) {
      S.notice = { text: text, kind: kind || 'ok' };
      clearTimeout(noticeT);
      noticeT = setTimeout(function () { S.notice = null; var n = O.$('.gx-notice', root); if (n) n.remove(); }, 6000);
    }
    function paint(keep) {
      if (!alive) return;
      var sc = scroller(), top = sc ? sc.scrollTop : 0;
      root.innerHTML = html();
      if (sc) sc.scrollTop = keep ? top : 0;
      if (S.anchor) {
        var el = O.$('#' + S.anchor, root), top0 = O.$('.gx-top', root);
        if (el && sc) { var off = el.getBoundingClientRect().top - (full ? 0 : root.getBoundingClientRect().top) + sc.scrollTop - (top0 ? top0.offsetHeight : 0) - 10; sc.scrollTop = Math.max(0, off); }
        S.anchor = null;
      }
      if (full && S.p && S.p.brand) {
        document.title = (S.p.ok && S.p.booking ? 'Your stay' : 'Guest app') + ' · ' + (S.p.brand.name || '');
        var m = document.querySelector('meta[name=theme-color]'); if (m && S.p.brand.primary) m.setAttribute('content', S.p.brand.primary);
      }
    }
    function go(tab, anchor) { S.tab = tab; S.view = null; S.anchor = anchor || null; S.formErr = ''; paint(false); }
    function openView(v, svc) {
      S.view = v; S.formErr = '';
      if (v === 'request') { S.svc = svc; S.vals = {}; }
      if (v === 'report') S.rep = { room: '', item: '', desc: '', when: S.p && S.p.state === 'arrival' ? 'arrival' : 'stay', urgent: false, photos: [] };
      if (v === 'checkin') {
        var b = S.p.booking, ci = S.p.checkin || {};
        var names = ci.names && ci.names.length ? ci.names.slice() : [/family$/i.test(b.guestName) ? '' : b.guestName.replace(/^The /, '')];
        while (names.length < Math.min(b.guests, LIM.names)) names.push('');
        S.ci = { names: names, arrival: ci.arrivalTime || b.checkInTime, consent: false, sign: '' }; S.idPhoto = null;
      }
      if (v === 'id') S.idPhoto = null;
      paint(false);
    }
    /* send an action; preview never sends */
    function act(action, args, after) {
      if (S.busy) return;
      if (S.p && S.p.readOnly) { flash(GERR.read_only, 'bad'); paint(true); return; }
      if (preview) { if (after) after(); flash('Preview only: nothing was sent. In ' + firstName(S.p.booking.guestName) + '\'s own app this goes straight to your team.', 'info'); paint(false); return; }
      S.busy = true; S.formErr = ''; paint(true);
      Promise.resolve().then(function () { return api().act(token, action, args); }).then(function (res) {
        S.busy = false;
        if (!res || !res.ok) { S.formErr = GERR[res && res.error] || GERR.invalid; paint(true); return null; }
        if (after) after(res);
        return api().get(token).then(function (p) { lastJSON = JSON.stringify(p); S.p = p; paint(false); });
      }, function (e) { console.warn('guest app: action failed', e); S.busy = false; S.formErr = GERR.network; paint(true); });
    }

    /* ---------- screens ---------- */
    function html() {
      var p = S.p;
      if (!p && !S.err) return '<div class="gx gx-center"><div class="spinner" role="status" aria-label="Loading"></div></div>';
      if (S.err || !p.ok) return errorHTML();
      var tabs = tabsFor(p);
      if (tabs.indexOf(S.tab) < 0) S.tab = 'home';
      var body = S.view === 'checkin' ? checkinHTML(p) : S.view === 'id' ? idHTML(p) : S.view === 'request' ? requestFormHTML(p) : S.view === 'report' ? reportFormHTML(p)
        : S.tab === 'stay' ? stayHTML(p) : S.tab === 'explore' ? exploreHTML(p) : S.tab === 'requests' ? requestsHTML(p) : S.tab === 'chat' ? chatHTML(p) : homeHTML(p);
      return '<div class="gx" style="' + brandVars(p.brand) + '">' + topHTML(p, tabs) +
        '<main class="gx-main">' + (preview ? '<div class="gx-pv-bar">' + ic('eye') + '<span>Preview of what ' + esc(firstName(p.booking.guestName)) + ' sees right now. Buttons here do not send anything.</span></div>' : '') +
        (S.notice ? '<div class="gx-notice ' + S.notice.kind + '" role="status">' + esc(S.notice.text) + '</div>' : '') +
        (p.readOnly ? '<div class="gx-notice info">' + esc(GERR.read_only) + '</div>' : '') +
        body + '</main>' + (S.view ? '' : navHTML(tabs, 'gx-nav-bot')) + '</div>';
    }
    function tabsFor(p) { return p.state === 'past' || p.state === 'cancelled' ? ['home', 'chat'] : ['home', 'stay', 'explore', 'requests', 'chat']; }
    function navHTML(tabs, cls) {
      return '<nav class="gx-nav ' + cls + '" aria-label="Guest app">' + tabs.map(function (t) {
        return '<button type="button" data-gx-tab="' + t + '" class="' + (S.tab === t && !S.view ? 'on' : '') + '"' + (S.tab === t && !S.view ? ' aria-current="page"' : '') + '>' + ic(TABS[t][0]) + '<span>' + TABS[t][1] + '</span></button>';
      }).join('') + '</nav>';
    }
    function logoHTML(br) {
      return br && br.logo ? '<span class="gx-logo"><img src="' + esc(br.logo) + '" alt="' + esc(br.name || '') + ' logo"></span>' : '<span class="gx-logo gx-logo-txt" aria-hidden="true">' + esc(fmt.initials((br && br.name) || 'G')) + '</span>';
    }
    function topHTML(p, tabs) {
      var br = p.brand || {};
      return '<header class="gx-top"><div class="gx-top-in">' + logoHTML(br) + '<div class="gx-top-t"><div class="gx-bn">' + esc(br.name || 'Your host') + '</div><div class="gx-bs">' + esc((p.property && p.property.name) || 'Your stay') + '</div></div>' +
        (S.view ? '<button type="button" class="btn btn-ghost btn-sm gx-back" data-gx-back>' + ic('left') + 'Back</button>' : navHTML(tabs, 'gx-nav-top')) + '</div></header>';
    }
    function errorHTML() {
      var e = S.err || (S.p && S.p.error) || 'not_found', br = (S.p && S.p.brand) || null;
      var t = e === 'expired' ? 'This stay has ended' : e === 'network' ? 'We could not load your stay' : 'This link does not open a stay';
      var s = e === 'expired' ? 'Guest app links stop working 30 days after check-out.' + (br && br.name ? ' Thank you for staying with ' + br.name + '.' : '')
        : e === 'network' ? 'Check your internet connection and try again.' : 'Check that you used the whole link from your booking messages. If it still does not open, contact the company you booked with.';
      return '<div class="gx gx-center" style="' + brandVars(br || {}) + '"><div class="gx-err">' + (br ? logoHTML(br) : '<span class="gx-err-ic">' + ic(e === 'network' ? 'refresh' : 'lock') + '</span>') +
        '<h1>' + esc(t) + '</h1><p>' + esc(s) + '</p>' + (e === 'network' ? '<button type="button" class="btn btn-primary gx-btn" data-gx-act="retry">' + ic('refresh') + 'Try again</button>' : '') + '</div></div>';
    }
    function heroHTML(p) {
      var b = p.booking, pr = p.property || {}, now = p.now, today = now.slice(0, 10), st = p.state, fn = firstName(b.guestName);
      var eyebrow = st === 'upcoming' ? (d.diff(today, b.checkIn) === 1 ? 'Your stay starts tomorrow' : 'Your stay starts in ' + d.diff(today, b.checkIn) + ' days')
        : st === 'arrival' ? 'Arrival day' : st === 'inhouse' ? 'Night ' + (d.diff(b.checkIn, today) + 1) + ' of ' + b.nights : st === 'checkout' ? 'Check-out day' : st === 'past' ? 'Stay completed' : 'Booking cancelled';
      var hi = st === 'past' ? 'Thanks for staying, ' + fn : st === 'arrival' ? 'Welcome, ' + fn : 'Hi ' + fn;
      return '<section class="gx-hero' + (pr.photo ? ' ph' : '') + '">' + (pr.photo ? '<img class="gx-hero-img" src="' + esc(pr.photo) + '" alt="">' : '<svg class="gx-hero-art" viewBox="0 0 400 160" preserveAspectRatio="none" aria-hidden="true"><path d="M0 120 70 82 130 104 210 60 290 96 400 50V160H0z" fill="currentColor" opacity="0.10"/><path d="M0 140 90 112 170 128 260 98 340 120 400 104V160H0z" fill="currentColor" opacity="0.10"/></svg>') +
        '<div class="gx-hero-in"><div class="gx-eyebrow">' + esc(eyebrow) + '</div><h1>' + esc(hi) + '</h1>' +
        '<div class="gx-hero-p">' + esc(pr.name || 'Your stay') + (pr.area ? ' · ' + esc(pr.area) : '') + '</div>' +
        (pr.unitType ? '<div class="gx-unit">' + (pr.unitNo ? '<span>Your unit</span><b>' + esc(pr.unitNo) + '</b>' : '<span>Unit type</span><b>' + esc(pr.unitType) + '</b>' + (st === 'past' || st === 'cancelled' ? '' : '<i>Your unit number appears here at ' + esc(atLabel(pr.unitAt, now)) + '</i>')) + '</div>' : '') +
        '<div class="gx-dates"><div><span>Check-in</span><b>' + esc(dayLabel(b.checkIn)) + '</b><i>from ' + esc(fmt.time(b.checkInTime)) + '</i></div><div class="gx-dates-arrow" aria-hidden="true">' + ic('right') + '</div><div><span>Check-out</span><b>' + esc(dayLabel(b.checkOut)) + '</b><i>by ' + esc(fmt.time(b.checkOutTime)) + '</i></div></div>' +
        '<div class="gx-hero-s">' + fmt.plural(b.nights, 'night') + ' · ' + fmt.plural(b.guests, 'guest') + ' · Booking ' + esc(b.ref) + '</div></div></section>';
    }
    function step(state, label, sub) { return '<li class="gx-ck ' + state + '"><span class="gx-ck-i">' + ic(state === 'ok' ? 'check' : state === 'wait' ? 'clock' : 'lock') + '</span><span><b>' + esc(label) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</span></li>'; }
    function doorHTML(p) {
      var dr = p.door, w = dr.waitingFor || [], b = p.booking, pr = p.property || {}, app = p.app || {}, ci = p.checkin || {};
      if (w.indexOf('ended') >= 0) return '';
      if (dr.visible) {
        var hidden = !!opts.hideCode;
        return '<section class="gx-door on" aria-label="Door code"><div class="gx-door-l">' + ic('key') + 'Your door code</div>' +
          '<div class="gx-code' + (hidden ? ' masked' : '') + '">' + (hidden ? '••••' : esc(dr.code)) + '</div>' +
          (hidden ? '<div class="gx-door-s">Hidden in this preview because your access does not include door codes.</div>' : '') +
          '<div class="gx-door-s">' + esc(pr.lockBrand ? pr.lockBrand + ' smart lock. ' : '') + 'Works until ' + esc(atLabel(dr.until, p.now)) + '. Enter the code, then press the tick key.</div>' +
          (dr.helpOpen ? '<div class="gx-door-help">' + ic('clock') + '<span>We know the code is not working and are on it. We will call you and a new code will show here.</span></div>'
            : '<button type="button" class="gx-link" data-gx-act="codehelp">Code not working?</button>') + '</section>';
      }
      var tm = atLabel(dr.from, p.now), mins = minutesBetween(p.now, dr.from), first = w.filter(function (x) { return x !== 'time'; })[0] || 'time';
      var msg = first === 'confirmation' ? 'Your booking is waiting for confirmation. The code shows here once it is confirmed.'
        : first === 'checkin' ? 'Check in online and your code shows here from ' + tm + '.'
          : first === 'id' ? (ci.idSubmitted ? 'We are checking your ID. Your code shows here from ' + tm + ' once it is approved.' : 'Add a photo of your passport or MyKad and your code shows here from ' + tm + '.')
            : first === 'host' ? 'We are setting up your door code. Message us if you are already at the door.'
              : 'Your door code shows here at ' + tm + (mins < 24 * 60 ? ' (' + inLabel(mins) + ')' : '') + '.';
      var list = '';
      if (w.indexOf('confirmation') >= 0) list += step('wait', 'Booking confirmation', 'Waiting for the host');
      if (app.requireCheckin !== false) list += step(ci.done ? 'ok' : 'todo', 'Online check-in', ci.done ? 'Done' : 'Takes about two minutes');
      if (app.requireId !== false) list += step(ci.idVerified ? 'ok' : ci.idSubmitted ? 'wait' : 'todo', 'ID check', ci.idVerified ? 'Verified' : ci.idSubmitted ? 'Received, being checked' : 'Passport or MyKad photo');
      list += step(w.indexOf('time') >= 0 ? 'wait' : 'ok', 'Code time', 'From ' + tm);
      var cta = w.indexOf('checkin') >= 0 ? '<button type="button" class="btn btn-primary gx-btn" data-gx-view="checkin">' + ic('check') + 'Check in online</button>'
        : w.indexOf('id') >= 0 && !ci.idSubmitted ? '<button type="button" class="btn btn-primary gx-btn" data-gx-view="id">' + ic('camera') + 'Add your ID</button>' : '';
      return '<section class="gx-door off" aria-label="Door code"><div class="gx-door-l">' + ic('lock') + 'Door code</div><div class="gx-code dim" aria-hidden="true">• • • •</div>' +
        '<p class="gx-door-msg">' + esc(msg) + '</p><ul class="gx-cks">' + list + '</ul>' + cta + '</section>';
    }
    function wifiHTML(p, big) {
      var pr = p.property || {}, w = pr.wifi;
      if (!w) return big ? '<section class="gx-card" id="gx-wifi"><h2>' + ic('wifi') + 'Wi-Fi</h2><p class="gx-p">' + (p.state === 'upcoming' ? 'The Wi-Fi name and password show here on your arrival day.' : 'There are no Wi-Fi details for this stay.') + '</p></section>' : '';
      var pw = opts.hideWifi ? '••••••••' : (w.password || '');
      return '<section class="gx-card gx-wifi" id="gx-wifi"><span class="gx-ico">' + ic('wifi') + '</span><div class="gx-grow"><div class="gx-k">Wi-Fi</div><div class="gx-v">' + esc(w.name || '') + '</div><div class="gx-k2">Password <b>' + esc(pw) + '</b></div></div>' +
        (w.password && !opts.hideWifi ? '<button type="button" class="btn btn-ghost btn-sm gx-copy" data-gx-act="copywifi" aria-label="Copy the Wi-Fi password">' + ic('copy') + 'Copy</button>' : '') + '</section>';
    }
    function tilesHTML(p) {
      var t = [['stay', 'gx-in', 'key', 'How to get in'], ['stay', 'gx-rules', 'rules', 'House rules'], ['stay', 'gx-guide', 'file', 'House guide'], ['stay', 'gx-out', 'clock', 'Check-out'],
        ['requests', null, 'sparkle', 'Requests'], ['explore', null, 'map', 'Things to do'], ['chat', null, 'chat', 'Message us']];
      if (ACTIVE.indexOf(p.state) >= 0) t.splice(5, 0, ['report', null, 'alert', 'Report a problem']);
      return '<section class="gx-tiles">' + t.map(function (x) {
        return '<button type="button" class="gx-tile" ' + (x[0] === 'report' ? 'data-gx-view="report"' : 'data-gx-tab="' + x[0] + '"' + (x[1] ? ' data-gx-anchor="' + x[1] + '"' : '')) + '><span class="gx-ico">' + ic(x[2]) + '</span><span>' + x[3] + '</span></button>';
      }).join('') + '</section>';
    }
    function contactHTML(p, title) {
      var c = (p.app && p.app.contact) || {}, br = p.brand || {}, phone = digits(c.phone), wa = digits(c.whatsapp || c.phone).replace(/^\+/, '');
      return '<section class="gx-card"><h2>' + esc(title || 'Need help?') + '</h2><p class="gx-p">' + esc((br.name || 'Our') + ' team' + (c.hours ? ', ' + c.hours : '') + '. Message us here any time.') + '</p>' +
        '<div class="gx-row2"><button type="button" class="btn btn-primary gx-btn" data-gx-tab="chat">' + ic('chat') + 'Message us</button>' +
        (phone ? '<a class="btn btn-ghost gx-btn" href="tel:' + esc(phone) + '">' + ic('phone') + 'Call</a>' : '') +
        (wa ? '<a class="btn btn-ghost gx-btn" href="https://wa.me/' + esc(wa) + '" target="_blank" rel="noopener">' + ic('whatsapp') + 'WhatsApp</a>' : '') + '</div></section>';
    }
    function checkoutCardHTML(p) {
      var b = p.booking, steps = (p.app && p.app.checkout) || DEFAULTS.checkout, late = svcOn(p, 'late') && ['arrival', 'inhouse', 'checkout'].indexOf(p.state) >= 0 && !p.requests.some(function (r) { return r.type === 'late' && r.status !== 'declined'; });
      return '<section class="gx-card" id="gx-out"><h2>' + ic('clock') + 'Check-out</h2><p class="gx-p"><b>By ' + esc(fmt.time(b.checkOutTime)) + ' on ' + esc(dayLabel(b.checkOut)) + '.</b></p>' +
        (steps.length ? '<ol class="gx-ol">' + steps.map(function (s) { return '<li>' + esc(fillVars(s.text, p)) + '</li>'; }).join('') + '</ol>' : '') +
        (late ? '<button type="button" class="btn btn-ghost gx-btn" data-gx-view="request" data-gx-svc="late">' + ic('clock') + 'Ask for a late check-out</button>' : '') + '</section>';
    }
    function feedbackHTML(p) {
      var b = p.booking, fb = p.feedback, app = p.app || {};
      if (app.reviewPrompt === false && !fb) return '';
      var plat = U.platName(b.channel);
      var review = b.channel === 'direct' ? 'If you enjoyed it, tell a friend about us, or book directly with us next time.' : plat + ' will email you a link to leave a review. A few words there help other travellers find us.';
      if (fb) return '<section class="gx-card gx-fb"><h2>Thank you for your feedback</h2><div class="gx-stars" aria-label="' + fb.stars + ' out of 5">' + [1, 2, 3, 4, 5].map(function (i) { return '<span class="' + (i <= fb.stars ? 'on' : '') + '">★</span>'; }).join('') + '</div>' + (fb.text ? '<p class="gx-p">"' + esc(fb.text) + '"</p>' : '') + '<p class="gx-p">' + esc(review) + '</p></section>';
      return '<section class="gx-card gx-fb"><h2>How was your stay?</h2><p class="gx-p">Your answer goes straight to our team.</p><div class="gx-stars big" role="radiogroup" aria-label="Rate your stay">' + [1, 2, 3, 4, 5].map(function (i) {
        return '<button type="button" role="radio" aria-checked="' + (S.stars === i) + '" aria-label="' + i + ' star' + (i > 1 ? 's' : '') + '" data-gx-star="' + i + '" class="' + (i <= S.stars ? 'on' : '') + '">★</button>';
      }).join('') + '</div><label class="gx-lbl" for="gx-fb-t">Anything we should know? (optional)</label><textarea id="gx-fb-t" class="textarea gx-in" data-gx-in="fbText" rows="3" maxlength="' + LIM.text + '">' + esc(S.fbText) + '</textarea>' +
        errLine() + '<button type="button" class="btn btn-primary gx-btn" data-gx-act="feedback"' + (S.stars ? '' : ' disabled') + '>' + ic('send') + 'Send feedback</button>' +
        (app.reviewPrompt !== false ? '<p class="gx-p gx-fine">' + esc(review) + '</p>' : '') + '</section>';
    }
    function errLine() { return S.formErr ? '<div class="gx-formerr" role="alert">' + esc(S.formErr) + '</div>' : ''; }
    function homeHTML(p) {
      var st = p.state, app = p.app || {}, out = heroHTML(p);
      if (st === 'cancelled') return out + '<section class="gx-card"><h2>This booking was cancelled</h2><p class="gx-p">Your door code and stay details are no longer available. If you think this is a mistake, message us and we will help.</p></section>' + contactHTML(p, 'Questions?');
      if (st === 'past') return out + '<div class="gx-cols">' + feedbackHTML(p) + contactHTML(p, 'Left something behind?') + '</div>';
      var main = (st === 'checkout' ? checkoutCardHTML(p) : '') + doorHTML(p) + (st === 'checkout' ? feedbackHTML(p) : '');
      var side = wifiHTML(p) + tilesHTML(p) + (app.welcome ? '<section class="gx-card gx-welcome"><p class="gx-p">' + esc(app.welcome) + '</p></section>' : '') + contactHTML(p);
      return out + '<div class="gx-cols"><div class="gx-col">' + main + '</div><div class="gx-col">' + side + '</div></div>';
    }
    function stayHTML(p) {
      var pr = p.property || {}, app = p.app || {}, ci = p.checkin || {};
      var entry = app.entry || DEFAULTS.entry, rules = app.rules || DEFAULTS.rules, guide = app.guide || DEFAULTS.guide;
      var addr = pr.address || pr.area;
      var getIn = '<section class="gx-card" id="gx-in"><h2>' + ic('key') + 'How to get in</h2>' +
        '<div class="gx-facts"><div><span class="gx-k">Address</span><b>' + esc(pr.name || '') + '</b><span>' + esc(addr || '') + '</span><a class="gx-link" href="' + esc(mapsLink(pr)) + '" target="_blank" rel="noopener">' + ic('pin') + 'Open in Maps</a></div>' +
        '<div><span class="gx-k">Parking</span><b>' + esc(pr.parking || 'Ask us about parking') + '</b></div></div>' +
        (entry.length ? '<ol class="gx-ol">' + entry.map(function (x) { return '<li>' + esc(fillVars(x.text, p)) + '</li>'; }).join('') + '</ol>' : '') + '</section>';
      var rulesH = '<section class="gx-card" id="gx-rules"><h2>' + ic('rules') + 'House rules</h2>' + (ci.done && ci.signedName ? '<div class="gx-okline">' + ic('check') + 'Accepted by ' + esc(ci.signedName) + (ci.at ? ' on ' + esc(d.fmt(ci.at.slice(0, 10))) : '') + '</div>' : '') +
        (rules.length ? '<ol class="gx-rules">' + rules.map(function (r) { return '<li><b>' + esc(fillVars(r.title, p)) + '</b><span>' + esc(fillVars(r.text, p)) + '</span></li>'; }).join('') + '</ol>' : '<p class="gx-p">No house rules have been set for this home.</p>') + '</section>';
      var guideH = '<section class="gx-card" id="gx-guide"><h2>' + ic('file') + 'House guide</h2>' + (guide.length ? guide.map(function (g) {
        return '<details class="gx-acc"><summary>' + esc(g.title || '') + ic('chevron') + '</summary><p>' + esc(fillVars(g.text, p)) + '</p></details>';
      }).join('') : '<p class="gx-p">Nothing here yet. Message us with any question.</p>') + '</section>';
      return '<h1 class="gx-h1">Your stay</h1><div class="gx-cols"><div class="gx-col">' + doorHTML(p) + getIn + wifiHTML(p, true) + '</div><div class="gx-col">' + rulesH + guideH + checkoutCardHTML(p) + '</div></div>';
    }
    function exploreHTML(p) {
      var app = p.app || {}, todo = app.todo || DEFAULTS.todo, dont = app.dont || DEFAULTS.dont, videos = app.videos || DEFAULTS.videos;
      var home = cityOf((p.property || {}).area), city = S.exCity || home || 'kl';
      var out = '<h1 class="gx-h1">Explore</h1><div class="gx-seg" role="tablist">' + [['todo', 'Things to do'], ['dont', 'Good to know'], ['videos', 'Videos']].filter(function (t) { return t[0] !== 'videos' || videos.length; }).map(function (t) {
        return '<button type="button" role="tab" aria-selected="' + (S.exTab === t[0]) + '" data-gx-ex="' + t[0] + '" class="' + (S.exTab === t[0] ? 'on' : '') + '">' + t[1] + '</button>';
      }).join('') + '</div>';
      if (S.exTab === 'dont') {
        return out + '<p class="gx-p">Laws and customs worth knowing. Most locals are very forgiving of visitors, but some laws are strict.</p><div class="gx-list">' + (dont.length ? dont.map(function (n) {
          return '<div class="gx-item gx-dont ' + esc(n.kind || '') + '"><div class="gx-item-h"><b>' + esc(n.title) + '</b>' + U.pill(n.kind || 'Tip', n.kind === 'Law' ? 'bad' : n.kind === 'Safety' ? 'warn' : 'info') + '</div><p>' + esc(n.text) + '</p></div>';
        }).join('') : '<p class="gx-p">Nothing listed yet.</p>') + '</div>';
      }
      var chips = function (attr, cur, withAll) {
        return '<div class="gx-chips">' + (withAll ? [['all', 'All']] : []).concat(CITY_ORDER.map(function (c) { return [c, CITY[c] + (c === home ? ' · you' : '')]; })).map(function (c) {
          return '<button type="button" class="chip' + (cur === c[0] ? ' on' : '') + '" ' + attr + '="' + c[0] + '">' + esc(c[1]) + '</button>';
        }).join('') + '</div>';
      };
      if (S.exTab === 'videos') {
        var vl = videos.filter(function (v) { return S.vCity === 'all' || v.city === S.vCity || v.city === 'all'; });
        return out + chips('data-gx-vcity', S.vCity, true) + '<div class="gx-grid2">' + (vl.length ? vl.map(function (v) {
          return '<a class="gx-vid" href="' + esc(ytLink(v)) + '" target="_blank" rel="noopener"><div class="gx-thumb">' + thumbSVG(v.city) + '<span class="gx-play">' + ic('play') + '</span><span class="gx-dur">' + esc(v.dur || '') + '</span></div><div class="gx-vm"><b>' + esc(v.title) + '</b><span>' + esc(v.vlogger) + ' · YouTube</span></div></a>';
        }).join('') : '<p class="gx-p">No videos for this city yet.</p>') + '</div>';
      }
      var items = todo[city] || [];
      return out + chips('data-gx-ecity', city, false) + '<div class="gx-list">' + (items.length ? items.map(function (t) {
        return '<div class="gx-item"><div class="gx-item-h"><b>' + esc(t.name) + '</b>' + U.pill(t.cat || 'Place', 'brand') + '</div><p>' + esc(t.tip) + '</p><div class="gx-item-m">' + (t.time ? '<span>' + ic('clock') + esc(t.time) + '</span>' : '') + '<a href="' + esc(placeLink(t.name, city)) + '" target="_blank" rel="noopener">' + ic('pin') + 'Map</a></div></div>';
      }).join('') : '<p class="gx-p">No places listed for ' + esc(CITY[city]) + ' yet.</p>') + '</div>';
    }
    function svcOn(p, id) { return ((p.app && p.app.services) || DEFAULTS.services).some(function (s) { return s.id === id && s.on !== false; }); }
    function services(p) { return ((p.app && p.app.services) || DEFAULTS.services).filter(function (s) { return s.on !== false; }); }
    function reqStatus(s) { return s === 'new' ? U.pill('Sent', 'warn') : s === 'confirmed' ? U.pill('Confirmed', 'info') : s === 'delivered' ? U.pill('Done', 'ok') : U.pill('Not possible', 'neutral'); }
    function requestsHTML(p) {
      var st = p.state, open = ['upcoming', 'arrival', 'inhouse', 'checkout'].indexOf(st) >= 0;
      var list = services(p).filter(function (s) { return s.id !== 'early' || st === 'upcoming' || st === 'arrival'; });
      var out = '<h1 class="gx-h1">Requests</h1><p class="gx-p">Order what you need for your stay. We confirm each request here, usually within 30 minutes.</p>';
      if (ACTIVE.indexOf(st) >= 0) out += '<button type="button" class="gx-report" data-gx-view="report"><span class="gx-ico bad">' + ic('alert') + '</span><span class="gx-grow"><b>Report a problem or damage</b><span>Something broken, not working or already damaged when you arrived</span></span>' + ic('right') + '</button>';
      if (open) out += list.length ? '<div class="gx-svcs">' + list.map(function (s) {
        return '<button type="button" class="gx-svc" data-gx-view="request" data-gx-svc="' + esc(s.id) + '"><span class="gx-ico">' + ic(s.icon || 'sparkle') + '</span><b>' + esc(s.name) + '</b><span>' + esc(s.price || '') + '</span></button>';
      }).join('') + '</div>' : '<p class="gx-p">Your host has not switched on any requests.</p>';
      var reqs = p.requests || [], reps = p.reports || [];
      out += '<section class="gx-card"><h2>Your requests</h2>' + (reqs.length ? reqs.map(function (r) {
        var s = svcDef(r.type, (p.app && p.app.services) || DEFAULTS.services);
        return '<div class="gx-req"><span class="gx-ico sm">' + ic(s.icon || 'sparkle') + '</span><div class="gx-grow"><b>' + esc(s.name) + '</b><span>' + esc(r.summary || '') + '</span></div>' + reqStatus(r.status) + '</div>';
      }).join('') : '<p class="gx-p">Nothing requested yet.</p>') + '</section>';
      if (reps.length) out += '<section class="gx-card"><h2>Problems you reported</h2>' + reps.map(function (r) {
        return '<div class="gx-req"><span class="gx-ico sm bad">' + ic('alert') + '</span><div class="gx-grow"><b>' + esc(r.item) + '</b><span>' + esc(r.room) + ' · ' + esc(fmt.dateTime(r.at)) + (r.photos ? ' · ' + photosPlural(r.photos) : '') + '</span></div>' + (r.status === 'fixed' ? U.pill('Fixed', 'ok') : r.status === 'logged' ? U.pill('Logged', 'info') : U.pill('With our team', 'warn')) + '</div>';
      }).join('') + '</section>';
      return out;
    }
    function chatHTML(p) {
      var msgs = p.messages || [], c = (p.app && p.app.contact) || {};
      var thread = msgs.length ? msgs.map(function (m, i) {
        var prev = msgs[i - 1], day = m.time ? m.time.slice(0, 10) : '', showDay = day && (!prev || !prev.time || prev.time.slice(0, 10) !== day);
        return (showDay ? '<div class="gx-day">' + esc(day === p.now.slice(0, 10) ? 'Today' : dayLabel(day)) + '</div>' : '') +
          '<div class="gx-msg ' + (m.from === 'guest' ? 'me' : 'them') + '"><div class="gx-bub">' + (m.type !== 'text' ? '<i>' + esc(m.text) + ' (sent on WhatsApp)</i>' : esc(m.text)) + '</div><div class="gx-mt">' + (m.from === 'guest' ? 'You' : esc((p.brand && p.brand.name) || 'Host')) + (m.time ? ' · ' + esc(fmt.time(m.time)) : '') + '</div></div>';
      }).join('') : '<div class="gx-empty">' + ic('chat') + '<p>Ask us anything about your stay. We usually answer within 15 minutes' + (c.hours ? ' (' + esc(c.hours) + ')' : '') + '.</p></div>';
      return '<h1 class="gx-h1">Messages</h1><section class="gx-card gx-chat"><div class="gx-thread" aria-live="polite">' + thread + '</div>' +
        '<div class="gx-compose"><label class="sr-only" for="gx-draft">Message</label><textarea id="gx-draft" class="textarea gx-in" data-gx-in="draft" rows="2" maxlength="' + LIM.text + '" placeholder="Write a message">' + esc(S.draft) + '</textarea>' +
        '<button type="button" class="btn btn-primary gx-send" data-gx-act="message" aria-label="Send message"' + (S.busy ? ' disabled' : '') + '>' + ic('send') + '</button></div>' + errLine() + '</section>';
    }
    function timeOptions(sel) {
      var out = '', seen = false;
      for (var m = 6 * 60; m <= 23 * 60 + 30; m += 30) { var t = pad(Math.floor(m / 60)) + ':' + pad(m % 60); if (t === sel) seen = true; out += '<option value="' + t + '"' + (t === sel ? ' selected' : '') + '>' + fmt.time(t) + '</option>'; }
      return (sel && !seen ? '<option value="' + esc(sel) + '" selected>' + esc(fmt.time(sel)) + '</option>' : '') + out;
    }
    function idField(p) {
      return '<div class="gx-idbox">' + (S.idPhoto ? '<img class="gx-idimg" src="' + esc(S.idPhoto.url) + '" alt="Your ID photo">' : '') +
        '<label class="btn btn-ghost gx-btn gx-file">' + ic('camera') + (S.idBusy ? 'Reading the photo…' : S.idPhoto ? 'Change photo' : 'Add passport or MyKad photo') + '<input type="file" accept="image/*" data-gx-file="id" aria-label="Passport or MyKad photo"></label>' +
        '<p class="gx-p gx-fine">Malaysian law requires us to register every guest. Only our team sees your ID, and we delete the photo once it is checked.</p></div>';
    }
    function checkinHTML(p) {
      var b = p.booking, app = p.app || {}, ci = S.ci, rules = app.rules || DEFAULTS.rules, needId = app.requireId !== false && !p.checkin.idVerified && !p.checkin.idSubmitted;
      return '<section class="gx-card gx-form"><h1 class="gx-h1">Online check-in</h1><p class="gx-p">It takes about two minutes. Your door code shows on this page from ' + esc(atLabel(p.door.from, p.now)) + ' once you are checked in' + (app.requireId !== false ? ' and your ID is approved' : '') + '.</p>' +
        '<div class="gx-step"><h2>1 · Who is staying</h2>' + ci.names.map(function (n, i) {
          return '<label class="gx-lbl" for="gx-n' + i + '">' + (i === 0 ? 'Lead guest (full name)' : 'Guest ' + (i + 1) + ' (optional)') + '</label><input id="gx-n' + i + '" class="input gx-in" data-gx-name="' + i + '" value="' + esc(n) + '" maxlength="' + LIM.name + '" autocomplete="' + (i === 0 ? 'name' : 'off') + '">';
        }).join('') + '</div>' +
        '<div class="gx-step"><h2>2 · Arrival time</h2><label class="gx-lbl" for="gx-arr">Roughly when will you arrive? Check-in is from ' + esc(fmt.time(b.checkInTime)) + '.</label><select id="gx-arr" class="select gx-in" data-gx-in="arrival">' + timeOptions(ci.arrival) + '</select></div>' +
        (needId ? '<div class="gx-step"><h2>3 · ID</h2>' + idField(p) + '</div>' : '') +
        '<div class="gx-step"><h2>' + (needId ? '4' : '3') + ' · House rules</h2><ol class="gx-rules sm">' + rules.map(function (r) { return '<li><b>' + esc(fillVars(r.title, p)) + '</b><span>' + esc(fillVars(r.text, p)) + '</span></li>'; }).join('') + '</ol>' +
        '<label class="check gx-check"><input type="checkbox" data-gx-in="consent"' + (ci.consent ? ' checked' : '') + '><span>I have read the house rules and agree to them' + (b.guests > 1 ? ' for everyone on this booking' : '') + '.</span></label>' +
        (app.requireName !== false ? '<label class="gx-lbl" for="gx-sign">Type your full name to sign</label><input id="gx-sign" class="input gx-in" data-gx-in="sign" value="' + esc(ci.sign) + '" maxlength="' + LIM.name + '" autocomplete="name">' : '') + '</div>' +
        errLine() + '<button type="button" class="btn btn-primary gx-btn" data-gx-act="checkin"' + (S.busy ? ' disabled' : '') + '>' + ic('check') + (S.busy ? 'Sending…' : 'Complete check-in') + '</button></section>';
    }
    function idHTML(p) {
      return '<section class="gx-card gx-form"><h1 class="gx-h1">Add your ID</h1><p class="gx-p">A clear photo of the lead guest\'s passport or MyKad. We check it and your door code shows from ' + esc(atLabel(p.door.from, p.now)) + '.</p>' + idField(p) +
        errLine() + '<button type="button" class="btn btn-primary gx-btn" data-gx-act="id"' + (S.idPhoto && !S.busy && !S.idBusy ? '' : ' disabled') + '>' + ic('send') + 'Send ID photo</button></section>';
    }
    function stayLimits(p) { var b = p.booking, today = p.now.slice(0, 10); return { min: b.checkIn > today ? b.checkIn : today, max: b.checkOut }; }
    function fieldDefault(f, p) {
      var lim = stayLimits(p), tomorrow = d.add(p.now.slice(0, 10), 1);
      if (f.opts) return f.opts[0];
      if (f.def === 'in') return lim.min;
      if (f.def === 'out') return lim.max;
      if (f.def === 'tomorrow') return tomorrow < lim.max && tomorrow >= lim.min ? tomorrow : lim.min;
      return f.def || '';
    }
    function requestFormHTML(p) {
      var s = svcDef(S.svc, services(p));
      if (!s || !s.fields) { S.view = null; return requestsHTML(p); }
      var lim = stayLimits(p);
      return '<section class="gx-card gx-form"><div class="gx-form-h"><span class="gx-ico">' + ic(s.icon || 'sparkle') + '</span><div><h1 class="gx-h1">' + esc(s.name) + '</h1><span class="gx-k2">' + esc(s.price || '') + '</span></div></div><p class="gx-p">' + esc(s.desc || '') + '</p>' +
        s.fields.map(function (f) {
          var v = S.vals[f.k] != null ? S.vals[f.k] : (S.vals[f.k] = fieldDefault(f, p)), id = 'gx-f-' + f.k;
          if (f.opts) return '<label class="gx-lbl" for="' + id + '">' + esc(f.label) + '</label><select id="' + id + '" class="select gx-in" data-gx-val="' + esc(f.k) + '">' + f.opts.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
          return '<label class="gx-lbl" for="' + id + '">' + esc(f.label) + '</label><input id="' + id + '" class="input gx-in" type="' + (f.type === 'date' || f.type === 'time' ? f.type : 'text') + '" data-gx-val="' + esc(f.k) + '" value="' + esc(v) + '"' + (f.type === 'date' ? ' min="' + lim.min + '" max="' + lim.max + '"' : '') + (f.ph ? ' placeholder="' + esc(f.ph) + '"' : '') + ' maxlength="' + LIM.val + '">';
        }).join('') +
        '<label class="gx-lbl" for="gx-f-note">Anything else? (optional)</label><input id="gx-f-note" class="input gx-in" data-gx-val="note" value="' + esc(S.vals.note || '') + '" maxlength="' + LIM.note + '" placeholder="e.g. child seat, after 6 PM">' +
        errLine() + '<button type="button" class="btn btn-primary gx-btn" data-gx-act="request"' + (S.busy ? ' disabled' : '') + '>' + ic('send') + 'Send request</button></section>';
    }
    function requestSummary(p, s) {
      var v = S.vals, b = p.booking, lim = stayLimits(p), err = '';
      (s.fields || []).forEach(function (f) {
        if (err || f.type !== 'date') return;
        if (!v[f.k]) err = 'Choose a date.';
        else if (v[f.k] < lim.min || v[f.k] > lim.max) err = 'Choose a date between ' + d.fmt(lim.min) + ' and ' + d.fmt(lim.max) + ', during your stay.';
      });
      if (!err && s.id === 'car' && v.from && v.to && v.to < v.from) err = 'The return date must be after the pick-up date.';
      if (!err && s.id === 'clean' && v.date >= b.checkOut) err = 'A mid-stay clean must be before your check-out day.';
      if (!err && s.id === 'transfer' && v.time && !TIME_RE.test(v.time)) err = 'Choose a time.';
      if (err) return { err: err };
      var parts = (s.fields || []).map(function (f) {
        var x = v[f.k]; if (!x) return null;
        if (f.type === 'date') return d.fmt(x);
        if (f.type === 'time') return fmt.time(x);
        if (f.k === 'qty') return x + ' ' + (s.id === 'sim' ? (x === '1' ? 'SIM card' : 'SIM cards') : (x === '1' ? 'card' : 'cards'));
        return ['when', 'where', 'dir', 'slot'].indexOf(f.k) >= 0 ? x.charAt(0).toLowerCase() + x.slice(1) : x;
      }).filter(Boolean);
      if (s.id === 'car' && v.from && v.to) parts = [v.car, d.fmt(v.from) + ' to ' + d.fmt(v.to), String(v.where || '').charAt(0).toLowerCase() + String(v.where || '').slice(1)].filter(Boolean);
      if (s.id === 'late') parts = ['Check out at ' + String(v.until || '').replace(' · ', ' on ' + d.fmt(b.checkOut) + ' · ')];
      if (s.id === 'early') parts = ['Check in at ' + String(v.time || '').replace(' · ', ' on ' + d.fmt(b.checkIn) + ' · ')];
      return { summary: parts.join(' · ') };
    }
    function reportFormHTML(p) {
      var f = S.rep, rooms = roomsFor((p.property || {}).beds);
      if (!f.room) f.room = rooms[0];
      return '<section class="gx-card gx-form"><h1 class="gx-h1">Report a problem</h1><p class="gx-p">Tell us what is broken or not working. A photo helps us fix it faster.</p>' +
        '<div class="gx-seg two" role="radiogroup"><button type="button" role="radio" aria-checked="' + (f.when === 'arrival') + '" data-gx-when="arrival" class="' + (f.when === 'arrival' ? 'on' : '') + '">Already like this when I arrived</button><button type="button" role="radio" aria-checked="' + (f.when === 'stay') + '" data-gx-when="stay" class="' + (f.when === 'stay' ? 'on' : '') + '">Happened during my stay</button></div>' +
        '<label class="gx-lbl" for="gx-r-room">Where</label><select id="gx-r-room" class="select gx-in" data-gx-rep="room">' + rooms.map(function (r) { return '<option' + (r === f.room ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</select>' +
        '<label class="gx-lbl" for="gx-r-item">What is it?</label><input id="gx-r-item" class="input gx-in" data-gx-rep="item" value="' + esc(f.item) + '" maxlength="' + LIM.item + '" placeholder="e.g. Aircon in the bedroom">' +
        '<label class="gx-lbl" for="gx-r-desc">What is wrong?</label><textarea id="gx-r-desc" class="textarea gx-in" data-gx-rep="desc" rows="3" maxlength="' + LIM.desc + '" placeholder="e.g. Blowing warm air since last night">' + esc(f.desc) + '</textarea>' +
        (f.when === 'stay' ? '<label class="check gx-check"><input type="checkbox" data-gx-rep="urgent"' + (f.urgent ? ' checked' : '') + '><span>It is unsafe, or we cannot use something important</span></label>' : '') +
        '<div class="gx-lbl">Photos (optional, up to ' + LIM.photos + ')</div><div class="gx-shots">' + f.photos.map(function (ph, i) {
          return '<div class="gx-shot"><img src="' + esc(ph.url) + '" alt="Photo ' + (i + 1) + '"><button type="button" data-gx-rmphoto="' + i + '" aria-label="Remove photo ' + (i + 1) + '">×</button></div>';
        }).join('') + (f.photos.length < LIM.photos ? '<label class="gx-cam">' + ic('camera') + '<span>' + (f.photos.length ? 'Add another' : 'Add a photo') + '</span><input type="file" accept="image/*" data-gx-file="photo" aria-label="Add a photo of the problem"></label>' : '') + '</div>' +
        errLine() + '<button type="button" class="btn btn-primary gx-btn" data-gx-act="report"' + (S.busy ? ' disabled' : '') + '>' + ic('send') + (S.busy ? 'Sending…' : 'Send report') + '</button></section>';
    }

    /* ---------- events ---------- */
    function onClick(e) {
      var t = e.target.closest('button, a'); if (!t || !root.contains(t) || t.disabled) return;
      var ds = t.dataset;
      if (ds.gxTab) { e.preventDefault(); return go(ds.gxTab, ds.gxAnchor); }
      if (ds.gxView) { e.preventDefault(); return openView(ds.gxView, ds.gxSvc); }
      if (ds.gxBack != null) { S.view = null; S.formErr = ''; return paint(false); }
      if (ds.gxEx) { S.exTab = ds.gxEx; return paint(true); }
      if (ds.gxEcity) { S.exCity = ds.gxEcity; return paint(true); }
      if (ds.gxVcity) { S.vCity = ds.gxVcity; return paint(true); }
      if (ds.gxWhen) { S.rep.when = ds.gxWhen; if (ds.gxWhen === 'arrival') S.rep.urgent = false; return paint(true); }
      if (ds.gxRmphoto != null) { S.rep.photos.splice(+ds.gxRmphoto, 1); return paint(true); }
      if (ds.gxStar) { S.stars = +ds.gxStar; S.formErr = ''; return paint(true); }
      if (!ds.gxAct) return;
      var p = S.p, a = ds.gxAct;
      if (a === 'retry') { S.err = null; paint(); return load(false); }
      if (a === 'copywifi') { try { navigator.clipboard.writeText(p.property.wifi.password).catch(function () {}); } catch (x) {} flash('Wi-Fi password copied'); return paint(true); }
      if (a === 'codehelp') return act('codehelp', {}, function () { flash('Thanks, we are on it. We will call you and a new code will show here.'); });
      if (a === 'message') {
        var text = clip(S.draft, LIM.text); if (!text) { S.formErr = 'Write a message first.'; return paint(true); }
        return act('message', { text: text }, function () { S.draft = ''; });
      }
      if (a === 'checkin') {
        var ci = S.ci, names = ci.names.map(function (n) { return clip(n, LIM.name); }).filter(Boolean), app = p.app || {};
        var needId = app.requireId !== false && !p.checkin.idVerified && !p.checkin.idSubmitted;
        S.formErr = !clip(ci.names[0], LIM.name) ? 'Enter the lead guest\'s full name.' : !ci.consent ? 'Tick the box to accept the house rules.' : app.requireName !== false && clip(ci.sign, LIM.name).length < 3 ? 'Type your full name to sign.' : '';
        if (S.formErr) return paint(true);
        var args = { names: names, arrivalTime: ci.arrival, consent: true, signedName: clip(ci.sign, LIM.name) || names[0] };
        var done = function () { S.view = null; S.tab = 'home'; flash('You are checked in. Thank you!'); };
        if (S.idBusy) return;
        if (needId && S.idPhoto && !preview && !(p && p.readOnly)) {
          S.busy = true; paint(true);
          return Promise.resolve().then(function () { return api().act(token, 'id', { photo: S.idPhoto }); }).then(function (res) {
            S.busy = false;
            if (res && res.ok) { S.idPhoto = null; return act('checkin', args, done); }
            S.formErr = GERR[res && res.error] || GERR.invalid; paint(true);
          }, function (e) { console.warn('guest app: ID upload failed', e); S.busy = false; S.formErr = GERR.network; paint(true); });
        }
        return act('checkin', args, done);
      }
      if (a === 'id') return S.idPhoto && !S.idBusy && act('id', { photo: S.idPhoto }, function () { S.idPhoto = null; S.view = null; S.tab = 'home'; flash('ID photo received. We will check it shortly.'); });
      if (a === 'request') {
        var s = svcDef(S.svc, services(p)), r = requestSummary(p, s);
        if (r.err) { S.formErr = r.err; return paint(true); }
        var vals = {}; Object.keys(S.vals).forEach(function (k) { if (k !== 'note' && S.vals[k] != null && S.vals[k] !== '') vals[k] = String(S.vals[k]); });
        return act('request', { type: s.id, summary: r.summary, vals: vals, note: S.vals.note || '' }, function () { S.view = null; S.tab = 'requests'; flash(s.name + ' requested. We will confirm it here.'); });
      }
      if (a === 'report') {
        var f = S.rep;
        S.formErr = !clip(f.item, LIM.item) ? 'Say what the problem is about, for example "Aircon".' : clip(f.desc, LIM.desc).length < 3 ? 'Describe what is wrong.' : '';
        if (S.formErr) return paint(true);
        return act('report', { room: f.room, item: f.item, desc: f.desc, when: f.when, urgent: f.when === 'stay' && !!f.urgent, photos: f.photos }, function () { S.view = null; S.tab = 'requests'; flash('Thanks, our team has your report' + (f.when === 'arrival' ? '. It is noted as already there when you arrived.' : ' and will get back to you.')); });
      }
      if (a === 'feedback') {
        if (!S.stars) return;
        return act('feedback', { stars: S.stars, text: S.fbText }, function () { S.fbText = ''; flash('Thank you for your feedback!'); });
      }
    }
    function onInput(e) {
      var t = e.target, ds = t.dataset;
      if (ds.gxIn === 'draft') S.draft = t.value;
      else if (ds.gxIn === 'fbText') S.fbText = t.value;
      else if (ds.gxIn === 'arrival' && S.ci) S.ci.arrival = t.value;
      else if (ds.gxIn === 'sign' && S.ci) S.ci.sign = t.value;
      else if (ds.gxName != null && S.ci) S.ci.names[+ds.gxName] = t.value;
      else if (ds.gxVal) S.vals[ds.gxVal] = t.value;
      else if (ds.gxRep && S.rep && ds.gxRep !== 'urgent') S.rep[ds.gxRep] = t.value;
    }
    function onChange(e) {
      var t = e.target, ds = t.dataset;
      onInput(e);
      if (ds.gxIn === 'consent' && S.ci) S.ci.consent = t.checked;
      if (ds.gxRep === 'urgent' && S.rep) S.rep.urgent = t.checked;
      if (ds.gxVal === 'dir' && S.svc === 'transfer' && S.p) { var b = S.p.booking, out = /to the airport/i.test(t.value); S.vals.date = out ? b.checkOut : stayLimits(S.p).min; S.vals.time = out ? '09:00' : '14:00'; paint(true); }
      if (ds.gxFile === 'id' && t.files && t.files[0]) {
        var idf = t.files[0]; t.value = ''; S.idBusy = true; S.formErr = ''; paint(true);
        compressPhoto(idf, LIM.idChars - 1000).then(function (ph) {
          if (!alive) return;
          S.idBusy = false;
          if (!ph) S.formErr = 'That photo could not be read. Try a JPG or PNG photo.'; else S.idPhoto = ph;
          paint(true);
        });
      }
      if (ds.gxFile === 'photo' && t.files && t.files[0] && S.rep) {
        var file = t.files[0]; t.value = '';
        compressPhoto(file, 120000).then(function (ph) {
          if (!alive || !S.rep) return;
          if (!ph) S.formErr = 'That photo could not be read. Try a JPG or PNG photo.'; else if (S.rep.photos.length < LIM.photos) { S.rep.photos.push(ph); S.formErr = ''; }
          paint(true);
        });
      }
    }
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    if (full) document.documentElement.classList.add('guest-mode');
    root.innerHTML = html();
    load(false);
    poll = setInterval(function () {
      if (!document.body.contains(root)) return stop();
      if (!document.hidden) load(true);
    }, 30000);
    offData = O.on('data', function () { if (!document.body.contains(root)) return stop(); setTimeout(function () { if (alive) load(true); }, 250); });
    return { reload: function () { return load(false); }, stop: stop };
  };

  /* =================================================================
     5. STAFF PAGE: guests (preview + link), requests, problems, house info, local tips, settings
     ================================================================= */
  function writable() { return !(O.sync && O.sync.readOnly); }
  function canEdit() { return writable() && O.can('guestapp.edit'); }
  function canReq() { return writable() && O.can('guestapp.requests'); }
  function canCode() { return O.can('guestapp.doorCodes'); }
  function canMsg() { return O.can('inbox.send'); }
  function canVerify() { return writable() && (O.can('guestapp.edit') || O.can('bookings.edit')); }
  function propShort(pid) { var p = D.propById[pid]; return p ? (p.short || p.name) : 'Unknown unit'; }
  function staffName(id) { var s = id && D.staffById(id); return s ? s.name : 'someone'; }
  function to24(s) { var m = String(s || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i); if (!m) return null; return pad(+m[1] % 12 + (/pm/i.test(m[3]) ? 12 : 0)) + ':' + m[2]; }
  function maskCode(s) { return canCode() ? String(s || '') : String(s || '').replace(/\b\d{4,8}\b/g, '••••'); }
  function taskById(id) { return id ? D.tasks.filter(function (t) { return t.id === id; })[0] || null : null; }
  function guestName(b) { return (b && b.guest && b.guest.name) || 'Guest'; }
  function lc(s) { s = String(s || ''); return s.charAt(0).toLowerCase() + s.slice(1); }
  function setCfg(k, v) { if (!isObj(D.guestApp)) D.guestApp = clone(DEFAULTS); D.guestApp[k] = v; }
  function ownList(k) { var l = own(k); if (Array.isArray(l)) l.forEach(function (x) { if (isObj(x) && !x.id) x.id = O.uid(k.slice(0, 2).toUpperCase()); }); return l; }
  function viewOnly(what) {
    if (!writable()) return '<div class="note ga-note">This workspace is view only right now, so nothing here can be changed.</div>';
    return '<div class="note ga-note">View only: your access does not include ' + esc(what) + '. An account owner can change this in Staff Access.</div>';
  }

  var st = { tab: 'guests', reqFilter: 'open', dmgFilter: 'open', info: 'welcome', tips: 'todo', tipsCity: null, hl: null, scrollHl: false };
  var pageRoot = null, quiet = false, dirty = false;
  /* save without repainting this page (the page repaints itself when it needs to) */
  function changed(type) { quiet = true; try { O.emit('data', { type: type || 'guestapp' }); } finally { quiet = false; } }
  function wrapEl() { return pageRoot && O.$('.pg-ga', pageRoot); }
  function typing() { var w = wrapEl(), a = document.activeElement; return !!(w && a && w.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)); }

  /* ---------- guests ---------- */
  function guestRows() {
    var c = cfg(), now = D.NOW, today = D.TODAY, lim = d.add(today, 7);
    return D.bookings.filter(function (b) { return b && b.checkIn && b.checkOut && ((b.status !== 'cancelled' && b.checkOut >= today && b.checkIn <= lim) || b.id === st.hl); })
      .map(function (b) { return { b: b, s: stayInfo(b, c, now, ciFallbackOf(b)) }; })
      .filter(function (x) { return ['upcoming', 'arrival', 'inhouse', 'checkout'].indexOf(x.s.state) >= 0 || x.b.id === st.hl; })
      .sort(function (x, y) { var a = x.b.checkIn + x.s.ciTime, z = y.b.checkIn + y.s.ciTime; return a < z ? -1 : a > z ? 1 : 0; });
  }
  function doorPill(s) {
    if (s.waiting.indexOf('ended') >= 0) return '';
    if (s.visible) return U.pill('Code showing', 'ok');
    var w = s.waiting.filter(function (x) { return x !== 'time'; })[0], soon = s.state !== 'upcoming';
    if (w === 'host') return U.pill('No door code set', 'bad');
    if (w === 'confirmation') return U.pill('Code waits for confirmation', 'neutral');
    if (w === 'checkin') return U.pill('Code waits for check-in', soon ? 'warn' : 'neutral');
    if (w === 'id') return U.pill('Code waits for the ID', soon ? 'warn' : 'neutral');
    return U.pill('Code from ' + atLabel(s.revealAt, D.NOW), 'info');
  }
  function guestRowHTML(x) {
    var b = x.b, s = x.s, c = cfg(), gc = isObj(b.guestCheckin) ? b.guestCheckin : null;
    var who = U.avatar(guestName(b)) + '<span class="ga-who-t"><b>' + esc(guestName(b)) + '</b><span>' + esc(propShort(b.propertyId)) + ' · ' + esc(d.fmtRange(b.checkIn, b.checkOut)) + ' · ' + fmt.plural(+b.guests || 1, 'guest') + (gc && gc.arrivalTime && (s.state === 'upcoming' || s.state === 'arrival') ? ' · arriving around ' + esc(fmt.time(gc.arrivalTime)) : '') + '</span></span>';
    var pills = (b.status === 'cancelled' ? U.pill('Cancelled', 'neutral') : b.status === 'pending' ? U.pill('Pending', 'warn') : '') +
      (s.state === 'checkout' ? U.pill('Leaves today', 'info') : '') +
      (s.checkinDone ? U.pill('Checked in online', 'ok') : U.pill('Not checked in online', s.state === 'upcoming' ? 'neutral' : 'warn')) +
      (b.idVerified === true ? U.pill('ID verified', 'ok') : b.idSubmittedAt ? U.pill('ID to check', 'warn') : on(c, 'requireId') ? U.pill('No ID yet', 'neutral') : '') +
      doorPill(s);
    var acts = (b.idSubmittedAt && b.idVerified !== true && canVerify() ? '<button type="button" class="btn btn-primary btn-sm" data-ga-idcheck="' + esc(b.id) + '">' + ic('user') + 'Check ID</button>' : '') +
      '<button type="button" class="btn btn-ghost btn-sm" data-ga-preview="' + esc(b.id) + '">' + ic('eye') + 'Preview guest app</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-ga-copy="' + esc(b.id) + '"' + (canCode() ? '' : ' disabled title="The link opens the door code, and your access does not include door codes"') + '>' + ic('copy') + 'Copy guest link</button>';
    return '<div class="ga-g' + (b.id === st.hl ? ' ga-hl' : '') + '" data-ga-row="' + esc(b.id) + '">' +
      (O.can('bookings') ? '<button type="button" class="ga-who" data-ga-bk="' + esc(b.id) + '" title="Open booking">' + who + '</button>' : '<div class="ga-who">' + who + '</div>') +
      '<div class="ga-g-st">' + pills + '</div><div class="ga-g-act">' + acts + '</div></div>';
  }
  function guestsTabHTML() {
    var rows = guestRows();
    if (!rows.length) {
      var noProps = !D.properties.length;
      return '<div class="card">' + U.empty(noProps ? 'Add your first property. Each booking then gets its own guest app link for online check-in, the door code and messages.' : 'Nobody is staying or arriving in the next 7 days. Each new booking gets its own guest app link.', ic('guestapp')) +
        '<div class="ga-empty-act">' + (noProps ? (O.can('properties') ? '<button type="button" class="btn btn-primary" data-ga-go="properties">' + ic('plus') + 'Add your first property</button>' : '') : (O.can('bookings') ? '<button type="button" class="btn btn-primary" data-ga-go="bookings">' + ic('bookings') + 'Open bookings</button>' : '')) + '</div></div>';
    }
    var today = rows.filter(function (x) { return x.s.state === 'arrival'; }), done = today.filter(function (x) { return x.s.visible; }).length;
    var groups = [['Arriving today', function (x) { return x.s.state === 'arrival'; }], ['Staying now', function (x) { return x.s.state === 'inhouse' || x.s.state === 'checkout'; }],
      ['Next 7 days', function (x) { return x.s.state === 'upcoming'; }], ['Selected booking', function (x) { return ['upcoming', 'arrival', 'inhouse', 'checkout'].indexOf(x.s.state) < 0; }]];
    return '<p class="ga-lead">Every booking has its own guest app: online check-in, the door code when it is time, Wi-Fi, the house guide, requests and messages.' +
      (today.length ? ' <b>' + done + ' of ' + today.length + '</b> arriving today can see their door code.' : '') + '</p>' +
      groups.map(function (g) {
        var list = rows.filter(g[1]); if (!list.length) return '';
        return '<section class="card ga-grp"><div class="card-head"><h3>' + esc(g[0]) + '</h3><span class="sub">' + fmt.plural(list.length, 'booking') + '</span></div><div class="ga-glist">' + list.map(guestRowHTML).join('') + '</div></section>';
      }).join('');
  }
  function openPreview(b) {
    if (!b.guestToken) { O.bookingDefaults(b); changed('guestapp-token'); }
    var handle = null, p = D.propById[b.propertyId];
    U.modal({
      title: 'Guest app preview', sub: guestName(b) + (p ? ' · ' + (p.short || p.name) : '') + ' · ' + d.fmtRange(b.checkIn, b.checkOut), size: 'ga-pv-modal',
      body: '<div class="ga-pv"><div class="ga-pv-frame" role="region" aria-label="Guest app preview" tabindex="0"></div></div>', autofocus: false,
      onOpen: function (el) {
        handle = O.guestMode(O.$('.ga-pv-frame', el), b.guestToken, { preview: true, hideCode: !canCode(), hideWifi: !(canCode() || O.can('properties.access')) });
      },
      onClose: function () { if (handle) handle.stop(); },
      actions: (canCode() ? [{ label: 'Copy guest link', onClick: function () { copyLink(b); return false; } }] : []).concat([{ label: 'Close', kind: 'primary' }])
    });
  }
  function copyText(text, msg) {
    function fallback() {
      U.modal({ title: 'Copy the guest link', sub: 'Select the link and copy it', size: 'sm', autofocus: false,
        body: '<input class="input" readonly aria-label="Guest app link" value="' + esc(text) + '">',
        onOpen: function (el) { var i = O.$('input', el); setTimeout(function () { try { i.focus(); i.select(); } catch (e) {} }, 30); },
        actions: [{ label: 'Done', kind: 'primary' }] });
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(function () { U.toast(msg); }, fallback); return; }
    } catch (e) { /* fall through */ }
    fallback();
  }
  function copyLink(b) {
    if (!canCode()) return U.toast('The guest link opens the door code, and your access does not include door codes.', 'bad');
    var had = b.guestToken, link = O.guestLink(b);
    if (!had) changed('guestapp-token');
    copyText(link, 'Guest app link for ' + guestName(b) + ' copied');
  }
  /* the latest ID photo the guest sent in the app (a picture message in the booking's chat), or null */
  function idPhotoOf(b) {
    var c = convFor(b.id), list = c && Array.isArray(c.messages) ? c.messages.filter(function (m) { return isObj(m) && m.idPhoto === true && typeof m.url === 'string'; }) : [];
    return list.length ? list[list.length - 1] : null;
  }
  function openIdCheck(id) {
    var b = D.booking(id); if (!b || !canVerify()) return;
    var ph = idPhotoOf(b), sub = guestName(b) + ' · ' + propShort(b.propertyId) + ' · ' + d.fmtRange(b.checkIn, b.checkOut);
    U.modal({ title: 'Check ID', sub: sub,
      body: ph ? '<div class="ga-idview"><img src="' + esc(ph.url) + '" alt="ID photo sent by ' + esc(guestName(b)) + '"></div>' +
          '<p class="small muted">Sent in the guest app ' + esc(fmt.dateTime(ph.time)) + '. Check that the name matches the booking and the photo is clear. The photo is deleted from the chat when you mark the ID verified or ask for a new one.</p>'
        : '<p>There is no ID photo from the guest app for this stay. Check the ID the guest sent on WhatsApp, or check it at arrival.</p>',
      actions: (ph ? [{ label: 'Ask for a new photo', onClick: function () { askIdAgain(b.id); } }] : [{ label: 'Close' }])
        .concat([{ label: 'Mark ID verified', kind: 'primary', onClick: function () { verifyId(b.id); } }]) });
  }
  function verifyId(id) {
    var b = D.booking(id); if (!b || !canVerify()) return;
    var c = cfg(), done = isObj(b.guestCheckin) || isObj(b.rulesAccepted);
    b.idVerified = true;
    if (b.codeStatus === 'held' && (done || !on(c, 'requireCheckin'))) b.codeStatus = 'scheduled';
    var gone = stripIdPhotos(convFor(b.id), 'ID photo, deleted after the check');
    sysNote(b, 'ID verified by ' + staffName(O.state.viewer) + '.' + (gone ? ' The photo was deleted.' : ''), D.NOW, true);
    var s = stayInfo(b, c, D.NOW, ciFallbackOf(b));
    U.toast('ID verified for ' + guestName(b) + (s.visible ? '. The door code now shows in their app.' : s.waiting.indexOf('checkin') >= 0 ? '. The code shows once they check in online.' : '. The code shows from ' + atLabel(s.revealAt, D.NOW) + '.'));
    changed('guestapp-id'); draw();
  }
  function askIdAgain(id) {
    var b = D.booking(id); if (!b || !canVerify()) return;
    delete b.idSubmittedAt;
    stripIdPhotos(convFor(b.id), 'ID photo, not accepted and deleted');
    sysNote(b, 'ID photo not accepted by ' + staffName(O.state.viewer) + '. The guest app asks for a new one.', D.NOW, true);
    U.toast('The guest app now asks ' + guestName(b) + ' for a new ID photo.' + (O.can('inbox.send') ? ' Send them a message to say why.' : ''));
    changed('guestapp-id'); draw();
  }

  /* ---------- requests ---------- */
  var REQ_GROUPS = { open: function (r) { return r.status === 'new' || r.status === 'confirmed'; }, done: function (r) { return r.status === 'delivered'; }, declined: function (r) { return r.status === 'declined'; }, all: function () { return true; } };
  function reqPill(s) { return s === 'new' ? U.pill('New', 'warn') : s === 'confirmed' ? U.pill('Confirmed', 'info') : s === 'delivered' ? U.pill('Done', 'ok') : U.pill('Declined', 'neutral'); }
  function requestRowHTML(r) {
    var b = D.booking(r.bookingId), s = svcDef(r.type), open = r.status === 'new' || r.status === 'confirmed', acts = '', extra = '';
    if (r.type === 'code' && open) {
      if (canCode() && writable()) acts += '<button type="button" class="btn btn-primary btn-sm" data-ga-rlock="' + esc(r.id) + '">' + ic('key') + 'Change door code</button>';
      if (canReq()) acts += '<button type="button" class="btn btn-ghost btn-sm" data-ga-rset="' + esc(r.id) + ':delivered">Mark solved</button>';
    } else if (canReq()) {
      if (r.status === 'new') acts += '<button type="button" class="btn btn-primary btn-sm" data-ga-rset="' + esc(r.id) + ':confirmed">Confirm</button><button type="button" class="btn btn-ghost btn-sm" data-ga-rset="' + esc(r.id) + ':declined">Decline</button>';
      else if (r.status === 'confirmed') acts += '<button type="button" class="btn btn-ghost btn-sm" data-ga-rset="' + esc(r.id) + ':delivered">Mark done</button>';
    }
    if (b && canMsg() && O.can('inbox')) acts += '<button type="button" class="btn btn-ghost btn-sm ga-icon-btn" data-ga-msg="' + esc(b.id) + '" aria-label="Message ' + esc(guestName(b)) + '" title="Message ' + esc(guestName(b)) + '">' + ic('chat') + '</button>';
    if (b && open && r.type === 'late') {
      var nxt = D.bookings.filter(function (x) { return x.propertyId === b.propertyId && x.id !== b.id && x.status !== 'cancelled' && x.checkIn === b.checkOut; })[0];
      extra = '<div class="ga-rx ' + (nxt ? 'warn' : 'ok') + '">' + (nxt ? 'Next guest ' + esc(guestName(nxt)) + ' arrives the same day at ' + esc(fmt.time(nxt.checkInTime || '15:00')) + ', so check the clean can still finish.' : 'Nobody arrives at ' + esc(propShort(b.propertyId)) + ' on ' + esc(d.fmt(b.checkOut)) + ', so a late check-out is safe.') + '</div>';
    }
    if (b && open && r.type === 'early') {
      var prev = D.bookings.filter(function (x) { return x.propertyId === b.propertyId && x.id !== b.id && x.status !== 'cancelled' && x.checkOut === b.checkIn; })[0];
      extra = '<div class="ga-rx ' + (prev ? 'warn' : 'ok') + '">' + (prev ? esc(guestName(prev)) + ' checks out that morning at ' + esc(fmt.time(prev.checkOutTime || '11:00')) + ', so the clean must finish first.' : 'Nobody checks out of ' + esc(propShort(b.propertyId)) + ' that day, so the unit can be ready early.') + '</div>';
    }
    var t = taskById(r.taskId);
    var meta = (b ? (O.can('bookings') ? '<button type="button" class="ga-link" data-ga-bk="' + esc(b.id) + '">' + esc(guestName(b)) + '</button>' : esc(guestName(b))) + ' · ' + esc(propShort(b.propertyId)) : 'Booking no longer exists') +
      ' · ' + esc(fmt.ago(r.at)) + (r.by ? ' · ' + esc(r.status === 'declined' ? 'declined' : 'handled') + ' by ' + esc(staffName(r.by)) : '') +
      (t ? ' · <button type="button" class="ga-link" data-ga-task="' + esc(t.id) + '">task ' + (t.status === 'done' ? 'done' : 'open') + '</button>' : '');
    return '<div class="ga-row"><span class="ga-ri' + (r.type === 'code' ? ' bad' : '') + '">' + ic(s.icon || 'sparkle') + '</span><div class="ga-rm"><div class="ga-rt"><b>' + esc(s.name) + '</b>' + reqPill(r.status) + '</div>' +
      '<div class="ga-rs">' + esc(maskCode(r.summary || '')) + (r.note ? ' · "' + esc(r.note) + '"' : '') + '</div><div class="ga-rx">' + meta + '</div>' + extra + '</div>' + (acts ? '<div class="ga-ra">' + acts + '</div>' : '') + '</div>';
  }
  function requestsTabHTML() {
    var all = (D.guestRequests || []).slice().sort(byAtDesc), f = REQ_GROUPS[st.reqFilter] || REQ_GROUPS.open, list = all.filter(f);
    var chips = '<div class="chips">' + [['open', 'Open'], ['done', 'Done'], ['declined', 'Declined'], ['all', 'All']].map(function (c) {
      return '<button type="button" class="chip' + (st.reqFilter === c[0] ? ' on' : '') + '" data-ga-rfilt="' + c[0] + '">' + c[1] + ' <span class="n">' + all.filter(REQ_GROUPS[c[0]]).length + '</span></button>';
    }).join('') + '</div>';
    return '<div class="ga-subbar">' + chips + '<span class="small muted">Guests see the status of each request in their app.</span></div>' +
      (all.length && !canReq() ? viewOnly('answering guest requests') : '') +
      '<div class="card">' + (list.length ? list.map(requestRowHTML).join('') : U.empty(!all.length ? 'No requests yet. Guests ask for towels, a late check-out, airport transfers and more from their app, and each request shows here.' : st.reqFilter === 'open' ? 'No open requests. New ones from guests show here.' : 'No requests in this view.')) + '</div>';
  }
  function setReq(id, status) {
    var r = (D.guestRequests || []).filter(function (x) { return x.id === id; })[0]; if (!r || !canReq()) return;
    var b = D.booking(r.bookingId), s = svcDef(r.type), extra = '', vals = isObj(r.vals) ? r.vals : {};
    r.status = status; r.by = O.state.viewer; r.handledAt = D.NOW;
    if (status === 'confirmed' && b) {
      var p = D.propById[b.propertyId], hk = p && p.housekeeper, who = hk && (O.can('tasks.assign') || hk === O.state.viewer) ? hk : null;
      if ((r.type === 'clean' || r.type === 'towels') && !r.taskId && O.can('tasks.create')) {
        var clean = r.type === 'clean', day = clean && vals.date && vals.date >= D.TODAY ? vals.date : D.TODAY;
        var due = clean ? day + 'T' + (/morning/i.test(vals.slot || r.summary || '') ? '09:00' : '13:00') : addMinutes(D.NOW, 60);
        var t = { id: O.uid('T'), title: clean ? 'Mid-stay clean' : 'Bring extra towels and linen', type: 'Housekeeping', propertyId: b.propertyId, assigneeId: who, due: due, priority: clean ? 'low' : 'medium', status: 'todo', createdAt: D.NOW, createdBy: O.state.viewer, note: 'Guest app request from ' + guestName(b) + ': ' + (r.summary || s.name) + (r.note ? '. Note: ' + r.note : '') };
        if (clean) { t.checklistId = 'CL-daily'; t.checks = []; }
        D.tasks.push(t); r.taskId = t.id;
        extra = ' Task created' + (who ? ' for ' + staffName(who) : ', unassigned') + '.';
      }
      if (r.type === 'late') { var lt = to24(vals.until || r.summary); if (lt) { b.checkOutTime = lt; extra = ' Check-out moved to ' + fmt.time(lt) + '.'; } }
      if (r.type === 'early') { var et = to24(vals.time || r.summary); if (et) { b.checkInTime = et; extra = ' Check-in moved to ' + fmt.time(et) + ', and the door code shows from then.'; } }
    }
    var verb = status === 'confirmed' ? 'confirmed' : status === 'delivered' ? (r.type === 'code' ? 'marked solved' : 'marked done') : 'declined';
    if (b) sysNote(b, s.name + ' request ' + verb + ' by ' + staffName(O.state.viewer) + '.', D.NOW, true);
    U.toast(s.name + (b ? ' for ' + guestName(b) : '') + ' ' + verb + '.' + extra);
    changed('guestapp-request'); draw();
  }

  /* ---------- problems (damage reports) ---------- */
  function reportOpen(r) { var t = taskById(r.taskId); return t ? t.status !== 'done' : !r.noted; }
  function problemRowHTML(r) {
    var b = D.booking(r.bookingId), t = taskById(r.taskId), photos = Array.isArray(r.photos) ? r.photos : [];
    var acts = '';
    if (t) acts = '<span class="ga-task">' + (t.status === 'done' ? U.pill('Fixed', 'ok') : t.status === 'in_progress' ? U.pill('In progress', 'info') : U.pill('To do', 'warn')) + '<span class="small muted">' + esc(t.assigneeId ? staffName(t.assigneeId) : 'Unassigned') + '</span></span>' + (O.can('tasks') ? '<button type="button" class="btn btn-ghost btn-sm" data-ga-task="' + esc(t.id) + '">Open task</button>' : '');
    else if (r.noted) acts = U.pill('Noted', 'neutral') + '<span class="small muted">by ' + esc(staffName(r.noted.by)) + '</span>';
    else if (canReq()) acts = (O.can('tasks.create') ? '<button type="button" class="btn btn-primary btn-sm" data-ga-mktask="' + esc(r.id) + '">' + ic('tasks') + 'Create repair task</button>' : '') + '<button type="button" class="btn btn-ghost btn-sm" data-ga-noted="' + esc(r.id) + '">' + (r.when === 'arrival' ? 'Noted, no repair' : 'No repair needed') + '</button>';
    else acts = U.pill('No task yet', 'neutral');
    return '<div class="ga-row"><span class="ga-ri bad">' + ic('alert') + '</span><div class="ga-rm"><div class="ga-rt"><b>' + esc(r.item || 'Problem') + '</b>' + (r.when === 'arrival' ? U.pill('There on arrival', 'info') : U.pill('During the stay', 'warn')) + (r.urgent ? U.pill('Urgent', 'bad') : '') + '</div>' +
      '<div class="ga-rs">' + esc(r.room || 'Other') + ' · ' + esc(r.desc || 'No description') + '</div>' +
      '<div class="ga-rx">' + (b && O.can('bookings') ? '<button type="button" class="ga-link" data-ga-bk="' + esc(b.id) + '">' + esc(r.guest || guestName(b)) + '</button>' : esc(r.guest || 'Guest')) + ' · ' + esc(propShort(r.propertyId)) + ' · ' + esc(fmt.dateTime(r.at)) + (photos.length ? ' · ' + photosPlural(photos.length) : '') + '</div>' +
      (photos.length ? '<div class="ga-pics">' + photos.map(function (ph, i) { return '<button type="button" data-ga-pic="' + esc(r.id) + ':' + i + '" aria-label="View photo ' + (i + 1) + ' of ' + esc(r.item || 'the problem') + '"><img src="' + esc(ph.url) + '" alt=""></button>'; }).join('') + '</div>' : '') +
      '</div><div class="ga-ra">' + acts + '</div></div>';
  }
  function problemsTabHTML() {
    var all = (D.damageReports || []).slice().sort(byAtDesc), list = st.dmgFilter === 'all' ? all : all.filter(reportOpen);
    var chips = '<div class="chips">' + [['open', 'To handle', all.filter(reportOpen).length], ['all', 'All', all.length]].map(function (c) {
      return '<button type="button" class="chip' + (st.dmgFilter === c[0] ? ' on' : '') + '" data-ga-dfilt="' + c[0] + '">' + c[1] + ' <span class="n">' + c[2] + '</span></button>';
    }).join('') + '</div>';
    return '<div class="ga-subbar">' + chips + '<span class="small muted">Problems guests report in their app, with photos. Damage that was there on arrival is not charged to the guest.</span></div>' +
      (all.length && !canReq() ? viewOnly('handling problem reports') : '') +
      '<div class="card">' + (list.length ? list.map(problemRowHTML).join('') : U.empty(!all.length ? 'No problems reported. When a guest reports something broken in their app, it shows here with the photos.' : 'Nothing to handle. Every reported problem has a task or was noted.')) + '</div>';
  }
  function createTaskFor(id) {
    var r = (D.damageReports || []).filter(function (x) { return x.id === id; })[0]; if (!r || r.taskId || !canReq() || !O.can('tasks.create')) return;
    var b = D.booking(r.bookingId), arrival = r.when === 'arrival', urgent = r.urgent === true;
    var maint = D.staff.filter(function (s) { return s.role === 'maintenance'; })[0], who = O.can('tasks.assign') ? (maint ? maint.id : null) : null;
    var later = b && b.checkOut > D.TODAY ? b.checkOut : d.add(D.TODAY, 1);
    var photos = Array.isArray(r.photos) ? r.photos : [];
    var t = { id: O.uid('T'), title: (arrival ? 'Check damage reported on arrival: ' : 'Repair: ') + lc(r.item || 'problem'), type: 'Maintenance', propertyId: r.propertyId, assigneeId: who,
      due: urgent ? addMinutes(D.NOW, 120) : (arrival ? later : d.add(D.TODAY, 1)) + 'T12:00', priority: urgent ? 'high' : arrival ? 'low' : 'medium', status: 'todo', createdAt: D.NOW, createdBy: O.state.viewer,
      note: 'Reported in the guest app by ' + (r.guest || 'the guest') + ' (' + (r.room || 'Other') + '): ' + (r.desc || r.item) + (arrival ? ' Already damaged on arrival, so the guest is not charged.' : ''), photos: photos.length };
    if (photos.length) t.photoUrls = photos.map(function (ph) { return ph.url; });
    D.tasks.push(t); r.taskId = t.id;
    if (b) sysNote(b, 'Repair task created for "' + (r.item || 'problem') + '" by ' + staffName(O.state.viewer) + '.', D.NOW, true);
    U.toast('Task created' + (who ? ' for ' + staffName(who) : '. It is unassigned, so it shows on the dashboard until someone takes it') + '.', who ? 'ok' : 'bad');
    changed('guestapp-report'); draw();
  }
  function markNoted(id) {
    var r = (D.damageReports || []).filter(function (x) { return x.id === id; })[0]; if (!r || !canReq()) return;
    r.noted = { by: O.state.viewer, at: D.NOW };
    U.toast('Marked as noted. The guest sees it as logged.');
    changed('guestapp-report'); draw();
  }
  function photoModal(rid, idx) {
    var r = (D.damageReports || []).filter(function (x) { return x.id === rid; })[0]; if (!r) return;
    var photos = Array.isArray(r.photos) ? r.photos : [], t = taskById(r.taskId);
    U.modal({ title: r.item || 'Problem', sub: (r.room || 'Other') + ' · ' + (r.guest || 'Guest') + ' · ' + fmt.dateTime(r.at), size: photos.length > 1 ? 'wide' : '',
      body: '<div class="ga-pm"><div class="ga-pm-grid">' + photos.map(function (ph, i) { return '<img src="' + esc(ph.url) + '" alt="Photo ' + (i + 1) + ' of ' + esc(r.item || 'the problem') + '"' + (i === idx ? ' class="on"' : '') + '>'; }).join('') + '</div>' + (r.desc ? '<p class="small">' + esc(r.desc) + '</p>' : '') + '</div>',
      actions: [{ label: 'Close' }].concat(t && O.can('tasks') ? [{ label: 'Open task', kind: 'primary', onClick: function () { O.go('tasks', { taskId: t.id }); } }] : []) });
  }

  /* ---------- house info ---------- */
  var LISTS = {
    rules: { label: 'House rules', hint: 'Guests read and accept these during online check-in. {guests} and {checkout} fill in from the booking.', title: true, scoped: false, blank: { title: 'New rule', text: 'Explain the rule in one sentence.' }, empty: 'No house rules yet. Add at least one so guests have something to accept.' },
    entry: { label: 'Getting in', hint: 'Steps shown with the address and parking. {lock} becomes the unit\'s lock brand. Pick a unit to show a step only there.', title: false, scoped: true, blank: { text: 'Describe one step.' }, empty: 'No steps yet. Guests see the address, parking and their door code.' },
    guide: { label: 'House guide', hint: 'Short answers guests open one by one: aircon, hot water, rubbish and so on. Pick a unit to show a topic only there.', title: true, scoped: true, blank: { title: 'New topic', text: 'Explain it in one or two sentences.' }, empty: 'No topics yet.' },
    checkout: { label: 'Check-out', hint: 'What guests do before they leave. {checkout} becomes their check-out time.', title: false, scoped: false, blank: { text: 'Describe one step.' }, empty: 'No check-out steps yet. Guests see their check-out time only.' }
  };
  function scopeSelect(sec, x) {
    var cur = Array.isArray(x.propertyIds) && x.propertyIds.length ? x.propertyIds[0] : '';
    return '<select class="select ga-scope" data-ga-scope="' + esc(sec + ':' + x.id) + '" aria-label="Show this in">' + '<option value="">All units</option>' +
      D.properties.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === cur ? ' selected' : '') + '>Only ' + esc(p.short || p.name) + '</option>'; }).join('') +
      (cur && !D.propById[cur] ? '<option value="' + esc(cur) + '" selected>Only a removed unit</option>' : '') + '</select>';
  }
  function infoTabHTML() {
    var sec = LISTS[st.info] ? st.info : 'welcome', ed = canEdit(), c = cfg();
    var head = '<div class="ga-subbar">' + U.seg([['welcome', 'Welcome'], ['rules', 'House rules'], ['entry', 'Getting in'], ['guide', 'House guide'], ['checkout', 'Check-out']], sec, 'data-ga-info') + '<span class="small muted">Changes show in every guest app straight away.</span></div>' + (ed ? '' : viewOnly('editing the guest app'));
    if (sec === 'welcome') {
      return head + '<div class="card"><div class="card-body stack"><div class="field"><label for="ga-welcome">Welcome message on the home screen</label>' +
        (ed ? '<textarea id="ga-welcome" class="textarea" rows="3" maxlength="400" data-ga-cfg="welcome">' + esc(c.welcome || '') + '</textarea>' : '<p class="ga-ro">' + esc(c.welcome || 'No welcome message.') + '</p>') + '</div></div></div>';
    }
    var L = LISTS[sec], items = Array.isArray(c[sec]) ? c[sec] : [];
    var rows = items.map(function (x, i) {
      if (!isObj(x)) return '';
      var scope = L.scoped && Array.isArray(x.propertyIds) && x.propertyIds.length ? x.propertyIds.map(propShort).join(', ') : '';
      if (!ed) return '<div class="ga-edit ro"><span class="ga-n">' + (i + 1) + '</span><div class="ga-fl">' + (L.title ? '<b>' + esc(x.title || '') + '</b>' : '') + '<span>' + esc(x.text || '') + '</span>' + (scope ? '<span class="small muted">Only ' + esc(scope) + '</span>' : '') + '</div></div>';
      var key = sec + ':' + x.id;
      return '<div class="ga-edit"><span class="ga-n">' + (i + 1) + '</span><div class="ga-fl">' +
        (L.title ? '<input class="input" data-ga-li="' + esc(key) + ':title" value="' + esc(x.title || '') + '" maxlength="120" aria-label="' + esc(L.label) + ' ' + (i + 1) + ' title">' : '') +
        '<textarea class="textarea" rows="2" data-ga-li="' + esc(key) + ':text" maxlength="600" aria-label="' + esc(L.label) + ' ' + (i + 1) + ' text">' + esc(x.text || '') + '</textarea>' + (L.scoped ? scopeSelect(sec, x) : '') + '</div>' +
        '<div class="ga-ea"><button type="button" class="ga-ib" data-ga-move="' + esc(key) + ':-1" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>' + ic('up') + '</button><button type="button" class="ga-ib" data-ga-move="' + esc(key) + ':1" aria-label="Move down"' + (i === items.length - 1 ? ' disabled' : '') + '>' + ic('down') + '</button><button type="button" class="ga-ib" data-ga-del="' + esc(key) + '" aria-label="Delete">' + ic('trash') + '</button></div></div>';
    }).join('');
    return head + '<div class="card"><div class="card-body"><p class="ga-hint">' + esc(L.hint) + '</p>' + (rows || U.empty(L.empty)) +
      (ed ? '<button type="button" class="btn btn-ghost btn-sm" data-ga-add="' + sec + '">' + ic('plus') + 'Add ' + (sec === 'rules' ? 'a rule' : sec === 'guide' ? 'a topic' : 'a step') + '</button>' : '') + '</div></div>';
  }

  /* ---------- local tips ---------- */
  var PLACE_PH = { kl: 'e.g. Perdana Botanical Gardens', penang: 'e.g. Penang Botanic Gardens', melaka: 'e.g. Melaka Straits Mosque', cameron: 'e.g. Time Tunnel museum' };
  function tipsTabHTML() {
    var ed = canEdit(), c = cfg(), todo = isObj(c.todo) ? c.todo : {}, dont = Array.isArray(c.dont) ? c.dont : [], videos = Array.isArray(c.videos) ? c.videos : [];
    var firstCity = D.properties.map(function (p) { return cityOf(p.area); }).filter(Boolean)[0];
    var city = st.tipsCity || firstCity || 'kl';
    var out = '<div class="ga-subbar">' + U.seg([['todo', 'Things to do'], ['dont', 'Good to know'], ['videos', 'Videos']], st.tips, 'data-ga-tips') + '<span class="small muted">Guests see the places for the city their stay is in.</span></div>' + (ed ? '' : viewOnly('editing the guest app'));
    var body = '';
    if (st.tips === 'todo') {
      var items = Array.isArray(todo[city]) ? todo[city] : [];
      body = '<div class="chips ga-chips">' + CITY_ORDER.map(function (k) { return '<button type="button" class="chip' + (k === city ? ' on' : '') + '" data-ga-tcity="' + k + '">' + esc(CITY[k]) + ' <span class="n">' + (Array.isArray(todo[k]) ? todo[k].length : 0) + '</span></button>'; }).join('') + '</div>' +
        (items.length ? items.map(function (t, i) {
          return '<div class="ga-vrow"><div class="ga-rm"><div class="ga-rt"><b>' + esc(t.name) + '</b>' + U.pill(t.cat || 'Place', 'brand') + '</div><div class="ga-rs">' + esc(t.tip || '') + (t.time ? ' · ' + esc(t.time) : '') + '</div></div>' + (ed ? '<button type="button" class="ga-ib" data-ga-tdel="' + city + ':' + i + '" aria-label="Remove ' + esc(t.name) + '">' + ic('trash') + '</button>' : '') + '</div>';
        }).join('') : U.empty('No places for ' + CITY[city] + ' yet.')) +
        (ed ? '<div class="ga-add"><div class="section-title">Add a place in ' + esc(CITY[city]) + '</div><div class="form-grid"><div class="field"><label for="ga-t-name">Place</label><input id="ga-t-name" class="input" data-ga-tf="name" maxlength="80" placeholder="' + esc(PLACE_PH[city] || '') + '"></div>' +
          '<div class="field"><label for="ga-t-cat">Type</label><select id="ga-t-cat" class="select" data-ga-tf="cat">' + ['Sights', 'Food', 'Nature', 'Culture', 'Shopping'].map(function (x) { return '<option>' + x + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label for="ga-t-tip">Tip for guests</label><input id="ga-t-tip" class="input" data-ga-tf="tip" maxlength="240" placeholder="When to go, what to bring, how to get there"></div>' +
          '<div class="field"><label for="ga-t-time">Time needed (optional)</label><input id="ga-t-time" class="input" data-ga-tf="time" maxlength="40" placeholder="e.g. 2 hours"></div></div>' +
          '<div class="row-flex wrap ga-add-a"><button type="button" class="btn btn-primary btn-sm" data-ga="addtodo">' + ic('plus') + 'Add place</button><span class="small ga-err" data-ga-err></span></div></div>' : '');
    } else if (st.tips === 'dont') {
      body = (dont.length ? dont.map(function (n) {
        return '<div class="ga-vrow"><div class="ga-rm"><div class="ga-rt"><b>' + esc(n.title) + '</b>' + U.pill(n.kind || 'Tip', n.kind === 'Law' ? 'bad' : n.kind === 'Safety' ? 'warn' : 'info') + '</div><div class="ga-rs">' + esc(n.text || '') + '</div></div>' + (ed ? '<button type="button" class="ga-ib" data-ga-ndel="' + esc(n.id) + '" aria-label="Remove ' + esc(n.title) + '">' + ic('trash') + '</button>' : '') + '</div>';
      }).join('') : U.empty('Nothing listed yet.')) +
        (ed ? '<div class="ga-add"><div class="section-title">Add a point</div><div class="form-grid"><div class="field"><label for="ga-n-title">Do not…</label><input id="ga-n-title" class="input" data-ga-nf="title" maxlength="120" placeholder="e.g. Do not swim where there are jellyfish warnings"></div>' +
          '<div class="field"><label for="ga-n-kind">Type</label><select id="ga-n-kind" class="select" data-ga-nf="kind"><option>Law</option><option>Etiquette</option><option>Safety</option></select></div>' +
          '<div class="field full"><label for="ga-n-text">Why</label><input id="ga-n-text" class="input" data-ga-nf="text" maxlength="240" placeholder="One short sentence"></div></div>' +
          '<div class="row-flex wrap ga-add-a"><button type="button" class="btn btn-primary btn-sm" data-ga="adddont">' + ic('plus') + 'Add point</button><span class="small ga-err" data-ga-err></span></div></div>' : '');
    } else {
      body = (videos.length ? videos.map(function (v) {
        return '<div class="ga-vrow"><a class="ga-thumb" href="' + esc(ytLink(v)) + '" target="_blank" rel="noopener" aria-label="Find ' + esc(v.title) + ' on YouTube">' + thumbSVG(v.city) + '<span class="ga-dur">' + esc(v.dur || '') + '</span></a><div class="ga-rm"><div class="ga-rt"><b>' + esc(v.title) + '</b></div><div class="ga-rs">' + esc(v.vlogger || '') + ' · ' + esc(v.city === 'all' ? 'All Malaysia' : (CITY[v.city] || '')) + '</div></div>' +
          (ed ? '<button type="button" class="ga-ib" data-ga-vdel="' + esc(v.id) + '" aria-label="Remove ' + esc(v.title) + '">' + ic('trash') + '</button>' : '') + '</div>';
      }).join('') : U.empty('No videos. The Videos section is hidden from guests until you add one.')) +
        (ed ? '<div class="ga-add"><div class="section-title">Add a video</div><div class="form-grid">' +
          '<div class="field"><label for="ga-v-vlogger">Vlogger or channel</label><input id="ga-v-vlogger" class="input" data-ga-vf="vlogger" maxlength="80" placeholder="e.g. Mark Wiens"></div>' +
          '<div class="field"><label for="ga-v-title">Video title</label><input id="ga-v-title" class="input" data-ga-vf="title" maxlength="120" placeholder="e.g. Best nasi lemak in Kuala Lumpur"></div>' +
          '<div class="field"><label for="ga-v-city">City</label><select id="ga-v-city" class="select" data-ga-vf="city"><option value="all">All Malaysia</option>' + CITY_ORDER.map(function (k) { return '<option value="' + k + '">' + esc(CITY[k]) + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label for="ga-v-dur">Length (min:sec)</label><input id="ga-v-dur" class="input" data-ga-vf="dur" inputmode="numeric" maxlength="7" placeholder="12:30"></div></div>' +
          '<div class="row-flex wrap ga-add-a"><button type="button" class="btn btn-primary btn-sm" data-ga="addvideo">' + ic('plus') + 'Add video</button><span class="small ga-err" data-ga-err></span></div><p class="ga-hint">Guests tap a video to search for it on YouTube.</p></div>' : '');
    }
    return out + '<div class="card"><div class="card-body">' + body + '</div></div>';
  }

  /* ---------- settings ---------- */
  function switchRow(key, label, sub, allowed, why) {
    var val = on(cfg(), key);
    return '<div class="ga-set"><div class="ga-set-t"><b>' + esc(label) + '</b><span>' + esc(sub) + '</span></div>' +
      '<button type="button" class="switch' + (val ? ' on' : '') + '" role="switch" aria-checked="' + val + '" aria-label="' + esc(label) + '" data-ga-opt="' + key + '"' + (allowed ? '' : ' disabled title="' + esc(why) + '"') + '></button></div>';
  }
  function settingsTabHTML() {
    var c = cfg(), edC = writable() && canCode(), ed = canEdit(), noCode = 'Your access does not include door codes', noEdit = 'Your access does not include editing the guest app';
    var from = fmt.time(addMinutes('2026-01-01T15:00', -UNIT_REVEAL_MIN).slice(11, 16));
    var cond = [on(c, 'requireCheckin') ? 'they have checked in online' : null, on(c, 'requireId') ? 'their ID is verified' : null].filter(Boolean);
    var rule = 'A guest checking in at ' + fmt.time('15:00') + ' sees the door code from ' + from + ' on the arrival day' + (cond.length ? ', once ' + cond.join(' and ') : '') + '.';
    var services = Array.isArray(c.services) ? c.services : [];
    return (!writable() ? viewOnly('changes') : '') +
      '<div class="ga-sets">' +
      '<section class="card"><div class="card-head"><h3>Door code</h3>' + (edC ? '' : '<span class="sub">' + esc(noCode) + '</span>') + '</div><div class="card-body">' +
        '<div class="ga-set"><div class="ga-set-t"><b>When the code shows</b><span>30 minutes before the check-in time, together with the unit number.</span></div></div>' +
        switchRow('requireCheckin', 'Online check-in first', 'Guests confirm their names and arrival time and accept the house rules.', edC, noCode) +
        switchRow('requireId', 'Verified ID first', 'Guests add a passport or MyKad photo and your team marks it verified.', edC, noCode) +
        '<div class="note brand ga-rule">' + esc(rule) + '</div></div></section>' +
      '<section class="card"><div class="card-head"><h3>Check-in and feedback</h3>' + (ed ? '' : '<span class="sub">' + esc(noEdit) + '</span>') + '</div><div class="card-body">' +
        switchRow('requireName', 'Sign with full name', 'Guests type their full name to accept the house rules.', ed, noEdit) +
        switchRow('reviewPrompt', 'Ask for feedback', 'After check-out, guests rate their stay and are reminded to leave a review.', ed, noEdit) + '</div></section>' +
      '<section class="card"><div class="card-head"><h3>Contact</h3><span class="sub">Shown with the Call and WhatsApp buttons</span></div><div class="card-body"><div class="form-grid">' +
        [['phone', 'Phone', 'tel', (O.ws() || {}).phone ? (O.ws().phone + ' (workspace phone)') : '+60 12-345 6789'], ['whatsapp', 'WhatsApp (if different)', 'tel', '+60 12-345 6789'], ['hours', 'Hours you answer', 'text', '8 AM to 11 PM']].map(function (f) {
          var v = isObj(c.contact) ? c.contact[f[0]] || '' : '';
          return '<div class="field"><label for="ga-c-' + f[0] + '">' + esc(f[1]) + '</label><input id="ga-c-' + f[0] + '" class="input" type="' + f[2] + '" data-ga-contact="' + f[0] + '" value="' + esc(v) + '" maxlength="60" placeholder="' + esc(f[3]) + '"' + (ed ? '' : ' disabled') + '></div>';
        }).join('') + '</div></div></section>' +
      '<section class="card ga-svc-card"><div class="card-head"><h3>Requests guests can make</h3><span class="sub">Switch off anything you cannot supply. Door code help is always on.</span></div><div class="card-body">' +
        (services.length ? services.map(function (s) {
          var onNow = s.on !== false;
          return '<div class="ga-set"><span class="ga-ri">' + ic(s.icon || 'sparkle') + '</span><div class="ga-set-t"><b>' + esc(s.name) + '</b><span>' + esc([s.price, s.desc].filter(Boolean).join(' · ')) + '</span></div>' +
            '<button type="button" class="switch' + (onNow ? ' on' : '') + '" role="switch" aria-checked="' + onNow + '" aria-label="Offer ' + esc(s.name) + '" data-ga-svcon="' + esc(s.id) + '"' + (ed ? '' : ' disabled title="' + esc(noEdit) + '"') + '></button></div>';
        }).join('') : U.empty('No request types.')) + '</div></section></div>';
  }

  /* ---------- render and events ---------- */
  function newRequests() { return (D.guestRequests || []).filter(function (r) { return r.status === 'new'; }).length; }
  function openProblems() { return (D.damageReports || []).filter(function (r) { return !r.taskId && !r.noted; }).length; }
  function draw() {
    var w = wrapEl(); if (!w) return;
    var tabs = [['guests', 'Guests'], ['requests', 'Requests', newRequests()], ['damage', 'Problems', openProblems()], ['info', 'House info'], ['tips', 'Local tips'], ['settings', 'Settings']];
    if (!tabs.some(function (t) { return t[0] === st.tab; })) st.tab = 'guests';
    var body = st.tab === 'requests' ? requestsTabHTML() : st.tab === 'damage' ? problemsTabHTML() : st.tab === 'info' ? infoTabHTML() : st.tab === 'tips' ? tipsTabHTML() : st.tab === 'settings' ? settingsTabHTML() : guestsTabHTML();
    w.innerHTML = '<div class="tabs ga-tabs" role="tablist">' + tabs.map(function (t) {
      return '<button type="button" role="tab" aria-selected="' + (st.tab === t[0]) + '" data-ga-tab="' + t[0] + '" class="' + (st.tab === t[0] ? 'on' : '') + '">' + t[1] + (t[2] ? '<span class="ga-tn">' + t[2] + '</span>' : '') + '</button>';
    }).join('') + '</div><div class="ga-body">' + body + '</div>';
    if (st.scrollHl && st.hl) { st.scrollHl = false; var row = O.$('[data-ga-row="' + st.hl + '"]', w); if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center' }); }
  }
  function findItem(sec, id) { var l = ownList(sec); return Array.isArray(l) ? l.filter(function (x) { return isObj(x) && x.id === id; })[0] : null; }
  function formVals(w, attr) { var v = {}; O.$$('[' + attr + ']', w).forEach(function (i) { v[i.getAttribute(attr)] = String(i.value || '').trim(); }); return v; }
  function formErr(w, msg) { var e = O.$('[data-ga-err]', w); if (e) e.textContent = msg; }
  function onClick(e) {
    var w = wrapEl(), t = e.target.closest('button, a'); if (!w || !t || !w.contains(t) || t.disabled) return;
    var ds = t.dataset, parts, it, list, c = cfg();
    if (ds.gaTab) { st.tab = ds.gaTab; return draw(); }
    if (ds.gaGo) return O.go(ds.gaGo);
    if (ds.gaPreview) { var pb = D.booking(ds.gaPreview); if (pb) openPreview(pb); return; }
    if (ds.gaCopy) { var cb = D.booking(ds.gaCopy); if (cb) copyLink(cb); return; }
    if (ds.gaVerify) return verifyId(ds.gaVerify);
    if (ds.gaIdcheck) return openIdCheck(ds.gaIdcheck);
    if (ds.gaBk) return O.booking.open(ds.gaBk);
    if (ds.gaRfilt) { st.reqFilter = ds.gaRfilt; return draw(); }
    if (ds.gaDfilt) { st.dmgFilter = ds.gaDfilt; return draw(); }
    if (ds.gaRset) { parts = ds.gaRset.split(':'); return setReq(parts[0], parts[1]); }
    if (ds.gaRlock) { var rq = (D.guestRequests || []).filter(function (x) { return x.id === ds.gaRlock; })[0]; if (rq) O.lock.change({ bookingId: rq.bookingId }); return; }
    if (ds.gaMsg) return O.go('inbox', { bookingId: ds.gaMsg });
    if (ds.gaTask) return O.go('tasks', { taskId: ds.gaTask });
    if (ds.gaMktask) return createTaskFor(ds.gaMktask);
    if (ds.gaNoted) return markNoted(ds.gaNoted);
    if (ds.gaPic) { parts = ds.gaPic.split(':'); return photoModal(parts[0], +parts[1]); }
    if (ds.gaInfo) { st.info = ds.gaInfo; return draw(); }
    if (ds.gaTips) { st.tips = ds.gaTips; return draw(); }
    if (ds.gaTcity) { st.tipsCity = ds.gaTcity; return draw(); }
    if (ds.gaOpt) {
      var codeKey = ds.gaOpt === 'requireCheckin' || ds.gaOpt === 'requireId';
      if (codeKey ? !(writable() && canCode()) : !canEdit()) return;
      setCfg(ds.gaOpt, !on(c, ds.gaOpt));
      U.toast(ds.gaOpt === 'requireCheckin' ? (on(cfg(), 'requireCheckin') ? 'Guests now check in online before the door code shows' : 'The door code no longer waits for online check-in')
        : ds.gaOpt === 'requireId' ? (on(cfg(), 'requireId') ? 'The door code now waits for a verified ID' : 'The door code no longer waits for an ID check')
          : ds.gaOpt === 'requireName' ? (on(cfg(), 'requireName') ? 'Guests sign the house rules with their full name' : 'Guests only tick to accept the house rules')
            : (on(cfg(), 'reviewPrompt') ? 'Guests are asked for feedback after check-out' : 'Guests are no longer asked for feedback'));
      changed('guestapp-settings'); return draw();
    }
    if (ds.gaSvcon) {
      if (!canEdit()) return;
      it = findItem('services', ds.gaSvcon); if (!it) return;
      it.on = it.on === false; U.toast(it.name + (it.on ? ' is now offered to guests' : ' is hidden from guests'));
      changed('guestapp-settings'); return draw();
    }
    if (!canEdit()) return;
    if (ds.gaAdd) {
      var L = LISTS[ds.gaAdd]; if (!L) return;
      list = ownList(ds.gaAdd); var nx = clone(L.blank); nx.id = O.uid(ds.gaAdd.slice(0, 2).toUpperCase()); if (L.scoped) nx.propertyIds = [];
      list.push(nx); changed('guestapp-settings'); draw();
      var ins = O.$$('[data-ga-li^="' + ds.gaAdd + ':' + nx.id + ':"]', w); if (ins.length) { ins[0].focus(); if (ins[0].select) ins[0].select(); }
      return;
    }
    if (ds.gaMove) {
      parts = ds.gaMove.split(':'); list = ownList(parts[0]);
      var i = list.findIndex(function (x) { return isObj(x) && x.id === parts[1]; }), j = i + (+parts[2]);
      if (i < 0 || j < 0 || j >= list.length) return;
      var tmp = list[i]; list[i] = list[j]; list[j] = tmp; changed('guestapp-settings'); return draw();
    }
    if (ds.gaDel) {
      parts = ds.gaDel.split(':'); list = ownList(parts[0]);
      var k = list.findIndex(function (x) { return isObj(x) && x.id === parts[1]; }); if (k < 0) return;
      var gone = list.splice(k, 1)[0]; U.toast('Removed' + (gone && gone.title ? ': ' + gone.title : ''));
      changed('guestapp-settings'); return draw();
    }
    if (ds.gaTdel) {
      parts = ds.gaTdel.split(':'); var todo = own('todo'); if (!isObj(todo) || !Array.isArray(todo[parts[0]])) return;
      var rm = todo[parts[0]].splice(+parts[1], 1)[0]; U.toast((rm ? rm.name : 'Place') + ' removed');
      changed('guestapp-settings'); return draw();
    }
    if (ds.gaNdel) { list = ownList('dont'); var ni = list.findIndex(function (x) { return x.id === ds.gaNdel; }); if (ni >= 0) list.splice(ni, 1); U.toast('Removed from good to know'); changed('guestapp-settings'); return draw(); }
    if (ds.gaVdel) { list = ownList('videos'); var vi = list.findIndex(function (x) { return x.id === ds.gaVdel; }); if (vi >= 0) list.splice(vi, 1); U.toast('Video removed from the guest app'); changed('guestapp-settings'); return draw(); }
    if (ds.ga === 'addtodo') {
      var tf = formVals(w, 'data-ga-tf');
      if (!tf.name || !tf.tip) return formErr(w, 'Enter the place and a tip.');
      var city = st.tipsCity || D.properties.map(function (p) { return cityOf(p.area); }).filter(Boolean)[0] || 'kl', td = own('todo');
      if (!Array.isArray(td[city])) td[city] = [];
      td[city].push({ name: tf.name, cat: tf.cat || 'Sights', tip: tf.tip, time: tf.time || '' });
      U.toast(tf.name + ' added to things to do in ' + CITY[city]); changed('guestapp-settings'); return draw();
    }
    if (ds.ga === 'adddont') {
      var nf = formVals(w, 'data-ga-nf');
      if (!nf.title || !nf.text) return formErr(w, 'Enter the point and why.');
      ownList('dont').push({ id: O.uid('N'), kind: nf.kind || 'Etiquette', title: nf.title, text: nf.text });
      U.toast('Added to good to know'); changed('guestapp-settings'); return draw();
    }
    if (ds.ga === 'addvideo') {
      var vf = formVals(w, 'data-ga-vf');
      var verr = !vf.vlogger || !vf.title ? 'Enter the vlogger and the video title.' : vf.dur && !/^\d{1,3}:\d{2}$/.test(vf.dur) ? 'Length must look like 12:30.' : '';
      if (verr) return formErr(w, verr);
      ownList('videos').unshift({ id: O.uid('V'), vlogger: vf.vlogger, title: vf.title, city: vf.city || 'all', dur: vf.dur || '' });
      U.toast('Video added. It is the first one guests see.'); changed('guestapp-settings'); return draw();
    }
  }
  function onInput(e) {
    var t = e.target, ds = t.dataset, parts, it;
    if (!canEdit()) return;
    if (ds.gaLi) { parts = ds.gaLi.split(':'); it = findItem(parts[0], parts[1]); if (it && (parts[2] === 'title' || parts[2] === 'text')) { it[parts[2]] = t.value; dirty = true; } }
    else if (ds.gaCfg === 'welcome') { setCfg('welcome', t.value); dirty = true; }
    else if (ds.gaContact) { var ct = own('contact'); if (isObj(ct)) { ct[ds.gaContact] = t.value.slice(0, 60); dirty = true; } }
  }
  function onChange(e) {
    var t = e.target, ds = t.dataset, parts, it;
    if (ds.gaLi || ds.gaCfg || ds.gaContact) { onInput(e); if (dirty) { dirty = false; changed('guestapp-settings'); } return; }
    if (ds.gaScope != null && canEdit()) { parts = ds.gaScope.split(':'); it = findItem(parts[0], parts[1]); if (it) { it.propertyIds = t.value ? [t.value] : []; changed('guestapp-settings'); } return; }
    if (ds.gaLead != null && writable() && canCode()) { setCfg('codeLeadHours', Math.max(0, Math.min(12, parseInt(t.value, 10) || 0))); changed('guestapp-settings'); draw(); }
  }

  /* a door-code problem reported in the app is closed as soon as anyone changes that guest's code (from any page) */
  O.on('data', function (pl) {
    if (!pl || pl.type !== 'lock') return;
    (D.guestRequests || []).forEach(function (r) {
      var bk = r.type === 'code' && (r.status === 'new' || r.status === 'confirmed') && D.booking(r.bookingId);
      if (bk && r.code && String(bk.doorCode) !== String(r.code)) { r.status = 'delivered'; r.by = O.state.viewer; r.handledAt = D.NOW; r.summary = 'Code did not open the door · a new code was set'; }
    });
  });

  /* bell: new requests and problems without a task */
  O.notifiers.push(function () {
    if (!O.can('guestapp')) return [];
    var out = [], nw = (D.guestRequests || []).filter(function (r) { return r.status === 'new'; });
    nw.filter(function (r) { return r.type === 'code'; }).forEach(function (r) {
      var b = D.booking(r.bookingId);
      out.push({ icon: '🔑', tone: 'bad', t: 'Door code not working: ' + guestName(b), s: (b ? propShort(b.propertyId) + ' · ' : '') + 'reported ' + fmt.ago(r.at), go: ['guestapp', { tab: 'requests' }] });
    });
    var rest = nw.filter(function (r) { return r.type !== 'code'; });
    if (rest.length) out.push({ icon: '🛎', tone: 'warn', t: fmt.plural(rest.length, 'new guest request'), s: rest.slice(0, 3).map(function (r) { return svcDef(r.type).name; }).join(', ') + (rest.length > 3 ? ' and more' : ''), go: ['guestapp', { tab: 'requests' }] });
    if (canVerify()) {
      var ids = D.bookings.filter(function (b) { return b.idSubmittedAt && b.idVerified !== true && b.status !== 'cancelled' && b.checkOut >= D.TODAY; });
      if (ids.length) out.push({ icon: '👤', tone: 'warn', t: fmt.plural(ids.length, 'ID photo') + ' to check', s: ids.slice(0, 3).map(guestName).join(', ') + (ids.length > 3 ? ' and more' : '') + '. Door codes wait for it.', go: ['guestapp', { tab: 'guests' }] });
    }
    (D.damageReports || []).filter(function (r) { return !r.taskId && !r.noted && r.when !== 'arrival'; }).forEach(function (r) {
      out.push({ icon: '🔧', tone: r.urgent ? 'bad' : 'warn', t: (r.urgent ? 'Urgent problem: ' : 'Problem reported: ') + (r.item || 'see report'), s: propShort(r.propertyId) + ' · ' + (r.guest || 'Guest') + ' · ' + fmt.ago(r.at), go: ['guestapp', { tab: 'damage' }] });
    });
    return out;
  });

  O.page('guestapp', {
    desc: 'Each guest\'s own app: online check-in, the door code, Wi-Fi, house guide, requests and messages',
    noDataRerender: true,
    render: function (root, ctx) {
      pageRoot = root;
      var pr = ctx.params || {};
      if (ctx.fresh) {
        if (pr.tab) st.tab = pr.tab === 'problems' ? 'damage' : pr.tab;
        st.hl = pr.bookingId || null; st.scrollHl = !!pr.bookingId;
        if (pr.bookingId) st.tab = 'guests';
      }
      root.innerHTML = '<div class="pg-ga"></div>';
      var w = wrapEl();
      w.addEventListener('click', onClick);
      w.addEventListener('input', onInput);
      w.addEventListener('change', onChange);
      draw();
      ctx.setActions(canCode() && writable() ? '<button type="button" class="btn btn-ghost btn-sm" data-ga-top="lock">' + ic('key') + '<span>Change door code</span></button>' : '');
      O.$$('[data-ga-top]', ctx.actionsEl).forEach(function (bt) { bt.onclick = function () { O.lock.change(st.hl ? { bookingId: st.hl } : {}); }; });
      ctx.on('data', function () { if (quiet || typing() || O.state.page !== 'guestapp') return; draw(); });
      ctx.on('tick', function () { if (st.tab === 'guests' && !typing()) draw(); });
      if (ctx.fresh && pr.preview && pr.bookingId) { var b = D.booking(pr.bookingId); if (b) openPreview(b); }
    }
  });
})();
