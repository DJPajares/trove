'use client';

import { Droplets } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import { cn } from '@/lib/utils';
import { weatherConditionIcon, weatherConditionKey } from '@/lib/weather/conditions';

import type { TripWeatherDay } from '@/lib/weather/api';

/**
 * Below this a probability is not a forecast, it is a rounding error.
 *
 * The provider answers every day with a number, and drawing "10%" down forty
 * rows teaches the eye to skip the column that exists to make it stop. A
 * traveller changes plans somewhere around a third, so that is where the
 * droplet appears.
 */
const NOTABLE_PRECIPITATION = 30;

/**
 * One day's weather, small enough to sit beside a date.
 *
 * This is the dense form: a day rail row, an overview header, an upcoming-day
 * line. It says nothing at all when the provider cannot reach the day yet,
 * because a trip booked for March would otherwise repeat "not forecast" down
 * forty rows and teach the traveller to stop reading the column.
 *
 * The high leads. Two temperatures set in one weight is a pair of numbers to
 * decode; the one a traveller dresses for should be the one the eye lands on,
 * with the low reading as the qualifier it is.
 *
 * `detailed` is for the one surface with a row to spare - the selected day's
 * header - where the condition can be a word instead of an icon. Everywhere
 * else the icon is decorative and the whole badge is announced as a sentence.
 */
export function TripDayWeather({
  className,
  forecast,
  variant = 'compact',
}: Readonly<{
  className?: string;
  forecast: TripWeatherDay | null;
  variant?: 'compact' | 'detailed';
}>) {
  const t = useTranslations('tripMode.views.weather');
  const { preferences } = usePreferences();

  if (!forecast) return null;

  const Icon = weatherConditionIcon(forecast.weatherCode);
  const unit = t(`unit.${preferences.temperatureUnit}`);
  const temperature = (value: number) => `${Math.round(value)}${unit}`;
  const condition = t(`condition.${weatherConditionKey(forecast.weatherCode)}`);
  const high = temperature(forecast.temperatureMax);
  const low = temperature(forecast.temperatureMin);
  const probability = forecast.precipitationProbability;
  const showPrecipitation = probability !== null && probability >= NOTABLE_PRECIPITATION;
  const detailed = variant === 'detailed';

  return (
    <span
      aria-label={
        showPrecipitation
          ? t('dayBadgeWithPrecipitation', { condition, high, low, probability })
          : t('dayBadge', { condition, high, low })
      }
      className={cn(
        'inline-flex shrink-0 items-center gap-x-2 gap-y-0.5 text-xs',
        detailed && 'flex-wrap text-sm',
        className,
      )}
      role="img"
    >
      <span aria-hidden="true" className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Icon className={cn('size-3.5 shrink-0', detailed && 'size-4')} />
        {detailed ? <span className="font-medium text-foreground">{condition}</span> : null}
      </span>

      <span aria-hidden="true" className="text-muted-foreground tabular-nums">
        {t.rich('dayRange', {
          high,
          lead: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
          low,
        })}
      </span>

      {showPrecipitation ? (
        <span aria-hidden="true" className="inline-flex items-center gap-1 text-muted-foreground">
          <Droplets className="size-3 shrink-0" />
          <span className="tabular-nums">{t('dayPrecipitation', { probability })}</span>
        </span>
      ) : null}
    </span>
  );
}
