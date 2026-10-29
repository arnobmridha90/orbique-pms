// Everything the site says about Kozi in one place. Facts come from the Vortex KLCC listing pack
// (/mnt/project-files/otto-listings/vortex-klcc-listings.md); keep claims here true and checkable.
export const BRAND = {
  name: 'Kozi',
  tagline: 'Exceptional spaces. Memorable stays.',
  email: 'hello@staykozi.com', // the contact shown everywhere; the WhatsApp number guests book on comes from Orbique and shows only on /book/
  instagram: 'https://www.instagram.com/kozimalaysia/',
  facebook: 'https://www.facebook.com/profile.php?id=61595749560838',
  company: 'Orbique Global Sdn. Bhd.',
  // the two sites' addresses; a preview build points them at its own preview sites instead
  com: (import.meta.env.PUBLIC_COM_URL as string | undefined) || 'https://www.staykozi.com',
  my: (import.meta.env.PUBLIC_MY_URL as string | undefined) || 'https://www.staykozi.my',
};

// Whether the global site is public. Until staykozi.com is attached, PUBLIC_COM_URL is its hidden preview
// (*.vercel.app, noindex), so the Malaysia site neither links to it nor names it in its hreflang or structured data.
export const COM_LIVE = !/\.vercel\.app$/i.test(new URL(BRAND.com).hostname);
/** The address that stands for Kozi as a whole: staykozi.com once it is public, the Malaysia site until then. */
export const BRAND_HOME = COM_LIVE ? BRAND.com : BRAND.my;

// Vortex KLCC as the fixed parts of the site know it (the footer, the confirmation page, the guides). The building's
// own pages, and every list of suites, read the content instead.
export const PROPERTY = {
  id: 'vortex-klcc',
  name: 'Kozi @ Vortex KLCC',
  building: 'Vortex Suites KLCC',
  address: '56 Jalan Sultan Ismail, 50250 Kuala Lumpur',
  city: 'Kuala Lumpur',
  geo: { lat: 3.151, lon: 101.706 },
  checkIn: '3:00 pm', checkOut: '11:00 am',
  path: '/kuala-lumpur/vortex-klcc/',
};

export type View = 'petronas' | 'kl-tower' | 'merdeka' | 'city';
export const VIEWS: Record<View, { name: string; short: string }> = {
  petronas: { name: 'Petronas Twin Towers', short: 'Twin Towers' },
  'kl-tower': { name: 'KL Tower', short: 'KL Tower' },
  merdeka: { name: 'Merdeka 118', short: 'Merdeka 118' },
  city: { name: 'City skyline', short: 'City' },
};

// The buildings and suites themselves are content: Orbique's "Live website" panel edits them, and data/content.json
// holds the bundled copy (see lib/content.ts). What follows is what stays the same whatever the content says.

// What is around Vortex (from the listing pack). Walking times are not measured yet, so none are given.
export const NEARBY = [
  { name: 'Pavilion KL', what: 'Shopping and food halls' },
  { name: 'Petronas Twin Towers and KLCC Park', what: 'The towers, Suria KLCC and the park' },
  { name: 'Jalan Alor', what: 'Street food, best after dark' },
  { name: 'Changkat Bukit Bintang', what: 'Bars and late dinners' },
  { name: 'Raja Chulan monorail', what: 'The rest of the city' },
];

// What only Vortex KLCC's pages say, on top of its content: the building's facts and its street. A building added in
// Orbique gets the plain version of these pages (its area, intro, address, check-in and check-out).
export type BuildingExtra = {
  eyebrow: string; lede: string; description: string; pin: string; maps: string;
  chapter: string; // the home page's words about the building, beside the tower in the 3D city
  about: [string, string]; facts: { icon: string; k: string; v: string }[];
  beds: boolean; // every two-bedroom suite here has a queen room and a room with a queen and a single
  near: { eyebrow: string; title: [string, string]; text: string; list: { name: string; what: string }[] };
};
export const BUILDING_EXTRAS: Record<string, BuildingExtra> = {
  'vortex-klcc': {
    eyebrow: 'Kuala Lumpur · Golden Triangle',
    lede: 'Two-bedroom suites with two bathrooms and a full kitchen at Vortex Suites KLCC, on Jalan Sultan Ismail between KLCC and Bukit Bintang.',
    description: 'Kozi @ Vortex KLCC: two-bedroom suites with two bathrooms and a full kitchen at Vortex Suites KLCC on Jalan Sultan Ismail, between KLCC and Bukit Bintang. See live prices and book direct.',
    pin: 'Our suites, levels 26 to 47',
    chapter: 'Our suites are in Vortex KLCC, the curved glass tower on Jalan Sultan Ismail. The Petronas Twin Towers, KL Tower and Merdeka 118 all share its skyline.',
    maps: 'Vortex Suites KLCC, Jalan Sultan Ismail, Kuala Lumpur',
    about: ['The rounded glass tower on', 'Jalan Sultan Ismail.'],
    beds: true,
    facts: [
      { icon: 'shield', k: 'Security', v: '24-hour security in the building.' },
      { icon: 'card', k: 'Pool and gym', v: 'In the building, for a fee. They are not included in the price of a stay.' },
      { icon: 'train', k: 'Getting around', v: 'Raja Chulan monorail station is nearby, and Grab rides are easy to get at any hour.' },
    ],
    near: {
      eyebrow: 'Around Vortex', title: ['Between KLCC and', 'Bukit Bintang.'],
      text: 'Walk to Pavilion KL for shopping, to the Petronas Twin Towers and KLCC Park, and to the street food of Jalan Alor and the bars of Changkat Bukit Bintang.',
      list: NEARBY,
    },
  },
};

// Countries with a Kozi site. staykozi.com lists them, and each country's site has its cities.
export const COUNTRIES = [
  { id: 'my', name: 'Malaysia', site: BRAND.my, domain: 'staykozi.my', languages: ['English'], currency: 'Malaysian ringgit (RM)' },
];

// Where Kozi is. Each city lists its buildings; the search and the global site read this.
export const DESTINATIONS = [
  { id: 'kuala-lumpur', city: 'Kuala Lumpur', country: 'Malaysia', countryId: 'my', path: '/kuala-lumpur/', geo: { lat: 3.151, lon: 101.706 }, tz: 'Asia/Kuala_Lumpur',
    buildings: [{ id: 'vortex-klcc', name: 'Kozi @ Vortex KLCC', area: 'Golden Triangle, between KLCC and Bukit Bintang' }] },
];

// Real photos of each landmark from our windows, by the suite (in content.json) they were taken from.
// The Standard suite has none yet.
export const VIEW_PHOTOS: Record<Exclude<View, 'city'>, { key: string; alt: string; from: string; suites: string[] }[]> = {
  petronas: [
    { key: 'boutique/10-klcc-night-view', alt: 'A Petronas tower lit up at dusk above the city, seen from the Boutique Suite', from: 'From the Boutique Suite, Level 43', suites: ['boutique'] },
    { key: 'premium-b/10-klcc-window-view', alt: 'The Petronas Twin Towers by day through a Premium Suite window', from: 'From a Premium Suite', suites: ['premium'] },
  ],
  'kl-tower': [
    { key: 'premium-a/10-kl-tower-view-night', alt: 'KL Tower lit blue at dusk, seen from a Premium Suite bedroom', from: 'From a Premium Suite', suites: ['premium'] },
  ],
  merdeka: [
    { key: 'premium-a/08-master-bedroom-merdeka-118-night', alt: 'Merdeka 118 at dusk outside a Premium Suite bedroom window', from: 'From a Premium Suite', suites: ['premium'] },
  ],
};
export const LANDMARKS: { id: Exclude<View, 'city'>; name: string; line: string }[] = [
  { id: 'petronas', name: 'Petronas Twin Towers', line: 'The twin towers of KLCC, lit silver all night.' },
  { id: 'kl-tower', name: 'KL Tower', line: 'The telecom tower on Bukit Nanas, with a lit ring at the top.' },
  { id: 'merdeka', name: 'Merdeka 118', line: "The world's second-tallest building, with its long spire." },
];

export const LAYOUT = ['2 bedrooms', '2 bathrooms', 'Sleeps 4', 'Extra bed for a 5th guest'];
export const AMENITIES = [
  { icon: 'bed', title: 'Two real bedrooms', text: 'A queen room, plus a room with a queen and a single.' },
  { icon: 'kitchen', title: 'A full kitchen', text: 'Fridge, microwave, induction hob, kettle and cookware.' },
  { icon: 'washer', title: 'Washer in every suite', text: 'Pack light. Iron and hair dryer too.' },
  { icon: 'wifi', title: 'Wi-Fi and smart TV', text: 'Air conditioning in every room.' },
  { icon: 'chat', title: 'A team that answers', text: 'Email us before and during your stay, and a real person replies.' },
];
export const POLICIES = {
  cancel: 'Free cancellation until 7 days before arrival.',
  extraBed: 'An extra bed for a 5th guest is RM60 a night.',
  tax: 'Malaysia charges non-Malaysian guests a tourism tax of RM10 per room per night.',
  rules: 'No smoking, no parties. Quiet hours 10 pm to 8 am. ID for every guest before arrival.',
  paid: 'The building pool and gym are available for a fee.',
};

// Photos we did not take, with the credit their licence asks for. The credits page lists them all,
// and the photo viewer shows the credit under each one.
export const CREDITS: Record<string, { title: string; by: string; source: string; taken: string }> = {
  'building/Vortex-KLCC-street-view-2025': { title: 'Vortex Tower', by: 'Vano111ru', source: 'https://commons.wikimedia.org/wiki/File:Vortex_Tower.jpg', taken: '14 December 2025' },
  'building/Vortex-KLCC-skyline-view-2017': { title: 'Vortex Suites KLCC, Kuala Lumpur', by: 'Renek78', source: 'https://commons.wikimedia.org/wiki/File:Vortex_Suites_KLCC,_Kuala_Lumpur.jpg', taken: '2 December 2017' },
};
export const CC_BY_SA = { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' };
// The 3D city on staykozi.my is built from open map data; its licences ask for this credit (footer and /credits/).
export const MAP_CREDIT = '3D city from map data: © OpenStreetMap contributors (ODbL), Overture Maps Foundation, Google Open Buildings (CC BY 4.0), Microsoft Building Footprints (ODbL).';
export const MAP_SOURCES = [
  { name: 'OpenStreetMap contributors', licence: 'ODbL', url: 'https://www.openstreetmap.org/copyright' },
  { name: 'Overture Maps Foundation', licence: 'ODbL', url: 'https://docs.overturemaps.org/attribution/' },
  { name: 'Google Open Buildings', licence: 'CC BY 4.0', url: 'https://sites.research.google/gr/open-buildings/' },
  { name: 'Microsoft Building Footprints', licence: 'ODbL', url: 'https://github.com/microsoft/GlobalMLBuildingFootprints' },
];

export const GUIDES = [
  { slug: 'mdac-malaysia-digital-arrival-card', tag: 'Arrival', title: 'The MDAC arrival card, step by step', line: 'What to fill in before you land in Malaysia, and how to spot the fake sites.', photo: 'premium-b/10-klcc-window-view' },
  { slug: 'klia-to-kuala-lumpur-city-centre', tag: 'Getting here', title: 'KLIA to the city centre', line: 'Train, Grab or taxi: what each costs and when to pick it.', photo: 'boutique/05-bedroom-window-view' },
  { slug: 'halal-food-near-klcc', tag: 'Food', title: 'Eating halal near KLCC', line: 'How to read the signs, and where to start near Vortex KLCC.', photo: 'premium-a/01-dining-and-living' },
];
