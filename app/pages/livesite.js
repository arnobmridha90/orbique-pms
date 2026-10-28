/* Live website: the buildings, units and photos on the workspace's own website (for Kozi, www.staykozi.my), and Publish.
   Saved: D.siteContent (blob 'siteContent', the draft everyone edits here) and D.siteContentLive (blob 'siteContentLive',
   {content, publishedAt, publishedBy, history}: written only by the server on Publish, read here). The shape and the
   rules are O.sitecontent (api/_lib/shared/sitecontent.cjs); the server is POST /api/site (upload-urls, publish), see
   docs/API.md. The site's address and its online booking types come from D.website (siteUrl, types).
   Access: open with website.edit or website.publish (O.PAGE_ACCESS in core), change with website.edit, Publish with
   website.publish.
   Photos are made in the browser at 640, 1280 and 2400 px wide (never larger than the photo), JPEG 0.82, and sent to
   Supabase Storage with signed upload URLs. Removing a photo only takes it out of the content; its files stay.
   The local test copy has no server: photos stay in this browser and Publish changes only this browser's copy.
   Tests can stand in for the server: O.siteApi = function (action, body) -> Promise<answer> (tests/livesite_e2e.mjs). */
(function () {
  var O = window.O, D = O.data, U = O.ui, esc = O.esc, fmt = O.fmt, SC = O.sitecontent;
  O.sync.blob('siteContent', 'config');
  O.sync.blob('siteContentLive', 'config');

  var LOCAL_PREFIX = 'https://local.orbique.test/site-photos/local/'; /* uploads in the test copy (kept in this browser) */
  var FALLBACK_SOURCE = 'https://staykozi-my-next.vercel.app'; /* where /content.json is when the site address does not answer */
  var MAX_SOURCE = 40 * 1024 * 1024;
  var QUALITY = [0.82, 0.74, 0.66];
  var VIEW_KEYS = SC.VIEWS;
  var st = { busy: false, importing: false };
  var DR = null;            /* the open drawer: {dr, kind: 'unit'|'building', index (-1 new), draft, dirty, slugTouched, cityTouched, pm} */
  var builtinCache = null;  /* builtinPhotos from <site>/content.json */

  O.css('livesite', `
.pg-live{display:flex; flex-direction:column; gap:16px;}
.pg-live .lv-top{display:flex; gap:14px; align-items:center; flex-wrap:wrap; padding:14px 16px;}
.pg-live .lv-top .grow{min-width:0; flex:1 1 260px;}
.pg-live .lv-site{display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-family:var(--font-head); font-weight:800; font-size:16px; min-width:0;}
.pg-live .lv-site a{color:inherit; text-decoration:none; overflow-wrap:anywhere;}
.pg-live .lv-site a:hover{text-decoration:underline;}
.pg-live .lv-site svg{width:16px; height:16px; color:var(--muted); flex:none;}
.pg-live .lv-stat{display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:12.5px; color:var(--text-2); margin-top:4px;}
.pg-live .lv-pub{display:flex; gap:8px; align-items:center; flex-wrap:wrap;}
.pg-live .lv-probs{display:flex; flex-direction:column; gap:4px;}
.pg-live .lv-probs b{font-size:12.5px;}
.pg-live .lv-probs ul{margin:2px 0 0; padding-left:18px; font-size:12.5px; line-height:1.5;}
.pg-live .lv-sec-h{display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin:6px 0 10px;}
.pg-live .lv-sec-h h3{font-size:15px; margin:0;}
.pg-live .lv-sec-h .sub{font-size:12px; color:var(--muted); margin-top:2px;}
.pg-live .lv-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:14px;}
.pg-live .lv-card{display:flex; flex-direction:column; background:var(--surface); border:1px solid var(--border); border-radius:var(--r); box-shadow:var(--shadow); overflow:hidden; min-width:0;}
.pg-live .lv-card.off .lv-ph img{filter:grayscale(.8); opacity:.6;}
.lv-ph{position:relative; display:block; width:100%; aspect-ratio:16/10; background:var(--surface-2); overflow:hidden; border:none; padding:0; cursor:pointer;}
.lv-ph img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block;}
.lv-ph .none{position:absolute; inset:0; display:flex; flex-direction:column; gap:4px; align-items:center; justify-content:center; color:var(--muted); font-size:12px; font-weight:600;}
.lv-ph .none svg{width:26px; height:26px;}
.lv-ph .pill{position:absolute; top:10px; left:10px;}
.lv-ph .cnt{position:absolute; right:8px; bottom:8px; background:rgba(20,24,31,.72); color:#FFFFFF; font-size:11px; font-weight:700; border-radius:20px; padding:2px 8px; display:inline-flex; gap:4px; align-items:center;}
.lv-ph .cnt svg{width:12px; height:12px;}
.pg-live .lv-b{display:flex; flex-direction:column; gap:3px; padding:11px 13px 12px; min-width:0;}
.pg-live .lv-nm{font-family:var(--font-head); font-weight:800; font-size:14.5px; text-align:left; background:none; border:none; padding:0; color:inherit; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer;}
.pg-live .lv-meta{font-size:12px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.pg-live .lv-ft{display:flex; align-items:center; gap:6px; margin-top:8px; padding-top:9px; border-top:1px solid var(--border); flex-wrap:wrap;}
.pg-live .lv-ft .sw{display:inline-flex; align-items:center; gap:7px; font-size:12px; font-weight:700; color:var(--text-2); margin-right:auto;}
.pg-live .lv-ib{width:32px; height:32px; display:inline-flex; align-items:center; justify-content:center; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--text-2); padding:0; text-decoration:none;}
.pg-live .lv-ib:hover{background:var(--surface-2);}
.pg-live .lv-ib[disabled]{opacity:.35; cursor:default;}
.pg-live .lv-ib svg{width:15px; height:15px;}
.pg-live .lv-add{display:flex; flex-direction:column; gap:6px; align-items:center; justify-content:center; min-height:180px; border:1.5px dashed var(--border-strong); border-radius:var(--r); background:none; color:var(--brand-strong); font:inherit; font-weight:700; font-size:13px; cursor:pointer;}
.pg-live .lv-add:hover{background:var(--brand-soft-2, var(--surface-2));}
.pg-live .lv-add svg{width:22px; height:22px;}
.pg-live .lv-bds{display:flex; flex-direction:column;}
.pg-live .lv-bd{display:grid; grid-template-columns:72px minmax(0,1fr) auto; gap:12px; align-items:center; padding:10px 14px; border-top:1px solid var(--border);}
.pg-live .lv-bd:first-child{border-top:none;}
.pg-live .lv-bd.off .lv-th img{filter:grayscale(.8); opacity:.6;}
.pg-live .lv-th{position:relative; width:72px; height:48px; border-radius:8px; overflow:hidden; background:var(--surface-2); border:none; padding:0; cursor:pointer;}
.pg-live .lv-th img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
.pg-live .lv-th svg{width:20px; height:20px; color:var(--muted);}
.pg-live .lv-bd .t1{font-weight:800; font-size:13.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; background:none; border:none; padding:0; text-align:left; color:inherit; font-family:inherit; cursor:pointer; max-width:100%;}
.pg-live .lv-bd .t2{font-size:12px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.pg-live .lv-bd .acts{display:flex; align-items:center; gap:6px;}
.pg-live .lv-empty{display:flex; flex-direction:column; align-items:center; text-align:center; gap:10px; padding:40px 20px;}
.pg-live .lv-empty h3{font-size:18px; margin:0;}
.pg-live .lv-empty p{margin:0; color:var(--muted); max-width:480px; line-height:1.5; font-size:13px;}
.pg-live .lv-empty .field{width:min(380px,100%); text-align:left;}
.pg-live .lv-empty .row-flex{justify-content:center; flex-wrap:wrap; gap:8px;}

.lv-dr .modal-body{padding:4px 18px 24px;}
.lv-dr .lv-sec{padding:16px 0 4px; border-top:1px solid var(--border); margin-top:14px;}
.lv-dr .lv-sec:first-child{border-top:none; margin-top:0;}
.lv-dr .lv-sec h4{font-size:14px; font-weight:800; margin:0;}
.lv-dr .lv-sec .sd{font-size:12px; color:var(--muted); margin:2px 0 12px;}
.lv-dr .field > label .opt{font-weight:600; color:var(--faint);}
.lv-dr .lv-err{font-size:11.5px; color:var(--bad); font-weight:600;}
.lv-dr .lv-err:empty{display:none;}
.lv-dr .input.bad, .lv-dr .select.bad, .lv-dr .textarea.bad{border-color:var(--bad); box-shadow:0 0 0 1px var(--bad) inset;}
.lv-dr .lv-url{font-size:11.5px; color:var(--muted); overflow-wrap:anywhere;}
.lv-dr .lv-checks{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px;}
.lv-dr .lv-hl{display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px;}
.lv-dr .lv-hl .chip{padding-right:4px;}
.lv-dr .lv-hl .chip button{border:none; background:none; color:inherit; padding:0 4px; font-size:15px; line-height:1; cursor:pointer;}
.lv-dr .lv-hladd{display:flex; gap:8px;}
.lv-dr .lv-hladd .input{flex:1; min-width:0;}
.lv-dr .lv-count{font-size:11px; color:var(--faint); text-align:right;}
.lv-dr .modal-foot{justify-content:space-between;}
.lv-dr .modal-foot .r{display:flex; gap:8px; margin-left:auto;}

.lv-photos{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px;}
.lv-pt{display:flex; flex-direction:column; gap:6px; min-width:0; border-radius:10px;}
.lv-pt.over{outline:2px dashed var(--brand-strong); outline-offset:3px;}
.lv-pt.drag{opacity:.45;}
.lv-pt .im{position:relative; aspect-ratio:4/3; border-radius:10px; overflow:hidden; background:var(--surface-2); border:1px solid var(--border);}
.lv-pt .im img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block;}
.lv-pt[draggable=true] .im{cursor:grab;}
.lv-pt .cover{position:absolute; top:7px; left:7px; background:var(--brand); color:var(--brand-ink); font-size:10.5px; font-weight:800; border-radius:20px; padding:2px 8px;}
.lv-pt .kind{position:absolute; top:7px; right:7px; background:rgba(20,24,31,.72); color:#FFFFFF; font-size:10px; font-weight:700; border-radius:20px; padding:2px 7px;}
.lv-pt .bar{position:absolute; right:6px; bottom:6px; display:flex; gap:4px;}
.lv-pt .bar button{width:32px; height:32px; border-radius:8px; border:none; background:rgba(20,24,31,.72); color:#FFFFFF; display:inline-flex; align-items:center; justify-content:center; padding:0; cursor:pointer;}
.lv-pt .bar button svg{width:15px; height:15px;}
.lv-pt .bar button[disabled]{opacity:.35; cursor:default;}
.lv-pt .alt{min-height:34px; padding-top:5px; padding-bottom:5px; font-size:12.5px;}
.lv-pt .alt.bad{border-color:var(--bad); box-shadow:0 0 0 1px var(--bad) inset;}
.lv-pt .up{position:absolute; left:8px; right:8px; bottom:8px; display:flex; flex-direction:column; gap:5px; background:rgba(20,24,31,.78); color:#FFFFFF; border-radius:8px; padding:7px 8px; font-size:11.5px; font-weight:700;}
.lv-pt .up .progress{background:rgba(255,255,255,.25); border-color:transparent;}
.lv-pt .up .row{display:flex; gap:6px; align-items:center;}
.lv-pt .up .row span{flex:1; min-width:0;}
.lv-pt .up button{border:none; border-radius:6px; padding:3px 8px; font:inherit; font-size:11.5px; cursor:pointer; background:#FFFFFF; color:#14181F;}
.lv-pt.err .up{background:rgba(160,30,30,.88);}
.lv-padd{display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; aspect-ratio:4/3; border:1.5px dashed var(--border-strong); border-radius:10px; cursor:pointer; color:var(--text-2); font-size:12px; text-align:center; padding:8px; background:none; font-family:inherit;}
.lv-padd:hover{border-color:var(--brand-strong); background:var(--brand-soft-2, var(--surface-2));}
.lv-padd svg{width:22px; height:22px; color:var(--brand-strong);}
.lv-padd span{color:var(--muted); font-size:11px;}
.lv-pick{display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:10px; max-height:60vh; overflow:auto;}
.lv-pick label{display:flex; flex-direction:column; gap:5px; font-size:11.5px; cursor:pointer; min-width:0;}
.lv-pick label .im{position:relative; aspect-ratio:4/3; border-radius:8px; overflow:hidden; background:var(--surface-2); border:2px solid transparent;}
.lv-pick label .im img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
.lv-pick label input{position:absolute; top:6px; left:6px; width:18px; height:18px; accent-color:var(--brand-strong);}
.lv-pick label.on .im{border-color:var(--brand-strong);}
.lv-pick label.dis{opacity:.5; cursor:default;}
.lv-pick label span{overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.lv-chg{margin:0 0 10px; padding-left:18px; line-height:1.55; font-size:13px;}
.lv-chg.warn{color:var(--text-2);}

@media (max-width:760px){
  .pg-live .lv-grid{grid-template-columns:minmax(0,1fr); gap:10px;}
  .pg-live .lv-card{flex-direction:row; align-items:stretch;}
  .pg-live .lv-card .lv-ph{width:108px; flex:none; aspect-ratio:auto; min-height:100%;}
  .pg-live .lv-card .lv-ph .cnt{display:none;}
  .pg-live .lv-card .lv-ph .pill{top:6px; left:6px; font-size:10px;}
  .pg-live .lv-b{flex:1; padding:10px 11px;}
  .pg-live .lv-ib{width:40px; height:40px;}
  .pg-live .lv-ft{gap:6px;}
  .pg-live .lv-ft .sw{flex-basis:100%;}
  .pg-live .lv-add{min-height:64px; flex-direction:row;}
  .pg-live .lv-bd{grid-template-columns:60px minmax(0,1fr); grid-template-areas:"p t" "a a";}
  .pg-live .lv-bd > :nth-child(1){grid-area:p; width:60px;} .pg-live .lv-bd > :nth-child(2){grid-area:t;} .pg-live .lv-bd > :nth-child(3){grid-area:a; flex-wrap:wrap;}
  .pg-live .lv-top .lv-pub{flex-basis:100%;}
  .pg-live .lv-top .lv-pub .btn{flex:1;}
  .lv-dr .input, .lv-dr .select, .lv-dr .textarea{font-size:16px;}
  .lv-dr .lv-checks{grid-template-columns:minmax(0,1fr);}
  .lv-pt .bar button{width:40px; height:40px;}
  .lv-pt .alt{font-size:16px; min-height:40px;}
  .lv-dr .modal-foot .btn{min-height:42px;}
}
`);

  /* ------------------------------------------------------------------ data */
  function draft() { var c = D.siteContent; return c && typeof c === 'object' && !Array.isArray(c) ? c : null; }
  function liveBlob() { var l = D.siteContentLive; return l && typeof l === 'object' && !Array.isArray(l) ? l : null; }
  function web() { var w = D.website; return w && typeof w === 'object' && !Array.isArray(w) ? w : {}; }
  function siteUrl() { var u = String(web().siteUrl || '').trim().replace(/\/+$/, ''); return /^https:\/\/[a-z0-9.-]+$/i.test(u) ? u : ''; }
  function host(u) { return String(u || '').replace(/^https:\/\//, ''); }
  function types() { var t = web().types; return t && typeof t === 'object' && !Array.isArray(t) ? t : {}; }
  function typeKeys() { return Object.keys(types()); }
  function canEdit() { return O.can('website.edit'); }
  function canPublish() { return O.can('website.publish'); }
  function server() { return !!O.siteApi || !!(O.auth && O.auth.enabled && O.auth.enabled() && O.auth.call && O.auth.orgId && O.auth.orgId()); }
  function api(action, body) {
    if (O.siteApi) return Promise.resolve(O.siteApi(action, body || {}));
    return O.auth.call('/api/site', Object.assign({ action: action, orgId: O.auth.orgId() }, body || {}));
  }
  function checkOpts(strict) { return { strict: !!strict, bookTypes: typeKeys().length ? typeKeys() : null, uploadPrefixes: server() ? null : [LOCAL_PREFIX] }; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function save() { O.emit('data'); }
  function buildingsOf(c) { return Array.isArray(c.buildings) ? c.buildings : (c.buildings = []); }
  function suitesOf(c) { return Array.isArray(c.suites) ? c.suites : (c.suites = []); }
  function buildingById(c, id) { return buildingsOf(c).filter(function (b) { return b && b.id === id; })[0] || null; }
  function photosOf(x) { return x && Array.isArray(x.photos) ? x.photos : []; }
  function NO_EDIT() { return 'Your access does not include editing the website'; }
  function changed() { /* the draft differs from what the site shows */
    var c = draft(), live = liveBlob();
    if (!c) return false;
    if (!live || !live.content) return true;
    var strict = SC.check(c, checkOpts(true));
    return !!strict.errors.length || SC.canon(SC.check(c, checkOpts(false)).content) !== SC.canon(live.content);
  }
  function myTime(iso) { var t = Date.parse(iso); if (isNaN(t)) return ''; return fmt.dateTime(new Date(t + 8 * 36e5).toISOString().slice(0, 16)); }
  /* the published page of a building or unit, when the site shows it now */
  function liveLink(kind, x) {
    var u = siteUrl(), live = liveBlob(), lc = live && live.content; if (!u || !lc || !x) return '';
    var lb = (lc.buildings || []).filter(function (b) { return b.id === (kind === 'unit' ? x.buildingId : x.id) && b.visible; })[0];
    if (!lb) return '';
    if (kind === 'building') return u + '/' + lb.cityId + '/' + lb.id + '/';
    var ls = (lc.suites || []).filter(function (s) { return s.buildingId === lb.id && s.id === x.id && s.visible; })[0];
    return ls ? u + '/' + lb.cityId + '/' + lb.id + '/' + ls.id + '/' : '';
  }

  /* photos: a thumbnail for any photo, uploads in the test copy are kept in this browser */
  function localKey(id) { return 'livesite:photo:' + id; }
  function thumb(p) {
    if (!p) return '';
    if (p.kind === 'upload' && String(p.base || '').indexOf(LOCAL_PREFIX) === 0) return O.store.get(localKey(p.id), '') || '';
    return SC.photoSrc(p, 640, siteUrl());
  }
  function imgHTML(p, alt) { var s = thumb(p); return s ? '<img src="' + esc(s) + '" alt="' + esc(alt == null ? (p.alt || '') : alt) + '" loading="lazy" decoding="async">' : ''; }
  function noPhoto(text) { return '<span class="none">' + O.icon('image') + (text ? esc(text) : '') + '</span>'; }

  /* ------------------------------------------------------------------ page */
  function topHTML(c) {
    var u = siteUrl(), live = liveBlob(), dirty = changed();
    var status = live && live.publishedAt ? 'Published ' + esc(myTime(live.publishedAt)) + (live.publishedBy ? ' by ' + esc(live.publishedBy) : '') : 'Not published yet';
    var pubWhy = !canPublish() ? 'Your access does not include publishing the website' : !c ? 'Add a building and a unit first' : '';
    return '<div class="card lv-top"><div class="grow">' +
      '<div class="lv-site">' + O.icon('website') + (u ? '<a href="' + esc(u) + '/" target="_blank" rel="noopener">' + esc(host(u)) + '</a>' : '<span class="muted">No website address yet</span>') +
      (canEdit() ? '<button type="button" class="btn btn-quiet btn-xs" data-act="address">' + (u ? 'Change' : 'Add the address') + '</button>' : '') + '</div>' +
      '<div class="lv-stat"><span data-status>' + status + '</span>' + (c && dirty ? U.pill('Changes not published', 'warn') : c && live ? U.pill('Up to date', 'ok') : '') + '</div>' +
      (server() ? '' : '<div class="lv-stat"><span class="xs muted">Test copy: photos stay in this browser, and Publish changes nothing online.</span></div>') +
      '</div><div class="lv-pub"><button type="button" class="btn btn-primary" data-act="publish"' + (pubWhy || st.busy ? ' disabled' : '') + (pubWhy ? ' title="' + esc(pubWhy) + '"' : '') + '>' + O.icon('upload') + (st.busy ? 'Publishing…' : 'Publish') + '</button></div></div>';
  }
  function problemsHTML(c) {
    var r = SC.check(c, checkOpts(true));
    if (!r.errors.length) return '';
    return '<div class="note warn lv-probs"><b>Fix ' + (r.errors.length === 1 ? 'this' : 'these') + ' before publishing</b><ul>' + r.errors.slice(0, 5).map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' + (r.errors.length > 5 ? '<span class="xs">And ' + (r.errors.length - 5) + ' more.</span>' : '') + '</div>';
  }
  function emptyHTML() {
    var u = siteUrl(), edit = canEdit();
    return '<div class="card lv-empty"><h3>Your website\'s units and photos</h3>' +
      '<p>Change the photos, add units and buildings, hide what is not ready, then Publish. The website shows the change within a minute.</p>' +
      (!edit ? '<p class="small">Someone who may edit the website can bring in what is on it now.</p>' :
        (u ? '' : '<div class="field"><label for="lv-site0">Your website address</label><input class="input" id="lv-site0" data-site0 type="url" inputmode="url" placeholder="https://www.example.com" maxlength="120"></div>') +
        '<div class="row-flex"><button type="button" class="btn btn-primary" data-act="import"' + (st.importing ? ' disabled' : '') + '>' + O.icon('download') + (st.importing ? 'Bringing it in…' : 'Bring in what\'s on the website now') + '</button>' +
        '<button type="button" class="btn btn-ghost" data-act="start">Start empty</button></div>') + '</div>';
  }
  function bodyHTML(c) {
    var bds = buildingsOf(c), units = suitesOf(c), edit = canEdit();
    var h = problemsHTML(c);
    h += '<div><div class="lv-sec-h"><div><h3>Buildings</h3><div class="sub">Each building has its own page, under its city.</div></div>' +
      (edit ? '<div class="row-flex" style="gap:8px;flex-wrap:wrap">' + (!bds.length ? '<button type="button" class="btn btn-ghost btn-sm" data-act="import">' + O.icon('download') + 'Bring in what\'s on the website now</button>' : '') + '<button type="button" class="btn btn-ghost btn-sm" data-act="addbuilding">' + O.icon('plus') + 'Add a building</button></div>' : '') + '</div>' +
      (bds.length ? '<div class="card lv-bds">' + bds.map(function (b, i) { return buildingRowHTML(c, b, i); }).join('') + '</div>' : '<div class="card"><div class="card-body small muted">No buildings yet. Add the building your units are in first.</div></div>') + '</div>';
    bds.forEach(function (b) {
      var mine = units.map(function (s, i) { return [s, i]; }).filter(function (x) { return x[0] && x[0].buildingId === b.id; });
      h += '<div><div class="lv-sec-h"><div><h3>Units in ' + esc(b.name || 'this building') + '</h3><div class="sub">In the order the website shows them.' + (b.visible === false ? ' This building is hidden, so its units are not on the site.' : '') + '</div></div></div>' +
        '<div class="lv-grid">' + mine.map(function (x, k) { return unitCardHTML(x[0], x[1], k, mine.length); }).join('') +
        (edit ? '<button type="button" class="lv-add" data-addunit="' + esc(b.id) + '">' + O.icon('plus') + 'Add a unit</button>' : '') + '</div></div>';
    });
    var lost = units.map(function (s, i) { return [s, i]; }).filter(function (x) { return x[0] && !buildingById(c, x[0].buildingId); });
    if (lost.length) h += '<div><div class="lv-sec-h"><div><h3>Units without a building</h3><div class="sub">Open each one and choose its building.</div></div></div><div class="lv-grid">' + lost.map(function (x, k) { return unitCardHTML(x[0], x[1], k, lost.length); }).join('') + '</div></div>';
    return h;
  }
  function buildingRowHTML(c, b, i) {
    var n = suitesOf(c).filter(function (s) { return s && s.buildingId === b.id; }).length, ph = photosOf(b), edit = canEdit(), link = liveLink('building', b), shown = b.visible !== false;
    return '<div class="lv-bd' + (shown ? '' : ' off') + '"><button type="button" class="lv-th" data-openb="' + i + '" aria-label="Edit ' + esc(b.name) + '">' + (ph[0] && thumb(ph[0]) ? imgHTML(ph[0], '') : O.icon('properties')) + '</button>' +
      '<div style="min-width:0"><button type="button" class="t1" data-openb="' + i + '">' + esc(b.name || 'Unnamed building') + '</button><div class="t2">' + esc([b.city, b.area].filter(Boolean).join(' · ') || 'Add the city') + '</div>' +
      '<div class="t2">' + fmt.plural(n, 'unit') + ' · ' + fmt.plural(ph.length, 'photo') + (shown ? '' : ' · hidden') + '</div></div>' +
      '<div class="acts"><button type="button" class="switch' + (shown ? ' on' : '') + '" role="switch" aria-checked="' + shown + '" aria-label="Show ' + esc(b.name) + ' on the website" data-showb="' + i + '"' + (edit ? '' : ' disabled title="' + NO_EDIT() + '"') + '></button>' +
      '<button type="button" class="lv-ib" data-moveb="up" data-i="' + i + '" aria-label="Move ' + esc(b.name) + ' earlier"' + (edit && i > 0 ? '' : ' disabled') + '>' + O.icon('up') + '</button>' +
      '<button type="button" class="lv-ib" data-moveb="down" data-i="' + i + '" aria-label="Move ' + esc(b.name) + ' later"' + (edit && i < buildingsOf(c).length - 1 ? '' : ' disabled') + '>' + O.icon('down') + '</button>' +
      (link ? '<a class="lv-ib" href="' + esc(link) + '" target="_blank" rel="noopener" aria-label="View ' + esc(b.name) + ' on the website" title="View on site">' + O.icon('eye') + '</a>' : '') + '</div></div>';
  }
  function unitCardHTML(s, i, k, n) {
    var ph = photosOf(s), edit = canEdit(), shown = s.visible !== false, link = liveLink('unit', s);
    return '<div class="lv-card' + (shown ? '' : ' off') + '">' +
      '<button type="button" class="lv-ph" data-openu="' + i + '" aria-label="Edit ' + esc(s.name) + '">' + (ph[0] && thumb(ph[0]) ? imgHTML(ph[0], '') : noPhoto(ph.length ? '' : 'No photos yet')) +
      (shown ? '' : U.pill('Hidden', 'neutral')) + (ph.length ? '<span class="cnt">' + O.icon('image') + ph.length + '</span>' : '') + '</button>' +
      '<div class="lv-b"><button type="button" class="lv-nm" data-openu="' + i + '">' + esc(s.name || 'Unnamed unit') + '</button>' +
      '<div class="lv-meta">' + esc([s.levels, fmt.plural(ph.length, 'photo')].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="lv-ft"><span class="sw"><button type="button" class="switch' + (shown ? ' on' : '') + '" role="switch" aria-checked="' + shown + '" aria-label="Show ' + esc(s.name) + ' on the website" data-showu="' + i + '"' + (edit ? '' : ' disabled title="' + NO_EDIT() + '"') + '></button>' + (shown ? 'Shown' : 'Hidden') + '</span>' +
      '<button type="button" class="lv-ib" data-moveu="up" data-i="' + i + '" aria-label="Move ' + esc(s.name) + ' earlier"' + (edit && k > 0 ? '' : ' disabled') + '>' + O.icon('left') + '</button>' +
      '<button type="button" class="lv-ib" data-moveu="down" data-i="' + i + '" aria-label="Move ' + esc(s.name) + ' later"' + (edit && k < n - 1 ? '' : ' disabled') + '>' + O.icon('right') + '</button>' +
      (link ? '<a class="lv-ib" href="' + esc(link) + '" target="_blank" rel="noopener" aria-label="View ' + esc(s.name) + ' on the website" title="View on site">' + O.icon('eye') + '</a>' : '') +
      '</div></div></div>';
  }

  function render(root, ctx) {
    var c = draft();
    root.innerHTML = '<div class="pg-live">' + topHTML(c) + (c ? bodyHTML(c) : emptyHTML()) + '</div>';
    var wrap = O.$('.pg-live', root);
    wrap.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act],[data-openu],[data-openb],[data-showu],[data-showb],[data-moveu],[data-moveb],[data-addunit]');
      if (!t || t.disabled) return;
      var c2 = draft(), a = t.dataset.act;
      if (a === 'publish') return publishFlow();
      if (a === 'address') return addressModal();
      if (a === 'import') return importNow(wrap);
      if (a === 'start') { if (!canEdit()) return; D.siteContent = SC.empty(); save(); setTimeout(function () { openBuilding(-1); }, 0); return; }
      if (a === 'addbuilding') return openBuilding(-1);
      if (t.dataset.addunit) return openUnit(-1, t.dataset.addunit);
      if (t.dataset.openu) return openUnit(+t.dataset.openu);
      if (t.dataset.openb) return openBuilding(+t.dataset.openb);
      if (!c2 || !canEdit()) return;
      if (t.dataset.showu) { var s = suitesOf(c2)[+t.dataset.showu]; if (s) { s.visible = s.visible === false; save(); U.toast(s.name + (s.visible ? ' will be shown' : ' will be hidden') + ' after you Publish.'); } return; }
      if (t.dataset.showb) { var b = buildingsOf(c2)[+t.dataset.showb]; if (b) { b.visible = b.visible === false; save(); U.toast(b.name + (b.visible ? ' will be shown' : ' will be hidden') + ' after you Publish.'); } return; }
      if (t.dataset.moveu) return moveUnit(c2, +t.dataset.i, t.dataset.moveu === 'up' ? -1 : 1);
      if (t.dataset.moveb) { var i = +t.dataset.i, j = i + (t.dataset.moveb === 'up' ? -1 : 1), list = buildingsOf(c2); if (j < 0 || j >= list.length) return; var x = list[i]; list[i] = list[j]; list[j] = x; save(); }
    });
    var deep = ctx.params || {};
    if (deep.unit != null && draft()) { var ui = +deep.unit; deep.unit = null; setTimeout(function () { openUnit(ui); }, 0); }
  }
  /* a unit moves past the next unit of the same building (other buildings' units keep their places) */
  function moveUnit(c, i, dir) {
    var list = suitesOf(c), s = list[i]; if (!s) return;
    for (var j = i + dir; j >= 0 && j < list.length; j += dir) {
      if (list[j] && list[j].buildingId === s.buildingId) { list[i] = list[j]; list[j] = s; save(); return; }
    }
  }

  /* ------------------------------------------------------------------ the site address and bringing in the content */
  function normUrl(v) {
    v = String(v || '').trim().toLowerCase().replace(/\/+$/, '');
    if (v && !/^[a-z]+:\/\//.test(v)) v = 'https://' + v;
    return /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/.test(v) ? v : null;
  }
  function setSiteUrl(u) {
    var w = D.website && typeof D.website === 'object' && !Array.isArray(D.website) ? D.website : (D.website = {});
    w.siteUrl = u; builtinCache = null;
  }
  function addressModal() {
    if (!canEdit()) { U.toast(NO_EDIT() + '.', 'bad'); return; }
    U.modal({
      title: 'Your website address', size: 'sm',
      body: '<div class="field"><label for="lv-site">Address</label><input class="input" id="lv-site" type="url" inputmode="url" maxlength="120" placeholder="https://www.example.com" value="' + esc(siteUrl()) + '"><div class="hint">The address guests type, for example https://www.staykozi.my. Publish refreshes its pages.</div><div class="lv-err" data-err></div></div>',
      actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: function (close, el) {
        var u = normUrl(O.$('#lv-site', el).value);
        if (!u) { O.$('[data-err]', el).textContent = 'Use the full address, for example https://www.example.com'; O.$('[data-err]', el).style.color = 'var(--bad)'; return false; }
        setSiteUrl(u); save(); U.toast('Website address saved.');
      } }]
    });
  }
  function fetchJson(url) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, timer = ctl ? setTimeout(function () { ctl.abort(); }, 10000) : null;
    return fetch(url, { cache: 'no-store', credentials: 'omit', signal: ctl ? ctl.signal : undefined }).then(function (r) {
      if (!r.ok) throw new Error('status ' + r.status);
      return r.json();
    }).then(function (j) { clearTimeout(timer); if (!j || typeof j !== 'object') throw new Error('not json'); return j; }, function (e) { clearTimeout(timer); throw e; });
  }
  /* <site>/content.json (the site serves it to anyone), else the preview site's copy */
  function sourceJson() {
    var u = siteUrl();
    var first = u ? fetchJson(u + '/content.json') : Promise.reject(new Error('no address'));
    return first.catch(function () { return fetchJson(FALLBACK_SOURCE + '/content.json'); });
  }
  function importNow(wrap) {
    if (!canEdit()) { U.toast(NO_EDIT() + '.', 'bad'); return; }
    var inp = wrap && O.$('[data-site0]', wrap);
    if (inp && inp.value.trim()) { var u = normUrl(inp.value); if (!u) { U.toast('Use the full website address, for example https://www.example.com', 'bad'); inp.focus(); return; } setSiteUrl(u); }
    var c = draft(), go = function () {
      st.importing = true; O.render(false);
      sourceJson().then(function (j) {
        st.importing = false;
        if (Array.isArray(j.builtinPhotos)) builtinCache = j.builtinPhotos;
        var r = SC.check(j, { bookTypes: null, uploadPrefixes: [] });
        D.siteContent = r.content; save();
        U.toast('Brought in ' + fmt.plural(r.content.buildings.length, 'building') + ' and ' + fmt.plural(r.content.suites.length, 'unit') + '. Check them, then Publish when you are ready.');
      }, function () {
        st.importing = false; O.render(false);
        U.toast('The website could not be reached. Check its address and your connection, or start empty.', 'bad');
      });
    };
    if (c && (buildingsOf(c).length || suitesOf(c).length)) U.confirm('This replaces the buildings, units and photos here with what the website shows now. Changes you have not published are lost.', 'Bring it in', 'danger', 'Bring in the website?').then(function (ok) { if (ok) go(); });
    else go();
  }
  function builtinPhotos() {
    if (builtinCache) return Promise.resolve(builtinCache);
    return sourceJson().then(function (j) { builtinCache = Array.isArray(j.builtinPhotos) ? j.builtinPhotos : []; return builtinCache; });
  }

  /* ------------------------------------------------------------------ publish */
  function publishFlow() {
    var c = draft();
    if (!c || !canPublish() || st.busy) return;
    var res = SC.check(c, checkOpts(true)), live = liveBlob();
    if (res.errors.length) {
      U.modal({ title: 'Fix these first', sub: 'Publish checks the content before it goes on the website.', body: '<ul class="lv-chg">' + res.errors.slice(0, 10).map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' + (res.errors.length > 10 ? '<p class="small muted">And ' + (res.errors.length - 10) + ' more.</p>' : ''), actions: [{ label: 'OK', kind: 'primary' }] });
      return;
    }
    var lines = SC.diff(live && live.content, res.content);
    if (live && live.content && !lines.length) { U.toast('Nothing has changed since the last publish.'); return; }
    var u = siteUrl();
    U.modal({
      title: 'Publish to ' + (u ? host(u) : 'the website') + '?', sub: 'What changes on the website:',
      body: '<ul class="lv-chg">' + lines.slice(0, 14).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + (lines.length > 14 ? '<li>And ' + (lines.length - 14) + ' more changes</li>' : '') + '</ul>' +
        (res.warnings.length ? '<div class="note warn"><b>Worth a look</b><ul class="lv-chg warn" style="margin:4px 0 0">' + res.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>' : '') +
        '<p class="small muted" style="margin:10px 0 0">' + (server() ? 'The website shows the change within a minute.' : 'This is the test copy: only this browser\'s copy changes.') + '</p>',
      actions: [{ label: 'Cancel' }, { label: 'Publish', kind: 'primary', id: 'lv-publish-go', onClick: function () { runPublish(res); } }]
    });
  }
  function setBusy(on) { st.busy = on; var b = O.$('.pg-live [data-act=publish]'); if (b) { b.disabled = on || !canPublish(); b.innerHTML = O.icon('upload') + (on ? 'Publishing…' : 'Publish'); } }
  function runPublish(res) {
    setBusy(true);
    if (!server()) {
      var prev = liveBlob(), at = new Date().toISOString(), v = O.viewer();
      D.siteContentLive = { content: res.content, publishedAt: at, publishedBy: v ? v.name : 'You', history: [at].concat(prev && Array.isArray(prev.history) ? prev.history : []).slice(0, 20) };
      st.busy = false; save();
      U.toast('Published in this test copy. The live website changes only from the online version of Orbique.');
      return;
    }
    Promise.resolve(O.sync.flush()).then(function () {
      return api('publish', { draftHash: SC.hash(SC.canon(D.siteContent)) });
    }).then(function (r) {
      st.busy = false;
      if (r && r.live) O.sync.remote([], [{ key: 'siteContentLive', data: r.live }]);
      O.render(false);
      var pages = fmt.plural(r.refreshed || 0, 'page');
      if (r.failed && r.failed.length) U.toast('Published. ' + (r.refreshed ? pages + ' refreshed, ' : '') + fmt.plural(r.failed.length, 'page') + ' could not be refreshed now. They update within 5 minutes.', 'bad');
      else if (r.note) U.toast('Published. ' + r.note);
      else U.toast('Published. ' + pages + ' of the website refreshed.');
    }, function (e) {
      setBusy(false);
      var probs = e && e.body && Array.isArray(e.body.problems) ? e.body.problems : null;
      if (probs && probs.length) U.modal({ title: 'Fix these first', body: '<ul class="lv-chg">' + probs.slice(0, 10).map(function (p) { return '<li>' + esc(p.message) + '</li>'; }).join('') + '</ul>', actions: [{ label: 'OK', kind: 'primary' }] });
      else U.toast((e && e.message) || 'Publishing did not work. Please try again.', 'bad');
    });
  }

  /* ------------------------------------------------------------------ drawers */
  function fld(name, label, input, o) {
    o = o || {};
    return '<div class="field' + (o.full ? ' full' : '') + '"><label for="lv-' + name + '">' + esc(label) + (o.opt ? ' <span class="opt">(optional)</span>' : '') + '</label>' + input +
      (o.hint != null ? '<div class="hint"' + (o.hintAttr || '') + '>' + o.hint + '</div>' : '') + '<div class="lv-err" data-err="' + name + '"></div></div>';
  }
  function inp(name, val, attrs) { return '<input class="input" id="lv-' + name + '" name="' + name + '" value="' + esc(val == null ? '' : val) + '"' + (attrs || '') + '>'; }
  function area(name, val, rows, max) { return '<textarea class="textarea" id="lv-' + name + '" name="' + name + '" rows="' + rows + '" maxlength="' + max + '">' + esc(val || '') + '</textarea>'; }
  function check(name, on, label) { return '<label class="check"><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + '><span>' + esc(label) + '</span></label>'; }

  function openDrawer(kind, index, dr0) {
    closeDrawer(true);
    var dr = U.drawer({ title: '', body: '', foot: '<span></span>' });
    dr.el.classList.add('lv-dr');
    DR = Object.assign({ dr: dr, kind: kind, index: index, dirty: false }, dr0);
    var guard = function () {
      if (!DR) return;
      var up = DR.pm && DR.pm.pending.some(function (p) { return p.status !== 'error'; });
      if (up) U.confirm('Photos are still uploading. Close and leave them out?', 'Close', 'danger').then(function (ok) { if (ok) closeDrawer(true); });
      else if (DR.dirty) U.confirm('Discard your changes?', 'Discard', 'danger').then(function (ok) { if (ok) closeDrawer(true); });
      else closeDrawer(true);
    };
    var back = dr.el.previousElementSibling; if (back && back.classList.contains('drawer-back')) back.onclick = guard;
    O.$('.modal-x', dr.el).onclick = guard;
    DR.guard = guard;
    /* Escape asks first, like the close button (the drawer's own Escape would close it straight away) */
    DR.esc = function (e) { if (e.key === 'Escape' && DR && !O.$('.modal-back')) { e.stopImmediatePropagation(); guard(); } };
    document.addEventListener('keydown', DR.esc, true);
    dr.el.addEventListener('input', onInput);
    dr.el.addEventListener('change', onInput);
    dr.el.addEventListener('click', onClick);
    dr.el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('[data-hlin]')) { e.preventDefault(); addHighlight(); } });
    return DR;
  }
  function closeDrawer(force) {
    if (!DR) return;
    var x = DR; DR = null;
    document.removeEventListener('keydown', x.esc, true);
    if (x.pm) x.pm.abort();
    x.dr.close();
  }
  function parts() { var el = DR.dr.el; return { h: O.$('.modal-head h3', el), sub: O.$('.modal-head .sub', el), body: O.$('.modal-body', el), foot: O.$('.modal-foot', el) }; }
  function val(name) { var el = O.$('[name="' + name + '"]', DR.dr.el); return el ? (el.type === 'checkbox' ? el.checked : String(el.value)) : null; }
  function setErr(name, msg) {
    var box = O.$('[data-err="' + name + '"]', DR.dr.el); if (box) box.textContent = msg || '';
    var el = O.$('[name="' + name + '"]', DR.dr.el); if (el) el.classList.toggle('bad', !!msg);
  }
  function showErrors(E) {
    O.$$('.lv-err', DR.dr.el).forEach(function (x) { x.textContent = ''; });
    O.$$('.bad:not(.alt)', DR.dr.el).forEach(function (x) { x.classList.remove('bad'); }); /* the photo manager marks its own */
    var first = null;
    Object.keys(E).forEach(function (k) {
      setErr(k, E[k]);
      var el = O.$('[name="' + k + '"]', DR.dr.el) || O.$('[data-err="' + k + '"]', DR.dr.el); if (el && !first) first = el;
    });
    if (first) { first.scrollIntoView({ block: 'center', behavior: 'smooth' }); if (first.focus) try { first.focus({ preventScroll: true }); } catch (e) {} }
    var n = Object.keys(E).length;
    U.toast(n === 1 ? E[Object.keys(E)[0]] : 'Check the ' + n + ' highlighted fields.', 'bad');
  }

  /* ---- unit ---- */
  function openUnit(index, buildingId) {
    var c = draft(); if (!c) return;
    var s = index >= 0 ? suitesOf(c)[index] : null;
    if (index >= 0 && !s) return;
    if (!s && !canEdit()) { U.toast(NO_EDIT() + '.', 'bad'); return; }
    var bd = buildingId || (s && s.buildingId) || (buildingsOf(c)[0] && buildingsOf(c)[0].id) || '';
    var f = s ? clone(s) : { id: '', buildingId: bd, name: '', levels: '', line: '', story: '', highlights: [], views: [], bedrooms: 2, bathrooms: 2, sleeps: 4, extraBed: false, bookType: null, photos: [], visible: false };
    if (!Array.isArray(f.highlights)) f.highlights = [];
    if (!Array.isArray(f.views)) f.views = [];
    openDrawer('unit', index, { draft: f, slugTouched: !!s });
    var X = parts(), edit = canEdit();
    X.h.textContent = s ? (edit ? 'Edit ' + s.name : s.name) : 'Add a unit';
    X.sub.textContent = s ? 'Changes show on the website after you Publish' : 'New units start hidden. Show it when its photos are ready.';
    X.body.innerHTML = unitFormHTML(f, !s);
    DR.pm = photoManager(O.$('[data-photos]', X.body), f.photos, { name: function () { return val('name') || 'this unit'; }, onChange: function () { DR.dirty = true; } });
    X.foot.innerHTML = (s && edit ? '<button type="button" class="btn btn-ghost" data-de="remove" style="color:var(--bad)">' + O.icon('trash') + 'Remove</button>' : '<span></span>') +
      '<div class="r"><button type="button" class="btn btn-ghost" data-de="cancel">' + (edit ? 'Cancel' : 'Close') + '</button>' + (edit ? '<button type="button" class="btn btn-primary" data-de="save">' + (s ? 'Save' : 'Add unit') + '</button>' : '') + '</div>';
    if (!edit) O.$$('input, select, textarea, .lv-pt button, .lv-padd', X.body).forEach(function (x) { x.disabled = true; });
    paintUrl();
    if (!s) setTimeout(function () { var n = O.$('[name=name]', DR && DR.dr.el); if (n && !(window.matchMedia && window.matchMedia('(max-width:760px)').matches)) n.focus(); }, 40);
  }
  function unitFormHTML(f, isNew) {
    var c = draft(), bds = buildingsOf(c), tps = types();
    var bt = '<option value=""' + (f.bookType ? '' : ' selected') + '>Not bookable online yet (guests email us)</option>' + Object.keys(tps).map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === f.bookType ? ' selected' : '') + '>' + esc((tps[k] && tps[k].name) || k) + '</option>';
    }).join('') + (f.bookType && !tps[f.bookType] ? '<option value="' + esc(f.bookType) + '" selected>' + esc(f.bookType) + ' (not set up for online booking)</option>' : '');
    return '<form class="lv-form" novalidate autocomplete="off" onsubmit="return false">' +
      '<div class="lv-sec"><h4>Basics</h4><div class="sd">What guests read on the unit\'s page.</div><div class="form-grid">' +
      fld('name', 'Name', inp('name', f.name, ' maxlength="80" placeholder="e.g. Boutique Suite"'), { full: true }) +
      fld('id', 'Web address', inp('id', f.id, ' maxlength="60" placeholder="e.g. boutique" autocapitalize="off" spellcheck="false"'), { full: true, hint: '', hintAttr: ' data-url' }) +
      (bds.length > 1 || !buildingById(c, f.buildingId) ? fld('buildingId', 'Building', '<select class="select" id="lv-buildingId" name="buildingId"><option value="">Choose the building</option>' + bds.map(function (b) { return '<option value="' + esc(b.id) + '"' + (b.id === f.buildingId ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('') + '</select>', { full: true }) : '<input type="hidden" name="buildingId" value="' + esc(f.buildingId) + '">') +
      fld('levels', 'Floors', inp('levels', f.levels, ' maxlength="60" placeholder="e.g. Level 43"'), { opt: true }) +
      '<div class="field"><label>&nbsp;</label>' + check('visible', f.visible !== false, 'Show this unit on the website') + '</div>' +
      fld('line', 'One-line pitch', inp('line', f.line, ' maxlength="200" placeholder="e.g. Wake up to the Petronas Twin Towers"'), { full: true, opt: true }) +
      fld('story', 'Story', area('story', f.story, 5, 1500), { full: true, opt: true, hint: 'A short paragraph about the unit.' }) +
      '</div></div>' +
      '<div class="lv-sec"><h4>Rooms</h4><div class="form-grid">' +
      fld('bedrooms', 'Bedrooms', inp('bedrooms', f.bedrooms, ' type="number" min="0" max="20" step="1" inputmode="numeric"')) +
      fld('bathrooms', 'Bathrooms', inp('bathrooms', f.bathrooms, ' type="number" min="0" max="20" step="1" inputmode="numeric"')) +
      fld('sleeps', 'Sleeps', inp('sleeps', f.sleeps, ' type="number" min="0" max="20" step="1" inputmode="numeric"')) +
      '<div class="field"><label>&nbsp;</label>' + check('extraBed', f.extraBed, 'An extra bed for one more guest') + '</div>' +
      '</div></div>' +
      '<div class="lv-sec"><h4>Views</h4><div class="sd">Tick only what guests really see from this unit.</div><div class="lv-checks">' +
      VIEW_KEYS.map(function (k) { return check('view-' + k, f.views.indexOf(k) >= 0, SC.VIEW_NAMES[k]); }).join('') + '</div></div>' +
      '<div class="lv-sec"><h4>Highlights</h4><div class="sd">Up to 8 short points, for example "Study" or "Marble dining table".</div><div class="lv-hl" data-hl>' + hlHTML(f.highlights) + '</div>' +
      '<div class="lv-hladd"><input class="input" data-hlin maxlength="40" placeholder="Add a highlight" aria-label="New highlight"><button type="button" class="btn btn-ghost" data-de="hladd">' + O.icon('plus') + 'Add</button></div><div class="lv-err" data-err="highlights"></div></div>' +
      '<div class="lv-sec"><h4>Booking</h4><div class="form-grid">' +
      fld('bookType', 'Book online as', '<select class="select" id="lv-bookType" name="bookType">' + bt + '</select>', { full: true, hint: Object.keys(tps).length ? 'Guests see live prices and book this room type. Without it, the page says "Email us to book".' : 'Online booking is not set up for this workspace yet, so guests email to book.' }) +
      '</div></div>' +
      '<div class="lv-sec"><h4>Photos</h4><div class="sd">The first photo is the cover. Drag to reorder, or use the arrows. Each photo needs a short description for guests who cannot see it and for search engines.</div><div data-photos></div><div class="lv-err" data-err="photos"></div></div>' +
      '<div class="lv-sec"><h4>Search engines</h4><div class="sd">Optional. Left empty, the page uses the name and the pitch.</div><div class="form-grid">' +
      fld('seoTitle', 'Search title', inp('seoTitle', f.seoTitle || '', ' maxlength="70"'), { full: true, opt: true }) +
      fld('seoDescription', 'Search description', area('seoDescription', f.seoDescription || '', 2, 170), { full: true, opt: true }) +
      '</div></div></form>';
  }
  function hlHTML(list) { return list.map(function (h, i) { return '<span class="chip">' + esc(h) + '<button type="button" data-hldel="' + i + '" aria-label="Remove ' + esc(h) + '">×</button></span>'; }).join(''); }
  function addHighlight() {
    var box = O.$('[data-hlin]', DR.dr.el), v = String(box.value || '').replace(/\s+/g, ' ').trim(), list = DR.draft.highlights;
    if (!v) return;
    if (list.length >= SC.MAX.highlights) { setErr('highlights', 'Keep at most ' + SC.MAX.highlights + ' highlights. Remove one first.'); return; }
    if (list.indexOf(v) < 0) list.push(v.slice(0, SC.MAX.highlight));
    box.value = ''; setErr('highlights', ''); DR.dirty = true;
    O.$('[data-hl]', DR.dr.el).innerHTML = hlHTML(list);
  }
  /* "www.staykozi.my/kuala-lumpur/vortex-klcc/<web address>/" under the web address field */
  function paintUrl() {
    var box = DR && O.$('[data-url]', DR.dr.el); if (!box) return;
    var c = draft(), u = host(siteUrl()) || 'your website';
    if (DR.kind === 'unit') { var b = buildingById(c, val('buildingId')); box.textContent = b ? u + '/' + b.cityId + '/' + b.id + '/' + (val('id') || '…') + '/' : 'Choose the building first.'; }
    else box.textContent = u + '/' + (val('cityId') || '…') + '/' + (val('id') || '…') + '/';
    if (DR.index >= 0) box.textContent += ' Changing it changes the page\'s address.';
  }
  function takenUnit(c, bdId, skip) { return suitesOf(c).filter(function (s, i) { return i !== skip && s && s.buildingId === bdId; }).map(function (s) { return s.id; }); }
  function onInput(e) {
    if (!DR) return;
    var t = e.target;
    if (t.matches('[data-alt]')) return; /* the photo manager listens itself */
    if (!t.name) return;
    DR.dirty = true; setErr(t.name, '');
    var c = draft();
    if (DR.kind === 'unit' && t.name === 'name' && !DR.slugTouched) { var sl = O.$('[name=id]', DR.dr.el); sl.value = SC.uniqueSlug(t.value, takenUnit(c, val('buildingId'), DR.index)); }
    if (DR.kind === 'building' && t.name === 'name' && !DR.slugTouched) { var bl = O.$('[name=id]', DR.dr.el); bl.value = SC.uniqueSlug(t.value, buildingsOf(c).filter(function (b, i) { return i !== DR.index; }).map(function (b) { return b.id; })); }
    if (DR.kind === 'building' && t.name === 'city' && !DR.cityTouched) { var cb = O.$('[name=cityId]', DR.dr.el); cb.value = SC.slugify(t.value); }
    if (t.name === 'id') DR.slugTouched = true;
    if (t.name === 'cityId') DR.cityTouched = true;
    paintUrl();
  }
  function onClick(e) {
    if (!DR) return;
    var hd = e.target.closest('[data-hldel]');
    if (hd) { DR.draft.highlights.splice(+hd.dataset.hldel, 1); DR.dirty = true; O.$('[data-hl]', DR.dr.el).innerHTML = hlHTML(DR.draft.highlights); return; }
    var de = e.target.closest('[data-de]'); if (!de) return;
    var a = de.dataset.de;
    if (a === 'hladd') return addHighlight();
    if (a === 'cancel') return DR.guard();
    if (a === 'save') return DR.kind === 'unit' ? saveUnit() : saveBuilding();
    if (a === 'remove') return DR.kind === 'unit' ? removeUnit() : removeBuilding();
  }
  function intField(name, E, label) {
    var raw = val(name), n = raw === '' || raw == null ? 0 : Number(raw);
    if (!(n >= 0 && n <= 20 && Math.floor(n) === n)) E[name] = label + ': use a whole number from 0 to 20.';
    return n;
  }
  function photoErrors(E) {
    if (DR.pm.pending.some(function (p) { return p.status !== 'error'; })) { E.photos = 'Wait a moment, photos are still uploading.'; return; }
    var miss = DR.pm.list.filter(function (p) { return !String(p.alt || '').trim(); }).length;
    if (miss) { E.photos = miss === 1 ? 'Add a description to the photo marked in red.' : 'Add a description to the ' + miss + ' photos marked in red.'; DR.pm.paint(true); }
  }
  function saveUnit() {
    var c = draft(), f = DR.draft, E = {};
    var name = String(val('name') || '').replace(/\s+/g, ' ').trim(), id = String(val('id') || '').trim().toLowerCase(), bdId = val('buildingId');
    if (!name) E.name = 'Add the unit\'s name.';
    if (!buildingById(c, bdId)) E.buildingId = 'Choose the building it is in.';
    if (!id) id = SC.uniqueSlug(name, takenUnit(c, bdId, DR.index));
    if (!SC.SLUG.test(id) || id.length > 60) E.id = 'Use small letters, numbers and single dashes, for example boutique-suite.';
    else if (takenUnit(c, bdId, DR.index).indexOf(id) >= 0) E.id = 'Another unit in this building already uses this web address.';
    var out = {
      id: id, buildingId: bdId, name: name, levels: String(val('levels') || '').trim(), line: String(val('line') || '').trim(), story: String(val('story') || '').trim(),
      highlights: f.highlights.slice(0, SC.MAX.highlights), views: VIEW_KEYS.filter(function (k) { return val('view-' + k); }),
      bedrooms: intField('bedrooms', E, 'Bedrooms'), bathrooms: intField('bathrooms', E, 'Bathrooms'), sleeps: intField('sleeps', E, 'Sleeps'),
      extraBed: !!val('extraBed'), bookType: val('bookType') || null, photos: clone(DR.pm.list), visible: !!val('visible')
    };
    var seoT = String(val('seoTitle') || '').trim(), seoD = String(val('seoDescription') || '').trim();
    if (seoT) out.seoTitle = seoT; if (seoD) out.seoDescription = seoD;
    photoErrors(E);
    if (Object.keys(E).length) { showErrors(E); return; }
    var list = suitesOf(c), isNew = DR.index < 0;
    if (isNew) list.push(out); else list[DR.index] = out;
    var where = isNew ? list.length - 1 : DR.index;
    DR.dirty = false; closeDrawer(true); save();
    U.toast((isNew ? name + ' added' : 'Saved ' + name) + '. Publish to show the change on the website.');
    return where;
  }
  function removeUnit() {
    var c = draft(), s = suitesOf(c)[DR.index]; if (!s) return;
    U.confirm('Remove ' + s.name + ' from the website? Its page goes away after you Publish. Its photos stay in storage.', 'Remove', 'danger', 'Remove this unit?').then(function (ok) {
      if (!ok || !DR) return;
      var i = suitesOf(c).indexOf(s); if (i >= 0) suitesOf(c).splice(i, 1);
      closeDrawer(true); save(); U.toast(s.name + ' removed. Publish to take it off the website.');
    });
  }

  /* ---- building ---- */
  function openBuilding(index) {
    var c = draft();
    if (!c) { if (!canEdit()) return; D.siteContent = c = SC.empty(); save(); }
    var b = index >= 0 ? buildingsOf(c)[index] : null;
    if (index >= 0 && !b) return;
    if (!b && !canEdit()) { U.toast(NO_EDIT() + '.', 'bad'); return; }
    var first = buildingsOf(c)[0];
    var f = b ? clone(b) : { id: '', cityId: first ? first.cityId : '', city: first ? first.city : '', name: '', building: '', address: '', area: '', intro: '', checkIn: first ? first.checkIn : '3:00 pm', checkOut: first ? first.checkOut : '11:00 am', photos: [], visible: true };
    openDrawer('building', index, { draft: f, slugTouched: !!b, cityTouched: !!(b || first) });
    var X = parts(), edit = canEdit();
    X.h.textContent = b ? (edit ? 'Edit ' + b.name : b.name) : 'Add a building';
    X.sub.textContent = b ? 'Changes show on the website after you Publish' : 'A building gets its own page, with its units under it.';
    X.body.innerHTML = '<form class="lv-form" novalidate autocomplete="off" onsubmit="return false">' +
      '<div class="lv-sec"><h4>Basics</h4><div class="form-grid">' +
      fld('name', 'Name on the website', inp('name', f.name, ' maxlength="80" placeholder="e.g. Kozi @ Vortex KLCC"'), { full: true }) +
      fld('id', 'Web address', inp('id', f.id, ' maxlength="60" placeholder="e.g. vortex-klcc" autocapitalize="off" spellcheck="false"'), { full: true, hint: '', hintAttr: ' data-url' }) +
      fld('city', 'City', inp('city', f.city, ' maxlength="80" placeholder="e.g. Kuala Lumpur"')) +
      fld('cityId', 'City web address', inp('cityId', f.cityId, ' maxlength="60" placeholder="e.g. kuala-lumpur" autocapitalize="off" spellcheck="false"')) +
      fld('building', 'The building\'s own name', inp('building', f.building, ' maxlength="80" placeholder="e.g. Vortex Suites KLCC"'), { opt: true }) +
      '<div class="field"><label>&nbsp;</label>' + check('visible', f.visible !== false, 'Show this building on the website') + '</div>' +
      fld('address', 'Address', inp('address', f.address, ' maxlength="200"'), { full: true, opt: true }) +
      fld('area', 'Area', inp('area', f.area, ' maxlength="120" placeholder="e.g. Golden Triangle, between KLCC and Bukit Bintang"'), { full: true, opt: true }) +
      fld('intro', 'Introduction', area('intro', f.intro, 5, 1200), { full: true, opt: true }) +
      fld('checkIn', 'Check-in from', inp('checkIn', f.checkIn, ' maxlength="20" placeholder="3:00 pm"'), { opt: true }) +
      fld('checkOut', 'Check-out by', inp('checkOut', f.checkOut, ' maxlength="20" placeholder="11:00 am"'), { opt: true }) +
      '</div></div>' +
      '<div class="lv-sec"><h4>Photos</h4><div class="sd">Photos of the building and its shared spaces. The first is the cover.</div><div data-photos></div><div class="lv-err" data-err="photos"></div></div></form>';
    DR.pm = photoManager(O.$('[data-photos]', X.body), f.photos, { name: function () { return val('name') || 'this building'; }, onChange: function () { DR.dirty = true; } });
    var n = b ? suitesOf(c).filter(function (s) { return s.buildingId === b.id; }).length : 0;
    X.foot.innerHTML = (b && edit ? '<button type="button" class="btn btn-ghost" data-de="remove" style="color:var(--bad)">' + O.icon('trash') + 'Remove</button>' : '<span></span>') +
      '<div class="r"><button type="button" class="btn btn-ghost" data-de="cancel">' + (edit ? 'Cancel' : 'Close') + '</button>' + (edit ? '<button type="button" class="btn btn-primary" data-de="save">' + (b ? 'Save' : 'Add building') + '</button>' : '') + '</div>';
    DR.units = n;
    if (!edit) O.$$('input, select, textarea, .lv-pt button, .lv-padd', X.body).forEach(function (x) { x.disabled = true; });
    paintUrl();
  }
  function saveBuilding() {
    var c = draft(), E = {}, txt = function (n) { return String(val(n) || '').replace(/\s+/g, ' ').trim(); };
    var out = {
      id: txt('id').toLowerCase(), cityId: txt('cityId').toLowerCase(), city: txt('city'), name: txt('name'), building: txt('building'), address: txt('address'), area: txt('area'),
      intro: String(val('intro') || '').trim(), checkIn: txt('checkIn'), checkOut: txt('checkOut'), photos: clone(DR.pm.list), visible: !!val('visible')
    };
    if (!out.name) E.name = 'Add the building\'s name.';
    if (!out.city) E.city = 'Add the city.';
    if (!out.id && out.name) out.id = SC.uniqueSlug(out.name, buildingsOf(c).filter(function (b, i) { return i !== DR.index; }).map(function (b) { return b.id; }));
    if (!out.cityId && out.city) out.cityId = SC.slugify(out.city);
    var others = buildingsOf(c).filter(function (b, i) { return i !== DR.index; });
    if (!SC.SLUG.test(out.id) || out.id.length > 60) E.id = 'Use small letters, numbers and single dashes, for example vortex-klcc.';
    else if (others.some(function (b) { return b.id === out.id; })) E.id = 'Another building already uses this web address.';
    if (out.city && (!SC.SLUG.test(out.cityId) || out.cityId.length > 60)) E.cityId = 'Use small letters, numbers and single dashes, for example kuala-lumpur.';
    var same = others.filter(function (b) { return b.cityId === out.cityId && b.city !== out.city; })[0];
    if (!E.cityId && same) E.city = 'Another building uses this city web address with the city "' + same.city + '". Use the same spelling.';
    photoErrors(E);
    if (Object.keys(E).length) { showErrors(E); return; }
    var list = buildingsOf(c), isNew = DR.index < 0, old = isNew ? null : list[DR.index];
    if (isNew) list.push(out); else list[DR.index] = out;
    if (old && old.id !== out.id) suitesOf(c).forEach(function (s) { if (s.buildingId === old.id) s.buildingId = out.id; });
    DR.dirty = false; closeDrawer(true); save();
    U.toast((isNew ? out.name + ' added. Now add its units.' : 'Saved ' + out.name + '.') + ' Publish to show the change on the website.');
  }
  function removeBuilding() {
    var c = draft(), b = buildingsOf(c)[DR.index]; if (!b) return;
    var n = suitesOf(c).filter(function (s) { return s.buildingId === b.id; }).length;
    U.confirm('Remove ' + b.name + (n ? ' and its ' + fmt.plural(n, 'unit') : '') + ' from the website? The pages go away after you Publish. Photos stay in storage.', 'Remove', 'danger', 'Remove this building?').then(function (ok) {
      if (!ok || !DR) return;
      var i = buildingsOf(c).indexOf(b); if (i >= 0) buildingsOf(c).splice(i, 1);
      for (var k = suitesOf(c).length - 1; k >= 0; k--) if (suitesOf(c)[k].buildingId === b.id) suitesOf(c).splice(k, 1);
      closeDrawer(true); save(); U.toast(b.name + ' removed. Publish to take it off the website.');
    });
  }

  /* ------------------------------------------------------------------ photo manager (buildings and units)
     list: the photos (edited in place); pending: photos being prepared or uploaded {key, file, name, preview, status, pct, error, alt, xhrs}.
     Order: drag and drop (desktop), or the arrow buttons (keyboard, phone). */
  function photoManager(box, list, opts) {
    var pm = { list: list, pending: [], box: box, drag: -1, queue: Promise.resolve(), closed: false };
    var seq = 0;
    function changed() { if (opts.onChange) opts.onChange(); }
    function tile(p, i, n, strictAlt) {
      var miss = strictAlt && !String(p.alt || '').trim();
      return '<div class="lv-pt" draggable="true" data-pi="' + i + '"><div class="im">' + (imgHTML(p, '') || noPhoto('')) + (i === 0 ? '<span class="cover">Cover</span>' : '') + (p.kind === 'builtin' ? '<span class="kind">Bundled</span>' : '') +
        '<div class="bar"><button type="button" data-pm="left" data-i="' + i + '" aria-label="Move photo ' + (i + 1) + ' earlier"' + (i === 0 ? ' disabled' : '') + '>' + O.icon('left') + '</button>' +
        '<button type="button" data-pm="right" data-i="' + i + '" aria-label="Move photo ' + (i + 1) + ' later"' + (i === n - 1 ? ' disabled' : '') + '>' + O.icon('right') + '</button>' +
        (i > 0 ? '<button type="button" data-pm="cover" data-i="' + i + '" aria-label="Make photo ' + (i + 1) + ' the cover" title="Make cover">' + O.icon('star') + '</button>' : '') +
        '<button type="button" data-pm="del" data-i="' + i + '" aria-label="Remove photo ' + (i + 1) + '">' + O.icon('trash') + '</button></div></div>' +
        '<input class="input alt' + (miss ? ' bad' : '') + '" data-alt="' + i + '" value="' + esc(p.alt || '') + '" maxlength="160" placeholder="Describe the photo" aria-label="Description of photo ' + (i + 1) + '"></div>';
    }
    function pendingTile(p) {
      var label = p.status === 'wait' ? 'Waiting…' : p.status === 'prep' ? 'Preparing…' : p.status === 'up' ? 'Uploading ' + Math.round(p.pct) + '%' : p.error || 'Could not upload';
      return '<div class="lv-pt' + (p.status === 'error' ? ' err' : '') + '" data-pk="' + p.key + '"><div class="im">' + (p.preview ? '<img src="' + esc(p.preview) + '" alt="">' : noPhoto('')) +
        '<div class="up"><div class="row"><span data-lbl>' + esc(label) + '</span>' + (p.status === 'error' ? '<button type="button" data-pm="retry" data-k="' + p.key + '">Retry</button>' : '') + '<button type="button" data-pm="drop" data-k="' + p.key + '" aria-label="Leave this photo out">×</button></div>' +
        (p.status === 'error' ? '' : '<div class="progress"><i style="width:' + Math.max(3, Math.round(p.pct)) + '%"></i></div>') + '</div></div>' +
        '<input class="input alt" data-palt="' + p.key + '" value="' + esc(p.alt || '') + '" maxlength="160" placeholder="Describe the photo" aria-label="Description of the new photo"></div>';
    }
    pm.paint = function (strictAlt) {
      var n = pm.list.length, room = SC.MAX.photos - n - pm.pending.length;
      box.innerHTML = '<div class="lv-photos">' + pm.list.map(function (p, i) { return tile(p, i, n, strictAlt); }).join('') + pm.pending.map(pendingTile).join('') +
        (room > 0 ? '<label class="lv-padd">' + O.icon('camera') + '<b>Add photos</b><span>JPG, PNG, WebP or HEIC, up to 40 MB each</span><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple hidden data-pmfile aria-label="Add photos"></label>' : '') +
        (room > 0 && (siteUrl() || builtinCache) ? '<button type="button" class="lv-padd" data-pm="builtin">' + O.icon('image') + '<b>Bundled photos</b><span>Photos that come with the website</span></button>' : '') +
        '</div>' + (room <= 0 ? '<div class="hint">' + SC.MAX.photos + ' photos is the most. Remove one to add another.</div>' : '');
    };
    function move(from, to) {
      if (from === to || from < 0 || to < 0 || from >= pm.list.length || to >= pm.list.length) return;
      var x = pm.list.splice(from, 1)[0]; pm.list.splice(to, 0, x); changed(); pm.paint();
    }
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pm]'); if (!b || b.disabled) return;
      var a = b.dataset.pm, i = +b.dataset.i;
      if (a === 'left') { move(i, i - 1); focusTile(i - 1, 'left'); }
      if (a === 'right') { move(i, i + 1); focusTile(i + 1, 'right'); }
      if (a === 'cover') { move(i, 0); U.toast('That photo is the cover now.'); }
      if (a === 'del') { pm.list.splice(i, 1); changed(); pm.paint(); }
      if (a === 'retry') { var p = byKey(b.dataset.k); if (p) { p.status = 'wait'; p.pct = 0; p.error = null; pm.paint(); enqueue(p); } }
      if (a === 'drop') { var q = byKey(b.dataset.k); if (q) { abortOne(q); pm.pending.splice(pm.pending.indexOf(q), 1); pm.paint(); } }
      if (a === 'builtin') pickBuiltin();
    });
    function focusTile(i, dir) { var el = O.$('[data-pi="' + i + '"] [data-pm="' + dir + '"]', box) || O.$('[data-pi="' + i + '"] [data-pm]', box); if (el) try { el.focus(); } catch (e) {} }
    box.addEventListener('input', function (e) {
      var t = e.target;
      if (t.matches('[data-alt]')) { var p = pm.list[+t.dataset.alt]; if (p) { p.alt = t.value; if (t.value.trim()) t.classList.remove('bad'); changed(); } }
      if (t.matches('[data-palt]')) { var q = byKey(t.dataset.palt); if (q) { q.alt = t.value; changed(); } }
    });
    box.addEventListener('change', function (e) { if (e.target.matches('[data-pmfile]')) { addFiles(e.target.files); e.target.value = ''; } });
    /* drag and drop on desktop */
    box.addEventListener('dragstart', function (e) { var t = e.target.closest && e.target.closest('[data-pi]'); if (!t || e.target.matches('input')) return; pm.drag = +t.dataset.pi; t.classList.add('drag'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(pm.drag)); } catch (x) {} });
    box.addEventListener('dragover', function (e) { var t = e.target.closest && e.target.closest('[data-pi]'); if (!t || pm.drag < 0) return; e.preventDefault(); O.$$('.lv-pt.over', box).forEach(function (x) { if (x !== t) x.classList.remove('over'); }); t.classList.add('over'); });
    box.addEventListener('dragleave', function (e) { var t = e.target.closest && e.target.closest('[data-pi]'); if (t && !t.contains(e.relatedTarget)) t.classList.remove('over'); });
    box.addEventListener('drop', function (e) { var t = e.target.closest && e.target.closest('[data-pi]'); if (!t || pm.drag < 0) return; e.preventDefault(); var from = pm.drag; pm.drag = -1; move(from, +t.dataset.pi); });
    box.addEventListener('dragend', function () { pm.drag = -1; O.$$('.lv-pt.over, .lv-pt.drag', box).forEach(function (x) { x.classList.remove('over', 'drag'); }); });

    function byKey(k) { return pm.pending.filter(function (p) { return p.key === k; })[0] || null; }
    function abortOne(p) { (p.xhrs || []).forEach(function (x) { try { x.abort(); } catch (e) {} }); p.xhrs = []; if (p.preview) { try { URL.revokeObjectURL(p.preview); } catch (e) {} } }
    pm.abort = function () { pm.closed = true; pm.pending.forEach(abortOne); };
    function paintOne(p) {
      var el = O.$('[data-pk="' + p.key + '"]', box); if (!el) return;
      var lbl = O.$('[data-lbl]', el), bar = O.$('.progress > i', el);
      if (lbl) lbl.textContent = p.status === 'prep' ? 'Preparing…' : p.status === 'up' ? 'Uploading ' + Math.round(p.pct) + '%' : lbl.textContent;
      if (bar) bar.style.width = Math.max(3, Math.round(p.pct)) + '%';
    }
    function addFiles(files) {
      files = Array.prototype.slice.call(files || []);
      var room = SC.MAX.photos - pm.list.length - pm.pending.length, bad = [];
      if (files.length > room) U.toast(room > 0 ? 'Only ' + fmt.plural(room, 'more photo') + ' fit, so the first ' + room + ' were added.' : SC.MAX.photos + ' photos is the most.', 'bad');
      files.slice(0, Math.max(0, room)).forEach(function (file) {
        var heic = /\.(heic|heif)$/i.test(file.name || '') || /heic|heif/i.test(file.type || '');
        if (!/^image\//.test(file.type || '') && !heic) { bad.push('"' + (file.name || 'That file') + '" is not a photo. Choose a JPG, PNG, WebP or HEIC photo.'); return; }
        if (file.size > MAX_SOURCE) { bad.push('"' + (file.name || 'That photo') + '" is over 40 MB. Choose a smaller photo.'); return; }
        var p = { key: 'k' + (++seq), file: file, name: file.name || 'photo', preview: null, status: 'wait', pct: 0, error: null, alt: SC.readableAlt(file.name), xhrs: [] };
        try { p.preview = URL.createObjectURL(file); } catch (e) { p.preview = null; }
        pm.pending.push(p);
        enqueue(p);
      });
      pm.paint();
      if (bad.length) U.toast(bad[0], 'bad');
    }
    /* one photo at a time: decoding a large photo takes a lot of memory on a phone */
    function enqueue(p) { pm.queue = pm.queue.then(function () { return run(p); }); }
    function run(p) {
      if (pm.closed || pm.pending.indexOf(p) < 0) return null;
      p.status = 'prep'; p.pct = 2; paintOne(p);
      return makeSizes(p.file).then(function (made) {
        if (pm.closed || pm.pending.indexOf(p) < 0) return null;
        p.status = 'up'; p.pct = 5; paintOne(p);
        return send(made, p).then(function (ph) {
          if (pm.closed || pm.pending.indexOf(p) < 0) return;
          ph.alt = String(p.alt || '').trim().slice(0, SC.MAX.alt);
          pm.pending.splice(pm.pending.indexOf(p), 1);
          abortOne(p);
          pm.list.push(ph); changed(); pm.paint();
        });
      }).catch(function (e) {
        if (pm.closed || pm.pending.indexOf(p) < 0) return;
        p.status = 'error'; p.error = e && e.userMessage ? e.userMessage : 'Could not upload. Check the connection.';
        console.error('photo upload', e);
        pm.paint();
      });
    }
    /* the files to store: [{width, w, h, blob}] (largest first is how they are made; returned in width order) */
    function makeSizes(file) {
      return decode(file).then(function (img) {
        var plan = SC.planWidths(img.w, img.h).sort(function (a, b) { return b.width - a.width; }), src = img.source, made = [];
        return plan.reduce(function (pr, size) {
          return pr.then(function () {
            var cv = document.createElement('canvas'); cv.width = size.w; cv.height = size.h;
            var cx = cv.getContext('2d'); cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
            cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, size.w, size.h); cx.drawImage(src, 0, 0, size.w, size.h);
            src = cv; /* the next, smaller size is made from this one */
            return jpeg(cv, 0).then(function (blob) { made.push({ width: size.width, w: size.w, h: size.h, blob: blob }); });
          });
        }, Promise.resolve()).then(function () { if (img.close) img.close(); return made.sort(function (a, b) { return a.width - b.width; }); });
      });
    }
    function jpeg(cv, k) {
      return new Promise(function (res, rej) {
        cv.toBlob(function (b) {
          if (!b) { rej(userErr('This photo could not be made smaller here. Save it as JPG and try again.')); return; }
          if (b.size > 3 * 1024 * 1024 && k < QUALITY.length - 1) { jpeg(cv, k + 1).then(res, rej); return; }
          res(b);
        }, 'image/jpeg', QUALITY[k]);
      });
    }
    function userErr(m) { var e = new Error(m); e.userMessage = m; return e; }
    /* decode with the photo's own orientation (a phone photo taken sideways stays upright) */
    function decode(file) {
      var fail = function () { throw userErr('This photo could not be opened in this browser. Save it as JPG and try again.'); };
      if (typeof createImageBitmap === 'function') {
        return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bm) {
          return { source: bm, w: bm.width, h: bm.height, close: function () { try { bm.close(); } catch (e) {} } };
        }, function () { return viaImg(file).catch(fail); });
      }
      return viaImg(file).catch(fail);
    }
    function viaImg(file) {
      return new Promise(function (res, rej) {
        var url = URL.createObjectURL(file), im = new Image();
        im.onload = function () { var w = im.naturalWidth, h = im.naturalHeight; if (!w || !h) { URL.revokeObjectURL(url); rej(new Error('decode')); return; } res({ source: im, w: w, h: h, close: function () { URL.revokeObjectURL(url); } }); };
        im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('decode')); };
        im.src = url;
      });
    }
    /* upload every size: server -> signed URLs (PUT, as Supabase Storage expects); test copy -> this browser */
    function send(made, p) {
      var widths = made.map(function (m) { return m.width; }), big = made[made.length - 1];
      var done = function (id, base) { return { id: id, kind: 'upload', base: base, widths: widths, w: big.w, h: big.h, alt: '' }; };
      if (!server()) {
        var id = 'l' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        return new Promise(function (res, rej) {
          var r = new FileReader();
          r.onload = function () { O.store.set(localKey(id), r.result); p.pct = 100; paintOne(p); res(done(id, LOCAL_PREFIX + id)); };
          r.onerror = function () { rej(userErr('This browser could not keep the photo.')); };
          r.readAsDataURL(made[0].blob);
        });
      }
      var total = made.reduce(function (s, m) { return s + m.blob.size; }, 0), loaded = made.map(function () { return 0; });
      return Promise.resolve(api('upload-urls', { count: 1, widths: widths })).then(function (r) {
        var ph = r && r.photos && r.photos[0];
        if (!ph || !Array.isArray(ph.uploads)) throw userErr('The upload could not start. Please try again.');
        return Promise.all(made.map(function (m, k) {
          var u = ph.uploads.filter(function (x) { return x.width === m.width; })[0];
          if (!u) throw userErr('The upload could not start. Please try again.');
          return put(u.signedUrl, m.blob, p, function (n) { loaded[k] = n; p.pct = 5 + 95 * loaded.reduce(function (s, x) { return s + x; }, 0) / total; paintOne(p); });
        })).then(function () { return done(ph.id, ph.base); });
      });
    }
    function put(url, blob, p, onProgress) {
      return new Promise(function (res, rej) {
        var x = new XMLHttpRequest(); p.xhrs.push(x);
        x.open('PUT', url);
        x.setRequestHeader('x-upsert', 'true');
        x.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(Math.min(blob.size, e.loaded * blob.size / e.total)); };
        x.onload = function () { if (x.status >= 200 && x.status < 300) { onProgress(blob.size); res(); } else rej(userErr(x.status === 413 ? 'This photo is too large to store.' : 'Could not upload (' + x.status + '). Try again.')); };
        x.onerror = function () { rej(userErr('Could not upload. Check the connection.')); };
        x.onabort = function () { rej(userErr('Upload stopped.')); };
        var fd = new FormData(); fd.append('cacheControl', '31536000'); fd.append('', blob, 'photo.jpg');
        x.send(fd);
      });
    }
    /* bundled photos (from the site's content.json): add one back after it was removed */
    function pickBuiltin() {
      builtinPhotos().then(function (all) {
        var have = {}; pm.list.forEach(function (p) { if (p.kind === 'builtin') have[p.key] = 1; });
        var items = (all || []).filter(function (b) { return b && typeof b.key === 'string' && Array.isArray(b.widths); });
        if (!items.length) { U.toast('The website lists no bundled photos.', 'bad'); return; }
        var src = function (b) { return SC.photoSrc({ kind: 'builtin', key: b.key, widths: b.widths }, 640, siteUrl() || FALLBACK_SOURCE); };
        U.modal({
          title: 'Bundled photos', sub: 'Photos that come with the website. Tick the ones to add.', size: 'wide',
          body: '<div class="lv-pick">' + items.map(function (b, i) {
            var on = !!have[b.key];
            return '<label class="' + (on ? 'dis' : '') + '"><span class="im"><img src="' + esc(src(b)) + '" alt="" loading="lazy"><input type="checkbox" data-bi="' + i + '"' + (on ? ' disabled checked' : '') + '></span><span>' + esc(on ? 'Already added' : (b.alt || b.key)) + '</span></label>';
          }).join('') + '</div>',
          onOpen: function (el) { el.addEventListener('change', function (e) { var l = e.target.closest('label'); if (l && !e.target.disabled) l.classList.toggle('on', e.target.checked); }); },
          actions: [{ label: 'Cancel' }, { label: 'Add', kind: 'primary', onClick: function (close, el) {
            var picked = O.$$('[data-bi]:checked:not([disabled])', el).map(function (x) { return items[+x.dataset.bi]; });
            var ids = pm.list.map(function (p) { return p.id; });
            picked.slice(0, Math.max(0, SC.MAX.photos - pm.list.length - pm.pending.length)).forEach(function (b) {
              var id = SC.uniqueSlug('b-' + b.key, ids).slice(0, 64); ids.push(id);
              var big = Math.max.apply(null, b.widths.filter(function (w) { return SC.WIDTHS.indexOf(w) >= 0; }).concat([640]));
              pm.list.push({ id: id, kind: 'builtin', key: b.key, widths: SC.WIDTHS.filter(function (w) { return b.widths.indexOf(w) >= 0; }), w: Math.round(Number(b.w) || big), h: Math.round(Number(b.h) || big * 2 / 3), alt: String(b.alt || '').slice(0, SC.MAX.alt) });
            });
            if (picked.length) { changed(); pm.paint(); }
          } }]
        });
      }, function () { U.toast('The website could not be reached, so its bundled photos cannot be listed now.', 'bad'); });
    }
    pm.paint();
    return pm;
  }

  O.page('livesite', {
    desc: 'The units and photos on your website, and Publish',
    render: render
  });
})();
