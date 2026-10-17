-- 0010: the guest inbox goes live. Guest messages from WhatsApp (Meta's WhatsApp Business Platform) and from booking
-- sites through Channex (Booking.com, Airbnb, Expedia) land in the booking's conversation, the same `conversations`
-- record the inbox and the guest app already use, and replies go back out the way the guest wrote.
--
-- What is here:
--   * whatsapp_numbers: which workspace a WhatsApp business number (Meta's phone number id) belongs to
--   * inbox_conv(): the conversation for an incoming message (by WhatsApp number or Channex thread, else by booking,
--     else a new one that is not linked to a booking yet)
--   * inbox_append(): add one message to a conversation, once (messages from outside carry an xid such as "wa:<id>")
--   * inbox_patch(): change one message (delivery ticks, a translation)
--   * a trigger that keeps those outside messages when the app saves a conversation it loaded before they arrived
--   * channex_calls.source may be 'messages'
--
-- Who can do what: only the server (service role) calls the functions and writes whatsapp_numbers. Members read their
-- own workspace's WhatsApp number. Message fields the server adds: xid, via ('whatsapp', 'booking', 'airbnb',
-- 'expedia', 'channex'), status ('sent', 'delivered', 'read', 'failed'), error, lang (the language it was written in),
-- tr ({to, text}: a translation), orig / origLang (what the team wrote before it was translated), media ({id, mime,
-- name}: a WhatsApp file fetched on demand). Conversation fields: wa (the guest's WhatsApp number, digits only),
-- waLastIn (when the guest last wrote on WhatsApp, UTC; replies are free for 24 hours after it), cx (Channex message
-- thread), cxBooking (Channex booking id), ota, lang (the guest's language), contact ({name, phone}: for a chat not
-- linked to a booking yet).
--
-- Safe to re-run: if not exists / create or replace / drop ... if exists everywhere; no data is changed.

create table if not exists public.whatsapp_numbers (
  phone_number_id text primary key,
  org_id uuid not null references public.orgs on delete cascade,
  display_phone text,
  verified_name text,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index if not exists whatsapp_numbers_org_idx on public.whatsapp_numbers (org_id);
alter table public.whatsapp_numbers enable row level security;
drop policy if exists whatsapp_numbers_read on public.whatsapp_numbers;
create policy whatsapp_numbers_read on public.whatsapp_numbers for select to authenticated using (public.is_member(org_id));
do $$
begin
  revoke all on public.whatsapp_numbers from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.whatsapp_numbers from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.whatsapp_numbers from authenticated;
    grant select on public.whatsapp_numbers to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant all on public.whatsapp_numbers to service_role; end if;
end $$;

alter table public.channex_calls drop constraint if exists channex_calls_source_check;
alter table public.channex_calls add constraint channex_calls_source_check
  check (source in ('delta', 'full', 'setup', 'booking', 'ack', 'feed', 'iframe', 'channels', 'messages'));

-- conversations are found by these keys
create index if not exists records_conv_booking_idx on public.records (org_id, (data->>'bookingId')) where coll = 'conversations';
create index if not exists records_conv_wa_idx on public.records (org_id, (data->>'wa')) where coll = 'conversations';
create index if not exists records_conv_cx_idx on public.records (org_id, (data->>'cx')) where coll = 'conversations';

create or replace function public.inbox__msgs(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p->'messages') = 'array' then p->'messages' else '[]'::jsonb end;
$$;

create or replace function public.inbox__num(p jsonb) returns int
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p) = 'number' then greatest(0, least(9999, floor((p #>> '{}')::numeric)))::int else 0 end;
$$;

-- move the messages of conversation p_src into p_dst (in time order) and remove p_src
create or replace function public.inbox__merge(p_org uuid, p_src text, p_dst text) returns void
language plpgsql set search_path = '' as $$
declare s jsonb; t jsonb; k text; merged jsonb;
begin
  if p_src = p_dst then return; end if;
  select data into s from public.records where org_id = p_org and coll = 'conversations' and id = p_src and not deleted for update;
  select data into t from public.records where org_id = p_org and coll = 'conversations' and id = p_dst and not deleted for update;
  if s is null or t is null then return; end if;
  select coalesce(jsonb_agg(z.m order by z.m->>'time', z.src, z.k), '[]'::jsonb) into merged from (
    select a.m, a.k, 0 as src from jsonb_array_elements(public.inbox__msgs(t)) with ordinality a(m, k)
    union all
    select b.m, b.k, 1 from jsonb_array_elements(public.inbox__msgs(s)) with ordinality b(m, k)
     where not (jsonb_typeof(b.m) = 'object' and b.m ? 'xid'
                and exists (select 1 from jsonb_array_elements(public.inbox__msgs(t)) c(m) where c.m->>'xid' = b.m->>'xid'))
  ) z;
  t := jsonb_set(t, '{messages}', merged) || jsonb_build_object('unread', public.inbox__num(t->'unread') + public.inbox__num(s->'unread'));
  foreach k in array array['wa', 'waLastIn', 'cx', 'cxBooking', 'ota', 'lang'] loop
    if s ? k and not t ? k then t := t || jsonb_build_object(k, s->k); end if;
  end loop;
  update public.records set data = t, updated_by = null where org_id = p_org and coll = 'conversations' and id = p_dst;
  update public.records set deleted = true, updated_by = null where org_id = p_org and coll = 'conversations' and id = p_src;
end $$;

-- The conversation an incoming message belongs to; returns its id.
--   p_key 'wa' (p_val = the guest's number, digits) or 'cx' (p_val = the Channex message thread id)
--   p_bid the booking the message was matched to (records id), or null when none was found
--   p_extra fields to keep on the conversation (cxBooking, ota, waLastIn, lang, contact; contact only while it has no booking)
--   p_now the time for a new conversation, as the app writes times (Malaysia time, 'YYYY-MM-DDTHH:MM')
-- With a booking: that booking's conversation (an earlier chat on the same number or thread that had no booking yet is
-- moved into it). Without one: the latest conversation with that number or thread, else a new one with no booking.
create or replace function public.inbox_conv(p_org uuid, p_key text, p_val text, p_bid text, p_extra jsonb, p_now text) returns text
language plpgsql set search_path = '' as $$
declare v_id text; v_loose text; v_data jsonb; v_extra jsonb := coalesce(p_extra, '{}'::jsonb);
begin
  if p_org is null or p_key is null or p_key not in ('wa', 'cx') or coalesce(p_val, '') = '' then return null; end if;
  perform pg_advisory_xact_lock(hashtext('inbox:' || p_org::text || ':' || p_key || ':' || p_val));
  select r.id into v_loose from public.records r
   where r.org_id = p_org and r.coll = 'conversations' and not r.deleted and r.data->>p_key = p_val
     and coalesce(r.data->>'bookingId', '') = ''
   order by r.updated_at desc limit 1;
  if coalesce(p_bid, '') <> '' then
    select r.id into v_id from public.records r
     where r.org_id = p_org and r.coll = 'conversations' and not r.deleted and r.data->>'bookingId' = p_bid
     order by r.id collate "C" limit 1;
    if v_id is null and v_loose is not null then
      v_id := v_loose;
      update public.records set data = (data - 'contact') || jsonb_build_object('bookingId', p_bid), updated_by = null
       where org_id = p_org and coll = 'conversations' and id = v_id;
    elsif v_id is null then
      v_id := public.guest__uid('C');
      insert into public.records (org_id, coll, id, data, updated_by)
      values (p_org, 'conversations', v_id, jsonb_build_object('id', v_id, 'bookingId', p_bid, 'unread', 0, 'messages', '[]'::jsonb, 'createdAt', p_now), null);
    elsif v_loose is not null then
      perform public.inbox__merge(p_org, v_loose, v_id);
    end if;
    v_extra := v_extra - 'contact';
  else
    select r.id into v_id from public.records r
     where r.org_id = p_org and r.coll = 'conversations' and not r.deleted and r.data->>p_key = p_val
     order by r.updated_at desc limit 1;
    if v_id is null then
      v_id := public.guest__uid('C');
      insert into public.records (org_id, coll, id, data, updated_by)
      values (p_org, 'conversations', v_id, jsonb_build_object('id', v_id, 'bookingId', null, 'unread', 0, 'messages', '[]'::jsonb, 'createdAt', p_now), null);
    end if;
  end if;
  select data into v_data from public.records where org_id = p_org and coll = 'conversations' and id = v_id for update;
  if coalesce(v_data->>'bookingId', '') <> '' then v_extra := v_extra - 'contact'; end if;
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_extra from jsonb_each(v_extra) e where jsonb_typeof(e.value) <> 'null';
  update public.records set data = v_data || v_extra || jsonb_build_object(p_key, p_val, 'bookingId', v_data->'bookingId'), updated_by = null
   where org_id = p_org and coll = 'conversations' and id = v_id;
  return v_id;
end $$;

-- Add p_msg to conversation p_cid once (a message whose xid is already there is skipped), add p_unread to the unread
-- count and merge p_patch into the conversation. Returns the conversation, or null when it was skipped or not found.
create or replace function public.inbox_append(p_org uuid, p_cid text, p_msg jsonb, p_unread int, p_patch jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v jsonb;
begin
  if p_msg is null or jsonb_typeof(p_msg) <> 'object' then return null; end if;
  select data into v from public.records where org_id = p_org and coll = 'conversations' and id = p_cid and not deleted for update;
  if v is null then return null; end if;
  if p_msg ? 'xid' and exists (select 1 from jsonb_array_elements(public.inbox__msgs(v)) m where m->>'xid' = p_msg->>'xid') then return null; end if;
  v := (v || coalesce(p_patch, '{}'::jsonb)) || jsonb_build_object('messages', public.inbox__msgs(v) || jsonb_build_array(p_msg),
    'unread', public.inbox__num(v->'unread') + greatest(0, coalesce(p_unread, 0)));
  update public.records set data = v, updated_by = null where org_id = p_org and coll = 'conversations' and id = p_cid;
  return v;
end $$;

-- Merge p_patch into one message: the one with xid p_xid (in p_cid, or in any of the workspace's conversations when
-- p_cid is null), else message number p_index (0-based) of p_cid if its text is still p_text. A status never goes
-- back (sent < delivered < read; failed only replaces sent). Returns {id, data} of the conversation, or null.
create or replace function public.inbox_patch(p_org uuid, p_cid text, p_xid text, p_index int, p_text text, p_patch jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id text := p_cid; v jsonb; arr jsonb; i int := -1; m jsonb; patch jsonb := coalesce(p_patch, '{}'::jsonb);
  rank_old int; rank_new int;
begin
  if coalesce(v_id, '') = '' and coalesce(p_xid, '') <> '' then
    select r.id into v_id from public.records r
     where r.org_id = p_org and r.coll = 'conversations' and not r.deleted
       and r.data->'messages' @> jsonb_build_array(jsonb_build_object('xid', p_xid))
     order by r.updated_at desc limit 1;
  end if;
  if v_id is null then return null; end if;
  select data into v from public.records where org_id = p_org and coll = 'conversations' and id = v_id and not deleted for update;
  if v is null then return null; end if;
  arr := public.inbox__msgs(v);
  if coalesce(p_xid, '') <> '' then
    select (e.k - 1)::int into i from jsonb_array_elements(arr) with ordinality e(m, k) where e.m->>'xid' = p_xid limit 1;
  elsif p_index is not null and p_index >= 0 and p_index < jsonb_array_length(arr) and coalesce(arr->p_index->>'text', '') = coalesce(p_text, '') then
    i := p_index;
  end if;
  if i is null or i < 0 then return null; end if;
  m := arr->i;
  if jsonb_typeof(m) <> 'object' then return null; end if;
  if patch ? 'status' then
    rank_old := case m->>'status' when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 4 else 0 end;
    rank_new := case patch->>'status' when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 4 else 0 end;
    if (patch->>'status' = 'failed' and rank_old > 1) or (patch->>'status' <> 'failed' and rank_new <= rank_old and rank_old <> 4) or rank_old = 4 then
      patch := patch - 'status' - 'error';
    end if;
  end if;
  if patch = '{}'::jsonb then return jsonb_build_object('id', v_id, 'data', v); end if;
  v := jsonb_set(v, array['messages', i::text], m || patch);
  update public.records set data = v, updated_by = null where org_id = p_org and coll = 'conversations' and id = v_id;
  return jsonb_build_object('id', v_id, 'data', v);
end $$;

-- The app saves a whole conversation. When it saves one it loaded before a message from outside arrived (or before a
-- tick or a translation changed), keep the server's messages: missing ones go back in time order (and count as unread
-- when the guest wrote them), changed ones keep the server's version, and the WhatsApp / Channex keys stay.
create or replace function public.inbox__keep() returns trigger
language plpgsql set search_path = '' as $$
declare om jsonb; nm jsonb; kept jsonb; missing jsonb; k text; n int;
begin
  if new.coll <> 'conversations' or auth.uid() is null or new.deleted or old.deleted then return new; end if;
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
    select count(*) into n from jsonb_array_elements(missing) x(m) where x.m->>'from' = 'guest';
    new.data := new.data || jsonb_build_object('unread', public.inbox__num(new.data->'unread') + n);
  end if;
  new.data := jsonb_set(new.data, '{messages}', kept);
  foreach k in array array['wa', 'waLastIn', 'cx', 'cxBooking', 'ota', 'lang'] loop
    if old.data ? k and not new.data ? k then new.data := new.data || jsonb_build_object(k, old.data->k); end if;
  end loop;
  return new;
end $$;
drop trigger if exists records_inbox_keep on public.records;
create trigger records_inbox_keep before update on public.records for each row
  when (new.coll = 'conversations') execute function public.inbox__keep();

do $$
declare f text;
begin
  foreach f in array array['public.inbox__merge(uuid, text, text)', 'public.inbox_conv(uuid, text, text, text, jsonb, text)',
                           'public.inbox_append(uuid, text, jsonb, int, jsonb)', 'public.inbox_patch(uuid, text, text, int, text, jsonb)'] loop
    execute 'revoke all on function ' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ' || f || ' from anon'; end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function ' || f || ' from authenticated'; end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function ' || f || ' to service_role'; end if;
  end loop;
end $$;
