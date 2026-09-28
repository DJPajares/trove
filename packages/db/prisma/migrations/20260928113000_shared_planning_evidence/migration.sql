ALTER TABLE trove.place_provider_refs ADD COLUMN cached_evidence JSONB, ADD COLUMN cached_evidence_at TIMESTAMPTZ(3), ADD COLUMN cached_evidence_language TEXT, ADD COLUMN cached_evidence_region TEXT;
ALTER TABLE trove.trips ADD COLUMN planning_preferences JSONB;
ALTER TABLE trove.itinerary_days ADD COLUMN planning_context JSONB;
ALTER TABLE trove.reservations
  ADD COLUMN transport_departure_local_date DATE,
  ADD COLUMN transport_departure_local_time TIME(0),
  ADD COLUMN transport_departure_time_zone TEXT,
  ADD COLUMN transport_departure_instant TIMESTAMPTZ(3),
  ADD COLUMN transport_arrival_local_date DATE,
  ADD COLUMN transport_arrival_local_time TIME(0),
  ADD COLUMN transport_arrival_time_zone TEXT,
  ADD COLUMN transport_arrival_instant TIMESTAMPTZ(3);
