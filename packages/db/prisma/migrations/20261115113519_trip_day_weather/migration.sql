-- CreateTable
CREATE TABLE "trip_day_weather" (
    "itinerary_day_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "weather_code" INTEGER NOT NULL,
    "temperature_max_celsius" DECIMAL(5,2) NOT NULL,
    "temperature_min_celsius" DECIMAL(5,2) NOT NULL,
    "precipitation_probability" INTEGER,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "locked_at" TIMESTAMPTZ(3),

    CONSTRAINT "trip_day_weather_pkey" PRIMARY KEY ("itinerary_day_id")
);

-- CreateIndex
CREATE INDEX "trip_day_weather_trip_id_idx" ON "trip_day_weather"("trip_id");

-- AddForeignKey
ALTER TABLE "trip_day_weather" ADD CONSTRAINT "trip_day_weather_itinerary_day_id_fkey" FOREIGN KEY ("itinerary_day_id") REFERENCES "itinerary_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_day_weather" ADD CONSTRAINT "trip_day_weather_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Private application data stays behind the API, matching the other Trove tables.
ALTER TABLE "trove"."trip_day_weather" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "trove"."trip_day_weather" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "trove"."trip_day_weather" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "trove"."trip_day_weather" FROM authenticated;
  END IF;
END $$;
