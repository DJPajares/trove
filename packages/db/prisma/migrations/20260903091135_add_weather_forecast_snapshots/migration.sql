-- CreateTable
CREATE TABLE "weather_forecast_snapshots" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'open_meteo',
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weather_forecast_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weather_forecast_snapshot_days" (
    "snapshot_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "weather_code" INTEGER NOT NULL,
    "temperature_max_celsius" DECIMAL(5,2) NOT NULL,
    "temperature_min_celsius" DECIMAL(5,2) NOT NULL,
    "precipitation_probability" INTEGER,

    CONSTRAINT "weather_forecast_snapshot_days_pkey" PRIMARY KEY ("snapshot_id","date")
);

-- CreateIndex
CREATE INDEX "weather_forecast_snapshots_fetched_at_idx" ON "weather_forecast_snapshots"("fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "weather_forecast_snapshots_provider_latitude_longitude_key" ON "weather_forecast_snapshots"("provider", "latitude", "longitude");

-- AddForeignKey
ALTER TABLE "weather_forecast_snapshot_days" ADD CONSTRAINT "weather_forecast_snapshot_days_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "weather_forecast_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
