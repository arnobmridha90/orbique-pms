#!/usr/bin/env node
// Every word on screen in the chosen language (app/core.js I18N, app/i18n/*.js), in the local test copy at phone (390 px)
// and desktop size. Not part of CI (it needs a browser; CI runs scripts/i18n-extract.mjs --check instead); run it by hand
// after adding screens:
//
//   node scripts/build.mjs --local --out /tmp/me/orbique.html
//   NODE_PATH=<folder with playwright> node tests/i18n_e2e.mjs file:///tmp/me/orbique.html /tmp/me/shots [bn,ms,zh]
//   ... --harvest out.json   (English only: every text the crawl saw, for finding strings the catalog lacks)
//
// For each language: switch in the menu (no reload) and check the menu, the title and the page changed at once; reload
// and check the choice was kept; visit every page in the menu, its tabs and its header buttons, plus the booking drawer,
// the new booking and new task forms, a staff member's access, Team chat, the language / notifications / viewer menus,
// the calendar and the door-code dialog. On each screen it reads every text node and every placeholder / title /
// aria-label / alt, takes out what is data (names, units, messages: every string in the workspace's data), brand names,
// numbers and codes, and fails on English UI words left over. Screenshots of each screen go to the folder. Exits 1 on a
// failed check or a page error.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const argv = process.argv.slice(2);
const hi = argv.indexOf('--harvest'); const harvest = hi >= 0 ? argv.splice(hi, 2)[1] : null;
const [url, outDir = '/tmp/i18n-shots', langArg = 'bn,ms,zh'] = argv;
if (!url) { console.error('usage: node tests/i18n_e2e.mjs <app url> [screenshot folder] [bn,ms,zh] [--harvest out.json]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const LANGS = harvest ? ['en'] : langArg.split(',');

const fails = [];
const check = (cond, what) => { if (cond) console.log('ok  ' + what); else { console.log('FAIL ' + what); fails.push(what); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* words that are the same in every language: brands, units, codes */
const KEEP = ['Orbique', 'Kozi', 'Airbnb', 'Booking.com', 'Agoda', 'Trip.com', 'Expedia', 'Vrbo', 'Channex', 'WhatsApp', 'Google', 'Gmail', 'Facebook', 'Instagram', 'TikTok', 'YouTube', 'OpenStreetMap', 'OpenFreeMap', 'MapLibre', 'Supabase', 'Vercel', 'Stripe', 'PayPal', 'Wi-Fi', 'WiFi', 'PDF', 'CSV', 'URL', 'SST', 'GST', 'MyInvois', 'LHDN', 'TTLock', 'Tuya', 'Yale', 'Samsung', 'Schlage', 'Igloohome', 'iPhone', 'Android', 'iOS', 'Apple', 'Chrome', 'Safari', 'Telegram', 'WeChat', 'Line', 'SMS', 'OTP', 'QR', 'API', 'ID', 'OK', 'AM', 'PM', 'Hokkien', 'English', 'Bangla', 'Bahasa', 'Malaysia', 'MS', 'EN', 'Sdn', 'Bhd', 'Grab', 'Touch', 'Shopee', 'Lazada', 'iCal', 'Excel', 'Zoom', 'Waze', 'Maps', 'DuitNow', 'FPX', 'GrabPay', 'Boost', 'TNG', 'eWallet', 'Visa', 'Mastercard', 'AMEX', 'JPG', 'PNG', 'MB', 'KB', 'GB', 'km', 'cm', 'kg', 'AC', 'TV', 'ADR', 'RevPAR', 'KPI', 'OTA', 'iCloud', 'Dropbox', 'Bluetooth', 'NFC', 'USB', 'HDMI', 'Netflix', 'Ngrok', 'Unifi', 'Maxis', 'Celcom', 'Digi', 'TIME', 'TNB', 'SAJ', 'IWK', 'Astro', 'Penang', 'Melaka', 'Kuala', 'Lumpur', 'Langkawi', 'Cameron', 'Highlands', 'Johor', 'Bahru', 'Selangor', 'Sabah', 'Sarawak', 'Ipoh', 'Bangsar', 'KLCC', 'Bukit', 'Bintang', 'Mont', 'Kiara', 'Petaling', 'Jaya', 'Singapore', 'Thailand', 'Indonesia', 'Bangkok', 'Bali', 'Gemini', 'Claude', 'OpenAI', 'Anthropic', 'Capacitor', 'Lim', 'Tan', 'Mei', 'Fen', 'Wei', 'Ling', 'WebP', 'SVG', 'Word', 'Didot', 'serif', 'sans', 'mono'];

async function run(browser, size, tag, harvestSet) {
  const phone = size.width <= 600;
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  await ctx.addInitScript('window.ORBIQUE_NOW = "2026-10-06T10:15";');
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/net::ERR|Failed to load resource|ERR_FILE_NOT_FOUND/.test(m.text())) errors.push('console.error: ' + m.text()); });
  pg.on('dialog', (d) => d.dismiss().catch(() => {}));
  await pg.route(/https:\/\/(cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com|[a-z.]*openstreetmap\.org|[a-z.]*openfreemap\.org)\/.*/, (r) => r.abort());
  await pg.goto(url);
  await pg.waitForFunction(() => window.O && O._started, null, { timeout: 30000 });
  const lang = tag.split('-')[0];

  /* everything the workspace holds as data: those strings may stay as written */
  const dataWords = await pg.evaluate(() => {
    const out = new Set(), seen = new Set();
    const add = (s) => { s = String(s).trim(); if (s.length > 1 && s.length < 400) out.add(s); };
    const walk = (v, depth) => { if (v == null || depth > 7) return; if (typeof v === 'string') return add(v); if (typeof v !== 'object' || seen.has(v)) return; seen.add(v); if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1)); else Object.keys(v).forEach((k) => walk(v[k], depth + 1)); };
    walk(O.data, 0); walk(O.workspaces, 0); walk(O.placeData, 0);
    for (const x of [...out]) if (x.includes(', ')) for (const p of x.split(', ')) add(p); /* "Gurney Drive, Penang" */
    try { walk(O.teamChat && O.teamChat.state(), 0); } catch (e) {}
    return [...out];
  });

  const closeAll = async () => {
    await pg.keyboard.press('Escape').catch(() => {});
    await pg.evaluate(() => { document.querySelectorAll('.modal-back, .drawer-back, .drawer-wrap, .toast').forEach((m) => m.remove()); document.querySelectorAll('.pop-menu.open, .open[id$="-menu"]').forEach((m) => m.classList.remove('open')); document.body.classList.remove('no-scroll', 'modal-open'); });
  };
  /* every text node, placeholder, title, aria-label and alt now in the page (not the guest's own app or a website preview) */
  const collect = () => pg.evaluate(() => {
    const out = [];
    const skip = (el) => el.closest('[data-no-i18n], script, style, textarea, noscript, code, [contenteditable="true"], #guest-root, .gx');
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) { const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (t && /[A-Za-z]/.test(t) && n.parentElement && !skip(n.parentElement)) out.push(t); }
    for (const el of document.querySelectorAll('[placeholder], [title], [aria-label], [alt]')) { if (skip(el)) continue; for (const a of ['placeholder', 'title', 'aria-label', 'alt']) { const v = el.getAttribute(a); if (v && /[A-Za-z]/.test(v)) out.push(v.replace(/\s+/g, ' ').trim()); } }
    out.push(document.title);
    return out;
  });
  const leftovers = {}; let screens = 0;
  const step = async (name, { shotIt = true } = {}) => {
    await wait(120);
    const texts = await collect();
    screens++;
    if (harvestSet) { for (const t of texts) harvestSet.set(t, harvestSet.get(t) || name); }
    else for (const t of texts) { const bad = english(t, lang, dataWords); if (bad) (leftovers[t] = leftovers[t] || { at: name, words: bad }); }
    if (shotIt && !harvestSet) await pg.screenshot({ path: path.join(outDir, tag + '-' + name.replace(/[^a-z0-9-]+/gi, '_') + '.png') }).catch(() => {});
  };
  const overflow = () => pg.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, ...[...document.querySelectorAll('.drawer, .modal')].map((d) => d.scrollWidth - d.clientWidth)));

  /* ---- switching the language ---- */
  if (lang !== 'en') {
    await pg.evaluate(() => O.go('dashboard')); await wait(300);
    const before = await pg.evaluate(() => document.querySelector('#tb-title').textContent);
    if (phone) await pg.evaluate(() => document.querySelector('#lang-btn').click()); else await pg.click('#lang-btn');
    await pg.click('#lang-menu [data-lang="' + lang + '"]');
    await wait(400);
    const after = await pg.evaluate(() => ({ title: document.querySelector('#tb-title').textContent, nav: [...document.querySelectorAll('.nav-item')].map((x) => x.textContent.trim()).join('|'), lang: O.state.lang, html: document.documentElement.lang, saved: O.store.get('lang', 'en') }));
    check(after.lang === lang && after.saved === lang, tag + ': the language menu switches to ' + lang + ' and keeps it');
    check(after.title !== before && !/Dashboard/.test(after.title) && !/Dashboard|Bookings|Calendar/.test(after.nav), tag + ': the title and the menu change at once, without a reload (' + after.title + ')');
    await pg.reload();
    await pg.waitForFunction(() => window.O && O._started, null, { timeout: 30000 });
    check(await pg.evaluate((l) => O.state.lang === l && document.querySelector('#tb-title').textContent !== 'Dashboard', lang), tag + ': after a reload the app is still in ' + lang);
  }

  /* ---- every page in the menu, its tabs and its header buttons ---- */
  const pages = await pg.evaluate(() => O.NAV.flatMap((g) => g[1]).filter((p) => O.pages[p] && O.allowed(p)));
  for (const id of pages) {
    await closeAll();
    await pg.evaluate((p) => O.go(p), id); await wait(350);
    await step('page-' + id);
    if (!phone || ['dashboard', 'tasks', 'calendar', 'staff', 'team', 'bookings'].includes(id)) {
      const ov = await overflow(); check(ov <= 2, tag + ': ' + id + ' fits the width (' + ov + ' px over)');
    }
    /* tabs */
    const tabs = await pg.evaluate(() => [...document.querySelectorAll('#page-root [role=tab], #page-root .tabs button, #page-root .seg button, #page-root [data-tab]')].filter((b) => b.offsetParent && !b.closest('.modal, .drawer')).slice(0, 10).map((b, i) => { b.setAttribute('data-i18n-e2e', 't' + i); return 't' + i; }));
    for (const t of tabs) {
      const ok = await pg.evaluate((k) => { const b = document.querySelector('[data-i18n-e2e="' + k + '"]'); if (!b) return false; b.click(); return true; }, t);
      if (ok) await step('page-' + id + '-tab-' + t, { shotIt: false });
    }
    /* header buttons (New booking, New task, Export...) */
    await pg.evaluate((p) => O.go(p), id); await wait(250);
    const acts = await pg.evaluate(() => [...document.querySelectorAll('#tb-actions button, #page-root .page-head button.btn-primary')].filter((b) => b.offsetParent).slice(0, 3).map((b, i) => { b.setAttribute('data-i18n-e2e', 'a' + i); return 'a' + i; }));
    for (const a of acts) {
      await pg.evaluate((k) => { const b = document.querySelector('[data-i18n-e2e="' + k + '"]'); if (b) b.click(); }, a);
      await wait(250);
      if (await pg.$('.modal, .drawer')) await step('page-' + id + '-action-' + a);
      await closeAll();
      await pg.evaluate((p) => { if (O.state.page !== p) O.go(p); }, id); await wait(150);
    }
    /* the first row or card that opens something */
    const opened = await pg.evaluate(() => { const r = document.querySelector('#page-root [data-row], #page-root tr[data-id], #page-root .list-row[data-id], #page-root [data-task], #page-root [data-open], #page-root [data-bk]'); if (!r) return false; r.click(); return true; });
    if (opened) { await wait(300); if (await pg.$('.modal, .drawer')) await step('page-' + id + '-row'); await closeAll(); }
  }

  /* ---- key drawers and forms ---- */
  await closeAll();
  await pg.evaluate(() => { O.go('bookings'); const b = O.data.bookings.filter((x) => x.status !== 'cancelled')[0]; O.booking.open(b.id); }); await wait(400);
  await step('drawer-booking'); check(await overflow() <= 2, tag + ': the booking drawer fits the width');
  await closeAll();
  await pg.evaluate(() => { O.go('bookings'); O.newBooking({}); }); await wait(400);
  await step('form-new-booking'); check(await overflow() <= 2, tag + ': the new booking form fits the width');
  await closeAll();
  await pg.evaluate(() => O.go('tasks')); await wait(300);
  await pg.evaluate(() => { const b = document.querySelector('#tb-actions [data-act="new"], #page-root [data-act="new"], #page-root [data-act2="new"]'); if (b) b.click(); }); await wait(400);
  await step('form-new-task'); check(await overflow() <= 2, tag + ': the new task form fits the width');
  await closeAll();
  await pg.evaluate(() => O.go('tasks')); await wait(300);
  await pg.evaluate(() => { const r = document.querySelector('#page-root [data-task], #page-root [data-id]'); if (r) r.click(); }); await wait(400);
  await step('drawer-task');
  await closeAll();
  await pg.evaluate(() => O.go('staff')); await wait(300);
  await pg.evaluate(() => { const r = document.querySelector('#page-root [data-staff], #page-root [data-member], #page-root [data-edit], #page-root .list-row, #page-root tbody tr'); if (r) r.click(); }); await wait(400);
  await step('staff-access-member');
  await closeAll();
  await pg.evaluate(() => O.go('team')); await wait(300);
  await pg.evaluate(() => { const r = document.querySelector('.pg-team .tc-row[data-chat="all"]'); if (r) r.click(); }); await wait(400);
  await step('team-chat-open');
  await pg.evaluate(() => { const b = document.querySelector('.pg-team [data-tc=new]'); if (b) b.click(); }); await wait(300);
  await step('team-chat-new');
  await closeAll();
  await pg.evaluate(() => O.go('calendar')); await wait(400);
  await step('calendar');
  await closeAll();
  for (const [btn, name] of [['#lang-btn', 'menu-language'], ['#bell-btn', 'menu-notifications'], ['#viewer-btn', 'menu-viewer'], ['#ws-btn', 'menu-workspace']]) {
    await pg.evaluate(() => O.go('dashboard')); await wait(200);
    if (phone) await pg.evaluate(() => { const m = document.querySelector('#menu-btn'); if (m) m.click(); });
    await pg.evaluate((s) => { const b = document.querySelector(s); if (b) b.click(); }, btn); await wait(250);
    await step(name);
    await closeAll();
  }
  await pg.evaluate(() => { O.go('dashboard'); if (O.lock && O.lock.change) O.lock.change({}); }); await wait(400);
  await step('door-code');
  await closeAll();
  /* toasts and the browser's own boxes go through the same words */
  if (lang !== 'en') {
    const toast = await pg.evaluate(() => new Promise((res) => { O.ui.toast('Saved'); setTimeout(() => { const t = [...document.querySelectorAll('.toast')].pop(); res(t ? t.textContent : ''); }, 100); }));
    check(toast && !/\bSaved\b/.test(toast), tag + ': a toast is translated (' + toast + ')');
    const dt = await pg.evaluate(() => O.d.fmt('2026-10-06') + ' | ' + O.d.monthName('2026-10-06', true) + ' | ' + O.fmt.plural(3, 'night') + ' | ' + O.fmt.ago('2026-10-06T09:10'));
    check(!/Oct|October|nights|ago/.test(dt), tag + ': dates, plurals and relative times are in ' + lang + ' (' + dt + ')');
  }
  check(errors.length === 0, tag + ': no page errors' + (errors.length ? ' (' + errors.slice(0, 3).join(' | ') + ')' : ''));
  const left = Object.keys(leftovers);
  if (!harvestSet) {
    check(left.length === 0, tag + ': no English UI text left on ' + screens + ' screens' + (left.length ? ' (' + left.length + ' texts)' : ''));
    if (left.length) { fs.writeFileSync(path.join(outDir, tag + '-leftovers.json'), JSON.stringify(leftovers, null, 1)); for (const t of left.slice(0, 40)) console.log('     ' + JSON.stringify(t).slice(0, 140) + '  [' + leftovers[t].words.join(' ') + '] @' + leftovers[t].at); }
  }
  await ctx.close();
}

/* the English words left in a text after taking out data, brands, numbers and codes (null when there are none) */
let EN_WORDS = null, MS_WORDS = null;
function english(t, lang, data) {
  if (!EN_WORDS) {
    EN_WORDS = new Set(); MS_WORDS = new Set();
    const ctx = { O: {} }; ctx.window = ctx;
    for (const l of ['ms']) { const p = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../app/i18n/' + l + '.js'); if (fs.existsSync(p)) new Function('window', 'O', fs.readFileSync(p, 'utf8'))(ctx, ctx.O); }
    const tr = (ctx.O.I18N || {}).ms || {};
    for (const k of Object.keys(tr)) { for (const w of k.match(/[A-Za-z]{3,}/g) || []) EN_WORDS.add(w.toLowerCase()); for (const w of tr[k].match(/[A-Za-z]{3,}/g) || []) MS_WORDS.add(w.toLowerCase()); }
  }
  let s = ' ' + t + ' ';
  /* data first, longest first, so "Highland Villa 2" goes before "Villa" */
  if (!english.sorted) english.sorted = data.filter((x) => /[A-Za-z]/.test(x)).sort((a, b) => b.length - a.length);
  for (const x of english.sorted) if (x.length >= 3 && s.toLowerCase().includes(x.toLowerCase())) s = s.replace(new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  s = s.replace(/\{[A-Za-z0-9_]+\}/g, ' ').replace(/#[0-9A-Fa-f]{3,8}\b/g, ' '); /* {guest_first} in a greeting, #FFFFFF */
  s = s.replace(/https?:\/\/\S+|\S+@\S+|\b[\w-]+\.(?:com|site|my|app|io|org|net)\b\S*/g, ' ');
  for (const k of KEEP) s = s.split(k).join(' ');
  s = s.replace(/\b[A-Z]{2,5}\b/g, ' ').replace(/\b[A-Z]*\d[\w-]*\b/g, ' ');
  /* the parts of people's names in the data ("Noah" of "Noah Williams", shown alone on a calendar bar) */
  if (!english.names) { english.names = new Set(); for (const x of data) if (/^[A-Z][a-z'’-]+(?: [A-Z][A-Za-z'’.-]*){1,3}$/.test(x)) for (const w of x.split(' ')) english.names.add(w.replace(/[.]$/, '')); }
  const words = (s.match(/[A-Za-z]{3,}/g) || []).filter((w) => !(w[0] === w[0].toUpperCase() && (english.names.has(w) || data.some((x) => x === w))));
  if (!words.length) return null;
  if (lang === 'ms') { const en = words.filter((w) => EN_WORDS.has(w.toLowerCase()) && !MS_WORDS.has(w.toLowerCase())); return en.length ? en : null; }
  return words;
}

const browser = await chromium.launch();
if (harvest) {
  const set = new Map();
  await run(browser, { width: 1280, height: 860 }, 'en-desktop', set);
  await run(browser, { width: 390, height: 844 }, 'en-phone', set);
  fs.writeFileSync(harvest, JSON.stringify([...set].map(([t, at]) => ({ t, at })), null, 1));
  console.log('harvested ' + set.size + ' texts into ' + harvest);
} else {
  for (const l of LANGS) {
    await run(browser, { width: 390, height: 844 }, l + '-phone');
    await run(browser, { width: 1280, height: 860 }, l + '-desktop');
  }
}
await browser.close();
if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
console.log('\nall passed');
