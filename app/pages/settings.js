/* Orbique — Settings (nav id 'settings')
   Arnob, 2026-11-22: "I need to be able to add expense type and categories from settings in both apps. Both app should
   have settings sections where different settings can be adjusted. Different employee levels will have different
   settings available to be adjusted." One web page serves the desktop, the phone layout and the Android app (which
   loads the live site).
   - Your settings: everyone (language, who you are signed in as).
   - Expense types and categories: anyone who can open Expenses sees them; expenses.settings (Staff Access → Expenses →
     "Change expense types and categories", on for account owners, ops managers and accountants by default) changes them.
     Data: D.expenseTypes + D.expenseSetup, rules in api/_lib/shared/exptypes.cjs (O.exptypes). Renaming a type also
     renames it on the expenses already saved with it, so reports keep them together.
   - More settings: the settings that live on other pages, each listed only for people whose access lets them change it.
   ctx.params.section = 'expenses' scrolls to that card (the Expenses page links here). */
(function () {
  var O = window.O, D = O.data, U = O.ui, esc = O.esc;

  O.css('settings', '.pg-settings{display:grid;gap:16px;max-width:880px;}' +
    '.pg-settings .st-row{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid var(--border);}' +
    '.pg-settings .st-row:first-child{border-top:0;}.pg-settings .st-row .grow .t{font-weight:700;font-size:14px;}' +
    '.pg-settings .st-row .grow .s{color:var(--muted);font-size:12.5px;margin-top:2px;overflow-wrap:anywhere;}' +
    '.pg-settings .st-row > svg{width:18px;height:18px;color:var(--text-2);flex-shrink:0;}' +
    '.pg-settings .st-langs{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}' +
    '.pg-settings .xt-cat{border-top:1px solid var(--border);}.pg-settings .xt-cat:first-child{border-top:0;}' +
    '.pg-settings .xt-cat-h{display:flex;align-items:center;gap:8px;padding:12px 16px 6px;flex-wrap:wrap;}' +
    '.pg-settings .xt-cat-h h4{margin:0;font-size:12.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--text-2);}' +
    '.pg-settings .xt-cat-h .n{color:var(--muted);font-size:12px;}.pg-settings .xt-cat-h .acts{margin-left:auto;display:flex;gap:6px;}' +
    '.pg-settings .xt-type{display:flex;align-items:center;gap:8px;padding:8px 16px 8px 24px;flex-wrap:wrap;}' +
    '.pg-settings .xt-type .nm{font-weight:600;font-size:14px;min-width:0;overflow-wrap:anywhere;}' +
    '.pg-settings .xt-type .tags{display:flex;gap:6px;flex-wrap:wrap;}.pg-settings .xt-type .use{color:var(--muted);font-size:12px;}' +
    '.pg-settings .xt-type .acts{margin-left:auto;display:flex;gap:4px;}' +
    '.pg-settings .xt-empty{padding:4px 16px 12px 24px;color:var(--muted);font-size:13px;}' +
    '.pg-settings .icon-btn.sm{width:30px;height:30px;}.pg-settings .icon-btn.sm svg{width:15px;height:15px;}' +
    '.pg-settings .icon-btn:disabled{opacity:.35;cursor:default;}' +
    '@media (max-width:640px){.pg-settings .xt-type{padding-left:16px;}.pg-settings .xt-type .acts{margin-left:0;width:100%;justify-content:flex-end;}}' +
    '.xt-form .field{margin-bottom:12px;}.xt-form .seg{display:inline-flex;}.xt-form .err{color:var(--bad);font-size:12px;}.xt-form .err:empty{display:none;}');

  var X = function () { return O.exptypes; };
  function canSeeTypes() { return O.can('expenses', 'view'); }
  function canEditTypes() { return O.can('expenses.settings'); }
  function state() { return X().normalize(D.expenseTypes, D.expenseSetup); }
  function save(n, msg) {
    D.expenseTypes = n.list; D.expenseSetup = n.setup;
    if (msg) U.toast(msg);
    O.emit('data', { type: 'expenseTypes' });
  }
  function useCount() { var c = {}; (O.raw('expenses') || []).forEach(function (e) { if (e && e.type) c[e.type] = (c[e.type] || 0) + 1; }); return c; }
  function catName(n, id) { var c = n.setup.cats.filter(function (x) { return x.id === id; })[0]; return c ? c.name : ''; }

  /* ------------------------------------------------------------------ your settings */
  function yourCard() {
    var v = O.viewer();
    return '<div class="card"><div class="card-head"><div><h3>Your settings</h3><div class="sub">Only for you, on this device</div></div></div>' +
      '<div class="st-row">' + O.icon('user') + '<div class="grow"><div class="t">' + esc(v.name) + '</div><div class="s">' + esc(v.roleLabel || '') + '</div></div></div>' +
      '<div class="st-row"><div class="grow"><div class="t">Language</div><div class="s">The language the app shows for you. Guests and the team still get messages in their own language.</div>' +
      '<div class="st-langs">' + O.LANGS.map(function (l) { return '<button type="button" class="btn btn-sm ' + (O.state.lang === l[0] ? 'btn-primary' : 'btn-ghost') + '" data-st-lang="' + l[0] + '" aria-pressed="' + (O.state.lang === l[0]) + '" data-no-i18n>' + esc(l[1]) + '</button>'; }).join('') + '</div></div></div></div>';
  }

  /* ------------------------------------------------------------------ expense types and categories */
  function typesCard() {
    if (!canSeeTypes()) return '';
    var n = state(), edit = canEditTypes(), uses = useCount(), groups = X().grouped(n.list, n.setup);
    var head = '<div class="card-head"><div><h3>Expense types and categories</h3><div class="sub">What people choose from when they record an expense, grouped in categories. Each type suggests a cost type.</div></div>' +
      (edit ? '<div class="row-flex wrap"><button type="button" class="btn btn-ghost btn-sm" data-xt="addcat">' + O.icon('plus') + 'Add category</button><button type="button" class="btn btn-primary btn-sm" data-xt="addtype">' + O.icon('plus') + 'Add type</button></div>' : '') + '</div>';
    var body = groups.map(function (g) {
      var locked = g.cat.id === 'other';
      var h = '<div class="xt-cat-h"><h4 data-no-i18n>' + esc(g.cat.name) + '</h4><span class="n">' + esc(O.tpl(g.types.length === 1 ? '{n} type' : '{n} types', { n: g.types.length })) + '</span>' +
        (edit ? '<span class="acts"><button type="button" class="btn btn-quiet btn-xs" data-xt="renamecat" data-cat="' + esc(g.cat.id) + '">Rename</button>' +
          (locked ? '' : '<button type="button" class="btn btn-quiet btn-xs" data-xt="delcat" data-cat="' + esc(g.cat.id) + '">Delete</button>') + '</span>' : '') + '</div>';
      var rows = g.types.map(function (t) {
        var x = n.setup.types[t], i = n.list.indexOf(t), built = X().LOCKED.indexOf(t) >= 0;
        return '<div class="xt-type" data-type="' + esc(t) + '"><span class="nm" data-no-i18n>' + esc(t) + '</span><span class="tags">' +
          U.pill(x.cls === 'capex' ? 'Capital' : 'Operating', x.cls === 'capex' ? 'brand' : '') + U.pill(x.fixed ? 'Fixed' : 'Variable', '') + (built ? U.pill('Built in', '') : '') + '</span>' +
          (uses[t] ? '<span class="use">' + esc(O.tpl(uses[t] === 1 ? '{n} expense' : '{n} expenses', { n: uses[t] })) + '</span>' : '') +
          (edit ? '<span class="acts">' + (t === 'Others' ? '' :
            '<button type="button" class="icon-btn sm" data-xt="up" aria-label="Move up" title="Move up"' + (i <= 0 ? ' disabled' : '') + '>' + O.icon('up') + '</button>' +
            '<button type="button" class="icon-btn sm" data-xt="down" aria-label="Move down" title="Move down"' + (i >= n.list.length - 2 ? ' disabled' : '') + '>' + O.icon('down') + '</button>') +
            '<button type="button" class="btn btn-ghost btn-xs" data-xt="edit">Edit</button>' +
            (built ? '' : '<button type="button" class="btn btn-quiet btn-xs" data-xt="deltype">Remove</button>') + '</span>' : '') + '</div>';
      }).join('');
      return '<div class="xt-cat">' + h + (rows || '<div class="xt-empty">No types in this category yet.</div>') + '</div>';
    }).join('');
    var foot = edit ? 'Removing a type only stops it being offered. Expenses already saved with it keep it, and reports still show it.' :
      'Your access does not let you change these. An account owner can allow it in Staff Access (Expenses → Change expense types and categories).';
    return '<div class="card" id="st-expenses">' + head + '<div>' + body + '</div><div class="card-foot">' + esc(foot) + '</div></div>';
  }

  function catOptions(n, sel) { return n.setup.cats.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === sel ? ' selected' : '') + ' data-no-i18n>' + esc(c.name) + '</option>'; }).join(''); }

  /* add (name null) or edit a type */
  function typeModal(name) {
    var n = state(), x = name ? n.setup.types[name] : { cat: n.setup.cats[0].id, cls: 'opex', fixed: false }, built = name && X().LOCKED.indexOf(name) >= 0;
    var f = { name: name || '', cat: x.cat, cls: x.cls, fixed: x.fixed };
    var body = O.html('<form class="xt-form" novalidate>' +
      '<div class="field"><label for="xt-name">Name</label><input class="input" id="xt-name" maxlength="' + X().MAX_NAME + '" value="' + esc(f.name) + '"' + (built ? ' disabled' : '') + ' placeholder="e.g. Pest control">' +
      (built ? '<div class="hint">This type is built in and keeps its name.</div>' : '') + '<div class="err" id="xt-err" role="alert"></div></div>' +
      '<div class="field"><label for="xt-cat">Category</label><select class="select" id="xt-cat">' + catOptions(n, f.cat) + '</select></div>' +
      '<div class="field"><span class="label">Cost type it suggests</span><div>' + U.seg([['opex', 'Operating'], ['capex', 'Capital']], f.cls, 'data-xt-cls') + '</div><div class="hint">Capital is a long-lasting purchase for a property, like furniture. Operating is the running cost of the month.</div></div>' +
      '<div class="field"><span class="label">Fixed or variable</span><div>' + U.seg([['fixed', 'Fixed'], ['variable', 'Variable']], f.fixed ? 'fixed' : 'variable', 'data-xt-fix') + '</div><div class="hint">Fixed costs are the same every month whatever the occupancy, like rent. The Profit planner and reports use this.</div></div>' +
      '</form>');
    function submit(close) {
      var m = state(), err;
      f.name = O.$('#xt-name', body).value; f.cat = O.$('#xt-cat', body).value;
      if (!name) {
        err = X().addType(m, f.name, { cat: f.cat, cls: f.cls, fixed: f.fixed });
        if (err) { showErr(err); return false; }
        save(m, O.tpl('Added "{x}"', { x: m.list[m.list.length - 2] }));
        close(); return false;
      }
      var to = f.name.replace(/\s+/g, ' ').trim(), renamed = null;
      if (!built && to !== name) { err = X().renameType(m, name, to); if (err) { showErr(err); return false; } renamed = to; }
      var now = renamed || name;
      err = X().setType(m, now, { cat: f.cat, cls: f.cls, fixed: f.fixed }); if (err) { showErr(err); return false; }
      if (renamed) { var k = 0; (O.raw('expenses') || []).forEach(function (e) { if (e && e.type === name) { e.type = renamed; k++; } }); save(m, k ? O.tpl('Renamed to "{x}" on {n} expenses', { x: renamed, n: k }) : O.tpl('Renamed to "{x}"', { x: renamed })); }
      else save(m, 'Saved');
      close(); return false;
    }
    function showErr(e) { var el = O.$('#xt-err', body); el.textContent = O.tr ? O.tr(e) : e; O.$('#xt-name', body).focus(); }
    body.addEventListener('click', function (e) {
      var b = e.target.closest('[data-xt-cls],[data-xt-fix]'); if (!b) return;
      if (b.dataset.xtCls) f.cls = b.dataset.xtCls; else f.fixed = b.dataset.xtFix === 'fixed';
      O.$$('button', b.parentNode).forEach(function (x) { x.classList.toggle('on', x === b); });
    });
    var m;
    body.addEventListener('submit', function (e) { e.preventDefault(); submit(m.close); });
    m = U.modal({ title: name ? O.tpl('Edit "{x}"', { x: name }) : 'Add an expense type', body: body, size: 'sm',
      actions: [{ label: 'Cancel' }, { label: name ? 'Save' : 'Add type', kind: 'primary', onClick: function (close) { return submit(close); } }] });
  }

  /* add (id null) or rename a category */
  function catModal(id) {
    var n = state(), cur = id ? catName(n, id) : '';
    var body = O.html('<form class="xt-form" novalidate><div class="field"><label for="xt-cname">Category name</label><input class="input" id="xt-cname" maxlength="' + X().MAX_NAME + '" value="' + esc(cur) + '" placeholder="e.g. Building fees"><div class="err" id="xt-cerr" role="alert"></div></div></form>');
    function submit(close) {
      var m = state(), v = O.$('#xt-cname', body).value, err = id ? X().renameCat(m, id, v) : X().addCat(m, v);
      if (err) { O.$('#xt-cerr', body).textContent = O.tr ? O.tr(err) : err; O.$('#xt-cname', body).focus(); return false; }
      save(m, id ? 'Category renamed' : O.tpl('Added the category "{x}". Add types to it, or move types into it with Edit.', { x: v.replace(/\s+/g, ' ').trim() }));
      close(); return false;
    }
    var m;
    body.addEventListener('submit', function (e) { e.preventDefault(); submit(m.close); });
    m = U.modal({ title: id ? 'Rename category' : 'Add a category', body: body, size: 'sm',
      actions: [{ label: 'Cancel' }, { label: id ? 'Save' : 'Add category', kind: 'primary', onClick: function (close) { return submit(close); } }] });
  }

  function onTypes(b) {
    var act = b.dataset.xt, row = b.closest('[data-type]'), t = row ? row.dataset.type : null, n;
    if (act === 'addtype') return typeModal(null);
    if (act === 'addcat') return catModal(null);
    if (act === 'renamecat') return catModal(b.dataset.cat);
    if (act === 'edit') return typeModal(t);
    if (act === 'up' || act === 'down') { n = state(); X().moveType(n, t, act === 'up' ? -1 : 1); save(n); return; }
    if (act === 'deltype') {
      U.confirm(O.tpl('Remove "{x}" from the list? Expenses already saved with it keep it.', { x: t }), 'Remove', 'danger').then(function (ok) {
        if (!ok) return; n = state(); var err = X().removeType(n, t); if (err) { U.toast(err, 'bad'); return; } save(n, O.tpl('Removed "{x}"', { x: t }));
      });
      return;
    }
    if (act === 'delcat') {
      n = state(); var nm = catName(n, b.dataset.cat), k = n.list.filter(function (x) { return n.setup.types[x].cat === b.dataset.cat; }).length;
      U.confirm(k ? O.tpl('Delete the category "{x}"? Its {n} types move to Other.', { x: nm, n: k }) : O.tpl('Delete the category "{x}"?', { x: nm }), 'Delete', 'danger').then(function (ok) {
        if (!ok) return; var m = state(), err = X().removeCat(m, b.dataset.cat); if (err) { U.toast(err, 'bad'); return; } save(m, 'Category deleted');
      });
    }
  }

  /* ------------------------------------------------------------------ settings on other pages */
  var MORE = [
    ['invoices', 'invoices', function () { return O.can('invoices.settings'); }, 'Invoices and receipts', 'Numbering, tax and automatic sending'],
    ['automations', 'automations', function () { return O.can('automations', 'view'); }, 'Booking alerts, tones and automations', 'Who gets booking alerts, the sound for each kind, and automatic messages'],
    ['inbox', 'inbox', function () { return O.can('inbox.quickReplies'); }, 'Quick replies', 'Saved replies for the whole team, in the inbox'],
    ['greetings', 'greetings', function () { return O.can('inbox.greetings'); }, 'Greeting messages', 'The message each building sends guests before arrival'],
    ['tasks', 'tasks', function () { return O.can('tasks.checklists'); }, 'Checklist templates', 'Check-in, check-out and daily housekeeping lists'],
    ['inventory', 'inventory', function () { return O.can('inventory.items'); }, 'Inventory items', 'The item list, categories and reorder levels'],
    ['netrates', 'netrates', function () { return O.can('pricing.rules'); }, 'Net rates', 'What each booking site adds on top of your take-home price'],
    ['staff', 'staff', function () { return O.can('staff', 'view'); }, 'Staff access', 'Who can open each section and what they can change, including these settings'],
    ['brand', 'brand', function () { return O.can('brand.edit'); }, 'Brand and setup', 'Logo, colours and workspace details'],
    ['health', 'health', function () { return O.isOwner(); }, 'System health', 'Checks on every part of the workspace, and the automatic fixes']
  ];
  function moreCard() {
    var rows = MORE.filter(function (r) { return r[2]() && O.allowed(r[1]); });
    var foot = O.isOwner() ? 'You are an account owner, so you see every setting. Others see only what Staff Access allows them.' : 'What you see here depends on your access. An account owner can change it in Staff Access.';
    return '<div class="card"><div class="card-head"><div><h3>More settings</h3><div class="sub">Settings kept on their own pages</div></div></div>' +
      (rows.length ? '<div>' + rows.map(function (r) {
        return '<div class="st-row">' + O.icon(r[0]) + '<div class="grow"><div class="t">' + esc(r[3]) + '</div><div class="s">' + esc(r[4]) + '</div></div><button type="button" class="btn btn-ghost btn-sm" data-st-go="' + r[1] + '">Open</button></div>';
      }).join('') + '</div>' : '<div class="card-body">' + U.empty('Your access does not include other settings.') + '</div>') +
      '<div class="card-foot">' + esc(foot) + '</div></div>';
  }

  O.page('settings', {
    desc: 'Your own settings, and the workspace settings your access allows',
    render: function (root, ctx) {
      root.innerHTML = '<div class="pg-settings">' + yourCard() + typesCard() + moreCard() + '</div>';
      var pg = O.$('.pg-settings', root);
      pg.addEventListener('click', function (e) {
        var b = e.target.closest('[data-st-lang]');
        if (b) { var l = b.dataset.stLang; O.state.lang = l; O.store.set('lang', l); O.emit('lang'); if (O.i18nLoad) O.i18nLoad(l, function (ok) { if (ok && O.state.lang === l) O.emit('lang'); }); return; }
        b = e.target.closest('[data-st-go]'); if (b) { O.go(b.dataset.stGo); return; }
        b = e.target.closest('[data-xt]'); if (b && !b.disabled) { onTypes(b); }
      });
      if (ctx.fresh && ctx.params && ctx.params.section === 'expenses') {
        var card = O.$('#st-expenses', root); if (card && card.scrollIntoView) setTimeout(function () { card.scrollIntoView({ block: 'start' }); }, 0);
        if (ctx.params.add && canEditTypes()) { ctx.params.add = false; typeModal(null); }
      }
    }
  });
})();
