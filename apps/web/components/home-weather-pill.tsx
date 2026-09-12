'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { usePreferences } from '@/components/preferences-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { selectHomeWeatherReading, type HomeWeatherTarget } from '@/lib/home/weather';
import { weatherConditionIcon, weatherConditionKey } from '@/lib/weather/conditions';
import { isCurrentReadingStale, useTripWeather } from '@/lib/weather/use-trip-weather';

const pillClassName =
  'inline-flex shrink-0 items-center gap-2.5 rounded-full border border-border-subtle bg-surface-raised py-1.5 pr-3.5 pl-2.5 shadow-[var(--shadow-control)] outline-none transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none';

export type HomeWeatherPillProps = {
  /**
   * Where the reading is for.
   *
   * Home derives it from the trip rather than from the forecast, because no
   * layer of the weather contract carries a name - not `TripWeather`, not the
   * target, and not Open-Meteo's own forecast response, which returns
   * coordinates and a zone. The trip's first located destination is the same
   * place the server measured, so the two agree by construction; a forecast day
   * whose itinerary resolved to some other base is still labelled with the
   * trip's destination, which is the one seam in this.
   */
  locationLabel: string | null;
  target: HomeWeatherTarget;
};

/**
 * The trip's weather at a glance, for the top of Home.
 *
 * Where it is and how warm, and nothing else. The condition survives as the
 * icon and in the accessible name - `conditions.ts` is explicit that the icon
 * carries no meaning on its own and every use has to pair it with the label,
 * so dropping the visible word means the label moves rather than disappears.
 *
 * The whole pill is the Open-Meteo link. The reading is theirs, and a component
 * this size has no room for a third line of credit, so the credit travels in
 * the link's accessible name and its tooltip instead of as visible text.
 *
 * Weather is supplementary here, so a failure renders nothing rather than
 * putting an error and a retry button beside a greeting - the same judgement
 * Home already makes about a Trip Mode context that would not load.
 */
export function HomeWeatherPill({ locationLabel, target }: Readonly<HomeWeatherPillProps>) {
  const t = useTranslations('home.weather');
  const conditionT = useTranslations('tripMode.views.weather');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const { data, dataUpdatedAt, status } = useTripWeather(target.tripId);

  // An answer read off disk stops being "now" the moment it outlives its
  // window, but it is still the best forecast this trip has.
  const stale = isCurrentReadingStale(dataUpdatedAt);
  const reading = useMemo(
    () => (data ? selectHomeWeatherReading(data, target, new Date(), !stale) : null),
    [data, stale, target],
  );

  if (status === 'loading') return <HomeWeatherPillSkeleton label={t('loading')} />;
  if (status === 'error' || !data) return null;

  const temperature =
    reading?.kind === 'current'
      ? reading.reading.temperature
      : reading?.kind === 'forecast'
        ? reading.reading.temperatureMax
        : null;
  const weatherCode = reading?.reading?.weatherCode;
  if (temperature === null || weatherCode === undefined) return null;

  const Icon = weatherConditionIcon(weatherCode);
  const condition = conditionT(`condition.${weatherConditionKey(weatherCode)}`);
  const unit = conditionT(`unit.${preferences.temperatureUnit}`);
  const value = `${Math.round(temperature)}${unit}`;
  /**
   * A trip with no destination yet has no place to name, so the top line says
   * what the sky is doing instead. Both are true things about the reading; the
   * trip's own name is not one, and a line shaped like a place has to be one.
   */
  const place = locationLabel?.trim();
  const heading = place || condition;
  // The day the reading is actually about, which is not always the day asked
  // for: a first day the itinerary cannot place borrows the soonest one it can.
  const formattedDate = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${reading?.date ?? target.date}T00:00:00.000Z`));

  return (
    <a
      // Without a place the sentence has nothing to be "for", so it drops the
      // clause rather than standing in something that is not a location.
      aria-label={t(place ? 'pillLabel' : 'pillLabelNoPlace', {
        condition,
        place: place ?? '',
        source: data.attribution.label,
        temperature: value,
        when: reading?.kind === 'current' ? t('current') : t('forecast', { date: formattedDate }),
      })}
      className={pillClassName}
      href={data.attribution.url}
      rel="noreferrer"
      target="_blank"
      title={data.attribution.label}
    >
      <Icon aria-hidden="true" className="size-6 shrink-0 text-brand" />
      <span aria-hidden="true" className="flex min-w-0 flex-col items-start leading-tight">
        <span className="max-w-24 truncate text-sm font-semibold text-foreground sm:max-w-40">
          {heading}
        </span>
        <span className="text-[length:var(--text-metadata)] text-muted-foreground tabular-nums">
          {value}
        </span>
      </span>
    </a>
  );
}

/** The pill's shape, held while the reading is on its way. */
export function HomeWeatherPillSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <div aria-busy="true" aria-label={label} className={pillClassName} role="status">
      <Skeleton className="size-6 shrink-0 rounded-full" />
      <span className="flex flex-col items-start gap-1">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3 w-10" />
      </span>
    </div>
  );
}
