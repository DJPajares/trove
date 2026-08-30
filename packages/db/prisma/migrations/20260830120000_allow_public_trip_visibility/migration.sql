-- `trips_owner_only_visibility` pinned every trip to `private`, which is what
-- kept the column honest while `visibility` was scaffolding no code read. A trip
-- can now be published read-only, so the constraint is widened rather than
-- dropped: `shared` stays out.
--
-- `shared` is for named collaborators, which nothing implements. A row in that
-- state would be one no query, no serializer and no screen knows how to treat,
-- so the database keeps refusing it until something does.
ALTER TABLE "trove"."trips"
DROP CONSTRAINT "trips_owner_only_visibility";

ALTER TABLE "trove"."trips"
ADD CONSTRAINT "trips_supported_visibility" CHECK ("visibility" IN ('private', 'public'));
