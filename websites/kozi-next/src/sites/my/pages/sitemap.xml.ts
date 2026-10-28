// The sitemap, made on request from the content, so a suite added in Orbique is listed as soon as it is published.
// The addresses are the canonical ones, as in each page's canonical link. Pages that carry a noindex tag stay out:
// checkout, the thank-you page, and a suite with no photos of its own yet.
import type { APIRoute } from 'astro';
import { GUIDE_PAGES } from '@shared/data/guides';
import { buildingPath, cityPath, getContent, suitePath } from '@shared/lib/content';

export const prerender = false;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const GET: APIRoute = async (ctx) => {
  const site = await getContent(ctx);
  const paths = [
    '/', '/views/', '/stays/',
    ...site.cities.map((c) => cityPath(c.id)),
    ...site.buildings.map(buildingPath),
    ...site.suites.filter((s) => s.photos.length).map((s) => suitePath(site.buildingOf(s), s)),
    '/guides/', ...GUIDE_PAGES.map((g) => `/guides/${g.slug}/`),
    '/contact/', '/credits/',
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    paths.map((p) => `  <url><loc>${esc(new URL(p, ctx.site).href)}</loc></url>`).join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
