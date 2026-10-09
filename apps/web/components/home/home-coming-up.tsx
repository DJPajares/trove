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
 * The trips after the one Home leads with, said in a line each: a small
 * photograph, where, and how soon. Home only glances ahead - the calendar of
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

      <ul className="grid gap-3 md:grid-cols-3">
        {trips.map((trip) => {
          const editorial = editorialFor(trip);
          const countdown = resolveCountdown(daysUntilTripStart(trip));
          const when =
            trip.lifecycle === 'active'
              ? t('underway', tripDayProgress(trip))
              : relative.format(countdown.value, countdown.unit);

          return (
            <li key={trip.id}>
              <Link
                className="group flex h-full items-center gap-3 rounded-[var(--radius-xl)] border border-border-subtle bg-card p-2.5 pe-4 shadow-[var(--shadow-card)] outline-none transition-[border-color,box-shadow,transform] duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-elevated)] focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transform-none motion-reduce:transition-none"
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
                  className="size-16 shrink-0 rounded-[var(--radius-lg)]"
                  sizes="64px"
                  source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
                  variant="thumbnail"
                />
                <span className="min-w-0 flex-1">
                  {trip.countries?.length ? (
                    <TripCountries
                      className="block truncate text-[0.6875rem] font-semibold tracking-[0.12em] text-text-subtle uppercase"
                      countries={trip.countries}
                    />
                  ) : null}
                  <span className="block truncate font-semibold text-foreground">{trip.name}</span>
                  <span className="block truncate text-[length:var(--text-metadata)] text-muted-foreground tabular-nums">
                    <span className="inline-block first-letter:uppercase">{when}</span>
                    {/* Under way, "day 1 of 5" already says how long it is. */}
                    {trip.lifecycle === 'active' ? null : (
                      <>
                        <span aria-hidden="true"> · </span>
                        {itineraryT('dayCount', { count: tripDayCount(trip) })}
                      </>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
