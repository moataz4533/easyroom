-- Two defects found by review, both severe, both shipped.
--
-- 1. Adding any extra to a checked-out booking wiped its room revenue.
--    recalc_booking_total summed only allocations with released_at is null,
--    and check-out releases every allocation so the room can be sold again.
--    A 1,500 stay became 120 the moment reception added a minibar charge —
--    which is exactly when a minibar charge gets added.
--
-- 2. Seasons could never be saved. save_season_rates is SECURITY INVOKER, so
--    it hit the row-level policies on rate_seasons and rates and failed with
--    42501 for everyone, including the owner.
--
-- The second one survived a green local test because that test ran as the
-- superuser, which bypasses RLS. The test harness now runs as `authenticated`.

-- ---------------------------------------------------------------------
-- The bill after check-out.
--
-- The distinction the old rule was missing already exists in the data:
-- every commercial release records why (cancel_booking, mark_no_show,
-- release_booking_room all set release_reason), while check-out releases the
-- room with no reason at all. So a reason means the room left the bill; no
-- reason means the guest simply stopped occupying it.
--
-- The room total now also comes from allocation_nights — the prices as they
-- were sold — instead of re-quoting at today's rates. Adding a breakfast to
-- an in-house guest must not silently reprice their agreed stay because a
-- season changed in the meantime.
-- ---------------------------------------------------------------------
create or replace function public.recalc_booking_total(p_booking uuid)
returns numeric
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_rooms  numeric := 0;
  v_extras numeric := 0;
  v_heads  int := 0;
  v_from   date;
  v_to     date;
begin
  select coalesce(sum(an.amount), 0) into v_rooms
  from allocation_nights an
  join room_allocations a on a.id = an.allocation_id
  where a.booking_id = p_booking
    and a.release_reason is null;

  select coalesce(sum(a.occupancy), 0), min(a.starts_on), max(a.ends_on)
    into v_heads, v_from, v_to
  from room_allocations a
  where a.booking_id = p_booking
    and a.release_reason is null;

  select coalesce(sum(amount), 0) into v_extras
  from booking_charges
  where booking_id = p_booking and voided_at is null;

  update bookings
     set total_amount = v_rooms + v_extras,
         adults = greatest(v_heads, 1),
         check_in = coalesce(v_from, check_in),
         check_out = coalesce(v_to, check_out)
   where id = p_booking;

  return v_rooms + v_extras;
end;
$$;

-- ---------------------------------------------------------------------
-- Seasons have to be writable.
--
-- save_rates has always been SECURITY DEFINER for this reason: a policy
-- cannot take a password as an argument, so the rates table refuses direct
-- writes and the PIN-gated function is the only way in. Its dated twin needs
-- the same treatment. The authorisation is unchanged and explicit — admin
-- only, then the manager PIN, then the write.
-- ---------------------------------------------------------------------
create or replace function public.save_season_rates(
  p_property uuid,
  p_from     date,
  p_to       date,
  p_name     text,
  p_rows     jsonb,
  p_name_en  text default null,
  p_pin      text default null
)
returns int
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  v_row jsonb;
  v_count int := 0;
begin
  if not is_admin(p_property) then
    raise exception 'المدير أو المالك فقط من يمكنه تغيير الأسعار' using errcode = '42501';
  end if;
  if p_from is null or p_to is null then
    raise exception 'الموسم يتطلب تاريخ بداية وتاريخ نهاية';
  end if;
  if p_to < p_from then
    raise exception 'نهاية الموسم يجب أن تكون بعد بدايته';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'أدخل اسم الموسم';
  end if;

  perform require_action_pin(p_property, p_pin);

  insert into rate_seasons (property_id, name, name_en, starts_on, ends_on)
  values (p_property, trim(p_name), nullif(trim(coalesce(p_name_en, '')), ''), p_from, p_to)
  on conflict (property_id, starts_on) do update
    set name = excluded.name, name_en = excluded.name_en,
        ends_on = excluded.ends_on, updated_at = now();

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    -- An empty price means this combination is not sold in this season, and
    -- the standing rate takes over again. Deleting says that; a zero would
    -- say "free", which is a different and much worse answer.
    if (v_row ->> 'amount') is null or (v_row ->> 'amount') = '' then
      delete from rates
       where property_id  = p_property
         and room_type_id = (v_row ->> 'room_type_id')::uuid
         and rate_plan_id = (v_row ->> 'rate_plan_id')::uuid
         and occupancy    = (v_row ->> 'occupancy')::int
         and valid_from   = p_from;
    else
      insert into rates (property_id, room_type_id, rate_plan_id, occupancy,
                         amount, valid_from, valid_to)
      values (p_property,
              (v_row ->> 'room_type_id')::uuid,
              (v_row ->> 'rate_plan_id')::uuid,
              (v_row ->> 'occupancy')::int,
              (v_row ->> 'amount')::numeric,
              p_from, p_to)
      on conflict (property_id, room_type_id, rate_plan_id, occupancy, valid_from)
      do update set amount = excluded.amount, valid_to = excluded.valid_to,
                    updated_at = now();
    end if;
    v_count := v_count + 1;
  end loop;

  update rates set valid_to = p_to, updated_at = now()
   where property_id = p_property and valid_from = p_from and valid_to is distinct from p_to;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (p_property, auth.uid(), 'rates', p_property, 'season_updated',
          jsonb_build_object('season', trim(p_name), 'from', p_from, 'to', p_to,
                             'changed', v_count));

  return v_count;
end;
$$;

create or replace function public.delete_season(
  p_property uuid, p_from date, p_pin text default null
)
returns int
language plpgsql volatile security definer set search_path = public, auth as $$
declare v_count int;
begin
  if not is_admin(p_property) then
    raise exception 'المدير أو المالك فقط من يمكنه تغيير الأسعار' using errcode = '42501';
  end if;

  perform require_action_pin(p_property, p_pin);

  delete from rates where property_id = p_property and valid_from = p_from;
  get diagnostics v_count = row_count;
  delete from rate_seasons where property_id = p_property and starts_on = p_from;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (p_property, auth.uid(), 'rates', p_property, 'season_deleted',
          jsonb_build_object('from', p_from, 'removed', v_count));

  return v_count;
end;
$$;

revoke all on function public.save_season_rates(uuid, date, date, text, jsonb, text, text) from public, anon;
revoke all on function public.delete_season(uuid, date, text) from public, anon;
grant execute on function public.save_season_rates(uuid, date, date, text, jsonb, text, text) to authenticated;
grant execute on function public.delete_season(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- The extras breakdown must agree with the extras total.
--
-- report_summary excludes charges on cancelled bookings; report_extras did
-- not, so the same screen showed one figure in the KPI and a different set of
-- lines underneath it.
-- ---------------------------------------------------------------------
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
  join bookings b on b.id = c.booking_id
  left join charge_items i on i.id = c.charge_item_id
  where c.property_id = p_property
    and c.voided_at is null
    and b.status in ('confirmed', 'checked_in', 'checked_out')
    and c.created_at >= p_from and c.created_at < p_to + 1
  group by coalesce(i.name, c.description)
  order by 4 desc;
$$;

revoke all on function public.report_extras(uuid, date, date) from public, anon;
grant execute on function public.report_extras(uuid, date, date) to authenticated;

-- Repair any booking whose total was already flattened to its extras by the
-- defect above. Bookings with no charges were never affected.
do $$
declare v_booking uuid;
begin
  for v_booking in
    select distinct booking_id from booking_charges where voided_at is null
  loop
    perform recalc_booking_total(v_booking);
  end loop;
end $$;
