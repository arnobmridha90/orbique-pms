/* POST /api/alerts  {action, orgId, ...}   booking alerts (api/_lib/alerts.js, migration 0011) and Team chat alerts (0024)
 *
 *   status             any active member of orgId      which channels are set up, phones registered, the last alerts
 *   test               owner or ops manager of orgId   send a test alert on every channel now -> {done: {email, whatsapp, push}}
 *   register-device    any active member of orgId      {token, platform}: this phone gets Team chat alerts, and booking
 *                                                      alerts too when the member is the owner or an ops manager
 *                                                      {notify}: also the bell's notifications on this phone (0033):
 *                                                      {kinds, quiet, allTasks} (api/_lib/notify-push.js)
 *   unregister-device  the member who registered it    {token}: this phone stops getting them
 *   notify-test        any active member of orgId      a test notification to the caller's phones -> {phones, sent, why}
 *   team-message       the sender of the message       {messageId}: phone alerts for a Team chat message just sent, once,
 *                                                      to the others in the chat who did not mute it -> {phones, sent}
 *   team-translate-fix any active member of orgId      {id, to, text}: the right translation of one message (replaces the shared one; the
 *                                                      health check's learning fix turns corrections into style notes, api/_lib/translate-learn.js)
 *   team-translate     any active member of orgId      {ids, to}: Team chat messages (up to 40, only chats the member is
 *                                                      in) in language `to` -> {configured, to, items, pending} (0025)
 *   health             the account owner               every check of the Health page -> {report, settings, log, fixes} (0027)
 *   health-settings    the account owner               {auto: {<fix id>: bool}, alert: bool}: which safe fixes run by themselves, and whether
 *                                                      a newly red check is sent to the owner -> {settings}
 *   health-fix         the account owner               {fix}: run one safe fix now -> {result}
 *
 * Sign-in: "Authorization: Bearer <Supabase access token>". Uses the service-role key (server only).
 * Never returns a key; channel results are plain English ("sent", "skipped: why", "failed: why").
 */
import { ok, fail, send, cors, readJson, bearer, bad, forbidden, uuid as uuidField } from './_lib/http.js';
import { requireAdminClient, check, caller, membership } from './_lib/supabase.js';
import { channelStatus, queueTest, pushConfig, sendTeamPush } from './_lib/alerts.js';
import { sendNotifyTest, KINDS as NOTIFY_KINDS } from './_lib/notify-push.js';
import TC from './_lib/shared/teamchat.cjs';
import TONES from './_lib/shared/tones.cjs';
import { teamTranslate } from './_lib/team-translate.js';
import { saveFix } from './_lib/translate-learn.js';
import { TranslateError } from './_lib/translate.js';
import { runHealth, healthSettings, saveHealthSettings, healthLog, applyFix, FIXES } from './_lib/healthcheck.js';

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

const OWNER_ONLY = ['owner'];
const GROUPS = ['bookings', 'changes', 'stays', 'money', 'messages', 'team', 'tasks', 'problems'];

/* {kinds, quiet, allTasks} from the phone: only known kinds and groups; the staff id comes from the membership */
export function notifyPrefs(v, staffId) {
  const list = (a, ok) => [...new Set((Array.isArray(a) ? a : []).filter((x) => typeof x === 'string' && ok(x)))];
  return { kinds: list(v.kinds, (k) => Object.prototype.hasOwnProperty.call(NOTIFY_KINDS, k)), quiet: list(v.quiet, (g) => GROUPS.includes(g)), allTasks: v.allTasks === true, staff: staffId || null };
}

const ACTIONS = {
  health: async (sb, body, me) => {
    const { orgId } = await member(sb, body, me, OWNER_ONLY);
    const [report, settings, log] = await Promise.all([runHealth(sb, orgId), healthSettings(sb, orgId), healthLog(sb, orgId)]);
    return { report, settings, log, fixes: FIXES };
  },
  'health-settings': async (sb, body, me) => {
    const { orgId } = await member(sb, body, me, OWNER_ONLY);
    return { settings: await saveHealthSettings(sb, orgId, body) };
  },
  'health-fix': async (sb, body, me) => {
    const { orgId } = await member(sb, body, me, OWNER_ONLY);
    if (typeof body.fix !== 'string' || !FIXES[body.fix]) throw bad('bad-fix', 'Unknown fix.');
    return { result: await applyFix(sb, orgId, body.fix) };
  },
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
    const row = { token, org_id: orgId, user_id: me.id, platform, booking_alerts: bookingAlerts, updated_at: new Date().toISOString() };
    // the tune per alert type picked on this phone (only sent by app builds that have every tune's sound file)
    if (body.tones && typeof body.tones === 'object') row.tones = TONES.changes(body.tones);
    // what this person may see in the bell, and the groups muted on this phone (0033)
    if (body.notify && typeof body.notify === 'object') row.notify = notifyPrefs(body.notify, m.staff_id);
    let saved = await sb.from('push_devices').upsert(row, { onConflict: 'token' });
    // before 0026 (push_devices.tones) the phone is saved without its tunes
    if (saved.error && row.tones && /tones/.test(String(saved.error.message || ''))) { delete row.tones; saved = await sb.from('push_devices').upsert(row, { onConflict: 'token' }); }
    // before 0033 (push_devices.notify) the phone is saved without it
    if (saved.error && row.notify && /notify/.test(String(saved.error.message || ''))) { delete row.notify; saved = await sb.from('push_devices').upsert(row, { onConflict: 'token' }); }
    check(saved, 'save phone');
    return { registered: true, bookingAlerts };
  },
  'unregister-device': async (sb, body, me) => {
    const token = deviceToken(body.token);
    check(await sb.from('push_devices').delete().eq('token', token).eq('user_id', me.id), 'remove phone');
    return { registered: false };
  },
  'notify-test': async (sb, body, me) => {
    const { orgId } = await member(sb, body, me);
    return sendNotifyTest(sb, orgId, me.id, { delayMs: 6000 });
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
  },
  'team-translate-fix': async (sb, body, me) => {
    const { orgId } = await member(sb, body, me);
    try { return await saveFix(sb, { orgId, userId: me.id, messageId: body.id, lang: body.to, fixed: body.text }); }
    catch (e) { if (e instanceof TranslateError) throw bad('translate', e.message); throw e; }
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
