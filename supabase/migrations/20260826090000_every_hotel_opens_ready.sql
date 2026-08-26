-- A hotel that can take a booking on the day it opens.
--
-- `create_booking` needs a rate plan. It looks for the one the booking
-- names, then the company's, then the hotel's default — and if there is no
-- default it raises `no rate plan configured for this property`.
--
-- Nothing has ever created that default. The Greek Club has one because a
-- one-off migration seeded it in the first week; a hotel opened from the
-- platform console gets a property row, an owner, and nothing else. So the
-- first thing its owner would do — take a booking — fails, with a message
-- about configuration and no screen named in it.
--
-- A trigger rather than a line in the edge function, because the invariant
-- belongs to the data: every hotel has exactly one default rate plan. That
-- was already half-enforced — `one_default_rate_plan` makes a second one
-- impossible — and this is the other half, which makes zero impossible too.
--
-- The name is deliberately the most ordinary thing a hotel sells: a room,
-- booked directly. Anything else it sells — agencies, half board, a
-- corporate deal — is a plan the owner adds and names themselves, which is
-- what the rate plans screen is for.
create or replace function public.seed_default_rate_plan()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  insert into rate_plans (property_id, code, name, name_en, is_default, sort_order)
  values (new.id, 'DIRECT', 'حجز مباشر', 'Direct booking', true, 1)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_seed_default_rate_plan on public.properties;
create trigger trg_seed_default_rate_plan
  after insert on public.properties
  for each row execute function public.seed_default_rate_plan();

-- Any hotel already open without one. The Greek Club has two plans and a
-- default among them, so this touches nothing there — it is here so the
-- invariant is true of the table and not only of rows inserted from now on.
insert into rate_plans (property_id, code, name, name_en, is_default, sort_order)
select p.id, 'DIRECT', 'حجز مباشر', 'Direct booking', true, 1
from properties p
where not exists (
  select 1 from rate_plans rp where rp.property_id = p.id and rp.is_default
)
on conflict do nothing;
