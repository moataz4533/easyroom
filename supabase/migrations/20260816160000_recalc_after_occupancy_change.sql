-- Changing a head count has to change the bill.
--
-- Found by driving the new edit screen and then reading the row: correcting
-- a room from two guests to three repriced every night of it — 500 became
-- 650, which is right — and left bookings.total_amount exactly where it was.
-- Two answers for one stay, and the stale one is the number reception reads
-- off the screen and hands the guest. The same defect as the early-departure
-- bug in August, arriving through a new door.
--
-- Fixed in the database rather than in the screen, for the reason already
-- written down about allocation_nights: the total must follow the nights on
-- every path, not on the paths somebody remembered. create_booking,
-- shorten_stay, extend_stay and move_room all call recalc themselves; a
-- direct occupancy edit through the row policy was the one that could not.
--
-- Only ON UPDATE OF occupancy, so nothing that already recalculates does it
-- twice for no reason. recalc_booking_total touches bookings, never
-- room_allocations, so this cannot re-enter.

create or replace function public.recalc_after_occupancy_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.booking_id is not null and new.occupancy is distinct from old.occupancy then
    perform recalc_booking_total(new.booking_id);
  end if;
  return new;
end;
$$;

revoke all on function public.recalc_after_occupancy_change() from public, anon, authenticated;

-- Named to sort after trg_allocation_nights: Postgres fires triggers of the
-- same kind in name order, and the total is a sum of the nights, so the
-- nights have to be written first.
drop trigger if exists trg_recalc_after_occupancy on public.room_allocations;
create trigger trg_recalc_after_occupancy
  after update of occupancy
  on public.room_allocations
  for each row execute function public.recalc_after_occupancy_change();
