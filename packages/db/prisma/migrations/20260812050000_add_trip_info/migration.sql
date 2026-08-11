-- CreateTable
CREATE TABLE "trove"."trip_info" (
  "id" UUID NOT NULL,
  "trip_id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "category" TEXT,
  "note" TEXT,
  "link" TEXT,
  "is_pinned" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "trip_info_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trip_info_label_not_blank" CHECK (btrim("label") <> ''),
  CONSTRAINT "trip_info_value_not_blank" CHECK (btrim("value") <> ''),
  CONSTRAINT "trip_info_category_not_blank" CHECK (
    "category" IS NULL OR btrim("category") <> ''
  ),
  CONSTRAINT "trip_info_link_not_blank" CHECK (
    "link" IS NULL OR btrim("link") <> ''
  )
);

-- CreateIndex
CREATE INDEX "trip_info_trip_id_is_pinned_updated_at_idx"
ON "trove"."trip_info"("trip_id", "is_pinned", "updated_at");

-- AddForeignKey
ALTER TABLE "trove"."trip_info"
ADD CONSTRAINT "trip_info_trip_id_fkey"
FOREIGN KEY ("trip_id") REFERENCES "trove"."trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
