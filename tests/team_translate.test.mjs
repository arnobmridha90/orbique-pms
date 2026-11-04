/* Team chat translation (api/_lib/team-translate.js, /api/alerts 'team-translate', migration 0025): only chats the
 * reader is in, kept translations reused, new ones saved once, time budget, no key.
 *
 *   node --test tests/team_translate.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { teamTranslate, cleanIds, MAX_IDS } from '../api/_lib/team-translate.js';
import { TranslateError } from '../api/_lib/translate.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const U = '00000000-0000-4000-8000-0000000000aa';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

/* a tiny stand-in for the Supabase client: team_messages, team_message_translations and rpc team__in */
function fake({ msgs, kept = [], inChats = ['all'] }) {
  const saved = [];
  const rows = { team_messages: msgs, team_message_translations: kept };
  function from(table) {
    const f = [];
    const q = {
      select() { return q; },
      eq(k, v) { f.push((r) => r[k] === v); return q; },
      in(k, vs) { f.push((r) => vs.includes(r[k])); return q; },
      upsert(row) { saved.push(row); rows.team_message_translations.push(row); return Promise.resolve({ data: null, error: null }); },
      then(res, rej) { return Promise.resolve({ data: rows[table].filter((r) => f.every((fn) => fn(r))), error: null }).then(res, rej); }
    };
    return q;
  }
  return {
    saved,
    from,
    rpc(name, a) { assert.equal(name, 'team__in'); assert.equal(a.p_user, U); return Promise.resolve({ data: inChats.includes(a.p_chat), error: null }); }
  };
}
const cfg = { configured: true, key: 'k', model: 'm' };
const msg = (n, chat, body) => ({ id: id(n), org_id: ORG, chat_id: chat, body });

test('cleanIds keeps unique message ids, at most 40', () => {
  assert.deepEqual(cleanIds([id(1), id(1).toUpperCase(), 'x', null, id(2)]), [id(1), id(2)]);
  assert.equal(cleanIds(Array.from({ length: 60 }, (_, i) => id(i + 1))).length, MAX_IDS);
});

test('translates new messages once, reuses kept ones, and never shows chats the reader is not in', async () => {
  const sb = fake({
    msgs: [msg(1, 'all', 'Bilik 47-7 sudah siap'), msg(2, 'all', 'Terima kasih'), msg(3, 'secret', 'not for you'), msg(4, 'all', 'Good morning')],
    kept: [{ message_id: id(2), lang: 'en', src_lang: 'ms', body: 'Thank you', same: false }]
  });
  const calls = [];
  const fakeTr = async (c, text, to) => { calls.push([text, to]); return text === 'Good morning' ? { lang: 'en', text, same: true } : { lang: 'ms', text: 'Room 47-7 is ready', same: false }; };
  const r = await teamTranslate(sb, { orgId: ORG, userId: U, ids: [id(1), id(2), id(3), id(4)], to: 'en' }, { config: cfg, translate: fakeTr });
  assert.equal(r.configured, true);
  assert.deepEqual(r.items[id(1)], { text: 'Room 47-7 is ready', from: 'ms', same: false });
  assert.deepEqual(r.items[id(2)], { text: 'Thank you', from: 'ms', same: false });
  assert.deepEqual(r.items[id(4)], { text: '', from: 'en', same: true });
  assert.equal(r.items[id(3)], undefined, 'a chat the reader is not in stays out');
  assert.deepEqual(calls.map((c) => c[0]).sort(), ['Bilik 47-7 sudah siap', 'Good morning']);
  assert.equal(sb.saved.length, 2);
  assert.deepEqual(r.pending, []);
  // asked again: everything comes from what was kept, no new translations
  calls.length = 0;
  const again = await teamTranslate(sb, { orgId: ORG, userId: U, ids: [id(1), id(4)], to: 'en' }, { config: cfg, translate: fakeTr });
  assert.equal(calls.length, 0);
  assert.equal(again.items[id(1)].text, 'Room 47-7 is ready');
});

test('no translation key: kept translations still come back, nothing new is asked for', async () => {
  const sb = fake({ msgs: [msg(1, 'all', 'Hai'), msg(2, 'all', 'Apa khabar')], kept: [{ message_id: id(1), lang: 'bn', src_lang: 'ms', body: 'হাই', same: false }] });
  const r = await teamTranslate(sb, { orgId: ORG, userId: U, ids: [id(1), id(2)], to: 'bn' }, { config: { configured: false }, translate: () => { throw new Error('must not be called'); } });
  assert.equal(r.configured, false);
  assert.equal(r.items[id(1)].text, 'হাই');
  assert.equal(r.items[id(2)], undefined);
});

test('a refused key stops the batch; out of time leaves the rest pending', async () => {
  const sb = fake({ msgs: [1, 2, 3, 4, 5, 6].map((n) => msg(n, 'all', 'm' + n)) });
  const refused = async () => { throw new TranslateError('The translation key is not accepted.'); };
  const r = await teamTranslate(sb, { orgId: ORG, userId: U, ids: [1, 2, 3, 4, 5, 6].map(id), to: 'zh' }, { config: cfg, translate: refused });
  assert.equal(Object.keys(r.items).length, 0);
  assert.equal(r.pending.length, 6);
  assert.match(r.error, /not accepted/);

  let clock = 0;
  const slow = async (c, text) => { clock += 4000; return { lang: 'ms', text: text + '!', same: false }; };
  const sb2 = fake({ msgs: [1, 2, 3, 4, 5, 6].map((n) => msg(n, 'all', 'm' + n)) });
  const r2 = await teamTranslate(sb2, { orgId: ORG, userId: U, ids: [1, 2, 3, 4, 5, 6].map(id), to: 'en' }, { config: cfg, translate: slow, now: () => clock, budgetMs: 7000 });
  assert.ok(Object.keys(r2.items).length >= 1 && r2.pending.length >= 1, 'some done, the rest pending');
  assert.equal(Object.keys(r2.items).length + r2.pending.length, 6);
});

test('empty messages and a bad language are handled', async () => {
  const sb = fake({ msgs: [msg(1, 'all', '')] });
  const r = await teamTranslate(sb, { orgId: ORG, userId: U, ids: [id(1)], to: 'xx-bad' }, { config: cfg, translate: () => { throw new Error('no'); } });
  assert.equal(r.to, 'en');
  assert.deepEqual(r.items, {});
});
