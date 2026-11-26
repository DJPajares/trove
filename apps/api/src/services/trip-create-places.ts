import type { Prisma } from '@trove/db';

import { categoriesToDb } from './place-categories.js';
import type { TripPlacePriority } from './trip-places.js';
import type { TrovePlaceCategory } from './places.js';

/** At most this many places arrive with a new trip: the real-place limit (PRD 7.6.2). */
export const TRIP_CREATE_PLACE_LIMIT = 24;

/**
 * A place a new trip carries from the moment it exists, e.g. an Atlas pick or
 * one of a guide's listings (PRD 40.4). Always a Custom Place: nothing here is
 * matched against a provider, so creating a trip never spends a Google call.
 */
export type TripCreatePlace = {
  category?: Exclude<TrovePlaceCategory, 'other'>;
  latitude?: number | null;
  longitude?: number | null;
  name: string;
  priority?: TripPlacePriority;
};

const PRIORITY_TO_DB = {
  interested: 'INTERESTED',
  maybe: 'MAYBE',
  must_go: 'MUST_GO',
} as const satisfies Record<TripPlacePriority, string>;

/**
 * Writes a new trip's places inside the transaction that creates the trip, so
 * one request makes the whole trip and a failure leaves none of it behind.
 * Each place is the traveller's own Custom Place, with the listing's
 * coordinates when both are known, ready to be connected later with Locate.
 */
export async function createTripPlacesInTransaction(
  transaction: Pick<Prisma.TransactionClient, 'place' | 'tripPlace'>,
  userId: string,
  tripId: string,
  places: readonly TripCreatePlace[],
) {
  for (const input of places.slice(0, TRIP_CREATE_PLACE_LIMIT)) {
    const located = typeof input.latitude === 'number' && typeof input.longitude === 'number';
    const place = await transaction.place.create({
      data: {
        categories: input.category ? categoriesToDb([input.category]) : [],
        customLatitude: located ? input.latitude : null,
        customLongitude: located ? input.longitude : null,
        customName: input.name.trim(),
        kind: 'CUSTOM',
        ownerId: userId,
      },
      select: { id: true },
    });
    await transaction.tripPlace.create({
      data: {
        placeId: place.id,
        priority: input.priority ? PRIORITY_TO_DB[input.priority] : null,
        tripId,
      },
    });
  }
}
