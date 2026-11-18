-- 0027: what the Health page reads about the database's own clock (api/_lib/healthcheck.js).
-- health_cron(): each scheduled job (the Channex worker's minute and nightly jobs, 0007) with its last run.
-- health_net(): the last answers the app gave to those calls (pg_net), newest first.
-- Both give nothing on a plain Postgres (CI, local) that has no pg_cron or pg_net. Service role only. Safe to run again.
create or replace function public.health_cron()
returns table (jobname text, schedule text, active boolean, last_start timestamptz, last_status text, last_end timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then return; end if;
  return query execute 'select j.jobname::text, j.schedule::text, j.active, d.start_time, d.status::text, d.end_time
    from cron.job j left join lateral (select r.start_time, r.status, r.end_time from cron.job_run_details r where r.jobid = j.jobid order by r.start_time desc limit 1) d on true
    order by j.jobid';
end $$;

create or replace function public.health_net()
returns table (status_code integer, created timestamptz, timed_out boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if to_regclass('net._http_response') is null then return; end if;
  return query execute 'select r.status_code::integer, r.created, coalesce(r.timed_out, false) from net._http_response r order by r.created desc limit 10';
end $$;

do $$ begin
  revoke all on function public.health_cron() from public;
  revoke all on function public.health_net() from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.health_cron() from anon;
    revoke all on function public.health_net() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.health_cron() from authenticated;
    revoke all on function public.health_net() from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.health_cron() to service_role;
    grant execute on function public.health_net() to service_role;
  end if;
end $$;
