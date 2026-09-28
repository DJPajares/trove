import type { PlacesService } from './places.js';
import type { PlaceHoursEvidence } from './itinerary-day-evidence.js';
import { mapWithConcurrency, PROVIDER_CONCURRENCY_LIMIT } from './concurrency.js';

export async function loadPlaceEvidence(
  tripPlaces: Array<{ externalPlaceId: string | null; id: string }>,
  placesService: PlacesService | null,
) {
  const hours: PlaceHoursEvidence = new Map();
  const ratings = new Map<string, number>();
  if (!placesService) return { hours, ratings, evidenceTimes: [] as string[] };

  const results = await mapWithConcurrency(
    tripPlaces,
    PROVIDER_CONCURRENCY_LIMIT,
    async (tripPlace) => {
      if (!tripPlace.externalPlaceId) return null;
      const details = await placesService.getDetails({
        detail: 'evidence',
        externalPlaceId: tripPlace.externalPlaceId,
      });
      if (details.status !== 'ok') return null;
      return {
        source: details.freshness.source,
        fetchedAt: details.freshness.fetchedAt,
        id: tripPlace.id,
        openingPeriods: details.place.openingPeriods,
        rating: details.place.rating,
        utcOffsetMinutes: details.place.utcOffsetMinutes,
      };
    },
  );

  for (const result of results) {
    if (!result) continue;
    if (result.rating !== null) ratings.set(result.id, result.rating);
    hours.set(result.id, {
      source: result.source === 'cache' ? 'CACHED_PROVIDER' : 'FRESH_PROVIDER',
      periods: result.openingPeriods,
      utcOffsetMinutes: result.utcOffsetMinutes,
    });
  }

  return {
    hours,
    ratings,
    evidenceTimes: results.flatMap((result) => (result ? [result.fetchedAt] : [])),
  };
}
