// Website bookings end to end against an in-memory database: availability, checkout (hold + unit + Stripe session),
// payment (confirmed), an expired session and the worker's clean-up (released), sold out, member sign-in.
//   node --test tests/website.flow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import A from '../api/_lib/shared/assign.cjs';
import { availability, calendar, checkout, stripeEvent, releaseHolds, memberStart, memberVerify, loadSite, bookingStatus } from '../api/_lib/website.js';

process.env.MEMBER_TOKEN_SECRET = 'flow-test-secret';
const ORG = '11111111-2222-4333-8444-555555555555';
const TODAY = '2026-11-01';

/* ---------- a tiny PostgREST-like store: enough of supabase-js for these modules ---------- */
function getPath(row, col) {
  const m = /^(\w+)((?:->>?\w+)*)$/.exec(col);
  if (!m) return row[col];
  let v = row[m[1]];
  const parts = m[2].match(/->>?\w+/g) || [];
  parts.forEach((p, i) => {
    const key = p.replace(/^->>?/, '');
    v = v && typeof v === 'object' ? v[key] : undefined;
    if (p.startsWith('->>') && i === parts.length - 1 && v !== undefined && v !== null && typeof v !== 'string') v = typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
  return v;
}
function fakeDb(tables) {
  let seq = 1;
  const db = { tables, rpcs: {} };
  db.from = (name) => {
    const t = tables[name] || (tables[name] = []);
    const st = { filters: [], mode: 'select', count: false, head: false, single: null, limit: null, range: null, order: null };
    const q = {
      select(cols, o) { if (st.mode === 'select') st.mode = 'select'; if (o && o.count) { st.count = true; st.head = !!o.head; } return q; },
      eq(c, v) { st.filters.push((r) => String(getPath(r, c)) === String(v)); return q; },
      neq(c, v) { st.filters.push((r) => String(getPath(r, c)) !== String(v)); return q; },
      in(c, vs) { st.filters.push((r) => vs.map(String).includes(String(getPath(r, c)))); return q; },
      is(c, v) { st.filters.push((r) => (getPath(r, c) ?? null) === v); return q; },
      lt(c, v) { st.filters.push((r) => getPath(r, c) < v); return q; },
      lte(c, v) { st.filters.push((r) => getPath(r, c) <= v); return q; },
      gt(c, v) { st.filters.push((r) => getPath(r, c) > v); return q; },
      gte(c, v) { st.filters.push((r) => getPath(r, c) >= v); return q; },
      order(c, o) { st.order = [c, !o || o.ascending !== false]; return q; },
      limit(n) { st.limit = n; return q; },
      range(a, b) { st.range = [a, b]; return q; },
      maybeSingle() { st.single = 'maybe'; return q; },
      single() { st.single = 'one'; return q; },
      insert(rows) { st.mode = 'insert'; st.rows = [].concat(rows); return q; },
      upsert(rows, o) { st.mode = 'upsert'; st.rows = [].concat(rows); st.on = (o && o.onConflict ? o.onConflict : 'id').split(','); st.ignore = !!(o && o.ignoreDuplicates); return q; },
      update(patch) { st.mode = 'update'; st.patch = patch; return q; },
      delete() { st.mode = 'delete'; return q; },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); }
    };
    const match = (r) => st.filters.every((f) => f(r));
    function run() {
      if (st.mode === 'insert') { for (const r of st.rows) t.push(Object.assign({ id: r.id ?? seq++, created_at: new Date().toISOString() }, r)); return { data: null, error: null }; }
      if (st.mode === 'upsert') {
        for (const r of st.rows) {
          const i = t.findIndex((x) => st.on.every((k) => String(x[k]) === String(r[k])));
          if (i >= 0) { if (!st.ignore) t[i] = Object.assign({}, t[i], JSON.parse(JSON.stringify(r))); } else t.push(Object.assign({ created_at: new Date().toISOString() }, JSON.parse(JSON.stringify(r))));
        }
        return { data: null, error: null };
      }
      if (st.mode === 'update') { for (const r of t.filter(match)) Object.assign(r, st.patch); return { data: null, error: null }; }
      if (st.mode === 'delete') { for (let i = t.length - 1; i >= 0; i--) if (match(t[i])) t.splice(i, 1); return { data: null, error: null, count: 0 }; }
      let rows = t.filter(match).map((r) => JSON.parse(JSON.stringify(r)));
      if (st.order) rows.sort((a, b) => { const x = getPath(a, st.order[0]), y = getPath(b, st.order[0]); return (x < y ? -1 : x > y ? 1 : 0) * (st.order[1] ? 1 : -1); });
      const count = rows.length;
      if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
      if (st.limit !== null) rows = rows.slice(0, st.limit);
      if (st.head) return { data: null, error: null, count };
      if (st.single) return { data: rows[0] || null, error: st.single === 'one' && !rows[0] ? { message: 'none' } : null };
      return { data: rows, error: null, count };
    }
    return q;
  };
  db.rpc = async (name, args) => {
    if (name === 'channex_type_availability') {
      const live = (c) => tables.records.filter((r) => r.org_id === args.p_org && r.coll === c && !r.deleted).map((r) => Object.assign({}, r.data, { id: r.id }));
      const rows = A.typeAvailability({ unitTypeId: args.p_unit_type, units: live('properties'), bookings: live('bookings'), blocks: live('blocks'), from: args.p_from, to: args.p_to });
      return { data: rows.map((r) => ({ date: r.date, availability: Math.max(0, r.raw), raw: r.raw })), error: null };
    }
    if (name === 'channex_invalidate') return { data: null, error: null };
    throw new Error('unexpected rpc ' + name);
  };
  return db;
}

const rec = (coll, id, data) => ({ org_id: ORG, coll, id, data: Object.assign({ id }, data), deleted: false });
function seed() {
  return fakeDb({
    orgs: [{ id: ORG, status: 'active' }],
    blobs: [
      { org_id: ORG, key: 'website', data: { v: { slug: 'kozi', brand: 'Kozi', emailFrom: 'Kozi <hello@staykozi.com>', publicMarkupPct: 10, types: { standard: { typeId: 'UT-STD', name: 'Standard Suite', plans: { flexible: 'RP-FLEX', nonref: 'RP-NREF' } } } } } },
      { org_id: ORG, key: 'lastMinuteDeal', data: { v: null } }
    ],
    records: [
      rec('unitTypes', 'UT-STD', { name: 'Standard 2-Bedroom Suite', buildingId: 'BD-1' }),
      rec('buildings', 'BD-1', { name: 'Vortex KLCC', address: '56 Jalan Sultan Ismail, 50250 Kuala Lumpur', checkInTime: '15:00', checkOutTime: '11:00' }),
      rec('properties', 'P-411', { unitTypeId: 'UT-STD', unitNo: '41-1', buildingId: 'BD-1' }),
      rec('ratePlans', 'RP-FLEX', { unitTypeId: 'UT-STD', name: 'Flexible', primary: true, defaultRate: 250, minStay: 1 }),
      rec('ratePlans', 'RP-NREF', { unitTypeId: 'UT-STD', name: 'Non-refundable', follows: { planId: 'RP-FLEX', type: 'pct', value: -10 }, defaultRate: 225, minStay: 1 }),
      rec('channelRates', 'CR-RP-FLEX-2026-11', { planId: 'RP-FLEX', month: '2026-11', days: { '2026-11-20': { rate: 300, stopSell: true } } })
    ],
    web_members: [], web_member_codes: [], channex_alerts: []
  });
}

function stripeFake(calls, sessions = {}) {
  return async (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    const m = /\/v1\/checkout\/sessions\/(cs_\w+)(\/expire)?$/.exec(url);
    if (m) {
      if (m[2]) sessions[m[1]] = 'expired';
      return { ok: true, status: 200, json: async () => ({ id: m[1], status: sessions[m[1]] || 'open' }) };
    }
    const id = 'cs_test_' + calls.length;
    return { ok: true, status: 200, json: async () => ({ id, url: 'https://checkout.stripe.com/c/pay/' + id }) };
  };
}
const STRIPE = { configured: true, key: 'sk_test_x', baseUrl: 'https://api.stripe.test' };
const booking = (db, id) => { const r = db.tables.records.find((x) => x.coll === 'bookings' && x.id === id); return r && r.data; };
const guest = { name: 'Ana Lim', email: 'ana@example.com', phone: '+60 12 345 6789', country: 'SG' };

test('availability and calendar: prices, member vs public, the prime night sells non-refundable', async () => {
  const db = seed();
  const site = await loadSite(db, 'kozi');
  const a = await availability(db, site, { in: '2026-11-10', out: '2026-11-12', guests: '5' }, { today: TODAY });
  const t = a.types[0];
  assert.equal(t.type, 'standard');
  assert.equal(t.available, true);
  assert.equal(t.memberTotal, 620);   // 2 x 250 + 2 x 60 extra bed
  assert.equal(t.publicTotal, 670);   // 2 x 275 + 120
  const p = await availability(db, site, { in: '2026-11-20', out: '2026-11-21', guests: '2' }, { today: TODAY });
  assert.equal(p.types[0].plan, 'nonref');
  assert.equal(p.types[0].memberTotal, 270);
  const c = await calendar(db, site, { type: 'standard', from: '2026-11-19', to: '2026-11-21' }, { today: TODAY });
  assert.deepEqual(c.days.map((d) => [d.date, d.member, d.refundable]), [['2026-11-19', 250, true], ['2026-11-20', 270, false], ['2026-11-21', 250, true]]);
  await assert.rejects(loadSite(db, 'other'), /Unknown website/);
});

test('checkout holds the nights and opens Stripe; payment confirms; a second guest finds it sold out', async () => {
  const db = seed();
  const site = await loadSite(db, 'kozi');
  const calls = [];
  const out = await checkout(db, site, { type: 'standard', in: '2026-11-10', out: '2026-11-12', guests: 2, guest }, { today: TODAY, origin: 'https://staykozi.my', stripe: STRIPE, fetch: stripeFake(calls) });
  assert.match(out.url, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(out.price, 'public');
  assert.equal(out.total, 550);
  const body = decodeURIComponent(calls[0].body);
  assert.match(body, /line_items\[0\]\[price_data\]\[unit_amount\]=55000/);
  assert.match(body, /success_url=https:\/\/staykozi\.my\/booking\/thank-you\?booking=BK-/);
  let b = booking(db, out.bookingId);
  assert.equal(b.status, 'pending');
  assert.equal(b.webHold, true);
  assert.equal(b.propertyId, 'P-411');
  assert.equal(b.channel, 'direct');
  assert.equal(b.web.session, 'cs_test_1');
  assert.ok(b.doorCode && b.guestToken);

  // the held nights are no longer free for anyone else
  await assert.rejects(checkout(db, site, { type: 'standard', in: '2026-11-11', out: '2026-11-13', guests: 2, guest: Object.assign({}, guest, { email: 'bo@example.com' }) }, { today: TODAY, origin: 'https://staykozi.my', stripe: STRIPE, fetch: stripeFake(calls) }), /just booked/);

  const paid = await stripeEvent(db, { type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', amount_total: 55000, payment_intent: 'pi_1', metadata: { booking_id: out.bookingId, org_id: ORG } } } });
  assert.equal(paid.status, 'confirmed');
  b = booking(db, out.bookingId);
  assert.equal(b.status, 'confirmed');
  assert.equal(b.webHold, undefined);
  assert.equal(b.payMethod, 'Card online (Stripe)');
  assert.equal(b.web.paymentIntent, 'pi_1');
  // the same event again changes nothing
  assert.equal((await stripeEvent(db, { type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', amount_total: 55000, metadata: { booking_id: out.bookingId, org_id: ORG } } } })).status, 'already');
});

test('an expired session and the worker release the hold; a late payment takes the nights back', async () => {
  const db = seed();
  const site = await loadSite(db, 'kozi');
  const calls = [];
  const opts = { today: TODAY, origin: 'https://staykozi.my', stripe: STRIPE, fetch: stripeFake(calls) };
  const one = await checkout(db, site, { type: 'standard', in: '2026-11-10', out: '2026-11-12', guests: 2, guest }, opts);
  assert.equal((await stripeEvent(db, { type: 'checkout.session.expired', data: { object: { id: 'cs_test_1', metadata: { booking_id: one.bookingId, org_id: ORG } } } })).status, 'released');
  assert.equal(booking(db, one.bookingId).status, 'cancelled');

  const two = await checkout(db, site, { type: 'standard', in: '2026-11-10', out: '2026-11-12', guests: 2, guest }, opts);
  assert.equal((await releaseHolds(db, { now: Date.now() + 10 * 60000 })).released, 0);   // still inside its window
  assert.equal((await releaseHolds(db, { now: Date.now() + 60 * 60000 })).released, 1);
  const b = booking(db, two.bookingId);
  assert.equal(b.status, 'cancelled');
  assert.equal(b.web.released, 'timed_out');
  // paid just after the release: the nights are still free, so the booking is back
  const late = await stripeEvent(db, { type: 'checkout.session.completed', data: { object: { id: b.web.session, payment_status: 'paid', amount_total: 55000, metadata: { booking_id: two.bookingId, org_id: ORG } } } });
  assert.equal(late.status, 'reinstated');
  assert.equal(booking(db, two.bookingId).status, 'confirmed');
  assert.equal(booking(db, two.bookingId).propertyId, 'P-411');
});

test('a Stripe failure releases the hold; payments switched off refuse before holding anything', async () => {
  const db = seed();
  const site = await loadSite(db, 'kozi');
  const failing = async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 'parameter_invalid' } }) });
  await assert.rejects(checkout(db, site, { type: 'standard', in: '2026-11-10', out: '2026-11-12', guests: 2, guest }, { today: TODAY, origin: 'https://staykozi.my', stripe: STRIPE, fetch: failing }), /payment page could not be opened/);
  const held = db.tables.records.filter((r) => r.coll === 'bookings');
  assert.equal(held.length, 1);
  assert.equal(held[0].data.status, 'cancelled');
  await assert.rejects(checkout(db, site, { type: 'standard', in: '2026-11-14', out: '2026-11-15', guests: 2, guest }, { today: TODAY, origin: 'https://staykozi.my', stripe: { configured: false } }), /not switched on/);
  assert.equal(db.tables.records.filter((r) => r.coll === 'bookings').length, 1);
});

test('member sign-in: code by email, wrong code counted, member price at checkout', async () => {
  const db = seed();
  const site = await loadSite(db, 'kozi');
  const sent = [];
  const mail = { configured: true, key: 're_x', from: 'Kozi <hello@example.com>', baseUrl: 'https://resend.test' };
  await memberStart(db, site, { email: 'Ana@Example.com' }, { email: mail, fetch: async (u, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200 }; } });
  const code = /(\d{6})/.exec(sent[0].text)[1];
  assert.deepEqual(sent[0].to, ['ana@example.com']);
  await assert.rejects(memberVerify(db, site, { email: 'ana@example.com', code: code === '000000' ? '111111' : '000000' }), /not right/);
  assert.equal(db.tables.web_member_codes[0].attempts, 1);
  const v = await memberVerify(db, site, { email: 'ana@example.com', code });
  assert.ok(v.token.startsWith('v1.'));
  assert.equal(db.tables.web_members.length, 1);
  await assert.rejects(memberVerify(db, site, { email: 'ana@example.com', code }), /not right/); // a code works once

  const out = await checkout(db, site, { type: 'standard', in: '2026-11-10', out: '2026-11-12', guests: 2, guest, memberToken: v.token }, { today: TODAY, origin: 'https://staykozi.my', stripe: STRIPE, fetch: stripeFake([]) });
  assert.equal(out.price, 'member');
  assert.equal(out.total, 500);
  assert.equal(booking(db, out.bookingId).web.member, 'ana@example.com');
});

test('arrival time and note go on the booking; the guest gets a confirmation email when it is paid; status by session', async () => {
  const db = seed();
  const site = await loadSite(db, 'kozi');
  const opts = { today: TODAY, origin: 'https://staykozi.my', stripe: STRIPE, fetch: stripeFake([]) };
  await assert.rejects(checkout(db, site, { type: 'standard', in: '2026-11-10', out: '2026-11-12', guests: 2, guest, arrival: 'noon' }, opts), /arrival time from the list/);
  await assert.rejects(checkout(db, site, { type: 'standard', in: '2026-11-10', out: '2026-11-12', guests: 2, guest, notes: 'x'.repeat(601) }, opts), /at most 600/);
  const out = await checkout(db, site, { type: 'standard', in: '2026-11-10', out: '2026-11-12', guests: 2, guest, arrival: '7:00 pm to 9:00 pm', notes: 'Late flight.\nBaby cot please.' }, opts);
  let b = booking(db, out.bookingId);
  assert.equal(b.notes, 'Arriving 7:00 pm to 9:00 pm.\nGuest note: Late flight.\nBaby cot please.');
  assert.equal(b.web.arrival, '7:00 pm to 9:00 pm');
  assert.equal(b.web.notes, 'Late flight.\nBaby cot please.');

  assert.equal((await bookingStatus(db, site, { session_id: b.web.session })).status, 'waiting');
  await assert.rejects(bookingStatus(db, site, { session_id: 'cs_test_nope' }), /Unknown booking/);

  const sent = [];
  const email = { configured: true, key: 're_x', from: 'Orbique <alerts@example.com>', baseUrl: 'https://resend.test' };
  const fetch = async (u, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200 }; };
  await stripeEvent(db, { type: 'checkout.session.completed', data: { object: { id: b.web.session, payment_status: 'paid', amount_total: 55000, metadata: { booking_id: out.bookingId, org_id: ORG } } } }, { email, fetch });
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.deepEqual(m.to, ['ana@example.com']);
  assert.equal(m.from, 'Kozi <hello@staykozi.com>');
  assert.equal(m.reply_to, 'hello@staykozi.com');
  assert.match(m.subject, new RegExp('confirmed: Tue 10 Nov 2026 \\(' + out.bookingId + '\\)'));
  for (const want of [out.bookingId, 'Standard Suite', 'Check-in: Tue 10 Nov 2026, from 3:00 pm', 'Check-out: Thu 12 Nov 2026, by 11:00 am', 'Guests: 2', 'Total paid: RM550.00',
    'Rate: Flexible. Free cancellation until Tue 3 Nov 2026.', 'Address: Vortex KLCC, 56 Jalan Sultan Ismail, 50250 Kuala Lumpur', 'Your arrival time: 7:00 pm to 9:00 pm']) assert.ok(m.text.includes(want), want);
  b = booking(db, out.bookingId);
  assert.equal(b.web.guestEmail, 'sent');
  const st = await bookingStatus(db, site, { session_id: b.web.session });
  assert.deepEqual([st.status, st.bookingId, st.type, st.total, st.refundable], ['paid', out.bookingId, 'standard', 550, true]);
  assert.equal(st.guest, undefined);
});

test('starting checkout again for the same stay replaces the guest\'s own unpaid hold; a paid one stops it', async () => {
  const db = seed();
  const site = await loadSite(db, 'kozi');
  const calls = [], sessions = {};
  const opts = { today: TODAY, origin: 'https://staykozi.my', stripe: STRIPE, fetch: stripeFake(calls, sessions) };
  const body = { type: 'standard', in: '2026-11-10', out: '2026-11-12', guests: 2, guest };
  const one = await checkout(db, site, body, opts);
  const first = booking(db, one.bookingId).web.session;
  // only one unit, and the guest is back from the payment page
  const two = await checkout(db, site, body, opts);
  assert.notEqual(two.bookingId, one.bookingId);
  assert.equal(sessions[first], 'expired');
  assert.equal(booking(db, one.bookingId).status, 'cancelled');
  assert.equal(booking(db, one.bookingId).web.released, 'replaced');
  assert.equal(booking(db, two.bookingId).status, 'pending');
  // the replaced session's expiry event changes nothing
  assert.equal((await stripeEvent(db, { type: 'checkout.session.expired', data: { object: { id: first, metadata: { booking_id: one.bookingId, org_id: ORG } } } })).status, 'unchanged');
  // someone else still cannot take it
  await assert.rejects(checkout(db, site, Object.assign({}, body, { guest: Object.assign({}, guest, { email: 'bo@example.com' }) }), opts), /just booked/);
  // paid in another tab: the new checkout stops and the paid stay stays
  sessions[booking(db, two.bookingId).web.session] = 'complete';
  await assert.rejects(checkout(db, site, body, opts), /already paid/);
  assert.equal(booking(db, two.bookingId).status, 'pending');
});
