import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// staykozi.com: the global site (choose a country)
export default defineConfig({
  site: 'https://www.staykozi.com',
  srcDir: './src/sites/com',
  outDir: './dist/com',
  publicDir: './public',
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [sitemap()],
  vite: { resolve: { alias: { '@shared': new URL('./src/shared', import.meta.url).pathname, '@assets': new URL('./src/assets', import.meta.url).pathname } } },
});
