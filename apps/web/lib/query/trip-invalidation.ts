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

/**
 * The roots a change to what Plan Score reads invalidates.
 *
 * The score is keyed on the trip alone, so nothing refreshes it except this.
 * Must Go priority lives on a Trip Place and reservations decide both a day's
 * fixed commitments and whether an item is anchored, so neither edit is visible
 * to the itinerary's own invalidation.
 */
export const PLAN_SCORE_INPUT_QUERY_ROOTS: readonly TripScopedQueryRoot[] = ['plan-score'];

/**
 * The roots giving a Place coordinates invalidates.
 *
 * A place that was never located contributed no pin, no leg, no forecast point
 * and no score input, so filling it in changes all four at once. Three of these
 * are provider-billable and refetch on nothing but this, which is why the list
 * is written out rather than left to the default.
 */
export const PLACE_LOCATION_QUERY_ROOTS: readonly TripScopedQueryRoot[] = [
  'itinerary',
  'itinerary-day-routes',
  'plan-score',
  'trip-mode-context',
  'trip-places',
  'trip-weather',
];
