-- 0021: nearby places in the guest app. Owner, 2026-10-29: "In the Guest App, I want a section where we will highlight few
-- popular food joints, streetfood places, other important places like hospitals near by, money exchange nearby, etc. All
-- these will have offline maps ... Remember that this will obviously be different for every building".
--
-- Places are records in the collection 'places' ({id, buildingId, name, category, note, address, lat, lng, hours, phone,
-- order, route}), one list per building; a building may carry lat / lng. Guests read them through guest_get, in a new
-- payload key:
--   nearby: {building: {id, name, address, lat, lng}, places: [{id, name, category, note, address, lat, lng, hours, phone,
--            route: {coords, meters, minutes, mode} | null}]}   (null when the stay is not in a building)
-- Only those public fields leave the database: never createdBy / updatedBy, osmId or anything else staff store.
-- The building is the booking's unit type's building, else the unit's own building (as O.buildingOf in core.js).
--
-- guest__coords and guest__nearby are new. guest__payload is re-created from 0020_reveal_24h.sql (the latest definition) with only these
-- changes: the declared bd_id, the line that sets it, and the 'nearby' key at the end. Re-runnable. If 0003, 0008 or 0020
-- is ever re-applied (migrate.mjs --reapply), re-apply this file after it, or the payload loses 'nearby'.
-- Mirrors app/pages/nearby.js (forBuilding) and api/_lib/shared/geo.cjs (guestPlace, guestPlaces: at most 60 places,
-- ordered by order, then name, then id; text cut to 80 / 240 / 160 / 80 / 40 characters; a route of 2 to 1000 points).

-- a stored route line as guests get it: only [lng, lat] pairs of numbers that are real coordinates, in order; null when
-- fewer than 2 remain or the list is not an array of 2 to 1000 entries (routeCoords in api/_lib/shared/geo.cjs)
create or replace function public.guest__coords(c jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case when cnt >= 2 then pts end from (
    select count(*) cnt, jsonb_agg(jsonb_build_array((e->>0)::numeric, (e->>1)::numeric) order by i) pts
    from jsonb_array_elements(case when jsonb_typeof(c) = 'array' and jsonb_array_length(c) between 2 and 1000 then c else '[]'::jsonb end) with ordinality a(e, i)
    where jsonb_typeof(e) = 'array' and jsonb_array_length(e) = 2 and jsonb_typeof(e->0) = 'number' and jsonb_typeof(e->1) = 'number'
      and (e->>0)::numeric between -180 and 180 and (e->>1)::numeric between -90 and 90) q
$$;

-- the nearby places of a building, as the guest sees them (forBuilding in nearby.js)
create or replace function public.guest__nearby(p_org uuid, p_bid text) returns jsonb
language plpgsql stable set search_path = public as $$
declare bd jsonb; lat numeric; lng numeric;
begin
  if p_bid is null then return null; end if;
  select r.data into bd from records r where r.org_id = p_org and r.coll = 'buildings' and r.id = p_bid and not r.deleted;
  if bd is null then return null; end if;
  lat := public.guest__num(bd->'lat'); lng := public.guest__num(bd->'lng');
  if not coalesce(lat between -90 and 90 and lng between -180 and 180 and not (lat = 0 and lng = 0), false) then lat := null; lng := null; end if;
  return jsonb_build_object(
    'building', jsonb_build_object('id', p_bid,
      'name', case when jsonb_typeof(bd->'name') = 'string' then bd->'name' else '""'::jsonb end,
      'address', case when jsonb_typeof(bd->'address') = 'string' then bd->'address' else '""'::jsonb end,
      'lat', to_jsonb(lat), 'lng', to_jsonb(lng)),
    'places', coalesce((select jsonb_agg(q.o order by q.n) from (
      select row_number() over (order by coalesce(public.guest__num(x.data->'order'), 0), lower(coalesce(x.data->>'name', '')) collate "C", x.id collate "C") n,
        jsonb_build_object(
          'id', x.id,
          'name', to_jsonb(coalesce(nullif(case when jsonb_typeof(x.data->'name') = 'string' then left(x.data->>'name', 80) end, ''), 'Place')),
          'category', to_jsonb(case when x.data->>'category' in ('food', 'streetfood', 'cafe', 'hospital', 'clinic', 'pharmacy', 'money', 'atm', 'convenience', 'supermarket', 'transport', 'police', 'laundry', 'other') then x.data->>'category' else 'other' end),
          'note', to_jsonb(case when jsonb_typeof(x.data->'note') = 'string' then left(x.data->>'note', 240) else '' end),
          'address', to_jsonb(case when jsonb_typeof(x.data->'address') = 'string' then left(x.data->>'address', 160) else '' end),
          'lat', to_jsonb(public.guest__num(x.data->'lat')), 'lng', to_jsonb(public.guest__num(x.data->'lng')),
          'hours', to_jsonb(case when jsonb_typeof(x.data->'hours') = 'string' then left(x.data->>'hours', 80) else '' end),
          'phone', to_jsonb(case when jsonb_typeof(x.data->'phone') = 'string' then left(x.data->>'phone', 40) else '' end),
          'route', case when jsonb_typeof(x.data->'route') = 'object' and public.guest__coords(x.data->'route'->'coords') is not null
                        then jsonb_build_object('coords', public.guest__coords(x.data->'route'->'coords'), 'meters', to_jsonb(public.guest__num(x.data->'route'->'meters')),
                          'minutes', to_jsonb(public.guest__num(x.data->'route'->'minutes')), 'mode', 'foot') end) o
      from records x
      where x.org_id = p_org and x.coll = 'places' and not x.deleted and x.data->>'buildingId' = p_bid
        and coalesce(x.data->'archived' <> 'true'::jsonb, true)
        and public.guest__num(x.data->'lat') between -90 and 90 and public.guest__num(x.data->'lng') between -180 and 180
        and not (public.guest__num(x.data->'lat') = 0 and public.guest__num(x.data->'lng') = 0)
      order by n limit 60) q), '[]'::jsonb));
end $$;

-- the guest's payload (buildPayload in guestapp.js), from 0020 with 'nearby' added
create or replace function public.guest__payload(p_org uuid, p_bid text, b jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  o record; g jsonb := public.guest__cfg(p_org); v_now text := public.guest__now(); s jsonb; st text; brand jsonb;
  p jsonb; pid text := b->>'propertyId'; conv jsonb; w jsonb; wifi jsonb; ph jsonb; gc jsonb; ra jsonb;
  active boolean; app jsonb; ws_phone text; c jsonb;
  t jsonb; bd jsonb; type_id text; shown boolean; bd_id text;
  default_services constant jsonb := '[{"id":"towels","name":"Extra towels and linen"},{"id":"late","name":"Late check-out"},{"id":"early","name":"Early check-in"},{"id":"transfer","name":"Airport transfer"},{"id":"clean","name":"Mid-stay clean"},{"id":"sim","name":"Tourist SIM card"},{"id":"car","name":"Car rental"},{"id":"tng","name":"Touch ''n Go card"}]';
begin
  select name, status into o from orgs where id = p_org;
  -- unit type (what was sold, else the unit's own type) and building; the check-in time falls back to the unit, then the building
  select r.data into p from records r where r.org_id = p_org and r.coll = 'properties' and r.id = pid and not r.deleted;
  type_id := coalesce(nullif(b->>'unitTypeId', ''), nullif(p->>'unitTypeId', ''));
  if type_id is not null then
    select r.data into t from records r where r.org_id = p_org and r.coll = 'unitTypes' and r.id = type_id and not r.deleted;
  end if;
  if t is not null and nullif(t->>'buildingId', '') is not null then
    select r.data into bd from records r where r.org_id = p_org and r.coll = 'buildings' and r.id = t->>'buildingId' and not r.deleted;
  end if;
  -- 0021: the building for the nearby places: the unit type's, else the unit's own (O.buildingOf in core.js)
  bd_id := coalesce(nullif(t->>'buildingId', ''), nullif(p->>'buildingId', ''));
  s := public.guest__stay(public.guest__with_ci(p_org, b), g, v_now);
  if s is null then return public.guest__err('not_found'); end if;
  st := s->>'state';
  brand := public.guest__brand(p_org, o.name);
  if st = 'expired' then return jsonb_build_object('ok', false, 'error', 'expired', 'brand', brand); end if;
  active := st in ('arrival', 'inhouse', 'checkout');
  -- the unit number (typed units) and the Wi-Fi only from unitAt (24 hours before check-in, so also on the day before
  -- arrival) until the stay ends
  shown := (active or st = 'upcoming') and v_now >= s->>'unitAt';

  if p is not null or t is not null then
    w := p->'wifi';
    wifi := case jsonb_typeof(w)
      when 'array' then jsonb_build_object('name', w->0, 'password', w->1)
      when 'object' then jsonb_build_object('name', w->'name', 'password', case when coalesce(jsonb_typeof(w->'password'), 'null') <> 'null' then w->'password' else w->'pass' end)
      else case when public.guest__truthy(p->'wifiName') or public.guest__truthy(p->'wifiPassword') then jsonb_build_object('name', p->'wifiName', 'password', p->'wifiPassword') end end;
    ph := case jsonb_typeof(p->'photos'->0) when 'string' then p->'photos'->0 when 'object' then p->'photos'->0->'url' end;
    if t is null then
      p := jsonb_build_object('name', p->'name', 'area', public.guest__or(p->'area', '""'), 'address', public.guest__or(p->'address', '""'),
        'type', public.guest__or(p->'type', '""'), 'beds', p->'beds', 'parking', public.guest__or(p->'parking', '""'),
        'lockBrand', public.guest__or(p->'lockBrand', '""'), 'photo', ph, 'wifi', case when active or shown then wifi end);
    else
      -- the guest-facing name is building + type ("Seri Saujana Residences · Deluxe"), never the unit's own name or number
      p := jsonb_build_object(
        'name', to_jsonb(case when public.guest__truthy(bd->'name') then (bd->>'name') || ' · ' else '' end || coalesce(t->>'name', '')),
        'area', coalesce(public.guest__or(p->'area', null), public.guest__or(bd->'city', null), '""'),
        'address', public.guest__or(bd->'address', '""'),
        'type', public.guest__or(p->'type', '""'), 'beds', case when p is not null and p ? 'beds' then p->'beds' else t->'beds' end,
        'parking', public.guest__or(p->'parking', '""'), 'lockBrand', public.guest__or(p->'lockBrand', '""'), 'photo', ph,
        'wifi', case when shown then wifi end,
        'unitType', coalesce(t->'name', '""'),
        'unitNo', case when shown and p is not null then public.guest__or(p->'unitNo', null) end,
        'unitAt', s->'unitAt');
    end if;
  end if;

  select o_data into conv from public.guest__chat(p_org, p_bid, v_now, false);
  gc := case when jsonb_typeof(b->'guestCheckin') = 'object' then b->'guestCheckin' end;
  ra := case when jsonb_typeof(b->'rulesAccepted') = 'object' then b->'rulesAccepted' end;

  select coalesce((select v->>'phone' from (select case when jsonb_typeof(x.data->'v') = 'object' then x.data->'v' end v from blobs x where x.org_id = p_org and x.key = 'workspaceBrand') q), '') into ws_phone;
  c := case when g ? 'contact' then case when jsonb_typeof(g->'contact') = 'object' then g->'contact' end else '{"phone":"","whatsapp":"","hours":"8 AM to 11 PM"}'::jsonb end;
  app := jsonb_build_object(
    'requireCheckin', public.guest__on(g, 'requireCheckin'), 'requireId', public.guest__on(g, 'requireId'), 'requireName', public.guest__on(g, 'requireName'),
    'codeLeadHours', public.guest__lead(g), 'reviewPrompt', public.guest__on(g, 'reviewPrompt'),
    'welcome', case when not (g ? 'welcome') then to_jsonb('Everything for your stay is here: online check-in, your door code, Wi-Fi, the house guide and a direct line to our team.'::text)
                    when jsonb_typeof(g->'welcome') = 'string' then g->'welcome' end,
    'contact', case when c is not null then jsonb_build_object(
        'phone', coalesce(nullif(case when jsonb_typeof(c->'phone') = 'string' then c->>'phone' else '' end, ''), ws_phone),
        'whatsapp', case when jsonb_typeof(c->'whatsapp') = 'string' then c->>'whatsapp' else '' end,
        'hours', case when jsonb_typeof(c->'hours') = 'string' then c->>'hours' else '' end) end,
    'rules', case when jsonb_typeof(g->'rules') = 'array' then (select coalesce(jsonb_agg(jsonb_build_object('id', x->'id', 'title', x->'title', 'text', x->'text') order by n), '[]') from jsonb_array_elements(g->'rules') with ordinality e(x, n) where jsonb_typeof(x) = 'object') end,
    'entry', case when jsonb_typeof(g->'entry') = 'array' then (select coalesce(jsonb_agg(jsonb_build_object('id', x->'id', 'text', x->'text') order by n), '[]') from jsonb_array_elements(g->'entry') with ordinality e(x, n)
              where jsonb_typeof(x) = 'object' and (coalesce(jsonb_typeof(x->'propertyIds'), '') <> 'array' or jsonb_array_length(x->'propertyIds') = 0 or (pid is not null and x->'propertyIds' @> to_jsonb(pid)))) end,
    'guide', case when jsonb_typeof(g->'guide') = 'array' then (select coalesce(jsonb_agg(jsonb_build_object('id', x->'id', 'title', x->'title', 'text', x->'text') order by n), '[]') from jsonb_array_elements(g->'guide') with ordinality e(x, n)
              where jsonb_typeof(x) = 'object' and (coalesce(jsonb_typeof(x->'propertyIds'), '') <> 'array' or jsonb_array_length(x->'propertyIds') = 0 or (pid is not null and x->'propertyIds' @> to_jsonb(pid)))) end,
    'checkout', case when jsonb_typeof(g->'checkout') = 'array' then (select coalesce(jsonb_agg(jsonb_build_object('id', x->'id', 'text', x->'text') order by n), '[]') from jsonb_array_elements(g->'checkout') with ordinality e(x, n) where jsonb_typeof(x) = 'object') end,
    'todo', case when jsonb_typeof(g->'todo') = 'object' then g->'todo' end,
    'dont', case when jsonb_typeof(g->'dont') = 'array' then g->'dont' end,
    'videos', case when jsonb_typeof(g->'videos') = 'array' then g->'videos' end,
    'services', case when jsonb_typeof(g->'services') = 'array' then (select coalesce(jsonb_agg(jsonb_build_object('id', x->'id', 'name', x->'name', 'icon', x->'icon', 'price', x->'price', 'desc', x->'desc', 'fields', x->'fields') order by n), '[]')
              from jsonb_array_elements(g->'services') with ordinality e(x, n) where jsonb_typeof(x) = 'object' and coalesce(x->'on' <> 'false'::jsonb, true)) end);

  return jsonb_build_object(
    'ok', true, 'v', 1, 'now', v_now, 'state', st, 'readOnly', o.status <> 'active', 'brand', brand,
    'booking', jsonb_build_object('ref', p_bid, 'guestName', public.guest__or(b->'guest'->'name', '"Guest"'),
      'guests', coalesce(nullif(public.guest__num(b->'guests'), 0), 1),
      'nights', coalesce(nullif(public.guest__num(b->'nights'), 0), (b->>'checkOut')::date - (b->>'checkIn')::date),
      'checkIn', b->'checkIn', 'checkOut', b->'checkOut', 'checkInTime', s->'ciTime', 'checkOutTime', s->'coTime',
      'channel', public.guest__or(b->'channel', '"direct"'), 'status', public.guest__or(b->'status', '"confirmed"')),
    'property', p,
    'checkin', jsonb_build_object('done', s->'checkinDone',
      'at', case when gc is not null then gc->'at' when ra is not null then ra->'at' end,
      'names', case when jsonb_typeof(gc->'names') = 'array' then gc->'names' else '[]'::jsonb end,
      'arrivalTime', gc->'arrivalTime',
      'signedName', case when gc is not null then gc->'signedName' when ra is not null then ra->'name' end,
      'idSubmitted', public.guest__truthy(b->'idSubmittedAt'), 'idVerified', s->'idVerified'),
    'door', jsonb_build_object('visible', s->'visible', 'code', case when (s->>'visible')::boolean then to_jsonb(b->>'doorCode') end,
      'from', s->'revealAt', 'until', s->'coAt', 'waitingFor', s->'waiting',
      'helpOpen', exists (select 1 from records r where r.org_id = p_org and r.coll = 'guestRequests' and not r.deleted and r.data->>'bookingId' = p_bid and r.data->>'type' = 'code' and r.data->>'status' = 'new')),
    'app', app,
    'messages', coalesce((select jsonb_agg(q.o order by q.n) from (
        select n, jsonb_build_object('from', case when m->>'from' = 'guest' then 'guest' else 'host' end,
          'type', case when m->>'type' in ('voice', 'image', 'file') then m->>'type' else 'text' end,
          'text', case when m->>'type' = 'voice' then to_jsonb('Voice message'::text) when m->>'type' = 'image' then public.guest__or(m->'caption', '"Photo"')
                       else to_jsonb(case when public.guest__truthy(m->'text') then case when jsonb_typeof(m->'text') = 'string' then m->>'text' else (m->'text')::text end else '' end) end,
          'time', m->'time') o
        from jsonb_array_elements(case when jsonb_typeof(conv->'messages') = 'array' then conv->'messages' else '[]'::jsonb end) with ordinality e(m, n)
        where jsonb_typeof(m) = 'object' and m->>'from' in ('guest', 'staff') and coalesce(m->'idPhoto' <> 'true'::jsonb, true) order by n desc limit 100) q), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(q.o order by q.at desc nulls last, q.id) from (
        select r.id collate "C" as id, (r.data->>'at') collate "C" as at, jsonb_build_object('id', r.id, 'type', r.data->'type', 'summary', r.data->'summary',
          'note', public.guest__or(r.data->'note', null), 'status', r.data->'status', 'at', r.data->'at') o
        from records r where r.org_id = p_org and r.coll = 'guestRequests' and not r.deleted and r.data->>'bookingId' = p_bid
        order by (r.data->>'at') collate "C" desc nulls last, r.id collate "C" limit 50) q), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(q.o order by q.at desc nulls last, q.id) from (
        select r.id collate "C" as id, (r.data->>'at') collate "C" as at, jsonb_build_object('id', r.id, 'room', r.data->'room', 'item', r.data->'item', 'desc', r.data->'desc',
          'when', r.data->'when', 'urgent', coalesce(r.data->'urgent' = 'true'::jsonb, false), 'at', r.data->'at',
          'photos', case when jsonb_typeof(r.data->'photos') = 'array' then jsonb_array_length(r.data->'photos') else 0 end,
          'status', case when exists (select 1 from records t where t.org_id = p_org and t.coll = 'tasks' and not t.deleted and public.guest__truthy(r.data->'taskId') and t.id = r.data->>'taskId' and t.data->>'status' = 'done') then 'fixed'
                         when r.data->>'when' = 'arrival' or jsonb_typeof(r.data->'noted') = 'object' then 'logged' else 'open' end) o
        from records r where r.org_id = p_org and r.coll = 'damageReports' and not r.deleted and r.data->>'bookingId' = p_bid
        order by (r.data->>'at') collate "C" desc nulls last, r.id collate "C" limit 50) q), '[]'::jsonb),
    'feedback', case when jsonb_typeof(b->'guestFeedback') = 'object' then jsonb_build_object('stars', b->'guestFeedback'->'stars', 'text', b->'guestFeedback'->'text', 'at', b->'guestFeedback'->'at') end,
    -- 0021: the building's nearby places and its pin
    'nearby', public.guest__nearby(p_org, bd_id));
end $$;

-- same grants as 0003 / 0008 / 0020: helpers stay closed to the API roles
do $$
declare fn text;
begin
  foreach fn in array array['guest__coords(jsonb)', 'guest__nearby(uuid, text)', 'guest__payload(uuid, text, jsonb)'] loop
    execute format('revoke all on function public.%s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function public.%s from anon', fn); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function public.%s from authenticated', fn); end if;
  end loop;
end $$;
