/* GET /api/health -> {ok: true, db, needsBootstrap, commit}
 * db: the Supabase URL and service key are set and the database answers.
 * needsBootstrap: no platform admin exists yet (the first sign-in screen offers "Set up Orbique").
 * No sign-in needed; never reveals keys or error details.
 */
import { send } from './_lib/http.js';
import { adminClient, platformAdminCount } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { ok: false, error: 'method', message: 'Use GET for this address.' });
  }
  const commit = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);
  let db = false;
  let needsBootstrap = false;
  const sb = adminClient();
  if (sb) {
    let timer;
    try {
      const count = await Promise.race([
        platformAdminCount(sb),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('database timeout')), 8000); })
      ]);
      db = true;
      needsBootstrap = count === 0;
    } catch (e) {
      console.error('[api] health:', e && e.message ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
  }
  return send(res, 200, { ok: true, db, needsBootstrap, commit });
}
