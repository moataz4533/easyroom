-- Follow-up hardening for the flexible rate-plan catalogue.
--
-- Keep foreign-key maintenance indexed and avoid a permissive FOR ALL policy
-- also participating in SELECT alongside the dedicated read policy.

create index rate_plan_addons_charge_item_idx
  on public.rate_plan_addons (charge_item_id);

create index booking_charges_source_rate_plan_idx
  on public.booking_charges (source_rate_plan_id)
  where source_rate_plan_id is not null;

drop policy rate_plan_addons_write on public.rate_plan_addons;

create policy rate_plan_addons_insert on public.rate_plan_addons
  for insert to authenticated
  with check (public.is_admin(property_id));

create policy rate_plan_addons_update on public.rate_plan_addons
  for update to authenticated
  using (public.is_admin(property_id))
  with check (public.is_admin(property_id));

create policy rate_plan_addons_delete on public.rate_plan_addons
  for delete to authenticated
  using (public.is_admin(property_id));
