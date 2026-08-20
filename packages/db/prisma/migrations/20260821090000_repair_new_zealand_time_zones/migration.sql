-- Country-only destinations created before country timezone inference had no
-- Place timezone and therefore fell through to the device fallback. Repair only
-- that inherited chain; explicit and Place-derived values remain authoritative.
WITH target_destinations AS (
  SELECT
    destination.trip_id,
    destination.place_id
  FROM trove.trip_destinations AS destination
  INNER JOIN trove.places AS place ON place.id = destination.place_id
  WHERE lower(regexp_replace(btrim(place.custom_name), '\s+', ' ', 'g')) = 'new zealand'
    AND place.custom_time_zone IS NULL
    AND destination.time_zone IS NULL
),
updated_destinations AS (
  UPDATE trove.trip_destinations AS destination
  SET
    time_zone = 'Pacific/Auckland',
    time_zone_resolved_at = CURRENT_TIMESTAMP
  FROM target_destinations
  WHERE destination.trip_id = target_destinations.trip_id
    AND destination.place_id = target_destinations.place_id
  RETURNING destination.trip_id, destination.place_id
),
updated_places AS (
  UPDATE trove.places AS place
  SET
    custom_time_zone = 'Pacific/Auckland',
    updated_at = CURRENT_TIMESTAMP
  WHERE place.id IN (SELECT place_id FROM updated_destinations)
    AND place.custom_time_zone IS NULL
  RETURNING place.id
),
updated_trips AS (
  UPDATE trove.trips AS trip
  SET
    reference_time_zone = 'Pacific/Auckland',
    reference_time_zone_resolved_at = CURRENT_TIMESTAMP,
    reference_time_zone_source = 'destination',
    reference_time_zone_source_place_id = destinations.place_id,
    updated_at = CURRENT_TIMESTAMP
  FROM (
    SELECT DISTINCT ON (trip_id) trip_id, place_id
    FROM updated_destinations
    ORDER BY trip_id, place_id
  ) AS destinations
  WHERE trip.id = destinations.trip_id
    -- A device fallback is inherited. Explicit and existing Place-derived
    -- sources are intentionally left alone.
    AND trip.reference_time_zone_source = 'device_fallback'
  RETURNING trip.id
),
updated_days AS (
  UPDATE trove.itinerary_days AS day
  SET
    default_time_zone = 'Pacific/Auckland',
    default_time_zone_resolved_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
  WHERE day.trip_id IN (SELECT id FROM updated_trips)
    AND day.default_time_zone_source = 'trip_reference'
  RETURNING day.id, day.date
)
UPDATE trove.itinerary_items AS item
SET
  time_zone = 'Pacific/Auckland',
  time_zone_resolved_at = CURRENT_TIMESTAMP,
  start_instant = CASE
    WHEN item.time_semantics = 'floating_local' AND item.local_start_time IS NOT NULL
      THEN (day.date + item.local_start_time) AT TIME ZONE 'Pacific/Auckland'
    ELSE item.start_instant
  END,
  updated_at = CURRENT_TIMESTAMP
FROM updated_days AS day
WHERE item.itinerary_day_id = day.id
  AND item.time_zone_source = 'day_default';
