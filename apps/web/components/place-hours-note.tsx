'use client';

import { useLocale, useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import type { PlaceHoursStatus } from '@/lib/itinerary/api';
import { describeHours, type SignalsTranslator } from '@/lib/trip-places/signals';
import { cn } from '@/lib/utils';

/**
 * One quiet line saying whether a place is open on the day it is planned for,
 * from hours Trove already has stored, with the date they were checked. Shows
 * nothing when the hours are not known: no guess is better than a wrong "open".
 * A closed day is the one thing worth raising its voice for.
 */
export function PlaceHoursNote({
  className,
  status,
}: Readonly<{ className?: string; status: PlaceHoursStatus | undefined }>) {
  const t = useTranslations('placeSignals');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const text = describeHours(status, {
    hour12: preferences.timeFormat === '12h',
    locale,
    t: t as unknown as SignalsTranslator,
  });
  if (!text) return null;

  return (
    <span
      className={cn(
        'block text-xs leading-5',
        status?.status === 'closed' ? 'font-medium text-status-warning' : 'text-muted-foreground',
        className,
      )}
    >
      {text}
    </span>
  );
}
