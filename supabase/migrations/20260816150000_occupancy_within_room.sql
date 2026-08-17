-- A room cannot hold more people than it holds.
--
-- create_booking has always checked this, and until now it was the only way
-- an allocation was ever written. Reception can now correct a head count on
-- a booking that is already taken — "we said two and three turned up" — and
-- that writes room_allocations.occupancy directly through the row policy,
-- which does not know what a room type is.
--
-- A check constraint cannot see another table, so it is a trigger. Written
-- as a guard rather than as a clamp on purpose: silently seating four in a
-- two-bed room is worse than refusing, because nobody would find out until
-- the guests arrived.
--
-- Non-booking allocations are exempt. Maintenance and holds carry an
-- occupancy nobody set and nobody reads.

create or replace function public.check_occupancy_fits_room()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max int;
  v_number text;
begin
  if new.kind <> 'booking' then return new; end if;
  if new.occupancy is null then return new; end if;

  if new.occupancy < 1 then
    raise exception 'الغرفة لازم يكون فيها فرد واحد على الأقل';
  end if;

  select rt.max_occupancy, r.number into v_max, v_number
  from rooms r join room_types rt on rt.id = r.room_type_id
  where r.id = new.room_id;

  if v_max is not null and new.occupancy > v_max then
    raise exception 'غرفة % تاخد % فرد على الأكثر، والمطلوب %',
      v_number, v_max, new.occupancy;
  end if;

  return new;
end;
$$;

revoke all on function public.check_occupancy_fits_room() from public, anon, authenticated;

drop trigger if exists trg_occupancy_fits_room on public.room_allocations;
create trigger trg_occupancy_fits_room
  before insert or update of occupancy, room_id
  on public.room_allocations
  for each row execute function public.check_occupancy_fits_room();
