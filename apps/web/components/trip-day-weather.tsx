'use client';

import { useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import { cn } from '@/lib/utils';
import { weatherConditionIcon, weatherConditionKey } from '@/lib/weather/conditions';

import type { TripWeatherDay } from '@/lib/weather/api';

/**
 * One day's weather, small enough to sit beside a date.
 *
 * This is the dense form: a day rail row, an overview header, an upcoming-day
 * line. It says nothing at all when the provider cannot reach the day yet,
 * because a trip booked for March would otherwise repeat "not forecast" down
 * forty rows and teach the traveller to stop reading the column.
 *
 * The icon is decorative. Everything it means is also in the label, which the
 * visible high/low compresses and `aria-label` says in full - a screen reader
 * should not have to infer the weather from two numbers and a slash.
 */
export function TripDayWeather({
  className,
  forecast,
}: Readonly<{ className?: string; forecast: TripWeatherDay | null }>) {
  const t = useTranslations('tripMode.views.weather');
  const { preferences } = usePreferences();

  if (!forecast) return null;

  const Icon = weatherConditionIcon(forecast.weatherCode);
  const unit = t(`unit.${preferences.temperatureUnit}`);
  const temperature = (value: number) => `${Math.round(value)}${unit}`;
  const condition = t(`condition.${weatherConditionKey(forecast.weatherCode)}`);

  return (
    <span
      aria-label={t('dayBadge', {
        condition,
        high: temperature(forecast.temperatureMax),
        low: temperature(forecast.temperatureMin),
      })}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span aria-hidden="true" className="tabular-nums">
        {t('dayRange', {
          high: temperature(forecast.temperatureMax),
          low: temperature(forecast.temperatureMin),
        })}
      </span>
    </span>
  );
}
