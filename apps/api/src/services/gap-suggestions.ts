import { getPrismaClient } from '@trove/db';
import { readTripPlanningPreferences } from '@trove/types';

import { timeZoneAtCoordinates } from './coordinate-time-zone.js';
import { findDayGaps, type DayGap, type GapCandidate } from './gap-suggestions-rules.js';
import { formatInstantInTimeZone } from './itinerary-rules.js';
import { ItineraryNotFoundError } from './itineraries.js';
import { inferDurations } from './plan-score-estimates.js';
import { scoringOpeningHours } from './plan-score-normalization.js';
import { placeProfile } from './plan-score-place-types.js';
import {
  buildScoringDay,
  discardExpiredCurrentHours,
  loadPlaceEvidence,
  mergeScoringPlaceIdentity,
  PLAN_SCORE_TRIP_INCLUDE,
  readPlanScoreInputs,
  tripLegCalibration,
  type PlanScoreTripRecord,
} from './plan-score.js';
import { cachedPlaceResolver, readScoringRoutes } from './scoring-evidence.js';

/**
 * Free stretches in a day, each with up to three of the traveller's own
 * unplanned Trip Places that fit it. Read the way Plan Score reads the day,
 * from stored evidence only; nothing here reaches a provider.
 */

export type DayGapSuggestions = {
  generatedAt: string;
  gaps: Array<
    Omit<DayGap, 'endMinute' | 'startMinute' | 'suggestions'> & {
      endTime: string;
      startTime: string;
      suggestions: Array<DayGap['suggestions'][number] & { startTime: string }>;
    }
  >;
};

export async function getDayGapSuggestions(
  userId: string,
  tripId: string,
  itineraryDayId: string,
  services: { now?: Date } = {},
): Promise<DayGapSuggestions> {
  const now = services.now ?? new Date();
  const trip = await getPrismaClient().trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: PLAN_SCORE_TRIP_INCLUDE,
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');
  const day = readPlanScoreInputs(trip, now).days.find((entry) => entry.id === itineraryDayId);
  if (!day) throw new ItineraryNotFoundError('itinerary_day_not_found');

  // Only places the traveller chose and has not planned yet, and never a base.
  const scheduled = new Set(
    trip.itineraryDays.flatMap((row) =>
      row.items.flatMap((item) => (item.tripPlaceId ? [item.tripPlaceId] : [])),
    ),
  );
  const bases = new Set(
    trip.itineraryDays.flatMap((row) =>
      [row.dailyBaseTripPlaceId, row.dailyBaseDepartureTripPlaceId].filter((id): id is string =>
        Boolean(id),
      ),
    ),
  );
  const candidateIds = new Set(
    trip.tripPlaces.flatMap((row) => (scheduled.has(row.id) || bases.has(row.id) ? [] : [row.id])),
  );
  const dayPlaceIds = new Set(
    day.items.flatMap((item) => (item.tripPlaceId ? [item.tripPlaceId] : [])),
  );

  const [routes, evidence] = await Promise.all([
    readScoringRoutes(userId, tripId, itineraryDayId, now, cachedPlaceResolver(now)),
    loadPlaceEvidence(
      trip.tripPlaces
        .filter((row) => dayPlaceIds.has(row.id) || candidateIds.has(row.id))
        .map((row) => ({
          externalPlaceId:
            row.place.providerRefs.find((reference) => reference.provider === 'GOOGLE')
              ?.externalPlaceId ?? null,
          id: row.id,
        })),
      now,
    ),
  ]);
  for (const row of trip.tripPlaces) {
    const merged = mergeScoringPlaceIdentity(row.id, row.place, evidence.places.get(row.id), now);
    evidence.places.set(row.id, merged.place);
    const hours = evidence.hours.get(row.id);
    if (hours && !hours.timeZone && merged.place.coordinates)
      hours.timeZone = timeZoneAtCoordinates(merged.place.coordinates);
  }
  discardExpiredCurrentHours(evidence.hours, now);

  const record: PlanScoreTripRecord = {
    days: [day],
    hours: evidence.hours,
    mustGoTripPlaceIds: [],
    places: evidence.places,
    preferences: trip.planningPreferences,
    ratings: evidence.ratings,
    routes: new Map([[day.id, routes]]),
  };
  const calibration = tripLegCalibration(record);
  const scoring = buildScoringDay(day, record, calibration);
  const typeOf = (id: string | undefined) => (id ? evidence.places.get(id)?.types : null);
  const items = inferDurations(
    scoring.items,
    (item) => placeProfile(typeOf(item.placeId))?.visit?.typical ?? null,
  ).items;

  const candidates: GapCandidate[] = [...candidateIds].map((id) => {
    const place = evidence.places.get(id);
    const hours = evidence.hours.get(id);
    return {
      coordinates: place?.coordinates ?? null,
      hours: hours
        ? scoringOpeningHours({ date: day.date, hours, origin: scoring.origin, zone: day.timeZone })
        : { status: 'UNKNOWN' },
      rating: evidence.ratings.get(id) ?? null,
      tripPlaceId: id,
      types: place?.types ?? [],
    };
  });

  const gaps = findDayGaps({
    calibration,
    candidates,
    interests: readTripPlanningPreferences(trip.planningPreferences).interests,
    items,
    locate: (id) => (id ? (evidence.places.get(id)?.coordinates ?? null) : null),
    mode: routes.segments.find((segment) => segment.scope === 'local')?.mode ?? 'walk',
  });

  // Minutes from the day's own midnight become its wall-clock time.
  const clock = (minute: number) =>
    formatInstantInTimeZone(new Date(scoring.origin + minute * 60_000), day.timeZone).time;

  return {
    generatedAt: now.toISOString(),
    gaps: gaps.map(({ endMinute, startMinute, suggestions, ...gap }) => ({
      ...gap,
      endTime: clock(endMinute),
      startTime: clock(startMinute),
      suggestions: suggestions.map((suggestion) => ({
        ...suggestion,
        startTime: clock(suggestion.startMinute),
      })),
    })),
  };
}
