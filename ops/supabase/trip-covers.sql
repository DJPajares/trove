-- Run once in the Supabase SQL editor for the Trove project.
-- Trip covers remain private and are scoped to the authenticated user's UUID.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trip-covers',
  'trip-covers',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "trip covers are readable by their owner" on storage.objects;
create policy "trip covers are readable by their owner"
on storage.objects for select to authenticated
using (
  bucket_id = 'trip-covers'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "trip covers are uploadable by their owner" on storage.objects;
create policy "trip covers are uploadable by their owner"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'trip-covers'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "trip covers are changeable by their owner" on storage.objects;
create policy "trip covers are changeable by their owner"
on storage.objects for update to authenticated
using (
  bucket_id = 'trip-covers'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'trip-covers'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "trip covers are removable by their owner" on storage.objects;
create policy "trip covers are removable by their owner"
on storage.objects for delete to authenticated
using (
  bucket_id = 'trip-covers'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
