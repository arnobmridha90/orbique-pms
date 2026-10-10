-- Orbique PMS core schema: operators (orgs), their members, and the workspace data store.
-- Every operator's data is private to its active members (row level security).

create extension if not exists pgcrypto;

create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'trial',
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.members (
  org_id uuid not null references public.orgs on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  staff_id text not null,
  role text not null check (role in ('owner', 'ops', 'housekeeping', 'frontdesk', 'maintenance', 'accountant')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  invited_by uuid,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id),
  unique (org_id, staff_id)
);
create index if not exists members_user_idx on public.members (user_id);

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.subscription_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid(),
  company text,
  contact_name text,
  phone text,
  units int,
  message text,
  status text not null default 'new' check (status in ('new', 'approved', 'declined')),
  created_at timestamptz not null default now()
);

-- One row per record of a records collection (bookings, tasks, properties ...). data = the JS object as the app holds it.
create table if not exists public.records (
  org_id uuid not null references public.orgs on delete cascade,
  coll text not null,
  id text not null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (org_id, coll, id)
);
create index if not exists records_guest_token_idx on public.records ((data->>'guestToken')) where coll = 'bookings';

-- One row per settings/log value. data = {"v": <value>} because a value can be an array.
create table if not exists public.blobs (
  org_id uuid not null references public.orgs on delete cascade,
  key text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (org_id, key)
);

-- ---------- who is who ----------
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create or replace function public.member_role(p_org uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.role from members m where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active';
$$;

create or replace function public.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.member_role(p_org) is not null;
$$;

create or replace function public.can_write(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.member_role(p_org) is not null and exists (select 1 from orgs o where o.id = p_org and o.status = 'active');
$$;

-- ---------- row level security ----------
alter table public.orgs enable row level security;
alter table public.members enable row level security;
alter table public.platform_admins enable row level security;
alter table public.subscription_requests enable row level security;
alter table public.records enable row level security;
alter table public.blobs enable row level security;

drop policy if exists orgs_read on public.orgs;
create policy orgs_read on public.orgs for select to authenticated using (public.is_member(id) or public.is_platform_admin());
drop policy if exists orgs_owner_update on public.orgs;
create policy orgs_owner_update on public.orgs for update to authenticated
  using (public.member_role(id) = 'owner') with check (public.member_role(id) = 'owner');

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_member(org_id) or public.is_platform_admin());
drop policy if exists members_owner_update on public.members;
create policy members_owner_update on public.members for update to authenticated
  using (public.member_role(org_id) = 'owner' and user_id <> auth.uid())
  with check (public.member_role(org_id) = 'owner' and role <> 'owner');

drop policy if exists platform_admins_read on public.platform_admins;
create policy platform_admins_read on public.platform_admins for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

drop policy if exists requests_insert on public.subscription_requests;
create policy requests_insert on public.subscription_requests for insert to authenticated with check (user_id = auth.uid());
drop policy if exists requests_read on public.subscription_requests;
create policy requests_read on public.subscription_requests for select to authenticated using (user_id = auth.uid() or public.is_platform_admin());
drop policy if exists requests_admin_update on public.subscription_requests;
create policy requests_admin_update on public.subscription_requests for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists records_read on public.records;
create policy records_read on public.records for select to authenticated using (public.is_member(org_id));
drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
  with check (public.can_write(org_id) and (coll <> 'staff' or public.member_role(org_id) in ('owner', 'ops')));
drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
  using (public.can_write(org_id) and (coll <> 'staff' or public.member_role(org_id) in ('owner', 'ops')))
  with check (public.can_write(org_id) and (coll <> 'staff' or public.member_role(org_id) in ('owner', 'ops')));

drop policy if exists blobs_read on public.blobs;
create policy blobs_read on public.blobs for select to authenticated using (public.is_member(org_id));
drop policy if exists blobs_insert on public.blobs;
create policy blobs_insert on public.blobs for insert to authenticated
  with check (public.can_write(org_id) and (key not in ('rolePerms', 'staffMeta') or public.member_role(org_id) = 'owner'));
drop policy if exists blobs_update on public.blobs;
create policy blobs_update on public.blobs for update to authenticated
  using (public.can_write(org_id) and (key not in ('rolePerms', 'staffMeta') or public.member_role(org_id) = 'owner'))
  with check (public.can_write(org_id) and (key not in ('rolePerms', 'staffMeta') or public.member_role(org_id) = 'owner'));
-- no delete policies: the app soft-deletes records (deleted = true); reset_org() clears a workspace

-- stamp who changed a row and when (the client cannot fake it)
create or replace function public.stamp_change() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists records_stamp on public.records;
create trigger records_stamp before insert or update on public.records for each row execute function public.stamp_change();
drop trigger if exists blobs_stamp on public.blobs;
create trigger blobs_stamp before insert or update on public.blobs for each row execute function public.stamp_change();

-- ---------- realtime ----------
alter table public.records replica identity full;
alter table public.blobs replica identity full;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.records; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.blobs; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------- RPCs used by the app ----------
-- who am I: platform admin flag and my workspaces
create or replace function public.my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'userId', auth.uid(),
    'email', (select email from auth.users where id = auth.uid()),
    'platformAdmin', public.is_platform_admin(),
    'workspaces', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'plan', o.plan, 'status', o.status,
                                          'role', m.role, 'staffId', m.staff_id, 'memberStatus', m.status) order by o.name)
      from members m join orgs o on o.id = m.org_id where m.user_id = auth.uid()), '[]'::jsonb)
  );
$$;

-- platform admin: operators with counts only (no guest or money data)
create or replace function public.platform_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'plan', o.plan, 'status', o.status, 'createdAt', o.created_at,
      'members', (select count(*) from members m where m.org_id = o.id and m.status = 'active'),
      'owners', (select coalesce(jsonb_agg(u.email), '[]'::jsonb) from members m join auth.users u on u.id = m.user_id where m.org_id = o.id and m.role = 'owner'),
      'units', (select count(*) from records r where r.org_id = o.id and r.coll = 'properties' and not r.deleted and coalesce(r.data->>'status', 'active') <> 'archived'),
      'lastActivity', (select max(r.updated_at) from records r where r.org_id = o.id)
    ) order by o.created_at)
    from orgs o), '[]'::jsonb);
end $$;

create or replace function public.set_org_status(p_org uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update orgs set status = p_status where id = p_org;
end $$;

create or replace function public.set_org_plan(p_org uuid, p_plan text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update orgs set plan = p_plan where id = p_org;
end $$;

-- owner: wipe the workspace data (keeps the people). Used by "reset" and before loading the demo again.
create or replace function public.reset_org(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.member_role(p_org) <> 'owner' or public.member_role(p_org) is null then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from records r where r.org_id = p_org and not (r.coll = 'staff' and exists (select 1 from members m where m.org_id = p_org and m.staff_id = r.id));
  delete from blobs b where b.org_id = p_org and b.key not in ('workspaceBrand');
end $$;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.records, public.blobs to authenticated;
grant select, update on public.orgs, public.members to authenticated;
grant select on public.platform_admins to authenticated;
grant select, insert, update on public.subscription_requests to authenticated;
revoke all on function public.platform_overview() from anon;
revoke all on function public.set_org_status(uuid, text) from anon;
revoke all on function public.set_org_plan(uuid, text) from anon;
revoke all on function public.reset_org(uuid) from anon;
