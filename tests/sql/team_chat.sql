-- Team chat (supabase/migrations/0024_team_chat.sql): only the people in a chat read it, its people and its messages;
-- All staff is everyone with Team chat; senders cannot pretend to be someone else or set the time; view-only people
-- read but do not write; Staff Access switches it off; another workspace and anon reach nothing; files in team-files
-- follow the chat; the phone alert goes once, to the others in the chat who did not mute it. Needs the Storage stand-in
-- (tests/sql/storage_stub.sql). Runs in one transaction and rolls back. Any failed check raises an error.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/team_chat.sql
\o /dev/null
begin;
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000e001', 'owner@t'), ('00000000-0000-4000-8000-00000000e002', 'ops@t'),
  ('00000000-0000-4000-8000-00000000e003', 'house@t'), ('00000000-0000-4000-8000-00000000e004', 'house2@t'),
  ('00000000-0000-4000-8000-00000000e005', 'owner-b@t'), ('00000000-0000-4000-8000-00000000e006', 'acc@t');
insert into public.orgs (id, name) values ('00000000-0000-4000-8000-00000000f001', 'Team A'), ('00000000-0000-4000-8000-00000000f002', 'Team B');
insert into public.members (org_id, user_id, staff_id, role) values
  ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000e001', 'u1', 'owner'),
  ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000e002', 's2', 'ops'),
  ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000e003', 's3', 'housekeeping'),
  ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000e004', 's4', 'housekeeping'),
  ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000e006', 's6', 'accountant'),
  ('00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000e005', 'u1', 'owner');
insert into public.records (org_id, coll, id, data) values ('00000000-0000-4000-8000-00000000f001', 'staff', 's2', '{"id":"s2","name":"Wei Ling Tan"}');
-- the accountant has Team chat switched off in Staff Access; rolePerms saved before Team chat existed (no 'team' key)
insert into public.blobs (org_id, key, data) values
  ('00000000-0000-4000-8000-00000000f001', 'staffMeta', '{"v":{"s6":{"overrides":{"section:team":"none"}}}}'),
  ('00000000-0000-4000-8000-00000000f001', 'rolePerms', '{"v":{"ops":{"sections":{"inbox":"edit"},"actions":{}},"housekeeping":{"sections":{"tasks":"edit"},"actions":{}},"accountant":{"sections":{},"actions":{}}}}');

create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claims', case when u is null then '' else json_build_object('sub', u)::text end, true); $$;
create or replace function pg_temp.u(n text) returns text language sql as $$ select '00000000-0000-4000-8000-00000000e00' || n; $$;
create or replace function pg_temp.a() returns uuid language sql as $$ select '00000000-0000-4000-8000-00000000f001'::uuid; $$;
-- how many messages / chats the user sees in workspace A
create or replace function pg_temp.msgs(who text, chat text) returns int language plpgsql as $$
declare n int; begin perform pg_temp.as_user(pg_temp.u(who)); select count(*) into n from public.team_messages where org_id = pg_temp.a() and chat_id = chat; return n; end $$;
create or replace function pg_temp.sees_chat(who text, chat text) returns boolean language plpgsql as $$
declare n int; m int; begin perform pg_temp.as_user(pg_temp.u(who));
  select count(*) into n from public.team_chats where org_id = pg_temp.a() and id = chat;
  select count(*) into m from public.team_chat_members where org_id = pg_temp.a() and chat_id = chat;
  if n = 0 and m > 0 then raise exception '% sees the people of % but not the chat', who, chat; end if;
  return n = 1; end $$;
-- may the user add a message (as themselves unless as_sender is given)
create or replace function pg_temp.post(who text, chat text, body text, as_sender text default null) returns boolean language plpgsql as $$
begin
  perform pg_temp.as_user(pg_temp.u(who));
  insert into public.team_messages (org_id, chat_id, sender, body) values (pg_temp.a(), chat, coalesce(as_sender, case who when '1' then 'u1' else 's' || who end), body);
  return true;
exception when insufficient_privilege then return false;
end $$;
create or replace function pg_temp.unread(who text, chat text) returns int language plpgsql as $$
declare r jsonb; begin perform pg_temp.as_user(pg_temp.u(who)); r := public.team_list(pg_temp.a());
  return (select (c->>'unread')::int from jsonb_array_elements(r->'chats') c where c->>'id' = chat); end $$;
create table pg_temp.ids (k text primary key, v text);
grant all on pg_temp.ids to authenticated, service_role;

set local role authenticated;
do $$
declare r jsonb; g text; d text; d2 text; ok boolean;
begin
  -- the list makes All staff; the accountant (switched off) gets nothing
  perform pg_temp.as_user(pg_temp.u('2'));
  r := public.team_list(pg_temp.a());
  if r->>'me' <> 's2' or r->>'level' <> 'edit' or jsonb_array_length(r->'chats') <> 1 or r->'chats'->0->>'id' <> 'all' then raise exception 'team_list for ops: %', r; end if;
  perform pg_temp.as_user(pg_temp.u('6'));
  begin perform public.team_list(pg_temp.a()); ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'the accountant with Team chat off can list chats'; end if;
  if pg_temp.sees_chat('6', 'all') then raise exception 'the accountant with Team chat off sees All staff'; end if;
  raise notice 'ok: All staff is made on first use; Staff Access switches Team chat off';

  -- All staff: everyone with Team chat reads it; the owner too
  if not pg_temp.post('2', 'all', 'Morning team') then raise exception 'ops cannot post to All staff'; end if;
  if pg_temp.msgs('3', 'all') <> 1 or pg_temp.msgs('4', 'all') <> 1 or pg_temp.msgs('1', 'all') <> 1 then raise exception 'All staff not read by everyone'; end if;
  if pg_temp.msgs('6', 'all') <> 0 then raise exception 'the accountant with Team chat off reads All staff'; end if;
  if pg_temp.unread('3', 'all') <> 1 or pg_temp.unread('2', 'all') <> 0 then raise exception 'All staff unread counts'; end if;
  perform pg_temp.as_user(pg_temp.u('3')); perform public.team_read(pg_temp.a(), 'all');
  if pg_temp.unread('3', 'all') <> 0 then raise exception 'reading All staff did not clear the count'; end if;
  raise notice 'ok: All staff is read by everyone with Team chat, unread counts and mark read';

  -- a group of ops + housekeeper s3: only they read it
  perform pg_temp.as_user(pg_temp.u('2'));
  g := public.team_open(pg_temp.a(), 'group', '  Housekeeping   team ', array['s3']);
  insert into pg_temp.ids values ('g', g);
  if (select name from public.team_chats where org_id = pg_temp.a() and id = g) <> 'Housekeeping team' then raise exception 'group name not tidied'; end if;
  if not pg_temp.post('2', g, 'Linen at 2pm') then raise exception 'the maker cannot post in the group'; end if;
  if pg_temp.msgs('3', g) <> 1 or not pg_temp.sees_chat('3', g) then raise exception 'a group member cannot read it'; end if;
  if pg_temp.msgs('4', g) <> 0 or pg_temp.sees_chat('4', g) then raise exception 'someone outside the group reads it'; end if;
  if pg_temp.msgs('1', g) <> 0 or pg_temp.sees_chat('1', g) then raise exception 'the owner outside the group reads it'; end if;
  if pg_temp.post('4', g, 'let me in') then raise exception 'someone outside the group posted in it'; end if;
  if pg_temp.post('3', g, 'spoof', 's2') then raise exception 'a member posted as someone else'; end if;
  if pg_temp.unread('3', g) <> 1 then raise exception 'group unread for s3: %', pg_temp.unread('3', g); end if;
  raise notice 'ok: a group is read and written only by its people, as themselves';

  -- managing: the maker renames and adds; a member may only leave
  perform pg_temp.as_user(pg_temp.u('3'));
  begin perform public.team_manage(pg_temp.a(), g, 'Mine now', null, null); ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'a member who did not make the group renamed it'; end if;
  begin perform public.team_manage(pg_temp.a(), g, null, array['s4'], null); ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'a member who did not make the group added someone'; end if;
  perform pg_temp.as_user(pg_temp.u('2'));
  perform public.team_manage(pg_temp.a(), g, 'HK team', array['s4'], null);
  if pg_temp.msgs('4', g) <> 1 then raise exception 'an added person cannot read the group'; end if;
  if pg_temp.unread('4', g) <> 0 then raise exception 'history from before someone was added counts as unread'; end if;
  perform pg_temp.as_user(pg_temp.u('3'));
  perform public.team_manage(pg_temp.a(), g, null, null, array['s3']);
  if pg_temp.msgs('3', g) <> 0 then raise exception 'someone who left still reads the group'; end if;
  begin perform pg_temp.as_user(pg_temp.u('2')); perform public.team_manage(pg_temp.a(), g, null, array['nobody'], null); ok := true; exception when invalid_parameter_value then ok := false; end;
  if ok then raise exception 'a group took someone who is not in the workspace'; end if;
  raise notice 'ok: the maker renames and adds people, a member can only leave, a leaver reads nothing more';

  -- the owner manages a group they are in although they did not make it
  perform pg_temp.as_user(pg_temp.u('2'));
  perform public.team_manage(pg_temp.a(), g, null, array['u1'], null);
  perform pg_temp.as_user(pg_temp.u('1'));
  perform public.team_manage(pg_temp.a(), g, 'Renamed by the owner', null, array['s4']);
  if pg_temp.msgs('4', g) <> 0 or pg_temp.msgs('1', g) <> 1 then raise exception 'the owner could not manage the group'; end if;
  raise notice 'ok: the account owner renames a group and removes people';

  -- direct chats: one per pair, only the two read it
  perform pg_temp.as_user(pg_temp.u('2'));
  d := public.team_open(pg_temp.a(), 'direct', null, array['s3']);
  perform pg_temp.as_user(pg_temp.u('3'));
  d2 := public.team_open(pg_temp.a(), 'direct', null, array['s2']);
  if d <> d2 then raise exception 'a second direct chat for the same pair'; end if;
  insert into pg_temp.ids values ('d', d);
  if not pg_temp.post('3', d, 'Hi Wei Ling') then raise exception 'a direct chat member cannot write'; end if;
  if pg_temp.msgs('2', d) <> 1 or pg_temp.msgs('4', d) <> 0 or pg_temp.msgs('1', d) <> 0 then raise exception 'a direct chat is read by the wrong people'; end if;
  begin perform pg_temp.as_user(pg_temp.u('2')); perform public.team_manage(pg_temp.a(), d, null, array['s4'], null); ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'someone was added to a direct chat'; end if;
  raise notice 'ok: one direct chat per pair, read by those two only';

  -- the time and the alert flag are the server's
  perform pg_temp.as_user(pg_temp.u('2'));
  begin insert into public.team_messages (org_id, chat_id, sender, body, created_at) values (pg_temp.a(), 'all', 's2', 'from the past', '2020-01-01'); ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'a sender set the message time'; end if;
  begin update public.team_messages set body = 'edited' where org_id = pg_temp.a(); ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'a member changed messages'; end if;
  begin delete from public.team_messages where org_id = pg_temp.a(); ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'a member removed messages'; end if;
  begin update public.team_chat_members set muted = true where org_id = pg_temp.a(); ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'a member changed member rows directly'; end if;
  begin insert into public.team_chats (org_id, id, kind, name) values (pg_temp.a(), 'gx', 'group', 'x'); ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'a member made a chat directly'; end if;
  raise notice 'ok: messages keep the server''s time and are never changed or removed; chats change only through the functions';
end $$;

-- files: the path follows the chat
do $$
declare g text := (select v from pg_temp.ids where k = 'g'); ok boolean; n int;
begin
  perform pg_temp.as_user(pg_temp.u('2'));
  insert into storage.objects (bucket_id, name) values ('team-files', pg_temp.a()::text || '/' || g || '/photo.jpg');
  insert into public.team_messages (org_id, chat_id, sender, body, file) values (pg_temp.a(), g, 's2', '', jsonb_build_object('path', pg_temp.a()::text || '/' || g || '/photo.jpg', 'name', 'photo.jpg', 'mime', 'image/jpeg', 'size', 1000));
  begin
    insert into public.team_messages (org_id, chat_id, sender, body, file) values (pg_temp.a(), 'all', 's2', '', jsonb_build_object('path', pg_temp.a()::text || '/' || g || '/photo.jpg'));
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'a message in All staff points at a group''s file'; end if;
  perform pg_temp.as_user(pg_temp.u('1'));
  select count(*) into n from storage.objects where bucket_id = 'team-files';
  if n <> 1 then raise exception 'a group member cannot see the group''s file'; end if;
  perform pg_temp.as_user(pg_temp.u('4'));
  select count(*) into n from storage.objects where bucket_id = 'team-files';
  if n <> 0 then raise exception 'someone outside the group sees its file'; end if;
  begin insert into storage.objects (bucket_id, name) values ('team-files', pg_temp.a()::text || '/' || g || '/evil.jpg'); ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'someone outside the group uploaded to it'; end if;
  begin insert into storage.objects (bucket_id, name) values ('team-files', pg_temp.a()::text || '/all/x/deep.jpg'); ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'an upload to a nested path'; end if;
  insert into storage.objects (bucket_id, name) values ('team-files', pg_temp.a()::text || '/all/notice.pdf');
  perform pg_temp.as_user(pg_temp.u('3'));
  delete from storage.objects where bucket_id = 'team-files' and name = pg_temp.a()::text || '/all/notice.pdf';
  if found then raise exception 'someone removed another person''s upload'; end if;
  perform pg_temp.as_user(pg_temp.u('4'));
  delete from storage.objects where bucket_id = 'team-files' and name = pg_temp.a()::text || '/all/notice.pdf';
  if not found then raise exception 'the uploader could not take back their file'; end if;
  raise notice 'ok: files are reached only by the people of their chat';
end $$;

-- view only, suspended, paused, another workspace
do $$
declare ok boolean; n int;
begin
  -- s4 view-only (their own override)
  perform pg_temp.as_user(pg_temp.u('1'));
  update public.blobs set data = '{"v":{"s6":{"overrides":{"section:team":"none"}},"s4":{"overrides":{"section:team":"view"}}}}' where org_id = pg_temp.a() and key = 'staffMeta';
  if not found then raise exception 'staffMeta not updated'; end if;
  if pg_temp.msgs('4', 'all') < 1 then raise exception 'view-only cannot read All staff'; end if;
  if pg_temp.post('4', 'all', 'hello') then raise exception 'view-only posted'; end if;
  perform pg_temp.as_user(pg_temp.u('4'));
  begin perform public.team_open(pg_temp.a(), 'direct', null, array['s2']); ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'view-only started a chat'; end if;
  perform public.team_read(pg_temp.a(), 'all');
  -- the role saved with Team chat off
  perform pg_temp.as_user(pg_temp.u('1'));
  update public.blobs set data = '{"v":{"ops":{"sections":{"inbox":"edit"},"actions":{}},"housekeeping":{"sections":{"team":"none"},"actions":{}}}}' where org_id = pg_temp.a() and key = 'rolePerms';
  if not found then raise exception 'rolePerms not updated'; end if;
  if pg_temp.msgs('3', 'all') <> 0 then raise exception 'housekeeping with the role switched off reads All staff'; end if;
  if pg_temp.msgs('4', 'all') < 1 then raise exception 'a personal View override no longer wins over the role'; end if;
  perform pg_temp.as_user(pg_temp.u('1'));
  update public.blobs set data = '{"v":{"ops":{"sections":{"inbox":"edit"},"actions":{}},"housekeeping":{"sections":{"team":"edit"},"actions":{}}}}' where org_id = pg_temp.a() and key = 'rolePerms';
  if not found then raise exception 'rolePerms not updated'; end if;
  -- suspended
  perform pg_temp.as_user(pg_temp.u('1'));
  update public.blobs set data = '{"v":{"s3":{"status":"suspended"}}}' where org_id = pg_temp.a() and key = 'staffMeta';
  if not found then raise exception 'staffMeta not updated'; end if;
  if pg_temp.msgs('3', 'all') <> 0 or pg_temp.post('3', 'all', 'x') then raise exception 'a suspended member reaches Team chat'; end if;
  perform pg_temp.as_user(pg_temp.u('1'));
  update public.blobs set data = '{"v":{}}' where org_id = pg_temp.a() and key = 'staffMeta';
  if not found then raise exception 'staffMeta not updated'; end if;
  raise notice 'ok: view only reads, Staff Access per role and per person, suspended people reach nothing';
end $$;
reset role;
update public.orgs set status = 'paused' where id = '00000000-0000-4000-8000-00000000f001';
set local role authenticated;
do $$
begin
  if pg_temp.msgs('2', 'all') < 1 then raise exception 'paused: cannot read'; end if;
  if pg_temp.post('2', 'all', 'paused') then raise exception 'paused: posted'; end if;
  raise notice 'ok: a paused workspace reads Team chat and writes nothing';
end $$;
reset role;
update public.orgs set status = 'active' where id = '00000000-0000-4000-8000-00000000f001';
set local role authenticated;
do $$
declare n int; ok boolean;
begin
  perform pg_temp.as_user(pg_temp.u('5'));   -- the owner of workspace B
  select count(*) into n from public.team_messages where org_id = pg_temp.a();
  if n <> 0 then raise exception 'workspace B reads workspace A''s messages'; end if;
  select count(*) into n from public.team_chats where org_id = pg_temp.a();
  if n <> 0 then raise exception 'workspace B sees workspace A''s chats'; end if;
  begin insert into public.team_messages (org_id, chat_id, sender, body) values (pg_temp.a(), 'all', 'u1', 'hi from B'); ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'workspace B''s owner posted in workspace A (same staff id u1)'; end if;
  begin perform public.team_list(pg_temp.a()); ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'workspace B''s owner listed workspace A''s chats'; end if;
  select count(*) into n from storage.objects where bucket_id = 'team-files';
  if n <> 0 then raise exception 'workspace B sees workspace A''s files'; end if;
  raise notice 'ok: another workspace reaches nothing';
end $$;
reset role;

-- anon
set local role anon;
select pg_temp.as_user(null);
do $$
declare ok boolean;
begin
  begin perform 1 from public.team_messages; ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'anon reads team_messages'; end if;
  begin perform public.team_list('00000000-0000-4000-8000-00000000f001'); ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'anon calls team_list'; end if;
  raise notice 'ok: anon reaches nothing';
end $$;
reset role;

-- the phone alert (the server, as the service role): once, to the others in the chat, not to people who muted it
set local role authenticated;
do $$ begin perform pg_temp.as_user(pg_temp.u('3')); perform public.team_mute(pg_temp.a(), 'all', true); end $$;
do $$ begin if not pg_temp.post('2', 'all', 'Lift is broken in block B') then raise exception 'ops cannot post'; end if; end $$;
reset role;
set local role service_role;
do $$
declare m uuid; r jsonb; g text := (select v from pg_temp.ids where k = 'g'); users jsonb;
begin
  select id into m from public.team_messages where org_id = pg_temp.a() and body = 'Lift is broken in block B';
  if public.team_push_claim(pg_temp.a(), m, pg_temp.u('3')::uuid) is not null then raise exception 'someone other than the sender claimed the alert'; end if;
  r := public.team_push_claim(pg_temp.a(), m, pg_temp.u('2')::uuid);
  users := r->'users';
  if r->>'senderName' <> 'Wei Ling Tan' or r->'chat'->>'kind' <> 'all' or r->>'body' <> 'Lift is broken in block B' then raise exception 'claim: %', r; end if;
  if users @> to_jsonb(pg_temp.u('2')) then raise exception 'the sender gets their own alert'; end if;
  if users @> to_jsonb(pg_temp.u('3')) then raise exception 'someone who muted All staff gets the alert'; end if;
  if users @> to_jsonb(pg_temp.u('6')) then raise exception 'the accountant with Team chat off gets the alert'; end if;
  if not (users @> to_jsonb(pg_temp.u('1')) and users @> to_jsonb(pg_temp.u('4'))) then raise exception 'claim users: %', users; end if;
  if public.team_push_claim(pg_temp.a(), m, pg_temp.u('2')::uuid) is not null then raise exception 'an alert claimed twice'; end if;
  -- a group's alert goes to its people only
  select id into m from public.team_messages where org_id = pg_temp.a() and chat_id = g and body = 'Linen at 2pm';
  r := public.team_push_claim(pg_temp.a(), m, pg_temp.u('2')::uuid);
  if r->'users' <> jsonb_build_array(pg_temp.u('1')) then raise exception 'group alert users: %', r->'users'; end if;
  -- old messages are not alerted
  insert into public.team_messages (org_id, chat_id, sender, body) values (pg_temp.a(), 'all', 's2', 'old');
  update public.team_messages set created_at = now() - interval '1 hour' where body = 'old';
  select id into m from public.team_messages where body = 'old';
  if public.team_push_claim(pg_temp.a(), m, pg_temp.u('2')::uuid) is not null then raise exception 'an old message was alerted'; end if;
  raise notice 'ok: the alert goes once, to the others in the chat, not muted, not the sender';
end $$;
reset role;

do $$
declare ok boolean;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'push_devices' and column_name = 'booking_alerts' and column_default = 'true') then
    raise exception 'push_devices.booking_alerts missing';
  end if;
  if (select public from storage.buckets where id = 'team-files') then raise exception 'team-files is public'; end if;
  if has_function_privilege('authenticated', 'public.team_push_claim(uuid, uuid, uuid)', 'execute') then raise exception 'members may claim alerts'; end if;
  if has_function_privilege('authenticated', 'public.team__level(uuid, uuid)', 'execute') then raise exception 'members may ask anyone''s level'; end if;
  -- realtime: messages and chats are published; membership rows never (realtime does not check RLS on deletes)
  if (select string_agg(tablename, ',' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'team%')
     is distinct from 'team_chats,team_messages' then raise exception 'wrong team tables in the realtime publication'; end if;
  raise notice 'ok: grants, bucket private, push_devices.booking_alerts, realtime tables';
end $$;

-- 0025: translations are for the server only, and go with their message
do $$
declare m uuid;
begin
  if has_table_privilege('authenticated', 'public.team_message_translations', 'select') then raise exception 'members may read translations directly'; end if;
  if has_table_privilege('anon', 'public.team_message_translations', 'select') then raise exception 'anon may read translations'; end if;
  if not has_table_privilege('service_role', 'public.team_message_translations', 'insert') then raise exception 'the server cannot save translations'; end if;
  select id into m from public.team_messages limit 1;
  insert into public.team_message_translations (message_id, lang, src_lang, body) values (m, 'en', 'ms', 'Room is ready');
  begin insert into public.team_message_translations (message_id, lang) values (m, 'english'); raise exception 'bad language saved'; exception when check_violation then null; end;
  delete from public.team_messages where id = m;
  if exists (select 1 from public.team_message_translations where message_id = m) then raise exception 'translation outlived its message'; end if;
  raise notice 'ok: translations server-only, removed with their message';
end $$;

rollback;
\o
select 'team chat: ok';
