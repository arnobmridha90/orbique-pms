#!/usr/bin/env node
// Check-in details are sent by hand (Arnob, 2026-11-24): the booking drawer's "Copy check-in details" copies the suite,
// door code and Wi-Fi for the booking's unit and marks them sent. Not part of CI (it needs a browser):
//
//   node scripts/build.mjs --local --out /tmp/me/orbique.html
//   node tests/checkin_details_e2e.mjs file:///tmp/me/orbique.html
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const url = process.argv[2];
if (!url) { console.error('usage: node tests/checkin_details_e2e.mjs <app url>'); process.exit(2); }
const fails = [];
const check = (cond, what) => { if (cond) console.log('ok  ' + what); else { console.log('FAIL ' + what); fails.push(what); } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
await ctx.addInitScript('window.ORBIQUE_NOW = "2026-11-24T23:15";');
const pg = await ctx.newPage(); const errs = [];
pg.on('pageerror', (e) => errs.push(e.message));
await pg.route(/https:\/\/(cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com)\/.*/, (r) => r.abort());
await pg.goto(url);
await pg.waitForFunction(() => window.O && O._started, null, { timeout: 20000 });
const r = await pg.evaluate(async () => {
  const D = O.data, b = D.bookings.filter((x) => x.status === 'confirmed' && D.propById[x.propertyId] && x.checkIn > D.TODAY)[0];
  const p = D.propById[b.propertyId]; p.lockCode = '7319'; p.unitNo = '41-1'; p.wifi = ['Test-Net', 'pw-test-55'];
  b.codeStatus = 'held';
  let copied = '';
  const a = O.booking.actions.filter((x) => x.label === 'Copy check-in details')[0];
  const shown = !!a && a.show(b);
  const U = O.ui || window.U; const save = U.copy; U.copy = (t) => { copied = t; return Promise.resolve(true); };
  a.run(b);
  U.copy = save;
  return { shown, copied, status: b.codeStatus, unitNo: p.unitNo };
});
check(r.shown, 'the booking drawer offers Copy check-in details');
check(/Door code: 7319/.test(r.copied) && /pw-test-55/.test(r.copied) && r.copied.includes(r.unitNo), 'the copy has the suite, door code and Wi-Fi');
check(r.status === 'sent', 'copying marks the details sent');
check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await browser.close();
process.exit(fails.length ? 1 : 0);
