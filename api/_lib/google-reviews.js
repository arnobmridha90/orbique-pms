/* Google Business Profile reviews in the app's `reviews` records, and replies back (server only).
 * Private module: Vercel does not expose files under api/_lib as endpoints. Google calls are in google.js.
 *
 *   googleRecord(gr, ctx)                      a Google review -> the app's review record (platform 'google')
 *   connectionOf(sb, orgId)                    the workspace's google_connections row (never the tokens), or null
 *   finishConnect(sb, cfg, q, opts)            Google sent the owner back with ?code&state: tokens saved, location found
 *   locationsOf(sb, cfg, orgId, opts)          the locations the connected Google account manages (to choose one)
 *   pickLocation(sb, cfg, orgId, pick, opts)   show this location's reviews (and run the first sync)
 *   syncGoogle(sb, cfg, orgId, opts)           fetch new and changed reviews; a new one also posts a line in the inbox
 *   syncDue(sb, cfg, opts)                     the worker: every connected workspace not synced in SYNC_EVERY_MS
 *   replyGoogle(sb, cfg, orgId, id, text, by)  post the public reply on Google, then save it
 *   disconnectGoogle(sb, cfg, orgId, opts)     forget the connection and its tokens (the reviews already fetched stay)
 *
 * Records: id RV-GG-<12 hex of the review name>, gg = 'accounts/../locations/../reviews/..', place = the profile's name,
 * buildingId = the building chosen for the profile (if any). Google has no booking, unit or category scores.
 */
import crypto from 'node:crypto';
import { bad, forbidden, ApiError } from './http.js';
import { must, record, todayMY } from './channex-db.js';
import { GoogleError, exchangeCode, refreshAccess, listLocations, listReviews, putReply, readState } from './google.js';

export const SYNC_EVERY_MS = 30 * 60 * 1000;
export const MAX_PAGES = 4; // 50 reviews a page; a first sync takes up to 200, later ones stop at the first unchanged review
const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const CONN_COLS = 'org_id, google_email, account_name, location_name, location_title, building_id, status, last_sync_at, last_error, average, total, connected_by, updated_at';
const clip = (v, n) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)).trim().slice(0, n);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const nowIso = (opts) => new Date((opts && opts.now) || Date.now()).toISOString();
const myDate = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? todayMY(t) : null; };

export const recordId = (name) => 'RV-GG-' + crypto.createHash('sha1').update(String(name)).digest('hex').slice(0, 12).toUpperCase();

/** Google's "(Translated by Google) ... (Original) ..." -> the original words, which the team should answer. */
export function originalText(comment) {
  const c = clip(comment, 8000);
  const m = c.match(/\(Original\)\s*([\s\S]+)$/);
  if (m && /^\(Translated by Google\)/.test(c)) return m[1].trim();
  return c;
}

/**
 * ctx {old (the record already stored, or null), conn (google_connections row), today}
 */
export function googleRecord(gr, ctx = {}) {
  const old = ctx.old || null, conn = ctx.conn || {};
  const rr = isObj(gr.reviewReply) ? gr.reviewReply : null;
  const replyText = rr ? clip(rr.comment, 4000) : '';
  let reply = old && old.reply ? old.reply : null;
  if (replyText && (!reply || reply.text !== replyText)) reply = { text: replyText, date: myDate(rr.updateTime) || ctx.today || todayMY(), by: reply && reply.by ? reply.by : null };
  if (!replyText && rr === null && reply && old && old.gg) reply = null; // the reply was deleted on Google
  const reviewer = isObj(gr.reviewer) ? gr.reviewer : {};
  const rec = {
    id: (old && old.id) || recordId(gr.name),
    gg: String(gr.name),
    bookingId: old ? old.bookingId || null : null,
    guest: reviewer.isAnonymous ? 'A Google user' : clip(reviewer.displayName, 80) || 'A Google user',
    country: (old && old.country) || '',
    propertyId: old ? old.propertyId || null : null,
    buildingId: conn.building_id || (old && old.buildingId) || null,
    place: clip(conn.location_title, 160) || (old && old.place) || 'Google Business Profile',
    platform: 'google',
    ota: 'Google',
    stars: STARS[gr.starRating] || (old && old.stars) || 5,
    score: null,
    date: myDate(gr.createTime) || (old && old.date) || ctx.today || todayMY(),
    text: originalText(gr.comment),
    tags: (old && old.tags) || [],
    sub: (old && old.sub) || {},
    reply,
    reservationCode: null,
    hidden: false
  };
  if (old && old.taskId) rec.taskId = old.taskId;
  return rec;
}

/* ---------- connection and sign-in ---------- */

export async function connectionOf(sb, orgId) {
  return must(await sb.from('google_connections').select(CONN_COLS).eq('org_id', orgId).maybeSingle(), 'load Google connection');
}

async function saveConn(sb, orgId, patch, opts) {
  must(await sb.from('google_connections').update(Object.assign({ updated_at: nowIso(opts) }, patch)).eq('org_id', orgId), 'save Google connection');
}

/** A failure from Google in words for the team; also remembered on the connection. */
export function explain(e) {
  if (!(e instanceof GoogleError)) return null;
  if (e.notApproved) return { status: 'waiting', message: 'Google has not approved Business Profile API access for this Google Cloud project yet (its quota is 0). Reviews start coming in on their own once Google approves it.' };
  if (e.revoked) return { status: 'error', message: 'The Google sign-in has stopped working (it was removed or its password changed). An account owner needs to connect Google again on the Reviews page.' };
  if (e.status === 403) return { status: 'error', message: 'Google says this Google account cannot manage that Business Profile. Connect with an account that is an owner or manager of the profile.' };
  if (e.retryable) return { status: null, message: 'Google did not answer. It tries again in 30 minutes.' };
  return { status: 'error', message: 'Google refused: ' + e.message };
}

/** A working access token for the workspace (renewed when it expires in under a minute). */
export async function accessToken(sb, cfg, orgId, opts = {}) {
  const t = must(await sb.from('google_tokens').select('refresh_token, access_token, expires_at').eq('org_id', orgId).maybeSingle(), 'load Google sign-in');
  if (!t) throw bad('google-not-connected', 'Google is not connected yet. An account owner can connect it on the Reviews page.');
  const now = opts.now || Date.now();
  if (t.access_token && Date.parse(t.expires_at || '') - now > 60000) return t.access_token;
  const r = await refreshAccess(cfg, t.refresh_token, opts);
  must(await sb.from('google_tokens').update({ access_token: r.accessToken, expires_at: new Date(r.expiresAt).toISOString(), updated_at: nowIso(opts) }).eq('org_id', orgId), 'save Google sign-in');
  return r.accessToken;
}

/**
 * The callback from Google. q {code, state, error}; opts {canConnect(orgId, userId) -> bool, fetch, now}
 * -> {orgId, status: 'active'|'pick'|'waiting', location?} ; throws ApiError with a message for the page
 */
export async function finishConnect(sb, cfg, q, opts = {}) {
  const s = readState(cfg, q.state, opts.now);
  if (!s) throw bad('google-state', 'The Google sign-in took too long or did not start from Orbique. Press Connect Google again.');
  if (q.error) throw bad('google-declined', q.error === 'access_denied' ? 'Google was not allowed to share the Business Profile. Press Connect Google again and allow it.' : 'Google stopped the sign-in: ' + clip(q.error, 80));
  if (opts.canConnect && !(await opts.canConnect(s.orgId, s.userId))) throw forbidden('Only the account owner of this workspace can connect Google.');
  const code = clip(q.code, 2000);
  if (!code) throw bad('google-code', 'Google did not finish the sign-in. Press Connect Google again.');
  let tok;
  try { tok = await exchangeCode(cfg, code, opts); } catch (e) { throw new ApiError(400, 'google-signin', 'Google did not accept the sign-in: ' + e.message); }
  const old = must(await sb.from('google_tokens').select('refresh_token').eq('org_id', s.orgId).maybeSingle(), 'load Google sign-in');
  const refresh = tok.refreshToken || (old && old.refresh_token);
  if (!refresh) throw bad('google-offline', 'Google did not give Orbique lasting access. Remove Orbique at myaccount.google.com/permissions, then connect again.');
  const base = { org_id: s.orgId, google_email: tok.email, connected_by: s.userId, status: 'pick', last_error: null, updated_at: nowIso(opts) };
  must(await sb.from('google_connections').upsert(base, { onConflict: 'org_id' }), 'save Google connection');
  must(await sb.from('google_tokens').upsert({ org_id: s.orgId, refresh_token: refresh, access_token: tok.accessToken, expires_at: new Date(tok.expiresAt).toISOString(), updated_at: nowIso(opts) }, { onConflict: 'org_id' }), 'save Google sign-in');
  let locs;
  try { locs = await listLocations(tok.accessToken, opts); } catch (e) {
    const x = explain(e);
    await saveConn(sb, s.orgId, { status: x && x.status === 'waiting' ? 'waiting' : 'pick', last_error: x ? x.message : 'The Business Profile could not be read yet.' }, opts);
    return { orgId: s.orgId, status: x && x.status === 'waiting' ? 'waiting' : 'pick' };
  }
  if (locs.length === 1) {
    const out = await pickLocation(sb, cfg, s.orgId, locs[0], Object.assign({}, opts, { token: tok.accessToken }));
    return { orgId: s.orgId, status: out.status, location: locs[0].title };
  }
  await saveConn(sb, s.orgId, { status: 'pick', last_error: locs.length ? null : 'This Google account does not manage any Business Profile. Connect with the account that owns the profile.' }, opts);
  return { orgId: s.orgId, status: 'pick' };
}

export async function locationsOf(sb, cfg, orgId, opts = {}) {
  const token = await accessToken(sb, cfg, orgId, opts);
  try { return await listLocations(token, opts); } catch (e) {
    const x = explain(e);
    if (x && x.status) await saveConn(sb, orgId, { status: x.status === 'waiting' ? 'waiting' : 'error', last_error: x.message }, opts);
    throw new ApiError(x && x.status === 'waiting' ? 409 : 502, 'google', x ? x.message : String(e && e.message || e));
  }
}

/** pick {account, location, title, buildingId?} -> {status, saved?} */
export async function pickLocation(sb, cfg, orgId, pick, opts = {}) {
  const account = clip(pick && pick.account, 80), location = clip(pick && pick.location, 80);
  if (!/^accounts\/[^/]+$/.test(account) || !/^locations\/[^/]+$/.test(location)) throw bad('bad-location', 'Choose one of the Business Profiles in the list.');
  let building = clip(pick.buildingId, 80) || null;
  if (!building) { // a workspace with one building: the profile is that building's
    const b = must(await sb.from('records').select('id').eq('org_id', orgId).eq('coll', 'buildings').eq('deleted', false).limit(2), 'load buildings') || [];
    if (b.length === 1) building = b[0].id;
  }
  await saveConn(sb, orgId, { account_name: account, location_name: location, location_title: clip(pick.title, 160) || null, building_id: building, status: 'active', last_error: null }, opts);
  const out = await syncGoogle(sb, cfg, orgId, Object.assign({}, opts, { first: true }));
  return { status: out.status || 'active', saved: out.saved || 0 };
}

/* ---------- sync ---------- */

async function existing(sb, orgId, name) {
  const r = must(await sb.from('records').select('id, data').eq('org_id', orgId).eq('coll', 'reviews').eq('deleted', false).eq('data->>gg', String(name)).limit(1), 'find review');
  return r && r[0] && isObj(r[0].data) ? Object.assign({}, r[0].data, { id: r[0].id }) : null;
}

/** Nothing the page shows has changed (jsonb reorders keys, so compare the fields). */
const same = (a, b) => ['guest', 'stars', 'date', 'text', 'place', 'buildingId'].every((k) => (a[k] || null) === (b[k] || null)) &&
  ((a.reply && a.reply.text) || null) === ((b.reply && b.reply.text) || null);

/**
 * opts {notice(sb, orgId, n), first (no inbox lines for the first fetch), deadline, fetch, now}
 * -> {status, saved, added}
 */
export async function syncGoogle(sb, cfg, orgId, opts = {}) {
  const conn = await connectionOf(sb, orgId);
  if (!conn || !conn.location_name) return { status: conn ? conn.status : 'off', saved: 0, added: 0 };
  let saved = 0, added = 0, average = null, total = null;
  try {
    const token = opts.token || (await accessToken(sb, cfg, orgId, opts));
    let pageToken = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      if (opts.deadline && Date.now() > opts.deadline) break;
      const res = await listReviews(token, { account: conn.account_name, location: conn.location_name }, { pageToken }, opts);
      if (page === 0) { average = res.average; total = res.total; }
      let unchanged = 0;
      for (const gr of res.reviews) {
        if (!gr || !gr.name) continue;
        const old = await existing(sb, orgId, gr.name);
        const rec = googleRecord(gr, { old, conn, today: todayMY(opts.now) });
        if (old && same(old, rec)) { unchanged++; continue; }
        const data = Object.assign({}, rec);
        must(await sb.from('records').upsert({ org_id: orgId, coll: 'reviews', id: rec.id, data, deleted: false }, { onConflict: 'org_id,coll,id' }), 'save review');
        saved++;
        if (!old) {
          added++;
          if (!opts.first && opts.notice) {
            await opts.notice(sb, orgId, {
              feed: 'google', via: 'google', xid: 'rv:gg:' + rec.id,
              text: `New ${rec.stars}-star Google review from ${rec.guest}${rec.text ? ': "' + clip(rec.text, 160) + (rec.text.length > 160 ? '…' : '') + '"' : ''}. Reply on the Reviews page.`,
              link: { page: 'reviews', id: rec.id }
            }).catch((e) => console.error('[google] notice:', e && e.message));
          }
        }
      }
      // ordered by last change: once a whole page is unchanged, the rest is too
      if (!opts.first && res.reviews.length && unchanged === res.reviews.length) break;
      pageToken = res.next;
      if (!pageToken) break;
    }
  } catch (e) {
    const x = explain(e);
    if (!x) throw e;
    await saveConn(sb, orgId, Object.assign({ last_error: x.message }, x.status ? { status: x.status } : {}), opts);
    return { status: x.status || conn.status, saved, added, error: x.message };
  }
  await saveConn(sb, orgId, Object.assign({ status: 'active', last_error: null, last_sync_at: nowIso(opts) }, average !== null ? { average, total } : {}), opts);
  return { status: 'active', saved, added };
}

/** The worker (every minute): workspaces whose last sync is older than 30 minutes, a few at a time. */
export async function syncDue(sb, cfg, opts = {}) {
  if (!cfg.configured) return { skipped: 'not-configured' };
  const before = new Date((opts.now || Date.now()) - SYNC_EVERY_MS).toISOString();
  const rows = must(await sb.from('google_connections').select('org_id, last_sync_at, status').in('status', ['active', 'waiting']).not('location_name', 'is', null).or('last_sync_at.is.null,last_sync_at.lt.' + before).limit(5), 'load Google connections') || [];
  let n = 0;
  for (const r of rows) {
    if (opts.deadline && Date.now() > opts.deadline - 2000) break;
    try { await syncGoogle(sb, cfg, r.org_id, opts); n++; } catch (e) { console.error('[google] sync', r.org_id + ':', e && e.message); }
  }
  return { synced: n };
}

/* ---------- reply ---------- */

export async function replyGoogle(sb, cfg, orgId, reviewId, text, by, opts = {}) {
  const t = String(text || '').trim();
  if (t.length < 10) throw bad('too-short', 'Write a reply of at least 10 characters first.');
  if (Buffer.byteLength(t, 'utf8') > 4000) throw bad('too-long', 'This reply is too long for Google (about 4,000 characters at most).');
  const r = await record(sb, orgId, 'reviews', String(reviewId || '').slice(0, 80));
  if (!r) throw bad('not-found', 'This review is no longer there. Refresh the page.');
  if (!r.gg) throw bad('not-google', 'This review did not come from Google.');
  try {
    const token = await accessToken(sb, cfg, orgId, opts);
    await putReply(token, r.gg, t, opts);
  } catch (e) {
    const x = explain(e);
    if (!x) throw e;
    if (x.status) await saveConn(sb, orgId, { status: x.status, last_error: x.message }, opts).catch(() => {});
    throw new ApiError(e.retryable ? 502 : 400, 'google', x.message);
  }
  const next = Object.assign({}, r, { reply: { text: t, date: todayMY(opts.now), by: by || null } });
  delete next.id;
  must(await sb.from('records').update({ data: Object.assign({ id: r.id }, next) }).eq('org_id', orgId).eq('coll', 'reviews').eq('id', r.id), 'save reply');
  return Object.assign({ id: r.id }, next);
}

export async function disconnectGoogle(sb, cfg, orgId, opts = {}) {
  const t = must(await sb.from('google_tokens').select('refresh_token').eq('org_id', orgId).maybeSingle(), 'load Google sign-in');
  if (t && t.refresh_token) { // best effort: also end Orbique's access on Google's side
    const f = opts.fetch || fetch;
    try { await f('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t.refresh_token }).toString() }); } catch (e) { /* the row goes anyway */ }
  }
  must(await sb.from('google_connections').delete().eq('org_id', orgId), 'remove Google connection');
  return { connection: null };
}

/** What the Reviews page shows (no tokens). */
export const connView = (c) => c && {
  email: c.google_email || null, location: c.location_name || null, title: c.location_title || null, buildingId: c.building_id || null,
  status: c.status, lastSync: c.last_sync_at || null, error: c.last_error || null, average: c.average !== null && c.average !== undefined ? Number(c.average) : null, total: c.total || 0
};
