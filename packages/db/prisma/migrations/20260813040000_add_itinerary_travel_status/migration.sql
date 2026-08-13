CREATE TYPE "trove"."itinerary_travel_status" AS ENUM ('upcoming', 'completed', 'skipped');

ALTER TABLE "trove"."itinerary_items"
  ADD COLUMN "travel_status" "trove"."itinerary_travel_status" NOT NULL DEFAULT 'upcoming';
