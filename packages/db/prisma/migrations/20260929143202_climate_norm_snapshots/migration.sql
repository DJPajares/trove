-- CreateTable
CREATE TABLE "climate_norm_snapshots" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'open_meteo',
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "month" SMALLINT NOT NULL,
    "year_from" SMALLINT NOT NULL,
    "year_to" SMALLINT NOT NULL,
    "temperature_max_celsius" DECIMAL(5,2),
    "temperature_min_celsius" DECIMAL(5,2),
    "wet_day_share" DECIMAL(4,3),
    "sample_days" INTEGER NOT NULL DEFAULT 0,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "climate_norm_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "climate_norm_snapshots_fetched_at_idx" ON "climate_norm_snapshots"("fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "climate_norm_snapshots_provider_latitude_longitude_month_ye_key" ON "climate_norm_snapshots"("provider", "latitude", "longitude", "month", "year_from", "year_to");
