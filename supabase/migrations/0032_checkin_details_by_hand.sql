-- 0032: check-in details (suite, door code, Wi-Fi) are sent by the team by hand, never by themselves.
-- Arnob, 2026-11-24: "the checkin details with door codes and wifi passwords do not need to be sent automatically
-- anymore. It is better if I send them when I open the whatsapp group with the customer and my team".
--
-- Re-creates notif_tick() from 0031_notifications.sql (applied, so not edited). Only one condition differs: the
-- "arriving soon" alert (bk_nocode) now rings for a guest arriving within 6 hours whose check-in details are not marked
-- sent (codeStatus 'sent', set by the booking drawer's "Copy check-in details"). Before, a code held for the ID check
-- or scheduled also counted, which no longer means anything is on its way. Re-runnable.
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
      -- arriving within 6 hours with the check-in details not sent yet (the team sends them by hand, 0032)
      if ci > nowt and ci <= to_char((now() at time zone 'Asia/Kuala_Lumpur') + interval '6 hours', 'YYYY-MM-DD"T"HH24:MI')
         and coalesce(x.d->>'codeStatus', '') <> 'sent' then
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

notify pgrst, 'reload schema';
