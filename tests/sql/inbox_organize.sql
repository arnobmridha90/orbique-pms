-- Organising the inbox (supabase/migrations/0022_inbox_organize.sql): flags changed in one step, a guest message
-- bringing a chat back from Archived and Deleted, a save from the app that cannot undo the server's flags, and Deleted
-- emptied after 30 days. Runs in one transaction and rolls back. Any failed check raises an error.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/inbox_organize.sql
begin;

insert into public.orgs (id, name) values ('00000000-0000-4000-8000-0000000000d1', 'Organise test');
insert into public.records (org_id, coll, id, data) values
  ('00000000-0000-4000-8000-0000000000d1', 'conversations', 'C-a', '{"id":"C-a","bookingId":"B-1","unread":0,"messages":[{"from":"guest","text":"Hi","time":"2026-11-01T09:00","xid":"wa:a1"}]}'),
  ('00000000-0000-4000-8000-0000000000d1', 'conversations', 'C-old', '{"id":"C-old","bookingId":"B-2","unread":0,"messages":[],"trashedAt":"2026-09-01T10:00"}'),
  ('00000000-0000-4000-8000-0000000000d1', 'conversations', 'C-new', '{"id":"C-new","bookingId":"B-3","unread":0,"messages":[],"trashedAt":"2026-10-20T10:00"}');

do $$
declare o constant uuid := '00000000-0000-4000-8000-0000000000d1'; r jsonb; v jsonb; stale jsonb; n int;
begin
  -- archive, pin, put on two lists (once each), star for one user
  r := public.inbox_mark(o, 'C-a', '{"archived":true,"pinned":true}', null, '{"lists":"L1"}', null, null);
  r := public.inbox_mark(o, 'C-a', null, null, '{"lists":"L2","favBy":"u1"}', null, null);
  r := public.inbox_mark(o, 'C-a', null, null, '{"lists":"L1"}', null, null);
  v := r->'data';
  if r->>'id' <> 'C-a' or v->>'archived' <> 'true' or v->'lists' <> '["L1","L2"]'::jsonb or v->'favBy' <> '["u1"]'::jsonb then raise exception 'mark: %', v; end if;
  -- mark as unread keeps a higher count; take off a list; the last star taken off removes the key
  r := public.inbox_mark(o, 'C-a', null, null, null, '{"lists":"L1","favBy":"u1"}', 1);
  v := r->'data';
  if v->'lists' <> '["L2"]'::jsonb or v ? 'favBy' or (v->>'unread')::int <> 1 then raise exception 'unmark: %', v; end if;
  if public.inbox_mark(o, 'nope', '{"pinned":true}', null, null, null, null) is not null then raise exception 'unknown chat marked'; end if;

  -- the app saves a copy it loaded before: it cannot unpin, unarchive or change the lists by saving
  select data into stale from public.records where org_id = o and coll = 'conversations' and id = 'C-a';
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1"}', true);
  update public.records set data = (stale - 'pinned' - 'archived') || '{"lists":["X"],"unread":0,"assigneeId":"s2"}'
   where org_id = o and coll = 'conversations' and id = 'C-a';
  perform set_config('request.jwt.claims', '', true);
  select data into v from public.records where org_id = o and coll = 'conversations' and id = 'C-a';
  if v->>'pinned' <> 'true' or v->>'archived' <> 'true' or v->'lists' <> '["L2"]'::jsonb or v->>'assigneeId' <> 's2' or (v->>'unread')::int <> 0 then raise exception 'keep flags: %', v; end if;

  -- a team message does not bring it back; a guest message does, from Archived and from Deleted
  perform public.inbox_mark(o, 'C-a', '{"trashedAt":"2026-10-28T10:00","trashedBy":"s1"}', null, null, null, null);
  v := public.inbox_append(o, 'C-a', '{"from":"staff","text":"Hello","time":"2026-11-01T09:05","xid":"wa:a2"}', 0, null);
  if not (v ? 'archived' and v ? 'trashedAt') then raise exception 'staff message brought it back: %', v; end if;
  v := public.inbox_append(o, 'C-a', '{"from":"guest","text":"Still there?","time":"2026-11-01T09:10","xid":"wa:a3"}', 1, null);
  if v ? 'archived' or v ? 'trashedAt' or v ? 'trashedBy' or v->>'pinned' <> 'true' then raise exception 'guest message: %', v; end if;

  -- Deleted is emptied after 30 days: only what went in before the cut is due, and removing it leaves a tombstone
  select count(*) into n from public.inbox_purge_due(o, '2026-09-29T10:00', 50) p where p.id = 'C-old';
  if n <> 1 then raise exception 'old chat not due'; end if;
  select count(*) into n from public.inbox_purge_due(o, '2026-09-29T10:00', 50);
  if n <> 1 then raise exception 'too much due: %', n; end if;
  if public.inbox_forget(o, 'C-new', '2026-09-29T10:00') then raise exception 'removed a chat deleted after the cut'; end if;
  if public.inbox_forget(o, 'C-a', null) then raise exception 'removed a chat that is not in Deleted'; end if;
  if not public.inbox_forget(o, 'C-old', '2026-09-29T10:00') then raise exception 'old chat not removed'; end if;
  if not exists (select 1 from public.records where org_id = o and id = 'C-old' and deleted and data = '{}'::jsonb) then raise exception 'no tombstone'; end if;
  if public.inbox_forget(o, 'C-old', null) then raise exception 'removed twice'; end if;
  select count(*) into n from public.inbox_purge_due(o, '2026-09-29T10:00', 50);
  if n <> 0 then raise exception 'tombstone still due'; end if;
  -- "Delete forever" (no cut) removes a chat in Deleted at any time
  if not public.inbox_forget(o, 'C-new', null) then raise exception 'delete forever'; end if;
  if not exists (select 1 from public.records where org_id = o and id = 'C-a' and not deleted) then raise exception 'purged too much'; end if;
  -- lists: add, rename, remove under the row lock; names unique ignoring case; at most p_max
  r := public.inbox_lists(o, 'add', null, 'VIP', 'L-1', 2);
  if r->'lists' <> '[{"id":"L-1","name":"VIP"}]'::jsonb then raise exception 'lists add: %', r; end if;
  if public.inbox_lists(o, 'add', null, 'vip', 'L-x', 2)->>'error' <> 'taken' then raise exception 'lists: same name twice'; end if;
  r := public.inbox_lists(o, 'add', null, 'Follow up', 'L-2', 2);
  if public.inbox_lists(o, 'add', null, 'Third', 'L-3', 2)->>'error' <> 'full' then raise exception 'lists: over the limit'; end if;
  if public.inbox_lists(o, 'rename', 'L-2', 'VIP', null, 2)->>'error' <> 'taken' then raise exception 'lists: rename onto another'; end if;
  r := public.inbox_lists(o, 'rename', 'L-1', 'vip', null, 2);
  if r->'lists'->0->>'name' <> 'vip' then raise exception 'lists: rename own case: %', r; end if;
  r := public.inbox_lists(o, 'remove', 'L-1', null, null, 2);
  if r->'lists' <> '[{"id":"L-2","name":"Follow up"}]'::jsonb then raise exception 'lists remove: %', r; end if;
  if public.inbox_lists(o, 'remove', 'L-1', null, null, 2)->>'error' <> 'missing' then raise exception 'lists: removed twice'; end if;
  if (select data from public.blobs where org_id = o and key = 'inboxLists') <> '{"v":[{"id":"L-2","name":"Follow up"}]}'::jsonb then raise exception 'lists not saved'; end if;

  -- uploads not sent yet: a table only the server reaches
  insert into public.inbox_uploads (path, org_id) values (o::text || '/C-a/x.jpg', o);
  if not exists (select 1 from public.inbox_uploads where org_id = o) then raise exception 'upload not noted'; end if;
  raise notice 'inbox organise: ok';
end $$;

rollback;
