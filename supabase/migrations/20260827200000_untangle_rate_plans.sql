-- Untangling ten rate plans back into two.
--
-- The owner built a price list and the app let them build it wrong. Ten
-- plans, named «حجز سنجل شركات بدون فطار», «حجز دبل شركات بدون فطار», and so
-- on to «خماسي», then the same five again «ب فطار». Each one priced with a
-- single number repeated across every head count — 1000 for one guest, 1000
-- for two, 1000 for three, 1000 for four.
--
-- The names carried three things the system already models on its own:
--
--   سنجل / دبل / تريبل / رباعي / خماسي  →  occupancy, the matrix ROWS
--   بفطار / بدون فطار                    →  a charge item on the booking
--   شركات                                →  the plan itself
--
-- So forty numbers were entered to say what ten say. And the matrix, whose
-- columns are plans, became ten columns of four-line headings on a phone —
-- which is how this was noticed at all.
--
-- What the numbers actually meant, read off their own data:
--
--         بدون فطار   بفطار
--   ١ فرد    1000      1200
--   ٢         1200      1400
--   ٣         1400      1600
--   ٤         1600      1800
--   ٥         1800      2000
--
-- The «بدون فطار» column is the corporate list extended to five guests, and
-- «بفطار» is the direct list extended — the two plans this hotel has had
-- since the first week, relabelled. Their descriptions survived the renaming
-- and are what proved which was which.
--
-- Nothing here touches a booking. `allocation_nights` stores what each night
-- was actually sold for, so a stay already taken keeps its price whatever
-- happens to the plan it was taken on.
do $$
declare
  v_prop  uuid;
  v_type  uuid;
  v_direct uuid;
  v_corp   uuid;
  v_before int;
  v_bookings int;
begin
  select id into v_prop from properties where slug = 'greek-club-dahab';
  if v_prop is null then
    raise notice 'no such hotel, nothing to untangle';
    return;
  end if;

  select id into v_type from room_types where property_id = v_prop order by sort_order limit 1;
  select id into v_direct from rate_plans where property_id = v_prop and code = 'DIRECT';
  select id into v_corp   from rate_plans where property_id = v_prop and code = 'CORP';
  if v_direct is null or v_corp is null or v_type is null then
    raise exception 'the two original plans or the room type are missing';
  end if;

  select count(*) into v_bookings from bookings where property_id = v_prop;
  select count(*) into v_before from rate_plans where property_id = v_prop;

  -- Five guests can be priced now. The plans were named for five and the
  -- room type only allowed four, so the fifth row could not be typed at all.
  update room_types set max_occupancy = greatest(max_occupancy, 5), updated_at = now()
   where id = v_type;

  -- The two survivors, back under their own names. `is_default` moved to
  -- «تريبل» along the way, which meant a booking with no plan chosen was
  -- being quoted as a triple.
  update rate_plans set is_default = false where property_id = v_prop;

  update rate_plans set
    name = 'حجز مباشر', name_en = 'Direct booking',
    description = 'السعر المعلن للنزيل اللي بيحجز بنفسه',
    is_default = true, is_active = true, sort_order = 1, updated_at = now()
  where id = v_direct;

  update rate_plans set
    name = 'شركات', name_en = 'Corporate',
    description = 'سعر تعاقدي للشركات والجهات',
    is_default = false, is_active = true, sort_order = 2, updated_at = now()
  where id = v_corp;

  -- Everything else goes quiet. Hidden rather than deleted: one of them has
  -- a booking on it, and a deleted plan would take its name off that record.
  update rate_plans set is_active = false, updated_at = now()
   where property_id = v_prop and id not in (v_direct, v_corp);

  -- The standing prices, one row per head count, from the owner's own list.
  delete from rates
   where property_id = v_prop and valid_from is null
     and rate_plan_id in (v_direct, v_corp);

  insert into rates (property_id, room_type_id, rate_plan_id, occupancy, amount)
  select v_prop, v_type, v_direct, o, a
  from (values (1, 1200), (2, 1400), (3, 1600), (4, 1800), (5, 2000)) as t(o, a);

  insert into rates (property_id, room_type_id, rate_plan_id, occupancy, amount)
  select v_prop, v_type, v_corp, o, a
  from (values (1, 1000), (2, 1200), (3, 1400), (4, 1600), (5, 1800)) as t(o, a);

  -- Breakfast stops being a plan and becomes what it is: a line on the bill.
  -- Two hundred a night, the difference between the owner's two columns.
  update charge_items set default_amount = 200, is_active = true, updated_at = now()
   where property_id = v_prop and name = 'فطار';

  -- The addons on the plans being hidden would otherwise sit there ready to
  -- charge a transfer to every guest if one were ever switched back on.
  delete from rate_plan_addons
   where property_id = v_prop
     and rate_plan_id not in (v_direct, v_corp);

  -- Nothing above may have touched a booking, and no plan may have vanished.
  if (select count(*) from bookings where property_id = v_prop) <> v_bookings then
    raise exception 'a booking was touched';
  end if;
  if (select count(*) from rate_plans where property_id = v_prop) <> v_before then
    raise exception 'a rate plan was deleted rather than hidden';
  end if;
  if (select count(*) from rate_plans where property_id = v_prop and is_default) <> 1 then
    raise exception 'there must be exactly one default plan';
  end if;
  if (select count(*) from rates where property_id = v_prop and valid_from is null
        and rate_plan_id in (v_direct, v_corp) and amount > 0) <> 10 then
    raise exception 'the two plans should have five priced rows each';
  end if;
end $$;
