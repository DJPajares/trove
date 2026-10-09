'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { PanelSurface } from '@/components/panel-surface';
import { RainIndoorOptions } from '@/components/rain-indoor-options';
import { TripInsightsPanel } from '@/components/trip-insights-panel';
import { composeInsights } from '@/lib/insights/compose';
import { fetchPlaceHoursNotices } from '@/lib/itinerary/api';
import { useTripContext } from '@/lib/insights/use-trip-context';
import {
  fetchTripPlanScore,
  type PlanScoreExplanation,
  type TripPlanScore,
} from '@/lib/plan-score/api';
import { currentAssessment, dayActionLink, type ScoreAction } from '@/lib/plan-score/presentation';
import { queryKeys } from '@/lib/query/keys';

/**
 * Insights for a trip or one of its days. The context is its own request; the
 * day advisories are read from a Plan Score another panel on the screen has
 * already loaded, never fetched here, so Insights adds no scoring work.
 */
export function TripInsights({
  className,
  dayId,
  enabled = true,
  headingLevel,
  initialItemLimit,
  resolveAction,
  surface,
  tripId,
}: Readonly<{
  className?: string;
  /** Omitted for the whole trip. */
  dayId?: string;
  /** False holds the request until the panel is worth asking for. */
  enabled?: boolean;
  headingLevel?: 2 | 3;
  initialItemLimit?: number;
  resolveAction?: (explanation: PlanScoreExplanation) => ScoreAction | null;
  surface?: PanelSurface;
  tripId: string;
}>) {
  const context = useTripContext(enabled ? tripId : null);
  // Reads the score the Plan Score panel fetches, never fetching it here. It
  // carries the same read rather than `skipToken`: whichever observer set the
  // query's options last is the one an evidence refresh runs, and a skipToken
  // there would make that refresh fail.
  const { data: planScore } = useQuery<TripPlanScore | null>({
    enabled: false,
    queryFn: ({ signal }) => fetchTripPlanScore(tripId, signal),
    queryKey: queryKeys.planScore(tripId),
  });
  // Stored evidence only, so this costs no provider request.
  const { data: hoursNotices } = useQuery({
    enabled,
    queryFn: ({ signal }) => fetchPlaceHoursNotices(tripId, { signal }),
    queryKey: queryKeys.hoursNotices(tripId),
    retry: false,
  });
  const insights = useMemo(() => {
    // A stale assessment's forecast advisory is exactly what must not be shown.
    const days = planScore && currentAssessment(planScore) ? planScore.days : [];
    return composeInsights({
      context,
      explanations: new Map(days.map((day) => [day.dayId, day.explanations])),
      hoursNotices: hoursNotices?.notices,
      scope: dayId ? { kind: 'day', dayId } : { kind: 'trip' },
    });
  }, [context, dayId, hoursNotices, planScore]);

  return (
    <TripInsightsPanel
      className={className}
      extraFor={(insight) => {
        // Only a rain item for exactly one day can name which day's stops to look at.
        if (insight.kind !== 'rain') return null;
        const rainDayId =
          dayId ??
          (insight.dayNumbers.length === 1 ? context?.days[insight.dayNumbers[0]! - 1]?.id : null);
        return rainDayId ? <RainIndoorOptions dayId={rainDayId} tripId={tripId} /> : null;
      }}
      headingLevel={headingLevel}
      initialItemLimit={initialItemLimit}
      insights={insights}
      resolveAction={
        resolveAction ?? ((explanation) => dayActionLink(tripId, planScore ?? null, explanation))
      }
      showDays={!dayId}
      surface={surface}
      totalDays={context?.days.length ?? 0}
    />
  );
}
