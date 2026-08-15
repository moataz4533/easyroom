-- A copy of the hotel the hotel actually holds.
--
-- On the free plan Supabase keeps no backups at all. Until that changes,
-- the only copy of three years of bookings, the guest register the law
-- requires, and every number in the reports is one database nobody has a
-- second of. This does not fix that — a proper daily backup is still the
-- thing to buy — but it means a copy can sit on the manager's laptop and in
-- their email, taken in one tap, tonight.
--
-- Everything the hotel owns, in one call so the whole file is a single
-- consistent moment rather than fourteen queries taken seconds apart while
-- reception is still working.
--
-- Admins only. A backup is every guest's phone number and every price the
-- hotel charges, which is more than reception needs in one file.

create or replace function public.export_property_data(p_property uuid)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_out jsonb;
begin
  if not is_admin(p_property) then
    raise exception 'النسخة الاحتياطية من صلاحية المدير أو المالك فقط'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'format', 'easyroom-backup',
    'version', 1,
    'taken_at', now(),
    'property_id', p_property,
    'data', jsonb_build_object(
      'property',        (select to_jsonb(p) from properties p where p.id = p_property),
      'room_types',      coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order) from room_types t where t.property_id = p_property), '[]'::jsonb),
      'rooms',           coalesce((select jsonb_agg(to_jsonb(r) order by r.number) from rooms r where r.property_id = p_property), '[]'::jsonb),
      'rate_plans',      coalesce((select jsonb_agg(to_jsonb(rp) order by rp.sort_order) from rate_plans rp where rp.property_id = p_property), '[]'::jsonb),
      'rates',           coalesce((select jsonb_agg(to_jsonb(x)) from rates x where x.property_id = p_property), '[]'::jsonb),
      'rate_seasons',    coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_on) from rate_seasons x where x.property_id = p_property), '[]'::jsonb),
      'accounts',        coalesce((select jsonb_agg(to_jsonb(x)) from accounts x where x.property_id = p_property), '[]'::jsonb),
      'charge_items',    coalesce((select jsonb_agg(to_jsonb(x)) from charge_items x where x.property_id = p_property), '[]'::jsonb),
      'guests',          coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from guests x where x.property_id = p_property), '[]'::jsonb),
      'bookings',        coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from bookings x where x.property_id = p_property), '[]'::jsonb),
      'room_allocations',coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_on) from room_allocations x where x.property_id = p_property), '[]'::jsonb),
      'allocation_nights',coalesce((select jsonb_agg(to_jsonb(x) order by x.night) from allocation_nights x where x.property_id = p_property), '[]'::jsonb),
      'payments',        coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from payments x where x.property_id = p_property), '[]'::jsonb),
      'booking_charges', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from booking_charges x where x.property_id = p_property), '[]'::jsonb),
      'housekeeping_tasks', coalesce((select jsonb_agg(to_jsonb(x) order by x.scheduled_for) from housekeeping_tasks x where x.property_id = p_property), '[]'::jsonb),
      -- Who works here and what they may do. Deliberately no passwords:
      -- those live in Supabase's own auth tables, hashed, and a backup file
      -- that carried them would be a worse problem than the one it solves.
      'members',         coalesce((select jsonb_agg(jsonb_build_object(
                            'user_id', m.user_id, 'role', m.role,
                            'is_active', m.is_active, 'login_username', m.login_username))
                          from property_members m where m.property_id = p_property), '[]'::jsonb)
    )
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.export_property_data(uuid) from public, anon;
grant execute on function public.export_property_data(uuid) to authenticated;

-- Reading a backup back in.
--
-- Two rules, both there to stop this being a way to lose data rather than
-- to get it back.
--
-- It restores the hotel it came from, and no other. A backup carries the
-- original ids of every guest and booking, so reading it into a different
-- hotel would not copy the data, it would graft one hotel's guest list into
-- another's — and the isolation policies would refuse half of it anyway,
-- leaving a half-restored mess.
--
-- And only into a hotel with no bookings in it. Merging into a live hotel
-- would mean deciding what a conflict is — the same booking, or a different
-- one that happens to share a room and a night — and getting that wrong
-- silently is worse than not restoring at all. After a loss there is no such
-- question, which is exactly when a restore is wanted.
-- Every row that goes in is stamped with the hotel being restored, whatever
-- the file said. The function runs as the definer — writing rates needs it,
-- the same reason save_rates does — so a file cannot be edited to smuggle
-- rows into a hotel it does not belong to.
create or replace function public.scoped_rows(p_property uuid, p_rows jsonb, p_drop text[] default '{}')
returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(
           (e - p_drop) || jsonb_build_object('property_id', p_property)
         ), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) e;
$$;

revoke all on function public.scoped_rows(uuid, jsonb, text[]) from public, anon;

create or replace function public.restore_property_data(p_property uuid, p_backup jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  d jsonb := p_backup -> 'data';
  v_existing int;
  v_counts jsonb;
  v_table text;
  v_cols text;
begin
  if not is_admin(p_property) then
    raise exception 'الاسترداد من صلاحية المدير أو المالك فقط' using errcode = '42501';
  end if;
  if p_backup ->> 'format' is distinct from 'easyroom-backup' then
    raise exception 'هذا الملف ليس نسخة احتياطية من Easyroom';
  end if;
  if d is null then
    raise exception 'الملف لا يحتوي على بيانات';
  end if;
  if (p_backup ->> 'property_id')::uuid is distinct from p_property then
    raise exception 'هذه النسخة تخص فندقاً آخر. تُسترد في الفندق الذي أُخذت منه فقط';
  end if;

  select count(*) into v_existing from bookings where property_id = p_property;
  if v_existing > 0 then
    raise exception 'هذا الفندق به % حجزاً بالفعل. الاسترداد يتم في فندق فارغ فقط', v_existing;
  end if;

  -- Order matters: a booking needs its guest, an allocation needs its
  -- booking. Column lists are read from the catalogue rather than written
  -- out, because several tables carry generated columns — a stay's date
  -- range, a charge's line total — and Postgres refuses an insert that so
  -- much as names one. Reading them means a column added later is restored
  -- without anybody remembering to come back here.
  foreach v_table in array array[
    'room_types', 'rooms', 'rate_plans', 'rates', 'rate_seasons',
    'accounts', 'charge_items', 'guests', 'bookings', 'room_allocations',
    'payments', 'booking_charges'
  ] loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into v_cols
    from information_schema.columns
    where table_schema = 'public' and table_name = v_table
      and is_generated = 'NEVER' and identity_generation is null;

    execute format(
      'insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, public.scoped_rows($1, $2 -> %L, $3)) on conflict (id) do nothing',
      v_table, v_cols, v_cols, v_table, v_table)
    -- Nothing is dropped from the JSON: the generated columns are simply
    -- never named in the insert, so whatever the file says about them is
    -- ignored and the database recomputes them.
    using p_property, d, '{}'::text[];
  end loop;

  -- The nights are written by the trigger on room_allocations as those rows
  -- land, so they are rebuilt rather than restored — which also proves the
  -- restored prices still add up to the restored totals.

  select jsonb_build_object(
    'rooms',     (select count(*) from rooms where property_id = p_property),
    'guests',    (select count(*) from guests where property_id = p_property),
    'bookings',  (select count(*) from bookings where property_id = p_property),
    'payments',  (select count(*) from payments where property_id = p_property)
  ) into v_counts;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (p_property, auth.uid(), 'security', p_property, 'restored',
          jsonb_build_object('taken_at', p_backup ->> 'taken_at', 'restored', v_counts));

  return v_counts;
end;
$$;

revoke all on function public.restore_property_data(uuid, jsonb) from public, anon;
grant execute on function public.restore_property_data(uuid, jsonb) to authenticated;
