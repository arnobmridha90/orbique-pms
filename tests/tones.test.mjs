/* Alert tunes (api/_lib/shared/tones.cjs): the catalog, a person's choice, Android channels per tune, the sound files,
 * and the phone notification using each phone's own tunes (api/_lib/alerts.js).
 *
 *   node --test tests/tones.test.mjs
 */
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import TONES from '../api/_lib/shared/tones.cjs';
import { fakeSb } from './inbox/fake-sb.mjs';
import { pushConfig, resetTokenCache, sendPush, describe, pushTone, PUSH_CHANNEL, PUSH_SOUND } from '../api/_lib/alerts.js';

test('at least 10 tunes, every one with a sound file in the web app, Android and iPhone', () => {
  assert.ok(TONES.ORDER.length >= 10, 'tunes: ' + TONES.ORDER.length);
  const files = new Set();
  const pbx = fs.readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
  const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  for (const id of TONES.ORDER) {
    const t = TONES.TUNES[id];
    assert.ok(t.name && t.notes.length, id);
    assert.ok(!files.has(t.file), 'one file per tune: ' + t.file); files.add(t.file);
    for (const dir of ['public/sounds', 'android/app/src/main/res/raw', 'ios/App/App']) {
      assert.ok(fs.statSync(new URL('../' + dir + '/' + t.file + '.wav', import.meta.url)).size > 10000, dir + '/' + t.file);
    }
    assert.ok(pbx.includes(t.file + '.wav in Resources'), 'iPhone app bundles ' + t.file);
    assert.ok(sw.includes('/sounds/' + t.file + '.wav'), 'offline copy of ' + t.file);
  }
  for (const type of TONES.TYPE_ORDER) assert.ok(TONES.TUNES[TONES.TYPES[type].tune], type);
});

test('a choice: defaults filled in, unknown values dropped, only changes saved', () => {
  assert.deepEqual(TONES.pick(null), { booking: 'chime', change: 'falling', message: 'dingding', team: 'bloop', task: 'marimba' });
  assert.deepEqual(TONES.pick({ booking: 'harp', team: 'nope', junk: 'glass' }), { booking: 'harp', change: 'falling', message: 'dingding', team: 'bloop', task: 'marimba' });
  assert.deepEqual(TONES.changes({ booking: 'harp', change: 'falling', task: 'urgent' }), { booking: 'harp', task: 'urgent' });
  assert.deepEqual(TONES.changes('x'), {});
  assert.equal(TONES.fileFor('team', { team: 'glass' }), 'orbique_glass');
  assert.equal(TONES.fileFor('team', {}), 'orbique_team');
});

test('Android channels: the default tune keeps the type\'s first channel, any other tune has its own', () => {
  assert.equal(TONES.channelId('booking', 'chime'), 'alerts_loud');
  assert.equal(TONES.channelId('change', 'falling'), 'alerts_change');
  assert.equal(TONES.channelId('team', 'bloop'), 'team_tone');
  assert.equal(TONES.channelId('booking', 'harp'), 'tone_booking_harp');
  assert.equal(TONES.channelId('team', 'urgent'), 'tone_team_urgent');
  assert.equal(TONES.channelId('booking', 'nope'), 'alerts_loud');
  assert.deepEqual(pushTone('new'), { channel: PUSH_CHANNEL, sound: PUSH_SOUND });
  assert.deepEqual(pushTone('new', { booking: 'doorbell' }), { channel: 'tone_booking_doorbell', sound: 'orbique_doorbell' });
  assert.deepEqual(pushTone('cancelled', { booking: 'doorbell' }), { channel: 'alerts_change', sound: 'orbique_change' });
  assert.deepEqual(pushTone('changed', { change: 'beeps' }), { channel: 'tone_change_beeps', sound: 'orbique_beep' });
});

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { project_id: 'orbique-test', client_email: 'alerts@orbique-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'http://oauth.test/token' };
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) });
const ORG = '00000000-0000-4000-8000-000000000001';
const msg = { title: 'New booking', lines: ['x'] };

async function pushWith(rows, failTones) {
  resetTokenCache();
  const cfg = pushConfig({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), FCM_URL: 'http://fcm.test' });
  const asked = [];
  const sb = fakeSb({ handler: (table, ops) => {
    if (table === 'push_devices' && ops[0][0] === 'select') {
      asked.push(ops[0][1]);
      if (failTones && /tones/.test(ops[0][1])) return { data: null, error: { message: 'column push_devices.tones does not exist' } };
      return { data: rows, error: null };
    }
    return { data: null, error: null };
  } });
  const sent = [];
  const fetch = async (url, init) => {
    if (url === 'http://oauth.test/token') return reply(200, { access_token: 'ya29.test', expires_in: 3600 });
    sent.push(JSON.parse(init.body).message); return reply(200, { name: 'm' });
  };
  const r = await sendPush(sb, cfg, ORG, msg, { bookingId: 'B1', kind: 'new' }, { fetch });
  return { r, sent, asked };
}

test('phone notification: each phone rings with its own chosen tune', async () => {
  const { r, sent } = await pushWith([{ token: 'a', tones: null }, { token: 'b', tones: { booking: 'harp' } }]);
  assert.equal(r, 'sent');
  const by = Object.fromEntries(sent.map((m) => [m.token, m]));
  assert.equal(by.a.android.notification.channel_id, 'alerts_loud');
  assert.equal(by.a.apns.payload.aps.sound, 'orbique_alert.wav');
  assert.equal(by.b.android.notification.channel_id, 'tone_booking_harp');
  assert.equal(by.b.android.notification.sound, 'orbique_harp');
  assert.equal(by.b.apns.payload.aps.sound, 'orbique_harp.wav');
});

test('phone notification: before the tunes column exists, every phone gets the default tunes', async () => {
  const { r, sent, asked } = await pushWith([{ token: 'a' }], true);
  assert.equal(r, 'sent');
  assert.equal(asked.length, 2);
  assert.equal(sent[0].android.notification.channel_id, 'alerts_loud');
});
