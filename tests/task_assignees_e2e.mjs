#!/usr/bin/env node
// Several people on one task, and the booking a task is for (app/pages/tasks.js, api/_lib/shared/taskwho.cjs), in the
// built app at phone (390 px) and desktop size. Not part of CI (it needs a browser); run it by hand after changing tasks:
//
//   node scripts/build.mjs --local --out /tmp/me/orbique.html
//   node tests/task_assignees_e2e.mjs file:///tmp/me/orbique.html /tmp/me/shots
//
// The owner creates a task for two people and one booking; both people see it in their own task list ("My tasks"),
// the booking drawer lists it, editing takes one person off, the other one marks it done (that completes it), and
// old single-assignee tasks still show for their person. Exits 1 on a failed check or a page error.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, outDir = '/tmp/task-assignees-shots'] = process.argv.slice(2);
if (!url) { console.error('usage: node tests/task_assignees_e2e.mjs <app url> [screenshot folder]'); process.exit(2); }
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
  const clearToasts = () => pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  const shot = async (name) => { await clearToasts(); await pg.screenshot({ path: path.join(outDir, tag + '-' + name + '.png') }); };
  const overflow = () => pg.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, ...[...document.querySelectorAll('.drawer, .modal')].map((d) => d.scrollWidth - d.clientWidth)));
  const as = (v) => pg.evaluate((id) => { O.state.viewer = id; O.emit('viewer'); O.go('tasks', { due: 'all', assignee: 'all' }); }, v);
  /* the task ids this viewer's task list shows */
  const listed = () => pg.evaluate(() => [...document.querySelectorAll('.pg-tasks [data-open]')].map((b) => b.dataset.open));
  const owner = await pg.evaluate(() => O.state.viewer);

  /* a unit with an upcoming booking, and two people who are not the owner */
  const pick = await pg.evaluate(() => {
    const D = O.data, b = D.bookings.filter((x) => x.status !== 'cancelled' && x.status !== 'pending' && x.checkOut >= D.TODAY && D.propById[x.propertyId]).sort((a, c) => (a.checkIn < c.checkIn ? -1 : 1))[0];
    return { pid: b.propertyId, bid: b.id, guest: b.guest.name };
  });

  /* ---- new task for two people and one booking ---- */
  await as(owner);
  await pg.waitForSelector('.pg-tasks');
  /* the demo task with two people shows both on its card */
  check(await pg.locator('.pg-tasks [data-people="T-303"]').count() === 1, tag + ': the demo task with two people shows a people button on its card');
  check(/Arif, Siti/.test(await pg.textContent('.pg-tasks [data-people="T-303"]')), tag + ': the card names both people');
  await pg.click('[data-act=new]');
  await pg.waitForSelector('.modal .tk-ppl');
  await pg.fill('.modal [name=title]', 'Fix the balcony door lock');
  await pg.selectOption('.modal [name=type]', 'Maintenance');
  await pg.selectOption('.modal [name=propertyId]', pick.pid);
  const bkOpts = await pg.evaluate(() => [...document.querySelectorAll('.modal [name=bookingId] option')].filter((o) => o.value).map((o) => o.value));
  check(bkOpts.includes(pick.bid), tag + ': the For list shows the unit\'s booking ' + pick.bid);
  check(await pg.evaluate((pid) => [...document.querySelectorAll('.modal [name=bookingId] option')].filter((o) => o.value).every((o) => O.data.booking(o.value).propertyId === pid), pick.pid), tag + ': with a unit picked, the For list has only that unit\'s bookings');
  await pg.fill('.modal [data-bkq]', pick.guest.split(' ')[0]);
  check(await pg.evaluate((bid) => [...document.querySelectorAll('.modal [name=bookingId] option')].some((o) => o.value === bid), pick.bid), tag + ': searching by guest name keeps the booking listed');
  await pg.selectOption('.modal [name=bookingId]', pick.bid);
  /* nobody first, then Siti (s5) and Raju (s6) */
  await pg.click('.modal [data-none]');
  check(await pg.evaluate(() => document.querySelectorAll('.modal [name=who]:checked').length) === 0, tag + ': Unassigned clears every person');
  await pg.click('.modal .tk-pp:has(input[value=s5])');
  await pg.click('.modal .tk-pp:has(input[value=s6])');
  check(/2 people on it/.test(await pg.textContent('.modal [data-load]')), tag + ': the form says two people are on it');
  check(await overflow() <= 0, tag + ': the new task form fits the width');
  await shot('1-new-task');
  await pg.click('.modal-foot button:has-text("Create task")');
  await pg.waitForFunction(() => O.data.tasks.some((t) => t.title === 'Fix the balcony door lock'));
  const made = await pg.evaluate(() => { const t = O.data.tasks.filter((x) => x.title === 'Fix the balcony door lock').pop(); return { id: t.id, ids: t.assigneeIds, one: t.assigneeId, bk: t.bookingId }; });
  check(JSON.stringify(made.ids) === '["s5","s6"]' && made.one === 's5', tag + ': saved assigneeIds [s5, s6] with assigneeId s5');
  check(made.bk === pick.bid, tag + ': saved bookingId ' + pick.bid);
  await pg.waitForSelector('.pg-tasks [data-people="' + made.id + '"]');
  check(true, tag + ': the new card shows its two people');
  await shot('2-board');

  /* ---- both people see it in their own list; old single-assignee tasks still show ---- */
  await as('s5');
  await pg.waitForSelector('.pg-tasks');
  let ids = await listed();
  check(ids.includes(made.id), tag + ': Siti sees the task in her tasks');
  check(ids.includes('T-302') && ids.includes('T-303'), tag + ': Siti still sees her old single-assignee task T-302 and the shared T-303');
  check(!ids.includes('T-304'), tag + ': Siti does not see Raju\'s task T-304');
  await as('s6');
  await pg.waitForSelector('.pg-tasks');
  ids = await listed();
  check(ids.includes(made.id), tag + ': Raju sees the task in his tasks');
  check(ids.includes('T-304') && ids.includes('T-308'), tag + ': Raju still sees his old single-assignee tasks T-304 and T-308');
  await shot('3-raju-tasks');

  /* ---- the booking drawer lists the task ---- */
  await as(owner);
  await pg.evaluate((bid) => O.booking.open(bid), pick.bid);
  await pg.waitForSelector('.bk-task[data-task="' + made.id + '"]');
  check(/Siti, Raju/.test(await pg.textContent('.bk-task[data-task="' + made.id + '"]')), tag + ': the booking drawer lists the task with both people');
  check(await overflow() <= 0, tag + ': the booking drawer fits the width');
  await shot('4-booking-tasks');
  await pg.click('.bk-task[data-task="' + made.id + '"]');
  await pg.waitForSelector('.modal .tk-bk');
  check((await pg.textContent('.modal .tk-bk')).includes(pick.guest), tag + ': the task detail shows the booking it is for');
  await shot('5-task-detail');

  /* ---- edit: take Raju off ---- */
  await pg.click('.modal-foot button:has-text("Edit")');
  await pg.waitForSelector('.modal .tk-ppl');
  await pg.click('.modal .tk-pp:has(input[value=s6])');
  await pg.click('.modal-foot button:has-text("Save changes")');
  await pg.waitForFunction((id) => JSON.stringify(O.data.tasks.find((t) => t.id === id).assigneeIds) === '["s5"]', made.id);
  check(await pg.evaluate((id) => O.data.tasks.find((t) => t.id === id).assigneeId, made.id) === 's5', tag + ': after the edit only Siti is on it');
  check(await pg.evaluate((id) => O.data.tasks.find((t) => t.id === id).bookingId, made.id) === pick.bid, tag + ': the booking stays after the edit');
  await pg.evaluate(() => document.querySelectorAll('.modal-back .modal-x').forEach((x) => x.click()));
  await as('s6');
  await pg.waitForSelector('.pg-tasks');
  check(!(await listed()).includes(made.id), tag + ': Raju no longer sees it');

  /* ---- Siti marks it done: that completes it ---- */
  await as('s5');
  await pg.waitForSelector('.pg-tasks [data-move="' + made.id + '"][data-to=done]');
  await pg.click('.pg-tasks [data-move="' + made.id + '"][data-to=done]');
  await pg.waitForFunction((id) => O.data.tasks.find((t) => t.id === id).status === 'done', made.id);
  check(await pg.evaluate((id) => O.data.tasks.find((t) => t.id === id).doneBy, made.id) === 's5', tag + ': one assignee marking it done completes the task');

  /* ---- an old record (assigneeId only) changed by older code still reads right ---- */
  await as(owner);
  await pg.evaluate(() => { const t = O.data.tasks.find((x) => x.id === 'T-303'); t.assigneeId = 's2'; O.emit('data'); });
  await pg.waitForSelector('.pg-tasks [data-assign="T-303"]');
  check(await pg.inputValue('.pg-tasks [data-assign="T-303"]') === 's2', tag + ': a task changed by older code (assigneeId only) shows that one person');

  check(!errors.length, tag + ': no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

const browser = await chromium.launch();
try {
  await run(browser, { width: 390, height: 844 }, 'phone');
  await run(browser, { width: 1440, height: 900 }, 'desktop');
} finally { await browser.close(); }
console.log(fails.length ? '\n' + fails.length + ' check(s) failed' : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
