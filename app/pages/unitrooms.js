/* Rooms & beds — the "Rooms & beds" tab of a unit in Properties (app/pages/properties.js): which room has which bed,
   mattress, sheets, comforter and pillows, and what one full linen change of the unit needs, so housekeeping and laundry
   can prepare.

   Arnob: "I also need bed mapping. Which unit which room has which bed size, mattress size, bedsheet size, pillow size"

   Kept in the synced workspace data (not sensitive): records collection 'unitRooms', one record per unit,
   {id: 'UR-<propertyId>', propertyId, rooms, updatedAt, updatedBy}. Shapes, presets and the linen rules:
   api/_lib/shared/beds.cjs (O.beds); docs/notes/beds-and-requests.md.
   Who: everyone who can open Properties sees it; editing needs "Edit property details" (properties.edit).

   O.unitRooms: get(pid), rooms(pid), roomNames(pid), canEdit(), view / edit / click / input (the Properties drawer). */
(function () {
  var O = window.O, D = O.data, U = O.ui, esc = O.esc, fmt = O.fmt, B = O.beds;
  var UR = O.unitRooms = {};
  if (O.sync && O.sync.records) O.sync.records('unitRooms', 'demo');

  /* demo units only (a new workspace starts empty: 'demo' collections are not copied into it) */
  if (!D.unitRooms) {
    var bed = function (type, id, extra) { var b = B.newBed(type, id); Object.keys(extra || {}).forEach(function (k) { b[k] = extra[k]; }); return b; };
    D.unitRooms = [
      { id: B.recordId('or4'), propertyId: 'or4', updatedAt: '2026-10-08T11:20', updatedBy: 's2', rooms: B.clean([
        { id: 'R1', kind: 'master', beds: [bed('queen', 'B1', { frame: '160x200', pillows: 4 })] },
        { id: 'R2', kind: 'bed2', beds: [bed('queen', 'B1'), bed('single', 'B2')] },
        { id: 'R3', kind: 'living', beds: [bed('extra', 'B1', { protector: false, notes: 'Foldable, kept in the store room. Set up for a 5th guest.' })] }
      ]) },
      { id: B.recordId('bf3b'), propertyId: 'bf3b', updatedAt: '2026-10-06T16:05', updatedBy: 's3', rooms: B.clean([
        { id: 'R1', kind: 'master', beds: [bed('king', 'B1')] },
        { id: 'R2', kind: 'bed2', beds: [bed('supersingle', 'B1', { qty: 2 })] }
      ]) }
    ];
  }

  O.css('unitrooms', `
.pp-dr .uf-tabs .seg{display:flex;flex-wrap:nowrap;max-width:100%;overflow-x:auto;scrollbar-width:none;}
.pp-dr .uf-tabs .seg::-webkit-scrollbar{display:none;}
.pp-dr .uf-tabs .seg button{white-space:nowrap;flex:0 0 auto;}
.pp-dr .ur-sum{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;color:var(--text-2);margin-bottom:12px;}
.pp-dr .ur-sum b{color:var(--text);}
.pp-dr .ur-bed{border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:3px;}
.pp-dr .ur-bed + .ur-bed{margin-top:8px;}
.pp-dr .ur-bed .t{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:700;font-size:13.5px;}
.pp-dr .ur-bed .s{font-size:12.5px;color:var(--text-2);overflow-wrap:anywhere;line-height:1.45;}
.pp-dr .ur-bed .s span{color:var(--muted);}
.pp-dr .ur-lin{width:100%;border-collapse:collapse;font-size:13px;}
.pp-dr .ur-lin td{padding:6px 0;border-bottom:1px solid var(--border);vertical-align:top;}
.pp-dr .ur-lin tr:last-child td{border-bottom:none;}
.pp-dr .ur-lin td.n{width:44px;font-weight:800;font-variant-numeric:tabular-nums;}
.pp-dr .ur-lin td.z{color:var(--muted);text-align:right;padding-left:8px;overflow-wrap:anywhere;}
.pp-dr .ur-lin .sub td{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding-top:12px;}
.pp-dr .ur-room{border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:12px;background:var(--surface-2);}
.pp-dr .ur-room .rh{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px;}
.pp-dr .ur-room .rh .field{flex:1 1 150px;min-width:0;margin:0;}
.pp-dr .ur-brow{border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--surface);}
.pp-dr .ur-brow .bh{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;font-weight:700;font-size:13px;}
.pp-dr .ur-add{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
.pp-dr .ur-add .select{width:auto;flex:1 1 160px;min-width:0;}
.pp-dr .ur-check{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;min-height:40px;}
.pp-dr .ur-group{grid-column:1/-1;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-top:4px;}
@media (max-width:440px){.pp-dr .uf-tabs{padding-left:12px;padding-right:12px;}.pp-dr .uf-tabs .seg button{padding-left:8px;padding-right:8px;font-size:12.5px;}}
@media (max-width:760px){.pp-dr .ur-room{padding:10px;}.pp-dr .ur-brow{padding:10px;}.pp-dr .ur-add .btn,.pp-dr .ur-brow .bh .btn,.pp-dr .ur-room .rh .btn{min-height:40px;}}
`);

  /* ---------------- data ---------------- */
  function rec(pid) { return (D.unitRooms || []).filter(function (x) { return x && x.propertyId === pid; })[0] || null; }
  UR.get = rec;
  UR.rooms = function (pid) { var r = rec(pid); return r && Array.isArray(r.rooms) ? r.rooms : []; };
  UR.roomNames = function (pid) { return UR.rooms(pid).map(B.roomName); };
  UR.canEdit = function () { return O.can('properties.edit'); };
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function audit(text) { if (!Array.isArray(D.auditLog)) D.auditLog = []; D.auditLog.unshift({ at: D.NOW, by: O.state.viewer, cat: 'properties', text: text }); }
  function faint(t) { return '<span class="faint">' + esc(t || 'Not set') + '</span>'; }
  function size(v) { return v ? esc(B.sizeText(v)) : ''; }

  /* ---------------- view ---------------- */
  function bedHTML(b) {
    var t = B.bedType(b.type), parts = [];
    var mat = [b.mattress ? size(b.mattress) : '', b.thick ? esc(b.thick) + ' cm thick' : ''].filter(Boolean).join(', ');
    var l1 = [mat ? '<span>Mattress</span> ' + mat : '', b.frame ? '<span>Frame</span> ' + size(b.frame) : ''].filter(Boolean);
    var l2 = ['<span>Fitted sheet</span> ' + (size(b.fitted || b.mattress) || faint()), b.flat ? '<span>Flat sheet / duvet cover</span> ' + size(b.flat) : '', b.duvet ? '<span>Comforter</span> ' + size(b.duvet) : ''].filter(Boolean);
    var l3 = [b.pillows ? '<span>Pillows</span> ' + esc(b.pillows) + (b.pillow ? ' × ' + size(b.pillow) : '') : '<span>No pillows</span>', b.pillows && b.pcase && b.pcase !== b.pillow ? '<span>Pillowcase</span> ' + size(b.pcase) : ''].filter(Boolean);
    parts.push(l1.join(' · '), l2.join(' · '), l3.join(' · '));
    return '<div class="ur-bed"><div class="t">' + esc(t.label) + (b.qty > 1 ? ' × ' + esc(b.qty) : '') + (b.protector ? U.pill('Mattress protector', 'info') : '') + '</div>' +
      parts.filter(Boolean).map(function (x) { return '<div class="s">' + x + '</div>'; }).join('') +
      (b.notes ? '<div class="s">' + esc(b.notes) + '</div>' : '') + '</div>';
  }
  function linenHTML(rooms) {
    var L = B.linen(rooms); if (!L.length) return '';
    var per = L.filter(function (x) { return x.perChange; }), stay = L.filter(function (x) { return !x.perChange; });
    var row = function (x) { return '<tr><td class="n">' + esc(x.n) + ' ×</td><td>' + esc(x.item) + '</td><td class="z">' + esc(x.size === 'size not set' ? 'size not set' : B.sizeText(x.size)) + '</td></tr>'; };
    return '<section class="pp-vs" data-ur-linen><h4>Linen per change</h4><div class="xs muted" style="margin-bottom:6px">One full change of every bed, for laundry to prepare.</div><table class="ur-lin"><tbody>' +
      per.map(row).join('') + (stay.length ? '<tr class="sub"><td colspan="3">On the beds, not changed each time</td></tr>' + stay.map(row).join('') : '') + '</tbody></table></section>';
  }
  /* X: {h, sub, body, foot}; host: {tabsHTML, toEdit(), close()} */
  UR.view = function (X, p, host) {
    var r = rec(p.id), rooms = r && Array.isArray(r.rooms) ? r.rooms : [], ed = UR.canEdit() && !p.archived;
    var h = host.tabsHTML + '<div class="pp-vbody" data-ur-view>';
    if (!rooms.length) {
      h += '<div class="note">No rooms and beds for ' + esc(p.short || p.name) + ' yet. ' + (ed ? 'Add each room with its beds, mattress, sheet and pillow sizes, and laundry sees what one full change needs.' : 'Someone who can edit property details can add them.') + '</div>';
    } else {
      var c = B.capacity(rooms);
      h += '<div class="ur-sum"><span><b>' + esc(fmt.plural(rooms.length, 'room')) + '</b> with beds</span><span><b>' + esc(fmt.plural(c.beds, 'bed')) + '</b></span><span>Sleeps <b>' + esc(c.sleeps) + '</b>' + (p.maxGuests && +p.maxGuests !== c.sleeps ? ' <span class="xs muted">(the unit says ' + esc(p.maxGuests) + ' guests)</span>' : '') + '</span></div>';
      rooms.forEach(function (room) {
        h += '<section class="pp-vs"><h4>' + esc(B.roomName(room)) + '</h4>' + ((room.beds || []).length ? room.beds.map(bedHTML).join('') : '<div class="small muted">No beds in this room.</div>') + '</section>';
      });
      h += linenHTML(rooms);
      if (r.updatedAt) { var by = r.updatedBy && D.staffById(r.updatedBy); h += '<div class="xs muted">Last changed ' + esc(fmt.dateTime(r.updatedAt)) + (by ? ' by ' + esc(by.name) : '') + '</div>'; }
    }
    X.body.innerHTML = h + '</div>';
    X.foot.innerHTML = '<button type="button" class="btn btn-ghost" data-ur="close">Close</button><div class="r">' + (ed ? '<button type="button" class="btn btn-primary" data-ur="edit">' + O.icon('edit') + (rooms.length ? 'Edit rooms & beds' : 'Add rooms & beds') + '</button>' : '') + '</div>';
  };

  /* ---------------- edit ---------------- */
  var ED = null; /* {pid, rooms} */
  UR.edit = function (X, p, host) {
    ED = { pid: p.id, rooms: clone(UR.rooms(p.id)) };
    if (!ED.rooms.length) ED.rooms.push({ id: 'R1', kind: 'master', name: 'Master bedroom', beds: [B.newBed('queen', 'B1')] });
    X.h.textContent = 'Rooms & beds · ' + (p.short || p.name);
    X.sub.textContent = 'Sizes in cm, width x length. Pick a size or type your own.';
    X.body.innerHTML = '<form class="pp-form" data-ur-form novalidate autocomplete="off">' + lists() + '<div data-ur-rooms>' + roomsHTML() + '</div>' +
      '<div class="ur-add" style="margin-top:4px"><select class="select" data-ur-newroom aria-label="Room to add">' + B.ROOM_KINDS.map(function (k) { return '<option value="' + k.id + '"' + (k.id === nextKind() ? ' selected' : '') + '>' + esc(k.label) + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-ur="addroom">' + O.icon('plus') + 'Add room</button></div></form>';
    X.foot.innerHTML = '<button type="button" class="btn btn-ghost" data-ur="cancel">Cancel</button><div class="r"><button type="button" class="btn btn-primary" data-ur="save">Save rooms & beds</button></div>';
  };
  function nextKind() { var used = ED ? ED.rooms.map(function (r) { return r.kind; }) : []; var k = B.ROOM_KINDS.filter(function (x) { return x.id !== 'other' && used.indexOf(x.id) < 0; })[0]; return k ? k.id : 'other'; }
  function lists() {
    var dl = function (id, opts) { return '<datalist id="' + id + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('') + '</datalist>'; };
    return dl('ur-dl-mat', B.MATTRESS_SIZES) + dl('ur-dl-cover', B.COVER_SIZES) + dl('ur-dl-pil', B.PILLOW_SIZES);
  }
  function fld(name, label, input, o) {
    o = o || {};
    return '<div class="field' + (o.full ? ' full' : '') + '"><label for="ur-' + name.replace(/\./g, '-') + '">' + esc(label) + '</label>' + input + (o.hint ? '<div class="hint">' + esc(o.hint) + '</div>' : '') + '</div>';
  }
  function inp(name, val, attrs) { return '<input class="input" id="ur-' + name.replace(/\./g, '-') + '" name="' + esc(name) + '" value="' + esc(val == null ? '' : val) + '"' + (attrs || '') + '>'; }
  function sel(name, val, opts) { return '<select class="select" id="ur-' + name.replace(/\./g, '-') + '" name="' + esc(name) + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; }
  function bedForm(b, i, j) {
    var n = 'r.' + i + '.b.' + j + '.';
    return '<div class="ur-brow" data-bed-row="' + i + '.' + j + '"><div class="bh"><span>Bed ' + (j + 1) + ' · ' + esc(B.bedType(b.type).label) + '</span><button type="button" class="btn btn-quiet btn-xs" data-ur="delbed" data-i="' + i + '" data-j="' + j + '" aria-label="Remove bed ' + (j + 1) + '">' + O.icon('trash') + 'Remove</button></div><div class="form-grid">' +
      fld(n + 'type', 'Bed type', sel(n + 'type', b.type, B.BED_TYPES.map(function (t) { return [t.id, t.label]; }))) +
      fld(n + 'qty', 'How many', inp(n + 'qty', b.qty || 1, ' type="number" min="1" max="' + B.MAX_QTY + '" step="1" inputmode="numeric"')) +
      '<div class="ur-group">Mattress and frame</div>' +
      fld(n + 'mattress', 'Mattress size', inp(n + 'mattress', b.mattress, ' list="ur-dl-mat" maxlength="60" placeholder="e.g. 152x190"')) +
      fld(n + 'thick', 'Mattress thickness (cm)', inp(n + 'thick', b.thick, ' type="number" min="1" max="60" step="1" inputmode="numeric" placeholder="e.g. 25"')) +
      fld(n + 'frame', 'Bed frame size', inp(n + 'frame', b.frame, ' list="ur-dl-mat" maxlength="60" placeholder="Optional"')) +
      '<div class="field"><label class="ur-check"><input type="checkbox" name="' + n + 'protector"' + (b.protector ? ' checked' : '') + '> Mattress protector</label></div>' +
      '<div class="ur-group">Sheets and comforter</div>' +
      fld(n + 'fitted', 'Fitted bedsheet size', inp(n + 'fitted', b.fitted, ' list="ur-dl-mat" maxlength="60" placeholder="Same as the mattress"')) +
      fld(n + 'flat', 'Flat sheet / duvet cover size', inp(n + 'flat', b.flat, ' list="ur-dl-cover" maxlength="60"')) +
      fld(n + 'duvet', 'Comforter / duvet size', inp(n + 'duvet', b.duvet, ' list="ur-dl-cover" maxlength="60"')) +
      '<div class="ur-group">Pillows</div>' +
      fld(n + 'pillows', 'Pillows on this bed', inp(n + 'pillows', b.pillows, ' type="number" min="0" max="' + B.MAX_PILLOWS + '" step="1" inputmode="numeric"'), { hint: b.qty > 1 ? 'For each bed' : '' }) +
      fld(n + 'pillow', 'Pillow size', inp(n + 'pillow', b.pillow, ' list="ur-dl-pil" maxlength="60" placeholder="e.g. 48x74"')) +
      fld(n + 'pcase', 'Pillowcase size', inp(n + 'pcase', b.pcase, ' list="ur-dl-pil" maxlength="60" placeholder="Same as the pillow"')) +
      fld(n + 'notes', 'Notes', inp(n + 'notes', b.notes, ' maxlength="200" placeholder="e.g. Foldable, kept in the store room"'), { full: true }) +
      '</div></div>';
  }
  function roomsHTML() {
    return ED.rooms.map(function (r, i) {
      return '<div class="ur-room" data-room-row="' + i + '"><div class="rh">' +
        fld('r.' + i + '.kind', 'Room', sel('r.' + i + '.kind', r.kind, B.ROOM_KINDS.map(function (k) { return [k.id, k.label]; }))) +
        fld('r.' + i + '.name', 'Name', inp('r.' + i + '.name', r.name, ' maxlength="40"')) +
        '<button type="button" class="btn btn-quiet btn-sm" data-ur="delroom" data-i="' + i + '" aria-label="Remove ' + esc(B.roomName(r)) + '">' + O.icon('trash') + 'Remove room</button></div>' +
        (r.beds || []).map(function (b, j) { return bedForm(b, i, j); }).join('') +
        ((r.beds || []).length < B.MAX_BEDS ? '<button type="button" class="btn btn-ghost btn-sm" data-ur="addbed" data-i="' + i + '">' + O.icon('plus') + 'Add a bed</button>' : '') + '</div>';
    }).join('');
  }
  function readForm(el) {
    if (!ED) return;
    var form = O.$('[data-ur-form]', el); if (!form) return;
    O.$$('[name]', form).forEach(function (x) {
      var m = /^r\.(\d+)\.(?:b\.(\d+)\.)?(\w+)$/.exec(x.name); if (!m) return;
      var r = ED.rooms[+m[1]]; if (!r) return;
      var o = m[2] != null ? (r.beds || [])[+m[2]] : r; if (!o) return;
      o[m[3]] = x.type === 'checkbox' ? x.checked : x.type === 'number' ? (x.value === '' ? '' : +x.value) : x.value;
    });
  }
  function paint(el) { var box = O.$('[data-ur-rooms]', el); if (box) box.innerHTML = roomsHTML(); var nr = O.$('[data-ur-newroom]', el); if (nr) nr.value = nextKind(); }
  function uid(list, prefix) { var n = list.length + 1, ids = list.map(function (x) { return x.id; }); while (ids.indexOf(prefix + n) >= 0) n++; return prefix + n; }

  /* a change in the form: a new bed type fills in its usual sizes; a new room kind renames a room still called by its old kind */
  UR.input = function (e, el, p) {
    if (!ED || ED.pid !== p.id || e.type !== 'change') return;
    var t = e.target, m;
    if ((m = /^r\.(\d+)\.b\.(\d+)\.type$/.exec(t.name || ''))) {
      var room = ED.rooms[+m[1]], j = +m[2], oldType = room.beds[j].type;
      readForm(el);
      var cur = room.beds[j]; cur.type = oldType;
      room.beds[j] = B.retype(cur, t.value);
      paint(el); return;
    }
    if ((m = /^r\.(\d+)\.kind$/.exec(t.name || ''))) {
      var r = ED.rooms[+m[1]], old = B.label(B.ROOM_KINDS, r.kind), nameIn = O.$('[name="r.' + m[1] + '.name"]', el);
      readForm(el);
      if (nameIn && (!nameIn.value.trim() || nameIn.value.trim() === old)) { r.name = B.label(B.ROOM_KINDS, t.value); nameIn.value = r.name; }
    }
  };

  /* host: {el, toView(), toEdit(), close(), dirty(bool), isDirty()} -> true when handled */
  UR.click = function (e, p, host) {
    var b = e.target.closest('[data-ur]'); if (!b || !p) return false;
    var a = b.dataset.ur;
    if (a === 'close') host.close();
    else if (a === 'edit') { if (!UR.canEdit()) U.toast('Your access does not include "' + O.permLabel('properties.edit') + '".', 'bad'); else host.toEdit(); }
    else if (a === 'cancel') {
      var back = function () { ED = null; host.toView(); };
      if (host.isDirty()) U.confirm('Discard your changes?', 'Discard', 'danger').then(function (ok) { if (ok) back(); }); else back();
    }
    else if (a === 'addroom') {
      readForm(host.el);
      if (ED.rooms.length >= B.MAX_ROOMS) { U.toast('A unit can have up to ' + B.MAX_ROOMS + ' rooms here.', 'bad'); return true; }
      var k = (O.$('[data-ur-newroom]', host.el) || {}).value || 'other';
      var nr = { id: uid(ED.rooms, 'R'), kind: k, name: B.label(B.ROOM_KINDS, k), beds: k === 'living' || k === 'study' ? [] : [B.newBed(k === 'master' ? 'queen' : 'single', 'B1')] };
      if (k === 'living' || k === 'study') nr.beds.push(B.newBed(k === 'living' ? 'sofabed' : 'single', 'B1'));
      ED.rooms.push(nr); paint(host.el); host.dirty(true);
      var rows = O.$$('[data-room-row]', host.el), last = rows[rows.length - 1]; if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest' });
    }
    else if (a === 'delroom') { readForm(host.el); ED.rooms.splice(+b.dataset.i, 1); paint(host.el); host.dirty(true); }
    else if (a === 'addbed') { readForm(host.el); var rm = ED.rooms[+b.dataset.i]; rm.beds = rm.beds || []; rm.beds.push(B.newBed('single', uid(rm.beds, 'B'))); paint(host.el); host.dirty(true); }
    else if (a === 'delbed') { readForm(host.el); ED.rooms[+b.dataset.i].beds.splice(+b.dataset.j, 1); paint(host.el); host.dirty(true); }
    else if (a === 'save') {
      if (!UR.canEdit()) { U.toast('Your access does not include "' + O.permLabel('properties.edit') + '".', 'bad'); return true; }
      readForm(host.el);
      var rooms = B.clean(ED.rooms), r = rec(p.id), isNew = !r;
      if (!r) { r = { id: B.recordId(p.id), propertyId: p.id }; D.unitRooms.push(r); }
      r.rooms = rooms; r.updatedAt = D.NOW; r.updatedBy = O.state.viewer;
      var c = B.capacity(rooms);
      audit((isNew ? 'Added' : 'Updated') + ' the rooms and beds of ' + p.name + ': ' + fmt.plural(rooms.length, 'room') + ', ' + fmt.plural(c.beds, 'bed'));
      ED = null; host.dirty(false);
      O.emit('data', { type: 'unitRooms', id: r.id });
      host.toView();
      U.toast('Rooms and beds saved for ' + (p.short || p.name));
    }
    else return false;
    return true;
  };
})();
