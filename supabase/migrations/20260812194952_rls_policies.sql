-- Tenant isolation enforced by Postgres, not by the client.
create or replace function auth_property_ids()
returns setof uuid
language sql stable security definer set search_path = public, auth as $$
  select property_id from property_members
  where user_id = auth.uid() and is_active = true;
$$;

create or replace function is_member(p_property uuid)
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from property_members
    where property_id = p_property and user_id = auth.uid() and is_active = true
  );
$$;

create or replace function has_role(p_property uuid, p_roles staff_role[])
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from property_members
    where property_id = p_property and user_id = auth.uid()
      and is_active = true and role = any(p_roles)
  );
$$;

create or replace function can_manage(p_property uuid)
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select has_role(p_property, array['owner','manager','reception']::staff_role[]);
$$;

create or replace function is_admin(p_property uuid)
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select has_role(p_property, array['owner','manager']::staff_role[]);
$$;

alter table properties         enable row level security;
alter table profiles           enable row level security;
alter table property_members   enable row level security;
alter table room_types         enable row level security;
alter table rooms              enable row level security;
alter table guests             enable row level security;
alter table bookings           enable row level security;
alter table room_allocations   enable row level security;
alter table housekeeping_tasks enable row level security;
alter table payments           enable row level security;
alter table activity_log       enable row level security;

create policy properties_select on properties for select using (is_member(id));
create policy properties_update on properties for update
  using (is_admin(id)) with check (is_admin(id));

create policy profiles_select_self on profiles for select using (id = auth.uid());
create policy profiles_select_colleagues on profiles for select using (
  exists (
    select 1 from property_members m
    where m.user_id = profiles.id and m.property_id in (select auth_property_ids())
  )
);
create policy profiles_update_self on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_insert_self on profiles for insert with check (id = auth.uid());

create policy members_select on property_members for select using (is_member(property_id));
create policy members_write on property_members for all
  using (is_admin(property_id)) with check (is_admin(property_id));

create policy room_types_select on room_types for select using (is_member(property_id));
create policy room_types_write on room_types for all
  using (is_admin(property_id)) with check (is_admin(property_id));

create policy rooms_select on rooms for select using (is_member(property_id));
-- Housekeepers flip clean/dirty, so UPDATE is open to members; create/delete is not.
create policy rooms_update on rooms for update
  using (is_member(property_id)) with check (is_member(property_id));
create policy rooms_insert on rooms for insert with check (is_admin(property_id));
create policy rooms_delete on rooms for delete using (is_admin(property_id));

create policy guests_select on guests for select using (is_member(property_id));
create policy guests_write on guests for all
  using (can_manage(property_id)) with check (can_manage(property_id));

create policy bookings_select on bookings for select using (is_member(property_id));
create policy bookings_write on bookings for all
  using (can_manage(property_id)) with check (can_manage(property_id));

create policy allocations_select on room_allocations for select using (is_member(property_id));
create policy allocations_write on room_allocations for all
  using (can_manage(property_id)) with check (can_manage(property_id));

create policy tasks_select on housekeeping_tasks for select using (is_member(property_id));
create policy tasks_update on housekeeping_tasks for update
  using (is_member(property_id)) with check (is_member(property_id));
create policy tasks_insert on housekeeping_tasks for insert with check (is_member(property_id));
create policy tasks_delete on housekeeping_tasks for delete using (is_admin(property_id));

create policy payments_select on payments for select using (can_manage(property_id));
create policy payments_insert on payments for insert with check (can_manage(property_id));
-- Payments are append-only for staff. Corrections are a new negative entry.
create policy payments_update on payments for update
  using (is_admin(property_id)) with check (is_admin(property_id));
create policy payments_delete on payments for delete using (false);

create policy activity_select on activity_log for select using (is_admin(property_id));
create policy activity_insert on activity_log for insert with check (is_member(property_id));
