'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { fetchTripPlanScore, type TripPlanScore } from '@/lib/plan-score/api';
import { queryKeys } from '@/lib/query/keys';

export type PlanScoreLoadStatus = 'disabled' | 'error' | 'idle' | 'loading';

/**
 * Plan Score is advisory and derived, so a failure never blocks planning: the
 * caller keeps its last result and shows an unavailable state.
 *
 * One key per trip, with no revision in it. The server keys its own stored
 * score against every input the rubric reads and expires it on age, so a client
 * revision could only ever be a second opinion about the same question - and a
 * worse-informed one, since it cannot see the provider evidence. Two surfaces
 * derived it from `Trip.updatedAt`, which the server's own cache write now
 * bumps, so it changed the key of the score that had just been written.
 *
 * Refetching is therefore entirely the invalidation contract's job: this is
 * still the most expensive endpoint in the app on a server cache miss, so it
 * must not refetch on its own.
 */
export function useTripPlanScore(tripId: string | null) {
  const queryClient = useQueryClient();

  const { data, error, isPending } = useQuery({
    enabled: tripId !== null,
    queryFn: ({ signal }) => fetchTripPlanScore(tripId as string, signal),
    queryKey: queryKeys.planScore(tripId ?? ''),
  });

  const retry = useCallback(() => {
    if (!tripId) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.planScore(tripId) });
  }, [queryClient, tripId]);

  // `null` from the endpoint is the kill switch rather than an absent score,
  // and it is a different state from a score that failed to load.
  const status: PlanScoreLoadStatus = !tripId
    ? 'idle'
    : isPending
      ? 'loading'
      : error
        ? 'error'
        : data === null
          ? 'disabled'
          : 'idle';

  return { data: (data ?? null) as TripPlanScore | null, retry, status };
}
