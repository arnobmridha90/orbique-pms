/* Orbique PMS v4 — Inventory (page 'inventory', under Manage)

   One central store room. Stock comes IN (purchases, deliveries), goes OUT to a unit (used by a staff member, usually at a
   turnover) and is ADJUSTED by stock counts and write-offs. Stock on hand = the sum of every move:
   in lines add, out lines subtract, adjust lines carry a signed qty. A move (D.invMoves, records 'demo'):
     {id: O.uid('MV'), date, at, dir: 'in'|'out'|'adjust', kind, lines: [{itemId, qty}], propertyId?, usedBy?, bookingId?,
      supplier?, cost? (RM total of a purchase), note, by}
     kind: in -> 'purchase' (or 'count' for the opening count), out -> 'turnover'|'repair'|'other', adjust -> 'count'|'writeoff'.
     Count lines also keep `counted` (what was on the shelf); their qty is the difference from the records.
   Settings (D.inventorySettings, blob 'config'): {basis: 'stay'|'total', threshold: 0.4, minQty: 5}.

   SHARED HELPERS (set at module load; the dashboard and reports use them; keep these names and shapes):
     O.inventory.stock()
        -> [{itemId, name, cat, unit, qty, reorder, low, tracked, perDay, daysLeft}]   one entry per ACTIVE item, list order.
           qty = on hand now (may be negative when use was recorded before the purchase). reorder = the item's reorder level.
           low = tracked && qty <= reorder. tracked = the item appears in at least one move (a new workspace has no moves,
           so nothing is "low" before the first count or purchase). perDay = average used per day over the last 30 days,
           daysLeft = whole days the stock lasts at that rate (null when nothing was used).
     O.inventory.low()
        -> the stock() entries with low === true, emptiest first (qty / reorder ascending).
     O.inventory.overuse(opts)
        -> [{propertyId, itemId, recent, baseline, basis, ratio, change, text, recentQty, baselineQty, recentStays, baselineStays}]
           For each unit and item: use in the last 30 days (recent) vs the average of the previous three 30-day periods
           (baseline). basis 'stay' = per check-out (stays counted from D.bookings check-outs in each window); 'total' = per
           30 days. A pair is flagged when recentQty >= minQty and recent > baseline * (1 + threshold), or when there was no
           use before at all (ratio null). basis is per entry: a 'stay' pair falls back to 'total' when the unit had no
           check-outs in one of the windows. change = ratio - 1. extraQty = how much more than usual was used in the last
           30 days (in the item's units), extraCost = extraQty x item cost (RM). Sorted by extraCost, biggest first.
           text explains itself, no trailing full stop: "Highland Villa 2 used 5.7 rolls of toilet paper per stay in the
           last 30 days vs 3.2 on average over the previous three months".
           opts (all optional): {basis, threshold, minQty, propertyId, itemId, to: 'YYYY-MM-DD' (default D.TODAY)};
           missing values come from D.inventorySettings. Returns [] with less than 30 days of history before the last 30 days.
     O.inventory.usage(from, to, {propertyId, itemId})
        -> [{propertyId, itemId, qty, cost}]   stock OUT between from and to (dates, inclusive), summed per unit and item.
           cost = qty x the item's current unit cost (RM, 2 dp). propertyId may be null (use not tied to a unit) or point to a
           removed unit (D.propById[x] undefined). Sorted by propertyId, then qty descending. from/to may be null (no limit).
     O.inventory.itemName(id) -> 'Toilet paper' ('Removed item' when unknown)
     O.inventory.noun(id, n)  -> 'rolls of toilet paper' / 'roll of toilet paper' (n === 1) for sentences
     O.inventory.settings()   -> validated copy of D.inventorySettings
     O.inventory.onHand()     -> {itemId: qty} for every item that appears in a move (including inactive ones)
     O.inventory.open(kind, preset) opens a stock form: kind 'in'|'out'|'adjust';
           preset {propertyId, bookingId, use, mode: 'count'|'writeoff', lines: [{itemId, qty}], supplier, note}
   Page params (O.go('inventory', {...})): tab 'stock'|'moves'|'overuse'|'items'|'settings', low: true (low stock only),
     propertyId / itemId (movement filters), action 'in'|'out'|'adjust' (open that form).
   Bell (O.notifiers): low stock and overuse, for people who can record purchases or correct counts; one summary per type
   when there are more than two. */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;

  /* ------------------------------------------------------------------ data */
  var DEFAULTS = { basis: 'stay', threshold: 0.4, minQty: 5 };
  O.sync.blob('inventorySettings', 'config');
  D.inventorySettings = D.inventorySettings || { basis: DEFAULTS.basis, threshold: DEFAULTS.threshold, minQty: DEFAULTS.minQty };
  if (!D.invMoves) D.invMoves = [];
  if (!D.invItems) D.invItems = [];
  if (!D.itemById) D.itemById = {};

  function moves() { return Array.isArray(D.invMoves) ? D.invMoves : []; }
  function items() { return Array.isArray(D.invItems) ? D.invItems : []; }
  function item(id) { return (D.itemById && D.itemById[id]) || items().filter(function (x) { return x && x.id === id; })[0] || null; }
  function active(it) { return !!it && it.active !== false; }
  function activeItems() { return items().filter(active); }
  function num(v, dflt) { v = typeof v === 'string' && v.trim() === '' ? NaN : +v; return isFinite(v) ? v : dflt; }
  function prop(id) { return id ? (D.propById || {})[id] || null : null; }
  function propName(id, short) { var p = prop(id); return p ? (short ? p.short || p.name : p.name) : id ? 'Removed unit' : 'No unit'; }
  function person(id) { return id && D.staffById ? D.staffById(id) : null; }
  function personName(id) { var s = person(id); return s ? s.name : id ? 'Former staff' : ''; }
  function firstName(name) { return String(name || '').split(' ')[0]; }
  function signed(m, l) { var q = num(l && l.qty, 0); return m.dir === 'out' ? -q : q; }
  function cats() {
    var out = (D.invCats || []).slice();
    items().forEach(function (it) { if (it && it.cat && out.indexOf(it.cat) < 0) out.push(it.cat); });
    return out;
  }
  function round2(x) { return Math.round(x * 100) / 100; }
  /* search: item names first; the category only when no name matches ("tea" finds Tea bags, "linen" finds the linen) */
  function matchItems(list, q, nameOf, catOf) {
    q = String(q || '').trim().toLowerCase(); if (!q) return list;
    var byName = list.filter(function (x) { return String(nameOf(x)).toLowerCase().indexOf(q) >= 0; });
    return byName.length ? byName : list.filter(function (x) { return String(catOf(x) || '').toLowerCase().indexOf(q) >= 0; });
  }
  function isPhone() { return window.matchMedia ? window.matchMedia('(max-width: 760px)').matches : window.innerWidth <= 760; }
  function settings() {
    var s = D.inventorySettings || {};
    return { basis: s.basis === 'total' ? 'total' : 'stay', threshold: Math.max(0, num(s.threshold, DEFAULTS.threshold)), minQty: Math.max(0, num(s.minQty, DEFAULTS.minQty)) };
  }

  /* ------------------------------------------------------------------ words: "5.7 rolls of toilet paper" */
  function pluralWord(w) { if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + 'ies'; if (/(s|x|z|ch|sh)$/i.test(w)) return w + 'es'; return w + 's'; }
  function singularWord(w) {
    if (/ies$/i.test(w)) return w.slice(0, -3) + 'y';
    if (/ss$/i.test(w)) return w;
    if (/(x|z|ch|sh|ss)es$/i.test(w)) return w.slice(0, -2);
    if (/s$/i.test(w)) return w.slice(0, -1);
    return w;
  }
  function looksPlural(w) { return /ies$/i.test(w) || /[^s]s$/i.test(w); }
  function baseName(it) {
    var full = String(it.name || 'item');
    var n = full.replace(/\s*\([^)]*\)/g, '').replace(/\s+\d[\d.,]*\s*(ml|l|g|kg|cm|m|pcs)?\b.*$/i, '').replace(/\s+[A-Z]\d+$/, '').trim() || full;
    if (/^[A-Z][a-z]/.test(n)) n = n.charAt(0).toLowerCase() + n.slice(1);
    return n;
  }
  var COUNT_UNITS = ['', 'piece', 'pieces', 'pc', 'pcs', 'unit', 'units', 'item', 'items', 'each'];
  function noun(id, n) {
    var it = item(id); var one = n === 1;
    if (!it) return one ? 'item' : 'items';
    var base = baseName(it), words = base.split(' '), last = words[words.length - 1], u = String(it.unit || '').toLowerCase().trim();
    function nameForm() {
      if (looksPlural(last)) return one ? words.slice(0, -1).concat(singularWord(last)).join(' ') : base;
      return one ? base : words.slice(0, -1).concat(pluralWord(last)).join(' ');
    }
    if (COUNT_UNITS.indexOf(u) >= 0) return nameForm();
    var lastL = last.toLowerCase();
    if (lastL === u || singularWord(lastL) === u || lastL === pluralWord(u)) return nameForm();
    return (one ? u : pluralWord(u)) + ' of ' + base;
  }
  function unitWord(it, n) { var u = String((it && it.unit) || '').trim(); if (!u) return ''; return n === 1 ? u : pluralWord(u); }
  function rq(x) { if (x == null || !isFinite(x)) return 0; return Math.abs(x) >= 10 ? Math.round(x) : Math.round(x * 10) / 10; }
  function qd(x) { var v = rq(x); return Math.abs(v) >= 10 ? fmt.num(v) : String(v); }
  function qtyText(q) { q = round2(num(q, 0)); return Math.abs(q - Math.round(q)) > 0.001 ? String(q) : fmt.num(Math.round(q)); }

  /* ------------------------------------------------------------------ stock */
  function onHand() {
    var q = {};
    moves().forEach(function (m) { if (!m) return; (m.lines || []).forEach(function (l) { if (l && l.itemId) q[l.itemId] = round2((q[l.itemId] || 0) + signed(m, l)); }); });
    return q;
  }
  function historyStart() { var h = null; moves().forEach(function (m) { if (m && m.date && (!h || m.date < h)) h = m.date; }); return h; }
  function stock() {
    var h = onHand(), T = D.TODAY, from = d.add(T, -29), start = historyStart(), used = {};
    var days = start ? Math.max(1, Math.min(30, d.diff(start > from ? start : from, T) + 1)) : 30;
    moves().forEach(function (m) {
      if (!m || m.dir !== 'out' || !m.date || m.date < from || m.date > T) return;
      (m.lines || []).forEach(function (l) { used[l.itemId] = (used[l.itemId] || 0) + num(l.qty, 0); });
    });
    return activeItems().map(function (it) {
      var qty = h[it.id] || 0, re = Math.max(0, num(it.reorder, 0)), tracked = it.id in h, perDay = (used[it.id] || 0) / days;
      return { itemId: it.id, name: it.name, cat: it.cat || 'Other', unit: it.unit || '', qty: qty, reorder: re, low: tracked && qty <= re, tracked: tracked, perDay: round2(perDay), daysLeft: perDay > 0 ? Math.max(0, Math.floor(qty / perDay)) : null };
    });
  }
  function low() {
    return stock().filter(function (s) { return s.low; }).sort(function (a, b) { return (a.qty / (a.reorder || 1)) - (b.qty / (b.reorder || 1)); });
  }

  /* ------------------------------------------------------------------ usage */
  function usage(from, to, opts) {
    opts = opts || {}; var acc = {};
    moves().forEach(function (m) {
      if (!m || m.dir !== 'out' || !m.date) return;
      if ((from && m.date < from) || (to && m.date > to)) return;
      var pid = m.propertyId || null;
      if (opts.propertyId && pid !== opts.propertyId) return;
      (m.lines || []).forEach(function (l) {
        if (!l || !l.itemId || (opts.itemId && l.itemId !== opts.itemId)) return;
        var k = (pid || '') + '|' + l.itemId, a = acc[k] || (acc[k] = { propertyId: pid, itemId: l.itemId, qty: 0, cost: 0 });
        a.qty += num(l.qty, 0);
      });
    });
    return Object.keys(acc).map(function (k) { var a = acc[k], it = item(a.itemId); a.qty = round2(a.qty); a.cost = round2(a.qty * num(it && it.cost, 0)); return a; })
      .sort(function (a, b) { var pa = a.propertyId || '', pb = b.propertyId || ''; return pa < pb ? -1 : pa > pb ? 1 : b.qty - a.qty; });
  }

  /* ------------------------------------------------------------------ overuse */
  /* every unit/item pair with use in either window, with the comparison; overuse() keeps the flagged ones */
  function analyze(opts) {
    opts = opts || {}; var s = settings();
    var basis = opts.basis === 'total' || opts.basis === 'stay' ? opts.basis : s.basis;
    var thr = Math.max(0, num(opts.threshold, s.threshold)), minQ = Math.max(0, num(opts.minQty, s.minQty));
    var T = opts.to || D.TODAY, rFrom = d.add(T, -29), bTo = d.add(T, -30), bFrom = d.add(T, -119);
    var res = { basis: basis, threshold: thr, minQty: minQ, recentFrom: rFrom, recentTo: T, baselineFrom: bFrom, baselineTo: bTo, days: 0, ok: false, rows: [], reason: '' };
    var start = historyStart();
    if (!start) { res.reason = 'none'; return res; }
    var cFrom = start > bFrom ? start : bFrom; res.baselineFrom = cFrom;
    res.days = Math.max(0, d.diff(cFrom, bTo) + 1);
    if (res.days < 30) { res.reason = 'history'; return res; }
    res.ok = true;
    var months = res.days / 30, use = {}, stays = {};
    function win(day) { return !day ? '' : day >= rFrom && day <= T ? 'r' : day >= cFrom && day <= bTo ? 'b' : ''; }
    moves().forEach(function (m) {
      if (!m || m.dir !== 'out' || !m.propertyId || (opts.propertyId && m.propertyId !== opts.propertyId)) return;
      var w = win(m.date); if (!w) return;
      (m.lines || []).forEach(function (l) {
        if (!l || !l.itemId || (opts.itemId && l.itemId !== opts.itemId)) return;
        var k = m.propertyId + '|' + l.itemId, u = use[k] || (use[k] = { p: m.propertyId, i: l.itemId, r: 0, b: 0 });
        u[w] += num(l.qty, 0);
      });
    });
    (D.bookings || []).forEach(function (b) {
      if (!b || b.status === 'cancelled' || !b.propertyId) return;
      var w = win(b.checkOut); if (!w) return;
      var x = stays[b.propertyId] || (stays[b.propertyId] = { r: 0, b: 0 }); x[w]++;
    });
    Object.keys(use).forEach(function (k) {
      var u = use[k], it = item(u.i); if (!active(it) || !prop(u.p)) return;
      var sx = stays[u.p] || { r: 0, b: 0 };
      var row = { propertyId: u.p, itemId: u.i, recentQty: round2(u.r), baselineQty: round2(u.b), recentStays: sx.r, baselineStays: sx.b, basis: basis, fallback: '' };
      if (basis === 'stay' && sx.r > 0 && sx.b > 0) { row.recent = u.r / sx.r; row.baseline = u.b / sx.b; }
      else { if (basis === 'stay') row.fallback = sx.r ? 'nobase' : 'norecent'; row.basis = 'total'; row.recent = u.r; row.baseline = u.b / months; }
      row.ratio = row.baseline > 0 ? row.recent / row.baseline : null;
      row.change = row.ratio == null ? null : row.ratio - 1;
      row.flag = u.r > 0 && u.r >= minQ && (row.ratio == null || row.ratio > 1 + thr);
      res.rows.push(row);
    });
    return res;
  }
  function periodText(res) { return res.days >= 89 ? 'the previous three months' : 'the previous ' + res.days + ' days'; }
  function overuseText(r, res) {
    var P = propName(r.propertyId), per = periodText(res), n = noun(r.itemId, rq(r.recent));
    if (r.basis === 'stay') {
      if (r.ratio == null) return P + ' used ' + qd(r.recent) + ' ' + n + ' per stay in the last 30 days and none in ' + per;
      return P + ' used ' + qd(r.recent) + ' ' + n + ' per stay in the last 30 days vs ' + qd(r.baseline) + ' on average over ' + per;
    }
    var extra = r.fallback === 'norecent' ? ' without any check-outs' : '';
    if (r.ratio == null) return P + ' used ' + qd(r.recent) + ' ' + n + ' in the last 30 days' + extra + ' and none in ' + per;
    return P + ' used ' + qd(r.recent) + ' ' + n + ' in the last 30 days' + extra + ' vs ' + qd(r.baseline) + ' a month on average over ' + per;
  }
  function overuse(opts) {
    var res = analyze(opts);
    return res.rows.filter(function (r) { return r.flag; }).map(function (r) {
      var it = item(r.itemId), extra = Math.max(0, r.basis === 'stay' ? (r.recent - r.baseline) * r.recentStays : r.recent - r.baseline);
      return { propertyId: r.propertyId, itemId: r.itemId, recent: round2(r.recent), baseline: round2(r.baseline), basis: r.basis, ratio: r.ratio == null ? null : round2(r.ratio), change: r.change == null ? null : round2(r.change), text: overuseText(r, res), recentQty: r.recentQty, baselineQty: r.baselineQty, recentStays: r.recentStays, baselineStays: r.baselineStays, extraQty: round2(extra), extraCost: round2(extra * num(it && it.cost, 0)) };
    }).sort(function (a, b) { return (b.extraCost - a.extraCost) || (b.extraQty - a.extraQty); });
  }

  O.inventory = {
    stock: stock, low: low, overuse: overuse, usage: usage, onHand: onHand, settings: settings, noun: noun,
    itemName: function (id) { var it = item(id); return it ? it.name : 'Removed item'; },
    open: function (kind, preset) { openForm(kind, preset); }
  };

  /* ------------------------------------------------------------------ permissions */
  function canDo(kind) { return O.can('inventory.' + kind); }
  function isManager() { return O.can('inventory.in') || O.can('inventory.adjust') || O.can('inventory.items'); }
  /* purchase costs and item prices are company spend: shown to people who buy stock or see spending elsewhere */
  function canMoney() { return O.isOwner() || O.can('inventory.in') || O.can('inventory.items') || O.can('expenses.viewAll') || O.can('reports.money'); }
  function noAccess() { return 'Your access does not include this. An account owner can change it in Staff Access.'; }

  /* ------------------------------------------------------------------ bell */
  O.notifiers = O.notifiers || [];
  O.notifiers.push(function () {
    if (!O.can('inventory') || !(O.can('inventory.in') || O.can('inventory.adjust'))) return [];
    var out = [], lows = low();
    if (lows.length === 1 || lows.length === 2) lows.forEach(function (s) { out.push({ icon: '📦', tone: 'warn', t: 'Low stock: ' + s.name, s: qtyText(s.qty) + ' ' + unitWord(item(s.itemId), s.qty) + ' left, reorder level ' + qtyText(s.reorder), go: ['inventory', { tab: 'stock', low: true }] }); });
    else if (lows.length > 2) out.push({ icon: '📦', tone: 'warn', t: lows.length + ' items are low on stock', s: lows.slice(0, 2).map(function (s) { return s.name; }).join(', ') + ' and ' + (lows.length - 2) + ' more are at or below their reorder level', go: ['inventory', { tab: 'stock', low: true }] });
    var ov = overuse();
    if (ov.length && ov.length <= 2) ov.forEach(function (w) { out.push({ icon: '📈', tone: 'warn', t: 'Higher use: ' + O.inventory.itemName(w.itemId) + ' at ' + propName(w.propertyId, true), s: w.text, go: ['inventory', { tab: 'overuse' }] }); });
    else if (ov.length > 2) out.push({ icon: '📈', tone: 'warn', t: ov.length + ' overuse warnings', s: ov.slice(0, 2).map(function (w) { return propName(w.propertyId, true) + ' ' + O.inventory.itemName(w.itemId).toLowerCase(); }).join(', ') + ' and ' + (ov.length - 2) + ' more', go: ['inventory', { tab: 'overuse' }] });
    return out;
  });

  /* ------------------------------------------------------------------ page state */
  var st = {
    tab: 'stock', q: '', cat: '', lowOnly: false,
    mv: { preset: 'last30', from: null, to: null, prop: '', item: '', person: '', dir: '', limit: 60 },
    ov: { open: {} }, it: { q: '', inactive: false }
  };
  var KIND = { purchase: 'Purchase', turnover: 'Turnover', repair: 'Repair', other: 'Other use', count: 'Stock count', writeoff: 'Write-off' };
  var DIR = { 'in': ['Stock in', 'ok'], out: ['Used', 'info'], adjust: ['Adjusted', 'warn'] };
  var USES = [['turnover', 'Turnover'], ['repair', 'Repair'], ['other', 'Other']];
  var MV_PRESETS = ['today', 'yesterday', 'last7', 'last30', 'mtd', 'lastMonth', 'last90', 'qtd', 'ytd', 'since'];

  function kindLabel(m) { return m.dir === 'in' && m.kind === 'count' ? 'Opening count' : KIND[m.kind] || (DIR[m.dir] || ['Move'])[0]; }
  function typePill(m) { var dd = DIR[m.dir] || ['Move', 'neutral']; return '<span class="pill ' + dd[1] + '">' + esc(kindLabel(m)) + '</span>'; }
  function moveValue(m) { return round2((m.lines || []).reduce(function (s, l) { var it = item(l.itemId); return s + Math.abs(num(l.qty, 0)) * num(it && it.cost, 0); }, 0)); }
  function money(n) { return fmt.money(n, { dp: Math.abs(n - Math.round(n)) > 0.004 ? 2 : 0 }); }
  function iconBtn(ic, label, attrs, kind) { return '<button type="button" class="btn ' + (kind || 'btn-ghost') + ' btn-sm" ' + attrs + '>' + O.icon(ic) + esc(label) + '</button>'; }

  function tabs() {
    var t = [['stock', 'Stock'], ['moves', 'Movements'], ['overuse', 'Overuse', overuse().length]];
    if (O.can('inventory.items')) t.push(['items', 'Items']);
    if (O.isOwner()) t.push(['settings', 'Settings']);
    return t;
  }

  /* ------------------------------------------------------------------ STOCK tab */
  function stockTab() {
    if (!moves().length) {
      var n = activeItems().length, act = canDo('adjust') ? '<button type="button" class="btn btn-primary" data-act="count-first">' + O.icon('check') + 'Count your stock</button>'
        : canDo('in') ? '<button type="button" class="btn btn-primary" data-act="in">' + O.icon('download') + 'Record a purchase</button>' : '';
      return '<div class="card"><div class="inv-empty"><div class="ic">' + O.icon('inventory') + '</div><h3>No stock recorded yet</h3>' +
        '<p>Count what is on your shelves to set the starting stock. ' + (n ? fmt.plural(n, 'item is', 'items are') + ' ready to count' + (O.can('inventory.items') ? '; change the list in Items.' : '.') : 'Add the items you keep in Items first.') + '</p>' +
        (act || '<p class="small">Ask an ops manager or the account owner to record the first stock count.</p>') + '</div></div>';
    }
    var all = stock(), lows = all.filter(function (s) { return s.low; }).sort(function (a, b) { return (a.qty / (a.reorder || 1)) - (b.qty / (b.reorder || 1)); });
    var html = '';
    if (lows.length) {
      html += '<div class="card inv-reorder"><div class="card-head"><div><h3>' + O.icon('alert') + 'Reorder ' + (lows.length === 1 ? 'this item' : 'these ' + lows.length + ' items') + '</h3><div class="sub">At or below the reorder level</div></div>' +
        (canDo('in') ? '<button type="button" class="btn btn-primary btn-sm" data-act="buy-low">' + O.icon('download') + 'Record the purchase</button>' : '') + '</div>' +
        '<div class="ro-list">' + lows.map(function (s) { return '<div class="ro-item"><span class="t">' + esc(s.name) + '</span><span class="v"><b>' + qtyText(s.qty) + '</b> left · reorder at ' + qtyText(s.reorder) + '</span></div>'; }).join('') + '</div></div>';
    }
    var catOpts = '<option value="">All categories</option>' + cats().map(function (c) { return '<option' + (c === st.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    html += '<div class="card"><div class="inv-tools"><label class="search">' + O.icon('search') + '<input type="search" data-in="q" placeholder="Search items" value="' + esc(st.q) + '" aria-label="Search items"></label>' +
      '<select class="select" data-in="cat" aria-label="Category">' + catOpts + '</select>' +
      '<button type="button" class="chip' + (st.lowOnly ? ' on' : '') + '" data-act="low-only" aria-pressed="' + st.lowOnly + '">Low stock only</button>' +
      '<span class="spacer"></span>' + iconBtn('download', 'CSV', 'data-act="stock-csv" title="Download the stock list"', 'btn-ghost hide-phone') + '</div>' +
      '<div data-slot-list>' + stockList(all) + '</div></div>';
    if (!lows.length) html = '<div class="inv-ok">' + O.icon('check') + 'Nothing needs reordering. Each item is checked against its reorder level.</div>' + html;
    return html;
  }
  function stockList(all) {
    all = all || stock();
    var q = st.q.trim().toLowerCase();
    var list = matchItems(all.filter(function (s) { return (!st.cat || s.cat === st.cat) && (!st.lowOnly || s.low); }), q, function (s) { return s.name; }, function (s) { return s.cat; });
    if (!list.length) return U.empty(st.lowOnly && !q && !st.cat ? 'Nothing is low on stock right now.' : 'No items match this search.', '🔍');
    var html = '<div class="s-head"><span>Item</span><span class="r">In stock</span><span class="r">Reorder at</span><span class="r">Lasts about</span><span></span></div>';
    cats().concat(['Other']).forEach(function (c) {
      var rows = list.filter(function (s) { return s.cat === c; }); if (!rows.length) return;
      html += '<div class="inv-grp">' + esc(c) + ' <span class="n">' + rows.length + '</span></div>';
      rows.forEach(function (s) {
        var it = item(s.itemId), soon = !s.low && s.daysLeft != null && s.daysLeft <= 7;
        var pill = !s.tracked ? '<span class="pill neutral">Not counted</span>' : s.low ? U.pill('Reorder', 'bad') : soon ? U.pill('Low soon', 'warn') : '';
        var cover = s.daysLeft == null ? '<span class="faint">Not used lately</span>' : s.daysLeft > 90 ? '3+ months' : fmt.plural(s.daysLeft, 'day');
        html += '<div class="s-row' + (s.low ? ' low' : '') + '"><span class="nm" title="' + esc(s.name) + '">' + esc(s.name) + '</span>' +
          '<span class="r qty">' + qtyText(s.qty) + ' <span>' + esc(unitWord(it, s.qty)) + '</span></span>' +
          '<span class="r muted c-re">' + qtyText(s.reorder) + '</span><span class="r muted c-cover">' + cover + '</span><span class="r c-pill">' + pill + '</span>' +
          '<span class="sub">Reorder at ' + qtyText(s.reorder) + (s.daysLeft != null ? ' · lasts about ' + (s.daysLeft > 90 ? '3+ months' : fmt.plural(s.daysLeft, 'day')) : '') + '</span></div>';
      });
    });
    return html;
  }
  function stockCSV() {
    var rows = [['Item', 'Category', 'In stock', 'Unit', 'Reorder level', 'Status', 'Used per day (last 30 days)', 'Lasts about (days)']];
    stock().forEach(function (s) { rows.push([s.name, s.cat, s.qty, s.unit, s.reorder, !s.tracked ? 'Not counted' : s.low ? 'Reorder' : 'OK', s.perDay, s.daysLeft == null ? '' : s.daysLeft]); });
    O.downloadCSV('stock-' + D.TODAY + '.csv', rows);
    U.toast('Stock list downloaded');
  }
  function buyLow() {
    var lines = low().map(function (s) { return { itemId: s.itemId, qty: Math.max(1, Math.round(s.reorder * 3 - Math.max(0, s.qty))) }; });
    openForm('in', { lines: lines });
  }

  /* ------------------------------------------------------------------ MOVEMENTS tab */
  function mvRange() { if (st.mv.preset) { var p = U.preset(st.mv.preset); return { from: p.from, to: p.to }; } return { from: st.mv.from, to: st.mv.to }; }
  function mvFiltered() {
    var r = mvRange(), f = st.mv;
    return moves().filter(function (m) {
      if (!m || !m.date || m.date < r.from || m.date > r.to) return false;
      if (f.dir && m.dir !== f.dir) return false;
      if (f.prop && m.propertyId !== f.prop) return false;
      if (f.person && m.usedBy !== f.person && m.by !== f.person) return false;
      if (f.item && !(m.lines || []).some(function (l) { return l.itemId === f.item; })) return false;
      return true;
    }).sort(function (a, b) { var x = a.at || a.date, y = b.at || b.date; return x < y ? 1 : x > y ? -1 : 0; });
  }
  function itemOptions(sel, withInactive) {
    var used = {}; if (withInactive) moves().forEach(function (m) { (m.lines || []).forEach(function (l) { used[l.itemId] = 1; }); });
    var list = items().filter(function (it) { return active(it) || used[it.id] || it.id === sel; });
    return cats().map(function (c) {
      var rows = list.filter(function (it) { return it.cat === c; }); if (!rows.length) return '';
      return '<optgroup label="' + esc(c) + '">' + rows.map(function (it) { return '<option value="' + esc(it.id) + '"' + (it.id === sel ? ' selected' : '') + '>' + esc(it.name) + (active(it) ? '' : ' (not tracked)') + '</option>'; }).join('') + '</optgroup>';
    }).join('');
  }
  function peopleOptions(sel) {
    var ids = {}; (D.staff || []).forEach(function (s) { ids[s.id] = 1; });
    moves().forEach(function (m) { if (m.usedBy) ids[m.usedBy] = 1; if (m.by) ids[m.by] = 1; });
    return Object.keys(ids).map(function (id) { return [id, personName(id)]; }).sort(function (a, b) { return a[1] < b[1] ? -1 : 1; })
      .map(function (x) { return '<option value="' + esc(x[0]) + '"' + (x[0] === sel ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('');
  }
  function linesSummary(m) {
    var ls = (m.lines || []).filter(function (l) { return num(l.qty, 0) !== 0; });
    if (st.mv.item) { var l = ls.filter(function (x) { return x.itemId === st.mv.item; })[0]; return l ? '<b>' + esc(O.inventory.itemName(l.itemId)) + '</b> ' + qtySigned(m, l) : ''; }
    if (!ls.length) return '<span class="faint">No change</span>';
    var first = ls.slice(0, 2).map(function (l) { return esc(O.inventory.itemName(l.itemId)) + ' ' + qtySigned(m, l); }).join(', ');
    return first + (ls.length > 2 ? ' <span class="more">+' + (ls.length - 2) + ' more</span>' : '');
  }
  function qtySigned(m, l) {
    var q = num(l.qty, 0);
    if (m.dir === 'adjust') return '<span class="' + (q > 0 ? 'q-plus' : 'q-minus') + '">' + (q > 0 ? '+' : '−') + qtyText(Math.abs(q)) + '</span>';
    return '<span class="' + (m.dir === 'in' ? 'q-plus' : 'q-minus') + '">' + (m.dir === 'in' ? '+' : '') + qtyText(q) + '</span>';
  }
  function movesTab() {
    var f = st.mv, list = mvFiltered(), mon = canMoney();
    var html = '<div class="card"><div class="inv-tools"><span data-slot="mv-range"></span>' +
      '<select class="select" data-mv="prop" aria-label="Unit"><option value="">All units</option>' + U.propOptions(f.prop) + (f.prop && !prop(f.prop) ? '<option value="' + esc(f.prop) + '" selected>Removed unit</option>' : '') + '</select>' +
      '<select class="select" data-mv="item" aria-label="Item"><option value="">All items</option>' + itemOptions(f.item, true) + '</select>' +
      '<select class="select" data-mv="person" aria-label="Person"><option value="">Everyone</option>' + peopleOptions(f.person) + '</select>' +
      '<div class="chips dirs">' + [['', 'All'], ['in', 'In'], ['out', 'Used'], ['adjust', 'Adjusted']].map(function (x) { return '<button type="button" class="chip' + (f.dir === x[0] ? ' on' : '') + '" data-dir="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<span class="spacer"></span>' + iconBtn('download', 'CSV', 'data-act="mv-csv" title="Download these movements"') + '</div>';
    if (!moves().length) {
      return html + '<div class="inv-empty"><div class="ic">' + O.icon('inventory') + '</div><h3>No stock movements yet</h3><p>Purchases, stock used at each unit and stock counts appear here.</p>' + mainActionBtn() + '</div></div>';
    }
    var filtersOn = f.prop || f.item || f.person || f.dir;
    var tot = { 'in': 0, out: 0, adjust: 0 }; list.forEach(function (m) { tot[m.dir] = (tot[m.dir] || 0) + 1; });
    html += '<div class="inv-sum"><span><b>' + fmt.plural(list.length, 'movement') + '</b>' + (list.length ? ' · ' + [tot['in'] ? tot['in'] + ' in' : '', tot.out ? tot.out + ' used' : '', tot.adjust ? tot.adjust + ' adjusted' : ''].filter(Boolean).join(' · ') : '') + '</span>' +
      (filtersOn ? '<button type="button" class="btn btn-quiet btn-xs" data-act="mv-clear">Clear filters</button>' : '') + '</div>';
    if (!list.length) return html + U.empty('No movements match these filters in this period.', '🔍') + '</div>';
    html += '<div class="m-head' + (mon ? ' money' : '') + '"><span>When</span><span>Type</span><span>Items</span><span>Unit or supplier</span><span>Used or recorded by</span>' + (mon ? '<span class="r">Cost</span>' : '') + '</div>';
    list.slice(0, f.limit).forEach(function (m) {
      var who = m.dir === 'out' ? m.usedBy || m.by : m.by, nm = personName(who);
      var where = m.dir === 'out' ? esc(propName(m.propertyId, true)) : m.dir === 'in' ? esc(m.supplier || (m.kind === 'count' ? 'Store room' : 'Supplier not noted')) : 'Store room';
      var fl = f.item ? (m.lines || []).filter(function (l) { return l.itemId === f.item; })[0] : null, fit = fl ? item(fl.itemId) : null;
      var cost = !mon ? '' : fl && m.dir !== 'adjust' ? '<span title="This item at its current cost">' + money(round2(Math.abs(num(fl.qty, 0)) * num(fit && fit.cost, 0))) + '</span>'
        : m.dir === 'in' && m.kind === 'purchase' ? (m.cost != null && m.cost !== '' ? money(num(m.cost, 0)) : '<span class="faint">–</span>') : m.dir === 'out' ? '<span title="At current item cost">' + money(moveValue(m)) + '</span>' : '';
      html += '<button type="button" class="m-row' + (mon ? ' money' : '') + '" data-mv-open="' + esc(m.id) + '">' +
        '<span class="when">' + d.fmt(m.date) + '<span>' + (m.at && m.at.length > 10 ? fmt.time(m.at) : '') + '</span></span>' +
        '<span class="typ">' + typePill(m) + '</span><span class="what">' + linesSummary(m) + '</span><span class="unit">' + where + '</span>' +
        '<span class="who">' + (nm ? U.avatar(nm, 'sm') + esc(nm) : '<span class="faint">–</span>') + '</span>' + (mon ? '<span class="cost' + (m.dir === 'out' || fl ? ' est' : '') + '">' + cost + '</span>' : '') + '</button>';
    });
    if (list.length > f.limit) html += '<div class="inv-more-row"><button type="button" class="btn btn-ghost btn-sm" data-act="mv-more">Show ' + Math.min(60, list.length - f.limit) + ' more of ' + (list.length - f.limit) + '</button></div>';
    return html + '</div>';
  }
  function movesCSV() {
    var list = mvFiltered(), mon = canMoney(), r = mvRange();
    var head = ['Date', 'Time', 'Direction', 'Type', 'Item', 'Category', 'Quantity (+ in, − out)', 'Unit of measure', 'Property', 'Used by', 'Booking', 'Supplier'];
    if (mon) head.push('Purchase total (RM)', 'Line value at item cost (RM)');
    head.push('Note', 'Recorded by', 'Move ID');
    var rows = [head];
    list.forEach(function (m) {
      (m.lines || []).forEach(function (l) {
        if (st.mv.item && l.itemId !== st.mv.item) return;
        var it = item(l.itemId), q = signed(m, l);
        var row = [m.date, m.at && m.at.length > 10 ? m.at.slice(11, 16) : '', { 'in': 'In', out: 'Out', adjust: 'Adjust' }[m.dir] || m.dir, kindLabel(m), it ? it.name : 'Removed item', it ? it.cat : '', q, it ? it.unit : '',
          m.propertyId ? propName(m.propertyId) : '', personName(m.usedBy), m.bookingId || '', m.supplier || ''];
        if (mon) row.push(m.dir === 'in' && m.cost != null ? m.cost : '', round2(Math.abs(q) * num(it && it.cost, 0)));
        row.push(m.note || '', personName(m.by), m.id);
        rows.push(row);
      });
    });
    O.downloadCSV('inventory-movements-' + r.from + '-to-' + r.to + '.csv', rows);
    U.toast(fmt.plural(rows.length - 1, 'line') + ' downloaded');
  }
  function canDelete(m) { return O.isOwner() || O.can('inventory.adjust') || (m.by === O.state.viewer && m.date === D.TODAY && canDo(m.dir === 'adjust' ? 'adjust' : m.dir)); }
  function openMove(id) {
    var m = moves().filter(function (x) { return x.id === id; })[0]; if (!m) return;
    var mon = canMoney(), b = m.bookingId && D.booking ? D.booking(m.bookingId) : null;
    var kv = [['Type', typePill(m)], ['When', esc(d.fmtY(m.date)) + (m.at && m.at.length > 10 ? ', ' + fmt.time(m.at) : '')]];
    if (m.dir === 'out') kv.push(['Unit', esc(propName(m.propertyId))], ['Used by', esc(personName(m.usedBy) || '–')]);
    if (b) kv.push(['Booking', (O.can('bookings') ? '<button type="button" class="btn btn-quiet btn-xs" data-open-bk="' + esc(b.id) + '">' + esc(b.guest && b.guest.name || b.id) + ' · ' + esc(d.fmtRange(b.checkIn, b.checkOut)) + '</button>' : esc(b.id))]);
    if (m.supplier) kv.push(['Supplier', esc(m.supplier)]);
    if (mon && m.dir === 'in' && m.kind === 'purchase') kv.push(['Total cost', m.cost != null && m.cost !== '' ? money(num(m.cost, 0)) : '<span class="faint">Not noted</span>']);
    if (mon && m.dir === 'out') kv.push(['Value', money(moveValue(m)) + ' <span class="faint small">at current item costs</span>']);
    if (m.note) kv.push(['Note', esc(m.note)]);
    kv.push(['Recorded by', esc(personName(m.by) || '–')]);
    var body = '<div class="inv-detail"><dl class="kv">' + kv.map(function (x) { return '<dt>' + x[0] + '</dt><dd>' + x[1] + '</dd>'; }).join('') + '</dl>' +
      '<div class="lines">' + (m.lines || []).map(function (l) {
        var it = item(l.itemId), extra = l.counted != null ? ' <span class="faint small">counted ' + qtyText(l.counted) + '</span>' : '';
        return '<div class="ln"><span>' + esc(it ? it.name : 'Removed item') + extra + '</span><b>' + qtySigned(m, l) + ' ' + esc(unitWord(it, Math.abs(num(l.qty, 0)))) + '</b></div>';
      }).join('') + '</div></div>';
    var acts = [{ label: 'Close' }];
    if (canDelete(m)) acts.unshift({ label: 'Delete this record', kind: 'ghost', onClick: function (close) {
      U.confirm('Delete this record? Stock levels are recalculated without it.', 'Delete record', 'danger').then(function (ok) {
        if (!ok) return; var i = D.invMoves.indexOf(m); if (i >= 0) D.invMoves.splice(i, 1); close(); O.emit('data'); U.toast('Record deleted');
      });
      return false;
    } });
    var md = U.modal({ title: kindLabel(m) + (m.dir === 'out' ? ' · ' + propName(m.propertyId, true) : ''), sub: fmt.plural((m.lines || []).length, 'item'), body: body, size: 'inv-modal', actions: acts, autofocus: false });
    var bk = O.$('[data-open-bk]', md.el); if (bk) bk.onclick = function () { md.close(); O.booking.open(bk.dataset.openBk); };
  }

  /* ------------------------------------------------------------------ OVERUSE tab */
  function ruleText(s) {
    var thr = Math.round(s.threshold * 100);
    var what = s.basis === 'stay' ? 'its use of an item per stay in the last 30 days' : 'its total use of an item in the last 30 days';
    var cmp = thr ? 'is more than ' + thr + '% above' : 'is more than';
    return 'A unit is flagged when ' + what + ' ' + cmp + ' its average over the previous three months' + (s.minQty ? ', counting only items it used at least ' + qtyText(s.minQty) + ' of' : '') + '.';
  }
  function overuseTab() {
    var s = settings(), res = analyze(), list = overuse();
    var rule = '<div class="note ov-rule"><span class="txt">' + esc(ruleText(s)) + (s.basis === 'stay' ? ' Per stay keeps a busy month from looking like waste.' : '') + '</span>' +
      (O.isOwner() ? '<button type="button" class="btn btn-ghost btn-sm" data-tab="settings">' + O.icon('edit') + 'Change the rule</button>' : '') + '</div>';
    if (!res.ok) {
      var why = res.reason === 'none' ? 'Overuse warnings start once stock used at each unit has been recorded for about two months.' : 'Warnings start once there is at least a month of records before the last 30 days. Keep recording stock used and they appear on their own.';
      return rule + '<div class="card"><div class="inv-empty"><div class="ic">' + O.icon('statistics') + '</div><h3>Not enough history yet</h3><p>' + esc(why) + '</p>' + (res.reason === 'none' ? mainActionBtn() : '') + '</div></div>';
    }
    if (!list.length) return rule + '<div class="card"><div class="inv-empty"><div class="ic">' + O.icon('check') + '</div><h3>No unusual use</h3><p>Every unit used about what it usually does in the last 30 days.</p></div></div>';
    var cards = list.map(function (w) {
      var k = w.propertyId + '|' + w.itemId, it = item(w.itemId), rows = res.rows.filter(function (r) { return r.itemId === w.itemId; });
      var others = rows.filter(function (r) { return r.propertyId !== w.propertyId; }), oth = null;
      if (w.basis === 'stay') { var oq = 0, os = 0; others.forEach(function (r) { if (r.recentStays) { oq += r.recentQty; os += r.recentStays; } }); oth = os ? oq / os : null; }
      else if (others.length) oth = others.reduce(function (sum, r) { return sum + r.recentQty; }, 0) / others.length;
      var per = w.basis === 'stay' ? ' per stay' : '', max = Math.max(w.recent, w.baseline || 0, oth || 0) || 1;
      function bar(label, v, cls, extra) { return '<div class="ovb' + (extra || '') + '"><span class="l">' + esc(label) + '</span><span class="tr"><span class="f ' + cls + '" style="width:' + Math.min(100, v / max * 100).toFixed(1) + '%"></span></span><span class="v">' + (v == null ? '–' : qd(v)) + '</span></div>'; }
      var pct = w.ratio == null ? 'New' : '+' + Math.round(w.change * 100) + '%';
      var html = '<div class="card ov-card"><div class="ov-top"><div><div class="ov-t">' + esc(propName(w.propertyId)) + '</div><div class="ov-s">' + esc(it ? it.name : 'Removed item') + (w.basis === 'stay' ? ' · per stay' : ' · total use') + '</div></div>' + U.pill(pct, w.ratio == null || w.change >= 0.75 ? 'bad' : 'warn') + '</div>' +
        '<div class="ov-text">' + esc(w.text) + '.</div>' +
        '<div class="ov-bars">' + bar('Last 30 days', w.recent, 'cur', ' me') + bar('3 months before', w.baseline, 'prev') + (oth != null ? bar('Other units', oth, 'oth') : '') + '</div>';
      if (st.ov.open[k]) {
        var all = rows.slice().sort(function (a, b) { return b.recent - a.recent; }), mx = Math.max.apply(null, all.map(function (r) { return Math.max(r.recent, r.baseline || 0); }).concat([1]));
        html += '<div class="ov-units"><div class="cap">Last 30 days' + per + ' at each unit · the line marks its own average before</div>' + all.map(function (r) {
          var isMe = r.propertyId === w.propertyId;
          return '<div class="ovb' + (isMe ? ' me' : '') + '"><span class="l">' + esc(propName(r.propertyId, true)) + '</span><span class="tr"><span class="f ' + (isMe ? 'cur' : 'oth') + '" style="width:' + Math.min(100, r.recent / mx * 100).toFixed(1) + '%"></span>' +
            (r.baseline > 0 ? '<span class="mk" style="left:' + Math.min(100, r.baseline / mx * 100).toFixed(1) + '%" title="Average before: ' + qd(r.baseline) + '"></span>' : '') + '</span><span class="v">' + qd(r.recent) + (r.basis !== w.basis ? '*' : '') + '</span></div>';
        }).join('') + (all.some(function (r) { return r.basis !== w.basis; }) ? '<div class="cap">* total use: no check-outs to compare per stay</div>' : '') + '</div>';
      }
      html += '<div class="ov-foot"><button type="button" class="btn btn-ghost btn-sm" data-ov-units="' + esc(k) + '">' + (st.ov.open[k] ? 'Hide other units' : 'Compare all units') + '</button>' +
        '<button type="button" class="btn btn-quiet btn-sm" data-ov-moves="' + esc(k) + '">See the records</button></div></div>';
      return html;
    }).join('');
    return rule + '<div class="ov-grid">' + cards + '</div>';
  }

  /* ------------------------------------------------------------------ ITEMS tab */
  function itemsTab() {
    if (!O.can('inventory.items')) return U.locked('item management', { reason: 'permission' });
    var mon = canMoney(), q = st.it.q.trim().toLowerCase(), h = onHand();
    var list = matchItems(items().filter(function (it) { return st.it.inactive || active(it); }), q, function (it) { return it.name; }, function (it) { return it.cat; });
    var off = items().filter(function (it) { return !active(it); }).length;
    var html = '<div class="card"><div class="inv-tools"><label class="search">' + O.icon('search') + '<input type="search" data-it="q" placeholder="Search items" value="' + esc(st.it.q) + '" aria-label="Search items"></label>' +
      (off ? '<button type="button" class="chip' + (st.it.inactive ? ' on' : '') + '" data-act="it-inactive">Show items no longer tracked (' + off + ')</button>' : '') +
      '<span class="spacer"></span><button type="button" class="btn btn-primary btn-sm" data-act="it-add">' + O.icon('plus') + 'Add item</button></div><div data-slot-items>';
    if (!items().length) return html + '<div class="inv-empty"><div class="ic">' + O.icon('inventory') + '</div><h3>No items yet</h3><p>Add the supplies you keep in the store room: toiletries, coffee, cleaning products, linen and spare parts.</p></div></div></div>';
    if (!list.length) return html + U.empty('No items match this search.', '🔍') + '</div></div>';
    var cls = mon ? '' : ' nomoney';
    html += '<div class="i-head' + cls + '"><span>Item</span><span>Counted in</span>' + (mon ? '<span class="r">Cost each</span>' : '') + '<span class="r">Reorder at</span><span class="r">In stock</span><span></span></div>';
    cats().concat(['Other']).forEach(function (c) {
      var rows = list.filter(function (it) { return (it.cat || 'Other') === c; }); if (!rows.length) return;
      html += '<div class="inv-grp">' + esc(c) + ' <span class="n">' + rows.length + '</span></div>';
      rows.forEach(function (it) {
        var on = active(it);
        html += '<div class="i-row' + cls + (on ? '' : ' off') + '"><span class="nm" title="' + esc(it.name) + '">' + esc(it.name) + '</span><span class="c-unit">' + esc(it.unit || '') + '</span>' +
          (mon ? '<span class="r c-cost">' + money(num(it.cost, 0)) + '</span>' : '') + '<span class="r c-re">' + qtyText(it.reorder) + '</span><span class="r c-stock">' + (it.id in h ? qtyText(h[it.id]) : '<span class="faint">–</span>') + '</span>' +
          '<span class="acts"><button type="button" class="btn btn-ghost btn-xs" data-it-edit="' + esc(it.id) + '">' + O.icon('edit') + 'Edit</button>' +
          '<button type="button" class="btn btn-quiet btn-xs" data-it-toggle="' + esc(it.id) + '">' + (on ? 'Stop tracking' : 'Track again') + '</button></span>' +
          '<span class="sub">' + esc(it.unit || '') + (mon ? ' · ' + money(num(it.cost, 0)) + ' each' : '') + ' · reorder at ' + qtyText(it.reorder) + (it.id in h ? ' · ' + qtyText(h[it.id]) + ' in stock' : '') + '</span></div>';
      });
    });
    return html + '</div></div>';
  }
  function editItem(id) {
    if (!O.can('inventory.items')) { U.toast(noAccess(), 'bad'); return; }
    var it = id ? item(id) : null, isNew = !it, cs = cats();
    var v = it ? { name: it.name, cat: it.cat, unit: it.unit, cost: it.cost, reorder: it.reorder, use: (it.use || [0, 0, 0]).slice() } : { name: '', cat: st.cat || cs[0] || '', unit: '', cost: '', reorder: '', use: [0, 0, 0] };
    var body = O.html('<div class="inv-form"><div class="form-grid">' +
      '<div class="field full"><label>Name <span class="req">*</span></label><input class="input" data-f="name" maxlength="60" value="' + esc(v.name) + '" placeholder="For example: Shampoo 30 ml"></div>' +
      '<div class="field"><label>Category</label><select class="select" data-f="cat">' + cs.map(function (c) { return '<option' + (c === v.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '<option value="__new">New category…</option></select></div>' +
      '<div class="field" data-newcat hidden><label>New category name</label><input class="input" data-f="newcat" maxlength="40"></div>' +
      '<div class="field"><label>Counted in <span class="req">*</span></label><input class="input" data-f="unit" maxlength="20" value="' + esc(v.unit || '') + '" placeholder="roll, bottle, piece"><div class="hint">One of what you count, in the singular.</div></div>' +
      '<div class="field"><label>Cost each</label><div class="money-in"><span>RM</span><input class="input" type="number" inputmode="decimal" min="0" step="0.01" data-f="cost" value="' + esc(v.cost) + '"></div></div>' +
      '<div class="field"><label>Reorder level <span class="req">*</span></label><input class="input" type="number" inputmode="numeric" min="0" step="1" data-f="reorder" value="' + esc(v.reorder) + '"><div class="hint">Show a reorder alert at or below this.</div></div>' +
      '<div class="field full"><label>Usual use (optional)</label><div class="row-flex wrap">' +
      ['per stay', 'per night', 'per guest'].map(function (l, i) { return '<label class="row-flex small" style="gap:6px"><input class="input" style="width:84px" type="number" inputmode="decimal" min="0" step="0.05" data-use="' + i + '" value="' + esc(v.use[i] || 0) + '">' + l + '</label>'; }).join('') +
      '</div><div class="hint">Suggests a restock for units without history, for example 1 per stay plus 0.5 per night.</div></div>' +
      '</div><div class="inv-err" data-err></div></div>');
    var catSel = O.$('[data-f="cat"]', body);
    catSel.onchange = function () { O.$('[data-newcat]', body).hidden = catSel.value !== '__new'; if (catSel.value === '__new') O.$('[data-f="newcat"]', body).focus(); };
    U.modal({ title: isNew ? 'Add an item' : 'Edit ' + it.name, sub: isNew ? 'It appears in every stock form and the stock list' : 'Changes apply to new records; past records keep their quantities', body: body, size: 'inv-modal', actions: [{ label: 'Cancel' }, { label: isNew ? 'Add item' : 'Save changes', kind: 'primary', onClick: function () {
      function val(k) { return (O.$('[data-f="' + k + '"]', body) || {}).value; }
      var name = String(val('name') || '').trim(), unit = String(val('unit') || '').trim(), cat = catSel.value === '__new' ? String(val('newcat') || '').trim() : catSel.value;
      var cost = num(val('cost'), 0), reorder = num(val('reorder'), NaN), use = [0, 1, 2].map(function (i) { return Math.max(0, num(O.$('[data-use="' + i + '"]', body).value, 0)); });
      var err = !name ? 'Give the item a name.' : !unit ? 'Say what you count it in, for example roll or bottle.' : !cat ? 'Name the new category.' : !isFinite(reorder) || reorder < 0 ? 'Set a reorder level (0 or more).' : cost < 0 ? 'The cost cannot be negative.' :
        items().some(function (x) { return x !== it && active(x) && x.name.toLowerCase() === name.toLowerCase(); }) ? 'An item with this name is already in the list.' : '';
      if (err) { O.$('[data-err]', body).textContent = err; return false; }
      if (isNew) { D.invItems.push({ id: O.uid('IT'), name: name, cat: cat, unit: unit, cost: round2(cost), reorder: Math.round(reorder), use: use, active: true }); }
      else { it.name = name; it.cat = cat; it.unit = unit; it.cost = round2(cost); it.reorder = Math.round(reorder); it.use = use; }
      O.reindex(); O.emit('data'); U.toast(isNew ? name + ' added' : 'Changes saved');
    } }] });
  }
  function toggleItem(id) {
    var it = item(id); if (!it) return;
    if (!O.can('inventory.items')) { U.toast(noAccess(), 'bad'); return; }
    if (active(it)) {
      U.confirm('Stop tracking ' + it.name + '? It leaves the stock list and the forms. Past records stay, and you can track it again later.', 'Stop tracking', 'primary').then(function (ok) {
        if (!ok) return; it.active = false; O.emit('data'); U.toast(it.name + ' is no longer tracked');
      });
    } else { it.active = true; O.emit('data'); U.toast(it.name + ' is tracked again'); }
  }

  /* ------------------------------------------------------------------ SETTINGS tab (owner) */
  function settingsTab() {
    if (!O.isOwner()) return U.locked('the inventory settings');
    var s = settings();
    return '<div class="card set-card"><div class="card-head"><div><h3>Overuse warnings</h3><div class="sub">How a unit\'s use is compared with its own past</div></div></div><div class="card-body">' +
      '<div class="field"><label>Compare</label>' + U.seg([['stay', 'Use per stay'], ['total', 'Total use']], s.basis, 'data-set-basis') +
      '<div class="hint">Per stay divides what a unit used by its check-outs, so a busy month does not look like waste. Total use compares the plain amounts per 30 days.</div></div>' +
      '<div class="field"><label for="inv-thr">Warn when use is above the 3-month average by more than</label><div class="set-row"><input id="inv-thr" class="input" type="number" min="0" max="500" step="5" data-set="threshold" value="' + Math.round(s.threshold * 100) + '"><span>%</span></div></div>' +
      '<div class="field"><label for="inv-min">Ignore items a unit used fewer than</label><div class="set-row"><input id="inv-min" class="input" type="number" min="0" step="1" data-set="minQty" value="' + qtyText(s.minQty) + '"><span>in the last 30 days</span></div><div class="hint">Keeps one extra light bulb from raising a warning.</div></div>' +
      '<div class="note">For the strict rule "more than the average of the last three months", choose <b>Total use</b> and <b>0%</b>. It flags far more units, because the number of stays changes from month to month and a busy month always looks like overuse. The recommended setting is use per stay with a 40% margin.</div>' +
      '<div class="set-prev" data-set-prev></div>' +
      '<div class="row-flex wrap"><button type="button" class="btn btn-primary" data-act="set-save">Save settings</button><button type="button" class="btn btn-ghost" data-act="set-reset">Back to recommended</button></div>' +
      '</div></div>' +
      '<div class="small muted">Reorder levels are set for each item in Items.</div>';
  }
  function draftSettings(root) {
    var seg = O.$('[data-set-basis].on', root), t = O.$('[data-set="threshold"]', root), m = O.$('[data-set="minQty"]', root);
    return { basis: seg ? seg.dataset.setBasis : settings().basis, threshold: Math.max(0, num(t && t.value, 40)) / 100, minQty: Math.max(0, num(m && m.value, 0)) };
  }
  function paintSettingsPreview(root) {
    var el = O.$('[data-set-prev]', root); if (!el) return;
    var dr = draftSettings(root), res = analyze(dr), n = res.rows.filter(function (r) { return r.flag; }).length, cur = overuse().length;
    var strict = analyze({ basis: 'total', threshold: 0, minQty: dr.minQty }).rows.filter(function (r) { return r.flag; }).length;
    el.innerHTML = !res.ok ? 'Not enough history yet to preview warnings.' : 'With these settings: <b>' + fmt.plural(n, 'warning') + '</b> right now, out of ' + res.rows.length + ' unit and item pairs' + (n !== cur ? ' (now ' + cur + ')' : '') + '. The strict rule would give <b>' + strict + '</b>.';
  }

  /* ------------------------------------------------------------------ forms: stock in, stock used, count / adjust */
  function mainActionBtn() {
    if (canDo('out') && moves().length) return '<button type="button" class="btn btn-primary" data-act="out">' + O.icon('upload') + 'Record stock used</button>';
    if (canDo('adjust')) return '<button type="button" class="btn btn-primary" data-act="count-first">' + O.icon('check') + 'Count your stock</button>';
    if (canDo('in')) return '<button type="button" class="btn btn-primary" data-act="in">' + O.icon('download') + 'Record a purchase</button>';
    return '';
  }
  function myTask() {
    var meId = O.state.viewer, T = D.TODAY;
    var ts = (D.tasks || []).filter(function (t) { return t && t.assigneeId === meId && t.propertyId && prop(t.propertyId) && t.status !== 'done' && t.due && (t.due.slice(0, 10) === T || t.status === 'in_progress'); });
    ts.sort(function (a, b) { return ((a.status === 'in_progress' ? 0 : 1) - (b.status === 'in_progress' ? 0 : 1)) || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0); });
    return ts[0] || null;
  }
  function unitOptions(sel) {
    var meId = O.state.viewer, T = D.TODAY, mine = {};
    (D.tasks || []).forEach(function (t) { if (t && t.assigneeId === meId && t.propertyId && t.due && t.due.slice(0, 10) === T && t.status !== 'done') mine[t.propertyId] = 1; });
    (D.properties || []).forEach(function (p) { if (p.housekeeper === meId) mine[p.id] = 1; });
    var opt = function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === sel ? ' selected' : '') + '>' + esc(p.name) + '</option>'; };
    var a = (D.properties || []).filter(function (p) { return mine[p.id]; }), b = (D.properties || []).filter(function (p) { return !mine[p.id]; });
    var html = '<option value="">Choose a unit</option>';
    if (a.length && b.length) html += '<optgroup label="Your units">' + a.map(opt).join('') + '</optgroup><optgroup label="Other units">' + b.map(opt).join('') + '</optgroup>';
    else html += (D.properties || []).map(opt).join('');
    return html;
  }
  function bookingChoices(pid) {
    if (!pid) return [];
    var T = D.TODAY, from = d.add(T, -10), to = d.add(T, 1);
    return (D.bookings || []).filter(function (b) { return b && b.propertyId === pid && b.status !== 'cancelled' && ((b.checkOut >= from && b.checkOut <= to) || (b.checkIn <= T && b.checkOut > T)); })
      .sort(function (a, b) {
        var ga = a.checkOut <= T ? 0 : 1, gb = b.checkOut <= T ? 0 : 1; if (ga !== gb) return ga - gb;
        return ga === 0 ? (a.checkOut < b.checkOut ? 1 : a.checkOut > b.checkOut ? -1 : 0) : (a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0);
      });
  }
  function restocksFor(bookingId) { return bookingId ? moves().filter(function (m) { return m && m.dir === 'out' && m.bookingId === bookingId && m.kind === 'turnover'; }) : []; }
  /* the guest who just left (today or yesterday) and whose turnover restock is not recorded yet */
  function defaultBooking(pid) {
    var T = D.TODAY, y = d.add(T, -1);
    var b = bookingChoices(pid).filter(function (x) { return x.checkOut <= T && x.checkOut >= y && !restocksFor(x.id).length; })[0];
    return b ? b.id : '';
  }
  function bookingLabel(b) {
    var T = D.TODAY, who = O.can('bookings') && b.guest ? b.guest.name : 'Booking ' + b.id;
    var when = b.checkOut === T ? 'checks out today' : b.checkOut < T ? 'checked out ' + d.fmt(b.checkOut) : b.checkIn <= T ? 'staying now' : 'arrives ' + d.fmt(b.checkIn);
    return who + ' · ' + d.fmtRange(b.checkIn, b.checkOut) + ' · ' + when;
  }
  function bookingOptions(pid, sel) {
    var list = bookingChoices(pid);
    return '<option value="">No booking</option>' + list.map(function (b) { return '<option value="' + esc(b.id) + '"' + (b.id === sel ? ' selected' : '') + '>' + esc(bookingLabel(b)) + '</option>'; }).join('');
  }
  /* the usual restock at a unit: the average of its turnovers in the last 90 days, or the items' usual use for one stay */
  function usualFor(pid, bookingId) {
    var T = D.TODAY, from = d.add(T, -89), out = [];
    var tos = moves().filter(function (m) { return m && m.dir === 'out' && m.propertyId === pid && m.kind === 'turnover' && m.date >= from && m.date <= T; });
    if (tos.length >= 2) {
      var sum = {}; tos.forEach(function (m) { (m.lines || []).forEach(function (l) { sum[l.itemId] = (sum[l.itemId] || 0) + num(l.qty, 0); }); });
      activeItems().forEach(function (it) { var q = Math.round((sum[it.id] || 0) / tos.length); if (q >= 1) out.push({ itemId: it.id, qty: q }); });
      return { lines: out, why: 'Average of the last ' + tos.length + ' turnovers at ' + propName(pid, true) };
    }
    var b = bookingId && D.booking ? D.booking(bookingId) : null, nights = b ? num(b.nights, 2) : 2, guests = b ? num(b.guests, 2) : 2;
    activeItems().forEach(function (it) { var u = it.use || []; var q = Math.round(num(u[0], 0) + num(u[1], 0) * nights + num(u[2], 0) * guests); if (q >= 1) out.push({ itemId: it.id, qty: q }); });
    return { lines: out, why: 'Usual amounts for a ' + fmt.plural(nights, 'night') + ' stay with ' + fmt.plural(guests, 'guest') };
  }

  function stepper(id, qty) {
    return '<div class="stp"><button type="button" data-step="-1" data-id="' + esc(id) + '" aria-label="One less">−</button><input type="number" inputmode="decimal" min="0" step="1" data-qty="' + esc(id) + '" value="' + esc(qtyText(qty).replace(/,/g, '')) + '" aria-label="Quantity"><button type="button" data-step="1" data-id="' + esc(id) + '" aria-label="One more">+</button></div>';
  }

  function openForm(kind, pre) {
    pre = pre || {};
    if (kind !== 'in' && kind !== 'out' && kind !== 'adjust') return;
    if (!canDo(kind)) { U.toast(noAccess(), 'bad'); return; }
    var phone = isPhone(), meId = O.state.viewer, T = D.TODAY, h = onHand(), v = O.viewer() || {};
    var f = { sel: {}, order: [], q: '', mode: pre.mode === 'writeoff' ? 'writeoff' : 'count', date: T, note: pre.note || '' };
    if (kind === 'out') {
      f.task = myTask();
      f.propertyId = pre.propertyId != null ? pre.propertyId : f.task ? f.task.propertyId : '';
      if (f.propertyId && !prop(f.propertyId)) f.propertyId = '';
      f.use = pre.use || (v.role === 'maintenance' ? 'repair' : 'turnover');
      f.usedBy = meId;
      f.bookingId = pre.bookingId != null ? pre.bookingId : f.use === 'turnover' ? defaultBooking(f.propertyId) : '';
    }
    if (kind === 'in') { f.supplier = pre.supplier || ''; f.cost = pre.cost != null ? String(pre.cost) : ''; }
    function setQty(id, q) { if (f.order.indexOf(id) < 0) f.order.push(id); f.sel[id] = q; }
    function unset(id) { delete f.sel[id]; f.order = f.order.filter(function (x) { return x !== id; }); }
    (pre.lines || []).forEach(function (l) { if (item(l.itemId)) setQty(l.itemId, Math.max(0, num(l.qty, 0))); });
    var isCount = function () { return kind === 'adjust' && f.mode === 'count'; };
    function startQty(id) { return isCount() ? Math.max(0, Math.round(h[id] || 0)) : 1; }

    /* ---- body ---- */
    var title = kind === 'in' ? 'Stock in' : kind === 'out' ? 'Record stock used' : 'Count or adjust stock';
    var sub = kind === 'in' ? 'A purchase or delivery to the store room' : kind === 'out' ? 'What was used, by whom and for which unit' : 'Match the records to the shelf, or write off damaged items';
    var html = '';
    if (kind === 'out') {
      var noUnits = !(D.properties || []).length;
      html += '<div class="form-grid">' +
        '<div class="field"><label for="inv-unit">For which unit <span class="req">*</span></label><select id="inv-unit" class="select" data-f="propertyId"' + (noUnits ? ' disabled' : '') + '>' + unitOptions(f.propertyId) + '</select><div class="hint" data-hint-unit></div></div>' +
        '<div class="field"><label>Used for</label>' + U.seg(USES, f.use, 'data-use') + '</div></div>' +
        (noUnits ? '<div class="note warn">Add your units in Properties first, then record what each one uses.</div>' : '') +
        '<details class="inv-more"' + (phone ? '' : ' open') + '><summary><span>Used by, booking, date and note</span><span class="sum" data-sum></span></summary><div class="form-grid">' +
        '<div class="field"><label for="inv-by">Used by</label><select id="inv-by" class="select" data-f="usedBy">' + (D.staff || []).filter(function (s) { return s.status !== 'left'; }).map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === f.usedBy ? ' selected' : '') + '>' + esc(s.name) + (s.id === meId ? ' (me)' : '') + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="inv-date">Date</label><input id="inv-date" class="input" type="date" data-f="date" max="' + T + '" value="' + T + '"></div>' +
        '<div class="field full"><label for="inv-bk">Booking (optional)</label><select id="inv-bk" class="select" data-f="bookingId">' + bookingOptions(f.propertyId, f.bookingId) + '</select></div>' +
        '<div class="field full"><label for="inv-note">Note</label><input id="inv-note" class="input" data-f="note" maxlength="140" placeholder="Anything unusual, for example a guest asked for extra towels" value="' + esc(f.note) + '"></div>' +
        '</div></details>';
    } else if (kind === 'in') {
      var sups = {}; moves().forEach(function (m) { if (m.supplier) sups[m.supplier] = 1; });
      html += '<div class="form-grid">' +
        '<div class="field"><label for="inv-date">Date</label><input id="inv-date" class="input" type="date" data-f="date" max="' + T + '" value="' + T + '"></div>' +
        '<div class="field"><label for="inv-sup">Supplier</label><input id="inv-sup" class="input" data-f="supplier" list="inv-sups" maxlength="60" placeholder="Shop or distributor" value="' + esc(f.supplier) + '"><datalist id="inv-sups">' + Object.keys(sups).sort().map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist></div>' +
        '<div class="field"><label for="inv-cost">Total cost</label><div class="money-in"><span>RM</span><input id="inv-cost" class="input" type="number" inputmode="decimal" min="0" step="0.01" data-f="cost" value="' + esc(f.cost) + '"></div><div class="hint" data-cost-hint></div></div>' +
        '<div class="field"><label for="inv-note">Note</label><input id="inv-note" class="input" data-f="note" maxlength="140" placeholder="Invoice number or anything to remember" value="' + esc(f.note) + '"></div></div>';
    } else {
      html += '<div class="field">' + U.seg([['count', 'Stock count'], ['writeoff', 'Write off']], f.mode, 'data-mode') + '<div class="mode-hint" data-mode-hint></div></div>' +
        '<div class="form-grid"><div class="field"><label for="inv-date">Date</label><input id="inv-date" class="input" type="date" data-f="date" max="' + T + '" value="' + T + '"></div>' +
        '<div class="field"><label for="inv-note" data-note-label>Note</label><input id="inv-note" class="input" data-f="note" maxlength="140" value="' + esc(f.note) + '"></div></div>';
    }
    html += '<div class="inv-items"><div class="inv-items-head"><span class="label" data-items-label></span>' + (kind === 'adjust' && !phone ? '<button type="button" class="btn btn-quiet btn-xs" data-all>Count every item</button>' : '') + '</div>' +
      (kind === 'out' ? '<div class="note warn" data-dup hidden></div><div class="usual" data-usual hidden></div>' : '') + '<div data-lines></div></div><div class="inv-err" data-err></div>';
    var body = O.html('<div class="inv-form">' + html + '</div>');

    var mdl = U.modal({ title: title, sub: sub, body: body, size: 'wide inv-modal', autofocus: !phone && kind !== 'out', actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', id: 'inv-save', onClick: function () { return save(); } }] });
    var el = mdl.el;
    function $f(k) { return O.$('[data-f="' + k + '"]', body); }
    function err(msg) { O.$('[data-err]', body).textContent = msg || ''; }

    /* ---- labels and hints ---- */
    function paintMeta() {
      var n = f.order.filter(function (id) { return f.sel[id] != null && (isCount() || f.sel[id] > 0); }).length;
      var lbl = kind === 'in' ? 'Items received' : kind === 'out' ? 'Items used' : isCount() ? 'What is on the shelf' : 'Items to write off';
      O.$('[data-items-label]', body).textContent = lbl + (n ? ' · ' + n : '');
      var save = O.$('#inv-save', el);
      if (save && isCount()) { var ch = f.order.filter(function (id) { return f.sel[id] != null && round2(num(f.sel[id], 0) - (h[id] || 0)) !== 0; }).length; save.textContent = ch ? 'Save · ' + fmt.plural(ch, 'correction') : n ? 'Save count' : 'Save'; }
      else if (save) save.textContent = n ? 'Save · ' + fmt.plural(n, 'item') : 'Save';
      var allBtn = O.$('[data-all]', body); if (allBtn) allBtn.hidden = !isCount();
      if (kind === 'in') {
        var est = f.order.reduce(function (s, id) { var it = item(id); return s + num(f.sel[id], 0) * num(it && it.cost, 0); }, 0);
        O.$('[data-cost-hint]', body).textContent = est > 0 ? 'About ' + money(round2(est)) + ' at usual prices' : 'The amount on the receipt';
      }
      if (kind === 'adjust') {
        O.$('[data-mode-hint]', body).textContent = isCount() ? 'Enter what you counted. The difference from the records is saved, so the stock matches the shelf.' : 'Damaged, stained, expired or missing items. They leave the stock without being used at a unit.';
        O.$('[data-note-label]', body).innerHTML = isCount() ? 'Note' : 'Reason <span class="req">*</span>';
        $f('note').placeholder = isCount() ? 'For example: monthly stock take' : 'For example: 2 towels stained beyond cleaning';
      }
      if (kind === 'out') {
        var hint = O.$('[data-hint-unit]', body), t = f.task;
        hint.textContent = t && t.propertyId === f.propertyId ? 'From your task: ' + t.title + ', ' + fmt.time(t.due) : '';
        var sumEl = O.$('[data-sum]', body), b = f.bookingId && D.booking ? D.booking(f.bookingId) : null;
        sumEl.textContent = [f.usedBy === meId ? 'Me' : firstName(personName(f.usedBy)), f.date === T ? 'today' : d.fmt(f.date), b ? (O.can('bookings') && b.guest ? 'after ' + firstName(b.guest.name) : b.id) : ''].filter(Boolean).join(' · ');
        var dup = O.$('[data-dup]', body), prev = f.use === 'turnover' ? restocksFor(f.bookingId) : [];
        dup.hidden = !prev.length;
        if (prev.length) { var pm = prev[prev.length - 1]; dup.textContent = 'A turnover restock for this booking is already recorded (' + (pm.date === T ? 'today' : d.fmt(pm.date)) + (pm.at && pm.at.length > 10 ? ' at ' + fmt.time(pm.at) : '') + ', by ' + (personName(pm.usedBy || pm.by) || 'someone') + '). Save only what was used on top of it.'; }
        paintUsual();
      }
    }
    function paintUsual() {
      var box = O.$('[data-usual]', body); if (!box) return;
      if (!f.propertyId || f.use !== 'turnover' || restocksFor(f.bookingId).length) { box.hidden = true; return; }
      var u = usualFor(f.propertyId, f.bookingId);
      if (!u.lines.length) { box.hidden = true; return; }
      box.hidden = false;
      if (f.filled === f.propertyId + '|' + f.bookingId) { box.innerHTML = '<div class="grow"><b>' + O.icon('check') + ' The usual restock is filled in</b>Change anything that was different, then save.</div><button type="button" class="btn btn-ghost btn-sm" data-clear>Clear</button>'; return; }
      box.innerHTML = '<div class="grow"><b>The usual restock: ' + fmt.plural(u.lines.length, 'item') + '</b>' + esc(u.why) + '</div><button type="button" class="btn btn-primary btn-sm" data-fill>' + O.icon('plus') + 'Fill in</button>';
    }

    /* ---- items: picker (desktop) or tick list (phone) ---- */
    function lineMeta(id) {
      var it = item(id), have = h[id] || 0, q = num(f.sel[id], 0), u = unitWord(it, have);
      if (isCount()) {
        if (!(id in h)) return { t: 'First count', bad: false };
        var diff = round2(q - have); return { t: 'Records say ' + qtyText(have) + (diff ? ' · ' + (diff < 0 ? qtyText(-diff) + ' missing' : qtyText(diff) + ' extra') : ' · matches'), bad: diff < 0 };
      }
      if ((kind === 'out' || (kind === 'adjust')) && q > have) return { t: 'Only ' + qtyText(have) + ' ' + u + ' in the records', bad: true };
      return { t: qtyText(have) + ' ' + u + ' in stock', bad: false };
    }
    function pickerList() {
      var q = f.q.trim().toLowerCase(), list = matchItems(activeItems(), q, function (it) { return it.name; }, function (it) { return it.cat; });
      if (!list.length) return '<div class="ip-none">No item matches "' + esc(f.q) + '".' + (O.can('inventory.items') ? ' Add it in the Items tab.' : '') + '</div>';
      return cats().concat(['Other']).map(function (c) {
        var rows = list.filter(function (it) { return (it.cat || 'Other') === c; }); if (!rows.length) return '';
        return '<div class="ip-cat">' + esc(c) + '</div>' + rows.map(function (it) {
          return '<button type="button" role="option" class="ip-opt' + (f.sel[it.id] != null ? ' in' : '') + '" data-pick="' + esc(it.id) + '"><span class="t">' + esc(it.name) + '</span><span class="s">' + qtyText(h[it.id] || 0) + ' ' + esc(unitWord(it, h[it.id] || 0)) + ' in stock</span></button>';
        }).join('');
      }).join('');
    }
    function lineHTML(id) {
      var it = item(id), m = lineMeta(id);
      return '<div class="ip-line" data-line="' + esc(id) + '"><div class="nm"><b>' + esc(it ? it.name : 'Removed item') + '</b><span class="s' + (m.bad ? ' bad' : '') + '" data-meta>' + esc(m.t) + '</span></div>' + stepper(id, f.sel[id]) +
        '<button type="button" class="ip-x" data-rm="' + esc(id) + '" aria-label="Remove ' + esc(it ? it.name : 'item') + '">×</button></div>';
    }
    function tickRow(it) {
      var on = f.sel[it.id] != null, m = on ? lineMeta(it.id) : isCount() && !(it.id in h) ? { t: 'Not counted yet', bad: false } : { t: (isCount() ? 'Records say ' : '') + qtyText(h[it.id] || 0) + (isCount() ? '' : ' ' + unitWord(it, h[it.id] || 0) + ' in stock'), bad: false };
      return '<div class="tk-row' + (on ? ' on' : '') + '" data-row="' + esc(it.id) + '"><button type="button" class="tk-tick" data-tick="' + esc(it.id) + '" aria-pressed="' + on + '"><span class="tk-box">' + (on ? O.icon('check') : '') + '</span>' +
        '<span class="tk-nm"><span class="t">' + esc(it.name) + '</span><span class="s' + (m.bad ? ' bad' : '') + '" data-meta>' + esc(m.t) + '</span></span></button>' + (on ? stepper(it.id, f.sel[it.id]) : '') + '</div>';
    }
    function tickList() {
      var q = f.q.trim().toLowerCase(), list = matchItems(activeItems(), q, function (it) { return it.name; }, function (it) { return it.cat; });
      if (!activeItems().length) return '<div class="tk-none">There are no items to choose yet.' + (O.can('inventory.items') ? ' Add them in the Items tab.' : '') + '</div>';
      if (!list.length) return '<div class="tk-none">No item matches "' + esc(f.q) + '".</div>';
      /* ticked items first, so a filled-in restock is easy to check */
      var ticked = list.filter(function (it) { return f.sel[it.id] != null; });
      var html = ticked.length && !q ? '<div class="tk-cat">Ticked</div>' + ticked.map(tickRow).join('') : '';
      cats().concat(['Other']).forEach(function (c) {
        var rows = list.filter(function (it) { return (it.cat || 'Other') === c && (q || f.sel[it.id] == null); }); if (!rows.length) return;
        html += '<div class="tk-cat">' + esc(c) + '</div>' + rows.map(tickRow).join('');
      });
      return html;
    }
    var host = O.$('[data-lines]', body);
    function paintItems() {
      if (phone) {
        host.innerHTML = '<div class="tk"><div class="tk-top"><label class="search">' + O.icon('search') + '<input type="search" data-q placeholder="Search items" value="' + esc(f.q) + '" aria-label="Search items"></label></div><div data-tk>' + tickList() + '</div></div>';
      } else {
        host.innerHTML = '<div class="ip"><label class="search ip-box">' + O.icon('search') + '<input data-q autocomplete="off" role="combobox" aria-expanded="false" aria-label="Add an item" placeholder="Add an item: type to search, or pick from the list" value="' + esc(f.q) + '"></label><div class="ip-list" role="listbox" hidden></div><div class="ip-lines"></div></div>';
        paintLines();
      }
      paintMeta();
    }
    function paintLines() {
      if (phone) { var tk = O.$('[data-tk]', host); if (tk) tk.innerHTML = tickList(); return; }
      var box = O.$('.ip-lines', host);
      box.innerHTML = f.order.filter(function (id) { return f.sel[id] != null; }).map(lineHTML).join('');
      if (!f.order.length) box.innerHTML = '';
    }
    function refreshLine(id) {
      if (phone) {
        var row = O.$('[data-row="' + id + '"]', host), it = item(id);
        if (row && it) { var n = O.html(tickRow(it)); row.replaceWith(n); }
      } else {
        var meta = O.$('[data-line="' + id + '"] [data-meta]', host);
        if (meta) { var m = lineMeta(id); meta.textContent = m.t; meta.classList.toggle('bad', m.bad); }
      }
      paintMeta();
    }
    var list = null, act = -1;
    function openList(show) {
      list = O.$('.ip-list', host); if (!list) return;
      list.hidden = !show; O.$('[data-q]', host).setAttribute('aria-expanded', String(!!show));
      if (show) { list.innerHTML = pickerList(); act = -1; }
    }
    function moveAct(dir) {
      var opts = O.$$('.ip-opt', list); if (!opts.length) return;
      act = Math.max(0, Math.min(opts.length - 1, act + dir));
      opts.forEach(function (o, i) { o.classList.toggle('act', i === act); });
      opts[act].scrollIntoView({ block: 'nearest' });
    }
    function pick(id, focusQty) {
      if (f.sel[id] == null) setQty(id, startQty(id));
      f.q = ''; var qi = O.$('[data-q]', host); if (qi) qi.value = '';
      paintLines(); paintMeta();
      var line = O.$('[data-line="' + id + '"]', host);
      if (line) { line.classList.add('flash'); setTimeout(function () { line.classList.remove('flash'); }, 700); line.scrollIntoView({ block: 'nearest' }); }
      if (focusQty) { openList(false); var inp = O.$('[data-qty="' + id + '"]', host); if (inp) { inp.focus(); inp.select(); } }
      else if (list && !list.hidden) list.innerHTML = pickerList();
    }

    /* ---- events ---- */
    body.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.use) { f.use = b.dataset.use; O.$$('[data-use]', body).forEach(function (x) { x.classList.toggle('on', x === b); }); if (f.use !== 'turnover') { f.bookingId = ''; $f('bookingId').value = ''; } paintMeta(); return; }
      if (b.dataset.mode) {
        f.mode = b.dataset.mode; O.$$('[data-mode]', body).forEach(function (x) { x.classList.toggle('on', x === b); });
        f.order.forEach(function (id) { f.sel[id] = startQty(id); }); paintLines(); paintMeta(); err(''); return;
      }
      if (b.hasAttribute('data-fill')) {
        var u = usualFor(f.propertyId, f.bookingId); u.lines.forEach(function (l) { setQty(l.itemId, l.qty); });
        f.filled = f.propertyId + '|' + f.bookingId;
        f.q = ''; var qi = O.$('[data-q]', host); if (qi) qi.value = '';
        paintLines(); paintMeta(); err('');
        return;
      }
      if (b.hasAttribute('data-clear')) { f.sel = {}; f.order = []; f.filled = ''; paintLines(); paintMeta(); return; }
      if (b.hasAttribute('data-all')) { activeItems().forEach(function (it) { if (f.sel[it.id] == null) setQty(it.id, startQty(it.id)); }); paintLines(); paintMeta(); return; }
      if (b.dataset.pick) { pick(b.dataset.pick, false); return; }
      if (b.dataset.rm) { unset(b.dataset.rm); paintLines(); paintMeta(); return; }
      if (b.dataset.tick) {
        var id = b.dataset.tick; if (f.sel[id] != null) unset(id); else setQty(id, startQty(id));
        refreshLine(id); err(''); return;
      }
      if (b.dataset.step) {
        var sid = b.dataset.id, nv = Math.max(0, round2(num(f.sel[sid], 0) + num(b.dataset.step, 0)));
        if (nv === 0 && !isCount()) { if (phone) { unset(sid); refreshLine(sid); } else { f.sel[sid] = 0; var inp0 = O.$('[data-qty="' + sid + '"]', host); if (inp0) inp0.value = '0'; refreshLine(sid); } return; }
        f.sel[sid] = nv; var inp = O.$('[data-qty="' + sid + '"]', host); if (inp) inp.value = qtyText(nv).replace(/,/g, '');
        refreshLine(sid);
      }
    });
    body.addEventListener('mousedown', function (e) { if (e.target.closest('.ip-list')) e.preventDefault(); });
    body.addEventListener('input', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-q')) {
        f.q = t.value;
        if (phone) { var tk = O.$('[data-tk]', host); if (tk) tk.innerHTML = tickList(); }
        else { openList(true); if (f.q.trim()) moveAct(1); }
        return;
      }
      if (t.dataset.qty) { var v2 = num(t.value, NaN); if (isFinite(v2) && v2 >= 0) { f.sel[t.dataset.qty] = round2(v2); refreshLine(t.dataset.qty); } return; }
      if (t.dataset.f === 'note') f.note = t.value;
      if (t.dataset.f === 'supplier') f.supplier = t.value;
      if (t.dataset.f === 'cost') f.cost = t.value;
    });
    body.addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset.qty) { var v3 = num(t.value, 0); f.sel[t.dataset.qty] = Math.max(0, round2(v3)); t.value = qtyText(f.sel[t.dataset.qty]).replace(/,/g, ''); refreshLine(t.dataset.qty); return; }
      if (t.dataset.f === 'propertyId') {
        f.propertyId = t.value; f.bookingId = f.use === 'turnover' ? defaultBooking(f.propertyId) : '';
        $f('bookingId').innerHTML = bookingOptions(f.propertyId, f.bookingId); err(''); paintMeta(); return;
      }
      if (t.dataset.f === 'bookingId') { f.bookingId = t.value; paintMeta(); return; }
      if (t.dataset.f === 'usedBy') { f.usedBy = t.value; paintMeta(); return; }
      if (t.dataset.f === 'date') { f.date = t.value && t.value <= T ? t.value : T; t.value = f.date; paintMeta(); return; }
    });
    body.addEventListener('focusin', function (e) { if (!phone && e.target.hasAttribute('data-q')) openList(true); });
    body.addEventListener('focusout', function (e) { if (!phone && e.target.hasAttribute('data-q')) setTimeout(function () { if (document.activeElement !== e.target) openList(false); }, 120); });
    body.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-q') && !phone) {
        if (e.key === 'ArrowDown') { e.preventDefault(); if (!list || list.hidden) openList(true); moveAct(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); moveAct(-1); }
        else if (e.key === 'Enter') { e.preventDefault(); var opts = list ? O.$$('.ip-opt', list) : []; var o = opts[act >= 0 ? act : 0]; if (o && !list.hidden) pick(o.dataset.pick, true); }
        else if (e.key === 'Escape' && list && !list.hidden) { e.stopPropagation(); openList(false); }
      } else if (t.dataset.qty && e.key === 'Enter') { e.preventDefault(); t.blur(); var qi = O.$('[data-q]', host); if (qi && !phone) qi.focus(); }
    }, true);

    /* ---- save ---- */
    function save() {
      err('');
      var date = ($f('date') && $f('date').value) || T; if (date > T) date = T;
      var note = String(($f('note') && $f('note').value) || '').trim();
      var ids = f.order.filter(function (id) { return f.sel[id] != null && item(id); });
      var lines = [];
      if (isCount()) {
        var now = onHand();
        ids.forEach(function (id) { var c = Math.max(0, num(f.sel[id], 0)), diff = round2(c - (now[id] || 0)); if (diff) lines.push({ itemId: id, qty: diff, counted: c }); });
        if (!ids.length) { err('Tick the items you counted.'); return false; }
        if (!lines.length) { U.toast('Everything you counted matches the records. Nothing to change.'); return true; }
      } else {
        ids.forEach(function (id) { var q = round2(num(f.sel[id], 0)); if (q > 0) lines.push({ itemId: id, qty: kind === 'adjust' ? -q : q }); });
        if (!lines.length) { err(kind === 'in' ? 'Add the items you received and how many.' : kind === 'out' ? 'Tick what you used and how many.' : 'Add the items to write off.'); return false; }
      }
      var at = date === T ? D.NOW : date + 'T12:00';
      var mv = { id: O.uid('MV'), date: date, at: at, dir: kind, lines: lines, note: note, by: meId };
      if (kind === 'out') {
        if (!f.propertyId || !prop(f.propertyId)) { err('Choose the unit the items were used for.'); var s = $f('propertyId'); if (s && !s.disabled) s.focus(); return false; }
        mv.kind = f.use; mv.propertyId = f.propertyId; mv.usedBy = f.usedBy || meId;
        if (f.bookingId) mv.bookingId = f.bookingId;
        if (!note && f.bookingId && f.use === 'turnover') { var b = D.booking ? D.booking(f.bookingId) : null; if (b && b.guest) mv.note = 'Turnover restock after ' + b.guest.name; }
      } else if (kind === 'in') {
        var cost = $f('cost').value;
        if (cost !== '' && !(num(cost, -1) >= 0)) { err('Enter the total cost as a number, or leave it empty.'); return false; }
        mv.kind = 'purchase'; mv.supplier = String($f('supplier').value || '').trim();
        if (cost !== '') mv.cost = round2(num(cost, 0));
      } else {
        mv.kind = f.mode;
        if (f.mode === 'writeoff' && !note) { err('Say why these items are written off.'); $f('note').focus(); return false; }
      }
      D.invMoves.push(mv);
      O.emit('data');
      var n = fmt.plural(lines.length, 'item');
      U.toast(kind === 'in' ? 'Stock in saved: ' + n : kind === 'out' ? 'Saved: ' + n + ' used at ' + propName(mv.propertyId, true) : f.mode === 'count' ? 'Count saved: ' + fmt.plural(lines.length, 'difference') + ' corrected' : 'Write-off saved: ' + n);
      return true;
    }

    paintItems();
  }

  /* ------------------------------------------------------------------ page */
  function setActions(ctx) {
    var acts = '';
    if (canDo('in')) acts += '<button type="button" class="btn btn-ghost inv-act" data-top="in">' + O.icon('download') + '<span class="lg">Stock in</span><span class="sm">In</span></button>';
    if (canDo('adjust')) acts += '<button type="button" class="btn btn-ghost inv-act" data-top="adjust">' + O.icon('check') + '<span class="lg">Count or adjust</span><span class="sm">Count</span></button>';
    if (canDo('out')) acts += '<button type="button" class="btn btn-primary inv-act" data-top="out">' + O.icon('upload') + '<span class="lg">Record stock used</span><span class="sm">Stock used</span></button>';
    ctx.setActions(acts);
    ctx.actionsEl.onclick = function (e) { var b = e.target.closest('[data-top]'); if (b) openForm(b.dataset.top); };
  }
  function body() {
    if (st.tab === 'moves') return movesTab();
    if (st.tab === 'overuse') return overuseTab();
    if (st.tab === 'items') return itemsTab();
    if (st.tab === 'settings') return settingsTab();
    return stockTab();
  }

  O.page('inventory', {
    desc: 'Stock in the store room, what each unit uses, and early warnings',
    render: function (root, ctx) {
      var p = ctx.params || {};
      if (ctx.fresh) {
        if (p.tab) st.tab = p.tab;
        if (p.low) { st.tab = 'stock'; st.lowOnly = true; st.q = ''; st.cat = ''; }
        if (p.propertyId || p.itemId) { st.tab = p.tab || 'moves'; st.mv.prop = p.propertyId || ''; st.mv.item = p.itemId || ''; st.mv.dir = ''; st.mv.person = ''; }
      }
      var T = tabs();
      if (!T.some(function (t) { return t[0] === st.tab; })) st.tab = 'stock';
      setActions(ctx);
      var viewOnly = !canDo('in') && !canDo('out') && !canDo('adjust');
      root.innerHTML = '<div class="pg-inv">' +
        '<div class="tabs" role="tablist">' + T.map(function (t) { return '<button type="button" role="tab" aria-selected="' + (t[0] === st.tab) + '" class="' + (t[0] === st.tab ? 'on' : '') + '" data-tab="' + t[0] + '">' + esc(t[1]) + (t[2] ? '<span class="tab-n">' + t[2] + '</span>' : '') + '</button>'; }).join('') + '</div>' +
        (viewOnly && st.tab === 'stock' ? '<div class="note">You can see stock and records. Recording stock is not part of your access; an account owner can change that in Staff Access.</div>' : '') +
        '<div class="inv-body">' + body() + '</div></div>';
      var pg = O.$('.pg-inv', root), bodyEl = O.$('.inv-body', pg);
      var tabsEl = O.$('.tabs', pg), onTab = O.$('.tabs .on', pg);
      if (tabsEl && onTab && onTab.offsetLeft + onTab.offsetWidth > tabsEl.clientWidth) tabsEl.scrollLeft = onTab.offsetLeft - 16;
      function repaint() { bodyEl.innerHTML = body(); mountRange(); if (st.tab === 'settings') paintSettingsPreview(pg); }
      function mountRange() {
        if (st.tab !== 'moves' || !O.$('[data-slot="mv-range"]', pg)) return;
        U.mount(pg, 'mv-range', U.dateRange({ preset: st.mv.preset, from: st.mv.from, to: st.mv.to, presets: MV_PRESETS, onChange: function (r) { st.mv.preset = r.preset; st.mv.from = r.from; st.mv.to = r.to; st.mv.limit = 60; repaint(); } }));
      }
      mountRange();
      if (st.tab === 'settings') paintSettingsPreview(pg);

      pg.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.dataset.tab) { st.tab = b.dataset.tab; ctx.rerender(); return; }
        if (b.dataset.mvOpen) { openMove(b.dataset.mvOpen); return; }
        if (b.dataset.dir != null && b.closest('.dirs')) { st.mv.dir = b.dataset.dir; st.mv.limit = 60; repaint(); return; }
        if (b.dataset.ovUnits) { st.ov.open[b.dataset.ovUnits] = !st.ov.open[b.dataset.ovUnits]; repaint(); return; }
        if (b.dataset.ovMoves) { var k = b.dataset.ovMoves.split('|'); st.tab = 'moves'; st.mv.prop = k[0]; st.mv.item = k[1]; st.mv.dir = 'out'; st.mv.person = ''; st.mv.preset = 'last90'; st.mv.limit = 60; ctx.rerender(); return; }
        if (b.dataset.itEdit) { editItem(b.dataset.itEdit); return; }
        if (b.dataset.itToggle) { toggleItem(b.dataset.itToggle); return; }
        if (b.dataset.setBasis) { O.$$('[data-set-basis]', pg).forEach(function (x) { x.classList.toggle('on', x === b); }); paintSettingsPreview(pg); return; }
        var a = b.dataset.act; if (!a) return;
        if (a === 'in' || a === 'out' || a === 'adjust') openForm(a);
        else if (a === 'count-first') openForm('adjust', { mode: 'count', lines: activeItems().map(function (it) { return { itemId: it.id, qty: 0 }; }) });
        else if (a === 'buy-low') buyLow();
        else if (a === 'low-only') { st.lowOnly = !st.lowOnly; repaint(); }
        else if (a === 'stock-csv') stockCSV();
        else if (a === 'mv-csv') movesCSV();
        else if (a === 'mv-more') { st.mv.limit += 60; repaint(); }
        else if (a === 'mv-clear') { st.mv.prop = ''; st.mv.item = ''; st.mv.person = ''; st.mv.dir = ''; st.mv.limit = 60; repaint(); }
        else if (a === 'it-add') editItem(null);
        else if (a === 'it-inactive') { st.it.inactive = !st.it.inactive; repaint(); }
        else if (a === 'set-save') {
          var dr = draftSettings(pg), s = D.inventorySettings;
          s.basis = dr.basis; s.threshold = round2(dr.threshold); s.minQty = dr.minQty;
          O.emit('data'); U.toast('Settings saved. ' + fmt.plural(overuse().length, 'warning') + ' with the new rule.');
        }
        else if (a === 'set-reset') {
          O.$$('[data-set-basis]', pg).forEach(function (x) { x.classList.toggle('on', x.dataset.setBasis === DEFAULTS.basis); });
          O.$('[data-set="threshold"]', pg).value = Math.round(DEFAULTS.threshold * 100); O.$('[data-set="minQty"]', pg).value = DEFAULTS.minQty;
          paintSettingsPreview(pg);
        }
      });
      pg.addEventListener('input', function (e) {
        var t = e.target;
        if (t.dataset.in === 'q') { st.q = t.value; var sl = O.$('[data-slot-list]', pg); if (sl) sl.innerHTML = stockList(); return; }
        if (t.dataset.it === 'q') { st.it.q = t.value; var cur = t.selectionStart; repaint(); var ni = O.$('[data-it="q"]', pg); if (ni) { ni.focus(); try { ni.setSelectionRange(cur, cur); } catch (x) { /* search inputs */ } } return; }
        if (t.dataset.set) paintSettingsPreview(pg);
      });
      pg.addEventListener('change', function (e) {
        var t = e.target;
        if (t.dataset.in === 'cat') { st.cat = t.value; var sl = O.$('[data-slot-list]', pg); if (sl) sl.innerHTML = stockList(); return; }
        if (t.dataset.mv) { st.mv[t.dataset.mv] = t.value; st.mv.limit = 60; repaint(); }
      });

      if (ctx.fresh && p.action) setTimeout(function () { openForm(p.action, p); }, 0);
    }
  });
})();
