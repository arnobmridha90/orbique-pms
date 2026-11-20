#!/usr/bin/env node
// Inventory items and sizes (app/pages/inventory.js) in the built app, at desktop and phone size. Not part of CI (it
// needs a browser); run it by hand after changing the inventory page:
//
//   node scripts/dev.mjs --port 8787 &
//   node tests/inventory_sizes_e2e.mjs http://127.0.0.1:8787/ /tmp/inv-shots
//
// Checks the bigger starter list, Settings > Items and sizes (add an item with sizes, remove an unused one), records
// stock in with two sizes and a typed size, stock used for one size, and that stock is kept per item and size.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, outDir = '/tmp/inv-shots'] = process.argv.slice(2);
if (!url) { console.error('usage: node tests/inventory_sizes_e2e.mjs <app url> [screenshot folder]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const fails = [];
const check = (cond, what) => { if (cond) console.log('ok  ' + what); else { console.log('FAIL ' + what); fails.push(what); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(browser, size, tag) {
  const phone = size.width <= 600;
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  await ctx.addInitScript('window.ORBIQUE_NOW = "2026-10-06T10:15";');
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/net::ERR|Failed to load resource|Refused to execute script/.test(m.text())) errors.push('console.error: ' + m.text()); });
  await pg.route(/https:\/\/(cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com)\/.*/, (r) => r.abort());
  await pg.goto(url);
  await pg.waitForFunction(() => window.O && O._started, null, { timeout: 20000 });
  const shot = async (name) => { await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())); await pg.screenshot({ path: path.join(outDir, tag + '-' + name + '.png') }); };
  const overflow = () => pg.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, ...[...document.querySelectorAll('.modal')].map((d) => d.scrollWidth - d.clientWidth)));

  const n = await pg.evaluate(() => O.data.invItems.filter((x) => x.active !== false).length);
  check(n >= 120, tag + ': starter list has ' + n + ' items');
  const fc = await pg.evaluate(() => { const it = O.data.itemById['IT-FC']; return it.name + '|' + O.inventory.sizes(it).join(','); });
  check(fc === 'Floor cleaner|500ml,1L,2L,5L', tag + ': floor cleaner has sizes 500ml, 1L, 2L, 5L (' + fc + ')');
  const before = await pg.evaluate(() => { const b = O.inventory.onHandBy(); return { two: b['IT-FC::2L'] || 0, five: b['IT-FC::5L'] || 0, one: b['IT-FC::1L'] || 0, tot: O.inventory.onHand()['IT-FC'] || 0 }; });
  check(before.two > 0 && before.two === before.tot, tag + ': old floor cleaner records count as 2L');

  /* Settings > Items and sizes */
  await pg.evaluate(() => O.go('inventory', { tab: 'settings' }));
  await pg.waitForSelector('.inv-items-card');
  check(await pg.locator('.inv-items-card [data-it-toggle]').count() > 0, tag + ': items with records can stop being tracked');
  await shot('1-settings');
  await pg.click('.inv-items-card [data-act="it-add"]');
  await pg.fill('.modal [data-f="name"]', 'Room spray');
  await pg.fill('.modal [data-f="unit"]', 'bottle');
  await pg.fill('.modal [data-f="reorder"]', '4');
  await pg.click('.modal [data-szmode="both"]');
  await pg.fill('.modal [data-f="newsize"]', '100ml'); await pg.press('.modal [data-f="newsize"]', 'Enter');
  await pg.fill('.modal [data-f="newsize"]', '250ml'); await pg.click('.modal [data-szadd]');
  check(await pg.locator('.modal .sz-list .sz-chip').count() === 2, tag + ': two sizes added in the item form');
  check(await overflow() <= 0, tag + ': item form fits');
  await shot('2-item-form');
  await pg.click('.modal .btn-primary');
  const rs = await pg.evaluate(() => { const it = O.data.invItems.find((x) => x.name === 'Room spray'); return it && it.sizes.join(',') + '|' + it.sizeMode; });
  check(rs === '100ml,250ml|both', tag + ': Room spray saved with sizes (' + rs + ')');
  /* remove an unused item */
  const delName = await pg.evaluate(() => { O.data.invItems.push({ id: 'IT-TMP', name: 'Spare thing', cat: 'Laundry', unit: 'piece', cost: 1, reorder: 1, use: [0, 0, 0], active: true }); O.reindex(); O.go('inventory', { tab: 'settings' }); return 'IT-TMP'; });
  await pg.waitForSelector('.inv-items-card [data-it-del="IT-TMP"]');
  await pg.click('.inv-items-card [data-it-del="' + delName + '"]');
  await pg.click('.modal-back:last-child .btn-danger, .modal .btn-danger');
  await wait(300);
  check(!(await pg.evaluate((id) => !!O.data.itemById[id], delName)), tag + ': unused item removed');

  /* stock in: floor cleaner 5L x3 and 1L x2, room spray typed size 500ml x1 */
  await pg.evaluate(() => O.inventory.open('in', { lines: [{ itemId: 'IT-FC', size: '5L', qty: 3 }, { itemId: 'IT-FC', size: '1L', qty: 2 }] }));
  await pg.waitForSelector('.modal [data-sz]');
  check(await pg.locator('.modal [data-sz]').count() === 2, tag + ': two floor cleaner lines, each with a size picker');
  const rsId = await pg.evaluate(() => O.data.invItems.find((x) => x.name === 'Room spray').id);
  if (!phone) {
    await pg.fill('.modal [data-q]', 'room spr'); await pg.press('.modal [data-q]', 'Enter');
  } else {
    await pg.fill('.modal [data-q]', 'room spr'); await wait(100);
    await pg.click('.modal [data-tick="' + rsId + '"]');
  }
  const sel = '.modal [data-line^="' + rsId + '"] [data-sz]';
  await pg.selectOption(sel, '__other');
  await pg.fill('.modal [data-line^="' + rsId + '"] [data-szin]', '500ml');
  await pg.press('.modal [data-line^="' + rsId + '"] [data-szin]', 'Enter');
  await wait(100);
  check(await overflow() <= 0, tag + ': stock-in form fits');
  await shot('3-stock-in');
  await pg.click('#inv-save');
  await wait(200);
  const after = await pg.evaluate((id) => { const b = O.inventory.onHandBy(); return { five: b['IT-FC::5L'] || 0, one: b['IT-FC::1L'] || 0, two: b['IT-FC::2L'] || 0, tot: O.inventory.onHand()['IT-FC'], rs: b[id + '::500ml'] || 0 }; }, rsId);
  check(after.five === before.five + 3 && after.one === before.one + 2 && after.two === before.two, tag + ': stock in kept per size (5L +3, 1L +2, 2L unchanged)');
  check(after.tot === before.tot + 5, tag + ': item total adds every size');
  check(after.rs === 1, tag + ': typed size saved (Room spray 500ml)');

  /* stock used: 1 floor cleaner 5L */
  await pg.evaluate(() => O.inventory.open('out', { propertyId: O.data.properties[0].id, use: 'repair', lines: [{ itemId: 'IT-FC', size: '5L', qty: 1 }] }));
  await pg.waitForSelector('.modal [data-sz]');
  await shot('4-stock-used');
  await pg.click('#inv-save');
  await wait(200);
  const used = await pg.evaluate(() => O.inventory.onHandBy()['IT-FC::5L']);
  check(used === after.five - 1, tag + ': stock used comes off the 5L size');

  /* stock list shows the sizes */
  await pg.evaluate(() => O.go('inventory', { tab: 'stock' }));
  await pg.waitForSelector('.s-row');
  await pg.fill('[data-in="q"]', 'floor');
  await wait(100);
  const chips = await pg.locator('.s-row.has-sz .sz-chip').allInnerTexts();
  check(chips.some((t) => /5L/.test(t)) && chips.some((t) => /1L/.test(t)), tag + ': stock list shows each size (' + chips.join(' / ') + ')');
  check(await overflow() <= 0, tag + ': stock list fits');
  await shot('5-stock-list');
  /* a count form with "Count every item" includes each size in stock */
  await pg.evaluate(() => O.inventory.open('adjust', { mode: 'count' }));
  if (!phone) { await pg.click('.modal [data-all]'); const k = await pg.locator('.modal [data-line^="IT-FC::"]').count(); check(k === 3, tag + ': count lists floor cleaner per size (' + k + ')'); }
  await pg.keyboard.press('Escape');
  check(!errors.length, tag + ': no page errors' + (errors.length ? ' (' + errors.join(' | ') + ')' : ''));
  await ctx.close();
}

const browser = await chromium.launch();
await run(browser, { width: 1280, height: 860 }, 'desktop');
await run(browser, { width: 390, height: 844 }, 'phone');
await browser.close();
if (fails.length) { console.log(fails.length + ' failed'); process.exit(1); }
console.log('all passed');
