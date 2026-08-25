-- AlterTable
ALTER TABLE "editorial_image_sets" ADD COLUMN     "resolution_version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "editorial_image_sets_resolution_version_cached_at_idx" ON "editorial_image_sets"("resolution_version", "cached_at");
