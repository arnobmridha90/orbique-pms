#!/usr/bin/env node
// Team chat (app/pages/team.js) in the local test copy, at phone (390 px) and desktop size. Not part of CI (it needs a
// browser); run it by hand after changing the page:
//
//   node scripts/build.mjs --local --out /tmp/me/orbique.html
//   NODE_PATH=<folder with playwright> node tests/team_chat_e2e.mjs file:///tmp/me/orbique.html /tmp/me/shots
//
// The menu badge counts unread messages; All staff comes first; opening a chat shows the newest message at the bottom and
// clears its count; sending a message and a photo; a new group and a direct chat (one per pair); who sees which chat
// when the viewer changes (members only); view-only and Staff Access switched off; mute; everything kept after a reload.
// Exits 1 on a failed check or a page error.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, outDir = '/tmp/team-chat-shots'] = process.argv.slice(2);
if (!url) { console.error('usage: node tests/team_chat_e2e.mjs <app url> [screenshot folder]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

const fails = [];
const check = (cond, what) => { if (cond) console.log('ok  ' + what); else { console.log('FAIL ' + what); fails.push(what); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* a small PNG (solid colour), made here so the test needs no file */
function png(w, h) {
  const crc = (buf) => { let c, crcs = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcs[n] = c >>> 0; } let x = 0xFFFFFFFF; for (const b of buf) x = crcs[(x ^ b) & 0xFF] ^ (x >>> 8); return (x ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, Buffer.from([20, 184, 166]))]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function run(browser, size, tag) {
  const phone = size.width <= 600;
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  await ctx.addInitScript('window.ORBIQUE_NOW = "2026-10-06T10:15";');
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text()); });
  await pg.route(/https:\/\/(cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com)\/.*/, (r) => r.abort());
  const boot = async () => {
    await pg.goto(url);
    await pg.waitForFunction(() => window.O && O._started && O.teamChat, null, { timeout: 20000 });
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  };
  const shot = async (name) => { await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())); await pg.screenshot({ path: path.join(outDir, tag + '-' + name + '.png') }); };
  const overflow = () => pg.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, ...[...document.querySelectorAll('.drawer, .modal')].map((d) => d.scrollWidth - d.clientWidth)));
  const as = async (id) => { await pg.evaluate((v) => { O.state.viewer = v; O.emit('viewer'); O.go('team'); }, id); await pg.waitForSelector('.pg-team .tc-rows'); await wait(150); };
  const rows = () => pg.$$eval('.pg-team .tc-row', (r) => r.map((x) => ({ id: x.dataset.chat, name: x.querySelector('.tc-name').textContent, unread: (x.querySelector('.tc-badge') || {}).textContent || '' })));
  const badge = (sel) => pg.evaluate((s) => { const b = document.querySelector(s); return b ? b.textContent : ''; }, sel);
  const open = async (id) => { await pg.click('.pg-team .tc-row[data-chat="' + id + '"]'); await pg.waitForSelector('.pg-team .tc-thread .tc-msg, .pg-team .tc-thread .tc-hello'); await wait(150); };
  const atBottom = () => pg.evaluate(() => { const th = document.querySelector('.pg-team .tc-thread'); return th && th.scrollHeight - th.scrollTop - th.clientHeight < 4; });
  const send = async (text) => { await pg.fill('.pg-team [data-tc-text]', text); await pg.click('.pg-team .tc-send'); await wait(250); };

  await boot();
  const owner = await pg.evaluate(() => O.state.viewer);
  check(owner === 's1', tag + ': the demo opens as the owner');

  /* ---- the menu ---- */
  const navBadge = phone ? null : await badge('.nav-item[data-page="team"] .nav-badge');
  if (!phone) check(navBadge === '3', tag + ': the menu shows 3 unread team messages (got ' + navBadge + ')');
  check(await pg.evaluate(() => O.teamChat.unreadTotal()) === 3, tag + ': 3 unread for the owner (2 in All staff, 1 in Housekeeping)');
  check(await pg.evaluate(() => O.NAV.some((g) => g[1].indexOf('team') >= 0) && O.t('team') === 'Team chat' && O.allowed('team')), tag + ': Team chat is in the menu and open to the owner');

  /* ---- the list ---- */
  await pg.evaluate(() => O.go('team'));
  await pg.waitForSelector('.pg-team .tc-rows .tc-row');
  let list = await rows();
  check(list.length === 3 && list[0].id === 'all' && list[0].name === 'All staff', tag + ': three chats, All staff first');
  check(list.some((r) => r.name === 'Housekeeping' && r.unread === '1') && list.some((r) => r.name === 'Wei Ling Tan'), tag + ': the group and the direct chat (named after the other person) are listed');
  if (phone) {
    check(await pg.isVisible('.pg-team .tc-list') && !(await pg.isVisible('.pg-team .tc-chat')), tag + ': the phone shows the chat list first');
    await shot('1-list');
    await open('all');
    check(await pg.isVisible('.pg-team .tc-back'), tag + ': the open chat has a back button');
  } else {
    await wait(200);
    check(await pg.evaluate(() => document.querySelector('.pg-team .tc-row.on') && document.querySelector('.pg-team .tc-row.on').dataset.chat) === 'all', tag + ': on a computer All staff opens by itself');
  }
  const msgs = await pg.$$eval('.pg-team .tc-thread .tc-msg .txt', (x) => x.map((e) => e.textContent));
  check(msgs.length === 4 && /team meeting on Friday/.test(msgs[3]), tag + ': All staff shows its 4 messages, the newest at the bottom');
  check(await atBottom(), tag + ': the thread is scrolled to the newest message');
  check(await pg.evaluate(() => O.teamChat.unreadTotal()) === 1, tag + ': opening All staff marked it read (1 left)');
  check(await overflow() <= 0, tag + ': the chat fits the width');
  await shot('2-all-staff');

  /* ---- send ---- */
  await send('Test from the owner: please check the lift in block B.');
  let last = await pg.$$eval('.pg-team .tc-thread .tc-msg', (x) => { const m = x[x.length - 1]; return { out: m.classList.contains('out'), text: m.textContent }; });
  check(last.out && /lift in block B/.test(last.text), tag + ': the message shows at the bottom as mine');
  check(await atBottom(), tag + ': still at the bottom after sending');
  /* a photo */
  await pg.setInputFiles('.pg-team [data-tc-attach]', { name: 'sink.png', mimeType: 'image/png', buffer: png(64, 48) });
  await pg.waitForSelector('.pg-team .tc-thread .tc-img img[src^="data:image"]', { timeout: 8000 });
  check(await pg.locator('.pg-team .tc-thread .tc-img').count() === 1, tag + ': a photo was sent and shows in the chat');
  /* a file of a kind that cannot be sent */
  await pg.setInputFiles('.pg-team [data-tc-attach]', { name: 'tool.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
  await wait(250);
  check(await pg.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /cannot be sent/.test(t.textContent))), tag + ': a program file is refused with a reason');
  await shot('3-sent');

  /* ---- a new group ---- */
  if (phone) { await pg.click('.pg-team [data-tc=back]'); await wait(100); }
  await pg.click('.pg-team [data-tc=new]');
  await pg.waitForSelector('.modal [data-mode]');
  await pg.click('.modal [data-mode=group]');
  await pg.fill('#tc-gname', 'Penang front desk');
  await pg.check('.modal .tc-person input[value=s4]');
  check(await overflow() <= 0, tag + ': the new chat window fits the width');
  await shot('4-new-group');
  await pg.click('.modal-foot button:has-text("Create group")');
  await pg.waitForSelector('.pg-team .tc-who-n:has-text("Penang front desk")');
  await send('Welcome to the Penang front desk group.');
  const gid = await pg.evaluate(() => O.teamChat.state().chats.find((c) => c.name === 'Penang front desk').id);
  check(!!gid, tag + ': the group was made and opened');

  /* ---- a direct chat, one per pair ---- */
  if (phone) { await pg.click('.pg-team [data-tc=back]'); await wait(100); }
  await pg.click('.pg-team [data-tc=new]');
  await pg.waitForSelector('.modal [data-pick=s6]');
  await pg.click('.modal [data-pick=s6]');
  await pg.waitForSelector('.pg-team .tc-who-n:has-text("Raju Kumar")');
  await send('Raju, can you look at the water heater in Highland Villa 2?');
  const dms = async () => pg.evaluate(() => O.teamChat.state().chats.filter((c) => c.kind === 'direct' && c.dmKey === 's1:s6').length);
  if (phone) { await pg.click('.pg-team [data-tc=back]'); await wait(100); }
  await pg.click('.pg-team [data-tc=new]');
  await pg.waitForSelector('.modal [data-pick=s6]');
  await pg.click('.modal [data-pick=s6]');
  await wait(300);
  check(await dms() === 1, tag + ': messaging the same person again opens the same chat');

  /* ---- mute ---- */
  await pg.click('.pg-team .tc-head [data-tc=mute]');
  await wait(200);
  check(await pg.evaluate(() => O.teamChat.state().chats.find((c) => c.dmKey === 's1:s6').muted), tag + ': the chat is muted');
  if (phone) { await pg.click('.pg-team [data-tc=back]'); await wait(100); }
  check(await pg.locator('.pg-team .tc-row:has-text("Raju Kumar") .tc-mute').count() === 1, tag + ': the list shows it is muted');
  await shot('5-list-after');

  /* ---- after a reload ---- */
  await boot();
  await pg.evaluate(() => O.go('team'));
  await pg.waitForSelector('.pg-team .tc-rows .tc-row');
  list = await rows();
  check(list.length === 5 && list[0].id === 'all', tag + ': after a reload the 5 chats are still there, All staff first');
  check(list.some((r) => r.id === gid), tag + ': the new group is kept');

  /* ---- other people see only their chats ---- */
  await as('s4');
  list = await rows();
  check(list.some((r) => r.id === gid && r.unread === '1'), tag + ': Arif (front desk) sees the new group with 1 unread');
  check(!list.some((r) => r.name === 'Housekeeping'), tag + ': Arif does not see the Housekeeping group he is not in');
  check(!list.some((r) => r.name === 'Raju Kumar' || r.name === 'Mei Fen Lim' && r.id !== gid), tag + ': Arif does not see the owner\'s direct chats');
  await open(gid);
  check(await pg.evaluate((g) => O.teamChat.state().chats.find((c) => c.id === g).unread, gid) === 0, tag + ': opening it clears his count');
  await pg.click('.pg-team .tc-head .tc-ic[data-tc=details]');
  await pg.waitForSelector('.tc-dets');
  check(await pg.locator('.tc-dets [data-d=rename]').count() === 0 && await pg.locator('.tc-dets [data-d=leave]').count() === 1, tag + ': someone who did not make the group cannot rename it but can leave');
  check(await overflow() <= 0, tag + ': the details window fits the width');
  await shot('6-details-member');
  await pg.click('.modal-foot button:has-text("Done")');
  await as('s5');
  list = await rows();
  check(list.some((r) => r.name === 'Housekeeping') && !list.some((r) => r.id === gid), tag + ': Siti sees Housekeeping but not the Penang group');
  check(await pg.evaluate(() => O.teamChat.messages('g-demo-hk') && O.teamChat.messages('g-demo-hk').length === 3), tag + ': Siti reads the Housekeeping messages');

  /* ---- the owner manages the group ---- */
  await as(owner);
  await open(gid);
  await pg.click('.pg-team .tc-head .tc-ic[data-tc=details]');
  await pg.waitForSelector('.tc-dets [data-d=add]');
  await pg.click('.tc-dets [data-d=add]');
  await pg.waitForSelector('.modal .tc-people input[value=s7]');
  await pg.check('.modal .tc-people input[value=s7]');
  await pg.click('.modal-foot button:has-text("Add people")');
  await wait(250);
  check(await pg.evaluate((g) => O.teamChat.state().chats.find((c) => c.id === g).members.indexOf('s7') >= 0, gid), tag + ': the maker added Grace to the group');
  await pg.click('.tc-dets [data-rm=s7]');
  await pg.click('.modal-foot button:has-text("Remove")');
  await wait(250);
  check(await pg.evaluate((g) => O.teamChat.state().chats.find((c) => c.id === g).members.indexOf('s7') < 0, gid), tag + ': and removed her again');
  await pg.click('.modal-foot button:has-text("Done")');

  /* ---- Staff Access ---- */
  await pg.evaluate(() => { O.data.staffMeta = O.data.staffMeta || {}; O.data.staffMeta.s7 = Object.assign({}, O.data.staffMeta.s7, { overrides: { 'section:team': 'none' } }); O.data.staffMeta.s6 = Object.assign({}, O.data.staffMeta.s6, { overrides: { 'section:team': 'view' } }); O.emit('data'); });
  await pg.evaluate(() => { O.state.viewer = 's7'; O.emit('viewer'); O.go('team'); });
  await wait(200);
  check(await pg.locator('.pg-team').count() === 0 && await pg.evaluate(() => !O.allowed('team') && O.teamChat.unreadTotal() === 0), tag + ': with Team chat off in Staff Access, Grace cannot open it');
  await as('s6');
  await open('all');
  check(await pg.locator('.pg-team .tc-ro').count() === 1 && await pg.locator('.pg-team [data-tc-text]').count() === 0, tag + ': view only reads but has no box to write in');
  check(!(await pg.evaluate(() => O.teamChat.state().chats.some((c) => c.kind === 'group' && c.name === 'Penang front desk'))), tag + ': Raju is not in the Penang group');
  await as(owner);
  await pg.evaluate(() => { delete O.data.staffMeta.s7.overrides; delete O.data.staffMeta.s6.overrides; O.emit('data'); });

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
