import { getPrismaClient } from '@trove/db';

import { ItineraryNotFoundError } from './itineraries.js';
import { placeHoursStatus, type PlaceHoursStatus } from './place-hours-status.js';
import { loadPlaceEvidence } from './plan-score.js';
import { cachedPlaceResolver, readScoringRoutes } from './scoring-evidence.js';

/**
 * What Trip Mode needs to keep working without a connection, beyond the
 * itinerary itself: the travel time between each pair of consecutive stops
 * that Trove has already measured, and each place's opening hours on each day.
 *
 * Read from stored evidence only (PRD 28.1: previously fetched route
 * information). Preparing a trip for offline use therefore buys nothing; a leg
 * or hours never measured are simply absent, and every value keeps the date
 * it was measured so the screen can say how old it is.
 */

export type OfflineLeg = {
  destinationItemId: string;
  distanceMeters: number | null;
  durationSeconds: number;
  fetchedAt: string | null;
  mode: string;
  originItemId: string;
};

export type TripOfflineContext = {
  generatedAt: string;
  /** Opening hours per day date, per Trip Place, where known. */
  hours: Record<string, Record<string, PlaceHoursStatus>>;
  legs: OfflineLeg[];
};

export async function getTripOfflineContext(
  userId: string,
  tripId: string,
  services: { now?: Date } = {},
): Promise<TripOfflineContext> {
  const now = services.now ?? new Date();
  const trip = await getPrismaClient().trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: {
      itineraryDays: {
        select: { date: true, id: true, items: { select: { tripPlaceId: true } } },
      },
      referenceTimeZone: true,
      tripPlaces: {
        select: {
          id: true,
          place: {
            select: {
              providerRefs: { select: { externalPlaceId: true }, where: { provider: 'GOOGLE' } },
            },
          },
        },
      },
    },
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');

  const resolvePlace = cachedPlaceResolver(now);
  const [dayRoutes, evidence] = await Promise.all([
    Promise.all(
      trip.itineraryDays.map((day) => readScoringRoutes(userId, tripId, day.id, now, resolvePlace)),
    ),
    loadPlaceEvidence(
      trip.tripPlaces.map((tripPlace) => ({
        externalPlaceId: tripPlace.place.providerRefs[0]?.externalPlaceId ?? null,
        id: tripPlace.id,
      })),
      now,
    ),
  ]);

  // Only legs a provider actually measured; an estimate is not "previously
  // fetched route information" and would present a guess as a travel time.
  const legs = dayRoutes.flatMap((routes) =>
    routes.segments.flatMap((segment): OfflineLeg[] =>
      segment.origin.kind === 'itinerary_item' &&
      segment.destination.kind === 'itinerary_item' &&
      segment.status === 'ok' &&
      segment.durationSeconds !== null
        ? [
            {
              destinationItemId: segment.destination.id,
              distanceMeters: segment.distanceMeters,
              durationSeconds: segment.durationSeconds,
              fetchedAt: segment.evidenceAsOf ?? null,
              mode: segment.mode,
              originItemId: segment.origin.id,
            },
          ]
        : [],
    ),
  );

  const hours: TripOfflineContext['hours'] = {};
  for (const day of trip.itineraryDays) {
    const date = day.date.toISOString().slice(0, 10);
    const forDay: Record<string, PlaceHoursStatus> = {};
    for (const item of day.items) {
      if (!item.tripPlaceId || forDay[item.tripPlaceId]) continue;
      const stored = evidence.hours.get(item.tripPlaceId);
      if (!stored) continue;
      const status = placeHoursStatus({
        date,
        hours: stored,
        zone: trip.referenceTimeZone ?? 'UTC',
      });
      if (status.status !== 'unknown') forDay[item.tripPlaceId] = status;
    }
    if (Object.keys(forDay).length) hours[date] = forDay;
  }

  return { generatedAt: now.toISOString(), hours, legs };
}
