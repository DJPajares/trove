'use client';
import { useTripReadOnly } from '@/components/trip-provider';

import { ChevronRight, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

/** Where the trip, or the day in view, sleeps - as the bar says it. */
export type PlannerStaySummary =
  /** Nothing is set anywhere on the trip yet. */
  | { kind: 'unset' }
  /** The trip has stays, but this day has none. */
  | { kind: 'none' }
  | { kind: 'one'; name: string }
  | { from: string; kind: 'transition'; to: string }
  /** The whole trip, across more than one place. */
  | { count: number; kind: 'many' };

/**
 * The planner's two supporting tools, in the same place under the day strip
 * whether the whole trip or one day is open: Places to bring into the plan,
 * and where the trip sleeps.
 *
 * Stay says what it is set to, so it reads as part of the plan rather than a
 * setting to go looking for - and until anything is set, it asks for one, in
 * the one place a traveller already looks before planning a day. One bar,
 * labelled, instead of a button in every view.
 */
export function PlannerContextBar({
  onOpenPlaces,
  onOpenStay,
  stay,
}: Readonly<{
  onOpenPlaces: () => void;
  onOpenStay: () => void;
  stay: PlannerStaySummary;
}>) {
  const t = useTranslations('itinerary.planner.context');
  const readOnly = useTripReadOnly();
  const placesT = useTranslations('tripPlaces');
  const unset = stay.kind === 'unset';
  const value =
    stay.kind === 'unset'
      ? t('addStay')
      : stay.kind === 'none'
        ? t('noStay')
        : stay.kind === 'one'
          ? stay.name
          : stay.kind === 'many'
            ? t('stayCount', { count: stay.count })
            : t('stayTransition', { from: stay.from, to: stay.to });

  return (
    <div
      aria-label={t('label')}
      className="-mt-2 flex min-w-0 items-center gap-2 md:-mt-3"
      data-slot="planner-context-bar"
      role="group"
    >
      <Button
        aria-haspopup="dialog"
        className="shrink-0"
        data-trip-places-trigger
        onClick={onOpenPlaces}
        size="sm"
        type="button"
        variant="outline"
      >
        <Icons.Places aria-hidden="true" data-icon="inline-start" />
        {placesT('openPlaces')}
      </Button>
      <Button
        aria-haspopup="dialog"
        aria-label={unset ? t('addStay') : t('stayLabel', { value })}
        className={cn(
          'min-w-0 flex-1 justify-start overflow-hidden sm:max-w-sm sm:flex-none',
          unset && 'border-dashed border-border-strong text-accent-strong',
        )}
        disabled={readOnly}
        onClick={onOpenStay}
        size="sm"
        type="button"
        variant="outline"
      >
        {unset ? (
          <Plus aria-hidden="true" data-icon="inline-start" />
        ) : (
          <Icons.DailyBase aria-hidden="true" data-icon="inline-start" />
        )}
        {/* Named, not just iconned: "Stay" is what makes the name mean something. */}
        {unset ? null : <span className="shrink-0 text-muted-foreground">{t('stay')}</span>}
        <span
          className={cn(
            'min-w-0 truncate',
            unset
              ? 'font-medium'
              : stay.kind === 'none'
                ? 'text-muted-foreground'
                : 'text-foreground',
          )}
        >
          {value}
        </span>
        {unset ? null : <ChevronRight aria-hidden="true" className="-mr-1 text-muted-foreground" />}
      </Button>
    </div>
  );
}
