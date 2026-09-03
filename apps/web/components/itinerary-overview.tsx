'use client';

import { ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { TripDayWeather } from '@/components/trip-day-weather';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ItineraryDay, ItineraryItem } from '@/lib/itinerary/api';
import { formatItineraryTimeRange } from '@/lib/itinerary/item-timing';
import type { TripWeather } from '@/lib/weather/api';
import { tripWeatherForDate } from '@/lib/weather/use-trip-weather';
import {
  allOverviewDaysExpanded,
  initiallyExpandedOverviewDayIds,
  setAllOverviewDaysExpanded,
  toggleOverviewDay,
} from '@/lib/itinerary/overview-disclosure';

type ItineraryOverviewProps = {
  days: ItineraryDay[];
  locale: string;
  onEditItem: (item: ItineraryItem) => void;
  onOpenDay: (dayId: string) => void;
  resolveItemName: (item: ItineraryItem) => string;
  timeFormat: '12h' | '24h';
  /** The trip's forecast, read from the shared cache by the day workspace. */
  weather: TripWeather | null;
};

/**
 * A compact reading of the whole plan. It deliberately owns no route, map, or
 * editing state: choosing something hands the traveller back to the focused
 * day workspace that already owns those capabilities.
 */
export function ItineraryOverview({
  days,
  locale,
  onEditItem,
  onOpenDay,
  resolveItemName,
  timeFormat,
  weather,
}: Readonly<ItineraryOverviewProps>) {
  const t = useTranslations('itinerary');
  const [expandedDayIds, setExpandedDayIds] = useState(() => initiallyExpandedOverviewDayIds(days));
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
        weekday: 'short',
        year: 'numeric',
      }),
    [locale],
  );
  const dayIds = useMemo(() => days.map((day) => day.id), [days]);
  const allDaysExpanded = allOverviewDaysExpanded(expandedDayIds, dayIds);

  const itemTiming = (item: ItineraryItem) =>
    item.localStartTime
      ? (formatItineraryTimeRange(item, locale, timeFormat) ?? item.localStartTime)
      : item.dayPart
        ? t(`schedule.${item.dayPart}`)
        : t('schedule.none');

  return (
    <section
      aria-labelledby="itinerary-overview-heading"
      className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-surface)]"
    >
      <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight" id="itinerary-overview-heading">
            {t('overview.title')}
          </h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {t('overview.description', { count: days.length })}
          </p>
        </div>
        {dayIds.length ? (
          <Button
            onClick={() =>
              setExpandedDayIds((current) =>
                setAllOverviewDaysExpanded(current, dayIds, !allDaysExpanded),
              )
            }
            size="xs"
            variant="ghost"
          >
            {allDaysExpanded ? t('overview.collapseAll') : t('overview.expandAll')}
          </Button>
        ) : null}
      </header>

      <ol className="divide-y divide-border-subtle">
        {days.map((day, index) => {
          const date = dateFormatter.format(new Date(`${day.date}T00:00:00.000Z`));

          const dayLabel = t('dayNumber', { number: index + 1 });
          const expanded = expandedDayIds.has(day.id);
          const dayDetails = (
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {dayLabel}
                  <span aria-hidden="true"> · </span>
                  {t('dayItemCount', { count: day.items.length })}
                </p>
                <TripDayWeather forecast={tripWeatherForDate(weather, day.date)} />
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-1">
                <h3 className="min-w-0 flex-1 text-base leading-6 font-semibold text-foreground">
                  <button
                    className="max-w-full rounded-[var(--radius-sm)] text-left outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                    onClick={() => onOpenDay(day.id)}
                    type="button"
                  >
                    <span className="block truncate">{day.name ?? date}</span>
                  </button>
                </h3>
                <CollapsibleTrigger
                  aria-label={
                    expanded
                      ? t('overview.collapseDay', { day: dayLabel })
                      : t('overview.expandDay', { day: dayLabel })
                  }
                  className="shrink-0 p-1 text-text-subtle hover:text-foreground"
                >
                  <ChevronRight
                    aria-hidden="true"
                    className={
                      expanded
                        ? 'rotate-90 transition-transform duration-[var(--motion-standard)] motion-reduce:transition-none'
                        : 'transition-transform duration-[var(--motion-standard)] motion-reduce:transition-none'
                    }
                  />
                </CollapsibleTrigger>
              </div>
              {day.name ? <p className="mt-0.5 text-sm text-muted-foreground">{date}</p> : null}
            </div>
          );

          return (
            <li key={day.id}>
              <Collapsible
                className="grid gap-4 px-4 py-5 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8 md:px-6"
                onOpenChange={(open) =>
                  setExpandedDayIds((current) => toggleOverviewDay(current, day.id, open))
                }
                open={expanded}
              >
                {dayDetails}

                <CollapsiblePanel>
                  {day.items.length ? (
                    <ul aria-label={t('overview.itemsForDay', { number: index + 1 })}>
                      {day.items.map((item) => {
                        const name = resolveItemName(item);

                        return (
                          <li key={item.id}>
                            <button
                              aria-label={t('overview.editItem', { name })}
                              className="group grid w-full grid-cols-[var(--itinerary-time-column)_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius-md)] px-2 py-2 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 active:translate-y-px"
                              onClick={() => onEditItem(item)}
                              type="button"
                            >
                              <span className="text-xs font-medium whitespace-nowrap text-text-subtle tabular-nums">
                                {itemTiming(item)}
                              </span>
                              <span className="truncate text-sm font-medium text-foreground">
                                {name}
                              </span>
                              <ChevronRight
                                aria-hidden="true"
                                className="size-4 text-text-subtle transition-transform duration-[var(--motion-standard)] group-hover:translate-x-0.5 motion-reduce:transition-none"
                              />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <button
                      className="group flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] bg-muted/30 px-3 py-3 text-left text-sm text-muted-foreground outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 active:translate-y-px"
                      onClick={() => onOpenDay(day.id)}
                      type="button"
                    >
                      <span>{t('overview.emptyDay')}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground">
                        {t('overview.openDay')}
                        <ChevronRight
                          aria-hidden="true"
                          className="size-4 transition-transform duration-[var(--motion-standard)] group-hover:translate-x-0.5 motion-reduce:transition-none"
                        />
                      </span>
                    </button>
                  )}
                </CollapsiblePanel>
              </Collapsible>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
