-- Views default to the creator's permissions, which would let one
-- property read another's rows straight through the view. Force them to
-- run as the querying user so RLS applies.
alter view today_board      set (security_invoker = on);
alter view attention_queue  set (security_invoker = on);
alter view blocked_rooms    set (security_invoker = on);

-- Pin the search_path so the trigger can't be hijacked by a shadowed table.
create or replace function set_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Permission helpers must not be callable by logged-out visitors.
revoke execute on function auth_property_ids()                          from anon;
revoke execute on function is_member(uuid)                              from anon;
revoke execute on function has_role(uuid, staff_role[])                 from anon;
revoke execute on function can_manage(uuid)                             from anon;
revoke execute on function is_admin(uuid)                               from anon;
revoke execute on function next_booking_reference(uuid)                 from anon;

-- Nothing in this app should be reachable without signing in.
revoke execute on function available_rooms(uuid, date, date, uuid)      from anon;
revoke execute on function resolve_rate(uuid, uuid, uuid, int, date)    from anon;
revoke execute on function quote_stay(uuid, uuid, uuid, int, date, date) from anon;
revoke execute on function create_booking(uuid, uuid, date, date, jsonb, uuid, uuid, booking_source, text) from anon;
revoke execute on function check_in_booking(uuid)                       from anon;
revoke execute on function check_out_booking(uuid)                      from anon;
revoke execute on function cancel_booking(uuid, text)                   from anon;
revoke execute on function check_extension(uuid, date)                  from anon;
revoke execute on function extend_stay(uuid, date)                      from anon;
revoke execute on function shorten_stay(uuid, date)                     from anon;
revoke execute on function move_room(uuid, uuid, date, text)            from anon;
revoke execute on function suggest_alternative_rooms(uuid, date, date)  from anon;
revoke execute on function block_room(uuid, date, date, text, allocation_kind) from anon;
revoke execute on function unblock_room(uuid)                           from anon;
revoke execute on function release_booking_room(uuid, text)             from anon;
revoke execute on function mark_no_show(uuid, numeric)                  from anon;
revoke execute on function recalc_booking_total(uuid)                   from anon;

-- next_booking_reference is an internal detail of create_booking.
revoke execute on function next_booking_reference(uuid) from authenticated;
