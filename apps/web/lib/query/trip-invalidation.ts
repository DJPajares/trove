import type { QueryClient } from '@tanstack/react-query';

import { TRIP_SCOPED_QUERY_ROOTS, type TripScopedQueryRoot } from '@/lib/query/keys';

/**
 * Drops a trip's cached reads so the next render asks again.
 *
 * Every trip-scoped key puts `tripId` immediately after its root, so a prefix
 * match on `[root, tripId]` clears one trip without touching another's. Passing
 * no roots clears all of them, which is what an edit whose blast radius is not
 * obvious should do - a stale screen is a bug, a redundant refetch is not.
 *
 * Note that `trip-mode-context`, `plan-score` and `itinerary-day-routes` are
 * provider-billable. Invalidating them is the *only* thing that refetches them,
 * so leaving one out of a mutation's list shows up as a screen that will not
 * update rather than as an expense.
 */
export function invalidateTripQueries(
  queryClient: QueryClient,
  tripId: string,
  roots: readonly TripScopedQueryRoot[] = TRIP_SCOPED_QUERY_ROOTS,
) {
  return Promise.all(
    roots.map((root) => queryClient.invalidateQueries({ queryKey: [root, tripId] })),
  );
}

/**
 * The roots an itinerary edit invalidates.
 *
 * Editing an item moves what Trip Mode considers "now", changes the leg chain
 * for its day and changes the Plan Score inputs, so all four travel together.
 */
export const ITINERARY_EDIT_QUERY_ROOTS: readonly TripScopedQueryRoot[] = [
  'itinerary',
  'itinerary-day-routes',
  'plan-score',
  'trip-mode-context',
];
