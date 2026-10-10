-- Existing drafts retain their original 14-day contract. New runs snapshot their plan limit.
ALTER TABLE "trove"."ai_planning_sessions" ADD COLUMN "draft_max_days" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "trove"."ai_generation_runs" ADD COLUMN "max_itinerary_days" INTEGER;

CREATE TABLE "trove"."user_entitlements" (
  "owner_id" UUID NOT NULL PRIMARY KEY,
  "plan_key" VARCHAR(80) NOT NULL DEFAULT 'free',
  "monthly_anchor_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "user_entitlements_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "trove"."ai_credit_periods" (
  "id" UUID NOT NULL PRIMARY KEY,
  "owner_id" UUID NOT NULL,
  "plan_key" VARCHAR(80) NOT NULL,
  "renewal_policy" VARCHAR(20) NOT NULL,
  "start_at" TIMESTAMPTZ(3) NOT NULL,
  "end_at" TIMESTAMPTZ(3),
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "allowance" INTEGER NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0,
  "reserved" INTEGER NOT NULL DEFAULT 0,
  "source" VARCHAR(40) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_credit_periods_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_credit_period_balance" CHECK (allowance >= 0 AND used >= 0 AND reserved >= 0 AND used + reserved <= allowance),
  CONSTRAINT "ai_credit_period_policy" CHECK (renewal_policy IN ('lifetime', 'monthly') AND sequence >= 0 AND (end_at IS NULL OR end_at > start_at))
);
CREATE UNIQUE INDEX "ai_credit_periods_id_owner_id_key" ON "trove"."ai_credit_periods"("id", "owner_id");
CREATE UNIQUE INDEX "ai_credit_periods_owner_id_plan_key_start_at_sequence_key" ON "trove"."ai_credit_periods"("owner_id", "plan_key", "start_at", "sequence");
CREATE TABLE "trove"."ai_credit_actions" (
  "run_id" UUID NOT NULL PRIMARY KEY,
  "owner_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "idempotency_key" UUID NOT NULL,
  "period_id" UUID NOT NULL,
  "state" VARCHAR(20) NOT NULL DEFAULT 'reserved',
  "max_itinerary_days" INTEGER NOT NULL,
  "deadline_at" TIMESTAMPTZ(3) NOT NULL,
  "reserved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settled_at" TIMESTAMPTZ(3),
  "settlement_reason" VARCHAR(120),
  CONSTRAINT "ai_credit_actions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_credit_actions_period_id_owner_id_fkey" FOREIGN KEY ("period_id", "owner_id") REFERENCES "trove"."ai_credit_periods"("id", "owner_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_credit_action_state" CHECK (state IN ('reserved', 'consumed', 'released') AND ((state = 'reserved') = (settled_at IS NULL))),
  CONSTRAINT "ai_credit_action_limits" CHECK (max_itinerary_days > 0 AND deadline_at > reserved_at)
);
CREATE UNIQUE INDEX "ai_credit_actions_owner_id_idempotency_key_key" ON "trove"."ai_credit_actions"("owner_id", "idempotency_key");
CREATE INDEX "ai_credit_actions_owner_id_state_deadline_at_idx" ON "trove"."ai_credit_actions"("owner_id", "state", "deadline_at");
CREATE INDEX "ai_credit_actions_state_deadline_at_idx" ON "trove"."ai_credit_actions"("state", "deadline_at");
CREATE TABLE "trove"."ai_credit_events" (
  "id" UUID NOT NULL PRIMARY KEY,
  "owner_id" UUID NOT NULL,
  "period_id" UUID NOT NULL,
  "run_id" UUID,
  "kind" VARCHAR(20) NOT NULL,
  "amount" INTEGER NOT NULL,
  "source" VARCHAR(120) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_credit_events_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_credit_events_period_id_owner_id_fkey" FOREIGN KEY ("period_id", "owner_id") REFERENCES "trove"."ai_credit_periods"("id", "owner_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_credit_event_kind" CHECK (kind IN ('grant', 'reserve', 'consume', 'release') AND amount >= 0 AND (kind = 'grant' OR amount = 1))
);
CREATE UNIQUE INDEX "ai_credit_events_run_id_kind_key" ON "trove"."ai_credit_events"("run_id", "kind");
CREATE INDEX "ai_credit_events_owner_id_created_at_idx" ON "trove"."ai_credit_events"("owner_id", "created_at");
CREATE INDEX "ai_credit_events_period_id_idx" ON "trove"."ai_credit_events"("period_id");
CREATE TABLE "trove"."admin_operation_audits" (
  "id" UUID NOT NULL PRIMARY KEY,
  "owner_id" UUID NOT NULL,
  "actor_id" VARCHAR(120) NOT NULL,
  "credential_id" VARCHAR(120) NOT NULL,
  "operation" VARCHAR(40) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "idempotency_key" UUID NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "request_id" VARCHAR(120) NOT NULL,
  "before" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_operation_audits_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "admin_operation_reason" CHECK (length(trim(reason)) > 0)
);
CREATE UNIQUE INDEX "admin_operation_audits_actor_id_idempotency_key_key" ON "trove"."admin_operation_audits"("actor_id", "idempotency_key");
CREATE INDEX "admin_operation_audits_owner_id_created_at_idx" ON "trove"."admin_operation_audits"("owner_id", "created_at");

-- Private API-owned accounting; no browser/Auth role can read or mutate these tables.
ALTER TABLE "trove"."user_entitlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trove"."ai_credit_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trove"."ai_credit_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trove"."ai_credit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trove"."admin_operation_audits" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE trove.user_entitlements, trove.ai_credit_periods, trove.ai_credit_actions, trove.ai_credit_events, trove.admin_operation_audits FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
