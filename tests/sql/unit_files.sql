-- Unit files (supabase/migrations/0023_unit_files.sql): only members with "See and edit unit files"
-- (properties.file, unit_file_can) read or change a unit's file and its documents in the unit-docs bucket; account
-- owners always, every other role only when granted; never another workspace, never anon. Needs the Storage
-- stand-in (tests/sql/storage_stub.sql). Runs in one transaction and rolls back. Any failed check raises an error.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/unit_files.sql
\o /dev/null
begin;
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000c001', 'owner@t'), ('00000000-0000-4000-8000-00000000c002', 'ops@t'),
  ('00000000-0000-4000-8000-00000000c003', 'ops-granted@t'), ('00000000-0000-4000-8000-00000000c004', 'house@t'),
  ('00000000-0000-4000-8000-00000000c005', 'owner-b@t'), ('00000000-0000-4000-8000-00000000c006', 'acc@t');
insert into public.orgs (id, name) values ('00000000-0000-4000-8000-00000000d001', 'Unit files A'), ('00000000-0000-4000-8000-00000000d002', 'Unit files B');
insert into public.members (org_id, user_id, staff_id, role) values
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c001', 'u1', 'owner'),
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c002', 's2', 'ops'),
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c003', 's3', 'ops'),
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c004', 's4', 'housekeeping'),
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c006', 's6', 'accountant'),
  ('00000000-0000-4000-8000-00000000d002', '00000000-0000-4000-8000-00000000c005', 'u1', 'owner');
-- s3 (ops) is granted unit files in Staff Access; s6 (accountant) has the action but no Properties section
insert into public.blobs (org_id, key, data) values
  ('00000000-0000-4000-8000-00000000d001', 'staffMeta', '{"v":{"s3":{"overrides":{"properties.file":true}},"s6":{"overrides":{"properties.file":true}}}}');
insert into public.unit_files (org_id, property_id, data) values
  ('00000000-0000-4000-8000-00000000d001', 'kls', '{"lease":{"rent":3200},"owner":{"accountNo":"1234-XXXX"}}'),
  ('00000000-0000-4000-8000-00000000d002', 'kls', '{"lease":{"rent":9999}}');
insert into storage.objects (bucket_id, name) values
  ('unit-docs', '00000000-0000-4000-8000-00000000d001/kls/ta.pdf'),
  ('unit-docs', '00000000-0000-4000-8000-00000000d002/kls/ta.pdf');

create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claims', case when u is null then '' else json_build_object('sub', u)::text end, true); $$;
-- what the signed-in member can do in workspace A, and that nothing of workspace B is ever reachable
create or replace function pg_temp.check(who text, want boolean, in_b boolean default false) returns void language plpgsql as $$
declare
  a constant uuid := '00000000-0000-4000-8000-00000000d001'; b constant uuid := '00000000-0000-4000-8000-00000000d002';
  n int; ok boolean;
begin
  perform pg_temp.as_user(who);
  -- read
  select count(*) into n from public.unit_files where org_id = a;
  if (n = 1) <> want then raise exception '% reading unit_files: % rows', who, n; end if;
  -- update
  update public.unit_files set data = data || '{"notes":"x"}' where org_id = a and property_id = 'kls';
  if found <> want then raise exception '% updating unit_files: %', who, found; end if;
  -- insert
  begin
    insert into public.unit_files (org_id, property_id, data) values (a, 'or4', '{}'); ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok <> want then raise exception '% inserting unit_files: %', who, ok; end if;
  -- delete
  delete from public.unit_files where org_id = a and property_id = 'or4';
  if found <> want then raise exception '% deleting unit_files: %', who, found; end if;
  -- documents: list, upload, rename, remove
  select count(*) into n from storage.objects where bucket_id = 'unit-docs' and name like a::text || '/%';
  if (n = 1) <> want then raise exception '% listing documents: %', who, n; end if;
  begin
    insert into storage.objects (bucket_id, name) values ('unit-docs', a::text || '/kls/new.pdf'); ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok <> want then raise exception '% uploading a document: %', who, ok; end if;
  update storage.objects set metadata = '{"x":1}' where bucket_id = 'unit-docs' and name = a::text || '/kls/ta.pdf';
  if found <> want then raise exception '% changing a document: %', who, found; end if;
  delete from storage.objects where bucket_id = 'unit-docs' and name = a::text || '/kls/new.pdf';
  if found <> want then raise exception '% removing a document: %', who, found; end if;
  -- the other workspace: never (for B's own owner: their own rows, and still nothing of A above)
  if in_b then
    select count(*) into n from public.unit_files where org_id = b;
    if n <> 1 then raise exception '% cannot read their own workspace''s unit file', who; end if;
    raise notice 'ok: % reads only their own workspace', who;
    return;
  end if;
  select count(*) into n from public.unit_files where org_id = b;
  if n <> 0 then raise exception '% reads workspace B''s unit file', who; end if;
  update public.unit_files set data = '{}' where org_id = b;
  if found then raise exception '% changed workspace B''s unit file', who; end if;
  begin
    insert into public.unit_files (org_id, property_id, data) values (b, 'x1', '{}'); ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception '% added a unit file to workspace B', who; end if;
  select count(*) into n from storage.objects where bucket_id = 'unit-docs' and name like b::text || '/%';
  if n <> 0 then raise exception '% lists workspace B''s documents', who; end if;
  begin
    insert into storage.objects (bucket_id, name) values ('unit-docs', b::text || '/kls/evil.pdf'); ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception '% uploaded into workspace B', who; end if;
  -- a path that does not start with a workspace id, or has no unit folder
  begin
    insert into storage.objects (bucket_id, name) values ('unit-docs', 'loose.pdf'); ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception '% uploaded outside a workspace folder', who; end if;
  begin
    insert into storage.objects (bucket_id, name) values ('unit-docs', a::text || '/kls/sub/deep.pdf'); ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception '% uploaded to a nested path', who; end if;
  raise notice 'ok: % % unit files', coalesce(who, 'anon'), case when want then 'can use' else 'cannot reach' end;
end $$;

set local role authenticated;
select pg_temp.check('00000000-0000-4000-8000-00000000c001', true);   -- owner of A
select pg_temp.check('00000000-0000-4000-8000-00000000c002', false);  -- ops, not granted (the default)
select pg_temp.check('00000000-0000-4000-8000-00000000c003', true);   -- ops, granted in Staff Access
select pg_temp.check('00000000-0000-4000-8000-00000000c004', false);  -- housekeeping
select pg_temp.check('00000000-0000-4000-8000-00000000c006', false);  -- accountant: action on, no Properties section
select pg_temp.check('00000000-0000-4000-8000-00000000c005', false, true);  -- owner of workspace B, looking at A
reset role;

-- saved role permissions: ops given the action for the whole role; then suspended; then the workspace paused
insert into public.blobs (org_id, key, data) values ('00000000-0000-4000-8000-00000000d001', 'rolePerms',
  '{"v":{"ops":{"sections":{"properties":"edit"},"actions":{"properties.file":true}},"housekeeping":{"sections":{"properties":"view"},"actions":{}}}}');
set local role authenticated;
select pg_temp.check('00000000-0000-4000-8000-00000000c002', true);
select pg_temp.check('00000000-0000-4000-8000-00000000c004', false);
reset role;
update public.blobs set data = '{"v":{"s2":{"status":"suspended"},"s3":{"overrides":{"properties.file":false}}}}' where org_id = '00000000-0000-4000-8000-00000000d001' and key = 'staffMeta';
set local role authenticated;
select pg_temp.check('00000000-0000-4000-8000-00000000c002', false);  -- suspended
select pg_temp.check('00000000-0000-4000-8000-00000000c003', false);  -- switched off for them
reset role;
update public.orgs set status = 'paused' where id = '00000000-0000-4000-8000-00000000d001';
set local role authenticated;
do $$
declare n int;
begin
  perform pg_temp.as_user('00000000-0000-4000-8000-00000000c001');
  select count(*) into n from public.unit_files where org_id = '00000000-0000-4000-8000-00000000d001';
  if n <> 1 then raise exception 'paused: owner cannot read'; end if;
  update public.unit_files set data = '{}' where org_id = '00000000-0000-4000-8000-00000000d001';
  if found then raise exception 'paused: owner changed a unit file'; end if;
  raise notice 'ok: a paused workspace reads its unit files and changes nothing';
end $$;
reset role;
update public.orgs set status = 'active' where id = '00000000-0000-4000-8000-00000000d001';

-- anon: no table privilege at all, and nothing in the bucket
set local role anon;
select pg_temp.as_user(null);
do $$
declare n int; ok boolean;
begin
  begin
    perform 1 from public.unit_files; ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'anon can read unit_files'; end if;
  select count(*) into n from storage.objects where bucket_id = 'unit-docs';
  if n <> 0 then raise exception 'anon lists documents'; end if;
  begin
    insert into storage.objects (bucket_id, name) values ('unit-docs', '00000000-0000-4000-8000-00000000d001/kls/a.pdf'); ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'anon uploaded a document'; end if;
  raise notice 'ok: anon reaches nothing';
end $$;
reset role;

-- the bucket is private, 20 MB, documents and photos only; reset_org clears the unit files; grants
do $$
declare bk record;
begin
  select * into bk from storage.buckets where id = 'unit-docs';
  if bk.id is null or bk.public or bk.file_size_limit <> 20971520 or not (bk.allowed_mime_types @> array['application/pdf', 'image/heic']) then raise exception 'bucket: %', row_to_json(bk); end if;
  if has_table_privilege('anon', 'public.unit_files', 'select') then raise exception 'anon has select on unit_files'; end if;
  if has_function_privilege('anon', 'public.unit_file_can(uuid)', 'execute') then raise exception 'anon may call unit_file_can'; end if;
  perform pg_temp.as_user('00000000-0000-4000-8000-00000000c001');
  perform public.reset_org('00000000-0000-4000-8000-00000000d001');
  if exists (select 1 from public.unit_files where org_id = '00000000-0000-4000-8000-00000000d001') then raise exception 'reset_org kept unit files'; end if;
  if not exists (select 1 from public.unit_files where org_id = '00000000-0000-4000-8000-00000000d002') then raise exception 'reset_org cleared another workspace'; end if;
  raise notice 'ok: bucket private, grants, reset_org';
end $$;
\o
select 'unit files: ok';
rollback;
