-- Walk the whole booking path the app takes, as the real user, then
-- roll the test data back out.
do $$
declare
  v_prop uuid; v_guest uuid; v_room uuid; v_plan uuid; v_booking bookings;
  v_uid uuid := 'e1b95522-e72c-4bf2-9aac-1554ae85f71f';
begin
  select id into v_prop from properties where slug = 'greek-club-dahab';
  select id into v_room from rooms where property_id = v_prop and number = '105';
  select id into v_plan from rate_plans where property_id = v_prop and is_default;

  insert into guests (property_id, full_name, phone)
  values (v_prop, 'TEST GUEST', '+200000000000')
  returning id into v_guest;

  -- next_booking_reference is the call that was failing.
  raise notice 'reference generates: %', next_booking_reference(v_prop);

  insert into bookings (
    property_id, reference, guest_id, status, source,
    check_in, check_out, adults, notes, created_by, rate_plan_id
  ) values (
    v_prop, next_booking_reference(v_prop), v_guest, 'confirmed', 'walk_in',
    current_date + 30, current_date + 32, 2, 'TEST BOOKING', v_uid, v_plan
  ) returning * into v_booking;

  insert into room_allocations (
    property_id, room_id, booking_id, kind, starts_on, ends_on, occupancy
  ) values (
    v_prop, v_room, v_booking.id, 'booking', current_date + 30, current_date + 32, 2
  );

  raise notice 'booking created: %', v_booking.reference;

  -- clean up
  delete from room_allocations where booking_id = v_booking.id;
  delete from bookings where id = v_booking.id;
  delete from guests where id = v_guest;

  raise notice 'test data removed';
end $$;
