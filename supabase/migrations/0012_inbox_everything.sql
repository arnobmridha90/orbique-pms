-- 0012: everything into the inbox. Booking-site messages and reviews through Channex (the Messaging & Reviews app),
-- every Channex notification, and the operator's own booking email (bookings@their-domain forwarded to an Orbique
-- address, received by Resend Inbound) land in the app.
--
-- What is here:
--   * inbound_addresses: the Orbique email address each workspace forwards its booking mail to (one per workspace)
--   * inbound_emails: every email Resend handed over, once (by Resend's email id), with what became of it
--   * inbox_conv() also finds conversations by
--       em   an email address the conversation is answered at (a guest, or a booking site's guest relay address)
--       feed a platform's notifications that no booking matched ('airbnb', 'booking', 'agoda', 'tripcom', 'expedia',
--            'channex', 'email' for any other sender)
--       nk   a notice key for a booking's own conversation ('bk:<booking id>'), so notices can find it
--   * the keep trigger also keeps em, emSubject, emRef, feed and kind when the app saves an older copy
--
-- Who can do what: only the server (service role) writes these tables. Members read their own workspace's address.
-- Safe to re-run.

create table if not exists public.inbound_addresses (
  address text primary key check (address = lower(address) and address like '%@%'),
  org_id uuid not null unique references public.orgs on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid
);
alter table public.inbound_addresses enable row level security;
drop policy if exists inbound_addresses_read on public.inbound_addresses;
create policy inbound_addresses_read on public.inbound_addresses for select to authenticated using (public.is_member(org_id));

create table if not exists public.inbound_emails (
  email_id text primary key,
  org_id uuid references public.orgs on delete cascade,
  received_at timestamptz not null default now(),
  sender text,
  subject text,
  status text not null default 'new' check (status in ('new', 'done', 'ignored', 'error')),
  result jsonb,
  error text
);
create index if not exists inbound_emails_org_idx on public.inbound_emails (org_id, received_at desc);
alter table public.inbound_emails enable row level security;

do $$
declare t text;
begin
  foreach t in array array['public.inbound_addresses', 'public.inbound_emails'] loop
    execute 'revoke all on ' || t || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on ' || t || ' from anon'; end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on ' || t || ' from authenticated'; end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant all on ' || t || ' to service_role'; end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then grant select on public.inbound_addresses to authenticated; end if;
end $$;

alter table public.channex_calls drop constraint if exists channex_calls_source_check;
alter table public.channex_calls add constraint channex_calls_source_check
  check (source in ('delta', 'full', 'setup', 'booking', 'ack', 'feed', 'iframe', 'channels', 'messages', 'reviews', 'apps'));

create index if not exists records_conv_em_idx on public.records (org_id, (data->>'em')) where coll = 'conversations';
create index if not exists records_conv_feed_idx on public.records (org_id, (data->>'feed')) where coll = 'conversations';
create index if not exists records_conv_nk_idx on public.records (org_id, (data->>'nk')) where coll = 'conversations';

-- as in 0010, with the em / feed / nk keys
create or replace function public.inbox_conv(p_org uuid, p_key text, p_val text, p_bid text, p_extra jsonb, p_now text) returns text
language plpgsql set search_path = '' as $$
declare v_id text; v_loose text; v_data jsonb; v_extra jsonb := coalesce(p_extra, '{}'::jsonb);
begin
  if p_org is null or p_key is null or p_key not in ('wa', 'cx', 'em', 'feed', 'nk') or coalesce(p_val, '') = '' then return null; end if;
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
      update public.records set data = (data - 'contact' - 'kind') || jsonb_build_object('bookingId', p_bid), updated_by = null
       where org_id = p_org and coll = 'conversations' and id = v_id;
    elsif v_id is null then
      v_id := public.guest__uid('C');
      insert into public.records (org_id, coll, id, data, updated_by)
      values (p_org, 'conversations', v_id, jsonb_build_object('id', v_id, 'bookingId', p_bid, 'unread', 0, 'messages', '[]'::jsonb, 'createdAt', p_now), null);
    elsif v_loose is not null then
      perform public.inbox__merge(p_org, v_loose, v_id);
    end if;
    v_extra := v_extra - 'contact' - 'kind';
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
  if coalesce(v_data->>'bookingId', '') <> '' then v_extra := v_extra - 'contact' - 'kind'; end if;
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_extra from jsonb_each(v_extra) e where jsonb_typeof(e.value) <> 'null';
  update public.records set data = v_data || v_extra || jsonb_build_object(p_key, p_val, 'bookingId', v_data->'bookingId'), updated_by = null
   where org_id = p_org and coll = 'conversations' and id = v_id;
  return v_id;
end $$;

-- as in 0010, keeping the email and notification keys too
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
    select count(*) into n from jsonb_array_elements(missing) x(m) where x.m->>'from' in ('guest', 'system');
    new.data := new.data || jsonb_build_object('unread', public.inbox__num(new.data->'unread') + n);
  end if;
  new.data := jsonb_set(new.data, '{messages}', kept);
  foreach k in array array['wa', 'waLastIn', 'cx', 'cxBooking', 'ota', 'lang', 'em', 'emSubject', 'emRef', 'feed', 'nk', 'kind'] loop
    if old.data ? k and not new.data ? k then new.data := new.data || jsonb_build_object(k, old.data->k); end if;
  end loop;
  return new;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.inbox_conv(uuid, text, text, text, jsonb, text)'] loop
    execute 'revoke all on function ' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ' || f || ' from anon'; end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function ' || f || ' from authenticated'; end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function ' || f || ' to service_role'; end if;
  end loop;
end $$;
