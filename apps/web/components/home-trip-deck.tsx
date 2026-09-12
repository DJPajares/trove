'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { TripFactChips } from '@/components/trip-fact-chips';
import { TripLifecycleBadge } from '@/components/trip-lifecycle-badge';
import { TripMedia } from '@/components/trip-media';
import { TripReadinessBadge } from '@/components/trip-readiness-badge';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import type { Trip } from '@/lib/trips/api';
import { formatTripDateRange } from '@/lib/trips/format';
import { tripDestinationSummary } from '@/lib/trips/summary';

export type HomeTripDeckProps = {
  editorialFor: (trip: Trip) => EditorialImageReference | null;
  trips: Trip[];
};

/**
 * The trips behind the one Home is leading with, fanned out like a hand of cards.
 *
 * A native scroll-snap rail rather than a draggable stack, for the same reason
 * the place carousel is one: a deck built out of pointer gestures is a deck a
 * keyboard cannot deal, and every card here is a link to a trip. The stacked
 * look comes from overlapping the cards and laying them in descending order, so
 * the card in front covers the shoulder of the one behind it.
 */
export function HomeTripDeck({ editorialFor, trips }: Readonly<HomeTripDeckProps>) {
  const t = useTranslations('home');
  const tripsT = useTranslations('trips');
  const mediaTranslations = useTranslations('media');
  const locale = useLocale();
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const total = trips.length;

  /**
   * How far the rail travels between one card and the next.
   *
   * Measured from the cards themselves rather than assumed from the track's
   * width: they overlap, so the step is narrower than a card, and it changes
   * with the breakpoint. Reading it off the DOM keeps the dots honest at every
   * size without a second copy of the layout's arithmetic.
   */
  function cardStep(track: HTMLDivElement) {
    const [first, second] = [track.children[0], track.children[1]] as (HTMLElement | undefined)[];
    if (!first) return 1;

    return Math.max(1, second ? second.offsetLeft - first.offsetLeft : first.offsetWidth);
  }

  function goTo(index: number) {
    const track = trackRef.current;
    if (!track) return;

    const nextIndex = Math.min(Math.max(index, 0), total - 1);
    track.scrollTo({ left: cardStep(track) * nextIndex });
    setActiveIndex(nextIndex);
  }

  return (
    <section aria-labelledby="other-trips-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2
          className="min-w-0 text-[length:var(--text-section-title)] leading-[1.18] font-semibold tracking-[-0.022em] text-foreground"
          id="other-trips-heading"
        >
          {t('otherTripsTitle')}
        </h2>
        <Link
          className="shrink-0 rounded-[var(--radius-sm)] text-sm font-medium text-brand underline-offset-4 transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:underline focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none motion-reduce:transition-none"
          href="/trips"
        >
          {t('viewTrips')}
        </Link>
      </div>

      {/* `overflow-x-auto` clips vertically as well, which would shave the focus
          ring off every card. The padding gives the ring somewhere to land and
          the negative margin gives the space back to the layout. */}
      <div className="-mx-1 -my-2">
        <div
          className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth px-1 py-2 [scrollbar-width:none] outline-none motion-reduce:scroll-auto focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-scrollbar]:hidden"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            goTo(activeIndex + (event.key === 'ArrowLeft' ? -1 : 1));
          }}
          onScroll={(event) => {
            const track = event.currentTarget;
            const nextIndex = Math.round(track.scrollLeft / cardStep(track));
            if (nextIndex !== activeIndex && nextIndex >= 0 && nextIndex < total) {
              setActiveIndex(nextIndex);
            }
          }}
          ref={trackRef}
          tabIndex={total > 1 ? 0 : -1}
        >
          {trips.map((trip, index) => {
            const editorial = editorialFor(trip);
            const destinations = tripDestinationSummary(trip);

            return (
              <div
                className="w-[86%] shrink-0 snap-start not-first:-ms-6 sm:w-[58%] sm:not-first:-ms-8 lg:w-[38%]"
                key={trip.id}
                // Descending, so the card in front of the rail covers the one
                // tucked in behind it rather than the other way round.
                style={{ zIndex: total - index }}
              >
                <Link
                  aria-label={tripsT('viewTripLabel', { name: trip.name })}
                  className="group relative isolate flex h-[17rem] flex-col justify-end overflow-hidden rounded-[var(--radius-2xl)] border border-border-subtle bg-surface-media p-4 shadow-[var(--shadow-card)] transition-[box-shadow,transform] duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevated)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transform-none motion-reduce:transition-none"
                  href={`/trips/${trip.id}`}
                >
                  <TripMedia
                    alt={
                      editorial
                        ? mediaTranslations('alt.tripEditorial', {
                            name: destinations ?? trip.name,
                          })
                        : ''
                    }
                    className="absolute inset-0 -z-10 h-full w-full rounded-none"
                    sizes="(max-width: 639px) 86vw, (max-width: 1023px) 58vw, 24rem"
                    source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
                    variant="card"
                  />
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(10,20,15,0.14)_0%,rgba(10,20,15,0.50)_42%,rgba(8,18,13,0.92)_100%)]"
                  />

                  <div className="flex flex-wrap items-center gap-1.5">
                    <TripLifecycleBadge lifecycle={trip.lifecycle} tone="onMedia" />
                    <TripReadinessBadge
                      lifecycle={trip.lifecycle}
                      readiness={trip.planningReadiness}
                      tone="onMedia"
                    />
                  </div>
                  <p className="mt-2 truncate text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-white/82 uppercase">
                    {destinations ?? t('destinationOpen')}
                  </p>
                  <h3 className="mt-1 line-clamp-2 text-xl leading-[1.12] font-semibold tracking-[-0.025em] text-balance text-white">
                    {trip.name}
                  </h3>
                  <p className="mt-1 text-[length:var(--text-metadata)] text-white/78 tabular-nums">
                    {formatTripDateRange(trip.startDate, trip.endDate, locale)}
                  </p>
                  <TripFactChips className="mt-3" tone="onMedia" trip={trip} />
                </Link>
              </div>
            );
          })}
        </div>
      </div>

      {total > 1 ? (
        <div className="flex items-center justify-center gap-2">
          {trips.map((trip, index) => (
            <button
              aria-current={index === activeIndex}
              aria-label={t('goToTrip', { current: index + 1 })}
              className="rounded-full p-1.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              key={trip.id}
              onClick={() => goTo(index)}
              type="button"
            >
              <span
                aria-hidden="true"
                className={`block h-1.5 rounded-full transition-[width,background-color] duration-[var(--motion-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none ${
                  index === activeIndex ? 'w-3.5 bg-brand' : 'w-1.5 bg-border-strong'
                }`}
              />
            </button>
          ))}
          <p aria-live="polite" className="sr-only">
            {t('tripDeckPosition', { current: activeIndex + 1, total })}
          </p>
        </div>
      ) : null}
    </section>
  );
}
