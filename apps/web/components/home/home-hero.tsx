'use client';

import { useLocale, useTranslations } from 'next-intl';

import { HOME_COVER_FRAME, HomeHeadline } from '@/components/home/home-front-door';
import { HomeNowStrip } from '@/components/home-now-strip';
import { MediaFrame } from '@/components/media-frame';
import { TripCountries } from '@/components/trip-countries';
import { TripDaySegments } from '@/components/trip-day-segments';
import { TripMedia } from '@/components/trip-media';
import { TripReadinessBadge } from '@/components/trip-readiness-badge';
import { dayHeaderFallback } from '@/lib/media/day-header-fallback';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import type { Trip } from '@/lib/trips/api';
import { tripDayCount } from '@/lib/trips/facts';
import { formatTripDateRange } from '@/lib/trips/format';
import { tripDayProgress } from '@/lib/trips/library';
import { tripDestinationSummary } from '@/lib/trips/summary';
import { cn } from '@/lib/utils';

/**
 * Home's cover: the photograph of where the traveller is going, with the
 * page's one sentence about right now set on it.
 *
 * With a lead trip it is that trip's own cover or editorial photograph, and
 * the trip's name in the headline opens the trip from anywhere on the
 * photograph. With none it is Trove's bundled artwork: there is no subject to
 * ask a photograph of, and nothing here should cost a request.
 */
export function HomeCover({
  editorial,
  headline,
  trip,
}: Readonly<{
  editorial: EditorialImageReference | null;
  headline: { lead: string; subject: string };
  trip: Trip | null;
}>) {
  const t = useTranslations('home.hero');
  const tripsT = useTranslations('trips');
  const itineraryT = useTranslations('itinerary');
  const mediaT = useTranslations('media');
  const locale = useLocale();
  const active = trip?.lifecycle === 'active';

  return (
    <section
      aria-labelledby="home-heading"
      className={cn(
        'relative isolate flex flex-col justify-end overflow-hidden bg-surface-media text-white',
        HOME_COVER_FRAME,
      )}
      data-slot="home-cover"
    >
      {trip ? (
        <TripMedia
          alt={
            editorial
              ? mediaT('alt.tripEditorial', { name: tripDestinationSummary(trip) ?? trip.name })
              : ''
          }
          className="absolute inset-0 -z-20 h-full w-full rounded-none"
          preload
          sizes="(max-width: 1023px) 100vw, 64rem"
          source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
          variant="card"
        />
      ) : (
        <MediaFrame
          alt=""
          className="absolute inset-0 -z-20 h-full w-full rounded-none"
          dataSlot="home-cover-artwork"
          photographicPlaceholder={dayHeaderFallback.preview}
          preload
          sizes="(max-width: 1023px) 100vw, 64rem"
          source={{ kind: 'local', src: dayHeaderFallback.src }}
          variant="card"
        />
      )}
      {/* Fixed in both themes, so the headline never depends on the photograph. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(8,18,13,0.58)_0%,rgba(8,18,13,0.12)_26%,rgba(8,18,13,0.4)_56%,rgba(8,18,13,0.9)_100%)]"
      />

      {/* Above the headline's stretched link, so the weather source stays its own link. */}
      <div className="absolute inset-x-0 top-0 z-10 ps-[var(--gutter-inline-start)] pe-[var(--gutter-inline-end)] pt-[calc(var(--safe-top)+0.75rem)] md:p-6 lg:px-10">
        <HomeNowStrip tone="onMedia" />
      </div>

      {/* The sheet below overlaps the photograph on mobile, hence the deeper foot. */}
      <div className="space-y-3 ps-[var(--gutter-inline-start)] pe-[var(--gutter-inline-end)] pt-28 pb-14 md:p-8 lg:p-10">
        {trip ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-flex items-center gap-2 text-[length:var(--text-metadata)] font-semibold tracking-[0.12em] text-white/80 uppercase">
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
        ) : null}

        <HomeHeadline
          href={trip ? `/trips/${trip.id}` : undefined}
          lead={headline.lead}
          subject={headline.subject}
        />

        {trip ? (
          <div className="space-y-3">
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
        ) : null}
      </div>
    </section>
  );
}
