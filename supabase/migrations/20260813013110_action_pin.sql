-- A manager PIN on destructive actions.
--
-- Checked in the database, not the browser: a check in the frontend is
-- theatre, because anyone can call the API directly. These functions
-- refuse to run without a valid PIN no matter who is calling.

-- Its own table with NO select policy, so the hash is unreadable even to
-- owners. Only the SECURITY DEFINER functions below can see it, which
-- stops anyone pulling the hash and cracking a 4-digit PIN offline.
create table property_secrets (
  property_id    uuid primary key references properties(id) on delete cascade,
  action_pin_hash text,
  failed_attempts int not null default 0,
  locked_until   timestamptz,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references profiles(id) on delete set null
);

alter table property_secrets enable row level security;
-- Deliberately no policies: nothing reaches this table except via the
-- functions below.

-- Is a PIN configured? Safe to expose — reveals nothing about its value.
create or replace function has_action_pin(p_property uuid)
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from property_secrets
    where property_id = p_property and action_pin_hash is not null
  ) and is_member(p_property);
$$;

-- Set or change the PIN. Owners and managers only.
create or replace function set_action_pin(p_property uuid, p_pin text)
returns void
language plpgsql volatile security definer set search_path = public, auth, extensions as $$
begin
  if not is_admin(p_property) then
    raise exception 'المدير أو المالك بس اللي يقدر يغير الباسورد' using errcode = '42501';
  end if;
  if p_pin is null or length(p_pin) < 4 then
    raise exception 'الباسورد لازم 4 حروف أو أرقام على الأقل';
  end if;

  insert into property_secrets (property_id, action_pin_hash, failed_attempts,
                                locked_until, updated_at, updated_by)
  values (p_property, crypt(p_pin, gen_salt('bf')), 0, null, now(), auth.uid())
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

-- Remove it, going back to role-only protection.
create or replace function clear_action_pin(p_property uuid)
returns void
language plpgsql volatile security definer set search_path = public, auth as $$
begin
  if not is_admin(p_property) then
    raise exception 'المدير أو المالك بس' using errcode = '42501';
  end if;
  update property_secrets set action_pin_hash = null, failed_attempts = 0,
         locked_until = null, updated_at = now(), updated_by = auth.uid()
   where property_id = p_property;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action)
  values (p_property, auth.uid(), 'security', p_property, 'pin_cleared');
end;
$$;

-- Verify, with a lockout. A 4-digit PIN is trivial to guess by brute
-- force otherwise: 5 wrong tries locks it for 15 minutes.
create or replace function verify_action_pin(p_property uuid, p_pin text)
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

  -- No PIN set means the feature is off; roles still apply.
  if v_hash is null then return true; end if;

  if v_locked is not null and v_locked > now() then
    raise exception 'اتقفل بعد محاولات غلط. جرب تاني بعد % دقيقة',
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

revoke all on function has_action_pin(uuid)      from public, anon;
revoke all on function set_action_pin(uuid, text) from public, anon;
revoke all on function clear_action_pin(uuid)    from public, anon;
revoke all on function verify_action_pin(uuid, text) from public, anon;
grant execute on function has_action_pin(uuid)      to authenticated;
grant execute on function set_action_pin(uuid, text) to authenticated;
grant execute on function clear_action_pin(uuid)    to authenticated;
grant execute on function verify_action_pin(uuid, text) to authenticated;
