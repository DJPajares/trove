CREATE TYPE "trove"."reservation_type" AS ENUM (
  'flight', 'accommodation', 'restaurant', 'attraction', 'train', 'rental_car', 'tour', 'other'
);

CREATE TYPE "trove"."reservation_time_zone_source" AS ENUM (
  'trip_place', 'itinerary_item', 'trip_reference'
);

CREATE TABLE "trove"."reservations" (
  "id" UUID NOT NULL,
  "trip_id" UUID NOT NULL,
  "trip_place_id" UUID,
  "itinerary_item_id" UUID,
  "title" TEXT NOT NULL,
  "type" "trove"."reservation_type",
  "provider" TEXT,
  "booking_reference" TEXT,
  "notes" TEXT,
  "local_date" DATE,
  "local_time" TIME(0),
  "time_zone" TEXT,
  "time_zone_source" "trove"."reservation_time_zone_source",
  "time_zone_resolved_at" TIMESTAMPTZ(3),
  "planned_cost_amount" DECIMAL(12,2),
  "planned_cost_currency_code" CHAR(3),
  "check_in_date" DATE,
  "check_out_date" DATE,
  "accommodation_address" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reservations_id_trip_id_key" UNIQUE ("id", "trip_id"),
  CONSTRAINT "reservations_title_not_blank" CHECK (btrim("title") <> ''),
  CONSTRAINT "reservations_time_zone_context" CHECK (
    ("local_date" IS NULL AND "local_time" IS NULL AND "time_zone" IS NULL AND "time_zone_source" IS NULL AND "time_zone_resolved_at" IS NULL)
    OR ("local_date" IS NOT NULL AND "time_zone" IS NOT NULL AND btrim("time_zone") <> '' AND "time_zone_source" IS NOT NULL AND "time_zone_resolved_at" IS NOT NULL)
  ),
  CONSTRAINT "reservations_planned_cost_pair" CHECK (("planned_cost_amount" IS NULL) = ("planned_cost_currency_code" IS NULL)),
  CONSTRAINT "reservations_planned_cost_nonnegative" CHECK ("planned_cost_amount" IS NULL OR "planned_cost_amount" >= 0),
  CONSTRAINT "reservations_planned_cost_currency_format" CHECK ("planned_cost_currency_code" IS NULL OR btrim("planned_cost_currency_code") ~ '^[A-Z]{3}$'),
  CONSTRAINT "reservations_accommodation_dates" CHECK ("check_in_date" IS NULL OR "check_out_date" IS NULL OR "check_out_date" >= "check_in_date"),
  CONSTRAINT "reservations_accommodation_address_not_blank" CHECK ("accommodation_address" IS NULL OR btrim("accommodation_address") <> '')
);

CREATE TABLE "trove"."reservation_attachments" (
  "id" UUID NOT NULL,
  "reservation_id" UUID NOT NULL,
  "path" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reservation_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reservation_attachments_reservation_id_path_key" UNIQUE ("reservation_id", "path"),
  CONSTRAINT "reservation_attachments_path_not_blank" CHECK (btrim("path") <> ''),
  CONSTRAINT "reservation_attachments_file_name_not_blank" CHECK (btrim("file_name") <> ''),
  CONSTRAINT "reservation_attachments_content_type_not_blank" CHECK (btrim("content_type") <> ''),
  CONSTRAINT "reservation_attachments_size_bytes_nonnegative" CHECK ("size_bytes" >= 0)
);

CREATE TABLE "trove"."reservation_accommodation_days" (
  "reservation_id" UUID NOT NULL,
  "itinerary_day_id" UUID NOT NULL,
  "trip_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reservation_accommodation_days_pkey" PRIMARY KEY ("reservation_id", "itinerary_day_id")
);

CREATE INDEX "reservations_trip_id_local_date_idx" ON "trove"."reservations"("trip_id", "local_date");
CREATE INDEX "reservations_trip_place_id_trip_id_idx" ON "trove"."reservations"("trip_place_id", "trip_id");
CREATE INDEX "reservations_itinerary_item_id_trip_id_idx" ON "trove"."reservations"("itinerary_item_id", "trip_id");
CREATE INDEX "reservation_attachments_reservation_id_idx" ON "trove"."reservation_attachments"("reservation_id");
CREATE INDEX "reservation_accommodation_days_itinerary_day_id_trip_id_idx" ON "trove"."reservation_accommodation_days"("itinerary_day_id", "trip_id");

ALTER TABLE "trove"."reservations"
  ADD CONSTRAINT "reservations_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trove"."trips"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "reservations_trip_place_id_trip_id_fkey" FOREIGN KEY ("trip_place_id", "trip_id") REFERENCES "trove"."trip_places"("id", "trip_id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "reservations_itinerary_item_id_trip_id_fkey" FOREIGN KEY ("itinerary_item_id", "trip_id") REFERENCES "trove"."itinerary_items"("id", "trip_id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "trove"."reservation_attachments"
  ADD CONSTRAINT "reservation_attachments_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "trove"."reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trove"."reservation_accommodation_days"
  ADD CONSTRAINT "reservation_accommodation_days_reservation_id_trip_id_fkey" FOREIGN KEY ("reservation_id", "trip_id") REFERENCES "trove"."reservations"("id", "trip_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "reservation_accommodation_days_itinerary_day_id_trip_id_fkey" FOREIGN KEY ("itinerary_day_id", "trip_id") REFERENCES "trove"."itinerary_days"("id", "trip_id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'reservation-documents',
      'reservation-documents',
      false,
      10485760,
      ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
    )
    ON CONFLICT (id) DO UPDATE SET
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

    DROP POLICY IF EXISTS "reservation documents are private to their uploader" ON storage.objects;
    CREATE POLICY "reservation documents are private to their uploader"
      ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'reservation-documents' AND (storage.foldername(name))[1] = (select auth.uid()::text));

    DROP POLICY IF EXISTS "reservation documents can be uploaded by their uploader" ON storage.objects;
    CREATE POLICY "reservation documents can be uploaded by their uploader"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'reservation-documents' AND (storage.foldername(name))[1] = (select auth.uid()::text));

    DROP POLICY IF EXISTS "reservation documents can be removed by their uploader" ON storage.objects;
    CREATE POLICY "reservation documents can be removed by their uploader"
      ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'reservation-documents' AND (storage.foldername(name))[1] = (select auth.uid()::text));
  END IF;
END $$;
