'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { TripCountries } from '@/components/trip-countries';
import { TripDaySegments } from '@/components/trip-day-segments';
import { TripDestinationActions } from '@/components/trip-destination-actions';
import { TripMedia } from '@/components/trip-media';
import { TripReadinessBadge } from '@/components/trip-readiness-badge';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import type { Trip } from '@/lib/trips/api';
import { tripDayCount } from '@/lib/trips/facts';
import { formatTripDateRange } from '@/lib/trips/format';
import { tripDayProgress } from '@/lib/trips/library';
import { primaryTripDestinations, withLiveTripModeFirst } from '@/lib/trips/navigation';
import { tripDestinationSummary } from '@/lib/trips/summary';

/**
 * The lead trip's photograph and the way into it.
 *
 * The trip's name is already the page's heading, said above in Home's own
 * voice, so the photograph carries only what the eye wants from it - where,
 * when, and for a trip under way how far in - and the actions sit beneath it
 * on the page, in the page's own ink. The whole photograph opens the trip.
 */
export function HomeHero({
  editorial,
  trip,
}: Readonly<{ editorial: EditorialImageReference | null; trip: Trip }>) {
  const t = useTranslations('home.hero');
  const tripsT = useTranslations('trips');
  const homeT = useTranslations('home');
  const itineraryT = useTranslations('itinerary');
  const mediaT = useTranslations('media');
  const locale = useLocale();
  const subject = tripDestinationSummary(trip) ?? trip.name;
  const active = trip.lifecycle === 'active';
  const completed = trip.lifecycle === 'completed';

  return (
    <div className="space-y-5" data-slot="home-hero">
      <Link
        aria-label={t('openTrip', { name: trip.name })}
        className="group relative isolate block overflow-hidden rounded-[var(--radius-2xl)] bg-surface-media text-white shadow-[var(--shadow-elevated)] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        href={`/trips/${trip.id}`}
      >
        <TripMedia
          alt={editorial ? mediaT('alt.tripEditorial', { name: subject }) : ''}
          className="aspect-[5/4] w-full rounded-none transition-transform duration-[var(--motion-slow)] ease-[var(--ease-standard)] group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100 sm:aspect-[16/9] lg:aspect-[4/3]"
          preload
          sizes="(max-width: 1023px) 100vw, 36rem"
          source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
          variant="card"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,18,13,0.5)_0%,transparent_26%,transparent_52%,rgba(8,18,13,0.86)_100%)]"
        />

        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4 sm:p-5">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/18 bg-black/28 px-3 py-1.5 text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] uppercase backdrop-blur-md">
            {active ? (
              <span aria-hidden="true" className="relative flex size-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-primary-on-media/70 motion-reduce:animate-none" />
                <span className="relative size-2 rounded-full bg-primary-on-media" />
              </span>
            ) : null}
            {t(`kicker.${trip.lifecycle}`)}
          </span>
          <TripReadinessBadge
            lifecycle={trip.lifecycle}
            readiness={trip.planningReadiness}
            tone="onMedia"
          />
        </div>

        <div className="absolute inset-x-0 bottom-0 space-y-3 p-4 sm:p-5">
          {active ? (
            <TripDaySegments
              className="max-w-xs"
              day={tripDayProgress(trip).day}
              total={tripDayCount(trip)}
            />
          ) : null}
          <div className="space-y-1">
            {trip.countries?.length ? (
              <TripCountries
                className="block truncate text-[length:var(--text-metadata)] font-semibold tracking-[0.12em] text-white/85 uppercase"
                countries={trip.countries}
              />
            ) : null}
            <p className="text-sm font-medium text-white/90 tabular-nums">
              {formatTripDateRange(trip.startDate, trip.endDate, locale)}
              <span aria-hidden="true"> · </span>
              {itineraryT('dayCount', { count: tripDayCount(trip) })}
              {trip.partySize > 1 ? (
                <>
                  <span aria-hidden="true"> · </span>
                  {tripsT('travellerCount', { count: trip.partySize })}
                </>
              ) : null}
            </p>
          </div>
        </div>
      </Link>

      <TripDestinationActions
        destinations={withLiveTripModeFirst(
          primaryTripDestinations(trip.id, trip.lifecycle, trip.startDate),
          trip.lifecycle,
        )}
        labelOverrides={
          completed
            ? { memories: homeT('viewMemories') }
            : {
                itinerary: homeT('continuePlanning'),
                // A trip under way is carried on with, not started again; one
                // that has not left yet is honestly offering a preview.
                mode: homeT(active ? 'continueTrip' : 'previewTripMode'),
              }
        }
      />
    </div>
  );
}
