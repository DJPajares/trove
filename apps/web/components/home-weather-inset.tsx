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

const weatherRibbonClassName =
  'rounded-[var(--radius-lg)] border border-media-fallback-foreground/18 bg-neutral-950/58 p-3 text-media-fallback-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] backdrop-blur-sm supports-[backdrop-filter]:bg-neutral-950/52 [@media(prefers-reduced-transparency:reduce)]:bg-neutral-950/92 [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none';

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
    return <HomeWeatherInsetSkeleton label={t('loading')} />;
  }

  if (state.status === 'error') {
    return (
      <section aria-live="polite" className={`${weatherRibbonClassName} flex items-center gap-3`}>
        <CloudSun aria-hidden="true" className="size-5 shrink-0 text-[var(--primary-on-media)]" />
        <p className="min-w-0 flex-1 text-sm text-media-fallback-foreground/82">
          {t('unavailable')}
        </p>
        <Button
          aria-label={t('tryAgain')}
          className="border border-media-fallback-foreground/14 bg-media-fallback-foreground/8 text-media-fallback-foreground hover:bg-media-fallback-foreground/16 hover:text-media-fallback-foreground focus-visible:border-media-fallback-foreground/35 focus-visible:ring-media-fallback-foreground/35"
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
    <section className={weatherRibbonClassName}>
      <div className="flex items-start gap-3">
        <CloudSun
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-[var(--primary-on-media)]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 text-xs font-medium text-media-fallback-foreground/76">
              {reading?.kind === 'current' ? t('current') : t('forecast', { date: formattedDate })}
            </p>
            <a
              className="shrink-0 rounded-sm text-[0.6875rem] text-media-fallback-foreground/58 underline-offset-4 transition-colors hover:text-media-fallback-foreground hover:underline focus-visible:ring-2 focus-visible:ring-media-fallback-foreground/45 focus-visible:outline-none"
              href={data.attribution.url}
              rel="noreferrer"
              target="_blank"
            >
              {t('source')}
            </a>
          </div>
          {temperature !== null && weatherCode !== undefined ? (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <p className="text-2xl leading-none font-semibold tracking-[-0.025em] tabular-nums">
                {Math.round(temperature)}
                {unit}
              </p>
              <p className="text-sm text-media-fallback-foreground/92">
                {conditionT(`condition.${weatherConditionKey(weatherCode)}`)}
              </p>
              {reading?.kind === 'forecast' ? (
                <p className="text-xs text-media-fallback-foreground/68">
                  {conditionT('range', {
                    high: `${Math.round(reading.reading.temperatureMax)}${unit}`,
                    low: `${Math.round(reading.reading.temperatureMin)}${unit}`,
                  })}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-sm text-media-fallback-foreground/82">{t('outOfRange')}</p>
          )}
          {data.source === 'cache' ? (
            <p className="mt-1 text-xs text-media-fallback-foreground/64">
              {t(data.stale ? 'stale' : 'cached')}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * The inset's box, at the size it will be.
 *
 * Home also reaches for it before it knows whether there is any weather to
 * show, on an active trip the target depends on a second request, and the
 * honest answer there is the same box, not a hole that closes later.
 */
export function HomeWeatherInsetSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <section aria-busy="true" aria-label={label} className={weatherRibbonClassName} role="status">
      <div className="flex items-center gap-3">
        <Skeleton className="size-5 bg-media-fallback-foreground/16" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-3 w-24 bg-media-fallback-foreground/16" />
            <Skeleton className="h-2.5 w-16 bg-media-fallback-foreground/12" />
          </div>
          <Skeleton className="h-5 w-40 max-w-full bg-media-fallback-foreground/18" />
        </div>
      </div>
    </section>
  );
}
