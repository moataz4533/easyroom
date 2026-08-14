-- Prove the double-booking guarantee, then roll the evidence away.
do $$
declare
  v_prop uuid; v_room uuid; v_caught text := 'NOT CAUGHT -- BUG';
begin
  select id into v_prop from properties where slug = 'greek-club-dahab';
  select id into v_room from rooms where property_id = v_prop and number = '101';

  -- First guest takes room 101 for three nights.
  insert into room_allocations (property_id, room_id, kind, starts_on, ends_on, occupancy, notes)
  values (v_prop, v_room, 'hold', '2026-09-10', '2026-09-13', 2, 'TEST A');

  -- Second guest tries to take the same room over an overlapping night.
  begin
    insert into room_allocations (property_id, room_id, kind, starts_on, ends_on, occupancy, notes)
    values (v_prop, v_room, 'hold', '2026-09-12', '2026-09-15', 2, 'TEST B');
  exception when exclusion_violation then
    v_caught := 'BLOCKED by database';
  end;

  raise notice 'Overlapping booking: %', v_caught;

  -- Back-to-back must still work: checkout day is free for the next guest.
  insert into room_allocations (property_id, room_id, kind, starts_on, ends_on, occupancy, notes)
  values (v_prop, v_room, 'hold', '2026-09-13', '2026-09-16', 2, 'TEST C');

  raise notice 'Back-to-back on checkout day: ALLOWED (correct)';

  delete from room_allocations where notes like 'TEST %';
end $$;
