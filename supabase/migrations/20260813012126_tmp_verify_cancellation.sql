do $$
declare
  v_prop uuid; v_guest uuid; v_room uuid; v_plan uuid;
  v_b1 uuid; v_b2 uuid; v_alloc uuid;
  v_uid uuid := 'e1b95522-e72c-4bf2-9aac-1554ae85f71f';
  v_free int; v_blocked boolean := false;
  d1 date := current_date + 60;
  d2 date := current_date + 63;
begin
  select id into v_prop from properties where slug = 'greek-club-dahab';
  select id into v_room from rooms where property_id = v_prop and number = '106';
  select id into v_plan from rate_plans where property_id = v_prop and is_default;

  insert into guests (property_id, full_name, phone)
  values (v_prop, 'CANCEL TEST', '+200000000001') returning id into v_guest;

  insert into bookings (property_id, reference, guest_id, status, source,
    check_in, check_out, adults, notes, created_by, rate_plan_id)
  values (v_prop, next_booking_reference(v_prop), v_guest, 'confirmed', 'walk_in',
    d1, d2, 2, 'CANCEL TEST', v_uid, v_plan) returning id into v_b1;

  insert into room_allocations (property_id, room_id, booking_id, kind,
    starts_on, ends_on, occupancy)
  values (v_prop, v_room, v_b1, 'booking', d1, d2, 2) returning id into v_alloc;

  -- While booked, the room must not be offered.
  select count(*) into v_free from available_rooms(v_prop, d1, d2) where room_id = v_room;
  raise notice 'room 106 offered while booked (expect 0): %', v_free;

  -- A second booking on the same nights must be refused.
  begin
    insert into room_allocations (property_id, room_id, kind, starts_on, ends_on, occupancy)
    values (v_prop, v_room, 'hold', d1, d2, 2);
  exception when exclusion_violation then v_blocked := true;
  end;
  raise notice 'double booking blocked (expect t): %', v_blocked;

  -- Cancel, then it must come back for sale.
  update bookings set status = 'cancelled', cancelled_at = now(),
         cancel_reason = 'test' where id = v_b1;
  update room_allocations set released_at = now() where booking_id = v_b1;

  select count(*) into v_free from available_rooms(v_prop, d1, d2) where room_id = v_room;
  raise notice 'room 106 offered after cancel (expect 1): %', v_free;

  -- The cancelled booking must disappear from the attention queue, not
  -- linger there as something needing a fix.
  select count(*) into v_free from attention_queue where booking_id = v_b1;
  raise notice 'cancelled booking in attention queue (expect 0): %', v_free;

  delete from room_allocations where booking_id = v_b1;
  delete from bookings where id = v_b1;
  delete from guests where id = v_guest;
  raise notice 'cleaned up';
end $$;
