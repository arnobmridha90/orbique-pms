/* Renewing Embedded Signup tokens (they expire 60 days after they were made or last renewed): the Graph call and the
 * nightly pass in api/_lib/whatsapp-connect.js.
 *
 *   node --test tests/inbox/*.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { waConfig, renewToken } from '../../api/_lib/whatsapp.js';
import { renewTokens, RENEW_AFTER_DAYS } from '../../api/_lib/whatsapp-connect.js';

const SECRET = 'app-secret-0123456789';
const CFG = waConfig({ WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: 'verify-me', WHATSAPP_APP_ID: '2038856197030268', WHATSAPP_CONFIG_ID: '1128333519665529', WHATSAPP_GRAPH_URL: 'https://graph.test' });
const NOW = Date.parse('2026-11-20T19:00:00Z');
const days = (n) => new Date(NOW - n * 86400000).toISOString();

/* An in-memory stand-in for the few Supabase calls renewTokens makes. */
function fakeDb(db) {
  return {
    from(table) {
      const f = []; let op = 'select'; let patch = null; let lim = Infinity; let ord = null;
      const rows = () => {
        let r = db[table].filter((x) => f.every((p) => p(x)));
        if (ord) r = r.slice().sort((a, b) => (a[ord] < b[ord] ? -1 : a[ord] > b[ord] ? 1 : 0));
        return r.slice(0, lim);
      };
      const api = {
        select() { return api; },
        update(p) { op = 'update'; patch = p; return api; },
        eq(k, v) { f.push((r) => r[k] === v); return api; },
        lte(k, v) { f.push((r) => r[k] <= v); return api; },
        order(k) { ord = k; return api; },
        limit(n) { lim = n; return api; },
        maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
        then(res, rej) {
          if (op === 'update') rows().forEach((r) => Object.assign(r, patch));
          return Promise.resolve({ data: op === 'update' ? null : rows(), error: null }).then(res, rej);
        }
      };
      return api;
    }
  };
}

test('renewToken: asks Meta for a 60-day token with the app id and secret, and never logs the tokens', async () => {
  let url = '';
  const out = await renewToken(CFG, 'EAAG-old-token-abcdefgh', { fetch: async (u, init) => {
    url = u;
    assert.equal(init.headers.Authorization, undefined);
    return new Response(JSON.stringify({ access_token: 'EAAG-new-token-abcdefgh', token_type: 'bearer', expires_in: 5183944 }), { status: 200 });
  } });
  assert.deepEqual(out, { token: 'EAAG-new-token-abcdefgh', expiresIn: 5183944 });
  const q = new URL(url);
  assert.equal(q.origin + q.pathname, 'https://graph.test/v23.0/oauth/access_token');
  assert.equal(q.searchParams.get('grant_type'), 'fb_exchange_token');
  assert.equal(q.searchParams.get('set_token_expires_in_60_days'), 'true');
  assert.equal(q.searchParams.get('client_id'), '2038856197030268');
  assert.equal(q.searchParams.get('fb_exchange_token'), 'EAAG-old-token-abcdefgh');

  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    await assert.rejects(renewToken(CFG, 'EAAG-old-token-abcdefgh', { fetch: async () => new Response(JSON.stringify({ error: { code: 190, message: 'Bad token EAAG-old-token-abcdefgh with ' + SECRET } }), { status: 400 }) }));
  } finally { console.error = orig; }
  assert.ok(logged.length);
  assert.ok(logged.every((l) => !l.includes('EAAG-old-token-abcdefgh') && !l.includes(SECRET)));
});

test('renewToken: no app id or secret -> refused without calling Meta', async () => {
  let called = false;
  await assert.rejects(renewToken(waConfig({}), 't', { fetch: async () => { called = true; } }), /not set up/);
  assert.equal(called, false);
});

test('renewTokens: only tokens a week old or more; success saves the new token and clears an old failure note', async () => {
  const db = {
    whatsapp_tokens: [
      { phone_number_id: 'PN1', token: 'old-1', updated_at: days(RENEW_AFTER_DAYS) },
      { phone_number_id: 'PN2', token: 'old-2', updated_at: days(2) },
      { phone_number_id: 'PN3', token: 'old-3', updated_at: days(30) }
    ],
    whatsapp_numbers: [
      { phone_number_id: 'PN1', sync: { history: { at: 'x' } } },
      { phone_number_id: 'PN2', sync: null },
      { phone_number_id: 'PN3', sync: { renew: { at: 'before', error: 'Could not reach WhatsApp.' } } }
    ]
  };
  const asked = [];
  const out = await renewTokens(fakeDb(db), { config: CFG, now: NOW, fetch: async (u) => {
    const t = new URL(u).searchParams.get('fb_exchange_token');
    asked.push(t);
    return new Response(JSON.stringify({ access_token: 'new-' + t, expires_in: 5184000 }), { status: 200 });
  } });
  assert.deepEqual(out, { renewed: 2, failed: 0 });
  assert.deepEqual(asked, ['old-3', 'old-1']);
  const tok = Object.fromEntries(db.whatsapp_tokens.map((r) => [r.phone_number_id, r]));
  assert.equal(tok.PN1.token, 'new-old-1');
  assert.equal(tok.PN1.updated_at, new Date(NOW).toISOString());
  assert.equal(tok.PN2.token, 'old-2');
  assert.equal(tok.PN3.token, 'new-old-3');
  assert.deepEqual(db.whatsapp_numbers[0].sync, { history: { at: 'x' } });
  assert.deepEqual(db.whatsapp_numbers[2].sync, {});
});

test('renewTokens: a failure keeps the old token, notes it on the number and is tried again the next night', async () => {
  const db = {
    whatsapp_tokens: [{ phone_number_id: 'PN1', token: 'old-1', updated_at: days(10) }],
    whatsapp_numbers: [{ phone_number_id: 'PN1', sync: { history: { at: 'x' } } }]
  };
  const orig = console.error;
  console.error = () => {};
  let out;
  try {
    out = await renewTokens(fakeDb(db), { config: CFG, now: NOW, fetch: async () => new Response('{}', { status: 503 }) });
  } finally { console.error = orig; }
  assert.deepEqual(out, { renewed: 0, failed: 1 });
  assert.equal(db.whatsapp_tokens[0].token, 'old-1');
  assert.equal(db.whatsapp_tokens[0].updated_at, days(10));
  assert.equal(db.whatsapp_numbers[0].sync.history.at, 'x');
  assert.equal(db.whatsapp_numbers[0].sync.renew.at, new Date(NOW).toISOString());
  assert.match(db.whatsapp_numbers[0].sync.renew.error, /WhatsApp/);
});

test('renewTokens: without Embedded Signup settings nothing is read', async () => {
  const sb = { from() { throw new Error('should not be called'); } };
  assert.deepEqual(await renewTokens(sb, { config: waConfig({ WHATSAPP_TOKEN: 't' }) }), { renewed: 0, failed: 0, skipped: 'not-configured' });
});
