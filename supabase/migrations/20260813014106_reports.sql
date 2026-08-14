-- Reporting.
--
-- Revenue is recognised per night, not per booking. A five-night stay
-- crossing the end of a month belongs partly to each month; counting the
-- whole total in whichever month it was booked would make every report
-- wrong at the edges.

-- Headline numbers for a period.
create or replace function report_summary(
  p_property uuid, p_from date, p_to date
)
returns table (
  nights_sold      bigint,
  nights_available bigint,
  occupancy_pct    numeric,
  room_revenue     numeric,
  adr              numeric,   -- average daily rate: revenue per night sold
  revpar           numeric,   -- revenue per available room-night
  bookings_made    bigint,
  guests_hosted    bigint,
  cancellations    bigint,
  no_shows         bigint,
  collected        numeric,
  outstanding      numeric
)
language sql stable security invoker set search_path = public as $$
  with days as (
    select count(*)::numeric as n from generate_series(p_from, p_to - 1, interval '1 day')
  ),
  active_rooms as (
    select count(*)::numeric as n from rooms
    where property_id = p_property and is_active
  ),
  sold as (
    select
      count(*)::bigint as nights,
      coalesce(sum(a.rate_per_night), 0) as revenue,
      count(distinct a.booking_id)::bigint as bookings,
      coalesce(sum(a.occupancy), 0)::bigint as guest_nights
    from room_allocations a
    join bookings b on b.id = a.booking_id
    cross join lateral generate_series(a.starts_on, a.ends_on - 1, interval '1 day') d
    where a.property_id = p_property
      and a.released_at is null
      and a.kind = 'booking'
      and b.status in ('confirmed', 'checked_in', 'checked_out')
      and d::date >= p_from and d::date < p_to
  ),
  made as (
    select
      count(*) filter (where status = 'cancelled')::bigint as cancelled,
      count(*) filter (where status = 'no_show')::bigint   as no_show
    from bookings
    where property_id = p_property
      and check_in >= p_from and check_in < p_to
  ),
  money as (
    select coalesce(sum(amount), 0) as paid
    from payments
    where property_id = p_property
      and received_at >= p_from and received_at < p_to + 1
  ),
  owing as (
    select coalesce(sum(total_amount - paid_amount), 0) as owed
    from bookings
    where property_id = p_property
      and status in ('confirmed', 'checked_in', 'checked_out')
      and total_amount > paid_amount
      and check_in >= p_from and check_in < p_to
  )
  select
    sold.nights,
    (days.n * active_rooms.n)::bigint,
    case when days.n * active_rooms.n > 0
      then round(100.0 * sold.nights / (days.n * active_rooms.n), 1) else 0 end,
    round(sold.revenue, 2),
    case when sold.nights > 0 then round(sold.revenue / sold.nights, 2) else 0 end,
    case when days.n * active_rooms.n > 0
      then round(sold.revenue / (days.n * active_rooms.n), 2) else 0 end,
    sold.bookings,
    sold.guest_nights,
    made.cancelled,
    made.no_show,
    round(money.paid, 2),
    round(owing.owed, 2)
  from days, active_rooms, sold, made, money, owing;
$$;

-- Night by night, for the chart.
create or replace function report_daily(
  p_property uuid, p_from date, p_to date
)
returns table (day date, rooms_sold bigint, revenue numeric, occupancy_pct numeric)
language sql stable security invoker set search_path = public as $$
  with active_rooms as (
    select count(*)::numeric as n from rooms where property_id = p_property and is_active
  ),
  cal as (
    select d::date as day from generate_series(p_from, p_to - 1, interval '1 day') d
  )
  select
    cal.day,
    count(a.id)::bigint,
    round(coalesce(sum(a.rate_per_night), 0), 2),
    case when active_rooms.n > 0
      then round(100.0 * count(a.id) / active_rooms.n, 1) else 0 end
  from cal
  cross join active_rooms
  left join room_allocations a
    on a.property_id = p_property
   and a.released_at is null
   and a.kind = 'booking'
   and a.stay @> cal.day
  left join bookings b on b.id = a.booking_id
   and b.status in ('confirmed', 'checked_in', 'checked_out')
  group by cal.day, active_rooms.n
  order by cal.day;
$$;

-- Where the business came from. Worth watching when bookings are taken
-- by hand: it shows which channel is actually feeding the hotel.
create or replace function report_by_source(
  p_property uuid, p_from date, p_to date
)
returns table (source text, bookings bigint, nights bigint, revenue numeric)
language sql stable security invoker set search_path = public as $$
  select
    b.source::text,
    count(distinct b.id)::bigint,
    count(a.id)::bigint,
    round(coalesce(sum(a.rate_per_night * (a.ends_on - a.starts_on)), 0), 2)
  from bookings b
  join room_allocations a on a.booking_id = b.id and a.released_at is null
  where b.property_id = p_property
    and b.status in ('confirmed', 'checked_in', 'checked_out')
    and b.check_in >= p_from and b.check_in < p_to
  group by b.source
  order by 4 desc;
$$;

-- Who still owes money.
create or replace function report_outstanding(p_property uuid)
returns table (
  booking_id uuid, reference text, guest_name text, guest_phone text,
  check_in date, check_out date, status text, total numeric, paid numeric, owed numeric
)
language sql stable security invoker set search_path = public as $$
  select b.id, b.reference, g.full_name, g.phone, b.check_in, b.check_out,
         b.status::text, b.total_amount, b.paid_amount,
         (b.total_amount - b.paid_amount)
  from bookings b
  join guests g on g.id = b.guest_id
  where b.property_id = p_property
    and b.status in ('confirmed', 'checked_in', 'checked_out')
    and b.total_amount > b.paid_amount
  order by b.check_out;
$$;

-- A cancellation log. With a PIN now guarding the action, this is the
-- record that makes the guard meaningful.
create or replace function report_cancellations(
  p_property uuid, p_from date, p_to date
)
returns table (
  reference text, guest_name text, status text, check_in date,
  amount numeric, reason text, cancelled_at timestamptz, cancelled_by text
)
language sql stable security invoker set search_path = public as $$
  select b.reference, g.full_name, b.status::text, b.check_in,
         b.total_amount, b.cancel_reason, b.cancelled_at,
         coalesce(p.full_name, '—')
  from bookings b
  join guests g on g.id = b.guest_id
  left join lateral (
    select l.actor_id from activity_log l
    where l.entity_id = b.id and l.action in ('cancelled', 'no_show')
    order by l.created_at desc limit 1
  ) act on true
  left join profiles p on p.id = act.actor_id
  where b.property_id = p_property
    and b.status in ('cancelled', 'no_show')
    and b.cancelled_at >= p_from and b.cancelled_at < p_to + 1
  order by b.cancelled_at desc;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'report_summary(uuid,date,date)', 'report_daily(uuid,date,date)',
    'report_by_source(uuid,date,date)', 'report_outstanding(uuid)',
    'report_cancellations(uuid,date,date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
