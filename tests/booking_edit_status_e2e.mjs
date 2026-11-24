#!/usr/bin/env node
// Editing a booking in any status (app/pages/bookings.js editBooking): an upcoming direct booking, a completed direct stay
// (check-out moved later reopens it), a cancelled direct booking (guest details and note only) and a booking-site booking
// that has more guests than the unit's usual maximum. Not part of CI (it needs a browser):
//
//   node scripts/build.mjs --local --out /tmp/me/orbique.html
//   node tests/booking_edit_status_e2e.mjs file:///tmp/me/orbique.html
//
// Exits 1 on a failed check or a page error.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const url = process.argv[2];
if (!url) { console.error('usage: node tests/booking_edit_status_e2e.mjs <app url>'); process.exit(2); }
const fails = [];
const check = (cond, what) => { if (cond) console.log('ok  ' + what); else { console.log('FAIL ' + what); fails.push(what); } };

const BD = 'BD-T1', UT = 'UT-T1';
const P = (id, no) => ({ id, name: 'Suite ' + no, short: 'Suite ' + no, unitNo: no, unitTypeId: UT, buildingId: BD, maxGuests: 4, beds: 2, base: 300, type: '2BR apartment', city: 'Kuala Lumpur', area: 'KL', state: 'Kuala Lumpur', checkInTime: '15:00', checkOutTime: '12:00', assignPriority: 1 });
const fx = {
  buildings: [{ id: BD, name: 'Test Tower', city: 'Kuala Lumpur', state: 'Kuala Lumpur', country: 'MY', currency: 'MYR', checkInTime: '15:00', checkOutTime: '12:00' }],
  unitTypes: [{ id: UT, name: 'Deluxe 2-Bedroom Suite', order: 1, beds: 2, maxGuests: 4, buildingId: BD }],
  properties: [P('P-T1', '1-1'), P('P-T2', '1-2')],
};
const g = (name) => ({ name, phone: '+60120000000', email: '', country: 'MY', foreign: false, countryName: 'Malaysia' });
const B = (o) => Object.assign({ notes: '', paidAt: null, status: 'confirmed', channel: 'direct', guests: 2, checkInTime: '15:00', checkOutTime: '12:00', platformFee: 0, tourismTax: 0, cleaningFee: 80, codeStatus: 'held', idVerified: false, invoiceNo: 'INV-T', unitTypeId: UT, assignment: { how: 'manual', locked: true } }, o);
fx.bookings = [
  B({ id: 'BK-DONE', guest: g('Done Guest'), status: 'checked_out', codeStatus: 'expired', checkIn: '2026-11-18', checkOut: '2026-11-24', nights: 6, nightly: 310, accommodation: 1860, total: 1940, payout: 1940, revenue: 1940, propertyId: 'P-T1' }),
  B({ id: 'BK-NEXT', guest: g('Next Guest'), checkIn: '2026-12-30', checkOut: '2027-01-03', nights: 4, nightly: 561, accommodation: 2244, total: 2324, payout: 2324, revenue: 2324, propertyId: 'P-T1' }),
  B({ id: 'BK-GONE', guest: g('Gone Guest'), status: 'cancelled', codeStatus: 'cancelled', checkIn: '2026-11-25', checkOut: '2026-11-27', nights: 2, nightly: 335, accommodation: 670, total: 750, payout: 750, revenue: 750, propertyId: 'P-T2' }),
  B({ id: 'BK-CLASH', guest: g('Site Guest'), channel: 'airbnb', channex: { bookingId: 'x' }, otaName: 'AirBNB', paidAt: '2026-11-13', paymentCollect: 'ota', guests: 5, checkIn: '2026-11-25', checkOut: '2026-11-27', nights: 2, nightly: 300, accommodation: 550, cleaningFee: 50, total: 600, payout: 500, revenue: 600, platformFee: 100, propertyId: 'P-T2' }),
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
await ctx.addInitScript('window.ORBIQUE_NOW = "2026-11-24T23:15";');
const pg = await ctx.newPage(); const errs = [];
pg.on('pageerror', (e) => errs.push(e.message));
pg.on('console', (m) => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) errs.push(m.text()); });
await pg.route(/https:\/\/(cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com)\/.*/, (r) => r.abort());
await pg.goto(url);
await pg.waitForFunction(() => window.O && O._started, null, { timeout: 20000 });
await pg.evaluate((fx) => { const D = O.data; ['bookings', 'properties', 'unitTypes', 'buildings'].forEach((k) => { D[k].length = 0; fx[k].forEach((x) => D[k].push(x)); }); (D.tasks || []).length = 0; (D.blocks || []).length = 0; O.reindex(); O.go('bookings'); }, fx);
await pg.waitForTimeout(300);
const modal = '.modal:last-of-type';
async function edit(id, fill) {
  await pg.evaluate(() => { document.querySelectorAll('.modal-back').forEach((m) => m.remove()); document.querySelectorAll('.toast').forEach((t) => t.remove()); });
  const shown = await pg.evaluate((id) => O.booking.actions.filter((a) => a.label === 'Edit')[0].show(O.data.booking(id)), id);
  check(shown, id + ': the booking shows Edit');
  await pg.evaluate((id) => O.bookingTools.edit(O.data.booking(id)), id);
  await pg.waitForSelector(modal + ' [name=notes]', { timeout: 3000 });
  const disabled = await pg.$$eval(modal + ' input, ' + modal + ' select', (els) => els.filter((e) => e.disabled && e.name).map((e) => e.name));
  await pg.fill(modal + ' [name=notes]', 'note ' + id);
  await pg.fill(modal + ' [name=name]', 'Renamed ' + id);
  if (fill) await fill();
  await pg.locator(modal + ' button', { hasText: 'Save changes' }).last().click();
  await pg.waitForTimeout(300);
  const b = await pg.evaluate((id) => { const b = O.data.booking(id); return { notes: b.notes, name: b.guest.name, nightly: b.nightly, total: b.total, checkOut: b.checkOut, status: b.status, codeStatus: b.codeStatus }; }, id);
  check(b.notes === 'note ' + id && b.name === 'Renamed ' + id, id + ': guest name and note saved');
  return { b, disabled };
}

let r = await edit('BK-NEXT', () => pg.fill(modal + ' [name=price]', '400'));
check(r.disabled.length === 0 && r.b.nightly === 400 && r.b.total === 1680, 'upcoming direct booking: every field open, price saved');

r = await edit('BK-DONE', async () => { await pg.fill(modal + ' [name=price]', '400'); await pg.fill(modal + ' [name=co]', '2026-11-26'); await pg.dispatchEvent(modal + ' [name=co]', 'change'); });
check(r.disabled.join() === 'pid,ci', 'completed stay: only the unit and check-in are locked');
check(r.b.checkOut === '2026-11-26' && r.b.status === 'checked_in' && r.b.codeStatus === 'sent', 'completed stay moved to a later check-out is in-house again');
check(r.b.nightly === 400 && r.b.total === 400 * 8 + 80, 'completed stay: price and total follow');

r = await edit('BK-GONE');
check(r.disabled.join() === 'pid,ci,co', 'cancelled booking: unit and dates locked');
check(r.b.total === 750 && r.b.status === 'cancelled', 'cancelled booking keeps its amounts and status, even though another booking now has those dates');

r = await edit('BK-CLASH');
check(true, 'booking-site booking with more guests than the unit maximum can still be edited');

check(!errs.length, 'no page errors ' + errs.join(' | '));
await browser.close();
if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
console.log('\nall passed');
