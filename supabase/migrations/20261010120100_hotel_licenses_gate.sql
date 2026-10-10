-- Hotel licences, part 2: the lock, and the platform's controls.
--
-- A hotel with a licence row runs until `ends_on`, then `grace_days` more,
-- then locks. A hotel with NO row is on a fourteen-day trial counted from
-- the day it was created (plus the usual seven days' grace). That second
-- rule is what a trigger on `properties` was going to do — give every new
-- hotel a trial so the platform cannot give one away forever by forgetting
-- a box — done instead by reading `created_at`, which needs no trigger and
-- so cannot be skipped by a hotel created some other way. Every hotel that
-- existed before this has an explicit open-ended row from part 1, so none
-- of them is affected.
--
-- The lock lives in the three isolation gates, next to the suspension check
-- that is already there — not in a screen. An expired hotel's staff stop
-- being members exactly as a suspended hotel's do. The platform operator is
-- never locked out: is_platform_admin() does not go through membership.

-- ----------------------------------------------- the licence in effect --
/**
 * The licence a hotel is actually on: its row if it has one, otherwise the
 * implicit trial. Every reader goes through this so there is one answer.
 */
create or replace function public.effective_license(p_property uuid)
returns table (kind text, ends_on date, grace_days int, today date, explicit boolean)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(l.kind, 'trial'),
         case when l.property_id is not null then l.ends_on
              else (p.created_at at time zone p.timezone)::date + 14 end,
         coalesce(l.grace_days, 7),
         (now() at time zone p.timezone)::date,
         l.property_id is not null
    from public.properties p
    left join public.property_licenses l on l.property_id = p.id
   where p.id = p_property;
$$;

revoke all on function public.effective_license(uuid) from public, anon, authenticated;

/** True once a hotel is past its end date and its grace period. */
create or replace function public.license_locked(p_property uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select e.ends_on is not null and e.ends_on + e.grace_days < e.today
       from public.effective_license(p_property) e),
    false);
$$;

revoke all on function public.license_locked(uuid) from public, anon, authenticated;

-- ---------------------------------------------- the three gates, again --
-- Unchanged except for one clause each. The isolation suite is re-run
-- against them, before and after, and has to give the same answers.
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
      and not public.license_locked(p.id)
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
      and not public.license_locked(p.id)
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
    and m.role in ('owner', 'manager', 'reception')
    and not public.license_locked(p.id);
$$;

-- ------------------------------------------ what a hotel may see of it --
/**
 * Every hotel this account belongs to, with where its licence stands —
 * including hotels that are locked. That is the point: a locked hotel is
 * invisible through every other door, and its staff deserve to be told why
 * instead of an empty screen. Only the account's own memberships, and only
 * the state — never what was paid.
 */
create or replace function public.my_hotel_licenses()
returns table (
  property_id uuid, name text, slug text, hotel_active boolean,
  kind text, ends_on date, grace_until date, days_left int, state text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.slug, p.is_active,
         e.kind, e.ends_on, e.ends_on + e.grace_days, e.ends_on - e.today,
         public.license_state(e.ends_on, e.grace_days, e.today)
    from public.property_members m
    join public.properties p on p.id = m.property_id
    cross join lateral public.effective_license(p.id) e
   where m.user_id = auth.uid()
     and m.is_active;
$$;

revoke all on function public.my_hotel_licenses() from public, anon;
grant execute on function public.my_hotel_licenses() to authenticated;

-- --------------------------------------------------- platform: listing --
create or replace function public.platform_licenses()
returns table (
  property_id uuid, kind text, ends_on date, grace_days int, notes text, explicit boolean,
  today date, days_left int, state text,
  paid_total numeric, paid_this_year numeric, last_paid_on date
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return query
    select p.id, e.kind, e.ends_on, e.grace_days, l.notes, e.explicit,
           e.today, e.ends_on - e.today,
           public.license_state(e.ends_on, e.grace_days, e.today),
           coalesce((select sum(ev.amount) from public.license_events ev
                      where ev.property_id = p.id), 0),
           coalesce((select sum(ev.amount) from public.license_events ev
                      where ev.property_id = p.id
                        and date_trunc('year', ev.created_at) = date_trunc('year', now())), 0),
           (select max(ev.created_at)::date from public.license_events ev
             where ev.property_id = p.id and coalesce(ev.amount, 0) > 0)
      from public.properties p
      cross join lateral public.effective_license(p.id) e
      left join public.property_licenses l on l.property_id = p.id
     order by p.created_at;
end;
$$;

revoke all on function public.platform_licenses() from public, anon;
grant execute on function public.platform_licenses() to authenticated;

-- ---------------------------------------------- platform: extend by months --
/**
 * The everyday action: the hotel paid for N months.
 *
 * Where the new months start from is the part that needs a rule:
 *   - still running (or in its warning window): from the current end date,
 *     so paying early never loses a day;
 *   - in grace: also from the current end date, so the grace days are a
 *     courtesy and not free months;
 *   - fully expired, or open-ended: from today, because a locked hotel was
 *     not using the days it would otherwise be charged for.
 */
create or replace function public.platform_extend_license(
  p_property uuid, p_months int, p_amount numeric default null,
  p_currency text default 'EGP', p_method text default null, p_note text default null
)
returns public.property_licenses
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_before record;
  v_after public.property_licenses;
  v_base date;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_months is null or p_months < 1 or p_months > 60 then
    raise exception 'المدة لازم تكون من شهر لـ٦٠ شهر';
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'المبلغ مينفعش يبقى بالسالب';
  end if;

  perform 1 from public.property_licenses where property_id = p_property for update;
  select * into v_before from public.effective_license(p_property);
  if v_before.today is null then raise exception 'الفندق مش موجود'; end if;

  v_base := case
    when v_before.ends_on is null then v_before.today
    when v_before.ends_on + v_before.grace_days < v_before.today then v_before.today
    else v_before.ends_on
  end;

  insert into public.property_licenses (property_id, kind, ends_on, grace_days, updated_at, updated_by)
  values (p_property, 'paid', (v_base + make_interval(months => p_months))::date,
          v_before.grace_days, now(), auth.uid())
  on conflict (property_id) do update
    set kind = 'paid', ends_on = excluded.ends_on,
        updated_at = now(), updated_by = auth.uid()
  returning * into v_after;

  insert into public.license_events (
    property_id, kind, months, previous_kind, new_kind, previous_end, new_end,
    amount, currency, method, note, actor_id
  ) values (
    p_property, 'extended', p_months, v_before.kind, v_after.kind,
    v_before.ends_on, v_after.ends_on,
    p_amount, nullif(trim(coalesce(p_currency, '')), ''),
    nullif(trim(coalesce(p_method, '')), ''), nullif(trim(coalesce(p_note, '')), ''),
    auth.uid()
  );

  return v_after;
end;
$$;

revoke all on function public.platform_extend_license(uuid, int, numeric, text, text, text) from public, anon;
grant execute on function public.platform_extend_license(uuid, int, numeric, text, text, text) to authenticated;

-- -------------------------------------------- platform: set it outright --
/**
 * For everything that is not "N more months": a trial, a specific date, an
 * open-ended licence, a different grace period, or ending a licence today.
 */
create or replace function public.platform_set_license(
  p_property uuid, p_kind text, p_ends_on date default null,
  p_grace_days int default null, p_note text default null
)
returns public.property_licenses
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_before record;
  v_notes text;
  v_after public.property_licenses;
  v_kind text := lower(trim(coalesce(p_kind, '')));
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_kind not in ('trial', 'paid', 'unlimited') then
    raise exception 'نوع الترخيص لازم يكون تجريبي أو مدفوع أو مفتوح';
  end if;
  if v_kind = 'unlimited' and p_ends_on is not null then
    raise exception 'الترخيص المفتوح مالوش تاريخ نهاية';
  end if;
  if v_kind <> 'unlimited' and p_ends_on is null then
    raise exception 'حدد تاريخ نهاية الترخيص';
  end if;
  if p_grace_days is not null and (p_grace_days < 0 or p_grace_days > 60) then
    raise exception 'فترة السماح من ٠ لـ٦٠ يوم';
  end if;
  if not exists (select 1 from public.properties where id = p_property) then
    raise exception 'الفندق مش موجود';
  end if;

  select notes into v_notes from public.property_licenses where property_id = p_property for update;
  select * into v_before from public.effective_license(p_property);

  insert into public.property_licenses (property_id, kind, ends_on, grace_days, notes, updated_at, updated_by)
  values (p_property, v_kind, case when v_kind = 'unlimited' then null else p_ends_on end,
          coalesce(p_grace_days, v_before.grace_days, 7),
          coalesce(nullif(trim(coalesce(p_note, '')), ''), v_notes),
          now(), auth.uid())
  on conflict (property_id) do update
    set kind = excluded.kind, ends_on = excluded.ends_on,
        grace_days = excluded.grace_days, notes = excluded.notes,
        updated_at = now(), updated_by = auth.uid()
  returning * into v_after;

  insert into public.license_events (
    property_id, kind, previous_kind, new_kind, previous_end, new_end, note, actor_id
  ) values (
    p_property, 'set', v_before.kind, v_after.kind, v_before.ends_on, v_after.ends_on,
    nullif(trim(coalesce(p_note, '')), ''), auth.uid()
  );

  return v_after;
end;
$$;

revoke all on function public.platform_set_license(uuid, text, date, int, text) from public, anon;
grant execute on function public.platform_set_license(uuid, text, date, int, text) to authenticated;

-- ------------------------------------------------- platform: history --
create or replace function public.platform_license_history(p_property uuid)
returns table (
  id uuid, kind text, months int, previous_kind text, new_kind text,
  previous_end date, new_end date, amount numeric, currency text,
  method text, note text, actor_name text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return query
    select e.id, e.kind, e.months, e.previous_kind, e.new_kind,
           e.previous_end, e.new_end, e.amount, e.currency,
           e.method, e.note, pr.full_name, e.created_at
      from public.license_events e
      left join public.profiles pr on pr.id = e.actor_id
     where e.property_id = p_property
     order by e.created_at desc
     limit 100;
end;
$$;

revoke all on function public.platform_license_history(uuid) from public, anon;
grant execute on function public.platform_license_history(uuid) to authenticated;
