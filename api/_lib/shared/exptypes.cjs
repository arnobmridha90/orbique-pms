/* Expense types and the categories they are grouped in (Arnob, 2026-11-22: "I need to be able to add expense type and
 * categories from settings in both apps").
 *
 * Saved in two config blobs:
 *   expenseTypes  ['Rent', 'Utilities', ..., 'Others']    the types people choose from, in order ('Others' is always last)
 *   expenseSetup  { cats: [{id, name}],                    the categories, in order
 *                   types: { 'Rent': {cat, cls, fixed} } } per type: its category, the cost type it suggests
 *                                                          ('opex' operating | 'capex' capital) and whether it is a
 *                                                          fixed cost (the same every month) or a variable one
 * A workspace that never saved expenseSetup gets defaults() for the built-in types. A type removed from the list stays on
 * the expenses that already use it (reports still show it); it is only no longer offered for new expenses.
 * 'Rent' (unit files pay rent with it) and 'Others' (asks what it was for) can be moved to another category but not
 * renamed or removed.
 *
 * Shared by the app (inlined by scripts/build.mjs as O.exptypes: pages/settings.js, pages/expenses.js, data.js) and node
 * tests (tests/exptypes.test.mjs). No browser or network code. ES5.
 */
'use strict';

var LOCKED = ['Rent', 'Others'];
var MAX_NAME = 40;
/* i18n:off (names of the workspace's own types and categories: data, which people rename) */
var DEFAULT_CATS = [
  ['property', 'Property costs', ['Rent', 'Utilities', 'Internet & TV', 'Repairs & maintenance', 'Insurance']],
  ['supplies', 'Cleaning & guest supplies', ['Cleaning supplies', 'Laundry', 'Toiletries & amenities']],
  ['equipment', 'Furniture & equipment', ['Furniture & equipment']],
  ['staff', 'Staff & transport', ['Salaries & wages', 'Transport']],
  ['office', 'Sales & office', ['Marketing', 'Software & subscriptions']],
  ['other', 'Other', ['Others']]
];
var DEFAULT_CAPEX = ['Furniture & equipment'];
var DEFAULT_FIXED = ['Rent', 'Salaries & wages', 'Internet & TV', 'Software & subscriptions', 'Insurance'];
/* i18n:on */

function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function same(a, b) { return clean(a).toLowerCase() === clean(b).toLowerCase(); }

function defaultInfo(type) {
  var cat = 'other';
  DEFAULT_CATS.forEach(function (c) { if (c[2].indexOf(type) >= 0) cat = c[0]; });
  return { cat: cat, cls: DEFAULT_CAPEX.indexOf(type) >= 0 ? 'capex' : 'opex', fixed: DEFAULT_FIXED.indexOf(type) >= 0 };
}

function defaults(list) {
  var types = {};
  (list || []).forEach(function (t) { types[t] = defaultInfo(t); });
  return { cats: DEFAULT_CATS.map(function (c) { return { id: c[0], name: c[1] }; }), types: types };
}

/* a clean copy of a saved list and setup: every type has an entry pointing at a category that exists, 'Others' last */
function normalize(list, setup) {
  var out = [], seen = {};
  (Array.isArray(list) ? list : []).forEach(function (t) { t = clean(t); if (t && !seen[t.toLowerCase()] && t !== 'Others') { seen[t.toLowerCase()] = 1; out.push(t); } });
  out.push('Others');
  var s = setup && typeof setup === 'object' ? setup : defaults(out);
  var cats = [], ids = {};
  (Array.isArray(s.cats) ? s.cats : []).forEach(function (c) { if (c && c.id && !ids[c.id] && clean(c.name)) { ids[c.id] = 1; cats.push({ id: String(c.id), name: clean(c.name) }); } });
  if (!cats.length) cats = defaults([]).cats;
  if (!cats.some(function (c) { return c.id === 'other'; })) cats.push({ id: 'other', name: 'Other' });
  var types = {}, src = s.types && typeof s.types === 'object' ? s.types : {};
  out.forEach(function (t) {
    var d = defaultInfo(t), x = own(src, t) && src[t] ? src[t] : d;
    types[t] = { cat: cats.some(function (c) { return c.id === x.cat; }) ? x.cat : (cats.some(function (c) { return c.id === d.cat; }) ? d.cat : 'other'), cls: x.cls === 'capex' ? 'capex' : 'opex', fixed: !!x.fixed };
  });
  return { list: out, setup: { cats: cats, types: types } };
}

function info(setup, type) {
  var x = setup && setup.types && own(setup.types, type) ? setup.types[type] : null;
  return x ? { cat: x.cat, cls: x.cls === 'capex' ? 'capex' : 'opex', fixed: !!x.fixed } : defaultInfo(type);
}

/* [{cat: {id, name}, types: [...]}] in category order; a category with no types is kept (so it can be filled) */
function grouped(list, setup) {
  var n = normalize(list, setup);
  return n.setup.cats.map(function (c) { return { cat: c, types: n.list.filter(function (t) { return n.setup.types[t].cat === c.id; }) }; });
}

function nameError(name, taken, what) {
  var v = clean(name);
  if (!v) return 'Type a name.';
  if (v.length > MAX_NAME) return 'Keep the name under 40 letters.';
  if ((taken || []).some(function (t) { return same(t, v); })) return what === 'cat' ? 'There is already a category with that name.' : 'There is already a type with that name.';
  return '';
}

/* the mutators change st = {list, setup} (normalized) in place and return '' or the reason they could not */
function addType(st, name, o) {
  var v = clean(name), e = nameError(v, st.list, 'type'); if (e) return e;
  o = o || {};
  st.list.splice(st.list.length - 1, 0, v); /* before 'Others' */
  st.setup.types[v] = { cat: st.setup.cats.some(function (c) { return c.id === o.cat; }) ? o.cat : 'other', cls: o.cls === 'capex' ? 'capex' : 'opex', fixed: !!o.fixed };
  return '';
}
function setType(st, name, o) {
  var x = st.setup.types[name]; if (!x || st.list.indexOf(name) < 0) return 'That type is not in the list.';
  if (o.cat !== undefined) { if (!st.setup.cats.some(function (c) { return c.id === o.cat; })) return 'Choose a category.'; x.cat = o.cat; }
  if (o.cls !== undefined) x.cls = o.cls === 'capex' ? 'capex' : 'opex';
  if (o.fixed !== undefined) x.fixed = !!o.fixed;
  return '';
}
function renameType(st, from, to) {
  var i = st.list.indexOf(from); if (i < 0) return 'That type is not in the list.';
  if (LOCKED.indexOf(from) >= 0) return 'This type is built in and keeps its name.';
  var v = clean(to); if (v === from) return '';
  var e = nameError(v, st.list.filter(function (t) { return t !== from; }), 'type'); if (e) return e;
  st.list[i] = v; st.setup.types[v] = st.setup.types[from]; delete st.setup.types[from];
  return '';
}
function removeType(st, name) {
  var i = st.list.indexOf(name); if (i < 0) return 'That type is not in the list.';
  if (LOCKED.indexOf(name) >= 0) return 'This type is built in and cannot be removed.';
  st.list.splice(i, 1); delete st.setup.types[name];
  return '';
}
function moveType(st, name, dir) {
  var i = st.list.indexOf(name), j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || name === 'Others' || j < 0 || j >= st.list.length - 1) return '';
  st.list[i] = st.list[j]; st.list[j] = name;
  return '';
}
function slug(name, taken) {
  var b = clean(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'cat', id = b, n = 2;
  while (taken.indexOf(id) >= 0) id = b + '-' + n++;
  return id;
}
function addCat(st, name) {
  var v = clean(name), e = nameError(v, st.setup.cats.map(function (c) { return c.name; }), 'cat'); if (e) return e;
  var id = slug(v, st.setup.cats.map(function (c) { return c.id; }));
  var at = st.setup.cats.findIndex ? st.setup.cats.findIndex(function (c) { return c.id === 'other'; }) : -1;
  if (at < 0) st.setup.cats.push({ id: id, name: v }); else st.setup.cats.splice(at, 0, { id: id, name: v }); /* 'Other' stays last */
  st.lastCat = id;
  return '';
}
function renameCat(st, id, name) {
  var c = st.setup.cats.filter(function (x) { return x.id === id; })[0]; if (!c) return 'That category is not in the list.';
  var v = clean(name); if (v === c.name) return '';
  var e = nameError(v, st.setup.cats.filter(function (x) { return x.id !== id; }).map(function (x) { return x.name; }), 'cat'); if (e) return e;
  c.name = v;
  return '';
}
/* the category's types move to 'Other' */
function removeCat(st, id) {
  if (id === 'other') return 'The "Other" category is where types without a category go, so it stays.';
  var i = -1; st.setup.cats.forEach(function (c, k) { if (c.id === id) i = k; }); if (i < 0) return 'That category is not in the list.';
  st.setup.cats.splice(i, 1);
  Object.keys(st.setup.types).forEach(function (t) { if (st.setup.types[t].cat === id) st.setup.types[t].cat = 'other'; });
  return '';
}

module.exports = { LOCKED: LOCKED, MAX_NAME: MAX_NAME, defaults: defaults, defaultInfo: defaultInfo, normalize: normalize, info: info, grouped: grouped,
  nameError: nameError, addType: addType, setType: setType, renameType: renameType, removeType: removeType, moveType: moveType,
  addCat: addCat, renameCat: renameCat, removeCat: removeCat };
