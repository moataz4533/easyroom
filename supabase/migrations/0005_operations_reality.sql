-- =====================================================================
-- 0005_operations_reality.sql
--
-- What actually happens at a front desk: guests extend, guests leave
-- early, rooms break, half a group cancels. None of these are errors --
-- they are the job. The system's role is to answer fast and never leave
-- a booking silently stranded.
--
-- Design rule throughout: when something can't be done, say WHY and
-- WHICH room blocked it. A bare "failed" sends the receptionist back
-- to the paper diary.
-- =====================================================================

-- Why an allocation stopped blocking, and what still needs a human.
alter table room_allocations
  add column release_reason text;

alter table bookings
  add column attention_reason text;

comment on column bookings.attention_reason is
  'Set when a booking lost its room and needs re-allocating. Drives the attention queue.';

-- ---------------------------------------------------------------------
-- Recompute a booking total from its live allocations.
-- Called after every change, so the total is never stale.
-- ---------------------------------------------------------------------
create or replace function recalc_booking_total(p_booking uuid)
returns numeric
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_total  numeric := 0;
  v_heads  int := 0;
  v_plan   uuid;
  v_prop   uuid;
  a        record;
begin
  select property_id, rate_plan_id into v_prop, v_plan from bookings where id = p_booking;

  for a in
    select ra.*, r.room_type_id
    from room_allocations ra
    join rooms r on r.id = ra.room_id
    where ra.booking_id = p_booking and ra.released_at is null
  loop
    v_total := v_total + quote_stay(v_prop, a.room_type_id, v_plan, a.occupancy, a.starts_on, a.ends_on);
    v_heads := v_heads + a.occupancy;
  end loop;

  update bookings
     set total_amount = v_total,
         adults = greatest(v_heads, 1),
         check_in  = coalesce((select min(starts_on) from room_allocations
                               where booking_id = p_booking and released_at is null), check_in),
         check_out = coalesce((select max(ends_on) from room_allocations
                               where booking_id = p_booking and released_at is null), check_out)
   where id = p_booking;

  return v_total;
end;
$$;

-- =====================================================================
-- EXTENSION — "ممكن أقعد كام يوم كمان؟"
-- =====================================================================

-- Ask before doing. Returns one row per room so reception can answer
-- the guest immediately, while still on the phone.
create or replace function check_extension(p_booking uuid, p_new_check_out date)
returns table (
  allocation_id uuid,
  room_id       uuid,
  room_number   text,
  can_extend    boolean,
  blocked_from  date,
  blocked_by    text
)
language sql stable security invoker set search_path = public as $$
  select
    a.id,
    a.room_id,
    r.number,
    conflict.id is null,
    conflict.starts_on,
    case
      when conflict.id is null then null
      when conflict.kind = 'booking' then coalesce(b2.reference, 'حجز آخر')
      else 'صيانة'
    end
  from room_allocations a
  join rooms r on r.id = a.room_id
  left join lateral (
    select c.id, c.starts_on, c.kind, c.booking_id
    from room_allocations c
    where c.room_id = a.room_id
      and c.id <> a.id
      and c.released_at is null
      and c.stay && daterange(a.ends_on, p_new_check_out, '[)')
    order by c.starts_on
    limit 1
  ) conflict on true
  left join bookings b2 on b2.id = conflict.booking_id
  where a.booking_id = p_booking
    and a.released_at is null;
$$;

-- Do it. All rooms extend or none do -- a half-extended group booking
-- is worse than a clean refusal.
create or replace function extend_stay(p_booking uuid, p_new_check_out date)
returns bookings
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_booking bookings;
  v_blocker record;
begin
  select * into v_booking from bookings where id = p_booking;
  if not found then raise exception 'booking not found'; end if;
  if not can_manage(v_booking.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_booking.status not in ('confirmed', 'checked_in') then
    raise exception 'cannot extend a booking with status %', v_booking.status;
  end if;
  if p_new_check_out <= v_booking.check_out then
    raise exception 'new checkout must be after the current one';
  end if;

  select * into v_blocker from check_extension(p_booking, p_new_check_out)
  where not can_extend limit 1;

  if found then
    raise exception 'الغرفة % محجوزة من % (%). التمديد مش ممكن من غير نقل.',
      v_blocker.room_number, v_blocker.blocked_from, v_blocker.blocked_by
      using errcode = 'P0001';
  end if;

  update room_allocations
     set ends_on = p_new_check_out
   where booking_id = p_booking and released_at is null;

  perform recalc_booking_total(p_booking);

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (v_booking.property_id, auth.uid(), 'booking', p_booking, 'extended',
          jsonb_build_object('from', v_booking.check_out, 'to', p_new_check_out));

  select * into v_booking from bookings where id = p_booking;
  return v_booking;
end;
$$;

-- Early departure. Frees the nights, drops the charge, queues cleaning.
create or replace function shorten_stay(p_booking uuid, p_new_check_out date)
returns bookings
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_booking bookings;
  v_room    uuid;
begin
  select * into v_booking from bookings where id = p_booking;
  if not found then raise exception 'booking not found'; end if;
  if not can_manage(v_booking.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_new_check_out <= v_booking.check_in then
    raise exception 'checkout must be after check-in -- cancel the booking instead';
  end if;

  update room_allocations
     set ends_on = p_new_check_out
   where booking_id = p_booking and released_at is null and ends_on > p_new_check_out;

  perform recalc_booking_total(p_booking);

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (v_booking.property_id, auth.uid(), 'booking', p_booking, 'shortened',
          jsonb_build_object('from', v_booking.check_out, 'to', p_new_check_out));

  select * into v_booking from bookings where id = p_booking;
  return v_booking;
end;
$$;

-- =====================================================================
-- ROOM MOVE — the answer to a failed extension, and to a broken room.
-- =====================================================================

-- Free rooms that could take this allocation, same type first.
create or replace function suggest_alternative_rooms(
  p_allocation uuid,
  p_from       date default null,
  p_to         date default null
)
returns table (
  room_id     uuid,
  room_number text,
  type_name   text,
  same_type   boolean
)
language sql stable security invoker set search_path = public as $$
  with a as (
    select ra.*, r.room_type_id, r.property_id as prop
    from room_allocations ra join rooms r on r.id = ra.room_id
    where ra.id = p_allocation
  )
  select r.id, r.number, rt.name, (r.room_type_id = a.room_type_id)
  from a
  join rooms r on r.property_id = a.prop
  join room_types rt on rt.id = r.room_type_id
  where r.is_active
    and r.id <> a.room_id
    and r.housekeeping_status <> 'out_of_order'
    and rt.max_occupancy >= a.occupancy
    and not exists (
      select 1 from room_allocations c
      where c.room_id = r.id
        and c.released_at is null
        and c.stay && daterange(coalesce(p_from, a.starts_on), coalesce(p_to, a.ends_on), '[)')
    )
  order by (r.room_type_id = a.room_type_id) desc, rt.sort_order, r.number;
$$;

-- Move a guest to another room, optionally only from a given date
-- (a mid-stay move splits the allocation in two).
create or replace function move_room(
  p_allocation uuid,
  p_new_room   uuid,
  p_from       date default null,
  p_reason     text default null
)
returns room_allocations
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_alloc room_allocations;
  v_new   room_allocations;
  v_split date;
  v_max   int;
begin
  select * into v_alloc from room_allocations where id = p_allocation;
  if not found then raise exception 'allocation not found'; end if;
  if not can_manage(v_alloc.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select rt.max_occupancy into v_max
  from rooms r join room_types rt on rt.id = r.room_type_id
  where r.id = p_new_room and r.property_id = v_alloc.property_id;

  if v_max is null then raise exception 'target room not in this property'; end if;
  if v_max < v_alloc.occupancy then
    raise exception 'الغرفة الجديدة بتاخد % أفراد بس، والحجز %', v_max, v_alloc.occupancy;
  end if;

  v_split := greatest(coalesce(p_from, v_alloc.starts_on), v_alloc.starts_on);

  if v_split <= v_alloc.starts_on then
    -- Whole stay moves.
    update room_allocations set room_id = p_new_room, notes = coalesce(p_reason, notes)
     where id = p_allocation returning * into v_new;
  else
    -- Split: first part stays put, remainder moves.
    if v_split >= v_alloc.ends_on then
      raise exception 'move date is after the stay ends';
    end if;

    update room_allocations set ends_on = v_split where id = p_allocation;

    insert into room_allocations (
      property_id, room_id, booking_id, kind, starts_on, ends_on,
      occupancy, rate_per_night, notes
    ) values (
      v_alloc.property_id, p_new_room, v_alloc.booking_id, v_alloc.kind,
      v_split, v_alloc.ends_on, v_alloc.occupancy, v_alloc.rate_per_night, p_reason
    ) returning * into v_new;
  end if;

  if v_alloc.booking_id is not null then
    perform recalc_booking_total(v_alloc.booking_id);
    update bookings set attention_reason = null
     where id = v_alloc.booking_id and attention_reason is not null;

    insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
    values (v_alloc.property_id, auth.uid(), 'booking', v_alloc.booking_id, 'room_moved',
            jsonb_build_object('from_room', v_alloc.room_id, 'to_room', p_new_room,
                               'from_date', v_split, 'reason', p_reason));
  end if;

  return v_new;
end;
$$;

-- =====================================================================
-- ROOM OUT OF ORDER — the hardest one, because it can hit occupied rooms.
--
-- Deliberate choice: the block always wins. A broken room is a fact, not
-- a request. Affected bookings are released and flagged, and the function
-- RETURNS them so the interface can immediately offer relocations
-- instead of quietly losing a reservation.
-- =====================================================================
create or replace function block_room(
  p_room   uuid,
  p_from   date,
  p_to     date,
  p_reason text default 'صيانة',
  p_kind   allocation_kind default 'maintenance'
)
returns table (
  booking_id    uuid,
  reference     text,
  guest_name    text,
  guest_phone   text,
  starts_on     date,
  ends_on       date,
  occupancy     int
)
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_prop uuid;
begin
  select property_id into v_prop from rooms where id = p_room;
  if v_prop is null then raise exception 'room not found'; end if;
  if not can_manage(v_prop) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_to <= p_from then raise exception 'end date must be after start date'; end if;

  -- Capture who is affected before we release them.
  create temp table _displaced on commit drop as
  select a.id as alloc_id, a.booking_id, b.reference, g.full_name, g.phone,
         a.starts_on, a.ends_on, a.occupancy
  from room_allocations a
  left join bookings b on b.id = a.booking_id
  left join guests g   on g.id = b.guest_id
  where a.room_id = p_room
    and a.released_at is null
    and a.stay && daterange(p_from, p_to, '[)');

  update room_allocations
     set released_at = now(), release_reason = p_reason
   where id in (select alloc_id from _displaced);

  update bookings
     set attention_reason = format('الغرفة اتعطلت: %s', p_reason)
   where id in (select d.booking_id from _displaced d where d.booking_id is not null);

  insert into room_allocations (property_id, room_id, kind, starts_on, ends_on, notes)
  values (v_prop, p_room, p_kind, p_from, p_to, p_reason);

  if current_date between p_from and p_to - 1 then
    update rooms set housekeeping_status = 'out_of_order' where id = p_room;
  end if;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (v_prop, auth.uid(), 'room', p_room, 'blocked',
          jsonb_build_object('from', p_from, 'to', p_to, 'reason', p_reason,
                             'displaced', (select count(*) from _displaced)));

  return query
    select d.booking_id, d.reference, d.full_name, d.phone,
           d.starts_on, d.ends_on, d.occupancy
    from _displaced d where d.booking_id is not null;
end;
$$;

create or replace function unblock_room(p_room uuid)
returns void
language plpgsql volatile security invoker set search_path = public as $$
declare v_prop uuid;
begin
  select property_id into v_prop from rooms where id = p_room;
  if not can_manage(v_prop) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  update room_allocations
     set released_at = now(), release_reason = 'انتهت الصيانة'
   where room_id = p_room and kind = 'maintenance'
     and released_at is null and ends_on > current_date;

  update rooms
     set housekeeping_status = 'dirty'
   where id = p_room and housekeeping_status = 'out_of_order';

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action)
  values (v_prop, auth.uid(), 'room', p_room, 'unblocked');
end;
$$;

-- =====================================================================
-- PARTIAL CANCELLATION & NO-SHOW
-- =====================================================================

-- Drop one room from a multi-room booking without touching the rest.
create or replace function release_booking_room(p_allocation uuid, p_reason text default null)
returns bookings
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_alloc   room_allocations;
  v_booking bookings;
  v_left    int;
begin
  select * into v_alloc from room_allocations where id = p_allocation;
  if not found then raise exception 'allocation not found'; end if;
  if not can_manage(v_alloc.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_alloc.booking_id is null then raise exception 'not part of a booking'; end if;

  update room_allocations
     set released_at = now(), release_reason = coalesce(p_reason, 'إلغاء جزئي')
   where id = p_allocation;

  select count(*) into v_left from room_allocations
   where booking_id = v_alloc.booking_id and released_at is null;

  if v_left = 0 then
    -- Last room gone: the whole booking is cancelled.
    update bookings
       set status = 'cancelled', cancelled_at = now(),
           cancel_reason = coalesce(p_reason, 'كل الغرف اتلغت')
     where id = v_alloc.booking_id;
  else
    perform recalc_booking_total(v_alloc.booking_id);
  end if;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (v_alloc.property_id, auth.uid(), 'booking', v_alloc.booking_id, 'room_released',
          jsonb_build_object('room', v_alloc.room_id, 'reason', p_reason,
                             'rooms_left', v_left));

  select * into v_booking from bookings where id = v_alloc.booking_id;
  return v_booking;
end;
$$;

create or replace function mark_no_show(p_booking uuid, p_charge numeric default 0)
returns bookings
language plpgsql volatile security invoker set search_path = public as $$
declare v_booking bookings;
begin
  select * into v_booking from bookings where id = p_booking;
  if not found then raise exception 'booking not found'; end if;
  if not can_manage(v_booking.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  update bookings
     set status = 'no_show', total_amount = p_charge, cancelled_at = now()
   where id = p_booking returning * into v_booking;

  -- Free the rooms so tonight can still be sold.
  update room_allocations
     set released_at = now(), release_reason = 'عدم حضور'
   where booking_id = p_booking and released_at is null;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (v_booking.property_id, auth.uid(), 'booking', p_booking, 'no_show',
          jsonb_build_object('charge', p_charge));

  return v_booking;
end;
$$;

-- =====================================================================
-- THE ATTENTION QUEUE
-- The one list a manager checks. If it's empty, nothing is stranded.
-- =====================================================================
create or replace view attention_queue as
select
  b.property_id,
  b.id            as booking_id,
  b.reference,
  b.status,
  b.check_in,
  b.check_out,
  g.full_name     as guest_name,
  g.phone         as guest_phone,
  coalesce(
    b.attention_reason,
    case when not exists (
      select 1 from room_allocations a
      where a.booking_id = b.id and a.released_at is null
    ) then 'الحجز من غير غرفة' end
  ) as reason,
  (b.check_in <= current_date + 1) as urgent
from bookings b
join guests g on g.id = b.guest_id
where b.status in ('confirmed', 'checked_in')
  and b.check_out > current_date
  and (
    b.attention_reason is not null
    or not exists (
      select 1 from room_allocations a
      where a.booking_id = b.id and a.released_at is null
    )
  );

-- Rooms currently or soon out of service.
create or replace view blocked_rooms as
select
  a.property_id,
  r.id as room_id,
  r.number,
  a.starts_on,
  a.ends_on,
  a.kind,
  a.notes as reason
from room_allocations a
join rooms r on r.id = a.room_id
where a.kind in ('maintenance', 'hold', 'staff')
  and a.released_at is null
  and a.ends_on > current_date;
