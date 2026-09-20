-- A hotel opened from the platform console arrives empty: no room types, no
-- rooms, no prices. Whoever logs in first meets a key rack with no keys and
-- cannot take a single booking until they have built the whole setup — which
-- is a poor first hour for a new customer and an impossible demo for anyone
-- showing the app to one.
--
-- `seed_demo_property` fills that setup in one call: two room types, six
-- rooms, a direct price list and an agency one, an agency to book on, and
-- the extras a desk actually charges for.
--
-- What it does NOT seed is bookings. Making the first booking is the demo —
-- with rooms and prices in place it takes half a minute — and inventing
-- guests would mean reimplementing `create_booking`'s allocation and
-- pricing rules here, where they would quietly drift out of step with it.
--
-- Deliberately unlike the first hotel's price list: the prices here change
-- with the head count, so the guest-count picker on the booking screen
-- visibly moves the total. That is the behaviour the app is built around.

create or replace function public.seed_demo_property(p_property uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_double uuid;
  v_triple uuid;
  v_direct uuid;
  v_company uuid;
  v_breakfast uuid;
  v_rooms int;
begin
  -- Only the platform operator, and only into a hotel nobody has started
  -- using. Both halves matter: the first stops a hotel's own staff calling
  -- it, the second stops it ever landing on top of real work.
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if not exists (select 1 from public.properties where id = p_property) then
    raise exception 'الفندق مش موجود';
  end if;

  select count(*) into v_rooms from public.rooms where property_id = p_property;
  if v_rooms > 0
     or exists (select 1 from public.bookings where property_id = p_property)
     or exists (select 1 from public.room_types where property_id = p_property) then
    raise exception 'الفندق ده فيه بيانات بالفعل — البيانات التجريبية بتتحط في فندق فاضي بس';
  end if;

  /* ------------------------------------------------------ room types -- */
  insert into public.room_types
    (property_id, code, name, name_en, base_occupancy, max_occupancy, base_rate, sort_order)
  values (p_property, 'DBL', 'غرفة دبل', 'Double room', 2, 3, 1200, 1)
  returning id into v_double;

  insert into public.room_types
    (property_id, code, name, name_en, base_occupancy, max_occupancy, base_rate, sort_order)
  values (p_property, 'TRP', 'غرفة تريبل', 'Triple room', 3, 4, 1600, 2)
  returning id into v_triple;

  /* ----------------------------------------------------------- rooms -- */
  insert into public.rooms (property_id, room_type_id, number, floor)
  values
    (p_property, v_double, '101', '1'),
    (p_property, v_double, '102', '1'),
    (p_property, v_double, '103', '1'),
    (p_property, v_triple, '201', '2'),
    (p_property, v_triple, '202', '2'),
    (p_property, v_triple, '203', '2');

  /* ------------------------------------------------------ rate plans -- */
  -- Every property is born with one default plan (a trigger sees to it), so
  -- that one is adopted as the direct list rather than a second being added
  -- for `one_default_rate_plan` to refuse.
  select id into v_direct
    from public.rate_plans
   where property_id = p_property and is_default
   limit 1;

  if v_direct is null then
    insert into public.rate_plans
      (property_id, code, name, name_en, party, is_default, is_active, sort_order)
    values (p_property, 'DIR', 'حجز مباشر', 'Direct booking', 'direct', true, true, 1)
    returning id into v_direct;
  else
    update public.rate_plans
       set code = 'DIR', name = 'حجز مباشر', name_en = 'Direct booking',
           party = 'direct', sort_order = 1
     where id = v_direct;
  end if;

  insert into public.rate_plans
    (property_id, code, name, name_en, party, is_default, is_active, sort_order)
  values (p_property, 'AGY', 'أسعار الشركات', 'Agency rate', 'company', false, true, 2)
  returning id into v_company;

  insert into public.accounts (property_id, name, rate_plan_id)
  values (p_property, 'وكالة النيل للسياحة', v_company);

  /* --------------------------------------------------------- prices -- */
  -- Head count moves the price, which is the whole point of the matrix.
  insert into public.rates
    (property_id, room_type_id, rate_plan_id, occupancy, amount)
  values
    (p_property, v_double,  v_direct,  1, 1000),
    (p_property, v_double,  v_direct,  2, 1200),
    (p_property, v_double,  v_direct,  3, 1400),
    (p_property, v_triple,  v_direct,  1, 1200),
    (p_property, v_triple,  v_direct,  2, 1400),
    (p_property, v_triple,  v_direct,  3, 1600),
    (p_property, v_triple,  v_direct,  4, 1800),
    (p_property, v_double,  v_company, 1,  850),
    (p_property, v_double,  v_company, 2, 1000),
    (p_property, v_double,  v_company, 3, 1200),
    (p_property, v_triple,  v_company, 1, 1000),
    (p_property, v_triple,  v_company, 2, 1200),
    (p_property, v_triple,  v_company, 3, 1400),
    (p_property, v_triple,  v_company, 4, 1600);

  /* --------------------------------------------------------- extras -- */
  insert into public.charge_items (property_id, name, name_en, default_amount, sort_order)
  values
    (p_property, 'فطار',            'Breakfast',       150, 1),
    (p_property, 'عشاء',            'Dinner',          250, 2),
    (p_property, 'نقل من المطار',    'Airport transfer', 800, 3),
    (p_property, 'سرير إضافي',       'Extra bed',       200, 4);

  select id into v_breakfast
    from public.charge_items
   where property_id = p_property and name = 'فطار';

  -- Breakfast included on the direct list, so the "what the price covers"
  -- half of a rate plan has something to show.
  insert into public.rate_plan_addons
    (property_id, rate_plan_id, charge_item_id, pricing_basis, is_included, unit_amount, sort_order)
  values (p_property, v_direct, v_breakfast, 'per_guest_night', true, 0, 0);

  /* ------------------------------------------------- hotel's own facts -- */
  update public.properties
     set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
           'check_in_time',  coalesce(settings ->> 'check_in_time', '14:00'),
           'check_out_time', coalesce(settings ->> 'check_out_time', '12:00'),
           'auto_close_stays', coalesce(settings -> 'auto_close_stays', 'true'::jsonb)
         )
   where id = p_property;

  insert into public.activity_log
    (property_id, actor_id, entity_type, entity_id, action, payload)
  values (
    p_property, auth.uid(), 'security', p_property, 'created',
    jsonb_build_object('demo_data', true, 'rooms', 6, 'plans', 2)
  );

  return jsonb_build_object(
    'ok', true, 'room_types', 2, 'rooms', 6, 'rate_plans', 2,
    'rates', 14, 'charge_items', 4, 'accounts', 1
  );
end;
$$;

-- Signed-in users can call it; `is_platform_admin()` at the top decides
-- whether anything happens.
revoke all on function public.seed_demo_property(uuid) from public, anon;
grant execute on function public.seed_demo_property(uuid) to authenticated;
