-- AlterTable
ALTER TABLE "trove"."profiles" ADD COLUMN     "bio" VARCHAR(160),
ADD COLUMN     "cover_memory_photo_id" UUID,
ADD COLUMN     "travel_styles" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "profiles_cover_memory_photo_id_idx" ON "trove"."profiles"("cover_memory_photo_id");

-- AddForeignKey
ALTER TABLE "trove"."profiles" ADD CONSTRAINT "profiles_cover_memory_photo_id_fkey" FOREIGN KEY ("cover_memory_photo_id") REFERENCES "trove"."memory_photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
