do $$
declare
  v_prop uuid; v_ok boolean; v_hash text;
begin
  select id into v_prop from properties where slug = 'greek-club-dahab';

  -- Set a PIN directly (bypassing the admin check, which needs a session).
  insert into property_secrets (property_id, action_pin_hash)
  values (v_prop, extensions.crypt('4821', extensions.gen_salt('bf')))
  on conflict (property_id) do update
    set action_pin_hash = excluded.action_pin_hash, failed_attempts = 0, locked_until = null;

  select action_pin_hash into v_hash from property_secrets where property_id = v_prop;

  -- The stored value must not be the PIN itself.
  raise notice 'stored value is the raw PIN (expect f): %', (v_hash = '4821');
  raise notice 'stored as bcrypt (expect t): %', (v_hash like '$2a$%');

  -- Right and wrong PIN
  raise notice 'correct PIN verifies (expect t): %', (v_hash = extensions.crypt('4821', v_hash));
  raise notice 'wrong PIN verifies   (expect f): %', (v_hash = extensions.crypt('0000', v_hash));

  -- Direct writes to rates must now be impossible even for an owner.
  raise notice 'rates has a blocking policy (expect t): %',
    exists (select 1 from pg_policies where tablename = 'rates' and policyname = 'rates_no_direct_write');

  -- Nobody can read the hash table.
  raise notice 'property_secrets has zero policies (expect 0): %',
    (select count(*) from pg_policies where tablename = 'property_secrets');

  -- Leave no PIN set: the owner chooses one from the app.
  delete from property_secrets where property_id = v_prop;
  raise notice 'test PIN removed';
end $$;
