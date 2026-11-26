-- Store CC0 Wikidata quick facts (languages, plug types, driving side,
-- national dish) on each Atlas country row (PRD 40.1 & 40.3).
ALTER TABLE "trove"."atlas_countries" ADD COLUMN "quick_facts" JSONB;
