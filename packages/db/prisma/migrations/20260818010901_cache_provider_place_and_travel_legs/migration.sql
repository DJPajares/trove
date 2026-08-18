-- AlterTable
ALTER TABLE "place_provider_refs" ADD COLUMN     "cached_at" TIMESTAMPTZ(3),
ADD COLUMN     "cached_formatted_address" TEXT,
ADD COLUMN     "cached_google_maps_uri" TEXT,
ADD COLUMN     "cached_latitude" DECIMAL(9,6),
ADD COLUMN     "cached_longitude" DECIMAL(9,6),
ADD COLUMN     "cached_name" TEXT,
ADD COLUMN     "cached_primary_type" TEXT,
ADD COLUMN     "cached_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "cached_utc_offset_minutes" INTEGER;

-- CreateTable
CREATE TABLE "travel_leg_cache" (
    "id" UUID NOT NULL,
    "origin_latitude" DECIMAL(9,6) NOT NULL,
    "origin_longitude" DECIMAL(9,6) NOT NULL,
    "destination_latitude" DECIMAL(9,6) NOT NULL,
    "destination_longitude" DECIMAL(9,6) NOT NULL,
    "mode" "route_travel_mode" NOT NULL,
    "distance_meters" INTEGER NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "encoded_polyline" TEXT,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_leg_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "travel_leg_cache_fetched_at_idx" ON "travel_leg_cache"("fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "travel_leg_cache_origin_latitude_origin_longitude_destinati_key" ON "travel_leg_cache"("origin_latitude", "origin_longitude", "destination_latitude", "destination_longitude", "mode");
