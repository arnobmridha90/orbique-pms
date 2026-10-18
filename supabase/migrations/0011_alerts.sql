-- 0011: booking alerts. When a booking arrives from a booking site (or the guest website), is cancelled there, or its
-- dates change there, the workspace's team gets an alert by email (Resend), WhatsApp and the phone app (Firebase).
--
-- What is here:
--   * alert_outbox: one row per alert to send, with what each channel did (done: {"email": "sent", ...});
--     api/_lib/alerts.js sends them (right after a webhook, and every minute from the worker), with retries
--   * push_devices: the phones that asked for alerts (Firebase Cloud Messaging tokens), per workspace and person
--   * a trigger on records that queues an alert for a booking change nobody on the team made: the channel manager,
--     the guest website and the guest app write without a signed-in member (auth.uid() is null). Changes a team
--     member makes in the app do not alert them about their own work.
--
-- Who can do what: only the server (service role) reads or writes these tables. The phone app registers itself
-- through /api/alerts. Which alerts go where is the workspace's alertSettings value (blobs), edited on Automations.

create table if not exists public.alert_outbox (
  id bigserial primary key,
  org_id uuid not null references public.orgs on delete cascade,
  key text not null unique,                 -- one alert per booking event, however often the row is saved again
  kind text not null check (kind in ('new', 'cancelled', 'changed', 'test')),
  booking_id text,
  data jsonb not null default '{}',         -- {b: the booking as saved, old: {checkIn, checkOut}} or a test's {to}
  done jsonb not null default '{}',         -- per channel: "sent", "skipped: why", or "error: why" (retried)
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  next_at timestamptz not null default now(),
  finished_at timestamptz,
  last_error text
);
create index if not exists alert_outbox_due_idx on public.alert_outbox (next_at) where finished_at is null;
create index if not exists alert_outbox_org_idx on public.alert_outbox (org_id, created_at desc);

create table if not exists public.push_devices (
  token text primary key,
  org_id uuid not null references public.orgs on delete cascade,
  user_id uuid not null,
  platform text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_devices_org_idx on public.push_devices (org_id);

alter table public.alert_outbox enable row level security;
alter table public.push_devices enable row level security;
do $$
declare t text;
begin
  foreach t in array array['public.alert_outbox', 'public.push_devices', 'public.alert_outbox_id_seq'] loop
    execute 'revoke all on ' || t || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on ' || t || ' from anon'; end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on ' || t || ' from authenticated'; end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant all on ' || t || ' to service_role'; end if;
  end loop;
end $$;

-- A booking is live unless it is cancelled or deleted (the app's own rule).
create or replace function public.alerts__live(d jsonb, deleted boolean) returns boolean
language sql immutable as $$
  select not coalesce(deleted, false) and coalesce(d->>'status', '') not in ('cancelled', 'deleted');
$$;

create or replace function public.alerts__on_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  was_live boolean;
  is_live boolean;
  k text;
  kind text;
begin
  if new.coll <> 'bookings' then return null; end if;
  -- a team member's own change in the app: no alert
  if auth.uid() is not null then return null; end if;
  is_live := public.alerts__live(new.data, new.deleted);
  if tg_op = 'INSERT' then
    if not is_live then return null; end if;
    kind := 'new';
    k := 'new:' || new.id;
  else
    was_live := public.alerts__live(old.data, old.deleted);
    if is_live and not was_live then
      kind := 'new';                         -- reinstated after a cancellation (or first saved as cancelled)
      k := 'new:' || new.id || ':' || coalesce(new.data->>'checkIn', '') || ':' || coalesce(new.data->>'checkOut', '');
    elsif was_live and not is_live then
      kind := 'cancelled';
      k := 'cancelled:' || new.id;
    elsif is_live and (coalesce(new.data->>'checkIn', '') <> coalesce(old.data->>'checkIn', '')
                    or coalesce(new.data->>'checkOut', '') <> coalesce(old.data->>'checkOut', '')) then
      kind := 'changed';
      k := 'changed:' || new.id || ':' || coalesce(new.data->>'checkIn', '') || ':' || coalesce(new.data->>'checkOut', '');
    else
      return null;
    end if;
  end if;
  insert into alert_outbox (org_id, key, kind, booking_id, data)
  values (new.org_id, k, kind, new.id, jsonb_build_object('b', new.data,
    'old', case when tg_op = 'UPDATE' then jsonb_build_object('checkIn', old.data->'checkIn', 'checkOut', old.data->'checkOut') else null end))
  on conflict (key) do nothing;
  return null;
exception when others then
  -- an alert must never stop a booking from being saved
  raise warning 'alerts: could not queue an alert for booking %: %', new.id, sqlerrm;
  return null;
end $$;

drop trigger if exists alerts_on_booking on public.records;
create trigger alerts_on_booking after insert or update on public.records for each row
  when (new.coll = 'bookings') execute function public.alerts__on_booking();

do $$
declare f text;
begin
  foreach f in array array['public.alerts__on_booking()', 'public.alerts__live(jsonb, boolean)'] loop
    execute 'revoke all on function ' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ' || f || ' from anon'; end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function ' || f || ' from authenticated'; end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function ' || f || ' to service_role'; end if;
  end loop;
end $$;
