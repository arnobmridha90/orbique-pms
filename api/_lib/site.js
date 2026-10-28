/* A workspace's own website content, on the server (api/site.js, and GET /api/public/site in api/public.js).
 * Private module: Vercel does not expose files under api/_lib as endpoints.
 *
 * The content and its rules are in ./shared/sitecontent.cjs. Here:
 *   websiteAllowed(ctx, action)      pure: may this member edit or publish the website (the app's O.can('website.<action>'))
 *   requireWebsite(sb, orgId, user, action)   the same from the database, or a 403
 *   uploadUrls(sb, orgId, body)      signed upload URLs for new photos (Supabase Storage, public bucket site-photos)
 *   publish(sb, orgId, me, opts)     the draft -> siteContentLive, then the live site's pages are refreshed
 *   refreshSite(opts)                GET each page with x-prerender-revalidate (Vercel ISR's bypass token), only on a
 *                                    host the operator allows (refreshHosts: SITE_REVALIDATE_HOSTS, else www.staykozi.my)
 *   publicContent(sb, ws)            the published content for GET /api/public/site
 *
 * Photos: <bucket>/<orgId>/<photoId>-<width>.jpg, public URL prefix <SUPABASE_URL>/storage/v1/object/public/site-photos/.
 * Removing a photo from the content never deletes its files.
 */
import { randomBytes } from 'node:crypto';
import { ApiError, bad, forbidden, conflict, tooMany } from './http.js';
import { config as sbConfig, membership, check } from './supabase.js';
import { must, blob } from './channex-db.js';
import { siteSettings } from './website.js';
import C from './shared/sitecontent.cjs';

export const BUCKET = 'site-photos';
export const MAX_FILE = 3 * 1024 * 1024;
export const PUBLISH_PER_HOUR = 20;
const HISTORY = 20;
const REFRESH_TIMEOUT_MS = 5000;
const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;
/* The sites Publish refreshes when SITE_REVALIDATE_HOSTS is not set. Any active member who may edit the website can
 * change siteUrl, so the bypass token is sent only to a host on this list, never to whatever siteUrl says. */
export const REFRESH_HOSTS = ['www.staykozi.my', 'staykozi.my'];

/* ---------- who may do what (mirrors O.can in app/core.js and public.website_can in 0017) ---------- */

/* the app's built-in role defaults for the Website builder section (O.DEFAULT_ROLE_PERMS): only ops has it */
export const DEFAULT_WEBSITE = { ops: { section: 'edit', edit: true, publish: true } };

/**
 * ctx {role, staffId, rolePerms (the rolePerms blob, or null), staffMeta (the staffMeta blob, or null)}, action 'edit'|'publish'
 * Owners may always. Others need the Website builder section at Edit and the action on: a person's own overrides first,
 * then their role's saved permissions, then the built-in defaults when the saved role does not mention the website.
 */
export function websiteAllowed(ctx, action) {
  if (!ctx || (action !== 'edit' && action !== 'publish')) return false;
  const meta = ctx.staffMeta && typeof ctx.staffMeta === 'object' ? ctx.staffMeta[ctx.staffId] : null;
  if (meta && meta.status === 'suspended') return false;
  if (ctx.role === 'owner') return true;
  const ov = meta && meta.overrides && typeof meta.overrides === 'object' ? meta.overrides : {};
  const perms = ctx.rolePerms && typeof ctx.rolePerms === 'object' ? ctx.rolePerms : null;
  const def = DEFAULT_WEBSITE[ctx.role] || { section: 'none', edit: false, publish: false };
  const saved = perms ? perms[ctx.role] : undefined;
  let level;
  if (Object.prototype.hasOwnProperty.call(ov, 'section:website')) level = ov['section:website'] || 'none';
  else if (!perms) level = def.section;
  else if (saved && saved.sections && typeof saved.sections === 'object' && !('website' in saved.sections)) level = def.section;
  else level = (saved && saved.sections && saved.sections.website) || 'none';
  if (level !== 'edit') return false;
  const key = 'website.' + action;
  if (Object.prototype.hasOwnProperty.call(ov, key)) return !!ov[key];
  if (!perms) return def[action];
  if (saved && saved.actions && typeof saved.actions === 'object' && !(key in saved.actions)) return def[action];
  return !!(saved && saved.actions && saved.actions[key]);
}

const WHY = { edit: 'Your access does not include editing the website.', publish: 'Your access does not include publishing the website.' };

/** The caller's membership when they may do action on the website of an active workspace, else a 403. */
export async function requireWebsite(sb, orgId, userId, action) {
  const m = await membership(sb, orgId, userId);
  if (!m || m.status !== 'active') throw forbidden('You are not a member of this workspace.');
  const org = check(await sb.from('orgs').select('id, status').eq('id', orgId).maybeSingle(), 'load workspace');
  if (!org) throw new ApiError(400, 'no-workspace', 'That workspace was not found.');
  if (org.status !== 'active') throw forbidden('This workspace is paused, so the website cannot be changed right now.');
  if (m.role !== 'owner') {
    const [rolePerms, staffMeta] = await Promise.all([blob(sb, orgId, 'rolePerms'), blob(sb, orgId, 'staffMeta')]);
    if (!websiteAllowed({ role: m.role, staffId: m.staff_id, rolePerms, staffMeta }, action)) throw forbidden(WHY[action]);
  } else {
    const staffMeta = await blob(sb, orgId, 'staffMeta');
    if (!websiteAllowed({ role: 'owner', staffId: m.staff_id, staffMeta }, action)) throw forbidden(WHY[action]);
  }
  return m;
}

/* ---------- photos ---------- */

/** The public URL prefix of a workspace's photo folder (an upload's base starts with it). */
export function uploadPrefix(orgId, env = process.env) {
  const url = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  return url + '/storage/v1/object/public/' + BUCKET + '/' + orgId + '/';
}
export const newPhotoId = () => 'p' + Date.now().toString(36) + '-' + randomBytes(6).toString('hex');

let bucketReady = false;
export function _resetBucketCache() { bucketReady = false; }

/** Make sure the public bucket exists (first use): JPEG only, at most 3 MB a file. */
export async function ensureBucket(sb) {
  if (bucketReady) return;
  const got = await sb.storage.getBucket(BUCKET);
  if (got && got.data && !got.error) { bucketReady = true; return; }
  const made = await sb.storage.createBucket(BUCKET, { public: true, allowedMimeTypes: ['image/jpeg'], fileSizeLimit: MAX_FILE });
  if (made && made.error && !/already exists|duplicate/i.test(String(made.error.message || ''))) {
    console.error('[api] create bucket:', made.error.message || made.error);
    throw new ApiError(500, 'server', 'Photo storage could not be set up. Please try again in a minute.');
  }
  bucketReady = true;
}

/** body {count 1..30, widths: subset of [640, 1280, 2400] with 640} -> {photos: [{id, base, widths, uploads: [{width, path, signedUrl, token}]}]} */
export async function uploadUrls(sb, orgId, body, env = process.env) {
  const count = Number(body.count);
  if (!Number.isInteger(count) || count < 1 || count > 30) throw bad('bad-count', 'Add between 1 and 30 photos at a time.');
  const want = Array.isArray(body.widths) ? body.widths.map(Number) : [];
  if (!want.length || want.some((w) => !C.WIDTHS.includes(w)) || !want.includes(640)) throw bad('bad-widths', 'The photo sizes are not valid. Reload the page and try again.');
  const widths = C.WIDTHS.filter((w) => want.includes(w));
  await ensureBucket(sb);
  const prefix = uploadPrefix(orgId, env), store = sb.storage.from(BUCKET);
  const photos = await Promise.all(Array.from({ length: count }, async () => {
    const id = newPhotoId();
    const uploads = await Promise.all(widths.map(async (width) => {
      const path = `${orgId}/${id}-${width}.jpg`;
      /* upsert: a retry of the same file may overwrite a half-finished upload */
      const r = await store.createSignedUploadUrl(path, { upsert: true });
      if (!r || r.error || !r.data) {
        console.error('[api] signed upload url:', r && r.error ? r.error.message || r.error : 'no data');
        throw new ApiError(500, 'server', 'The photo upload could not start. Please try again in a minute.');
      }
      return { width, path, signedUrl: r.data.signedUrl, token: r.data.token };
    }));
    return { id, base: prefix + id, widths, uploads };
  }));
  return { photos, maxBytes: MAX_FILE };
}

/* ---------- publish ---------- */

const nameOf = (user, staff) => (staff && staff.name) || (user && user.user_metadata && user.user_metadata.name) || (user && user.email ? String(user.email).split('@')[0] : 'Someone');

/**
 * Publish the saved draft. opts {draftHash (the page's hash of the draft it shows; a mismatch means a change is still
 * saving), env, fetch, now}. -> {publishedAt, publishedBy, live, refreshed, failed, note, warnings}
 */
export async function publish(sb, orgId, me, membershipRow, opts = {}) {
  const env = opts.env || process.env;
  const now = opts.now ? new Date(opts.now) : new Date();
  const [draft, liveRaw, website] = await Promise.all([blob(sb, orgId, 'siteContent'), blob(sb, orgId, 'siteContentLive'), blob(sb, orgId, 'website')]);
  if (!draft) throw bad('no-draft', 'There is nothing to publish yet. Add a building and a unit first.');
  if (opts.draftHash && C.hash(C.canon(draft)) !== String(opts.draftHash)) throw conflict('draft-saving', 'Your latest changes are still saving. Wait a moment and publish again.');
  const live = liveRaw && typeof liveRaw === 'object' ? liveRaw : null;
  const history = (live && Array.isArray(live.history) ? live.history : []).filter((t) => typeof t === 'string');
  const hourAgo = now.getTime() - 3600 * 1000;
  if (history.filter((t) => Date.parse(t) > hourAgo).length >= PUBLISH_PER_HOUR) throw tooMany(`The website was published ${PUBLISH_PER_HOUR} times in the last hour. Please wait a little and publish again.`);

  const settings = siteSettings(website);
  const res = C.check(draft, { strict: true, uploadPrefixes: [uploadPrefix(orgId, env)], bookTypes: Object.keys(settings.types || {}) });
  if (res.errors.length) {
    const first = res.errors.slice(0, 3).join(' ');
    const e = bad('content-problems', res.errors.length > 3 ? `${first} And ${res.errors.length - 3} more to fix.` : first);
    e.details = { problems: res.problems.filter((p) => p.level === 'error') };
    throw e;
  }
  const staff = membershipRow && membershipRow.staff_id
    ? must(await sb.from('records').select('data').eq('org_id', orgId).eq('coll', 'staff').eq('id', membershipRow.staff_id).maybeSingle(), 'load staff record')
    : null;
  const publishedAt = now.toISOString();
  const publishedBy = nameOf(me, staff && staff.data);
  const next = { content: res.content, publishedAt, publishedBy, history: [publishedAt].concat(history).slice(0, HISTORY) };
  must(await sb.from('blobs').upsert({ org_id: orgId, key: 'siteContentLive', data: { v: next }, updated_by: me ? me.id : null }, { onConflict: 'org_id,key' }), 'save live website');

  /* refresh the pages of both copies: a page that is gone now must stop showing */
  const nowPaths = C.pagePaths(res.content);
  const paths = nowPaths.concat(C.pagePaths(live && live.content).filter((p) => !nowPaths.includes(p))).slice(0, C.MAX_PATHS);
  const refresh = await refreshSite({ siteUrl: settings.siteUrl, paths, gone: paths.filter((p) => !nowPaths.includes(p)), token: env.SITE_REVALIDATE_TOKEN, hosts: refreshHosts(env), fetch: opts.fetch });
  return { publishedAt, publishedBy, live: next, refreshed: refresh.refreshed, failed: refresh.failed, note: refresh.note, warnings: res.warnings };
}

/** The hosts Publish may refresh: SITE_REVALIDATE_HOSTS (comma separated, e.g. "www.staykozi.my,staykozi.my"), else REFRESH_HOSTS. */
export function refreshHosts(env = process.env) {
  const list = String(env.SITE_REVALIDATE_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+$/.test(h));
  return list.length ? list : REFRESH_HOSTS.slice();
}

/** The site's origin when it is https on an allowed host (no port, no path, no user), else null. */
export function refreshOrigin(siteUrl, hosts) {
  let u;
  try { u = new URL(String(siteUrl || '').trim()); } catch (e) { return null; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password || (u.pathname && u.pathname !== '/') || u.search || u.hash) return null;
  return (hosts || []).includes(u.hostname.toLowerCase()) ? 'https://' + u.hostname.toLowerCase() : null;
}

/**
 * opts {siteUrl, paths, gone (paths no longer in the content: a 404 there is right), token, hosts (allowed hosts, see
 * refreshHosts), fetch, timeoutMs} -> {refreshed: n, failed: [paths], note}. Without a token, a site address or an
 * allowed host nothing is sent; the note is for the person who published (plain words, the details go to the log).
 */
export async function refreshSite(opts) {
  const token = String(opts.token || '').trim();
  const later = 'The website shows the change within 5 minutes.';
  if (!opts.siteUrl) return { refreshed: 0, failed: [], note: 'Add the website address on this page so Publish can refresh it at once. ' + later };
  if (!token) { console.warn('[api] site refresh skipped: SITE_REVALIDATE_TOKEN is not set'); return { refreshed: 0, failed: [], note: later }; }
  const base = refreshOrigin(opts.siteUrl, opts.hosts || REFRESH_HOSTS);
  if (!base) { console.warn('[api] site refresh skipped: the website address is not in SITE_REVALIDATE_HOSTS'); return { refreshed: 0, failed: [], note: later }; }
  const f = opts.fetch || globalThis.fetch, ms = opts.timeoutMs || REFRESH_TIMEOUT_MS, gone = opts.gone || [];
  const results = await Promise.all((opts.paths || []).slice(0, C.MAX_PATHS).map(async (path) => {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await f(base + path, { method: 'GET', headers: { 'x-prerender-revalidate': token }, redirect: 'manual', signal: ctl.signal });
      if (r && r.body && typeof r.body.cancel === 'function') r.body.cancel().catch(() => {});
      return (r.status >= 200 && r.status < 400) || (r.status === 404 && gone.includes(path)) ? null : path;
    } catch (e) {
      return path;
    } finally {
      clearTimeout(timer);
    }
  }));
  const failed = results.filter(Boolean);
  if (failed.length) console.error('[api] site refresh failed for', failed.length, 'pages');
  return { refreshed: results.length - failed.length, failed, note: failed.length ? 'Some pages could not be refreshed now. ' + later : null };
}

/* ---------- the public read ---------- */

/** The workspace behind a website slug: {orgId, settings}. Online booking may be off; the content still shows. */
export async function siteBySlug(sb, ws) {
  const slug = String(ws || '').trim().toLowerCase();
  if (!SLUG.test(slug)) throw bad('bad-site', 'Unknown website.');
  const rows = must(await sb.from('blobs').select('org_id, data').eq('key', 'website').eq('data->v->>slug', slug).limit(2), 'load website');
  if (!rows || rows.length !== 1) throw new ApiError(404, 'no-site', 'Unknown website.');
  const org = must(await sb.from('orgs').select('id, status').eq('id', rows[0].org_id).maybeSingle(), 'load workspace');
  if (!org || (org.status && !['active', 'trial'].includes(org.status))) throw new ApiError(404, 'no-site', 'Unknown website.');
  return { orgId: org.id, settings: siteSettings(rows[0].data && rows[0].data.v) };
}

/** -> {content: SiteContent | null, publishedAt: ISO | null}, checked again on the way out (anything invalid is dropped) */
export async function publicContent(sb, ws, env = process.env) {
  const site = await siteBySlug(sb, ws);
  const live = await blob(sb, site.orgId, 'siteContentLive');
  if (!live || typeof live !== 'object' || !live.content) return { content: null, publishedAt: null };
  const res = C.check(live.content, { uploadPrefixes: [uploadPrefix(site.orgId, env)], bookTypes: Object.keys(site.settings.types || {}) });
  return { content: res.content, publishedAt: typeof live.publishedAt === 'string' ? live.publishedAt : null };
}
