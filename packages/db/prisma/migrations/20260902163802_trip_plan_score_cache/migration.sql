-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "plan_score" JSONB,
ADD COLUMN     "plan_score_computed_at" TIMESTAMPTZ(3),
ADD COLUMN     "plan_score_revision" VARCHAR(64);
