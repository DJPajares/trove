'use client';

import { CalendarRange } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, type KeyboardEvent } from 'react';

import { usePreferences } from '@/components/preferences-provider';
import type { PlannerDay } from '@/lib/itinerary/planner-days';
import { cn } from '@/lib/utils';
import type { TripWeatherDay } from '@/lib/weather/api';
import { weatherConditionIcon, weatherConditionKey } from '@/lib/weather/conditions';

/** More than this many pips stops reading as a count and starts reading as noise. */
const MAX_PIPS = 5;

/** The ribbon numbers days the way the day's own page does: "03", not "3". */
export function paddedDayNumber(number: number) {
  return String(number).padStart(2, '0');
}

function RibbonWeather({ forecast }: Readonly<{ forecast: TripWeatherDay }>) {
  const t = useTranslations('tripMode.views.weather');
  const { preferences } = usePreferences();
  const Icon = weatherConditionIcon(forecast.weatherCode);

  return (
    <span aria-hidden="true" className="inline-flex items-center gap-0.5 tabular-nums">
      <Icon className="size-3 shrink-0 [--icon-stroke:var(--icon-stroke-compact)]" />
      {Math.round(forecast.temperatureMax)}
      {t(`unit.${preferences.temperatureUnit}`)}
    </span>
  );
}

/**
 * The trip, one tile per day: the way between days on every form factor.
 *
 * Each tile is enough to choose by - the day's number and date, its town, its
 * weather, how much is on it, and a dot when its plan has a verified problem
 * worth a look - so finding "the beach day" or "the day that needs fixing"
 * takes a glance along the strip rather than a tour through the days. The
 * first tile is the whole trip.
 *
 * It behaves like a tab list with manual activation: arrow keys move focus
 * along the strip, and Enter or Space opens a day. Opening a day fetches its
 * travel legs, so moving focus must never do that on its own.
 */
export function PlannerRibbon({
  days,
  onSelectDay,
  onSelectOverview,
  overviewActive,
  selectedDayId,
  weatherFor,
}: Readonly<{
  days: readonly PlannerDay[];
  onSelectDay: (dayId: string) => void;
  onSelectOverview: () => void;
  overviewActive: boolean;
  selectedDayId: string | null;
  weatherFor: (date: string) => TripWeatherDay | null;
}>) {
  const t = useTranslations('itinerary.planner.ribbon');
  const weatherT = useTranslations('tripMode.views.weather');
  const locale = useLocale();
  const listRef = useRef<HTMLOListElement>(null);
  const activeKey = overviewActive ? 'overview' : selectedDayId;

  const weekday = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    timeZone: 'UTC',
    weekday: 'short',
  });
  const longDate = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    weekday: 'long',
  });
  const asDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

  // The open day is kept in view without moving the page: only the strip
  // scrolls, so opening a day never jumps the traveller up or down the screen.
  useEffect(() => {
    const list = listRef.current;
    const tile = list?.querySelector<HTMLElement>('[data-ribbon-active="true"]');
    if (!list || !tile) return;
    const left = tile.offsetLeft - (list.clientWidth - tile.offsetWidth) / 2;
    list.scrollTo({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      left: Math.max(0, left),
    });
  }, [activeKey]);

  function moveFocus(event: KeyboardEvent<HTMLOListElement>) {
    const tiles = [
      ...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-ribbon-tile]') ?? []),
    ];
    const current = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    const next =
      event.key === 'ArrowRight'
        ? Math.min(current + 1, tiles.length - 1)
        : event.key === 'ArrowLeft'
          ? Math.max(current - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tiles.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    tiles[next]?.focus();
  }

  return (
    <nav
      aria-label={t('label')}
      className="relative sticky top-[calc(var(--safe-top)+var(--header-offset)+3.25rem)] z-[calc(var(--layer-sticky)-1)] -mx-[var(--gutter-inline-start)] -mt-2 bg-background/95 backdrop-blur before:pointer-events-none before:absolute before:inset-x-0 before:-top-4 before:h-4 before:bg-background before:content-[''] md:top-[calc(var(--safe-top)+var(--header-offset))] md:mx-0 md:mt-0 md:rounded-[var(--radius-xl)] md:before:hidden"
      data-slot="planner-ribbon"
    >
      <ol
        className="interaction-scrollbar relative flex snap-x scroll-px-[var(--gutter-inline-start)] gap-1.5 overflow-x-auto px-[var(--gutter-inline-start)] py-2 md:scroll-px-1 md:px-1"
        onKeyDown={moveFocus}
        ref={listRef}
      >
        <li className="snap-start">
          <button
            aria-current={overviewActive ? 'page' : undefined}
            className={cn(
              'flex h-[5.25rem] w-[4.5rem] shrink-0 flex-col justify-between rounded-[var(--radius-lg)] border px-2 py-2 text-left outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none',
              overviewActive
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border-subtle bg-card text-foreground hover:bg-surface-hover',
            )}
            data-ribbon-active={overviewActive}
            data-ribbon-tile
            onClick={onSelectOverview}
            tabIndex={activeKey === 'overview' || activeKey === null ? 0 : -1}
            type="button"
          >
            <CalendarRange aria-hidden="true" className="size-4" />
            <span className="text-xs leading-tight font-semibold">{t('allDays')}</span>
            <span
              className={cn(
                'text-[0.6875rem] leading-none tabular-nums',
                overviewActive ? 'text-primary-foreground/75' : 'text-muted-foreground',
              )}
            >
              {t('dayCount', { count: days.length })}
            </span>
          </button>
        </li>

        {days.map((day) => {
          const active = !overviewActive && day.id === selectedDayId;
          const forecast = weatherFor(day.date);
          const label = [
            day.isToday ? t('today') : null,
            t('day', { number: day.number }),
            longDate.format(asDate(day.date)),
            day.name,
            day.town,
            forecast ? weatherT(`condition.${weatherConditionKey(forecast.weatherCode)}`) : null,
            t('stops', { count: day.stopCount }),
            day.attention ? t('attention') : null,
          ]
            .filter(Boolean)
            .join(', ');

          return (
            <li className="snap-start" key={day.id}>
              <button
                aria-current={active ? 'date' : undefined}
                aria-label={label}
                className={cn(
                  'relative flex h-[5.25rem] w-[4.5rem] shrink-0 flex-col justify-between rounded-[var(--radius-lg)] border px-2 py-2 text-left outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : day.stopCount
                      ? 'border-border-subtle bg-card text-foreground hover:bg-surface-hover'
                      : 'border-dashed border-border bg-transparent text-muted-foreground hover:bg-surface-hover',
                )}
                data-ribbon-active={active}
                data-ribbon-tile
                onClick={() => onSelectDay(day.id)}
                tabIndex={active ? 0 : -1}
                title={day.name ?? day.town ?? undefined}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'text-[0.625rem] leading-none font-semibold tracking-[0.06em] uppercase',
                    active
                      ? 'text-primary-foreground/80'
                      : day.isToday
                        ? 'text-brand'
                        : 'text-muted-foreground',
                  )}
                >
                  {day.isToday ? t('today') : weekday.format(asDate(day.date))}
                </span>
                <span
                  aria-hidden="true"
                  className="text-[1.375rem] leading-none font-semibold tracking-[-0.02em] tabular-nums"
                >
                  {paddedDayNumber(day.number)}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'block truncate text-[0.6875rem] leading-tight',
                    active ? 'text-primary-foreground/85' : 'text-muted-foreground',
                  )}
                >
                  {day.name ?? day.town ?? ' '}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex items-center justify-between gap-1 text-[0.625rem] leading-none',
                    active ? 'text-primary-foreground/85' : 'text-muted-foreground',
                  )}
                >
                  {forecast ? <RibbonWeather forecast={forecast} /> : <span />}
                  <span className="flex items-center gap-[2px]">
                    {Array.from({ length: Math.min(day.stopCount, MAX_PIPS) }, (_, index) => (
                      <span className="size-1 rounded-full bg-current" key={index} />
                    ))}
                    {day.stopCount > MAX_PIPS ? <span className="ml-px">+</span> : null}
                  </span>
                </span>
                {day.attention ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute top-1.5 right-1.5 size-2 rounded-full bg-status-warning ring-2',
                      active ? 'ring-primary' : 'ring-card',
                    )}
                  />
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
