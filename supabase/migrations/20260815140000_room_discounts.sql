-- Giving somebody a discount.
--
-- The rates table answers "what does this room cost", and it answers it for
-- everybody. There was no way to say "this guest pays less" without editing
-- the price the whole hotel is sold at — which is a different sentence, and
-- the one nobody wants to say twice a week.
--
-- Three shapes, because a small hotel uses all three:
--   percent — «خصم ١٠٪», the one that survives a season change
--   amount  — «اخصم ٥٠ ج على الليلة»
--   rate    — «اعملها له بـ٤٠٠», a price named outright
--
-- Where it lives matters. A discount is NOT a negative extra: extras are
-- reported beside room revenue and never inside it, so a discount booked as
-- an extra would leave ADR and RevPAR quoting a price nobody paid. It
-- belongs on the allocation, so every night of that room is sold at the
-- discounted figure and every report that reads the nights is right without
-- knowing the feature exists.
--
-- What was given away is kept too. `allocation_nights.list_amount` is the
-- price before the discount, so the month can answer "how much did we
-- discount" — the question an owner asks about a month, not about a booking.

-- ---------------------------------------------------------------------
-- The columns.
-- ---------------------------------------------------------------------
alter table public.room_allocations
  add column if not exists discount_kind   text,
  add column if not exists discount_value  numeric(12,2),
  add column if not exists discount_note   text,
  -- Derived, never typed: the money actually taken off this room, summed
  -- from the nights. Stored so the bill can print it without re-deriving a
  -- percentage and landing a piastre away from the total.
  add column if not exists discount_amount numeric(12,2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'room_allocations_discount_shape'
  ) then
    alter table public.room_allocations add constraint room_allocations_discount_shape
      check (
        (discount_kind is null and discount_value is null)
        or (discount_kind in ('percent', 'amount', 'rate')
            and discount_value is not null and discount_value >= 0
            and (discount_kind <> 'percent' or discount_value <= 100))
      );
  end if;
end $$;

comment on column public.room_allocations.discount_amount is
  'Derived from allocation_nights by write_allocation_nights. Never write it by hand.';

alter table public.allocation_nights
  add column if not exists list_amount numeric(12,2) not null default 0;

-- Every night sold before discounts existed was sold at its list price.
update public.allocation_nights set list_amount = amount where list_amount = 0;

comment on column public.allocation_nights.list_amount is
  'What the night would have cost with no discount. amount is what was charged.';

-- ---------------------------------------------------------------------
-- Pricing one night.
--
-- A single expression so the database and the screen cannot drift: lib/
-- discount.js is its twin, and tests/discount.test.js holds them to the
-- same answers.
-- ---------------------------------------------------------------------
create or replace function public.discounted_rate(
  p_list numeric, p_kind text, p_value numeric
)
returns numeric
language sql immutable set search_path = public as $$
  select greatest(round(
    case
      when p_kind is null or p_value is null then coalesce(p_list, 0)
      when p_kind = 'percent' then coalesce(p_list, 0) * (100 - p_value) / 100
      when p_kind = 'amount'  then coalesce(p_list, 0) - p_value
      when p_kind = 'rate'    then p_value
      else coalesce(p_list, 0)
    end, 2), 0);
$$;

grant execute on function public.discounted_rate(numeric, text, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- Writing the nights, now with the discount applied.
--
-- Also brings rate_per_night back in step. It is the stay average and the
-- bill reads it, so leaving it at the undiscounted figure would hand the
-- guest a bill that disagrees with the total printed at the bottom of it.
-- ---------------------------------------------------------------------
create or replace function public.write_allocation_nights(p_allocation uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_allocation room_allocations;
  v_type uuid;
  v_plan uuid;
  v_nights int;
  v_net numeric;
  v_list numeric;
begin
  select * into v_allocation from room_allocations where id = p_allocation;
  if not found then return; end if;

  delete from allocation_nights where allocation_id = p_allocation;

  -- Maintenance and holds have no price; they block a room, they do not sell it.
  if v_allocation.kind <> 'booking' then return; end if;

  select r.room_type_id into v_type from rooms r where r.id = v_allocation.room_id;
  select b.rate_plan_id into v_plan from bookings b where b.id = v_allocation.booking_id;

  insert into allocation_nights (allocation_id, property_id, booking_id, night,
                                 amount, list_amount)
  select p_allocation, v_allocation.property_id, v_allocation.booking_id, d.night,
         discounted_rate(d.list, v_allocation.discount_kind, v_allocation.discount_value),
         d.list
  from (
    select g::date as night,
           resolve_rate(v_allocation.property_id, v_type, v_plan,
                        v_allocation.occupancy, g::date) as list
    from generate_series(v_allocation.starts_on, v_allocation.ends_on - 1, interval '1 day') g
  ) d;

  select count(*), coalesce(sum(amount), 0), coalesce(sum(list_amount), 0)
    into v_nights, v_net, v_list
  from allocation_nights where allocation_id = p_allocation;

  -- Safe against recursion: the trigger below fires on a named set of
  -- columns, and neither of these two is in it.
  update room_allocations
     set rate_per_night  = case when v_nights > 0 then round(v_net / v_nights, 2) else 0 end,
         discount_amount = round(v_list - v_net, 2)
   where id = p_allocation;
end;
$$;

revoke all on function public.write_allocation_nights(uuid) from public, anon, authenticated;

-- A changed discount has to rewrite the nights like a changed date does.
drop trigger if exists trg_allocation_nights on public.room_allocations;
create trigger trg_allocation_nights
  after insert or update of starts_on, ends_on, occupancy, room_id,
                            discount_kind, discount_value
  on public.room_allocations
  for each row execute function public.sync_allocation_nights();

-- ---------------------------------------------------------------------
-- Setting one.
--
-- PIN-gated, like every other action that moves money off a bill. Reception
-- deciding on its own what a room costs is the thing a hotel system is
-- supposed to prevent, and the manager password is where that line already
-- sits in this app.
-- ---------------------------------------------------------------------
create or replace function public.set_allocation_discount(
  p_allocation uuid,
  p_kind       text default null,
  p_value      numeric default null,
  p_note       text default null,
  p_pin        text default null
)
returns numeric
language plpgsql volatile security invoker set search_path = public, auth as $$
declare
  v_alloc  room_allocations;
  v_status booking_status;
  v_kind   text := nullif(trim(coalesce(p_kind, '')), '');
begin
  select * into v_alloc from room_allocations where id = p_allocation;
  if not found then raise exception 'الغرفة غير موجودة في هذا الحجز'; end if;

  if not can_manage(v_alloc.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_alloc.kind <> 'booking' then
    raise exception 'الخصم يكون على غرفة محجوزة فقط';
  end if;
  if v_alloc.release_reason is not null then
    raise exception 'هذه الغرفة خرجت من الحجز، لا خصم عليها';
  end if;

  select status into v_status from bookings where id = v_alloc.booking_id;
  if v_status in ('cancelled', 'no_show') then
    raise exception 'الحجز ملغى، لا يمكن تعديل أسعاره';
  end if;

  -- Said in full rather than left to the check constraint, because the
  -- constraint's message is unreadable at the desk.
  if v_kind is not null then
    if v_kind not in ('percent', 'amount', 'rate') then
      raise exception 'نوع الخصم غير معروف';
    end if;
    if p_value is null or p_value < 0 then
      raise exception 'أدخل قيمة الخصم';
    end if;
    if v_kind = 'percent' and p_value > 100 then
      raise exception 'النسبة لا تزيد عن ١٠٠٪';
    end if;
  end if;

  perform require_action_pin(v_alloc.property_id, p_pin);

  update room_allocations
     set discount_kind  = v_kind,
         discount_value = case when v_kind is null then null else p_value end,
         discount_note  = case when v_kind is null then null
                               else nullif(trim(coalesce(p_note, '')), '') end,
         updated_at     = now()
   where id = p_allocation;

  -- The trigger has rewritten the nights by now, so this reads the truth.
  select * into v_alloc from room_allocations where id = p_allocation;
  perform recalc_booking_total(v_alloc.booking_id);

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (v_alloc.property_id, auth.uid(), 'booking', v_alloc.booking_id,
          case when v_kind is null then 'discount_cleared' else 'discount_set' end,
          jsonb_build_object('allocation', p_allocation, 'kind', v_kind,
                             'value', p_value, 'note', p_note,
                             'amount', v_alloc.discount_amount));

  return v_alloc.discount_amount;
end;
$$;

revoke all on function public.set_allocation_discount(uuid, text, numeric, text, text)
  from public, anon;
grant execute on function public.set_allocation_discount(uuid, text, numeric, text, text)
  to authenticated;

-- ---------------------------------------------------------------------
-- Taking the booking with the discount already on it.
--
-- Reception quotes the discounted price on the phone; the booking has to be
-- created at that price, not created at list and corrected afterwards.
--
-- The total is no longer added up here at all. It comes from
-- recalc_booking_total, which reads allocation_nights — the one place that
-- knows what each night was actually sold for.
-- ---------------------------------------------------------------------
create or replace function public.create_booking(
  p_property uuid, p_guest_id uuid, p_check_in date, p_check_out date,
  p_rooms jsonb, p_rate_plan uuid default null, p_account_id uuid default null,
  p_source booking_source default 'walk_in', p_notes text default null
)
returns bookings
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_booking bookings; v_item jsonb; v_room uuid; v_occ int;
  v_type uuid; v_max_occ int; v_plan uuid;
  v_kind text; v_value numeric;
begin
  if not can_manage(p_property) then
    raise exception 'not authorised for this property' using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(p_rooms, '[]'::jsonb)) = 0 then
    raise exception 'at least one room is required';
  end if;

  -- Explicit choice > the account's contracted plan > the default.
  v_plan := coalesce(
    p_rate_plan,
    (select rate_plan_id from accounts where id = p_account_id),
    (select id from rate_plans where property_id = p_property and is_default limit 1)
  );
  if v_plan is null then
    raise exception 'no rate plan configured for this property';
  end if;

  insert into bookings (
    property_id, reference, guest_id, status, source,
    check_in, check_out, adults, children, notes, created_by,
    rate_plan_id, account_id
  ) values (
    p_property, next_booking_reference(p_property), p_guest_id, 'confirmed', p_source,
    p_check_in, p_check_out, 1, 0, p_notes, auth.uid(), v_plan, p_account_id
  ) returning * into v_booking;

  for v_item in select * from jsonb_array_elements(p_rooms) loop
    v_room  := (v_item ->> 'room_id')::uuid;
    v_occ   := coalesce((v_item ->> 'occupancy')::int, 2);
    v_kind  := nullif(trim(coalesce(v_item ->> 'discount_kind', '')), '');
    v_value := case when v_kind is null then null
                    else (v_item ->> 'discount_value')::numeric end;

    select r.room_type_id, rt.max_occupancy into v_type, v_max_occ
    from rooms r join room_types rt on rt.id = r.room_type_id
    where r.id = v_room and r.property_id = p_property;

    if v_type is null then
      raise exception 'room % does not belong to this property', v_room;
    end if;
    if v_occ > v_max_occ then
      raise exception 'room % takes at most % guests, % requested', v_room, v_max_occ, v_occ;
    end if;
    if v_kind is not null then
      if v_kind not in ('percent', 'amount', 'rate') then
        raise exception 'نوع الخصم غير معروف';
      end if;
      if v_value is null or v_value < 0 then
        raise exception 'أدخل قيمة الخصم';
      end if;
      if v_kind = 'percent' and v_value > 100 then
        raise exception 'النسبة لا تزيد عن ١٠٠٪';
      end if;
    end if;

    -- rate_per_night is left to the trigger, which prices the stay night by
    -- night and then averages it. Seeding it here would only be the same sum
    -- computed a second way, and that is how the two got to disagree.
    insert into room_allocations (
      property_id, room_id, booking_id, kind, starts_on, ends_on, occupancy,
      discount_kind, discount_value, discount_note
    ) values (
      p_property, v_room, v_booking.id, 'booking', p_check_in, p_check_out, v_occ,
      v_kind, v_value,
      case when v_kind is null then null
           else nullif(trim(coalesce(v_item ->> 'discount_note', '')), '') end
    );
  end loop;

  perform recalc_booking_total(v_booking.id);
  select * into v_booking from bookings where id = v_booking.id;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (p_property, auth.uid(), 'booking', v_booking.id, 'created',
          jsonb_build_object('reference', v_booking.reference, 'rooms', p_rooms,
                             'rate_plan', v_plan, 'total', v_booking.total_amount));

  return v_booking;
end;
$$;

revoke all on function public.create_booking(uuid, uuid, date, date, jsonb, uuid, uuid, booking_source, text)
  from public, anon;
grant execute on function public.create_booking(uuid, uuid, date, date, jsonb, uuid, uuid, booking_source, text)
  to authenticated;

-- ---------------------------------------------------------------------
-- Reporting what was given away.
--
-- room_revenue stays net — it is what the hotel earned, and ADR and RevPAR
-- have to be built from money that actually arrived. The discount sits
-- beside it as its own figure, per night like everything else, so a month
-- that straddles a stay splits it correctly.
-- ---------------------------------------------------------------------
drop function if exists public.report_summary(uuid, date, date);
create function public.report_summary(
  p_property uuid, p_from date, p_to date
)
returns table (
  nights_sold      bigint,
  nights_available bigint,
  occupancy_pct    numeric,
  room_revenue     numeric,
  adr              numeric,
  revpar           numeric,
  bookings_made    bigint,
  guests_hosted    bigint,
  cancellations    bigint,
  no_shows         bigint,
  collected        numeric,
  outstanding      numeric,
  extras_revenue   numeric,
  total_revenue    numeric,
  discounts        numeric
)
language sql stable security invoker set search_path = public as $$
  with days as (
    select count(*)::numeric as n from generate_series(p_from, p_to - 1, interval '1 day')
  ),
  active_rooms as (
    select count(*)::numeric as n from rooms
    where property_id = p_property and is_active
  ),
  sold as (
    select
      count(*)::bigint as nights,
      coalesce(sum(an.amount), 0) as revenue,
      coalesce(sum(an.list_amount - an.amount), 0) as given_away,
      count(distinct an.booking_id)::bigint as bookings,
      coalesce(sum(a.occupancy), 0)::bigint as guest_nights
    from allocation_nights an
    join room_allocations a on a.id = an.allocation_id
    join bookings b on b.id = an.booking_id
    where an.property_id = p_property
      and a.kind = 'booking'
      and b.status in ('confirmed', 'checked_in', 'checked_out')
      and (a.released_at is null or b.status = 'checked_out')
      and an.night >= p_from and an.night < p_to
  ),
  made as (
    select
      count(*) filter (where status = 'cancelled')::bigint as cancelled,
      count(*) filter (where status = 'no_show')::bigint   as no_show
    from bookings
    where property_id = p_property
      and check_in >= p_from and check_in < p_to
  ),
  money as (
    select coalesce(sum(amount), 0) as paid
    from payments
    where property_id = p_property
      and received_at >= p_from and received_at < p_to + 1
  ),
  owing as (
    select coalesce(sum(total_amount - paid_amount), 0) as owed
    from bookings
    where property_id = p_property
      and status in ('confirmed', 'checked_in', 'checked_out')
      and total_amount > paid_amount
      and check_in >= p_from and check_in < p_to
  ),
  extras as (
    select coalesce(sum(c.amount), 0) as revenue
    from booking_charges c
    join bookings b on b.id = c.booking_id
    where c.property_id = p_property
      and c.voided_at is null
      and b.status in ('confirmed', 'checked_in', 'checked_out')
      and c.created_at >= p_from and c.created_at < p_to + 1
  )
  select
    sold.nights,
    (days.n * active_rooms.n)::bigint,
    case when days.n * active_rooms.n > 0
      then round(100.0 * sold.nights / (days.n * active_rooms.n), 1) else 0 end,
    round(sold.revenue, 2),
    case when sold.nights > 0 then round(sold.revenue / sold.nights, 2) else 0 end,
    case when days.n * active_rooms.n > 0
      then round(sold.revenue / (days.n * active_rooms.n), 2) else 0 end,
    sold.bookings,
    sold.guest_nights,
    made.cancelled,
    made.no_show,
    round(money.paid, 2),
    round(owing.owed, 2),
    round(extras.revenue, 2),
    round(sold.revenue + extras.revenue, 2),
    round(sold.given_away, 2)
  from days, active_rooms, sold, made, money, owing, extras;
$$;

revoke all on function public.report_summary(uuid, date, date) from public, anon;
grant execute on function public.report_summary(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Existing stays keep their prices.
--
-- Everything above is additive: no allocation has a discount, so every
-- night's list_amount equals its amount and every total is unchanged. The
-- backfill below only brings discount_amount and rate_per_night into step
-- for rows written before this migration, and both come out where they were.
-- ---------------------------------------------------------------------
update public.room_allocations a
   set discount_amount = 0
 where a.discount_amount is distinct from 0
   and a.discount_kind is null;
