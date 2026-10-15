-- Channex change detection (0006): outbox marks from the records triggers, channex_type_availability(), the rate
-- limiter and lease, the reset_org guard, and who can see or change what (RLS and grants).
--
-- Needs a throwaway database with tests/sql/supabase_stub.sql and migrations 0001-0007 applied, run as a superuser.
-- tests/sql/run.sh does all of it:  PGURL=postgres://postgres@127.0.0.1:5432/postgres tests/sql/run.sh
-- Every check prints "ok: ..."; the first failing check stops the script with "FAILED: ...".
\set ON_ERROR_STOP 1
\pset pager off
\o /dev/null

create schema if not exists t;
grant usage on schema t to public;
create or replace function t.ok(cond boolean, msg text) returns text language plpgsql as $$
begin
  if cond is not true then raise exception 'FAILED: %', msg; end if;
  raise notice 'ok: %', msg;
  return 'ok';
end $$;
grant execute on function t.ok(boolean, text) to public;
-- the marks for one target as text, oldest first: 'from..to,from..to'
create or replace function t.marks(p_kind text, p_target text) returns text language sql as $$
  select coalesce(string_agg(date_from || '..' || date_to, ',' order by id), '') from public.channex_outbox where kind = p_kind and target_id = p_target;
$$;
create or replace function t.avail(p_org uuid, p_type text, p_from date, p_to date) returns text language sql as $$
  select string_agg(to_char(a.date, 'MM-DD') || '=' || a.availability || '/' || a.raw, ' ' order by a.date) from public.channex_type_availability(p_org, p_type, p_from, p_to) a;
$$;
-- run sql as a role (and JWT subject); returns 'denied' on insufficient_privilege, 'rls' on an RLS check failure,
-- else the first column of the first row as text
create or replace function t.as_role(p_role text, p_sub uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v;
  exception
    when insufficient_privilege then v := case when sqlerrm like '%row-level security%' then 'rls' else 'denied' end;
    when others then
      if sqlerrm like '%row-level security%' then v := 'rls'; else v := 'error: ' || sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return coalesce(v, 'null');
end $$;

set orbique.channex_today = '2026-11-01';
set client_min_messages = notice;

-- ---------- fixtures ----------
-- org A (connected): owner u1, housekeeping u3. Org B (not connected): owner u2.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'owner-b@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'hk-a@example.test');
insert into public.orgs (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Org B');
insert into public.members (org_id, user_id, staff_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 's1', 'owner'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', 's3', 'housekeeping'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2', 's1', 'owner');

\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
\set U1 '''00000000-0000-0000-0000-0000000000a1'''
\set U2 '''00000000-0000-0000-0000-0000000000b2'''
\set U3 '''00000000-0000-0000-0000-0000000000a3'''
\set PROP '''11111111-1111-1111-1111-111111111111'''

-- building BD-1 with Twin (T-01..T-03) and Double (D-01, D-02), one untagged unit, a rate plan per type
insert into public.records (org_id, coll, id, data) values
  (:A, 'buildings', 'BD-1', '{"id":"BD-1","name":"Test Property","currency":"MYR"}'),
  (:A, 'unitTypes', 'UT-T', '{"id":"UT-T","buildingId":"BD-1","name":"Twin Room","maxGuests":2}'),
  (:A, 'unitTypes', 'UT-D', '{"id":"UT-D","buildingId":"BD-1","name":"Double Room","maxGuests":2}'),
  (:A, 'properties', 'T-01', '{"id":"T-01","name":"T-01","buildingId":"BD-1","unitTypeId":"UT-T","unitNo":"21-1"}'),
  (:A, 'properties', 'T-02', '{"id":"T-02","name":"T-02","buildingId":"BD-1","unitTypeId":"UT-T","unitNo":"21-2"}'),
  (:A, 'properties', 'T-03', '{"id":"T-03","name":"T-03","buildingId":"BD-1","unitTypeId":"UT-T","unitNo":"21-3"}'),
  (:A, 'properties', 'D-01', '{"id":"D-01","name":"D-01","buildingId":"BD-1","unitTypeId":"UT-D","unitNo":"22-1"}'),
  (:A, 'properties', 'D-02', '{"id":"D-02","name":"D-02","buildingId":"BD-1","unitTypeId":"UT-D","unitNo":"22-2"}'),
  (:A, 'properties', 'X-01', '{"id":"X-01","name":"Loose unit"}'),
  (:A, 'ratePlans', 'RP-T', '{"id":"RP-T","unitTypeId":"UT-T","name":"Best Available Rate","defaultRate":100,"minStay":1}'),
  (:A, 'ratePlans', 'RP-D', '{"id":"RP-D","unitTypeId":"UT-D","name":"Best Available Rate","defaultRate":120}');

-- not connected yet: writes leave no marks
insert into public.records (org_id, coll, id, data) values
  (:A, 'bookings', 'BK-0', '{"id":"BK-0","unitTypeId":"UT-T","propertyId":"T-02","checkIn":"2026-11-05","checkOut":"2026-11-06","status":"confirmed"}');
select t.ok((select count(*) from public.channex_outbox) = 0, 'no marks while the workspace has no connected building');

-- connect BD-1 (what api/channex.js will write)
insert into public.channex_groups (org_id, env, group_id) values (:A, 'staging', '22222222-2222-2222-2222-222222222222');
insert into public.channex_properties (org_id, env, building_id, channex_property_id, currency, status)
  values (:A, 'staging', 'BD-1', :PROP, 'MYR', 'live');
insert into public.channex_room_types (org_id, env, unit_type_id, channex_property_id, room_type_id, count_of_rooms) values
  (:A, 'staging', 'UT-T', :PROP, '33333333-3333-3333-3333-333333333331', 3),
  (:A, 'staging', 'UT-D', :PROP, '33333333-3333-3333-3333-333333333332', 2);
insert into public.channex_rate_plans (org_id, env, plan_id, unit_type_id, rate_plan_id) values
  (:A, 'staging', 'RP-T', 'UT-T', '44444444-4444-4444-4444-444444444441');

-- ---------- bookings ----------
insert into public.records (org_id, coll, id, data) values
  (:A, 'bookings', 'BK-1', '{"id":"BK-1","unitTypeId":"UT-T","propertyId":"T-01","checkIn":"2026-11-21","checkOut":"2026-11-23","status":"confirmed","guest":{"name":"A"}}');
select t.ok(t.marks('availability', 'UT-T') = '2026-11-21..2026-11-22', 'booking: Twin marked for its nights [checkIn, checkOut-1]');
select t.ok((select channex_property_id from public.channex_outbox limit 1) = :PROP and (select org_id from public.channex_outbox limit 1) = :A, 'mark carries the Channex property and org');

update public.records set data = data || '{"guest":{"name":"B"},"doorCode":"1234","status":"checked_in"}' where org_id = :A and coll = 'bookings' and id = 'BK-1';
select t.ok((select count(*) from public.channex_outbox) = 1, 'booking: guest name, door code and a live-to-live status change add no mark');

insert into public.records (org_id, coll, id, data) values
  (:A, 'bookings', 'BK-2', '{"id":"BK-2","unitTypeId":"UT-T","propertyId":null,"checkIn":"2026-11-21","checkOut":"2026-11-23","status":"pending"}');
select t.ok(t.marks('availability', 'UT-T') = '2026-11-21..2026-11-22', 'coalesced: a mark already covering the dates is not repeated');

insert into public.records (org_id, coll, id, data) values
  (:A, 'bookings', 'BK-3', '{"id":"BK-3","unitTypeId":"UT-T","checkIn":"2026-11-22","checkOut":"2026-11-24","status":"confirmed"}');
select t.ok(t.marks('availability', 'UT-T') = '2026-11-21..2026-11-22,2026-11-22..2026-11-23', 'a new range that is not covered gets its own mark');

-- the worker claims the pending marks; a change covered by a claimed mark must still be marked
update public.channex_outbox set claimed_at = now();
update public.records set data = data || '{"status":"cancelled"}' where org_id = :A and coll = 'bookings' and id = 'BK-3';
select t.ok(t.marks('availability', 'UT-T') = '2026-11-21..2026-11-22,2026-11-22..2026-11-23,2026-11-22..2026-11-23', 'cancelling marks again although a claimed mark covers it');
delete from public.channex_outbox;

-- moving a booking to another unit of another type marks both types, old and new dates
update public.records set data = data || '{"propertyId":"D-02","checkIn":"2026-11-24","checkOut":"2026-11-25"}' where org_id = :A and coll = 'bookings' and id = 'BK-1';
select t.ok(t.marks('availability', 'UT-T') = '2026-11-21..2026-11-22,2026-11-24..2026-11-24', 'move: the type sold is marked for old and new nights');
select t.ok(t.marks('availability', 'UT-D') = '2026-11-24..2026-11-24', 'move: the new unit''s type is marked for the new nights');
update public.records set data = data || '{"propertyId":"T-01","checkIn":"2026-11-21","checkOut":"2026-11-23"}' where org_id = :A and coll = 'bookings' and id = 'BK-1';
delete from public.channex_outbox;

-- clipping to [today, today + 499] (today pinned to 2026-11-01 in Malaysia)
insert into public.records (org_id, coll, id, data) values
  (:A, 'bookings', 'BK-P', '{"id":"BK-P","unitTypeId":"UT-T","checkIn":"2026-10-28","checkOut":"2026-11-03","status":"confirmed"}'),
  (:A, 'bookings', 'BK-F', '{"id":"BK-F","unitTypeId":"UT-D","checkIn":"2028-03-10","checkOut":"2028-03-20","status":"confirmed"}'),
  (:A, 'bookings', 'BK-E', '{"id":"BK-E","unitTypeId":"UT-D","checkIn":"2028-03-30","checkOut":"2028-04-20","status":"confirmed"}'),
  (:A, 'bookings', 'BK-X', '{"id":"BK-X","unitTypeId":"UT-T","checkIn":"2026-02-30","checkOut":"soon","status":"confirmed"}'),
  (:A, 'bookings', 'BK-Y', '[1,2,3]');
select t.ok(t.marks('availability', 'UT-T') = '2026-11-01..2026-11-02', 'clip: nights before today are dropped; bad dates and non-object data are ignored without an error');
select t.ok(t.marks('availability', 'UT-D') = '2028-03-10..2028-03-14', 'clip: nights after today + 499 (2028-03-14) are dropped; a stay fully beyond is not marked');
delete from public.records where org_id = :A and coll = 'bookings' and id in ('BK-P', 'BK-F', 'BK-E', 'BK-X', 'BK-Y');
delete from public.channex_outbox;

-- the app soft-deletes: deleted = true, data = {}
update public.records set deleted = true, data = '{}' where org_id = :A and coll = 'bookings' and id = 'BK-2';
select t.ok(t.marks('availability', 'UT-T') = '2026-11-21..2026-11-22', 'soft delete marks the old nights');
update public.records set deleted = false, data = '{"id":"BK-2","unitTypeId":"UT-T","propertyId":null,"checkIn":"2026-11-21","checkOut":"2026-11-23","status":"pending"}'
 where org_id = :A and coll = 'bookings' and id = 'BK-2';
delete from public.channex_outbox;

-- ---------- blocks ----------
insert into public.records (org_id, coll, id, data) values
  (:A, 'blocks', 'BL-1', '{"id":"BL-1","propertyId":"D-01","start":"2026-11-25","end":"2026-11-27","type":"maintenance"}');
select t.ok(t.marks('availability', 'UT-D') = '2026-11-25..2026-11-26', 'block: the unit''s type is marked for [start, end-1]');
select t.ok(t.marks('availability', 'UT-T') = '', 'block: other types untouched');
update public.records set data = data || '{"note":"new AC"}' where org_id = :A and coll = 'blocks' and id = 'BL-1';
select t.ok((select count(*) from public.channex_outbox) = 1, 'block: a note change adds no mark');
insert into public.records (org_id, coll, id, data) values
  (:A, 'blocks', 'BL-X', '{"id":"BL-X","propertyId":"X-01","start":"2026-11-25","end":"2026-11-27"}');
select t.ok((select count(*) from public.channex_outbox) = 1, 'block on an untagged unit adds no mark');
delete from public.channex_outbox;

-- ---------- channelRates ----------
insert into public.records (org_id, coll, id, data) values
  (:A, 'channelRates', 'CR-RP-T-2026-11', '{"planId":"RP-T","unitTypeId":"UT-T","month":"2026-11","days":{
     "2026-11-22":{"rate":333,"src":"manual"},"2026-11-23":{"rate":100,"src":"model"},"2026-11-24":{"rate":100,"src":"model"},
     "2026-11-26":{"rate":100,"src":"model","stopSell":true}}}');
select t.ok(t.marks('restrictions', 'RP-T') = '2026-11-22..2026-11-24,2026-11-26..2026-11-26', 'channelRates: new days marked as runs of consecutive dates');
update public.channex_outbox set claimed_at = now();
update public.records set data = jsonb_set(jsonb_set(data, '{days,2026-11-24}', '{"rate":150,"src":"manual","minStay":2}'), '{days,2026-11-30}', '{"rate":90,"src":"manual"}')
 where org_id = :A and coll = 'channelRates' and id = 'CR-RP-T-2026-11';
select t.ok(t.marks('restrictions', 'RP-T') = '2026-11-22..2026-11-24,2026-11-26..2026-11-26,2026-11-24..2026-11-24,2026-11-30..2026-11-30', 'channelRates edit: only the changed and the added day are marked');
update public.records set data = data || '{"month":"2026-11"}' where org_id = :A and coll = 'channelRates' and id = 'CR-RP-T-2026-11';
select t.ok((select count(*) from public.channex_outbox) = 4, 'channelRates: a write with the same days adds nothing');
delete from public.channex_outbox;
update public.records set data = data #- '{days,2026-11-22}' where org_id = :A and coll = 'channelRates' and id = 'CR-RP-T-2026-11';
select t.ok(t.marks('restrictions', 'RP-T') = '2026-11-22..2026-11-22', 'channelRates: a removed day is marked');
delete from public.channex_outbox;

-- ---------- retag ----------
update public.records set data = data || '{"unitTypeId":"UT-D"}' where org_id = :A and coll = 'properties' and id = 'T-03';
select t.ok(t.marks('availability', 'UT-T') = '2026-11-01..2028-03-14', 'retag: the old type is marked for 500 days');
select t.ok(t.marks('availability', 'UT-D') = '2026-11-01..2028-03-14', 'retag: the new type is marked for 500 days');
select t.ok((select string_agg(ref, ',' order by ref) from public.channex_setup_queue where kind = 'room_count') = 'UT-D,UT-T', 'retag: count_of_rooms update queued for both types');
update public.records set data = data || '{"name":"T-03 renamed","photos":["x"]}' where org_id = :A and coll = 'properties' and id = 'T-03';
select t.ok((select count(*) from public.channex_outbox) = 2 and (select count(*) from public.channex_setup_queue) = 2, 'unit: other changes are ignored');
delete from public.channex_outbox; delete from public.channex_setup_queue;
update public.records set data = data || '{"archived":true}' where org_id = :A and coll = 'properties' and id = 'D-02';
select t.ok(t.marks('availability', 'UT-D') = '2026-11-01..2028-03-14' and (select count(*) from public.channex_setup_queue where kind = 'room_count' and ref = 'UT-D') = 1, 'archiving a unit marks its type and queues the room count');
update public.records set data = data - 'archived' where org_id = :A and coll = 'properties' and id = 'D-02';
delete from public.channex_outbox; delete from public.channex_setup_queue;

-- ---------- setup changes ----------
insert into public.records (org_id, coll, id, data) values (:A, 'unitTypes', 'UT-N', '{"id":"UT-N","buildingId":"BD-1","name":"Studio"}');
select t.ok((select count(*) from public.channex_setup_queue where kind = 'unit_type_create' and ref = 'UT-N') = 1, 'new unit type in a connected building queues a create');
update public.records set data = data || '{"name":"Twin Deluxe"}' where org_id = :A and coll = 'unitTypes' and id = 'UT-T';
update public.records set data = data || '{"name":"Twin Deluxe!"}' where org_id = :A and coll = 'unitTypes' and id = 'UT-T';
select t.ok((select count(*) from public.channex_setup_queue where kind = 'unit_type_update' and ref = 'UT-T') = 1, 'unit type rename queues one update (coalesced)');
update public.records set data = data || '{"defaultRate":110}' where org_id = :A and coll = 'ratePlans' and id = 'RP-T';
select t.ok(t.marks('restrictions', 'RP-T') = '2026-11-01..2028-03-14' and (select count(*) from public.channex_setup_queue where kind = 'rate_plan_update' and ref = 'RP-T') = 1, 'rate plan default rate: restrictions marked for 500 days and an update queued');
update public.records set data = data || '{"name":"Test Property - Orbique"}' where org_id = :A and coll = 'buildings' and id = 'BD-1';
select t.ok((select count(*) from public.channex_setup_queue where kind = 'building_update' and ref = 'BD-1') = 1, 'building edit queues an update');
insert into public.records (org_id, coll, id, data) values (:A, 'buildings', 'BD-2', '{"id":"BD-2","name":"Other"}');
update public.records set data = data || '{"name":"Other 2"}' where org_id = :A and coll = 'buildings' and id = 'BD-2';
insert into public.records (org_id, coll, id, data) values (:A, 'unitTypes', 'UT-Z', '{"id":"UT-Z","buildingId":"BD-2","name":"Loft"}');
select t.ok((select count(*) from public.channex_setup_queue where ref in ('BD-2', 'UT-Z')) = 0, 'a building that is not connected queues nothing');
delete from public.channex_outbox; delete from public.channex_setup_queue;

-- ---------- availability (plan 2.2) ----------
-- now: Twin = T-01, T-02 (T-03 moved to Double). BK-0 on T-02 (11-05), BK-1 on T-01 (21-22), BK-2 unassigned Twin (21-22),
-- BK-3 cancelled. Double = D-01, D-02, T-03; BL-1 blocks D-01 on 25-26.
select t.ok(t.avail(:A, 'UT-T', '2026-11-20', '2026-11-23') = '11-20=2/2 11-21=0/0 11-22=0/0 11-23=2/2', 'Twin: an assigned and an unassigned booking take both units');
insert into public.records (org_id, coll, id, data) values
  (:A, 'bookings', 'BK-4', '{"id":"BK-4","unitTypeId":"UT-T","checkIn":"2026-11-22","checkOut":"2026-11-23","status":"confirmed"}'),
  (:A, 'bookings', 'BK-5', '{"id":"BK-5","unitTypeId":"UT-T","checkIn":"2026-11-20","checkOut":"2026-11-21","status":"deleted"}'),
  (:A, 'bookings', 'BK-6', '{"id":"BK-6","unitTypeId":"UT-D","propertyId":"T-01","checkIn":"2026-11-23","checkOut":"2026-11-24","status":"confirmed"}');
update public.records set deleted = true, data = '{}' where org_id = :A and coll = 'bookings' and id = 'BK-0';
select t.ok(t.avail(:A, 'UT-T', '2026-11-04', '2026-11-05') = '11-04=2/2 11-05=2/2', 'a soft-deleted booking frees its unit');
select t.ok(t.avail(:A, 'UT-T', '2026-11-20', '2026-11-23') = '11-20=2/2 11-21=0/0 11-22=0/-1 11-23=1/1',
  'Twin: oversold night clamps to 0 with raw -1; status deleted ignored; an upgrade on a Twin unit counts against Twin');
select t.ok(t.avail(:A, 'UT-D', '2026-11-23', '2026-11-27') = '11-23=3/3 11-24=3/3 11-25=2/2 11-26=2/2 11-27=3/3', 'Double: retagged unit counts; block lowers by 1; the upgrade sold as Double but sitting on a Twin unit does not');
update public.records set data = data || '{"archived":true}' where org_id = :A and coll = 'properties' and id = 'D-02';
select t.ok(t.avail(:A, 'UT-D', '2026-11-25', '2026-11-25') = '11-25=1/1', 'archived unit is not counted');
update public.records set data = data - 'archived' where org_id = :A and coll = 'properties' and id = 'D-02';
select t.ok(t.avail(:B, 'UT-T', '2026-11-21', '2026-11-21') = '11-21=0/0', 'another workspace sees none of these units');
delete from public.channex_outbox; delete from public.channex_setup_queue;

-- ---------- other workspaces and statuses ----------
insert into public.records (org_id, coll, id, data) values
  (:B, 'unitTypes', 'UT-T', '{"id":"UT-T","buildingId":"BD-1","name":"Twin"}'),
  (:B, 'bookings', 'BK-1', '{"id":"BK-1","unitTypeId":"UT-T","checkIn":"2026-11-21","checkOut":"2026-11-23","status":"confirmed"}');
select t.ok((select count(*) from public.channex_outbox) = 0, 'a workspace without a connection gets no marks (same ids as a connected one)');
update public.channex_properties set status = 'paused' where org_id = :A;
update public.records set data = data || '{"checkOut":"2026-11-24"}' where org_id = :A and coll = 'bookings' and id = 'BK-1';
select t.ok(t.marks('availability', 'UT-T') = '2026-11-21..2026-11-22,2026-11-21..2026-11-23', 'paused: marks keep building up');
delete from public.channex_outbox;
update public.channex_properties set status = 'disconnected' where org_id = :A;
update public.records set data = data || '{"checkOut":"2026-11-23"}' where org_id = :A and coll = 'bookings' and id = 'BK-1';
select t.ok((select count(*) from public.channex_outbox) = 0, 'disconnected: no marks');
update public.channex_properties set status = 'live' where org_id = :A;
select set_config('orbique.channex_env', 'production', false);
update public.records set data = data || '{"checkOut":"2026-11-24"}' where org_id = :A and coll = 'bookings' and id = 'BK-1';
select t.ok((select count(*) from public.channex_outbox) = 0, 'env: a production run does not mark staging properties');
select set_config('orbique.channex_env', '', false);
update public.records set data = data || '{"checkOut":"2026-11-23"}' where org_id = :A and coll = 'bookings' and id = 'BK-1';
select t.ok(t.marks('availability', 'UT-T') = '2026-11-21..2026-11-23', 'env unset: the newest connected row is used');

-- ---------- writes by a signed-in member go through the trigger too ----------
delete from public.channex_outbox;
select t.ok(t.as_role('authenticated', :U1, $q$insert into public.records (org_id, coll, id, data) values ('aaaaaaaa-0000-0000-0000-000000000001', 'blocks', 'BL-2', '{"propertyId":"T-02","start":"2026-12-01","end":"2026-12-03"}') returning id$q$) = 'BL-2', 'member inserts a block through RLS');
select t.ok(t.marks('availability', 'UT-T') = '2026-12-01..2026-12-02', 'the member''s write is marked (trigger runs as its owner)');

-- ---------- RLS and grants ----------
insert into public.channex_alerts (org_id, kind, message) values (:A, 'needs_unit', 'BK-2 has no unit'), (:B, 'sync_error', 'other org');
insert into public.channex_calls (org_id, channex_property_id, endpoint, method, source, http_status) values (:A, :PROP, '/availability', 'POST', 'delta', 200);
insert into public.channex_state (org_id, channex_property_id, kind, target_id, date, value) values (:A, :PROP, 'availability', 'UT-T', '2026-11-21', '0');
insert into public.channex_events (body_sha256, event) values ('abc', 'booking');
insert into public.channex_setup_queue (org_id, kind, ref) values (:A, 'room_count', 'UT-T');

select t.ok(t.as_role('anon', null, 'select count(*) from public.' || x) = 'denied', 'anon cannot read ' || x)
  from unnest(array['channex_groups', 'channex_properties', 'channex_room_types', 'channex_rate_plans', 'channex_outbox', 'channex_setup_queue',
                    'channex_state', 'channex_calls', 'channex_events', 'channex_revisions', 'channex_bookings', 'channex_alerts', 'channex_meta']) x;
select t.ok(t.as_role('authenticated', :U2, 'select count(*) from public.' || x) = '0', 'a non-member sees no rows of ' || x)
  from unnest(array['channex_groups', 'channex_properties', 'channex_room_types', 'channex_rate_plans', 'channex_outbox', 'channex_state', 'channex_calls']) x;
select t.ok(t.as_role('authenticated', :U2, 'select string_agg(message, '','') from public.channex_alerts') = 'other org', 'a member of B sees only B''s alerts');
select t.ok(t.as_role('authenticated', :U1, 'select count(*) from public.' || x) = '1', 'a member reads their org''s ' || x)
  from unnest(array['channex_groups', 'channex_properties', 'channex_rate_plans', 'channex_outbox', 'channex_state', 'channex_calls', 'channex_alerts']) x;
select t.ok(t.as_role('authenticated', :U1, 'select count(*) from public.' || x) = 'denied', 'a member cannot read ' || x)
  from unnest(array['channex_setup_queue', 'channex_events', 'channex_revisions', 'channex_bookings', 'channex_meta']) x;
select t.ok(t.as_role('authenticated', :U1, $q$update public.channex_alerts set message = 'changed' returning id$q$) = 'denied', 'a member cannot change an alert''s message');
select t.ok(t.as_role('authenticated', :U1, $q$update public.channex_properties set status = 'live' returning 1$q$) = 'denied', 'a member cannot change a connection');
select t.ok(t.as_role('authenticated', :U1, $q$insert into public.channex_outbox (org_id, channex_property_id, kind, target_id, date_from, date_to) values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'availability', 'UT-T', '2026-11-01', '2026-11-02') returning 1$q$) = 'denied', 'a member cannot write marks');
select t.ok(t.as_role('authenticated', :U1, $q$delete from public.channex_alerts returning 1$q$) = 'denied', 'a member cannot delete alerts');
select t.ok(t.as_role('authenticated', :U2, $q$update public.channex_alerts set resolved_at = now(), resolved_by = '00000000-0000-0000-0000-0000000000b2' where org_id = 'aaaaaaaa-0000-0000-0000-000000000001' returning 1$q$) = 'null', 'a non-member cannot resolve another org''s alert');
select t.ok(t.as_role('authenticated', :U1, $q$update public.channex_alerts set resolved_at = now(), resolved_by = '00000000-0000-0000-0000-0000000000b2' returning 1$q$) = 'rls', 'resolved_by must be the member resolving it');
select t.ok(t.as_role('authenticated', :U1, $q$update public.channex_alerts set resolved_at = now(), resolved_by = '00000000-0000-0000-0000-0000000000a1' returning org_id::text$q$) = 'aaaaaaaa-0000-0000-0000-000000000001', 'a member resolves their alert (resolved_* only)');
select t.ok((select count(*) from public.channex_alerts where resolved_at is not null) = 1, 'exactly one alert resolved');
update public.orgs set status = 'paused' where id = :A;
select t.ok(t.as_role('authenticated', :U1, $q$update public.channex_alerts set resolved_at = null, resolved_by = null returning 1$q$) = 'null', 'a paused workspace cannot resolve alerts (can_write)');
update public.orgs set status = 'active' where id = :A;

-- functions: workers only
select t.ok(t.as_role(r, :U1, f) = 'denied', r || ' cannot run ' || left(f, 40))
  from unnest(array['anon', 'authenticated']) r,
       unnest(array[$q$select count(*) from public.channex_type_availability('aaaaaaaa-0000-0000-0000-000000000001', 'UT-T', '2026-11-01', '2026-11-02')$q$,
                    $q$select public.channex_take_slot('11111111-1111-1111-1111-111111111111', '/availability')$q$,
                    $q$select public.channex_claim('11111111-1111-1111-1111-111111111111', 30)$q$,
                    $q$select public.channex__live_property('aaaaaaaa-0000-0000-0000-000000000001', 'BD-1')$q$,
                    $q$select public.channex__mark('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'availability', 'x', '2026-11-01', '2026-11-01', null)$q$,
                    $q$select public.channex_set_worker('https://example.test/api/channex-worker', 'xxxxxxxxxxxxxxxxxxxx')$q$,
                    $q$select public.channex_tick('tick')$q$]) f;
select t.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'channex%' and (p.proconfig is null or not ('search_path=""' = any(p.proconfig)))) = 0,
            'every channex function has search_path=''''');
select t.ok((select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'channex%' and p.prosecdef) = 'channex__on_record,channex_set_worker,channex_tick',
            'security definer only for the trigger and the Vault functions');

select t.ok((select string_agg(tablename, ',' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'channex%')
            = 'channex_alerts,channex_outbox,channex_properties', 'realtime publishes connection status, alerts and the outbox');

-- service role (the worker)
select t.ok(t.as_role('service_role', null, $q$select string_agg(date::text || '=' || availability, ' ') from public.channex_type_availability('aaaaaaaa-0000-0000-0000-000000000001', 'UT-T', '2026-11-21', '2026-11-22')$q$) = '2026-11-21=0 2026-11-22=0', 'service role computes availability');
delete from public.channex_calls;
select t.ok(t.as_role('service_role', null, $q$select count(public.channex_take_slot('11111111-1111-1111-1111-111111111111', '/availability')) from generate_series(1, 9)$q$) = '9', 'nine availability slots a minute');
select t.ok(t.as_role('service_role', null, $q$select public.channex_take_slot('11111111-1111-1111-1111-111111111111', '/availability')$q$) = 'null', 'the tenth is refused');
select t.ok(t.as_role('service_role', null, $q$select public.channex_take_slot('11111111-1111-1111-1111-111111111111', '/restrictions') is not null$q$) = 'true', 'restrictions have their own per-property budget');
insert into public.channex_calls (channex_property_id, endpoint, at) select gen_random_uuid(), '/restrictions', now() from generate_series(1, 9);
select t.ok(t.as_role('service_role', null, $q$select public.channex_take_slot('99999999-9999-9999-9999-999999999999', '/availability')$q$) = 'null', 'account-wide: 19 ARI calls a minute');
select t.ok(t.as_role('service_role', null, $q$select public.channex_take_slot('99999999-9999-9999-9999-999999999999', '/room_types') is not null$q$) = 'true', 'non-ARI endpoints are not held by the ARI cap');
update public.channex_calls set at = now() - interval '61 seconds';
select t.ok(t.as_role('service_role', null, $q$select public.channex_take_slot('11111111-1111-1111-1111-111111111111', '/availability') is not null$q$) = 'true', 'slots free up after a minute');
select t.ok((select org_id from public.channex_calls order by id desc limit 1) = :A, 'the reservation row carries the org');
select t.ok(t.as_role('service_role', null, $q$select public.channex_claim('11111111-1111-1111-1111-111111111111', 30)$q$) = 'true', 'claim: first run gets the lease');
select t.ok(t.as_role('service_role', null, $q$select public.channex_claim('11111111-1111-1111-1111-111111111111', 30)$q$) = 'false', 'claim: a second run does not');
select t.ok(t.as_role('service_role', null, $q$select public.channex_claim('11111111-1111-1111-1111-111111111111', 0)$q$) = 'true', 'claim: release');
select t.ok(t.as_role('service_role', null, $q$select public.channex_claim('11111111-1111-1111-1111-111111111111', 30)$q$) = 'true', 'claim: free again after release');
select t.ok(t.as_role('service_role', null, $q$select public.channex_tick('tick')$q$) = 'null', 'tick does nothing without pg_net / Vault / a stored worker');

-- ---------- reset_org guard ----------
select t.ok(t.as_role('authenticated', :U1, $q$select public.reset_org('aaaaaaaa-0000-0000-0000-000000000001')::text$q$) like 'error: Disconnect channels in Channels first%', 'reset_org refuses while connected');
select t.ok((select count(*) from public.records where org_id = :A) > 0, 'nothing was deleted');
select t.ok(t.as_role('authenticated', :U3, $q$select public.reset_org('aaaaaaaa-0000-0000-0000-000000000001')::text$q$) = 'denied', 'reset_org: a non-owner is still refused');
update public.channex_properties set status = 'disconnected' where org_id = :A;
select t.ok(t.as_role('authenticated', :U1, $q$select public.reset_org('aaaaaaaa-0000-0000-0000-000000000001')::text$q$) = '', 'reset_org works once disconnected');
select t.ok((select count(*) from public.records where org_id = :A) = 0, 'workspace records cleared');

\echo channex_triggers.sql: all checks passed
