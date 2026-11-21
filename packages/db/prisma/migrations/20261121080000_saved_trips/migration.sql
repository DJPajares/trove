-- CreateTable
CREATE TABLE "trove"."saved_trips" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_trips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_trips_trip_id_idx" ON "trove"."saved_trips"("trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_trips_owner_id_trip_id_key" ON "trove"."saved_trips"("owner_id", "trip_id");

-- AddForeignKey
ALTER TABLE "trove"."saved_trips" ADD CONSTRAINT "saved_trips_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."saved_trips" ADD CONSTRAINT "saved_trips_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trove"."trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Private application data stays behind the API, matching the other Trove tables.
ALTER TABLE "trove"."saved_trips" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "trove"."saved_trips" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "trove"."saved_trips" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "trove"."saved_trips" FROM authenticated;
  END IF;
END $$;
