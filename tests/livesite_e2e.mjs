#!/usr/bin/env node
// The Live website page (app/pages/livesite.js) in a local test build, at desktop and phone size. Not part of CI
// (it needs a browser); run it by hand after changing the page:
//
//   node scripts/build.mjs --local --out /tmp/me/o.html
//   node tests/livesite_e2e.mjs /tmp/me/o.html /tmp/me/shots
//
// The website (www.staykozi.my/content.json and its bundled photos) and Supabase Storage are stood in for by routes,
// and the server (/api/site) by O.siteApi. Saves screenshots into the folder; exits 1 on a failed check or a page error.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { koziContentJson } from './site-content.fixture.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const [html, outDir = '/tmp/livesite-shots'] = process.argv.slice(2);
if (!html) { console.error('usage: node tests/livesite_e2e.mjs <local build .html> [screenshot folder]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

const fails = [];
const check = (cond, what) => { if (cond) console.log('ok  ' + what); else { console.log('FAIL ' + what); fails.push(what); } };
const svg = (label, hue) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="427"><rect width="640" height="427" fill="hsl(${hue},35%,45%)"/><text x="24" y="400" font-family="sans-serif" font-size="22" fill="#fff">${label}</text></svg>`;

async function open(browser, size) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: size.width > 600 ? 1 : 2, hasTouch: size.width <= 600, isMobile: size.width <= 600 });
  await ctx.addInitScript('window.ORBIQUE_NOW = "2026-10-28T10:15";');
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/net::ERR|Failed to load resource|photo upload/.test(m.text())) errors.push('console.error: ' + m.text()); });
  await pg.route('https://cdnjs.cloudflare.com/**', (r) => r.abort());
  await pg.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (r) => r.abort());
  await pg.route('https://www.staykozi.my/content.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(koziContentJson()) }));
  let hue = 0;
  await pg.route('https://www.staykozi.my/photos/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: svg(new URL(r.request().url()).pathname.replace('/photos/', ''), (hue += 47) % 360) }));
  await pg.goto('file://' + path.resolve(html));
  await pg.waitForFunction(() => window.O && O._started, null, { timeout: 15000 });
  await pg.evaluate(() => { O.go('livesite'); document.querySelectorAll('.toast').forEach((t) => t.remove()); });
  await pg.waitForSelector('.pg-live');
  return { ctx, pg, errors };
}
const shot = async (pg, name, full = false) => { await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())); await pg.screenshot({ path: path.join(outDir, name + '.png'), fullPage: full }); };
const overflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const suites = (pg) => pg.evaluate(() => O.data.siteContent.suites.map((s) => ({ id: s.id, visible: s.visible, levels: s.levels, photos: s.photos.length })));
/* a large JPEG made in the page, so the browser resizes it to all three widths */
async function jpegFile(pg, name, w, h) {
  const b64 = await pg.evaluate(([w, h]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#2c5364'); g.addColorStop(1, '#d9a441'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = '#fff'; x.font = Math.round(h / 10) + 'px sans-serif'; x.fillText('New photo', w / 12, h / 2);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, [w, h]);
  return { name, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}

async function desktop(browser) {
  const { ctx, pg, errors } = await open(browser, { width: 1440, height: 900 });
  await shot(pg, 'd1-empty');
  const access = await pg.evaluate(() => { const was = O.state.viewer, out = {}; O.data.staff.forEach((s) => { O.state.viewer = s.id; out[s.role] = out[s.role] || O.allowed('livesite'); }); O.state.viewer = was; return out; });
  check(access.owner === true && access.ops === true && access.housekeeping === false && access.accountant === false, 'who may open the page: ' + JSON.stringify(access));
  check(await pg.locator('[data-site0]').count() === 1, 'empty state asks for the website address');
  await pg.fill('[data-site0]', 'www.staykozi.my');
  await pg.click('.lv-empty [data-act=import]');
  await pg.waitForSelector('.lv-card');
  let s = await suites(pg);
  check(s.map((x) => x.id).join() === 'standard,boutique,premium', 'brought in the three units from content.json');
  check(await pg.evaluate(() => O.data.website.siteUrl) === 'https://www.staykozi.my', 'the website address is saved');
  check(await pg.locator('.lv-top .pill').innerText() === 'Changes not published', 'a fresh draft shows "Changes not published"');
  await pg.waitForTimeout(300);
  await shot(pg, 'd2-imported', true);

  // add a unit: name makes the web address, fields, a view, a highlight, a photo resized in the browser
  await pg.click('[data-addunit="vortex-klcc"]');
  await pg.waitForSelector('.lv-dr [name=name]');
  await pg.fill('.lv-dr [name=name]', 'Deluxe Suite');
  check(await pg.inputValue('.lv-dr [name=id]') === 'deluxe-suite', 'the web address follows the name');
  check((await pg.locator('.lv-dr [data-url]').innerText()).includes('www.staykozi.my/kuala-lumpur/vortex-klcc/deluxe-suite/'), 'the page address is shown');
  await pg.fill('.lv-dr [name=levels]', 'Level 45');
  await pg.fill('.lv-dr [name=line]', 'Corner suite with two walls of glass.');
  await pg.check('.lv-dr [name="view-petronas"]');
  await pg.fill('.lv-dr [data-hlin]', 'Corner windows');
  await pg.press('.lv-dr [data-hlin]', 'Enter');
  await pg.fill('.lv-dr [data-hlin]', 'Bathtub');
  await pg.click('.lv-dr [data-de=hladd]');
  check(await pg.locator('.lv-dr .lv-hl .chip').count() === 2, 'two highlights as chips');
  await pg.click('.lv-dr .lv-hl [data-hldel="1"]');
  check(await pg.locator('.lv-dr .lv-hl .chip').count() === 1, 'a highlight can be removed');
  const opts = await pg.locator('.lv-dr [name=bookType] option').allInnerTexts();
  check(opts[0] === 'Not bookable online yet (guests email us)', '"Book online as" offers email booking first');
  await pg.setInputFiles('.lv-dr [data-pmfile]', await jpegFile(pg, 'deluxe-living-room.jpg', 3000, 2000));
  await pg.waitForSelector('.lv-dr .lv-pt[data-pi="0"]', { timeout: 20000 });
  const ph = await pg.evaluate(() => { const p = O.$('.lv-dr .lv-pt[data-pi="0"] input').value; return p; });
  check(ph === 'Deluxe living room', 'the description is filled in from the file name (' + ph + ')');
  await pg.setInputFiles('.lv-dr [data-pmfile]', await jpegFile(pg, 'IMG_20251012_101010.jpg', 1000, 700));
  await pg.waitForSelector('.lv-dr .lv-pt[data-pi="1"]', { timeout: 20000 });
  await shot(pg, 'd3-unit-drawer');
  // a photo without a description stops the save
  await pg.click('.lv-dr [data-de=save]');
  check(await pg.locator('.lv-dr .lv-pt .alt.bad').count() === 1, 'a photo without a description is marked');
  check(await pg.evaluate(() => document.activeElement.matches('.lv-pt .alt.bad')), 'focus goes to the photo description to fill in');
  await pg.fill('.lv-dr .lv-pt[data-pi="1"] .alt', 'Bedroom by day');
  await pg.click('.lv-dr .lv-pt[data-pi="1"] [data-pm=cover]');
  check(await pg.inputValue('.lv-dr .lv-pt[data-pi="0"] .alt') === 'Bedroom by day', '"Make cover" moves the photo first');
  await shot(pg, 'd4-unit-photos');
  await pg.click('.lv-dr [data-de=save]');
  await pg.waitForSelector('.lv-dr', { state: 'detached' });
  const added = await pg.evaluate(() => O.data.siteContent.suites[3]);
  check(added && added.id === 'deluxe-suite' && added.visible === false && added.levels === 'Level 45', 'the new unit is saved, hidden (' + JSON.stringify(added && [added.id, added.visible, added.levels]) + ' of ' + (await suites(pg)).map((x) => x.id).join() + ')');
  check(added && added.photos.length === 2 && added.photos[1].widths.join() === '640,1280,2400' && added.photos[1].w === 2400 && added.photos[1].h === 1600, 'the large photo is made at 640, 1280 and 2400 (' + JSON.stringify(added && added.photos[1] && [added.photos[1].widths, added.photos[1].w, added.photos[1].h]) + ')');
  check(added && added.photos[0].widths.join() === '640', 'the small photo is made at 640 only');
  check(added && added.views.join() === 'petronas' && added.highlights.join() === 'Corner windows', 'views and highlights saved');

  // reorder and hide
  await pg.click('[data-moveu=up][data-i="3"]');
  s = await suites(pg);
  check(s.map((x) => x.id).join() === 'standard,boutique,deluxe-suite,premium', 'moving a unit earlier (' + s.map((x) => x.id).join() + ')');
  await pg.click('[data-showu="0"]');
  s = await suites(pg);
  check(s[0].id === 'standard' && s[0].visible === false, 'hiding Standard Suite');
  await pg.click('[data-showu="2"]');
  check((await suites(pg))[2].visible === true, 'showing the new unit');

  // the keyboard keeps its place: after a move or a switch, focus is on the same unit's button again
  const focused = () => pg.evaluate(() => { const a = document.activeElement, c = a && a.closest('[data-uk]'); return [c ? c.dataset.uk : null, a.dataset.moveu || (a.hasAttribute('data-showu') ? 'switch' : a.tagName)].join(' '); });
  await pg.focus('[data-uk="vortex-klcc/boutique"] [data-moveu=down]');
  await pg.keyboard.press('Enter');
  check(await focused() === 'vortex-klcc/boutique down', 'keyboard: focus stays on the moved unit (' + await focused() + ')');
  await pg.keyboard.press('Enter');
  check(await focused() === 'vortex-klcc/boutique up', 'keyboard: at the end, focus moves to the other arrow (' + await focused() + ')');
  await pg.keyboard.press('Enter'); await pg.keyboard.press('Enter');
  check((await suites(pg)).map((x) => x.id).join() === 'standard,boutique,deluxe-suite,premium', 'keyboard: moved back');
  await pg.focus('[data-uk="vortex-klcc/premium"] [data-showu]');
  await pg.keyboard.press('Space');
  check(await focused() === 'vortex-klcc/premium switch' && (await suites(pg))[3].visible === false, 'keyboard: the switch keeps focus (' + await focused() + ')');
  await pg.keyboard.press('Space');
  check((await suites(pg))[3].visible === true, 'keyboard: switched back on');

  // edit a field of an existing unit
  await pg.click('[data-openu="1"].lv-nm');
  await pg.fill('.lv-dr [name=levels]', 'Level 44');
  await pg.keyboard.press('Escape');
  check(await pg.locator('.modal-back h3').innerText() === 'Discard your changes?' && await pg.locator('.lv-dr').count() === 1, 'Escape with unsaved changes asks first');
  await pg.click('.modal-back .modal-foot .btn-ghost');
  await pg.click('.lv-dr .lv-pt[data-pi="2"] [data-pm=left]');
  await pg.click('.lv-dr [data-de=save]');
  const bq = await pg.evaluate(() => O.data.siteContent.suites[1]);
  check(bq.levels === 'Level 44' && bq.photos[1].key === 'boutique/01-living-room', 'editing Boutique Suite: floors and photo order');
  // photo order from the keyboard: focus follows the photo, and skips an arrow that is switched off
  await pg.click('[data-openu="1"].lv-nm');
  const pfocus = () => pg.evaluate(() => { const a = document.activeElement, t = a && a.closest('[data-pi]'); return (t ? t.dataset.pi : '-') + ' ' + (a.dataset.pm || a.tagName); });
  await pg.focus('.lv-dr [data-pi="1"] [data-pm=left]');
  await pg.keyboard.press('Enter');
  check(await pfocus() === '0 right', 'photos: moved to the cover spot, focus on its other arrow (' + await pfocus() + ')');
  await pg.keyboard.press('Enter');
  check(await pfocus() === '1 right', 'photos: moved back (' + await pfocus() + ')');
  await pg.focus('.lv-dr [data-pi="2"] [data-pm=cover]');
  await pg.keyboard.press('Enter');
  check(await pfocus() === '0 right', 'photos: Make cover keeps focus on the photo (' + await pfocus() + ')');
  await pg.focus('.lv-dr [data-pi="0"] [data-pm=del]');
  await pg.keyboard.press('Enter');
  check(await pfocus() === '0 del', 'photos: after removing, focus is on the next photo (' + await pfocus() + ')');
  check(await pg.evaluate(() => O.$('.lv-dr [data-pmadd]').tabIndex === 0), 'photos: Add photos can be reached with the keyboard');
  await pg.keyboard.press('Escape');
  await pg.click('.modal-back .modal-foot .btn:last-child');
  await pg.waitForSelector('.lv-dr', { state: 'detached' });
  check(await pg.evaluate(() => O.data.siteContent.suites[1].photos.map((p) => p.key).join()) === bq.photos.map((p) => p.key).join(), 'photos: discarded changes leave the unit as it was');

  // someone else changes the list while a drawer is open: Save and Remove find the unit by its web address
  const before = await pg.evaluate(() => JSON.parse(JSON.stringify(O.data.siteContent)));
  await pg.click('[data-uk="vortex-klcc/premium"] .lv-nm');
  await pg.evaluate(() => { const c = JSON.parse(JSON.stringify(O.data.siteContent)); c.suites.unshift(c.suites.pop()); O.sync.remote([], [{ key: 'siteContent', data: c }]); });
  await pg.fill('.lv-dr [name=levels]', 'Level 46');
  await pg.click('.lv-dr [data-de=save]');
  const after = await pg.evaluate(() => O.data.siteContent.suites.map((s) => s.id + ':' + s.levels));
  check(after.join() === ['premium:Level 46'].concat(before.suites.slice(0, 3).map((s) => s.id + ':' + s.levels)).join(), 'a unit saved after someone reordered the list is the right one (' + after.join() + ')');
  await pg.click('[data-uk="vortex-klcc/deluxe-suite"] .lv-nm');
  await pg.evaluate(() => { const c = JSON.parse(JSON.stringify(O.data.siteContent)); c.suites = c.suites.filter((s) => s.id !== 'deluxe-suite'); O.sync.remote([], [{ key: 'siteContent', data: c }]); });
  await pg.click('.lv-dr [data-de=remove]');
  check(/Someone else removed this unit/.test(await pg.locator('.toast').last().innerText()) && await pg.locator('.lv-dr').count() === 1, 'removing a unit someone else removed says so, and removes nothing else');
  await pg.click('.lv-dr [data-de=save]');
  check(await pg.evaluate(() => O.data.siteContent.suites.length) === 3, 'saving it does not overwrite another unit');
  await pg.click('.lv-dr [data-de=cancel]');
  await pg.click('.modal-back .modal-foot .btn:last-child').catch(() => {});
  await pg.evaluate((c) => { O.sync.remote([], [{ key: 'siteContent', data: c }]); O.render(false); }, before);
  await pg.waitForTimeout(100);
  check((await suites(pg)).map((x) => x.id).join() === 'standard,boutique,deluxe-suite,premium', 'the list is back as it was');

  // bundled photos picker
  await pg.click('[data-openu="1"].lv-nm');
  await pg.click('.lv-dr [data-pm="del"][data-i="0"]');
  await pg.click('.lv-dr [data-pm=builtin]');
  await pg.waitForSelector('.lv-pick');
  await pg.waitForTimeout(300);
  await shot(pg, 'd5-bundled');
  await pg.check('.lv-pick [data-bi="3"]');
  await pg.click('.modal-back .modal-foot .btn-primary');
  await pg.click('.lv-dr [data-de=save]');
  const bq2 = await pg.evaluate(() => O.data.siteContent.suites[1].photos.map((p) => p.key));
  check(bq2.join() === 'boutique/01-living-room,boutique/10-klcc-night-view,boutique/07-bathroom', 'a bundled photo removed and another added back (' + bq2.join() + ')');

  // a building: rename its web address and the units follow
  await pg.click('[data-openb="0"].t1');
  await pg.fill('.lv-dr [name=id]', 'vortex');
  await pg.click('.lv-dr [data-de=save]');
  check(await pg.evaluate(() => O.data.siteContent.suites.every((s) => s.buildingId === 'vortex')), 'units follow the building\'s new web address');
  await pg.click('[data-openb="0"].t1');
  await pg.fill('.lv-dr [name=id]', 'vortex-klcc');
  await pg.click('.lv-dr [data-de=save]');

  // publish (the test copy keeps it in this browser)
  await shot(pg, 'd6-before-publish', true);
  await pg.click('.lv-top [data-act=publish]');
  await pg.waitForSelector('#lv-publish-go');
  const lines = await pg.locator('.modal-back ul.lv-chg:not(.warn) li').allInnerTexts();
  check(lines[0] && lines[0].startsWith('First publish'), 'the confirm lists the change (' + lines.join(' | ') + ')');
  await shot(pg, 'd7-publish-confirm');
  await pg.click('#lv-publish-go');
  await pg.waitForFunction(() => O.data.siteContentLive && O.data.siteContentLive.content);
  check(await pg.locator('.lv-top .pill').innerText() === 'Up to date', 'after publishing: "Up to date"');
  check(/^Published /.test(await pg.locator('[data-status]').innerText()), 'the published time shows');
  await pg.click('[data-showu="0"]');
  await pg.click('.lv-top [data-act=publish]');
  const lines2 = await pg.locator('.modal-back ul.lv-chg:not(.warn) li').allInnerTexts();
  check(lines2.join() === 'Standard Suite shown', 'the second publish lists only "Standard Suite shown" (' + lines2.join(' | ') + ')');
  await pg.click('.modal-back .modal-foot .btn-ghost');

  // the server: signed upload URLs and the publish answer are stood in for
  const puts = [];
  await pg.route('https://upload.test/**', async (r) => { puts.push({ url: r.request().url(), method: r.request().method(), upsert: r.request().headers()['x-upsert'], size: (r.request().postDataBuffer() || Buffer.alloc(0)).length }); await r.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"x"}' }); });
  await pg.evaluate(() => {
    window.__calls = [];
    const base = 'https://proj.supabase.co/storage/v1/object/public/site-photos/org1/';
    O.siteApi = function (action, body) {
      window.__calls.push([action, body]);
      if (action === 'upload-urls') return { ok: true, photos: [{ id: 'p-test1', base: base + 'p-test1', widths: body.widths, uploads: body.widths.map((w) => ({ width: w, path: 'org1/p-test1-' + w + '.jpg', signedUrl: 'https://upload.test/p-test1-' + w + '.jpg?token=t', token: 't' })) }], maxBytes: 3145728 };
      if (action === 'publish') { const live = { content: O.sitecontent.check(O.data.siteContent, { strict: false }).content, publishedAt: '2026-10-28T02:30:00Z', publishedBy: 'Arnob', history: [] }; return { ok: true, live, publishedAt: live.publishedAt, publishedBy: 'Arnob', refreshed: 7, failed: [], note: null, warnings: [] }; }
      throw new Error('unknown');
    };
    O.render(false);
  });
  await pg.click('[data-openu="2"].lv-nm');
  await pg.setInputFiles('.lv-dr [data-pmfile]', await jpegFile(pg, 'deluxe-bathroom.jpg', 2600, 1700));
  await pg.waitForSelector('.lv-dr .lv-pt[data-pi="2"]', { timeout: 20000 });
  const up = await pg.evaluate(() => O.$('.lv-dr .lv-pt[data-pi="2"] input').value);
  check(puts.length === 3 && puts.every((p) => p.method === 'PUT' && p.upsert === 'true' && p.size > 1000), 'three sizes sent with PUT to the signed URLs (' + puts.map((p) => p.size).join(', ') + ' bytes)');
  check(up === 'Deluxe bathroom', 'the uploaded photo keeps its description');
  await pg.click('.lv-dr [data-de=save]');
  const srvPhoto = await pg.evaluate(() => O.data.siteContent.suites[2].photos[2]);
  check(srvPhoto.base === 'https://proj.supabase.co/storage/v1/object/public/site-photos/org1/p-test1' && srvPhoto.kind === 'upload', 'the photo points at the storage folder');
  await pg.click('.lv-top [data-act=publish]');
  await pg.click('#lv-publish-go');
  await pg.waitForFunction(() => O.data.siteContentLive.publishedBy === 'Arnob');
  const call = await pg.evaluate(() => window.__calls.filter((c) => c[0] === 'publish')[0]);
  check(call && /^[0-9a-f]{8}$/.test(call[1].draftHash), 'publish sends the draft hash');
  check(await pg.locator('.lv-top .pill').innerText() === 'Up to date', 'the server\'s answer is applied');
  check(await pg.locator('.lv-card a.lv-ib').count() >= 2, '"View on site" links for the published units');
  await shot(pg, 'd8-published', true);
  check(await overflow(pg) <= 1, 'no sideways scroll at desktop size');
  errors.forEach((e) => check(false, e));
  await ctx.close();
}

/* the site's address answers content.json but does not have the photos yet: thumbnails come from the preview site */
async function fallback(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await pg.route('https://cdnjs.cloudflare.com/**', (r) => r.abort());
  await pg.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (r) => r.abort());
  await pg.route('https://www.staykozi.my/**', (r) => r.fulfill({ status: 404, body: 'not here' }));
  await pg.route('https://staykozi-my-next.vercel.app/content.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(koziContentJson()) }));
  await pg.route('https://staykozi-my-next.vercel.app/photos/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg('preview', 200) }));
  await pg.goto('file://' + path.resolve(html));
  await pg.waitForFunction(() => window.O && O._started, null, { timeout: 15000 });
  await pg.evaluate(() => O.go('livesite'));
  await pg.click('.lv-empty [data-act=import]');
  check(await pg.locator('.lv-card').count() === 0 && /Add your website address first/.test(await pg.locator('.toast').last().innerText()), 'fallback: bringing in asks for the address first');
  await pg.fill('[data-site0]', 'www.staykozi.my');
  await pg.click('.lv-empty [data-act=import]');
  await pg.waitForSelector('.lv-card');
  await pg.waitForFunction(() => [...document.querySelectorAll('.pg-live img')].every((i) => i.complete), null, { timeout: 10000 });
  const imgs = await pg.evaluate(() => [...document.querySelectorAll('.pg-live img')].map((i) => [i.currentSrc || i.src, i.naturalWidth]));
  check(imgs.length >= 3 && imgs.every((x) => x[0].startsWith('https://staykozi-my-next.vercel.app/photos/') && x[1] > 0), 'fallback: card photos come from the site that answered (' + imgs.map((x) => x[0].replace(/^https:\/\/[^/]+/, '') + ' ' + x[1]).join(', ') + ')');
  // later visits (nothing fetched yet): a photo that is not on the address is tried on the preview site
  await pg.evaluate(() => { O.data.website.siteUrl = 'https://www.staykozi.my'; location.reload(); });
  await pg.waitForFunction(() => window.O && O._started, null, { timeout: 15000 });
  await pg.evaluate(() => O.go('livesite'));
  await pg.waitForSelector('.lv-card');
  await pg.waitForFunction(() => [...document.querySelectorAll('.pg-live img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 10000 }).catch(() => {});
  const imgs2 = await pg.evaluate(() => [...document.querySelectorAll('.pg-live img')].map((i) => [i.src, i.naturalWidth]));
  check(imgs2.length >= 3 && imgs2.every((x) => x[1] > 0), 'fallback: after a reload the photos still show (' + imgs2.map((x) => x[0].replace(/^https:\/\/([^/]+).*$/, '$1') + ' ' + x[1]).join(', ') + ')');
  await shot(pg, 'f1-fallback-photos');
  errors.forEach((e) => check(false, 'fallback ' + e));
  await ctx.close();
}

async function phone(browser) {
  const { ctx, pg, errors } = await open(browser, { width: 390, height: 844 });
  await shot(pg, 'p1-empty');
  check(await overflow(pg) <= 1, 'phone: no sideways scroll (empty)');
  await pg.fill('[data-site0]', 'https://www.staykozi.my');
  await pg.tap('.lv-empty [data-act=import]');
  await pg.waitForSelector('.lv-card');
  await pg.waitForTimeout(300);
  await shot(pg, 'p2-list', true);
  check(await overflow(pg) <= 1, 'phone: no sideways scroll (list)');
  await pg.tap('[data-addunit="vortex-klcc"]');
  await pg.fill('.lv-dr [name=name]', 'Family Suite');
  await pg.fill('.lv-dr [name=sleeps]', '6');
  await pg.setInputFiles('.lv-dr [data-pmfile]', await jpegFile(pg, 'family-suite-kitchen.jpg', 2000, 3000));
  await pg.waitForSelector('.lv-dr .lv-pt[data-pi="0"]', { timeout: 20000 });
  await shot(pg, 'p3-drawer');
  await pg.locator('.lv-dr [data-photos]').scrollIntoViewIfNeeded();
  await shot(pg, 'p4-drawer-photos');
  await pg.tap('.lv-dr [data-de=save]');
  await pg.waitForSelector('.lv-dr', { state: 'detached' });
  const f = await pg.evaluate(() => O.data.siteContent.suites[3]);
  check(f && f.id === 'family-suite' && f.sleeps === 6 && f.photos[0].w === 1280 && f.photos[0].h === 1920, 'phone: unit added with a portrait photo, never made larger than it is (' + JSON.stringify(f && [f.photos[0].w, f.photos[0].h]) + ')');
  await pg.tap('[data-moveu=up][data-i="3"]');
  await pg.tap('[data-moveu=down][data-i="0"]');
  await pg.tap('[data-showu="2"]');
  const s = await suites(pg);
  check(s.map((x) => x.id + ':' + x.visible).join() === 'boutique:true,standard:true,family-suite:true,premium:true', 'phone: reorder and show (' + s.map((x) => x.id + ':' + x.visible).join() + ')');
  await pg.tap('[data-showu="3"]');
  check((await suites(pg))[3].visible === false, 'phone: hide');
  await shot(pg, 'p5-after', true);
  await pg.tap('.lv-top [data-act=publish]');
  await pg.waitForSelector('#lv-publish-go');
  await shot(pg, 'p6-confirm');
  check(await overflow(pg) <= 1, 'phone: no sideways scroll (after edits)');
  errors.forEach((e) => check(false, 'phone ' + e));
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox'] });
try {
  await desktop(browser);
  await fallback(browser);
  await phone(browser);
} catch (e) {
  fails.push('crashed: ' + (e && e.stack || e));
  console.log(e);
} finally {
  await browser.close();
}
console.log(fails.length ? fails.length + ' failed' : 'all passed', '- screenshots in', outDir);
process.exit(fails.length ? 1 : 0);
