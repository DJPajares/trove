import { getPrismaClient } from '@trove/db';

import {
  type CanonicalPlace,
  placeProviderRefInclude,
  serializeCanonicalPlace,
  tripPlaceCategories,
} from './place-serializer.js';

/** Enough for any traveller's history, small enough to match on the device. */
export const KNOWN_PLACES_LIMIT = 300;
/** Read a little past the limit, so ordering by last use rather than by row is honest. */
const KNOWN_PLACES_READ = 500;

export type KnownPlace = {
  /** The trip this Place was last used on, so a result can say where it is from. */
  lastTrip: { id: string; name: string } | null;
  place: CanonicalPlace;
  /** What the traveller called it on that trip, when they renamed it. */
  tripName: string | null;
};

/**
 * Every Place the traveller has already reached for - saved, used on any of
 * their trips, or made themselves - most recently used first.
 *
 * This is what lets a place picker answer from Trove before anyone asks
 * Google: it reads only what the database holds, and serializes it the same
 * way every other surface does, so a stale provider snapshot falls back to the
 * stored label rather than being refreshed here. Nothing is fetched.
 */
export async function listKnownPlaces(
  userId: string,
  options: { now?: Date } = {},
): Promise<KnownPlace[]> {
  const ownTrip = { trip: { ownerId: userId } };
  const places = await getPrismaClient().place.findMany({
    include: {
      ...placeProviderRefInclude,
      savedPlaces: { select: { createdAt: true }, where: { ownerId: userId } },
      tripPlaces: {
        orderBy: { createdAt: 'desc' },
        select: {
          categories: true,
          createdAt: true,
          customName: true,
          trip: { select: { id: true, name: true } },
        },
        take: 1,
        where: ownTrip,
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: KNOWN_PLACES_READ,
    where: {
      OR: [
        { ownerId: userId },
        { savedPlaces: { some: { ownerId: userId } } },
        { tripPlaces: { some: ownTrip } },
      ],
    },
  });

  const lastUsed = (place: (typeof places)[number]) =>
    Math.max(
      0,
      ...place.tripPlaces.map((tripPlace) => tripPlace.createdAt.getTime()),
      ...place.savedPlaces.map((savedPlace) => savedPlace.createdAt.getTime()),
    );

  return places
    .toSorted((left, right) => lastUsed(right) - lastUsed(left))
    .slice(0, KNOWN_PLACES_LIMIT)
    .map((record) => {
      const usage = record.tripPlaces[0] ?? null;
      const place = serializeCanonicalPlace(record, { now: options.now });
      return {
        lastTrip: usage ? usage.trip : null,
        // A Place used on a trip carries what that trip said it is, so a home
        // marked as somewhere to stay is still one in the next trip's Stay picker.
        place: usage ? { ...place, ...tripPlaceCategories(place, usage.categories) } : place,
        tripName: usage?.customName ?? null,
      };
    });
}
