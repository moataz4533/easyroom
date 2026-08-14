-- Bookings taken while the connection is down.
--
-- Dahab loses its connection often enough that reception either writes the
-- booking on paper or turns the guest away. Neither is acceptable, and the
-- offline queue could not carry a booking before now for a real reason: a
-- new guest has no id until the database gives them one, so `create_booking`
-- could not be called from a device that had never reached the database.
--
-- This is its offline twin. It takes the guest by name and phone instead of
-- by id, finds or creates them, and then hands over to `create_booking` —
-- which keeps the exclusion constraint, the pricing and the activity log in
-- exactly one place. Nothing about double-booking is relaxed: if the room
-- went to somebody else while the phone was offline, this fails, loudly,
-- and reception is told which guest to call back.
--
-- The one new hazard offline creates is a request that succeeds while its
-- answer is lost on the way home — the phone retries and the guest is booked
-- twice. So the device stamps each provisional booking with a reference of
-- its own and the function returns the existing booking instead of making a
-- second one.

alter table public.bookings add column if not exists client_ref text;

comment on column public.bookings.client_ref is
  'Reference minted by the device for a booking taken offline, so a retry after a lost response returns the same booking instead of creating a second one.';

create unique index if not exists bookings_client_ref_idx
  on public.bookings (property_id, client_ref)
  where client_ref is not null;

create or replace function public.create_provisional_booking(
  p_property uuid,
  p_client_ref text,
  p_guest_name text,
  p_guest_phone text,
  p_check_in date,
  p_check_out date,
  p_rooms jsonb,
  p_rate_plan uuid default null,
  p_source booking_source default 'phone',
  p_notes text default null
)
returns bookings
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_booking bookings;
  v_guest uuid;
  v_phone text := nullif(btrim(coalesce(p_guest_phone, '')), '');
  v_name  text := btrim(coalesce(p_guest_name, ''));
begin
  -- The same guard as create_booking, and it runs first: an offline device
  -- proves nothing about who is holding it.
  if not can_manage(p_property) then
    raise exception 'not authorised for this property' using errcode = '42501';
  end if;

  if coalesce(btrim(coalesce(p_client_ref, '')), '') = '' then
    raise exception 'a client reference is required for a provisional booking';
  end if;
  if v_name = '' then
    raise exception 'a guest name is required';
  end if;

  -- Already landed. The phone lost the answer, not the booking.
  select * into v_booking
    from bookings
   where property_id = p_property and client_ref = p_client_ref;
  if found then
    return v_booking;
  end if;

  -- A phone number is the only thing reception holds that recognises the
  -- same person twice, so a returning guest keeps their history instead of
  -- becoming a second record.
  if v_phone is not null then
    select id into v_guest
      from guests
     where property_id = p_property and phone = v_phone
     order by created_at
     limit 1;
  end if;

  if v_guest is null then
    insert into guests (property_id, full_name, phone)
    values (p_property, v_name, v_phone)
    returning id into v_guest;
  end if;

  v_booking := create_booking(
    p_property, v_guest, p_check_in, p_check_out, p_rooms,
    p_rate_plan, null, p_source, p_notes
  );

  update bookings set client_ref = p_client_ref
   where id = v_booking.id
   returning * into v_booking;

  return v_booking;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default, so this has to be stripped
-- before it is handed back deliberately — the same treatment every other
-- booking function gets.
revoke all on function public.create_provisional_booking(
  uuid, text, text, text, date, date, jsonb, uuid, booking_source, text
) from public, anon;

grant execute on function public.create_provisional_booking(
  uuid, text, text, text, date, date, jsonb, uuid, booking_source, text
) to authenticated;
