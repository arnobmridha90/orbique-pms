-- 0014: single-unit listing types, for sites that sell one apartment per listing (Airbnb, Vrbo).
--
-- A unit type whose record has listingOf = <unit id> is that one unit's own calendar on Channex: a room type with one
-- room, mapped to that unit's Airbnb or Vrbo listing. It has no units of its own. Hotel-style sites keep selling the
-- unit's real type (e.g. Premium, 2 units); the listing type is open on a night only when its unit is free AND the real
-- type still has a unit to sell, so one Premium booking on Booking.com closes the Airbnb or Vrbo listing of whichever
-- unit took it, and the last free Premium night closes every Premium listing.
-- Bookings that come in on a listing type are filed under the real type and pinned to the unit
-- (api/_lib/channex-bookings.js pinListing).
--
-- Safe to re-run.

-- The listing's unit, or null for an ordinary unit type
create or replace function public.channex__listing_unit(p_org uuid, p_type text) returns text
language sql stable set search_path = '' as $$
  select nullif(r.data->>'listingOf', '') from public.records r
   where r.org_id = p_org and r.coll = 'unitTypes' and r.id = p_type and not r.deleted;
$$;

-- The 0006 count for an ordinary unit type, unchanged (avail = free units - unassigned bookings of the type)
create or replace function public.channex__type_avail_base(p_org uuid, p_unit_type text, p_from date, p_to date)
returns table (date date, availability int, raw int)
language sql stable set search_path = '' as $$
  with u as (
    select r.id from public.records r
     where r.org_id = p_org and r.coll = 'properties' and not r.deleted
       and r.data->>'unitTypeId' = p_unit_type and not public.channex__archived(r.data)
  ), b as (
    select q.pid, q.ci, q.co from (
      select nullif(r.data->>'propertyId', '') as pid, r.data->>'unitTypeId' as tid,
             public.channex__date(r.data->>'checkIn') as ci, public.channex__date(r.data->>'checkOut') as co
        from public.records r
       where r.org_id = p_org and r.coll = 'bookings' and not r.deleted
         and coalesce(r.data->>'status', '') not in ('cancelled', 'deleted')) q
     where q.ci <= p_to and q.co > p_from
       and (q.pid in (select u.id from u) or (q.pid is null and q.tid = p_unit_type))
  ), k as (
    select q.pid, q.s, q.e from (
      select r.data->>'propertyId' as pid, public.channex__date(r.data->>'start') as s, public.channex__date(r.data->>'end') as e
        from public.records r
       where r.org_id = p_org and r.coll = 'blocks' and not r.deleted) q
     where q.pid in (select u.id from u) and q.s <= p_to and q.e > p_from
  ), d as (
    select g::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  )
  select d.day, greatest(x.raw, 0), x.raw
    from d cross join lateral (
      select ((select count(*) from u
                where not exists (select 1 from k where k.pid = u.id and k.s <= d.day and d.day < k.e)
                  and not exists (select 1 from b where b.pid = u.id and b.ci <= d.day and d.day < b.co))
            - (select count(*) from b where b.pid is null and b.ci <= d.day and d.day < b.co))::int as raw) x
   order by d.day;
$$;

-- Availability per night: ordinary types as in 0006; a listing type is 1 when its unit is live, not blocked, has no
-- assigned live booking, and its real type still has a unit to sell that night; else 0. A listing type never reports
-- an oversold night (raw >= 0): the real type does.
create or replace function public.channex_type_availability(p_org uuid, p_unit_type text, p_from date, p_to date)
returns table (date date, availability int, raw int)
language plpgsql stable set search_path = '' as $$
#variable_conflict use_column
declare v_unit text; v_type text; v_live boolean;
begin
  v_unit := public.channex__listing_unit(p_org, p_unit_type);
  if v_unit is null then
    return query select * from public.channex__type_avail_base(p_org, p_unit_type, p_from, p_to);
    return;
  end if;
  select nullif(r.data->>'unitTypeId', ''), not public.channex__archived(r.data) into v_type, v_live
    from public.records r where r.org_id = p_org and r.coll = 'properties' and r.id = v_unit and not r.deleted;
  if v_type is null or not coalesce(v_live, false) then
    return query select g::date, 0, 0 from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g;
    return;
  end if;
  return query
    select t.date, x.v, x.v
      from public.channex__type_avail_base(p_org, v_type, p_from, p_to) t
      cross join lateral (
        select (case when t.availability >= 1
          and not exists (select 1 from public.records r
                           where r.org_id = p_org and r.coll = 'blocks' and not r.deleted and r.data->>'propertyId' = v_unit
                             and public.channex__date(r.data->>'start') <= t.date and t.date < public.channex__date(r.data->>'end'))
          and not exists (select 1 from public.records r
                           where r.org_id = p_org and r.coll = 'bookings' and not r.deleted and r.data->>'propertyId' = v_unit
                             and coalesce(r.data->>'status', '') not in ('cancelled', 'deleted')
                             and public.channex__date(r.data->>'checkIn') <= t.date and t.date < public.channex__date(r.data->>'checkOut'))
          then 1 else 0 end)::int as v) x
     order by t.date;
end $$;

-- Marking a type also marks the listing types of its units (their value depends on the type's count and their unit)
create or replace function public.channex__mark_type(p_org uuid, p_type text, p_from date, p_to date, p_reason text)
returns void language plpgsql set search_path = '' as $$
declare t text;
begin
  if p_type is null or p_type = '' then return; end if;
  perform public.channex__mark(p_org, public.channex__type_property(p_org, p_type), 'availability', p_type, p_from, p_to, p_reason);
  for t in
    select lt.id from public.records lt
      join public.records u on u.org_id = lt.org_id and u.coll = 'properties' and u.id = lt.data->>'listingOf' and not u.deleted
     where lt.org_id = p_org and lt.coll = 'unitTypes' and not lt.deleted
       and coalesce(lt.data->>'listingOf', '') <> '' and u.data->>'unitTypeId' = p_type and lt.id <> p_type
  loop
    perform public.channex__mark(p_org, public.channex__type_property(p_org, t), 'availability', t, p_from, p_to, p_reason);
  end loop;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array['channex__listing_unit(uuid, text)', 'channex__type_avail_base(uuid, text, date, date)',
                            'channex_type_availability(uuid, text, date, date)', 'channex__mark_type(uuid, text, date, date, text)']
  loop
    execute format('revoke all on function public.%s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function public.%s from anon', fn); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function public.%s from authenticated', fn); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.channex_type_availability(uuid, text, date, date) to service_role;
  end if;
end $$;
