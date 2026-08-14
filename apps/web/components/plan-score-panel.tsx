'use client';

import { CircleAlert, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import type { PlanScoreExplanation, PlanScoreExplanationGroups } from '@/lib/plan-score/api';
import type { PlanScoreLoadStatus } from '@/lib/plan-score/use-trip-plan-score';
import { cn } from '@/lib/utils';

type PlanScorePanelProps = Readonly<{
  className?: string;
  completeness?: number | null;
  confidence?: number | null;
  explanations: PlanScoreExplanationGroups;
  onRetry?: () => void;
  /** Focuses the itinerary item or Trip Place a suggestion points at. */
  onSelectReference?: (reference: string) => void;
  score: number | null;
  status: PlanScoreLoadStatus;
  title: string;
}>;

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
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {heading}
      </h4>
      <ul className="space-y-1.5">
        {explanations.map((explanation, index) => {
          const reference = explanation.references[0];
          const actionable = explanation.action && reference && onSelectReference;

          return (
            <li
              className={cn(
                'text-sm leading-snug',
                tone === 'uncertain' ? 'text-muted-foreground' : 'text-foreground',
              )}
              key={`${explanation.messageKey}-${index}`}
            >
              <span>{t(explanation.messageKey, explanation.values)}</span>
              {actionable ? (
                <Button
                  className="ml-1.5 h-auto px-0 align-baseline text-sm"
                  onClick={() => onSelectReference(reference)}
                  size="sm"
                  variant="link"
                >
                  {t(`actions.${explanation.action}`)}
                </Button>
              ) : null}
            </li>
          );
        })}
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

export function PlanScorePanel({
  className,
  completeness,
  confidence,
  explanations,
  onRetry,
  onSelectReference,
  score,
  status,
  title,
}: PlanScorePanelProps) {
  const t = useTranslations('planScore');

  if (status === 'error') {
    return (
      <div className={cn('rounded-lg border border-border bg-card p-4', className)} role="status">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CircleAlert aria-hidden="true" className="size-4" />
          {t('unavailable')}
        </p>
        {onRetry ? (
          <Button className="mt-2" onClick={onRetry} size="sm" variant="outline">
            {t('retry')}
          </Button>
        ) : null}
      </div>
    );
  }

  const hasExplanations =
    explanations.whatWorks.length > 0 ||
    explanations.worthImproving.length > 0 ||
    explanations.uncertainty.length > 0;

  return (
    <div className={cn('space-y-4 rounded-lg border border-border bg-card p-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Sparkles aria-hidden="true" className="size-4 text-muted-foreground" />
            {title}
          </h3>
          {score === null ? (
            <p className="text-sm text-muted-foreground">
              {status === 'loading' ? t('loading') : t('notEnoughInformation')}
            </p>
          ) : (
            <p className="flex items-baseline gap-1">
              <span className="text-2xl font-semibold tabular-nums">{score}</span>
              <span className="text-xs text-muted-foreground">{t('outOf')}</span>
            </p>
          )}
        </div>
        {score === null ? null : (
          <div className="space-y-1">
            {typeof confidence === 'number' ? (
              <SupportingMeter label={t('confidence')} value={confidence} />
            ) : null}
            {typeof completeness === 'number' ? (
              <SupportingMeter label={t('completeness')} value={completeness} />
            ) : null}
          </div>
        )}
      </div>

      {hasExplanations ? (
        <div className="space-y-3 border-t border-border pt-3">
          <ExplanationList
            explanations={explanations.worthImproving}
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
