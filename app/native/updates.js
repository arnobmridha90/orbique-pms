/* ===================================================================
   Phone app updates (loaded after app/native/bridge.js; see docs/MOBILE.md, "How updates reach the app").
   When the build has a site address, the app's screens are the live site itself (capacitor.config.json server.url),
   so a deploy reaches phones the next time the app opens. This file covers the two cases that leaves:
   - new screens while the app stayed open in the background: coming back after 30 minutes or more, it asks the live
     /config.js which build the site runs; when that changed and nothing is being edited, the page reloads
   - a new phone app (Android test builds): changes to the phone side (a plugin, a permission, the icon, Capacitor
     itself) still need a new APK. On start and when the app comes back to the front, at most every 6 hours, the
     installed build number (App.getInfo().build, the versionCode that CI sets to the build number) is compared with
     the newest published test build: the GitHub release "android-test", titled "Android test build <N>"
     (.github/workflows/mobile.yml). When it is newer a small notice offers Update (opens the APK in the phone's
     browser, which downloads it; it installs over this app because every test build has the same key) and Later
     (not asked again for that build). Offline, GitHub's rate limit or any other failure: nothing is shown.
   O.appUpdate holds the decisions as plain functions (tests/native_updates.test.mjs).
   =================================================================== */
(function () {
  'use strict';
  var O = window.O = window.O || {};
  var REPO = 'arnobmridha90/orbique-pms';
  var RELEASE_API = 'https://api.github.com/repos/' + REPO + '/releases/tags/android-test';
  var APK_URL = 'https://github.com/' + REPO + '/releases/download/android-test/Orbique-test.apk';
  var EVERY = 6 * 3600 * 1000, AWAY = 30 * 60 * 1000;
  var CHECKED = 'appUpdate:checked', LATER = 'appUpdate:later';

  var A = O.appUpdate = {
    EVERY: EVERY,
    AWAY: AWAY,
    /* the newest test build from the release API's answer: {build, url}, or null when it cannot be read */
    latest: function (rel) {
      if (!rel || typeof rel !== 'object' || rel.draft) return null;
      var m = String(rel.name || '').match(/\bbuild\s+(\d+)\s*$/i) || String(rel.body || '').match(/Build number:\s*(\d+)/i);
      var build = m ? parseInt(m[1], 10) : 0;
      if (!(build > 0)) return null;
      var url = APK_URL;
      (rel.assets || []).forEach(function (a) {
        /* only GitHub's own download address: the app hands it to the phone's browser */
        if (a && a.name === 'Orbique-test.apk' && /^https:\/\/github\.com\//.test(String(a.browser_download_url || ''))) url = a.browser_download_url;
      });
      return { build: build, url: url };
    },
    /* offer the update? installed: App.getInfo().build (a string); later: the build the person said Later to */
    offer: function (installed, latest, later) {
      var have = parseInt(installed, 10);
      /* local builds have version code 1 (android/app/build.gradle) and are not test builds */
      if (!(have > 1) || !latest || !(latest.build > 0)) return false;
      return latest.build > have && Number(later) !== latest.build;
    },
    /* time to ask GitHub again? (a clock set back counts as due) */
    due: function (last, now) {
      last = Number(last) || 0;
      return !last || now - last >= EVERY || now < last;
    },
    /* the live site runs a different build than the screens on show (both from config.js: builtAt and commit) */
    newScreens: function (shown, live) {
      if (!shown || !live || !shown.builtAt || !live.builtAt) return false;
      return shown.builtAt !== live.builtAt || String(shown.commit || '') !== String(live.commit || '');
    },
    /* window.ORBIQUE_CONFIG out of a config.js file's text, or null */
    parseConfig: function (text) {
      var m = String(text || '').match(/window\.ORBIQUE_CONFIG\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
      if (!m) return null;
      try { return JSON.parse(m[1]); } catch (e) { return null; }
    }
  };

  var Cap = window.Capacitor;
  if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return;
  var App = window.capacitorApp && window.capacitorApp.App;
  if (!App || !O.store) return;
  var platform = Cap.getPlatform ? Cap.getPlatform() : '';
  var CFG = window.ORBIQUE_CONFIG || {};

  function get(url, ms) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, ms) : null;
    return fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (res) {
      if (t) clearTimeout(t);
      return res;
    }, function (e) { if (t) clearTimeout(t); throw e; });
  }

  /* ---------------- a new phone app (Android) ---------------- */
  function notice(latest) {
    if (document.querySelector('.app-update')) return;
    var host = O.$('.toasts') || document.body.appendChild(O.html('<div class="toasts" role="status" aria-live="polite"></div>'));
    var el = O.html('<div class="toast app-update"><span>A new version of the app is ready</span><span class="app-update-acts">' +
      '<button type="button" class="btn btn-sm app-update-go" data-upd="go">Update</button>' +
      '<button type="button" class="btn btn-sm app-update-later" data-upd="later">Later</button></span></div>');
    el.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-upd]') : null;
      if (!b) return;
      el.remove();
      if (b.getAttribute('data-upd') === 'later') { O.store.set(LATER, latest.build); return; }
      /* an address outside the app: Capacitor hands it to the phone's browser, which downloads the APK; the person
         then opens the download and taps Install (it installs over this app and keeps the sign-in) */
      location.href = latest.url;
      if (O.ui && O.ui.toast) O.ui.toast('Downloading the new version. Open it when it is done, then tap Install.');
    });
    host.appendChild(el);
  }
  var asking = false;
  function checkApp(force) {
    if (platform !== 'android' || asking) return;
    var now = Date.now();
    if (!force && !A.due(O.store.get(CHECKED, 0), now)) return;
    asking = true;
    App.getInfo().then(function (info) {
      var installed = info && info.build;
      if (!(parseInt(installed, 10) > 1)) return null;
      return get(RELEASE_API, 15000).then(function (res) {
        O.store.set(CHECKED, now); /* asked and answered (a rate limit too): wait for the next turn */
        if (!res.ok) return null;
        return res.json().then(function (rel) {
          var latest = A.latest(rel);
          if (A.offer(installed, latest, O.store.get(LATER, null))) notice(latest);
        });
      });
    }).catch(function () { /* offline or no answer: try again next time */ }).then(function () { asking = false; });
  }

  /* ---------------- new screens after a long time in the background ---------------- */
  function quiet() {
    if (document.querySelector('.modal-back, .drawer, .wb-full, .app-update')) return false;
    var a = document.activeElement;
    if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return false;
    return !(O.voice && O.voice.speaking && O.voice.speaking());
  }
  function checkScreens() {
    /* the bundled local test copy (config.js native: true) has no live site to follow */
    if (CFG.native || !CFG.builtAt || !/^https?:$/.test(location.protocol)) return;
    get('/config.js', 10000).then(function (res) { return res.ok ? res.text() : ''; }).then(function (text) {
      if (A.newScreens(CFG, A.parseConfig(text)) && quiet()) location.reload();
    }).catch(function () { /* offline: keep what is on screen */ });
  }

  var awaySince = 0;
  App.addListener('appStateChange', function (s) {
    if (!s || !s.isActive) { awaySince = Date.now(); return; }
    var away = awaySince ? Date.now() - awaySince : 0;
    awaySince = 0;
    if (away >= AWAY) checkScreens();
    checkApp(false);
  });
  /* on start, once the first screen has had a moment */
  setTimeout(function () { checkApp(false); }, 4000);
  O.native = O.native || {};
  O.native.checkForUpdate = function () { checkApp(true); };
})();
