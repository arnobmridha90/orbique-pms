/* Staff Access — team list, roles & permissions matrix, audit log, invite staff.
   Also defines O.can(permission, level, staffId), the shared permission check other pages may use.
   Financials and approving expense claims stay with account owners and cannot be granted. */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  var st = { tab: 'team', who: '', cat: '', q: '', mxRole: 'ops' };

  var ROLES = [['owner', 'Account owner'], ['ops', 'Ops manager'], ['housekeeping', 'Housekeeping'], ['frontdesk', 'Front desk'], ['maintenance', 'Maintenance'], ['accountant', 'Accountant']];
  var ROLE_AS = { ops: 'an ops manager', housekeeping: 'a housekeeper', frontdesk: 'front desk staff', maintenance: 'maintenance staff', accountant: 'an accountant' };
  var ROLE_DESC = { owner: 'Everything, including financials and billing', ops: 'Runs daily operations across all units', housekeeping: 'Cleans, restocks and reports issues', frontdesk: 'Guests, bookings and door codes', maintenance: 'Repairs and inspections', accountant: 'Invoices, expenses and reports' };
  var LEVELS = [['none', 'None'], ['view', 'View'], ['edit', 'Edit']];
  var LV = { none: 0, view: 1, edit: 2 };
  var SECTIONS = [
    ['dashboard', 'Dashboard'], ['bookings', 'Bookings'], ['calendar', 'Calendar'], ['reviews', 'Reviews'], ['inbox', 'Guest inbox'], ['tasks', 'Tasks & cleaning'],
    ['pricing', 'Pricing'], ['automations', 'Automations'], ['invoices', 'Invoices & receipts'], ['expenses', 'Expenses'], ['reports', 'Reports'],
    ['website', 'Website builder'], ['guestapp', 'Guest app'], ['owner', 'Owner portal'], ['staff', 'Staff access'], ['brand', 'Brand & setup']
  ];
  var ACTIONS = [
    ['assignTasks', 'Assign tasks to staff', 'Create tasks for others and reassign them'],
    ['recordExpenses', 'Record their own expenses', 'Everyone can log what they spend and claim it back', 'everyone'],
    ['approveClaims', 'Approve expense claims', 'Pay back staff who paid personally', 'owner'],
    ['changeDoorCodes', 'Change door codes', 'Guest codes and master codes on smart locks'],
    ['sendInvoices', 'Send invoices and receipts', 'To guests by WhatsApp or email'],
    ['messageGuests', 'Message guests', 'Reply in the guest inbox'],
    ['replyReviews', 'Reply to reviews', 'Post public replies on every platform'],
    ['editPricing', 'Change prices', 'Apply suggested prices and edit pricing rules'],
    ['seeGuestContacts', 'See guest phone and email', 'When off, contact details are masked']
  ];
  var ACTION_KEYS = ACTIONS.map(function (a) { return a[0]; });
  var CAT = { access: ['Access', 'lock'], door: ['Door codes', 'key'], tasks: ['Tasks', 'tasks'], documents: ['Invoices & receipts', 'invoices'], reviews: ['Reviews', 'star'], bookings: ['Bookings', 'bookings'], pricing: ['Pricing', 'pricing'], automations: ['Automations', 'automations'], money: ['Money', 'expenses'] };

  /* ---------- shared permission data (defensive: other pages may have created it) ---------- */
  function sec(o) { var r = {}; SECTIONS.forEach(function (s) { r[s[0]] = o[s[0]] || 'none'; }); return r; }
  D.rolePerms = D.rolePerms || {
    ops: Object.assign(sec({ dashboard: 'edit', bookings: 'edit', calendar: 'edit', reviews: 'edit', inbox: 'edit', tasks: 'edit', pricing: 'edit', automations: 'edit', invoices: 'edit', expenses: 'edit', reports: 'view', website: 'edit', guestapp: 'edit', owner: 'view', staff: 'view', brand: 'view' }),
      { assignTasks: true, changeDoorCodes: true, sendInvoices: true, messageGuests: true, replyReviews: true, editPricing: true, seeGuestContacts: true }),
    housekeeping: Object.assign(sec({ dashboard: 'view', bookings: 'view', calendar: 'view', inbox: 'edit', tasks: 'edit', expenses: 'edit', guestapp: 'view' }),
      { assignTasks: false, changeDoorCodes: false, sendInvoices: false, messageGuests: true, replyReviews: false, editPricing: false, seeGuestContacts: false }),
    frontdesk: Object.assign(sec({ dashboard: 'view', bookings: 'edit', calendar: 'edit', reviews: 'edit', inbox: 'edit', tasks: 'edit', pricing: 'view', automations: 'view', invoices: 'edit', expenses: 'edit', guestapp: 'edit' }),
      { assignTasks: true, changeDoorCodes: true, sendInvoices: true, messageGuests: true, replyReviews: true, editPricing: false, seeGuestContacts: true }),
    maintenance: Object.assign(sec({ dashboard: 'view', calendar: 'view', inbox: 'view', tasks: 'edit', expenses: 'edit' }),
      { assignTasks: false, changeDoorCodes: false, sendInvoices: false, messageGuests: false, replyReviews: false, editPricing: false, seeGuestContacts: false }),
    accountant: Object.assign(sec({ dashboard: 'view', bookings: 'view', invoices: 'edit', expenses: 'edit', reports: 'view', owner: 'view' }),
      { assignTasks: false, changeDoorCodes: false, sendInvoices: true, messageGuests: false, replyReviews: false, editPricing: false, seeGuestContacts: true })
  };
  function scopeOf(hk) { return D.properties.filter(function (p) { return p.housekeeper === hk; }).map(function (p) { return p.id; }); }
  D.staffMeta = D.staffMeta || {
    s1: { status: 'active', lastActive: '2026-10-06T10:15', scope: 'all', since: '2024-02-01' },
    s2: { status: 'active', lastActive: '2026-10-06T09:58', scope: 'all', since: '2024-03-11' },
    s3: { status: 'active', lastActive: '2026-10-06T10:12', scope: scopeOf('s3'), since: '2024-05-20', overrides: { assignTasks: true } },
    s4: { status: 'active', lastActive: '2026-10-06T09:20', scope: 'all', since: '2024-08-02' },
    s5: { status: 'active', lastActive: '2026-10-06T08:47', scope: scopeOf('s5'), since: '2025-01-13' },
    s6: { status: 'active', lastActive: '2026-10-06T07:55', scope: 'all', since: '2025-03-03' },
    s7: { status: 'active', lastActive: '2026-10-05T17:40', scope: 'all', since: '2025-06-16' }
  };
  D.staffInvites = D.staffInvites || [
    { id: 'INV-1', name: 'Daniel Chong', contact: '+60 12-980 3321', role: 'maintenance', note: 'External aircon contractor', scope: ['or4', 'kls', 'bbs', 'mkr', 'bgf'], sentAt: '2026-10-05T16:20', via: 'WhatsApp', by: 's2' }
  ];
  D.auditLog = D.auditLog || [];
  var SEED = [
    { at: '2026-10-06T08:41', by: 's1', cat: 'access', text: 'Let Kavya Nair assign tasks to other housekeepers (extra permission)' },
    { at: D.TODAY + 'T07:30', by: 'system', cat: 'automations', text: (function () { var n = D.bookings.filter(function (b) { return b.status !== 'cancelled' && b.checkOut === D.TODAY; }).length; return 'Created ' + fmt.plural(n, 'turnover task') + ' for today\'s check-outs'; })() },
    { at: '2026-10-05T16:20', by: 's2', cat: 'access', text: 'Invited Daniel Chong as Maintenance (external contractor) for 5 KL units' },
    { at: '2026-10-05T16:05', by: 's2', cat: 'pricing', text: 'Edited the weekend uplift for Bayfront Loft 3B' },
    { at: '2026-10-05T08:00', by: 's4', cat: 'access', text: 'Signed in from a new device (Android, Kuala Lumpur)' },
    { at: '2026-10-04T11:30', by: 's1', cat: 'bookings', text: 'Cancelled a duplicate direct booking for Kenji Mori' },
    { at: '2026-10-03T14:10', by: 's1', cat: 'money', text: 'Approved 3 expense claims from Siti Aminah and Arif Hakim' },
    { at: '2026-10-02T10:00', by: 's1', cat: 'access', text: 'Turned off "Change prices" for Front desk' }
  ];

  /* core logs (D.sentLog) do not record who sent a document: stamp the person viewing when the entry first appears */
  function stampLogs() { (D.sentLog || []).forEach(function (l) { if (!l.by) l.by = O.state.viewer; }); (D.lockLog || []).forEach(function (l) { if (!l.by) l.by = O.state.viewer; }); }
  O.on('data', stampLogs);

  function staffById(id) { return D.staffById(id); }
  function meta(id) { return D.staffMeta[id] || (D.staffMeta[id] = { status: 'active', lastActive: D.NOW, scope: 'all' }); }
  function roleLabel(r) { return (ROLES.filter(function (x) { return x[0] === r; })[0] || [r, r])[1]; }

  /* v4: O.can / O.permLabel live in core.js (catalogue O.PERMS). This page is being rebuilt for the detailed toggles. */
  var LV = { none: 0, view: 1, edit: 2 };

  O.css('staff', `
.pg-staff .stf-m{display:flex; align-items:center; gap:10px; min-width:0;}
.pg-staff .stf-m .stf-nm{font-weight:800;}
.pg-staff .stf-m .stf-em{font-size:11.5px; color:var(--muted); overflow-wrap:anywhere;}
.pg-staff .team td.c-mob{display:none;}
.pg-staff .team tr.gone td{color:var(--muted);}
.pg-staff .team tr.gone .avatar{opacity:0.5;}
@media (max-width:640px){
  .pg-staff .team thead{display:none;}
  .pg-staff .team, .pg-staff .team tbody{display:block;}
  .pg-staff .team tr{display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:6px 10px; padding:12px 14px; border-bottom:1px solid var(--border);}
  .pg-staff .team tr:last-child{border-bottom:none;}
  .pg-staff .team td{display:none; padding:0; border:none;}
  .pg-staff .team td.c-mem{display:block; grid-column:1;}
  .pg-staff .team td.c-act{display:block; grid-column:2; grid-row:1;}
  .pg-staff .team td.c-mob{display:flex; grid-column:1 / -1; flex-wrap:wrap; gap:4px 10px; align-items:center; font-size:12px; color:var(--text-2); padding-left:40px;}
  .pg-staff .team td.c-act .btn{white-space:nowrap;}
}
.pg-staff .online{display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--ok); margin-right:5px;}
.pg-staff .away{display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--border-strong); margin-right:5px;}
.pg-staff .mx th, .pg-staff .mx td{text-align:center; padding:7px 8px;}
.pg-staff .mx th:first-child, .pg-staff .mx td:first-child{text-align:left; position:sticky; left:0; background:var(--surface); z-index:1; min-width:210px;}
.pg-staff .mx thead th:first-child{background:var(--surface-2);}
.pg-staff .mx th .rc{font-size:10.5px; font-weight:600; color:var(--faint); display:block; margin-top:1px;}
.pg-staff .mx th{white-space:normal; min-width:104px; vertical-align:bottom;}
.pg-staff .mx tr.grp td{background:var(--surface-2); font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:var(--muted); text-align:left; padding:8px 12px;}
.pg-staff .mx td .pl{font-weight:700; font-size:12.5px;}
.pg-staff .mx td .pd{font-size:11px; color:var(--muted); margin-top:1px;}
.pg-staff .mx .lv{border:1px solid var(--border); border-radius:7px; font-size:12px; font-weight:700; padding:4px 22px 4px 8px; height:28px; background-color:var(--surface); width:auto; min-width:76px;}
.pg-staff .mx .lv.l-edit{background-color:var(--brand-soft); color:var(--brand-text); border-color:transparent;}
.pg-staff .mx .lv.l-view{background-color:var(--info-soft); color:var(--info); border-color:transparent;}
.pg-staff .mx .lv.l-none{color:var(--faint);}
.pg-staff .mx .lvp{display:inline-block; font-size:11.5px; font-weight:700; padding:2px 9px; border-radius:20px;}
.pg-staff .mx .lvp.l-edit{background:var(--brand-soft); color:var(--brand-text);}
.pg-staff .mx .lvp.l-view{background:var(--info-soft); color:var(--info);}
.pg-staff .mx .lvp.l-none{color:var(--faint);}
.pg-staff .mx .lockc{font-size:11.5px; font-weight:700; color:var(--muted); display:inline-flex; align-items:center; gap:4px;}
.pg-staff .mx .lockc svg, .pg-staff .lk-ic svg{width:13px; height:13px;}
.pg-staff .mx tr.locked-row td{background:repeating-linear-gradient(135deg,var(--surface) 0 8px,var(--surface-2) 8px 16px);}
.pg-staff .mx tr.locked-row td:first-child{background:var(--surface-2);}
.pg-staff .mx .yes{color:var(--ok); font-weight:800;}
.pg-staff .mx .no{color:var(--faint);}
.pg-staff .mx .switch{vertical-align:middle;}
.pg-staff .mx .ovr{font-size:10.5px; color:var(--accent-text); font-weight:700; display:block; margin-top:2px;}
.pg-staff .mx-pick{display:none; padding:10px 16px; border-bottom:1px solid var(--border);}
@media (max-width:640px){
  .pg-staff .mx-pick{display:block;}
  .pg-staff .mx .rcol:not(.on-role){display:none;}
  .pg-staff .mx th:first-child, .pg-staff .mx td:first-child{min-width:0; position:static;}
  .pg-staff .mx td .pd{display:none;}
  .pg-staff .mx th, .pg-staff .mx td{padding:8px 10px;}
}
.pg-staff .au{display:flex; gap:12px; padding:10px 16px; border-bottom:1px solid var(--border); align-items:flex-start;}
.pg-staff .au:last-child{border-bottom:none;}
.pg-staff .au .ai{width:30px; height:30px; border-radius:8px; background:var(--surface-2); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; flex-shrink:0; color:var(--text-2);}
.pg-staff .au .ai svg{width:15px; height:15px;}
.pg-staff .au .at{font-size:13px;}
.pg-staff .au .as{font-size:11.5px; color:var(--muted); margin-top:2px;}
.pg-staff .au .tm2{margin-left:auto; font-size:11.5px; color:var(--muted); white-space:nowrap; text-align:right;}
.pg-staff .au .tm-m{display:none;}
.pg-staff .dayh{padding:8px 16px; font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; background:var(--surface-2); border-bottom:1px solid var(--border);}
.pg-staff .mine{display:flex; flex-wrap:wrap; gap:6px;}
.pg-staff .filters{display:flex; gap:8px; flex-wrap:wrap; align-items:center;}
.pg-staff .filters .select{width:auto; min-width:170px; height:36px;}
.pg-staff .btn svg{width:14px; height:14px;}
.pg-staff .switch[disabled]{opacity:0.5; cursor:not-allowed;}
.st-modal .scope{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:4px 14px; max-height:220px; overflow-y:auto; border:1px solid var(--border); border-radius:8px; padding:8px 10px;}
.st-modal .scope label{display:flex; gap:8px; align-items:center; font-size:12.5px; padding:3px 0;}
.st-modal .scope input, .st-modal .rad input{accent-color:var(--brand-strong); width:16px; height:16px;}
.st-modal .rad{display:flex; gap:14px; flex-wrap:wrap; font-size:13px;}
.st-modal .rad label{display:flex; gap:6px; align-items:center;}
.st-modal .ov{display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid var(--border);}
.st-modal .ov:last-child{border-bottom:none;}
.st-modal .ov .grow b{font-size:12.5px;} .st-modal .ov .grow div{font-size:11px; color:var(--muted);}
.st-modal .preview{background:var(--surface-2); border:1px solid var(--border); border-radius:10px; padding:10px 12px; font-size:12.5px; line-height:1.5;}
@media (max-width:560px){ .st-modal .scope{grid-template-columns:minmax(0,1fr);} .pg-staff .filters .select{flex:1 1 140px; min-width:0;} .pg-staff .au .tm2{display:none;} .pg-staff .au .tm-m{display:inline;} }
`);

  function audit(text, cat) { D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: cat || 'access', text: text }); }
  function emailOf(s) { var dom = (O.ws().email || 'team@orbique.site').split('@')[1]; return s.name.split(' ').slice(0, s.name.split(' ').length >= 3 ? 2 : 1).join('').toLowerCase() + '@' + dom; }
  function scopeText(sc) { return sc === 'all' || !sc ? 'All ' + D.properties.length + ' properties' : sc.length === 1 ? D.propById[sc[0]].short : fmt.plural(sc.length, 'property', 'properties'); }
  function scopeTitle(sc) { return sc === 'all' || !sc ? 'All properties' : sc.map(function (id) { return D.propById[id].name; }).join(', '); }
  function membersWith(role) { return D.staff.filter(function (s) { return s.role === role; }); }
  function openTasks(id) { return D.tasks.filter(function (t) { return t.status !== 'done' && t.assigneeId === id; }).length; }
  function lastActive(iso) { var mins = (Date.parse(D.NOW + ':00Z') - Date.parse(iso + ':00Z')) / 6e4; return mins <= 15 ? '<span class="online"></span>Online now' : '<span class="away"></span>' + fmt.ago(iso); }

  /* ---------- team ---------- */
  function teamHTML(owner) {
    var rows = D.staff.slice().sort(function (a, b) { return (meta(a.id).removed ? 1 : 0) - (meta(b.id).removed ? 1 : 0); }).map(function (s) {
      var m = meta(s.id), susp = m.status === 'suspended', gone = !!m.removed, ov = m.overrides ? Object.keys(m.overrides).length : 0;
      var pill = gone ? U.pill('Removed', 'neutral') : susp ? U.pill('Suspended', 'bad') : U.pill('Active', 'ok');
      var last = susp || gone ? '<span class="faint">–</span>' : lastActive(m.lastActive), nOpen = openTasks(s.id);
      return '<tr' + (gone ? ' class="gone"' : '') + '><td class="c-mem"><div class="stf-m">' + U.avatar(s.name) + '<div style="min-width:0"><div class="stf-nm">' + esc(s.name) + (s.id === O.state.viewer ? ' <span class="faint xs">(you)</span>' : '') + '</div><div class="stf-em">' + esc(emailOf(s)) + '</div></div></div></td>' +
        '<td>' + (s.role === 'owner' ? U.pill(s.roleLabel, 'brand') : esc(s.roleLabel)) + (ov ? '<div class="xs" style="color:var(--accent-text);font-weight:700">+' + fmt.plural(ov, 'extra permission') + '</div>' : '') + '</td>' +
        '<td class="nowrap" title="' + esc(scopeTitle(m.scope)) + '">' + esc(scopeText(m.scope)) + '</td>' +
        '<td class="nowrap">' + esc(s.phone) + '</td>' +
        '<td class="num">' + (nOpen || '<span class="faint">0</span>') + '</td>' +
        '<td class="nowrap small">' + last + '</td>' +
        '<td>' + pill + '</td>' +
        '<td class="c-mob">' + (s.role === 'owner' ? U.pill(s.roleLabel, 'brand') : '<b>' + esc(s.roleLabel) + '</b>') + '<span>' + esc(scopeText(m.scope)) + '</span><span>' + fmt.plural(nOpen, 'open task') + '</span><span>' + last + '</span>' + (susp || gone ? pill : '') + '</td>' +
        '<td class="right c-act"><button type="button" class="btn btn-ghost btn-sm" data-manage="' + s.id + '">' + (owner && s.role !== 'owner' ? 'Manage' : 'View') + '</button></td></tr>';
    }).join('');
    var inv = D.staffInvites.map(function (v) {
      var sent = 'Invited ' + fmt.ago(v.sentAt) + ' by ' + (staffById(v.by) ? staffById(v.by).name : 'the owner') + ' on ' + v.via;
      return '<tr><td class="c-mem"><div class="stf-m">' + U.avatar(v.name) + '<div style="min-width:0"><div class="stf-nm">' + esc(v.name) + '</div><div class="stf-em">' + esc(v.contact) + (v.note ? ' · ' + esc(v.note) : '') + '</div></div></div></td><td>' + esc(roleLabel(v.role)) + '</td><td title="' + esc(scopeTitle(v.scope)) + '">' + esc(scopeText(v.scope)) + '</td><td class="small muted" colspan="3">' + esc(sent) + '</td><td>' + U.pill('Invited', 'warn') + '</td>' +
        '<td class="c-mob"><b>' + esc(roleLabel(v.role)) + '</b><span>' + esc(scopeText(v.scope)) + '</span>' + U.pill('Invited', 'warn') + '<span class="muted">' + esc(sent) + '</span></td>' +
        '<td class="right nowrap c-act">' + (owner ? '<button type="button" class="btn btn-quiet btn-sm" data-resend="' + v.id + '">Resend</button><button type="button" class="btn btn-quiet btn-sm" data-cancel="' + v.id + '">Cancel</button>' : '') + '</td></tr>';
    }).join('');
    var nMem = D.staff.filter(function (s) { return !meta(s.id).removed; }).length;
    return '<div class="card"><div class="card-head"><div><h3>Team</h3><div class="sub">' + fmt.plural(nMem, 'member') + ' and ' + fmt.plural(D.staffInvites.length, 'pending invite') + '. Each person signs in with their own phone number.</div></div></div>' +
      '<div class="table-wrap"><table class="table team"><thead><tr><th>Member</th><th>Role</th><th>Properties</th><th>Phone</th><th class="num">Open tasks</th><th>Last active</th><th>Status</th><th></th></tr></thead><tbody>' + rows + inv + '</tbody></table></div></div>';
  }

  /* ---------- matrix ---------- */
  function matrixHTML(owner) {
    var roles = ROLES;
    function rc(r) { return 'rcol' + (r === st.mxRole ? ' on-role' : ''); }
    var head = '<tr><th>Permission</th>' + roles.map(function (r) { var n = membersWith(r[0]).length; return '<th class="' + rc(r[0]) + '">' + esc(r[1]) + '<span class="rc">' + fmt.plural(n, 'person', 'people') + '</span></th>'; }).join('') + '</tr>';
    function lvCell(role, key) {
      if (role === 'owner') return '<span class="lvp l-edit">Full</span>';
      var v = D.rolePerms[role][key] || 'none';
      if (!owner) return '<span class="lvp l-' + v + '">' + LEVELS.filter(function (l) { return l[0] === v; })[0][1] + '</span>';
      return '<select class="select lv l-' + v + '" data-lv="' + role + ':' + key + '" aria-label="' + esc(roleLabel(role)) + ', ' + esc((SECTIONS.filter(function (x) { return x[0] === key; })[0] || [key, key])[1]) + '">' + LEVELS.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === v ? ' selected' : '') + '>' + l[1] + '</option>'; }).join('') + '</select>';
    }
    var lockSvg = O.icon('lock');
    var sections = SECTIONS.map(function (s) {
      return '<tr><td><div class="pl">' + esc(s[1]) + '</div></td>' + roles.map(function (r) { return '<td class="' + rc(r[0]) + '">' + lvCell(r[0], s[0]) + '</td>'; }).join('') + '</tr>';
    }).join('') +
      '<tr class="locked-row"><td><div class="pl"><span class="lk-ic">' + lockSvg + '</span> Financials</div><div class="pd">Owner only. Cannot be granted to any role or person.</div></td>' + roles.map(function (r) { return '<td class="' + rc(r[0]) + '">' + (r[0] === 'owner' ? '<span class="lvp l-edit">Full</span>' : '<span class="lockc">' + lockSvg + 'Owner only</span>') + '</td>'; }).join('') + '</tr>';
    var actions = ACTIONS.map(function (a) {
      var fixed = a[3];
      return '<tr class="' + (fixed === 'owner' ? 'locked-row' : '') + '"><td><div class="pl">' + (fixed === 'owner' ? '<span class="lk-ic">' + lockSvg + '</span> ' : '') + esc(a[1]) + '</div><div class="pd">' + esc(a[2]) + '</div></td>' + roles.map(function (r) {
        var tdo = '<td class="' + rc(r[0]) + '">';
        if (r[0] === 'owner') return tdo + '<span class="yes" aria-label="Allowed">✓</span></td>';
        if (fixed === 'everyone') return tdo + '<span class="yes" aria-label="Allowed, everyone">✓</span></td>';
        if (fixed === 'owner') return tdo + '<span class="lockc">' + lockSvg + 'Owner only</span></td>';
        var on = !!D.rolePerms[r[0]][a[0]];
        var ovr = membersWith(r[0]).filter(function (s) { var m = meta(s.id); return m.overrides && a[0] in m.overrides && m.overrides[a[0]] !== on; });
        var ovTxt = ovr.length ? '<span class="ovr" title="Set on the person in Team">' + esc(ovr.map(function (s) { return s.name.split(' ')[0]; }).join(', ')) + ': ' + (on ? 'off' : 'on') + '</span>' : '';
        if (!owner) return tdo + (on ? '<span class="yes" aria-label="Allowed">✓</span>' : '<span class="no" aria-label="Not allowed">–</span>') + ovTxt + '</td>';
        return tdo + '<button type="button" class="switch' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '" aria-label="' + esc(roleLabel(r[0]) + ': ' + a[1]) + '" data-act-perm="' + r[0] + ':' + a[0] + '"></button>' + ovTxt + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="card"><div class="card-head"><div><h3>Roles and permissions</h3><div class="sub">' + (owner ? 'Change a cell and it applies at once to everyone with that role. Per-person exceptions are set in Team → Manage.' : 'Only the account owner can change permissions.') + '</div></div>' +
      '<div class="legend"><span><span class="lvp l-edit" style="padding:1px 7px;border-radius:10px;background:var(--brand-soft);color:var(--brand-text);font-size:11px">Edit</span> can change</span><span><span style="padding:1px 7px;border-radius:10px;background:var(--info-soft);color:var(--info);font-size:11px;font-weight:700">View</span> read only</span><span><span class="lk-ic">' + lockSvg + '</span> owner only</span></div></div>' +
      '<div class="mx-pick"><label class="label" for="mx-role" style="display:block;margin-bottom:5px">Show role</label><select class="select" id="mx-role" data-mxrole>' + roles.map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === st.mxRole ? ' selected' : '') + '>' + esc(r[1]) + ' (' + fmt.plural(membersWith(r[0]).length, 'person', 'people') + ')</option>'; }).join('') + '</select></div>' +
      '<div class="table-wrap"><table class="table mx"><thead>' + head + '</thead><tbody><tr class="grp"><td colspan="' + (roles.length + 1) + '">Sections</td></tr>' + sections + '<tr class="grp"><td colspan="' + (roles.length + 1) + '">Actions</td></tr>' + actions + '</tbody></table></div>' +
      '<div class="card-foot">Financials and approving expense claims stay with account owners. Staff Access cannot grant them, so payouts, profit and claims are never visible to a role by mistake.</div></div>';
  }

  /* ---------- audit ---------- */
  function auditEntries() {
    stampLogs();
    var out = SEED.slice().concat(D.auditLog);
    (D.lockLog || []).forEach(function (l) { var w = l.what.replace(/^Master code changed/, 'Changed the master code').replace(/^Guest code changed for (.*)$/, 'Changed the guest code for $1').replace(/^Guest code activated for (.*)$/, 'Activated the guest code for $1'); out.push({ at: l.at, by: l.by, cat: 'door', text: w + ' at ' + (D.propById[l.propertyId] ? D.propById[l.propertyId].name : l.propertyId) + (l.code && l.by !== 'system' ? ' (new code ends ' + String(l.code).slice(-2) + ')' : '') }); });
    (D.sentLog || []).forEach(function (l) { var b = D.booking(l.bookingId); out.push({ at: l.at, by: l.by, cat: 'documents', text: 'Sent ' + l.kind + ' to ' + (b ? b.guest.name : 'guest') + ' by ' + l.via }); });
    D.tasks.forEach(function (t) { if (t.status === 'done' && t.doneAt && d.diff(t.doneAt.slice(0, 10), D.TODAY) <= 7) out.push({ at: t.doneAt, by: t.assigneeId || 'system', cat: 'tasks', text: 'Completed "' + t.title + '"' + (t.propertyId ? ' at ' + D.propById[t.propertyId].short : '') + (t.photos ? ' with ' + fmt.plural(t.photos, 'photo') : '') }); });
    D.reviews.forEach(function (r) { if (r.reply && r.reply.date && d.diff(r.reply.date, D.TODAY) <= 4 && d.diff(r.reply.date, D.TODAY) >= 0) out.push({ at: r.reply.date + (r.reply.date === D.TODAY ? 'T' + D.NOW_TIME : 'T11:00'), by: r.reply.by || 's2', cat: 'reviews', text: 'Replied to ' + r.guest + '\'s ' + r.stars + '-star ' + U.platName(r.platform) + ' review' }); });
    D.bookings.forEach(function (b) { if (b.sameDay && b.checkIn === D.TODAY) out.push({ at: b.createdAt, by: 'system', cat: 'automations', text: 'Same-day booking alert for ' + b.guest.name + ' (' + D.propById[b.propertyId].short + ') sent to the ops manager' }); });
    return out.filter(function (e) { return e.at.slice(0, 16) <= D.NOW; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  }
  function whoName(id) { return id === 'system' ? 'Orbique (automatic)' : staffById(id) ? staffById(id).name : 'Someone'; }
  function auditHTML() {
    var all = auditEntries(), q = st.q.toLowerCase();
    var list = all.filter(function (e) { return (!st.who || e.by === st.who) && (!st.cat || e.cat === st.cat) && (!q || (e.text + ' ' + whoName(e.by)).toLowerCase().indexOf(q) >= 0); });
    var cats = Object.keys(CAT).filter(function (k) { return all.some(function (e) { return e.cat === k; }); });
    var people = '<option value="">Everyone</option>' + D.staff.map(function (s) { return '<option value="' + s.id + '"' + (st.who === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '<option value="system"' + (st.who === 'system' ? ' selected' : '') + '>Automatic (system)</option>';
    var body = '', lastDay = '';
    list.slice(0, 80).forEach(function (e) {
      var day = e.at.slice(0, 10);
      if (day !== lastDay) { lastDay = day; var df = d.diff(day, D.TODAY); body += '<div class="dayh">' + (df === 0 ? 'Today' : df === 1 ? 'Yesterday' : d.dowName(day) + ' ' + d.fmtY(day)) + '</div>'; }
      body += '<div class="au"><span class="ai">' + O.icon((CAT[e.cat] || CAT.access)[1]) + '</span><div class="grow"><div class="at"><b>' + esc(whoName(e.by)) + '</b> ' + esc(e.text.charAt(0).toLowerCase() + e.text.slice(1)) + '</div><div class="as">' + esc((CAT[e.cat] || CAT.access)[0]) + '<span class="tm-m"> · ' + fmt.time(e.at.length > 10 ? e.at : e.at + 'T00:00') + '</span></div></div><div class="tm2">' + fmt.time(e.at.length > 10 ? e.at : e.at + 'T00:00') + '</div></div>';
    });
    return '<div class="card"><div class="card-head"><div><h3>Audit log</h3><div class="sub">Every permission change, door code change, document sent and task finished, with who did it. Kept for 2 years.</div></div>' +
      '<div class="filters"><select class="select" data-af="who" aria-label="Person">' + people + '</select><select class="select" data-af="cat" aria-label="Type"><option value="">All activity</option>' + cats.map(function (k) { return '<option value="' + k + '"' + (st.cat === k ? ' selected' : '') + '>' + esc(CAT[k][0]) + '</option>'; }).join('') + '</select>' +
      '<label class="search"><span class="sr-only">Search the log</span>' + O.icon('search') + '<input type="search" data-af="q" placeholder="Search the log" value="' + esc(st.q) + '"></label><button type="button" class="btn btn-ghost btn-sm" data-act="audit-csv">' + O.icon('download') + 'CSV</button></div></div>' +
      '<div class="card-body flush">' + (list.length ? body : U.empty('No activity matches these filters.')) + '</div>' +
      (list.length > 80 ? '<div class="card-foot">Showing the latest 80 of ' + list.length + ' entries. Export CSV for the full log.</div>' : '') + '</div>';
  }

  /* ---------- your access (for non-owners) ---------- */
  function myAccessHTML() {
    var v = O.viewer(), m = meta(v.id);
    var secs = SECTIONS.filter(function (s) { return O.can(s[0], 'view'); }).map(function (s) { return '<span class="pill ' + (O.can(s[0], 'edit') ? 'brand' : 'info') + '">' + esc(s[1]) + (O.can(s[0], 'edit') ? '' : ' · view') + '</span>'; }).join('');
    var acts = ACTIONS.map(function (a) { var ok = O.can(a[0]); return '<span class="pill ' + (ok ? 'ok' : 'neutral') + '">' + (ok ? '✓ ' : '✕ ') + esc(a[1]) + '</span>'; }).join('');
    return '<div class="card"><div class="card-head"><div><h3>Your access</h3><div class="sub">' + esc(v.name) + ' · ' + esc(v.roleLabel) + ' · ' + esc(scopeText(m.scope)) + '. Ask Mei Fen Lim (account owner) if you need more.</div></div></div><div class="card-body stack"><div><div class="label" style="margin-bottom:6px">Sections</div><div class="mine">' + secs + '<span class="pill neutral">🔒 Financials · owner only</span></div></div><div><div class="label" style="margin-bottom:6px">Actions</div><div class="mine">' + acts + '</div></div></div></div>';
  }

  /* ---------- modals ---------- */
  function scopeBoxes(sc) {
    var all = sc === 'all' || !sc;
    return '<div class="rad" role="radiogroup" aria-label="Properties"><label><input type="radio" name="scopeMode" value="all"' + (all ? ' checked' : '') + '> All properties, including new ones</label><label><input type="radio" name="scopeMode" value="some"' + (!all ? ' checked' : '') + '> Only selected properties</label></div>' +
      '<div class="scope" data-scope' + (all ? ' hidden' : '') + '>' + D.properties.map(function (p) { return '<label><input type="checkbox" name="scope" value="' + p.id + '"' + (!all && sc.indexOf(p.id) >= 0 ? ' checked' : '') + '>' + esc(p.name) + '</label>'; }).join('') + '</div>';
  }
  function readScope(el) {
    if (O.$('[name=scopeMode]:checked', el).value === 'all') return 'all';
    return O.$$('[name=scope]:checked', el).map(function (i) { return i.value; });
  }
  function wireScope(el) { el.addEventListener('change', function (e) { if (e.target.name === 'scopeMode') O.$('[data-scope]', el).hidden = e.target.value === 'all'; }); }

  function invite() {
    var body = '<div class="st-modal stack"><div class="form-grid">' +
      '<div class="field"><label for="iv-name">Full name</label><input class="input" id="iv-name" name="name" placeholder="For example: Nurul Huda"></div>' +
      '<div class="field"><label for="iv-contact">Mobile number or email</label><input class="input" id="iv-contact" name="contact" placeholder="+60 12-345 6789"></div>' +
      '<div class="field"><label for="iv-role">Role</label><select class="select" id="iv-role" name="role">' + ROLES.slice(1).map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === 'housekeeping' ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select><span class="hint" data-rdesc></span></div>' +
      '<div class="field"><span class="label">Send invite by</span><div class="rad" style="padding-top:8px"><label><input type="radio" name="via" value="WhatsApp" checked> WhatsApp</label><label><input type="radio" name="via" value="Email"> Email</label></div></div>' +
      '<div class="field full"><span class="label">Properties they can see</span>' + scopeBoxes('all') + '</div>' +
      '<div class="field full"><span class="label">Message preview</span><div class="preview" data-prev></div></div>' +
      '</div><div class="note">The role decides what they can open. Financials and approving expense claims stay with account owners whatever role you pick.</div></div>';
    U.modal({
      title: 'Invite staff', sub: 'They get a link to join ' + O.ws().name + ' and set up sign-in', body: body, size: 'wide',
      onOpen: function (el) {
        wireScope(el);
        function paint() {
          var nm = O.$('[name=name]', el).value.trim() || 'there', r = O.$('[name=role]', el).value;
          O.$('[data-rdesc]', el).textContent = ROLE_DESC[r];
          O.$('[data-prev]', el).textContent = 'Hi ' + nm.split(' ')[0] + ', ' + O.viewer().name + ' has invited you to join the ' + O.ws().name + ' team as ' + ROLE_AS[r] + '. Tap to set up your account: https://' + O.ws().domain + '/join/' + (D.hash(nm + r) % 900000 + 100000);
        }
        el.addEventListener('input', paint); el.addEventListener('change', paint); paint();
      },
      actions: [{ label: 'Cancel', kind: 'ghost' }, {
        label: 'Send invite', kind: 'primary', onClick: function (close, el) {
          var nm = O.$('[name=name]', el).value.trim(), ct = O.$('[name=contact]', el).value.trim();
          if (!nm) { U.toast('Add their name', 'bad'); return false; }
          if (!ct) { U.toast('Add a mobile number or email', 'bad'); return false; }
          var sc = readScope(el); if (sc !== 'all' && !sc.length) { U.toast('Pick at least one property', 'bad'); return false; }
          var via = O.$('[name=via]:checked', el).value, role = O.$('[name=role]', el).value;
          D.staffInvites.push({ id: 'INV-' + (D.staffInvites.length + 2), name: nm, contact: ct, role: role, scope: sc, sentAt: D.NOW, via: via, by: O.state.viewer });
          audit('Invited ' + nm + ' as ' + roleLabel(role) + ' (' + scopeText(sc) + ')');
          U.toast('Invite sent to ' + nm + ' on ' + via + '. Prototype: nothing is really sent.');
          O.emit('data', { type: 'staff-invite' });
        }
      }]
    });
  }

  function manage(id) {
    var s = staffById(id), m = meta(id), owner = O.isOwner(), editable = owner && s.role !== 'owner';
    var ov = Object.assign({}, m.overrides || {});
    function ovRows() {
      return ACTIONS.filter(function (a) { return !a[3]; }).map(function (a) {
        var def = !!(D.rolePerms[s.role] || {})[a[0]], on = a[0] in ov ? !!ov[a[0]] : def;
        return '<div class="ov"><div class="grow"><b>' + esc(a[1]) + '</b><div>' + (a[0] in ov && ov[a[0]] !== def ? 'Different from the ' + esc(roleLabel(s.role)) + ' role (' + (def ? 'on' : 'off') + ')' : 'Same as the role') + '</div></div>' +
          (editable ? '<button type="button" class="switch' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '" aria-label="' + esc(a[1]) + '" data-ov="' + a[0] + '"></button>' : (on ? '<span class="pill ok">Allowed</span>' : '<span class="pill neutral">Off</span>')) + '</div>';
      }).join('');
    }
    var body = '<div class="st-modal stack">' +
      '<div class="row-flex">' + U.avatar(s.name, 'lg') + '<div class="grow"><div class="b">' + esc(s.name) + '</div><div class="small muted">' + esc(s.phone) + ' · ' + esc(emailOf(s)) + ' · member since ' + d.fmtY(m.since || '2025-01-01') + '</div></div>' + (m.removed ? U.pill('Removed', 'neutral') : m.status === 'suspended' ? U.pill('Suspended', 'bad') : U.pill('Active', 'ok')) + '</div>' +
      (m.removed ? '<div class="note warn">' + esc(s.name.split(' ')[0]) + ' was removed from the team and cannot sign in. Set the status to Active to bring them back.</div>' : '') +
      (s.role === 'owner' ? '<div class="note brand">Account owners can do everything, including Financials, approving expense claims and changing everyone\'s access. The account owner role cannot be removed here.</div>' :
        '<div class="form-grid"><div class="field"><label for="mg-role">Role</label><select class="select" id="mg-role" name="role"' + (editable ? '' : ' disabled') + '>' + ROLES.slice(1).map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === s.role ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select><span class="hint">Job title stays "' + esc(s.roleLabel) + '"</span></div>' +
        '<div class="field"><span class="label">Status</span><div class="rad" style="padding-top:8px"><label><input type="radio" name="status" value="active"' + (m.status !== 'suspended' ? ' checked' : '') + (editable ? '' : ' disabled') + '> Active</label><label><input type="radio" name="status" value="suspended"' + (m.status === 'suspended' ? ' checked' : '') + (editable ? '' : ' disabled') + '> Suspended (cannot sign in)</label></div></div>' +
        '<div class="field full"><span class="label">Properties</span>' + (editable ? scopeBoxes(m.scope) : '<div class="small">' + esc(scopeTitle(m.scope)) + '</div>') + '</div></div>' +
        '<div><div class="label">Exceptions for ' + esc(s.name.split(' ')[0]) + '</div><div class="small muted" style="margin:2px 0 4px">Turn an action on or off for this person only. Financials and approving claims cannot be granted.</div><div data-ovs>' + ovRows() + '</div></div>') +
      '</div>';
    var actions = [{ label: editable ? 'Cancel' : 'Close', kind: 'ghost' }];
    if (editable && !m.removed) {
      actions.unshift({ label: 'Remove from team', kind: 'ghost', onClick: function (close) { U.confirm('Remove ' + s.name + ' from the team? They lose access straight away and their open tasks become unassigned.', 'Remove', 'danger').then(function (ok) { if (!ok) return; D.tasks.forEach(function (t) { if (t.assigneeId === s.id && t.status !== 'done') t.assigneeId = null; }); m.status = 'suspended'; m.removed = true; audit('Removed ' + s.name + ' from the team; open tasks unassigned'); U.toast(s.name + ' no longer has access. Their open tasks are unassigned.', 'bad'); close(); O.emit('data', { type: 'staff' }); }); return false; } });
    }
    if (editable) {
      actions.push({
        label: 'Save', kind: 'primary', onClick: function (close, el) {
          var changes = [];
          var role = O.$('[name=role]', el).value, status = O.$('[name=status]:checked', el).value, sc = readScope(el);
          if (sc !== 'all' && !sc.length) { U.toast('Pick at least one property', 'bad'); return false; }
          if (role !== s.role) { changes.push('role to ' + roleLabel(role)); s.role = role; }
          if (status !== (m.status || 'active')) { changes.push(status === 'suspended' ? 'suspended access' : 'restored access'); m.status = status; if (status === 'active') m.removed = false; }
          if (JSON.stringify(sc) !== JSON.stringify(m.scope)) { changes.push('properties to ' + scopeText(sc)); m.scope = sc; }
          if (JSON.stringify(ov) !== JSON.stringify(m.overrides || {})) { changes.push('exceptions (' + (Object.keys(ov).map(function (k) { return O.permLabel(k) + (ov[k] ? ' on' : ' off'); }).join(', ') || 'none') + ')'); m.overrides = ov; }
          if (!changes.length) { U.toast('No changes'); return; }
          audit('Changed ' + s.name + '\'s ' + changes.join('; '));
          U.toast(s.name + ' updated. The change applies at their next tap.');
          O.emit('data', { type: 'staff' });
        }
      });
    }
    U.modal({
      title: editable ? 'Manage ' + s.name : s.name, sub: s.roleLabel, body: body, size: 'wide', actions: actions, autofocus: false,
      onOpen: function (el) {
        if (editable) wireScope(el);
        el.addEventListener('click', function (e) {
          var b = e.target.closest('[data-ov]'); if (!b) return;
          var k = b.dataset.ov, def = !!(D.rolePerms[s.role] || {})[k], cur = k in ov ? !!ov[k] : def;
          if (!cur === def) delete ov[k]; else ov[k] = !cur;
          O.$('[data-ovs]', el).innerHTML = ovRows();
        });
      }
    });
  }

  /* ---------- page ---------- */
  O.page('staff', {
    desc: 'Who is on the team, what each role can open and do, and a log of every change',
    render: function (root, ctx) {
      var owner = O.isOwner(), canSee = O.can('staff', 'view');
      if (ctx.params && ctx.params.tab && ctx.fresh) st.tab = ctx.params.tab;
      ctx.setActions(owner ? '<button type="button" class="btn btn-primary" data-act="invite">' + O.icon('plus') + 'Invite staff</button>' : '');
      ctx.actionsEl.onclick = function (e) { if (e.target.closest('[data-act=invite]')) invite(); };
      if (!canSee) {
        root.innerHTML = '<div class="pg-staff stack"><div class="locked"><div class="lk">🔒</div><b>Your role does not include Staff Access</b><div class="small">You are viewing as ' + esc(O.viewer().name) + ' (' + esc(O.viewer().roleLabel) + '). Below is what you can open and do.</div></div>' + myAccessHTML() + '</div>';
        return;
      }
      var active = D.staff.filter(function (s) { return meta(s.id).status !== 'suspended'; });
      var online = active.filter(function (s) { return (Date.parse(D.NOW + ':00Z') - Date.parse(meta(s.id).lastActive + ':00Z')) / 6e4 <= 15; }).length;
      var wk = auditEntries().filter(function (e) { return d.diff(e.at.slice(0, 10), D.TODAY) <= 6; });
      var permCh = wk.filter(function (e) { return e.cat === 'access'; }).length;
      var exc = D.staff.filter(function (s) { var m = meta(s.id); return m.overrides && Object.keys(m.overrides).length; }).length;
      root.innerHTML = '<div class="pg-staff">' +
        U.kpis([
          { label: 'Team members', value: active.length + '', sub: fmt.plural(D.staffInvites.length, 'invite') + ' pending' },
          { label: 'Online now', value: online + '', sub: 'Active in the last 15 min' },
          { label: 'Roles', value: ROLES.length + '', sub: exc ? fmt.plural(exc, 'person', 'people') + ' with exceptions' : 'No per-person exceptions' },
          { label: 'Owner-only areas', value: '2', sub: 'Financials, claim approval' },
          { label: 'Access changes, 7 days', value: permCh + '', sub: wk.length + ' logged actions in total' }
        ]) +
        (!owner ? '<div class="note" style="margin-bottom:14px">You can see the team and permissions. Only the account owner (Mei Fen Lim) can invite people or change access.</div>' : '') +
        '<div class="tabs" role="tablist">' + [['team', 'Team'], ['roles', 'Roles & permissions'], ['audit', 'Audit log']].concat(owner ? [] : [['mine', 'Your access']]).map(function (t) { return '<button type="button" role="tab" aria-selected="' + (st.tab === t[0]) + '" class="' + (st.tab === t[0] ? 'on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
        (st.tab === 'team' ? teamHTML(owner) : st.tab === 'roles' ? matrixHTML(owner) : st.tab === 'audit' ? auditHTML() : myAccessHTML()) +
        '<div class="small faint" style="margin-top:12px">Prototype: invites and staff notifications are not really sent.</div></div>';

      var pg = O.$('.pg-staff', root);
      pg.addEventListener('click', function (e) {
        var b;
        if ((b = e.target.closest('[data-tab]'))) { st.tab = b.dataset.tab; ctx.rerender(); return; }
        if ((b = e.target.closest('[data-manage]'))) { manage(b.dataset.manage); return; }
        if ((b = e.target.closest('[data-resend]'))) { var v = D.staffInvites.filter(function (x) { return x.id === b.dataset.resend; })[0]; v.sentAt = D.NOW; audit('Resent the invite to ' + v.name); U.toast('Invite sent again to ' + v.name + ' on ' + v.via); O.emit('data', { type: 'staff' }); return; }
        if ((b = e.target.closest('[data-cancel]'))) { var i = D.staffInvites.map(function (x) { return x.id; }).indexOf(b.dataset.cancel), v2 = D.staffInvites[i]; D.staffInvites.splice(i, 1); audit('Cancelled the invite for ' + v2.name); U.toast('Invite for ' + v2.name + ' cancelled'); O.emit('data', { type: 'staff' }); return; }
        if ((b = e.target.closest('[data-act-perm]'))) {
          var p = b.dataset.actPerm.split(':'), role = p[0], key = p[1], on = !D.rolePerms[role][key];
          D.rolePerms[role][key] = on;
          var ppl = membersWith(role);
          audit((on ? 'Allowed ' : 'Turned off ') + '"' + O.permLabel(key) + '" for ' + roleLabel(role));
          U.toast(roleLabel(role) + (on ? ' can now ' : ' can no longer ') + O.permLabel(key).toLowerCase() + '. Applies to ' + (ppl.length ? ppl.map(function (s) { return s.name; }).join(', ') : 'nobody yet') + '.');
          O.emit('data', { type: 'perms' }); return;
        }
        if ((b = e.target.closest('[data-act=audit-csv]'))) {
          O.downloadCSV('audit-log-' + D.TODAY + '.csv', [['Date', 'Time', 'Who', 'Type', 'What']].concat(auditEntries().map(function (x) { return [x.at.slice(0, 10), x.at.slice(11, 16), whoName(x.by), (CAT[x.cat] || CAT.access)[0], x.text]; })));
        }
      });
      pg.addEventListener('change', function (e) {
        var el = e.target;
        if (el.matches('[data-lv]')) {
          var p = el.dataset.lv.split(':'), lbl = SECTIONS.filter(function (s) { return s[0] === p[1]; })[0][1];
          D.rolePerms[p[0]][p[1]] = el.value;
          audit('Set ' + lbl + ' to "' + el.value + '" for ' + roleLabel(p[0]));
          U.toast(roleLabel(p[0]) + ': ' + lbl + ' is now ' + (el.value === 'none' ? 'hidden' : el.value === 'view' ? 'view only' : 'editable'));
          O.emit('data', { type: 'perms' });
        }
        if (el.matches('[data-af]') && el.dataset.af !== 'q') { st[el.dataset.af] = el.value; ctx.rerender(); }
        if (el.matches('[data-mxrole]')) { st.mxRole = el.value; ctx.rerender(); }
      });
      var q = O.$('[data-af=q]', pg), qt;
      if (q) q.addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(function () { st.q = q.value; ctx.rerender(); var n = O.$('.pg-staff [data-af=q]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); });
    }
  });
})();
