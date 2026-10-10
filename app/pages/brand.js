/* Brand & Setup — logo upload, automatic colour picking, the colour rules, business details, new-subscriber setup */
(function () {
  var O = window.O, D = O.data, U = O.ui, C = O.color, esc = O.esc;
  var st = { swatchCache: {}, lastBrand: null };
  var SAMPLES = [
    ['orbique', 'Orbique'], ['otto', 'Otto'], ['coral', 'Coral Bay Stays'], ['hijau', 'Hijau Homes'], ['midnight', 'Midnight Suites'], ['lemon', 'Lemon Lofts']
  ];

  O.css('brand', `
.pg-brand .logo-stage{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px;}
.pg-brand .stage{border-radius:12px; height:120px; display:flex; align-items:center; justify-content:center; gap:10px; border:1px solid var(--border);}
.pg-brand .stage img{max-height:64px; max-width:70%;}
.pg-brand .stage .ws-logo{width:56px; height:56px; border-radius:14px;}
.pg-brand .stage .nm{font-family:var(--font-head); font-weight:800; font-size:18px;}
.pg-brand .drop{border:1.5px dashed var(--border-strong); border-radius:12px; padding:16px; text-align:center; color:var(--muted); font-size:12.5px; cursor:pointer; background:var(--surface-2);}
.pg-brand .drop.over{border-color:var(--brand-strong); background:var(--brand-soft-2);}
.pg-brand .drop b{color:var(--text);}
.pg-brand .drop svg{width:22px; height:22px; display:block; margin:0 auto 6px;}
.pg-brand .samples{display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;}
.pg-brand .sample{display:flex; align-items:center; gap:7px; padding:5px 10px 5px 5px; border:1px solid var(--border); border-radius:20px; background:var(--surface); font-size:12px; font-weight:700;}
.pg-brand .sample img{width:22px; height:22px; border-radius:6px;}
.pg-brand .sample.on{border-color:var(--brand-strong); box-shadow:0 0 0 1px var(--brand-strong) inset;}
.pg-brand .swatches{display:flex; gap:8px; flex-wrap:wrap;}
.pg-brand .sw{width:58px; text-align:center; font-size:10.5px; color:var(--muted); font-weight:600;}
.pg-brand .sw i{display:block; height:42px; border-radius:10px; border:1px solid rgba(0,0,0,0.08); margin-bottom:4px;}
.pg-brand .roles{display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px;}
.pg-brand .role{border:1px solid var(--border); border-radius:12px; padding:10px; display:flex; flex-direction:column; gap:8px;}
.pg-brand .role .chip-swatch{height:46px; border-radius:9px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:13px; border:1px solid rgba(0,0,0,0.06);}
.pg-brand .role .lbl{font-size:11.5px; font-weight:800;}
.pg-brand .role .desc{font-size:11px; color:var(--muted);}
.pg-brand .role .pickrow{display:flex; gap:5px; flex-wrap:wrap; align-items:center;}
.pg-brand .role .pickrow button{width:22px; height:22px; border-radius:6px; border:1px solid rgba(0,0,0,0.12); padding:0;}
.pg-brand .role .pickrow button.on{outline:2px solid var(--text); outline-offset:1px;}
.pg-brand .role input[type=color]{width:26px; height:24px; border:1px solid var(--border); border-radius:6px; padding:0; background:none;}
.pg-brand .ctr td:first-child{width:46%;}
.pg-brand .ctr .smp{display:inline-flex; align-items:center; justify-content:center; min-width:96px; height:28px; padding:0 10px; border-radius:7px; font-weight:800; font-size:12px; border:1px solid rgba(0,0,0,0.06);}
.pg-brand .tok{display:inline-block; width:16px; height:16px; border-radius:4px; vertical-align:-3px; margin-right:6px; border:1px solid rgba(0,0,0,0.1);}
.pg-brand .map td{vertical-align:top;}
.pg-brand .mini{display:grid; grid-template-columns:120px 1fr; height:230px; border-radius:12px; overflow:hidden; border:1px solid var(--border); font-size:11px;}
.pg-brand .mini .mside{background:var(--side-bg); color:var(--side-ink); padding:10px 8px; display:flex; flex-direction:column; gap:4px;}
.pg-brand .mini .mside .mlogo{display:flex; align-items:center; gap:6px; font-weight:800; font-family:var(--font-head); margin-bottom:6px;}
.pg-brand .mini .mside .mlogo .ws-logo{width:22px; height:22px; border-radius:6px;}
.pg-brand .mini .mside .mi{padding:5px 7px; border-radius:6px; opacity:0.85; font-weight:600;}
.pg-brand .mini .mside .mi.on{background:var(--side-active); color:var(--side-active-ink); opacity:1;}
.pg-brand .mini .mmain{background:var(--bg); padding:10px; display:flex; flex-direction:column; gap:8px; min-width:0;}
.pg-brand .mini .mbar{display:flex; align-items:center; justify-content:space-between; gap:6px;}
.pg-brand .mini .mbtn{background:var(--brand); color:var(--brand-ink); border-radius:6px; padding:4px 9px; font-weight:800;}
.pg-brand .mini .mchip{border:1px solid var(--border); border-radius:20px; padding:2px 8px; font-weight:700; background:var(--surface);}
.pg-brand .mini .mchip.on{background:var(--brand); color:var(--brand-ink); border-color:var(--brand);}
.pg-brand .mini .mbadge{background:var(--accent); color:var(--accent-ink); border-radius:10px; padding:1px 7px; font-weight:800;}
.pg-brand .mini .mcard{background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:8px; flex:1; min-height:0;}
.pg-brand .mini svg{width:100%; height:70px; display:block;}
.pg-brand .wiz-steps{display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap;}
.pg-brand .wiz-steps span, .wiz-steps span{font-size:11.5px; font-weight:700; padding:4px 10px; border-radius:20px; background:var(--surface-2); color:var(--muted); border:1px solid var(--border);}
.wiz-steps span.on{background:var(--brand); color:var(--brand-ink); border-color:var(--brand);}
.wiz-steps span.done{background:var(--ok-soft); color:var(--ok); border-color:transparent;}
@media (max-width:760px){ .pg-brand .roles{grid-template-columns:minmax(0,1fr);} .pg-brand .logo-stage{grid-template-columns:minmax(0,1fr);} .pg-brand .mini{grid-template-columns:90px 1fr;} }
`);

  function brandOf() { return O.ws().brand; }
  function extractCached(logo) {
    if (st.swatchCache[logo]) return Promise.resolve(st.swatchCache[logo]);
    return O.theme.extract(logo).then(function (r) { st.swatchCache[logo] = r; return r; });
  }
  function ratioRow(label, bg, fg, target, note) {
    var r = C.contrast(bg, fg), ok = r >= target;
    return '<tr><td><b>' + esc(label) + '</b><div class="xs muted">' + esc(note) + '</div></td><td><span class="smp" style="background:' + bg + ';color:' + fg + '">' + (fg.toUpperCase() === C.WHITE ? 'White text' : C.contrast(fg, C.BLACK) < 1.3 ? 'Black text' : 'Aa text') + '</span></td><td class="num">' + r.toFixed(1) + ':1</td><td>' + (ok ? '<span class="pill ok">Passes ' + (target >= 4.5 ? 'AA text' : 'graphics') + '</span>' : '<span class="pill warn">Low</span>') + '</td></tr>';
  }
  function miniPreview(tokens, ws, label) {
    var style = Object.keys(tokens).map(function (k) { return k + ':' + tokens[k]; }).join(';');
    return '<div class="mini" style="' + style + '"><div class="mside"><div class="mlogo">' + O.theme.logoHTML(ws, tokens['--side-bg']) + '<span>' + esc(label || ws.name) + '</span></div><div class="mi on">Dashboard</div><div class="mi">Bookings</div><div class="mi">Calendar</div><div class="mi">Guest Inbox <span class="mbadge">3</span></div><div class="mi">Invoices</div></div>' +
      '<div class="mmain"><div class="mbar"><b>Dashboard</b><span class="mbtn">+ New booking</span></div><div class="row-flex"><span class="mchip on">Airbnb</span><span class="mchip">Needs reply</span><span class="mbadge">5</span></div>' +
      '<div class="mcard"><div class="row-flex" style="justify-content:space-between"><b>Revenue, 1–6 Oct</b><span style="color:var(--brand-text);font-weight:700">View report</span></div><svg viewBox="0 0 200 70" preserveAspectRatio="none"><path d="M0 60 L40 50 L80 44 L120 32 L160 26 L200 12" fill="none" stroke="#C3C9D2" stroke-width="2"/><path d="M0 62 L40 54 L80 40 L120 30 L160 20 L200 8" fill="none" style="stroke:' + tokens['--brand-strong'] + '" stroke-width="2.5"/></svg></div></div></div>';
  }

  function render(root, ctx) {
    var ws = O.ws(), b = brandOf(), t = O.theme.tokens(b), owner = O.isOwner();
    root.innerHTML = '<div class="pg-brand stack">' +
      '<div class="note brand">The interface takes its colours from your logo. Upload a logo and the main colour, second colour and sidebar shade are picked automatically. Text on any coloured surface is always white on dark colours and black on light colours, whatever the brand.' + (owner ? '' : ' <b>Only the account owner can change the brand.</b>') + '</div>' +
      '<div class="grid g-2-1">' +
      '<div class="card"><div class="card-head"><div><h3>Your logo</h3><div class="sub">PNG, JPG, SVG or WebP. Transparent backgrounds work best.</div></div><span class="pill brand">' + esc(ws.name) + ' workspace</span></div><div class="card-body stack">' +
      '<div class="logo-stage"><div class="stage" style="background:#FFFFFF"><img src="' + esc(ws.logo) + '" alt="' + esc(ws.name) + ' logo on white"></div><div class="stage" style="background:' + t['--side-bg'] + ';color:' + t['--side-ink'] + '">' + O.theme.logoHTML(ws, t['--side-bg']) + '<span class="nm">' + esc(ws.name) + '</span></div></div>' +
      (owner ? '<label class="drop" data-drop>' + O.icon('upload') + '<div><b>Upload a new logo</b> or drop it here. The colours update straight away.</div><input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden data-file></label>' +
        '<div><div class="label">Or try a sample logo to see the colours change</div><div class="samples">' + SAMPLES.map(function (s) { var on = ws.logo === O.svgUrl(O.logos[s[0]]); return '<button type="button" class="sample' + (on ? ' on' : '') + '" data-sample="' + s[0] + '"><img src="' + esc(O.svgUrl(O.logos[s[0]])) + '" alt="">' + esc(s[1]) + '</button>'; }).join('') + '</div><div class="xs faint" style="margin-top:6px">Samples other than Orbique and Otto are made-up businesses for testing.</div></div>' : '') +
      '</div></div>' +
      '<div class="card"><div class="card-head"><div><h3>Live preview</h3><div class="sub">How these colours look across the app</div></div></div><div class="card-body">' + miniPreview(t, ws) + '</div></div>' +
      '</div>' +
      '<div class="card"><div class="card-head"><div><h3>Colours picked from your logo</h3><div class="sub" data-pickinfo>Reading your logo…</div></div>' + (owner ? '<div class="row-flex"><button class="btn btn-ghost btn-sm" data-act="auto">' + O.icon('sparkle') + 'Pick again from logo</button></div>' : '') + '</div><div class="card-body stack">' +
      '<div><div class="label" style="margin-bottom:6px">Found in your logo</div><div class="swatches" data-swatches></div></div>' +
      '<div class="roles">' + roleCard('primary', 'Main colour', 'Buttons, active menu item, selected filters, links, current period in charts', b.primary, owner) + roleCard('accent', 'Second colour', 'Badges and counters, highlights, website and guest app accents', b.accent, owner) + roleCard('dark', 'Dark colour', 'Base for the sidebar shade (falls back to the main colour)', b.dark || b.primary, owner) + '</div>' +
      '<div class="row-flex wrap"><span class="label">Sidebar style</span>' + U.seg([['deep', 'Deep shade'], ['light', 'Light'], ['brand', 'Main colour']], b.sideStyle || 'deep', 'data-side') + '<span class="xs muted">Menu text switches between white and black automatically.</span></div>' +
      '</div></div>' +
      '<div class="grid g2">' +
      '<div class="card"><div class="card-head"><div><h3>Text contrast check</h3><div class="sub">The fixed rule: white text on dark fills, black text on light fills</div></div></div><div class="table-wrap"><table class="table ctr"><thead><tr><th>Where</th><th>Result</th><th class="num">Contrast</th><th></th></tr></thead><tbody>' +
      ratioRow('Primary buttons', t['--brand'], t['--brand-ink'], 4.5, 'Main colour fill') +
      ratioRow('Badges and counters', t['--accent'], t['--accent-ink'], 4.5, 'Second colour fill') +
      ratioRow('Sidebar menu text', t['--side-bg'], t['--side-ink'], 4.5, 'Sidebar background') +
      ratioRow('Active menu item', t['--side-active'], t['--side-active-ink'], 4.5, 'Selected page in the menu') +
      ratioRow('Links on white', '#FFFFFF', t['--brand-text'], 4.5, 'Main colour adjusted for reading') +
      ratioRow('Chart line on white', '#FFFFFF', t['--brand-strong'], 3, 'Main colour adjusted for graphics') +
      '</tbody></table></div></div>' +
      '<div class="card"><div class="card-head"><div><h3>Business details</h3><div class="sub">Used on invoices, receipts, the website and the guest app</div></div></div><div class="card-body"><form class="form-grid" data-biz>' +
      field('name', 'Brand name', ws.name) + field('legal', 'Legal name', ws.legal) + field('regNo', 'Registration no.', ws.regNo) + field('phone', 'Phone / WhatsApp', ws.phone) + field('email', 'Email', ws.email) + field('domain', 'Website address', ws.domain) +
      '<div class="field full"><label>Address</label><input class="input" name="address" value="' + esc(ws.address) + '"' + (owner ? '' : ' disabled') + '></div>' +
      (owner ? '<div class="full row-flex" style="justify-content:flex-end"><button class="btn btn-primary btn-sm" type="submit">Save details</button></div>' : '') + '</form></div></div>' +
      '</div>' +
      '<div class="grid g2">' +
      '<div class="card"><div class="card-head"><div><h3>Changes with your brand</h3><div class="sub">These parts of the interface follow the logo colours</div></div></div><div class="table-wrap"><table class="table map"><tbody>' +
      O.theme.MAP.changes.map(function (r) { return '<tr><td><span class="tok" style="background:var(' + r[1] + ')"></span><b>' + esc(r[0]) + '</b></td><td class="small muted">' + esc(r[2]) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +
      '<div class="card"><div class="card-head"><div><h3>Always stays the same</h3><div class="sub">Fixed so every brand stays readable and consistent</div></div></div><div class="table-wrap"><table class="table map"><tbody>' +
      O.theme.MAP.fixed.map(function (r, i) {
        var sw = ['<span class="tok" style="background:#FFFFFF"></span><span class="tok" style="background:#14181F"></span>', '<span class="tok" style="background:var(--bg)"></span>', '<span class="tok" style="background:var(--text)"></span>', '<span class="tok" style="background:var(--st-confirmed)"></span><span class="tok" style="background:var(--st-inhouse)"></span><span class="tok" style="background:var(--st-pending)"></span><span class="tok" style="background:var(--st-past)"></span>', '<span class="tok" style="background:var(--ok)"></span><span class="tok" style="background:var(--warn)"></span><span class="tok" style="background:var(--bad)"></span>', U.platIcon('airbnb') + ' ' + U.platIcon('booking') + ' ' + U.platIcon('agoda') + ' ' + U.platIcon('vrbo'), '<span class="tok" style="background:var(--c-prev1)"></span><span class="tok" style="background:var(--c-prev2)"></span>'][i] || '';
        return '<tr><td style="white-space:nowrap">' + sw + '</td><td><b>' + esc(r[0]) + '</b><div class="small muted">' + esc(r[1]) + '</div></td></tr>';
      }).join('') + '</tbody></table></div></div>' +
      '</div>' +
      '<div class="card"><div class="card-head"><div><h3>Set up a new subscriber</h3><div class="sub">The first-time setup a new business goes through: name, logo, colours picked automatically, done</div></div><button class="btn btn-primary btn-sm" data-act="wizard">' + O.icon('plus') + 'Start setup</button></div></div>' +
      '</div>';

    function field(name, label, val) { return '<div class="field"><label>' + esc(label) + '</label><input class="input" name="' + name + '" value="' + esc(val || '') + '"' + (owner ? '' : ' disabled') + '></div>'; }

    /* swatches extracted from the logo (async) */
    extractCached(ws.logo).then(function (r) {
      var box = O.$('[data-swatches]', root), info = O.$('[data-pickinfo]', root); if (!box) return;
      box.innerHTML = (r.swatches.length ? r.swatches : []).map(function (s) { return '<div class="sw"><i style="background:' + s.hex + '"></i>' + s.hex + '<br>' + Math.round(s.share * 100) + '%</div>'; }).join('') || '<span class="muted small">No colours found.</span>';
      info.textContent = b.source === 'manual' ? 'Adjusted by hand. "Pick again from logo" resets to the automatic choice.' : 'Picked automatically: the most prominent colour is the main colour, the next distinct one is the second colour.';
      O.$$('.pickrow', root).forEach(function (row) {
        var role = row.dataset.role, cur = (brandOf()[role] || brandOf().primary).toUpperCase();
        row.insertAdjacentHTML('afterbegin', r.swatches.map(function (s) { return '<button type="button" title="' + s.hex + '" data-pick="' + s.hex + '" class="' + (s.hex.toUpperCase() === cur ? 'on' : '') + '" style="background:' + s.hex + '"></button>'; }).join(''));
      });
    });

    if (!owner) return;
    var fileIn = O.$('[data-file]', root), drop = O.$('[data-drop]', root);
    fileIn.onchange = function () { if (fileIn.files[0]) useFile(fileIn.files[0]); };
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); var f = e.dataTransfer.files[0]; if (f) useFile(f); });
    root.addEventListener('click', function (e) {
      var s = e.target.closest('[data-sample]'); if (s) { applyLogo(O.svgUrl(O.logos[s.dataset.sample]), s.dataset.sample + '.svg'); return; }
      var p = e.target.closest('[data-pick]'); if (p) { setRole(p.closest('.pickrow').dataset.role, p.dataset.pick); return; }
      var sd = e.target.closest('[data-side]'); if (sd) { var nb = Object.assign({}, brandOf(), { sideStyle: sd.dataset.side }); O.saveBrand(nb); return; }
      var a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'auto') applyLogo(O.ws().logo, O.ws().logoName, true);
      if (a.dataset.act === 'wizard') wizard();
    });
    O.$$('input[type=color]', root).forEach(function (inp) { inp.onchange = function () { setRole(inp.dataset.role, inp.value.toUpperCase()); }; });
    O.$('[data-biz]', root).onsubmit = function (e) {
      e.preventDefault(); var f = e.target, w = O.ws();
      ['name', 'legal', 'regNo', 'phone', 'email', 'domain', 'address'].forEach(function (k) { if (f[k]) w[k] = f[k].value.trim() || w[k]; });
      U.toast('Business details saved. Invoices and the website use them now.'); O.emit('workspace');
    };
  }
  function roleCard(role, label, desc, hex, owner) {
    return '<div class="role"><div class="chip-swatch" style="background:' + hex + ';color:' + C.ink(hex) + '">' + hex.toUpperCase() + '</div><div><div class="lbl">' + esc(label) + '</div><div class="desc">' + esc(desc) + '</div></div>' +
      (owner ? '<div class="pickrow" data-role="' + role + '"><input type="color" data-role="' + role + '" value="' + hex + '" aria-label="Custom ' + esc(label.toLowerCase()) + '"></div>' : '') + '</div>';
  }
  function setRole(role, hex) {
    var nb = Object.assign({}, brandOf()); nb[role] = hex; nb.source = 'manual';
    O.saveBrand(nb); U.toast(({ primary: 'Main', accent: 'Second', dark: 'Dark' })[role] + ' colour set to ' + hex);
  }
  function readFile(file) {
    return new Promise(function (res, rej) {
      if (!/^image\//.test(file.type)) { rej(new Error('type')); return; }
      if (file.size > 4 * 1024 * 1024) { rej(new Error('size')); return; }
      var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(file);
    });
  }
  function useFile(file) {
    readFile(file).then(function (url) { applyLogo(url, file.name); }, function (err) { U.toast(err.message === 'size' ? 'That file is over 4 MB. Try a smaller logo.' : 'Choose an image file (PNG, JPG, SVG or WebP).', 'bad'); });
  }
  function applyLogo(url, name, quiet) {
    var w = O.ws(), prev = { logo: w.logo, logoName: w.logoName, brand: Object.assign({}, w.brand) };
    O.theme.extract(url).then(function (r) {
      w.logo = url; w.logoName = name; w.logoLum = null;
      try { if (url.length < 400000) O.store.set('logo:' + w.id, { logo: url, name: name }); } catch (e) {}
      O.theme.measureLogo(w).then(function () {
        O.saveBrand({ primary: r.primary, accent: r.accent, dark: r.dark, sideStyle: (w.brand && w.brand.sideStyle) || 'deep', source: 'logo' });
        if (!quiet) undoToast(prev); else U.toast('Colours picked again from your logo');
      });
    });
  }
  function undoToast(prev) {
    U.toast('Colours picked from your logo and applied everywhere');
    var host = O.$('.toasts'); if (!host) return;
    var t = O.html('<div class="toast" style="pointer-events:auto">Not right? <button class="btn btn-xs" style="background:#FFFFFF;color:#14181F">Undo</button></div>');
    host.appendChild(t); setTimeout(function () { t.remove(); }, 6000);
    O.$('button', t).onclick = function () { var w = O.ws(); w.logo = prev.logo; w.logoName = prev.logoName; O.store.set('logo:' + w.id, null); O.theme.measureLogo(w).then(function () { O.saveBrand(prev.brand); }); t.remove(); };
  }

  /* first-time setup for a new subscriber */
  function wizard() {
    var draft = { name: '', domain: '', logo: null, logoName: '', brand: null, step: 1 };
    var m = U.modal({ title: 'Set up a new subscriber', sub: 'Takes under a minute. Colours come from the logo.', size: 'wide', body: '<div data-wiz></div>', actions: [] });
    var box = O.$('[data-wiz]', m.el);
    function steps() { return '<div class="wiz-steps">' + ['Business', 'Logo', 'Colours', 'Done'].map(function (s, i) { return '<span class="' + (i + 1 === draft.step ? 'on' : i + 1 < draft.step ? 'done' : '') + '">' + (i + 1) + '. ' + s + '</span>'; }).join('') + '</div>'; }
    function paint() {
      var html = steps();
      if (draft.step === 1) {
        html += '<div class="form-grid"><div class="field"><label>Business name</label><input class="input" name="nm" value="' + esc(draft.name) + '" placeholder="e.g. Seri Stays"></div><div class="field"><label>Website address</label><input class="input" name="dm" value="' + esc(draft.domain) + '" placeholder="seristays.orbique.site"></div></div><div class="row-flex" style="justify-content:flex-end;margin-top:14px"><button class="btn btn-primary" data-w="next1">Next: logo</button></div>';
      } else if (draft.step === 2) {
        html += '<label class="drop" data-wdrop style="display:block">' + O.icon('upload') + '<div><b>Upload the logo</b>. We pick the colours for you.</div><input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden data-wfile></label><div class="label" style="margin-top:12px">Or use a sample</div><div class="samples">' + SAMPLES.slice(2).map(function (s) { return '<button type="button" class="sample" data-wsample="' + s[0] + '"><img src="' + esc(O.svgUrl(O.logos[s[0]])) + '" alt="">' + esc(s[1]) + '</button>'; }).join('') + '</div><div class="row-flex" style="justify-content:space-between;margin-top:14px"><button class="btn btn-ghost" data-w="back">Back</button><span class="small muted" data-wmsg></span></div>';
      } else if (draft.step === 3) {
        var tk = O.theme.tokens(draft.brand), fake = { name: draft.name, logo: draft.logo, logoLum: draft.logoLum };
        html += '<div class="grid g2"><div class="stack"><div class="label">Picked from your logo</div><div class="swatches">' + draft.swatches.map(function (s) { return '<div class="sw"><i style="background:' + s.hex + '"></i>' + s.hex + '</div>'; }).join('') + '</div>' +
          '<div class="roles" style="grid-template-columns:1fr 1fr">' + ['primary', 'accent'].map(function (r) { var hex = draft.brand[r]; return '<div class="role"><div class="chip-swatch" style="background:' + hex + ';color:' + C.ink(hex) + '">' + (r === 'primary' ? 'Main ' : 'Second ') + hex + '</div><div class="pickrow">' + draft.swatches.map(function (s) { return '<button type="button" data-wrole="' + r + '" data-hex="' + s.hex + '" class="' + (s.hex === hex ? 'on' : '') + '" style="background:' + s.hex + '"></button>'; }).join('') + '</div></div>'; }).join('') + '</div>' +
          '<div class="small muted">Text colour on each fill is chosen automatically: ' + (C.ink(draft.brand.primary) === C.WHITE ? 'white' : 'black') + ' on the main colour, ' + (C.ink(draft.brand.accent) === C.WHITE ? 'white' : 'black') + ' on the second colour.</div></div>' +
          '<div>' + miniPreview(tk, fake, draft.name) + '</div></div><div class="row-flex" style="justify-content:space-between;margin-top:14px"><button class="btn btn-ghost" data-w="back">Back</button><button class="btn btn-primary" data-w="finish">Create workspace</button></div>';
      } else {
        html += '<div class="empty"><div class="e-icon">✓</div><b>' + esc(draft.name) + ' is ready.</b><br>The whole interface now uses its logo colours. You can fine-tune them any time in Brand & Setup.</div><div class="row-flex" style="justify-content:flex-end"><button class="btn btn-primary" data-w="close">Go to dashboard</button></div>';
      }
      box.innerHTML = html;
      var f = O.$('[data-wfile]', box);
      if (f) f.onchange = function () { readFile(f.files[0]).then(function (u) { gotLogo(u, f.files[0].name); }, function () { O.$('[data-wmsg]', box).textContent = 'Choose an image under 4 MB.'; }); };
    }
    function gotLogo(url, name) {
      O.theme.extract(url).then(function (r) {
        draft.logo = url; draft.logoName = name; draft.swatches = r.swatches.length ? r.swatches : [{ hex: r.primary }, { hex: r.accent }];
        draft.brand = { primary: r.primary, accent: r.accent, dark: r.dark, sideStyle: 'deep', source: 'logo' };
        var tmp = { logo: url }; O.theme.measureLogo(tmp).then(function () { draft.logoLum = tmp.logoLum; draft.step = 3; paint(); });
      });
    }
    box.addEventListener('click', function (e) {
      var s = e.target.closest('[data-wsample]'); if (s) { gotLogo(O.svgUrl(O.logos[s.dataset.wsample]), s.dataset.wsample + '.svg'); return; }
      var rr = e.target.closest('[data-wrole]'); if (rr) { draft.brand[rr.dataset.wrole] = rr.dataset.hex; paint(); return; }
      var w = e.target.closest('[data-w]'); if (!w) return;
      var a = w.dataset.w;
      if (a === 'next1') { draft.name = O.$('[name=nm]', box).value.trim(); draft.domain = O.$('[name=dm]', box).value.trim(); if (!draft.name) { O.$('[name=nm]', box).focus(); U.toast('Enter the business name', 'bad'); return; } draft.step = 2; paint(); }
      if (a === 'back') { draft.step = Math.max(1, draft.step - 1); paint(); }
      if (a === 'finish') {
        var id = 'ws' + (D.hash(draft.name) % 100000);
        O.addWorkspace({ id: id, name: draft.name, sub: 'Subscriber', legal: draft.name, regNo: 'Add your registration number in Brand & Setup', address: 'Malaysia', email: 'hello@' + (draft.domain || id + '.orbique.site'), phone: '', domain: draft.domain || draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '') + '.orbique.site', plan: 'Subscriber plan', logo: draft.logo, logoName: draft.logoName, logoLum: draft.logoLum, brand: draft.brand });
        O.setWorkspace(id, { silent: true });
        draft.step = 4; paint();
      }
      if (a === 'close') { m.close(); O.go('dashboard'); }
    });
    paint();
  }

  O.page('brand', {
    desc: 'Your logo sets the interface colours. Business details for invoices and the website.',
    render: function (root, ctx) {
      render(root, ctx);
      if (ctx.params.wizard && ctx.fresh) { ctx.params.wizard = false; wizard(); }
    }
  });
})();
