'use client';

import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { PlanScoreSheet } from '@/components/planner/plan-score-sheet';
import { ScoreRing, scoreDisplay } from '@/components/plan-score-panel';
import { useTripPlacesDrawer } from '@/components/trip-places-provider';
import { useTripContext as useDestinationContext } from '@/lib/insights/use-trip-context';
import { dayActionLink, scoreBand } from '@/lib/plan-score/presentation';
import { useTripPlanScore } from '@/lib/plan-score/use-trip-plan-score';

const NO_EXPLANATIONS = { uncertainty: [], whatWorks: [], worthImproving: [] };

/**
 * The trip's Plan Score as one quiet row: its ring and verdict, opening the
 * breakdown on request. The ring shows only a number the breakdown would show.
 */
export function TripHubScore({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('planScore');
  const hub = useTranslations('trips.hub');
  const { openPlaces } = useTripPlacesDrawer();
  const [open, setOpen] = useState(false);
  const [now] = useState(() => Date.now());
  const score = useTripPlanScore(tripId);
  const hidden =
    score.status === 'disabled' ||
    Boolean(score.data?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED'));
  useDestinationContext(hidden ? null : tripId);
  if (hidden) return null;

  const explanations = score.data?.explanations ?? NO_EXPLANATIONS;
  const { displayScore } = scoreDisplay({
    assessment: score.data,
    explanations,
    now: Math.max(now, Date.now()),
    score: score.data?.score ?? null,
    status: score.status,
  });

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="group flex w-full items-center gap-4 rounded-[var(--radius-xl)] border border-border-subtle bg-card p-3.5 pr-4 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none"
        onClick={() => setOpen(true)}
        type="button"
      >
        {displayScore === null ? (
          <span
            aria-hidden="true"
            className="grid size-14 shrink-0 place-items-center rounded-full border-[3px] border-muted text-lg font-semibold text-text-subtle"
          >
            {hub('scorePending')}
          </span>
        ) : (
          <ScoreRing label={t('title')} score={displayScore} />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-muted-foreground">{t('title')}</span>
          <span className="mt-0.5 block text-[0.9375rem] leading-snug font-semibold text-balance">
            {displayScore === null
              ? hub('scoreHint')
              : t(`compactVerdict.${scoreBand(displayScore)}`)}
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-text-subtle transition-transform duration-[var(--motion-standard)] group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </button>
      <PlanScoreSheet
        onOpenChange={setOpen}
        open={open}
        title={t('title')}
        panel={{
          onOpenTripPlaces: openPlaces,
          completeness: score.data?.completeness ?? null,
          confidence: score.data?.confidence ?? null,
          explanations,
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
