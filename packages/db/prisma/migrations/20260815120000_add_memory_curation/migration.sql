-- AlterTable
ALTER TABLE "trove"."memories" ADD COLUMN     "highlight_position" INTEGER;

-- AlterTable
ALTER TABLE "trove"."trips" ADD COLUMN     "story_cover_memory_photo_id" UUID;

-- DropIndex
DROP INDEX "trove"."memories_trip_id_is_highlight_idx";

-- CreateIndex
CREATE INDEX "memories_trip_id_is_highlight_highlight_position_idx" ON "trove"."memories"("trip_id", "is_highlight", "highlight_position");

-- CreateIndex
CREATE INDEX "trips_story_cover_memory_photo_id_idx" ON "trove"."trips"("story_cover_memory_photo_id");

-- AddForeignKey
ALTER TABLE "trove"."trips" ADD CONSTRAINT "trips_story_cover_memory_photo_id_fkey" FOREIGN KEY ("story_cover_memory_photo_id") REFERENCES "trove"."memory_photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
