-- Booking alerts (supabase/migrations/0011_alerts.sql): a booking a site or the guest website creates, cancels or
-- moves queues one alert; saving the same booking again does not queue another; a team member's own change queues none.
-- Runs in one transaction and rolls back, so it leaves nothing behind. Any failed check raises an error.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/alerts.sql
begin;

insert into public.orgs (id, name) values ('00000000-0000-4000-8000-0000000000c1', 'Alerts test');

do $$
declare o constant uuid := '00000000-0000-4000-8000-0000000000c1'; n int; v text;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  -- a booking site's new booking: one "new" alert, however often it is saved again
  insert into public.records (org_id, coll, id, data) values (o, 'bookings', 'B-1', '{"id":"B-1","channel":"trip","checkIn":"2026-11-02","checkOut":"2026-11-04","status":"confirmed"}');
  update public.records set data = data || '{"payout":200}' where org_id = o and id = 'B-1';
  select count(*) into n from public.alert_outbox where org_id = o;
  if n <> 1 then raise exception 'expected 1 alert after a new booking, got %', n; end if;
  select kind into v from public.alert_outbox where org_id = o and key = 'new:B-1';
  if v is distinct from 'new' then raise exception 'new alert missing'; end if;

  -- new dates: a "changed" alert with the old dates
  update public.records set data = data || '{"checkOut":"2026-11-05"}' where org_id = o and id = 'B-1';
  select data->'old'->>'checkOut' into v from public.alert_outbox where org_id = o and kind = 'changed';
  if v is distinct from '2026-11-04' then raise exception 'changed alert: old checkOut %', v; end if;

  -- cancelled: one "cancelled" alert
  update public.records set data = data || '{"status":"cancelled"}' where org_id = o and id = 'B-1';
  update public.records set data = data || '{"note":"x"}' where org_id = o and id = 'B-1';
  select count(*) into n from public.alert_outbox where org_id = o and kind = 'cancelled';
  if n <> 1 then raise exception 'expected 1 cancelled alert, got %', n; end if;

  -- a booking saved as cancelled, other collections: nothing
  insert into public.records (org_id, coll, id, data) values (o, 'bookings', 'B-2', '{"id":"B-2","status":"cancelled"}');
  insert into public.records (org_id, coll, id, data) values (o, 'tasks', 'T-1', '{"id":"T-1"}');
  select count(*) into n from public.alert_outbox where org_id = o;
  if n <> 3 then raise exception 'expected 3 alerts, got %', n; end if;

  -- a team member's own booking in the app: no alert
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c9', true);
  insert into public.records (org_id, coll, id, data) values (o, 'bookings', 'B-3', '{"id":"B-3","status":"confirmed"}');
  update public.records set data = data || '{"status":"cancelled"}' where org_id = o and id = 'B-1';
  perform set_config('request.jwt.claim.sub', '', true);
  select count(*) into n from public.alert_outbox where org_id = o;
  if n <> 3 then raise exception 'a team member''s change queued an alert (% alerts)', n; end if;

  raise notice 'alerts: ok';
end $$;

-- the app's roles cannot read the alerts or the phones
do $$
begin
  if has_table_privilege('authenticated', 'public.alert_outbox', 'select') or has_table_privilege('anon', 'public.push_devices', 'select') then
    raise exception 'alert tables are readable by the app''s roles';
  end if;
end $$;

rollback;
