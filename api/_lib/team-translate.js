/* Team chat translation (migration 0025): messages into the reader's app language, made once per message and language.
 * Private module: Vercel does not expose files under api/_lib as endpoints.
 *
 *   teamTranslate(sb, {orgId, userId, ids, to}, opts)  -> {configured, to, items: {<message id>: {text, from, same}}, pending: [ids]}
 *
 * Only messages in chats the reader is in (team__in, 0024) come back. Translations already kept are returned as they
 * are; the rest go to Claude a few at a time until the time budget runs out (pending: try again later).
 * opts {translate, config, budgetMs = 7000, now: () => ms}
 */
import { translateConfig, translate as claudeTranslate, langCode, TranslateError, MAX_CHARS } from './translate.js';
import { check } from './supabase.js';

export const MAX_IDS = 40;
const PARALLEL = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cleanIds(v) {
  const out = [];
  (Array.isArray(v) ? v : []).forEach((x) => { const s = String(x || '').trim().toLowerCase(); if (UUID.test(s) && !out.includes(s)) out.push(s); });
  return out.slice(0, MAX_IDS);
}

export async function teamTranslate(sb, { orgId, userId, ids, to }, opts = {}) {
  const cfg = opts.config || translateConfig();
  const target = langCode(to) || 'en';
  const list = cleanIds(ids);
  const res = { configured: !!cfg.configured, to: target, items: {}, pending: [] };
  if (!list.length) return res;

  const msgs = check(await sb.from('team_messages').select('id, chat_id, body').eq('org_id', orgId).in('id', list), 'read messages') || [];
  // only chats the reader is in
  const chats = [...new Set(msgs.map((m) => m.chat_id))];
  const allowed = new Set();
  for (const c of chats) {
    const ok = check(await sb.rpc('team__in', { p_org: orgId, p_chat: c, p_user: userId }), 'check chat');
    if (ok === true) allowed.add(c);
  }
  const mine = msgs.filter((m) => allowed.has(m.chat_id) && String(m.body || '').trim());
  if (!mine.length) return res;

  const kept = check(await sb.from('team_message_translations').select('message_id, src_lang, body, same').eq('lang', target).in('message_id', mine.map((m) => m.id)), 'read translations') || [];
  const have = new Map(kept.map((k) => [k.message_id, k]));
  mine.forEach((m) => { const k = have.get(m.id); if (k) res.items[m.id] = { text: k.same ? '' : k.body, from: k.src_lang || '', same: !!k.same }; });

  const todo = mine.filter((m) => !have.has(m.id));
  if (!todo.length) return res;
  if (!cfg.configured) { res.pending = []; return res; }

  const now = opts.now || Date.now;
  const deadline = now() + (opts.budgetMs || 7000);
  const doTranslate = opts.translate || claudeTranslate;
  let i = 0;
  let stopped = false;
  async function worker() {
    while (i < todo.length) {
      const m = todo[i++];
      if (stopped || now() > deadline - 1500) { res.pending.push(m.id); continue; }
      try {
        const src = String(m.body).trim().slice(0, MAX_CHARS);
        const r = await doTranslate(cfg, src, target);
        const row = { message_id: m.id, lang: target, src_lang: langCode(r.lang) || '', body: r.same ? '' : String(r.text || '').slice(0, 8000), same: !!r.same };
        check(await sb.from('team_message_translations').upsert(row, { onConflict: 'message_id,lang' }), 'save translation');
        res.items[m.id] = { text: row.body, from: row.src_lang, same: row.same };
      } catch (e) {
        if (e instanceof TranslateError && !e.retryable) { stopped = true; res.error = e.message; }
        else console.error('[team-translate]', e && e.message);
        res.pending.push(m.id);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
  return res;
}
