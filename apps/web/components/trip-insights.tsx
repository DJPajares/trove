'use client';

import { skipToken, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { PanelSurface } from '@/components/panel-surface';
import { TripInsightsPanel } from '@/components/trip-insights-panel';
import { composeInsights } from '@/lib/insights/compose';
import { useTripContext } from '@/lib/insights/use-trip-context';
import type { PlanScoreExplanation, TripPlanScore } from '@/lib/plan-score/api';
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
  resolveAction?: (explanation: PlanScoreExplanation) => ScoreAction | null;
  surface?: PanelSurface;
  tripId: string;
}>) {
  const context = useTripContext(enabled ? tripId : null);
  const { data: planScore } = useQuery<TripPlanScore | null>({
    queryFn: skipToken,
    queryKey: queryKeys.planScore(tripId),
  });
  const insights = useMemo(() => {
    // A stale assessment's forecast advisory is exactly what must not be shown.
    const days = planScore && currentAssessment(planScore) ? planScore.days : [];
    return composeInsights({
      context,
      explanations: new Map(days.map((day) => [day.dayId, day.explanations])),
      scope: dayId ? { kind: 'day', dayId } : { kind: 'trip' },
    });
  }, [context, dayId, planScore]);

  return (
    <TripInsightsPanel
      className={className}
      headingLevel={headingLevel}
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
