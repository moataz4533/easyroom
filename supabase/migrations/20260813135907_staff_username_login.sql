-- Staff members sign in with a short property-scoped username.

alter table public.property_members
  add column if not exists login_username text;

comment on column public.property_members.login_username is
  'Lowercase staff login name scoped to one property. Owners may keep this null and sign in with email.';

alter table public.property_members
  drop constraint if exists property_members_login_username_format;

alter table public.property_members
  add constraint property_members_login_username_format
  check (
    login_username is null
    or (
      login_username = lower(login_username)
      and login_username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'
    )
  );

create unique index if not exists property_members_property_login_username_key
  on public.property_members (property_id, lower(login_username))
  where login_username is not null;
