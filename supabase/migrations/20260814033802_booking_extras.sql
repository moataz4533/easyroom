-- Extras on the bill.
--
-- The hotel sells more than the room: breakfast, laundry, a transfer from
-- the airport, the minibar. Until now `total_amount` was the sum of the room
-- quotes and nothing else, so everything else was settled off the books.
--
-- Two tables, deliberately: a catalogue the manager controls so the same
-- breakfast costs the same on every shift, and the lines themselves. A line
-- may point at no catalogue item — the guest asks for something nobody
-- listed, and reception must not be blocked by a price list.

-- ---------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------
create table if not exists public.charge_items (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references public.properties(id) on delete cascade,
  name           text not null,
  name_en        text,
  default_amount numeric(12,2) not null default 0,
  is_active      boolean not null default true,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (default_amount >= 0),
  unique (property_id, name)
);

create index if not exists charge_items_property_idx
  on public.charge_items (property_id, sort_order) where is_active;

-- ---------------------------------------------------------------------
-- The lines
-- ---------------------------------------------------------------------
create table if not exists public.booking_charges (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references public.properties(id) on delete cascade,
  booking_id     uuid not null references public.bookings(id) on delete cascade,
  charge_item_id uuid references public.charge_items(id) on delete set null,
  description    text not null,
  quantity       numeric(10,2) not null default 1,
  unit_amount    numeric(12,2) not null,
  -- Stored rather than computed on read: the price of a breakfast in March
  -- must not change because the catalogue changed in June.
  amount         numeric(12,2) generated always as (quantity * unit_amount) stored,
  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  voided_at      timestamptz,
  void_reason    text,
  voided_by      uuid references auth.users(id) on delete set null,
  check (quantity > 0),
  check (unit_amount >= 0)
);

create index if not exists booking_charges_booking_idx
  on public.booking_charges (booking_id) where voided_at is null;
create index if not exists booking_charges_property_idx
  on public.booking_charges (property_id, created_at);

drop trigger if exists trg_charge_items_updated_at on public.charge_items;
create trigger trg_charge_items_updated_at before update on public.charge_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Isolation. Same shape as the rest: reception sells, managers price.
-- ---------------------------------------------------------------------
alter table public.charge_items    enable row level security;
alter table public.booking_charges enable row level security;

drop policy if exists charge_items_select on public.charge_items;
create policy charge_items_select on public.charge_items
  for select to authenticated using (public.is_member(property_id));

drop policy if exists charge_items_write on public.charge_items;
create policy charge_items_write on public.charge_items
  for all to authenticated
  using (public.is_admin(property_id)) with check (public.is_admin(property_id));

drop policy if exists booking_charges_select on public.booking_charges;
create policy booking_charges_select on public.booking_charges
  for select to authenticated using (public.can_manage(property_id));

-- The functions below run as the caller, so they need the same rights the
-- caller has — exactly how record_payment and the payments policies work.
drop policy if exists booking_charges_insert on public.booking_charges;
create policy booking_charges_insert on public.booking_charges
  for insert to authenticated with check (public.can_manage(property_id));

-- Voiding is an update. Deleting is not offered at all: a line that was
-- charged has to stay visible even after it turns out to be wrong.
drop policy if exists booking_charges_update on public.booking_charges;
create policy booking_charges_update on public.booking_charges
  for update to authenticated
  using (public.can_manage(property_id)) with check (public.can_manage(property_id));

drop policy if exists booking_charges_delete on public.booking_charges;
create policy booking_charges_delete on public.booking_charges
  for delete to authenticated using (false);

-- ---------------------------------------------------------------------
-- The total now includes the extras.
--
-- recalc_booking_total is the single place that writes total_amount, so
-- teaching it about charges covers every path: extending a stay, moving a
-- room, releasing one, adding a breakfast.
-- ---------------------------------------------------------------------
create or replace function public.recalc_booking_total(p_booking uuid)
returns numeric
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_total numeric := 0; v_heads int := 0; v_plan uuid; v_prop uuid;
  v_extras numeric := 0; a record;
begin
  select property_id, rate_plan_id into v_prop, v_plan from bookings where id = p_booking;

  for a in
    select ra.*, r.room_type_id from room_allocations ra
    join rooms r on r.id = ra.room_id
    where ra.booking_id = p_booking and ra.released_at is null
  loop
    v_total := v_total + quote_stay(v_prop, a.room_type_id, v_plan, a.occupancy, a.starts_on, a.ends_on);
    v_heads := v_heads + a.occupancy;
  end loop;

  select coalesce(sum(amount), 0) into v_extras
  from booking_charges
  where booking_id = p_booking and voided_at is null;

  update bookings
     set total_amount = v_total + v_extras,
         adults = greatest(v_heads, 1),
         check_in = coalesce((select min(starts_on) from room_allocations
                              where booking_id = p_booking and released_at is null), check_in),
         check_out = coalesce((select max(ends_on) from room_allocations
                               where booking_id = p_booking and released_at is null), check_out)
   where id = p_booking;

  return v_total + v_extras;
end;
$$;

create or replace function public.sync_booking_charges()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform recalc_booking_total(coalesce(new.booking_id, old.booking_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_booking_charges_sync on public.booking_charges;
create trigger trg_booking_charges_sync
  after insert or update or delete on public.booking_charges
  for each row execute function public.sync_booking_charges();

-- ---------------------------------------------------------------------
-- Adding and removing a line.
--
-- A mistake is corrected by voiding, never by deleting, exactly like a
-- payment: the record of what was charged has to survive being wrong.
-- ---------------------------------------------------------------------
create or replace function public.add_booking_charge(
  p_booking     uuid,
  p_item        uuid    default null,
  p_description text    default null,
  p_quantity    numeric default 1,
  p_amount      numeric default null,
  p_note        text    default null
)
returns public.booking_charges
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_booking bookings;
  v_item charge_items;
  v_description text;
  v_amount numeric;
  v_charge booking_charges;
begin
  select * into v_booking from bookings where id = p_booking;
  if not found then raise exception 'booking not found'; end if;
  if not can_manage(v_booking.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_booking.status in ('cancelled', 'no_show') then
    raise exception 'هذا الحجز ملغى، ولا يمكن إضافة بنود إليه';
  end if;

  if p_item is not null then
    select * into v_item from charge_items
     where id = p_item and property_id = v_booking.property_id;
    if not found then raise exception 'هذا الصنف لا يتبع هذا الفندق'; end if;
  end if;

  -- The catalogue supplies the default; an explicit price still wins, because
  -- a half portion or a haggled transfer is a real thing at the desk.
  v_description := coalesce(nullif(trim(coalesce(p_description, '')), ''), v_item.name);
  v_amount      := coalesce(p_amount, v_item.default_amount);

  if v_description is null then raise exception 'أدخل اسم الإضافة'; end if;
  if v_amount is null then raise exception 'أدخل المبلغ'; end if;
  if coalesce(p_quantity, 0) <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر'; end if;
  if v_amount < 0 then raise exception 'المبلغ لا يمكن أن يكون سالباً'; end if;

  insert into booking_charges (
    property_id, booking_id, charge_item_id, description,
    quantity, unit_amount, notes, created_by
  ) values (
    v_booking.property_id, p_booking, p_item, v_description,
    p_quantity, v_amount, p_note, auth.uid()
  ) returning * into v_charge;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (v_booking.property_id, auth.uid(), 'charge', v_charge.id, 'added',
          jsonb_build_object('booking', p_booking, 'description', v_description,
                             'quantity', p_quantity, 'amount', v_charge.amount));

  return v_charge;
end;
$$;

create or replace function public.void_booking_charge(
  p_charge uuid,
  p_reason text default null,
  p_pin    text default null
)
returns public.booking_charges
language plpgsql volatile security invoker set search_path = public as $$
declare v_charge booking_charges;
begin
  select * into v_charge from booking_charges where id = p_charge;
  if not found then raise exception 'charge not found'; end if;
  if not can_manage(v_charge.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_charge.voided_at is not null then
    raise exception 'هذا السطر ملغى بالفعل';
  end if;

  -- Removing money from a bill is a financial action, like a refund.
  perform require_action_pin(v_charge.property_id, p_pin);

  update booking_charges
     set voided_at = now(), void_reason = p_reason, voided_by = auth.uid()
   where id = p_charge returning * into v_charge;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (v_charge.property_id, auth.uid(), 'charge', v_charge.id, 'voided',
          jsonb_build_object('booking', v_charge.booking_id,
                             'description', v_charge.description,
                             'amount', v_charge.amount, 'reason', p_reason));

  return v_charge;
end;
$$;

revoke all on function public.add_booking_charge(uuid, uuid, text, numeric, numeric, text) from public, anon;
revoke all on function public.void_booking_charge(uuid, text, text) from public, anon;
revoke all on function public.sync_booking_charges() from public, anon, authenticated;
grant execute on function public.add_booking_charge(uuid, uuid, text, numeric, numeric, text) to authenticated;
grant execute on function public.void_booking_charge(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Reporting.
--
-- Extras are reported next to room revenue, never inside it. ADR and RevPAR
-- are per room-night by definition; folding a transfer to the airport into
-- them would silently make both meaningless.
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
  total_revenue    numeric
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
      coalesce(sum(a.rate_per_night), 0) as revenue,
      count(distinct a.booking_id)::bigint as bookings,
      coalesce(sum(a.occupancy), 0)::bigint as guest_nights
    from room_allocations a
    join bookings b on b.id = a.booking_id
    cross join lateral generate_series(a.starts_on, a.ends_on - 1, interval '1 day') d
    where a.property_id = p_property
      and a.kind = 'booking'
      and b.status in ('confirmed', 'checked_in', 'checked_out')
      -- Checking out releases the allocation. Without the second arm, every
      -- completed stay would drop out of revenue the moment the guest left.
      and (a.released_at is null or b.status = 'checked_out')
      and d::date >= p_from and d::date < p_to
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
  -- Counted on the day it was sold, not spread over the stay: a breakfast
  -- is consumed once.
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
    round(sold.revenue + extras.revenue, 2)
  from days, active_rooms, sold, made, money, owing, extras;
$$;

-- What sells besides the room, so the manager can see whether breakfast is
-- worth the kitchen staying open.
create or replace function public.report_extras(
  p_property uuid, p_from date, p_to date
)
returns table (description text, count bigint, quantity numeric, total numeric)
language sql stable security invoker set search_path = public as $$
  select
    coalesce(i.name, c.description) as description,
    count(*)::bigint,
    round(sum(c.quantity), 2),
    round(sum(c.amount), 2)
  from booking_charges c
  left join charge_items i on i.id = c.charge_item_id
  where c.property_id = p_property
    and c.voided_at is null
    and c.created_at >= p_from and c.created_at < p_to + 1
  group by coalesce(i.name, c.description)
  order by 4 desc;
$$;

revoke all on function public.report_summary(uuid, date, date) from public, anon;
revoke all on function public.report_extras(uuid, date, date)  from public, anon;
grant execute on function public.report_summary(uuid, date, date) to authenticated;
grant execute on function public.report_extras(uuid, date, date)  to authenticated;

-- ---------------------------------------------------------------------
-- A starting catalogue for every property that has none, so the feature is
-- usable the moment it lands. Prices are zero on purpose: the manager sets
-- them, and a wrong price is worse than an obviously empty one.
-- ---------------------------------------------------------------------
insert into public.charge_items (property_id, name, name_en, sort_order)
select p.id, item.name, item.name_en, item.sort_order
from public.properties p
cross join (values
  ('فطار',      'Breakfast',      1),
  ('غسيل',      'Laundry',        2),
  ('ترانسفير',  'Airport transfer', 3),
  ('مينى بار',  'Minibar',        4)
) as item(name, name_en, sort_order)
where not exists (
  select 1 from public.charge_items c where c.property_id = p.id
);
