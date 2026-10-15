-- 0006: Channex channel manager, schema and change detection (plan section 3).
--
-- What is here:
--   * mapping tables (group, property per building, room type per unit type, rate plan), each with env
--     ('staging' or 'production') so moving to production never mixes Channex ids
--   * channex_outbox: late-binding change marks (keys and dates, never values; the worker computes values at send time)
--   * setup queue, last values Channex accepted (state), call log, inbound events / revisions / bookings, alerts, meta
--   * AFTER triggers on public.records that write the marks, channex_type_availability() (plan 2.2),
--     channex_take_slot() (rate limiter) and channex_claim() (per-property lease)
--   * reset_org() refuses while a building is connected
--
-- Who can do what: the server (service role) writes everything. Signed-in members read their own workspace's rows of
-- the mapping tables, state, calls, alerts and outbox, and may only mark an alert resolved. Events, revisions, bookings,
-- the setup queue and meta are server-only. anon gets nothing.
--
-- Safe to re-run: if not exists / create or replace / drop ... if exists everywhere; no data is changed.

-- ---------- mapping (written by the service role only) ----------

create table if not exists public.channex_groups (
  org_id uuid not null references public.orgs on delete cascade,
  env text not null check (env in ('staging', 'production')),
  group_id uuid not null unique,
  created_at timestamptz not null default now(),
  primary key (org_id, env)
);

-- One Channex property per Orbique building
create table if not exists public.channex_properties (
  org_id uuid not null references public.orgs on delete cascade,
  env text not null check (env in ('staging', 'production')),
  building_id text not null,
  channex_property_id uuid not null unique,
  currency text not null,
  status text not null default 'setup' check (status in ('setup', 'syncing', 'live', 'paused', 'error', 'disconnected')),
  full_sync_requested_at timestamptz,
  full_sync_at timestamptz,
  full_sync_task_ids jsonb,
  paused_until timestamptz,
  backoff_level int not null default 0,
  lease_until timestamptz,
  channels jsonb,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, env, building_id)
);

-- One Channex room type per Orbique unit type
create table if not exists public.channex_room_types (
  org_id uuid not null references public.orgs on delete cascade,
  env text not null check (env in ('staging', 'production')),
  unit_type_id text not null,
  channex_property_id uuid not null references public.channex_properties (channex_property_id) on delete cascade,
  room_type_id uuid unique,
  count_of_rooms int,
  synced_hash text,
  retired boolean not null default false,
  primary key (org_id, env, unit_type_id)
);

create table if not exists public.channex_rate_plans (
  org_id uuid not null references public.orgs on delete cascade,
  env text not null check (env in ('staging', 'production')),
  plan_id text not null,
  unit_type_id text not null,
  rate_plan_id uuid unique,
  synced_hash text,
  retired boolean not null default false,
  primary key (org_id, env, plan_id)
);

-- ---------- outbox: late-binding marks (values are computed at send time) ----------
-- Protocol for the worker (api/channex-worker.js):
--   1. claim:  update channex_outbox set claimed_at = now() where channex_property_id = $1 and kind = $2
--              and claimed_at is null and created_at < now() - quiet returning id, target_id, date_from, date_to
--      (commit this before computing values)
--   2. compute the values from records, send them
--   3. success: delete from channex_outbox where id = any(<claimed ids>)
--      failure: update channex_outbox set claimed_at = null where id = any(<claimed ids>) (or leave them; rows
--      claimed longer than the lease ago may be claimed again)
-- The triggers only skip a new mark when an unclaimed mark already covers it, and they lock that mark FOR SHARE, so a
-- worker claim waits for the writer to commit. A change can therefore never hide behind a mark the worker has already
-- read values for.
create table if not exists public.channex_outbox (
  id bigserial primary key,
  org_id uuid not null references public.orgs on delete cascade,
  channex_property_id uuid not null,
  kind text not null check (kind in ('availability', 'restrictions')),
  target_id text not null, -- unit_type_id (availability) or plan_id (restrictions)
  date_from date not null,
  date_to date not null,
  reason text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  check (date_from <= date_to)
);
create index if not exists channex_outbox_prop_kind_idx on public.channex_outbox (channex_property_id, kind, id);
create index if not exists channex_outbox_org_idx on public.channex_outbox (org_id);

-- Setup work for the worker: kind says what to create or update, ref is the Orbique record id
create table if not exists public.channex_setup_queue (
  id bigserial primary key,
  org_id uuid not null references public.orgs on delete cascade,
  kind text not null check (kind in ('building_update', 'unit_type_create', 'unit_type_update', 'rate_plan_create', 'rate_plan_update', 'room_count')),
  ref text not null,
  created_at timestamptz not null default now()
);
create index if not exists channex_setup_queue_org_idx on public.channex_setup_queue (org_id, kind, ref);

-- ---------- last values Channex accepted (delta diff, and "what channels have") ----------
create table if not exists public.channex_state (
  org_id uuid not null references public.orgs on delete cascade,
  channex_property_id uuid not null,
  kind text not null check (kind in ('availability', 'restrictions')),
  target_id text not null,
  date date not null,
  value jsonb,
  sent_at timestamptz,
  call_id bigint,
  primary key (channex_property_id, kind, target_id, date)
);
create index if not exists channex_state_org_idx on public.channex_state (org_id);

-- ---------- call log: sync log in the UI, rate-limit counter, certification task ids ----------
create table if not exists public.channex_calls (
  id bigserial primary key,
  org_id uuid references public.orgs on delete cascade,
  channex_property_id uuid,
  endpoint text,
  method text,
  source text check (source in ('delta', 'full', 'setup', 'booking', 'ack', 'feed', 'iframe', 'channels')),
  item_count int,
  payload jsonb,
  http_status int,
  task_ids jsonb,
  warnings jsonb,
  error text,
  at timestamptz not null default now(),
  duration_ms int,
  by_user uuid
);
create index if not exists channex_calls_prop_endpoint_at_idx on public.channex_calls (channex_property_id, endpoint, at);
create index if not exists channex_calls_org_at_idx on public.channex_calls (org_id, at desc);
create index if not exists channex_calls_at_idx on public.channex_calls (at);

-- ---------- inbound ----------
create table if not exists public.channex_events (
  id bigserial primary key,
  body_sha256 text unique,
  event text,
  channex_property_id uuid,
  revision_id uuid,
  booking_id uuid,
  payload jsonb,
  status text not null default 'new',
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists channex_events_status_idx on public.channex_events (status, received_at);

create table if not exists public.channex_revisions (
  revision_id uuid primary key,
  booking_id uuid,
  org_id uuid,
  status text,
  inserted_at timestamptz,
  saved_at timestamptz,
  acked_at timestamptz,
  ack_error text,
  raw jsonb -- payment guarantee (card data) stripped before it is stored
);
create index if not exists channex_revisions_unacked_idx on public.channex_revisions (saved_at) where acked_at is null;

create table if not exists public.channex_bookings (
  booking_id uuid primary key,
  org_id uuid not null references public.orgs on delete cascade,
  record_ids text[] not null,
  last_revision_id uuid,
  last_inserted_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.channex_alerts (
  id bigserial primary key,
  org_id uuid not null references public.orgs on delete cascade,
  kind text check (kind in ('double_booking', 'needs_unit', 'unmapped_room', 'unmapped_rate', 'sync_error', 'rate_warning', 'non_acked', 'channel_disconnected')),
  message text,
  ref jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create index if not exists channex_alerts_open_idx on public.channex_alerts (org_id) where resolved_at is null;

create table if not exists public.channex_meta (
  id int primary key default 1 check (id = 1),
  last_feed_poll_at timestamptz,
  webhook_id uuid
);
insert into public.channex_meta (id) values (1) on conflict (id) do nothing;

-- ---------- row level security and grants ----------
alter table public.channex_groups enable row level security;
alter table public.channex_properties enable row level security;
alter table public.channex_room_types enable row level security;
alter table public.channex_rate_plans enable row level security;
alter table public.channex_outbox enable row level security;
alter table public.channex_setup_queue enable row level security;
alter table public.channex_state enable row level security;
alter table public.channex_calls enable row level security;
alter table public.channex_events enable row level security;
alter table public.channex_revisions enable row level security;
alter table public.channex_bookings enable row level security;
alter table public.channex_alerts enable row level security;
alter table public.channex_meta enable row level security;

-- members read their own workspace's rows
do $$
declare t text;
begin
  foreach t in array array['channex_groups', 'channex_properties', 'channex_room_types', 'channex_rate_plans',
                           'channex_state', 'channex_calls', 'channex_alerts', 'channex_outbox'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member(org_id))', t || '_read', t);
  end loop;
end $$;

-- members who can write in the workspace may resolve an alert (only resolved_at / resolved_by, see the column grant)
drop policy if exists channex_alerts_resolve on public.channex_alerts;
create policy channex_alerts_resolve on public.channex_alerts for update to authenticated
  using (public.can_write(org_id))
  with check (public.can_write(org_id) and (resolved_by is null or resolved_by = (select auth.uid())));

-- Supabase grants every new table in public to anon and authenticated by default; take that back, then grant
-- exactly what the policies above are for. The private tables get no policy and no grant.
do $$
declare t text;
begin
  foreach t in array array['channex_groups', 'channex_properties', 'channex_room_types', 'channex_rate_plans', 'channex_outbox',
                           'channex_setup_queue', 'channex_state', 'channex_calls', 'channex_events', 'channex_revisions',
                           'channex_bookings', 'channex_alerts', 'channex_meta'] loop
    execute format('revoke all on public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on public.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on public.%I from authenticated', t); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on public.%I to service_role', t); end if;
  end loop;
  foreach t in array array['channex_outbox_id_seq', 'channex_setup_queue_id_seq', 'channex_calls_id_seq', 'channex_events_id_seq', 'channex_alerts_id_seq'] loop
    execute format('revoke all on sequence public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on sequence public.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on sequence public.%I from authenticated', t); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant usage, select on sequence public.%I to service_role', t); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.channex_groups, public.channex_properties, public.channex_room_types, public.channex_rate_plans,
                    public.channex_state, public.channex_calls, public.channex_alerts, public.channex_outbox to authenticated;
    grant update (resolved_at, resolved_by) on public.channex_alerts to authenticated;
  end if;
end $$;

-- realtime: the Channels page follows connection status, alerts and the pending count
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.channex_properties; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.channex_alerts; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.channex_outbox; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------- helpers (not callable by clients) ----------

-- Statuses in which a building counts as connected: changes are marked (paused and error keep marks building up so
-- resume / retry sends them) and reset_org() refuses.
create or replace function public.channex__connected(p_status text) returns boolean
language sql immutable set search_path = '' as $$
  select p_status in ('syncing', 'live', 'paused', 'error');
$$;

-- Today in Malaysia. Tests may pin it with: set orbique.channex_today = '2026-11-01' (only honoured outside the API
-- logins, like guest__now).
create or replace function public.channex__today() returns date
language plpgsql stable set search_path = '' as $$
declare v text := current_setting('orbique.channex_today', true);
begin
  if v ~ '^\d{4}-\d{2}-\d{2}$' and session_user not in ('authenticator', 'anon', 'authenticated') then return v::date; end if;
  return (now() at time zone 'Asia/Kuala_Lumpur')::date;
end $$;

-- 'YYYY-MM-DD' -> date; null for anything else (never raises, so a bad record cannot block a save)
create or replace function public.channex__date(p text) returns date
language sql immutable set search_path = '' as $$
  select case when p ~ '^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'
               and substr(p, 9, 2)::int <= extract(day from (make_date(substr(p, 1, 4)::int, substr(p, 6, 2)::int, 1) + interval '1 month - 1 day'))::int
              then p::date end;
$$;

create or replace function public.channex__archived(d jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(d->'archived' = 'true'::jsonb, false) or coalesce(d->>'status' = 'archived', false);
$$;

-- The Channex property id of a connected building, for the env the API set (set orbique.channex_env = 'staging'),
-- else the newest connected row.
create or replace function public.channex__live_property(p_org uuid, p_building text) returns uuid
language sql stable set search_path = '' as $$
  select p.channex_property_id from public.channex_properties p
   where p.org_id = p_org and p.building_id = p_building and public.channex__connected(p.status)
     and (nullif(current_setting('orbique.channex_env', true), '') is null or p.env = current_setting('orbique.channex_env', true))
   order by p.created_at desc limit 1;
$$;

-- The connected Channex property a unit type belongs to: through the type's building, else through the room type
-- mapping (a deleted type record has no building left).
create or replace function public.channex__type_property(p_org uuid, p_type text) returns uuid
language sql stable set search_path = '' as $$
  select coalesce(
    (select public.channex__live_property(p_org, r.data->>'buildingId') from public.records r
      where r.org_id = p_org and r.coll = 'unitTypes' and r.id = p_type and not r.deleted),
    (select m.channex_property_id from public.channex_room_types m join public.channex_properties p on p.channex_property_id = m.channex_property_id
      where m.org_id = p_org and m.unit_type_id = p_type and public.channex__connected(p.status)
        and (nullif(current_setting('orbique.channex_env', true), '') is null or m.env = current_setting('orbique.channex_env', true))
      order by p.created_at desc limit 1));
$$;

-- The unit type of a unit (properties record), null when untagged or missing
create or replace function public.channex__unit_type(p_org uuid, p_unit text) returns text
language sql stable set search_path = '' as $$
  select nullif(r.data->>'unitTypeId', '') from public.records r
   where r.org_id = p_org and r.coll = 'properties' and r.id = p_unit and not r.deleted;
$$;

-- The unit type of a rate plan
create or replace function public.channex__plan_type(p_org uuid, p_plan text) returns text
language sql stable set search_path = '' as $$
  select nullif(r.data->>'unitTypeId', '') from public.records r
   where r.org_id = p_org and r.coll = 'ratePlans' and r.id = p_plan and not r.deleted;
$$;

-- Add one mark, clipped to [today, today + 499]. Skipped when an unclaimed mark already covers it (that mark is locked
-- FOR SHARE until this transaction ends, so the worker cannot claim it in between).
create or replace function public.channex__mark(p_org uuid, p_prop uuid, p_kind text, p_target text, p_from date, p_to date, p_reason text)
returns void language plpgsql set search_path = '' as $$
declare t0 date := public.channex__today(); a date; b date; hit bigint;
begin
  if p_prop is null or p_target is null or p_target = '' or p_from is null or p_to is null then return; end if;
  a := greatest(p_from, t0); b := least(p_to, t0 + 499);
  if a > b then return; end if;
  select o.id into hit from public.channex_outbox o
   where o.channex_property_id = p_prop and o.kind = p_kind and o.target_id = p_target
     and o.date_from <= a and o.date_to >= b and o.claimed_at is null
   limit 1 for share;
  if hit is not null then return; end if;
  insert into public.channex_outbox (org_id, channex_property_id, kind, target_id, date_from, date_to, reason)
  values (p_org, p_prop, p_kind, p_target, a, b, p_reason);
end $$;

create or replace function public.channex__mark_type(p_org uuid, p_type text, p_from date, p_to date, p_reason text)
returns void language plpgsql set search_path = '' as $$
begin
  if p_type is null or p_type = '' then return; end if;
  perform public.channex__mark(p_org, public.channex__type_property(p_org, p_type), 'availability', p_type, p_from, p_to, p_reason);
end $$;

-- Restriction marks for a plan: every date whose value differs between o_days and n_days, as runs of consecutive dates
create or replace function public.channex__mark_days(p_org uuid, p_plan text, p_type text, o_days jsonb, n_days jsonb, p_reason text)
returns void language plpgsql set search_path = '' as $$
declare v_prop uuid; r record;
begin
  if p_plan is null or p_plan = '' then return; end if;
  v_prop := public.channex__type_property(p_org, coalesce(nullif(p_type, ''), public.channex__plan_type(p_org, p_plan)));
  if v_prop is null then return; end if;
  if jsonb_typeof(o_days) is distinct from 'object' then o_days := '{}'::jsonb; end if;
  if jsonb_typeof(n_days) is distinct from 'object' then n_days := '{}'::jsonb; end if;
  for r in
    with k as (
      select distinct public.channex__date(x.k) as d from (
        select jsonb_object_keys(o_days) as k union select jsonb_object_keys(n_days)) x
       where (o_days->x.k) is distinct from (n_days->x.k)),
    g as (select d, d - (row_number() over (order by d))::int as grp from k where d is not null)
    select min(d) as a, max(d) as b from g group by grp order by 1
  loop
    perform public.channex__mark(p_org, v_prop, 'restrictions', p_plan, r.a, r.b, p_reason);
  end loop;
end $$;

create or replace function public.channex__queue(p_org uuid, p_kind text, p_ref text) returns void
language plpgsql set search_path = '' as $$
begin
  if p_ref is null or p_ref = '' then return; end if;
  if exists (select 1 from public.channex_setup_queue q where q.org_id = p_org and q.kind = p_kind and q.ref = p_ref) then return; end if;
  insert into public.channex_setup_queue (org_id, kind, ref) values (p_org, p_kind, p_ref);
end $$;

-- ---------- change detection: AFTER triggers on records ----------
create or replace function public.channex__on_record() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_coll text; v_id text; o jsonb; n jsonb; ok jsonb; nk jsonb; x jsonb; t0 date; t text; side int;
  v_prop uuid; v_types text[];
begin
  v_org := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
  -- the common case: this workspace has no connected building
  if not exists (select 1 from public.channex_properties p where p.org_id = v_org and public.channex__connected(p.status)) then
    return null;
  end if;
  v_coll := case when tg_op = 'DELETE' then old.coll else new.coll end;
  v_id := case when tg_op = 'DELETE' then old.id else new.id end;
  -- the record as it was / is; a soft-deleted record counts as gone
  o := case when tg_op in ('UPDATE', 'DELETE') and not old.deleted then old.data end;
  n := case when tg_op in ('INSERT', 'UPDATE') and not new.deleted then new.data end;
  if o is not distinct from n then return null; end if;
  if o is not null and jsonb_typeof(o) <> 'object' then o := null; end if;
  if n is not null and jsonb_typeof(n) <> 'object' then n := null; end if;
  t0 := public.channex__today();

  if v_coll in ('bookings', 'blocks') then
    -- only what availability depends on; anything else (guest details, door codes, a status change between two live
    -- statuses) is ignored
    if v_coll = 'bookings' then
      ok := case when o is not null and coalesce(o->>'status', '') not in ('cancelled', 'deleted')
                 then jsonb_build_object('a', o->>'checkIn', 'b', o->>'checkOut', 'u', o->>'propertyId', 't', o->>'unitTypeId') end;
      nk := case when n is not null and coalesce(n->>'status', '') not in ('cancelled', 'deleted')
                 then jsonb_build_object('a', n->>'checkIn', 'b', n->>'checkOut', 'u', n->>'propertyId', 't', n->>'unitTypeId') end;
    else
      ok := case when o is not null then jsonb_build_object('a', o->>'start', 'b', o->>'end', 'u', o->>'propertyId') end;
      nk := case when n is not null then jsonb_build_object('a', n->>'start', 'b', n->>'end', 'u', n->>'propertyId') end;
    end if;
    if ok is not distinct from nk then return null; end if;
    for side in 1..2 loop
      x := case when side = 1 then ok else nk end;
      continue when x is null;
      -- the type sold and the assigned unit's type; nights [checkIn, checkOut - 1]
      v_types := array_remove(array[nullif(x->>'t', ''), public.channex__unit_type(v_org, nullif(x->>'u', ''))], null);
      foreach t in array (select coalesce(array_agg(distinct e), '{}') from unnest(v_types) e) loop
        perform public.channex__mark_type(v_org, t, public.channex__date(x->>'a'), public.channex__date(x->>'b') - 1, v_coll);
      end loop;
    end loop;

  elsif v_coll = 'channelRates' then
    if coalesce(o->>'planId', '') = coalesce(n->>'planId', '') then
      perform public.channex__mark_days(v_org, coalesce(n->>'planId', o->>'planId'), coalesce(n->>'unitTypeId', o->>'unitTypeId'), o->'days', n->'days', 'channelRates');
    else
      perform public.channex__mark_days(v_org, o->>'planId', o->>'unitTypeId', o->'days', null, 'channelRates');
      perform public.channex__mark_days(v_org, n->>'planId', n->>'unitTypeId', null, n->'days', 'channelRates');
    end if;

  elsif v_coll = 'properties' then
    -- a unit counts for its type when it exists, is tagged and is not archived
    ok := case when o is not null then jsonb_build_object('t', o->>'unitTypeId', 'b', o->>'buildingId', 'x', public.channex__archived(o)) end;
    nk := case when n is not null then jsonb_build_object('t', n->>'unitTypeId', 'b', n->>'buildingId', 'x', public.channex__archived(n)) end;
    if ok is not distinct from nk then return null; end if;
    foreach t in array (select coalesce(array_agg(distinct e), '{}') from unnest(array[nullif(ok->>'t', ''), nullif(nk->>'t', '')]) e where e is not null) loop
      perform public.channex__mark_type(v_org, t, t0, t0 + 499, 'unit');
      if public.channex__type_property(v_org, t) is not null then perform public.channex__queue(v_org, 'room_count', t); end if;
    end loop;

  elsif v_coll = 'unitTypes' then
    v_prop := public.channex__type_property(v_org, v_id);
    if v_prop is null and n is not null then v_prop := public.channex__live_property(v_org, n->>'buildingId'); end if;
    if v_prop is null then return null; end if;
    perform public.channex__queue(v_org, case when o is null then 'unit_type_create' else 'unit_type_update' end, v_id);
    -- archived or deleted: availability 0 goes out; restored: the real value
    if (o is null or public.channex__archived(o)) is distinct from (n is null or public.channex__archived(n)) then
      perform public.channex__mark(v_org, v_prop, 'availability', v_id, t0, t0 + 499, 'unitType');
    end if;

  elsif v_coll = 'ratePlans' then
    v_prop := public.channex__type_property(v_org, coalesce(nullif(n->>'unitTypeId', ''), o->>'unitTypeId'));
    if v_prop is null then return null; end if;
    perform public.channex__queue(v_org, case when o is null then 'rate_plan_create' else 'rate_plan_update' end, v_id);
    -- the values sent for days without their own entry come from the plan (rate, min stay); archived -> stop sell
    if o is null or n is null
       or (o->'defaultRate', o->'minStay', o->>'unitTypeId', public.channex__archived(o))
          is distinct from (n->'defaultRate', n->'minStay', n->>'unitTypeId', public.channex__archived(n)) then
      perform public.channex__mark(v_org, v_prop, 'restrictions', v_id, t0, t0 + 499, 'ratePlan');
    end if;

  elsif v_coll = 'buildings' then
    if o is not null and n is not null and public.channex__live_property(v_org, v_id) is not null then
      perform public.channex__queue(v_org, 'building_update', v_id);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists channex_on_record on public.records;
create trigger channex_on_record after insert or update on public.records for each row
  when (new.coll in ('bookings', 'blocks', 'channelRates', 'ratePlans', 'properties', 'unitTypes', 'buildings'))
  execute function public.channex__on_record();
-- the app never hard-deletes records (no delete policy, and reset_org refuses while connected), but the server could
drop trigger if exists channex_on_record_delete on public.records;
create trigger channex_on_record_delete after delete on public.records for each row
  when (old.coll in ('bookings', 'blocks', 'channelRates', 'ratePlans', 'properties', 'unitTypes', 'buildings'))
  execute function public.channex__on_record();

-- ---------- availability per unit type per night (plan 2.2) ----------
-- avail(T, n) = |active units of T not blocked on n and not occupied on n by an assigned live booking|
--             - |unassigned live bookings of type T covering n|, clamped at 0 (raw < 0 means oversold).
-- Live booking: any status except cancelled and deleted. Units: records coll 'properties' with data.unitTypeId,
-- not archived. Blocks: coll 'blocks' {propertyId, start, end (exclusive)}. Bookings: {checkIn, checkOut (exclusive),
-- propertyId (the assigned unit, may be null), unitTypeId}.
create or replace function public.channex_type_availability(p_org uuid, p_unit_type text, p_from date, p_to date)
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

-- ---------- rate limiter ----------
-- Reserve a call slot: at most 9 calls a minute per property and endpoint (Channex allows 10) and, for the ARI
-- endpoints (/availability, /restrictions), at most 19 a minute across the whole account (Channex allows 20; the docs
-- do not say whether that is per account or per property). Returns the id of the reserved channex_calls row (the
-- worker fills in that row with the outcome instead of logging a second one), or null when there is no slot.
create or replace function public.channex_take_slot(p_property uuid, p_endpoint text, p_source text default 'delta')
returns bigint language plpgsql set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); ari boolean := p_endpoint ~ '^/?(availability|restrictions)$'; v_id bigint;
begin
  if p_property is null or coalesce(p_endpoint, '') = '' then return null; end if;
  -- ARI calls share one lock because they share the account-wide limit
  perform pg_advisory_xact_lock(hashtext(case when ari then 'channex-ari' else 'channex-call:' || p_property::text || p_endpoint end));
  if (select count(*) from public.channex_calls c
       where c.channex_property_id = p_property and c.endpoint = p_endpoint and c.at > v_now - interval '60 seconds') >= 9 then
    return null;
  end if;
  if ari and (select count(*) from public.channex_calls c
               where c.endpoint ~ '^/?(availability|restrictions)$' and c.at > v_now - interval '60 seconds') >= 19 then
    return null;
  end if;
  insert into public.channex_calls (org_id, channex_property_id, endpoint, method, source, at)
  values ((select p.org_id from public.channex_properties p where p.channex_property_id = p_property), p_property, p_endpoint, 'POST',
          case when p_source in ('delta', 'full', 'setup', 'booking', 'ack', 'feed', 'iframe', 'channels') then p_source end, v_now)
  returning id into v_id;
  return v_id;
end $$;

-- Lease a property so two worker runs never send for it at once. True when this run holds it now.
-- p_lease_seconds <= 0 releases it.
create or replace function public.channex_claim(p_property uuid, p_lease_seconds int)
returns boolean language plpgsql set search_path = '' as $$
declare n int;
begin
  if coalesce(p_lease_seconds, 0) <= 0 then
    update public.channex_properties set lease_until = null where channex_property_id = p_property;
    return true;
  end if;
  update public.channex_properties set lease_until = clock_timestamp() + make_interval(secs => least(p_lease_seconds, 600))
   where channex_property_id = p_property and (lease_until is null or lease_until < clock_timestamp());
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ---------- reset_org: refuse while channels are connected ----------
-- reset_org deletes records without the triggers seeing a "change" Channex could make sense of (every unit and booking
-- would vanish and close all dates). Same behaviour as 0001 otherwise.
create or replace function public.reset_org(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.member_role(p_org) <> 'owner' or public.member_role(p_org) is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if exists (select 1 from public.channex_properties p where p.org_id = p_org and public.channex__connected(p.status)) then
    raise exception 'Disconnect channels in Channels first' using errcode = '55000';
  end if;
  delete from public.records r where r.org_id = p_org and not (r.coll = 'staff' and exists (select 1 from public.members m where m.org_id = p_org and m.staff_id = r.id));
  delete from public.blobs b where b.org_id = p_org and b.key not in ('workspaceBrand');
end $$;

-- ---------- who may call what ----------
-- Helpers and the trigger: nobody but the owner (the trigger runs as its owner). Worker functions: service role only.
do $$
declare fn text;
begin
  foreach fn in array array[
    'channex__connected(text)', 'channex__today()', 'channex__date(text)', 'channex__archived(jsonb)',
    'channex__live_property(uuid, text)', 'channex__type_property(uuid, text)', 'channex__unit_type(uuid, text)',
    'channex__plan_type(uuid, text)', 'channex__mark(uuid, uuid, text, text, date, date, text)',
    'channex__mark_type(uuid, text, date, date, text)', 'channex__mark_days(uuid, text, text, jsonb, jsonb, text)',
    'channex__queue(uuid, text, text)', 'channex__on_record()',
    'channex_type_availability(uuid, text, date, date)', 'channex_take_slot(uuid, text, text)', 'channex_claim(uuid, int)']
  loop
    execute format('revoke all on function public.%s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function public.%s from anon', fn); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function public.%s from authenticated', fn); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.channex_type_availability(uuid, text, date, date) to service_role;
    grant execute on function public.channex_take_slot(uuid, text, text) to service_role;
    grant execute on function public.channex_claim(uuid, int) to service_role;
  end if;
  -- reset_org keeps the 0005 grants (create or replace keeps them); repeat them in case this runs on a database
  -- where 0005 did not
  revoke all on function public.reset_org(uuid) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.reset_org(uuid) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then grant execute on function public.reset_org(uuid) to authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.reset_org(uuid) to service_role; end if;
end $$;
