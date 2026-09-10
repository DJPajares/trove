-- Home location becomes a country, and a country implies a time zone.
--
-- The free-text home location was stored as a CUSTOM Place whose time zone was
-- never resolved, which is why the PROFILE_HOME branch of the trip time zone
-- resolver could never fire. A country code can answer that question offline
-- and for free, so the profile now holds the code and the zone it implies.
--
-- The existing free-text values are dropped: a city name cannot be mapped to a
-- country reliably, and the field reads as unset until the traveller picks one.
-- The Place rows themselves are deliberately left alone - a home place is
-- reused by name, so a row here may also be a saved place or a trip place.
ALTER TABLE "trove"."profiles" ADD COLUMN "home_country_code" CHAR(2);
ALTER TABLE "trove"."profiles" ADD COLUMN "home_time_zone" TEXT;

DROP INDEX IF EXISTS "trove"."profiles_home_place_id_idx";

ALTER TABLE "trove"."profiles" DROP CONSTRAINT IF EXISTS "profiles_home_place_id_fkey";
ALTER TABLE "trove"."profiles" DROP COLUMN "home_place_id";
