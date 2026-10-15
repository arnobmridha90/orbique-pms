-- 0007: the Channex worker's clock. pg_cron calls public.channex_tick() every minute and once a night; channex_tick()
-- posts to /api/channex-worker through pg_net with a bearer secret kept in Supabase Vault.
--
-- Plain Postgres (local, CI) has none of pg_cron, pg_net or Vault: then the extensions and schedules are skipped and
-- the functions do nothing, so this file still applies. scripts/migrate.mjs stores the worker URL and secret with
-- channex_set_worker() when CHANNEX_WORKER_SECRET and an app URL are set; nothing secret is in this file.
-- Safe to re-run.

do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'supabase_vault')
     and not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    begin create extension if not exists supabase_vault; exception when others then raise notice 'channex: Vault not enabled (%)', sqlerrm; end;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    begin create extension if not exists pg_net; exception when others then raise notice 'channex: pg_net not enabled (%)', sqlerrm; end;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    -- pg_cron also needs shared_preload_libraries; Supabase has it, a plain server may not
    begin create extension if not exists pg_cron; exception when others then raise notice 'channex: pg_cron not enabled (%)', sqlerrm; end;
  end if;
end $$;

-- Store (or replace) the worker address and its bearer secret in Vault. Service role only.
create or replace function public.channex_set_worker(p_url text, p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if to_regnamespace('vault') is null then raise exception 'Supabase Vault is not available in this database' using errcode = '55000'; end if;
  if coalesce(p_url, '') !~ '^https?://[^\s/]+(/\S*)?$' then raise exception 'channex_set_worker: the worker URL must start with https:// (or http:// for a local server)' using errcode = '22023'; end if;
  if char_length(coalesce(p_secret, '')) < 16 then raise exception 'channex_set_worker: the worker secret is too short' using errcode = '22023'; end if;
  execute 'select id from vault.secrets where name = $1' into v_id using 'channex_worker_url';
  if v_id is null then execute 'select vault.create_secret($1, $2)' using p_url, 'channex_worker_url';
  else execute 'select vault.update_secret($1, $2)' using v_id, p_url; end if;
  v_id := null;
  execute 'select id from vault.secrets where name = $1' into v_id using 'channex_worker_secret';
  if v_id is null then execute 'select vault.create_secret($1, $2)' using p_secret, 'channex_worker_secret';
  else execute 'select vault.update_secret($1, $2)' using v_id, p_secret; end if;
end $$;

-- One worker call: POST {task} to the worker with the bearer secret. Returns the pg_net request id, or null (doing
-- nothing) when pg_net or Vault is missing or the worker was never set up.
create or replace function public.channex_tick(p_task text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text; v_req bigint;
begin
  if p_task not in ('tick', 'nightly') then raise exception 'channex_tick: unknown task' using errcode = '22023'; end if;
  if to_regnamespace('vault') is null or to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then return null; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v_url using 'channex_worker_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v_secret using 'channex_worker_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then return null; end if;
  execute 'select net.http_post(url := $1, body := $2, params := ''{}''::jsonb, headers := $3, timeout_milliseconds := 25000)'
    into v_req
    using v_url, jsonb_build_object('task', p_task),
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret);
  return v_req;
end $$;

do $$ begin
  revoke all on function public.channex_set_worker(text, text) from public;
  revoke all on function public.channex_tick(text) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.channex_set_worker(text, text) from anon;
    revoke all on function public.channex_tick(text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.channex_set_worker(text, text) from authenticated;
    revoke all on function public.channex_tick(text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.channex_set_worker(text, text) to service_role;
    grant execute on function public.channex_tick(text) to service_role;
  end if;
end $$;

-- Schedules (cron.schedule replaces a job of the same name, so re-running keeps one of each).
-- 19:00 UTC = 03:00 Malaysia time.
do $$ begin
  if to_regnamespace('cron') is not null and to_regprocedure('cron.schedule(text, text, text)') is not null then
    perform cron.schedule('channex-tick', '* * * * *', $job$select public.channex_tick('tick')$job$);
    perform cron.schedule('channex-nightly', '0 19 * * *', $job$select public.channex_tick('nightly')$job$);
  else
    raise notice 'channex: pg_cron is not available; no schedules (run the worker another way, e.g. scripts/dev.mjs --worker)';
  end if;
end $$;
