-- create_booking is SECURITY INVOKER, so it runs with the caller's rights
-- and needs to be able to call this. Revoking it broke every new booking.
-- Safe to expose: it only returns a reference string like "GC26-0001".
grant execute on function next_booking_reference(uuid) to authenticated;

-- Keep it away from logged-out visitors.
revoke all on function next_booking_reference(uuid) from public, anon;
