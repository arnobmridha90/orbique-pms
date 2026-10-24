import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Pages that carry a noindex tag stay out of the sitemap too (the Standard suite until it has photos).
const NOINDEX = ['/book/', '/booking/', '/kuala-lumpur/vortex-klcc/standard/'];

// staykozi.my: the Malaysia site (cities, buildings, suites, guides)
export default defineConfig({
  site: 'https://www.staykozi.my',
  srcDir: './src/sites/my',
  outDir: './dist/my',
  publicDir: './public',
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [sitemap({ filter: (page) => !NOINDEX.some((p) => new URL(page).pathname.startsWith(p)) })],
  vite: { resolve: { alias: { '@shared': new URL('./src/shared', import.meta.url).pathname, '@assets': new URL('./src/assets', import.meta.url).pathname } } },
});
