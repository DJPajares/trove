ALTER TABLE "place_provider_refs"
ADD COLUMN "details_failure_code" TEXT,
ADD COLUMN "details_failed_at" TIMESTAMPTZ(3);

ALTER TABLE "place_provider_refs"
ADD CONSTRAINT "place_provider_refs_details_failure_code_check"
CHECK (
  ("details_failure_code" IS NULL AND "details_failed_at" IS NULL)
  OR (
    "details_failure_code" IN ('NOT_FOUND', 'UNUSABLE_LOCATION')
    AND "details_failed_at" IS NOT NULL
  )
);
