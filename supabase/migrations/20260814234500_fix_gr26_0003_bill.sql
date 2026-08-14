-- One booking corrected by hand: GR26-0003.
--
-- It was checked out before check_out_booking learned to reprice, so it
-- carried the two numbers that fix exists to prevent: 16,800 on the bill and
-- 2,400 in the nights the reports read. The hotel's decision is that the
-- guest pays for the booking in full, so the total stays exactly where it
-- was — what changes is that the 14,400 is recorded as what it actually is,
-- an early-departure charge, instead of as nights nobody slept in.
--
-- Occupancy, ADR and RevPAR are all per room-night, so leaving the phantom
-- nights in place would have quietly inflated every one of them for August.
--
-- Guarded three ways so it is a no-op anywhere it should not run: on a fresh
-- database the booking does not exist, on a second application the charge is
-- already there, and if the totals already agree there is nothing to move.

do $$
declare
  v_booking uuid := 'b393a651-953d-4310-b5e2-0c55acc3e265';
  v_owner   uuid := 'e1b95522-e72c-4bf2-9aac-1554ae85f71f';
  v_before numeric; v_nights numeric; v_fee numeric; v_after numeric;
begin
  if not exists (select 1 from public.bookings where id = v_booking) then
    raise notice 'GR26-0003 is not in this database; nothing to correct';
    return;
  end if;

  if exists (
    select 1 from public.booking_charges
     where booking_id = v_booking and voided_at is null
       and description = 'رسوم مغادرة مبكرة'
  ) then
    raise notice 'GR26-0003 has already been corrected';
    return;
  end if;

  select b.total_amount,
         coalesce((select sum(an.amount)
                     from public.allocation_nights an
                     join public.room_allocations a on a.id = an.allocation_id
                    where a.booking_id = b.id and a.release_reason is null), 0)
    into v_before, v_nights
  from public.bookings b where b.id = v_booking;

  if v_before <= v_nights then
    raise notice 'GR26-0003 already adds up (% vs %)', v_before, v_nights;
    return;
  end if;

  -- Every guard on these functions is written in terms of who is calling,
  -- and the correction is the owner's decision, so it is recorded as theirs.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  v_nights := public.recalc_booking_total(v_booking);
  v_fee := v_before - v_nights;

  perform public.add_booking_charge(
    v_booking, null, 'رسوم مغادرة مبكرة', 1, v_fee,
    'الليالي المحجوزة التي لم يقم بها النزيل'
  );

  select total_amount into v_after from public.bookings where id = v_booking;
  raise notice 'GR26-0003: was %, room nights %, fee %, now %',
    v_before, v_nights, v_fee, v_after;

  -- The guest owes exactly what they owed before. If that is not true,
  -- nothing here should be committed.
  if v_after <> v_before then
    raise exception 'the guest total moved from % to %', v_before, v_after;
  end if;
end $$;
