import { getPrismaClient } from '@trove/db';

import { timeZoneAtCoordinates } from './coordinate-time-zone.js';
import { ItineraryNotFoundError } from './itineraries.js';
import { placeHoursStatus } from './place-hours-status.js';
import { placeProfile } from './plan-score-place-types.js';
import {
  discardExpiredCurrentHours,
  loadPlaceEvidence,
  loadScoringForecasts,
  mergeScoringPlaceIdentity,
  PLAN_SCORE_TRIP_INCLUDE,
  readPlanScoreInputs,
} from './plan-score.js';
import {
  indoorAlternativesFor,
  type IndoorAlternative,
  type IndoorCandidate,
} from './rain-alternatives-rules.js';

/** A rainy day's outdoor stops, each with indoor places from the traveller's own list. */
export type RainAlternatives = {
  date: string;
  generatedAt: string;
  stops: Array<{
    alternatives: Array<IndoorAlternative & { name: string }>;
    itemId: string;
    name: string;
    /**
     * The stop's own label is just the old place's name (or there is none), so a
     * swap should retitle it. A label the traveller wrote is theirs and stays.
     */
    retitleOnSwap: boolean;
    /** False when the stop has a reservation, so replacing it needs review, not a tap. */
    swappable: boolean;
    tripPlaceId: string;
  }>;
};

/** Plan Score raises its rain advisory at this chance; the suggestion uses the same bar. */
const RAIN_PROBABILITY = 60;

export async function getRainAlternatives(
  userId: string,
  tripId: string,
  itineraryDayId: string,
  services: { now?: Date } = {},
): Promise<RainAlternatives> {
  const now = services.now ?? new Date();
  const trip = await getPrismaClient().trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: PLAN_SCORE_TRIP_INCLUDE,
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');
  const day = readPlanScoreInputs(trip, now).days.find((entry) => entry.id === itineraryDayId);
  if (!day) throw new ItineraryNotFoundError('itinerary_day_not_found');
  const empty = { date: day.date, generatedAt: now.toISOString(), stops: [] };

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

  const evidence = await loadPlaceEvidence(
    trip.tripPlaces
      .filter((row) => dayPlaceIds.has(row.id) || candidateIds.has(row.id))
      .map((row) => ({
        externalPlaceId:
          row.place.providerRefs.find((reference) => reference.provider === 'GOOGLE')
            ?.externalPlaceId ?? null,
        id: row.id,
      })),
    now,
  );
  for (const row of trip.tripPlaces) {
    const merged = mergeScoringPlaceIdentity(row.id, row.place, evidence.places.get(row.id), now);
    evidence.places.set(row.id, merged.place);
    const hours = evidence.hours.get(row.id);
    if (hours && !hours.timeZone && merged.place.coordinates)
      hours.timeZone = timeZoneAtCoordinates(merged.place.coordinates);
  }
  discardExpiredCurrentHours(evidence.hours, now);

  // The same stored forecast Plan Score reads; nothing is fetched to answer this.
  const { forecasts } = await loadScoringForecasts([day], evidence.places, now);
  const rainy = new Set(
    forecasts.flatMap((forecast) =>
      forecast.date === day.date &&
      forecast.precipitationProbability !== null &&
      forecast.precipitationProbability >= RAIN_PROBABILITY
        ? forecast.placeIds
        : [],
    ),
  );

  const nameOf = (id: string) => evidence.places.get(id)?.name?.trim() ?? '';
  const candidates: IndoorCandidate[] = [...candidateIds].flatMap((id) => {
    const place = evidence.places.get(id);
    const stored = evidence.hours.get(id);
    const status = stored
      ? placeHoursStatus({ date: day.date, hours: stored, zone: trip.referenceTimeZone ?? 'UTC' })
      : null;
    return nameOf(id)
      ? [
          {
            closedThatDay: status?.status === 'closed',
            coordinates: place?.coordinates ?? null,
            hoursUnknown: !status || status.status === 'unknown',
            rating: evidence.ratings.get(id) ?? null,
            tripPlaceId: id,
            types: place?.types ?? [],
          },
        ]
      : [];
  });

  const labels = new Map(
    (trip.itineraryDays.find((row) => row.id === day.id)?.items ?? []).map((row) => [
      row.id,
      row.customLabel?.trim() ?? '',
    ]),
  );
  const stops = day.items.flatMap((item) => {
    const id = item.tripPlaceId;
    if (!id || !rainy.has(id) || !placeProfile(evidence.places.get(id)?.types)?.outdoor) return [];
    const alternatives = indoorAlternativesFor(
      evidence.places.get(id)?.coordinates ?? null,
      candidates,
    ).flatMap((alternative) =>
      nameOf(alternative.tripPlaceId)
        ? [{ ...alternative, name: nameOf(alternative.tripPlaceId) }]
        : [],
    );
    if (!alternatives.length) return [];
    return [
      {
        alternatives,
        itemId: item.id,
        name: nameOf(id) || item.id,
        retitleOnSwap: (() => {
          const label = labels.get(item.id) ?? '';
          return (
            !label || label.localeCompare(nameOf(id), undefined, { sensitivity: 'base' }) === 0
          );
        })(),
        swappable: (item.reservationCount ?? 0) === 0,
        tripPlaceId: id,
      },
    ];
  });

  return stops.length ? { ...empty, stops } : empty;
}
