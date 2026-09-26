ALTER TABLE "trove"."ai_planning_sessions"
  ADD COLUMN "reviewed_countries" CHAR(2)[] NOT NULL DEFAULT ARRAY[]::CHAR(2)[],
  ADD COLUMN "countries_reviewed_revision" INTEGER,
  ADD COLUMN "country_context_changed" BOOLEAN NOT NULL DEFAULT false;
