'use client';

import type { TripOverviewData } from '@trove/types';
import { ArrowLeft, CopyPlus } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRef } from 'react';

import { ExperienceRatingMark } from '@/components/experience-rating';
import { TripCountries } from '@/components/trip-countries';
import { TripDaySegments } from '@/components/trip-day-segments';
import { TripMedia } from '@/components/trip-media';
import { TripArchivedBadge } from '@/components/trip-archive-control';
import { TripStatusBadge } from '@/components/trip-status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { forgetCachedMediaUrls } from '@/lib/media/storage-cache-key';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import { useCoverUnderHeader } from '@/hooks/use-cover-under-header';
import { pageEntrance } from '@/lib/page-entrance';
import { shouldRefreshSignedMedia } from '@/lib/memories/signed-media';
import type { Trip } from '@/lib/trips/api';
import { formatTripDate, formatTripDateRange } from '@/lib/trips/format';
import { tripDayProgress } from '@/lib/trips/library';
import { calendarDayDistance, daysUntilTripStart } from '@/lib/trips/lifecycle';
import type { TripHubStage } from '@/lib/trips/overview';
import { tripDestinationSummary } from '@/lib/trips/summary';
import { cn } from '@/lib/utils';

/** Beyond this a segment per day stops reading as days. */
const MAX_COVERAGE_SEGMENTS = 21;

/**
 * The line under the trip's name that says where it stands: which days have a
 * plan, how long until it starts, which day it is, or how it was remembered.
 * Each is a fact the trip already holds; none is a score.
 */
function CoverSignature({
  overview,
  stage,
  trip,
}: Readonly<{ overview: TripOverviewData | undefined; stage: TripHubStage; trip: Trip }>) {
  const t = useTranslations('trips.hub');
  const rating = useTranslations('experienceRating');
  const locale = useLocale();

  if (stage === 'live') {
    const { day, total } = tripDayProgress(trip);
    return <TripDaySegments className="mt-3" day={day} reveal total={total} />;
  }

  if (stage === 'soon') {
    const days = daysUntilTripStart(trip);
    return (
      <div className="mt-3 flex w-full items-end justify-between gap-4 border-t border-white/22 pt-3.5">
        <p className="flex items-baseline gap-2">
          {days > 0 ? (
            <span className="text-[3.75rem] leading-[0.8] font-semibold tracking-[-0.06em] tabular-nums">
              {String(days).padStart(2, '0')}
            </span>
          ) : null}
          <span className="text-sm font-medium text-white/88">
            {t('countdownLabel', { count: days })}
          </span>
        </p>
        <p className="shrink-0 text-right text-xs leading-snug text-white/80">
          {t('departs')}
          <span className="block text-sm font-semibold text-white">
            {formatTripDate(trip.startDate, locale)}
          </span>
        </p>
      </div>
    );
  }

  if (stage === 'remember') {
    return trip.experienceRating === null ? null : (
      <p className="mt-3 flex w-full items-center border-t border-white/22 pt-3.5">
        <span className="sr-only">{rating('summaryLabel')}</span>
        <ExperienceRatingMark
          className="gap-3"
          rating={trip.experienceRating}
          tone="onImage"
          wordClassName="font-journal text-2xl leading-none font-normal italic"
        />
      </p>
    );
  }

  const days = overview?.days ?? [];
  const planned = overview
    ? days.filter((day) => day.stopCount).length
    : (trip.itineraryCoverage?.plannedDays ?? 0);
  const total =
    trip.itineraryCoverage?.totalDays ?? calendarDayDistance(trip.startDate, trip.endDate) + 1;
  return (
    <div className="mt-3 flex w-full items-center gap-3">
      {days.length > MAX_COVERAGE_SEGMENTS ? (
        <span
          aria-hidden="true"
          className="block h-1 flex-1 overflow-hidden rounded-full bg-white/22"
        >
          <span
            className="block h-full rounded-full bg-white/85"
            style={{ width: `${total ? (planned / total) * 100 : 0}%` }}
          />
        </span>
      ) : days.length ? (
        <span aria-hidden="true" className="flex flex-1 gap-1">
          {days.map((day) => (
            <span
              className={cn(
                'h-1 flex-1 rounded-full',
                day.stopCount ? 'bg-white/85' : 'shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.55)]',
              )}
              key={day.id}
            />
          ))}
        </span>
      ) : null}
      <span className="shrink-0 text-xs font-semibold text-white/90 tabular-nums">
        {t('coverage', { planned, total })}
      </span>
    </div>
  );
}

/**
 * The trip's identity, set on its own photograph: the same cover at every
 * stage, with only the line under the name changing as the journey moves.
 */
export function TripHubCover({
  editorial,
  enter = false,
  onCoverExpired,
  overview,
  stage,
  trip,
}: Readonly<{
  editorial: EditorialImageReference | null;
  /** Settle and rise into place, as the first screen of a visit to the trip. */
  enter?: boolean;
  /** The signed cover link expired; the trip must be re-read for a fresh one. */
  onCoverExpired: () => void;
  overview: TripOverviewData | undefined;
  stage: TripHubStage;
  trip: Trip;
}>) {
  const t = useTranslations('trips');
  const hub = useTranslations('trips.hub');
  const media = useTranslations('media');
  const locale = useLocale();
  const lastCoverRefreshAt = useRef<number | null>(null);
  const destinations = tripDestinationSummary(trip);
  const totalDays = calendarDayDistance(trip.startDate, trip.endDate) + 1;
  // The cover runs beneath the header, which takes its ink meanwhile.
  useCoverUnderHeader();

  return (
    <section
      aria-labelledby="trip-detail-heading"
      className={cn(
        // Edge to edge at every size, beneath the header from `md`, as Home,
        // Trips and Finds are.
        'relative isolate flex min-h-[var(--trip-cover-height)] flex-col justify-end overflow-hidden bg-surface-media [--trip-cover-height:clamp(27rem,118vw,34rem)] md:min-h-[34rem] lg:min-h-[36rem]',
      )}
      data-slot="trip-hub-cover"
    >
      <TripMedia
        alt={editorial ? media('alt.tripEditorial', { name: destinations ?? trip.name }) : ''}
        className={cn('absolute inset-0 h-full w-full rounded-none', enter && pageEntrance.media)}
        fallbackSources={editorial ? [{ kind: 'editorial', reference: editorial }] : []}
        onUnreachable={() => {
          const now = Date.now();
          if (
            shouldRefreshSignedMedia({
              canDecodeHeic: true,
              contentType: null,
              lastRefreshAt: lastCoverRefreshAt.current,
              now,
              online: navigator.onLine,
              url: trip.coverPhotoUrl,
            })
          ) {
            lastCoverRefreshAt.current = now;
            void forgetCachedMediaUrls([trip.coverPhotoUrl]).finally(onCoverExpired);
          }
        }}
        preload
        sizes="100vw"
        source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
        variant="cover"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(8,18,13,0.5)_0%,transparent_22%,transparent_36%,rgba(8,18,13,0.9)_100%)]"
      />
      <Link
        aria-label={t('backToTrips')}
        className={cn(
          'absolute top-[max(1rem,var(--safe-top))] left-[max(1rem,var(--safe-left))] z-10 grid size-11 place-items-center rounded-full border border-white/18 bg-neutral-950/50 text-white backdrop-blur-md outline-none transition-colors duration-[var(--motion-standard)] hover:bg-neutral-950/75 focus-visible:ring-3 focus-visible:ring-white/60 motion-reduce:transition-none',
          // Beneath the header from `md`, so it waits below it.
          'md:top-[calc(var(--safe-top)+var(--header-height)+1.5rem)]',
        )}
        href="/trips"
      >
        <ArrowLeft aria-hidden="true" className="size-5" />
      </Link>
      <div
        className={cn(
          // Edge to edge, the words stay on the page's measure.
          'relative flex w-full flex-col items-start gap-2 px-[var(--gutter-inline-start)] pt-24 pb-14 text-white md:mx-auto md:max-w-[calc(64rem+var(--gutter-inline-start)+var(--gutter-inline-end))] md:pt-[calc(var(--safe-top)+var(--header-height)+5rem)] md:pb-20',
          enter && pageEntrance.rise,
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <TripStatusBadge
            lifecycle={trip.lifecycle}
            readiness={trip.planningReadiness}
            tone="onMedia"
          />
          {trip.archivedAt ? <TripArchivedBadge /> : null}
        </div>
        {trip.countries?.length ? (
          <TripCountries
            className="mt-2 text-xs font-semibold tracking-[0.12em] text-white/90 uppercase"
            countries={trip.countries}
          />
        ) : destinations ? (
          <p className="mt-2 text-xs font-semibold tracking-[0.12em] text-white/90 uppercase">
            {destinations}
          </p>
        ) : null}
        <h1
          className="max-w-[16ch] text-[length:var(--text-page-title)] leading-[1.03] font-semibold tracking-[-0.035em] text-balance break-words lg:max-w-[18ch] lg:text-[length:var(--text-immersive-title)]"
          id="trip-detail-heading"
        >
          {trip.name}
        </h1>
        <p className="text-sm text-white/88 tabular-nums">
          {formatTripDateRange(trip.startDate, trip.endDate, locale)}
          <span aria-hidden="true" className="px-1.5">
            ·
          </span>
          {hub('duration', { count: totalDays })}
        </p>
        <CoverSignature overview={overview} stage={stage} trip={trip} />
        {/* Always shown on a saved copy (PRD 8.1): the credit is not the
            traveller's to remove, and it names rather than links. */}
        {trip.basedOn ? (
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-white/80">
            <CopyPlus aria-hidden="true" className="size-3.5" />
            {trip.basedOn.creatorName
              ? t('basedOn', { name: trip.basedOn.creatorName })
              : t('basedOnAnonymous')}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** Reserve the photograph and identity before the shared trip data arrives. */
export function TripHubCoverSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <div aria-busy="true" aria-live="polite" className="relative" role="status">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-[clamp(27rem,118vw,34rem)] rounded-none md:h-[34rem] lg:h-[36rem]" />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 space-y-3 px-[var(--gutter-inline-start)] pb-14 md:mx-auto md:max-w-[calc(64rem+var(--gutter-inline-start)+var(--gutter-inline-end))] md:pb-20"
      >
        <Skeleton className="h-6 w-28 rounded-full bg-white/20" />
        <Skeleton className="h-9 w-4/5 bg-white/20" />
        <Skeleton className="h-4 w-2/5 bg-white/20" />
      </div>
    </div>
  );
}
