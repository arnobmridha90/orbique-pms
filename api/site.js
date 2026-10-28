/* POST /api/site  {action, orgId, ...}   the workspace's own website (the Live website page, app/pages/livesite.js)
 *
 *   upload-urls   may edit the website      {count: 1..30, widths: [640, 1280?, 2400?]}
 *                 -> {photos: [{id, base, widths, uploads: [{width, path, signedUrl, token}]}], maxBytes}
 *                    The browser sends each file with PUT to its signedUrl (Supabase Storage, public bucket site-photos).
 *   publish       may publish the website   {draftHash?}
 *                 -> {publishedAt, publishedBy, live, refreshed, failed: [paths], note, warnings}
 *                    The saved draft (blob siteContent) is checked, written to siteContentLive, and the live site's
 *                    pages are refreshed (SITE_REVALIDATE_TOKEN). At most 20 publishes an hour per workspace.
 *                    A draft with problems is refused: 400 content-problems with {problems: [{where, field, message}]}.
 *
 * Sign-in: "Authorization: Bearer <Supabase access token>". "May edit / publish" is the app's Staff Access rule
 * (website.edit, website.publish), checked here against the database. Errors are plain English (api/_lib/http.js).
 * Content rules: api/_lib/shared/sitecontent.cjs; storage and refresh: api/_lib/site.js. See docs/API.md.
 */
import { ok, fail, send, cors, readJson, bearer, bad, uuid as uuidField } from './_lib/http.js';
import { requireAdminClient, caller } from './_lib/supabase.js';
import { requireWebsite, uploadUrls, publish } from './_lib/site.js';

const ACTIONS = {
  'upload-urls': { need: 'edit', run: (sb, orgId, body) => uploadUrls(sb, orgId, body) },
  publish: { need: 'publish', run: (sb, orgId, body, me, m) => publish(sb, orgId, me, m, { draftHash: typeof body.draftHash === 'string' ? body.draftHash.slice(0, 16) : null }) }
};

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, { ok: false, error: 'method', message: 'Use POST for this address.' });
    }
    const body = await readJson(req);
    const action = typeof body.action === 'string' ? body.action : '';
    const spec = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    if (!spec) throw bad('bad-action', 'Unknown request.');
    const sb = requireAdminClient();
    const me = await caller(sb, bearer(req));
    const orgId = uuidField(body.orgId);
    const m = await requireWebsite(sb, orgId, me.id, spec.need);
    return ok(res, await spec.run(sb, orgId, body, me, m));
  } catch (err) {
    return fail(res, err);
  }
}
