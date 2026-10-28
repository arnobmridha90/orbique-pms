import { defineConfig, passthroughImageService } from 'astro/config';
import vercel from '@astrojs/vercel';

// staykozi.my: the Malaysia site (cities, buildings, suites, guides).
// The pages that show content (lib/content.ts) are made on request on Vercel and kept for 5 minutes (ISR); Orbique's
// Publish refreshes them at once with the bypass token. The rest (guides, contact, credits, 404) are made at build.
// The sitemap is a page of its own (pages/sitemap.xml.ts), made from the content.
// Pages change with Astro's ClientRouter, so the 3D city behind them (public/city) is built once per visit.
export default defineConfig({
  site: 'https://www.staykozi.my',
  srcDir: './src/sites/my',
  outDir: './dist/my',
  publicDir: './public',
  trailingSlash: 'always',
  build: { format: 'directory' },
  // photos are made ahead of time (scripts/site-photos.mjs), so the server needs no image tools of its own
  image: { service: passthroughImageService() },
  adapter: vercel({ isr: { expiration: 300, bypassToken: process.env.ISR_BYPASS_TOKEN } }),
  vite: { resolve: { alias: { '@shared': new URL('./src/shared', import.meta.url).pathname, '@assets': new URL('./src/assets', import.meta.url).pathname, '@my': new URL('./src/sites/my', import.meta.url).pathname } } },
});
