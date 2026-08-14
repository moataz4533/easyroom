-- Seasonal pricing.
--
-- The database has been ready for this since the pricing matrix landed:
-- `rates` carries valid_from/valid_to, resolve_rate prefers a dated row over
-- the standing one, and quote_stay prices night by night so a stay crossing
-- a season boundary is charged correctly on both sides.
--
-- The one thing missing was a way to write those dated rows. save_rates has
-- `valid_from is null` written into it, so it can only ever touch the
-- standing price. These functions are its dated twin, with the same guards:
-- managers only, manager PIN, and an entry in the activity log.

-- A season needs a name to be manageable, and the rates table has no room
-- for one. It goes in a table of its own rather than repeated on every rate
-- row, so renaming a season is one write and cannot half-apply.
create table if not exists public.rate_seasons (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name        text not null,
  name_en     text,
  starts_on   date not null,
  ends_on     date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (property_id, starts_on)
);

create index if not exists rate_seasons_property_idx
  on public.rate_seasons (property_id, starts_on);

create trigger trg_rate_seasons_updated_at before update on public.rate_seasons
  for each row execute function public.set_updated_at();

alter table public.rate_seasons enable row level security;

-- Reception quotes prices, so it has to read the seasons. Only admins write,
-- and only through the PIN-gated functions below.
drop policy if exists rate_seasons_select on public.rate_seasons;
create policy rate_seasons_select on public.rate_seasons
  for select to authenticated using (public.is_member(property_id));

-- ---------------------------------------------------------------------
-- Writing a season's prices.
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
language plpgsql volatile security invoker set search_path = public, auth as $$
declare
  v_row jsonb;
  v_count int := 0;
begin
  if not is_admin(p_property) then
    raise exception 'المدير أو المالك بس اللي يقدر يغير الأسعار' using errcode = '42501';
  end if;
  if p_from is null or p_to is null then
    raise exception 'الموسم محتاج تاريخ بداية ونهاية';
  end if;
  if p_to < p_from then
    raise exception 'نهاية الموسم لازم تكون بعد بدايته';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'اكتب اسم الموسم';
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

  -- Rates already written for this season keep their end date in step when
  -- the season is shortened or extended.
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
language plpgsql volatile security invoker set search_path = public, auth as $$
declare v_count int;
begin
  if not is_admin(p_property) then
    raise exception 'المدير أو المالك بس اللي يقدر يغير الأسعار' using errcode = '42501';
  end if;

  perform require_action_pin(p_property, p_pin);

  delete from rates where property_id = p_property and valid_from = p_from;
  get diagnostics v_count = row_count;
  delete from rate_seasons where property_id = p_property and starts_on = p_from;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (p_property, auth.uid(), 'rates', p_property, 'season_deleted',
          jsonb_build_object('from', p_from, 'removed', v_count));

  -- Bookings already taken keep the price they were quoted: their totals are
  -- stored, not recomputed on read. Only new quotes fall back to standing.
  return v_count;
end;
$$;

-- What seasons exist, and whether each one is actually priced. A season with
-- no rates behind it looks configured but changes nothing, which is the
-- confusing failure worth showing plainly.
create or replace function public.list_seasons(p_property uuid)
returns table (
  id         uuid,
  name       text,
  name_en    text,
  starts_on  date,
  ends_on    date,
  rate_count bigint,
  is_current boolean
)
language sql stable security invoker set search_path = public as $$
  select
    s.id, s.name, s.name_en, s.starts_on, s.ends_on,
    (select count(*) from rates r
      where r.property_id = s.property_id and r.valid_from = s.starts_on)::bigint,
    (current_date between s.starts_on and s.ends_on)
  from rate_seasons s
  where s.property_id = p_property
    and is_member(s.property_id)
  order by s.starts_on;
$$;

revoke all on function public.save_season_rates(uuid, date, date, text, jsonb, text, text) from public, anon;
revoke all on function public.delete_season(uuid, date, text) from public, anon;
revoke all on function public.list_seasons(uuid) from public, anon;
grant execute on function public.save_season_rates(uuid, date, date, text, jsonb, text, text) to authenticated;
grant execute on function public.delete_season(uuid, date, text) to authenticated;
grant execute on function public.list_seasons(uuid) to authenticated;

-- Rates written before this table existed have dates but no season to name
-- them. Adopt them so they appear in the screen instead of being invisible.
insert into public.rate_seasons (property_id, name, starts_on, ends_on)
select distinct r.property_id, to_char(r.valid_from, 'YYYY-MM-DD'), r.valid_from,
       coalesce(r.valid_to, r.valid_from)
from public.rates r
where r.valid_from is not null
on conflict (property_id, starts_on) do nothing;
