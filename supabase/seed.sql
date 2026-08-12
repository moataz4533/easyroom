-- =====================================================================
-- seed.sql — bootstrap only.
--
-- This file creates the minimum needed for someone to log in and start
-- working. It deliberately contains NO PRICES.
--
-- Rates change every season. Anything that changes during normal
-- operation belongs in the admin panel, not in a migration -- otherwise
-- the first price change needs a developer, which is exactly the
-- dependency this product is supposed to remove.
--
-- What lives here:  things true on day one and rarely after (the
--                   property itself, its rooms, starter rate plans).
-- What lives in the panel: rates, room types, staff, guests, bookings.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The property
-- ---------------------------------------------------------------------
insert into properties (
  slug, name, legal_name,
  logo_url, primary_color, secondary_color,
  timezone, currency,
  default_check_in_time, default_check_out_time,
  settings
) values (
  'greek-club-dahab',
  'The Greek Club',
  'The Greek Club Dahab',
  null,                          -- set from Settings once the logo is uploaded
  '#1E5F74',
  '#F5B841',
  'Africa/Cairo',
  'EGP',
  '14:00',
  '12:00',
  jsonb_build_object(
    'whatsapp_number', '',
    'address', 'Dahab, South Sinai',
    'cancellation_policy', '',
    'features', jsonb_build_object(
      'housekeeping',   true,
      'payments',       true,
      'online_booking', false,
      'ota_sync',       false
    )
  )
)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- 2. Rate plans — the columns of the pricing matrix.
--
-- Created empty of prices. Reception needs at least one plan to exist
-- before the first booking can be taken, so these two are seeded; the
-- amounts are filled in from the panel.
-- ---------------------------------------------------------------------
with p as (select id from properties where slug = 'greek-club-dahab')
insert into rate_plans (property_id, code, name, description, is_default, sort_order)
select p.id, v.code, v.name, v.descr, v.is_def, v.sort
from p, (values
  ('DIRECT', 'حجز مباشر', 'السعر المعلن للنزيل اللي بيحجز بنفسه', true,  1),
  ('CORP',   'شركات',     'سعر تعاقدي للشركات والجهات',           false, 2)
) as v(code, name, descr, is_def, sort)
on conflict (property_id, code) do nothing;

-- ---------------------------------------------------------------------
-- 3. A starter room type.
--
-- One type so the six rooms below have somewhere to live. Rename it,
-- split it, or add more from the panel -- max_occupancy there controls
-- how many rows the pricing matrix shows.
-- ---------------------------------------------------------------------
with p as (select id from properties where slug = 'greek-club-dahab')
insert into room_types (property_id, code, name, base_occupancy, max_occupancy, base_rate, sort_order)
select p.id, 'STD', 'غرفة قياسية', 2, 4, 0, 1
from p
on conflict (property_id, code) do nothing;

-- ---------------------------------------------------------------------
-- 4. The rooms — physical inventory, genuinely fixed.
-- ---------------------------------------------------------------------
with p as (select id from properties where slug = 'greek-club-dahab')
insert into rooms (property_id, room_type_id, number, floor)
select p.id, rt.id, v.number, v.floor
from p
join room_types rt on rt.property_id = p.id and rt.code = 'STD'
join (values
  ('101', 'الأول'), ('102', 'الأول'), ('103', 'الأول'),
  ('104', 'الأول'), ('105', 'الأول'), ('106', 'الأول')
) as v(number, floor) on true
on conflict (property_id, number) do nothing;

-- ---------------------------------------------------------------------
-- 5. Owner access.
--
-- Sign up through the app first, then run this with your user id.
--   select id, email from auth.users;
--
-- insert into property_members (property_id, user_id, role)
-- select p.id, '<YOUR-AUTH-USER-ID>'::uuid, 'owner'
-- from properties p where p.slug = 'greek-club-dahab'
-- on conflict (property_id, user_id) do update set role = 'owner';
-- ---------------------------------------------------------------------
