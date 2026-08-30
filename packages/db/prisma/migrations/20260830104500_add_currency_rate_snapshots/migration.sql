-- CreateTable
CREATE TABLE "currency_rate_snapshots" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'frankfurter',
    "base" CHAR(3) NOT NULL,
    "rate_date" DATE NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currency_rate_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_rate_snapshot_rates" (
    "snapshot_id" UUID NOT NULL,
    "code" CHAR(3) NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,

    CONSTRAINT "currency_rate_snapshot_rates_pkey" PRIMARY KEY ("snapshot_id","code")
);

-- CreateTable
CREATE TABLE "currency_metadata" (
    "code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currency_metadata_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "currency_rate_snapshots_fetched_at_idx" ON "currency_rate_snapshots"("fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "currency_rate_snapshots_provider_base_rate_date_key" ON "currency_rate_snapshots"("provider", "base", "rate_date");

-- AddForeignKey
ALTER TABLE "currency_rate_snapshot_rates" ADD CONSTRAINT "currency_rate_snapshot_rates_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "currency_rate_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
