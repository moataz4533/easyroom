-- Every auth user needs a profile row. Doing this by hand would mean a
-- broken login for any staff member added from the dashboard, so the
-- database creates it on signup.
create or replace function handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- Backfill the account that already exists.
insert into public.profiles (id, full_name)
select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1))
from auth.users u
on conflict (id) do nothing;

-- Grant ownership of The Greek Club.
insert into property_members (property_id, user_id, role, is_active)
select p.id, u.id, 'owner', true
from properties p, auth.users u
where p.slug = 'greek-club-dahab' and u.email = 'moataz4533@gmail.com'
on conflict (property_id, user_id) do update set role = 'owner', is_active = true;
