\pset tuples_only on
\pset format unaligned

-- A stay that crosses a season boundary, then a discount on it. The point of
-- the fixture is that every number below has to stay per-night: the season
-- boundary and the month boundary both fall inside the stay.
--
--   30, 31 Aug at 700 (season)      1, 2 Sep at 400 (standing)
--   list 2200 · 10% off · net 1980 · given away 220

-- Every hotel is born able to take a booking. Hotel B is given nothing by
-- any suite, so its plan can only have come from the trigger on `properties`
-- — and there is exactly one, because `one_default_rate_plan` allows one.
select 'hotel B · default plan on opening (want 1) = ' || count(*)
from rate_plans where property_id = 'bbbbbbbb-0000-0000-0000-000000000002' and is_default;

insert into room_types (id, property_id, code, name, base_rate, max_occupancy) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'STD', 'Standard', 400, 3)
on conflict do nothing;

insert into rooms (id, property_id, room_type_id, number, is_active) values
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', '101', true)
on conflict do nothing;

-- The plan is hotel A's default, created by the trigger on `properties` and
-- adopted under this id in seed.sql. Inserting a second default here would
-- be refused by `one_default_rate_plan`, which is the point of that index.

-- The standing price, and a season sitting on top of it.
insert into rates (property_id, room_type_id, rate_plan_id, occupancy, amount, valid_from, valid_to) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000001', 2, 400, null, null),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000001', 2, 700, '2026-08-25', '2026-08-31')
on conflict do nothing;

select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
set role authenticated;

-- Booked at list, no discount yet.
do $$
begin
  perform create_booking(
    'aaaaaaaa-0000-0000-0000-000000000001',
    (select id from guests where property_id = 'aaaaaaaa-0000-0000-0000-000000000001' limit 1),
    '2026-08-30', '2026-09-03',
    '[{"room_id":"dddddddd-0000-0000-0000-000000000001","occupancy":2}]'::jsonb);
end $$;

select 'list · booking total (want 2200.00)       = ' || total_amount
from bookings order by created_at desc limit 1;
select 'list · 30 Aug night (want 700.00)         = ' || amount
from allocation_nights where night = '2026-08-30';
select 'list · 1 Sep night (want 400.00)          = ' || amount
from allocation_nights where night = '2026-09-01';

-- Now the discount: 10% off the room.
select 'discount · money taken off (want 220.00)  = ' || set_allocation_discount(
  (select id from room_allocations where kind = 'booking' order by created_at desc limit 1),
  'percent', 10, 'صاحب المالك', null);

select 'discount · booking total (want 1980.00)   = ' || total_amount
from bookings order by created_at desc limit 1;

-- Each night discounted at its own price, not at the stay average.
select 'discount · 30 Aug night (want 630.00)     = ' || amount
from allocation_nights where night = '2026-08-30';
select 'discount · 1 Sep night (want 360.00)      = ' || amount
from allocation_nights where night = '2026-09-01';
select 'discount · 30 Aug list kept (want 700.00) = ' || list_amount
from allocation_nights where night = '2026-08-30';

-- The bill reads rate_per_night, so it has to follow the discount down.
select 'discount · stay average (want 495.00)     = ' || rate_per_night
from room_allocations where kind = 'booking' order by created_at desc limit 1;

-- August gets its two nights and its share of the discount; September gets
-- the rest. A discount spread evenly over the stay would give both the wrong
-- half, which is the whole reason revenue is recognised per night.
select 'August · room revenue (want 1260.00)      = ' || room_revenue
from report_summary('aaaaaaaa-0000-0000-0000-000000000001', '2026-08-01', '2026-09-01');
select 'August · discounts (want 140.00)          = ' || discounts
from report_summary('aaaaaaaa-0000-0000-0000-000000000001', '2026-08-01', '2026-09-01');
select 'August · ADR (want 630.00)                = ' || adr
from report_summary('aaaaaaaa-0000-0000-0000-000000000001', '2026-08-01', '2026-09-01');
select 'September · room revenue (want 720.00)    = ' || room_revenue
from report_summary('aaaaaaaa-0000-0000-0000-000000000001', '2026-09-01', '2026-10-01');
select 'September · discounts (want 80.00)        = ' || discounts
from report_summary('aaaaaaaa-0000-0000-0000-000000000001', '2026-09-01', '2026-10-01');
select 'daily · 30 Aug revenue (want 630.00)      = ' || revenue
from report_daily('aaaaaaaa-0000-0000-0000-000000000001', '2026-08-30', '2026-08-31');

-- A price named outright flattens the season, on purpose.
select 'named rate · money off (want 200.00)      = ' || set_allocation_discount(
  (select id from room_allocations where kind = 'booking' order by created_at desc limit 1),
  'rate', 500, null, null);
select 'named rate · booking total (want 2000.00) = ' || total_amount
from bookings order by created_at desc limit 1;

-- And clearing it puts the stay back exactly where it started.
select 'cleared · money off (want 0.00)           = ' || set_allocation_discount(
  (select id from room_allocations where kind = 'booking' order by created_at desc limit 1),
  null, null, null, null);
select 'cleared · booking total (want 2200.00)    = ' || total_amount
from bookings order by created_at desc limit 1;
select 'cleared · 30 Aug night (want 700.00)      = ' || amount
from allocation_nights where night = '2026-08-30';

-- Nonsense is refused rather than stored.
do $$
begin
  perform set_allocation_discount(
    (select id from room_allocations where kind = 'booking' order by created_at desc limit 1),
    'percent', 150, null, null);
  raise notice '120%% discount (want refused)              = stored';
exception when others then
  raise notice '120%% discount (want refused)              = refused';
end $$;

reset role;

-- Hotel B may not discount hotel A's room.
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
set role authenticated;
do $$
begin
  perform set_allocation_discount(
    (select id from room_allocations where kind = 'booking' limit 1),
    'percent', 50, null, null);
  raise notice 'hotel B discounting A (want denied)       = allowed';
exception when others then
  raise notice 'hotel B discounting A (want denied)       = denied';
end $$;
reset role;

-- Taking the booking with the discount already on it, the way reception
-- quotes it on the phone. Two nights at 400 with 100 off each = 600.
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
set role authenticated;
do $$
begin
  perform create_booking(
    'aaaaaaaa-0000-0000-0000-000000000001',
    (select id from guests where property_id = 'aaaaaaaa-0000-0000-0000-000000000001' limit 1),
    '2026-10-01', '2026-10-03',
    '[{"room_id":"dddddddd-0000-0000-0000-000000000001","occupancy":2,
       "discount_kind":"amount","discount_value":100,"discount_note":"عرض"}]'::jsonb);
end $$;
select 'booked with discount (want 600.00)        = ' || total_amount
from bookings order by created_at desc limit 1;
reset role;

-- A room cannot hold more people than it holds. create_booking always
-- checked; the trigger covers the edit path reception now has.
do $$
begin
  update room_allocations set occupancy = 9
   where kind = 'booking' and room_id = 'dddddddd-0000-0000-0000-000000000001';
  raise notice '9 in a 3-bed room (want refused)             = stored';
exception when others then
  raise notice '9 in a 3-bed room (want refused)             = refused';
end $$;
do $$
begin
  update room_allocations set occupancy = 0
   where kind = 'booking' and room_id = 'dddddddd-0000-0000-0000-000000000001';
  raise notice 'nobody in the room (want refused)            = stored';
exception when others then
  raise notice 'nobody in the room (want refused)            = refused';
end $$;
do $$
begin
  update room_allocations set occupancy = 3
   where kind = 'booking' and room_id = 'dddddddd-0000-0000-0000-000000000001';
  raise notice '3 in a 3-bed room (want accepted)            = accepted';
exception when others then
  raise notice '3 in a 3-bed room (want accepted)            = refused';
end $$;

-- Changing a head count has to move the bill with it, not just the nights.
-- The last booking is 2 nights for 2 people at 400, less 100 a night = 600.
-- At 3 people the standing rate is 650, so 2 x (650 - 100) = 1100.
-- Inserted as the superuser, like the other rates at the top of this file.
-- Direct writes to `rates` are closed to `authenticated` on purpose, and an
-- insert that a policy refuses reports no error — it just does nothing, and
-- resolve_rate then quietly falls back to the room type's base_rate.
insert into rates (property_id, room_type_id, rate_plan_id, occupancy, amount)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
        'eeeeeeee-0000-0000-0000-000000000001', 3, 650)
on conflict do nothing;

-- Back to two first: an earlier step in this file already moved this room
-- to three, and the trigger only fires when the number actually changes.
update room_allocations set occupancy = 2
 where booking_id = (select id from bookings order by created_at desc limit 1);
update room_allocations set occupancy = 3
 where booking_id = (select id from bookings order by created_at desc limit 1);

select 'head count 2 to 3 · booking total (want 1100.00) = ' || total_amount
from bookings order by created_at desc limit 1;
select 'head count 2 to 3 · adults follow (want 3)       = ' || adults
from bookings order by created_at desc limit 1;
