-- CreateTable
-- Atlas guides adapted from Wikivoyage (PRD 40.6): shared, dated, refreshed after 30 days.
CREATE TABLE "trove"."atlas_guide_snapshots" (
    "id" UUID NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "language" VARCHAR(8) NOT NULL DEFAULT 'en',
    "title" TEXT NOT NULL,
    "revision_id" BIGINT NOT NULL,
    "content" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "atlas_guide_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "atlas_guide_snapshots_fetched_at_idx" ON "trove"."atlas_guide_snapshots"("fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "atlas_guide_snapshots_country_code_language_key" ON "trove"."atlas_guide_snapshots"("country_code", "language");

-- Application data stays behind the API, matching the other Trove tables.
ALTER TABLE "trove"."atlas_guide_snapshots" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "trove"."atlas_guide_snapshots" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "trove"."atlas_guide_snapshots" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "trove"."atlas_guide_snapshots" FROM authenticated;
  END IF;
END $$;
