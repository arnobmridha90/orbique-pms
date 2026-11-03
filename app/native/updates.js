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
     (.github/workflows/mobile.yml). When it is newer a small notice offers Update and Later (not asked again for that
     build). Offline, GitHub's rate limit or any other failure: nothing is shown.
     Update, in builds with the app's own AppUpdater plugin (android/app/src/main/java/com/orbique/app/AppUpdaterPlugin.java):
     the app downloads the APK itself, with the progress and a Cancel button in the notice, checks it (this app's
     package, the same signing key, a newer build) and opens Android's installer, so the person only taps Install.
     Android 8 and later first ask once to allow installs from Orbique: the notice says so and goes on by itself when
     the person comes back with it allowed. Older builds (no plugin) and the Google Play build (no install permission)
     open the APK in the phone's browser instead, which downloads it; it installs over this app because every test
     build has the same key.
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
    },
    /* what the notice says in each step of an update, and its buttons ([action, label]; go = Update / Try again / Install) */
    view: function (state, info) {
      info = info || {};
      var later = ['later', 'Later'];
      if (state === 'downloading') {
        var p = Number(info.percent);
        return { text: 'Downloading the update\u2026' + (p >= 0 && p <= 100 ? ' ' + Math.floor(p) + '%' : ''), buttons: [['cancel', 'Cancel']] };
      }
      if (state === 'permission') return { text: 'Allow Orbique to install updates, then tap Update again', buttons: [['go', 'Update'], later] };
      if (state === 'installing') return { text: 'Almost done: tap Install when Android asks', buttons: [['go', 'Install'], later] };
      if (state === 'error') return { text: A.errorText(info.code), buttons: [['go', 'Try again'], later] };
      return { text: 'A new version of the app is ready', buttons: [['go', 'Update'], later] };
    },
    /* the AppUpdater plugin's error codes, in plain words */
    errorText: function (code) {
      switch (String(code || '')) {
        case 'NETWORK': return 'The update could not be downloaded. Check the internet connection and try again.';
        case 'STORAGE': return 'There is not enough space on the phone for the update.';
        case 'NOT_NEWER': return 'This version of the app is already installed.';
        case 'INVALID_APK': case 'WRONG_PACKAGE': case 'WRONG_SIGNATURE': case 'BAD_URL':
          return 'The update did not pass the safety check, so it was not installed.';
        case 'NO_INSTALLER': return 'This phone could not open the installer for the update.';
        default: return 'The update did not work. Please try again.';
      }
    },
    /* one update with the AppUpdater plugin P (Capacitor.registerPlugin('AppUpdater')): show(state, info) draws the
       notice (states offer, downloading, permission, installing, error, closed); fallback() is the browser download, for
       a build without the install permission. Only the newest action counts: Cancel or Later makes the answers of the
       one before them do nothing. */
    updater: function (P, url, show, fallback) {
      var state = 'offer', run = 0, sub = null, ready = false;
      var noop = function () {};
      function set(s, info) { state = s; show(s, info || {}); }
      function unsub() {
        var h = sub;
        sub = null;
        if (h) Promise.resolve(h).then(function (x) { if (x && x.remove) return x.remove(); }).catch(noop);
      }
      function ask() {
        set('permission');
        return Promise.resolve().then(function () { return P.openInstallSettings(); }).catch(noop);
      }
      function fail(my, e) {
        if (my !== run) return;
        unsub();
        var code = (e && e.code) || '';
        if (code === 'CANCELLED') return;
        if (code === 'NEEDS_PERMISSION') return ask();
        if (code === 'NO_FILE' || code === 'INVALID_APK' || code === 'WRONG_PACKAGE' || code === 'WRONG_SIGNATURE' || code === 'NOT_NEWER') ready = false;
        if (code === 'UNSUPPORTED') { set('closed'); return fallback(); }
        set('error', { code: code });
      }
      function install(my) {
        return Promise.resolve(P.install()).then(function () { if (my === run) set('installing'); });
      }
      var c = {
        state: function () { return state; },
        /* Update, Try again, Install */
        start: function () {
          if (state === 'downloading') return Promise.resolve();
          var my = ++run;
          return Promise.resolve().then(function () { return P.canInstall(); }).then(function (r) {
            if (my !== run) return;
            if (r && r.supported === false) { set('closed'); return fallback(); }
            if (!r || !r.allowed) return ask();
            if (ready) return install(my);
            set('downloading', { percent: -1 });
            sub = P.addListener('downloadProgress', function (e) {
              if (my === run && state === 'downloading') set('downloading', { percent: e && e.percent });
            });
            return Promise.resolve(P.download({ url: url })).then(function () {
              if (my !== run) return;
              unsub();
              ready = true;
              return install(my);
            });
          }).catch(function (e) { fail(my, e); });
        },
        cancel: function () {
          run++;
          unsub();
          set('closed');
          return Promise.resolve().then(function () { return P.cancel(); }).catch(noop);
        },
        /* the app came back to the front: after "allow installs", go on by itself when it is allowed now */
        resume: function () {
          if (state !== 'permission') return Promise.resolve(false);
          var my = run;
          return Promise.resolve().then(function () { return P.canInstall(); }).then(function (r) {
            if (my !== run || state !== 'permission' || !r || !r.allowed) return false;
            return c.start().then(function () { return true; });
          }, function () { return false; });
        }
      };
      return c;
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
  /* the app's own plugin (android/.../AppUpdaterPlugin.java): only builds that have it list it in PluginHeaders */
  var Updater = null;
  function updaterPlugin() {
    if (Updater === null) {
      Updater = false;
      try {
        if (typeof Cap.isPluginAvailable === 'function' && Cap.isPluginAvailable('AppUpdater') && typeof Cap.registerPlugin === 'function') Updater = Cap.registerPlugin('AppUpdater');
      } catch (e) { Updater = false; }
    }
    return Updater || null;
  }
  /* older builds: an address outside the app, so Capacitor hands it to the phone's browser, which downloads the APK;
     the person then opens the download and taps Install (it installs over this app and keeps the sign-in) */
  function browserDownload(url) {
    location.href = url;
    if (O.ui && O.ui.toast) O.ui.toast('Downloading the new version. Open it when it is done, then tap Install.');
  }
  var current = null; /* the notice's updater (O.appUpdate.updater), while the notice is up */
  function notice(latest) {
    if (document.querySelector('.app-update')) return;
    var host = O.$('.toasts') || document.body.appendChild(O.html('<div class="toasts" role="status" aria-live="polite"></div>'));
    var el = O.html('<div class="toast app-update"><span class="app-update-msg"></span><span class="app-update-acts"></span></div>');
    var esc = O.esc || function (x) { return String(x).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); };
    function draw(state, info) {
      if (state === 'closed') { el.remove(); if (current && current.el === el) current = null; return; }
      var v = A.view(state, info);
      el.setAttribute('data-state', state);
      el.querySelector('.app-update-msg').textContent = v.text;
      el.querySelector('.app-update-acts').innerHTML = v.buttons.map(function (b) {
        return '<button type="button" class="btn btn-sm app-update-' + b[0] + '" data-upd="' + b[0] + '">' + esc(b[1]) + '</button>';
      }).join('');
    }
    var P = updaterPlugin();
    var u = P ? A.updater(P, latest.url, draw, function () { browserDownload(latest.url); }) : null;
    if (u) { u.el = el; current = u; }
    draw('offer');
    el.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-upd]') : null;
      if (!b) return;
      var act = b.getAttribute('data-upd');
      if (act === 'later') {
        O.store.set(LATER, latest.build);
        if (u) u.cancel(); else el.remove();
        return;
      }
      if (act === 'cancel') {
        if (u) u.cancel();
        if (O.ui && O.ui.toast) O.ui.toast('Update cancelled');
        return;
      }
      if (!u) { el.remove(); browserDownload(latest.url); return; }
      u.start();
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
    if (current) current.resume();
    checkApp(false);
  });
  /* on start, once the first screen has had a moment */
  setTimeout(function () { checkApp(false); }, 4000);
  O.native = O.native || {};
  O.native.checkForUpdate = function () { checkApp(true); };
})();
