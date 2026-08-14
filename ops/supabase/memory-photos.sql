-- Run once in the Supabase SQL editor for the Trove project.
-- Memory photos are private, user-owned media scoped to the authenticated user's UUID.
-- Provider imagery is never stored here; only files the traveller uploaded.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'memory-photos',
  'memory-photos',
  false,
  15728640,
  array['image/heic', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "memory photos are readable by their owner" on storage.objects;
create policy "memory photos are readable by their owner"
on storage.objects for select to authenticated
using (
  bucket_id = 'memory-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "memory photos are uploadable by their owner" on storage.objects;
create policy "memory photos are uploadable by their owner"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'memory-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "memory photos are changeable by their owner" on storage.objects;
create policy "memory photos are changeable by their owner"
on storage.objects for update to authenticated
using (
  bucket_id = 'memory-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'memory-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "memory photos are removable by their owner" on storage.objects;
create policy "memory photos are removable by their owner"
on storage.objects for delete to authenticated
using (
  bucket_id = 'memory-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
