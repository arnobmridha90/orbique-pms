-- 0007 against stand-ins for Vault, pg_net and pg_cron (tests/sql/supabase_ext_stub.sql, loaded before the migrations).
-- Run by tests/sql/run.sh after scripts/migrate.mjs stored the worker with CHANNEX_WORKER_SECRET set.
\set ON_ERROR_STOP 1
\pset pager off
\o /dev/null
create schema if not exists t;
create or replace function t.ok(cond boolean, msg text) returns text language plpgsql as $$
begin
  if cond is not true then raise exception 'FAILED: %', msg; end if;
  raise notice 'ok: %', msg;
  return 'ok';
end $$;

select t.ok((select count(*) from cron.job) = 2, 'two schedules, once each after re-runs');
select t.ok((select schedule || ' ' || command from cron.job where jobname = 'channex-tick') = '* * * * * select public.channex_tick(''tick'')', 'tick every minute');
select t.ok((select schedule || ' ' || command from cron.job where jobname = 'channex-nightly') = '0 19 * * * select public.channex_tick(''nightly'')', 'nightly at 19:00 UTC');
select t.ok((select decrypted_secret from vault.decrypted_secrets where name = 'channex_worker_url') = 'http://127.0.0.1:3000/api/channex-worker', 'migrate.mjs stored the worker URL');
select t.ok((select count(*) from vault.secrets where name = 'channex_worker_secret') = 1, 'one worker secret, updated in place on re-runs');

select public.channex_tick('tick');
select t.ok((select url from net.requests order by id desc limit 1) = 'http://127.0.0.1:3000/api/channex-worker', 'tick posts to the worker');
select t.ok((select body from net.requests order by id desc limit 1) = '{"task":"tick"}', 'body {task}');
select t.ok((select headers->>'Authorization' from net.requests order by id desc limit 1) = 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'channex_worker_secret'), 'bearer secret from Vault');
select t.ok((select timeout_milliseconds from net.requests order by id desc limit 1) = 25000, '25 s timeout');

select public.channex_set_worker('https://orbique.example/api/channex-worker', 'another-secret-value-123');
select t.ok((select count(*) from vault.secrets) = 2 and (select decrypted_secret from vault.decrypted_secrets where name = 'channex_worker_url') = 'https://orbique.example/api/channex-worker', 'set_worker replaces, never duplicates');
do $$ begin
  begin perform public.channex_set_worker('ftp://x', 'another-secret-value-123'); raise exception 'FAILED: bad URL accepted';
  exception when invalid_parameter_value then raise notice 'ok: a bad URL is refused'; end;
  begin perform public.channex_set_worker('https://x.example', 'short'); raise exception 'FAILED: short secret accepted';
  exception when invalid_parameter_value then raise notice 'ok: a short secret is refused'; end;
  begin perform public.channex_tick('other'); raise exception 'FAILED: unknown task accepted';
  exception when invalid_parameter_value then raise notice 'ok: unknown task refused'; end;
end $$;
delete from vault.secrets where name = 'channex_worker_secret';
select t.ok(public.channex_tick('nightly') is null, 'no secret: tick does nothing');

\echo channex_cron.sql: all checks passed
