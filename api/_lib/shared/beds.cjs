/* Rooms and beds of a unit: which room has which bed, mattress, sheets and pillows, and what one full linen change
 * needs. No browser or network code.
 *
 * Arnob: "I also need bed mapping. Which unit which room has which bed size, mattress size, bedsheet size, pillow size"
 *
 * One record per unit in the synced records collection 'unitRooms' (app/pages/unitrooms.js; docs/notes/beds-and-requests.md):
 *   {id: 'UR-<propertyId>', propertyId, rooms: [room], updatedAt, updatedBy}
 *   room: {id, kind ('master'|'bed2'|'bed3'|'living'|'study'|'other'), name, beds: [bed]}
 *   bed:  {id, type (BED_TYPES id), qty (1-9), frame, mattress, thick (cm), fitted, flat, duvet, pillow, pillows (per bed),
 *          pcase, protector (true|false), notes}
 *   Sizes are text: a preset such as '152x190' (cm, width x length) or anything the operator types.
 *
 * Shared by the page (inlined by scripts/build.mjs as O.beds) and the node tests (tests/beds-requests.test.mjs). ES5.
 */
'use strict';

var ROOM_KINDS = [
  { id: 'master', label: 'Master bedroom' },
  { id: 'bed2', label: 'Bedroom 2' },
  { id: 'bed3', label: 'Bedroom 3' },
  { id: 'living', label: 'Living room' },
  { id: 'study', label: 'Study' },
  { id: 'other', label: 'Other' }
];
/* sleeps: guests one bed takes; mattresses: mattresses on one bed (1 unless given; a bunk has 2, each needs its own sheets); d: the sizes a new bed of this type starts with (cm, common in Malaysia) */
var BED_TYPES = [
  { id: 'king', label: 'King', sleeps: 2, d: { mattress: '183x190', thick: 25, flat: '240x220', duvet: '240x220', pillow: '48x74', pillows: 4 } },
  { id: 'queen', label: 'Queen', sleeps: 2, d: { mattress: '152x190', thick: 25, flat: '210x210', duvet: '210x210', pillow: '48x74', pillows: 2 } },
  { id: 'supersingle', label: 'Super single', sleeps: 1, d: { mattress: '107x190', thick: 20, flat: '160x210', duvet: '160x210', pillow: '48x74', pillows: 1 } },
  { id: 'single', label: 'Single', sleeps: 1, d: { mattress: '91x190', thick: 20, flat: '140x210', duvet: '140x210', pillow: '48x74', pillows: 1 } },
  { id: 'sofabed', label: 'Sofa bed', sleeps: 2, d: { mattress: '120x190', thick: 12, flat: '160x210', duvet: '160x210', pillow: '48x74', pillows: 2 } },
  { id: 'extra', label: 'Extra bed / foldable', sleeps: 1, d: { mattress: '91x190', thick: 10, flat: '140x210', duvet: '140x210', pillow: '48x74', pillows: 1 } },
  { id: 'bunk', label: 'Bunk', sleeps: 2, mattresses: 2, d: { mattress: '91x190', thick: 15, flat: '140x210', duvet: '140x210', pillow: '48x74', pillows: 2 } },
  { id: 'other', label: 'Other', sleeps: 1, d: {} }
];
/* size presets: [value, label] (the value is what is saved; anything else typed is kept as it is) */
var MATTRESS_SIZES = [['183x190', 'King 183 x 190 cm'], ['152x190', 'Queen 152 x 190 cm'], ['107x190', 'Super single 107 x 190 cm'], ['91x190', 'Single 91 x 190 cm'], ['200x200', 'Super king 200 x 200 cm'], ['120x190', 'Sofa bed 120 x 190 cm']];
var COVER_SIZES = [['240x220', 'King 240 x 220 cm'], ['210x210', 'Queen 210 x 210 cm'], ['160x210', 'Super single 160 x 210 cm'], ['140x210', 'Single 140 x 210 cm']];
var PILLOW_SIZES = [['48x74', 'Standard 48 x 74 cm'], ['51x76', 'Queen 51 x 76 cm'], ['51x91', 'King 51 x 91 cm'], ['65x65', 'Euro square 65 x 65 cm'], ['bolster', 'Bolster (bantal peluk)']];
var MAX_ROOMS = 12, MAX_BEDS = 8, MAX_QTY = 9, MAX_PILLOWS = 8;

function label(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].label; return ''; }
function bedType(id) { for (var i = 0; i < BED_TYPES.length; i++) if (BED_TYPES[i].id === id) return BED_TYPES[i]; return BED_TYPES[BED_TYPES.length - 1]; }
function str(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 60); }
function int(v, lo, hi, dflt) { var n = parseInt(v, 10); return isNaN(n) ? dflt : Math.max(lo, Math.min(hi, n)); }
/* '152x190' -> 'Queen 152 x 190 cm'; anything else as typed */
function sizeText(v, list) {
  v = str(v); if (!v) return '';
  var all = (list || []).concat(MATTRESS_SIZES, COVER_SIZES, PILLOW_SIZES);
  for (var i = 0; i < all.length; i++) if (all[i][0] === v) return all[i][1];
  return /^\d+\s*x\s*\d+$/i.test(v) ? v.replace(/\s*x\s*/i, ' x ') + ' cm' : v;
}
function roomName(r) { return str(r && r.name) || label(ROOM_KINDS, r && r.kind) || 'Room'; }

/* a new bed of a type, with that type's usual sizes */
function newBed(type, id) {
  var t = bedType(type), d = t.d;
  return { id: id || '', type: t.id, qty: 1, frame: '', mattress: d.mattress || '', thick: d.thick || '', fitted: '', flat: d.flat || '', duvet: d.duvet || '', pillow: d.pillow || '', pillows: d.pillows || 0, pcase: '', protector: true, notes: '' };
}
/* switching a bed's type: fields still at the old type's defaults (or empty) take the new type's */
function retype(bed, type) {
  var o = bedType(bed.type).d, n = bedType(type).d, out = {};
  Object.keys(bed).forEach(function (k) { out[k] = bed[k]; });
  out.type = bedType(type).id;
  ['mattress', 'thick', 'flat', 'duvet', 'pillow', 'pillows'].forEach(function (k) {
    var cur = bed[k];
    if (cur === '' || cur == null || String(cur) === String(o[k] == null ? '' : o[k])) out[k] = n[k] == null ? (k === 'pillows' ? 0 : '') : n[k];
  });
  return out;
}

/* clean one unit's rooms as saved (drops empty rooms' blank beds, trims text, bounds the numbers) */
function clean(rooms) {
  return (Array.isArray(rooms) ? rooms : []).slice(0, MAX_ROOMS).map(function (r, i) {
    var kind = label(ROOM_KINDS, r && r.kind) ? r.kind : 'other';
    return {
      id: str(r && r.id, 40) || 'R' + (i + 1), kind: kind, name: str(r && r.name, 40) || label(ROOM_KINDS, kind),
      beds: (Array.isArray(r && r.beds) ? r.beds : []).slice(0, MAX_BEDS).map(function (b, j) {
        b = b || {};
        var thick = b.thick === '' || b.thick == null ? '' : int(b.thick, 1, 60, '');
        return {
          id: str(b.id, 40) || 'B' + (j + 1), type: bedType(b.type).id, qty: int(b.qty, 1, MAX_QTY, 1),
          frame: str(b.frame), mattress: str(b.mattress), thick: thick, fitted: str(b.fitted), flat: str(b.flat), duvet: str(b.duvet),
          pillow: str(b.pillow), pillows: int(b.pillows, 0, MAX_PILLOWS, 0), pcase: str(b.pcase), protector: !!b.protector, notes: str(b.notes, 200)
        };
      })
    };
  });
}

/* how many guests the beds sleep, and how many beds */
function capacity(rooms) {
  var beds = 0, sleeps = 0;
  (rooms || []).forEach(function (r) { (r.beds || []).forEach(function (b) { var q = int(b.qty, 1, MAX_QTY, 1); beds += q; sleeps += q * bedType(b.type).sleeps; }); });
  return { beds: beds, sleeps: sleeps };
}

/* what one full linen change of the unit needs, by item and size:
 *   [{item, size, n, perChange}]  perChange false = stays on the bed (comforters, duvets), listed so laundry knows the sizes
 * sheets, protector and comforter: one per mattress (a bunk has 2); fitted sheet: the fitted size, else the mattress size; pillowcases: pillows x qty of the pillowcase size, else the pillow size;
 * mattress protector: the mattress size, beds that have one. Sorted: per change first, then item order, then size. */
var ITEMS = [['fitted', 'Fitted sheet'], ['flat', 'Flat sheet / duvet cover'], ['pcase', 'Pillowcase'], ['protector', 'Mattress protector'], ['duvet', 'Comforter / duvet'], ['pillow', 'Pillow']];
function linen(rooms) {
  var map = {}, order = {};
  ITEMS.forEach(function (x, i) { order[x[0]] = i; });
  function add(item, size, n) {
    if (!n) return;
    size = str(size) || 'size not set';
    var k = item + '|' + size;
    if (!map[k]) map[k] = { key: item, item: ITEMS[order[item]][1], size: size, n: 0, perChange: item !== 'duvet' && item !== 'pillow' };
    map[k].n += n;
  }
  (rooms || []).forEach(function (r) {
    (r.beds || []).forEach(function (b) {
      var q = int(b.qty, 1, MAX_QTY, 1), p = int(b.pillows, 0, MAX_PILLOWS, 0), m = q * (bedType(b.type).mattresses || 1);
      add('fitted', b.fitted || b.mattress, m);
      if (b.flat) add('flat', b.flat, m);
      add('pcase', b.pcase || b.pillow, p * q);
      if (b.protector) add('protector', b.mattress, m);
      if (b.duvet) add('duvet', b.duvet, m);
      add('pillow', b.pillow, p * q);
    });
  });
  return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
    if (a.perChange !== b.perChange) return a.perChange ? -1 : 1;
    return order[a.key] - order[b.key] || (a.size < b.size ? -1 : a.size > b.size ? 1 : 0);
  });
}

/* the record id of a unit's rooms */
function recordId(propertyId) { return 'UR-' + propertyId; }

module.exports = {
  ROOM_KINDS: ROOM_KINDS, BED_TYPES: BED_TYPES, MATTRESS_SIZES: MATTRESS_SIZES, COVER_SIZES: COVER_SIZES, PILLOW_SIZES: PILLOW_SIZES,
  MAX_ROOMS: MAX_ROOMS, MAX_BEDS: MAX_BEDS, MAX_QTY: MAX_QTY, MAX_PILLOWS: MAX_PILLOWS,
  label: label, bedType: bedType, sizeText: sizeText, roomName: roomName, newBed: newBed, retype: retype, clean: clean,
  capacity: capacity, linen: linen, recordId: recordId
};
