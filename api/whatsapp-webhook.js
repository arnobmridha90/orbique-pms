/* GET/POST /api/whatsapp-webhook   Meta calls this for the WhatsApp business number (public; no sign-in).
 *
 * GET:  Meta's check when the webhook is set up: hub.verify_token must equal WHATSAPP_VERIFY_TOKEN; answers hub.challenge.
 * POST: one delivery (messages from guests, delivery ticks for replies).
 *   1. Reads the exact bytes received (at most 256 KB).
 *   2. X-Hub-Signature-256 must be the HMAC-SHA256 of those bytes with WHATSAPP_APP_SECRET. Otherwise 401.
 *   3. Each message goes to the conversation of the guest's booking (matched by phone number), else to a new chat
 *      that waits to be linked; it is translated for the team when translation is set up.
 *   4. 200 once everything is stored. A database failure answers 500, so Meta sends it again (stored messages are
 *      skipped the second time).
 * Until WHATSAPP_TOKEN, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN are all set, it refuses everything.
 */
import { send, cors, rawBody } from './_lib/http.js';
import { requireAdminClient } from './_lib/supabase.js';
import { waConfig, verifyChallenge, verifyWaSignature, parseWebhook } from './_lib/whatsapp.js';
import { receiveWhatsApp, receiveWhatsAppStatus } from './_lib/inbox.js';

export const MAX_BODY = 256 * 1024;
export const TRANSLATE_BUDGET_MS = 9000;

function queryOf(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { return Object.fromEntries(new URL(req.url || '/', 'http://x').searchParams); } catch (e) { return {}; }
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return;
  const cfg = deps.config || waConfig();
  if (req.method === 'GET') {
    const challenge = cfg.configured ? verifyChallenge(queryOf(req), cfg) : null;
    if (!challenge) return send(res, 403, { ok: false, error: 'bad-token', message: 'Not allowed.' });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(challenge);
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { ok: false, error: 'method', message: 'Use POST for this address.' });
  }
  let raw;
  try {
    raw = await rawBody(req, MAX_BODY);
  } catch (e) {
    return send(res, e && e.status === 413 ? 413 : 400, { ok: false, error: 'bad-body', message: 'The request could not be read.' });
  }
  const sig = req.headers && req.headers['x-hub-signature-256'];
  if (!cfg.configured || !verifyWaSignature(cfg.appSecret, raw, Array.isArray(sig) ? sig[0] : sig)) return send(res, 401, { ok: false, error: 'bad-signature', message: 'Not signed.' });

  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch (e) { body = null; }
  if (!body || typeof body !== 'object') return send(res, 400, { ok: false, error: 'bad-json', message: 'The request could not be read.' });

  const { messages, statuses } = parseWebhook(body);
  const out = { messages: 0, statuses: 0 };
  try {
    const sb = deps.sb || requireAdminClient();
    const started = Date.now();
    for (const m of messages) {
      // a burst of messages must finish well inside the function's 20 s: late ones are stored untranslated (Translate in the inbox)
      const opts = Date.now() - started > TRANSLATE_BUDGET_MS ? Object.assign({}, deps.opts, { translateConfig: { configured: false } }) : deps.opts;
      const r = await receiveWhatsApp(sb, m, opts);
      if (r.status === 'stored') out.messages++;
    }
    for (const s of statuses) { const r = await receiveWhatsAppStatus(sb, s); if (r.status === 'updated') out.statuses++; }
  } catch (e) {
    console.error('[whatsapp] webhook:', e && e.message ? e.message : String(e));
    return send(res, 500, { ok: false, error: 'server', message: 'Could not store it; send it again.' });
  }
  return send(res, 200, Object.assign({ ok: true }, out));
}
