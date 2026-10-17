-- CreateEnum
CREATE TYPE "trove"."place_category" AS ENUM ('destination', 'things_to_do', 'food_and_drink', 'stay', 'shopping', 'transport', 'other');

-- AlterTable
ALTER TABLE "trove"."places" ADD COLUMN     "categories" "trove"."place_category"[] DEFAULT ARRAY[]::"trove"."place_category"[];

-- AlterTable
ALTER TABLE "trove"."trip_places" ADD COLUMN     "categories" "trove"."place_category"[] DEFAULT ARRAY[]::"trove"."place_category"[];

-- Backfill: a Trip Place is a stay when the trip already treats it as one - its
-- default Stay, a Stay range, a day's start or end, or an accommodation booking.
-- Confident signals only; nothing here guesses from names.
WITH stay_trip_places AS (
  SELECT "default_stay_trip_place_id" AS "id" FROM "trove"."trips" WHERE "default_stay_trip_place_id" IS NOT NULL
  UNION SELECT "trip_place_id" FROM "trove"."trip_stay_ranges"
  UNION SELECT "daily_base_trip_place_id" FROM "trove"."itinerary_days" WHERE "daily_base_trip_place_id" IS NOT NULL
  UNION SELECT "daily_base_departure_trip_place_id" FROM "trove"."itinerary_days" WHERE "daily_base_departure_trip_place_id" IS NOT NULL
  UNION SELECT "trip_place_id" FROM "trove"."reservations" WHERE "trip_place_id" IS NOT NULL AND "type" = 'accommodation'
),
-- A Custom Place belongs to its owner, so the category lives on the Place and
-- follows it to every trip.
custom_places AS (
  UPDATE "trove"."places" AS "place"
  SET "categories" = array_append("place"."categories", 'stay')
  FROM "trove"."trip_places" AS "trip_place"
  WHERE "trip_place"."place_id" = "place"."id"
    AND "trip_place"."id" IN (SELECT "id" FROM stay_trip_places)
    AND "place"."kind" = 'custom'
    AND NOT ('stay' = ANY("place"."categories"))
  RETURNING "place"."id"
)
-- A provider Place is shared, so this trip records it instead.
UPDATE "trove"."trip_places" AS "trip_place"
SET "categories" = array_append("trip_place"."categories", 'stay')
FROM "trove"."places" AS "place"
WHERE "trip_place"."place_id" = "place"."id"
  AND "trip_place"."id" IN (SELECT "id" FROM stay_trip_places)
  AND "place"."kind" = 'provider'
  AND NOT ('stay' = ANY("trip_place"."categories"));
