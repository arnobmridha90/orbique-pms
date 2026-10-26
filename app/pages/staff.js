/* Staff Access (v4): People, Roles & access, Invites, Activity.
   Built on the permission model in core.js: O.PERMS (catalogue), O.can / O.sectionLevel (checks), D.rolePerms[role] =
   {sections: {sec: 'none'|'view'|'edit'}, actions: {'sec.action': bool}} (role defaults) and D.staffMeta[id].overrides =
   {'section:sec': level, 'sec.action': bool} (per person, on top of the role). This page only edits those values:
   in place, then O.emit('data'), with an entry in D.auditLog for every change.
   Only account owners change access (staff.roles is owner-only); people with staff.invite can add people.
   Server mode (O.auth enabled) also calls O.auth.invite / setMemberStatus / setMemberRole / resetPassword / previewAs. */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  var LV = { none: 0, view: 1, edit: 2 };
  var st = { tab: 'people', role: 'housekeeping', open: {}, who: '', cat: '', q: '', showGone: false, lastLv: {} };

  var ROLE_DESC = { owner: 'Everything, including financials, payouts and everyone\'s access', ops: 'Runs daily operations across all units', housekeeping: 'Cleans, restocks and reports issues', frontdesk: 'Guests, bookings and door codes', maintenance: 'Repairs and inspections', accountant: 'Invoices, expenses and reports' };
  var ROLE_AS = { ops: 'an ops manager', housekeeping: 'a housekeeper', frontdesk: 'front desk staff', maintenance: 'maintenance staff', accountant: 'an accountant' };
  /* why an owner-only item cannot be granted (short, shown next to the lock) */
  var OWNER_WHY = {
    financials: 'Profit and loss, cash flow and owner money stay with account owners.',
    planner: 'It shows your costs and profit, so it stays with account owners.',
    'expenses.approve': 'Approving claims pays money out, so it stays with account owners.',
    'owner.payouts': 'Payouts move owners\' money, so only account owners approve them.',
    'staff.roles': 'Only account owners decide who can see and do what.',
    'brand.data': 'Loading or resetting data changes the whole workspace.'
  };
  var CAT = { access: ['Team and access', 'lock'], door: ['Door codes', 'key'], tasks: ['Tasks', 'tasks'], documents: ['Invoices and receipts', 'invoices'], reviews: ['Reviews', 'star'], bookings: ['Bookings', 'bookings'], pricing: ['Pricing', 'pricing'], automations: ['Automations', 'automations'], money: ['Money', 'expenses'], inventory: ['Inventory', 'inventory'], properties: ['Properties', 'properties'] };

  /* ---------- collections this page owns (created at module load; core registers them for sync) ---------- */
  function scopeOf(hk) { return D.properties.filter(function (p) { return p.housekeeper === hk; }).map(function (p) { return p.id; }); }
  D.staffMeta = D.staffMeta || {
    s1: { status: 'active', since: '2024-02-01', scope: 'all', lastActive: '2026-10-06T10:15' },
    s2: { status: 'active', since: '2024-03-11', scope: 'all', lastActive: '2026-10-06T09:58' },
    s3: { status: 'active', since: '2024-05-20', scope: scopeOf('s3'), lastActive: '2026-10-06T10:12', overrides: { 'tasks.assign': true } },
    s4: { status: 'active', since: '2024-08-02', scope: 'all', lastActive: '2026-10-06T09:20' },
    s5: { status: 'active', since: '2025-01-13', scope: scopeOf('s5'), lastActive: '2026-10-06T08:47' },
    s6: { status: 'active', since: '2025-03-03', scope: 'all', lastActive: '2026-10-06T07:55' },
    s7: { status: 'active', since: '2025-06-16', scope: 'all', lastActive: '2026-10-05T17:40' }
  };
  D.staffInvites = D.staffInvites || [
    { id: 'INV-1', name: 'Daniel Chong', contact: '+60 12-980 3321', phone: '+60 12-980 3321', email: '', role: 'maintenance', note: 'External aircon contractor', scope: ['or4', 'kls', 'bbs', 'mkr', 'bgf'], sentAt: '2026-10-05T16:20', via: 'WhatsApp', by: 's1' }
  ];
  D.auditLog = D.auditLog || [];
  if (!D.auditLog.length) {
    D.auditLog.push(
      { at: '2026-10-06T08:41', by: 's1', cat: 'access', staffId: 's3', text: 'Let Kavya Nair assign tasks to others (personal change)' },
      { at: '2026-10-05T16:20', by: 's1', cat: 'access', text: 'Invited Daniel Chong as Maintenance for 5 Kuala Lumpur units' },
      { at: '2026-10-05T16:05', by: 's2', cat: 'pricing', text: 'Edited the weekend uplift for Bayfront Loft 3B' },
      { at: '2026-10-05T08:00', by: 's4', cat: 'access', staffId: 's4', text: 'Signed in from a new device (Android, Kuala Lumpur)' },
      { at: '2026-10-04T11:30', by: 's1', cat: 'bookings', text: 'Cancelled a duplicate direct booking for Kenji Mori' },
      { at: '2026-10-03T14:10', by: 's1', cat: 'money', text: 'Approved 3 expense claims from Siti Aminah and Arif Hakim' },
      { at: '2026-10-02T10:00', by: 's1', cat: 'access', role: 'frontdesk', text: 'Turned off "Change prices" for the Front desk role' }
    );
  }

  /* ---------- small helpers ---------- */
  function server() { return !!(O.auth && O.auth.enabled && O.auth.enabled()); }
  function authFn(name) { return server() && typeof O.auth[name] === 'function' ? O.auth[name] : null; }
  function canManage() { return O.can('staff.roles'); }
  function canInvite() { return O.can('staff.invite') && (!server() || O.isOwner()); }
  function roleLabel(r) { var x = O.ROLES.filter(function (y) { return y[0] === r; })[0]; return x ? x[1] : String(r || 'No role'); }
  function roleKnown(r) { return O.ROLES.some(function (y) { return y[0] === r; }); }
  function meta(id) { return (D.staffMeta && D.staffMeta[id]) || {}; }
  function metaEdit(id) { if (!D.staffMeta) D.staffMeta = {}; return D.staffMeta[id] || (D.staffMeta[id] = { status: 'active', since: D.TODAY, scope: 'all' }); }
  function ovs(id) { return meta(id).overrides || {}; }
  function gone(s) { return !!meta(s.id).removed || s.status === 'left'; }
  function suspended(s) { return meta(s.id).status === 'suspended' && !gone(s); }
  function first(name) { return String(name || '').split(' ')[0]; }
  function members(role) { return D.staff.filter(function (s) { return s.role === role && !gone(s); }); }
  function secInfo(sec) { return O.PERMS.filter(function (p) { return p[0] === sec; })[0]; }
  function lockIc() { return O.icon('lock'); }
  function why(key) { return OWNER_WHY[key] || 'Only account owners can do this.'; }
  function lvWord(lv) { return lv === 'edit' ? 'view and edit' : lv === 'view' ? 'view only' : 'off'; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function whoName(id) { if (id === 'system') return 'Orbique (automatic)'; var s = id && D.staffById(id); return s ? s.name : 'A team member'; }
  function propName(id) { return D.propById[id] ? D.propById[id].name : 'a removed property'; }
  function scopeText(sc) { if (!sc || sc === 'all' || !sc.length) return 'All properties'; return sc.length === 1 ? propName(sc[0]) : fmt.plural(sc.length, 'property', 'properties'); }
  function scopeTitle(sc) { return !sc || sc === 'all' || !sc.length ? 'All properties, including new ones' : sc.map(propName).join(', '); }
  function since(iso) { return iso ? d.fmtY(iso.slice(0, 10)) : ''; }
  function minsAgo(iso) { return (Date.parse(D.NOW + ':00Z') - Date.parse(iso.slice(0, 16) + ':00Z')) / 6e4; }
  function lastSeen(s) { if (s.id === O.state.viewer) return 'Online now'; var la = meta(s.id).lastActive; if (!la) return ''; var m = minsAgo(la); return m < 0 ? '' : m <= 15 ? 'Online now' : 'Active ' + fmt.ago(la); }
  function audit(text, extra) { if (!D.auditLog) D.auditLog = []; D.auditLog.unshift(Object.assign({ at: D.NOW, by: O.state.viewer, cat: 'access', text: text }, extra || {})); }
  function authErr(e) { return (e && (e.message || e.error)) || 'The server did not answer. Check the connection and try again.'; }
  /* server mode: mirror a change to the person's sign-in (members table). The app already applied it; say so if the server refused. */
  function callAuth(name, args) {
    var f = authFn(name); if (!f) return;
    function bad(e) { U.toast('Saved in the app, but their sign-in was not updated: ' + authErr(e), 'bad'); }
    try { Promise.resolve(f.apply(O.auth, args)).then(null, bad); } catch (e) { bad(e); }
  }
  function dropToast(re) { O.$$('.toast').forEach(function (t) { if (re.test(t.textContent)) t.remove(); }); }
  function appLink() { var base = O.APP_URL || (location.origin && location.origin !== 'null' && !/^file:/.test(location.href) ? location.origin : ''); return base && !/claude\.ai/.test(base) ? base.replace(/\/$/, '') : ''; }
  /* copy to the clipboard, with a fallback for browsers that block the async clipboard (local files, older phones) */
  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } ta.remove();
      U.toast(ok ? okMsg : 'Copy did not work here. Select the text and copy it yourself.', ok ? 'ok' : 'bad');
    }
    try { if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(function () { U.toast(okMsg); }, fallback); return; } } catch (e) { /* fall through */ }
    fallback();
  }

  /* ---------- reading access (role values, person values = role + overrides) ---------- */
  function roleSec(role, sec) { var r = D.rolePerms && D.rolePerms[role]; return (r && r.sections && r.sections[sec]) || 'none'; }
  function roleAct(role, key) { var r = D.rolePerms && D.rolePerms[role]; return !!(r && r.actions && r.actions[key]); }
  function rpEdit(role) {
    var r = D.rolePerms[role];
    if (!r) r = D.rolePerms[role] = clone((O.DEFAULT_ROLE_PERMS && O.DEFAULT_ROLE_PERMS[role]) || { sections: {}, actions: {} });
    if (!r.sections) r.sections = {}; if (!r.actions) r.actions = {};
    return r;
  }
  function defSec(role, sec) { var r = O.DEFAULT_ROLE_PERMS && O.DEFAULT_ROLE_PERMS[role]; return (r && r.sections && r.sections[sec]) || 'none'; }
  function defAct(role, key) { var r = O.DEFAULT_ROLE_PERMS && O.DEFAULT_ROLE_PERMS[role]; return !!(r && r.actions && r.actions[key]); }
  /* m = {mode: 'role'|'person', role, s, editable, open} */
  function mRole(m) { return m.mode === 'role' ? m.role : m.s.role; }
  function secLevel(m, sec) { if (m.mode === 'person') { var o = ovs(m.s.id); if (('section:' + sec) in o) return o['section:' + sec] || 'none'; } return roleSec(mRole(m), sec); }
  function secOv(m, sec) { return m.mode === 'person' && ('section:' + sec) in ovs(m.s.id) && (ovs(m.s.id)['section:' + sec] || 'none') !== roleSec(m.s.role, sec); }
  function actVal(m, key) { if (m.mode === 'person') { var o = ovs(m.s.id); if (key in o) return !!o[key]; } return roleAct(mRole(m), key); }
  function actOv(m, key) { return m.mode === 'person' && key in ovs(m.s.id) && !!ovs(m.s.id)[key] !== roleAct(m.s.role, key); }
  function actOk(lv, a) { return !a[4] && LV[lv] >= (a[3] === 'do' ? 2 : 1); }
  /* people of a role whose own setting differs from the role (shown on the role page) */
  function peopleDiff(role, key) {
    return members(role).filter(function (s) { var o = ovs(s.id); if (!(key in o)) return false; return key.indexOf('section:') === 0 ? (o[key] || 'none') !== roleSec(role, key.slice(8)) : !!o[key] !== roleAct(role, key); });
  }
  function ovCount(s) {
    var o = ovs(s.id), n = 0;
    Object.keys(o).forEach(function (k) { if (k.indexOf('section:') === 0 ? (o[k] || 'none') !== roleSec(s.role, k.slice(8)) : !!o[k] !== roleAct(s.role, k)) n++; });
    return n;
  }
  function roleDiff(role) {
    var n = 0;
    O.PERMS.forEach(function (P) { if (P[3]) return; if (roleSec(role, P[0]) !== defSec(role, P[0])) n++; P[2].forEach(function (a) { if (!a[4] && roleAct(role, P[0] + '.' + a[0]) !== defAct(role, P[0] + '.' + a[0])) n++; }); });
    return n;
  }
  function summary(m) {
    var secs = 0, all = 0, acts = 0;
    O.PERMS.forEach(function (P) { if (P[3]) return; all++; var lv = secLevel(m, P[0]); if (lv !== 'none') secs++; P[2].forEach(function (a) { if (actOk(lv, a) && actVal(m, P[0] + '.' + a[0])) acts++; }); });
    return { secs: secs, all: all, acts: acts };
  }

  /* ---------- changing access (shared by the role page and the person drawer) ---------- */
  function whoFor(m) { return m.mode === 'role' ? 'the ' + roleLabel(m.role) + ' role' : m.s.name; }
  function setSection(m, sec, lv) {
    var label = O.permInfo(sec).label, before = secLevel(m, sec);
    if (before === lv) return;
    var memo = (m.mode === 'role' ? m.role : m.s.id) + ':' + sec;
    if (before !== 'none') st.lastLv[memo] = before;
    var text = lv === 'none' ? 'Turned off ' + label + ' for ' + whoFor(m) : before === 'none' ? 'Turned on ' + label + ' (' + lvWord(lv) + ') for ' + whoFor(m) : 'Changed ' + label + ' to ' + lvWord(lv) + ' for ' + whoFor(m);
    if (m.mode === 'role') {
      rpEdit(m.role).sections[sec] = lv;
      audit(text, { role: m.role });
      var n = members(m.role).length;
      U.toast(roleLabel(m.role) + ': ' + label + ' is now ' + (lv === 'none' ? 'off' : lvWord(lv)) + (n ? ' for ' + fmt.plural(n, 'person', 'people') : ''));
    } else {
      var me = metaEdit(m.s.id), o = me.overrides || (me.overrides = {});
      if (lv === roleSec(m.s.role, sec)) { delete o['section:' + sec]; text = 'Set ' + label + ' for ' + m.s.name + ' back to the role (' + lvWord(lv) + ')'; }
      else { o['section:' + sec] = lv; text += ' (personal change)'; }
      if (!Object.keys(o).length) delete me.overrides;
      audit(text, { staffId: m.s.id });
      U.toast(first(m.s.name) + ': ' + label + ' is now ' + (lv === 'none' ? 'off' : lvWord(lv)));
    }
    O.emit('data', { type: 'perms' });
  }
  function turnOn(m, sec) {
    var memo = (m.mode === 'role' ? m.role : m.s.id) + ':' + sec, base = m.mode === 'person' ? roleSec(m.s.role, sec) : 'none', def = defSec(mRole(m), sec);
    setSection(m, sec, st.lastLv[memo] || (base !== 'none' ? base : def !== 'none' ? def : 'view'));
  }
  function toggleAct(m, key) {
    var info = O.permInfo(key); if (!info || info.ownerOnly) return;
    var nv = !actVal(m, key), label = '"' + info.label + '"', text = (nv ? 'Turned on ' : 'Turned off ') + label + ' for ' + whoFor(m);
    if (m.mode === 'role') { rpEdit(m.role).actions[key] = nv; audit(text, { role: m.role }); }
    else {
      var me = metaEdit(m.s.id), o = me.overrides || (me.overrides = {});
      if (nv === roleAct(m.s.role, key)) { delete o[key]; text = 'Set ' + label + ' for ' + m.s.name + ' back to the role (' + (nv ? 'on' : 'off') + ')'; }
      else { o[key] = nv; text += ' (personal change)'; }
      if (!Object.keys(o).length) delete me.overrides;
      audit(text, { staffId: m.s.id });
    }
    U.toast((m.mode === 'role' ? roleLabel(m.role) : first(m.s.name)) + ': ' + info.label.charAt(0).toLowerCase() + info.label.slice(1) + (nv ? ' is on' : ' is off'));
    O.emit('data', { type: 'perms' });
  }
  function undo(m, key) {
    var me = metaEdit(m.s.id), o = me.overrides || {}, sec = key.indexOf('section:') === 0, info = O.permInfo(sec ? key.slice(8) : key);
    delete o[key]; if (!Object.keys(o).length) delete me.overrides;
    audit('Set ' + (sec ? info.label : '"' + info.label + '"') + ' for ' + m.s.name + ' back to the ' + roleLabel(m.s.role) + ' role', { staffId: m.s.id });
    U.toast(first(m.s.name) + ' follows the role for ' + info.label.charAt(0).toLowerCase() + info.label.slice(1) + ' again');
    O.emit('data', { type: 'perms' });
  }
  function resetRole(role) {
    U.confirm('Put every section and action of the ' + roleLabel(role) + ' role back to how Orbique sets it up? Personal changes for each person stay.', 'Reset role', 'primary', 'Reset ' + roleLabel(role) + ' to default?').then(function (ok) {
      if (!ok) return;
      var r = rpEdit(role), def = clone(O.DEFAULT_ROLE_PERMS[role] || { sections: {}, actions: {} });
      Object.keys(r.sections).forEach(function (k) { delete r.sections[k]; }); Object.assign(r.sections, def.sections || {});
      Object.keys(r.actions).forEach(function (k) { delete r.actions[k]; }); Object.assign(r.actions, def.actions || {});
      audit('Reset the ' + roleLabel(role) + ' role to the default access', { role: role });
      U.toast(roleLabel(role) + ' is back to the default access');
      O.emit('data', { type: 'perms' });
    });
  }
  function resetPerson(s) {
    var n = ovCount(s);
    U.confirm('Remove ' + fmt.plural(n, 'personal change') + ' so ' + first(s.name) + ' has exactly the ' + roleLabel(s.role) + ' access?', 'Reset to role', 'primary', 'Reset ' + first(s.name) + ' to the role?').then(function (ok) {
      if (!ok) return;
      delete metaEdit(s.id).overrides;
      audit('Reset ' + s.name + '\'s access to the ' + roleLabel(s.role) + ' role', { staffId: s.id });
      U.toast(first(s.name) + ' now has the ' + roleLabel(s.role) + ' access');
      O.emit('data', { type: 'perms' });
    });
  }
  /* click handling for an access list; returns a selector to focus after the re-render, or true when handled */
  function accessClick(e, m, repaint) {
    var b = e.target.closest('[data-expand],[data-secsw],[data-lv],[data-ak],[data-undo]');
    if (!b || b.disabled) return false;
    var had = document.activeElement === b; /* keep keyboard focus on the same control after the re-render */
    function f(sel) { return had ? sel : true; }
    if (b.dataset.expand) { m.open[b.dataset.expand] = !m.open[b.dataset.expand]; repaint(had ? '[data-expand="' + b.dataset.expand + '"]' : null); return true; }
    if (!m.editable) return true;
    if (b.dataset.secsw) { var sec = b.dataset.secsw; if (secLevel(m, sec) === 'none') turnOn(m, sec); else setSection(m, sec, 'none'); return f('[data-secsw="' + sec + '"]'); }
    if (b.dataset.lv) { var p = b.dataset.lv.split(':'); setSection(m, p[0], p[1]); return f('[data-lv="' + b.dataset.lv + '"]'); }
    if (b.dataset.ak) { toggleAct(m, b.dataset.ak); return f('[data-ak="' + b.dataset.ak + '"]'); }
    if (b.dataset.undo) { var k = b.dataset.undo, s2 = k.indexOf('section:') === 0 ? '[data-secsw="' + k.slice(8) + '"]' : '[data-ak="' + k + '"]'; undo(m, k); return f(s2); }
    return true;
  }

  /* ---------- rendering an access list ---------- */
  function sw(on, attr, label, disabled, title) {
    return '<button type="button" class="switch' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '" aria-label="' + esc(label) + '"' + (disabled ? ' disabled' : '') + (title ? ' title="' + esc(title) + '"' : '') + ' ' + attr + '></button>';
  }
  function swRO(on, label) { return '<span class="switch stf-ro' + (on ? ' on' : '') + '" role="img" aria-label="' + esc(label + (on ? ': on' : ': off')) + '"></span>'; }
  function namesDiff(list, txt) { return list.length ? '<div class="stf-ov">' + esc(list.map(function (s) { return first(s.name); }).join(', ')) + ': ' + esc(txt) + ' (personal change)</div>' : ''; }
  function accessHTML(m) { return '<div class="stf-sxl">' + O.PERMS.map(function (P) { return secHTML(m, P); }).join('') + '</div>'; }
  function secHTML(m, P) {
    var sec = P[0], label = P[1], acts = P[2];
    if (P[3]) return '<div class="stf-sx stf-lk"><div class="stf-sxh"><div class="stf-sxt"><span class="stf-sxn">' + lockIc() + esc(label) + '</span><span class="stf-sxs">' + esc(why(sec)) + '</span></div><span class="stf-lock" title="' + esc(why(sec)) + '">Owner only</span></div></div>';
    var lv = secLevel(m, sec), on = lv !== 'none', open = !!m.open[sec], ov = secOv(m, sec);
    var grant = acts.filter(function (a) { return !a[4]; }), nOn = grant.filter(function (a) { return actOk(lv, a) && actVal(m, sec + '.' + a[0]); }).length;
    var nPersonal = m.mode === 'person' ? grant.filter(function (a) { return actOv(m, sec + '.' + a[0]); }).length : 0;
    var sub = !on ? 'Off · hidden from the menu' : (lv === 'edit' ? 'Can view and edit' : 'View only') + ' · ' + nOn + ' of ' + grant.length + ' actions on';
    if (nPersonal) sub += ' · ' + fmt.plural(nPersonal, 'personal change');
    var ctl;
    if (m.editable) {
      ctl = '<div class="stf-seg" role="group" aria-label="' + esc(label) + ' level">' + [['view', 'View'], ['edit', 'Edit']].map(function (o) {
        var sel = on && lv === o[0];
        return '<button type="button" class="' + (sel ? 'on' : '') + '" data-lv="' + sec + ':' + o[0] + '" aria-pressed="' + sel + '"' + (on ? '' : ' disabled title="Turn on ' + esc(label) + ' first"') + '>' + o[1] + '</button>';
      }).join('') + '</div>' + sw(on, 'data-secsw="' + sec + '"', label + ' section');
    } else ctl = '<span class="stf-lvp l-' + lv + '" aria-label="' + esc(label) + ': ' + esc(lvWord(lv)) + '">' + (on ? (lv === 'edit' ? 'Edit' : 'View') : 'Off') + '</span>';
    var note = '';
    if (ov) { var base = roleSec(m.s.role, sec); note = '<div class="stf-ov">Changed for ' + esc(first(m.s.name)) + '. The ' + esc(roleLabel(m.s.role)) + ' role has it ' + esc(lvWord(base)) + '.' + (m.editable ? '<button type="button" class="stf-lnk" data-undo="section:' + sec + '">Use the role</button>' : '') + '</div>'; }
    if (m.mode === 'role') { var dl = peopleDiff(m.role, 'section:' + sec); if (dl.length) note = namesDiff(dl, 'different level'); }
    var rows = acts.map(function (a) { return actHTML(m, sec, label, lv, a); }).join('');
    return '<div class="stf-sx' + (on ? '' : ' off') + (open ? ' open' : '') + (ov ? ' ovr' : '') + '" data-sec="' + sec + '">' +
      '<div class="stf-sxh"><button type="button" class="stf-sxx" data-expand="' + sec + '" aria-expanded="' + open + '" aria-controls="stf-a-' + (m.mode === 'role' ? 'r' : 'p') + '-' + sec + '">' + O.icon('right', 'stf-cv') + '<span><span class="stf-sxn">' + esc(label) + '</span><span class="stf-sxs">' + esc(sub) + '</span></span></button>' + ctl + '</div>' +
      (note ? '<div style="padding:0 16px 8px 46px">' + note + '</div>' : '') +
      '<div class="stf-sxa" id="stf-a-' + (m.mode === 'role' ? 'r' : 'p') + '-' + sec + '">' + rows + '</div></div>';
  }
  function actHTML(m, sec, secLabel, lv, a) {
    var key = sec + '.' + a[0], label = a[1], desc = a[2];
    if (a[4]) return '<div class="stf-ax stf-lk"><div class="stf-axt"><div class="stf-axn">' + lockIc() + esc(label) + '</div><div class="stf-axd">' + esc(why(key)) + '</div></div><span class="stf-lock">Owner only</span></div>';
    var val = actVal(m, key), ok = actOk(lv, a), eff = val && ok, ov = actOv(m, key);
    var reason = lv === 'none' ? 'Turn on ' + secLabel + ' first' : !ok ? (val ? 'On when ' + secLabel + ' is set to Edit' : 'Needs Edit access to ' + secLabel) : '';
    var tag = lv !== 'none' && !ok ? (val ? 'On with Edit' : 'Needs Edit') : '';
    var ctl = m.editable ? sw(eff, 'data-ak="' + key + '"', label, !ok, reason) : swRO(eff, label);
    var note = '';
    if (ov) note = '<div class="stf-ov">Changed for ' + esc(first(m.s.name)) + '. The role has it ' + (roleAct(m.s.role, key) ? 'on' : 'off') + '.' + (m.editable ? '<button type="button" class="stf-lnk" data-undo="' + key + '">Use the role</button>' : '') + '</div>';
    if (m.mode === 'role') { var dl = peopleDiff(m.role, key); if (dl.length) note = namesDiff(dl, val ? 'off' : 'on'); }
    return '<div class="stf-ax' + (ok ? '' : ' dis') + (ov ? ' ovr' : '') + '"' + (reason ? ' title="' + esc(reason) + '"' : '') + '><div class="stf-axt"><div class="stf-axn">' + esc(label) + '</div>' + (desc ? '<div class="stf-axd">' + esc(desc) + '</div>' : '') + note + '</div><span class="stf-tag">' + esc(tag) + '</span>' + ctl + '</div>';
  }

  /* ---------- People ---------- */
  function personRow(s) {
    var m = meta(s.id), you = s.id === O.state.viewer, n = s.role === 'owner' ? 0 : ovCount(s), seen = lastSeen(s), inv = invited(s);
    var status = gone(s) ? U.pill('Removed', 'neutral') : suspended(s) ? U.pill('Suspended', 'bad') : inv ? U.pill('Invited', 'warn') : U.pill('Active', 'ok');
    var sub = [s.roleLabel && s.roleLabel !== roleLabel(s.role) ? s.roleLabel : '', s.phone || s.email || ''].filter(Boolean).join(' · ');
    var mob = [s.roleLabel || roleLabel(s.role), s.role === 'owner' ? '' : scopeText(m.scope)].filter(Boolean).join(' · ');
    return '<button type="button" class="stf-p' + (gone(s) ? ' gone' : '') + '" data-person="' + esc(s.id) + '">' +
      '<span class="stf-who">' + U.avatar(s.name) + '<span><span class="stf-nm">' + esc(s.name) + (you ? ' <span class="faint xs">(you)</span>' : '') + '</span><span class="stf-sub">' + esc(sub || ' ') + '</span><span class="stf-sub stf-m">' + esc(mob) + '</span>' + (n ? '<span class="stf-pc stf-m">+ ' + fmt.plural(n, 'personal change') + '</span>' : '') + '</span></span>' +
      '<span class="stf-c">' + (s.role === 'owner' ? U.pill(roleLabel(s.role), 'brand') : esc(roleLabel(s.role))) + (n ? '<span class="stf-pc">+ ' + fmt.plural(n, 'personal change') + '</span>' : '') + '</span>' +
      '<span class="stf-c" title="' + esc(scopeTitle(m.scope)) + '">' + esc(s.role === 'owner' ? 'All properties' : scopeText(m.scope)) + '</span>' +
      '<span class="stf-c">' + (seen && !gone(s) && !suspended(s) ? '<span class="stf-dot' + (seen === 'Online now' ? ' on' : '') + '"></span>' + esc(seen) : '<span class="faint">–</span>') + '</span>' +
      '<span class="stf-c stf-st' + (gone(s) || suspended(s) || inv ? ' stf-flag' : '') + '">' + status + '</span><span class="stf-chev">' + O.icon('right') + '</span></button>';
  }
  function peopleHTML() {
    var cur = D.staff.filter(function (s) { return !gone(s); }), old = D.staff.filter(gone), inv = pendingInvites().length;
    var order = { owner: 0, ops: 1, frontdesk: 2, housekeeping: 3, maintenance: 4, accountant: 5 };
    cur.sort(function (a, b) { return (order[a.role] != null ? order[a.role] : 9) - (order[b.role] != null ? order[b.role] : 9) || String(a.name).localeCompare(String(b.name)); });
    var online = cur.filter(function (s) { return lastSeen(s) === 'Online now'; }).length;
    var subBits = [fmt.plural(cur.length, 'person', 'people')]; if (online) subBits.push(online + ' online now'); if (inv) subBits.push(fmt.plural(inv, 'invite') + ' waiting');
    var head = '<div class="stf-ph"><span>Person</span><span>Role</span><span>Properties</span><span>Last active</span><span>Status</span><span></span></div>';
    var alone = cur.length <= 1 && !inv;
    return '<div class="card"><div class="card-head"><div><h3>Team</h3><div class="sub">' + esc(subBits.join(' · ')) + '. Select a person to see their access.</div></div></div>' + head +
      '<div class="stf-pl">' + cur.map(personRow).join('') + '</div>' +
      (alone ? '<div class="stf-empty"><p>Add the people who clean, check guests in, fix things and keep the books. Each person signs in with their own account and sees only what their role allows.</p>' + (canInvite() ? '<button type="button" class="btn btn-ghost" data-do="add">' + O.icon('plus') + 'Add person</button>' : '') + '</div>' : '') +
      (old.length ? '<button type="button" class="stf-more" data-do="gone" aria-expanded="' + st.showGone + '">' + (st.showGone ? 'Hide' : 'Show') + ' ' + fmt.plural(old.length, 'former team member') + '</button>' + (st.showGone ? '<div class="stf-pl">' + old.map(personRow).join('') + '</div>' : '') : '') +
      '</div>';
  }

  /* ---------- Roles & access ---------- */
  var roleOpen = st.open;
  function rolesHTML() {
    var manage = canManage();
    var pick = '<div class="card stf-rp" role="tablist" aria-label="Roles">' + O.ROLES.map(function (r) {
      var n = members(r[0]).length, ch = r[0] === 'owner' ? 0 : roleDiff(r[0]), on = st.role === r[0];
      return '<button type="button" class="stf-rb' + (on ? ' on' : '') + '" data-role="' + r[0] + '" role="tab" aria-selected="' + on + '"><span class="rn">' + esc(r[1]) + (ch ? '<span class="chg" title="' + esc(fmt.plural(ch, 'setting') + ' different from the default') + '">Edited</span>' : '') + '</span><span class="rc">' + fmt.plural(n, 'person', 'people') + '</span></button>';
    }).join('') + '</div>';
    var role = st.role, ppl = members(role), names = ppl.map(function (s) { return s.name; });
    var main;
    if (role === 'owner') {
      main = '<div class="card"><div class="card-head stf-rh"><div><h3>Account owner</h3><div class="sub">' + esc(ROLE_DESC.owner) + (names.length ? ' · ' + esc(names.join(', ')) : '') + '</div></div></div>' +
        '<div class="stf-own"><div class="note brand">Account owners can open every section and do everything. This role cannot be limited, so a workspace always has someone who can fix access.</div>' +
        '<div class="small muted">Only account owners can:</div><ul>' + ['Open Financials (profit and loss, cash flow, owner money)', 'Open the Profit planner (unit costs and profit targets)', 'Approve expense claims and owner payouts', 'Change roles, permissions and personal changes', 'Load or reset the workspace data'].map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div></div>';
    } else {
      var m = { mode: 'role', role: role, editable: manage, open: roleOpen }, sum = summary(m), ch = roleDiff(role);
      var anyOpen = O.PERMS.some(function (P) { return roleOpen[P[0]]; });
      main = '<div class="card"><div class="card-head stf-rh"><div><h3>' + esc(roleLabel(role)) + '</h3><div class="sub">' + esc(ROLE_DESC[role] || '') + ' · ' + (names.length ? esc(names.join(', ')) : 'Nobody has this role yet') + '</div></div>' +
        '<div class="row-flex wrap"><button type="button" class="btn btn-ghost btn-sm" data-do="expand">' + (anyOpen ? 'Collapse all' : 'Show all actions') + '</button>' +
        (manage ? '<button type="button" class="btn btn-ghost btn-sm" data-do="reset-role"' + (ch ? '' : ' disabled title="This role already has the default access"') + '>' + O.icon('refresh') + 'Reset role to default</button>' : '') + '</div></div>' +
        '<div class="stf-sum"><span>Opens <b>' + sum.secs + ' of ' + sum.all + '</b> sections with <b>' + fmt.plural(sum.acts, 'action') + '</b> on' + (ch ? ' · ' + fmt.plural(ch, 'setting') + ' changed from the default' : '') + '</span><span>Off hides a section from the menu. View can look. Edit can change things.</span></div>' +
        accessHTML(m) + '</div>';
    }
    return '<div class="stf-rl">' + pick + main + '</div>';
  }

  /* ---------- Invites ---------- */
  function invited(s) { return pendingInvites().some(function (v) { return v.staffId === s.id; }); }
  function pendingInvites() {
    return (D.staffInvites || []).filter(function (v) {
      if (!v || v.status === 'withdrawn' || v.status === 'accepted') return false;
      if (!v.staffId) return true;
      var s = D.staffById(v.staffId); if (!s || gone(s)) return false;
      var la = meta(s.id).lastActive; return !(la && v.sentAt && la > v.sentAt);
    });
  }
  function invitesHTML() {
    var list = pendingInvites(), add = canInvite(), manage = canManage();
    var rows = list.map(function (v) {
      var contact = [v.phone, v.email].filter(Boolean).join(' · ') || v.contact || '';
      var sent = 'Added ' + (v.sentAt ? fmt.ago(v.sentAt) : '') + ' by ' + whoName(v.by);
      var state = v.status === 'failed' ? U.pill('Account not created', 'bad') : U.pill('Waiting to sign in', 'warn');
      var btns = '';
      if (add || manage) {
        btns = '<button type="button" class="btn btn-ghost btn-sm" data-share="' + esc(v.id) + '">' + O.icon('copy') + 'Share again</button>' +
          (v.status === 'failed' && authFn('invite') ? '<button type="button" class="btn btn-ghost btn-sm" data-retry="' + esc(v.id) + '">Try again</button>' : '') +
          (v.staffId && authFn('resetPassword') && v.status !== 'failed' ? '<button type="button" class="btn btn-ghost btn-sm" data-newpw="' + esc(v.staffId) + '">New password</button>' : '') +
          '<button type="button" class="btn btn-quiet btn-sm" data-withdraw="' + esc(v.id) + '">Withdraw</button>';
      }
      return '<div class="stf-iv"><div class="stf-who" style="display:flex;gap:11px;align-items:center;min-width:0">' + U.avatar(v.name) + '<span style="min-width:0"><span class="stf-nm">' + esc(v.name) + '</span><span class="stf-sub">' + esc(contact + (v.note ? ' · ' + v.note : '')) + '</span></span></div>' +
        '<div class="small"><b>' + esc(roleLabel(v.role)) + '</b><div class="muted xs">' + esc(scopeText(v.scope)) + '</div></div>' +
        '<div class="small">' + state + '<div class="muted xs" style="margin-top:3px">' + esc(sent) + (v.error ? ' · ' + esc(v.error) : '') + '</div></div>' +
        '<div class="stf-iva">' + btns + '</div></div>';
    }).join('');
    return '<div class="card"><div class="card-head"><div><h3>Invites waiting</h3><div class="sub">People you added who have not signed in yet. Share the message again if they lost it.</div></div></div>' +
      (list.length ? '<div>' + rows + '</div>' : '<div class="stf-empty"><p>No invites waiting. When you add a person they appear here until they sign in for the first time.</p>' + (add ? '<button type="button" class="btn btn-ghost" data-do="add">' + O.icon('plus') + 'Add person</button>' : '') + '</div>') + '</div>';
  }

  /* ---------- Activity (audit log) ---------- */
  function activity() {
    var out = [];
    (D.auditLog || []).forEach(function (e) { if (e && e.at && e.text) out.push(e); });
    (D.lockLog || []).forEach(function (l) {
      if (!l || !l.at) return;
      var w = String(l.what || 'Door code changed').replace(/^Master code changed/, 'Changed the master code').replace(/^Guest code changed for (.*)$/, 'Changed the guest code for $1').replace(/^Guest code activated for (.*)$/, 'Activated the guest code for $1');
      out.push({ at: l.at, by: l.by, cat: 'door', text: w + (l.propertyId ? ' at ' + propName(l.propertyId) : '') });
    });
    (D.sentLog || []).forEach(function (l) { if (!l || !l.at) return; var b = l.bookingId && D.booking(l.bookingId); out.push({ at: l.at, by: l.by, cat: 'documents', text: 'Sent ' + (l.kind || 'a document') + ' to ' + (b ? b.guest.name : 'a guest') + (l.via ? ' by ' + l.via : '') }); });
    D.tasks.forEach(function (t) { if (t.status === 'done' && t.doneAt && d.diff(t.doneAt.slice(0, 10), D.TODAY) <= 7) out.push({ at: t.doneAt, by: t.assigneeId || 'system', cat: 'tasks', text: 'Completed "' + t.title + '"' + (t.propertyId && D.propById[t.propertyId] ? ' at ' + D.propById[t.propertyId].short : '') }); });
    D.reviews.forEach(function (r) { if (r.reply && r.reply.date && d.diff(r.reply.date.slice(0, 10), D.TODAY) <= 7 && d.diff(r.reply.date.slice(0, 10), D.TODAY) >= 0) out.push({ at: r.reply.date.length > 10 ? r.reply.date : r.reply.date + 'T11:00', by: r.reply.by, cat: 'reviews', text: 'Replied to ' + r.guest + '\'s ' + r.stars + '-star ' + U.platName(r.platform) + ' review' }); });
    return out.filter(function (e) { return String(e.at).slice(0, 16) <= D.NOW; }).sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
  }
  function auditRows(list, max) {
    var html = '', lastDay = '';
    list.slice(0, max).forEach(function (e) {
      var day = e.at.slice(0, 10), t = e.at.length > 10 ? fmt.time(e.at) : '';
      if (day !== lastDay) { lastDay = day; var df = d.diff(day, D.TODAY); html += '<div class="stf-day">' + (df === 0 ? 'Today' : df === 1 ? 'Yesterday' : esc(d.dowName(day) + ' ' + d.fmtY(day))) + '</div>'; }
      var c = CAT[e.cat] || CAT.access, txt = String(e.text);
      html += '<div class="stf-au"><span class="ai">' + O.icon(c[1]) + '</span><div class="grow"><div class="at"><b>' + esc(whoName(e.by)) + '</b> ' + esc(txt.charAt(0).toLowerCase() + txt.slice(1)) + '</div><div class="as">' + esc(c[0]) + (t ? '<span class="tm-m"> · ' + t + '</span>' : '') + '</div></div><div class="tm">' + t + '</div></div>';
    });
    return html;
  }
  function activityHTML() {
    var all = activity(), q = st.q.toLowerCase();
    var list = all.filter(function (e) { return (!st.who || e.by === st.who || e.staffId === st.who) && (!st.cat || e.cat === st.cat) && (!q || (e.text + ' ' + whoName(e.by)).toLowerCase().indexOf(q) >= 0); });
    var cats = Object.keys(CAT).filter(function (k) { return all.some(function (e) { return e.cat === k; }); });
    var people = '<option value="">Everyone</option>' + D.staff.map(function (s) { return '<option value="' + esc(s.id) + '"' + (st.who === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '<option value="system"' + (st.who === 'system' ? ' selected' : '') + '>Automatic</option>';
    var empty = all.length ? 'Nothing matches these filters.' : 'No activity yet. Changes to access, door codes, documents sent and finished tasks appear here.';
    return '<div class="card"><div class="card-head"><div><h3>Activity</h3><div class="sub">Who changed access, door codes and prices, sent documents and finished tasks.</div></div>' +
      (all.length ? '<div class="stf-flt"><select class="select" data-af="who" aria-label="Person">' + people + '</select><select class="select" data-af="cat" aria-label="Type of activity"><option value="">All activity</option>' + cats.map(function (k) { return '<option value="' + k + '"' + (st.cat === k ? ' selected' : '') + '>' + esc(CAT[k][0]) + '</option>'; }).join('') + '</select>' +
      '<label class="search"><span class="sr-only">Search the activity</span>' + O.icon('search') + '<input type="search" data-af="q" placeholder="Search" value="' + esc(st.q) + '"></label>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-do="csv">' + O.icon('download') + 'CSV</button></div>' : '') + '</div>' +
      '<div class="card-body flush">' + (list.length ? auditRows(list, 80) : U.empty(empty)) + '</div>' +
      (list.length > 80 ? '<div class="card-foot">Showing the latest 80 of ' + list.length + '. Download the CSV for all of them.</div>' : '') + '</div>';
  }

  /* ---------- shared form bits ---------- */
  function scopeField(sc, name) {
    var all = !sc || sc === 'all';
    if (!D.properties.length) return '<div class="small muted" style="padding-top:4px">All properties, including the ones you add later.</div><input type="hidden" name="' + name + 'Mode" value="all">';
    return '<div class="stf-rad" role="radiogroup" aria-label="Properties"><label><input type="radio" name="' + name + 'Mode" value="all"' + (all ? ' checked' : '') + '> All, including new ones</label><label><input type="radio" name="' + name + 'Mode" value="some"' + (!all ? ' checked' : '') + '> Only some</label></div>' +
      '<div class="stf-scope" data-scope="' + name + '"' + (all ? ' hidden' : '') + '>' + D.properties.map(function (p) { return '<label><input type="checkbox" name="' + name + '" value="' + esc(p.id) + '"' + (!all && sc.indexOf(p.id) >= 0 ? ' checked' : '') + '>' + esc(p.name) + '</label>'; }).join('') + '</div>';
  }
  function readScope(el, name) {
    var mode = O.$('[name=' + name + 'Mode]:checked', el) || O.$('[name=' + name + 'Mode]', el);
    if (!mode || mode.value === 'all') return 'all';
    return O.$$('[name=' + name + ']:checked', el).map(function (i) { return i.value; });
  }
  function wireScope(el, name) { el.addEventListener('change', function (e) { if (e.target.name === name + 'Mode') { var box = O.$('[data-scope="' + name + '"]', el); if (box) box.hidden = e.target.value === 'all'; } }); }
  function roleOptions(sel) { return O.ROLES.filter(function (r) { return r[0] !== 'owner'; }).map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === sel ? ' selected' : '') + '>' + esc(r[1]) + '</option>'; }).join(''); }
  function validEmail(v) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); }

  /* the message the inviter sends on WhatsApp or by email (copied, never sent from here) */
  function inviteMessage(o) {
    var v = O.viewer(), ws = O.ws().name, link = appLink();
    var lines = ['Hi ' + first(o.name) + ', ' + (v ? v.name : 'the team') + ' has added you to the ' + ws + ' team' + (/orbique/i.test(ws) ? '' : ' on Orbique') + ' as ' + (ROLE_AS[o.role] || 'a team member') + '.'];
    if (o.tempPassword) lines.push('Sign in' + (link ? ' at ' + link : '') + ' with:', 'Email: ' + o.email, 'Temporary password: ' + o.tempPassword, 'You will choose your own password the first time you sign in.');
    else if (o.existing) lines.push('Sign in' + (link ? ' at ' + link : '') + ' with your usual Orbique email (' + o.email + ') and password, then pick ' + ws + '.');
    else lines.push((link ? 'Open ' + link + ' and sign in' : 'Sign in to the team app') + ' with ' + (o.email || o.phone || 'the details we gave you') + '.');
    return lines.join('\n');
  }
  function shareModal(o) {
    var msg = inviteMessage(o);
    var body = '<div class="stack">' + (o.intro ? '<p style="margin:0;line-height:1.5">' + esc(o.intro) + '</p>' : '') +
      (o.tempPassword ? '<div><div class="label" style="margin-bottom:6px">Temporary password for ' + esc(o.email) + '</div><div class="stf-pw"><code>' + esc(o.tempPassword) + '</code><button type="button" class="btn btn-ghost btn-sm" data-copy="pw">' + O.icon('copy') + 'Copy password</button></div></div>' : '') +
      '<div><label class="label" for="stf-msg" style="display:block;margin-bottom:6px">Message to send on WhatsApp or by email</label><textarea class="stf-msg" id="stf-msg" readonly>' + esc(msg) + '</textarea></div>' +
      '<div class="small muted">' + (o.tempPassword ? 'The password is shown only now. If it gets lost, use New password on the Invites tab.' : 'Copy the message and paste it into WhatsApp or an email to ' + esc(first(o.name)) + '.') + '</div></div>';
    U.modal({
      title: o.title || 'Share the invite', sub: o.sub, body: body, autofocus: false,
      actions: [{ label: 'Done', kind: 'ghost' }, { label: 'Copy message', kind: 'primary', onClick: function () { copyText(msg, 'Message copied. Paste it into WhatsApp or an email.'); if (o.onCopy) o.onCopy(); return false; } }],
      onOpen: function (el) {
        var ta = O.$('.stf-msg', el); if (ta) ta.style.height = Math.min(320, ta.scrollHeight + 4) + 'px';
        el.addEventListener('click', function (e) { if (e.target.closest('[data-copy=pw]')) copyText(o.tempPassword, 'Password copied'); });
      }
    });
  }
  function serverInvite(s, inv) {
    var f = authFn('invite'); if (!f) return;
    U.toast('Creating ' + first(s.name) + '\'s account…');
    Promise.resolve().then(function () { return f.call(O.auth, { staffId: s.id, name: s.name, email: s.email, phone: s.phone || '', role: s.role }); }).then(function (res) {
      res = res || {}; dropToast(/^Creating /);
      inv.status = res.existing ? 'accepted' : 'pending'; delete inv.error; inv.sentAt = D.NOW; O.emit('data', { type: 'staff' });
      shareModal({ title: res.existing ? first(s.name) + ' can sign in now' : 'Account ready for ' + first(s.name), name: s.name, role: s.role, email: res.email || s.email, tempPassword: res.tempPassword || null, existing: !!res.existing,
        intro: res.existing ? s.name + ' already has an Orbique account, so they sign in with their own password and now also see ' + O.ws().name + '.' : 'Send ' + first(s.name) + ' the sign-in details below. They change the password the first time they sign in.' });
    }, function (e) {
      dropToast(/^Creating /);
      inv.status = 'failed'; inv.error = authErr(e); O.emit('data', { type: 'staff' });
      U.toast('The account was not created: ' + authErr(e), 'bad');
    });
  }

  /* ---------- add person ---------- */
  function addPerson() {
    if (!canInvite()) return;
    var srv = !!authFn('invite');
    var body = '<div class="stack"><div class="form-grid">' +
      '<div class="field full"><label for="ap-name">Full name</label><input class="input" id="ap-name" name="name" autocomplete="off" placeholder="For example: Nurul Huda"></div>' +
      '<div class="field"><label for="ap-role">Role</label><select class="select" id="ap-role" name="role">' + roleOptions('housekeeping') + '</select><span class="hint" data-rdesc></span></div>' +
      '<div class="field"><label for="ap-title">Job title (optional)</label><input class="input" id="ap-title" name="title" placeholder="Shown next to their name"></div>' +
      '<div class="field"><label for="ap-phone">Mobile number</label><input class="input" id="ap-phone" name="phone" type="tel" placeholder="+60 12-345 6789"></div>' +
      '<div class="field"><label for="ap-email">Email' + (srv ? '' : ' (optional)') + '</label><input class="input" id="ap-email" name="email" type="email" placeholder="name@example.com"><span class="hint">' + (srv ? 'They sign in with this email' : 'A mobile number or an email is enough') + '</span></div>' +
      '<div class="field full"><span class="label">Properties they work on</span>' + scopeField('all', 'apScope') + '</div>' +
      '</div><div class="note">The role decides what they can open and do. You can fine-tune it for this person afterwards. Financials, approving claims and owner payouts stay with account owners whatever role you pick.</div></div>';
    U.modal({
      title: 'Add person', sub: 'They get their own sign-in for ' + O.ws().name, body: body, size: 'wide',
      onOpen: function (el) {
        wireScope(el, 'apScope');
        function paint() { O.$('[data-rdesc]', el).textContent = ROLE_DESC[O.$('[name=role]', el).value] || ''; }
        el.addEventListener('change', paint); paint();
      },
      actions: [{ label: 'Cancel', kind: 'ghost' }, {
        label: srv ? 'Add and create account' : 'Add person', kind: 'primary', onClick: function (close, el) {
          var g = function (n) { return O.$('[name=' + n + ']', el).value.trim(); };
          var name = g('name'), role = g('role'), phone = g('phone'), email = g('email'), title = g('title'), sc = readScope(el, 'apScope');
          if (!name) { U.toast('Add their name', 'bad'); O.$('[name=name]', el).focus(); return false; }
          if (srv && !email) { U.toast('Add their email. They sign in with it.', 'bad'); O.$('[name=email]', el).focus(); return false; }
          if (!phone && !email) { U.toast('Add a mobile number or an email', 'bad'); O.$('[name=phone]', el).focus(); return false; }
          if (email && !validEmail(email)) { U.toast('The email address does not look right', 'bad'); O.$('[name=email]', el).focus(); return false; }
          if (email && D.staff.some(function (s) { return !gone(s) && s.email && s.email.toLowerCase() === email.toLowerCase(); })) { U.toast('Someone on the team already uses that email', 'bad'); return false; }
          if (sc !== 'all' && !sc.length) { U.toast('Pick at least one property', 'bad'); return false; }
          var s = { id: O.uid('S'), name: name, role: role, roleLabel: title || roleLabel(role), phone: phone, email: email, initials: fmt.initials(name) };
          D.staff.push(s);
          var me = metaEdit(s.id); me.status = 'active'; me.since = D.TODAY; me.scope = sc; me.invitedAt = D.NOW;
          var inv = { id: O.uid('INV'), staffId: s.id, name: name, contact: phone || email, phone: phone, email: email, role: role, scope: sc, sentAt: D.NOW, via: srv ? 'Account' : 'Message', by: O.state.viewer, status: 'pending' };
          D.staffInvites.push(inv);
          audit('Added ' + name + ' as ' + roleLabel(role) + ' (' + scopeText(sc) + ')', { staffId: s.id });
          O.emit('data', { type: 'staff' });
          close();
          if (srv) serverInvite(s, inv);
          else shareModal({ title: name + ' is on the team', name: name, role: role, email: email, phone: phone, intro: 'Send ' + first(name) + ' a message so they know how to sign in. Their access follows the ' + roleLabel(role) + ' role.', onCopy: function () { inv.sharedAt = D.NOW; O.emit('data', { type: 'staff' }); } });
          return false;
        }
      }]
    });
  }

  /* ---------- person drawer ---------- */
  function setStatus(s, status) {
    var me = metaEdit(s.id); me.status = status; if (status === 'active') { delete me.removed; if (s.status === 'left') delete s.status; }
    audit((status === 'suspended' ? 'Suspended ' : 'Reactivated ') + s.name, { staffId: s.id });
    callAuth('setMemberStatus', [s.id, status]);
    U.toast(status === 'suspended' ? s.name + ' can no longer sign in or open anything' : s.name + ' can sign in again', status === 'suspended' ? 'bad' : 'ok');
    O.emit('data', { type: 'staff' });
  }
  function removePerson(s, done) {
    var open = D.tasks.filter(function (t) { return t.assigneeId === s.id && t.status !== 'done'; }).length;
    U.confirm('Remove ' + s.name + ' from the team? They lose access straight away' + (open ? ' and their ' + fmt.plural(open, 'open task') + ' become unassigned' : '') + '. Their history stays in the activity log.', 'Remove', 'danger', 'Remove ' + first(s.name) + '?').then(function (ok) {
      if (!ok) return;
      D.tasks.forEach(function (t) { if (t.assigneeId === s.id && t.status !== 'done') t.assigneeId = null; });
      var me = metaEdit(s.id); me.status = 'suspended'; me.removed = true; s.status = 'left';
      (D.staffInvites || []).forEach(function (v) { if (v.staffId === s.id) v.status = 'withdrawn'; });
      audit('Removed ' + s.name + ' from the team' + (open ? '; ' + fmt.plural(open, 'open task') + ' unassigned' : ''), { staffId: s.id });
      callAuth('setMemberStatus', [s.id, 'suspended']);
      U.toast(s.name + ' no longer has access', 'bad');
      O.emit('data', { type: 'staff' });
      if (done) done();
    });
  }
  function previewAs(s, close) {
    if (close) close();
    var f = authFn('previewAs');
    if (f) { try { f.call(O.auth, s.id); } catch (e) { U.toast(authErr(e), 'bad'); } return; }
    O.state.viewer = s.id; O.store.set('viewer', s.id); O.emit('viewer');
    var home = O.tabsFor()[0]; if (home && home !== O.state.page) O.go(home);
    U.toast('You now see the app as ' + s.name + '. Switch back with the name at the bottom of the menu.');
  }
  function newPassword(s) {
    var f = authFn('resetPassword'); if (!f) return;
    U.confirm('Make a new temporary password for ' + s.name + '? Their current password stops working.', 'New password', 'primary', 'New password for ' + first(s.name) + '?').then(function (ok) {
      if (!ok) return;
      Promise.resolve().then(function () { return f.call(O.auth, s.id); }).then(function (res) {
        res = res || {};
        audit('Made a new temporary password for ' + s.name, { staffId: s.id }); O.emit('data', { type: 'staff' });
        shareModal({ title: 'New password for ' + first(s.name), name: s.name, role: s.role, email: res.email || s.email, tempPassword: res.tempPassword, intro: 'Send ' + first(s.name) + ' the new sign-in details. They choose their own password after signing in.' });
      }, function (e) { U.toast(authErr(e), 'bad'); });
    });
  }

  function openPerson(id, tab) {
    var s = D.staffById(id); if (!s) { U.toast('That person is no longer on the team', 'bad'); return; }
    var ds = { tab: tab || 'profile', open: {} };
    var dr = U.drawer({ title: s.name, sub: '', body: '', foot: '<span></span>' });
    dr.el.classList.add('stf-dr');
    var bodyEl = O.$('.modal-body', dr.el), footEl = O.$('.modal-foot', dr.el);
    function model() { return { mode: 'person', s: s, editable: canManage() && s.role !== 'owner' && !gone(s), open: ds.open }; }

    function profileHTML(manage) {
      var m = meta(s.id), isOwner = s.role === 'owner', self = s.id === O.state.viewer, edit = manage && !gone(s);
      var out = '';
      if (gone(s)) out += '<div class="note warn" style="margin-bottom:12px">' + esc(first(s.name)) + ' was removed from the team and cannot sign in.</div>';
      else if (suspended(s)) out += '<div class="note warn" style="margin-bottom:12px">' + esc(first(s.name)) + ' is suspended: they cannot sign in or open anything until you reactivate them.</div>';
      if (edit) {
        out += '<div class="form-grid">' +
          '<div class="field"><label for="pd-role">Role</label>' + (isOwner ? '<input class="input" id="pd-role" value="Account owner" disabled><span class="hint">Account owners keep full access</span>' : '<select class="select" id="pd-role" name="role">' + roleOptions(s.role) + '</select><span class="hint">' + esc(ROLE_DESC[s.role] || '') + '</span>') + '</div>' +
          '<div class="field"><label for="pd-title">Job title</label><input class="input" id="pd-title" name="title" value="' + esc(s.roleLabel || '') + '"></div>' +
          '<div class="field"><label for="pd-phone">Mobile number</label><input class="input" id="pd-phone" name="phone" type="tel" value="' + esc(s.phone || '') + '"></div>' +
          '<div class="field"><label for="pd-email">Email</label><input class="input" id="pd-email" name="email" type="email" value="' + esc(s.email || '') + '"' + (server() && s.email ? ' disabled title="The sign-in email is changed by the person in their account"' : '') + '></div>' +
          (isOwner ? '' : '<div class="field full"><span class="label">Properties they work on</span>' + scopeField(m.scope, 'pdScope') + '</div>') +
          '</div><div class="stf-btns" style="margin-top:12px"><button type="button" class="btn btn-ghost btn-sm" data-pd="save">' + O.icon('check') + 'Save details</button></div>';
      } else {
        out += '<dl class="stf-kv"><dt>Role</dt><dd>' + esc(roleLabel(s.role)) + '</dd>' + (s.roleLabel && s.roleLabel !== roleLabel(s.role) ? '<dt>Job title</dt><dd>' + esc(s.roleLabel) + '</dd>' : '') +
          '<dt>Mobile</dt><dd>' + esc(s.phone || '–') + '</dd><dt>Email</dt><dd>' + esc(s.email || '–') + '</dd>' + (isOwner ? '' : '<dt>Properties</dt><dd>' + esc(scopeTitle(m.scope)) + '</dd>') + '</dl>';
      }
      var facts = [gone(s) ? 'Removed' : suspended(s) ? 'Suspended' : invited(s) ? 'Invited, not signed in yet' : 'Active', gone(s) || suspended(s) ? '' : lastSeen(s), m.since ? 'On the team since ' + since(m.since) : ''].filter(Boolean).join(' · ');
      out += '<div class="stf-card" style="margin-top:16px"><div class="stf-ch"><b>Account</b></div><div class="stf-cb"><div class="small">' + esc(facts) + '</div>';
      if (manage && !isOwner && !self) {
        var btns = [];
        if (gone(s)) btns.push('<button type="button" class="btn btn-ghost btn-sm" data-pd="restore">Bring back</button>');
        else {
          btns.push(suspended(s) ? '<button type="button" class="btn btn-ghost btn-sm" data-pd="reactivate">' + O.icon('play') + 'Reactivate</button>' : '<button type="button" class="btn btn-ghost btn-sm" data-pd="suspend">' + O.icon('pause') + 'Suspend</button>');
          if (authFn('invite') && !suspended(s)) btns.push('<button type="button" class="btn btn-ghost btn-sm" data-pd="signin" title="Create their sign-in, or add this workspace to the account they already have">' + O.icon('user') + 'Create sign-in</button>');
          if (authFn('resetPassword')) btns.push('<button type="button" class="btn btn-ghost btn-sm" data-pd="password">' + O.icon('key') + 'New password</button>');
          btns.push('<button type="button" class="btn btn-quiet btn-sm" data-pd="remove" style="color:var(--bad)">' + O.icon('trash') + 'Remove from team</button>');
        }
        out += '<div class="stf-acts">' + btns.join('') + '</div>';
      } else if (manage && self) out += '<div class="small muted" style="margin-top:6px">You cannot suspend or remove yourself.</div>';
      out += '</div></div>';
      return out;
    }
    function accessTab() {
      if (s.role === 'owner') return '<div class="note brand">Account owners can open every section and do everything, including Financials, approving claims and changing everyone\'s access.</div>';
      var m = model(), n = ovCount(s), sum = summary(m);
      var head = '<div class="stf-ch"><div><b>' + (n ? esc(roleLabel(s.role)) + ' role with ' + fmt.plural(n, 'personal change') : 'Follows the ' + esc(roleLabel(s.role)) + ' role') + '</b><div class="xs muted" style="margin-top:2px">Opens ' + sum.secs + ' of ' + sum.all + ' sections with ' + fmt.plural(sum.acts, 'action') + ' on' + (suspended(s) ? ' once reactivated' : '') + '</div></div>' +
        '<div class="stf-btns">' + (m.editable ? '<button type="button" class="btn btn-ghost btn-sm" data-pd="reset"' + (n ? '' : ' disabled title="No personal changes"') + '>' + O.icon('refresh') + 'Reset to role</button>' : '') + '<button type="button" class="btn btn-quiet btn-sm" data-pd="role">See the role</button></div></div>';
      var intro = m.editable ? '<div class="small muted" style="padding:10px 12px 0">Changes here apply only to ' + esc(first(s.name)) + ', on top of the role. Marked rows differ from the role.</div>' : '';
      return (suspended(s) ? '<div class="note warn" style="margin-bottom:12px">Suspended: none of this applies until ' + esc(first(s.name)) + ' is reactivated.</div>' : '') + '<div class="stf-card">' + head + intro + accessHTML(m) + '</div>';
    }
    function activityTab() {
      var list = activity().filter(function (e) { return e.by === s.id || e.staffId === s.id; });
      return list.length ? '<div class="stf-card">' + auditRows(list, 40) + '</div>' : U.empty('Nothing logged for ' + first(s.name) + ' yet.');
    }
    function paint(focusSel) {
      s = D.staffById(id) || s;
      var manage = canManage(), scroll = bodyEl.scrollTop;
      O.$('h3', dr.el).textContent = s.name;
      O.$('.sub', dr.el).textContent = roleLabel(s.role) + (s.roleLabel && s.roleLabel !== roleLabel(s.role) ? ' · ' + s.roleLabel : '');
      var tabs = [['profile', 'Profile'], ['access', 'Access'], ['activity', 'Activity']];
      bodyEl.innerHTML = '<div class="tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" aria-selected="' + (ds.tab === t[0]) + '" class="' + (ds.tab === t[0] ? 'on' : '') + '" data-dtab="' + t[0] + '">' + t[1] + (t[0] === 'access' && ovCount(s) && s.role !== 'owner' ? '<span class="tab-n" title="Personal changes">' + ovCount(s) + '</span>' : '') + '</button>'; }).join('') + '</div>' +
        (ds.tab === 'access' ? accessTab() : ds.tab === 'activity' ? activityTab() : profileHTML(manage));
      var canPreview = manage && s.id !== O.state.viewer && s.role !== 'owner' && !gone(s) && !suspended(s);
      footEl.innerHTML = (canPreview ? '<button type="button" class="btn btn-ghost" data-pd="preview">' + O.icon('eye') + 'Preview as ' + esc(first(s.name)) + '</button>' : '<span></span>') + '<button type="button" class="btn btn-primary" data-pd="close">Done</button>';
      bodyEl.scrollTop = scroll;
      if (ds.tab === 'profile' && manage) { wireScope(bodyEl, 'pdScope'); }
      if (focusSel && typeof focusSel === 'string') { var n = O.$(focusSel, bodyEl); if (n) try { n.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
    function saveDetails() {
      var g = function (n) { var x = O.$('[name=' + n + ']', bodyEl); return x ? x.value.trim() : null; };
      var title = g('title'), phone = g('phone'), email = g('email'), changes = [];
      if (email && !validEmail(email)) { U.toast('The email address does not look right', 'bad'); return; }
      if (title !== null && title !== (s.roleLabel || '')) { s.roleLabel = title || roleLabel(s.role); changes.push('job title'); }
      if (phone !== null && phone !== (s.phone || '')) { s.phone = phone; changes.push('mobile number'); }
      if (email !== null && !O.$('[name=email]', bodyEl).disabled && email !== (s.email || '')) { s.email = email; changes.push('email'); }
      if (s.role !== 'owner' && O.$('[name=pdScopeMode]', bodyEl)) {
        var sc = readScope(bodyEl, 'pdScope'), me = meta(s.id);
        if (sc !== 'all' && !sc.length) { U.toast('Pick at least one property', 'bad'); return; }
        if (JSON.stringify(sc) !== JSON.stringify(me.scope || 'all')) { metaEdit(s.id).scope = sc; changes.push('properties (' + scopeText(sc) + ')'); }
      }
      if (!changes.length) { U.toast('Nothing to save'); return; }
      audit('Updated ' + s.name + '\'s ' + changes.join(', '), { staffId: s.id });
      U.toast(first(s.name) + '\'s details are saved');
      O.emit('data', { type: 'staff' });
    }
    function changeRole(sel) {
      var to = sel.value, from = s.role; if (to === from) return;
      var n = ovCount(s);
      U.confirm('Change ' + s.name + ' from ' + roleLabel(from) + ' to ' + roleLabel(to) + '? Their access follows the ' + roleLabel(to) + ' role' + (n ? ', plus ' + fmt.plural(n, 'personal change') + ' you can reset on the Access tab' : '') + '. Their job title becomes "' + roleLabel(to) + '"; you can change it here.', 'Change role', 'primary', 'Change ' + first(s.name) + '\'s role?').then(function (ok) {
        if (!ok) { sel.value = from; return; }
        s.roleLabel = roleLabel(to);
        s.role = to;
        audit('Changed ' + s.name + '\'s role from ' + roleLabel(from) + ' to ' + roleLabel(to), { staffId: s.id, role: to });
        callAuth('setMemberRole', [s.id, to]);
        U.toast(s.name + ' is now ' + (ROLE_AS[to] || roleLabel(to)));
        O.emit('data', { type: 'staff' });
      });
    }
    dr.el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-dtab]');
      if (b) { ds.tab = b.dataset.dtab; bodyEl.scrollTop = 0; paint(); return; }
      if (ds.tab === 'access' && O.$('.stf-sxl', bodyEl) && bodyEl.contains(e.target)) {
        var r = accessClick(e, model(), function (sel) { paint(sel); });
        if (r) { if (typeof r === 'string') paint(r); return; }
      }
      b = e.target.closest('[data-pd]'); if (!b || b.disabled) return;
      var a = b.dataset.pd;
      if (a === 'close') { dr.close(); return; }
      if (a === 'save') { saveDetails(); return; }
      if (a === 'reset') { resetPerson(s); return; }
      if (a === 'role') { st.tab = 'roles'; st.role = s.role; dr.close(); if (O.state.page === 'staff') O.render(false); else O.go('staff'); return; }
      if (a === 'preview') { previewAs(s, dr.close); return; }
      if (a === 'suspend') { U.confirm('Suspend ' + s.name + '? They cannot sign in or open anything until you reactivate them. Their tasks stay assigned.', 'Suspend', 'danger', 'Suspend ' + first(s.name) + '?').then(function (ok) { if (ok) setStatus(s, 'suspended'); }); return; }
      if (a === 'reactivate' || a === 'restore') { setStatus(s, 'active'); return; }
      if (a === 'password') { newPassword(s); return; }
      if (a === 'signin') {
        if (!s.email) { U.toast('Add ' + first(s.name) + '\'s email and save first. They sign in with it.', 'bad'); var em = O.$('[name=email]', bodyEl); if (em) em.focus(); return; }
        var inv = (D.staffInvites || []).filter(function (v) { return v.staffId === s.id && v.status !== 'withdrawn'; })[0];
        if (!inv) { inv = { id: O.uid('INV'), staffId: s.id, name: s.name, contact: s.email, phone: s.phone || '', email: s.email, role: s.role, scope: meta(s.id).scope || 'all', sentAt: D.NOW, via: 'Account', by: O.state.viewer, status: 'pending' }; D.staffInvites.push(inv); }
        audit('Created a sign-in for ' + s.name, { staffId: s.id }); O.emit('data', { type: 'staff' });
        serverInvite(s, inv); return;
      }
      if (a === 'remove') { removePerson(s); return; }
    });
    dr.el.addEventListener('change', function (e) { if (e.target.name === 'role' && e.target.id === 'pd-role') changeRole(e.target); });
    /* keep the drawer current when access or the team changes (here, on the page behind or from another device) */
    var off = O.on('data', function () {
      if (!document.body.contains(dr.el)) { off(); return; }
      var a = document.activeElement; if (a && bodyEl.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
      paint();
    });
    paint();
    return dr;
  }

  /* ---------- page ---------- */
  O.page('staff', {
    desc: 'Who is on the team, what each role can open and do, and a log of changes',
    render: function (root, ctx) {
      var manage = canManage(), add = canInvite(), p = ctx.params || {};
      if (ctx.fresh) { if (p.tab) st.tab = p.tab; if (p.role && roleKnown(p.role)) st.role = p.role; }
      if (!roleKnown(st.role)) st.role = 'housekeeping';
      if (['people', 'roles', 'invites', 'activity'].indexOf(st.tab) < 0) st.tab = 'people';
      ctx.setActions(add ? '<button type="button" class="btn btn-primary" data-do="add">' + O.icon('plus') + 'Add person</button>' : '');
      ctx.actionsEl.onclick = function (e) { if (e.target.closest('[data-do=add]')) addPerson(); };
      var nInv = pendingInvites().length;
      var tabs = [['people', 'People'], ['roles', '<span class="stf-long">Roles &amp; access</span><span class="stf-short">Roles</span>'], ['invites', 'Invites'], ['activity', 'Activity']];
      var ro = manage ? '' : '<div class="note stf-ro">You can see the team and what each role can do. Only account owners can change access' + (add ? '; you can add people.' : '.') + '</div>';
      root.innerHTML = '<div class="pg-staff">' + ro +
        '<div class="tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" aria-selected="' + (st.tab === t[0]) + '" class="' + (st.tab === t[0] ? 'on' : '') + '" data-tab="' + t[0] + '">' + t[1] + (t[0] === 'invites' && nInv ? '<span class="tab-n">' + nInv + '</span>' : '') + '</button>'; }).join('') + '</div>' +
        (st.tab === 'roles' ? rolesHTML() : st.tab === 'invites' ? invitesHTML() : st.tab === 'activity' ? activityHTML() : peopleHTML()) + '</div>';

      var pg = O.$('.pg-staff', root);
      var had = false;
      function refocus(sel) { if (!sel || !had) return; var n = O.$('.pg-staff ' + sel); if (n) try { n.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      pg.addEventListener('click', function (e) {
        var b, hit = e.target.closest('button, select'); had = !!hit && document.activeElement === hit;
        if ((b = e.target.closest('[data-tab]'))) { st.tab = b.dataset.tab; ctx.rerender(); refocus('[data-tab="' + st.tab + '"]'); return; }
        if (st.tab === 'roles' && st.role !== 'owner' && e.target.closest('.stf-sxl')) {
          var r = accessClick(e, { mode: 'role', role: st.role, editable: manage, open: roleOpen }, function (sel) { ctx.rerender(); refocus(sel); });
          if (typeof r === 'string') refocus(r);
          if (r) return;
        }
        if ((b = e.target.closest('[data-role]'))) { st.role = b.dataset.role; ctx.rerender(); refocus('[data-role="' + st.role + '"]'); return; }
        if ((b = e.target.closest('[data-person]'))) { openPerson(b.dataset.person); return; }
        if ((b = e.target.closest('[data-share]'))) {
          var v = (D.staffInvites || []).filter(function (x) { return x.id === b.dataset.share; })[0]; if (!v) return;
          shareModal({ title: 'Invite for ' + v.name, name: v.name, role: v.role, email: v.email, phone: v.phone || v.contact, intro: 'Copy the message and send it to ' + first(v.name) + ' again.', onCopy: function () { v.sharedAt = D.NOW; O.emit('data', { type: 'staff' }); } });
          return;
        }
        if ((b = e.target.closest('[data-retry]'))) { var v2 = (D.staffInvites || []).filter(function (x) { return x.id === b.dataset.retry; })[0], s2 = v2 && D.staffById(v2.staffId); if (s2) serverInvite(s2, v2); return; }
        if ((b = e.target.closest('[data-newpw]'))) { var s3 = D.staffById(b.dataset.newpw); if (s3) newPassword(s3); return; }
        if ((b = e.target.closest('[data-withdraw]'))) {
          var v3 = (D.staffInvites || []).filter(function (x) { return x.id === b.dataset.withdraw; })[0]; if (!v3) return;
          var s4 = v3.staffId && D.staffById(v3.staffId);
          U.confirm('Withdraw the invite for ' + v3.name + '?' + (s4 ? ' They are taken off the team and cannot sign in.' : ''), 'Withdraw', 'danger', 'Withdraw this invite?').then(function (ok) {
            if (!ok) return;
            var i = D.staffInvites.indexOf(v3); if (i >= 0) D.staffInvites.splice(i, 1);
            if (s4) { var me = metaEdit(s4.id); me.status = 'suspended'; me.removed = true; s4.status = 'left'; callAuth('setMemberStatus', [s4.id, 'suspended']); }
            audit('Withdrew the invite for ' + v3.name, v3.staffId ? { staffId: v3.staffId } : null);
            U.toast('Invite for ' + v3.name + ' withdrawn');
            O.emit('data', { type: 'staff' });
          });
          return;
        }
        if (!(b = e.target.closest('[data-do]'))) return;
        var a = b.dataset.do;
        if (a === 'add') addPerson();
        else if (a === 'gone') { st.showGone = !st.showGone; ctx.rerender(); refocus('[data-do=gone]'); }
        else if (a === 'expand') { var anyOpen = O.PERMS.some(function (P) { return roleOpen[P[0]]; }); O.PERMS.forEach(function (P) { if (anyOpen) delete roleOpen[P[0]]; else if (!P[3]) roleOpen[P[0]] = true; }); ctx.rerender(); refocus('[data-do=expand]'); }
        else if (a === 'reset-role') resetRole(st.role);
        else if (a === 'csv') O.downloadCSV('activity-' + D.TODAY + '.csv', [['Date', 'Time', 'Who', 'Type', 'What']].concat(activity().map(function (x) { return [x.at.slice(0, 10), x.at.slice(11, 16), whoName(x.by), (CAT[x.cat] || CAT.access)[0], x.text]; })));
      });
      pg.addEventListener('change', function (e) {
        var el = e.target;
        if (el.matches('[data-af]') && el.dataset.af !== 'q') { st[el.dataset.af] = el.value; had = true; ctx.rerender(); refocus('[data-af="' + el.dataset.af + '"]'); }
      });
      var q = O.$('[data-af=q]', pg), qt;
      if (q) q.addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(function () { st.q = q.value; ctx.rerender(); var n = O.$('.pg-staff [data-af=q]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); });
      if (ctx.fresh && p.staffId && !O.$('.stf-dr')) openPerson(p.staffId, p.personTab);
    }
  });
})();
