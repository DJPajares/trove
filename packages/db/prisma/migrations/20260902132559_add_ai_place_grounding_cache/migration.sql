-- CreateTable
CREATE TABLE "ai_place_grounding_cache" (
    "key" VARCHAR(64) NOT NULL,
    "outcome" TEXT NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL,
    "place_provider_ref_id" UUID,

    CONSTRAINT "ai_place_grounding_cache_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "ai_place_grounding_cache_outcome_check" CHECK (
        ("outcome" = 'verified' AND "place_provider_ref_id" IS NOT NULL)
        OR ("outcome" IN ('unresolved', 'ambiguous') AND "place_provider_ref_id" IS NULL)
    )
);

-- Internal server cache only; no client policies or grants.
ALTER TABLE "trove"."ai_place_grounding_cache" ENABLE ROW LEVEL SECURITY;

-- CreateIndex
CREATE INDEX "ai_place_grounding_cache_place_provider_ref_id_idx" ON "ai_place_grounding_cache"("place_provider_ref_id");

-- AddForeignKey
ALTER TABLE "ai_place_grounding_cache" ADD CONSTRAINT "ai_place_grounding_cache_place_provider_ref_id_fkey" FOREIGN KEY ("place_provider_ref_id") REFERENCES "place_provider_refs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
