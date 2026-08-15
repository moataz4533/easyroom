-- Enough of Supabase for the migrations to replay: the auth schema, the
-- roles, and auth.uid() reading a session setting we can set per test.
create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist;
create extension if not exists pg_trgm;
grant usage on schema extensions to public;

do $$ begin
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create role supabase_admin superuser login;
exception when duplicate_object then null; end $$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  last_sign_in_at timestamptz,
  created_at timestamptz default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated')
$$;

grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant all on functions to authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;

-- Two functions the real project carries from before the migration history
-- began (created through the dashboard). Stubbed so `revoke` finds them;
-- neither is exercised by the behaviour tests below.
create or replace function public.handle_new_user() returns trigger
language plpgsql as $$ begin return new; end $$;

create or replace function public.rls_auto_enable() returns event_trigger
language plpgsql as $$ begin end $$;

-- Supabase Storage, enough of it that the logo-bucket migration replays.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to authenticated, service_role;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/')
$$;
