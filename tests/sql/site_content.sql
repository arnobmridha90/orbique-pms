-- Website content (supabase/migrations/0017_site_content.sql): siteContentLive is written only by the server; the
-- siteContent draft and the website settings only by members who may edit the website (website_can, the app's Staff
-- Access rule). Runs in one
-- transaction and rolls back. Any failed check raises an error.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/site_content.sql
\o /dev/null
begin;
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000a001', 'owner@t'), ('00000000-0000-4000-8000-00000000a002', 'ops@t'),
  ('00000000-0000-4000-8000-00000000a003', 'front@t'), ('00000000-0000-4000-8000-00000000a004', 'ops2@t'),
  ('00000000-0000-4000-8000-00000000a005', 'acc@t'), ('00000000-0000-4000-8000-00000000a006', 'owner2@t');
insert into public.orgs (id, name) values ('00000000-0000-4000-8000-00000000b001', 'Site test');
insert into public.members (org_id, user_id, staff_id, role) values
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000a001', 'u1', 'owner'),
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000a002', 's2', 'ops'),
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000a003', 's3', 'frontdesk'),
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000a004', 's4', 'ops'),
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000a005', 's5', 'accountant'),
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000a006', 'u6', 'owner');
-- s4 (ops) has the website switched off for them; s3 (front desk) has it switched on; u6 is a suspended owner
insert into public.blobs (org_id, key, data) values
  ('00000000-0000-4000-8000-00000000b001', 'staffMeta', '{"v":{"s4":{"overrides":{"website.edit":false}},"s3":{"overrides":{"section:website":"edit","website.edit":true}},"u6":{"status":"suspended"}}}'),
  ('00000000-0000-4000-8000-00000000b001', 'siteContentLive', '{"v":{"content":{"version":1,"buildings":[],"suites":[]},"publishedAt":"2026-10-28T07:00:00Z","publishedBy":"Server"}}');

create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub', u)::text, true); $$;
create or replace function pg_temp.save(k text, v text) returns void language sql as $$
  insert into public.blobs (org_id, key, data) values ('00000000-0000-4000-8000-00000000b001', k, jsonb_build_object('v', v::jsonb))
    on conflict (org_id, key) do update set data = excluded.data;
$$;
create or replace function pg_temp.can(k text) returns boolean language plpgsql as $$
begin
  perform pg_temp.save(k, '{"version":1,"buildings":[],"suites":[],"by":"' || (current_setting('request.jwt.claims', true)::jsonb->>'sub') || '"}');
  return true;
exception when insufficient_privilege then return false;
end $$;
create or replace function pg_temp.expect(who text, k text, want boolean) returns void language plpgsql as $$
declare got boolean;
begin
  perform pg_temp.as_user(who);
  got := pg_temp.can(k);
  if got <> want then raise exception '% writing %: got %, want %', who, k, got, want; end if;
  raise notice 'ok: % % write %', who, case when want then 'may' else 'may not' end, k;
end $$;

set local role authenticated;
-- the draft: owner and ops by default, an override either way, nobody else
select pg_temp.expect('00000000-0000-4000-8000-00000000a001', 'siteContent', true);
select pg_temp.expect('00000000-0000-4000-8000-00000000a002', 'siteContent', true);
select pg_temp.expect('00000000-0000-4000-8000-00000000a003', 'siteContent', true);
select pg_temp.expect('00000000-0000-4000-8000-00000000a004', 'siteContent', false);
select pg_temp.expect('00000000-0000-4000-8000-00000000a005', 'siteContent', false);
select pg_temp.expect('00000000-0000-4000-8000-00000000a006', 'siteContent', false);
-- a plain update by someone who may not edit touches nothing
select pg_temp.as_user('00000000-0000-4000-8000-00000000a005');
do $$ begin
  update public.blobs set data = '{"v":{}}' where key = 'siteContent';
  if found then raise exception 'accountant updated siteContent'; end if;
  if (select count(*) from public.blobs where key in ('siteContent', 'siteContentLive')) <> 2 then raise exception 'accountant cannot read the website blobs'; end if;
  raise notice 'ok: accountant reads both, updates neither';
end $$;
-- the published copy: no signed-in member, owners included
select pg_temp.expect('00000000-0000-4000-8000-00000000a001', 'siteContentLive', false);
select pg_temp.expect('00000000-0000-4000-8000-00000000a002', 'siteContentLive', false);
select pg_temp.as_user('00000000-0000-4000-8000-00000000a001');
do $$ begin
  update public.blobs set data = '{"v":{}}' where key = 'siteContentLive';
  if found then raise exception 'owner updated siteContentLive'; end if;
  raise notice 'ok: an owner cannot change the published copy';
end $$;
-- the website settings (its address is where Publish sends the refresh): the same rule as the draft
select pg_temp.expect('00000000-0000-4000-8000-00000000a001', 'website', true);
select pg_temp.expect('00000000-0000-4000-8000-00000000a002', 'website', true);
select pg_temp.expect('00000000-0000-4000-8000-00000000a004', 'website', false);
select pg_temp.expect('00000000-0000-4000-8000-00000000a005', 'website', false);
select pg_temp.as_user('00000000-0000-4000-8000-00000000a005');
do $$ begin
  update public.blobs set data = '{"v":{"siteUrl":"https://attacker.example"}}' where key = 'website';
  if found then raise exception 'accountant updated the website settings'; end if;
  raise notice 'ok: an accountant cannot change the website address';
end $$;
-- other blobs as before
select pg_temp.expect('00000000-0000-4000-8000-00000000a005', 'priceLog', true);
select pg_temp.expect('00000000-0000-4000-8000-00000000a002', 'rolePerms', false);
-- saved role permissions: accountant given the website, ops without the website in its saved role keeps the default
reset role;
select pg_temp.save('rolePerms', '{"accountant":{"sections":{"website":"edit"},"actions":{"website.edit":true,"website.publish":false}},"ops":{"sections":{"dashboard":"edit"},"actions":{}},"frontdesk":{"sections":{"website":"view"},"actions":{"website.edit":true}}}');
set local role authenticated;
select pg_temp.expect('00000000-0000-4000-8000-00000000a005', 'siteContent', true);
select pg_temp.expect('00000000-0000-4000-8000-00000000a002', 'siteContent', true);
do $$ begin
  perform pg_temp.as_user('00000000-0000-4000-8000-00000000a005');
  if public.website_can('00000000-0000-4000-8000-00000000b001', 'publish') then raise exception 'accountant may publish'; end if;
  if not public.website_can('00000000-0000-4000-8000-00000000b001', 'edit') then raise exception 'accountant may not edit'; end if;
  perform pg_temp.as_user('00000000-0000-4000-8000-00000000a002');
  if not public.website_can('00000000-0000-4000-8000-00000000b001', 'publish') then raise exception 'ops lost the default publish'; end if;
  if public.website_can('00000000-0000-4000-8000-00000000b001', 'delete') then raise exception 'unknown action allowed'; end if;
  raise notice 'ok: website_can follows saved role permissions and the defaults';
end $$;
-- a section at View is not enough to edit (front desk's override still gives it Edit)
reset role;
select pg_temp.save('staffMeta', '{}');
set local role authenticated;
select pg_temp.expect('00000000-0000-4000-8000-00000000a003', 'siteContent', false);
-- the server (no signed-in user, service role) writes the published copy
reset role;
set local role service_role;
select set_config('request.jwt.claims', '', true);
update public.blobs set data = '{"v":{"content":null,"publishedAt":"2026-10-28T08:00:00Z","publishedBy":"Server"}}' where org_id = '00000000-0000-4000-8000-00000000b001' and key = 'siteContentLive';
do $$ begin
  if (select data->'v'->>'publishedAt' from public.blobs where key = 'siteContentLive') <> '2026-10-28T08:00:00Z' then raise exception 'service role could not write'; end if;
  raise notice 'ok: the server writes the published copy';
end $$;
reset role;
rollback;
