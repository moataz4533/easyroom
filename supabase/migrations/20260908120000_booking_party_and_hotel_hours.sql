-- Two things the desk asked for, and one bug found while reading their data.
--
-- 1. A rate plan now says WHO it is for. Every plan this hotel has is named
--    «… شركات», and the pricing screen offered all ten to every walk-in
--    guest. A plan carries `party` — 'direct' for individuals, 'company'
--    for an agency or a corporate account — and reception picks the party
--    first, so it only ever sees the prices that apply.
--
-- 2. A hotel now states its own arrival and departure hours, and a stay
--    whose departure date has passed closes itself. Reading production
--    while writing this: thirteen stays were still `checked_in`, one of
--    them fifteen days after the guest left, and nothing anywhere on the
--    screen said so.
--
-- Nothing here renames, hides, deletes or reprices a single plan. The last
-- time plans were reshaped the desk asked for it back, and the lesson from
-- that day is written in STATUS.md.

-- ---------------------------------------------------------------- party --
alter table public.rate_plans
  add column if not exists party text not null default 'direct';

alter table public.rate_plans
  drop constraint if exists rate_plans_party_valid;
alter table public.rate_plans
  add constraint rate_plans_party_valid check (party in ('direct', 'company'));

-- Labelling only, and labelling is one toggle to correct in the plan
-- editor — which is why reading the name is acceptable here and reshaping
-- the plans on the same evidence was not. A plan an account books on is a
-- company plan whatever it is called.
update public.rate_plans p
   set party = 'company'
 where p.party = 'direct'
   and (
     exists (select 1 from public.accounts a where a.rate_plan_id = p.id)
     or p.name ~* 'شرك|وكال|company|corporate|agency|agent'
     or coalesce(p.name_en, '') ~* 'company|corporate|agency|agent'
   );

create index if not exists rate_plans_party_idx
  on public.rate_plans (property_id, party) where is_active;

-- save_rate_plan gains the party. Same signature otherwise, so the old one
-- is dropped rather than left behind to be called by accident.
drop function if exists public.save_rate_plan(
  uuid, uuid, text, text, text, text, text, boolean, boolean, uuid, text, jsonb, text
);

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
  p_party text,
  p_pin text
)
returns public.rate_plans
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_plan public.rate_plans;
  v_item jsonb;
  v_item_id uuid;
  v_basis text;
  v_party text;
  v_account uuid := p_account;
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

  v_party := lower(coalesce(nullif(trim(p_party), ''), 'direct'));
  if v_party not in ('direct', 'company') then
    raise exception 'جهة الحجز يجب أن تكون أفراد أو شركات';
  end if;

  -- A plan for individuals cannot belong to a company. Saying so here beats
  -- letting the two disagree and having the booking screen pick a winner.
  if v_party = 'direct' and (v_account is not null
      or nullif(trim(coalesce(p_account_name, '')), '') is not null) then
    raise exception 'خطة الأفراد لا تُربط بشركة — غيّر جهة الحجز إلى شركات أولاً';
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
      is_default, is_active, party, sort_order
    ) values (
      p_property, upper(trim(p_code)), trim(p_name), nullif(trim(coalesce(p_name_en, '')), ''),
      nullif(trim(coalesce(p_description, '')), ''),
      nullif(trim(coalesce(p_description_en, '')), ''),
      coalesce(p_is_default, false), coalesce(p_is_active, true), v_party,
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
           is_active = coalesce(p_is_active, true),
           party = v_party
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

  if v_account is not null then
    update public.accounts set rate_plan_id = v_plan.id
     where id = v_account and property_id = p_property;
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
      'party', v_plan.party,
      'account', coalesce(v_account::text, nullif(trim(coalesce(p_account_name, '')), '')),
      'addons', jsonb_array_length(coalesce(p_addons, '[]'::jsonb))
    )
  );

  return v_plan;
end;
$$;

revoke all on function public.save_rate_plan(
  uuid, uuid, text, text, text, text, text, boolean, boolean,
  uuid, text, jsonb, text, text
) from public, anon;
grant execute on function public.save_rate_plan(
  uuid, uuid, text, text, text, text, text, boolean, boolean,
  uuid, text, jsonb, text, text
) to authenticated;

-- ------------------------------------------- how many the room can take --
-- The booking screen offered one to six guests for every room whatever the
-- room held, and create_booking refused the whole booking at the very end
-- with a database error. The picker can only be right if it is told.
drop function if exists public.available_rooms(uuid, date, date, uuid);

create or replace function public.available_rooms(
  p_property uuid,
  p_check_in date,
  p_check_out date,
  p_room_type uuid default null
)
returns table (
  room_id uuid,
  room_number text,
  room_type_id uuid,
  type_name text,
  type_name_en text,
  base_rate numeric,
  max_occupancy int,
  housekeeping public.housekeeping_status
)
language sql
stable
security invoker
set search_path = public
as $$
  select r.id, r.number, rt.id, rt.name, rt.name_en, rt.base_rate,
         rt.max_occupancy, r.housekeeping_status
  from public.rooms r
  join public.room_types rt on rt.id = r.room_type_id
  where r.property_id = p_property
    and public.can_manage(r.property_id)
    and r.is_active
    and r.housekeeping_status <> 'out_of_order'
    and (p_room_type is null or r.room_type_id = p_room_type)
    and not exists (
      select 1
      from public.room_allocations a
      where a.room_id = r.id
        and a.released_at is null
        and a.stay && daterange(p_check_in, p_check_out, '[)')
    )
  order by rt.sort_order, r.number;
$$;

revoke all on function public.available_rooms(uuid, date, date, uuid) from public, anon;
grant execute on function public.available_rooms(uuid, date, date, uuid) to authenticated;

-- --------------------------------------------------------- hotel hours --
-- The hours live in settings beside the address and the dial code, because
-- they are the same kind of fact and the screen that edits them is the same
-- screen. Defaults are the ones almost every hotel uses, so a property that
-- never opens the screen still prints something true.
update public.properties
   set settings = coalesce(settings, '{}'::jsonb)
     || jsonb_build_object(
          'check_in_time',  coalesce(settings ->> 'check_in_time',  '14:00'),
          'check_out_time', coalesce(settings ->> 'check_out_time', '12:00'),
          'auto_close_stays', coalesce(settings -> 'auto_close_stays', 'true'::jsonb)
        );

-- ------------------------------------------------- automatic departure --
/**
 * Closes stays whose departure date has already passed.
 *
 * Only whole days: a stay is closed when the hotel's own today is past the
 * booked departure date, never on the departure day itself. A guest
 * standing at the desk at 12:05 settling their bill is still a guest, and
 * an app that checks them out mid-sentence is worse than one that waits a
 * day.
 *
 * `check_out_booking` does the actual work, so an automatic close and a
 * pressed button leave identical rows — including keeping the booked
 * departure date, so no money moves.
 *
 * The housekeeping side is skipped for a room that emptied more than a day
 * ago: raising "clean room 4" today for a guest who left a fortnight ago is
 * a task the desk has to read and dismiss, and the room was cleaned long
 * since. It is a catch-up, not a discovery.
 */
create or replace function public.close_overdue_stays(p_property uuid)
returns TABLE(booking_id uuid, reference text, check_out date)
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_today date;
  v_enabled boolean;
  v_row record;
begin
  if not public.can_manage(p_property) then
    raise exception 'not authorised for this property' using errcode = '42501';
  end if;

  select (now() at time zone p.timezone)::date,
         coalesce((p.settings -> 'auto_close_stays')::boolean, true)
    into v_today, v_enabled
    from public.properties p
   where p.id = p_property;

  if not coalesce(v_enabled, true) then return; end if;

  for v_row in
    select b.id, b.reference, b.check_out
      from public.bookings b
     where b.property_id = p_property
       and b.status = 'checked_in'
       and b.check_out < v_today
     order by b.check_out
  loop
    perform public.check_out_booking(v_row.id);

    if v_row.check_out < v_today - 1 then
      delete from public.housekeeping_tasks h
       where h.booking_id = v_row.id
         and h.task_type = 'checkout_clean'
         and h.status = 'pending';
      update public.rooms r
         set housekeeping_status = 'clean', updated_at = now()
        from public.room_allocations a
       where a.booking_id = v_row.id
         and r.id = a.room_id
         and r.housekeeping_status = 'dirty'
         and not exists (
           select 1 from public.room_allocations other
            join public.bookings ob on ob.id = other.booking_id
           where other.room_id = r.id
             and other.booking_id is distinct from v_row.id
             and other.released_at is null
             and ob.status in ('confirmed', 'checked_in')
         );
    end if;

    -- The log is append-only by policy — there is no UPDATE on it and there
    -- should not be — so this does not go back and annotate the row
    -- `check_out_booking` just wrote. It adds its own, with no actor,
    -- because nobody did this: a manager reading the log otherwise sees the
    -- staff member who happened to open the app that morning credited with
    -- checking out a guest who left a fortnight earlier.
    insert into public.activity_log (
      property_id, actor_id, entity_type, entity_id, action, payload
    ) values (
      p_property, null, 'booking', v_row.id, 'auto_checked_out',
      jsonb_build_object(
        'reference', v_row.reference,
        'check_out', v_row.check_out,
        'days_late', v_today - v_row.check_out
      )
    );

    booking_id := v_row.id;
    reference := v_row.reference;
    check_out := v_row.check_out;
    return next;
  end loop;
end;
$$;

revoke all on function public.close_overdue_stays(uuid) from public, anon;
grant execute on function public.close_overdue_stays(uuid) to authenticated;

-- ------------------------------------------ arrivals nobody registered --
/**
 * The counterpart the desk cannot see today: a confirmed booking whose
 * arrival date has passed and which nobody checked in. Deliberately NOT
 * automatic — marking a guest as arrived when they never came puts a
 * stranger in a room on the board and quietly kills the no-show. It is a
 * question for a human, so it is a list, not an action.
 */
create or replace function public.stale_arrivals(p_property uuid)
returns TABLE(booking_id uuid, reference text, check_in date, guest_name text)
language sql stable security invoker set search_path = public as $$
  select b.id, b.reference, b.check_in, g.full_name
    from public.bookings b
    join public.guests g on g.id = b.guest_id
    join public.properties p on p.id = b.property_id
   where b.property_id = p_property
     and b.status = 'confirmed'
     and b.check_in < (now() at time zone p.timezone)::date
     and b.check_out >= (now() at time zone p.timezone)::date
     and public.can_manage(p_property)
   order by b.check_in;
$$;

revoke all on function public.stale_arrivals(uuid) from public, anon;
grant execute on function public.stale_arrivals(uuid) to authenticated;
