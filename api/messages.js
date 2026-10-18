/* POST /api/messages  {action, orgId, ...}   the live guest inbox for one workspace
 *
 *   config                                      inbox viewer   {whatsapp: {configured, number}, channex, translate, lang}
 *   send        {conversationId, text, via ('whatsapp' | 'channex'), orig?, origLang?, lang?}
 *                                               inbox.send     -> {conversation}: the record after the reply was added
 *   translate   {conversationId, index, to?}    inbox viewer   one message into the team's language (or `to`), saved
 *   preview     {text, to}                      inbox.send     a reply in the guest's language, to check before sending
 *   media       {conversationId, index}         inbox viewer   a file the guest sent on WhatsApp: {mime, name, data (base64)}
 *   whatsapp-connect    {phoneNumberId}         owner          this workspace answers on that WhatsApp business number
 *   whatsapp-disconnect                         owner
 *
 * Sign-in: "Authorization: Bearer <Supabase access token>"; the caller must be an active member of an active workspace.
 * Demo workspaces never send anything. Tokens and keys never leave the server; nothing here returns them.
 */
import { ApiError, ok, fail, send, cors, readJson, bearer, bad, forbidden, conflict, id as idField, uuid as uuidField } from './_lib/http.js';
import { requireAdminClient, caller, getOrg, membership } from './_lib/supabase.js';
import { channexConfig } from './_lib/channex.js';
import { must, record, blob } from './_lib/channex-db.js';
import { waConfig, fetchMedia, phoneNumberInfo, WhatsAppError } from './_lib/whatsapp.js';
import { translateConfig, translate, langCode, TranslateError, MAX_CHARS } from './_lib/translate.js';
import { canInbox, sendReply, patchMsg, numberOf, inboxSettings } from './_lib/inbox.js';
import { allowedOrg } from './channex.js';

export const MEDIA_MAX = 3 * 1024 * 1024; // base64 grows it by a third; Vercel answers at most 4.5 MB

// Booking-site chat needs Channex's paid Messages app, which is not used: guests are reached on WhatsApp.
// Switch it back on here (and add the message events to WEBHOOK_EVENTS in channex.js) if that changes.
export const CHANNEX_MESSAGES = false;
function channexMessages(cx, orgId) { return CHANNEX_MESSAGES && allowedOrg(cx, orgId); }

async function workspace(sb, body, me, need) {
  const orgId = uuidField(body.orgId);
  const m = await membership(sb, orgId, me.id);
  if (!m || m.status !== 'active') throw forbidden('You are not a member of this workspace.');
  const org = await getOrg(sb, orgId);
  if (org.status !== 'active') throw forbidden('This workspace is paused. Please contact Orbique.');
  if (need === 'owner') { if (m.role !== 'owner') throw forbidden('Only the account owner of this workspace can do that.'); }
  else if (!(await canInbox(sb, orgId, m, need || 'inbox'))) throw forbidden(need === 'inbox.send' ? 'Your access does not include messaging guests.' : 'Your access does not include the guest inbox.');
  return { org, member: m };
}

async function isDemo(sb, orgId) {
  const meta = await blob(sb, orgId, 'workspaceMeta');
  return !!(meta && typeof meta === 'object' && meta.demo === true);
}

async function conversation(sb, orgId, id) {
  const c = await record(sb, orgId, 'conversations', idField(id, 'Conversation'));
  if (!c) throw bad('not-found', 'This conversation is no longer there. Refresh the inbox.');
  return c;
}

function message(c, index) {
  const i = Number(index);
  const list = Array.isArray(c.messages) ? c.messages : [];
  if (!Number.isInteger(i) || i < 0 || i >= list.length || !list[i] || typeof list[i] !== 'object') throw bad('not-found', 'This message is no longer there. Refresh the inbox.');
  return { i, m: list[i] };
}

function translateFailure(e) {
  if (e instanceof TranslateError) return new ApiError(e.retryable ? 502 : 400, 'translate', e.message);
  return e;
}

/* ---------- actions ---------- */

async function config(sb, body, me) {
  const ws = await workspace(sb, body, me);
  const wa = waConfig();
  const num = await numberOf(sb, ws.org.id);
  const cx = channexConfig();
  const settings = await inboxSettings(sb, ws.org.id);
  return {
    whatsapp: { configured: wa.configured, number: num ? { phone: num.display_phone || null, name: num.verified_name || null } : null },
    channex: channexMessages(cx, ws.org.id),
    translate: translateConfig().configured,
    lang: settings.lang, autoTranslate: settings.autoTranslate,
    demo: await isDemo(sb, ws.org.id)
  };
}

async function sendAction(sb, body, me) {
  const ws = await workspace(sb, body, me, 'inbox.send');
  if (await isDemo(sb, ws.org.id)) throw forbidden('This is a demo workspace, so nothing is sent to guests.');
  const conv = await conversation(sb, ws.org.id, body.conversationId);
  const booking = conv.bookingId ? await record(sb, ws.org.id, 'bookings', String(conv.bookingId)) : null;
  const via = body.via === 'whatsapp' || body.via === 'channex' ? body.via : null;
  if (!via) throw bad('bad-via', 'Choose how to send it.');
  const cx = channexConfig();
  if (via === 'channex' && !channexMessages(cx, ws.org.id)) throw forbidden('Booking site messages are not switched on for this workspace yet.');
  const data = await sendReply(sb, {
    orgId: ws.org.id, conv, booking, via, text: typeof body.text === 'string' ? body.text : '',
    orig: typeof body.orig === 'string' ? body.orig.slice(0, 4096) : null, origLang: body.origLang, lang: body.lang,
    staffId: ws.member.staff_id || null, userId: me.id, channexConfig: cx
  });
  return { conversation: { id: conv.id, data } };
}

async function translateAction(sb, body, me) {
  const ws = await workspace(sb, body, me);
  const cfg = translateConfig();
  if (!cfg.configured) throw new ApiError(503, 'not-configured', 'Translation is not set up on the server yet.');
  const conv = await conversation(sb, ws.org.id, body.conversationId);
  const { i, m } = message(conv, body.index);
  const source = String(m.caption || m.text || '').trim();
  if (!source) throw bad('empty', 'There is no text to translate.');
  const to = langCode(body.to) || (await inboxSettings(sb, ws.org.id)).lang;
  let r;
  try { r = await translate(cfg, source.slice(0, MAX_CHARS), to); } catch (e) { throw translateFailure(e); }
  const patch = r.same ? { lang: r.lang || to } : { lang: r.lang || undefined, tr: { to, text: r.text } };
  const saved = await patchMsg(sb, ws.org.id, { convId: conv.id, index: i, text: typeof m.text === 'string' ? m.text : '', patch });
  return { conversation: saved ? { id: saved.id, data: saved.data } : null, same: r.same, lang: r.lang, text: r.text };
}

async function preview(sb, body, me) {
  await workspace(sb, body, me, 'inbox.send');
  const cfg = translateConfig();
  if (!cfg.configured) throw new ApiError(503, 'not-configured', 'Translation is not set up on the server yet.');
  const to = langCode(body.to);
  if (!to) throw bad('no-lang', 'Choose the guest\'s language.');
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw bad('empty', 'Write a message first.');
  try {
    const r = await translate(cfg, text, to);
    return { text: r.same ? text : r.text, lang: to, from: r.lang || null, same: r.same };
  } catch (e) {
    throw translateFailure(e);
  }
}

async function media(sb, body, me) {
  const ws = await workspace(sb, body, me);
  const conv = await conversation(sb, ws.org.id, body.conversationId);
  const { m } = message(conv, body.index);
  if (!m.media || typeof m.media.id !== 'string') throw bad('no-file', 'This message has no file to open.');
  const cfg = waConfig();
  if (!cfg.configured) throw new ApiError(503, 'not-configured', 'WhatsApp is not set up on the server yet.');
  try {
    const f = await fetchMedia(cfg, m.media.id, MEDIA_MAX);
    return { mime: f.mime, name: m.media.name || m.name || null, data: f.bytes.toString('base64') };
  } catch (e) {
    if (e instanceof WhatsAppError) throw new ApiError(e.retryable ? 502 : 400, 'whatsapp', e.message);
    throw e;
  }
}

async function connectNumber(sb, body, me) {
  const ws = await workspace(sb, body, me, 'owner');
  const cfg = waConfig();
  if (!cfg.configured) throw new ApiError(503, 'not-configured', 'WhatsApp is not set up on the server yet. Add WHATSAPP_TOKEN, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN in Vercel, then redeploy.');
  const pnid = String(body.phoneNumberId || '').trim();
  if (!/^\d{6,25}$/.test(pnid)) throw bad('bad-id', 'Enter the Phone number ID from Meta (WhatsApp, API Setup): only digits.');
  const taken = must(await sb.from('whatsapp_numbers').select('org_id').eq('phone_number_id', pnid).maybeSingle(), 'load WhatsApp number');
  if (taken && taken.org_id !== ws.org.id) throw conflict('number-taken', 'This WhatsApp number is already connected to another workspace.');
  let info;
  try {
    info = await phoneNumberInfo(cfg, pnid);
  } catch (e) {
    if (e instanceof WhatsAppError) throw bad('whatsapp', e.status === 400 || e.status === 404 ? 'Meta does not know this Phone number ID, or the token cannot use it. Check the ID and that the system user has the WhatsApp account.' : e.message);
    throw e;
  }
  must(await sb.from('whatsapp_numbers').delete().eq('org_id', ws.org.id).neq('phone_number_id', pnid), 'replace WhatsApp number');
  must(await sb.from('whatsapp_numbers').upsert({ phone_number_id: pnid, org_id: ws.org.id, display_phone: String(info.display_phone_number || '').slice(0, 40) || null, verified_name: String(info.verified_name || '').slice(0, 120) || null, created_by: me.id }, { onConflict: 'phone_number_id' }), 'save WhatsApp number');
  return { number: { phone: info.display_phone_number || null, name: info.verified_name || null } };
}

async function disconnectNumber(sb, body, me) {
  const ws = await workspace(sb, body, me, 'owner');
  must(await sb.from('whatsapp_numbers').delete().eq('org_id', ws.org.id), 'remove WhatsApp number');
  return { number: null };
}

const ACTIONS = {
  config, send: sendAction, translate: translateAction, preview, media,
  'whatsapp-connect': connectNumber, 'whatsapp-disconnect': disconnectNumber
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
    const run = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    if (!run) throw bad('bad-action', 'Unknown request.');
    const sb = requireAdminClient();
    const me = await caller(sb, bearer(req));
    return ok(res, await run(sb, body, me));
  } catch (err) {
    return fail(res, err);
  }
}

