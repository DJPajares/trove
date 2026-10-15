-- CreateEnum
CREATE TYPE "trove"."StayEndpointMode" AS ENUM ('INHERIT', 'PLACE', 'NONE', 'SAME_AS_START');

-- AlterEnum
ALTER TYPE "trove"."day_time_zone_source" ADD VALUE 'stay_plan';

-- AlterTable
ALTER TABLE "trove"."trips" ADD COLUMN     "default_stay_trip_place_id" UUID,
ADD COLUMN     "stay_plan_revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "trove"."itinerary_days" ADD COLUMN     "stay_end_mode" "trove"."StayEndpointMode",
ADD COLUMN     "stay_start_mode" "trove"."StayEndpointMode";

-- CreateTable
CREATE TABLE "trove"."trip_stay_ranges" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "trip_place_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,

    CONSTRAINT "trip_stay_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_stay_ranges_trip_id_start_date_idx" ON "trove"."trip_stay_ranges"("trip_id", "start_date");

-- CreateIndex
CREATE INDEX "trip_stay_ranges_trip_place_id_trip_id_idx" ON "trove"."trip_stay_ranges"("trip_place_id", "trip_id");

-- AddForeignKey
ALTER TABLE "trove"."trips" ADD CONSTRAINT "trips_default_stay_trip_place_id_id_fkey" FOREIGN KEY ("default_stay_trip_place_id", "id") REFERENCES "trove"."trip_places"("id", "trip_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."trip_stay_ranges" ADD CONSTRAINT "trip_stay_ranges_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trove"."trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."trip_stay_ranges" ADD CONSTRAINT "trip_stay_ranges_trip_place_id_trip_id_fkey" FOREIGN KEY ("trip_place_id", "trip_id") REFERENCES "trove"."trip_places"("id", "trip_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Preserve historical manual settings, including an end that followed the start.
UPDATE "trove"."itinerary_days" SET
  "stay_start_mode" = CASE WHEN "daily_base_trip_place_id" IS NULL THEN 'INHERIT'::"trove"."StayEndpointMode" ELSE 'PLACE'::"trove"."StayEndpointMode" END,
  "stay_end_mode" = CASE
    WHEN "daily_base_departure_trip_place_id" IS NOT NULL THEN 'PLACE'::"trove"."StayEndpointMode"
    WHEN "daily_base_trip_place_id" IS NOT NULL THEN 'SAME_AS_START'::"trove"."StayEndpointMode"
    ELSE 'INHERIT'::"trove"."StayEndpointMode" END;
ALTER TABLE "trove"."trip_stay_ranges" ADD CONSTRAINT "trip_stay_ranges_dates_check" CHECK ("start_date" <= "end_date");
ALTER TABLE "trove"."itinerary_days" ADD CONSTRAINT "stay_start_mode_check" CHECK ("stay_start_mode" IS DISTINCT FROM 'SAME_AS_START'::"trove"."StayEndpointMode");

-- Planning stays use a Trip Place without materializing a per-day base.
ALTER TABLE "trove"."itinerary_days" DROP CONSTRAINT "itinerary_days_time_zone_source_context";
ALTER TABLE "trove"."itinerary_days" ADD CONSTRAINT "itinerary_days_time_zone_source_context" CHECK (
  ("default_time_zone_source" = 'explicit_daily_base' AND "daily_base_trip_place_id" IS NOT NULL
    AND "default_time_zone_source_trip_place_id" = "daily_base_trip_place_id" AND "default_time_zone_source_item_id" IS NULL)
  OR ("default_time_zone_source"::text = 'stay_plan' AND "default_time_zone_source_trip_place_id" IS NOT NULL AND "default_time_zone_source_item_id" IS NULL)
  OR ("default_time_zone_source" = 'first_located_item' AND "default_time_zone_source_item_id" IS NOT NULL)
  OR ("default_time_zone_source" IN ('accommodation', 'trip_reference') AND "default_time_zone_source_item_id" IS NULL)
);

-- Private application data stays behind the API, matching the other Trove tables.
ALTER TABLE "trove"."trip_stay_ranges" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "trove"."trip_stay_ranges" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "trove"."trip_stay_ranges" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "trove"."trip_stay_ranges" FROM authenticated;
  END IF;
END $$;
