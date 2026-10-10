#!/usr/bin/env node
/* Build Orbique into one HTML page.
 *
 *   node scripts/build.mjs                        -> dist/ (the web app: index.html + vendor files + config.js)
 *   node scripts/build.mjs --local --out /tmp/x.html   -> a single self-contained file for local tests (no server, data saved in the browser)
 *
 * The page is assembled from app/shell.html: core.css and app/pages/*.css are inlined, then one <script> per file
 * (data.js, core.js, app/pages/*.js, app/server/*.js) so a mistake in one page cannot break the others.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const args = process.argv.slice(2);
const local = args.includes('--local');
const outArg = args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : null;

const read = (p) => fs.readFileSync(p, 'utf8');
const list = (dir, ext) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort().map((f) => path.join(dir, f)) : []);
const jsSafe = (code) => code.replace(/<\/(script)/gi, '<\\/$1');

function page() {
  let shell = read(path.join(APP, 'shell.html'));
  shell = shell.replace('/*CORE_CSS*/', () => read(path.join(APP, 'core.css')));
  const css = list(path.join(APP, 'pages'), '.css').concat(list(path.join(APP, 'server'), '.css')).map((p) => `/* ${path.relative(APP, p)} */\n` + read(p));
  shell = shell.replace('<!--PAGE_CSS-->', () => (css.length ? '<style>\n' + css.join('\n') + '\n</style>' : ''));
  const files = [path.join(APP, 'data.js'), path.join(APP, 'core.js')]
    .concat(list(path.join(APP, 'pages'), '.js'))
    .concat(local ? [] : list(path.join(APP, 'server'), '.js'));
  const scripts = files.map((p) => `<script>\n/* ${path.relative(APP, p)} */\n${jsSafe(read(p))}\n</script>`);
  let head = '';
  if (!local) {
    head = '<link rel="manifest" href="/manifest.webmanifest">\n<link rel="icon" href="/icons/icon-192.png">\n<link rel="apple-touch-icon" href="/icons/icon-192.png">\n' +
      '<script src="/config.js"></script>\n<script src="/vendor/supabase.js"></script>';
    shell = shell.replace(/<script async src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/[^"]+"><\/script>/, '<script async src="/vendor/jspdf.umd.min.js"></script>');
  }
  shell = shell.replace('<!--SCRIPTS-->', () => scripts.join('\n') + '\n<script>O.boot();</script>');
  if (head) shell = shell.replace('</title>', '</title>\n' + head);
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head>\n<body>\n' + shell + '\n</body>\n</html>\n';
}

function copy(from, to) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }

if (local) {
  const out = path.resolve(outArg || path.join(ROOT, 'dist-local', 'orbique.html'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const html = page();
  fs.writeFileSync(out, html);
  console.log('built', out, Math.round(Buffer.byteLength(html) / 1024), 'KB (local test copy)');
} else {
  const dist = path.resolve(outArg || path.join(ROOT, 'dist'));
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), page());
  /* public files (manifest, icons, service worker) */
  const pub = path.join(ROOT, 'public');
  if (fs.existsSync(pub)) fs.cpSync(pub, dist, { recursive: true });
  /* vendor libraries from node_modules (npm install) */
  const vendors = [
    ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'vendor/supabase.js'],
    ['node_modules/jspdf/dist/jspdf.umd.min.js', 'vendor/jspdf.umd.min.js']
  ];
  for (const [from, to] of vendors) {
    const src = path.join(ROOT, from);
    if (fs.existsSync(src)) copy(src, path.join(dist, to)); else console.warn('missing ' + from + ' (run npm install)');
  }
  /* public config for the browser. Only the project URL and the public (anon / publishable) key belong here. */
  const env = process.env;
  const cfg = {
    supabaseUrl: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '',
    supabaseKey: env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
    appUrl: env.APP_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + env.VERCEL_PROJECT_PRODUCTION_URL : ''),
    builtAt: new Date().toISOString(),
    commit: (env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7)
  };
  fs.writeFileSync(path.join(dist, 'config.js'), 'window.ORBIQUE_CONFIG = ' + JSON.stringify(cfg, null, 2) + ';\n');
  console.log('built', dist, cfg.supabaseUrl ? '(database connected)' : '(no database configured: the app runs as a local test copy)');
}
