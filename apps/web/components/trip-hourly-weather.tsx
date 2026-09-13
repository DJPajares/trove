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
 * The reading in hand leads, at the size a number is read from arm's length,
 * with the hours running beside it behind a hairline. It used to be the first
 * cell of the row, the same size as every forecast hour and distinguished only
 * by a fill and the word "Now" - which gave the one thing that is true equal
 * billing with seven things that are guesses. Behind the rule, every cell is a
 * forecast and none of them has to say so.
 *
 * The hour the traveller is standing in is not drawn twice: with a live reading
 * present the row starts at the next step, so the lead answers now and the row
 * answers what is coming.
 *
 * The whole thing is the link to where the numbers came from - one link rather
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
  // The first reading is the hour in progress, which is what the lead already
  // reports. Dropping it there rather than in the selection keeps the caller's
  // question - are there hours for this day at all - a question about the day.
  const cells = current ? readings.slice(1) : readings;
  const firstDay = cells[0]?.time.slice(0, 10);
  // The row is kept in every cell so the temperatures stay on one line, but a
  // day with no rain in it anywhere does not need the row at all.
  const anyPrecipitation = cells.some(
    (hour) =>
      hour.precipitationProbability !== null &&
      hour.precipitationProbability >= NOTABLE_PRECIPITATION,
  );
  const CurrentIcon = weatherConditionIcon(current?.weatherCode ?? 0);
  const currentCondition = t(`condition.${weatherConditionKey(current?.weatherCode ?? 0)}`);
  const currentTemperature = current ? `${Math.round(current.temperature)}${unit}` : null;

  return (
    <a
      aria-label={t('stripLabel', { source: attribution.label })}
      className="block rounded-[var(--radius-sm)] outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      href={attribution.url}
      rel="noreferrer"
      target="_blank"
      title={attribution.label}
    >
      <div className="flex items-stretch gap-3">
        {current && currentTemperature ? (
          <div
            aria-label={t('hourCell', {
              condition: currentCondition,
              temperature: currentTemperature,
              time: t('nowCell'),
            })}
            className="flex shrink-0 flex-col justify-center gap-0.5"
            role="img"
          >
            <span
              aria-hidden="true"
              className="text-[length:var(--text-metadata)] leading-4 font-medium text-text-subtle"
            >
              {t('nowCell')}
            </span>
            <span aria-hidden="true" className="flex items-center gap-1.5">
              <CurrentIcon className="size-6 shrink-0 text-brand-strong" />
              <span className="text-3xl leading-8 font-semibold tracking-[-0.02em] text-foreground tabular-nums">
                {currentTemperature}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="max-w-28 truncate text-[length:var(--text-metadata)] leading-4 text-muted-foreground"
            >
              {currentCondition}
            </span>
          </div>
        ) : null}

        {current && cells.length ? (
          // The rule is what makes the lead a reading and the rest a forecast.
          <span aria-hidden="true" className="w-px shrink-0 self-stretch bg-border-subtle" />
        ) : null}

        {cells.length ? (
          <ul
            className="interaction-scrollbar -mx-1 flex min-w-0 flex-1 snap-x gap-1 overflow-x-auto px-1 pb-1"
            // The list is inside the link, so it is the link that is announced;
            // the cells below carry the detail as their own images.
            role="list"
          >
            {cells.map((hour) => {
              const Icon = weatherConditionIcon(hour.weatherCode);
              const condition = t(`condition.${weatherConditionKey(hour.weatherCode)}`);
              const temperature = `${Math.round(hour.temperature)}${unit}`;
              const probability = hour.precipitationProbability;
              const showPrecipitation =
                probability !== null && probability >= NOTABLE_PRECIPITATION;
              // Crossing midnight is worth saying once, on the cell that does it.
              const rolled = hour.time.slice(0, 10) !== firstDay;
              const clock = formatter.format(new Date(`${hour.time}:00.000Z`));
              const time = rolled ? t('tomorrowCell', { time: clock }) : clock;

              return (
                <li className="shrink-0 snap-start" key={hour.time}>
                  <span
                    aria-label={
                      showPrecipitation
                        ? t('hourCellWithPrecipitation', {
                            condition,
                            probability,
                            temperature,
                            time,
                          })
                        : t('hourCell', { condition, temperature, time })
                    }
                    className="flex w-14 flex-col items-center gap-1.5 rounded-[var(--radius-md)] py-1"
                    role="img"
                  >
                    <span
                      aria-hidden="true"
                      className="text-[length:var(--text-metadata)] leading-4 text-text-subtle tabular-nums"
                    >
                      {time}
                    </span>
                    <Icon aria-hidden="true" className="size-5 shrink-0 text-brand" />
                    <span
                      aria-hidden="true"
                      className="text-sm font-semibold text-foreground tabular-nums"
                    >
                      {temperature}
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
        ) : null}
      </div>
    </a>
  );
}
