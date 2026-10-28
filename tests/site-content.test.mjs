/* Website content rules (api/_lib/shared/sitecontent.cjs), the same module the Live website page uses as O.sitecontent:
 * the validator (strict for Publish, forgiving for the public read), what changed, the site's pages, photo sizes.
 *   node --test tests/site-content.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import C from '../api/_lib/shared/sitecontent.cjs';
import { koziContent } from './site-content.fixture.mjs';

const PREFIX = 'https://wecjkggbczzmlpvokeql.supabase.co/storage/v1/object/public/site-photos/11111111-2222-4333-8444-555555555555/';
const strict = (c, o = {}) => C.check(c, Object.assign({ strict: true, uploadPrefixes: [PREFIX], bookTypes: ['standard', 'boutique', 'premium'] }, o));
const upload = (id, alt = 'The view at night') => ({ id, kind: 'upload', base: PREFIX + id, widths: [640, 1280], w: 1280, h: 853, alt });

test('Kozi content passes as it is, in its own order, with a warning for the Standard suite without photos', () => {
  const r = strict(koziContent());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.content.suites.map((s) => s.id), ['standard', 'boutique', 'premium']);
  assert.deepEqual(r.warnings, ['Standard Suite is shown on the site but has no photos yet.']);
  assert.equal(r.content.version, 1);
  // a second check of the cleaned content changes nothing
  assert.equal(C.canon(strict(r.content).content), C.canon(r.content));
});

test('unknown fields are dropped and text is tidied', () => {
  const c = koziContent();
  c.extra = 1; c.suites[1].secret = 'x'; c.suites[1].name = '  Boutique   Suite '; c.suites[1].story = 'Line one.  \r\n\r\n\r\n\r\nLine two.';
  c.suites[1].highlights = ['Study', ' Study ', '', 'Twin Towers view'];
  c.suites[1].views = ['petronas', 'moon', 'petronas'];
  const r = strict(c);
  assert.deepEqual(r.errors, []);
  const s = r.content.suites[1];
  assert.equal(s.secret, undefined);
  assert.equal(r.content.extra, undefined);
  assert.equal(s.name, 'Boutique Suite');
  assert.equal(s.story, 'Line one.\n\nLine two.');
  assert.deepEqual(s.highlights, ['Study', 'Twin Towers view']);
  assert.deepEqual(s.views, ['petronas']);
});

test('publish refuses problems with the unit and the field named', () => {
  const c = koziContent();
  c.suites[1].buildingId = 'nowhere';
  c.suites[2].id = 'standard';
  c.suites.push(Object.assign({}, c.suites[0], { id: 'Bad Slug', name: 'Deluxe Suite' }));
  c.buildings[0].photos[0].alt = '  ';
  const r = strict(c);
  assert.ok(r.errors.some((e) => /^Boutique Suite: choose the building/.test(e)), r.errors.join('\n'));
  assert.ok(r.errors.includes('Premium Suite: the web address "standard" is already used by Standard Suite in Kozi @ Vortex KLCC.'), r.errors.join('\n'));
  assert.ok(r.errors.some((e) => /^Deluxe Suite: the web address "Bad Slug" can only use small letters/.test(e)));
  assert.ok(r.errors.includes('Kozi @ Vortex KLCC, photo 1: add a short description of the photo (alt text).'));
  const p = r.problems.find((x) => x.field === 'alt');
  assert.equal(p.where, 'Kozi @ Vortex KLCC, photo 1');
});

test('an upload outside this workspace folder is refused at publish and dropped when read', () => {
  const c = koziContent();
  c.suites[1].photos.push(upload('p1abc-0001'), { id: 'p1abc-0002', kind: 'upload', base: 'https://evil.example.com/site-photos/p1abc-0002', widths: [640], w: 640, h: 480, alt: 'x' });
  c.suites[1].photos.push({ id: 'p1abc-0003', kind: 'upload', base: PREFIX.replace('11111111', '99999999') + 'p1abc-0003', widths: [640], w: 640, h: 480, alt: 'Another workspace' });
  const r = strict(c);
  assert.deepEqual(r.errors, [
    "Boutique Suite, photo 5 is stored outside this workspace's photo folder. Remove it and add it again.",
    "Boutique Suite, photo 6 is stored outside this workspace's photo folder. Remove it and add it again."
  ]);
  const soft = C.check(c, { uploadPrefixes: [PREFIX] });
  assert.deepEqual(soft.errors, []);
  assert.deepEqual(soft.content.suites[1].photos.map((p) => p.id), ['b-boutique-02-dining-and-living', 'b-boutique-10-klcc-night-view', 'b-boutique-01-living-room', 'p1abc-0001']);
  // a base with a path below the folder is not a photo of this workspace either
  const deep = koziContent(); deep.suites[0].photos = [Object.assign(upload('p1abc-0004'), { base: PREFIX + 'x/p1abc-0004' })];
  assert.equal(strict(deep).errors.length, 1);
});

test('photo sizes, ids, kinds and bundled keys', () => {
  const c = koziContent();
  c.suites[2].photos = [
    Object.assign(upload('p1abc-0010'), { widths: [2400, 640, 999] }),
    Object.assign(upload('p1abc-0011'), { widths: [] }),
    Object.assign(upload('p1abc-0012'), { w: 0 }),
    Object.assign(upload('P_BAD')),
    { id: 'p1abc-0013', kind: 'builtin', key: '../secrets', widths: [640], w: 10, h: 10, alt: 'x' },
    { id: 'p1abc-0014', kind: 'link', widths: [640], w: 10, h: 10, alt: 'x' },
    upload('p1abc-0010')
  ];
  const r = strict(c);
  assert.deepEqual(r.errors, [
    'Premium Suite, photo 2 has no stored sizes. Remove it and add it again.',
    'Premium Suite, photo 3 has no valid size. Remove it and add it again.',
    'Premium Suite, photo 4 has no valid id. Remove it and add it again.',
    'Premium Suite, photo 5 points to a bundled photo that does not exist. Remove it.',
    'Premium Suite, photo 6 is not a bundled or an uploaded photo. Remove it.',
    'Premium Suite, photo 7 is in the list twice.'
  ]);
  const soft = C.check(c, { uploadPrefixes: [PREFIX] });
  assert.deepEqual(soft.content.suites[2].photos.map((p) => [p.id, p.widths]), [['p1abc-0010', [640, 2400]]]);
  // at most 40 photos
  const many = koziContent();
  many.suites[1].photos = Array.from({ length: 42 }, (_, i) => upload('p1abc-' + String(1000 + i)));
  assert.deepEqual(strict(many).errors, ['Boutique Suite has more than 40 photos. Remove some.']);
  assert.equal(C.check(many, {}).content.suites[1].photos.length, 40);
});

test('limits: text lengths, highlights, numbers, booking types', () => {
  const c = koziContent();
  const s = c.suites[1];
  s.line = 'x'.repeat(201); s.highlights = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']; s.bedrooms = 2.5; s.sleeps = 21; s.bookType = 'deluxe';
  s.seoTitle = 'y'.repeat(71);
  const r = strict(c);
  assert.deepEqual(r.errors, [
    'Boutique Suite: the one-line pitch is too long (at most 200 characters).',
    'Boutique Suite has 9 highlights. Keep at most 8.',
    'Boutique Suite: bedrooms should be a whole number from 0 to 20.',
    'Boutique Suite: sleeps should be a whole number from 0 to 20.',
    'Boutique Suite: "Book online as" points to a room type that is not set up for online booking. Choose another one, or "Not bookable online yet".',
    'Boutique Suite: the search title is too long (at most 70 characters).'
  ]);
  const soft = C.check(c, { bookTypes: ['boutique'] }).content.suites[1];
  assert.equal(soft.line.length, 200);
  assert.equal(soft.highlights.length, 8);
  assert.equal(soft.bedrooms, 3);
  assert.equal(soft.sleeps, 20);
  assert.equal(soft.bookType, null);
  assert.equal(soft.seoTitle.length, 70);
  // null = not bookable online yet; without bookTypes any well-formed key passes
  c.suites[1].bookType = null;
  assert.equal(C.check(koziContent(), {}).content.suites[1].bookType, 'boutique');
});

test('buildings: required fields, unique web addresses, one name per city', () => {
  const c = koziContent();
  c.buildings.push(Object.assign({}, c.buildings[0], { name: 'Kozi @ Somewhere', photos: [] }));
  c.buildings.push(Object.assign({}, c.buildings[0], { id: 'kozi-penang', name: 'Kozi Penang', city: 'KL', photos: [] }));
  c.buildings.push(Object.assign({}, c.buildings[0], { id: 'kozi-ipoh', name: '', cityId: 'ipoh', city: 'Ipoh', photos: [] }));
  const r = strict(c);
  assert.deepEqual(r.errors, [
    'Kozi @ Somewhere: the web address "vortex-klcc" is already used by Kozi @ Vortex KLCC.',
    'Building 4: add the name.',
    'Kozi Penang: the city "KL" has the same web address as "Kuala Lumpur". Use the same city name, or another web address.'
  ]);
  // forgiving: the duplicate and the nameless building are dropped
  assert.deepEqual(C.check(c, {}).content.buildings.map((b) => b.id), ['vortex-klcc', 'kozi-penang']);
});

test("a city's web address cannot be one of the site's own pages", () => {
  for (const word of ['guides', 'book', 'booking', 'contact', 'credits', 'views', 'stays', 'api', 'photos', 'city', 'sitemap', 'robots', '404', 'content']) {
    assert.ok(C.RESERVED.includes(word), word + ' is reserved');
  }
  const c = koziContent();
  c.buildings.push(Object.assign({}, c.buildings[0], { id: 'kozi-guide', name: 'Kozi Guide House', cityId: 'guides', city: 'Guides', photos: [] }));
  c.suites.push(Object.assign({}, c.suites[1], { buildingId: 'kozi-guide', photos: [] }));
  const r = strict(c);
  assert.deepEqual(r.errors.filter((e) => /used by the website itself/.test(e)), [
    'Kozi Guide House: the city\'s web address "guides" is used by the website itself. Use the city\'s name, for example kuala-lumpur.'
  ]);
  assert.deepEqual(r.problems.filter((p) => p.field === 'cityId').map((p) => p.where), ['Kozi Guide House']);
  // forgiving (the public read): the building is dropped, so no page is made at /guides/<building>/
  const loose = C.check(c, {}).content;
  assert.deepEqual(loose.buildings.map((b) => b.id), ['vortex-klcc']);
  assert.ok(!C.pagePaths(loose).some((p) => p.startsWith('/guides/')));
  // a city that only starts with a reserved word is fine
  const ok = koziContent(); ok.buildings[0].cityId = 'book-street'; ok.buildings[0].city = 'Book Street';
  assert.deepEqual(strict(ok).errors, []);
});

test('warnings: shown units without photos, shown units in hidden buildings, buildings with nothing shown', () => {
  const c = koziContent();
  c.buildings[0].visible = false;
  c.suites[0].visible = false;
  const r = strict(c);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, [
    'Boutique Suite is shown, but its building Kozi @ Vortex KLCC is hidden, so guests will not see it.',
    'Premium Suite is shown, but its building Kozi @ Vortex KLCC is hidden, so guests will not see it.'
  ]);
  const d = koziContent(); d.suites.forEach((s) => { s.visible = false; });
  assert.deepEqual(strict(d).warnings, ['Kozi @ Vortex KLCC is shown on the site but has no units shown.']);
});

test('nothing, garbage and newer versions', () => {
  assert.deepEqual(strict(null).errors, ['There is nothing to publish yet. Add a building and a unit first.']);
  assert.deepEqual(C.check(null).content, { version: 1, buildings: [], suites: [] });
  assert.deepEqual(strict({ version: 2, buildings: [], suites: [] }).errors, ['This content was saved by a newer version of Orbique. Reload the page and try again.']);
  const junk = C.check({ buildings: [1, 'x', null, { id: 'ok-1', cityId: 'kl', city: 'KL', name: 'OK' }], suites: 'nope' });
  assert.deepEqual(junk.content.buildings.map((b) => b.id), ['ok-1']);
  assert.deepEqual(junk.content.suites, []);
  assert.equal(junk.content.buildings[0].visible, true);
});

test('diff says what Publish changes in plain words', () => {
  const before = strict(koziContent()).content;
  assert.deepEqual(C.diff(null, before), ['First publish: 1 building and 3 units on the site']);
  const c = koziContent();
  c.suites[1].photos.push(upload('p1abc-0100'), upload('p1abc-0101'));
  c.suites[0].visible = false;
  c.suites[2].story = 'New story.'; c.suites[2].highlights = ['Landmark views'];
  c.suites[2].photos.reverse();
  c.suites.push({ id: 'deluxe', buildingId: 'vortex-klcc', name: 'Deluxe Suite', photos: [], visible: false });
  const after = strict(c).content;
  assert.deepEqual(C.diff(before, after), [
    'Standard Suite hidden',
    '2 photos added to Boutique Suite',
    'Premium Suite: story and highlights changed',
    'New cover photo for Premium Suite',
    'New unit: Deluxe Suite (hidden)'
  ]);
  // order, removal, alt text and a renamed web address
  const d = strict(koziContent()).content;
  d.suites = [d.suites[1], d.suites[0]];
  d.suites[0].photos[2].alt = 'The living room';
  d.suites[1].id = 'standard-suite';
  d.buildings[0].intro = 'Changed.';
  assert.deepEqual(C.diff(before, d), [
    'Kozi @ Vortex KLCC: introduction changed',
    '1 photo description changed in Boutique Suite',
    'Standard Suite: web address changed',
    'Premium Suite removed',
    'Units in a new order'
  ]);
  assert.deepEqual(C.diff(before, strict(koziContent()).content), []);
});

test('the site pages for this content, hidden ones left out, at most 50', () => {
  const c = strict(koziContent()).content;
  assert.deepEqual(C.pagePaths(c), ['/', '/sitemap.xml', '/views/', '/kuala-lumpur/', '/kuala-lumpur/vortex-klcc/',
    '/kuala-lumpur/vortex-klcc/standard/', '/kuala-lumpur/vortex-klcc/boutique/', '/kuala-lumpur/vortex-klcc/premium/']);
  c.suites[0].visible = false;
  assert.ok(!C.pagePaths(c).includes('/kuala-lumpur/vortex-klcc/standard/'));
  c.buildings[0].visible = false;
  assert.deepEqual(C.pagePaths(c), ['/', '/sitemap.xml', '/views/']);
  const big = koziContent();
  for (let i = 0; i < 60; i++) big.suites.push(Object.assign({}, big.suites[1], { id: 'unit-' + i, name: 'Unit ' + i }));
  assert.equal(C.pagePaths(strict(big).content).length, 50);
  assert.deepEqual(C.pagePaths(null), ['/', '/sitemap.xml', '/views/']);
});

test('photo sizes: 640 always, never upscaled, height kept in proportion', () => {
  assert.deepEqual(C.planWidths(4032, 3024), [{ width: 640, w: 640, h: 480 }, { width: 1280, w: 1280, h: 960 }, { width: 2400, w: 2400, h: 1800 }]);
  assert.deepEqual(C.planWidths(1600, 1200), [{ width: 640, w: 640, h: 480 }, { width: 1280, w: 1280, h: 960 }]);
  assert.deepEqual(C.planWidths(500, 1000), [{ width: 640, w: 500, h: 1000 }]);
  assert.deepEqual(C.planWidths(2400, 1600).map((x) => x.width), [640, 1280, 2400]);
  const ph = upload('p1abc-0200');
  assert.equal(C.photoSrc(ph, 900), PREFIX + 'p1abc-0200-1280.jpg');
  assert.equal(C.photoSrc(ph, 3000), PREFIX + 'p1abc-0200-1280.jpg');
  assert.equal(C.photoSrc({ kind: 'builtin', key: 'boutique/01-living-room', widths: [640, 1280, 2400] }, 640, 'https://www.staykozi.my/'), 'https://www.staykozi.my/photos/boutique/01-living-room-640.jpg');
});

test('helpers: web addresses, readable alt text, canon and hash', () => {
  assert.equal(C.slugify('Kozi @ Vortex KLCC'), 'kozi-vortex-klcc');
  assert.equal(C.slugify('Café & Bar Suite!'), 'cafe-and-bar-suite');
  assert.equal(C.slugify('   '), '');
  assert.ok(C.slugify('a'.repeat(30) + ' ' + 'b'.repeat(40)).length <= 60);
  assert.equal(C.uniqueSlug('Boutique Suite', ['boutique-suite', 'boutique-suite-2']), 'boutique-suite-3');
  assert.equal(C.uniqueSlug('', []), 'unit');
  assert.equal(C.uniqueSlug('Premium', (s) => s === 'premium'), 'premium-2');
  assert.equal(C.readableAlt('02-bedroom_with-city-view.jpg'), 'Bedroom with city view');
  assert.equal(C.readableAlt('IMG_2034.HEIC'), '');
  assert.equal(C.readableAlt('PXL_20251012_101010.jpg'), '');
  assert.equal(C.readableAlt('C:\\fakepath\\living room.webp'), 'Living room');
  assert.equal(C.canon({ b: 1, a: [1, { d: 2, c: undefined }] }), '{"a":[1,{"d":2}],"b":1}');
  assert.equal(C.hash('abc'), C.hash('abc'));
  assert.notEqual(C.hash('abc'), C.hash('abd'));
  assert.match(C.hash(''), /^[0-9a-f]{8}$/);
});
