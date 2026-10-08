'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { TripDayWeather } from '@/components/trip-day-weather';
import type { ItineraryDay, ItineraryItem } from '@/lib/itinerary/api';
import { formatSuggestedClock } from '@/lib/itinerary/day-time-suggestions';
import type { PlannerDay } from '@/lib/itinerary/planner-days';
import { cn } from '@/lib/utils';
import type { TripWeatherDay } from '@/lib/weather/api';

import { paddedDayNumber } from '../planner-ribbon';

/** How many of a day's stops its card names before it says "and more". */
const STOPS_SHOWN = 3;

/**
 * One day of the whole trip, at a glance: its number and date, what it is
 * called or where it happens, its weather, the first few stops with their
 * times, how many there are in all, the shape of its route, and a dot when its
 * plan has a problem worth a look. The card opens the day; a stop opens itself.
 */
export function BoardDayCard({
  day,
  itemName,
  onEditItem,
  onOpen,
  plannerDay,
  sketch,
  timeFormat,
  weather,
}: Readonly<{
  day: ItineraryDay;
  itemName: (item: ItineraryItem) => string;
  onEditItem: (item: ItineraryItem) => void;
  onOpen: () => void;
  plannerDay: PlannerDay;
  /** The day's route, drawn from stored coordinates; nothing when it has no shape. */
  sketch: ReactNode | null;
  timeFormat: '12h' | '24h';
  weather: TripWeatherDay | null;
}>) {
  const t = useTranslations('itinerary');
  const boardT = useTranslations('itinerary.planner.board');
  const locale = useLocale();
  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    weekday: 'short',
  }).format(new Date(`${day.date}T00:00:00.000Z`));
  const title = plannerDay.name ?? plannerDay.town ?? date;
  const shown = day.items.slice(0, STOPS_SHOWN);

  return (
    <article
      className={cn(
        'relative flex min-h-44 flex-col gap-3 rounded-[var(--radius-xl)] border p-3.5 transition-colors duration-[var(--motion-standard)] motion-reduce:transition-none',
        day.items.length
          ? 'border-border-subtle bg-card hover:border-border'
          : 'border-dashed border-border bg-transparent',
      )}
      data-slot="board-day-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The date is said once: here when the day has a name or a town to
              be called by, or as the title when it has neither. */}
          {plannerDay.isToday || title !== date ? (
            <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {plannerDay.isToday ? t('planner.ribbon.today') : date}
            </p>
          ) : null}
          <h3 className="mt-1 flex min-w-0 items-baseline gap-2">
            <span
              aria-hidden="true"
              className="text-2xl leading-none font-semibold tracking-[-0.03em] tabular-nums"
            >
              {paddedDayNumber(plannerDay.number)}
            </span>
            <button
              className="min-w-0 truncate rounded-[var(--radius-sm)] text-left text-base font-semibold outline-none after:absolute after:inset-0 after:rounded-[var(--radius-xl)] hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
              onClick={onOpen}
              type="button"
            >
              <span className="sr-only">{t('dayNumber', { number: plannerDay.number })}: </span>
              {title}
            </button>
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <TripDayWeather forecast={weather} />
          {plannerDay.attention ? (
            <span
              className="size-2 rounded-full bg-status-warning"
              title={t('planner.ribbon.attention')}
            >
              <span className="sr-only">{t('planner.ribbon.attention')}</span>
            </span>
          ) : null}
        </div>
      </div>

      {shown.length ? (
        <ul
          aria-label={t('overview.itemsForDay', { number: plannerDay.number })}
          className="space-y-1"
        >
          {shown.map((item) => (
            <li key={item.id}>
              <button
                aria-label={t('overview.editItem', { name: itemName(item) })}
                className="relative z-10 grid w-full grid-cols-[3.75rem_minmax(0,1fr)] items-baseline gap-2 rounded-[var(--radius-sm)] text-left text-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                onClick={() => onEditItem(item)}
                type="button"
              >
                <span className="text-xs text-muted-foreground tabular-nums">
                  {item.localStartTime
                    ? formatSuggestedClock(item.localStartTime, locale, timeFormat === '12h')
                    : item.dayPart
                      ? t(`schedule.${item.dayPart}`)
                      : '—'}
                </span>
                <span className="truncate">{itemName(item)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('overview.emptyDay')}</p>
      )}

      <div className="mt-auto flex items-end justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {day.items.length > STOPS_SHOWN
            ? boardT('more', { count: day.items.length - STOPS_SHOWN })
            : boardT('stops', { count: day.items.length })}
        </p>
        {sketch ? <div className="w-20 shrink-0 opacity-90">{sketch}</div> : null}
      </div>
    </article>
  );
}
