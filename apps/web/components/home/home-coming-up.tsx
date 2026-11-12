'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { TripCountries } from '@/components/trip-countries';
import { TripMedia } from '@/components/trip-media';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import type { Trip } from '@/lib/trips/api';
import { tripDayCount } from '@/lib/trips/facts';
import { tripDayProgress } from '@/lib/trips/library';
import { daysUntilTripStart, resolveCountdown } from '@/lib/trips/lifecycle';
import { tripDestinationSummary } from '@/lib/trips/summary';

/**
 * The trips after the one Home leads with, each as its photograph with where
 * and how soon set on it: a rail to swipe on a phone, a row from `md`. Home only glances ahead - the calendar of
 * departures, with everything a trip needs, is the Trips library's.
 */
export function HomeComingUp({
  editorialFor,
  trips,
}: Readonly<{ editorialFor: (trip: Trip) => EditorialImageReference | null; trips: Trip[] }>) {
  const t = useTranslations('home.comingUp');
  const itineraryT = useTranslations('itinerary');
  const mediaT = useTranslations('media');
  const locale = useLocale();
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  return (
    <section
      aria-labelledby="home-coming-up-heading"
      className="space-y-4"
      data-slot="home-coming-up"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2
          className="text-[length:var(--text-section-title)] leading-[1.18] font-semibold tracking-[-0.022em] text-foreground"
          id="home-coming-up-heading"
        >
          {t('title')}
        </h2>
        <Link
          className="group inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] text-sm font-medium text-brand outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
          href="/trips"
        >
          {t('allTrips')}
          <ChevronRight
            aria-hidden="true"
            className="size-4 transition-transform duration-[var(--motion-standard)] group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        </Link>
      </div>

      <ul className="-ms-[var(--gutter-inline-start)] -me-[var(--gutter-inline-end)] flex snap-x gap-3 overflow-x-auto ps-[var(--gutter-inline-start)] pe-[var(--gutter-inline-end)] [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden">
        {trips.map((trip) => {
          const editorial = editorialFor(trip);
          const countdown = resolveCountdown(daysUntilTripStart(trip));
          const when =
            trip.lifecycle === 'active'
              ? t('underway', tripDayProgress(trip))
              : relative.format(countdown.value, countdown.unit);

          return (
            <li className="w-40 shrink-0 snap-start md:w-auto" key={trip.id}>
              <Link
                className="group relative isolate flex aspect-[3/4] flex-col justify-end overflow-hidden rounded-[var(--radius-2xl)] bg-surface-media p-3.5 text-white shadow-[var(--shadow-card)] outline-none transition-[box-shadow,transform] duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevated)] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transform-none motion-reduce:transition-none"
                href={`/trips/${trip.id}`}
              >
                <TripMedia
                  alt={
                    editorial
                      ? mediaT('alt.tripEditorial', {
                          name: tripDestinationSummary(trip) ?? trip.name,
                        })
                      : ''
                  }
                  className="absolute inset-0 -z-20 h-full w-full rounded-none"
                  sizes="(max-width: 767px) 160px, 20rem"
                  source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
                  variant="card"
                />
                <span
                  aria-hidden="true"
                  className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,transparent_38%,rgba(8,18,13,0.88)_100%)]"
                />
                {trip.countries?.length ? (
                  <TripCountries
                    className="block truncate text-[0.6875rem] font-semibold tracking-[0.12em] text-white/80 uppercase"
                    countries={trip.countries}
                  />
                ) : null}
                <span className="mt-0.5 line-clamp-2 leading-[1.15] font-semibold tracking-[-0.015em] text-balance">
                  {trip.name}
                </span>
                <span className="mt-1 block text-[length:var(--text-metadata)] text-white/80 tabular-nums">
                  <span className="inline-block first-letter:uppercase">{when}</span>
                  {/* Under way, "day 1 of 5" already says how long it is. */}
                  {trip.lifecycle === 'active' ? null : (
                    <>
                      <span aria-hidden="true"> · </span>
                      {itineraryT('dayCount', { count: tripDayCount(trip) })}
                    </>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
