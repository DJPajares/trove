import type { TripPlacePriority } from './api';

export const tripPlaceSorts = ['name', 'priority', 'recent'] as const;

export type TripPlaceSort = (typeof tripPlaceSorts)[number];

type SortableTripPlace = {
  createdAt?: string;
  priority: TripPlacePriority | null;
};

function priorityRank(priority: TripPlacePriority | null) {
  return priority === 'must_go' ? 0 : priority === 'interested' ? 1 : priority === 'maybe' ? 2 : 3;
}

/**
 * Sorts the trip's collection at the surface that owns the choice. The drawer
 * always uses its name order, while the Places page lets the traveller switch it
 * for this visit without storing a preference.
 */
export function sortTripPlaces<T extends SortableTripPlace>(
  places: readonly T[],
  sort: TripPlaceSort,
  nameFor: (place: T) => string,
) {
  return places.toSorted((left, right) => {
    const nameOrder = nameFor(left).localeCompare(nameFor(right));
    if (sort === 'name') return nameOrder;
    if (sort === 'priority')
      return priorityRank(left.priority) - priorityRank(right.priority) || nameOrder;
    return (right.createdAt ?? '').localeCompare(left.createdAt ?? '') || nameOrder;
  });
}
