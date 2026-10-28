// Kozi's website content as the site's /content.json serves it (websites/kozi-next/src/shared/data/kozi.ts), for the
// website content tests (tests/site-content.test.mjs, tests/site.api.test.mjs, tests/livesite_e2e.mjs).
const P = (key, alt, w = 2400, h = 1600) => ({ id: 'b-' + key.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50), kind: 'builtin', key, widths: [640, 1280, 2400], w, h, alt });

export function koziContent() {
  return {
    version: 1,
    buildings: [{
      id: 'vortex-klcc', cityId: 'kuala-lumpur', city: 'Kuala Lumpur', name: 'Kozi @ Vortex KLCC', building: 'Vortex Suites KLCC',
      address: '56 Jalan Sultan Ismail, 50250 Kuala Lumpur', area: 'Golden Triangle, between KLCC and Bukit Bintang',
      intro: 'Two-bedroom suites high above the Golden Triangle, between KLCC and Bukit Bintang.',
      checkIn: '3:00 pm', checkOut: '11:00 am',
      photos: [P('building/Vortex-KLCC-street-view-2025', 'Vortex Suites KLCC from the street', 1600, 2400)], visible: true
    }],
    suites: [
      {
        id: 'standard', buildingId: 'vortex-klcc', name: 'Standard Suite', levels: 'Level 41',
        line: 'Two bedrooms, two bathrooms and a full kitchen on the 41st floor, at our simplest price.',
        story: 'Everything a family needs for a city stay: two bedrooms, two bathrooms, a full kitchen and your own washing machine.',
        highlights: ['Two bathrooms', 'Full kitchen', 'Washing machine'], views: [], bedrooms: 2, bathrooms: 2, sleeps: 4, extraBed: true,
        bookType: 'standard', photos: [], visible: true
      },
      {
        id: 'boutique', buildingId: 'vortex-klcc', name: 'Boutique Suite', levels: 'Level 43',
        line: 'Wake up to the Petronas Twin Towers, with a study and a marble table for four.',
        story: 'Warm gold and neutral tones, floor-length drapes and a living room that looks straight across the city to the Twin Towers.',
        highlights: ['Twin Towers view', 'Study', 'Marble dining table'], views: ['petronas', 'kl-tower'], bedrooms: 2, bathrooms: 2, sleeps: 4, extraBed: true,
        bookType: 'boutique',
        photos: [
          P('boutique/02-dining-and-living', 'Dining table and living room in the Boutique Suite'),
          P('boutique/10-klcc-night-view', 'A Petronas tower lit up at dusk, seen from the Boutique Suite'),
          P('boutique/01-living-room', 'Living room with floor-to-ceiling windows')
        ],
        visible: true
      },
      {
        id: 'premium', buildingId: 'vortex-klcc', name: 'Premium Suite', levels: 'Levels 26 and 47',
        line: "Our best-finished suites, with the city's landmarks outside the window.",
        story: 'Panelled feature walls, soft lighting, hotel-quality white linen and floor-to-ceiling windows.',
        highlights: ['Landmark views', 'Dressing desk', 'Dining for four'], views: ['petronas', 'kl-tower', 'merdeka'], bedrooms: 2, bathrooms: 2, sleeps: 4, extraBed: true,
        bookType: 'premium',
        photos: [
          P('premium-a/01-dining-and-living', 'Dining table under rattan lamps in a Premium Suite'),
          P('premium-b/06-bed-klcc-view', 'Bed facing the Petronas Twin Towers by day')
        ],
        visible: true
      }
    ]
  };
}

/* /content.json: the default content plus every bundled photo */
export function koziContentJson() {
  const c = koziContent();
  const builtinPhotos = [
    ['boutique/01-living-room', 'Living room with floor-to-ceiling windows'], ['boutique/02-dining-and-living', 'Dining table and living room in the Boutique Suite'],
    ['boutique/04-bedroom-2', 'Second bedroom'], ['boutique/07-bathroom', 'Bathroom with a walk-in shower'], ['boutique/10-klcc-night-view', 'A Petronas tower lit up at dusk'],
    ['premium-a/01-dining-and-living', 'Dining table under rattan lamps'], ['premium-b/06-bed-klcc-view', 'Bed facing the Petronas Twin Towers by day'],
    ['premium-b/09-dressing-desk', 'Dressing desk'], ['building/Vortex-KLCC-street-view-2025', 'Vortex Suites KLCC from the street']
  ].map(([key, alt]) => ({ key, alt, w: 2400, h: 1600, widths: [640, 1280, 2400] }));
  return Object.assign(c, { builtinPhotos });
}
