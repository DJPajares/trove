import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/keys';
import type { Trip } from '@/lib/trips/api';

/** Keep every cached view of a saved trip in step with the server's answer. */
export function cacheSavedTrip(queryClient: QueryClient, saved: Trip) {
  void queryClient.invalidateQueries({ queryKey: ['trip-overview', saved.id] });
  queryClient.setQueryData(queryKeys.trip(saved.id), { trip: saved });
  for (const [key, archived] of [
    [queryKeys.trips(), false],
    [queryKeys.archivedTrips(), true],
  ] as const) {
    queryClient.setQueryData(key, (current: { trips: Trip[] } | undefined) =>
      current
        ? {
            ...current,
            trips: [
              ...current.trips.filter((trip) => trip.id !== saved.id),
              ...(Boolean(saved.archivedAt) === archived ? [saved] : []),
            ].toSorted(
              (a, b) =>
                a.startDate.localeCompare(b.startDate) || a.createdAt.localeCompare(b.createdAt),
            ),
          }
        : current,
    );
  }
}
