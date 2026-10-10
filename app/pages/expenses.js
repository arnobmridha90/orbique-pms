/* Orbique Command Center v4 — Expenses
   Where staff and the owner record what they spend: date, amount, type dropdown (Others asks what it was for),
   cost type (operating or capital, suggested from the type), property or company, paid by, payment method, receipt
   photo, note. "Paid personally (claim)" creates a claim that waits for an account owner's approval. List with date
   range + filters (type, cost type, person, property, claim status, search), opex/capex split totals, totals by type and
   by person. Permissions: expenses.record (the form), expenses.viewAll (everyone's expenses, else only your own),
   expenses.approve (claims; owners only). Everything feeds Financials (operating costs in profit, capital below it). */
(function () {
  var O = window.O, D = O.data, M = O.metrics, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;

  /* ---- shared money setup (identical block in invoices.js, expenses.js, financials.js; runs once) ---- */
  var CLAIM = 'Paid personally (claim)';
  (function moneyInit() {
    if (D._moneyReady) return; D._moneyReady = true;
    D.expenses.forEach(function (e) {
      if (e.method !== CLAIM || e.claimStatus) return;
      var age = d.diff(e.date, D.STORY0 || D.TODAY); /* seed data, relative to the demo's own day (shifted later with D) */
      if (age <= 10) e.claimStatus = 'pending';
      else if (age <= 18) { e.claimStatus = 'approved'; e.approvedAt = d.add(e.date, 2); e.approvedBy = 's1'; }
      else { e.claimStatus = 'reimbursed'; e.approvedAt = d.add(e.date, 2); e.approvedBy = 's1'; e.reimbursedAt = d.add(e.date, 6); }
    });
    D.invoiceSettings = D.invoiceSettings || {
      autoInvoice: 'auto', autoReceipt: 'auto', invPattern: 'INV-{YYYY}-{seq}', rcpPattern: 'RCP-{YYYY}-{seq}',
      tourismTax: true, sst: false, sstNo: '', sstRate: 8, dueDays: 7
    };
  })();

  var PRESETS = ['today', 'yesterday', 'last7', 'last30', 'mtd', 'lastMonth', 'last90', 'qtd', 'ytd', 'since'];
  var CLAIMS = [['all', 'All'], ['pending', 'Claims pending'], ['approved', 'Approved, to pay back'], ['reimbursed', 'Paid back'], ['rejected', 'Rejected'], ['none', 'Not a claim']];
  var CLAIM_PILL = { pending: ['Waiting for approval', 'warn'], approved: ['Approved · to pay back', 'info'], reimbursed: ['Paid back', 'ok'], rejected: ['Rejected', 'bad'] };
  var st = { preset: 'last30', from: null, to: null, type: '', cls: '', person: '', prop: '', claim: 'all', q: '', limit: 50, draft: null, err: {}, lastId: null, viewer: null };
  /* cost type: capital = a long-lasting purchase for a property, operating = the running costs of the month */
  var CC = { opex: ['Operating expense', 'Operating'], capex: ['Capital expense', 'Capital'] };
  var CC_HELP = 'Capital is a long-lasting purchase for a property, such as furniture, appliances, an AC unit or renovation. Operating is the running costs of the month.';
  function suggestCls(type) { return (D.capexTypes || []).indexOf(type) >= 0 ? 'capex' : 'opex'; }
  function clsOf(e) { return e.costClass === 'capex' ? 'capex' : 'opex'; } /* same rule as M.expenses: no cost type counts as operating */

  O.css('expenses', [
    '.pg-expenses{display:flex;flex-direction:column;gap:14px;}',
    '.pg-expenses .kpis{margin-bottom:0;}',
    '.pg-expenses .k-sub .sm{display:none;} @media (max-width:560px){.pg-expenses .k-sub .lg{display:none;} .pg-expenses .k-sub .sm{display:inline;}}',
    '.pg-expenses .ex-top{display:grid;grid-template-columns:minmax(330px,400px) minmax(0,1fr);gap:14px;align-items:start;}',
    '.pg-expenses .ex-side{display:flex;flex-direction:column;gap:14px;min-width:0;}',
    /* record form */
    '.pg-expenses .ex-form{border-color:var(--brand-strong);box-shadow:inset 0 3px 0 var(--brand-strong),var(--shadow);}',
    '.pg-expenses .ex-form .card-head{background:var(--brand-soft-2);border-top-left-radius:var(--r);border-top-right-radius:var(--r);}',
    '.pg-expenses .ex-form .card-head h3{display:flex;align-items:center;gap:8px;}',
    '.pg-expenses .ex-form .card-head h3 svg{width:17px;height:17px;color:var(--brand-strong);}',
    '.pg-expenses .ex-form .card-body{display:flex;flex-direction:column;gap:12px;}',
    '.pg-expenses .field .req{color:var(--bad);}',
    '.pg-expenses .money-in{display:flex;align-items:center;border:1px solid var(--border);border-radius:8px;background:var(--surface);overflow:hidden;}',
    '.pg-expenses .money-in span{padding:0 0 0 10px;font-weight:800;color:var(--muted);font-size:13px;}',
    '.pg-expenses .money-in .input{border:none;font-weight:800;font-size:15px;}',
    '.pg-expenses .money-in:focus-within{outline:2px solid var(--brand-strong);outline-offset:-1px;border-color:transparent;}',
    '.pg-expenses .money-in .input:focus{outline:none;}',
    '.pg-expenses .ex-err{font-size:11.5px;color:var(--bad);font-weight:600;}',
    '.pg-expenses .is-bad .input, .pg-expenses .is-bad .select, .pg-expenses .is-bad.money-in{border-color:var(--bad);}',
    '.pg-expenses .ex-other{background:var(--accent-soft);border-radius:9px;padding:10px;}',
    '.pg-expenses .photo{display:flex;align-items:center;gap:10px;}',
    '.pg-expenses .photo-btn{display:inline-flex;align-items:center;gap:7px;border:1.5px dashed var(--border-strong);border-radius:9px;padding:9px 12px;font-size:12.5px;font-weight:700;color:var(--text-2);background:var(--surface-2);cursor:pointer;min-height:40px;}',
    '.pg-expenses .photo-btn:hover{border-color:var(--brand-strong);color:var(--brand-text);}',
    '.pg-expenses .photo-btn svg{width:16px;height:16px;}',
    '.pg-expenses .photo input[type=file]{position:absolute;width:1px;height:1px;opacity:0;}',
    '.pg-expenses .thumb{position:relative;width:56px;height:56px;border-radius:8px;overflow:hidden;border:1px solid var(--border);flex-shrink:0;}',
    '.pg-expenses .thumb img{width:100%;height:100%;object-fit:cover;display:block;}',
    '.pg-expenses .thumb-x{position:absolute;top:2px;right:2px;width:20px;height:20px;border-radius:50%;border:none;background:rgba(10,15,25,0.7);color:#FFFFFF;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0;}',
    '.pg-expenses .ex-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}',
    /* cost type */
    '.ex-cc{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;}',
    '.ex-cc label{position:relative;display:flex;align-items:center;gap:7px;border:1px solid var(--border);border-radius:9px;padding:8px 10px;min-height:42px;cursor:pointer;background:var(--surface);font-size:12.5px;font-weight:700;color:var(--text-2);white-space:nowrap;min-width:0;}',
    '.ex-cc label span{overflow:hidden;text-overflow:ellipsis;} .ex-cc .cc-short{display:none;}',
    '@media (max-width:480px){.ex-cc .cc-full{display:none;} .ex-cc .cc-short{display:inline;}}',
    '.ex-cc-lab{display:flex;align-items:center;gap:6px;}',
    '.ex-cc label:hover{border-color:var(--border-strong);}',
    '.ex-cc label.on{border-color:var(--brand-strong);background:var(--brand-soft-2);color:var(--text);box-shadow:inset 0 0 0 1px var(--brand-strong);}',
    '.ex-cc input{accent-color:var(--brand-strong);width:16px;height:16px;margin:0;flex-shrink:0;}',
    '.ex-cc-lab .sug{margin-left:auto;font-size:10.5px;font-weight:800;color:var(--brand-text);background:var(--brand-soft);border-radius:10px;padding:0 6px;white-space:nowrap;}',
    '.is-bad .ex-cc label{border-color:var(--bad);}',
    '.ex-cc-help{font-size:11.5px;color:var(--muted);line-height:1.45;margin-top:2px;}',
    '.cc-b{display:inline-flex;align-items:center;font-size:10.5px;font-weight:800;padding:1px 7px;border-radius:10px;white-space:nowrap;vertical-align:1px;margin-left:6px;}',
    '.cc-b.capex{background:var(--accent-soft);color:var(--accent-text);} .cc-b.opex{background:var(--surface-2);color:var(--muted);border:1px solid var(--border);}',
    '.pg-expenses .ex-split{font-weight:500;color:var(--muted);}',
    '.pg-expenses .ex-tot .ex-split{font-size:11.5px;margin-left:6px;}',
    '.pg-expenses .ex-norec{display:flex;gap:8px;align-items:flex-start;}',
    '.pg-expenses .ex-norec svg{width:16px;height:16px;flex-shrink:0;color:var(--muted);margin-top:1px;}',
    '.pg-expenses .ex-empty{text-align:center;padding:0 16px 22px;}',
    '.ex-ccm{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;}',
    '.ex-ccm .seg button{padding:4px 9px;font-size:12px;}',
    '.pg-expenses .ex-actions .btn-primary{flex:1;min-height:40px;}',
    /* claims */
    '.pg-expenses .cl-row{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);}',
    '.pg-expenses .cl-row:last-child{border-bottom:none;}',
    '.pg-expenses .cl-row.click{cursor:pointer;} .pg-expenses .cl-row.click:hover{background:var(--surface-2);}',
    '.pg-expenses .cl-row .main{flex:1;min-width:0;}',
    '.pg-expenses .cl-row .t{font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.pg-expenses .cl-row .s{font-size:12px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.pg-expenses .cl-row .amt{font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap;}',
    '.pg-expenses .cl-row .btns{display:flex;gap:6px;flex-shrink:0;}',
    '.pg-expenses .cl-head-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--accent);color:var(--accent-ink);font-size:11px;font-weight:800;margin-left:6px;vertical-align:1px;}',
    '.pg-expenses .hb-click{cursor:pointer;border-radius:6px;}',
    '.pg-expenses .hb-click:hover{background:var(--surface-2);}',
    '.pg-expenses .hb-click.on{background:var(--brand-soft);}',
    '.pg-expenses .hbar{padding:6px 6px;}',
    '.pg-expenses .hbar .hb-label{font-weight:600;}',
    '.pg-expenses .hb-sub{font-weight:500;color:var(--muted);font-size:11px;}',
    /* list */
    '.pg-expenses .ex-filters{display:flex;flex-direction:column;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border);}',
    '.pg-expenses .ex-filters .toolbar{margin-bottom:0;}',
    '.pg-expenses .ex-filters .select{width:auto;min-width:140px;height:36px;padding-top:0;padding-bottom:0;}',
    '.pg-expenses .ex-filters .search{flex:1 1 240px;}',
    '.pg-expenses .ex-table td{padding:9px 8px;} .pg-expenses .ex-table th{padding:9px 8px;}',
    '.pg-expenses .ex-table td:first-child, .pg-expenses .ex-table th:first-child{padding-left:16px;}',
    '.pg-expenses .ex-table td:last-child, .pg-expenses .ex-table th:last-child{padding-right:16px;}',
    '.pg-expenses .ex-table tr.new td{background:var(--brand-soft-2);}',
    '.pg-expenses .ex-desc .t{font-weight:700;} .pg-expenses .ex-desc .s{font-size:11.5px;color:var(--muted);margin-top:1px;max-width:250px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.pg-expenses .ex-who{display:flex;align-items:center;gap:7px;white-space:nowrap;}',
    '.pg-expenses .ex-meth{display:block;font-size:11.5px;color:var(--muted);font-weight:500;}',
    '.pg-expenses .ex-who .b{font-weight:600;}',
    '.pg-expenses .hbar{grid-template-columns:minmax(120px,190px) 1fr auto;}',
    '.pg-expenses .rc{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:700;white-space:nowrap;}',
    '.pg-expenses .rc svg{width:13px;height:13px;}',
    '.pg-expenses .rc.ok{color:var(--ok);} .pg-expenses .rc.miss{color:var(--warn);}',
    '.pg-expenses .rc img{width:26px;height:26px;border-radius:5px;object-fit:cover;border:1px solid var(--border);}',
    '.pg-expenses .ex-more{display:flex;justify-content:center;padding:10px;border-top:1px solid var(--border);}',
    '.pg-expenses .ex-tot td{font-weight:800;background:var(--surface-2);}',
    '.pg-expenses .scope-note{display:flex;gap:8px;align-items:center;}',
    '.pg-expenses .scope-note svg{width:15px;height:15px;flex-shrink:0;color:var(--muted);}',
    /* detail modal */
    '.ex-detail{display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:16px;align-items:start;}',
    '.ex-detail .ex-photo{border-radius:10px;overflow:hidden;border:1px solid var(--border);}',
    '.ex-detail .ex-photo img{width:100%;display:block;}',
    '.ex-detail .slip{background:#FFFFFF;color:#14181F;border:1px solid var(--border);border-radius:4px;padding:14px 12px 18px;font-family:ui-monospace,Menlo,monospace;font-size:10.5px;line-height:1.5;box-shadow:var(--shadow);position:relative;transform:rotate(-1.2deg);}',
    '.ex-detail .slip::after{content:"";position:absolute;left:0;right:0;bottom:-6px;height:8px;background:radial-gradient(circle at 5px 0,transparent 5px,#FFFFFF 5.5px) 0 0/10px 8px repeat-x;}',
    '.ex-detail .slip .c{text-align:center;font-weight:700;} .ex-detail .slip hr{border:none;border-top:1px dashed #9AA3AF;margin:6px 0;}',
    '.ex-detail .slip .r{display:flex;justify-content:space-between;gap:8px;} .ex-detail .slip .tot{font-weight:800;font-size:12px;}',
    '.ex-detail .ex-cap{font-size:11px;color:var(--muted);text-align:center;margin-top:10px;}',
    '.ex-detail .ex-add-ph{display:flex;align-items:center;justify-content:center;gap:7px;margin-top:10px;border:1.5px dashed var(--border-strong);border-radius:9px;padding:9px 12px;font-size:12.5px;font-weight:700;color:var(--text-2);background:var(--surface-2);cursor:pointer;min-height:40px;}',
    '.ex-detail .ex-add-ph:hover{border-color:var(--brand-strong);color:var(--brand-text);}',
    '.ex-detail .ex-add-ph svg{width:16px;height:16px;}',
    '.ex-rjm .req{color:var(--bad);}',
    '.pg-expenses .ex-table tr.rej .c-amt{text-decoration:line-through;color:var(--muted);}',
    '.ex-tl{display:flex;flex-direction:column;gap:6px;margin-top:12px;font-size:12.5px;}',
    '.ex-tl div{display:flex;gap:8px;align-items:center;} .ex-tl i{width:8px;height:8px;border-radius:50%;background:var(--border-strong);flex-shrink:0;} .ex-tl i.on{background:var(--ok);} .ex-tl i.wait{background:var(--warn);} .ex-tl i.bad{background:var(--bad);}',
    '@media (max-width:1180px){.pg-expenses .ex-top{grid-template-columns:minmax(0,1fr);}}',
    '@media (max-width:760px){',
    ' .ex-detail{grid-template-columns:minmax(0,1fr);} .ex-detail .slip{max-width:260px;margin:0 auto;}',
    ' .pg-expenses .ex-filters .select{flex:1 1 140px;min-width:0;} .pg-expenses .ex-filters .search{flex:1 1 100%;}',
    ' .pg-expenses .ex-filters .chips{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:0 -16px;padding:0 16px;}',
    ' .pg-expenses .ex-table thead{display:none;}',
    ' .pg-expenses .ex-table, .pg-expenses .ex-table tbody, .pg-expenses .ex-table tfoot{display:block;}',
    ' .pg-expenses .ex-table tr{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;padding:12px 14px;border-bottom:1px solid var(--border);}',
    ' .pg-expenses .ex-table td{display:block;border:none;padding:0 !important;background:none !important;}',
    ' .pg-expenses .ex-table td.c-desc{order:1;flex:1 1 calc(100% - 130px);min-width:0;} .pg-expenses .ex-table td.c-amt{order:2;font-size:14px;flex:0 0 120px;text-align:right;}',
    ' .pg-expenses .ex-table td.c-date{order:3;font-size:12px;color:var(--muted);} .pg-expenses .ex-table td.c-prop{order:4;font-size:12px;color:var(--muted);flex:1 1 0;}',
    ' .pg-expenses .ex-table td.c-prop::before{content:"· ";}',
    ' .pg-expenses .ex-table td.c-who{order:5;flex:1 1 100%;}',
    ' .pg-expenses .ex-table td.c-rc{order:6;} .pg-expenses .ex-table td.c-claim{order:7;}',
    ' .pg-expenses .ex-table td.c-acts{order:8;margin-left:auto;} .pg-expenses .ex-table td.c-acts:empty{display:none;}',
    ' .pg-expenses .ex-table td.c-acts .btn{min-height:40px;}',
    ' .pg-expenses .btn, .pg-expenses .chip, .pg-expenses .select, .pg-expenses .input, .pg-expenses .dr-btn, .pg-expenses .seg button{min-height:40px;} .pg-expenses .search{height:40px;} .pg-expenses .switch::before{content:"";position:absolute;inset:-10px -4px;}',
    ' .pg-expenses .hbar.hb-click{min-height:40px;align-items:center;}',
    ' .pg-expenses .ex-who .avatar{display:none;} .pg-expenses .ex-who .b, .pg-expenses .ex-meth{display:inline;font-size:12px;} .pg-expenses .ex-meth::before{content:" · ";}',
    ' .pg-expenses .hbar{grid-template-columns:minmax(96px,130px) 1fr auto;font-size:12px;}',
    ' .pg-expenses .ex-table tr.ex-tot{display:flex;justify-content:space-between;}',
    ' .pg-expenses .ex-desc .s{max-width:none;white-space:normal;}',
    ' .pg-expenses .ex-desc .t{display:flex;flex-wrap:wrap;align-items:center;gap:3px 6px;} .pg-expenses .ex-desc .cc-b{margin-left:0;}',
    ' .pg-expenses .cl-row{flex-wrap:wrap;} .pg-expenses .cl-row .btns{width:100%;} .pg-expenses .cl-row .btns .btn{flex:1;min-height:40px;}',
    '}'
  ].join('\n'));

  /* ------------------------------------------------------------------ helpers */
  /* Staff Access: what this viewer may do here */
  function canAll() { return O.can('expenses.viewAll'); }        /* see everyone's expenses */
  function canApprove() { return O.can('expenses.approve'); }    /* approve claims (account owners) */
  function canRecord() { return O.can('expenses.record'); }
  function owner() { return canApprove(); }                      /* record for someone else, approve, delete any */
  function me() { return O.viewer() || { id: O.state.viewer, name: 'You', role: '' }; }
  function canEditCls(e) { return canApprove() || (canAll() && O.can('expenses', 'edit')) || e.recordedBy === me().id; }
  function range() { if (st.preset) { var p = U.preset(st.preset); return { from: p.from, to: p.to }; } return { from: st.from, to: st.to }; }
  function prevRange(r) { var n = d.diff(r.from, r.to) + 1; return { from: d.add(r.from, -n), to: d.add(r.from, -1) }; }
  function sum(list, f) { return list.reduce(function (s, x) { return s + (f ? f(x) : x.amount); }, 0); }
  /* RM 96, RM 185.50 — cents only when there are cents */
  function money(n) { return fmt.money(n, { dp: Math.abs(n - Math.round(n)) > 0.004 ? 2 : 0 }); }
  /* Wei Ling Tan -> Wei Ling, Siti Aminah -> Siti */
  function firstName(name) { var p = String(name).split(' '); return p.length >= 3 ? p.slice(0, 2).join(' ') : p[0]; }
  /* a rejected claim is not a company expense: it stays in the list but is left out of every total (same rule as Financials) */
  function counts(e) { return !(e.method === CLAIM && e.claimStatus === 'rejected'); }
  var SHORT = { 'Repairs & maintenance': 'Repairs', 'Furniture & equipment': 'Furniture', 'Toiletries & amenities': 'Toiletries', 'Software & subscriptions': 'Software', 'Cleaning supplies': 'Cleaning' };
  function propName(id, short) { if (!id) return 'General / company'; var p = D.propById[id]; return p ? (short ? p.short : p.name) : 'Removed property'; }
  function ccBadge(e) { var c = clsOf(e); return '<span class="cc-b ' + c + '" title="' + esc(CC[c][0]) + '">' + CC[c][1] + '</span>'; }
  function splitText(list) {
    var op = sum(list.filter(function (e) { return clsOf(e) === 'opex'; })), cap = sum(list.filter(function (e) { return clsOf(e) === 'capex'; }));
    return 'operating ' + money(op) + ' · capital ' + money(cap);
  }
  function typeLabel(e) { return e.type === 'Others' ? 'Others: ' + (e.otherType || 'unspecified') : e.type; }
  function isClaim(e) { return e.method === CLAIM; }
  function staff(id) { return D.staffById(id) || { name: 'Former staff', roleLabel: '', id: id }; }
  function visible() { /* what this viewer may see at all */
    var v = me();
    return canAll() ? D.expenses : D.expenses.filter(function (e) { return e.paidBy === v.id || e.recordedBy === v.id; });
  }
  function inRange(list, r) { return list.filter(function (e) { return e.date >= r.from && e.date <= r.to; }); }
  function matchClaim(e, c) {
    if (c === 'all') return true;
    if (c === 'none') return !isClaim(e);
    return isClaim(e) && e.claimStatus === c;
  }
  function filtered(base) {
    var q = st.q.toLowerCase();
    return base.filter(function (e) {
      return (!st.type || e.type === st.type) && (!st.cls || clsOf(e) === st.cls) && (!st.person || e.paidBy === st.person) &&
        (!st.prop || (st.prop === 'general' ? !e.propertyId : e.propertyId === st.prop)) &&
        (!q || [typeLabel(e), e.note || '', propName(e.propertyId), staff(e.paidBy).name, e.id, String(e.amount)].join(' ').toLowerCase().indexOf(q) >= 0);
    });
  }
  function freshDraft() {
    return { date: D.TODAY, amount: '', type: '', otherType: '', costClass: '', ccAuto: true, propertyId: '', paidBy: me().id, method: owner() ? 'Company card' : D.payMethods[0], note: '', img: null, imgName: '' };
  }
  function claimPill(e) {
    if (!isClaim(e)) return '<span class="faint small">Not a claim</span>';
    var p = CLAIM_PILL[e.claimStatus] || CLAIM_PILL.pending; return U.pill(p[0], p[1]);
  }
  function rcHTML(e) {
    if (e.receiptImg) return '<span class="rc ok"><img src="' + e.receiptImg + '" alt="Receipt photo">Photo</span>';
    return e.receipt ? '<span class="rc ok">' + O.icon('check') + 'On file</span>' : '<span class="rc miss">' + O.icon('alert') + 'Missing</span>';
  }

  /* ------------------------------------------------------------------ claim actions (owner only) */
  function setClaim(e, status, quiet) {
    if (!owner()) { U.toast('Only an account owner can approve claims', 'bad'); return; }
    e.claimStatus = status;
    if (status === 'approved') { e.approvedAt = D.TODAY; e.approvedBy = me().id; }
    if (status === 'reimbursed') { e.reimbursedAt = D.TODAY; if (!e.approvedAt) { e.approvedAt = D.TODAY; e.approvedBy = me().id; } }
    if (status === 'rejected') { e.rejectedAt = D.TODAY; e.rejectedBy = me().id; }
    if (!quiet) {
      var who = firstName(staff(e.paidBy).name);
      U.toast(status === 'approved' ? 'Claim approved. ' + who + ' is told on WhatsApp and will be paid back ' + money(e.amount) + '.' :
        status === 'reimbursed' ? 'Marked as paid back to ' + who + '.' : 'Claim rejected. ' + who + ' is told why on WhatsApp.');
      O.emit('data', { type: 'expense' });
    }
  }
  function rejectClaim(e) {
    var body = O.html('<div class="stack ex-rjm"><div class="note">' + esc(staff(e.paidBy).name) + ' · ' + esc(typeLabel(e)) + ' · <b>' + money(e.amount) + '</b> on ' + d.fmtY(e.date) + '</div>' +
      '<div class="field"><label for="ex-rj">Reason (sent to ' + esc(firstName(staff(e.paidBy).name)) + ') <span class="req">*</span></label><textarea class="textarea" id="ex-rj" rows="3" placeholder="e.g. Personal purchase, not for the business">' + (e.receipt ? '' : 'Please add a photo of the receipt and submit again.') + '</textarea><span class="hint">The claim is left out of all totals. It stays in the list as rejected.</span></div></div>');
    U.modal({ title: 'Reject this claim?', body: body, actions: [{ label: 'Cancel' }, { label: 'Reject claim', kind: 'danger', onClick: function () {
      var r = O.$('#ex-rj', body).value.trim();
      if (!r) { U.toast('Add a short reason so ' + firstName(staff(e.paidBy).name) + ' knows why', 'bad'); O.$('#ex-rj', body).focus(); return false; }
      e.rejectReason = r; setClaim(e, 'rejected');
    } }] });
  }

  /* ------------------------------------------------------------------ detail modal */
  function openDetail(e) {
    var p = e.propertyId ? D.propById[e.propertyId] : null, who = staff(e.paidBy);
    var canDelete = owner() || (e.recordedBy === me().id && (!isClaim(e) || e.claimStatus === 'pending'));
    var canPhoto = !e.receipt && (owner() || e.paidBy === me().id || e.recordedBy === me().id);
    var tl = '';
    if (isClaim(e)) {
      tl = '<div class="ex-tl"><div><i class="on"></i>Claim submitted ' + d.fmtY(e.date) + '</div>' +
        (e.claimStatus === 'rejected' ? '<div><i class="bad"></i>Rejected ' + d.fmtY(e.rejectedAt || D.TODAY) + (e.rejectReason ? ': ' + esc(e.rejectReason) : '') + '</div>' :
          '<div><i class="' + (e.approvedAt ? 'on' : 'wait') + '"></i>' + (e.approvedAt ? 'Approved by ' + esc(staff(e.approvedBy).name) + ' on ' + d.fmtY(e.approvedAt) : 'Waiting for an account owner to approve') + '</div>' +
          '<div><i class="' + (e.reimbursedAt ? 'on' : '') + '"></i>' + (e.reimbursedAt ? 'Paid back on ' + d.fmtY(e.reimbursedAt) : 'Paid back to ' + esc(firstName(who.name))) + '</div>') + '</div>';
    }
    var pic = e.receiptImg ? '<div class="ex-photo"><img src="' + e.receiptImg + '" alt="Receipt photo"></div><div class="ex-cap">' + esc(e.receiptName || 'Receipt photo') + '</div>'
      : e.receipt ? '<div class="slip" aria-label="Receipt summary"><div class="c">' + esc(p ? p.area.split(',')[0] : 'Kuala Lumpur') + '</div><div class="c" style="font-weight:400">' + d.fmtDM(e.date) + '/' + e.date.slice(2, 4) + '  ' + ('0' + (e.date === D.TODAY ? 8 + D.hash(e.id) % 2 : 9 + D.hash(e.id) % 9)).slice(-2) + ':' + ('0' + D.hash(e.id + 'm') % 60).slice(-2) + '</div><hr>' +
        '<div class="r"><span>' + esc(typeLabel(e).slice(0, 22)) + '</span></div>' + (e.note ? '<div class="r"><span>' + esc(e.note.slice(0, 28)) + '</span></div>' : '') + '<hr>' +
        '<div class="r tot"><span>TOTAL</span><span>RM ' + e.amount.toFixed(2) + '</span></div><div class="r"><span>' + esc(e.method === 'Company card' ? 'CARD' : e.method.indexOf('Cash') === 0 ? 'CASH' : e.method === 'Bank transfer' ? 'TRANSFER' : 'PAID') + '</span></div></div><div class="ex-cap">Receipt photo on file</div>'
        : '<div class="note warn">No receipt photo yet.' + (canPhoto ? '' : ' Ask ' + esc(firstName(who.name)) + ' to add one.') + '</div>' +
          (canPhoto ? '<label class="photo-btn ex-add-ph" for="ex-add-file">' + O.icon('camera') + 'Add receipt photo</label><input type="file" id="ex-add-file" accept="image/*" capture="environment" class="sr-only">' : '');
    var body = '<div class="ex-detail"><div><dl class="kv">' +
      '<dt>Amount</dt><dd><b>' + fmt.money(e.amount, { dp: 2 }) + '</b></dd><dt>Date</dt><dd>' + d.fmtY(e.date) + '</dd><dt>Type</dt><dd>' + esc(typeLabel(e)) + '</dd>' +
      '<dt>Cost type</dt><dd>' + (canEditCls(e) ? '<div class="ex-ccm">' + U.seg([['opex', 'Operating'], ['capex', 'Capital']], clsOf(e), 'data-ccm') + '</div>' : esc(CC[clsOf(e)][0])) + '</dd>' +
      '<dt>For</dt><dd>' + esc(propName(e.propertyId)) + '</dd><dt>Paid by</dt><dd>' + esc(who.name) + '</dd><dt>Method</dt><dd>' + esc(e.method) + '</dd>' +
      (e.recordedBy && e.recordedBy !== e.paidBy ? '<dt>Recorded by</dt><dd>' + esc(staff(e.recordedBy).name) + '</dd>' : '') +
      '<dt>Reference</dt><dd>' + esc(e.id) + '</dd>' + (e.note ? '<dt>Note</dt><dd style="text-align:right;font-weight:500">' + esc(e.note) + '</dd>' : '') + '</dl>' + tl + '</div><div>' + pic + '</div></div>';
    var acts = [];
    if (canDelete) acts.push({ label: 'Delete', kind: 'ghost', onClick: function (close) { U.confirm('Delete this ' + money(e.amount) + ' expense?', 'Delete', 'danger').then(function (ok) { if (!ok) return; var i = D.expenses.indexOf(e); if (i >= 0) D.expenses.splice(i, 1); U.toast('Expense deleted'); O.emit('data', { type: 'expense' }); }); } });
    if (owner() && isClaim(e) && e.claimStatus === 'pending') {
      acts.push({ label: 'Reject', kind: 'ghost', onClick: function () { setTimeout(function () { rejectClaim(e); }, 0); } });
      acts.push({ label: 'Approve claim', kind: 'primary', onClick: function () { setClaim(e, 'approved'); } });
    } else if (owner() && isClaim(e) && e.claimStatus === 'approved') {
      acts.push({ label: 'Mark as paid back', kind: 'primary', onClick: function () { setClaim(e, 'reimbursed'); } });
    } else acts.push({ label: 'Close', kind: 'primary' });
    U.modal({ title: typeLabel(e) + ' · ' + money(e.amount), sub: propName(e.propertyId) + ' · ' + d.fmtY(e.date), body: body, size: 'wide', actions: acts, autofocus: false,
      onOpen: function (el, close) {
        var ccm = O.$('.ex-ccm', el);
        if (ccm) ccm.addEventListener('click', function (ev) {
          var b = ev.target.closest('[data-ccm]'); if (!b || b.dataset.ccm === clsOf(e)) return;
          e.costClass = b.dataset.ccm;
          O.$$('[data-ccm]', ccm).forEach(function (x) { x.classList.toggle('on', x === b); });
          U.toast(money(e.amount) + ' is now counted as ' + (e.costClass === 'capex' ? 'a capital expense, shown below operating profit in Financials' : 'an operating expense, inside the profit and loss') + '.');
          O.emit('data', { type: 'expense', id: e.id });
        });
        var inp = O.$('#ex-add-file', el); if (!inp) return;
        inp.addEventListener('change', function () {
          var file = inp.files && inp.files[0]; if (!file) return;
          if (!/^image\//.test(file.type)) { U.toast('Choose a photo (JPG, PNG or HEIC)', 'bad'); return; }
          var rd = new FileReader();
          rd.onload = function () {
            e.receipt = true; e.receiptImg = rd.result; e.receiptName = file.name + ' · ' + Math.max(1, Math.round(file.size / 1024)) + ' KB';
            close(); U.toast('Receipt photo added to ' + e.id); O.emit('data', { type: 'expense', id: e.id }); openDetail(e);
          };
          rd.readAsDataURL(file);
        });
      } });
  }

  /* ------------------------------------------------------------------ form */
  function ccField(f, er) {
    var sug = f.type ? suggestCls(f.type) : null;
    var sugTag = f.costClass && f.ccAuto && sug === f.costClass ? '<span class="sug">Suggested from the type</span>' : '';
    return '<div class="field' + (er.costClass ? ' is-bad' : '') + '"><span class="label ex-cc-lab" id="ex-cc-l">Cost type <span class="req">*</span>' + sugTag + '</span>' +
      '<div class="ex-cc" role="radiogroup" aria-labelledby="ex-cc-l">' + ['opex', 'capex'].map(function (k) {
        var on = f.costClass === k;
        return '<label class="' + (on ? 'on' : '') + '"><input type="radio" name="ex-cc" value="' + k + '"' + (on ? ' checked' : '') + '><span class="cc-full">' + CC[k][0] + '</span><span class="cc-short">' + CC[k][1] + '</span></label>';
      }).join('') + '</div>' + (er.costClass ? '<div class="ex-err" role="alert">' + esc(er.costClass) + '</div>' : '') +
      '<div class="ex-cc-help">' + CC_HELP + '</div></div>';
  }
  function formCard() {
    var f = st.draft, er = st.err, isOwner = owner(), claim = f.method === CLAIM;
    var payer = staff(f.paidBy);
    function errHTML(k) { return er[k] ? '<div class="ex-err" role="alert">' + esc(er[k]) + '</div>' : ''; }
    if (!canRecord()) return '<div class="card"><div class="card-body ex-norec">' + O.icon('lock') + '<div><b>Recording expenses is not part of your access.</b><div class="small muted">You can look through the expenses here. An account owner can change this in Staff Access.</div></div></div></div>';
    return '<form class="card ex-form" novalidate autocomplete="off"><div class="card-head"><div><h3>' + O.icon('plus') + 'Record an expense</h3><div class="sub">Everyone records what they spend. It shows up in Financials straight away.</div></div></div><div class="card-body">' +
      '<div class="form-grid"><div class="field' + (er.date ? ' is-bad' : '') + '"><label for="ex-date">Date <span class="req">*</span></label><input class="input" type="date" id="ex-date" data-d="date" value="' + esc(f.date) + '" max="' + D.TODAY + '">' + errHTML('date') + '</div>' +
      '<div class="field"><label for="ex-amt">Amount <span class="req">*</span></label><div class="money-in' + (er.amount ? ' is-bad' : '') + '"><span>RM</span><input class="input" id="ex-amt" data-d="amount" inputmode="decimal" placeholder="0.00" value="' + esc(f.amount) + '"></div>' + errHTML('amount') + '</div></div>' +
      '<div class="field' + (er.type ? ' is-bad' : '') + '"><label for="ex-type">Expense type <span class="req">*</span></label><select class="select" id="ex-type" data-d="type"><option value="">Choose a type…</option>' +
      D.expenseTypes.map(function (t) { return '<option' + (f.type === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select>' + errHTML('type') + '</div>' +
      (f.type === 'Others' ? '<div class="field ex-other' + (er.otherType ? ' is-bad' : '') + '"><label for="ex-other">What was it for? <span class="req">*</span></label><input class="input" id="ex-other" data-d="otherType" maxlength="60" placeholder="e.g. Pest control, Key cutting, Parking fine" value="' + esc(f.otherType) + '">' + errHTML('otherType') + '</div>' : '') +
      ccField(f, er) +
      '<div class="form-grid"><div class="field"><label for="ex-prop">Property</label><select class="select" id="ex-prop" data-d="propertyId"><option value="">General / company</option>' + D.properties.map(function (p) { return '<option value="' + p.id + '"' + (f.propertyId === p.id ? ' selected' : '') + '>' + esc(p.short) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="ex-who">Paid by</label><select class="select" id="ex-who" data-d="paidBy"' + (isOwner ? '' : ' disabled title="Only an account owner can record for someone else"') + '>' + D.staff.map(function (s) { return '<option value="' + s.id + '"' + (f.paidBy === s.id ? ' selected' : '') + '>' + esc(s.name) + (s.id === me().id ? ' (you)' : '') + '</option>'; }).join('') + '</select>' +
      (isOwner ? '' : '<span class="hint">Only an account owner can record for someone else.</span>') + '</div></div>' +
      '<div class="field"><label for="ex-method">Payment method</label><select class="select" id="ex-method" data-d="method">' + D.payMethods.map(function (m) { return '<option' + (f.method === m ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select></div>' +
      (claim ? '<div class="note warn">' + (payer && payer.role === 'owner' ? 'Recorded by an account owner, so this claim is approved straight away.' : 'This creates a claim for ' + esc(firstName(payer.name)) + '. An account owner is asked to approve it, then the money is paid back.') + '</div>' : '') +
      '<div class="field"><span class="label" id="ex-ph-l">Receipt photo</span><div class="photo">' +
      (f.img ? '<div class="thumb"><img src="' + f.img + '" alt="Receipt photo preview"><button type="button" class="thumb-x" data-act="rmimg" aria-label="Remove photo">×</button></div><div class="small muted" style="min-width:0;overflow-wrap:anywhere">' + esc(f.imgName) + '</div>' :
        '<label class="photo-btn" for="ex-file">' + O.icon('camera') + 'Take or upload photo</label><span class="small muted">' + (claim ? 'Recommended for claims' : 'Optional, recommended') + '</span>') +
      '<input type="file" id="ex-file" accept="image/*" capture="environment" aria-labelledby="ex-ph-l"></div></div>' +
      '<div class="field"><label for="ex-note">Note</label><textarea class="textarea" id="ex-note" data-d="note" rows="2" placeholder="What, where, which booking">' + esc(f.note) + '</textarea></div>' +
      '<div class="ex-actions"><button type="submit" class="btn btn-primary">' + O.icon('check') + 'Save expense</button><button type="button" class="btn btn-ghost" data-act="reset">Clear</button></div>' +
      '</div></form>';
  }
  function saveDraft(ctx) {
    var f = st.draft, er = {};
    var amt = parseFloat(String(f.amount).replace(/[^0-9.]/g, ''));
    if (!f.date) er.date = 'Choose the date you paid.'; else if (f.date > D.TODAY) er.date = 'The date cannot be in the future.';
    if (!amt || amt <= 0) er.amount = 'Enter the amount paid.'; else if (amt > 100000) er.amount = 'That looks too large. Check the amount.';
    if (!f.type) er.type = 'Choose an expense type.';
    if (f.type === 'Others' && !f.otherType.trim()) er.otherType = 'Say what it was for.';
    if (f.costClass !== 'opex' && f.costClass !== 'capex') er.costClass = 'Choose whether this is an operating or a capital expense.';
    st.err = er;
    if (!canRecord()) { U.toast('Your access does not include recording expenses', 'bad'); return; }
    if (Object.keys(er).length) { ctx.rerender(); var first = O.$('.pg-expenses .is-bad input, .pg-expenses .is-bad select, .pg-expenses .is-bad .input'); if (first) first.focus(); return; }
    var v = me(), payer = staff(owner() ? f.paidBy : v.id);
    var e = { id: O.uid('EX'), date: f.date, propertyId: f.propertyId || null, type: f.type, costClass: f.costClass, amount: Math.round(amt * 100) / 100, paidBy: payer.id, method: f.method,
      receipt: !!f.img, receiptImg: f.img || null, receiptName: f.imgName || '', note: f.note.trim(), recordedBy: v.id, createdAt: D.NOW };
    if (f.type === 'Others') e.otherType = f.otherType.trim();
    var msg = 'Saved ' + money(e.amount) + ' (' + typeLabel(e) + ', ' + propName(e.propertyId, true) + ', ' + CC[e.costClass][0].toLowerCase() + ').';
    if (isClaim(e)) {
      var own = D.staff.filter(function (s) { return s.role === 'owner'; })[0];
      if (payer.role === 'owner') { e.claimStatus = 'approved'; e.approvedAt = D.TODAY; e.approvedBy = payer.id; msg += ' Claim approved.'; }
      else { e.claimStatus = 'pending'; msg += ' Claim sent to ' + (own ? own.name : 'the account owner') + ' for approval.'; }
    }
    D.expenses.unshift(e);
    st.lastId = e.id;
    var r = range();
    if (e.date < r.from || e.date > r.to) { st.preset = 'last90'; if (e.date < U.preset('last90').from) st.preset = 'since'; }
    st.draft = Object.assign(freshDraft(), { date: f.date, paidBy: f.paidBy, method: f.method === CLAIM ? CLAIM : f.method });
    st.err = {};
    U.toast(msg);
    O.emit('data', { type: 'expense', id: e.id });
  }

  /* ------------------------------------------------------------------ side panels */
  function claimsCard() {
    var all = visible().filter(isClaim);
    if (!canApprove()) { var mid = me().id; all = all.filter(function (e) { return e.paidBy === mid; }); }
    var pend = all.filter(function (e) { return e.claimStatus === 'pending'; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var appr = all.filter(function (e) { return e.claimStatus === 'approved'; });
    if (canApprove()) {
      var rowsH = pend.map(function (e) {
        var w = staff(e.paidBy);
        return '<div class="cl-row click" data-eid="' + e.id + '" title="Open to see the receipt">' + U.avatar(w.name, 'sm') + '<div class="main"><div class="t">' + esc(w.name) + ' · ' + esc(typeLabel(e)) + '</div><div class="s">' + d.fmt(e.date) + ' · ' + esc(propName(e.propertyId, true)) + (e.receipt ? ' · receipt attached' : ' · no receipt') + (e.note ? ' · ' + esc(e.note) : '') + '</div></div>' +
          '<span class="amt">' + money(e.amount) + '</span><div class="btns"><button type="button" class="btn btn-ghost btn-sm" data-act="reject">Reject</button><button type="button" class="btn btn-primary btn-sm" data-act="approve">Approve</button></div></div>';
      }).join('');
      return '<div class="card"><div class="card-head"><div><h3>Claims waiting for your approval' + (pend.length ? '<span class="cl-head-count">' + pend.length + '</span>' : '') + '</h3><div class="sub">' +
        (pend.length ? money(sum(pend)) + ' paid personally by staff' : 'Nothing to approve') + (appr.length ? ' · ' + money(sum(appr)) + ' approved, still to pay back' : '') + '</div></div>' +
        '<div class="row-flex wrap">' + (appr.length ? '<button type="button" class="btn btn-ghost btn-sm" data-act="payall">Mark ' + appr.length + ' as paid back</button>' : '') + (pend.length > 1 ? '<button type="button" class="btn btn-primary btn-sm" data-act="approveall">Approve all</button>' : '') + '</div></div>' +
        (pend.length ? '<div>' + rowsH + '</div>' : '<div class="card-body">' + U.empty(all.length ? 'All claims are approved. New claims from staff appear here.' : 'No claims yet. When staff pay with their own money, their claims appear here.', '✓') + '</div>') + '</div>';
    }
    var mine = all.filter(function (e) { return e.claimStatus !== 'reimbursed'; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return '<div class="card"><div class="card-head"><div><h3>Your claims</h3><div class="sub">' + (mine.length ? money(sum(mine.filter(function (e) { return e.claimStatus !== 'rejected'; }))) + ' waiting to be paid back to you' : 'Nothing waiting') + '</div></div></div>' +
      (mine.length ? '<div>' + mine.map(function (e) {
        return '<div class="cl-row click" data-eid="' + e.id + '" data-act="open"><div class="main"><div class="t">' + esc(typeLabel(e)) + '</div><div class="s">' + d.fmt(e.date) + ' · ' + esc(propName(e.propertyId, true)) + '</div></div><span class="amt">' + money(e.amount) + '</span>' + claimPill(e) + '</div>';
      }).join('') + '</div>' : '<div class="card-body">' + U.empty('You have no open claims. Choose "Paid personally (claim)" when you pay with your own money.', '✓') + '</div>') +
      '<div class="card-foot">Claims are approved by the account owner. You get a WhatsApp message when yours is approved or paid back.</div></div>';
  }
  function breakdownCards(list, plist) {
    var total = sum(list) || 1;
    var types = {}; list.forEach(function (e) { var k = e.type; types[k] = (types[k] || 0) + e.amount; });
    var tRows = Object.keys(types).sort(function (a, b) { return types[b] - types[a]; }).map(function (k) {
      return { label: '<span class="hb-click-l">' + esc(k) + '</span>', value: types[k], display: money(types[k]) + ' <span class="hb-sub">' + fmt.pct(types[k] / total) + '</span>', k: k };
    });
    var typeHTML = tRows.length ? O.chart.hbars(tRows).split('<div class="hbar">').map(function (h, i) { return i ? '<div class="hbar hb-click' + (st.type === tRows[i - 1].k ? ' on' : '') + '" data-ftype="' + esc(tRows[i - 1].k) + '" role="button" tabindex="0">' + h : h; }).join('') : U.empty('No expenses in this range.');
    var card1 = '<div class="card"><div class="card-head"><div><h3>By type</h3><div class="sub">' + money(sum(list)) + ' · ' + splitText(list) + '</div></div></div><div class="card-body" style="padding-top:8px;padding-bottom:8px">' + typeHTML + '</div></div>';
    if (!canAll()) return card1;
    var people = D.staff.map(function (s) { var l = plist.filter(function (e) { return e.paidBy === s.id; }); return { s: s, total: sum(l), n: l.length }; }).sort(function (a, b) { return b.total - a.total; });
    var max = Math.max.apply(null, people.map(function (p) { return p.total; }).concat([1]));
    var pHTML = O.chart.hbars(people.map(function (p) {
      return { label: U.avatar(p.s.name, 'sm') + '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.s.name) + (p.s.role === 'owner' ? ' <span class="hb-sub">owner</span>' : '') + '</span>', value: p.total, display: money(p.total) + ' <span class="hb-sub">· ' + p.n + '</span>' };
    }), { max: max }).split('<div class="hbar">').map(function (h, i) { return i ? '<div class="hbar hb-click' + (st.person === people[i - 1].s.id ? ' on' : '') + '" data-fperson="' + people[i - 1].s.id + '" role="button" tabindex="0">' + h : h; }).join('');
    var card2 = '<div class="card"><div class="card-head"><div><h3>By person</h3><div class="sub">Everyone who paid, including the owner · click to filter</div></div></div><div class="card-body" style="padding-top:8px;padding-bottom:8px">' + pHTML + '</div></div>';
    return '<div class="grid g2">' + card1 + card2 + '</div>';
  }

  /* ------------------------------------------------------------------ list */
  function listCard(baseR, list) {
    var r = range(), all = canAll(), appr = canApprove();
    var chips = CLAIMS.map(function (c) {
      var n = baseR.filter(function (e) { return matchClaim(e, c[0]); }).length;
      return '<button type="button" class="chip' + (st.claim === c[0] ? ' on' : '') + '" data-claim="' + c[0] + '" aria-pressed="' + (st.claim === c[0]) + '">' + esc(c[1]) + ' <span class="n">' + n + '</span></button>';
    }).join('');
    var shown = list.slice(0, st.limit);
    var head = '<div class="card-head"><div><h3>' + (all ? 'All expenses' : 'Your expenses') + '</h3><div class="sub">' + fmt.plural(list.length, 'expense') + ' · ' + money(sum(list.filter(counts))) + ' · ' + esc(U.rangeLabel(r.from, r.to)) + (list.length && !st.cls ? '<span class="ex-split"> · ' + splitText(list.filter(counts)) + '</span>' : '') + '</div></div>' +
      '<div class="row-flex wrap">' + (anyFilter() ? '<button type="button" class="btn btn-quiet btn-sm" data-act="clear">Clear filters</button>' : '') + '<button type="button" class="btn btn-ghost btn-sm" data-act="csv"' + (list.length ? '' : ' disabled title="Nothing to export"') + '>' + O.icon('download') + 'Export CSV</button></div></div>';
    var filters = '<div class="ex-filters"><div class="toolbar"><span data-slot="range"></span>' +
      '<label class="sr-only" for="ex-ft">Type</label><select class="select" id="ex-ft" data-f="type"><option value="">All types</option>' + D.expenseTypes.map(function (t) { return '<option' + (st.type === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select>' +
      '<label class="sr-only" for="ex-fc">Cost type</label><select class="select" id="ex-fc" data-f="cls"><option value="">All cost types</option>' + ['opex', 'capex'].map(function (k) { return '<option value="' + k + '"' + (st.cls === k ? ' selected' : '') + '>' + CC[k][1] + ' only</option>'; }).join('') + '</select>' +
      (all ? '<label class="sr-only" for="ex-fp">Person</label><select class="select" id="ex-fp" data-f="person"><option value="">Everyone</option>' + D.staff.map(function (s) { return '<option value="' + s.id + '"' + (st.person === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select>' : '') +
      '<label class="sr-only" for="ex-fpr">Property</label><select class="select" id="ex-fpr" data-f="prop"><option value="">All properties</option><option value="general"' + (st.prop === 'general' ? ' selected' : '') + '>General / company</option>' + D.properties.map(function (p) { return '<option value="' + p.id + '"' + (st.prop === p.id ? ' selected' : '') + '>' + esc(p.short) + '</option>'; }).join('') + '</select>' +
      '<div class="search">' + O.icon('search') + '<label class="sr-only" for="ex-q">Search expenses</label><input id="ex-q" type="search" placeholder="Search notes, types, people" value="' + esc(st.q) + '"></div></div>' +
      '<div class="chips" role="group" aria-label="Claim status">' + chips + '</div>' +
      (all ? '' : '<div class="scope-note small muted">' + O.icon('lock') + 'You see only the expenses you paid or recorded. People with full expense access see everyone’s.</div>') + '</div>';
    var table = list.length ? '<div class="table-wrap"><table class="table ex-table"><thead><tr><th>Date</th><th>Expense</th><th>Property</th><th>Paid by</th><th>Receipt</th><th>Claim</th><th class="num">Amount</th>' + (appr ? '<th><span class="sr-only">Actions</span></th>' : '') + '</tr></thead><tbody>' +
      shown.map(function (e) {
        var w = staff(e.paidBy);
        return '<tr class="click' + (e.id === st.lastId ? ' new' : '') + (counts(e) ? '' : ' rej') + '" data-eid="' + e.id + '">' +
          '<td class="c-date nowrap">' + d.fmt(e.date) + '</td>' +
          '<td class="c-desc ex-desc"><div class="t">' + esc(typeLabel(e)) + ccBadge(e) + (e.id === st.lastId ? ' ' + U.pill('Just added', 'brand') : '') + '</div>' + (e.note ? '<div class="s">' + esc(e.note) + '</div>' : '') + '</td>' +
          '<td class="c-prop nowrap">' + esc(propName(e.propertyId, true)) + '</td>' +
          '<td class="c-who"><span class="ex-who">' + U.avatar(w.name, 'sm') + '<span><span class="b">' + esc(w.name) + '</span><span class="ex-meth">' + esc(e.method) + '</span></span></span></td>' +
          '<td class="c-rc">' + rcHTML(e) + '</td>' +
          '<td class="c-claim">' + claimPill(e) + '</td>' +
          '<td class="c-amt num b nowrap">' + money(e.amount) + '</td>' +
          (appr ? '<td class="c-acts nowrap">' + (isClaim(e) && e.claimStatus === 'pending' ? '<button type="button" class="btn btn-primary btn-xs" data-act="approve">Approve</button>' : isClaim(e) && e.claimStatus === 'approved' ? '<button type="button" class="btn btn-ghost btn-xs" data-act="paid">Mark paid back</button>' : '') + '</td>' : '') + '</tr>';
      }).join('') + '</tbody><tfoot><tr class="ex-tot"><td colspan="6">Total of ' + fmt.plural(list.filter(counts).length, 'expense') + (list.some(function (e) { return !counts(e); }) ? '<span class="small muted" style="font-weight:500"> · rejected claims not counted</span>' : '') + (st.cls ? '' : '<span class="ex-split">' + splitText(list.filter(counts)) + '</span>') + '</td><td class="num nowrap">' + money(sum(list.filter(counts))) + '</td>' + (appr ? '<td></td>' : '') + '</tr></tfoot></table></div>' +
      (list.length > shown.length ? '<div class="ex-more"><button type="button" class="btn btn-ghost btn-sm" data-act="more">Show ' + Math.min(30, list.length - shown.length) + ' more · ' + (list.length - shown.length) + ' hidden</button></div>' : '')
      : emptyHTML(baseR, all);
    return '<div class="card ex-list">' + head + filters + table + '</div>';
  }
  function anyFilter() { return !!(st.type || st.cls || st.person || st.prop || st.q || st.claim !== 'all'); }
  /* one sentence plus the main action */
  function emptyHTML(baseR, all) {
    var anyAtAll = visible().length > 0, msg, btn;
    if (baseR.length || anyFilter()) { msg = 'No expenses match these filters.'; btn = '<button type="button" class="btn btn-ghost" data-act="clear">Clear filters</button>'; }
    else if (anyAtAll) { msg = all ? 'No expenses were recorded in this range.' : 'You have not recorded any expenses in this range.'; btn = '<button type="button" class="btn btn-ghost" data-act="alldates">Show all dates</button>'; }
    else { msg = all ? 'No expenses recorded yet.' : 'You have not recorded any expenses yet.'; btn = canRecord() ? '<button type="button" class="btn btn-primary" data-act="focusform">' + O.icon('plus') + 'Record an expense</button>' : ''; }
    return '<div class="ex-empty">' + U.empty(msg, '🧾') + btn + '</div>';
  }
  function exportCSV(list) {
    var r = range();
    if (!list.length) { U.toast('Nothing to export for these filters'); return; }
    var out = [['Reference', 'Date', 'Type', 'Details', 'Cost type', 'Property', 'Paid by', 'Method', 'Receipt', 'Claim status', 'Note', 'Amount (RM)']];
    list.forEach(function (e) {
      out.push([e.id, e.date, e.type, e.type === 'Others' ? e.otherType || '' : '', CC[clsOf(e)][1], propName(e.propertyId), staff(e.paidBy).name, e.method, e.receipt ? 'Yes' : 'No',
        isClaim(e) ? (CLAIM_PILL[e.claimStatus] || CLAIM_PILL.pending)[0] : 'Not a claim', e.note || '', e.amount.toFixed(2)]);
    });
    var ok = list.filter(counts);
    out.push(['', '', '', '', 'Operating', '', '', '', '', '', 'Operating total', sum(ok.filter(function (e) { return clsOf(e) === 'opex'; })).toFixed(2)]);
    out.push(['', '', '', '', 'Capital', '', '', '', '', '', 'Capital total', sum(ok.filter(function (e) { return clsOf(e) === 'capex'; })).toFixed(2)]);
    out.push(['', '', '', '', '', '', '', '', '', '', 'Total (rejected claims not counted)', sum(ok).toFixed(2)]);
    O.downloadCSV('Expenses-' + r.from + '-to-' + r.to + '.csv', out);
  }

  /* ------------------------------------------------------------------ page */
  O.page('expenses', {
    desc: 'Record what you spend, attach the receipt, and claim back money you paid yourself',
    render: function (root, ctx) {
      var v = me();
      if (!st.draft || st.viewer !== v.id) { st.draft = freshDraft(); st.err = {}; st.viewer = v.id; }
      if (!canAll()) st.person = '';
      if (!owner()) st.draft.paidBy = v.id;
      if (st.prop && st.prop !== 'general' && !D.propById[st.prop]) st.prop = '';
      if (ctx.fresh && ctx.params) {
        if (ctx.params.person && canAll()) st.person = ctx.params.person;
        if (ctx.params.cls === 'opex' || ctx.params.cls === 'capex') st.cls = ctx.params.cls;
        if (ctx.params.claim) st.claim = ctx.params.claim;
        if (ctx.params.preset) st.preset = ctx.params.preset;
        if (ctx.params.from && ctx.params.to) { st.preset = null; st.from = ctx.params.from; st.to = ctx.params.to; }
      }
      var r = range(), pr = prevRange(r), vis = visible();
      var inR = inRange(vis, r), prevL = inRange(vis, pr);
      var baseR = filtered(inR);
      var list = baseR.filter(function (e) { return matchClaim(e, st.claim); }).sort(function (a, b) { return a.date !== b.date ? (a.date < b.date ? 1 : -1) : String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(b.id).localeCompare(String(a.id), undefined, { numeric: true }); });
      var claimsOf = canApprove() || !canAll() ? vis : vis.filter(function (e) { return e.paidBy === v.id; });
      var pendAll = claimsOf.filter(function (e) { return isClaim(e) && e.claimStatus === 'pending'; });
      var apprAll = claimsOf.filter(function (e) { return isClaim(e) && e.claimStatus === 'approved'; });
      /* opex / capex for the range: the shared metrics when this viewer sees everything, else their own records (same rules) */
      function part(from, to, cls) { return canAll() ? M.expenses(from, to, cls) : inRange(vis, { from: from, to: to }).filter(function (e) { return counts(e) && clsOf(e) === cls; }); }
      var opL = part(r.from, r.to, 'opex'), capL = part(r.from, r.to, 'capex');
      var opex = sum(opL), capex = sum(capL), prevOpex = sum(part(pr.from, pr.to, 'opex')), nDays = d.diff(r.from, r.to) + 1;
      var inRc = inR.filter(counts), noRc = inRc.filter(function (e) { return !e.receipt; });
      var pendLabel = canApprove() ? 'Claims to approve' : 'Your claims pending';

      ctx.setActions('<button type="button" class="btn btn-ghost" data-top="csv"' + (list.length ? '' : ' disabled title="Nothing to export"') + '>' + O.icon('download') + 'Export CSV</button>' + (canRecord() ? '<button type="button" class="btn btn-primary" data-top="new">' + O.icon('plus') + 'Record expense</button>' : ''));
      root.innerHTML = '<div class="pg-expenses">' + U.kpis([
        { label: canAll() ? 'Operating costs' : 'Your operating costs', value: money(opex), delta: fmt.change(opex, prevOpex), deltaOpts: { invert: true }, sub: '<span class="lg">vs prior ' + fmt.plural(nDays, 'day') + '</span><span class="sm">vs prior ' + nDays + 'd</span>', title: 'Running costs of the month, counted in profit. Compared with ' + U.rangeLabel(pr.from, pr.to) + ': ' + money(prevOpex), hl: true },
        { label: canAll() ? 'Capital spending' : 'Your capital spending', value: money(capex), sub: capL.length ? fmt.plural(capL.length, 'purchase') + '<span class="lg"> · kept out of profit</span>' : 'None in range', title: 'Long-lasting purchases for a property, shown below operating profit in Financials' },
        { label: pendLabel, value: money(sum(pendAll)), sub: pendAll.length ? fmt.plural(pendAll.length, 'claim') + ' waiting' + (apprAll.length ? '<span class="lg"> · ' + money(sum(apprAll)) + ' to pay back</span>' : '') : apprAll.length ? money(sum(apprAll)) + ' approved, to pay back' : 'Nothing waiting', title: 'Approved claims not yet paid back: ' + money(sum(apprAll)) },
        { label: 'Receipts missing', value: fmt.num(noRc.length), sub: noRc.length ? money(sum(noRc)) + ' in total' : 'All have receipts' }
      ]) +
        '<div class="ex-top">' + formCard() + '<div class="ex-side">' + claimsCard() + breakdownCards(filtered(inRc), (function () { var keep = st.person; st.person = ''; var x = filtered(inRc); st.person = keep; return x; })()) + '</div></div>' +
        listCard(baseR, list) + '</div>';

      U.mount(root, 'range', U.dateRange({
        preset: st.preset, from: st.from, to: st.to, presets: PRESETS,
        onChange: function (x) { st.preset = x.preset; st.from = x.from; st.to = x.to; st.limit = 50; ctx.rerender(); }
      }));

      /* arriving from Financials (a person) or a claims link: show the filtered list, not the form */
      if (ctx.fresh && ctx.params && (ctx.params.person || ctx.params.claim)) setTimeout(function () { var l = O.$('.pg-expenses .ex-list'); if (l) l.scrollIntoView({ block: 'start' }); }, 60);
      ctx.actionsEl.onclick = function (e) {
        var x = e.target.closest('[data-top]'); if (!x) return;
        if (x.dataset.top === 'csv') exportCSV(list);
        if (x.dataset.top === 'new') focusForm(root);
      };

      var page = O.$('.pg-expenses', root), form = O.$('.ex-form', root);
      if (form) bindForm(form, ctx);
      page.addEventListener('click', function (e) {
        var t = e.target;
        var ch = t.closest('[data-claim]'); if (ch) { st.claim = ch.dataset.claim; st.limit = 50; ctx.rerender(); return; }
        var ft = t.closest('[data-ftype]'); if (ft) { st.type = st.type === ft.dataset.ftype ? '' : ft.dataset.ftype; ctx.rerender(); return; }
        var fp = t.closest('[data-fperson]'); if (fp) { st.person = st.person === fp.dataset.fperson ? '' : fp.dataset.fperson; ctx.rerender(); return; }
        var a = t.closest('[data-act]');
        var host = t.closest('[data-eid]'), ex = host ? D.expenses.filter(function (x) { return x.id === host.dataset.eid; })[0] : null;
        if (a) {
          var act = a.dataset.act;
          if (act === 'reset') { st.draft = freshDraft(); st.err = {}; ctx.rerender(); }
          else if (act === 'rmimg') { st.draft.img = null; st.draft.imgName = ''; ctx.rerender(); }
          else if (act === 'approve' && ex) setClaim(ex, 'approved');
          else if (act === 'reject' && ex) rejectClaim(ex);
          else if (act === 'paid' && ex) setClaim(ex, 'reimbursed');
          else if (act === 'open' && ex) openDetail(ex);
          else if (act === 'approveall') {
            var pend = visible().filter(function (x) { return isClaim(x) && x.claimStatus === 'pending'; });
            U.confirm('Approve ' + fmt.plural(pend.length, 'claim') + ' worth ' + money(sum(pend)) + '?', 'Approve all').then(function (ok) {
              if (!ok) return; pend.forEach(function (x) { setClaim(x, 'approved', true); });
              U.toast('Approved ' + fmt.plural(pend.length, 'claim') + '. Each person is told on WhatsApp.'); O.emit('data', { type: 'expense' });
            });
          } else if (act === 'payall') {
            var ap = visible().filter(function (x) { return isClaim(x) && x.claimStatus === 'approved'; });
            U.confirm('Mark ' + fmt.plural(ap.length, 'claim') + ' (' + money(sum(ap)) + ') as paid back?', 'Mark paid back').then(function (ok) {
              if (!ok) return; ap.forEach(function (x) { setClaim(x, 'reimbursed', true); });
              U.toast(fmt.plural(ap.length, 'claim') + ' marked as paid back'); O.emit('data', { type: 'expense' });
            });
          }
          else if (act === 'csv') exportCSV(list);
          else if (act === 'clear') { st.type = ''; st.cls = ''; st.person = ''; st.prop = ''; st.q = ''; st.claim = 'all'; ctx.rerender(); }
          else if (act === 'alldates') { st.preset = 'since'; st.limit = 50; ctx.rerender(); }
          else if (act === 'focusform') focusForm(root);
          else if (act === 'more') { st.limit += 30; ctx.rerender(); }
          return;
        }
        if (ex && host.matches('tr.click, .cl-row.click')) openDetail(ex);
      });
      page.addEventListener('keydown', function (e) {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-ftype],[data-fperson]')) { e.preventDefault(); e.target.click(); }
      });
      page.addEventListener('change', function (e) { var t = e.target; if (t.dataset.f) { st[t.dataset.f] = t.value; st.limit = 50; ctx.rerender(); } });
      var qIn = O.$('#ex-q', root), qt;
      qIn.addEventListener('input', function () {
        clearTimeout(qt);
        qt = setTimeout(function () { st.q = qIn.value.trim(); var pos = qIn.selectionStart; ctx.rerender(); var n = O.$('#ex-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) {} } }, 220);
      });
    }
  });

  function focusForm(root) {
    var f = O.$('.ex-form', root); if (!f) return;
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function () { var a = O.$('#ex-amt'); if (a) a.focus({ preventScroll: true }); }, 250);
  }
  function bindForm(form, ctx) {
      form.addEventListener('submit', function (e) { e.preventDefault(); saveDraft(ctx); });
      form.addEventListener('input', function (e) { var k = e.target.dataset.d; if (k) { st.draft[k] = e.target.value; if (st.err[k]) { delete st.err[k]; e.target.closest('.field').classList.remove('is-bad'); var m = O.$('.ex-err', e.target.closest('.field')); if (m) m.remove(); var mi = e.target.closest('.money-in'); if (mi) mi.classList.remove('is-bad'); } } });
      form.addEventListener('change', function (e) {
        var t = e.target, k = t.dataset.d;
        if (t.name === 'ex-cc') { st.draft.costClass = t.value; st.draft.ccAuto = false; delete st.err.costClass; ctx.rerender(); var c = O.$('.ex-cc input[value="' + t.value + '"]'); if (c) c.focus(); return; }
        if (k === 'type' || k === 'method' || k === 'paidBy') {
          st.draft[k] = t.value;
          if (k === 'type') { delete st.err.type; if (st.draft.ccAuto) { st.draft.costClass = t.value ? suggestCls(t.value) : ''; if (t.value) delete st.err.costClass; } }
          ctx.rerender(); var n = O.$('#' + t.id); if (n) n.focus(); if (k === 'type' && t.value === 'Others') { var o = O.$('#ex-other'); if (o) o.focus(); } return; }
        if (t.id === 'ex-file' && t.files && t.files[0]) {
          var file = t.files[0];
          if (!/^image\//.test(file.type)) { U.toast('Choose a photo (JPG, PNG or HEIC)', 'bad'); return; }
          var rd = new FileReader();
          rd.onload = function () { st.draft.img = rd.result; st.draft.imgName = file.name + ' · ' + Math.max(1, Math.round(file.size / 1024)) + ' KB'; ctx.rerender(); };
          rd.readAsDataURL(file);
        }
      });
  }
})();
