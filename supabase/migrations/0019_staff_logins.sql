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
-- Safe to re-run: if not exists and create or replace everywhere; no data is changed.

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

-- login_try(keys, limits, window_secs): one sign-in try counted against each key, atomically. Refused (false, nothing
-- counted) when any key already has its limit of tries in the window. A lock per key makes parallel tries queue, so a
-- burst cannot slip past the limit. The server removes a key's rows when a sign-in succeeds.
create or replace function public.login_try(p_keys text[], p_limits int[], p_window_secs int)
returns boolean language plpgsql security definer set search_path = public as $$
declare i int; n int;
begin
  for i in 1 .. coalesce(array_length(p_keys, 1), 0) loop
    perform pg_advisory_xact_lock(hashtextextended('login_try:' || p_keys[i], 0));
  end loop;
  for i in 1 .. coalesce(array_length(p_keys, 1), 0) loop
    select count(*) into n from public.login_failures where key = p_keys[i] and at > now() - make_interval(secs => p_window_secs);
    if n >= p_limits[i] then return false; end if;
  end loop;
  insert into public.login_failures (key, at) select k, now() from unnest(p_keys) as k;
  if random() < 0.02 then delete from public.login_failures where at < now() - interval '1 day'; end if;
  return true;
end $$;

-- set_login_names(user, kinds, logins): replace a person's sign-in names in one go (a null login removes that kind).
-- All or nothing: a name someone else holds raises 23505 with the message '<kind>-taken' and nothing changes.
create or replace function public.set_login_names(p_user uuid, p_kinds text[], p_logins text[])
returns void language plpgsql security definer set search_path = public as $$
declare i int;
begin
  for i in 1 .. coalesce(array_length(p_kinds, 1), 0) loop
    delete from public.login_names where user_id = p_user and kind = p_kinds[i];
    if p_logins[i] is not null then
      begin
        insert into public.login_names (kind, login, user_id, updated_at) values (p_kinds[i], p_logins[i], p_user, now());
      exception when unique_violation then
        raise exception using errcode = '23505', message = p_kinds[i] || '-taken';
      end;
    end if;
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.login_try(text[], int[], int)', 'public.set_login_names(uuid, text[], text[])'] loop
    execute 'revoke all on function ' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ' || f || ' from anon'; end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function ' || f || ' from authenticated'; end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function ' || f || ' to service_role'; end if;
  end loop;
end $$;
