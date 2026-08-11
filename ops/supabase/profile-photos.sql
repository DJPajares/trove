-- Run once in the Supabase SQL editor for the Trove project.
-- Profile photos remain private and are scoped to the authenticated user's UUID.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos',
  'profile-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile photos are readable by their owner" on storage.objects;
create policy "profile photos are readable by their owner"
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "profile photos are uploadable by their owner" on storage.objects;
create policy "profile photos are uploadable by their owner"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "profile photos are changeable by their owner" on storage.objects;
create policy "profile photos are changeable by their owner"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "profile photos are removable by their owner" on storage.objects;
create policy "profile photos are removable by their owner"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
