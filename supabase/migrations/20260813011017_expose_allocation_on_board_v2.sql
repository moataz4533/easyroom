drop view if exists today_board;

-- The board needs the allocation id to move a guest: a move acts on the
-- specific room-nights, not on the booking as a whole (a group in three
-- rooms might only move one of them).
create view today_board as
select
  r.property_id,
  r.id            as room_id,
  r.number        as room_number,
  rt.name         as room_type,
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
  (a.ends_on = current_date)   as departing_today,
  (a.starts_on = current_date) as arriving_today
from rooms r
join room_types rt on rt.id = r.room_type_id
left join room_allocations a
  on a.room_id = r.id and a.released_at is null and a.stay @> current_date
left join bookings b on b.id = a.booking_id
left join guests g on g.id = b.guest_id
where r.is_active;

alter view today_board set (security_invoker = on);
