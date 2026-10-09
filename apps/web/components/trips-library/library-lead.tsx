'use client';

import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { TripCountries } from '@/components/trip-countries';
import { TripDaySegments } from '@/components/trip-day-segments';
import { TripDestinationActions } from '@/components/trip-destination-actions';
import { TripMedia } from '@/components/trip-media';
import { TripReadinessBadge } from '@/components/trip-readiness-badge';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import { motionDuration, motionEase } from '@/lib/motion';
import type { Trip } from '@/lib/trips/api';
import { tripDayCount } from '@/lib/trips/facts';
import { formatTripDateRange } from '@/lib/trips/format';
import { tripDayProgress } from '@/lib/trips/library';
import { daysUntilTripStart, resolveCountdown } from '@/lib/trips/lifecycle';
import { primaryTripDestinations, withLiveTripModeFirst } from '@/lib/trips/navigation';
import type { TripNextUp } from '@/lib/trips/next-up';
import { tripDestinationSummary } from '@/lib/trips/summary';
import { cn } from '@/lib/utils';

const KICKER =
  'text-[length:var(--text-metadata)] font-semibold tracking-[0.12em] text-white/85 uppercase';

/**
 * How far away a planned trip is, as one large number and the words it counts.
 * The number is the thing seen from across a room; the sentence beneath it is
 * the one a screen reader gets, whole.
 */
function Countdown({ trip }: Readonly<{ trip: Trip }>) {
  const t = useTranslations('trips.library.lead');
  const homeT = useTranslations('home');
  const countdown = resolveCountdown(daysUntilTripStart(trip));

  return (
    <p className="flex items-end gap-3">
      <span
        aria-hidden="true"
        className="text-[clamp(4.5rem,18vw,7.5rem)] leading-[0.8] font-semibold tracking-[-0.06em] tabular-nums"
      >
        {countdown.value}
      </span>
      <span
        aria-hidden="true"
        className="max-w-[7rem] pb-1 text-sm leading-tight font-medium text-white/85"
      >
        {t('countdownUnit', { count: countdown.value, unit: countdown.unit })}
      </span>
      <span className="sr-only">
        {homeT('countdown', { count: countdown.value, unit: countdown.unit })}
      </span>
    </p>
  );
}

function DayCount({ trip }: Readonly<{ trip: Trip }>) {
  const t = useTranslations('trips.library.lead');
  const { day, total } = tripDayProgress(trip);

  return (
    <div className="w-full max-w-sm space-y-3">
      <p className="flex items-end gap-2.5">
        <span aria-hidden="true" className={cn(KICKER, 'pb-2')}>
          {t('dayKicker')}
        </span>
        <span
          aria-hidden="true"
          className="text-[clamp(4.5rem,18vw,7.5rem)] leading-[0.8] font-semibold tracking-[-0.06em] tabular-nums"
        >
          {String(day).padStart(2, '0')}
        </span>
        <span aria-hidden="true" className="pb-1 text-sm font-medium text-white/85 tabular-nums">
          {t('dayOf', { total })}
        </span>
        <span className="sr-only">{t('dayProgress', { day, total })}</span>
      </p>
      <TripDaySegments day={day} total={total} />
    </div>
  );
}

/**
 * The line beneath the name: what the trip needs from the traveller now.
 *
 * Under way, that is the next stop - read from the Trip Mode context the
 * library already fetched for this one trip, never asked for again. Being
 * planned, it is how much of the trip has a plan, until the traveller calls the
 * plan Ready (PRD 9.2), after which it says nothing the badge does not.
 */
function StatusLine({ nextUp, trip }: Readonly<{ nextUp: TripNextUp | null; trip: Trip }>) {
  const t = useTranslations('trips.library.lead');

  if (trip.lifecycle === 'active') {
    if (!nextUp) return null;
    return (
      <p className="text-base leading-6 text-balance text-white/90">
        {nextUp.kind === 'nothingScheduled'
          ? t('nothingScheduled')
          : t(nextUp.kind === 'next' ? 'next' : 'current', { name: nextUp.label })}
      </p>
    );
  }

  if (trip.planningReadiness === 'ready' || !trip.itineraryCoverage) return null;

  return (
    <p className="text-sm font-medium text-white/85 tabular-nums">
      {t('planned', trip.itineraryCoverage)}
    </p>
  );
}

export type LibraryLeadProps = {
  editorial: EditorialImageReference | null;
  nextUp: TripNextUp | null;
  trip: Trip;
};

/**
 * The one trip the library opens on: the journey the traveller is on, or the
 * next one they are leaving for. It is the only trip drawn this large, and the
 * only one that carries its experiences as buttons - Continue planning or
 * Continue trip leading, the other close behind (PRD 4.5).
 *
 * The photograph runs edge to edge with the trip set over it, the way the
 * planner and the Memories journal open; the countdown or the day under way is
 * the largest thing on it, because "how long until" and "how far in" are what
 * a traveller comes to this screen to feel.
 */
export function LibraryLead({ editorial, nextUp, trip }: Readonly<LibraryLeadProps>) {
  const t = useTranslations('trips.library.lead');
  const tripsT = useTranslations('trips');
  const itineraryT = useTranslations('itinerary');
  const mediaT = useTranslations('media');
  const locale = useLocale();
  const reduced = useReducedMotion();
  const subject = tripDestinationSummary(trip) ?? trip.name;
  const active = trip.lifecycle === 'active';

  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      aria-labelledby="library-lead-heading"
      className="group relative isolate overflow-hidden rounded-[var(--radius-2xl)] bg-surface-media text-white shadow-[var(--shadow-elevated)]"
      data-slot="library-lead"
      initial={reduced ? false : { opacity: 0, y: 8 }}
      transition={
        reduced ? { duration: 0 } : { duration: motionDuration.standard, ease: motionEase }
      }
    >
      <TripMedia
        alt={editorial ? mediaT('alt.tripEditorial', { name: subject }) : ''}
        className="absolute inset-0 -z-10 h-full w-full rounded-none"
        preload
        sizes="(max-width: 1023px) 100vw, 1024px"
        source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
        variant="cover"
      />
      {/* Dark at the top for the kicker, nearly clear through the middle so the
          photograph is the subject, then deep under the copy. The copy is white
          at 85% and above, so the foot holds at least 0.85 black - the same
          floor the Home deck measured for its own text over a bright sky. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(8,18,13,0.62)_0%,rgba(8,18,13,0.14)_26%,rgba(8,18,13,0.22)_44%,rgba(8,18,13,0.78)_70%,rgba(8,18,13,0.9)_100%)]"
      />

      <div className="flex min-h-[34rem] flex-col justify-between gap-10 p-5 sm:min-h-[32rem] sm:p-8 lg:min-h-[34rem] lg:p-10">
        <div className="flex items-start justify-between gap-3">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/18 bg-black/28 px-3 py-1.5 text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] uppercase backdrop-blur-md">
            {active ? (
              <span aria-hidden="true" className="relative flex size-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-primary-on-media/70 motion-reduce:animate-none" />
                <span className="relative size-2 rounded-full bg-primary-on-media" />
              </span>
            ) : null}
            {t(active ? 'kickerActive' : 'kickerPlanning')}
          </p>
          <TripReadinessBadge
            lifecycle={trip.lifecycle}
            readiness={trip.planningReadiness}
            tone="onMedia"
          />
        </div>

        <div className="space-y-6">
          {active ? <DayCount trip={trip} /> : <Countdown trip={trip} />}

          <div className="space-y-2">
            {trip.countries?.length ? (
              <TripCountries className={cn(KICKER, 'block')} countries={trip.countries} />
            ) : null}
            <h2
              className="max-w-[18ch] text-[length:var(--text-page-title)] leading-[1.04] font-semibold tracking-[-0.035em] text-balance md:text-[length:var(--text-immersive-title)] md:leading-[1]"
              id="library-lead-heading"
            >
              {/* The card holds buttons, so it cannot be a link itself. The name
                  is, and stretches its hit area over the card the way every
                  clickable trip in Trove does; the actions sit above it. */}
              <Link
                className="rounded-[var(--radius-sm)] outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:ring-3 focus-visible:ring-white/60"
                href={`/trips/${trip.id}`}
              >
                {trip.name}
              </Link>
            </h2>
            <p className="text-sm font-medium text-white/85 tabular-nums">
              {formatTripDateRange(trip.startDate, trip.endDate, locale)}
              <span aria-hidden="true"> · </span>
              {itineraryT('dayCount', { count: tripDayCount(trip) })}
            </p>
          </div>

          <StatusLine nextUp={nextUp} trip={trip} />

          <TripDestinationActions
            className="relative z-10"
            destinations={withLiveTripModeFirst(
              primaryTripDestinations(trip.id, trip.lifecycle, trip.startDate),
              trip.lifecycle,
            )}
            inverse
            labelOverrides={{
              itinerary: tripsT('continuePlanning'),
              // A trip already under way is carried on with, not started again;
              // one that has not left yet is honestly offering a preview.
              mode: tripsT(active ? 'continueTrip' : 'previewTripMode'),
            }}
          />
        </div>
      </div>
    </motion.section>
  );
}
