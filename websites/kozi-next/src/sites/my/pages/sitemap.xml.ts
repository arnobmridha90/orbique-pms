// The sitemap, made on request from the content, so a suite added in Orbique is listed as soon as it is published.
// The addresses are the canonical ones, as in each page's canonical link. Pages that carry a noindex tag stay out:
// checkout, the thank-you page, and a suite with no photos of its own yet. Building and suite pages list their photos
// too (Google's image sitemap), so they can show in Google Images.
import type { APIRoute } from 'astro';
import { GUIDE_PAGES } from '@shared/data/guides';
import { BRAND } from '@shared/data/kozi';
import { buildingPath, cityPath, getContent, photoAbs, suitePath, type Photo } from '@shared/lib/content';

export const prerender = false;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const GET: APIRoute = async (ctx) => {
  const site = await getContent(ctx);
  const pages: { path: string; photos?: Photo[] }[] = [
    { path: '/' }, { path: '/views/' }, { path: '/stays/' },
    ...site.cities.map((c) => ({ path: cityPath(c.id) })),
    ...site.buildings.map((b) => ({ path: buildingPath(b), photos: b.photos })),
    ...site.suites.filter((s) => s.photos.length).map((s) => ({ path: suitePath(site.buildingOf(s), s), photos: s.photos })),
    { path: '/guides/' }, ...GUIDE_PAGES.map((g) => ({ path: `/guides/${g.slug}/` })),
    { path: '/contact/' }, { path: '/credits/' },
  ];
  const url = ({ path, photos = [] }: (typeof pages)[number]) => `  <url><loc>${esc(new URL(path, ctx.site).href)}</loc>${
    photos.map((p) => `<image:image><image:loc>${esc(photoAbs(p, BRAND.my))}</image:loc></image:image>`).join('')}</url>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${
    pages.map(url).join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
