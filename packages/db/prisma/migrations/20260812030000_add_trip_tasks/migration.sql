-- CreateEnum
CREATE TYPE "trove"."task_time_zone_source" AS ENUM ('itinerary_item', 'itinerary_day', 'trip_reference');

-- CreateTable
CREATE TABLE "trove"."tasks" (
  "id" UUID NOT NULL,
  "trip_id" UUID NOT NULL,
  "itinerary_day_id" UUID,
  "itinerary_item_id" UUID,
  "label" TEXT NOT NULL,
  "note" TEXT,
  "due_date" DATE,
  "due_local_time" TIME(0),
  "due_time_zone" TEXT,
  "due_time_zone_source" "trove"."task_time_zone_source",
  "due_time_zone_resolved_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tasks_attachment_context" CHECK (
    ("itinerary_day_id" IS NULL AND "itinerary_item_id" IS NULL)
    OR ("itinerary_day_id" IS NOT NULL AND "itinerary_item_id" IS NULL)
    OR ("itinerary_day_id" IS NULL AND "itinerary_item_id" IS NOT NULL)
  ),
  CONSTRAINT "tasks_label_not_blank" CHECK (btrim("label") <> ''),
  CONSTRAINT "tasks_due_context" CHECK (
    (
      "due_date" IS NULL
      AND "due_local_time" IS NULL
      AND "due_time_zone" IS NULL
      AND "due_time_zone_source" IS NULL
      AND "due_time_zone_resolved_at" IS NULL
    )
    OR (
      "due_date" IS NOT NULL
      AND btrim("due_time_zone") <> ''
      AND "due_time_zone_source" IS NOT NULL
      AND "due_time_zone_resolved_at" IS NOT NULL
    )
  )
);

-- CreateTable
CREATE TABLE "trove"."task_templates" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_templates_name_not_blank" CHECK (btrim("name") <> '')
);

-- CreateTable
CREATE TABLE "trove"."task_template_items" (
  "id" UUID NOT NULL,
  "task_template_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "task_template_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_template_items_label_not_blank" CHECK (btrim("label") <> '')
);

-- CreateIndex
CREATE INDEX "tasks_trip_id_completed_at_idx" ON "trove"."tasks"("trip_id", "completed_at");
CREATE INDEX "tasks_itinerary_day_id_trip_id_idx" ON "trove"."tasks"("itinerary_day_id", "trip_id");
CREATE INDEX "tasks_itinerary_item_id_trip_id_idx" ON "trove"."tasks"("itinerary_item_id", "trip_id");
CREATE UNIQUE INDEX "task_templates_owner_id_name_key" ON "trove"."task_templates"("owner_id", "name");
CREATE INDEX "task_templates_owner_id_idx" ON "trove"."task_templates"("owner_id");
CREATE UNIQUE INDEX "task_template_items_task_template_id_position_key" ON "trove"."task_template_items"("task_template_id", "position");
CREATE INDEX "task_template_items_task_template_id_idx" ON "trove"."task_template_items"("task_template_id");

-- AddForeignKey
ALTER TABLE "trove"."tasks"
ADD CONSTRAINT "tasks_trip_id_fkey"
FOREIGN KEY ("trip_id") REFERENCES "trove"."trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trove"."tasks"
ADD CONSTRAINT "tasks_itinerary_day_id_trip_id_fkey"
FOREIGN KEY ("itinerary_day_id", "trip_id") REFERENCES "trove"."itinerary_days"("id", "trip_id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "trove"."tasks"
ADD CONSTRAINT "tasks_itinerary_item_id_trip_id_fkey"
FOREIGN KEY ("itinerary_item_id", "trip_id") REFERENCES "trove"."itinerary_items"("id", "trip_id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "trove"."task_templates"
ADD CONSTRAINT "task_templates_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trove"."task_template_items"
ADD CONSTRAINT "task_template_items_task_template_id_fkey"
FOREIGN KEY ("task_template_id") REFERENCES "trove"."task_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
