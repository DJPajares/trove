-- The reference does not move every currency on the same day, so a quote keeps
-- the date it was published rather than borrowing the board's newest one.
-- AlterTable
ALTER TABLE "currency_rate_snapshot_rates" ADD COLUMN     "rate_date" DATE NOT NULL DEFAULT CURRENT_DATE;

ALTER TABLE "currency_rate_snapshot_rates" ALTER COLUMN "rate_date" DROP DEFAULT;
