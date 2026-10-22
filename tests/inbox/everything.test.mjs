/* Everything into the inbox: booking email (Resend Inbound), Channex notifications and reviews.
 *
 *   node --test tests/inbox/*.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifySvix, classify, htmlText, bodyText, codeIn, stripQuoted, matchBooking, slugOf, addresses, receiveEmail, inboundConfig, addressFor } from '../../api/_lib/email-in.js';
import { reviewRecord, starsOf, platformOf } from '../../api/_lib/reviews.js';
import { postNotice, receiveChannex, sendReply, canInbox } from '../../api/_lib/inbox.js';
import { handleEvent } from '../../api/email-inbound.js';
import { fakeSb, op } from './fake-sb.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const SECRET = 'whsec_' + Buffer.from('a-very-secret-key-for-tests').toString('base64');

function signed(body, ts = Math.floor(Date.now() / 1000), id = 'msg_1') {
  const raw = Buffer.from(JSON.stringify(body));
  const sig = createHmac('sha256', Buffer.from(SECRET.slice(6), 'base64')).update(id + '.' + ts + '.' + raw.toString()).digest('base64');
  return { raw, headers: { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': 'v1,bm90LXRoaXM= v1,' + sig } };
}

/* ---------- Resend signature ---------- */

test('svix: the right secret, any listed v1 signature, within 5 minutes', () => {
  const { raw, headers } = signed({ type: 'email.received' });
  assert.equal(verifySvix(SECRET, raw, headers), true);
  assert.equal(verifySvix('whsec_' + Buffer.from('other').toString('base64'), raw, headers), false);
  assert.equal(verifySvix(SECRET, Buffer.from(raw.toString() + ' '), headers), false);
  const old = signed({ type: 'email.received' }, Math.floor(Date.now() / 1000) - 600);
  assert.equal(verifySvix(SECRET, old.raw, old.headers), false);
  assert.equal(verifySvix('', raw, headers), false);
  assert.equal(verifySvix(SECRET, raw, {}), false);
});

test('config: the receiving domain comes from the alert sender when not set', () => {
  const c = inboundConfig({ RESEND_API_KEY: 'k', RESEND_WEBHOOK_SECRET: 's', ALERT_EMAIL_FROM: 'Orbique <alerts@orbiquefms.com>' });
  assert.equal(c.domain, 'orbiquefms.com');
  assert.equal(c.configured, true);
  assert.equal(inboundConfig({ RESEND_API_KEY: 'k' }).configured, false);
});

/* ---------- reading email ---------- */

test('addresses and slugs', () => {
  assert.deepEqual(addresses(['Otto Bookings <Bookings@Otto.com>', 'x@y.co, "A" <b@c.io>']), ['bookings@otto.com', 'x@y.co', 'b@c.io']);
  assert.equal(slugOf('Otto Stays Sdn. Bhd.'), 'otto-stays-sdn-bhd');
  assert.equal(slugOf('Alerts'), 'team');
  assert.equal(slugOf('আলো'), 'team');
});

test('classify: guest relays are messages, booking sites and no-reply senders are notices, people are messages', () => {
  assert.deepEqual(classify({ from: 'Anna <anna.123@guest.booking.com>' }).kind, 'message');
  assert.equal(classify({ from: 'Anna <anna.123@guest.booking.com>' }).platform, 'booking');
  const ag = classify({ from: 'Agoda <no-reply@agoda.com>', reply_to: ['guest-8812@agoda-messaging.com'] });
  assert.equal(ag.kind, 'message'); assert.equal(ag.platform, 'agoda'); assert.equal(ag.replyTo, 'guest-8812@agoda-messaging.com');
  assert.equal(classify({ from: 'Airbnb <automated@airbnb.com>' }).kind, 'notice');
  assert.equal(classify({ from: 'Trip.com <ebooking@trip.com>' }).platform, 'tripcom');
  assert.equal(classify({ from: 'Gmail Team <forwarding-noreply@google.com>' }).kind, 'notice');
  const g = classify({ from: 'John Lee <john@gmail.com>' });
  assert.equal(g.kind, 'message'); assert.equal(g.platform, null); assert.equal(g.name, 'John Lee');
});

test('html to text keeps links and drops scripts; quoted replies are cut', () => {
  const t = htmlText('<style>p{}</style><p>Hello&nbsp;there</p><a href="https://mail.google.com/confirm?x=1">Confirm</a><script>alert(1)</script><br>Bye &amp; thanks');
  assert.match(t, /Hello there/);
  assert.match(t, /Confirm \(https:\/\/mail\.google\.com\/confirm\?x=1\)/);
  assert.doesNotMatch(t, /alert|p\{/);
  assert.match(t, /Bye & thanks/);
  assert.equal(stripQuoted('Thanks, see you at 3pm\n\nOn Mon, 19 Oct 2026 at 10:00, Otto <x@y.com> wrote:\n> earlier'), 'Thanks, see you at 3pm');
  assert.equal(stripQuoted('Yes\n-----Original Message-----\nFrom: a'), 'Yes');
  assert.equal(stripQuoted('> only quoted'), '> only quoted');
});

test('tracking-image links at the top of an email do not push the content out', () => {
  const gif = 'http://www.trip.com/forward/middlepages/channel/openEdm.gif?bizData=' + 'e'.repeat(3000);
  const t = bodyText({ text: '[' + gif + '][' + gif + ']\nYour Trip eBooking verification code is 482913\nHelp [https://trip.com/help]\nOpen https://ebooking.trip.com/x?' + 'q'.repeat(400) });
  assert.match(t, /^Your Trip eBooking verification code is 482913/);
  assert.match(t, /Help \[https:\/\/trip\.com\/help\]/);
  assert.match(t, /Open \(https:\/\/ebooking\.trip\.com\/…\)/);
  assert.ok(t.length < 200);
  assert.equal(bodyText({ text: '', html: '<img src="' + gif + '"><p>Code: 1234</p>' }), 'Code: 1234');
});

test('booking match: reservation number in the subject or text, else the guest email', () => {
  const list = [
    { id: 'BK-1', reservationCode: '5237911320', guest: { name: 'Anna', email: 'anna@x.com' }, status: 'confirmed', checkIn: '2026-12-28' },
    { id: 'BK-2', reservationCode: '1234', guest: { name: 'Bo', email: 'bo@x.com' }, status: 'confirmed', checkIn: '2026-11-01' }
  ];
  assert.equal(matchBooking(list, { subject: 'Booking 5237911320 cancelled', text: '' }).id, 'BK-1');
  assert.equal(matchBooking(list, { subject: 'ref 15237911320', text: '' }), null);
  assert.equal(matchBooking(list, { subject: 'Hi', text: 'code 1234', from: 'nobody@x.com' }), null); // too short to trust
  assert.equal(matchBooking(list, { subject: 'Hi', text: '', from: 'BO@x.com' }).id, 'BK-2');
});

/* a stand-in for the inbox functions receiveEmail calls */
function convStub() {
  const log = [];
  return {
    log,
    findConv: async (sb, orgId, key, val, bid, extra) => { log.push(['find', key, val, bid, extra]); return 'C-1'; },
    appendMsg: async (sb, orgId, cid, msg, unread) => { log.push(['append', cid, msg, unread]); return { ok: true }; },
    postNotice: async (sb, orgId, n) => { log.push(['notice', n]); return { status: 'stored', conversationId: 'C-F' }; },
    myt: (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 16),
    inboxSettings: async () => ({ lang: 'en', autoTranslate: false }),
    translated: async () => ({})
  };
}
const noBookings = fakeSb({ handler: () => ({ data: [], error: null }) });

test('email in: a direct guest email becomes a guest message answered by email', async () => {
  const k = convStub();
  const r = await receiveEmail(noBookings, ORG, { id: 'e1', from: 'John Lee <john@gmail.com>', subject: 'Parking?', text: 'Is there parking?\n\nOn Sun, Otto wrote:\n> hi', message_id: '<abc@mail.gmail.com>', created_at: '2026-10-19T02:00:00Z', attachments: [{ filename: 'id.pdf', content_disposition: 'attachment' }] }, { conv: k });
  assert.equal(r.status, 'stored'); assert.equal(r.kind, 'message');
  const find = k.log.find((x) => x[0] === 'find');
  assert.deepEqual(find.slice(1, 4), ['em', 'john@gmail.com', null]);
  assert.equal(find[4].kind, 'email'); assert.equal(find[4].emRef, '<abc@mail.gmail.com>'); assert.equal(find[4].emSubject, 'Parking?');
  const app = k.log.find((x) => x[0] === 'append');
  assert.equal(app[2].text, 'Is there parking?'); assert.equal(app[2].via, 'email'); assert.equal(app[2].xid, 'em:e1'); assert.deepEqual(app[2].files, ['id.pdf']); assert.equal(app[3], 1);
});

test('email in: a booking site email is a notification, in the booking it names', async () => {
  const k = convStub();
  const sb = fakeSb({ handler: (t) => ({ data: t === 'records' ? [{ id: 'BK-9', data: { reservationCode: '987654321', status: 'confirmed', guest: { name: 'Mei' } } }] : [], error: null }) });
  const r = await receiveEmail(sb, ORG, { id: 'e2', from: 'Agoda <no-reply@agoda.com>', subject: 'Booking ID 987654321 confirmed', html: '<p>Your guest Mei</p>' }, { conv: k });
  assert.equal(r.kind, 'notice'); assert.equal(r.bookingId, 'BK-9');
  const n = k.log.find((x) => x[0] === 'notice')[1];
  assert.equal(n.bookingId, 'BK-9'); assert.equal(n.feed, 'agoda'); assert.equal(n.text, 'Agoda: Booking ID 987654321 confirmed'); assert.match(n.body, /Your guest Mei/);
});

test('email webhook: unknown address is ignored, a known one is fetched and stored once', async () => {
  const upserts = [];
  let known = false;
  const sb = fakeSb({
    handler: (t, ops) => {
      if (t === 'inbound_addresses') return { data: known ? [{ address: 'otto-ab12@orbiquefms.com', org_id: ORG }] : [], error: null };
      if (t === 'inbound_emails' && ops.some((o) => o[0] === 'upsert')) { upserts.push(ops[0][1]); return { data: [{ email_id: ops[0][1].email_id, status: 'new' }], error: null }; }
      return { data: [], error: null };
    }
  });
  const body = { type: 'email.received', data: { email_id: 'em-77', from: 'bookings@otto.com', to: ['bookings@otto.com'], received_for: ['otto-ab12@orbiquefms.com'], subject: 'Hello' } };
  const k = convStub();
  assert.equal((await handleEvent(sb, body, { cfg: { key: 'k', baseUrl: 'https://resend.test' }, conv: k })).status, 'ignored');
  known = true;
  const fetches = [];
  const fetch = async (url, init) => { fetches.push([url, init.headers.Authorization]); return { ok: true, status: 200, json: async () => ({ id: 'em-77', from: 'Sam <sam@example.org>', subject: 'Hello', text: 'Hi there' }) }; };
  const r = await handleEvent(sb, body, { cfg: { key: 'k', baseUrl: 'https://resend.test' }, fetch, conv: k });
  assert.equal(r.status, 'stored');
  assert.deepEqual(fetches[0], ['https://resend.test/emails/receiving/em-77', 'Bearer k']);
  assert.equal(upserts[1].org_id, ORG);
  assert.equal((await handleEvent(sb, { type: 'email.sent', data: {} }, {})).status, 'ignored');
});

test('email reply: sent from the workspace address with the thread headers, stored as email', async () => {
  const sent = [];
  const fetch = async (url, init) => { sent.push([url, JSON.parse(init.body)]); return { ok: true, status: 200, json: async () => ({ id: 're-1' }) }; };
  const sb = fakeSb({ rpc: (name, args) => ({ data: name === 'inbox_append' ? { messages: [args.p_msg] } : null, error: null }) });
  const conv = { id: 'C-1', em: 'john@gmail.com', emSubject: 'Parking?', emRef: '<abc@mail.gmail.com>', messages: [] };
  const v = await sendReply(sb, { orgId: ORG, conv, booking: null, via: 'email', text: 'Yes, level 5.', fromAddress: 'otto-ab12@orbiquefms.com', fromName: 'Otto', emailConfig: { key: 'k', baseUrl: 'https://resend.test' }, fetch });
  assert.equal(sent[0][0], 'https://resend.test/emails');
  assert.equal(sent[0][1].from, 'Otto <otto-ab12@orbiquefms.com>');
  assert.deepEqual(sent[0][1].to, ['john@gmail.com']);
  assert.equal(sent[0][1].subject, 'Re: Parking?');
  assert.equal(sent[0][1].headers['In-Reply-To'], '<abc@mail.gmail.com>');
  assert.equal(v.messages[0].via, 'email'); assert.equal(v.messages[0].xid, 'em:out:re-1');
  await assert.rejects(sendReply(sb, { orgId: ORG, conv: { id: 'C-2', messages: [] }, via: 'email', text: 'x', fromAddress: 'a@b.com' }), /did not come by email/);
});

/* ---------- notifications ---------- */

test('notices: into the booking chat when there is one, else the platform feed, once', async () => {
  const calls = [];
  const sb = fakeSb({ handler: () => ({ data: [], error: null }), rpc: (name, args) => { calls.push([name, args]); return { data: name === 'inbox_conv' ? 'C-9' : { ok: 1 }, error: null }; } });
  await postNotice(sb, ORG, { bookingId: 'BK-1', feed: 'airbnb', text: 'Hello', xid: 'x1' });
  assert.equal(calls[0][1].p_key, 'nk'); assert.equal(calls[0][1].p_val, 'bk:BK-1'); assert.equal(calls[0][1].p_bid, 'BK-1');
  assert.equal(calls[1][1].p_msg.from, 'system'); assert.equal(calls[1][1].p_unread, 1);
  calls.length = 0;
  await postNotice(sb, ORG, { feed: 'agoda', text: 'Payout sent', subject: 'Payout', body: 'RM 1,000' });
  assert.equal(calls[0][1].p_key, 'feed'); assert.equal(calls[0][1].p_val, 'agoda'); assert.equal(calls[0][1].p_extra.kind, 'feed');
  assert.equal(calls[0][1].p_extra.contact.name, 'Agoda notifications');
  assert.equal(calls[1][1].p_msg.body, 'RM 1,000');
  const dup = fakeSb({ handler: () => ({ data: [{ id: 'C-9' }], error: null }) });
  assert.equal((await postNotice(dup, ORG, { feed: 'agoda', text: 'x', xid: 'x1' })).status, 'duplicate');
});

test('channex: an alteration request lands as a line in the thread; a system sender is not the team', async () => {
  const calls = [];
  const sb = fakeSb({ handler: () => ({ data: null, error: null }), rpc: (name, args) => { calls.push([name, args]); return { data: name === 'inbox_conv' ? 'C-5' : { ok: 1 }, error: null }; } });
  const prop = { org_id: ORG, channex_property_id: '11111111-1111-4111-8111-111111111111' };
  const thread = '22222222-2222-4222-8222-222222222222';
  await receiveChannex(sb, prop, 'alteration_request', { message_thread_id: thread, ota_name: 'AirBNB', guest_name: 'Kim' });
  const app = calls.find((c) => c[0] === 'inbox_append');
  assert.equal(app[1].p_msg.from, 'system'); assert.match(app[1].p_msg.text, /Kim asked Airbnb to change the reservation/);
  calls.length = 0;
  await receiveChannex(sb, prop, 'message', { id: 'm1', message_thread_id: thread, sender: 'system', message: 'Inquiry for 2 guests', ota_name: 'AirBNB' });
  assert.equal(calls.find((c) => c[0] === 'inbox_append')[1].p_msg.from, 'system');
  calls.length = 0;
  await receiveChannex(sb, prop, 'message', { id: 'm2', message_thread_id: thread, sender: 'guest', message: '', attachments: ['/api/v1/attachments/abc.jpg'], ota_name: 'AirBNB' }, { baseUrl: 'https://app.channex.io/api/v1' });
  assert.equal(calls.find((c) => c[0] === 'inbox_append')[1].p_msg.url, 'https://app.channex.io/api/v1/attachments/abc.jpg');
  calls.length = 0;
  await receiveChannex(sb, prop, 'inquiry', { ota_name: 'AirBNB', booking_details: { guest_name: 'Lee', checkin_date: '2026-12-01', checkout_date: '2026-12-04' } });
  assert.equal(calls[0][1].p_key, 'feed'); assert.equal(calls[0][1].p_val, 'airbnb');
});

/* ---------- reviews ---------- */

test('reviews: Channex scores out of 10 become stars, sub-scores and the site', () => {
  assert.equal(starsOf(9.6), 5); assert.equal(starsOf(6), 3); assert.equal(starsOf(1), 1); assert.equal(starsOf(null), 5);
  assert.equal(platformOf('BookingCom'), 'booking'); assert.equal(platformOf('AirBNB'), 'airbnb');
  const r = reviewRecord({ id: 'aaaaaaaa-1111-4111-8111-111111111111', attributes: { ota: 'BookingCom', overall_score: 8.8, content: 'Great view', reviewer_name: 'Anna', received_at: '2026-10-18T10:00:00Z', scores: [{ category: 'clean', score: 10 }, { category: 'location', score: 8 }], reply: null, ota_reservation_id: '5237911320' }, relationships: { booking: { data: { id: 'bbbbbbbb-1111-4111-8111-111111111111' } } } },
    { booking: { id: 'BK-1', propertyId: 'P-1', guest: { name: 'Anna R', country: 'MY' } } });
  assert.equal(r.id, 'RV-CX-AAAAAAAA1111'); assert.equal(r.platform, 'booking'); assert.equal(r.stars, 4); assert.equal(r.score, 8.8);
  assert.equal(r.bookingId, 'BK-1'); assert.equal(r.propertyId, 'P-1'); assert.equal(r.date, '2026-10-18');
  assert.deepEqual(r.sub, { cleanliness: 5, location: 4 }); assert.equal(r.reply, null); assert.equal(r.guest, 'Anna');
  const again = reviewRecord({ id: r.cx, ota: 'BookingCom', overall_score: 8.8, reply: 'Thank you Anna!', reply_sent_at: '2026-10-19T01:00:00Z' }, { old: Object.assign({}, r, { reply: null }) });
  assert.equal(again.id, r.id); assert.equal(again.reply.text, 'Thank you Anna!'); assert.equal(again.propertyId, 'P-1');
  const content = reviewRecord({ id: 'x', ota: 'AirBNB', overall_score: 10, raw_content: { public_review: 'Lovely', negative: 'Slow lift' } }, {});
  assert.equal(content.text, 'Lovely\nDisliked: Slow lift');
});

test('permissions: front desk may reply to reviews, housekeeping may not', async () => {
  const sb = fakeSb({ handler: () => ({ data: null, error: null }) });
  assert.equal(await canInbox(sb, ORG, { status: 'active', role: 'frontdesk' }, 'reviews.reply'), true);
  assert.equal(await canInbox(sb, ORG, { status: 'active', role: 'housekeeping' }, 'reviews.reply'), false);
  assert.equal(await canInbox(sb, ORG, { status: 'active', role: 'housekeeping' }, 'inbox.send'), true);
});

test('email address: replies go from the workspace\'s own address when it has one, else its Orbique one', async () => {
  const org = { id: ORG, name: 'Kozi' };
  const cfg = { domain: 'orbiquepms.com' };
  let rows = [{ address: 'kozi-mtez@orbiquepms.com', kind: 'orbique' }, { address: 'hello@staykozi.com', kind: 'own' }];
  const inserts = [];
  const sb = fakeSb({ handler: (t, ops) => {
    if (t !== 'inbound_addresses') return { data: [], error: null };
    if (ops.some((o) => o[0] === 'insert')) { inserts.push(ops[0][1]); rows = [Object.assign({ kind: 'orbique' }, ops[0][1])]; return { data: [{ address: ops[0][1].address }], error: null }; }
    assert.equal(op(ops, 'eq', 'org_id'), ORG);
    return { data: rows, error: null };
  } });
  assert.equal(await addressFor(sb, cfg, org), 'hello@staykozi.com');
  rows = [{ address: 'kozi-mtez@orbiquepms.com', kind: 'orbique' }];
  assert.equal(await addressFor(sb, cfg, org), 'kozi-mtez@orbiquepms.com');
  rows = [];
  assert.match(await addressFor(sb, cfg, org, 'u1'), /^kozi-[a-z0-9x]{4}@orbiquepms\.com$/);
  assert.equal(inserts.length, 1); assert.equal(inserts[0].kind, undefined);
});

test('a verification code shows without opening the email', () => {
  const body = "(https://www.trip.com/x)\n\nYour eBooking Verification Code\n\nDear Partner\n\nHere's your verification code:\n\n741225\n\nThis code is valid for 10 minutes.\n\n+44-20-3929-3737\nCopyright 2002-2026";
  assert.equal(codeIn('Your Trip eBooking verification code', body), '741225');
  assert.equal(codeIn('Agoda: one-time passcode', 'Your OTP is 4821. It expires soon.'), '4821');
  assert.equal(codeIn('New booking 12345678', 'Booking 12345678 for 2 nights'), null);
  assert.equal(codeIn('Your login code', 'Call us on 2026 or visit'), null);
});
