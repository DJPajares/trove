-- AlterTable
-- Profiles start private: a traveller switches their public view on (PRD 8.3).
ALTER TABLE "trove"."profiles" ADD COLUMN     "is_public" BOOLEAN NOT NULL DEFAULT false;
