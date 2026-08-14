-- price = f(room_type, occupancy, rate_plan, date)
create table rate_plans (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  code        text not null,
  name        text not null,
  description text,
  is_default  boolean not null default false,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (property_id, code)
);

create unique index one_default_rate_plan on rate_plans (property_id) where is_default;

-- Companies and agencies carry their own rate plan, so reception never
-- has to remember which company gets which price.
create table accounts (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references properties(id) on delete cascade,
  name          text not null,
  rate_plan_id  uuid references rate_plans(id) on delete set null,
  contact_name  text,
  contact_phone text,
  contact_email text,
  tax_id        text,
  credit_terms  text,
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (property_id, name)
);

create index on accounts (property_id) where is_active;

-- valid_from/valid_to null = the standing rate. Dated rows override it,
-- so seasonal pricing is a data change later, not a migration.
create table rates (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references properties(id) on delete cascade,
  room_type_id uuid not null references room_types(id) on delete cascade,
  rate_plan_id uuid not null references rate_plans(id) on delete cascade,
  occupancy    int  not null,
  amount       numeric(12,2) not null,
  currency     text not null default 'EGP',
  valid_from   date,
  valid_to     date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (occupancy between 1 and 12),
  check (amount >= 0),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create unique index rates_unique_combo
  on rates (property_id, room_type_id, rate_plan_id, occupancy, valid_from)
  nulls not distinct;

create index on rates (property_id, room_type_id, rate_plan_id, occupancy);

alter table bookings
  add column rate_plan_id uuid references rate_plans(id) on delete set null,
  add column account_id   uuid references accounts(id)   on delete set null;

create index on bookings (account_id);

-- Occupancy belongs on the ALLOCATION: a family in two rooms might put
-- three in one and two in the other, each priced on its own headcount.
alter table room_allocations
  add column occupancy int not null default 2,
  add constraint allocation_occupancy_sane check (occupancy between 1 and 12);

alter table rate_plans enable row level security;
alter table accounts   enable row level security;
alter table rates      enable row level security;

create policy rate_plans_select on rate_plans for select using (is_member(property_id));
create policy rate_plans_write on rate_plans for all
  using (is_admin(property_id)) with check (is_admin(property_id));

create policy accounts_select on accounts for select using (is_member(property_id));
create policy accounts_write on accounts for all
  using (can_manage(property_id)) with check (can_manage(property_id));

-- Reception reads prices to quote them; only managers set them.
create policy rates_select on rates for select using (is_member(property_id));
create policy rates_write on rates for all
  using (is_admin(property_id)) with check (is_admin(property_id));

create trigger trg_rate_plans_updated_at before update on rate_plans
  for each row execute function set_updated_at();
create trigger trg_accounts_updated_at before update on accounts
  for each row execute function set_updated_at();
create trigger trg_rates_updated_at before update on rates
  for each row execute function set_updated_at();

-- The single place that answers "how much?". Falls back to base_rate
-- rather than failing, so reception is never blocked mid-booking.
create or replace function resolve_rate(
  p_property uuid, p_room_type uuid, p_rate_plan uuid,
  p_occupancy int, p_date date default current_date
)
returns numeric
language sql stable security invoker set search_path = public as $$
  select coalesce(
    (
      select r.amount from rates r
      where r.property_id = p_property
        and r.room_type_id = p_room_type
        and r.rate_plan_id = p_rate_plan
        and r.occupancy = p_occupancy
        and (r.valid_from is null or r.valid_from <= p_date)
        and (r.valid_to is null or r.valid_to >= p_date)
      order by (r.valid_from is not null) desc, r.valid_from desc nulls last
      limit 1
    ),
    (select rt.base_rate from room_types rt where rt.id = p_room_type),
    0
  );
$$;

-- Priced night by night, so a season boundary mid-stay is charged right.
create or replace function quote_stay(
  p_property uuid, p_room_type uuid, p_rate_plan uuid,
  p_occupancy int, p_check_in date, p_check_out date
)
returns numeric
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(resolve_rate(p_property, p_room_type, p_rate_plan, p_occupancy, d::date)), 0)
  from generate_series(p_check_in, p_check_out - 1, interval '1 day') d;
$$;

create or replace function create_booking(
  p_property uuid, p_guest_id uuid, p_check_in date, p_check_out date,
  p_rooms jsonb, p_rate_plan uuid default null, p_account_id uuid default null,
  p_source booking_source default 'walk_in', p_notes text default null
)
returns bookings
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_booking bookings; v_item jsonb; v_room uuid; v_occ int;
  v_type uuid; v_max_occ int; v_plan uuid;
  v_nights int := p_check_out - p_check_in;
  v_line numeric; v_total numeric := 0; v_heads int := 0;
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
    v_room := (v_item ->> 'room_id')::uuid;
    v_occ  := coalesce((v_item ->> 'occupancy')::int, 2);

    select r.room_type_id, rt.max_occupancy into v_type, v_max_occ
    from rooms r join room_types rt on rt.id = r.room_type_id
    where r.id = v_room and r.property_id = p_property;

    if v_type is null then
      raise exception 'room % does not belong to this property', v_room;
    end if;
    if v_occ > v_max_occ then
      raise exception 'room % takes at most % guests, % requested', v_room, v_max_occ, v_occ;
    end if;

    v_line := quote_stay(p_property, v_type, v_plan, v_occ, p_check_in, p_check_out);

    insert into room_allocations (
      property_id, room_id, booking_id, kind, starts_on, ends_on, occupancy, rate_per_night
    ) values (
      p_property, v_room, v_booking.id, 'booking', p_check_in, p_check_out,
      v_occ, case when v_nights > 0 then v_line / v_nights else v_line end
    );

    v_total := v_total + v_line;
    v_heads := v_heads + v_occ;
  end loop;

  update bookings set total_amount = v_total, adults = v_heads
   where id = v_booking.id returning * into v_booking;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (p_property, auth.uid(), 'booking', v_booking.id, 'created',
          jsonb_build_object('reference', v_booking.reference, 'rooms', p_rooms,
                             'rate_plan', v_plan, 'total', v_total));

  return v_booking;
end;
$$;
