-- 0005: tightening after the first production run of the Supabase advisors (2026-10-12).
-- Safe to re-run: only grants, a function setting and policy expressions change; no data is touched.

-- 1. Database functions that only signed-in people use. 0001 revoked them from anon, but Postgres also grants
--    EXECUTE to PUBLIC by default, so anon could still call them (each one refused inside, but the refusal should come
--    from the grant). guest_get / guest_act stay open to anon on purpose (the guest app), api_user_by_email stays
--    service-role only (0002), platform_operators was already closed (0004).
do $$
declare fn text;
begin
  foreach fn in array array[
    'my_context()', 'platform_overview()', 'set_org_status(uuid, text)', 'set_org_plan(uuid, text)', 'reset_org(uuid)',
    'is_member(uuid)', 'can_write(uuid)', 'member_role(uuid)', 'is_platform_admin()'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function public.%s from anon', fn); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function public.%s to authenticated', fn); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function public.%s to service_role', fn); end if;
  end loop;
end $$;

-- 2. The change-stamp trigger function gets a fixed search_path like every other function (its body is fully qualified).
alter function public.stamp_change() set search_path = '';

-- 3. Policies: evaluate auth.uid() once per query instead of once per row (same rules, same results).
alter policy members_read on public.members
  using ((user_id = (select auth.uid())) or public.is_member(org_id) or public.is_platform_admin());
alter policy members_owner_update on public.members
  using ((public.member_role(org_id) = 'owner') and (user_id <> (select auth.uid())))
  with check ((public.member_role(org_id) = 'owner') and (role <> 'owner'));
alter policy platform_admins_read on public.platform_admins
  using ((user_id = (select auth.uid())) or public.is_platform_admin());
alter policy requests_insert on public.subscription_requests
  with check (user_id = (select auth.uid()));
alter policy requests_read on public.subscription_requests
  using ((user_id = (select auth.uid())) or public.is_platform_admin());
