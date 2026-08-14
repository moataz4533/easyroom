-- Trigger functions were reachable as public API endpoints. Postgres
-- grants EXECUTE to PUBLIC by default, and Supabase exposes anything in
-- the public schema over /rest/v1/rpc — so these SECURITY DEFINER
-- functions could be called by anyone, signed in or not.
--
-- Triggers do not check EXECUTE on the function they fire, so revoking
-- has no effect on normal operation. It only closes the endpoint.
revoke all on function handle_new_auth_user() from public, anon, authenticated;
revoke all on function handle_new_user()      from public, anon, authenticated;
revoke all on function rls_auto_enable()      from public, anon, authenticated;

-- verify_action_pin has to stay callable: cancel_booking runs with the
-- caller's rights and needs it. That is why the lockout exists — five
-- wrong tries and it stops for fifteen minutes, so calling the endpoint
-- directly buys an attacker nothing.
comment on function verify_action_pin(uuid, text) is
  'Callable by signed-in staff by design: the SECURITY INVOKER actions that
   guard on it run with the caller''s rights. Brute force is handled by the
   lockout in property_secrets, not by hiding this function.';
