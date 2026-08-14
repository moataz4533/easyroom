-- Postgres grants EXECUTE to PUBLIC by default, so revoking from `anon`
-- alone changes nothing. Strip PUBLIC, then grant back deliberately.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'auth_property_ids','is_member','has_role','can_manage','is_admin',
        'next_booking_reference','available_rooms','resolve_rate','quote_stay',
        'create_booking','check_in_booking','check_out_booking','cancel_booking',
        'check_extension','extend_stay','shorten_stay','move_room',
        'suggest_alternative_rooms','block_room','unblock_room',
        'release_booking_room','mark_no_show','recalc_booking_total'
      )
  loop
    execute format('revoke all on function %s from public, anon', f.sig);

    -- next_booking_reference is internal to create_booking; nobody calls it directly.
    if f.proname <> 'next_booking_reference' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
