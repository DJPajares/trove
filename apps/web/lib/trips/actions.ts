import type { QueryClient } from '@tanstack/react-query';

import { discardTripOfflineData } from '@/lib/offline/trip-preparation';
import { queryKeys } from '@/lib/query/keys';
import { removeTripQueries } from '@/lib/query/trip-invalidation';
import { deleteTrip, type Trip } from '@/lib/trips/api';

/** Identity-only edits must not refresh provider-billable planning queries. */
export function tripEditMovesPlan(before: Trip, after: Trip) {
  return (
    before.startDate !== after.startDate ||
    before.endDate !== after.endDate ||
    before.referenceTimeZone !== after.referenceTimeZone ||
    before.planningReadiness !== after.planningReadiness ||
    before.destinations.map((entry) => entry.name).join('\u0000') !==
      after.destinations.map((entry) => entry.name).join('\u0000')
  );
}

/** Clear local copies only after the server confirms the trip was deleted. */
export async function deleteTripAndClearCaches(queryClient: QueryClient, tripId: string) {
  await deleteTrip(tripId);
  queryClient.setQueryData(queryKeys.trips(), (current: { trips: Trip[] } | undefined) =>
    current ? { trips: current.trips.filter((trip) => trip.id !== tripId) } : current,
  );
  queryClient.removeQueries({ queryKey: queryKeys.trip(tripId) });
  removeTripQueries(queryClient, tripId);
  // A failed storage cleanup cannot undo a successful server deletion.
  await discardTripOfflineData(tripId).catch(() => undefined);
}
