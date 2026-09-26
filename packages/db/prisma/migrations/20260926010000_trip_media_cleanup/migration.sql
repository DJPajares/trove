CREATE TABLE "trove"."trip_media_cleanup" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "trip_id" UUID NOT NULL,
  "bucket" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_until" TIMESTAMPTZ(3),
  "lease_token" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trip_media_cleanup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trip_media_cleanup_bucket_check" CHECK ("bucket" IN ('trip-covers', 'memory-photos', 'reservation-documents')),
  CONSTRAINT "trip_media_cleanup_path_check" CHECK (btrim("path") <> ''),
  CONSTRAINT "trip_media_cleanup_attempt_count_check" CHECK ("attempt_count" >= 0)
);
CREATE UNIQUE INDEX "trip_media_cleanup_bucket_path_key" ON "trove"."trip_media_cleanup"("bucket", "path");
CREATE INDEX "trip_media_cleanup_next_attempt_at_lease_until_idx" ON "trove"."trip_media_cleanup"("next_attempt_at", "lease_until");
CREATE INDEX "trip_media_cleanup_trip_id_idx" ON "trove"."trip_media_cleanup"("trip_id");

ALTER TABLE "trove"."trip_media_cleanup" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "trove"."trip_media_cleanup" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "trove"."trip_media_cleanup" FROM authenticated;
  END IF;
END $$;
