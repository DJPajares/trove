'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { queryKeys } from '@/lib/query/keys';
import { type Trip, updateTripReadiness } from '@/lib/trips/api';

/**
 * Setting a plan Ready from wherever the traveller happens to be looking.
 *
 * Readiness is shown on four surfaces at once, so the saved trip is written
 * straight back into both the detail entry and the library list rather than
 * invalidating them: the marker, the library grouping and any prompt all move
 * together, without a refetch and without one surface briefly disagreeing with
 * another.
 */
export function useTripReadiness() {
  const queryClient = useQueryClient();
  const [pendingTripId, setPendingTripId] = useState<string | null>(null);
  const [failedTripId, setFailedTripId] = useState<string | null>(null);

  const setReadiness = useCallback(
    async (trip: Trip, planningReadiness: Trip['planningReadiness']) => {
      setPendingTripId(trip.id);
      setFailedTripId(null);

      try {
        const { trip: saved } = await updateTripReadiness(trip.id, planningReadiness);

        queryClient.setQueryData(queryKeys.trip(saved.id), { trip: saved });
        queryClient.setQueryData(queryKeys.trips(), (current: { trips: Trip[] } | undefined) =>
          current
            ? {
                ...current,
                trips: current.trips.map((candidate) =>
                  candidate.id === saved.id ? saved : candidate,
                ),
              }
            : current,
        );
      } catch {
        setFailedTripId(trip.id);
      } finally {
        setPendingTripId(null);
      }
    },
    [queryClient],
  );

  return { failedTripId, pendingTripId, setReadiness };
}
