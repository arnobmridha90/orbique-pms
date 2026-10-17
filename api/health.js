/* GET /api/health -> {ok: true, db, needsBootstrap, channex, whatsapp, translate, commit}
 * db: the Supabase URL and service key are set and the database answers.
 * needsBootstrap: no platform admin exists yet (the first sign-in screen offers "Set up Orbique").
 * channex: the channel manager API key (CHANNEX_API_KEY) is set. Says nothing about whether it works.
 * whatsapp: WHATSAPP_TOKEN, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN are set. translate: ANTHROPIC_API_KEY is set.
 * No sign-in needed; never reveals keys or error details.
 */
import { send, cors } from './_lib/http.js';
import { adminClient, platformAdminCount } from './_lib/supabase.js';
import { channexConfigured } from './_lib/channex.js';
import { waConfig } from './_lib/whatsapp.js';
import { translateConfig } from './_lib/translate.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
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
  return send(res, 200, { ok: true, db, needsBootstrap, channex: channexConfigured(), whatsapp: waConfig().configured, translate: translateConfig().configured, commit });
}
