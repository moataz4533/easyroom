-- Checking a guest in did not put them in the room.
--
-- check_in_booking only moved the booking's status. It left the allocation
-- alone, so a guest who arrived a day before their booking started was
-- checked in while no allocation covered tonight. Two things followed, and
-- the second is worse than the first:
--
--   the board showed their room as available, because it looks for an
--   allocation covering today;
--
--   and available_rooms offered that room to somebody else for tonight, and
--   the exclusion constraint could not object — the two stays genuinely do
--   not overlap in the data. Two guests, one room, no error.
--
-- So check-in now pulls the stay back to today when the guest arrives early.
-- That is what actually happened: they are sleeping there tonight, so the
-- room is held tonight and the night is on the bill, priced by the same
-- resolve_rate as every other night. If the room is not free tonight the
-- exclusion constraint refuses, which is the right answer — reception is
-- told to find another room rather than quietly double-selling this one.
--
-- Checking in after the stay has already ended is refused outright. There is
-- no reading of that which is not a mistake, and guessing which booking was
-- meant would be worse than saying so.

create or replace function public.check_in_booking(p_booking uuid)
returns bookings
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_booking bookings;
  v_today   date;
  v_moved   int := 0;
begin
  select * into v_booking from bookings where id = p_booking;
  if not found then raise exception 'booking not found'; end if;
  if not can_manage(v_booking.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'cannot check in a booking with status %', v_booking.status;
  end if;

  v_today := property_today(v_booking.property_id);

  if v_today >= v_booking.check_out then
    raise exception 'انتهت مدة هذا الحجز في %. سجّل حجزاً جديداً بدلاً من تسكينه',
      to_char(v_booking.check_out, 'YYYY-MM-DD');
  end if;

  -- Arrived early: the room is theirs from tonight, not from the date on the
  -- booking. Moving the start is what makes the board honest and what stops
  -- the room being sold underneath them.
  if v_today < v_booking.check_in then
    begin
      update room_allocations
         set starts_on = v_today, updated_at = now()
       where booking_id = p_booking
         and released_at is null
         and starts_on > v_today;
      get diagnostics v_moved = row_count;
    exception when exclusion_violation then
      raise exception 'الغرفة محجوزة لنزيل آخر حتى %. اختر غرفة أخرى للوصول المبكر',
        to_char(v_booking.check_in, 'YYYY-MM-DD')
        using errcode = '23P01';
    end;

    if v_moved > 0 then
      -- The nights were rewritten by the trigger on room_allocations; the
      -- bill follows them, exactly as it does on the way out.
      perform recalc_booking_total(p_booking);
    end if;
  end if;

  update bookings set status = 'checked_in' where id = p_booking
  returning * into v_booking;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (v_booking.property_id, auth.uid(), 'booking', p_booking, 'checked_in',
          jsonb_build_object('reference', v_booking.reference,
                             'arrived_early', v_moved > 0,
                             'check_in', v_booking.check_in,
                             'total', v_booking.total_amount));

  return v_booking;
end;
$$;

revoke all on function public.check_in_booking(uuid) from public, anon;
grant execute on function public.check_in_booking(uuid) to authenticated;
