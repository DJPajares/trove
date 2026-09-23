import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/keys';
import type { Trip } from '@/lib/trips/api';

/** Keep every cached view of a saved trip in step with the server's answer. */
export function cacheSavedTrip(queryClient: QueryClient, saved: Trip) {
  queryClient.setQueryData(queryKeys.trip(saved.id), { trip: saved });
  queryClient.setQueryData(queryKeys.trips(), (current: { trips: Trip[] } | undefined) =>
    current
      ? {
          ...current,
          trips: current.trips
            .map((candidate) => (candidate.id === saved.id ? saved : candidate))
            .toSorted(
              (left, right) =>
                left.startDate.localeCompare(right.startDate) ||
                left.createdAt.localeCompare(right.createdAt),
            ),
        }
      : current,
  );
}
