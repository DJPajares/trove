'use client';

import { CloudSun } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { paddedDayNumber } from '@/components/trip-day-card';
import { usePreferences } from '@/components/preferences-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { TripWeather } from '@/lib/weather/api';
import {
  NOTABLE_PRECIPITATION,
  weatherConditionIcon,
  weatherConditionKey,
} from '@/lib/weather/conditions';
import { dayForecast, forecastGap } from '@/lib/weather/trip-forecast';
import { useWeatherEvidenceDescription } from '@/lib/weather/use-evidence-description';
import { ScrollShadow } from '@/components/ui/scroll-shadow';

const frameClassName = 'rounded-[var(--radius-xl)] bg-card px-4 py-3.5';

/**
 * The whole trip's weather at a glance, above the days it belongs to: one
 * column per day with its forecast, archived days labelled as the predictions
 * they were, and a single line for the days nothing can be said about yet - so
 * a long trip says "later" once instead of down every column.
 */
export function TripForecastCard({
  days,
  status,
  weather,
}: Readonly<{
  days: readonly { date: string; id: string; number: number }[];
  status: 'error' | 'loading' | 'ready';
  weather: TripWeather | null;
}>) {
  const t = useTranslations('tripMode.views.weather');
  const planner = useTranslations('itinerary.planner.weather');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const evidenceDescription = useWeatherEvidenceDescription();
  const weekday = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' });
  const unit = t(`unit.${preferences.temperatureUnit}`);

  if (status === 'loading' && !weather) {
    return (
      <section aria-busy="true" aria-label={t('loading')} className={frameClassName} role="status">
        <Skeleton className="h-4 w-40" />
        <div className="mt-3 flex gap-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton className="h-[5.5rem] w-14 rounded-[var(--radius-lg)]" key={index} />
          ))}
        </div>
      </section>
    );
  }

  // Weather that could not be read takes no room; the trip reads fine without it.
  if (!weather) return null;

  const columns = days.map((day) => ({ day, forecast: dayForecast(weather, day.date) }));
  const shown = columns.filter((column) => column.forecast?.forecast);
  const gap = forecastGap(
    columns.flatMap((column) => (column.forecast ? [column.forecast.state] : [])),
  );
  // Only "it is coming" is worth a line; a day that will have no weather is
  // simply left out rather than apologised for.
  const gapText = gap === 'later' ? planner('tripLater') : null;

  if (!shown.length) {
    return gapText ? (
      <p className="flex items-center gap-2.5 px-1 text-sm text-muted-foreground">
        <CloudSun aria-hidden="true" className="size-4 shrink-0" />
        {gapText}
      </p>
    ) : null;
  }

  return (
    <a
      aria-labelledby="trip-forecast-heading"
      className={cn(
        frameClassName,
        'block outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none',
      )}
      href={weather.attribution.url}
      rel="noreferrer"
      target="_blank"
      title={weather.attribution.label}
    >
      <h3 className="text-sm font-semibold" id="trip-forecast-heading">
        {planner('tripTitle')}
      </h3>
      <ScrollShadow
        orientation="horizontal"
        render={<ol />}
        className="interaction-scrollbar relative -mx-1 mt-3 flex gap-2 px-1 pb-1"
      >
        {/* Days with nothing to show are covered once, by the line below. */}
        {shown.map(({ day, forecast: entry }) => {
          const forecast = entry?.forecast ?? null;
          const dayLabel = `${paddedDayNumber(day.number)} ${weekday.format(
            new Date(`${day.date}T00:00:00.000Z`),
          )}`;
          if (!forecast) return null;
          const Icon = weatherConditionIcon(forecast.weatherCode);
          const condition = t(`condition.${weatherConditionKey(forecast.weatherCode)}`);
          const high = `${Math.round(forecast.temperatureMax)}${unit}`;
          const low = `${Math.round(forecast.temperatureMin)}${unit}`;
          const probability = forecast.precipitationProbability;
          const rain = probability !== null && probability >= NOTABLE_PRECIPITATION;
          const evidence = evidenceDescription({
            date: forecast.date,
            fetchedAt: forecast.fetchedAt,
            kind: 'forecast',
            timeZone: forecast.location.timeZone,
          });
          return (
            <li
              className={cn(
                'flex w-14 shrink-0 flex-col items-center gap-1.5 rounded-[var(--radius-lg)] bg-surface-tint px-1 py-2 text-center',
              )}
              key={day.id}
              title={evidence}
            >
              <span className="sr-only">
                {`${dayLabel}. ${
                  rain
                    ? t('dayBadgeWithPrecipitation', { condition, high, low, probability })
                    : t('dayBadge', { condition, high, low })
                }. ${evidence}`}
              </span>
              <span
                aria-hidden="true"
                className="text-[0.625rem] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
              >
                {dayLabel}
              </span>
              <Icon aria-hidden="true" className="size-5 text-brand" />
              <span aria-hidden="true" className="tabular-nums leading-tight">
                <span className="block text-sm font-semibold">{high}</span>
                <span className="block text-[0.6875rem] text-muted-foreground">{low}</span>
              </span>
              <span
                aria-hidden="true"
                className="h-3 text-[0.625rem] leading-none text-muted-foreground tabular-nums"
              >
                {rain ? planner('rainChance', { probability }) : null}
              </span>
            </li>
          );
        })}
      </ScrollShadow>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground empty:hidden">
        {gapText && shown.length < columns.length ? <p>{gapText}</p> : null}
      </div>
    </a>
  );
}
