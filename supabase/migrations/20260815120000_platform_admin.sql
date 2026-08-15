-- The platform, as opposed to a hotel.
--
-- Every role until now has been a role *inside* one hotel. Selling the app
-- to a second hotel needs something above that: whoever runs the platform
-- has to be able to open a new hotel, create its owner's account, and see
-- which accounts are live. That person is not a member of any of those
-- hotels and must not become one.
--
-- The decision worth stating: **being a platform admin grants no access to
-- hotel data.** It does not appear in a single row-level policy. What it
-- does is unlock a panel that reads through an edge function holding the
-- service key, and that function returns counts and account lists — never a
-- guest, never a booking, never a payment. So the isolation boundary the
-- whole app rests on is exactly as tight after this migration as before it,
-- and a stolen platform session cannot read a guest register.

create table if not exists public.platform_admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  note     text,
  added_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Who runs the platform. Deliberately has no row-level policies: it is
   readable only by the service role, from the platform-admin edge function.
   Signed-in users learn their own status from is_platform_admin() and
   nothing else.';

alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

/**
 * Whether the caller runs the platform. Answers only about the caller, so
 * it discloses nothing: a hotel owner asking gets false, and cannot use it
 * to enumerate anybody.
 */
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth'
as $$
  select exists (
    select 1 from platform_admins where user_id = auth.uid()
  );
$$;

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- properties.is_active has been on the table since the core schema and has
-- never been read by anything: not a policy, not a function, not a screen.
-- Below it finally gets the meaning it was always shaped for. The statement
-- is a no-op on any database that already has the column, which is all of
-- them; it is here so a database built from scratch has it too.
alter table public.properties
  add column if not exists is_active boolean not null default true;

comment on column public.properties.is_active is
  'False suspends the whole hotel: its members stop being members until it
   is switched back on. The data is untouched and comes back with it.';

/**
 * The three gates the whole isolation model funnels through. Each one asks
 * property_members the same question; each now also asks whether the hotel
 * is switched on, so suspension is enforced where the data lives rather
 * than in a screen that can be skipped.
 *
 * Nothing else about them changes, and the isolation suite is re-run against
 * them to prove it.
 */
create or replace function public.is_member(p_property uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth'
as $$
  select exists (
    select 1
    from property_members m
    join properties p on p.id = m.property_id
    where m.property_id = p_property
      and m.user_id = auth.uid()
      and m.is_active = true
      and p.is_active = true
  );
$$;

create or replace function public.has_role(p_property uuid, p_roles staff_role[])
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth'
as $$
  select exists (
    select 1
    from property_members m
    join properties p on p.id = m.property_id
    where m.property_id = p_property
      and m.user_id = auth.uid()
      and m.is_active = true
      and p.is_active = true
      and m.role = any(p_roles)
  );
$$;

create or replace function public.manageable_property_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'auth'
as $$
  select m.property_id
  from public.property_members m
  join public.properties p on p.id = m.property_id
  where m.user_id = auth.uid()
    and m.is_active
    and p.is_active
    and m.role in ('owner', 'manager', 'reception');
$$;

-- The first platform admin is whoever already owns the hotel that exists.
-- Written as a lookup rather than a pasted id so it is the same statement
-- on any database, and a no-op where that account is not present.
do $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where email = 'moataz4533@gmail.com';
  if v_uid is null then
    raise notice 'no platform admin seeded: that account is not in this database';
    return;
  end if;
  insert into platform_admins (user_id, note)
  values (v_uid, 'first platform admin')
  on conflict (user_id) do nothing;
  raise notice 'platform admin seeded';
end $$;
