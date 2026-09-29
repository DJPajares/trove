'use client';

import { ChevronDown, Sparkles } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ItineraryDestinationContext } from '@/components/itinerary-destination-context';
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
  currentAssessment,
  DAILY_CATEGORIES,
  prioritizedProblems,
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
  return 'href' in target ? (
    <Button
      className="h-auto px-0 text-sm"
      render={<Link href={target.href} />}
      size="sm"
      variant="link"
    >
      {t(`actions.${explanation.action}`)}
    </Button>
  ) : (
    <Button className="h-auto px-0 text-sm" onClick={target.onSelect} size="sm" variant="link">
      {t(`actions.${explanation.action}`)}
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
    <dl className="divide-y divide-border-subtle">
      {ids.map((id) => {
        const outcome = outcomes[id]!;
        return (
          <div
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
            key={id}
          >
            <dt className="text-sm font-medium">{t(`factorLabels.${id}`)}</dt>
            <dd className="text-right text-sm tabular-nums">
              {outcome.state === 'EVALUATED' ? (
                <>
                  <span className="font-semibold">
                    {outcome.score}{' '}
                    <span className="text-xs font-normal text-muted-foreground">{t('outOf')}</span>
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('categoryEvidence', {
                      coverage: outcome.coverage,
                      confidence: outcome.confidence,
                    })}
                  </p>
                </>
              ) : (
                <span className="text-muted-foreground">
                  {t(
                    outcome.state === 'UNKNOWN'
                      ? 'factorStatus.unknown'
                      : 'factorStatus.notApplicable',
                  )}
                </span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
function Reasons({
  explanations,
  label,
  resolveAction,
}: Pick<Props, 'resolveAction'> & { explanations: PlanScoreExplanation[]; label: string }) {
  const t = useTranslations('planScore');
  if (!explanations.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <ul className="space-y-2">
        {explanations.map((reason, index) => (
          <li className="text-sm leading-relaxed" key={`${reason.code}-${index}`}>
            <p>{t(reason.messageKey, reason.values)}</p>
            <SuggestedAction explanation={reason} resolveAction={resolveAction} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One disclosure shared by planning and AI review. No calculations feed back into the rubric. */
export function PlanScorePanel({
  assessment,
  change,
  className,
  completeness,
  confidence,
  dayId,
  disabled,
  explanations,
  factors,
  headingLevel = 3,
  onRetry,
  resolveAction,
  score,
  scope,
  showDestinationContext = true,
  status,
  title,
}: Props) {
  const t = useTranslations('planScore');
  const formatter = useFormatter();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [focusedRecordId, setFocusedRecordId] = useState<string | null>(null);
  const action = (explanation: PlanScoreExplanation): ScoreAction | null => {
    const supplied = resolveAction?.(explanation);
    if (supplied) return supplied;
    if (!showDestinationContext) return null;
    const context = assessment?.presentation?.destinationContext;
    const groups =
      scope === 'trip'
        ? context?.overview
        : context?.days.find((day) => day.dayId === dayId)?.groups;
    const record = groups
      ?.flatMap((group) => group.records)
      .find(
        (record) =>
          explanation.references.includes(record.id) && Date.parse(record.expiresAt) > Date.now(),
      );
    return record
      ? {
          onSelect: () => {
            setDetailsOpen(true);
            setFocusedRecordId(record.id);
          },
        }
      : null;
  };
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!assessment) return;
    const deadline = assessmentDeadline(assessment);
    if (!Number.isFinite(deadline) || deadline <= Date.now()) {
      setClock(Date.now());
      return;
    }
    const timeout = window.setTimeout(() => setClock(Date.now()), deadline - Date.now() + 1);
    const refresh = () => setClock(Date.now());
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
  const problems = unavailable ? [] : prioritizedProblems(explanations.worthImproving);
  const [topProblem, ...otherProblems] = problems;
  const day = assessment?.days.find((entry) => entry.dayId === dayId);
  const caps = scope === 'day' ? (day?.caps ?? []) : (assessment?.caps ?? []);
  const dateTime = (value: string) =>
    formatter.dateTime(new Date(value), { dateStyle: 'medium', timeStyle: 'short' });
  const adjustment = assessment?.presentation?.adjustments;
  return (
    <section
      aria-label={title}
      className={cn('space-y-3 rounded-lg border border-border bg-card p-4', className)}
    >
      <Heading className="flex items-center gap-2 text-sm font-medium">
        <Sparkles aria-hidden="true" className="size-4 text-muted-foreground" />
        {title}
      </Heading>
      {displayScore !== null ? (
        <div className="flex items-baseline gap-3">
          <span
            aria-label={t('scoreBadgeLabel', { score: displayScore })}
            className="text-2xl font-semibold tabular-nums"
          >
            {displayScore}
            <span aria-hidden="true" className="ml-1 text-xs font-normal text-muted-foreground">
              {t('outOf')}
            </span>
          </span>
          <p className="text-sm font-medium">
            {t(`verdict.${scope}.${verdictBand(displayScore)}`)}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" role="status">
          {unavailable
            ? t(
                reasonStatus === 'expired' && !onRetry
                  ? 'availability.expiredStored'
                  : `availability.${reasonStatus}`,
              )
            : t(`notEnoughInformation.${scope}`)}
        </p>
      )}
      {change && !unavailable ? (
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
      {topProblem ? (
        <div className="space-y-1 text-sm leading-relaxed">
          <p>
            <span className="font-medium">{t('improvementLead')} </span>
            {t(topProblem.messageKey, topProblem.values)}
          </p>
          <SuggestedAction explanation={topProblem} resolveAction={action} />
        </div>
      ) : null}
      {unavailable ? (
        onRetry && ['error', 'expired'].includes(reasonStatus) ? (
          <Button onClick={onRetry} size="sm" variant="outline">
            {t('retry')}
          </Button>
        ) : null
      ) : (
        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
          <CollapsibleTrigger className="group text-xs">
            <ChevronDown
              aria-hidden="true"
              className="size-3 transition-transform duration-[var(--motion-standard)] group-data-panel-open:rotate-180 motion-reduce:transition-none"
            />
            {t(detailsOpen ? 'hideDetails' : 'showDetails')}
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="mt-3 space-y-5 border-t border-border pt-3">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                {typeof confidence === 'number' ? (
                  <span>{t('confidenceValue', { value: confidence })}</span>
                ) : null}
                {typeof completeness === 'number' ? (
                  <span>{t('coverageValue', { value: completeness })}</span>
                ) : null}
              </div>
              {scope === 'day' && factors ? (
                <OutcomeRows ids={DAILY_CATEGORIES} outcomes={factors} />
              ) : null}
              {scope === 'trip' && assessment ? (
                <>
                  <OutcomeRows ids={TRIP_COMPONENTS} outcomes={assessment.components} />
                  {adjustment ? (
                    <div className="space-y-1 text-sm">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t('tripAdjustments')}
                      </p>
                      <p>{t('fatigueAdjustment', { value: adjustment.fatigue })}</p>
                      <p>{t('weakDayAdjustment', { value: adjustment.weakDays })}</p>
                    </div>
                  ) : null}
                </>
              ) : null}
              {caps.length ? (
                <div className="space-y-1 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">{t('appliedCaps')}</p>
                  {caps.map((cap, index) => (
                    <p key={`${cap.reason}-${index}`}>
                      {t(`caps.${cap.reason}`, { limit: cap.limit })}
                    </p>
                  ))}
                </div>
              ) : null}
              <Reasons
                explanations={otherProblems}
                label={t('worthImproving')}
                resolveAction={action}
              />
              <Reasons explanations={explanations.whatWorks} label={t('whatWorks')} />
              <Reasons
                explanations={explanations.uncertainty}
                label={t('uncertainty')}
                resolveAction={action}
              />
              {showDestinationContext && assessment?.presentation?.destinationContext ? (
                <ItineraryDestinationContext
                  onFocusedRecordDismissed={() => setFocusedRecordId(null)}
                  focusedRecordId={focusedRecordId}
                  context={assessment.presentation.destinationContext}
                  dayId={scope === 'day' ? (dayId ?? '') : null}
                />
              ) : null}
              {assessment ? (
                <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                  <p>{t('assessedAt', { date: dateTime(assessment.generatedAt) })}</p>
                  {assessment.evidenceAsOf ? (
                    <p>{t('evidenceAt', { date: dateTime(assessment.evidenceAsOf) })}</p>
                  ) : null}
                  <p>
                    {t('validUntil', {
                      date: dateTime(new Date(assessmentDeadline(assessment)).toISOString()),
                    })}
                  </p>
                </div>
              ) : null}
            </div>
          </CollapsiblePanel>
        </Collapsible>
      )}
    </section>
  );
}
