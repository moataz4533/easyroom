-- The sign-in screen names the hotel before anybody has signed in.
--
-- A staff sign-in has always needed the hotel's code, and the screen used
-- to fill one in for everybody — the first hotel's — so every other hotel's
-- staff arrived at a box holding somebody else's branch. Now the screen is
-- neutral, each hotel has its own link (/h/{code}), and the hotel is shown
-- by its name and logo instead of by a code.
--
-- That needs the name before there is a session, so this is the one thing
-- about a hotel an anonymous caller can ask: given the code, its name and
-- logo — what is written on its door anyway. Nothing else is returned, and
-- nothing is returned without the exact code: there is no listing.
create or replace function public.hotel_by_code(p_code text)
returns table (slug text, name text, name_en text, logo_url text)
language sql
stable
security definer
set search_path = public
as $$
  select p.slug, nullif(trim(p.name), ''), nullif(trim(p.name_en), ''), p.logo_url
    from public.properties p
   where p.slug = lower(trim(coalesce(p_code, '')))
   limit 1;
$$;

revoke all on function public.hotel_by_code(text) from public;
grant execute on function public.hotel_by_code(text) to anon, authenticated;
