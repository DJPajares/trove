-- CreateEnum
CREATE TYPE "trove"."itinerary_time_semantics" AS ENUM ('floating_local', 'authoritative_instant');

-- AlterTable
ALTER TABLE "trove"."itinerary_items"
ADD COLUMN "custom_location" TEXT,
ADD COLUMN "custom_location_time_zone" TEXT,
ADD COLUMN "start_instant" TIMESTAMPTZ(3),
ADD COLUMN "time_semantics" "trove"."itinerary_time_semantics",
ADD COLUMN "priority" "trove"."trip_place_priority",
ADD COLUMN "planned_cost_amount" DECIMAL(12,2),
ADD COLUMN "planned_cost_currency_code" CHAR(3);

ALTER TABLE "trove"."itinerary_days"
ADD COLUMN "default_time_zone_source_item_id" UUID;

ALTER TABLE "trove"."itinerary_days"
DROP CONSTRAINT "itinerary_days_time_zone_source_context";

ALTER TABLE "trove"."itinerary_days"
ADD CONSTRAINT "itinerary_days_time_zone_source_context" CHECK (
  (
    "default_time_zone_source" = 'explicit_daily_base'
    AND "daily_base_trip_place_id" IS NOT NULL
    AND "default_time_zone_source_trip_place_id" = "daily_base_trip_place_id"
    AND "default_time_zone_source_item_id" IS NULL
  )
  OR
  (
    "default_time_zone_source" = 'first_located_item'
    AND "default_time_zone_source_item_id" IS NOT NULL
  )
  OR
  (
    "default_time_zone_source" IN ('accommodation', 'trip_reference')
    AND "default_time_zone_source_item_id" IS NULL
  )
);

-- Existing day-assigned rows predate the itinerary UI. Backfill their stable
-- day timezone context before enforcing the stronger scheduled-item invariant.
UPDATE "trove"."itinerary_items" AS item
SET
  "time_zone" = day."default_time_zone",
  "time_zone_source" = 'day_default',
  "time_zone_resolved_at" = CURRENT_TIMESTAMP
FROM "trove"."itinerary_days" AS day
WHERE item."itinerary_day_id" = day."id"
  AND item."time_zone" IS NULL;

UPDATE "trove"."itinerary_items" AS item
SET
  "start_instant" = (day."date" + item."local_start_time") AT TIME ZONE item."time_zone",
  "time_semantics" = 'floating_local'
FROM "trove"."itinerary_days" AS day
WHERE item."itinerary_day_id" = day."id"
  AND item."local_start_time" IS NOT NULL
  AND item."start_instant" IS NULL;

-- Replace the original exact-time-only context constraint with the complete
-- scheduled-item and instant/floating-local invariants.
ALTER TABLE "trove"."itinerary_items"
DROP CONSTRAINT "itinerary_items_local_time_context";

ALTER TABLE "trove"."itinerary_items"
ADD CONSTRAINT "itinerary_items_schedule_shape" CHECK (
  "local_start_time" IS NULL OR "day_part" IS NULL
),
ADD CONSTRAINT "itinerary_items_time_zone_context" CHECK (
  (
    "time_zone" IS NULL
    AND "time_zone_source" IS NULL
    AND "time_zone_resolved_at" IS NULL
  )
  OR
  (
    "time_zone" IS NOT NULL
    AND btrim("time_zone") <> ''
    AND "time_zone_source" IS NOT NULL
    AND "time_zone_resolved_at" IS NOT NULL
  )
),
ADD CONSTRAINT "itinerary_items_scheduled_time_zone" CHECK (
  "itinerary_day_id" IS NULL OR "time_zone" IS NOT NULL
),
ADD CONSTRAINT "itinerary_items_local_time_context" CHECK (
  (
    "local_start_time" IS NULL
    AND "start_instant" IS NULL
    AND "time_semantics" IS NULL
  )
  OR
  (
    "local_start_time" IS NOT NULL
    AND "start_instant" IS NOT NULL
    AND "time_semantics" IS NOT NULL
    AND "time_zone" IS NOT NULL
  )
),
ADD CONSTRAINT "itinerary_items_custom_location_not_blank" CHECK (
  "custom_location" IS NULL OR btrim("custom_location") <> ''
),
ADD CONSTRAINT "itinerary_items_custom_location_time_zone_context" CHECK (
  "custom_location_time_zone" IS NULL
  OR (
    btrim("custom_location_time_zone") <> ''
    AND "custom_location" IS NOT NULL
  )
),
ADD CONSTRAINT "itinerary_items_planned_cost_pair" CHECK (
  ("planned_cost_amount" IS NULL) = ("planned_cost_currency_code" IS NULL)
),
ADD CONSTRAINT "itinerary_items_planned_cost_nonnegative" CHECK (
  "planned_cost_amount" IS NULL OR "planned_cost_amount" >= 0
),
ADD CONSTRAINT "itinerary_items_planned_cost_currency_format" CHECK (
  "planned_cost_currency_code" IS NULL
  OR btrim("planned_cost_currency_code") ~ '^[A-Z]{3}$'
);

-- CreateIndex
CREATE UNIQUE INDEX "itinerary_items_id_trip_id_key"
ON "trove"."itinerary_items"("id", "trip_id");

CREATE INDEX "itinerary_days_default_time_zone_source_item_id_trip_id_idx"
ON "trove"."itinerary_days"("default_time_zone_source_item_id", "trip_id");

-- AddForeignKey
ALTER TABLE "trove"."itinerary_days"
ADD CONSTRAINT "itinerary_days_default_time_zone_source_item_id_trip_id_fkey"
FOREIGN KEY ("default_time_zone_source_item_id", "trip_id")
REFERENCES "trove"."itinerary_items"("id", "trip_id")
ON DELETE NO ACTION ON UPDATE CASCADE;
