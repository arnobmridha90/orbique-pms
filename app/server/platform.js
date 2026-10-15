/* ===================================================================
   Platform admin (production only): Orbique staff manage operators.
   Counts only: never an operator's guests or money. Data: platform_operators() (0004_app.sql, falls back to
   platform_overview() from 0001), subscription_requests, set_org_plan / set_org_status, and /api/account
   (create-operator, reset-password). Reached from the "Orbique" menu group or the "Orbique platform" workspace.
   =================================================================== */
(function () {
  var O = window.O, U = O.ui, d = O.d, esc = O.esc;
  if (!O.auth || !O.auth.enabled || !O.auth.enabled()) return;

  var PLANS = [['trial', 'Trial'], ['starter', 'Starter'], ['growth', 'Growth'], ['pro', 'Pro']];
  var st = { tab: 'ops', q: '', filter: 'all', reqFilter: 'new' };
  var cache = { ops: null, reqs: null, at: 0, loading: null, err: null, fallback: false };
  var seq = 0;

  function sb() { return O.auth.supabase(); }
  function rpc(name, args) { return sb().rpc(name, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function planName(p) { var x = PLANS.filter(function (q) { return q[0] === p; })[0]; return x ? x[1] : String(p || 'trial').charAt(0).toUpperCase() + String(p || 'trial').slice(1); }
  /* database timestamps (UTC) -> Malaysia 'YYYY-MM-DDTHH:MM' as the rest of the app uses */
  function my(ts) { if (!ts) return null; var t = Date.parse(ts); return isNaN(t) ? null : new Date(t + 8 * 36e5).toISOString().slice(0, 16); }
  function ago(ts) { var m = my(ts); if (!m) return 'No activity yet'; var a = O.fmt.ago(m); return a === 'just now' ? 'Active just now' : 'Active ' + a; }
  function dateOf(ts) { var m = my(ts); return m ? d.fmtY(m.slice(0, 10)) : '–'; }
  function num(n) { return n == null ? '–' : O.fmt.num(n); }
  function errText(e) { var m = (e && e.message) || ''; if (/failed to fetch|network/i.test(m)) return 'Orbique could not be reached. Check your connection and try again.'; if (/not allowed|row-level|permission/i.test(m)) return 'Only Orbique platform admins can do this.'; return m || 'Something went wrong. Please try again.'; }
  function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || 'there'; }

  /* ---------------- data ---------------- */
  function loadOps() {
    return rpc('platform_operators').then(function (list) { cache.fallback = false; return list || []; }, function (e) {
      if (!(e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message || '')))) throw e;
      /* 0004_app.sql not applied yet: the core overview (no bookings count) + owners' staff ids from members */
      cache.fallback = true;
      return Promise.all([rpc('platform_overview'), sb().from('members').select('org_id,staff_id,role,status').eq('role', 'owner')]).then(function (res) {
        var byOrg = {}; ((res[1] && res[1].data) || []).forEach(function (m) { (byOrg[m.org_id] = byOrg[m.org_id] || []).push(m); });
        return (res[0] || []).map(function (o) {
          var ms = byOrg[o.id] || [], emails = o.owners || [];
          return Object.assign({}, o, { bookings: null, setup: null, owners: ms.map(function (m, i) { return { staffId: m.staff_id, email: ms.length === emails.length ? emails[i] : '', name: '', status: m.status }; }) });
        }).reverse();
      });
    });
  }
  function loadReqs() {
    return sb().from('subscription_requests').select('*').order('created_at', { ascending: false }).limit(300).then(function (r) { if (r.error) throw r.error; return r.data || []; });
  }
  function load(force) {
    if (cache.loading) return cache.loading;
    if (!force && cache.ops && Date.now() - cache.at < 30000) return Promise.resolve();
    cache.loading = Promise.all([loadOps(), loadReqs()]).then(function (res) { cache.ops = res[0]; cache.reqs = res[1]; cache.at = Date.now(); cache.err = null; }, function (e) { cache.err = e; console.warn('Orbique platform: could not load', e); })
      .then(function () { cache.loading = null; });
    return cache.loading;
  }
  function opById(id) { return (cache.ops || []).filter(function (o) { return o.id === id; })[0] || null; }

  /* ---------------- copy to clipboard ---------------- */
  function copy(text, what) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } ta.remove();
      U.toast(ok ? (what || 'Text') + ' copied' : 'Copy did not work here. Select the text and copy it yourself.', ok ? 'ok' : 'bad');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { U.toast((what || 'Text') + ' copied'); }, fallback); else fallback();
  }

  /* sign-in details for a new owner or after a password reset, with a message ready to send on WhatsApp */
  function credentials(o) {
    var url = O.auth.appUrl() || location.origin;
    var msg = o.tempPassword ? (o.reset
      ? 'Hi ' + firstName(o.name) + ', here is a new temporary password for Orbique.\n\nSign in at ' + url + '\nEmail: ' + o.email + '\nTemporary password: ' + o.tempPassword + '\n\nYou will choose a new password when you sign in.'
      : 'Hi ' + firstName(o.name) + ', your Orbique workspace for ' + o.company + ' is ready.\n\nSign in at ' + url + '\nEmail: ' + o.email + '\nTemporary password: ' + o.tempPassword + '\n\nYou will choose your own password when you first sign in.')
      : 'Hi ' + firstName(o.name) + ', your Orbique workspace for ' + o.company + ' is ready. Sign in at ' + url + ' with ' + o.email + ' and your usual Orbique password, then choose ' + o.company + ' from your workspaces.';
    function row(label, value, cls, key) { return '<div class="pf-cred"><div class="grow"><div class="label">' + esc(label) + '</div><div class="pf-cred-v ' + (cls || '') + '">' + esc(value) + '</div></div><button type="button" class="btn btn-ghost btn-sm" data-copy="' + key + '">' + O.icon('copy') + 'Copy</button></div>'; }
    var body = '<div class="stack">' +
      (o.tempPassword ? '<div class="note brand">Send these details to <b>' + esc(o.name || o.email) + '</b>, for example on WhatsApp. ' + (o.reset ? 'The old password no longer works.' : 'They choose their own password the first time they sign in.') + '</div>'
        : '<div class="note brand"><b>' + esc(o.email) + '</b> already has an Orbique account, so they sign in with their usual password and will find ' + esc(o.company) + ' in their workspace list.</div>') +
      row('Sign in at', url, '', 'url') + row('Email', o.email, '', 'email') + (o.tempPassword ? row('Temporary password', o.tempPassword, 'pf-pw', 'pw') : '') +
      '<div class="field"><label for="pf-msg">Message ready to send</label><textarea class="textarea" id="pf-msg" rows="7" readonly>' + esc(msg) + '</textarea></div></div>';
    U.modal({
      title: o.reset ? 'New password for ' + (o.name || o.email) : o.company + ' is ready', sub: o.reset ? o.company : 'Workspace created on the ' + planName(o.plan) + ' plan', body: body, autofocus: false,
      actions: [{ label: 'Done' }, { label: 'Copy message', kind: 'primary', onClick: function () { copy(msg, 'Message'); return false; } }],
      onOpen: function (el) { O.$$('[data-copy]', el).forEach(function (b) { b.onclick = function () { var k = b.dataset.copy; copy(k === 'url' ? url : k === 'email' ? o.email : o.tempPassword, k === 'url' ? 'Link' : k === 'email' ? 'Email' : 'Password'); }; }); }
    });
  }

  /* ---------------- create operator ---------------- */
  function openCreate(pre, after) {
    pre = pre || {};
    var body = O.html('<form class="stack" novalidate>' +
      '<div class="field"><label for="pf-co">Company name</label><input class="input" id="pf-co" maxlength="120" autocomplete="organization" value="' + esc(pre.company || '') + '"></div>' +
      '<div class="form-grid"><div class="field"><label for="pf-on">Owner\'s name</label><input class="input" id="pf-on" maxlength="80" autocomplete="name" value="' + esc(pre.name || '') + '"></div>' +
      '<div class="field"><label for="pf-oe">Owner\'s email</label><input class="input" id="pf-oe" type="email" inputmode="email" maxlength="254" autocomplete="email" value="' + esc(pre.email || '') + '"></div></div>' +
      '<div class="field"><label for="pf-pl">Plan</label><select class="select" id="pf-pl">' + PLANS.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === (pre.plan || 'trial') ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select><div class="hint">You can change the plan later.</div></div>' +
      '<div class="small muted">Orbique creates the workspace and the owner\'s sign-in with a temporary password for you to send them. If the email already has an account, they are added as the owner without changing their password.</div>' +
      '<div class="auth-err" role="alert" hidden></div></form>');
    var m = U.modal({
      title: 'Add an operator', sub: 'A new private workspace and its owner', body: body,
      actions: [{ label: 'Cancel' }, { label: 'Create workspace', kind: 'primary', id: 'pf-create', onClick: function (close, el) {
        var v = { company: O.$('#pf-co', body).value.trim(), ownerName: O.$('#pf-on', body).value.trim(), ownerEmail: O.$('#pf-oe', body).value.trim().toLowerCase(), plan: O.$('#pf-pl', body).value };
        var er = O.$('.auth-err', body);
        function fail(t) { er.textContent = t; er.hidden = false; btn.disabled = false; btn.textContent = 'Create workspace'; }
        var btn = O.$('#pf-create', el);
        if (!v.company) { fail('Enter the company name.'); return false; }
        if (!v.ownerName) { fail('Enter the owner\'s name.'); return false; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.ownerEmail)) { fail('Enter a valid email address for the owner.'); return false; }
        btn.disabled = true; btn.textContent = 'Creating…'; er.hidden = true;
        O.auth.api('create-operator', v).then(function (j) {
          close();
          credentials({ company: v.company, name: v.ownerName, email: j.email || v.ownerEmail, tempPassword: j.tempPassword, plan: v.plan });
          if (after) after(j);
          load(true).then(repaint);
        }, function (e) { fail(errText(e)); });
        return false;
      } }]
    });
    return m;
  }

  /* ---------------- manage one operator ---------------- */
  function setupLabel(o) { return o.setup === 'demo' ? U.pill('Demo data', 'info') : o.setup === 'none' ? U.pill('Not set up yet', 'neutral') : ''; }
  function statusPill(o) { return o.status === 'paused' ? U.pill('Paused', 'warn') : U.pill('Active', 'ok'); }
  function openManage(id) {
    var o = opById(id); if (!o) return;
    var owners = o.owners || [];
    var body = O.html('<div class="stack">' +
      '<div class="row-flex wrap">' + statusPill(o) + U.pill(planName(o.plan), 'brand') + setupLabel(o) + '</div>' +
      '<dl class="kv"><dt>Created</dt><dd>' + dateOf(o.createdAt) + '</dd><dt>Last activity</dt><dd>' + esc(ago(o.lastActivity)) + '</dd><dt>Team members</dt><dd>' + num(o.members) + '</dd><dt>Units</dt><dd>' + num(o.units) + '</dd>' + (o.bookings != null ? '<dt>Bookings</dt><dd>' + num(o.bookings) + '</dd>' : '') + '</dl>' +
      '<div><div class="section-title" style="margin-top:4px">Plan</div><div class="row-flex"><select class="select" id="pf-plan" style="max-width:220px">' + PLANS.concat(PLANS.some(function (p) { return p[0] === o.plan; }) ? [] : [[o.plan, planName(o.plan)]]).map(function (p) { return '<option value="' + esc(p[0]) + '"' + (p[0] === o.plan ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('') + '</select><button type="button" class="btn btn-ghost" data-act="plan">Save plan</button></div></div>' +
      '<div><div class="section-title" style="margin-top:4px">Workspace</div>' + (o.status === 'paused'
        ? '<div class="small muted" style="margin-bottom:8px">Paused: the team can sign in and look, but nothing can be changed.</div><button type="button" class="btn btn-primary" data-act="resume">' + O.icon('play') + 'Resume workspace</button>'
        : '<div class="small muted" style="margin-bottom:8px">Pausing keeps all data. The team can still sign in and look, but cannot change anything.</div><button type="button" class="btn btn-ghost pf-danger" data-act="pause">' + O.icon('pause') + 'Pause workspace</button>') + '</div>' +
      '<div><div class="section-title" style="margin-top:4px">Owner sign-in</div>' + (owners.length ? owners.map(function (w) {
        return '<div class="list-row"><div class="lr-main"><div class="lr-title">' + esc(w.name || w.email || 'Owner') + '</div><div class="lr-sub">' + esc(w.email || w.staffId) + (w.status && w.status !== 'active' ? ' · access paused' : '') + '</div></div><button type="button" class="btn btn-ghost btn-sm" data-reset="' + esc(w.staffId) + '">' + O.icon('key') + 'Reset password</button></div>';
      }).join('') : '<div class="small muted">No owner yet.</div>') + '</div>' +
      '<div class="auth-err" role="alert" hidden></div></div>');
    var er = O.$('.auth-err', body);
    function fail(e) { er.textContent = errText(e); er.hidden = false; }
    var m = U.modal({ title: o.name, sub: 'Counts only. Guests and money stay private to the operator.', body: body, autofocus: false, actions: [{ label: 'Close' }] });
    O.$('[data-act="plan"]', body).onclick = function (e) {
      var b = e.currentTarget, plan = O.$('#pf-plan', body).value; if (plan === o.plan) { U.toast('Plan unchanged'); return; }
      b.disabled = true; b.textContent = 'Saving…';
      rpc('set_org_plan', { p_org: o.id, p_plan: plan }).then(function () { o.plan = plan; m.close(); U.toast(o.name + ' is now on the ' + planName(plan) + ' plan'); load(true).then(repaint); }, function (ex) { b.disabled = false; b.textContent = 'Save plan'; fail(ex); });
    };
    var ps = O.$('[data-act="pause"], [data-act="resume"]', body);
    ps.onclick = function () {
      var pause = ps.dataset.act === 'pause';
      (pause ? U.confirm('The team of ' + o.name + ' can still sign in and look, but nothing can be changed until you resume the workspace.', 'Pause workspace', 'danger', 'Pause ' + o.name + '?') : Promise.resolve(true)).then(function (ok) {
        if (!ok) return;
        ps.disabled = true;
        rpc('set_org_status', { p_org: o.id, p_status: pause ? 'paused' : 'active' }).then(function () { m.close(); U.toast(o.name + (pause ? ' is paused' : ' is active again')); load(true).then(repaint); }, function (ex) { ps.disabled = false; fail(ex); });
      });
    };
    O.$$('[data-reset]', body).forEach(function (b) {
      b.onclick = function () {
        var w = owners.filter(function (x) { return x.staffId === b.dataset.reset; })[0] || {};
        U.confirm('Their current password stops working. You then send them the new temporary one.', 'Reset password', 'primary', 'Reset the password of ' + (w.name || w.email || 'this owner') + '?').then(function (ok) {
          if (!ok) return;
          b.disabled = true;
          O.auth.api('reset-password', { orgId: o.id, staffId: b.dataset.reset }).then(function (j) { m.close(); credentials({ reset: true, company: o.name, name: w.name || '', email: j.email || w.email, tempPassword: j.tempPassword }); }, function (ex) { b.disabled = false; fail(ex); });
        });
      };
    });
  }

  /* ---------------- requests ---------------- */
  function setReq(r, status) {
    return sb().from('subscription_requests').update({ status: status }).eq('id', r.id).select('id').then(function (q) { if (q.error) throw q.error; if (!q.data || !q.data.length) throw new Error('This request could not be updated.'); r.status = status; });
  }

  /* ---------------- painting ---------------- */
  var cur = { root: null, ctx: null, id: 0 };
  function repaint() { if (cur.root && cur.id === seq && O.state.page === 'platform' && document.body.contains(cur.root)) paint(cur.root); }
  function paint(root) {
    if (cache.err && !cache.ops) {
      root.innerHTML = '<div class="card"><div class="card-body">' + U.empty('The operator list could not load. ' + errText(cache.err), '⚠') + '<div class="center" style="padding-bottom:12px"><button type="button" class="btn btn-primary" data-act="retry">Try again</button></div></div></div>';
      O.$('[data-act="retry"]', root).onclick = function () { root.innerHTML = '<div class="boot-loader"><div class="spinner"></div><div>Loading operators…</div></div>'; load(true).then(repaint); };
      return;
    }
    var ops = cache.ops || [], reqs = cache.reqs || [];
    var newReqs = reqs.filter(function (r) { return r.status === 'new'; }).length;
    var paused = ops.filter(function (o) { return o.status === 'paused'; }).length;
    var sum = function (k) { return ops.reduce(function (s, o) { return s + (+o[k] || 0); }, 0); };
    var kp = [{ label: 'Operators', value: num(ops.length), sub: paused ? paused + ' paused' : 'All active' }, { label: 'Units managed', value: num(sum('units')) }];
    if (!cache.fallback) kp.push({ label: 'Bookings', value: num(sum('bookings')) });
    kp.push({ label: 'New requests', value: num(newReqs), hl: newReqs > 0, sub: newReqs ? 'Waiting for you' : 'Nothing waiting' });
    root.innerHTML = '<div class="pf">' + U.kpis(kp) +
      '<div class="tabs" role="tablist"><button type="button" role="tab" data-tab="ops" class="' + (st.tab === 'ops' ? 'on' : '') + '">Operators</button><button type="button" role="tab" data-tab="req" class="' + (st.tab === 'req' ? 'on' : '') + '">Access requests' + (newReqs ? ' <span class="pf-n">' + newReqs + '</span>' : '') + '</button><button type="button" role="tab" data-tab="chx" class="' + (st.tab === 'chx' ? 'on' : '') + '">Channel manager</button></div>' +
      '<div class="pf-body"></div></div>';
    O.$$('[data-tab]', root).forEach(function (b) { b.onclick = function () { st.tab = b.dataset.tab; paint(root); }; });
    var body = O.$('.pf-body', root);
    if (st.tab === 'ops') paintOps(body, ops); else if (st.tab === 'chx') paintChannex(body); else paintReqs(body, reqs);
  }
  /* ---------------- channel manager setup: POST /api/channex {action:'admin-setup'} ----------------
     Checks which server settings are present and creates or updates the one global Channex webhook. */
  var chx = { busy: false, res: null, err: null };
  function paintChannex(body) {
    var r = chx.res, s = r && r.settings, w = r && r.webhook;
    var yes = function (v) { return v ? U.pill('Set', 'ok') : U.pill('Missing', 'warn'); };
    var rows = s ? [['Channex API key', yes(s.apiKey)], ['Environment', U.pill(s.env || 'staging', s.env === 'production' ? 'brand' : 'info') + ' <span class="xs muted">' + esc(s.baseUrl || '') + '</span>'], ['App address (APP_URL)', s.appUrl ? esc(s.appUrl) : U.pill('Missing', 'warn')],
      ['Webhook signing', s.webhookSecret && s.signingKeyId ? U.pill('Signed', 'ok') : s.webhookToken ? U.pill('Token header', 'ok') : U.pill('Missing', 'warn')], ['Worker secret (cron)', yes(s.workerSecret)],
      ['Workspaces switched on', s.allowlist ? esc(O.fmt.plural(s.allowlist, 'workspace')) : esc(s.env === 'production' ? 'All workspaces' : 'None (staging needs CHANNEX_ORG_ALLOWLIST)')], ['Last call to Channex', s.lastCallAt ? esc(ago(s.lastCallAt).replace(/^Active /, '')) : 'Never']] : [];
    body.innerHTML = '<div class="card" data-card="channex-setup"><div class="card-head"><div><h3>Channel manager setup</h3><div class="sub">Checks the server settings and creates or updates the one Channex webhook that brings bookings in. Safe to run again.</div></div>' +
      '<button type="button" class="btn btn-primary btn-sm" data-act="chx-run"' + (chx.busy ? ' disabled' : '') + '>' + O.icon('refresh') + (chx.busy ? 'Checking…' : r ? 'Check again' : 'Check and set up') + '</button></div><div class="card-body stack">' +
      (chx.err ? '<div class="note warn">' + esc(chx.err) + '</div>' : '') +
      (r ? '<dl class="kv">' + rows.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + x[1] + '</dd>'; }).join('') + '<dt>Webhook</dt><dd>' + (w ? U.pill({ ok: 'Already right', updated: 'Updated', created: 'Created' }[w.state] || w.state, 'ok') + ' <span class="xs muted">' + esc(w.callbackUrl || '') + (w.signed ? ' · signed' : '') + '</span>' : U.pill('Not set up', 'warn')) + '</dd></dl>' +
        (r.message ? '<div class="note warn">' + esc(r.message) + '</div>' : '') : '<div class="small muted">Nothing checked yet. The check calls Channex, so run it after changing the server settings.</div>') + '</div></div>';
    var b = O.$('[data-act="chx-run"]', body);
    if (b) b.onclick = function () {
      chx.busy = true; chx.err = null; paintChannex(body);
      O.auth.call('/api/channex', { action: 'admin-setup' }).then(function (res) { chx.busy = false; chx.res = res; U.toast(res.webhook ? 'Channel manager webhook is ready' : 'Some settings are still missing', res.webhook ? 'ok' : 'bad'); }, function (e) { chx.busy = false; chx.err = errText(e); })
        .then(function () { if (document.body.contains(body)) paintChannex(body); });
    };
  }
  function paintOps(body, ops) {
    var q = st.q.toLowerCase();
    var list = ops.filter(function (o) {
      if (st.filter !== 'all' && o.status !== st.filter) return false;
      if (!q) return true;
      return (o.name + ' ' + (o.owners || []).map(function (w) { return (w.email || '') + ' ' + (w.name || ''); }).join(' ')).toLowerCase().indexOf(q) >= 0;
    });
    body.innerHTML = '<div class="toolbar"><label class="search">' + O.icon('search') + '<input type="search" placeholder="Search operators or owners" aria-label="Search operators" value="' + esc(st.q) + '"></label>' +
      U.seg([['all', 'All'], ['active', 'Active'], ['paused', 'Paused']], st.filter, 'data-f') + '</div>' +
      (!ops.length ? '<div class="card"><div class="card-body pf-empty"><div class="pf-empty-ic">' + O.icon('platform') + '</div><b>No operators yet</b><div class="small muted">Add the first operator. Orbique creates their private workspace and a sign-in for the owner.</div><button type="button" class="btn btn-primary" data-act="create">' + O.icon('plus') + 'Add an operator</button></div></div>'
        : !list.length ? '<div class="card"><div class="card-body">' + U.empty('No operators match. Clear the search or the filter.', '∅') + '</div></div>'
          : '<div class="card pf-desk"><div class="table-wrap"><table class="table pf-table"><thead><tr><th>Operator</th><th>Plan</th><th>Status</th><th class="num">Team</th><th class="num">Units</th>' + (cache.fallback ? '' : '<th class="num">Bookings</th>') + '<th>Created</th><th>Last activity</th><th></th></tr></thead><tbody>' +
            list.map(function (o) {
              var own = (o.owners || [])[0] || {};
              return '<tr class="click" data-org="' + esc(o.id) + '"><td><div class="b">' + esc(o.name) + '</div><div class="xs muted">' + esc(own.email || own.name || 'No owner yet') + '</div></td><td>' + U.pill(planName(o.plan), 'brand') + '</td><td><span class="row-flex">' + statusPill(o) + setupLabel(o) + '</span></td><td class="num">' + num(o.members) + '</td><td class="num">' + num(o.units) + '</td>' + (cache.fallback ? '' : '<td class="num">' + num(o.bookings) + '</td>') +
                '<td class="nowrap">' + dateOf(o.createdAt) + '</td><td class="nowrap small muted">' + esc(ago(o.lastActivity).replace(/^Active /, '')) + '</td><td class="right"><button type="button" class="btn btn-ghost btn-sm" data-org="' + esc(o.id) + '">Manage</button></td></tr>';
            }).join('') + '</tbody></table></div></div>' +
            '<div class="pf-phone">' + list.map(function (o) {
              var own = (o.owners || [])[0] || {};
              return '<button type="button" class="pf-card card" data-org="' + esc(o.id) + '"><span class="pf-card-top"><b class="grow ellipsis">' + esc(o.name) + '</b>' + statusPill(o) + '</span><span class="small muted ellipsis" style="display:block">' + esc(own.email || own.name || 'No owner yet') + '</span>' +
                '<span class="pf-stats"><span>' + U.pill(planName(o.plan), 'brand') + '</span><span><b>' + num(o.members) + '</b> team</span><span><b>' + num(o.units) + '</b> units</span>' + (cache.fallback ? '' : '<span><b>' + num(o.bookings) + '</b> bookings</span>') + '</span>' +
                '<span class="xs muted" style="display:block">Since ' + dateOf(o.createdAt) + ' · ' + esc(ago(o.lastActivity).toLowerCase()) + '</span></button>';
            }).join('') + '</div>');
    var inp = O.$('.search input', body);
    inp.oninput = function () { st.q = inp.value; var pos = inp.selectionStart; paintOps(body, ops); var n = O.$('.search input', body); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
    O.$$('[data-f]', body).forEach(function (b) { b.onclick = function () { st.filter = b.dataset.f; paintOps(body, ops); }; });
    O.$$('[data-org]', body).forEach(function (el) { el.onclick = function (e) { e.stopPropagation(); openManage(el.dataset.org); }; });
    var c = O.$('[data-act="create"]', body); if (c) c.onclick = function () { openCreate(); };
  }
  function paintReqs(body, reqs) {
    var list = reqs.filter(function (r) { return st.reqFilter === 'all' || (st.reqFilter === 'new' ? r.status === 'new' : r.status !== 'new'); });
    body.innerHTML = '<div class="toolbar">' + U.seg([['new', 'New'], ['done', 'Handled'], ['all', 'All']], st.reqFilter, 'data-rf') + '<div class="spacer"></div><span class="small muted">From the "Request access" form on the sign-in screen</span></div>' +
      (!list.length ? '<div class="card"><div class="card-body">' + U.empty(st.reqFilter === 'new' ? 'No new requests. Operators who tap Request access on the sign-in screen appear here.' : 'No requests here yet.', '✓') + '</div></div>'
        : '<div class="pf-reqs">' + list.map(function (r) {
          var when = my(r.created_at);
          return '<div class="card pf-req"><div class="card-body stack"><div class="row-flex wrap"><b class="grow pf-req-co">' + esc(r.company || 'Company not given') + '</b>' + (r.status === 'new' ? U.pill('New', 'info') : r.status === 'declined' ? U.pill('Declined', 'neutral') : U.pill('Handled', 'ok')) + '</div>' +
            '<div class="pf-req-who"><span>' + O.icon('user') + esc(r.contact_name || 'No name') + '</span>' + (r.email ? '<span>' + O.icon('mail') + esc(r.email) + '</span>' : '') + (r.phone ? '<span>' + O.icon('phone') + esc(r.phone) + '</span>' : '') + (r.units != null ? '<span>' + O.icon('properties') + esc(O.fmt.plural(+r.units, 'unit')) + '</span>' : '') + '</div>' +
            (r.message ? '<div class="pf-req-msg">' + esc(r.message) + '</div>' : '') +
            '<div class="row-flex wrap"><span class="xs muted grow">Received ' + (when ? esc(O.fmt.ago(when)) : '') + '</span>' +
            (r.status === 'new' ? '<button type="button" class="btn btn-quiet btn-sm" data-req="decline" data-id="' + esc(r.id) + '">Decline</button><button type="button" class="btn btn-ghost btn-sm" data-req="handled" data-id="' + esc(r.id) + '">Mark handled</button><button type="button" class="btn btn-primary btn-sm" data-req="setup" data-id="' + esc(r.id) + '">' + O.icon('plus') + 'Set up operator</button>'
              : '<button type="button" class="btn btn-quiet btn-sm" data-req="reopen" data-id="' + esc(r.id) + '">Move back to new</button>') + '</div></div></div>';
        }).join('') + '</div>');
    O.$$('[data-rf]', body).forEach(function (b) { b.onclick = function () { st.reqFilter = b.dataset.rf; paintReqs(body, reqs); }; });
    O.$$('[data-req]', body).forEach(function (b) {
      b.onclick = function () {
        var r = reqs.filter(function (x) { return String(x.id) === b.dataset.id; })[0]; if (!r) return;
        var act = b.dataset.req;
        if (act === 'setup') { openCreate({ company: r.company, name: r.contact_name, email: r.email }, function () { setReq(r, 'approved').catch(function () {}).then(function () { load(true).then(repaint); }); }); return; }
        b.disabled = true;
        setReq(r, act === 'handled' ? 'approved' : act === 'decline' ? 'declined' : 'new').then(function () {
          U.toast(act === 'reopen' ? 'Moved back to new' : act === 'decline' ? 'Request declined' : 'Marked as handled');
          paint(cur.root);
        }, function (e) { b.disabled = false; U.toast(errText(e), 'bad'); });
      };
    });
  }

  O.page('platform', {
    desc: 'Operators, plans, access requests and the channel manager',
    noDataRerender: true,
    render: function (root, ctx) {
      if (!O.auth.isPlatformAdmin()) { root.innerHTML = U.locked('the platform admin area', { reason: 'permission' }); return; }
      var id = ++seq; cur.root = root; cur.ctx = ctx; cur.id = id;
      root.classList.add('pg-platform');
      var acts = O.html('<div class="row-flex"><button type="button" class="btn btn-ghost btn-sm pf-refresh" title="Refresh the list" aria-label="Refresh">' + O.icon('refresh') + '<span class="pf-hide-sm">Refresh</span></button><button type="button" class="btn btn-primary btn-sm">' + O.icon('plus') + 'Add operator</button></div>');
      O.$('.pf-refresh', acts).onclick = function () { var b = O.$('.pf-refresh', acts); b.disabled = true; load(true).then(function () { b.disabled = false; repaint(); U.toast('Up to date'); }); };
      O.$('.btn-primary', acts).onclick = function () { openCreate(); };
      ctx.setActions(acts);
      if (cache.ops || cache.err) paint(root); else root.innerHTML = '<div class="boot-loader"><div class="spinner"></div><div>Loading operators…</div></div>';
      load(false).then(function () { if (cur.id === id) repaint(); });
      if (ctx.fresh && ctx.params && ctx.params.create) setTimeout(function () { openCreate(); }, 0);
    }
  });
  O.EXTRA_PAGES.platform = { allowed: function () { return !!(O.auth && O.auth.isPlatformAdmin && O.auth.isPlatformAdmin()); } };
})();
