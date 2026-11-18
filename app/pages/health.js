/* System health (nav id 'health', owner only): every moving part of the workspace checked in one place.
   Arnob: "the health page and screening should be as detailed and as accurate as possible with options of auto improvements".
   Rows are green (working), amber (look soon), red (broken now) or grey (not set up). The server does the checks
   (api/_lib/healthcheck.js, /api/alerts action 'health'); the minute job runs them every 15 minutes, applies the safe fixes the
   owner left on, and sends the owner an email and phone alert when something newly turns red.
   Safe fixes (switchable here, each logged): clear stuck sends, lift expired pauses, resend stuck alerts. Resending guest messages,
   rates, availability, money and domains are never automatic.
   The local test copy has no server: the page says so. */
(function () {
  var O = window.O, U = O.ui, esc = O.esc;
  var st = { data: null, loading: false, err: null, busy: {}, at: 0 };
  var GROUPS = [['core', 'The app itself'], ['channels', 'Booking sites'], ['messages', 'Messages and alerts'], ['guests', 'Translation'], ['money', 'Money'], ['website', 'Website']];
  var LABEL = { ok: 'Working', warn: 'Look soon', bad: 'Broken', off: 'Not set up' };

  O.css('health', '.pg-health .hl-top{display:flex;align-items:center;gap:16px;padding:18px 20px;margin-bottom:16px;flex-wrap:wrap;}' +
    '.pg-health .hl-top .hl-big{font-size:20px;font-weight:800;}.pg-health .hl-top .hl-sub{color:var(--text-2);font-size:13px;margin-top:2px;}' +
    '.pg-health .hl-dot{width:14px;height:14px;border-radius:50%;flex-shrink:0;background:#9aa3ad;}' +
    '.pg-health .hl-dot.ok{background:var(--ok,#1f9d55);}.pg-health .hl-dot.warn{background:var(--warn,#d99a00);}.pg-health .hl-dot.bad{background:var(--bad,#d64545);}' +
    '.pg-health .hl-grp{margin-bottom:16px;}.pg-health .hl-grp h3{margin:0;padding:14px 18px 6px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--text-2);}' +
    '.pg-health .hl-row{display:flex;gap:12px;align-items:flex-start;padding:11px 18px;border-top:1px solid var(--border);}' +
    '.pg-health .hl-row:first-of-type{border-top:0;}.pg-health .hl-row .hl-dot{margin-top:4px;}' +
    '.pg-health .hl-name{font-weight:700;font-size:14px;}.pg-health .hl-det{color:var(--text-2);font-size:13px;margin-top:2px;overflow-wrap:anywhere;}' +
    '.pg-health .hl-tag{margin-left:auto;font-size:12px;font-weight:700;white-space:nowrap;color:var(--text-2);}' +
    '.pg-health .hl-set{padding:14px 18px;}.pg-health .hl-opt{display:flex;gap:12px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--border);}' +
    '.pg-health .hl-opt:first-of-type{border-top:0;}.pg-health .hl-opt input{margin-top:3px;}.pg-health .hl-log{font-size:13px;color:var(--text-2);padding:6px 0;border-top:1px solid var(--border);}');

  function live() { return !!(O.auth && O.auth.enabled && O.auth.orgId && O.auth.orgId()); }
  function api(action, body) { return O.auth.call('/api/alerts', Object.assign({ action: action, orgId: O.auth.orgId() }, body || {})); }
  function errText(e) { var m = (e && e.message) || ''; return /failed to fetch|network/i.test(m) ? 'Orbique could not be reached. Check your connection and try again.' : m || 'Something went wrong. Please try again.'; }

  function load(force) {
    if (!live() || st.loading || (!force && st.data && Date.now() - st.at < 30e3)) return;
    st.loading = true; st.err = null; repaint();
    api('health').then(function (r) { st.data = r; st.at = Date.now(); }, function (e) { st.err = errText(e); })
      .then(function () { st.loading = false; repaint(); });
  }

  function when(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(O.LOCALES ? O.LOCALES[O.lang && O.lang()] : undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }

  function summary(r) {
    var c = r.counts || {}, o = r.overall;
    var big = o === 'ok' ? 'Everything is running smoothly' : o === 'warn' ? 'Running, with things to look at' : 'Something is broken';
    var sub = [c.bad ? O.tpl('{n} broken', { n: c.bad }) : '', c.warn ? O.tpl('{n} to look at', { n: c.warn }) : '', O.tpl('{n} working', { n: c.ok || 0 }), c.off ? O.tpl('{n} not set up', { n: c.off }) : ''].filter(Boolean).join(' · ');
    return '<div class="card hl-top"><span class="hl-dot ' + o + '"></span><div><div class="hl-big">' + esc(big) + '</div><div class="hl-sub">' + esc(sub) + ' · ' + esc(O.tpl('Checked {when}', { when: when(r.at) })) + '</div></div>' +
      '<button type="button" class="btn btn-ghost" style="margin-left:auto" data-hl="recheck"' + (st.loading ? ' disabled' : '') + '>' + O.icon('refresh') + esc(st.loading ? 'Checking…' : 'Check now') + '</button></div>';
  }

  function rowHTML(i, fixes) {
    var fx = i.fix && fixes && fixes[i.fix] ? '<div style="margin-top:6px"><button type="button" class="btn btn-ghost btn-sm" data-hl-fix="' + esc(i.fix) + '"' + (st.busy[i.fix] ? ' disabled' : '') + '>' + esc(fixes[i.fix].label) + '</button></div>' : '';
    return '<div class="hl-row"><span class="hl-dot ' + i.status + '"></span><div style="min-width:0"><div class="hl-name">' + esc(i.name) + '</div><div class="hl-det">' + esc(i.detail) + '</div>' + fx + '</div><span class="hl-tag">' + esc(LABEL[i.status] || '') + '</span></div>';
  }

  function groups(r, fixes) {
    return GROUPS.map(function (g) {
      var items = (r.items || []).filter(function (i) { return i.group === g[0]; });
      if (!items.length) return '';
      return '<div class="card hl-grp"><h3>' + esc(g[1]) + '</h3>' + items.map(function (i) { return rowHTML(i, fixes); }).join('') + '</div>';
    }).join('');
  }

  function settingsCard(d) {
    var s = d.settings || { auto: {} }, f = d.fixes || {};
    var opts = Object.keys(f).map(function (id) {
      return '<label class="hl-opt"><input type="checkbox" data-hl-auto="' + esc(id) + '"' + (s.auto[id] ? ' checked' : '') + '><span><b>' + esc(f[id].label) + '</b><br><span class="hl-det">' + esc(f[id].about) + '</span></span></label>';
    }).join('');
    var log = (d.log || []).slice(0, 8).map(function (l) { return '<div class="hl-log">' + esc(when(l.at)) + ' · ' + esc(l.fix) + ': ' + esc(l.detail) + '</div>'; }).join('');
    return '<div class="card hl-grp"><h3>' + esc('Fix things by itself') + '</h3><div class="hl-set"><div class="hl-det" style="margin-bottom:6px">' +
      esc('Orbique checks everything every 15 minutes. These safe fixes run on their own and each one is logged. Anything touching guests, prices, availability or money always waits for you.') + '</div>' +
      opts + '<label class="hl-opt"><input type="checkbox" data-hl-alert' + (s.alert ? ' checked' : '') + '><span><b>' + esc('Warn me when something breaks') + '</b><br><span class="hl-det">' +
      esc('An email and a phone alert when a check newly turns red.') + '</span></span></label>' +
      '<div style="margin-top:10px;font-weight:700;font-size:13px">' + esc('What it fixed lately') + '</div>' + (log || '<div class="hl-log">' + esc('Nothing needed fixing yet.') + '</div>') + '</div></div>';
  }

  function body() {
    if (!live()) return '<div class="card" style="padding:18px 20px">' + esc('The health check runs on the live Orbique, where it can see the database, email, booking sites and alerts. It is not available in the local test copy.') + '</div>';
    if (st.err && !st.data) return '<div class="card" style="padding:18px 20px"><div style="font-weight:700">' + esc(st.err) + '</div><div style="margin-top:10px"><button type="button" class="btn btn-ghost" data-hl="recheck">' + esc('Try again') + '</button></div></div>';
    if (!st.data) return '<div class="card" style="padding:18px 20px">' + esc('Checking everything…') + '</div>';
    return summary(st.data.report) + groups(st.data.report, st.data.fixes) + settingsCard(st.data);
  }

  function repaint() { var el = O.$('[data-health]'); if (el) { el.innerHTML = body(); wire(el); } }

  function wire(el) {
    var re = el.querySelectorAll('[data-hl="recheck"]');
    Array.prototype.forEach.call(re, function (b) { b.onclick = function () { load(true); }; });
    Array.prototype.forEach.call(el.querySelectorAll('[data-hl-fix]'), function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-hl-fix'); st.busy[id] = true; repaint();
        api('health-fix', { fix: id }).then(function (r) { U.toast(r.result.changed ? r.result.detail : 'Nothing needed fixing.', 'ok'); }, function (e) { U.toast(errText(e), 'bad'); })
          .then(function () { st.busy[id] = false; load(true); });
      };
    });
    function save(patch) {
      api('health-settings', patch).then(function (r) { st.data.settings = r.settings; U.toast('Saved', 'ok'); }, function (e) { U.toast(errText(e), 'bad'); load(true); });
    }
    Array.prototype.forEach.call(el.querySelectorAll('[data-hl-auto]'), function (b) {
      b.onchange = function () { var a = {}; a[b.getAttribute('data-hl-auto')] = b.checked; save({ auto: a }); };
    });
    var al = el.querySelector('[data-hl-alert]');
    if (al) al.onchange = function () { save({ alert: al.checked }); };
  }

  O.page('health', {
    desc: 'Every part of Orbique checked in one place, with safe fixes that run by themselves.',
    noDataRerender: true,
    render: function (root) {
      root.innerHTML = '<div class="pg-health" data-health>' + body() + '</div>';
      wire(O.$('[data-health]', root));
      load(false);
    }
  });
})();
