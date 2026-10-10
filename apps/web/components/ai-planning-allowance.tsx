'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { AiPlanningAvailability } from '@/lib/ai-planning/api';

/** Display only. Every generation is authorized against server state again. */
export function AiPlanningAllowance({
  availability,
}: Readonly<{ availability?: AiPlanningAvailability }>) {
  const t = useTranslations('trips.aiPlanning');
  const format = useFormatter();
  if (!availability || availability.remainingDispatches === null) return null;
  return (
    <div className="space-y-1 text-sm text-muted-foreground" role="status">
      <p>
        {availability.tier
          ? t('planCredits', {
              tier: t(`tiers.${availability.tier}`),
              count: availability.availableCredits ?? availability.remainingDispatches,
            })
          : t('availability', { count: availability.remainingDispatches })}
      </p>
      {availability.maxItineraryDays ? (
        <p>{t('dayLimit', { days: availability.maxItineraryDays })}</p>
      ) : null}
      {availability.nextRenewalAt ? (
        <p>
          {t('creditRenewal', {
            date: format.dateTime(new Date(availability.nextRenewalAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          })}
        </p>
      ) : null}
    </div>
  );
}
