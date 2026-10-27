-- Profit planner (supabase/migrations/0016_planner_owner_only.sql): the ratePlanner blob is read and written by owners
-- only, every other blob as in 0001; an app save of it keeps what another device saved that the saving one had not seen
-- (units by updatedAt, push records by id). Runs in one transaction and rolls back. Any failed check raises an error.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/planner.sql
\o /dev/null
begin;
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000f001', 'owner@t'), ('00000000-0000-4000-8000-00000000f002', 'ops@t'),
  ('00000000-0000-4000-8000-00000000f003', 'acc@t'), ('00000000-0000-4000-8000-00000000f004', 'owner2@t');
insert into public.orgs (id, name) values ('00000000-0000-4000-8000-00000000e001', 'Planner test');
insert into public.members (org_id, user_id, staff_id, role) values
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000f001', 'u1', 'owner'),
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000f002', 's2', 'ops'),
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000f003', 's7', 'accountant'),
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000f004', 'u9', 'owner');
insert into public.blobs (org_id, key, data) values
  ('00000000-0000-4000-8000-00000000e001', 'ratePlanner', '{"v":{"units":{"p1":{"costs":{"rent":2200},"updatedAt":"2026-10-20T10:00"}},"pushes":[]}}'),
  ('00000000-0000-4000-8000-00000000e001', 'priceLog', '{"v":[]}');

create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub', u)::text, true); $$;
create or replace function pg_temp.save(v text) returns void language sql as $$
  insert into public.blobs (org_id, key, data) values ('00000000-0000-4000-8000-00000000e001', 'ratePlanner', jsonb_build_object('v', v::jsonb))
    on conflict (org_id, key) do update set data = excluded.data;
$$;
create or replace function pg_temp.saved() returns jsonb language sql as $$
  select data->'v' from public.blobs where org_id = '00000000-0000-4000-8000-00000000e001' and key = 'ratePlanner';
$$;

set local role authenticated;
-- owners read and upsert it (PostgREST upsert = insert on conflict do update)
select pg_temp.as_user('00000000-0000-4000-8000-00000000f001');
do $$ begin if (select count(*) from public.blobs where key = 'ratePlanner') <> 1 then raise exception 'owner cannot read ratePlanner'; end if; raise notice 'ok: owner reads ratePlanner'; end $$;
select pg_temp.save('{"units":{},"pushes":[{"id":"PP1","at":"2026-10-21T09:00","pid":"p1"}]}');
do $$ begin raise notice 'ok: owner upserts ratePlanner'; end $$;
select pg_temp.as_user('00000000-0000-4000-8000-00000000f004');
do $$ begin if (select count(*) from public.blobs where key = 'ratePlanner') <> 1 then raise exception 'second owner cannot read'; end if; raise notice 'ok: second owner reads ratePlanner'; end $$;
-- ops: cannot see it or write it, still sees and writes the others
select pg_temp.as_user('00000000-0000-4000-8000-00000000f002');
do $$ begin
  if (select count(*) from public.blobs where key = 'ratePlanner') <> 0 then raise exception 'ops reads ratePlanner'; end if;
  if (select count(*) from public.blobs where key = 'priceLog') <> 1 then raise exception 'ops lost priceLog'; end if;
  raise notice 'ok: ops does not see ratePlanner, sees priceLog';
end $$;
do $$ begin
  begin
    insert into public.blobs (org_id, key, data) values ('00000000-0000-4000-8000-00000000e001', 'ratePlanner', '{"v":{}}') on conflict (org_id, key) do update set data = excluded.data;
    raise exception 'ops upserted ratePlanner';
  exception when insufficient_privilege then raise notice 'ok: ops upsert of ratePlanner refused (%)', sqlerrm; end;
  update public.blobs set data = '{"v":{}}' where key = 'ratePlanner';
  if found then raise exception 'ops updated ratePlanner'; end if;
  raise notice 'ok: ops plain update touches nothing';
  insert into public.blobs (org_id, key, data) values ('00000000-0000-4000-8000-00000000e001', 'priceLog', '{"v":[1]}') on conflict (org_id, key) do update set data = excluded.data;
  raise notice 'ok: ops still upserts priceLog';
end $$;
select pg_temp.as_user('00000000-0000-4000-8000-00000000f003');
do $$ begin if (select count(*) from public.blobs where key = 'ratePlanner') <> 0 then raise exception 'accountant reads ratePlanner'; end if; raise notice 'ok: accountant does not see it'; end $$;

-- the merge, as an owner
select pg_temp.as_user('00000000-0000-4000-8000-00000000f001');
do $$ declare v jsonb; begin
  v := pg_temp.saved();
  -- the save above had no units: the saved unit stays, and the push is in
  if v->'units'->'p1'->'costs'->>'rent' <> '2200' then raise exception 'a save without the unit dropped it: %', v; end if;
  if v->'pushes'->0->>'id' <> 'PP1' then raise exception 'push lost: %', v; end if;
  raise notice 'ok: a save keeps a unit it did not have';
end $$;
-- a device that missed PP1 saves another unit's costs: PP1 stays, both units are there
select pg_temp.save('{"units":{"p1":{"costs":{"rent":2200},"updatedAt":"2026-10-20T10:00"},"p2":{"costs":{"rent":900},"updatedAt":"2026-10-22T08:00"}},"pushes":[]}');
do $$ declare v jsonb; begin
  v := pg_temp.saved();
  if v->'units'->'p2'->'costs'->>'rent' <> '900' or v->'units'->'p1' is null then raise exception 'units: %', v->'units'; end if;
  if jsonb_array_length(v->'pushes') <> 1 or v->'pushes'->0->>'id' <> 'PP1' then raise exception 'a stale save dropped the push: %', v->'pushes'; end if;
  raise notice 'ok: a stale save keeps the push it missed';
end $$;
-- the same unit on both: the one saved last wins, whichever copy it is in
select pg_temp.save('{"units":{"p2":{"costs":{"rent":800},"updatedAt":"2026-10-21T08:00"}},"pushes":[]}');
do $$ begin if pg_temp.saved()->'units'->'p2'->'costs'->>'rent' <> '900' then raise exception 'an older save of p2 won'; end if; raise notice 'ok: an older save of a unit loses'; end $$;
select pg_temp.save('{"units":{"p2":{"costs":{"rent":950},"updatedAt":"2026-10-23T08:00"}},"pushes":[]}');
do $$ begin if pg_temp.saved()->'units'->'p2'->'costs'->>'rent' <> '950' then raise exception 'a newer save of p2 lost'; end if; raise notice 'ok: a newer save of a unit wins'; end $$;
-- Undo on one device, then a stale copy without undoneAt: the push stays undone; a new push goes first
select pg_temp.save('{"units":{},"pushes":[{"id":"PP1","at":"2026-10-21T09:00","pid":"p1","undoneAt":"2026-10-24T12:00"}]}');
select pg_temp.save('{"units":{},"pushes":[{"id":"PP2","at":"2026-10-25T09:00","pid":"p2"},{"id":"PP1","at":"2026-10-21T09:00","pid":"p1"}]}');
do $$ declare v jsonb; begin
  v := pg_temp.saved()->'pushes';
  if jsonb_array_length(v) <> 2 or v->0->>'id' <> 'PP2' or v->1->>'id' <> 'PP1' then raise exception 'pushes: %', v; end if;
  if v->1->>'undoneAt' is distinct from '2026-10-24T12:00' then raise exception 'a stale copy un-did the undo: %', v->1; end if;
  raise notice 'ok: an undone push stays undone, newest first';
end $$;
-- Undo of PA hands its night on to the later PB and stamps both; a device that missed it saves stale copies of both:
-- PA stays undone and PB keeps the hand-off, so undoing PB later puts back RM250, not PA's RM300
select pg_temp.save('{"units":{},"pushes":[{"id":"PB","at":"2026-08-02T10:00","pid":"p1","nights":{"2026-11-01":{"from":300,"to":320}}},{"id":"PA","at":"2026-08-01T10:00","pid":"p1","nights":{"2026-11-01":{"from":250,"to":300}}}]}');
select pg_temp.save('{"units":{},"pushes":[{"id":"PB","at":"2026-08-02T10:00","pid":"p1","changedAt":"2026-10-26T08:00","nights":{"2026-11-01":{"from":250,"to":320}}},{"id":"PA","at":"2026-08-01T10:00","pid":"p1","undoneAt":"2026-10-26T08:00","changedAt":"2026-10-26T08:00","nights":{"2026-11-01":{"from":250,"to":300}}}]}');
select pg_temp.save('{"units":{"p3":{"costs":{"rent":10},"updatedAt":"2026-10-26T08:30"}},"pushes":[{"id":"PB","at":"2026-08-02T10:00","pid":"p1","nights":{"2026-11-01":{"from":300,"to":320}}},{"id":"PA","at":"2026-08-01T10:00","pid":"p1","nights":{"2026-11-01":{"from":250,"to":300}}}]}');
do $$ declare v jsonb; a jsonb; b jsonb; begin
  v := pg_temp.saved();
  select e into a from jsonb_array_elements(v->'pushes') e where e->>'id' = 'PA';
  select e into b from jsonb_array_elements(v->'pushes') e where e->>'id' = 'PB';
  if a->>'undoneAt' is distinct from '2026-10-26T08:00' then raise exception 'PA lost its undo: %', a; end if;
  if b->'nights'->'2026-11-01'->>'from' is distinct from '250' then raise exception 'PB lost the hand-off: %', b; end if;
  if v->'units'->'p3' is null then raise exception 'the stale save lost its own unit: %', v->'units'; end if;
  raise notice 'ok: a stale save keeps the undo and the hand-off it missed';
end $$;
-- neither undone: the copy changed last wins, the new one on a tie
select pg_temp.save('{"units":{},"pushes":[{"id":"PB","at":"2026-08-02T10:00","pid":"p1","changedAt":"2026-10-26T09:00","nights":{"2026-11-01":{"from":260,"to":320}}}]}');
do $$ begin
  if (select e->'nights'->'2026-11-01'->>'from' from jsonb_array_elements(pg_temp.saved()->'pushes') e where e->>'id' = 'PB') is distinct from '260' then raise exception 'a newer change of PB lost'; end if;
  raise notice 'ok: the push record changed last wins';
end $$;
-- an Undo is never lost: a copy that is not undone loses to the undone one even when it was changed later, in either order
select pg_temp.save('{"units":{},"pushes":[{"id":"PC","at":"2026-08-04T10:00","pid":"p1","undoneAt":"2026-10-26T09:00","changedAt":"2026-10-26T09:00","nights":{"2026-11-03":{"from":200,"to":220}}}]}');
select pg_temp.save('{"units":{},"pushes":[{"id":"PC","at":"2026-08-04T10:00","pid":"p1","changedAt":"2026-10-26T09:30","nights":{"2026-11-03":{"from":190,"to":220,"handedAt":"2026-10-26T09:30"}}}]}');
select pg_temp.save('{"units":{},"pushes":[{"id":"PD","at":"2026-08-05T10:00","pid":"p1","changedAt":"2026-10-26T09:30","nights":{"2026-11-04":{"from":190,"to":220}}}]}');
select pg_temp.save('{"units":{},"pushes":[{"id":"PD","at":"2026-08-05T10:00","pid":"p1","undoneAt":"2026-10-26T09:00","changedAt":"2026-10-26T09:00","nights":{"2026-11-04":{"from":200,"to":220}}}]}');
do $$ declare c jsonb; dd jsonb; begin
  select e into c from jsonb_array_elements(pg_temp.saved()->'pushes') e where e->>'id' = 'PC';
  select e into dd from jsonb_array_elements(pg_temp.saved()->'pushes') e where e->>'id' = 'PD';
  if c->>'undoneAt' is null then raise exception 'a newer save un-did the undo of PC: %', c; end if;
  if dd->>'undoneAt' is null then raise exception 'the undo of PD was lost: %', dd; end if;
  raise notice 'ok: an undone copy wins over a later change, in either order';
end $$;
-- the same stamp on both: the new copy wins
select pg_temp.save('{"units":{},"pushes":[{"id":"PE","at":"2026-08-06T10:00","pid":"p1","changedAt":"2026-10-26T10:00","n":1}]}');
select pg_temp.save('{"units":{},"pushes":[{"id":"PE","at":"2026-08-06T10:00","pid":"p1","changedAt":"2026-10-26T10:00","n":2}]}');
do $$ begin
  if (select e->>'n' from jsonb_array_elements(pg_temp.saved()->'pushes') e where e->>'id' = 'PE') is distinct from '2' then raise exception 'a tie did not go to the new copy'; end if;
  raise notice 'ok: on the same stamp the new copy wins';
end $$;
-- an Undo in the same minute as the later push (changedAt equal to its at): a stale copy without changedAt still loses
select pg_temp.save('{"units":{},"pushes":[{"id":"PF","at":"2026-08-07T10:20","pid":"p1","changedAt":"2026-08-07T10:20","nights":{"2026-11-05":{"from":250,"to":320,"handedAt":"2026-08-07T10:20"}}}]}');
select pg_temp.save('{"units":{},"pushes":[{"id":"PF","at":"2026-08-07T10:20","pid":"p1","nights":{"2026-11-05":{"from":300,"to":320}}}]}');
do $$ begin
  if (select e->'nights'->'2026-11-05'->>'from' from jsonb_array_elements(pg_temp.saved()->'pushes') e where e->>'id' = 'PF') is distinct from '250' then raise exception 'a same-minute hand-off was lost'; end if;
  raise notice 'ok: a hand-off in the minute of the push is kept';
end $$;
-- two devices each hand a different night to the same push (one missed the other): both hand-offs are kept
select pg_temp.save('{"units":{},"pushes":[{"id":"PG","at":"2026-08-08T10:00","pid":"p1","nights":{"2026-11-06":{"from":300,"to":320},"2026-11-07":{"from":200,"to":210}}}]}');
select pg_temp.save('{"units":{},"pushes":[{"id":"PG","at":"2026-08-08T10:00","pid":"p1","changedAt":"2026-10-26T09:00","nights":{"2026-11-06":{"from":250,"to":320,"handedAt":"2026-10-26T09:00"},"2026-11-07":{"from":200,"to":210}}}]}');
select pg_temp.save('{"units":{},"pushes":[{"id":"PG","at":"2026-08-08T10:00","pid":"p1","changedAt":"2026-10-26T09:05","nights":{"2026-11-06":{"from":300,"to":320},"2026-11-07":{"from":150,"to":210,"handedAt":"2026-10-26T09:05"}}}]}');
do $$ declare g jsonb; begin
  select e into g from jsonb_array_elements(pg_temp.saved()->'pushes') e where e->>'id' = 'PG';
  if g->'nights'->'2026-11-06'->>'from' is distinct from '250' or g->'nights'->'2026-11-07'->>'from' is distinct from '150' then raise exception 'a hand-off was lost: %', g->'nights'; end if;
  if g->>'changedAt' is distinct from '2026-10-26T09:05' then raise exception 'the later copy was not picked: %', g; end if;
  raise notice 'ok: hand-offs from two devices are both kept';
end $$;
-- a record without an id (the app never writes one) is kept once, not doubled on every save
select pg_temp.save('{"units":{},"pushes":[{"at":"2026-08-03T11:00","pid":"p1","n":1}]}');
select pg_temp.save(pg_temp.saved()::text);
select pg_temp.save(pg_temp.saved()::text);
do $$ declare k int; begin
  select count(*) into k from jsonb_array_elements(pg_temp.saved()->'pushes') e where not (e ? 'id');
  if k <> 1 then raise exception 'records without an id: %', k; end if;
  raise notice 'ok: a record without an id is not doubled';
end $$;
-- at most 30, newest first
select pg_temp.save((select jsonb_build_object('units', '{}'::jsonb, 'pushes', jsonb_agg(jsonb_build_object('id', 'Q' || g, 'at', '2026-09-' || lpad(g::text, 2, '0') || 'T10:00') order by g desc))::text from generate_series(1, 30) g));
do $$ declare v jsonb; begin
  v := pg_temp.saved()->'pushes';
  if jsonb_array_length(v) <> 30 then raise exception 'kept % pushes', jsonb_array_length(v); end if;
  if v->0->>'id' <> 'PP2' or v->1->>'id' <> 'PP1' or v->2->>'id' <> 'Q30' or v->29->>'id' <> 'Q3' then raise exception 'order or cap: % % % %', v->0->>'id', v->1->>'id', v->2->>'id', v->29->>'id'; end if;
  raise notice 'ok: at most 30 push records, newest first';
end $$;
reset role;
-- a server write (no signed-in user) is stored as sent
select set_config('request.jwt.claims', '', true);
update public.blobs set data = '{"v":{"units":{},"pushes":[]}}' where org_id = '00000000-0000-4000-8000-00000000e001' and key = 'ratePlanner';
do $$ begin
  if pg_temp.saved() <> '{"units":{},"pushes":[]}'::jsonb then raise exception 'a server write was merged: %', pg_temp.saved(); end if;
  if (select data from public.blobs where key = 'priceLog' and org_id = '00000000-0000-4000-8000-00000000e001') <> '{"v":[1]}'::jsonb then raise exception 'priceLog changed'; end if;
  raise notice 'ok: a server write is stored as sent, other blobs untouched';
end $$;
-- reset_org as owner removes it
select pg_temp.as_user('00000000-0000-4000-8000-00000000f001');
select public.reset_org('00000000-0000-4000-8000-00000000e001');
do $$ begin if exists (select 1 from public.blobs where key = 'ratePlanner' and org_id = '00000000-0000-4000-8000-00000000e001') then raise exception 'reset_org kept ratePlanner'; end if; raise notice 'ok: reset_org clears it'; end $$;
rollback;
