'use client';

import { CloudSun, Droplets, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { TripWeather } from '@/lib/weather/api';
import {
  NOTABLE_PRECIPITATION,
  weatherConditionIcon,
  weatherConditionKey,
} from '@/lib/weather/conditions';
import { dayForecast } from '@/lib/weather/trip-forecast';
import { useWeatherEvidenceDescription } from '@/lib/weather/use-evidence-description';

const frameClassName =
  'flex min-h-[4.25rem] items-center gap-3.5 rounded-[var(--radius-xl)] border border-border-subtle bg-card px-4 py-3';

/**
 * One day's weather, under the day it belongs to: the condition, the high it
 * is dressed for, the low, and a rain chance worth acting on - always labelled
 * as the dated forecast it is, linked to where it came from. The planner never
 * shows a live reading: a day being planned is a date, not a moment.
 *
 * A day the provider cannot speak for yet, or never kept a forecast for, says
 * so in one quiet line; a failed request offers to try again and never hides
 * the plan below it.
 */
export function DayWeatherCard({
  date,
  onRetry,
  status,
  weather,
}: Readonly<{
  date: string;
  onRetry: () => void;
  status: 'error' | 'loading' | 'ready';
  weather: TripWeather | null;
}>) {
  const t = useTranslations('tripMode.views.weather');
  const planner = useTranslations('itinerary.planner.weather');
  const { preferences } = usePreferences();
  const evidenceDescription = useWeatherEvidenceDescription();

  if (status === 'loading' && !weather) {
    return (
      <div aria-busy="true" aria-label={t('loading')} className={frameClassName} role="status">
        <Skeleton className="size-10 shrink-0 rounded-[var(--radius-lg)]" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
    );
  }

  const day = dayForecast(weather, date);

  if (!weather || !day) {
    return (
      <div aria-live="polite" className={frameClassName}>
        <CloudSun aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t('unavailableTitle')}</p>
        <Button
          aria-label={t('tryAgain')}
          className="rounded-full"
          onClick={onRetry}
          size="icon-sm"
          variant="ghost"
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </div>
    );
  }

  if (!day.forecast) {
    return (
      <p className={cn(frameClassName, 'min-h-0 text-sm text-muted-foreground')}>
        <CloudSun aria-hidden="true" className="size-5 shrink-0" />
        {day.state === 'later'
          ? t('forecastLater')
          : day.state === 'past'
            ? t('pastForecastUnavailable')
            : t('noForecast')}
      </p>
    );
  }

  const forecast = day.forecast;
  const archived = day.state === 'archived';
  const Icon = weatherConditionIcon(forecast.weatherCode);
  const unit = t(`unit.${preferences.temperatureUnit}`);
  const high = `${Math.round(forecast.temperatureMax)}${unit}`;
  const low = `${Math.round(forecast.temperatureMin)}${unit}`;
  const condition = t(`condition.${weatherConditionKey(forecast.weatherCode)}`);
  const probability = forecast.precipitationProbability;
  const rain = probability !== null && probability >= NOTABLE_PRECIPITATION;
  const evidence = evidenceDescription({
    date: forecast.date,
    fetchedAt: forecast.fetchedAt,
    kind: archived ? 'archived' : 'forecast',
    timeZone: forecast.location.timeZone,
  });

  return (
    <a
      aria-label={`${
        rain
          ? t('dayBadgeWithPrecipitation', { condition, high, low, probability })
          : t('dayBadge', { condition, high, low })
      }. ${evidence} ${weather.attribution.label}`}
      className={cn(
        frameClassName,
        'outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none',
      )}
      href={weather.attribution.url}
      rel="noreferrer"
      target="_blank"
      title={`${weather.attribution.label} · ${evidence}`}
    >
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-lg)] bg-surface-tint text-brand"
      >
        <Icon className="size-5" />
      </span>
      <span aria-hidden="true" className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem] font-semibold text-foreground">
          {condition}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{archived ? t('archivedForecast') : t('forecastCue')}</span>
          {rain ? (
            <span className="inline-flex items-center gap-1">
              <Droplets className="size-3 shrink-0" />
              {planner('rainChance', { probability })}
            </span>
          ) : null}
        </span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-right tabular-nums">
        <span className="block text-xl leading-none font-semibold tracking-[-0.02em] text-foreground">
          {high}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">{low}</span>
      </span>
    </a>
  );
}
