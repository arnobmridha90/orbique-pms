/* Installable app (production builds only; local single-file builds do not include app/server/*.js).
 * - Moves the manifest and icon tags into <head> (build.mjs places them after <title> in the body, and Chrome
 *   only reads the manifest from <head>).
 * - Guest links (/guest/<token>): no manifest, so "Add to Home Screen" saves the guest's own link, not the staff app.
 * - Registers /sw.js (offline copy of the app) on https or localhost, but not inside the phone app.
 */
(function () {
  'use strict';
  var doc = document;
  var guest = /^\/guest\//.test(location.pathname) || /^#guest-/.test(location.hash);

  function toHead(selector) {
    var el = doc.querySelector(selector);
    if (el && doc.head && el.parentNode !== doc.head) doc.head.appendChild(el);
    return el;
  }
  function meta(name, content) {
    if (doc.querySelector('meta[name="' + name + '"]') || !doc.head) return;
    var m = doc.createElement('meta'); m.name = name; m.content = content; doc.head.appendChild(m);
  }

  try {
    var manifest = doc.querySelector('link[rel="manifest"]');
    if (guest) { if (manifest) manifest.parentNode.removeChild(manifest); } else toHead('link[rel="manifest"]');
    toHead('link[rel="icon"]');
    toHead('link[rel="apple-touch-icon"]');
    toHead('meta[name="theme-color"]');
    meta('mobile-web-app-capable', 'yes');
    meta('apple-mobile-web-app-capable', 'yes');
    meta('apple-mobile-web-app-title', 'Orbique');
    meta('apple-mobile-web-app-status-bar-style', 'default');
  } catch (e) { /* cosmetic only */ }

  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var phoneApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); /* the app ships its own files */
  if (phoneApp || !('serviceWorker' in navigator) || !(location.protocol === 'https:' || local)) return;
  function register() {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function (e) {
      if (window.console && console.warn) console.warn('Offline support is not available here:', e && e.message);
    });
  }
  if (doc.readyState === 'complete') register(); else window.addEventListener('load', register);
})();
