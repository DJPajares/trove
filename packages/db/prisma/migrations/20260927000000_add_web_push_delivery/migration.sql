CREATE TYPE "trove"."push_delivery_state" AS ENUM ('pending', 'attempted', 'accepted', 'retryable');

CREATE UNIQUE INDEX "notifications_id_owner_id_key" ON "trove"."notifications"("id", "owner_id");

CREATE TABLE "trove"."push_subscriptions" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "push_subscriptions_endpoint_not_blank" CHECK (btrim("endpoint") <> ''),
  CONSTRAINT "push_subscriptions_keys_not_blank" CHECK (btrim("p256dh") <> '' AND btrim("auth") <> '')
);

CREATE TABLE "trove"."push_deliveries" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "subscription_id" UUID NOT NULL,
  "notification_id" UUID NOT NULL,
  "source_version" TEXT NOT NULL,
  "state" "trove"."push_delivery_state" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3),
  "attempted_at" TIMESTAMPTZ(3),
  "accepted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "push_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "push_deliveries_attempts_nonnegative" CHECK ("attempts" >= 0)
);

CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "trove"."push_subscriptions"("endpoint");
CREATE UNIQUE INDEX "push_subscriptions_id_owner_id_key" ON "trove"."push_subscriptions"("id", "owner_id");
CREATE INDEX "push_subscriptions_owner_id_idx" ON "trove"."push_subscriptions"("owner_id");
CREATE UNIQUE INDEX "push_deliveries_subscription_id_notification_id_source_vers_key"
  ON "trove"."push_deliveries"("subscription_id", "notification_id", "source_version");
CREATE INDEX "push_deliveries_state_next_attempt_at_idx" ON "trove"."push_deliveries"("state", "next_attempt_at");
CREATE INDEX "push_deliveries_owner_id_created_at_idx" ON "trove"."push_deliveries"("owner_id", "created_at");

ALTER TABLE "trove"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trove"."push_deliveries" ADD CONSTRAINT "push_deliveries_subscription_id_owner_id_fkey"
  FOREIGN KEY ("subscription_id", "owner_id") REFERENCES "trove"."push_subscriptions"("id", "owner_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trove"."push_deliveries" ADD CONSTRAINT "push_deliveries_notification_id_owner_id_fkey"
  FOREIGN KEY ("notification_id", "owner_id") REFERENCES "trove"."notifications"("id", "owner_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Background dispatch is API-only. Supabase browser roles never query raw endpoints or keys.
ALTER TABLE "trove"."push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trove"."push_deliveries" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "trove"."push_subscriptions" FROM anon;
    REVOKE ALL ON "trove"."push_deliveries" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "trove"."push_subscriptions" FROM authenticated;
    REVOKE ALL ON "trove"."push_deliveries" FROM authenticated;
  END IF;
END $$;

-- Coarse due-source selection stays indexed. Exact instants are derived after selection.
CREATE INDEX "tasks_due_date_pending_idx" ON "trove"."tasks"("due_date", "id")
  WHERE "completed_at" IS NULL AND "due_local_time" IS NOT NULL;
CREATE INDEX "reservations_local_date_timed_idx" ON "trove"."reservations"("local_date", "id")
  WHERE "local_time" IS NOT NULL;
CREATE INDEX "reservations_departure_instant_idx" ON "trove"."reservations"("flight_departure_instant", "id")
  WHERE "flight_departure_instant" IS NOT NULL;
CREATE INDEX "reservations_departure_local_date_timed_idx" ON "trove"."reservations"("flight_departure_local_date", "id")
  WHERE "flight_departure_local_time" IS NOT NULL;
CREATE INDEX "itinerary_items_upcoming_start_instant_idx" ON "trove"."itinerary_items"("start_instant", "id")
  WHERE "travel_status" = 'upcoming' AND "itinerary_day_id" IS NOT NULL AND "start_instant" IS NOT NULL;
