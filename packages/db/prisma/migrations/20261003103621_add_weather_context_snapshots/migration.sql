-- CreateTable
CREATE TABLE "weather_context_snapshots" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'open_meteo',
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "weather_context_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "weather_context_snapshots_fetched_at_idx" ON "weather_context_snapshots"("fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "weather_context_snapshots_provider_latitude_longitude_time__key" ON "weather_context_snapshots"("provider", "latitude", "longitude", "time_zone");

-- Provider evidence is acquired by the backend, never through client roles.
ALTER TABLE "trove"."weather_context_snapshots" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "trove"."weather_context_snapshots" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "trove"."weather_context_snapshots" FROM authenticated;
  END IF;
END $$;
