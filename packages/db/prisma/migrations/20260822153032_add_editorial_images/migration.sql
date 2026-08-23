-- CreateEnum
CREATE TYPE "editorial_image_provider" AS ENUM ('pexels');

-- AlterTable
ALTER TABLE "places" ADD COLUMN     "editorial_image_id" UUID;

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "editorial_image_id" UUID;

-- CreateTable
CREATE TABLE "editorial_images" (
    "id" UUID NOT NULL,
    "subject_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "provider" "editorial_image_provider",
    "external_photo_id" TEXT,
    "provider_page_url" TEXT,
    "photographer_name" TEXT,
    "photographer_url" TEXT,
    "small_url" TEXT,
    "medium_url" TEXT,
    "large_url" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "dominant_color" TEXT,
    "alt_text" TEXT,
    "cached_at" TIMESTAMPTZ(3),
    "miss_code" TEXT,
    "missed_at" TIMESTAMPTZ(3),

    CONSTRAINT "editorial_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "editorial_images_subject_key_key" ON "editorial_images"("subject_key");

-- CreateIndex
CREATE INDEX "editorial_images_cached_at_idx" ON "editorial_images"("cached_at");

-- CreateIndex
CREATE INDEX "places_editorial_image_id_idx" ON "places"("editorial_image_id");

-- CreateIndex
CREATE INDEX "trips_editorial_image_id_idx" ON "trips"("editorial_image_id");

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_editorial_image_id_fkey" FOREIGN KEY ("editorial_image_id") REFERENCES "editorial_images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_editorial_image_id_fkey" FOREIGN KEY ("editorial_image_id") REFERENCES "editorial_images"("id") ON DELETE SET NULL ON UPDATE CASCADE;
