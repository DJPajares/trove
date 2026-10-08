'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import type { PlannerDay } from '@/lib/itinerary/planner-days';
import { cn } from '@/lib/utils';

import { paddedDayNumber } from './planner-ribbon';

/** The organize call's "after everything": the server clamps it to the end of the day. */
const END_OF_DAY = 999;

/**
 * Where a stop goes next: another day of the trip, read the way the ribbon
 * reads it - number, date, town and how full it already is - or Unscheduled.
 * Choosing a day moves it there at once, to the end of that day or, asked,
 * to its start. It is the same move as dragging, without the dragging
 * (PRD 17.4), and it is how an unscheduled stop is given a day.
 */
export function MoveToDaySheet({
  allowUnscheduled,
  currentDayId,
  days,
  itemName,
  onMove,
  onOpenChange,
  open,
}: Readonly<{
  /** Offered for a stop already on a day; a stop in Unscheduled is being given one. */
  allowUnscheduled: boolean;
  currentDayId: string | null;
  days: readonly PlannerDay[];
  itemName: string;
  onMove: (dayId: string | null, position: number) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}>) {
  const t = useTranslations('itinerary.planner.move');
  const itineraryT = useTranslations('itinerary');
  const locale = useLocale();
  const [atStart, setAtStart] = useState(false);
  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    weekday: 'short',
  });

  function move(dayId: string | null) {
    onMove(dayId, dayId && atStart ? 0 : END_OF_DAY);
    onOpenChange(false);
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className="w-full md:data-[side=right]:w-[min(28rem,calc(100%-0.5rem))]"
        closeLabel={itineraryT('close')}
      >
        <SheetHeader className="border-b">
          <SheetTitle>
            {allowUnscheduled
              ? t('title', { name: itemName })
              : t('scheduleTitle', { name: itemName })}
          </SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-[calc(var(--safe-bottom)+1.5rem)] sm:px-6">
          <div aria-label={t('placeLabel')} className="flex gap-2" role="group">
            <Button
              aria-pressed={!atStart}
              onClick={() => setAtStart(false)}
              size="sm"
              type="button"
              variant={atStart ? 'outline' : 'secondary'}
            >
              {t('atEnd')}
            </Button>
            <Button
              aria-pressed={atStart}
              onClick={() => setAtStart(true)}
              size="sm"
              type="button"
              variant={atStart ? 'secondary' : 'outline'}
            >
              {t('atStart')}
            </Button>
          </div>
          <ul className="space-y-1.5">
            {days.map((day) => {
              const current = day.id === currentDayId;
              return (
                <li key={day.id}>
                  <button
                    className={cn(
                      'flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-lg)] border px-3 py-2 text-left outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none',
                      current
                        ? 'border-dashed border-border text-muted-foreground'
                        : 'border-border-subtle bg-card hover:bg-surface-hover',
                    )}
                    disabled={current}
                    onClick={() => move(day.id)}
                    type="button"
                  >
                    <span className="w-9 shrink-0 text-xl leading-none font-semibold tabular-nums">
                      {paddedDayNumber(day.number)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {day.name ?? day.town ?? date.format(new Date(`${day.date}T00:00:00.000Z`))}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {date.format(new Date(`${day.date}T00:00:00.000Z`))}
                        {' · '}
                        {current ? t('thisDay') : t('stops', { count: day.stopCount })}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {allowUnscheduled ? (
              <li>
                <button
                  className="flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-border px-3 py-2 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
                  onClick={() => move(null)}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{itineraryT('unscheduled')}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t('unscheduledHint')}
                    </span>
                  </span>
                </button>
              </li>
            ) : null}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
