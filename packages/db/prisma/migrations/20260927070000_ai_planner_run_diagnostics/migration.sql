ALTER TABLE "trove"."ai_generation_runs"
  ADD COLUMN "total_latency_ms" INTEGER,
  ADD COLUMN "reasoning_tokens" INTEGER,
  ADD COLUMN "finish_reason" VARCHAR(80),
  ADD COLUMN "failure_stage" VARCHAR(40),
  ADD COLUMN "validation_codes" VARCHAR(80)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(80)[],
  ADD COLUMN "validation_paths" VARCHAR(160)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(160)[],
  ADD COLUMN "deadline_at" TIMESTAMPTZ(3);

UPDATE "trove"."ai_generation_runs"
SET "deadline_at" = "dispatched_at" + INTERVAL '3 minutes'
WHERE "result" = 'pending' AND "dispatched_at" IS NOT NULL;

ALTER TABLE "trove"."ai_generation_runs"
  ADD CONSTRAINT "ai_generation_runs_total_latency_nonnegative"
    CHECK ("total_latency_ms" IS NULL OR "total_latency_ms" >= 0),
  ADD CONSTRAINT "ai_generation_runs_reasoning_tokens_nonnegative"
    CHECK ("reasoning_tokens" IS NULL OR "reasoning_tokens" >= 0);

CREATE INDEX "ai_generation_runs_pending_deadline_idx"
  ON "trove"."ai_generation_runs" ("deadline_at")
  WHERE "result" = 'pending';
