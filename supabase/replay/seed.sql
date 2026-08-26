-- Two hotels, four people, seeded after the history has replayed.
-- The point of the fixture is the crossing: nobody may see the other hotel,
-- whatever they are allowed at their own.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner.a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'reception.a@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'owner.b@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'nobody@example.com')
on conflict do nothing;

insert into profiles (id, full_name) values
  ('11111111-1111-1111-1111-111111111111', 'Owner A'),
  ('22222222-2222-2222-2222-222222222222', 'Reception A'),
  ('33333333-3333-3333-3333-333333333333', 'Owner B'),
  ('44444444-4444-4444-4444-444444444444', 'Nobody')
on conflict do nothing;

insert into properties (id, slug, name, timezone) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'hotel-a', 'Hotel A', 'Africa/Cairo'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'hotel-b', 'Hotel B', 'Africa/Cairo')
on conflict do nothing;

insert into property_members (property_id, user_id, role, is_active, login_username) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner', true, 'ownera'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'reception', true, 'recepa'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'owner', true, 'ownerb')
on conflict do nothing;

-- Every hotel is born with a default rate plan now (a trigger sees to it),
-- so the fixture adopts hotel A's under the id the suites below use rather
-- than inserting a second default the unique index would refuse.
update rate_plans set id = 'eeeeeeee-0000-0000-0000-000000000001', code = 'STD',
       name = 'Standard plan'
 where property_id = 'aaaaaaaa-0000-0000-0000-000000000001' and is_default;

insert into guests (property_id, full_name, phone) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Guest of A', '0100000001'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Guest of B', '0100000002')
on conflict do nothing;
