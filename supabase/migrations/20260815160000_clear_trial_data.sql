-- Clearing the trial run.
--
-- The Greek Club's data so far is a handful of bookings made while the app
-- was being built and tried out. The owner asked for it gone so the hotel
-- starts on real work with a clean register.
--
-- What goes: bookings and everything hanging off them (rooms allocated,
-- nights, payments, extras), the guests, the housekeeping tasks, the blocks
-- on rooms, and the activity log.
--
-- What stays, deliberately: the rooms and their types, the rates and
-- seasons, the extras catalogue, the staff accounts, the manager password,
-- and the hotel's own details. Those are the setup, not the trading — and
-- re-entering them is the work this is meant to save.
--
-- Scoped to one hotel by slug rather than truncating tables, because the
-- schema is multi-tenant and a truncate here would empty every hotel that
-- ever shares this database.

do $$
declare
  v_prop   uuid;
  v_rooms  int;
  v_types  int;
  v_rates  int;
  v_plans  int;
  v_items  int;
  v_staff  int;
  v_secret int;
begin
  select id into v_prop from properties where slug = 'greek-club-dahab';
  if v_prop is null then
    raise notice 'no such hotel, nothing to clear';
    return;
  end if;

  -- Read the setup before, so the guards below can prove it survived.
  select count(*) into v_rooms from rooms          where property_id = v_prop;
  select count(*) into v_types from room_types     where property_id = v_prop;
  select count(*) into v_rates from rates          where property_id = v_prop;
  select count(*) into v_plans from rate_plans     where property_id = v_prop;
  select count(*) into v_items from charge_items   where property_id = v_prop;
  select count(*) into v_staff from property_members where property_id = v_prop;
  -- Counted rather than assumed to be one: a hotel that has not set a
  -- manager password yet has no row at all, and this guard must not invent
  -- one for it.
  select count(*) into v_secret from property_secrets where property_id = v_prop;

  -- Bookings cascade to room_allocations, allocation_nights, payments and
  -- booking_charges, so this one delete takes the whole trading history.
  delete from bookings where property_id = v_prop;

  -- Maintenance and holds are not bookings and do not cascade with them.
  delete from room_allocations where property_id = v_prop;

  -- housekeeping_tasks.booking_id is ON DELETE SET NULL, so the tasks
  -- outlive their bookings and have to go on their own.
  delete from housekeeping_tasks where property_id = v_prop;

  delete from guests where property_id = v_prop;
  delete from activity_log where property_id = v_prop;

  -- Every room is free and clean on an empty register; leaving a room
  -- "dirty" from a guest who no longer exists would be a task nobody can
  -- close.
  update rooms set housekeeping_status = 'clean', updated_at = now()
   where property_id = v_prop;

  -- The reference counter is a sequence, so without this the first real
  -- booking would be GR26-0024 and read like twenty-three were lost.
  perform setval('booking_ref_seq', 1, false);

  -- The setup is the thing this must not touch.
  if (select count(*) from rooms where property_id = v_prop) <> v_rooms then
    raise exception 'the rooms were touched';
  end if;
  if (select count(*) from room_types where property_id = v_prop) <> v_types then
    raise exception 'the room types were touched';
  end if;
  if (select count(*) from rates where property_id = v_prop) <> v_rates then
    raise exception 'the rates were touched';
  end if;
  if (select count(*) from rate_plans where property_id = v_prop) <> v_plans then
    raise exception 'the rate plans were touched';
  end if;
  if (select count(*) from charge_items where property_id = v_prop) <> v_items then
    raise exception 'the extras catalogue was touched';
  end if;
  if (select count(*) from property_members where property_id = v_prop) <> v_staff then
    raise exception 'the staff accounts were touched';
  end if;
  if (select count(*) from property_secrets where property_id = v_prop) <> v_secret then
    raise exception 'the manager password was touched';
  end if;
end $$;
