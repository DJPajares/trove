'use client';

import { CloudSun, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { weatherConditionKey } from '@/lib/weather/conditions';
import {
  isDateForecastable,
  isWeatherStale,
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
}: Readonly<{
  isPreview: boolean;
  selectedDate: string;
  tripId: string;
}>) {
  const t = useTranslations('tripMode.views.weather');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const { data, refetch, status } = useTripWeather(tripId);

  if (status === 'loading') {
    return (
      <section
        aria-busy="true"
        aria-label={t('loading')}
        className="border-y border-border py-4"
        role="status"
      >
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
      <section aria-live="polite" className="flex items-start gap-3 border-y border-border py-4">
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
  const timeZone = selectedForecast?.location.timeZone ?? data.days[0]?.location.timeZone ?? 'UTC';
  const current = data.current;
  // An answer read off disk on a plane is worth showing, but it stops being
  // "now" the moment it outlives its window.
  const stale = isWeatherStale(data);
  const showCurrent = Boolean(
    !isPreview && !stale && current && selectedDate === localDate(timeZone),
  );
  const mainTemperature =
    showCurrent && current ? current.temperature : (selectedForecast?.temperatureMax ?? null);
  const condition = showCurrent && current ? current : selectedForecast;
  const unit = t(`unit.${preferences.temperatureUnit}`);
  const formatTemperature = (value: number) => `${Math.round(value)}${unit}`;
  const formattedDate = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${selectedDate}T00:00:00.000Z`));

  return (
    <section aria-labelledby="trip-weather-heading" className="border-y border-border py-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-secondary text-secondary-foreground">
          <CloudSun aria-hidden="true" className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {showCurrent ? t('now') : t('forecast')}
          </p>
          <h3 className="mt-1 font-semibold text-foreground" id="trip-weather-heading">
            {showCurrent ? t('today') : t('forDate', { date: formattedDate })}
          </h3>

          {mainTemperature !== null && condition ? (
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="text-2xl font-semibold tracking-[-0.02em] text-foreground tabular-nums">
                {formatTemperature(mainTemperature)}
              </p>
              <p className="text-sm text-muted-foreground">
                {t(`condition.${weatherConditionKey(condition.weatherCode)}`)}
              </p>
              {showCurrent && current ? (
                <p className="text-sm text-muted-foreground">
                  {t('feelsLike', { temperature: formatTemperature(current.apparentTemperature) })}
                </p>
              ) : null}
              {selectedForecast ? (
                <p className="text-sm text-muted-foreground">
                  {t('range', {
                    high: formatTemperature(selectedForecast.temperatureMax),
                    low: formatTemperature(selectedForecast.temperatureMin),
                  })}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {/* A day past the horizon has no forecast yet; a day inside it that
              still has none has nowhere located to have weather about. */}
              {isDateForecastable(data, selectedDate) ? t('noForecast') : t('forecastLater')}
            </p>
          )}

          {stale ? (
            <p className="mt-2 text-xs leading-5 text-text-subtle">
              {t('staleData', {
                time: new Intl.DateTimeFormat(locale, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone,
                }).format(new Date(data.fetchedAt)),
              })}
            </p>
          ) : null}
          <a
            className="mt-2 inline-flex text-xs text-text-subtle underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            href={data.attribution.url}
            rel="noreferrer"
            target="_blank"
          >
            {data.attribution.label}
          </a>
        </div>
      </div>
    </section>
  );
}
