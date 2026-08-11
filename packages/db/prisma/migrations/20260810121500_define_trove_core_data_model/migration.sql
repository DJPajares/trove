-- CreateEnum
CREATE TYPE "trove"."place_kind" AS ENUM ('provider', 'custom');

-- CreateEnum
CREATE TYPE "trove"."place_provider" AS ENUM ('google');

-- CreateEnum
CREATE TYPE "trove"."trip_planning_readiness" AS ENUM ('in_progress', 'ready');

-- CreateEnum
CREATE TYPE "trove"."trip_visibility" AS ENUM ('private', 'shared', 'public');

-- CreateEnum
CREATE TYPE "trove"."trip_user_role" AS ENUM ('owner', 'collaborator', 'viewer');

-- CreateEnum
CREATE TYPE "trove"."trip_time_zone_source" AS ENUM ('explicit', 'destination', 'starting_location', 'profile_home', 'device_fallback');

-- CreateEnum
CREATE TYPE "trove"."day_time_zone_source" AS ENUM ('explicit_daily_base', 'accommodation', 'first_located_item', 'trip_reference');

-- CreateEnum
CREATE TYPE "trove"."item_time_zone_source" AS ENUM ('explicit', 'place', 'day_default');

-- CreateEnum
CREATE TYPE "trove"."trip_place_priority" AS ENUM ('must_go', 'interested', 'maybe');

-- CreateEnum
CREATE TYPE "trove"."itinerary_day_part" AS ENUM ('morning', 'afternoon', 'evening', 'anytime');

-- CreateTable
CREATE TABLE "trove"."profiles" (
    "id" UUID NOT NULL,
    "display_name" TEXT,
    "avatar_path" TEXT,
    "home_place_id" UUID,
    "home_currency_code" CHAR(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trove"."places" (
    "id" UUID NOT NULL,
    "kind" "trove"."place_kind" NOT NULL,
    "owner_id" UUID,
    "custom_name" TEXT,
    "custom_latitude" DECIMAL(9,6),
    "custom_longitude" DECIMAL(9,6),
    "custom_time_zone" TEXT,
    "custom_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trove"."place_provider_refs" (
    "id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "provider" "trove"."place_provider" NOT NULL,
    "external_place_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "place_provider_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trove"."trips" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "creator_id" UUID,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "party_size" INTEGER NOT NULL DEFAULT 1,
    "starting_place_id" UUID,
    "notes" TEXT,
    "cover_photo_path" TEXT,
    "planning_readiness" "trove"."trip_planning_readiness" NOT NULL DEFAULT 'in_progress',
    "visibility" "trove"."trip_visibility" NOT NULL DEFAULT 'private',
    "reference_time_zone" TEXT NOT NULL,
    "reference_time_zone_source" "trove"."trip_time_zone_source" NOT NULL,
    "reference_time_zone_source_place_id" UUID,
    "reference_time_zone_resolved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_trip_id" UUID,
    "source_attribution" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trove"."trip_destinations" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "time_zone" TEXT,
    "time_zone_resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trove"."trip_user_relationships" (
    "trip_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "role" "trove"."trip_user_role" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_user_relationships_pkey" PRIMARY KEY ("trip_id","profile_id")
);

-- CreateTable
CREATE TABLE "trove"."saved_places" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trove"."saved_collections" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trove"."saved_collection_places" (
    "owner_id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "saved_place_id" UUID NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_collection_places_pkey" PRIMARY KEY ("collection_id","saved_place_id")
);

-- CreateTable
CREATE TABLE "trove"."trip_places" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "priority" "trove"."trip_place_priority",
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trip_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trove"."itinerary_days" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "daily_base_trip_place_id" UUID,
    "notes" TEXT,
    "default_time_zone" TEXT NOT NULL,
    "default_time_zone_source" "trove"."day_time_zone_source" NOT NULL,
    "default_time_zone_source_trip_place_id" UUID,
    "default_time_zone_resolved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "itinerary_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trove"."itinerary_items" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "itinerary_day_id" UUID,
    "trip_place_id" UUID,
    "custom_label" TEXT,
    "position" INTEGER NOT NULL,
    "local_start_time" TIME(0),
    "time_zone" TEXT,
    "time_zone_source" "trove"."item_time_zone_source",
    "time_zone_resolved_at" TIMESTAMPTZ(3),
    "day_part" "trove"."itinerary_day_part",
    "duration_minutes" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "itinerary_items_pkey" PRIMARY KEY ("id")
);

-- AddCheckConstraint
ALTER TABLE "trove"."profiles"
ADD CONSTRAINT "profiles_display_name_not_blank" CHECK (
    "display_name" IS NULL OR btrim("display_name") <> ''
),
ADD CONSTRAINT "profiles_home_currency_code_format" CHECK (
    "home_currency_code" IS NULL OR btrim("home_currency_code") ~ '^[A-Z]{3}$'
);

ALTER TABLE "trove"."places"
ADD CONSTRAINT "places_identity_shape" CHECK (
    (
        "kind" = 'custom'
        AND "owner_id" IS NOT NULL
        AND "custom_name" IS NOT NULL
        AND btrim("custom_name") <> ''
    )
    OR
    (
        "kind" = 'provider'
        AND "owner_id" IS NULL
        AND "custom_name" IS NULL
        AND "custom_latitude" IS NULL
        AND "custom_longitude" IS NULL
        AND "custom_time_zone" IS NULL
        AND "custom_note" IS NULL
    )
),
ADD CONSTRAINT "places_custom_coordinates_pair" CHECK (
    ("custom_latitude" IS NULL) = ("custom_longitude" IS NULL)
),
ADD CONSTRAINT "places_custom_latitude_range" CHECK (
    "custom_latitude" IS NULL OR "custom_latitude" BETWEEN -90 AND 90
),
ADD CONSTRAINT "places_custom_longitude_range" CHECK (
    "custom_longitude" IS NULL OR "custom_longitude" BETWEEN -180 AND 180
),
ADD CONSTRAINT "places_custom_time_zone_not_blank" CHECK (
    "custom_time_zone" IS NULL OR btrim("custom_time_zone") <> ''
);

ALTER TABLE "trove"."place_provider_refs"
ADD CONSTRAINT "place_provider_refs_external_id_not_blank" CHECK (
    btrim("external_place_id") <> ''
);

ALTER TABLE "trove"."trips"
ADD CONSTRAINT "trips_name_not_blank" CHECK (btrim("name") <> ''),
ADD CONSTRAINT "trips_date_range" CHECK ("end_date" >= "start_date"),
ADD CONSTRAINT "trips_party_size_positive" CHECK ("party_size" >= 1),
ADD CONSTRAINT "trips_reference_time_zone_not_blank" CHECK (
    btrim("reference_time_zone") <> ''
),
ADD CONSTRAINT "trips_owner_only_visibility" CHECK ("visibility" = 'private'),
ADD CONSTRAINT "trips_source_trip_not_self" CHECK (
    "source_trip_id" IS NULL OR "source_trip_id" <> "id"
);

ALTER TABLE "trove"."trip_destinations"
ADD CONSTRAINT "trip_destinations_position_nonnegative" CHECK ("position" >= 0),
ADD CONSTRAINT "trip_destinations_time_zone_context" CHECK (
    (
        "time_zone" IS NULL
        AND "time_zone_resolved_at" IS NULL
    )
    OR
    (
        "time_zone" IS NOT NULL
        AND btrim("time_zone") <> ''
        AND "time_zone_resolved_at" IS NOT NULL
    )
);

ALTER TABLE "trove"."saved_collections"
ADD CONSTRAINT "saved_collections_name_not_blank" CHECK (btrim("name") <> '');

ALTER TABLE "trove"."itinerary_days"
ADD CONSTRAINT "itinerary_days_default_time_zone_not_blank" CHECK (
    btrim("default_time_zone") <> ''
),
ADD CONSTRAINT "itinerary_days_time_zone_source_context" CHECK (
    (
        "default_time_zone_source" = 'explicit_daily_base'
        AND "daily_base_trip_place_id" IS NOT NULL
        AND "default_time_zone_source_trip_place_id" = "daily_base_trip_place_id"
    )
    OR
    (
        "default_time_zone_source" = 'first_located_item'
        AND "default_time_zone_source_trip_place_id" IS NOT NULL
    )
    OR "default_time_zone_source" IN ('accommodation', 'trip_reference')
);

ALTER TABLE "trove"."itinerary_items"
ADD CONSTRAINT "itinerary_items_minimum_content" CHECK (
    "trip_place_id" IS NOT NULL
    OR ("custom_label" IS NOT NULL AND btrim("custom_label") <> '')
),
ADD CONSTRAINT "itinerary_items_custom_label_not_blank" CHECK (
    "custom_label" IS NULL OR btrim("custom_label") <> ''
),
ADD CONSTRAINT "itinerary_items_position_nonnegative" CHECK ("position" >= 0),
ADD CONSTRAINT "itinerary_items_duration_positive" CHECK (
    "duration_minutes" IS NULL OR "duration_minutes" > 0
),
ADD CONSTRAINT "itinerary_items_local_time_context" CHECK (
    "local_start_time" IS NULL
    OR (
        "time_zone" IS NOT NULL
        AND btrim("time_zone") <> ''
        AND "time_zone_source" IS NOT NULL
        AND "time_zone_resolved_at" IS NOT NULL
    )
),
ADD CONSTRAINT "itinerary_items_time_zone_not_blank" CHECK (
    "time_zone" IS NULL OR btrim("time_zone") <> ''
);

-- CreateIndex
CREATE INDEX "profiles_home_place_id_idx" ON "trove"."profiles"("home_place_id");

-- CreateIndex
CREATE INDEX "places_owner_id_idx" ON "trove"."places"("owner_id");

-- CreateIndex
CREATE INDEX "place_provider_refs_place_id_idx" ON "trove"."place_provider_refs"("place_id");

-- CreateIndex
CREATE UNIQUE INDEX "place_provider_refs_provider_external_place_id_key" ON "trove"."place_provider_refs"("provider", "external_place_id");

-- CreateIndex
CREATE INDEX "trips_owner_id_idx" ON "trove"."trips"("owner_id");

-- CreateIndex
CREATE INDEX "trips_creator_id_idx" ON "trove"."trips"("creator_id");

-- CreateIndex
CREATE INDEX "trips_starting_place_id_idx" ON "trove"."trips"("starting_place_id");

-- CreateIndex
CREATE INDEX "trips_reference_time_zone_source_place_id_idx" ON "trove"."trips"("reference_time_zone_source_place_id");

-- CreateIndex
CREATE INDEX "trips_source_trip_id_idx" ON "trove"."trips"("source_trip_id");

-- CreateIndex
CREATE INDEX "trip_destinations_place_id_idx" ON "trove"."trip_destinations"("place_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_destinations_trip_id_position_key" ON "trove"."trip_destinations"("trip_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "trip_destinations_trip_id_place_id_key" ON "trove"."trip_destinations"("trip_id", "place_id");

-- CreateIndex
CREATE INDEX "trip_user_relationships_profile_id_role_idx" ON "trove"."trip_user_relationships"("profile_id", "role");

-- CreateIndex
CREATE INDEX "saved_places_place_id_idx" ON "trove"."saved_places"("place_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_places_owner_id_place_id_key" ON "trove"."saved_places"("owner_id", "place_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_places_id_owner_id_key" ON "trove"."saved_places"("id", "owner_id");

-- CreateIndex
CREATE INDEX "saved_collections_owner_id_idx" ON "trove"."saved_collections"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_collections_owner_id_name_key" ON "trove"."saved_collections"("owner_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "saved_collections_id_owner_id_key" ON "trove"."saved_collections"("id", "owner_id");

-- CreateIndex
CREATE INDEX "saved_collection_places_owner_id_idx" ON "trove"."saved_collection_places"("owner_id");

-- CreateIndex
CREATE INDEX "saved_collection_places_saved_place_id_owner_id_idx" ON "trove"."saved_collection_places"("saved_place_id", "owner_id");

-- CreateIndex
CREATE INDEX "trip_places_place_id_idx" ON "trove"."trip_places"("place_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_places_trip_id_place_id_key" ON "trove"."trip_places"("trip_id", "place_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_places_id_trip_id_key" ON "trove"."trip_places"("id", "trip_id");

-- CreateIndex
CREATE INDEX "itinerary_days_daily_base_trip_place_id_trip_id_idx" ON "trove"."itinerary_days"("daily_base_trip_place_id", "trip_id");

-- CreateIndex
CREATE INDEX "itinerary_days_default_time_zone_source_trip_place_id_trip__idx" ON "trove"."itinerary_days"("default_time_zone_source_trip_place_id", "trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "itinerary_days_trip_id_date_key" ON "trove"."itinerary_days"("trip_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "itinerary_days_id_trip_id_key" ON "trove"."itinerary_days"("id", "trip_id");

-- CreateIndex
CREATE INDEX "itinerary_items_trip_id_idx" ON "trove"."itinerary_items"("trip_id");

-- CreateIndex
CREATE INDEX "itinerary_items_itinerary_day_id_trip_id_idx" ON "trove"."itinerary_items"("itinerary_day_id", "trip_id");

-- CreateIndex
CREATE INDEX "itinerary_items_trip_place_id_trip_id_idx" ON "trove"."itinerary_items"("trip_place_id", "trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "itinerary_items_scheduled_position_key"
ON "trove"."itinerary_items"("itinerary_day_id", "position")
WHERE "itinerary_day_id" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "itinerary_items_unscheduled_position_key"
ON "trove"."itinerary_items"("trip_id", "position")
WHERE "itinerary_day_id" IS NULL;

-- AddForeignKey
ALTER TABLE "trove"."profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "trove"."profiles" ADD CONSTRAINT "profiles_home_place_id_fkey" FOREIGN KEY ("home_place_id") REFERENCES "trove"."places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."places" ADD CONSTRAINT "places_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."place_provider_refs" ADD CONSTRAINT "place_provider_refs_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "trove"."places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."trips" ADD CONSTRAINT "trips_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."trips" ADD CONSTRAINT "trips_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "trove"."profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."trips" ADD CONSTRAINT "trips_starting_place_id_fkey" FOREIGN KEY ("starting_place_id") REFERENCES "trove"."places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."trips" ADD CONSTRAINT "trips_reference_time_zone_source_place_id_fkey" FOREIGN KEY ("reference_time_zone_source_place_id") REFERENCES "trove"."places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."trips" ADD CONSTRAINT "trips_source_trip_id_fkey" FOREIGN KEY ("source_trip_id") REFERENCES "trove"."trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."trip_destinations" ADD CONSTRAINT "trip_destinations_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trove"."trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."trip_destinations" ADD CONSTRAINT "trip_destinations_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "trove"."places"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."trip_user_relationships" ADD CONSTRAINT "trip_user_relationships_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trove"."trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."trip_user_relationships" ADD CONSTRAINT "trip_user_relationships_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."saved_places" ADD CONSTRAINT "saved_places_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."saved_places" ADD CONSTRAINT "saved_places_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "trove"."places"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."saved_collections" ADD CONSTRAINT "saved_collections_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."saved_collection_places" ADD CONSTRAINT "saved_collection_places_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "trove"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."saved_collection_places" ADD CONSTRAINT "saved_collection_places_collection_id_owner_id_fkey" FOREIGN KEY ("collection_id", "owner_id") REFERENCES "trove"."saved_collections"("id", "owner_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."saved_collection_places" ADD CONSTRAINT "saved_collection_places_saved_place_id_owner_id_fkey" FOREIGN KEY ("saved_place_id", "owner_id") REFERENCES "trove"."saved_places"("id", "owner_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."trip_places" ADD CONSTRAINT "trip_places_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trove"."trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."trip_places" ADD CONSTRAINT "trip_places_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "trove"."places"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."itinerary_days" ADD CONSTRAINT "itinerary_days_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trove"."trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."itinerary_days" ADD CONSTRAINT "itinerary_days_daily_base_trip_place_id_trip_id_fkey" FOREIGN KEY ("daily_base_trip_place_id", "trip_id") REFERENCES "trove"."trip_places"("id", "trip_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."itinerary_days" ADD CONSTRAINT "itinerary_days_default_time_zone_source_trip_place_id_trip_fkey" FOREIGN KEY ("default_time_zone_source_trip_place_id", "trip_id") REFERENCES "trove"."trip_places"("id", "trip_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."itinerary_items" ADD CONSTRAINT "itinerary_items_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trove"."trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."itinerary_items" ADD CONSTRAINT "itinerary_items_itinerary_day_id_trip_id_fkey" FOREIGN KEY ("itinerary_day_id", "trip_id") REFERENCES "trove"."itinerary_days"("id", "trip_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trove"."itinerary_items" ADD CONSTRAINT "itinerary_items_trip_place_id_trip_id_fkey" FOREIGN KEY ("trip_place_id", "trip_id") REFERENCES "trove"."trip_places"("id", "trip_id") ON DELETE NO ACTION ON UPDATE CASCADE;
