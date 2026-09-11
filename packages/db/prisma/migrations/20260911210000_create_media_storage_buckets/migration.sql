-- Three of Trove's four storage buckets were never created by a migration.
-- `reservation-documents` was, in 20260812070000; `trip-covers`,
-- `memory-photos` and `profile-photos` existed only where somebody had made
-- them by hand, so a project restored from these migrations alone answers
-- every upload with "Bucket not found" - which is what attaching a photo to a
-- Memory has been doing.
--
-- Limits and types mirror what the clients already refuse to send:
--   trip-covers     8 MiB, jpeg/png/webp      (apps/web/lib/trips/api.ts)
--   memory-photos  15 MiB, heic/jpeg/png/webp (apps/web/lib/memories/storage.ts)
--   profile-photos  5 MiB, jpeg/png/webp      (apps/web/lib/profile/api.ts)
--
-- All three are private: every read is a signed URL, never a public one.
--
-- Guarded on the storage schema existing, as the reservations migration is, so
-- the shadow database Prisma builds for `migrate dev` - which has no Supabase
-- in it - does not fail here.
DO $$
DECLARE
  bucket RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    RETURN;
  END IF;

  FOR bucket IN
    SELECT *
    FROM (
      VALUES
        ('trip-covers', 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp']),
        (
          'memory-photos',
          15728640,
          ARRAY['image/heic', 'image/jpeg', 'image/png', 'image/webp']
        ),
        ('profile-photos', 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
    ) AS t(id, file_size_limit, allowed_mime_types)
  LOOP
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (bucket.id, bucket.id, false, bucket.file_size_limit, bucket.allowed_mime_types)
    ON CONFLICT (id) DO UPDATE SET
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

    -- Every path in these buckets begins with the owner's user id, so one
    -- clause answers all four verbs. UPDATE is included where the others stop
    -- at INSERT: a Memory photo uploads with `upsert`, so a retry of an
    -- interrupted upload writes over the object it already made.
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects',
      bucket.id || ' objects are private to their owner'
    );
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects FOR SELECT TO authenticated '
      'USING (bucket_id = %L AND (storage.foldername(name))[1] = (select auth.uid()::text))',
      bucket.id || ' objects are private to their owner',
      bucket.id
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects',
      bucket.id || ' objects can be uploaded by their owner'
    );
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects FOR INSERT TO authenticated '
      'WITH CHECK (bucket_id = %L AND (storage.foldername(name))[1] = (select auth.uid()::text))',
      bucket.id || ' objects can be uploaded by their owner',
      bucket.id
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects',
      bucket.id || ' objects can be replaced by their owner'
    );
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects FOR UPDATE TO authenticated '
      'USING (bucket_id = %L AND (storage.foldername(name))[1] = (select auth.uid()::text)) '
      'WITH CHECK (bucket_id = %L AND (storage.foldername(name))[1] = (select auth.uid()::text))',
      bucket.id || ' objects can be replaced by their owner',
      bucket.id,
      bucket.id
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects',
      bucket.id || ' objects can be removed by their owner'
    );
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects FOR DELETE TO authenticated '
      'USING (bucket_id = %L AND (storage.foldername(name))[1] = (select auth.uid()::text))',
      bucket.id || ' objects can be removed by their owner',
      bucket.id
    );
  END LOOP;
END $$;
