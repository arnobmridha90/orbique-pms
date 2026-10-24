import type { APIRoute } from 'astro';

// Everything may be crawled; pages that should stay out of search carry their own noindex tag.
// A preview build asks crawlers to stay out altogether.
export const GET: APIRoute = ({ site }) =>
  new Response(
    import.meta.env.PUBLIC_NOINDEX === '1'
      ? 'User-agent: *\nDisallow: /\n'
      : `User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap-index.xml', site).href}\n`,
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
