-- Orbique PMS: helpers for the server API (api/*.js, which uses the service-role key).

-- "Subscribe" requests come from people who are not signed in yet, so keep the email they gave.
alter table public.subscription_requests add column if not exists email text;
create index if not exists subscription_requests_created_idx on public.subscription_requests (created_at);
create index if not exists subscription_requests_email_idx on public.subscription_requests (email, created_at);

-- Find an account by email (the Auth admin API has no lookup by email). Service role only.
create or replace function public.api_user_by_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u where lower(u.email) = lower(trim(p_email)) order by u.created_at limit 1;
$$;
revoke all on function public.api_user_by_email(text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.api_user_by_email(text) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.api_user_by_email(text) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.api_user_by_email(text) to service_role; end if;
end $$;
