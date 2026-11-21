-- AlterTable
-- Every traveller has a public view (PRD 8.3); there is no profile switch.
ALTER TABLE "trove"."profiles" DROP COLUMN IF EXISTS "is_public";
