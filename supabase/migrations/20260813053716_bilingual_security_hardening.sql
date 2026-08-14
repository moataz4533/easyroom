-- =====================================================================
-- Bilingual data + least-privilege operational access.
--
-- This migration is intentionally additive first: localized columns and
-- narrowly-scoped RPCs land before the frontend switches away from broad
-- table updates. Apply on a Supabase preview branch and run the role matrix
-- before production.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Localized property-managed content and per-user language preference.
-- Existing Arabic columns remain the source of truth and the fallback.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists preferred_locale text not null default 'ar'
    check (preferred_locale in ('ar', 'en'));

alter table public.properties
  add column if not exists name_en text;

alter table public.room_types
  add column if not exists name_en text,
  add column if not exists description_en text;

alter table public.rate_plans
  add column if not exists name_en text,
  add column if not exists description_en text;

-- ---------------------------------------------------------------------
-- Narrow operational writes.
-- Housekeeping can only change the housekeeping condition; room inventory
-- fields remain admin-only even when a request bypasses the frontend.
-- ---------------------------------------------------------------------
create or replace function public.set_housekeeping_status(
  p_room uuid,
  p_status public.housekeeping_status
)
returns public.rooms
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room;

  if v_room.id is null or not public.is_member(v_room.property_id) then
    raise exception 'not authorised for this room' using errcode = '42501';
  end if;

  if p_status = 'out_of_order' and not public.is_admin(v_room.property_id) then
    raise exception 'only managers can take a room out of service' using errcode = '42501';
  end if;

  update public.rooms
     set housekeeping_status = p_status,
         updated_at = now()
   where id = p_room
  returning * into v_room;

  update public.housekeeping_tasks
     set status = case when p_status in ('clean', 'inspected') then 'done'::public.task_status else status end,
         completed_at = case when p_status in ('clean', 'inspected') then now() else completed_at end,
         completed_by = case when p_status in ('clean', 'inspected') then auth.uid() else completed_by end,
         updated_at = now()
   where room_id = p_room
     and status in ('pending', 'in_progress');

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, payload
  ) values (
    v_room.property_id, auth.uid(), 'room', v_room.id, 'housekeeping_status_changed',
    jsonb_build_object('status', p_status)
  );

  return v_room;
end;
$$;

create or replace function public.update_housekeeping_task_status(
  p_task uuid,
  p_status public.task_status
)
returns public.housekeeping_tasks
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_task public.housekeeping_tasks;
begin
  select * into v_task from public.housekeeping_tasks where id = p_task;

  if v_task.id is null or not public.is_member(v_task.property_id) then
    raise exception 'not authorised for this task' using errcode = '42501';
  end if;

  update public.housekeeping_tasks
     set status = p_status,
         started_at = case when p_status = 'in_progress' and started_at is null then now() else started_at end,
         completed_at = case when p_status = 'done' then now() else null end,
         completed_by = case when p_status = 'done' then auth.uid() else null end,
         updated_at = now()
   where id = p_task
  returning * into v_task;

  return v_task;
end;
$$;

create or replace function public.update_room_admin(
  p_room uuid,
  p_room_type uuid default null,
  p_number text default null,
  p_floor text default null,
  p_notes text default null,
  p_is_active boolean default null
)
returns public.rooms
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room;

  if v_room.id is null or not public.is_admin(v_room.property_id) then
    raise exception 'manager access required' using errcode = '42501';
  end if;

  if p_room_type is not null and not exists (
    select 1 from public.room_types
    where id = p_room_type and property_id = v_room.property_id
  ) then
    raise exception 'room type does not belong to this property' using errcode = '23503';
  end if;

  update public.rooms
     set room_type_id = coalesce(p_room_type, room_type_id),
         number = coalesce(nullif(btrim(p_number), ''), number),
         floor = case when p_floor is null then floor else nullif(btrim(p_floor), '') end,
         notes = case when p_notes is null then notes else nullif(btrim(p_notes), '') end,
         is_active = coalesce(p_is_active, is_active),
         updated_at = now()
   where id = p_room
  returning * into v_room;

  return v_room;
end;
$$;

revoke all on function public.set_housekeeping_status(uuid, public.housekeeping_status) from public, anon;
revoke all on function public.update_housekeeping_task_status(uuid, public.task_status) from public, anon;
revoke all on function public.update_room_admin(uuid, uuid, text, text, text, boolean) from public, anon;
grant execute on function public.set_housekeeping_status(uuid, public.housekeeping_status) to authenticated;
grant execute on function public.update_housekeeping_task_status(uuid, public.task_status) to authenticated;
grant execute on function public.update_room_admin(uuid, uuid, text, text, text, boolean) to authenticated;

-- Housekeepers need the room type label, but must never be able to select
-- room_types.base_rate. This narrow function returns only operational fields.
create or replace function public.list_housekeeping_rooms(p_property uuid)
returns table (
  id uuid,
  number text,
  floor text,
  housekeeping_status public.housekeeping_status,
  type_name text,
  type_name_en text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_member(p_property) then
    raise exception 'not authorised for this property' using errcode = '42501';
  end if;

  return query
    select r.id, r.number, r.floor, r.housekeeping_status, rt.name, rt.name_en
    from public.rooms r
    join public.room_types rt on rt.id = r.room_type_id
    where r.property_id = p_property and r.is_active
    order by r.number;
end;
$$;

revoke all on function public.list_housekeeping_rooms(uuid) from public, anon;
grant execute on function public.list_housekeeping_rooms(uuid) to authenticated;

-- Direct room/task UPDATE is removed once the frontend uses the RPCs above.
drop policy if exists rooms_update on public.rooms;
drop policy if exists tasks_update on public.housekeeping_tasks;

-- ---------------------------------------------------------------------
-- Role-oriented reads.
-- Housekeeping sees room inventory and tasks, not guests, bookings,
-- colleagues, prices, payments, reports, or operational booking views.
-- ---------------------------------------------------------------------
drop policy if exists profiles_select_colleagues on public.profiles;
create policy profiles_select_colleagues on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.property_members target
      where target.user_id = profiles.id
        and public.is_admin(target.property_id)
    )
  );

drop policy if exists members_select on public.property_members;
create policy members_select on public.property_members
  for select to authenticated
  using (public.is_admin(property_id) or user_id = (select auth.uid()));

drop policy if exists room_types_select on public.room_types;
create policy room_types_select on public.room_types
  for select to authenticated
  using (public.can_manage(property_id));

drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
  for select to authenticated
  using (public.is_member(property_id));

drop policy if exists guests_select on public.guests;
create policy guests_select on public.guests
  for select to authenticated
  using (public.can_manage(property_id));

drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings
  for select to authenticated
  using (public.can_manage(property_id));

drop policy if exists allocations_select on public.room_allocations;
create policy allocations_select on public.room_allocations
  for select to authenticated
  using (public.can_manage(property_id));

drop policy if exists tasks_select on public.housekeeping_tasks;
create policy tasks_select on public.housekeeping_tasks
  for select to authenticated
  using (public.is_member(property_id));

drop policy if exists tasks_insert on public.housekeeping_tasks;
create policy tasks_insert on public.housekeeping_tasks
  for insert to authenticated
  with check (public.can_manage(property_id));

drop policy if exists rate_plans_select on public.rate_plans;
create policy rate_plans_select on public.rate_plans
  for select to authenticated
  using (public.can_manage(property_id));

drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts
  for select to authenticated
  using (public.can_manage(property_id));

drop policy if exists rates_select on public.rates;
create policy rates_select on public.rates
  for select to authenticated
  using (public.can_manage(property_id));

-- Every exposed view must obey the RLS policies of its source tables.
alter view if exists public.today_board set (security_invoker = true);
alter view if exists public.attention_queue set (security_invoker = true);
alter view if exists public.blocked_rooms set (security_invoker = true);

create or replace view public.today_board
with (security_invoker = true)
as
select
  r.property_id,
  r.id as room_id,
  r.number as room_number,
  rt.name as room_type,
  r.housekeeping_status,
  a.id as allocation_id,
  a.occupancy,
  b.id as booking_id,
  b.reference,
  b.status as booking_status,
  g.full_name as guest_name,
  g.phone as guest_phone,
  a.starts_on,
  a.ends_on,
  (a.ends_on = current_date) as departing_today,
  (a.starts_on = current_date) as arriving_today,
  rt.name_en as room_type_en
from public.rooms r
join public.room_types rt on rt.id = r.room_type_id
left join public.room_allocations a
  on a.room_id = r.id and a.released_at is null and a.stay @> current_date
left join public.bookings b on b.id = a.booking_id
left join public.guests g on g.id = b.guest_id
where r.is_active;

-- ---------------------------------------------------------------------
-- Localized room query. Keep existing columns while adding localized data.
-- ---------------------------------------------------------------------
drop function if exists public.available_rooms(uuid, date, date, uuid);
create function public.available_rooms(
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
  housekeeping public.housekeeping_status
)
language sql
stable
security invoker
set search_path = public
as $$
  select r.id, r.number, rt.id, rt.name, rt.name_en, rt.base_rate, r.housekeeping_status
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

-- Foreign-key indexes reported by Supabase's performance advisor.
create index if not exists accounts_rate_plan_id_idx on public.accounts(rate_plan_id);
create index if not exists activity_log_actor_id_idx on public.activity_log(actor_id);
create index if not exists bookings_created_by_idx on public.bookings(created_by);
create index if not exists bookings_rate_plan_id_idx on public.bookings(rate_plan_id);
create index if not exists housekeeping_tasks_booking_id_idx on public.housekeeping_tasks(booking_id);
create index if not exists housekeeping_tasks_completed_by_idx on public.housekeeping_tasks(completed_by);
create index if not exists payments_received_by_idx on public.payments(received_by);
create index if not exists property_secrets_updated_by_idx on public.property_secrets(updated_by);
create index if not exists rates_rate_plan_id_idx on public.rates(rate_plan_id);
