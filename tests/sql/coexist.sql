-- WhatsApp coexistence (supabase/migrations/0018_whatsapp_coexistence.sql): inbox_merge adds older chats once each, in
-- time order, applies a patch alone, and never moves waLastIn back. Rolls back; any failed check raises an error.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/coexist.sql
begin;

insert into public.orgs (id, name) values ('00000000-0000-4000-8000-0000000000c1', 'Coexist test');
insert into public.records (org_id, coll, id, data) values
  ('00000000-0000-4000-8000-0000000000c1', 'conversations', 'C-1', '{"id":"C-1","wa":"60123456789","unread":1,"waLastIn":"2026-10-28T10:00:00.000Z","messages":[{"from":"guest","text":"Live","time":"2026-10-28T18:00","xid":"wa:L1"}]}');

do $$
declare o constant uuid := '00000000-0000-4000-8000-0000000000c1'; n int; v jsonb;
begin
  n := public.inbox_merge(o, 'C-1', '[{"from":"guest","text":"Old 2","time":"2026-10-27T09:00","xid":"wa:H2"},{"from":"staff","text":"Old 1","time":"2026-10-26T09:00","xid":"wa:H1","app":true},{"from":"guest","text":"Dup","time":"2026-10-27T09:00","xid":"wa:H2"},{"from":"guest","text":"Live","time":"2026-10-28T18:00","xid":"wa:L1"}]', 0, '{"waLastIn":"2026-10-27T01:00:00.000Z"}');
  select data into v from public.records where org_id = o and coll = 'conversations' and id = 'C-1';
  if n <> 2 then raise exception 'added %, expected 2', n; end if;
  if (select array_agg(m->>'xid' order by k) from jsonb_array_elements(v->'messages') with ordinality x(m, k)) <> array['wa:H1', 'wa:H2', 'wa:L1'] then raise exception 'order: %', v->'messages'; end if;
  if v->>'waLastIn' <> '2026-10-28T10:00:00.000Z' then raise exception 'waLastIn went back: %', v->>'waLastIn'; end if;
  if (v->>'unread')::int <> 1 then raise exception 'unread: %', v->>'unread'; end if;

  -- the same delivery again adds nothing and changes nothing
  if public.inbox_merge(o, 'C-1', '[{"from":"guest","text":"Old 2","time":"2026-10-27T09:00","xid":"wa:H2"}]', 0, '{}') <> 0 then raise exception 'merged twice'; end if;

  -- a patch alone (a contact's name) still applies; a later waLastIn moves it forward
  perform public.inbox_merge(o, 'C-1', '[]', 0, '{"contact":{"name":"Ana","phone":"+60123456789"},"waLastIn":"2026-10-28T12:00:00.000Z"}');
  select data into v from public.records where org_id = o and coll = 'conversations' and id = 'C-1';
  if v->'contact'->>'name' <> 'Ana' or v->>'waLastIn' <> '2026-10-28T12:00:00.000Z' then raise exception 'patch: %', v; end if;

  -- a chat that is gone
  if public.inbox_merge(o, 'C-none', '[{"xid":"wa:Z"}]', 0, null) <> 0 then raise exception 'missing chat'; end if;
  raise notice 'coexist: ok';
end $$;

-- only the server may call it or read the tokens
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    if has_function_privilege('authenticated', 'public.inbox_merge(uuid, text, jsonb, int, jsonb)', 'execute') then raise exception 'authenticated can run inbox_merge'; end if;
    if has_table_privilege('authenticated', 'public.whatsapp_tokens', 'select') then raise exception 'authenticated can read tokens'; end if;
  end if;
end $$;

rollback;
