-- 0015: bookings from a workspace's own website (api/public.js, api/_lib/website.js).
--
-- What is here:
--   * web_members: the website's members per workspace (signed in with a 6-digit code sent by email; members see the
--     lower direct price). Only an email address and when they joined and last signed in.
--   * web_member_codes: the sign-in codes, stored as a hash, valid 10 minutes, at most 5 tries each.
--   * alerts__live (0011) now also treats a website hold (webHold: true, a pending booking waiting for the guest to pay)
--     as not live, so the team is alerted once the guest has paid, not when they open the payment page.
--
-- Who can do what: only the server (service role) reads or writes these tables.

create table if not exists public.web_members (
  org_id uuid not null references public.orgs on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  primary key (org_id, email)
);

create table if not exists public.web_member_codes (
  id bigserial primary key,
  org_id uuid not null references public.orgs on delete cascade,
  email text not null,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts int not null default 0,
  used_at timestamptz
);
create index if not exists web_member_codes_lookup_idx on public.web_member_codes (org_id, email, created_at desc);

alter table public.web_members enable row level security;
alter table public.web_member_codes enable row level security;
do $$
declare t text;
begin
  foreach t in array array['public.web_members', 'public.web_member_codes', 'public.web_member_codes_id_seq'] loop
    execute 'revoke all on ' || t || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on ' || t || ' from anon'; end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on ' || t || ' from authenticated'; end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant all on ' || t || ' to service_role'; end if;
  end loop;
end $$;

-- A booking is live unless it is cancelled or deleted (the app's own rule), and for alerts not while it is a website
-- hold that nobody has paid for yet.
create or replace function public.alerts__live(d jsonb, deleted boolean) returns boolean
language sql immutable as $$
  select not coalesce(deleted, false) and coalesce(d->>'status', '') not in ('cancelled', 'deleted')
     and coalesce(d->>'webHold', '') <> 'true';
$$;

do $$
begin
  execute 'revoke all on function public.alerts__live(jsonb, boolean) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function public.alerts__live(jsonb, boolean) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function public.alerts__live(jsonb, boolean) from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function public.alerts__live(jsonb, boolean) to service_role'; end if;
end $$;
