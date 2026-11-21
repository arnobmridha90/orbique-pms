/* Net rates (Manage → Net rates): what the business takes home per night on every booking site, for every unit type
   and date, next to its own price (the target). Read-only for rates: prices are still set in Calendar → Rates &
   restrictions; this page only reads them.
   - One table per unit type: a row per booking-site rate plan (and per unit listing, e.g. "Airbnb · 47-1"), a column
     per night. The first row is the type's own plan of that kind (Flexible, Non-refundable or Weekly), which is what
     the website and walk-ins pay: the target every other row is compared with.
   - Each cell: the rate Orbique sends that night (its own day rate, else the plan it follows plus its rule), less the
     workspace's last-minute deal on the nights it covers, less the site's discounts, less its commission and the tax
     on the commission. Red = more than 3% under the target, green = more than 3% over, ringed = the lowest that night.
   - Take-home or Guest price; Usual discounts (the ones set "always") or Worst case (also the "sometimes" ones,
     such as Booking.com Genius or Agoda Private Sale).
   - What each site takes: blob netFees {sites: {airbnb: {commission, tax, discounts: [{name, pct, when}]}}, updatedAt, by},
     one per workspace, edited here (pricing.rules). A site without settings uses its usual commission (D.channels).
   Which site a plan sells on: plan.channel if set, else its name (Airbnb, Booking.com, Agoda, Expedia, Trip.com, Vrbo);
   a plan with none of these is the workspace's own (website / walk-in). Access: Pricing (view). */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  O.sync.blob('netFees', 'config');
  var SITE_ORDER = ['direct', 'airbnb', 'booking', 'agoda', 'expedia', 'trip', 'vrbo', 'other'];
  var SITE_RX = [['airbnb', /airbnb/i], ['booking', /booking\.com|\bbdc\b/i], ['agoda', /agoda/i], ['expedia', /expedia/i], ['trip', /trip\.com|ctrip/i], ['vrbo', /vrbo/i]];
  var KINDS = [['std', 'Standard'], ['nref', 'Non-refundable'], ['week', 'Weekly']];
  var SPANS = [[14, '2 weeks'], [31, 'Month'], [62, '2 months']];
  var st = { bid: '', from: null, nights: 14, show: 'net', worst: false, kind: 'std' };

  function canView() { return O.can('pricing', 'view'); }
  function canEdit() { return O.can('pricing.rules'); }
  function num(v) { if (v === null || v === undefined || v === '') return null; var n = +v; return isFinite(n) ? n : null; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function isArchived(x) { return !!(x && (x.archived === true || x.status === 'archived')); }
  function siteName(s) { return s === 'direct' ? 'Website / walk-in' : U.platName(s); }

  /* ---------------- what each site takes ---------------- */
  function feeStore() { if (!D.netFees || typeof D.netFees !== 'object' || Array.isArray(D.netFees)) D.netFees = { sites: {} }; if (!D.netFees.sites || typeof D.netFees.sites !== 'object') D.netFees.sites = {}; return D.netFees; }
  function defaults(site) {
    var c = site === 'direct' ? 0 : D.channels[site] ? Math.round(D.channels[site].feePct * 1000) / 10 : 15;
    return { commission: c, tax: 0, discounts: [] };
  }
  function feesOf(site) {
    var s = D.netFees && D.netFees.sites && D.netFees.sites[site];
    if (!s || typeof s !== 'object') return defaults(site);
    return {
      commission: num(s.commission) !== null ? +s.commission : defaults(site).commission,
      tax: num(s.tax) || 0,
      discounts: (Array.isArray(s.discounts) ? s.discounts : []).filter(function (x) { return x && num(x.pct) > 0 && num(x.pct) < 100; })
    };
  }
  function isSet(site) { return !!(D.netFees && D.netFees.sites && D.netFees.sites[site]); }
  /* one night: the sent rate -> what the guest sees and what the business keeps */
  function calc(sent, lm, fees, worst) {
    var steps = [], price = sent;
    if (lm < 1) { var cut = price * (1 - lm); steps.push(['Last-minute deal', -cut]); price -= cut; }
    fees.discounts.forEach(function (x) {
      if (x.when === 'sometimes' && !worst) return;
      var amt = price * (+x.pct / 100); steps.push([O.tpl(x.when === 'sometimes' ? '{name} ({p}%, sometimes)' : '{name} ({p}%)', { name: x.name || O.tr('Discount'), p: x.pct }), -amt]); price -= amt;
    });
    var guest = price, com = price * fees.commission / 100, tax = com * fees.tax / 100;
    if (com) steps.push([O.tpl('Commission ({p}%)', { p: fees.commission }), -com]);
    if (tax) steps.push([O.tpl('Tax on the commission ({p}%)', { p: fees.tax }), -tax]);
    return { sent: sent, guest: guest, net: guest - com - tax, steps: steps };
  }
  /* the workspace's last-minute deal for one night (as the channel manager: api/_lib/channex-sync.js lastMinuteFactor) */
  function lastMinute(iso) {
    var x = D.lastMinuteDeal; if (!x || typeof x !== 'object') return 1;
    var pct = num(x.pct), days = num(x.days);
    if (pct === null || pct <= 0 || pct >= 60 || !days || days < 1 || days > 14) return 1;
    if (iso < D.TODAY || iso > d.add(D.TODAY, Math.floor(days) - 1)) return 1;
    if (x.until && iso > x.until) return 1;
    if (Array.isArray(x.skip) && x.skip.indexOf(iso) >= 0) return 1;
    if (Array.isArray(x.nights) && x.nights.indexOf(d.dow(iso)) < 0) return 1;
    return 1 - pct / 100;
  }

  /* ---------------- plans ---------------- */
  function siteOf(plan) {
    if (plan.channel && (D.channels[plan.channel] || plan.channel === 'direct')) return plan.channel;
    var s = (plan.name || '') + ' ' + (plan.id || '');
    for (var i = 0; i < SITE_RX.length; i++) if (SITE_RX[i][1].test(s)) return SITE_RX[i][0];
    return 'direct';
  }
  function kindOf(plan) {
    var n = plan.name || '';
    if (/non.?refund|\bnref\b/i.test(n)) return 'nref';
    if (/week|7\s*\+/i.test(n) || (num(plan.minStay) || 1) >= 7) return 'week';
    return 'std';
  }
  /* the tiers of a building, each with its plans and its unit listings' plans */
  function tiersOf(bid) {
    var C = O.channel; if (!C) return [];
    var all = O.typesOf(bid), out = [];
    all.filter(function (t) { return !t.listingOf; }).forEach(function (t) {
      var rows = [];
      C.plansOf(t.id).forEach(function (p) { var s = siteOf(p); rows.push({ plan: p, site: s, kind: kindOf(p), label: s === 'direct' ? p.name : siteName(s) }); });
      all.filter(function (lt) { var u = lt.listingOf && D.propById[lt.listingOf]; return u && u.unitTypeId === t.id; }).forEach(function (lt) {
        var u = D.propById[lt.listingOf], tag = u.unitNo || u.short || u.name;
        C.plansOf(lt.id).forEach(function (p) { var s = siteOf(p); rows.push({ plan: p, site: s, kind: kindOf(p), label: (s === 'direct' ? p.name : siteName(s)) + ' · ' + tag, listing: true }); });
      });
      if (rows.length) out.push({ type: t, rows: rows });
    });
    return out;
  }
  /* the target of a kind: the type's own plan of that kind (website / walk-in), else its main plan */
  function targetRow(tier, kind) {
    var own = tier.rows.filter(function (r) { return r.site === 'direct' && !r.listing && r.kind === kind; });
    own.sort(function (a, b) { return (b.plan.primary ? 1 : 0) - (a.plan.primary ? 1 : 0); });
    if (own[0]) return own[0];
    var main = tier.rows.filter(function (r) { return r.plan.primary; })[0];
    return main || null;
  }
  function siteRank(r) { var i = SITE_ORDER.indexOf(r.site); return (i < 0 ? 99 : i) * 2 + (r.listing ? 1 : 0); }

  /* ---------------- the numbers for one tier ---------------- */
  function compute(tier, dates, map) {
    var C = O.channel, tgt = targetRow(tier, st.kind);
    var rows = tier.rows.filter(function (r) { return r.kind === st.kind && r !== tgt; }).sort(function (a, b) { return siteRank(a) - siteRank(b) || String(a.label).localeCompare(String(b.label)); });
    if (tgt) rows.unshift(tgt);
    var main = tier.rows.filter(function (r) { return r.plan.primary; })[0];
    var target = {}, special = {};
    dates.forEach(function (iso) {
      var v = tgt ? C.planRateIn(map, tgt.plan, iso) : null;
      target[iso] = v !== null && v > 0 ? v * lastMinute(iso) : null;
      var md = main ? C.dayIn(map, main.plan.id, iso) : null;
      if (md && (num(md.minStay) || 1) >= 2) special[iso] = true;
    });
    var out = rows.map(function (r) {
      var fees = feesOf(r.site), cells = {}, sum = 0, n = 0, under = 0;
      dates.forEach(function (iso) {
        var sent = C.planRateIn(map, r.plan, iso), day = C.dayIn(map, r.plan.id, iso) || {};
        if (sent === null || !(sent > 0)) { cells[iso] = null; return; }
        var c = calc(sent, lastMinute(iso), fees, st.worst);
        c.closed = !!day.stopSell || isArchived(r.plan);
        c.ratio = target[iso] ? c.net / target[iso] : null;
        if (!c.closed && c.ratio !== null) { sum += c.ratio; n++; if (c.ratio < 0.97) under++; }
        cells[iso] = c;
      });
      return { r: r, cells: cells, avg: n ? sum / n : null, under: under, open: n, isTarget: r === tgt };
    });
    /* the lowest take-home each night among the booking sites that are open */
    var low = {};
    dates.forEach(function (iso) {
      var best = null, n = 0;
      out.forEach(function (x) { if (x.isTarget) return; var c = x.cells[iso]; if (c && !c.closed) { n++; if (best === null || c.net < best.net) best = c; } });
      if (best && n > 1) low[iso] = best;
    });
    return { tier: tier, tgt: tgt, rows: out, low: low, special: special, target: target };
  }

  /* ---------------- styles ---------------- */
  O.css('netrates', [
    '.pg-netrates{display:flex;flex-direction:column;gap:14px;}',
    '.pg-netrates .toolbar{margin-bottom:0;}',
    '.pg-netrates .nr-nav{display:inline-flex;gap:4px;align-items:center;}',
    '.pg-netrates .nr-nav input{width:150px;}',
    '.pg-netrates .nr-key{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:11.5px;color:var(--muted);align-items:center;}',
    '.pg-netrates .nr-key span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;}',
    '.pg-netrates .nr-key i{display:inline-block;width:12px;height:12px;border-radius:3px;}',
    '.pg-netrates .nr-key i.u{background:var(--bad-soft);border:1px solid var(--bad);} .pg-netrates .nr-key i.o{background:var(--ok-soft);border:1px solid var(--ok);}',
    '.pg-netrates .nr-key i.l{border:2px solid var(--text);} .pg-netrates .nr-key i.w{background:var(--surface-2);border:1px solid var(--border);}',
    '.pg-netrates .nr-key i.c{background:repeating-linear-gradient(135deg,var(--bad-soft) 0 3px,transparent 3px 6px);border:1px solid var(--border);}',
    '.pg-netrates .nr-watch ul{list-style:none;margin:0;padding:0;}',
    '.pg-netrates .nr-watch li{display:flex;gap:8px;align-items:baseline;padding:8px 16px;border-top:1px solid var(--border);font-size:12.5px;line-height:1.45;}',
    '.pg-netrates .nr-watch li:first-child{border-top:none;}',
    '.pg-netrates .nr-watch li b{font-weight:800;}',
    '.pg-netrates .nr-watch li svg{width:14px;height:14px;flex:none;color:var(--warn);align-self:center;}',
    '.pg-netrates .nr-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;}',
    '.pg-netrates table.nr{border-collapse:separate;border-spacing:0;font-size:12px;font-variant-numeric:tabular-nums;min-width:100%;}',
    '.pg-netrates table.nr th,.pg-netrates table.nr td{padding:0;border-bottom:1px solid var(--border);text-align:center;white-space:nowrap;}',
    '.pg-netrates table.nr thead th{position:sticky;top:0;background:var(--surface);z-index:2;font-size:10.5px;font-weight:700;color:var(--muted);padding:6px 2px 5px;line-height:1.25;min-width:54px;}',
    '.pg-netrates table.nr thead th b{display:block;font-size:12.5px;color:var(--text);font-weight:800;}',
    '.pg-netrates table.nr thead th .t{display:block;font-size:9.5px;font-weight:800;min-height:12px;}',
    '.pg-netrates table.nr thead th .t.lm{color:var(--accent-text);} .pg-netrates table.nr thead th .t.sp{color:var(--warn);}',
    '.pg-netrates table.nr .we{background:var(--surface-2);}',
    '.pg-netrates table.nr thead th.we{background:var(--surface-2);}',
    '.pg-netrates table.nr .lab{position:sticky;left:0;z-index:1;background:var(--surface);text-align:left;padding:6px 10px 6px 14px;border-right:1px solid var(--border-strong);min-width:150px;max-width:190px;white-space:normal;}',
    '.pg-netrates table.nr thead th.lab{z-index:3;font-size:11px;}',
    '.pg-netrates table.nr .lab .n{font-weight:800;font-size:12.5px;color:var(--text);line-height:1.25;}',
    '.pg-netrates table.nr .lab .s{font-size:10.5px;color:var(--muted);font-weight:600;margin-top:1px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;}',
    '.pg-netrates table.nr tr.tg td{background:var(--brand-soft-2);} .pg-netrates table.nr tr.tg td.lab{background:var(--brand-soft-2);}',
    '.pg-netrates table.nr tr.tg .lab{box-shadow:inset 3px 0 0 var(--brand-strong);}',
    '.pg-netrates table.nr td.c{padding:2px;}',
    '.pg-netrates table.nr td.c button{display:block;width:100%;min-width:50px;height:34px;border:1px solid transparent;border-radius:6px;background:none;font:inherit;font-weight:700;color:var(--text);padding:0 3px;cursor:pointer;}',
    '.pg-netrates table.nr td.c button:hover{border-color:var(--border-strong);}',
    '.pg-netrates table.nr td.c button.u{background:var(--bad-soft);color:var(--bad);}',
    '.pg-netrates table.nr td.c button.o{background:var(--ok-soft);color:var(--ok);}',
    '.pg-netrates table.nr td.c button.low{box-shadow:inset 0 0 0 2px var(--text);}',
    '.pg-netrates table.nr td.c button.x{background:repeating-linear-gradient(135deg,var(--bad-soft) 0 4px,transparent 4px 8px);color:var(--muted);font-weight:600;text-decoration:line-through;}',
    '.pg-netrates table.nr td.c button small{display:block;font-size:9.5px;font-weight:700;opacity:0.8;line-height:1;}',
    '.pg-netrates table.nr td.e{color:var(--faint);}',
    '.pg-netrates .nr-fees table{width:100%;border-collapse:collapse;font-size:12.5px;}',
    '.pg-netrates .nr-fees th,.pg-netrates .nr-fees td{padding:8px 12px;border-top:1px solid var(--border);text-align:left;vertical-align:top;}',
    '.pg-netrates .nr-fees th{font-size:11px;color:var(--muted);font-weight:700;border-top:none;}',
    '.pg-netrates .nr-fees th.num,.pg-netrates .nr-fees td.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}',
    '.pg-netrates .nr-fees .keep{font-weight:800;}',
    '.nr-bd{display:flex;flex-direction:column;gap:2px;font-size:13px;}',
    '.nr-bd .r{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px dashed var(--border);font-variant-numeric:tabular-nums;}',
    '.nr-bd .r span:last-child{white-space:nowrap;font-weight:700;}',
    '.nr-bd .r.neg span:last-child{color:var(--bad);}',
    '.nr-bd .r.tot{border-top:2px solid var(--text);border-bottom:none;margin-top:4px;padding-top:8px;font-weight:800;font-size:14px;}',
    '.nr-bd .r.tot span:last-child{font-weight:800;}',
    '.nr-bd .note{font-size:12px;color:var(--muted);margin-top:8px;line-height:1.5;}',
    '.nr-edit .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}',
    '.nr-edit .dl{display:grid;grid-template-columns:minmax(0,1fr) 76px 116px 32px;gap:6px;align-items:center;margin-top:6px;}',
    '.nr-edit .dl .input,.nr-edit .dl .select{min-width:0;}',
    '.nr-edit .ex{font-size:12px;color:var(--muted);margin-top:12px;line-height:1.5;background:var(--surface-2);border-radius:8px;padding:8px 10px;}',
    '@media (max-width:600px){',
    '  .pg-netrates table.nr .lab{min-width:112px;max-width:124px;padding:6px 6px 6px 10px;}',
    '  .pg-netrates table.nr .lab .n{font-size:11.5px;}',
    '  .pg-netrates table.nr thead th{min-width:48px;}',
    '  .pg-netrates table.nr td.c button{min-width:44px;font-size:11.5px;}',
    '  .pg-netrates .nr-nav input{width:132px;}',
    '  .nr-edit .dl{grid-template-columns:minmax(0,1fr) 62px 96px 30px;}',
    '}'
  ].join('\n'));

  /* ---------------- pieces ---------------- */
  function money(n, cur, dp) { return fmt.money(n, { cur: cur, dp: dp == null ? 2 : dp }); }
  function cellVal(c) { return st.show === 'guest' ? c.guest : c.net; }
  function pctTxt(x) { return x == null ? '–' : Math.round(x * 100) + '%'; }

  function tableHTML(res, dates, cur) {
    var head = '<tr><th class="lab" scope="col">' + esc(O.tpl('{x}: {y}', { x: res.tier.type.name, y: st.show === 'guest' ? 'price on the site' : 'take-home' })) + '</th>' + dates.map(function (iso) {
      var lm = lastMinute(iso) < 1, sp = res.special[iso];
      return '<th scope="col" class="' + (d.isWeekend(iso) ? 'we' : '') + '" title="' + esc(d.fmtY(iso) + (lm ? ' · last-minute deal' : '') + (sp ? ' · special night (minimum stay)' : '')) + '">' + esc(d.dowName(iso)) + '<b>' + esc(d.fmt(iso)) + '</b>' +
        '<span class="t ' + (lm ? 'lm' : sp ? 'sp' : '') + '">' + (lm ? '−' + Math.round((1 - lastMinute(iso)) * 100) + '%' : sp ? '★' : '') + '</span></th>';
    }).join('') + '</tr>';
    var body = res.rows.map(function (x, ri) {
      var r = x.r, f = feesOf(r.site);
      var sub = x.isTarget ? 'Website and walk-ins (the target)' : (O.tpl('{p} of target', { p: pctTxt(x.avg) }) + (x.under ? ' · ' + O.tpl('{n} nights under', { n: x.under }) : ''));
      var feeTxt = x.isTarget || (!f.commission && !f.discounts.length) ? '' : (f.commission + '%' + (f.discounts.length ? ' + ' + f.discounts.length + ' disc.' : ''));
      return '<tr class="' + (x.isTarget ? 'tg' : '') + '"><th scope="row" class="lab"><div class="n">' + esc(r.label) + '</div><div class="s"><span>' + esc(sub) + '</span>' + (feeTxt ? '<span title="Commission and discounts set in What each site takes">' + esc(feeTxt) + '</span>' : '') + '</div></th>' +
        dates.map(function (iso) {
          var c = x.cells[iso], we = d.isWeekend(iso) ? ' we' : '';
          if (!c) return '<td class="c e' + we + '">–</td>';
          var cls = c.closed ? 'x' : x.isTarget ? '' : c.ratio !== null && c.ratio < 0.97 ? 'u' : c.ratio !== null && c.ratio > 1.03 ? 'o' : '';
          if (!c.closed && !x.isTarget && res.low[iso] === c) cls += ' low';
          var tip = r.label + ' · ' + d.fmtY(iso) + ' · ' + money(cellVal(c), cur) + (c.closed ? ' · ' + O.tr('Closed') : '') + (c.ratio !== null && !x.isTarget ? ' · ' + O.tpl('{p} of target', { p: pctTxt(c.ratio) }) : '');
          return '<td class="c' + we + '"><button type="button" class="' + cls + '" data-cell="' + ri + '|' + iso + '" title="' + esc(tip) + '" aria-label="' + esc(tip) + '">' + fmt.num(cellVal(c)) + '</button></td>';
        }).join('') + '</tr>';
    }).join('');
    return '<div class="card"><div class="nr-wrap"><table class="nr"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div></div>';
  }

  function watchHTML(all) {
    var items = [];
    all.forEach(function (res) {
      res.rows.forEach(function (x) {
        if (x.isTarget || x.avg === null || x.avg >= 0.97) return;
        items.push({ avg: x.avg, html: esc(O.tpl('{site} ({type}) takes home {p} of your price on average, and less than your price on {n} of {m} open nights.', { site: x.r.label, type: res.tier.type.name, p: pctTxt(x.avg), n: x.under, m: x.open })) });
      });
    });
    if (!items.length) return '';
    items.sort(function (a, b) { return a.avg - b.avg; });
    return '<div class="card nr-watch"><div class="card-head"><div><h3>Under your price</h3><div class="sub">Booking sites that keep more than their markup covers on these dates. Raise the markup of the plan in Channels, or lower what the site takes.</div></div></div><ul>' +
      items.slice(0, 6).map(function (i) { return '<li>' + O.icon('alert') + '<span>' + i.html + '</span></li>'; }).join('') + '</ul></div>';
  }

  function feesHTML(sites) {
    var ed = canEdit();
    return '<div class="card nr-fees"><div class="card-head"><div><h3>What each site takes</h3><div class="sub">Used for every number above. Take them from a recent payout on each site. “Sometimes” discounts count only in Worst case.</div></div></div><div class="nr-wrap"><table><thead><tr><th>Site</th><th class="num">Commission</th><th class="num">Tax on it</th><th>Discounts</th><th class="num">Keeps of 100</th>' + (ed ? '<th></th>' : '') + '</tr></thead><tbody>' +
      sites.map(function (s) {
        var f = feesOf(s), usual = calc(100, 1, f, false).net, worst = calc(100, 1, f, true).net;
        return '<tr><td><b>' + esc(siteName(s)) + '</b>' + (isSet(s) || s === 'direct' ? '' : '<div class="xs muted">Usual rate, not checked yet</div>') + '</td><td class="num">' + f.commission + '%</td><td class="num">' + (f.tax ? f.tax + '%' : '–') + '</td><td>' +
          (f.discounts.length ? f.discounts.map(function (x) { return esc(x.name || 'Discount') + ' ' + x.pct + '%' + (x.when === 'sometimes' ? ' <span class="xs muted">(sometimes)</span>' : ''); }).join('<br>') : '<span class="muted">None</span>') +
          '</td><td class="num keep">' + fmt.num(usual, 1) + (Math.abs(worst - usual) > 0.05 ? '<div class="xs muted">' + fmt.num(worst, 1) + ' worst</div>' : '') + '</td>' +
          (ed ? '<td class="num"><button type="button" class="btn btn-ghost btn-xs" data-edit-site="' + esc(s) + '">Edit</button></td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* ---------------- dialogs ---------------- */
  function openCell(res, x, iso, cur) {
    var c = x.cells[iso], r = x.r, f = feesOf(r.site), tgt = res.target[iso];
    var rows = '<div class="r"><span>Rate Orbique sends</span><span>' + money(c.sent, cur) + '</span></div>' +
      c.steps.map(function (s) { return '<div class="r neg"><span>' + esc(s[0]) + '</span><span>' + money(s[1], cur) + '</span></div>'; }).join('') +
      '<div class="r tot"><span>You take home</span><span>' + money(c.net, cur) + '</span></div>';
    var note = (x.isTarget ? 'This is your own price for the night: what the website and walk-in guests pay.' :
      (tgt ? O.tpl(c.ratio < 0.97 ? 'Your price that night is {price}, so this is {p} of it: under your price.' : c.ratio > 1.03 ? 'Your price that night is {price}, so this is {p} of it: over your price.' : 'Your price that night is {price}, so this is {p} of it.', { price: money(tgt, cur), p: pctTxt(c.ratio) }) : '')) +
      (c.closed ? ' This plan is closed (stop sell) that night.' : '') +
      (!x.isTarget && !isSet(r.site) ? ' ' + O.tpl('The fees for {site} are the usual rate: check them against a payout in What each site takes.', { site: siteName(r.site) }) : '') +
      (!st.worst && f.discounts.some(function (y) { return y.when === 'sometimes'; }) ? ' Some guests get a “sometimes” discount too: switch to Worst case to see it.' : '') +
      (r.plan.currency && String(r.plan.currency).toUpperCase() !== String(cur).toUpperCase() ? ' ' + O.tpl('Sent in {cur} at the day’s exchange rate.', { cur: String(r.plan.currency).toUpperCase() }) : '');
    U.modal({ title: r.label + ' · ' + d.fmtY(iso), sub: res.tier.type.name + ' · ' + r.plan.name, size: 'sm', body: '<div class="nr-bd">' + rows + '<div class="note">' + esc(note) + '</div></div>' });
  }

  function editSite(site, rerender) {
    var f = feesOf(site), lines = f.discounts.map(function (x) { return { name: x.name || '', pct: x.pct, when: x.when === 'sometimes' ? 'sometimes' : 'always' }; });
    function lineHTML(x, i) {
      return '<div class="dl" data-line="' + i + '"><input class="input" data-k="name" maxlength="40" placeholder="e.g. Genius" value="' + esc(x.name) + '" aria-label="Discount name"><input class="input" data-k="pct" type="number" min="0" max="90" step="0.1" value="' + esc(x.pct) + '" aria-label="Percent off">' +
        '<select class="select" data-k="when" aria-label="When"><option value="always"' + (x.when === 'always' ? ' selected' : '') + '>Always</option><option value="sometimes"' + (x.when === 'sometimes' ? ' selected' : '') + '>Sometimes</option></select><button type="button" class="btn btn-quiet btn-xs" data-rm="' + i + '" aria-label="Remove">×</button></div>';
    }
    function body() {
      return '<div class="nr-edit"><div class="grid2"><div class="field"><label for="nr-com">Commission %</label><input id="nr-com" class="input" type="number" min="0" max="60" step="0.01" value="' + esc(f.commission) + '"><span class="hint">Of the price after discounts</span></div>' +
        '<div class="field"><label for="nr-tax">Tax on the commission %</label><input id="nr-tax" class="input" type="number" min="0" max="50" step="0.01" value="' + esc(f.tax) + '"><span class="hint">e.g. 8% SST</span></div></div>' +
        '<div class="field" style="margin-top:12px"><label>Discounts the site takes off your price</label><div data-lines>' + lines.map(lineHTML).join('') + '</div>' +
        '<button type="button" class="btn btn-ghost btn-xs" data-add style="margin-top:6px;align-self:flex-start">' + O.icon('plus') + 'Add a discount</button></div>' +
        '<div class="ex" data-ex></div></div>';
    }
    function read(el) {
      var com = num(O.$('#nr-com', el).value), tax = num(O.$('#nr-tax', el).value);
      lines = O.$$('[data-line]', el).map(function (row) { return { name: O.$('[data-k=name]', row).value.trim(), pct: num(O.$('[data-k=pct]', row).value), when: O.$('[data-k=when]', row).value }; });
      return { commission: com, tax: tax, discounts: lines };
    }
    function example(el) {
      var v = read(el), ok = v.commission !== null && v.commission >= 0 && v.commission <= 60 && (v.tax === null || (v.tax >= 0 && v.tax <= 50));
      var ex = O.$('[data-ex]', el);
      if (!ok) { ex.textContent = 'Commission is 0 to 60% and tax 0 to 50%.'; return; }
      var ff = { commission: v.commission, tax: v.tax || 0, discounts: v.discounts.filter(function (x) { return x.pct > 0 && x.pct < 100; }) };
      var a = calc(100, 1, ff, false).net, b = calc(100, 1, ff, true).net;
      ex.textContent = O.tpl(Math.abs(a - b) > 0.005 ? 'Of every 100 the site gets from Orbique, you keep {a} ({b} when the “sometimes” discounts apply).' : 'Of every 100 the site gets from Orbique, you keep {a}.', { a: fmt.num(a, 2), b: fmt.num(b, 2) }) + ' ' + O.tpl('To take home your own price, the plan needs a markup of +{p}%.', { p: fmt.num((100 / a - 1) * 100, 1) });
    }
    U.modal({
      title: O.tpl('What {site} takes', { site: siteName(site) }), size: 'sm', cls: 'nr-edit-m', body: body(),
      onOpen: function (el) {
        var box = O.$('.modal-body', el);
        box.addEventListener('input', function () { example(el); });
        box.addEventListener('click', function (e) {
          var b = e.target.closest('button'); if (!b) return;
          if (b.matches('[data-add]')) { read(el); lines.push({ name: '', pct: 10, when: 'always' }); O.$('[data-lines]', el).innerHTML = lines.map(lineHTML).join(''); example(el); }
          else if (b.matches('[data-rm]')) { read(el); lines.splice(+b.getAttribute('data-rm'), 1); O.$('[data-lines]', el).innerHTML = lines.map(lineHTML).join(''); example(el); }
        });
        example(el);
      },
      actions: [
        isSet(site) ? { label: 'Use the usual rate', onClick: function () { delete feeStore().sites[site]; stamp(); audit(O.tpl('Reset what {site} takes to the usual rate', { site: siteName(site) })); O.emit('data', { type: 'netrates' }); rerender(); } } : null,
        { label: 'Cancel' },
        { label: 'Save', kind: 'primary', onClick: function (close, el) {
          var v = read(el);
          if (v.commission === null || v.commission < 0 || v.commission > 60) { U.toast('Commission should be between 0 and 60%', 'bad'); return false; }
          if (v.tax !== null && (v.tax < 0 || v.tax > 50)) { U.toast('Tax should be between 0 and 50%', 'bad'); return false; }
          if (v.discounts.some(function (x) { return x.pct === null || x.pct <= 0 || x.pct >= 90; })) { U.toast('Each discount needs a percent between 0 and 90', 'bad'); return false; }
          feeStore().sites[site] = { commission: r2(v.commission), tax: r2(v.tax || 0), discounts: v.discounts.map(function (x) { return { name: x.name.slice(0, 40), pct: r2(x.pct), when: x.when === 'sometimes' ? 'sometimes' : 'always' }; }) };
          stamp();
          audit(O.tpl('Changed what {site} takes: {c}% commission, {t}% tax on it, {n} discounts', { site: siteName(site), c: r2(v.commission), t: r2(v.tax || 0), n: v.discounts.length }));
          O.emit('data', { type: 'netrates' }); rerender();
        } }
      ].filter(Boolean)
    });
  }
  function stamp() { var s = feeStore(); s.updatedAt = D.NOW; s.by = O.state.viewer; }
  function audit(text) { D.auditLog = D.auditLog || []; D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: 'pricing', text: text }); }

  /* ---------------- page ---------------- */
  O.page('netrates', {
    desc: 'What you take home per night on every booking site, after commission and discounts, next to your own price',
    render: function (root, ctx) {
      ctx.setActions('');
      if (!canView()) { root.innerHTML = '<div class="card"><div class="empty"><p>Net rates need the Pricing permission.</p></div></div>'; return; }
      var blds = (D.buildings || []).filter(function (b) { return !isArchived(b) && tiersOf(b.id).length; });
      if (!O.channel || !blds.length) {
        root.innerHTML = '<div class="pg-netrates"><div class="card"><div class="empty"><div class="e-icon">' + O.icon('pricing') + '</div><p style="margin:0 0 12px">Net rates show once a building has unit types with rate plans. Set them up in Channels.</p>' +
          (O.allowed('channels') ? '<button type="button" class="btn btn-primary" data-go-ch>Open Channels</button>' : '') + '</div></div></div>';
        var g = O.$('[data-go-ch]', root); if (g) g.onclick = function () { O.go('channels'); };
        return;
      }
      var p0 = ctx.params || {};
      if (ctx.fresh && p0.buildingId) st.bid = p0.buildingId;
      if (ctx.fresh && /^\d{4}-\d{2}-\d{2}$/.test(p0.from || '')) st.from = p0.from;
      ctx.fresh = false;
      if (!blds.some(function (b) { return b.id === st.bid; })) st.bid = blds[0].id;
      var T = D.TODAY, last = d.add(T, (O.channel.DAYS || 500) - 1);
      if (!st.from || st.from < T) st.from = T;
      if (st.from > last) st.from = last;
      var to = d.add(st.from, st.nights - 1); if (to > last) to = last;
      var dates = d.range(st.from, to), bd = O.building(st.bid), cur = (bd && bd.currency) || 'MYR';
      var map = O.channel.rateMap(), tiers = tiersOf(st.bid), all = tiers.map(function (t) { return compute(t, dates, map); });
      var sites = []; tiers.forEach(function (t) { t.rows.forEach(function (r) { if (sites.indexOf(r.site) < 0) sites.push(r.site); }); });
      sites.sort(function (a, b) { return SITE_ORDER.indexOf(a) - SITE_ORDER.indexOf(b); });
      var hasLM = dates.some(function (iso) { return lastMinute(iso) < 1; });

      root.innerHTML = '<div class="pg-netrates">' +
        '<div class="toolbar">' +
        (blds.length > 1 ? '<select class="select" data-bid aria-label="Building">' + blds.map(function (b) { return '<option value="' + esc(b.id) + '"' + (b.id === st.bid ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('') + '</select>' : '') +
        '<span class="nr-nav"><button type="button" class="btn btn-ghost btn-sm" data-step="-1" aria-label="Earlier dates"' + (st.from <= T ? ' disabled' : '') + '>‹</button><input type="date" class="input" data-from aria-label="First night" min="' + T + '" max="' + last + '" value="' + st.from + '"><button type="button" class="btn btn-ghost btn-sm" data-step="1" aria-label="Later dates"' + (to >= last ? ' disabled' : '') + '>›</button></span>' +
        U.seg(SPANS, st.nights, 'data-span') + U.seg(KINDS, st.kind, 'data-kind') +
        U.seg([['net', 'Take-home'], ['guest', 'Guest price']], st.show, 'data-show') +
        U.seg([['usual', 'Usual discounts'], ['worst', 'Worst case']], st.worst ? 'worst' : 'usual', 'data-worst') +
        '</div>' +
        '<div class="nr-key"><span><i class="u"></i>Under your price (by more than 3%)</span><span><i class="o"></i>Over it</span><span><i class="l"></i>Lowest that night</span><span><i class="w"></i>Fri and Sat nights</span><span><i class="c"></i>Closed</span>' +
        (hasLM ? '<span><b style="color:var(--accent-text)">−%</b> last-minute deal</span>' : '') + '<span><b style="color:var(--warn)">★</b> special night</span><span>Tap a number for the breakdown.</span></div>' +
        watchHTML(all) +
        all.map(function (res) { return tableHTML(res, dates, cur); }).join('') +
        feesHTML(sites) +
        '</div>';

      var pg = O.$('.pg-netrates', root);
      pg.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b || b.disabled) return;
        if (b.hasAttribute('data-span')) { st.nights = +b.getAttribute('data-span'); ctx.rerender(); }
        else if (b.hasAttribute('data-kind')) { st.kind = b.getAttribute('data-kind'); ctx.rerender(); }
        else if (b.hasAttribute('data-show')) { st.show = b.getAttribute('data-show'); ctx.rerender(); }
        else if (b.hasAttribute('data-worst')) { st.worst = b.getAttribute('data-worst') === 'worst'; ctx.rerender(); }
        else if (b.hasAttribute('data-step')) { var nf = d.add(st.from, +b.getAttribute('data-step') * st.nights); st.from = nf < T ? T : nf; ctx.rerender(); }
        else if (b.hasAttribute('data-edit-site')) { editSite(b.getAttribute('data-edit-site'), function () { ctx.rerender(); }); }
        else if (b.hasAttribute('data-cell')) {
          var parts = b.getAttribute('data-cell').split('|'), tbl = b.closest('table'), ti = O.$$('table.nr', pg).indexOf(tbl), res = all[ti];
          var x = res && res.rows[+parts[0]]; if (x && x.cells[parts[1]]) openCell(res, x, parts[1], cur);
        }
      });
      pg.addEventListener('change', function (e) {
        var x = e.target;
        if (x.matches('[data-bid]')) { st.bid = x.value; ctx.rerender(); }
        else if (x.matches('[data-from]') && /^\d{4}-\d{2}-\d{2}$/.test(x.value)) { st.from = x.value; ctx.rerender(); }
      });
    }
  });
})();
