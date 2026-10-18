/* ===================================================================
   Booking alerts (production only): the "Booking alerts" card at the top of Automations.
   When a booking site (or the guest website) sends a new booking, a cancellation or new dates, the team gets an
   alert by email, WhatsApp and the phone app (api/_lib/alerts.js, migration 0011). This card edits who gets them
   (D.alertSettings: {on, kinds: {new, cancelled, changed}, emails: [..], whatsapp: ['+60..'], push}), shows which
   channels the server has set up (/api/alerts status) and sends a test alert. On the phone app, O.native.push
   (app/native/bridge.js) turns alerts on for this phone.
   =================================================================== */
/* Loads after app/server/auth.js (files load in name order), which defines O.auth. */
(function () {
  var O = window.O, U = O.ui, D = O.data, esc = O.esc;
  if (!O.auth || !O.auth.enabled || !O.auth.enabled()) return;

  var st = { status: null, loading: false, err: null, at: 0, testing: false, last: null };
  var KINDS = [['new', 'New bookings'], ['cancelled', 'Cancellations'], ['changed', 'Date changes']];
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function settings() {
    var s = D.alertSettings || {}, k = s.kinds || {};
    return { on: s.on !== false, kinds: { new: k.new !== false, cancelled: k.cancelled !== false, changed: k.changed !== false },
      emails: (s.emails || []).slice(), whatsapp: (s.whatsapp || []).slice(), push: s.push !== false };
  }
  function canEdit() { var r = O.auth.role && O.auth.role(); return (r === 'owner' || r === 'ops') && !(O.auth.readOnly && O.auth.readOnly()); }
  function api(action, body) { return O.auth.call('/api/alerts', Object.assign({ action: action, orgId: O.auth.orgId() }, body || {})); }
  function errText(e) { var m = (e && e.message) || ''; return /failed to fetch|network/i.test(m) ? 'Orbique could not be reached. Check your connection and try again.' : m || 'Something went wrong. Please try again.'; }
  function repaint() { var el = O.$('[data-alerts-card]'); if (el) { var n = O.html(card()); el.replaceWith(n); } }

  function load(force) {
    if (!O.auth.orgId() || st.loading || (!force && st.status && Date.now() - st.at < 60e3)) return;
    st.loading = true;
    api('status').then(function (r) { st.status = r.status; st.err = null; }, function (e) { st.err = errText(e); })
      .then(function () { st.loading = false; st.at = Date.now(); repaint(); });
  }

  /* ---------- the card ---------- */
  function line(icon, name, ready, who, why) {
    return '<div class="row-flex" style="gap:10px; align-items:flex-start; padding:8px 0; border-top:1px solid var(--border)">' + O.icon(icon, 'al-ic') +
      '<div class="grow" style="min-width:0"><b>' + esc(name) + '</b><div class="small muted">' + who + '</div>' + (why ? '<div class="xs muted" style="margin-top:2px">' + why + '</div>' : '') + '</div>' +
      (ready === null ? U.pill('Checking', 'neutral') : ready ? U.pill('Ready', 'ok') : U.pill('Set up needed', 'warn')) + '</div>';
  }
  function card() {
    var s = settings(), x = st.status, edit = canEdit(), native = !!(O.native && O.native.push);
    var kinds = KINDS.filter(function (k) { return s.kinds[k[0]]; }).map(function (k) { return k[1].toLowerCase(); });
    var sub = !s.on ? 'Off: nobody gets booking alerts' : kinds.length ? 'From every booking site: ' + kinds.join(', ') : 'On, but every kind of alert is switched off';
    var emailWho = s.emails.length ? s.emails.map(esc).join(', ') : 'No email address yet';
    var waWho = s.whatsapp.length ? s.whatsapp.map(esc).join(', ') : 'No WhatsApp number yet';
    var phoneWho = !s.push ? 'Off' : x ? (x.phones ? O.fmt.plural(x.phones, 'phone') + ' signed up' + (x.myPhones ? ', including yours' : '') : 'No phone has turned on alerts yet') : '';
    var emailWhy = x && !x.email ? 'The server needs RESEND_API_KEY in Vercel.' : x && /resend\.dev/.test(x.emailFrom || '') ? 'Sent from Resend\'s test address, which only reaches the email you signed up to Resend with. Verify your domain in Resend to reach every address.' : '';
    var waWhy = x && !x.whatsappConfigured ? 'WhatsApp is not set up on the server yet (Inbox settings).' : x && !x.whatsappNumber ? 'Connect a WhatsApp business number in Inbox settings first.' : x ? 'Uses the approved message template "' + esc(x.whatsappTemplate) + '".' : '';
    var pushWhy = x && x.pushInvalid ? 'FIREBASE_SERVICE_ACCOUNT in Vercel is not a valid service account key.' : x && !x.push ? 'The server needs FIREBASE_SERVICE_ACCOUNT in Vercel.' : native ? '' : 'Open Orbique in the phone app and turn alerts on there.';
    var recent = x && x.recent && x.recent.length ? '<div class="xs muted" style="margin-top:6px">Last alert: ' + esc(O.fmt.ago(new Date(Date.parse(x.recent[0].at) + 8 * 36e5).toISOString().slice(0, 16))) + ' (' + esc(x.recent[0].kind === 'test' ? 'test' : x.recent[0].kind) + ')</div>' : '';
    return '<div class="card" data-alerts-card><div class="card-head"><div><h3>Booking alerts</h3><div class="sub">' + esc(sub) + '</div></div>' +
      (edit ? '<div class="row-flex" style="gap:6px"><button type="button" class="btn btn-ghost btn-sm" data-al="test"' + (st.testing ? ' disabled' : '') + '>' + O.icon('send') + (st.testing ? 'Sending…' : 'Send a test') + '</button><button type="button" class="btn btn-ghost btn-sm" data-al="edit">' + O.icon('edit') + 'Edit</button></div>' : '') + '</div>' +
      '<div class="card-body" style="padding-top:0">' +
      (st.err ? '<div class="note warn">' + esc(st.err) + '</div>' : '') +
      line('mail', 'Email', x ? x.email && s.emails.length > 0 : null, emailWho, emailWhy) +
      line('chat', 'WhatsApp', x ? x.whatsapp && s.whatsapp.length > 0 : null, waWho, waWhy) +
      line('phone', 'Phone app', x ? x.push && s.push && x.phones > 0 : null, esc(phoneWho), pushWhy) +
      (native && edit && x && x.push && s.push ? '<button type="button" class="btn btn-primary btn-sm" data-al="phone" style="margin-top:8px">' + O.icon('bell') + (x.myPhones ? 'Check alerts on this phone' : 'Turn on alerts on this phone') + '</button>' : '') +
      (st.last ? '<div class="note" style="margin-top:8px">' + st.last + '</div>' : '') + recent +
      '</div></div>';
  }

  /* ---------- edit ---------- */
  function editModal() {
    var s = settings();
    var body = O.html('<div class="stack">' +
      '<label class="row-flex"><input type="checkbox" id="al-on"' + (s.on ? ' checked' : '') + '> <span>Send booking alerts</span></label>' +
      '<div class="field"><label>Alert me about</label><div class="row-flex wrap" style="gap:14px">' + KINDS.map(function (k) { return '<label class="row-flex"><input type="checkbox" data-kind="' + k[0] + '"' + (s.kinds[k[0]] ? ' checked' : '') + '> <span>' + esc(k[1]) + '</span></label>'; }).join('') + '</div></div>' +
      '<div class="field"><label for="al-emails">Email addresses</label><textarea id="al-emails" class="input" rows="2" placeholder="name@example.com">' + esc(s.emails.join('\n')) + '</textarea><div class="small muted">One per line, up to 10.</div></div>' +
      '<div class="field"><label for="al-wa">WhatsApp numbers</label><textarea id="al-wa" class="input" rows="2" placeholder="+60 12 345 6789">' + esc(s.whatsapp.join('\n')) + '</textarea><div class="small muted">With the country code, one per line.</div></div>' +
      '<label class="row-flex"><input type="checkbox" id="al-push"' + (s.push ? ' checked' : '') + '> <span>Phone app notifications</span></label>' +
      '<div class="small muted">Alerts cover bookings from the booking sites and the guest website. Bookings you or your team enter in Orbique do not send an alert.</div></div>');
    var mod = U.modal({ title: 'Booking alerts', body: body, autofocus: false, actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: function () {
      var lines = function (id) { return O.$(id, body).value.split(/[\n,;]+/).map(function (v) { return v.trim(); }).filter(Boolean); };
      var emails = lines('#al-emails'), bad = emails.filter(function (v) { return !EMAIL.test(v); });
      if (bad.length) { U.toast('Check this email address: ' + bad[0], 'bad'); return false; }
      var wa = lines('#al-wa').map(function (v) { var n = v.replace(/\D/g, ''); return n ? '+' + n : ''; }).filter(Boolean), badWa = wa.filter(function (v) { return v.length < 9 || v.length > 16; });
      if (badWa.length) { U.toast('Check this WhatsApp number (with the country code): ' + badWa[0], 'bad'); return false; }
      var kinds = {}; O.$$('[data-kind]', body).forEach(function (c) { kinds[c.dataset.kind] = c.checked; });
      D.alertSettings = { on: O.$('#al-on', body).checked, kinds: kinds, emails: emails.map(function (v) { return v.toLowerCase(); }).slice(0, 10), whatsapp: wa.slice(0, 10), push: O.$('#al-push', body).checked };
      D.auditLog = D.auditLog || []; D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: 'automations', text: 'Booking alerts changed' });
      O.emit('data', { type: 'alert-settings' });
      U.toast('Booking alerts saved');
      repaint();
    } }] });
    return mod;
  }

  function sendTest() {
    st.testing = true; st.last = null; repaint();
    api('test').then(function (r) {
      var done = r.done || {}, names = { email: 'Email', whatsapp: 'WhatsApp', push: 'Phone app' };
      st.last = Object.keys(names).map(function (k) {
        var v = String(done[k] || 'not tried'), okk = v === 'sent';
        return '<div>' + (okk ? '✓ ' : '• ') + '<b>' + names[k] + ':</b> ' + esc(okk ? 'sent' : v.replace(/^(skipped|failed|error): /, '')) + '</div>';
      }).join('');
    }, function (e) { st.last = esc(errText(e)); }).then(function () { st.testing = false; load(true); repaint(); });
  }

  /* the card's buttons (the card is repainted in place, so listen once on the document) */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-al]'); if (!b || !b.closest('[data-alerts-card]')) return;
    if (b.dataset.al === 'edit') editModal();
    else if (b.dataset.al === 'test') sendTest();
    else if (b.dataset.al === 'phone' && O.native && O.native.push) O.native.push.enable(true).then(function (r) { U.toast(r && r.ok ? 'Alerts are on for this phone' : (r && r.message) || 'Alerts could not be turned on', r && r.ok ? 'ok' : 'bad'); load(true); });
  });

  O.alertsUI = { card: function () { load(false); return card(); }, refresh: function () { load(true); } };
})();
