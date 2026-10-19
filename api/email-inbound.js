/* POST /api/email-inbound   Resend calls this when an email reaches a workspace's Orbique address (public; no sign-in).
 *
 * 1. Reads the exact bytes received (at most 256 KB) and checks Resend's signature (Svix headers, RESEND_WEBHOOK_SECRET).
 *    Not signed -> 401. Nothing configured -> 401 for everything.
 * 2. Only "email.received" is handled; other events answer 200 and are dropped.
 * 3. Finds the workspace from the recipients (to, cc, bcc and the addresses the mail was received for). None -> 200,
 *    stored as ignored (an email to an address no workspace has).
 * 4. Each email is handled once (inbound_emails, by Resend's email id): the whole email is fetched from Resend and
 *    becomes a guest message (answerable by email) or a notification in the inbox (api/_lib/email-in.js).
 * 5. A database or Resend failure answers 500, so Resend sends it again later.
 */
import { send, cors, rawBody } from './_lib/http.js';
import { requireAdminClient } from './_lib/supabase.js';
import { inboundConfig, verifySvix, orgForAddresses, fetchEmail, receiveEmail } from './_lib/email-in.js';
import { findConv, appendMsg, postNotice, myt, inboxSettings, translated } from './_lib/inbox.js';

export const MAX_BODY = 256 * 1024;
const clip = (v, n) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)).slice(0, n);

export const CONV = { findConv, appendMsg, postNotice, myt, inboxSettings, translated };

/** Handle one verified webhook body. opts {cfg, fetch, now, conv} -> {status, ...} */
export async function handleEvent(sb, body, opts = {}) {
  if (!body || body.type !== 'email.received' || !body.data || typeof body.data !== 'object') return { status: 'ignored', why: 'not an email' };
  const d = body.data;
  const id = clip(d.email_id || d.id, 120);
  if (!id) return { status: 'ignored', why: 'no email id' };
  const rcpt = [].concat(d.to || [], d.cc || [], d.bcc || [], d.received_for || []);
  const target = await orgForAddresses(sb, rcpt);
  const row = { email_id: id, org_id: target ? target.orgId : null, sender: clip(Array.isArray(d.from) ? d.from[0] : d.from, 300) || null, subject: clip(d.subject, 300) || null };
  const ins = await sb.from('inbound_emails').upsert(row, { onConflict: 'email_id', ignoreDuplicates: true }).select('email_id, status');
  if (ins.error) throw new Error(ins.error.message);
  if (!ins.data || !ins.data.length) {
    const got = await sb.from('inbound_emails').select('status').eq('email_id', id).maybeSingle();
    if (got.error) throw new Error(got.error.message);
    if (got.data && (got.data.status === 'done' || got.data.status === 'ignored')) return { status: got.data.status, duplicate: true };
  }
  const mark = async (status, result, error) => {
    const r = await sb.from('inbound_emails').update({ status, result: result || null, error: error ? clip(error, 1000) : null }).eq('email_id', id);
    if (r.error) console.error('[email] status:', r.error.message);
  };
  if (!target) { await mark('ignored', null, 'no workspace has this address'); return { status: 'ignored', why: 'unknown address' }; }
  try {
    const email = await fetchEmail(opts.cfg, id, { fetch: opts.fetch });
    const r = await receiveEmail(sb, target.orgId, Object.assign({ id }, email), { now: opts.now, conv: opts.conv || CONV });
    await mark(r.status === 'ignored' ? 'ignored' : 'done', r, null);
    return r;
  } catch (e) {
    await mark('error', null, e && e.message ? e.message : String(e));
    throw e;
  }
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: 'method', message: 'Use POST for this address.' });
  }
  let raw;
  try {
    raw = await rawBody(req, MAX_BODY);
  } catch (e) {
    return send(res, e && e.status === 413 ? 413 : 400, { ok: false, error: 'bad-body', message: 'The request could not be read.' });
  }
  const cfg = inboundConfig();
  if (!cfg.configured || !verifySvix(cfg.webhookSecret, raw, req.headers || {})) return send(res, 401, { ok: false, error: 'bad-signature', message: 'Not signed.' });
  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch (e) { body = null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { ok: false, error: 'bad-json', message: 'The request could not be read.' });
  try {
    const r = await handleEvent(requireAdminClient(), body, { cfg });
    return send(res, 200, { ok: true, status: r.status });
  } catch (e) {
    console.error('[email] inbound:', e && e.message ? e.message : String(e));
    return send(res, 500, { ok: false, error: 'server', message: 'Could not store the email; send it again.' });
  }
}
