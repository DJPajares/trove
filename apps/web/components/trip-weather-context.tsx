'use client';

import { CloudSun, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import { TripHourlyWeather } from '@/components/trip-hourly-weather';
import { useNowTick } from '@/hooks/use-now-tick';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { weatherConditionIcon, weatherConditionKey } from '@/lib/weather/conditions';
import { isArchivedForecast, selectTripWeather } from '@/lib/weather/freshness';
import { dateIsBeforeForecastWindow } from '@/lib/weather/history';
import { cn } from '@/lib/utils';
import { isDateForecastable, useTripWeather } from '@/lib/weather/use-trip-weather';
import { useWeatherEvidenceDescription } from '@/lib/weather/use-evidence-description';

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
  variant = 'ruled',
}: Readonly<{
  isPreview: boolean;
  selectedDate: string;
  tripId: string;
  /**
   * `card` for the day view, which is built of cards; `ruled` for Now, whose
   * sections are separated by hairlines rather than boxes.
   */
  variant?: 'card' | 'ruled';
}>) {
  const t = useTranslations('tripMode.views.weather');

  // One frame for every state below, so a forecast that fails to load sits in
  // the same box the reading would have.
  const frameClassName =
    variant === 'card'
      ? 'rounded-[var(--radius-2xl)] border border-border-subtle bg-card p-4 shadow-[var(--shadow-control)]'
      : 'border-y border-border py-4';

  const { preferences } = usePreferences();
  const { data, refetch, status } = useTripWeather(tripId);
  const now = useNowTick(true, true);
  const evidenceDescription = useWeatherEvidenceDescription();
  const selected = data ? selectTripWeather(data, selectedDate, isPreview, now) : null;

  if (status === 'loading') {
    return (
      <section aria-busy="true" aria-label={t('loading')} className={frameClassName} role="status">
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

  if (!data || (status === 'error' && !selected?.current && !selected?.forecast)) {
    return (
      <section aria-live="polite" className={cn('flex items-start gap-3', frameClassName)}>
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

  const { current, forecast: selectedForecast, readings: hourReadings } = selected!;
  const showCurrent = Boolean(current);
  const showHours = hourReadings.length > 0;
  const condition = current ?? selectedForecast;
  const archived = Boolean(selectedForecast && isArchivedForecast(selectedForecast, now));
  const evidence = current
    ? evidenceDescription({
        kind: 'current',
        observedAt: current.observedAt,
        timeZone: selectedForecast!.location.timeZone,
      })
    : selectedForecast
      ? evidenceDescription({
          kind: archived ? 'archived' : 'forecast',
          date: selectedForecast.date,
          timeZone: selectedForecast.location.timeZone,
          fetchedAt: selectedForecast.fetchedAt,
        })
      : '';
  const DayIcon = weatherConditionIcon(condition?.weatherCode ?? 0);
  const unit = t(`unit.${preferences.temperatureUnit}`);
  const formatTemperature = (value: number) => `${Math.round(value)}${unit}`;

  return (
    <section aria-labelledby="trip-weather-heading" className={frameClassName}>
      <h3 className="sr-only" id="trip-weather-heading">
        {showCurrent ? t('now') : archived ? t('archivedForecast') : t('forecast')}
      </h3>

      {/* The hours lead. The panel used to spend three lines - an eyebrow saying
          WEATHER FORECAST, a heading restating a date already at the top of the
          screen, and a whole day's high and low - before saying anything a
          traveller standing outside at five in the afternoon could act on. What
          they want is whether it rains before dinner, and that is the strip. */}
      {showHours ? (
        <TripHourlyWeather
          attribution={data.attribution}
          current={showCurrent ? current : null}
          evidenceDescription={evidence}
          readings={hourReadings}
          temperatureUnit={preferences.temperatureUnit}
        />
      ) : condition && selectedForecast ? (
        // No hours for this day, so the day itself is the answer: one line, the
        // condition and the range, still linking to where it came from.
        <a
          aria-label={`${t('readingLabel', {
            condition: t(`condition.${weatherConditionKey(condition.weatherCode)}`),
            source: data.attribution.label,
            temperature: formatTemperature(current?.temperature ?? selectedForecast.temperatureMax),
          })}. ${evidence}`}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-sm)] outline-none transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none"
          href={data.attribution.url}
          rel="noreferrer"
          target="_blank"
          title={`${data.attribution.label} · ${evidence}`}
        >
          <DayIcon aria-hidden="true" className="size-5 shrink-0 text-brand" />
          {archived ? (
            <span aria-hidden="true" className="text-xs text-muted-foreground">
              {t('archivedForecast')}
            </span>
          ) : null}
          <p
            aria-hidden="true"
            className="text-xl font-semibold tracking-[-0.02em] text-foreground tabular-nums"
          >
            {formatTemperature(
              showCurrent && current ? current.temperature : selectedForecast.temperatureMax,
            )}
          </p>
          <p aria-hidden="true" className="text-sm text-muted-foreground">
            {t(`condition.${weatherConditionKey(condition.weatherCode)}`)}
          </p>
          <p aria-hidden="true" className="text-sm text-muted-foreground tabular-nums">
            {t('range', {
              high: formatTemperature(selectedForecast.temperatureMax),
              low: formatTemperature(selectedForecast.temperatureMin),
            })}
          </p>
        </a>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          {/* A past day cannot receive a new forecast; a day inside the window
          without one has nowhere located to have weather about. */}
          {dateIsBeforeForecastWindow(data.horizon, selectedDate)
            ? t('pastForecastUnavailable')
            : isDateForecastable(data, selectedDate)
              ? t('noForecast')
              : t('forecastLater')}
        </p>
      )}

      {/* The day's shape, demoted to the quiet line it is. It is context for the
          hours above, not the headline it used to be. */}
      {showHours && selectedForecast ? (
        <p className="mt-2.5 text-[length:var(--text-metadata)] leading-5 text-text-subtle tabular-nums">
          {t('range', {
            high: formatTemperature(selectedForecast.temperatureMax),
            low: formatTemperature(selectedForecast.temperatureMin),
          })}
        </p>
      ) : null}
    </section>
  );
}
