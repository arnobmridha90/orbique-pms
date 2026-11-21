/* Google Business Profile reviews (api/_lib/google.js, api/_lib/google-reviews.js, migration 0029): sign-in state,
 * review records, the first connect, later syncs with inbox lines, replies, and Google's "not approved yet" answer.
 *
 *   node --test tests/inbox/google-reviews.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { googleConfig, signState, readState, authUrl, SCOPE } from '../../api/_lib/google.js';
import { googleRecord, originalText, recordId, finishConnect, syncGoogle, replyGoogle, syncDue, connView } from '../../api/_lib/google-reviews.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-0000000000aa';
const CFG = googleConfig({ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'secret', APP_URL: 'https://app.example' });
const LOC = 'accounts/111/locations/222';

/* tables as arrays; filters eq / in / not(is null) / or (last_sync_at) / limit; upsert, update, delete */
function fakeDb(init = {}) {
  const T = JSON.parse(JSON.stringify(init));
  const get = (r, k) => (k.startsWith('data->>') ? (r.data || {})[k.slice(7)] : r[k]);
  const keys = { records: ['org_id', 'coll', 'id'], google_connections: ['org_id'], google_tokens: ['org_id'] };
  return {
    T,
    from(name) {
      T[name] = T[name] || [];
      const f = []; let mode = 'select', patch = null, lim = Infinity, single = false;
      const q = {
        select() { return q; },
        eq(k, v) { f.push((r) => get(r, k) === v); return q; },
        in(k, vs) { f.push((r) => vs.includes(get(r, k))); return q; },
        not(k) { f.push((r) => get(r, k) != null); return q; },
        or() { return q; },
        order() { return q; },
        limit(n) { lim = n; return q; },
        maybeSingle() { single = true; return q; },
        update(p) { mode = 'update'; patch = p; return q; },
        delete() { mode = 'delete'; return q; },
        upsert(row) {
          const k = keys[name];
          const i = T[name].findIndex((r) => k.every((x) => r[x] === row[x]));
          if (i >= 0) T[name][i] = Object.assign({}, T[name][i], JSON.parse(JSON.stringify(row))); else T[name].push(JSON.parse(JSON.stringify(row)));
          return Promise.resolve({ data: null, error: null });
        },
        then(res, rej) {
          const hit = T[name].filter((r) => f.every((fn) => fn(r)));
          let data = null;
          if (mode === 'update') hit.forEach((r) => Object.assign(r, JSON.parse(JSON.stringify(patch))));
          else if (mode === 'delete') T[name] = T[name].filter((r) => !hit.includes(r));
          else data = single ? hit[0] || null : hit.slice(0, lim);
          return Promise.resolve({ data, error: null }).then(res, rej);
        }
      };
      return q;
    }
  };
}

const review = (id, stars, comment, extra = {}) => Object.assign({
  name: LOC + '/reviews/' + id, reviewId: id, reviewer: { displayName: 'Guest ' + id }, starRating: stars, comment,
  createTime: '2026-11-20T18:30:00Z', updateTime: '2026-11-20T18:30:00Z'
}, extra);

/* a stand-in for Google: routes by URL; calls are recorded */
function google(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    for (const [re, fn] of routes) if (re.test(url)) { const [status, body] = await fn(url, init); return { ok: status < 300, status, statusText: '', text: async () => JSON.stringify(body) }; }
    return { ok: false, status: 404, statusText: 'Not Found', text: async () => '{}' };
  };
  return { fetch, calls };
}

const idToken = 'x.' + Buffer.from(JSON.stringify({ email: 'owner@example.com' })).toString('base64url') + '.y';

test('state: signed, bound to the workspace and user, expires after 10 minutes, refuses changes', () => {
  const t = signState(CFG, { orgId: ORG, userId: USER }, 1000);
  assert.deepEqual(readState(CFG, t, 2000), { orgId: ORG, userId: USER });
  assert.equal(readState(CFG, t, 1000 + 11 * 60000), null);
  const [body, sig] = t.split('.');
  const other = Buffer.from(JSON.stringify({ o: 'evil', u: USER, x: 9e15, n: 'a' })).toString('base64url');
  assert.equal(readState(CFG, other + '.' + sig, 2000), null);
  assert.equal(readState(googleConfig({ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'other', APP_URL: 'https://app.example' }), t, 2000), null);
  assert.ok(body.length > 10);
});

test('config and sign-in address: redirect to /api/messages, offline access, business.manage', () => {
  assert.equal(CFG.configured, true);
  assert.equal(CFG.redirectUri, 'https://app.example/api/messages');
  assert.equal(googleConfig({}).configured, false);
  const u = new URL(authUrl(CFG, 'st'));
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('prompt'), 'consent');
  assert.match(u.searchParams.get('scope'), /business\.manage/);
  assert.equal(u.searchParams.get('redirect_uri'), CFG.redirectUri);
});

test('records: stars, Malaysia date, original words of a translated review, anonymous reviewer, reply', () => {
  const r = googleRecord(review('a1', 'FOUR', '(Translated by Google) Very clean\n\n(Original)\n非常干净', { reviewReply: { comment: 'Thank you!', updateTime: '2026-11-21T01:00:00Z' } }), { conn: { location_title: 'Kozi @ Vortex KLCC', building_id: 'B1' } });
  assert.equal(r.id, recordId(LOC + '/reviews/a1'));
  assert.match(r.id, /^RV-GG-[0-9A-F]{12}$/);
  assert.equal(r.platform, 'google');
  assert.equal(r.stars, 4);
  assert.equal(r.date, '2026-11-21'); // 18:30 UTC is 02:30 the next day in Malaysia
  assert.equal(r.text, '非常干净');
  assert.equal(r.place, 'Kozi @ Vortex KLCC');
  assert.equal(r.buildingId, 'B1');
  assert.deepEqual(r.reply, { text: 'Thank you!', date: '2026-11-21', by: null });
  assert.deepEqual(r.tags, []); assert.deepEqual(r.sub, {});
  assert.equal(googleRecord(review('a2', 'ONE', '', { reviewer: { isAnonymous: true } })).guest, 'A Google user');
  assert.equal(originalText('Plain text'), 'Plain text');
});

function connectRoutes(extra = []) {
  return google([
    [/oauth2\.googleapis\.com\/token/, async () => [200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: SCOPE + ' openid email', id_token: idToken }]],
    [/\/v1\/accounts\?/, async () => [200, { accounts: [{ name: 'accounts/111' }] }]],
    [/\/accounts\/111\/locations\?/, async () => [200, { locations: [{ name: 'locations/222', title: 'Kozi @ Vortex KLCC' }] }]],
    ...extra
  ]);
}

test('first connect: tokens kept server side, the only profile is chosen, its reviews fetched without inbox lines', async () => {
  const sb = fakeDb({ records: [{ org_id: ORG, coll: 'buildings', id: 'B1', data: {}, deleted: false }] });
  const g = connectRoutes([[/mybusiness\.googleapis\.com\/v4\/accounts\/111\/locations\/222\/reviews/, async () => [200, { reviews: [review('a1', 'FIVE', 'Great'), review('a2', 'TWO', 'Noisy')], averageRating: 3.5, totalReviewCount: 2 }]]]);
  const notices = [];
  const out = await finishConnect(sb, CFG, { code: 'C', state: signState(CFG, { orgId: ORG, userId: USER }) }, { fetch: g.fetch, canConnect: async () => true, notice: async (s, o, n) => notices.push(n) });
  assert.equal(out.status, 'active');
  assert.equal(sb.T.google_tokens[0].refresh_token, 'RT');
  const c = sb.T.google_connections[0];
  assert.equal(c.google_email, 'owner@example.com');
  assert.equal(c.location_name, 'locations/222');
  assert.equal(c.building_id, 'B1');
  assert.equal(Number(c.average), 3.5);
  assert.equal(sb.T.records.filter((r) => r.coll === 'reviews').length, 2);
  assert.equal(notices.length, 0);
  assert.equal(connView(c).email, 'owner@example.com');
  assert.equal(JSON.stringify(connView(c)).includes('RT'), false);
});

test('connect refuses a non-owner and a forged state', async () => {
  const sb = fakeDb();
  const g = connectRoutes();
  await assert.rejects(finishConnect(sb, CFG, { code: 'C', state: signState(CFG, { orgId: ORG, userId: USER }) }, { fetch: g.fetch, canConnect: async () => false }), /account owner/);
  await assert.rejects(finishConnect(sb, CFG, { code: 'C', state: 'nope.nope' }, { fetch: g.fetch }), /Connect Google again/);
  assert.equal(g.calls.length, 0);
});

const connected = (extra = {}) => ({
  google_connections: [Object.assign({ org_id: ORG, account_name: 'accounts/111', location_name: 'locations/222', location_title: 'Kozi @ Vortex KLCC', status: 'active', last_sync_at: null }, extra)],
  google_tokens: [{ org_id: ORG, refresh_token: 'RT', access_token: 'AT', expires_at: new Date(Date.now() + 3600e3).toISOString() }],
  records: []
});

test('later sync: a new review posts one inbox line; an unchanged one is left alone', async () => {
  const sb = fakeDb(connected());
  const page = { reviews: [review('a1', 'FIVE', 'Great')], totalReviewCount: 1, averageRating: 5 };
  const g = google([[/\/reviews\?/, async () => [200, page]]]);
  const notices = [];
  const notice = async (s, o, n) => { notices.push(n); };
  let out = await syncGoogle(sb, CFG, ORG, { fetch: g.fetch, notice });
  assert.deepEqual([out.saved, out.added], [1, 1]);
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /New 5-star Google review from Guest a1/);
  assert.equal(notices[0].feed, 'google');
  out = await syncGoogle(sb, CFG, ORG, { fetch: g.fetch, notice });
  assert.deepEqual([out.saved, out.added], [0, 0]);
  assert.equal(notices.length, 1);
  assert.ok(sb.T.google_connections[0].last_sync_at);
});

test('expired access token is renewed with the refresh token', async () => {
  const db = connected(); db.google_tokens[0].expires_at = new Date(Date.now() - 1000).toISOString();
  const sb = fakeDb(db);
  const g = google([
    [/oauth2\.googleapis\.com\/token/, async (u, init) => { assert.match(init.body, /grant_type=refresh_token/); return [200, { access_token: 'AT2', expires_in: 3600 }]; }],
    [/\/reviews\?/, async (u, init) => { assert.equal(init.headers.Authorization, 'Bearer AT2'); return [200, { reviews: [] }]; }]
  ]);
  await syncGoogle(sb, CFG, ORG, { fetch: g.fetch });
  assert.equal(sb.T.google_tokens[0].access_token, 'AT2');
});

test('Google has not approved API access yet: the connection waits, with words for the team', async () => {
  const sb = fakeDb(connected());
  const g = google([[/\/reviews\?/, async () => [429, { error: { code: 429, message: 'Quota exceeded for quota metric', status: 'RESOURCE_EXHAUSTED' } }]]]);
  const out = await syncGoogle(sb, CFG, ORG, { fetch: g.fetch });
  assert.equal(out.status, 'waiting');
  assert.equal(sb.T.google_connections[0].status, 'waiting');
  assert.match(sb.T.google_connections[0].last_error, /not approved/);
});

test('reply: PUT to the review, saved on the record; a non-Google review is refused', async () => {
  const db = connected();
  const rec = googleRecord(review('a1', 'THREE', 'OK'), {});
  db.records.push({ org_id: ORG, coll: 'reviews', id: rec.id, data: rec, deleted: false });
  db.records.push({ org_id: ORG, coll: 'reviews', id: 'RV-CX-1', data: { id: 'RV-CX-1', platform: 'airbnb' }, deleted: false });
  const sb = fakeDb(db);
  const g = google([[/\/reviews\/a1\/reply$/, async (u, init) => { assert.equal(init.method, 'PUT'); assert.deepEqual(JSON.parse(init.body), { comment: 'Thank you for staying with us!' }); return [200, { comment: 'Thank you for staying with us!' }]; }]]);
  const out = await replyGoogle(sb, CFG, ORG, rec.id, 'Thank you for staying with us!', 'S1', { fetch: g.fetch });
  assert.equal(out.reply.text, 'Thank you for staying with us!');
  assert.equal(out.reply.by, 'S1');
  assert.equal(sb.T.records.find((r) => r.id === rec.id).data.reply.text, 'Thank you for staying with us!');
  await assert.rejects(replyGoogle(sb, CFG, ORG, 'RV-CX-1', 'Thank you so much!', null, { fetch: g.fetch }), /did not come from Google/);
  await assert.rejects(replyGoogle(sb, CFG, ORG, rec.id, 'short', null, { fetch: g.fetch }), /at least 10/);
});

test('worker: skips when Google keys are missing', async () => {
  assert.deepEqual(await syncDue(fakeDb(), googleConfig({}), {}), { skipped: 'not-configured' });
  const sb = fakeDb(connected());
  const g = google([[/\/reviews\?/, async () => [200, { reviews: [] }]]]);
  assert.deepEqual(await syncDue(sb, CFG, { fetch: g.fetch }), { synced: 1 });
});
