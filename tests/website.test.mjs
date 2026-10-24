// Website booking API (api/_lib/website.js, api/public.js): prices, restrictions, member tokens, Stripe helpers, routes.
//   node --test tests/website.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  quoteStay, calendarDays, siteSettings, memberToken, readMemberToken, formEncode, stripeSignatureOk, originAllowed, stayInput, notes
} from '../api/_lib/website.js';
import { routeOf } from '../api/public.js';

const FLEX = { id: 'P-FLEX', unitTypeId: 'T', name: 'Flexible', defaultRate: 250, minStay: 1, maxStay: 0 };
const NREF = { id: 'P-NREF', unitTypeId: 'T', name: 'Non-refundable', follows: { planId: 'P-FLEX', type: 'pct', value: -10 }, defaultRate: 225, minStay: 1 };
const WEEK = { id: 'P-WEEK', unitTypeId: 'T', name: 'Weekly', follows: { planId: 'P-FLEX', type: 'pct', value: -15 }, defaultRate: 212, minStay: 7 };
const TYPE = { key: 'standard', typeId: 'T', name: 'Standard', plans: { flexible: 'P-FLEX', nonref: 'P-NREF', weekly: 'P-WEEK' } };
const plans = new Map([FLEX, NREF, WEEK].map((p) => [p.id, p]));
const base = (days = {}, extra = {}) => Object.assign({
  plans, days: new Map(Object.entries(days)), type: TYPE, today: '2026-11-01', lastMinute: null, settings: siteSettings({ publicMarkupPct: 10 })
}, extra);

test('quoteStay: flexible first, member and public totals, extra bed for a fifth guest', () => {
  const q = quoteStay(base({ 'P-FLEX': { '2026-11-10': { rate: 300 } } }, { checkIn: '2026-11-10', checkOut: '2026-11-12', guests: 5 }));
  assert.equal(q.nights, 2);
  assert.equal(q.best.plan, 'flexible');
  assert.deepEqual(q.best.nightly.map((n) => n.member), [300, 250]);
  assert.deepEqual(q.best.nightly.map((n) => n.public), [330, 275]);
  assert.equal(q.best.extraBed, 120);
  assert.equal(q.best.memberTotal, 670);
  assert.equal(q.best.publicTotal, 725);
  assert.equal(q.best.freeCancelUntil, '2026-11-03');
  // the non-refundable rate follows the night's flexible rate
  const nr = q.options.find((o) => o.plan === 'nonref');
  assert.deepEqual(nr.nightly.map((n) => n.member), [270, 225]);
  assert.equal(nr.refundable, false);
  // weekly does not apply to 2 nights, so it is not shown
  assert.ok(!q.options.some((o) => o.plan === 'weekly'));
});

test('quoteStay: a prime night closes flexible, so non-refundable is the best way to book', () => {
  const q = quoteStay(base({ 'P-FLEX': { '2026-12-31': { rate: 500, stopSell: true, minStay: 2 } } }, { checkIn: '2026-12-31', checkOut: '2027-01-02', guests: 2 }));
  const flex = q.options.find((o) => o.plan === 'flexible');
  assert.equal(flex.bookable, false);
  assert.equal(flex.why, 'closed');
  assert.equal(q.best.plan, 'nonref');
  assert.equal(q.best.nightly[0].member, 450);
});

test('quoteStay: minimum stay, closed to arrival, weekly from 7 nights, last-minute deal', () => {
  let q = quoteStay(base({ 'P-FLEX': { '2026-11-06': { minStay: 2 } }, 'P-NREF': { '2026-11-06': { minStay: 2 } } }, { checkIn: '2026-11-06', checkOut: '2026-11-07', guests: 2 }));
  assert.equal(q.best, null);
  assert.equal(q.options[0].why, 'min_stay');
  assert.equal(q.options[0].minStay, 2);
  q = quoteStay(base({ 'P-FLEX': { '2026-11-06': { cta: true } } }, { checkIn: '2026-11-06', checkOut: '2026-11-08', guests: 2 }));
  assert.equal(q.options[0].why, 'no_arrival');
  q = quoteStay(base({}, { checkIn: '2026-11-10', checkOut: '2026-11-17', guests: 2 }));
  assert.deepEqual(q.options.map((o) => o.plan), ['flexible', 'weekly', 'nonref']);
  assert.equal(q.options[1].nightly[0].member, 212.5);
  const deal = { pct: 10, days: 3, nights: [0, 1, 2, 3, 4, 5, 6] };
  q = quoteStay(base({}, { checkIn: '2026-11-01', checkOut: '2026-11-02', guests: 2, lastMinute: deal }));
  assert.equal(q.best.nightly[0].member, 225);
  assert.equal(q.best.freeCancelUntil, null); // already inside the free-cancellation cut-off
});

test('calendarDays: flexible price, non-refundable on a prime night, closed when nothing sells or nothing is free', () => {
  const days = calendarDays(base({ 'P-FLEX': { '2026-11-02': { stopSell: true } }, 'P-NREF': { '2026-11-03': { stopSell: true } } }, {
    dates: ['2026-11-01', '2026-11-02', '2026-11-03'], avail: new Map([['2026-11-01', 1], ['2026-11-02', 2], ['2026-11-03', 0]])
  }));
  assert.deepEqual(days.map((d) => [d.available, d.member, d.refundable]), [[1, 250, true], [2, 225, false], [0, 250, true]]);
  const shut = calendarDays(base({ 'P-FLEX': { '2026-11-02': { stopSell: true } }, 'P-NREF': { '2026-11-02': { stopSell: true } } }, { dates: ['2026-11-02'], avail: new Map([['2026-11-02', 2]]) }));
  assert.deepEqual([shut[0].available, shut[0].member], [0, null]);
});

test('stayInput: plain-English errors for dates and guests', () => {
  const s = siteSettings({});
  assert.deepEqual(stayInput({ in: '2026-11-10', out: '2026-11-12', guests: '5' }, s, '2026-11-01'), { checkIn: '2026-11-10', checkOut: '2026-11-12', nights: 2, guests: 5 });
  assert.throws(() => stayInput({ in: '2026-10-30', out: '2026-11-02' }, s, '2026-11-01'), /already passed/);
  assert.throws(() => stayInput({ in: '2026-11-03', out: '2026-11-02' }, s, '2026-11-01'), /after check-in/);
  assert.throws(() => stayInput({ in: '2026-11-03', out: '2026-11-04', guests: 6 }, s, '2026-11-01'), /at most 5 guests/);
  assert.throws(() => stayInput({ in: '2026-11-03', out: '2027-02-04' }, s, '2026-11-01'), /at most 60 nights/);
  assert.match(notes(s).extraBed, /5th guest/);
});

test('member tokens: signed, for one workspace, expire', () => {
  const secret = 'test-secret';
  const { token } = memberToken('org-a', 'guest@example.com', { secret, now: 1e12 });
  assert.deepEqual(readMemberToken(token, 'org-a', { secret, now: 1e12 + 1000 }), { orgId: 'org-a', email: 'guest@example.com' });
  assert.equal(readMemberToken(token, 'org-b', { secret, now: 1e12 }), null);
  assert.equal(readMemberToken(token, 'org-a', { secret: 'other', now: 1e12 }), null);
  assert.equal(readMemberToken(token, 'org-a', { secret, now: 1e12 + 31 * 86400000 }), null);
  assert.equal(readMemberToken(token.slice(0, -2) + 'xx', 'org-a', { secret, now: 1e12 }), null);
});

test('Stripe: form encoding with nested keys, webhook signatures', () => {
  assert.equal(formEncode({ mode: 'payment', line_items: [{ quantity: 1, price_data: { currency: 'myr' } }], metadata: { a: 'x y' } }),
    'mode=payment&line_items%5B0%5D%5Bquantity%5D=1&line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=myr&metadata%5Ba%5D=x%20y');
  const raw = Buffer.from('{"id":"evt_1"}');
  const t = 1800000000;
  const sig = createHmac('sha256', 'whsec_x').update(t + '.' + raw.toString()).digest('hex');
  assert.equal(stripeSignatureOk(raw, `t=${t},v1=${sig}`, 'whsec_x', t * 1000), true);
  assert.equal(stripeSignatureOk(raw, `t=${t},v1=${sig}`, 'whsec_y', t * 1000), false);
  assert.equal(stripeSignatureOk(raw, `t=${t},v1=${sig}`, 'whsec_x', (t + 600) * 1000), false);
  assert.equal(stripeSignatureOk(Buffer.from('{"id":"evt_2"}'), `t=${t},v1=${sig}`, 'whsec_x', t * 1000), false);
});

test('origins and routes', () => {
  assert.equal(originAllowed('https://www.staykozi.my', null), true);
  assert.equal(originAllowed('https://kozi-next-git-main-team.vercel.app', null), true);
  assert.equal(originAllowed('https://staykozi-my-git-main-arnobmridhas-projects.vercel.app', null), true);
  assert.equal(originAllowed('https://evil.vercel.app', null), false);
  assert.equal(originAllowed('https://evil.example', null), false);
  assert.equal(originAllowed('https://book.example', siteSettings({ origins: ['https://book.example'] })), true);
  assert.equal(routeOf({ url: '/api/public/member/start?ws=kozi' }), 'member/start');
  assert.equal(routeOf({ url: '/api/public?path=availability&ws=kozi' }), 'availability');
});
