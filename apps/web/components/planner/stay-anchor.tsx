'use client';

import { useTranslations } from 'next-intl';

import { STAY_MARK_CLASS, StayMarkContent } from '@/components/stay-mark';
import { cn } from '@/lib/utils';

import { SpineRow } from './spine';

/**
 * Where the day starts or ends: the Stay, set apart from the stops it frames.
 *
 * It is counted in the day - its bed carries the same number in its corner
 * that the map's does - but it is not something to plan, so it reads quieter
 * than a stop: no card of its own and a bed rather than a category. Which end
 * of the day it is goes without saying - it is the first row or the last. Where the day starts and ends is changed from
 * the day's header, not from here.
 */
export function StayAnchor({
  located,
  name,
  number,
  onSelectOnMap,
  onViewDetails,
  role,
  selected,
}: Readonly<{
  located: boolean;
  name: string;
  number: number;
  onSelectOnMap: () => void;
  onViewDetails: () => void;
  role: 'arrival' | 'departure';
  selected: boolean;
}>) {
  const t = useTranslations('itinerary.planner.stay');
  const markerClassName = cn(
    STAY_MARK_CLASS,
    'z-10 size-8',
    located
      ? 'border-primary bg-card text-primary'
      : 'border-border bg-muted text-muted-foreground',
  );

  return (
    <SpineRow
      above={role === 'arrival' ? 'none' : 'dashed'}
      below={role === 'arrival' ? 'dashed' : 'none'}
      marker={
        located ? (
          <button
            aria-label={t('showOnMap', { name })}
            className={cn(
              markerClassName,
              'outline-none transition-[box-shadow] duration-[var(--motion-fast)] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none',
              selected && 'ring-4 ring-ring/35',
            )}
            onClick={onSelectOnMap}
            type="button"
          >
            <StayMarkContent number={number} />
          </button>
        ) : (
          <span aria-hidden="true" className={markerClassName}>
            <StayMarkContent number={number} />
          </span>
        )
      }
    >
      <div
        className={cn(
          'relative my-1.5 flex min-h-11 items-center gap-3 rounded-[var(--radius-lg)] border border-dashed px-3 py-2',
          selected ? 'border-primary/45 bg-secondary/45' : 'border-border bg-surface-tint/40',
        )}
      >
        <div className="min-w-0 flex-1">
          {/* The day's first or last row, beside a bed: it needs no label to
              say which end of the day it is. A screen reader still hears it. */}
          <p className="sr-only">{role === 'arrival' ? t('startOfDay') : t('endOfDay')}</p>
          <button
            aria-label={t('viewDetails', { name })}
            className="max-w-full truncate rounded-[var(--radius-sm)] text-left text-sm font-medium text-foreground outline-none after:absolute after:inset-0 after:rounded-[var(--radius-lg)] hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
            onClick={onViewDetails}
            type="button"
          >
            {name}
          </button>
        </div>
      </div>
    </SpineRow>
  );
}
