// Structured data shared by many pages. Brand facts come from data/kozi.ts and the buildings and suites from the
// content (lib/content.ts), so every page says the same thing.
import { BRAND, BUILDING_EXTRAS, PROPERTY } from '@shared/data/kozi';
import { buildingPath, suitePath, type Building, type Suite } from './content';

export type Crumb = { name: string; path?: string };

export function crumbsLd(site: string, items: Crumb[]) {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, ...(c.path ? { item: `${site}${c.path}` } : {}) })),
  };
}

export const orgLd = {
  '@context': 'https://schema.org', '@type': 'Organization', '@id': `${BRAND.com}/#org`, name: 'Kozi', url: `${BRAND.com}/`,
  logo: `${BRAND.com}/apple-touch-icon.png`, email: BRAND.email, slogan: BRAND.tagline,
  parentOrganization: { '@type': 'Organization', name: BRAND.company }, sameAs: [BRAND.instagram, BRAND.facebook],
};

/** '3:00 pm' as schema.org wants it, '15:00' (undefined when it can't be read). */
function time24(t: string) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(t.trim());
  if (!m) return undefined;
  let h = Number(m[1]) % 12;
  if (!m[3]) h = Number(m[1]);
  else if (m[3].toLowerCase() === 'pm') h += 12;
  return h < 24 ? `${String(h).padStart(2, '0')}:${m[2] ?? '00'}` : undefined;
}

export const lodgingId = (b: Building) => `${BRAND.my}${buildingPath(b)}#kozi`;
export const suiteId = (b: Building, s: Suite) => `${BRAND.my}${suitePath(b, s)}#suite`;

export function lodgingLd(b: Building, suites: Suite[]) {
  const vortex = b.id === PROPERTY.id;
  return {
    '@context': 'https://schema.org', '@type': 'LodgingBusiness', '@id': lodgingId(b),
    name: b.name, url: `${BRAND.my}${buildingPath(b)}`, email: BRAND.email, slogan: BRAND.tagline,
    description: b.intro || `${b.name}, ${b.area || b.city}.`,
    address: vortex
      ? { '@type': 'PostalAddress', streetAddress: 'Vortex Suites KLCC, 56 Jalan Sultan Ismail', addressLocality: 'Kuala Lumpur', postalCode: '50250', addressCountry: 'MY' }
      : { '@type': 'PostalAddress', streetAddress: `${b.building}, ${b.address}`, addressLocality: b.city, addressCountry: 'MY' },
    ...(vortex ? { geo: { '@type': 'GeoCoordinates', latitude: PROPERTY.geo.lat, longitude: PROPERTY.geo.lon } } : {}),
    checkinTime: time24(b.checkIn), checkoutTime: time24(b.checkOut), knowsLanguage: ['en'],
    amenityFeature: ['Kitchen', 'Washing machine', 'Wi-Fi', 'Air conditioning'].map((name) => ({ '@type': 'LocationFeatureSpecification', name, value: true })),
    containsPlace: suites.map((s) => ({ '@id': suiteId(b, s) })),
    parentOrganization: { '@id': `${BRAND.com}/#org` },
    sameAs: [BRAND.instagram, BRAND.facebook],
  };
}

export function suiteLd(b: Building, s: Suite, image?: string) {
  const beds = BUILDING_EXTRAS[b.id]?.beds && s.bedrooms === 2;
  return {
    '@context': 'https://schema.org', '@type': 'Suite', '@id': suiteId(b, s), name: `${s.name}, ${b.name}`,
    url: `${BRAND.my}${suitePath(b, s)}`, description: [s.line, s.story].filter(Boolean).join(' '),
    numberOfRooms: s.bedrooms, numberOfBedrooms: s.bedrooms, numberOfBathroomsTotal: s.bathrooms,
    occupancy: { '@type': 'QuantitativeValue', minValue: 1, maxValue: s.sleeps + (s.extraBed ? 1 : 0), ...(s.extraBed ? { unitText: 'guests (the last on an extra bed)' } : {}) },
    ...(beds ? { bed: [{ '@type': 'BedDetails', numberOfBeds: 2, typeOfBed: 'Queen' }, { '@type': 'BedDetails', numberOfBeds: 1, typeOfBed: 'Single' }] } : {}),
    ...(image ? { image } : {}),
    containedInPlace: { '@id': lodgingId(b) },
  };
}
