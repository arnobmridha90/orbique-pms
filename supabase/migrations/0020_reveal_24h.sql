-- 0020: the door code, the unit number and the Wi-Fi reach the guest 24 hours before check-in (was 30 minutes).
-- Owner, 2026-10-29: "We will send 24 hours before checkin", so guests have everything saved before they board the flight
-- and do not wait at the unit for Wi-Fi to get the door code.
--
-- Re-creates guest__stay and guest__payload from 0008_guest_units.sql (applied, so not edited). Re-runnable. guest_get and
-- guest_act call these, so both follow the new time. Only these lines differ from 0008:
--   * guest__stay: unitAt (and revealAt, the door-code moment) = check-in minus interval '24 hours'.
--   * guest__payload: the unit number and Wi-Fi show from unitAt also while the stay is still 'upcoming' (the day before
--     arrival); before they showed only on the arrival, in-house and check-out days. An untyped unit's Wi-Fi follows too.
-- The other door-code conditions (online check-in, ID check, confirmation, a code set) are unchanged.
-- Mirrors app/pages/guestapp.js (stayInfo, guestProperty) and api/_lib/shared/assign.cjs (REVEAL_MINUTES).
-- If 0003_guest.sql or 0008_guest_units.sql is ever re-applied (migrate.mjs --reapply), re-apply this file after it,
-- or the 30-minute functions come back.

-- the stage of a stay and the door-code rule (stayInfo in guestapp.js)
create or replace function public.guest__stay(b jsonb, g jsonb, p_now text) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  ci text := b->>'checkIn'; co text := b->>'checkOut'; today text := left(p_now, 10);
  -- the booking's check-in time, else the hint '_ciTime' (the unit's or building's time, merged in by guest__payload), else 15:00
  ci_t text := case when b->>'checkInTime' ~ '^([01]\d|2[0-3]):[0-5]\d$' then b->>'checkInTime'
                    when b->>'_ciTime' ~ '^([01]\d|2[0-3]):[0-5]\d$' then b->>'_ciTime' else '15:00' end;
  co_t text := case when b->>'checkOutTime' ~ '^([01]\d|2[0-3]):[0-5]\d$' then b->>'checkOutTime' else '11:00' end;
  ci_at text; co_at text; reveal text; unit_at text; st text; done boolean; id_ok boolean; waiting text[] := '{}';
begin
  if ci !~ '^\d{4}-\d{2}-\d{2}$' or co !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  begin perform ci::date, co::date; exception when others then return null; end;
  ci_at := ci || 'T' || ci_t; co_at := co || 'T' || co_t;
  -- the unit number shows 24 hours before check-in (stayInfo: UNIT_REVEAL_MIN; owner decision 2026-10-29)
  unit_at := to_char(replace(ci_at, 'T', ' ')::timestamp - interval '24 hours', 'YYYY-MM-DD"T"HH24:MI');
  -- door code timing (owner decisions 2026-10-15, 2026-10-29): from the same moment as the unit number, for every booking.
  -- codeLeadHours (guest__lead) is no longer used here.
  reveal := unit_at;
  st := case when today > to_char(co::date + 30, 'YYYY-MM-DD') then 'expired'
             when b->>'status' = 'cancelled' then 'cancelled'
             when p_now >= co_at or b->>'status' = 'checked_out' then 'past'
             when today < ci then 'upcoming' when today = ci then 'arrival' when today < co then 'inhouse' else 'checkout' end;
  done := jsonb_typeof(b->'guestCheckin') = 'object' or jsonb_typeof(b->'rulesAccepted') = 'object';
  done := coalesce(done, false);
  id_ok := coalesce(b->'idVerified' = 'true'::jsonb, false);
  if st in ('upcoming', 'arrival', 'inhouse', 'checkout') then
    if b->>'status' = 'pending' then waiting := array_append(waiting, 'confirmation'); end if;
    if public.guest__on(g, 'requireCheckin') and not done then waiting := array_append(waiting, 'checkin'); end if;
    if public.guest__on(g, 'requireId') and not id_ok then waiting := array_append(waiting, 'id'); end if;
    if p_now < reveal then waiting := array_append(waiting, 'time'); end if;
    if b->>'codeStatus' in ('cancelled', 'expired') or not public.guest__truthy(b->'doorCode') then waiting := array_append(waiting, 'host'); end if;
  else
    waiting := array_append(waiting, 'ended');
  end if;
  return jsonb_build_object('state', st, 'ciTime', ci_t, 'coTime', co_t, 'ciAt', ci_at, 'coAt', co_at, 'revealAt', reveal, 'unitAt', unit_at,
    'checkinDone', done, 'idVerified', id_ok, 'waiting', to_jsonb(waiting), 'visible', cardinality(waiting) = 0);
end $$;

-- the guest's payload (buildPayload in guestapp.js)
create or replace function public.guest__payload(p_org uuid, p_bid text, b jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  o record; g jsonb := public.guest__cfg(p_org); v_now text := public.guest__now(); s jsonb; st text; brand jsonb;
  p jsonb; pid text := b->>'propertyId'; conv jsonb; w jsonb; wifi jsonb; ph jsonb; gc jsonb; ra jsonb;
  active boolean; app jsonb; ws_phone text; c jsonb;
  t jsonb; bd jsonb; type_id text; shown boolean;
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
    'feedback', case when jsonb_typeof(b->'guestFeedback') = 'object' then jsonb_build_object('stars', b->'guestFeedback'->'stars', 'text', b->'guestFeedback'->'text', 'at', b->'guestFeedback'->'at') end);
end $$;

-- same grants as 0003 / 0008: helpers stay closed to the API roles
do $$
declare fn text;
begin
  foreach fn in array array['guest__stay(jsonb, jsonb, text)', 'guest__payload(uuid, text, jsonb)'] loop
    execute format('revoke all on function public.%s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function public.%s from anon', fn); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function public.%s from authenticated', fn); end if;
  end loop;
end $$;
