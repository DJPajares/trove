'use client';

import { Droplets } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import { selectHourlyReadings } from '@/lib/weather/hourly';
import {
  NOTABLE_PRECIPITATION,
  weatherConditionIcon,
  weatherConditionKey,
} from '@/lib/weather/conditions';

import type { WeatherHourlyForecast } from '@/lib/weather/api';

/**
 * Below this the strip is not a shape, it is a leftover.
 *
 * At half past eleven at night what remains of today is one cell, and a row of
 * one says less than the temperature already above it does.
 */
const MINIMUM_READINGS = 2;

/**
 * The rest of today, hour by hour.
 *
 * The panel above answers what the day is like; this answers when. A high and a
 * low cannot say whether the rain lands before the afternoon is over, and that
 * is the question a traveller already outside is actually asking.
 *
 * It draws only what is still ahead: hours that have been and gone are the one
 * thing a forecast can be certain about and the one thing nobody needs.
 */
export function TripHourlyWeather({
  date,
  hours,
  timeZone,
}: Readonly<{ date: string; hours: readonly WeatherHourlyForecast[]; timeZone: string }>) {
  const t = useTranslations('tripMode.views.weather');
  const locale = useLocale();
  const { preferences } = usePreferences();

  const readings = selectHourlyReadings(hours, { date, timeZone });
  if (readings.length < MINIMUM_READINGS) return null;

  const unit = t(`unit.${preferences.temperatureUnit}`);
  // The provider already answered in the day's own zone, so the string is a
  // wall clock. Reading it back as UTC keeps that hour intact rather than
  // shifting it into whatever zone this device happens to be in.
  const hourOptions = {
    hour: 'numeric',
    hour12: preferences.timeFormat === '12h',
    timeZone: 'UTC',
  } as const;
  const formatter = new Intl.DateTimeFormat(locale, hourOptions);
  // A column of bare hours reads fine under a heading that says what they are.
  // Read aloud, "09" alone could be anything, so the announced form keeps the
  // minutes that make it a time.
  const spokenFormatter = new Intl.DateTimeFormat(locale, { ...hourOptions, minute: '2-digit' });

  return (
    <ul
      aria-label={t('hourlyLabel')}
      className="interaction-scrollbar -mx-1 mt-3 flex snap-x gap-4 overflow-x-auto px-1 pb-1"
    >
      {readings.map((hour) => {
        const Icon = weatherConditionIcon(hour.weatherCode);
        const condition = t(`condition.${weatherConditionKey(hour.weatherCode)}`);
        const at = new Date(`${hour.time}:00.000Z`);
        const time = formatter.format(at);
        const spokenTime = spokenFormatter.format(at);
        const temperature = `${Math.round(hour.temperature)}${unit}`;
        const probability = hour.precipitationProbability;
        const showPrecipitation = probability !== null && probability >= NOTABLE_PRECIPITATION;

        return (
          <li className="shrink-0 snap-start" key={hour.time}>
            <span
              aria-label={
                showPrecipitation
                  ? t('hourCellWithPrecipitation', {
                      condition,
                      probability,
                      temperature,
                      time: spokenTime,
                    })
                  : t('hourCell', { condition, temperature, time: spokenTime })
              }
              className="flex w-12 flex-col items-center gap-1"
              role="img"
            >
              <span aria-hidden="true" className="text-xs text-muted-foreground tabular-nums">
                {time}
              </span>
              <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span aria-hidden="true" className="text-sm font-medium text-foreground tabular-nums">
                {temperature}
              </span>
              {showPrecipitation ? (
                <span
                  aria-hidden="true"
                  className="flex items-center gap-0.5 text-xs text-text-subtle tabular-nums"
                >
                  <Droplets className="size-3 shrink-0" />
                  {t('dayPrecipitation', { probability })}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
