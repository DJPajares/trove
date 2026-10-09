'use client';

import { useLocale, useTranslations } from 'next-intl';

import { TripStatusBadge } from '@/components/trip-status-badge';
import type { Trip } from '@/lib/trips/api';
import { formatTripDateRange } from '@/lib/trips/format';
import { calendarDayDistance } from '@/lib/trips/lifecycle';
import { cn } from '@/lib/utils';

/** The same date, duration and status row beneath every trip cover's title. */
export function TripHeaderDetails({
  trip,
  className,
  badgeClassName,
}: Readonly<{
  trip: Pick<Trip, 'startDate' | 'endDate' | 'lifecycle' | 'planningReadiness'>;
  className?: string;
  /** The desktop hub already carries its badges above the photograph's title. */
  badgeClassName?: string;
}>) {
  const locale = useLocale();
  const t = useTranslations('trips.hub');

  return (
    <div
      className={cn(
        'mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground',
        className,
      )}
      data-slot="trip-header-details"
    >
      <span>{formatTripDateRange(trip.startDate, trip.endDate, locale)}</span>
      <span aria-hidden="true">·</span>
      <span>{t('duration', { count: calendarDayDistance(trip.startDate, trip.endDate) + 1 })}</span>
      <TripStatusBadge
        className={badgeClassName}
        lifecycle={trip.lifecycle}
        readiness={trip.planningReadiness}
      />
    </div>
  );
}
