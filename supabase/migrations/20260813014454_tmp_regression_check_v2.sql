do $$
declare
  v_prop uuid; v_room uuid; v_plan uuid; v_guest uuid; v_b uuid; v_alloc uuid;
  v_uid uuid := 'e1b95522-e72c-4bf2-9aac-1554ae85f71f';
  v_caught boolean := false; v_n int;
  d1 date := current_date + 120; d2 date := current_date + 123;
begin
  select id into v_prop from properties where slug='greek-club-dahab';
  select id into v_room from rooms where property_id=v_prop and number='102';
  select id into v_plan from rate_plans where property_id=v_prop and is_default;

  select count(*) into v_n from profiles;
  raise notice '1. profiles present: %', v_n;

  raise notice '2. reference generates: %', next_booking_reference(v_prop);

  insert into guests (property_id, full_name, phone)
  values (v_prop,'REGRESSION','+200000000009') returning id into v_guest;

  insert into bookings (property_id, reference, guest_id, status, source,
    check_in, check_out, adults, notes, created_by, rate_plan_id)
  values (v_prop, next_booking_reference(v_prop), v_guest, 'confirmed','walk_in',
    d1, d2, 2, 'REGRESSION', v_uid, v_plan) returning id into v_b;

  insert into room_allocations (property_id, room_id, booking_id, kind,
    starts_on, ends_on, occupancy, rate_per_night)
  values (v_prop, v_room, v_b, 'booking', d1, d2, 2, 500) returning id into v_alloc;
  raise notice '3. booking + allocation created';

  begin
    insert into room_allocations (property_id, room_id, kind, starts_on, ends_on, occupancy)
    values (v_prop, v_room, 'hold', d1+1, d2+1, 2);
  exception when exclusion_violation then v_caught := true;
  end;
  raise notice '4. double booking blocked (expect t): %', v_caught;

  select nights_sold into v_n from report_summary(v_prop, d1, d2);
  raise notice '5. report counts nights (expect 3): %', v_n;

  select room_revenue into v_n from report_summary(v_prop, d1, d2);
  raise notice '5b. report revenue (expect 1500): %', v_n;

  select count(*) into v_n from check_extension(v_b, d2+2);
  raise notice '6. extension check rows: %', v_n;

  select count(*) into v_n from suggest_alternative_rooms(v_alloc);
  raise notice '7. alternative rooms offered: %', v_n;

  select count(*) into v_n from today_board where property_id = v_prop;
  raise notice '8. today_board rows (expect 6): %', v_n;

  delete from room_allocations where booking_id = v_b;
  delete from bookings where id = v_b;
  delete from guests where id = v_guest;
  raise notice 'regression pass complete, test data removed';
end $$;
