\pset tuples_only on
\pset format unaligned

-- The sign-in screen may learn a hotel's name and logo from its code, before
-- anybody has signed in — and nothing else, and nothing without the code.

set role anon;
select 'login · anon finds a hotel by its code (want Hotel B) = ' || name
from hotel_by_code('hotel-b');
select 'login · the code is forgiving about case and spaces (want hotel-b) = ' || slug
from hotel_by_code('  HOTEL-B ');
select 'login · an unknown code finds nothing (want 0) = ' || count(*)
from hotel_by_code('no-such-hotel');
select 'login · an empty code finds nothing (want 0) = ' || count(*)
from hotel_by_code('');
-- It is not a way into the table it reads.
do $$
begin
  perform count(*) from properties;
  raise notice 'login · anon reads properties directly (want denied or 0) = %',
    (select count(*) from properties);
exception when others then
  raise notice 'login · anon reads properties directly (want denied or 0) = denied';
end $$;
reset role;

-- Exactly four columns, so nothing about a hotel's settings, currency or
-- members leaks through it.
select 'login · columns returned (want 4) = ' || count(*)
from information_schema.routines r
join information_schema.parameters p
  on p.specific_name = r.specific_name and p.parameter_mode = 'OUT'
where r.routine_name = 'hotel_by_code';
