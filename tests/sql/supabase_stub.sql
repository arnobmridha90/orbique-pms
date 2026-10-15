-- The few Supabase pieces the migrations expect, for running them on a plain Postgres (no Supabase stack):
-- the API roles, auth.users and auth.uid(). Not for production: Supabase provides the real ones.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/supabase_stub.sql
--   for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/guest_units.sql
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
