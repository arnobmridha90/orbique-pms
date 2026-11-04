-- 0024: Team chat (app/pages/team.js; docs/notes/team-chat.md): messages between the staff of a workspace, apart from
-- the guest inbox. One "All staff" chat per workspace that every active member with Team chat is in, direct chats with
-- one person, and named groups of chosen staff.
--
-- What is here:
--   * team__staff(org, user), team__level(org, user): the member's staff id (active, not suspended in staffMeta) and
--     their Team chat level in Staff Access ('none' | 'view' | 'edit'), the same rule as the app's
--     O.sectionLevel(id, 'team') (app/core.js): owners 'edit'; else the person's override 'section:team'; else their
--     role's saved level (rolePerms); a role saved before Team chat existed gets the default, 'edit', as does every role
--     when rolePerms was never saved. View reads chats, Edit also writes and starts chats.
--   * team_chats (kind 'all' | 'direct' | 'group'), team_chat_members (who is in a direct chat or a group, and everyone's
--     read time and mute; for All staff a row only keeps those two), team_messages (text and one file each).
--     Row level security: a member reads a chat, its people and its messages only while they are in it
--     (team_can_read): All staff for anyone with Team chat, other chats only with a member row. Messages are added by
--     their sender (team_can_send: Edit level, an active workspace) and never changed or removed by members.
--     Chats and member rows change only through the functions below. Not in public.records, which every member reads.
--   * team_list, team_open, team_manage, team_read, team_mute: what the page calls (security definer, each checks the
--     caller). team_push_claim: for /api/alerts only (service role): claims a new message once and returns who gets a
--     phone alert (people in the chat with Team chat, not the sender, not muted there).
--   * push_devices.booking_alerts: phones of owners and ops managers get booking alerts as before; every other member's
--     phone now registers too, for Team chat alerts only (api/alerts.js register-device).
--   * the private Storage bucket team-files at <org id>/<chat id>/<file>, 20 MB, photos, PDF, Office files, text,
--     MP4 videos. Members reach it directly; the policies require team_can_read for that chat (and to upload,
--     team_can_send). Files open only with short-lived signed addresses.
--   * realtime for the three tables (Supabase checks the select policies for each subscriber).
--
-- reset_org() is not changed: Team chat is the team's own conversation, not workspace data a reset or the demo replaces.
-- Re-runnable: if not exists / create or replace / drop ... if exists everywhere; no data is changed.

-- ---------- who may ----------
create or replace function public.team__staff(p_org uuid, p_user uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_staff text; meta jsonb;
begin
  if p_org is null or p_user is null then return null; end if;
  select m.staff_id into v_staff from public.members m where m.org_id = p_org and m.user_id = p_user and m.status = 'active';
  if v_staff is null then return null; end if;
  select b.data->'v'->v_staff into meta from public.blobs b where b.org_id = p_org and b.key = 'staffMeta';
  if jsonb_typeof(meta) = 'object' and meta->>'status' = 'suspended' then return null; end if;
  return v_staff;
end $$;

create or replace function public.team__level(p_org uuid, p_user uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_staff text; v_role text; meta jsonb; ov jsonb; perms jsonb; saved jsonb; lvl text;
begin
  v_staff := public.team__staff(p_org, p_user);
  if v_staff is null then return 'none'; end if;
  select m.role into v_role from public.members m where m.org_id = p_org and m.user_id = p_user;
  if v_role = 'owner' then return 'edit'; end if;
  select b.data->'v'->v_staff into meta from public.blobs b where b.org_id = p_org and b.key = 'staffMeta';
  ov := case when jsonb_typeof(meta) = 'object' and jsonb_typeof(meta->'overrides') = 'object' then meta->'overrides' else '{}'::jsonb end;
  if ov ? 'section:team' then
    lvl := coalesce(nullif(ov->>'section:team', ''), 'none');
  else
    select case when jsonb_typeof(b.data->'v') = 'object' then b.data->'v' end into perms from public.blobs b where b.org_id = p_org and b.key = 'rolePerms';
    if perms is null then
      lvl := 'edit';                                         -- never saved: the defaults, Team chat on for every role
    else
      saved := case when jsonb_typeof(perms->v_role) = 'object' then perms->v_role end;
      if saved is null or jsonb_typeof(saved->'sections') <> 'object' then lvl := 'none';
      elsif not (saved->'sections' ? 'team') then lvl := 'edit';   -- saved before Team chat existed: the default
      else lvl := coalesce(saved->'sections'->>'team', 'none');
      end if;
    end if;
  end if;
  return case when lvl in ('view', 'edit') then lvl else 'none' end;
end $$;

-- ---------- tables ----------
create table if not exists public.team_chats (
  org_id uuid not null references public.orgs on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  kind text not null check (kind in ('all', 'direct', 'group')),
  name text not null default '' check (char_length(name) <= 80),
  dm_key text,                                   -- direct: the two staff ids, sorted, joined by ':'
  created_by text,
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (org_id, id),
  check ((kind = 'all') = (id = 'all')),
  check ((kind = 'direct') = (dm_key is not null))
);
create unique index if not exists team_chats_dm_idx on public.team_chats (org_id, dm_key) where kind = 'direct';

create table if not exists public.team_chat_members (
  org_id uuid not null,
  chat_id text not null,
  staff_id text not null check (staff_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  added_by text,
  added_at timestamptz not null default clock_timestamp(),
  last_read_at timestamptz,
  muted boolean not null default false,
  primary key (org_id, chat_id, staff_id),
  foreign key (org_id, chat_id) references public.team_chats (org_id, id) on delete cascade
);
create index if not exists team_chat_members_staff_idx on public.team_chat_members (org_id, staff_id);

create table if not exists public.team_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  chat_id text not null,
  sender text not null,
  body text not null default '' check (char_length(body) <= 4000),
  file jsonb check (file is null or (jsonb_typeof(file) = 'object' and pg_column_size(file) <= 2048)),
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  foreign key (org_id, chat_id) references public.team_chats (org_id, id) on delete cascade,
  check (char_length(body) > 0 or file is not null)
);
create index if not exists team_messages_chat_idx on public.team_messages (org_id, chat_id, created_at desc);

-- ---------- per chat ----------
create or replace function public.team__in(p_org uuid, p_chat text, p_user uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_staff text; v_kind text;
begin
  if public.team__level(p_org, p_user) = 'none' then return false; end if;
  v_staff := public.team__staff(p_org, p_user);
  select c.kind into v_kind from public.team_chats c where c.org_id = p_org and c.id = p_chat;
  if v_kind is null then return false; end if;
  return v_kind = 'all' or exists (select 1 from public.team_chat_members m where m.org_id = p_org and m.chat_id = p_chat and m.staff_id = v_staff);
end $$;

create or replace function public.team_can_read(p_org uuid, p_chat text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.team__in(p_org, p_chat, auth.uid());
$$;

create or replace function public.team_me(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select public.team__staff(p_org, auth.uid());
$$;

create or replace function public.team_can_send(p_org uuid, p_chat text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_write(p_org) and public.team__level(p_org, auth.uid()) = 'edit' and public.team__in(p_org, p_chat, auth.uid());
$$;

-- a file path '<org id>/<chat id>/<file>': may the signed-in member reach it (p_write: also upload or remove it)
create or replace function public.team_files_can(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare seg text[] := string_to_array(coalesce(p_name, ''), '/'); o uuid;
begin
  if array_length(seg, 1) is distinct from 3 or seg[3] = '' or seg[2] !~ '^[A-Za-z0-9_-]{1,64}$' then return false; end if;
  if seg[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  o := seg[1]::uuid;
  if coalesce(p_write, false) then return public.team_can_send(o, seg[2]); end if;
  return public.team_can_read(o, seg[2]);
end $$;

-- ---------- row level security ----------
alter table public.team_chats enable row level security;
alter table public.team_chat_members enable row level security;
alter table public.team_messages enable row level security;

drop policy if exists team_chats_read on public.team_chats;
create policy team_chats_read on public.team_chats for select to authenticated using (public.team_can_read(org_id, id));
drop policy if exists team_chat_members_read on public.team_chat_members;
create policy team_chat_members_read on public.team_chat_members for select to authenticated using (public.team_can_read(org_id, chat_id));
drop policy if exists team_messages_read on public.team_messages;
create policy team_messages_read on public.team_messages for select to authenticated using (public.team_can_read(org_id, chat_id));
drop policy if exists team_messages_insert on public.team_messages;
create policy team_messages_insert on public.team_messages for insert to authenticated
  with check (public.team_can_send(org_id, chat_id) and sender = public.team_me(org_id)
              and (file is null or (jsonb_typeof(file->'path') = 'string' and public.team_files_can(file->>'path', false)
                                    and split_part(file->>'path', '/', 1) = org_id::text and split_part(file->>'path', '/', 2) = chat_id)));
-- no update or delete policies: members never change or remove messages, chats or member rows directly

-- a new message: the server's time (the client cannot set it, nor notified_at), and the chat moves up the list
create or replace function public.team__on_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.created_at := clock_timestamp();
  if auth.uid() is not null then new.notified_at := null; end if;
  update public.team_chats set last_at = new.created_at where org_id = new.org_id and id = new.chat_id;
  if new.sender is not null then
    insert into public.team_chat_members (org_id, chat_id, staff_id, added_by, last_read_at)
    values (new.org_id, new.chat_id, new.sender, new.sender, new.created_at)
    on conflict (org_id, chat_id, staff_id) do update set last_read_at = excluded.last_read_at;
  end if;
  return new;
end $$;
drop trigger if exists team_messages_new on public.team_messages;
create trigger team_messages_new before insert on public.team_messages for each row execute function public.team__on_message();

do $$
begin
  revoke all on public.team_chats, public.team_chat_members, public.team_messages from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on public.team_chats, public.team_chat_members, public.team_messages from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.team_chats, public.team_chat_members, public.team_messages from authenticated';
    execute 'grant select on public.team_chats, public.team_chat_members, public.team_messages to authenticated';
    execute 'grant insert (org_id, chat_id, sender, body, file) on public.team_messages to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.team_chats, public.team_chat_members, public.team_messages to service_role';
  end if;
end $$;

-- ---------- what the page calls ----------
-- The caller's chats: {me, level, chats: [{id, kind, name, dmKey, createdBy, createdAt, lastAt, members, unread, muted,
-- lastReadAt, last}]}. members is null for All staff (everyone). unread counts others' messages after the caller last
-- read the chat, else after they were added (All staff: after they joined the workspace). Makes the All staff chat
-- the first time.
create or replace function public.team_list(p_org uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me text := public.team__staff(p_org, auth.uid()); v_level text := public.team__level(p_org, auth.uid()); v_joined timestamptz; out jsonb;
begin
  if v_me is null or v_level = 'none' then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.team_chats (org_id, id, kind, name) values (p_org, 'all', 'all', '') on conflict do nothing;
  select m.created_at into v_joined from public.members m where m.org_id = p_org and m.user_id = auth.uid();
  select coalesce(jsonb_agg(x.j order by (x.j->>'kind') = 'all' desc, x.last_at desc, x.id), '[]'::jsonb) into out from (
    select c.id, c.last_at, jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'name', c.name, 'dmKey', c.dm_key, 'createdBy', c.created_by, 'createdAt', c.created_at, 'lastAt', c.last_at,
      'members', case when c.kind = 'all' then null else
        (select coalesce(jsonb_agg(mm.staff_id order by mm.added_at, mm.staff_id), '[]'::jsonb) from public.team_chat_members mm where mm.org_id = p_org and mm.chat_id = c.id) end,
      'muted', coalesce(me.muted, false),
      'lastReadAt', me.last_read_at,
      'unread', (select count(*) from (select 1 from public.team_messages t where t.org_id = p_org and t.chat_id = c.id and t.sender <> v_me
                   and t.created_at > coalesce(me.last_read_at, case when c.kind = 'all' then v_joined else me.added_at end, '-infinity'::timestamptz) limit 999) u),
      'last', (select jsonb_build_object('id', t.id, 'sender', t.sender, 'body', left(t.body, 200), 'file', t.file, 'at', t.created_at)
                 from public.team_messages t where t.org_id = p_org and t.chat_id = c.id order by t.created_at desc limit 1)
    ) as j
    from public.team_chats c
    left join public.team_chat_members me on me.org_id = c.org_id and me.chat_id = c.id and me.staff_id = v_me
    where c.org_id = p_org and (c.kind = 'all' or me.staff_id is not null)
  ) x;
  return jsonb_build_object('me', v_me, 'level', v_level, 'chats', out);
end $$;

-- Start a chat. p_kind 'direct': p_staff = [the other person]; the pair's existing chat is returned if there is one.
-- p_kind 'group': p_name and the people (the caller is added). Everyone named must be an active member of the workspace.
-- Needs Edit and an active workspace. Returns the chat id.
create or replace function public.team_open(p_org uuid, p_kind text, p_name text, p_staff text[]) returns text
language plpgsql security definer set search_path = '' as $$
declare v_me text := public.team__staff(p_org, auth.uid()); v_ids text[]; v_id text; v_key text; v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if v_me is null or public.team__level(p_org, auth.uid()) <> 'edit' or not public.can_write(p_org) then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct s), '{}') into v_ids from unnest(coalesce(p_staff, '{}'::text[])) s where s is not null and s <> v_me;
  if exists (select 1 from unnest(v_ids) s where not exists (select 1 from public.members m where m.org_id = p_org and m.staff_id = s and m.status = 'active')) then
    raise exception 'not a member of this workspace' using errcode = '22023';
  end if;
  if p_kind = 'direct' then
    if cardinality(v_ids) <> 1 then raise exception 'choose one person' using errcode = '22023'; end if;
    v_key := least(v_me, v_ids[1]) || ':' || greatest(v_me, v_ids[1]);
    perform pg_advisory_xact_lock(hashtext('team:' || p_org::text || ':' || v_key));
    select c.id into v_id from public.team_chats c where c.org_id = p_org and c.kind = 'direct' and c.dm_key = v_key;
    if v_id is null then
      v_id := 'd' || replace(gen_random_uuid()::text, '-', '');
      insert into public.team_chats (org_id, id, kind, dm_key, created_by) values (p_org, v_id, 'direct', v_key, v_me);
    end if;
    insert into public.team_chat_members (org_id, chat_id, staff_id, added_by)
    select p_org, v_id, s, v_me from unnest(array[v_me, v_ids[1]]) s on conflict do nothing;
    if found then update public.team_chats set last_at = last_at where org_id = p_org and id = v_id; end if; -- realtime nudge
    return v_id;
  elsif p_kind = 'group' then
    if v_name = '' or char_length(v_name) > 80 then raise exception 'give the group a name of up to 80 characters' using errcode = '22023'; end if;
    if cardinality(v_ids) < 1 then raise exception 'choose at least one person' using errcode = '22023'; end if;
    if cardinality(v_ids) + 1 > 50 then raise exception 'a group can have up to 50 people' using errcode = '22023'; end if;
    v_id := 'g' || replace(gen_random_uuid()::text, '-', '');
    insert into public.team_chats (org_id, id, kind, name, created_by) values (p_org, v_id, 'group', v_name, v_me);
    insert into public.team_chat_members (org_id, chat_id, staff_id, added_by, last_read_at) values (p_org, v_id, v_me, v_me, clock_timestamp());
    insert into public.team_chat_members (org_id, chat_id, staff_id, added_by) select p_org, v_id, s, v_me from unnest(v_ids) s;
    return v_id;
  end if;
  raise exception 'unknown kind of chat' using errcode = '22023';
end $$;

-- Change a group: rename (p_name, null = keep), add people, remove people. The maker of the group or the account owner,
-- while in it. Anyone in a group may remove only themselves (leave). Needs Edit and an active workspace.
create or replace function public.team_manage(p_org uuid, p_chat text, p_name text, p_add text[], p_remove text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me text := public.team__staff(p_org, auth.uid()); c record; v_boss boolean; v_add text[]; v_rem text[]; v_name text; n int;
begin
  if v_me is null or public.team__level(p_org, auth.uid()) <> 'edit' or not public.can_write(p_org) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.team_chats t where t.org_id = p_org and t.id = p_chat for update;
  if not found or c.kind <> 'group' or not public.team__in(p_org, p_chat, auth.uid()) then raise exception 'not allowed' using errcode = '42501'; end if;
  v_boss := c.created_by = v_me or public.member_role(p_org) = 'owner';
  select coalesce(array_agg(distinct s), '{}') into v_add from unnest(coalesce(p_add, '{}'::text[])) s where s is not null;
  select coalesce(array_agg(distinct s), '{}') into v_rem from unnest(coalesce(p_remove, '{}'::text[])) s where s is not null;
  if not v_boss and not (p_name is null and cardinality(v_add) = 0 and v_rem = array[v_me]) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_name is not null then
    v_name := btrim(regexp_replace(p_name, '\s+', ' ', 'g'));
    if v_name = '' or char_length(v_name) > 80 then raise exception 'give the group a name of up to 80 characters' using errcode = '22023'; end if;
    update public.team_chats set name = v_name where org_id = p_org and id = p_chat;
  end if;
  if cardinality(v_add) > 0 then
    if exists (select 1 from unnest(v_add) s where not exists (select 1 from public.members m where m.org_id = p_org and m.staff_id = s and m.status = 'active')) then
      raise exception 'not a member of this workspace' using errcode = '22023';
    end if;
    insert into public.team_chat_members (org_id, chat_id, staff_id, added_by) select p_org, p_chat, s, v_me from unnest(v_add) s on conflict do nothing;
  end if;
  if cardinality(v_rem) > 0 then
    delete from public.team_chat_members m where m.org_id = p_org and m.chat_id = p_chat and m.staff_id = any (v_rem);
  end if;
  select count(*) into n from public.team_chat_members m where m.org_id = p_org and m.chat_id = p_chat;
  if n > 50 then raise exception 'a group can have up to 50 people' using errcode = '22023'; end if;
  -- Realtime nudge: a change to the chat row reaches the people still in it (row level security is checked on updates).
  -- Membership rows are not published, because realtime does not check row level security on deletes.
  update public.team_chats set last_at = last_at where org_id = p_org and id = p_chat;
end $$;

-- The caller has read the chat (now), or mutes / unmutes its phone alerts. View is enough; not in a paused workspace.
create or replace function public.team__mine(p_org uuid, p_chat text, p_read boolean, p_muted boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me text := public.team__staff(p_org, auth.uid());
begin
  if v_me is null or not public.team__in(p_org, p_chat, auth.uid()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not public.can_write(p_org) then return; end if;
  insert into public.team_chat_members as m (org_id, chat_id, staff_id, added_by, last_read_at, muted)
  values (p_org, p_chat, v_me, v_me, case when p_read then clock_timestamp() end, coalesce(p_muted, false))
  on conflict (org_id, chat_id, staff_id) do update
    set last_read_at = case when p_read then clock_timestamp() else m.last_read_at end,
        muted = coalesce(p_muted, m.muted);
end $$;
create or replace function public.team_read(p_org uuid, p_chat text) returns void
language sql security definer set search_path = '' as $$ select public.team__mine(p_org, p_chat, true, null); $$;
create or replace function public.team_mute(p_org uuid, p_chat text, p_muted boolean) returns void
language sql security definer set search_path = '' as $$ select public.team__mine(p_org, p_chat, false, coalesce(p_muted, false)); $$;

-- /api/alerts (service role): the first claim of a new message by its sender (p_user) returns
-- {chat: {id, kind, name}, sender, senderName, body, file, users: [user ids to alert]}; later claims, other people and
-- messages older than 15 minutes get null. Alerts go to people in the chat with Team chat, never the sender, not to
-- anyone who muted the chat.
create or replace function public.team_push_claim(p_org uuid, p_msg uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me text := public.team__staff(p_org, p_user); t record; c record; v_users jsonb; v_name text;
begin
  if v_me is null then return null; end if;
  update public.team_messages m set notified_at = now()
   where m.id = p_msg and m.org_id = p_org and m.sender = v_me and m.notified_at is null and m.created_at > now() - interval '15 minutes'
  returning m.* into t;
  if not found then return null; end if;
  select * into c from public.team_chats x where x.org_id = p_org and x.id = t.chat_id;
  select coalesce(jsonb_agg(distinct u.user_id), '[]'::jsonb) into v_users from public.members u
   where u.org_id = p_org and u.status = 'active' and u.user_id <> p_user and u.staff_id <> v_me
     and public.team__level(p_org, u.user_id) <> 'none'
     and (c.kind = 'all' or exists (select 1 from public.team_chat_members mm where mm.org_id = p_org and mm.chat_id = c.id and mm.staff_id = u.staff_id))
     and not exists (select 1 from public.team_chat_members mm where mm.org_id = p_org and mm.chat_id = c.id and mm.staff_id = u.staff_id and mm.muted);
  select r.data->>'name' into v_name from public.records r where r.org_id = p_org and r.coll = 'staff' and r.id = v_me and not r.deleted;
  return jsonb_build_object('chat', jsonb_build_object('id', c.id, 'kind', c.kind, 'name', c.name), 'sender', v_me, 'senderName', coalesce(v_name, ''),
    'body', t.body, 'file', t.file, 'users', v_users);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.team__staff(uuid, uuid)', 'public.team__level(uuid, uuid)', 'public.team__in(uuid, text, uuid)',
                           'public.team__mine(uuid, text, boolean, boolean)', 'public.team_push_claim(uuid, uuid, uuid)', 'public.team__on_message()'] loop
    execute 'revoke all on function ' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ' || f || ' from anon'; end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function ' || f || ' from authenticated'; end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function ' || f || ' to service_role'; end if;
  end loop;
  foreach f in array array['public.team_me(uuid)', 'public.team_can_read(uuid, text)', 'public.team_can_send(uuid, text)', 'public.team_files_can(text, boolean)',
                           'public.team_list(uuid)', 'public.team_open(uuid, text, text, text[])', 'public.team_manage(uuid, text, text, text[], text[])',
                           'public.team_read(uuid, text)', 'public.team_mute(uuid, text, boolean)'] loop
    execute 'revoke all on function ' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ' || f || ' from anon'; end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'grant execute on function ' || f || ' to authenticated'; end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function ' || f || ' to service_role'; end if;
  end loop;
end $$;

-- ---------- phones: booking alerts only for the phones that asked for them ----------
alter table public.push_devices add column if not exists booking_alerts boolean not null default true;

-- ---------- realtime ----------
-- Messages (inserts only) and chat rows (inserts and updates) are published; realtime checks row level security on them.
-- team_chat_members is deliberately not published: realtime sends deletes to every subscriber without checking it.
alter table public.team_messages replica identity full;
alter table public.team_chats replica identity full;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.team_messages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.team_chats; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------- the private bucket and its policies (Supabase Storage; a plain Postgres without it skips this) ----------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('team-files', 'team-files', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
      'application/pdf', 'text/plain', 'text/csv', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'video/mp4', 'video/quicktime'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
  if to_regclass('storage.objects') is not null then
    begin
      execute 'drop policy if exists team_files_read on storage.objects';
      execute 'create policy team_files_read on storage.objects for select to authenticated using (bucket_id = ''team-files'' and public.team_files_can(name, false))';
      execute 'drop policy if exists team_files_insert on storage.objects';
      execute 'create policy team_files_insert on storage.objects for insert to authenticated with check (bucket_id = ''team-files'' and public.team_files_can(name, true))';
      -- the uploader may take back a file whose message could not be sent
      execute 'drop policy if exists team_files_delete on storage.objects';
      execute 'create policy team_files_delete on storage.objects for delete to authenticated using (bucket_id = ''team-files'' and owner = auth.uid() and public.team_files_can(name, true))';
    exception when insufficient_privilege then
      raise warning 'team-files: the Storage policies could not be created (%), so members cannot reach the files yet', sqlerrm;
    end;
  end if;
end $$;
