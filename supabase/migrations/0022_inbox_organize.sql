-- 0022: organising the inbox, and photos and videos to guests.
--
-- What is here:
--   * inbox_mark(): change a conversation's own flags in one step, under the row lock (api/messages.js 'organize'):
--       pinned, archived, unread, lists (the workspace's named lists it is on), favBy (the user ids who starred it:
--       favourites are personal), trashedAt / trashedBy (in Deleted, Malaysia time 'YYYY-MM-DDTHH:MM')
--   * inbox_append() as in 0010, and a message that counts as unread (from the guest, or a site's notification) takes
--     the chat out of Archived and out of Deleted, so no guest is missed
--   * the keep trigger as in 0012, and the app can no longer change those flags by saving a whole conversation: they
--     belong to the server (the app asks api/messages.js), so a copy loaded before a change cannot undo it
--   * inbox_lists(): add, rename or remove one of the workspace's named lists (blob inboxLists) under the row lock
--   * inbox_purge_due() and inbox_forget(): the conversations in Deleted since before a time (30 days: the 'config'
--     action for one workspace when the inbox opens, and the nightly job for all), and removing one of them for good.
--     The server removes the chat's files in between; a removed chat stays as a tombstone (deleted = true, data {})
--     so other devices drop it too.
--   * inbox_uploads: files a member was given an upload address for and has not sent yet, so the ones never sent
--     (cancelled, failed, window closed) are removed after a day instead of staying in the bucket
--   * the private Storage bucket inbox-media: photos and videos the team sends to guests, and guests' large WhatsApp
--     videos, at <org id>/<conversation id>/<file>. Members have no access to it: the server checks the permission and
--     hands out short-lived signed upload and download addresses (Vercel caps request bodies at 4.5 MB, so files
--     never go through the api functions).
--
-- Who can do what: only the server (service role) calls the functions. Safe to re-run.

create or replace function public.inbox_mark(p_org uuid, p_cid text, p_set jsonb, p_unset text[], p_add jsonb, p_remove jsonb, p_unread_min int)
returns jsonb
language plpgsql set search_path = '' as $$
declare v jsonb; k text; val jsonb; arr jsonb;
begin
  select data into v from public.records where org_id = p_org and coll = 'conversations' and id = p_cid and not deleted for update;
  if v is null then return null; end if;
  v := (v - coalesce(p_unset, '{}'::text[])) || coalesce(p_set, '{}'::jsonb);
  -- p_add / p_remove: {key: value}, a value added to (once) or taken out of the array under key
  for k, val in select e.key, e.value from jsonb_each(coalesce(p_add, '{}'::jsonb)) e loop
    arr := case when jsonb_typeof(v->k) = 'array' then v->k else '[]'::jsonb end;
    if not arr @> jsonb_build_array(val) then arr := arr || jsonb_build_array(val); end if;
    v := v || jsonb_build_object(k, arr);
  end loop;
  for k, val in select e.key, e.value from jsonb_each(coalesce(p_remove, '{}'::jsonb)) e loop
    if jsonb_typeof(v->k) = 'array' then
      select coalesce(jsonb_agg(x.e order by x.n), '[]'::jsonb) into arr from jsonb_array_elements(v->k) with ordinality x(e, n) where x.e <> val;
      v := case when jsonb_array_length(arr) = 0 then v - k else v || jsonb_build_object(k, arr) end;
    end if;
  end loop;
  if p_unread_min is not null then v := v || jsonb_build_object('unread', greatest(public.inbox__num(v->'unread'), p_unread_min)); end if;
  update public.records set data = v, updated_by = null where org_id = p_org and coll = 'conversations' and id = p_cid;
  return jsonb_build_object('id', p_cid, 'data', v);
end $$;

-- as in 0010; an unread message brings the chat back from Archived and Deleted
create or replace function public.inbox_append(p_org uuid, p_cid text, p_msg jsonb, p_unread int, p_patch jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v jsonb;
begin
  if p_msg is null or jsonb_typeof(p_msg) <> 'object' then return null; end if;
  select data into v from public.records where org_id = p_org and coll = 'conversations' and id = p_cid and not deleted for update;
  if v is null then return null; end if;
  if p_msg ? 'xid' and exists (select 1 from jsonb_array_elements(public.inbox__msgs(v)) m where m->>'xid' = p_msg->>'xid') then return null; end if;
  if coalesce(p_unread, 0) > 0 then v := v - 'archived' - 'trashedAt' - 'trashedBy'; end if;
  v := (v || coalesce(p_patch, '{}'::jsonb)) || jsonb_build_object('messages', public.inbox__msgs(v) || jsonb_build_array(p_msg),
    'unread', public.inbox__num(v->'unread') + greatest(0, coalesce(p_unread, 0)));
  update public.records set data = v, updated_by = null where org_id = p_org and coll = 'conversations' and id = p_cid;
  return v;
end $$;

-- as in 0012, and the server's flags (pinned, archived, lists, favBy, trashedAt, trashedBy) stay as the server has them
create or replace function public.inbox__keep() returns trigger
language plpgsql set search_path = '' as $$
declare om jsonb; nm jsonb; kept jsonb; missing jsonb; k text; n int;
begin
  if new.coll <> 'conversations' or auth.uid() is null or new.deleted or old.deleted then return new; end if;
  foreach k in array array['pinned', 'archived', 'lists', 'favBy', 'trashedAt', 'trashedBy'] loop
    new.data := new.data - k;
    if old.data ? k then new.data := new.data || jsonb_build_object(k, old.data->k); end if;
  end loop;
  om := public.inbox__msgs(old.data);
  if not exists (select 1 from jsonb_array_elements(om) e(m) where jsonb_typeof(e.m) = 'object' and e.m ? 'xid') then return new; end if;
  nm := public.inbox__msgs(new.data);
  select coalesce(jsonb_agg(coalesce(o.m, a.m) order by a.k), '[]'::jsonb) into kept
    from jsonb_array_elements(nm) with ordinality a(m, k)
    left join lateral (select x.m from jsonb_array_elements(om) x(m)
                        where jsonb_typeof(a.m) = 'object' and a.m ? 'xid' and x.m->>'xid' = a.m->>'xid' limit 1) o on true;
  select coalesce(jsonb_agg(x.m order by x.k), '[]'::jsonb) into missing
    from jsonb_array_elements(om) with ordinality x(m, k)
   where jsonb_typeof(x.m) = 'object' and x.m ? 'xid'
     and not exists (select 1 from jsonb_array_elements(nm) y(m) where y.m->>'xid' = x.m->>'xid');
  if jsonb_array_length(missing) > 0 then
    select coalesce(jsonb_agg(z.m order by z.m->>'time', z.src, z.k), '[]'::jsonb) into kept from (
      select a.m, a.k, 0 as src from jsonb_array_elements(kept) with ordinality a(m, k)
      union all
      select b.m, b.k, 1 from jsonb_array_elements(missing) with ordinality b(m, k)) z;
    select count(*) into n from jsonb_array_elements(missing) x(m) where x.m->>'from' in ('guest', 'system');
    new.data := new.data || jsonb_build_object('unread', public.inbox__num(new.data->'unread') + n);
  end if;
  new.data := jsonb_set(new.data, '{messages}', kept);
  foreach k in array array['wa', 'waLastIn', 'cx', 'cxBooking', 'ota', 'lang', 'em', 'emSubject', 'emRef', 'feed', 'nk', 'kind'] loop
    if old.data ? k and not new.data ? k then new.data := new.data || jsonb_build_object(k, old.data->k); end if;
  end loop;
  return new;
end $$;

-- the workspace's named lists (blob inboxLists, {v: [{id, name}]}): add, rename or remove one under the row lock, so two
-- people changing lists at the same time both count (api/messages.js 'lists'). Names are cleaned by the server; here
-- they must be unique ignoring case. -> {lists} or {error: 'taken' | 'missing' | 'full' | 'bad-op'}
create or replace function public.inbox_lists(p_org uuid, p_op text, p_id text, p_name text, p_new_id text, p_max int)
returns jsonb
language plpgsql set search_path = '' as $$
declare d jsonb; l jsonb; out jsonb := '[]'::jsonb; hit boolean := false;
begin
  insert into public.blobs (org_id, key, data, updated_by) values (p_org, 'inboxLists', '{"v":[]}'::jsonb, null)
  on conflict (org_id, key) do nothing;
  select data into d from public.blobs where org_id = p_org and key = 'inboxLists' for update;
  for l in select e.value from jsonb_array_elements(case when jsonb_typeof(d->'v') = 'array' then d->'v' else '[]'::jsonb end) e loop
    if jsonb_typeof(l) <> 'object' or jsonb_typeof(l->'id') <> 'string' or jsonb_typeof(l->'name') <> 'string' then continue; end if;
    if l->>'id' = p_id then hit := true; end if;
    if p_op in ('add', 'rename') and lower(l->>'name') = lower(p_name) and (p_op = 'add' or l->>'id' <> p_id) then return jsonb_build_object('error', 'taken'); end if;
    if p_op = 'remove' and l->>'id' = p_id then continue; end if;
    if p_op = 'rename' and l->>'id' = p_id then l := l || jsonb_build_object('name', p_name); end if;
    out := out || jsonb_build_array(l);
  end loop;
  if p_op not in ('add', 'rename', 'remove') then return jsonb_build_object('error', 'bad-op'); end if;
  if p_op in ('rename', 'remove') and not hit then return jsonb_build_object('error', 'missing'); end if;
  if p_op = 'add' then
    if jsonb_array_length(out) >= coalesce(p_max, 30) then return jsonb_build_object('error', 'full'); end if;
    out := out || jsonb_build_array(jsonb_build_object('id', p_new_id, 'name', p_name));
  end if;
  update public.blobs set data = jsonb_build_object('v', out), updated_by = null where org_id = p_org and key = 'inboxLists';
  return jsonb_build_object('lists', out);
end $$;

-- uploads handed out by 'media-upload' and not sent yet (api/messages.js). 'send-media' takes the row off; what is
-- still here after a day was cancelled or failed, and the nightly job (and opening the inbox) removes the file.
-- Only the server reads or writes it.
create table if not exists public.inbox_uploads (
  path text primary key,
  org_id uuid not null references public.orgs on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists inbox_uploads_age_idx on public.inbox_uploads (created_at);
alter table public.inbox_uploads enable row level security;
revoke all on public.inbox_uploads from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on public.inbox_uploads from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on public.inbox_uploads from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant select, insert, delete on public.inbox_uploads to service_role'; end if;
end $$;

create index if not exists records_conv_trash_idx on public.records (org_id, (data->>'trashedAt')) where coll = 'conversations' and data ? 'trashedAt';

-- the chats due to be removed for good: in Deleted since before p_before ('YYYY-MM-DDTHH:MM', Malaysia time), at
-- most p_limit, oldest first; p_org null: every workspace. Nothing is removed here: the server removes the chat's
-- files first, then calls inbox_forget(), so a Storage error leaves the chat (and its files) to try again next time.
drop function if exists public.inbox_purge(uuid, text);
create or replace function public.inbox_purge_due(p_org uuid, p_before text, p_limit int) returns table (org_id uuid, id text)
language sql set search_path = '' as $$
  select r.org_id, r.id from public.records r
   where r.coll = 'conversations' and not r.deleted and (p_org is null or r.org_id = p_org)
     and r.data ? 'trashedAt' and coalesce(r.data->>'trashedAt', '') <> '' and r.data->>'trashedAt' < p_before
   order by r.data->>'trashedAt', r.id
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

-- remove one chat for good, only while it is still in Deleted (and went in before p_before, when given). It stays as
-- a tombstone (deleted, data {}), as every other removal in the app does, so devices that were offline see it go on
-- their next catch-up instead of saving it back. -> true when it was removed.
create or replace function public.inbox_forget(p_org uuid, p_cid text, p_before text) returns boolean
language plpgsql set search_path = '' as $$
declare v jsonb;
begin
  select data into v from public.records where org_id = p_org and coll = 'conversations' and id = p_cid and not deleted for update;
  if v is null or coalesce(v->>'trashedAt', '') = '' then return false; end if;
  if p_before is not null and v->>'trashedAt' >= p_before then return false; end if;
  update public.records set data = '{}'::jsonb, deleted = true, updated_by = null where org_id = p_org and coll = 'conversations' and id = p_cid;
  return true;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.inbox_mark(uuid, text, jsonb, text[], jsonb, jsonb, int)', 'public.inbox_append(uuid, text, jsonb, int, jsonb)',
                           'public.inbox_purge_due(uuid, text, int)', 'public.inbox_forget(uuid, text, text)',
                           'public.inbox_lists(uuid, text, text, text, text, int)'] loop
    execute 'revoke all on function ' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ' || f || ' from anon'; end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function ' || f || ' from authenticated'; end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function ' || f || ' to service_role'; end if;
  end loop;
end $$;

-- the private bucket (Supabase Storage; a plain Postgres without it skips this). No policies for members: only the
-- server and the signed addresses it gives out reach the files. 16 MB: WhatsApp's limit for videos.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('inbox-media', 'inbox-media', false, 16777216, array['image/jpeg', 'image/png', 'video/mp4', 'video/3gpp'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;
