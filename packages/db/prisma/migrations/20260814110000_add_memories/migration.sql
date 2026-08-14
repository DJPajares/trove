◇ injected env (8) from ../../.env // tip: ⌘ multiple files { path: ['.env.local', '.env'] }
-- CreateEnum
CREATE TYPE "trove"."memory_time_zone_source" AS ENUM ('itinerary_item', 'trip_place', 'itinerary_day', 'trip_reference');

-- CreateTable
CREATE TABLE "trove"."memories" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "itinerary_day_id" UUID,
    "itinerary_item_id" UUID,
    "trip_place_id" UUID,
    "note" TEXT,
    "is_highlight" BOOLEAN NOT NULL DEFAULT false,
    "captured_instant" TIMESTAMPTZ(3) NOT NULL,
    "captured_local_date" DATE NOT NULL,
    "captured_local_time" TIME(0) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "time_zone_source" "trove"."memory_time_zone_source" NOT NULL,
    "time_zone_resolved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trove"."memory_photos" (
    "id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memories_trip_id_captured_instant_idx" ON "trove"."memories"("trip_id", "captured_instant");

-- CreateIndex
CREATE INDEX "memories_trip_id_is_highlight_idx" ON "trove"."memories"("trip_id", "is_highlight");

-- CreateIndex
CREATE INDEX "memories_itinerary_day_id_trip_id_idx" ON "trove"."memories"("itinerary_day_id", "trip_id");

-- CreateIndex
CREATE INDEX "memories_itinerary_item_id_trip_id_idx" ON "trove"."memories"("itinerary_item_id", "trip_id");

-- CreateIndex
CREATE INDEX "memories_trip_place_id_trip_id_idx" ON "trove"."memories"("trip_place_id", "trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "memories_id_trip_id_key" ON "trove"."memories"("id", "trip_id");

-- CreateIndex
CREATE INDEX "memory_photos_memory_id_position_idx" ON "trove"."memory_photos"("memory_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "memory_photos_memory_id_path_key" ON "trove"."memory_photos"("memory_id", "path");

-- AddForeignKey
ALTER TABLE "trove"."memories" ADD CONSTRAINT "memories_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trove"."trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."memories" ADD CONSTRAINT "memories_itinerary_day_id_trip_id_fkey" FOREIGN KEY ("itinerary_day_id", "trip_id") REFERENCES "trove"."itinerary_days"("id", "trip_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."memories" ADD CONSTRAINT "memories_itinerary_item_id_trip_id_fkey" FOREIGN KEY ("itinerary_item_id", "trip_id") REFERENCES "trove"."itinerary_items"("id", "trip_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."memories" ADD CONSTRAINT "memories_trip_place_id_trip_id_fkey" FOREIGN KEY ("trip_place_id", "trip_id") REFERENCES "trove"."trip_places"("id", "trip_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."memory_photos" ADD CONSTRAINT "memory_photos_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "trove"."memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

