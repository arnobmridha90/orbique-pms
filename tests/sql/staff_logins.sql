-- 0019: login_try counts tries atomically and refuses at the limit; set_login_names is all or nothing.
do $$
declare a uuid := '00000000-0000-4000-8000-0000000000a1'; b uuid := '00000000-0000-4000-8000-0000000000a2';
begin
  insert into auth.users (id) values (a), (b) on conflict do nothing;
  assert public.login_try(array['k1', 'ip:x'], array[2, 5], 900);
  assert public.login_try(array['k1', 'ip:x'], array[2, 5], 900);
  assert not public.login_try(array['k1', 'ip:x'], array[2, 5], 900), 'third try refused';
  assert (select count(*) from public.login_failures) = 4, 'a refused try is not counted';
  perform public.set_login_names(a, array['phone', 'username'], array['60123456789', 'aina']);
  perform public.set_login_names(b, array['phone'], array['60198765432']);
  begin
    perform public.set_login_names(b, array['phone', 'username'], array[null, 'aina']);
    raise exception 'taken name was accepted';
  exception when unique_violation then
    assert sqlerrm = 'username-taken', sqlerrm;
  end;
  assert exists (select 1 from public.login_names where user_id = b and kind = 'phone'), 'refused change kept the old name';
  assert not has_function_privilege('authenticated', 'public.login_try(text[], int[], int)', 'execute');
  assert not has_function_privilege('anon', 'public.set_login_names(uuid, text[], text[])', 'execute');
  raise notice 'staff logins: ok';
end $$;
