-- The bell's shared history (supabase/migrations/0031_notifications.sql): every change writes one notification, saving
-- the same thing again writes none, who did it is kept, Team chat rows are only for the chat's members, and the
-- time-based ones come from notif_tick(). Runs in one transaction and rolls back. Any failed check raises an error.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/notifications.sql
begin;

insert into public.orgs (id, name) values ('00000000-0000-4000-8000-0000000000d1', 'Notifications test');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000d9', 'n@example.com') on conflict do nothing;
insert into public.members (org_id, user_id, staff_id, role) values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d9', 's1', 'owner');

do $$
declare o constant uuid := '00000000-0000-4000-8000-0000000000d1'; n int; v text; today text := public.notif__today();
  soon text := to_char((now() at time zone 'Asia/Kuala_Lumpur') + interval '90 minutes', 'HH24:MI');
  nowt text := public.notif__now();
  kinds text;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  -- a booking site's booking: bk_new, and saving it again adds nothing
  insert into public.records (org_id, coll, id, data) values (o, 'bookings', 'B-1', jsonb_build_object('id', 'B-1', 'channel', 'trip', 'checkIn', '2030-01-02', 'checkOut', '2030-01-04', 'status', 'confirmed', 'guest', jsonb_build_object('name', 'Mia'), 'propertyId', 'P-1', 'total', 500));
  update public.records set data = data where org_id = o and id = 'B-1';
  select count(*) into n from public.notifications where org_id = o and kind = 'bk_new';
  if n <> 1 then raise exception 'expected 1 bk_new, got %', n; end if;
  select vars->>'guest' into v from public.notifications where org_id = o and kind = 'bk_new';
  if v is distinct from 'Mia' then raise exception 'bk_new guest %', v; end if;

  -- the smallest changes, each once
  update public.records set data = data || '{"checkOut":"2030-01-05"}' where org_id = o and id = 'B-1';
  update public.records set data = data || '{"propertyId":"P-2"}' where org_id = o and id = 'B-1';
  update public.records set data = data || '{"guests":3}' where org_id = o and id = 'B-1';
  update public.records set data = data || '{"total":650}' where org_id = o and id = 'B-1';
  update public.records set data = data || '{"paidAt":"2030-01-01T10:00"}' where org_id = o and id = 'B-1';
  update public.records set data = data || '{"idVerified":true}' where org_id = o and id = 'B-1';
  update public.records set data = data || '{"rulesAccepted":{"at":"x"}}' where org_id = o and id = 'B-1';
  update public.records set data = data || '{"notes":"late arrival"}' where org_id = o and id = 'B-1';
  update public.records set data = data || '{"doorCode":"1234"}' where org_id = o and id = 'B-1';
  update public.records set data = data || '{"status":"checked_in"}' where org_id = o and id = 'B-1';
  update public.records set data = data || '{"notes":"late arrival"}' where org_id = o and id = 'B-1';
  select string_agg(kind, ',' order by id) into kinds from public.notifications where org_id = o and kind <> 'staff_joined';
  if kinds is distinct from 'bk_new,bk_dates,bk_moved,bk_guests,bk_price,bk_paid,gst_id,gst_rules,bk_edit,bk_code,bk_checkin' then raise exception 'booking changes: %', kinds; end if;

  -- cancelled once
  update public.records set data = data || '{"status":"cancelled"}' where org_id = o and id = 'B-1';
  update public.records set data = data || '{"notes":"x"}' where org_id = o and id = 'B-1';
  select count(*) into n from public.notifications where org_id = o and kind = 'bk_cancelled';
  if n <> 1 then raise exception 'expected 1 bk_cancelled, got %', n; end if;

  -- a team member's booking: written, with who did it
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d9', true);
  insert into public.records (org_id, coll, id, data) values (o, 'bookings', 'B-2', '{"id":"B-2","status":"confirmed","checkIn":"2030-02-01","checkOut":"2030-02-03"}');
  perform set_config('request.jwt.claim.sub', '', true);
  select actor_staff into v from public.notifications where org_id = o and key like 'bk_new:B-2%';
  if v is distinct from 's1' then raise exception 'actor_staff %', v; end if;

  -- a guest message (new), an old chat joined (none)
  insert into public.records (org_id, coll, id, data) values (o, 'conversations', 'C-1', jsonb_build_object('id', 'C-1', 'bookingId', 'B-2', 'messages', jsonb_build_array(jsonb_build_object('from', 'guest', 'text', 'Hello', 'time', nowt, 'xid', 'x1'))));
  update public.records set data = jsonb_set(data, '{messages}', data->'messages' || jsonb_build_array(jsonb_build_object('from', 'staff', 'text', 'Hi'))) where org_id = o and id = 'C-1';
  update public.records set data = jsonb_set(data, '{messages}', data->'messages' || jsonb_build_array(jsonb_build_object('from', 'guest', 'text', 'Parking?', 'time', nowt, 'xid', 'x2'))) where org_id = o and id = 'C-1';
  insert into public.records (org_id, coll, id, data) values (o, 'conversations', 'C-2', '{"id":"C-2","messages":[{"from":"guest","text":"old","time":"2020-01-01T10:00"}]}');
  select count(*) into n from public.notifications where org_id = o and kind = 'gst_msg';
  if n <> 2 then raise exception 'expected 2 guest messages, got %', n; end if;
  select vars->>'text' into v from public.notifications where org_id = o and kind = 'gst_msg' order by id desc limit 1;
  if v is distinct from 'Parking?' then raise exception 'guest message text %', v; end if;

  -- tasks: new, assigned, done; an automatic task nobody has is quiet
  insert into public.records (org_id, coll, id, data) values (o, 'tasks', 'T-1', '{"id":"T-1","title":"Fix tap","status":"todo","assigneeIds":[]}');
  insert into public.records (org_id, coll, id, data) values (o, 'tasks', 'T-2', '{"id":"T-2","title":"Turnover","auto":"checkout","status":"todo","assigneeIds":[]}');
  update public.records set data = data || '{"assigneeIds":["s2"]}' where org_id = o and id = 'T-1';
  update public.records set data = data || '{"status":"done","doneAt":"x"}' where org_id = o and id = 'T-1';
  select string_agg(kind, ',' order by id) into kinds from public.notifications where org_id = o and kind like 'task%';
  if kinds is distinct from 'task_new,task_assigned,task_done' then raise exception 'tasks: %', kinds; end if;

  -- other collections
  insert into public.records (org_id, coll, id, data) values (o, 'reviews', 'R-1', jsonb_build_object('id', 'R-1', 'date', today, 'stars', 2, 'guest', 'Ann'));
  insert into public.records (org_id, coll, id, data) values (o, 'reviews', 'R-2', '{"id":"R-2","date":"2020-01-01","stars":5}');
  insert into public.records (org_id, coll, id, data) values (o, 'guestRequests', 'Q-1', '{"id":"Q-1","type":"towels"}');
  insert into public.records (org_id, coll, id, data) values (o, 'expenses', 'E-1', '{"id":"E-1","amount":20}');
  insert into public.records (org_id, coll, id, data) values (o, 'blocks', 'K-1', '{"id":"K-1","propertyId":"P-1","start":"2030-01-01","end":"2030-01-03"}');
  update public.records set deleted = true where org_id = o and id = 'K-1';
  insert into public.records (org_id, coll, id, data) values (o, 'journeySent', 'B-2:confirm', '{"state":"sending"}');
  update public.records set data = '{"state":"failed","via":"email"}' where org_id = o and id = 'B-2:confirm';
  select count(*) into n from public.notifications where org_id = o and kind in ('review_new', 'gst_request', 'expense_new', 'avail_block', 'avail_open', 'msg_failed');
  if n <> 6 then raise exception 'other collections: expected 6, got %', n; end if;

  -- prices by a person: one per half hour; system health going bad
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d9', true);
  insert into public.blobs (org_id, key, data) values (o, 'priceOverrides', '{"v":{"a":1}}');
  update public.blobs set data = '{"v":{"a":2}}' where org_id = o and key = 'priceOverrides';
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.blobs (org_id, key, data) values (o, 'healthState', '{"v":{"overall":"ok","sig":""}}');
  update public.blobs set data = '{"v":{"overall":"bad","sig":"s1"}}' where org_id = o and key = 'healthState';
  select count(*) into n from public.notifications where org_id = o and kind in ('rates_changed', 'sys_health');
  if n <> 2 then raise exception 'prices/health: expected 2, got %', n; end if;

  -- channel manager problem
  insert into public.channex_alerts (org_id, kind, message, ref) values (o, 'double_booking', 'Two bookings', '{"bookingId":"B-2"}');
  select count(*) into n from public.notifications where org_id = o and kind = 'sys_double_booking';
  if n <> 1 then raise exception 'channel alert missing'; end if;

  -- time-based: an overdue task, the day summary (after 9 AM), an arrival within 2 hours with an open task and no code,
  -- an unpaid direct booking, two bookings in one unit
  insert into public.records (org_id, coll, id, data) values (o, 'tasks', 'T-3', jsonb_build_object('id', 'T-3', 'title', 'Late', 'status', 'todo', 'due', to_char((now() at time zone 'Asia/Kuala_Lumpur') - interval '1 hour', 'YYYY-MM-DD"T"HH24:MI')));
  if soon > to_char(now() at time zone 'Asia/Kuala_Lumpur', 'HH24:MI') then
    insert into public.records (org_id, coll, id, data) values (o, 'bookings', 'B-3', jsonb_build_object('id', 'B-3', 'status', 'confirmed', 'channel', 'direct', 'checkIn', today, 'checkInTime', soon, 'checkOut', '2030-03-01', 'propertyId', 'P-9'));
    insert into public.records (org_id, coll, id, data) values (o, 'tasks', 'T-4', jsonb_build_object('id', 'T-4', 'title', 'Clean', 'status', 'todo', 'bookingId', 'B-3', 'due', today || 'T' || soon));
    insert into public.records (org_id, coll, id, data) values (o, 'bookings', 'B-4', jsonb_build_object('id', 'B-4', 'status', 'confirmed', 'channel', 'airbnb', 'checkIn', today, 'checkOut', '2030-01-01', 'propertyId', 'P-9'));
  end if;
  perform public.notif_tick();
  perform public.notif_tick();
  select count(*) into n from public.notifications where org_id = o and kind = 'task_overdue';
  if n <> 1 then raise exception 'overdue: %', n; end if;
  if soon > to_char(now() at time zone 'Asia/Kuala_Lumpur', 'HH24:MI') then
    select count(*) into n from public.notifications where org_id = o and kind in ('ready_late', 'bk_nocode', 'bk_overlap');
    if n <> 3 then raise exception 'arrival checks: expected 3, got %', n; end if;
  end if;

  raise notice 'notifications: ok (% rows)', (select count(*) from public.notifications where org_id = o);
end $$;

-- Team chat: only the chat's other members read it; reading rules
do $$
declare o constant uuid := '00000000-0000-4000-8000-0000000000d1'; n int;
begin
  insert into public.team_chats (org_id, id, kind, name, created_by) values (o, 'G-1', 'group', 'Cleaners', 's1');
  insert into public.team_chat_members (org_id, chat_id, staff_id) values (o, 'G-1', 's1'), (o, 'G-1', 's2');
  insert into public.team_messages (org_id, chat_id, sender, body) values (o, 'G-1', 's2', 'Unit 41-1 ready');
  select count(*) into n from public.notifications where org_id = o and kind = 'team_msg' and staff = array['s1'];
  if n <> 1 then raise exception 'team message for s1: %', n; end if;
  raise notice 'team chat notifications: ok';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d9', true);
do $$
declare n int;
begin
  select count(*) into n from public.notifications;
  if n = 0 then raise exception 'a member cannot read the notifications'; end if;
  insert into public.notification_seen (org_id, user_id, seen_id) values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d9', 5);
  insert into public.notifications (org_id, key, kind, actor) values ('00000000-0000-4000-8000-0000000000d1', 'low:x', 'stock_low', '00000000-0000-4000-8000-0000000000d9');
  begin
    insert into public.notifications (org_id, key, kind, actor, staff) values ('00000000-0000-4000-8000-0000000000d1', 'x2', 'stock_low', '00000000-0000-4000-8000-0000000000d9', array['s1']);
    raise exception 'a member wrote a private notification';
  exception when insufficient_privilege then null;
  end;
  raise notice 'notifications access: ok';
end $$;
reset role;

rollback;
