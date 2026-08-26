-- Flexible rate plans and durable reservation-proof details.
--
-- A rate plan may now carry services such as breakfast or dinner.  A service
-- can be included in the room price or charged on top, and its quantity can
-- follow the booking, rooms, guests, nights, room-nights, or guest-nights.
-- The chosen lines are copied onto the booking at creation time: changing a
-- plan next month must never rewrite what yesterday's guest was promised.

create table public.rate_plan_addons (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid not null references public.properties(id) on delete cascade,
  rate_plan_id    uuid not null references public.rate_plans(id) on delete cascade,
  charge_item_id  uuid not null references public.charge_items(id) on delete restrict,
  pricing_basis   text not null default 'per_guest_night',
  is_included     boolean not null default true,
  unit_amount     numeric(12,2),
  notes           text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint rate_plan_addons_basis_check check (pricing_basis in (
    'per_booking', 'per_night', 'per_room', 'per_guest',
    'per_room_night', 'per_guest_night'
  )),
  constraint rate_plan_addons_amount_check check (unit_amount is null or unit_amount >= 0),
  unique (rate_plan_id, charge_item_id)
);

create index rate_plan_addons_property_idx
  on public.rate_plan_addons (property_id, rate_plan_id, sort_order);

create trigger trg_rate_plan_addons_updated_at before update on public.rate_plan_addons
  for each row execute function public.set_updated_at();

alter table public.rate_plan_addons enable row level security;

create policy rate_plan_addons_select on public.rate_plan_addons
  for select to authenticated using (public.is_member(property_id));
create policy rate_plan_addons_write on public.rate_plan_addons
  for all to authenticated
  using (public.is_admin(property_id)) with check (public.is_admin(property_id));

-- PostgREST grants and RLS are separate gates.  Keep both explicit so a new
-- hosted project does not depend on the dashboard's default table grants.
revoke all on table public.rate_plan_addons from public, anon;
grant select, insert, update, delete on table public.rate_plan_addons to authenticated;

alter table public.booking_charges
  add column is_included boolean not null default false,
  add column pricing_basis text,
  add column source_rate_plan_id uuid references public.rate_plans(id) on delete set null,
  add column description_en text,
  add constraint booking_charges_pricing_basis_check check (
    pricing_basis is null or pricing_basis in (
      'per_booking', 'per_night', 'per_room', 'per_guest',
      'per_room_night', 'per_guest_night'
    )
  );

-- One shared calculation for the quote and the authoritative booking write.
create or replace function public.rate_plan_addon_quantity(
  p_basis text, p_rooms jsonb, p_check_in date, p_check_out date
)
returns numeric
language plpgsql immutable set search_path = public as $$
declare
  v_nights numeric := greatest(p_check_out - p_check_in, 0);
  v_rooms numeric := jsonb_array_length(coalesce(p_rooms, '[]'::jsonb));
  v_guests numeric;
begin
  select coalesce(sum(greatest(coalesce((x ->> 'occupancy')::numeric, 0), 0)), 0)
    into v_guests
  from jsonb_array_elements(coalesce(p_rooms, '[]'::jsonb)) x;

  return case p_basis
    when 'per_booking' then 1
    when 'per_night' then v_nights
    when 'per_room' then v_rooms
    when 'per_guest' then v_guests
    when 'per_room_night' then v_rooms * v_nights
    when 'per_guest_night' then v_guests * v_nights
    else 0
  end;
end;
$$;

revoke all on function public.rate_plan_addon_quantity(text, jsonb, date, date)
  from public, anon;
grant execute on function public.rate_plan_addon_quantity(text, jsonb, date, date)
  to authenticated;

create or replace function public.quote_rate_plan_addons(
  p_property uuid, p_rate_plan uuid, p_rooms jsonb,
  p_check_in date, p_check_out date
)
returns table (
  rate_plan_addon_id uuid,
  charge_item_id uuid,
  name text,
  name_en text,
  pricing_basis text,
  is_included boolean,
  quantity numeric,
  unit_amount numeric,
  amount numeric
)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.is_member(p_property) then
    raise exception 'not authorised for this property' using errcode = '42501';
  end if;
  if p_check_out <= p_check_in then
    raise exception 'check-out must be after check-in';
  end if;

  return query
  select
    a.id,
    a.charge_item_id,
    c.name,
    c.name_en,
    a.pricing_basis,
    a.is_included,
    public.rate_plan_addon_quantity(a.pricing_basis, p_rooms, p_check_in, p_check_out),
    case when a.is_included then 0::numeric
         else coalesce(a.unit_amount, c.default_amount) end,
    case when a.is_included then 0::numeric
         else public.rate_plan_addon_quantity(a.pricing_basis, p_rooms, p_check_in, p_check_out)
              * coalesce(a.unit_amount, c.default_amount) end
  from public.rate_plan_addons a
  join public.charge_items c on c.id = a.charge_item_id
  where a.property_id = p_property
    and a.rate_plan_id = p_rate_plan
    and c.is_active
  order by a.sort_order, c.sort_order, c.name;
end;
$$;

revoke all on function public.quote_rate_plan_addons(uuid, uuid, jsonb, date, date)
  from public, anon;
grant execute on function public.quote_rate_plan_addons(uuid, uuid, jsonb, date, date)
  to authenticated;

-- Plan and company changes are financial settings, so the same manager PIN
-- used for the rate matrix protects them.  Add-ons are replaced as one unit,
-- preventing a half-saved plan when a connection drops.
create or replace function public.save_rate_plan(
  p_property uuid,
  p_plan uuid,
  p_code text,
  p_name text,
  p_name_en text,
  p_description text,
  p_description_en text,
  p_is_default boolean,
  p_is_active boolean,
  p_account uuid,
  p_account_name text,
  p_addons jsonb,
  p_pin text
)
returns public.rate_plans
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_plan public.rate_plans;
  v_item jsonb;
  v_item_id uuid;
  v_basis text;
begin
  if not public.is_admin(p_property) then
    raise exception 'not authorised for this property' using errcode = '42501';
  end if;
  perform public.require_action_pin(p_property, p_pin);

  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'أدخل اسم خطة السعر';
  end if;
  if nullif(trim(coalesce(p_code, '')), '') is null then
    raise exception 'أدخل كود خطة السعر';
  end if;
  if coalesce(p_is_default, false) and not coalesce(p_is_active, true) then
    raise exception 'الخطة الافتراضية يجب أن تكون نشطة';
  end if;
  if p_plan is not null and not coalesce(p_is_default, false) and exists (
    select 1 from public.rate_plans
     where id = p_plan and property_id = p_property and is_default
  ) then
    raise exception 'اجعل خطة أخرى افتراضية أولاً قبل إلغاء الافتراضية الحالية';
  end if;

  if coalesce(p_is_default, false) then
    update public.rate_plans set is_default = false
     where property_id = p_property and is_default and id is distinct from p_plan;
  end if;

  if p_plan is null then
    insert into public.rate_plans (
      property_id, code, name, name_en, description, description_en,
      is_default, is_active, sort_order
    ) values (
      p_property, upper(trim(p_code)), trim(p_name), nullif(trim(coalesce(p_name_en, '')), ''),
      nullif(trim(coalesce(p_description, '')), ''),
      nullif(trim(coalesce(p_description_en, '')), ''),
      coalesce(p_is_default, false), coalesce(p_is_active, true),
      coalesce((select max(sort_order) + 1 from public.rate_plans where property_id = p_property), 0)
    ) returning * into v_plan;
  else
    update public.rate_plans
       set code = upper(trim(p_code)),
           name = trim(p_name),
           name_en = nullif(trim(coalesce(p_name_en, '')), ''),
           description = nullif(trim(coalesce(p_description, '')), ''),
           description_en = nullif(trim(coalesce(p_description_en, '')), ''),
           is_default = coalesce(p_is_default, false),
           is_active = coalesce(p_is_active, true)
     where id = p_plan and property_id = p_property
     returning * into v_plan;
    if not found then raise exception 'خطة السعر غير موجودة في هذا الفندق'; end if;
  end if;

  delete from public.rate_plan_addons where rate_plan_id = v_plan.id;
  for v_item in select * from jsonb_array_elements(coalesce(p_addons, '[]'::jsonb)) loop
    v_item_id := (v_item ->> 'charge_item_id')::uuid;
    v_basis := coalesce(nullif(v_item ->> 'pricing_basis', ''), 'per_guest_night');
    if not exists (
      select 1 from public.charge_items
       where id = v_item_id and property_id = p_property
    ) then
      raise exception 'إضافة لا تتبع هذا الفندق';
    end if;

    insert into public.rate_plan_addons (
      property_id, rate_plan_id, charge_item_id, pricing_basis,
      is_included, unit_amount, notes, sort_order
    ) values (
      p_property, v_plan.id, v_item_id, v_basis,
      coalesce((v_item ->> 'is_included')::boolean, true),
      case when nullif(v_item ->> 'unit_amount', '') is null then null
           else (v_item ->> 'unit_amount')::numeric end,
      nullif(trim(coalesce(v_item ->> 'notes', '')), ''),
      coalesce((v_item ->> 'sort_order')::int, 0)
    );
  end loop;

  if p_account is not null then
    update public.accounts set rate_plan_id = v_plan.id
     where id = p_account and property_id = p_property;
    if not found then raise exception 'الشركة غير موجودة في هذا الفندق'; end if;
  elsif nullif(trim(coalesce(p_account_name, '')), '') is not null then
    insert into public.accounts (property_id, name, rate_plan_id)
    values (p_property, trim(p_account_name), v_plan.id)
    on conflict (property_id, name) do update set rate_plan_id = excluded.rate_plan_id,
      is_active = true;
  end if;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, payload
  ) values (
    p_property, auth.uid(), 'rate_plan', v_plan.id,
    case when p_plan is null then 'created' else 'updated' end,
    jsonb_build_object(
      'code', v_plan.code,
      'account', coalesce(p_account::text, nullif(trim(coalesce(p_account_name, '')), '')),
      'addons', jsonb_array_length(coalesce(p_addons, '[]'::jsonb))
    )
  );

  return v_plan;
end;
$$;

revoke all on function public.save_rate_plan(
  uuid, uuid, text, text, text, text, text, boolean, boolean,
  uuid, text, jsonb, text
) from public, anon;
grant execute on function public.save_rate_plan(
  uuid, uuid, text, text, text, text, text, boolean, boolean,
  uuid, text, jsonb, text
) to authenticated;

-- Latest create_booking definition, with rate-plan services snapshotted after
-- the room allocations have established their occupancies.
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

  if p_account_id is not null and not exists (
    select 1 from accounts where id = p_account_id and property_id = p_property
  ) then
    raise exception 'account does not belong to this property';
  end if;

  v_plan := coalesce(
    p_rate_plan,
    (select rate_plan_id from accounts where id = p_account_id),
    (select id from rate_plans where property_id = p_property and is_default limit 1)
  );
  if v_plan is null or not exists (
    select 1 from rate_plans where id = v_plan and property_id = p_property and is_active
  ) then
    raise exception 'no active rate plan configured for this property';
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

    if v_type is null then raise exception 'room % does not belong to this property', v_room; end if;
    if v_occ > v_max_occ then
      raise exception 'room % takes at most % guests, % requested', v_room, v_max_occ, v_occ;
    end if;
    if v_kind is not null then
      if v_kind not in ('percent', 'amount', 'rate') then raise exception 'نوع الخصم غير معروف'; end if;
      if v_value is null or v_value < 0 then raise exception 'أدخل قيمة الخصم'; end if;
      if v_kind = 'percent' and v_value > 100 then raise exception 'النسبة لا تزيد عن ١٠٠٪'; end if;
    end if;

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

  insert into booking_charges (
    property_id, booking_id, charge_item_id, description, description_en,
    quantity, unit_amount, notes, created_by, is_included, pricing_basis,
    source_rate_plan_id
  )
  select
    p_property, v_booking.id, q.charge_item_id, q.name, q.name_en,
    q.quantity, q.unit_amount, null, auth.uid(), q.is_included,
    q.pricing_basis, v_plan
  from public.quote_rate_plan_addons(
    p_property, v_plan, p_rooms, p_check_in, p_check_out
  ) q
  where q.quantity > 0;

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

-- New clients keep the identity number in an offline provisional booking as
-- well.  The older signature stays available for devices that have not yet
-- refreshed; this overload delegates all booking/idempotency work to it.
create or replace function public.create_provisional_booking(
  p_property uuid,
  p_client_ref text,
  p_guest_name text,
  p_guest_phone text,
  p_guest_id_number text,
  p_check_in date,
  p_check_out date,
  p_rooms jsonb,
  p_rate_plan uuid default null,
  p_source booking_source default 'phone',
  p_notes text default null
)
returns bookings
language plpgsql volatile security invoker set search_path = public as $$
declare v_booking bookings;
begin
  v_booking := public.create_provisional_booking(
    p_property, p_client_ref, p_guest_name, p_guest_phone,
    p_check_in, p_check_out, p_rooms, p_rate_plan, p_source, p_notes
  );
  if nullif(btrim(coalesce(p_guest_id_number, '')), '') is not null then
    update public.guests
       set id_number = btrim(p_guest_id_number)
     where id = v_booking.guest_id and property_id = p_property;
  end if;
  return v_booking;
end;
$$;

revoke all on function public.create_provisional_booking(
  uuid, text, text, text, text, date, date, jsonb, uuid, booking_source, text
) from public, anon;
grant execute on function public.create_provisional_booking(
  uuid, text, text, text, text, date, date, jsonb, uuid, booking_source, text
) to authenticated;

-- Include the plan-service catalogue in downloadable backups.  Existing
-- backup files remain valid because a missing JSON key restores as [].
create or replace function public.export_property_data(p_property uuid)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare v_out jsonb;
begin
  if not is_admin(p_property) then
    raise exception 'النسخة الاحتياطية من صلاحية المدير أو المالك فقط' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'format', 'easyroom-backup', 'version', 1, 'taken_at', now(), 'property_id', p_property,
    'data', jsonb_build_object(
      'property', (select to_jsonb(p) from properties p where p.id = p_property),
      'room_types', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order) from room_types t where t.property_id = p_property), '[]'::jsonb),
      'rooms', coalesce((select jsonb_agg(to_jsonb(r) order by r.number) from rooms r where r.property_id = p_property), '[]'::jsonb),
      'rate_plans', coalesce((select jsonb_agg(to_jsonb(rp) order by rp.sort_order) from rate_plans rp where rp.property_id = p_property), '[]'::jsonb),
      'rates', coalesce((select jsonb_agg(to_jsonb(x)) from rates x where x.property_id = p_property), '[]'::jsonb),
      'rate_seasons', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_on) from rate_seasons x where x.property_id = p_property), '[]'::jsonb),
      'accounts', coalesce((select jsonb_agg(to_jsonb(x)) from accounts x where x.property_id = p_property), '[]'::jsonb),
      'charge_items', coalesce((select jsonb_agg(to_jsonb(x)) from charge_items x where x.property_id = p_property), '[]'::jsonb),
      'rate_plan_addons', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order) from rate_plan_addons x where x.property_id = p_property), '[]'::jsonb),
      'guests', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from guests x where x.property_id = p_property), '[]'::jsonb),
      'bookings', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from bookings x where x.property_id = p_property), '[]'::jsonb),
      'room_allocations', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_on) from room_allocations x where x.property_id = p_property), '[]'::jsonb),
      'allocation_nights', coalesce((select jsonb_agg(to_jsonb(x) order by x.night) from allocation_nights x where x.property_id = p_property), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from payments x where x.property_id = p_property), '[]'::jsonb),
      'booking_charges', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from booking_charges x where x.property_id = p_property), '[]'::jsonb),
      'housekeeping_tasks', coalesce((select jsonb_agg(to_jsonb(x) order by x.scheduled_for) from housekeeping_tasks x where x.property_id = p_property), '[]'::jsonb),
      'members', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'role', m.role, 'is_active', m.is_active,
        'login_username', m.login_username))
        from property_members m where m.property_id = p_property), '[]'::jsonb)
    )
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.export_property_data(uuid) from public, anon;
grant execute on function public.export_property_data(uuid) to authenticated;

-- Only the restore order changes: add-ons depend on plans and charge items,
-- and bookings depend on all three.
create or replace function public.restore_property_data(p_property uuid, p_backup jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  d jsonb := p_backup -> 'data';
  v_existing int; v_counts jsonb; v_table text; v_cols text;
begin
  if not is_admin(p_property) then
    raise exception 'الاسترداد من صلاحية المدير أو المالك فقط' using errcode = '42501';
  end if;
  if p_backup ->> 'format' is distinct from 'easyroom-backup' then
    raise exception 'هذا الملف ليس نسخة احتياطية من Easyroom';
  end if;
  if d is null then raise exception 'الملف لا يحتوي على بيانات'; end if;
  if (p_backup ->> 'property_id')::uuid is distinct from p_property then
    raise exception 'هذه النسخة تخص فندقاً آخر. تُسترد في الفندق الذي أُخذت منه فقط';
  end if;
  select count(*) into v_existing from bookings where property_id = p_property;
  if v_existing > 0 then
    raise exception 'هذا الفندق به % حجزاً بالفعل. الاسترداد يتم في فندق فارغ فقط', v_existing;
  end if;

  foreach v_table in array array[
    'room_types', 'rooms', 'rate_plans', 'rates', 'rate_seasons',
    'accounts', 'charge_items', 'rate_plan_addons', 'guests', 'bookings',
    'room_allocations', 'payments', 'booking_charges'
  ] loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into v_cols
    from information_schema.columns
    where table_schema = 'public' and table_name = v_table
      and is_generated = 'NEVER' and identity_generation is null;
    execute format(
      'insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, public.scoped_rows($1, $2 -> %L, $3)) on conflict (id) do nothing',
      v_table, v_cols, v_cols, v_table, v_table)
    using p_property, d, '{}'::text[];
  end loop;

  select jsonb_build_object(
    'rooms', (select count(*) from rooms where property_id = p_property),
    'guests', (select count(*) from guests where property_id = p_property),
    'bookings', (select count(*) from bookings where property_id = p_property),
    'payments', (select count(*) from payments where property_id = p_property)
  ) into v_counts;
  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (p_property, auth.uid(), 'security', p_property, 'restored',
          jsonb_build_object('taken_at', p_backup ->> 'taken_at', 'restored', v_counts));
  return v_counts;
end;
$$;

revoke all on function public.restore_property_data(uuid, jsonb) from public, anon;
grant execute on function public.restore_property_data(uuid, jsonb) to authenticated;
