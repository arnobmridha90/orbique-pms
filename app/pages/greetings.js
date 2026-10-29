/* Orbique — Greeting Messages (one or more per building)
   Arnob: "I want a section in the PMS where the subscriber can write greeting messages for a building. In the guest inbox
   there will be an option to send the greeting message. Owner and all employees can send this to the customer. In the
   greeting message section the customer can choose which will stay fixed and which will vary. For example the customer
   name will change according to the booking, the unit number and door passwords can also change."
   - Pick a building, see its greetings (usually one; several are fine, e.g. "Arrival" and "Long stay").
   - Editor: name and text; chips insert the parts that change per booking ({guest_first}, {unit_no}, {door_code} ...)
     and the writer's own fields ({f_<key>}), which have a value for each unit of the building ("Lobby code").
     Everything else in the text is fixed wording. A live preview fills it from a real upcoming booking in the building
     (or sample values), with the changing parts highlighted, exactly as it would go now.
   - The door code, private fields ("like a door code") and for a typed unit the unit number and Wi-Fi reach the guest
     only from 24 hours before check-in (O.greeting / api/_lib/shared/greeting.cjs, the same code the server sends with).
   Access: the page opens for anyone who can open the guest inbox (O.PAGE_ACCESS). inbox.greetings adds, edits and deletes
   greetings and fields. Private field values show only to people with guestapp.doorCodes (others see "Hidden" and keep the
   values as they are when saving). Data: D.greetings (records 'greetings'). O.greet: helpers the inbox uses. */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  var GR = O.greeting;

  /* ------------------------------------------------------------------ helpers shared with the inbox */
  function canEdit() { return O.can('inbox.greetings'); }
  function canCodes() { return O.can('guestapp.doorCodes'); }
  function unitsOf(bid) {
    return D.properties.filter(function (p) { var bd = O.buildingOf(p); return bd && bd.id === bid && !p.archived; })
      .sort(function (a, b) { return O.assign.naturalCompare(a.unitNo || a.short || a.name, b.unitNo || b.short || b.name); });
  }
  function unitName(p) { return p.unitNo ? p.unitNo : (p.short || p.name); }
  /* the building a booking stays in: its unit's, else its unit type's */
  function buildingOfBooking(b) {
    if (!b) return null;
    var p = D.propById[b.propertyId], t = O.unitType(b.unitTypeId) || O.typeOf(p);
    return (p && O.buildingOf(p)) || (t && O.building(t.buildingId)) || null;
  }
  function ctxFor(b, building) {
    var p = b ? D.propById[b.propertyId] || null : null, t = b ? O.unitType(b.unitTypeId) || O.typeOf(p) : null;
    var bd = buildingOfBooking(b) || building || null;
    return { booking: b || null, unit: p, unitType: t, building: bd, link: b && O.guestLink && b.guestToken ? O.guestLink(b) : '' }; /* never creates a token while previewing */
  }
  O.greet = {
    /* the greetings for a booking's building */
    listFor: function (b) { var bd = buildingOfBooking(b); return bd ? GR.forBuilding(D.greetings, bd.id) : []; },
    buildingOf: buildingOfBooking,
    /* filled for this booking now; mask: show "[door code hidden]" for private values (default: when the viewer has no door-code access) */
    fill: function (g, b, o) { o = o || {}; return GR.fill(g, ctxFor(b, b ? null : O.building(g.buildingId)), { now: o.now || D.NOW, mask: o.mask != null ? o.mask : !canCodes() }); },
    /* the private values a chat may hold for this booking (the inbox hides them from people without door-code access) */
    secretsFor: function (b) {
      var out = [], bd = buildingOfBooking(b); if (!b || !bd) return out;
      GR.forBuilding(D.greetings, bd.id).forEach(function (g) { (g.fields || []).forEach(function (f) { var v = f.private && f.values ? f.values[b.propertyId] : ''; if (v && String(v).length >= 3) out.push(String(v)); }); });
      return out;
    },
    partsHTML: partsHTML,
    heldNote: heldNote
  };

  /* the preview: fixed text plain, the parts that change highlighted (per booking / per unit), held parts and blanks marked */
  function labelOf(key, g) {
    for (var i = 0; i < GR.BUILTINS.length; i++) if (GR.BUILTINS[i][0] === key) return GR.BUILTINS[i][1];
    var f = (g && g.fields || []).filter(function (x) { return 'f_' + x.key === key; })[0];
    return f ? f.label : key;
  }
  /* '2026-11-02T14:30' -> '2:30 PM, Mon, 2 Nov' */
  function fmtAt(at) { var dt = GR.fmtDate(at.slice(0, 10)); return GR.fmtTime(at.slice(11, 16)) + (dt ? ', ' + dt.replace(/ \d{4}$/, '') : ''); }
  function partsHTML(filled, g) {
    return filled.parts.map(function (p) {
      if (p.kind === 'fixed') return esc(p.text);
      var unitField = /^f_/.test(p.key || ''), cls = 'gm-v' + (unitField ? ' unit' : '');
      if (p.kind === 'unknown') return '<span class="gm-v bad" title="Not a known part. It goes to the guest as written.">' + esc(p.text) + '</span>';
      if (p.kind === 'missing') return '<span class="gm-v empty" title="' + esc(labelOf(p.key, g)) + ' has no value for this booking, so it is left blank">' + esc(labelOf(p.key, g)) + ': blank</span>';
      if (p.kind === 'held') return '<span class="gm-v held" title="' + esc(labelOf(p.key, g)) + ((filled.why || {})[p.key] === 'id' ? ' waits for the guest\'s ID check' : ' only reaches the guest from 24 hours before check-in') + '">' + esc(p.text) + '</span>';
      return '<span class="' + cls + '" title="' + esc(labelOf(p.key, g)) + (unitField ? ' (changes per unit)' : ' (changes per booking)') + '">' + esc(p.text) + '</span>';
    }).join('');
  }
  /* the staff notes under a preview: what is held and why, and what to do about it. The door code (and a typed unit's
     number and Wi-Fi) are in the guest app from the reveal time; the writer's own fields are not, so the sender is told
     to send the greeting again. */
  function heldNote(filled, g) {
    var out = [], why = filled.why || {}, at = filled.revealAt;
    var when = at ? fmtAt(at) : 'check-in minus 24 hours';
    var names = function (ks) { return ks.map(function (k) { return labelOf(k, g); }).join(', '); };
    var time = filled.held.filter(function (k) { return why[k] !== 'id'; }), id = filled.held.filter(function (k) { return why[k] === 'id'; });
    var timeApp = time.filter(function (k) { return !/^f_/.test(k); }), timeOwn = time.filter(function (k) { return /^f_/.test(k); });
    var idApp = id.filter(function (k) { return !/^f_/.test(k); }), idOwn = id.filter(function (k) { return /^f_/.test(k); });
    if (timeApp.length) out.push('Held until ' + when + ': ' + names(timeApp) + '. The guest is pointed to the guest app, which shows it from then.');
    if (timeOwn.length) out.push('Held until ' + when + ': ' + names(timeOwn) + '. Send this greeting again from then to include it.');
    if (idApp.length) out.push('Held until the guest\'s ID is checked: ' + names(idApp) + '. The guest app shows it once the ID check is done.');
    if (idOwn.length) out.push('Held until the guest\'s ID is checked: ' + names(idOwn) + '. Send this greeting again after the ID check to include it.');
    if (filled.missing.length) out.push('No value for this booking, so left blank: ' + filled.missing.map(function (k) { return labelOf(k, g); }).join(', ') + '.');
    return out;
  }

  /* ------------------------------------------------------------------ styles */
  O.css('greetings', `
.pg-greet{display:flex;flex-direction:column;gap:14px;}
.pg-greet .gm-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.pg-greet .gm-bar .select{width:auto;min-width:220px;max-width:100%;}
.pg-greet .gm-bar .btn{margin-left:auto;}
.pg-greet .gm-grid{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr);gap:14px;align-items:start;}
.pg-greet .gm-list{display:flex;flex-direction:column;gap:8px;min-width:0;}
.pg-greet .gm-item{display:block;width:100%;text-align:left;border:1px solid var(--border);background:var(--surface);border-radius:10px;padding:10px 12px;min-width:0;}
.pg-greet .gm-item:hover{border-color:var(--brand-strong);}
.pg-greet .gm-item.on{border-color:var(--brand-strong);background:var(--brand-soft-2);box-shadow:inset 3px 0 0 var(--brand-strong);}
.pg-greet .gm-item .t{font-weight:800;font-size:13.5px;}
.pg-greet .gm-item .x{font-size:12px;color:var(--muted);margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.pg-greet .gm-ed{display:flex;flex-direction:column;gap:14px;min-width:0;}
.pg-greet .gm-ed .card-body{display:flex;flex-direction:column;gap:12px;}
.pg-greet .gm-key{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--text-2);align-items:center;}
.pg-greet .gm-key span{display:inline-flex;align-items:center;gap:6px;}
.pg-greet .gm-key i{display:inline-block;width:12px;height:12px;border-radius:4px;border:1px solid var(--border);background:var(--surface);}
.pg-greet .gm-key i.b{background:var(--brand-soft);border-color:var(--brand-strong);}
.pg-greet .gm-key i.u{background:var(--accent-soft);border-color:var(--accent);}
.pg-greet .gm-chips{display:flex;flex-direction:column;gap:6px;}
.pg-greet .gm-chips .h{font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;}
.pg-greet .gm-chips .row{display:flex;gap:5px;flex-wrap:wrap;}
.pg-greet .gm-chip{border:1px solid var(--brand-strong);background:var(--brand-soft);color:var(--brand-text);border-radius:14px;padding:3px 9px;font-size:11.5px;font-weight:700;min-height:28px;display:inline-flex;align-items:center;gap:4px;}
.pg-greet .gm-chip.unit{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-text);}
.pg-greet .gm-chip.add{border-style:dashed;background:var(--surface);color:var(--muted);}
.pg-greet .gm-chip svg{width:12px;height:12px;}
.pg-greet .gm-chip[disabled]{opacity:0.5;cursor:not-allowed;}
.gm-pv{background:var(--bg);border-radius:10px;padding:10px;}
.gm-pv .pvb{background:var(--brand);color:var(--brand-ink);border-radius:9px 0 9px 9px;padding:9px 11px;font-size:13px;margin-left:auto;max-width:92%;width:fit-content;white-space:pre-wrap;line-height:1.5;overflow-wrap:anywhere;}
.gm-pv .pvb.plain{background:var(--surface);color:var(--text);border:1px solid var(--border);}
.gm-v{background:var(--brand-soft);color:var(--brand-text);border-radius:5px;padding:0 3px;font-weight:700;box-shadow:inset 0 -1px 0 var(--brand-strong);}
.gm-v.unit{background:var(--accent-soft);color:var(--accent-text);box-shadow:inset 0 -1px 0 var(--accent);}
.gm-v.held{background:var(--warn-soft);color:var(--warn);box-shadow:none;font-weight:600;}
.gm-v.empty{background:none;color:var(--muted);border:1px dashed var(--border-strong);font-weight:600;font-size:11.5px;}
.gm-v.bad{background:var(--bad-soft);color:var(--bad);box-shadow:none;}
.gm-notes{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-2);}
.pg-greet .gm-pvbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.pg-greet .gm-pvbar .select{width:auto;flex:1;min-width:0;max-width:420px;}
.pg-greet .gm-field{border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;}
.pg-greet .gm-fhead{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.pg-greet .gm-fhead .input{flex:1;min-width:140px;width:auto;}
.pg-greet .gm-fhead code{font-size:11px;background:var(--accent-soft);border-radius:5px;padding:1px 5px;}
.pg-greet .gm-vals{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;}
.pg-greet .gm-vals label{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;min-width:0;}
.pg-greet .gm-vals label span{flex:0 0 64px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pg-greet .gm-vals .input{flex:1;min-width:0;}
.pg-greet .gm-foot{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.pg-greet .gm-foot .grow{flex:1;}
.pg-greet .err{color:var(--bad);font-size:12px;font-weight:600;}
.pg-greet .gm-ro{font-size:12.5px;color:var(--muted);display:flex;gap:8px;align-items:center;}
.pg-greet .gm-ro svg{width:15px;height:15px;}
@media (max-width:860px){ .pg-greet .gm-grid{grid-template-columns:minmax(0,1fr);} .pg-greet .gm-list{flex-direction:row;overflow-x:auto;scrollbar-width:thin;} .pg-greet .gm-item{width:auto;min-width:180px;max-width:240px;flex-shrink:0;} }
@media (max-width:560px){ .pg-greet .gm-bar .select{min-width:0;flex:1;} .pg-greet .gm-bar .btn{margin-left:0;} .pg-greet .gm-vals{grid-template-columns:minmax(0,1fr);} .pg-greet .gm-chip{min-height:34px;} }
`);

  /* ------------------------------------------------------------------ page */
  var st = { building: null, sel: null, draft: null, dirty: false, err: '', sample: '', confirm: false };

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function bookingsIn(bid) {
    return D.bookings.filter(function (b) { var bd = buildingOfBooking(b); return bd && bd.id === bid && b.guest && b.status !== 'cancelled' && b.checkOut >= D.TODAY; })
      .sort(function (a, b) { return a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0; }).slice(0, 40);
  }
  function hl(text) { return esc(text).replace(/\{([a-z0-9_]+)\}/g, function (m, k) { return '<span class="gm-v' + (/^f_/.test(k) ? ' unit' : '') + '">' + m + '</span>'; }); }

  O.page('greetings', {
    desc: 'Greetings for each building, filled with each guest\'s details',
    noDataRerender: true,
    render: function (root, ctx) {
      var buildings = D.buildings.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      if (!buildings.length) {
        root.innerHTML = '<div class="pg-greet">' + U.empty('Greeting messages belong to a building. Add a building on the Properties page first.', '✉', O.allowed('properties') ? '<button class="btn btn-primary btn-sm" data-go="properties">Open Properties</button>' : '') + '</div>';
        var go = O.$('[data-go]', root); if (go) go.onclick = function () { O.go('properties'); };
        return;
      }
      if (ctx.params && ctx.params.buildingId) { st.building = ctx.params.buildingId; st.sel = null; st.draft = null; st.dirty = false; ctx.params = {}; }
      if (!st.building || !buildings.some(function (b) { return b.id === st.building; })) st.building = O.store.get('greet:building', '') || '';
      if (!buildings.some(function (b) { return b.id === st.building; })) st.building = buildings[0].id;
      root.innerHTML = '<div class="pg-greet"></div>';
      var page = O.$('.pg-greet', root);

      function list() { return GR.forBuilding(D.greetings, st.building); }
      function current() { return list().filter(function (g) { return g.id === st.sel; })[0] || null; }
      function pick(id) {
        st.sel = id; st.err = ''; st.confirm = false;
        var g = current(); st.draft = g ? GR.clean(clone(g)) : null; st.dirty = false;
      }
      if (!current()) { var first = list()[0]; pick(first ? first.id : null); }
      else if (!st.draft || st.draft.id !== st.sel) pick(st.sel);

      function barHTML() {
        return '<div class="gm-bar"><label class="sr-only" for="gm-bd">Building</label><select id="gm-bd" class="select" data-f="building">' +
          buildings.map(function (b) { var n = GR.forBuilding(D.greetings, b.id).length; return '<option value="' + esc(b.id) + '"' + (b.id === st.building ? ' selected' : '') + '>' + esc(b.name) + (n ? ' (' + n + ')' : '') + '</option>'; }).join('') + '</select>' +
          '<span class="small muted">' + fmt.plural(unitsOf(st.building).length, 'unit') + '</span>' +
          (canEdit() ? '<button type="button" class="btn btn-primary btn-sm" data-a="add">' + O.icon('plus') + 'Add greeting</button>' : '') + '</div>';
      }
      function listHTML() {
        var l = list();
        if (!l.length) return '<div class="gm-list">' + U.empty(canEdit() ? 'No greeting for this building yet. Add one to send it from the guest inbox.' : 'No greeting for this building yet.', '✉') + '</div>';
        return '<div class="gm-list" role="list">' + l.map(function (g) {
          return '<button type="button" role="listitem" class="gm-item' + (g.id === st.sel ? ' on' : '') + '" data-pick="' + esc(g.id) + '"><div class="t">' + esc(g.name || 'Untitled') + '</div><div class="x">' + esc(String(g.text || '').slice(0, 140)) + '</div></button>';
        }).join('') + '</div>';
      }
      function chipsHTML(g, on) {
        var dis = on ? '' : ' disabled';
        return '<div class="gm-chips"><div class="h">Changes per booking</div><div class="row">' +
          GR.BUILTINS.map(function (b) { return '<button type="button" class="gm-chip" data-ins="' + b[0] + '"' + dis + ' title="Inserts {' + b[0] + '}">+ ' + esc(b[1]) + '</button>'; }).join('') + '</div>' +
          '<div class="h">Your fields (per unit)</div><div class="row">' +
          g.fields.map(function (f) { return '<button type="button" class="gm-chip unit" data-ins="f_' + esc(f.key) + '"' + dis + ' title="Inserts {f_' + esc(f.key) + '}">' + (f.private ? O.icon('lock') : '') + '+ ' + esc(f.label) + '</button>'; }).join('') +
          (on ? '<button type="button" class="gm-chip add" data-a="field">' + O.icon('plus') + 'New field</button>' : (g.fields.length ? '' : '<span class="small muted">None</span>')) + '</div></div>';
      }
      function previewHTML(g) {
        var opts = bookingsIn(st.building);
        if (st.sample && !opts.some(function (b) { return b.id === st.sample; })) st.sample = '';
        var b = st.sample ? D.booking(st.sample) : null;
        var filled = O.greet.fill(g, b);
        var notes = b ? heldNote(filled, g) : ['Sample values. Pick a booking to see exactly what that guest would get now.'];
        return '<div class="field"><div class="gm-pvbar"><label for="gm-pv">Preview for</label><select id="gm-pv" class="select" data-f="sample"><option value="">Sample guest</option>' +
          opts.map(function (x) { var p = D.propById[x.propertyId]; return '<option value="' + esc(x.id) + '"' + (x.id === st.sample ? ' selected' : '') + '>' + esc(x.guest.name) + ' · ' + esc(p ? unitName(p) : 'no unit yet') + ' · ' + esc(d.fmtRange(x.checkIn, x.checkOut)) + '</option>'; }).join('') + '</select></div>' +
          '<div class="gm-pv"><div class="pvb">' + (g.text.trim() ? partsHTML(filled, g) : '<span style="opacity:.8">Your message appears here.</span>') + '</div></div>' +
          (notes.length ? '<div class="gm-notes">' + notes.map(function (n) { return '<div>' + esc(n) + '</div>'; }).join('') + '</div>' : '') + '</div>';
      }
      function fieldsHTML(g, on) {
        if (!g.fields.length) return on ? '<div class="small muted">Add a field for anything that is different in each unit, such as a lobby code or a parking bay. Each unit gets its own value.</div>' : '';
        var units = unitsOf(st.building), codes = canCodes();
        return g.fields.map(function (f, i) {
          var hide = f.private && !codes;
          return '<div class="gm-field"><div class="gm-fhead">' +
            (on ? '<label class="sr-only" for="gm-fl' + i + '">Field name</label><input id="gm-fl' + i + '" class="input" data-fl="' + i + '" maxlength="40" value="' + esc(f.label) + '">' : '<b>' + esc(f.label) + '</b>') +
            '<code>{f_' + esc(f.key) + '}</code>' +
            '<label class="check" title="Like a door code: only sent from 24 hours before check-in, and only people who can see door codes see the values"><input type="checkbox" data-fp="' + i + '"' + (f.private ? ' checked' : '') + (on ? '' : ' disabled') + '><span>Private, like a door code</span></label>' +
            (on ? '<button type="button" class="btn btn-ghost btn-xs" data-fdel="' + i + '" aria-label="Remove ' + esc(f.label) + '">' + O.icon('trash') + '</button>' : '') + '</div>' +
            (units.length ? '<div class="gm-vals">' + units.map(function (p) {
              var v = f.values[p.id] || '';
              return '<label><span title="' + esc(p.name) + '">' + esc(unitName(p)) + '</span>' + (hide ? '<input class="input" disabled value="' + (v ? 'Hidden' : '') + '" placeholder="No value" aria-label="' + esc(f.label) + ' for ' + esc(p.name) + ' (hidden)">'
                : '<input class="input" data-fv="' + i + '" data-unit="' + esc(p.id) + '" maxlength="200" value="' + esc(v) + '" placeholder="No value"' + (on ? '' : ' readonly') + ' aria-label="' + esc(f.label) + ' for ' + esc(p.name) + '">') + '</label>';
            }).join('') + '</div>' : '<div class="small muted">This building has no units yet.</div>') +
            (hide ? '<div class="small muted">' + O.icon('lock') + ' The values are hidden: door codes are not part of your access.</div>' : '') + '</div>';
        }).join('');
      }
      function editorHTML() {
        var g = st.draft;
        if (!g) return '<div class="gm-ed"><div class="card"><div class="card-body">' + U.empty(canEdit() ? 'Choose a greeting, or add one.' : 'There is no greeting to show.', '✉') + '</div></div></div>';
        var on = canEdit();
        return '<div class="gm-ed"><div class="card"><div class="card-body">' +
          (on ? '' : '<div class="gm-ro">' + O.icon('lock') + '<span>You can read this greeting and send it from the inbox. Changing it is not part of your access.</span></div>') +
          '<div class="field"><label for="gm-name">Name (the team sees it in the inbox)</label><input id="gm-name" class="input" data-e="name" maxlength="60" value="' + esc(g.name) + '" placeholder="For example: Arrival"' + (on ? '' : ' readonly') + '></div>' +
          '<div class="gm-key"><span><i></i>Fixed text: the same for every guest</span><span><i class="b"></i>Changes per booking</span><span><i class="u"></i>Changes per unit</span></div>' +
          '<div class="field"><label for="gm-text">Message</label><textarea id="gm-text" class="textarea" data-e="text" rows="8" placeholder="Write the greeting. Tap the chips below to add the parts that change for each guest."' + (on ? '' : ' readonly') + '>' + esc(g.text) + '</textarea></div>' +
          chipsHTML(g, on) +
          '<div class="pv-wrap">' + previewHTML(g) + '</div>' +
          (g.fields.length || on ? '<div class="field"><label>Values per unit</label>' + fieldsHTML(g, on) + '</div>' : '') +
          (st.err ? '<div class="err">' + esc(st.err) + '</div>' : '') +
          (on ? footHTML(g) : '') +
          '</div></div></div>';
      }
      function footHTML(g) {
        return '<div class="gm-foot"><button type="button" class="btn btn-primary btn-sm" data-a="save"' + (st.dirty || !g.id ? '' : ' disabled') + '>' + (g.id ? 'Save changes' : 'Add greeting') + '</button>' +
          (st.dirty && g.id ? '<button type="button" class="btn btn-ghost btn-sm" data-a="revert">Undo changes</button>' : '') +
          (!g.id ? '<button type="button" class="btn btn-ghost btn-sm" data-a="revert">Cancel</button>' : '') +
          (st.dirty ? '<span class="small muted">Not saved yet</span>' : '') + '<span class="grow"></span>' +
          (g.id ? (st.confirm ? '<span class="small" style="color:var(--bad);font-weight:700">Delete "' + esc(g.name || 'Untitled') + '"?</span><button type="button" class="btn btn-danger btn-xs" data-a="del">Delete</button><button type="button" class="btn btn-ghost btn-xs" data-a="keep">Keep</button>'
            : '<button type="button" class="btn btn-ghost btn-sm" data-a="ask">' + O.icon('trash') + 'Delete</button>') : '') + '</div>';
      }
      function paint() {
        page.innerHTML = barHTML() + '<div class="gm-grid">' + listHTML() + editorHTML() + '</div>';
      }
      function paintPreview() { var w = O.$('.pv-wrap', page); if (w && st.draft) w.innerHTML = previewHTML(st.draft); }
      function paintChips() { var w = O.$('.gm-chips', page); if (w && st.draft) w.outerHTML = chipsHTML(st.draft, canEdit()); }
      function paintFoot() { var foot = O.$('.gm-foot', page); if (foot && st.draft) foot.outerHTML = footHTML(st.draft); var er = O.$('.gm-ed .err', page); if (er && !st.err) er.remove(); }
      function touch() { var was = st.dirty; st.dirty = true; st.err = ''; if (!was) paintFoot(); }
      /* run fn now, or after the person agrees to drop unsaved changes */
      function leaveThen(fn) {
        if (!st.dirty) { fn(); return; }
        U.confirm('Your changes to this greeting are not saved yet. Leave without saving?', 'Leave without saving', 'danger', 'Leave this greeting?').then(function (ok) { if (ok) { st.dirty = false; fn(); } });
      }
      function addField() {
        var body = O.html('<div class="stack"><div class="field"><label for="gm-nf">Field name</label><input id="gm-nf" class="input" maxlength="40" placeholder="For example: Lobby code or Parking bay"></div>' +
          '<label class="check"><input type="checkbox" id="gm-np"><span>Private, like a door code: only sent from 24 hours before check-in, and only people who can see door codes see the values</span></label>' +
          '<div class="note">Each unit in the building gets its own value. You fill them in under Values per unit.</div></div>');
        var inp = O.$('#gm-nf', body), pv = O.$('#gm-np', body), touched = false;
        inp.addEventListener('input', function () { if (!touched) pv.checked = GR.defaultPrivate(inp.value); });
        pv.addEventListener('change', function () { touched = true; });
        U.modal({ title: 'New field', sub: 'A part of the message that is different in each unit', size: 'sm', body: body, actions: [{ label: 'Cancel' }, { label: 'Add field', kind: 'primary', onClick: function () {
          var label = inp.value.trim().slice(0, 40);
          if (!label) { inp.focus(); return false; }
          if (st.draft.fields.length >= GR.MAX_FIELDS) { U.toast('A greeting can have at most ' + GR.MAX_FIELDS + ' fields', 'bad'); return false; }
          var key = GR.fieldKey(label, st.draft.fields.map(function (k) { return k.key; }));
          var ta = O.$('#gm-text', page); if (ta) st.draft.text = ta.value;
          st.draft.fields.push({ key: key, label: label, private: !!pv.checked, values: {} });
          touch(); paint();
          U.toast(pv.checked ? label + ' added as private. It only goes to the guest from 24 hours before check-in.' : label + ' added. Give each unit its value below.');
        } }] });
      }

      page.addEventListener('click', function (e) {
        var x;
        if ((x = e.target.closest('[data-pick]'))) { var id = x.dataset.pick; if (id === st.sel) return; leaveThen(function () { pick(id); paint(); }); return; }
        if ((x = e.target.closest('[data-ins]'))) {
          if (!canEdit() || !st.draft) return;
          var ta = O.$('#gm-text', page), token = '{' + x.dataset.ins + '}';
          var s = ta.selectionStart != null ? ta.selectionStart : ta.value.length, en = ta.selectionEnd != null ? ta.selectionEnd : s;
          ta.value = ta.value.slice(0, s) + token + ta.value.slice(en); st.draft.text = ta.value;
          ta.focus(); ta.setSelectionRange(s + token.length, s + token.length); touch(); paintPreview(); return;
        }
        if ((x = e.target.closest('[data-fdel]'))) {
          var fi = +x.dataset.fdel, f = st.draft.fields[fi]; if (!f) return;
          var drop = function () { st.draft.fields.splice(st.draft.fields.indexOf(f), 1); var ta3 = O.$('#gm-text', page); if (ta3) st.draft.text = ta3.value.split('{f_' + f.key + '}').join(''); touch(); paint(); };
          if (st.draft.text.indexOf('{f_' + f.key + '}') < 0 && !Object.keys(f.values).length) { drop(); return; }
          U.confirm('Remove ' + f.label + ' and its values for every unit? Where the message uses it, that part is taken out too.', 'Remove field', 'danger', 'Remove ' + f.label + '?').then(function (ok) { if (ok) drop(); });
          return;
        }
        if (!(x = e.target.closest('[data-a]'))) return;
        var a = x.dataset.a;
        if (a === 'add') {
          if (!canEdit()) return;
          leaveThen(function () {
            st.sel = null; st.dirty = false; st.err = ''; st.confirm = false;
            st.draft = { id: null, buildingId: st.building, name: list().length ? '' : 'Arrival', text: '', fields: [] };
            paint(); var nm = O.$('#gm-name', page); if (nm) nm.focus();
          });
          return;
        }
        if (a === 'field') { if (canEdit() && st.draft) addField(); return; }
        if (a === 'revert') { if (st.draft && !st.draft.id) { var f0 = list()[0]; pick(f0 ? f0.id : null); } else pick(st.sel); paint(); return; }
        if (a === 'ask') { st.confirm = true; paint(); return; }
        if (a === 'keep') { st.confirm = false; paint(); return; }
        if (a === 'del') {
          if (!canEdit()) return;
          var g0 = current(); if (!g0) return;
          D.greetings.splice(D.greetings.indexOf(g0), 1);
          U.toast('Greeting "' + (g0.name || 'Untitled') + '" deleted');
          var nx = list()[0]; pick(nx ? nx.id : null); paint(); O.emit('data', { type: 'greetings' }); return;
        }
        if (a === 'save') {
          if (!canEdit()) { U.toast('Changing greeting messages is not part of your access', 'bad'); return; }
          var g = st.draft;
          if (!g.name.trim()) { st.err = 'Give the greeting a name.'; paint(); return; }
          if (!g.text.trim()) { st.err = 'Write the message text.'; paint(); return; }
          var unknown = GR.keysIn(g.text).filter(function (k) { return !GR.isBuiltin(k) && !g.fields.some(function (f) { return 'f_' + f.key === k; }); });
          if (unknown.length) { st.err = 'These parts are not known, so they would go to the guest as written: ' + unknown.map(function (k) { return '{' + k + '}'; }).join(', ') + '. Remove them or add a field.'; paint(); return; }
          var rec = GR.clean(g);
          rec.name = rec.name || 'Untitled'; rec.updatedAt = D.NOW; rec.updatedBy = O.state.viewer;
          var orig = g.id ? D.greetings.filter(function (k) { return k.id === g.id; })[0] : null;
          if (orig) {
            /* private values someone cannot see stay as they were */
            if (!canCodes()) rec.fields.forEach(function (f) { var of = (orig.fields || []).filter(function (k) { return k.key === f.key; })[0]; if (f.private && of) f.values = clone(of.values || {}); });
            Object.keys(orig).forEach(function (k) { if (k !== 'id') delete orig[k]; });
            Object.keys(rec).forEach(function (k) { if (k !== 'id') orig[k] = rec[k]; });
          } else {
            rec.id = O.uid('GR'); D.greetings.push(rec);
          }
          U.toast('Greeting "' + rec.name + '" saved. The team can send it from the guest inbox.');
          pick(orig ? orig.id : rec.id); paint(); O.emit('data', { type: 'greetings' }); return;
        }
      });
      page.addEventListener('input', function (e) {
        var t = e.target, g = st.draft; if (!g || !canEdit()) return;
        if (t.dataset.e === 'name') { g.name = t.value; touch(); return; }
        if (t.dataset.e === 'text') { g.text = t.value; touch(); paintPreview(); return; }
        if (t.dataset.fl != null) { var f = g.fields[+t.dataset.fl]; if (f) { f.label = t.value; touch(); paintChips(); } return; }
        if (t.dataset.fv != null) { var f2 = g.fields[+t.dataset.fv]; if (f2) { if (t.value.trim()) f2.values[t.dataset.unit] = t.value; else delete f2.values[t.dataset.unit]; touch(); paintPreview(); } return; }
      });
      page.addEventListener('change', function (e) {
        var t = e.target;
        if (t.dataset.f === 'building') {
          var want = t.value; t.value = st.building;
          leaveThen(function () { st.building = want; O.store.set('greet:building', st.building); st.sample = ''; var f0 = list()[0]; pick(f0 ? f0.id : null); paint(); });
          return;
        }
        if (t.dataset.f === 'sample') { st.sample = t.value; paintPreview(); return; }
        if (t.dataset.fp != null && st.draft && canEdit()) {
          var f = st.draft.fields[+t.dataset.fp]; if (!f) return;
          if (!canCodes() && f.private && !t.checked) { t.checked = true; U.toast('Only people who can see door codes can make a private field public', 'bad'); return; }
          f.private = t.checked; touch(); paint(); return;
        }
      });
      /* changes from elsewhere (another person saved): repaint unless this person is in the middle of an edit */
      ctx.on('data', function () {
        if (!document.body.contains(page) || st.dirty) return;
        if (st.sel && !current()) { var f0 = list()[0]; pick(f0 ? f0.id : null); }
        else if (st.sel) pick(st.sel);
        var ae = document.activeElement, keep = ae && page.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
        if (!keep) paint();
      });
      paint();
    }
  });
})();
