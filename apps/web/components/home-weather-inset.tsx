'use client';

import { CloudSun, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { usePreferences } from '@/components/preferences-provider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  selectHomeWeatherReading,
  type HomeWeatherTarget,
  weatherConditionKey,
} from '@/lib/home/weather';
import { getWeather, type CachedWeatherContext } from '@/lib/weather/api';

type LoadState =
  { data: null; status: 'error' | 'loading' } | { data: CachedWeatherContext; status: 'ready' };

export function HomeWeatherInset({ target }: Readonly<{ target: HomeWeatherTarget }>) {
  const t = useTranslations('home.weather');
  const conditionT = useTranslations('tripMode.views.weather');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({ data: null, status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, status: 'loading' });
    void getWeather({
      ...target.location,
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
  }, [
    preferences.temperatureUnit,
    reloadKey,
    target.location.latitude,
    target.location.longitude,
    target.location.timeZone,
  ]);

  const reading = useMemo(
    () => (state.status === 'ready' ? selectHomeWeatherReading(state.data, target) : null),
    [state, target],
  );
  const formattedDate = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${target.date}T00:00:00.000Z`));

  if (state.status === 'loading') {
    return (
      <section
        aria-busy="true"
        aria-label={t('loading')}
        className="rounded-[var(--radius-lg)] border border-white/20 bg-black/25 p-3 text-white backdrop-blur-md supports-[backdrop-filter]:bg-black/20"
        role="status"
      >
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 bg-white/25" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-20 bg-white/25" />
            <Skeleton className="h-4 w-32 bg-white/25" />
          </div>
        </div>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section
        aria-live="polite"
        className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-white/20 bg-black/30 p-3 text-white backdrop-blur-md"
      >
        <CloudSun aria-hidden="true" className="size-5 shrink-0 text-white/80" />
        <p className="min-w-0 flex-1 text-sm text-white/85">{t('unavailable')}</p>
        <Button
          aria-label={t('tryAgain')}
          className="text-white hover:bg-white/15 hover:text-white"
          onClick={() => setReloadKey((value) => value + 1)}
          size="icon-sm"
          variant="ghost"
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </section>
    );
  }

  if (!state.data) return null;
  const data = state.data;
  const unit = conditionT(`unit.${preferences.temperatureUnit}`);
  const temperature =
    reading?.kind === 'current'
      ? reading.reading.temperature
      : reading?.kind === 'forecast'
        ? reading.reading.temperatureMax
        : null;
  const weatherCode = reading?.reading?.weatherCode;

  return (
    <section className="rounded-[var(--radius-lg)] border border-white/20 bg-black/30 p-3 text-white backdrop-blur-md supports-[backdrop-filter]:bg-black/20">
      <div className="flex items-start gap-3">
        <CloudSun aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-white/85" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-white/75">
            {reading?.kind === 'current' ? t('current') : t('forecast', { date: formattedDate })}
          </p>
          {temperature !== null && weatherCode !== undefined ? (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p className="text-xl font-semibold tabular-nums">
                {Math.round(temperature)}
                {unit}
              </p>
              <p className="text-sm text-white/80">
                {conditionT(`condition.${weatherConditionKey(weatherCode)}`)}
              </p>
              {reading?.kind === 'forecast' ? (
                <p className="text-xs text-white/70">
                  {conditionT('range', {
                    high: `${Math.round(reading.reading.temperatureMax)}${unit}`,
                    low: `${Math.round(reading.reading.temperatureMin)}${unit}`,
                  })}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-sm text-white/80">{t('outOfRange')}</p>
          )}
          {data.source === 'cache' ? (
            <p className="mt-1 text-xs text-white/65">{t(data.stale ? 'stale' : 'cached')}</p>
          ) : null}
          <a
            className="mt-1 inline-flex rounded-sm text-xs text-white/65 underline-offset-4 hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
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
