import test from 'node:test';
import assert from 'node:assert/strict';
import { speed, requestBody } from '../../api/_lib/translate.js';
import { trPatch } from '../../api/messages.js';

test('translations ask for a quick answer: low effort, thinking off where the model allows it', () => {
  assert.deepEqual(speed('claude-haiku-5-5'), { output_config: { effort: 'low' }, thinking: { type: 'disabled' } });
  assert.deepEqual(speed('claude-opus-5-5'), { output_config: { effort: 'low' } }); // "disabled" is refused there
  assert.deepEqual(speed('claude-sonnet-5-5'), { output_config: { effort: 'low' }, thinking: { type: 'between_tools' } });
  assert.deepEqual(speed('claude-haiku-4-5'), {});
  const b = requestBody({ model: 'claude-haiku-5-5' }, 'Oke terimakasih', 'en');
  assert.equal(b.thinking.type, 'disabled');
  assert.equal(b.output_config.effort, 'low');
});

test('a reader language is kept beside the first translation, not over it', () => {
  assert.deepEqual(trPatch({ text: 'x' }, 'zh', { same: false, lang: 'id', text: '好的谢谢' }), { lang: 'id', tr: { to: 'zh', text: '好的谢谢' } });
  const m = { text: 'x', lang: 'id', tr: { to: 'en', text: 'Okay thanks' }, trx: { bn: 'ঠিক আছে' } };
  assert.deepEqual(trPatch(m, 'zh', { same: false, lang: 'id', text: '好的谢谢' }), { lang: 'id', trx: { bn: 'ঠিক আছে', zh: '好的谢谢' } });
  assert.deepEqual(trPatch(m, 'en', { same: false, lang: 'id', text: 'Okay, thank you' }), { lang: 'id', tr: { to: 'en', text: 'Okay, thank you' } });
  assert.deepEqual(trPatch({ text: 'Hi' }, 'en', { same: true, lang: 'en' }), { lang: 'en', trx: { en: '' } });
});

test('a guest message is translated on arrival into the team language and every reader language at once', async () => {
  const { translated } = await import('../../api/_lib/inbox.js');
  const seen = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const to = /\((\w\w)\)\./.exec(body.messages[0].content)[1];
    seen.push(to);
    const text = to === 'en' ? 'Okay, thank you' : to === 'ms' ? 'Okay, terima kasih' : to === 'id' ? 'Oke terimakasih' : '好的，谢谢';
    return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ lang: 'id', text }) }] }) };
  };
  const cfg = { key: 'sk-test', model: 'claude-haiku-5-5', configured: true };
  const out = await translated('Oke terimakasih', { lang: 'en', autoTranslate: true, readers: ['ms', 'zh', 'en', 'id'] }, { translateConfig: cfg, fetch });
  assert.deepEqual(seen.sort(), ['en', 'id', 'ms', 'zh']);
  assert.deepEqual(out, { lang: 'id', tr: { to: 'en', text: 'Okay, thank you' }, trx: { ms: 'Okay, terima kasih', zh: '好的，谢谢', id: '' } });
});
