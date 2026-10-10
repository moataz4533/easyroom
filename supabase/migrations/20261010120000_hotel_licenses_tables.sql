-- Hotel licences, part 1: where they are kept.
--
-- The platform could open a hotel and switch one off, but nothing said for
-- how long a hotel had paid, so "switch it off" was a decision somebody had
-- to remember to make. A licence is an end date. Past it, and past a grace
-- period, the hotel locks itself the same way a suspended one does — that
-- half is part 2.
--
-- Hotels can neither read nor write these tables. A hotel owner can update
-- `properties` (that is how the settings screen saves), so the end date
-- cannot live there — an owner could extend their own licence with one
-- request. Both tables have row security on and no policies; only platform
-- functions, each gated on is_platform_admin(), touch them.
--
-- Every hotel already on the platform is given an open-ended licence here,
-- so nothing that runs today locks because of this.
--
-- Applied to production as its own migration. The first attempt was one
-- file with a trigger on `properties`, and every apply timed out. The
-- database was never the cause — no session was waiting, nothing was
-- locked — it was the tool used to apply migrations, which stalled on any
-- SQL containing a destructive statement (a `drop … if exists` was enough).
-- So this part went first, and part 2 does without the trigger and without
-- a single destructive statement.

create table if not exists public.property_licenses (
  property_id uuid primary key references public.properties(id) on delete cascade,
  kind        text not null default 'trial',
  ends_on     date,
  grace_days  int  not null default 7,
  notes       text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint property_licenses_kind_valid check (kind in ('trial', 'paid', 'unlimited')),
  constraint property_licenses_end_matches_kind check ((kind = 'unlimited') = (ends_on is null)),
  constraint property_licenses_grace_sane check (grace_days between 0 and 60)
);

comment on table public.property_licenses is
  'How long each hotel may use the app. No policies: only platform functions read or write it.';

create table if not exists public.license_events (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties(id) on delete cascade,
  kind          text not null,
  months        int,
  previous_kind text,
  new_kind      text,
  previous_end  date,
  new_end       date,
  amount        numeric(12,2),
  currency      text,
  method        text,
  note          text,
  actor_id      uuid,
  created_at    timestamptz not null default now(),
  constraint license_events_kind_valid check (kind in ('opened', 'extended', 'set')),
  constraint license_events_amount_sane check (amount is null or amount >= 0),
  constraint license_events_months_sane check (months is null or months between 1 and 60)
);

create index if not exists license_events_property_idx
  on public.license_events (property_id, created_at desc);

comment on table public.license_events is
  'Every change to a licence and every payment against one. Append-only; no policies.';

alter table public.property_licenses enable row level security;
alter table public.license_events    enable row level security;
revoke all on public.property_licenses from anon, authenticated;
revoke all on public.license_events    from anon, authenticated;

/**
 * One word for where a licence stands, the same everywhere it is shown.
 * Fourteen days is the warning window: long enough to arrange a payment,
 * short enough that the warning still means something.
 */
create or replace function public.license_state(p_ends_on date, p_grace int, p_today date)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_ends_on is null                         then 'unlimited'
    when p_today > p_ends_on + coalesce(p_grace, 0) then 'expired'
    when p_today > p_ends_on                       then 'grace'
    when p_ends_on - p_today <= 14                 then 'expiring'
    else 'active'
  end;
$$;

-- Everything already here keeps working exactly as it does today.
insert into public.property_licenses (property_id, kind, ends_on, notes)
select p.id, 'unlimited', null, 'كان شغّال قبل نظام التراخيص'
  from public.properties p
 where not exists (select 1 from public.property_licenses l where l.property_id = p.id);

insert into public.license_events (property_id, kind, new_kind, note)
select p.id, 'opened', 'unlimited', 'كان شغّال قبل نظام التراخيص'
  from public.properties p
 where not exists (select 1 from public.license_events e where e.property_id = p.id);
