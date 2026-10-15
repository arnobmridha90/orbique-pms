-- Minimal stand-ins for Supabase Vault, pg_net and pg_cron, for testing 0007 on a plain Postgres (tests only).
-- Only the functions and columns 0007 uses; secrets are stored in clear here.
create schema if not exists vault;
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null) returns uuid language sql as $$
  insert into vault.secrets (name, secret) values (new_name, new_secret) returning id;
$$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null) returns void language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id;
$$;

create schema if not exists net;
create table if not exists net.requests (id bigserial primary key, url text, body jsonb, headers jsonb, timeout_milliseconds int);
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
returns bigint language sql as $$
  insert into net.requests (url, body, headers, timeout_milliseconds) values (url, body, headers, timeout_milliseconds) returning id;
$$;

create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid;
$$;
