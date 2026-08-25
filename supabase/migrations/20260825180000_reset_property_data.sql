-- Emptying one hotel's register from the platform console.
--
-- This exists because it was done once already, by hand, as a migration
-- written for one hotel and one moment (`20260815160000_clear_trial_data`).
-- A hotel handed to a new branch needs it again, and the next one after
-- that — and a delete of six tables typed fresh each time is a delete typed
-- wrong eventually.
--
-- What goes: the bookings and everything hanging off them (rooms allocated,
-- nights, payments, extras), the guests, the housekeeping tasks, the blocks
-- and maintenance on rooms, and the activity log.
--
-- What stays, deliberately: the rooms and their types, the rates and the
-- seasons, the extras catalogue, the companies, the staff accounts, the
-- manager password, and the hotel's own details. That is the setup, not the
-- trading, and re-entering it is the work this is meant to save. Every one
-- of them is counted before and checked after; a reset that touched any of
-- them raises and takes the whole thing back with it.
--
-- Three things about the shape of this, each of them a decision:
--
-- **It is one function, not six deletes from an edge function.** The edge
-- function holds the service key and speaks over PostgREST, where six
-- deletes are six requests and nothing wraps them — an interrupted reset
-- would leave a hotel with guests and no bookings. Here it is one
-- statement: it happens completely or it does not happen.
--
-- **It is gated on is_platform_admin(), and on the hotel's own code being
-- typed back.** The gate is the security. The code is for the hand: the
-- console lists hotels one under another, and the price of clicking the
-- wrong row must not be a hotel.
--
-- **A platform admin still cannot read hotel data.** That decision stands —
-- this function returns counts of what it deleted and nothing about what
-- was in it. No guest, no name, no booking. It is not a policy and it does
-- not become one; it is one named action with one effect.
create or replace function public.reset_property_data(
  p_property uuid, p_confirm text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_slug   text;
  v_before jsonb;
  v_rooms  int; v_types int; v_rates int; v_plans int; v_seasons int;
  v_items  int; v_staff int; v_secret int; v_accounts int;
begin
  if not is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select slug into v_slug from properties where id = p_property;
  if v_slug is null then
    raise exception 'الفندق مش موجود';
  end if;
  if lower(trim(coalesce(p_confirm, ''))) <> lower(v_slug) then
    raise exception 'اكتب رمز الفرع بالظبط عشان التصفير يتنفذ';
  end if;

  -- Said back to the console, so it can report what actually went.
  v_before := jsonb_build_object(
    'bookings',   (select count(*) from bookings           where property_id = p_property),
    'guests',     (select count(*) from guests             where property_id = p_property),
    'payments',   (select count(*) from payments           where property_id = p_property),
    'charges',    (select count(*) from booking_charges    where property_id = p_property),
    'tasks',      (select count(*) from housekeeping_tasks where property_id = p_property),
    'blocks',     (select count(*) from room_allocations
                    where property_id = p_property and kind <> 'booking'),
    'activity',   (select count(*) from activity_log       where property_id = p_property)
  );

  -- The setup, read before, so the checks at the bottom can prove it lived.
  select count(*) into v_rooms   from rooms            where property_id = p_property;
  select count(*) into v_types   from room_types       where property_id = p_property;
  select count(*) into v_rates   from rates            where property_id = p_property;
  select count(*) into v_plans   from rate_plans       where property_id = p_property;
  select count(*) into v_seasons from rate_seasons     where property_id = p_property;
  select count(*) into v_items   from charge_items     where property_id = p_property;
  select count(*) into v_accounts from accounts        where property_id = p_property;
  select count(*) into v_staff   from property_members where property_id = p_property;
  -- Counted rather than assumed to be one: a hotel that has not set a
  -- manager password has no row at all, and this must not invent one.
  select count(*) into v_secret  from property_secrets where property_id = p_property;

  -- Bookings cascade to room_allocations, allocation_nights, payments and
  -- booking_charges, so this one delete takes the trading history with it.
  delete from bookings where property_id = p_property;

  -- Maintenance and holds are not bookings and do not cascade with them.
  delete from room_allocations   where property_id = p_property;
  -- Everything below is already gone by cascade. It is written out anyway:
  -- a row orphaned by some future change would otherwise survive a reset
  -- silently, and deleting nothing costs nothing.
  delete from allocation_nights  where property_id = p_property;
  delete from booking_charges    where property_id = p_property;
  delete from payments           where property_id = p_property;
  -- housekeeping_tasks.booking_id is ON DELETE SET NULL, so the tasks
  -- outlive their bookings and have to go on their own.
  delete from housekeeping_tasks where property_id = p_property;
  delete from guests             where property_id = p_property;
  delete from activity_log       where property_id = p_property;

  -- Every room is free and clean on an empty register. Leaving one "dirty"
  -- from a guest who no longer exists is a task nobody can close.
  update rooms set housekeeping_status = 'clean', updated_at = now()
   where property_id = p_property;

  -- The reference counter is one sequence for the whole database, not one
  -- per hotel — the hotel's code is only the prefix on the front. So it may
  -- be rewound only when no hotel has a booking left: rewinding it while
  -- another hotel is trading would hand that hotel a number it has already
  -- used, and its own (property_id, reference) unique index would refuse
  -- the booking at the desk.
  if not exists (select 1 from bookings) then
    perform setval('booking_ref_seq', 1, false);
  end if;

  -- The setup is the thing this must not touch.
  if (select count(*) from rooms            where property_id = p_property) <> v_rooms    then raise exception 'the rooms were touched'; end if;
  if (select count(*) from room_types       where property_id = p_property) <> v_types    then raise exception 'the room types were touched'; end if;
  if (select count(*) from rates            where property_id = p_property) <> v_rates    then raise exception 'the rates were touched'; end if;
  if (select count(*) from rate_plans       where property_id = p_property) <> v_plans    then raise exception 'the rate plans were touched'; end if;
  if (select count(*) from rate_seasons     where property_id = p_property) <> v_seasons  then raise exception 'the seasons were touched'; end if;
  if (select count(*) from charge_items     where property_id = p_property) <> v_items    then raise exception 'the extras catalogue was touched'; end if;
  if (select count(*) from accounts         where property_id = p_property) <> v_accounts then raise exception 'the companies were touched'; end if;
  if (select count(*) from property_members where property_id = p_property) <> v_staff    then raise exception 'the staff accounts were touched'; end if;
  if (select count(*) from property_secrets where property_id = p_property) <> v_secret   then raise exception 'the manager password was touched'; end if;

  -- The log was emptied a moment ago, so the reset is its first entry. The
  -- hotel's own people read this screen: they are owed the record of the
  -- day their register went empty, and who did it.
  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (p_property, auth.uid(), 'security', p_property, 'data_reset',
          v_before || jsonb_build_object('by', 'platform', 'slug', v_slug));

  return jsonb_build_object('ok', true, 'slug', v_slug, 'deleted', v_before);
end;
$$;

comment on function public.reset_property_data(uuid, text) is
  'Empties one hotel''s trading data — bookings, guests, payments, extras,
   housekeeping, blocks and the activity log — and leaves its setup and its
   staff accounts exactly where they were. Platform admins only, and only
   when the hotel''s own code is typed back. One transaction: it happens
   completely or not at all.';

revoke all on function public.reset_property_data(uuid, text) from public, anon;
grant execute on function public.reset_property_data(uuid, text) to authenticated;
