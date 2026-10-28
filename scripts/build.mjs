#!/usr/bin/env node
/* Build Orbique into one HTML page.
 *
 *   node scripts/build.mjs                        -> dist/ (the web app: index.html + vendor files + config.js)
 *   node scripts/build.mjs --local --out /tmp/x.html   -> a single self-contained file for local tests (no server, data saved in the browser)
 *   node scripts/build.mjs --mobile               -> mobile/www (the phone app's files for Capacitor; see docs/MOBILE.md)
 *
 * The page is assembled from app/shell.html: core.css and app/pages/*.css are inlined, then one <script> per file
 * (data.js, core.js, the shared api/_lib/shared/*.cjs modules, app/pages/*.js, app/server/*.js) so a mistake in one page
 * cannot break the others.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const args = process.argv.slice(2);
const local = args.includes('--local');
const mobile = !local && args.includes('--mobile');
const outArg = args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : null;

const read = (p) => fs.readFileSync(p, 'utf8');
const list = (dir, ext) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort().map((f) => path.join(dir, f)) : []);
const jsSafe = (code) => code.replace(/<\/(script)/gi, '<\\/$1');
/* CommonJS files the page and the api/ functions both use: [file, name under O] */
const SHARED = [['api/_lib/shared/assign.cjs', 'assign'], ['api/_lib/shared/guestmsg.cjs', 'guestmsg'], ['api/_lib/shared/rateplan.cjs', 'rateplan'], ['api/_lib/shared/sitecontent.cjs', 'sitecontent']]; /* in this order: guestmsg uses O.assign */

function page() {
  let shell = read(path.join(APP, 'shell.html'));
  shell = shell.replace('/*CORE_CSS*/', () => read(path.join(APP, 'core.css')));
  const css = list(path.join(APP, 'pages'), '.css').concat(list(path.join(APP, 'server'), '.css')).map((p) => `/* ${path.relative(APP, p)} */\n` + read(p));
  shell = shell.replace('<!--PAGE_CSS-->', () => (css.length ? '<style>\n' + css.join('\n') + '\n</style>' : ''));
  const files = [path.join(APP, 'data.js'), path.join(APP, 'core.js')]
    .concat(list(path.join(APP, 'pages'), '.js'))
    .concat(local ? [] : list(path.join(APP, 'server'), '.js'))
    .concat(mobile ? list(path.join(APP, 'native'), '.js') : []);
  const scripts = files.map((p) => `<script>\n/* ${path.relative(APP, p)} */\n${jsSafe(read(p))}\n</script>`);
  /* modules shared with the server (api/_lib/shared/*.cjs) go in right after core.js, wrapped as O.<name> */
  scripts.splice(2, 0, ...SHARED.map(([file, name]) => `<script>\n/* ${file} (shared with the server) */\n(function () {\nvar module = { exports: {} }, exports = module.exports;\n${jsSafe(read(path.join(ROOT, file)))}\nwindow.O = window.O || {}; window.O.${name} = module.exports;\n})();\n</script>`));
  let head = '';
  if (mobile) {
    /* the phone app loads everything from its own files (relative paths); Capacitor's runtime and plugins come first */
    head = '<script src="config.js"></script>\n<script src="vendor/supabase.js"></script>\n' +
      NATIVE_VENDORS.map(([, to]) => '<script src="' + to + '"></script>' +
        /* the files plugin expects the global "synapse"; its UMD build names it "outsystemsSynapse" */
        (to === 'vendor/cap-synapse.js' ? '\n<script>window.synapse = window.synapse || window.outsystemsSynapse;</script>' : '')).join('\n');
    shell = shell.replace(/<script async src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/[^"]+"><\/script>/, '<script async src="vendor/jspdf.umd.min.js"></script>');
  } else if (!local) {
    head = '<link rel="manifest" href="/manifest.webmanifest">\n<link rel="icon" href="/icons/icon-192.png">\n<link rel="apple-touch-icon" href="/icons/icon-192.png">\n' +
      '<script src="/config.js"></script>\n<script src="/vendor/supabase.js"></script>';
    shell = shell.replace(/<script async src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/[^"]+"><\/script>/, '<script async src="/vendor/jspdf.umd.min.js"></script>');
  }
  shell = shell.replace('<!--SCRIPTS-->', () => scripts.join('\n') + '\n<script>O.boot();</script>');
  /* the shell starts with <title>, <meta> and <link> tags: they belong in <head> (Chrome ignores a manifest link in <body>) */
  const lead = shell.match(/^(?:\s*<(?:title>[^<]*<\/title|meta\b[^>]*|link\b[^>]*)>)*/)[0];
  shell = shell.slice(lead.length);
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + lead.trim() + (head ? '\n' + head : '') + '\n</head>\n<body>\n' + shell.replace(/^\s+/, '') + '\n</body>\n</html>\n';
}

/* Capacitor's runtime and the plugins the phone app uses (app/native/bridge.js), as plain scripts: no bundler needed.
 * Order matters: the runtime defines window.capacitorExports, synapse is needed by the files plugin. */
const NATIVE_VENDORS = [
  ['node_modules/@capacitor/core/dist/capacitor.js', 'vendor/capacitor.js'],
  ['node_modules/@capacitor/synapse/dist/synapse.js', 'vendor/cap-synapse.js'],
  ['node_modules/@capacitor/app/dist/plugin.js', 'vendor/cap-app.js'],
  ['node_modules/@capacitor/browser/dist/plugin.js', 'vendor/cap-browser.js'],
  ['node_modules/@capacitor/filesystem/dist/plugin.js', 'vendor/cap-filesystem.js'],
  ['node_modules/@capacitor/share/dist/plugin.js', 'vendor/cap-share.js'],
  ['node_modules/@capacitor/splash-screen/dist/plugin.js', 'vendor/cap-splash.js'],
  ['node_modules/@capacitor-community/text-to-speech/dist/plugin.js', 'vendor/cap-tts.js'],
  ['node_modules/@capacitor/push-notifications/dist/plugin.js', 'vendor/cap-push.js']
];

function copy(from, to) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }

if (local) {
  const out = path.resolve(outArg || path.join(ROOT, 'dist-local', 'orbique.html'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const html = page();
  fs.writeFileSync(out, html);
  console.log('built', out, Math.round(Buffer.byteLength(html) / 1024), 'KB (local test copy)');
} else if (mobile) {
  await buildMobile();
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

/* ---------------- phone app (Capacitor) ----------------
 * The phone app talks to the live site: its /api functions and the same Supabase project.
 * The site address comes from env ORBIQUE_SITE_URL or config/mobile.json {"siteUrl"}; the public Supabase URL and
 * key are read from that site's /config.js (or env SUPABASE_URL + SUPABASE_ANON_KEY). With no site address the app
 * runs as a local test copy, like the single-file build. Never put the service-role key here: these files ship
 * inside the app.
 */
async function buildMobile() {
  const www = path.resolve(outArg || path.join(ROOT, 'mobile', 'www'));
  fs.rmSync(www, { recursive: true, force: true });
  fs.mkdirSync(www, { recursive: true });
  fs.writeFileSync(path.join(www, 'index.html'), page());
  for (const f of ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg']) {
    const src = path.join(ROOT, 'public', f);
    if (fs.existsSync(src)) copy(src, path.join(www, f));
  }
  const vendors = [
    ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'vendor/supabase.js'],
    ['node_modules/jspdf/dist/jspdf.umd.min.js', 'vendor/jspdf.umd.min.js']
  ].concat(NATIVE_VENDORS);
  for (const [from, to] of vendors) {
    const src = path.join(ROOT, from);
    if (!fs.existsSync(src)) { console.error('missing ' + from + ' (run npm install)'); process.exit(1); }
    copy(src, path.join(www, to));
  }

  const env = process.env;
  let file = {};
  try { file = JSON.parse(read(path.join(ROOT, 'config', 'mobile.json'))); } catch (e) { /* optional */ }
  /* ORBIQUE_SITE_URL=none: a local test copy even when config/mobile.json names a site (CI uses it for pull requests,
     whose server changes are not on the live site yet) */
  const asked = String(env.ORBIQUE_SITE_URL || '').trim();
  const site = asked.toLowerCase() === 'none' ? '' : String(asked || file.siteUrl || '').trim().replace(/\/+$/, '');
  if (site && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(site)) { console.error('The site address must look like https://app.example.com (got ' + site + ')'); process.exit(1); }
  let supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '';
  let supabaseKey = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
  if (site && !(supabaseUrl && supabaseKey)) {
    let remote;
    try {
      const res = await fetch(site + '/config.js', { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.text();
      const m = body.match(/window\.ORBIQUE_CONFIG\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
      if (!m) throw new Error('not an Orbique config.js');
      remote = JSON.parse(m[1]);
    } catch (e) {
      console.error('Could not read ' + site + '/config.js: ' + (e && e.message ? e.message : e) + '. Is the site live?');
      process.exit(1);
    }
    supabaseUrl = remote.supabaseUrl || '';
    supabaseKey = remote.supabaseKey || '';
    if (!supabaseUrl || !supabaseKey) { console.error(site + ' has no database configured yet (see docs/DEPLOY.md).'); process.exit(1); }
  }
  if (!site && (supabaseUrl || supabaseKey)) {
    console.error('Set the site address too (ORBIQUE_SITE_URL or config/mobile.json): the app needs it for sign-in help, invites and guest links.');
    process.exit(1);
  }
  if (/^sb_secret_/.test(supabaseKey) || /service_role/.test(Buffer.from(String(supabaseKey).split('.')[1] || '', 'base64').toString('utf8'))) {
    console.error('Refusing to build: the Supabase key is the service-role key. Use the public anon / publishable key.');
    process.exit(1);
  }
  const cfg = {
    supabaseUrl,
    supabaseKey,
    apiBase: site,
    appUrl: site,
    native: true,
    builtAt: new Date().toISOString(),
    commit: (env.GITHUB_SHA || env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7)
  };
  fs.writeFileSync(path.join(www, 'config.js'), 'window.ORBIQUE_CONFIG = ' + JSON.stringify(cfg, null, 2) + ';\n');
  console.log('built', www, site ? '(connected to ' + site + ')' : '(no site address: the app runs as a local test copy)');
}
