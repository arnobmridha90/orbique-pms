/* Orbique Command Center v3 — Invoices & receipts
   One invoice per booking (created when the booking is confirmed), one payment receipt (created when payment arrives).
   Both are generated from booking + guest details by O.invoice (core.js) and carry the workspace logo and colours.
   This page: rule line, KPI strip, filters (invoice date range, status, platform, property, search), the document table
   with view / PDF / send / record payment, bulk send with a channel per guest, CSV export, settings, preview and send log. */
(function () {
  var O = window.O, D = O.data, M = O.metrics, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;

  /* ---- shared money setup (identical block in invoices.js, expenses.js, financials.js; runs once) ---- */
  var CLAIM = 'Paid personally (claim)';
  (function moneyInit() {
    if (D._moneyReady) return; D._moneyReady = true;
    D.expenses.forEach(function (e) {
      if (e.method !== CLAIM || e.claimStatus) return;
      var age = d.diff(e.date, D.TODAY);
      if (age <= 10) e.claimStatus = 'pending';
      else if (age <= 18) { e.claimStatus = 'approved'; e.approvedAt = d.add(e.date, 2); e.approvedBy = 's1'; }
      else { e.claimStatus = 'reimbursed'; e.approvedAt = d.add(e.date, 2); e.approvedBy = 's1'; e.reimbursedAt = d.add(e.date, 6); }
    });
    D.invoiceSettings = D.invoiceSettings || {
      autoInvoice: 'auto', autoReceipt: 'auto', invPattern: 'INV-{YYYY}-{seq}', rcpPattern: 'RCP-{YYYY}-{seq}',
      tourismTax: true, sst: false, sstNo: '', sstRate: 8, dueDays: 7
    };
  })();

  var S = D.invoiceSettings;
  var st = { preset: 'last30', from: null, to: null, status: 'all', plat: '', prop: '', q: '', sel: {}, limit: 25, preview: 'invoice' };
  var STATUSES = [['all', 'All'], ['notsent', 'Invoice not sent'], ['sent', 'Invoice sent'], ['awaiting', 'Awaiting payment'], ['paid', 'Paid'], ['rcpnotsent', 'Receipt not sent']];
  var PRESETS = ['today', 'yesterday', 'last7', 'last30', 'mtd', 'thisMonth', 'lastMonth', 'last90', 'qtd', 'lastQuarter', 'ytd', 'since'];
  var PAY_METHODS = ['FPX online banking', 'Card (Visa)', 'DuitNow QR', 'Bank transfer', 'Cash'];

  O.css('invoices', [
    '.pg-invoices{display:flex;flex-direction:column;gap:14px;}',
    '.pg-invoices .kpis{margin-bottom:0;}',
    '.pg-invoices .inv-rule{display:flex;gap:10px;align-items:flex-start;}',
    '.pg-invoices .inv-rule svg{width:18px;height:18px;flex-shrink:0;color:var(--brand-strong);margin-top:1px;}',
    '.pg-invoices .inv-rule b{font-weight:800;}',
    '.pg-invoices .inv-rule .proto{color:var(--muted);}',
    '.pg-invoices .toolbar{margin-bottom:0;}',
    '.pg-invoices .inv-filters{display:flex;flex-direction:column;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border);}',
    '.pg-invoices .inv-filters .select{width:auto;min-width:150px;height:36px;padding-top:0;padding-bottom:0;}',
    '.pg-invoices .inv-filters .search{min-width:220px;}',
    '.pg-invoices .chip .n{margin-left:1px;}',
    '.pg-invoices input[type=checkbox]{accent-color:var(--brand-strong);width:16px;height:16px;margin:0;vertical-align:middle;}',
    '.pg-invoices .inv-bulk{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 16px;background:var(--brand-soft);border-bottom:1px solid var(--border);font-size:13px;}',
    '.pg-invoices .inv-bulk b{font-weight:800;}',
    '.pg-invoices .inv-table td{padding:9px 10px;} .pg-invoices .inv-table th{padding:9px 10px;}',
    '.pg-invoices .inv-table th:first-child, .pg-invoices .inv-table td:first-child{padding-left:16px;width:34px;}',
    '.pg-invoices .inv-table th:last-child, .pg-invoices .inv-table td:last-child{padding-right:16px;}',
    '.pg-invoices .inv-table tr.on td{background:var(--brand-soft-2);}',
    '.pg-invoices .inv-no{font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap;}',
    '.pg-invoices .inv-sub{font-size:11.5px;color:var(--muted);margin-top:1px;white-space:nowrap;}',
    '.pg-invoices .inv-guest{display:flex;align-items:center;gap:8px;min-width:0;}',
    '.pg-invoices .inv-guest .inv-nm{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;}',
    '.pg-invoices .inv-acts{display:flex;gap:4px;justify-content:flex-end;align-items:center;white-space:nowrap;}',
    '.pg-invoices .ib{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border);background:var(--surface);border-radius:8px;color:var(--text-2);flex-shrink:0;padding:0;}',
    '.pg-invoices .ib:hover{background:var(--surface-2);border-color:var(--border-strong);}',
    '.pg-invoices .ib svg{width:15px;height:15px;}',
    '.pg-invoices .btn-xs svg{width:13px;height:13px;}',
    '.pg-invoices .inv-more-row{display:flex;justify-content:center;padding:10px;border-top:1px solid var(--border);}',
    '.pg-invoices .inv-bottom{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:14px;align-items:start;}',
    '.pg-invoices .set-row{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:12px 0;border-bottom:1px solid var(--border);}',
    '.pg-invoices .set-row:first-child{padding-top:0;} .pg-invoices .set-row:last-child{border-bottom:none;padding-bottom:0;}',
    '.pg-invoices .set-row .t{font-weight:700;font-size:13px;} .pg-invoices .set-row .s{font-size:12px;color:var(--muted);margin-top:2px;max-width:380px;}',
    '.pg-invoices .set-row .seg button{padding:5px 9px;font-size:12px;}',
    '.pg-invoices .set-row .ctl{flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:6px;}',
    '.pg-invoices .set-num{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-top:8px;}',
    '.pg-invoices .set-num .input{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;}',
    '.pg-invoices .co{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:12.5px;margin-top:8px;}',
    '.pg-invoices .co dt{color:var(--muted);font-weight:600;} .pg-invoices .co dd{margin:0;font-weight:600;min-width:0;overflow-wrap:anywhere;}',
    '.pg-invoices .sst-fields{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,0.6fr);gap:10px;margin-top:10px;}',
    '.pg-invoices .pv-wrap{max-height:520px;overflow:auto;}',
    '.pg-invoices .pv-wrap .doc td.num{white-space:nowrap;}',
    '.pg-invoices .c-total .inv-sub{font-weight:500;}',
    '.pg-invoices .pv-wrap .doc{font-size:12px;} .pg-invoices .pv-wrap .doc td{font-size:12px;} .pg-invoices .pv-wrap .doc td.muted{white-space:nowrap;padding-left:8px;padding-right:8px;}',
    '.pg-invoices .log-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);font-size:12.5px;}',
    '.pg-invoices .log-row:last-child{border-bottom:none;}',
    '.pg-invoices .log-ic{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:var(--surface-2);border:1px solid var(--border);color:var(--text-2);flex-shrink:0;}',
    '.pg-invoices .log-ic svg{width:14px;height:14px;}',
    '.pg-invoices .log-row .when{margin-left:auto;color:var(--muted);font-size:11.5px;white-space:nowrap;}',
    '.inv-menu{position:fixed;z-index:150;min-width:210px;}',
    '.inv-menu .pop-opt svg{width:15px;height:15px;color:var(--muted);}',
    '.inv-menu .pop-opt[disabled]{opacity:0.45;cursor:not-allowed;}',
    '.inv-menu .pop-opt{justify-content:flex-start;}',
    '.inv-bsend .bs-row{display:grid;grid-template-columns:minmax(0,1fr) 140px;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border);}',
    '.inv-bsend .bs-row:last-child{border-bottom:none;}',
    '.inv-bsend .bs-row .bs-nm{font-weight:700;font-size:13px;text-align:left;} .inv-bsend .bs-row .bs-nm span{font-weight:600;font-size:12px;color:var(--muted);margin-left:4px;} .inv-bsend .bs-row .bs-sb{font-size:11.5px;color:var(--muted);margin-top:1px;overflow-wrap:anywhere;}',
    '.inv-bsend .bs-list{max-height:340px;overflow:auto;border:1px solid var(--border);border-radius:10px;padding:0 12px;}',
    '.inv-bsend .select{padding-top:6px;padding-bottom:6px;}',
    '@media (max-width:1100px){.pg-invoices .inv-bottom{grid-template-columns:minmax(0,1fr);}}',
    '@media (max-width:760px){',
    ' .pg-invoices .inv-table thead{display:none;}',
    ' .pg-invoices .inv-table, .pg-invoices .inv-table tbody{display:block;}',
    ' .pg-invoices .inv-table tr{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:4px 10px;padding:12px 14px;border-bottom:1px solid var(--border);}',
    ' .pg-invoices .inv-table td{display:block;border:none;padding:0 !important;}',
    ' .pg-invoices .inv-table td:first-child{grid-row:1 / span 4;width:auto;}',
    ' .pg-invoices .inv-table td.c-inv{grid-column:2;} .pg-invoices .inv-table td.c-total{grid-column:3;grid-row:1;text-align:right;font-weight:800;}',
    ' .pg-invoices .inv-table td.c-guest, .pg-invoices .inv-table td.c-prop, .pg-invoices .inv-table td.c-stay{grid-column:2 / span 2;}',
    ' .pg-invoices .inv-table td.c-prop, .pg-invoices .inv-table td.c-stay{font-size:12px;color:var(--muted);}',
    ' .pg-invoices .inv-table td.c-stay .inv-sub{display:inline;} .pg-invoices .inv-table td.c-stay .inv-sub::before{content:" · ";}',
    ' .pg-invoices .inv-table td.c-ist .inv-sub, .pg-invoices .inv-table td.c-rst .inv-sub{margin:0;}',
    ' .pg-invoices .inv-table td.c-ist, .pg-invoices .inv-table td.c-rst{grid-column:2 / span 2;display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;font-size:11.5px;color:var(--muted);} .pg-invoices .inv-table td .inv-sub{white-space:normal;}',
    ' .pg-invoices .inv-table td.c-ist::before{content:"Invoice";} .pg-invoices .inv-table td.c-rst::before{content:"Receipt";}',
    ' .pg-invoices .inv-table td.c-acts{grid-column:2 / span 2;margin-top:6px;}',
    ' .pg-invoices .inv-acts{justify-content:flex-start;flex-wrap:wrap;}',
    ' .pg-invoices .inv-acts .btn-xs{padding:7px 10px;} .pg-invoices .ib{width:36px;height:36px;}',
    ' .pg-invoices .inv-filters .select{flex:1 1 140px;min-width:0;} .pg-invoices .inv-filters .search{flex:1 1 100%;} .pg-invoices .inv-filters .dr{max-width:100%;}',
    ' .pg-invoices .inv-filters .chips{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:0 -16px;padding:0 16px;}',
    ' .pg-invoices .inv-guest .inv-nm{max-width:none;}',
    ' .pg-invoices .set-row{flex-direction:column;} .pg-invoices .set-row .ctl{align-items:flex-start;}',
    ' .pg-invoices .set-num, .pg-invoices .sst-fields{grid-template-columns:minmax(0,1fr);}',
    ' .inv-bsend .bs-row{grid-template-columns:minmax(0,1fr);}',
    '}'
  ].join('\n'));

  /* ------------------------------------------------------------------ data helpers */
  function range() {
    if (st.preset) { var p = U.preset(st.preset); return { from: p.from, to: p.to }; }
    return { from: st.from, to: st.to };
  }
  function prop(id) { return D.propById[id]; }
  function base() { /* invoices in range + platform + property (not status / search) */
    var r = range();
    return D.bookings.filter(function (b) {
      return b.invoiceNo && b.status !== 'cancelled' && b.invoiceDate >= r.from && b.invoiceDate <= r.to &&
        (!st.plat || b.channel === st.plat) && (!st.prop || b.propertyId === st.prop);
    });
  }
  function matchQ(b) {
    if (!st.q) return true;
    var q = st.q.toLowerCase();
    return [b.guest.name, b.id, b.invoiceNo, b.receiptNo || '', prop(b.propertyId).name].join(' ').toLowerCase().indexOf(q) >= 0;
  }
  function matchStatus(b, s) {
    switch (s) {
      case 'notsent': return !b.invoiceSent;
      case 'sent': return !!b.invoiceSent;
      case 'awaiting': return !b.paidAt;
      case 'paid': return !!b.paidAt;
      case 'rcpnotsent': return !!b.paidAt && !b.receiptSent;
      default: return true;
    }
  }
  function rows() {
    return base().filter(function (b) { return matchQ(b) && matchStatus(b, st.status); })
      .sort(function (a, b) { return a.invoiceDate !== b.invoiceDate ? (a.invoiceDate < b.invoiceDate ? 1 : -1) : (a.invoiceNo < b.invoiceNo ? 1 : -1); });
  }
  function sum(list, f) { return list.reduce(function (s, x) { return s + f(x); }, 0); }
  function unsent(list) { return list.filter(function (b) { return !b.invoiceSent || (b.paidAt && !b.receiptSent); }); }
  function viaFor(b, setting) { /* which channel an automatic send uses */
    var v = setting || 'auto';
    if (v === 'auto') return b.channel === 'direct' ? 'WhatsApp' : 'Email';
    return v;
  }
  function addrFor(b, via) { return via === 'WhatsApp' ? b.guest.phone : b.guest.email; }
  function stamp(b, kind, via) {
    var s = { via: via, at: D.TODAY, time: D.NOW_TIME, to: addrFor(b, via) };
    if (kind === 'invoice') b.invoiceSent = s; else b.receiptSent = s;
    D.sentLog.unshift({ at: D.NOW, bookingId: b.id, kind: kind, via: via, to: s.to });
  }
  function seqOf(no) { var m = /(\d+)\D*$/.exec(String(no || '')); return m ? +m[1] : 0; }
  function nextNo(kind, skipId) {
    var key = kind === 'invoice' ? 'invoiceNo' : 'receiptNo';
    var max = D.bookings.reduce(function (m, x) { return x[key] && x.id !== skipId ? Math.max(m, seqOf(x[key])) : m; }, 1000);
    var pat = kind === 'invoice' ? S.invPattern : S.rcpPattern;
    return pat.replace(/\{YYYY\}/g, D.TODAY.slice(0, 4)).replace(/\{YY\}/g, D.TODAY.slice(2, 4)).replace(/\{MM\}/g, D.TODAY.slice(5, 7)).replace(/\{seq\}/g, String(max + 1));
  }
  /* core O.invoice.markPaid always writes RCP-YYYY-n. Apply the receipt numbering format from the settings card on top of it,
     wherever a payment is recorded (this page, the booking drawer). With the default format the number is identical. */
  if (!O.invoice._fmtWrapped) {
    O.invoice._fmtWrapped = true;
    var coreMarkPaid = O.invoice.markPaid;
    O.invoice.markPaid = function (b, method) {
      var was = b.paidAt;
      var r = coreMarkPaid.apply(this, arguments);
      if (!was && b.paidAt && D.invoiceSettings) {
        var want = nextNo('receipt', b.id);
        if (want !== b.receiptNo) { b.receiptNo = want; O.emit('data', { type: 'payment', bookingId: b.id }); }
      }
      return r;
    };
  }

  /* ------------------------------------------------------------------ actions */
  function recordPayment(b) {
    var body = O.html('<div class="stack">' +
      '<div class="note">' + esc(b.guest.name) + ' · ' + esc(prop(b.propertyId).name) + ' · ' + d.fmtRange(b.checkIn, b.checkOut) + '<br>Invoice ' + esc(b.invoiceNo) + ' · total <b>' + fmt.money(b.total, { dp: 2 }) + '</b></div>' +
      '<div class="form-grid"><div class="field"><label for="inv-pm">Payment method</label><select class="select" id="inv-pm">' + PAY_METHODS.map(function (m) { return '<option>' + m + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="inv-pd">Payment date</label><input class="input" id="inv-pd" type="date" value="' + D.TODAY + '" max="' + D.TODAY + '"></div></div>' +
      '<div class="note brand">Receipt ' + esc(nextNo('receipt')) + ' is created as soon as you save. ' +
      (S.autoReceipt === 'off' ? 'Automatic sending is off, so you can send it yourself afterwards.' : 'It is sent to the guest automatically by ' + esc(viaFor(b, S.autoReceipt)) + '.') + '</div></div>');
    U.modal({
      title: 'Record payment', sub: 'Creates the payment receipt for ' + b.guest.name, body: body,
      actions: [{ label: 'Cancel' }, {
        label: 'Record payment', kind: 'primary', onClick: function () {
          O.invoice.markPaid(b, O.$('#inv-pm', body).value);
          var pd = O.$('#inv-pd', body).value; if (pd && pd <= D.TODAY) b.paidAt = pd;
          var msg = 'Payment recorded. Receipt ' + b.receiptNo + ' created';
          if (S.autoReceipt !== 'off') { var via = viaFor(b, S.autoReceipt); stamp(b, 'receipt', via); msg += ' and sent by ' + via; }
          U.toast(msg + '.');
          O.emit('data', { type: 'payment', bookingId: b.id });
        }
      }]
    });
  }
  function viewDoc(b, kind) {
    if (kind === 'receipt' && !b.paidAt) return recordPayment(b);
    O.invoice.preview(b, kind);
  }
  function bulkSend(list) {
    var onlyNew = true;
    var body = O.html('<div class="stack inv-bsend">' +
      '<div class="note">Each guest gets their own invoice, plus the payment receipt when the booking is paid. Platform guests default to email, direct guests to WhatsApp. Change the channel per guest below.</div>' +
      '<label class="check"><input type="checkbox" name="onlynew" checked><span>Skip documents that were already sent</span></label>' +
      '<div class="bs-list">' + list.map(function (b) {
        return '<div class="bs-row" data-id="' + b.id + '"><div style="min-width:0"><div class="bs-nm">' + esc(b.guest.name) + '<span>' + esc(b.invoiceNo) + '</span></div><div class="bs-sb bs-docs"></div></div>' +
          '<select class="select" aria-label="Send ' + esc(b.guest.name) + ' by" data-via><option' + (b.channel === 'direct' ? ' selected' : '') + '>WhatsApp</option><option' + (b.channel !== 'direct' ? ' selected' : '') + '>Email</option></select></div>';
      }).join('') + '</div><div class="small muted bs-sum"></div></div>');
    function docsFor(b) {
      var out = [];
      if (!onlyNew || !b.invoiceSent) out.push('invoice');
      if (b.paidAt && (!onlyNew || !b.receiptSent)) out.push('receipt');
      return out;
    }
    function paint() {
      var nDocs = 0, nGuests = 0;
      O.$$('.bs-row', body).forEach(function (row) {
        var b = D.booking(row.dataset.id), docs = docsFor(b), via = O.$('[data-via]', row).value;
        nDocs += docs.length; if (docs.length) nGuests++;
        O.$('.bs-docs', row).textContent = docs.length ? (docs.map(function (k) { return k === 'invoice' ? 'Invoice' : 'Receipt ' + b.receiptNo; }).join(' + ') + ' → ' + addrFor(b, via)) : 'Nothing new to send';
      });
      O.$('.bs-sum', body).textContent = nDocs ? nDocs + ' document' + (nDocs === 1 ? '' : 's') + ' to ' + nGuests + ' guest' + (nGuests === 1 ? '' : 's') + '.' : 'Everything selected has already been sent. Untick the box above to send again.';
    }
    body.addEventListener('change', function (e) { if (e.target.name === 'onlynew') onlyNew = e.target.checked; paint(); });
    paint();
    U.modal({
      title: 'Send ' + list.length + ' selected', sub: 'Invoices and receipts go to each guest separately', body: body, size: 'wide',
      actions: [{ label: 'Cancel' }, {
        label: 'Send', kind: 'primary', onClick: function () {
          var n = { invoice: 0, receipt: 0 }, via = { WhatsApp: 0, Email: 0 }, guests = 0;
          O.$$('.bs-row', body).forEach(function (row) {
            var b = D.booking(row.dataset.id), docs = docsFor(b), v = O.$('[data-via]', row).value;
            if (!docs.length) return;
            guests++; via[v]++;
            docs.forEach(function (k) { stamp(b, k, v); n[k]++; });
          });
          if (!guests) { U.toast('Nothing to send. Everything selected was already sent.', 'bad'); return false; }
          st.sel = {};
          var parts = []; if (n.invoice) parts.push(fmt.plural(n.invoice, 'invoice')); if (n.receipt) parts.push(fmt.plural(n.receipt, 'receipt'));
          var vparts = []; if (via.WhatsApp) vparts.push(via.WhatsApp + ' by WhatsApp'); if (via.Email) vparts.push(via.Email + ' by email');
          U.toast('Sent ' + parts.join(' and ') + ' to ' + fmt.plural(guests, 'guest') + ' (' + vparts.join(', ') + ')');
          O.emit('data', { type: 'sent' });
        }
      }]
    });
  }
  function exportCSV(list) {
    var r = range();
    var out = [['Invoice no', 'Invoice date', 'Receipt no', 'Paid on', 'Booking', 'Guest', 'Country', 'Phone', 'Email', 'Property', 'Platform', 'Check-in', 'Check-out', 'Nights', 'Accommodation (RM)', 'Cleaning (RM)', 'Tourism tax (RM)', 'Total (RM)', 'Payment method', 'Invoice sent', 'Receipt sent']];
    list.forEach(function (b) {
      out.push([b.invoiceNo, b.invoiceDate, b.receiptNo || '', b.paidAt || '', b.id, b.guest.name, b.guest.countryName, b.guest.phone, b.guest.email, prop(b.propertyId).name, U.platName(b.channel), b.checkIn, b.checkOut, b.nights,
        b.accommodation.toFixed(2), b.cleaningFee.toFixed(2), b.tourismTax.toFixed(2), b.total.toFixed(2), b.paidAt ? b.payMethod : '',
        b.invoiceSent ? b.invoiceSent.at + ' by ' + b.invoiceSent.via : 'Not sent', b.receiptSent ? b.receiptSent.at + ' by ' + b.receiptSent.via : (b.paidAt ? 'Not sent' : 'Awaiting payment')]);
    });
    O.downloadCSV('Invoices-' + r.from + '-to-' + r.to + '.csv', out);
  }
  var menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function openMenu(btn, b) {
    closeMenu();
    menuEl = O.html('<div class="pop-menu open inv-menu" role="menu">' +
      '<button type="button" class="pop-opt" data-m="pdf-inv" role="menuitem">' + O.icon('download') + 'Download invoice PDF</button>' +
      '<button type="button" class="pop-opt" data-m="pdf-rcp" role="menuitem"' + (b.paidAt ? '' : ' disabled') + '>' + O.icon('download') + 'Download receipt PDF</button>' +
      (b.paidAt ? '' : '<button type="button" class="pop-opt" data-m="pay" role="menuitem">' + O.icon('check') + 'Record payment</button>') +
      '<button type="button" class="pop-opt" data-m="open" role="menuitem">' + O.icon('bookings') + 'Open booking ' + esc(b.id) + '</button></div>');
    document.body.appendChild(menuEl);
    var r = btn.getBoundingClientRect(), w = menuEl.offsetWidth, h = menuEl.offsetHeight;
    var top = r.bottom + 6; if (top + h > window.innerHeight - 8) top = r.top - h - 6;
    top = Math.max(8, Math.min(window.innerHeight - h - 8, top));
    menuEl.style.top = top + 'px'; menuEl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
    menuEl.addEventListener('click', function (e) {
      e.stopPropagation();
      var x = e.target.closest('[data-m]'); if (!x || x.disabled) return;
      var m = x.dataset.m; closeMenu();
      if (m === 'pdf-inv') O.invoice.pdf(b, 'invoice');
      if (m === 'pdf-rcp') O.invoice.pdf(b, 'receipt');
      if (m === 'pay') recordPayment(b);
      if (m === 'open') O.booking.open(b.id);
    });
  }
  document.addEventListener('click', function (e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
  window.addEventListener('scroll', closeMenu, true);
  window.addEventListener('resize', closeMenu);

  /* ------------------------------------------------------------------ render pieces */
  function kpis(list) {
    var paid = list.filter(function (b) { return b.paidAt; }), unpaid = list.filter(function (b) { return !b.paidAt; });
    var notSent = list.filter(function (b) { return !b.invoiceSent; });
    var rNot = paid.filter(function (b) { return !b.receiptSent; });
    var sameDay = list.filter(function (b) { return b.invoiceSent && b.invoiceSent.at === b.invoiceDate; });
    var tax = sum(list, function (b) { return b.tourismTax; });
    return U.kpis([
      { label: 'Invoices issued', value: fmt.num(list.length), sub: fmt.money(sum(list, function (b) { return b.total; })) + ' billed', hl: true },
      { label: 'Paid', value: fmt.money(sum(paid, function (b) { return b.total; })), sub: fmt.plural(paid.length, 'receipt') + ' issued' },
      { label: 'Awaiting payment', value: fmt.money(sum(unpaid, function (b) { return b.total; })), sub: unpaid.length ? fmt.plural(unpaid.length, 'invoice') + ' open' : 'Nothing outstanding' },
      { label: 'Invoices not sent', value: fmt.num(notSent.length), sub: notSent.length ? 'Waiting to go out' : 'All sent' },
      { label: 'Receipts not sent', value: fmt.num(rNot.length), sub: rNot.length ? 'Paid, receipt not sent' : 'All sent' },
      { label: 'Sent on booking day', value: list.length ? fmt.pct(sameDay.length / list.length) : '–', sub: fmt.num(sameDay.length) + ' of ' + fmt.num(list.length) + ' invoices', title: 'Invoices sent to the guest on the day the booking was confirmed' },
      { label: 'Tourism tax billed', value: fmt.money(tax), sub: fmt.num(sum(list, function (b) { return b.tourismTax ? b.nights : 0; })) + ' foreign nights', title: 'RM 10 per night for foreign guests, passed through to the government' }
    ]);
  }
  function filtersHTML(b0) {
    var q = b0.filter(matchQ);
    var chips = STATUSES.map(function (s) {
      var n = q.filter(function (b) { return matchStatus(b, s[0]); }).length;
      return '<button type="button" class="chip' + (st.status === s[0] ? ' on' : '') + '" data-status="' + s[0] + '" aria-pressed="' + (st.status === s[0]) + '">' + esc(s[1]) + ' <span class="n">' + n + '</span></button>';
    }).join('');
    return '<div class="inv-filters"><div class="toolbar"><span data-slot="range"></span>' +
      '<label class="sr-only" for="inv-plat">Platform</label><select class="select" id="inv-plat" data-f="plat"><option value="">All platforms</option>' + D.channelOrder.map(function (c) { return '<option value="' + c + '"' + (st.plat === c ? ' selected' : '') + '>' + esc(U.platName(c)) + '</option>'; }).join('') + '</select>' +
      '<label class="sr-only" for="inv-prop">Property</label><select class="select" id="inv-prop" data-f="prop">' + U.propOptions(st.prop, { all: 'All properties' }) + '</select>' +
      '<div class="search">' + O.icon('search') + '<label class="sr-only" for="inv-q">Search invoices</label><input id="inv-q" type="search" placeholder="Search guest or invoice" value="' + esc(st.q) + '"></div>' +
      '</div><div class="chips" role="group" aria-label="Status">' + chips + '</div></div>';
  }
  function rowHTML(b) {
    var p = prop(b.propertyId), on = !!st.sel[b.id];
    return '<tr class="click' + (on ? ' on' : '') + '" data-id="' + b.id + '">' +
      '<td><input type="checkbox" class="check-in" data-sel="' + b.id + '"' + (on ? ' checked' : '') + ' aria-label="Select invoice ' + esc(b.invoiceNo) + '"></td>' +
      '<td class="c-inv"><div class="inv-no">' + esc(b.invoiceNo) + '</div><div class="inv-sub">' + d.fmtY(b.invoiceDate) + '</div></td>' +

      '<td class="c-guest"><div class="inv-guest">' + U.platIcon(b.channel) + '<div style="min-width:0"><div class="inv-nm">' + esc(b.guest.name) + '</div><div class="inv-sub">' + esc(b.guest.countryName) + ' · ' + esc(b.id) + '</div></div></div></td>' +
      '<td class="c-prop"><span class="nowrap">' + esc(p.short) + '</span></td>' +
      '<td class="c-stay"><span class="nowrap">' + d.fmtRange(b.checkIn, b.checkOut) + '</span><div class="inv-sub">' + fmt.plural(b.nights, 'night') + '</div></td>' +
      '<td class="c-total num"><b>' + fmt.money(b.total) + '</b>' + (b.tourismTax ? '<div class="inv-sub">incl. tax ' + fmt.money(b.tourismTax) + '</div>' : '') + '</td>' +
      '<td class="c-ist">' + O.invoice.statusHTML(b, 'invoice') + (b.invoiceSent ? '<div class="inv-sub">' + (b.invoiceSent.at === D.TODAY ? 'Today' : d.fmt(b.invoiceSent.at)) + '</div>' : '') + '</td>' +
      '<td class="c-rst">' + O.invoice.statusHTML(b, 'receipt') + (b.receiptNo ? '<div class="inv-sub">' + esc(b.receiptNo) + ' · paid ' + d.fmt(b.paidAt) + '</div>' : '') + '</td>' +
      '<td class="c-acts"><div class="inv-acts">' +
      '<button type="button" class="ib" data-act="inv" aria-label="View invoice ' + esc(b.invoiceNo) + '" title="View invoice">' + O.icon('file') + '</button>' +
      '<button type="button" class="ib" data-act="rcp" aria-label="' + (b.paidAt ? 'View receipt ' + esc(b.receiptNo) : 'Record payment') + '" title="' + (b.paidAt ? 'View receipt' : 'Record payment') + '">' + O.icon(b.paidAt ? 'check' : 'card') + '</button>' +
      '<button type="button" class="ib" data-act="send" aria-label="Send to ' + esc(b.guest.name) + '" title="Send to guest">' + O.icon('send') + '</button>' +
      '<button type="button" class="ib" data-act="more" aria-label="More actions for ' + esc(b.invoiceNo) + '" title="Download PDF and more">' + O.icon('more') + '</button>' +
      '</div></td></tr>';
  }
  function tableCard(b0, list) {
    var shown = list.slice(0, st.limit);
    var selIds = Object.keys(st.sel).filter(function (k) { return st.sel[k]; });
    var allOn = list.length && list.every(function (b) { return st.sel[b.id]; });
    var r = range();
    var head = '<div class="card-head"><div><h3>Invoices and receipts</h3><div class="sub">' + fmt.plural(list.length, 'invoice') + ' dated ' + esc(U.rangeLabel(r.from, r.to)) + (st.status !== 'all' ? ' · ' + esc(STATUSES.filter(function (s) { return s[0] === st.status; })[0][1].toLowerCase()) : '') + '</div></div>' +
      '<div class="row-flex wrap">' + (st.status !== 'all' || st.plat || st.prop || st.q ? '<button type="button" class="btn btn-quiet btn-sm" data-act="clear">Clear filters</button>' : '') +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="csv">' + O.icon('download') + 'Export list</button></div></div>';
    var bulk = selIds.length ? '<div class="inv-bulk" role="region" aria-label="Selection"><b>' + selIds.length + ' selected</b><span class="muted">' + fmt.money(sum(selIds.map(D.booking), function (b) { return b.total; })) + '</span>' +
      '<button type="button" class="btn btn-primary btn-sm" data-act="bulksend">' + O.icon('send') + 'Send selected</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="bulkcsv">' + O.icon('download') + 'Export selected</button>' +
      '<button type="button" class="btn btn-quiet btn-sm" data-act="selnone">Clear selection</button></div>' : '';
    var body = list.length ? '<div class="table-wrap"><table class="table inv-table"><thead><tr>' +
      '<th><input type="checkbox" class="check-in" data-selall' + (allOn ? ' checked' : '') + ' aria-label="Select all ' + list.length + ' invoices"></th>' +
      '<th>Invoice</th><th>Guest</th><th>Property</th><th>Stay</th><th class="num">Total</th><th>Invoice status</th><th>Receipt</th><th class="right">Actions</th></tr></thead><tbody>' +
      shown.map(rowHTML).join('') + '</tbody></table></div>' +
      (list.length > shown.length ? '<div class="inv-more-row"><button type="button" class="btn btn-ghost btn-sm" data-act="more-rows">Show ' + Math.min(25, list.length - shown.length) + ' more · ' + (list.length - shown.length) + ' hidden</button></div>' : '')
      : U.empty(b0.length ? 'No invoices match these filters. Try another status or clear the search.' : 'No invoices are dated in this range. Choose a longer date range.', '🧾');
    return '<div class="card">' + head + filtersHTML(b0) + bulk + body + '</div>';
  }
  function seg(name, val, opts) {
    return '<div class="seg" role="group" aria-label="' + esc(name) + '">' + opts.map(function (o) { return '<button type="button" data-set="' + name + '" data-v="' + o[0] + '" class="' + (val === o[0] ? 'on' : '') + '" aria-pressed="' + (val === o[0]) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>';
  }
  function settingsCard() {
    var ws = O.ws();
    var sendOpts = [['auto', 'Auto'], ['Email', 'Email'], ['WhatsApp', 'WhatsApp'], ['off', 'Off']];
    return '<div class="card"><div class="card-head"><div><h3>Invoice settings</h3><div class="sub">Applies to every invoice and receipt created from now on</div></div></div><div class="card-body">' +
      '<div class="set-row"><div><div class="t">Send the invoice automatically</div><div class="s">When a booking is confirmed. Auto uses WhatsApp for direct guests and email for platform guests.</div></div><div class="ctl">' + seg('autoInvoice', S.autoInvoice, sendOpts) + '</div></div>' +
      '<div class="set-row"><div><div class="t">Send the receipt automatically</div><div class="s">When payment arrives, from the platform payout or a direct payment.</div></div><div class="ctl">' + seg('autoReceipt', S.autoReceipt, sendOpts) + '</div></div>' +
      '<div class="set-row" style="display:block"><div class="t">Numbering</div><div class="s">Use {YYYY}, {YY} and {MM} for the date and end with {seq}, the running number. Numbers never repeat or skip.</div>' +
      '<div class="set-num"><div class="field"><label for="inv-pat">Invoices</label><input class="input" id="inv-pat" data-pat="invPattern" value="' + esc(S.invPattern) + '"><span class="hint">Next: <b class="nx-inv">' + esc(nextNo('invoice')) + '</b></span></div>' +
      '<div class="field"><label for="rcp-pat">Receipts</label><input class="input" id="rcp-pat" data-pat="rcpPattern" value="' + esc(S.rcpPattern) + '"><span class="hint">Next: <b class="nx-rcp">' + esc(nextNo('receipt')) + '</b></span></div></div></div>' +
      '<div class="set-row" style="display:block"><div class="row-flex" style="justify-content:space-between;align-items:flex-start"><div><div class="t">Company details on documents</div><div class="s">Taken from your workspace.</div></div><button type="button" class="btn btn-ghost btn-xs" data-act="brand">' + O.icon('edit') + 'Edit in Brand &amp; Setup</button></div>' +
      '<dl class="co"><dt>Name</dt><dd>' + esc(ws.legal || ws.name) + '</dd><dt>Registration</dt><dd>' + (!ws.regNo || /^add /i.test(ws.regNo) ? '<span class="pill warn">Not added yet</span>' : esc(ws.regNo)) + '</dd><dt>Address</dt><dd>' + esc(ws.address || '–') + '</dd><dt>Contact</dt><dd>' + esc(ws.email || '') + ' · ' + esc(ws.phone || '') + '</dd></dl></div>' +
      '<div class="set-row"><div><div class="t">Tourism tax line</div><div class="s">RM 10 per room per night for foreign guests. Malaysians are exempt. Shown on the invoice and passed through, not counted as revenue.</div></div><div class="ctl"><button type="button" class="switch' + (S.tourismTax ? ' on' : '') + '" data-tog="tourismTax" role="switch" aria-checked="' + S.tourismTax + '" aria-label="Tourism tax line"></button></div></div>' +
      '<div class="set-row" style="display:block"><div class="row-flex" style="justify-content:space-between;align-items:flex-start;gap:14px"><div><div class="t">Service tax (SST)</div><div class="s">Turn on once you are registered. Registration is required when taxable sales pass RM 500,000 in 12 months.</div></div><button type="button" class="switch' + (S.sst ? ' on' : '') + '" data-tog="sst" role="switch" aria-checked="' + S.sst + '" aria-label="Service tax"></button></div>' +
      (S.sst ? '<div class="sst-fields"><div class="field"><label for="sst-no">SST registration no.</label><input class="input" id="sst-no" data-sst="sstNo" value="' + esc(S.sstNo) + '" placeholder="e.g. W10-1808-32000123"></div><div class="field"><label for="sst-rate">Rate</label><select class="select" id="sst-rate" data-sst="sstRate">' + [6, 8].map(function (r) { return '<option value="' + r + '"' + (+S.sstRate === r ? ' selected' : '') + '>' + r + '%</option>'; }).join('') + '</select></div></div>' : '') +
      '</div></div></div>';
  }
  function previewCard() {
    var paid = D.bookings.filter(function (b) { return b.paidAt && b.status !== 'cancelled' && b.tourismTax; }).sort(function (a, b) { return a.paidAt < b.paidAt ? 1 : -1; })[0] || D.bookings.filter(function (b) { return b.paidAt; })[0];
    return '<div class="card"><div class="card-head"><div><h3>What guests receive</h3><div class="sub">' + esc(paid.guest.name) + ' · ' + esc(prop(paid.propertyId).short) + ' · uses your logo and brand colours</div></div>' +
      U.seg([['invoice', 'Invoice'], ['receipt', 'Receipt']], st.preview, 'data-pv') + '</div>' +
      '<div class="card-body"><div class="pv-wrap">' + O.invoice.html(paid, st.preview) + '</div>' + taxNote() + '</div></div>';
  }
  function taxNote() {
    var parts = [];
    if (S.sst) parts.push('add service tax (SST ' + (+S.sstRate || 8) + '%) on accommodation and cleaning' + (S.sstNo ? ' with registration ' + S.sstNo : ''));
    if (!S.tourismTax) parts.push('leave out the tourism tax line');
    return parts.length ? '<div class="note warn small" style="margin-top:10px">Invoices created from now on ' + esc(parts.join(' and ')) + '. Documents already issued, like this one, stay as they were.</div>' : '';
  }
  function logCard() {
    var ev = [];
    D.bookings.forEach(function (b) {
      if (b.status === 'cancelled') return;
      var invT = b.invoiceSent ? (b.invoiceSent.time || (b.invoiceSent.at === b.invoiceDate ? b.createdAt.slice(11, 16) : '09:00')) : null;
      if (b.invoiceSent) ev.push({ at: b.invoiceSent.at + 'T' + invT, b: b, kind: 'invoice', via: b.invoiceSent.via });
      if (b.receiptSent) ev.push({ at: b.receiptSent.at + 'T' + (b.receiptSent.time || (invT && b.invoiceSent.at === b.receiptSent.at ? invT : '09:30')), b: b, kind: 'receipt', via: b.receiptSent.via });
    });
    ev.sort(function (a, b) { return a.at !== b.at ? (a.at < b.at ? 1 : -1) : (a.kind === 'receipt' ? -1 : 1); });
    ev = ev.filter(function (e) { return e.at <= D.NOW || e.b.invoiceSent && e.b.invoiceSent.time; }).slice(0, 7);
    return '<div class="card"><div class="card-head"><div><h3>Recently sent</h3><div class="sub">Newest first, including automatic sends</div></div></div><div class="card-body" style="padding-top:4px;padding-bottom:4px">' +
      (ev.length ? ev.map(function (e) {
        return '<div class="log-row"><span class="log-ic" aria-hidden="true">' + O.icon(e.via === 'WhatsApp' ? 'whatsapp' : 'mail') + '</span><div style="min-width:0"><div><b>' + (e.kind === 'invoice' ? 'Invoice ' + esc(e.b.invoiceNo) : 'Receipt ' + esc(e.b.receiptNo)) + '</b> to ' + esc(e.b.guest.name) + '</div><div class="small muted">' + esc(e.via) + ' · ' + esc(prop(e.b.propertyId).short) + '</div></div><span class="when">' + (e.at.slice(0, 10) === D.TODAY ? 'Today, ' + fmt.time(e.at.slice(11, 16)) : d.fmt(e.at.slice(0, 10))) + '</span></div>';
      }).join('') : U.empty('Nothing has been sent yet.', '✉')) +
      '</div><div class="card-foot">Prototype: documents are not really delivered. Sending updates the status and this log.</div></div>';
  }

  /* ------------------------------------------------------------------ page */
  O.page('invoices', {
    desc: 'Created automatically from each booking and sent straight to the guest',
    render: function (root, ctx) {
      closeMenu();
      if (ctx.fresh && ctx.params) {
        if (ctx.params.status) { st.status = ctx.params.status; st.limit = 25; }
        if (ctx.params.q || ctx.params.bookingId) st.q = ctx.params.q || ctx.params.bookingId;
      }
      var b0 = base(), list = rows(), ws = O.ws();
      Object.keys(st.sel).forEach(function (k) { if (!list.some(function (b) { return b.id === k; })) delete st.sel[k]; });
      ctx.setActions('<button type="button" class="btn btn-ghost" data-top="csv">' + O.icon('download') + 'Export CSV</button>' +
        '<button type="button" class="btn btn-primary" data-top="sendall"' + (unsent(b0).length ? '' : ' disabled title="Every invoice and receipt in this range has been sent"') + '>' + O.icon('send') + 'Send unsent</button>');
      root.innerHTML = '<div class="pg-invoices">' +
        '<div class="note brand inv-rule">' + O.icon('invoices') + '<div><b>One invoice per booking, created when the booking is confirmed. One payment receipt, created when payment arrives.</b> Both are filled in from the booking and guest details, carry the ' + esc(ws.name) + ' logo and colours, and can be sent straight to the guest by WhatsApp or email. <span class="proto">Prototype: nothing is really sent.</span></div></div>' +
        kpis(b0) + tableCard(b0, list) +
        '<div class="inv-bottom">' + settingsCard() + '<div class="stack">' + previewCard() + logCard() + '</div></div></div>';

      U.mount(root, 'range', U.dateRange({
        preset: st.preset, from: st.from, to: st.to, presets: PRESETS,
        onChange: function (v) { st.preset = v.preset; st.from = v.from; st.to = v.to; st.limit = 25; ctx.rerender(); }
      }));

      var acts = ctx.actionsEl;
      acts.onclick = function (e) {
        var x = e.target.closest('[data-top]'); if (!x || x.disabled) return;
        if (x.dataset.top === 'csv') exportCSV(rows());
        if (x.dataset.top === 'sendall') {
          var todo = unsent(base());
          if (todo.length) bulkSend(todo);
        }
      };

      var page = O.$('.pg-invoices', root);
      page.addEventListener('click', function (e) {
        var t = e.target;
        var chip = t.closest('[data-status]'); if (chip) { st.status = chip.dataset.status; st.limit = 25; ctx.rerender(); return; }
        var pv = t.closest('[data-pv]'); if (pv) { st.preview = pv.dataset.pv; ctx.rerender(); return; }
        var sg = t.closest('[data-set]');
        if (sg) {
          S[sg.dataset.set] = sg.dataset.v;
          var lbl = sg.dataset.set === 'autoInvoice' ? 'Invoices' : 'Receipts';
          U.toast(sg.dataset.v === 'off' ? lbl + ' will not be sent automatically' : lbl + ' will be sent automatically ' + (sg.dataset.v === 'auto' ? 'on the guest’s usual channel' : 'by ' + sg.dataset.v));
          ctx.rerender(); return;
        }
        var tg = t.closest('[data-tog]');
        if (tg) {
          var k = tg.dataset.tog; S[k] = !S[k];
          U.toast(k === 'sst' ? (S.sst ? 'Service tax will be added to new invoices. Add your SST registration number.' : 'Service tax removed from new invoices') : (S.tourismTax ? 'Tourism tax line turned on' : 'Tourism tax line turned off for new invoices'));
          ctx.rerender(); return;
        }
        if (t.matches('[data-selall]')) { var on = t.checked; rows().forEach(function (b) { if (on) st.sel[b.id] = true; else delete st.sel[b.id]; }); ctx.rerender(); return; }
        if (t.matches('[data-sel]')) { if (t.checked) st.sel[t.dataset.sel] = true; else delete st.sel[t.dataset.sel]; ctx.rerender(); return; }
        var a = t.closest('[data-act]');
        if (a) {
          var tr = a.closest('tr[data-id]'), b = tr ? D.booking(tr.dataset.id) : null, act = a.dataset.act;
          if (act === 'inv') viewDoc(b, 'invoice');
          else if (act === 'rcp') viewDoc(b, 'receipt');
          else if (act === 'send') O.invoice.send(b, b.paidAt ? ['invoice', 'receipt'] : ['invoice']);
          else if (act === 'more') { e.stopPropagation(); if (menuEl && menuEl._for === b.id) closeMenu(); else { openMenu(a, b); menuEl._for = b.id; } }
          else if (act === 'csv') exportCSV(rows());
          else if (act === 'clear') { st.status = 'all'; st.plat = ''; st.prop = ''; st.q = ''; ctx.rerender(); }
          else if (act === 'more-rows') { st.limit += 25; ctx.rerender(); }
          else if (act === 'bulksend') bulkSend(Object.keys(st.sel).map(D.booking).filter(Boolean));
          else if (act === 'bulkcsv') exportCSV(Object.keys(st.sel).map(D.booking).filter(Boolean));
          else if (act === 'selnone') { st.sel = {}; ctx.rerender(); }
          else if (act === 'brand') O.go('brand');
          return;
        }
        var row = t.closest('tr.click[data-id]');
        if (row && !t.closest('input,button,select,a')) O.booking.open(row.dataset.id);
      });
      page.addEventListener('change', function (e) {
        var t = e.target;
        if (t.dataset.f) { st[t.dataset.f] = t.value; st.limit = 25; ctx.rerender(); }
        if (t.dataset.sst) { S[t.dataset.sst] = t.value; U.toast('Service tax details saved'); }
        if (t.dataset.pat) {
          var v = t.value.trim();
          if (!/\{seq\}$/.test(v)) { U.toast('End the format with {seq} so every number is unique and keeps counting up', 'bad'); t.value = S[t.dataset.pat]; var k0 = t.dataset.pat === 'invPattern' ? 'invoice' : 'receipt'; O.$(k0 === 'invoice' ? '.nx-inv' : '.nx-rcp', root).textContent = nextNo(k0); return; }
          S[t.dataset.pat] = v; U.toast('Numbering saved. New documents use ' + nextNo(t.dataset.pat === 'invPattern' ? 'invoice' : 'receipt'));
          ctx.rerender();
        }
      });
      var qIn = O.$('#inv-q', root), qt;
      qIn.addEventListener('input', function () {
        clearTimeout(qt);
        qt = setTimeout(function () { st.q = qIn.value.trim(); st.limit = 25; var pos = qIn.selectionStart; ctx.rerender(); var n = O.$('#inv-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) {} } }, 220);
      });
      ['#inv-pat', '#rcp-pat'].forEach(function (sel) {
        var inp = O.$(sel, root); if (!inp) return;
        inp.addEventListener('input', function () {
          var kind = sel === '#inv-pat' ? 'invoice' : 'receipt', key = kind === 'invoice' ? 'invPattern' : 'rcpPattern', old = S[key];
          S[key] = inp.value || old; var nx = nextNo(kind); S[key] = old;
          O.$(kind === 'invoice' ? '.nx-inv' : '.nx-rcp', root).textContent = nx;
        });
      });
    }
  });
})();
