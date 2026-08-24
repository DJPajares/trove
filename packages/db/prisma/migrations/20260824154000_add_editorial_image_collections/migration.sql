-- Preserve the existing subject cache while separating its ordered images.
ALTER TABLE "trove"."editorial_images" RENAME TO "editorial_image_sets";
ALTER TABLE "trove"."editorial_image_sets" RENAME CONSTRAINT "editorial_images_pkey" TO "editorial_image_sets_pkey";
ALTER INDEX "trove"."editorial_images_subject_key_key" RENAME TO "editorial_image_sets_subject_key_key";
ALTER INDEX "trove"."editorial_images_cached_at_idx" RENAME TO "editorial_image_sets_cached_at_idx";

ALTER TABLE "trove"."places" RENAME COLUMN "editorial_image_id" TO "editorial_image_set_id";
ALTER TABLE "trove"."places" RENAME CONSTRAINT "places_editorial_image_id_fkey" TO "places_editorial_image_set_id_fkey";
ALTER INDEX "trove"."places_editorial_image_id_idx" RENAME TO "places_editorial_image_set_id_idx";

ALTER TABLE "trove"."trips" RENAME COLUMN "editorial_image_id" TO "editorial_image_set_id";
ALTER TABLE "trove"."trips" RENAME CONSTRAINT "trips_editorial_image_id_fkey" TO "trips_editorial_image_set_id_fkey";
ALTER INDEX "trove"."trips_editorial_image_id_idx" RENAME TO "trips_editorial_image_set_id_idx";

CREATE TABLE "trove"."editorial_images" (
    "id" UUID NOT NULL,
    "editorial_image_set_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "provider" "trove"."editorial_image_provider" NOT NULL,
    "external_photo_id" TEXT NOT NULL,
    "provider_page_url" TEXT NOT NULL,
    "photographer_name" TEXT NOT NULL,
    "photographer_url" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "dominant_color" TEXT,
    "alt_text" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "editorial_images_pkey" PRIMARY KEY ("id")
);

INSERT INTO "trove"."editorial_images" (
    "id",
    "editorial_image_set_id",
    "position",
    "provider",
    "external_photo_id",
    "provider_page_url",
    "photographer_name",
    "photographer_url",
    "source_url",
    "width",
    "height",
    "dominant_color",
    "alt_text",
    "created_at",
    "updated_at"
)
SELECT
    "id",
    "id",
    0,
    "provider",
    "external_photo_id",
    "provider_page_url",
    "photographer_name",
    "photographer_url",
    split_part(COALESCE("large_url", "medium_url", "small_url"), '?', 1),
    "width",
    "height",
    "dominant_color",
    "alt_text",
    "created_at",
    "updated_at"
FROM "trove"."editorial_image_sets"
WHERE "provider" IS NOT NULL
  AND "external_photo_id" IS NOT NULL
  AND "provider_page_url" IS NOT NULL
  AND "photographer_name" IS NOT NULL
  AND "photographer_url" IS NOT NULL
  AND COALESCE("large_url", "medium_url", "small_url") IS NOT NULL;

ALTER TABLE "trove"."editorial_image_sets"
    DROP COLUMN "provider",
    DROP COLUMN "external_photo_id",
    DROP COLUMN "provider_page_url",
    DROP COLUMN "photographer_name",
    DROP COLUMN "photographer_url",
    DROP COLUMN "small_url",
    DROP COLUMN "medium_url",
    DROP COLUMN "large_url",
    DROP COLUMN "width",
    DROP COLUMN "height",
    DROP COLUMN "dominant_color",
    DROP COLUMN "alt_text";

CREATE UNIQUE INDEX "editorial_images_editorial_image_set_id_position_key"
    ON "trove"."editorial_images"("editorial_image_set_id", "position");
CREATE UNIQUE INDEX "editorial_images_editorial_image_set_id_provider_external_p_key"
    ON "trove"."editorial_images"("editorial_image_set_id", "provider", "external_photo_id");
CREATE INDEX "editorial_images_editorial_image_set_id_idx"
    ON "trove"."editorial_images"("editorial_image_set_id");

ALTER TABLE "trove"."editorial_images"
    ADD CONSTRAINT "editorial_images_editorial_image_set_id_fkey"
    FOREIGN KEY ("editorial_image_set_id")
    REFERENCES "trove"."editorial_image_sets"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
