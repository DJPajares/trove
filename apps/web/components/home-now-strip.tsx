'use client';

import { useLocale, useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { useHereWeather } from '@/lib/home/use-here-weather';
import { weatherConditionIcon, weatherConditionKey } from '@/lib/weather/conditions';

/**
 * Where the traveller is, and when.
 *
 * This replaced a greeting. "Hi, <name>" spent the first line of the product
 * telling the reader their own name, and it put an `h1` that said nothing above
 * the trip that said everything - a banking-app convention on a screen whose
 * subject is a photograph of somewhere else. Identity already lives in the
 * account button; the first line orients instead.
 *
 * It is deliberately not a heading. The page's heading is the trip, one section
 * down, which is what the page is actually about.
 */
export function HomeNowStrip() {
  const t = useTranslations('home');
  const conditionT = useTranslations('tripMode.views.weather');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const { status, weather } = useHereWeather();

  const today = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    weekday: 'short',
  }).format(new Date());

  const Icon = weather ? weatherConditionIcon(weather.condition) : null;
  const unit = conditionT(`unit.${preferences.temperatureUnit}`);

  return (
    // The floating Search/Account stack is pinned to the top right of every
    // signed-in viewport, and on mobile it has no header to sit in.
    <div className="flex min-h-6 flex-wrap items-center gap-x-2.5 gap-y-1 pe-[3.25rem] text-sm sm:pe-0">
      {status === 'loading' ? (
        <Skeleton aria-label={t('weather.loading')} className="h-5 w-32" role="status" />
      ) : null}

      {weather && Icon ? (
        <>
          {/* The reading is the link to where it came from. `conditions.ts` is
              explicit that the icon carries no meaning on its own, so the
              condition rides in the accessible name alongside the credit the
              visible label used to carry. */}
          <a
            // Without a city the sentence has nothing to be "in", so it drops
            // the clause rather than standing in something that is not a place.
            aria-label={conditionT(weather.city ? 'readingLabelWithPlace' : 'readingLabel', {
              condition: conditionT(`condition.${weatherConditionKey(weather.condition)}`),
              place: weather.city ?? '',
              source: weather.attribution.label,
              temperature: `${Math.round(weather.temperature)}${unit}`,
            })}
            className="flex items-center gap-2 rounded-[var(--radius-sm)] outline-none transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none"
            href={weather.attribution.url}
            rel="noreferrer"
            target="_blank"
            title={weather.attribution.label}
          >
            <Icon aria-hidden="true" className="size-5 shrink-0 text-brand" />
            {weather.city ? (
              <span aria-hidden="true" className="font-semibold text-foreground">
                {weather.city}
              </span>
            ) : null}
            <span aria-hidden="true" className="text-muted-foreground tabular-nums">
              {Math.round(weather.temperature)}
              {unit}
            </span>
          </a>
          <span aria-hidden="true" className="text-border-strong">
            ·
          </span>
        </>
      ) : null}

      <p className="text-muted-foreground tabular-nums">{today}</p>
    </div>
  );
}
