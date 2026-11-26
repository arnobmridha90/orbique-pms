/* ===================================================================
   The bell's shared history (production only; migration 0031). O.notify
   The database writes one row per thing that happens in the workspace (public.notifications: new bookings and every
   change to one, guest messages, Team chat, tasks, reviews, payments, door codes, prices, sync problems, the 9 AM
   summary...), so every phone and computer shows the same list, including what happened while Orbique was closed.
   This file reads the newest rows, follows new ones live, turns each {kind, vars} into words in the reader's language,
   rings the alert tone for each one someone else (or a booking site, a guest, the server) caused, and keeps the unread
   count per person (public.notification_seen), so opening the bell on the phone clears it on the computer too.
   Sounds: a few kinds already ring from their own pages while Orbique is open (booking-site bookings, cancellations and
   new dates: booking-alerts.js; guest messages: inbox.js; Team chat: team.js; a new task for you: tasks.js); those are
   not rung twice here. Every other kind rings here. Each group can be muted on this device from the bell.
   The bell (app/core.js) uses O.notify.list() when O.notify.active(), else this device's own O.alertLog.
   =================================================================== */
(function () {
  var O = window.O, D = O.data;
  if (!O.auth || !O.auth.enabled || !O.auth.enabled()) return;

  var LOAD = 120, MUTE = 'notifyMute', CLEARED = 'notifyCleared';
  var S = { org: null, rows: [], seen: 0, ok: false, ch: null, loading: false, me: null };
  function sb() { return O.auth.supabase(); }

  /* ---- what each kind says ----
     group: which mute switch and tone; icon; t: English title (translated, {placeholders} filled from vars);
     page: the section a person must be able to open to see it (O.allowed); rung: already rung by its own page */
  var G = {
    bookings: { tone: 'booking', label: 'New bookings' },
    changes: { tone: 'change', label: 'Booking changes' },
    stays: { tone: 'booking', label: 'Arrivals and departures' },
    money: { tone: 'change', label: 'Payments and money' },
    messages: { tone: 'message', label: 'Guest messages and reviews' },
    team: { tone: 'team', label: 'Team chat' },
    tasks: { tone: 'task', label: 'Tasks and cleaning' },
    problems: { tone: 'change', label: 'Problems and warnings' }
  };
  var K = {
    bk_new: ['bookings', '🛎️', 'New booking: {guest}', 'bookings'],
    bk_request: ['bookings', '🛎️', 'Booking request: {guest}', 'bookings'],
    bk_confirmed: ['bookings', '✅', 'Booking confirmed: {guest}', 'bookings'],
    bk_cancelled: ['changes', '❌', 'Booking cancelled: {guest}', 'bookings'],
    bk_dates: ['changes', '📅', 'New dates: {guest}', 'bookings'],
    bk_moved: ['changes', '🔀', 'Moved to another unit: {guest}', 'bookings'],
    bk_guests: ['changes', '👥', 'Number of guests changed: {guest}', 'bookings'],
    bk_price: ['changes', '💲', 'Price changed: {guest}', 'bookings'],
    bk_noshow: ['changes', '🚫', 'No-show: {guest}', 'bookings'],
    bk_edit: ['changes', '✏️', 'Booking details changed: {guest}', 'bookings'],
    avail_block: ['changes', '⛔', 'Dates blocked', 'calendar'],
    avail_open: ['changes', '🔓', 'Blocked dates opened again', 'calendar'],
    rates_changed: ['changes', '🏷️', 'Prices changed by {who}', 'pricing'],
    bk_checkin: ['stays', '🔑', 'Checked in: {guest}', 'bookings'],
    bk_checkout: ['stays', '👋', 'Checked out: {guest}', 'bookings'],
    gst_id: ['stays', '🪪', 'ID verified: {guest}', 'bookings'],
    gst_checkin: ['stays', '📝', 'Online check-in done: {guest}', 'bookings'],
    gst_rules: ['stays', '📜', 'House rules accepted: {guest}', 'bookings'],
    bk_code: ['stays', '🔢', 'Door code set: {guest}', 'bookings'],
    bk_code_sent: ['stays', '📨', 'Check-in details sent: {guest}', 'bookings'],
    bk_paid: ['money', '💰', 'Payment received: {guest}', 'bookings'],
    bk_invoice: ['money', '🧾', 'Invoice sent: {guest}', 'invoices'],
    bk_receipt: ['money', '🧾', 'Receipt sent: {guest}', 'invoices'],
    expense_new: ['money', '💸', 'New expense: {type}', 'expenses'],
    bk_unpaid: ['money', '⚠️', 'Not paid yet: {guest}', 'bookings'],
    gst_msg: ['messages', '💬', 'New message from {guest}', 'inbox', true],
    review_new: ['messages', '⭐', 'New review from {guest}', 'reviews'],
    gst_request: ['messages', '🙋', 'Guest request: {type}', 'tasks'],
    owner_msg: ['messages', '📩', 'Message from owner {from}', 'owner'],
    msg_failed: ['problems', '⚠️', 'A timed message could not be sent', 'greetings'],
    team_msg: ['team', '👥', 'Team chat: {chat}', 'team', true],
    staff_joined: ['team', '🙌', 'New team member: {staff}', 'staff'],
    task_new: ['tasks', '🧹', 'New task: {title}', 'tasks'],
    task_assigned: ['tasks', '🧹', 'Task assigned: {title}', 'tasks'],
    task_done: ['tasks', '✔️', 'Task done: {title}', 'tasks'],
    task_changed: ['tasks', '🕒', 'Task changed: {title}', 'tasks'],
    task_overdue: ['tasks', '⏰', 'Task overdue: {title}', 'tasks'],
    ready_late: ['tasks', '⏳', 'Unit not ready, guest arrives soon: {guest}', 'tasks'],
    bk_noclean: ['tasks', '🧽', 'Check-out today with no cleaning task: {guest}', 'tasks'],
    damage_new: ['tasks', '🛠️', 'Damage reported: {type}', 'tasks'],
    stock_low: ['tasks', '📦', 'Low stock: {item}', 'inventory'],
    daily_summary: ['tasks', '☀️', 'Today: {arrivals} arrivals, {departures} departures, {tasks} tasks', 'dashboard'],
    bk_nocode: ['problems', '🔐', 'Arriving soon, check-in details not sent: {guest}', 'bookings'],
    bk_overlap: ['problems', '‼️', 'Double booking: {guest} and {guest2}', 'bookings'],
    sys_double_booking: ['problems', '‼️', 'Double booking from a booking site', 'channels'],
    sys_needs_unit: ['problems', '🏠', 'A booking needs a unit', 'channels'],
    sys_unmapped_room: ['problems', '🔗', 'A booking site room is not linked to a unit', 'channels'],
    sys_unmapped_rate: ['problems', '🔗', 'A booking site rate is not linked', 'channels'],
    sys_sync_error: ['problems', '⚠️', 'Booking site sync problem', 'channels'],
    sys_rate_warning: ['problems', '⚠️', 'Price warning from a booking site', 'channels'],
    sys_non_acked: ['problems', '⚠️', 'A booking was not confirmed to the booking site', 'channels'],
    sys_channel_disconnected: ['problems', '🔌', 'A booking site is disconnected', 'channels'],
    sys_health: ['problems', '🩺', 'System health needs a look', 'health']
  };

  function kind(r) { return K[r.kind] || ['problems', '🔔', 'Something changed', 'dashboard']; }
  function unit(id) { var p = id && D.propById && D.propById[id]; return p ? p.short || p.name : ''; }
  function who(r) { var s = r.actor_staff && D.staffById && D.staffById[r.actor_staff]; return s ? s.name : ''; }
  function money(n) { return n == null || n === '' || isNaN(Number(n)) ? '' : (O.fmt && O.fmt.money ? O.fmt.money(Number(n)) : 'RM ' + Number(n).toFixed(2)); }
  function range(a, b) { try { return a && b ? O.d.fmtRange(a, b) : a ? O.d.fmt(a) : ''; } catch (e) { return a || ''; } }
  function when(t) { try { return t ? O.fmt.dateTime(t) : ''; } catch (e) { return t || ''; } }
  function plat(c) { return c && O.ui && O.ui.platName ? O.ui.platName(c) : c || ''; }
  function staffName(id) { var s = id && D.staffById && D.staffById[id]; return s ? s.name : ''; }
  function chatName(v) { return v.chat || (v.chatKind === 'all' ? O.tr('Everyone') : O.tr('Chat')); }

  /* the second line: where, when and what */
  function sub(r) {
    var v = r.vars || {}, k = r.kind, bits = [];
    if (k === 'gst_msg') return [unit(v.unit), v.text || (v.type === 'voice' ? O.tr('Voice message') : v.type === 'image' ? O.tr('Photo') : '')].filter(Boolean).join(' · ');
    if (k === 'team_msg') return [v.from ? staffName(v.from) || v.from : '', v.text].filter(Boolean).join(': ');
    if (k === 'review_new') return [plat(v.site), v.stars ? v.stars + '★' : v.score ? v.score + '/10' : '', v.text].filter(Boolean).join(' · ');
    if (/^task_|^damage_|^gst_request$/.test(k)) {
      bits.push(unit(v.unit));
      if (k === 'task_done' && v.doneBy) bits.push(O.tpl('by {who}', { who: staffName(v.doneBy) || v.doneBy }));
      else if (k === 'task_changed' && v.oldDue && v.due && v.oldDue !== v.due) bits.push(when(v.oldDue) + ' → ' + when(v.due));
      else if (v.due) bits.push(O.tpl('due {when}', { when: when(v.due) }));
      var to = (v.to || []).map(staffName).filter(Boolean); if (to.length && k !== 'task_done') bits.push(to.join(', '));
      if (v.text) bits.push(v.text);
      return bits.filter(Boolean).join(' · ');
    }
    if (k === 'daily_summary') return O.tpl('{n} guests staying', { n: v.inHouse || 0 });
    if (k === 'stock_low') return O.tpl('{qty} left (reorder at {reorder})', { qty: v.qty == null ? '?' : v.qty, reorder: v.reorder == null ? '?' : v.reorder });
    if (k === 'expense_new') return [money(v.amount), unit(v.unit), v.text].filter(Boolean).join(' · ');
    if (k === 'owner_msg' || k === 'msg_failed' || /^sys_/.test(k)) return [unit(v.unit), v.step, v.text || v.error].filter(Boolean).join(' · ');
    if (k === 'avail_block' || k === 'avail_open') return [unit(v.unit), range(v.from, v.to), v.text].filter(Boolean).join(' · ');
    if (k === 'rates_changed') return '';
    if (k === 'staff_joined') return v.role || '';
    /* bookings */
    bits.push(k === 'bk_moved' && v.oldUnit ? unit(v.oldUnit) + ' → ' + unit(v.unit) : unit(v.unit));
    if (k === 'bk_dates' && v.oldIn) bits.push(range(v.oldIn, v.oldOut) + ' → ' + range(v.in, v.out));
    else if (k === 'bk_nocode' || k === 'ready_late') bits.push(O.tpl('arrives {when}', { when: when(v.at) }));
    else bits.push(range(v.in, v.out));
    if (k === 'bk_guests') bits.push((v.oldGuests != null ? v.oldGuests + ' → ' : '') + O.tpl('{n} guests', { n: v.guests || 0 }));
    if (k === 'bk_price') bits.push((v.oldTotal != null ? money(v.oldTotal) + ' → ' : '') + money(v.total));
    if (k === 'bk_new' || k === 'bk_request' || k === 'bk_paid' || k === 'bk_unpaid') bits.push(money(v.total));
    if (k === 'bk_paid' && v.method) bits.push(v.method);
    if ((k === 'bk_invoice' || k === 'bk_receipt') && v.no) bits.push(v.no);
    if (k === 'bk_edit' && v.fields && v.fields.length) bits.push(v.fields.join(', '));
    if (v.ch) bits.push(plat(v.ch));
    if (k === 'bk_new' && v.urgent) bits.unshift(O.tr('Arriving today'));
    return bits.filter(Boolean).join(' · ');
  }
  function title(r) {
    var v = Object.assign({}, r.vars || {}), k = kind(r);
    if (!v.guest) v.guest = O.tr('Guest');
    v.who = who(r) || O.tr('the team'); v.chat = chatName(v); v.staff = staffName(v.staff) || v.staff || ''; v.title = v.title || O.tr('Task');
    v.type = v.type || O.tr('Other'); v.from = v.from || '';
    if (r.kind === 'gst_msg' && v.count > 1) return O.tpl('{n} new messages from {guest}', { n: v.count, guest: v.guest });
    return O.tpl(k[2], v);
  }
  function go(r) {
    var f = r.ref || {}, k = r.kind;
    if (k === 'gst_msg') return f.booking ? ['inbox', { bookingId: f.booking }] : ['inbox'];
    if (k === 'team_msg') return ['team', { chatId: f.chat }];
    if (f.task || /^task_|^damage_|^gst_request|^ready_late|^bk_noclean/.test(k)) return ['tasks', f.task ? { taskId: f.task } : {}];
    if (f.booking) return { booking: f.booking };
    if (f.page) return [f.page];
    return [kind(r)[3]];
  }

  /* may this person see it? (the server already limits Team chat to its members) */
  function visible(r) {
    var k = kind(r);
    if (!O.allowed(k[3])) return false;
    if (/^task_/.test(r.kind) && !O.can('tasks.others')) { var me = O.auth.staffId(); return !!me && (r.vars && r.vars.to || []).indexOf(me) >= 0; }
    return true;
  }
  function mine(r) { return !!S.me && r.actor === S.me; }

  function entry(r) {
    var k = kind(r), at = new Date(Date.parse(r.created_at) + 8 * 36e5).toISOString().slice(0, 16);
    return { id: 'N' + r.id, nid: r.id, key: r.key, type: k[0], icon: k[1], t: title(r), s: sub(r), go: go(r), at: at, read: r.id <= S.seen || mine(r), kind: r.kind };
  }

  /* ---- loading and following ---- */
  function cleared() { var c = O.store.get(CLEARED, {}); return (c && c[S.org]) || 0; }
  function load() {
    var org = O.auth.orgId(); if (!org || S.loading) return;
    S.loading = true;
    var u = O.auth.user(); S.me = u ? u.id : null;
    Promise.all([
      sb().from('notifications').select('*').eq('org_id', org).order('id', { ascending: false }).limit(LOAD),
      S.me ? sb().from('notification_seen').select('seen_id').eq('org_id', org).eq('user_id', S.me).maybeSingle() : Promise.resolve({ data: null })
    ]).then(function (res) {
      S.loading = false;
      if (org !== O.auth.orgId()) return;
      if (res[0].error) { S.ok = false; return; } /* the table is not there yet: the bell keeps this device's own list */
      S.rows = res[0].data || []; S.seen = Math.max(S.seen, (res[1].data && res[1].data.seen_id) || 0); S.ok = true;
      O.emit('alert-log');
    }, function () { S.loading = false; });
  }
  function onInsert(r) {
    if (!r || r.org_id !== S.org || S.rows.some(function (x) { return x.id === r.id; })) return;
    S.rows.unshift(r); if (S.rows.length > LOAD) S.rows.length = LOAD;
    if (visible(r) && !mine(r)) announce(r);
    O.emit('alert-log');
  }
  function announce(r) {
    var k = kind(r), g = G[k[0]], muted = O.store.get(MUTE, {}) || {};
    if (k[4]) return; /* rung (and shown as a toast) by its own page */
    if (/^bk_(new|cancelled|dates)$/.test(r.kind) && !r.actor) return; /* booking-alerts.js rings booking-site changes */
    if (/^task_(new|assigned)$/.test(r.kind) && ((r.vars && r.vars.to) || []).indexOf(O.state.viewer) >= 0) return; /* tasks.js: "a new task for you" */
    if (O.auth.isPreviewing && O.auth.isPreviewing()) return;
    if (!muted[k[0]] && O.alertSound) O.alertSound.play(g.tone);
    var e = entry(r);
    if (O.ui && O.ui.toast) O.ui.toast(e.t + (e.s ? ': ' + e.s : ''));
  }
  function start() {
    var org = O.auth.orgId(); if (!org) return;
    if (S.org === org && S.ch) return;
    stop(); S.org = org; S.rows = []; S.seen = 0; S.ok = false;
    load();
    try {
      S.ch = sb().channel('orbique-notify-' + org)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'org_id=eq.' + org }, function (p) { onInsert(p && p.new); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notification_seen', filter: 'org_id=eq.' + org }, function (p) {
          var n = p && p.new; if (n && n.user_id === S.me && n.seen_id > S.seen) { S.seen = n.seen_id; O.emit('alert-log'); }
        })
        .subscribe();
    } catch (e) { S.ch = null; }
  }
  function stop() { if (S.ch) { try { sb().removeChannel(S.ch); } catch (e) {} S.ch = null; } }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && S.org) load(); });

  /* ---- for the bell ---- */
  O.notify = {
    active: function () { return S.ok; },
    list: function () {
      var cut = cleared();
      return S.rows.filter(function (r) { return r.id > cut && visible(r); }).map(entry);
    },
    unread: function () { return O.notify.list().filter(function (e) { return !e.read; }).length; },
    markRead: function () {
      var top = S.rows.length ? S.rows[0].id : 0, org = S.org;
      if (!top || top <= S.seen || !S.me) return;
      S.seen = top; O.emit('alert-log');
      sb().from('notification_seen').upsert({ org_id: org, user_id: S.me, seen_id: top, updated_at: new Date().toISOString() }).then(function () {}, function () {});
    },
    /* clears the list on this device only (everyone else keeps theirs) */
    clear: function () { var c = O.store.get(CLEARED, {}) || {}; c[S.org] = S.rows.length ? S.rows[0].id : 0; O.store.set(CLEARED, c); O.notify.markRead(); O.emit('alert-log'); },
    groups: function () { var m = O.store.get(MUTE, {}) || {}; return Object.keys(G).map(function (id) { return { id: id, label: G[id].label, muted: !!m[id] }; }); },
    setMuted: function (id, on) { var m = O.store.get(MUTE, {}) || {}; if (on) m[id] = true; else delete m[id]; O.store.set(MUTE, m); O.emit('notify-prefs'); },
    /* what this phone asks the server to send as phone notifications (app/native/bridge.js -> api/alerts.js
       register-device, migration 0033): the kinds this person may see, the groups muted here (they arrive silently)
       and whether they see everyone's tasks */
    prefs: function () {
      var m = O.store.get(MUTE, {}) || {};
      return { kinds: Object.keys(K).filter(function (k) { try { return O.allowed(K[k][3]); } catch (e) { return false; } }),
        quiet: Object.keys(G).filter(function (g) { return !!m[g]; }), allTasks: !!(O.can && O.can('tasks.others')) };
    },
    /* the app adds the few it works out itself (low stock), once a day per item */
    add: function (key, k, vars, ref) {
      var org = O.auth.orgId(), u = O.auth.user();
      if (!org || !u || !S.ok || (O.auth.readOnly && O.auth.readOnly()) || (O.auth.isPreviewing && O.auth.isPreviewing())) return;
      sb().from('notifications').insert({ org_id: org, key: key, kind: k, vars: vars || {}, ref: ref || {}, actor: u.id }).then(function () {}, function () {});
    },
    KINDS: K
  };

  /* low stock (O.inventory, app/pages/inventory.js): one line per item per day once it falls to its reorder level */
  function stockCheck() {
    if (!S.ok || !O.inventory || !O.inventory.low || !O.can("inventory")) return;
    var today = (D.NOW || '').slice(0, 10); if (!today) return;
    var lows; try { lows = O.inventory.low(); } catch (e) { return; }
    (lows || []).forEach(function (l) {
      if (!l || !l.itemId) return;
      O.notify.add('low:' + l.itemId + ':' + today, 'stock_low', { item: l.name, qty: l.qty, reorder: l.reorder }, { page: 'inventory' });
    });
  }

  (function wait(tries) {
    if (O._started && O.auth.orgId()) { start(); setTimeout(stockCheck, 8000); return; }
    if (tries > 0) setTimeout(function () { wait(tries - 1); }, 500);
  })(600);
  O.on('workspace', function () { setTimeout(start, 0); });
  O.on('viewer', function () { O.emit('alert-log'); });
  setInterval(function () { if (document.visibilityState === 'visible') stockCheck(); }, 30 * 6e4);
})();
