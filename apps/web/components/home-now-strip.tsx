'use client';

import { useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { useHereWeather } from '@/lib/home/use-here-weather';
import { weatherConditionIcon, weatherConditionKey } from '@/lib/weather/conditions';
import { useWeatherEvidenceDescription } from '@/lib/weather/use-evidence-description';

/**
 * A quiet weather cue above the traveller's moment.
 *
 * This replaced a greeting. "Hi, <name>" spent the first line of the product
 * telling the reader their own name, and it put an `h1` that said nothing above
 * the trip that said everything - a banking-app convention on a screen whose
 * subject is a photograph of somewhere else. Identity already lives in the
 * account button; the first line orients instead.
 *
 * It is deliberately not a heading. The page's heading is the line beneath it,
 * which says what the traveller's moment is - that is what the page is about.
 */
export function HomeNowStrip() {
  return <HomeNowStripContent {...useHereWeather()} />;
}

export function HomeNowStripContent({
  status,
  weather,
}: Readonly<ReturnType<typeof useHereWeather>>) {
  const t = useTranslations('home');
  const conditionT = useTranslations('tripMode.views.weather');
  const { preferences } = usePreferences();
  const evidenceDescription = useWeatherEvidenceDescription();

  const condition = weather?.kind === 'current' ? weather.current : weather?.forecast;
  const Icon = condition ? weatherConditionIcon(condition.weatherCode) : null;
  const unit = conditionT(`unit.${preferences.temperatureUnit}`);
  const temperature = (value: number) => `${Math.round(value)}${unit}`;
  const valueLabel =
    weather?.kind === 'current'
      ? temperature(weather.current.temperature)
      : weather
        ? // Today's high is useful for planning when no fresh current reading exists.
          temperature(weather.forecast.temperatureMax)
        : '';
  const evidence = weather
    ? evidenceDescription(
        weather.kind === 'current'
          ? { kind: 'current', timeZone: weather.timeZone, observedAt: weather.current.observedAt }
          : {
              kind: 'forecast',
              timeZone: weather.timeZone,
              date: weather.forecast.date,
              fetchedAt: weather.fetchedAt,
            },
      )
    : '';

  return (
    // The floating Search/Account stack is pinned to the top right of every
    // signed-in viewport, and on mobile it has no header to sit in.
    <div className="flex min-h-6 items-center pe-[3.25rem] text-sm sm:pe-0">
      {status === 'loading' ? (
        <Skeleton aria-label={t('weather.loading')} className="h-5 w-32" role="status" />
      ) : null}

      {/* The icon's condition and weather evidence stay in the link's accessible name. */}
      {weather && condition && Icon ? (
        <a
          // Without a city the sentence has nothing to be "in", so it drops
          // the clause rather than standing in something that is not a place.
          aria-label={`${conditionT(weather.city ? 'readingLabelWithPlace' : 'readingLabel', {
            condition: conditionT(`condition.${weatherConditionKey(condition.weatherCode)}`),
            place: weather.city ?? '',
            source: weather.attribution.label,
            temperature: valueLabel,
          })}. ${evidence}`}
          className="flex min-w-0 items-center gap-2 rounded-[var(--radius-sm)] outline-none transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none"
          href={weather.attribution.url}
          rel="noreferrer"
          target="_blank"
          title={`${weather.attribution.label} · ${evidence}`}
        >
          <Icon aria-hidden="true" className="size-5 shrink-0 text-brand" />
          {weather.city ? (
            <span aria-hidden="true" className="truncate font-medium text-foreground">
              {weather.city}
            </span>
          ) : null}
          <span aria-hidden="true" className="shrink-0 text-muted-foreground tabular-nums">
            {valueLabel}
          </span>
        </a>
      ) : null}
    </div>
  );
}
