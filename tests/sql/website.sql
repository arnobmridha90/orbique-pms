-- Website bookings (supabase/migrations/0015_website_booking.sql): a website hold (webHold) queues no alert; once the
-- guest pays (webHold removed) it queues one "new" alert; a hold released unpaid queues none. Members and sign-in codes
-- are server-only. Runs in one transaction and rolls back. Any failed check raises an error.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/website.sql
begin;

insert into public.orgs (id, name) values ('00000000-0000-4000-8000-0000000000d1', 'Website test');

do $$
declare o constant uuid := '00000000-0000-4000-8000-0000000000d1'; n int;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.records (org_id, coll, id, data) values (o, 'bookings', 'W-1', '{"id":"W-1","channel":"direct","checkIn":"2026-11-02","checkOut":"2026-11-04","status":"pending","webHold":true}');
  select count(*) into n from public.alert_outbox where org_id = o;
  if n <> 0 then raise exception 'a website hold queued % alerts', n; end if;

  update public.records set data = (data - 'webHold') || '{"status":"confirmed"}' where org_id = o and id = 'W-1';
  select count(*) into n from public.alert_outbox where org_id = o and kind = 'new';
  if n <> 1 then raise exception 'expected 1 new alert once paid, got %', n; end if;

  insert into public.records (org_id, coll, id, data) values (o, 'bookings', 'W-2', '{"id":"W-2","channel":"direct","checkIn":"2026-11-02","checkOut":"2026-11-04","status":"pending","webHold":true}');
  update public.records set data = (data - 'webHold') || '{"status":"cancelled"}' where org_id = o and id = 'W-2';
  select count(*) into n from public.alert_outbox where org_id = o;
  if n <> 1 then raise exception 'a released hold queued an alert (% alerts)', n; end if;

  insert into public.web_members (org_id, email) values (o, 'guest@example.com');
  insert into public.web_member_codes (org_id, email, code_hash, expires_at) values (o, 'guest@example.com', 'x', now() + interval '10 minutes');
  raise notice 'website: ok';
end $$;

do $$
begin
  if has_table_privilege('authenticated', 'public.web_members', 'select') or has_table_privilege('anon', 'public.web_member_codes', 'select') then
    raise exception 'website member tables are readable by the app''s roles';
  end if;
end $$;

rollback;
