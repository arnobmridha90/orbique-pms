/* ===================================================================
   Phone app bridge (mobile builds only: node scripts/build.mjs --mobile; see docs/MOBILE.md).
   The phone app is the same Orbique page running inside Capacitor. This file swaps the few browser features
   a phone's app view lacks for native ones, and does nothing in a normal browser:
   - downloads (PDF, CSV, photos): saved to the app's cache, then the phone's share sheet (Save to Files, Drive, WhatsApp...)
   - read aloud: the phone's own text-to-speech (Android's app view has no speech synthesis)
   - links that leave Orbique: the in-app browser; tel:, mailto: and WhatsApp hand over to the phone
   - Android back button: closes the open menu, stops read-aloud, closes the window or drawer, steps back inside a page
     (inbox chat -> list), then goes back through the pages, then leaves
   - status bar (and Android navigation bar) icons follow the colour under them; the splash screen stays until the first
     screen is drawn
   tests/native_sim.py runs these files in Chromium with Capacitor's native side simulated.
   - guest and invite links point at the live site (window.ORBIQUE_CONFIG.appUrl), not at the app's own files
   - booking alerts (Firebase Cloud Messaging): owners and ops managers are asked once to allow notifications; the
     phone's token goes to /api/alerts (register-device); tapping an alert opens the booking; signing out removes it
   Loaded after app/server/*.js and before O.boot().
   =================================================================== */
(function () {
  'use strict';
  var Cap = window.Capacitor;
  if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return;
  var O = window.O, U = O.ui, CFG = window.ORBIQUE_CONFIG || {};
  var platform = Cap.getPlatform ? Cap.getPlatform() : 'native';
  function plugin(globalName, name) { var g = window[globalName]; return g && g[name] ? g[name] : null; }
  var App = plugin('capacitorApp', 'App'), Browser = plugin('capacitorBrowser', 'Browser'), Share = plugin('capacitorShare', 'Share'),
    Splash = plugin('capacitorSplashScreen', 'SplashScreen'), TTS = plugin('capacitorTextToSpeech', 'TextToSpeech'),
    FS = plugin('capacitorFilesystemPluginCapacitor', 'Filesystem'), FSDir = plugin('capacitorFilesystemPluginCapacitor', 'Directory'),
    Bars = window.capacitorExports && window.capacitorExports.SystemBars,
    Push = plugin('capacitorPushNotifications', 'PushNotifications');

  O.native = { platform: platform };
  document.documentElement.classList.add('native', 'native-' + platform);
  if (CFG.appUrl) O.APP_URL = String(CFG.appUrl).replace(/\/$/, '');

  /* ---------------- downloads -> share sheet ---------------- */
  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
      r.onerror = function () { reject(r.error || new Error('read failed')); };
      r.readAsDataURL(blob);
    });
  }
  function safeName(name) {
    var n = String(name || 'Orbique-file').replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '-').replace(/\s+/g, ' ').trim();
    return n.slice(0, 120) || 'Orbique-file';
  }
  if (FS && FSDir && Share) {
    O.download = function (filename, data, mime) {
      var name = safeName(filename);
      var blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
      return toBase64(blob).then(function (b64) {
        return FS.writeFile({ path: 'exports/' + name, data: b64, directory: FSDir.Cache, recursive: true });
      }).then(function (res) {
        return Share.share({ title: name, files: [res.uri], dialogTitle: 'Save or send ' + name });
      }).then(function () { U.toast('Ready: ' + name); return true; }, function (err) {
        var m = String((err && (err.message || err.errorMessage)) || err || '');
        if (/cancel/i.test(m)) { U.toast('Not saved', 'bad'); return false; }
        if (window.console) console.error('download failed', m);
        U.toast('Could not save ' + name + '. Please try again.', 'bad');
        return false;
      });
    };
  }

  /* ---------------- read aloud -> the phone's text-to-speech ----------------
     Same contract as core's O.voice: onend runs once for every read-aloud, also when it is stopped (back button,
     app sent to the background, a newer read-aloud), so the page that started it can show it has ended.
     The plugin refuses a sentence in a language the phone has no voice for, so the language is checked first: with no
     usable voice onend(false) comes before any onpart. onpart(i) fires as sentence i is handed to the engine (the
     plugin has no "started speaking" event), so when the engine then refuses the first sentence onend(false) comes
     after onpart(0); pages treat onend(false) as "reading aloud is not available" either way. */
  if (TTS) {
    var LANGS = ['en-GB', 'en-US'], run = 0, job = null;
    var noop = function () {};
    var pickLang = function (retry) { /* the first language the phone can speak now, or null (asked each time: voices can be removed) */
      var k = 0;
      function tryNext() {
        if (k >= LANGS.length) return null;
        var l = LANGS[k++];
        return TTS.isLanguageSupported({ lang: l }).then(function (r) { return r && r.supported ? l : tryNext(); }, tryNext);
      }
      return Promise.resolve(tryNext()).then(function (l) {
        if (l || !retry) return l;
        /* Android starts its speech engine a moment after the app opens: ask once more */
        return new Promise(function (res) { setTimeout(res, 600); }).then(function () { return pickLang(false); });
      });
    };
    var finish = function (j, ok) {
      if (!j || j.over) return;
      j.over = true;
      if (job === j) { job = null; O.voice._on = false; }
      if (j.o.onend) { try { j.o.onend(ok); } catch (e) { if (window.console) console.error(e); } }
    };
    O.voice.available = function () { return true; };
    O.voice.hasVoices = function () { return true; };
    O.voice.stop = function () {
      run++;
      var j = job; job = null; O.voice._on = false;
      try { TTS.stop().catch(noop); } catch (e) { /* nothing playing */ }
      finish(j, true);
    };
    O.voice.speak = function (text, o) {
      o = o || {};
      O.voice.stop();
      var parts = Array.isArray(text) ? text.filter(function (x) { return String(x).trim(); }) : (String(text).match(/(?:\d\.\d|[^.!?])+[.!?]*/g) || [text]);
      var me = ++run, i = 0, started = false, spoke = false, lang = null, j = job = { o: o, over: false };
      O.voice._on = true;
      function next() {
        if (me !== run) return; /* stopped, or a newer read-aloud took over */
        if (i >= parts.length) { finish(j, true); return; }
        if (!started) { started = true; if (o.onstart) o.onstart(); }
        if (o.onpart) o.onpart(i, parts.length);
        TTS.speak({ text: String(parts[i]).trim(), lang: lang, rate: o.rate || 1.0, pitch: o.pitch || 0.95, volume: 1.0, category: 'playback' })
          .then(function () { spoke = true; i++; next(); }, function () {
            if (me !== run) return;
            /* the first sentence failed: the phone cannot speak right now, so stop instead of failing through every sentence */
            if (!spoke) { run++; finish(j, false); return; }
            i++; next();
          });
      }
      pickLang(true).then(function (l) {
        if (me !== run) return;
        if (!l) { run++; finish(j, false); return; }
        lang = l;
        next();
      });
      return true;
    };
  }

  /* ---------------- links that leave Orbique ---------------- */
  function external(url) {
    var u; try { u = new URL(url, location.href); } catch (e) { return null; }
    if (/^(tel|mailto|sms|whatsapp|geo):$/.test(u.protocol)) return { kind: 'hand-over', url: u.href };
    if (!/^https?:$/.test(u.protocol) || u.origin === location.origin) return null;
    if (/^(wa\.me|api\.whatsapp\.com)$/i.test(u.hostname)) return { kind: 'hand-over', url: u.href };
    return { kind: 'browser', url: u.href };
  }
  function openOut(x) {
    /* full screen (the plugin's default): a 'popover' with no size is a narrow 320pt panel on iPads and large iPhones held sideways */
    if (x.kind === 'browser' && Browser) return Browser.open({ url: x.url }).catch(function () { location.href = x.url; });
    location.href = x.url; /* Capacitor hands addresses outside the app to the phone (dialer, mail, WhatsApp, browser) */
  }
  /* the Channex channel screen (Channels -> Manage channels) opens here: the app view blocks the cookies it needs */
  O.native.browser = function (url) { var x = external(String(url || '')); if (x) openOut(x); return !!x; };
  var winOpen = window.open;
  window.open = function (url, target, features) {
    var x = url ? external(String(url)) : null;
    if (x) { openOut(x); return null; }
    return winOpen.apply(window, arguments);
  };
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download')) return;
    var x = external(a.getAttribute('href'));
    if (!x) return;
    e.preventDefault();
    openOut(x);
  }, false);

  /* ---------------- Android back button ---------------- */
  var trail = [], goPage = O.go;
  O.go = function (id, params) {
    var from = O.state.page;
    if (from && from !== id) { trail.push(from); if (trail.length > 30) trail.shift(); }
    return goPage.apply(this, arguments);
  };
  function escape() { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }
  function shown(el) { return !!(el && el.getClientRects().length); }
  function back() {
    /* open menus: the shell's popovers and the pages' own (inbox chat menus, the calendar's free-night menu) */
    var menus = O.$$('.pop-menu.open, .ws-menu.open, .viewer-menu.open, .dr-pop.open, .ib-menu.open, .att-menu.open');
    if (menus.length) { menus.forEach(function (m) { m.classList.remove('open'); }); return; }
    var cal = O.$('.cal-menu');
    if (cal) { escape(); if (cal.parentNode) cal.remove(); return; }
    if (O.voice && O.voice.speaking && O.voice.speaking()) { O.voice.stop(); return; }
    var modals = O.$$('.modal-back');
    if (modals.length) {
      var top = modals[modals.length - 1];
      escape(); /* U.modal closes only the top one on Escape */
      if (top.parentNode) { var x = top.querySelector('.modal-x'); if (x) x.click(); if (top.parentNode) top.remove(); }
      return;
    }
    if (O.$('.drawer')) { escape(); if (O.$('.drawer')) { O.$$('.drawer, .drawer-back').forEach(function (x) { x.remove(); }); } return; }
    var full = O.$('.wb-full');
    if (full) { var c = full.querySelector('[data-act="close-full"]'); if (c) c.click(); else full.remove(); return; }
    var side = O.$('.side.open');
    if (side) { var scrim = O.$('.scrim'); if (scrim) scrim.click(); else side.classList.remove('open'); return; }
    /* a screen's own back button: the inbox on a phone (from a chat back to the list), and the sign-in screens
       ("Request access" back to sign in) */
    var own = O.$('#page-root [data-act="back"]');
    if (!shown(own)) own = O.$('#auth-root [data-go="back"]');
    if (shown(own)) { own.click(); return; }
    if (!O.$('#app').hidden && O._started) {
      while (trail.length) {
        var p = trail.pop();
        if (p !== O.state.page && O.pages[p] && O.allowed(p)) { goPage(p); return; }
      }
    }
    if (App && App.minimizeApp) App.minimizeApp().catch(function () { if (App.exitApp) App.exitApp(); });
    else if (App && App.exitApp) App.exitApp();
  }
  if (App && platform === 'android') App.addListener('backButton', back);

  /* ---------------- status bar / navigation bar icons follow the colour under them ---------------- */
  function bgAt(x, y) {
    var el = document.elementFromPoint(x, y);
    while (el && el.nodeType === 1) {
      var c = getComputedStyle(el).backgroundColor, m = c && c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
      if (m && (m[4] === undefined || +m[4] > 0.5)) return [+m[1], +m[2], +m[3]];
      el = el.parentElement;
    }
    return [255, 255, 255];
  }
  var barStyle = {}, barTimer = null;
  function styleAt(y) {
    var rgb = bgAt(Math.round(window.innerWidth / 2), y);
    var lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    return lum < 0.55 ? 'DARK' : 'LIGHT'; /* DARK = light icons for a dark background */
  }
  function setBar(bar, style) {
    if (barStyle[bar] === style) return;
    barStyle[bar] = style;
    Bars.setStyle({ style: style, bar: bar }).catch(function () { barStyle[bar] = null; });
  }
  function paintBar() {
    barTimer = null;
    if (!Bars || !Bars.setStyle) return;
    /* Android System WebView older than 140: SystemBars cannot pass the insets through, so it pads the app below the
       bars (and sets --safe-area-inset-top to 0px). The bars then sit over the window background, not the page. That
       background is a fixed light colour (android res/values/colors.xml), so dark icons on both bars. Not DEFAULT: the
       plugin turns DEFAULT into LIGHT or DARK once, and on Android 10 and 11 a later switch of the phone's theme would
       leave the icons the same colour as a background that followed the theme */
    if (platform === 'android' && document.documentElement.style.getPropertyValue('--safe-area-inset-top').trim() === '0px') {
      setBar('StatusBar', 'LIGHT'); setBar('NavigationBar', 'LIGHT'); return;
    }
    /* each bar follows the colour under it. Android applies a style without a bar to both bars, and iOS ignores the bar
       (its home indicator adapts by itself), so iOS only gets the status bar's */
    setBar('StatusBar', styleAt(1));
    if (platform === 'android') setBar('NavigationBar', styleAt(window.innerHeight - 2));
  }
  function soon() { if (!barTimer) barTimer = setTimeout(paintBar, 120); }
  new MutationObserver(soon).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
  window.addEventListener('resize', soon);
  /* what sits under the bars also changes as pages scroll and when a slide-in (the side menu) finishes moving */
  window.addEventListener('scroll', soon, { passive: true, capture: true });
  document.addEventListener('transitionend', soon, true);
  document.addEventListener('animationend', soon, true);

  /* ---------------- splash screen: hide once the first screen is drawn ---------------- */
  var t0 = Date.now();
  (function waitForFirstScreen() {
    var ready = O._started || O.$('#auth-root') || !O.$('#guest-root').hidden || (O.$('#page-root') && O.$('#page-root').children.length) || Date.now() - t0 > 8000;
    if (!ready) { setTimeout(waitForFirstScreen, 80); return; }
    paintBar();
    if (Splash) Splash.hide({ fadeOutDuration: 200 }).catch(function () {});
  })();

  /* ---------------- booking alerts: phone notifications ----------------
     O.native.push.enable(ask) -> Promise {ok, message}: asks for permission when ask is true (otherwise only when it
     was already given), makes the "Booking alerts" channel, registers with Firebase and sends the token to
     /api/alerts. The first time an owner or ops manager opens a workspace on this phone it is asked once by itself. */
  if (Push && O.auth && O.auth.enabled && O.auth.enabled()) {
    var pushToken = null, waiting = [], ASKED = 'pushAsked';
    var canAlert = function () { var r = O.auth.role && O.auth.role(); return !!O.auth.orgId() && (r === 'owner' || r === 'ops'); };
    var settle = function (r) { var w = waiting; waiting = []; w.forEach(function (fn) { fn(r); }); };
    var sendToken = function (token) {
      if (!canAlert()) return Promise.resolve({ ok: false, message: 'Booking alerts are for account owners and ops managers.' });
      return O.auth.call('/api/alerts', { action: 'register-device', orgId: O.auth.orgId(), token: token, platform: platform })
        .then(function () { return { ok: true }; }, function (e) { return { ok: false, message: (e && e.message) || 'This phone could not be signed up for alerts.' }; });
    };
    Push.addListener('registration', function (t) { pushToken = t && t.value; sendToken(pushToken).then(settle); });
    Push.addListener('registrationError', function (e) { settle({ ok: false, message: 'The phone could not sign up for notifications' + (e && e.error ? ': ' + e.error : '.') }); });
    Push.addListener('pushNotificationReceived', function (n) { /* the app is open: a toast instead of a system notification */
      if (n && n.title) U.toast(n.title + (n.body ? ': ' + String(n.body).split('\n')[0] : ''));
    });
    Push.addListener('pushNotificationActionPerformed', function (a) {
      var id = a && a.notification && a.notification.data && a.notification.data.bookingId;
      if (!id) return;
      (function open(tries) {
        if (O._started && O.booking && O.data.bookings && O.data.bookings.some(function (b) { return b.id === id; })) { O.booking.open(id); return; }
        if (tries > 0) setTimeout(function () { open(tries - 1); }, 500);
        else if (O._started) O.go('bookings');
      })(20);
    });
    var enable = function (ask) {
      if (!canAlert()) return Promise.resolve({ ok: false, message: 'Booking alerts are for account owners and ops managers.' });
      return Push.checkPermissions().then(function (p) {
        if (p.receive === 'granted') return p;
        if (!ask || p.receive === 'denied') return p;
        return Push.requestPermissions();
      }).then(function (p) {
        if (p.receive !== 'granted') return { ok: false, message: 'Notifications are off for Orbique. Turn them on in the phone\'s settings (Apps, Orbique, Notifications).' };
        var channel = platform === 'android' && Push.createChannel ? Push.createChannel({ id: 'bookings', name: 'Booking alerts', description: 'New bookings, cancellations and date changes', importance: 5, visibility: 1, vibration: true }).catch(function () {}) : Promise.resolve();
        return channel.then(function () {
          return new Promise(function (resolve) {
            waiting.push(resolve);
            Push.register().catch(function (e) { settle({ ok: false, message: (e && e.message) || 'The phone could not sign up for notifications.' }); });
            setTimeout(function () { settle({ ok: false, message: 'The phone did not answer. Check the internet connection and try again.' }); }, 20000);
          });
        });
      }, function (e) { return { ok: false, message: (e && e.message) || 'Notifications are not available on this phone.' }; });
    };
    O.native.push = { enable: enable };
    /* once the workspace is open: refresh the token quietly, or ask the first time */
    (function whenStarted(tries) {
      if (!O._started) { if (tries > 0) setTimeout(function () { whenStarted(tries - 1); }, 1000); return; }
      if (!canAlert()) return;
      var key = ASKED + ':' + O.auth.orgId(), asked = O.store.get(key);
      setTimeout(function () { enable(!asked).then(function () { O.store.set(key, '1'); }); }, asked ? 500 : 2500);
    })(120);
    /* signing out: this phone stops getting the workspace's alerts */
    var signOut = O.auth.signOut;
    O.auth.signOut = function () {
      if (!pushToken) return signOut.apply(this, arguments);
      var args = arguments, self = this, stop = O.auth.call('/api/alerts', { action: 'unregister-device', orgId: O.auth.orgId(), token: pushToken }).catch(function () {});
      return Promise.race([stop, new Promise(function (r) { setTimeout(r, 2500); })]).then(function () { return signOut.apply(self, args); });
    };
  }

  /* ---------------- coming back to the app ---------------- */
  if (App) App.addListener('appStateChange', function (s) {
    if (!s || !s.isActive) { if (O.voice && O.voice.speaking && O.voice.speaking()) O.voice.stop(); return; }
    if (!O._started) return;
    try { /* catch up with the clock now rather than at its next 15-second tick (same steps as O.clock.start) */
      var D = O.data, before = D.NOW, newDay = O.clock.apply();
      if (D.NOW === before) return;
      if (newDay) { O.rollStatuses(); O.automation.run('day'); O.emit('day'); O.emit('data'); }
      O.emit('tick');
    } catch (e) {}
  });
})();
