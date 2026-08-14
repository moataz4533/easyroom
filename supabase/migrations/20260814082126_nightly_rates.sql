-- What each night of a stay actually cost.
--
-- create_booking stores rate_per_night as the line total divided by the
-- number of nights — the average across the stay. While every night cost the
-- same that was exact. Seasonal pricing broke it: a stay that crosses a
-- season boundary is charged correctly in total, but the reports spread that
-- total evenly across the days. The money is right; its placement in time is
-- not, and that is the whole point of recognising revenue per night rather
-- than per booking.
--
-- So the nights are stored. One row per allocation per night, written from
-- the same resolve_rate the quote uses.

create table if not exists public.allocation_nights (
  allocation_id uuid not null references public.room_allocations(id) on delete cascade,
  property_id   uuid not null references public.properties(id) on delete cascade,
  booking_id    uuid references public.bookings(id) on delete cascade,
  night         date not null,
  amount        numeric(12,2) not null default 0,
  primary key (allocation_id, night),
  check (amount >= 0)
);

-- Reports scan by property and date; the primary key covers the per-allocation
-- rewrite.
create index if not exists allocation_nights_property_night_idx
  on public.allocation_nights (property_id, night);
create index if not exists allocation_nights_booking_idx
  on public.allocation_nights (booking_id);

alter table public.allocation_nights enable row level security;

-- Read like the allocations themselves. Nothing writes directly: the rows are
-- derived, and a hand-written night would disagree with the booking total.
drop policy if exists allocation_nights_select on public.allocation_nights;
create policy allocation_nights_select on public.allocation_nights
  for select to authenticated using (public.can_manage(property_id));

-- ---------------------------------------------------------------------
-- Writing the nights for one allocation.
-- ---------------------------------------------------------------------
create or replace function public.write_allocation_nights(p_allocation uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_allocation room_allocations;
  v_type uuid;
  v_plan uuid;
begin
  select * into v_allocation from room_allocations where id = p_allocation;
  if not found then return; end if;

  -- Rewritten wholesale rather than patched, so a shortened stay loses the
  -- nights it no longer occupies instead of keeping stale ones.
  delete from allocation_nights where allocation_id = p_allocation;

  -- Maintenance and holds have no price; they block a room, they do not sell it.
  if v_allocation.kind <> 'booking' then return; end if;

  select r.room_type_id into v_type from rooms r where r.id = v_allocation.room_id;
  select b.rate_plan_id into v_plan from bookings b where b.id = v_allocation.booking_id;

  insert into allocation_nights (allocation_id, property_id, booking_id, night, amount)
  select p_allocation, v_allocation.property_id, v_allocation.booking_id, d::date,
         resolve_rate(v_allocation.property_id, v_type, v_plan, v_allocation.occupancy, d::date)
  from generate_series(v_allocation.starts_on, v_allocation.ends_on - 1, interval '1 day') d;
end;
$$;

revoke all on function public.write_allocation_nights(uuid) from public, anon, authenticated;

-- A trigger, not a call inside recalc_booking_total. check_out_booking
-- shortens a stay and releases it without going through recalc, and so does
-- the self-healing branch for a replayed check-out. Hanging this off the
-- allocation itself means no path can change a stay's dates and leave its
-- nights behind.
create or replace function public.sync_allocation_nights()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform write_allocation_nights(new.id);
  return new;
end;
$$;

revoke all on function public.sync_allocation_nights() from public, anon, authenticated;

drop trigger if exists trg_allocation_nights on public.room_allocations;
create trigger trg_allocation_nights
  after insert or update of starts_on, ends_on, occupancy, room_id
  on public.room_allocations
  for each row execute function public.sync_allocation_nights();

-- ---------------------------------------------------------------------
-- Reports read the nights.
--
-- Which allocations count is unchanged and still decided here: released rows
-- are excluded unless the booking was completed, so operational release on
-- check-out never erases earned nights while a cancellation still does.
-- ---------------------------------------------------------------------
drop function if exists public.report_summary(uuid, date, date);
create function public.report_summary(
  p_property uuid, p_from date, p_to date
)
returns table (
  nights_sold      bigint,
  nights_available bigint,
  occupancy_pct    numeric,
  room_revenue     numeric,
  adr              numeric,
  revpar           numeric,
  bookings_made    bigint,
  guests_hosted    bigint,
  cancellations    bigint,
  no_shows         bigint,
  collected        numeric,
  outstanding      numeric,
  extras_revenue   numeric,
  total_revenue    numeric
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
      coalesce(sum(an.amount), 0) as revenue,
      count(distinct an.booking_id)::bigint as bookings,
      coalesce(sum(a.occupancy), 0)::bigint as guest_nights
    from allocation_nights an
    join room_allocations a on a.id = an.allocation_id
    join bookings b on b.id = an.booking_id
    where an.property_id = p_property
      and a.kind = 'booking'
      and b.status in ('confirmed', 'checked_in', 'checked_out')
      and (a.released_at is null or b.status = 'checked_out')
      and an.night >= p_from and an.night < p_to
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
  ),
  -- Counted on the day it was sold, not spread over the stay: a breakfast
  -- is consumed once.
  extras as (
    select coalesce(sum(c.amount), 0) as revenue
    from booking_charges c
    join bookings b on b.id = c.booking_id
    where c.property_id = p_property
      and c.voided_at is null
      and b.status in ('confirmed', 'checked_in', 'checked_out')
      and c.created_at >= p_from and c.created_at < p_to + 1
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
    round(owing.owed, 2),
    round(extras.revenue, 2),
    round(sold.revenue + extras.revenue, 2)
  from days, active_rooms, sold, made, money, owing, extras;
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
  ), nights as (
    select an.night, an.amount
    from allocation_nights an
    join room_allocations a on a.id = an.allocation_id
    join bookings b on b.id = an.booking_id
    where an.property_id = p_property
      and a.kind = 'booking'
      and b.status in ('confirmed', 'checked_in', 'checked_out')
      and (a.released_at is null or b.status = 'checked_out')
  )
  select cal.day,
         count(nights.night)::bigint,
         round(coalesce(sum(nights.amount), 0), 2),
         case when active_rooms.n > 0
           then round(100.0 * count(nights.night) / active_rooms.n, 1) else 0 end
  from cal
  cross join active_rooms
  left join nights on nights.night = cal.day
  group by cal.day, active_rooms.n
  order by cal.day;
$$;

-- Revenue by source is the whole stay of every booking that arrived in the
-- period, so it sums an allocation's nights rather than a rate times a count.
create or replace function public.report_by_source(
  p_property uuid, p_from date, p_to date
)
returns table (source text, bookings bigint, nights bigint, revenue numeric)
language sql stable security invoker set search_path = public as $$
  select b.source::text,
         count(distinct b.id)::bigint,
         count(an.night)::bigint,
         round(coalesce(sum(an.amount), 0), 2)
  from bookings b
  join room_allocations a on a.booking_id = b.id
  join allocation_nights an on an.allocation_id = a.id
  where b.property_id = p_property
    and b.status in ('confirmed', 'checked_in', 'checked_out')
    and (a.released_at is null or b.status = 'checked_out')
    and b.check_in >= p_from and b.check_in < p_to
  group by b.source
  order by 4 desc;
$$;

revoke all on function public.report_summary(uuid, date, date)   from public, anon;
revoke all on function public.report_daily(uuid, date, date)     from public, anon;
revoke all on function public.report_by_source(uuid, date, date) from public, anon;
grant execute on function public.report_summary(uuid, date, date)   to authenticated;
grant execute on function public.report_daily(uuid, date, date)     to authenticated;
grant execute on function public.report_by_source(uuid, date, date) to authenticated;

comment on column public.room_allocations.rate_per_night is
  'The stay average, kept for reference. Reports read allocation_nights instead,
   because a stay crossing a season boundary does not cost the same every night.';

-- ---------------------------------------------------------------------
-- Existing stays.
--
-- Their true per-night split cannot be recovered, and re-deriving it from
-- today''s rates would silently rewrite past reports. Seeding the stored
-- average keeps every current number exactly as it is; only stays booked
-- from now on get the real nightly figures.
-- ---------------------------------------------------------------------
insert into public.allocation_nights (allocation_id, property_id, booking_id, night, amount)
select a.id, a.property_id, a.booking_id, d::date, coalesce(a.rate_per_night, 0)
from public.room_allocations a
cross join lateral generate_series(a.starts_on, a.ends_on - 1, interval '1 day') d
where a.kind = 'booking'
on conflict (allocation_id, night) do nothing;
