-- Guest app and unit types (supabase/migrations/0008_guest_units.sql): the unit number and the door code show from
-- 30 minutes before check-in, the guest sees the building + type name, never the unit's own name.
-- Runs in one transaction and rolls back, so it leaves nothing behind. Any failed check raises an error.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/guest_units.sql
--   (local Supabase: postgresql://postgres:postgres@127.0.0.1:54322/postgres; plain Postgres: load tests/sql/supabase_stub.sql
--    and supabase/migrations/*.sql first)
begin;

insert into public.orgs (id, name) values ('00000000-0000-4000-8000-0000000000a8', 'Guest units test');
insert into public.records (org_id, coll, id, data) values
  ('00000000-0000-4000-8000-0000000000a8', 'buildings', 'BD-t', '{"id":"BD-t","name":"Seri Saujana Residences","address":"2 Jalan Saujana Indah, 57000 Kuala Lumpur","city":"Kuala Lumpur","checkInTime":"15:00","checkOutTime":"11:00"}'),
  ('00000000-0000-4000-8000-0000000000a8', 'unitTypes', 'UT-t', '{"id":"UT-t","buildingId":"BD-t","name":"Deluxe","beds":2}'),
  ('00000000-0000-4000-8000-0000000000a8', 'properties', 'P-t', '{"id":"P-t","name":"Saujana 21-1","unitNo":"21-1","buildingId":"BD-t","unitTypeId":"UT-t","area":"Bukit Jalil, Kuala Lumpur","address":"Unit 21-1, 2 Jalan Saujana Indah","type":"2BR apartment","beds":2,"wifi":["Saujana21-1","pw-2026"],"lockBrand":"Yale","parking":"P2-21"}'),
  ('00000000-0000-4000-8000-0000000000a8', 'properties', 'P-u', '{"id":"P-u","name":"Bayfront Loft 3B","area":"Gurney Drive, Penang","address":"3B Bayfront","wifi":["Bayfront3B","sun"],"lockBrand":"Yale"}'),
  -- typed booking without its own check-in time: falls back to the building's 15:00
  ('00000000-0000-4000-8000-0000000000a8', 'bookings', 'B-t', '{"id":"B-t","propertyId":"P-t","unitTypeId":"UT-t","checkIn":"2026-11-02","checkOut":"2026-11-04","status":"confirmed","guestToken":"gUnitTest0001","doorCode":"4821","codeStatus":"scheduled","idVerified":true,"rulesAccepted":{"at":"2026-11-01T09:00","name":"Test Guest"},"guest":{"name":"Test Guest"},"guests":2,"nights":2}'),
  -- typed booking with no unit yet
  ('00000000-0000-4000-8000-0000000000a8', 'bookings', 'B-n', '{"id":"B-n","propertyId":null,"unitTypeId":"UT-t","needsUnit":true,"checkIn":"2026-11-02","checkOut":"2026-11-03","checkInTime":"15:00","status":"confirmed","guestToken":"gUnitTest0002","doorCode":"7710","idVerified":true,"rulesAccepted":{"at":"2026-11-01T09:00","name":"N"},"guest":{"name":"N"}}'),
  -- untyped unit: same payload as before, door code from 30 minutes before its 16:00 check-in
  ('00000000-0000-4000-8000-0000000000a8', 'bookings', 'B-u', '{"id":"B-u","propertyId":"P-u","checkIn":"2026-11-02","checkOut":"2026-11-05","checkInTime":"16:00","status":"confirmed","guestToken":"gUnitTest0003","doorCode":"5150","idVerified":true,"rulesAccepted":{"at":"2026-11-01T09:00","name":"U"},"guest":{"name":"U"}}');

create temporary table t_guest_units_ok (n int);

do $$
declare j jsonb; pr jsonb;
begin
  -- the day before: upcoming, type name only
  perform set_config('orbique.guest_now', '2026-11-01T20:00', true);
  j := public.guest_get('gUnitTest0001'); pr := j->'property';
  if j->>'ok' <> 'true' or j->>'state' <> 'upcoming' then raise exception 'B-t day before: %', j; end if;
  if pr->>'name' <> 'Seri Saujana Residences · Deluxe' then raise exception 'typed name is %', pr->>'name'; end if;
  if pr->>'address' <> '2 Jalan Saujana Indah, 57000 Kuala Lumpur' then raise exception 'typed address is %', pr->>'address'; end if;
  if pr->>'unitType' <> 'Deluxe' or pr->'unitNo' <> 'null'::jsonb or pr->>'unitAt' <> '2026-11-02T14:30' then raise exception 'unit fields: %', pr; end if;
  if j::text like '%21-1%' then raise exception 'the unit number leaked the day before: %', j; end if;

  -- T-31 minutes (14:29 for a 15:00 check-in): no unit number, no door code, no Wi-Fi
  perform set_config('orbique.guest_now', '2026-11-02T14:29', true);
  j := public.guest_get('gUnitTest0001'); pr := j->'property';
  if j->>'state' <> 'arrival' then raise exception 'B-t state at T-31: %', j->>'state'; end if;
  if pr->'unitNo' <> 'null'::jsonb then raise exception 'unitNo at T-31 min is %', pr->'unitNo'; end if;
  if pr->'wifi' <> 'null'::jsonb then raise exception 'wifi at T-31 min is %', pr->'wifi'; end if;
  if (j->'door'->>'visible')::boolean or j->'door'->'code' <> 'null'::jsonb then raise exception 'door code at T-31 min: %', j->'door'; end if;
  if j->'door'->>'from' <> '2026-11-02T14:30' then raise exception 'door from is %', j->'door'->>'from'; end if;
  if not (j->'door'->'waitingFor' ? 'time') then raise exception 'door not waiting for time at T-31: %', j->'door'; end if;
  if j::text like '%21-1%' then raise exception 'the unit number leaked at T-31 min: %', j; end if;

  -- T-30 minutes: the unit number, the door code and the Wi-Fi appear together
  perform set_config('orbique.guest_now', '2026-11-02T14:30', true);
  j := public.guest_get('gUnitTest0001'); pr := j->'property';
  if pr->>'unitNo' is distinct from '21-1' then raise exception 'unitNo at T-30 min is %', pr->'unitNo'; end if;
  if pr->'wifi'->>'name' is distinct from 'Saujana21-1' then raise exception 'wifi at T-30 min is %', pr->'wifi'; end if;
  if not (j->'door'->>'visible')::boolean or j->'door'->>'code' <> '4821' then raise exception 'door code at T-30 min: %', j->'door'; end if;
  if j::text like '%Saujana 21-1%' then raise exception 'the unit''s own name leaked: %', j; end if;

  -- after check-out the stay is past: no unit number
  perform set_config('orbique.guest_now', '2026-11-04T12:00', true);
  j := public.guest_get('gUnitTest0001');
  if j->>'state' <> 'past' or j->'property'->'unitNo' <> 'null'::jsonb then raise exception 'B-t after check-out: %', j->'property'; end if;

  -- a typed booking without a unit: type name, no unit number even after the reveal time
  perform set_config('orbique.guest_now', '2026-11-02T14:45', true);
  j := public.guest_get('gUnitTest0002'); pr := j->'property';
  if pr->>'name' <> 'Seri Saujana Residences · Deluxe' or pr->'unitNo' <> 'null'::jsonb or pr->>'unitType' <> 'Deluxe' then raise exception 'B-n: %', pr; end if;

  -- untyped unit: no unit fields, own name, door code from 15:30 for a 16:00 check-in
  perform set_config('orbique.guest_now', '2026-11-02T15:29', true);
  j := public.guest_get('gUnitTest0003'); pr := j->'property';
  if pr->>'name' <> 'Bayfront Loft 3B' or pr->>'address' <> '3B Bayfront' or pr ? 'unitNo' or pr ? 'unitType' then raise exception 'B-u property: %', pr; end if;
  if pr->'wifi'->>'name' is distinct from 'Bayfront3B' then raise exception 'B-u wifi on arrival day: %', pr->'wifi'; end if;
  if j->'door'->'code' <> 'null'::jsonb or j->'door'->>'from' <> '2026-11-02T15:30' then raise exception 'B-u door at 15:29: %', j->'door'; end if;
  perform set_config('orbique.guest_now', '2026-11-02T15:30', true);
  j := public.guest_get('gUnitTest0003');
  if j->'door'->>'code' is distinct from '5150' then raise exception 'B-u door at 15:30: %', j->'door'; end if;

  -- guest_act uses the same rule: code help only once the code shows
  perform set_config('orbique.guest_now', '2026-11-02T15:29', true);
  j := public.guest_act('gUnitTest0003', 'codehelp', '{}'::jsonb);
  if j->>'error' is distinct from 'not_now' then raise exception 'codehelp before the code shows: %', j; end if;

  insert into t_guest_units_ok values (1);
  raise notice 'guest_units: all checks passed';
end $$;

select count(*) as guest_units_checks_passed from t_guest_units_ok;
rollback;
