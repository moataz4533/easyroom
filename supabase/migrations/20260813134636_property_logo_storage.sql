-- Public hotel branding bucket with admin-only writes.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'property-branding',
  'property-branding',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists property_branding_admin_select on storage.objects;
drop policy if exists property_branding_admin_insert on storage.objects;
drop policy if exists property_branding_admin_update on storage.objects;
drop policy if exists property_branding_admin_delete on storage.objects;

create policy property_branding_admin_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'property-branding'
    and exists (
      select 1
      from public.property_members member
      where member.user_id = (select auth.uid())
        and member.is_active
        and member.role in ('owner', 'manager')
        and member.property_id::text = (storage.foldername(name))[1]
    )
  );

create policy property_branding_admin_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'property-branding'
    and exists (
      select 1
      from public.property_members member
      where member.user_id = (select auth.uid())
        and member.is_active
        and member.role in ('owner', 'manager')
        and member.property_id::text = (storage.foldername(name))[1]
    )
  );

create policy property_branding_admin_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'property-branding'
    and exists (
      select 1
      from public.property_members member
      where member.user_id = (select auth.uid())
        and member.is_active
        and member.role in ('owner', 'manager')
        and member.property_id::text = (storage.foldername(name))[1]
    )
  )
  with check (
    bucket_id = 'property-branding'
    and exists (
      select 1
      from public.property_members member
      where member.user_id = (select auth.uid())
        and member.is_active
        and member.role in ('owner', 'manager')
        and member.property_id::text = (storage.foldername(name))[1]
    )
  );

create policy property_branding_admin_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'property-branding'
    and exists (
      select 1
      from public.property_members member
      where member.user_id = (select auth.uid())
        and member.is_active
        and member.role in ('owner', 'manager')
        and member.property_id::text = (storage.foldername(name))[1]
    )
  );
