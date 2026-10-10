'use client';

import { useTripPlacesDrawer } from '@/components/trip-places-provider';

import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PlanScoreSheet } from '@/components/planner/plan-score-sheet';
import { Button } from '@/components/ui/button';
import { useTripContext as useDestinationContext } from '@/lib/insights/use-trip-context';
import { dayActionLink } from '@/lib/plan-score/presentation';
import { useTripPlanScore } from '@/lib/plan-score/use-trip-plan-score';

export function TripHubScore({ tripId }: { tripId: string }) {
  const t = useTranslations('planScore');
  const { openPlaces } = useTripPlacesDrawer();
  const hub = useTranslations('trips.hub');
  const [open, setOpen] = useState(false);
  const score = useTripPlanScore(tripId);
  const hidden =
    score.status === 'disabled' ||
    Boolean(score.data?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED'));
  useDestinationContext(hidden ? null : tripId);
  if (hidden) return null;
  return (
    <>
      <Button
        aria-haspopup="dialog"
        className="h-auto w-full justify-between gap-4 rounded-[var(--radius-lg)] border border-border-subtle px-4 py-4 text-left whitespace-normal"
        onClick={() => setOpen(true)}
        variant="ghost"
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-semibold">{t('title')}</span>
          <span className="text-xs font-normal text-muted-foreground">{hub('scoreHint')}</span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="text-lg font-semibold text-brand tabular-nums">
            {score.status === 'idle' &&
            score.data?.score !== null &&
            score.data?.score !== undefined
              ? score.data.score
              : hub('scorePending')}
          </span>
          <ChevronRight aria-hidden="true" className="size-4 text-text-subtle" />
        </span>
      </Button>
      <PlanScoreSheet
        onOpenChange={setOpen}
        open={open}
        title={t('title')}
        panel={{
          onOpenTripPlaces: openPlaces,
          completeness: score.data?.completeness ?? null,
          confidence: score.data?.confidence ?? null,
          explanations: score.data?.explanations ?? {
            uncertainty: [],
            whatWorks: [],
            worthImproving: [],
          },
          assessment: score.data,
          change: score.changeFor('trip'),
          resolveAction: (explanation) =>
            score.data ? dayActionLink(tripId, score.data, explanation) : null,
          onRetry: score.retry,
          score: score.data?.score ?? null,
          scope: 'trip',
          status: score.status,
          title: t('title'),
        }}
      />
    </>
  );
}
