'use client';

import type { TripOverviewData } from '@trove/types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { MediaFrame } from '@/components/media-frame';
import { useTripPlacesDrawer } from '@/components/trip-places-provider';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { useEditorialImageResolution } from '@/hooks/use-editorial-images';
import * as Icons from '@/lib/icons';
import {
  editorialSubjectKey,
  primaryEditorialImage,
  type EditorialSubject,
} from '@/lib/media/editorial-images';
import type { Trip } from '@/lib/trips/api';
import { tripJourneyStops, type TripJourneyStop } from '@/lib/trips/journey';
import type { TripHubStage } from '@/lib/trips/overview';
import { cn } from '@/lib/utils';

function formatDay(date: string, locale: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function formatDayRange(start: string, end: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).formatRange(new Date(`${start}T00:00:00Z`), new Date(`${end}T00:00:00Z`));
}

/** A town as the journey's photography knows it: one subject per stop, shared with the chapter's postcard. */
export function journeyStopSubject(town: string, trip: Trip): EditorialSubject {
  const countryCode = trip.countries?.length === 1 ? trip.countries[0] : undefined;
  return { category: 'destination', context: { area: town, countryCode }, name: town };
}

/**
 * Decorative only: a town's editorial photograph. While it resolves the tile
 * waits rather than flashing a fallback; with none, the town's initial stands in.
 */
function StopThumbnail({
  current,
  images,
  pending,
  subject,
  travelled,
}: Readonly<{
  current: boolean;
  images: ReturnType<typeof useEditorialImageResolution>['images'];
  pending: boolean;
  subject: EditorialSubject;
  travelled: boolean;
}>) {
  const reference = primaryEditorialImage(images.get(editorialSubjectKey(subject)));
  const frame = cn(
    'size-16 shrink-0 rounded-[var(--radius-xl)]',
    current && 'ring-2 ring-brand ring-offset-2 ring-offset-background',
    travelled && 'opacity-70 saturate-[0.6]',
  );
  if (reference) {
    return (
      <MediaFrame
        alt=""
        className={frame}
        dataSlot="trip-journey-stop"
        sizes="64px"
        source={{ kind: 'editorial', reference }}
        variant="thumbnail"
      />
    );
  }
  if (pending) return <Skeleton aria-hidden="true" className={frame} />;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid place-items-center bg-surface-tint font-journal text-[1.75rem] leading-none text-brand',
        frame,
      )}
    >
      {Array.from(subject.name.trim())[0]?.toLocaleUpperCase() ?? (
        <Icons.Place className="size-5" />
      )}
    </span>
  );
}

function StopMarker({
  current,
  stage,
  stop,
}: Readonly<{ current: boolean; stage: TripHubStage; stop: TripJourneyStop }>) {
  const t = useTranslations('trips.hub');
  if (stage === 'live' && current) {
    return (
      <span className="inline-flex h-6 items-center rounded-full bg-brand px-2.5 text-xs font-semibold text-primary-foreground">
        {t('youAreHere')}
      </span>
    );
  }
  if ((stage === 'plan' || stage === 'soon') && stop.openDays) {
    return (
      <span className="inline-flex h-6 items-center rounded-full bg-accent/30 px-2.5 text-xs font-semibold text-accent-strong">
        {t('daysOpen', { count: stop.openDays })}
      </span>
    );
  }
  return null;
}

/**
 * The shape of the trip: where it goes and for how long, in order. Geographic
 * context only - no map, no distances - and every day a tap away underneath.
 */
export function TripHubJourney({
  overview,
  stage,
  trip,
}: Readonly<{ overview: TripOverviewData | undefined; stage: TripHubStage; trip: Trip }>) {
  const t = useTranslations('trips.hub');
  const locale = useLocale();
  const { openPlaces } = useTripPlacesDrawer();
  const [aboutOpen, setAboutOpen] = useState(false);
  const days = overview?.days ?? [];
  const stops = tripJourneyStops(days);
  // A trip whose days cannot be placed still has the destinations its traveller
  // named, in order. They lead with the place itself; the rest is its region.
  const destinations = stops.length
    ? []
    : (overview?.destinations ?? trip.destinations).flatMap((destination) => {
        const [title, ...rest] = (destination.name ?? '').split(',').map((part) => part.trim());
        return title ? [{ id: destination.id, region: rest.join(', '), title }] : [];
      });
  const subject = (name: string) => journeyStopSubject(name, trip);
  const subjects = stops.length
    ? stops.map((stop) => subject(stop.town))
    : destinations.map((destination) => subject(destination.title));
  const { images, status } = useEditorialImageResolution(subjects);
  const pending = status === 'pending';
  const focusDayId = stage === 'remember' ? null : (overview?.day?.id ?? null);
  const totalDays = days.length;
  // While travelling the route reads as lived up to here and still ahead after.
  const currentIndex =
    stage === 'live' && focusDayId
      ? stops.findIndex((stop) => stop.days.some((day) => day.id === focusDayId))
      : -1;

  return (
    <section
      aria-labelledby="trip-journey-heading"
      className="min-w-0"
      data-slot="trip-hub-journey"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          className="text-[length:var(--text-section-title)] leading-[1.18] font-semibold tracking-[-0.022em]"
          id="trip-journey-heading"
        >
          {t('routeTitle')}
        </h2>
        {stops.length && totalDays ? (
          <p className="text-sm text-muted-foreground tabular-nums">
            {t('journeySummary', { days: totalDays, stops: stops.length })}
          </p>
        ) : null}
      </div>

      {trip.description ? (
        <div className="mt-2 max-w-[var(--layout-reading)]">
          <p
            className={cn(
              'text-[0.9375rem] leading-relaxed whitespace-pre-wrap text-muted-foreground',
              !aboutOpen && 'line-clamp-2',
            )}
            id="trip-journey-about"
          >
            {trip.description}
          </p>
          {/* Two lines hold roughly this much; shorter words need no control. */}
          {trip.description.length > 120 || trip.description.includes('\n') ? (
            <button
              aria-controls="trip-journey-about"
              aria-expanded={aboutOpen}
              className="mt-1 inline-flex min-h-9 items-center rounded-[var(--radius-sm)] text-sm font-semibold text-brand outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
              onClick={() => setAboutOpen((open) => !open)}
              type="button"
            >
              {t(aboutOpen ? 'aboutLess' : 'aboutMore')}
            </button>
          ) : null}
        </div>
      ) : null}

      {stops.length ? (
        <ol aria-label={t('destinations')} className="mt-5">
          {stops.map((stop, index) => {
            const current = Boolean(focusDayId && stop.days.some((day) => day.id === focusDayId));
            const travelled = index < currentIndex;
            const last = index === stops.length - 1;
            const range =
              stop.firstNumber === stop.lastNumber
                ? t('dayRangeSingle', {
                    date: formatDay(stop.startDate, locale, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    }),
                    number: stop.firstNumber,
                  })
                : t('dayRange', {
                    dates: formatDayRange(stop.startDate, stop.endDate, locale),
                    first: stop.firstNumber,
                    last: stop.lastNumber,
                  });
            return (
              <li
                className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-3.5"
                key={stop.days[0]?.id ?? stop.town}
              >
                <div className="flex flex-col items-center">
                  <StopThumbnail
                    current={current}
                    images={images}
                    pending={pending}
                    subject={subjects[index]!}
                    travelled={travelled}
                  />
                  {last ? null : (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'my-1.5 min-h-5 w-0 flex-1 border-l-2',
                        stage === 'remember' || travelled
                          ? 'border-border-strong'
                          : 'border-dashed border-border-strong',
                      )}
                    />
                  )}
                </div>
                <Collapsible className={cn('min-w-0', !last && 'pb-5')} defaultOpen={current}>
                  <div className="flex items-start justify-between gap-2 pt-2.5">
                    <div className="min-w-0">
                      <p
                        className={cn(
                          'text-[1.0625rem] leading-snug font-semibold break-words',
                          travelled && 'text-muted-foreground',
                        )}
                      >
                        {stop.town}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{range}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <StopMarker current={current} stage={stage} stop={stop} />
                      <CollapsibleTrigger
                        aria-label={t('showDays', { town: stop.town })}
                        className="group grid size-11 place-items-center rounded-full hover:bg-surface-hover"
                      >
                        <ChevronDown
                          aria-hidden="true"
                          className="transition-transform duration-[var(--motion-standard)] group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
                        />
                      </CollapsibleTrigger>
                    </div>
                  </div>
                  <CollapsiblePanel>
                    <ul className="mt-2 border-t border-border-subtle">
                      {stop.days.map((day) => {
                        const today = stage === 'live' && day.id === focusDayId;
                        return (
                          <li
                            className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 border-b border-border-subtle py-2.5 text-sm last:border-b-0"
                            key={day.id}
                          >
                            <span
                              className={cn(
                                'font-semibold tabular-nums',
                                today ? 'text-brand' : 'text-muted-foreground',
                              )}
                            >
                              {today
                                ? t('todayShort')
                                : formatDay(day.date, locale, {
                                    weekday: 'short',
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                            </span>
                            <span className={cn('min-w-0 break-words', today && 'font-semibold')}>
                              {day.name ??
                                (day.stopCount
                                  ? t('plannedStops', { count: day.stopCount })
                                  : t('openDayTitle'))}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </CollapsiblePanel>
                </Collapsible>
              </li>
            );
          })}
        </ol>
      ) : destinations.length ? (
        <ol aria-label={t('destinations')} className="mt-5">
          {destinations.map((destination, index) => {
            const last = index === destinations.length - 1;
            return (
              <li className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-3.5" key={destination.id}>
                <div className="flex flex-col items-center">
                  <StopThumbnail
                    current={false}
                    images={images}
                    pending={pending}
                    subject={subjects[index]!}
                    travelled={false}
                  />
                  {last ? null : (
                    <span
                      aria-hidden="true"
                      className="my-1.5 min-h-5 w-0 flex-1 border-l-2 border-dashed border-border-strong"
                    />
                  )}
                </div>
                <div className={cn('min-w-0 pt-2.5', !last && 'pb-5')}>
                  <p className="text-[1.0625rem] leading-snug font-semibold break-words">
                    {destination.title}
                  </p>
                  {destination.region ? (
                    <p className="mt-0.5 text-sm text-muted-foreground">{destination.region}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      <button
        aria-haspopup="dialog"
        className="group -mx-2 mt-5 flex w-[calc(100%+1rem)] items-center gap-3.5 rounded-[var(--radius-xl)] p-2 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none md:max-w-md"
        data-trip-places-trigger
        onClick={openPlaces}
        type="button"
      >
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-surface-tint text-brand"
        >
          <Icons.Places className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">
            {t(stage === 'remember' ? 'placesRemembered' : 'placesToExplore')}
          </span>
          {overview ? (
            <span className="block text-sm text-muted-foreground">
              {t('placesCount', { count: overview.tripPlaceCount })}
            </span>
          ) : null}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-text-subtle transition-transform duration-[var(--motion-standard)] group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </button>
    </section>
  );
}
