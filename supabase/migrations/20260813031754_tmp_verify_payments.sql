-- The balance must follow the receipts automatically, including refunds.
do $$
declare
  v_prop uuid; v_room uuid; v_plan uuid; v_guest uuid; v_b uuid;
  v_uid uuid := 'e1b95522-e72c-4bf2-9aac-1554ae85f71f';
  v_paid numeric; v_total numeric;
  d1 date := current_date + 200; d2 date := current_date + 202;
begin
  select id into v_prop from properties where slug='greek-club-dahab';
  select id into v_room from rooms where property_id=v_prop and number='103';
  select id into v_plan from rate_plans where property_id=v_prop and is_default;

  insert into guests (property_id, full_name) values (v_prop,'PAY TEST') returning id into v_guest;
  insert into bookings (property_id, reference, guest_id, status, source,
    check_in, check_out, adults, total_amount, notes, created_by, rate_plan_id)
  values (v_prop, next_booking_reference(v_prop), v_guest, 'confirmed','walk_in',
    d1, d2, 2, 1000, 'PAY TEST', v_uid, v_plan) returning id into v_b;

  select paid_amount into v_paid from bookings where id=v_b;
  raise notice '1. paid before any payment (expect 0): %', v_paid;

  insert into payments (property_id, booking_id, amount, method, received_by)
  values (v_prop, v_b, 400, 'cash', v_uid);
  select paid_amount into v_paid from bookings where id=v_b;
  raise notice '2. after 400 deposit (expect 400): %', v_paid;

  insert into payments (property_id, booking_id, amount, method, received_by)
  values (v_prop, v_b, 600, 'instapay', v_uid);
  select paid_amount, total_amount into v_paid, v_total from bookings where id=v_b;
  raise notice '3. after 600 more (expect 1000 of 1000): % of %', v_paid, v_total;

  -- A refund is a negative row, never an edit: the trail stays intact.
  insert into payments (property_id, booking_id, amount, method, notes, received_by)
  values (v_prop, v_b, -250, 'cash', 'استرداد', v_uid);
  select paid_amount into v_paid from bookings where id=v_b;
  raise notice '4. after 250 refund (expect 750): %', v_paid;

  raise notice '5. payment rows kept (expect 3): %',
    (select count(*) from payments where booking_id=v_b);

  delete from payments where booking_id=v_b;
  delete from bookings where id=v_b;
  delete from guests where id=v_guest;
  raise notice 'cleaned up';
end $$;
