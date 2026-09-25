-- Pause API writers during this migration and deploy the matching API before
-- resuming them. Old versions write reflections to itinerary_days.
CREATE TABLE "trove"."day_experiences" (
  "id" UUID NOT NULL,
  "trip_id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "rating" INTEGER,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "day_experiences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "day_experiences_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "day_experiences_content_check" CHECK (
    "rating" IS NOT NULL OR NULLIF(btrim("note"), '') IS NOT NULL
  ),
  CONSTRAINT "day_experiences_trip_id_fkey" FOREIGN KEY ("trip_id")
    REFERENCES "trove"."trips"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "day_experiences_trip_id_date_key" ON "trove"."day_experiences"("trip_id", "date");

INSERT INTO "trove"."day_experiences" ("id", "trip_id", "date", "rating", "note", "created_at", "updated_at")
SELECT "id", "trip_id", "date", "experience_rating", NULLIF(btrim("experience_note"), ''), "created_at", "updated_at"
FROM "trove"."itinerary_days"
WHERE "experience_rating" IS NOT NULL OR NULLIF(btrim("experience_note"), '') IS NOT NULL;

ALTER TABLE "trove"."itinerary_days" DROP COLUMN "experience_rating", DROP COLUMN "experience_note";

-- Private API-only records. Prisma's server role enforces trip ownership;
-- browser roles have neither grants nor policies on this table.
ALTER TABLE "trove"."day_experiences" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "trove"."day_experiences" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "trove"."day_experiences" FROM authenticated;
  END IF;
END $$;
