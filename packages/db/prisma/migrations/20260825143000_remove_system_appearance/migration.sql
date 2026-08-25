-- System is no longer a user-facing preference. Existing profiles move to the
-- deterministic Light default before PostgreSQL's enum is narrowed.
UPDATE "trove"."profiles"
SET "appearance" = 'light'
WHERE "appearance" = 'system';

ALTER TYPE "trove"."profile_appearance" RENAME TO "profile_appearance_with_system";

CREATE TYPE "trove"."profile_appearance" AS ENUM ('light', 'dark');

ALTER TABLE "trove"."profiles"
ALTER COLUMN "appearance" TYPE "trove"."profile_appearance"
USING "appearance"::text::"trove"."profile_appearance";

DROP TYPE "trove"."profile_appearance_with_system";
