/* Website content: the buildings, units (suites) and photos a workspace's own website shows (version 1).
 *
 * Saved as two blobs (see supabase/migrations/0017_site_content.sql):
 *   siteContent       the draft, edited on the Live website page (app/pages/livesite.js), saved by the normal sync
 *   siteContentLive   {content, publishedAt, publishedBy, history}, written only by the server on Publish (api/site.js)
 * The website (websites/kozi-next) reads the live copy from GET /api/public/site and has its own copy of these rules.
 *
 *   SiteContent {version: 1, buildings: Building[], suites: Suite[]}   (array order = display order)
 *   Building {id, cityId, city, name, building, address, area, intro, checkIn, checkOut, photos, visible}
 *   Suite {id, buildingId, name, levels, line, story, highlights, views, bedrooms, bathrooms, sleeps, extraBed, bookType,
 *          photos, visible, seoTitle?, seoDescription?}
 *   Photo {id, kind: 'builtin'|'upload', key? (builtin), base? (upload), widths, w, h, alt}
 * File for width W: builtin -> <siteUrl>/photos/<key>-<W>.jpg, upload -> <base>-<W>.jpg.
 *
 *   check(content, opts)     the one validator: {content (cleaned), errors, warnings, problems: [{where, field, message, level}]}
 *                            opts.strict: Publish (every problem is an error, nothing is dropped quietly); otherwise
 *                            invalid items are dropped (the public endpoint, the page's own view of the draft).
 *                            opts.uploadPrefixes: the URL prefixes an upload's base may start with (null: any https URL);
 *                            opts.bookTypes: the booking settings' type keys (null: not checked)
 *   diff(before, after)      what Publish changes, in plain words: ['2 photos added to Boutique Suite', 'Standard Suite shown']
 *   pagePaths(content)       the site's pages for this content ('/', city, building and unit pages, '/views/', '/sitemap.xml')
 *   planWidths(w, h)         the sizes a new photo is stored in: [{width, w, h}], 640 always, never upscaled
 *   photoSrc(photo, width, siteUrl), slugify(text), uniqueSlug(base, taken), readableAlt(fileName), canon(v), hash(text)
 *
 * Shared by the page (inlined by scripts/build.mjs as O.sitecontent) and the server (api/site.js, api/public.js).
 * ES5, no dependencies. Unit tests: tests/site-content.test.mjs.
 */
'use strict';

var VERSION = 1;
var WIDTHS = [640, 1280, 2400];
var VIEWS = ['petronas', 'kl-tower', 'merdeka', 'city'];
var VIEW_NAMES = { petronas: 'Petronas Twin Towers', 'kl-tower': 'KL Tower', merdeka: 'Merdeka 118', city: 'City skyline' };
var SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
var PHOTO_ID = /^[a-z0-9-]{4,64}$/;
var PHOTO_KEY = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i;
var BOOK_TYPE = /^[A-Za-z0-9_-]{1,40}$/;
var MAX = { buildings: 20, suites: 100, photos: 40, highlights: 8, highlight: 40, slug: 60, alt: 160, size: 20000, rooms: 20 };
/* [field, label for messages, max length, required, multiline] */
var BUILDING_TEXT = [
  ['name', 'name', 80, true], ['city', 'city', 80, true], ['building', "building's own name", 80], ['address', 'address', 200],
  ['area', 'area line', 120], ['intro', 'introduction', 1200, false, true], ['checkIn', 'check-in time', 20], ['checkOut', 'check-out time', 20]
];
var SUITE_TEXT = [
  ['name', 'name', 80, true], ['levels', 'floors', 60], ['line', 'one-line pitch', 200], ['story', 'story', 1500, false, true]
];
var SEO_TEXT = [['seoTitle', 'search title', 70], ['seoDescription', 'search description', 170]];

var isObj = function (v) { return !!v && typeof v === 'object' && !Array.isArray(v); };
var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };

/* a text value: control characters removed, spaces tidied (a paragraph keeps its line breaks) */
function cleanText(v, multiline) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number' && isFinite(v)) v = String(v);
  if (typeof v !== 'string') return null;
  if (multiline) return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ---------- the validator ---------- */

function check(input, opts) {
  opts = opts || {};
  var strict = !!opts.strict;
  var prefixes = Array.isArray(opts.uploadPrefixes) ? opts.uploadPrefixes.filter(function (p) { return typeof p === 'string' && p; }) : null;
  var bookTypes = Array.isArray(opts.bookTypes) ? opts.bookTypes : null;
  var problems = [];
  function problem(level, where, field, message) { problems.push({ level: level, where: where, field: field, message: message }); }
  /* strict: an error; otherwise the item is dropped or fixed, and nothing is reported */
  function bad(where, field, message) { if (strict) problem('error', where, field, message); }
  function warn(where, field, message) { problem('warning', where, field, message); }

  var out = { version: VERSION, buildings: [], suites: [] };
  if (!isObj(input)) {
    if (strict) problem('error', 'The website', 'content', 'There is nothing to publish yet. Add a building and a unit first.');
    return finish();
  }
  if (input.version !== undefined && input.version !== VERSION) {
    problem('error', 'The website', 'version', 'This content was saved by a newer version of Orbique. Reload the page and try again.');
    return finish();
  }

  function text(src, spec, where, target) {
    var f = spec[0], v = cleanText(src[f], spec[4]);
    if (v === null) { bad(where, f, where + ': the ' + spec[1] + ' is not valid text.'); v = ''; }
    if (v.length > spec[2]) {
      if (strict) bad(where, f, where + ': the ' + spec[1] + ' is too long (at most ' + spec[2] + ' characters).');
      v = v.slice(0, spec[2]).trim();
    }
    if (spec[3] && !v) { bad(where, f, where + ': add the ' + spec[1] + '.'); return false; }
    target[f] = v;
    return true;
  }
  function slugField(v, where, field, label) {
    var s = typeof v === 'string' ? v.trim() : '';
    if (!s) { bad(where, field, where + ': add the ' + label + '.'); return null; }
    if (s.length > MAX.slug || !SLUG.test(s)) { bad(where, field, where + ': the ' + label + ' "' + s.slice(0, 70) + '" can only use small letters, numbers and single dashes (at most ' + MAX.slug + ').'); return null; }
    return s;
  }
  function photos(list, where) {
    var got = [], seen = {};
    if (list === undefined || list === null) return got;
    if (!Array.isArray(list)) { bad(where, 'photos', where + ': the photo list is not valid.'); return got; }
    list.forEach(function (p, i) {
      if (got.length >= MAX.photos) { if (i === MAX.photos) bad(where, 'photos', where + ' has more than ' + MAX.photos + ' photos. Remove some.'); return; }
      var at = where + ', photo ' + (i + 1), ph = photo(p, at);
      if (!ph) return;
      if (seen[ph.id]) { bad(at, 'photos', at + ' is in the list twice.'); return; }
      seen[ph.id] = 1;
      got.push(ph);
    });
    return got;
  }
  function photo(p, at) {
    if (!isObj(p)) { bad(at, 'photos', at + ' is not valid.'); return null; }
    var o = {};
    if (typeof p.id !== 'string' || !PHOTO_ID.test(p.id)) { bad(at, 'photos', at + ' has no valid id. Remove it and add it again.'); return null; }
    o.id = p.id;
    if (p.kind === 'builtin') {
      if (typeof p.key !== 'string' || p.key.length > 120 || !PHOTO_KEY.test(p.key) || p.key.indexOf('..') >= 0) { bad(at, 'photos', at + ' points to a bundled photo that does not exist. Remove it.'); return null; }
      o.kind = 'builtin'; o.key = p.key;
    } else if (p.kind === 'upload') {
      var base = typeof p.base === 'string' ? p.base : '';
      var inFolder = prefixes ? prefixes.some(function (pre) { return base.indexOf(pre) === 0 && PHOTO_ID.test(base.slice(pre.length)); }) : /^https:\/\/[^\s"'<>]+$/.test(base);
      if (!inFolder || base.length > 400) { bad(at, 'photos', at + " is stored outside this workspace's photo folder. Remove it and add it again."); return null; }
      o.kind = 'upload'; o.base = base;
    } else { bad(at, 'photos', at + ' is not a bundled or an uploaded photo. Remove it.'); return null; }
    var widths = Array.isArray(p.widths) ? WIDTHS.filter(function (w) { return p.widths.indexOf(w) >= 0; }) : [];
    if (!widths.length) { bad(at, 'photos', at + ' has no stored sizes. Remove it and add it again.'); return null; }
    o.widths = widths;
    var w = Number(p.w), h = Number(p.h);
    if (!(w >= 1 && w <= MAX.size && h >= 1 && h <= MAX.size && Math.floor(w) === w && Math.floor(h) === h)) { bad(at, 'photos', at + ' has no valid size. Remove it and add it again.'); return null; }
    o.w = w; o.h = h;
    var alt = cleanText(p.alt);
    if (!alt) { bad(at, 'alt', at + ': add a short description of the photo (alt text).'); return null; }
    if (alt.length > MAX.alt) { if (strict) bad(at, 'alt', at + ': the description is too long (at most ' + MAX.alt + ' characters).'); alt = alt.slice(0, MAX.alt).trim(); }
    o.alt = alt;
    return o;
  }

  /* buildings */
  var bIn = Array.isArray(input.buildings) ? input.buildings : [];
  if (input.buildings !== undefined && !Array.isArray(input.buildings)) bad('The website', 'buildings', 'The building list is not valid.');
  var byId = {};
  bIn.forEach(function (b, i) {
    if (out.buildings.length >= MAX.buildings) { if (i === MAX.buildings) bad('The website', 'buildings', 'There are more than ' + MAX.buildings + ' buildings. Remove some.'); return; }
    if (!isObj(b)) { bad('Building ' + (i + 1), 'building', 'Building ' + (i + 1) + ' is not valid.'); return; }
    var where = cleanText(b.name) || 'Building ' + (i + 1), o = {}, ok = true;
    var id = slugField(b.id, where, 'id', 'web address');
    var cityId = slugField(b.cityId, where, 'cityId', "city's web address");
    if (!id || !cityId) ok = false;
    o.id = id; o.cityId = cityId;
    BUILDING_TEXT.forEach(function (spec) { if (!text(b, spec, where, o)) ok = false; });
    if (id && byId[id]) { bad(where, 'id', where + ': the web address "' + id + '" is already used by ' + byId[id].name + '.'); ok = false; }
    if (!ok) return;
    o.photos = photos(b.photos, where);
    o.visible = b.visible !== false;
    byId[id] = o;
    out.buildings.push(o);
  });
  /* one city has one name: a second spelling for the same city address would give one page two titles */
  var cityName = {};
  out.buildings.forEach(function (b) {
    if (!cityName[b.cityId]) cityName[b.cityId] = b.city;
    else if (cityName[b.cityId] !== b.city) bad(b.name, 'city', b.name + ': the city "' + b.city + '" has the same web address as "' + cityName[b.cityId] + '". Use the same city name, or another web address.');
  });

  /* suites */
  var sIn = Array.isArray(input.suites) ? input.suites : [];
  if (input.suites !== undefined && !Array.isArray(input.suites)) bad('The website', 'suites', 'The unit list is not valid.');
  var taken = {};
  sIn.forEach(function (s, i) {
    if (out.suites.length >= MAX.suites) { if (i === MAX.suites) bad('The website', 'suites', 'There are more than ' + MAX.suites + ' units. Remove some.'); return; }
    if (!isObj(s)) { bad('Unit ' + (i + 1), 'suite', 'Unit ' + (i + 1) + ' is not valid.'); return; }
    var where = cleanText(s.name) || 'Unit ' + (i + 1), o = {}, ok = true;
    var id = slugField(s.id, where, 'id', 'web address');
    if (!id) ok = false;
    o.id = id;
    var bd = typeof s.buildingId === 'string' ? byId[s.buildingId] : null;
    if (!bd) { bad(where, 'buildingId', where + ': choose the building it is in (the one it had is not on the website).'); ok = false; }
    o.buildingId = bd ? bd.id : null;
    SUITE_TEXT.forEach(function (spec) { if (!text(s, spec, where, o)) ok = false; });
    if (id && bd) {
      var k = bd.id + '/' + id;
      if (taken[k]) { bad(where, 'id', where + ': the web address "' + id + '" is already used by ' + taken[k] + ' in ' + bd.name + '.'); ok = false; }
    }
    if (!ok) return;
    taken[bd.id + '/' + id] = o.name;
    /* highlights: short chips, at most 8 */
    var hl = [];
    (Array.isArray(s.highlights) ? s.highlights : []).forEach(function (h) {
      var v = cleanText(h);
      if (!v) return;
      if (v.length > MAX.highlight) { if (strict) bad(where, 'highlights', where + ': the highlight "' + v.slice(0, 50) + '" is too long (at most ' + MAX.highlight + ' characters).'); v = v.slice(0, MAX.highlight).trim(); }
      if (hl.indexOf(v) < 0) hl.push(v);
    });
    if (hl.length > MAX.highlights) { if (strict) bad(where, 'highlights', where + ' has ' + hl.length + ' highlights. Keep at most ' + MAX.highlights + '.'); hl = hl.slice(0, MAX.highlights); }
    o.highlights = hl;
    o.views = VIEWS.filter(function (v) { return Array.isArray(s.views) && s.views.indexOf(v) >= 0; });
    ['bedrooms', 'bathrooms', 'sleeps'].forEach(function (f) {
      var n = s[f] === undefined || s[f] === null || s[f] === '' ? 0 : Number(s[f]);
      if (!(n >= 0 && n <= MAX.rooms && Math.floor(n) === n)) {
        if (strict) bad(where, f, where + ': ' + f + ' should be a whole number from 0 to ' + MAX.rooms + '.');
        n = Math.min(MAX.rooms, Math.max(0, Math.round(Number(n) || 0)));
      }
      o[f] = n;
    });
    o.extraBed = s.extraBed === true;
    var bt = s.bookType === undefined || s.bookType === '' ? null : s.bookType;
    if (bt !== null && (typeof bt !== 'string' || !BOOK_TYPE.test(bt))) { bad(where, 'bookType', where + ': "Book online as" is not valid.'); bt = null; }
    if (bt !== null && bookTypes && bookTypes.indexOf(bt) < 0) {
      bad(where, 'bookType', where + ': "Book online as" points to a room type that is not set up for online booking. Choose another one, or "Not bookable online yet".');
      bt = null;
    }
    o.bookType = bt;
    o.photos = photos(s.photos, where);
    o.visible = s.visible !== false;
    SEO_TEXT.forEach(function (spec) {
      if (s[spec[0]] === undefined || s[spec[0]] === null || s[spec[0]] === '') return;
      var tmp = {};
      text(s, spec, where, tmp);
      if (tmp[spec[0]]) o[spec[0]] = tmp[spec[0]];
    });
    out.suites.push(o);
  });

  /* warnings: allowed, but worth a look before publishing */
  out.suites.forEach(function (s) {
    var bd = byId[s.buildingId];
    if (s.visible && !s.photos.length) warn(s.name, 'photos', s.name + ' is shown on the site but has no photos yet.');
    if (s.visible && bd && !bd.visible) warn(s.name, 'visible', s.name + ' is shown, but its building ' + bd.name + ' is hidden, so guests will not see it.');
  });
  out.buildings.forEach(function (b) {
    if (b.visible && !out.suites.some(function (s) { return s.buildingId === b.id && s.visible; })) warn(b.name, 'suites', b.name + ' is shown on the site but has no units shown.');
  });
  return finish();

  function finish() {
    return {
      content: out,
      problems: problems,
      errors: problems.filter(function (p) { return p.level === 'error'; }).map(function (p) { return p.message; }),
      warnings: problems.filter(function (p) { return p.level === 'warning'; }).map(function (p) { return p.message; })
    };
  }
}

/* ---------- what changed, in plain words ---------- */

var SUITE_FIELDS = [['name', 'name'], ['id', 'web address'], ['levels', 'floors'], ['line', 'pitch'], ['story', 'story'], ['highlights', 'highlights'], ['views', 'views'],
  ['bedrooms', 'bedrooms'], ['bathrooms', 'bathrooms'], ['sleeps', 'guests'], ['extraBed', 'extra bed'], ['bookType', 'online booking'], ['seoTitle', 'search title'], ['seoDescription', 'search description']];
var BUILDING_FIELDS = [['name', 'name'], ['id', 'web address'], ['city', 'city'], ['cityId', "city's web address"], ['building', "building's own name"], ['address', 'address'],
  ['area', 'area line'], ['intro', 'introduction'], ['checkIn', 'check-in time'], ['checkOut', 'check-out time']];

function listText(words) { return words.length < 2 ? words.join('') : words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1]; }
function same(a, b) { return canon(a === undefined ? null : a) === canon(b === undefined ? null : b); }

function photoChanges(name, a, b, out) {
  a = a || []; b = b || [];
  var aIds = a.map(function (p) { return p.id; }), bIds = b.map(function (p) { return p.id; });
  var added = bIds.filter(function (id) { return aIds.indexOf(id) < 0; }).length;
  var removed = aIds.filter(function (id) { return bIds.indexOf(id) < 0; }).length;
  if (added) out.push(plural(added, 'photo') + ' added to ' + name);
  if (removed) out.push(plural(removed, 'photo') + ' removed from ' + name);
  var keptA = aIds.filter(function (id) { return bIds.indexOf(id) >= 0; }), keptB = bIds.filter(function (id) { return aIds.indexOf(id) >= 0; });
  if (b.length && a.length && bIds[0] !== aIds[0]) out.push('New cover photo for ' + name);
  else if (keptA.join(',') !== keptB.join(',')) out.push('Photos in a new order in ' + name);
  var alts = 0;
  b.forEach(function (p) { var o = a.filter(function (x) { return x.id === p.id; })[0]; if (o && o.alt !== p.alt) alts++; });
  if (alts) out.push(plural(alts, 'photo description') + ' changed in ' + name);
}
function itemChanges(kind, before, after, fields, out) {
  var key = function (x) { return kind === 'unit' ? x.buildingId + '/' + x.id : x.id; };
  /* match by web address, else by position among the unmatched (a renamed web address is a change, not a new item) */
  var left = before.slice(), pairs = [];
  after.forEach(function (x) {
    var i = -1;
    for (var j = 0; j < left.length; j++) if (key(left[j]) === key(x)) { i = j; break; }
    if (i < 0) for (var k = 0; k < left.length; k++) if (left[k].name === x.name && (kind !== 'unit' || left[k].buildingId === x.buildingId)) { i = k; break; }
    pairs.push([i >= 0 ? left.splice(i, 1)[0] : null, x]);
  });
  pairs.forEach(function (p) {
    var a = p[0], b = p[1];
    if (!a) { out.push('New ' + kind + ': ' + b.name + (b.visible ? '' : ' (hidden)')); return; }
    if (a.visible !== b.visible) out.push(b.name + (b.visible ? ' shown' : ' hidden'));
    var changed = fields.filter(function (f) { return !same(a[f[0]], b[f[0]]); }).map(function (f) { return f[1]; });
    if (changed.length) out.push(b.name + ': ' + listText(changed) + ' changed');
    photoChanges(b.name, a.photos, b.photos, out);
  });
  left.forEach(function (a) { out.push(a.name + ' removed'); });
  var order = function (list) { return list.map(key).join('|'); };
  var keptBefore = before.filter(function (a) { return pairs.some(function (p) { return p[0] === a; }); });
  var keptAfter = pairs.filter(function (p) { return p[0]; });
  if (order(keptBefore) !== keptAfter.map(function (p) { return key(p[0]); }).join('|')) out.push((kind === 'unit' ? 'Units' : 'Buildings') + ' in a new order');
}
/* the changes from the published copy (before, or null) to the draft (after), both as check() returns them */
function diff(before, after) {
  var out = [];
  after = after || { buildings: [], suites: [] };
  if (!before) {
    var nb = after.buildings.filter(function (b) { return b.visible; }).length, ns = after.suites.filter(function (s) { return s.visible; }).length;
    out.push('First publish: ' + plural(nb, 'building') + ' and ' + plural(ns, 'unit') + ' on the site');
    return out;
  }
  itemChanges('building', before.buildings || [], after.buildings || [], BUILDING_FIELDS, out);
  itemChanges('unit', before.suites || [], after.suites || [], SUITE_FIELDS, out);
  return out;
}

/* ---------- pages ---------- */

var MAX_PATHS = 50;
/* every page the site shows for this content: home, each city, building and unit shown, the view finder, the sitemap */
function pagePaths(content) {
  var out = ['/', '/sitemap.xml', '/views/'], add = function (p) { if (out.indexOf(p) < 0) out.push(p); };
  if (!isObj(content)) return out;
  var shown = (content.buildings || []).filter(function (b) { return b && b.visible !== false && b.cityId && b.id; });
  shown.forEach(function (b) { add('/' + b.cityId + '/'); });
  shown.forEach(function (b) { add('/' + b.cityId + '/' + b.id + '/'); });
  (content.suites || []).forEach(function (s) {
    var b = shown.filter(function (x) { return s && x.id === s.buildingId; })[0];
    if (b && s.visible !== false && s.id) add('/' + b.cityId + '/' + b.id + '/' + s.id + '/');
  });
  return out.slice(0, MAX_PATHS);
}

/* ---------- photos ---------- */

/* the stored sizes of a new photo w x h: each width in WIDTHS up to the photo's own width, 640 always (a smaller photo
   keeps its size there: never upscaled). [{width: the file's name width, w, h: its pixels}] */
function planWidths(w, h) {
  w = Math.max(1, Math.round(Number(w) || 0)); h = Math.max(1, Math.round(Number(h) || 0));
  return WIDTHS.filter(function (W, i) { return i === 0 || W <= w; }).map(function (W) {
    var ww = Math.min(W, w);
    return { width: W, w: ww, h: Math.max(1, Math.round(h * ww / w)) };
  });
}
/* the file to show for a wanted width: the smallest stored width that covers it, else the largest */
function photoSrc(p, want, siteUrl) {
  if (!p || !Array.isArray(p.widths) || !p.widths.length) return '';
  var ws = p.widths.slice().sort(function (a, b) { return a - b; }), W = ws[ws.length - 1];
  for (var i = 0; i < ws.length; i++) if (ws[i] >= (want || 0)) { W = ws[i]; break; }
  if (p.kind === 'builtin') return String(siteUrl || '').replace(/\/+$/, '') + '/photos/' + p.key + '-' + W + '.jpg';
  if (p.kind === 'upload') return p.base + '-' + W + '.jpg';
  return '';
}

/* ---------- small helpers ---------- */

function slugify(text) {
  var s = String(text == null ? '' : text);
  if (s.normalize) s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.toLowerCase().replace(/&/g, ' and ').replace(/@/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > MAX.slug) s = s.slice(0, MAX.slug).replace(/-[^-]*$/, '') || s.slice(0, MAX.slug);
  return s.replace(/-+$/, '');
}
/* base, else base-2, base-3 ... not in taken (an array or a function(slug) -> true when used) */
function uniqueSlug(base, taken) {
  base = slugify(base) || 'unit';
  var used = typeof taken === 'function' ? taken : function (s) { return (taken || []).indexOf(s) >= 0; };
  if (!used(base)) return base;
  for (var n = 2; n < 1000; n++) {
    var tail = '-' + n, s = base.slice(0, MAX.slug - tail.length).replace(/-+$/, '') + tail;
    if (!used(s)) return s;
  }
  return base;
}
/* "bedroom_with-city-view.jpg" -> "Bedroom with city view"; camera names ("IMG_2034.HEIC") give '' */
function readableAlt(fileName) {
  var s = String(fileName || '').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{2,5}$/i, '');
  s = s.replace(/[_\-.+]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\d{1,3}\s+(?=\D)/, ''); /* a leading "02 " order number */
  if (!/[a-z]{3,}/i.test(s.replace(/\b(img|dsc|dscn|dcim|pxl|photo|image|screenshot|whatsapp|edited|copy)\b/ig, ''))) return '';
  s = s.slice(0, MAX.alt).trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/* stable JSON (sorted keys), the same as the page's O.sync.canon */
function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).filter(function (k) { return v[k] !== undefined && typeof v[k] !== 'function'; }).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
}
/* FNV-1a over UTF-16 code units, as 8 hex digits: the page and the server compare a draft with it */
function hash(text) {
  var h = 0x811c9dc5, s = String(text);
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul ? Math.imul(h, 0x01000193) : (h * 0x01000193) | 0; }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}
function empty() { return { version: VERSION, buildings: [], suites: [] }; }

var API = {
  VERSION: VERSION, WIDTHS: WIDTHS, VIEWS: VIEWS, VIEW_NAMES: VIEW_NAMES, MAX: MAX, MAX_PATHS: MAX_PATHS, SLUG: SLUG, PHOTO_ID: PHOTO_ID,
  check: check, diff: diff, pagePaths: pagePaths, planWidths: planWidths, photoSrc: photoSrc,
  slugify: slugify, uniqueSlug: uniqueSlug, readableAlt: readableAlt, canon: canon, hash: hash, empty: empty, hasOwn: hasOwn
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
