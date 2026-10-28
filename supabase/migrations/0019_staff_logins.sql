-- 0019: sign in with a mobile number or a username, not only an email.
--
-- What is here:
--   * login_names: the other names a person signs in with. kind 'phone' is the number in digits with its country code
--     (60123456789), kind 'username' a lower-case name (aina.k). Each is unique across Orbique, so it finds one account.
--     The account owner of a workspace sets them for their team (POST /api/account set-login or invite).
--   * login_failures: recent wrong passwords per login name, so guessing is slowed down (the server signs in on the
--     person's behalf, so Supabase's own limit per address does not see the guesser).
-- Both are server only: row level security on, no policy, nothing granted to signed-in users.
--
-- Safe to re-run: if not exists everywhere; no data is changed.

create table if not exists public.login_names (
  kind text not null check (kind in ('phone', 'username')),
  login text not null,
  user_id uuid not null references auth.users on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (kind, login),
  unique (user_id, kind)
);
alter table public.login_names enable row level security;

create table if not exists public.login_failures (
  key text not null,
  at timestamptz not null default now()
);
create index if not exists login_failures_key_at on public.login_failures (key, at);
alter table public.login_failures enable row level security;

do $$
declare t text;
begin
  foreach t in array array['login_names', 'login_failures'] loop
    execute format('revoke all on public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on public.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on public.%I from authenticated', t); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on public.%I to service_role', t); end if;
  end loop;
end $$;
