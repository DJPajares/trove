import type { QueryClient } from '@tanstack/react-query';

import type { Itinerary } from '@/lib/itinerary/api';
import { queryKeys } from '@/lib/query/keys';
import { invalidateTripQueries, PLAN_SCORE_INPUT_QUERY_ROOTS } from '@/lib/query/trip-invalidation';
import { updateTripPlace, type TripPlacePriority, type TripPlacesResponse } from './api';

/** Priority belongs to the Trip Place, shared by every scheduled occurrence. */
export async function setTripPlacePriority(
  queryClient: QueryClient,
  tripId: string,
  tripPlaceId: string,
  priority: TripPlacePriority | null,
) {
  const { tripPlace } = await updateTripPlace(tripId, tripPlaceId, { priority });
  queryClient.setQueryData<TripPlacesResponse>(queryKeys.tripPlaces(tripId), (current) =>
    current
      ? {
          ...current,
          tripPlaces: current.tripPlaces.map((place) =>
            place.id === tripPlaceId ? tripPlace : place,
          ),
        }
      : current,
  );
  queryClient.setQueryData<Itinerary>(queryKeys.itinerary(tripId), (current) => {
    if (!current) return current;
    const updateItem = (item: Itinerary['unscheduledItems'][number]) =>
      item.tripPlace?.id === tripPlaceId
        ? { ...item, tripPlace: { ...item.tripPlace, priority: tripPlace.priority } }
        : item;
    return {
      ...current,
      tripPlaces: current.tripPlaces.map((place) =>
        place.id === tripPlaceId ? { ...place, priority: tripPlace.priority } : place,
      ),
      days: current.days.map((day) => ({ ...day, items: day.items.map(updateItem) })),
      unscheduledItems: current.unscheduledItems.map(updateItem),
    };
  });
  await invalidateTripQueries(queryClient, tripId, PLAN_SCORE_INPUT_QUERY_ROOTS);
}
