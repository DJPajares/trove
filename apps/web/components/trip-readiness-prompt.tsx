'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import type { Trip } from '@/lib/trips/api';
import { daysUntilTripStart, resolveReadinessPrompt } from '@/lib/trips/lifecycle';
import { useTripReadiness } from '@/lib/trips/use-trip-readiness';
import { cn } from '@/lib/utils';

/**
 * Asks whether a plan is done, and lets the traveller answer in place.
 *
 * The question and the action live together deliberately: a suggestion the
 * traveller has to go elsewhere to act on is just a remark. Nothing here is
 * dismissible, because nothing here persists - the prompt is a description of
 * the trip's current state, and it leaves the moment that state changes.
 */
export function TripReadinessPrompt({
  className,
  inverse = false,
  trip,
}: Readonly<{ className?: string; inverse?: boolean; trip: Trip }>) {
  const t = useTranslations('trips.readinessPrompt');
  const { failedTripId, pendingTripId, setReadiness } = useTripReadiness();
  const kind = resolveReadinessPrompt(trip);

  if (!kind) return null;

  const failed = failedTripId === trip.id;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-3',
        inverse ? 'border-white/20' : 'border-border-subtle',
        className,
      )}
    >
      <p
        className={cn(
          'min-w-0 text-sm leading-6',
          inverse ? 'text-white/78' : 'text-muted-foreground',
        )}
      >
        {failed
          ? t('error')
          : kind === 'suggest'
            ? t('suggest')
            : t('nudge', { count: daysUntilTripStart(trip) })}
      </p>
      <Button
        className={cn('shrink-0', inverse && 'text-white hover:bg-white/15 hover:text-white')}
        disabled={pendingTripId === trip.id}
        onClick={() => void setReadiness(trip, 'ready')}
        size="sm"
        variant={inverse ? 'ghost' : 'outline'}
      >
        {t('action')}
      </Button>
    </div>
  );
}
