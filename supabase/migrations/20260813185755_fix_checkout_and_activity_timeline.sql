-- Check-in/check-out must be state transitions, not repeatable commands.
-- The original check-out shortened the stay but left same-day allocations
-- active, so the dashboard kept showing a checked-out guest as occupying the
-- room. Repeated clicks also created duplicate cleaning tasks and log rows.

create or replace function public.check_in_booking(p_booking uuid)
returns public.bookings
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_rooms text[];
begin
  select * into v_booking
  from public.bookings
  where id = p_booking
  for update;

  if not found then raise exception 'booking not found'; end if;
  if not public.can_manage(v_booking.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- Safe for an offline replay or a double click.
  if v_booking.status = 'checked_in' then return v_booking; end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'لا يمكن تسكين حجز حالته %', v_booking.status;
  end if;

  update public.bookings
     set status = 'checked_in', updated_at = now()
   where id = p_booking
  returning * into v_booking;

  select array_agg(r.number order by r.number) into v_rooms
  from public.room_allocations a
  join public.rooms r on r.id = a.room_id
  where a.booking_id = p_booking and a.released_at is null;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, payload
  ) values (
    v_booking.property_id, auth.uid(), 'booking', p_booking, 'checked_in',
    jsonb_build_object('reference', v_booking.reference, 'rooms', coalesce(v_rooms, array[]::text[]))
  );

  return v_booking;
end;
$$;

create or replace function public.check_out_booking(p_booking uuid)
returns public.bookings
language plpgsql
volatile
security invoker
set search_path = public
as $$
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
     where id = p_booking
    returning * into v_booking;
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
   where id = p_booking
  returning * into v_booking;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, payload
  ) values (
    v_booking.property_id, auth.uid(), 'booking', p_booking, 'checked_out',
    jsonb_build_object(
      'reference', v_booking.reference,
      'rooms', v_rooms,
      'actual_check_out', v_actual_check_out
    )
  );

  return v_booking;
end;
$$;

revoke all on function public.check_in_booking(uuid) from public, anon;
revoke all on function public.check_out_booking(uuid) from public, anon;
grant execute on function public.check_in_booking(uuid) to authenticated;
grant execute on function public.check_out_booking(uuid) to authenticated;

-- A narrow, manager-only timeline API. It enriches the immutable activity
-- rows with safe display fields while keeping guests, staff and financial
-- tables inaccessible to housekeeping users.
create or replace function public.list_activity_timeline(
  p_property uuid,
  p_limit integer default 200
)
returns table (
  id bigint,
  created_at timestamptz,
  action text,
  entity_type text,
  entity_id uuid,
  actor_name text,
  actor_role text,
  reference text,
  guest_name text,
  room_numbers text[],
  payload jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin(p_property) then
    raise exception 'manager access required' using errcode = '42501';
  end if;

  return query
  with enriched as (
    select
      l.*,
      case
        when l.entity_type = 'booking' then l.entity_id
        when l.entity_type = 'payment' and coalesce(l.payload ->> 'booking', '')
          ~ '^[0-9a-fA-F-]{36}$'
          then (l.payload ->> 'booking')::uuid
        else null
      end as booking_id
    from public.activity_log l
    where l.property_id = p_property
      and not (
        l.action = 'checked_out'
        and exists (
          select 1 from public.activity_log prior
          where prior.property_id = l.property_id
            and prior.entity_id = l.entity_id
            and prior.action = l.action
            and prior.id < l.id
        )
      )
  )
  select
    e.id,
    e.created_at,
    e.action,
    e.entity_type,
    e.entity_id,
    coalesce(nullif(p.full_name, ''), '—') as actor_name,
    pm.role::text as actor_role,
    coalesce(b.reference, e.payload ->> 'reference') as reference,
    g.full_name as guest_name,
    case
      when e.entity_type = 'room' then array_remove(array[r.number], null)
      else coalesce(rooms.numbers, array[]::text[])
    end as room_numbers,
    e.payload
  from enriched e
  left join public.profiles p on p.id = e.actor_id
  left join public.property_members pm
    on pm.property_id = e.property_id and pm.user_id = e.actor_id
  left join public.bookings b on b.id = e.booking_id
  left join public.guests g on g.id = b.guest_id
  left join public.rooms r
    on e.entity_type = 'room' and r.id = e.entity_id
  left join lateral (
    select array_agg(distinct rr.number order by rr.number) as numbers
    from public.room_allocations ra
    join public.rooms rr on rr.id = ra.room_id
    where ra.booking_id = e.booking_id
  ) rooms on true
  order by e.created_at desc, e.id desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

revoke all on function public.list_activity_timeline(uuid, integer) from public, anon;
grant execute on function public.list_activity_timeline(uuid, integer) to authenticated;

-- Released allocations from cancellations remain excluded. Released rows are
-- included only for completed stays so operational release never erases
-- earned nights from reports.
create or replace function public.report_summary(
  p_property uuid, p_from date, p_to date
)
returns table (
  nights_sold bigint, nights_available bigint, occupancy_pct numeric,
  room_revenue numeric, adr numeric, revpar numeric, bookings_made bigint,
  guests_hosted bigint, cancellations bigint, no_shows bigint,
  collected numeric, outstanding numeric
)
language sql stable security invoker set search_path = public as $$
  with days as (
    select count(*)::numeric as n from generate_series(p_from, p_to - 1, interval '1 day')
  ), active_rooms as (
    select count(*)::numeric as n from rooms where property_id = p_property and is_active
  ), sold as (
    select count(*)::bigint as nights,
           coalesce(sum(a.rate_per_night), 0) as revenue,
           count(distinct a.booking_id)::bigint as bookings,
           coalesce(sum(a.occupancy), 0)::bigint as guest_nights
    from room_allocations a
    join bookings b on b.id = a.booking_id
    cross join lateral generate_series(a.starts_on, a.ends_on - 1, interval '1 day') d
    where a.property_id = p_property and a.kind = 'booking'
      and b.status in ('confirmed', 'checked_in', 'checked_out')
      and (a.released_at is null or b.status = 'checked_out')
      and d::date >= p_from and d::date < p_to
  ), made as (
    select count(*) filter (where status = 'cancelled')::bigint as cancelled,
           count(*) filter (where status = 'no_show')::bigint as no_show
    from bookings where property_id = p_property and check_in >= p_from and check_in < p_to
  ), money as (
    select coalesce(sum(amount), 0) as paid from payments
    where property_id = p_property and received_at >= p_from and received_at < p_to + 1
  ), owing as (
    select coalesce(sum(total_amount - paid_amount), 0) as owed from bookings
    where property_id = p_property
      and status in ('confirmed', 'checked_in', 'checked_out')
      and total_amount > paid_amount and check_in >= p_from and check_in < p_to
  )
  select sold.nights, (days.n * active_rooms.n)::bigint,
    case when days.n * active_rooms.n > 0 then round(100.0 * sold.nights / (days.n * active_rooms.n), 1) else 0 end,
    round(sold.revenue, 2),
    case when sold.nights > 0 then round(sold.revenue / sold.nights, 2) else 0 end,
    case when days.n * active_rooms.n > 0 then round(sold.revenue / (days.n * active_rooms.n), 2) else 0 end,
    sold.bookings, sold.guest_nights, made.cancelled, made.no_show,
    round(money.paid, 2), round(owing.owed, 2)
  from days, active_rooms, sold, made, money, owing;
$$;

create or replace function public.report_daily(
  p_property uuid, p_from date, p_to date
)
returns table (day date, rooms_sold bigint, revenue numeric, occupancy_pct numeric)
language sql stable security invoker set search_path = public as $$
  with active_rooms as (
    select count(*)::numeric as n from rooms where property_id = p_property and is_active
  ), cal as (
    select d::date as day from generate_series(p_from, p_to - 1, interval '1 day') d
  )
  select cal.day, count(a.id)::bigint, round(coalesce(sum(a.rate_per_night), 0), 2),
    case when active_rooms.n > 0 then round(100.0 * count(a.id) / active_rooms.n, 1) else 0 end
  from cal cross join active_rooms
  left join room_allocations a
    on a.property_id = p_property and a.kind = 'booking' and a.stay @> cal.day
   and exists (
     select 1 from bookings b
     where b.id = a.booking_id
       and b.status in ('confirmed', 'checked_in', 'checked_out')
       and (a.released_at is null or b.status = 'checked_out')
   )
  group by cal.day, active_rooms.n order by cal.day;
$$;

create or replace function public.report_by_source(
  p_property uuid, p_from date, p_to date
)
returns table (source text, bookings bigint, nights bigint, revenue numeric)
language sql stable security invoker set search_path = public as $$
  select b.source::text, count(distinct b.id)::bigint,
         sum(a.ends_on - a.starts_on)::bigint,
         round(coalesce(sum(a.rate_per_night * (a.ends_on - a.starts_on)), 0), 2)
  from bookings b join room_allocations a on a.booking_id = b.id
  where b.property_id = p_property
    and b.status in ('confirmed', 'checked_in', 'checked_out')
    and (a.released_at is null or b.status = 'checked_out')
    and b.check_in >= p_from and b.check_in < p_to
  group by b.source order by 4 desc;
$$;
