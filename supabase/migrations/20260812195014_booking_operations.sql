create or replace function available_rooms(
  p_property uuid, p_check_in date, p_check_out date, p_room_type uuid default null
)
returns table (
  room_id uuid, room_number text, room_type_id uuid,
  type_name text, base_rate numeric, housekeeping housekeeping_status
)
language sql stable security invoker set search_path = public as $$
  select r.id, r.number, rt.id, rt.name, rt.base_rate, r.housekeeping_status
  from rooms r
  join room_types rt on rt.id = r.room_type_id
  where r.property_id = p_property
    and r.is_active
    and r.housekeeping_status <> 'out_of_order'
    and (p_room_type is null or r.room_type_id = p_room_type)
    and not exists (
      select 1 from room_allocations a
      where a.room_id = r.id
        and a.released_at is null
        and a.stay && daterange(p_check_in, p_check_out, '[)')
    )
  order by rt.sort_order, r.number;
$$;

create sequence if not exists booking_ref_seq;

create or replace function next_booking_reference(p_property uuid)
returns text
language plpgsql volatile security definer set search_path = public as $$
declare v_prefix text;
begin
  select coalesce(upper(substring(regexp_replace(slug, '[^a-zA-Z]', '', 'g') from 1 for 2)), 'BK')
    into v_prefix from properties where id = p_property;
  return v_prefix || to_char(now(), 'YY') || '-' || lpad(nextval('booking_ref_seq')::text, 4, '0');
end;
$$;

create or replace function check_in_booking(p_booking uuid)
returns bookings
language plpgsql volatile security invoker set search_path = public as $$
declare v_booking bookings;
begin
  select * into v_booking from bookings where id = p_booking;
  if not found then raise exception 'booking not found'; end if;
  if not can_manage(v_booking.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'cannot check in a booking with status %', v_booking.status;
  end if;

  update bookings set status = 'checked_in' where id = p_booking returning * into v_booking;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action)
  values (v_booking.property_id, auth.uid(), 'booking', p_booking, 'checked_in');

  return v_booking;
end;
$$;

-- Check-out is the join between the booking side and housekeeping:
-- closes the stay, frees the room, marks it dirty, queues the clean.
create or replace function check_out_booking(p_booking uuid)
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

  update bookings set status = 'checked_out' where id = p_booking returning * into v_booking;

  for v_room in
    select room_id from room_allocations where booking_id = p_booking and released_at is null
  loop
    update room_allocations
       set ends_on = greatest(starts_on + 1, current_date)
     where booking_id = p_booking and room_id = v_room
       and ends_on > current_date and released_at is null;

    update rooms set housekeeping_status = 'dirty' where id = v_room;

    insert into housekeeping_tasks (
      property_id, room_id, booking_id, task_type, status, scheduled_for, priority
    ) values (
      v_booking.property_id, v_room, p_booking, 'checkout_clean', 'pending', current_date, 10
    );
  end loop;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action)
  values (v_booking.property_id, auth.uid(), 'booking', p_booking, 'checked_out');

  return v_booking;
end;
$$;

create or replace function cancel_booking(p_booking uuid, p_reason text default null)
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
     set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
   where id = p_booking returning * into v_booking;

  -- Released, not deleted: the history stays for reporting.
  update room_allocations set released_at = now()
   where booking_id = p_booking and released_at is null;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (v_booking.property_id, auth.uid(), 'booking', p_booking, 'cancelled',
          jsonb_build_object('reason', p_reason));

  return v_booking;
end;
$$;

create or replace view today_board as
select
  r.property_id,
  r.id as room_id,
  r.number as room_number,
  rt.name as room_type,
  r.housekeeping_status,
  b.id as booking_id,
  b.reference,
  b.status as booking_status,
  g.full_name as guest_name,
  g.phone as guest_phone,
  a.starts_on,
  a.ends_on,
  (a.ends_on = current_date)   as departing_today,
  (a.starts_on = current_date) as arriving_today
from rooms r
join room_types rt on rt.id = r.room_type_id
left join room_allocations a
  on a.room_id = r.id and a.released_at is null and a.stay @> current_date
left join bookings b on b.id = a.booking_id
left join guests g on g.id = b.guest_id
where r.is_active;
