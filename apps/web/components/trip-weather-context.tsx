'use client';

import { useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import {
  TripHourlyWeather,
  TripWeatherHeadline,
  type TripWeatherLead,
} from '@/components/trip-hourly-weather';
import { tripModeCardClass } from '@/components/trip-mode-ui';
import { useNowTick } from '@/hooks/use-now-tick';
import { Skeleton } from '@/components/ui/skeleton';
import { weatherConditionKey } from '@/lib/weather/conditions';
import { selectTripWeather } from '@/lib/weather/freshness';
import { cn } from '@/lib/utils';
import { useTripWeather } from '@/lib/weather/use-trip-weather';
import { useWeatherEvidenceDescription } from '@/lib/weather/use-evidence-description';

/**
 * The day's weather, at the size a traveller reads it standing up.
 *
 * Today and Now show the same card about different days, and both take it from
 * the one trip-wide answer rather than asking per screen. A current reading is
 * only ever shown for the real local today on a live surface: Preview is
 * stepping through a day that has not happened, and labelling a forecast "now"
 * there would be a lie the rest of the screen cannot correct.
 */
export function TripWeatherContext({
  isPreview,
  selectedDate,
  tripId,
}: Readonly<{
  isPreview: boolean;
  selectedDate: string;
  tripId: string;
}>) {
  const t = useTranslations('tripMode.views.weather');

  // One frame for every state below, so a forecast that fails to load sits in
  // the same card the reading would have.
  const frameClassName = cn(tripModeCardClass, 'p-4');

  const { preferences } = usePreferences();
  const { data, status } = useTripWeather(tripId);
  const now = useNowTick(true, true);
  const evidenceDescription = useWeatherEvidenceDescription();
  const selected = data ? selectTripWeather(data, selectedDate, isPreview, now) : null;

  if (status === 'loading') {
    return (
      <section aria-busy="true" aria-label={t('loading')} className={frameClassName} role="status">
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-6 w-28" />
        </div>
        <div className="mt-3 flex gap-1.5">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton className="h-[4.75rem] w-14 rounded-[var(--radius-lg)]" key={index} />
          ))}
        </div>
      </section>
    );
  }

  // Weather that could not be read takes no room in Trip Mode either.
  if (!data || (status === 'error' && !selected?.current && !selected?.forecast)) return null;

  const { current, forecast: selectedForecast, readings: hourReadings } = selected!;
  const condition = current ?? selectedForecast;
  const evidence = current
    ? evidenceDescription({
        kind: 'current',
        observedAt: current.observedAt,
        timeZone: selectedForecast!.location.timeZone,
      })
    : selectedForecast
      ? evidenceDescription({
          kind: 'forecast',
          date: selectedForecast.date,
          timeZone: selectedForecast.location.timeZone,
          fetchedAt: selectedForecast.fetchedAt,
        })
      : '';
  const unit = t(`unit.${preferences.temperatureUnit}`);
  const formatTemperature = (value: number) => `${Math.round(value)}${unit}`;
  // A live reading says it is one; anything else says it is a forecast, and an
  // old forecast says it is old.
  const lead: TripWeatherLead | null =
    condition && selectedForecast
      ? {
          condition: t(`condition.${weatherConditionKey(condition.weatherCode)}`),
          tag: current ? t('nowCell') : t('forecastCue'),
          temperature: formatTemperature(current?.temperature ?? selectedForecast.temperatureMax),
          weatherCode: condition.weatherCode,
          isDay: current?.isDay,
        }
      : null;
  const range = selectedForecast
    ? t('rangeShort', {
        high: formatTemperature(selectedForecast.temperatureMax),
        low: formatTemperature(selectedForecast.temperatureMin),
      })
    : null;

  return (
    <section aria-labelledby="trip-weather-heading" className={frameClassName}>
      <h3 className="sr-only" id="trip-weather-heading">
        {current ? t('now') : t('forecast')}
      </h3>

      {hourReadings.length ? (
        <TripHourlyWeather
          attribution={data.attribution}
          evidenceDescription={evidence}
          hasCurrent={Boolean(current)}
          lead={lead}
          range={range}
          readings={hourReadings}
          temperatureUnit={preferences.temperatureUnit}
        />
      ) : lead ? (
        // No hours for this day, so the day itself is the answer: one line,
        // still linking to where it came from.
        <a
          aria-label={`${t('readingLabel', {
            condition: lead.condition,
            source: data.attribution.label,
            temperature: lead.temperature,
          })}. ${evidence}`}
          className="block rounded-[var(--radius-sm)] outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          href={data.attribution.url}
          rel="noreferrer"
          target="_blank"
          title={`${data.attribution.label} · ${evidence}`}
        >
          <TripWeatherHeadline lead={lead} range={range} />
        </a>
      ) : null}
    </section>
  );
}
