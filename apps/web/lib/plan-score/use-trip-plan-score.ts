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
 * `revision` changes whenever an itinerary, route, place, or reservation edit
 * invalidates the score, following the invalidation contract. It is part of the
 * query key rather than a refetch trigger, which is what makes an unchanged
 * trip free - this is the most expensive endpoint in the app, fanning out to
 * one Routes call per leg per day plus a Place lookup per scheduled Place, so a
 * second look at a trip nobody edited must not pay for it again.
 */
export function useTripPlanScore(tripId: string | null, revision: string) {
  const queryClient = useQueryClient();

  const { data, error, isPending } = useQuery({
    enabled: tripId !== null,
    queryFn: ({ signal }) => fetchTripPlanScore(tripId as string, signal),
    queryKey: queryKeys.planScore(tripId ?? '', revision),
  });

  const retry = useCallback(() => {
    if (!tripId) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.planScore(tripId, revision) });
  }, [queryClient, revision, tripId]);

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
