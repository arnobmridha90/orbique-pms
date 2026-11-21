-- 0029: Google Business Profile reviews on the Reviews page (api/_lib/google.js, api/_lib/google-reviews.js, api/messages.js).
--   * google_connections: which Google Business Profile location a workspace shows, who connected it, the last sync and
--     the last problem. Members can read it (the Reviews page shows the status); only the server writes it.
--   * google_tokens: the Google sign-in (refresh token) for that connection. Only the server reads or writes it: no policy,
--     nothing granted to signed-in users, the same as whatsapp_tokens (0018).
-- The reviews themselves are records in coll 'reviews' (id RV-GG-..., gg = the Google review name), like the Channex ones.
-- Re-runnable; no data is changed.

create table if not exists public.google_connections (
  org_id uuid primary key references public.orgs on delete cascade,
  google_email text,
  account_name text,            -- accounts/123
  location_name text,           -- locations/456
  location_title text,
  building_id text,             -- the Orbique building the profile belongs to (optional)
  status text not null default 'pick' check (status in ('pick', 'active', 'error', 'waiting')),
  last_sync_at timestamptz,
  last_error text,
  average numeric,
  total integer,
  connected_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.google_connections enable row level security;
drop policy if exists google_connections_read on public.google_connections;
create policy google_connections_read on public.google_connections for select to authenticated using (public.is_member(org_id));

create table if not exists public.google_tokens (
  org_id uuid primary key references public.google_connections on delete cascade,
  refresh_token text not null,
  access_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.google_tokens enable row level security;

do $$
begin
  revoke all on public.google_tokens from public;
  revoke insert, update, delete on public.google_connections from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.google_tokens from anon';
    execute 'revoke all on public.google_connections from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.google_tokens from authenticated';
    execute 'revoke insert, update, delete on public.google_connections from authenticated';
    execute 'grant select on public.google_connections to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.google_tokens to service_role';
    execute 'grant all on public.google_connections to service_role';
  end if;
end $$;
