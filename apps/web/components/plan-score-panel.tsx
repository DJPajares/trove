'use client';

import { ChevronDown, CircleAlert, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { PlanScoreExplanation, PlanScoreExplanationGroups } from '@/lib/plan-score/api';
import type { PlanScoreLoadStatus } from '@/lib/plan-score/use-trip-plan-score';
import { cn } from '@/lib/utils';

type PlanScoreScope = 'day' | 'trip';

type PlanScorePanelProps = Readonly<{
  className?: string;
  completeness?: number | null;
  confidence?: number | null;
  explanations: PlanScoreExplanationGroups;
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
function verdictBand(score: number) {
  if (score >= 85) return 'good';
  if (score >= 70) return 'workable';
  if (score >= 55) return 'tight';
  return 'needsWork';
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
  onSelectReference,
  tone,
}: Readonly<{
  explanations: PlanScoreExplanation[];
  heading: string;
  onSelectReference?: (reference: string) => void;
  tone: 'improve' | 'uncertain' | 'works';
}>) {
  const t = useTranslations('planScore');

  if (explanations.length === 0) return null;

  return (
    <section className="space-y-1.5">
      <h4 className="text-xs font-medium text-muted-foreground">{heading}</h4>
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
  explanations,
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

  const shell = cn('space-y-3 rounded-lg border border-border bg-card p-4', className);

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
    <h3 className="flex items-center gap-2 text-sm font-medium">
      <Sparkles aria-hidden="true" className="size-4 text-muted-foreground" />
      {title}
    </h3>
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

  return (
    <div className={shell}>
      {heading}

      <p className="text-sm text-foreground">{t(`verdict.${scope}.${verdictBand(score)}`)}</p>

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

          <ExplanationList
            explanations={remainingImprovements}
            heading={t('worthImproving')}
            onSelectReference={onSelectReference}
            tone="improve"
          />
          <ExplanationList
            explanations={explanations.whatWorks}
            heading={t('whatWorks')}
            tone="works"
          />
          <ExplanationList
            explanations={explanations.uncertainty}
            heading={t('uncertainty')}
            tone="uncertain"
          />
        </div>
      ) : null}
    </div>
  );
}
