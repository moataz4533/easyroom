\pset tuples_only on
\pset format unaligned

-- Licences: a hotel may use the app until a date, then a grace period, then
-- it locks the way a suspended hotel does. Owner A also runs the platform
-- (reset.sql made them a platform admin); owner B only owns hotel B.

-- Both fixture hotels were opened after the migrations ran, so neither has
-- a licence row: they are on the implicit trial. Cleared first so the suite
-- means the same thing when it is run twice against one database.
delete from property_licenses
 where property_id in ('aaaaaaaa-0000-0000-0000-000000000001',
                       'bbbbbbbb-0000-0000-0000-000000000002');
update properties set created_at = now()
 where id in ('aaaaaaaa-0000-0000-0000-000000000001',
              'bbbbbbbb-0000-0000-0000-000000000002');

select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
set role authenticated;
select 'licence · a new hotel is on a trial with no row (want 2) = ' || count(*)
from platform_licenses()
where property_id in ('aaaaaaaa-0000-0000-0000-000000000001',
                      'bbbbbbbb-0000-0000-0000-000000000002')
  and kind = 'trial' and not explicit and days_left = 14;
reset role;

-- --------------------------------------------- hotels cannot touch it --
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
set role authenticated;

do $$
begin
  perform count(*) from property_licenses;
  raise notice 'licence · owner reads the licence table (want denied) = allowed';
exception when others then
  raise notice 'licence · owner reads the licence table (want denied) = denied';
end $$;

do $$
begin
  update property_licenses set ends_on = '2099-01-01'
   where property_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  raise notice 'licence · owner extends their own (want denied) = allowed';
exception when others then
  raise notice 'licence · owner extends their own (want denied) = denied';
end $$;

do $$
begin
  perform platform_extend_license('bbbbbbbb-0000-0000-0000-000000000002', 12, 0);
  raise notice 'licence · owner calls the platform renewal (want denied) = allowed';
exception when others then
  raise notice 'licence · owner calls the platform renewal (want denied) = denied';
end $$;

-- What a hotel *may* see: its own state, and only its own.
select 'licence · B sees its own state (want 1)    = ' || count(*)
from my_hotel_licenses();
select 'licence · B''s trial is in its warning window (want expiring) = ' || state
from my_hotel_licenses();

reset role;

-- ---------------------------------- the implicit trial runs out too --
-- Twenty days old with no licence: six days past the trial, inside grace.
update properties set created_at = now() - interval '20 days'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
set role authenticated;
select 'licence · unpaid trial, 20 days old (want grace) = ' || state from my_hotel_licenses();
select 'licence · still in during trial grace (want t) = ' ||
  is_member('bbbbbbbb-0000-0000-0000-000000000002');
reset role;

-- Thirty days old with no licence: locked, without anybody deciding so.
update properties set created_at = now() - interval '30 days'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
set role authenticated;
select 'licence · unpaid trial, 30 days old (want expired) = ' || state from my_hotel_licenses();
select 'licence · locked when nobody renewed (want f) = ' ||
  is_member('bbbbbbbb-0000-0000-0000-000000000002');
reset role;
update properties set created_at = now()
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';

-- -------------------------------------------------- grace, then lock --
insert into property_licenses (property_id, kind, ends_on, grace_days)
values ('bbbbbbbb-0000-0000-0000-000000000002', 'paid',
        (now() at time zone 'Africa/Cairo')::date - 3, 7)
on conflict (property_id) do update
  set kind = 'paid', ends_on = excluded.ends_on, grace_days = 7;

select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
set role authenticated;
select 'licence · three days past, in grace (want grace) = ' || state from my_hotel_licenses();
select 'licence · still a member in grace (want t) = ' ||
  is_member('bbbbbbbb-0000-0000-0000-000000000002');
select 'licence · still sees own guests in grace (want 2) = ' || count(*) from guests;
reset role;

update property_licenses
   set ends_on = (now() at time zone 'Africa/Cairo')::date - 10, grace_days = 7
 where property_id = 'bbbbbbbb-0000-0000-0000-000000000002';

select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
set role authenticated;
select 'licence · past grace (want expired)        = ' || state from my_hotel_licenses();
select 'licence · no longer a member (want f)      = ' ||
  is_member('bbbbbbbb-0000-0000-0000-000000000002');
select 'licence · no longer manages (want f)       = ' ||
  can_manage('bbbbbbbb-0000-0000-0000-000000000002');
select 'licence · sees no guests (want 0)          = ' || count(*) from guests;
select 'licence · sees no hotel (want 0)           = ' || count(*) from properties;
-- Locked out of everything except the reason why.
select 'licence · still told why (want 1)          = ' || count(*) from my_hotel_licenses();
reset role;

-- The other hotel is not touched by B's licence ending.
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
set role authenticated;
select 'licence · A unaffected by B (want t)       = ' ||
  is_member('aaaaaaaa-0000-0000-0000-000000000001');

-- ------------------------------------------- the platform renews it --
-- B is ten days past its end and three past grace: renewing starts today,
-- because a locked hotel was not using the days.
select 'licence · renewal from expired starts today (want 1 month) = ' ||
  (ends_on - (now() at time zone 'Africa/Cairo')::date between 28 and 31)::text
from platform_extend_license('bbbbbbbb-0000-0000-0000-000000000002', 1, 500, 'EGP', 'cash', 'replay');

select 'licence · renewed licence is paid (want paid) = ' || kind
from platform_licenses() where property_id = 'bbbbbbbb-0000-0000-0000-000000000002';
select 'licence · payment on record (want 500.00)  = ' || paid_total
from platform_licenses() where property_id = 'bbbbbbbb-0000-0000-0000-000000000002';

reset role;
-- In grace, renewal continues from the old end date: grace is a courtesy,
-- not free days.
update property_licenses
   set ends_on = (now() at time zone 'Africa/Cairo')::date - 3
 where property_id = 'bbbbbbbb-0000-0000-0000-000000000002';

select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
set role authenticated;
select 'licence · renewal in grace continues from the end (want t) = ' ||
  (ends_on = ((now() at time zone 'Africa/Cairo')::date - 3 + interval '1 month')::date)::text
from platform_extend_license('bbbbbbbb-0000-0000-0000-000000000002', 1);

-- Paying early never loses a day.
select 'licence · early renewal adds to the end (want t) = ' ||
  (ends_on = ((now() at time zone 'Africa/Cairo')::date - 3 + interval '2 month')::date)::text
from platform_extend_license('bbbbbbbb-0000-0000-0000-000000000002', 1);

reset role;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
set role authenticated;
select 'licence · B is back in (want t)            = ' ||
  is_member('bbbbbbbb-0000-0000-0000-000000000002');
reset role;

-- ------------------------------------------------ set it outright --
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
set role authenticated;

do $$
begin
  perform platform_set_license('bbbbbbbb-0000-0000-0000-000000000002', 'paid', null);
  raise notice 'licence · paid without an end date (want refused) = accepted';
exception when others then
  raise notice 'licence · paid without an end date (want refused) = refused';
end $$;

select 'licence · open-ended (want unlimited)      = ' || state
from platform_set_license('bbbbbbbb-0000-0000-0000-000000000002', 'unlimited') l
cross join lateral (select license_state(l.ends_on, l.grace_days, current_date) as state) s;

-- Three renewals and one change; the refused one left no trace.
select 'licence · every change written down (want 4) = ' || count(*)
from platform_license_history('bbbbbbbb-0000-0000-0000-000000000002')
where kind in ('extended', 'set');

reset role;

-- Leave both hotels as they started: no row, on the implicit trial.
delete from property_licenses
 where property_id in ('aaaaaaaa-0000-0000-0000-000000000001',
                       'bbbbbbbb-0000-0000-0000-000000000002');
