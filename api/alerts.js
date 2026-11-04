/* POST /api/alerts  {action, orgId, ...}   booking alerts (api/_lib/alerts.js, migration 0011) and Team chat alerts (0024)
 *
 *   status             any active member of orgId      which channels are set up, phones registered, the last alerts
 *   test               owner or ops manager of orgId   send a test alert on every channel now -> {done: {email, whatsapp, push}}
 *   register-device    any active member of orgId      {token, platform}: this phone gets Team chat alerts, and booking
 *                                                      alerts too when the member is the owner or an ops manager
 *   unregister-device  the member who registered it    {token}: this phone stops getting them
 *   team-message       the sender of the message       {messageId}: phone alerts for a Team chat message just sent, once,
 *                                                      to the others in the chat who did not mute it -> {phones, sent}
 *   team-translate     any active member of orgId      {ids, to}: Team chat messages (up to 40, only chats the member is
 *                                                      in) in language `to` -> {configured, to, items, pending} (0025)
 *
 * Sign-in: "Authorization: Bearer <Supabase access token>". Uses the service-role key (server only).
 * Never returns a key; channel results are plain English ("sent", "skipped: why", "failed: why").
 */
import { ok, fail, send, cors, readJson, bearer, bad, forbidden, uuid as uuidField } from './_lib/http.js';
import { requireAdminClient, check, caller, membership } from './_lib/supabase.js';
import { channelStatus, queueTest, pushConfig, sendTeamPush } from './_lib/alerts.js';
import TC from './_lib/shared/teamchat.cjs';
import { teamTranslate } from './_lib/team-translate.js';

const ALERT_ROLES = ['owner', 'ops'];

async function member(sb, body, me, roles) {
  const orgId = uuidField(body.orgId);
  const m = await membership(sb, orgId, me.id);
  if (!m || m.status !== 'active') throw forbidden('You are not a member of this workspace.');
  if (roles && !roles.includes(m.role)) throw forbidden('Only the account owner or an ops manager can do that.');
  return { orgId, m };
}

function deviceToken(v) {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!/^[A-Za-z0-9_:\-.]{20,4096}$/.test(t)) throw bad('bad-token', 'That is not a phone notification token.');
  return t;
}

const ACTIONS = {
  status: async (sb, body, me) => {
    const { orgId } = await member(sb, body, me);
    return { status: await channelStatus(sb, orgId, me.id) };
  },
  test: async (sb, body, me) => {
    const { orgId } = await member(sb, body, me, ALERT_ROLES);
    return { done: await queueTest(sb, orgId, me.id) };
  },
  'register-device': async (sb, body, me) => {
    const { orgId, m } = await member(sb, body, me);
    const token = deviceToken(body.token);
    const platform = ['android', 'ios'].includes(body.platform) ? body.platform : 'android';
    const bookingAlerts = ALERT_ROLES.includes(m.role);
    check(await sb.from('push_devices').upsert({ token, org_id: orgId, user_id: me.id, platform, booking_alerts: bookingAlerts, updated_at: new Date().toISOString() }, { onConflict: 'token' }), 'save phone');
    return { registered: true, bookingAlerts };
  },
  'unregister-device': async (sb, body, me) => {
    const token = deviceToken(body.token);
    check(await sb.from('push_devices').delete().eq('token', token).eq('user_id', me.id), 'remove phone');
    return { registered: false };
  },
  'team-message': async (sb, body, me) => {
    const { orgId } = await member(sb, body, me);
    const messageId = uuidField(body.messageId, 'Message');
    // the database checks that the caller sent it, that it is new and not alerted yet, and who is in the chat (0024)
    const claim = check(await sb.rpc('team_push_claim', { p_org: orgId, p_msg: messageId, p_user: me.id }), 'claim team alert');
    if (!claim || !Array.isArray(claim.users) || !claim.users.length) return { phones: 0, sent: 0 };
    const text = TC.pushText(claim.chat, claim.senderName, { body: claim.body, file: claim.file });
    const r = await sendTeamPush(sb, pushConfig(), orgId, claim.users, text, { kind: 'team', chatId: claim.chat && claim.chat.id });
    if (r.failed && r.failed.length) console.error('[api] team alert:', r.failed[0]);
    return { phones: r.phones || 0, sent: r.sent || 0 };
  },
  'team-translate': async (sb, body, me) => {
    const { orgId } = await member(sb, body, me);
    return teamTranslate(sb, { orgId, userId: me.id, ids: body.ids, to: body.to });
  }
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
