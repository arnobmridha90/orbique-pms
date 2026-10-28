-- 0016: the profit planner's saved data is for account owners only.
--
-- What is here:
--   * blobs_read: the 'ratePlanner' blob (each unit's costs, profit target and assumptions, and the push history that
--     Undo relies on) is read only by owners. Every other blob stays readable by every member, as in 0001.
--   * blobs_insert, blobs_update: 'ratePlanner' joins 'rolePerms' and 'staffMeta' as owner-only writes.
--
--   * blobs_planner_merge: an app save of 'ratePlanner' keeps what another device saved that this one had not seen. A blob
--     is last-write-wins, so a device that missed another device's push (its live connection was down) would drop that
--     push record when it saved costs, and the pushed prices could no longer be undone; a stale push would drop costs
--     another device saved. The trigger merges the saved copy into the new one: every unit either copy has, the one saved
--     last (updatedAt) where both have it; every push record either copy has, by id, the undone copy where only one is
--     undone; where neither or both are, the one changed last (changedAt, which Undo stamps on the push it undoes), with
--     each night from the copy that marked it undone last (doneAt, so nights undone on two devices are all kept); newest
--     first, at most 30
--     (as the app keeps them). Server writes (no signed-in user) are stored as sent.
--
-- Why: the planner page is owner-only (O.OWNER_ONLY), and its Save says only account owners see the costs, but 0001 let
-- every member read and write every blob. Other members' browsers no longer load the blob (auth.js reads every blob the
-- policy lets through), and nothing outside the planner reads it.
--
-- Re-runnable: policies and the trigger are dropped and created again, the function is replaced.

drop policy if exists blobs_read on public.blobs;
create policy blobs_read on public.blobs for select to authenticated
  using (public.is_member(org_id) and (key <> 'ratePlanner' or public.member_role(org_id) = 'owner'));
drop policy if exists blobs_insert on public.blobs;
create policy blobs_insert on public.blobs for insert to authenticated
  with check (public.can_write(org_id) and (key not in ('rolePerms', 'staffMeta', 'ratePlanner') or public.member_role(org_id) = 'owner'));
drop policy if exists blobs_update on public.blobs;
create policy blobs_update on public.blobs for update to authenticated
  using (public.can_write(org_id) and (key not in ('rolePerms', 'staffMeta', 'ratePlanner') or public.member_role(org_id) = 'owner'))
  with check (public.can_write(org_id) and (key not in ('rolePerms', 'staffMeta', 'ratePlanner') or public.member_role(org_id) = 'owner'));

-- the saved ratePlanner blob merged into an app save of it (see the top of this file). Stored as {"v": value}.
create or replace function public.planner__merge() returns trigger
language plpgsql set search_path = '' as $$
declare ov jsonb; nv jsonb; units jsonb; pushes jsonb;
begin
  if new.key <> 'ratePlanner' or auth.uid() is null then return new; end if;
  ov := old.data->'v'; nv := new.data->'v';
  if jsonb_typeof(ov) is distinct from 'object' or jsonb_typeof(nv) is distinct from 'object' then return new; end if;
  -- units: every unit either copy has; where both have it, the one saved last, the new copy on a tie. ISO times compare
  -- as text, byte by byte (collate "C"), whatever the database's collation
  select coalesce(jsonb_object_agg(coalesce(n.key, o.key),
           case when n.key is null then o.value
                when o.key is null then n.value
                when coalesce(o.value->>'updatedAt', '') collate "C" > coalesce(n.value->>'updatedAt', '') collate "C" then o.value
                else n.value end), '{}'::jsonb)
    into units
    from jsonb_each(case when jsonb_typeof(nv->'units') = 'object' then nv->'units' else '{}'::jsonb end) n
    full join jsonb_each(case when jsonb_typeof(ov->'units') = 'object' then ov->'units' else '{}'::jsonb end) o on o.key = n.key;
  -- pushes: the new copy's records, each against the saved copy's record with the same id: the undone one where only
  -- one is undone (an Undo is never lost), else the one changed last (changedAt, else undoneAt; a copy that never changed
  -- has neither and loses to one that did), the new copy on a tie. Undo stamps changedAt on the push it undoes, and
  -- doneAt on each night it puts back: when both copies have a night, the one marked undone last is kept, so two devices
  -- that each undid different nights of the same push keep both. Then the saved copy's
  -- records the new copy does not have. Saved records without an id are dropped (the app gives every push one). Newest
  -- first, at most 30
  with n as (
    select e.p, e.i from jsonb_array_elements(case when jsonb_typeof(nv->'pushes') = 'array' then nv->'pushes' else '[]'::jsonb end) with ordinality e(p, i)
     where jsonb_typeof(e.p) = 'object'
  ), o as (
    select e.p, e.i from jsonb_array_elements(case when jsonb_typeof(ov->'pushes') = 'array' then ov->'pushes' else '[]'::jsonb end) with ordinality e(p, i)
     where jsonb_typeof(e.p) = 'object' and e.p->>'id' is not null
  ), pick as (
    select n.i, s.p as sp,
           case
             when s.p is null then n.p
             when (jsonb_typeof(s.p->'undoneAt') is not distinct from 'string') <> (jsonb_typeof(n.p->'undoneAt') is not distinct from 'string')
               then case when jsonb_typeof(s.p->'undoneAt') = 'string' then s.p else n.p end
             when coalesce(s.p->>'changedAt', s.p->>'undoneAt', '') collate "C" > coalesce(n.p->>'changedAt', n.p->>'undoneAt', '') collate "C" then s.p
             else n.p end as p,
           n.p as np
      from n left join lateral (select x.p from o x where n.p->>'id' is not null and x.p->>'id' = n.p->>'id' limit 1) s on true
  ), m as (
    -- the picked copy, with each night from whichever copy marked it undone last (the picked copy's on a tie)
    select case
             when k.sp is null or jsonb_typeof(k.sp->'nights') is distinct from 'object' or jsonb_typeof(k.np->'nights') is distinct from 'object' then k.p
             else jsonb_set(k.p, '{nights}', (
               select coalesce(jsonb_object_agg(coalesce(a.key, b.key),
                        case when a.key is null then b.value
                             when b.key is null then a.value
                             when coalesce(b.value->>'doneAt', '') collate "C" > coalesce(a.value->>'doneAt', '') collate "C" then b.value
                             else a.value end), '{}'::jsonb)
                 from jsonb_each(k.p->'nights') a
                 full join jsonb_each(case when k.p = k.sp then k.np->'nights' else k.sp->'nights' end) b on b.key = a.key))
           end as p, k.i, 0 as src
      from pick k
    union all
    select o.p, o.i, 1 from o where not exists (select 1 from n where n.p->>'id' = o.p->>'id')
  )
  select coalesce(jsonb_agg(x.p order by x.at desc, x.src, x.i), '[]'::jsonb) into pushes
    from (select m.p, m.i, m.src, coalesce(m.p->>'at', '') collate "C" as at from m order by 4 desc, 3, 2 limit 30) x;
  new.data := jsonb_set(new.data, '{v}', nv || jsonb_build_object('units', units, 'pushes', pushes));
  return new;
end $$;
drop trigger if exists blobs_planner_merge on public.blobs;
create trigger blobs_planner_merge before update on public.blobs
  for each row when (new.key = 'ratePlanner') execute function public.planner__merge();
