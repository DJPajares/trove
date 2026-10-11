-- AlterTable
ALTER TABLE "trove"."ai_place_grounding_cache" ADD COLUMN "identity_fingerprint" VARCHAR(64);
ALTER TABLE "trove"."ai_place_grounding_cache" ADD COLUMN "country_code" VARCHAR(2);
