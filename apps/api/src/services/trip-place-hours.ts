import { getPrismaClient } from '@trove/db';

import { ItineraryNotFoundError } from './itineraries.js';
import { placeHoursStatus, type PlaceHoursStatus } from './place-hours-status.js';
import { loadPlaceEvidence } from './plan-score.js';

/**
 * What Trove has stored about each of a trip's places: how they are rated and,
 * for a date, whether they are open. Read from the bounded evidence cache only -
 * a place with no stored evidence is simply absent, and nothing here ever
 * reaches a provider to fill the gap.
 */

export type TripPlaceSignals = {
  hours?: PlaceHoursStatus;
  rating?: { reviewCount: number | null; value: number };
};

export type TripPlaceHours = {
  date: string | null;
  generatedAt: string;
  places: Record<string, TripPlaceSignals>;
};

export async function getTripPlaceHours(
  userId: string,
  tripId: string,
  date: string | null,
  services: { now?: Date } = {},
): Promise<TripPlaceHours> {
  const now = services.now ?? new Date();
  const trip = await getPrismaClient().trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: {
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

  const evidence = await loadPlaceEvidence(
    trip.tripPlaces.map((tripPlace) => ({
      externalPlaceId: tripPlace.place.providerRefs[0]?.externalPlaceId ?? null,
      id: tripPlace.id,
    })),
    now,
  );

  const places: Record<string, TripPlaceSignals> = {};
  for (const tripPlace of trip.tripPlaces) {
    const signals: TripPlaceSignals = {};
    const rating = evidence.places.get(tripPlace.id)?.rating;
    if (rating?.status === 'KNOWN') {
      signals.rating = { reviewCount: rating.reviewCount ?? null, value: rating.rating };
    }
    const hours = evidence.hours.get(tripPlace.id);
    if (date && hours) {
      const status = placeHoursStatus({
        date,
        hours,
        zone: trip.referenceTimeZone ?? 'UTC',
      });
      if (status.status !== 'unknown') signals.hours = status;
    }
    if (signals.rating || signals.hours) places[tripPlace.id] = signals;
  }

  return { date, generatedAt: now.toISOString(), places };
}
