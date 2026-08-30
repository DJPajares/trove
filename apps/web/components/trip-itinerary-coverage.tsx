'use client';

import { useLocale, useTranslations } from 'next-intl';

import { Progress } from '@/components/ui/progress';
import type { Trip } from '@/lib/trips/api';
import { cn } from '@/lib/utils';

type Coverage = NonNullable<Trip['itineraryCoverage']>;

export function TripItineraryCoverage({
  className,
  coverage,
  inverse = false,
}: Readonly<{ className?: string; coverage: Coverage; inverse?: boolean }>) {
  const t = useTranslations('itineraryCoverage');
  const locale = useLocale();

  return (
    <Progress.Root
      aria-valuetext={t('announcement', coverage)}
      className={cn('w-full min-w-0', className)}
      locale={locale}
      value={coverage.percentage}
    >
      <div
        className={cn(
          'mb-1.5 flex items-baseline justify-between gap-3 text-xs',
          inverse ? 'text-white/85' : 'text-muted-foreground',
        )}
      >
        <Progress.Label className="font-medium">{t('label')}</Progress.Label>
        <Progress.Value className="shrink-0 tabular-nums">
          {() => t('days', coverage)}
        </Progress.Value>
      </div>
      <Progress.Track
        className={cn(
          'h-1.5 overflow-hidden rounded-full',
          inverse ? 'bg-primary-on-media/25' : 'bg-primary/25',
        )}
      >
        <Progress.Indicator
          className={cn('rounded-full', inverse ? 'bg-primary-on-media' : 'bg-primary')}
        />
      </Progress.Track>
    </Progress.Root>
  );
}
