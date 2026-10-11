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
import type { WeatherHourlyForecast } from '@/lib/weather/api';

/**
 * The reading a weather card leads with: the conditions in hand when there is a
 * live one, otherwise the day's own forecast - each saying which it is.
 */
export type TripWeatherLead = {
  condition: string;
  /** "Now", "Forecast" or "Archived forecast": never left for the number to imply. */
  tag: string;
  temperature: string;
  weatherCode: number;
};

/** One line: what it is like, and the day's high and low beside it. */
export function TripWeatherHeadline({
  lead,
  range,
}: Readonly<{ lead: TripWeatherLead; range: string | null }>) {
  const Icon = weatherConditionIcon(lead.weatherCode);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon aria-hidden="true" className="size-5 shrink-0 text-brand" />
        <span className="text-xl leading-7 font-semibold tracking-[-0.01em] text-foreground tabular-nums">
          {lead.temperature}
        </span>
        <span className="min-w-0 truncate text-sm text-muted-foreground">{lead.condition}</span>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[0.6875rem] leading-4 font-semibold text-secondary-foreground">
          {lead.tag}
        </span>
      </div>
      {range ? (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{range}</span>
      ) : null}
    </div>
  );
}

/**
 * What the weather does next, which is the question this screen is for.
 *
 * Whether the rain lands before dinner is the thing a traveller already outside
 * is asking, and only the hours can answer it. The reading in hand leads as one
 * line - the conditions, which kind of reading they are, and the day's range -
 * and the hours run beneath it as soft tiles, every one of them a forecast.
 *
 * The hour the traveller is standing in is not drawn twice: with a live reading
 * present the row starts at the next step.
 *
 * The whole thing is the link to where the numbers came from - one link rather
 * than one per cell, so scrolling along the hours never becomes a trip off the
 * site. The credit rides in the tooltip and the accessible name.
 */
export function TripHourlyWeather({
  attribution,
  evidenceDescription,
  hasCurrent,
  lead,
  range,
  readings,
  temperatureUnit,
}: Readonly<{
  attribution: { label: string; url: string };
  evidenceDescription?: string;
  /** A live reading leads, so the hour in progress is not repeated as a tile. */
  hasCurrent: boolean;
  lead: TripWeatherLead | null;
  range: string | null;
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
    // On a 24-hour clock the minutes are what make "09" read as a time; on a
    // 12-hour clock AM and PM already do that job.
    ...(is12Hour ? {} : { minute: '2-digit' }),
    timeZone: 'UTC',
  });
  const cells = hasCurrent ? readings.slice(1) : readings;
  const firstDay = cells[0]?.time.slice(0, 10);
  // The row is kept in every tile so the temperatures stay on one line, but a
  // day with no rain in it anywhere does not need the row at all.
  const anyPrecipitation = cells.some(
    (hour) =>
      hour.precipitationProbability !== null &&
      hour.precipitationProbability >= NOTABLE_PRECIPITATION,
  );

  return (
    <a
      aria-label={`${t('stripLabel', { source: attribution.label })}${evidenceDescription ? `. ${evidenceDescription}` : ''}`}
      className="block rounded-[var(--radius-sm)] outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      href={attribution.url}
      rel="noreferrer"
      target="_blank"
      title={
        evidenceDescription ? `${attribution.label} · ${evidenceDescription}` : attribution.label
      }
    >
      {lead ? <TripWeatherHeadline lead={lead} range={range} /> : null}

      {cells.length ? (
        <ul
          className={cn(
            'interaction-scrollbar -mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1',
            lead && 'mt-3',
          )}
          // The list is inside the link, so it is the link that is announced;
          // the tiles below carry the detail as their own images.
          role="list"
        >
          {cells.map((hour) => {
            const Icon = weatherConditionIcon(hour.weatherCode);
            const condition = t(`condition.${weatherConditionKey(hour.weatherCode)}`);
            const temperature = `${Math.round(hour.temperature)}${unit}`;
            const probability = hour.precipitationProbability;
            const showPrecipitation = probability !== null && probability >= NOTABLE_PRECIPITATION;
            // Crossing midnight is worth saying once, on the tile that does it.
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
                  className="flex w-14 flex-col items-center gap-1 rounded-[var(--radius-lg)] bg-muted/60 py-2"
                  role="img"
                >
                  <span
                    aria-hidden="true"
                    className="text-[0.6875rem] leading-4 text-muted-foreground tabular-nums"
                  >
                    {time}
                  </span>
                  <Icon aria-hidden="true" className="size-5 shrink-0 text-brand" />
                  <span
                    aria-hidden="true"
                    className="text-sm leading-5 font-semibold text-foreground tabular-nums"
                  >
                    {temperature}
                  </span>
                  {/* A number here means it is worth carrying something. Tiles
                      without one still hold the space so the row stays even. */}
                  {anyPrecipitation ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex items-center gap-0.5 text-[0.6875rem] leading-3 text-status-info tabular-nums',
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
    </a>
  );
}
