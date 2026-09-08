\pset tuples_only on
\pset format unaligned

-- Two things: a rate plan says who it is for, and a stay whose departure
-- has passed closes itself.
--
-- The second is the one that matters. On production the day this was
-- written, thirteen stays were still `checked_in` — one of them fifteen
-- days after the guest had left — and no screen anywhere said so.

-- `reset.sql` ran before this and emptied hotel A's register, and rooms and
-- guests are not writable from a session — so the fixture is laid out as the
-- owner of the database before anybody signs in.
-- Left as found, so the suite can be run twice against one database.
update properties set settings = coalesce(settings, '{}'::jsonb) - 'auto_close_stays'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';

delete from rate_plans where property_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  and code in ('AGY', 'BAD');

insert into rooms (id, property_id, room_type_id, number, is_active) values
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', '102', true),
  ('dddddddd-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', '103', true)
on conflict do nothing;

insert into guests (id, property_id, full_name, phone) values
  ('a0000000-0000-0000-0000-0000000c1051', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Guest who forgot to leave', '0100000009')
on conflict do nothing;

select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
set role authenticated;

-- ------------------------------------------------------------- party --
select 'party · a plan starts as individuals (want direct) = ' || party
from rate_plans where id = 'eeeeeeee-0000-0000-0000-000000000001';

-- `dates.sql` has already set the manager password to 739210.
do $$
begin
  perform save_rate_plan(
    'aaaaaaaa-0000-0000-0000-000000000001', null, 'AGY', 'خطة وكالة', null,
    null, null, false, true, null, 'وكالة الاختبار', '[]'::jsonb, 'company', '739210');
exception when others then
  raise notice 'party · agency plan refused: %', sqlerrm;
end $$;

select 'party · an agency plan is a company one (want company) = ' || party
from rate_plans where code = 'AGY';
select 'party · and it carries its company (want 1) = ' || count(*)
from accounts where rate_plan_id = (select id from rate_plans where code = 'AGY');

-- An individuals plan may not belong to a company: the two disagreeing is
-- what the booking screen would then have to pick a winner from.
do $$
begin
  perform save_rate_plan(
    'aaaaaaaa-0000-0000-0000-000000000001', null, 'BAD', 'خطة مختلطة', null,
    null, null, false, true, null, 'شركة أخرى', '[]'::jsonb, 'direct', '739210');
  raise notice 'individuals plan with a company (want refused)  = accepted';
exception when others then
  raise notice 'individuals plan with a company (want refused)  = refused';
end $$;

-- --------------------------------------------------- automatic closing --

-- Three stays: one whose departure has passed, one leaving today, one still
-- running. Only the first should close.
--
-- They are checked in while they are current — `check_in_booking` rightly
-- refuses a stay that is already over — and then the first two are moved
-- back in time, which is exactly the state the desk leaves behind when
-- nobody presses the button.
do $$
declare
  v_guest uuid := 'a0000000-0000-0000-0000-0000000c1051';
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_over uuid; v_today_out uuid; v_running uuid;
begin
  select id into v_over from create_booking(
    'aaaaaaaa-0000-0000-0000-000000000001', v_guest, v_today, v_today + 3,
    '[{"room_id":"dddddddd-0000-0000-0000-000000000001","occupancy":2}]'::jsonb);
  select id into v_today_out from create_booking(
    'aaaaaaaa-0000-0000-0000-000000000001', v_guest, v_today, v_today + 3,
    '[{"room_id":"dddddddd-0000-0000-0000-000000000002","occupancy":2}]'::jsonb);
  select id into v_running from create_booking(
    'aaaaaaaa-0000-0000-0000-000000000001', v_guest, v_today, v_today + 3,
    '[{"room_id":"dddddddd-0000-0000-0000-000000000003","occupancy":2}]'::jsonb);

  perform check_in_booking(v_over);
  perform check_in_booking(v_today_out);
  perform check_in_booking(v_running);

  set local role postgres;
  update bookings set check_in = v_today - 5, check_out = v_today - 2 where id = v_over;
  update room_allocations set starts_on = v_today - 5, ends_on = v_today - 2
   where booking_id = v_over;
  update bookings set check_in = v_today - 1, check_out = v_today where id = v_today_out;
  update room_allocations set starts_on = v_today - 1, ends_on = v_today
   where booking_id = v_today_out;
exception when others then
  raise notice 'closing · setting up the three stays failed: %', sqlerrm;
end $$;

set role authenticated;

select 'closing · staying before it runs (want 3)  = ' || count(*)
from bookings where property_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  and status = 'checked_in';

select 'closing · reported closed (want 1)        = ' || count(*)
from close_overdue_stays('aaaaaaaa-0000-0000-0000-000000000001');

select 'closing · still staying after (want 2)    = ' || count(*)
from bookings where property_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  and status = 'checked_in';

-- The guest leaving today is untouched: at noon they may still be at the
-- desk settling up, and an app that checks them out mid-sentence is worse
-- than one that waits a day.
select 'closing · today''s departure left alone (want checked_in) = ' || status
from bookings where property_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  and check_out = (now() at time zone 'Africa/Cairo')::date
order by created_at desc limit 1;

-- The booked departure is kept, so the bill is the bill it always was.
select 'closing · departure date kept (want 2)    = ' ||
  ((now() at time zone 'Africa/Cairo')::date - check_out)
from bookings where property_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  and status = 'checked_out'
order by updated_at desc limit 1;

select 'closing · room let go (want 0)            = ' || count(*)
from room_allocations a
join bookings b on b.id = a.booking_id
where b.status = 'checked_out' and a.released_at is null;

-- Written down as nobody's doing, so the log does not credit whoever
-- happened to open the app that morning.
select 'closing · logged as automatic (want 1)    = ' || count(*)
from activity_log where action = 'auto_checked_out' and actor_id is null;

-- Running twice changes nothing: the desk opens the screen all day.
select 'closing · nothing left to close (want 0)  = ' || count(*)
from close_overdue_stays('aaaaaaaa-0000-0000-0000-000000000001');

-- A hotel that has switched it off is left alone.
do $$
begin
  update properties set settings = coalesce(settings,'{}'::jsonb)
    || '{"auto_close_stays": false}'::jsonb
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
end $$;

do $$
declare
  v_guest uuid := 'a0000000-0000-0000-0000-0000000c1051';
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_id uuid;
begin
  select id into v_id from create_booking(
    'aaaaaaaa-0000-0000-0000-000000000001', v_guest, v_today, v_today + 2,
    '[{"room_id":"dddddddd-0000-0000-0000-000000000001","occupancy":2}]'::jsonb);
  perform check_in_booking(v_id);
  set local role postgres;
  update bookings set check_in = v_today - 9, check_out = v_today - 7 where id = v_id;
  update room_allocations set starts_on = v_today - 9, ends_on = v_today - 7
   where booking_id = v_id;
exception when others then
  raise notice 'closing · setting up the switched-off stay failed: %', sqlerrm;
end $$;

set role authenticated;

select 'closing · switched off closes nothing (want 0) = ' || count(*)
from close_overdue_stays('aaaaaaaa-0000-0000-0000-000000000001');

-- And it is not a way into somebody else's hotel.
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
do $$
begin
  perform close_overdue_stays('aaaaaaaa-0000-0000-0000-000000000001');
  raise notice 'hotel B closing A''s stays (want denied)   = allowed';
exception when others then
  raise notice 'hotel B closing A''s stays (want denied)   = denied';
end $$;

reset role;

update properties set settings = coalesce(settings, '{}'::jsonb) - 'auto_close_stays'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
