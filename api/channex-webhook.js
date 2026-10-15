/* POST /api/channex-webhook   Channex calls this (public; no sign-in). Plan section 4.
 *
 * 1. Reads the exact bytes received (at most 256 KB).
 * 2. Checks who sent it: a valid x-hmac-signature-256 (HMAC-SHA256 with CHANNEX_WEBHOOK_SECRET over `${timestamp}.${body}`,
 *    timestamp within 5 minutes), or the X-Orbique-Webhook-Token header equal to CHANNEX_WEBHOOK_TOKEN (the fallback while
 *    Channex does not sign). Neither -> 401. Nothing configured -> 401 for everything.
 * 3. Stores the event in channex_events once (keyed by the body's sha256, so a replayed delivery is not stored twice).
 *    The database fails -> 500, so Channex sends it again later.
 * 4. Booking events are handled right away, for up to about 6 seconds: fetch the revision, save the bookings, assign
 *    units, alerts, then acknowledge it. Whatever is not finished by then the worker finishes within a minute or two.
 * 5. 200 once stored, whatever happened in step 4 (failures are left for the worker, never for Channex to resend).
 */
import { send, cors, rawBody } from './_lib/http.js';
import { requireAdminClient } from './_lib/supabase.js';
import { channexConfig, verifySignature, safeEqual } from './_lib/channex.js';
import { processEvent, bodyHash, isUuid } from './_lib/channex-bookings.js';

export const MAX_BODY = 256 * 1024;
export const INLINE_MS = 6000;

const header = (req, name) => { const v = req.headers && req.headers[name]; return Array.isArray(v) ? v.join(',') : v || ''; };

/** True when the request comes from Channex (signature, else the shared token header). */
export function authentic(req, raw, cfg, now = Date.now()) {
  if (cfg.webhookSecret && verifySignature(cfg.webhookSecret, raw, header(req, 'x-hmac-timestamp'), header(req, 'x-hmac-signature-256'), { now })) return true;
  if (cfg.webhookToken && safeEqual(header(req, 'x-orbique-webhook-token'), cfg.webhookToken)) return true;
  return false;
}

/** The channex_events row for a parsed body. */
export function eventRow(body, hash) {
  const p = body && typeof body.payload === 'object' && body.payload && !Array.isArray(body.payload) ? body.payload : {};
  const uuid = (v) => (isUuid(v) ? v : null);
  return {
    body_sha256: hash,
    event: String(body.event || '').slice(0, 60) || 'unknown',
    channex_property_id: uuid(body.property_id) || uuid(p.property_id),
    revision_id: uuid(p.revision_id) || uuid(p.booking_revision_id),
    booking_id: uuid(p.booking_id),
    payload: body
  };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: 'method', message: 'Use POST for this address.' });
  }
  const started = Date.now();
  let raw;
  try {
    raw = await rawBody(req, MAX_BODY);
  } catch (e) {
    return send(res, e && e.status === 413 ? 413 : 400, { ok: false, error: 'bad-body', message: 'The request could not be read.' });
  }
  const cfg = channexConfig();
  if (!authentic(req, raw, cfg)) return send(res, 401, { ok: false, error: 'bad-signature', message: 'Not signed.' });

  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch (e) { body = null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { ok: false, error: 'bad-json', message: 'The request could not be read.' });

  // store it (once); Channex retries on 5xx, so a database failure answers 500
  let sb;
  let ev;
  try {
    sb = requireAdminClient();
    const row = eventRow(body, bodyHash(raw));
    const ins = await sb.from('channex_events').upsert(row, { onConflict: 'body_sha256', ignoreDuplicates: true }).select('id, event, channex_property_id, revision_id, payload, status');
    if (ins.error) throw new Error(ins.error.message);
    ev = ins.data && ins.data[0];
    if (!ev) {
      const got = await sb.from('channex_events').select('id, event, channex_property_id, revision_id, payload, status').eq('body_sha256', row.body_sha256).single();
      if (got.error) throw new Error(got.error.message);
      ev = got.data;
      if (ev.status === 'done' || ev.status === 'ignored') return send(res, 200, { ok: true, stored: true, duplicate: true, status: ev.status });
    }
  } catch (e) {
    console.error('[channex] webhook store:', e && e.message ? e.message : String(e));
    return send(res, 500, { ok: false, error: 'server', message: 'Could not store the event; send it again.' });
  }

  // handle it now if it is quick; otherwise the worker does it
  let status = 'new';
  try {
    const left = INLINE_MS - (Date.now() - started);
    const work = processEvent(sb, ev, { config: cfg, timeoutMs: Math.max(1500, Math.min(4000, left - 1500)), budgetMs: Math.max(1500, left - 500) })
      .then((r) => r.status, (e) => { console.error('[channex] webhook process:', e && e.message ? e.message : String(e)); return 'error'; });
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve('pending'), Math.max(500, left)); });
    status = await Promise.race([work, late]);
    clearTimeout(timer);
  } catch (e) {
    status = 'error';
  }
  return send(res, 200, { ok: true, stored: true, status });
}
