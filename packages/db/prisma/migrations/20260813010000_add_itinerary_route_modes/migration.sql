CREATE TYPE "trove"."route_travel_mode" AS ENUM ('drive', 'transit', 'walk');

ALTER TABLE "trove"."itinerary_days"
  ADD COLUMN "route_start_travel_mode" "trove"."route_travel_mode" NOT NULL DEFAULT 'drive';

ALTER TABLE "trove"."itinerary_items"
  ADD COLUMN "travel_mode_to_next" "trove"."route_travel_mode" NOT NULL DEFAULT 'drive';
