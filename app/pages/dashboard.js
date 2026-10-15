/* Orbique PMS v4 — Dashboard
   "A glimpse of the whole scenario, immediately important things only."
   Hero: greeting, date and time, a one-line summary, the "Brief me" read-aloud button, one money line (dashboard.money).
   Cards: same-day bookings, check-ins today (readiness), check-outs today (turnover), in-house guests,
   today's open and overdue tasks, and "needs attention" (unread messages, reviews to answer, inventory alerts).
   Everything analytical lives in Statistics (O.go('statistics')).
   O.dashboardBrief() returns the spoken brief as an array of sentences, built from the same model the page renders,
   so the brief says exactly what this viewer's dashboard shows. */
(function () {
  var O = window.O, D = O.data, M = O.metrics, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  var st = { more: {}, brief: null };          /* UI state that survives re-renders */
  var B = { run: 0, reading: false, dirty: false, ctx: null, page: null, timer: null }; /* read-aloud runtime */
  var CAP = { arrivals: 6, tasks: 6, inhouse: 4 };

  O.css('dashboard', `
.pg-dashboard{display:flex;flex-direction:column;gap:14px;max-width:1320px;}
.pg-dashboard svg.ico{width:14px;height:14px;flex-shrink:0;}

/* hero */
.pg-dashboard .dsh-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px 24px;align-items:center;padding:18px 20px;background:linear-gradient(120deg,var(--brand-soft-2),var(--surface) 62%);}
.pg-dashboard .dsh-date{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--muted);}
.pg-dashboard .dsh-hero h2{font-size:22px;font-weight:800;margin-top:3px;line-height:1.2;}
.pg-dashboard .dsh-sum{margin:5px 0 0;font-size:13.5px;color:var(--text-2);line-height:1.5;max-width:720px;}
.pg-dashboard .dsh-brief-btn{min-height:50px;padding:10px 22px;font-size:15px;border-radius:12px;gap:9px;box-shadow:0 2px 8px rgba(16,24,40,.12);}
.pg-dashboard .dsh-brief-btn svg{width:20px;height:20px;}
.pg-dashboard .dsh-hero-foot{grid-column:1 / -1;display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;padding-top:12px;border-top:1px solid var(--border);font-size:13px;color:var(--text-2);}
.pg-dashboard .dsh-money{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;}
.pg-dashboard .dsh-money b{font-family:var(--font-head);font-size:16px;font-weight:800;color:var(--text);font-variant-numeric:tabular-nums;}
.pg-dashboard .dsh-links{display:flex;gap:4px;margin-left:auto;flex-wrap:wrap;}
.pg-dashboard .dsh-links .btn{min-height:36px;}

/* brief panel */
.pg-dashboard .dsh-brief{border-color:var(--brand-strong);box-shadow:inset 0 3px 0 var(--brand-strong),var(--shadow);overflow:hidden;}
.pg-dashboard .dsh-brief .card-head{background:var(--brand-soft-2);}
.pg-dashboard .dsh-brief .card-head h3{display:flex;align-items:center;gap:8px;}
.pg-dashboard .dsh-brief-acts{display:flex;gap:6px;flex-wrap:wrap;}
.pg-dashboard .dsh-brief-acts .btn{min-height:36px;}
.pg-dashboard .dsh-eq{display:inline-flex;align-items:flex-end;gap:2px;height:14px;}
.pg-dashboard .dsh-eq i{display:block;width:3px;height:5px;border-radius:2px;background:var(--brand-strong);}
.pg-dashboard .dsh-eq.on i{animation:dsh-eq 0.9s ease-in-out infinite;}
.pg-dashboard .dsh-eq.on i:nth-child(2){animation-delay:.15s;} .pg-dashboard .dsh-eq.on i:nth-child(3){animation-delay:.3s;} .pg-dashboard .dsh-eq.on i:nth-child(4){animation-delay:.45s;}
@keyframes dsh-eq{0%,100%{height:4px;}50%{height:14px;}}
.pg-dashboard .dsh-tr{font-size:15.5px;line-height:1.65;color:var(--text);max-width:860px;}
.pg-dashboard .dsh-tr p{margin:0 0 10px;}
.pg-dashboard .dsh-tr p:last-child{margin-bottom:0;}
.pg-dashboard .dsh-brief .card-head h3 svg.ico{width:16px;height:16px;color:var(--brand-strong);}
.pg-dashboard .dsh-s{border-radius:5px;transition:background-color .2s,color .2s,box-shadow .2s;-webkit-box-decoration-break:clone;box-decoration-break:clone;}
.pg-dashboard .dsh-tr.reading .dsh-s{color:var(--muted);}
.pg-dashboard .dsh-tr.reading .dsh-s.past{color:var(--text-2);}
.pg-dashboard .dsh-tr .dsh-s.on{color:var(--text);background:var(--brand-soft);box-shadow:0 0 0 3px var(--brand-soft);}
.pg-dashboard .dsh-brief .note{margin-bottom:12px;}

/* layout */
.pg-dashboard .dsh-main{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,1fr);gap:14px;align-items:start;}
.pg-dashboard .dsh-col{display:flex;flex-direction:column;gap:14px;min-width:0;}
.pg-dashboard .card-head .hd{min-width:0;flex:1 1 200px;}
.pg-dashboard .card-head h3 .n{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--surface-2);color:var(--text-2);box-shadow:inset 0 0 0 1px var(--border);font-size:11px;font-weight:800;margin-left:7px;vertical-align:1px;}
.pg-dashboard .card-head h3 .n.hot{background:var(--accent);color:var(--accent-ink);box-shadow:none;}
.pg-dashboard .card-head .btn{min-height:34px;}

/* rows */
.pg-dashboard .dsh-r{display:grid;grid-template-columns:78px minmax(0,1fr) auto;gap:4px 12px;align-items:start;padding:10px 16px;border-bottom:1px solid var(--border);}
.pg-dashboard .dsh-r:last-child{border-bottom:none;}
.pg-dashboard .dsh-r[data-row]{cursor:pointer;}
.pg-dashboard .dsh-r[data-row]:hover{background:var(--surface-2);}
.pg-dashboard .dsh-tm b{display:block;font-size:13px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap;}
.pg-dashboard .dsh-tm span{display:block;font-size:11.5px;color:var(--muted);margin-top:1px;line-height:1.3;}
.pg-dashboard .dsh-tm span.bad{color:var(--bad);font-weight:700;}
.pg-dashboard .dsh-tm span.warn{color:var(--warn);font-weight:700;}
.pg-dashboard .dsh-nm{display:flex;align-items:center;gap:4px 7px;flex-wrap:wrap;font-size:13.5px;font-weight:700;min-width:0;}
.pg-dashboard .dsh-nm .u{font-size:12px;font-weight:500;color:var(--muted);}
.pg-dashboard .dsh-link{background:none;border:none;padding:0;font:inherit;font-weight:700;color:var(--text);text-align:left;cursor:pointer;}
.pg-dashboard .dsh-link:hover{color:var(--brand-text);text-decoration:underline;}
.pg-dashboard .dsh-sb{font-size:12px;color:var(--muted);margin-top:2px;line-height:1.4;}
.pg-dashboard .dsh-sb.warn{color:var(--warn);font-weight:700;}
.pg-dashboard .dsh-r .ready{margin-top:5px;}
.pg-dashboard .dsh-act{display:flex;gap:6px;align-items:center;justify-content:flex-end;}
.pg-dashboard .dsh-act .btn{min-height:34px;}
.pg-dashboard .dsh-r.sd{box-shadow:inset 3px 0 0 var(--accent);}
.pg-dashboard .dsh-r.od{box-shadow:inset 3px 0 0 var(--bad);}
.pg-dashboard .dsh-r .select{padding:5px 28px 5px 8px;font-size:12px;width:auto;max-width:100%;margin-top:5px;}
.pg-dashboard .select.unassigned{border-color:var(--warn);background-color:var(--warn-soft);color:var(--warn);font-weight:700;}
.pg-dashboard .dsh-more{display:block;width:100%;min-height:42px;border:none;border-top:1px solid var(--border);background:none;font:inherit;font-size:12.5px;font-weight:700;color:var(--brand-text);cursor:pointer;}
.pg-dashboard .dsh-more:hover{background:var(--surface-2);}
.pg-dashboard .dsh-quiet{padding:12px 16px;font-size:12.5px;color:var(--muted);}
.pg-dashboard .dsh-sameday{border-color:var(--accent);box-shadow:inset 0 3px 0 var(--accent),var(--shadow);overflow:hidden;}
.pg-dashboard .dsh-sameday > .card-head{background:var(--accent-soft);}

/* in-house */
.pg-dashboard .dsh-ih{display:flex;align-items:center;gap:10px;padding:9px 16px;border-bottom:1px solid var(--border);min-height:44px;}
.pg-dashboard .dsh-ih:last-child{border-bottom:none;}
.pg-dashboard .dsh-ih[data-row]{cursor:pointer;}
.pg-dashboard .dsh-ih[data-row]:hover{background:var(--surface-2);}
.pg-dashboard .dsh-ih .g{flex:1;min-width:0;font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pg-dashboard .dsh-ih .g span{font-weight:500;color:var(--muted);font-size:12px;}
.pg-dashboard .dsh-ih .w{font-size:12px;color:var(--text-2);white-space:nowrap;}

/* needs attention */
.pg-dashboard .dsh-al{display:flex;align-items:center;gap:11px;width:100%;background:none;border:none;border-bottom:1px solid var(--border);padding:10px 16px;text-align:left;min-height:54px;font:inherit;color:var(--text);cursor:pointer;}
.pg-dashboard .dsh-al:last-child{border-bottom:none;}
.pg-dashboard .dsh-al:hover{background:var(--surface-2);}
.pg-dashboard .dsh-al .ai{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.pg-dashboard .dsh-al .ai svg{width:16px;height:16px;}
.pg-dashboard .dsh-al .ai.bad{background:var(--bad-soft);color:var(--bad);}
.pg-dashboard .dsh-al .ai.warn{background:var(--warn-soft);color:var(--warn);}
.pg-dashboard .dsh-al .ai.info{background:var(--info-soft);color:var(--info);}
.pg-dashboard .dsh-al .tx{flex:1;min-width:0;}
.pg-dashboard .dsh-al .at{display:block;font-weight:700;font-size:13px;}
.pg-dashboard .dsh-al .as{display:block;font-size:12px;color:var(--muted);margin-top:1px;line-height:1.4;}
.pg-dashboard .dsh-al .chev{width:14px;height:14px;color:var(--faint);flex-shrink:0;transform:rotate(-90deg);}

/* empty workspace */
.pg-dashboard .dsh-welcome{padding:26px 24px;display:grid;grid-template-columns:minmax(0,1fr);gap:18px;}
.pg-dashboard .dsh-welcome h2{font-size:24px;font-weight:800;}
.pg-dashboard .dsh-welcome p{margin:6px 0 0;font-size:14px;color:var(--text-2);line-height:1.55;max-width:640px;}
.pg-dashboard .dsh-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;}
.pg-dashboard .dsh-step{border:1px solid var(--border);border-radius:12px;padding:14px;background:var(--surface);display:flex;flex-direction:column;gap:8px;align-items:flex-start;}
.pg-dashboard .dsh-step .k{width:26px;height:26px;border-radius:50%;background:var(--brand-soft);color:var(--brand-text);font-weight:800;font-size:12.5px;display:flex;align-items:center;justify-content:center;}
.pg-dashboard .dsh-step b{font-size:14px;}
.pg-dashboard .dsh-step .tx{font-size:12.5px;color:var(--muted);line-height:1.45;flex:1;}
.pg-dashboard .dsh-step .k{flex:none;}
.pg-dashboard .dsh-step .btn{min-height:40px;}

@media (max-width:1100px){
  .pg-dashboard .dsh-main{grid-template-columns:minmax(0,1fr);}
  .pg-dashboard .dsh-col{display:contents;}
}
@media (max-width:760px){
  .pg-dashboard .dsh-steps{grid-template-columns:minmax(0,1fr);}
}
@media (max-width:560px){
  .pg-dashboard{gap:12px;}
  .pg-dashboard .dsh-hero{grid-template-columns:minmax(0,1fr);padding:16px;gap:12px;}
  .pg-dashboard .dsh-hero h2{font-size:20px;}
  .pg-dashboard .dsh-sum{font-size:13px;}
  .pg-dashboard .dsh-brief-btn{width:100%;min-height:52px;}
  .pg-dashboard .dsh-hero-foot{padding-top:10px;}
  .pg-dashboard .dsh-links{margin-left:-8px;}
  .pg-dashboard .dsh-links .btn, .pg-dashboard .dsh-brief-acts .btn, .pg-dashboard .card-head .btn{min-height:40px;}
  .pg-dashboard .dsh-r{grid-template-columns:62px minmax(0,1fr);padding:10px 14px;}
  .pg-dashboard .dsh-act{grid-column:2;justify-content:flex-start;margin-top:4px;}
  .pg-dashboard .dsh-act .btn, .pg-dashboard .dsh-r .select{min-height:40px;}
  .pg-dashboard .dsh-r.tk{grid-template-columns:62px minmax(0,1fr) auto;}
  .pg-dashboard .dsh-r.tk .dsh-act{grid-column:auto;margin-top:0;}
  .pg-dashboard .dsh-r.tk .dsh-act .btn{width:42px;min-height:42px;padding:0;}
  .pg-dashboard .dsh-r.tk .dsh-act .btn svg{width:17px;height:17px;}
  .pg-dashboard .dsh-r.tk .dsh-act .lbl{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}
  .pg-dashboard .dsh-ih, .pg-dashboard .dsh-al{padding-left:14px;padding-right:14px;}
  .pg-dashboard .dsh-tr{font-size:15px;}
  .pg-dashboard .dsh-welcome{padding:20px 16px;}
  .pg-dashboard .dsh-welcome h2{font-size:21px;}
}
@media (prefers-reduced-motion: reduce){
  .pg-dashboard .dsh-eq.on i{animation:none;height:10px;}
  .pg-dashboard .dsh-s{transition:none;}
}
`);

  /* ------------------------------------------------------------------ small helpers */
  var DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  function words(n) { return n >= 0 && n <= 12 && n === Math.floor(n) ? WORDS[n] : String(n); }
  function count(n, one, many) { return words(n) + ' ' + (n === 1 ? one : (many || one + 's')); }
  function cap(s) { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); }
  function andList(a) { return a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function mins(iso) { return Date.parse(iso.slice(0, 16) + ':00Z') / 6e4; } /* 'YYYY-MM-DDTHH:MM' -> minutes */
  function dur(m) { m = Math.max(0, Math.round(m)); var h = Math.floor(m / 60), r = m % 60; return h ? h + 'h' + (r ? ' ' + r + 'm' : '') : r + 'm'; }
  function firstName(name) { var w = String(name || '').trim().split(/\s+/); return w.length > 2 ? w.slice(0, -1).join(' ') : (w[0] || 'there'); } /* 'Mei Fen Lim' -> 'Mei Fen' */
  function prop(pid) { return D.propById[pid] || { short: pid ? 'Removed unit' : 'General', name: pid ? 'Removed unit' : 'General' }; }
  function staffName(id) { var s = id && D.staffById(id); return s ? s.name : 'Unassigned'; }
  function byKey(k) { return function (a, b) { return a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0; }; }
  function live(b) { return b && b.status !== 'cancelled'; }
  /* 'HH:MM' -> 'noon', '3 PM', '10:15 AM' (reads well on screen and aloud) */
  function sayTime(hm) {
    if (!hm) return ''; hm = hm.length > 5 ? hm.slice(11, 16) : hm;
    var h = +hm.slice(0, 2), m = hm.slice(3, 5);
    if (m === '00' && h === 12) return 'noon';
    if (m === '00' && h === 0) return 'midnight';
    return ((h % 12) || 12) + (m === '00' ? '' : ':' + m) + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  function partOfDay() { var h = +String(D.NOW_TIME || '09:00').slice(0, 2); return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 18 ? 'afternoon' : 'evening'; }
  function longDate(iso) { return DAYS_LONG[d.dow(iso)] + ' ' + d.day(iso) + ' ' + d.monthName(iso, true); }
  function sayDate(iso) { return DAYS_LONG[d.dow(iso)] + ' the ' + ord(d.day(iso)) + ' of ' + d.monthName(iso, true); }
  function pctWord(c) { return Math.round(Math.abs(c) * 100); }
  function safe(fn, dflt) { try { var v = fn(); return v == null ? dflt : v; } catch (e) { return dflt; } }

  /* inventory alerts come from O.inventory (pages/inventory.js); used only when it is there */
  function invList(kind) {
    var inv = O.inventory; if (!inv || typeof inv[kind] !== 'function') return [];
    var a = safe(function () { return inv[kind](); }, []);
    return Array.isArray(a) ? a.filter(Boolean) : [];
  }
  function invName(x) {
    var id = x.itemId || x.id, it = id && D.itemById ? D.itemById[id] : null;
    return x.name || (it && it.name) || (id && O.inventory && O.inventory.itemName ? safe(function () { return O.inventory.itemName(id); }, '') : '') || '';
  }

  /* ------------------------------------------------------------------ the model: what this viewer's dashboard shows */
  function model() {
    var t = D.TODAY, now = D.NOW, v = O.viewer() || { id: O.state.viewer, name: 'there' };
    var m = { t: t, now: now, time: D.NOW_TIME, viewer: v, first: firstName(v.name), empty: !D.properties.length };
    var p = m.perm = {
      stays: O.can('bookings') || O.can('calendar'), openBooking: O.can('bookings'),
      tasks: O.can('tasks'), others: O.can('tasks.others'), taskEdit: O.can('tasks', 'edit'), assign: O.can('tasks.assign'), create: O.can('tasks.create'),
      inbox: O.can('inbox'), reviews: O.can('reviews'), inventory: O.can('inventory') && !!O.inventory, /* alerts only once pages/inventory.js has loaded */
      channels: !!O.channel && (O.can('channels') || O.can('bookings')), /* double bookings, bookings without a unit, sending problems */
      invManage: O.can('inventory.in') || O.can('inventory.adjust') || O.can('inventory.items'), /* overuse is for the people who buy and count stock */
      money: O.can('dashboard.money'), brief: O.can('dashboard.readAloud'),
      stats: O.allowed ? O.allowed('statistics') : O.can('statistics'),
      addProperty: O.can('properties.create'), invite: O.can('staff.invite')
    };
    m.arrivals = []; m.sameDay = []; m.departures = []; m.inHouse = []; m.allArrivals = []; m.gone = []; m.nextArrival = null;
    m.ready = { noClean: [], prep: [], id: [] };
    if (p.stays) {
      D.bookings.forEach(function (b) {
        if (!live(b) || !b.createdAt || b.createdAt > now) return; /* nothing booked "later today" yet */
        if (b.checkIn === t) (b.createdAt.slice(0, 10) === t ? m.sameDay : m.arrivals).push(b);
        else if (b.checkOut === t) m.departures.push(b);
        else if (b.checkIn < t && b.checkOut > t) m.inHouse.push(b);
      });
      m.arrivals.sort(byKey('checkInTime')); m.sameDay.sort(byKey('checkInTime'));
      m.departures.sort(byKey('checkOutTime')); m.inHouse.sort(byKey('checkOut'));
      m.allArrivals = m.sameDay.concat(m.arrivals).sort(byKey('checkInTime'));
      /* what still stands between each arrival and a ready unit (the same chips the rows show) */
      m.allArrivals.forEach(function (b) {
        var rd = safe(function () { return O.readiness(b); }, []), clean = rd.filter(function (x) { return x.key === 'clean'; })[0];
        if (clean && clean.label === 'No clean booked') m.ready.noClean.push(b);
        else if (clean && clean.state !== 'ok') m.ready.prep.push(b);
        if (!b.idVerified) m.ready.id.push(b);
      });
      m.nextArrival = m.allArrivals.filter(function (b) { return (b.checkInTime || '15:00') > m.time; })[0] || null;
      m.gone = m.departures.filter(function (b) { return b.status === 'checked_out' || (b.checkOutTime || '11:00') <= m.time; });
    }
    m.tasks = []; m.overdue = []; m.unassigned = [];
    if (p.tasks) {
      m.tasks = D.tasks.filter(function (x) {
        return x && x.status !== 'done' && x.due && x.due.slice(0, 10) <= t && (p.others || x.assigneeId === v.id);
      }).sort(function (a, b) {
        var ao = a.due.slice(0, 10) < t ? 0 : 1, bo = b.due.slice(0, 10) < t ? 0 : 1;
        return ao - bo || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
      });
      m.overdue = m.tasks.filter(function (x) { return x.due.slice(0, 10) < t; });
      m.unassigned = p.others ? m.tasks.filter(function (x) { return !x.assigneeId; }) : [];
    }
    m.unread = 0; m.unreadChats = 0; m.latestChat = null;
    if (p.inbox) D.conversations.forEach(function (c) {
      if (!c || !c.unread) return; m.unread += c.unread; m.unreadChats++;
      var last = c.messages && c.messages[c.messages.length - 1];
      if (last && (!m.latestChat || (last.time || '') > (m.latestChat.time || ''))) m.latestChat = { time: last.time || '', bookingId: c.bookingId };
    });
    m.needReply = p.reviews ? D.reviews.filter(function (r) { return r && !r.reply; }) : [];
    m.lowReviews = m.needReply.filter(function (r) { return r.stars <= 3; });
    m.low = p.inventory ? invList('low') : [];
    m.overuse = p.inventory && p.invManage ? invList('overuse') : [];
    m.money = p.money && !m.empty ? moneyLine(t) : null;
    return m;
  }
  /* revenue earned from the 1st to today vs the same days last month (the one money figure on the dashboard) */
  function moneyLine(t) {
    var ms = d.monthStart(t), day = d.day(t), pms = d.addMonths(ms, -1), pme = d.monthEnd(pms);
    var pto = d.add(pms, Math.min(day, d.day(pme)) - 1);
    var cur = M.revenue(ms, t), prev = M.revenue(pms, pto);
    return { cur: cur, prev: prev, from: ms, to: t, pfrom: pms, pto: pto, mon: d.monthName(t, true), pmon: d.monthName(pms, true), change: prev ? (cur - prev) / prev : null };
  }
  function moneyPhrase(mm) {
    if (mm.change == null) return '';
    var p = pctWord(mm.change);
    return p === 0 ? 'about the same as the same days in ' + mm.pmon : p + '% ' + (mm.change > 0 ? 'above' : 'below') + ' the same days in ' + mm.pmon;
  }

  /* ------------------------------------------------------------------ the brief (read aloud) */
  function briefSentences(m) {
    var s = [], p = m.perm;
    s.breaks = []; /* where a new topic starts: the panel shows each topic as its own short paragraph */
    function topic() { if (s.length && s.breaks.indexOf(s.length) < 0) s.breaks.push(s.length); }
    s.push('Good ' + partOfDay() + ', ' + m.first + '.');
    s.push('It\'s ' + sayDate(m.t) + ', ' + sayTime(m.time) + '.');
    if (m.empty) {
      topic();
      s.push('Your workspace is ready, but it has no properties yet.');
      s.push(p.addProperty ? 'Add your first property, then your bookings, and I\'ll brief you on each day from here.' : 'Once your properties and bookings are added, I\'ll brief you on each day from here.');
      return s;
    }
    if (p.stays) {
      topic();
      var nA = m.allArrivals.length, nS = m.sameDay.length;
      if (!nA) s.push('No guests arrive today.');
      else {
        s.push(cap(count(nA, 'guest arrives', 'guests arrive')) + ' today' + (nS ? (nS === nA ? (nA === 1 ? ', a same-day booking.' : ', all same-day bookings.') : ', including ' + count(nS, 'same-day booking') + '.') : '.'));
        if (m.nextArrival) {
          var at = m.nextArrival.checkInTime, next = m.allArrivals.filter(function (b) { return b.checkInTime === at; });
          s.push('Next up, at ' + sayTime(at) + ': ' + (next.length <= 2 ? andList(next.map(function (b) { return b.guest.name + ' at ' + prop(b.propertyId).short; })) : count(next.length, 'guest')) + '.');
        }
        var r = m.ready;
        if (r.noClean.length) s.push(r.noClean.length <= 2 ? andList(r.noClean.map(function (b) { return prop(b.propertyId).short; })) + (r.noClean.length === 1 ? ' has' : ' have') + ' no clean booked yet.' : cap(count(r.noClean.length, 'unit')) + ' have no clean booked yet.');
        if (r.prep.length) s.push('Unit prep is still under way for ' + (r.prep.length === nA ? (nA === 1 ? 'that stay' : nA === 2 ? 'both' : 'all ' + words(nA)) : words(r.prep.length)) + (r.prep.length === nA && nA > 1 ? ' of them.' : r.prep.length === nA ? '.' : ' of them.'));
        if (r.id.length) s.push((r.id.length <= 3 ? andList(r.id.map(function (b) { return b.guest.name; })) : cap(count(r.id.length, 'guest'))) + ' still ' + (r.id.length === 1 ? 'needs' : 'need') + ' to verify their ID.');
        if (!r.noClean.length && !r.prep.length && !r.id.length) s.push(nA === 1 ? 'Their unit is ready.' : 'Every arrival is ready.');
      }
      var nD = m.departures.length, nG = m.gone.length;
      if (!nD) s.push('No one checks out today.');
      else s.push(cap(count(nD, 'guest checks out', 'guests check out')) + ' today' + (nG === nD ? (nD === 1 ? ', and has already left.' : nD === 2 ? ', and both have already left.' : ', and all of them have already left.') : nG ? ', and ' + words(nG) + (nG === 1 ? ' has' : ' have') + ' already left.' : '.'));
      if (m.inHouse.length) s.push(cap(count(m.inHouse.length, 'other guest is', 'other guests are')) + ' staying on tonight.');
    }
    if (p.tasks) {
      topic();
      var n = m.tasks.length, od = m.overdue.length, first = m.tasks[0];
      if (!p.others) {
        if (!n) s.push('You have no open tasks today.');
        else {
          s.push('You have ' + count(n, 'open task') + ' today' + (od ? (od === n ? (n === 1 ? ', and it\'s overdue.' : ', all overdue.') : ', ' + words(od) + ' of them overdue.') : '.'));
          s.push((n === 1 ? cap(taskWhen(first, m)) : 'First up, ' + taskWhen(first, m)) + ': ' + taskPhrase(first) + '.');
        }
      } else {
        if (!n) s.push('There are no open tasks today.');
        else {
          s.push('There ' + (n === 1 ? 'is ' : 'are ') + count(n, 'open task') + ' today' + (od ? ', ' + words(od) + ' overdue from earlier.' : '.'));
          if (od && od <= 2) s.push('Overdue: ' + andList(m.overdue.map(function (x) { return taskPhrase(x); })) + '.');
          if (m.unassigned.length) s.push(cap(words(m.unassigned.length)) + (m.unassigned.length === 1 ? ' is' : ' are') + ' not assigned to anyone yet.');
        }
      }
    }
    var att = [];
    if (p.inbox && m.unread) att.push('You have ' + count(m.unread, 'unread guest message') + (m.unreadChats > 1 ? ' in ' + count(m.unreadChats, 'conversation') : '') + '.');
    if (p.reviews && m.needReply.length) att.push(cap(count(m.needReply.length, 'review is', 'reviews are')) + ' waiting for a reply' + (m.lowReviews.length ? ', ' + (m.lowReviews.length === m.needReply.length ? (m.needReply.length === 1 ? 'rated' : 'all rated') : words(m.lowReviews.length) + ' of them rated') + ' three stars or lower.' : '.'));
    if (p.inventory && m.low.length) {
      var names = m.low.map(invName).filter(Boolean);
      att.push(cap(count(m.low.length, 'stock item is', 'stock items are')) + ' running low' + (names.length && m.low.length <= 3 ? ': ' + andList(names.map(function (x) { return x.toLowerCase(); })) + '.' : names.length ? ', including ' + andList(names.slice(0, 2).map(function (x) { return x.toLowerCase(); })) + '.' : '.'));
    }
    if (p.inventory && m.overuse.length) {
      var ot = String(m.overuse[0].text || '').replace(/[.\s]+$/, '');
      if (m.overuse.length === 1) att.push('Usage warning: ' + ot + '.');
      else { att.push('There are ' + count(m.overuse.length, 'usage warning') + '.'); att.push('The first: ' + ot + '.'); }
    }
    if (!att.length && (p.inbox || p.reviews)) att.push(p.inbox && p.reviews ? 'Your inbox and reviews are all caught up.' : p.inbox ? 'Your inbox is all caught up.' : 'Every review has a reply.');
    if (att.length) topic();
    s.push.apply(s, att);
    if (m.money) {
      topic();
      var ph = moneyPhrase(m.money);
      s.push(m.money.mon + ' so far: ' + fmt.money(m.money.cur) + ' in revenue' + (ph ? ', ' + ph : '') + '.');
    }
    topic();
    s.push('That\'s everything for now.');
    s.push('Have a good ' + partOfDay() + '.');
    return s;
  }
  function taskPhrase(x) {
    var where = x.propertyId ? ' at ' + prop(x.propertyId).short : '';
    var title = String(x.title || 'Task'); title = title.charAt(0).toLowerCase() + title.slice(1);
    return title + where;
  }
  /* 'due 4 PM' / 'late since 11:45 AM' / 'overdue since yesterday' (the same states the task rows show) */
  function taskWhen(x, m) {
    var day = x.due.slice(0, 10), hm = x.due.slice(11, 16);
    if (day < m.t) { var n = d.diff(day, m.t); return 'overdue since ' + (n === 1 ? 'yesterday' : n < 7 ? DAYS_LONG[d.dow(day)] : d.fmt(day)); }
    return x.due < m.now ? 'late since ' + sayTime(hm) : 'due ' + sayTime(hm);
  }
  /* the same sentence, ready for the speech engine: money in ringgit, decimals spoken, no stray full stops inside a sentence
     (core's O.voice.speak splits on . ! ? so each sentence stays one part and the highlight follows it) */
  function speakable(s) {
    var t = String(s).trim()
      .replace(/RM\s?([\d,]+(?:\.\d+)?)/g, '$1 ringgit')
      .replace(/(\d)\.(\d)/g, '$1 point $2')
      .replace(/\bvs\.?(?=\s)/g, 'versus')
      .replace(/[–—]/g, ', ');
    t = t.replace(/[.!?]+$/, '');
    return t.replace(/[.!?]/g, ',') + '.';
  }
  O.dashboardBrief = function () { return briefSentences(model()); };
  O.dashboardBrief.speech = function () { return O.dashboardBrief().map(speakable); };

  /* ------------------------------------------------------------------ read aloud: start / stop / highlight */
  function startBrief() {
    var page = B.page; if (!page) return;
    stopVoice();
    var sentences = O.dashboardBrief();
    st.brief = { viewer: O.state.viewer, mode: 'reading', idx: -1, sentences: sentences };
    if (!O.voice || !O.voice.available()) { st.brief.mode = 'unavailable'; paintBrief(); return; }
    var run = ++B.run, started = false;
    B.reading = true;
    paintBrief();
    B.timer = setTimeout(function () { /* no voice started (no voices installed, or blocked): show the text instead */
      if (run !== B.run || started) return;
      stopVoice(); st.brief.mode = 'unavailable'; paintBrief(); afterBrief();
    }, 4000);
    var ok = O.voice.speak(sentences.map(speakable).join(' '), {
      onpart: function (i, total) {
        if (run !== B.run) return; started = true;
        highlight(total === sentences.length ? i : Math.min(sentences.length - 1, Math.floor(i * sentences.length / Math.max(1, total))));
      },
      onend: function (ok) {
        if (run !== B.run) return;
        B.run++; B.reading = false; clearTimeout(B.timer);
        /* ok === false: the phone's speech engine refused (the phone app's read-aloud), even if a sentence had started */
        st.brief.mode = started && ok !== false ? 'done' : 'unavailable'; st.brief.idx = -1;
        paintBrief(); afterBrief();
      }
    });
    if (ok === false && run === B.run) { B.run++; B.reading = false; clearTimeout(B.timer); st.brief.mode = 'unavailable'; paintBrief(); }
  }
  function stopVoice() {
    B.run++; clearTimeout(B.timer);
    var was = B.reading; B.reading = false;
    if (was) { try { O.voice.stop(); } catch (e) { /* nothing to stop */ } }
    return was;
  }
  function stopBrief() {
    if (stopVoice() && st.brief) { st.brief.mode = 'stopped'; st.brief.idx = -1; }
    paintBrief(); afterBrief();
  }
  function afterBrief() { if (B.dirty && B.ctx) { B.dirty = false; B.ctx.rerender(); } }
  function highlight(idx) {
    if (!st.brief || !B.page) return;
    st.brief.idx = idx;
    O.$$('.dsh-s', B.page).forEach(function (el, i) { el.classList.toggle('on', i === idx); el.classList.toggle('past', i < idx); });
    var cur = O.$('.dsh-s.on', B.page);
    if (cur && cur.getBoundingClientRect) {
      var r = cur.getBoundingClientRect(), vh = window.innerHeight || 800;
      if (r.top < 72 || r.bottom > vh - 96) { try { cur.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } catch (e) { cur.scrollIntoView(); } }
    }
  }
  function paintBrief() {
    if (!B.page) return;
    var slot = O.$('.dsh-brief-slot', B.page); if (slot) slot.innerHTML = briefPanelHTML();
    var btn = O.$('.dsh-brief-btn', B.page); if (btn) btn.outerHTML = briefButtonHTML();
  }
  function briefButtonHTML() {
    var on = B.reading;
    return '<button type="button" class="btn ' + (on ? 'btn-ghost' : 'btn-primary') + ' dsh-brief-btn" data-brief="' + (on ? 'stop' : 'start') + '" aria-pressed="' + on + '" title="' + (on ? 'Stop reading' : 'Hear a short spoken summary of this page') + '">' + O.icon(on ? 'stop' : 'speaker') + (on ? 'Stop' : 'Brief me') + '</button>';
  }
  function briefPanelHTML() {
    var b = st.brief; if (!b) return '';
    var reading = b.mode === 'reading';
    var title = reading ? 'Reading your brief' : 'Your brief';
    var acts = reading ? '<button type="button" class="btn btn-ghost btn-sm" data-brief="stop">' + O.icon('stop') + 'Stop</button>'
      : (b.mode !== 'unavailable' ? '<button type="button" class="btn btn-ghost btn-sm" data-brief="start">' + O.icon('play') + 'Read again</button>' : '') +
        '<button type="button" class="btn btn-quiet btn-sm" data-brief="close" aria-label="Close the brief">' + O.icon('x') + 'Close</button>';
    var msg = b.mode === 'unavailable' ? '<div class="note warn">Reading aloud isn\'t available on this device or browser, so here is your brief to read.</div>' : '';
    var brk = b.sentences.breaks || [];
    var txt = '<div class="dsh-tr' + (reading ? ' reading' : '') + '"><p>' + b.sentences.map(function (s, i) {
      return (brk.indexOf(i) >= 0 ? '</p><p>' : '') + '<span class="dsh-s' + (i === b.idx ? ' on' : i < b.idx ? ' past' : '') + '">' + esc(s) + '</span>';
    }).join(' ') + '</p></div>';
    return '<section class="card dsh-brief" aria-label="Your spoken brief"><div class="card-head"><h3>' + (reading ? '<span class="dsh-eq on" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' : O.icon('speaker', 'ico')) + title + '</h3><div class="dsh-brief-acts">' + acts + '</div></div>' +
      '<div class="card-body">' + msg + txt + '</div></section>';
  }

  /* ------------------------------------------------------------------ cards */
  function heroHTML(m) {
    var p = m.perm, bits = [];
    if (p.stays) bits.push(fmt.plural(m.allArrivals.length, 'arrival') + (m.sameDay.length ? ' (' + m.sameDay.length + ' same-day)' : ''), fmt.plural(m.departures.length, 'departure'));
    if (p.tasks) bits.push(fmt.plural(m.tasks.length, p.others ? 'open task' : 'task for you', p.others ? 'open tasks' : 'tasks for you') + (m.overdue.length ? ' (' + m.overdue.length + ' overdue)' : ''));
    if (p.inbox && m.unread) bits.push(fmt.plural(m.unread, 'unread message'));
    var sum = bits.length ? cap(andList(bits)) + ' today.' : 'Here is what matters today.';
    var foot = '';
    if (m.money) {
      var mm = m.money, ph = moneyPhrase(mm);
      foot += '<div class="dsh-money" title="Revenue earned on nights from ' + esc(d.fmtRange(mm.from, mm.to)) + ', compared with ' + esc(d.fmtRange(mm.pfrom, mm.pto)) + ' (' + esc(fmt.money(mm.prev)) + ')"><span>' + esc(mm.mon) + ' so far</span><b>' + fmt.money(mm.cur) + '</b>' +
        (ph ? '<span class="delta ' + (pctWord(mm.change) === 0 ? 'flat' : mm.change > 0 ? 'good' : 'bad') + '">' + (pctWord(mm.change) === 0 ? '± ' : mm.change > 0 ? '▲ ' : '▼ ') + esc(ph) + '</span>' : '') + '</div>';
    }
    var links = (p.stays || p.tasks ? '<button type="button" class="btn btn-quiet btn-sm" data-act="runsheet" title="Download today\'s run sheet (PDF): arrivals, departures and open tasks">' + O.icon('printer') + 'Run sheet</button>' : '') +
      (p.stats ? '<button type="button" class="btn btn-quiet btn-sm" data-go="statistics">' + O.icon('statistics') + 'See statistics</button>' : '');
    if (links) foot += '<div class="dsh-links">' + links + '</div>';
    return '<section class="card dsh-hero" aria-label="Today">' +
      '<div><div class="dsh-date">' + O.icon('clock', 'ico') + '<span class="dsh-clock">' + esc(longDate(m.t)) + ' · ' + esc(fmt.time(m.time)) + '</span></div>' +
      '<h2>Good ' + partOfDay() + ', ' + esc(m.first) + '</h2><p class="dsh-sum">' + esc(sum) + '</p></div>' +
      (p.brief ? briefButtonHTML() : '') +
      (foot ? '<div class="dsh-hero-foot">' + foot + '</div>' : '') + '</section>';
  }
  function head(title, n, sub, extra, hot) {
    return '<div class="card-head"><div class="hd"><h3>' + esc(title) + (n != null ? '<span class="n' + (hot ? ' hot' : '') + '">' + n + '</span>' : '') + '</h3>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>' + (extra || '') + '</div>';
  }
  function guestName(b, m) {
    return m.perm.openBooking ? '<button type="button" class="dsh-link" data-act="open" data-b="' + esc(b.id) + '">' + esc(b.guest.name) + '</button>' : '<span>' + esc(b.guest.name) + '</span>';
  }
  function rowAttr(b, m) { return m.perm.openBooking ? ' data-row="' + esc(b.id) + '"' : ''; }
  function moreBtn(key, total, shown, noun) {
    if (total <= (CAP[key] || 6) + 1) return '';
    return '<button type="button" class="dsh-more" data-more="' + key + '" aria-expanded="' + !!st.more[key] + '">' + (st.more[key] ? 'Show fewer' : 'Show ' + (total - shown) + ' more ' + noun) + '</button>';
  }
  function cut(list, key) { var n = CAP[key] || 6; return st.more[key] || list.length <= n + 1 ? list : list.slice(0, n); }
  function cleanNeeded(b) { return safe(function () { return O.readiness(b); }, []).some(function (r) { return r.key === 'clean' && r.label === 'No clean booked'; }); }
  function addCleanBtn(b, m) {
    return m.perm.create && m.perm.taskEdit && cleanNeeded(b) ? '<button type="button" class="btn btn-ghost btn-sm" data-act="addclean" data-b="' + esc(b.id) + '">' + O.icon('plus') + 'Add clean</button>' : '';
  }
  function arrivalRow(b, m, sameDay) {
    var left = mins(b.checkIn + 'T' + (b.checkInTime || '15:00')) - mins(m.now);
    var p = prop(b.propertyId);
    var when = '<b>' + esc(fmt.time(b.checkInTime)) + '</b><span' + (sameDay && left > 0 && left < 60 ? ' class="bad"' : sameDay && left > 0 && left < 180 ? ' class="warn"' : '') + '>' + (left > 0 ? 'in ' + dur(left) : 'Check-in open') + '</span>';
    var sub = sameDay ? 'Booked ' + esc(fmt.time(b.createdAt)) + ' · ' + dur(mins(b.checkIn + 'T' + (b.checkInTime || '15:00')) - mins(b.createdAt)) + ' notice' : esc(fmt.plural(b.nights, 'night') + ' · ' + fmt.plural(b.guests, 'guest'));
    return '<div class="dsh-r' + (sameDay ? ' sd' : '') + '"' + rowAttr(b, m) + '><div class="dsh-tm">' + when + '</div>' +
      '<div style="min-width:0"><div class="dsh-nm">' + U.platIcon(b.channel) + guestName(b, m) + '<span class="u">' + esc(p.short) + '</span></div>' +
      '<div class="dsh-sb">' + sub + '</div>' + safe(function () { return O.readinessHTML(b); }, '') + '</div>' +
      '<div class="dsh-act">' + addCleanBtn(b, m) + '</div></div>';
  }
  function sameDayHTML(m) {
    if (!m.sameDay.length) return '';
    return '<section class="card dsh-sameday" data-card="sameday">' + head('Same-day bookings', m.sameDay.length, 'Booked today for arrival today, so they were not on this morning\'s list', '', true) +
      m.sameDay.map(function (b) { return arrivalRow(b, m, true); }).join('') + '</section>';
  }
  function arrivalsHTML(m) {
    var list = m.arrivals, shown = cut(list, 'arrivals');
    var sub = m.sameDay.length ? 'On this morning\'s list · ' + fmt.plural(m.sameDay.length, 'same-day booking') + ' shown separately' : 'On this morning\'s list · no same-day bookings so far';
    var cal = O.allowed('calendar') ? '<button type="button" class="btn btn-quiet btn-sm" data-go="calendar">' + O.icon('calendar') + 'Calendar</button>' : '';
    return '<section class="card" data-card="arrivals">' + head('Check-ins today', list.length, sub, cal) +
      (list.length ? shown.map(function (b) { return arrivalRow(b, m, false); }).join('') + moreBtn('arrivals', list.length, shown.length, 'check-ins') : '<div class="dsh-quiet">No check-ins were expected today.</div>') + '</section>';
  }
  function turnoverFor(b) {
    var list = D.tasks.filter(function (x) { return x.propertyId === b.propertyId && x.type === 'Turnover' && x.due && x.due.slice(0, 10) === b.checkOut; });
    list.sort(function (a, c) { return (a.status === 'done' ? 1 : 0) - (c.status === 'done' ? 1 : 0); });
    return list[0] || null;
  }
  function departuresHTML(m) {
    var list = m.departures;
    var due = list.length - m.gone.length;
    var sub = !list.length ? '' : !due ? 'Everyone has checked out' : m.gone.length ? m.gone.length + ' already out · ' + due + ' still due' : due + ' still due';
    var rows = list.map(function (b) {
      var p = prop(b.propertyId), gone = m.gone.indexOf(b) >= 0, task = turnoverFor(b);
      var next = D.bookings.filter(function (x) { return live(x) && x.propertyId === b.propertyId && x.checkIn === b.checkOut && x.id !== b.id && x.createdAt <= m.now; })[0];
      var turn = task ? 'Turnover' + (task.assigneeId ? ' · ' + esc(staffName(task.assigneeId)) : ' · unassigned') + ' · ' + (task.status === 'done' ? 'done' : task.status === 'in_progress' ? 'in progress ' + progressText(task) : 'not started')
        : (next ? '<span class="dsh-sb warn" style="margin:0">No turnover clean booked</span>' : 'No turnover task');
      return '<div class="dsh-r"' + rowAttr(b, m) + '><div class="dsh-tm"><b>' + esc(fmt.time(b.checkOutTime)) + '</b><span>' + (gone ? 'Checked out' : 'Due out') + '</span></div>' +
        '<div style="min-width:0"><div class="dsh-nm">' + U.platIcon(b.channel) + guestName(b, m) + '<span class="u">' + esc(p.short) + '</span></div>' +
        '<div class="dsh-sb">' + turn + (next ? ' · next guest ' + esc(sayTime(next.checkInTime)) : '') + '</div></div><div class="dsh-act"></div></div>';
    }).join('');
    return '<section class="card" data-card="departures">' + head('Check-outs today', list.length, sub) + (rows || '<div class="dsh-quiet">No one checks out today.</div>') + '</section>';
  }
  function inHouseHTML(m) {
    var list = m.inHouse, shown = cut(list, 'inhouse');
    var rows = shown.map(function (b) {
      var left = d.diff(m.t, b.checkOut);
      return '<div class="dsh-ih"' + rowAttr(b, m) + '>' + U.platIcon(b.channel) + '<div class="g">' + guestName(b, m) + ' <span>· ' + esc(prop(b.propertyId).short) + '</span></div>' +
        '<div class="w">' + (left === 1 ? 'Leaves tomorrow' : 'Until ' + esc(d.dowName(b.checkOut) + ' ' + d.fmt(b.checkOut))) + '</div></div>';
    }).join('');
    return '<section class="card" data-card="inhouse">' + head('In-house', list.length, list.length ? 'Staying on tonight, not arriving or leaving today' : '') +
      (rows ? rows + moreBtn('inhouse', list.length, shown.length, 'guests') : '<div class="dsh-quiet">No other guests are staying tonight.</div>') + '</section>';
  }
  function progressText(x) { var c = safe(function () { return O.checklist.progress(x); }, null); return c && c.total ? c.done + '/' + c.total : ''; }
  function tasksHTML(m) {
    var p = m.perm, list = m.tasks, shown = cut(list, 'tasks');
    var title = p.others ? 'Today\'s tasks' : 'Your tasks today';
    var sub = list.length ? 'Still to do' + (m.overdue.length ? ' · <span style="color:var(--bad);font-weight:700">' + m.overdue.length + ' overdue</span>' : '') + (m.unassigned.length ? ' · <span style="color:var(--warn);font-weight:700">' + m.unassigned.length + ' unassigned</span>' : '') : '';
    var all = '<button type="button" class="btn btn-quiet btn-sm" data-go="tasks">' + O.icon('tasks') + 'All tasks</button>';
    var rows = shown.map(function (x) {
      var od = x.due.slice(0, 10) < m.t, late = !od && x.due < m.now;
      var where = x.propertyId ? prop(x.propertyId).short : 'General';
      var when = od ? '<b>' + esc(fmt.time(x.due)) + '</b><span class="bad">Overdue</span><span>since ' + esc(d.fmt(x.due.slice(0, 10))) + '</span>'
        : '<b>' + esc(fmt.time(x.due)) + '</b>' + (late ? '<span class="warn">Late</span>' : '<span>in ' + dur(mins(x.due) - mins(m.now)) + '</span>');
      var prog = progressText(x);
      var state = x.status === 'in_progress' ? 'In progress' + (prog ? ' ' + prog : '') : 'Not started';
      var who = p.others ? (x.assigneeId ? esc(staffName(x.assigneeId)) : '<span style="color:var(--warn);font-weight:700">Unassigned</span>') + ' · ' : '';
      var assign = !x.assigneeId && p.assign ? '<select class="select unassigned" data-assign="' + esc(x.id) + '" aria-label="Assign ' + esc(x.title + ' at ' + where) + '"><option value="">Assign to…</option>' + staffOptions() + '</select>' : '';
      var mine = x.assigneeId === m.viewer.id || p.others;
      var act = p.taskEdit && mine ? (x.status === 'todo' ? '<button type="button" class="btn btn-ghost btn-sm" data-act="start" data-t="' + esc(x.id) + '" aria-label="Start ' + esc(x.title + ' at ' + where) + '">' + O.icon('play') + '<span class="lbl">Start</span></button>'
        : '<button type="button" class="btn btn-ghost btn-sm" data-act="done" data-t="' + esc(x.id) + '" aria-label="Mark ' + esc(x.title + ' at ' + where) + ' done">' + O.icon('check') + '<span class="lbl">Done</span></button>') : '';
      return '<div class="dsh-r tk' + (od ? ' od' : '') + '"><div class="dsh-tm">' + when + '</div>' +
        '<div style="min-width:0"><div class="dsh-nm"><span>' + esc(x.title) + '</span><span class="u">' + esc(where) + '</span></div>' +
        '<div class="dsh-sb">' + who + esc(state) + '</div>' + assign + '</div>' +
        '<div class="dsh-act">' + act + '</div></div>';
    }).join('');
    return '<section class="card" data-card="tasks">' + head(title, list.length, sub, all, m.overdue.length > 0) +
      (rows ? rows + moreBtn('tasks', list.length, shown.length, 'tasks') : '<div class="dsh-quiet">' + (p.others ? 'Nothing left to do today.' : 'Nothing left for you today.') + '</div>') + '</section>';
  }
  function staffOptions() {
    return D.staff.filter(function (s) { return s.status !== 'left' && s.status !== 'removed'; }).map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.name) + ' · ' + esc(s.roleLabel || '') + '</option>';
    }).join('');
  }
  function attentionList(m) {
    var p = m.perm, out = [];
    if (p.inbox && m.unread) {
      var g = m.latestChat && m.latestChat.bookingId ? D.booking(m.latestChat.bookingId) : null;
      out.push({ tone: 'info', icon: 'chat', t: fmt.plural(m.unread, 'unread guest message'), s: 'In ' + fmt.plural(m.unreadChats, 'conversation') + (g ? ' · latest from ' + g.guest.name : ''), go: ['inbox'] });
    }
    if (p.reviews && m.needReply.length) out.push({ tone: m.lowReviews.length ? 'bad' : 'warn', icon: 'star', t: fmt.plural(m.needReply.length, 'review needs', 'reviews need') + ' a reply', s: m.lowReviews.length ? m.lowReviews.length + ' rated 3 stars or lower' : 'All rated 4 stars or higher', go: ['reviews', { needsReply: true }] });
    if (p.inventory && m.low.length) {
      var names = m.low.map(invName).filter(Boolean);
      out.push({ tone: 'warn', icon: 'inventory', t: fmt.plural(m.low.length, 'item') + ' low on stock', s: names.length ? names.slice(0, 3).join(', ') + (names.length > 3 ? ' and ' + (names.length - 3) + ' more' : '') : 'At or below the reorder level', go: ['inventory', { tab: 'stock', low: true }] });
    }
    if (p.inventory) m.overuse.slice(0, 3).forEach(function (w) {
      var unit = w.propertyId && D.propById[w.propertyId] ? D.propById[w.propertyId].short : '', what = invName(w);
      out.push({ tone: 'warn', icon: 'alert', t: (unit || 'A unit') + ' is using more ' + (what ? what.replace(/\s+\d+(\.\d+)?\s?(ml|l|g|kg|pcs|pack)$/i, '').toLowerCase() : 'than usual'), s: String(w.text || ''), go: ['inventory', { tab: 'overuse' }] });
    });
    if (p.channels) {
      var ci = O.channel.conflicts();
      if (ci.length) {
        var one = ci.length === 1 ? ci[0] : null, bad = ci.some(function (c) { return c.tone === 'bad'; });
        out.unshift({ tone: bad ? 'bad' : 'warn', icon: 'alert', t: one ? one.t : fmt.plural(ci.length, 'channel issue'), s: one ? one.s : ci.slice(0, 2).map(function (c) { return c.t; }).join(' · ') + (ci.length > 2 ? ' and ' + (ci.length - 2) + ' more' : ''),
          go: one ? one.go : (O.allowed('channels') ? ['channels', { tab: 'alerts' }] : ['bookings']), n: ci.length });
      }
    }
    if (p.inventory && m.overuse.length > 3) out.push({ tone: 'info', icon: 'inventory', t: fmt.plural(m.overuse.length - 3, 'more usage warning'), s: 'See them all in Inventory', go: ['inventory', { tab: 'overuse' }], n: m.overuse.length - 3 });
    return out;
  }
  function attentionHTML(m, list) {
    var p = m.perm;
    if (!p.inbox && !p.reviews && !p.inventory && !(p.channels && list.length)) return '';
    var body = list.length ? list.map(function (a, i) {
      return '<button type="button" class="dsh-al" data-alert="' + i + '"><span class="ai ' + a.tone + '">' + O.icon(a.icon) + '</span><span class="tx"><span class="at">' + esc(a.t) + '</span><span class="as">' + esc(a.s) + '</span></span>' + O.icon('chevron', 'chev') + '</button>';
    }).join('') : '<div class="dsh-quiet">' + (p.inbox && p.reviews ? 'Your inbox and reviews are all caught up.' : p.inbox ? 'Your inbox is all caught up.' : p.reviews ? 'Every review has a reply.' : 'Stock levels look fine.') + '</div>';
    var n = list.reduce(function (t, a) { return t + (a.n || 1); }, 0);
    return '<section class="card" data-card="attention">' + head('Needs attention', n || null, list.length ? 'Tap one to deal with it' : '') + body + '</section>';
  }
  function welcomeHTML(m) {
    var p = m.perm;
    var step = function (k, title, text, btn) { return '<div class="dsh-step"><span class="k">' + k + '</span><b>' + esc(title) + '</b><span class="tx">' + esc(text) + '</span>' + (btn || '') + '</div>'; };
    var steps = [
      step(1, 'Add your properties', 'Name, location, check-in times, lock and Wi-Fi details for each unit.', p.addProperty ? '<button type="button" class="btn btn-primary" data-go="properties" data-add="1">' + O.icon('plus') + 'Add your first property</button>' : (O.allowed('properties') ? '<button type="button" class="btn btn-ghost" data-go="properties">Open Properties</button>' : '')),
      step(2, 'Bring in your bookings', 'Add bookings by hand or connect Booking.com, Agoda, Airbnb, Expedia and Trip.com. Arrivals and turnovers then show here every day.', O.allowed('channels') ? '<button type="button" class="btn btn-ghost" data-go="channels">' + O.icon('channels') + 'Connect channels</button>' : O.allowed('bookings') ? '<button type="button" class="btn btn-ghost" data-go="bookings">' + O.icon('bookings') + 'Go to Bookings</button>' : ''),
      step(3, 'Invite your team', 'Housekeepers, front desk and accounts each see what their role needs.', p.invite && O.allowed('staff') ? '<button type="button" class="btn btn-ghost" data-go="staff">' + O.icon('staff') + 'Invite people</button>' : '')
    ];
    return '<section class="card dsh-welcome" aria-label="Get started"><div><div class="dsh-date">' + O.icon('clock', 'ico') + '<span class="dsh-clock">' + esc(longDate(m.t)) + ' · ' + esc(fmt.time(m.time)) + '</span></div>' +
      '<h2>Welcome to Orbique, ' + esc(m.first) + '</h2><p>Your workspace is ready. Add your first property and your bookings, and this page becomes your daily glance: who arrives, who leaves, what needs cleaning and what needs you.</p></div>' +
      '<div class="dsh-steps">' + steps.join('') + '</div></section>';
  }

  /* ------------------------------------------------------------------ actions */
  function addClean(b) {
    var p = prop(b.propertyId), canAssign = O.can('tasks.assign');
    var due = (function () { var m = Math.max(0, mins(b.checkIn + 'T' + (b.checkInTime || '15:00')) - mins(b.checkIn + 'T00:00') - 30); return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); })();
    var people = D.staff.filter(function (s) { return s.status !== 'left' && s.status !== 'removed'; }).sort(function (a, c) { return (a.role === 'housekeeping' ? 0 : 1) - (c.role === 'housekeeping' ? 0 : 1); });
    var who = canAssign ? '<div class="field full"><label for="dsh-ac-who">Assign to</label><select class="select" id="dsh-ac-who" name="who">' + people.map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (s.id === p.housekeeper ? ' selected' : '') + '>' + esc(s.name) + ' · ' + esc(s.roleLabel || '') + '</option>';
    }).join('') + '</select></div>' : '<div class="field full"><label>Assigned to</label><div class="small">' + esc(staffName(O.state.viewer)) + ' (you)</div></div>';
    U.modal({
      title: 'Add a clean', sub: p.name + ' · before ' + b.guest.name + ' arrives at ' + fmt.time(b.checkInTime),
      body: '<div class="form-grid">' + who +
        '<div class="field"><label for="dsh-ac-type">Type</label><select class="select" id="dsh-ac-type" name="type"><option value="Turnover">Turnover clean</option><option value="Inspection">Pre-arrival inspection</option></select></div>' +
        '<div class="field"><label for="dsh-ac-due">Finish by</label><input class="input" type="time" id="dsh-ac-due" name="due" value="' + esc(due) + '"></div></div>',
      actions: [{ label: 'Cancel' }, {
        label: 'Add clean', kind: 'primary', onClick: function (close, el) {
          var whoEl = O.$('[name=who]', el), assignee = whoEl ? whoEl.value : O.state.viewer;
          var type = O.$('[name=type]', el).value, tm = O.$('[name=due]', el).value || due;
          var title = type === 'Turnover' ? 'Turnover clean' : 'Pre-arrival inspection';
          D.tasks.push({ id: O.uid('T'), title: title, type: type, propertyId: b.propertyId, assigneeId: assignee, due: b.checkIn + 'T' + tm, priority: 'high', status: 'todo',
            checklistId: O.checklist && O.checklist.forType ? O.checklist.forType(type, title) : null, checks: [], note: (b.createdAt.slice(0, 10) === D.TODAY ? 'Same-day booking: ' : '') + b.guest.name + ' arrives ' + fmt.time(b.checkInTime), createdBy: O.state.viewer, createdAt: D.NOW });
          U.toast(title + ' at ' + p.short + ' added for ' + staffName(assignee));
          O.emit('data', { type: 'task' });
        }
      }]
    });
  }
  function runSheetPDF(m) {
    var rows = [];
    m.departures.forEach(function (b) { var t = turnoverFor(b); rows.push([b.checkOutTime, 'Check-out', b.guest.name, prop(b.propertyId).short, m.gone.indexOf(b) >= 0 ? 'Checked out' : 'Due out', t && t.assigneeId ? staffName(t.assigneeId) : '']); });
    m.allArrivals.forEach(function (b) {
      rows.push([b.checkInTime, m.sameDay.indexOf(b) >= 0 ? 'Check-in (same-day)' : 'Check-in', b.guest.name, prop(b.propertyId).short, safe(function () { return O.readiness(b).map(function (r) { return r.label; }).join(', '); }, ''), '']);
    });
    m.tasks.forEach(function (x) { rows.push([x.due.slice(0, 10) < m.t ? '00:00' : x.due.slice(11, 16), x.due.slice(0, 10) < m.t ? 'Task (overdue)' : 'Task', x.title, x.propertyId ? prop(x.propertyId).short : 'General', x.status === 'in_progress' ? 'In progress ' + progressText(x) : 'Not started', staffName(x.assigneeId)]); });
    rows.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    rows = rows.map(function (r) { return [r[1] === 'Task (overdue)' ? 'Overdue' : fmt.time(r[0])].concat(r.slice(1)); });
    O.pdf.report({
      filename: 'run-sheet-' + m.t + '.pdf', title: 'Run sheet', subtitle: longDate(m.t) + ' · printed ' + fmt.time(m.time),
      summary: [['Check-ins', String(m.allArrivals.length)], ['Same-day', String(m.sameDay.length)], ['Check-outs', String(m.departures.length)], ['Open tasks', String(m.tasks.length)]],
      columns: [{ label: 'Time', w: 20 }, { label: 'What', w: 30 }, { label: 'Guest / task', w: 36 }, { label: 'Property', w: 26 }, { label: 'Details', w: 46 }, { label: 'Owner', w: 28 }],
      rows: rows.length ? rows : [['', 'Nothing scheduled', '', '', '', '']], notes: 'Completed tasks are not listed. Same-day bookings were made today and were not on the morning list.'
    });
  }

  /* ------------------------------------------------------------------ page */
  var def = {
    desc: 'Today at a glance',
    render: function (root, ctx) {
      B.ctx = ctx;
      if (st.brief && st.brief.viewer !== O.state.viewer) st.brief = null;
      var m = model(), p = m.perm;
      ctx.setActions('');
      if (!p.brief) st.brief = null;
      if (st.brief && st.brief.mode !== 'reading') st.brief.sentences = briefSentences(m); /* keep the shown text in step with the page */

      var html;
      if (m.empty) html = welcomeHTML(m);
      else {
        var alerts = attentionList(m);
        var mineFirst = p.tasks && !p.others; /* housekeepers and maintenance: their own tasks come first on a phone */
        var cards = {
          sameday: p.stays ? sameDayHTML(m) : '', arrivals: p.stays ? arrivalsHTML(m) : '', departures: p.stays ? departuresHTML(m) : '',
          inhouse: p.stays ? inHouseHTML(m) : '', tasks: p.tasks ? tasksHTML(m) : '', attention: attentionHTML(m, alerts)
        };
        var order = mineFirst ? ['tasks', 'sameday', 'arrivals', 'departures', 'attention', 'inhouse'] : ['sameday', 'arrivals', 'tasks', 'departures', 'attention', 'inhouse'];
        var styled = function (k) { return cards[k] ? cards[k].replace('<section class="card', '<section style="order:' + (order.indexOf(k) + 1) + '" class="card') : ''; };
        var left = ['sameday', 'arrivals', 'departures'].map(styled).join('');
        var right = ['tasks', 'attention', 'inhouse'].map(styled).join('');
        if (!p.stays) { left = ['tasks'].map(styled).join(''); right = ['attention'].map(styled).join(''); }
        html = heroHTML(m) + '<div class="dsh-brief-slot">' + (st.brief ? briefPanelHTML() : '') + '</div>' +
          (left || right ? '<div class="dsh-main"><div class="dsh-col">' + left + '</div><div class="dsh-col">' + right + '</div></div>' : '');
        root._dshAlerts = alerts;
      }
      root.innerHTML = '<div class="pg-dashboard">' + html + '</div>';
      var page = B.page = O.$('.pg-dashboard', root);

      ctx.onLeave(function () {
        stopVoice();
        if (st.brief && st.brief.mode === 'reading') { st.brief.mode = 'stopped'; st.brief.idx = -1; }
        if (O.state.page !== 'dashboard') { st.brief = null; st.more = {}; }
        B.page = null;
      });
      ctx.on('data', function () { if (B.reading) B.dirty = true; });
      ctx.on('tick', function () { /* keep the clock and greeting current without disturbing the person */
        if (B.reading) return;
        var a = document.activeElement;
        if (a && page.contains(a) && /^(SELECT|INPUT|TEXTAREA)$/.test(a.tagName)) return;
        if (+String(D.NOW_TIME).slice(3, 5) % 5 === 0) ctx.rerender();
        else { var c = O.$('.dsh-clock', page); if (c) c.textContent = longDate(D.TODAY) + ' · ' + fmt.time(D.NOW_TIME); }
      });

      page.addEventListener('click', function (e) {
        var x;
        if ((x = e.target.closest('[data-brief]'))) {
          var k = x.dataset.brief;
          if (k === 'start') startBrief();
          else if (k === 'stop') stopBrief();
          else if (k === 'close') { stopVoice(); st.brief = null; paintBrief(); }
          return;
        }
        if ((x = e.target.closest('[data-go]'))) { stopVoice(); O.go(x.dataset.go, x.dataset.add ? { add: true } : undefined); return; }
        if ((x = e.target.closest('[data-more]'))) { st.more[x.dataset.more] = !st.more[x.dataset.more]; if (!B.reading) ctx.rerender(); return; }
        if ((x = e.target.closest('[data-alert]'))) { var a = (root._dshAlerts || [])[+x.dataset.alert]; if (a) { stopVoice(); O.go(a.go[0], a.go[1]); } return; }
        if ((x = e.target.closest('[data-act]'))) {
          var act = x.dataset.act, b = x.dataset.b ? D.booking(x.dataset.b) : null;
          var task = x.dataset.t ? D.tasks.filter(function (k2) { return k2.id === x.dataset.t; })[0] : null;
          var where = task && task.propertyId ? ' at ' + prop(task.propertyId).short : '';
          if (act === 'open' && b) O.booking.open(b.id);
          else if (act === 'addclean' && b) addClean(b);
          else if (act === 'runsheet') runSheetPDF(model());
          else if (act === 'start' && task) { task.status = 'in_progress'; task.startedAt = task.startedAt || D.NOW; U.toast(task.title + where + ' started'); O.emit('data', { type: 'task', id: task.id }); }
          else if (act === 'done' && task) { task.status = 'done'; task.doneAt = D.NOW; task.doneBy = O.state.viewer; U.toast(task.title + where + ' marked done'); O.emit('data', { type: 'task', id: task.id }); }
          return;
        }
        if ((x = e.target.closest('[data-row]')) && !e.target.closest('button, select, a, input')) O.booking.open(x.dataset.row);
      });
      page.addEventListener('change', function (e) {
        var sel = e.target.closest('[data-assign]'); if (!sel || !sel.value) return;
        var task = D.tasks.filter(function (k2) { return k2.id === sel.dataset.assign; })[0]; if (!task) return;
        task.assigneeId = sel.value;
        U.toast(task.title + (task.propertyId ? ' at ' + prop(task.propertyId).short : '') + ' assigned to ' + staffName(task.assigneeId));
        O.emit('data', { type: 'task', id: task.id });
      });
    }
  };
  /* while the brief is being read, other people's changes do not redraw the page (that would cut the voice off);
     the page redraws once the brief ends */
  Object.defineProperty(def, 'noDataRerender', { get: function () { return B.reading; }, enumerable: true });
  O.page('dashboard', def);
})();
