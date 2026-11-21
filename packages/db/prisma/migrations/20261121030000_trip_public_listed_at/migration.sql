-- AlterTable
ALTER TABLE "trove"."trips" ADD COLUMN     "public_listed_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "trips_owner_id_public_listed_at_idx" ON "trove"."trips"("owner_id", "public_listed_at");
