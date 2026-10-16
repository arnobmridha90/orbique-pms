-- 0009: Channex fixes from the docs audit before certification (2026-10-16). 0006 and 0007 are applied, so they are
-- not edited; this file changes what it needs and is re-runnable.
--
-- * channex_outbox.force: the dates of a forced mark go out with their complete value even when it equals what
--   Channex last accepted. Used after a booking revision (Channex lowers availability by itself on a new booking, so
--   the last value Orbique sent may no longer be what Channex has), for the nightly new day, on resume, and when a
--   person sends rejected updates again.
-- * channex_invalidate(): forget the last-sent values of one room type or rate plan over some dates and add a forced
--   mark for them (worker only).
-- * channex_take_slot(): at most 9 calls a minute per property and endpoint. The account-wide cap of 19 ARI calls a
--   minute is gone: the rate-limits page sets the ARI limits per property ("10 Availability Requests per minute per
--   property", the same for restrictions and prices), so the cap only made busy properties wait for each other.
-- * channex_alerts: org_id may be null for an alert no workspace owns (a booking revision for a property that no
--   Orbique building is connected to; platform admins see it), and the kinds unknown_property and currency_changed.

alter table public.channex_outbox add column if not exists force boolean not null default false;

alter table public.channex_alerts alter column org_id drop not null;
alter table public.channex_alerts drop constraint if exists channex_alerts_kind_check;
alter table public.channex_alerts add constraint channex_alerts_kind_check check (kind in ('double_booking', 'needs_unit', 'unmapped_room',
  'unmapped_rate', 'sync_error', 'rate_warning', 'non_acked', 'channel_disconnected', 'unknown_property', 'currency_changed'));

-- Forget what Channex last accepted for p_target over [p_from, p_to] (clipped to [today, today + 499]) and add a forced
-- mark, so the next send states Orbique's value for those dates whatever the state says. Returns the number of days.
create or replace function public.channex_invalidate(p_org uuid, p_prop uuid, p_kind text, p_target text, p_from date, p_to date, p_reason text)
returns int language plpgsql set search_path = '' as $$
declare t0 date := public.channex__today(); a date; b date;
begin
  if p_org is null or p_prop is null or coalesce(p_target, '') = '' or p_from is null or p_to is null
     or p_kind is null or p_kind not in ('availability', 'restrictions') then return 0; end if;
  a := greatest(p_from, t0); b := least(p_to, t0 + 499);
  if a > b then return 0; end if;
  update public.channex_state s set value = null
   where s.channex_property_id = p_prop and s.kind = p_kind and s.target_id = p_target and s.date between a and b;
  insert into public.channex_outbox (org_id, channex_property_id, kind, target_id, date_from, date_to, reason, force)
  values (p_org, p_prop, p_kind, p_target, a, b, p_reason, true);
  return b - a + 1;
end $$;

-- Reserve a call slot: at most 9 calls a minute per property and endpoint (Channex allows 10 per property for each ARI
-- endpoint). Returns the id of the reserved channex_calls row (the worker fills in that row with the outcome instead
-- of logging a second one), or null when there is no slot.
create or replace function public.channex_take_slot(p_property uuid, p_endpoint text, p_source text default 'delta')
returns bigint language plpgsql set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_id bigint;
begin
  if p_property is null or coalesce(p_endpoint, '') = '' then return null; end if;
  perform pg_advisory_xact_lock(hashtext('channex-call:' || p_property::text || p_endpoint));
  if (select count(*) from public.channex_calls c
       where c.channex_property_id = p_property and c.endpoint = p_endpoint and c.at > v_now - interval '60 seconds') >= 9 then
    return null;
  end if;
  insert into public.channex_calls (org_id, channex_property_id, endpoint, method, source, at)
  values ((select p.org_id from public.channex_properties p where p.channex_property_id = p_property), p_property, p_endpoint, 'POST',
          case when p_source in ('delta', 'full', 'setup', 'booking', 'ack', 'feed', 'iframe', 'channels') then p_source end, v_now)
  returning id into v_id;
  return v_id;
end $$;

do $$
begin
  revoke all on function public.channex_invalidate(uuid, uuid, text, text, date, date, text) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.channex_invalidate(uuid, uuid, text, text, date, date, text) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.channex_invalidate(uuid, uuid, text, text, date, date, text) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.channex_invalidate(uuid, uuid, text, text, date, date, text) to service_role;
    grant execute on function public.channex_take_slot(uuid, text, text) to service_role;
  end if;
end $$;
