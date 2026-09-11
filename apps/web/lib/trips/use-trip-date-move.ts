'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { queryKeys } from '@/lib/query/keys';
import { removeTripQueries, TRIP_DATE_QUERY_ROOTS } from '@/lib/query/trip-invalidation';
import { updateTripDates, type Trip } from '@/lib/trips/api';
import { shiftTripDates } from '@/lib/trips/form';

/**
 * Nudging a whole trip along the calendar, from wherever the traveller is
 * looking at it.
 *
 * Both ends move together, so the server reads it as a move and carries the
 * itinerary across rather than rebuilding it - and because the trip keeps its
 * length, this can never be the edit that drops a day, so it never has to stop
 * and ask about unscheduling anything.
 *
 * The saved trip is written straight back into the detail entry and the library
 * list, as readiness does, so the header and the shelf agree without a refetch.
 * What cannot be written back is everything keyed to the calendar - the
 * itinerary, the Plan Score, Trip Mode, the forecast - so those are dropped
 * instead. Marking them stale would not be enough: nothing is watching most of
 * them from here, and this app does not refetch on mount.
 */
export function useTripDateMove() {
  const queryClient = useQueryClient();
  const [pendingTripId, setPendingTripId] = useState<string | null>(null);
  const [failedTripId, setFailedTripId] = useState<string | null>(null);

  const moveTripDates = useCallback(
    async (trip: Trip, days: number) => {
      if (!days) return;
      setPendingTripId(trip.id);
      setFailedTripId(null);

      try {
        const { trip: saved } = await updateTripDates(trip.id, shiftTripDates(trip, days));

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
        removeTripQueries(queryClient, saved.id, TRIP_DATE_QUERY_ROOTS);
      } catch {
        setFailedTripId(trip.id);
      } finally {
        setPendingTripId(null);
      }
    },
    [queryClient],
  );

  return { failedTripId, moveTripDates, pendingTripId };
}
