\pset tuples_only on
\pset format unaligned

-- The companies a hotel deals with, and the one thing they are for: an
-- agency's rooms priced at the agency's rate without anybody remembering
-- the deal. The screen writes this table directly, so what it may write is
-- decided by RLS and nothing else — which is what this file checks.

-- A second plan, priced under the standing 400. Inserted as the superuser
-- like every other rate in these suites: direct writes to `rates` are closed
-- to `authenticated`, and a blocked insert reports no error at all.
insert into rate_plans (id, property_id, code, name, is_default) values
  ('eeeeeeee-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'CO', 'Companies', false)
on conflict do nothing;

insert into rates (property_id, room_type_id, rate_plan_id, occupancy, amount) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000002', 2, 300)
on conflict do nothing;

select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
set role authenticated;

-- Added from the settings screen: a plain insert, no function behind it.
insert into accounts (property_id, name, rate_plan_id, contact_name, contact_phone)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'حكاية تريب',
        'eeeeeeee-0000-0000-0000-000000000002', 'عز الدين', '0100000003');

select 'owner A · own companies (want 1)          = ' || count(*) from accounts;

-- Edited from the same screen.
update accounts set contact_phone = '0100000009' where name = 'حكاية تريب';
select 'owner A · edit sticks (want 0100000009)   = ' || contact_phone
from accounts where name = 'حكاية تريب';

-- The unique index is the backstop under the check in the form.
do $$
begin
  insert into accounts (property_id, name)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'حكاية تريب');
  raise notice 'same name twice (want refused)            = stored';
exception when others then
  raise notice 'same name twice (want refused)            = refused';
end $$;

-- The company's plan decides the price when nobody names one. This is the
-- whole point of the table: 2 nights at the company's 300, not at 400.
do $$
begin
  perform create_booking(
    'aaaaaaaa-0000-0000-0000-000000000001',
    (select id from guests where property_id = 'aaaaaaaa-0000-0000-0000-000000000001' limit 1),
    '2026-11-10', '2026-11-12',
    '[{"room_id":"dddddddd-0000-0000-0000-000000000001","occupancy":2}]'::jsonb,
    null,
    (select id from accounts where name = 'حكاية تريب'));
end $$;

select 'company plan priced it (want 600.00)      = ' || total_amount
from bookings order by created_at desc limit 1;
select 'booking filed to the company (want t)     = ' || (account_id is not null)
from bookings order by created_at desc limit 1;

-- Hiding a company takes it out of the picker and nothing else: the booking
-- keeps its name. That is why the screen hides rather than deletes.
update accounts set is_active = false where name = 'حكاية تريب';
select 'hidden · still on the booking (want t)    = ' || (account_id is not null)
from bookings order by created_at desc limit 1;
select 'hidden · out of the picker (want 0)       = ' || count(*)
from accounts where is_active;

update accounts set is_active = true where name = 'حكاية تريب';
reset role;

-- Reception never sees the settings screen, but does see the picker on the
-- booking screen — so reception has to be able to read this table.
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
set role authenticated;
select 'reception A · sees the picker (want 1)    = ' || count(*) from accounts;
reset role;

-- And the crossing, which is the reason any of this is in the database.
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
set role authenticated;
select 'owner B · sees A''s companies (want 0)     = ' || count(*) from accounts;
do $$
begin
  insert into accounts (property_id, name)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'شركة مدسوسة');
  raise notice 'B writing into A (want denied)            = allowed';
exception when others then
  raise notice 'B writing into A (want denied)            = denied';
end $$;
reset role;

select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
set role authenticated;
select 'outsider · companies (want 0)             = ' || count(*) from accounts;
reset role;
