-- Allow storing destination sub-guides (cities, islands, regions) alongside
-- each country's root guide (slug = '') in trove.atlas_guides.
ALTER TABLE "trove"."atlas_guides" ADD COLUMN "slug" VARCHAR(120) NOT NULL DEFAULT '';

DROP INDEX "trove"."atlas_guides_country_code_language_key";

CREATE UNIQUE INDEX "atlas_guides_country_code_slug_language_key"
  ON "trove"."atlas_guides"("country_code", "slug", "language");
