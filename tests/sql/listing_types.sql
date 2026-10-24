-- Single-unit listing types (supabase/migrations/0014_listing_types.sql): a unitTypes record with listingOf = <unit>
-- is open (1) on a night only when that unit is free and its real type still has a unit to sell.
-- Runs after tests/sql/channex_triggers.sql (uses its t.* helpers), in one transaction that rolls back.
\set ON_ERROR_STOP 1
\pset pager off
\o /dev/null
begin;
set local orbique.channex_today = '2026-11-01';

\set L '''aaaaaaaa-0000-0000-0000-0000000000c1'''
\set LPROP '''11111111-1111-1111-1111-1111111111c1'''
insert into public.orgs (id, name) values (:L, 'Listing types');
-- Premium with two units, each with its own listing type; an archived unit's listing and an orphan listing
insert into public.records (org_id, coll, id, data) values
  (:L, 'buildings', 'BD-L', '{"id":"BD-L","name":"Vortex","currency":"MYR"}'),
  (:L, 'unitTypes', 'UT-P', '{"id":"UT-P","buildingId":"BD-L","name":"Premium"}'),
  (:L, 'unitTypes', 'LT-1', '{"id":"LT-1","buildingId":"BD-L","name":"Premium · 26-3A","listingOf":"P-1"}'),
  (:L, 'unitTypes', 'LT-2', '{"id":"LT-2","buildingId":"BD-L","name":"Premium · 47-1","listingOf":"P-2"}'),
  (:L, 'unitTypes', 'LT-X', '{"id":"LT-X","buildingId":"BD-L","name":"Gone","listingOf":"P-9"}'),
  (:L, 'properties', 'P-1', '{"id":"P-1","name":"26-3A","buildingId":"BD-L","unitTypeId":"UT-P"}'),
  (:L, 'properties', 'P-2', '{"id":"P-2","name":"47-1","buildingId":"BD-L","unitTypeId":"UT-P"}');
insert into public.channex_properties (org_id, env, building_id, channex_property_id, currency, status)
  values (:L, 'staging', 'BD-L', :LPROP, 'MYR', 'live');
delete from public.channex_outbox where org_id = :L;

select t.ok(t.avail(:L, 'UT-P', '2026-11-10', '2026-11-11') = '11-10=2/2 11-11=2/2', 'real type: unchanged count');
select t.ok(t.avail(:L, 'LT-1', '2026-11-10', '2026-11-11') = '11-10=1/1 11-11=1/1', 'listing: open while its unit and type are free');
select t.ok(t.avail(:L, 'LT-X', '2026-11-10', '2026-11-10') = '11-10=0/0', 'listing of a missing unit: closed');

-- a Booking.com booking assigned to P-1 closes LT-1 only, and marks both listings
insert into public.records (org_id, coll, id, data) values
  (:L, 'bookings', 'BL-1', '{"id":"BL-1","unitTypeId":"UT-P","propertyId":"P-1","checkIn":"2026-11-10","checkOut":"2026-11-11","status":"confirmed"}');
select t.ok(t.avail(:L, 'LT-1', '2026-11-10', '2026-11-11') = '11-10=0/0 11-11=1/1', 'listing: closed on its unit''s booked night');
select t.ok(t.avail(:L, 'LT-2', '2026-11-10', '2026-11-10') = '11-10=1/1', 'listing: the other unit stays open');
select t.ok(t.marks('availability', 'LT-1') = '2026-11-10..2026-11-10' and t.marks('availability', 'LT-2') = '2026-11-10..2026-11-10'
  and t.marks('availability', 'UT-P') = '2026-11-10..2026-11-10', 'booking on the real type marks it and its listings');
select t.ok(t.marks('availability', 'LT-X') = '', 'an orphan listing is not marked');

-- an unassigned Premium booking takes the last unit: every listing closes
insert into public.records (org_id, coll, id, data) values
  (:L, 'bookings', 'BL-2', '{"id":"BL-2","unitTypeId":"UT-P","propertyId":null,"checkIn":"2026-11-10","checkOut":"2026-11-11","status":"confirmed"}');
select t.ok(t.avail(:L, 'LT-2', '2026-11-10', '2026-11-10') = '11-10=0/0', 'listing: closed when its type is sold out by an unassigned booking');
-- oversold type: listing raw stays 0, never negative
insert into public.records (org_id, coll, id, data) values
  (:L, 'bookings', 'BL-3', '{"id":"BL-3","unitTypeId":"UT-P","propertyId":null,"checkIn":"2026-11-10","checkOut":"2026-11-11","status":"confirmed"}');
select t.ok(t.avail(:L, 'UT-P', '2026-11-10', '2026-11-10') = '11-10=0/-1' and t.avail(:L, 'LT-2', '2026-11-10', '2026-11-10') = '11-10=0/0', 'oversold: the real type reports it, the listing does not');

-- a block on P-2 closes LT-2 and marks it
delete from public.channex_outbox where org_id = :L;
insert into public.records (org_id, coll, id, data) values
  (:L, 'blocks', 'BK-L', '{"id":"BK-L","propertyId":"P-2","start":"2026-11-20","end":"2026-11-22"}');
select t.ok(t.avail(:L, 'LT-2', '2026-11-20', '2026-11-22') = '11-20=0/0 11-21=0/0 11-22=1/1', 'listing: closed while its unit is blocked');
select t.ok(t.marks('availability', 'LT-2') = '2026-11-20..2026-11-21', 'block on a unit marks its listing');

-- a cancelled booking does not close it; an archived unit's listing is closed
insert into public.records (org_id, coll, id, data) values
  (:L, 'bookings', 'BL-4', '{"id":"BL-4","unitTypeId":"UT-P","propertyId":"P-1","checkIn":"2026-11-25","checkOut":"2026-11-26","status":"cancelled"}');
select t.ok(t.avail(:L, 'LT-1', '2026-11-25', '2026-11-25') = '11-25=1/1', 'listing: a cancelled booking keeps it open');
update public.records set data = data || '{"archived":true}' where org_id = :L and coll = 'properties' and id = 'P-1';
select t.ok(t.avail(:L, 'LT-1', '2026-11-25', '2026-11-25') = '11-25=0/0', 'listing of an archived unit: closed');

-- an ordinary role cannot call the helpers
select t.ok(t.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1', $q$select public.channex__listing_unit('aaaaaaaa-0000-0000-0000-0000000000c1', 'LT-1')$q$) = 'denied', 'helpers are not callable by signed-in users');

rollback;
