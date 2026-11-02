#!/usr/bin/env node
// Rooms & beds and unit requests (app/pages/unitrooms.js, app/pages/unitreq.js) in the built app, at phone (390 px) and
// desktop size. Not part of CI (it needs a browser); run it by hand after changing those pages:
//
//   node scripts/build.mjs && (cd dist && python3 -m http.server 8765 &)
//   node tests/beds_requests_e2e.mjs http://127.0.0.1:8765/ /tmp/me/shots
//
// Adds rooms and beds to a unit, saves, reloads; raises a request, finds its task in Tasks, marks the task done and
// checks the request is ticked; reopens the task; a housekeeper raises one from Tasks > Requests. Exits 1 on a failed
// check or a page error.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, outDir = '/tmp/beds-requests-shots'] = process.argv.slice(2);
if (!url) { console.error('usage: node tests/beds_requests_e2e.mjs <app url> [screenshot folder]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

const fails = [];
const check = (cond, what) => { if (cond) console.log('ok  ' + what); else { console.log('FAIL ' + what); fails.push(what); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(browser, size, tag) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: size.width <= 600, isMobile: size.width <= 600 });
  await ctx.addInitScript('window.ORBIQUE_NOW = "2026-10-06T10:15";');
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text()); });
  await pg.route(/https:\/\/(cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com)\/.*/, (r) => r.abort());
  const boot = async () => {
    await pg.goto(url);
    await pg.waitForFunction(() => window.O && O._started, null, { timeout: 20000 });
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  };
  const shot = async (name) => { await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())); await pg.screenshot({ path: path.join(outDir, tag + '-' + name + '.png') }); };
  const overflow = () => pg.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, ...[...document.querySelectorAll('.drawer, .modal')].map((d) => d.scrollWidth - d.clientWidth)));
  await boot();

  /* ---- rooms & beds ---- */
  await pg.evaluate(() => O.go('properties', { propertyId: 'mrs', unitTab: 'rooms' }));
  await pg.waitForSelector('.pp-dr [data-ur-view]');
  check(await pg.locator('.pp-dr [data-utab]').count() >= 3, tag + ': unit tabs Details, Rooms & beds, Requests');
  await pg.click('.pp-dr [data-ur=edit]');
  await pg.waitForSelector('.pp-dr [data-ur-form]');
  await pg.selectOption('.pp-dr [data-ur-newroom]', 'bed2');
  await pg.click('.pp-dr [data-ur=addroom]');
  await pg.selectOption('.pp-dr [name="r.1.b.0.type"]', 'queen');
  check(await pg.inputValue('.pp-dr [name="r.1.b.0.mattress"]') === '152x190', tag + ': a queen bed starts with a queen mattress size');
  await pg.click('.pp-dr [data-room-row="1"] [data-ur=addbed]');
  await pg.fill('.pp-dr [name="r.1.b.1.mattress"]', '91x190');
  await pg.fill('.pp-dr [name="r.0.b.0.pillows"]', '4');
  await pg.fill('.pp-dr [name="r.0.b.0.notes"]', 'Headboard is fixed to the wall');
  check(await overflow() <= 0, tag + ': the rooms form fits the width');
  await shot('1-rooms-form');
  await pg.click('.pp-dr [data-ur=save]');
  await pg.waitForSelector('.pp-dr [data-ur-linen]');
  const rec = await pg.evaluate(() => { const r = O.data.unitRooms.find((x) => x.propertyId === 'mrs'); return r && { rooms: r.rooms.length, beds: r.rooms.reduce((n, x) => n + x.beds.length, 0), p: r.rooms[0].beds[0].pillows }; });
  check(rec && rec.rooms === 2 && rec.beds === 3 && rec.p === 4, tag + ': saved 2 rooms with 3 beds');
  const lin = await pg.textContent('.pp-dr [data-ur-linen]');
  check(/2 ×\s*Fitted sheet\s*Queen 152 x 190 cm/.test(lin) && /7 ×\s*Pillowcase/.test(lin), tag + ': linen per change lists 2 queen fitted sheets and 7 pillowcases (4 + 2 + 1)');
  check(await overflow() <= 0, tag + ': the rooms view fits the width');
  await shot('2-rooms-view');
  await wait(1200);
  await boot();
  await pg.evaluate(() => O.go('properties', { propertyId: 'mrs', unitTab: 'rooms' }));
  await pg.waitForSelector('.pp-dr [data-ur-view]');
  check(/Bedroom 2/.test(await pg.textContent('.pp-dr [data-ur-view]')) && /Headboard/.test(await pg.textContent('.pp-dr [data-ur-view]')), tag + ': rooms and beds are still there after a reload');

  /* ---- a request makes its task ---- */
  await pg.click('.pp-dr [data-utab=requests]');
  await pg.waitForSelector('.pp-dr [data-rq-view]');
  await pg.click('.pp-dr [data-rq=new]');
  await pg.waitForSelector('.rq-form');
  await pg.check('.rq-form input[name=kind][value=repair]');
  await pg.fill('.rq-form [name=item]', 'Basin');
  await pg.fill('.rq-form [name=location]', 'Master bathroom');
  await pg.check('.rq-form input[name=priority][value=high]');
  await pg.fill('.rq-form [name=notes]', 'Water pools under the basin');
  check(/Repair > Basin > Master bathroom/.test(await pg.textContent('.rq-form [data-prev]')), tag + ': the form shows Repair > Basin > Master bathroom');
  check(await overflow() <= 0, tag + ': the request form fits the width');
  await shot('3-request-form');
  await pg.click('.modal-foot button:has-text("Create request")');
  await pg.waitForSelector('.pp-dr .rq-row');
  const made = await pg.evaluate(() => { const r = O.data.unitRequests.filter((x) => x.propertyId === 'mrs' && x.item === 'Basin').pop(); const t = r && O.data.tasks.find((x) => x.id === r.taskId); return r && t && { rid: r.id, tid: t.id, req: t.requestId, title: t.title, type: t.type, pri: t.priority, who: t.assigneeId, status: r.status }; });
  check(made && made.req === made.rid && made.title === 'Repair: Basin (Master bathroom)' && made.type === 'Maintenance' && made.pri === 'high', tag + ': the task was created and linked: ' + (made && made.title));
  check(made && made.who === 's6', tag + ': the repair went to the maintenance person');
  await shot('4-unit-requests');
  await pg.click('.pp-dr .modal-x');
  await pg.evaluate((tid) => O.go('tasks', { taskId: tid, due: 'all' }), made.tid);
  await pg.waitForSelector('.modal .rq-from');
  check(/From a unit request: Repair > Basin > Master bathroom/.test(await pg.textContent('.modal .rq-from')), tag + ': the task detail says which request it is for');
  await shot('5-task-detail');
  await pg.click('.modal-foot button:has-text("Mark done")');
  await wait(900);
  let st = await pg.evaluate((rid) => { const r = O.data.unitRequests.find((x) => x.id === rid); return { status: r.status, doneAt: r.doneAt, doneBy: r.doneBy }; }, made.rid);
  check(st.status === 'done' && st.doneAt && st.doneBy === 's1', tag + ': marking the task done ticked the request');
  await pg.evaluate(() => O.go('tasks', { tab: 'requests' }));
  await pg.waitForSelector('.pg-tasks .rq-head');
  await pg.click('.pg-tasks [data-rqshow=done]');
  check(await pg.locator('.pg-tasks .rq-row.done:has-text("Basin")').count() === 1, tag + ': Tasks > Requests shows it ticked under Done');
  await shot('6-requests-done');
  /* reopen the task from its detail: the request opens again */
  await pg.evaluate((tid) => O.go('tasks', { taskId: tid, due: 'all' }), made.tid);
  await pg.waitForSelector('.modal-foot button:has-text("Reopen")');
  await pg.click('.modal-foot button:has-text("Reopen")');
  await wait(900);
  st = await pg.evaluate((rid) => O.data.unitRequests.find((x) => x.id === rid).status, made.rid);
  check(st === 'open', tag + ': reopening the task reopened the request');
  /* done from the board's move button too */
  await pg.evaluate(() => { document.querySelectorAll('.modal-back').forEach((m) => m.remove()); O.go('tasks', { tab: 'tasks', due: 'all', propertyId: 'mrs' }); });
  await pg.waitForSelector('.pg-tasks .tk-board, .pg-tasks .tk-table');
  const mv = pg.locator('[data-move="' + made.tid + '"][data-to="done"]');
  if (await mv.count()) { await mv.first().click(); await wait(900); st = await pg.evaluate((rid) => O.data.unitRequests.find((x) => x.id === rid).status, made.rid); check(st === 'done', tag + ': done from the board ticks it too'); }
  else check(false, tag + ': the board has a done button for the request task');

  /* ---- a housekeeper raises one (Request > Internet connection) ---- */
  const ownerId = await pg.evaluate(() => O.state.viewer);
  await pg.evaluate(() => { O.state.viewer = 's5'; O.emit('viewer'); O.go('tasks', { tab: 'requests' }); });
  await pg.waitForSelector('.pg-tasks .rq-head [data-rq=new]');
  await pg.click('.pg-tasks .rq-head [data-rq=new]');
  await pg.waitForSelector('.rq-form');
  await pg.selectOption('.rq-form [name=propertyId]', 'or4');
  await pg.check('.rq-form input[name=kind][value=service]');
  await pg.fill('.rq-form [name=item]', 'Internet connection');
  await pg.fill('.rq-form [name=location]', 'Whole unit');
  await pg.click('.modal-foot button:has-text("Create request")');
  await wait(300);
  const hk = await pg.evaluate(() => { const r = O.data.unitRequests.filter((x) => x.item === 'Internet connection' && x.by === 's5').pop(); const t = r && O.data.tasks.find((x) => x.id === r.taskId); return r && t && { title: t.title, by: r.by }; });
  check(hk && hk.title === 'Service: Internet connection (Whole unit)', tag + ': a housekeeper raised Service > Internet connection and its task was made');
  check(await overflow() <= 0, tag + ': Tasks > Requests fits the width');
  await shot('7-housekeeper-requests');
  /* the raiser may cancel only while the task is to do and unassigned or theirs; here it went to maintenance */
  await pg.click('.pg-tasks [data-rqshow=open]');
  const asg = await pg.evaluate(() => { const r = O.data.unitRequests.filter((x) => x.item === 'Internet connection' && x.by === 's5').pop(); const t = O.data.tasks.find((x) => x.id === r.taskId); return t.assigneeId; });
  const hkCancel = await pg.locator('.pg-tasks .rq-row:has-text("Internet connection") [data-rq=cancel]').count();
  check(asg && asg !== 's5' ? hkCancel === 0 : hkCancel > 0, tag + ': the housekeeper can cancel only while nobody else has the task');
  /* cancelling (an owner may): its open task is removed, with an audit line */
  await pg.evaluate((v) => { O.state.viewer = v; O.emit('viewer'); O.go('tasks', { tab: 'requests' }); }, ownerId);
  await pg.waitForSelector('.pg-tasks .rq-head');
  await pg.click('.pg-tasks [data-rqshow=open]');
  const row = pg.locator('.pg-tasks .rq-row:has-text("Internet connection") [data-rq=cancel]').first();
  await row.click();
  await pg.click('.modal-foot button:has-text("Cancel request")');
  await wait(300);
  const gone = await pg.evaluate(() => { const r = O.data.unitRequests.filter((x) => x.item === 'Internet connection' && x.by === 's5').pop(); return { status: r.status, task: O.data.tasks.some((t) => t.requestId === r.id) }; });
  check(gone.status === 'cancelled' && !gone.task, tag + ': cancelling the request removed its open task');
  check(await pg.evaluate(() => (O.data.auditLog || []).some((a) => /^Removed task "Service: Internet connection/.test(a.text))), tag + ': the removed task has an audit line');

  check(!errors.length, tag + ': no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

const browser = await chromium.launch();
try {
  await run(browser, { width: 390, height: 844 }, 'phone');
  await run(browser, { width: 1440, height: 900 }, 'desktop');
} finally { await browser.close(); }
console.log(fails.length ? fails.length + ' failed' : 'all checks passed');
process.exit(fails.length ? 1 : 0);
