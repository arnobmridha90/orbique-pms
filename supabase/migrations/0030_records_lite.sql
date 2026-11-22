-- 0030: smaller reads for the background worker (Supabase egress, 2026-11-22).
-- The worker runs every minute and used to download every unit with its photos (base64, about 550 KB per unit) and every
-- unlinked booking-site chat with all its messages. That alone used more than the Free plan's 5 GB a month.
-- Two PostgREST computed fields on records, read with select('id, data:data_lite') / select('id, data:conv_brief'):
--   * data_lite(records):  the record without its photos (units: 'properties'); other collections unchanged
--   * conv_brief(records): a chat without its messages, plus lastAt (the time of its last message)
-- They follow records' own row-level security (a signed-in user sees only their workspace's rows).
-- Re-runnable; no data is changed.

create or replace function public.data_lite(r public.records) returns jsonb
language sql stable set search_path = '' as $$
  select case when jsonb_typeof(r.data) = 'object' then r.data - 'photos' else r.data end
$$;

create or replace function public.conv_brief(r public.records) returns jsonb
language sql stable set search_path = '' as $$
  select case when jsonb_typeof(r.data) = 'object'
    then (r.data - 'messages') || jsonb_build_object('lastAt',
      case when jsonb_typeof(r.data -> 'messages') = 'array' then r.data -> 'messages' -> -1 ->> 'time' end)
    else r.data end
$$;

do $$ begin
  revoke all on function public.data_lite(public.records) from public;
  revoke all on function public.conv_brief(public.records) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.data_lite(public.records) from anon;
    revoke all on function public.conv_brief(public.records) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.data_lite(public.records) to authenticated;
    grant execute on function public.conv_brief(public.records) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.data_lite(public.records) to service_role;
    grant execute on function public.conv_brief(public.records) to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
