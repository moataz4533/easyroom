-- The manager password is the guard on every action that touches money:
-- cancelling a booking, taking a line off a bill, changing the rates. It was
-- accepted at four characters and with no check on what those were, so
-- "1234" was a valid answer to all of it.
--
-- The lockout below it is sound — bcrypt, five wrong tries, fifteen minutes,
-- and every failure logged — but five tries is plenty when the password is
-- one of the ten anybody would try first. So the weakness is not in the
-- attempts, it is in the choice, and that is what this closes.
--
-- Only setting a password is affected. A password already in use keeps
-- working, because locking a hotel out of its own money guards to enforce a
-- rule made after the fact would be a worse outcome than the rule prevents.
-- The next time it is changed, the new rules apply.
--
-- The Arabic here was also the last of the old colloquial register, on the
-- messages a manager is most likely to read at a bad moment.

create or replace function public.set_action_pin(p_property uuid, p_pin text)
returns void
language plpgsql volatile security definer set search_path = public, auth, extensions as $$
declare
  v_pin text := coalesce(p_pin, '');
begin
  if not is_admin(p_property) then
    raise exception 'تغيير كلمة مرور المدير من صلاحية المدير أو المالك فقط'
      using errcode = '42501';
  end if;

  if length(v_pin) < 6 then
    raise exception 'كلمة مرور المدير ٦ خانات على الأقل';
  end if;

  -- One repeated character, or a straight run up or down. These are the
  -- first guesses anybody makes, and five attempts is more than enough for
  -- all of them.
  if v_pin ~ '^(.)\1+$' then
    raise exception 'كلمة المرور لا يصح أن تكون خانة واحدة مكررة';
  end if;
  if position(v_pin in '01234567890123456789') > 0
     or position(v_pin in '98765432109876543210') > 0 then
    raise exception 'كلمة المرور لا يصح أن تكون أرقاماً متتابعة';
  end if;
  if lower(v_pin) in ('password', 'passw0rd', 'qwerty', 'qwertyui', 'admin1', 'adminadmin') then
    raise exception 'كلمة المرور شائعة جداً، اختر غيرها';
  end if;

  insert into property_secrets (property_id, action_pin_hash, failed_attempts,
                                locked_until, updated_at, updated_by)
  values (p_property, crypt(v_pin, gen_salt('bf')), 0, null, now(), auth.uid())
  on conflict (property_id) do update
    set action_pin_hash = excluded.action_pin_hash,
        failed_attempts = 0,
        locked_until = null,
        updated_at = now(),
        updated_by = auth.uid();

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action)
  values (p_property, auth.uid(), 'security', p_property, 'pin_changed');
end;
$$;

-- Unchanged except for the register of the message a manager reads when the
-- lockout has already fired.
create or replace function public.verify_action_pin(p_property uuid, p_pin text)
returns boolean
language plpgsql volatile security definer set search_path = public, auth, extensions as $$
declare
  v_hash   text;
  v_fails  int;
  v_locked timestamptz;
  v_ok     boolean;
begin
  if not is_member(p_property) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select action_pin_hash, failed_attempts, locked_until
    into v_hash, v_fails, v_locked
  from property_secrets where property_id = p_property;

  -- No password set means the guard is off; roles still apply.
  if v_hash is null then return true; end if;

  if v_locked is not null and v_locked > now() then
    raise exception 'أُوقف الإدخال بعد محاولات خاطئة. أعد المحاولة بعد % دقيقة',
      ceil(extract(epoch from (v_locked - now())) / 60) using errcode = 'P0001';
  end if;

  v_ok := (v_hash = crypt(coalesce(p_pin, ''), v_hash));

  if v_ok then
    update property_secrets set failed_attempts = 0, locked_until = null
     where property_id = p_property;
  else
    update property_secrets
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5
                               then now() + interval '15 minutes' else null end
     where property_id = p_property;

    insert into activity_log (property_id, actor_id, entity_type, entity_id, action)
    values (p_property, auth.uid(), 'security', p_property, 'pin_failed');
  end if;

  return v_ok;
end;
$$;

revoke all on function public.set_action_pin(uuid, text) from public, anon;
revoke all on function public.verify_action_pin(uuid, text) from public, anon;
grant execute on function public.set_action_pin(uuid, text) to authenticated;
grant execute on function public.verify_action_pin(uuid, text) to authenticated;
