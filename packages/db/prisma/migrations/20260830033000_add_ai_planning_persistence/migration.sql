-- CreateEnum
CREATE TYPE "trove"."itinerary_duration_provenance" AS ENUM ('user_owned', 'ai_estimated');

-- CreateEnum
CREATE TYPE "trove"."ai_planning_session_status" AS ENUM ('pending', 'generating', 'reviewing', 'failed', 'applied', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "trove"."ai_planning_session_stage" AS ENUM ('created', 'generating', 'grounding', 'scheduling', 'validating', 'reviewing', 'applying', 'complete');

-- CreateEnum
CREATE TYPE "trove"."ai_generation_run_result" AS ENUM ('pending', 'succeeded', 'failed', 'cancelled');

-- AlterTable
ALTER TABLE "trove"."itinerary_items"
ADD COLUMN "duration_provenance" "trove"."itinerary_duration_provenance" NOT NULL DEFAULT 'user_owned';

-- CreateTable
CREATE TABLE "trove"."ai_planning_sessions" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "status" "trove"."ai_planning_session_status" NOT NULL DEFAULT 'pending',
    "stage" "trove"."ai_planning_session_stage" NOT NULL DEFAULT 'created',
    "raw_prompt" TEXT,
    "draft" JSONB,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "draft_revision" INTEGER NOT NULL DEFAULT 0,
    "warnings_acknowledged_revision" INTEGER,
    "warnings_acknowledged_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(120),
    "expires_at" TIMESTAMPTZ(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + '7 days'::interval),
    "applied_trip_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_planning_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_planning_sessions_schema_version_positive" CHECK ("schema_version" > 0),
    CONSTRAINT "ai_planning_sessions_draft_revision_nonnegative" CHECK ("draft_revision" >= 0),
    CONSTRAINT "ai_planning_sessions_draft_revision_context" CHECK ("draft" IS NULL OR "draft_revision" > 0),
    CONSTRAINT "ai_planning_sessions_warning_ack_pair" CHECK (("warnings_acknowledged_revision" IS NULL) = ("warnings_acknowledged_at" IS NULL)),
    CONSTRAINT "ai_planning_sessions_warning_ack_revision" CHECK ("warnings_acknowledged_revision" IS NULL OR ("warnings_acknowledged_revision" >= 0 AND "warnings_acknowledged_revision" <= "draft_revision")),
    CONSTRAINT "ai_planning_sessions_expiry_after_creation" CHECK ("expires_at" >= "created_at"),
    CONSTRAINT "ai_planning_sessions_terminal_content_cleared" CHECK (
        "status" NOT IN ('applied', 'cancelled', 'expired')
        OR ("raw_prompt" IS NULL AND "draft" IS NULL)
    ),
    CONSTRAINT "ai_planning_sessions_last_error_not_blank" CHECK ("last_error_code" IS NULL OR btrim("last_error_code") <> '')
);

-- CreateTable
CREATE TABLE "trove"."ai_generation_runs" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "provider" VARCHAR(120) NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "total_tokens" INTEGER,
    "latency_ms" INTEGER,
    "result" "trove"."ai_generation_run_result" NOT NULL DEFAULT 'pending',
    "error_code" VARCHAR(120),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generation_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_generation_runs_provider_not_blank" CHECK (btrim("provider") <> ''),
    CONSTRAINT "ai_generation_runs_model_not_blank" CHECK (btrim("model") <> ''),
    CONSTRAINT "ai_generation_runs_input_tokens_nonnegative" CHECK ("input_tokens" IS NULL OR "input_tokens" >= 0),
    CONSTRAINT "ai_generation_runs_output_tokens_nonnegative" CHECK ("output_tokens" IS NULL OR "output_tokens" >= 0),
    CONSTRAINT "ai_generation_runs_total_tokens_nonnegative" CHECK ("total_tokens" IS NULL OR "total_tokens" >= 0),
    CONSTRAINT "ai_generation_runs_latency_nonnegative" CHECK ("latency_ms" IS NULL OR "latency_ms" >= 0),
    CONSTRAINT "ai_generation_runs_completion_context" CHECK (
        ("result" = 'pending' AND "completed_at" IS NULL)
        OR ("result" <> 'pending' AND "completed_at" IS NOT NULL)
    ),
    CONSTRAINT "ai_generation_runs_error_context" CHECK (
        ("result" = 'failed' AND "error_code" IS NOT NULL AND btrim("error_code") <> '')
        OR ("result" <> 'failed' AND "error_code" IS NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_planning_sessions_applied_trip_id_key" ON "trove"."ai_planning_sessions"("applied_trip_id");

-- CreateIndex
CREATE INDEX "ai_planning_sessions_owner_id_status_updated_at_idx" ON "trove"."ai_planning_sessions"("owner_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "ai_planning_sessions_status_expires_at_idx" ON "trove"."ai_planning_sessions"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_planning_sessions_id_owner_id_key" ON "trove"."ai_planning_sessions"("id", "owner_id");

-- CreateIndex
CREATE INDEX "ai_generation_runs_owner_id_created_at_idx" ON "trove"."ai_generation_runs"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_generation_runs_session_id_created_at_idx" ON "trove"."ai_generation_runs"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_generation_runs_session_id_owner_id_idx" ON "trove"."ai_generation_runs"("session_id", "owner_id");

-- CreateIndex
CREATE INDEX "ai_generation_runs_created_at_idx" ON "trove"."ai_generation_runs"("created_at");

-- AddForeignKey
ALTER TABLE "trove"."ai_planning_sessions" ADD CONSTRAINT "ai_planning_sessions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."ai_planning_sessions" ADD CONSTRAINT "ai_planning_sessions_applied_trip_id_fkey" FOREIGN KEY ("applied_trip_id") REFERENCES "trove"."trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."ai_generation_runs" ADD CONSTRAINT "ai_generation_runs_session_id_owner_id_fkey" FOREIGN KEY ("session_id", "owner_id") REFERENCES "trove"."ai_planning_sessions"("id", "owner_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."ai_generation_runs" ADD CONSTRAINT "ai_generation_runs_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
