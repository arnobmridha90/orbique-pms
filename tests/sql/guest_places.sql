-- Nearby places in the guest app (supabase/migrations/0021_guest_places.sql): guest_get returns the places of the stay's
-- own building only (never another building's or another workspace's), with public fields only, in staff order.
-- Runs in one transaction and rolls back, so it leaves nothing behind. Any failed check raises an error.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/guest_places.sql
begin;

insert into public.orgs (id, name) values
  ('00000000-0000-4000-8000-0000000000c1', 'Guest places test'),
  ('00000000-0000-4000-8000-0000000000c2', 'Guest places test 2');
insert into public.records (org_id, coll, id, data) values
  -- workspace 1: two buildings, a unit in each, a unit outside buildings, and a unit with a building but no type
  ('00000000-0000-4000-8000-0000000000c1', 'buildings', 'BD-a', '{"id":"BD-a","name":"Alpha Residences","address":"1 Jalan Alpha","lat":3.0561,"lng":101.6887,"checkInTime":"15:00"}'),
  ('00000000-0000-4000-8000-0000000000c1', 'buildings', 'BD-b', '{"id":"BD-b","name":"Beta Tower","address":"2 Jalan Beta","lat":"x","lng":101.7}'),
  ('00000000-0000-4000-8000-0000000000c1', 'unitTypes', 'UT-a', '{"id":"UT-a","buildingId":"BD-a","name":"Deluxe"}'),
  ('00000000-0000-4000-8000-0000000000c1', 'unitTypes', 'UT-b', '{"id":"UT-b","buildingId":"BD-b","name":"Studio"}'),
  ('00000000-0000-4000-8000-0000000000c1', 'properties', 'P-a', '{"id":"P-a","name":"Alpha 3-1","unitNo":"3-1","buildingId":"BD-a","unitTypeId":"UT-a"}'),
  ('00000000-0000-4000-8000-0000000000c1', 'properties', 'P-b', '{"id":"P-b","name":"Beta 9-9","unitNo":"9-9","buildingId":"BD-b","unitTypeId":"UT-b"}'),
  ('00000000-0000-4000-8000-0000000000c1', 'properties', 'P-v', '{"id":"P-v","name":"Garden Villa","address":"1 Garden Lane"}'),
  ('00000000-0000-4000-8000-0000000000c1', 'properties', 'P-w', '{"id":"P-w","name":"Alpha loose unit","buildingId":"BD-a"}'),
  ('00000000-0000-4000-8000-0000000000c1', 'places', 'PL-2', '{"id":"PL-2","buildingId":"BD-a","name":"Kopi Alpha","category":"cafe","note":"Kaya toast","lat":3.0552,"lng":101.6905,"order":2,"hours":"8 AM to 6 PM","phone":"+60 3 0000 0000","createdBy":"s1","updatedBy":"s1","osmId":"node/1","staffOnly":"do not show"}'),
  ('00000000-0000-4000-8000-0000000000c1', 'places', 'PL-1', '{"id":"PL-1","buildingId":"BD-a","name":"Alpha Clinic","category":"clinic","lat":3.0546,"lng":101.6874,"order":1,"route":{"coords":[[101.6887,3.0561],[101.6874,3.0561],[101.6874,3.0546]],"meters":310,"minutes":4,"mode":"foot","extra":1}}'),
  ('00000000-0000-4000-8000-0000000000c1', 'places', 'PL-3', '{"id":"PL-3","buildingId":"BD-a","name":"Odd type","category":"spaceport","lat":"3.06","lng":"101.69","order":2}'),
  ('00000000-0000-4000-8000-0000000000c1', 'places', 'PL-4', '{"id":"PL-4","buildingId":"BD-a","name":"Archived","category":"food","lat":3.06,"lng":101.69,"archived":true}'),
  ('00000000-0000-4000-8000-0000000000c1', 'places', 'PL-5', '{"id":"PL-5","buildingId":"BD-a","name":"No position","category":"food"}'),
  ('00000000-0000-4000-8000-0000000000c1', 'places', 'PL-6', '{"id":"PL-6","buildingId":"BD-a","name":"Zero","category":"food","lat":0,"lng":0}'),
  ('00000000-0000-4000-8000-0000000000c1', 'places', 'PL-7', '{"id":"PL-7","buildingId":"BD-a","name":"Bad route","category":"food","lat":3.06,"lng":101.69,"order":3,"route":{"coords":"x"}}'),
  -- route points pass to guests only as [lng, lat] number pairs inside the world; one good point is no line
  ('00000000-0000-4000-8000-0000000000c1', 'places', 'PL-10', '{"id":"PL-10","buildingId":"BD-a","name":"Mixed route","category":"food","lat":3.06,"lng":101.69,"order":4,"route":{"coords":[[101.6887,3.0561],null,["a",1],[500,3],[1,2,3],{"x":1},[101.69,3.06]],"meters":500}}'),
  ('00000000-0000-4000-8000-0000000000c1', 'places', 'PL-11', '{"id":"PL-11","buildingId":"BD-a","name":"One point","category":"food","lat":3.06,"lng":101.69,"order":5,"route":{"coords":[[101.6887,3.0561],[null,null],["101.69","3.06"]]}}'),
  ('00000000-0000-4000-8000-0000000000c1', 'places', 'PL-b', '{"id":"PL-b","buildingId":"BD-b","name":"Beta Money Changer","category":"money","lat":3.1,"lng":101.7}'),
  ('00000000-0000-4000-8000-0000000000c1', 'bookings', 'B-a', '{"id":"B-a","propertyId":"P-a","unitTypeId":"UT-a","checkIn":"2026-11-02","checkOut":"2026-11-04","status":"confirmed","guestToken":"gPlaceTest0001","doorCode":"1111","guest":{"name":"A"}}'),
  ('00000000-0000-4000-8000-0000000000c1', 'bookings', 'B-n', '{"id":"B-n","propertyId":null,"unitTypeId":"UT-a","needsUnit":true,"checkIn":"2026-11-02","checkOut":"2026-11-04","status":"confirmed","guestToken":"gPlaceTest0002","guest":{"name":"N"}}'),
  ('00000000-0000-4000-8000-0000000000c1', 'bookings', 'B-b', '{"id":"B-b","propertyId":"P-b","unitTypeId":"UT-b","checkIn":"2026-11-02","checkOut":"2026-11-04","status":"confirmed","guestToken":"gPlaceTest0003","guest":{"name":"B"}}'),
  ('00000000-0000-4000-8000-0000000000c1', 'bookings', 'B-v', '{"id":"B-v","propertyId":"P-v","checkIn":"2026-11-02","checkOut":"2026-11-04","status":"confirmed","guestToken":"gPlaceTest0004","guest":{"name":"V"}}'),
  ('00000000-0000-4000-8000-0000000000c1', 'bookings', 'B-w', '{"id":"B-w","propertyId":"P-w","checkIn":"2026-11-02","checkOut":"2026-11-04","status":"confirmed","guestToken":"gPlaceTest0005","guest":{"name":"W"}}'),
  -- workspace 2 uses the same building and place ids: none of it may reach workspace 1's guests (or the other way round)
  ('00000000-0000-4000-8000-0000000000c2', 'buildings', 'BD-a', '{"id":"BD-a","name":"Other Org Building","address":"9 Jalan Lain","lat":1.3,"lng":103.8}'),
  ('00000000-0000-4000-8000-0000000000c2', 'unitTypes', 'UT-a', '{"id":"UT-a","buildingId":"BD-a","name":"Other"}'),
  ('00000000-0000-4000-8000-0000000000c2', 'properties', 'P-a', '{"id":"P-a","name":"Other 1","buildingId":"BD-a","unitTypeId":"UT-a"}'),
  ('00000000-0000-4000-8000-0000000000c2', 'places', 'PL-1', '{"id":"PL-1","buildingId":"BD-a","name":"Other Org Secret Cafe","category":"cafe","lat":1.3,"lng":103.8}'),
  ('00000000-0000-4000-8000-0000000000c2', 'places', 'PL-9', '{"id":"PL-9","buildingId":"BD-a","name":"Other Org Hawker","category":"streetfood","lat":1.31,"lng":103.81}'),
  ('00000000-0000-4000-8000-0000000000c2', 'bookings', 'B-a', '{"id":"B-a","propertyId":"P-a","unitTypeId":"UT-a","checkIn":"2026-11-02","checkOut":"2026-11-04","status":"confirmed","guestToken":"gPlaceTest0009","guest":{"name":"Z"}}');
-- a deleted place is gone for guests too
insert into public.records (org_id, coll, id, data, deleted) values
  ('00000000-0000-4000-8000-0000000000c1', 'places', 'PL-8', '{"id":"PL-8","buildingId":"BD-a","name":"Deleted","category":"food","lat":3.06,"lng":101.69}', true);

create temporary table t_guest_places_ok (n int);

do $$
declare j jsonb; nb jsonb; ids text; pl jsonb;
begin
  perform set_config('orbique.guest_now', '2026-10-31T20:00', true);

  -- the API roles cannot call the helper
  if has_function_privilege('anon', 'public.guest__nearby(uuid, text)', 'execute') then raise exception 'anon can run guest__nearby'; end if;
  if has_function_privilege('authenticated', 'public.guest__nearby(uuid, text)', 'execute') then raise exception 'authenticated can run guest__nearby'; end if;
  if not has_function_privilege('anon', 'public.guest_get(text)', 'execute') then raise exception 'anon lost guest_get'; end if;

  -- a typed stay in Alpha: Alpha's places only, in staff order (order, then name, then id), public fields only
  j := public.guest_get('gPlaceTest0001'); nb := j->'nearby';
  if j->>'ok' <> 'true' then raise exception 'B-a: %', j; end if;
  if nb->'building' <> '{"id":"BD-a","name":"Alpha Residences","address":"1 Jalan Alpha","lat":3.0561,"lng":101.6887}'::jsonb then raise exception 'B-a building: %', nb->'building'; end if;
  select string_agg(x->>'id', ',' order by n) into ids from jsonb_array_elements(nb->'places') with ordinality e(x, n);
  if ids is distinct from 'PL-1,PL-2,PL-3,PL-7,PL-10,PL-11' then raise exception 'B-a places: %', ids; end if;
  pl := nb->'places'->1;
  if pl <> '{"id":"PL-2","name":"Kopi Alpha","category":"cafe","note":"Kaya toast","address":"","lat":3.0552,"lng":101.6905,"hours":"8 AM to 6 PM","phone":"+60 3 0000 0000","route":null}'::jsonb then raise exception 'B-a place PL-2: %', pl; end if;
  if nb::text like '%staffOnly%' or nb::text like '%do not show%' or nb::text like '%osmId%' or nb::text like '%updatedBy%' or nb::text like '%createdBy%' then raise exception 'staff fields leaked: %', nb; end if;
  if nb->'places'->0->'route' <> '{"coords":[[101.6887,3.0561],[101.6874,3.0561],[101.6874,3.0546]],"meters":310,"minutes":4,"mode":"foot"}'::jsonb then raise exception 'B-a route: %', nb->'places'->0->'route'; end if;
  if nb->'places'->2->>'category' <> 'other' or nb->'places'->2->'lat' <> '3.06'::jsonb then raise exception 'PL-3 (odd category, text numbers): %', nb->'places'->2; end if;
  if nb->'places'->3->'route' <> 'null'::jsonb then raise exception 'PL-7 bad route: %', nb->'places'->3; end if;
  if nb->'places'->4->'route' <> '{"coords":[[101.6887,3.0561],[101.69,3.06]],"meters":500,"minutes":null,"mode":"foot"}'::jsonb then raise exception 'PL-10 mixed route: %', nb->'places'->4->'route'; end if;
  if nb->'places'->5->'route' <> 'null'::jsonb then raise exception 'PL-11 one-point route: %', nb->'places'->5->'route'; end if;
  if has_function_privilege('anon', 'public.guest__coords(jsonb)', 'execute') then raise exception 'anon can run guest__coords'; end if;
  if j::text like '%Beta Money Changer%' or j::text like '%Other Org%' or j::text like '%Archived%' or j::text like '%Deleted%' or j::text like '%No position%' or j::text like '%"Zero"%' then raise exception 'B-a got a place it should not: %', nb; end if;

  -- a typed stay with no unit yet still gets its building's places (from the unit type)
  j := public.guest_get('gPlaceTest0002');
  if j->'nearby'->'building'->>'id' <> 'BD-a' or jsonb_array_length(j->'nearby'->'places') <> 6 then raise exception 'B-n (no unit yet): %', j->'nearby'; end if;

  -- Beta: its own place, and no pin while its latitude is not a number
  j := public.guest_get('gPlaceTest0003'); nb := j->'nearby';
  if nb->'building'->'lat' <> 'null'::jsonb or nb->'building'->'lng' <> 'null'::jsonb then raise exception 'B-b building pin: %', nb->'building'; end if;
  select string_agg(x->>'name', ',') into ids from jsonb_array_elements(nb->'places') x;
  if ids is distinct from 'Beta Money Changer' then raise exception 'B-b places: %', ids; end if;

  -- a unit outside buildings: nearby is null
  j := public.guest_get('gPlaceTest0004');
  if j->>'ok' <> 'true' or not (j ? 'nearby') or j->'nearby' <> 'null'::jsonb then raise exception 'B-v nearby: %', j->'nearby'; end if;

  -- an untyped unit inside a building: that building's places
  j := public.guest_get('gPlaceTest0005');
  if j->'nearby'->'building'->>'id' <> 'BD-a' or jsonb_array_length(j->'nearby'->'places') <> 6 then raise exception 'B-w (untyped unit in a building): %', j->'nearby'; end if;

  -- the other workspace, same ids: only its own building and places
  j := public.guest_get('gPlaceTest0009'); nb := j->'nearby';
  if nb->'building'->>'name' <> 'Other Org Building' then raise exception 'org 2 building: %', nb->'building'; end if;
  select string_agg(x->>'name', ',' order by n) into ids from jsonb_array_elements(nb->'places') with ordinality e(x, n);
  if ids is distinct from 'Other Org Hawker,Other Org Secret Cafe' then raise exception 'org 2 places: %', ids; end if;
  if nb::text like '%Alpha%' or nb::text like '%Kopi%' then raise exception 'org 1 places reached org 2: %', nb; end if;

  -- expired stays still return only the brand
  perform set_config('orbique.guest_now', '2026-12-10T10:00', true);
  j := public.guest_get('gPlaceTest0001');
  if j->>'error' <> 'expired' or j ? 'nearby' then raise exception 'expired payload: %', j; end if;

  -- the payload keeps every key it had before 0021
  perform set_config('orbique.guest_now', '2026-11-02T10:00', true);
  j := public.guest_get('gPlaceTest0001');
  if (select string_agg(k, ',' order by k) from jsonb_object_keys(j) k) is distinct from 'app,booking,brand,checkin,door,feedback,messages,nearby,now,ok,property,readOnly,reports,requests,state,v' then
    raise exception 'payload keys: %', (select string_agg(k, ',' order by k) from jsonb_object_keys(j) k);
  end if;

  insert into t_guest_places_ok values (1);
  raise notice 'guest_places: all checks passed';
end $$;

select count(*) as guest_places_checks_passed from t_guest_places_ok;
rollback;
