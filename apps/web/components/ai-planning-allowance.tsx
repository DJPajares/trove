'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Fragment } from 'react';

import type { AiPlanningAvailability } from '@/lib/ai-planning/api';
import { cn } from '@/lib/utils';

/**
 * One calm line beside the action that spends a credit. `spending` says what the
 * next tap costs ("Uses 1 of 6") instead of the balance, so the cost is read
 * before the tap rather than discovered after it.
 *
 * Display only. Every generation is authorized against server state again.
 */
export function AiPlanningAllowance({
  availability,
  className,
  spending = false,
}: Readonly<{ availability?: AiPlanningAvailability; className?: string; spending?: boolean }>) {
  const t = useTranslations('trips.aiPlanning');
  const format = useFormatter();
  if (!availability || availability.remainingDispatches === null) return null;
  const count = availability.availableCredits ?? availability.remainingDispatches;
  const parts = [
    spending && count > 0 ? t('credits.use', { count }) : t('credits.left', { count }),
    availability.maxItineraryDays
      ? t('credits.dayLimit', { days: availability.maxItineraryDays })
      : null,
    availability.nextRenewalAt
      ? t('credits.renews', {
          date: format.dateTime(new Date(availability.nextRenewalAt), {
            day: 'numeric',
            month: 'short',
          }),
        })
      : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <p
      aria-live="polite"
      className={cn('text-[length:var(--text-metadata)] text-muted-foreground', className)}
    >
      {parts.map((part, index) => (
        <Fragment key={part}>
          {index ? <span aria-hidden="true"> · </span> : null}
          <span>{part}</span>
        </Fragment>
      ))}
    </p>
  );
}
