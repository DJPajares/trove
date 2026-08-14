'use client';

import { useCallback, useEffect, useState } from 'react';

import { fetchTripPlanScore, type TripPlanScore } from '@/lib/plan-score/api';

export type PlanScoreLoadStatus = 'error' | 'idle' | 'loading';

/**
 * Plan Score is advisory and derived, so a failure never blocks planning: the
 * caller keeps its last result and shows an unavailable state.
 *
 * `revision` changes whenever an itinerary, route, place, or reservation edit
 * invalidates the score, following the invalidation contract.
 */
export function useTripPlanScore(tripId: string | null, revision: string) {
  const [data, setData] = useState<TripPlanScore | null>(null);
  const [status, setStatus] = useState<PlanScoreLoadStatus>('idle');
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!tripId) {
      setData(null);
      setStatus('idle');
      return;
    }

    const controller = new AbortController();
    setStatus('loading');

    fetchTripPlanScore(tripId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setStatus('idle');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          return;
        }
        setStatus('error');
      });

    return () => controller.abort();
  }, [attempt, revision, tripId]);

  return { data, retry, status };
}
