'use client';

import { CloudSun, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import { TripHourlyWeather } from '@/components/trip-hourly-weather';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { weatherConditionIcon, weatherConditionKey } from '@/lib/weather/conditions';
import { selectHourlyReadings } from '@/lib/weather/hourly';
import { dateIsBeforeForecastWindow } from '@/lib/weather/history';
import { cn } from '@/lib/utils';
import {
  isCurrentReadingStale,
  isDateForecastable,
  tripWeatherForDate,
  useTripWeather,
} from '@/lib/weather/use-trip-weather';

function localDate(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * The day's weather, at the size a traveller reads it standing up.
 *
 * Today and Now show the same strip about different days, and both take it from
 * the one trip-wide answer rather than asking per screen. A current reading is
 * only ever shown for the real local today on a live surface: Preview is
 * stepping through a day that has not happened, and labelling a forecast "now"
 * there would be a lie the rest of the screen cannot correct.
 */
export function TripWeatherContext({
  isPreview,
  selectedDate,
  tripId,
  variant = 'ruled',
}: Readonly<{
  isPreview: boolean;
  selectedDate: string;
  tripId: string;
  /**
   * `card` for the day view, which is built of cards; `ruled` for Now, whose
   * sections are separated by hairlines rather than boxes.
   */
  variant?: 'card' | 'ruled';
}>) {
  const t = useTranslations('tripMode.views.weather');

  // One frame for every state below, so a forecast that fails to load sits in
  // the same box the reading would have.
  const frameClassName =
    variant === 'card'
      ? 'rounded-[var(--radius-2xl)] border border-border-subtle bg-card p-4 shadow-[var(--shadow-control)]'
      : 'border-y border-border py-4';

  const { preferences } = usePreferences();
  const { data, dataUpdatedAt, refetch, status } = useTripWeather(tripId);

  if (status === 'loading') {
    return (
      <section aria-busy="true" aria-label={t('loading')} className={frameClassName} role="status">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-[var(--radius-md)]" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-44" />
          </div>
        </div>
      </section>
    );
  }

  if (status === 'error' || !data) {
    return (
      <section aria-live="polite" className={cn('flex items-start gap-3', frameClassName)}>
        <CloudSun aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-foreground">{t('unavailableTitle')}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t('unavailableDescription')}
          </p>
        </div>
        <Button aria-label={t('tryAgain')} onClick={refetch} size="icon-sm" variant="ghost">
          <RefreshCw aria-hidden="true" />
        </Button>
      </section>
    );
  }

  const selectedForecast = tripWeatherForDate(data, selectedDate);
  const timeZone =
    selectedForecast?.location.timeZone ??
    data.days.find((day) => day.date >= data.horizon.startDate)?.location.timeZone ??
    data.days[0]?.location.timeZone ??
    'UTC';
  const current = data.current;
  // An answer read off disk on a plane is worth showing, but it stops being
  // "now" the moment it outlives its window. Dropping back to the day's
  // forecast is the whole of that correction.
  const stale = isCurrentReadingStale(dataUpdatedAt);
  const isToday = selectedDate === localDate(timeZone);
  const showCurrent = Boolean(!isPreview && !stale && current && isToday);
  /**
   * Whether the hours in hand are this day's hours.
   *
   * They are fetched for one place - wherever the traveller is today - so a
   * trip that moves on tomorrow would otherwise read this city's rain against
   * the next city's afternoon. PRD 21.1 calls that fabricating a forecast, so a
   * day somewhere else keeps the daily summary instead.
   *
   * The server names the day rather than the coordinate it read. Comparing
   * coordinates looked stricter and was in fact looser both ways: a day past
   * the location cap carries the trip's fallback coordinate rather than its
   * own, which matched today's and handed a city the traveller is not in
   * today's rain, while a provider grid cell shifting between the daily and
   * live tiers failed the match on the one day it should always pass.
   */
  const hoursBelongHere = Boolean(data.hours.length && data.hoursDate === selectedDate);
  // Selected here rather than inside the strip, because whether there are any
  // hours for this day is what decides if the hours are the answer at all. A
  // day past the hourly window has none, and must fall back to its summary
  // rather than to a bare high and low.
  const hourReadings =
    !isPreview && !stale && hoursBelongHere
      ? selectHourlyReadings(data.hours, { date: selectedDate, timeZone })
      : [];
  const showHours = hourReadings.length > 0;
  const condition = showCurrent && current ? current : selectedForecast;
  const DayIcon = weatherConditionIcon(condition?.weatherCode ?? 0);
  const unit = t(`unit.${preferences.temperatureUnit}`);
  const formatTemperature = (value: number) => `${Math.round(value)}${unit}`;

  return (
    <section aria-labelledby="trip-weather-heading" className={frameClassName}>
      <h3 className="sr-only" id="trip-weather-heading">
        {showCurrent ? t('now') : t('forecast')}
      </h3>

      {/* The hours lead. The panel used to spend three lines - an eyebrow saying
          WEATHER FORECAST, a heading restating a date already at the top of the
          screen, and a whole day's high and low - before saying anything a
          traveller standing outside at five in the afternoon could act on. What
          they want is whether it rains before dinner, and that is the strip. */}
      {showHours ? (
        <TripHourlyWeather
          attribution={data.attribution}
          current={showCurrent ? current : null}
          readings={hourReadings}
          temperatureUnit={preferences.temperatureUnit}
        />
      ) : condition && selectedForecast ? (
        // No hours for this day, so the day itself is the answer: one line, the
        // condition and the range, still linking to where it came from.
        <a
          aria-label={t('readingLabel', {
            condition: t(`condition.${weatherConditionKey(condition.weatherCode)}`),
            source: data.attribution.label,
            temperature: formatTemperature(selectedForecast.temperatureMax),
          })}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-sm)] outline-none transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none"
          href={data.attribution.url}
          rel="noreferrer"
          target="_blank"
          title={data.attribution.label}
        >
          <DayIcon aria-hidden="true" className="size-5 shrink-0 text-brand" />
          <p
            aria-hidden="true"
            className="text-xl font-semibold tracking-[-0.02em] text-foreground tabular-nums"
          >
            {formatTemperature(
              showCurrent && current ? current.temperature : selectedForecast.temperatureMax,
            )}
          </p>
          <p aria-hidden="true" className="text-sm text-muted-foreground">
            {t(`condition.${weatherConditionKey(condition.weatherCode)}`)}
          </p>
          <p aria-hidden="true" className="text-sm text-muted-foreground tabular-nums">
            {t('range', {
              high: formatTemperature(selectedForecast.temperatureMax),
              low: formatTemperature(selectedForecast.temperatureMin),
            })}
          </p>
        </a>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          {/* A past day cannot receive a new forecast; a day inside the window
          without one has nowhere located to have weather about. */}
          {dateIsBeforeForecastWindow(data.horizon, selectedDate)
            ? t('pastForecastUnavailable')
            : isDateForecastable(data, selectedDate)
              ? t('noForecast')
              : t('forecastLater')}
        </p>
      )}

      {/* The day's shape, demoted to the quiet line it is. It is context for the
          hours above, not the headline it used to be. */}
      {showHours && selectedForecast ? (
        <p className="mt-2.5 text-[length:var(--text-metadata)] leading-5 text-text-subtle tabular-nums">
          {t('range', {
            high: formatTemperature(selectedForecast.temperatureMax),
            low: formatTemperature(selectedForecast.temperatureMin),
          })}
        </p>
      ) : null}
    </section>
  );
}
