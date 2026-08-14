-- Shared guard. Raising here rather than returning false means a caller
-- can't ignore the result and carry on.
create or replace function require_action_pin(p_property uuid, p_pin text)
returns void
language plpgsql volatile security invoker set search_path = public as $$
begin
  if not verify_action_pin(p_property, p_pin) then
    raise exception 'الباسورد غلط' using errcode = '42501';
  end if;
end;
$$;

grant execute on function require_action_pin(uuid, text) to authenticated;
revoke all on function require_action_pin(uuid, text) from public, anon;

-- Old signatures go, so nothing can call the unguarded versions.
drop function if exists cancel_booking(uuid, text);
drop function if exists mark_no_show(uuid, numeric);
drop function if exists release_booking_room(uuid, text);
drop function if exists shorten_stay(uuid, date);

create or replace function cancel_booking(p_booking uuid, p_reason text default null, p_pin text default null)
returns bookings
language plpgsql volatile security invoker set search_path = public as $$
declare v_booking bookings;
begin
  select * into v_booking from bookings where id = p_booking;
  if not found then raise exception 'booking not found'; end if;
  if not can_manage(v_booking.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  perform require_action_pin(v_booking.property_id, p_pin);

  update bookings
     set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
   where id = p_booking returning * into v_booking;

  update room_allocations set released_at = now(), release_reason = 'إلغاء الحجز'
   where booking_id = p_booking and released_at is null;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (v_booking.property_id, auth.uid(), 'booking', p_booking, 'cancelled',
          jsonb_build_object('reason', p_reason, 'amount', v_booking.total_amount));

  return v_booking;
end;
$$;

create or replace function mark_no_show(p_booking uuid, p_charge numeric default 0, p_pin text default null)
returns bookings
language plpgsql volatile security invoker set search_path = public as $$
declare v_booking bookings;
begin
  select * into v_booking from bookings where id = p_booking;
  if not found then raise exception 'booking not found'; end if;
  if not can_manage(v_booking.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  perform require_action_pin(v_booking.property_id, p_pin);

  update bookings set status = 'no_show', total_amount = p_charge, cancelled_at = now()
   where id = p_booking returning * into v_booking;

  update room_allocations set released_at = now(), release_reason = 'عدم حضور'
   where booking_id = p_booking and released_at is null;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (v_booking.property_id, auth.uid(), 'booking', p_booking, 'no_show',
          jsonb_build_object('charge', p_charge));

  return v_booking;
end;
$$;

create or replace function release_booking_room(p_allocation uuid, p_reason text default null, p_pin text default null)
returns bookings
language plpgsql volatile security invoker set search_path = public as $$
declare v_alloc room_allocations; v_booking bookings; v_left int;
begin
  select * into v_alloc from room_allocations where id = p_allocation;
  if not found then raise exception 'allocation not found'; end if;
  if not can_manage(v_alloc.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_alloc.booking_id is null then raise exception 'not part of a booking'; end if;

  perform require_action_pin(v_alloc.property_id, p_pin);

  update room_allocations set released_at = now(),
         release_reason = coalesce(p_reason, 'إلغاء جزئي')
   where id = p_allocation;

  select count(*) into v_left from room_allocations
   where booking_id = v_alloc.booking_id and released_at is null;

  if v_left = 0 then
    update bookings set status = 'cancelled', cancelled_at = now(),
           cancel_reason = coalesce(p_reason, 'كل الغرف اتلغت')
     where id = v_alloc.booking_id;
  else
    perform recalc_booking_total(v_alloc.booking_id);
  end if;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (v_alloc.property_id, auth.uid(), 'booking', v_alloc.booking_id, 'room_released',
          jsonb_build_object('room', v_alloc.room_id, 'reason', p_reason, 'rooms_left', v_left));

  select * into v_booking from bookings where id = v_alloc.booking_id;
  return v_booking;
end;
$$;

-- Early departure reduces the bill, so it gets the same gate.
create or replace function shorten_stay(p_booking uuid, p_new_check_out date, p_pin text default null)
returns bookings
language plpgsql volatile security invoker set search_path = public as $$
declare v_booking bookings;
begin
  select * into v_booking from bookings where id = p_booking;
  if not found then raise exception 'booking not found'; end if;
  if not can_manage(v_booking.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_new_check_out <= v_booking.check_in then
    raise exception 'الخروج لازم يكون بعد الدخول — لو ملغي استخدم الإلغاء';
  end if;

  perform require_action_pin(v_booking.property_id, p_pin);

  update room_allocations set ends_on = p_new_check_out
   where booking_id = p_booking and released_at is null and ends_on > p_new_check_out;

  perform recalc_booking_total(p_booking);

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (v_booking.property_id, auth.uid(), 'booking', p_booking, 'shortened',
          jsonb_build_object('from', v_booking.check_out, 'to', p_new_check_out));

  select * into v_booking from bookings where id = p_booking;
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------
-- Rates: writes move behind the PIN too.
-- RLS can't take a password as an argument, so direct writes are closed
-- and everything goes through this function instead.
-- ---------------------------------------------------------------------
drop policy if exists rates_write on rates;

create policy rates_no_direct_write on rates
  for all using (false) with check (false);

create or replace function save_rates(p_property uuid, p_rows jsonb, p_pin text default null)
returns int
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  v_row jsonb;
  v_count int := 0;
begin
  if not is_admin(p_property) then
    raise exception 'المدير أو المالك بس اللي يقدر يغير الأسعار' using errcode = '42501';
  end if;

  perform require_action_pin(p_property, p_pin);

  for v_row in select * from jsonb_array_elements(p_rows) loop
    if (v_row ->> 'amount') is null or (v_row ->> 'amount') = '' then
      delete from rates
       where property_id  = p_property
         and room_type_id = (v_row ->> 'room_type_id')::uuid
         and rate_plan_id = (v_row ->> 'rate_plan_id')::uuid
         and occupancy    = (v_row ->> 'occupancy')::int
         and valid_from is null;
    else
      insert into rates (property_id, room_type_id, rate_plan_id, occupancy, amount)
      values (p_property,
              (v_row ->> 'room_type_id')::uuid,
              (v_row ->> 'rate_plan_id')::uuid,
              (v_row ->> 'occupancy')::int,
              (v_row ->> 'amount')::numeric)
      on conflict (property_id, room_type_id, rate_plan_id, occupancy, valid_from)
      do update set amount = excluded.amount, updated_at = now();
    end if;
    v_count := v_count + 1;
  end loop;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (p_property, auth.uid(), 'rates', p_property, 'updated',
          jsonb_build_object('changed', v_count));

  return v_count;
end;
$$;

revoke all on function save_rates(uuid, jsonb, text) from public, anon;
grant execute on function save_rates(uuid, jsonb, text) to authenticated;

grant execute on function cancel_booking(uuid, text, text)        to authenticated;
grant execute on function mark_no_show(uuid, numeric, text)       to authenticated;
grant execute on function release_booking_room(uuid, text, text)  to authenticated;
grant execute on function shorten_stay(uuid, date, text)          to authenticated;
revoke all on function cancel_booking(uuid, text, text)       from public, anon;
revoke all on function mark_no_show(uuid, numeric, text)      from public, anon;
revoke all on function release_booking_room(uuid, text, text) from public, anon;
revoke all on function shorten_stay(uuid, date, text)         from public, anon;
