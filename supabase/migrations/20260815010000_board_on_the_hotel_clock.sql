-- The board was running on the database's clock, not the hotel's.
--
-- today_board, attention_queue and blocked_rooms all asked for CURRENT_DATE,
-- which Postgres answers in UTC. Dahab is two hours ahead, so every night
-- between midnight and 2am the board showed the previous day: a guest who
-- checked in today had no allocation covering "today", so their room read as
-- available, arrivals for today were missing, and the departures count was
-- yesterday's.
--
-- This was not theoretical. At 23:37 UTC the database said 14 August while
-- the hotel was already on the 15th, and a booking of room 101 for the 15th
-- to the 18th made the whole board read empty.
--
-- Every other part of the system already uses the hotel's own clock —
-- check_out_booking takes (now() at time zone p.timezone)::date, and the app
-- computes today in Africa/Cairo — so the views were the odd ones out, and
-- they disagreed with the arrivals list sitting directly above them.
--
-- The timezone is per hotel rather than a constant, because it is a column on
-- the property and a second hotel may not be in the same one.

create or replace function public.property_today(p_property uuid)
returns date
language sql stable security invoker set search_path = public as $$
  select (now() at time zone p.timezone)::date
  from public.properties p where p.id = p_property;
$$;

comment on function public.property_today(uuid) is
  'Today, on the hotel''s clock. Never use current_date for anything a guest or a receptionist can see: the database answers that in UTC.';

revoke all on function public.property_today(uuid) from public, anon;
grant execute on function public.property_today(uuid) to authenticated;

drop view if exists public.today_board;
create view public.today_board as
select
  r.property_id,
  r.id            as room_id,
  r.number        as room_number,
  rt.name         as room_type,
  rt.name_en      as room_type_en,
  r.housekeeping_status,
  a.id            as allocation_id,
  a.occupancy,
  b.id            as booking_id,
  b.reference,
  b.status        as booking_status,
  g.full_name     as guest_name,
  g.phone         as guest_phone,
  a.starts_on,
  a.ends_on,
  (a.ends_on   = (now() at time zone p.timezone)::date) as departing_today,
  (a.starts_on = (now() at time zone p.timezone)::date) as arriving_today
from rooms r
join properties p on p.id = r.property_id
join room_types rt on rt.id = r.room_type_id
left join room_allocations a
  on a.room_id = r.id
 and a.released_at is null
 and a.stay @> (now() at time zone p.timezone)::date
left join bookings b on b.id = a.booking_id
left join guests g on g.id = b.guest_id
where r.is_active;

alter view public.today_board set (security_invoker = on);

drop view if exists public.attention_queue;
create view public.attention_queue as
select
  b.property_id,
  b.id        as booking_id,
  b.reference,
  b.status,
  b.check_in,
  b.check_out,
  g.full_name as guest_name,
  g.phone     as guest_phone,
  coalesce(b.attention_reason,
    case when not exists (
      select 1 from room_allocations a
       where a.booking_id = b.id and a.released_at is null
    ) then 'الحجز من غير غرفة' else null end) as reason,
  b.check_in <= (now() at time zone p.timezone)::date + 1 as urgent
from bookings b
join properties p on p.id = b.property_id
join guests g on g.id = b.guest_id
where b.status = any (array['confirmed'::booking_status, 'checked_in'::booking_status])
  and b.check_out > (now() at time zone p.timezone)::date
  and (b.attention_reason is not null or not exists (
    select 1 from room_allocations a
     where a.booking_id = b.id and a.released_at is null
  ));

alter view public.attention_queue set (security_invoker = on);

drop view if exists public.blocked_rooms;
create view public.blocked_rooms as
select
  a.property_id,
  r.id     as room_id,
  r.number,
  a.starts_on,
  a.ends_on,
  a.kind,
  a.notes  as reason
from room_allocations a
join rooms r on r.id = a.room_id
join properties p on p.id = a.property_id
where a.kind = any (array['maintenance'::allocation_kind, 'hold'::allocation_kind, 'staff'::allocation_kind])
  and a.released_at is null
  and a.ends_on > (now() at time zone p.timezone)::date;

alter view public.blocked_rooms set (security_invoker = on);

grant select on public.today_board, public.attention_queue, public.blocked_rooms to authenticated;
