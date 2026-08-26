\pset tuples_only on
\pset format unaligned

-- Emptying one hotel's register from the platform console.
--
-- The fixture arrives here with hotel A trading — bookings, nights, a
-- company, a guest — and hotel B holding a guest of its own. What has to be
-- true afterwards is that hotel A is empty, hotel A's setup is untouched,
-- and hotel B never noticed.

-- Owner A also runs the platform. Inserted as the superuser: platform_admins
-- has no policies at all and is written by nobody through the API.
insert into platform_admins (user_id) values ('11111111-1111-1111-1111-111111111111')
on conflict do nothing;

select 'before · hotel A bookings (want 4)        = ' || count(*)
from bookings where property_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- Hotel B is not a platform admin, and asking politely with the right code
-- changes nothing about that.
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
set role authenticated;
do $$
begin
  perform reset_property_data('aaaaaaaa-0000-0000-0000-000000000001', 'hotel-a');
  raise notice 'B resetting A (want denied)               = allowed';
exception when others then
  raise notice 'B resetting A (want denied)               = denied';
end $$;
reset role;

select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
set role authenticated;

-- The hand, not the security: the console lists hotels one under another.
do $$
begin
  perform reset_property_data('aaaaaaaa-0000-0000-0000-000000000001', 'hotel-b');
  raise notice 'wrong code typed (want refused)           = accepted';
exception when others then
  raise notice 'wrong code typed (want refused)           = refused';
end $$;

select 'refused · bookings still there (want 4)   = ' || count(*)
from bookings where property_id = 'aaaaaaaa-0000-0000-0000-000000000001';

select 'reset · reported deleted bookings (want 4) = '
  || (reset_property_data('aaaaaaaa-0000-0000-0000-000000000001', 'hotel-a') -> 'deleted' ->> 'bookings');

-- What had to go.
select 'after · bookings (want 0)                 = ' || count(*)
from bookings where property_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'after · guests (want 0)                   = ' || count(*)
from guests where property_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'after · allocations (want 0)              = ' || count(*)
from room_allocations where property_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'after · nights (want 0)                   = ' || count(*)
from allocation_nights where property_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- What had to stay, including the company the settings screen writes.
select 'after · rooms kept (want 1)               = ' || count(*)
from rooms where property_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'after · rates kept (want 4)               = ' || count(*)
from rates where property_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'after · companies kept (want 1)           = ' || count(*)
from accounts where property_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'after · staff kept (want 2)               = ' || count(*)
from property_members where property_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- The reset is the first line of the empty log, not a silent event.
select 'after · log holds the reset (want 1)      = ' || count(*)
from activity_log
where property_id = 'aaaaaaaa-0000-0000-0000-000000000001' and action = 'data_reset';

-- No hotel is trading, so the counter may go back to one and the next real
-- booking reads GR26-0001 rather than GR26-0044.
select 'after · reference counter (want 1)        = ' || (select last_value from booking_ref_seq);
reset role;

-- And the hotel next door never noticed.
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
set role authenticated;
select 'after · hotel B guests (want 1)           = ' || count(*) from guests;
reset role;
