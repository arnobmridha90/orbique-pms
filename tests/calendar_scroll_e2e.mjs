#!/usr/bin/env node
// Calendar scrolling (app/pages/calendar.js) in the built app, at phone (390 px, portrait and landscape) and desktop size.
// Not part of CI (it needs a browser); run it by hand after changing the calendar:
//
//   node scripts/build.mjs --local --out /tmp/me/index.html
//   node tests/calendar_scroll_e2e.mjs file:///tmp/me/index.html /tmp/me/shots
//
// The timeline opens with yesterday at the left and today in view; a touch swipe (phones) or the mouse wheel and a mouse
// drag (desktop) move it sideways and down without the week buttons; more days load at either end; the date row and the
// unit column stay put; a data redraw (O.emit('data')) keeps the scroll position; Today brings today back. Exits 1 on a
// failed check or a page error.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, outDir = '/tmp/calendar-scroll-shots'] = process.argv.slice(2);
if (!url) { console.error('usage: node tests/calendar_scroll_e2e.mjs <app url> [screenshot folder]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

const fails = [];
const check = (cond, what) => { if (cond) console.log('ok  ' + what); else { console.log('FAIL ' + what); fails.push(what); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(browser, size, tag, days) {
  const mobile = size.width <= 600 || size.height <= 500;
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript('window.ORBIQUE_NOW = "2026-10-06T10:15";');
  const pg = await ctx.newPage();
  const cdp = await ctx.newCDPSession(pg);
  const errors = [];
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text()); });
  await pg.route(/https:\/\/(cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com)\/.*/, (r) => r.abort());
  await pg.goto(url);
  await pg.waitForFunction(() => window.O && O._started, null, { timeout: 20000 });
  await pg.evaluate((n) => { O.store.set('calendar.days', n); document.querySelectorAll('.toast').forEach((t) => t.remove()); }, days);
  const open = async (params) => { await pg.evaluate((p) => O.go('calendar', p), params); await pg.waitForSelector('.cal-d'); await wait(200); };
  /* a finger swipe: touch down, move in steps, lift (CDP touch events, so the browser scrolls as it would under a finger) */
  const swipe = async (x, y, dx, dy) => {
    const at = (i) => [{ x: Math.round(x + dx * i / 10), y: Math.round(y + dy * i / 10), id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i) }); await wait(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const T = await pg.evaluate(() => O.data.TODAY);
  const add = (iso, n) => pg.evaluate(([a, b]) => O.d.add(a, b), [iso, n]);
  /* is today's column inside the timeline's visible part (right of the sticky unit column, within the screen)? */
  const todayShown = () => pg.evaluate(() => {
    const s = document.querySelector('.cal-scroll'), t = document.querySelector('.cal-d.today'), c = document.querySelector('.cal-corner');
    if (!s || !t || !c) return false;
    const sr = s.getBoundingClientRect(), tr = t.getBoundingClientRect(), left = c.getBoundingClientRect().right;
    return tr.left >= left - 1 && tr.right <= Math.min(sr.right, window.innerWidth) + 1 && tr.width > 0;
  });
  const st = () => pg.evaluate(() => {
    const s = document.querySelector('.cal-scroll'), ds = document.querySelectorAll('.cal-d');
    return { y: window.pageYOffset, l: s.scrollLeft, t: s.scrollTop, sw: s.scrollWidth, cw: s.clientWidth, sh: s.scrollHeight, ch: s.clientHeight,
      first: ds[0].title, last: ds[ds.length - 1].title, nDays: ds.length, left: document.querySelector('.cal-pick input').value,
      today: !document.querySelector('.cal-today').disabled };
  });
  /* the middle of the timeline, below the date row and right of the unit column */
  const mid = () => pg.evaluate(() => { const r = document.querySelector('.cal-scroll').getBoundingClientRect(), c = document.querySelector('.cal-corner').getBoundingClientRect(); return { x: Math.round((c.right + Math.min(r.right, innerWidth)) / 2), y: Math.round(Math.min(c.bottom + 150, (c.bottom + Math.min(r.bottom, innerHeight)) / 2)) }; });

  /* ---- opens on today ---- */
  await open();
  let s0 = await st();
  check(await todayShown(), tag + ': today is in view when the calendar opens');
  check(s0.left === await add(T, -1), tag + ': yesterday is the first day in view (' + s0.left + ')');
  check(!s0.today, tag + ': Today is greyed out while today is already shown');
  check(s0.sw > s0.cw + 100, tag + ': the timeline holds more days than fit, to scroll through (' + s0.nDays + ' days)');
  await pg.screenshot({ path: path.join(outDir, tag + '-1-open.png') });

  /* ---- swipe / wheel / drag sideways, no week buttons ---- */
  const m = await mid();
  if (mobile) {
    await swipe(m.x + 100, m.y, -250, 0);
  } else {
    await pg.mouse.move(m.x, m.y); await pg.mouse.wheel(250, 0);
  }
  await wait(300);
  let s1 = await st();
  check(s1.l > s0.l + 150 && s1.left > s0.left, tag + ': ' + (mobile ? 'a swipe' : 'the mouse wheel') + ' moves the days sideways (' + s0.left + ' -> ' + s1.left + ')');
  check(!(await pg.locator('.drawer, .modal, .cal-menu').count()), tag + ': moving the timeline does not open a booking or the day menu');
  if (!mobile) {
    const before = s1.l;
    await pg.mouse.move(m.x, m.y); await pg.mouse.down(); await pg.mouse.move(m.x - 120, m.y, { steps: 4 }); await pg.mouse.move(m.x - 240, m.y - 60, { steps: 4 }); await pg.mouse.up();
    await wait(200);
    s1 = await st();
    check(Math.abs(s1.l - before - 240) <= 3, tag + ': dragging with the mouse moves the timeline (' + Math.round(s1.l - before) + ' px)');
    check(!(await pg.locator('.drawer, .modal, .cal-menu').count()), tag + ': a drag does not open a booking or the day menu');
  }
  /* vertical: units scroll under the sticky date row, and the unit column stays at the left */
  if (mobile) await swipe(m.x, m.y + 100, 0, -200);
  else { await pg.mouse.move(m.x, m.y); await pg.mouse.wheel(0, 200); }
  await wait(300);
  const sticky = await pg.evaluate(() => {
    const s = document.querySelector('.cal-scroll').getBoundingClientRect(), hd = document.querySelector('.cal-hd').getBoundingClientRect(), p = document.querySelector('.cal-prop').getBoundingClientRect();
    return { down: document.querySelector('.cal-scroll').scrollTop, hd: Math.abs(hd.top - s.top) <= 1, col: Math.abs(p.left - s.left) <= 1 };
  });
  check(sticky.down > 50, tag + ': ' + (mobile ? 'swiping up' : 'the wheel') + ' scrolls down through the units (' + sticky.down + ' px)');
  check(sticky.hd && sticky.col, tag + ': the date row stays on top and the unit column on the left');

  /* ---- more days load at both ends ---- */
  const far = async (dir) => { for (let i = 0; i < 6; i++) { await pg.evaluate((k) => { const s = document.querySelector('.cal-scroll'); s.scrollLeft = k > 0 ? s.scrollWidth : 0; }, dir); await wait(120); } };
  await far(1);
  const sR = await st();
  check(sR.last !== s0.last && sR.left > await add(T, 60), tag + ': scrolling right keeps adding days (now at ' + sR.left + ')');
  check(sR.today, tag + ': away from today, Today can be pressed');
  await pg.click('.cal-today'); await wait(250);
  check(await todayShown() && (await st()).left === await add(T, -1), tag + ': Today scrolls back to today');
  await far(-1);
  const sL = await st();
  check(sL.left < await add(T, -60), tag + ': scrolling left keeps adding earlier days (now at ' + sL.left + ')');
  await pg.click('.cal-today'); await wait(250);
  check(await todayShown(), tag + ': Today scrolls back to today from the past');

  /* ---- week buttons still step 7 days ---- */
  await pg.click('.cal-nav [data-nav="1"]'); await wait(200);
  check((await st()).left === await add(T, 6), tag + ': the next arrow steps 7 days');
  await pg.click('.cal-nav [data-nav="-1"]'); await wait(200);
  check((await st()).left === await add(T, -1), tag + ': the previous arrow steps back 7 days');

  /* ---- a redraw keeps the scroll position ---- */
  await pg.evaluate(() => { const s = document.querySelector('.cal-scroll'); s.scrollLeft += 333; s.scrollTop = 120; window.scrollTo(0, 60); });
  await wait(250);
  const b = await st();
  await pg.evaluate(() => O.emit('data'));
  await wait(250);
  const a = await st();
  check(Math.abs(a.y - b.y) <= 1 && Math.abs(a.t - b.t) <= 1 && Math.abs(a.l - b.l) <= 1 && a.left === b.left, tag + ': O.emit("data") keeps the scroll position (' + JSON.stringify({ y: b.y, l: b.l, t: b.t }) + ' -> ' + JSON.stringify({ y: a.y, l: a.l, t: a.t }) + ')');

  /* ---- rates & restrictions: the same timeline on desktop, a list of the days in view on phones ---- */
  if (await pg.locator('.cal-view [data-view=rates]').count()) {
    await open();
    await pg.click('.cal-view [data-view=rates]'); await wait(250);
    if (mobile) {
      const first = () => pg.evaluate(() => { const l = [...document.querySelectorAll('.rr-list > *')], i = l.findIndex((x) => x.classList.contains('rr-lh')); let n = 0; for (let k = i + 1; k < l.length && !l[k].classList.contains('rr-lh'); k++) n++; return { n, d: l[i + 1] && l[i + 1].dataset.date }; });
      const r0 = await first();
      check(r0.n === 7 && r0.d === await add(T, -1), tag + ': the rates list shows the 7 days in view (' + JSON.stringify(r0) + ')');
      await pg.click('.cal-nav [data-nav="1"]'); await wait(250);
      check((await first()).d === await add(T, 6), tag + ': the next arrow pages the rates list by 7 days');
    } else {
      const r0 = await st();
      await far(1);
      const r1 = await st();
      check(await pg.locator('.rr-c').count() > 0 && r1.left > r0.left && r1.nDays > r0.nDays, tag + ': the rates timeline scrolls and keeps adding days (now at ' + r1.left + ')');
    }
    await pg.click('.cal-view [data-view=stays]'); await wait(250);
  }

  /* ---- the date picker / a link to a date ---- */
  await open({ from: '2027-02-10' });
  check((await st()).left === '2027-02-10', tag + ': a link to a date opens with that date at the left');
  await pg.screenshot({ path: path.join(outDir, tag + '-2-date.png') });

  check(!(await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth > 0)), tag + ': no sideways page scroll');
  check(errors.length === 0, tag + ': no page errors' + (errors.length ? ' (' + errors.join('; ') + ')' : ''));
  await ctx.close();
}

const browser = await chromium.launch();
try {
  await run(browser, { width: 390, height: 844 }, 'phone', 7);
  await run(browser, { width: 844, height: 390 }, 'phone-landscape', 7);
  await run(browser, { width: 1280, height: 800 }, 'desktop', 7);
  await run(browser, { width: 1280, height: 800 }, 'desktop-30', 30);
  await run(browser, { width: 1024, height: 700 }, 'narrow-14', 14);
} finally { await browser.close(); }
if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
console.log('\nall passed');
