-- AlterTable
ALTER TABLE "itinerary_days" ADD COLUMN     "daily_base_departure_trip_place_id" UUID;

-- CreateIndex
CREATE INDEX "itinerary_days_daily_base_departure_trip_place_id_trip_id_idx" ON "itinerary_days"("daily_base_departure_trip_place_id", "trip_id");

-- AddForeignKey
ALTER TABLE "itinerary_days" ADD CONSTRAINT "itinerary_days_daily_base_departure_trip_place_id_trip_id_fkey" FOREIGN KEY ("daily_base_departure_trip_place_id", "trip_id") REFERENCES "trip_places"("id", "trip_id") ON DELETE NO ACTION ON UPDATE CASCADE;
