'use client';

import type { TripOverviewData } from '@trove/types';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRef } from 'react';

import { ExperienceRatingMark } from '@/components/experience-rating';
import { TripCountries } from '@/components/trip-countries';
import { TripDaySegments } from '@/components/trip-day-segments';
import { TripMedia } from '@/components/trip-media';
import { TripStatusBadge } from '@/components/trip-status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { forgetCachedMediaUrls } from '@/lib/media/storage-cache-key';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
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
    return <TripDaySegments className="mt-3" day={day} total={total} />;
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
  layout = 'hub',
  onCoverExpired,
  overview,
  stage,
  trip,
}: Readonly<{
  editorial: EditorialImageReference | null;
  layout?: 'hub' | 'section';
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

  return (
    <section
      aria-labelledby="trip-detail-heading"
      className={cn(
        'relative isolate flex min-h-[var(--trip-cover-height)] flex-col justify-end overflow-hidden bg-surface-media [--trip-cover-height:clamp(27rem,118vw,34rem)] lg:min-h-[33rem] lg:rounded-[var(--radius-2xl)]',
        layout === 'hub' ? 'lg:h-full' : 'lg:[--trip-cover-height:33rem]',
      )}
      data-slot="trip-hub-cover"
    >
      <TripMedia
        alt={editorial ? media('alt.tripEditorial', { name: destinations ?? trip.name }) : ''}
        className="absolute inset-0 h-full w-full rounded-none"
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
        sizes={
          layout === 'hub'
            ? '(max-width: 1023px) 100vw, 720px'
            : '(max-width: 1023px) 100vw, 1024px'
        }
        source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
        variant="cover"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(8,18,13,0.5)_0%,transparent_22%,transparent_36%,rgba(8,18,13,0.9)_100%)]"
      />
      <Link
        aria-label={t('backToTrips')}
        className="absolute top-[max(1rem,var(--safe-top))] left-[max(1rem,var(--safe-left))] z-10 grid size-11 place-items-center rounded-full border border-white/18 bg-neutral-950/50 text-white backdrop-blur-md outline-none transition-colors duration-[var(--motion-standard)] hover:bg-neutral-950/75 focus-visible:ring-3 focus-visible:ring-white/60 motion-reduce:transition-none"
        href="/trips"
      >
        <ArrowLeft aria-hidden="true" className="size-5" />
      </Link>
      <div
        className={cn(
          'relative flex flex-col items-start gap-2 px-[var(--gutter-inline-start)] pt-24 pb-14 text-white lg:px-9',
          layout === 'hub' ? 'lg:pb-9' : 'lg:pb-14',
        )}
      >
        <TripStatusBadge
          lifecycle={trip.lifecycle}
          readiness={trip.planningReadiness}
          tone="onMedia"
        />
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
      </div>
    </section>
  );
}

/** Reserve the photograph and identity before the shared trip data arrives. */
export function TripHubCoverSkeleton({
  label,
  layout = 'hub',
}: Readonly<{ label: string; layout?: 'hub' | 'section' }>) {
  return (
    <div aria-busy="true" aria-live="polite" className="relative" role="status">
      <span className="sr-only">{label}</span>
      <Skeleton
        className={cn(
          'h-[clamp(27rem,118vw,34rem)] rounded-none lg:min-h-[33rem] lg:rounded-[var(--radius-2xl)]',
          layout === 'hub' ? 'lg:h-full' : 'lg:h-[33rem]',
        )}
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 space-y-3 px-[var(--gutter-inline-start)] pb-14 lg:px-9"
      >
        <Skeleton className="h-6 w-28 rounded-full bg-white/20" />
        <Skeleton className="h-9 w-4/5 bg-white/20" />
        <Skeleton className="h-4 w-2/5 bg-white/20" />
      </div>
    </div>
  );
}
