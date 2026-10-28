/* Connecting a workspace's WhatsApp number with Meta's Embedded Signup (server only), including a number that stays on
 * the WhatsApp Business app on the phone ("coexistence"). Private module: Vercel does not expose files under api/_lib.
 *
 *   connectWithSignup(sb, req, opts)   the owner finished the pop-up: the number is linked to the workspace
 *   accountUpdate(sb, a)               Meta says the number was disconnected (from the phone) or connected again
 *
 * Steps for a code from the pop-up (it is valid for about 30 seconds, so this runs at once):
 *   1. the code -> a token for the business's WhatsApp account (kept in whatsapp_tokens, never sent to the browser);
 *   2. the account and number (the coexistence pop-up often sends only the account);
 *   3. the account's webhooks go to this site's /api/whatsapp-webhook (override_callback_uri, so the Meta app can also
 *      serve another site);
 *   4. the number is saved for the workspace, replacing any other;
 *   5. for a phone-app number: the contacts and the older chats (up to 6 months) are asked for. WhatsApp allows each
 *      once, within 24 hours of connecting; a refusal does not undo the connection.
 * The number is never registered (/register): a phone-app number already is, and registering would take it off the app.
 */
import { must } from './channex-db.js';
import { ApiError, bad } from './http.js';
import { exchangeCode, signupNumber, subscribeApp, requestSync, WhatsAppError } from './whatsapp.js';

const clip = (v, n) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)).slice(0, n);

function refused(e, what) {
  if (e instanceof WhatsAppError) return new ApiError(e.retryable ? 502 : 400, 'whatsapp', what + ': ' + e.message);
  return e;
}

/**
 * req {orgId, userId, code, wabaId?, phoneNumberId?, callbackUrl}; opts {config, fetch, now}
 * -> {number: {phone, name, coexist}, sync: {contacts, history}}
 */
export async function connectWithSignup(sb, req, opts = {}) {
  const cfg = opts.config;
  if (!cfg || !cfg.signup) throw new ApiError(503, 'not-configured', 'Connecting with Facebook is not set up on the server yet (WHATSAPP_APP_ID, WHATSAPP_CONFIG_ID, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN in Vercel).');
  const code = clip(req.code, 2000).trim();
  if (!code || /\s/.test(code)) throw bad('bad-code', 'Facebook did not finish the sign-in. Try connecting again.');
  if (!/^https:\/\//.test(String(req.callbackUrl || ''))) throw new ApiError(503, 'not-configured', 'Set APP_URL in Vercel (or deploy to production) so WhatsApp knows where to send messages.');
  const g = { fetch: opts.fetch };
  let token;
  try { token = await exchangeCode(cfg, code, g); } catch (e) { throw refused(e, 'Facebook did not accept the sign-in (it is valid for 30 seconds; try again)'); }
  let found;
  try { found = await signupNumber(cfg, token, { wabaId: req.wabaId, phoneNumberId: req.phoneNumberId }, g); } catch (e) { throw refused(e, 'Could not find the number'); }
  const pnid = found.phoneNumberId;
  const taken = must(await sb.from('whatsapp_numbers').select('org_id').eq('phone_number_id', pnid).maybeSingle(), 'load WhatsApp number');
  if (taken && taken.org_id !== req.orgId) throw new ApiError(409, 'number-taken', 'This WhatsApp number is already connected to another workspace.');
  try { await subscribeApp(cfg, token, found.wabaId, { url: req.callbackUrl, verifyToken: cfg.verifyToken }, g); } catch (e) { throw refused(e, 'WhatsApp did not agree to send this number\'s messages to Orbique'); }
  const info = found.info || {};
  const coexist = info.is_on_biz_app === true;
  const now = new Date(opts.now || Date.now()).toISOString();
  must(await sb.from('whatsapp_numbers').delete().eq('org_id', req.orgId).neq('phone_number_id', pnid), 'replace WhatsApp number');
  must(await sb.from('whatsapp_numbers').upsert({
    phone_number_id: pnid, org_id: req.orgId, waba_id: found.wabaId, coexist,
    display_phone: clip(info.display_phone_number, 40) || null, verified_name: clip(info.verified_name, 120) || null, created_by: req.userId || null
  }, { onConflict: 'phone_number_id' }), 'save WhatsApp number');
  must(await sb.from('whatsapp_tokens').upsert({ phone_number_id: pnid, token, updated_at: now }, { onConflict: 'phone_number_id' }), 'save WhatsApp token');
  const sync = {};
  if (coexist) {
    for (const [key, type] of [['contacts', 'smb_app_state_sync'], ['history', 'history']]) {
      try {
        sync[key] = { at: now, id: await requestSync(cfg, token, pnid, type, g) };
      } catch (e) {
        sync[key] = { at: now, error: clip(e && e.message, 300) || 'refused' };
        console.error('[whatsapp] ' + type + ' request:', sync[key].error);
      }
    }
    must(await sb.from('whatsapp_numbers').update({ sync }).eq('phone_number_id', pnid), 'save WhatsApp sync');
  }
  return { number: { phone: info.display_phone_number || null, name: info.verified_name || null, coexist }, sync };
}

const OFF = ['PARTNER_REMOVED', 'ACCOUNT_OFFBOARDED'];

/** account_update: a number disconnected from the phone (Settings, Account, Business Platform) or connected again. */
export async function accountUpdate(sb, a) {
  if (!a || !/^\d{5,25}$/.test(String(a.wabaId || ''))) return { status: 'ignored' };
  const on = a.event === 'ACCOUNT_RECONNECTED';
  if (!on && !OFF.includes(a.event)) return { status: 'ignored' };
  const rows = must(await sb.from('whatsapp_numbers').select('phone_number_id, sync').eq('waba_id', a.wabaId), 'load WhatsApp number') || [];
  for (const r of rows) {
    const sync = Object.assign({}, r.sync && typeof r.sync === 'object' ? r.sync : {});
    if (on) delete sync.disconnected;
    else sync.disconnected = { at: new Date().toISOString(), event: a.event, reason: clip(a.reason, 120) || null };
    must(await sb.from('whatsapp_numbers').update({ sync }).eq('phone_number_id', r.phone_number_id), 'save WhatsApp number');
  }
  return { status: rows.length ? 'updated' : 'unknown' };
}
