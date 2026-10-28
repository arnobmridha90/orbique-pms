-- 0017: the website's content (the Live website page, app/pages/livesite.js; api/site.js; GET /api/public/site).
--
-- What is here:
--   * website_can(org, 'edit' | 'publish'): may the signed-in member edit or publish the website. The same rule as the
--     app's O.can('website.edit') / O.can('website.publish') (app/core.js) and websiteAllowed() in api/_lib/site.js:
--     an active member who is not suspended in staffMeta; owners always; anyone else needs the Website builder section at
--     Edit and the action switched on, from their own overrides (staffMeta[staffId].overrides) first, then their role's
--     saved permissions (rolePerms), then the app's defaults when the saved role does not mention the website (only Ops
--     managers have it by default). rolePerms and staffMeta are written by owners only (0001, 0016).
--   * blobs_insert, blobs_update:
--       'siteContentLive' (the published copy) is written only by the server (service role, on Publish), never by a
--       signed-in member, so what the site shows always passed the server's checks;
--       'siteContent' (the draft) is written only by members who may edit the website.
--     Reading stays as in 0016: every member reads both (the page shows the draft and when it was last published).
--
-- Re-runnable: the function is replaced, the policies are dropped and created again.

create or replace function public.website_can(p_org uuid, p_action text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  m record; meta jsonb; ov jsonb; perms jsonb; saved jsonb; lvl text; act text := 'website.' || p_action;
  defaults constant jsonb := '{"ops": {"sections": {"website": "edit"}, "actions": {"website.edit": true, "website.publish": true}}}';
begin
  if p_action not in ('edit', 'publish') then return false; end if;
  select mm.role, mm.staff_id into m from members mm where mm.org_id = p_org and mm.user_id = auth.uid() and mm.status = 'active';
  if not found then return false; end if;
  select case when jsonb_typeof(b.data->'v') = 'object' then b.data->'v' end into meta from blobs b where b.org_id = p_org and b.key = 'staffMeta';
  meta := case when jsonb_typeof(meta->m.staff_id) = 'object' then meta->m.staff_id else '{}'::jsonb end;
  if meta->>'status' = 'suspended' then return false; end if;
  if m.role = 'owner' then return true; end if;
  ov := case when jsonb_typeof(meta->'overrides') = 'object' then meta->'overrides' else '{}'::jsonb end;
  select case when jsonb_typeof(b.data->'v') = 'object' then b.data->'v' end into perms from blobs b where b.org_id = p_org and b.key = 'rolePerms';
  -- no saved permissions yet: the app uses its defaults for every role
  if perms is null then perms := defaults; end if;
  saved := case when jsonb_typeof(perms->m.role) = 'object' then perms->m.role else null end;
  -- the section level
  if ov ? 'section:website' then
    lvl := coalesce(nullif(ov->>'section:website', ''), 'none');
  elsif saved is not null and jsonb_typeof(saved->'sections') = 'object' and not (saved->'sections' ? 'website') then
    lvl := coalesce(defaults->m.role->'sections'->>'website', 'none');
  else
    lvl := coalesce(saved->'sections'->>'website', 'none');
  end if;
  if lvl <> 'edit' then return false; end if;
  -- the action
  if ov ? act then return jsonb_typeof(ov->act) = 'boolean' and (ov->act)::text = 'true'; end if;
  if saved is not null and jsonb_typeof(saved->'actions') = 'object' and not (saved->'actions' ? act) then
    return coalesce((defaults->m.role->'actions'->act)::text = 'true', false);
  end if;
  return coalesce(jsonb_typeof(saved->'actions'->act) = 'boolean' and (saved->'actions'->act)::text = 'true', false);
end $$;
revoke all on function public.website_can(uuid, text) from public;
grant execute on function public.website_can(uuid, text) to authenticated;

drop policy if exists blobs_insert on public.blobs;
create policy blobs_insert on public.blobs for insert to authenticated
  with check (public.can_write(org_id)
    and (key not in ('rolePerms', 'staffMeta', 'ratePlanner') or public.member_role(org_id) = 'owner')
    and key <> 'siteContentLive'
    and (key <> 'siteContent' or public.website_can(org_id, 'edit')));
drop policy if exists blobs_update on public.blobs;
create policy blobs_update on public.blobs for update to authenticated
  using (public.can_write(org_id)
    and (key not in ('rolePerms', 'staffMeta', 'ratePlanner') or public.member_role(org_id) = 'owner')
    and key <> 'siteContentLive'
    and (key <> 'siteContent' or public.website_can(org_id, 'edit')))
  with check (public.can_write(org_id)
    and (key not in ('rolePerms', 'staffMeta', 'ratePlanner') or public.member_role(org_id) = 'owner')
    and key <> 'siteContentLive'
    and (key <> 'siteContent' or public.website_can(org_id, 'edit')));
