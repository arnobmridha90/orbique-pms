/* Orbique Command Center v4 — Reviews
   Arnob: "Need to be able to select platform plus number of stars, for example Airbnb & Needs reply
   when selected together must show the reviews in Airbnb that need to be replied to."
   - Combinable filters: platform, reply status, stars (multi), property, date range, search.
     Every chip count reflects the other active filters. Summary sentence + clear filters.
   - v4: only two numbers at the top (Average rating, Needs reply) and a link to Statistics, where the rating trend,
     platform split, star mix and category scores now live. Side panels: by property, what low ratings mention.
   - Each review: guest, platform, stars, property, stay, linked booking, tags, sub-scores,
     reply composer with a suggested reply built from the stars, tags and text. Low ratings flagged.
   Permissions: reviews.reply (composer and edits), reviews edit level (link a booking), tasks.create (+ tasks.assign to
   assign it), inbox / bookings pages for the shortcuts. Dates are read at render time.
   Honours ctx.params: needsReply, platform, propertyId, stars. */
(function () {
  var O = window.O, D = O.data, M = O.metrics, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;

  /* ---- data fix (reported to the lead): data.js links two story reviews to the first booking with the same
     guest name, which is an older stay at another property. Re-link them to the stay at the reviewed property. */
  function relink() {
    D.reviews.forEach(function (r) {
      var b = r.bookingId && D.booking(r.bookingId);
      if (!b || (b.propertyId === r.propertyId && b.checkOut <= r.date)) return;
      var best = D.bookings.filter(function (x) { return x.guest && x.guest.name === r.guest && x.propertyId === r.propertyId && x.status !== 'cancelled' && x.checkOut <= r.date; })
        .sort(function (a, c) { return a.checkOut < c.checkOut ? 1 : -1; })[0];
      if (best) r.bookingId = best.id;
    });
  }
  relink();

  var PLATS = ['airbnb', 'booking', 'agoda', 'vrbo', 'google'];
  var SUBS = [['cleanliness', 'Cleanliness'], ['communication', 'Communication'], ['checkin', 'Check-in'], ['accuracy', 'Accuracy']];
  var PAGE = 15;
  var DEFAULT_PRESET = 'since';
  var PRESETS = ['since', 'last7', 'last30', 'mtd', 'lastMonth', 'last90', 'qtd', 'ytd'];
  /* call only at render time: the preset is turned into dates with today's date */
  function defaults() {
    var p = U.preset(DEFAULT_PRESET);
    return { platform: 'all', reply: 'all', stars: [], prop: '', q: '', from: p.from, to: p.to, preset: p.preset };
  }
  var st = { platform: 'all', reply: 'all', stars: [], prop: '', q: '', from: null, to: null, preset: DEFAULT_PRESET, sort: 'newest', shown: PAGE, drafts: {}, variant: {}, editing: {}, keep: {} };
  function syncDates() { if (st.preset) { var p = U.preset(st.preset); if (p) { st.from = p.from; st.to = p.to; } } if (!st.from || !st.to) { var dp = U.preset(DEFAULT_PRESET); st.from = dp.from; st.to = dp.to; st.preset = DEFAULT_PRESET; } }

  /* ------------------------------------------------------------------ styles */
  O.css('reviews', `
.pg-reviews{display:flex;flex-direction:column;gap:14px;}
.pg-reviews .kpis{margin-bottom:0;}
.pg-reviews .rv-head{display:flex;align-items:stretch;gap:10px;}
.pg-reviews .rv-head .kpis{flex:0 1 640px;}
.pg-reviews .rv-head .rv-statlink{display:flex;align-items:center;margin-left:auto;}
.pg-reviews .rv-head .kpi .rv-link{font-size:12px;}
.pg-reviews .rv-ro{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted);background:var(--surface-2);border:1px dashed var(--border-strong);border-radius:10px;padding:9px 12px;}
.pg-reviews .rv-ro svg{width:14px;height:14px;flex-shrink:0;}
.pg-reviews .rv-empty{text-align:center;padding:4px 16px 24px;}
.pg-reviews .kpi .k-val small{font-size:12px;font-weight:700;color:var(--muted);margin-left:3px;}
.pg-reviews .rv-filters{padding:12px 16px;display:flex;flex-direction:column;gap:10px;}
.pg-reviews .rv-frow{display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap;}
.pg-reviews .rv-fgroup{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;}
.pg-reviews .rv-fgroup .chip-group-label{min-width:62px;}
.pg-reviews .chip{min-height:32px;}
.pg-reviews .chip .plat-ic{width:16px;height:16px;font-size:9px;box-shadow:none;}
.pg-reviews .chip.on .plat-ic{box-shadow:0 0 0 1.5px var(--brand-ink);}
.pg-reviews .chip .n{font-variant-numeric:tabular-nums;}
.pg-reviews .chip.zero{opacity:0.55;}
.pg-reviews .chip.st-chip{gap:3px;}
.pg-reviews .chip.st-chip .n{margin-left:4px;}
.pg-reviews .chip.st-chip .stars{font-size:inherit;letter-spacing:0;}
.pg-reviews .chip.st-chip.on .stars{color:inherit;}
.pg-reviews .rv-tools .select{width:auto;min-width:190px;height:36px;}
.pg-reviews .rv-tools .search{flex:1;min-width:200px;max-width:340px;}
.pg-reviews .rv-tools .rv-sort{margin-left:auto;}
.pg-reviews .rv-summary{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:10px;}
.pg-reviews .rv-summary .sm-main{font-family:var(--font-head);font-size:15px;font-weight:800;}
.pg-reviews .rv-summary .sm-sub{font-size:12px;color:var(--muted);}
.pg-reviews .rv-summary .btn{margin-left:auto;}
.pg-reviews .rv-summary .sm-ic{width:28px;height:28px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;background:var(--brand-soft);color:var(--brand-strong);flex-shrink:0;}
.pg-reviews .rv-summary .sm-ic svg{width:15px;height:15px;}
.pg-reviews .rv-summary .sm-ic.warn{background:var(--warn-soft);color:var(--warn);}
.pg-reviews .rv-main{display:grid;grid-template-columns:minmax(0,1fr) 350px;gap:14px;align-items:start;}
.pg-reviews .rv-list{display:flex;flex-direction:column;gap:10px;min-width:0;}
.pg-reviews .rv-side{display:flex;flex-direction:column;gap:14px;min-width:0;}
.pg-reviews .rv-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--shadow);padding:14px 16px;min-width:0;}
.pg-reviews .rv-card.low{box-shadow:inset 3px 0 0 var(--bad),var(--shadow);}
.pg-reviews .rv-top{display:flex;gap:12px;align-items:flex-start;}
.pg-reviews .rv-who{flex:1;min-width:0;}
.pg-reviews .rv-name{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.pg-reviews .rv-name b{font-size:14px;}
.pg-reviews .rv-name .ctry{font-size:12px;color:var(--muted);}
.pg-reviews .rv-meta{font-size:12px;color:var(--muted);margin-top:3px;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;}
.pg-reviews .rv-meta .dotsep::before{content:"·";margin-right:10px;color:var(--faint);}
.pg-reviews .rv-link{background:none;border:none;padding:0;font:inherit;color:var(--brand-text);font-weight:700;cursor:pointer;}
.pg-reviews .rv-link:hover{text-decoration:underline;}
.pg-reviews .rv-right{display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;}
.pg-reviews .rv-right .stars{font-size:15px;}
.pg-reviews .rv-right .rv-date{font-size:11.5px;color:var(--muted);white-space:nowrap;}
.pg-reviews .rv-flags{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;}
.pg-reviews .rv-text{margin:10px 0 0;font-size:13.5px;line-height:1.55;color:var(--text);}
.pg-reviews .rv-tags{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px;}
.pg-reviews .rv-tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-2);}
.pg-reviews .rv-subs{display:flex;gap:4px 12px;flex-wrap:wrap;margin-left:auto;font-size:11.5px;color:var(--muted);}
.pg-reviews .rv-subs b{color:var(--text);font-variant-numeric:tabular-nums;}
.pg-reviews .rv-subs .lo b{color:var(--bad);}
.pg-reviews .rv-reply{margin-top:12px;border-top:1px dashed var(--border);padding-top:12px;}
.pg-reviews .rv-replied{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.5;}
.pg-reviews .rv-replied .rh{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--muted);font-weight:600;margin-bottom:4px;flex-wrap:wrap;}
.pg-reviews .rv-replied .rh svg{width:13px;height:13px;color:var(--ok);}
.pg-reviews .rv-replied .rh .btn{margin-left:auto;}
.pg-reviews .rv-compose .rc-head{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--text-2);margin-bottom:6px;flex-wrap:wrap;}
.pg-reviews .rv-compose .rc-head .sug{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--brand-text);background:var(--brand-soft);padding:2px 8px;border-radius:20px;}
.pg-reviews .rv-compose .rc-head .sug svg{width:12px;height:12px;}
.pg-reviews .rv-compose .rc-head .cc{margin-left:auto;font-weight:600;color:var(--faint);font-size:11px;font-variant-numeric:tabular-nums;}
.pg-reviews .rv-compose .textarea{min-height:84px;font-size:13px;overflow-y:auto;}
.pg-reviews .rv-compose .rc-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center;}
.pg-reviews .rv-compose .rc-acts .grow{min-width:8px;}
.pg-reviews .rv-after{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;margin-top:8px;}
.pg-reviews .rv-more{display:flex;justify-content:center;align-items:center;gap:10px;padding:4px 0 8px;font-size:12px;color:var(--muted);}
.pg-reviews .rv-note{font-size:11.5px;color:var(--muted);display:flex;align-items:center;gap:6px;}
.pg-reviews .rv-note svg{width:13px;height:13px;flex-shrink:0;}
/* side panels */
.pg-reviews .rv-side .card-body{padding:12px 16px;}
.pg-reviews .rv-side .card-body.flush{padding:0;}
.pg-reviews .rv-pl{display:grid;grid-template-columns:minmax(0,1fr) 64px 46px auto;gap:10px;align-items:center;padding:7px 8px;margin:0 -8px;border-radius:8px;width:calc(100% + 16px);background:none;border:none;text-align:left;font-size:12.5px;}
.pg-reviews .rv-pl:hover{background:var(--surface-2);}
.pg-reviews .rv-pl.on{background:var(--brand-soft);}
.pg-reviews .rv-pl .plat{font-size:12.5px;color:var(--text);}
.pg-reviews .rv-pl .avg{font-family:var(--font-head);font-weight:800;font-size:14px;text-align:right;font-variant-numeric:tabular-nums;}
.pg-reviews .rv-pl .cnt{font-size:11.5px;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums;}
.pg-reviews .rv-pl .nr{min-width:62px;text-align:right;}
.pg-reviews .mini-track{height:6px;border-radius:4px;background:var(--surface-2);border:1px solid var(--border);overflow:hidden;}
.pg-reviews .mini-track i{display:block;height:100%;background:var(--brand-strong);border-radius:4px;}
.pg-reviews .sd-row{display:grid;grid-template-columns:42px minmax(0,1fr) 34px 44px;gap:10px;align-items:center;padding:5px 8px;margin:0 -8px;width:calc(100% + 16px);border:none;background:none;border-radius:8px;font-size:12.5px;text-align:left;}
.pg-reviews .sd-row:hover{background:var(--surface-2);}
.pg-reviews .sd-row.on{background:var(--brand-soft);}
.pg-reviews .sd-row .lbl{font-weight:800;white-space:nowrap;}
.pg-reviews .sd-row .lbl .stars{font-size:inherit;letter-spacing:0;}
.pg-reviews .sd-row .v{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;}
.pg-reviews .sd-row .p{text-align:right;color:var(--muted);font-size:11.5px;font-variant-numeric:tabular-nums;}
.pg-reviews .sd-bar{height:10px;border-radius:3px;background:var(--surface-2);overflow:hidden;}
.pg-reviews .sd-bar i{display:block;height:100%;border-radius:0 3px 3px 0;background:var(--brand-strong);}
.pg-reviews .sd-bar i.lo{background:var(--bad);opacity:0.8;}
.pg-reviews .ss-row{display:grid;grid-template-columns:110px minmax(0,1fr) 40px 54px;gap:10px;align-items:center;padding:6px 0;font-size:12.5px;}
.pg-reviews .ss-row .lbl{font-weight:700;display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;min-width:0;}
.pg-reviews .ss-row .v{text-align:right;font-family:var(--font-head);font-weight:800;font-variant-numeric:tabular-nums;}
.pg-reviews .ss-row .dl{text-align:right;}
.pg-reviews .ss-row.weak .lbl::after{content:"Lowest";font-size:10px;font-weight:800;color:var(--warn);background:var(--warn-soft);padding:1px 6px;border-radius:10px;}
.pg-reviews .pp-table td, .pg-reviews .pp-table th{padding:7px 8px;font-size:12.5px;}
.pg-reviews .pp-table td:first-child, .pg-reviews .pp-table th:first-child{padding-left:16px;}
.pg-reviews .pp-table td:last-child, .pg-reviews .pp-table th:last-child{padding-right:16px;}
.pg-reviews .pp-table tr.on td{background:var(--brand-soft);}
.pg-reviews .pp-table .avg.lo{color:var(--bad);font-weight:800;}
.pg-reviews .pp-table td:first-child{white-space:nowrap;}
.pg-reviews .pp-table th{white-space:nowrap;}
.pg-reviews .mention{display:flex;flex-wrap:wrap;gap:6px;}
.pg-reviews .mention button{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:var(--surface);border-radius:20px;padding:4px 10px;font-size:12px;font-weight:700;color:var(--text-2);}
.pg-reviews .mention button:hover{border-color:var(--border-strong);}
.pg-reviews .mention button.on{background:var(--brand);color:var(--brand-ink);border-color:var(--brand);}
.pg-reviews .mention button .c{font-variant-numeric:tabular-nums;color:var(--bad);font-weight:800;}
.pg-reviews .mention button.on .c{color:inherit;}
.pg-reviews .side-cap{font-size:11.5px;color:var(--muted);margin-top:8px;line-height:1.45;}
@media (max-width:1180px){
  .pg-reviews .rv-main{grid-template-columns:minmax(0,1fr);}
  .pg-reviews .rv-side{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;}
}
@media (max-width:760px){
  .pg-reviews .rv-head{flex-direction:column;}
  .pg-reviews .rv-head .kpis{flex:none;}
  .pg-reviews .rv-head .rv-statlink{margin-left:0;}
  .pg-reviews .rv-side{grid-template-columns:minmax(0,1fr);}
  .pg-reviews .rv-fgroup .chip-group-label{min-width:0;width:100%;}
  .pg-reviews .rv-tools .select{min-width:0;flex:1 1 45%;}
  .pg-reviews .rv-tools .search{max-width:none;flex:1 1 100%;order:-1;}
  .pg-reviews .rv-tools .rv-sort{margin-left:0;}
  .pg-reviews .rv-tools .dr{flex:1 1 45%;}
  .pg-reviews .rv-tools .dr .dr-btn{width:100%;}
  .pg-reviews .rv-tools .dr .dr-preset{display:none;}
  .pg-reviews .rv-card{padding:12px 13px;}
  .pg-reviews .rv-top .avatar{display:none;}
  .pg-reviews .rv-subs{margin-left:0;width:100%;}
  .pg-reviews .rv-meta{gap:2px 12px;}
  .pg-reviews .rv-meta .dotsep::before{display:none;}
  .pg-reviews .rv-summary .btn{margin-left:0;}
  .pg-reviews .rv-compose .rc-acts .btn{flex:1 1 auto;}
 .pg-reviews .btn, .pg-reviews .chip, .pg-reviews .select, .pg-reviews .input, .pg-reviews .dr-btn, .pg-reviews .seg button{min-height:40px;} .pg-reviews .search{height:40px;} .pg-reviews .switch::before{content:"";position:absolute;inset:-10px -4px;}
  .pg-reviews .rv-link{padding:12px 0;margin:-12px 0;}
  .pg-reviews .mention button{min-height:40px;}
  .pg-reviews .kpi .k-sub{white-space:normal;}
}
`);

  /* ------------------------------------------------------------------ helpers */
  function prop(id) { return D.propById[id] || { id: id, name: 'Removed property', short: 'Removed property', housekeeper: null }; }
  function canReply() { return O.can('reviews.reply'); }
  var NO_REPLY = 'Replying to reviews is not part of your access. An account owner can change this in Staff Access.';
  function staffName(id) { var s = D.staffById(id); return s ? s.name : 'Team'; }
  var SURNAME_FIRST = ['Tan', 'Lim', 'Zhang', 'Chen', 'Wang', 'Kim', 'Nguyen', 'Wong', 'Goh', 'Khoo', 'Koh', 'Ong', 'Lee'];
  function greetName(name) {
    if (/^The /.test(name)) return name.replace(/^The /, '').replace(/ Family$/, ' family');
    var parts = name.split(' ');
    return SURNAME_FIRST.indexOf(parts[0]) >= 0 ? name : parts[0];
  }
  function starLabel(n) { return n + (n === 1 ? ' star' : ' stars'); }
  function listJoin(arr) { return arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' or ' + arr[arr.length - 1]; }
  function age(r) { return d.diff(r.date, D.TODAY); }
  function ageText(n) { return n === 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago'; }
  function convFor(r) { return r.bookingId ? D.conversations.filter(function (c) { return c.bookingId === r.bookingId; })[0] : null; }
  function taskFor(r) { return r.taskId ? D.tasks.filter(function (t) { return t.id === r.taskId; })[0] : null; }
  function avg(list, f) { return list.length ? list.reduce(function (s, x) { return s + f(x); }, 0) / list.length : null; }
  function isDefault() {
    var dft = defaults();
    return st.platform === dft.platform && st.reply === dft.reply && !st.stars.length && !st.prop && !st.q && st.from === dft.from && st.to === dft.to;
  }

  /* one filter, with the option to ignore one dimension (so chip counts reflect the OTHER active filters) */
  function match(r, skip) {
    if (r.date < st.from || r.date > st.to) return false;
    if (skip !== 'platform' && st.platform !== 'all' && r.platform !== st.platform) return false;
    if (skip !== 'reply' && st.reply === 'needs' && r.reply) return false;
    if (skip !== 'reply' && st.reply === 'replied' && !r.reply) return false;
    if (skip !== 'stars' && st.stars.length && st.stars.indexOf(r.stars) < 0) return false;
    if (skip !== 'prop' && st.prop && r.propertyId !== st.prop) return false;
    if (st.q) {
      var q = st.q.toLowerCase(), b = r.bookingId ? r.bookingId.toLowerCase() : '';
      if ((r.guest + ' ' + r.text + ' ' + r.tags.join(' ') + ' ' + prop(r.propertyId).name).toLowerCase().indexOf(q) < 0 && b.indexOf(q) < 0) return false;
    }
    return true;
  }
  /* the KPI / analysis scope: dates + property + platform (reply and star filters only narrow the list) */
  function inScope(r, from, to, opts) {
    opts = opts || {};
    if (r.date < from || r.date > to) return false;
    if (!opts.allPlatforms && st.platform !== 'all' && r.platform !== st.platform) return false;
    if (!opts.allProps && st.prop && r.propertyId !== st.prop) return false;
    return true;
  }
  function sortList(list) {
    var s = st.sort;
    return list.slice().sort(function (a, b) {
      if (s === 'oldest') return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      if (s === 'lowest') return a.stars - b.stars || (a.date < b.date ? 1 : -1);
      if (s === 'highest') return b.stars - a.stars || (a.date < b.date ? 1 : -1);
      if (s === 'waiting') { /* a review replied to a moment ago keeps its place until the filters change */
        var wa = a.reply && !st.keep[a.id] ? 1 : 0, wb = b.reply && !st.keep[b.id] ? 1 : 0;
        if (wa !== wb) return wa - wb; if (!wa && a.stars !== b.stars) return a.stars - b.stars; return a.date < b.date ? -1 : 1; }
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
  }

  /* ------------------------------------------------------------------ suggested replies */
  var FIXES = [
    [/hot water/i, 'The water heater has been replaced and we now check it before every arrival.', 'Our technician is checking the water heater on {due}, and we will test it before every arrival.'],
    [/air ?con|\bAC\b/i, 'Our technician has replaced the air conditioning unit in that bedroom, and we now test it before every arrival.', 'Our technician is fixing the air conditioning in that bedroom on {due}, and we will test it before every arrival.'],
    [/door code|could not get in/i, 'We now test every door code remotely before it is sent, and someone from our team is on call during arrival times.'],
    [/hair|dust|needed a better clean|not as clean/i, 'We went through the clean with our housekeeping team and added a supervisor check before every arrival.'],
    [/wi-?fi/i, 'We have upgraded the router so the Wi-Fi stays connected.', 'We are upgrading the router on {due} so the Wi-Fi stays connected.'],
    [/parking/i, 'We have added photos to our parking instructions so the bay is easier to find.'],
    [/towel/i, 'We have since replaced the towels with a thicker hotel-grade set.'],
    [/lockbox|took a while to find/i, 'We have added a short video to the check-in guide that shows exactly where to go.'],
    [/street noise|noise/i, 'We have added blackout curtains and earplugs to help with the street noise.'],
    [/lift/i, 'We have passed your comment about the lifts to the building management.'],
    [/bigger|photos make/i, 'We have updated the listing photos and floor size so they match the space.']
  ];
  var TAG_FIX = { Maintenance: 'Our maintenance team has fixed the problem and added it to our pre-arrival checklist.', Cleanliness: 'We went through the clean with our housekeeping team and added a supervisor check before every arrival.', Noise: 'We have added blackout curtains and earplugs to help with noise at night.', 'Check-in': 'We have made our check-in steps clearer.', 'Door code': 'We now test every door code remotely before it is sent.', Parking: 'We have added photos to our parking instructions so the bay is easier to find.' };
  var PRAISE = { Cleanliness: ['and found it spotless', 'We will pass your kind words to our housekeeping team.'], 'Check-in': ['and that check-in went smoothly', 'We work hard to make arrival easy, so this is great to hear.'], Location: ['and its location', 'It really is a great base for exploring.'], Communication: ['and found us easy to reach', 'Our team is always a message away.'], Guidebook: ['and the guidebook tips', 'We are glad the local recommendations were useful.'], Value: ['and found it good value', 'We keep our rates fair all week.'] };
  function fixesFor(r) {
    var out = [], task = taskFor(r), open = task && task.status !== 'done';
    /* while the linked task is still open, say what is booked instead of claiming it is already fixed */
    var planned = function (f) { return (f[2] || 'Our team is fixing this on {due}, and we have added it to our pre-arrival checklist.').replace('{due}', d.fmt(task.due.slice(0, 10))); };
    FIXES.forEach(function (f) { var t = open && !out.length ? planned(f) : f[1]; if (out.length < 2 && f[0].test(r.text) && out.indexOf(t) < 0) out.push(t); });
    if (!out.length) r.tags.forEach(function (t) { if (out.length < 2 && TAG_FIX[t] && out.indexOf(TAG_FIX[t]) < 0) out.push(TAG_FIX[t]); });
    return out;
  }
  function suggest(r, v) {
    var name = greetName(r.guest), p = prop(r.propertyId).name, team = 'The ' + O.ws().name + ' team';
    v = v || 0;
    if (r.stars >= 5) {
      var pr = r.tags.map(function (t) { return PRAISE[t]; }).filter(Boolean)[0];
      if (v % 2 === 0) return 'Hi ' + name + ', thank you for the lovely review! We are so glad you enjoyed ' + p + (pr ? ' ' + pr[0] : '') + '. You are welcome back any time.\n\n' + team;
      return 'Thank you, ' + name + '! Reviews like this make our day. ' + (pr ? pr[1] + ' ' : '') + 'We hope to host you at ' + p + ' again soon.\n\n' + team;
    }
    var fx = fixesFor(r);
    if (r.stars === 4) {
      if (v % 2 === 0) return 'Hi ' + name + ', thank you for staying at ' + p + ' and for the helpful feedback. ' + (fx.length ? fx.join(' ') + ' ' : '') + 'We hope to welcome you back soon.\n\n' + team;
      return 'Thanks for the four stars, ' + name + '! ' + (fx.length ? 'You are right to mention it: ' + fx[0].charAt(0).toLowerCase() + fx[0].slice(1) + ' ' : 'We are glad you enjoyed the stay. ') + 'We would love to host you again.\n\n' + team;
    }
    if (v % 2 === 0) return 'Hi ' + name + ', thank you for telling us, and we are sorry this affected your stay at ' + p + '. ' + (fx.length ? fx.join(' ') + ' ' : 'We have shared your feedback with the team and are fixing it. ') + 'If you stay with us again, message us directly and we will make it right.\n\n' + team;
    return name + ', we are sorry we let you down on this stay. ' + (fx.length ? fx.join(' ') + ' ' : 'Your feedback has gone straight to the team responsible. ') + 'Thank you for the honest review, it helps us get better.\n\n' + team;
  }

  /* ------------------------------------------------------------------ pieces */
  function chip(attr, val, label, n, on, extra) {
    return '<button type="button" class="chip' + (extra || '') + (on ? ' on' : '') + (n === 0 && !on ? ' zero' : '') + '" ' + attr + '="' + esc(val) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + label + ' <span class="n">' + n + '</span></button>';
  }
  function filtersHTML() {
    var base = D.reviews;
    var pc = base.filter(function (r) { return match(r, 'platform'); });
    var plat = chip('data-plat', 'all', 'All', pc.length, st.platform === 'all') + PLATS.map(function (p) {
      return chip('data-plat', p, U.platIcon(p) + esc(U.platName(p)), pc.filter(function (r) { return r.platform === p; }).length, st.platform === p);
    }).join('');
    var rc = base.filter(function (r) { return match(r, 'reply'); });
    var nNeeds = rc.filter(function (r) { return !r.reply; }).length;
    var reply = chip('data-reply', 'all', 'All', rc.length, st.reply === 'all') + chip('data-reply', 'needs', 'Needs reply', nNeeds, st.reply === 'needs') + chip('data-reply', 'replied', 'Replied', rc.length - nNeeds, st.reply === 'replied');
    var sc = base.filter(function (r) { return match(r, 'stars'); });
    var stars = [5, 4, 3, 2, 1].map(function (n) {
      return chip('data-star', n, '<b>' + n + '</b><span class="stars" aria-hidden="true">★</span>', sc.filter(function (r) { return r.stars === n; }).length, st.stars.indexOf(n) >= 0, ' st-chip').replace('aria-pressed', 'aria-label="' + starLabel(n) + '" aria-pressed');
    }).join('');
    return '<div class="card rv-filters">' +
      '<div class="rv-frow"><div class="rv-fgroup"><span class="chip-group-label">Platform</span><div class="chips">' + plat + '</div></div></div>' +
      '<div class="rv-frow"><div class="rv-fgroup"><span class="chip-group-label">Reply</span><div class="chips">' + reply + '</div></div>' +
      '<div class="rv-fgroup"><span class="chip-group-label">Stars</span><div class="chips">' + stars + '</div></div></div>' +
      '<div class="rv-frow rv-tools">' +
      '<label class="sr-only" for="rv-prop">Property</label><select id="rv-prop" class="select" data-f="prop">' + U.propOptions(st.prop, { all: 'All properties' }) + '</select>' +
      '<span data-slot="dr"></span>' +
      '<div class="search">' + O.icon('search') + '<input type="search" data-f="q" placeholder="Search guest, words, booking ID" aria-label="Search reviews" value="' + esc(st.q) + '"></div>' +
      '<label class="sr-only" for="rv-sort">Sort</label><select id="rv-sort" class="select rv-sort" data-f="sort">' + [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['waiting', 'Needs reply first'], ['lowest', 'Lowest rating first'], ['highest', 'Highest rating first']].map(function (o) { return '<option value="' + o[0] + '"' + (st.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '</div>' + summaryHTML() + '</div>';
  }
  function summaryHTML() {
    var list = D.reviews.filter(function (r) { return match(r); });
    var n = list.length, one = n === 1;
    var s = (n ? n : 'No') + ' ' + (st.platform !== 'all' ? U.platName(st.platform) + ' ' : '') + (one ? 'review' : 'reviews');
    if (st.prop) s += ' for ' + prop(st.prop).name;
    if (st.stars.length) { var ss = st.stars.slice().sort(function (a, b) { return a - b; }); s += ' with ' + listJoin(ss.map(String)) + (ss.length === 1 && ss[0] === 1 ? ' star' : ' stars'); }
    if (st.reply === 'needs') s += one ? ' needs a reply' : ' need a reply';
    if (st.reply === 'replied') s += one ? ' has a reply' : ' have a reply';
    var sub = 'Left ' + U.rangeLabel(st.from, st.to);
    if (st.q) sub += ' · matching "' + st.q + '"';
    if (st.reply !== 'needs') { var nr = list.filter(function (r) { return !r.reply; }).length; if (nr) sub += ' · ' + nr + ' need' + (nr === 1 ? 's' : '') + ' a reply'; }
    var low = list.filter(function (r) { return r.stars <= 3; }).length; if (low) sub += ' · ' + low + ' rated 3 stars or lower';
    var warn = st.reply === 'needs' && n > 0;
    return '<div class="rv-summary" aria-live="polite"><span class="sm-ic' + (warn ? ' warn' : '') + '">' + O.icon(warn ? 'chat' : 'filter') + '</span><div class="grow"><div class="sm-main">' + esc(s) + '</div><div class="sm-sub">' + esc(sub) + '</div></div>' +
      (isDefault() ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-act="clear">' + O.icon('x') + 'Clear filters</button>') + '</div>';
  }

  function scopeLabel() {
    var bits = [];
    if (st.platform !== 'all') bits.push(U.platName(st.platform));
    if (st.prop) bits.push(prop(st.prop).short);
    return bits.length ? ' · ' + bits.join(', ') : '';
  }
  /* change shown in absolute units (rating points, percentage points) rather than percent of percent */
  function absDelta(diff, dp, unit) {
    var flat = Math.abs(diff) < Math.pow(10, -dp) / 2;
    return '<span class="delta ' + (flat ? 'flat' : diff > 0 ? 'good' : 'bad') + '">' + (flat ? '' : diff > 0 ? '▲ ' : '▼ ') + Math.abs(diff).toFixed(dp) + unit + '</span>';
  }
  function kpisHTML() {
    var len = d.diff(st.from, st.to) + 1, pFrom = d.add(st.from, -len), pTo = d.add(st.from, -1);
    var cur = D.reviews.filter(function (r) { return inScope(r, st.from, st.to); });
    var prev = D.reviews.filter(function (r) { return inScope(r, pFrom, pTo); });
    var a = avg(cur, function (r) { return r.stars; }), pa = avg(prev, function (r) { return r.stars; });
    var needs = cur.filter(function (r) { return !r.reply; });
    var lowNeeds = needs.filter(function (r) { return r.stars <= 3; }).length;
    var oldest = needs.reduce(function (m, r) { return Math.max(m, age(r)); }, 0);
    var stats = O.allowed('statistics') ? '<div class="rv-statlink"><button type="button" class="btn btn-quiet btn-sm" data-act="stats">' + O.icon('statistics') + 'See statistics</button></div>' : '';
    return '<div class="rv-head">' + U.kpis([
      { label: 'Average rating' + scopeLabel(), value: a == null ? '–' : a.toFixed(2) + '<small>/ 5</small>', sub: prev.length && a != null && pa ? absDelta(a - pa, 2, '') + ' vs previous ' + fmt.plural(len, 'day') + ' · ' + fmt.plural(cur.length, 'review') : 'from ' + fmt.plural(cur.length, 'review'), hl: true, title: 'Reply and star filters narrow the list only. This covers the platform, property and dates you picked.' },
      { label: 'Needs reply', value: String(needs.length), sub: needs.length ? (lowNeeds ? lowNeeds + ' low rated · ' : '') + 'oldest ' + fmt.plural(oldest, 'day') + (st.reply !== 'needs' ? ' · <button type="button" class="rv-link" data-reply="needs">Show them</button>' : '') : 'All caught up' }
    ]) + stats + '</div>';
  }

  function reviewHTML(r) {
    var p = prop(r.propertyId), b = r.bookingId ? D.booking(r.bookingId) : null, low = r.stars <= 3, a = age(r);
    var conv = convFor(r), task = taskFor(r);
    var flags = [];
    if (!r.reply) flags.push(U.pill('Needs reply · waiting ' + (a === 0 ? 'since today' : fmt.plural(a, 'day')), a >= 3 || low ? 'bad' : 'warn'));
    if (low) flags.push(U.pill(r.stars <= 2 ? 'Low rating' : 'Below average', 'bad'));
    if (task) flags.push('<span class="pill info" title="' + esc(task.title) + '">Task ' + esc(task.id) + ': ' + esc(task.title.replace(/ \(.*\)$/, '')) + ' · ' + esc(task.status === 'done' ? 'done' : task.assigneeId ? staffName(task.assigneeId) : 'unassigned') + '</span>');
    var minSub = Math.min.apply(null, SUBS.map(function (s) { return r.sub[s[0]]; }));
    var subs = '<div class="rv-subs" aria-label="Category scores">' + SUBS.map(function (s) { var v = r.sub[s[0]]; return '<span class="' + (v <= 3 && v === minSub ? 'lo' : '') + '">' + s[1] + ' <b>' + v + '</b></span>'; }).join('') + '</div>';
    var canBk = O.allowed('bookings'), canLink = O.can('reviews', 'edit'), canTask = O.can('tasks.create'), canChat = O.allowed('inbox');
    var meta = '<span>' + esc(p.name) + '</span>' +
      (b ? '<span class="dotsep">Stayed ' + esc(d.fmtRange(b.checkIn, b.checkOut)) + ' · ' + fmt.plural(b.nights, 'night') + '</span><span class="dotsep">' + (canBk ? '<button type="button" class="rv-link" data-open="' + esc(b.id) + '" aria-label="Open booking ' + esc(b.id) + '">' + esc(b.id) + '</button>' : esc(b.id)) + '</span>'
        : '<span class="dotsep">Not linked to a booking</span>' + (canLink ? '<span class="dotsep"><button type="button" class="rv-link" data-act="link" data-id="' + r.id + '">Link booking</button></span>' : ''));
    var taskBtn = low && !task && canTask ? '<button type="button" class="btn btn-ghost btn-sm" data-act="task" data-id="' + r.id + '">' + O.icon('tasks') + 'Create follow-up task</button>' : '';
    var chatBtn = conv && canChat ? '<button type="button" class="btn btn-ghost btn-sm" data-act="chat" data-id="' + r.id + '">' + O.icon('chat') + 'Message guest</button>' : '';
    var reply;
    if (r.reply && !st.editing[r.id]) {
      reply = '<div class="rv-replied"><div class="rh">' + O.icon('check') + '<span>Replied by ' + esc(staffName(r.reply.by)) + ' on ' + esc(d.fmt(r.reply.date)) + (r.reply.date === r.date ? ' (same day)' : ' (' + fmt.plural(d.diff(r.date, r.reply.date), 'day') + ' after the review)') + '</span>' + (canReply() ? '<button type="button" class="btn btn-quiet btn-xs" data-act="edit" data-id="' + r.id + '">' + O.icon('edit') + 'Edit reply</button>' : '') + '</div>' + esc(r.reply.text).replace(/\n/g, '<br>') + '</div>' +
        (low && (taskBtn || chatBtn) ? '<div class="rv-after">' + taskBtn + chatBtn + '</div>' : '');
    } else if (!canReply()) {
      reply = '<div class="rv-ro">' + O.icon('lock') + '<span>No reply yet. ' + esc(NO_REPLY) + '</span></div>' + (taskBtn || chatBtn ? '<div class="rv-after">' + taskBtn + chatBtn + '</div>' : '');
    } else {
      var text = st.drafts[r.id] != null ? st.drafts[r.id] : (r.reply ? r.reply.text : suggest(r, st.variant[r.id] || 0));
      var isSug = st.drafts[r.id] == null && !r.reply;
      reply = '<div class="rv-compose"><div class="rc-head"><label for="rv-t-' + r.id + '">' + (r.reply ? 'Edit your public reply on ' : 'Public reply on ') + esc(U.platName(r.platform)) + '</label>' +
        (isSug ? '<span class="sug">' + O.icon('sparkle') + 'Suggested from the rating and what ' + esc(greetName(r.guest)) + ' wrote</span>' : '') + '<span class="cc" data-cc="' + r.id + '">' + text.length + ' characters</span></div>' +
        '<textarea class="textarea" id="rv-t-' + r.id + '" data-draft="' + r.id + '" rows="4">' + esc(text) + '</textarea>' +
        '<div class="rc-acts"><button type="button" class="btn btn-primary btn-sm" data-act="post" data-id="' + r.id + '"' + (st.busy === r.id ? ' disabled' : '') + '>' + O.icon('send') + (st.busy === r.id ? 'Posting…' : r.reply ? 'Update reply' : 'Post reply') + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="another" data-id="' + r.id + '">' + O.icon('refresh') + 'Another suggestion</button>' +
        (r.reply ? '<button type="button" class="btn btn-ghost btn-sm" data-act="canceledit" data-id="' + r.id + '">Cancel</button>' : '') +
        '<span class="grow"></span>' +
        taskBtn + chatBtn +
        '</div></div>';
    }
    return '<article class="rv-card' + (low ? ' low' : '') + '" data-rv="' + r.id + '">' +
      '<div class="rv-top">' + U.avatar(r.guest) + '<div class="rv-who"><div class="rv-name"><b>' + esc(r.guest) + '</b><span class="ctry">' + esc(D.countryName[r.country] || r.country) + '</span>' + U.plat(r.platform) + '</div>' +
      '<div class="rv-meta">' + meta + '</div></div>' +
      '<div class="rv-right">' + U.stars(r.stars) + '<span class="rv-date">' + esc(d.fmtY(r.date)) + ' · ' + esc(ageText(a)) + '</span></div></div>' +
      (flags.length ? '<div class="rv-flags">' + flags.join('') + '</div>' : '') +
      '<p class="rv-text">' + esc(r.text) + '</p>' +
      '<div class="rv-tags">' + r.tags.map(function (t) { return '<span class="rv-tag">' + esc(t) + '</span>'; }).join('') + subs + '</div>' +
      '<div class="rv-reply">' + reply + '</div></article>';
  }

  function listHTML() {
    var list = sortList(D.reviews.filter(function (r) { return match(r) || (st.keep[r.id] && match(r, 'reply')); }));
    if (!list.length) {
      var msg = st.reply === 'needs' ? 'Nothing is waiting for a reply with these filters.' : 'No reviews match these filters.';
      return '<div class="card">' + U.empty(msg, st.reply === 'needs' ? '✓' : '∅') + '<div class="center" style="padding:0 0 18px">' + (isDefault() ? '<button type="button" class="btn btn-ghost" data-act="alldates">Show all dates</button>' : '<button type="button" class="btn btn-ghost" data-act="clear">Clear filters</button>') + '</div></div>';
    }
    var shown = list.slice(0, st.shown);
    return shown.map(reviewHTML).join('') +
      (list.length > shown.length ? '<div class="rv-more"><span>Showing ' + shown.length + ' of ' + list.length + '</span><button type="button" class="btn btn-ghost btn-sm" data-act="more">Show ' + Math.min(PAGE, list.length - shown.length) + ' more</button><button type="button" class="btn btn-quiet btn-sm" data-act="all">Show all</button></div>'
        : '<div class="rv-more"><span>All ' + fmt.plural(list.length, 'review') + ' shown</span></div>') +
      '<div class="rv-note">' + O.icon('alert') + 'Replies are saved here. Posting them to Airbnb, Booking.com, Agoda, Vrbo and Google is not connected in this version.</div>';
  }

  function propertyPanel() {
    var scope = D.reviews.filter(function (r) { return inScope(r, st.from, st.to, { allProps: true }); });
    var rows = D.properties.map(function (p) {
      var l = scope.filter(function (r) { return r.propertyId === p.id; });
      return { p: p, n: l.length, a: avg(l, function (r) { return r.stars; }), nr: l.filter(function (r) { return !r.reply; }).length };
    }).filter(function (x) { return x.n; }).sort(function (a, b) { return a.a - b.a; });
    var all = avg(scope, function (r) { return r.stars; });
    return '<div class="card"><div class="card-head"><div><h3>By property</h3><div class="sub">' + (all != null ? 'Lowest first. Red is below your ' + all.toFixed(2) + ' average. Select one to filter.' : 'Lowest average first. Select one to filter.') + '</div></div></div><div class="card-body flush"><div class="table-wrap"><table class="table pp-table"><thead><tr><th>Property</th><th class="num">Avg</th><th class="num">Reviews</th><th class="num">To reply</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (x) {
        return '<tr class="click' + (st.prop === x.p.id ? ' on' : '') + '" data-prop="' + x.p.id + '" tabindex="0"><td><span class="row-flex"><span class="prop-dot" style="background:' + U.propColor(x.p.id) + '"></span>' + esc(x.p.short) + '</span></td><td class="num avg' + (all != null && x.a < all - 0.005 ? ' lo' : '') + '">' + x.a.toFixed(2) + '</td><td class="num">' + x.n + '</td><td class="num">' + (x.nr ? '<b>' + x.nr + '</b>' : '<span class="muted">0</span>') + '</td></tr>';
      }).join('') : '<tr><td colspan="4">' + U.empty('No reviews in this range') + '</td></tr>') + '</tbody></table></div></div></div>';
  }
  function mentionPanel() {
    var scope = D.reviews.filter(function (r) { return inScope(r, st.from, st.to) && r.stars <= 3; });
    var counts = {};
    scope.forEach(function (r) { r.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    var tags = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    return '<div class="card"><div class="card-head"><div><h3>What low ratings mention</h3><div class="sub">Tags on reviews of 3 stars or lower</div></div></div><div class="card-body">' +
      (tags.length ? '<div class="mention">' + tags.map(function (t) { var on = st.q.toLowerCase() === t.toLowerCase(); return '<button type="button" class="' + (on ? 'on' : '') + '" data-tag="' + esc(t) + '" aria-pressed="' + on + '">' + esc(t) + ' <span class="c">' + counts[t] + '</span></button>'; }).join('') + '</div>' +
        '<div class="side-cap">' + esc(tags[0]) + ' comes up most often. Select a tag to read those reviews' + (O.can('tasks.create') ? ', and use "Create follow-up task" on a review to get it fixed' : '') + '.</div>'
        : U.empty('No reviews of 3 stars or lower in this range', '✓')) + '</div></div>';
  }

  /* ------------------------------------------------------------------ actions */
  function findReview(id) { return D.reviews.filter(function (r) { return r.id === id; })[0]; }
  var ctx0 = null;
  function post(r, text) {
    if (!canReply()) { U.toast(NO_REPLY, 'bad'); return; }
    text = (text || '').trim();
    if (text.length < 10) { U.toast('Write a reply of at least 10 characters first', 'bad'); return; }
    var was = !!r.reply;
    /* a review that came from a booking site through Channex: the reply is posted there first (api/messages.js) */
    if (r.cx && O.auth && O.auth.inbox && O.sync.adapter && O.sync.adapter.name === 'server') {
      if (st.busy) return;
      st.busy = r.id; ctx0 && ctx0.rerender && ctx0.rerender();
      O.auth.inbox('review-reply', { reviewId: r.id, text: text }).then(function (res) {
        if (res && res.review) O.sync.remote([{ coll: 'reviews', id: res.review.id, data: res.review.data, deleted: false }], []);
        delete st.drafts[r.id]; delete st.editing[r.id];
        if (st.reply === 'needs') st.keep[r.id] = true;
        U.toast((was ? 'Reply updated on ' : 'Reply posted on ') + U.platName(r.platform) + ' for ' + r.guest);
      }, function (e) { U.toast(e.message || 'The reply was not posted. Please try again.', 'bad'); }).then(function () { st.busy = null; if (ctx0 && ctx0.rerender) ctx0.rerender(); });
      return;
    }
    r.reply = { text: text, date: D.TODAY, by: O.state.viewer };
    delete st.drafts[r.id]; delete st.editing[r.id];
    if (st.reply === 'needs') st.keep[r.id] = true; /* stays on screen (as replied) until the filters change */
    U.toast((was ? 'Reply updated on ' : 'Reply posted on ') + U.platName(r.platform) + ' for ' + r.guest);
    O.emit('data', { type: 'review', id: r.id });
  }
  /* what a follow-up task is called and who gets it, from what the guest wrote: [pattern, title, type, who] */
  var TASK_FOR = [
    [/hot water/i, 'Check the water heater', 'Maintenance', 'maint'],
    [/air ?con|\bAC\b/i, 'Service the air conditioning', 'Maintenance', 'maint'],
    [/door code|could not get in/i, 'Test the door lock and code', 'Maintenance', 'maint'],
    [/wi-?fi/i, 'Fix the Wi-Fi connection', 'Maintenance', 'maint'],
    [/hair|dust|better clean|not as clean/i, 'Deep clean and supervisor check', 'Turnover', 'clean'],
    [/towel/i, 'Replace the towels with a thicker set', 'Restock', 'clean'],
    [/noise/i, 'Add blackout curtains and earplugs', 'Restock', 'clean'],
    [/parking/i, 'Add photos to the parking instructions', 'Inspection', 'ops'],
    [/lockbox|took a while to find/i, 'Make the lockbox easier to find', 'Inspection', 'ops'],
    [/bigger|photos make/i, 'Update listing photos and floor size', 'Inspection', 'ops'],
    [/lift/i, 'Raise slow lifts with building management', 'Inspection', 'ops']
  ];
  /* an open task at the same unit that already covers what the guest complained about */
  function coveringTask(r) {
    var hit = TASK_FOR.filter(function (x) { return x[0].test(r.text); })[0];
    if (!hit) return null;
    return D.tasks.filter(function (t) { return t.propertyId === r.propertyId && t.status !== 'done' && t.due.slice(0, 10) >= r.date && hit[0].test(t.title + ' ' + (t.note || '')); })[0] || null;
  }
  function createTask(r) {
    if (!O.can('tasks.create')) { U.toast('Creating tasks is not part of your access', 'bad'); return; }
    var cover = coveringTask(r);
    if (cover) {
      r.taskId = cover.id;
      U.toast('Task ' + cover.id + ' (' + cover.title + ') already covers this at ' + prop(r.propertyId).short + '. It is now linked to the review.');
      O.emit('data', { type: 'review', id: r.id });
      return;
    }
    var hit = TASK_FOR.filter(function (x) { return x[0].test(r.text); })[0];
    var tags = r.tags.join(' ');
    var who = hit ? hit[3] : /Maintenance|Door code/.test(tags) ? 'maint' : /Cleanliness/.test(tags) ? 'clean' : 'ops';
    var maint = who === 'maint', clean = who === 'clean';
    var p = prop(r.propertyId);
    var roleStaff = function (role, fb) { var x = D.staff.filter(function (s) { return s.role === role; })[0]; return x ? x.id : fb; };
    var assignee = maint ? roleStaff('maintenance', null) : clean ? p.housekeeper : roleStaff('ops', null);
    if (assignee && !D.staffById(assignee)) assignee = null;
    if (assignee && assignee !== O.state.viewer && !O.can('tasks.assign')) assignee = null; /* only people who may assign tasks give them to someone else */
    var title = (hit ? hit[1] : maint ? 'Fix the issue from a guest review' : clean ? 'Deep clean after a low review' : 'Follow up on a guest review') + ' (' + starLabel(r.stars) + ' on ' + U.platName(r.platform) + ')';
    var t = {
      id: O.uid('T'), title: title, type: hit ? hit[2] : maint ? 'Maintenance' : clean ? 'Turnover' : 'Inspection',
      propertyId: D.propById[r.propertyId] ? r.propertyId : null, assigneeId: assignee, due: d.add(D.TODAY, 1) + 'T12:00', priority: r.stars <= 2 ? 'high' : 'medium', status: 'todo', createdAt: D.NOW, createdBy: O.state.viewer, reviewId: r.id,
      note: U.platName(r.platform) + ' review by ' + r.guest + ' (' + starLabel(r.stars) + '): "' + (r.text.length > 110 ? r.text.slice(0, 107) + '…' : r.text) + '"'
    };
    D.tasks.push(t); r.taskId = t.id;
    U.toast(assignee ? 'Task created for ' + p.short + ' and assigned to ' + staffName(assignee) + '. They were notified on WhatsApp.' : 'Task created for ' + p.short + '. It is waiting for someone to pick it up.');
    O.emit('data', { type: 'task', id: t.id });
  }
  /* reviews that arrive without a reservation code (Google, or a platform that did not share it) can be matched by hand */
  function linkBooking(r) {
    if (!O.can('reviews', 'edit')) { U.toast('Your access does not include changing reviews', 'bad'); return; }
    var opts = D.bookings.filter(function (b) { return b.propertyId === r.propertyId && b.status !== 'cancelled' && b.checkOut <= r.date && b.checkOut >= d.add(r.date, -21); })
      .sort(function (a, b) { return a.checkOut < b.checkOut ? 1 : -1; });
    if (!opts.length) { U.toast('No stays at ' + prop(r.propertyId).short + ' ended in the three weeks before this review', 'bad'); return; }
    var same = opts.filter(function (b) { return b.channel === r.platform || (r.platform === 'google' && b.channel === 'direct'); });
    U.modal({
      title: 'Link review to a booking', sub: U.platName(r.platform) + ' review by ' + r.guest + ' on ' + d.fmtY(r.date) + ' · ' + prop(r.propertyId).name,
      body: '<div class="stack"><div class="field"><label for="rv-lb">Stay</label><select id="rv-lb" class="select">' + opts.map(function (b) {
        return '<option value="' + b.id + '"' + (same[0] && same[0].id === b.id ? ' selected' : '') + '>' + esc(b.guest.name) + ' · ' + esc(d.fmtRange(b.checkIn, b.checkOut)) + ' · ' + esc(U.platName(b.channel)) + ' · ' + esc(b.id) + '</option>';
      }).join('') + '</select><div class="hint">Stays at this unit that ended in the three weeks before the review, latest first.</div></div></div>',
      actions: [{ label: 'Cancel' }, { label: 'Link booking', kind: 'primary', onClick: function (close, el) {
        var id = O.$('#rv-lb', el).value, lb = D.booking(id); r.bookingId = id;
        U.toast('Review linked to ' + id + (lb && lb.guest ? ' (' + lb.guest.name + ')' : ''));
        O.emit('data', { type: 'review', id: r.id });
      } }]
    });
  }
  function exportCSV() {
    var list = sortList(D.reviews.filter(function (r) { return match(r); }));
    var rows = [['Date', 'Guest', 'Country', 'Property', 'Platform', 'Stars', 'Cleanliness', 'Communication', 'Check-in', 'Accuracy', 'Tags', 'Booking', 'Review', 'Replied', 'Reply date', 'Replied by', 'Reply']];
    list.forEach(function (r) {
      rows.push([r.date, r.guest, D.countryName[r.country] || r.country, prop(r.propertyId).name, U.platName(r.platform), r.stars, r.sub.cleanliness, r.sub.communication, r.sub.checkin, r.sub.accuracy, r.tags.join('; '), r.bookingId || '', r.text, r.reply ? 'Yes' : 'No', r.reply ? r.reply.date : '', r.reply ? staffName(r.reply.by) : '', r.reply ? r.reply.text : '']);
    });
    O.downloadCSV('reviews-' + st.from + '-to-' + st.to + '.csv', rows);
  }

  /* ------------------------------------------------------------------ page */
  O.page('reviews', {
    desc: 'Every platform in one place: filter, reply and spot what to fix',
    render: function (root, ctx) {
      ctx0 = ctx;
      var pr = ctx.params || {};
      syncDates();
      relink();
      if (st.prop && (!D.propById[st.prop] || !O.inView(st.prop))) st.prop = '';
      /* low reviews waiting for a reply get linked to an open task that already covers the problem */
      D.reviews.forEach(function (r) { if (!r.taskId && !r.reply && r.stars <= 3) { var c = coveringTask(r); if (c) r.taskId = c.id; } });
      if (ctx.fresh && (pr.needsReply || pr.platform || pr.propertyId || pr.stars)) {
        Object.assign(st, defaults(), { shown: PAGE, keep: {} });
        if (pr.needsReply) { st.reply = 'needs'; st.sort = 'waiting'; }
        if (pr.platform && PLATS.indexOf(pr.platform) >= 0) st.platform = pr.platform;
        if (pr.propertyId && D.propById[pr.propertyId]) st.prop = pr.propertyId;
        if (pr.stars) st.stars = [].concat(pr.stars).map(Number).filter(function (n) { return n >= 1 && n <= 5; });
        ctx.params = {};
      }
      if (!D.reviews.length) { /* nothing yet (new workspace): one sentence plus the main action */
        ctx.setActions('');
        var noProps = !D.properties.length, canAdd = noProps ? O.can('properties.create') : O.allowed('bookings');
        root.innerHTML = '<div class="pg-reviews"><div class="card rv-empty">' + U.empty('Reviews from Airbnb, Booking.com, Agoda, Vrbo and Google show up here after your guests stay.', '★') +
          (canAdd ? '<button type="button" class="btn btn-primary" data-go="' + (noProps ? 'properties' : 'bookings') + '">' + (noProps ? O.icon('plus') + 'Add your first property' : 'See bookings') + '</button>' : '') + '</div></div>';
        O.$('.pg-reviews', root).addEventListener('click', function (e) { var g = e.target.closest('[data-go]'); if (g) O.go(g.dataset.go); });
        return;
      }
      var acts = ctx.setActions('<button type="button" class="btn btn-ghost btn-sm" data-top="csv">' + O.icon('download') + 'Export CSV</button>');
      O.$('[data-top=csv]', acts).onclick = exportCSV;
      O.$('[data-top=csv]', acts).title = 'Download the reviews that match the current filters';

      root.innerHTML = '<div class="pg-reviews">' + kpisHTML() + filtersHTML() +
        '<div class="rv-main"><div class="rv-list">' + listHTML() + '</div><aside class="rv-side" aria-label="Review analysis">' + propertyPanel() + mentionPanel() + '</aside></div></div>';
      var page = O.$('.pg-reviews', root);

      U.mount(page, 'dr', U.dateRange({
        from: st.from, to: st.to, preset: st.preset, presets: PRESETS,
        onChange: function (r) { st.from = r.from; st.to = r.to; st.preset = r.preset; st.shown = PAGE; st.keep = {}; ctx.rerender(); }
      }));

      function autosize(t) { t.style.height = 'auto'; t.style.height = Math.min(320, t.scrollHeight + 2) + 'px'; }
      O.$$('textarea[data-draft]', page).forEach(autosize);
      function refilter() { st.shown = PAGE; st.keep = {}; ctx.rerender(); }
      page.addEventListener('click', function (e) {
        var x;
        if ((x = e.target.closest('[data-plat]'))) { var v = x.dataset.plat; st.platform = st.platform === v && v !== 'all' ? 'all' : v; refilter(); return; }
        if ((x = e.target.closest('[data-reply]'))) { st.reply = x.dataset.reply; if (st.reply === 'needs' && st.sort === 'newest') st.sort = 'waiting'; if (st.reply !== 'needs' && st.sort === 'waiting') st.sort = 'newest'; refilter(); return; }
        if ((x = e.target.closest('[data-star]'))) { var n = +x.dataset.star, i = st.stars.indexOf(n); if (i >= 0) st.stars.splice(i, 1); else st.stars.push(n); refilter(); return; }
        if ((x = e.target.closest('[data-prop]'))) { st.prop = st.prop === x.dataset.prop ? '' : x.dataset.prop; refilter(); return; }
        if ((x = e.target.closest('[data-tag]'))) { st.q = st.q.toLowerCase() === x.dataset.tag.toLowerCase() ? '' : x.dataset.tag; refilter(); return; }
        if ((x = e.target.closest('[data-open]'))) { O.booking.open(x.dataset.open); return; }
        if (!(x = e.target.closest('[data-act]'))) return;
        var act = x.dataset.act, r = x.dataset.id ? findReview(x.dataset.id) : null;
        if (act === 'stats') { O.go('statistics', { tab: 'reviews' }); return; }
        if (act === 'alldates') { st.preset = 'since'; syncDates(); st.shown = PAGE; st.keep = {}; ctx.rerender(); return; }
        if (act === 'clear') { var keepSort = st.sort; Object.assign(st, defaults(), { shown: PAGE, keep: {}, sort: keepSort === 'waiting' ? 'newest' : keepSort }); ctx.rerender(); return; }
        if (act === 'more') { st.shown += PAGE; ctx.rerender(); return; }
        if (act === 'all') { st.shown = 9999; ctx.rerender(); return; }
        if (!r) return;
        var ta = O.$('[data-draft="' + r.id + '"]', page);
        if (act === 'post') post(r, ta ? ta.value : '');
        if (act === 'another') {
          st.variant[r.id] = (st.variant[r.id] || 0) + 1; delete st.drafts[r.id];
          if (ta) { ta.value = suggest(r, st.variant[r.id]); autosize(ta); st.drafts[r.id] = ta.value; var cc = O.$('[data-cc="' + r.id + '"]', page); if (cc) cc.textContent = ta.value.length + ' characters'; ta.focus(); }
        }
        if (act === 'edit') { st.editing[r.id] = true; ctx.rerender(); var t2 = O.$('[data-draft="' + r.id + '"]', root); if (t2) t2.focus(); }
        if (act === 'canceledit') { delete st.editing[r.id]; delete st.drafts[r.id]; ctx.rerender(); }
        if (act === 'task') createTask(r);
        if (act === 'link') linkBooking(r);
        if (act === 'chat') { var c = convFor(r); if (c) O.go('inbox', { bookingId: c.bookingId }); }
      });
      page.addEventListener('keydown', function (e) {
        var tr = e.target.closest('tr[data-prop]');
        if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tr.click(); }
      });
      page.addEventListener('input', function (e) {
        var t = e.target;
        if (t.dataset.draft) { autosize(t); st.drafts[t.dataset.draft] = t.value; var cc = O.$('[data-cc="' + t.dataset.draft + '"]', page); if (cc) cc.textContent = t.value.length + ' characters'; return; }
        if (t.dataset.f === 'q') {
          clearTimeout(st._qt);
          var pos = t.selectionStart;
          st._qt = setTimeout(function () { st.q = t.value.trim(); st.shown = PAGE; st.keep = {}; ctx.rerender(); var s = O.$('[data-f=q]', root); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch (er) {} } }, 250);
        }
      });
      page.addEventListener('change', function (e) {
        var t = e.target;
        if (t.dataset.f === 'prop') { st.prop = t.value; refilter(); }
        if (t.dataset.f === 'sort') { st.sort = t.value; ctx.rerender(); }
      });
    }
  });
})();
