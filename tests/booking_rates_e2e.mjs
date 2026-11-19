#!/usr/bin/env node
// Editing the room rate of a saved direct booking, the "Website" source, and the amounts of a booking-site booking typed in
// by hand (app/pages/bookings.js), in the built app at desktop and phone size. Not part of CI (it needs a browser):
//
//   node scripts/build.mjs --local --out /tmp/me/orbique.html
//   node tests/booking_rates_e2e.mjs file:///tmp/me/orbique.html /tmp/me/shots
//
// Exits 1 on a failed check or a page error.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, outDir = '/tmp/booking-rates-shots'] = process.argv.slice(2);
if (!url) { console.error('usage: node tests/booking_rates_e2e.mjs <app url> [screenshot folder]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

const fails = [];
const check = (cond, what) => { if (cond) console.log('ok  ' + what); else { console.log('FAIL ' + what); fails.push(what); } };

async function run(browser, size, tag) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: size.width <= 600, isMobile: size.width <= 600 });
  await ctx.addInitScript('window.ORBIQUE_NOW = "2026-10-06T10:15";');
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text()); });
  await pg.route(/https:\/\/(cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com)\/.*/, (r) => r.abort());
  await pg.goto(url);
  await pg.waitForFunction(() => window.O && O._started, null, { timeout: 20000 });
  const shot = async (name) => { await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())); await pg.screenshot({ path: path.join(outDir, tag + '-' + name + '.png') }); };
  const modal = '.modal:last-of-type';
  const save = async (label) => { await pg.locator(modal + ' button', { hasText: label }).last().click(); await pg.waitForTimeout(300); };
  await pg.evaluate(() => O.go('bookings'));
  await pg.waitForSelector('.pg-bookings');

  /* ---- new booking from the website ---- */
  await pg.evaluate(() => O.newBooking({}));
  await pg.waitForSelector(modal + ' [name=src]');
  const opts = await pg.$$eval(modal + ' [name=src] option', (os) => os.map((o) => o.value));
  check(opts[0] === 'direct' && opts[1] === 'website', tag + ': "Booked on" offers Direct booking then Website');
  await pg.selectOption(modal + ' [name=src]', 'website');
  check(await pg.isVisible(modal + ' [name=price]'), tag + ': Website shows the nightly price like a direct booking');
  check(/own website/.test(await pg.textContent(modal + ' .nb-srchint')), tag + ': Website hint shown');
  await pg.fill(modal + ' [name=name]', 'Web Guest');
  await pg.fill(modal + ' [name=phone]', '+60 12-000 0000');
  await pg.fill(modal + ' [name=price]', '250');
  await shot('new-website');
  await save('Create booking');
  const web = await pg.evaluate(() => { const b = O.data.bookings.filter((x) => x.guest.name === 'Web Guest')[0]; return b && { id: b.id, channel: b.channel, otaName: b.otaName, nightly: b.nightly, nights: b.nights, total: b.total, fee: b.platformFee }; });
  check(web && web.channel === 'direct' && web.otaName === 'Website', tag + ': saved as a direct booking marked Website');
  check(web && web.nightly === 250 && web.fee === Math.round(250 * web.nights * 0.03), tag + ': direct pricing and 3% fee kept');
  await pg.evaluate(() => O.go('bookings'));
  await pg.waitForTimeout(200);
  const badge = await pg.evaluate((id) => { const r = [...document.querySelectorAll('.pg-bookings [data-id], .pg-bookings [data-open]')].find((x) => (x.dataset.id || x.dataset.open) === id); return r ? r.textContent : document.querySelector('.pg-bookings').textContent; }, web.id);
  check(/Website/.test(badge), tag + ': bookings list shows Website');

  /* ---- edit its room rate ---- */
  await pg.evaluate((id) => O.bookingTools.edit(O.data.booking(id)), web.id);
  await pg.waitForSelector(modal + ' [name=price]');
  check(await pg.inputValue(modal + ' [name=price]') === '250', tag + ': edit form shows the saved nightly price');
  check(await pg.inputValue(modal + ' [name=src]') === 'website', tag + ': edit form keeps the Website source');
  await pg.fill(modal + ' [name=price]', '199');
  await pg.waitForTimeout(100);
  check(/Was/.test(await pg.textContent(modal + ' .nb-sum')), tag + ': summary shows the new total and what it was');
  await shot('edit-rate');
  await save('Save changes');
  const ed = await pg.evaluate((id) => { const b = O.data.booking(id); return { nightly: b.nightly, acc: b.accommodation, total: b.total, fee: b.platformFee, payout: b.payout, clean: b.cleaningFee, tax: b.tourismTax, otaName: b.otaName }; }, web.id);
  check(ed.nightly === 199 && ed.acc === 199 * web.nights, tag + ': nightly price and accommodation updated');
  check(ed.total === ed.acc + ed.clean + ed.tax && ed.payout === ed.total - ed.fee && ed.fee === Math.round(ed.acc * 0.03), tag + ': total, fee and payout follow');

  /* ---- switch it back to a plain direct booking ---- */
  await pg.evaluate((id) => O.bookingTools.edit(O.data.booking(id)), web.id);
  await pg.waitForSelector(modal + ' [name=src]');
  await pg.selectOption(modal + ' [name=src]', 'direct');
  await save('Save changes');
  check(await pg.evaluate((id) => O.data.booking(id).otaName === undefined, web.id), tag + ': source can be changed back to Direct');

  /* ---- a booking-site booking typed in by hand: what the guest paid and the commission ---- */
  await pg.evaluate(() => O.newBooking({ channel: 'agoda' }));
  await pg.waitForSelector(modal + ' [name=total]');
  await pg.fill(modal + ' [name=name]', 'Hand Agoda');
  await pg.fill(modal + ' [name=total]', '600');
  await pg.fill(modal + ' [name=fee]', '90');
  await save('Create booking');
  const ag = await pg.evaluate(() => O.data.bookings.filter((x) => x.guest.name === 'Hand Agoda')[0].id);
  await pg.evaluate((id) => O.bookingTools.edit(O.data.booking(id)), ag);
  await pg.waitForSelector(modal + ' [name=total]');
  check(!(await pg.$(modal + ' [name=src]')), tag + ': no Direct/Website choice on a booking-site booking');
  await pg.fill(modal + ' [name=total]', '640');
  await pg.fill(modal + ' [name=fee]', '96');
  await shot('edit-agoda');
  await save('Save changes');
  const a2 = await pg.evaluate((id) => { const b = O.data.booking(id); return { total: b.total, fee: b.platformFee, payout: b.payout, channel: b.channel }; }, ag);
  check(a2.total === 640 && a2.fee === 96 && a2.payout === 544 && a2.channel === 'agoda', tag + ': hand-entered site booking amounts updated');

  /* ---- a booking from a connected site keeps its price ---- */
  const cx = await pg.evaluate(() => { const b = O.data.bookings.filter((x) => x.channel !== 'direct' && x.status === 'confirmed')[0]; if (!b) return null; b.channex = b.channex || { id: 'test' }; return b.id; });
  if (cx) {
    await pg.evaluate((id) => O.bookingTools.edit(O.data.booking(id)), cx);
    await pg.waitForSelector(modal + ' [name=guests]');
    check(!(await pg.$(modal + ' [name=price]')) && !(await pg.$(modal + ' [name=total]')), tag + ': connected-site booking has no price fields');
    await pg.locator(modal + ' button', { hasText: 'Cancel' }).last().click();
  }
  const ov = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(ov <= 0, tag + ': no sideways scroll');
  check(!errors.length, tag + ': no page errors ' + errors.join(' | '));
  await ctx.close();
}

const browser = await chromium.launch();
try {
  await run(browser, { width: 1366, height: 900 }, 'desktop');
  await run(browser, { width: 390, height: 844 }, 'phone');
} finally { await browser.close(); }
if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
console.log('\nall passed');
