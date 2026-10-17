-- Re-file every dated expense on the trip day with its date. Links were only
-- written when an expense was saved, so a trip extended or moved afterwards
-- left expenses on no day (or on a day with a different date) even though
-- their date falls inside the trip.
UPDATE "trove"."expenses" AS "expense"
SET "itinerary_day_id" = "day"."id"
FROM "trove"."itinerary_days" AS "day"
WHERE "day"."trip_id" = "expense"."trip_id"
  AND "day"."date" = "expense"."local_date"
  AND "expense"."itinerary_day_id" IS DISTINCT FROM "day"."id";

-- A dated expense whose date is no longer a trip day belongs to no day.
UPDATE "trove"."expenses" AS "expense"
SET "itinerary_day_id" = NULL
WHERE "expense"."local_date" IS NOT NULL
  AND "expense"."itinerary_day_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "trove"."itinerary_days" AS "day"
    WHERE "day"."trip_id" = "expense"."trip_id" AND "day"."date" = "expense"."local_date"
  );
