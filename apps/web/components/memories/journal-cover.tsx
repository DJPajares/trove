'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import type { Ref } from 'react';

import { ExperienceRatingControl } from '@/components/experience-rating';
import { MediaFrame } from '@/components/media-frame';
import { TripCountries } from '@/components/trip-countries';
import type { TripMediaSource } from '@/lib/media/trip-media';
import type { Trip } from '@/lib/trips/api';

const KICKER =
  'text-[0.7rem] font-semibold tracking-[0.2em] text-media-fallback-foreground/85 uppercase';

function formatDate(value: string, locale: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}

/**
 * The journal's cover: the top of the story (PRD 31.2). A photograph the
 * traveller chose from their own Memories leads, then the trip's cover, then
 * an editorial photograph, then Trove's branded fallback - the same ladder as
 * every trip surface, decided once in `resolveTripMediaSource`.
 *
 * On a phone it runs to the top edge, under the status bar and the header,
 * the way a book's cover fills its front. The trip's name is set in the
 * journal's serif; the trip's rating sits here as itself, or as the quiet
 * five-dot control, and nowhere else on the page.
 */
export function JournalCover({
  cover,
  onRate,
  ref,
  trip,
}: Readonly<{
  cover: TripMediaSource;
  onRate: () => void;
  ref?: Ref<HTMLElement>;
  trip: Trip;
}>) {
  const t = useTranslations('memories.journal');
  const locale = useLocale();
  const reduced = useReducedMotion();

  const sameYear = trip.startDate.slice(0, 4) === trip.endDate.slice(0, 4);
  const dates = t('dateRange', {
    end: formatDate(trip.endDate, locale, { day: 'numeric', month: 'long', year: 'numeric' }),
    start: formatDate(trip.startDate, locale, {
      day: 'numeric',
      month: 'long',
      ...(sameYear ? {} : { year: 'numeric' }),
    }),
  });

  return (
    <section
      aria-labelledby="journal-title"
      className="relative isolate -ms-[var(--gutter-inline-start)] -me-[var(--gutter-inline-end)] -mt-[var(--journal-head-height)] overflow-hidden md:mx-0 md:rounded-[var(--radius-2xl)]"
      data-slot="journal-cover"
      ref={ref}
    >
      <motion.div
        animate={{ scale: 1 }}
        initial={reduced ? false : { scale: 1.04 }}
        transition={reduced ? { duration: 0 } : { duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <MediaFrame
          alt={t('coverAlt', { trip: trip.name })}
          className="h-[min(88svh,56rem)] rounded-none md:h-[clamp(28rem,74svh,46rem)]"
          dataSlot="journal-cover-media"
          preload
          sizes="(max-width: 1023px) 100vw, 1024px"
          source={cover}
          variant="cover"
        />
      </motion.div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface-overlay from-0% via-surface-overlay/35 via-38% to-transparent to-62%"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-surface-overlay/55 to-transparent"
      />

      <div className="absolute inset-x-0 bottom-0 px-[max(1.5rem,var(--gutter-inline-start))] pb-10 md:px-10 md:pb-12">
        {trip.countries?.length ? (
          <TripCountries className={KICKER} countries={trip.countries} />
        ) : trip.destinations.length ? (
          <p className={KICKER}>
            {trip.destinations.map((destination) => destination.name).join(' · ')}
          </p>
        ) : null}
        <h1
          className="mt-3 max-w-[14ch] font-journal text-[clamp(3rem,14vw,6.75rem)] leading-[0.92] font-normal tracking-[-0.01em] text-balance text-media-fallback-foreground [overflow-wrap:anywhere]"
          id="journal-title"
        >
          {trip.name}
        </h1>
        <p className="mt-4 text-sm font-medium tracking-[0.04em] text-media-fallback-foreground/85 tabular-nums">
          {dates}
        </p>
        {/* A trip is rated once it has been lived (PRD 30); before then there
            is nothing to reflect on, so the control waits for the end. */}
        {trip.lifecycle === 'completed' || trip.experienceRating !== null ? (
          <ExperienceRatingControl
            className="mt-3"
            label={t('rateTrip')}
            onOpen={onRate}
            rating={trip.experienceRating}
            tone="onImage"
            wordClassName="font-journal text-lg italic"
          />
        ) : null}
      </div>
    </section>
  );
}
