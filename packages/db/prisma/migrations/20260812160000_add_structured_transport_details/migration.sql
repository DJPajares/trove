ALTER TYPE "trove"."reservation_type" ADD VALUE IF NOT EXISTS 'ferry';
ALTER TYPE "trove"."reservation_type" ADD VALUE IF NOT EXISTS 'bus';

ALTER TABLE "trove"."reservations"
  ADD COLUMN "flight_airline" TEXT,
  ADD COLUMN "flight_number" TEXT,
  ADD COLUMN "flight_departure_airport" TEXT,
  ADD COLUMN "flight_departure_local_date" DATE,
  ADD COLUMN "flight_departure_local_time" TIME(0),
  ADD COLUMN "flight_departure_time_zone" TEXT,
  ADD COLUMN "flight_departure_instant" TIMESTAMPTZ(3),
  ADD COLUMN "flight_arrival_airport" TEXT,
  ADD COLUMN "flight_arrival_local_date" DATE,
  ADD COLUMN "flight_arrival_local_time" TIME(0),
  ADD COLUMN "flight_arrival_time_zone" TEXT,
  ADD COLUMN "flight_arrival_instant" TIMESTAMPTZ(3),
  ADD COLUMN "flight_terminal" TEXT,
  ADD COLUMN "flight_gate" TEXT,
  ADD COLUMN "flight_seat" TEXT,
  ADD COLUMN "transport_operator" TEXT,
  ADD COLUMN "transport_service_number" TEXT,
  ADD COLUMN "transport_pickup_location" TEXT,
  ADD COLUMN "transport_dropoff_location" TEXT,
  ADD CONSTRAINT "reservations_flight_departure_time_context" CHECK (
    ("flight_departure_local_date" IS NULL AND "flight_departure_local_time" IS NULL AND "flight_departure_time_zone" IS NULL AND "flight_departure_instant" IS NULL)
    OR ("flight_departure_local_date" IS NOT NULL AND "flight_departure_time_zone" IS NOT NULL AND btrim("flight_departure_time_zone") <> '')
  ),
  ADD CONSTRAINT "reservations_flight_arrival_time_context" CHECK (
    ("flight_arrival_local_date" IS NULL AND "flight_arrival_local_time" IS NULL AND "flight_arrival_time_zone" IS NULL AND "flight_arrival_instant" IS NULL)
    OR ("flight_arrival_local_date" IS NOT NULL AND "flight_arrival_time_zone" IS NOT NULL AND btrim("flight_arrival_time_zone") <> '')
  );

CREATE INDEX "reservations_trip_id_flight_departure_local_date_idx"
  ON "trove"."reservations"("trip_id", "flight_departure_local_date");
