-- AlterTable
ALTER TABLE "trove"."trips" ADD COLUMN     "experience_rating" INTEGER,
ADD COLUMN     "experience_note" TEXT;

-- AlterTable
ALTER TABLE "trove"."itinerary_days" ADD COLUMN     "experience_rating" INTEGER,
ADD COLUMN     "experience_note" TEXT;
