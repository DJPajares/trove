'use client';

import type { SchedulingOutcome } from '@trove/types';
import { useQueries } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  fetchItineraryDayTimeSuggestions,
  saveItineraryTimingReview,
  type Itinerary,
} from '@/lib/itinerary/api';
import {
  reconcileTimingReviewIssues,
  timingAssessmentRevision,
  timingReviewDays,
} from '@/lib/itinerary/timing-review-state';
import { queryKeys } from '@/lib/query/keys';

/** Recheck only days already named by the saved review, using the same
 * cache-only assessments and invalidations as the planner's stop warnings. */
export function useTimingReviewRefresh({
  enabled,
  itinerary,
  outcome,
  tripId,
}: {
  enabled: boolean;
  itinerary: Itinerary | null;
  outcome: SchedulingOutcome | null;
  tripId: string;
}) {
  const days = timingReviewDays(outcome, itinerary?.days ?? []);
  const assessments = useQueries({
    queries: days.map((day) => ({
      enabled,
      queryKey: queryKeys.itineraryTiming(tripId, day.id, timingAssessmentRevision(day)),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchItineraryDayTimeSuggestions(tripId, day.id, { signal }),
    })),
  });
  useEffect(() => {
    if (!enabled || !itinerary || !outcome) return;
    const fresh = assessments.flatMap((result, index) =>
      result.isSuccess && !result.isFetching && !result.isStale && result.data.issues !== undefined
        ? [{ itineraryDayId: days[index]!.id, issues: result.data.issues }]
        : [],
    );
    const next = reconcileTimingReviewIssues(outcome, itinerary.days, fresh);
    if (next !== outcome)
      void saveItineraryTimingReview(tripId, next, { expected: outcome }).catch(() => undefined);
  }, [assessments, days, enabled, itinerary, outcome, tripId]);
}
