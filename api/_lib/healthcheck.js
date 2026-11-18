/* System health (Health page, migration 0027): checks every moving part of a workspace, applies the safe automatic fixes
 * the owner switched on, and warns the owner when something turns red. Private module (api/_lib is not an endpoint).
 *
 *   runHealth(sb, orgId, opts)            -> {at, overall: 'ok'|'warn'|'bad', counts, items: [{id, group, name, status, detail, fix?}]}
 *   healthSettings(sb, orgId)             -> {auto: {<fix id>: boolean}, alert: boolean}   (blob healthSettings)
 *   saveHealthSettings(sb, orgId, body)   -> the same, after the owner's change
 *   healthLog(sb, orgId)                  -> [{at, fix, detail}] newest first (blob healthLog, last 100)
 *   applyFix(sb, orgId, fixId, opts)      -> {fix, changed, detail}: one safe fix, run now
 *   autoFix(sb, orgId, items, opts)       -> the fixes done: only fixes switched on, only for items that need them
 *   watchHealth(sb, opts)                 -> {orgs, checked, fixed, alerted}: the minute job calls it; it works at most once
 *                                            every 15 minutes per workspace and tells the owner (email + phone) about newly red items
 *
 * Statuses: ok (working), warn (needs a look soon), bad (broken now), off (not set up, nothing to check).
 * Safe fixes only (they change nothing a guest, a price or an availability depends on):
 *   unstick-queue   clear locks left by a stopped send (sync queue items and building locks older than 10 minutes)
 *   clear-pause     lift a pause or back-off that has run out on a building that is working again
 *   retry-alerts    send again the staff alerts stuck in the queue for 30 minutes or more
 * Everything else (resending guest messages, rates, availability, money, domains) stays a person's decision.
 * Never reads or returns a key; details are plain English.
 */
import { records, blob } from './channex-db.js';
import { alertSettings, emailConfig, pushConfig, sendEmail, sendPush } from './alerts.js';
import { translateConfig } from './translate.js';
import { waConfig } from './whatsapp.js';

const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;
export const WATCH_EVERY_MS = 15 * MIN;
export const FIXES = {
  'unstick-queue': { label: 'Clear stuck sends', about: 'Clears locks left behind by a send that stopped (older than 10 minutes). The send then runs again by itself.' },
  'clear-pause': { label: 'Lift expired pauses', about: 'Lifts a pause or back-off that has run out on a building that is working again.' },
  'retry-alerts': { label: 'Resend stuck alerts', about: 'Sends again the staff alerts (email, WhatsApp, phone) that sat in the queue for 30 minutes or more.' }
};

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clean = (s, max = 200) => (s === undefined || s === null ? '' : String(s).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
const rows = (r) => { if (r && r.error) throw new Error(clean(r.error.message || r.error, 160)); return (r && r.data) || []; };

export function ago(ms) {
  if (!(ms >= 0)) return 'never';
  if (ms < 90 * 1000) return 'just now';
  if (ms < HOUR) return Math.round(ms / MIN) + ' minutes ago';
  if (ms < 2 * DAY) return Math.round(ms / HOUR) + (Math.round(ms / HOUR) === 1 ? ' hour ago' : ' hours ago');
  return Math.round(ms / DAY) + ' days ago';
}

const item = (id, group, name, status, detail, fix) => Object.assign({ id, group, name, status, detail: clean(detail, 400) }, fix ? { fix } : {});
/** MYT wall-clock text ("2026-11-16T16:27") to a time. */
const myt = (s) => { const t = Date.parse(String(s || '') + ':00+08:00'); return Number.isFinite(t) ? t : NaN; };
const worst = (items) => (items.some((i) => i.status === 'bad') ? 'bad' : items.some((i) => i.status === 'warn') ? 'warn' : 'ok');

/* ---------- settings and log ---------- */

export async function healthSettings(sb, orgId) {
  const v = await blob(sb, orgId, 'healthSettings').catch(() => null);
  const have = isObj(v) && isObj(v.auto) ? v.auto : {};
  const auto = {};
  for (const id of Object.keys(FIXES)) auto[id] = have[id] !== false;      // the safe fixes are on until the owner switches one off
  return { auto, alert: !(isObj(v) && v.alert === false) };
}

export async function saveHealthSettings(sb, orgId, body) {
  const cur = await healthSettings(sb, orgId);
  const next = { auto: Object.assign({}, cur.auto), alert: cur.alert };
  if (isObj(body && body.auto)) for (const id of Object.keys(FIXES)) if (typeof body.auto[id] === 'boolean') next.auto[id] = body.auto[id];
  if (typeof (body && body.alert) === 'boolean') next.alert = body.alert;
  const r = await sb.from('blobs').upsert({ org_id: orgId, key: 'healthSettings', data: { v: next } }, { onConflict: 'org_id,key' });
  if (r.error) throw new Error('Could not save: ' + clean(r.error.message, 120));
  return next;
}

export async function healthLog(sb, orgId) {
  const v = await blob(sb, orgId, 'healthLog').catch(() => null);
  return Array.isArray(v) ? v.filter(isObj).slice(0, 100) : [];
}

async function logFix(sb, orgId, fix, detail, now) {
  const cur = await healthLog(sb, orgId);
  cur.unshift({ at: new Date(now).toISOString(), fix, detail: clean(detail, 200) });
  await sb.from('blobs').upsert({ org_id: orgId, key: 'healthLog', data: { v: cur.slice(0, 100) } }, { onConflict: 'org_id,key' });
}

/* ---------- the checks ---------- */

async function checkDatabase(c) {
  const t0 = Date.now();
  rows(await c.sb.from('blobs').select('key').eq('org_id', c.orgId).limit(1));
  const ms = Date.now() - t0;
  return [item('database', 'core', 'Database', ms > 4000 ? 'warn' : 'ok', ms > 4000 ? 'Answering slowly (' + ms + ' ms).' : 'Answering normally (' + ms + ' ms).')];
}

async function checkJobs(c) {
  const out = [];
  let cron = null;
  const r = await c.sb.rpc('health_cron');
  if (!r.error && Array.isArray(r.data)) cron = r.data;
  if (cron && cron.length) {
    for (const j of cron) {
      const tick = /tick/.test(j.jobname);
      const last = Date.parse(j.last_start || '');
      const age = c.now - last;
      const limit = tick ? [3 * MIN, 10 * MIN] : [26 * HOUR, 50 * HOUR];
      let status = !j.active ? 'bad' : !Number.isFinite(last) ? 'bad' : j.last_status && j.last_status !== 'succeeded' ? 'bad' : age <= limit[0] ? 'ok' : age <= limit[1] ? 'warn' : 'bad';
      const what = tick ? 'Minute job (sends, syncs, timed messages, alerts)' : 'Nightly job (rates, chats, tokens, clean-up)';
      out.push(item('job-' + (tick ? 'tick' : 'nightly'), 'core', what, status,
        !j.active ? 'Switched off in the database.' : Number.isFinite(last) ? 'Last ran ' + ago(age) + (j.last_status && j.last_status !== 'succeeded' ? ', and it failed.' : '.') : 'Has never run.'));
    }
    const n = await c.sb.rpc('health_net');
    if (!n.error && Array.isArray(n.data) && n.data.length) {
      const bad = n.data.filter((x) => x.timed_out || (x.status_code && x.status_code !== 200)).length;
      const last = n.data[0];
      out.push(item('worker-answers', 'core', 'The app answering the minute job', bad === 0 ? 'ok' : bad >= 3 || last.status_code !== 200 ? 'bad' : 'warn',
        bad === 0 ? 'The last ' + plural(n.data.length, 'call') + ' were answered.' : bad + ' of the last ' + n.data.length + ' calls failed (latest: ' + (last.timed_out ? 'timed out' : 'code ' + last.status_code) + ').'));
    }
  } else {
    // no schedule readable (before the 0027 update, or a plain database): judge from the sync's own heartbeat
    const live = rows(await c.sb.from('channex_properties').select('updated_at').eq('org_id', c.orgId).eq('status', 'live')).map((p) => Date.parse(p.updated_at));
    if (live.length) {
      const age = c.now - Math.max(...live);
      out.push(item('job-tick', 'core', 'Minute job (sends, syncs, timed messages, alerts)', age <= 10 * MIN ? 'ok' : age <= 30 * MIN ? 'warn' : 'bad', 'The sync last ran ' + ago(age) + '.'));
    } else out.push(item('job-tick', 'core', 'Minute job', 'off', 'No connected booking sites to judge it by.'));
  }
  out.push(item('version', 'core', 'App version', 'ok', c.env.VERCEL_GIT_COMMIT_SHA ? 'Running release ' + String(c.env.VERCEL_GIT_COMMIT_SHA).slice(0, 7) + '.' : 'Release number not known here.'));
  return out;
}

async function checkChannels(c) {
  const props = rows(await c.sb.from('channex_properties').select('channex_property_id, status, paused_until, backoff_level, last_error, last_error_at, lease_until, channels, updated_at').eq('org_id', c.orgId))
    .filter((p) => p.status === 'live');
  if (!props.length) return [item('channels', 'channels', 'Booking sites', 'off', 'No booking site is connected through the channel manager.')];
  const out = [];
  for (const p of props) {
    const errAge = c.now - Date.parse(p.last_error_at || '');
    const paused = p.paused_until && Date.parse(p.paused_until) > c.now;
    let status = 'ok', detail = 'Syncing normally.', fix;
    if (Number.isFinite(errAge) && errAge < HOUR && p.last_error) { status = 'bad'; detail = 'The last send failed ' + ago(errAge) + ': ' + clean(p.last_error, 160); }
    else if (paused) { status = 'warn'; detail = 'Paused until ' + new Date(p.paused_until).toISOString().slice(11, 16) + ' UTC after errors.'; }
    else if (p.backoff_level > 0) { status = 'warn'; detail = 'Slowed down after earlier errors.'; }
    if (!paused && (p.paused_until || p.backoff_level > 0) && (!Number.isFinite(errAge) || errAge > 30 * MIN)) fix = 'clear-pause';
    out.push(item('sync-' + p.channex_property_id, 'channels', 'Sync to booking sites', status, detail, fix));
    for (const ch of Array.isArray(p.channels) ? p.channels : []) {
      if (!isObj(ch)) continue;
      out.push(item('channel-' + clean(ch.id, 40), 'channels', clean(ch.title || ch.channel, 80), ch.isActive === false ? 'bad' : 'ok', ch.isActive === false ? 'Switched off in the channel manager, so it gets no rates or bookings.' : 'Connected and active.'));
    }
  }
  // the send queue
  const q = rows(await c.sb.from('channex_outbox').select('created_at, claimed_at').eq('org_id', c.orgId).limit(500));
  const oldest = q.length ? Math.max(...q.map((x) => c.now - Date.parse(x.created_at))) : 0;
  const stuck = q.filter((x) => x.claimed_at && c.now - Date.parse(x.claimed_at) > 10 * MIN).length;
  const lease = props.filter((p) => p.lease_until && c.now - Date.parse(p.lease_until) > 10 * MIN).length;
  out.push(item('queue', 'channels', 'Waiting to be sent to booking sites', stuck || lease ? 'warn' : oldest > 45 * MIN ? 'bad' : oldest > 10 * MIN ? 'warn' : 'ok',
    stuck || lease ? plural(stuck + lease, 'send') + ' held by a lock that never cleared.' : q.length ? plural(q.length, 'change') + ' waiting; the oldest for ' + ago(oldest).replace(' ago', '') + '.' : 'Nothing waiting.',
    stuck || lease ? 'unstick-queue' : undefined));
  // problems the sync itself raised
  const al = rows(await c.sb.from('channex_alerts').select('kind, message').eq('org_id', c.orgId).is('resolved_at', null).limit(50));
  const by = {};
  al.forEach((a) => { by[a.kind] = (by[a.kind] || 0) + 1; });
  const names = { rate_warning: 'rates or availability a booking site refused', needs_unit: 'arrivals within 48 hours with no unit assigned' };
  const kinds = Object.keys(by);
  out.push(item('sync-alerts', 'channels', 'Open sync problems', kinds.length ? 'warn' : 'ok',
    kinds.length ? kinds.map((k) => by[k] + ' × ' + (names[k] || k.replace(/_/g, ' '))).join('; ') + '. Open Channels to see them.' : 'None.'));
  // rates in another currency (Vrbo): the nightly exchange rate
  const plans = await records(c.sb, c.orgId, 'ratePlans', (x) => x.not('data->>currency', 'is', null)).catch(() => []);
  if (plans.some((p) => p.currency && p.currency !== 'MYR' && !p.archived)) {
    const fx = await blob(c.sb, c.orgId, 'fxRates').catch(() => null);
    const age = fx && fx.at ? c.now - Date.parse(fx.at) : NaN;
    out.push(item('fx', 'channels', 'Exchange rate for other-currency prices', !Number.isFinite(age) ? 'bad' : age > 54 * HOUR ? 'bad' : age > 30 * HOUR ? 'warn' : 'ok',
      Number.isFinite(age) ? 'Updated ' + ago(age) + '. Without a rate under 7 days old, those nights stop selling.' : 'No exchange rate saved: those nights are not being sold.'));
  }
  return out;
}

async function checkInbound(c) {
  const mails = rows(await c.sb.from('inbound_emails').select('received_at, status, error').eq('org_id', c.orgId).order('received_at', { ascending: false }).limit(60));
  const addr = rows(await c.sb.from('inbound_addresses').select('address').eq('org_id', c.orgId));
  if (!addr.length) return [item('mail-in', 'messages', 'Booking emails coming in', 'off', 'No booking email address is set up yet.')];
  const lastAt = mails.length ? c.now - Date.parse(mails[0].received_at) : NaN;
  const failed = mails.filter((m) => m.status === 'failed' && c.now - Date.parse(m.received_at) < 3 * DAY);
  let status = 'ok', detail = 'Last email arrived ' + ago(lastAt) + '.';
  if (!mails.length) { status = 'warn'; detail = 'No email has arrived yet.'; }
  else if (lastAt > 96 * HOUR) { status = 'bad'; detail = 'Nothing has arrived for ' + ago(lastAt).replace(' ago', '') + '. Check that the email domain is verified (Email sending below).'; }
  else if (lastAt > 36 * HOUR) { status = 'warn'; detail = 'Nothing has arrived for ' + ago(lastAt).replace(' ago', '') + '.'; }
  if (failed.length) { status = status === 'bad' ? 'bad' : 'warn'; detail += ' ' + plural(failed.length, 'email') + ' could not be read in the last 3 days.'; }
  return [item('mail-in', 'messages', 'Booking emails coming in', status, detail)];
}

async function checkResend(c) {
  const em = emailConfig(c.env);
  if (!em.configured) return [item('mail-out', 'messages', 'Email sending', 'off', 'Email is not set up (RESEND_API_KEY and ALERT_EMAIL_FROM).')];
  const key = String(c.env.RESEND_API_KEY || '').trim();
  const res = await c.fetch('https://api.resend.com/domains', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(6000) });
  if (res.status === 401 || res.status === 403) {
    const body = await res.json().catch(() => ({}));
    const sendOnly = /restricted/i.test(String(body && (body.name || body.message) || ''));
    return [item('mail-out', 'messages', 'Email sending', sendOnly ? 'ok' : 'bad', sendOnly ? 'Key is set (it can only send, so the domains cannot be listed here).' : 'The email service does not accept the key.')];
  }
  if (!res.ok) return [item('mail-out', 'messages', 'Email sending', 'warn', 'The email service answered ' + res.status + ' when asked about domains.')];
  const body = await res.json().catch(() => ({}));
  const list = Array.isArray(body.data) ? body.data : [];
  if (!list.length) return [item('mail-out', 'messages', 'Email sending', 'warn', 'No sending domain is added at the email service.')];
  return list.map((d) => {
    const ok = d.status === 'verified';
    return item('domain-' + clean(d.name, 60), 'messages', 'Email domain ' + clean(d.name, 60), ok ? 'ok' : 'bad',
      ok ? 'Verified: sending and receiving work.' : 'Status "' + clean(d.status, 30) + '": the email service will refuse mail from it until it verifies again. Confirm the owner email the registrar sent, or re-check the domain in the email service.');
  });
}

async function checkTimed(c) {
  const recs = await records(c.sb, c.orgId, 'journeySent', (q) => q.eq('data->>state', 'failed')).catch(() => []);
  const recent = recs.filter((r) => c.now - myt(r.at) < 3 * DAY);
  if (!recent.length) return [item('timed', 'messages', 'Timed guest messages', 'ok', 'No message failed in the last 3 days.')];
  const why = {};
  recent.forEach((r) => { const k = clean(r.error, 120) || 'unknown'; why[k] = (why[k] || 0) + 1; });
  const top = Object.keys(why).sort((a, b) => why[b] - why[a])[0];
  return [item('timed', 'messages', 'Timed guest messages', 'bad', plural(recent.length, 'message') + ' could not be sent in the last 3 days. Most common reason: ' + top + '. Resending is your decision: open Inbox, check the guest and send it by hand.')];
}

async function checkAlerts(c) {
  const out = [];
  const set = await alertSettings(c.sb, c.orgId);
  const pend = rows(await c.sb.from('alert_outbox').select('created_at, next_at, attempts, last_error').eq('org_id', c.orgId).is('finished_at', null).limit(200));
  const late = pend.filter((x) => c.now - Date.parse(x.next_at) > 30 * MIN);
  out.push(item('alerts', 'messages', 'Booking alerts to staff', late.length ? 'warn' : 'ok',
    late.length ? plural(late.length, 'alert') + ' stuck in the queue for 30 minutes or more.' : pend.length ? plural(pend.length, 'alert') + ' being sent.' : 'Nothing stuck.', late.length ? 'retry-alerts' : undefined));
  const dev = rows(await c.sb.from('push_devices').select('token').eq('org_id', c.orgId).eq('booking_alerts', true));
  const push = pushConfig(c.env);
  out.push(item('phones', 'messages', 'Phone alerts', !push.configured ? 'off' : dev.length ? 'ok' : 'warn',
    !push.configured ? 'Phone alerts are not set up on the server.' : dev.length ? plural(dev.length, 'phone') + ' registered for booking alerts.' : 'No phone is registered: sign in on the phone app as the owner or an ops manager.'));
  out.push(item('alert-email', 'messages', 'Alert email addresses', set.emails.length ? 'ok' : 'off', set.emails.length ? plural(set.emails.length, 'address', 'addresses') + ' get booking alerts.' : 'No alert email address is set (Automations).'));
  return out;
}

async function checkWhatsApp(c) {
  const cfg = waConfig(c.env);
  const num = rows(await c.sb.from('whatsapp_numbers').select('phone_number_id').eq('org_id', c.orgId).limit(1));
  if (!cfg.configured) return [item('whatsapp', 'messages', 'WhatsApp', 'off', 'WhatsApp is not set up on the server yet.')];
  return [item('whatsapp', 'messages', 'WhatsApp', num.length ? 'ok' : 'off', num.length ? 'A number is connected.' : 'Set up on the server, but no number is connected to this workspace.')];
}

async function checkTranslation(c) {
  const cfg = translateConfig(c.env);
  if (!cfg.configured) return [item('translate', 'guests', 'Translation', 'off', 'Translation is not set up (ANTHROPIC_API_KEY).')];
  if (!/^[\x21-\x7E]+$/.test(cfg.key)) return [item('translate', 'guests', 'Translation', 'bad', 'The key in Vercel has a stray space, line break or odd character. Paste ANTHROPIC_API_KEY again and redeploy.')];
  const last = rows(await c.sb.from('team_message_translations').select('created_at').order('created_at', { ascending: false }).limit(1));
  const when = last.length ? ' Last translation made ' + ago(c.now - Date.parse(last[0].created_at)) + '.' : ' No message translated yet.';
  return [item('translate', 'guests', 'Translation', 'ok', 'The key is well formed.' + when)];
}

async function checkMoney(c) {
  const key = String(c.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) return [item('stripe', 'money', 'Card payments (Stripe)', 'off', 'Not set up: the website takes bookings through WhatsApp.')];
  const res = await c.fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(6000) });
  const hook = String(c.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (res.status === 401) return [item('stripe', 'money', 'Card payments (Stripe)', 'bad', 'Stripe does not accept the key.')];
  if (!res.ok) return [item('stripe', 'money', 'Card payments (Stripe)', 'warn', 'Stripe answered ' + res.status + '.')];
  return [item('stripe', 'money', 'Card payments (Stripe)', hook ? 'ok' : 'warn', hook ? 'The key works and the payment webhook is set.' : 'The key works, but the payment webhook secret is missing, so paid bookings will not confirm by themselves.')];
}

async function checkWebsite(c) {
  const live = await blob(c.sb, c.orgId, 'siteContentLive').catch(() => null);
  if (!live) return [item('website', 'website', 'Website', 'off', 'No website has been published from this workspace.')];
  const out = [];
  const draft = await blob(c.sb, c.orgId, 'siteContent').catch(() => null);
  const dv = draft && num(draft.version), lv = live.content && num(live.content.version);
  out.push(item('website-publish', 'website', 'Website changes', dv !== null && lv !== null && dv > lv ? 'warn' : 'ok',
    dv !== null && lv !== null && dv > lv ? 'There are edits in Live Website that are not published yet.' : 'The published site matches your edits.'));
  const url = String(c.env.HEALTH_SITE_URL || 'https://www.staykozi.my').trim();
  const res = await c.fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(7000) });
  out.push(item('website-up', 'website', 'Website reachable', res.ok ? 'ok' : 'bad', res.ok ? url.replace(/^https?:\/\//, '') + ' answers normally.' : url.replace(/^https?:\/\//, '') + ' answered ' + res.status + '.'));
  return out;
}

const CHECKS = [
  ['database', 'core', 'Database', checkDatabase], ['jobs', 'core', 'Background jobs', checkJobs], ['channels', 'channels', 'Booking sites', checkChannels],
  ['inbound', 'messages', 'Booking emails coming in', checkInbound], ['resend', 'messages', 'Email sending', checkResend], ['timed', 'messages', 'Timed guest messages', checkTimed],
  ['alerts', 'messages', 'Staff alerts', checkAlerts], ['whatsapp', 'messages', 'WhatsApp', checkWhatsApp], ['translate', 'guests', 'Translation', checkTranslation],
  ['money', 'money', 'Card payments', checkMoney], ['website', 'website', 'Website', checkWebsite]
];

/** Runs every check; a check that itself breaks shows as one red row, never as a crash. */
export async function runHealth(sb, orgId, opts = {}) {
  const c = { sb, orgId, now: opts.now || Date.now(), env: opts.env || process.env, fetch: opts.fetch || globalThis.fetch };
  const results = await Promise.all(CHECKS.map(async ([id, group, name, fn]) => {
    try { return await fn(c); } catch (e) {
      return [item('check-' + id, group, name, 'bad', 'This check could not run: ' + clean(e && e.message, 160))];
    }
  }));
  const items = results.flat();
  const counts = { ok: 0, warn: 0, bad: 0, off: 0 };
  items.forEach((i) => { counts[i.status] = (counts[i.status] || 0) + 1; });
  return { at: new Date(c.now).toISOString(), overall: worst(items), counts, items };
}

/* ---------- the safe fixes ---------- */

const FIX_RUN = {
  'unstick-queue': async (c) => {
    const cut = new Date(c.now - 10 * MIN).toISOString();
    const a = rows(await c.sb.from('channex_outbox').update({ claimed_at: null }).eq('org_id', c.orgId).lt('claimed_at', cut).select('id'));
    const b = rows(await c.sb.from('channex_properties').update({ lease_until: null }).eq('org_id', c.orgId).lt('lease_until', cut).select('channex_property_id'));
    return { changed: a.length + b.length, detail: 'Cleared ' + plural(a.length, 'stuck send') + ' and ' + plural(b.length, 'building lock') + '.' };
  },
  'clear-pause': async (c) => {
    const nowIso = new Date(c.now).toISOString();
    const cut = new Date(c.now - 30 * MIN).toISOString();
    const a = rows(await c.sb.from('channex_properties').update({ paused_until: null, backoff_level: 0 }).eq('org_id', c.orgId).eq('status', 'live').or('paused_until.lt.' + nowIso + ',backoff_level.gt.0').or('last_error_at.is.null,last_error_at.lt.' + cut).select('channex_property_id'));
    return { changed: a.length, detail: 'Lifted the pause or back-off on ' + plural(a.length, 'building') + '.' };
  },
  'retry-alerts': async (c) => {
    const nowIso = new Date(c.now).toISOString();
    const a = rows(await c.sb.from('alert_outbox').update({ next_at: nowIso }).eq('org_id', c.orgId).is('finished_at', null).lt('next_at', new Date(c.now - 30 * MIN).toISOString()).gt('created_at', new Date(c.now - 2 * DAY).toISOString()).select('id'));
    return { changed: a.length, detail: 'Queued ' + plural(a.length, 'stuck alert') + ' to go out again.' };
  }
};

export async function applyFix(sb, orgId, fixId, opts = {}) {
  if (!FIX_RUN[fixId]) throw new Error('Unknown fix.');
  const c = { sb, orgId, now: opts.now || Date.now() };
  const r = await FIX_RUN[fixId](c);
  if (r.changed) await logFix(sb, orgId, FIXES[fixId].label, r.detail + (opts.by === 'auto' ? ' (automatic)' : ' (you ran it)'), c.now);
  return { fix: fixId, changed: r.changed, detail: r.detail };
}

export async function autoFix(sb, orgId, items, opts = {}) {
  const set = opts.settings || await healthSettings(sb, orgId);
  const wanted = [...new Set(items.filter((i) => i.fix && set.auto[i.fix]).map((i) => i.fix))];
  const done = [];
  for (const id of wanted) {
    try { const r = await applyFix(sb, orgId, id, { now: opts.now, by: 'auto' }); if (r.changed) done.push(r); } catch (e) { console.error('[health] fix', id, e && e.message); }
  }
  return done;
}

/* ---------- the watch (called by the minute job) ---------- */

/** sendEmail and sendPush answer with text: "sent ..." or "skipped: why" / "failed: why". */
const delivered = (r) => typeof r === 'string' ? /^sent/i.test(r) : !!r;

function alertMessage(bad) {
  const lines = bad.slice(0, 6).map((i) => i.name + ': ' + i.detail);
  if (bad.length > 6) lines.push('and ' + (bad.length - 6) + ' more');
  return { title: 'Orbique health check: ' + plural(bad.length, 'thing') + ' not working', lines, text: lines.join('\n') };
}

export async function watchHealth(sb, opts = {}) {
  const now = opts.now || Date.now();
  const props = rows(await sb.from('channex_properties').select('org_id').eq('status', 'live'));
  const orgs = [...new Set(props.map((p) => p.org_id))];
  const out = { orgs: orgs.length, checked: 0, fixed: 0, alerted: 0 };
  for (const orgId of orgs) {
    const st = (await blob(sb, orgId, 'healthState').catch(() => null)) || {};
    if (!opts.force && st.at && now - Date.parse(st.at) < WATCH_EVERY_MS) continue;
    let report = await runHealth(sb, orgId, opts);
    out.checked++;
    const settings = await healthSettings(sb, orgId);
    const fixes = await autoFix(sb, orgId, report.items, { settings, now });
    if (fixes.length) { out.fixed += fixes.length; report = await runHealth(sb, orgId, opts); }
    const bad = report.items.filter((i) => i.status === 'bad');
    const sig = bad.map((i) => i.id).sort().join(',');
    const next = { at: new Date(now).toISOString(), overall: report.overall, sig, notified: st.notified || '' };
    if (settings.alert && sig && sig !== st.notified) {
      const msg = alertMessage(bad);
      let sent = false;
      try {
        const al = await alertSettings(sb, orgId);
        const ec = emailConfig(opts.env || process.env);
        if (ec.configured && al.emails.length) { const r = await (opts.sendEmail || sendEmail)(ec, al.emails, msg, { fetch: opts.fetch }); if (delivered(r)) sent = true; }
        const pc = pushConfig(opts.env || process.env);
        if (pc.configured) { const r = await (opts.sendPush || sendPush)(sb, pc, orgId, msg, { kind: 'health' }, { fetch: opts.fetch }); if (delivered(r)) sent = true; }
      } catch (e) { console.error('[health] alert', e && e.message); }
      if (sent) { next.notified = sig; out.alerted++; }
    } else if (!sig) next.notified = '';
    await sb.from('blobs').upsert({ org_id: orgId, key: 'healthState', data: { v: next } }, { onConflict: 'org_id,key' });
  }
  return out;
}
