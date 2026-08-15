\pset tuples_only on
\pset format unaligned

-- Suspend hotel A only.
update properties set is_active = false where slug = 'hotel-a';

select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
set role authenticated;
select 'A suspended · owner A guests (want 0)     = ' || count(*) from guests;
select 'A suspended · owner A properties (want 0) = ' || count(*) from properties;
select 'A suspended · is_member (want f)          = ' || is_member('aaaaaaaa-0000-0000-0000-000000000001');
select 'A suspended · is_admin (want f)           = ' || is_admin('aaaaaaaa-0000-0000-0000-000000000001');
reset role;

-- Hotel B is untouched by A's suspension.
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
set role authenticated;
select 'A suspended · owner B guests (want 1)     = ' || count(*) from guests;
reset role;

-- And it all comes back.
update properties set is_active = true where slug = 'hotel-a';
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
set role authenticated;
select 'restored · owner A guests (want 1)        = ' || count(*) from guests;
select 'restored · owner A properties (want 1)    = ' || count(*) from properties;
reset role;

-- The admin table itself is invisible to a signed-in hotel owner.
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
set role authenticated;
select 'owner A · is_platform_admin (want f)      = ' || is_platform_admin();
reset role;
