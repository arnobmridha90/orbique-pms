/* ===================================================================
   The assistant (app/server/command.js, production only; Arnob, 2026-11-27: "I can write inside the app what I want and it gets done").
   The account owner types a request ("swap Phyllis and dongdong", "Premier RM320 on 31 Dec", "block 47-7 5 to 8 Dec").
   Claude (api/_lib/command.js, /api/messages action command) turns it into a plan of steps; this file checks every
   step against the workspace (api/_lib/shared/command.cjs, O.command), shows the plan, and carries it out with the same
   functions the pages use (O.pickUnit, O.channel.setDays, blocks, the booking form's repricing).
   - A plan with one impossible step changes nothing.
   - Risky plans (cancellations, date changes, prices over more than 7 nights or far from today's, stopping sales) wait
     for one tap on Confirm. The rest is done straight away.
   - Every run is saved in D.assistantLog with what it changed, so Undo puts it back (and is refused for a booking
     someone changed since). Each run adds a line to the bell's shared history.
   - Guest messages are never sent from here: the owner sends those by hand.
   =================================================================== */
/* Loads after app/server/auth.js (files load in name order), which defines O.auth. */
(function () {
  var O = window.O, U = O.ui, D = O.data, esc = O.esc, d = O.d;
  if (!O.auth || !O.auth.enabled || !O.auth.enabled() || !O.command) return;
  O.sync.blob('assistantLog', 'demo', 40);

  var LOG_MAX = 40;
  var st = { turns: [], busy: false, pending: null, modal: null };

  function canUse() { var r = O.auth.role && O.auth.role(); return r === 'owner' && !(O.auth.readOnly && O.auth.readOnly()) && !(O.auth.isPreviewing && O.auth.isPreviewing()); }
  function unitNo(id) { var p = id && D.propById[id]; return p ? p.unitNo || p.short || p.name : ''; }
  function typeName(id) { var t = O.unitType(id); return t ? t.name : ''; }
  function lockOf(b) { var p = D.propById[b.propertyId]; try { return O.assign.lockReason(b, D.NOW, (p && p.checkInTime) || null); } catch (e) { return null; } }
  function mainPlan(typeId) { return O.channel && O.channel.mainPlan ? O.channel.mainPlan(typeId) : null; }
  function errText(e) { var m = (e && e.message) || ''; return /failed to fetch|network/i.test(m) ? O.tr('Orbique could not be reached. Check your connection and try again.') : m || O.tr('Something went wrong. Please try again.'); }

  /* i18n:off (what the model reads, never shown on screen) */
  /* ---------------- what the assistant may read: the workspace as plain lines ---------------- */
  function world() {
    return {
      today: D.TODAY, lastDay: d.add(D.TODAY, ((O.channel && O.channel.DAYS) || 500) - 1),
      bookings: D.bookings.map(function (b) { var lk = b.propertyId ? lockOf(b) : null; return Object.assign({}, b, { revealed: lk === 'revealed' || lk === 'code_sent' || lk === 'in_house' }); }),
      units: D.properties, types: D.unitTypes, blocks: D.blocks || [],
      unitsOfType: function (id) { return O.unitsOfType(id); },
      hasPlan: function (id) { return !!mainPlan(id); },
      rateOf: function (typeId, iso) { var mp = mainPlan(typeId); var r = mp ? O.channel.planRate(mp.id, iso) : null; return r > 0 ? r : null; }
    };
  }
  function context() {
    var T = D.TODAY, from = d.add(T, -3), to = d.add(T, 365), L = [];
    L.push('Today: ' + T + ' (' + d.dowName(T) + '), Malaysia time ' + String(D.NOW || '').slice(11, 16) + '. Prices in RM.');
    L.push('', 'Room types (id | name | max guests | units):');
    D.unitTypes.filter(function (t) { return !t.archived; }).forEach(function (t) {
      L.push(t.id + ' | ' + t.name + ' | ' + (t.maxGuests || '?') + ' | ' + O.unitsOfType(t.id).map(function (p) { return (p.unitNo || p.name) + ' (' + p.id + ')'; }).join(', '));
    });
    var loose = D.properties.filter(function (p) { return !p.archived && !p.unitTypeId; });
    if (loose.length) L.push('Units without a room type: ' + loose.map(function (p) { return (p.unitNo || p.name) + ' (' + p.id + ')'; }).join(', '));
    L.push('', 'Bookings from ' + from + ' to ' + to + ', not cancelled (id | guest | unit | booked type | check-in -> check-out | guests | site | status | notes):');
    D.bookings.filter(function (b) { return b.status !== 'cancelled' && b.checkOut >= from && b.checkIn <= to; }).slice(0, 700).forEach(function (b) {
      var lk = b.propertyId ? lockOf(b) : null;
      L.push([b.id, (b.guest && b.guest.name) || '?', b.propertyId ? 'unit ' + unitNo(b.propertyId) + ' (' + b.propertyId + ')' : 'no unit yet',
        typeName(b.unitTypeId) || '-', b.checkIn + ' -> ' + b.checkOut + ' (' + b.nights + 'n)', (b.guests || '?') + ' guests',
        U.bookingSite(b) + (b.reservationCode ? ' ' + b.reservationCode : '') + (O.bookingTools && O.bookingTools.otaLocked && O.bookingTools.otaLocked(b) ? ' (dates/cancel only on the site)' : ''),
        b.status + (lk === 'revealed' || lk === 'code_sent' ? ', guest knows the unit number' : '') + (b.assignment && b.assignment.locked ? ', unit held' : ''),
        String(b.notes || '').replace(/\s+/g, ' ').slice(0, 80)].join(' | '));
    });
    var bl = (D.blocks || []).filter(function (x) { return x.end > T; });
    if (bl.length) { L.push('', 'Blocked dates (id | unit | first night -> last night | why):'); bl.forEach(function (x) { L.push(x.id + ' | ' + unitNo(x.propertyId) + ' (' + x.propertyId + ') | ' + x.start + ' -> ' + d.add(x.end, -1) + ' | ' + (x.type || '') + (x.note ? ': ' + String(x.note).slice(0, 60) : '')); }); }
    L.push('', 'Price per night now (main rate, every booking site), next 90 nights; "closed" = not for sale:');
    D.unitTypes.filter(function (t) { return !t.archived; }).forEach(function (t) {
      var mp = mainPlan(t.id); if (!mp) { L.push(t.name + ': no rate plan'); return; }
      var runs = [], cur = null;
      d.range(T, d.add(T, 89)).forEach(function (iso) {
        var r = O.channel.planRate(mp.id, iso), day = O.channel.day(mp.id, iso) || {}, v = (r > 0 ? Math.round(r) : '?') + (day.stopSell ? ' closed' : '') + (day.minStay > 1 ? ' min ' + day.minStay : '');
        if (cur && cur.v === v) cur.to = iso; else { cur = { from: iso, to: iso, v: v }; runs.push(cur); }
      });
      L.push(t.name + ' (' + t.id + '): ' + runs.map(function (x) { return (x.from === x.to ? x.from : x.from + '..' + x.to) + ' ' + x.v; }).join('; '));
    });
    return L.join('\n');
  }

  /* i18n:on */
  /* ---------------- doing a plan ---------------- */
  function snapBookings() { var m = {}; D.bookings.forEach(function (b) { m[b.id] = JSON.stringify(b); }); return m; }
  function touch(b) { b.updatedAt = D.NOW; b.updatedBy = O.state.viewer; }
  function audit(text) { if (!Array.isArray(D.auditLog)) D.auditLog = []; D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: 'assistant', text: text }); }

  function doStep(s, rates, blocksAdded) {
    var C = O.command, w = { units: D.properties, types: D.unitTypes, bookings: D.bookings };
    var b = s.booking ? C.findBooking(w, s.booking) : null;
    switch (s.action) {
      case 'move_booking': { var u = C.findUnit(w, s.unit); O.pickUnit(b, u.id); touch(b); return; }
      case 'swap_units': {
        var b2 = C.findBooking(w, s.booking_b), ua = b.propertyId, ub = b2.propertyId;
        O.pickUnit(b, ub); O.pickUnit(b2, ua); touch(b); touch(b2); return;
      }
      case 'edit_booking': {
        var ci = s.check_in || b.checkIn, co = s.check_out || b.checkOut, moved = ci !== b.checkIn || co !== b.checkOut;
        if (moved) {
          b.checkIn = ci; b.checkOut = co; b.nights = d.diff(ci, co);
          var p = D.propById[b.propertyId];
          if (b.channel === 'direct' && p && O.bookingTools && O.bookingTools.reprice) O.bookingTools.reprice(b, p);
          if (b.unitTypeId && !b.propertyId) O.assignBooking(b, { ignoreLock: true });
          if (O.bookingTools && O.bookingTools.placeSorted) O.bookingTools.placeSorted(b);
        }
        if (s.guests !== undefined) b.guests = s.guests;
        if (s.guest_name) b.guest.name = s.guest_name;
        if (s.phone !== undefined) b.guest.phone = s.phone;
        if (s.email !== undefined) b.guest.email = s.email;
        if (s.note !== undefined) b.notes = s.note;
        if (s.arrival_time) b.checkInTime = s.arrival_time;
        if (s.departure_time) b.checkOutTime = s.departure_time;
        touch(b);
        if (moved && O.automation && O.automation.run) O.automation.run('booking');
        return;
      }
      case 'cancel_booking': {
        b.status = 'cancelled'; b.cancelledAt = D.TODAY; b.cancelledBy = O.state.viewer; if (b.codeStatus) b.codeStatus = 'cancelled'; touch(b);
        if (O.automation && O.automation.run) O.automation.run('booking');
        return;
      }
      case 'set_price': case 'reset_price': case 'set_restrictions': {
        var t = C.findType(w, s.unit_type), mp = mainPlan(t.id), dates = C.nightsIn(s.from, s.to || s.from, s.weekdays), set = {};
        if (s.action === 'set_price') set.rate = s.price;
        else if (s.action === 'reset_price') set.rate = null;
        else { if (s.min_stay !== undefined) set.minStay = s.min_stay; if (s.stop_sell !== undefined) set.stopSell = s.stop_sell; }
        dates.forEach(function (iso) {
          var day = O.channel.day(mp.id, iso) || {}, prev = {};
          if ('rate' in set) prev.rate = day.rate > 0 ? day.rate : null;
          if ('minStay' in set) prev.minStay = day.minStay || null;
          if ('stopSell' in set) prev.stopSell = !!day.stopSell;
          rates.push({ planId: mp.id, iso: iso, prev: prev });
        });
        O.channel.setDays([{ planId: mp.id, dates: dates, set: set }], { emit: false, audit: false, how: 'manual' });
        return;
      }
      case 'block_dates': {
        var keys = s.units || [s.unit], group = keys.length > 1 ? O.uid('BG') : null;
        keys.forEach(function (k) {
          var un = C.findUnit(w, k), x = { id: O.uid('BL'), propertyId: un.id, start: s.from, end: d.add(s.to || s.from, 1), type: 'maintenance', note: s.note || O.tr('Blocked with the assistant'), createdBy: O.state.viewer, createdAt: D.NOW };
          if (group) x.groupId = group; D.blocks.push(x); blocksAdded.push(x.id);
        });
        return;
      }
      case 'unblock_dates': return; /* done in apply(), which keeps a copy for Undo */
    }
  }

  function apply(plan, text) {
    var before = snapBookings();
    var rates = [], added = [], removed = [];
    plan.steps.forEach(function (r) {
      var s = r.step;
      if (s.action === 'unblock_dates') {
        s.block_ids.forEach(function (id) { var i = D.blocks.findIndex(function (x) { return x.id === id; }); if (i >= 0) { removed.push(JSON.parse(JSON.stringify(D.blocks[i]))); D.blocks.splice(i, 1); } });
      } else doStep(s, rates, added);
    });
    var unitChange = plan.steps.some(function (r) { return /^(block_dates|unblock_dates|cancel_booking|edit_booking)$/.test(r.step.action); });
    if (unitChange && D.unitTypes.length) O.reassignUnits(); /* a freed unit may take a booking that had none */
    /* what changed, for Undo: each booking as it was and as it is now */
    var changed = [];
    D.bookings.forEach(function (b) { var now = JSON.stringify(b); if (before[b.id] !== now) changed.push({ id: b.id, was: before[b.id] ? JSON.parse(before[b.id]) : null, now: now }); });
    var run = {
      id: O.uid('AS'), at: D.NOW, by: O.state.viewer, request: String(text).slice(0, 500),
      lines: plan.steps.map(function (r) { return r.text; }), bookings: changed, blocksAdded: added, blocksRemoved: removed,
      rates: rates, undone: false
    };
    if (!Array.isArray(D.assistantLog)) D.assistantLog = [];
    D.assistantLog.unshift(run); if (D.assistantLog.length > LOG_MAX) D.assistantLog.length = LOG_MAX;
    run.lines.forEach(function (l) { audit(O.tpl('Assistant: {what}', { what: l })); });
    O.emit('data', { type: 'assistant' });
    if (O.notify && O.notify.add) O.notify.add('asst:' + run.id, 'assistant', { text: run.lines.join('; ').slice(0, 280) }, { assistant: run.id, page: 'bookings' });
    return run;
  }

  function undo(id) {
    var run = (D.assistantLog || []).filter(function (r) { return r.id === id; })[0];
    if (!run || run.undone) return { ok: false, message: O.tr('This change was already undone.') };
    var skipped = [];
    (run.bookings || []).forEach(function (c) {
      var b = D.booking(c.id); if (!b || !c.was) return;
      if (JSON.stringify(b) !== c.now) { skipped.push((b.guest && b.guest.name) || b.id); return; }
      Object.keys(b).forEach(function (k) { if (!(k in c.was)) delete b[k]; });
      Object.keys(c.was).forEach(function (k) { b[k] = JSON.parse(JSON.stringify(c.was[k])); });
      if (O.bookingTools && O.bookingTools.placeSorted) O.bookingTools.placeSorted(b);
    });
    (run.blocksAdded || []).forEach(function (bid) { var i = D.blocks.findIndex(function (x) { return x.id === bid; }); if (i >= 0) D.blocks.splice(i, 1); });
    (run.blocksRemoved || []).forEach(function (x) { if (!D.blocks.some(function (y) { return y.id === x.id; })) D.blocks.push(x); });
    if (run.rates && run.rates.length) {
      O.channel.setDays(run.rates.map(function (r) {
        var set = {};
        if ('rate' in r.prev) set.rate = r.prev.rate;
        if ('minStay' in r.prev) set.minStay = r.prev.minStay;
        if ('stopSell' in r.prev) set.stopSell = r.prev.stopSell;
        return { planId: r.planId, dates: [r.iso], set: set };
      }), { emit: false, audit: false, how: 'manual' });
    }
    run.undone = true; run.undoneAt = D.NOW; run.undoneBy = O.state.viewer;
    audit(O.tpl('Assistant: undid "{what}"', { what: run.lines.join('; ').slice(0, 200) }));
    O.emit('data', { type: 'assistant' });
    if (O.notify && O.notify.add) O.notify.add('asst-undo:' + run.id, 'assistant_undo', { text: run.lines.join('; ').slice(0, 280) }, { assistant: run.id, page: 'bookings' });
    return { ok: true, skipped: skipped };
  }

  /* ---------------- the window ---------------- */
  function planHTML(t) {
    var h = '';
    if (t.reply) h += '<div class="as-reply">' + esc(t.reply) + '</div>';
    if (t.check && t.check.steps.length) {
      h += '<ol class="as-steps">' + t.check.steps.map(function (r) {
        return '<li class="' + (r.ok ? 'ok' : 'bad') + '"><span>' + esc(r.text || r.step.action) + '</span>' +
          r.problems.map(function (p) { return '<div class="as-prob">' + esc(p) + '</div>'; }).join('') +
          r.warn.map(function (p) { return '<div class="as-warn">' + esc(p) + '</div>'; }).join('') + '</li>';
      }).join('') + '</ol>';
    }
    if (t.cannot && t.cannot.length) h += '<div class="as-cannot"><b>' + esc(O.tr('Not done (Orbique cannot do this yet):')) + '</b><ul>' + t.cannot.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>';
    if (t.state === 'blocked') h += '<div class="as-state bad">' + esc(O.tr('Nothing was changed: fix the request and try again.')) + '</div>';
    if (t.state === 'confirm') h += '<div class="as-state warn">' + esc(O.tr('Check the plan, then confirm.')) + '</div><div class="row-flex wrap" style="gap:6px;margin-top:6px"><button type="button" class="btn btn-primary btn-sm" data-as="confirm">' + esc(O.tr('Confirm and do it')) + '</button><button type="button" class="btn btn-ghost btn-sm" data-as="drop">' + esc(O.tr('Don\'t do it')) + '</button></div>';
    if (t.state === 'dropped') h += '<div class="as-state">' + esc(O.tr('Not done.')) + '</div>';
    if (t.state === 'done') {
      var run = (D.assistantLog || []).filter(function (r) { return r.id === t.runId; })[0];
      h += '<div class="as-state ok">' + esc(run && run.undone ? O.tr('Done, then undone.') : O.tr('Done.')) + '</div>' + (run && !run.undone ? '<button type="button" class="btn btn-ghost btn-sm" data-as-undo="' + esc(run.id) + '">' + O.icon('refresh') + esc(O.tr('Undo')) + '</button>' : '');
    }
    return h;
  }
  function historyHTML() {
    var runs = (D.assistantLog || []).slice(0, 8);
    if (!runs.length) return '';
    return '<details class="as-hist"><summary>' + esc(O.tr('Earlier changes')) + '</summary>' + runs.map(function (r) {
      var who = D.staffById(r.by);
      return '<div class="as-run"><div class="xs muted">' + esc(O.fmt.dateTime(r.at) + (who ? ' · ' + who.name : '')) + (r.undone ? ' · ' + esc(O.tr('undone')) : '') + '</div><div class="small">' + esc(r.lines.join('; ')) + '</div>' +
        (r.undone ? '' : '<button type="button" class="btn btn-quiet btn-sm" data-as-undo="' + esc(r.id) + '">' + esc(O.tr('Undo')) + '</button>') + '</div>';
    }).join('') + '</details>';
  }
  function paint() {
    var el = st.modal && st.modal.el; if (!el || !document.body.contains(el)) return;
    var log = O.$('.as-log', el);
    log.innerHTML = st.turns.length ? st.turns.map(function (t) {
      return t.role === 'user' ? '<div class="as-me">' + esc(t.text) + '</div>' : '<div class="as-bot">' + (t.busy ? '<span class="muted">' + esc(O.tr('Working on it…')) + '</span>' : planHTML(t)) + '</div>';
    }).join('') : '<div class="as-hint small muted">' + esc(O.tr('Type what you want done, as you would ask a colleague. For example:')) + '<ul>' +
      ['Swap the guests in 48-1 and 26-3A tomorrow', 'Move the Trip.com guest arriving Saturday to 47-7', 'Premier RM350 on 24 and 31 Dec', 'Block 43-6 from 5 to 8 Dec for painting', 'Who checks in tomorrow?']
        .map(function (x) { return '<li><button type="button" class="as-ex" data-as-ex>' + esc(O.tr(x)) + '</button></li>'; }).join('') + '</ul>' +
      esc(O.tr('It never messages guests. Changes can be undone.')) + '</div>';
    O.$('.as-histwrap', el).innerHTML = historyHTML();
    log.scrollTop = log.scrollHeight;
    var go = O.$('[data-as=send]', el); if (go) go.disabled = st.busy;
  }
  function send(text) {
    text = String(text || '').trim(); if (!text || st.busy) return;
    /* i18n:off (what the model reads) */
    var hist = st.turns.filter(function (t) { return !t.busy; }).slice(-6).map(function (t) { return { role: t.role, text: t.role === 'user' ? t.text : (t.reply || '') + (t.check && t.check.steps.length ? ' [' + t.check.steps.map(function (r) { return r.text; }).join('; ') + ']' + (t.state === 'done' ? ' (done)' : t.state === 'blocked' ? ' (not done)' : '') : '') }; });
    /* i18n:on */
    st.turns.forEach(function (t) { if (t.state === 'confirm') t.state = 'dropped'; });
    st.turns.push({ role: 'user', text: text });
    var bot = { role: 'assistant', busy: true }; st.turns.push(bot); st.busy = true; paint();
    O.auth.inbox('command', { text: text, context: context(), history: hist }).then(function (res) {
      st.busy = false; bot.busy = false;
      bot.reply = res.reply || ''; bot.cannot = res.cannot || [];
      var steps = (res.steps || []).map(O.command.normalize).filter(Boolean);
      bot.check = O.command.checkPlan(steps, world());
      if (!steps.length) bot.state = '';
      else if (!bot.check.ok) bot.state = 'blocked';
      else if (bot.check.risky) bot.state = 'confirm';
      else { var run = apply(bot.check, text); bot.state = 'done'; bot.runId = run.id; }
      bot.request = text; paint();
    }, function (e) {
      st.busy = false; bot.busy = false; bot.reply = errText(e); bot.state = ''; paint();
    });
  }
  function open() {
    if (!canUse()) { U.toast(O.tr('Only the account owner can use the assistant.'), 'bad'); return; }
    if (st.modal && st.modal.el && document.body.contains(st.modal.el)) return;
    var body = O.html('<div class="as-wrap"><div class="as-log" aria-live="polite"></div><div class="as-histwrap"></div>' +
      '<form class="as-form"><textarea class="input" rows="2" maxlength="1500" placeholder="' + esc(O.tr('What should Orbique do?')) + '" aria-label="' + esc(O.tr('What should Orbique do?')) + '"></textarea>' +
      '<button type="submit" class="btn btn-primary" data-as="send">' + esc(O.tr('Go')) + '</button></form></div>');
    st.modal = U.modal({ title: O.tr('Assistant'), sub: O.tr('Type a change and Orbique does it'), body: body, cls: 'as-modal', autofocus: false,
      onOpen: function (el) { var ta = O.$('textarea', el); setTimeout(function () { try { ta.focus(); } catch (e) { /* ignore */ } }, 50); } });
    var el = st.modal.el, ta = O.$('textarea', el);
    O.$('.as-form', el).addEventListener('submit', function (e) { e.preventDefault(); var v = ta.value; ta.value = ''; send(v); });
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); O.$('.as-form', el).requestSubmit ? O.$('.as-form', el).requestSubmit() : O.$('[data-as=send]', el).click(); } });
    el.addEventListener('click', function (e) {
      var ex = e.target.closest('[data-as-ex]'); if (ex) { ta.value = ex.textContent; ta.focus(); return; }
      var u = e.target.closest('[data-as-undo]');
      if (u) { var r = undo(u.dataset.asUndo); U.toast(r.ok ? (r.skipped.length ? O.tpl('Undone, except {names}: changed again since.', { names: r.skipped.join(', ') }) : O.tr('Undone.')) : r.message, r.ok && !r.skipped.length ? 'ok' : 'bad'); paint(); return; }
      var a = e.target.closest('[data-as]'); if (!a) return;
      var t = st.turns.filter(function (x) { return x.state === 'confirm'; }).pop(); if (!t) return;
      if (a.dataset.as === 'drop') { t.state = 'dropped'; paint(); return; }
      if (a.dataset.as === 'confirm') {
        t.check = O.command.checkPlan(t.check.steps.map(function (r) { return r.step; }), world()); /* the data may have moved on */
        if (!t.check.ok) { t.state = 'blocked'; paint(); return; }
        var run = apply(t.check, t.request); t.state = 'done'; t.runId = run.id; paint();
      }
    });
    paint();
  }

  /* the button next to the bell, for the account owner */
  function button() {
    var have = O.$('#ask-btn');
    if (!canUse()) { if (have) have.remove(); return; }
    if (have) return;
    var bell = O.$('#bell-btn'); if (!bell) return;
    var b = O.html('<button class="icon-btn" id="ask-btn" type="button" title="' + esc(O.tr('Assistant')) + '" aria-label="' + esc(O.tr('Assistant')) + '">' + O.icon('sparkle') + '</button>');
    bell.parentNode.parentNode.insertBefore(b, bell.parentNode);
    b.onclick = open;
  }
  O.assistant = { open: open, undo: undo, context: context, world: world };
  (function wait(tries) {
    if (O._started && O.auth.orgId()) { button(); return; }
    if (tries > 0) setTimeout(function () { wait(tries - 1); }, 500);
  })(600);
  O.on('workspace', function () { setTimeout(button, 0); });
  O.on('lang', function () { var b = O.$('#ask-btn'); if (b) { b.remove(); button(); } });
})();
