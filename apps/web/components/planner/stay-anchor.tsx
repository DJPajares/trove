'use client';

import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import * as Icons from '@/lib/icons';

import { SpineRow } from './spine';

/**
 * Where the day starts or ends: the Stay, set apart from the stops it frames.
 *
 * It is counted in the day - its square carries the same number the map's
 * square does - but it is not something to plan, so it reads quieter than a
 * stop: no card of its own, a bed rather than a category, and a line saying
 * which end of the day it is. Where the day starts and ends is changed from
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
    'relative z-10 grid size-8 shrink-0 place-items-center rounded-[var(--radius-md)] border-2 text-sm font-semibold tabular-nums',
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
            {number}
          </button>
        ) : (
          <span aria-hidden="true" className={markerClassName}>
            {number}
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
        <Icons.DailyBase aria-hidden="true" className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.6875rem] leading-none font-semibold tracking-[0.1em] text-muted-foreground uppercase">
            {role === 'arrival' ? t('startOfDay') : t('endOfDay')}
          </p>
          <button
            aria-label={t('viewDetails', { name })}
            className="mt-1 max-w-full truncate rounded-[var(--radius-sm)] text-left text-sm font-medium text-foreground outline-none after:absolute after:inset-0 after:rounded-[var(--radius-lg)] hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
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
