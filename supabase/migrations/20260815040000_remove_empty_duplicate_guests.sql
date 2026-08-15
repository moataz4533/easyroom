-- Ten guest rows that were never a guest.
--
-- Taking a booking without pressing search first used to insert a new guest
-- every time, so one phone number ended up behind twelve rows. Eleven of
-- them were somebody testing the booking screen; one of them was not.
--
-- This is not a merge, and deliberately so. Two of those rows are different
-- people who share a mobile — boles with GR26-0010 (1,600 billed, 1,000
-- paid) and moataz with GR26-0003 (2,400 billed, nothing paid). Fusing them
-- would have joined two balances into one person's, which is exactly the
-- kind of silent wrong answer a merge is dangerous for. So both are left
-- alone and only the rows carrying nothing at all are removed.
--
-- "Carrying nothing" is checked, not assumed: no booking anywhere in the
-- database points at them (bookings.guest_id is the only foreign key to
-- guests, confirmed from the catalogue) and every optional field is empty.
--
-- The cause is already fixed in the app: the booking screen now looks the
-- number up and reuses the guest on file instead of adding another row.

do $$
declare
  v_property uuid;
  v_bookings_before int;   v_bookings_after int;
  v_billed_before numeric; v_billed_after numeric;
  v_guests_before int;     v_deleted int;
begin
  select id into v_property from public.properties where slug = 'greek-club-dahab';
  if v_property is null then
    raise notice 'the hotel is not in this database; nothing to clean up';
    return;
  end if;

  select count(*), coalesce(sum(total_amount), 0)
    into v_bookings_before, v_billed_before
  from public.bookings where property_id = v_property;

  select count(*) into v_guests_before
  from public.guests where property_id = v_property;

  with removable as (
    select g.id
    from public.guests g
    where g.property_id = v_property
      and not exists (select 1 from public.bookings b where b.guest_id = g.id)
      and coalesce(nullif(btrim(g.email), ''), nullif(btrim(g.nationality), ''),
                   nullif(btrim(g.id_number), ''), nullif(btrim(g.notes), '')) is null
      and g.date_of_birth is null
  )
  delete from public.guests g using removable r where g.id = r.id;
  get diagnostics v_deleted = row_count;

  select count(*), coalesce(sum(total_amount), 0)
    into v_bookings_after, v_billed_after
  from public.bookings where property_id = v_property;

  -- Nothing was supposed to move. If a booking or a pound went with them,
  -- the rows were not empty and none of this should be committed.
  if v_bookings_after <> v_bookings_before then
    raise exception 'bookings moved from % to %', v_bookings_before, v_bookings_after;
  end if;
  if v_billed_after <> v_billed_before then
    raise exception 'the billed total moved from % to %', v_billed_before, v_billed_after;
  end if;

  raise notice 'removed % empty guest rows; guests % -> %, bookings % unchanged, billed % unchanged',
    v_deleted, v_guests_before, v_guests_before - v_deleted, v_bookings_after, v_billed_after;

  if v_deleted > 0 then
    insert into public.activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
    values (v_property, null, 'security', v_property, 'guests_cleaned',
            jsonb_build_object('removed', v_deleted,
                               'guests_before', v_guests_before,
                               'bookings', v_bookings_after,
                               'billed', v_billed_after));
  end if;
end $$;
