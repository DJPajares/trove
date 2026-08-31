-- Add the dispatch reservation fields as nullable/defaulted first so existing
-- content-free run telemetry can be migrated without downtime.
ALTER TABLE "trove"."ai_generation_runs"
ADD COLUMN "idempotency_key" UUID,
ADD COLUMN "base_draft_revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "dispatched_at" TIMESTAMPTZ(3);

-- Legacy runs predate reservations. Give each one a unique owner-scoped key and
-- conservatively count completed work as dispatched at its original creation.
UPDATE "trove"."ai_generation_runs"
SET
  "idempotency_key" = gen_random_uuid(),
  "dispatched_at" = CASE
    WHEN "result" = 'pending' THEN NULL
    ELSE "created_at"
  END;

ALTER TABLE "trove"."ai_generation_runs"
ALTER COLUMN "idempotency_key" SET NOT NULL,
ADD CONSTRAINT "ai_generation_runs_base_draft_revision_nonnegative"
CHECK ("base_draft_revision" >= 0),
ADD CONSTRAINT "ai_generation_runs_dispatch_context"
CHECK ("dispatched_at" IS NULL OR "dispatched_at" >= "created_at");

CREATE UNIQUE INDEX "ai_generation_runs_owner_id_idempotency_key_key"
ON "trove"."ai_generation_runs"("owner_id", "idempotency_key");

CREATE INDEX "ai_generation_runs_owner_id_dispatched_at_idx"
ON "trove"."ai_generation_runs"("owner_id", "dispatched_at");
