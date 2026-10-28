-- 0018: connect a WhatsApp number that stays on the WhatsApp Business app (Meta's coexistence, through Embedded Signup).
--
-- What is here:
--   * whatsapp_numbers gains waba_id (the WhatsApp Business account the number is in), coexist (true when the number is
--     also on the WhatsApp Business phone app, so messages sent from the phone come in as echoes) and sync (when the
--     contacts and the older chats were asked for, and Meta's request ids: {contacts: {at, id}, history: {at, id}}).
--   * whatsapp_tokens: the token Meta gives for that WhatsApp account when the owner finishes Embedded Signup. Only the
--     server reads or writes it (no policy, nothing granted to signed-in users); a number connected by its Phone number
--     ID has no row and uses WHATSAPP_TOKEN.
--   * whatsapp_contacts: the names in the phone app's contacts, for the chats those numbers start. Server only.
--   * inbox_merge(): add several messages to a conversation at once (the older chats WhatsApp shares when the number is
--     connected), skipping those already there by xid, with the conversation's messages then in time order.
--
-- Safe to re-run: if not exists / create or replace / drop ... if exists everywhere; no data is changed.

alter table public.whatsapp_numbers add column if not exists waba_id text;
alter table public.whatsapp_numbers add column if not exists coexist boolean not null default false;
alter table public.whatsapp_numbers add column if not exists sync jsonb;

create table if not exists public.whatsapp_tokens (
  phone_number_id text primary key references public.whatsapp_numbers on delete cascade,
  token text not null,
  updated_at timestamptz not null default now()
);
alter table public.whatsapp_tokens enable row level security;
do $$
begin
  revoke all on public.whatsapp_tokens from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.whatsapp_tokens from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on public.whatsapp_tokens from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant all on public.whatsapp_tokens to service_role; end if;
end $$;

-- The phone app's contacts (smb_app_state_sync): the names chats with those numbers get. Server only.
create table if not exists public.whatsapp_contacts (
  org_id uuid not null references public.orgs on delete cascade,
  phone text not null,
  name text not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, phone)
);
alter table public.whatsapp_contacts enable row level security;
do $$
begin
  revoke all on public.whatsapp_contacts from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.whatsapp_contacts from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on public.whatsapp_contacts from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant all on public.whatsapp_contacts to service_role; end if;
end $$;

-- Add p_msgs (a JSON array of messages) to conversation p_cid, once each (by xid), and p_patch to the conversation;
-- p_unread is added to its unread count. The messages are then ordered by time (stable: messages with the same time
-- keep their order, the ones already there first). With no new messages, p_patch is still applied (a contact's name).
-- A waLastIn in p_patch is kept only when it is later than the conversation's.
-- Returns how many were added (0 when the conversation is gone).
create or replace function public.inbox_merge(p_org uuid, p_cid text, p_msgs jsonb, p_unread int, p_patch jsonb) returns int
language plpgsql set search_path = '' as $$
declare v jsonb; added jsonb; merged jsonb; n int;
begin
  if p_msgs is null or jsonb_typeof(p_msgs) <> 'array' then return 0; end if;
  select data into v from public.records where org_id = p_org and coll = 'conversations' and id = p_cid and not deleted for update;
  if v is null then return 0; end if;
  select coalesce(jsonb_agg(d.m order by d.k), '[]'::jsonb) into added from (
    select distinct on (coalesce(a.m->>'xid', a.k::text)) a.m, a.k
      from jsonb_array_elements(p_msgs) with ordinality a(m, k)
     where jsonb_typeof(a.m) = 'object'
       and not (a.m ? 'xid' and exists (select 1 from jsonb_array_elements(public.inbox__msgs(v)) x(m) where x.m->>'xid' = a.m->>'xid'))
     order by coalesce(a.m->>'xid', a.k::text), a.k) d;
  n := jsonb_array_length(added);
  -- waLastIn (the guest's last message, for WhatsApp's 24 hours) only moves forward: older chats can arrive after a new one
  if p_patch ? 'waLastIn' and coalesce(v->>'waLastIn', '') >= coalesce(p_patch->>'waLastIn', '') then p_patch := p_patch - 'waLastIn'; end if;
  if n = 0 and coalesce(p_patch, '{}'::jsonb) = '{}'::jsonb then return 0; end if;
  select coalesce(jsonb_agg(z.m order by z.m->>'time', z.src, z.k), '[]'::jsonb) into merged from (
    select e.m, e.k, 0 as src from jsonb_array_elements(public.inbox__msgs(v)) with ordinality e(m, k)
    union all
    select f.m, f.k, 1 from jsonb_array_elements(added) with ordinality f(m, k)) z;
  v := (v || coalesce(p_patch, '{}'::jsonb)) || jsonb_build_object('messages', merged,
    'unread', public.inbox__num(v->'unread') + greatest(0, coalesce(p_unread, 0)));
  update public.records set data = v, updated_by = null where org_id = p_org and coll = 'conversations' and id = p_cid;
  return n;
end $$;

do $$
begin
  revoke all on function public.inbox_merge(uuid, text, jsonb, int, jsonb) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.inbox_merge(uuid, text, jsonb, int, jsonb) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.inbox_merge(uuid, text, jsonb, int, jsonb) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.inbox_merge(uuid, text, jsonb, int, jsonb) to service_role; end if;
end $$;
