'use client';

import { ArrowUpRight, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRef } from 'react';
import type { TripOverviewData, TripOverviewStop } from '@trove/types';
import { ExperienceRatingSummary } from '@/components/experience-rating';
import { forgetCachedMediaUrls } from '@/lib/media/storage-cache-key';
import { MediaFrame } from '@/components/media-frame';
import { buttonVariants, Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  canDecodeHeic,
  isHeicContentType,
  shouldRefreshSignedMedia,
} from '@/lib/memories/signed-media';
import { calendarDayDistance, daysUntilTripStart } from '@/lib/trips/lifecycle';
import { formatTripDate } from '@/lib/trips/format';
import { overviewPlannerHref } from '@/lib/trips/overview';
import { tripOverviewDestinations } from '@/lib/trips/navigation';
import { cn } from '@/lib/utils';
import type { Trip } from '@/lib/trips/api';

function StopLine({ stop, clockTimeZone }: { stop: TripOverviewStop; clockTimeZone: string }) {
  const t = useTranslations('trips.hub');
  const locale = useLocale();
  const time = stop.startInstant
    ? new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: clockTimeZone,
      }).format(new Date(stop.startInstant))
    : stop.localStartTime;
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="w-14 shrink-0 text-[length:var(--text-metadata)] text-text-subtle">
        {t(`stopKind.${stop.kind}`)}
      </span>
      <span className="min-w-0 flex-1 text-pretty font-medium">
        {stop.label ?? t('unnamedStop')}
      </span>
      {time ? (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{time}</span>
      ) : null}
    </div>
  );
}

/** One current chapter, not a second itinerary. All detail opens in its own experience. */
export function TripHubChapter({
  trip,
  overview,
  loading,
  failed,
  onRetry,
}: {
  trip: Trip;
  overview: TripOverviewData | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('trips.hub');
  const locale = useLocale();
  const ratingT = useTranslations('experienceRating');
  const lastRefreshAt = useRef<number | null>(null);
  const now = overview ? new Date(overview.generatedAt) : new Date();
  const soon = trip.lifecycle === 'planning' && daysUntilTripStart(trip, now) <= 7;
  const destinations = tripOverviewDestinations(trip.id, trip.lifecycle, trip.startDate);
  const day = overview?.day;
  const totalDays = calendarDayDistance(trip.startDate, trip.endDate) + 1;
  const href =
    trip.lifecycle === 'planning'
      ? overviewPlannerHref(trip.id, day?.id ?? null)
      : destinations.primary.href;
  const photos = (overview?.memories.photos ?? []).filter(
    (photo) => canDecodeHeic() || !isHeicContentType(photo.contentType),
  );
  const reflection = trip.experienceNote?.trim() || overview?.memories.note?.trim();
  const hasStory = Boolean(
    trip.memoryCount || trip.hasStoryContent || overview?.memories.note || photos.length,
  );
  return (
    <section
      aria-labelledby="trip-chapter-heading"
      className="flex min-w-0 flex-col px-5 py-6 md:px-7 md:py-7"
    >
      <p className="text-[length:var(--text-metadata)] font-semibold tracking-[0.12em] text-brand uppercase">
        {t(
          trip.lifecycle === 'completed'
            ? 'chapter.remember'
            : trip.lifecycle === 'active'
              ? 'chapter.live'
              : soon
                ? 'chapter.soon'
                : 'chapter.plan',
        )}
      </p>
      {trip.lifecycle === 'completed' ? (
        <>
          <h2
            className="mt-2 font-serif text-2xl leading-tight text-balance"
            id="trip-chapter-heading"
          >
            {t(hasStory ? 'rememberTitle' : 'rememberEmptyTitle')}
          </h2>
          {photos.length ? (
            <div aria-label={t('memoryPreview')} className="mt-5 flex max-w-80 gap-3 pb-2">
              {photos.map((photo, index) => (
                <Link
                  aria-label={t('openMemories')}
                  className={`min-w-0 flex-1 rounded-sm bg-paper-print p-1.5 pb-5 shadow-[var(--shadow-print)] outline-none transition-transform duration-[var(--motion-standard)] hover:-translate-y-1 focus-visible:ring-3 focus-visible:ring-ring/40 ${index === 1 ? 'rotate-3' : index === 0 ? '-rotate-3' : '-rotate-1'}`}
                  href={`/trips/${trip.id}/memories`}
                  key={photo.id}
                >
                  <MediaFrame
                    alt=""
                    className="aspect-[4/5] rounded-[1px]"
                    dataSlot="trip-hub-memory"
                    onUnreachable={() => {
                      const now = Date.now();
                      if (
                        shouldRefreshSignedMedia({
                          canDecodeHeic: canDecodeHeic(),
                          contentType: photo.contentType,
                          lastRefreshAt: lastRefreshAt.current,
                          now,
                          online: navigator.onLine,
                          url: photo.url,
                        })
                      ) {
                        lastRefreshAt.current = now;
                        void forgetCachedMediaUrls([photo.url]).finally(onRetry);
                      }
                    }}
                    sizes="(max-width: 767px) 120px, 160px"
                    source={{ kind: 'memory', url: photo.url }}
                    variant="card"
                  />
                </Link>
              ))}
            </div>
          ) : null}
          {reflection ? (
            <blockquote className="mt-4 line-clamp-3 font-serif text-lg leading-relaxed text-muted-foreground">
              {reflection}
            </blockquote>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {t(hasStory ? 'rememberBody' : 'rememberEmptyBody')}
            </p>
          )}
          {trip.experienceRating !== null ? (
            <div className="mt-3">
              <ExperienceRatingSummary
                label={ratingT('summaryLabel')}
                rating={trip.experienceRating}
              />
            </div>
          ) : null}
        </>
      ) : (
        <>
          <h2
            className="mt-2 text-2xl leading-tight font-semibold tracking-tight text-balance break-words"
            id="trip-chapter-heading"
          >
            {trip.lifecycle === 'active'
              ? day
                ? t('todayTitle', { number: day.number, total: totalDays })
                : t('liveTitle')
              : soon
                ? t('startsIn', { count: daysUntilTripStart(trip, now) })
                : t('planTitle')}
          </h2>
          {loading ? (
            <div aria-busy="true" aria-label={t('loading')} className="mt-4 space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : day ? (
            <div className="mt-3">
              <p className="text-base font-medium text-balance break-words">
                {day.name ?? t('dayName', { number: day.number })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatTripDate(day.date, locale)}
              </p>
              {trip.lifecycle === 'planning' ? (
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {day.state === 'empty' ? t('openDay') : t('plannedDay', { count: day.stopCount })}
                </p>
              ) : null}
              <div className="mt-3 space-y-2">
                {day.current ? (
                  <StopLine clockTimeZone={overview!.clockTimeZone} stop={day.current} />
                ) : null}
                {day.next ? (
                  <StopLine clockTimeZone={overview!.clockTimeZone} stop={day.next} />
                ) : null}
                {trip.lifecycle === 'active' && !day.current && !day.next ? (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t(day.state === 'empty' ? 'todayEmpty' : 'todayFinished')}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {t(trip.lifecycle === 'active' ? 'noDay' : 'planBody')}
            </p>
          )}
          {trip.lifecycle === 'planning' && trip.itineraryCoverage ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {t('coverage', {
                planned: trip.itineraryCoverage.plannedDays,
                total: trip.itineraryCoverage.totalDays,
              })}
            </p>
          ) : null}
        </>
      )}
      {failed ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          {t('unavailable')}
          <Button onClick={onRetry} size="sm" variant="ghost">
            {t('retry')}
          </Button>
        </div>
      ) : null}
      <div className="pt-5 md:mt-auto">
        <Link
          className={cn(
            buttonVariants({ size: 'lg' }),
            'h-auto min-h-11 w-full py-3 whitespace-normal',
          )}
          data-slot="trip-overview-primary-action"
          href={href}
        >
          <span className="min-w-0">
            {t(
              trip.lifecycle === 'completed'
                ? 'openMemories'
                : trip.lifecycle === 'active'
                  ? 'continueTrip'
                  : soon
                    ? 'reviewItinerary'
                    : 'continuePlanning',
            )}
          </span>
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </section>
  );
}

export function TripHubExperienceLinks({ trip }: { trip: Trip }) {
  const t = useTranslations('trips');
  const destinations = tripOverviewDestinations(trip.id, trip.lifecycle, trip.startDate);
  return (
    <nav
      aria-label={t('tripExperiences')}
      className="grid grid-cols-2 gap-x-6 border-b border-border-subtle pb-5 sm:gap-x-10"
    >
      {destinations.secondary.map((destination) => (
        <Link
          className="group min-w-0 rounded-sm py-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          data-slot="trip-overview-secondary-action"
          href={destination.href}
          key={destination.section}
        >
          <span className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
            {t(destination.displayLabelKey)}
            <ChevronRight
              aria-hidden="true"
              className="size-4 shrink-0 text-text-subtle transition-transform duration-[var(--motion-standard)] group-hover:translate-x-0.5"
            />
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {t(`experienceDescription.${destination.descriptionKey}`)}
          </span>
        </Link>
      ))}
    </nav>
  );
}
