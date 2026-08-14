-- Checking out shortened the stay but left the bill at the original figure.
--
-- check_out_booking already trims every allocation to the night the guest
-- actually left, and moves bookings.check_out with it. It was the only
-- function that changes a booking's nights without recalculating what those
-- nights cost — shorten_stay, extend_stay, move_room and release_booking_room
-- all do. That is what makes it an oversight rather than a pricing policy.
--
-- What it did in practice: a guest who booked a week in two rooms at 1200 and
-- left after one night had allocation_nights of 2,400 — which the reports read
-- and were right about — while the booking still said 16,800, which is the
-- number on the screen reception hands the guest and the number the balance
-- pill subtracts payments from. Two answers for one stay, and the guest was
-- shown the one that was seven times too high.
--
-- Deliberately not touched: cancel_booking and mark_no_show. Those set a
-- release_reason, so the room drops out of recalc entirely, and zeroing the
-- bill would erase a cancellation charge the hotel may be owed. A stay that
-- ended early is a different thing from a stay that never happened.

create or replace function public.check_out_booking(p_booking uuid)
returns bookings
language plpgsql
set search_path to 'public'
as $function$
declare
  v_booking public.bookings;
  v_allocation public.room_allocations;
  v_rooms text[] := array[]::text[];
  v_actual_check_out date;
  v_property_today date;
begin
  select * into v_booking
  from public.bookings
  where id = p_booking
  for update;

  if not found then raise exception 'booking not found'; end if;
  if not public.can_manage(v_booking.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select (now() at time zone p.timezone)::date into v_property_today
  from public.properties p where p.id = v_booking.property_id;

  -- Idempotent and self-healing: an offline replay does not add another log
  -- or task, but it can finish releasing a room left behind by the old bug.
  if v_booking.status = 'checked_out' then
    select least(
      v_booking.check_out,
      greatest(
        v_booking.check_in + 1,
        coalesce(min((l.created_at at time zone p.timezone)::date), v_property_today)
      )
    ) into v_actual_check_out
    from public.activity_log l
    join public.properties p on p.id = l.property_id
    where l.entity_id = p_booking and l.action = 'checked_out';

    for v_allocation in
      select a.* from public.room_allocations a
      where a.booking_id = p_booking and a.released_at is null
      for update
    loop
      update public.room_allocations
         set ends_on = greatest(v_allocation.starts_on + 1,
                                least(v_allocation.ends_on, v_actual_check_out)),
             released_at = now(), updated_at = now()
       where id = v_allocation.id;
      update public.rooms
         set housekeeping_status = 'dirty', updated_at = now()
       where id = v_allocation.room_id;
      insert into public.housekeeping_tasks (
        property_id, room_id, booking_id, task_type, status, scheduled_for, priority
      )
      select v_booking.property_id, v_allocation.room_id, p_booking,
             'checkout_clean', 'pending', v_property_today, 10
      where not exists (
        select 1 from public.housekeeping_tasks h
        where h.booking_id = p_booking and h.room_id = v_allocation.room_id
          and h.task_type = 'checkout_clean' and h.status in ('pending', 'in_progress')
      );
    end loop;

    update public.bookings
       set check_out = v_actual_check_out, updated_at = now()
     where id = p_booking;

    -- The nights changed, so the bill has to. Safe to repeat: it reads the
    -- allocations rather than adjusting whatever was there before.
    perform public.recalc_booking_total(p_booking);

    select * into v_booking from public.bookings where id = p_booking;
    return v_booking;
  end if;

  if v_booking.status <> 'checked_in' then
    raise exception 'لا يمكن تسجيل الخروج قبل تسجيل دخول النزيل';
  end if;

  v_actual_check_out := least(v_booking.check_out, greatest(v_booking.check_in + 1, v_property_today));

  for v_allocation in
    select a.*
    from public.room_allocations a
    where a.booking_id = p_booking and a.released_at is null
    for update
  loop
    v_rooms := array_append(v_rooms, (
      select r.number from public.rooms r where r.id = v_allocation.room_id
    ));

    -- Keep the actual occupied nights, and release the allocation immediately
    -- so a new booking can use the room. Reports below explicitly include
    -- released allocations only when their booking was completed.
    update public.room_allocations
       set ends_on = greatest(v_allocation.starts_on + 1,
                              least(v_allocation.ends_on, v_property_today)),
           released_at = now(),
           updated_at = now()
     where id = v_allocation.id;

    update public.rooms
       set housekeeping_status = 'dirty', updated_at = now()
     where id = v_allocation.room_id;

    insert into public.housekeeping_tasks (
      property_id, room_id, booking_id, task_type, status, scheduled_for, priority
    )
    select v_booking.property_id, v_allocation.room_id, p_booking,
           'checkout_clean', 'pending', v_property_today, 10
    where not exists (
      select 1 from public.housekeeping_tasks h
      where h.booking_id = p_booking
        and h.room_id = v_allocation.room_id
        and h.task_type = 'checkout_clean'
        and h.status in ('pending', 'in_progress')
    );
  end loop;

  update public.bookings
     set status = 'checked_out',
         check_out = v_actual_check_out,
         updated_at = now()
   where id = p_booking;

  -- The guest is billed for the nights they slept, which is what the daily
  -- report has always counted. Anything the hotel charges for leaving early
  -- is a line on the bill, not a night nobody stayed.
  perform public.recalc_booking_total(p_booking);

  select * into v_booking from public.bookings where id = p_booking;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, payload
  ) values (
    v_booking.property_id, auth.uid(), 'booking', p_booking, 'checked_out',
    jsonb_build_object(
      'reference', v_booking.reference,
      'rooms', v_rooms,
      'actual_check_out', v_actual_check_out,
      'total', v_booking.total_amount
    )
  );

  return v_booking;
end;
$function$;
