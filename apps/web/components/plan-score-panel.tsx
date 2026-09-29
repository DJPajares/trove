'use client';

import { Check, ChevronDown, Gauge } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Meter } from '@/components/ui/meter';
import { panelSurfaceClass, type PanelSurface } from '@/components/panel-surface';
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
  scoreBand,
  travelerInsightGroups,
  TRIP_COMPONENTS,
  type ScoreAction,
  type ScoreBand,
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
  status: PlanScoreLoadStatus;
  surface?: PanelSurface;
  title: string;
}>;
/** Colour follows the verdict band; the words always carry the meaning. */
const WARNING_BANDS = new Set<ScoreBand>(['refine', 'attention']);
function toneFor(score: number) {
  return WARNING_BANDS.has(scoreBand(score)) ? 'warning' : 'brand';
}
function ScoreRing({ label, score }: { label: string; score: number }) {
  const t = useTranslations('planScore');
  const locale = useLocale();
  return (
    <Meter.Root
      aria-label={label}
      className="relative grid size-14 shrink-0 place-items-center"
      format={{ maximumFractionDigits: 0 }}
      getAriaValueText={(value) => t('scoreValue', { score: value })}
      locale={locale}
      value={score}
    >
      <svg aria-hidden="true" className="absolute inset-0 size-full -rotate-90" viewBox="0 0 36 36">
        <circle className="stroke-muted" cx="18" cy="18" fill="none" r="16" strokeWidth="3" />
        <circle
          className={cn(
            'transition-[stroke-dashoffset] duration-[var(--motion-slow)] ease-[var(--ease-standard)] motion-reduce:transition-none',
            toneFor(score) === 'warning' ? 'stroke-status-warning' : 'stroke-brand',
          )}
          cx="18"
          cy="18"
          fill="none"
          pathLength={100}
          r="16"
          strokeDasharray="100"
          strokeDashoffset={100 - score}
          strokeLinecap={score > 0 ? 'round' : 'butt'}
          strokeWidth="3"
        />
      </svg>
      <Meter.Value className="relative text-lg font-semibold leading-none tracking-tight tabular-nums" />
    </Meter.Root>
  );
}
function ScoreDelta({ change }: { change: ScoreChange }) {
  const t = useTranslations('planScore');
  const format = useFormatter();
  if (change.state !== 'score' || change.delta === null) return null;
  const delta = format.number(change.delta, { signDisplay: 'exceptZero' });
  return (
    <Badge role="status" size="sm" variant={change.delta > 0 ? 'success' : 'muted'}>
      <span aria-hidden="true" className="tabular-nums">
        {delta}
      </span>
      <span className="sr-only">
        {t(`changes.sources.${change.source}`)} {t('changes.states.score', { delta })}
      </span>
    </Badge>
  );
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
/** Only categories with enough evidence publish a number (PRD 29.2). */
function publishedScores(
  outcomes: Record<string, PlanScoreFactorOutcome>,
  ids: readonly string[],
): { id: string; score: number }[] {
  return ids.flatMap((id) => {
    const outcome = outcomes[id];
    return outcome?.state === 'EVALUATED' && outcome.coverage >= 60 && outcome.confidence >= 50
      ? [{ id, score: outcome.score }]
      : [];
  });
}
function ScoreMeterRows({ rows }: { rows: { id: string; score: number }[] }) {
  const t = useTranslations('planScore');
  const locale = useLocale();
  return (
    <div className="space-y-3">
      {rows.map(({ id, score }) => (
        <Meter.Root
          className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5"
          format={{ maximumFractionDigits: 0 }}
          getAriaValueText={(value) => t('scoreValue', { score: value })}
          key={id}
          locale={locale}
          value={score}
        >
          <Meter.Label className="text-xs font-medium text-muted-foreground">
            {t(`factorLabels.${id}`)}
          </Meter.Label>
          <Meter.Value className="text-sm font-semibold tabular-nums" />
          <Meter.Track className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <Meter.Indicator
              className={cn(
                'rounded-full transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-standard)] motion-reduce:transition-none',
                toneFor(score) === 'warning' ? 'bg-status-warning' : 'bg-brand',
              )}
            />
          </Meter.Track>
        </Meter.Root>
      ))}
    </div>
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
  surface = 'card',
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
  const { issues: allIssues, highlights } = unavailable
    ? { issues: [], highlights: [] }
    : travelerInsightGroups(explanations);
  const specificGap =
    displayScore === null && !unavailable
      ? allIssues.find((reason) => ['LINK_PLACE', 'EDIT_TRANSFER'].includes(reason.action ?? ''))
      : undefined;
  const issues = allIssues.filter((reason) => reason !== specificGap);
  const outcomes = scope === 'day' ? factors : assessment?.components;
  const rows =
    !unavailable && outcomes
      ? publishedScores(outcomes, scope === 'day' ? DAILY_CATEGORIES : TRIP_COMPONENTS)
      : [];
  const basis =
    displayScore !== null && assessmentStatus === 'provisional' && scopedAssessment
      ? t(assessmentBasisKey(scopedAssessment))
      : null;
  const support = [
    !unavailable &&
    scope === 'trip' &&
    assessment &&
    assessment.assessedDayCount < assessment.applicableDayCount
      ? t('assessedDays', {
          count: assessment.assessedDayCount,
          total: assessment.applicableDayCount,
        })
      : null,
    issues.length ? t('worthALook', { count: issues.length }) : null,
  ].filter((part) => part !== null);
  const hasBreakdown = rows.length > 0 || issues.length > 0 || highlights.length > 0 || !!basis;
  const Subheading = headingLevel === 2 ? 'h3' : 'h4';
  return (
    <section aria-label={title} className={cn('space-y-4', panelSurfaceClass(surface), className)}>
      <Heading className="flex items-center gap-2 text-sm font-medium">
        <Gauge aria-hidden="true" className="size-4 text-muted-foreground" />
        {title}
      </Heading>
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <div className="flex items-center gap-4">
          {displayScore !== null ? <ScoreRing label={title} score={displayScore} /> : null}
          <div className="min-w-0 flex-1 space-y-1">
            {displayScore !== null ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold leading-snug">
                {t(`verdict.${scoreBand(displayScore)}`)}
                {change && !unavailable ? <ScoreDelta change={change} /> : null}
              </p>
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
            {specificGap ? (
              <SuggestedAction explanation={specificGap} resolveAction={resolveAction} />
            ) : null}
            {support.length ? (
              <p className="text-sm text-muted-foreground">
                {support.map((part, index) => (
                  <Fragment key={part}>
                    {index ? (
                      <>
                        {' '}
                        <span aria-hidden="true">·</span>{' '}
                      </>
                    ) : null}
                    {part}
                  </Fragment>
                ))}
              </p>
            ) : null}
            {hasBreakdown ? (
              <CollapsibleTrigger className="group pt-1 text-xs">
                {t(detailsOpen ? 'hideDetails' : 'showDetails')}
                <ChevronDown
                  aria-hidden="true"
                  className="size-3 transition-transform duration-[var(--motion-standard)] group-data-panel-open:rotate-180 motion-reduce:transition-none"
                />
              </CollapsibleTrigger>
            ) : null}
          </div>
        </div>
        {hasBreakdown ? (
          <CollapsiblePanel>
            <div className="mt-4 space-y-5 border-t border-border-subtle pt-4">
              {rows.length ? <ScoreMeterRows rows={rows} /> : null}
              {issues.length ? (
                <div className="space-y-2">
                  <Subheading className="text-xs font-medium text-muted-foreground">
                    {t('worthImproving')}
                  </Subheading>
                  <Reasons reasons={issues} resolveAction={resolveAction} />
                </div>
              ) : null}
              {/* Supporting notes, kept a step quieter than the issues above so they
                  never compete with the score they explain. */}
              {highlights.length ? (
                <div className="space-y-1.5">
                  <Subheading className="text-xs text-muted-foreground">
                    {t('whatWorks')}
                  </Subheading>
                  <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
                    {highlights.map((reason, index) => (
                      <li className="flex gap-1.5" key={`${reason.code}-${index}`}>
                        <Check aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                        <span>{t(reason.messageKey, reason.values)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {basis ? (
                <p className="text-xs leading-relaxed text-muted-foreground">{basis}</p>
              ) : null}
            </div>
          </CollapsiblePanel>
        ) : null}
      </Collapsible>
      {unavailable && onRetry && ['error', 'expired'].includes(reasonStatus) ? (
        <Button onClick={onRetry} size="sm" variant="outline">
          {t('retry')}
        </Button>
      ) : null}
    </section>
  );
}
