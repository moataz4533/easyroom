-- Putting the ten plans back.
--
-- Yesterday's shape was restored on the reading that ten plans naming the
-- occupancy — «حجز سنجل شركات بدون فطار» through «خماسي … ب فطار» — were a
-- duplication of the matrix rows. That reading was right about the data
-- model and wrong about the hotel: the desk had built them deliberately,
-- has been quoting from them, and says they suit the way they sell. A model
-- that is tidier and that nobody can work in is not the better model.
--
-- So this is a straight undo of `untangle_rate_plans`. Everything it changed
-- goes back: the two renamed plans get their names, prices and null English
-- names, the eight hidden ones come back on, `is_default` returns to
-- «تريبل», the addons on the five «ب فطار» plans are rebuilt, the room type
-- goes back to four guests and breakfast back to zero.
--
-- Nothing was ever deleted — the eight were hidden and their prices left
-- alone — which is why this is possible at all. That was the point of
-- hiding rather than deleting, and it is worth keeping the habit.
do $$
declare
  v_prop     uuid;
  v_type     uuid;
  v_direct   uuid;
  v_corp     uuid;
  v_breakfast uuid;
  v_transfer uuid;
  v_plan     record;
  v_bookings int;
begin
  select id into v_prop from properties where slug = 'greek-club-dahab';
  if v_prop is null then
    raise notice 'no such hotel';
    return;
  end if;

  select count(*) into v_bookings from bookings where property_id = v_prop;
  select id into v_type   from room_types where property_id = v_prop order by sort_order limit 1;
  select id into v_direct from rate_plans where property_id = v_prop and code = 'DIRECT';
  select id into v_corp   from rate_plans where property_id = v_prop and code = 'CORP';

  -- The two that were renamed.
  update rate_plans set
    name = 'حجز سنجل شركات بدون فطار', name_en = null,
    is_default = false, is_active = true, sort_order = 1, updated_at = now()
  where id = v_direct;

  update rate_plans set
    name = 'حجز دبل شركات بدون فطار', name_en = null,
    is_default = false, is_active = true, sort_order = 2, updated_at = now()
  where id = v_corp;

  -- The eight that were hidden.
  update rate_plans set is_active = true, updated_at = now()
   where property_id = v_prop and id not in (v_direct, v_corp);

  -- The default the desk had chosen. On a hotel that never had these plans
  -- — a clean replay, say — the first plan keeps it instead, because
  -- `create_booking` refuses outright when there is no default at all.
  update rate_plans set is_default = false where property_id = v_prop;
  update rate_plans set is_default = true, updated_at = now()
   where id = coalesce(
     (select id from rate_plans where property_id = v_prop and code = 'تريبل فطار'),
     (select id from rate_plans where property_id = v_prop order by sort_order limit 1)
   );

  -- Their prices: one number across every head count, which is how these
  -- plans are meant to be read — the occupancy is in the name.
  delete from rates
   where property_id = v_prop and valid_from is null
     and rate_plan_id in (v_direct, v_corp);

  insert into rates (property_id, room_type_id, rate_plan_id, occupancy, amount)
  select v_prop, v_type, v_direct, o, 1000 from generate_series(1, 4) as o;

  insert into rates (property_id, room_type_id, rate_plan_id, occupancy, amount)
  select v_prop, v_type, v_corp, o, 1200 from generate_series(1, 4) as o;

  -- Four guests again, and breakfast back inside the plan price.
  update room_types set max_occupancy = 4, updated_at = now() where id = v_type;
  update charge_items set default_amount = 0, updated_at = now()
   where property_id = v_prop and name = 'فطار';

  -- The two services that were marked included on every «ب فطار» plan.
  select id into v_breakfast from charge_items where property_id = v_prop and name = 'فطار';
  select id into v_transfer  from charge_items where property_id = v_prop and name = 'ترانسفير';

  for v_plan in
    select id from rate_plans
     where property_id = v_prop and name like '%ب فطار%'
  loop
    insert into rate_plan_addons
      (property_id, rate_plan_id, charge_item_id, pricing_basis, is_included, unit_amount, sort_order)
    values
      (v_prop, v_plan.id, v_breakfast, 'per_guest_night', true, 0, 0),
      (v_prop, v_plan.id, v_transfer,  'per_guest_night', true, 0, 1)
    on conflict (rate_plan_id, charge_item_id) do nothing;
  end loop;

  if (select count(*) from bookings where property_id = v_prop) <> v_bookings then
    raise exception 'a booking was touched';
  end if;
  -- Not "ten": the number is the desk's business and may change. What must
  -- be true is that this migration left nothing switched off.
  if exists (select 1 from rate_plans where property_id = v_prop and not is_active) then
    raise exception 'a plan was left hidden';
  end if;
  if (select count(*) from rate_plans where property_id = v_prop and is_default) <> 1 then
    raise exception 'there must be exactly one default plan';
  end if;
end $$;
