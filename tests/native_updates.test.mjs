/* Phone app updates: the decisions in app/native/updates.js (O.appUpdate), and what the builds put in place for them
 * (scripts/build.mjs): the website carries a loader for the phone app's files that a browser never follows, and the
 * phone app's own files have the page shown when the live site cannot be reached. tests/native_sim.py runs the same
 * files in Chromium with Capacitor's native side simulated.
 *
 *   node --test tests/native_updates.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APK = 'https://github.com/arnobmridha90/orbique-pms/releases/download/android-test/Orbique-test.apk';

/* updates.js in a page with no Capacitor (a plain browser): it only defines O.appUpdate */
function load() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'app/native/updates.js'), 'utf8'), { window });
  return window.O.appUpdate;
}
const A = load();
const plain = (x) => JSON.parse(JSON.stringify(x)); /* objects made inside the vm context */
const release = (build, extra) => Object.assign({ tag_name: 'android-test', name: 'Android test build ' + build, draft: false, prerelease: true,
  body: '- Build number: ' + build + ' (version 0.5.0)', assets: [{ name: 'Orbique-test.apk', browser_download_url: APK }] }, extra || {});

test('the newest test build is read from the release title, else its notes', () => {
  assert.deepEqual(plain(A.latest(release(5801))), { build: 5801, url: APK });
  assert.deepEqual(plain(A.latest(release(5801, { name: 'Renamed release' }))), { build: 5801, url: APK });
  assert.equal(A.latest(release(5801, { name: 'x', body: 'no number here' })), null);
  assert.equal(A.latest(release(5801, { draft: true })), null);
  assert.equal(A.latest(null), null);
  assert.equal(A.latest({ message: 'API rate limit exceeded' }), null);
});

test('the download address is GitHub\'s, or the fixed test build address', () => {
  assert.equal(A.latest(release(1, { assets: [] })).url, APK);
  assert.equal(A.latest(release(1, { assets: [{ name: 'Orbique-test.apk', browser_download_url: 'https://example.com/x.apk' }] })).url, APK);
  assert.equal(A.latest(release(1, { assets: [{ name: 'other.apk', browser_download_url: 'https://github.com/a/b/other.apk' }] })).url, APK);
  const own = 'https://github.com/arnobmridha90/orbique-pms/releases/download/android-test/Orbique-test.apk?v=2';
  assert.equal(A.latest(release(1, { assets: [{ name: 'Orbique-test.apk', browser_download_url: own }] })).url, own);
});

test('an update is offered only for a newer build, and not after Later for that build', () => {
  const l = A.latest(release(5801));
  assert.equal(A.offer('5701', l, null), true, 'newer');
  assert.equal(A.offer('5801', l, null), false, 'the same');
  assert.equal(A.offer('5901', l, null), false, 'older');
  assert.equal(A.offer('5701', l, 5801), false, 'Later for this build');
  assert.equal(A.offer('5701', l, '5801'), false, 'Later read back as a string');
  assert.equal(A.offer('5701', A.latest(release(5901)), 5801), true, 'Later for an older build');
  assert.equal(A.offer('5701', null, null), false, 'GitHub did not answer');
  assert.equal(A.offer('1', l, null), false, 'a local build (version code 1)');
  assert.equal(A.offer(undefined, l, null), false, 'no build number');
});

test('GitHub is asked at most every 6 hours', () => {
  const now = Date.UTC(2026, 10, 3, 12);
  assert.equal(A.due(0, now), true, 'never asked');
  assert.equal(A.due(now - A.EVERY + 1000, now), false);
  assert.equal(A.due(now - A.EVERY, now), true);
  assert.equal(A.due(now + 60000, now), true, 'the clock was set back');
  assert.equal(A.EVERY, 6 * 3600 * 1000);
});

test('new screens: the live config.js names another build', () => {
  const shown = { builtAt: '2026-11-03T10:00:00.000Z', commit: 'abc1234' };
  assert.equal(A.newScreens(shown, { builtAt: '2026-11-03T10:00:00.000Z', commit: 'abc1234' }), false);
  assert.equal(A.newScreens(shown, { builtAt: '2026-11-03T11:00:00.000Z', commit: 'def5678' }), true);
  assert.equal(A.newScreens(shown, { builtAt: '2026-11-03T10:00:00.000Z', commit: 'def5678' }), true);
  assert.equal(A.newScreens(shown, null), false, 'config.js did not load');
  assert.equal(A.newScreens({}, shown), false, 'no build time on show');
  const text = 'window.ORBIQUE_CONFIG = ' + JSON.stringify({ supabaseUrl: '', builtAt: 'x', commit: 'y' }, null, 2) + ';\n';
  assert.deepEqual(plain(A.parseConfig(text)), { supabaseUrl: '', builtAt: 'x', commit: 'y' });
  assert.equal(A.parseConfig('<!doctype html>'), null);
});

/* ---- Update with the app's own AppUpdater plugin (O.appUpdate.updater): a stand-in for the plugin ---- */
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
function fakeUpdater(opts = {}) {
  const f = { calls: [], states: [], fallbacks: 0, progress: null, dl: null, can: opts.can || { supported: true, allowed: true }, installError: opts.installError || null };
  f.P = {
    canInstall: async () => { f.calls.push('canInstall'); return f.can; },
    openInstallSettings: async () => { f.calls.push('openInstallSettings'); return { opened: true }; },
    addListener: (ev, cb) => { f.calls.push('addListener:' + ev); f.progress = cb; return Promise.resolve({ remove: async () => { f.calls.push('removeListener'); } }); },
    download: (o) => { f.calls.push('download:' + o.url); return new Promise((resolve, reject) => { f.dl = { resolve, reject }; }); },
    cancel: async () => { f.calls.push('cancel'); if (f.dl) f.dl.reject({ code: 'CANCELLED', message: 'The download was cancelled' }); },
    install: async () => { f.calls.push('install'); if (f.installError) { const e = f.installError; f.installError = null; throw e; } return { started: true }; }
  };
  f.u = A.updater(f.P, APK, (state, info) => f.states.push([state, plain(info)]), () => { f.fallbacks++; });
  f.last = () => f.states[f.states.length - 1];
  f.text = () => A.view(f.last()[0], f.last()[1]).text;
  return f;
}

test('the notice\'s words and buttons for each step', () => {
  const v = (s, i) => plain(A.view(s, i));
  assert.deepEqual(v('offer'), { text: 'A new version of the app is ready', buttons: [['go', 'Update'], ['later', 'Later']] });
  assert.equal(v('downloading', { percent: -1 }).text, 'Downloading the update\u2026');
  assert.equal(v('downloading', { percent: 45.7 }).text, 'Downloading the update\u2026 45%');
  assert.deepEqual(v('downloading', { percent: 0 }).buttons, [['cancel', 'Cancel']]);
  assert.equal(v('permission').text, 'Allow Orbique to install updates, then tap Update again');
  assert.deepEqual(v('installing').buttons, [['go', 'Install'], ['later', 'Later']]);
  assert.match(v('error', { code: 'NETWORK' }).text, /could not be downloaded/);
  assert.match(v('error', { code: 'WRONG_SIGNATURE' }).text, /safety check/);
  assert.match(v('error', { code: 'NOT_NEWER' }).text, /already installed/);
  assert.match(v('error', { code: 'STORAGE' }).text, /not enough space/);
  assert.match(v('error', { code: 'SOMETHING_NEW' }).text, /did not work/);
  assert.deepEqual(v('error', { code: 'NETWORK' }).buttons, [['go', 'Try again'], ['later', 'Later']]);
});

test('Update with the plugin: download with progress, then Android\'s installer', async () => {
  const f = fakeUpdater();
  f.u.start();
  await flush();
  assert.deepEqual(f.calls, ['canInstall', 'addListener:downloadProgress', 'download:' + APK]);
  assert.equal(f.text(), 'Downloading the update\u2026');
  f.progress({ percent: 45, downloaded: 45, total: 100 });
  assert.equal(f.text(), 'Downloading the update\u2026 45%');
  f.u.start(); /* a second tap while downloading does nothing */
  await flush();
  assert.equal(f.calls.filter((c) => c.startsWith('download')).length, 1);
  f.dl.resolve({ versionCode: 5801, bytes: 100 });
  await flush();
  assert.deepEqual(f.calls.slice(3).sort(), ['install', 'removeListener'], 'the progress listener is removed and the installer opened');
  assert.equal(f.last()[0], 'installing');
  assert.equal(f.text(), 'Almost done: tap Install when Android asks');
  /* the person closed the installer: Install again opens it again, without a new download */
  f.u.start();
  await flush();
  assert.deepEqual(f.calls.slice(5), ['canInstall', 'install']);
  assert.equal(f.fallbacks, 0);
});

test('installs not allowed yet: Android\'s setting opens, and the update goes on when the person comes back', async () => {
  const f = fakeUpdater({ can: { supported: true, allowed: false } });
  f.u.start();
  await flush();
  assert.deepEqual(f.calls, ['canInstall', 'openInstallSettings']);
  assert.equal(f.text(), 'Allow Orbique to install updates, then tap Update again');
  assert.equal(await f.u.resume(), false, 'back, still not allowed');
  assert.equal(f.last()[0], 'permission');
  f.can = { supported: true, allowed: true };
  const going = f.u.resume();
  await flush();
  assert.equal(f.last()[0], 'downloading', 'allowed now: the download starts by itself');
  f.dl.resolve({});
  assert.equal(await going, true);
  await flush();
  assert.equal(f.last()[0], 'installing');
  assert.equal(await f.u.resume(), false, 'resume does nothing outside the "allow installs" step');
});

test('permission taken back after the download: asked again, then installs the file already checked', async () => {
  const f = fakeUpdater({ installError: { code: 'NEEDS_PERMISSION', message: 'not allowed' } });
  f.u.start();
  await flush();
  f.dl.resolve({});
  await flush();
  assert.equal(f.last()[0], 'permission');
  assert.ok(f.calls.includes('openInstallSettings'));
  const n = f.calls.length;
  await f.u.resume();
  await flush();
  assert.deepEqual(f.calls.slice(n), ['canInstall', 'canInstall', 'install'], 'no second download');
  assert.equal(f.last()[0], 'installing');
});

test('a failed download shows the reason, and Try again downloads again', async () => {
  const f = fakeUpdater();
  f.u.start();
  await flush();
  f.dl.reject({ code: 'NETWORK', message: 'HTTP 502' });
  await flush();
  assert.deepEqual(f.last(), ['error', { code: 'NETWORK' }]);
  assert.match(f.text(), /Check the internet connection/);
  f.u.start();
  await flush();
  assert.equal(f.calls.filter((c) => c.startsWith('download')).length, 2);
  f.dl.reject({ code: 'WRONG_SIGNATURE', message: 'not signed like the app' });
  await flush();
  assert.match(f.text(), /safety check/);
  f.u.start();
  await flush();
  f.dl.resolve({});
  f.installError = { code: 'NOT_NEWER' };
  await flush();
  assert.deepEqual(f.last(), ['error', { code: 'NOT_NEWER' }]);
  f.u.start();
  await flush();
  assert.equal(f.calls.filter((c) => c.startsWith('download')).length, 4, 'a refused file is downloaded again, not installed');
});

test('Cancel stops the download and nothing after it changes the notice', async () => {
  const f = fakeUpdater();
  f.u.start();
  await flush();
  const late = f.progress;
  f.u.cancel();
  await flush();
  assert.ok(f.calls.includes('cancel'));
  assert.ok(f.calls.includes('removeListener'));
  assert.equal(f.last()[0], 'closed');
  late({ percent: 80 });
  await flush();
  assert.equal(f.last()[0], 'closed', 'a late progress event is ignored');
  assert.ok(!f.calls.includes('install'));
});

test('a build without the install permission (Google Play) and other failures', async () => {
  const f = fakeUpdater({ can: { supported: false, allowed: false } });
  f.u.start();
  await flush();
  assert.equal(f.fallbacks, 1, 'the browser download instead');
  assert.equal(f.last()[0], 'closed');
  assert.ok(!f.calls.includes('openInstallSettings') && !f.calls.some((c) => c.startsWith('download')));
  const g = fakeUpdater();
  g.P.canInstall = async () => { throw { code: 'UNIMPLEMENTED', message: 'not implemented' }; };
  g.u.start();
  await flush();
  assert.deepEqual(g.last(), ['error', { code: 'UNIMPLEMENTED' }]);
  const h = fakeUpdater({ installError: { code: 'UNSUPPORTED' } });
  h.u.start();
  await flush();
  h.dl.resolve({});
  await flush();
  assert.equal(h.fallbacks, 1);
});

test('the website build: the phone app\'s loader, and vendor/native.js in the right order', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'orbique-web-'));
  try {
    const env = Object.assign({}, process.env);
    for (const k of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) delete env[k];
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs'), '--out', out], { cwd: ROOT, env, stdio: 'pipe' });
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const loader = html.match(/<script>\n\/\* phone app only[\s\S]*?<\/script>/);
    assert.ok(loader, 'the loader is in the page');
    const v = loader[0].match(/\/vendor\/native\.js\?v=([0-9a-f]{12})/);
    assert.ok(v, 'it names vendor/native.js with a version');
    /* the loader comes after app/server/*.js and right before O.boot() */
    assert.ok(html.indexOf('/* server/pwa.js */') < loader.index, 'after app/server/*.js');
    assert.equal(html.slice(loader.index + loader[0].length).trim().split('\n')[0], '<script>O.boot();</script>');
    assert.doesNotMatch(html, /<script src="[^"]*(capacitor|cap-)/, 'no Capacitor file as a plain script tag');
    assert.doesNotMatch(html.replace(loader[0], ''), /Capacitor\.isNativePlatform\(\)\) return;\n  var O = window.O, U = O.ui/, 'bridge.js is not inlined in the website');

    /* a browser: no native transport, nothing is written; the app's native side: the script is written */
    const run = (win) => {
      const written = [];
      const ctx = Object.assign({ document: { write: (s) => written.push(s) } }, win);
      vm.runInNewContext(loader[0].replace(/^<script>|<\/script>$/g, ''), { window: ctx, document: ctx.document });
      return written;
    };
    assert.deepEqual(run({}), [], 'a browser');
    assert.deepEqual(run({ Capacitor: {} }), [], 'window.Capacitor alone (some other page) is not the app');
    assert.deepEqual(run({ webkit: { messageHandlers: {} } }), [], 'another iPhone app view');
    assert.deepEqual(run({ Capacitor: {}, androidBridge: {} }), ['<script src="/vendor/native.js?v=' + v[1] + '"><\/script>'], 'Android app');
    assert.equal(run({ Capacitor: {}, webkit: { messageHandlers: { bridge: {} } } }).length, 1, 'iPhone app');

    const js = fs.readFileSync(path.join(out, 'vendor/native.js'), 'utf8');
    const at = (s) => { const i = js.indexOf(s); assert.ok(i >= 0, s + ' is in vendor/native.js'); return i; };
    const order = ['var capacitorExports', 'window.synapse = window.synapse || window.outsystemsSynapse', 'var capacitorApp', 'var capacitorFilesystemPluginCapacitor',
      'var capacitorPushNotifications', '/* app/native/bridge.js */', '/* app/native/updates.js */'].map(at);
    assert.deepEqual(order, order.slice().sort((a, b) => a - b), 'runtime, synapse, plugins, then app/native/*.js');
    assert.doesNotMatch(js, /sourceMappingURL/);
    new vm.Script(js); /* parses */
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('the phone app\'s files: the page shown when the live site cannot be reached', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'orbique-mobile-'));
  const cap = fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8');
  try {
    const env = Object.assign({}, process.env, { ORBIQUE_SITE_URL: 'https://app.example.com', SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'public-anon-key' });
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs'), '--mobile', '--out', out], { cwd: ROOT, env, stdio: 'pipe' });
    const page = fs.readFileSync(path.join(out, 'offline.html'), 'utf8');
    assert.match(page, /No internet connection/);
    assert.match(page, />Try again</);
    assert.match(page, /var home = "https:\/\/app\.example\.com\/";/);
    assert.doesNotMatch(page, /<(script|link|img)[^>]+(src|href)=/, 'everything inline (only offline.html is served from the app)');
    assert.equal(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'), cap, 'a build to another folder leaves capacitor.config.json alone');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
