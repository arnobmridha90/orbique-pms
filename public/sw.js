/* Orbique service worker: lets the installed app open quickly and show the last loaded app when offline.
 *
 *   page navigations (/, /guest/<token>) and /config.js  network first; offline -> the cached copy (index.html)
 *   /vendor/* and /icons/*                               cache first, refreshed in the background
 *   tiles.openfreemap.org (style, sprites, fonts, tiles)  from a saved guest map ('orbique-maps-<building>') when it is
 *                                                       there, else the network (never stored here)
 *   /api/*, /privacy, Supabase and every other site      never touched (always the network, never cached)
 *
 * The guest app (app/pages/nearby.js) fills 'orbique-maps-<building>' itself, on the guest's own phone, so the Nearby
 * maps work without internet. Those caches are kept when VERSION changes (the page refreshes them every 30 days).
 * Bump VERSION when this file's caching rules change; old app caches are deleted on activate.
 */
const VERSION = 'orbique-v4-3';
const MAPS = 'orbique-maps-';
const MAP_HOST = 'tiles.openfreemap.org';
const PRECACHE = ['/index.html', '/config.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/vendor/supabase.js', '/vendor/jspdf.umd.min.js'];
const NETWORK_TIMEOUT = 6000; // on a slow connection, fall back to the cached app after this long

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // one missing file must not stop the install
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) await cache.put(url, res);
      } catch (e) { /* offline during install: cached later */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('orbique-') && !k.startsWith(MAPS) && k !== VERSION).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (e) { /* not supported */ } }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === MAP_HOST) return event.respondWith(savedMap(req)); // the guest's saved Nearby map first
  if (url.origin !== self.location.origin) return; // Supabase, fonts, CDNs: straight to the network
  if (url.pathname.startsWith('/api/')) return;     // the server API is never cached
  if (url.pathname === '/privacy' || url.pathname === '/privacy.html') return; // the public privacy page is not the app
  if (req.mode === 'navigate') return event.respondWith(page(event));
  if (url.pathname === '/config.js') return event.respondWith(networkFirst(req, '/config.js'));
  if (url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/icons/')) return event.respondWith(cacheFirst(event, req));
});

function timeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const cacheable = (res) => res && res.ok && res.type === 'basic';

async function page(event) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match('/index.html');
  const fromNetwork = (async () => {
    const preload = await event.preloadResponse;
    const res = preload || await fetch(event.request);
    // every page of the app is index.html (rewrites), so the latest good page is the offline copy
    if (cacheable(res) && /text\/html/.test(res.headers.get('Content-Type') || '')) event.waitUntil(cache.put('/index.html', res.clone()));
    return res;
  })();
  fromNetwork.catch(() => {}); // a late failure after the cached copy was served is fine
  try {
    return await (cached ? timeout(fromNetwork, NETWORK_TIMEOUT) : fromNetwork);
  } catch (e) {
    if (cached) return cached;
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orbique</title>' +
      '<body style="font-family:system-ui,sans-serif;padding:32px;color:#14181F;background:#F4F5F7"><h1 style="font-size:20px">You are offline</h1>' +
      '<p>Orbique needs an internet connection the first time it opens. Check your connection and try again.</p></body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function networkFirst(req, key) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(key);
  const fromNetwork = fetch(req).then((res) => { if (cacheable(res)) cache.put(key, res.clone()); return res; });
  fromNetwork.catch(() => {});
  try {
    return await (cached ? timeout(fromNetwork, NETWORK_TIMEOUT) : fromNetwork);
  } catch (e) {
    return cached || Response.error();
  }
}

async function cacheFirst(event, req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req, { ignoreSearch: true });
  const refresh = fetch(req).then((res) => { if (cacheable(res)) return cache.put(req, res.clone()).then(() => res); return res; }).catch(() => null);
  if (cached) { event.waitUntil(refresh); return cached; }
  // offline and not in the app cache: a saved guest map also holds the map library (/vendor/maplibre-gl.*)
  return (await refresh) || (await fromMaps(req, true)) || Response.error();
}

async function fromMaps(req, ignoreSearch) {
  const keys = (await caches.keys()).filter((k) => k.startsWith(MAPS));
  for (const k of keys) {
    const hit = await (await caches.open(k)).match(req, { ignoreSearch: !!ignoreSearch, ignoreVary: true });
    if (hit) return hit;
  }
  return null;
}

// a saved map answers first (so a saved map stays one consistent set), anything else goes to the network uncached
async function savedMap(req) {
  const hit = await fromMaps(req, false);
  if (hit) return hit;
  return fetch(req);
}
