-- Measured on three years of traffic, not guessed at.
--
-- A database seeded with 12,368 stays and 43,056 room-nights across a 6-room
-- and a 40-room hotel, queried as a real authenticated user, gave:
--
--   the daily report, one month .............. 7,373 ms
--   the daily report, one year ............... 6,984 ms
--   the attention banner on the dashboard .... 2,057 ms
--   the bookings list, newest 50 ..............  840 ms
--   the room board ............................  115 ms
--
-- Three separate causes, none of them visible at two test bookings.
--
-- 1. report_daily read every night the hotel had ever sold and threw away
--    everything outside the window afterwards. That is why a month cost the
--    same as a year: the window was never in the query. It now asks the
--    database for the nights it is going to use.
--
-- 2. Every policy said can_manage(property_id), which is a function call per
--    row. On a screen touching twelve thousand guests that is twelve thousand
--    calls before a single row is returned. The same rule written as a set
--    the planner can hash is evaluated once. The rule itself is unchanged —
--    the same three roles, the same hotels — so nothing about who can see
--    what moves.
--
-- 3. The bookings list sorted newest-first with nothing to sort on, so it
--    read ten thousand rows to show fifty.

-- The hotels this account may run, as a set rather than a question asked
-- once per row. Same three roles can_manage has always meant; housekeeping
-- is deliberately not among them.
create or replace function public.manageable_property_ids()
returns setof uuid
language sql stable security definer set search_path = public, auth as $$
  select property_id from public.property_members
   where user_id = auth.uid()
     and is_active
     and role in ('owner', 'manager', 'reception');
$$;

comment on function public.manageable_property_ids() is
  'The hotels this account can work in. Use `property_id in (select manageable_property_ids())` in a policy rather than can_manage(property_id): the first is evaluated once, the second once per row.';

revoke all on function public.manageable_property_ids() from public, anon;
grant execute on function public.manageable_property_ids() to authenticated;

do $$
declare
  r record;
  v_mine constant text := 'property_id in (select public.manageable_property_ids())';
begin
  for r in
    select tablename, policyname, cmd,
           qual is not null as has_using,
           with_check is not null as has_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%can_manage%'
  loop
    execute format('alter policy %I on public.%I%s%s',
      r.policyname, r.tablename,
      case when r.has_using then format(' using (%s)', v_mine) else '' end,
      case when r.has_check then format(' with check (%s)', v_mine) else '' end);
  end loop;
end $$;

-- The bookings screen opens on the newest first, every time.
create index if not exists bookings_property_created_idx
  on public.bookings (property_id, created_at desc);

-- Guests are listed by when they last stayed, and looked up by phone while
-- somebody is on it.
create index if not exists guests_property_created_idx
  on public.guests (property_id, created_at desc);

-- The window the daily report actually asks about. Without this the CTE read
-- every night the hotel had ever sold.
create or replace function public.report_daily(p_property uuid, p_from date, p_to date)
returns table(day date, rooms_sold bigint, revenue numeric, occupancy_pct numeric)
language sql stable set search_path = public as $$
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
      and an.night >= p_from and an.night < p_to
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

revoke all on function public.report_daily(uuid, date, date) from public, anon;
grant execute on function public.report_daily(uuid, date, date) to authenticated;
