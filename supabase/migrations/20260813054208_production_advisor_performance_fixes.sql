-- Safe production performance follow-up from Supabase Advisor.

create index if not exists rates_room_type_id_idx
  on public.rates (room_type_id);

create index if not exists rooms_room_type_id_idx
  on public.rooms (room_type_id);

drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_insert_self on public.profiles;
drop policy if exists profiles_update_self on public.profiles;

create policy profiles_insert_self
  on public.profiles
  for insert
  to authenticated
  with check (id = (select auth.uid()));

create policy profiles_update_self
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
