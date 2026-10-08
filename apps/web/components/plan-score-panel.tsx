'use client';

import { Check, ChevronDown } from 'lucide-react';
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
import { serverNow } from '@/lib/plan-score/clock';
import {
  assessmentDeadline,
  assessmentBasisKey,
  currentAssessment,
  breakdownRows,
  DAILY_CATEGORIES,
  scoreBand,
  travelerInsightGroups,
  TRIP_COMPONENTS,
  type BreakdownRow,
  type ScoreAction,
  type ScoreBand,
  type ScoreChange,
} from '@/lib/plan-score/presentation';
import { cn } from '@/lib/utils';
import * as Icons from '@/lib/icons';

type Props = Readonly<{
  assessment?: TripPlanScore | null;
  change?: ScoreChange | null;
  className?: string;
  completeness?: number | null;
  confidence?: number | null;
  dayId?: string;
  /** Opens with the breakdown showing, for a surface the traveller opened to read it. */
  defaultDetailsOpen?: boolean;
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
  tripPlacesHref?: string;
}>;
/** Colour follows the verdict band; the words always carry the meaning. */
const WARNING_BANDS = new Set<ScoreBand>(['refine', 'attention']);
function toneFor(score: number) {
  return WARNING_BANDS.has(scoreBand(score)) ? 'warning' : 'brand';
}
function ScoreRing({
  label,
  score,
  size = 'md',
  tone = 'surface',
}: {
  label: string;
  score: number;
  /** `sm` is the chip a day's header carries; `md` is the panel's own. */
  size?: 'md' | 'sm';
  tone?: 'media' | 'surface';
}) {
  const t = useTranslations('planScore');
  const locale = useLocale();
  return (
    <Meter.Root
      aria-label={label}
      className={cn(
        'relative grid shrink-0 place-items-center',
        size === 'sm' ? 'size-9' : 'size-14',
      )}
      format={{ maximumFractionDigits: 0 }}
      getAriaValueText={(value) => t('scoreValue', { score: value })}
      locale={locale}
      value={score}
    >
      <svg aria-hidden="true" className="absolute inset-0 size-full -rotate-90" viewBox="0 0 36 36">
        <circle
          className={tone === 'media' ? 'stroke-score-media-foreground/20' : 'stroke-muted'}
          cx="18"
          cy="18"
          fill="none"
          r="16"
          strokeWidth="3"
        />
        <circle
          className={cn(
            'transition-[stroke-dashoffset] duration-[var(--motion-slow)] ease-[var(--ease-standard)] motion-reduce:transition-none',
            tone === 'media'
              ? toneFor(score) === 'warning'
                ? 'stroke-score-media-warning'
                : 'stroke-score-media-brand'
              : toneFor(score) === 'warning'
                ? 'stroke-status-warning'
                : 'stroke-brand',
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
      <Meter.Value
        className={cn(
          'relative font-semibold leading-none tracking-tight tabular-nums',
          size === 'sm' ? (tone === 'media' ? 'text-sm' : 'text-xs') : 'text-lg',
        )}
      />
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
export function SuggestedAction({
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
function ScoreMeterRows({
  rows,
  tripPlacesHref,
}: {
  rows: BreakdownRow[];
  tripPlacesHref?: string;
}) {
  const t = useTranslations('planScore');
  return (
    <div className="space-y-3">
      {rows.map((row) =>
        'notApplicable' in row ? (
          <div className="flex items-baseline justify-between gap-4" key={row.id}>
            <span className="text-xs font-medium text-muted-foreground">
              {t(`factorLabels.${row.id}`)}
            </span>
            <span className="text-xs text-muted-foreground">{t('notApplicableRow')}</span>
          </div>
        ) : (
          <ScoreMeterRow key={row.id} {...row} tripPlacesHref={tripPlacesHref} />
        ),
      )}
    </div>
  );
}
function ScoreMeterRow({
  id,
  score,
  estimated,
  reasonKey,
  tripPlacesHref,
}: Extract<BreakdownRow, { score: number }> & { tripPlacesHref?: string }) {
  const t = useTranslations('planScore');
  const locale = useLocale();
  return (
    <div className="space-y-1">
      <Meter.Root
        className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5"
        format={{ maximumFractionDigits: 0 }}
        getAriaValueText={(value) =>
          t(estimated ? 'estimatedScoreValue' : 'scoreValue', { score: value })
        }
        locale={locale}
        value={score}
      >
        <Meter.Label className="text-xs font-medium text-muted-foreground">
          {t(`factorLabels.${id}`)}
        </Meter.Label>
        <span className="flex items-baseline gap-0.5 text-sm font-semibold tabular-nums">
          {estimated ? (
            <span aria-hidden="true" className="font-normal text-muted-foreground">
              ≈
            </span>
          ) : null}
          <Meter.Value />
        </span>
        <Meter.Track className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <Meter.Indicator
            className={cn(
              'rounded-full transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-standard)] motion-reduce:transition-none',
              toneFor(score) === 'warning' ? 'bg-status-warning' : 'bg-brand',
            )}
          />
        </Meter.Track>
      </Meter.Root>
      {reasonKey ? <p className="text-xs text-muted-foreground">{t(reasonKey)}</p> : null}
      {reasonKey === 'rowReasons.DESTINATION_UTILIZATION' && tripPlacesHref ? (
        <Link
          className={cn(buttonVariants({ size: 'sm', variant: 'link' }), 'h-auto px-0 text-sm')}
          href={tripPlacesHref}
        >
          {t('openTripPlaces')}
        </Link>
      ) : null}
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

/**
 * What a score can honestly show right now: the number only while the
 * assessment is current, and the problems worth a look only alongside it. The
 * panel and the day header's chip both read it, so the chip never shows a
 * number the panel it opens would withhold.
 */
function scoreDisplay({
  assessment,
  explanations,
  now,
  score,
  status,
}: {
  assessment: TripPlanScore | null | undefined;
  explanations: PlanScoreExplanationGroups;
  now: number;
  score: number | null;
  status: PlanScoreLoadStatus;
}) {
  const assessmentCurrent = Boolean(assessment && currentAssessment(assessment, serverNow(now)));
  const unavailable =
    ['loading', 'offline', 'syncing'].includes(status) ||
    (!assessmentCurrent && (status !== 'idle' || Boolean(assessment)));
  const { issues, highlights } = unavailable
    ? { issues: [], highlights: [] }
    : travelerInsightGroups(explanations);
  return {
    displayScore: unavailable ? null : score,
    highlights,
    issues,
    reasonStatus: status === 'idle' && unavailable ? 'expired' : status,
    unavailable,
  };
}

/**
 * A day's score as a chip: the ring, the verdict, and how many problems are
 * worth a look. It is the default, compact level PRD 29.4 asks for; opening it
 * shows the breakdown. Nothing at all while there is no number to show - the
 * opened panel says why, and a chip saying "unavailable" on every day would be
 * noise on the one line it shares.
 */
export function PlanScoreChip({
  assessment,
  className,
  explanations,
  label,
  onOpen,
  score,
  status,
  tone = 'surface',
}: Readonly<{
  assessment: TripPlanScore | null;
  className?: string;
  explanations: PlanScoreExplanationGroups;
  /** What the chip opens, for assistive tech: "Day 3's Plan Score". */
  label: string;
  onOpen: () => void;
  score: number | null;
  status: PlanScoreLoadStatus;
  /** `media` uses an opaque, theme-invariant surface and contrasting ring. */
  tone?: 'media' | 'surface';
}>) {
  const t = useTranslations('planScore');
  const [now] = useState(() => Date.now());
  if (status === 'disabled' || assessment?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED')) {
    return null;
  }
  const { displayScore, issues } = scoreDisplay({
    assessment,
    explanations,
    now: Math.max(now, Date.now()),
    score,
    status,
  });
  if (displayScore === null) return null;

  return (
    <button
      aria-label={label}
      className={cn(
        'inline-flex max-w-full min-h-11 items-center gap-2.5 border py-1 pr-3.5 pl-1 text-left outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 motion-reduce:transition-none',
        tone === 'media'
          ? 'rounded-[var(--radius-lg)] border-score-media-foreground/20 bg-score-media-background text-score-media-foreground hover:border-score-media-foreground/40 focus-visible:ring-score-media-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-score-media-background'
          : 'rounded-full border-border-subtle bg-card hover:bg-surface-hover focus-visible:ring-ring/50',
        className,
      )}
      onClick={onOpen}
      type="button"
    >
      <ScoreRing label={label} score={displayScore} size="sm" tone={tone} />
      <span className="flex min-w-0 flex-col leading-tight break-words">
        <span className="text-sm font-semibold">{t(`verdict.${scoreBand(displayScore)}`)}</span>
        {issues.length ? (
          <span
            className={cn(
              'text-xs',
              tone === 'media' ? 'text-score-media-muted' : 'text-muted-foreground',
            )}
          >
            {t('worthALook', { count: issues.length })}
          </span>
        ) : null}
      </span>
    </button>
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
  tripPlacesHref,
  defaultDetailsOpen = false,
}: Props) {
  const t = useTranslations('planScore');
  const [detailsOpen, setDetailsOpen] = useState(defaultDetailsOpen);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!assessment) return;
    const deadline = assessmentDeadline(assessment);
    const refresh = () => setClock(Date.now());
    const timeout =
      Number.isFinite(deadline) && deadline > serverNow()
        ? window.setTimeout(refresh, deadline - serverNow() + 1)
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
  const {
    displayScore,
    highlights,
    issues: allIssues,
    reasonStatus,
    unavailable,
  } = scoreDisplay({
    assessment,
    explanations,
    now: Math.max(clock, Date.now()),
    score,
    status,
  });
  const day = assessment?.days.find((entry) => entry.dayId === dayId);
  const scopedAssessment = scope === 'day' ? day : assessment;
  const assessmentStatus = scopedAssessment?.assessmentStatus;
  const specificGap =
    displayScore === null && !unavailable
      ? allIssues.find((reason) =>
          ['LINK_PLACE', 'ADD_TIMING', 'EDIT_TRANSFER'].includes(reason.action ?? ''),
        )
      : undefined;
  const issues = allIssues.filter((reason) => reason !== specificGap);
  const outcomes = scope === 'day' ? factors : assessment?.components;
  // A breakdown explains a number; a withheld day or trip has none to break down.
  const rows =
    !unavailable && outcomes && displayScore !== null
      ? breakdownRows(
          outcomes,
          scope === 'day' ? DAILY_CATEGORIES : TRIP_COMPONENTS,
          explanations.uncertainty,
        )
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
        <Icons.PlanScore aria-hidden="true" className="size-4 text-muted-foreground" />
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
                  ? t(`availability.${reasonStatus}`)
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
              {rows.length ? (
                <div className="space-y-2">
                  <ScoreMeterRows rows={rows} tripPlacesHref={tripPlacesHref} />
                  {rows.some((row) => 'estimated' in row && row.estimated) ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {t('estimatedNote')}
                    </p>
                  ) : null}
                </div>
              ) : null}
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
