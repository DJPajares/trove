import { readCachedPlaceEvidence } from './place-evidence-cache.js';
import { readCachedRoute } from './route-evidence-cache.js';
import { readItineraryDayRoutes, type PlaceResolver } from './itinerary-route-reader.js';

/** Only Trove-owned coordinates or unexpired location snapshots can supply a route. */
export function cachedPlaceResolver(now: Date): PlaceResolver {
  return async (place, kind, id) => {
    if (place.customLatitude !== null && place.customLongitude !== null)
      return {
        id,
        kind,
        label: place.customName,
        coordinates: {
          latitude: place.customLatitude.toNumber(),
          longitude: place.customLongitude.toNumber(),
        },
      };
    const row = place.providerRefs.find((ref) => ref.provider === 'GOOGLE');
    const age = row?.cachedAt ? now.getTime() - row.cachedAt.getTime() : Infinity;
    if (
      !row ||
      age < 0 ||
      age >= 30 * 24 * 60 * 60 * 1000 ||
      row.cachedLatitude === null ||
      row.cachedLongitude === null
    )
      return null;
    return {
      id,
      kind,
      label: row.cachedName,
      evidenceExpiresAt: new Date(row.cachedAt!.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      coordinates: {
        latitude: row.cachedLatitude.toNumber(),
        longitude: row.cachedLongitude.toNumber(),
      },
    };
  };
}
export function readScoringRoutes(
  userId: string,
  tripId: string,
  dayId: string,
  now: Date,
  resolvePlace = cachedPlaceResolver(now),
) {
  return readItineraryDayRoutes(
    userId,
    tripId,
    dayId,
    {},
    {
      resolvePlace,
      routesService: {
        computeRoute: async (request) => {
          const cached = await readCachedRoute(request, now);
          return cached.kind === 'hit' ? cached.result : { status: 'empty', provider: 'google' };
        },
      },
    },
  );
}
export const readScoringPlace = (
  request: Parameters<typeof readCachedPlaceEvidence>[0],
  now: Date,
) => readCachedPlaceEvidence(request, now, { languageIndependent: true });
