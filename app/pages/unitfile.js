/* Unit file — everything about a unit the operator rents from its owner: the lease (rent, due day, tenancy dates,
   deposits, renewal reminder), the owner's payment details, the unit's bills, building access, documents and notes.
   Shown as the "Unit file" tab of a unit in Properties (app/pages/properties.js) and, for what is due in the next
   7 days, as the Dashboard's "Due soon" card (app/pages/dashboard.js).

   Who: people with "See and edit unit files" (O.can('properties.file')): account owners, and anyone an owner switches
   it on for in Staff Access. The database enforces the same rule (unit_file_can, supabase/migrations/0023_unit_files.sql).

   Where it is kept: never in D (the synced workspace data every member reads).
     signed in:      table unit_files (one row per unit, data = the file), read and written here through Supabase with
                     the member's own session, so row level security decides; documents in the private Storage bucket
                     unit-docs at <org id>/<property id>/<file>, opened with signed addresses that last 60 seconds.
     local test copy: this browser's storage (O.store 'unitFiles'), with sample files for the demo units; documents
                     cannot be added (they are kept online only).
   The data shape and the due-date rules are in api/_lib/shared/unitdue.cjs (O.unitdue); docs/notes/unit-file.md.

   O.unitFile: allowed(), load(force), get(pid), save(pid, data), markPaid(pid, item), dueSoon(), view / edit / click
   (the Properties drawer), dueSoonHTML() / dueClick() (the Dashboard), seedDemo() and purgeDocs() (app/server/auth.js). */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt, F = O.unitdue;
  var BUCKET = 'unit-docs', SIGNED_SECONDS = 60, STALE_MS = 5 * 60e3, RETRY_MS = 60e3;
  var UF = O.unitFile = {};
  var S = fresh();
  var OWNER_TYPES = [{ id: 'person', label: 'A person' }, { id: 'company', label: 'A company' }];
  var CONTACT_WAYS = ['WhatsApp', 'Phone call', 'Email', 'WeChat'];
  var OWNER_KEYS = ['name', 'type', 'contact', 'phone', 'phone2', 'email', 'prefers', 'address', 'nationality', 'idNo', 'taxNo', 'bank', 'holder', 'accountNo', 'swift', 'payRef'];
  /* a unit owned by the business itself carries the workspace name as its owner (properties.js "company owned") */
  function companyOwned(p) { var ws = O.ws && O.ws(); return !!(p.owner && ws && p.owner === ws.name); }
  /* the owner's name, phone and email from the unit file onto the property record, so Details and owner statements match */
  function setOwner(p, who) {
    if (!who || !who.name) return;
    var ch = p.owner !== who.name || (p.ownerPhone || '') !== (who.phone || '') || (p.ownerEmail || '') !== (who.email || '');
    if (!ch) return;
    p.owner = who.name;
    if (who.phone) p.ownerPhone = who.phone; else delete p.ownerPhone;
    if (who.email) p.ownerEmail = who.email; else delete p.ownerEmail;
    if (!Array.isArray(D.auditLog)) D.auditLog = [];
    D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: 'properties', text: 'Set the owner of ' + p.name + ' to ' + who.name + ' (unit file)' });
    O.emit('data');
  }
  function fresh() { return { org: null, files: {}, loaded: false, loading: null, error: null, at: 0, reveal: {}, busy: 0, queue: {} }; }

  O.css('unitfile', `
.pp-dr .uf-tabs{padding:12px 18px 0;}
.pp-dr .uf-tabs + .pp-vbody{padding-top:10px;}
.pp-dr .uf-lead{font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:flex-start;}
.pp-dr .uf-lead svg{width:14px;height:14px;flex:none;margin-top:1px;}
.pp-dr .uf-bill{border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;}
.pp-dr .uf-bill + .uf-bill{margin-top:8px;}
.pp-dr .uf-bill .t{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:700;font-size:13px;}
.pp-dr .uf-bill .t .amt{margin-left:auto;font-variant-numeric:tabular-nums;}
.pp-dr .uf-bill .s{font-size:12px;color:var(--muted);overflow-wrap:anywhere;}
.pp-dr .uf-bill .w{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;}
.pp-dr .uf-docs{display:flex;flex-direction:column;gap:6px;}
.pp-dr .uf-doc{display:flex;align-items:center;gap:10px;border:1px solid var(--border);border-radius:10px;padding:8px 10px;min-width:0;}
.pp-dr .uf-doc .ic{width:30px;height:30px;border-radius:8px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;flex:none;}
.pp-dr .uf-doc .ic svg{width:15px;height:15px;}
.pp-dr .uf-doc .grow{min-width:0;flex:1;}
.pp-dr .uf-doc .grow b{display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pp-dr .uf-doc .grow span{font-size:11.5px;color:var(--muted);}
.pp-dr .uf-doc .acts{display:flex;gap:4px;flex:none;}
.pp-dr .uf-up{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;}
.pp-dr .uf-up .select{width:auto;min-width:0;flex:1 1 160px;}
.pp-dr .uf-brow{border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;}
.pp-dr .uf-brow .bh{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;font-weight:700;font-size:13px;}
.pp-dr .uf-note{white-space:pre-wrap;font-size:13px;line-height:1.5;}
.pp-dr .uf-check{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;min-height:40px;}
.pg-dashboard .uf-due .dsh-al .when{font-size:11.5px;font-weight:700;white-space:nowrap;margin-left:8px;}
.pg-dashboard .uf-due .dsh-al .when.bad{color:var(--bad);}
.pg-dashboard .uf-due .uf-row{display:flex;align-items:center;border-bottom:1px solid var(--border);}
.pg-dashboard .uf-due .uf-row:last-child{border-bottom:none;}
.pg-dashboard .uf-due .uf-row .dsh-al{border-bottom:none;flex:1;min-width:0;}
.pg-dashboard .uf-due .uf-row .btn{margin-right:12px;flex:none;}
@media (max-width:760px){.pp-dr .uf-doc .acts .btn{min-height:40px;}}
`);

  /* ---------------- where it is kept ---------------- */
  function live() { return !!(O.auth && O.auth.enabled && O.auth.enabled() && O.auth.orgId && O.auth.orgId()); }
  function orgKey() { return live() ? O.auth.orgId() : 'local'; }
  function sb() { return O.auth.supabase(); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function check() { if (S.org !== orgKey()) { S = fresh(); S.org = orgKey(); } }
  function errText(e, fallback) {
    var m = e && (e.message || e.error_description || e.msg) || '';
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) return 'Orbique could not be reached. Check your connection and try again.';
    if (e && (e.code === '42501' || /row-level security|permission denied|not allowed|unauthori[sz]ed/i.test(m))) return 'Your access does not include unit files.';
    return e && e.code === 'conflict' ? m : fallback || 'Something went wrong. Please try again.';
  }
  function conflict() { var e = new Error('Someone else changed this unit file just now. It has been reloaded: please make your change again.'); e.code = 'conflict'; return e; }

  UF.allowed = function () { return !!O.can('properties.file'); };
  UF.live = live;
  UF.state = function () { check(); return { loaded: S.loaded, loading: !!S.loading, error: S.error }; };

  function loadLive() {
    return sb().from('unit_files').select('property_id, data, updated_at').eq('org_id', O.auth.orgId()).limit(5000).then(function (r) {
      if (r.error) throw r.error;
      var out = {}; (r.data || []).forEach(function (row) { out[row.property_id] = { data: row.data || {}, updatedAt: row.updated_at }; });
      return out;
    });
  }
  function loadLocal() {
    var all = O.store.get('unitFiles', null);
    if (!all || typeof all !== 'object') {
      all = {}; var demo = demoFiles(D.STORY || D.TODAY);
      Object.keys(demo).forEach(function (pid) { if (D.propById[pid]) all[pid] = { data: demo[pid], updatedAt: D.NOW }; });
      O.store.set('unitFiles', all);
    }
    return Promise.resolve(clone(all));
  }
  /* load every unit file of the workspace (cached; force: from the server again) */
  UF.load = function (force) {
    check();
    if (!UF.allowed()) return Promise.resolve({});
    if (S.loading) return S.loading;
    var age = Date.now() - S.at;
    if (!force && (S.loaded ? age < STALE_MS : S.error && age < RETRY_MS)) return Promise.resolve(S.files);
    var key = S.org;
    S.loading = (live() ? loadLive() : loadLocal()).then(function (files) {
      if (S.org !== key) return {};
      S.files = files; S.loaded = true; S.error = null; S.at = Date.now(); S.loading = null; O.emit('unitfiles');
      return files;
    }, function (e) {
      if (S.org !== key) return {};
      S.loading = null; S.error = errText(e, 'The unit files could not be loaded. Please try again.'); S.at = Date.now(); O.emit('unitfiles');
      throw e;
    });
    return S.loading;
  };
  UF.get = function (pid) { check(); var f = S.files[pid]; return f ? f.data : null; };

  /* one unit's saves run one after another: each read-modify-write starts from the row the previous save returned, so two
     quick "Mark paid" clicks on the same unit do not race on the same updated_at and report a false conflict */
  function serial(pid, fn) {
    check();
    var key = S.org, q = S.queue, prev = q[pid] || Promise.resolve();
    var go = function () { check(); if (S.org !== key) throw new Error('You switched workspace, so this was not saved.'); return fn(); };
    var run = prev.then(go, go);
    var tail = run.then(function () {}, function () {});
    q[pid] = tail;
    tail.then(function () { if (q[pid] === tail) delete q[pid]; });
    return run;
  }
  /* save one unit's file. Signed in: only if nobody changed it since it was loaded (updated_at), else a conflict */
  UF.save = function (pid, data) { return serial(pid, function () { return saveNow(pid, data); }); };
  function saveNow(pid, data) {
    check();
    if (!UF.allowed()) return Promise.reject(new Error('Your access does not include unit files.'));
    data = clone(data) || {};
    data.v = 1; data.updatedAt = D.NOW; data.updatedBy = O.state.viewer;
    var key = S.org;
    if (!live()) {
      var all = O.store.get('unitFiles', {}) || {}; all[pid] = { data: data, updatedAt: D.NOW };
      O.store.set('unitFiles', all); S.files[pid] = clone(all[pid]); O.emit('unitfiles');
      return Promise.resolve(data);
    }
    if (O.auth.readOnly && O.auth.readOnly()) return Promise.reject(new Error('This workspace is paused, so nothing can be changed right now.'));
    var known = S.files[pid] && S.files[pid].updatedAt, q;
    if (known) q = sb().from('unit_files').update({ data: data }).eq('org_id', O.auth.orgId()).eq('property_id', pid).eq('updated_at', known).select('data, updated_at');
    else q = sb().from('unit_files').insert({ org_id: O.auth.orgId(), property_id: pid, data: data }).select('data, updated_at');
    return q.then(function (r) {
      if (S.org !== key) throw new Error('You switched workspace, so this was not saved.');
      if (r.error && r.error.code === '23505') throw conflict();
      if (r.error) throw r.error;
      var row = (r.data || [])[0];
      if (!row) throw conflict();
      S.files[pid] = { data: row.data, updatedAt: row.updated_at }; O.emit('unitfiles');
      return row.data;
    }).catch(function (e) {
      if (e && e.code === 'conflict') return UF.load(true).catch(function () {}).then(function () { throw e; });
      throw e;
    });
  }
  UF.markPaid = function (pid, item) {
    return serial(pid, function () {
      var cur = UF.get(pid); if (!cur) throw new Error('This unit has no unit file yet.');
      return saveNow(pid, F.markPaid(cur, item, D.TODAY));
    });
  };
  /* what is due soon across the workspace's active units (needs load() first) */
  UF.dueSoon = function () {
    check();
    var files = Object.keys(S.files).filter(function (pid) { var p = D.propById[pid]; return p && !p.archived; }).map(function (pid) { return { propertyId: pid, data: S.files[pid].data }; });
    return F.dueSoon(files, D.TODAY);
  };

  /* ---------------- documents (signed in only) ---------------- */
  function bucket() { return sb().storage.from(BUCKET); }
  function docPath(pid, name) { return O.auth.orgId() + '/' + pid + '/' + O.uid('D').toLowerCase() + '-' + F.safeName(name); }
  function uploadDoc(pid, file, cat) {
    var why = F.checkDoc(file.type, file.size);
    if (why) return Promise.reject(new Error(why));
    var cur = UF.get(pid) || {}, docs = Array.isArray(cur.docs) ? cur.docs : [];
    if (docs.length >= F.MAX_DOCS) return Promise.reject(new Error('This unit already has ' + F.MAX_DOCS + ' documents. Remove one first.'));
    var path = docPath(pid, file.name);
    return bucket().upload(path, file, { contentType: file.type, upsert: false }).then(function (r) {
      if (r.error) throw new Error(/row-level|policy|unauthori[sz]ed|403/i.test(r.error.message || '') ? 'Your access does not include unit files.' : 'The file could not be uploaded. Please try again.');
      return serial(pid, function () {
        var next = clone(UF.get(pid) || {});
        next.docs = (Array.isArray(next.docs) ? next.docs : []).concat([{ id: O.uid('DOC'), path: path, name: String(file.name || 'Document').slice(0, 120), cat: cat, size: file.size, mime: file.type, at: D.NOW, by: O.state.viewer }]);
        return saveNow(pid, next);
      }).catch(function (e) { bucket().remove([path]).catch(function () {}); throw e; });
    });
  }
  function openDoc(doc) {
    var w = null; try { w = window.open('', '_blank'); if (w) w.opener = null; } catch (e) { w = null; }
    return bucket().createSignedUrl(doc.path, SIGNED_SECONDS).then(function (r) {
      if (r.error || !r.data || !r.data.signedUrl) throw new Error('The document could not be opened. Please try again.');
      if (w) w.location.href = r.data.signedUrl; else location.assign(r.data.signedUrl);
    }, function (e) { throw e; }).catch(function (e) { if (w) try { w.close(); } catch (x) {} throw e; });
  }
  function removeDoc(pid, doc) {
    return bucket().remove([doc.path]).then(function (r) {
      if (r.error) throw new Error('The document could not be removed. Please try again.');
      return serial(pid, function () {
        var next = clone(UF.get(pid) || {});
        next.docs = (next.docs || []).filter(function (x) { return x.id !== doc.id; });
        return saveNow(pid, next);
      });
    });
  }
  /* before the workspace is reset or the demo loaded: remove the documents (the rows go with reset_org) */
  UF.purgeDocs = function () {
    if (!live() || !UF.allowed()) return Promise.resolve(0);
    return UF.load(true).then(function (files) {
      var paths = []; Object.keys(files).forEach(function (pid) { (files[pid].data.docs || []).forEach(function (x) { if (x && x.path) paths.push(x.path); }); });
      var chunks = []; for (var i = 0; i < paths.length; i += 100) chunks.push(paths.slice(i, i + 100));
      return chunks.reduce(function (pr, c) { return pr.then(function () { return bucket().remove(c); }); }, Promise.resolve()).then(function () { return paths.length; });
    });
  };
  /* a fresh demo workspace (server mode, the owner's device): sample unit files for the demo units */
  UF.seedDemo = function () {
    if (!live() || !UF.allowed()) return Promise.resolve(0);
    var demo = demoFiles(D.TODAY), rows = Object.keys(demo).filter(function (pid) { return D.propById[pid]; }).map(function (pid) { return { org_id: O.auth.orgId(), property_id: pid, data: demo[pid] }; });
    if (!rows.length) return Promise.resolve(0);
    return sb().from('unit_files').upsert(rows, { onConflict: 'org_id,property_id' }).then(function (r) { if (r.error) throw r.error; return UF.load(true).then(function () { return rows.length; }); });
  };

  /* ---------------- sample files (obviously fake numbers only) ---------------- */
  function demoFiles(today) {
    var day = function (n) { return d.day(d.add(today, n)); };
    var due = function (n) { return d.add(today, n); };
    var prevMonth = function (iso) { return d.addMonths(iso, -1); };
    var made = d.add(today, -90);
    var acct = 'XXXX-XXXX-1234', ic = 'XXXXXX-XX-XXXX', phone = '+60 3-XXXX XXXX';
    return {
      kls: {
        lease: { rent: 3200, dueDay: day(3), method: 'Bank transfer', start: d.addMonths(due(45), -24), end: due(45), noticeMonths: 2, deposit: 6400, utilityDeposit: 1600, reminderDays: 60, ref: 'TA-DEMO-0001', paidUntil: prevMonth(due(3)), createdOn: made },
        owner: { idNo: ic, bank: 'Maybank', holder: 'Demo owner account', accountNo: acct },
        bills: [
          { id: 'b1', type: 'internet', provider: 'Unifi (demo)', accountNo: 'DEMO-1001', amount: 129, freq: 'monthly', dueDay: day(5), paidBy: 'us', autopay: false, lastPaid: prevMonth(due(5)), createdOn: made },
          { id: 'b2', type: 'electricity', provider: 'TNB', accountNo: 'DEMO-2002', amount: 180, freq: 'monthly', dueDay: day(-2), paidBy: 'us', autopay: false, lastPaid: prevMonth(due(-2)), createdOn: made, notes: 'Pay on the myTNB app.' },
          { id: 'b3', type: 'water', provider: 'Air Selangor', accountNo: 'DEMO-3003', amount: 35, freq: 'monthly', dueDay: 15, paidBy: 'owner', autopay: false, createdOn: made },
          { id: 'b4', type: 'maintenance', provider: 'JMB (demo)', accountNo: 'UNIT-28-XX', amount: 650, freq: 'quarterly', nextDue: due(20), paidBy: 'us', autopay: false, createdOn: made },
          { id: 'b5', type: 'sewerage', provider: 'IWK', accountNo: 'DEMO-5005', amount: 24, freq: 'halfyearly', nextDue: due(70), paidBy: 'owner', autopay: false, createdOn: made }
        ],
        access: { routerUser: 'admin', routerPass: 'demo-XXXX', cards: 2, cardNos: 'DEMO-01, DEMO-02', parkingCard: 'PK-DEMO-77', mailbox: '28-XX', mailboxKey: 'Spare key with the guard house', mgmtOffice: 'Management office, Level 3 (demo) · ' + phone, guardPhone: phone },
        notes: 'Sample unit file: every number here is made up. The owner prefers WhatsApp for receipts.'
      },
      or4: {
        lease: { rent: 2800, dueDay: day(-3), method: 'DuitNow', start: d.addMonths(today, -8), end: d.addMonths(today, 16), noticeMonths: 2, deposit: 5600, utilityDeposit: 1400, reminderDays: 60, ref: 'TA-DEMO-0002', paidUntil: prevMonth(due(-3)), createdOn: made },
        owner: { idNo: ic, bank: 'CIMB Bank', holder: 'Demo owner account', accountNo: 'XXXX-XXXX-5678' },
        bills: [
          { id: 'b1', type: 'internet', provider: 'TIME (demo)', accountNo: 'DEMO-1101', amount: 109, freq: 'monthly', dueDay: day(6), paidBy: 'us', autopay: true, createdOn: made },
          { id: 'b2', type: 'electricity', provider: 'TNB', accountNo: 'DEMO-2202', amount: 150, freq: 'monthly', dueDay: day(12), paidBy: 'us', autopay: false, lastPaid: prevMonth(due(12)), createdOn: made },
          { id: 'b3', type: 'assessment', provider: 'DBKL', accountNo: 'DEMO-3303', amount: 420, freq: 'halfyearly', nextDue: due(40), paidBy: 'owner', autopay: false, createdOn: made }
        ],
        access: { cards: 1, cardNos: 'DEMO-11', mailbox: 'B-4-XX', guardPhone: phone },
        notes: ''
      },
      bbs: {
        lease: { rent: 1900, dueDay: day(-10), method: 'Standing instruction', start: d.addMonths(today, -3), end: d.addMonths(today, 21), noticeMonths: 1, deposit: 3800, utilityDeposit: 950, reminderDays: 60, ref: 'TA-DEMO-0003', createdOn: made, paidUntil: due(-10) },
        owner: { idNo: 'Company no. DEMO-XXXX', bank: 'Public Bank', holder: 'Demo owner sdn bhd', accountNo: 'XXXX-XXXX-9012' },
        bills: [{ id: 'b1', type: 'internet', provider: 'Unifi (demo)', amount: 99, freq: 'monthly', dueDay: 20, paidBy: 'rent', autopay: false, createdOn: made }],
        access: { cards: 2, guardPhone: phone }
      }
    };
  }

  /* ---------------- shared bits ---------------- */
  function money(n, p) { return n == null ? '' : fmt.money(+n, { cur: p, dp: Math.round(+n) === +n ? 0 : 2 }); }
  function faint(t) { return '<span class="faint">' + esc(t || 'Not set') + '</span>'; }
  function kv(rows) { return '<dl class="pp-kv">' + rows.filter(Boolean).map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>'; }
  function v(x) { return x == null || x === '' ? faint() : esc(String(x)); }
  function dateText(iso) { return iso ? d.dowName(iso) + ' ' + d.fmtY(iso) : ''; }
  function whenText(item) {
    if (item.kind === 'tenancy') return item.overdue ? 'Ended ' + d.fmt(item.date) : item.days === 0 ? 'Ends today' : 'Ends in ' + fmt.plural(item.days, 'day');
    if (item.overdue) return 'Overdue since ' + d.fmt(item.date);
    return item.days === 0 ? 'Due today' : item.days === 1 ? 'Due tomorrow' : 'Due ' + d.dowName(item.date) + ' ' + d.fmt(item.date);
  }
  function duePill(n) { if (!n) return ''; return n.overdue ? U.pill('Overdue since ' + d.fmt(n.date), 'bad') : U.pill('Next ' + d.fmt(n.date), d.diff(D.TODAY, n.date) <= F.HORIZON ? 'warn' : 'neutral'); }
  function sizeText(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function secret(pid, key, val, copy) {
    if (!val) return faint();
    var shown = S.reveal[pid + ':' + key];
    return '<span class="pp-inl"><span class="kbd">' + esc(shown ? val : F.mask(val)) + '</span><button type="button" class="btn btn-quiet btn-xs" data-uf="reveal" data-k="' + esc(key) + '">' + O.icon('eye') + (shown ? 'Hide' : 'Show') + '</button>' +
      (copy ? '<button type="button" class="btn btn-quiet btn-xs" data-uf="copy" data-k="' + esc(key) + '">' + O.icon('copy') + 'Copy</button>' : '') + '</span>';
  }
  function secretValue(f, key) {
    var o = f.owner || {}, a = f.access || {};
    return { accountNo: o.accountNo, idNo: o.idNo, routerPass: a.routerPass }[key] || '';
  }
  function paidByText(b) { return F.label(F.PAID_BY, b.paidBy || 'us'); }
  function billTitle(b) { return b.type === 'other' && b.provider ? b.provider : F.label(F.BILL_TYPES, b.type) || 'Bill'; }
  function freqText(b) {
    var f = F.freqOf(b.freq);
    if (f.months === 1 && b.dueDay) return 'Monthly, on day ' + b.dueDay;
    return f.label + (b.nextDue ? ', next ' + d.fmt(b.nextDue) : '');
  }

  /* ---------------- the Properties drawer: view ---------------- */
  /* X: {h, sub, body, foot} of the drawer; host: {tabsHTML, edit(), close(), repaint()} */
  UF.view = function (X, p, host) {
    check();
    if (!S.loaded && !S.loading) UF.load().catch(function () {});
    var f = UF.get(p.id), st = UF.state(), h = host.tabsHTML + '<div class="pp-vbody">';
    h += '<div class="uf-lead">' + O.icon('lock') + '<span>Only people allowed to see unit files see this tab. ' + (live() ? 'Bank details and documents stay in this workspace and open only for them.' : 'In this test copy the unit file stays in this browser.') + '</span></div>';
    if (st.error) h += '<div class="note warn">' + esc(st.error) + ' <button type="button" class="btn btn-quiet btn-xs" data-uf="retry">Try again</button></div>';
    if (!st.loaded && !st.error) { X.body.innerHTML = h + '<div class="note">Loading the unit file…</div></div>'; footer(X, p, host, false); return; }
    if (!f) {
      h += '<div class="note">Nothing is filed for ' + esc(p.short || p.name) + ' yet. Add the lease, the owner\'s bank details, the bills and the tenancy agreement, and the Dashboard reminds you when rent and bills are due.</div>';
      h += sharedHTML(p, {}) + (live() ? docsHTML(p, {}) : '') + '</div>';
      X.body.innerHTML = h; footer(X, p, host, true); return;
    }
    var L = f.lease || {}, o = f.owner || {}, a = f.access || {}, T = D.TODAY;
    var rent = F.nextRent(L, T), ten = F.tenancyEnd(L, T);
    h += '<section class="pp-vs"><h4>Lease from the owner</h4>' + kv([
      ['Monthly rent', L.rent ? '<span class="pp-price">' + money(L.rent, p) + '</span>' : faint()],
      ['Rent due', L.dueDay ? '<span class="pp-inl">Day ' + esc(L.dueDay) + ' of each month' + (rent ? ' ' + duePill(rent) + '<button type="button" class="btn btn-quiet btn-xs" data-uf="paid" data-kind="rent">' + O.icon('check') + 'Mark paid</button>' : '') + '</span>' : faint()],
      L.paidUntil ? ['Last paid', esc(d.fmtY(L.paidUntil)) + ' <span class="xs muted">rent due on that day</span>'] : null,
      ['Pays by', v(L.method)],
      ['Tenancy', L.start || L.end ? esc([L.start ? d.fmtY(L.start) : '…', L.end ? d.fmtY(L.end) : 'no end date'].join(' to ')) + (ten ? ' ' + (ten.ended ? U.pill('Ended', 'bad') : ten.due ? U.pill(fmt.plural(ten.daysLeft, 'day') + ' left', 'warn') : '') : '') : faint()],
      ['Notice period', L.noticeMonths != null && L.noticeMonths !== '' ? esc(fmt.plural(+L.noticeMonths, 'month')) : faint()],
      ['Security deposit', L.deposit ? money(L.deposit, p) : faint()],
      ['Utility deposit', L.utilityDeposit ? money(L.utilityDeposit, p) : faint()],
      ['Renewal reminder', L.end ? esc(fmt.plural(L.reminderDays == null || L.reminderDays === '' ? F.REMINDER_DAYS : +L.reminderDays, 'day')) + ' before the end' + (ten ? ' <span class="xs muted">from ' + esc(d.fmt(ten.from)) + '</span>' : '') : faint('Add the end date')],
      ['Agreement ref.', v(L.ref)]
    ]) + '</section>';
    h += '<section class="pp-vs"><h4>Owner and payment</h4>' + kv([
      ['Owner', p.owner ? esc(p.owner) + (o.type ? ' <span class="xs muted">' + esc(F.label(OWNER_TYPES, o.type)) + '</span>' : '') : faint()],
      o.type === 'company' ? ['Contact person', v(o.contact)] : null,
      ['Phone', p.ownerPhone ? esc(p.ownerPhone) : faint()],
      ['WhatsApp / other phone', v(o.phone2)],
      ['Email', p.ownerEmail ? esc(p.ownerEmail) : faint()],
      ['Prefers', v(o.prefers)],
      ['Address', o.address ? '<span class="uf-note">' + esc(o.address) + '</span>' : faint()],
      ['Nationality', v(o.nationality)],
      ['IC / passport / reg. no.', secret(p.id, 'idNo', o.idNo)],
      ['Tax no.', v(o.taxNo)],
      ['Bank', v(o.bank)],
      ['Account holder', v(o.holder)],
      ['Account number', secret(p.id, 'accountNo', o.accountNo, true)],
      o.swift ? ['SWIFT code', v(o.swift)] : null,
      ['Payment reference', v(o.payRef)]
    ]) + '</section>';
    var bills = Array.isArray(f.bills) ? f.bills : [];
    h += '<section class="pp-vs"><h4>Bills</h4>' + (bills.length ? bills.map(function (b) {
      var n = F.nextBill(b, T), ours = (b.paidBy || 'us') === 'us';
      return '<div class="uf-bill"><div class="t">' + esc(billTitle(b)) + (b.autopay ? U.pill('Autopay', 'info') : '') + '<span class="amt">' + (b.amount ? money(b.amount, p) : '') + '</span></div>' +
        '<div class="s">' + esc([b.type !== 'other' ? b.provider : '', b.accountNo ? 'Account ' + b.accountNo : '', freqText(b), paidByText(b)].filter(Boolean).join(' · ')) + '</div>' +
        (ours && n ? '<div class="w">' + duePill(n) + (!b.autopay ? '<button type="button" class="btn btn-quiet btn-xs" data-uf="paid" data-kind="bill" data-bill="' + esc(b.id) + '">' + O.icon('check') + 'Mark paid</button>' : '') + (b.lastPaid ? '<span class="xs muted">Last paid ' + esc(d.fmt(b.lastPaid)) + '</span>' : '') + '</div>' : '') +
        (b.notes ? '<div class="s">' + esc(b.notes) + '</div>' : '') + '</div>';
    }).join('') : '<div class="note">No bills yet.</div>') + '</section>';
    h += sharedHTML(p, a);
    h += docsHTML(p, f);
    h += '<section class="pp-vs"><h4>Notes</h4>' + (f.notes ? '<div class="uf-note">' + esc(f.notes) + '</div>' : faint('No notes')) + '</section>';
    if (f.updatedAt) { var by = f.updatedBy && D.staffById(f.updatedBy); h += '<div class="xs muted">Last changed ' + esc(fmt.dateTime(f.updatedAt)) + (by ? ' by ' + esc(by.name) : '') + '</div>'; }
    X.body.innerHTML = h + '</div>';
    footer(X, p, host, true);
  };
  /* access and building: the lock and Wi-Fi are the unit's own (Details), shown only with properties.access */
  function sharedHTML(p, a) {
    var acc = O.can('properties.access');
    return '<section class="pp-vs"><h4>Access and building</h4>' + kv([
      ['Smart lock', p.lockBrand ? esc(p.lockBrand) : faint()],
      ['Door code', acc ? (p.lockCode ? '<span class="kbd">' + esc(p.lockCode) + '</span>' : faint()) : faint('Hidden for your role')],
      ['Wi-Fi', acc ? (p.wifi && p.wifi[0] ? esc(p.wifi[0]) + (p.wifi[1] ? ' · <span class="kbd">' + esc(p.wifi[1]) + '</span>' : '') : faint()) : faint('Hidden for your role')],
      ['Router admin', a.routerUser || a.routerPass ? '<span class="pp-inl">' + (a.routerUser ? esc(a.routerUser) : '') + (a.routerPass ? ' ' + secret(p.id, 'routerPass', a.routerPass) : '') + '</span>' : faint()],
      ['Access cards', a.cards || a.cardNos ? esc([a.cards ? fmt.plural(+a.cards, 'card') : '', a.cardNos].filter(Boolean).join(' · ')) : faint()],
      ['Parking', esc(p.parking || '') + (p.parking && a.parkingCard ? ' · ' : '') + (a.parkingCard ? 'card ' + esc(a.parkingCard) : '') || faint()],
      ['Mailbox', a.mailbox || a.mailboxKey ? esc([a.mailbox, a.mailboxKey].filter(Boolean).join(' · ')) : faint()],
      ['Management office', v(a.mgmtOffice)],
      ['Guard house', a.guardPhone ? '<a href="tel:' + esc(String(a.guardPhone).replace(/[^\d+]/g, '')) + '">' + esc(a.guardPhone) + '</a>' : faint()]
    ]) + '<div class="xs muted" style="margin-top:6px">The smart lock, door code, Wi-Fi and parking bay are the unit\'s own, in Details.</div></section>';
  }
  function docsHTML(p, f) {
    var docs = Array.isArray(f.docs) ? f.docs : [];
    var up = live()
      ? '<div class="uf-up"><select class="select" data-uf-cat aria-label="Kind of document">' + F.DOC_CATS.map(function (c) { return '<option value="' + c.id + '">' + esc(c.label) + '</option>'; }).join('') + '</select>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-uf="upload"' + (S.busy ? ' disabled' : '') + '>' + O.icon('upload') + (S.busy ? 'Uploading…' : 'Upload') + '</button>' +
        '<input type="file" data-uf-file hidden accept="' + F.DOC_TYPES.join(',') + ',.heic,.heif"></div><div class="xs muted" style="margin:-2px 0 8px">PDF or photos (JPEG, PNG, WebP, HEIC), up to 20 MB each.</div>'
      : '<div class="note">Documents are kept online only, so they cannot be added in this test copy.</div>';
    return '<section class="pp-vs"><h4>Documents</h4>' + up + (docs.length ? '<div class="uf-docs">' + docs.map(function (x) {
      var by = x.by && D.staffById(x.by);
      return '<div class="uf-doc"><span class="ic">' + O.icon(/^image\//.test(x.mime) ? 'image' : 'file') + '</span><div class="grow"><b title="' + esc(x.name) + '">' + esc(x.name) + '</b><span>' + esc([F.label(F.DOC_CATS, x.cat) || 'Other', x.size ? sizeText(x.size) : '', x.at ? d.fmt(x.at.slice(0, 10)) : '', by ? by.name : ''].filter(Boolean).join(' · ')) + '</span></div>' +
        '<div class="acts">' + (live() ? '<button type="button" class="btn btn-ghost btn-xs" data-uf="open" data-doc="' + esc(x.id) + '">Open</button><button type="button" class="btn btn-quiet btn-xs" data-uf="deldoc" data-doc="' + esc(x.id) + '" aria-label="Remove ' + esc(x.name) + '">' + O.icon('trash') + '</button>' : '') + '</div></div>';
    }).join('') + '</div>' : '<div class="small muted">No documents yet. Start with the tenancy agreement.</div>') + '</section>';
  }
  function footer(X, p, host, ready) {
    X.foot.innerHTML = '<button type="button" class="btn btn-ghost" data-uf="close">Close</button><div class="r">' + (ready ? '<button type="button" class="btn btn-primary" data-uf="edit">' + O.icon('edit') + (UF.get(p.id) ? 'Edit unit file' : 'Fill in the unit file') + '</button>' : '') + '</div>';
  }

  /* ---------------- the Properties drawer: edit ---------------- */
  var ED = null; /* {pid, draft} */
  UF.edit = function (X, p, host) {
    check();
    var f = clone(UF.get(p.id)) || {};
    ED = { pid: p.id, draft: { lease: f.lease || {}, owner: f.owner || {}, bills: Array.isArray(f.bills) ? f.bills : [], access: f.access || {}, notes: f.notes || '' } };
    if (!ED.draft.lease.reminderDays && ED.draft.lease.reminderDays !== 0) ED.draft.lease.reminderDays = F.REMINDER_DAYS;
    /* the owner's name, phone and email live on the property record (Details, owner statements): start from those */
    var ow = ED.draft.owner = Object.assign({}, ED.draft.owner);
    ow.name = companyOwned(p) ? '' : p.owner || ''; ow.phone = p.ownerPhone || ''; ow.email = p.ownerEmail || '';
    X.h.textContent = 'Unit file · ' + (p.short || p.name);
    X.sub.textContent = 'Only people allowed to see unit files see this';
    X.body.innerHTML = formHTML(p, ED.draft);
    X.foot.innerHTML = '<button type="button" class="btn btn-ghost" data-uf="cancel">Cancel</button><div class="r"><button type="button" class="btn btn-primary" data-uf="save">Save unit file</button></div>';
  };
  function fld(name, label, input, o) {
    o = o || {};
    return '<div class="field' + (o.full ? ' full' : '') + '"><label for="uf-' + name.replace(/\./g, '-') + '">' + esc(label) + (o.opt === false ? '' : ' <span class="opt">(optional)</span>') + '</label>' + input +
      (o.hint ? '<div class="hint">' + esc(o.hint) + '</div>' : '') + '<div class="pp-err" data-err="' + esc(name) + '"></div></div>';
  }
  function inp(name, val, attrs) { return '<input class="input" id="uf-' + name.replace(/\./g, '-') + '" name="' + esc(name) + '" value="' + esc(val == null ? '' : val) + '"' + (attrs || '') + '>'; }
  function sel(name, val, opts) { return '<select class="select" id="uf-' + name.replace(/\./g, '-') + '" name="' + esc(name) + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val == null ? '' : val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; }
  function moneyIn(name, val, p) { return '<div class="pp-money"><span>' + esc(fmt.cur(p)) + '</span>' + inp(name, val, ' type="number" min="0" step="0.01" inputmode="decimal"') + '</div>'; }
  function billHTML(b, i, p) {
    var monthly = F.freqOf(b.freq).months === 1;
    return '<div class="uf-brow" data-bill-row="' + i + '"><div class="bh"><span>' + esc(billTitle(b) || 'Bill ' + (i + 1)) + '</span><button type="button" class="btn btn-quiet btn-xs" data-uf="delbill" data-i="' + i + '">' + O.icon('trash') + 'Remove</button></div><div class="form-grid">' +
      fld('b.' + i + '.type', 'Type', sel('b.' + i + '.type', b.type || 'internet', F.BILL_TYPES.map(function (t) { return [t.id, t.label]; })), { opt: false }) +
      fld('b.' + i + '.provider', b.type === 'other' ? 'What it is' : 'Provider', inp('b.' + i + '.provider', b.provider, ' maxlength="60" placeholder="e.g. Unifi"')) +
      fld('b.' + i + '.accountNo', 'Account number', inp('b.' + i + '.accountNo', b.accountNo, ' maxlength="40" autocomplete="off"')) +
      fld('b.' + i + '.amount', 'Usual amount', moneyIn('b.' + i + '.amount', b.amount, p)) +
      fld('b.' + i + '.freq', 'How often', sel('b.' + i + '.freq', b.freq || 'monthly', F.FREQS.map(function (x) { return [x.id, x.label]; })), { opt: false }) +
      (monthly ? fld('b.' + i + '.dueDay', 'Due on day', inp('b.' + i + '.dueDay', b.dueDay, ' type="number" min="1" max="31" step="1" inputmode="numeric" placeholder="1 to 31"'), { hint: 'Of each month' })
        : fld('b.' + i + '.nextDue', 'Next due date', inp('b.' + i + '.nextDue', b.nextDue, ' type="date"'))) +
      fld('b.' + i + '.paidBy', 'Paid by', sel('b.' + i + '.paidBy', b.paidBy || 'us', F.PAID_BY.map(function (x) { return [x.id, x.label]; })), { opt: false }) +
      '<div class="field"><label class="uf-check"><input type="checkbox" name="b.' + i + '.autopay"' + (b.autopay ? ' checked' : '') + '> Autopay</label></div>' +
      fld('b.' + i + '.notes', 'Notes', inp('b.' + i + '.notes', b.notes, ' maxlength="200"'), { full: true }) +
      '</div></div>';
  }
  function formHTML(p, f) {
    var L = f.lease, o = f.owner, a = f.access;
    var methods = F.PAY_METHODS.slice(); if (L.method && methods.indexOf(L.method) < 0) methods.push(L.method);
    return '<form class="pp-form" data-uf-form novalidate autocomplete="off">' +
      '<div class="pp-sec"><h4>Lease from the owner</h4><div class="sd">What you pay the owner for ' + esc(p.short || p.name) + ', in ' + esc(O.curOf(p)) + '.</div><div class="form-grid">' +
      fld('lease.rent', 'Monthly rent', moneyIn('lease.rent', L.rent, p)) +
      fld('lease.dueDay', 'Rent due on day', inp('lease.dueDay', L.dueDay, ' type="number" min="1" max="31" step="1" inputmode="numeric" placeholder="1 to 31"'), { hint: 'Of each month. The 31st is the last day in shorter months.' }) +
      fld('lease.method', 'Pays by', sel('lease.method', L.method || '', [['', 'Choose']].concat(methods.map(function (m) { return [m, m]; })))) +
      fld('lease.ref', 'Agreement reference', inp('lease.ref', L.ref, ' maxlength="60"')) +
      fld('lease.start', 'Tenancy starts', inp('lease.start', L.start, ' type="date"')) +
      fld('lease.end', 'Tenancy ends', inp('lease.end', L.end, ' type="date"')) +
      fld('lease.noticeMonths', 'Notice period (months)', inp('lease.noticeMonths', L.noticeMonths, ' type="number" min="0" max="24" step="1" inputmode="numeric"')) +
      fld('lease.reminderDays', 'Renewal reminder (days before the end)', inp('lease.reminderDays', L.reminderDays, ' type="number" min="0" max="365" step="1" inputmode="numeric"'), { hint: 'The Dashboard shows the end of the tenancy from then.' }) +
      fld('lease.deposit', 'Security deposit', moneyIn('lease.deposit', L.deposit, p)) +
      fld('lease.utilityDeposit', 'Utility deposit', moneyIn('lease.utilityDeposit', L.utilityDeposit, p)) +
      '</div></div>' +
      '<div class="pp-sec"><h4>Owner</h4><div class="sd">Who owns ' + esc(p.short || p.name) + '. The name, phone and email are also the unit\'s owner in Details and on owner statements.</div><div class="form-grid">' +
      fld('owner.name', 'Owner\'s name', inp('owner.name', o.name, ' maxlength="60" placeholder="e.g. Rajan Pillai"'), { full: true, opt: false }) +
      fld('owner.type', 'Owner is', sel('owner.type', o.type || 'person', OWNER_TYPES.map(function (x) { return [x.id, x.label]; })), { opt: false }) +
      fld('owner.contact', 'Contact person', inp('owner.contact', o.contact, ' maxlength="60"'), { hint: 'For a company owner' }) +
      fld('owner.phone', 'Phone', inp('owner.phone', o.phone, ' type="tel" inputmode="tel" maxlength="24" placeholder="+60 12-345 6789"')) +
      fld('owner.phone2', 'WhatsApp or other phone', inp('owner.phone2', o.phone2, ' type="tel" inputmode="tel" maxlength="24"')) +
      fld('owner.email', 'Email', inp('owner.email', o.email, ' type="email" inputmode="email" maxlength="80"')) +
      fld('owner.prefers', 'Prefers to be contacted by', sel('owner.prefers', o.prefers || '', [['', 'Choose']].concat(CONTACT_WAYS.map(function (x) { return [x, x]; })))) +
      fld('owner.address', 'Address', '<textarea class="textarea" id="uf-owner-address" name="owner.address" rows="2" maxlength="200">' + esc(o.address || '') + '</textarea>', { full: true }) +
      fld('owner.nationality', 'Nationality', inp('owner.nationality', o.nationality, ' maxlength="40"')) +
      fld('owner.idNo', 'IC, passport or company reg. no.', inp('owner.idNo', o.idNo, ' maxlength="40"')) +
      fld('owner.taxNo', 'Tax no.', inp('owner.taxNo', o.taxNo, ' maxlength="40"'), { hint: 'LHDN income tax number, if you need it for the tenancy' }) +
      '</div></div>' +
      '<div class="pp-sec"><h4>Owner\'s payment details</h4><div class="sd">Where the rent goes.</div><div class="form-grid">' +
      fld('owner.bank', 'Bank', inp('owner.bank', o.bank, ' maxlength="60" list="uf-banks" placeholder="e.g. Maybank"') + '<datalist id="uf-banks">' + ['Maybank', 'CIMB Bank', 'Public Bank', 'RHB Bank', 'Hong Leong Bank', 'AmBank', 'Bank Islam', 'UOB Malaysia', 'OCBC Malaysia', 'HSBC Malaysia', 'Alliance Bank', 'Affin Bank', 'Bank Rakyat', 'BSN'].map(function (b) { return '<option value="' + esc(b) + '"></option>'; }).join('') + '</datalist>') +
      fld('owner.holder', 'Account holder name', inp('owner.holder', o.holder, ' maxlength="80"')) +
      fld('owner.accountNo', 'Account number', inp('owner.accountNo', o.accountNo, ' maxlength="40" inputmode="numeric" autocomplete="off"')) +
      fld('owner.swift', 'SWIFT code', inp('owner.swift', o.swift, ' maxlength="11" autocomplete="off"'), { hint: 'Only for a bank outside Malaysia' }) +
      fld('owner.payRef', 'Payment reference', inp('owner.payRef', o.payRef, ' maxlength="60" placeholder="e.g. Rent 43-6"'), { full: true }) +
      '</div></div>' +
      '<div class="pp-sec"><h4>Bills</h4><div class="sd">Internet, electricity, water, maintenance and the rest. Bills you pay show on the Dashboard when they are due.</div><div data-uf-bills>' +
      f.bills.map(function (b, i) { return billHTML(b, i, p); }).join('') + '</div>' +
      (f.bills.length < F.MAX_BILLS ? '<button type="button" class="btn btn-ghost btn-sm" data-uf="addbill">' + O.icon('plus') + 'Add a bill</button>' : '') + '</div>' +
      '<div class="pp-sec"><h4>Access and building</h4><div class="sd">The door code, Wi-Fi, smart lock and parking bay are edited in Details.</div><div class="form-grid">' +
      fld('access.routerUser', 'Router admin login', inp('access.routerUser', a.routerUser, ' maxlength="40" autocomplete="off"')) +
      fld('access.routerPass', 'Router admin password', inp('access.routerPass', a.routerPass, ' maxlength="63" autocomplete="off"')) +
      fld('access.cards', 'Access cards', inp('access.cards', a.cards, ' type="number" min="0" max="50" step="1" inputmode="numeric"')) +
      fld('access.cardNos', 'Card numbers', inp('access.cardNos', a.cardNos, ' maxlength="120"')) +
      fld('access.parkingCard', 'Parking card', inp('access.parkingCard', a.parkingCard, ' maxlength="40"')) +
      fld('access.mailbox', 'Mailbox number', inp('access.mailbox', a.mailbox, ' maxlength="20"')) +
      fld('access.mailboxKey', 'Mailbox key', inp('access.mailboxKey', a.mailboxKey, ' maxlength="80" placeholder="e.g. Spare key in the drawer"'), { full: true }) +
      fld('access.mgmtOffice', 'Building management office', inp('access.mgmtOffice', a.mgmtOffice, ' maxlength="160" placeholder="Name, phone, opening hours"'), { full: true }) +
      fld('access.guardPhone', 'Guard house phone', inp('access.guardPhone', a.guardPhone, ' type="tel" inputmode="tel" maxlength="24"')) +
      '</div></div>' +
      '<div class="pp-sec"><h4>Notes</h4><div class="form-grid">' +
      fld('notes', 'Notes', '<textarea class="textarea" id="uf-notes" name="notes" rows="3" maxlength="2000">' + esc(f.notes) + '</textarea>', { full: true }) +
      '</div></div></form>';
  }
  /* the form into ED.draft (bill rows included) */
  function readForm(el) {
    var fm = O.$('[data-uf-form]', el); if (!fm || !ED) return;
    var get = function (n) { var x = fm.elements[n]; return x ? (x.type === 'checkbox' ? x.checked : String(x.value).trim()) : undefined; };
    var L = ED.draft.lease, o = ED.draft.owner, a = ED.draft.access;
    ['rent', 'dueDay', 'method', 'ref', 'start', 'end', 'noticeMonths', 'reminderDays', 'deposit', 'utilityDeposit'].forEach(function (k) { var x = get('lease.' + k); if (x !== undefined) L[k] = x; });
    OWNER_KEYS.forEach(function (k) { var x = get('owner.' + k); if (x !== undefined) o[k] = x; });
    ['routerUser', 'routerPass', 'cards', 'cardNos', 'parkingCard', 'mailbox', 'mailboxKey', 'mgmtOffice', 'guardPhone'].forEach(function (k) { var x = get('access.' + k); if (x !== undefined) a[k] = x; });
    ED.draft.notes = get('notes') || '';
    ED.draft.bills.forEach(function (b, i) {
      ['type', 'provider', 'accountNo', 'amount', 'freq', 'dueDay', 'nextDue', 'paidBy', 'autopay', 'notes'].forEach(function (k) { var x = get('b.' + i + '.' + k); if (x !== undefined) b[k] = x; });
    });
  }
  function paintBills(el, p) {
    var host = O.$('[data-uf-bills]', el); if (!host) return;
    host.innerHTML = ED.draft.bills.map(function (b, i) { return billHTML(b, i, p); }).join('');
    var add = O.$('[data-uf="addbill"]', el); if (add) add.hidden = ED.draft.bills.length >= F.MAX_BILLS;
  }
  /* clean and check the draft -> {data, errors} */
  function finish(p) {
    var E = {}, f = ED.draft, cur = UF.get(p.id) || {};
    var n = function (val, key, o) {
      if (val === '' || val == null) return undefined;
      var x = F.num(val);
      if (x == null || x < (o.min || 0) || (o.max != null && x > o.max) || (o.int && Math.round(x) !== x)) { E[key] = o.msg; return undefined; }
      return x;
    };
    var date = function (val, key) { if (!val) return undefined; if (!F.isDate(val)) { E[key] = 'Enter a date.'; return undefined; } return val; };
    var txt = function (val, max) { val = String(val == null ? '' : val).trim().slice(0, max || 120); return val || undefined; };
    var L = f.lease, oldL = cur.lease || {};
    var lease = {
      rent: n(L.rent, 'lease.rent', { msg: 'Enter the rent as a number.' }), dueDay: n(L.dueDay, 'lease.dueDay', { min: 1, max: 31, int: true, msg: 'A day from 1 to 31.' }),
      method: txt(L.method, 40), ref: txt(L.ref, 60), start: date(L.start, 'lease.start'), end: date(L.end, 'lease.end'),
      noticeMonths: n(L.noticeMonths, 'lease.noticeMonths', { max: 24, int: true, msg: '0 to 24 months.' }),
      reminderDays: n(L.reminderDays, 'lease.reminderDays', { max: 365, int: true, msg: '0 to 365 days.' }),
      deposit: n(L.deposit, 'lease.deposit', { msg: 'Enter an amount.' }), utilityDeposit: n(L.utilityDeposit, 'lease.utilityDeposit', { msg: 'Enter an amount.' }),
      paidUntil: oldL.paidUntil, createdOn: oldL.createdOn || D.TODAY
    };
    if (lease.start && lease.end && lease.end < lease.start) E['lease.end'] = 'The end is before the start.';
    if (lease.dueDay != null && lease.rent == null) E['lease.rent'] = 'Add the rent too.';
    /* a new or changed due day or rent (including the first time it is entered) starts counting again from today,
       so months before it was entered do not show as overdue */
    lease = F.restartRent(oldL, lease, D.TODAY);
    var oldBills = {}; (cur.bills || []).forEach(function (b) { oldBills[b.id] = b; });
    var bills = f.bills.map(function (b, i) {
      var k = 'b.' + i + '.', monthly = F.freqOf(b.freq).months === 1, old = b.id && oldBills[b.id] || {};
      var out = {
        id: b.id || O.uid('B'), type: F.label(F.BILL_TYPES, b.type) ? b.type : 'other', provider: txt(b.provider, 60), accountNo: txt(b.accountNo, 40),
        amount: n(b.amount, k + 'amount', { msg: 'Enter an amount.' }), freq: F.label(F.FREQS, b.freq) ? b.freq : 'monthly',
        dueDay: monthly ? n(b.dueDay, k + 'dueDay', { min: 1, max: 31, int: true, msg: 'A day from 1 to 31.' }) : undefined,
        nextDue: monthly ? undefined : date(b.nextDue, k + 'nextDue'),
        paidBy: F.label(F.PAID_BY, b.paidBy) ? b.paidBy : 'us', autopay: !!b.autopay, notes: txt(b.notes, 200),
        lastPaid: old.lastPaid, createdOn: old.createdOn || D.TODAY
      };
      if (old.id && (old.dueDay !== out.dueDay || old.nextDue !== out.nextDue || old.freq !== out.freq)) { out.createdOn = D.TODAY; delete out.lastPaid; }
      if (out.type === 'other' && !out.provider) E[k + 'provider'] = 'Say what the bill is for.';
      return out;
    });
    var fo = f.owner || {};
    var who = { name: txt(fo.name, 60), phone: txt(fo.phone, 24), email: txt(fo.email, 80) };
    if (!who.name) E['owner.name'] = 'Type the owner\'s name.';
    if (who.phone && !/^\+?[\d\s()-]{7,20}$/.test(who.phone)) E['owner.phone'] = 'Check the phone number. Use digits, spaces and +.';
    if (fo.phone2 && !/^\+?[\d\s()-]{7,20}$/.test(String(fo.phone2).trim())) E['owner.phone2'] = 'Check the phone number. Use digits, spaces and +.';
    if (who.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(who.email)) E['owner.email'] = 'Check the email address.';
    if (fo.swift && !/^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/.test(String(fo.swift).trim())) E['owner.swift'] = 'A SWIFT code has 8 or 11 letters and digits.';
    var a = f.access, cards = n(a.cards, 'access.cards', { max: 50, int: true, msg: '0 to 50.' });
    var data = {
      lease: lease,
      owner: {
        type: F.label(OWNER_TYPES, fo.type) ? fo.type : 'person', contact: fo.type === 'company' ? txt(fo.contact, 60) : undefined,
        phone2: txt(fo.phone2, 24), prefers: CONTACT_WAYS.indexOf(fo.prefers) >= 0 ? fo.prefers : undefined, address: txt(fo.address, 200),
        nationality: txt(fo.nationality, 40), idNo: txt(fo.idNo, 40), taxNo: txt(fo.taxNo, 40),
        bank: txt(fo.bank, 60), holder: txt(fo.holder, 80), accountNo: txt(fo.accountNo, 40), swift: txt(fo.swift, 11), payRef: txt(fo.payRef, 60)
      },
      bills: bills,
      access: { routerUser: txt(a.routerUser, 40), routerPass: txt(a.routerPass, 63), cards: cards, cardNos: txt(a.cardNos, 120), parkingCard: txt(a.parkingCard, 40), mailbox: txt(a.mailbox, 20), mailboxKey: txt(a.mailboxKey, 80), mgmtOffice: txt(a.mgmtOffice, 160), guardPhone: txt(a.guardPhone, 24) },
      docs: Array.isArray(cur.docs) ? cur.docs : [],
      notes: txt(f.notes, 2000)
    };
    return { data: JSON.parse(JSON.stringify(data)), who: who, errors: E };
  }
  function showErrors(el, E) {
    O.$$('.pp-err', el).forEach(function (x) { x.textContent = ''; });
    O.$$('.bad', el).forEach(function (x) { x.classList.remove('bad'); });
    var first = null;
    Object.keys(E).forEach(function (k) {
      var b = O.$('[data-err="' + k + '"]', el); if (b) b.textContent = E[k];
      var i = O.$('[name="' + k + '"]', el); if (i) { i.classList.add('bad'); if (!first) first = i; }
    });
    if (first) { first.focus(); if (first.scrollIntoView) first.scrollIntoView({ block: 'center' }); }
  }
  /* a change in the form: switching a bill's type or frequency changes its fields */
  UF.input = function (e, el, p) {
    if (!ED || ED.pid !== p.id) return;
    var t = e.target; if (!t || !t.name || !/^b\.\d+\.(freq|type)$/.test(t.name) || e.type !== 'change') return;
    readForm(el); paintBills(el, p);
  };

  /* ---------------- clicks in the drawer ---------------- */
  /* host: {el, toView(), toEdit(), close(), dirty(bool)} -> true when handled */
  UF.click = function (e, p, host) {
    var b = e.target.closest('[data-uf]'); if (!b || !p) return false;
    var a = b.dataset.uf, f = UF.get(p.id) || {};
    if (a === 'close') host.close();
    else if (a === 'retry') UF.load(true).catch(function () {});
    else if (a === 'edit') { if (!UF.allowed()) U.toast('Your access does not include unit files.', 'bad'); else host.toEdit(); }
    else if (a === 'cancel') {
      var back = function () { ED = null; host.toView(); };
      if (host.isDirty()) U.confirm('Discard your changes?', 'Discard', 'danger').then(function (ok) { if (ok) back(); }); else back();
    }
    else if (a === 'save') {
      readForm(host.el);
      var r = finish(p);
      if (Object.keys(r.errors).length) { showErrors(host.el, r.errors); return true; }
      b.disabled = true;
      UF.save(p.id, r.data).then(function () { setOwner(p, r.who); ED = null; host.dirty(false); host.toView(); U.toast('Unit file saved for ' + (p.short || p.name)); },
        function (err) { b.disabled = false; U.toast(errText(err, 'The unit file could not be saved. Please try again.'), 'bad'); if (err && err.code === 'conflict') { ED = null; host.dirty(false); host.toView(); } });
    }
    else if (a === 'addbill') { readForm(host.el); ED.draft.bills.push({ type: 'internet', freq: 'monthly', paidBy: 'us' }); paintBills(host.el, p); host.dirty(true); var rows = O.$$('[data-bill-row]', host.el), last = rows[rows.length - 1]; if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest' }); }
    else if (a === 'delbill') { readForm(host.el); ED.draft.bills.splice(+b.dataset.i, 1); paintBills(host.el, p); host.dirty(true); }
    else if (a === 'reveal') { var k = p.id + ':' + b.dataset.k; S.reveal[k] = !S.reveal[k]; host.repaint(); }
    else if (a === 'copy') copy(secretValue(f, b.dataset.k));
    else if (a === 'paid') {
      var item = b.dataset.kind === 'rent' ? { kind: 'rent' } : { kind: 'bill', billId: b.dataset.bill };
      b.disabled = true;
      UF.markPaid(p.id, item).then(function () { U.toast('Marked paid'); }, function (err) { b.disabled = false; U.toast(errText(err, 'This could not be saved. Please try again.'), 'bad'); });
    }
    else if (a === 'upload') { var fi = O.$('[data-uf-file]', host.el); if (fi) { fi.value = ''; fi.onchange = function () { var file = fi.files && fi.files[0]; if (file) upload(p, file, (O.$('[data-uf-cat]', host.el) || {}).value || 'other', host); }; fi.click(); } }
    else if (a === 'open') { var doc = (f.docs || []).filter(function (x) { return x.id === b.dataset.doc; })[0]; if (doc) openDoc(doc).catch(function (err) { U.toast(err.message, 'bad'); }); }
    else if (a === 'deldoc') {
      var dd = (f.docs || []).filter(function (x) { return x.id === b.dataset.doc; })[0]; if (!dd) return true;
      U.confirm(dd.name + ' is removed for everyone. This cannot be undone.', 'Remove', 'danger', 'Remove this document?').then(function (ok) {
        if (!ok) return;
        removeDoc(p.id, dd).then(function () { U.toast('Document removed'); }, function (err) { U.toast(errText(err, err && err.message), 'bad'); });
      });
    }
    else return false;
    return true;
  };
  function upload(p, file, cat, host) {
    S.busy++; host.repaint();
    uploadDoc(p.id, file, cat).then(function () { S.busy--; host.repaint(); U.toast(file.name + ' added'); }, function (err) { S.busy--; host.repaint(); U.toast(errText(err, err && err.message), 'bad'); });
  }
  function copy(text) {
    if (!text) return;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(function () { U.toast('Copied'); }, function () { U.toast('Copying is blocked here.', 'bad'); }); return; } } catch (e) { /* below */ }
    U.toast('Copying is blocked here.', 'bad');
  }

  /* ---------------- the Dashboard's "Due soon" card ---------------- */
  var DUE_CAP = 6;
  UF.dueSoonHTML = function (head) {
    if (!UF.allowed()) return '';
    check();
    UF.load().catch(function () {});
    var st = UF.state();
    if (!st.loaded) return st.error ? '<section class="card uf-due" data-card="duesoon">' + head('Due soon', null, '') + '<div class="dsh-quiet">' + esc(st.error) + '</div></section>' : '';
    var list = UF.dueSoon();
    if (!Object.keys(S.files).length) return '';
    var over = list.filter(function (x) { return x.overdue; }).length, shown = list.slice(0, DUE_CAP);
    var rows = shown.map(function (x, i) {
      var p = D.propById[x.propertyId] || {}, tone = x.overdue ? 'bad' : x.kind === 'tenancy' ? 'info' : 'warn';
      var sub = [p.short || p.name, x.amount != null ? money(x.amount, p) : '', x.autopay ? 'autopay' : ''].filter(Boolean).join(' · ');
      return '<div class="uf-row"><button type="button" class="dsh-al" data-due="' + i + '"><span class="ai ' + tone + '">' + O.icon(x.kind === 'tenancy' ? 'calendar' : x.kind === 'rent' ? 'home' : 'invoices') + '</span><span class="tx"><span class="at">' + esc(x.title) + '<span class="when' + (x.overdue ? ' bad' : '') + '">' + esc(whenText(x)) + '</span></span><span class="as">' + esc(sub) + '</span></span></button>' +
        (x.kind !== 'tenancy' && !x.autopay ? '<button type="button" class="btn btn-ghost btn-xs" data-due-paid="' + i + '">Mark paid</button>' : '') + '</div>';
    }).join('');
    S.shownDue = shown;
    return '<section class="card uf-due" data-card="duesoon">' + head('Due soon', list.length || null, list.length ? (over ? over + ' overdue · ' : '') + 'Rent, bills and tenancies in the next ' + F.HORIZON + ' days' : '', '', over > 0) +
      (rows || '<div class="dsh-quiet">No rent or bills due in the next ' + F.HORIZON + ' days.</div>') +
      (list.length > DUE_CAP ? '<div class="dsh-quiet">And ' + (list.length - DUE_CAP) + ' more. Open each unit\'s file in Properties.</div>' : '') + '</section>';
  };
  /* a click on the card -> true when handled */
  UF.dueClick = function (e) {
    var x = e.target.closest('[data-due], [data-due-paid]'); if (!x) return false;
    var paid = x.hasAttribute('data-due-paid'), item = (S.shownDue || [])[+(paid ? x.dataset.duePaid : x.dataset.due)];
    if (!item) return true;
    if (!paid) { O.go('properties', { propertyId: item.propertyId, unitTab: 'file' }); return true; }
    x.disabled = true;
    UF.markPaid(item.propertyId, item).then(function () { U.toast('Marked paid: ' + item.title + ', ' + ((D.propById[item.propertyId] || {}).short || '')); }, function (err) { x.disabled = false; U.toast(errText(err, 'This could not be saved. Please try again.'), 'bad'); });
    return true;
  };
})();
