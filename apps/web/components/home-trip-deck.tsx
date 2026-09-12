'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { TripFactChips } from '@/components/trip-fact-chips';
import { TripLifecycleBadge } from '@/components/trip-lifecycle-badge';
import { TripMedia } from '@/components/trip-media';
import { TripReadinessBadge } from '@/components/trip-readiness-badge';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import type { Trip } from '@/lib/trips/api';
import { formatTripDateRange } from '@/lib/trips/format';
import { tripDestinationSummary } from '@/lib/trips/summary';

/** The front card, at full size. Everything behind it is the same height. */
const CARD_HEIGHT_REM = 19;
/** How much of each card behind shows above the one in front of it. */
const PEEK_REM = 2.75;
/** How much narrower each card gets as it goes back, per side. */
const INSET_REM = 0.75;
/** Past this the pile stops reading as a deck and starts reading as noise. */
const MAX_VISIBLE_DEPTH = 2;
/**
 * How far off true each card behind sits.
 *
 * Small on purpose: the tilt is what stops the stack reading as one card with
 * stripes above it, and the displacement it buys grows with the card's width -
 * about 3px at a phone's width and 10px across a desktop column - so an angle
 * that reads well on the wide one is already a slant on the narrow one.
 */
const TILT_DEG = 1.5;

export type HomeTripDeckProps = {
  editorialFor: (trip: Trip) => EditorialImageReference | null;
  trips: Trip[];
};

/**
 * The trips behind the one Home is leading with, as a deck.
 *
 * One card in front at full size, the rest tucked behind and above it, each
 * showing the strip that carries its destination. Which is why every card puts
 * its eyebrow at the top and its name at the foot: that top row is the only
 * part of a card behind that is ever seen, so it has to be the part saying
 * where the trip goes.
 *
 * The deck rotates rather than reorders. `depth` is derived from the active
 * index, so DOM order never changes and neither does the tab order or what a
 * screen reader walks through - only the transforms move.
 */
export function HomeTripDeck({ editorialFor, trips }: Readonly<HomeTripDeckProps>) {
  const t = useTranslations('home');
  const mediaTranslations = useTranslations('media');
  const locale = useLocale();
  const [activeIndex, setActiveIndex] = useState(0);
  const total = trips.length;
  const visibleBehind = Math.min(total - 1, MAX_VISIBLE_DEPTH);

  function goTo(index: number) {
    setActiveIndex(((index % total) + total) % total);
  }

  return (
    // The handler sits on the section rather than on the stack: the dots are a
    // sibling of the cards, and arrows pressed with a dot focused are exactly
    // the ones a traveller expects to move the deck. Nothing here is focusable
    // that is not already a card or a dot, so this adds no tab stop.
    <section
      aria-labelledby="other-trips-heading"
      className="space-y-4"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        goTo(activeIndex + (event.key === 'ArrowLeft' ? -1 : 1));
      }}
    >
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

      <div
        className="relative"
        style={{ height: `${CARD_HEIGHT_REM + visibleBehind * PEEK_REM}rem` }}
      >
        {trips.map((trip, index) => {
          const depth = (index - activeIndex + total) % total;
          const editorial = editorialFor(trip);
          const destinations = tripDestinationSummary(trip);
          const buried = depth > MAX_VISIBLE_DEPTH;

          return (
            <div
              className="group absolute bottom-0 flex flex-col justify-between overflow-hidden rounded-[var(--radius-2xl)] bg-surface-media p-4 shadow-[var(--shadow-card)] transition-[transform,left,right,opacity] duration-[var(--motion-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none"
              key={trip.id}
              style={{
                height: `${CARD_HEIGHT_REM}rem`,
                left: `${depth * INSET_REM}rem`,
                opacity: buried ? 0 : 1,
                pointerEvents: buried ? 'none' : undefined,
                right: `${depth * INSET_REM}rem`,
                transform: `translateY(-${depth * PEEK_REM}rem) rotate(${depth * -TILT_DEG}deg)`,
                zIndex: total - depth,
              }}
            >
              <TripMedia
                alt={
                  editorial
                    ? mediaTranslations('alt.tripEditorial', { name: destinations ?? trip.name })
                    : ''
                }
                className="absolute inset-0 -z-10 h-full w-full rounded-none"
                sizes="(max-width: 639px) 92vw, (max-width: 1023px) 70vw, 44rem"
                source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
                variant="card"
              />
              {/* Dark at both ends, and it holds that first band rather than
                  fading straight out of it. The eyebrow is the strip a card
                  behind shows, it is 13px, and over a bright photograph - a
                  sky, snow, a map - a scrim that starts fading immediately
                  leaves it at about 3.3:1. Held to 14% it measures 6:1 against
                  a white frame, which is the worst case there is. */}
              <div
                aria-hidden="true"
                className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(8,18,13,0.78)_0%,rgba(8,18,13,0.70)_14%,rgba(10,20,15,0.30)_34%,rgba(10,20,15,0.46)_58%,rgba(8,18,13,0.92)_100%)]"
              />

              <div className="flex items-center justify-between gap-2">
                {destinations ? (
                  <p className="min-w-0 truncate text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-white/85 uppercase">
                    {destinations}
                  </p>
                ) : (
                  <span />
                )}
                <div className="flex shrink-0 items-center gap-1.5">
                  <TripLifecycleBadge lifecycle={trip.lifecycle} tone="onMedia" />
                  <TripReadinessBadge
                    lifecycle={trip.lifecycle}
                    readiness={trip.planningReadiness}
                    tone="onMedia"
                  />
                </div>
              </div>

              <div>
                <h3 className="line-clamp-2 text-xl leading-[1.12] font-semibold tracking-[-0.025em] text-balance text-white">
                  {depth === 0 ? (
                    // The card cannot itself be a link - while it is behind it
                    // carries a button - so the name is the link and stretches
                    // its own hit area over the whole card, the way every other
                    // clickable row in Trove does it.
                    <Link
                      className="rounded-[var(--radius-sm)] outline-none after:absolute after:inset-0 after:rounded-[inherit] group-hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                      href={`/trips/${trip.id}`}
                    >
                      {trip.name}
                    </Link>
                  ) : (
                    trip.name
                  )}
                </h3>
                <p className="mt-1 text-[length:var(--text-metadata)] text-white/78 tabular-nums">
                  {formatTripDateRange(trip.startDate, trip.endDate, locale)}
                </p>
                <TripFactChips className="mt-3" tone="onMedia" trip={trip} />
              </div>

              {/*
                A card behind deals itself to the front rather than opening its
                trip: only a strip of it is showing, and sending a traveller to a
                trip they have seen four words of is a worse bargain than one tap
                to look at it properly.

                Empty, with its label on the control: a button may hold only
                phrasing content, and this card is a heading, a paragraph and a
                list. Leaving that content outside the button rather than hiding
                it keeps it readable to a screen reader, which is the one
                audience that can reach a buried card's details at all.
              */}
              {depth === 0 ? null : (
                <button
                  aria-label={t('showTrip', { name: trip.name })}
                  className="absolute inset-0 z-10 cursor-pointer rounded-[inherit] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
                  onClick={() => goTo(index)}
                  type="button"
                />
              )}
            </div>
          );
        })}
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
