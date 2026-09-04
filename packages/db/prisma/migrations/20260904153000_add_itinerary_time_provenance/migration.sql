CREATE TYPE "trove"."itinerary_time_provenance" AS ENUM ('user_owned', 'ai_estimated');

ALTER TABLE "trove"."itinerary_items"
ADD COLUMN "time_provenance" "trove"."itinerary_time_provenance";

-- Every exact time predating AI-estimated scheduling came from the traveller.
UPDATE "trove"."itinerary_items"
SET "time_provenance" = 'user_owned'
WHERE "local_start_time" IS NOT NULL;

ALTER TABLE "trove"."itinerary_items"
ADD CONSTRAINT "itinerary_items_time_provenance_context" CHECK (
  (
    "local_start_time" IS NULL
    AND "time_provenance" IS NULL
  )
  OR
  (
    "local_start_time" IS NOT NULL
    AND "time_provenance" IS NOT NULL
  )
);
