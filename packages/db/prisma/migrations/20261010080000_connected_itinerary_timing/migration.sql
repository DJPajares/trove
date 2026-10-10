-- Timing intent is independent of where a time came from. Null preserves legacy
-- rules: traveller/unclassified exact slots fixed, AI estimates flexible.
ALTER TYPE "trove"."itinerary_time_provenance" ADD VALUE 'app_estimated';
ALTER TYPE "trove"."itinerary_duration_provenance" ADD VALUE 'app_estimated';
CREATE TYPE "trove"."itinerary_timing_flexibility" AS ENUM ('fixed', 'flexible');
ALTER TABLE "trove"."itinerary_items" ADD COLUMN "timing_flexibility" "trove"."itinerary_timing_flexibility";
