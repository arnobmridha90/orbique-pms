/* Translation key check (api/_lib/translate.js): a key that cannot go in an HTTP header is reported plainly.
 *
 *   node --test tests/translate_key.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { translate, TranslateError } from '../api/_lib/translate.js';

const ok = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: '{"lang":"en","text":"Hi"}' }] }) });

test('a key with a space or line break inside is named as the problem, before any request', async () => {
  let called = 0;
  for (const key of ['sk-ant abc', 'sk-ant\nabc', 'sk-ant“abc']) {
    await assert.rejects(translate({ key, model: 'm' }, 'Hello', 'bn', { fetch: async () => { called++; return ok(); } }), (e) => e instanceof TranslateError && /stray space/.test(e.message));
  }
  assert.equal(called, 0);
});

test('a normal key goes through', async () => {
  const r = await translate({ key: 'sk-ant-abc_123-XYZ', model: 'm' }, 'Hello', 'bn', { fetch: ok });
  assert.equal(r.text, 'Hi');
});
