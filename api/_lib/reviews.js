/* Booking-site reviews from Channex (the Messaging & Reviews app) in the app's `reviews` records, and replies back.
 * Private module: Vercel does not expose files under api/_lib as endpoints.
 *
 *   reviewRecord(cx, ctx)                  a Channex review (webhook payload or API object) -> the app's review record
 *   saveReview(sb, prop, cx, opts)         store one review (new or updated); a new one also posts a line in the inbox
 *   pullReviews(sb, cfg, prop, opts)       the property's reviews from Channex (setup and catch-up)
 *   replyReview(sb, cfg, orgId, id, text, by)  post the public reply on the booking site, then save it
 *
 * Channex scores are out of 10; the app shows stars out of 5. Reviews from Channex carry cx (the Channex review id),
 * score (out of 10) and ota (Channex's name for the site). The team's reply is kept as {text, date, by}.
 */
import { bad, ApiError } from './http.js';
import { must, record, tracked, todayMY } from './channex-db.js';
import { ChannexError } from './channex.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const clip = (v, n) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)).trim().slice(0, n);

export const PLATFORM = { bookingcom: 'booking', booking: 'booking', airbnb: 'airbnb', expedia: 'expedia', agoda: 'agoda', vrbo: 'vrbo', ctrip: 'tripcom', tripcom: 'tripcom' };
export const platformOf = (ota) => PLATFORM[String(ota || '').toLowerCase().replace(/[^a-z]/g, '')] || 'booking';
const SUB = { clean: 'cleanliness', cleanliness: 'cleanliness', communication: 'communication', checkin: 'checkin', check_in: 'checkin', accuracy: 'accuracy', location: 'location', value: 'value', comfort: 'comfort', facilities: 'facilities', staff: 'staff' };

/** Out of 10 -> stars out of 5 (at least 1). */
export const starsOf = (score) => { const n = Number(score); return Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(5, Math.round(n / 2))) : 5; };

/** The review's fields wherever Channex put them (webhook payload: flat; API: {id, attributes, relationships}). */
export function flat(cx) {
  if (!isObj(cx)) return {};
  const a = isObj(cx.attributes) ? Object.assign({}, cx.attributes) : Object.assign({}, cx);
  a.id = a.id || cx.id;
  const rel = isObj(cx.relationships) ? cx.relationships : {};
  const relId = (k) => (isObj(rel[k]) && isObj(rel[k].data) ? rel[k].data.id : null);
  a.booking_id = a.booking_id || relId('booking');
  a.property_id = a.property_id || relId('property');
  a.channel_id = a.channel_id || relId('channel');
  return a;
}

function contentOf(a) {
  if (typeof a.content === 'string') return a.content;
  const c = isObj(a.content) ? a.content : isObj(a.raw_content) ? a.raw_content : null;
  if (!c) return '';
  const parts = [];
  for (const k of ['headline', 'title', 'public_review', 'positive', 'negative', 'text']) {
    if (typeof c[k] === 'string' && c[k].trim()) parts.push(k === 'positive' ? 'Liked: ' + c[k].trim() : k === 'negative' ? 'Disliked: ' + c[k].trim() : c[k].trim());
  }
  return parts.join('\n');
}

function replyOf(a) {
  const r = a.reply;
  const text = typeof r === 'string' ? r : isObj(r) ? r.reply || r.text || '' : '';
  return text && text.trim() ? text.trim() : '';
}

/**
 * The app's review record for a Channex review.
 *   ctx {booking (Orbique booking or null), propertyId (fallback unit), old (the record already stored, or null), today}
 */
export function reviewRecord(cx, ctx = {}) {
  const a = flat(cx);
  const old = ctx.old || null;
  const b = ctx.booking || null;
  const score = Number(a.overall_score !== undefined && a.overall_score !== null ? a.overall_score : a.ota_overall_score);
  const date = clip(a.received_at || a.ota_inserted_at || a.inserted_at, 10) || ctx.today || todayMY();
  const sub = {};
  const scores = Array.isArray(a.scores) ? a.scores : [];
  for (const s of scores) {
    if (!isObj(s)) continue;
    const k = SUB[String(s.category || '').toLowerCase()];
    const v = Number(s.score !== undefined ? s.score : s.rating);
    if (k && Number.isFinite(v) && v > 0) sub[k] = starsOf(v);
  }
  const replyText = replyOf(a);
  let reply = old && old.reply ? old.reply : null;
  if (replyText && (!reply || reply.text !== replyText)) reply = { text: replyText.slice(0, 4000), date: clip(a.reply_sent_at || a.updated_at, 10) || date, by: reply && reply.by ? reply.by : null };
  const rec = {
    id: (old && old.id) || 'RV-CX-' + String(a.id).replace(/-/g, '').slice(0, 12).toUpperCase(),
    cx: a.id,
    bookingId: b ? b.id : old ? old.bookingId || null : null,
    guest: clip(a.reviewer_name || a.guest_name, 80) || (b && b.guest && b.guest.name) || 'Guest',
    country: (b && b.guest && b.guest.country) || (old && old.country) || '',
    propertyId: (b && b.propertyId) || (old && old.propertyId) || ctx.propertyId || null,
    platform: platformOf(a.ota),
    ota: clip(a.ota, 40) || null,
    stars: starsOf(score),
    score: Number.isFinite(score) ? Math.round(score * 10) / 10 : null,
    date,
    text: clip(contentOf(a), 4000),
    tags: Array.isArray(a.tags) ? a.tags.filter((t) => typeof t === 'string').slice(0, 6).map((t) => t.replace(/^.*?(positive|negative)_/, '').replace(/_/g, ' ')) : (old && old.tags) || [],
    sub: Object.keys(sub).length ? sub : (old && old.sub) || {},
    reply,
    reservationCode: clip(a.ota_reservation_id, 80) || null,
    hidden: a.is_hidden === true
  };
  if (a.expired_at) rec.replyBy = clip(a.expired_at, 10);
  return rec;
}

/* ---------- storing ---------- */

async function bookingFor(sb, orgId, a) {
  if (isUuid(a.booking_id)) {
    const r = must(await sb.from('channex_bookings').select('record_ids').eq('booking_id', a.booking_id).eq('org_id', orgId).maybeSingle(), 'load booking link');
    const id = r && Array.isArray(r.record_ids) ? r.record_ids[0] : null;
    if (id) { const b = await record(sb, orgId, 'bookings', id); if (b) return b; }
  }
  const code = clip(a.ota_reservation_id, 80);
  if (code) {
    const r = must(await sb.from('records').select('id, data').eq('org_id', orgId).eq('coll', 'bookings').eq('deleted', false).eq('data->>reservationCode', code).limit(1), 'find booking');
    if (r && r[0] && isObj(r[0].data)) return Object.assign({}, r[0].data, { id: r[0].id });
  }
  return null;
}

/** A unit in the building, for a review no booking matched (the Reviews page shows a review against a unit). */
async function unitOf(sb, prop) {
  if (!prop.building_id) return null;
  const r = must(await sb.from('records').select('id').eq('org_id', prop.org_id).eq('coll', 'properties').eq('deleted', false).eq('data->>buildingId', String(prop.building_id)).order('id').limit(1), 'find unit');
  return r && r[0] ? r[0].id : null;
}

async function existing(sb, orgId, cxId) {
  const r = must(await sb.from('records').select('id, data').eq('org_id', orgId).eq('coll', 'reviews').eq('deleted', false).eq('data->>cx', String(cxId)).limit(1), 'find review');
  return r && r[0] && isObj(r[0].data) ? Object.assign({}, r[0].data, { id: r[0].id }) : null;
}

/**
 * Store one Channex review for a connected property (prop: a channex_properties row).
 *   opts {notice(sb, orgId, n): post a line in the inbox for a new review (see inbox.js postNotice), today}
 * -> {status: 'stored'|'updated'|'ignored', id?, review?}
 */
export async function saveReview(sb, prop, cx, opts = {}) {
  const a = flat(cx);
  if (!a.id) return { status: 'ignored' };
  const orgId = prop.org_id;
  const old = await existing(sb, orgId, a.id);
  const booking = await bookingFor(sb, orgId, a);
  const propertyId = booking ? null : old && old.propertyId ? null : await unitOf(sb, prop);
  const rec = reviewRecord(cx, { booking, propertyId, old, today: opts.today });
  must(await sb.from('records').upsert({ org_id: orgId, coll: 'reviews', id: rec.id, data: rec, deleted: false }, { onConflict: 'org_id,coll,id' }), 'save review');
  if (!old && opts.notice) {
    const site = { booking: 'Booking.com', airbnb: 'Airbnb', expedia: 'Expedia', agoda: 'Agoda', tripcom: 'Trip.com', vrbo: 'Vrbo' }[rec.platform] || 'A booking site';
    const scoreTxt = rec.score !== null ? (rec.score <= 5 && rec.platform === 'airbnb' ? rec.stars + ' stars' : rec.score + '/10') : rec.stars + ' stars';
    await opts.notice(sb, orgId, {
      bookingId: rec.bookingId, feed: rec.platform, via: rec.platform, xid: 'rv:' + a.id,
      text: `New ${scoreTxt} review on ${site} from ${rec.guest}${rec.text ? ': "' + clip(rec.text, 160) + (rec.text.length > 160 ? '…' : '') + '"' : ''}. Reply on the Reviews page.`,
      link: { page: 'reviews', id: rec.id }
    }).catch((e) => console.error('[reviews] notice:', e && e.message));
  }
  return { status: old ? 'updated' : 'stored', id: rec.id, review: rec };
}

/** The property's reviews, newest first, up to `max` (pages of 100). -> {saved, pages} */
export async function pullReviews(sb, cfg, prop, opts = {}) {
  const max = opts.max || 200;
  let saved = 0, pages = 0;
  for (let page = 1; saved < max && page <= 5; page++) {
    const res = await tracked(sb, cfg, {
      method: 'GET', path: '/reviews', query: { 'filter[property_id]': prop.channex_property_id, 'pagination[page]': page, 'pagination[limit]': 100, order_by: 'received_at', order_direction: 'desc' },
      orgId: prop.org_id, propertyId: prop.channex_property_id, source: 'reviews', byUser: opts.byUser, request: opts.request
    });
    pages++;
    const list = Array.isArray(res && res.data) ? res.data : [];
    for (const r of list) {
      const a = flat(r);
      if (a.property_id && a.property_id !== prop.channex_property_id) continue;
      await saveReview(sb, prop, r, { today: opts.today });
      saved++;
    }
    if (list.length < 100) break;
  }
  return { saved, pages };
}

/**
 * Post (or change) the public reply to a review that came from Channex, then save it on the record.
 * -> the saved review record
 */
export async function replyReview(sb, cfg, orgId, reviewId, text, by, opts = {}) {
  const t = String(text || '').trim();
  if (t.length < 10) throw bad('too-short', 'Write a reply of at least 10 characters first.');
  if (t.length > 4000) throw bad('too-long', 'This reply is too long for the booking site.');
  const r = await record(sb, orgId, 'reviews', String(reviewId || '').slice(0, 80));
  if (!r) throw bad('not-found', 'This review is no longer there. Refresh the page.');
  if (!isUuid(r.cx)) throw bad('not-channex', 'This review did not come from a booking site, so there is nowhere to post the reply.');
  try {
    await tracked(sb, cfg, {
      method: 'POST', path: '/reviews/' + r.cx + '/reply', body: { reply: { reply: t } }, logPayload: { reply: { reply: '[' + t.length + ' characters]' } },
      orgId, propertyId: null, source: 'reviews', byUser: opts.userId, request: opts.request
    });
  } catch (e) {
    if (e instanceof ChannexError) {
      if (e.status === 403) throw bad('reviews-off', 'Reviews are not switched on for this building in Channex yet (the Messaging & Reviews app). Turn it on in Inbox, Settings.');
      if (e.status === 422) throw bad('reply-refused', 'The booking site did not take the reply: ' + e.message + '. Some sites allow a reply only once, or only for a few days after the review.');
      if (e.retryable) throw new ApiError(502, 'channex-unavailable', 'The booking site did not answer. Please try again in a minute.');
      throw new ApiError(502, 'channex-refused', 'The booking site refused the reply: ' + e.message);
    }
    throw e;
  }
  const next = Object.assign({}, r, { reply: { text: t, date: todayMY(), by: by || null } });
  delete next.id;
  must(await sb.from('records').update({ data: Object.assign({ id: r.id }, next) }).eq('org_id', orgId).eq('coll', 'reviews').eq('id', r.id), 'save reply');
  return Object.assign({ id: r.id }, next);
}

