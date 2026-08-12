-- =====================================================================
-- 0001_core_schema.sql
-- Multi-tenant property management core.
-- Every business table carries property_id. Nothing is hardcoded to a
-- single hotel: branding, room types, rates and policies are all data.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";   -- needed for the exclusion constraint below
create extension if not exists "pg_trgm";      -- fuzzy guest-name search at reception

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type staff_role as enum ('owner', 'manager', 'reception', 'housekeeping');

create type booking_status as enum (
  'inquiry',      -- someone asked on WhatsApp, not confirmed yet
  'confirmed',
  'checked_in',
  'checked_out',
  'cancelled',
  'no_show'
);

create type booking_source as enum (
  'whatsapp', 'phone', 'walk_in', 'website', 'ota', 'referral', 'other'
);

-- Physical occupancy of a room. A booking is the commercial record;
-- an allocation is "this room is physically unavailable on these dates".
create type allocation_kind as enum ('booking', 'maintenance', 'hold', 'staff');

-- Housekeeping condition. INDEPENDENT from whether a guest is in the room.
create type housekeeping_status as enum ('clean', 'dirty', 'inspected', 'out_of_order');

create type task_type as enum (
  'checkout_clean', 'stayover_clean', 'deep_clean', 'linen_change', 'maintenance', 'inspection'
);

create type task_status as enum ('pending', 'in_progress', 'done', 'blocked');

-- ---------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------
create table properties (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  name            text not null,
  legal_name      text,

  -- Branding is DATA, not code. This is what makes the app resellable.
  logo_url        text,
  primary_color   text default '#1E5F74',
  secondary_color text default '#F5B841',

  -- Locale / operational config
  timezone        text not null default 'Africa/Cairo',
  currency        text not null default 'EGP',
  default_check_in_time  time not null default '14:00',
  default_check_out_time time not null default '12:00',

  -- Anything property-specific that doesn't deserve a column yet:
  -- cancellation policy, WhatsApp number, tax rates, feature flags.
  settings        jsonb not null default '{}'::jsonb,

  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on column properties.settings is
  'Per-tenant config. Read at runtime, never branch on property name in code.';

-- ---------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------

-- Mirrors auth.users. A person exists once, even if they work at 3 hotels.
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text,
  phone        text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The join table that makes multi-tenancy real.
create table property_members (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references properties(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  role         staff_role not null default 'reception',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (property_id, user_id)
);

create index on property_members (user_id);
create index on property_members (property_id, role);

-- ---------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------
create table room_types (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references properties(id) on delete cascade,
  code           text not null,             -- 'DBL', 'SEA-VIEW'
  name           text not null,
  description    text,
  base_occupancy int not null default 2,
  max_occupancy  int not null default 2,
  base_rate      numeric(12,2) not null default 0,   -- per night, property currency
  amenities      jsonb not null default '[]'::jsonb,
  photos         jsonb not null default '[]'::jsonb,
  sort_order     int not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (property_id, code),
  check (max_occupancy >= base_occupancy)
);

create table rooms (
  id                  uuid primary key default gen_random_uuid(),
  property_id         uuid not null references properties(id) on delete cascade,
  room_type_id        uuid not null references room_types(id) on delete restrict,
  number              text not null,          -- '101', 'Bamboo Hut 3'
  floor               text,
  housekeeping_status housekeeping_status not null default 'clean',
  notes               text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (property_id, number)
);

create index on rooms (property_id, room_type_id);
create index on rooms (property_id, housekeeping_status);

-- ---------------------------------------------------------------------
-- Guests
-- ---------------------------------------------------------------------
create table guests (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references properties(id) on delete cascade,
  full_name     text not null,
  phone         text,                        -- primary key in practice: WhatsApp
  email         text,
  nationality   text,
  id_number     text,                        -- passport / national ID
  date_of_birth date,
  notes         text,                        -- allergies, repeat guest, preferences
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Reception searches by phone constantly. Also catches duplicates.
create index on guests (property_id, phone);
create index guests_name_trgm_idx on guests using gin (full_name gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Bookings (the commercial record)
-- ---------------------------------------------------------------------
create table bookings (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references properties(id) on delete cascade,
  reference      text not null,              -- human-readable: 'GC-2601'
  guest_id       uuid not null references guests(id) on delete restrict,

  status         booking_status not null default 'confirmed',
  source         booking_source not null default 'walk_in',

  check_in       date not null,
  check_out      date not null,
  adults         int not null default 1,
  children       int not null default 0,

  total_amount   numeric(12,2) not null default 0,
  paid_amount    numeric(12,2) not null default 0,
  currency       text not null default 'EGP',

  notes          text,
  created_by     uuid references profiles(id) on delete set null,
  cancelled_at   timestamptz,
  cancel_reason  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (property_id, reference),
  check (check_out > check_in),
  check (paid_amount >= 0 and total_amount >= 0)
);

create index on bookings (property_id, check_in);
create index on bookings (property_id, status);
create index on bookings (guest_id);

-- ---------------------------------------------------------------------
-- Room allocations (the physical record) -- THE important table
--
-- One table holds every reason a room is unavailable: a guest, a
-- maintenance block, a hold, staff use. Because they all live here, a
-- SINGLE database-level constraint makes double-booking impossible --
-- not "unlikely if the frontend is correct", but impossible.
-- ---------------------------------------------------------------------
create table room_allocations (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references properties(id) on delete cascade,
  room_id      uuid not null references rooms(id) on delete restrict,
  booking_id   uuid references bookings(id) on delete cascade,  -- null for maintenance/hold
  kind         allocation_kind not null default 'booking',

  starts_on    date not null,
  ends_on      date not null,                -- exclusive: guest leaves this morning

  -- Stored generated range, half-open so checkout day is free for the next guest.
  stay         daterange generated always as (daterange(starts_on, ends_on, '[)')) stored,

  rate_per_night numeric(12,2),
  released_at    timestamptz,                -- cancelled allocations stop blocking
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  check (ends_on > starts_on),
  check ((kind = 'booking') = (booking_id is not null)),

  -- The whole point:
  constraint no_overlapping_allocations
    exclude using gist (room_id with =, stay with &&)
    where (released_at is null)
);

create index on room_allocations (property_id, starts_on, ends_on);
create index on room_allocations (booking_id);
create index on room_allocations (room_id) where released_at is null;

-- ---------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------
create table housekeeping_tasks (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references properties(id) on delete cascade,
  room_id      uuid not null references rooms(id) on delete cascade,
  booking_id   uuid references bookings(id) on delete set null,

  task_type    task_type not null default 'checkout_clean',
  status       task_status not null default 'pending',
  scheduled_for date not null default current_date,
  priority     int not null default 0,

  assigned_to  uuid references profiles(id) on delete set null,
  started_at   timestamptz,
  completed_at timestamptz,
  completed_by uuid references profiles(id) on delete set null,

  notes        text,
  photos       jsonb not null default '[]'::jsonb,   -- damage / proof of clean
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index on housekeeping_tasks (property_id, scheduled_for, status);
create index on housekeeping_tasks (assigned_to, status);
create index on housekeeping_tasks (room_id);

-- ---------------------------------------------------------------------
-- Payments (minimal, expandable)
-- ---------------------------------------------------------------------
create table payments (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references properties(id) on delete cascade,
  booking_id   uuid not null references bookings(id) on delete cascade,
  amount       numeric(12,2) not null,
  currency     text not null default 'EGP',
  method       text not null default 'cash',    -- cash | card | transfer | instapay
  reference    text,
  received_by  uuid references profiles(id) on delete set null,
  received_at  timestamptz not null default now(),
  notes        text,
  created_at   timestamptz not null default now()
);

create index on payments (booking_id);
create index on payments (property_id, received_at);

-- ---------------------------------------------------------------------
-- Activity log -- who did what. Hotels need this for disputes.
-- ---------------------------------------------------------------------
create table activity_log (
  id           bigserial primary key,
  property_id  uuid not null references properties(id) on delete cascade,
  actor_id     uuid references profiles(id) on delete set null,
  entity_type  text not null,        -- 'booking' | 'room' | 'task'
  entity_id    uuid,
  action       text not null,        -- 'checked_in' | 'status_changed'
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index on activity_log (property_id, created_at desc);
create index on activity_log (entity_type, entity_id);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'properties','profiles','room_types','rooms','guests',
    'bookings','room_allocations','housekeeping_tasks'
  ] loop
    execute format(
      'create trigger trg_%s_updated_at before update on %I
       for each row execute function set_updated_at()', t, t);
  end loop;
end $$;
