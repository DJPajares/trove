import { createHash } from 'node:crypto';

import type { ItineraryDayRecord } from './itinerary-day-evidence.js';
import { PLAN_SCORE_CONTRACT_VERSION } from './plan-score-rules.js';

/**
 * The routing inputs a day's legs are built from. They live on the Prisma rows
 * rather than in `ItineraryDayRecord`, because the scorer reads legs through
 * `getItineraryDayRoutes` rather than from the record, so they have to be named
 * here or a reorder would not move the digest.
 */
export type TripPlanScoreRevisionRouting = {
  dailyBaseDepartureTripPlaceId: string | null;
  dailyBaseTripPlaceId: string | null;
  items: Array<{ id: string; position: number; travelModeToNext: string | null }>;
  routeStartTravelMode: string;
};

export type TripPlanScoreRevisionDay = {
  record: ItineraryDayRecord;
  routing: TripPlanScoreRevisionRouting;
};

/**
 * Key order is part of a JSON string, and the two callers build these objects in
 * their own code, so canonicalising is what stops an identical trip hashing two
 * different ways depending on which mapper produced it.
 */
function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

/**
 * Identifies every Trove-owned input the Plan Score rubric reads, so a stored
 * score can be served without recomputing it and an edit invalidates it with no
 * trigger to maintain.
 *
 * It deliberately says nothing about the provider evidence behind a score:
 * opening hours and ratings can change with no itinerary edit and are never
 * persisted, so freshness there is a matter for the cache's age rather than its
 * key.
 *
 * The day records are the same objects handed to `buildTripPlanScore`, which is
 * what keeps the key complete: a field added to the record is in the digest
 * without anyone remembering to add it.
 */
export function tripPlanScoreRevision(input: {
  days: readonly TripPlanScoreRevisionDay[];
  mustGoTripPlaceIds: readonly string[];
}) {
  const payload = canonicalize({
    // A rubric change has to invalidate every stored score, which is exactly
    // what this constant already promises.
    contractVersion: PLAN_SCORE_CONTRACT_VERSION,
    days: input.days,
    mustGoTripPlaceIds: [...input.mustGoTripPlaceIds].toSorted(),
  });

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}
