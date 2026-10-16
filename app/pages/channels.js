/* Channels (Manage → Channels): the channel manager. One Channex property per building, one room type per unit type,
   rate plans per unit type. Booking.com, Agoda, Airbnb, Expedia and Trip.com are connected inside the Channex screen
   (Manage channels); Orbique sends availability, rates and restrictions and receives the bookings.
   Live mode: a production workspace that the server allows (POST /api/channex config). Practice mode (the test copy
   on this device, demo workspaces, workspaces not switched on yet): the same screens, fake ids, nothing leaves Orbique;
   what would have been sent goes to D.channelLog.
   Exposes O.channel:
     mode()                 'live' | 'simulated' | 'unknown' (still asking the server)
     setDays(changes, opts) one write into channelRates (and priceOverrides for main plans), then one O.emit('data')
     fill()                 the 'channel-rates' automation: the model rate of main plans and plans that follow another
     kick()                 send waiting changes now (live), run after every save ('synced')
     conflicts()            double bookings, bookings without a unit, oversold nights and open server alerts
   Rates and restrictions are edited in Calendar → Rates & restrictions. */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  var DAYS = 500;
  var CONNECTED = ['syncing', 'live', 'paused', 'error'];
  var WATCH = ['bookings', 'blocks', 'channelRates', 'ratePlans', 'properties', 'unitTypes', 'buildings'];
  var MEALS = [['room_only', 'Room only'], ['breakfast', 'Breakfast included'], ['half_board', 'Half board'], ['full_board', 'Full board'], ['all_inclusive', 'All inclusive']];
  var STATUS = {
    none: ['Not connected', 'neutral'], setup: ['Setting up', 'info'], syncing: ['Setting up', 'info'], live: ['Live', 'ok'],
    paused: ['Paused', 'warn'], error: ['Needs attention', 'bad'], disconnected: ['Not connected', 'neutral']
  };
  var ALERT_KIND = {
    double_booking: 'Double booking', needs_unit: 'Needs a unit', unmapped_room: 'Unknown room type', unmapped_rate: 'Unknown rate plan',
    sync_error: 'Sending stopped', rate_warning: 'Update not accepted', non_acked: 'Booking not confirmed', channel_disconnected: 'Channel disconnected',
    currency_changed: 'Currency changed'
  };
  var st = { tab: 'buildings', logOpen: null };

  /* ---------------- demo data: rate plans for the demo building, already connected in practice mode ---------------- */
  if (!Array.isArray(D.ratePlans)) {
    D.ratePlans = [];
    (D.unitTypes || []).forEach(function (t) {
      var u = (D.properties || []).filter(function (p) { return p.unitTypeId === t.id; })[0], base = u && +u.base > 0 ? +u.base : 200;
      var key = String(t.id).replace(/^UT-/, '');
      D.ratePlans.push({ id: 'RP-' + key + '-bar', unitTypeId: t.id, name: 'Best Available Rate', meal: 'room_only', primary: true, defaultRate: base, follows: null, minStay: 1, createdAt: t.createdAt || D.NOW });
      if (t.id === 'UT-deluxe') D.ratePlans.push({ id: 'RP-' + key + '-bb', unitTypeId: t.id, name: 'Bed & Breakfast', meal: 'breakfast', primary: false, defaultRate: base + 40, follows: { planId: 'RP-' + key + '-bar', type: 'amount', value: 40 }, minStay: 1, createdAt: t.createdAt || D.NOW });
    });
  }
  if (!Array.isArray(D.channelRates)) D.channelRates = [];
  if (!Array.isArray(D.channelLog)) D.channelLog = [];
  if (!D.channelSim || typeof D.channelSim !== 'object') {
    D.channelSim = { buildings: {} };
    (D.buildings || []).forEach(function (b) { if (b.id === 'BD-saujana') D.channelSim.buildings[b.id] = { status: 'live', propertyId: 'sim-saujana-0001', connectedAt: '2026-07-21T09:00', fullSyncAt: '2026-07-21T09:00' }; });
  }
  function SIMB() { var s = D.channelSim; if (!s || typeof s !== 'object') s = D.channelSim = {}; if (!s.buildings || typeof s.buildings !== 'object') s.buildings = {}; return s.buildings; }

  /* ---------------- small helpers ---------------- */
  function round2(n) { return Math.round(n * 100) / 100; }
  function num(v) { if (v === null || v === undefined || v === '') return null; var n = +v; return isFinite(n) ? n : null; }
  function posInt(v) { var n = num(v); return n !== null && n >= 1 ? Math.floor(n) : null; }
  function money2(v, cur) { if (v == null || !isFinite(v)) return '–'; var s = (Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, ''); return (cur ? cur + ' ' : '') + s; }
  function isArchived(x) { return !!(x && (x.archived === true || x.status === 'archived')); }
  /* a server time (timestamptz) as Malaysia time 'YYYY-MM-DDTHH:MM' */
  function myTime(ts) { var t = Date.parse(ts); return isFinite(t) ? new Date(t + 8 * 36e5).toISOString().slice(0, 16) : ''; }
  function when(local) { if (!local) return ''; return local.slice(0, 10) === D.TODAY ? 'today ' + fmt.time(local) : fmt.dateTime(local); }
  function curOf(bid) { var b = O.building(bid); return b && b.currency ? String(b.currency).toUpperCase() : 'MYR'; }
  function server() { return !!(O.auth && O.auth.enabled && O.auth.enabled() && O.sync.adapter && O.sync.adapter.name === 'server' && O.auth.orgId && O.auth.orgId()); }
  function buildingsList() { return (D.buildings || []).filter(function (b) { return !isArchived(b); }); }
  function typesOf(bid) { return O.typesOf(bid); }
  function unitCount(tid) { return O.unitsOfType(tid).filter(function (u) { return !isArchived(u); }).length; }

  /* ---------------- rate plans and their days ---------------- */
  function plansOf(typeId, withArchived) {
    return (D.ratePlans || []).filter(function (p) { return p && p.unitTypeId === typeId && (withArchived || !isArchived(p)); }).sort(function (a, b) {
      return (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.name).localeCompare(String(b.name));
    });
  }
  function planById(id) { var l = D.ratePlans || []; for (var i = 0; i < l.length; i++) if (l[i] && l[i].id === id) return l[i]; return null; }
  function mainPlan(typeId) { return plansOf(typeId).filter(function (p) { return p.primary; })[0] || null; }
  function crId(planId, month) { return 'CR-' + planId + '-' + month; }
  function crMap() { var m = {}; (D.channelRates || []).forEach(function (r) { if (r && r.id) m[r.id] = r; }); return m; }
  function crGet(map, plan, month, create) {
    var id = crId(plan.id, month), r = map[id];
    if (!r && create) { r = map[id] = { id: id, planId: plan.id, unitTypeId: plan.unitTypeId, month: month, days: {} }; D.channelRates.push(r); }
    if (r && (!r.days || typeof r.days !== 'object')) r.days = {};
    return r || null;
  }
  function dayOf(map, planId, iso) { var r = map[crId(planId, iso.slice(0, 7))]; return r && r.days ? r.days[iso] || null : null; }
  /* the rate a plan sells at on a date: its own day rate, else the plan it follows plus the rule, else its default (as the server) */
  function planRate(plan, iso, map, depth) {
    if (!plan) return null;
    var day = dayOf(map, plan.id, iso), own = day ? num(day.rate) : null;
    if (own !== null) return own;
    var f = plan.follows, parent = f && f.planId ? planById(f.planId) : null;
    if (parent && (depth || 0) < 5) {
      var pr = planRate(parent, iso, map, (depth || 0) + 1), v = num(f.value) || 0;
      if (pr !== null) return round2(f.type === 'amount' ? pr + v : pr * (1 + v / 100));
    }
    return num(plan.defaultRate);
  }
  /* what Channex gets for one plan and date (the server's restrictionValue) */
  function restrictionValue(plan, iso, map) {
    var day = dayOf(map, plan.id, iso) || {}, out = {}, r = planRate(plan, iso, map, 0);
    if (r !== null) out.rate = r.toFixed(2);
    out.min_stay_arrival = posInt(day.minStay) || posInt(plan.minStay) || 1;
    var ms = num(day.maxStay); out.max_stay = ms !== null && ms >= 0 ? Math.floor(ms) : (posInt(plan.maxStay) || 0);
    out.closed_to_arrival = !!day.cta; out.closed_to_departure = !!day.ctd;
    var t = O.unitType(plan.unitTypeId);
    out.stop_sell = isArchived(plan) || !t || isArchived(t) || !!day.stopSell;
    return out;
  }

  /* ---------------- fill: the model rate of main plans and of plans that follow another ----------------
     Main plan: the price of the type's first unit (Pricing: its own price, else the model rate). A plan that follows
     another: that plan's rate plus the rule. Days set by hand (src 'manual') are kept. Deterministic, so two devices
     write the same thing. Returns the number of days that changed. */
  function modelRate(plan, iso, map, firstUnit) {
    if (plan.follows && plan.follows.planId) {
      var parent = planById(plan.follows.planId); if (!parent || parent.id === plan.id) return null;
      var pr = planRate(parent, iso, map, 1), v = num(plan.follows.value) || 0;
      return pr === null ? null : round2(plan.follows.type === 'amount' ? pr + v : pr * (1 + v / 100));
    }
    if (!plan.primary || !firstUnit) return null;
    var o = D.priceOverrides && D.priceOverrides[firstUnit.id];
    if (o && num(o[iso]) > 0) return round2(+o[iso]);
    var r = 0; try { r = D.rateFor(firstUnit.id, iso); } catch (e) { r = 0; }
    return r > 0 ? round2(r) : null;
  }
  function fill(typeIds) {
    if (!Array.isArray(D.ratePlans) || !Array.isArray(D.channelRates)) return 0;
    var T = D.TODAY, last = d.add(T, DAYS - 1), map = crMap(), changed = 0, keep = d.add(T, -7);
    /* tidy: days filed under the wrong month (the demo moves its dates) and days long gone */
    D.channelRates.slice().forEach(function (r) {
      if (!r || !r.days || !r.planId) return;
      Object.keys(r.days).forEach(function (iso) {
        if (iso < keep) { delete r.days[iso]; changed++; return; }
        if (iso.slice(0, 7) !== r.month) { var p = planById(r.planId) || { id: r.planId, unitTypeId: r.unitTypeId }; var to = crGet(map, p, iso.slice(0, 7), true); if (!to.days[iso]) to.days[iso] = r.days[iso]; delete r.days[iso]; changed++; }
      });
    });
    var plans = D.ratePlans.filter(function (p) { return p && !isArchived(p) && (p.primary || (p.follows && p.follows.planId)) && (!typeIds || typeIds.indexOf(p.unitTypeId) >= 0); });
    /* plans that follow another come after it */
    var order = [], seen = {};
    function visit(p, depth) { if (seen[p.id] || depth > 5) return; var f = p.follows && planById(p.follows.planId); if (f && plans.indexOf(f) >= 0) visit(f, depth + 1); seen[p.id] = 1; order.push(p); }
    plans.forEach(function (p) { visit(p, 0); });
    var dates = d.range(T, last);
    order.forEach(function (plan) {
      var first = O.unitsOfType(plan.unitTypeId).filter(function (u) { return !isArchived(u); })[0];
      dates.forEach(function (iso) {
        var r = crGet(map, plan, iso.slice(0, 7), false), day = r && r.days[iso];
        if (day && day.src === 'manual' && num(day.rate) !== null) return;
        var v = modelRate(plan, iso, map, first);
        if (v === null) {
          if (day && day.src === 'model') { delete day.rate; delete day.src; if (!Object.keys(day).length) delete r.days[iso]; changed++; }
          return;
        }
        if (day && num(day.rate) === v && day.src === 'model') return;
        r = r || crGet(map, plan, iso.slice(0, 7), true);
        day = r.days[iso] = r.days[iso] || {};
        day.rate = v; day.src = 'model'; changed++;
      });
    });
    /* months with nothing left */
    for (var i = D.channelRates.length - 1; i >= 0; i--) { var x = D.channelRates[i]; if (x && x.days && !Object.keys(x.days).length) { D.channelRates.splice(i, 1); changed++; } }
    return changed;
  }
  O.automation.register('channel-rates', function () {
    var n = fill();
    if (n) O.emit('data', { type: 'channel-rates' });
    if (!SIM.snap && mode() === 'simulated') SIM.snap = snapshot();
  });

  /* ---------------- setDays: rates and restrictions ----------------
     changes: [{planId, from, to, dates?, weekdays?: [0..6] (0 = Sunday), set: {rate, minStay, maxStay, cta, ctd, stopSell}}]
     A field left undefined stays as it is; null clears it (rate: back to the model or the default). A rate on a main plan
     is also the price of every unit of the type (Pricing). One O.emit('data') for the whole list, so one save and one send.
     opts: {emit: false, audit: false, why} */
  function setDays(changes, opts) {
    opts = opts || {};
    if (!Array.isArray(changes) || !changes.length) return 0;
    var map = crMap(), types = {}, n = 0, T = D.TODAY, last = d.add(T, DAYS - 1);
    D.priceOverrides = D.priceOverrides || {}; D.priceOverrideMeta = D.priceOverrideMeta || {};
    changes.forEach(function (c) {
      var plan = planById(c.planId); if (!plan || !c.set) return;
      var dates = Array.isArray(c.dates) ? c.dates.slice() : (c.from && c.to && c.from <= c.to ? d.range(c.from, c.to) : []);
      dates = dates.filter(function (iso) { return /^\d{4}-\d{2}-\d{2}$/.test(iso) && iso >= T && iso <= last; });
      if (Array.isArray(c.weekdays) && c.weekdays.length && c.weekdays.length < 7) dates = dates.filter(function (iso) { return c.weekdays.indexOf(d.dow(iso)) >= 0; });
      if (!dates.length) return;
      types[plan.unitTypeId] = 1;
      var units = plan.primary ? O.unitsOfType(plan.unitTypeId).filter(function (u) { return !isArchived(u); }) : [];
      var s = c.set;
      dates.forEach(function (iso) {
        var r = crGet(map, plan, iso.slice(0, 7), true), day = r.days[iso] || {};
        if (s.rate !== undefined) {
          var rate = num(s.rate);
          if (rate !== null && rate > 0) { day.rate = round2(rate); day.src = 'manual'; }
          else { delete day.rate; delete day.src; }
          units.forEach(function (u) {
            var o = D.priceOverrides[u.id] = D.priceOverrides[u.id] || {}, m = D.priceOverrideMeta[u.id] = D.priceOverrideMeta[u.id] || {};
            if (rate !== null && rate > 0) { o[iso] = round2(rate); m[iso] = { how: opts.how || 'manual', by: O.state.viewer, at: D.NOW }; }
            else { delete o[iso]; delete m[iso]; }
          });
        }
        if (s.minStay !== undefined) { var mn = posInt(s.minStay); if (mn) day.minStay = mn; else delete day.minStay; }
        if (s.maxStay !== undefined) { var mx = num(s.maxStay); if (mx !== null && mx >= 1) day.maxStay = Math.floor(mx); else delete day.maxStay; }
        ['cta', 'ctd', 'stopSell'].forEach(function (k) { if (s[k] === undefined) return; if (s[k]) day[k] = true; else delete day[k]; });
        if (Object.keys(day).length) r.days[iso] = day; else delete r.days[iso];
        n++;
      });
    });
    if (!n) return 0;
    fill(Object.keys(types));
    if (opts.audit !== false) {
      D.auditLog = D.auditLog || [];
      D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: 'channels', text: opts.why || ('Changed rates and restrictions: ' + fmt.plural(changes.length, 'change') + ', ' + fmt.plural(n, 'day')) });
    }
    if (opts.emit !== false) O.emit('data', { type: 'channel-rates' });
    return n;
  }

  /* ---------------- mode: live or practice ---------------- */
  var CFG = { org: null, state: 'idle', data: null, err: null };
  function loadConfig(force) {
    var org = O.auth.orgId();
    if (!force && CFG.org === org && (CFG.state === 'ok' || CFG.state === 'loading')) return;
    CFG.org = org; CFG.state = 'loading'; CFG.err = null;
    O.auth.channex('config').then(function (r) {
      if (CFG.org !== org) return;
      CFG.state = 'ok'; CFG.data = r;
      if (mode() === 'live') startLive(); else stopLive();
      O.emit('channel');
    }, function (e) {
      if (CFG.org !== org) return;
      CFG.state = 'error'; CFG.err = e && e.message ? e.message : 'The channel manager did not answer.';
      O.emit('channel');
    });
  }
  function mode() {
    if (!server()) return 'simulated';
    if (CFG.org !== O.auth.orgId() || CFG.state === 'idle') loadConfig();
    if (CFG.state === 'ok') return CFG.data && CFG.data.configured && CFG.data.allowed ? 'live' : 'simulated';
    return 'unknown';
  }
  function modeReason() {
    if (!server()) return 'This is the test copy on this device.';
    var c = CFG.data || {};
    if (c.demo) return 'This is a demo workspace.';
    if (!c.configured) return 'The channel manager is not set up on the server yet.';
    if (!c.allowed) return 'Channel connections are not switched on for this workspace yet. Please contact Orbique.';
    return '';
  }

  /* ---------------- live state (Supabase rows the members may read) ---------------- */
  var L = { org: null, loaded: false, loading: false, err: null, props: {}, pending: {}, calls: [], alerts: [], unsub: null, timer: null, reloadT: null, poll: null };
  function startLive() {
    var org = O.auth.orgId();
    if (L.org !== org) { stopLive(); L.org = org; L.loaded = false; L.props = {}; L.pending = {}; L.calls = []; L.alerts = []; }
    if (!L.unsub && O.auth.channexRealtime) L.unsub = O.auth.channexRealtime(function () { reloadSoon(800); });
    if (!L.loaded && !L.loading) reload();
  }
  function stopLive() { if (L.unsub) { try { L.unsub(); } catch (e) { /* already closed */ } L.unsub = null; } }
  function reloadSoon(ms) { clearTimeout(L.reloadT); L.reloadT = setTimeout(reload, ms || 600); }
  function reload() {
    if (!server() || mode() !== 'live') return Promise.resolve();
    var sb = O.auth.supabase(), org = O.auth.orgId(), env = CFG.data && CFG.data.env;
    L.loading = true;
    return Promise.all([
      sb.from('channex_properties').select('building_id, channex_property_id, status, currency, full_sync_at, full_sync_requested_at, full_sync_task_ids, paused_until, last_error, last_error_at, channels, updated_at').eq('org_id', org).eq('env', env),
      sb.from('channex_outbox').select('channex_property_id, kind').eq('org_id', org).limit(2000),
      sb.from('channex_calls').select('id, at, method, endpoint, source, item_count, http_status, task_ids, warnings, error, duration_ms, channex_property_id').eq('org_id', org).order('at', { ascending: false }).limit(200),
      sb.from('channex_alerts').select('id, kind, message, ref, created_at, resolved_at').eq('org_id', org).is('resolved_at', null).order('created_at', { ascending: false }).limit(100)
    ]).then(function (res) {
      L.loading = false;
      if (L.org !== org) return;
      var bad = res.filter(function (r) { return r && r.error; })[0];
      if (bad) { L.err = 'Could not load the channel manager: ' + (bad.error.message || 'please try again.'); O.emit('channel'); return; }
      L.err = null; L.loaded = true; L.props = {}; L.pending = {};
      (res[0].data || []).forEach(function (p) { L.props[p.building_id] = p; });
      (res[1].data || []).forEach(function (o) { var k = o.channex_property_id; L.pending[k] = (L.pending[k] || 0) + 1; });
      L.calls = res[2].data || []; L.alerts = res[3].data || [];
      O.emit('channel');
    }, function (e) { L.loading = false; L.err = 'Could not load the channel manager: ' + ((e && e.message) || 'please try again.'); O.emit('channel'); });
  }

  /* ---------------- a building's connection ---------------- */
  function conn(bid) {
    var m = mode();
    if (m === 'live') {
      var p = L.props[bid];
      if (!p) return { status: 'none', live: true };
      return { status: p.status, live: true, propertyId: p.channex_property_id, fullSyncAt: p.full_sync_at ? myTime(p.full_sync_at) : '', fullSyncRaw: p.full_sync_at, fullSyncRequested: !!p.full_sync_requested_at, pausedUntil: p.paused_until && Date.parse(p.paused_until) > Date.now() ? myTime(p.paused_until) : '', lastError: p.last_error || '', pending: L.pending[p.channex_property_id] || 0, channels: Array.isArray(p.channels) ? p.channels : [] };
    }
    var s = SIMB()[bid];
    if (!s) return { status: 'none', live: false };
    return { status: s.status || 'live', live: false, propertyId: s.propertyId, fullSyncAt: s.fullSyncAt || '', pausedUntil: '', lastError: '', pending: 0, channels: s.channels || [] };
  }
  function connected(bid) { return CONNECTED.indexOf(conn(bid).status) >= 0; }
  function typeConnected(tid) { var t = O.unitType(tid); return !!(t && connected(t.buildingId)); }
  /* what is wrong before a building can connect (the server's buildingProblems) */
  function problems(bid) {
    var b = O.building(bid), out = [];
    if (!b) return ['That building was not found.'];
    if (isArchived(b)) out.push('This building is archived.');
    if (!String(b.name || '').trim()) out.push('Give the building a name (it is the name guests see on booking sites).');
    if (!String(b.address || '').trim()) out.push('Add the building address.');
    if (!String(b.city || '').trim()) out.push('Add the city.');
    var wb = D.workspaceBrand && typeof D.workspaceBrand === 'object' ? D.workspaceBrand : {};
    var email = String(b.email || wb.email || '').trim(), phone = String(b.phone || wb.phone || '').trim();
    if (!email) out.push('Add an email address for the building (or the business email in Brand). Booking sites need it.');
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) out.push('Check the building email address (' + email + ').');
    if (!phone) out.push('Add a phone number for the building (or the business phone in Brand). Booking sites need it.');
    else if (!/^\+?[\d\s()-]{7,20}$/.test(phone)) out.push('Check the building phone number (' + phone + '). Use digits, spaces and +.');
    if (!/^[A-Za-z]{2}$/.test(String(b.country || 'MY').trim())) out.push('The country should be a two-letter code such as MY.');
    if (!/^[A-Za-z]{3}$/.test(String(b.currency || 'MYR').trim())) out.push('The currency should be a three-letter code such as MYR.');
    var types = typesOf(bid);
    if (!types.length) out.push('Add at least one unit type to this building.');
    var untagged = D.properties.filter(function (u) { return !isArchived(u) && u.buildingId === bid && !types.some(function (t) { return t.id === u.unitTypeId; }); });
    if (untagged.length) out.push('Choose a unit type for every unit in this building (' + untagged.slice(0, 5).map(function (u) { return u.unitNo || u.name || u.id; }).join(', ') + (untagged.length > 5 ? ' and ' + (untagged.length - 5) + ' more' : '') + ').');
    types.forEach(function (t) {
      if (!unitCount(t.id)) out.push('"' + t.name + '" has no units yet.');
      var ps = plansOf(t.id), names = {};
      if (!ps.length) out.push('"' + t.name + '" needs a rate plan.');
      ps.forEach(function (p) { var k = String(p.name || '').trim().toLowerCase(); if (names[k]) out.push('"' + t.name + '" has two rate plans called "' + p.name + '".'); names[k] = 1; });
    });
    return out.filter(function (x, i, a) { return a.indexOf(x) === i; });
  }

  /* ---------------- practice mode: what would be sent ---------------- */
  var SIM = { snap: null, t: null };
  function compress(rows) { /* [{date, v}] sorted -> runs of consecutive dates with the same value */
    var out = [], cur = null;
    rows.forEach(function (r) {
      var c = JSON.stringify(r.v);
      if (cur && cur.c === c && d.add(cur.to, 1) === r.date) { cur.to = r.date; return; }
      cur = { from: r.date, to: r.date, c: c, v: r.v }; out.push(cur);
    });
    return out;
  }
  /* {bid: {avail: {typeId: {iso: n}}, restr: {planId: {iso: value}}}} for the connected buildings, today + 499 */
  function snapshot(onlyBid) {
    var out = {}, T = D.TODAY, last = d.add(T, DAYS - 1), map = crMap(), B = SIMB();
    Object.keys(B).forEach(function (bid) {
      if (onlyBid && bid !== onlyBid) return;
      if (['syncing', 'live'].indexOf(B[bid].status) < 0 || !O.building(bid)) return;
      var s = out[bid] = { avail: {}, restr: {} };
      O.typesOf(bid, true).forEach(function (t) {
        var a = s.avail[t.id] = {};
        if (isArchived(t)) { d.range(T, last).forEach(function (iso) { a[iso] = 0; }); }
        else O.assign.typeAvailability({ unitTypeId: t.id, units: D.properties, bookings: D.bookings, blocks: D.blocks || [], from: T, to: last }).forEach(function (n) { a[n.date] = Math.max(0, n.availability); });
        plansOf(t.id, true).forEach(function (p) { var r = s.restr[p.id] = {}; d.range(T, last).forEach(function (iso) { r[iso] = restrictionValue(p, iso, map); }); });
      });
    });
    return out;
  }
  function simItems(kind, target, rows) {
    return compress(rows).map(function (r) {
      var it = {}; it[kind === 'availability' ? 'room_type_id' : 'rate_plan_id'] = 'sim-' + target;
      if (r.from === r.to) it.date = r.from; else { it.date_from = r.from; it.date_to = r.to; }
      return Object.assign(it, r.v);
    });
  }
  function simLog(bid, kind, source, items) {
    if (!items.length) return;
    var b = O.building(bid), what = kind === 'availability' ? 'availability' : 'rates and restrictions';
    D.channelLog.unshift({
      id: O.uid('CL'), at: D.NOW, buildingId: bid, endpoint: kind === 'availability' ? '/availability' : '/restrictions', source: source, items: items.length,
      sample: items.slice(0, 12), by: O.state.viewer,
      text: 'Would send ' + (source === 'full' ? 'a full update of ' + what + ' (500 days)' : what + ': ' + fmt.plural(items.length, 'update')) + ' for ' + (b ? b.name : 'a building')
    });
    if (D.channelLog.length > 500) D.channelLog.length = 500;
  }
  function simDiff() {
    var now = snapshot(), before = SIM.snap; SIM.snap = now;
    if (!before) return 0;
    var n = 0;
    Object.keys(now).forEach(function (bid) {
      var a = now[bid], b = before[bid]; if (!b) return; /* connected just now: the full update was logged */
      [['availability', 'avail'], ['restrictions', 'restr']].forEach(function (k) {
        var items = [];
        Object.keys(a[k[1]]).forEach(function (target) {
          var x = a[k[1]][target], y = b[k[1]][target] || {}, rows = [];
          Object.keys(x).sort().forEach(function (iso) {
            var v = x[iso], w = y[iso];
            if (k[0] === 'availability') { if (v !== w) rows.push({ date: iso, v: { availability: v } }); }
            else if (JSON.stringify(v) !== JSON.stringify(w)) rows.push({ date: iso, v: v });
          });
          items = items.concat(simItems(k[0], target, rows));
        });
        if (items.length) { simLog(bid, k[0], 'delta', items); n++; }
      });
    });
    return n;
  }
  function simFull(bid) {
    var s = snapshot(bid)[bid]; if (!s) return;
    var av = [], rs = [];
    Object.keys(s.avail).forEach(function (t) { av = av.concat(simItems('availability', t, Object.keys(s.avail[t]).sort().map(function (iso) { return { date: iso, v: { availability: s.avail[t][iso] } }; }))); });
    Object.keys(s.restr).forEach(function (p) { rs = rs.concat(simItems('restrictions', p, Object.keys(s.restr[p]).sort().map(function (iso) { return { date: iso, v: s.restr[p][iso] }; }))); });
    simLog(bid, 'availability', 'full', av); simLog(bid, 'restrictions', 'full', rs);
    if (SIM.snap) SIM.snap[bid] = s;
  }

  /* ---------------- kick: after a save, send what changed ---------------- */
  var K = { t: null, again: null, busy: false };
  function kick(delay) {
    clearTimeout(K.t);
    K.t = setTimeout(function () {
      if (mode() !== 'live' || K.busy) return;
      K.busy = true;
      O.auth.channex('flush').then(function (r) {
        K.busy = false;
        clearTimeout(K.again);
        if (r && r.pending && r.waitingUntil) { var ms = Math.min(10 * 60e3, Math.max(2500, Date.parse(r.waitingUntil) - Date.now() + 1000)); K.again = setTimeout(function () { kick(0); }, ms); }
        reloadSoon(400);
      }, function (e) {
        K.busy = false;
        if (e && e.code === 'flush-busy') { kick(2500); return; }
        reloadSoon(400);
      });
    }, delay == null ? 2500 : delay);
  }
  O.on('synced', function (p) {
    var colls = (p && p.colls) || [];
    if (!colls.some(function (c) { return WATCH.indexOf(c) >= 0; })) return;
    var m = mode();
    if (m === 'live' && p.adapter === 'server') { if (Object.keys(L.props).some(function (bid) { return connected(bid); }) || !L.loaded) kick(); return; }
    if (m === 'simulated') { clearTimeout(SIM.t); SIM.t = setTimeout(function () { if (simDiff()) O.emit('data', { type: 'channel-log' }); }, 600); }
  });
  /* another device saved: it logs its own changes, so only move the baseline */
  O.on('remote', function () { if (mode() === 'simulated' && O.sync.status !== 'saving') SIM.snap = null; setTimeout(function () { if (!SIM.snap && mode() === 'simulated') SIM.snap = snapshot(); }, 50); });
  O.on('day', function () { SIM.snap = null; });

  /* ---------------- conflicts and issues ---------------- */
  function conflicts() {
    var out = [], T = D.TODAY, end = d.add(T, 89);
    D.bookings.forEach(function (b) {
      if (b.status === 'cancelled' || b.checkOut <= T) return;
      if (b.conflict && b.conflict.kind === 'double_booking') out.push({ kind: 'double_booking', tone: 'bad', bookingId: b.id, t: 'Double booking: ' + b.guest.name, s: (b.reservationCode ? U.platName(b.channel) + ' ' + b.reservationCode + ' · ' : '') + d.fmtRange(b.checkIn, b.checkOut), go: ['bookings', { bookingId: b.id }] });
      if (b.unitTypeId && !b.propertyId) { var t = O.unitType(b.unitTypeId); out.push({ kind: 'needs_unit', tone: b.checkIn <= d.add(T, 2) ? 'bad' : 'warn', bookingId: b.id, t: 'Needs a unit: ' + b.guest.name, s: (t ? t.name + ' · ' : '') + d.fmtRange(b.checkIn, b.checkOut), go: ['bookings', { bookingId: b.id }] }); }
    });
    D.unitTypes.forEach(function (t) {
      if (isArchived(t) || !unitCount(t.id)) return;
      var over = O.assign.typeAvailability({ unitTypeId: t.id, units: D.properties, bookings: D.bookings, blocks: D.blocks || [], from: T, to: end }).filter(function (n) { return n.raw < 0; });
      if (over.length) out.push({ kind: 'oversold', tone: 'bad', t: t.name + ' is oversold on ' + fmt.plural(over.length, 'night'), s: 'More bookings than units from ' + d.fmt(over[0].date) + '. Move or cancel one.', go: ['calendar', { propertyId: '', from: over[0].date }] });
    });
    if (mode() === 'live') L.alerts.forEach(function (a) {
      if (a.kind === 'double_booking' || a.kind === 'needs_unit') { var ref = a.ref || {}; if (ref.bookingId && out.some(function (x) { return x.bookingId === ref.bookingId; })) return; }
      out.push({ kind: 'alert', tone: a.kind === 'rate_warning' || a.kind === 'non_acked' ? 'warn' : 'bad', alertId: a.id, t: ALERT_KIND[a.kind] || 'Channel issue', s: a.message || '', go: a.ref && a.ref.bookingId ? ['bookings', { bookingId: a.ref.bookingId }] : ['channels', { tab: 'alerts' }] });
    });
    return out;
  }
  O.notifiers.push(function () {
    if (!(O.can('channels') || O.can('bookings'))) return [];
    return conflicts().slice(0, 6).map(function (c) { return { icon: '⚠', tone: c.tone, t: c.t, s: c.s, go: c.go }; });
  });

  /* ---------------- mode-aware sentences for other pages ---------------- */
  function notice(kind, typeIds) {
    var m = mode(), ts = (typeIds || []).filter(Boolean), conn1 = ts.some(typeConnected);
    if (kind === 'price') {
      if (m === 'live' && conn1) return 'Your channels update within a minute.';
      if (m === 'live') return 'This unit is not connected to channels, so change the price on each booking site too.';
      return 'Channel calendars update within 15 minutes (prototype: nothing is sent).';
    }
    if (kind === 'rates') {
      if (m === 'live' && conn1) return 'Your channels update within a minute.';
      if (conn1) return 'Practice mode: nothing goes to booking sites. Channels → Sync log shows what would be sent.';
      return 'These unit types are not connected to channels yet, so nothing is sent.';
    }
    var open = kind === 'unblock';
    if (m === 'live' && conn1) return open ? 'Your channels open these nights again within a minute.' : 'Your channels close these nights within a minute.';
    if (m === 'live') return open ? 'This unit is not connected to channels, so open these nights on each booking site too.' : 'This unit is not connected to channels, so close these nights on each booking site too.';
    if (conn1) return 'Practice mode: nothing goes to booking sites. Channels → Sync log shows what would be sent.';
    return open ? 'Open these nights on each booking site too: practice mode sends nothing.' : 'Close these nights on each booking site too: practice mode sends nothing.';
  }

  O.channel = {
    mode: mode, modeReason: modeReason, setDays: setDays, fill: fill, kick: kick, conflicts: conflicts, notice: notice,
    plansOf: plansOf, plan: planById, mainPlan: mainPlan, planRate: function (planId, iso) { return planRate(planById(planId), iso, crMap(), 0); },
    day: function (planId, iso) { return dayOf(crMap(), planId, iso); }, rateMap: crMap, planRateIn: function (map, plan, iso) { return planRate(plan, iso, map, 0); }, dayIn: dayOf,
    restriction: function (planId, iso) { var p = planById(planId); return p ? restrictionValue(p, iso, crMap()) : null; },
    connected: connected, typeConnected: typeConnected, status: conn, problems: problems, currency: curOf, reload: reload,
    canEditRates: function () { return O.can('channels.rates'); }, DAYS: DAYS, MEALS: MEALS
  };

  /* ================================================================= page ================================================================= */
  O.css('channels', `
.pg-channels .tabs .tab-n{display:inline-flex; align-items:center; justify-content:center; min-width:18px; height:18px; padding:0 5px; border-radius:9px; background:var(--bad-soft); color:var(--bad); font-size:10.5px; font-weight:800; margin-left:6px; vertical-align:1px;}
.pg-channels .ch-mode{margin-bottom:14px; display:flex; gap:10px; align-items:flex-start;}
.pg-channels .ch-mode svg{width:18px; height:18px; flex:none; margin-top:1px;}
.pg-channels .ch-grid{display:grid; grid-template-columns:repeat(auto-fill, minmax(340px, 1fr)); gap:14px;}
.pg-channels .ch-card .card-head h3{display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
.pg-channels .ch-types{display:flex; flex-direction:column; gap:6px; margin-bottom:12px;}
.pg-channels .ch-type{display:flex; justify-content:space-between; gap:10px; font-size:13px; padding:7px 10px; background:var(--surface-2); border:1px solid var(--border); border-radius:9px;}
.pg-channels .ch-type b{font-weight:800;}
.pg-channels .ch-type span{color:var(--muted); font-size:12px; white-space:nowrap;}
.pg-channels .ch-facts{display:grid; grid-template-columns:auto 1fr; gap:4px 12px; font-size:12.5px; margin-bottom:12px;}
.pg-channels .ch-facts dt{color:var(--muted);}
.pg-channels .ch-facts dd{margin:0; font-weight:600; min-width:0; overflow-wrap:anywhere;}
.pg-channels .ch-acts{display:flex; flex-wrap:wrap; gap:8px;}
.pg-channels .ch-probs{margin:0 0 12px; padding-left:18px; font-size:12.5px; color:var(--text-2); line-height:1.5;}
.pg-channels .ch-err{font-size:12.5px; color:var(--bad); background:var(--bad-soft); border-radius:8px; padding:8px 10px; margin-bottom:12px;}
.pg-channels .ch-chs{display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px;}
.pg-channels .ch-tbl td{vertical-align:top;}
.pg-channels .ch-tbl .mono, .ch-modal .mono{font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11.5px;}
.pg-channels .ch-task{display:inline-flex; align-items:center; gap:4px; margin:0 6px 4px 0; background:var(--surface-2); border:1px solid var(--border); border-radius:6px; padding:1px 2px 1px 6px; max-width:100%;}
.pg-channels .ch-task span{overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:220px;}
.pg-channels .ch-task button{border:none; background:none; padding:2px 4px; color:var(--brand-strong); font-weight:700; font-size:11px; border-radius:4px;}
.pg-channels .ch-task button:hover{background:var(--brand-soft);}
.pg-channels .ch-warn{color:var(--warn); font-size:12px;}
.pg-channels .ch-plan-t{margin-bottom:14px;}
.pg-channels .ch-alert{display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; padding:12px 16px; border-bottom:1px solid var(--border); align-items:start;}
.pg-channels .ch-alert:last-child{border-bottom:none;}
.pg-channels .ch-alert .t{font-weight:800; font-size:13px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;}
.pg-channels .ch-alert .s{font-size:12.5px; color:var(--text-2); margin-top:3px;}
.pg-channels .ch-alert .w{font-size:11.5px; color:var(--muted); margin-top:3px;}
.pg-channels .ch-alert .a{display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;}
.pg-channels .ch-wait{font-size:12.5px; margin-bottom:12px;}
.modal.ch-frame{max-width:none; width:calc(100vw - 32px); height:calc(100vh - 48px); max-height:none;}
.modal-back:has(.ch-frame){padding:16px;}
.modal.ch-frame .modal-body{padding:0; flex:1; display:flex; overflow:hidden;}
.modal.ch-frame iframe{border:0; width:100%; height:100%; flex:1; background:#fff;}
.ch-modal pre{white-space:pre-wrap; word-break:break-all; background:var(--surface-2); border:1px solid var(--border); border-radius:8px; padding:10px; max-height:50vh; overflow:auto; font-size:11.5px; margin:0;}
@media (max-width:760px){
  .pg-channels .ch-grid{grid-template-columns:1fr;}
  .pg-channels .ch-alert{grid-template-columns:1fr;}
  .pg-channels .ch-alert .a{justify-content:flex-start;}
  .pg-channels .ch-hide-sm{display:none;}
}
`);

  function pill(status) { var s = STATUS[status] || STATUS.none; return '<span class="pill ' + s[1] + '" data-status="' + esc(status) + '">' + esc(s[0]) + '</span>'; }
  function lastSent(bid, c) {
    if (c.live) {
      var call = L.calls.filter(function (x) { return x.channex_property_id === c.propertyId && (x.endpoint === '/availability' || x.endpoint === '/restrictions') && x.http_status && x.http_status < 300; })[0];
      return call ? when(myTime(call.at)) + ' · ' + (call.endpoint === '/availability' ? 'availability' : 'rates') : '';
    }
    var e = D.channelLog.filter(function (x) { return x.buildingId === bid; })[0];
    return e ? when(e.at) + ' · ' + (e.endpoint === '/availability' ? 'availability' : 'rates') : '';
  }

  /* ---------- actions ---------- */
  function errMsg(e) { return (e && e.message) || 'Something went wrong. Please try again.'; }
  function settle(n) { /* wait until every change is saved, so the server sees the same building */
    n = n || 0;
    return Promise.resolve(O.sync.flush()).then(function () { if (n < 6 && (O.sync._writing || O.sync.pending || O.sync._timer)) return new Promise(function (r) { setTimeout(r, 300); }).then(function () { return settle(n + 1); }); });
  }
  function busy(btn, on, label) { if (!btn) return; if (on) { btn.dataset.lbl = btn.textContent; btn.disabled = true; btn.textContent = label || 'Working…'; } else { btn.disabled = false; if (btn.dataset.lbl) btn.textContent = btn.dataset.lbl; } }
  function showProblems(list, title) {
    U.modal({ title: title || 'Before connecting', sub: 'Fix these in Properties, Buildings & unit types, or in Rate plans.', size: 'sm', body: '<ul class="ch-probs" style="margin:0;padding-left:18px;line-height:1.55">' + list.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>', actions: [{ label: 'Close' }, { label: 'Open Properties', kind: 'primary', onClick: function () { O.go('properties', { tab: 'types' }); } }] });
  }
  function connect(bid, btn) {
    var b = O.building(bid); if (!b) return;
    var probs = problems(bid);
    if (probs.length) { showProblems(probs); return; }
    var m = mode(), types = typesOf(bid);
    U.confirm('Orbique sets up ' + b.name + ' in the channel manager (' + fmt.plural(types.length, 'unit type') + ', ' + fmt.plural(types.reduce(function (s, t) { return s + plansOf(t.id).length; }, 0), 'rate plan') + ') and sends 500 days of availability, rates and restrictions.' + (m === 'live' ? '' : ' Practice mode: nothing is sent to booking sites.'), 'Connect', 'primary', 'Connect ' + b.name + '?').then(function (ok) {
      if (!ok) return;
      if (m !== 'live') {
        SIMB()[bid] = { status: 'live', propertyId: 'sim-' + O.uid('P').slice(2).toLowerCase(), connectedAt: D.NOW, fullSyncAt: D.NOW, channels: [] };
        simFull(bid);
        D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: 'channels', text: 'Connected ' + b.name + ' to channels (practice mode)' });
        U.toast(b.name + ' is connected in practice mode. The Sync log shows what would be sent.');
        O.emit('data', { type: 'channels' });
        return;
      }
      busy(btn, true, 'Connecting…');
      settle().then(function () { return O.auth.channex('connect', { buildingId: bid }); }).then(function (r) {
        busy(btn, false);
        U.toast(r && r.property && r.property.status === 'live' ? b.name + ' is connected. Everything was sent.' : b.name + ' is connected. Sending 500 days now.');
        reload();
      }, function (e) {
        busy(btn, false);
        if (e && e.body && Array.isArray(e.body.problems) && e.body.problems.length) showProblems(e.body.problems);
        else U.toast(errMsg(e), 'bad');
        reload();
      });
    });
  }
  function manage(bid, btn) {
    var b = O.building(bid), c = conn(bid);
    if (!c.live) {
      U.modal({
        title: 'Manage channels', sub: (b ? b.name : '') + ' · practice mode', size: 'sm',
        body: '<p style="margin:0 0 10px;line-height:1.5">Here you would connect Booking.com, Agoda, Airbnb, Expedia and Trip.com to this building and match their rooms and rates to your unit types and rate plans.</p><div class="note">Practice mode: the channel screen opens once this workspace is switched on for real channels.</div>',
        actions: [{ label: 'Close', kind: 'primary' }]
      });
      return;
    }
    busy(btn, true, 'Opening…');
    O.auth.channex('iframe', { buildingId: bid }).then(function (r) {
      busy(btn, false);
      if (O.native && O.native.browser && O.native.platform && O.native.platform !== 'web') { if (O.native.browser(r.url)) return; }
      U.modal({
        title: 'Manage channels', sub: (b ? b.name : '') + ' · connect Booking.com, Agoda, Airbnb, Expedia and Trip.com, and map rooms and rates', cls: 'ch-frame', autofocus: false,
        body: '<iframe title="Channel manager" src="' + esc(r.url) + '" allow="clipboard-write" referrerpolicy="no-referrer"></iframe>',
        onClose: function () { O.auth.channex('channels', { buildingId: bid }).then(function () { reload(); }, function () {}); }
      });
    }, function (e) { busy(btn, false); U.toast(errMsg(e), 'bad'); });
  }
  function fullUpdate(bid, btn) {
    var b = O.building(bid), c = conn(bid);
    var since = c.fullSyncAt ? (c.live ? Date.now() - Date.parse(c.fullSyncRaw) : Date.parse(D.NOW + ':00Z') - Date.parse(c.fullSyncAt + ':00Z')) : Infinity;
    if (since < 24 * 3600e3) { U.toast('A full update was sent less than 24 hours ago (' + when(c.fullSyncAt) + '). Changes still go out on their own.', 'bad'); return; }
    U.confirm('This sends all 500 days of availability, rates and restrictions for ' + (b ? b.name : 'this building') + ' again. Changes already go out on their own, so you only need this after a problem. Possible once every 24 hours.', 'Send full update', 'primary', 'Send everything again?').then(function (ok) {
      if (!ok) return;
      if (!c.live) {
        var s = SIMB()[bid]; if (s) s.fullSyncAt = D.NOW;
        simFull(bid);
        U.toast('Full update done in practice mode. The Sync log shows what would be sent.');
        O.emit('data', { type: 'channels' });
        return;
      }
      busy(btn, true, 'Sending…');
      settle().then(function () { return O.auth.channex('full-sync', { buildingId: bid, confirm: true }); }).then(function (r) {
        busy(btn, false);
        U.toast(r && r.done ? 'Full update sent.' : 'Full update started. It finishes in the background.');
        reload();
      }, function (e) { busy(btn, false); U.toast(errMsg(e), 'bad'); reload(); });
    });
  }
  function setState(bid, action, btn) {
    var b = O.building(bid), c = conn(bid);
    var ask = {
      pause: ['Nothing is sent to your channels until you resume. Bookings still arrive. Changes made meanwhile are sent when you resume.', 'Pause', 'Pause sending for ' + (b ? b.name : '') + '?'],
      disconnect: ['Orbique stops sending to the channels of ' + (b ? b.name : 'this building') + '. Your channels keep the last availability and prices they received, so close or disconnect them in the channel screen too. You can connect again later.', 'Disconnect', 'Disconnect ' + (b ? b.name : '') + '?']
    }[action];
    (ask ? U.confirm(ask[0], ask[1], action === 'disconnect' ? 'danger' : 'primary', ask[2]) : Promise.resolve(true)).then(function (ok) {
      if (!ok) return;
      if (!c.live) {
        var s = SIMB()[bid]; if (!s) return;
        if (action === 'pause') { s.status = 'paused'; s.pausedAt = D.NOW; }
        else if (action === 'disconnect') delete SIMB()[bid];
        else { s.status = 'live'; delete s.pausedAt; SIM.snap = null; }
        U.toast({ pause: 'Paused (practice mode).', resume: 'Sending again (practice mode).', retry: 'Sending again (practice mode).', disconnect: 'Disconnected (practice mode).' }[action]);
        O.emit('data', { type: 'channels' });
        setTimeout(function () { if (!SIM.snap) SIM.snap = snapshot(); }, 0);
        return;
      }
      busy(btn, true);
      settle().then(function () { return O.auth.channex(action, { buildingId: bid }); }).then(function () {
        busy(btn, false);
        U.toast({ pause: 'Sending is paused.', resume: 'Sending again.', retry: 'Trying again now.', disconnect: (b ? b.name : 'The building') + ' is disconnected.' }[action]);
        reload();
      }, function (e) { busy(btn, false); U.toast(errMsg(e), 'bad'); reload(); });
    });
  }

  /* ---------- rate plan editor ---------- */
  function planEditor(typeId, plan) {
    var t = O.unitType(typeId); if (!t) return;
    var cur = curOf(t.buildingId), others = plansOf(typeId).filter(function (p) { return !plan || p.id !== plan.id; });
    var isNew = !plan, p = plan || { name: plansOf(typeId).length ? '' : 'Best Available Rate', meal: 'room_only', primary: !mainPlan(typeId), defaultRate: '', minStay: 1, maxStay: 0, follows: null };
    var f = p.follows || {};
    var body = O.html('<div class="stack">' +
      '<div class="field"><label>Name</label><input class="input" name="name" maxlength="60" value="' + esc(p.name || '') + '" placeholder="For example: Best Available Rate, Bed & Breakfast"><div class="hint">Guests see this name on booking sites.</div></div>' +
      '<div class="form-grid"><div class="field"><label>Meals</label><select class="select" name="meal">' + MEALS.map(function (m) { return '<option value="' + m[0] + '"' + (m[0] === (p.meal || 'room_only') ? ' selected' : '') + '>' + esc(m[1]) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>Default rate (' + esc(cur) + ' a night)</label><input class="input" name="rate" type="number" min="1" step="0.01" inputmode="decimal" value="' + esc(p.defaultRate == null ? '' : p.defaultRate) + '"></div></div>' +
      '<div class="form-grid"><div class="field"><label>Minimum stay (nights)</label><input class="input" name="min" type="number" min="1" step="1" value="' + esc(p.minStay || 1) + '"></div>' +
      '<div class="field"><label>Maximum stay (nights)</label><input class="input" name="max" type="number" min="0" step="1" value="' + esc(p.maxStay || 0) + '"><div class="hint">0 means no maximum.</div></div></div>' +
      '<label class="check"><input type="checkbox" name="primary"' + (p.primary ? ' checked' : '') + '><span><b>Main plan</b><br><span class="small muted">Its rate is the price of the ' + esc(t.name) + ' units in Pricing. One per unit type.</span></span></label>' +
      (others.length ? '<div class="field"><label>Price follows another plan</label><div class="form-grid"><select class="select" name="fp"><option value="">No, it has its own rates</option>' + others.map(function (o) { return '<option value="' + esc(o.id) + '"' + (f.planId === o.id ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('') + '</select>' +
        '<div class="row-flex"><select class="select" name="ft" style="width:auto"><option value="amount"' + (f.type !== 'pct' ? ' selected' : '') + '>plus ' + esc(cur) + '</option><option value="pct"' + (f.type === 'pct' ? ' selected' : '') + '>plus %</option></select><input class="input" name="fv" type="number" step="0.01" value="' + esc(f.value == null ? '' : f.value) + '" style="width:110px"></div></div><div class="hint">For example Bed & Breakfast = Best Available Rate plus 40. Use a minus number for a discount.</div></div>' : '') +
      '<div class="blk-sum bad" hidden></div></div>');
    function read() {
      var v = { name: O.$('[name=name]', body).value.trim(), meal: O.$('[name=meal]', body).value, rate: num(O.$('[name=rate]', body).value), min: posInt(O.$('[name=min]', body).value) || 1, max: Math.max(0, Math.floor(num(O.$('[name=max]', body).value) || 0)), primary: O.$('[name=primary]', body).checked };
      var fp = O.$('[name=fp]', body); v.follows = fp && fp.value ? { planId: fp.value, type: O.$('[name=ft]', body).value === 'pct' ? 'pct' : 'amount', value: num(O.$('[name=fv]', body).value) || 0 } : null;
      return v;
    }
    function check(v) {
      if (!v.name) return 'Give the rate plan a name.';
      if (plansOf(typeId).some(function (o) { return o !== plan && String(o.name).trim().toLowerCase() === v.name.toLowerCase(); })) return t.name + ' already has a rate plan called "' + v.name + '".';
      if (!(v.rate > 0)) return 'Enter a default rate above 0.';
      if (v.max && v.max < v.min) return 'The maximum stay is shorter than the minimum stay.';
      if (v.follows && v.primary) return 'A main plan has its own rates. Untick Main plan or stop following the other plan.';
      if (v.follows) { var x = planById(v.follows.planId), hops = 0; while (x && hops++ < 6) { if (plan && x.id === plan.id) return 'These plans would follow each other in a circle.'; x = x.follows ? planById(x.follows.planId) : null; } }
      return '';
    }
    var acts = [{ label: 'Cancel' }];
    if (!isNew && !isArchived(plan)) acts.unshift({
      label: 'Archive', kind: 'danger', onClick: function () {
        if (plansOf(typeId).length === 1 && typeConnected(typeId)) { U.toast(t.name + ' needs at least one rate plan while it is connected.', 'bad'); return false; }
        if (plansOf(typeId).some(function (o) { return o.follows && o.follows.planId === plan.id; })) { U.toast('Another plan follows this one. Change that plan first.', 'bad'); return false; }
        plan.archived = true; plan.primary = false; plan.updatedAt = D.NOW;
        if (!mainPlan(typeId)) { var nx = plansOf(typeId).filter(function (o) { return !o.follows; })[0]; if (nx) nx.primary = true; }
        D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: 'channels', text: 'Archived the rate plan ' + plan.name + ' (' + t.name + ')' });
        fill([typeId]);
        U.toast(plan.name + ' is archived.' + (typeConnected(typeId) ? ' Booking sites stop selling it.' : ''));
        O.emit('data', { type: 'channels' });
      }
    });
    acts.push({
      label: isNew ? 'Add rate plan' : 'Save', kind: 'primary', onClick: function () {
        var v = read(), err = check(v), box = O.$('.blk-sum', body);
        if (err) { box.hidden = false; box.textContent = err; return false; }
        var x = plan || { id: O.uid('RP'), unitTypeId: typeId, createdAt: D.NOW, createdBy: O.state.viewer };
        x.name = v.name; x.meal = v.meal; x.defaultRate = round2(v.rate); x.minStay = v.min; x.maxStay = v.max; x.follows = v.follows; x.primary = v.primary; x.updatedAt = D.NOW;
        if (x.primary) plansOf(typeId).forEach(function (o) { if (o !== x) o.primary = false; });
        if (isNew) D.ratePlans.push(x);
        D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: 'channels', text: (isNew ? 'Added the rate plan ' : 'Changed the rate plan ') + x.name + ' (' + t.name + ')' });
        fill([typeId]);
        U.toast(isNew ? x.name + ' added to ' + t.name + '.' : 'Saved.');
        O.emit('data', { type: 'channels' });
      }
    });
    U.modal({ title: isNew ? 'New rate plan' : 'Rate plan', sub: O.typeTitle(t), body: body, actions: acts });
  }

  /* ---------- sync log ---------- */
  function callWhat(c) {
    var ep = String(c.endpoint || ''), src = { delta: 'change', full: 'full update', setup: 'setup', booking: 'booking', ack: 'booking confirmed', feed: 'booking feed', iframe: 'channel screen', channels: 'channel list' }[c.source] || c.source || '';
    return { ep: (c.method || 'POST') + ' ' + ep, src: src };
  }
  function openPayload(c) {
    var body = O.html('<div class="stack ch-modal"><div class="small muted">Loading…</div></div>');
    U.modal({ title: callWhat(c).ep, sub: when(myTime(c.at)) + (c.http_status ? ' · HTTP ' + c.http_status : ''), size: 'wide', body: body, actions: [{ label: 'Close', kind: 'primary' }] });
    O.auth.supabase().from('channex_calls').select('payload, task_ids, warnings, error').eq('id', c.id).maybeSingle().then(function (r) {
      var x = (r && r.data) || {};
      body.innerHTML = (x.error ? '<div class="ch-err">' + esc(x.error) + '</div>' : '') +
        (x.task_ids && x.task_ids.length ? '<div><b>Task ids</b><pre class="mono">' + esc(x.task_ids.join('\n')) + '</pre></div>' : '') +
        (x.warnings && (x.warnings.length || Object.keys(x.warnings).length) ? '<div><b>Warnings</b><pre class="mono">' + esc(JSON.stringify(x.warnings, null, 2)) + '</pre></div>' : '') +
        '<div><b>What was sent</b><pre class="mono">' + esc(x.payload == null ? 'Nothing: this call only reads from Channex.' : JSON.stringify(x.payload, null, 2)) + '</pre></div>';
    }, function () { body.innerHTML = '<div class="ch-err">Could not load this call.</div>'; });
  }
  function tasksHTML(ids) {
    if (!Array.isArray(ids) || !ids.length) return '<span class="muted">–</span>';
    return ids.map(function (id) { return '<span class="ch-task"><span class="mono" title="' + esc(id) + '">' + esc(id) + '</span><button type="button" data-copy="' + esc(id) + '" aria-label="Copy task id">Copy</button></span>'; }).join('');
  }
  function warnHTML(w) {
    var n = Array.isArray(w) ? w.length : w && typeof w === 'object' ? Object.keys(w).length : 0;
    return n ? '<span class="ch-warn" title="' + esc(JSON.stringify(w).slice(0, 400)) + '">' + fmt.plural(n, 'warning') + '</span>' : '<span class="muted">–</span>';
  }
  function logHTML(m) {
    if (m === 'live') {
      var waiting = Object.keys(L.props).map(function (bid) { var c = conn(bid); return c.pending || c.pausedUntil ? { bid: bid, c: c } : null; }).filter(Boolean);
      var head = waiting.length ? waiting.map(function (w) { var b = O.building(w.bid); return '<div class="note warn ch-wait"><b>' + esc(b ? b.name : w.bid) + '</b>: ' + fmt.plural(w.c.pending, 'change') + ' waiting' + (w.c.pausedUntil ? ', waiting (rate limit) until ' + esc(fmt.time(w.c.pausedUntil)) : '') + '.</div>'; }).join('') : '';
      var rows = L.calls.map(function (c) {
        var w = callWhat(c), ok = c.http_status && c.http_status < 300;
        var bid = Object.keys(L.props).filter(function (k) { return L.props[k].channex_property_id === c.channex_property_id; })[0], b = bid && O.building(bid);
        return '<tr class="click" data-call="' + esc(c.id) + '"><td class="nowrap">' + esc(when(myTime(c.at))) + '</td><td><div class="mono">' + esc(w.ep) + '</div><div class="xs muted">' + esc(w.src + (b ? ' · ' + b.name : '')) + '</div></td>' +
          '<td class="num">' + (c.item_count == null ? '–' : c.item_count) + '</td><td>' + (c.http_status ? U.pill(String(c.http_status), ok ? 'ok' : c.http_status === 429 ? 'warn' : 'bad') : c.error ? U.pill('No answer', 'bad') : '–') + (c.error ? '<div class="xs" style="color:var(--bad);max-width:220px">' + esc(String(c.error).slice(0, 140)) + '</div>' : '') + '</td>' +
          '<td>' + tasksHTML(c.task_ids) + '</td><td class="ch-hide-sm">' + warnHTML(c.warnings) + '</td></tr>';
      }).join('');
      var all = []; L.calls.forEach(function (c) { (c.task_ids || []).forEach(function (t) { all.push(t); }); });
      return head + '<div class="card"><div class="card-head"><div><h3>Sync log</h3><div class="sub">Every call to the channel manager, newest first. Task ids are what certification asks for.</div></div>' +
        (all.length ? '<button type="button" class="btn btn-ghost btn-sm" data-copy-all="1">' + O.icon('copy') + 'Copy all task ids</button>' : '') + '</div>' +
        (rows ? '<div class="table-wrap"><table class="table ch-tbl"><thead><tr><th>Time</th><th>Call</th><th class="num">Items</th><th>HTTP</th><th>Task ids</th><th class="ch-hide-sm">Warnings</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : U.empty(L.loaded ? 'Nothing sent yet. Connect a building to start.' : 'Loading…', O.icon('refresh'))) + '</div>';
    }
    var list = D.channelLog || [];
    var rows2 = list.slice(0, 200).map(function (e, i) {
      var b = O.building(e.buildingId);
      return '<tr class="click" data-sim="' + i + '"><td class="nowrap">' + esc(when(e.at)) + '</td><td><div class="mono">POST ' + esc(e.endpoint || '') + '</div><div class="xs muted">' + esc((e.source === 'full' ? 'full update' : 'change') + (b ? ' · ' + b.name : '')) + '</div></td><td class="num">' + (e.items || 0) + '</td><td>' + U.pill('Not sent', 'neutral') + '</td><td>' + esc(e.text || '') + '</td></tr>';
    }).join('');
    return '<div class="card"><div class="card-head"><div><h3>Sync log</h3><div class="sub">Practice mode: what Orbique would send to your channels, newest first. Nothing leaves Orbique.</div></div></div>' +
      (rows2 ? '<div class="table-wrap"><table class="table ch-tbl"><thead><tr><th>Time</th><th>Call</th><th class="num">Items</th><th>Status</th><th>What</th></tr></thead><tbody>' + rows2 + '</tbody></table></div>' : U.empty('Nothing yet. Connect a building, then change a price, a block or a booking.', O.icon('refresh'))) + '</div>';
  }

  /* ---------- alerts ---------- */
  function alertsHTML(m) {
    var local = conflicts().filter(function (c) { return c.kind !== 'alert'; });
    var canResolve = O.can('channels', 'edit');
    var server = m === 'live' ? L.alerts : [];
    var a1 = server.map(function (a) {
      var ref = a.ref || {};
      return '<div class="ch-alert" data-alert="' + esc(a.id) + '"><div><div class="t">' + U.pill(ALERT_KIND[a.kind] || 'Channel issue', a.kind === 'rate_warning' || a.kind === 'non_acked' ? 'warn' : 'bad') + '</div><div class="s">' + esc(a.message || '') + '</div><div class="w">' + esc(when(myTime(a.created_at))) + '</div></div>' +
        '<div class="a">' + (a.kind === 'rate_warning' && ref.buildingId && Array.isArray(ref.items) && ref.items.length && O.can('channels.connect') ? '<button type="button" class="btn btn-ghost btn-sm" data-act="retry" data-b="' + esc(ref.buildingId) + '">' + O.icon('refresh') + 'Send again</button>' : '') +
        (ref.bookingId && D.booking(ref.bookingId) ? '<button type="button" class="btn btn-ghost btn-sm" data-open-b="' + esc(ref.bookingId) + '">Open booking</button>' : '') + (canResolve ? '<button type="button" class="btn btn-ghost btn-sm" data-resolve="' + esc(a.id) + '">' + O.icon('check') + 'Resolve</button>' : '') + '</div></div>';
    }).join('');
    var a2 = local.map(function (c) {
      return '<div class="ch-alert"><div><div class="t">' + U.pill(c.kind === 'double_booking' ? 'Double booking' : c.kind === 'needs_unit' ? 'Needs a unit' : 'Oversold', c.tone) + esc(c.t.replace(/^[^:]*: /, '')) + '</div><div class="s">' + esc(c.s) + '</div></div>' +
        '<div class="a">' + (c.bookingId ? '<button type="button" class="btn btn-ghost btn-sm" data-open-b="' + esc(c.bookingId) + '">Open booking</button>' : '<button type="button" class="btn btn-ghost btn-sm" data-cal="' + esc(c.go[1] && c.go[1].from || '') + '">Open calendar</button>') + '</div></div>';
    }).join('');
    return (m === 'live' ? '<div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>From the channel manager</h3><div class="sub">Sending problems, bookings Orbique could not match and channel changes. Resolve them once handled.</div></div></div>' + (a1 || U.empty('No open alerts.', O.icon('check'))) + '</div>' : '') +
      '<div class="card"><div class="card-head"><div><h3>Bookings that need you</h3><div class="sub">Double bookings, bookings without a unit and oversold nights in the next 90 days.</div></div></div>' + (a2 || U.empty('Nothing needs you. Every booking has a unit.', O.icon('check'))) + '</div>';
  }

  /* ---------- buildings ---------- */
  function buildingCard(b, m) {
    var c = conn(b.id), on = CONNECTED.indexOf(c.status) >= 0, types = typesOf(b.id), probs = on ? [] : problems(b.id);
    var canConnect = O.can('channels.connect'), canSync = O.can('channels.sync'), owner = O.isOwner();
    var typesH = types.length ? types.map(function (t) {
      var n = unitCount(t.id), ps = plansOf(t.id);
      return '<div class="ch-type"><b>' + esc(t.name) + '</b><span>' + fmt.plural(n, 'unit') + ' · ' + fmt.plural(ps.length, 'rate plan') + '</span></div>';
    }).join('') : '<div class="small muted">No unit types yet.</div>';
    var sent = on || c.status === 'disconnected' ? lastSent(b.id, c) : '';
    var facts = '';
    if (on) {
      facts = '<dl class="ch-facts"><dt>Last sent</dt><dd>' + esc(sent || 'Nothing yet') + '</dd>' +
        '<dt>Waiting</dt><dd data-pending="' + c.pending + '">' + (c.pending ? fmt.plural(c.pending, 'change') : 'Nothing') + (c.pausedUntil ? ' · waiting (rate limit) until ' + esc(fmt.time(c.pausedUntil)) : '') + '</dd>' +
        '<dt>Full update</dt><dd>' + esc(c.fullSyncRequested ? 'Sending now' : c.fullSyncAt ? when(c.fullSyncAt) : 'Not yet') + '</dd>' +
        '<dt>Currency</dt><dd>' + esc(curOf(b.id)) + '</dd>' +
        (c.propertyId ? '<dt>Property id</dt><dd class="mono xs">' + esc(c.propertyId) + '</dd>' : '') + '</dl>';
    }
    var chs = on && c.channels && c.channels.length ? '<div class="ch-chs">' + c.channels.map(function (x) { return U.pill(x.title || x.channel || 'Channel', x.isActive ? 'ok' : 'neutral'); }).join('') + '</div>' : '';
    var acts = [];
    if (!on && canConnect && m !== 'unknown') acts.push('<button type="button" class="btn btn-primary btn-sm" data-act="connect" data-b="' + esc(b.id) + '">' + O.icon('channels') + (c.status === 'disconnected' ? 'Connect again' : 'Connect') + '</button>');
    if (on && canConnect) acts.push('<button type="button" class="btn btn-primary btn-sm" data-act="manage" data-b="' + esc(b.id) + '">' + O.icon('channels') + 'Manage channels</button>');
    if (on && canSync && (c.status === 'live' || c.status === 'syncing')) acts.push('<button type="button" class="btn btn-ghost btn-sm" data-act="full" data-b="' + esc(b.id) + '">' + O.icon('refresh') + 'Send full update</button>');
    if (on && canConnect && (c.status === 'error' || c.pausedUntil)) acts.push('<button type="button" class="btn btn-ghost btn-sm" data-act="retry" data-b="' + esc(b.id) + '">Retry</button>');
    if (on && owner && c.status !== 'paused') acts.push('<button type="button" class="btn btn-ghost btn-sm" data-act="pause" data-b="' + esc(b.id) + '">Pause</button>');
    if (on && owner && c.status === 'paused') acts.push('<button type="button" class="btn btn-ghost btn-sm" data-act="resume" data-b="' + esc(b.id) + '">Resume</button>');
    if (on && owner) acts.push('<button type="button" class="btn btn-ghost btn-sm" data-act="disconnect" data-b="' + esc(b.id) + '">Disconnect</button>');
    if (!on && canConnect) acts.push('<button type="button" class="btn btn-ghost btn-sm" data-act="plans" data-b="' + esc(b.id) + '">Rate plans</button>');
    return '<div class="card ch-card" data-building="' + esc(b.id) + '"><div class="card-head"><div><h3>' + esc(b.name) + pill(c.status) + '</h3><div class="sub">' + esc([b.city, curOf(b.id)].filter(Boolean).join(' · ')) + '</div></div></div><div class="card-body">' +
      (c.lastError && on ? '<div class="ch-err"><b>Sending stopped.</b> ' + esc(c.lastError) + '</div>' : '') +
      '<div class="ch-types">' + typesH + '</div>' + chs + facts +
      (probs.length && !on ? '<div class="small b" style="margin-bottom:4px">Before connecting</div><ul class="ch-probs">' + probs.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') +
      (!on && !probs.length ? '<div class="small muted" style="margin-bottom:12px">Ready to connect. Booking sites see the building name and the unit type names, never unit numbers.</div>' : '') +
      (acts.length ? '<div class="ch-acts">' + acts.join('') + '</div>' : '') + '</div></div>';
  }
  function plansHTML() {
    var bs = buildingsList(), can = O.can('channels.connect');
    var cards = [];
    bs.forEach(function (b) {
      typesOf(b.id).forEach(function (t) {
        var ps = plansOf(t.id), cur = curOf(b.id), map = crMap();
        var rows = ps.map(function (p) {
          var f = p.follows && planById(p.follows.planId), rule = f ? f.name + ' ' + (num(p.follows.value) < 0 ? '−' : '+') + ' ' + (p.follows.type === 'pct' ? Math.abs(num(p.follows.value)) + '%' : money2(Math.abs(num(p.follows.value) || 0), cur)) : p.primary ? 'Your prices in Pricing' : 'Own rates';
          var today = planRate(p, D.TODAY, map, 0);
          return '<tr' + (can ? ' class="click" data-plan="' + esc(p.id) + '"' : '') + '><td><b>' + esc(p.name) + '</b>' + (p.primary ? ' ' + U.pill('Main', 'accent') : '') + '</td><td>' + esc((MEALS.filter(function (m) { return m[0] === p.meal; })[0] || ['', 'Room only'])[1]) + '</td>' +
            '<td class="num">' + esc(money2(num(p.defaultRate), cur)) + '</td><td class="num">' + esc(money2(today, cur)) + '</td><td>' + esc(rule) + '</td><td class="num">' + (p.minStay || 1) + (p.maxStay ? '–' + p.maxStay : '+') + '</td></tr>';
        }).join('');
        cards.push('<div class="card ch-plan-t" data-type="' + esc(t.id) + '"><div class="card-head"><div><h3>' + esc(t.name) + '</h3><div class="sub">' + esc(b.name + ' · ' + fmt.plural(unitCount(t.id), 'unit')) + '</div></div>' +
          (can ? '<button type="button" class="btn btn-ghost btn-sm" data-new-plan="' + esc(t.id) + '">' + O.icon('plus') + 'Add rate plan</button>' : '') + '</div>' +
          (rows ? '<div class="table-wrap"><table class="table"><thead><tr><th>Rate plan</th><th>Meals</th><th class="num">Default</th><th class="num">Today</th><th>Price</th><th class="num">Nights</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : U.empty('No rate plans yet. Booking sites need at least one to sell ' + t.name + '.', O.icon('pricing'))) + '</div>');
      });
    });
    return cards.length ? cards.join('') + '<div class="small muted">Rates and restrictions for each day are in Calendar → Rates & restrictions.</div>' : '<div class="card">' + U.empty('Rate plans belong to unit types. Add a building with unit types in Properties first.', O.icon('properties'), O.can('properties.edit') ? '<button type="button" class="btn btn-primary" data-go-types="1">Open Buildings & unit types</button>' : '') + '</div>';
  }

  O.page('channels', {
    desc: 'Booking.com, Agoda, Airbnb, Expedia and Trip.com through one channel manager',
    render: function (root, ctx) {
      if (ctx.fresh && ctx.params && ctx.params.tab) st.tab = ctx.params.tab;
      var m = mode();
      if (m === 'live') { startLive(); var poll = setInterval(function () { reload(); }, 20000); ctx.onLeave(function () { clearInterval(poll); }); }
      ctx.on('channel', function () { ctx.rerender(); });
      var bs = buildingsList();
      var nAlerts = conflicts().length;
      var tabs = [['buildings', 'Buildings'], ['plans', 'Rate plans'], ['log', 'Sync log'], ['alerts', 'Alerts']];
      var banner;
      if (m === 'live') banner = CFG.data && CFG.data.env === 'staging' ? '<div class="note ch-mode">' + O.icon('alert') + '<div><b>Test environment.</b> Connected to the channel manager\'s staging system for testing and certification. Booking sites are test accounts.</div></div>' : '';
      else if (m === 'unknown') banner = CFG.state === 'error' ? '<div class="note warn ch-mode">' + O.icon('alert') + '<div><b>The channel manager did not answer.</b> ' + esc(CFG.err || '') + ' <button type="button" class="btn btn-ghost btn-sm" data-act="cfg">Try again</button></div></div>' : '<div class="note ch-mode">' + O.icon('refresh') + '<div>Checking the channel manager…</div></div>';
      else banner = '<div class="note brand ch-mode" data-mode="simulated">' + O.icon('alert') + '<div><b>Practice mode.</b> ' + esc(modeReason()) + ' Connecting, rates and the sync log work the same, but nothing is sent to booking sites.</div></div>';
      if (L.err && m === 'live') banner += '<div class="note warn ch-mode">' + O.icon('alert') + '<div>' + esc(L.err) + '</div></div>';
      var body = '';
      if (st.tab === 'buildings') body = bs.length ? '<div class="ch-grid">' + bs.map(function (b) { return buildingCard(b, m); }).join('') + '</div>' : '<div class="card">' + U.empty('Channels work per building: booking sites sell your unit types and Orbique picks the unit. Add a building with unit types first.', O.icon('properties'), O.can('properties.edit') ? '<button type="button" class="btn btn-primary" data-go-types="1">Open Buildings & unit types</button>' : '') + '</div>';
      else if (st.tab === 'plans') body = plansHTML();
      else if (st.tab === 'log') body = logHTML(m);
      else body = alertsHTML(m);
      root.innerHTML = '<div class="pg-channels">' + banner +
        '<div class="tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (st.tab === t[0]) + '" class="' + (st.tab === t[0] ? 'on' : '') + '">' + esc(t[1]) + (t[0] === 'alerts' && nAlerts ? '<span class="tab-n">' + nAlerts + '</span>' : '') + '</button>'; }).join('') + '</div>' +
        body + '</div>';
      var wrap = O.$('.pg-channels', root);
      wrap.addEventListener('click', function (e) {
        var t = e.target.closest('button, tr[data-plan], tr[data-call], tr[data-sim]'); if (!t || !wrap.contains(t)) return;
        if (t.dataset.tab) { st.tab = t.dataset.tab; ctx.rerender(); return; }
        if (t.dataset.copy) { e.stopPropagation(); U.copy(t.dataset.copy, 'task id'); return; }
        if (t.dataset.copyAll) { var all = []; L.calls.forEach(function (c) { (c.task_ids || []).forEach(function (x) { all.push(x); }); }); U.copy(all.join('\n'), 'task ids'); return; }
        if (t.dataset.goTypes) { O.go('properties', { tab: 'types' }); return; }
        if (t.dataset.newPlan) { planEditor(t.dataset.newPlan, null); return; }
        if (t.dataset.plan) { var p = planById(t.dataset.plan); if (p) planEditor(p.unitTypeId, p); return; }
        if (t.dataset.call) { var c = L.calls.filter(function (x) { return String(x.id) === t.dataset.call; })[0]; if (c) openPayload(c); return; }
        if (t.dataset.sim) { var en = D.channelLog[+t.dataset.sim]; if (en) U.modal({ title: 'POST ' + en.endpoint, sub: when(en.at) + ' · not sent (practice mode)', size: 'wide', cls: 'ch-modal', body: '<div class="stack"><div>' + esc(en.text) + '</div><div><b>First ' + fmt.plural(Math.min(12, en.items), 'item') + ' of ' + en.items + '</b><pre class="mono">' + esc(JSON.stringify({ values: en.sample || [] }, null, 2)) + '</pre></div></div>', actions: [{ label: 'Close', kind: 'primary' }] }); return; }
        if (t.dataset.openB) { var b = D.booking(t.dataset.openB); if (b) { if (O.bookingTools && O.bookingTools.open) O.bookingTools.open(b); else O.booking.open(b); } return; }
        if (t.dataset.cal != null) { O.go('calendar', { from: t.dataset.cal || D.TODAY }); return; }
        if (t.dataset.resolve) {
          var id = t.dataset.resolve; busy(t, true, 'Resolving…');
          O.auth.supabase().from('channex_alerts').update({ resolved_at: new Date().toISOString(), resolved_by: O.auth.user().id }).eq('id', id).then(function (r) {
            if (r && r.error) { busy(t, false); U.toast('Could not resolve: ' + r.error.message, 'bad'); return; }
            L.alerts = L.alerts.filter(function (a) { return String(a.id) !== String(id); }); U.toast('Resolved.'); O.emit('channel');
          }, function (er) { busy(t, false); U.toast(errMsg(er), 'bad'); });
          return;
        }
        var a = t.dataset.act, bid = t.dataset.b;
        if (a === 'cfg') { loadConfig(true); ctx.rerender(); return; }
        if (a === 'connect') connect(bid, t);
        else if (a === 'manage') manage(bid, t);
        else if (a === 'full') fullUpdate(bid, t);
        else if (a === 'plans') { st.tab = 'plans'; ctx.rerender(); }
        else if (a === 'pause' || a === 'resume' || a === 'retry' || a === 'disconnect') setState(bid, a, t);
      });
    }
  });
})();
