'use client';

import { Droplets } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import {
  NOTABLE_PRECIPITATION,
  weatherConditionIcon,
  weatherConditionKey,
} from '@/lib/weather/conditions';
import { cn } from '@/lib/utils';

import type { TemperatureUnit } from '@/lib/profile/preferences';
import type { WeatherCurrentConditions, WeatherHourlyForecast } from '@/lib/weather/api';

/**
 * What the weather does next, which is the question this screen is for.
 *
 * A high and a low describe a day that, at five in the afternoon, is mostly
 * over. Whether the rain lands before dinner is the thing a traveller already
 * outside is actually asking, and only the hours can answer it - so the hours
 * are the component rather than a footnote under a daily summary.
 *
 * The first cell is the reading in hand rather than another forecast hour, and
 * says so. Everything after it steps two hours at a time, running to the end of
 * the day and on into tomorrow morning when what is left of today is too thin
 * to be worth a row of its own.
 *
 * The whole strip is the link to where the numbers came from - one link rather
 * than one per cell, so scrolling along the hours never becomes a trip off the
 * site. The credit rides in the tooltip and the accessible name, which is where
 * it has lived since the labels came off the weather surfaces.
 */
export function TripHourlyWeather({
  attribution,
  current,
  readings,
  temperatureUnit,
}: Readonly<{
  attribution: { label: string; url: string };
  current: WeatherCurrentConditions | null;
  /**
   * Already selected by the caller, which needs to know whether there are any
   * before deciding that the hours are this day's answer at all.
   */
  readings: readonly WeatherHourlyForecast[];
  temperatureUnit: TemperatureUnit;
}>) {
  const t = useTranslations('tripMode.views.weather');
  const locale = useLocale();
  const { preferences } = usePreferences();

  if (!readings.length) return null;

  const unit = t(`unit.${temperatureUnit}`);
  // The provider already answered in the day's own zone, so the string is a
  // wall clock. Reading it back as UTC keeps that hour intact rather than
  // shifting it into whatever zone this device happens to be in.
  const is12Hour = preferences.timeFormat === '12h';
  const formatter = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    hour12: is12Hour,
    // On a 24-hour clock "09" standing over "13°C" is just another number in a
    // column of numbers; the minutes are what make it read as a time. A
    // 12-hour clock has AM and PM doing that job already, and "9 AM" earns its
    // place in a narrow cell where "9:00 AM" does not.
    ...(is12Hour ? {} : { minute: '2-digit' }),
    timeZone: 'UTC',
  });
  const firstDay = readings[0]?.time.slice(0, 10);
  // The row is kept in every cell so the temperatures stay on one line, but a
  // day with no rain in it anywhere does not need the row at all.
  const anyPrecipitation = readings.some(
    (hour) =>
      hour.precipitationProbability !== null &&
      hour.precipitationProbability >= NOTABLE_PRECIPITATION,
  );

  return (
    <a
      aria-label={t('stripLabel', { source: attribution.label })}
      className="block rounded-[var(--radius-sm)] outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      href={attribution.url}
      rel="noreferrer"
      target="_blank"
      title={attribution.label}
    >
      <ul
        className="interaction-scrollbar -mx-1 flex snap-x gap-1 overflow-x-auto px-1 pb-1"
        // The list is inside the link, so it is the link that is announced; the
        // cells below carry the detail as their own images.
        role="list"
      >
        {readings.map((hour, index) => {
          const Icon = weatherConditionIcon(hour.weatherCode);
          const condition = t(`condition.${weatherConditionKey(hour.weatherCode)}`);
          const temperature = `${Math.round(hour.temperature)}${unit}`;
          const probability = hour.precipitationProbability;
          const showPrecipitation = probability !== null && probability >= NOTABLE_PRECIPITATION;
          // Cell one is the reading in hand, when there is one. Labelling it as
          // an hour would file the present under the forecast.
          const isNow = index === 0 && current !== null;
          // Crossing midnight is worth saying once, on the cell that does it.
          const rolled = !isNow && hour.time.slice(0, 10) !== firstDay;
          const time = isNow
            ? t('nowCell')
            : rolled
              ? t('tomorrowCell', { time: formatter.format(new Date(`${hour.time}:00.000Z`)) })
              : formatter.format(new Date(`${hour.time}:00.000Z`));

          return (
            <li className="shrink-0 snap-start" key={hour.time}>
              <span
                aria-label={
                  showPrecipitation
                    ? t('hourCellWithPrecipitation', { condition, probability, temperature, time })
                    : t('hourCell', { condition, temperature, time })
                }
                className={cn(
                  'flex w-14 flex-col items-center gap-1.5 rounded-[var(--radius-md)] py-2',
                  isNow && 'bg-secondary text-secondary-foreground',
                )}
                role="img"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'text-[length:var(--text-metadata)] leading-4 tabular-nums',
                    isNow ? 'font-semibold text-secondary-foreground' : 'text-text-subtle',
                  )}
                >
                  {time}
                </span>
                <Icon
                  aria-hidden="true"
                  className={cn('size-5 shrink-0', isNow ? 'text-brand-strong' : 'text-brand')}
                />
                <span
                  aria-hidden="true"
                  className="text-sm font-semibold text-foreground tabular-nums"
                >
                  {isNow && current ? `${Math.round(current.temperature)}${unit}` : temperature}
                </span>
                {/* A column of zeroes says nothing; a number here means it is
                    worth carrying something. Cells without one still hold the
                    space so the temperatures stay on one line. */}
                {anyPrecipitation ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex items-center gap-0.5 text-xs leading-3 text-status-info tabular-nums',
                      !showPrecipitation && 'invisible',
                    )}
                  >
                    <Droplets className="size-3 shrink-0" />
                    {t('dayPrecipitation', { probability: probability ?? 0 })}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </a>
  );
}
