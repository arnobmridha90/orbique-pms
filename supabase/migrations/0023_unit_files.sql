-- 0023: the unit file (Properties, a unit's "Unit file" tab; app/pages/unitfile.js): the lease from the owner, the
-- owner's payment details, the unit's bills, building access, documents and notes.
--
-- What is here:
--   * unit_file_can(org): may the signed-in member see and change unit files. The same rule as the app's
--     O.can('properties.file') (app/core.js) and built like website_can() (0017): an active member who is not suspended
--     in staffMeta; owners always; anyone else needs the Properties section at View or Edit and the "See and edit unit
--     files" action switched on, from their own overrides (staffMeta[staffId].overrides) first, then their role's saved
--     permissions (rolePerms), then the app's defaults. By default no role but the account owner has the action, so
--     every other role starts without it (an owner can grant it in Staff Access). rolePerms and staffMeta are written by
--     owners only (0001, 0016).
--   * unit_files: one row per unit (org_id, property_id), data = the unit file as the app holds it. Bank account
--     numbers, IC numbers and router logins live here and never in the properties record, which every member reads.
--     Row level security: only members with unit_file_can() read, add, change or remove a row, and only in an active
--     workspace for changes (can_write). anon has no access at all.
--   * the private Storage bucket unit-docs (tenancy agreements and other documents), at <org id>/<property id>/<file>,
--     20 MB, PDF / JPEG / PNG / WebP / HEIC. Unlike inbox-media (0022, where only the server reaches the files), members
--     reach these directly, and the bucket's policies require unit_file_can() for the workspace named by the first part
--     of the path (unit_docs_can()). Files are opened only with short-lived signed addresses (the bucket is not public).
--   * reset_org() as in 0006, and it also clears the workspace's unit files (the rows; the app removes the documents).
--
-- Re-runnable: functions are replaced, policies dropped and created again, the bucket upserted.

create or replace function public.unit_file_can(p_org uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  m record; meta jsonb; ov jsonb; perms jsonb; saved jsonb; lvl text; act constant text := 'properties.file';
  -- the app's O.DEFAULT_ROLE_PERMS for the Properties section; no role has properties.file by default
  defaults constant jsonb := '{"ops": {"sections": {"properties": "edit"}}, "housekeeping": {"sections": {"properties": "view"}},
                               "frontdesk": {"sections": {"properties": "view"}}, "maintenance": {"sections": {"properties": "view"}},
                               "accountant": {"sections": {}}}';
begin
  if p_org is null or auth.uid() is null then return false; end if;
  select mm.role, mm.staff_id into m from members mm where mm.org_id = p_org and mm.user_id = auth.uid() and mm.status = 'active';
  if not found then return false; end if;
  select case when jsonb_typeof(b.data->'v') = 'object' then b.data->'v' end into meta from blobs b where b.org_id = p_org and b.key = 'staffMeta';
  meta := case when jsonb_typeof(meta->m.staff_id) = 'object' then meta->m.staff_id else '{}'::jsonb end;
  if meta->>'status' = 'suspended' then return false; end if;
  if m.role = 'owner' then return true; end if;
  ov := case when jsonb_typeof(meta->'overrides') = 'object' then meta->'overrides' else '{}'::jsonb end;
  select case when jsonb_typeof(b.data->'v') = 'object' then b.data->'v' end into perms from blobs b where b.org_id = p_org and b.key = 'rolePerms';
  if perms is null then perms := defaults; end if;
  saved := case when jsonb_typeof(perms->m.role) = 'object' then perms->m.role else null end;
  -- the section level: View is enough (a 'see' action)
  if ov ? 'section:properties' then
    lvl := coalesce(nullif(ov->>'section:properties', ''), 'none');
  elsif saved is not null and jsonb_typeof(saved->'sections') = 'object' and not (saved->'sections' ? 'properties') then
    lvl := coalesce(defaults->m.role->'sections'->>'properties', 'none');
  else
    lvl := coalesce(saved->'sections'->>'properties', 'none');
  end if;
  if lvl not in ('view', 'edit') then return false; end if;
  -- the action: the person's own override, then the saved role (a role saved before this action existed: off)
  if ov ? act then return jsonb_typeof(ov->act) = 'boolean' and (ov->act)::text = 'true'; end if;
  return coalesce(jsonb_typeof(saved->'actions'->act) = 'boolean' and (saved->'actions'->act)::text = 'true', false);
end $$;

-- a document path '<org id>/<property id>/<file>': may the signed-in member reach it (p_write: also change it)
create or replace function public.unit_docs_can(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare seg text[] := string_to_array(coalesce(p_name, ''), '/'); o uuid;
begin
  if array_length(seg, 1) is distinct from 3 or seg[2] = '' or seg[3] = '' or seg[2] !~ '^[A-Za-z0-9_-]{1,80}$' then return false; end if;
  if seg[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  o := seg[1]::uuid;
  if not public.unit_file_can(o) then return false; end if;
  return not coalesce(p_write, false) or public.can_write(o);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.unit_file_can(uuid)', 'public.unit_docs_can(text, boolean)'] loop
    execute 'revoke all on function ' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ' || f || ' from anon'; end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'grant execute on function ' || f || ' to authenticated'; end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function ' || f || ' to service_role'; end if;
  end loop;
end $$;

create table if not exists public.unit_files (
  org_id uuid not null references public.orgs on delete cascade,
  property_id text not null check (property_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 262144),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (org_id, property_id)
);
alter table public.unit_files enable row level security;
drop trigger if exists unit_files_stamp on public.unit_files;
create trigger unit_files_stamp before insert or update on public.unit_files for each row execute function public.stamp_change();

drop policy if exists unit_files_read on public.unit_files;
create policy unit_files_read on public.unit_files for select to authenticated
  using (public.unit_file_can(org_id));
drop policy if exists unit_files_insert on public.unit_files;
create policy unit_files_insert on public.unit_files for insert to authenticated
  with check (public.can_write(org_id) and public.unit_file_can(org_id));
drop policy if exists unit_files_update on public.unit_files;
create policy unit_files_update on public.unit_files for update to authenticated
  using (public.can_write(org_id) and public.unit_file_can(org_id))
  with check (public.can_write(org_id) and public.unit_file_can(org_id));
drop policy if exists unit_files_delete on public.unit_files;
create policy unit_files_delete on public.unit_files for delete to authenticated
  using (public.can_write(org_id) and public.unit_file_can(org_id));

revoke all on public.unit_files from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on public.unit_files from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.unit_files from authenticated';
    execute 'grant select, insert, update, delete on public.unit_files to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant select, insert, update, delete on public.unit_files to service_role'; end if;
end $$;

-- as in 0006 (refuses while channels are connected), and the workspace's unit files go too
create or replace function public.reset_org(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.member_role(p_org) <> 'owner' or public.member_role(p_org) is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if exists (select 1 from public.channex_properties p where p.org_id = p_org and public.channex__connected(p.status)) then
    raise exception 'Disconnect channels in Channels first' using errcode = '55000';
  end if;
  delete from public.records r where r.org_id = p_org and not (r.coll = 'staff' and exists (select 1 from public.members m where m.org_id = p_org and m.staff_id = r.id));
  delete from public.blobs b where b.org_id = p_org and b.key not in ('workspaceBrand');
  delete from public.unit_files u where u.org_id = p_org;
end $$;

-- the private bucket and its policies (Supabase Storage; a plain Postgres without it skips this). Without the
-- policies nobody but the server reaches the files, so a database where they cannot be made fails closed.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('unit-docs', 'unit-docs', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
  if to_regclass('storage.objects') is not null then
    begin
      execute 'drop policy if exists unit_docs_read on storage.objects';
      execute 'create policy unit_docs_read on storage.objects for select to authenticated using (bucket_id = ''unit-docs'' and public.unit_docs_can(name, false))';
      execute 'drop policy if exists unit_docs_insert on storage.objects';
      execute 'create policy unit_docs_insert on storage.objects for insert to authenticated with check (bucket_id = ''unit-docs'' and public.unit_docs_can(name, true))';
      execute 'drop policy if exists unit_docs_update on storage.objects';
      execute 'create policy unit_docs_update on storage.objects for update to authenticated using (bucket_id = ''unit-docs'' and public.unit_docs_can(name, true)) with check (bucket_id = ''unit-docs'' and public.unit_docs_can(name, true))';
      execute 'drop policy if exists unit_docs_delete on storage.objects';
      execute 'create policy unit_docs_delete on storage.objects for delete to authenticated using (bucket_id = ''unit-docs'' and public.unit_docs_can(name, true))';
    exception when insufficient_privilege then
      raise warning 'unit-docs: the Storage policies could not be created (%), so members cannot reach the documents yet', sqlerrm;
    end;
  end if;
end $$;
