/* The bell's notifications as real phone notifications (migration 0033). Server only.
 * Arnob, 2026-11-26: notifications only showed after opening the app and the bell; no notification bar, no pop-up,
 * no sound while the app was closed.
 *
 * The database writes one public.notifications row per thing that happens (0031) and pokes the worker (task 'push',
 * api/channex-worker.js) after each new one; the worker's every-minute tick also sends whatever is left. This module:
 *
 *   processNotifyPush(sb, opts)   claim the rows not pushed yet and send each to the phones that should get it
 *   pushText(row, ctx)            {title, body}: what the phone shows (English; the app shows the bell in the
 *                                 reader's language, app/server/notify.js)
 *   KINDS                         kind -> [group, icon, title]; app/server/notify.js K is the same list
 *                                 (tests/notify_push.test.mjs keeps them in step)
 *
 * Which phones: push_devices rows of the workspace whose app sent `notify` with register-device (api/alerts.js):
 * {kinds: what this person may see, quiet: bell groups muted on this phone, staff, allTasks}. Never to the person who
 * caused it. Team chat rows (staff list) only to those members. Left out because they already have their own phone
 * notification: Team chat messages (api/alerts.js team-message), and on owners' and ops managers' phones the booking
 * site's new bookings, cancellations and new dates (booking alerts, api/_lib/alerts.js).
 * A group muted in the bell ("Sounds") still shows on the phone, on the silent channel. Each phone's own tune per
 * alert type (Booking alerts card) picks the sound and Android channel, as for booking alerts.
 */
import { must, records } from './channex-db.js';
import { pushConfig, fcmSend, dataStrings, shortDate, moneyText } from './alerts.js';
import TONES from './shared/tones.cjs';

export const QUIET_CHANNEL = 'alerts_quiet';      // app/native/bridge.js: shows the notification without a sound
export const MAX_AGE_MS = 30 * 60e3;              // a row the worker could not send for 30 minutes is not sent late
const BATCH = 40;

/* group -> the alert type whose tune and channel it uses (app/server/notify.js G[group].tone) */
export const GROUP_TONE = { bookings: 'booking', changes: 'change', stays: 'booking', money: 'change', messages: 'message', team: 'team', tasks: 'task', problems: 'change' };

export const KINDS = {
  bk_new: ['bookings', '🛎️', 'New booking: {guest}'],
  bk_request: ['bookings', '🛎️', 'Booking request: {guest}'],
  bk_confirmed: ['bookings', '✅', 'Booking confirmed: {guest}'],
  bk_cancelled: ['changes', '❌', 'Booking cancelled: {guest}'],
  bk_dates: ['changes', '📅', 'New dates: {guest}'],
  bk_moved: ['changes', '🔀', 'Moved to another unit: {guest}'],
  bk_guests: ['changes', '👥', 'Number of guests changed: {guest}'],
  bk_price: ['changes', '💲', 'Price changed: {guest}'],
  bk_noshow: ['changes', '🚫', 'No-show: {guest}'],
  bk_edit: ['changes', '✏️', 'Booking details changed: {guest}'],
  avail_block: ['changes', '⛔', 'Dates blocked'],
  avail_open: ['changes', '🔓', 'Blocked dates opened again'],
  rates_changed: ['changes', '🏷️', 'Prices changed by {who}'],
  bk_checkin: ['stays', '🔑', 'Checked in: {guest}'],
  bk_checkout: ['stays', '👋', 'Checked out: {guest}'],
  gst_id: ['stays', '🪪', 'ID verified: {guest}'],
  gst_checkin: ['stays', '📝', 'Online check-in done: {guest}'],
  gst_rules: ['stays', '📜', 'House rules accepted: {guest}'],
  bk_code: ['stays', '🔢', 'Door code set: {guest}'],
  bk_code_sent: ['stays', '📨', 'Check-in details sent: {guest}'],
  bk_paid: ['money', '💰', 'Payment received: {guest}'],
  bk_invoice: ['money', '🧾', 'Invoice sent: {guest}'],
  bk_receipt: ['money', '🧾', 'Receipt sent: {guest}'],
  expense_new: ['money', '💸', 'New expense: {type}'],
  bk_unpaid: ['money', '⚠️', 'Not paid yet: {guest}'],
  gst_msg: ['messages', '💬', 'New message from {guest}'],
  review_new: ['messages', '⭐', 'New review from {guest}'],
  gst_request: ['messages', '🙋', 'Guest request: {type}'],
  owner_msg: ['messages', '📩', 'Message from owner {from}'],
  msg_failed: ['problems', '⚠️', 'A timed message could not be sent'],
  team_msg: ['team', '👥', 'Team chat: {chat}'],
  staff_joined: ['team', '🙌', 'New team member: {staff}'],
  task_new: ['tasks', '🧹', 'New task: {title}'],
  task_assigned: ['tasks', '🧹', 'Task assigned: {title}'],
  task_done: ['tasks', '✔️', 'Task done: {title}'],
  task_changed: ['tasks', '🕒', 'Task changed: {title}'],
  task_overdue: ['tasks', '⏰', 'Task overdue: {title}'],
  ready_late: ['tasks', '⏳', 'Unit not ready, guest arrives soon: {guest}'],
  bk_noclean: ['tasks', '🧽', 'Check-out today with no cleaning task: {guest}'],
  damage_new: ['tasks', '🛠️', 'Damage reported: {type}'],
  stock_low: ['tasks', '📦', 'Low stock: {item}'],
  daily_summary: ['tasks', '☀️', 'Today: {arrivals} arrivals, {departures} departures, {tasks} tasks'],
  bk_nocode: ['problems', '🔐', 'Arriving soon, check-in details not sent: {guest}'],
  bk_overlap: ['problems', '‼️', 'Double booking: {guest} and {guest2}'],
  sys_double_booking: ['problems', '‼️', 'Double booking from a booking site'],
  sys_needs_unit: ['problems', '🏠', 'A booking needs a unit'],
  sys_unmapped_room: ['problems', '🔗', 'A booking site room is not linked to a unit'],
  sys_unmapped_rate: ['problems', '🔗', 'A booking site rate is not linked'],
  sys_sync_error: ['problems', '⚠️', 'Booking site sync problem'],
  sys_rate_warning: ['problems', '⚠️', 'Price warning from a booking site'],
  sys_non_acked: ['problems', '⚠️', 'A booking was not confirmed to the booking site'],
  sys_channel_disconnected: ['problems', '🔌', 'A booking site is disconnected'],
  sys_health: ['problems', '🩺', 'System health needs a look']
};
const OTHER = ['problems', '🔔', 'Something changed'];
const SITE = { airbnb: 'Airbnb', booking: 'Booking.com', agoda: 'Agoda', expedia: 'Expedia', trip: 'Trip.com', vrbo: 'Vrbo', direct: 'Direct', website: 'Website' };
/* booking-site changes that already ring as booking alerts on owners' and ops managers' phones (alert_outbox, 0011) */
const BOOKING_ALERT = new Set(['bk_new', 'bk_request', 'bk_cancelled', 'bk_dates']);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clean = (s, max = 200) => (s === undefined || s === null ? '' : String(s).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max));
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => clean(v[k], 80));
const get = (m, k) => (k && m ? (m instanceof Map ? m.get(k) : m[k]) : undefined);

function when(t) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(String(t || ''));
  return m ? shortDate(m[1]) + (m[2] ? ' ' + m[2] : '') : '';
}
const range = (a, b) => (a && b ? shortDate(a) + ' to ' + shortDate(b) : a ? shortDate(a) : '');

/** What the phone shows for one notification row. ctx {units: Map(id -> property), staff: Map(id -> staff)}. */
export function pushText(row, ctx = {}) {
  const k = KINDS[row.kind] || OTHER, v = isObj(row.vars) ? row.vars : {}, kind = row.kind;
  const unit = (id) => { const p = get(ctx.units, id); return p ? clean(p.short || p.unitNo || p.name, 60) : ''; };
  const staffName = (id) => { const s = get(ctx.staff, id); return s ? clean(s.name, 60) : ''; };
  const money = (n) => moneyText(n, 'MYR');
  const tv = Object.assign({}, v, {
    guest: clean(v.guest, 80) || 'Guest', who: staffName(row.actor_staff) || 'the team',
    chat: v.chat || (v.chatKind === 'all' ? 'Everyone' : 'Chat'), staff: staffName(v.staff) || v.staff || '',
    title: v.title || 'Task', type: v.type || 'Other', from: v.from || ''
  });
  let title = kind === 'gst_msg' && Number(v.count) > 1 ? v.count + ' new messages from ' + tv.guest : fill(k[2], tv);
  const bits = [];
  if (kind === 'gst_msg') bits.push(unit(v.unit), v.text || (v.type === 'voice' ? 'Voice message' : v.type === 'image' ? 'Photo' : ''));
  else if (kind === 'team_msg') bits.push([v.from ? staffName(v.from) || v.from : '', v.text].filter(Boolean).join(': '));
  else if (kind === 'review_new') bits.push(SITE[v.site] || v.site, v.stars ? v.stars + '★' : v.score ? v.score + '/10' : '', v.text);
  else if (/^task_|^damage_|^gst_request$/.test(kind)) {
    bits.push(unit(v.unit));
    if (kind === 'task_done' && v.doneBy) bits.push('by ' + (staffName(v.doneBy) || v.doneBy));
    else if (kind === 'task_changed' && v.oldDue && v.due && v.oldDue !== v.due) bits.push(when(v.oldDue) + ' → ' + when(v.due));
    else if (v.due) bits.push('due ' + when(v.due));
    const to = (Array.isArray(v.to) ? v.to : []).map(staffName).filter(Boolean);
    if (to.length && kind !== 'task_done') bits.push(to.join(', '));
    bits.push(v.text);
  } else if (kind === 'daily_summary') bits.push((v.inHouse || 0) + ' guests staying');
  else if (kind === 'stock_low') bits.push((v.qty == null ? '?' : v.qty) + ' left (reorder at ' + (v.reorder == null ? '?' : v.reorder) + ')');
  else if (kind === 'expense_new') bits.push(money(v.amount), unit(v.unit), v.text);
  else if (kind === 'owner_msg' || kind === 'msg_failed' || /^sys_/.test(kind)) bits.push(unit(v.unit), v.step, v.text || v.error);
  else if (kind === 'avail_block' || kind === 'avail_open') bits.push(unit(v.unit), range(v.from, v.to), v.text);
  else if (kind === 'staff_joined') bits.push(v.role);
  else if (kind !== 'rates_changed') {
    if (kind === 'bk_new' && v.urgent) bits.push('Arriving today');
    bits.push(kind === 'bk_moved' && v.oldUnit ? unit(v.oldUnit) + ' → ' + unit(v.unit) : unit(v.unit));
    if (kind === 'bk_dates' && v.oldIn) bits.push(range(v.oldIn, v.oldOut) + ' → ' + range(v.in, v.out));
    else if (kind === 'bk_nocode' || kind === 'ready_late') bits.push('arrives ' + when(v.at));
    else bits.push(range(v.in, v.out));
    if (kind === 'bk_guests') bits.push((v.oldGuests != null ? v.oldGuests + ' → ' : '') + (v.guests || 0) + ' guests');
    if (kind === 'bk_price') bits.push((v.oldTotal != null ? money(v.oldTotal) + ' → ' : '') + money(v.total));
    if (kind === 'bk_new' || kind === 'bk_request' || kind === 'bk_paid' || kind === 'bk_unpaid') bits.push(money(v.total));
    if (kind === 'bk_paid' && v.method) bits.push(v.method);
    if ((kind === 'bk_invoice' || kind === 'bk_receipt') && v.no) bits.push(v.no);
    if (kind === 'bk_edit' && Array.isArray(v.fields) && v.fields.length) bits.push(v.fields.join(', '));
    if (v.ch) bits.push(SITE[v.ch] || v.ch);
  }
  title = clean(k[1] + ' ' + title, 120);
  return { title, body: clean(bits.map((b) => clean(b, 300)).filter(Boolean).join(' · '), 300) };
}

/** Where tapping it goes in the app (app/native/bridge.js opens it). */
export function pushData(row) {
  const f = isObj(row.ref) ? row.ref : {};
  return { kind: 'bell', nkind: row.kind, nid: row.id, bookingId: f.booking || null, taskId: f.task || null, chatId: f.chat || null, page: f.page || null };
}

/** Should this phone get this row? device {user_id, booking_alerts, notify}; staffOf: Map(user_id -> staff_id). */
export function wants(device, row, staffOf) {
  const n = isObj(device.notify) ? device.notify : null;
  if (!n || !Array.isArray(n.kinds)) return false;                      // the phone has not signed up for bell notifications
  if (row.actor && row.actor === device.user_id) return false;           // your own change
  if (row.kind === 'team_msg') return false;                              // Team chat has its own phone notification
  if (!row.actor && device.booking_alerts && BOOKING_ALERT.has(row.kind)) return false; // a booking alert already rang
  if (!n.kinds.includes(row.kind)) return false;                         // this person's access does not cover it
  const me = staffOf.get(device.user_id) || n.staff || null;
  if (Array.isArray(row.staff) && !(me && row.staff.includes(me))) return false;
  if (/^task_/.test(row.kind) && !n.allTasks) {
    const to = isObj(row.vars) && Array.isArray(row.vars.to) ? row.vars.to : [];
    if (!me || !to.includes(me)) return false;
  }
  return true;
}

/** The Android channel and sound for this row on this phone. */
export function toneFor(device, row) {
  const group = (KINDS[row.kind] || OTHER)[0];
  const n = isObj(device.notify) ? device.notify : {};
  if (Array.isArray(n.quiet) && n.quiet.includes(group)) return { channel: QUIET_CHANNEL, sound: null };
  const type = GROUP_TONE[group] || 'change';
  const tune = TONES.tuneFor(type, device.tones);
  return { channel: TONES.channelId(type, tune), sound: TONES.TUNES[tune].file };
}

export function message(token, device, row, text) {
  const tone = toneFor(device, row);
  const tag = 'n-' + row.id;
  const android = { priority: 'high', notification: { channel_id: tone.channel, tag, notification_priority: tone.sound ? 'PRIORITY_HIGH' : 'PRIORITY_LOW' } };
  if (tone.sound) android.notification.sound = tone.sound;
  const aps = tone.sound ? { sound: tone.sound + '.wav' } : {};
  return {
    token,
    notification: { title: text.title, body: text.body || undefined },
    data: dataStrings(pushData(row)),
    android,
    apns: { headers: { 'apns-priority': tone.sound ? '10' : '5' }, payload: { aps } }
  };
}

async function orgContext(sb, orgId) {
  const [units, staff, members, devices] = await Promise.all([
    records(sb, orgId, 'properties').catch(() => []),
    records(sb, orgId, 'staff').catch(() => []),
    sb.from('members').select('user_id, staff_id, status').eq('org_id', orgId),
    sb.from('push_devices').select('token, user_id, booking_alerts, tones, notify').eq('org_id', orgId).not('notify', 'is', null)
  ]);
  const active = new Map(((members && members.data) || []).filter((m) => m.status === 'active').map((m) => [m.user_id, m.staff_id]));
  return {
    units: new Map(units.map((x) => [x.id, x])),
    staff: new Map(staff.map((x) => [x.id, x])),
    staffOf: active,
    devices: must(devices, 'load phones') || []
  };
}

/**
 * Claim the notifications not pushed yet and send them. opts {budgetMs, now, fetch, pushConfig}.
 * -> {rows, sent, skipped, failed}. A row is claimed (pushed_at set) before sending, so two runs never send it twice.
 */
export async function processNotifyPush(sb, opts = {}) {
  const start = Date.now(), budget = opts.budgetMs || 8000, now = opts.now || Date.now();
  const cfg = opts.pushConfig || pushConfig();
  const out = { rows: 0, sent: 0, skipped: 0, failed: 0 };
  const due = must(await sb.from('notifications').select('id').is('pushed_at', null).order('id').limit(BATCH), 'load notifications') || [];
  if (!due.length) return out;
  const claimed = must(await sb.from('notifications').update({ pushed_at: new Date().toISOString() })
    .in('id', due.map((r) => r.id)).is('pushed_at', null)
    .select('id, org_id, kind, vars, ref, actor, actor_staff, staff, created_at'), 'claim notifications') || [];
  out.rows = claimed.length;
  if (!cfg.configured) { out.skipped = claimed.length; return out; }
  const ctxs = new Map();
  for (const row of claimed.sort((a, b) => a.id - b.id)) {
    if (Date.now() - start > budget || Date.parse(row.created_at) < now - MAX_AGE_MS) { out.skipped++; continue; }
    try {
      if (!ctxs.has(row.org_id)) ctxs.set(row.org_id, await orgContext(sb, row.org_id));
      const ctx = ctxs.get(row.org_id);
      const to = ctx.devices.filter((d) => ctx.staffOf.has(d.user_id) && wants(d, row, ctx.staffOf));
      if (!to.length) { out.skipped++; continue; }
      const text = pushText(row, ctx);
      const r = await fcmSend(sb, cfg, to, (token, d) => message(token, d, row, text), { fetch: opts.fetch });
      out.sent += r.sent;
      if (r.failed.length) { out.failed += r.failed.length; console.error('[notify-push]', row.kind, r.failed[0]); }
    } catch (e) {
      out.failed++;
      console.error('[notify-push]', row.kind, e && e.message ? e.message : String(e));
    }
  }
  return out;
}

/** A test notification to this person's phones (Settings / bell "Send a test"). -> {phones, sent} */
export async function sendNotifyTest(sb, orgId, userId, opts = {}) {
  const cfg = opts.pushConfig || pushConfig();
  if (!cfg.configured) return { phones: 0, sent: 0, why: cfg.invalid ? 'FIREBASE_SERVICE_ACCOUNT in Vercel is not a valid service account key.' : 'The server needs FIREBASE_SERVICE_ACCOUNT in Vercel.' };
  const devices = must(await sb.from('push_devices').select('token, user_id, booking_alerts, tones, notify').eq('org_id', orgId).eq('user_id', userId), 'load phones') || [];
  if (!devices.length) return { phones: 0, sent: 0, why: 'This phone has not signed up for notifications yet.' };
  // a few seconds' wait, so the person can close Orbique and see it arrive in the notification bar
  if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
  const row = { id: 't' + Date.now(), kind: 'bk_new', vars: {}, ref: {} };
  const text = { title: '🔔 Test notification from Orbique', body: 'This is how Orbique notifications arrive on this phone, even when the app is closed.' };
  const r = await fcmSend(sb, cfg, devices, (token, d) => message(token, d, row, text), { fetch: opts.fetch });
  return { phones: devices.length, sent: r.sent, why: r.failed[0] || null };
}
