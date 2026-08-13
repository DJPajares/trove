'use client';

import { CloudSun, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { usePreferences } from '@/components/preferences-provider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getWeather, type CachedWeatherContext } from '@/lib/weather/api';

type WeatherLocation = {
  latitude: number;
  longitude: number;
  timeZone: string;
};

type LoadState =
  | { data: null; status: 'error' }
  | { data: null; status: 'loading' }
  | { data: CachedWeatherContext; status: 'ready' };

function conditionKey(code: number) {
  if (code === 0) return 'clear';
  if ([1, 2, 3].includes(code)) return 'cloudy';
  if ([45, 48].includes(code)) return 'fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'drizzle';
  if ([61, 63, 65, 66, 67].includes(code)) return 'rain';
  if ([71, 73, 75, 77].includes(code)) return 'snow';
  if ([80, 81, 82].includes(code)) return 'showers';
  if ([85, 86].includes(code)) return 'snowShowers';
  if ([95, 96, 99].includes(code)) return 'thunderstorm';
  return 'unknown';
}

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

export function TripWeatherContext({
  isPreview,
  location,
  selectedDate,
}: Readonly<{
  isPreview: boolean;
  location: WeatherLocation | null;
  selectedDate: string;
}>) {
  const t = useTranslations('tripMode.weather');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({ data: null, status: 'loading' });

  useEffect(() => {
    if (!location) return;
    const controller = new AbortController();
    setState({ data: null, status: 'loading' });
    void getWeather({
      ...location,
      signal: controller.signal,
      temperatureUnit: preferences.temperatureUnit,
    })
      .then((data) => setState({ data, status: 'ready' }))
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState({ data: null, status: 'error' });
        }
      });
    return () => controller.abort();
  }, [location, preferences.temperatureUnit, reloadKey]);

  const selectedForecast = useMemo(
    () => state.data?.forecast.find((forecast) => forecast.date === selectedDate) ?? null,
    [selectedDate, state.data],
  );

  if (!location) return null;

  if (state.status === 'loading') {
    return (
      <section aria-busy="true" aria-label={t('loading')} className="border-y border-border py-4">
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

  if (state.status === 'error') {
    return (
      <section aria-live="polite" className="flex items-start gap-3 border-y border-border py-4">
        <CloudSun aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-foreground">{t('unavailableTitle')}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t('unavailableDescription')}
          </p>
        </div>
        <Button
          aria-label={t('tryAgain')}
          onClick={() => setReloadKey((value) => value + 1)}
          size="icon-sm"
          variant="ghost"
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </section>
    );
  }

  const { data } = state;
  const currentDate = localDate(location.timeZone);
  const current = data.current;
  const showCurrent = Boolean(
    !isPreview && selectedDate === currentDate && data.source === 'live' && current,
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
  const fetchedAt = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: location.timeZone,
  }).format(new Date(data.fetchedAt));

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
                {t(`condition.${conditionKey(condition.weatherCode)}`)}
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
              {isPreview ? t('forecastLater') : t('noForecast')}
            </p>
          )}

          {data.source === 'cache' ? (
            <p className="mt-2 text-xs leading-5 text-text-subtle">
              {t('savedData', { time: fetchedAt })}
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
