/* Automations — the guest message journey (7 steps) and the rules that run by themselves.
   New this round: invoice on confirmation, receipt on payment, same-day booking alert + urgent turnover,
   house rules before the door code, damage report -> maintenance task with photos, expense claims -> owner approval. */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  var st = { sample: null, group: 'all' };
  var FROM30 = d.add(D.TODAY, -29);

  D.automations = D.automations || {
    journey: [
      { id: 'j1', name: 'Booking confirmed', icon: 'check', channels: ['WhatsApp', 'Email'], when: 'Right after the booking is confirmed', on: true,
        text: 'Thanks for booking {property}, {guest_first}! Your stay is confirmed. Your invoice is attached and we will send your door code before arrival.' },
      { id: 'j2', name: 'ID check request', icon: 'user', channels: ['WhatsApp'], when: 'Right after booking · reminder after 24 hours if not done', on: true,
        text: 'Hi {guest_first}, Malaysian law asks us to verify every guest. Please upload your IC or passport here: {id_link}. Your door code is sent once this is done.' },
      { id: 'j3', name: 'Pre-arrival guide', icon: 'map', channels: ['WhatsApp', 'Email'], when: '3 days before check-in', on: true,
        text: 'Your guide for {property} is ready: directions, parking ({parking}) and Wi-Fi. Open the guest app here: {guest_app_link}' },
      { id: 'j4', name: 'Door code', icon: 'key', channels: ['Smart lock', 'WhatsApp'], when: '24 hours before check-in · only after ID is verified and house rules are accepted', on: true,
        text: 'Your door code for {property} is {door_code}. It works from {checkin_time} on your arrival day. Please do not share it.' },
      { id: 'j5', name: 'Check-in day', icon: 'home', channels: ['WhatsApp'], when: 'Arrival day at 9:00 AM', on: true,
        text: 'Today is the day, {guest_first}! Check-in is from {checkin_time}. Wi-Fi: {wifi_name}, password {wifi_password}. Message us here if you need anything.' },
      { id: 'j6', name: 'Mid-stay check', icon: 'chat', channels: ['WhatsApp'], when: 'Morning after the first night · stays of 3 nights or more', on: true,
        text: 'Good morning {guest_first}! Is everything working well at {property}? Fresh towels or a mid-stay clean can be booked in the guest app.' },
      { id: 'j7', name: 'Check-out and review request', icon: 'star', channels: ['WhatsApp', 'Booking platform'], when: 'Evening before check-out · review request 2 hours after check-out, skipped if an issue is open', on: true,
        text: 'Check-out is at {checkout_time} tomorrow. Want to stay until 2:00 PM? Reply LATE and we will confirm if the unit is free (RM 60). Thanks for staying with us, a review helps other guests find {property}.' }
    ],
    rules: [
      { id: 'r-inv', group: 'money', isNew: true, on: true, icon: 'invoices', when: 'A booking is confirmed', then: 'Create the invoice and send it to the guest', detail: 'Invoice number assigned automatically. Direct bookings get it on WhatsApp, platform bookings by email. Same switch as the invoice settings in Invoices & Receipts.', via: 'Auto', notify: null },
      { id: 'r-rcp', group: 'money', isNew: true, on: true, icon: 'check', when: 'Payment arrives for a booking', then: 'Create the receipt and send it to the guest', detail: 'The receipt is created as soon as the payment is recorded and sent at 6:00 PM that day, on the same channel as the invoice. Same switch as the receipt settings in Invoices & Receipts.', via: 'Auto', notify: null },
      { id: 'r-claim', group: 'money', isNew: true, on: true, icon: 'expenses', when: 'Staff record an expense they paid personally', then: 'Ask the owner to approve the claim', detail: 'The claim stays pending until an account owner approves it. Approval cannot be given to other roles.', via: 'WhatsApp', notify: 's1', notifyLocked: true },
      { id: 'r-same', group: 'ops', isNew: true, on: true, icon: 'alert', when: 'A booking is made for arrival today', then: 'Alert the ops manager and create an urgent turnover task', detail: 'If the unit still needs cleaning, the turnover for the property\'s housekeeper is marked urgent and due 15 minutes before arrival. If it is already clean, a pre-arrival inspection is created instead. The booking shows under Same-day bookings on the dashboard.', via: 'WhatsApp', notify: 's2' },
      { id: 'r-rules', group: 'guest', isNew: true, on: true, icon: 'rules', when: 'A guest opens the door code in the guest app', then: 'Show the house rules first and require acceptance', detail: 'The guest ticks agree and types their name. The door code stays hidden until rules are accepted and ID is verified.', via: null, notify: null },
      { id: 'r-damage', group: 'guest', isNew: true, on: true, icon: 'camera', when: 'A guest reports damage in the guest app', then: 'Create a maintenance task with the photos and alert maintenance', detail: 'Every damaged item needs a photo. The task is assigned to maintenance and linked to the booking for any deposit claim.', via: 'WhatsApp', notify: 's6' },
      { id: 'r-turn', group: 'ops', on: true, icon: 'tasks', when: 'A guest checks out', then: 'Create a turnover clean for the property\'s housekeeper', detail: 'Due 15 minutes before the next check-in, or 3:00 PM if nobody arrives that day.', via: 'WhatsApp', notify: null },
      { id: 'r-issue', group: 'ops', on: true, icon: 'chat', when: 'A guest reports a problem in a message', then: 'Create a maintenance task and alert the ops manager', detail: 'Picks up words like AC, leak, broken, no water, no hot water, smell.', via: 'WhatsApp', notify: 's2' },
      { id: 'r-review', group: 'guest', on: true, icon: 'star', when: 'A review is 3 stars or lower', then: 'Alert the ops manager and draft a reply', detail: 'The reply stays a draft until someone posts it from Reviews.', via: 'App', notify: 's2' },
      { id: 'r-block', group: 'ops', on: true, icon: 'calendar', when: 'An owner blocks dates', then: 'Close those dates on every channel', detail: 'Airbnb, Booking.com, Agoda, Vrbo and the direct booking site.', via: null, notify: null },
      { id: 'r-stock', group: 'ops', on: false, icon: 'refresh', when: 'Stock runs low', then: 'Add a restock task to the next turnover', detail: 'Uses the counts from the cleaning checklist.', via: null, notify: null },
      { id: 'r-owner', group: 'money', on: true, icon: 'owner', when: 'It is the 1st of the month', then: 'Generate owner statements and send them for approval', detail: 'Payouts go out after an account owner approves each statement.', via: 'Email', notify: 's1' }
    ]
  };
  var A = D.automations;
  var GROUPS = [['guest', 'Guest experience'], ['money', 'Invoices, receipts and claims'], ['ops', 'Operations']];
  var TRIGGERS = ['A booking is confirmed', 'A booking is cancelled', 'Payment arrives for a booking', 'A guest checks in', 'A guest checks out', 'A guest sends a message', 'A review is posted', 'A task becomes overdue', 'An expense is recorded', 'Every day at 8:00 AM'];
  var ACTIONS = ['Send the guest a WhatsApp message', 'Send the guest an email', 'Create a task', 'Notify a team member', 'Send an invoice', 'Send a receipt', 'Change the door code', 'Add a note to the booking'];

  O.css('automations', `
.pg-automations .jr{display:flex; flex-direction:column;}
.pg-automations .js{display:grid; grid-template-columns:34px minmax(0,1fr) auto; gap:12px; padding:12px 16px; border-bottom:1px solid var(--border); align-items:start;}
.pg-automations .js:last-child{border-bottom:none;}
.pg-automations .js.off{background:var(--surface-2);}
.pg-automations .js.off .jt, .pg-automations .js.off .msg{opacity:0.55;}
.pg-automations .jn{width:30px; height:30px; border-radius:50%; background:var(--brand); color:var(--brand-ink); font-weight:800; font-size:13px; display:flex; align-items:center; justify-content:center; position:relative; font-family:var(--font-head);}
.pg-automations .js.off .jn{background:var(--border-strong); color:var(--text);}
.pg-automations .jt{display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
.pg-automations .jt b{font-size:13.5px;}
.pg-automations .ch{font-size:10.5px; font-weight:700; padding:1px 7px; border-radius:20px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-2); white-space:nowrap;}
.pg-automations .jw{font-size:12px; color:var(--muted); margin-top:2px; display:flex; align-items:center; gap:5px;}
.pg-automations .jw svg{width:13px; height:13px; flex-shrink:0;}
.pg-automations .msg{margin-top:7px; font-size:12.5px; background:var(--surface-2); border:1px solid var(--border); border-radius:4px 12px 12px 12px; padding:8px 10px; line-height:1.45; color:var(--text-2); max-width:640px;}
.pg-automations .msg .v{background:var(--brand-soft); color:var(--brand-text); border-radius:4px; padding:0 3px; font-weight:700; font-size:11.5px;}
.pg-automations .msg .f{background:var(--accent-soft); color:var(--accent-text); border-radius:4px; padding:0 3px; font-weight:700;}
.pg-automations .jr-side{display:flex; flex-direction:column; align-items:flex-end; gap:6px; text-align:right;}
.pg-automations .jr-side .n{font-size:11px; color:var(--muted); white-space:nowrap;}
.pg-automations .jr-side .n b{color:var(--text); font-size:12.5px;}
.pg-automations .rl{display:grid; grid-template-columns:34px minmax(0,1fr) auto; gap:12px; padding:12px 16px; border-bottom:1px solid var(--border); align-items:start;}
.pg-automations .rl:last-child{border-bottom:none;}
.pg-automations .rl.off{background:var(--surface-2);}
.pg-automations .rl.off .rw{opacity:0.6;}
.pg-automations .ri{width:32px; height:32px; border-radius:9px; background:var(--brand-soft); color:var(--brand-strong); display:flex; align-items:center; justify-content:center;}
.pg-automations .ri svg{width:16px; height:16px;}
.pg-automations .rl.off .ri{background:var(--surface-2); color:var(--faint); border:1px solid var(--border);}
.pg-automations .rw .k{font-size:10.5px; font-weight:800; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-right:4px;}
.pg-automations .rw .w{font-size:13px; font-weight:700;}
.pg-automations .rw .t{font-size:13px; font-weight:700; margin-top:2px;}
.pg-automations .rw .dt{font-size:12px; color:var(--muted); margin-top:3px; max-width:720px;}
.pg-automations .rw .meta{display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;}
.pg-automations .rw .meta .pill{white-space:normal;}
.pg-automations .feed .fi{display:flex; gap:10px; padding:9px 16px; border-bottom:1px solid var(--border); align-items:flex-start;}
.pg-automations .feed .fi:last-child{border-bottom:none;}
.pg-automations .feed .fd{width:8px; height:8px; border-radius:50%; margin-top:6px; flex-shrink:0;}
.pg-automations .feed .ft{font-size:12.5px;}
.pg-automations .feed .fs{font-size:11px; color:var(--muted); margin-top:1px;}
.pg-automations .feed button.link{background:none; border:none; padding:0; color:var(--brand-text); font-weight:700; font-size:11px;}
.pg-automations .sample{width:auto; min-width:220px; height:32px; padding-top:4px; padding-bottom:4px; font-size:12px;}
.pg-automations .btn svg{width:14px; height:14px;}
.pg-automations .switch[disabled]{opacity:0.5; cursor:not-allowed;}
.pg-automations .chain{list-style:none; margin:0; padding:0; display:flex; flex-direction:column;}
.pg-automations .chain li{display:flex; gap:10px; align-items:flex-start; position:relative; padding-bottom:12px; font-size:12.5px;}
.pg-automations .chain li:last-child{padding-bottom:0;}
.pg-automations .chain li::before{content:""; position:absolute; left:10px; top:22px; bottom:2px; width:2px; background:var(--border);}
.pg-automations .chain li:last-child::before{display:none;}
.pg-automations .chain .cn{width:22px; height:22px; border-radius:50%; background:var(--brand-soft); color:var(--brand-text); font-weight:800; font-size:11px; display:flex; align-items:center; justify-content:center; flex-shrink:0;}
.pg-automations .chain b{display:block; font-size:12.5px;}
.pg-automations .chain .cs{font-size:11.5px; color:var(--muted); margin-top:1px;}
.au-modal .vars{display:flex; gap:5px; flex-wrap:wrap;}
.au-modal .vars button{font-size:11px; font-weight:700; border:1px solid var(--border); background:var(--surface-2); border-radius:6px; padding:3px 7px; color:var(--brand-text);}
.au-modal .preview{background:var(--surface-2); border:1px solid var(--border); border-radius:4px 12px 12px 12px; padding:9px 11px; font-size:12.5px; line-height:1.5;}
.au-modal .chk{display:flex; gap:14px; flex-wrap:wrap; font-size:13px;}
.au-modal .chk label{display:flex; gap:6px; align-items:center;}
.au-modal .chk input{accent-color:var(--brand-strong); width:16px; height:16px;}
@media (max-width:560px){
  .pg-automations .js, .pg-automations .rl{grid-template-columns:30px minmax(0,1fr); }
  .pg-automations .jr-side{grid-column:2; flex-direction:row; align-items:center; justify-content:space-between; text-align:left;}
  .pg-automations .sample{min-width:0; width:100%;}
}
`);

  /* ---------- numbers from the shared data ---------- */
  function live(b) { return b.status !== 'cancelled' && b.createdAt <= D.NOW; } /* data.js has two bookings stamped later today; ignore them until they happen */
  function in30(iso) { return iso && iso.slice(0, 10) >= FROM30 && iso.slice(0, 10) <= D.TODAY; }
  var created30 = function () { return D.bookings.filter(function (b) { return live(b) && in30(b.createdAt); }); };
  var arrivals30 = function () { return D.bookings.filter(function (b) { return live(b) && in30(b.checkIn); }); };
  var departures30 = function () { return D.bookings.filter(function (b) { return live(b) && in30(b.checkOut); }); };
  function journeyCount(step) {
    switch (step.id) {
      case 'j1': return created30().length;
      case 'j2': return created30().length + Math.round(created30().length * 0.3);
      case 'j3': case 'j4': case 'j5': return arrivals30().length;
      case 'j6': return arrivals30().filter(function (b) { return b.nights >= 3; }).length;
      case 'j7': return departures30().length * 2;
    }
    return 0;
  }
  function claims() { return D.expenses.filter(function (e) { return e.method === 'Paid personally (claim)'; }); }
  function pendingClaims() { return claims().filter(function (e) { return e.claimStatus ? e.claimStatus === 'pending' : !e.approvedAt && d.diff(e.date, D.TODAY) <= 3; }); }
  function damageReports30() { return (D.damageReports || []).filter(function (r) { return in30(r.at); }); }
  var PROBLEM = /\b(ac|aircon|air con|leak\w*|broken|no water|hot water|smell\w*|drain\w*|not working|stopped working)\b/i;
  function problemMessages30() {
    var out = [];
    D.conversations.forEach(function (c) { var m = c.messages.filter(function (x) { return x.from === 'guest' && in30(x.time) && PROBLEM.test(x.text || ''); })[0]; if (m) out.push({ c: c, m: m }); });
    return out.sort(function (a, b) { return a.m.time < b.m.time ? 1 : -1; });
  }
  function receiptsQueued() { return D.bookings.filter(function (b) { return live(b) && b.paidAt === D.TODAY && !b.receiptSent; }); }
  /* the invoice and receipt rules are the same switch as Invoices & Receipts → Invoice settings */
  var MONEY_KEY = { 'r-inv': 'autoInvoice', 'r-rcp': 'autoReceipt' };
  function syncMoney() {
    var S = D.invoiceSettings; if (!S) return;
    A.rules.forEach(function (r) { var k = MONEY_KEY[r.id]; if (!k) return; r.on = S[k] !== 'off'; if (S[k] !== 'off') r.via = S[k] === 'auto' ? 'Auto' : S[k]; });
  }
  function pushMoney(r) { var S = D.invoiceSettings, k = MONEY_KEY[r.id]; if (!S || !k) return; S[k] = !r.on ? 'off' : r.via === 'Auto' || !r.via ? 'auto' : r.via; }
  function taskFor(b) { /* the prep task the same-day rule created or moved up for this arrival */
    return D.tasks.filter(function (t) { return t.propertyId === b.propertyId && t.due.slice(0, 10) === b.checkIn && (t.type === 'Turnover' || t.type === 'Inspection'); })
      .sort(function (a, c) { return (a.status === 'done') - (c.status === 'done') || (a.due < c.due ? -1 : 1); })[0] || null; }
  function ruleStats(r) {
    var b30, n, last = null;
    switch (r.id) {
      case 'r-inv': b30 = D.bookings.filter(function (b) { return b.invoiceSent && in30(b.invoiceSent.at); }); n = b30.length; last = b30.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; })[0]; return { n: n, last: last ? 'Last: ' + last.invoiceNo + ' to ' + last.guest.name : null };
      case 'r-rcp': b30 = D.bookings.filter(function (b) { return b.receiptSent && in30(b.receiptSent.at); }); var q = receiptsQueued(); return { n: b30.length, last: q.length ? fmt.plural(q.length, 'receipt') + ' going out at 6:00 PM today' : null };
      case 'r-claim': n = claims().filter(function (e) { return in30(e.date); }).length; return { n: n, last: pendingClaims().length ? pendingClaims().length + ' waiting for approval now' : 'No claims waiting', warn: pendingClaims().length > 0 };
      case 'r-same': b30 = D.bookings.filter(function (b) { return b.sameDay && in30(b.createdAt); }); var td = b30.filter(function (b) { return b.checkIn === D.TODAY; }); return { n: b30.length, last: td.length ? 'Today: ' + td.map(function (b) { return b.guest.name + ' ' + fmt.time(b.createdAt); }).join(', ') : null, warn: td.length > 0 };
      case 'r-rules': var held = D.bookings.filter(function (b) { return live(b) && b.checkIn >= D.TODAY && b.checkIn <= d.add(D.TODAY, 1) && b.codeStatus === 'held'; }); return { n: arrivals30().length, last: held.length ? 'Code held today for ' + held.map(function (b) { return b.guest.name; }).join(' and ') : 'No codes held for today or tomorrow', warn: held.length > 0, unit: 'guests' };
      case 'r-damage': var dr = damageReports30().sort(function (a, b) { return a.at < b.at ? 1 : -1; }); return { n: dr.length, last: dr.length ? 'Last: ' + (dr[0].item || 'damage') + ' at ' + (D.propById[dr[0].propertyId] ? D.propById[dr[0].propertyId].short : '') + (dr[0].taskId ? ' → ' + dr[0].taskId : '') : null };
      case 'r-turn': return { n: departures30().length, last: null };
      case 'r-issue': var pm = problemMessages30(); return { n: pm.length, last: pm.length ? 'Last: ' + fmt.dateTime(pm[0].m.time) : null };
      case 'r-review': n = D.reviews.filter(function (x) { return x.stars <= 3 && in30(x.date); }).length; return { n: n, last: null };
      case 'r-block': n = D.blocks.filter(function (x) { return in30(x.start) || x.start > D.TODAY; }).length; return { n: n, last: null };
      case 'r-stock': return { n: 0, last: null };
      case 'r-owner': return { n: new Set(D.properties.map(function (p) { return p.owner; })).size, last: 'Next run 1 Nov', unit: 'statements' };
    }
    return { n: r.runs || 0, last: r.lastRun || null };
  }
  function canEdit() { return O.can ? O.can('automations', 'edit') : O.isOwner() || (O.viewer() || {}).role === 'ops'; }
  function audit(text) { D.auditLog = D.auditLog || []; D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: 'automations', text: text }); }

  /* ---------- template preview ---------- */
  function samples() { return D.bookings.filter(function (b) { return live(b) && b.checkIn >= D.TODAY && b.checkIn <= d.add(D.TODAY, 7); }).sort(function (a, b) { return a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : a.checkInTime < b.checkInTime ? -1 : 1; }).slice(0, 12); }
  function vars(b) {
    var p = D.propById[b.propertyId];
    return {
      property: p.name, guest_first: /^The /.test(b.guest.name) ? b.guest.name.replace(/^The /, '') : b.guest.name.split(' ')[0],
      door_code: b.doorCode, checkin_time: fmt.time(b.checkInTime), checkout_time: fmt.time(b.checkOutTime), wifi_name: p.wifi[0], wifi_password: p.wifi[1], parking: p.parking,
      id_link: O.ws().domain + '/id/' + b.id.toLowerCase(), guest_app_link: O.ws().domain + '/stay/' + b.id.toLowerCase()
    };
  }
  function fill(text, b) {
    var v = b ? vars(b) : null;
    return esc(text).replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? '<span class="f">' + esc(v[k]) + '</span>' : '<span class="v">{' + k + '}</span>'; });
  }

  /* ---------- pieces ---------- */
  function journeyHTML(edit) {
    var sm = st.sample ? D.booking(st.sample) : null;
    var opts = '<option value="">Show variables</option>' + samples().map(function (b) { return '<option value="' + b.id + '"' + (st.sample === b.id ? ' selected' : '') + '>Preview for ' + esc(b.guest.name) + ' · ' + esc(D.propById[b.propertyId].short) + ', ' + d.fmt(b.checkIn) + '</option>'; }).join('');
    var on = A.journey.filter(function (s) { return s.on; }).length;
    return '<div class="card"><div class="card-head"><div><h3>Guest message journey</h3><div class="sub">' + on + ' of 7 steps on · applies to all ' + D.properties.length + ' properties and every channel</div></div>' +
      '<select class="select sample" data-sample aria-label="Preview messages with a booking">' + opts + '</select></div>' +
      '<div class="jr">' + A.journey.map(function (s, i) {
        var n = journeyCount(s);
        return '<div class="js' + (s.on ? '' : ' off') + '"><span class="jn">' + (i + 1) + '</span><div style="min-width:0"><div class="jt"><b>' + esc(s.name) + '</b>' + s.channels.map(function (c) { return '<span class="ch">' + esc(c) + '</span>'; }).join('') + (s.on ? '' : U.pill('Paused', 'neutral')) + '</div>' +
          '<div class="jw">' + O.icon('clock') + esc(s.when) + '</div><div class="msg">' + fill(s.text, sm) + '</div></div>' +
          '<div class="jr-side"><button type="button" class="switch' + (s.on ? ' on' : '') + '" role="switch" aria-checked="' + s.on + '" aria-label="' + esc(s.name) + ' on or off" data-jtog="' + s.id + '"' + (edit ? '' : ' disabled') + '></button><span class="n"><b>' + fmt.num(n) + '</b> sent, 30 days</span>' + (edit ? '<button type="button" class="btn btn-ghost btn-xs" data-jedit="' + s.id + '">' + O.icon('edit') + 'Edit</button>' : '') + '</div></div>';
      }).join('') + '</div>' +
      '<div class="card-foot">Messages go out in the guest\'s language when we know it. Prototype: messages are not really sent.</div></div>';
  }
  function ruleRow(r, edit) {
    var s = ruleStats(r), who = r.notify ? D.staffById(r.notify) : null;
    var meta = [];
    if (r.isNew) meta.push(U.pill('New', 'accent'));
    if (who) meta.push(U.pill('Notifies ' + who.name + (r.via ? ' on ' + r.via : ''), 'neutral'));
    if (r.scope && r.scope !== 'all') meta.push(U.pill(fmt.plural(r.scope.length, 'property', 'properties'), 'neutral'));
    if (MONEY_KEY[r.id]) meta.push(U.pill('Sends by ' + (!r.via || r.via === 'Auto' ? 'WhatsApp or email' : r.via), 'neutral'));
    if (!r.on) meta.push(U.pill('Paused', 'neutral'));
    if (s.last) meta.push(U.pill(s.last, s.warn ? 'warn' : 'info'));
    return '<div class="rl' + (r.on ? '' : ' off') + '"><span class="ri">' + O.icon(r.icon || 'automations') + '</span><div class="rw" style="min-width:0"><div class="w"><span class="k">When</span>' + esc(r.when) + '</div><div class="t"><span class="k">Then</span>' + esc(r.then) + '</div>' +
      '<div class="dt">' + esc(r.detail) + '</div>' + (meta.length ? '<div class="meta">' + meta.join('') + '</div>' : '') + '</div>' +
      '<div class="jr-side"><button type="button" class="switch' + (r.on ? ' on' : '') + '" role="switch" aria-checked="' + r.on + '" aria-label="' + esc(r.then) + ' on or off" data-rtog="' + r.id + '"' + (edit ? '' : ' disabled') + '></button><span class="n"><b>' + fmt.num(s.n) + '</b> ' + (s.unit || 'runs') + ', 30 days</span>' + (edit ? '<button type="button" class="btn btn-ghost btn-xs" data-redit="' + r.id + '">' + O.icon('edit') + 'Edit</button>' : '') + '</div></div>';
  }
  function rulesHTML(edit) {
    return GROUPS.filter(function (g) { return st.group === 'all' || st.group === g[0] || (st.group === 'new' && A.rules.some(function (r) { return r.group === g[0] && r.isNew; })); }).map(function (g) {
      var rs = A.rules.filter(function (r) { return r.group === g[0] && (st.group !== 'new' || r.isNew); });
      if (!rs.length) return '';
      return '<div class="card"><div class="card-head"><div><h3>' + esc(g[1]) + '</h3><div class="sub">' + rs.filter(function (r) { return r.on; }).length + ' of ' + rs.length + ' on</div></div></div><div>' + rs.map(function (r) { return ruleRow(r, edit); }).join('') + '</div></div>';
    }).join('') + (A.rules.some(function (r) { return r.group === 'custom'; }) && (st.group === 'all' || st.group === 'custom') ?
      '<div class="card"><div class="card-head"><div><h3>Your automations</h3><div class="sub">Rules you added</div></div></div><div>' + A.rules.filter(function (r) { return r.group === 'custom'; }).map(function (r) { return ruleRow(r, edit); }).join('') + '</div></div>' : '');
  }
  function feedHTML() {
    var out = [], sameRule = A.rules.filter(function (r) { return r.id === 'r-same'; })[0], ops = sameRule && sameRule.notify ? D.staffById(sameRule.notify) : null;
    D.bookings.filter(function (b) { return live(b) && b.sameDay && b.checkIn === D.TODAY; }).forEach(function (b) {
      var p = D.propById[b.propertyId], t = taskFor(b), who = t && t.assigneeId ? D.staffById(t.assigneeId) : null;
      out.push({ at: b.createdAt, tone: 'var(--warn)', t: 'Same-day booking: ' + b.guest.name + ' at ' + p.short + ', arriving ' + fmt.time(b.checkInTime),
        s: (ops ? 'Alerted ' + ops.name : 'Alert sent') + (t ? ' · ' + t.title.toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); }) + ' ' + t.id + ' marked urgent for ' + (who ? who.name : 'nobody yet') + ', due ' + fmt.time(t.due) : ''), bk: b.id, task: t ? t.id : null });
    });
    D.bookings.filter(function (b) { return live(b) && b.invoiceSent && b.invoiceSent.at === D.TODAY; }).forEach(function (b) { out.push({ at: b.createdAt, tone: 'var(--ok)', t: 'Invoice ' + b.invoiceNo + ' sent to ' + b.guest.name, s: 'By ' + b.invoiceSent.via + ' · ' + fmt.money(b.total), bk: b.id }); });
    D.bookings.filter(function (b) { return live(b) && b.createdAt.slice(0, 10) === D.TODAY && !b.invoiceSent; }).forEach(function (b) { out.push({ at: b.createdAt, tone: 'var(--bad)', t: 'Invoice ' + b.invoiceNo + ' for ' + b.guest.name + ' did not go out', s: 'Email to ' + b.guest.email + ' bounced · send it by WhatsApp from the booking', bk: b.id }); });
    var rq = receiptsQueued();
    if (rq.length) out.push({ at: rq.map(function (b) { return b.createdAt.slice(0, 10) === D.TODAY ? b.createdAt : D.TODAY + 'T08:00'; }).sort().pop(), tone: 'var(--info)', t: fmt.plural(rq.length, 'receipt') + ' ready to go out at 6:00 PM', s: rq.map(function (b) { return b.guest.name; }).join(', ') + ' paid today', go: 'invoices' });
    D.bookings.filter(function (b) { return live(b) && b.checkIn === D.TODAY && b.codeStatus === 'held'; }).forEach(function (b) { out.push({ at: D.TODAY + 'T09:00', tone: 'var(--warn)', t: 'Door code held for ' + b.guest.name, s: (b.idVerified ? 'House rules not accepted yet' : 'ID not verified and house rules not accepted') + ' · ' + D.propById[b.propertyId].short, bk: b.id }); });
    D.bookings.filter(function (b) { return live(b) && b.checkIn === d.add(D.TODAY, 1) && b.codeStatus !== 'held'; }).slice(0, 2).forEach(function (b) { out.push({ at: D.TODAY + 'T09:00', tone: 'var(--ok)', t: 'Check-in day message scheduled for ' + b.guest.name, s: 'Goes out tomorrow at 9:00 AM · ' + D.propById[b.propertyId].short, bk: b.id }); });
    pendingClaims().filter(function (e) { return d.diff(e.date, D.TODAY) <= 1; }).slice(0, 2).forEach(function (e) { var w = D.staffById(e.paidBy); out.push({ at: e.date + 'T' + (e.date === D.TODAY ? '08:30' : '18:00'), tone: 'var(--info)', t: 'Claim from ' + w.name + ': ' + fmt.money(e.amount) + ' ' + (e.type === 'Others' ? e.otherType || 'other' : e.type).toLowerCase(), s: 'Sent to ' + ((D.staffById('s1') || {}).name || 'the owner') + ' for approval', go: 'expenses' }); });
    D.bookings.filter(function (b) { return live(b) && b.checkOut === D.TODAY; }).forEach(function (b) {
      var t = D.tasks.filter(function (x) { return x.type === 'Turnover' && x.propertyId === b.propertyId && x.due.slice(0, 10) === D.TODAY; })[0];
      if (t) out.push({ at: D.TODAY + 'T07:30', tone: 'var(--ok)', t: 'Turnover created for ' + D.propById[t.propertyId].short + ' after ' + b.guest.name + ' checks out', s: 'Assigned to ' + (t.assigneeId ? D.staffById(t.assigneeId).name : 'nobody yet'), task: t.id });
    });
    damageReports30().filter(function (r) { return r.at.slice(0, 10) >= d.add(D.TODAY, -1); }).forEach(function (r) { out.push({ at: r.at, tone: 'var(--bad)', t: 'Damage reported' + (r.item ? ': ' + r.item : '') + (D.propById[r.propertyId] ? ' at ' + D.propById[r.propertyId].short : ''), s: (r.taskId ? 'Maintenance task ' + r.taskId + ' created with ' : 'Logged with ') + fmt.plural((r.photos || []).length || 1, 'photo'), task: r.taskId || null, go: r.taskId ? null : 'guestapp' }); });
    out = out.filter(function (f) { return f.at.slice(0, 10) >= d.add(D.TODAY, -1); });
    out.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    function when(at) { return at.slice(0, 10) === D.TODAY ? fmt.time(at) : 'Yesterday ' + fmt.time(at); }
    return '<div class="card feed"><div class="card-head"><div><h3>Ran today</h3><div class="sub">What the automations did since yesterday evening</div></div></div>' +
      (out.length ? out.slice(0, 10).map(function (f) {
        var links = (f.bk ? '<button type="button" class="link" data-bk="' + f.bk + '">Open booking</button>' : '') + (f.task ? (f.bk ? ' · ' : '') + '<button type="button" class="link" data-task="' + f.task + '">Open task</button>' : '') + (!f.bk && !f.task && f.go ? '<button type="button" class="link" data-go="' + f.go + '">Open</button>' : '');
        return '<div class="fi"><span class="fd" style="background:' + f.tone + '"></span><div class="grow"><div class="ft">' + esc(f.t) + '</div><div class="fs">' + when(f.at) + ' · ' + esc(f.s) + (links ? ' · ' + links : '') + '</div></div></div>';
      }).join('') : U.empty('Nothing has run yet today.')) + '</div>';
  }

  /* ---------- modals ---------- */
  function editStep(id) {
    var s = A.journey.filter(function (x) { return x.id === id; })[0], sm = (st.sample && D.booking(st.sample)) || samples()[0];
    var VARS = ['guest_first', 'property', 'checkin_time', 'checkout_time', 'door_code', 'wifi_name', 'wifi_password', 'parking', 'id_link', 'guest_app_link'];
    var CH = ['WhatsApp', 'Email', 'SMS', 'Smart lock', 'Booking platform'];
    var body = '<div class="au-modal stack"><div class="field"><label for="au-when">When it goes out</label><input class="input" id="au-when" name="when" value="' + esc(s.when) + '"></div>' +
      '<div class="field"><span class="label">Send on</span><div class="chk">' + CH.map(function (c) { return '<label><input type="checkbox" name="ch" value="' + c + '"' + (s.channels.indexOf(c) >= 0 ? ' checked' : '') + '>' + c + '</label>'; }).join('') + '</div></div>' +
      '<div class="field"><label for="au-text">Message</label><textarea class="textarea" id="au-text" name="text" rows="4">' + esc(s.text) + '</textarea><div class="vars" aria-label="Insert a variable">' + VARS.map(function (v) { return '<button type="button" data-var="' + v + '">{' + v + '}</button>'; }).join('') + '</div></div>' +
      '<div class="field"><span class="label">Preview for ' + esc(sm.guest.name) + ' at ' + esc(D.propById[sm.propertyId].short) + '</span><div class="preview" data-prev></div></div></div>';
    U.modal({
      title: 'Edit step: ' + s.name, sub: 'Changes apply to messages not sent yet', body: body, size: 'wide',
      onOpen: function (el) {
        var ta = O.$('[name=text]', el);
        function paint() { O.$('[data-prev]', el).innerHTML = fill(ta.value, sm); }
        ta.addEventListener('input', paint);
        el.addEventListener('click', function (e) { var b = e.target.closest('[data-var]'); if (!b) return; var p = ta.selectionStart || ta.value.length; ta.value = ta.value.slice(0, p) + '{' + b.dataset.var + '}' + ta.value.slice(ta.selectionEnd || p); ta.focus(); paint(); });
        paint();
      },
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save step', kind: 'primary', onClick: function (close, el) {
        var ch = O.$$('[name=ch]:checked', el).map(function (i) { return i.value; });
        if (!ch.length) { U.toast('Pick at least one channel', 'bad'); return false; }
        if (!O.$('[name=text]', el).value.trim()) { U.toast('The message cannot be empty', 'bad'); return false; }
        s.channels = ch; s.when = O.$('[name=when]', el).value.trim() || s.when; s.text = O.$('[name=text]', el).value.trim();
        audit('Edited the "' + s.name + '" message'); U.toast('"' + s.name + '" saved'); O.emit('data', { type: 'automations' });
      } }]
    });
  }
  function scopeField(sc) {
    var all = !sc || sc === 'all';
    return '<div class="field full"><label for="au-scope">Properties</label><select class="select" id="au-scope" name="scope"><option value="all"' + (all ? ' selected' : '') + '>All ' + D.properties.length + ' properties</option>' + D.properties.map(function (p) { return '<option value="' + p.id + '"' + (!all && sc.length === 1 && sc[0] === p.id ? ' selected' : '') + '>Only ' + esc(p.name) + '</option>'; }).join('') + '</select></div>';
  }
  function editRule(id) {
    var r = A.rules.filter(function (x) { return x.id === id; })[0];
    var body = '<div class="au-modal stack"><div class="note brand"><b>When</b> ' + esc(r.when.toLowerCase()) + ' <b>then</b> ' + esc(r.then.toLowerCase()) + '.</div><div class="form-grid">' +
      (r.notify !== null || r.group === 'custom' ? '<div class="field"><label for="au-who">Who gets notified</label><select class="select" id="au-who" name="notify"' + (r.notifyLocked ? ' disabled' : '') + '>' + U.staffOptions(r.notify, { none: 'Nobody' }) + '</select>' + (r.notifyLocked ? '<span class="hint">Only account owners can approve claims.</span>' : '') + '</div>' : '') +
      (r.via ? '<div class="field"><label for="au-via">Send by</label><select class="select" id="au-via" name="via">' + (MONEY_KEY[r.id] ? ['Auto', 'WhatsApp', 'Email'] : ['WhatsApp', 'Email', 'App', 'SMS']).map(function (v) { return '<option value="' + v + '"' + (r.via === v ? ' selected' : '') + '>' + (v === 'Auto' ? 'WhatsApp for direct guests, email for platform guests' : v === 'App' ? 'In-app notification' : v) + '</option>'; }).join('') + '</select></div>' : '') +
      scopeField(r.scope) +
      '<div class="field full"><label for="au-detail">Details</label><textarea class="textarea" id="au-detail" name="detail">' + esc(r.detail) + '</textarea></div></div></div>';
    U.modal({
      title: r.then, sub: 'Automation rule', body: body, size: 'wide',
      actions: [r.group === 'custom' ? { label: 'Delete', kind: 'ghost', onClick: function () { A.rules.splice(A.rules.indexOf(r), 1); audit('Deleted the automation "' + r.then + '"'); U.toast('Automation deleted'); O.emit('data', { type: 'automations' }); } } : null, { label: 'Cancel', kind: 'ghost' }, { label: 'Save', kind: 'primary', onClick: function (close, el) {
        var n = O.$('[name=notify]', el), v = O.$('[name=via]', el), sc = O.$('[name=scope]', el).value;
        if (n && !n.disabled) r.notify = n.value || null;
        if (v) r.via = v.value;
        r.scope = sc === 'all' ? 'all' : [sc];
        r.detail = O.$('[name=detail]', el).value.trim() || r.detail;
        pushMoney(r);
        audit('Edited the automation "' + r.then + '"'); U.toast('Automation saved' + (MONEY_KEY[r.id] ? '. Invoices & Receipts uses the same setting.' : '')); O.emit('data', { type: 'automations' });
      } }].filter(Boolean)
    });
  }
  function newRule() {
    var body = '<div class="au-modal stack"><div class="form-grid">' +
      '<div class="field full"><label for="nr-when">When</label><select class="select" id="nr-when" name="when">' + TRIGGERS.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field full"><label for="nr-then">Then</label><select class="select" id="nr-then" name="then">' + ACTIONS.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="nr-who">Who gets notified or assigned</label><select class="select" id="nr-who" name="notify">' + U.staffOptions('s2', { none: 'Nobody' }) + '</select></div>' +
      '<div class="field"><label for="nr-via">Send by</label><select class="select" id="nr-via" name="via"><option>WhatsApp</option><option>Email</option><option value="App">In-app notification</option></select></div>' +
      scopeField('all') +
      '<div class="field full"><label for="nr-detail">Details (optional)</label><textarea class="textarea" id="nr-detail" name="detail" placeholder="For example: only for stays of 5 nights or more"></textarea></div></div></div>';
    U.modal({
      title: 'New automation', sub: 'Pick a trigger and what should happen', body: body, size: 'wide',
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Create and turn on', kind: 'primary', onClick: function (close, el) {
        var g = function (n) { return O.$('[name=' + n + ']', el).value; };
        var r = { id: 'r-c' + (A.rules.reduce(function (m, x) { var n = +String(x.id).replace(/\D/g, ''); return n > m ? n : m; }, 0) + 1), group: 'custom', on: true, icon: 'sparkle', when: g('when'), then: g('then'), detail: g('detail').trim() || 'Added by ' + O.viewer().name + ' on ' + d.fmtY(D.TODAY) + '.', via: g('via'), notify: g('notify') || null, scope: g('scope') === 'all' ? 'all' : [g('scope')], runs: 0, lastRun: 'Not run yet' };
        A.rules.push(r); st.group = 'all';
        audit('Created the automation "When ' + r.when.toLowerCase() + ', ' + r.then.toLowerCase() + '"');
        U.toast('Automation created and on'); O.emit('data', { type: 'automations' });
      } }]
    });
  }

  var WARN_OFF = {
    'r-rules': 'Turn off the house rules check? Guests will see their door code without accepting the house rules.',
    'r-inv': 'Turn off automatic invoices? New bookings will need an invoice sent by hand from Invoices & Receipts.',
    'r-rcp': 'Turn off automatic receipts? Guests will not get a receipt when they pay unless someone sends it.',
    'r-same': 'Turn off same-day alerts? Late bookings for today will not alert anyone or create an urgent clean.',
    'r-claim': 'Turn off claim notifications? Claims will still wait for approval but the owner will not be told.',
    'j4': 'Pause the door code step? Guests will not receive a door code automatically.'
  };
  function toggle(item, label, ctx) {
    function apply() { item.on = !item.on; pushMoney(item); audit((item.on ? 'Turned on ' : 'Turned off ') + '"' + label + '"'); U.toast(label + (item.on ? ' is on' : ' is paused'), item.on ? 'ok' : 'bad'); O.emit('data', { type: 'automations' }); }
    if (item.on && WARN_OFF[item.id]) U.confirm(WARN_OFF[item.id], 'Turn off', 'danger').then(function (ok) { if (ok) apply(); });
    else apply();
  }

  /* ---------- page ---------- */
  O.page('automations', {
    desc: 'Messages, documents and tasks that run by themselves for every booking',
    render: function (root, ctx) {
      syncMoney();
      if (O.can && !O.can('automations', 'view')) {
        ctx.setActions('');
        var v = O.viewer(), ROLE_RULES = { housekeeping: ['r-turn', 'r-same', 'r-stock'], maintenance: ['r-damage', 'r-issue'], accountant: ['r-inv', 'r-rcp', 'r-claim', 'r-owner'] };
        var mine = A.rules.filter(function (r) { return r.notify === v.id || (ROLE_RULES[v.role] || []).indexOf(r.id) >= 0; });
        root.innerHTML = '<div class="pg-automations stack"><div class="locked"><div class="lk">🔒</div><b>Automations are not part of the ' + esc(v.roleLabel) + ' role</b><div class="small">You are viewing as ' + esc(v.name) + '. An account owner can give access in Staff Access.</div></div>' +
          (mine.length ? '<div class="card"><div class="card-head"><div><h3>Automations that involve you</h3><div class="sub">These run by themselves and may send you work</div></div></div><div>' + mine.map(function (r) {
            return '<div class="rl' + (r.on ? '' : ' off') + '"><span class="ri">' + O.icon(r.icon || 'automations') + '</span><div class="rw" style="min-width:0"><div class="w"><span class="k">When</span>' + esc(r.when) + '</div><div class="t"><span class="k">Then</span>' + esc(r.then) + '</div><div class="dt">' + esc(r.detail) + '</div></div><div class="jr-side">' + (r.on ? U.pill('On', 'ok') : U.pill('Paused', 'neutral')) + '</div></div>';
          }).join('') + '</div></div>' : '') + '</div>';
        return;
      }
      var edit = canEdit();
      ctx.setActions(edit ? '<button type="button" class="btn btn-primary" data-act="new">' + O.icon('plus') + 'New automation</button>' : '');
      ctx.actionsEl.onclick = function (e) { if (e.target.closest('[data-act=new]')) newRule(); };
      var msgs = A.journey.filter(function (s) { return s.on; }).reduce(function (a, s) { return a + journeyCount(s); }, 0);
      var inv = D.bookings.filter(function (b) { return b.invoiceSent && in30(b.invoiceSent.at); }).length;
      var rcp = D.bookings.filter(function (b) { return b.receiptSent && in30(b.receiptSent.at); }).length;
      var tasks = departures30().length + D.bookings.filter(function (b) { return live(b) && b.sameDay && in30(b.createdAt); }).length + damageReports30().length + problemMessages30().length;
      var onN = A.rules.filter(function (r) { return r.on; }).length + A.journey.filter(function (s) { return s.on; }).length, all = A.rules.length + A.journey.length;
      var hours = (msgs * 2 + (inv + rcp) * 4 + tasks * 3) / 60;
      var newN = A.rules.filter(function (r) { return r.isNew; }).length;
      var held = D.bookings.filter(function (b) { return live(b) && b.checkIn >= D.TODAY && b.checkIn <= d.add(D.TODAY, 1) && b.codeStatus === 'held'; });
      var rulesOn = (A.rules.filter(function (r) { return r.id === 'r-rules'; })[0] || {}).on, codeOn = (A.journey.filter(function (x) { return x.id === 'j4'; })[0] || {}).on;
      var chain = [
        ['Booking confirmed', 'Invoice and welcome message go out'],
        ['ID verified', 'Guest uploads IC or passport from the link'],
        ['House rules accepted', rulesOn ? 'Ticked and signed in the guest app' : 'Paused: guests can skip the house rules'],
        ['Code sent 24 hours before', codeOn ? 'By WhatsApp and set on the smart lock' : 'Paused: send codes by hand'],
        ['Code works from check-in time', 'Expires at check-out time']
      ];
      root.innerHTML = '<div class="pg-automations stack">' +
        U.kpis([
          { label: 'Automations on', value: onN + ' / ' + all, sub: (all - onN) ? (all - onN) + ' paused' : 'Everything is running' },
          { label: 'Guest messages, 30 days', value: fmt.num(msgs), sub: 'From the 7-step journey' },
          { label: 'Invoices sent automatically', value: fmt.num(inv), sub: fmt.num(rcp) + ' receipts too, 30 days' },
          { label: 'Tasks created, 30 days', value: fmt.num(tasks), sub: 'Turnovers, same-day, repairs' },
          { label: 'Time saved, 30 days', value: '≈ ' + Math.round(hours) + ' h', sub: 'At 2–4 min per manual step' }
        ]) +
        (!edit ? '<div class="note">You can see the automations. Changing them needs Edit access to Automations (Staff Access).</div>' : '') +
        '<div class="grid g-2-1" style="align-items:start"><div class="stack">' + journeyHTML(edit) +
        '<div class="row-flex wrap" style="justify-content:space-between"><div class="section-title" style="margin:6px 0 0">Rules</div>' + U.seg([['all', 'All rules'], ['new', 'New this round (' + newN + ')'], ['guest', 'Guests'], ['money', 'Money'], ['ops', 'Operations']], st.group, 'data-grp') + '</div>' +
        rulesHTML(edit) + '</div>' +
        '<div class="stack">' + feedHTML() +
        '<div class="card"><div class="card-head"><div><h3>Door code safety chain</h3><div class="sub">What has to happen before a guest can open the door</div></div></div><div class="card-body stack">' +
        '<ol class="chain">' + chain.map(function (c, i) { return '<li><span class="cn">' + (i + 1) + '</span><div><b>' + esc(c[0]) + '</b><div class="cs">' + esc(c[1]) + '</div></div></li>'; }).join('') + '</ol>' +
        (held.length ? '<div class="note warn">Held now: ' + held.sort(function (a, b) { return (a.checkIn + a.checkInTime) < (b.checkIn + b.checkInTime) ? -1 : 1; }).map(function (b) { return esc(b.guest.name) + ' (' + (b.idVerified ? 'house rules' : 'ID check') + ', ' + (b.checkIn === D.TODAY ? 'arrives today ' + fmt.time(b.checkInTime) : 'arrives tomorrow') + ')'; }).join('; ') + '</div>' : '<div class="note">No codes are held for today or tomorrow.</div>') +
        '<div class="small muted">If any step is missing the code is held and the front desk sees it on the dashboard. The guest app asks for the house rules first, every time.</div>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="lock" style="align-self:flex-start">' + O.icon('key') + 'Change a door code</button></div></div>' +
        '</div></div></div>';

      var pg = O.$('.pg-automations', root);
      pg.addEventListener('click', function (e) {
        var b;
        if ((b = e.target.closest('[data-jtog]'))) { var s = A.journey.filter(function (x) { return x.id === b.dataset.jtog; })[0]; toggle(s, 'Journey step "' + s.name + '"', ctx); return; }
        if ((b = e.target.closest('[data-rtog]'))) { var r = A.rules.filter(function (x) { return x.id === b.dataset.rtog; })[0]; toggle(r, r.then, ctx); return; }
        if ((b = e.target.closest('[data-jedit]'))) { editStep(b.dataset.jedit); return; }
        if ((b = e.target.closest('[data-redit]'))) { editRule(b.dataset.redit); return; }
        if ((b = e.target.closest('[data-grp]'))) { st.group = b.dataset.grp; ctx.rerender(); return; }
        if ((b = e.target.closest('[data-bk]'))) { O.booking.open(b.dataset.bk); return; }
        if ((b = e.target.closest('[data-go]'))) { O.go(b.dataset.go); return; }
        if ((b = e.target.closest('[data-task]'))) { O.go('tasks', { taskId: b.dataset.task }); return; }
        if ((b = e.target.closest('[data-act=lock]'))) { O.lock.change({ scope: 'guest' }); return; }
      });
      pg.addEventListener('change', function (e) { if (e.target.matches('[data-sample]')) { st.sample = e.target.value || null; ctx.rerender(); } });
    }
  });
})();
