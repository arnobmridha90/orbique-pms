-- Orbique PMS: database functions used by the server app (app/server/*.js).
-- Safe to run more than once.

-- Platform admin: one row per operator with counts only (no guest or money data).
-- Extends platform_overview() (0001) with the bookings count, how far the workspace is set up,
-- and each owner's staff id (needed to reset an owner's password through /api/account).
create or replace function public.platform_operators() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'plan', o.plan,
      'status', o.status,
      'createdAt', o.created_at,
      'members', (select count(*) from members m where m.org_id = o.id and m.status = 'active'),
      'owners', (select coalesce(jsonb_agg(jsonb_build_object(
                    'staffId', m.staff_id, 'email', u.email, 'name', coalesce(u.raw_user_meta_data->>'name', ''), 'status', m.status
                  ) order by m.created_at), '[]'::jsonb)
                 from members m join auth.users u on u.id = m.user_id
                 where m.org_id = o.id and m.role = 'owner'),
      'units', (select count(*) from records r where r.org_id = o.id and r.coll = 'properties' and not r.deleted
                  and coalesce(r.data->>'status', 'active') <> 'archived'),
      'bookings', (select count(*) from records r where r.org_id = o.id and r.coll = 'bookings' and not r.deleted),
      'setup', coalesce((select case when b.data->'v'->>'storyDate' is null then 'none'
                                     when coalesce(b.data->'v'->>'demo', 'false') = 'true' then 'demo' else 'live' end
                         from blobs b where b.org_id = o.id and b.key = 'workspaceMeta'), 'none'),
      'lastActivity', greatest((select max(r.updated_at) from records r where r.org_id = o.id),
                               (select max(b.updated_at) from blobs b where b.org_id = o.id))
    ) order by o.created_at desc)
    from orgs o), '[]'::jsonb);
end $$;

revoke all on function public.platform_operators() from public, anon;
grant execute on function public.platform_operators() to authenticated;

-- Column limits for direct updates by signed-in people (0001 grants UPDATE on whole rows; RLS limits the rows).
-- Without these, an owner could change their own plan or resume a workspace Orbique paused, through the REST API.
-- Plan and status change only through set_org_plan / set_org_status (platform admin). Owners may rename the workspace.
revoke update on public.orgs from authenticated;
grant update (name) on public.orgs to authenticated;
-- Owners change a member's role and status (O.auth.setMemberRole / setMemberStatus); who the member is, and which
-- staff record they sign in as, change only through /api/account (service role).
revoke update on public.members from authenticated;
grant update (role, status) on public.members to authenticated;
