// Everything the site says about Kozi in one place. Facts come from the Vortex KLCC listing pack
// (/mnt/project-files/otto-listings/vortex-klcc-listings.md); keep claims here true and checkable.
import type { ImageMetadata } from 'astro';

const all = import.meta.glob<{ default: ImageMetadata }>('/src/assets/photos/**/*.jpg', { eager: true });
export function photo(key: string): ImageMetadata {
  const hit = all[`/src/assets/photos/${key}.jpg`];
  if (!hit) throw new Error(`No photo ${key}`);
  return hit.default;
}

export const BRAND = {
  name: 'Kozi',
  tagline: 'Exceptional spaces. Memorable stays.',
  email: 'hello@staykozi.com', // the only contact shown until Arnob confirms a phone and WhatsApp number
  instagram: 'https://www.instagram.com/kozimalaysia/',
  facebook: 'https://www.facebook.com/profile.php?id=61595749560838',
  company: 'Orbique Global Sdn. Bhd.',
  // the two sites' addresses; a preview build points them at its own preview sites instead
  com: (import.meta.env.PUBLIC_COM_URL as string | undefined) || 'https://www.staykozi.com',
  my: (import.meta.env.PUBLIC_MY_URL as string | undefined) || 'https://www.staykozi.my',
};

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

export type Suite = {
  id: 'standard' | 'boutique' | 'premium';
  name: string; levels: string; line: string; story: string;
  views: View[]; highlights: string[];
  photos: { key: string; alt: string }[];
  hasPhotos: boolean;
};

export const SUITES: Suite[] = [
  {
    id: 'boutique', name: 'Boutique Suite', levels: 'Level 43',
    line: 'Wake up to the Petronas Twin Towers, with a study and a marble table for four.',
    story: 'Warm gold and neutral tones, floor-length drapes and a living room that looks straight across the city to the Twin Towers. The second bedroom has a queen and a single, and the study is a quiet corner for a call home.',
    views: ['petronas', 'kl-tower'], highlights: ['Twin Towers view', 'Study', 'Marble dining table'],
    photos: [
      { key: 'boutique/02-dining-and-living', alt: 'Dining table and living room in the Boutique Suite' },
      { key: 'boutique/10-klcc-night-view', alt: 'A Petronas tower lit up at dusk, seen from the Boutique Suite' },
      { key: 'boutique/01-living-room', alt: 'Living room with floor-to-ceiling windows' },
      { key: 'boutique/03-bedroom-1-view', alt: 'Main bedroom with a city view' },
      { key: 'boutique/04-bedroom-2', alt: 'Second bedroom' },
      { key: 'boutique/06-tv-klcc-view', alt: 'Living room with the Twin Towers outside' },
      { key: 'boutique/08-kitchen', alt: 'The kitchen' },
      { key: 'boutique/07-bathroom', alt: 'Bathroom with a walk-in shower' },
      { key: 'boutique/09-coffee-tea', alt: 'Coffee and tea tray with a kettle' },
      { key: 'boutique/05-bedroom-window-view', alt: 'The city by day from a bedroom window' },
    ],
    hasPhotos: true,
  },
  {
    id: 'premium', name: 'Premium Suite', levels: 'Levels 26 and 47',
    line: "Our best-finished suites, with the city's landmarks outside the window.",
    story: 'Panelled feature walls, soft lighting, hotel-quality white linen and floor-to-ceiling windows that frame the Twin Towers, KL Tower or Merdeka 118, depending on the suite.',
    views: ['petronas', 'kl-tower', 'merdeka'], highlights: ['Landmark views', 'Dressing desk', 'Dining for four'],
    photos: [
      { key: 'premium-a/01-dining-and-living', alt: 'Dining table under rattan lamps in a Premium Suite' },
      { key: 'premium-b/06-bed-klcc-view', alt: 'Bed facing the Petronas Twin Towers by day' },
      { key: 'premium-a/10-kl-tower-view-night', alt: 'KL Tower lit blue at dusk, seen from a Premium bedroom' },
      { key: 'premium-a/08-master-bedroom-merdeka-118-night', alt: 'Main bedroom at dusk with Merdeka 118 outside' },
      { key: 'premium-b/03-tv-klcc-night', alt: 'Living room at dusk with a Petronas tower outside' },
      { key: 'premium-a/03-dining-living-daylight', alt: 'Dining and living room in daylight' },
      { key: 'premium-b/07-master-bedroom-wide', alt: 'Main bedroom' },
      { key: 'premium-b/09-dressing-desk', alt: 'Dressing desk' },
      { key: 'premium-a/05-twin-bedroom-day', alt: 'Second bedroom in daylight' },
      { key: 'premium-b/10-klcc-window-view', alt: 'The Petronas Twin Towers by day from a Premium window' },
    ],
    hasPhotos: true,
  },
  {
    id: 'standard', name: 'Standard Suite', levels: 'Level 41',
    line: 'Two bedrooms, two bathrooms and a full kitchen on the 41st floor, at our simplest price.',
    story: 'Everything a family needs for a city stay: two bedrooms, two bathrooms, a full kitchen and your own washing machine, on the 41st floor of Vortex.',
    views: [], highlights: ['Two bathrooms', 'Full kitchen', 'Washing machine'],
    photos: [{ key: 'building/Vortex-KLCC-street-view-2025', alt: 'Vortex Suites KLCC from the street' }],
    hasPhotos: false,
  },
];

// What is around Vortex (from the listing pack). Walking times are not measured yet, so none are given.
export const NEARBY = [
  { name: 'Pavilion KL', what: 'Shopping and food halls' },
  { name: 'Petronas Twin Towers and KLCC Park', what: 'The towers, Suria KLCC and the park' },
  { name: 'Jalan Alor', what: 'Street food, best after dark' },
  { name: 'Changkat Bukit Bintang', what: 'Bars and late dinners' },
  { name: 'Raja Chulan monorail', what: 'The rest of the city' },
];

// Countries with a Kozi site. staykozi.com lists them, and each country's site has its cities.
export const COUNTRIES = [
  { id: 'my', name: 'Malaysia', site: BRAND.my, domain: 'staykozi.my', languages: ['English', 'Bahasa Malaysia', 'Bahasa Indonesia'], currency: 'Malaysian ringgit (RM)' },
];

// Where Kozi is. Each city lists its buildings; the search and the global site read this.
export const DESTINATIONS = [
  { id: 'kuala-lumpur', city: 'Kuala Lumpur', country: 'Malaysia', countryId: 'my', path: '/kuala-lumpur/', geo: { lat: 3.151, lon: 101.706 }, tz: 'Asia/Kuala_Lumpur',
    buildings: [{ id: 'vortex-klcc', name: 'Kozi @ Vortex KLCC', area: 'Golden Triangle, between KLCC and Bukit Bintang' }] },
];

// Real photos of each landmark from our windows (the Standard suite has none yet).
export const VIEW_PHOTOS: Record<Exclude<View, 'city'>, { key: string; alt: string; from: string; suites: Suite['id'][] }[]> = {
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
  { icon: 'key', title: 'Self check-in', text: 'Your door code arrives 30 minutes before 3:00 pm.' },
  { icon: 'chat', title: 'A team that answers', text: 'Message us in English, Bahasa Malaysia or Bahasa Indonesia.' },
];
export const POLICIES = {
  cancel: 'Flexible rates are free to cancel until 7 days before arrival.',
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

export const GUIDES = [
  { slug: 'mdac-malaysia-digital-arrival-card', tag: 'Arrival', title: 'The MDAC arrival card, step by step', line: 'What to fill in before you land in Malaysia, and how to spot the fake sites.', photo: 'premium-b/10-klcc-window-view' },
  { slug: 'klia-to-kuala-lumpur-city-centre', tag: 'Getting here', title: 'KLIA to the city centre', line: 'Train, Grab or taxi: what each costs and when to pick it.', photo: 'boutique/05-bedroom-window-view' },
  { slug: 'halal-food-near-klcc', tag: 'Food', title: 'Eating halal near KLCC', line: 'How to read the signs, and where to start near Vortex KLCC.', photo: 'premium-a/01-dining-and-living' },
];
