-- Orbique PMS guest app: the two functions a guest's own app calls. Guests never sign in: the booking's link token
-- (records.data->>'guestToken') is the key. guest_get returns only what that one guest may see; guest_act records
-- what they do (online check-in, ID upload, messages, requests, problem reports, feedback).
-- This mirrors app/pages/guestapp.js (stayInfo, buildPayload, localAct) exactly; the contract is in
-- docs/notes/v4-guestapp.md. Re-runnable: everything is create or replace.

-- ---------- small helpers (not callable by clients) ----------

-- Malaysia time as 'YYYY-MM-DDTHH:MI'. Tests may pin it with: set orbique.guest_now = '2026-10-06T10:15'
-- (only honoured outside the API login, so a guest can never move the clock).
create or replace function public.guest__now() returns text
language plpgsql stable set search_path = public as $$
declare v text := current_setting('orbique.guest_now', true);
begin
  if v ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' and session_user not in ('authenticator', 'anon', 'authenticated') then return v; end if;
  return to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD"T"HH24:MI');
end $$;

-- JavaScript truthiness of a JSON value (missing, null, false, 0 and '' are false)
create or replace function public.guest__truthy(v jsonb) returns boolean
language sql immutable set search_path = public as $$
  select case coalesce(jsonb_typeof(v), 'null')
    when 'null' then false when 'boolean' then v = 'true'::jsonb when 'number' then (v #>> '{}')::numeric <> 0
    when 'string' then (v #>> '{}') <> '' else true end;
$$;

-- v || dflt (JavaScript)
create or replace function public.guest__or(v jsonb, dflt jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case when public.guest__truthy(v) then v else dflt end;
$$;

-- +v in JavaScript for numbers and numeric strings, else null
create or replace function public.guest__num(v jsonb) returns numeric
language sql immutable set search_path = public as $$
  select case jsonb_typeof(v) when 'number' then (v #>> '{}')::numeric
    when 'string' then case when (v #>> '{}') ~ '^\s*-?\d+(\.\d+)?\s*$' then btrim(v #>> '{}')::numeric end end;
$$;

-- text of a JSON value, control characters removed, trimmed, at most n characters (clip() in guestapp.js)
create or replace function public.guest__clip(v jsonb, n int) returns text
language sql immutable set search_path = public as $$
  select left(btrim(regexp_replace(
    case when v is null or jsonb_typeof(v) = 'null' then '' when jsonb_typeof(v) = 'string' then v #>> '{}' else v::text end,
    E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]', '', 'g'), E' \t\n\r'), n);
$$;

-- 'HH:MM' -> '3:00 PM' (fmt.time)
create or replace function public.guest__time(t text) returns text
language sql immutable set search_path = public as $$
  select to_char(('2000-01-01 ' || t)::timestamp, 'FMHH12:MI AM');
$$;

-- 'YYYY-MM-DDTHH:MI' + minutes
create or replace function public.guest__addmin(iso text, mins int) returns text
language sql immutable set search_path = public as $$
  select to_char(replace(iso, 'T', ' ')::timestamp + make_interval(mins => mins), 'YYYY-MM-DD"T"HH24:MI');
$$;

-- a new record id like O.uid(): 'GR-' + base36(epoch ms) + 4 random base36 characters, upper case
create or replace function public.guest__uid(p_prefix text) returns text
language plpgsql volatile set search_path = public as $$
declare
  n bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  dg constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  s text := '';
  r bytea := uuid_send(gen_random_uuid());
  i int;
begin
  while n > 0 loop s := substr(dg, (n % 36)::int + 1, 1) || s; n := n / 36; end loop;
  for i in 0..3 loop s := s || substr(dg, get_byte(r, i) % 36 + 1, 1); end loop;
  return p_prefix || '-' || upper(s);
end $$;

-- the guest app settings blob (blobs.data = {"v": value}); {} when the workspace never saved them
create or replace function public.guest__cfg(p_org uuid) returns jsonb
language sql stable set search_path = public as $$
  select coalesce((select case when jsonb_typeof(b.data->'v') = 'object' then b.data->'v' end from blobs b where b.org_id = p_org and b.key = 'guestApp'), '{}'::jsonb);
$$;

create or replace function public.guest__on(g jsonb, k text) returns boolean
language sql immutable set search_path = public as $$
  select not coalesce(g->k = 'false'::jsonb, false);
$$;

create or replace function public.guest__lead(g jsonb) returns int
language sql immutable set search_path = public as $$
  -- parseInt(): numbers are truncated, strings use their leading digits, anything else is 0; then 0 to 12
  select greatest(0, least(12, coalesce(case jsonb_typeof(g->'codeLeadHours')
    when 'number' then trunc(greatest(-1000, least(1000, (g->>'codeLeadHours')::numeric)))
    when 'string' then substring(g->>'codeLeadHours' from '^\s*([+-]?\d{1,6})')::numeric end, 0)))::int;
$$;

-- the stage of a stay and the door-code rule (stayInfo in guestapp.js). Null when the booking dates are unusable.
create or replace function public.guest__stay(b jsonb, g jsonb, p_now text) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  ci text := b->>'checkIn'; co text := b->>'checkOut'; today text := left(p_now, 10);
  ci_t text := case when b->>'checkInTime' ~ '^([01]\d|2[0-3]):[0-5]\d$' then b->>'checkInTime' else '15:00' end;
  co_t text := case when b->>'checkOutTime' ~ '^([01]\d|2[0-3]):[0-5]\d$' then b->>'checkOutTime' else '11:00' end;
  ci_at text; co_at text; reveal text; st text; done boolean; id_ok boolean; waiting text[] := '{}';
begin
  if ci !~ '^\d{4}-\d{2}-\d{2}$' or co !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  begin perform ci::date, co::date; exception when others then return null; end;
  ci_at := ci || 'T' || ci_t; co_at := co || 'T' || co_t;
  reveal := public.guest__addmin(ci_at, -public.guest__lead(g) * 60);
  if reveal < ci || 'T00:00' then reveal := ci || 'T00:00'; end if;
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
  return jsonb_build_object('state', st, 'ciTime', ci_t, 'coTime', co_t, 'ciAt', ci_at, 'coAt', co_at, 'revealAt', reveal,
    'checkinDone', done, 'idVerified', id_ok, 'waiting', to_jsonb(waiting), 'visible', cardinality(waiting) = 0);
end $$;

-- operator branding shown to the guest
create or replace function public.guest__brand(p_org uuid, p_org_name text) returns jsonb
language sql stable set search_path = public as $$
  with wb as (select coalesce((select case when jsonb_typeof(b.data->'v') = 'object' then b.data->'v' end from blobs b where b.org_id = p_org and b.key = 'workspaceBrand'), '{}'::jsonb) as v)
  select jsonb_build_object(
    'name', coalesce(public.guest__or(wb.v->'name', null), to_jsonb(nullif(p_org_name, '')), '"Your host"'::jsonb),
    'logo', public.guest__or(wb.v->'logo', null),
    'primary', public.guest__or(wb.v->'brand'->'primary', null),
    'accent', public.guest__or(wb.v->'brand'->'accent', null))
  from wb;
$$;

-- the booking's conversation (the first by id), created when p_create and there is none
create or replace function public.guest__chat(p_org uuid, p_bid text, p_now text, p_create boolean, out o_id text, out o_data jsonb)
language plpgsql set search_path = public as $$
begin
  select r.id, r.data into o_id, o_data from records r
   where r.org_id = p_org and r.coll = 'conversations' and not r.deleted and r.data->>'bookingId' = p_bid
   order by r.id collate "C" limit 1;
  if o_id is null and p_create then
    o_id := public.guest__uid('C');
    o_data := jsonb_build_object('id', o_id, 'bookingId', p_bid, 'unread', 0, 'messages', '[]'::jsonb, 'createdAt', p_now);
    insert into records (org_id, coll, id, data, updated_by) values (p_org, 'conversations', o_id, o_data, null);
  end if;
  if o_data is not null and coalesce(jsonb_typeof(o_data->'messages'), '') <> 'array' then o_data := jsonb_set(o_data, '{messages}', '[]'::jsonb); end if;
end $$;

-- a note for the team in the booking's chat (at most 100 guest app notes per stay)
create or replace function public.guest__note(p_org uuid, p_bid text, p_text text, p_now text) returns void
language plpgsql set search_path = public as $$
declare c record; n int;
begin
  select * into c from public.guest__chat(p_org, p_bid, p_now, true);
  select count(*) into n from jsonb_array_elements(c.o_data->'messages') m
   where jsonb_typeof(m) = 'object' and m->>'from' = 'system' and coalesce(m->>'text', '') like 'Guest app%';
  if n >= 100 then return; end if;
  update records set data = jsonb_set(c.o_data, '{messages}', (c.o_data->'messages') || jsonb_build_array(jsonb_build_object('from', 'system', 'text', p_text, 'time', p_now))), updated_by = null
   where org_id = p_org and coll = 'conversations' and id = c.o_id;
end $$;

create or replace function public.guest__err(p_code text) returns jsonb
language sql immutable set search_path = public as $$ select jsonb_build_object('ok', false, 'error', p_code); $$;

-- the booking a token opens: exactly one live booking, else nothing (never guess between two stays)
create or replace function public.guest__find(p_token text, p_lock boolean, out o_org uuid, out o_id text, out o_data jsonb)
language plpgsql set search_path = public as $$
declare n int;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_.~-]{4,80}$' then return; end if;
  select count(*) into n from records r where r.coll = 'bookings' and r.data->>'guestToken' = p_token and not r.deleted;
  if n <> 1 then return; end if;
  if p_lock then
    select r.org_id, r.id, r.data into o_org, o_id, o_data from records r where r.coll = 'bookings' and r.data->>'guestToken' = p_token and not r.deleted for update;
  else
    select r.org_id, r.id, r.data into o_org, o_id, o_data from records r where r.coll = 'bookings' and r.data->>'guestToken' = p_token and not r.deleted;
  end if;
end $$;

-- the guest's payload (buildPayload in guestapp.js)
create or replace function public.guest__payload(p_org uuid, p_bid text, b jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  o record; g jsonb := public.guest__cfg(p_org); v_now text := public.guest__now(); s jsonb; st text; brand jsonb;
  p jsonb; pid text := b->>'propertyId'; conv jsonb; w jsonb; wifi jsonb; ph jsonb; gc jsonb; ra jsonb;
  active boolean; app jsonb; ws_phone text; c jsonb;
  default_services constant jsonb := '[{"id":"towels","name":"Extra towels and linen"},{"id":"late","name":"Late check-out"},{"id":"early","name":"Early check-in"},{"id":"transfer","name":"Airport transfer"},{"id":"clean","name":"Mid-stay clean"},{"id":"sim","name":"Tourist SIM card"},{"id":"car","name":"Car rental"},{"id":"tng","name":"Touch ''n Go card"}]';
begin
  select name, status into o from orgs where id = p_org;
  s := public.guest__stay(b, g, v_now);
  if s is null then return public.guest__err('not_found'); end if;
  st := s->>'state';
  brand := public.guest__brand(p_org, o.name);
  if st = 'expired' then return jsonb_build_object('ok', false, 'error', 'expired', 'brand', brand); end if;
  active := st in ('arrival', 'inhouse', 'checkout');

  select r.data into p from records r where r.org_id = p_org and r.coll = 'properties' and r.id = pid and not r.deleted;
  if p is not null then
    w := p->'wifi';
    wifi := case jsonb_typeof(w)
      when 'array' then jsonb_build_object('name', w->0, 'password', w->1)
      when 'object' then jsonb_build_object('name', w->'name', 'password', case when coalesce(jsonb_typeof(w->'password'), 'null') <> 'null' then w->'password' else w->'pass' end)
      else case when public.guest__truthy(p->'wifiName') or public.guest__truthy(p->'wifiPassword') then jsonb_build_object('name', p->'wifiName', 'password', p->'wifiPassword') end end;
    ph := case jsonb_typeof(p->'photos'->0) when 'string' then p->'photos'->0 when 'object' then p->'photos'->0->'url' end;
    p := jsonb_build_object('name', p->'name', 'area', public.guest__or(p->'area', '""'), 'address', public.guest__or(p->'address', '""'),
      'type', public.guest__or(p->'type', '""'), 'beds', p->'beds', 'parking', public.guest__or(p->'parking', '""'),
      'lockBrand', public.guest__or(p->'lockBrand', '""'), 'photo', ph, 'wifi', case when active then wifi end);
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

-- ---------- the two functions the guest app calls ----------

create or replace function public.guest_get(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f record;
begin
  select * into f from public.guest__find(p_token, false);
  if f.o_id is null then return public.guest__err('not_found'); end if;
  return public.guest__payload(f.o_org, f.o_id, f.o_data);
end $$;

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
  g := public.guest__cfg(f.o_org); v_now := public.guest__now(); s := public.guest__stay(b, g, v_now);
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

-- ---------- who may call what ----------
-- only the two entry points are callable by the API roles; the helpers run inside them as the owner
do $$
declare fn text;
begin
  foreach fn in array array[
    'guest__now()', 'guest__truthy(jsonb)', 'guest__or(jsonb, jsonb)', 'guest__num(jsonb)', 'guest__clip(jsonb, int)', 'guest__time(text)',
    'guest__addmin(text, int)', 'guest__uid(text)', 'guest__cfg(uuid)', 'guest__on(jsonb, text)', 'guest__lead(jsonb)', 'guest__stay(jsonb, jsonb, text)',
    'guest__brand(uuid, text)', 'guest__chat(uuid, text, text, boolean)', 'guest__note(uuid, text, text, text)', 'guest__err(text)',
    'guest__find(text, boolean)', 'guest__payload(uuid, text, jsonb)']
  loop
    execute format('revoke all on function public.%s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function public.%s from anon', fn); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function public.%s from authenticated', fn); end if;
  end loop;
end $$;

revoke all on function public.guest_get(text) from public;
revoke all on function public.guest_act(text, text, jsonb) from public;
grant execute on function public.guest_get(text) to anon, authenticated;
grant execute on function public.guest_act(text, text, jsonb) to anon, authenticated;
