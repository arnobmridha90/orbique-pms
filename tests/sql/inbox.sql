-- Guest inbox (supabase/migrations/0010_inbox.sql): finding the conversation for a WhatsApp or Channex message, adding
-- messages once, ticks that never go back, and a save from the app that does not lose messages that arrived meanwhile.
-- Runs in one transaction and rolls back, so it leaves nothing behind. Any failed check raises an error.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/inbox.sql
begin;

insert into public.orgs (id, name) values ('00000000-0000-4000-8000-0000000000b1', 'Inbox test');
insert into public.records (org_id, coll, id, data) values
  ('00000000-0000-4000-8000-0000000000b1', 'bookings', 'B-1', '{"id":"B-1","guest":{"name":"Ana","phone":"+60 12-345 6789"},"checkIn":"2026-11-02","checkOut":"2026-11-04","status":"confirmed"}'),
  ('00000000-0000-4000-8000-0000000000b1', 'conversations', 'C-old', '{"id":"C-old","bookingId":"B-1","unread":0,"messages":[{"from":"staff","text":"Welcome","time":"2026-11-01T09:00"}]}');

do $$
declare o constant uuid := '00000000-0000-4000-8000-0000000000b1'; c text; c2 text; v jsonb; r jsonb;
begin
  -- an unknown number: a new conversation with no booking, the contact kept
  c := public.inbox_conv(o, 'wa', '60199990000', null, '{"contact":{"name":"Stranger","phone":"+60199990000"},"lang":null}', '2026-11-01T10:00');
  select data into v from public.records where org_id = o and coll = 'conversations' and id = c;
  if v->>'bookingId' is not null or v->'contact'->>'name' <> 'Stranger' or v->>'wa' <> '60199990000' or v ? 'lang' then raise exception 'unlinked: %', v; end if;
  -- the same number again finds it
  if public.inbox_conv(o, 'wa', '60199990000', null, null, '2026-11-01T10:05') <> c then raise exception 'same number, new conversation'; end if;

  -- a message is added once
  v := public.inbox_append(o, c, '{"from":"guest","text":"Hola","time":"2026-11-01T10:00","xid":"wa:1"}', 1, '{"waLastIn":"2026-11-01T02:00:00Z"}');
  if v is null or jsonb_array_length(v->'messages') <> 1 or (v->>'unread')::int <> 1 or v->>'waLastIn' is null then raise exception 'append: %', v; end if;
  if public.inbox_append(o, c, '{"from":"guest","text":"Hola","time":"2026-11-01T10:00","xid":"wa:1"}', 1, null) is not null then raise exception 'appended twice'; end if;

  -- the guest's booking is found later: the loose chat moves into the booking's conversation
  c2 := public.inbox_conv(o, 'wa', '60199990000', 'B-1', '{"contact":{"name":"Stranger"}}', '2026-11-01T10:10');
  if c2 <> 'C-old' then raise exception 'booking conversation expected, got %', c2; end if;
  select data into v from public.records where org_id = o and coll = 'conversations' and id = 'C-old';
  if jsonb_array_length(v->'messages') <> 2 or v->'messages'->1->>'xid' <> 'wa:1' or v->>'wa' <> '60199990000' or v ? 'contact'
     or (v->>'unread')::int <> 1 or v->>'waLastIn' is null then raise exception 'merged: %', v; end if;
  if not (select deleted from public.records where org_id = o and coll = 'conversations' and id = c) then raise exception 'loose chat not removed'; end if;

  -- ticks: sent -> read, never back to delivered; failed does not replace read
  v := public.inbox_append(o, 'C-old', '{"from":"staff","text":"Hi Ana","time":"2026-11-01T10:12","xid":"wa:2","status":"sent"}', 0, null);
  r := public.inbox_patch(o, null, 'wa:2', null, null, '{"status":"read"}');
  if r->>'id' <> 'C-old' or r->'data'->'messages'->2->>'status' <> 'read' then raise exception 'read: %', r; end if;
  r := public.inbox_patch(o, null, 'wa:2', null, null, '{"status":"delivered"}');
  if r->'data'->'messages'->2->>'status' <> 'read' then raise exception 'went back: %', r; end if;
  r := public.inbox_patch(o, 'C-old', 'wa:2', null, null, '{"status":"failed","error":"x"}');
  if r->'data'->'messages'->2->>'status' <> 'read' or r->'data'->'messages'->2 ? 'error' then raise exception 'failed after read: %', r; end if;
  -- a translation by position, only while the text is unchanged
  r := public.inbox_patch(o, 'C-old', null, 1, 'Hola', '{"lang":"es","tr":{"to":"en","text":"Hello"}}');
  if r->'data'->'messages'->1->'tr'->>'text' <> 'Hello' then raise exception 'translation: %', r; end if;
  if public.inbox_patch(o, 'C-old', null, 1, 'Changed', '{"lang":"xx"}') is not null then raise exception 'patched a changed message'; end if;

  -- a Channex thread without a booking, then with one
  c := public.inbox_conv(o, 'cx', '11111111-1111-4111-8111-111111111111', null, '{"ota":"Airbnb","contact":{"name":"Inquirer"}}', '2026-11-01T11:00');
  select data into v from public.records where org_id = o and coll = 'conversations' and id = c;
  if v->>'cx' <> '11111111-1111-4111-8111-111111111111' or v->>'ota' <> 'Airbnb' or v->>'bookingId' is not null then raise exception 'cx: %', v; end if;
end $$;

-- the app saves a conversation it loaded before a guest message and a tick arrived: both are kept
do $$
declare o constant uuid := '00000000-0000-4000-8000-0000000000b1'; v jsonb; stale jsonb;
begin
  select data into stale from public.records where org_id = o and coll = 'conversations' and id = 'C-old';
  perform public.inbox_append(o, 'C-old', '{"from":"guest","text":"Late","time":"2026-11-01T10:30","xid":"wa:3"}', 1, null);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1"}', true);
  -- the stale copy: the read tick on wa:2 is gone (the app still had "sent"), a note is added, unread cleared, wa removed
  stale := jsonb_set(stale, '{messages,2,status}', '"sent"');
  stale := (stale - 'wa') || jsonb_build_object('unread', 0, 'messages', (stale->'messages') || '[{"from":"note","text":"Call her","time":"2026-11-01T10:20"}]'::jsonb);
  update public.records set data = stale where org_id = o and coll = 'conversations' and id = 'C-old';
  perform set_config('request.jwt.claims', '', true);
  select data into v from public.records where org_id = o and coll = 'conversations' and id = 'C-old';
  if jsonb_array_length(v->'messages') <> 5 then raise exception 'kept: %', v->'messages'; end if;
  if v->'messages'->2->>'status' <> 'read' then raise exception 'tick lost: %', v->'messages'->2; end if;
  if v->'messages'->3->>'text' <> 'Call her' or v->'messages'->4->>'xid' <> 'wa:3' then raise exception 'order: %', v->'messages'; end if;
  if (v->>'unread')::int <> 1 or v->>'wa' <> '60199990000' then raise exception 'unread / wa: %', v; end if;
  raise notice 'inbox: ok';
end $$;

rollback;
