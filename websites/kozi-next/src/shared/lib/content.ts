// The site's content: buildings, suites and their photos. Orbique's "Live website" panel edits it and publishes it to
// GET /api/public/site?ws=kozi (api/public.js at the root of this repo); the pages read it when they are rendered, and
// Vercel keeps each page for 5 minutes (or until Orbique asks for a fresh one on Publish). When Orbique can't be
// reached, has nothing published yet or PUBLIC_KOZI_API isn't set (test mode), the bundled default content in
// data/content.json stands in. Whatever arrives is checked against the content contract first: anything that doesn't
// fit is dropped, so a bad edit can hide a photo or a suite but never break a page.
import DEFAULT_JSON from '@shared/data/content.json';
import PHOTOS from '@shared/data/photos.json';
import { CREDITS, VIEW_PHOTOS, type View } from '@shared/data/kozi';

export type { View };
export type Photo = {
  id: string; kind: 'builtin' | 'upload';
  key?: string;          // builtin: a photo bundled with the site, in public/photos (scripts/site-photos.mjs)
  base?: string;         // upload: Supabase Storage address without '-<width>.jpg'
  widths: number[]; w: number; h: number; alt: string;
};
export type Building = {
  id: string; cityId: string; city: string; name: string; building: string; address: string; area: string; intro: string;
  checkIn: string; checkOut: string; photos: Photo[]; visible: boolean;
};
export type Suite = {
  id: string; buildingId: string; name: string; levels: string; line: string; story: string; highlights: string[]; views: View[];
  bedrooms: number; bathrooms: number; sleeps: number; extraBed: boolean;
  bookType: string | null; // a booking type in Orbique ('boutique'); null: guests email us to book
  photos: Photo[]; visible: boolean; seoTitle?: string; seoDescription?: string;
};
export type SiteContent = { version: 1; buildings: Building[]; suites: Suite[] };
export type City = { id: string; name: string; buildings: Building[] };

const API = (import.meta.env.PUBLIC_KOZI_API as string | undefined)?.replace(/\/$/, '');
const WS = 'kozi';
const TIMEOUT = 3000;
export const WIDTHS = [640, 1280, 2400];
export const VIEW_IDS: View[] = ['petronas', 'kl-tower', 'merdeka', 'city'];
// uploads are only shown from Kozi's own folder in Orbique's photo store (another workspace sets its own)
export const PHOTO_BASE = (import.meta.env.PUBLIC_PHOTO_BASE as string | undefined) || 'https://wecjkggbczzmlpvokeql.supabase.co/storage/v1/object/public/site-photos/';
// a city or building slug can't take the address of a page the site already has
const RESERVED = new Set(['book', 'booking', 'contact', 'credits', 'guides', 'stays', 'views', 'photos', 'city', 'api', '404', '_astro', '_image', '_server-islands']);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The photos bundled with the site, as scripts/site-photos.mjs made them. */
export const BUILTIN = PHOTOS as Record<string, { w: number; h: number; widths: number[] }>;

// ---------------------------------------------------------------- checking what arrives
type Raw = Record<string, unknown>;
const obj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
/** A trimmed string cut to its longest length; undefined when it isn't a string, or is empty and needed. */
function str(v: unknown, max: number, need = true): string | undefined {
  if (typeof v !== 'string') return need ? undefined : '';
  const s = v.trim().slice(0, max).trim();
  return s || !need ? s : undefined;
}
const slug = (v: unknown) => (typeof v === 'string' && v.length <= 60 && SLUG.test(v) ? v : undefined);
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(20, Math.max(0, Math.round(v))) : undefined);
const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);

function photo(v: unknown): Photo | null {
  if (!obj(v)) return null;
  const id = typeof v.id === 'string' && /^[a-z0-9-]{4,64}$/.test(v.id) ? v.id : null;
  const alt = str(v.alt, 160);
  if (!id || !alt) return null;
  if (v.kind === 'builtin') {
    // the files are ours, so their sizes come from our own list, not from what the content says
    const key = typeof v.key === 'string' ? v.key : '';
    const b = BUILTIN[key];
    return b ? { id, kind: 'builtin', key, widths: [...b.widths], w: b.w, h: b.h, alt } : null;
  }
  if (v.kind !== 'upload' || typeof v.base !== 'string') return null;
  const rest = v.base.startsWith(PHOTO_BASE) ? v.base.slice(PHOTO_BASE.length) : null;
  if (!rest || !/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(rest)) return null;
  const widths = Array.isArray(v.widths) ? [...new Set(v.widths.filter((w): w is number => WIDTHS.includes(w as number)))].sort((a, b) => a - b) : [];
  const w = typeof v.w === 'number' && Number.isInteger(v.w) && v.w > 0 && v.w <= 10000 ? v.w : 0;
  const h = typeof v.h === 'number' && Number.isInteger(v.h) && v.h > 0 && v.h <= 10000 ? v.h : 0;
  return widths.length && w && h ? { id, kind: 'upload', base: v.base, widths, w, h, alt } : null;
}
function photos(v: unknown): Photo[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  return v.slice(0, 40).map(photo).filter((p): p is Photo => !!p && !seen.has(p.id) && !!seen.add(p.id));
}

function building(v: unknown): Building | null {
  if (!obj(v)) return null;
  const id = slug(v.id), cityId = slug(v.cityId);
  const b = {
    city: str(v.city, 80), name: str(v.name, 80), building: str(v.building, 80), address: str(v.address, 200),
    area: str(v.area, 120, false), intro: str(v.intro, 1200, false), checkIn: str(v.checkIn, 20), checkOut: str(v.checkOut, 20),
  };
  if (!id || !cityId || RESERVED.has(cityId) || Object.values(b).some((x) => x === undefined)) return null;
  return { id, cityId, ...(b as Record<keyof typeof b, string>), photos: photos(v.photos), visible: bool(v.visible, true) };
}

function suite(v: unknown, buildings: Set<string>): Suite | null {
  if (!obj(v)) return null;
  const id = slug(v.id), buildingId = typeof v.buildingId === 'string' && buildings.has(v.buildingId) ? v.buildingId : null;
  const s = { name: str(v.name, 80), levels: str(v.levels, 60, false), line: str(v.line, 200, false), story: str(v.story, 1500, false) };
  const n = { bedrooms: count(v.bedrooms), bathrooms: count(v.bathrooms), sleeps: count(v.sleeps) };
  if (!id || !buildingId || Object.values(s).some((x) => x === undefined) || Object.values(n).some((x) => x === undefined)) return null;
  const bookType = typeof v.bookType === 'string' && /^[a-z0-9_-]{1,40}$/.test(v.bookType) ? v.bookType : null;
  const highlights = Array.isArray(v.highlights) ? v.highlights.map((h) => str(h, 40)).filter((h): h is string => !!h).slice(0, 8) : [];
  const views = Array.isArray(v.views) ? VIEW_IDS.filter((x) => (v.views as unknown[]).includes(x)) : [];
  const seoTitle = str(v.seoTitle, 70), seoDescription = str(v.seoDescription, 170);
  return {
    id, buildingId, ...(s as Record<keyof typeof s, string>), ...(n as Record<keyof typeof n, number>), highlights, views,
    extraBed: bool(v.extraBed, false), bookType, photos: photos(v.photos), visible: bool(v.visible, true),
    ...(seoTitle ? { seoTitle } : {}), ...(seoDescription ? { seoDescription } : {}),
  };
}

/** The content as the contract allows it, or null when there is nothing usable (then the bundled content is used). */
export function validate(raw: unknown): SiteContent | null {
  if (!obj(raw) || raw.version !== 1 || !Array.isArray(raw.buildings) || !Array.isArray(raw.suites)) return null;
  const buildings: Building[] = [];
  for (const b of raw.buildings.map(building)) if (b && !buildings.some((x) => x.id === b.id)) buildings.push(b);
  if (!buildings.length) return null;
  const ids = new Set(buildings.map((b) => b.id));
  const suites: Suite[] = [];
  for (const s of raw.suites.map((x) => suite(x, ids))) if (s && !suites.some((x) => x.buildingId === s.buildingId && x.id === s.id)) suites.push(s);
  return { version: 1, buildings, suites };
}

export const DEFAULT_CONTENT = validate(DEFAULT_JSON)!;

// ---------------------------------------------------------------- loading
// the WhatsApp number guests book on, as wa.me wants it (Orbique's sitecontent.waNumber); none: they email us
const WA = /^[1-9]\d{7,14}$/;
type Loaded = { content: SiteContent; live: boolean; whatsapp: string | null };
async function load(): Promise<Loaded> {
  let whatsapp: string | null = null;
  if (!API) return { content: DEFAULT_CONTENT, live: false, whatsapp };
  try {
    const res = await fetch(`${API}/api/public/site?ws=${WS}`, { signal: AbortSignal.timeout(TIMEOUT), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const out = (await res.json()) as { ok?: boolean; content?: unknown; contact?: { whatsapp?: unknown } };
    const wa = out.ok ? out.contact?.whatsapp : null;
    if (typeof wa === 'string' && WA.test(wa)) whatsapp = wa;
    const content = out.ok && out.content ? validate(out.content) : null;
    if (content) return { content, live: true, whatsapp };
    if (out.content) console.warn('[content] Orbique sent content that does not fit the contract; using the bundled content');
  } catch (e) {
    console.warn(`[content] could not reach Orbique (${(e as Error).message}); using the bundled content`);
  }
  return { content: DEFAULT_CONTENT, live: false, whatsapp };
}

/** The content with the lookups the pages need. Hidden buildings, and suites that are hidden or in a hidden building,
 *  are left out everywhere: their pages answer 404. */
export class Site {
  readonly buildings: Building[];
  readonly suites: Suite[];
  readonly cities: City[];
  constructor(readonly content: SiteContent, readonly live = false, readonly whatsapp: string | null = null) {
    this.buildings = content.buildings.filter((b) => b.visible);
    const shown = new Set(this.buildings.map((b) => b.id));
    this.suites = content.suites.filter((s) => s.visible && shown.has(s.buildingId));
    const cities = new Map<string, City>();
    for (const b of this.buildings) {
      if (!cities.has(b.cityId)) cities.set(b.cityId, { id: b.cityId, name: b.city, buildings: [] });
      cities.get(b.cityId)!.buildings.push(b);
    }
    this.cities = [...cities.values()];
  }
  city(id: string | undefined) { return this.cities.find((c) => c.id === id); }
  building(id: string | undefined) { return this.buildings.find((b) => b.id === id); }
  suitesOf(b: Building) { return this.suites.filter((s) => s.buildingId === b.id); }
  buildingOf(s: Suite) { return this.building(s.buildingId)!; }
  /** A page's building and suite from its address, or undefined for an address we don't have (a 404). */
  find(cityId?: string, buildingId?: string, suiteId?: string) {
    const b = this.buildings.find((x) => x.cityId === cityId && x.id === buildingId);
    const s = b && suiteId !== undefined ? this.suites.find((x) => x.buildingId === b.id && x.id === suiteId) : undefined;
    return { building: b, suite: s };
  }
}

const perRequest = new WeakMap<Request, Promise<Site>>();
let atBuild: Promise<Site> | null = null;
/** The content for this page. One fetch per request however many components ask, and one for the whole build for the
 *  pages made ahead of time. */
export function getContent(astro: { request: Request; isPrerendered: boolean }): Promise<Site> {
  const make = () => load().then(({ content, live, whatsapp }) => new Site(content, live, whatsapp));
  if (astro.isPrerendered) return (atBuild ??= make());
  let p = perRequest.get(astro.request);
  if (!p) perRequest.set(astro.request, (p = make()));
  return p;
}

// ---------------------------------------------------------------- addresses
export const cityPath = (cityId: string) => `/${cityId}/`;
export const buildingPath = (b: Building) => `/${b.cityId}/${b.id}/`;
export const suitePath = (b: Building, s: Suite) => `/${b.cityId}/${b.id}/${s.id}/`;
/** The 3D city, the skyline and the landmark views are Kuala Lumpur's; other cities get plain pages with photos. */
export const inKL = (b: Building) => b.cityId === 'kuala-lumpur';

// ---------------------------------------------------------------- photos
/** The file for one stored width. Builtin photos are served by this site, so their address is relative. */
export const photoUrl = (p: Photo, width: number) => (p.kind === 'builtin' ? `/photos/${p.key}-${width}.jpg` : `${p.base}-${width}.jpg`);
/** The largest stored width can be narrower than its name says (a 1080 px photo's "1280" file), so the srcset gives
 *  the browser its true width. */
export const srcset = (p: Photo) => p.widths.map((w) => `${photoUrl(p, w)} ${Math.min(w, p.w)}w`).join(', ');
/** A width to use where only one file goes (src, og:image): 1280 when there is one. */
export const midWidth = (p: Photo) => (p.widths.includes(1280) ? 1280 : p.widths[p.widths.length - 1]);
/** An absolute address for og:image and JSON-LD. */
export const photoAbs = (p: Photo, site: string) => new URL(photoUrl(p, midWidth(p)), `${site}/`).href;

const readable = (key: string) => {
  const s = key.split('/').pop()!.replace(/^\d+-/, '').replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const ALT = new Map<string, string>();
for (const p of [...DEFAULT_CONTENT.buildings.flatMap((b) => b.photos), ...DEFAULT_CONTENT.suites.flatMap((s) => s.photos)]) if (p.key) ALT.set(p.key, p.alt);
for (const shots of Object.values(VIEW_PHOTOS)) for (const s of shots) if (!ALT.has(s.key)) ALT.set(s.key, s.alt);
/** A bundled photo by its key, for the pieces of the site that are not content (the day, the guides). */
export function builtin(key: string, alt = ALT.get(key) ?? CREDITS[key]?.title ?? readable(key)): Photo {
  const b = BUILTIN[key];
  if (!b) throw new Error(`No bundled photo ${key}`);
  return { id: key.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 64), kind: 'builtin', key, widths: [...b.widths], w: b.w, h: b.h, alt };
}
/** Every bundled photo, so the panel in Orbique can add one back after it was taken off a suite. */
export const builtinPhotos = () => Object.entries(BUILTIN).map(([key, b]) => ({ key, w: b.w, h: b.h, alt: builtin(key).alt, widths: b.widths }));

/** The suite's cover: its own first photo, or the building's while it has none of its own. */
export const cover = (s: Suite, b: Building): Photo | undefined => s.photos[0] ?? b.photos[0];
