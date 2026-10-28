// What the site can say about the views from the content as it is now: the real photos of each landmark from our
// windows (data/kozi.ts VIEW_PHOTOS), but only while a suite on the site still shows that photo, so a photo taken off
// a suite in Orbique's panel leaves the home page and the view finder too; and the suites whose windows face it.
import { LANDMARKS, VIEW_PHOTOS } from '@shared/data/kozi';
import { inKL, type Building, type Photo, type Site, type Suite } from '@shared/lib/content';

export type Shot = { photo: Photo; from: string; suite: Suite; building: Building };
export type Mark = (typeof LANDMARKS)[number] & { shots: Shot[]; suites: { s: Suite; b: Building }[] };

export function landmarks(site: Site): Mark[] {
  const kl = site.suites.filter((s) => inKL(site.buildingOf(s)));
  return LANDMARKS.map((l) => {
    const shots: Shot[] = [];
    for (const v of VIEW_PHOTOS[l.id]) {
      for (const s of kl) {
        const p = s.photos.find((x) => x.kind === 'builtin' && x.key === v.key);
        if (!p) continue;
        // the alt is the content's own (the panel edits it, and it describes the photo wherever it was put); our
        // caption names the suite it was taken in only while it is still on that suite
        shots.push({ photo: p, from: v.suites.includes(s.id) ? v.from : `From the ${s.name}`, suite: s, building: site.buildingOf(s) });
        break;
      }
    }
    return { ...l, shots, suites: kl.filter((s) => s.views.includes(l.id)).map((s) => ({ s, b: site.buildingOf(s) })) };
  });
}

/** The floors a suite is on, from its levels ('Levels 26 and 47' is [26, 47]), for lighting them on the tower. */
export const levelsOf = (s: Suite) => [...s.levels.matchAll(/\d{1,2}/g)].map((m) => Number(m[0])).filter((n) => n > 0 && n <= 58);
