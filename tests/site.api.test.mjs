/* The website content server (api/_lib/site.js, api/site.js, GET /api/public/site) against an in-memory database,
 * a stand-in for Supabase Storage and a stand-in for the live site: who may edit and publish, signed upload URLs and the
 * bucket, Publish (checks, the live copy, the rate limit, a draft still saving) and the page refresh, the public read.
 *   node --test tests/site.api.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { websiteAllowed, requireWebsite, uploadUrls, publish, refreshSite, publicContent, uploadPrefix, ensureBucket, _resetBucketCache, PUBLISH_PER_HOUR } from '../api/_lib/site.js';
import siteHandler from '../api/site.js';
import publicHandler from '../api/public.js';
import C from '../api/_lib/shared/sitecontent.cjs';
import { koziContent } from './site-content.fixture.mjs';

const ORG = '11111111-2222-4333-8444-555555555555';
const ENV = { SUPABASE_URL: 'https://wecjkggbczzmlpvokeql.supabase.co', SITE_REVALIDATE_TOKEN: 'test-bypass-token-0123456789' };
const PREFIX = uploadPrefix(ORG, ENV);
const OWNER = { id: 'u-owner', email: 'arnob@example.com', user_metadata: { name: 'Arnob Mridha' } };

/* ---------- a tiny PostgREST-like store and a Storage stand-in ---------- */
function getPath(row, col) {
  const parts = col.split(/->>?/);
  let v = row[parts[0]];
  for (const k of parts.slice(1)) v = v && typeof v === 'object' ? v[k] : undefined;
  return v;
}
function fakeSb(tables, storage = {}) {
  const sb = { tables, calls: [] };
  sb.from = (name) => {
    const t = tables[name] || (tables[name] = []);
    const st = { filters: [], mode: 'select', single: false, limit: null };
    const q = {
      select() { return q; },
      eq(c, v) { st.filters.push((r) => String(getPath(r, c)) === String(v)); return q; },
      limit(n) { st.limit = n; return q; },
      maybeSingle() { st.single = true; return q; },
      upsert(rows, o) { st.mode = 'upsert'; st.rows = [].concat(rows); st.on = (o && o.onConflict ? o.onConflict : 'id').split(','); return q; },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); }
    };
    function run() {
      sb.calls.push([name, st.mode]);
      if (st.mode === 'upsert') {
        for (const r of st.rows) {
          const i = t.findIndex((x) => st.on.every((k) => String(x[k]) === String(r[k])));
          const copy = JSON.parse(JSON.stringify(r));
          if (i >= 0) t[i] = Object.assign({}, t[i], copy); else t.push(copy);
        }
        return { data: null, error: null };
      }
      let rows = t.filter((r) => st.filters.every((f) => f(r))).map((r) => JSON.parse(JSON.stringify(r)));
      if (st.limit !== null) rows = rows.slice(0, st.limit);
      return { data: st.single ? rows[0] || null : rows, error: null };
    }
    return q;
  };
  const buckets = storage.buckets || {};
  sb.storage = {
    buckets, signed: [],
    async getBucket(id) { return buckets[id] ? { data: buckets[id], error: null } : { data: null, error: { message: 'Bucket not found' } }; },
    async createBucket(id, o) { if (storage.createFails) return { data: null, error: { message: 'boom' } }; buckets[id] = Object.assign({ id }, o); return { data: { name: id }, error: null }; },
    from(bucket) {
      return {
        async createSignedUploadUrl(path, o) {
          sb.storage.signed.push({ bucket, path, upsert: !!(o && o.upsert) });
          if (storage.signFails) return { data: null, error: { message: 'nope' } };
          return { data: { signedUrl: `${ENV.SUPABASE_URL}/storage/v1/object/upload/sign/${bucket}/${path}?token=t-${path}`, token: 't-' + path, path }, error: null };
        }
      };
    }
  };
  return sb;
}
const blobRow = (key, v) => ({ org_id: ORG, key, data: { v } });
function world(over = {}) {
  return {
    orgs: [{ id: ORG, name: 'Kozi', status: over.orgStatus || 'active' }],
    members: [
      { org_id: ORG, user_id: 'u-owner', staff_id: 'u1', role: 'owner', status: 'active' },
      { org_id: ORG, user_id: 'u-ops', staff_id: 's2', role: 'ops', status: 'active' },
      { org_id: ORG, user_id: 'u-front', staff_id: 's3', role: 'frontdesk', status: 'active' },
      { org_id: ORG, user_id: 'u-gone', staff_id: 's9', role: 'ops', status: 'suspended' }
    ],
    records: [{ org_id: ORG, coll: 'staff', id: 'u1', data: { id: 'u1', name: 'Arnob Mridha', role: 'owner' } }],
    blobs: [
      blobRow('website', { slug: 'kozi', siteUrl: 'https://www.staykozi.my', types: { standard: { name: 'Standard' }, boutique: { name: 'Boutique' }, premium: { name: 'Premium' } } }),
      blobRow('siteContent', over.draft !== undefined ? over.draft : koziContent())
    ].concat(over.blobs || [])
  };
}
const liveOf = (sb) => { const r = sb.tables.blobs.find((b) => b.key === 'siteContentLive'); return r ? r.data.v : null; };
function fakeSite(status = {}) {
  const hits = [];
  const f = async (url, init) => {
    hits.push({ url, token: init.headers['x-prerender-revalidate'] });
    const path = new URL(url).pathname;
    if (status[path] === 'hang') return new Promise((res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    if (status[path] === 'throw') throw new Error('network');
    return { status: status[path] || 200, body: null };
  };
  f.hits = hits;
  return f;
}

/* ---------- who may edit and publish ---------- */
test('websiteAllowed follows Staff Access: owners, the ops default, saved roles and personal overrides', () => {
  const can = (ctx, a) => websiteAllowed(Object.assign({ staffId: 's1', rolePerms: null, staffMeta: null }, ctx), a);
  assert.equal(can({ role: 'owner' }, 'publish'), true);
  assert.equal(can({ role: 'owner', staffMeta: { s1: { status: 'suspended' } } }, 'edit'), false);
  assert.equal(can({ role: 'ops' }, 'edit'), true);
  assert.equal(can({ role: 'ops' }, 'publish'), true);
  assert.equal(can({ role: 'frontdesk' }, 'edit'), false);
  assert.equal(can({ role: 'accountant' }, 'publish'), false);
  // saved permissions: a role without the website section keeps the default; one that has it uses it
  assert.equal(can({ role: 'ops', rolePerms: { ops: { sections: { dashboard: 'edit' }, actions: {} } } }, 'publish'), true);
  assert.equal(can({ role: 'ops', rolePerms: { ops: { sections: { website: 'view' }, actions: { 'website.edit': true } } } }, 'edit'), false);
  assert.equal(can({ role: 'ops', rolePerms: { ops: { sections: { website: 'edit' }, actions: { 'website.edit': true, 'website.publish': false } } } }, 'publish'), false);
  assert.equal(can({ role: 'accountant', rolePerms: { accountant: { sections: { website: 'edit' }, actions: { 'website.edit': true } } } }, 'edit'), true);
  assert.equal(can({ role: 'accountant', rolePerms: { ops: {} } }, 'edit'), false);
  // personal overrides win
  assert.equal(can({ role: 'ops', staffMeta: { s1: { overrides: { 'website.publish': false } } } }, 'publish'), false);
  assert.equal(can({ role: 'ops', staffMeta: { s1: { overrides: { 'section:website': 'view' } } } }, 'edit'), false);
  assert.equal(can({ role: 'frontdesk', staffMeta: { s1: { overrides: { 'section:website': 'edit', 'website.edit': true } } } }, 'edit'), true);
  assert.equal(can({ role: 'ops' }, 'delete'), false);
});

test('requireWebsite reads the membership, the workspace and the saved permissions', async () => {
  const sb = fakeSb(world({ blobs: [blobRow('staffMeta', { s2: { overrides: { 'website.publish': false } } })] }));
  assert.equal((await requireWebsite(sb, ORG, 'u-owner', 'publish')).role, 'owner');
  assert.equal((await requireWebsite(sb, ORG, 'u-ops', 'edit')).role, 'ops');
  await assert.rejects(requireWebsite(sb, ORG, 'u-ops', 'publish'), { status: 403, message: 'Your access does not include publishing the website.' });
  await assert.rejects(requireWebsite(sb, ORG, 'u-front', 'edit'), { status: 403, message: 'Your access does not include editing the website.' });
  await assert.rejects(requireWebsite(sb, ORG, 'u-gone', 'edit'), { status: 403 });
  await assert.rejects(requireWebsite(sb, ORG, 'u-stranger', 'edit'), { status: 403 });
  const paused = fakeSb(world({ orgStatus: 'paused' }));
  await assert.rejects(requireWebsite(paused, ORG, 'u-owner', 'edit'), { status: 403, message: 'This workspace is paused, so the website cannot be changed right now.' });
});

/* ---------- photos ---------- */
test('upload-urls makes the public bucket once and signs every size of every new photo', async () => {
  _resetBucketCache();
  const sb = fakeSb(world());
  const r = await uploadUrls(sb, ORG, { count: 2, widths: [1280, 640] }, ENV);
  assert.deepEqual(sb.storage.buckets['site-photos'], { id: 'site-photos', public: true, allowedMimeTypes: ['image/jpeg'], fileSizeLimit: 3 * 1024 * 1024 });
  assert.equal(r.photos.length, 2);
  assert.equal(r.maxBytes, 3 * 1024 * 1024);
  for (const p of r.photos) {
    assert.match(p.id, C.PHOTO_ID);
    assert.equal(p.base, PREFIX + p.id);
    assert.deepEqual(p.widths, [640, 1280]);
    assert.deepEqual(p.uploads.map((u) => [u.width, u.path]), [[640, `${ORG}/${p.id}-640.jpg`], [1280, `${ORG}/${p.id}-1280.jpg`]]);
    assert.ok(p.uploads.every((u) => u.signedUrl.startsWith(ENV.SUPABASE_URL + '/storage/v1/object/upload/sign/site-photos/') && u.token));
    // what a later publish accepts
    const ph = { id: p.id, kind: 'upload', base: p.base, widths: p.widths, w: 1280, h: 960, alt: 'Living room' };
    assert.equal(C.check({ buildings: [{ id: 'b-1', cityId: 'kl', city: 'KL', name: 'B', photos: [ph] }] }, { strict: true, uploadPrefixes: [PREFIX] }).errors.length, 0);
  }
  assert.notEqual(r.photos[0].id, r.photos[1].id);
  assert.ok(sb.storage.signed.every((s) => s.bucket === 'site-photos' && s.upsert));
  // the bucket is not made again
  sb.storage.buckets['site-photos'] = undefined; delete sb.storage.buckets['site-photos'];
  await uploadUrls(sb, ORG, { count: 1, widths: [640] }, ENV);
  assert.equal(sb.storage.buckets['site-photos'], undefined);
});

test('upload-urls refuses bad counts and sizes, and a storage failure is a plain message', async () => {
  _resetBucketCache();
  const sb = fakeSb(world());
  await assert.rejects(uploadUrls(sb, ORG, { count: 0, widths: [640] }, ENV), { message: 'Add between 1 and 30 photos at a time.' });
  await assert.rejects(uploadUrls(sb, ORG, { count: 31, widths: [640] }, ENV), { status: 400 });
  await assert.rejects(uploadUrls(sb, ORG, { count: 1, widths: [1280] }, ENV), { code: 'bad-widths' });
  await assert.rejects(uploadUrls(sb, ORG, { count: 1, widths: [640, 800] }, ENV), { code: 'bad-widths' });
  await assert.rejects(ensureBucket(fakeSb(world(), { createFails: true })), { status: 500, message: 'Photo storage could not be set up. Please try again in a minute.' });
  _resetBucketCache();
  await assert.rejects(uploadUrls(fakeSb(world(), { signFails: true, buckets: { 'site-photos': {} } }), ORG, { count: 1, widths: [640] }, ENV), { status: 500, message: 'The photo upload could not start. Please try again in a minute.' });
});

/* ---------- publish ---------- */
test('publish writes the checked draft as the live copy and refreshes every page', async () => {
  const sb = fakeSb(world());
  const site = fakeSite();
  const m = { staff_id: 'u1' };
  const r = await publish(sb, ORG, OWNER, m, { env: ENV, fetch: site, now: '2026-10-28T07:30:00Z' });
  assert.equal(r.publishedAt, '2026-10-28T07:30:00.000Z');
  assert.equal(r.publishedBy, 'Arnob Mridha');
  assert.equal(r.refreshed, 8);
  assert.deepEqual(r.failed, []);
  assert.equal(r.note, null);
  assert.deepEqual(r.warnings, ['Standard Suite is shown on the site but has no photos yet.']);
  const live = liveOf(sb);
  assert.deepEqual(live.content, C.check(koziContent(), { strict: true }).content);
  assert.deepEqual(live.history, ['2026-10-28T07:30:00.000Z']);
  assert.equal(sb.tables.blobs.find((b) => b.key === 'siteContentLive').updated_by, 'u-owner');
  assert.deepEqual(site.hits.map((h) => h.url).sort(), ['/', '/kuala-lumpur/', '/kuala-lumpur/vortex-klcc/', '/kuala-lumpur/vortex-klcc/boutique/',
    '/kuala-lumpur/vortex-klcc/premium/', '/kuala-lumpur/vortex-klcc/standard/', '/sitemap.xml', '/views/'].map((p) => 'https://www.staykozi.my' + p).sort());
  assert.ok(site.hits.every((h) => h.token === ENV.SITE_REVALIDATE_TOKEN));
});

test('publish refreshes pages that are gone too, and counts a 404 there as done', async () => {
  const before = C.check(koziContent(), { strict: true }).content;
  const draft = koziContent(); draft.suites[2].visible = false;
  const sb = fakeSb(world({ draft, blobs: [blobRow('siteContentLive', { content: before, publishedAt: '2026-10-28T06:00:00.000Z', publishedBy: 'Arnob Mridha', history: ['2026-10-28T06:00:00.000Z'] })] }));
  const site = fakeSite({ '/kuala-lumpur/vortex-klcc/premium/': 404, '/views/': 500 });
  const r = await publish(sb, ORG, OWNER, { staff_id: 'u1' }, { env: ENV, fetch: site, now: '2026-10-28T07:30:00Z' });
  assert.ok(site.hits.some((h) => h.url.endsWith('/premium/')));
  assert.deepEqual(r.failed, ['/views/']);
  assert.equal(r.refreshed, 7);
  assert.match(r.note, /within 5 minutes/);
  assert.deepEqual(liveOf(sb).history, ['2026-10-28T07:30:00.000Z', '2026-10-28T06:00:00.000Z']);
});

test('publish refuses a draft with problems, names them, and leaves the live copy alone', async () => {
  const draft = koziContent(); draft.suites[1].photos[0].alt = ''; draft.suites[2].buildingId = 'gone';
  const sb = fakeSb(world({ draft }));
  const site = fakeSite();
  const err = await publish(sb, ORG, OWNER, { staff_id: 'u1' }, { env: ENV, fetch: site }).then(() => null, (e) => e);
  assert.equal(err.status, 400);
  assert.equal(err.code, 'content-problems');
  assert.match(err.message, /^Boutique Suite, photo 1: add a short description/);
  assert.deepEqual(err.details.problems.map((p) => [p.where, p.field]), [['Boutique Suite, photo 1', 'alt'], ['Premium Suite', 'buildingId']]);
  assert.equal(liveOf(sb), null);
  assert.equal(site.hits.length, 0);
  // a bundled photo is fine, an upload from another workspace is not
  const other = koziContent(); other.suites[0].photos = [{ id: 'p1abc-0001', kind: 'upload', base: uploadPrefix('99999999-2222-4333-8444-555555555555', ENV) + 'p1abc-0001', widths: [640], w: 640, h: 480, alt: 'x' }];
  await assert.rejects(publish(fakeSb(world({ draft: other })), ORG, OWNER, null, { env: ENV, fetch: site }), { code: 'content-problems', message: /outside this workspace's photo folder/ });
  // an unknown booking type
  const typ = koziContent(); typ.suites[0].bookType = 'deluxe';
  await assert.rejects(publish(fakeSb(world({ draft: typ })), ORG, OWNER, null, { env: ENV, fetch: site }), { message: /"Book online as" points to a room type/ });
});

test('publish: nothing to publish, a draft still saving, and at most 20 an hour', async () => {
  await assert.rejects(publish(fakeSb(world({ draft: null })), ORG, OWNER, null, { env: ENV }), { status: 400, message: 'There is nothing to publish yet. Add a building and a unit first.' });
  const sb = fakeSb(world());
  await assert.rejects(publish(sb, ORG, OWNER, null, { env: ENV, draftHash: 'deadbeef' }), { status: 409, code: 'draft-saving' });
  const ok = await publish(sb, ORG, OWNER, null, { env: ENV, fetch: fakeSite(), draftHash: C.hash(C.canon(koziContent())) });
  assert.equal(ok.publishedBy, 'Arnob Mridha'); // from the sign-in name when no staff record is given
  const now = Date.parse('2026-10-28T08:00:00Z');
  const history = Array.from({ length: PUBLISH_PER_HOUR }, (_, i) => new Date(now - (i + 1) * 60000).toISOString());
  const busy = fakeSb(world({ blobs: [blobRow('siteContentLive', { content: null, history })] }));
  await assert.rejects(publish(busy, ORG, OWNER, null, { env: ENV, fetch: fakeSite(), now }), { status: 429, message: /published 20 times in the last hour/ });
  // an hour later it works again
  const r = await publish(busy, ORG, OWNER, null, { env: ENV, fetch: fakeSite(), now: now + 3600 * 1000 });
  assert.equal(liveOf(busy).history.length, 20);
  assert.equal(r.refreshed, 8);
});

test('refreshSite: no token or no address skips with a note; each page has 5 seconds; at most 50 pages', async () => {
  const site = fakeSite();
  assert.deepEqual(await refreshSite({ siteUrl: 'https://www.staykozi.my', paths: ['/'], token: '', fetch: site }),
    { refreshed: 0, failed: [], note: 'Instant refresh is not set up (SITE_REVALIDATE_TOKEN). The site still picks the change up within 5 minutes on its own.' });
  assert.match((await refreshSite({ siteUrl: null, paths: ['/'], token: 't', fetch: site })).note, /address is not set/);
  assert.equal(site.hits.length, 0);
  const slow = fakeSite({ '/slow/': 'hang', '/down/': 'throw' });
  const t0 = Date.now();
  const r = await refreshSite({ siteUrl: 'https://www.staykozi.my/', paths: ['/', '/slow/', '/down/'], token: 't', fetch: slow, timeoutMs: 50 });
  assert.ok(Date.now() - t0 < 2000);
  assert.deepEqual(r.failed.sort(), ['/down/', '/slow/']);
  assert.equal(r.refreshed, 1);
  assert.equal(slow.hits[0].url, 'https://www.staykozi.my/');
  const many = fakeSite();
  await refreshSite({ siteUrl: 'https://www.staykozi.my', paths: Array.from({ length: 70 }, (_, i) => '/p' + i + '/'), token: 't', fetch: many });
  assert.equal(many.hits.length, 50);
});

/* ---------- the public read ---------- */
test('publicContent serves the live copy checked again, or null before the first publish', async () => {
  const sb = fakeSb(world());
  assert.deepEqual(await publicContent(sb, 'kozi', ENV), { content: null, publishedAt: null });
  const live = C.check(koziContent(), { strict: true }).content;
  live.suites[1].photos.push({ id: 'p1abc-0009', kind: 'upload', base: 'https://evil.example.com/x/p1abc-0009', widths: [640], w: 640, h: 480, alt: 'x' });
  live.suites[1].bookType = 'gone';
  sb.tables.blobs.push(blobRow('siteContentLive', { content: live, publishedAt: '2026-10-28T07:30:00.000Z', publishedBy: 'Arnob Mridha' }));
  const r = await publicContent(sb, 'KOZI', ENV);
  assert.equal(r.publishedAt, '2026-10-28T07:30:00.000Z');
  assert.equal(r.content.suites[1].photos.length, 3);
  assert.equal(r.content.suites[1].bookType, null);
  assert.equal(r.content.publishedBy, undefined);
  await assert.rejects(publicContent(sb, 'nobody', ENV), { status: 404 });
  await assert.rejects(publicContent(sb, '../x', ENV), { status: 400 });
  // online booking switched off: the content still shows
  sb.tables.blobs[0].data.v.enabled = false;
  assert.ok((await publicContent(sb, 'kozi', ENV)).content);
  // a paused workspace's site has no content
  sb.tables.orgs[0].status = 'paused';
  await assert.rejects(publicContent(sb, 'kozi', ENV), { status: 404 });
});

/* ---------- the handlers ---------- */
function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = (b) => { res.body = b || ''; res.done = true; };
  return res;
}
const fakeReq = (method, url, body, headers = {}) => ({ method, url, headers, body });

test('POST /api/site: method, unknown action, sign-in and a missing database answer in plain English', async () => {
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  delete process.env.SUPABASE_URL; delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_SECRET_KEY;
  try {
    let res = fakeRes(); await siteHandler(fakeReq('GET', '/api/site'), res);
    assert.equal(res.statusCode, 405);
    res = fakeRes(); await siteHandler(fakeReq('POST', '/api/site', { action: 'delete-everything' }), res);
    assert.deepEqual(JSON.parse(res.body), { ok: false, error: 'bad-action', message: 'Unknown request.' });
    res = fakeRes(); await siteHandler(fakeReq('POST', '/api/site', { action: 'publish', orgId: ORG }), res);
    assert.equal(res.statusCode, 500);
    assert.equal(JSON.parse(res.body).error, 'not-configured');
    res = fakeRes(); await siteHandler(fakeReq('OPTIONS', '/api/site', null, { origin: 'https://localhost' }), res);
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers['access-control-allow-origin'], 'https://localhost');
  } finally {
    if (saved.url) process.env.SUPABASE_URL = saved.url;
    if (saved.key) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
  }
});

test('GET /api/public/site answers any origin, preflight included; other methods are refused', async () => {
  let res = fakeRes();
  await publicHandler(fakeReq('OPTIONS', '/api/public/site?ws=kozi', null, { origin: 'https://someone-else.example' }), res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], '*');
  res = fakeRes();
  await publicHandler(fakeReq('POST', '/api/public?path=site&ws=kozi', '{}', { origin: 'https://www.staykozi.my' }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers['access-control-allow-origin'], '*');
  // without a database it is a plain error, never cached
  const saved = process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_SECRET_KEY;
  try {
    res = fakeRes();
    await publicHandler(fakeReq('GET', '/api/public/site?ws=kozi', undefined, { origin: 'https://www.staykozi.my' }), res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.headers['cache-control'], 'no-store');
  } finally { if (saved) process.env.SUPABASE_SERVICE_ROLE_KEY = saved; }
});
