#!/usr/bin/env python3
"""Run the phone app's files (mobile/www) in Chromium while playing Capacitor's native side, and check app/native/bridge.js.

    node scripts/build.mjs --mobile
    python3 tests/native_sim.py --out /tmp/native
    python3 tests/native_sim.py --out /tmp/native --only android,insets

The files are served by a small local server started here (http://localhost:<port>; the real Android app runs on
https://localhost, iOS on capacitor://localhost). Before any page script runs, the test adds what the native shell
injects into the app view, in the same order:
    window.Capacitor = {DEBUG, isLoggingEnabled, Plugins: {}} and window.WEBVIEW_SERVER_URL
    the transport: Android window.androidBridge.postMessage(json), answers through androidBridge.onmessage;
                   iOS window.webkit.messageHandlers.bridge.postMessage(obj), answers through Capacitor.fromNative,
                   and prompt() answers for the cookie / http checks
    Capacitor's own native-bridge.js (node_modules/@capacitor/android/.../assets/native-bridge.js, or the iOS copy)
    the plugin JS and window.Capacitor.PluginHeaders, so registerPlugin() in vendor/capacitor.js and the cap-*.js
    plugins builds native proxies (a plugin call becomes {callbackId, pluginId, methodName, options} on the transport)
A fake native side answers those calls and records each one in window.__nativeCalls [{plugin, method, options}]:
App (addListener / removeListener / removeAllListeners, minimizeApp, exitApp), Browser.open, Filesystem.writeFile
(returns a file:// uri in the app cache), Share.share (window.__sim.shareError makes it fail, e.g. "Share canceled"),
SplashScreen.hide, SystemBars.setStyle, TextToSpeech.speak (answers after __sim.ttsMs; a stopped sentence never
answers on Android and is resolved on iOS, like the real plugins), .stop, .isLanguageSupported, and Keyboard.
Listeners are kept by callback id and called again with each event, as the native side does.
    window.__simBack()          presses the Android back button like the App plugin (backButton event, then the
                                document "backbutton" event; with no listener the app view goes back in history)
    window.__simAppState(bool)  the app goes to the background (false) or comes back (true)

Set-ups (--only picks some):
    android   390x844 Android: boot, downloads (CSV, the dashboard run sheet PDF, an invoice PDF, a cancelled and a
              failed share), read aloud (sentences in order, stop, a second read-aloud, back and background while
              reading), the back button (menus, stacked modals, booking drawer, side menu, page history, website
              preview, then minimize), outside links (window.open, target=_blank, tel:, mailto:, wa.me, same-origin)
    insets    Android with a 47px status bar and 34px home bar; landscape 844x390 with 47px left/right.
              env() cannot be faked in Chromium, so index.html is served with env(safe-area-inset-*) rewritten to
              var(--sim-inset-*) and those set per screen (this also covers rules that use env() directly, like the
              tab bar). Screenshots with the inset bands drawn in red + checks that bars and buttons clear them.
    ios       390x844 iOS: boot, a download, read aloud, a second read-aloud, no back-button listener
    browser   the same files with no native shell: the bridge stays off (no html.native) and the app still boots

Screenshots go to <out>/<set-up>/*.png. Prints PASS/FAIL per check and writes <out>/results.json;
exit code 1 when any check fails.
"""
import argparse, base64, functools, http.server, json, os, re, sys, threading
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WWW = os.path.join(ROOT, 'mobile', 'www')
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
BRIDGE_JS = {
    'android': os.path.join(ROOT, 'node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js'),
    'ios': os.path.join(ROOT, 'node_modules/@capacitor/ios/Capacitor/Capacitor/assets/native-bridge.js'),
}
DEMO_NOW = '2026-10-06T10:15'

# Plugins the app's native project registers, with their methods (from the plugins' @PluginMethod / CAPPluginMethod
# lists). Every plugin also has the base methods; rtype 'promise' unless marked ':callback'. SystemBars, WebView,
# CapacitorCookies and CapacitorHttp are built into Capacitor's runtime.
BASE_METHODS = [('addListener', None), ('removeListener', None), ('removeAllListeners', 'promise'),
                ('checkPermissions', 'promise'), ('requestPermissions', 'promise')]
NATIVE_PLUGINS = {
    'App': 'exitApp getInfo getLaunchUrl getState minimizeApp toggleBackButtonHandler getAppLanguage',
    'Browser': 'open close',
    'Filesystem': 'readFile readFileInChunks:callback writeFile appendFile deleteFile mkdir rmdir readdir getUri stat rename copy downloadFile',
    'Share': 'canShare share',
    'SplashScreen': 'show hide',
    'Keyboard': 'show hide setAccessoryBarVisible setScroll setStyle setResizeMode getResizeMode',
    'TextToSpeech': 'speak stop getSupportedLanguages getSupportedVoices isLanguageSupported openInstall',
    'SystemBars': 'setStyle show hide setAnimation',
    'WebView': 'setServerAssetPath setServerBasePath getServerBasePath persistServerBasePath',
    'CapacitorCookies': 'getCookies setCookie deleteCookie clearCookies clearAllCookies',
    'CapacitorHttp': 'request get post put patch delete',
}

# What the native shell provides before the page's own scripts (the global object, the transport and a fake native
# side). __SIM_CONFIG__ is replaced with JSON.
NATIVE_SHELL_JS = r"""
(function () {
  'use strict';
  var SIM = window.__sim = Object.assign({ platform: 'android', latency: 4, ttsMs: 120, shareError: null, speakError: null,
    ttsUnavailable: false, langs: ['en-GB', 'en-US'] }, __SIM_CONFIG__);
  var calls = window.__nativeCalls = [];
  var spoken = window.__ttsSpoken = [];
  var listeners = window.__nativeListeners = {};
  var files = window.__nativeFiles = {};
  window.__barState = { StatusBar: null, NavigationBar: null };
  if (SIM.platform === 'ios') delete window.__barState.NavigationBar;
  /* 1. JSExport global + WEBVIEW_SERVER_URL */
  window.Capacitor = { DEBUG: false, isLoggingEnabled: false, Plugins: {} };
  window.WEBVIEW_SERVER_URL = location.origin;

  /* answers go back asynchronously, like the native side (Android: reply proxy -> androidBridge.onmessage;
     iOS: evaluateJavaScript("window.Capacitor.fromNative({...})")) */
  function deliver(res) {
    setTimeout(function () {
      if (SIM.platform === 'android') { if (window.androidBridge.onmessage) window.androidBridge.onmessage({ data: JSON.stringify(res) }); }
      else window.Capacitor.fromNative(res);
    }, SIM.latency);
  }
  function ok(c, data) { deliver({ callbackId: c.callbackId, pluginId: c.pluginId, methodName: c.methodName, save: false, success: true, data: data || {} }); }
  function err(c, message, code) { deliver({ callbackId: c.callbackId, pluginId: c.pluginId, methodName: c.methodName, save: false, success: false, error: { message: message, code: code || null } }); }
  /* plugin events: every listener's kept call (callback id) is answered again with the event data */
  function emit(plugin, event, data) {
    var ids = ((listeners[plugin] || {})[event] || []).slice();
    ids.forEach(function (id) { deliver({ callbackId: id, pluginId: plugin, methodName: 'addListener', save: true, success: true, data: data || {} }); });
    return ids.length;
  }
  window.__simEmit = emit;

  /* text to speech: QUEUE_FLUSH stops what is playing. Android's plugin clears its requests on stop, so the stopped
     sentence's call never answers; iOS resolves it from speechSynthesizer(didCancel:) */
  var tts = window.__tts = { pending: [], dropped: [] };
  function ttsFinish(p) { var i = tts.pending.indexOf(p); if (i < 0) return; tts.pending.splice(i, 1); spoken.push(p.text); ok(p.call); }
  function ttsCancelAll() {
    tts.pending.splice(0).forEach(function (p) {
      clearTimeout(p.timer);
      if (SIM.platform === 'ios') ok(p.call); else tts.dropped.push(p.text);
    });
  }
  var dirs = SIM.platform === 'android'
    ? { CACHE: 'file:///data/user/0/com.orbique.app/cache/', DATA: 'file:///data/user/0/com.orbique.app/files/', DOCUMENTS: 'file:///storage/emulated/0/Documents/' }
    : { CACHE: 'file:///var/mobile/Containers/Data/Application/SIM/Library/Caches/', DATA: 'file:///var/mobile/Containers/Data/Application/SIM/Documents/', DOCUMENTS: 'file:///var/mobile/Containers/Data/Application/SIM/Documents/' };
  var H = {
    'App.minimizeApp': ok, 'App.exitApp': ok, 'App.toggleBackButtonHandler': ok,
    'App.getState': function (c) { ok(c, { isActive: true }); },
    'App.getInfo': function (c) { ok(c, { name: 'Orbique', id: 'com.orbique.app', build: '1', version: '1.0.0' }); },
    'App.getLaunchUrl': function (c) { ok(c, {}); },
    'App.getAppLanguage': function (c) { ok(c, { value: 'en' }); },
    'Browser.open': function (c) { if (!(c.options || {}).url) return err(c, 'Must provide a URL to open'); ok(c); },
    'Browser.close': ok,
    'Filesystem.writeFile': function (c) {
      var o = c.options || {};
      if (!o.path) return err(c, 'path must be provided and must be a string.');
      if (o.directory && !dirs[o.directory]) return err(c, 'unsupported directory ' + o.directory);
      if (/\//.test(o.path) && !o.recursive) return err(c, 'Parent folder doesn\'t exist');
      var uri = (dirs[o.directory] || 'file:///') + String(o.path).replace(/^\/+/, '');
      files[uri] = { data: o.data, encoding: o.encoding || null };
      ok(c, { uri: uri });
    },
    'Filesystem.getUri': function (c) { var o = c.options || {}; ok(c, { uri: (dirs[o.directory] || 'file:///') + o.path }); },
    'Share.share': function (c) {
      var o = c.options || {}, f = o.files || [];
      if (SIM.shareError) return err(c, SIM.shareError);
      if (!o.text && !o.url && !f.length) return err(c, 'Must provide a URL or Message or files');
      for (var i = 0; i < f.length; i++) if (!/^file:/.test(f[i]) || !files[f[i]]) return err(c, 'only file urls are supported');
      ok(c, { activityType: SIM.platform === 'android' ? 'com.google.android.apps.docs' : 'com.apple.DocumentManagerUICore.SaveToFiles' });
    },
    'Share.canShare': function (c) { ok(c, { value: true }); },
    'SplashScreen.hide': ok, 'SplashScreen.show': ok,
    /* the icon colour each bar shows: Android applies a style without "bar" to both bars; iOS ignores "bar" and only
       styles the status bar */
    'SystemBars.setStyle': function (c) {
      var o = c.options || {}, s = o.style || 'DEFAULT';
      if (SIM.platform === 'ios' || !o.bar || o.bar === 'StatusBar') window.__barState.StatusBar = s;
      if (SIM.platform === 'android' && (!o.bar || o.bar === 'NavigationBar')) window.__barState.NavigationBar = s;
      ok(c);
    },
    'SystemBars.show': ok, 'SystemBars.hide': ok, 'SystemBars.setAnimation': ok,
    'TextToSpeech.speak': function (c) {
      var o = c.options || {}, lang = o.lang || 'en-US';
      if (SIM.ttsUnavailable) return err(c, 'Not yet initialized or not available on this device.', 'UNAVAILABLE');
      if (SIM.speakError) return err(c, SIM.speakError);
      if (SIM.langs.indexOf(lang) < 0) return err(c, 'This language is not supported.');
      if (SIM.failText && o.text === SIM.failText) return err(c, 'An error occurred while speaking');
      if (!o.queueStrategy) ttsCancelAll();
      var p = { call: c, text: o.text };
      p.timer = setTimeout(function () { ttsFinish(p); }, SIM.ttsMs);
      tts.pending.push(p);
    },
    'TextToSpeech.stop': function (c) { ttsCancelAll(); ok(c); },
    /* with no speech engine (or before it started) Android's isLanguageAvailable says no for every language */
    'TextToSpeech.isLanguageSupported': function (c) { ok(c, { supported: !SIM.ttsUnavailable && SIM.langs.indexOf((c.options || {}).lang) >= 0 }); },
    'TextToSpeech.getSupportedLanguages': function (c) { ok(c, { languages: SIM.ttsUnavailable ? [] : SIM.langs.slice() }); },
    'TextToSpeech.getSupportedVoices': function (c) { ok(c, { voices: [] }); }
  };
  function handle(c) {
    if (!c || !c.pluginId || c.pluginId === 'Console') return; /* js.error reports, iOS console mirroring */
    var o = c.options || {};
    calls.push({ plugin: c.pluginId, method: c.methodName, options: JSON.parse(JSON.stringify(o)), callbackId: c.callbackId, at: Date.now() });
    if (c.methodName === 'addListener') { var L = listeners[c.pluginId] = listeners[c.pluginId] || {}; (L[o.eventName] = L[o.eventName] || []).push(c.callbackId); return; }
    if (c.methodName === 'removeListener') { var R = (listeners[c.pluginId] || {})[o.eventName]; if (R && R.indexOf(o.callbackId) >= 0) R.splice(R.indexOf(o.callbackId), 1); return; }
    if (c.methodName === 'removeAllListeners') { delete listeners[c.pluginId]; ok(c); return; }
    var h = H[c.pluginId + '.' + c.methodName] || (c.pluginId === 'Keyboard' ? ok : null);
    if (h) h(c); else err(c, '"' + c.pluginId + '.' + c.methodName + '()" is not implemented in the simulation', 'UNIMPLEMENTED');
  }

  /* 2. the transport */
  if (SIM.platform === 'android') {
    window.androidBridge = { postMessage: function (json) { handle(JSON.parse(json)); } };
  } else {
    window.webkit = { messageHandlers: { bridge: { postMessage: function (obj) { handle(JSON.parse(JSON.stringify(obj))); } } } };
    var realPrompt = window.prompt;
    window.prompt = function (msg) { /* native-bridge.js asks synchronously whether CapacitorCookies / CapacitorHttp are on */
      try { var q = JSON.parse(msg); if (q && /^Capacitor(Cookies|Http)/.test(q.type)) return 'false'; } catch (e) { /* not ours */ }
      return realPrompt.apply(window, arguments);
    };
  }

  /* the device's own buttons */
  window.__simBack = function () {
    calls.push({ plugin: '(device)', method: 'backPressed', options: {}, at: Date.now() });
    if (((listeners.App || {}).backButton || []).length) {
      emit('App', 'backButton', { canGoBack: history.length > 1 });
      setTimeout(function () { window.Capacitor.triggerEvent('backbutton', 'document'); }, SIM.latency);
      return 'backButton';
    }
    if (history.length > 1) { history.back(); return 'webview.goBack'; }
    return 'ignored';
  };
  window.__simAppState = function (active) { emit('App', 'appStateChange', { isActive: !!active }); return emit('App', active ? 'resume' : 'pause', {}); };
})();
"""

INSET_STYLE = '<style id="sim-insets">:root{--sim-inset-top:0px;--sim-inset-right:0px;--sim-inset-bottom:0px;--sim-inset-left:0px;}</style>'
INSET_BANDS_JS = """(ins) => {
  document.querySelectorAll('.sim-band').forEach(x => x.remove());
  const W = innerWidth, H = innerHeight, mk = (css) => { const d = document.createElement('div'); d.className = 'sim-band';
    d.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:rgba(255,0,0,0.28);' + css; document.documentElement.appendChild(d); };
  if (ins.top) mk('left:0;right:0;top:0;height:' + ins.top + 'px');
  if (ins.bottom) mk('left:0;right:0;bottom:0;height:' + ins.bottom + 'px');
  if (ins.left) mk('top:0;bottom:0;left:0;width:' + ins.left + 'px');
  if (ins.right) mk('top:0;bottom:0;right:0;width:' + ins.right + 'px');
}"""


def plugin_js():
    """The plugin part of what Android's JSExport.getPluginJS / iOS's JSExport.exportJS inject."""
    headers, out = [], ['(function (w) { var a = (w.Capacitor = w.Capacitor || {}), p = (a.Plugins = a.Plugins || {}), t;']
    for name, spec in NATIVE_PLUGINS.items():
        methods = [dict(name=n, rtype=r) if r else dict(name=n) for n, r in BASE_METHODS]
        out.append("t = (p[%s] = {}); t.addListener = function (e, cb) { return w.Capacitor.addListener(%s, e, cb); };" % (json.dumps(name), json.dumps(name)))
        for m in spec.split():
            n, _, r = m.partition(':')
            methods.append(dict(name=n, rtype=r or 'promise'))
            if r == 'callback':
                out.append('t[%s] = function (o, cb) { return w.Capacitor.nativeCallback(%s, %s, o, cb); };' % (json.dumps(n), json.dumps(name), json.dumps(n)))
            else:
                out.append('t[%s] = function (o) { return w.Capacitor.nativePromise(%s, %s, o); };' % (json.dumps(n), json.dumps(name), json.dumps(n)))
        headers.append(dict(name=name, methods=methods))
    out.append('a.PluginHeaders = %s; })(window);' % json.dumps(headers))
    return '\n'.join(out)


def native_init_script(platform, **cfg):
    cfg['platform'] = platform
    with open(BRIDGE_JS[platform], encoding='utf-8') as f:
        bridge = f.read()
    return '\n'.join([NATIVE_SHELL_JS.replace('__SIM_CONFIG__', json.dumps(cfg)), bridge, plugin_js()])


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def serve(root):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=root))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, 'http://localhost:%d' % srv.server_address[1]


class Run:
    """One browser page in one set-up, with its JS errors and the results of its checks."""

    def __init__(self, browser, base, name, out, platform=None, w=390, h=844, insets=False, **cfg):
        self.name, self.base, self.out, self.platform = name, base, os.path.join(out, name), platform
        os.makedirs(self.out, exist_ok=True)
        self.ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, is_mobile=True, has_touch=True)
        self.ctx.add_init_script('window.ORBIQUE_NOW = %s;' % json.dumps(DEMO_NOW))
        if platform:
            self.ctx.add_init_script(native_init_script(platform, **cfg))
        self.pg = self.ctx.new_page()
        self.errors, self.allow, self.results, self.handed, self.popups = [], [], [], [], []
        vendor = os.path.join(HERE, 'vendor', 'jspdf.umd.min.js')
        self.pg.route('https://cdnjs.cloudflare.com/**', lambda r: r.fulfill(path=vendor, content_type='application/javascript') if os.path.exists(vendor) else r.abort())
        self.pg.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        self.pg.route('https://fonts.gstatic.com/**', lambda r: r.abort())
        # nothing may leave the app view: any other outside address is recorded and stopped
        self.pg.route(re.compile(r'^https?://(?!localhost[:/]|127\.0\.0\.1[:/]).*'), self._outside)
        if insets:
            self.pg.route(re.compile(r'.*/index\.html(\?.*)?$'), self._rewrite_env)
        self.local = []  # paths requested from the app's own files
        self.pg.on('request', self._request)
        self.ctx.on('page', lambda p: self.popups.append(p.url))
        self.pg.on('pageerror', lambda e: self._error('pageerror: ' + str(e).splitlines()[0][:300]))
        self.pg.on('console', lambda m: self._error('console.error: ' + m.text[:300]) if m.type == 'error' and not re.search(r"net::ERR|Failed to load resource|(Not allowed|Failed) to launch '", m.text) else None)

    def _request(self, req):
        if req.is_navigation_request() and re.match(r'^(tel|mailto|sms|whatsapp|geo):', req.url):
            self.handed.append(req.url)  # Capacitor hands these to the phone (dialer, mail, WhatsApp)
        elif req.url.startswith(self.base):
            self.local.append(req.url[len(self.base):])

    def _outside(self, route):
        if route.request.is_navigation_request():
            self.handed.append(route.request.url)
        route.abort('aborted')

    def _rewrite_env(self, route):
        res = route.fetch()
        body = re.sub(r'env\(safe-area-inset-(top|right|bottom|left)', lambda m: 'var(--sim-inset-' + m.group(1), res.text())
        body = body.replace('<head>', '<head>\n' + INSET_STYLE, 1)
        route.fulfill(response=res, body=body)

    def _error(self, msg):
        if not any(a in msg for a in self.allow):
            self.errors.append(msg)

    # ---- helpers
    def check(self, label, ok, detail='', known=None):
        """known: a failure caused by another file (reported there, with the proposed fix); it prints KNOWN and does
        not fail the run. When it passes, the issue was fixed and the marker can go."""
        ok = bool(ok)
        status = 'PASS' if ok else ('KNOWN' if known else 'FAIL')
        self.results.append(dict(setup=self.name, check=label, ok=ok or bool(known), status=status, known=known if not ok else None,
                                 detail='' if ok else str(detail)[:400]))
        print('  %-5s %s%s' % (status, label, '' if ok else '  ->  ' + str(detail)[:300] + ('  [' + known + ']' if known else '')))
        return ok

    def js(self, expr, arg=None):
        return self.pg.evaluate(expr, arg)

    def wait(self, ms):
        self.pg.wait_for_timeout(ms)

    def until(self, expr, arg=None, timeout=5000):
        try:
            self.pg.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    def calls(self, plugin=None, method=None):
        return self.js("([p, m]) => __nativeCalls.filter(c => (!p || c.plugin === p) && (!m || c.method === m))", [plugin, method])

    def clear_calls(self):
        self.js('() => { __nativeCalls.length = 0; __ttsSpoken.length = 0; }')

    def boot(self, path='/index.html'):
        self.pg.goto(self.base + path)
        ok = self.until('() => window.O && O._started', timeout=20000)
        self.wait(700)
        return ok

    def back(self, settle=150):
        r = self.js('() => __simBack()')
        self.wait(settle)
        return r

    def shot(self, name):
        p = os.path.join(self.out, name + '.png')
        self.pg.screenshot(path=p)
        return p

    def toasts(self):
        return self.js("() => [...document.querySelectorAll('.toast')].map(t => ({text: t.textContent, bad: t.classList.contains('bad')}))")

    def clear_ui(self):
        self.js("() => { document.querySelectorAll('.modal-back, .drawer, .drawer-back, .toast').forEach(x => x.remove()); document.querySelectorAll('.open').forEach(x => x.classList.remove('open')); }")

    def close(self):
        self.ctx.close()


def b64text(s):
    return base64.b64decode(s).decode('utf-8')


# ------------------------------------------------------------------ Android phone
def android(browser, base, out):
    r = Run(browser, base, 'android', out, 'android', ttsMs=60)
    pg = r.pg
    print('android (390x844)')
    booted = r.boot()
    r.check('boots (O._started)', booted)
    r.shot('dashboard')
    info = r.js("""() => ({ cls: document.documentElement.className, platform: O.native && O.native.platform,
        started: O._started, page: O.state.page, voice: O.voice.available() })""")
    r.check('html has classes native and native-android', 'native' in info['cls'].split() and 'native-android' in info['cls'].split(), info['cls'])
    r.check("O.native.platform === 'android'", info['platform'] == 'android', info['platform'])
    r.check('SplashScreen.hide called', r.calls('SplashScreen', 'hide'))
    bars = r.calls('SystemBars', 'setStyle')
    r.check('SystemBars.setStyle called', bars, bars)
    r.check('status and navigation bars LIGHT (dark icons) over the white top bar and tab bar', r.js('() => __barState') == {'StatusBar': 'LIGHT', 'NavigationBar': 'LIGHT'}, r.js('() => __barState'))
    lis = r.js('() => __nativeListeners.App || {}')
    r.check('App backButton listener registered', len(lis.get('backButton', [])) == 1, lis)
    r.check('App appStateChange listener registered', len(lis.get('appStateChange', [])) >= 1, lis)
    r.check('read aloud reports available', info['voice'])

    # ---- downloads
    r.clear_calls()
    res = r.js("() => O.downloadCSV('t.csv', [['a','b'],[1,2]])")
    r.wait(100)
    w = r.calls('Filesystem', 'writeFile')
    s = r.calls('Share', 'share')
    r.check('CSV: resolves true', res is True, res)
    if r.check('CSV: Filesystem.writeFile called once', len(w) == 1, w):
        o = w[0]['options']
        r.check('CSV: written to the cache as exports/t.csv', o.get('directory') == 'CACHE' and o.get('path') == 'exports/t.csv' and o.get('recursive') is True, {k: v for k, v in o.items() if k != 'data'})
        txt = b64text(o.get('data', ''))
        r.check('CSV: base64 decodes to the CSV', txt == '﻿a,b\r\n1,2', repr(txt))
        uri = r.js("() => Object.keys(__nativeFiles).pop()")
        r.check('CSV: Share.share with files [the written uri]', len(s) == 1 and s[0]['options'].get('files') == [uri], s)
    r.check('CSV: "Ready" toast', any('t.csv' in t['text'] and not t['bad'] for t in r.toasts()), r.toasts())

    # a PDF from a real screen: the dashboard's Run sheet button
    r.clear_calls()
    r.js("() => { O.go('dashboard'); window.scrollTo(0, 0); }")
    r.wait(400)
    has_rs = r.js("() => !!document.querySelector('[data-act=runsheet]')")
    if r.check('dashboard has the Run sheet (PDF) button', has_rs):
        pg.click('[data-act=runsheet]')
        r.until("() => __nativeCalls.some(c => c.plugin === 'Share')", timeout=15000)
        w = r.calls('Filesystem', 'writeFile')
        s = r.calls('Share', 'share')
        if r.check('run sheet PDF: Filesystem.writeFile called', len(w) == 1, w):
            o = w[0]['options']
            pdf = base64.b64decode(o['data'])
            r.check('run sheet PDF: file is a PDF named run-sheet-*.pdf', o['path'].startswith('exports/run-sheet-') and o['path'].endswith('.pdf') and pdf[:5] == b'%PDF-', (o['path'], pdf[:8]))
            r.check('run sheet PDF: Share.share with that file', len(s) == 1 and s[0]['options']['files'][0].endswith(o['path']), s)
    # an invoice PDF: the invoice window's Download PDF button
    r.clear_calls()
    r.js("() => { const b = O.data.bookings.find(b => b.invoiceNo && b.status !== 'cancelled'); O.invoice.preview(b, 'invoice'); }")
    r.wait(300)
    btn = pg.locator('.modal-foot button', has_text='Download PDF')
    if r.check('invoice window has a Download PDF button', btn.count() == 1):
        btn.click()
        r.until("() => __nativeCalls.some(c => c.plugin === 'Share')", timeout=15000)
        w = r.calls('Filesystem', 'writeFile')
        s = r.calls('Share', 'share')
        ok = len(w) == 1 and base64.b64decode(w[0]['options']['data'])[:5] == b'%PDF-' and w[0]['options']['path'].startswith('exports/Invoice-')
        r.check('invoice PDF: written (exports/Invoice-*.pdf) and shared', ok and len(s) == 1, [x['options'].get('path') for x in w] + s)
    r.clear_ui()
    # the person closes the share sheet without choosing anything
    r.clear_calls()
    r.js("() => { __sim.shareError = 'Share canceled'; }")
    res = r.js("() => O.downloadCSV('cancel.csv', [['x'],[1]])")
    r.check('cancelled share: resolves false', res is False, res)
    r.check('cancelled share: "Not saved" toast', any(t['text'] == 'Not saved' and t['bad'] for t in r.toasts()), r.toasts())
    r.check('cancelled share: no error toast', not any('Could not save' in t['text'] for t in r.toasts()), r.toasts())
    # sharing fails for another reason
    r.clear_ui()
    r.allow.append('download failed')
    r.js("() => { __sim.shareError = 'Can\\'t share while sharing is in progress'; }")
    res = r.js("() => O.downloadCSV('busy.csv', [['x'],[1]])")
    r.check('failed share: resolves false with "Could not save" toast', res is False and any('Could not save busy.csv' in t['text'] for t in r.toasts()), (res, r.toasts()))
    r.js("() => { __sim.shareError = null; }")
    r.allow.remove('download failed')
    r.clear_ui()

    # ---- read aloud
    r.js("() => { O.go('dashboard'); window.scrollTo(0, 0); }")
    r.wait(400)
    r.clear_calls()
    expected = r.js("""() => { const t = O.dashboardBrief.speech().join(' ');
        return (t.match(/(?:\\d\\.\\d|[^.!?])+[.!?]*/g) || [t]).map(s => s.trim()).filter(Boolean); }""")
    btn = '.dsh-brief-btn'
    if r.check('dashboard has the Brief me button', r.js("() => !!document.querySelector('.dsh-brief-btn[data-brief=start]')")):
        pg.click(btn)
        r.wait(80)
        r.shot('read-aloud')
        done = r.until("() => document.querySelector('.dsh-brief-btn') && document.querySelector('.dsh-brief-btn').dataset.brief === 'start'", timeout=15000)
        said = [c['options']['text'] for c in r.calls('TextToSpeech', 'speak')]
        r.check('read aloud: finished and the button is back to Brief me', done)
        r.check('read aloud: TextToSpeech.speak got the %d sentences in order' % len(expected), said == expected, {'said': said[:4], 'expected': expected[:4], 'n': [len(said), len(expected)]})
        sp = r.calls('TextToSpeech', 'speak')
        r.check('read aloud: speaks en-GB', sp and all(c['options'].get('lang') == 'en-GB' for c in sp), sp[:1])
        r.check('read aloud: panel shows the finished brief', r.js("() => !!document.querySelector('.dsh-brief [data-brief=start]')"))
        r.js('() => { __sim.ttsMs = 500; }')

        def start_reading(label):
            r.clear_calls()
            r.js("() => { const b = document.querySelector('.dsh-brief-btn[data-brief=stop]'); if (b) b.click(); }")  # a left-over reading
            pg.click('.dsh-brief-btn[data-brief=start]')
            ok = r.until("() => __nativeCalls.some(c => c.method === 'speak') && O.voice.speaking() && document.querySelector('.dsh-brief-btn').dataset.brief === 'stop'")
            r.check(label + ': reading started', ok)
            r.wait(100)
            r.clear_calls()
            return ok

        state = "() => ({ speaking: O.voice.speaking(), page: O.state.page, btn: document.querySelector('.dsh-brief-btn').dataset.brief, reading: !!document.querySelector('.dsh-tr.reading') })"
        # stop from the page's own Stop button
        if start_reading('stop'):
            pg.click('.dsh-brief-btn[data-brief=stop]')
            r.wait(1500)
            st = r.js(state)
            r.check('stop: TextToSpeech.stop called', r.calls('TextToSpeech', 'stop'))
            r.check('stop: no further sentence', not r.calls('TextToSpeech', 'speak'), r.calls('TextToSpeech', 'speak'))
            r.check('stop: not speaking, button back to Brief me', not st['speaking'] and st['btn'] == 'start' and not st['reading'], st)
        # back button while reading: stops it, stays on the page, and the page shows it has ended
        if start_reading('back while reading'):
            r.back(300)
            st = r.js(state)
            r.check('back while reading: TextToSpeech.stop called, still on the dashboard', r.calls('TextToSpeech', 'stop') and st['page'] == 'dashboard' and not st['speaking'], st)
            r.check('back while reading: the dashboard shows it ended (button Brief me, no "Reading")', st['btn'] == 'start' and not st['reading'], st)
            r.wait(1000)
            r.check('back while reading: no further sentence', not r.calls('TextToSpeech', 'speak'), r.calls('TextToSpeech', 'speak'))
            r.check('back while reading: did not also leave the page or minimize', not r.calls('App', 'minimizeApp') and r.js('() => O.state.page') == 'dashboard')
        # the app goes to the background while reading
        if start_reading('background while reading'):
            r.js('() => __simAppState(false)')
            r.wait(300)
            st = r.js(state)
            r.check('background while reading: stops and the dashboard shows it ended', r.calls('TextToSpeech', 'stop') and not st['speaking'] and st['btn'] == 'start' and not st['reading'], st)
            r.js('() => __simAppState(true)')
            r.wait(100)
    # a second read-aloud while the first is still speaking
    r.clear_calls()
    r.js("""() => { window.__ends = []; __sim.ttsMs = 250;
        O.voice.speak(['First one.', 'First two.', 'First three.'], { onend: (ok) => __ends.push('first') });
        setTimeout(() => O.voice.speak(['Second one.', 'Second two.'], { onend: (ok) => __ends.push('second') }), 120); }""")
    r.wait(1600)
    said = [c['options']['text'] for c in r.calls('TextToSpeech', 'speak')]
    ends = r.js('() => __ends')
    r.check('second read-aloud: the first one stops after its current sentence', said == ['First one.', 'Second one.', 'Second two.'], said)
    r.check('second read-aloud: each onend once, first then second', ends == ['first', 'second'], ends)
    r.check('second read-aloud: not speaking at the end', r.js('() => !O.voice.speaking()'))
    # the phone has no British English voice: it reads in American English instead of failing every sentence
    r.clear_calls()
    r.js("() => { __sim.ttsMs = 30; __sim.langs = ['en-US']; window.__ends = []; O.voice.speak(['Alpha.', 'Beta.'], { onend: (ok) => __ends.push(ok) }); }")
    r.until('() => __ends.length > 0')
    sp = r.calls('TextToSpeech', 'speak')
    r.check('no en-GB voice: reads both sentences in en-US', [c['options'].get('lang') for c in sp] == ['en-US', 'en-US'] and r.js('() => __ends') == [True], ([c['options'] for c in sp], r.js('() => __ends')))
    r.js("() => { __sim.langs = ['en-GB', 'en-US']; }")
    # the phone cannot speak at all (no speech engine): the brief shows its text with the note instead of claiming it read it
    r.clear_calls()
    r.js("() => { __sim.ttsUnavailable = true; O.go('dashboard'); }")
    r.wait(300)
    pg.click(btn)
    r.wait(2000)
    st = r.js("() => ({ btn: document.querySelector('.dsh-brief-btn').dataset.brief, unavailable: !!document.querySelector('.dsh-brief .note.warn'), speaking: O.voice.speaking(), n: __nativeCalls.filter(c => c.method === 'speak').length })")
    r.check('no speech engine: brief shows the text with the "not available" note', st['btn'] == 'start' and st['unavailable'] and not st['speaking'], st)
    r.check('no speech engine: does not try to speak every sentence', st['n'] <= 1, st)
    r.js("() => { __sim.ttsUnavailable = false; }")
    # one sentence fails mid-way (engine error): the rest is still read
    r.clear_calls()
    r.js("() => { window.__ends = []; __sim.ttsMs = 30; __sim.failText = 'Two.'; O.voice.speak(['One.', 'Two.', 'Three.'], { onend: (ok) => __ends.push(ok) }); }")
    r.until('() => __ends.length > 0')
    said = [c['options']['text'] for c in r.calls('TextToSpeech', 'speak')]
    r.check('a sentence fails mid-way: the others are still read, onend(true)', said == ['One.', 'Two.', 'Three.'] and r.js('() => __ttsSpoken') == ['One.', 'Three.'] and r.js('() => __ends') == [True], (said, r.js('() => __ends')))
    r.js("() => { __sim.failText = null; }")
    r.clear_ui()

    # ---- back button
    print('  -- back button')
    r.js("() => { O.store.set('page', 'dashboard'); }")
    r.boot()
    r.clear_calls()
    # a popover menu (the notifications bell)
    if pg.locator('#bell-btn').is_visible():
        pg.click('#bell-btn')
    else:
        r.js("() => document.querySelector('#bell-menu').classList.add('open')")
    r.wait(100)
    opened = r.js("() => !!document.querySelector('.pop-menu.open')")
    r.shot('back-1-menu')
    r.back()
    r.check('back: open menu closes (page unchanged)', opened and r.js("() => !document.querySelector('.pop-menu.open, .ws-menu.open, .viewer-menu.open, .dr-pop.open') && O.state.page === 'dashboard'"), opened)
    # a real modal (change a door code)
    pg.click('#lock-btn') if pg.locator('#lock-btn').is_visible() else r.js('() => O.lock.change({})')
    r.wait(200)
    n1 = r.js("() => document.querySelectorAll('.modal-back').length")
    r.shot('back-2-modal')
    r.back()
    r.check('back: modal closes', n1 == 1 and r.js("() => document.querySelectorAll('.modal-back').length") == 0, n1)
    # two stacked modals: only the top one closes
    r.js("() => { O.ui.modal({ title: 'Bottom one', body: '<p>one</p>' }); O.ui.modal({ title: 'Top one', body: '<p>two</p>' }); }")
    r.wait(100)
    r.back()
    left = r.js("() => [...document.querySelectorAll('.modal-back h3')].map(h => h.textContent)")
    r.check('back: two stacked modals -> only the top one closes', left == ['Bottom one'], left)
    r.back()
    r.check('back: then the other one', r.js("() => document.querySelectorAll('.modal-back').length") == 0)
    # the booking drawer (opened from the bookings list)
    r.js("() => O.booking.open(O.data.bookings.find(b => b.status !== 'cancelled').id)")
    r.wait(200)
    had = r.js("() => !!document.querySelector('.drawer')")
    r.shot('back-3-drawer')
    r.back()
    r.check('back: booking drawer closes', had and r.js("() => !document.querySelector('.drawer, .drawer-back')"), had)
    # a modal on top of the drawer: modal first, then the drawer
    r.js("() => { O.booking.open(O.data.bookings.find(b => b.status !== 'cancelled').id); O.ui.modal({ title: 'Over the drawer' }); }")
    r.wait(150)
    r.back()
    st = r.js("() => ({ modal: !!document.querySelector('.modal-back'), drawer: !!document.querySelector('.drawer') })")
    r.back()
    st2 = r.js("() => ({ modal: !!document.querySelector('.modal-back'), drawer: !!document.querySelector('.drawer') })")
    r.check('back: modal over the drawer -> modal first, then drawer', st == {'modal': False, 'drawer': True} and st2 == {'modal': False, 'drawer': False}, [st, st2])
    # the side menu (phone)
    pg.click('#menu-btn')
    r.wait(200)
    opened = r.js("() => !!document.querySelector('.side.open')")
    r.shot('back-4-side')
    r.back()
    r.check('back: side menu closes', opened and r.js("() => !document.querySelector('.side.open') && !document.querySelector('.scrim.open') && O.state.page === 'dashboard'"), opened)
    # the inbox on a phone: a chat fills the screen, with its own attachment menu
    r.js("() => O.go('inbox')")
    r.wait(500)
    chat = r.js("() => { const c = document.querySelector('#page-root [data-conv]'); if (c) c.click(); return !!c; }")
    r.wait(400)
    r.check('inbox: a chat opens full screen on the phone', chat and r.js("() => !!document.querySelector('#page-root .show-chat')"))
    att = r.js("() => { const b = document.querySelector('#page-root [data-act=attach]'); if (b) b.click(); return !!document.querySelector('.att-menu.open'); }")
    r.shot('back-5-inbox-attach-menu')
    r.back()
    r.check("back: inbox's attachment menu closes, the chat stays open", att and r.js("() => !document.querySelector('.att-menu.open') && !!document.querySelector('#page-root .show-chat') && O.state.page === 'inbox'"), att)
    r.back()
    r.check('back: from the chat to the chat list (still on Inbox)', r.js("() => !document.querySelector('#page-root .show-chat') && O.state.page === 'inbox'"), r.js('() => O.state.page'))
    # calendar: tap a free night -> its small menu
    r.js("() => O.go('calendar')")
    r.wait(700)
    opened = r.js("""() => { for (const lane of document.querySelectorAll('#page-root .cal-lane')) { const b = lane.getBoundingClientRect();
        for (let x = b.left + 4; x < b.right; x += 12) { lane.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: b.top + b.height / 2 }));
          if (document.querySelector('.cal-menu')) return true; } } return false; }""")
    r.wait(100)
    r.shot('back-6-calendar-menu')
    r.back()
    r.check("back: the calendar's free-night menu closes (still on Calendar)", opened and r.js("() => !document.querySelector('.cal-menu') && O.state.page === 'calendar'"), opened)
    # page history: dashboard -> bookings -> tasks, back, back, then minimize
    r.js("() => { O.store.set('page', 'dashboard'); }")
    r.boot()
    r.clear_calls()
    pg.click('#menu-btn')
    r.wait(200)
    pg.click('.nav-item[data-page=bookings]')
    r.wait(400)
    pg.click('#tabbar .tab[data-page=tasks]')
    r.wait(400)
    seq = [r.js('() => O.state.page')]
    r.back(400)
    seq.append(r.js('() => O.state.page'))
    r.back(400)
    seq.append(r.js('() => O.state.page'))
    r.check('back: tasks -> bookings -> dashboard', seq == ['tasks', 'bookings', 'dashboard'], seq)
    r.check('back: no minimize while there was a page to go back to', not r.calls('App', 'minimizeApp'))
    r.back(300)
    r.check('back: on the first page -> App.minimizeApp', len(r.calls('App', 'minimizeApp')) == 1 and r.js('() => O.state.page') == 'dashboard', r.calls('App'))
    r.check('back: the app view never went back in its own history', r.js('() => !!(window.O && O._started)') and not r.calls('App', 'exitApp'))
    # the website builder's full-screen design preview
    r.js("() => { O.go('website'); }")
    r.wait(600)
    full = r.js("() => { const b = document.querySelector('[data-act=full]'); if (b) b.click(); return !!document.querySelector('.wb-full'); }")
    r.wait(300)
    r.shot('back-7-website-preview')
    r.back(300)
    r.check('back: website full-screen preview closes (still on Website)', full and r.js("() => !document.querySelector('.wb-full') && O.state.page === 'website'"), full)
    r.check('back: the back button sequence caused no JS errors', not r.errors, r.errors)

    # ---- status bar and navigation bar icons follow the colour under each bar
    print('  -- system bars')
    bars = "() => __barState"
    r.js("() => O.go('dashboard')")
    r.wait(400)
    r.check('bars: dashboard -> both LIGHT (dark icons on white)', r.js(bars) == {'StatusBar': 'LIGHT', 'NavigationBar': 'LIGHT'}, r.js(bars))
    pg.click('#menu-btn')
    r.wait(400)
    r.check('bars: side menu open -> status bar DARK (light icons on navy)', r.js(bars)['StatusBar'] == 'DARK', r.js(bars))
    r.js("() => document.querySelector('.scrim').click()")
    r.wait(400)
    r.js("() => { const d = document.createElement('div'); d.id = 'sim-dark-foot'; d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:70px;background:#0F1B2D;z-index:9999'; document.body.appendChild(d); }")
    r.wait(400)
    r.check('bars: dark area at the bottom only -> navigation bar DARK, status bar stays LIGHT', r.js(bars) == {'StatusBar': 'LIGHT', 'NavigationBar': 'DARK'}, r.js(bars))
    r.js("() => document.getElementById('sim-dark-foot').remove()")
    r.wait(400)
    r.check('bars: back to light at the bottom -> navigation bar LIGHT', r.js(bars) == {'StatusBar': 'LIGHT', 'NavigationBar': 'LIGHT'}, r.js(bars))

    # ---- outside links
    print('  -- outside links')
    r.js("() => O.go('dashboard')")
    r.wait(300)
    r.clear_calls()
    del r.handed[:]
    ret = r.js("() => window.open('https://example.com')")
    r.wait(100)
    bo = r.calls('Browser', 'open')
    r.check('window.open(https) -> Browser.open, returns null', ret is None and len(bo) == 1 and bo[0]['options']['url'].startswith('https://example.com'), (ret, bo))
    r.js("""() => { const box = document.createElement('div'); box.id = 'sim-links'; box.style.cssText = 'position:fixed;left:10px;top:120px;z-index:9999;background:#fff;padding:4px;display:flex;flex-direction:column;gap:6px';
        box.innerHTML = '<a id="l-blank" href="https://example.org/page?a=1" target="_blank" rel="noopener">blank</a>' +
          '<a id="l-tel" href="tel:+60123456789">tel</a><a id="l-mail" href="mailto:host@example.com">mail</a>' +
          '<a id="l-wa" href="https://wa.me/60123456789" target="_blank" rel="noopener">wa</a>' +
          '<a id="l-same" href="#sim-same">same</a>';
        document.body.appendChild(box); }""")
    r.clear_calls()
    pg.click('#l-blank')
    r.wait(200)
    bo = r.calls('Browser', 'open')
    r.check('target=_blank https link -> Browser.open, no new window', len(bo) == 1 and bo[0]['options']['url'] == 'https://example.org/page?a=1' and not r.popups, (bo, r.popups))
    r.clear_calls()
    pg.click('#l-wa')
    r.wait(300)
    r.check('wa.me link handed to the phone (WhatsApp), not the in-app browser', any(u.startswith('https://wa.me/60123456789') for u in r.handed) and not r.calls('Browser', 'open') and not r.popups, (r.handed, r.popups))
    r.check('the app is still loaded after the hand-over', r.js("() => !!(window.O && O._started && document.getElementById('sim-links'))"))
    r.clear_calls()
    del r.handed[:]
    pg.click('#l-same')
    r.wait(200)
    r.check('same-origin link untouched (hash changes, no Browser.open, no hand-over)', r.js("() => location.hash") == '#sim-same' and not r.calls('Browser') and not r.handed, (r.js('() => location.href'), r.handed))
    r.js("() => history.replaceState(null, '', location.pathname)")
    # tel: and mailto: last: Chromium stops sending real input to the page once it has handed a tel: address to the
    # system (the phone's app view does not), so these two are clicked with a dispatched click event
    r.clear_calls()
    pg.dispatch_event('#l-tel', 'click')
    r.wait(300)
    r.check('tel: link handed to the phone (navigation to tel:), not the in-app browser', any(u.startswith('tel:+60123456789') for u in r.handed) and not r.calls('Browser', 'open'), r.handed)
    pg.dispatch_event('#l-mail', 'click')
    r.wait(300)
    r.check('mailto: link handed to the phone', any(u.startswith('mailto:host@example.com') for u in r.handed) and not r.calls('Browser', 'open'), r.handed)
    r.check('the app is still loaded after tel: and mailto:', r.js("() => !!(window.O && O._started && document.getElementById('sim-links'))"))
    r.js("() => document.getElementById('sim-links').remove()")
    r.check('outside links caused no JS errors', not r.errors, r.errors)
    r.check('no JS errors (pageerror / console.error) in the whole Android run', not r.errors, r.errors)
    r.close()
    return r.results


# ------------------------------------------------------------------ safe areas
def insets(browser, base, out):
    print('insets (status bar 47px, home bar 34px; landscape 47px sides)')
    res = []
    r = Run(browser, base, 'insets', out, 'android', insets=True)
    pg = r.pg
    ins = dict(top=47, right=0, bottom=34, left=0)

    def set_insets(i):
        r.js("""(i) => { const s = document.documentElement.style; for (const k of ['top','right','bottom','left']) {
            s.setProperty('--sim-inset-' + k, i[k] + 'px'); s.setProperty('--safe-area-inset-' + k, i[k] + 'px'); } }""", i)
        r.wait(150)

    def rects(sel):
        return r.js("(s) => [...document.querySelectorAll(s)].filter(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed').map(e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }).filter(b => b.w > 0 && b.h > 0)", sel)

    def shot(name, i):
        r.js(INSET_BANDS_JS, i)
        p = r.shot(name)
        r.js("() => document.querySelectorAll('.sim-band').forEach(x => x.remove())")
        return p

    r.boot()
    set_insets(ins)
    W, H = 390, 844
    sat = r.js("() => getComputedStyle(document.documentElement).getPropertyValue('--sat').trim()")
    r.check('--sat follows the (simulated) safe-area-inset-top', sat in ('47px', 'var(--sim-inset-top, 0px)') or r.js("() => { const d = document.createElement('div'); d.style.height = 'var(--sat)'; document.body.appendChild(d); const h = d.getBoundingClientRect().height; d.remove(); return h; }") == 47, sat)
    r.js("() => O.ui.toast('A message for the inset check')")
    r.wait(100)
    shot('portrait-dashboard', ins)
    top = rects('.topbar #menu-btn, .topbar #tb-title, .topbar .tb-global button')
    r.check('top bar: menu button and title start below the 47px status bar', top and all(b['t'] >= 47 for b in top), top)
    tabs = rects('#tabbar .tab')
    r.check('tab bar: 5 buttons, all above the 34px home bar', len(tabs) == 5 and all(b['b'] <= H - 34 + 0.5 for b in tabs), tabs)
    toast = rects('.toast')
    tb = rects('#tabbar')
    r.check('toast sits above the tab bar', toast and tb and toast[0]['b'] <= tb[0]['t'] + 0.5, (toast, tb))
    last = r.js("""() => { window.scrollTo(0, document.documentElement.scrollHeight); const k = [...document.querySelectorAll('#page-root > * , #page-root .card')].pop();
        const b = k.getBoundingClientRect(); return { b: b.bottom }; }""")
    r.wait(100)
    tb = rects('#tabbar')
    r.check('page end scrolls clear of the tab bar', last['b'] <= tb[0]['t'] + 1, (last, tb))
    shot('portrait-dashboard-end', ins)
    r.js('() => window.scrollTo(0, 0)')
    r.clear_ui()
    # modal (phone: a sheet from the bottom), with a long body so it reaches the top
    r.js("() => O.ui.modal({ title: 'Inset check', body: '<p>' + 'Lorem ipsum dolor sit amet. '.repeat(160) + '</p>', actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary' }] })")
    r.wait(250)
    shot('portrait-modal', ins)
    head = rects('.modal-back .modal-head')
    foot = rects('.modal-back .modal-foot button')
    r.check('modal: header below the status bar', head and head[0]['t'] >= 47, head)
    r.check('modal: buttons above the home bar', foot and all(b['b'] <= H - 34 + 0.5 for b in foot), foot)
    r.clear_ui()
    # a short modal
    r.js('() => O.lock.change({})')
    r.wait(250)
    shot('portrait-modal-lock', ins)
    foot = rects('.modal-back .modal-foot button')
    r.check('short modal: buttons above the home bar', foot and all(b['b'] <= H - 34 + 0.5 for b in foot), foot)
    r.clear_ui()
    # side menu
    pg.click('#menu-btn')
    r.wait(300)
    shot('portrait-side', ins)
    ws = rects('.side #ws-btn')
    vb = rects('.side #viewer-btn')
    r.check('side menu: workspace button below the status bar', ws and ws[0]['t'] >= 47, ws)
    r.check('side menu: viewer button above the home bar', vb and vb[0]['b'] <= H - 34 + 0.5, vb)
    r.js("() => document.querySelector('.scrim').click()")
    r.wait(200)
    # booking drawer
    r.js("() => O.booking.open(O.data.bookings.find(b => b.status !== 'cancelled').id)")
    r.wait(300)
    shot('portrait-drawer', ins)
    dh = rects('.drawer .modal-head h3, .drawer .modal-x')
    r.check('drawer: title and close button below the status bar', dh and all(b['t'] >= 47 for b in dh), dh)
    end = r.js("() => { const b = document.querySelector('.drawer .modal-body'); b.scrollTop = b.scrollHeight; const k = b.lastElementChild.getBoundingClientRect(); return { b: k.bottom, body: b.getBoundingClientRect().bottom }; }")
    r.check('drawer: body ends above the home bar', end['body'] <= H - 34 + 0.5, end)
    shot('portrait-drawer-end', ins)
    r.clear_ui()
    # the website builder's full-screen preview
    r.js("() => O.go('website')")
    r.wait(600)
    r.js("() => { const b = document.querySelector('[data-act=full]'); if (b) b.click(); }")
    r.wait(400)
    shot('portrait-website-preview', ins)
    fb = rects('.wb-full .wb-fullbar button')
    r.check('website preview: its bar buttons are below the status bar', fb and all(b['t'] >= 47 for b in fb), fb)
    r.js("() => { const c = document.querySelector('[data-act=close-full]'); if (c) c.click(); O.go('dashboard'); }")
    r.wait(300)

    # landscape (notch on the left, home bar at the bottom)
    lw, lh = 844, 390
    pg.set_viewport_size({'width': lw, 'height': lh})
    lins = dict(top=0, right=47, bottom=21, left=47)
    set_insets(lins)
    r.wait(300)
    shot('landscape-dashboard', lins)
    mb = rects('.topbar #menu-btn')
    gl = rects('.topbar .tb-global button, .topbar .tb-actions button')
    r.check('landscape: menu button clear of the left inset', mb and mb[0]['l'] >= 47, mb)
    r.check('landscape: top bar buttons clear of the right inset', gl and all(b['r'] <= lw - 47 + 0.5 for b in gl), gl)
    cards = rects('#page-root .card')
    r.check('landscape: page cards clear of both side insets', cards and all(b['l'] >= 47 and b['r'] <= lw - 47 + 0.5 for b in cards), cards[:3])
    r.js("() => O.ui.modal({ title: 'Landscape inset check', body: '<p>Short body.</p>', actions: [{ label: 'OK', kind: 'primary' }] })")
    r.wait(250)
    shot('landscape-modal', lins)
    mo = rects('.modal-back .modal')
    foot = rects('.modal-back .modal-foot button')
    inner = rects('.modal-back .modal-head h3, .modal-back .modal-x, .modal-back .modal-body p, .modal-back .modal-foot button')
    r.check('landscape modal: buttons above the home bar', foot and all(b['b'] <= lh - 21 + 0.5 for b in foot), foot)
    r.check('landscape modal: title, text, close and buttons clear of the side insets', inner and all(b['l'] >= 47 and b['r'] <= lw - 47 + 0.5 for b in inner), [mo] + inner,
            known='app/core.css:451 the phone modal sheet spans the full width and ignores --sal/--sar')
    r.clear_ui()
    pg.click('#menu-btn')
    r.wait(300)
    shot('landscape-side', lins)
    nav = rects('.side .nav-item')
    r.check('landscape side menu: items clear of the left inset', nav and all(b['l'] >= 47 for b in nav), nav[:2])
    r.js("() => document.querySelector('.scrim').click()")
    r.wait(200)
    r.js("() => O.booking.open(O.data.bookings.find(b => b.status !== 'cancelled').id)")
    r.wait(300)
    shot('landscape-drawer', lins)
    dx = rects('.drawer .modal-x')
    r.check('landscape drawer: close button clear of the right inset', dx and dx[0]['r'] <= lw - 47 + 0.5, dx)
    r.clear_ui()
    r.check('no JS errors in the inset run', not r.errors, r.errors)
    r.close()
    return r.results


# ------------------------------------------------------------------ iOS
def ios(browser, base, out):
    print('ios (390x844)')
    r = Run(browser, base, 'ios', out, 'ios', ttsMs=60)
    booted = r.boot()
    r.check('boots (O._started)', booted)
    r.shot('dashboard')
    info = r.js("() => ({ cls: document.documentElement.className, platform: O.native && O.native.platform })")
    r.check('html has classes native and native-ios', {'native', 'native-ios'} <= set(info['cls'].split()), info['cls'])
    r.check("O.native.platform === 'ios'", info['platform'] == 'ios', info['platform'])
    r.check('SplashScreen.hide called', r.calls('SplashScreen', 'hide'))
    bars = r.calls('SystemBars', 'setStyle')
    r.check('status bar LIGHT, and no NavigationBar style (iOS would apply it to the status bar)', r.js('() => __barState') == {'StatusBar': 'LIGHT'} and all(c['options'].get('bar') != 'NavigationBar' for c in bars), bars)
    lis = r.js('() => __nativeListeners.App || {}')
    r.check('no backButton listener on iOS', not lis.get('backButton') and all(c['options'].get('eventName') != 'backButton' for c in r.calls('App', 'addListener')), lis)
    r.check('appStateChange listener registered', lis.get('appStateChange'), lis)
    r.clear_calls()
    res = r.js("() => O.downloadCSV('ios.csv', [['a','b'],[1,2]])")
    w, s = r.calls('Filesystem', 'writeFile'), r.calls('Share', 'share')
    ok = res is True and len(w) == 1 and b64text(w[0]['options']['data']) == '﻿a,b\r\n1,2' and len(s) == 1 and s[0]['options']['files'][0].startswith('file:///var/mobile/')
    r.check('download: writeFile (cache) + Share.share with the file', ok, (res, [x['options'].get('path') for x in w], s))
    r.clear_calls()
    r.js("() => { window.__ends = []; O.voice.speak(['One.', 'Two.', 'Three.'], { onend: () => __ends.push('a') }); }")
    r.until("() => __ends.length === 1")
    said = [c['options']['text'] for c in r.calls('TextToSpeech', 'speak')]
    r.check('read aloud: TextToSpeech.speak in order', said == ['One.', 'Two.', 'Three.'], said)
    r.clear_calls()
    r.js("""() => { window.__ends = []; __sim.ttsMs = 250;
        O.voice.speak(['First one.', 'First two.', 'First three.'], { onend: () => __ends.push('first') });
        setTimeout(() => O.voice.speak(['Second one.', 'Second two.'], { onend: () => __ends.push('second') }), 120); }""")
    r.wait(1600)
    said = [c['options']['text'] for c in r.calls('TextToSpeech', 'speak')]
    r.check('second read-aloud: the first one does not continue (iOS resolves the cancelled sentence)', said == ['First one.', 'Second one.', 'Second two.'], said)
    r.check('second read-aloud: each onend once', r.js('() => __ends') == ['first', 'second'], r.js('() => __ends'))
    r.clear_calls()
    r.js("() => window.open('https://example.com/ios')")
    r.wait(100)
    r.check('window.open -> Browser.open', r.calls('Browser', 'open'))
    r.check('no JS errors', not r.errors, r.errors)
    r.close()
    return r.results


# ------------------------------------------------------------------ plain browser
def browser_only(browser, base, out):
    print('browser (no Capacitor)')
    r = Run(browser, base, 'browser', out, None)
    r.allow.append('A bad HTTP response code (404) was received when fetching the script')  # /sw.js, see the check below
    booted = r.boot()
    r.check('boots (O._started)', booted)
    r.shot('dashboard')
    info = r.js("""() => ({ cls: document.documentElement.className, native: !!O.native, cap: !!window.Capacitor,
        isNative: window.Capacitor && Capacitor.isNativePlatform(), platform: window.Capacitor && Capacitor.getPlatform(),
        open: window.open.toString().indexOf('[native code]') >= 0 })""")
    r.check('Capacitor runtime present but reports web', info['cap'] and info['isNative'] is False and info['platform'] == 'web', info)
    r.check('bridge stays off: no html.native, no O.native', 'native' not in info['cls'].split() and not info['native'], info)
    r.check('window.open is the browser\'s own', info['open'], info)
    swr = r.js('() => window.__swRegs || []')
    r.check('no service worker asked for (the phone app\'s files have no sw.js)', not swr, swr,
            known='app/server/pwa.js:35 registers /sw.js for mobile/www opened in a browser; check ORBIQUE_CONFIG.native too')
    r.check('no JS errors', not r.errors, r.errors)
    r.close()
    return r.results


SETUPS = {'android': android, 'insets': insets, 'ios': ios, 'browser': browser_only}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--www', default=WWW)
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    if not os.path.exists(os.path.join(a.www, 'index.html')):
        sys.exit('No %s/index.html: run node scripts/build.mjs --mobile first' % a.www)
    names = [n for n in (a.only.split(',') if a.only else SETUPS.keys()) if n]
    os.makedirs(a.out, exist_ok=True)
    srv, base = serve(a.www)
    results = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None, args=['--no-sandbox'])
            for n in names:
                try:
                    results += SETUPS[n](b, base, a.out)
                except Exception as e:  # a crash in one set-up is a failure, the others still run
                    print('  FAIL  %s crashed: %s' % (n, str(e).splitlines()[0][:300]))
                    results.append(dict(setup=n, check='set-up ran to the end', ok=False, detail=str(e)[:400]))
            b.close()
    finally:
        srv.shutdown()
    json.dump(results, open(os.path.join(a.out, 'results.json'), 'w'), indent=1)
    bad = [x for x in results if not x['ok']]
    known = [x for x in results if x.get('status') == 'KNOWN']
    print('checks: %d, passed: %d, failed: %d, known issues in other files: %d (details in %s)' % (
        len(results), len(results) - len(bad) - len(known), len(bad), len(known), os.path.join(a.out, 'results.json')))
    for x in bad:
        print('  FAIL  %-8s %s' % (x['setup'], x['check']))
    for x in known:
        print('  KNOWN %-8s %s  [%s]' % (x['setup'], x['check'], x['known']))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
