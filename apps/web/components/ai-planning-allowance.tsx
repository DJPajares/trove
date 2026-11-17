'use client';

import { ChevronDown } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { AiPlanningAvailability } from '@/lib/ai-planning/api';
import { cn } from '@/lib/utils';

/** Two or fewer is when the count is worth noticing before a tap spends one. */
const LOW_ALLOWANCE = 2;

function availableCount(availability: AiPlanningAvailability | undefined) {
  if (!availability || availability.remainingDispatches === null) return null;
  return availability.availableCredits ?? availability.remainingDispatches;
}

/**
 * What the traveller has left, one fact per line: how many AI plans, a bar
 * against the allowance, and whether - and when - more arrive. The rules
 * behind a credit sit one tap away rather than in the line itself. The plan's
 * name is left out: the renewal line already says what the plan means for them.
 *
 * Display only. Every generation is authorized against server state again.
 */
export function AiPlanningAllowance({
  availability,
  className,
}: Readonly<{ availability?: AiPlanningAvailability; className?: string }>) {
  const t = useTranslations('trips.aiPlanning.credits');
  const format = useFormatter();
  const count = availableCount(availability);
  if (!availability || count === null) return null;
  const total = availability.allowance ?? null;
  const low = count > 0 && count <= LOW_ALLOWANCE;
  const renewal = availability.nextRenewalAt
    ? t('renews', {
        count: total ?? count,
        date: format.dateTime(new Date(availability.nextRenewalAt), {
          day: 'numeric',
          month: 'short',
        }),
      })
    : t('noRenewal');

  return (
    <Collapsible className={cn('space-y-2.5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div aria-live="polite" className="min-w-0 space-y-1.5">
          <p className={cn('text-sm font-semibold tabular-nums', low && 'text-accent-strong')}>
            {t.rich('left', {
              count,
              // The number itself, set larger than the words around it.
              n: (chunks) => <span className="text-lg leading-none font-bold">{chunks}</span>,
            })}
          </p>
          {total ? (
            <div
              aria-label={t('meter', { count, total })}
              className="h-1.5 w-40 max-w-full overflow-hidden rounded-full bg-border-subtle"
              role="img"
            >
              <span
                className={cn('block h-full rounded-full', low ? 'bg-accent-strong' : 'bg-brand')}
                style={{ width: `${Math.min(100, Math.round((count / total) * 100))}%` }}
              />
            </div>
          ) : null}
          <p className="text-[length:var(--text-metadata)] text-muted-foreground">{renewal}</p>
        </div>
        <CollapsibleTrigger className="group min-h-9 shrink-0 gap-1 text-[length:var(--text-metadata)] font-semibold text-brand hover:text-brand-strong">
          {t('howLabel')}
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 transition-transform duration-[var(--motion-standard)] group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
      </div>
      <CollapsiblePanel>
        <ul className="list-disc space-y-1 rounded-[var(--radius-lg)] bg-surface-tint py-3 pr-3 pl-7 text-[length:var(--text-metadata)] leading-snug text-muted-foreground">
          <li>{t('how.used')}</li>
          <li>{t('how.refund')}</li>
          <li>{t('how.again')}</li>
          {availability.maxItineraryDays ? (
            <li>{t('how.days', { days: availability.maxItineraryDays })}</li>
          ) : null}
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/** What the next tap costs, read beside the action rather than discovered after it. */
export function AiPlanningSpendNote({
  availability,
  className,
}: Readonly<{ availability?: AiPlanningAvailability; className?: string }>) {
  const t = useTranslations('trips.aiPlanning.credits');
  const count = availableCount(availability);
  if (!count) return null;
  return (
    <p className={cn('text-[length:var(--text-metadata)] text-muted-foreground', className)}>
      {t('use', { count })}
    </p>
  );
}
