-- 0016: the profit planner's saved data is for account owners only.
--
-- What is here:
--   * blobs_read: the 'ratePlanner' blob (each unit's costs, profit target and assumptions, and the push history that
--     Undo relies on) is read only by owners. Every other blob stays readable by every member, as in 0001.
--   * blobs_insert, blobs_update: 'ratePlanner' joins 'rolePerms' and 'staffMeta' as owner-only writes.
--
-- Why: the planner page is owner-only (O.OWNER_ONLY), and its Save says only account owners see the costs, but 0001 let
-- every member read and write every blob. Other members' browsers no longer load the blob (auth.js reads every blob the
-- policy lets through), and nothing outside the planner reads it.

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
