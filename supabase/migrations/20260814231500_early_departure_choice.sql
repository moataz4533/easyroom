-- Leaving early: the hotel decides, not the software.
--
-- The previous migration made the bill follow the nights actually slept,
-- which is the right default and the one most small hotels use for a direct
-- booking. It is not the only policy: a stay taken in high season, or one
-- promised against a held room, is often charged in full whether the guest
-- sleeps there or not.
--
-- So check-out now takes the choice. Billing the full booked stay does not
-- mean leaving phantom nights on the record — the room-nights stay honest at
-- what was slept, and the difference goes on the bill as an early-departure
-- line. That matters beyond tidiness: ADR and RevPAR are per room-night by
-- definition, and charging seven nights for one would quietly inflate both.
--
-- The old single-argument function is dropped rather than left beside this
-- one, so there is exactly one check-out in the database and no chance of a
-- caller reaching the version that cannot be told what to do. The default
-- keeps every existing caller working, including a check-out replayed from
-- the offline queue with only p_booking in its arguments.

drop function if exists public.check_out_booking(uuid);

create or replace function public.check_out_booking(
  p_booking uuid,
  p_charge_unstayed boolean default false
)
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
  v_booked numeric := 0;
  v_stayed numeric := 0;
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

  -- What the stay was worth before it was trimmed. Read now, because the
  -- nights are about to be rewritten and there is no other record of them.
  select coalesce(sum(an.amount), 0) into v_booked
  from public.allocation_nights an
  join public.room_allocations a on a.id = an.allocation_id
  where a.booking_id = p_booking and a.release_reason is null;

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
    -- allocations rather than adjusting whatever was there before. No charge
    -- is added here — a replay must not bill the guest a second time.
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

  -- The room-nights are always what was slept. Whatever the hotel charges on
  -- top of that is a line on the bill, never a night nobody stayed in.
  v_stayed := public.recalc_booking_total(p_booking);

  if p_charge_unstayed and v_booked > v_stayed then
    perform public.add_booking_charge(
      p_booking, null, 'رسوم مغادرة مبكرة', 1, v_booked - v_stayed,
      'الليالي المحجوزة التي لم يقم بها النزيل'
    );
  end if;

  select * into v_booking from public.bookings where id = p_booking;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, payload
  ) values (
    v_booking.property_id, auth.uid(), 'booking', p_booking, 'checked_out',
    jsonb_build_object(
      'reference', v_booking.reference,
      'rooms', v_rooms,
      'actual_check_out', v_actual_check_out,
      'nights_billed', v_stayed,
      'charged_unstayed', p_charge_unstayed and v_booked > v_stayed,
      'total', v_booking.total_amount
    )
  );

  return v_booking;
end;
$function$;

revoke all on function public.check_out_booking(uuid, boolean) from public, anon;
grant execute on function public.check_out_booking(uuid, boolean) to authenticated;
