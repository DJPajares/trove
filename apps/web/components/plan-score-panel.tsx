'use client';

import { ChevronDown, CircleAlert, Sparkles } from 'lucide-react';
import type { VariantProps } from 'class-variance-authority';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { Badge, type badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  PlanScoreExplanation,
  PlanScoreExplanationGroups,
  PlanScoreFactorId,
  PlanScoreFactorOutcome,
} from '@/lib/plan-score/api';
import type { PlanScoreLoadStatus } from '@/lib/plan-score/use-trip-plan-score';
import { cn } from '@/lib/utils';

type PlanScoreScope = 'day' | 'trip';

type PlanScorePanelProps = Readonly<{
  className?: string;
  completeness?: number | null;
  confidence?: number | null;
  /** Administratively disabled (not just lacking evidence): render nothing at all. */
  disabled?: boolean;
  explanations: PlanScoreExplanationGroups;
  /** Per-factor breakdown for the day-scope chip row; absent at trip scope. */
  factors?: Record<PlanScoreFactorId, PlanScoreFactorOutcome>;
  /**
   * How deep the panel sits in the host route's outline. The explanation
   * groups nest one level below it, so both move together and neither call
   * site has to know that.
   */
  headingLevel?: 2 | 3;
  onRetry?: () => void;
  /** Focuses the itinerary item or Trip Place a suggestion points at. */
  onSelectReference?: (reference: string) => void;
  score: number | null;
  /** Chooses day-worded or trip-worded copy; the score itself is scope-agnostic. */
  scope: PlanScoreScope;
  status: PlanScoreLoadStatus;
  title: string;
}>;

/**
 * Display-only bands over the canonical 0–100 score. They never feed back into
 * scoring, so they stay presentation under PRD section 29.3.
 */
function verdictBand(score: number): 'good' | 'needsWork' | 'tight' | 'workable' {
  if (score >= 85) return 'good';
  if (score >= 70) return 'workable';
  if (score >= 55) return 'tight';
  return 'needsWork';
}

type VerdictBand = ReturnType<typeof verdictBand>;

const RING_RADIUS = 15.5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Status tokens only — never brand/primary, so the badge reads as a signal, not a call to action. */
const BAND_RING_CLASS: Record<VerdictBand, string> = {
  good: 'text-status-success',
  needsWork: 'text-status-danger',
  tight: 'text-status-warning',
  workable: 'text-status-info',
};

function ScoreBadge({ band, score }: Readonly<{ band: VerdictBand; score: number }>) {
  const t = useTranslations('planScore');
  const clamped = Math.round(Math.min(100, Math.max(0, score)));
  const offset = RING_CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div
      aria-label={t('scoreBadgeLabel', { score: clamped })}
      className="relative flex size-9 shrink-0 items-center justify-center"
      role="img"
    >
      <svg aria-hidden="true" className="size-9 -rotate-90" viewBox="0 0 36 36">
        <circle
          className="text-border"
          cx="18"
          cy="18"
          fill="none"
          r={RING_RADIUS}
          stroke="currentColor"
          strokeWidth="3"
        />
        <circle
          className={cn(
            'transition-[stroke-dashoffset] duration-[var(--motion-slow)] ease-[var(--ease-standard)]',
            BAND_RING_CLASS[band],
          )}
          cx="18"
          cy="18"
          fill="none"
          r={RING_RADIUS}
          stroke="currentColor"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth="3"
        />
      </svg>
      <span
        aria-hidden="true"
        className="absolute text-[11px] font-semibold tabular-nums text-foreground"
      >
        {clamped}
      </span>
    </div>
  );
}

type FactorChipTone = 'unknown' | 'working' | 'worthImproving';

/** Mirrors STRONG_FACTOR_SCORE in apps/api/src/services/plan-score-explanations.ts — keep in sync if that changes. */
const CHIP_WORKING_SCORE = 85;

const FACTOR_CHIP_ORDER: PlanScoreFactorId[] = [
  'FEASIBILITY',
  'TRAVEL_EFFORT',
  'PACE_BUFFER',
  'ROUTE_EFFICIENCY',
  'PLACE_QUALITY',
];

const FACTOR_BADGE_VARIANT: Record<FactorChipTone, VariantProps<typeof badgeVariants>['variant']> =
  {
    unknown: 'muted',
    working: 'success',
    worthImproving: 'warning',
  };

function factorChipTone(outcome: PlanScoreFactorOutcome): FactorChipTone | null {
  if (outcome.state === 'NOT_APPLICABLE') return null;
  if (outcome.state === 'UNKNOWN') return 'unknown';
  return outcome.score >= CHIP_WORKING_SCORE ? 'working' : 'worthImproving';
}

function FactorStatusRow({
  factors,
}: Readonly<{ factors: Record<PlanScoreFactorId, PlanScoreFactorOutcome> }>) {
  const t = useTranslations('planScore');

  return (
    <ul aria-label={t('factorStatus.groupLabel')} className="flex flex-wrap gap-1.5">
      {FACTOR_CHIP_ORDER.flatMap((id) => {
        const tone = factorChipTone(factors[id]);
        if (tone === null) return [];

        return [
          <Badge key={id} render={<li />} variant={FACTOR_BADGE_VARIANT[tone]}>
            {t(`factorLabels.${id}`)} · {t(`factorStatus.${tone}`)}
          </Badge>,
        ];
      })}
    </ul>
  );
}

function SuggestedAction({
  explanation,
  onSelectReference,
}: Readonly<{
  explanation: PlanScoreExplanation;
  onSelectReference?: (reference: string) => void;
}>) {
  const t = useTranslations('planScore');
  const reference = explanation.references[0];

  if (!explanation.action || !reference || !onSelectReference) return null;

  return (
    <Button
      className="ml-1.5 h-auto px-0 align-baseline text-sm"
      onClick={() => onSelectReference(reference)}
      size="sm"
      variant="link"
    >
      {t(`actions.${explanation.action}`)}
    </Button>
  );
}

function ExplanationList({
  explanations,
  heading,
  HeadingTag,
  onSelectReference,
  tone,
}: Readonly<{
  explanations: PlanScoreExplanation[];
  heading: string;
  /** One level below the panel's own heading, whatever the host route set it to. */
  HeadingTag: 'h3' | 'h4';
  onSelectReference?: (reference: string) => void;
  tone: 'improve' | 'uncertain' | 'works';
}>) {
  const t = useTranslations('planScore');

  if (explanations.length === 0) return null;

  return (
    <section className="space-y-1.5">
      <HeadingTag className="text-xs font-medium text-muted-foreground">{heading}</HeadingTag>
      <ul className="space-y-1.5">
        {explanations.map((explanation, index) => (
          <li
            className={cn(
              'text-sm leading-snug',
              tone === 'uncertain' ? 'text-muted-foreground' : 'text-foreground',
            )}
            key={`${explanation.messageKey}-${index}`}
          >
            <span>{t(explanation.messageKey, explanation.values)}</span>
            <SuggestedAction explanation={explanation} onSelectReference={onSelectReference} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SupportingMeter({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        aria-hidden="true"
        className="h-1 w-12 overflow-hidden rounded-full bg-muted"
        data-slot="plan-score-meter"
      >
        <span
          className="block h-full rounded-full bg-muted-foreground/50"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">{value}%</span>
    </div>
  );
}

/**
 * Answers the two questions a traveller has — does this look good, and what
 * should I change — and keeps the number, the meters, and the rest of the
 * explanations behind explicit disclosure. See PRD section 29.4.
 */
export function PlanScorePanel({
  className,
  completeness,
  confidence,
  disabled,
  explanations,
  factors,
  headingLevel = 3,
  onRetry,
  onSelectReference,
  score,
  scope,
  status,
  title,
}: PlanScorePanelProps) {
  const t = useTranslations('planScore');
  const [showDetails, setShowDetails] = useState(false);
  const detailsId = useId();
  const PanelHeading = headingLevel === 2 ? 'h2' : 'h3';
  const GroupHeading = headingLevel === 2 ? 'h3' : 'h4';

  const shell = cn('space-y-3 rounded-lg border border-border bg-card p-4', className);

  if (disabled) return null;

  if (status === 'error') {
    return (
      <div className={shell} role="status">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CircleAlert aria-hidden="true" className="size-4" />
          {t('unavailable')}
        </p>
        {onRetry ? (
          <Button onClick={onRetry} size="sm" variant="outline">
            {t('retry')}
          </Button>
        ) : null}
      </div>
    );
  }

  const heading = (
    <PanelHeading className="flex items-center gap-2 text-sm font-medium">
      <Sparkles aria-hidden="true" className="size-4 text-muted-foreground" />
      {title}
    </PanelHeading>
  );

  // Without a number there is nothing useful to say; listing what could not be
  // determined reads as a report card, so the panel stops here.
  if (score === null) {
    return (
      <div className={shell}>
        {heading}
        <p className="text-sm text-muted-foreground">
          {status === 'loading' ? t('loading') : t(`notEnoughInformation.${scope}`)}
        </p>
      </div>
    );
  }

  // The API already orders `worthImproving` by consequence (PRD section 29.4),
  // so the first entry is the one improvement worth surfacing.
  const [topImprovement, ...remainingImprovements] = explanations.worthImproving;
  const band = verdictBand(score);

  return (
    <div className={shell}>
      {heading}

      <div className="flex items-center gap-2.5">
        <ScoreBadge band={band} score={score} />
        <p className="text-base font-semibold text-foreground">{t(`verdict.${scope}.${band}`)}</p>
      </div>

      {topImprovement ? (
        <p className="text-sm leading-snug text-muted-foreground">
          <span className="text-foreground">{t('improvementLead')} </span>
          <span>{t(topImprovement.messageKey, topImprovement.values)}</span>
          <SuggestedAction explanation={topImprovement} onSelectReference={onSelectReference} />
        </p>
      ) : null}

      <button
        aria-controls={detailsId}
        aria-expanded={showDetails}
        className="flex items-center gap-2 rounded-[var(--radius-sm)] py-1 text-left text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
        onClick={() => setShowDetails(!showDetails)}
        type="button"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn('size-3 transition-transform duration-[var(--motion-standard)]', {
            'rotate-180': showDetails,
          })}
        />
        {showDetails ? t('hideDetails') : t('showDetails')}
      </button>

      {showDetails ? (
        <div className="space-y-3 border-t border-border pt-3" id={detailsId}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-baseline gap-1">
              <span className="text-2xl font-semibold tabular-nums">{score}</span>
              <span className="text-xs text-muted-foreground">{t('outOf')}</span>
            </p>
            <div className="space-y-1">
              {typeof confidence === 'number' ? (
                <SupportingMeter label={t('confidence')} value={confidence} />
              ) : null}
              {typeof completeness === 'number' ? (
                <SupportingMeter label={t('completeness')} value={completeness} />
              ) : null}
            </div>
          </div>

          {scope === 'day' && factors ? <FactorStatusRow factors={factors} /> : null}

          <ExplanationList
            explanations={remainingImprovements}
            heading={t('worthImproving')}
            HeadingTag={GroupHeading}
            onSelectReference={onSelectReference}
            tone="improve"
          />
          <ExplanationList
            explanations={explanations.whatWorks}
            heading={t('whatWorks')}
            HeadingTag={GroupHeading}
            tone="works"
          />
          <ExplanationList
            explanations={explanations.uncertainty}
            heading={t('uncertainty')}
            HeadingTag={GroupHeading}
            tone="uncertain"
          />
        </div>
      ) : null}
    </div>
  );
}
