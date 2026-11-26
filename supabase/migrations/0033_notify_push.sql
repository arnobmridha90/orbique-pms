-- 0033: every bell notification also goes to the team's phones as a real phone notification (Arnob, 2026-11-26: "I am
-- getting notifications only when I open the mobile app ... there is no notification bar or a pop up notification ...
-- the notification sound also does not play until the mobile app is opened").
--
--   * push_devices.notify: what this phone wants from the bell, sent by the app with register-device (api/alerts.js):
--       {kinds: [the notification kinds this person may see], quiet: [bell groups muted on this phone], staff: the
--       person's staff id, allTasks: may see everyone's tasks}. null: the phone has not signed up for bell
--       notifications (it keeps booking and Team chat alerts as before).
--   * notifications.pushed_at: when the phone notifications for a row went out (or were skipped). Rows written
--     before this file are marked, so nothing old is sent.
--   * a trigger on notifications pokes the worker (/api/channex-worker, task 'push') through pg_net straight away,
--     with the address and secret 0007 keeps in Vault; the worker's every-minute tick also sends anything left.
-- Never stops a save: the trigger swallows its own errors. Plain Postgres (CI) has no pg_net or Vault: the poke does
-- nothing there. Re-runnable.

alter table public.push_devices add column if not exists notify jsonb;
alter table public.notifications add column if not exists pushed_at timestamptz;

do $$ begin
  -- the first run marks the history so far as done (a second run finds nothing new to mark that matters)
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'notifications_unpushed_idx') then
    update public.notifications set pushed_at = now() where pushed_at is null;
  end if;
end $$;
create index if not exists notifications_unpushed_idx on public.notifications (id) where pushed_at is null;

-- POST {task: 'push'} to the worker. Returns the pg_net request id, or null when pg_net, Vault or the worker is missing.
create or replace function public.notif__kick() returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text; v_req bigint;
begin
  if to_regnamespace('vault') is null or to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then return null; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v_url using 'channex_worker_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v_secret using 'channex_worker_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then return null; end if;
  execute 'select net.http_post(url := $1, body := $2, params := ''{}''::jsonb, headers := $3, timeout_milliseconds := 15000)'
    into v_req
    using v_url, jsonb_build_object('task', 'push'),
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret);
  return v_req;
exception when others then
  raise warning 'notifications: phone push not started: %', sqlerrm;
  return null;
end $$;

-- once per statement, so a save that writes several notifications pokes the worker once
create or replace function public.notif__on_insert_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- "on conflict do nothing" runs the statement with no new row when the event was already written: no poke then
  if exists (select 1 from added) then perform public.notif__kick(); end if;
  return null;
exception when others then
  raise warning 'notifications: phone push not started: %', sqlerrm;
  return null;
end $$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  referencing new table as added for each statement execute function public.notif__on_insert_push();

do $$ begin
  revoke all on function public.notif__kick() from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.notif__kick() from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.notif__kick() from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.notif__kick() to service_role; end if;
end $$;
