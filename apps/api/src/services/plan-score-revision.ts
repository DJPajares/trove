import { createHash } from 'node:crypto';

import type { ItineraryDayRecord } from './itinerary-day-evidence.js';
import { PLAN_SCORE_CONTRACT_VERSION, PLAN_SCORE_RUBRIC_VERSION } from './plan-score-rules.js';

/**
 * The routing inputs a day's legs are built from. They live on the Prisma rows
 * rather than in `ItineraryDayRecord`, because the scorer reads legs through
 * the cache-only route reader rather than from the record, so they have to be named
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
 * Reusable provider evidence has a separate digest and original-age deadline:
 * opening hours and ratings can change without an itinerary edit.
 *
 * Day records match `buildTripPlanScore`. Optional timezone/instant metadata is
 * excluded: only destination-local clocks define a planning schedule.
 */
export function tripPlanScoreRevision(input: {
  context?: unknown;
  startDate?: Date | null;
  startingPlaceId?: string | null;
  days: readonly TripPlanScoreRevisionDay[];
  mustGoTripPlaceIds: readonly string[];
  placeIdentities?: readonly { id: string; placeId: string | null }[];
}) {
  const payload = canonicalize({
    // A rubric change has to invalidate every stored score, which is exactly
    // what this constant already promises.
    contractVersion: PLAN_SCORE_CONTRACT_VERSION,
    rubricVersion: PLAN_SCORE_RUBRIC_VERSION,
    evidenceIntegrationVersion: 3,
    context: input.context ?? null,
    startDate: input.startDate ?? null,
    startingPlaceId: input.startingPlaceId ?? null,
    days: input.days.map(({ record, ...day }) => {
      const { timeZone: _zone, items, ...localDay } = record;
      return {
        ...day,
        record: {
          ...localDay,
          items: items.map(
            ({
              timeZone: _itemZone,
              timeZoneSource: _source,
              customLocationTimeZone: _customZone,
              startInstant: _instant,
              ...localItem
            }) => localItem,
          ),
        },
      };
    }),
    mustGoTripPlaceIds: [...input.mustGoTripPlaceIds].toSorted(),
    placeIdentities: [...(input.placeIdentities ?? [])].toSorted((a, b) =>
      a.id.localeCompare(b.id),
    ),
  });

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}
