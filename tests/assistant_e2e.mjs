#!/usr/bin/env node
// The in-app assistant (app/server/command.js): a typed request -> plan -> done -> Undo, in the real page with the
// server stubbed (no API call). Not part of CI (it needs a browser):
//
//   node scripts/build.mjs --local --out /tmp/me/orbique.html
//   node tests/assistant_e2e.mjs file:///tmp/me/orbique.html [shot.png]
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const url = process.argv[2], shot = process.argv[3];
if (!url) { console.error('usage: node tests/assistant_e2e.mjs <app url> [screenshot.png]'); process.exit(2); }
const fails = [];
const check = (cond, what) => { if (cond) console.log('ok  ' + what); else { console.log('FAIL ' + what); fails.push(what); } };
const src = fs.readFileSync(new URL('../app/server/command.js', import.meta.url), 'utf8');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
await ctx.addInitScript('window.ORBIQUE_NOW = "2026-11-27T20:30";');
const pg = await ctx.newPage(); const errs = [];
pg.on('pageerror', (e) => errs.push(e.message));
await pg.route(/https:\/\/(cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com)\/.*/, (r) => r.abort());
await pg.goto(url);
await pg.waitForFunction(() => window.O && O._started, null, { timeout: 20000 });

// two upcoming bookings in different units, and a stubbed server that answers with a swap
const ids = await pg.evaluate((code) => {
  const D = O.data, T = D.TODAY;
  const typed = D.bookings.filter((b) => b.status === 'confirmed' && b.checkIn > T && b.propertyId && D.propById[b.propertyId]);
  let a = null, b = null;
  for (const x of typed) { for (const y of typed) { if (x !== y && x.propertyId !== y.propertyId && x.checkIn === y.checkIn && x.checkOut === y.checkOut) { a = x; b = y; break; } } if (a) break; }
  if (!a) { a = typed[0]; b = typed.find((y) => y.propertyId !== a.propertyId); b.checkIn = a.checkIn; b.checkOut = a.checkOut; b.nights = a.nights; }
  // nobody else in either unit on those nights
  D.bookings.forEach((x) => { if (x !== a && x !== b && (x.propertyId === a.propertyId || x.propertyId === b.propertyId) && x.checkIn < a.checkOut && a.checkIn < x.checkOut) x.status = 'cancelled'; });
  window.__calls = [];
  let on = true; // 'enabled' only while the file loads, so the rest of the local page stays in local mode
  O.auth = { enabled: () => on, role: () => 'owner', orgId: () => 'org', readOnly: () => false, isPreviewing: () => false,
    inbox: (action, body) => { window.__calls.push({ action, body }); return new Promise((res) => setTimeout(() => res({ reply: 'Swapping their units.', steps: [{ action: 'swap_units', booking: a.id, booking_b: b.id }], cannot: ['Sending the guests a message: you send those yourself.'] }), 150)); } };
  O.notify = { add: (key, kind, vars) => { (window.__notes = window.__notes || []).push({ key, kind, vars }); } };
  (0, eval)(code); on = false;
  O.emit('workspace');
  return { a: a.id, b: b.id, ua: a.propertyId, ub: b.propertyId };
}, src);

await pg.waitForSelector('#ask-btn', { timeout: 5000 });
check(true, 'the owner sees the assistant button next to the bell');
await pg.click('#ask-btn');
await pg.waitForSelector('.as-modal textarea');
check(await pg.$$eval('.as-ex', (x) => x.length) >= 4, 'the empty assistant shows example requests');
await pg.fill('.as-modal textarea', 'swap these two guests');
await pg.keyboard.press('Enter');
await pg.waitForSelector('.as-state.ok', { timeout: 5000 });
const after = await pg.evaluate((i) => { const D = O.data; return { a: D.booking(i.a).propertyId, b: D.booking(i.b).propertyId, held: D.booking(i.a).assignment && D.booking(i.a).assignment.locked, log: (D.assistantLog || []).length, call: window.__calls[0], notes: window.__notes || [] }; }, ids);
check(after.a === ids.ub && after.b === ids.ua, 'the two bookings swapped units');
check(after.held === true, 'the moved bookings are held in their new units');
check(after.log === 1, 'the run is saved for Undo');
check(after.call && after.call.action === 'command' && after.call.body.context.includes(ids.a) && after.call.body.context.includes('Price per night now'), 'the server gets the request with the workspace as context');
check(after.notes.length === 1 && after.notes[0].kind === 'assistant', 'the bell history gets one line');
check(await pg.$eval('.as-cannot', (x) => /you send those yourself/.test(x.textContent)), 'what it cannot do is listed');
if (shot) await pg.screenshot({ path: shot });

await pg.click('.as-bot [data-as-undo]');
const undone = await pg.evaluate((i) => { const D = O.data; return { a: D.booking(i.a).propertyId, b: D.booking(i.b).propertyId, undone: D.assistantLog[0].undone }; }, ids);
check(undone.a === ids.ua && undone.b === ids.ub, 'Undo puts both guests back');
check(undone.undone === true, 'the run is marked undone');

// a risky plan waits for Confirm; an impossible one changes nothing
const risky = await pg.evaluate(() => {
  const D = O.data, t = D.unitTypes[0], from = O.d.add(D.TODAY, 3), to = O.d.add(D.TODAY, 20);
  O.auth.inbox = () => Promise.resolve({ reply: 'Setting the price.', steps: [{ action: 'set_price', unit_type: t.id, from, to, price: 333 }], cannot: [] });
  return { t: t.id, from, mp: O.channel.mainPlan(t.id) && O.channel.mainPlan(t.id).id };
});
await pg.fill('.as-modal textarea', 'price 333 for three weeks');
await pg.keyboard.press('Enter');
await pg.waitForSelector('[data-as=confirm]', { timeout: 5000 });
const before = await pg.evaluate((r) => O.channel.planRate(r.mp, r.from), risky);
check(before !== 333, 'a price change over many nights waits for Confirm');
await pg.click('[data-as=confirm]');
await pg.waitForFunction(() => O.$$('.as-state.ok').length >= 2, null, { timeout: 5000 });
check(await pg.evaluate((r) => O.channel.planRate(r.mp, r.from), risky) === 333, 'Confirm sets the price');
await pg.click('.as-bot:last-child [data-as-undo]');
check(await pg.evaluate((r) => O.channel.planRate(r.mp, r.from), risky) === before, 'Undo puts the old price back');

await pg.evaluate(() => { O.auth.inbox = () => Promise.resolve({ reply: 'Moving.', steps: [{ action: 'move_booking', booking: 'BK-NOPE', unit: 'nowhere' }], cannot: [] }); });
const n0 = await pg.evaluate(() => O.data.assistantLog.length);
await pg.fill('.as-modal textarea', 'move nobody');
await pg.keyboard.press('Enter');
await pg.waitForSelector('.as-state.bad', { timeout: 5000 });
check(await pg.evaluate(() => O.data.assistantLog.length) === n0, 'an impossible plan changes nothing');

// phone width
await pg.setViewportSize({ width: 390, height: 844 });
const fits = await pg.evaluate(() => { const m = O.$('.as-modal'); return m && m.getBoundingClientRect().width <= 390 && document.documentElement.scrollWidth <= 390; });
check(fits, 'the assistant fits a phone screen');
if (shot) await pg.screenshot({ path: shot.replace(/\.png$/, '-phone.png') });

check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await browser.close();
process.exit(fails.length ? 1 : 0);
