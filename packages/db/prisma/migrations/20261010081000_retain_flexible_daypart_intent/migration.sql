-- An estimated exact slot can retain the traveller's coarse timing intent.
-- Fixed slots keep the original mutually exclusive shape.
ALTER TABLE "trove"."itinerary_items" DROP CONSTRAINT "itinerary_items_schedule_shape";
ALTER TABLE "trove"."itinerary_items" ADD CONSTRAINT "itinerary_items_schedule_shape" CHECK (
  "local_start_time" IS NULL OR "day_part" IS NULL
  OR "timing_flexibility" IS NOT DISTINCT FROM 'flexible'::"trove"."itinerary_timing_flexibility"
);
