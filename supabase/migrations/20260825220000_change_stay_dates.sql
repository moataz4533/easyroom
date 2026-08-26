-- Changing the dates of a booking that already exists.
--
-- The database has been able to do this since the first week: `extend_stay`
-- lengthens a stay and refuses when the room is taken after it, and
-- `shorten_stay` brings the departure forward. What was missing was
-- anywhere to call them from. `extend_stay` is reachable from exactly one
-- place — the room sheet on the today screen — which works only for a guest
-- already standing in the room, and `shorten_stay` only through the
-- early-departure form.
--
-- So reception did the only thing left: took a second booking for the
-- longer dates and cancelled one of them. Four times in the week of
-- 18 August, in the live database, always the same shape — same guest, same
-- arrival, later departure:
--
--   محمود عفيفي      GR26-0015 24→25 (خرج)   GR26-0035 24→27 (ملغي)
--   محمد عبدالحميد    GR26-0030 24→25 (خرج)   GR26-0034 24→28 (ملغي)
--   نور تامر محسن     GR26-0028 24→25 (خرج)   GR26-0041 25→28 (ملغي)
--   دنيا العمروسي     GR26-0025 21→22 (خرج)   GR26-0026 21→24 (قائم)
--
-- The last one is the reason this matters beyond tidiness: both bookings
-- are still live, so a room is held twice for one guest.
--
-- This is one function rather than a screen calling two, because a stay
-- whose arrival AND departure both move would otherwise be two writes with
-- nothing wrapping them — and the half-moved booking in between is exactly
-- the state the exclusion constraint would then refuse, leaving the stay
-- somewhere neither reception nor the guest asked for.
--
-- `extend_stay` and `shorten_stay` are left exactly as they are. They are
-- tested, they are called from screens that work, and this does not need
-- them to change.
create or replace function public.set_stay_dates(
  p_booking uuid, p_check_in date, p_check_out date, p_pin text default null
)
returns bookings
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_booking bookings;
  v_blocker record;
  v_shorter boolean;
begin
  select * into v_booking from bookings where id = p_booking;
  if not found then raise exception 'booking not found'; end if;
  if not can_manage(v_booking.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_booking.status not in ('confirmed', 'checked_in') then
    raise exception 'مينفعش تغيّر تواريخ حجز حالته %', v_booking.status;
  end if;
  if p_check_in is null or p_check_out is null then
    raise exception 'التاريخين مطلوبين';
  end if;
  if p_check_out <= p_check_in then
    raise exception 'الخروج لازم يكون بعد الدخول';
  end if;
  if p_check_in = v_booking.check_in and p_check_out = v_booking.check_out then
    raise exception 'التواريخ زي ما هي';
  end if;

  -- A guest who is already in the room did not arrive on a different day.
  if v_booking.status = 'checked_in' and p_check_in <> v_booking.check_in then
    raise exception 'النزيل ساكن بالفعل — تاريخ الدخول مايتغيرش';
  end if;

  -- Shortening takes money off the bill, so it asks for the manager
  -- password exactly like shorten_stay does. Lengthening does not: it adds
  -- a night and the guest is standing there asking for it.
  v_shorter := (p_check_out - p_check_in) < (v_booking.check_out - v_booking.check_in);
  if v_shorter then
    perform require_action_pin(v_booking.property_id, p_pin);
  end if;

  -- The exclusion constraint would refuse an overlap anyway, but it refuses
  -- it as a constraint violation. Reception needs to be told which room and
  -- by whom, which is what check_extension does for the other direction.
  select r.number as room_number, c.starts_on as blocked_from,
         case when c.kind = 'booking' then coalesce(b2.reference, 'حجز آخر')
              else 'صيانة' end as blocked_by
    into v_blocker
  from room_allocations a
  join rooms r on r.id = a.room_id
  join room_allocations c
    on c.room_id = a.room_id and c.id <> a.id and c.released_at is null
   and c.stay && daterange(p_check_in, p_check_out, '[)')
  left join bookings b2 on b2.id = c.booking_id
  where a.booking_id = p_booking and a.released_at is null
  order by c.starts_on
  limit 1;

  if found then
    raise exception 'الغرفة % محجوزة من % (%). غيّر التواريخ أو انقل الغرفة.',
      v_blocker.room_number, v_blocker.blocked_from, v_blocker.blocked_by
      using errcode = 'P0001';
  end if;

  -- Every room of the booking moves together. A group split across two
  -- stretches of the calendar is not what anybody asked for, and it is what
  -- "change the dates" would quietly produce if the rooms were free to
  -- disagree.
  update room_allocations
     set starts_on = p_check_in, ends_on = p_check_out
   where booking_id = p_booking and released_at is null;

  perform recalc_booking_total(p_booking);

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (v_booking.property_id, auth.uid(), 'booking', p_booking, 'dates_changed',
          jsonb_build_object(
            'from_check_in',  v_booking.check_in,  'to_check_in',  p_check_in,
            'from_check_out', v_booking.check_out, 'to_check_out', p_check_out));

  select * into v_booking from bookings where id = p_booking;
  return v_booking;
end;
$$;

comment on function public.set_stay_dates(uuid, date, date, text) is
  'Moves a booking''s arrival and departure together, every room with it.
   Refuses with the blocking room named rather than as a constraint
   violation. Asks for the manager password only when the stay gets
   shorter, because that is the direction money comes off the bill.';

revoke all on function public.set_stay_dates(uuid, date, date, text) from public, anon;
grant execute on function public.set_stay_dates(uuid, date, date, text) to authenticated;
