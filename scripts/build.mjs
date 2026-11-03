#!/usr/bin/env node
/* Build Orbique into one HTML page.
 *
 *   node scripts/build.mjs                        -> dist/ (the web app: index.html + vendor files + config.js)
 *   node scripts/build.mjs --local --out /tmp/x.html   -> a single self-contained file for local tests (no server, data saved in the browser)
 *   node scripts/build.mjs --mobile               -> mobile/www (the phone app's files for Capacitor; see docs/MOBILE.md)
 *                                                    and server.url in capacitor.config.json
 *
 * The page is assembled from app/shell.html: core.css and app/pages/*.css are inlined, then one <script> per file
 * (data.js, core.js, the shared api/_lib/shared/*.cjs modules, app/pages/*.js, app/server/*.js) so a mistake in one page
 * cannot break the others.
 */
import crypto from 'node:crypto';
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
const SHARED = [['api/_lib/shared/assign.cjs', 'assign'], ['api/_lib/shared/guestmsg.cjs', 'guestmsg'], ['api/_lib/shared/greeting.cjs', 'greeting'], ['api/_lib/shared/rateplan.cjs', 'rateplan'], ['api/_lib/shared/sitecontent.cjs', 'sitecontent'], ['api/_lib/shared/geo.cjs', 'geo'], ['api/_lib/shared/unitdue.cjs', 'unitdue'], ['api/_lib/shared/beds.cjs', 'beds'], ['api/_lib/shared/taskwho.cjs', 'taskwho'], ['api/_lib/shared/unitreq.cjs', 'unitreq']]; /* in this order: guestmsg uses O.assign, greeting uses O.guestmsg, unitreq uses O.taskwho */

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
  /* the website is also the phone app's screens (capacitor.config.json server.url, docs/MOBILE.md): inside the app,
     whose native side has already put window.Capacitor and its transport into the page, Capacitor's plugins and
     app/native/*.js load here, after app/server/*.js and before O.boot(). document.write keeps that order (a script it
     writes runs before the parser goes on). A browser has no such transport and loads nothing more */
  if (nativeJs) scripts.push('<script>\n/* phone app only: vendor/native.js (Capacitor plugins + app/native/*.js) */\n(function (w) {\n' +
    '  var k = w.webkit && w.webkit.messageHandlers;\n' +
    '  if (w.Capacitor && (w.androidBridge || (k && k.bridge))) document.write(\'<script src="/vendor/native.js?v=' + nativeJs.hash + '"><\\/script>\');\n' +
    '})(window);\n</script>');
  shell = shell.replace('<!--SCRIPTS-->', () => scripts.join('\n') + '\n<script>O.boot();</script>');
  /* the shell starts with <title>, <meta> and <link> tags: they belong in <head> (Chrome ignores a manifest link in <body>) */
  const lead = shell.match(/^(?:\s*<(?:title>[^<]*<\/title|meta\b[^>]*|link\b[^>]*)>)*/)[0];
  shell = shell.slice(lead.length);
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + lead.trim() + (head ? '\n' + head : '') + '\n</head>\n<body>\n' + shell.replace(/^\s+/, '') + '\n</body>\n</html>\n';
}

let nativeJs = null; /* the web build's vendor/native.js: {code, hash} */
const OFFLINE_PAGE = 'offline.html'; /* mobile/www: capacitor.config.json server.errorPath */

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

/* MapLibre GL JS (BSD-3-Clause, pinned in package.json) for the guest app's Nearby maps; loaded only when a map opens */
const MAP_VENDORS = [
  ['node_modules/maplibre-gl/dist/maplibre-gl.js', 'vendor/maplibre-gl.js'],
  ['node_modules/maplibre-gl/dist/maplibre-gl.css', 'vendor/maplibre-gl.css'],
  ['node_modules/maplibre-gl/LICENSE.txt', 'vendor/maplibre-gl.LICENSE.txt']
];

/* vendor/native.js for the website: NATIVE_VENDORS (same order) and then app/native/*.js, each in its own try so a
   mistake in one file does not stop the next. Only the phone app loads it (see page()). */
function nativeBundle() {
  const parts = [];
  for (const [from, to] of NATIVE_VENDORS) {
    const src = path.join(ROOT, from);
    if (!fs.existsSync(src)) { console.warn('missing ' + from + ' (run npm install): the website will not work as the phone app\'s screens'); return null; }
    parts.push('/* ' + to + ': ' + from + ' */\n' + read(src).replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n') +
      (to === 'vendor/cap-synapse.js' ? '\nwindow.synapse = window.synapse || window.outsystemsSynapse;' : ''));
  }
  for (const p of list(path.join(APP, 'native'), '.js')) {
    const name = 'app/' + path.relative(APP, p);
    parts.push('/* ' + name + ' */\ntry {\n' + read(p) + '\n} catch (e) { if (window.console) console.error(' + JSON.stringify(name + ' failed:') + ', e); }');
  }
  const code = parts.join('\n;\n') + '\n';
  return { code, hash: crypto.createHash('sha256').update(code).digest('hex').slice(0, 12) };
}

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  /* the source maps are not shipped, so drop the comment that points browsers at them */
  if (/\.(js|css)$/.test(from) && /maplibre/.test(from)) fs.writeFileSync(to, read(from).replace(/\n?\/[/*]# sourceMappingURL=\S+(\s*\*\/)?\s*$/, '\n'));
  else fs.copyFileSync(from, to);
}

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
  nativeJs = nativeBundle();
  fs.writeFileSync(path.join(dist, 'index.html'), page());
  if (nativeJs) { fs.mkdirSync(path.join(dist, 'vendor'), { recursive: true }); fs.writeFileSync(path.join(dist, 'vendor', 'native.js'), nativeJs.code); }
  /* public files (manifest, icons, service worker) */
  const pub = path.join(ROOT, 'public');
  if (fs.existsSync(pub)) fs.cpSync(pub, dist, { recursive: true });
  /* vendor libraries from node_modules (npm install) */
  const vendors = [
    ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'vendor/supabase.js'],
    ['node_modules/jspdf/dist/jspdf.umd.min.js', 'vendor/jspdf.umd.min.js']
  ].concat(MAP_VENDORS);
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
  /* the alert chime (scripts/alert-sound.py) is played by O.alertSound from sounds/ next to index.html */
  for (const f of ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg', 'sounds/orbique_alert.wav']) {
    const src = path.join(ROOT, 'public', f);
    if (fs.existsSync(src)) copy(src, path.join(www, f));
  }
  const vendors = [
    ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'vendor/supabase.js'],
    ['node_modules/jspdf/dist/jspdf.umd.min.js', 'vendor/jspdf.umd.min.js']
  ].concat(NATIVE_VENDORS, MAP_VENDORS);
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
  fs.writeFileSync(path.join(www, OFFLINE_PAGE), offlinePage(site));
  /* only the default folder is what Capacitor copies into the app (capacitor.config.json webDir) */
  if (!outArg) capacitorServer(site);
  console.log('built', www, site ? '(screens from ' + site + ', updated on each deploy)' : '(no site address: the app runs as a local test copy)');
}

/* Where the app's screens come from. With a site address the app opens the live site itself (server.url), so each
 * deploy reaches phones the next time the app opens, with no new install, and the native side gives that page the
 * same plugins as the bundled copy. server.errorPath is the bundled page shown when the site cannot be reached.
 * Without a site address (ORBIQUE_SITE_URL=none: pull requests) the app shows the bundled copy in mobile/www, so it
 * tests that build's own screens. npx cap sync copies capacitor.config.json into android/ and ios/; this keeps its
 * other settings and its key order, and writes it only when something changed.
 */
function capacitorServer(site) {
  const file = path.join(ROOT, 'capacitor.config.json');
  const before = read(file);
  const cfg = JSON.parse(before);
  const server = Object.assign({}, cfg.server);
  delete server.url; delete server.errorPath;
  if (site) Object.assign(server, { url: site, errorPath: OFFLINE_PAGE });
  const out = {};
  for (const k of Object.keys(cfg)) {
    if (k === 'server') continue;
    out[k] = cfg[k];
    if (k === 'webDir' && Object.keys(server).length) out.server = server;
  }
  if (!out.server && Object.keys(server).length) out.server = server;
  const after = JSON.stringify(out, null, 2) + '\n';
  if (after !== before) fs.writeFileSync(file, after);
  console.log('capacitor.config.json: ' + (site ? 'server.url ' + site : 'no server.url (the bundled copy)'));
}

/* Shown by the app when the live site cannot be reached (no internet, or the site is down). Capacitor serves it from
 * the app's own files (https://localhost/offline.html on Android), so everything is inline. */
function offlinePage(site) {
  const home = JSON.stringify((site || '') + '/');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Orbique</title>
<style>
html,body{margin:0;height:100%;}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#F6F7F9;color:#14181F;display:flex;align-items:center;justify-content:center;
  padding:calc(24px + env(safe-area-inset-top,0px)) 24px calc(24px + env(safe-area-inset-bottom,0px));box-sizing:border-box;text-align:center;}
.box{max-width:340px;}
.mark{width:56px;height:56px;border-radius:16px;background:#0B5D54;color:#FFFFFF;font-weight:800;font-size:28px;line-height:56px;margin:0 auto 20px;}
h1{font-size:20px;margin:0 0 10px;}
p{font-size:15px;line-height:1.5;color:#4A5160;margin:0 0 24px;}
button{font:inherit;font-size:15px;font-weight:700;background:#0B5D54;color:#FFFFFF;border:0;border-radius:10px;padding:12px 28px;}
button[disabled]{opacity:0.6;}
</style>
</head>
<body>
<div class="box">
<div class="mark" aria-hidden="true">O</div>
<h1>No internet connection</h1>
<p>Orbique needs the internet to open. Check that Wi-Fi or mobile data is on, then try again.</p>
<button type="button" id="again">Try again</button>
</div>
<script>
(function () {
  var home = ${home};
  var b = document.getElementById('again');
  function again() { b.disabled = true; b.textContent = 'Opening...'; location.replace(home === '/' ? 'index.html' : home); }
  b.addEventListener('click', again);
  /* the phone is back online: try by itself */
  window.addEventListener('online', again);
})();
</script>
</body>
</html>
`;
}
