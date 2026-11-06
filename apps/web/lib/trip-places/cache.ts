import type { QueryClient } from '@tanstack/react-query';

import type { Itinerary } from '@/lib/itinerary/api';
import { mergeItineraryTripPlace } from '@/lib/itinerary/places';
import { queryKeys } from '@/lib/query/keys';
import { invalidateTripQueries } from '@/lib/query/trip-invalidation';

import type { TripPlace, TripPlacesResponse } from './api';

/**
 * A Place that has just joined the trip, from wherever it was added - the
 * Places drawer, a day's stop editor, or the Stay sheet.
 *
 * The trip's Places collection is never refetched on a timer and an itinerary
 * edit does not invalidate it, so a Place added from a day would otherwise stay
 * missing from Places until a reload. The server has already confirmed it, so
 * it is written straight into both shared caches rather than asked for again.
 */
export function rememberAddedTripPlace(
  queryClient: QueryClient,
  tripId: string,
  tripPlace: TripPlace,
) {
  queryClient.setQueryData<TripPlacesResponse>(queryKeys.tripPlaces(tripId), (current) =>
    current && !current.tripPlaces.some((entry) => entry.id === tripPlace.id)
      ? { ...current, tripPlaces: [...current.tripPlaces, tripPlace] }
      : current,
  );
  queryClient.setQueryData<Itinerary>(queryKeys.itinerary(tripId), (current) =>
    current ? mergeItineraryTripPlace(current, tripPlace) : current,
  );
  void invalidateTripQueries(queryClient, tripId, ['trip-overview', 'plan-score']);
}
