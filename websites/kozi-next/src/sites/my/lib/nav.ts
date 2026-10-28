// Where the header, the footer and the city's pin for our tower send people to see the suites. On a page made on
// request they follow the content, so a building renamed, moved or hidden in Orbique's panel takes its links with it.
// A page made at build (guides, contact, credits) doesn't see later changes to the content, so it links to /stays/,
// which is always there and lists every suite.
import { PROPERTY } from '@shared/data/kozi';
import { buildingPath, cityPath, inKL, type Site } from '@shared/lib/content';

type Link = { name: string; href: string };
export type Links = { suites: string; cities: Link[]; buildings: Link[]; tower: Link };

export function links(site?: Site): Links {
  if (!site) return { suites: '/stays/', cities: [{ name: 'Kuala Lumpur', href: '/kuala-lumpur/' }], buildings: [], tower: { name: PROPERTY.name, href: '/stays/' } };
  const bs = site.buildings;
  // the tower in the 3D city is Vortex: our building there, even with a new slug, while it is our only one in KL
  const kl = bs.filter(inKL);
  const tower = bs.find((b) => b.id === PROPERTY.id && inKL(b)) ?? (kl.length === 1 ? kl[0] : undefined);
  return {
    suites: bs.length === 1 ? buildingPath(bs[0]) : '/stays/',
    cities: site.cities.map((c) => ({ name: c.name, href: cityPath(c.id) })),
    buildings: bs.map((b) => ({ name: b.name, href: buildingPath(b) })),
    tower: tower ? { name: tower.name, href: buildingPath(tower) } : { name: PROPERTY.name, href: '/stays/' },
  };
}
