\pset tuples_only on
\pset format unaligned

-- Changing the dates of a booking that already exists.
--
-- The behaviour this has to get right is the one reception was working
-- around by cancelling and rebooking: the same stay, moved, with every room
-- moving together and the bill following.

select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
set role authenticated;

-- Two nights in December, and a blocker sitting four days later.
do $$
begin
  perform create_booking(
    'aaaaaaaa-0000-0000-0000-000000000001',
    (select id from guests where property_id = 'aaaaaaaa-0000-0000-0000-000000000001' limit 1),
    '2026-12-01', '2026-12-03',
    '[{"room_id":"dddddddd-0000-0000-0000-000000000001","occupancy":2}]'::jsonb);
  perform block_room('dddddddd-0000-0000-0000-000000000001',
                     '2026-12-06', '2026-12-08', 'صيانة', 'maintenance');
end $$;

select 'before · nights (want 2)                  = ' || (check_out - check_in)
from bookings order by created_at desc limit 1;
select 'before · total (want 800.00)              = ' || total_amount
from bookings order by created_at desc limit 1;

-- Lengthening: the guest asks for two more nights at the desk. No password.
select 'extend · nights (want 4)                  = ' || (check_out - check_in)
from set_stay_dates((select id from bookings order by created_at desc limit 1),
                    '2026-12-01', '2026-12-05');
select 'extend · total follows (want 1600.00)     = ' || total_amount
from bookings order by created_at desc limit 1;
select 'extend · nights repriced (want 4)         = ' || count(*)
from allocation_nights an join room_allocations a on a.id = an.allocation_id
where a.booking_id = (select id from bookings order by created_at desc limit 1);

-- Moving the whole stay later, arrival and departure together. This is the
-- shape that had no path at all before: same length, different days.
select 'moved · check_in (want 2026-12-02)        = ' || check_in
from set_stay_dates((select id from bookings order by created_at desc limit 1),
                    '2026-12-02', '2026-12-06');

-- Onto the maintenance block: refused, and the room named.
do $$
begin
  perform set_stay_dates((select id from bookings order by created_at desc limit 1),
                         '2026-12-02', '2026-12-09');
  raise notice 'onto a blocked room (want refused)        = accepted';
exception when others then
  raise notice 'onto a blocked room (want refused)        = refused';
end $$;
select 'refused · stay unmoved (want 2026-12-06)  = ' || check_out
from bookings order by created_at desc limit 1;

-- Nonsense is refused rather than stored.
do $$
begin
  perform set_stay_dates((select id from bookings order by created_at desc limit 1),
                         '2026-12-06', '2026-12-02');
  raise notice 'checkout before checkin (want refused)    = accepted';
exception when others then
  raise notice 'checkout before checkin (want refused)    = refused';
end $$;

-- Shortening takes money off the bill, so it wants the manager password —
-- the same rule shorten_stay has always had.
select set_action_pin('aaaaaaaa-0000-0000-0000-000000000001', '739210');
do $$
begin
  perform set_stay_dates((select id from bookings order by created_at desc limit 1),
                         '2026-12-02', '2026-12-04', null);
  raise notice 'shorten without password (want refused)   = accepted';
exception when others then
  raise notice 'shorten without password (want refused)   = refused';
end $$;
select 'shorten · with password (want 2026-12-04) = ' || check_out
from set_stay_dates((select id from bookings order by created_at desc limit 1),
                    '2026-12-02', '2026-12-04', '739210');
select 'shorten · total follows (want 800.00)     = ' || total_amount
from bookings order by created_at desc limit 1;

-- A guest already in the room did not arrive on a different day.
update bookings set status = 'checked_in'
 where id = (select id from bookings order by created_at desc limit 1);
do $$
begin
  perform set_stay_dates((select id from bookings order by created_at desc limit 1),
                         '2026-12-03', '2026-12-06');
  raise notice 'moving a resident guest (want refused)    = accepted';
exception when others then
  raise notice 'moving a resident guest (want refused)    = refused';
end $$;
-- ...but they can still stay longer, up to the maintenance block.
select 'resident · may extend (want 2026-12-05)   = ' || check_out
from set_stay_dates((select id from bookings order by created_at desc limit 1),
                    '2026-12-02', '2026-12-05', '739210');

-- Every move is in the log with both dates on it — the four that were
-- allowed above, and none of the ones that were refused.
select 'log · every move recorded (want 4)        = ' || count(*)
from activity_log where action = 'dates_changed'
  and payload ? 'from_check_in' and payload ? 'to_check_out';
reset role;

-- And the hotel next door cannot move it.
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
set role authenticated;
do $$
begin
  perform set_stay_dates((select id from bookings where property_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                          order by created_at desc limit 1), '2026-12-02', '2026-12-04');
  raise notice 'hotel B moving A''s stay (want denied)     = allowed';
exception when others then
  raise notice 'hotel B moving A''s stay (want denied)     = denied';
end $$;
reset role;
