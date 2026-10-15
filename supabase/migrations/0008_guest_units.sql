-- 0008: unit types in the guest app (Channex plan 2.5), and the door code from 30 minutes before check-in.
-- Re-creates guest__stay and guest__payload from 0003_guest.sql (0003 is applied, so it is not edited). Re-runnable.
-- Mirrors app/pages/guestapp.js (stayInfo, guestProperty, buildPayload); the contract is in docs/notes/v4-guestapp.md.
--
-- * A booking of a typed unit (unitTypeId on the booking or on its unit) shows the building + type name and the building's
--   address, plus unitType, unitNo and unitAt. The unit number is null until 30 minutes before check-in (unitAt) and
--   outside the arrival, in-house and check-out days. Untyped units give the same payload as before.
-- * The check-in time falls back from the booking to the unit, then the building, then 15:00 (merged into the booking as
--   the hint '_ciTime' for guest__stay; the stored booking is never changed).
-- * Door code (owner decision 2026-10-15): it shows from the same moment as the unit number, for every booking.
-- * guest__with_ci(org, booking) adds that check-in hint; guest__payload (guest_get) and guest_act both use it, so the
--   door-code timing is the same in both. guest_act is re-created from 0003 with only that call changed.

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
  -- the unit number shows 30 minutes before check-in (stayInfo: UNIT_REVEAL_MIN)
  unit_at := public.guest__addmin(ci_at, -30);
  -- door code timing (owner decision 2026-10-15): from the same moment as the unit number, for every booking.
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
-- the booking plus the check-in hint '_ciTime': the unit's time, else the building's (guest__stay falls back to 15:00)
create or replace function public.guest__with_ci(p_org uuid, b jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare p jsonb; t jsonb; bd jsonb; type_id text; ci text;
begin
  select r.data into p from records r where r.org_id = p_org and r.coll = 'properties' and r.id = b->>'propertyId' and not r.deleted;
  type_id := coalesce(nullif(b->>'unitTypeId', ''), nullif(p->>'unitTypeId', ''));
  if type_id is not null then
    select r.data into t from records r where r.org_id = p_org and r.coll = 'unitTypes' and r.id = type_id and not r.deleted;
  end if;
  if t is not null and nullif(t->>'buildingId', '') is not null then
    select r.data into bd from records r where r.org_id = p_org and r.coll = 'buildings' and r.id = t->>'buildingId' and not r.deleted;
  end if;
  ci := coalesce(case when p->>'checkInTime' ~ '^([01]\d|2[0-3]):[0-5]\d$' then p->>'checkInTime' end,
                 case when bd->>'checkInTime' ~ '^([01]\d|2[0-3]):[0-5]\d$' then bd->>'checkInTime' end);
  return case when ci is null then b else b || jsonb_build_object('_ciTime', ci) end;
end $$;

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
  -- typed units: the unit number (and the Wi-Fi, whose name may carry it) only from unitAt, while the stay is on
  shown := active and v_now >= s->>'unitAt';

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
        'lockBrand', public.guest__or(p->'lockBrand', '""'), 'photo', ph, 'wifi', case when active then wifi end);
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

-- guest_act from 0003_guest.sql, unchanged except that guest__stay gets the check-in hint (guest__with_ci)
create or replace function public.guest_act(p_token text, p_action text, p_args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  f record; b jsonb; g jsonb; v_now text; s jsonb; st text; o_status text; a jsonb; act text := coalesce(p_action, '');
  during boolean; active boolean; i int; n int; t text; x jsonb;
  names jsonb; arr text; signed text; who text;
  c record; mine jsonb; svc jsonb; vals jsonb; summary text; note text; rid text; code text;
  item text; descr text; v_when text; room text; photos jsonb; urgent boolean; stars numeric; ftext text;
  default_services constant jsonb := '[{"id":"towels","name":"Extra towels and linen"},{"id":"late","name":"Late check-out"},{"id":"early","name":"Early check-in"},{"id":"transfer","name":"Airport transfer"},{"id":"clean","name":"Mid-stay clean"},{"id":"sim","name":"Tourist SIM card"},{"id":"car","name":"Car rental"},{"id":"tng","name":"Touch ''n Go card"}]';
begin
  select * into f from public.guest__find(p_token, true);
  if f.o_id is null then return public.guest__err('not_found'); end if;
  b := f.o_data; a := case when jsonb_typeof(p_args) = 'object' then p_args else '{}'::jsonb end;
  g := public.guest__cfg(f.o_org); v_now := public.guest__now(); s := public.guest__stay(public.guest__with_ci(f.o_org, b), g, v_now); -- 0008: same check-in time as guest_get
  if s is null then return public.guest__err('not_found'); end if;
  st := s->>'state';
  if st = 'expired' then return public.guest__err('expired'); end if;
  select status into o_status from orgs where id = f.o_org;
  if o_status is distinct from 'active' then return public.guest__err('read_only'); end if;
  during := st in ('upcoming', 'arrival', 'inhouse', 'checkout');
  active := st in ('arrival', 'inhouse', 'checkout');

  if act = 'checkin' then
    if st not in ('upcoming', 'arrival', 'inhouse') then return public.guest__err('not_now'); end if;
    select coalesce(jsonb_agg(to_jsonb(q.t) order by q.n), '[]') into names from (
      select public.guest__clip(e.x, 80) t, e.n from jsonb_array_elements(case when jsonb_typeof(a->'names') = 'array' then a->'names' else '[]'::jsonb end) with ordinality e(x, n)
      where e.n <= 10) q where q.t <> '';
    arr := case when jsonb_typeof(a->'arrivalTime') = 'string' and a->>'arrivalTime' ~ '^([01]\d|2[0-3]):[0-5]\d$' then a->>'arrivalTime' end;
    signed := public.guest__clip(a->'signedName', 80);
    if jsonb_array_length(names) = 0 or coalesce(a->'consent' <> 'true'::jsonb, true) or (public.guest__on(g, 'requireName') and char_length(signed) < 3) then return public.guest__err('invalid'); end if;
    who := coalesce(nullif(signed, ''), names->>0);
    b := b || jsonb_build_object('guestCheckin', jsonb_build_object('at', v_now, 'names', names, 'arrivalTime', arr, 'consent', true, 'signedName', who),
                                 'rulesAccepted', jsonb_build_object('at', v_now, 'name', who));
    if b->>'codeStatus' = 'held' and (b->'idVerified' = 'true'::jsonb or not public.guest__on(g, 'requireId')) then b := b || '{"codeStatus":"scheduled"}'::jsonb; end if;
    update records set data = b, updated_by = null where org_id = f.o_org and coll = 'bookings' and id = f.o_id;
    perform public.guest__note(f.o_org, f.o_id, 'Guest app: online check-in done by ' || who || coalesce('. Arriving around ' || public.guest__time(arr), '') || '.', v_now);
    return '{"ok":true}'::jsonb;

  elsif act = 'id' then
    -- the ID photo goes into the booking's chat as a picture message (only the latest keeps its picture; staff delete it after the check)
    if not during then return public.guest__err('not_now'); end if;
    x := a->'photo';
    if coalesce(jsonb_typeof(x), '') <> 'object' or coalesce(jsonb_typeof(x->'url'), '') <> 'string' or char_length(x->>'url') > 240000
       or (x->>'url') !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
      return public.guest__err('invalid_photo');
    end if;
    select * into c from public.guest__chat(f.o_org, f.o_id, v_now, true);
    select count(*) into n from jsonb_array_elements(c.o_data->'messages') m where jsonb_typeof(m) = 'object' and m->'idPhoto' = 'true'::jsonb;
    if n >= 5 then return public.guest__err('too_many'); end if;
    select coalesce(jsonb_agg(case when jsonb_typeof(e.m) = 'object' and e.m->'idPhoto' = 'true'::jsonb and public.guest__truthy(e.m->'url')
                                   then (e.m - 'url') || '{"caption":"Earlier ID photo, replaced"}'::jsonb else e.m end order by e.k), '[]'::jsonb)
      into mine from jsonb_array_elements(c.o_data->'messages') with ordinality e(m, k);
    mine := mine || jsonb_build_array(jsonb_build_object('from', 'guest', 'type', 'image', 'text', 'ID photo', 'caption', 'ID photo for check-in',
      'name', coalesce(nullif(public.guest__clip(x->'name', 80), ''), 'id-photo.jpg'), 'url', x->>'url', 'time', v_now, 'via', 'guestapp', 'idPhoto', true));
    update records set data = c.o_data || jsonb_build_object('messages', mine, 'unread', coalesce(nullif(public.guest__num(c.o_data->'unread'), 0), 0) + 1), updated_by = null
     where org_id = f.o_org and coll = 'conversations' and id = c.o_id;
    b := b || jsonb_build_object('idSubmittedAt', v_now);
    update records set data = b, updated_by = null where org_id = f.o_org and coll = 'bookings' and id = f.o_id;
    return '{"ok":true}'::jsonb;

  elsif act = 'message' then
    t := public.guest__clip(a->'text', 1000);
    if t = '' then return public.guest__err('invalid'); end if;
    select * into c from public.guest__chat(f.o_org, f.o_id, v_now, true);
    select count(*), count(*) filter (where coalesce(m->>'time', '') >= public.guest__addmin(v_now, -60)) into n, i
      from jsonb_array_elements(c.o_data->'messages') m where jsonb_typeof(m) = 'object' and m->>'from' = 'guest' and m->>'via' = 'guestapp' and coalesce(m->'idPhoto' <> 'true'::jsonb, true);
    if n >= 200 or i >= 20 then return public.guest__err('too_many'); end if;
    update records set data = c.o_data || jsonb_build_object(
        'messages', (c.o_data->'messages') || jsonb_build_array(jsonb_build_object('from', 'guest', 'type', 'text', 'text', t, 'time', v_now, 'via', 'guestapp')),
        'unread', coalesce(nullif(public.guest__num(c.o_data->'unread'), 0), 0) + 1), updated_by = null
     where org_id = f.o_org and coll = 'conversations' and id = c.o_id;
    return '{"ok":true}'::jsonb;

  elsif act = 'request' then
    if not during then return public.guest__err('not_now'); end if;
    select sv.v into svc from jsonb_array_elements(case when jsonb_typeof(g->'services') = 'array' then g->'services' else default_services end) sv(v)
      where jsonb_typeof(sv.v) = 'object' and jsonb_typeof(sv.v->'id') = 'string' and jsonb_typeof(a->'type') = 'string' and sv.v->>'id' = a->>'type' and coalesce(sv.v->'on' <> 'false'::jsonb, true) limit 1;
    if svc is null then return public.guest__err('invalid'); end if;
    select count(*) into n from records r where r.org_id = f.o_org and r.coll = 'guestRequests' and not r.deleted and r.data->>'bookingId' = f.o_id;
    if n >= 20 then return public.guest__err('too_many'); end if;
    if svc->>'id' = 'late' and exists (select 1 from records r where r.org_id = f.o_org and r.coll = 'guestRequests' and not r.deleted and r.data->>'bookingId' = f.o_id and r.data->>'type' = 'late' and r.data->>'status' is distinct from 'declined') then
      return public.guest__err('duplicate');
    end if;
    select coalesce(jsonb_object_agg(q.k, public.guest__clip(q.v, 160)), '{}') into vals from (
      select e.key k, e.value v from jsonb_each(case when jsonb_typeof(a->'vals') = 'object' then a->'vals' else '{}'::jsonb end) e where e.key ~ '^[a-z]{1,20}$' limit 12) q;
    summary := coalesce(nullif(public.guest__clip(a->'summary', 300), ''), coalesce(nullif(svc->>'name', ''), svc->>'id'));
    note := nullif(public.guest__clip(a->'note', 300), '');
    rid := public.guest__uid('GR');
    insert into records (org_id, coll, id, data, updated_by) values (f.o_org, 'guestRequests', rid,
      jsonb_build_object('id', rid, 'bookingId', f.o_id, 'type', svc->>'id', 'summary', summary, 'vals', vals, 'note', note, 'status', 'new', 'at', v_now), null);
    perform public.guest__note(f.o_org, f.o_id, 'Guest app request: ' || coalesce(nullif(svc->>'name', ''), svc->>'id') || ' (' || summary || ')', v_now);
    return jsonb_build_object('ok', true, 'id', rid);

  elsif act = 'codehelp' then
    if not (s->>'visible')::boolean then return public.guest__err('not_now'); end if;
    if exists (select 1 from records r where r.org_id = f.o_org and r.coll = 'guestRequests' and not r.deleted and r.data->>'bookingId' = f.o_id and r.data->>'type' = 'code' and r.data->>'status' = 'new') then
      return '{"ok":true}'::jsonb;
    end if;
    code := b->>'doorCode'; rid := public.guest__uid('GR');
    insert into records (org_id, coll, id, data, updated_by) values (f.o_org, 'guestRequests', rid,
      jsonb_build_object('id', rid, 'bookingId', f.o_id, 'type', 'code', 'summary', 'Guest says code ' || code || ' is not opening the door', 'code', code, 'status', 'new', 'at', v_now), null);
    perform public.guest__note(f.o_org, f.o_id, 'Guest app: door code ' || code || ' reported as not working.', v_now);
    return jsonb_build_object('ok', true, 'id', rid);

  elsif act = 'report' then
    if not active then return public.guest__err('not_now'); end if;
    select count(*) into n from records r where r.org_id = f.o_org and r.coll = 'damageReports' and not r.deleted and r.data->>'bookingId' = f.o_id;
    if n >= 10 then return public.guest__err('too_many'); end if;
    item := public.guest__clip(a->'item', 80); descr := public.guest__clip(a->'desc', 600);
    v_when := case when a->>'when' = 'arrival' and jsonb_typeof(a->'when') = 'string' then 'arrival' else 'stay' end;
    if item = '' or char_length(descr) < 3 then return public.guest__err('invalid'); end if;
    photos := '[]';
    if jsonb_typeof(a->'photos') = 'array' then
      if jsonb_array_length(a->'photos') > 3 then return public.guest__err('invalid_photo'); end if;
      for x in select pe.v from jsonb_array_elements(a->'photos') with ordinality pe(v, k) order by pe.k loop
        if jsonb_typeof(x) <> 'object' or coalesce(jsonb_typeof(x->'url'), '') <> 'string' or char_length(x->>'url') > 160000
           or (x->>'url') !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
          return public.guest__err('invalid_photo');
        end if;
        photos := photos || jsonb_build_array(jsonb_build_object('name', coalesce(nullif(public.guest__clip(x->'name', 80), ''), 'photo.jpg'), 'url', x->>'url'));
      end loop;
    end if;
    room := coalesce(nullif(public.guest__clip(a->'room', 40), ''), 'Other');
    urgent := v_when = 'stay' and coalesce(a->'urgent' = 'true'::jsonb, false);
    rid := public.guest__uid('DR');
    insert into records (org_id, coll, id, data, updated_by) values (f.o_org, 'damageReports', rid,
      jsonb_build_object('id', rid, 'bookingId', f.o_id, 'propertyId', b->'propertyId', 'guest', public.guest__or(b->'guest'->'name', '"Guest"'), 'room', room,
        'item', item, 'desc', descr, 'when', v_when, 'urgent', urgent, 'photos', photos, 'at', v_now, 'taskId', null), null);
    n := jsonb_array_length(photos);
    perform public.guest__note(f.o_org, f.o_id, 'Guest app: problem reported, "' || item || '" (' || room || ')' || case when urgent then ', marked urgent' else '' end ||
      ', with ' || n || ' photo' || case when n = 1 then '' else 's' end || '.', v_now);
    return jsonb_build_object('ok', true, 'id', rid);

  elsif act = 'feedback' then
    if st not in ('checkout', 'past') then return public.guest__err('not_now'); end if;
    stars := case when jsonb_typeof(a->'stars') = 'number' then (a->>'stars')::numeric end;
    if stars is null or stars <> trunc(stars) or stars < 1 or stars > 5 then return public.guest__err('invalid'); end if;
    ftext := public.guest__clip(a->'text', 1000);
    b := b || jsonb_build_object('guestFeedback', jsonb_build_object('stars', stars::int, 'text', ftext, 'at', v_now));
    update records set data = b, updated_by = null where org_id = f.o_org and coll = 'bookings' and id = f.o_id;
    perform public.guest__note(f.o_org, f.o_id, 'Guest app feedback: ' || stars::int || ' out of 5' || case when ftext <> '' then '. "' || ftext || '"' else '.' end, v_now);
    return '{"ok":true}'::jsonb;
  end if;

  return public.guest__err('unknown_action');
end $$;

-- same grants as 0003: helpers stay closed to the API roles
do $$
declare fn text;
begin
  foreach fn in array array['guest__stay(jsonb, jsonb, text)', 'guest__with_ci(uuid, jsonb)', 'guest__payload(uuid, text, jsonb)'] loop
    execute format('revoke all on function public.%s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function public.%s from anon', fn); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function public.%s from authenticated', fn); end if;
  end loop;
end $$;

revoke all on function public.guest_act(text, text, jsonb) from public;
grant execute on function public.guest_act(text, text, jsonb) to anon, authenticated;
