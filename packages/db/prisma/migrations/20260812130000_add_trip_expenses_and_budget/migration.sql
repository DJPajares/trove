CREATE TYPE "trove"."expense_category" AS ENUM (
  'food', 'transport', 'stay', 'activities', 'shopping', 'other'
);

CREATE TYPE "trove"."expense_time_zone_source" AS ENUM (
  'itinerary_item', 'trip_place', 'itinerary_day', 'trip_reference'
);

ALTER TABLE "trove"."trips"
  ADD COLUMN "budget_amount" DECIMAL(12,2),
  ADD COLUMN "budget_currency_code" CHAR(3),
  ADD CONSTRAINT "trips_budget_pair" CHECK (("budget_amount" IS NULL) = ("budget_currency_code" IS NULL)),
  ADD CONSTRAINT "trips_budget_nonnegative" CHECK ("budget_amount" IS NULL OR "budget_amount" >= 0),
  ADD CONSTRAINT "trips_budget_currency_format" CHECK ("budget_currency_code" IS NULL OR btrim("budget_currency_code") ~ '^[A-Z]{3}$');

CREATE TABLE "trove"."expenses" (
  "id" UUID NOT NULL,
  "trip_id" UUID NOT NULL,
  "itinerary_day_id" UUID,
  "itinerary_item_id" UUID,
  "trip_place_id" UUID,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency_code" CHAR(3) NOT NULL,
  "title" TEXT,
  "category" "trove"."expense_category",
  "local_date" DATE,
  "local_time" TIME(0),
  "time_zone" TEXT,
  "time_zone_source" "trove"."expense_time_zone_source",
  "time_zone_resolved_at" TIMESTAMPTZ(3),
  "note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "expenses_id_trip_id_key" UNIQUE ("id", "trip_id"),
  CONSTRAINT "expenses_amount_nonnegative" CHECK ("amount" >= 0),
  CONSTRAINT "expenses_currency_format" CHECK (btrim("currency_code") ~ '^[A-Z]{3}$'),
  CONSTRAINT "expenses_title_not_blank" CHECK ("title" IS NULL OR btrim("title") <> ''),
  CONSTRAINT "expenses_note_not_blank" CHECK ("note" IS NULL OR btrim("note") <> ''),
  CONSTRAINT "expenses_time_zone_context" CHECK (
    ("local_date" IS NULL AND "local_time" IS NULL AND "time_zone" IS NULL AND "time_zone_source" IS NULL AND "time_zone_resolved_at" IS NULL AND "itinerary_day_id" IS NULL)
    OR ("local_date" IS NOT NULL AND "time_zone" IS NOT NULL AND btrim("time_zone") <> '' AND "time_zone_source" IS NOT NULL AND "time_zone_resolved_at" IS NOT NULL)
  )
);

CREATE INDEX "expenses_trip_id_local_date_idx" ON "trove"."expenses"("trip_id", "local_date");
CREATE INDEX "expenses_itinerary_day_id_trip_id_idx" ON "trove"."expenses"("itinerary_day_id", "trip_id");
CREATE INDEX "expenses_itinerary_item_id_trip_id_idx" ON "trove"."expenses"("itinerary_item_id", "trip_id");
CREATE INDEX "expenses_trip_place_id_trip_id_idx" ON "trove"."expenses"("trip_place_id", "trip_id");

ALTER TABLE "trove"."expenses"
  ADD CONSTRAINT "expenses_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trove"."trips"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "expenses_itinerary_day_id_trip_id_fkey" FOREIGN KEY ("itinerary_day_id", "trip_id") REFERENCES "trove"."itinerary_days"("id", "trip_id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "expenses_itinerary_item_id_trip_id_fkey" FOREIGN KEY ("itinerary_item_id", "trip_id") REFERENCES "trove"."itinerary_items"("id", "trip_id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "expenses_trip_place_id_trip_id_fkey" FOREIGN KEY ("trip_place_id", "trip_id") REFERENCES "trove"."trip_places"("id", "trip_id") ON DELETE NO ACTION ON UPDATE CASCADE;
