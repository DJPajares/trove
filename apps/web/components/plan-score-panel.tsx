'use client';

import { ChevronDown, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import type {
  PlanScoreExplanation,
  PlanScoreExplanationGroups,
  PlanScoreFactorId,
  PlanScoreFactorOutcome,
  TripPlanScore,
} from '@/lib/plan-score/api';
import type { PlanScoreLoadStatus } from '@/lib/plan-score/use-trip-plan-score';
import {
  assessmentDeadline,
  assessmentBasisKey,
  currentAssessment,
  DAILY_CATEGORIES,
  travelerInsights,
  TRIP_COMPONENTS,
  type ScoreAction,
  type ScoreChange,
} from '@/lib/plan-score/presentation';
import { cn } from '@/lib/utils';

type Props = Readonly<{
  assessment?: TripPlanScore | null;
  change?: ScoreChange | null;
  className?: string;
  completeness?: number | null;
  confidence?: number | null;
  dayId?: string;
  disabled?: boolean;
  explanations: PlanScoreExplanationGroups;
  factors?: Record<PlanScoreFactorId, PlanScoreFactorOutcome>;
  headingLevel?: 2 | 3;
  onRetry?: () => void;
  resolveAction?: (explanation: PlanScoreExplanation) => ScoreAction | null;
  score: number | null;
  scope: 'day' | 'trip';
  showDestinationContext?: boolean;
  status: PlanScoreLoadStatus;
  title: string;
}>;
function verdictBand(score: number) {
  return score >= 85 ? 'good' : score >= 70 ? 'workable' : score >= 55 ? 'tight' : 'needsWork';
}
function SuggestedAction({
  explanation,
  resolveAction,
}: Pick<Props, 'resolveAction'> & { explanation: PlanScoreExplanation }) {
  const t = useTranslations('planScore');
  const target = explanation.action ? resolveAction?.(explanation) : null;
  if (!target || !explanation.action) return null;
  const label = t(`actions.${explanation.action}`);
  return 'href' in target ? (
    <Link
      className={cn(buttonVariants({ size: 'sm', variant: 'link' }), 'h-auto px-0 text-sm')}
      href={target.href}
    >
      {label}
    </Link>
  ) : (
    <Button className="h-auto px-0 text-sm" onClick={target.onSelect} size="sm" variant="link">
      {label}
    </Button>
  );
}
function OutcomeRows({
  outcomes,
  ids,
}: {
  outcomes: Record<string, PlanScoreFactorOutcome>;
  ids: readonly string[];
}) {
  const t = useTranslations('planScore');
  return (
    <dl className="space-y-3">
      {ids.flatMap((id) => {
        const outcome = outcomes[id];
        if (outcome?.state !== 'EVALUATED' || outcome.coverage < 60 || outcome.confidence < 50)
          return [];
        return [
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5" key={id}>
            <dt className="text-xs font-medium text-muted-foreground">{t(`factorLabels.${id}`)}</dt>
            <dd className="text-sm font-semibold tabular-nums">
              {outcome.score}
              <span className="sr-only"> {t('outOf')}</span>
            </dd>
            <div
              aria-hidden="true"
              className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${outcome.score}%` }}
              />
            </div>
          </div>,
        ];
      })}
    </dl>
  );
}
function Reasons({
  reasons,
  resolveAction,
}: Pick<Props, 'resolveAction'> & { reasons: PlanScoreExplanation[] }) {
  const t = useTranslations('planScore');
  if (!reasons.length) return null;
  return (
    <ul className="space-y-3">
      {reasons.map((reason, index) => (
        <li className="text-sm leading-relaxed" key={`${reason.code}-${index}`}>
          <p className={cn(['HARD', 'MATERIAL'].includes(reason.severity) && 'font-medium')}>
            {t(reason.messageKey, reason.values)}
          </p>
          <SuggestedAction explanation={reason} resolveAction={resolveAction} />
        </li>
      ))}
    </ul>
  );
}

/** One traveler-facing summary shared by itinerary, Preview and AI review. */
export function PlanScorePanel({
  assessment,
  change,
  className,
  dayId,
  disabled,
  explanations,
  factors,
  headingLevel = 3,
  onRetry,
  resolveAction,
  score,
  scope,
  status,
  title,
}: Props) {
  const t = useTranslations('planScore');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!assessment) return;
    const deadline = assessmentDeadline(assessment);
    const refresh = () => setClock(Date.now());
    const timeout =
      Number.isFinite(deadline) && deadline > Date.now()
        ? window.setTimeout(refresh, deadline - Date.now() + 1)
        : undefined;
    window.addEventListener('focus', refresh);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('focus', refresh);
    };
  }, [assessment]);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  if (
    disabled ||
    status === 'disabled' ||
    assessment?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED')
  )
    return null;
  const unavailable =
    status !== 'idle' ||
    Boolean(assessment && !currentAssessment(assessment, Math.max(clock, Date.now())));
  const displayScore = unavailable ? null : score;
  const reasonStatus = status === 'idle' && unavailable ? 'expired' : status;
  const day = assessment?.days.find((entry) => entry.dayId === dayId);
  const scopedAssessment = scope === 'day' ? day : assessment;
  const assessmentStatus = scopedAssessment?.assessmentStatus;
  const insights = unavailable ? [] : travelerInsights(explanations);
  const initial = insights.slice(0, 3);
  const additional = insights
    .slice(3)
    .filter((reason) => ['HARD', 'MATERIAL', 'RISK'].includes(reason.severity));
  const outcomes = scope === 'day' ? factors : assessment?.components;
  const specificGap =
    displayScore === null && !unavailable
      ? initial.find((reason) => ['LINK_PLACE', 'EDIT_TRANSFER'].includes(reason.action ?? ''))
      : undefined;
  return (
    <section
      aria-label={title}
      className={cn('space-y-5 rounded-lg border border-border bg-card p-4 sm:p-5', className)}
    >
      <Heading className="flex items-center gap-2 text-sm font-medium">
        <Sparkles aria-hidden="true" className="size-4 text-muted-foreground" />
        {title}
      </Heading>
      {displayScore !== null ? (
        <div className="flex items-end gap-4">
          <span
            aria-label={t('scoreBadgeLabel', { score: displayScore })}
            className="text-4xl font-semibold leading-none tracking-tight tabular-nums"
          >
            {displayScore}
            <span
              aria-hidden="true"
              className="ml-1 text-xs font-normal tracking-normal text-muted-foreground"
            >
              {t('outOf')}
            </span>
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {assessmentStatus === 'provisional'
                ? t('provisional')
                : t(`verdict.${scope}.${verdictBand(displayScore)}`)}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" role="status">
          {unavailable
            ? t(
                reasonStatus === 'expired' && !onRetry
                  ? 'availability.expiredStored'
                  : `availability.${reasonStatus}`,
              )
            : specificGap
              ? t(specificGap.messageKey, specificGap.values)
              : t(`notEnoughInformation.${scope}`)}
        </p>
      )}
      {displayScore !== null && assessmentStatus === 'provisional' && scopedAssessment ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t(assessmentBasisKey(scopedAssessment))}
        </p>
      ) : null}
      {!unavailable &&
      scope === 'trip' &&
      assessment &&
      assessment.assessedDayCount < assessment.applicableDayCount ? (
        <p className="text-xs text-muted-foreground">
          {t('assessedDays', {
            count: assessment.assessedDayCount,
            total: assessment.applicableDayCount,
          })}
        </p>
      ) : null}
      {specificGap ? (
        <SuggestedAction explanation={specificGap} resolveAction={resolveAction} />
      ) : null}
      {!unavailable && outcomes ? (
        <OutcomeRows
          outcomes={outcomes}
          ids={scope === 'day' ? DAILY_CATEGORIES : TRIP_COMPONENTS}
        />
      ) : null}
      <Reasons
        reasons={initial.filter((reason) => reason !== specificGap)}
        resolveAction={resolveAction}
      />
      {additional.length ? (
        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
          <CollapsibleTrigger className="group text-xs">
            <ChevronDown
              aria-hidden="true"
              className="size-3 transition-transform duration-[var(--motion-standard)] group-data-panel-open:rotate-180 motion-reduce:transition-none"
            />
            {t(detailsOpen ? 'hideDetails' : 'moreProblems', { count: additional.length })}
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="mt-3 border-t border-border pt-3">
              <Reasons reasons={additional} resolveAction={resolveAction} />
            </div>
          </CollapsiblePanel>
        </Collapsible>
      ) : null}
      {change && !unavailable && change.state !== 'coverage' ? (
        <p className="text-xs text-muted-foreground" role="status">
          {t(`changes.sources.${change.source}`)}{' '}
          {t(`changes.states.${change.state}`, {
            delta:
              change.delta === null
                ? ''
                : change.delta > 0
                  ? `+${change.delta}`
                  : String(change.delta),
          })}
        </p>
      ) : null}
      {unavailable && onRetry && ['error', 'expired'].includes(reasonStatus) ? (
        <Button onClick={onRetry} size="sm" variant="outline">
          {t('retry')}
        </Button>
      ) : null}
    </section>
  );
}
