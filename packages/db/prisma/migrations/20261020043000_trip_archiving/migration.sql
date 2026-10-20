ALTER TABLE "trove"."trips" ADD COLUMN "archived_at" TIMESTAMPTZ(3);
CREATE INDEX "trips_owner_id_archived_at_idx" ON "trove"."trips" ("owner_id", "archived_at");

-- Lock the owning trip before content writes. Archive takes the same row lock,
-- so a request admitted just before archiving cannot commit a later edit.
-- Invoker permissions and existing ownership/RLS policies remain in force.
CREATE FUNCTION trove.guard_archived_trip_content() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, trove AS $$
DECLARE record_data jsonb; target_trip uuid; archived timestamptz;
BEGIN
  FOR record_data IN SELECT to_jsonb(OLD) UNION ALL SELECT to_jsonb(NEW) LOOP
    IF record_data IS NULL THEN CONTINUE; END IF;
    target_trip := (record_data->>'trip_id')::uuid;
    IF TG_TABLE_NAME = 'memory_photos' THEN
      SELECT trip_id INTO target_trip FROM trove.memories WHERE id = (record_data->>'memory_id')::uuid;
    ELSIF TG_TABLE_NAME = 'reservation_attachments' THEN
      SELECT trip_id INTO target_trip FROM trove.reservations WHERE id = (record_data->>'reservation_id')::uuid;
    END IF;
    SELECT archived_at INTO archived FROM trove.trips WHERE id = target_trip FOR UPDATE;
    IF archived IS NOT NULL THEN RAISE EXCEPTION 'trip_archived'; END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['trip_destinations','trip_user_relationships','trip_places','day_experiences','trip_stay_ranges','itinerary_days','itinerary_items','tasks','trip_info','reservations','reservation_attachments','reservation_accommodation_days','expenses','memories','memory_photos'] LOOP
    EXECUTE format('CREATE TRIGGER guard_archived_trip BEFORE INSERT OR UPDATE OR DELETE ON trove.%I FOR EACH ROW EXECUTE FUNCTION trove.guard_archived_trip_content()', table_name);
  END LOOP;
END $$;

CREATE FUNCTION trove.guard_archived_trip_fields() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, trove AS $$
BEGIN
  -- Restoring is permitted; cache maintenance is not a traveller edit.
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at
    AND (to_jsonb(NEW) - ARRAY['updated_at','plan_score','plan_score_revision','plan_score_computed_at','editorial_image_set_id'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at','plan_score','plan_score_revision','plan_score_computed_at','editorial_image_set_id'])
  THEN RAISE EXCEPTION 'trip_archived'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_archived_trip_fields BEFORE UPDATE ON trove.trips FOR EACH ROW EXECUTE FUNCTION trove.guard_archived_trip_fields();
