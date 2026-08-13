-- CreateEnum
CREATE TYPE "trove"."notification_kind" AS ENUM ('task_due', 'reservation_upcoming', 'leave_by');

-- AlterTable
ALTER TABLE "trove"."profiles"
  ADD COLUMN "notifications_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "browser_notifications_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT "profiles_browser_notifications_require_notifications"
    CHECK (NOT "browser_notifications_enabled" OR "notifications_enabled");

-- Preserve trip ownership in notification relationships.
CREATE UNIQUE INDEX "trips_id_owner_id_key" ON "trove"."trips"("id", "owner_id");

-- CreateTable
CREATE TABLE "trove"."trip_notification_preferences" (
  "owner_id" UUID NOT NULL,
  "trip_id" UUID NOT NULL,
  "muted" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "trip_notification_preferences_pkey" PRIMARY KEY ("owner_id", "trip_id")
);

-- CreateTable
CREATE TABLE "trove"."notifications" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "trip_id" UUID NOT NULL,
  "kind" "trove"."notification_kind" NOT NULL,
  "source_id" UUID NOT NULL,
  "source_version" TEXT NOT NULL,
  "event_at" TIMESTAMPTZ(3) NOT NULL,
  "time_zone" TEXT NOT NULL,
  "read_at" TIMESTAMPTZ(3),
  "browser_delivered_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_source_version_not_blank" CHECK (btrim("source_version") <> ''),
  CONSTRAINT "notifications_time_zone_not_blank" CHECK (btrim("time_zone") <> '')
);

-- CreateIndex
CREATE INDEX "trip_notification_preferences_trip_id_owner_id_idx"
  ON "trove"."trip_notification_preferences"("trip_id", "owner_id");
CREATE INDEX "notifications_owner_id_read_at_event_at_idx"
  ON "trove"."notifications"("owner_id", "read_at", "event_at");
CREATE INDEX "notifications_trip_id_event_at_idx"
  ON "trove"."notifications"("trip_id", "event_at");
CREATE UNIQUE INDEX "notifications_owner_id_kind_source_id_key"
  ON "trove"."notifications"("owner_id", "kind", "source_id");

-- AddForeignKey
ALTER TABLE "trove"."trip_notification_preferences"
  ADD CONSTRAINT "trip_notification_preferences_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trove"."trip_notification_preferences"
  ADD CONSTRAINT "trip_notification_preferences_trip_id_owner_id_fkey"
  FOREIGN KEY ("trip_id", "owner_id") REFERENCES "trove"."trips"("id", "owner_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trove"."notifications"
  ADD CONSTRAINT "notifications_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trove"."notifications"
  ADD CONSTRAINT "notifications_trip_id_owner_id_fkey"
  FOREIGN KEY ("trip_id", "owner_id") REFERENCES "trove"."trips"("id", "owner_id") ON DELETE CASCADE ON UPDATE CASCADE;
