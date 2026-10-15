/* ===================================================================
   Orbique server mode (production builds only; local --local builds leave app/server out).
   O.auth: sign in, first-run setup, temporary passwords, workspace picker, onboarding (demo or empty),
   the Supabase sync adapter (records + blobs, realtime), member management for owners, preview-as,
   the production guest API and the shell hooks (workspace switcher, viewer menu, platform link).
   Loaded after app/pages/*.js and before O.boot(). Needs window.ORBIQUE_CONFIG {supabaseUrl, supabaseKey}
   (dist/config.js) and window.supabase (dist/vendor/supabase.js). Contract: docs/API.md, docs/SPEC-v4.md section 4.
   =================================================================== */
(function () {
  var O = window.O, D = O.data, U = O.ui, esc = O.esc;
  var CFG = window.ORBIQUE_CONFIG || {};
  function enabled() { return !!(CFG.supabaseUrl && CFG.supabaseKey && window.supabase && typeof window.supabase.createClient === 'function'); }
  var A = O.auth = { enabled: enabled };
  if (!enabled()) return; /* no database configured: the app runs as a local test copy */

  var ROLE_LABEL = {}; O.ROLES.forEach(function (r) { ROLE_LABEL[r[0]] = r[1]; });
  var PLATFORM = 'orbique'; /* workspace key of the Orbique platform admin area (uses the Orbique brand entry from core) */
  var S = { session: null, user: null, ctx: null, entry: null, org: null, meta: null, readOnly: false, platform: false, previewing: null, inApp: false, leaving: false };
  var SEED = { pending: false, total: 0, done: 0, el: null };
  window.addEventListener('pagehide', function () { S.unloading = true; });
  window.addEventListener('pageshow', function () { S.unloading = false; });

  /* ---------------- Supabase clients ---------------- */
  var sbStaff = null, sbGuest = null;
  function sb() {
    if (!sbStaff) sbStaff = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'orbique-auth' } });
    return sbStaff;
  }
  /* guests never sign in: a separate client with no stored session, so a staff session in the same browser is never used */
  function guestSb() {
    if (!sbGuest) sbGuest = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'orbique-guest' } });
    return sbGuest;
  }

  /* ---------------- small helpers ---------------- */
  function todayMY() { return O.clock.now().slice(0, 10); }
  function errMsg(e, fallback) {
    var m = e && (e.message || e.error_description || e.msg);
    if (!m) return fallback || 'Something went wrong. Please try again.';
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) return 'Orbique could not be reached. Check your connection and try again.';
    if (/row-level security|permission denied|not allowed/i.test(m)) return 'Your access does not allow this.';
    return m;
  }
  function isPerm(e) { return !!e && (e.code === '42501' || /row-level security|permission denied/i.test(e.message || '')); }
  function rpc(name, args) { return sb().rpc(name, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function userName() { var m = (S.user && S.user.user_metadata) || {}; return m.name || (S.user && S.user.email ? S.user.email.split('@')[0] : 'You'); }
  function deviceKey() { return 'srv:ws:' + (S.user ? S.user.id : ''); }
  function canon(v) { return O.sync.canon ? O.sync.canon(v) : JSON.stringify(v); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function strongToken() {
    var s = 'g'; try { var a = new Uint8Array(16); crypto.getRandomValues(a); for (var i = 0; i < a.length; i++) s += (a[i] % 36).toString(36); } catch (e) { s += Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
    return s;
  }
  function stopSaving() { clearTimeout(O.sync._timer); O.sync._timer = null; O.sync.pending = false; }
  function reload() { S.leaving = true; stopSaving(); location.reload(); }
  function flushThen(fn) { return Promise.resolve().then(function () { return O.sync.started ? O.sync.flush() : null; }).catch(function () {}).then(fn); }
  function apiBase() { return String(CFG.apiBase || '').replace(/\/$/, ''); }

  /* POST <path> (an /api function) with the signed-in person's token; resolves the JSON body,
     rejects Error(message) with .code, .status and .body (the whole answer, e.g. problems: [...]) */
  A.call = function (path, body) {
    return sb().auth.getSession().then(function (r) {
      var tok = r && r.data && r.data.session ? r.data.session.access_token : null;
      var h = { 'Content-Type': 'application/json' }; if (tok) h.Authorization = 'Bearer ' + tok;
      return fetch(apiBase() + path, { method: 'POST', headers: h, body: JSON.stringify(body || {}) });
    }).then(function (res) {
      return res.json().catch(function () { return { ok: false, message: 'The server did not answer properly. Please try again in a minute.' }; }).then(function (j) {
        if (!res.ok || !j || !j.ok) { var e = new Error((j && j.message) || 'Something went wrong. Please try again.'); e.code = j && j.error; e.status = res.status; e.body = j; throw e; }
        return j;
      });
    }, function () { throw new Error('Orbique could not be reached. Check your connection and try again.'); });
  };
  /* POST /api/account {action, ...} */
  A.api = function (action, body) { return A.call('/api/account', Object.assign({ action: action }, body || {})); };
  /* POST /api/channex {action, orgId, ...} for the open workspace (docs/API.md) */
  A.channex = function (action, body) {
    if (!S.org) return Promise.reject(new Error('Open a workspace first.'));
    return A.call('/api/channex', Object.assign({ action: action, orgId: S.org.id }, body || {}));
  };
  /* live changes to the open workspace's channel manager rows (connections, alerts, waiting changes): cb(table, payload).
     Returns a function that stops listening. */
  A.channexRealtime = function (cb) {
    if (!S.org) return function () {};
    var orgId = S.org.id, ch = sb().channel('orbique-channex-' + orgId);
    ['channex_properties', 'channex_alerts', 'channex_outbox'].forEach(function (t) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: 'org_id=eq.' + orgId }, function (p) { try { cb(t, p); } catch (e) { console.error(e); } });
    });
    ch.subscribe();
    return function () { try { sb().removeChannel(ch); } catch (e) {} };
  };
  A.supabase = function () { return sb(); };
  A.appUrl = function () { return String(CFG.appUrl || (location.origin && location.origin !== 'null' ? location.origin : '')).replace(/\/$/, ''); };

  /* ===================================================================
     WORKSPACES: O.workspaces filled from my_context() + each org's workspaceBrand
     =================================================================== */
  var DEFAULT_BRANDS = [['#2F5D8C', '#E0A458'], ['#0F766E', '#F2C14E'], ['#7A4E9C', '#F4A261'], ['#9C4A3A', '#E9C46A'], ['#3F6B4A', '#E9B872'], ['#33507A', '#7FB3D5']];
  function defaultBrand(id) { var p = DEFAULT_BRANDS[D.hash(String(id)) % DEFAULT_BRANDS.length]; return { primary: p[0], accent: p[1], dark: null, sideStyle: 'deep', source: 'default' }; }
  function monogram(name, color) {
    var ini = O.fmt.initials(name || '?') || '?';
    return O.svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="240" height="240"><rect width="120" height="120" rx="28" fill="' + color + '"/><text x="60" y="60" dy="0.35em" text-anchor="middle" font-family="Manrope, Inter, Arial, sans-serif" font-weight="800" font-size="' + (ini.length > 1 ? 50 : 60) + '" fill="' + O.color.ink(color) + '">' + esc(ini) + '</text></svg>');
  }
  function planLabel(p) { p = String(p || 'trial'); return p.charAt(0).toUpperCase() + p.slice(1) + ' plan'; }
  function entryFor(o, bb) {
    bb = bb || {};
    var slug = String(o.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'workspace';
    var brand = bb.brand && bb.brand.primary ? bb.brand : (O.store.get('brand:' + o.id, null) || defaultBrand(o.id));
    return {
      id: o.id, name: o.name, sub: (ROLE_LABEL[o.role] || o.role) + (o.status === 'paused' ? ' · Paused' : o.memberStatus !== 'active' ? ' · Access paused' : ''),
      legal: bb.legal || o.name, regNo: bb.regNo || 'Add your registration number in Brand & Setup', address: bb.address || 'Malaysia',
      email: bb.email || 'hello@' + slug + '.orbique.site', phone: bb.phone || '', domain: bb.domain || slug + '.orbique.site', plan: o.role === 'owner' ? planLabel(o.plan) : '', /* the plan pill under the viewer: owners only */
      logo: bb.logo || monogram(o.name, brand.primary), logoName: bb.logoName || null, brand: brand, server: o
    };
  }
  function platformEntry() {
    var w = O.workspaces[PLATFORM] || {}; w.id = PLATFORM; w.name = 'Orbique'; w.sub = 'Platform admin'; w.plan = null; w.platform = true;
    return w;
  }
  function buildWorkspaces(brands) {
    var keep = O.workspaces[PLATFORM];
    Object.keys(O.workspaces).forEach(function (k) { if (k !== PLATFORM) delete O.workspaces[k]; });
    if (keep) O.workspaces[PLATFORM] = keep;
    (S.ctx.workspaces || []).forEach(function (o) { O.workspaces[o.id] = entryFor(o, brands[o.id]); });
    if (S.ctx.platformAdmin) platformEntry();
  }
  function choices() {
    var out = (S.ctx && S.ctx.workspaces || []).map(function (o) { return O.workspaces[o.id]; }).filter(Boolean);
    if (S.ctx && S.ctx.platformAdmin) out.push(platformEntry());
    return out;
  }
  /* the demo workspaces of the local test copy are not real operators */
  Object.keys(O.workspaces).forEach(function (k) { if (k !== PLATFORM) delete O.workspaces[k]; });

  /* ===================================================================
     FULL-SCREEN SCREENS (sign in, set up, password, picker, onboarding, messages)
     =================================================================== */
  function moveToasts() { var t = O.$('.toasts'); if (t && t.parentNode !== document.body) document.body.appendChild(t); }
  function root() {
    var r = O.$('#auth-root');
    if (!r) { r = document.createElement('div'); r.id = 'auth-root'; r.className = 'auth-root'; document.body.appendChild(r); }
    O.$('#app').hidden = true; r.hidden = false; document.documentElement.classList.add('auth-mode');
    return r;
  }
  function closeScreens() { var r = O.$('#auth-root'); if (r) { r.hidden = true; r.innerHTML = ''; } document.documentElement.classList.remove('auth-mode'); }
  function orbiqueTheme() { var w = O.workspaces[PLATFORM]; if (w && w.brand) O.theme.apply(w.brand); }
  function frame(inner, o) {
    o = o || {};
    var mark = o.ws ? O.theme.logoHTML(o.ws).replace('class="ws-logo', 'class="ws-logo auth-mark') + '<span class="auth-word">' + esc(o.ws.name) + '</span>'
      : '<span class="ws-logo auth-mark"><img src="' + O.svgUrl(O.logos.orbique) + '" alt=""></span><span class="auth-word">Orbique</span>';
    var who = S.user ? '<div class="auth-who">Signed in as ' + esc(S.user.email) + (o.hasSignOut ? '' : ' · <button type="button" class="auth-link" data-auth="signout">Sign out</button>') + '</div>' : '';
    return '<div class="auth-wrap' + (o.wide ? ' wide' : '') + '"><header class="auth-top">' + mark + '</header><main class="auth-card">' + inner + '</main>' +
      '<footer class="auth-foot">' + who + '<div>Orbique · property management for short-term rentals</div></footer></div>';
  }
  function show(html, o) {
    var r = root(); r.innerHTML = frame(html, o); r.scrollTop = 0; window.scrollTo(0, 0);
    O.$$('[data-auth="signout"]', r).forEach(function (b) { b.onclick = function () { A.signOut(); }; });
    var f = O.$('input', r); if (f && !(o && o.noFocus) && window.innerWidth > 760) setTimeout(function () { try { f.focus(); } catch (e) {} }, 30);
    return r;
  }
  function field(id, label, type, extra) {
    extra = extra || {};
    var input = '<input class="input auth-in" id="' + id + '" name="' + id + '" type="' + type + '"' + (extra.auto ? ' autocomplete="' + extra.auto + '"' : '') + (extra.mode ? ' inputmode="' + extra.mode + '"' : '') + (extra.value ? ' value="' + esc(extra.value) + '"' : '') + (extra.req === false ? '' : ' required') + (extra.max ? ' maxlength="' + extra.max + '"' : '') + (extra.ph ? ' placeholder="' + esc(extra.ph) + '"' : '') + '>';
    if (type === 'password') input = '<div class="auth-pw">' + input + '<button type="button" class="auth-eye" data-eye="' + id + '" aria-label="Show password">Show</button></div>';
    if (type === 'textarea') input = '<textarea class="textarea auth-in" id="' + id + '" name="' + id + '" rows="3"' + (extra.max ? ' maxlength="' + extra.max + '"' : '') + '></textarea>';
    return '<div class="field"><label for="' + id + '">' + esc(label) + (extra.req === false ? ' <span class="auth-opt">(optional)</span>' : '') + '</label>' + input + (extra.hint ? '<div class="hint">' + esc(extra.hint) + '</div>' : '') + '</div>';
  }
  function wireForm(r, onSubmit) {
    O.$$('[data-eye]', r).forEach(function (b) { b.onclick = function () { var i = O.$('#' + b.dataset.eye, r), on = i.type === 'password'; i.type = on ? 'text' : 'password'; b.textContent = on ? 'Hide' : 'Show'; b.setAttribute('aria-label', on ? 'Hide password' : 'Show password'); }; });
    var form = O.$('form', r), btn = O.$('.auth-btn', form), err = O.$('.auth-err', form), label = btn.textContent;
    function fail(msg) { err.textContent = msg; err.hidden = false; btn.disabled = false; btn.textContent = label; }
    form.addEventListener('submit', function (e) {
      e.preventDefault(); if (btn.disabled) return;
      err.hidden = true; var v = {}; O.$$('input, textarea, select', form).forEach(function (i) { if (i.name) v[i.name] = i.value; });
      btn.disabled = true; btn.textContent = btn.dataset.busy || 'One moment…';
      Promise.resolve().then(function () { return onSubmit(v, fail); }).catch(function (ex) { fail(errMsg(ex)); });
    });
    return { fail: fail };
  }
  function validEmail(x) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x || '').trim()); }
  function pwProblem(p, c) {
    if (!p || p.length < 8) return 'Use at least 8 characters for the password.';
    if (p.length > 72) return 'The password is too long (at most 72 characters).';
    if (/^\s|\s$/.test(p)) return 'The password cannot start or end with a space.';
    if (c != null && p !== c) return 'The two passwords do not match.';
    return null;
  }

  function splash(msg) { show('<div class="auth-splash"><div class="spinner"></div><div>' + esc(msg || 'Opening Orbique…') + '</div></div>', { noFocus: true }); }

  function signInScreen(note) {
    orbiqueTheme();
    var r = show('<h1 class="auth-h">Sign in</h1><p class="auth-p">Welcome back. Sign in to run your units.</p>' +
      (note ? '<div class="note brand auth-note-top">' + esc(note) + '</div>' : '') +
      '<form class="auth-form" novalidate>' + field('email', 'Email', 'email', { auto: 'username', mode: 'email', max: 254 }) + field('password', 'Password', 'password', { auto: 'current-password', max: 72 }) +
      '<div class="auth-err" role="alert" hidden></div><button class="btn btn-primary auth-btn" type="submit" data-busy="Signing in…">Sign in</button></form>' +
      '<p class="auth-small">Forgot your password? Ask your workspace owner to reset it.</p>' +
      '<div class="auth-alt"><span>New operator?</span><button type="button" class="btn btn-quiet" data-go="request">Request access</button></div>');
    O.$('[data-go="request"]', r).onclick = function () { requestScreen(); };
    wireForm(r, function (v, fail) {
      var email = v.email.trim().toLowerCase();
      if (!validEmail(email)) return fail('Enter the email address you were invited with.');
      if (!v.password) return fail('Enter your password.');
      return sb().auth.signInWithPassword({ email: email, password: v.password }).then(function (res) {
        if (res.error) return fail(/invalid login|invalid credentials/i.test(res.error.message) ? 'That email and password do not match. Check them and try again.' : /confirm/i.test(res.error.message) ? 'This account is not active yet. Ask your workspace owner to invite you again.' : errMsg(res.error));
        S.session = res.data.session; S.user = res.data.user; afterSignIn();
      });
    });
  }

  function requestScreen() {
    orbiqueTheme();
    var r = show('<button type="button" class="auth-back" data-go="back">' + O.icon('left') + 'Back to sign in</button>' +
      '<h1 class="auth-h">Request access</h1><p class="auth-p">Tell us about your business. Orbique sets up your workspace and sends your sign-in details on WhatsApp.</p>' +
      '<form class="auth-form" novalidate>' + field('company', 'Company name', 'text', { auto: 'organization', max: 120 }) + field('contactName', 'Your name', 'text', { auto: 'name', max: 80 }) +
      field('email', 'Email', 'email', { auto: 'email', mode: 'email', max: 254 }) + field('phone', 'WhatsApp number', 'tel', { auto: 'tel', mode: 'tel', max: 40, ph: '+60 12-345 6789' }) +
      field('units', 'How many units do you manage?', 'number', { mode: 'numeric', req: false }) + field('message', 'Anything we should know?', 'textarea', { req: false, max: 2000 }) +
      '<div class="auth-err" role="alert" hidden></div><button class="btn btn-primary auth-btn" type="submit" data-busy="Sending…">Send request</button></form>');
    O.$('[data-go="back"]', r).onclick = function () { signInScreen(); };
    wireForm(r, function (v, fail) {
      if (!v.company.trim()) return fail('Enter your company name.');
      if (!v.contactName.trim()) return fail('Enter your name.');
      if (!validEmail(v.email)) return fail('Enter a valid email address.');
      if (v.phone.replace(/\D/g, '').length < 8) return fail('Enter your WhatsApp number so we can reach you.');
      if (v.units && !/^\d{1,6}$/.test(v.units.trim())) return fail('Number of units should be a whole number.');
      return A.api('signup', { company: v.company.trim(), contactName: v.contactName.trim(), email: v.email.trim().toLowerCase(), phone: v.phone.trim(), units: v.units ? +v.units : null, message: v.message.trim() }).then(function () {
        var r2 = show('<div class="auth-done">' + O.icon('check') + '</div><h1 class="auth-h center">Thanks, ' + esc(v.contactName.trim().split(/\s+/)[0]) + '</h1>' +
          '<p class="auth-p center">We have your request for ' + esc(v.company.trim()) + '. Orbique will contact you on WhatsApp within one working day to set up your workspace.</p>' +
          '<button type="button" class="btn btn-ghost auth-btn" data-go="back">Back to sign in</button>', { noFocus: true });
        O.$('[data-go="back"]', r2).onclick = function () { signInScreen(); };
      });
    });
  }

  function setupScreen() {
    orbiqueTheme();
    var r = show('<h1 class="auth-h">Set up Orbique</h1><p class="auth-p">This is the first sign-in on this installation. Create the platform owner account with the email address Orbique was set up for.</p>' +
      '<form class="auth-form" novalidate>' + field('name', 'Your name', 'text', { auto: 'name', max: 80 }) + field('email', 'Email', 'email', { auto: 'username', mode: 'email', max: 254 }) +
      field('password', 'Choose a password', 'password', { auto: 'new-password', max: 72, hint: 'At least 8 characters.' }) + field('confirm', 'Type it again', 'password', { auto: 'new-password', max: 72 }) +
      '<div class="auth-err" role="alert" hidden></div><button class="btn btn-primary auth-btn" type="submit" data-busy="Setting up…">Create owner account</button></form>' +
      '<div class="auth-alt"><span>Already set up?</span><button type="button" class="btn btn-quiet" data-go="signin">Sign in</button></div>');
    O.$('[data-go="signin"]', r).onclick = function () { signInScreen(); };
    wireForm(r, function (v, fail) {
      var email = v.email.trim().toLowerCase();
      if (!v.name.trim()) return fail('Enter your name.');
      if (!validEmail(email)) return fail('Enter a valid email address.');
      var pp = pwProblem(v.password, v.confirm); if (pp) return fail(pp);
      return A.api('bootstrap', { name: v.name.trim(), email: email, password: v.password }).then(function () {
        return sb().auth.signInWithPassword({ email: email, password: v.password });
      }).then(function (res) {
        if (res.error) return fail(errMsg(res.error));
        S.session = res.data.session; S.user = res.data.user; afterSignIn();
      });
    });
  }

  function passwordScreen() {
    orbiqueTheme();
    var r = show('<h1 class="auth-h">Choose your password</h1><p class="auth-p">You signed in with a temporary password. Choose your own to continue. Only you will know it.</p>' +
      '<form class="auth-form" novalidate><input type="email" name="u" autocomplete="username" value="' + esc(S.user.email) + '" hidden>' +
      field('password', 'New password', 'password', { auto: 'new-password', max: 72, hint: 'At least 8 characters.' }) + field('confirm', 'Type it again', 'password', { auto: 'new-password', max: 72 }) +
      '<div class="auth-err" role="alert" hidden></div><button class="btn btn-primary auth-btn" type="submit" data-busy="Saving…">Save and continue</button></form>');
    wireForm(r, function (v, fail) {
      var pp = pwProblem(v.password, v.confirm); if (pp) return fail(pp);
      return sb().auth.updateUser({ password: v.password, data: { must_change_password: false } }).then(function (res) {
        if (res.error) return fail(/different from the old|same password/i.test(res.error.message) ? 'Choose a password that is different from the temporary one.' : /weak|short/i.test(res.error.message) ? 'That password is too easy to guess. Try a longer one.' : errMsg(res.error));
        S.user = res.data.user || S.user; U.toast('Password saved');
        afterSignIn();
      });
    });
  }

  function messageScreen(o) {
    if (o.ws) O.theme.apply(o.ws.brand); else orbiqueTheme();
    var r = show((o.icon ? '<div class="auth-icon ' + (o.tone || '') + '">' + O.icon(o.icon) + '</div>' : '') + '<h1 class="auth-h center">' + esc(o.title) + '</h1><p class="auth-p center">' + esc(o.text) + '</p>' +
      '<div class="auth-actions">' + (o.actions || []).map(function (a, i) { return '<button type="button" class="btn ' + (a.kind === 'primary' ? 'btn-primary' : 'btn-ghost') + ' auth-btn" data-i="' + i + '">' + esc(a.label) + '</button>'; }).join('') + '</div>', { ws: o.ws, noFocus: true, hasSignOut: (o.actions || []).some(function (a) { return a.label === 'Sign out'; }) });
    O.$$('[data-i]', r).forEach(function (b) { b.onclick = function () { o.actions[+b.dataset.i].run(b); }; });
  }
  function errorScreen(e, retry) {
    console.warn('Orbique: could not open the workspace', e);
    messageScreen({ icon: 'alert', tone: 'bad', title: 'Orbique cannot connect right now', text: errMsg(e, 'The server did not answer.') + ' Your data is safe.', actions: [{ label: 'Try again', kind: 'primary', run: function () { retry(); } }].concat(S.user ? [{ label: 'Sign out', run: function () { A.signOut(); } }] : []) });
  }

  function pickerScreen() {
    orbiqueTheme();
    var list = choices();
    var r = show('<h1 class="auth-h">Choose a workspace</h1><p class="auth-p">You have access to more than one. Orbique remembers your choice on this device, and you can switch any time from the menu.</p>' +
      '<div class="auth-list">' + list.map(function (w) {
        var o = w.server || {}, off = !w.platform && o.memberStatus !== 'active';
        return '<button type="button" class="auth-ws" data-ws="' + esc(w.id) + '"' + (off ? ' aria-describedby="ws-off-' + esc(w.id) + '"' : '') + '>' + O.theme.logoHTML(w) + '<span class="grow"><span class="t">' + esc(w.name) + '</span><span class="d">' + esc(w.sub) + '</span></span>' +
          (w.platform ? '<span class="pill brand">Admin</span>' : o.status === 'paused' ? '<span class="pill warn">Paused</span>' : off ? '<span class="pill neutral" id="ws-off-' + esc(w.id) + '">Access paused</span>' : '') + '<span class="auth-chev">' + O.icon('right') + '</span></button>';
      }).join('') + '</div>', { noFocus: true });
    O.$$('[data-ws]', r).forEach(function (b) { b.onclick = function () { enter(b.dataset.ws); }; });
  }

  function onboardingScreen(w) {
    O.theme.apply(w.brand);
    var n = (O.sync._demo && O.sync._demo.properties || []).length || 12;
    var first = userName().split(/\s+/)[0];
    var r = show('<h1 class="auth-h">Welcome to Orbique, ' + esc(first) + '</h1><p class="auth-p">How would you like to start ' + esc(w.name) + '?</p>' +
      '<div class="auth-choices">' +
      '<button type="button" class="auth-choice" data-act="demo"><span class="ac-ic">' + O.icon('sparkle') + '</span><span class="ac-t">Load demo data</span><span class="ac-d">' + n + ' sample units with bookings, guests, tasks, reviews and money, so you can try every part of Orbique. You can clear it any time in Brand & Setup.</span></button>' +
      '<button type="button" class="auth-choice" data-act="empty"><span class="ac-ic">' + O.icon('properties') + '</span><span class="ac-t">Start empty</span><span class="ac-d">Add your own units and team. Best when you are ready to run your business on Orbique.</span></button>' +
      '</div><div class="auth-err" role="alert" hidden></div>' + (choices().length > 1 ? '<div class="auth-alt"><button type="button" class="btn btn-quiet" data-go="pick">Choose another workspace</button></div>' : ''), { ws: w, wide: true, noFocus: true });
    var pick = O.$('[data-go="pick"]', r); if (pick) pick.onclick = function () { O.store.set(deviceKey(), null); pickerScreen(); };
    O.$$('.auth-choice', r).forEach(function (b) {
      b.onclick = function () {
        if (r.dataset.busy) return; r.dataset.busy = '1';
        O.$$('.auth-choice', r).forEach(function (x) { x.disabled = true; }); b.classList.add('busy');
        O.$('.ac-t', b).textContent = b.dataset.act === 'demo' ? 'Preparing demo data…' : 'Setting up…';
        writeMeta(w.id, b.dataset.act === 'demo' ? { storyDate: todayMY(), demo: true, seedPending: true } : { storyDate: todayMY(), demo: false, startedAt: new Date().toISOString() }).then(reload, function (e) {
          delete r.dataset.busy; var er = O.$('.auth-err', r); er.textContent = errMsg(e); er.hidden = false;
          O.$$('.auth-choice', r).forEach(function (x) { x.disabled = false; }); b.classList.remove('busy'); O.$('.ac-t', b).textContent = b.dataset.act === 'demo' ? 'Load demo data' : 'Start empty';
        });
      };
    });
  }
  function writeMeta(orgId, meta) {
    return sb().from('blobs').upsert({ org_id: orgId, key: 'workspaceMeta', data: { v: meta } }, { onConflict: 'org_id,key' }).then(function (r) { if (r.error) throw r.error; });
  }

  /* ===================================================================
     GATE: who is signed in, which workspace, then hand over to core boot
     =================================================================== */
  var GATE = null;
  A.gate = function () {
    moveToasts();
    return new Promise(function (resolve) {
      GATE = resolve;
      sb().auth.onAuthStateChange(function (event) {
        if (event === 'SIGNED_OUT' && S.inApp && !S.leaving) { S.leaving = true; stopSaving(); location.reload(); }
      });
      start();
    });
  };
  function finish(ctx) { var g = GATE; GATE = null; closeScreens(); if (g) g(ctx); }
  function start() {
    splash();
    sb().auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      if (!s) return firstScreen();
      S.session = s; S.user = s.user;
      /* the stored session may be old: ask the server who this is (also refreshes user_metadata) */
      return sb().auth.getUser().then(function (u) {
        if (u.error || !u.data || !u.data.user) { return sb().auth.signOut().catch(function () {}).then(function () { S.user = null; signInScreen('Your session ended. Please sign in again.'); }); }
        S.user = u.data.user; afterSignIn();
      });
    }).catch(function (e) { errorScreen(e, start); });
  }
  function firstScreen() {
    var done = false, t = setTimeout(function () { if (!done) { done = true; signInScreen(); } }, 6000);
    fetch(apiBase() + '/api/health', { cache: 'no-store' }).then(function (res) { return res.json(); }).then(function (h) {
      if (done) return; done = true; clearTimeout(t);
      if (h && h.needsBootstrap) setupScreen(); else signInScreen();
    }).catch(function () { if (done) return; done = true; clearTimeout(t); signInScreen(); });
  }
  function afterSignIn() {
    var meta = (S.user && S.user.user_metadata) || {};
    if (meta.must_change_password) return passwordScreen();
    splash('Opening your workspace…');
    loadContext().then(chooseWorkspace).catch(function (e) { errorScreen(e, afterSignIn); });
  }
  function loadContext() {
    return rpc('my_context').then(function (ctx) {
      S.ctx = ctx || { workspaces: [] }; S.ctx.workspaces = S.ctx.workspaces || [];
      var ids = S.ctx.workspaces.filter(function (o) { return o.memberStatus === 'active'; }).map(function (o) { return o.id; });
      if (!ids.length) return {};
      return sb().from('blobs').select('org_id,data').eq('key', 'workspaceBrand').in('org_id', ids).then(function (r) {
        var out = {}; (r.data || []).forEach(function (b) { out[b.org_id] = b.data && b.data.v; }); return out;
      }, function () { return {}; });
    }).then(function (brands) { buildWorkspaces(brands || {}); });
  }
  function chooseWorkspace() {
    var list = choices(), saved = O.store.get(deviceKey(), null);
    if (saved && list.some(function (w) { return w.id === saved; })) return enter(saved);
    if (!list.length) {
      return messageScreen({ icon: 'user', title: 'You are not in a workspace yet', text: 'Ask your workspace owner to invite you. If you run a rental business and would like Orbique, request access and we will set you up.', actions: [{ label: 'Check again', kind: 'primary', run: function () { afterSignIn(); } }, { label: 'Sign out', run: function () { A.signOut(); } }] });
    }
    if (list.length === 1) return enter(list[0].id);
    pickerScreen();
  }
  function enter(key) {
    if (key === PLATFORM && S.ctx.platformAdmin) { O.store.set(deviceKey(), key); return enterPlatform(); }
    var w = O.workspaces[key]; if (!w || !w.server) return pickerScreen();
    var o = w.server;
    if (o.memberStatus !== 'active') {
      O.store.set(deviceKey(), null);
      return messageScreen({ ws: w, icon: 'lock', tone: 'warn', title: 'Your access is paused', text: 'The owner of ' + w.name + ' has paused your access, so you cannot open this workspace right now. Ask them to restore it.', actions: (choices().length > 1 ? [{ label: 'Choose another workspace', kind: 'primary', run: function () { pickerScreen(); } }] : []).concat([{ label: 'Sign out', kind: choices().length > 1 ? '' : 'primary', run: function () { A.signOut(); } }]) });
    }
    O.store.set(deviceKey(), key);
    splash('Opening ' + w.name + '…');
    O.theme.apply(w.brand);
    return sb().from('blobs').select('data').eq('org_id', o.id).eq('key', 'workspaceMeta').maybeSingle().then(function (r) {
      if (r.error) throw r.error;
      var meta = r.data && r.data.data ? r.data.data.v : null;
      if (!meta || !meta.storyDate) {
        if (o.status === 'paused') return messageScreen({ ws: w, icon: 'pause', tone: 'warn', title: w.name + ' is paused', text: 'Orbique has paused this workspace, so it cannot be set up right now. Please contact Orbique to resume it.', actions: [{ label: 'Check again', kind: 'primary', run: function () { reload(); } }, { label: 'Sign out', run: function () { A.signOut(); } }] });
        if (o.role === 'owner') return onboardingScreen(w);
        return messageScreen({ ws: w, icon: 'clock', title: 'Your workspace owner is still setting things up', text: w.name + ' is not ready yet. Check again in a little while.', actions: [{ label: 'Check again', kind: 'primary', run: function () { reload(); } }].concat(choices().length > 1 ? [{ label: 'Choose another workspace', run: function () { O.store.set(deviceKey(), null); pickerScreen(); } }] : []).concat([{ label: 'Sign out', run: function () { A.signOut(); } }]) });
      }
      S.entry = w; S.org = o; S.meta = meta; S.readOnly = o.status === 'paused';
      O.state.workspace = w.id; document.title = w.name;
      O.sync.use(serverAdapter(o));
      if (meta.seedPending && o.role === 'owner') { SEED.pending = true; O.automation.register('orbique-demo-seed', seedJob); }
      S.inApp = true;
      paintBanners();
      finish({ mode: 'server', viewer: o.staffId, storyDate: meta.storyDate });
    }).catch(function (e) { errorScreen(e, function () { enter(key); }); });
  }
  function enterPlatform() {
    var w = platformEntry();
    S.platform = true; S.entry = w; S.readOnly = true;
    document.documentElement.classList.add('orb-platform');
    O.state.workspace = PLATFORM; orbiqueTheme();
    O.NAV.length = 0; /* only the platform link (O.navExtras) in this area */
    var me = { id: '__platform', name: userName(), role: 'platform', roleLabel: 'Platform admin' };
    O.viewer = function () { return me; };
    O.store.set('page', 'platform');
    O.sync.use({ name: 'server', replace: true, load: function () { return { rows: [], blobs: [], readOnly: true }; }, write: function () { return Promise.resolve({ readOnly: true }); } });
    S.inApp = true;
    finish({ mode: 'server', viewer: null, storyDate: todayMY() });
  }

  /* ===================================================================
     SERVER ADAPTER — records + blobs for one org (see core O.sync)
     =================================================================== */
  function serverAdapter(org) {
    var orgId = org.id, mine = {}, lastSeen = '', cbRef = null, base = { blobs: {}, recs: {} };
    function k(coll, id) { return coll + '\u0001' + id; }
    function note(key, c) { var l = mine[key] = mine[key] || []; l.push({ c: c, t: Date.now() }); if (l.length > 20) l.shift(); }
    function echo(key, c) {
      var l = mine[key]; if (!l) return false;
      var now = Date.now();
      for (var i = l.length - 1; i >= 0; i--) { if (l[i].c === c) { l.splice(i, 1); if (!l.length) delete mine[key]; return true; } if (now - l[i].t > 120000) l.splice(i, 1); }
      if (!l.length) delete mine[key];
      return false;
    }
    function seen(ts) { if (ts && ts > lastSeen) lastSeen = ts; }
    function unwrap(data) { return data && typeof data === 'object' && !Array.isArray(data) && Object.prototype.hasOwnProperty.call(data, 'v') ? data.v : data; }
    /* page through a query until a page comes back empty (works with any server row cap) */
    function pageAll(make) {
      var out = [];
      function next(from) {
        return make().range(from, from + 999).then(function (r) {
          if (r.error) throw r.error;
          var got = r.data || []; out = out.concat(got);
          return got.length ? next(from + got.length) : out;
        });
      }
      return next(0);
    }
    function load() {
      return Promise.all([
        pageAll(function () { return sb().from('records').select('coll,id,data,updated_at').eq('org_id', orgId).eq('deleted', false).order('coll').order('id'); }),
        pageAll(function () { return sb().from('blobs').select('key,data,updated_at').eq('org_id', orgId).order('key'); })
      ]).then(function (res) {
        var rows = res[0].map(function (r) { seen(r.updated_at); return { coll: r.coll, id: r.id, data: r.data, deleted: false }; });
        var blobs = res[1].map(function (b) { seen(b.updated_at); return { key: b.key, data: unwrap(b.data) }; });
        /* the signed-in person always has a staff record, and its role is the one the server enforces */
        var me = null; rows.forEach(function (r) { if (r.coll === 'staff' && r.id === org.staffId) me = r; });
        if (!me) rows.push({ coll: 'staff', id: org.staffId, data: { id: org.staffId, name: userName(), role: org.role, roleLabel: ROLE_LABEL[org.role] || org.role, email: S.user.email }, deleted: false });
        else if (me.data && me.data.role !== org.role) { me.data = Object.assign({}, me.data, { role: org.role, roleLabel: ROLE_LABEL[org.role] || org.role }); }
        return { rows: rows, blobs: blobs, readOnly: S.readOnly || org.memberStatus !== 'active' };
      });
    }
    function upsert(table, rows) {
      return sb().from(table).upsert(rows, { onConflict: table === 'records' ? 'org_id,coll,id' : 'org_id,key' }).then(function (r) { if (r.error) throw r.error; });
    }
    /* is this org still writable for me? (an admin may have paused it, or the owner suspended me) */
    function stillWritable() {
      return sb().from('orgs').select('status').eq('id', orgId).maybeSingle().then(function (r) {
        if (r.error) return true;
        if (!r.data) { S.readOnlyWhy = 'access'; return false; }
        if (r.data.status !== 'active') { S.readOnlyWhy = 'paused'; return false; }
        return true;
      }, function () { return true; });
    }
    var READONLY = { readOnlyStop: true };
    function write(batch) {
      if (S.readOnly) return Promise.resolve({ readOnly: true });
      var recs = batch.rows.map(function (r) { return { org_id: orgId, coll: r.coll, id: String(r.id), data: r.deleted ? {} : r.data, deleted: !!r.deleted }; });
      var blobs = batch.blobs.map(function (b) { return { org_id: orgId, key: b.key, data: { v: b.data === undefined ? null : b.data } }; });
      var rejected = [], total = recs.length + blobs.length, done = 0;
      function remember(row, table) { if (table === 'records') note(k(row.coll, row.id), row.deleted ? '__deleted__' : canon(row.data)); else note(k('#blob', row.key), canon(row.data.v)); }
      function refused(row, table) { rejected.push(table === 'records' ? { coll: row.coll, id: row.id } : { key: row.key }); }
      function chunk(table, list, i) {
        if (i >= list.length) return Promise.resolve();
        var part = list.slice(i, i + 500);
        part.forEach(function (row) { remember(row, table); }); /* before sending: the realtime echo can beat the HTTP answer */
        return upsert(table, part).then(function () {
          done += part.length; progress(done, total);
        }, function (e) {
          if (!isPerm(e)) throw e;
          return stillWritable().then(function (ok) {
            if (!ok) throw READONLY;
            /* find the rows the server refused, one by one */
            return part.reduce(function (p, row) { return p.then(function () { return upsert(table, [row]).catch(function (e2) { if (isPerm(e2)) refused(row, table); else throw e2; }); }); }, Promise.resolve()).then(function () { done += part.length; progress(done, total); });
          });
        }).then(function () { return chunk(table, list, i + 500); });
      }
      progress(0, total);
      return chunk('records', recs, 0).then(function () { return chunk('blobs', blobs, 0); }).then(function () {
        if (rejected.length) setTimeout(function () { revert(rejected); }, 50);
        return { rejected: rejected };
      }, function (e) {
        if (e === READONLY) { S.readOnly = true; paintBanners(); return { readOnly: true }; }
        var err = new Error(errMsg(e, 'The server did not save the change')); err.code = 'network';
        /* the page is being left and the browser cancelled the request: not an error worth reporting. If the page
           comes back from the back-forward cache, fail then so the core sends the changes again. */
        if (S.unloading) return new Promise(function (res, rej) { window.addEventListener('pageshow', function () { rej(err); }, { once: true }); });
        throw err;
      });
    }
    function progress(done, total) { if (adapter.onProgress) try { adapter.onProgress(done, total); } catch (e) {} }
    /* rows the server refused go back to what the server holds, so this device shows the truth */
    function revert(rejected) {
      if (!cbRef) return;
      var recs = rejected.filter(function (r) { return r.coll; }), keys = rejected.filter(function (r) { return r.key; }).map(function (r) { return r.key; });
      Promise.all(recs.map(function (r) {
        return sb().from('records').select('data,deleted').eq('org_id', orgId).eq('coll', r.coll).eq('id', r.id).maybeSingle().then(function (q) {
          if (q.error) return null;
          if (q.data && !q.data.deleted) return { coll: r.coll, id: r.id, data: q.data.data, deleted: false };
          var b0 = base.recs[r.coll] && base.recs[r.coll][r.id]; /* a built-in default that was never saved */
          return b0 ? { coll: r.coll, id: r.id, data: clone(b0), deleted: false } : { coll: r.coll, id: r.id, deleted: true };
        });
      })).then(function (rows) {
        if (!keys.length) return [rows, []];
        return sb().from('blobs').select('key,data').eq('org_id', orgId).in('key', keys).then(function (q) {
          var got = {}; (q.data || []).forEach(function (b) { got[b.key] = { key: b.key, data: unwrap(b.data) }; });
          return [rows, keys.map(function (key) { return got[key] || (Object.prototype.hasOwnProperty.call(base.blobs, key) ? { key: key, data: clone(base.blobs[key]) } : null); }).filter(Boolean)];
        });
      }).then(function (res) { var rows = res[0].filter(Boolean); if (rows.length || res[1].length) cbRef(rows, res[1]); }).catch(function () {});
    }
    function subscribe(cb) {
      cbRef = cb;
      /* what this device loaded (server rows + built-in defaults): refused changes go back to it */
      var reg = O.sync.registered();
      Object.keys(reg).forEach(function (key) {
        if (reg[key].type === 'blob') { if (D[key] !== undefined) base.blobs[key] = clone(D[key]); }
        else if (reg[key].kind === 'config' && Array.isArray(D[key])) { var m = base.recs[key] = {}; D[key].forEach(function (x) { if (x && x.id != null) m[String(x.id)] = clone(x); }); }
      });
      var buf = { rows: [], blobs: [] }, timer = null, down = false;
      function push() { timer = null; var r = buf.rows, b = buf.blobs; buf = { rows: [], blobs: [] }; if (r.length || b.length) cb(r, b); }
      function queue(kind, item) { buf[kind].push(item); if (!timer) timer = setTimeout(push, 120); }
      function onRecord(p) {
        var row = p.eventType === 'DELETE' ? p.old : p.new; if (!row || !row.coll) return;
        seen(row.updated_at);
        var del = p.eventType === 'DELETE' || row.deleted;
        if (!del && (!row.data || typeof row.data !== 'object')) return;
        if (row.updated_by && S.user && row.updated_by === S.user.id && echo(k(row.coll, row.id), del ? '__deleted__' : canon(row.data))) return;
        queue('rows', del ? { coll: row.coll, id: row.id, deleted: true } : { coll: row.coll, id: row.id, data: row.data, deleted: false });
      }
      function onBlob(p) {
        var row = p.eventType === 'DELETE' ? p.old : p.new; if (!row || !row.key) return;
        seen(row.updated_at);
        if (row.key === 'workspaceMeta') return metaChanged(p.eventType === 'DELETE' ? null : unwrap(row.data));
        if (p.eventType === 'DELETE') return; /* a cleared setting: the next reload starts from the defaults */
        var v = unwrap(row.data);
        if (row.updated_by && S.user && row.updated_by === S.user.id && echo(k('#blob', row.key), canon(v))) return;
        base.blobs[row.key] = clone(v);
        queue('blobs', { key: row.key, data: v });
      }
      var ch = sb().channel('orbique-org-' + orgId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: 'org_id=eq.' + orgId }, onRecord)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'blobs', filter: 'org_id=eq.' + orgId }, onBlob)
        .subscribe(function (status) {
          if (status === 'SUBSCRIBED') { adapter.live = true; if (down) { down = false; catchUp(); } }
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { adapter.live = false; down = true; }
        });
      /* phones pause the connection in the background: fetch what changed when the app comes back */
      var hiddenAt = 0;
      function vis() { if (document.hidden) hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 20000) { hiddenAt = 0; catchUp(); } }
      document.addEventListener('visibilitychange', vis);
      function catchUp() {
        if (!lastSeen || S.leaving) return;
        var since = lastSeen;
        Promise.resolve(O.sync.flush()).catch(function () {}).then(function () {
          return Promise.all([
            pageAll(function () { return sb().from('records').select('coll,id,data,deleted,updated_at,updated_by').eq('org_id', orgId).gte('updated_at', since).order('updated_at'); }),
            sb().from('blobs').select('key,data,updated_at').eq('org_id', orgId).gte('updated_at', since).then(function (r) { if (r.error) throw r.error; return r.data || []; })
          ]);
        }).then(function (res) {
          res[0].forEach(function (r) { onRecord({ eventType: 'UPDATE', new: r }); });
          res[1].forEach(function (b) { onBlob({ eventType: 'UPDATE', new: b }); });
        }).catch(function (e) { console.warn('Orbique: catch-up after reconnect failed', e); });
      }
      return function () { document.removeEventListener('visibilitychange', vis); try { sb().removeChannel(ch); } catch (e) {} cbRef = null; };
    }
    var adapter = { name: 'server', replace: true, org: orgId, live: false, load: load, write: write, subscribe: subscribe, onProgress: null };
    return adapter;
  }
  /* the owner reset the workspace or loaded the demo on another device: start again from the server */
  function metaChanged(meta) {
    if (S.leaving || !S.meta) return;
    var was = S.meta;
    if (meta && meta.storyDate === was.storyDate && !!meta.demo === !!was.demo && !(meta.seedPending && !was.seedPending)) { S.meta = meta; return; }
    if (SEED.el) return;
    S.leaving = true; stopSaving();
    U.toast(meta ? 'The workspace was set up again. Reloading…' : 'The workspace was reset by its owner. Reloading…');
    setTimeout(function () { location.reload(); }, 1600);
  }

  /* ===================================================================
     DEMO SEED — runs once, on the owner's device, right after "Load demo data"
     =================================================================== */
  function walk(v, fn) { /* deep string replace: fn(str) -> str; also renames object keys */
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) { if (typeof v[i] === 'string') v[i] = fn(v[i]); else if (v[i] && typeof v[i] === 'object') walk(v[i], fn); } return v; }
    if (v && typeof v === 'object') Object.keys(v).forEach(function (key) {
      var x = v[key];
      if (typeof x === 'string') v[key] = fn(x); else if (x && typeof x === 'object') walk(x, fn);
      var nk = fn(key); if (nk !== key) { v[nk] = v[key]; delete v[key]; }
    });
    return v;
  }
  function seedJob() {
    if (!SEED.pending) return;
    SEED.pending = false;
    var demo = clone(O.sync._demo || {}), reg = O.sync.registered(), me = S.org.staffId;
    /* the demo's account owner becomes the person loading it; existing team members keep their records */
    var demoOwner = (demo.staff || []).filter(function (s) { return s.role === 'owner'; })[0];
    if (demoOwner && me && demoOwner.id !== me) { var from = demoOwner.id; walk(demo, function (s) { return s === from ? me : s; }); }
    /* every booking gets its own unguessable guest-link token (the built-in ones are the same in every workspace) */
    var tok = {}; (demo.bookings || []).forEach(function (b) { var t = strongToken(); if (b.guestToken) tok[b.guestToken] = t; b.guestToken = t; });
    if (Object.keys(tok).length) Object.keys(demo).forEach(function (key) { if (key !== 'bookings') walk(demo[key], function (s) { return tok[s] || s; }); });
    var real = D.staff.slice(), realIds = {}; real.forEach(function (s) { realIds[s.id] = 1; });
    Object.keys(demo).forEach(function (key) {
      if (!reg[key] || reg[key].kind !== 'demo') return;
      var v = O.shiftDates(demo[key], D.SHIFT || 0);
      if (key === 'staff') v = real.concat((v || []).filter(function (s) { return !realIds[s.id]; }));
      var cur = D[key];
      if (Array.isArray(cur) && Array.isArray(v)) { cur.length = 0; Array.prototype.push.apply(cur, v); }
      else if (cur && typeof cur === 'object' && !Array.isArray(cur) && v && typeof v === 'object' && !Array.isArray(v)) { Object.keys(cur).forEach(function (x) { delete cur[x]; }); Object.assign(cur, v); }
      else D[key] = v;
    });
    O.reindex(); O.rollStatuses();
    if (D.workspaceMeta && typeof D.workspaceMeta === 'object') { D.workspaceMeta.seedPending = false; D.workspaceMeta.seededAt = new Date().toISOString(); }
    S.meta = Object.assign({}, S.meta, { seedPending: false });
    showSeed();
    setTimeout(function () { O.emit('data'); O.automation.run('seed'); }, 0);
  }
  function showSeed() {
    var el = SEED.el = O.html('<div class="srv-seed" role="status" aria-live="polite"><div class="srv-seed-card"><div class="spinner"></div><b>Loading demo data…</b><div class="progress"><i style="width:2%"></i></div><div class="small muted srv-seed-n">Preparing sample units, bookings and guests</div></div></div>');
    document.body.appendChild(el);
    var A2 = O.sync.adapter, started = Date.now();
    if (A2) A2.onProgress = function (done, total) { if (total < 20) return; SEED.total = total; SEED.done = done; O.$('.progress i', el).style.width = Math.max(2, Math.round(done / total * 100)) + '%'; O.$('.srv-seed-n', el).textContent = O.fmt.num(done) + ' of ' + O.fmt.num(total) + ' saved'; };
    var t = setInterval(function () {
      var Sy = O.sync, idle = !Sy._writing && !Sy._timer && !Sy.pending;
      if (Date.now() - started < 1200 || !idle) return;
      if (Sy.status === 'error') { O.$('.srv-seed-n', el).textContent = 'The connection dropped. Retrying…'; return; }
      clearInterval(t); if (A2) A2.onProgress = null; el.remove(); SEED.el = null;
      U.toast(Sy.status === 'saved' ? 'Demo data is ready. Everyone in the workspace sees it now.' : 'Demo data loaded.');
    }, 300);
  }

  /* ===================================================================
     BANNERS (paused workspace, preview as) and the shell hooks
     =================================================================== */
  function paintBanners() {
    var main = O.$('.main'); if (!main) return;
    var host = O.$('#srv-banners');
    if (!host) { host = document.createElement('div'); host.id = 'srv-banners'; main.insertBefore(host, main.firstChild); }
    var h = '';
    if (S.org && S.readOnly) h += S.readOnlyWhy === 'access' ? '<div class="srv-banner warn" role="status">' + O.icon('lock') + '<span class="grow"><b>Your access to ' + esc(S.entry.name) + ' has changed.</b> Changes are not saved. Reload to continue.</span><button type="button" class="btn btn-sm btn-ghost" data-reload>Reload</button></div>'
      : '<div class="srv-banner warn" role="status">' + O.icon('pause') + '<span class="grow"><b>' + esc(S.entry.name) + ' is paused.</b> You can look around, but changes are not saved until Orbique resumes the workspace.</span></div>';
    if (S.previewing) { var p = D.staffById(S.previewing); h += '<div class="srv-banner info" role="status">' + O.icon('eye') + '<span class="grow">Previewing as <b>' + esc(p ? p.name : 'team member') + '</b>' + (p ? ' (' + esc(p.roleLabel || ROLE_LABEL[p.role] || '') + ')' : '') + '. Changes you make are saved as you.</span><button type="button" class="btn btn-sm btn-ghost" data-stop-preview>Stop</button></div>'; }
    host.innerHTML = h; host.hidden = !h;
    var b = O.$('[data-stop-preview]', host); if (b) b.onclick = function () { A.previewAs(null); };
    var rl = O.$('[data-reload]', host); if (rl) rl.onclick = function () { reload(); };
  }
  function myRole() { return S.org ? S.org.role : null; }
  function isOwner() { return myRole() === 'owner'; }

  /* Locked sections: the core copy tells people to switch the viewer in the menu. Signed-in people cannot, so
     say who they are signed in as, or how to stop previewing. */
  var coreLocked = U.locked;
  U.locked = function (what, opts) {
    var h = coreLocked.apply(this, arguments);
    if (!S.inApp || !S.org) return h;
    var v = O.viewer() || {}, who = esc(v.name || 'a team member') + (v.roleLabel ? ' (' + esc(v.roleLabel) + ')' : '');
    var tail = S.previewing ? 'You are previewing as ' + who + '. Stop the preview to see your own view.'
      : 'You are signed in as ' + who + '. ' + (opts && opts.reason === 'permission' ? 'An account owner can change this in Staff Access.' : 'Ask an account owner if you need it.');
    return h.replace(/<div class="small">[\s\S]*?<\/div>/, '<div class="small">' + tail + '</div>');
  };

  O.workspaceList = function () { return choices(); };
  O.workspaceExtras = function () {
    return S.ctx && S.ctx.platformAdmin ? '<button class="ws-opt" data-ws-action="new-operator"><span class="ws-logo" style="border:1px dashed var(--border-strong);color:var(--muted)">' + O.icon('plus') + '</span><span><span class="t" style="display:block">Add an operator</span><span class="d" style="display:block">A new workspace and its owner</span></span></button>' : '';
  };
  O.onWorkspaceAction = function (act) { if (act === 'new-operator') O.go('platform', { create: true }); };
  O.navExtras = function () {
    if (!(S.ctx && S.ctx.platformAdmin)) return '';
    return '<div class="nav-group">Orbique</div><button class="nav-item' + (O.state.page === 'platform' ? ' active' : '') + '" data-page="platform">' + O.icon('platform') + '<span>' + esc(O.t('platform')) + '</span></button>';
  };
  O.viewerNote = function () {
    if (S.platform) return 'Platform admin';
    if (S.previewing) return 'Preview · ' + ((O.viewer() || {}).roleLabel || '');
    var v = O.viewer(); return (v && (v.roleLabel || ROLE_LABEL[v.role])) || ROLE_LABEL[myRole()] || '';
  };
  O.viewerMenu = function () {
    var h = '<div class="menu-label">Signed in</div><div class="srv-who">' + U.avatar(userName(), 'sm') + '<span class="grow"><b>' + esc(userName()) + '</b><span class="xs muted ellipsis" style="display:block">' + esc(S.user ? S.user.email : '') + '</span></span></div>';
    if (S.previewing) h += '<button class="pop-opt srv-opt" data-auth-act="stop-preview"><span class="row-flex">' + O.icon('x') + 'Stop preview</span></button>';
    else if (isOwner() && !S.platform) h += '<button class="pop-opt srv-opt" data-auth-act="preview"><span class="row-flex">' + O.icon('eye') + 'Preview as…</span></button>';
    h += '<button class="pop-opt srv-opt" data-auth-act="password"><span class="row-flex">' + O.icon('key') + 'Change password</span></button>';
    h += '<button class="pop-opt srv-opt" data-auth-act="signout"><span class="row-flex">' + O.icon('left') + 'Sign out</span></button>';
    return h;
  };
  O.onViewerMenu = function (e) {
    var b = e.target.closest('[data-auth-act]'); if (!b) return false;
    O.$('#viewer-menu').classList.remove('open');
    var a = b.dataset.authAct;
    if (a === 'signout') A.signOut();
    if (a === 'password') changePasswordModal();
    if (a === 'preview') previewPicker();
    if (a === 'stop-preview') A.previewAs(null);
    return false;
  };
  function previewPicker() {
    var people = D.staff.filter(function (s) { return s.id !== S.org.staffId && s.status !== 'left'; });
    var body = people.length ? '<div class="srv-people">' + people.map(function (s) { return '<button type="button" class="pop-opt" data-p="' + esc(s.id) + '"><span class="row-flex">' + U.avatar(s.name, 'sm') + '<span>' + esc(s.name) + '<br><span class="xs muted">' + esc(s.roleLabel || ROLE_LABEL[s.role] || '') + '</span></span></span></button>'; }).join('') + '</div>'
      : '<p class="small muted" style="margin:0">Add people in Staff Access first. Then you can see the app the way they see it.</p>';
    U.modal({ title: 'Preview as…', sub: 'See exactly what a team member sees. Your own access does not change.', body: body, size: 'sm', onOpen: function (el, close) { O.$$('[data-p]', el).forEach(function (x) { x.onclick = function () { close(); A.previewAs(x.dataset.p); }; }); } });
  }
  function changePasswordModal() {
    var body = O.html('<form class="stack" novalidate><input type="email" autocomplete="username" value="' + esc(S.user.email) + '" hidden>' + field('np', 'New password', 'password', { auto: 'new-password', max: 72, hint: 'At least 8 characters.' }) + field('nc', 'Type it again', 'password', { auto: 'new-password', max: 72 }) + '<div class="auth-err" role="alert" hidden></div></form>');
    O.$$('[data-eye]', body).forEach(function (b) { b.onclick = function () { var i = O.$('#' + b.dataset.eye, body), on = i.type === 'password'; i.type = on ? 'text' : 'password'; b.textContent = on ? 'Hide' : 'Show'; }; });
    U.modal({ title: 'Change password', body: body, size: 'sm', actions: [{ label: 'Cancel' }, { label: 'Save password', kind: 'primary', onClick: function (close, el) {
      var p = O.$('#np', body).value, c = O.$('#nc', body).value, er = O.$('.auth-err', body), pp = pwProblem(p, c);
      if (pp) { er.textContent = pp; er.hidden = false; return false; }
      var btn = O.$('.modal-foot .btn-primary', el); btn.disabled = true; btn.textContent = 'Saving…';
      A.changePassword(p).then(function () { close(); U.toast('Password changed'); }, function (e) { er.textContent = errMsg(e); er.hidden = false; btn.disabled = false; btn.textContent = 'Save password'; });
      return false;
    } }] });
  }

  /* ===================================================================
     O.auth used by pages (docs/API.md)
     =================================================================== */
  A.switchWorkspace = function (key) {
    if (S.entry && key === S.entry.id) return;
    if (!O.workspaces[key]) return;
    O.store.set(deviceKey(), key);
    flushThen(reload);
  };
  A.isPlatformAdmin = function () { return !!(S.ctx && S.ctx.platformAdmin); };
  A.user = function () { if (!S.user) return null; var m = S.user.user_metadata || {}; return { id: S.user.id, email: S.user.email, name: userName(), mustChangePassword: !!m.must_change_password }; };
  A.orgId = function () { return S.org ? S.org.id : null; };
  A.role = function () { return myRole(); };
  A.staffId = function () { return S.org ? S.org.staffId : null; };
  A.readOnly = function () { return !!S.readOnly; };
  A.isPreviewing = function () { return S.previewing; };
  A.workspaceMeta = function () { return S.meta ? clone(S.meta) : null; };
  A.signOut = function () {
    S.leaving = true;
    return flushThen(function () { return sb().auth.signOut().catch(function () {}); }).then(function () { stopSaving(); location.reload(); });
  };
  A.changePassword = function (p) {
    var pp = pwProblem(p); if (pp) return Promise.reject(new Error(pp));
    return sb().auth.updateUser({ password: p, data: { must_change_password: false } }).then(function (r) { if (r.error) throw new Error(/different from the old|same password/i.test(r.error.message) ? 'Choose a password that is different from your current one.' : errMsg(r.error)); S.user = r.data.user || S.user; return true; });
  };
  function needOwner() {
    if (!S.org) return Promise.reject(new Error('Open a workspace first.'));
    if (!isOwner()) return Promise.reject(new Error('Only the account owner can do this.'));
    if (S.readOnly) return Promise.reject(new Error('This workspace is paused, so nothing can be changed right now.'));
    return null;
  }
  /* Brand & Setup "Workspace data": load the demo / start empty / reset (the page reloads afterwards) */
  A.loadDemo = function () {
    var no = needOwner(); if (no) return no;
    var started = S.meta && S.meta.storyDate;
    return (started ? U.confirm('This replaces the units, bookings, tasks and everything else in ' + S.entry.name + ' with sample data. Your team and brand stay.', 'Load demo data', 'primary', 'Load demo data?') : Promise.resolve(true)).then(function (ok) {
      if (!ok) return false;
      O.showLoader('Preparing demo data…');
      S.leaving = true; stopSaving(); if (O.sync._unsub) try { O.sync._unsub(); } catch (e) {}
      return (started ? rpc('reset_org', { p_org: S.org.id }) : Promise.resolve()).then(function () {
        return writeMeta(S.org.id, { storyDate: todayMY(), demo: true, seedPending: true });
      }).then(function () { reload(); return true; }, function (e) { S.leaving = false; U.toast(errMsg(e), 'bad'); O.render(); throw e; });
    });
  };
  A.startEmpty = function () {
    var no = needOwner(); if (no) return no;
    var started = S.meta && S.meta.storyDate;
    return (started ? U.confirm('This clears the units, bookings, tasks and everything else in ' + S.entry.name + ' so you can add your own. Your team and brand stay. This cannot be undone.', 'Start empty', 'danger', 'Start with an empty workspace?') : Promise.resolve(true)).then(function (ok) {
      if (!ok) return false;
      O.showLoader('Clearing the workspace…');
      S.leaving = true; stopSaving(); if (O.sync._unsub) try { O.sync._unsub(); } catch (e) {}
      return (started ? rpc('reset_org', { p_org: S.org.id }) : Promise.resolve()).then(function () {
        return writeMeta(S.org.id, { storyDate: todayMY(), demo: false, startedAt: new Date().toISOString() });
      }).then(function () { reload(); return true; }, function (e) { S.leaving = false; U.toast(errMsg(e), 'bad'); O.render(); throw e; });
    });
  };
  A.resetWorkspace = function () {
    var no = needOwner(); if (no) return no;
    return U.confirm('This deletes the units, bookings, tasks, money records and settings in ' + S.entry.name + '. Your team, their sign-ins and your brand stay. You then choose demo data or an empty start again. This cannot be undone.', 'Reset workspace', 'danger', 'Reset this workspace?').then(function (ok) {
      if (!ok) return false;
      O.showLoader('Resetting the workspace…');
      S.leaving = true; stopSaving(); if (O.sync._unsub) try { O.sync._unsub(); } catch (e) {}
      return rpc('reset_org', { p_org: S.org.id }).then(function () { reload(); return true; }, function (e) { S.leaving = false; U.toast(errMsg(e), 'bad'); O.render(); throw e; });
    });
  };
  /* people (Staff Access) */
  A.invite = function (p) {
    var no = needOwner(); if (no) return no;
    p = p || {};
    return A.api('invite', { orgId: S.org.id, staffId: p.staffId, name: p.name, email: p.email, phone: p.phone || '', role: p.role }).then(function (j) { return { email: j.email, tempPassword: j.tempPassword || null, existing: !!j.existing }; });
  };
  function updateMember(staffId, patch) {
    return sb().from('members').update(patch).eq('org_id', S.org.id).eq('staff_id', staffId).select('staff_id').then(function (r) {
      if (r.error) throw new Error(isPerm(r.error) ? 'Your access does not allow this change.' : errMsg(r.error));
      return !!(r.data && r.data.length); /* false: this person has no sign-in here yet (nothing to update) */
    });
  }
  A.setMemberStatus = function (staffId, status) {
    var no = needOwner(); if (no) return no;
    if (status !== 'active' && status !== 'suspended') return Promise.reject(new Error('Unknown status.'));
    if (staffId === S.org.staffId) return Promise.reject(new Error('You cannot pause your own access.'));
    return updateMember(staffId, { status: status }).then(function (signsIn) {
      if (D.staffMeta && typeof D.staffMeta === 'object') { var m = D.staffMeta[staffId] = D.staffMeta[staffId] || {}; if (m.status !== status) { m.status = status; O.emit('data'); } }
      return signsIn;
    });
  };
  A.setMemberRole = function (staffId, role) {
    var no = needOwner(); if (no) return no;
    if (!ROLE_LABEL[role] || role === 'owner') return Promise.reject(new Error('Choose a role other than account owner.'));
    if (staffId === S.org.staffId) return Promise.reject(new Error('You cannot change your own role.'));
    return updateMember(staffId, { role: role }).then(function (signsIn) {
      var s = D.staffById(staffId); if (s && s.role !== role) { s.role = role; s.roleLabel = ROLE_LABEL[role]; O.emit('data'); }
      return signsIn;
    });
  };
  A.resetPassword = function (staffId) {
    var no = needOwner(); if (no) return no;
    return A.api('reset-password', { orgId: S.org.id, staffId: staffId }).then(function (j) { return { email: j.email, tempPassword: j.tempPassword }; });
  };
  /* see the app as a team member: O.state.viewer drives what the UI shows; writes still use the owner's session */
  A.previewAs = function (staffId) {
    if (staffId && !isOwner()) { U.toast('Only the account owner can preview as someone else.', 'bad'); return false; }
    if (staffId && !D.staffById(staffId)) { U.toast('That person is not in this workspace.', 'bad'); return false; }
    var was = S.previewing;
    S.previewing = staffId && staffId !== S.org.staffId ? staffId : null;
    O.state.viewer = S.previewing || S.org.staffId;
    paintBanners();
    O.emit('viewer');
    if (!O.allowed(O.state.page)) O.go(O.tabsFor()[0] || 'dashboard');
    if (S.previewing) U.toast('Previewing as ' + D.staffById(S.previewing).name); else if (was) U.toast('Back to your own view');
    return true;
  };

  /* ===================================================================
     PRODUCTION GUEST API — guests are never signed in; the database reads the booking by its token
     =================================================================== */
  function rpcGuest(name, args) { return guestSb().rpc(name, args).then(function (r) { if (r.error) { var e = new Error(r.error.message || 'The guest app could not load'); e.code = r.error.code; e.details = r.error.details; throw e; } return r.data; }); }
  O.guestApi = Object.assign({}, O.guestApi || {}, {
    server: true,
    get: function (token) { return rpcGuest('guest_get', { p_token: String(token || '') }); },
    act: function (token, action, args) { return rpcGuest('guest_act', { p_token: String(token || ''), p_action: String(action || ''), p_args: args || {} }); }
  });
})();
