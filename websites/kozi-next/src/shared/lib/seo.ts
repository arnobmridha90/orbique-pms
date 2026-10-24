// Structured data shared by many pages. Facts come from data/kozi.ts so every page says the same thing.
import { BRAND, PROPERTY, SUITES, type Suite } from '@shared/data/kozi';

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

export const lodgingLd = {
  '@context': 'https://schema.org', '@type': 'LodgingBusiness', '@id': `${BRAND.my}${PROPERTY.path}#kozi`,
  name: PROPERTY.name, url: `${BRAND.my}${PROPERTY.path}`, email: BRAND.email, slogan: BRAND.tagline,
  description: 'Two-bedroom suites with two bathrooms and a full kitchen at Vortex Suites KLCC, in the Golden Triangle of Kuala Lumpur between KLCC and Bukit Bintang.',
  address: { '@type': 'PostalAddress', streetAddress: 'Vortex Suites KLCC, 56 Jalan Sultan Ismail', addressLocality: 'Kuala Lumpur', postalCode: '50250', addressCountry: 'MY' },
  geo: { '@type': 'GeoCoordinates', latitude: PROPERTY.geo.lat, longitude: PROPERTY.geo.lon },
  checkinTime: '15:00', checkoutTime: '11:00', knowsLanguage: ['en', 'ms', 'id'],
  amenityFeature: ['Kitchen', 'Washing machine', 'Wi-Fi', 'Air conditioning', 'Self check-in'].map((name) => ({ '@type': 'LocationFeatureSpecification', name, value: true })),
  containsPlace: SUITES.map((s) => ({ '@id': suiteId(s) })),
  parentOrganization: { '@id': `${BRAND.com}/#org` },
  sameAs: [BRAND.instagram, BRAND.facebook],
};

export function suiteId(s: Suite) { return `${BRAND.my}${PROPERTY.path}${s.id}/#suite`; }

export function suiteLd(s: Suite, image?: string) {
  return {
    '@context': 'https://schema.org', '@type': 'Suite', '@id': suiteId(s), name: `${s.name}, ${PROPERTY.name}`,
    url: `${BRAND.my}${PROPERTY.path}${s.id}/`, description: `${s.line} ${s.story}`,
    numberOfRooms: 2, numberOfBedrooms: 2, numberOfBathroomsTotal: 2,
    occupancy: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 5, unitText: 'guests (the fifth on an extra bed)' },
    bed: [{ '@type': 'BedDetails', numberOfBeds: 2, typeOfBed: 'Queen' }, { '@type': 'BedDetails', numberOfBeds: 1, typeOfBed: 'Single' }],
    ...(image ? { image } : {}),
    containedInPlace: { '@id': lodgingLd['@id'] },
  };
}
