\pset tuples_only on
\pset format unaligned

-- Session-level, not transaction-local: each statement below is its own
-- transaction, so a local setting would be gone before the query runs.
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
set role authenticated;
select 'owner A · own guests (want 1)      = ' || count(*) from guests;
select 'owner A · own properties (want 1)  = ' || count(*) from properties;
select 'owner A · own bookings ok          = ' || count(*) from property_members;
reset role;

select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
set role authenticated;
select 'owner B · own guests (want 1)      = ' || count(*) from guests;
select 'owner B · own properties (want 1)  = ' || count(*) from properties;
reset role;

select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
set role authenticated;
select 'outsider · guests (want 0)         = ' || count(*) from guests;
select 'outsider · properties (want 0)     = ' || count(*) from properties;
reset role;
