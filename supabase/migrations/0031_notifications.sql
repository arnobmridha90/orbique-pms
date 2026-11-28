-- 0031: the bell's shared history (Arnob, 2026-11-24: "the notifications tab needs to show the notifications for the
-- smallest of changes ... there needs to be the notification sound playing for that too").
--
-- One row per thing that happened in a workspace, written by the database itself, so every phone and computer sees the
-- same list, including what happened while Orbique was closed:
--   * notifications: {kind, vars, ref} (the app turns kind + vars into words in the reader's language, app/server/notify.js)
--       actor / actor_staff: who did it (null: a booking site, a guest, the server). The app does not ring for your own.
--       staff: only these team members may read it (Team chat); null: everyone in the workspace (the app also hides
--       kinds a person's access does not cover).
--       key: one row per event, however often the record is saved again (unique per workspace).
--   * notification_seen: per person, the newest notification they have opened the bell on (the unread count).
--   * triggers on records (bookings, guest chats, tasks, reviews, guest requests, damage reports, expenses, owner
--     messages, blocks, rates, timed messages), blobs (prices, system health), channex_alerts (sync problems, double
--     bookings, unassigned arrivals), team_messages and members (new team member).
--   * notif_tick(): every 5 minutes (pg_cron) the time-based ones: overdue tasks, the 9 AM day summary, check-in
--     readiness 2 hours before an arrival, unpaid direct bookings, arrivals without a door code, check-outs without a
--     cleaning task, two bookings in the same unit on the same night.
-- A notification can never stop a save: every trigger swallows its own errors. Re-runnable.

create table if not exists public.notifications (
  id bigserial primary key,
  org_id uuid not null references public.orgs on delete cascade,
  key text not null,
  kind text not null check (kind ~ '^[a-z_]{2,40}$'),
  vars jsonb not null default '{}' check (pg_column_size(vars) <= 4096),
  ref jsonb not null default '{}' check (pg_column_size(ref) <= 1024),
  actor uuid,
  actor_staff text,
  staff text[],
  created_at timestamptz not null default now(),
  unique (org_id, key)
);
create index if not exists notifications_org_idx on public.notifications (org_id, id desc);

create table if not exists public.notification_seen (
  org_id uuid not null references public.orgs on delete cascade,
  user_id uuid not null,
  seen_id bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

alter table public.notifications enable row level security;
alter table public.notification_seen enable row level security;

-- can this signed-in person read a row with this staff list?
create or replace function public.notif__can_read(p_org uuid, p_staff text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_member(p_org) and (p_staff is null or exists (
    select 1 from members m where m.org_id = p_org and m.user_id = auth.uid() and m.staff_id = any (p_staff)));
$$;

drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using (public.notif__can_read(org_id, staff));
-- the app adds the few it works out itself (low stock); always as the person, never for one person only
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
  with check (public.can_write(org_id) and actor = auth.uid() and staff is null);
drop policy if exists notification_seen_rw on public.notification_seen;
create policy notification_seen_rw on public.notification_seen for all to authenticated
  using (user_id = auth.uid() and public.is_member(org_id)) with check (user_id = auth.uid() and public.is_member(org_id));

do $$
begin
  revoke all on public.notifications, public.notification_seen from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.notifications, public.notification_seen, public.notifications_id_seq from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select, insert on public.notifications to authenticated';
    execute 'grant usage on public.notifications_id_seq to authenticated';
    execute 'grant select, insert, update on public.notification_seen to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.notifications, public.notification_seen, public.notifications_id_seq to service_role';
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------- writing one ----------
create or replace function public.notif__add(p_org uuid, p_key text, p_kind text, p_vars jsonb, p_ref jsonb, p_staff text[] default null)
returns void language plpgsql security definer set search_path = public as $$
declare who uuid := auth.uid(); st text;
begin
  if p_org is null or p_key is null then return; end if;
  if who is not null then select staff_id into st from members where org_id = p_org and user_id = who; end if;
  insert into notifications (org_id, key, kind, vars, ref, actor, actor_staff, staff)
  values (p_org, left(p_key, 300), p_kind, jsonb_strip_nulls(coalesce(p_vars, '{}')), jsonb_strip_nulls(coalesce(p_ref, '{}')), who, st, p_staff)
  on conflict (org_id, key) do nothing;
exception when others then
  raise warning 'notifications: % not written: %', p_kind, sqlerrm;
end $$;

create or replace function public.notif__today() returns text language sql stable as $$
  select to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD');
$$;
create or replace function public.notif__now() returns text language sql stable as $$
  select to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD"T"HH24:MI');
$$;
create or replace function public.notif__ids(d jsonb) returns text[] language sql immutable as $$
  select coalesce(array(select distinct x from (
    select jsonb_array_elements_text(case when jsonb_typeof(d->'assigneeIds') = 'array' then d->'assigneeIds' else '[]'::jsonb end) x
    union all select d->>'assigneeId') s where x is not null and x <> '' order by 1), '{}');
$$;

-- ---------- records ----------
create or replace function public.notif__on_record() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n jsonb := new.data;
  o jsonb := case when tg_op = 'UPDATE' then old.data else null end;
  id text := new.id;
  live boolean; was boolean;
  v jsonb; r jsonb; k text; t text;
  ng int; og int; lm jsonb; fields text[] := '{}'; f text; add text[];
  recent text := to_char((now() at time zone 'Asia/Kuala_Lumpur') - interval '3 hours', 'YYYY-MM-DD"T"HH24:MI');
begin
  if tg_op = 'UPDATE' and old.data is not distinct from new.data and old.deleted = new.deleted then return null; end if;

  if new.coll = 'bookings' then
    live := public.alerts__live(n, new.deleted);
    was := case when tg_op = 'UPDATE' then public.alerts__live(o, old.deleted) else false end;
    v := jsonb_build_object('guest', n#>>'{guest,name}', 'unit', n->>'propertyId', 'in', n->>'checkIn', 'out', n->>'checkOut',
      'ch', n->>'channel', 'total', n->'total', 'nights', n->'nights', 'guests', n->'guests');
    r := jsonb_build_object('booking', id);
    if live and not was then
      if tg_op = 'INSERT' and new.deleted then return null; end if;
      v := v || jsonb_build_object('urgent', (n->>'checkIn') <= public.notif__today());
      perform public.notif__add(new.org_id, 'bk_new:' || id || ':' || coalesce(n->>'checkIn', '') || coalesce(n->>'checkOut', ''),
        case when n->>'status' = 'pending' then 'bk_request' else 'bk_new' end, v, r);
      return null;
    end if;
    if was and not live then
      perform public.notif__add(new.org_id, 'bk_cancelled:' || id || ':' || coalesce(n->>'checkIn', ''), 'bk_cancelled', v, r);
      return null;
    end if;
    if not live then return null; end if;
    if coalesce(n->>'checkIn', '') <> coalesce(o->>'checkIn', '') or coalesce(n->>'checkOut', '') <> coalesce(o->>'checkOut', '') then
      perform public.notif__add(new.org_id, 'bk_dates:' || id || ':' || coalesce(n->>'checkIn', '') || coalesce(n->>'checkOut', ''), 'bk_dates',
        v || jsonb_build_object('oldIn', o->>'checkIn', 'oldOut', o->>'checkOut'), r);
    end if;
    if coalesce(o->>'propertyId', '') <> '' and coalesce(n->>'propertyId', '') <> coalesce(o->>'propertyId', '') then
      perform public.notif__add(new.org_id, 'bk_moved:' || id || ':' || coalesce(n->>'propertyId', ''), 'bk_moved', v || jsonb_build_object('oldUnit', o->>'propertyId'), r);
    end if;
    if coalesce(n->>'guests', '') <> coalesce(o->>'guests', '') then
      perform public.notif__add(new.org_id, 'bk_guests:' || id || ':' || coalesce(n->>'guests', ''), 'bk_guests', v || jsonb_build_object('oldGuests', o->'guests'), r);
    end if;
    if coalesce(n->>'total', '') <> coalesce(o->>'total', '') or coalesce(n->>'payout', '') <> coalesce(o->>'payout', '') then
      perform public.notif__add(new.org_id, 'bk_price:' || id || ':' || coalesce(n->>'total', '') || ':' || coalesce(n->>'payout', ''), 'bk_price',
        v || jsonb_build_object('oldTotal', o->'total', 'payout', n->'payout', 'oldPayout', o->'payout'), r);
    end if;
    if coalesce(n->>'status', '') <> coalesce(o->>'status', '') and n->>'status' in ('checked_in', 'checked_out', 'confirmed', 'no_show') then
      perform public.notif__add(new.org_id, 'bk_status:' || id || ':' || (n->>'status') || ':' || coalesce(n->>'checkIn', ''),
        case n->>'status' when 'checked_in' then 'bk_checkin' when 'checked_out' then 'bk_checkout' when 'no_show' then 'bk_noshow' else 'bk_confirmed' end, v, r);
    end if;
    if coalesce(n->>'paidAt', '') <> '' and coalesce(o->>'paidAt', '') = '' then
      perform public.notif__add(new.org_id, 'bk_paid:' || id || ':' || (n->>'paidAt'), 'bk_paid', v || jsonb_build_object('method', n->>'payMethod'), r);
    end if;
    if coalesce(n->>'invoiceSent', 'false') = 'true' and coalesce(o->>'invoiceSent', 'false') <> 'true' then
      perform public.notif__add(new.org_id, 'bk_invoice:' || id || ':' || coalesce(n->>'invoiceNo', ''), 'bk_invoice', v || jsonb_build_object('no', n->>'invoiceNo'), r);
    end if;
    if coalesce(n->>'receiptSent', 'false') = 'true' and coalesce(o->>'receiptSent', 'false') <> 'true' then
      perform public.notif__add(new.org_id, 'bk_receipt:' || id || ':' || coalesce(n->>'receiptNo', ''), 'bk_receipt', v || jsonb_build_object('no', n->>'receiptNo'), r);
    end if;
    if coalesce(n->>'idVerified', 'false') = 'true' and coalesce(o->>'idVerified', 'false') <> 'true' then
      perform public.notif__add(new.org_id, 'gst_id:' || id, 'gst_id', v, r);
    end if;
    if jsonb_typeof(n->'guestCheckin') = 'object' and jsonb_typeof(o->'guestCheckin') is distinct from 'object' then
      perform public.notif__add(new.org_id, 'gst_checkin:' || id, 'gst_checkin', v, r);
    end if;
    if jsonb_typeof(n->'rulesAccepted') = 'object' and jsonb_typeof(o->'rulesAccepted') is distinct from 'object' then
      perform public.notif__add(new.org_id, 'gst_rules:' || id, 'gst_rules', v, r);
    end if;
    if coalesce(n->>'doorCode', '') <> '' and coalesce(n->>'doorCode', '') <> coalesce(o->>'doorCode', '') then
      perform public.notif__add(new.org_id, 'bk_code:' || id || ':' || md5(n->>'doorCode'), 'bk_code', v, r);
    end if;
    if n->>'codeStatus' = 'sent' and coalesce(o->>'codeStatus', '') <> 'sent' then
      perform public.notif__add(new.org_id, 'bk_code_sent:' || id || ':' || md5(coalesce(n->>'doorCode', '')), 'bk_code_sent', v, r);
    end if;
    foreach f in array array['notes', 'otaNotes', 'guest', 'checkInTime', 'checkOutTime', 'ratePlanId', 'payMethod', 'paymentCollect', 'reservationCode'] loop
      if (n->f) is distinct from (o->f) then fields := fields || f; end if;
    end loop;
    if array_length(fields, 1) > 0 then
      perform public.notif__add(new.org_id, 'bk_edit:' || id || ':' || md5(jsonb_build_array(n->'notes', n->'otaNotes', n->'guest', n->'checkInTime', n->'checkOutTime',
        n->'ratePlanId', n->'payMethod', n->'paymentCollect', n->'reservationCode')::text), 'bk_edit', v || jsonb_build_object('fields', to_jsonb(fields)), r);
    end if;
    return null;
  end if;

  if new.coll = 'conversations' then
    if new.deleted or jsonb_typeof(n->'messages') <> 'array' then return null; end if;
    select count(*) into ng from jsonb_array_elements(n->'messages') m where m->>'from' = 'guest';
    og := 0;
    if o is not null and jsonb_typeof(o->'messages') = 'array' then
      select count(*) into og from jsonb_array_elements(o->'messages') m where m->>'from' = 'guest';
    end if;
    if ng <= og then return null; end if;
    select m into lm from jsonb_array_elements(n->'messages') with ordinality as e(m, i) where m->>'from' = 'guest' order by i desc limit 1;
    if coalesce(lm->>'time', '') <> '' and (lm->>'time') < recent then return null; end if; -- an old chat joined or imported
    t := coalesce(nullif(lm->>'text', ''), nullif(lm->>'body', ''), nullif(lm->>'transcript', ''), '');
    select data#>>'{guest,name}', data->>'propertyId' into k, f from records
      where org_id = new.org_id and coll = 'bookings' and records.id = n->>'bookingId';
    perform public.notif__add(new.org_id, 'msg:' || id || ':' || coalesce(lm->>'xid', ng::text), 'gst_msg',
      jsonb_build_object('guest', coalesce(k, n#>>'{contact,name}', n->>'nk', n->>'em'), 'unit', f, 'text', left(t, 220), 'type', lm->>'type',
        'via', coalesce(lm->>'via', n->>'ota'), 'count', ng - og),
      jsonb_build_object('conv', id, 'booking', n->>'bookingId'));
    return null;
  end if;

  if new.coll = 'tasks' then
    if new.deleted then return null; end if;
    v := jsonb_build_object('title', n->>'title', 'type', n->>'type', 'unit', n->>'propertyId', 'due', n->>'due', 'auto', n->>'auto',
      'to', to_jsonb(public.notif__ids(n)), 'booking', n->>'bookingId');
    r := jsonb_build_object('task', id, 'booking', n->>'bookingId');
    if tg_op = 'INSERT' then
      if coalesce(n->>'status', '') <> 'done' and (coalesce(n->>'auto', '') = '' or cardinality(public.notif__ids(n)) > 0) then
        perform public.notif__add(new.org_id, 'task_new:' || id, 'task_new', v, r);
      end if;
      return null;
    end if;
    add := array(select x from unnest(public.notif__ids(n)) x where not x = any (public.notif__ids(o)));
    if cardinality(add) > 0 and coalesce(n->>'status', '') <> 'done' then
      perform public.notif__add(new.org_id, 'task_assigned:' || id || ':' || array_to_string(add, ','), 'task_assigned', v || jsonb_build_object('to', to_jsonb(add)), r);
    end if;
    if n->>'status' = 'done' and coalesce(o->>'status', '') <> 'done' then
      perform public.notif__add(new.org_id, 'task_done:' || id || ':' || coalesce(n->>'doneAt', ''), 'task_done', v || jsonb_build_object('doneBy', n->>'doneBy'), r);
    elsif coalesce(n->>'status', '') <> 'done' and ((n->>'due') is distinct from (o->>'due') or (n->>'title') is distinct from (o->>'title')) then
      perform public.notif__add(new.org_id, 'task_changed:' || id || ':' || md5(coalesce(n->>'due', '') || coalesce(n->>'title', '')), 'task_changed', v || jsonb_build_object('oldDue', o->>'due'), r);
    end if;
    return null;
  end if;

  if new.coll = 'reviews' then
    if tg_op <> 'INSERT' or new.deleted or coalesce(n->>'date', '') < to_char((now() at time zone 'Asia/Kuala_Lumpur') - interval '14 days', 'YYYY-MM-DD') then return null; end if;
    perform public.notif__add(new.org_id, 'review:' || id, 'review_new',
      jsonb_build_object('guest', n->>'guest', 'stars', n->'stars', 'score', n->'score', 'site', coalesce(n->>'platform', n->>'ota'), 'unit', n->>'propertyId', 'text', left(n->>'text', 200)),
      jsonb_build_object('review', id, 'booking', n->>'bookingId'));
    return null;
  end if;

  if new.coll in ('guestRequests', 'damageReports', 'expenses', 'ownerMessages') then
    if tg_op <> 'INSERT' or new.deleted then return null; end if;
    perform public.notif__add(new.org_id, new.coll || ':' || id,
      case new.coll when 'guestRequests' then 'gst_request' when 'damageReports' then 'damage_new' when 'expenses' then 'expense_new' else 'owner_msg' end,
      jsonb_build_object('type', coalesce(n->>'type', n->>'item'), 'text', left(coalesce(n->>'summary', n->>'desc', n->>'note', n->>'text'), 200),
        'amount', n->'amount', 'unit', n->>'propertyId', 'urgent', n->'urgent', 'from', coalesce(n->>'from', n->>'owner')),
      jsonb_build_object('booking', n->>'bookingId', 'id', id, 'coll', new.coll));
    return null;
  end if;

  if new.coll = 'blocks' then
    if tg_op = 'INSERT' and not new.deleted then
      perform public.notif__add(new.org_id, 'block:' || id, 'avail_block', jsonb_build_object('unit', n->>'propertyId', 'from', n->>'start', 'to', n->>'end', 'type', n->>'type', 'text', left(n->>'note', 120)), '{}');
    elsif tg_op = 'UPDATE' and new.deleted and not old.deleted then
      perform public.notif__add(new.org_id, 'unblock:' || id, 'avail_open', jsonb_build_object('unit', n->>'propertyId', 'from', n->>'start', 'to', n->>'end'), '{}');
    end if;
    return null;
  end if;

  if new.coll = 'channelRates' then
    if auth.uid() is null then return null; end if;
    perform public.notif__add(new.org_id, 'rates:' || auth.uid() || ':' || floor(extract(epoch from now()) / 1800)::text, 'rates_changed', '{}', jsonb_build_object('page', 'channels'));
    return null;
  end if;

  if new.coll = 'journeySent' then
    if n->>'state' = 'failed' and coalesce(o->>'state', '') <> 'failed' then
      perform public.notif__add(new.org_id, 'msg_failed:' || id || ':' || coalesce(n->>'tries', ''), 'msg_failed',
        jsonb_build_object('step', split_part(id, ':', 2), 'via', n->>'via', 'error', left(n->>'error', 160)),
        jsonb_build_object('booking', split_part(id, ':', 1)));
    end if;
    return null;
  end if;
  return null;
exception when others then
  raise warning 'notifications: % % not handled: %', new.coll, new.id, sqlerrm;
  return null;
end $$;

drop trigger if exists notif_on_record on public.records;
create trigger notif_on_record after insert or update on public.records for each row
  when (new.coll in ('bookings', 'conversations', 'tasks', 'reviews', 'guestRequests', 'damageReports', 'expenses', 'ownerMessages', 'blocks', 'channelRates', 'journeySent'))
  execute function public.notif__on_record();

-- ---------- blobs: prices and system health ----------
create or replace function public.notif__on_blob() returns trigger
language plpgsql security definer set search_path = public as $$
declare h jsonb; oh jsonb;
begin
  if new.key in ('priceOverrides', 'lastMinuteDeal', 'ratePlanner', 'netFees') then
    if auth.uid() is null or (tg_op = 'UPDATE' and old.data is not distinct from new.data) then return null; end if;
    perform public.notif__add(new.org_id, 'rates:' || auth.uid() || ':' || floor(extract(epoch from now()) / 1800)::text, 'rates_changed',
      jsonb_build_object('what', new.key), jsonb_build_object('page', 'pricing'));
  elsif new.key = 'healthState' then
    h := new.data->'v'; oh := case when tg_op = 'UPDATE' then old.data->'v' else null end;
    if coalesce(h->>'overall', 'ok') <> 'ok' and (coalesce(oh->>'overall', 'ok') = 'ok' or coalesce(h->>'sig', '') <> coalesce(oh->>'sig', '')) then
      perform public.notif__add(new.org_id, 'health:' || coalesce(h->>'sig', '') || ':' || (h->>'overall') || ':' || public.notif__today(), 'sys_health',
        jsonb_build_object('overall', h->>'overall'), jsonb_build_object('page', 'health'));
    end if;
  end if;
  return null;
exception when others then
  raise warning 'notifications: blob % not handled: %', new.key, sqlerrm;
  return null;
end $$;
drop trigger if exists notif_on_blob on public.blobs;
create trigger notif_on_blob after insert or update on public.blobs for each row
  when (new.key in ('priceOverrides', 'lastMinuteDeal', 'ratePlanner', 'netFees', 'healthState'))
  execute function public.notif__on_blob();

-- ---------- channel manager problems ----------
create or replace function public.notif__on_cx_alert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notif__add(new.org_id, 'cx:' || new.id, 'sys_' || coalesce(new.kind, 'sync_error'),
    jsonb_build_object('text', left(new.message, 240), 'booking', new.ref->>'bookingId', 'unit', new.ref->>'propertyId'),
    jsonb_build_object('page', 'channels', 'booking', coalesce(new.ref->>'bookingId', new.ref->>'booking_id')));
  return null;
exception when others then
  raise warning 'notifications: channel alert not handled: %', sqlerrm;
  return null;
end $$;
do $$ begin
  if to_regclass('public.channex_alerts') is not null then
    execute 'drop trigger if exists notif_on_cx_alert on public.channex_alerts';
    execute 'create trigger notif_on_cx_alert after insert on public.channex_alerts for each row execute function public.notif__on_cx_alert()';
  end if;
end $$;

-- ---------- Team chat (only the chat's members read it) ----------
create or replace function public.notif__on_team_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record; who text[];
begin
  select kind, name into c from team_chats where org_id = new.org_id and id = new.chat_id;
  if c.kind is distinct from 'all' then
    who := array(select staff_id from team_chat_members where org_id = new.org_id and chat_id = new.chat_id and staff_id <> new.sender and not muted);
    if cardinality(who) = 0 then return null; end if;
  end if;
  perform public.notif__add(new.org_id, 'team:' || new.id, 'team_msg',
    jsonb_build_object('chat', c.name, 'chatKind', c.kind, 'from', new.sender, 'text', left(new.body, 200), 'file', new.file is not null),
    jsonb_build_object('chat', new.chat_id), who);
  return null;
exception when others then
  raise warning 'notifications: team message not handled: %', sqlerrm;
  return null;
end $$;
do $$ begin
  if to_regclass('public.team_messages') is not null then
    execute 'drop trigger if exists notif_on_team_message on public.team_messages';
    execute 'create trigger notif_on_team_message after insert on public.team_messages for each row execute function public.notif__on_team_message()';
  end if;
end $$;

-- ---------- a new team member ----------
create or replace function public.notif__on_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notif__add(new.org_id, 'member:' || new.user_id, 'staff_joined', jsonb_build_object('staff', new.staff_id, 'role', new.role), jsonb_build_object('page', 'staff'));
  return null;
exception when others then return null;
end $$;
drop trigger if exists notif_on_member on public.members;
create trigger notif_on_member after insert on public.members for each row execute function public.notif__on_member();

-- ---------- every 5 minutes: the ones that depend on the time ----------
create or replace function public.notif_tick() returns int
language plpgsql security definer set search_path = public as $$
declare
  today text := public.notif__today();
  tomorrow text := to_char((now() at time zone 'Asia/Kuala_Lumpur') + interval '1 day', 'YYYY-MM-DD');
  nowt text := public.notif__now();
  hm text := to_char(now() at time zone 'Asia/Kuala_Lumpur', 'HH24:MI');
  day_ago text := to_char((now() at time zone 'Asia/Kuala_Lumpur') - interval '1 day', 'YYYY-MM-DD"T"HH24:MI');
  org uuid; x record; cnt int := 0; ci text;
begin
  for org in select distinct r.org_id from records r where r.coll = 'bookings' loop
    -- overdue tasks (only ones that became overdue in the last day, so old ones do not flood the list)
    for x in select r.id, r.data d from records r where r.org_id = org and r.coll = 'tasks' and not r.deleted
        and coalesce(r.data->>'status', '') <> 'done' and r.data->>'due' < nowt and r.data->>'due' >= day_ago loop
      perform public.notif__add(org, 'overdue:' || x.id || ':' || (x.d->>'due'), 'task_overdue',
        jsonb_build_object('title', x.d->>'title', 'unit', x.d->>'propertyId', 'due', x.d->>'due', 'to', to_jsonb(public.notif__ids(x.d))),
        jsonb_build_object('task', x.id, 'booking', x.d->>'bookingId'));
      cnt := cnt + 1;
    end loop;

    -- the 9 AM summary
    if hm >= '09:00' then
      perform public.notif__add(org, 'daily:' || today, 'daily_summary', jsonb_build_object(
        'arrivals', (select count(*) from records r where r.org_id = org and r.coll = 'bookings' and public.alerts__live(r.data, r.deleted) and r.data->>'checkIn' = today),
        'departures', (select count(*) from records r where r.org_id = org and r.coll = 'bookings' and public.alerts__live(r.data, r.deleted) and r.data->>'checkOut' = today),
        'inHouse', (select count(*) from records r where r.org_id = org and r.coll = 'bookings' and public.alerts__live(r.data, r.deleted) and r.data->>'checkIn' < today and r.data->>'checkOut' > today),
        'tasks', (select count(*) from records r where r.org_id = org and r.coll = 'tasks' and not r.deleted and coalesce(r.data->>'status', '') <> 'done' and left(r.data->>'due', 10) = today),
        'date', today), jsonb_build_object('page', 'dashboard'));
    end if;

    for x in select r.id, r.data d from records r where r.org_id = org and r.coll = 'bookings' and public.alerts__live(r.data, r.deleted)
        and r.data->>'checkIn' in (today, tomorrow) and coalesce(r.data->>'status', '') not in ('checked_in', 'checked_out', 'pending') loop
      ci := (x.d->>'checkIn') || 'T' || coalesce(nullif(x.d->>'checkInTime', ''), '15:00');
      -- check-in readiness: an open task for this stay or unit that should be done before the guest arrives, 2 hours to go
      if (x.d->>'checkIn') = today and ci > nowt and ci <= to_char((now() at time zone 'Asia/Kuala_Lumpur') + interval '2 hours', 'YYYY-MM-DD"T"HH24:MI')
         and exists (select 1 from records t where t.org_id = org and t.coll = 'tasks' and not t.deleted and coalesce(t.data->>'status', '') <> 'done'
           and (t.data->>'bookingId' = x.id or (t.data->>'propertyId' = x.d->>'propertyId' and t.data->>'due' <= ci and t.data->>'due' >= today))) then
        perform public.notif__add(org, 'ready:' || x.id || ':' || ci, 'ready_late',
          jsonb_build_object('guest', x.d#>>'{guest,name}', 'unit', x.d->>'propertyId', 'at', ci), jsonb_build_object('booking', x.id));
        cnt := cnt + 1;
      end if;
      -- arriving within 6 hours with no door code sent
      if ci > nowt and ci <= to_char((now() at time zone 'Asia/Kuala_Lumpur') + interval '6 hours', 'YYYY-MM-DD"T"HH24:MI')
         and coalesce(x.d->>'codeStatus', '') not in ('sent', 'scheduled', 'held') then
        perform public.notif__add(org, 'nocode:' || x.id || ':' || ci, 'bk_nocode',
          jsonb_build_object('guest', x.d#>>'{guest,name}', 'unit', x.d->>'propertyId', 'at', ci), jsonb_build_object('booking', x.id));
        cnt := cnt + 1;
      end if;
      -- a direct or website booking not paid by the day before arrival
      if x.d->>'channel' in ('direct', 'website') and coalesce(x.d->>'paidAt', '') = '' and hm >= '09:00' then
        perform public.notif__add(org, 'unpaid:' || x.id || ':' || (x.d->>'checkIn'), 'bk_unpaid',
          jsonb_build_object('guest', x.d#>>'{guest,name}', 'unit', x.d->>'propertyId', 'in', x.d->>'checkIn', 'total', x.d->'total'), jsonb_build_object('booking', x.id));
        cnt := cnt + 1;
      end if;
    end loop;

    -- check-outs today with no cleaning task
    if hm >= '09:00' then
      for x in select r.id, r.data d from records r where r.org_id = org and r.coll = 'bookings' and public.alerts__live(r.data, r.deleted) and r.data->>'checkOut' = today
          and not exists (select 1 from records t where t.org_id = org and t.coll = 'tasks' and not t.deleted and (t.data->>'bookingId' = r.id or
            (t.data->>'propertyId' = r.data->>'propertyId' and left(t.data->>'due', 10) = today))) loop
        perform public.notif__add(org, 'noclean:' || x.id || ':' || today, 'bk_noclean',
          jsonb_build_object('guest', x.d#>>'{guest,name}', 'unit', x.d->>'propertyId', 'out', x.d->>'checkOut'), jsonb_build_object('booking', x.id));
        cnt := cnt + 1;
      end loop;
    end if;

    -- two live bookings in the same unit on the same night
    for x in select a.id a_id, b.id b_id, a.data ad, b.data bd from records a join records b
          on b.org_id = a.org_id and b.coll = 'bookings' and a.id < b.id and b.data->>'propertyId' = a.data->>'propertyId'
         where a.org_id = org and a.coll = 'bookings' and coalesce(a.data->>'propertyId', '') <> ''
           and public.alerts__live(a.data, a.deleted) and public.alerts__live(b.data, b.deleted)
           and a.data->>'checkOut' > today and b.data->>'checkOut' > today
           and a.data->>'checkIn' < b.data->>'checkOut' and b.data->>'checkIn' < a.data->>'checkOut' loop
      perform public.notif__add(org, 'overlap:' || x.a_id || ':' || x.b_id || ':' || (x.ad->>'checkIn') || (x.bd->>'checkIn'), 'bk_overlap',
        jsonb_build_object('guest', x.ad#>>'{guest,name}', 'guest2', x.bd#>>'{guest,name}', 'unit', x.ad->>'propertyId',
          'in', greatest(x.ad->>'checkIn', x.bd->>'checkIn'), 'out', least(x.ad->>'checkOut', x.bd->>'checkOut')),
        jsonb_build_object('booking', x.a_id, 'booking2', x.b_id));
      cnt := cnt + 1;
    end loop;
  end loop;
  -- keep 90 days
  delete from notifications where created_at < now() - interval '90 days';
  return cnt;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.notif__add(uuid, text, text, jsonb, jsonb, text[])', 'public.notif__on_record()', 'public.notif__on_blob()',
    'public.notif__on_cx_alert()', 'public.notif__on_team_message()', 'public.notif__on_member()', 'public.notif_tick()'] loop
    execute 'revoke all on function ' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ' || f || ' from anon'; end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function ' || f || ' from authenticated'; end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function ' || f || ' to service_role'; end if;
  end loop;
  if to_regnamespace('cron') is not null and to_regprocedure('cron.schedule(text, text, text)') is not null then
    perform cron.schedule('notif-tick', '*/5 * * * *', $job$select public.notif_tick()$job$);
  else
    raise notice 'notifications: pg_cron is not available; time-based notifications will not run';
  end if;
end $$;

notify pgrst, 'reload schema';
