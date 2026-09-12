'use client';

import { X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';

import { ExperienceRatingSummary } from '@/components/experience-rating-field';
import { TripDestinationActions } from '@/components/trip-destination-actions';
import { TripFactChips } from '@/components/trip-fact-chips';
import { TripMedia } from '@/components/trip-media';
import { TripProgress } from '@/components/trip-progress';
import { TripReadinessBadge } from '@/components/trip-readiness-badge';
import { TripReadinessPrompt } from '@/components/trip-readiness-prompt';
import { Button } from '@/components/ui/button';
import type { CompletedPromptKey } from '@/lib/home/completed-prompt';
import type { TripModeContext } from '@/lib/itinerary/api';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import { motionDuration, motionEase } from '@/lib/motion';
import type { Trip } from '@/lib/trips/api';
import { formatTripDate } from '@/lib/trips/format';
import { daysUntilTripStart, resolveCountdown } from '@/lib/trips/lifecycle';
import { primaryTripDestinations, withLiveTripModeFirst } from '@/lib/trips/navigation';
import { tripDestinationSummary } from '@/lib/trips/summary';

const stageLabels: Record<Trip['lifecycle'], string> = {
  active: 'activeLabel',
  completed: 'completedLabel',
  planning: 'planningLabel',
};

export type HomeFocalTripProps = {
  editorial: EditorialImageReference | null;
  nextItem: { label: string; upcoming: boolean } | null;
  onDismissPrompt: (tripId: string) => void;
  promptKey: CompletedPromptKey | null;
  trip: Trip;
  /** Already fetched by Home for the active trip; never fetched again here. */
  tripModeContext?: TripModeContext | null;
};

/**
 * The one trip Home leads with: a photograph with no edges, and the trip
 * centred on it.
 *
 * The card this replaced was a rectangle with its text pinned to the bottom
 * corner. Here the photograph has no corner to pin to - it is masked to a soft
 * round shape that fades out rather than stopping - so everything the trip has
 * to say sits in the middle of it.
 *
 * The backdrop is sized from the section rather than given a fixed square,
 * because the content decides how tall this is: a planning trip carries a
 * countdown, a progress bar and a readiness prompt, and a square measured off
 * the width would have let all that spill past the photograph onto the page,
 * where white text is invisible. Insets that follow the section keep the text
 * on the picture at every height, and on a narrow screen the shape simply runs
 * past the edges, where `overflow-hidden` takes it.
 *
 * No tinted disc behind the picture. The reference sets its circle on a green
 * field, but Trove's page is already a warm ivory a shade off `--surface-tint`,
 * so the disc bought nothing and its own clipped edges read as a rectangle
 * behind a shape whose whole point is not having one.
 */
export function HomeFocalTrip({
  editorial,
  nextItem,
  onDismissPrompt,
  promptKey,
  trip,
  tripModeContext = null,
}: Readonly<HomeFocalTripProps>) {
  const t = useTranslations('home');
  const mediaTranslations = useTranslations('media');
  const locale = useLocale();
  const shouldReduceMotion = useReducedMotion();
  const destinations = tripDestinationSummary(trip);

  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      aria-labelledby="home-focal-heading"
      className="relative isolate flex flex-col items-center gap-4 overflow-hidden px-5 py-11 text-center text-white sm:px-10 sm:py-16"
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { duration: motionDuration.standard, ease: motionEase }
      }
    >
      {/*
        The solid zone runs to 80% and the shape overscans the section by 8%,
        which together decide whether the smallest text on here is legible. The
        eyebrow is 13px at white/85 and the tallest case - a planning trip
        carrying a countdown, a progress bar and a readiness prompt - pushes it
        furthest out towards the feather. Over a white photograph, the frame
        that decides this, those two numbers hold it at about 8.6:1; the values
        this started from measured 3.2:1.

        The width is capped rather than tracking the column, because the content
        stops at 30rem and a shape that ran the full width of a desktop page
        would be a flat band rather than the round one this is meant to be.
      */}
      <div className="absolute inset-y-[-8%] left-1/2 -z-20 w-[112%] max-w-[46rem] -translate-x-1/2 [mask-image:radial-gradient(closest-side,#000_80%,transparent_100%)]">
        <TripMedia
          alt={
            editorial
              ? mediaTranslations('alt.tripEditorial', { name: destinations ?? trip.name })
              : ''
          }
          className="h-full w-full rounded-none"
          preload
          sizes="(max-width: 1023px) 100vw, 1024px"
          source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
          variant="hero"
        />
        {/* Inside the mask, so the scrim fades out exactly where the picture
            does rather than leaving a dark disc on the page. Weighted towards
            the middle, which is where every line of this actually sits. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(closest-side,rgba(8,18,13,0.74)_0%,rgba(8,18,13,0.80)_58%,rgba(8,18,13,0.88)_100%)]"
        />
      </div>

      <div className="flex w-full max-w-[30rem] flex-col items-center gap-4">
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5">
          <p className="text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-white/85 uppercase">
            {destinations ?? t('destinationOpen')}
          </p>
          <span aria-hidden="true" className="text-white/40">
            ·
          </span>
          <p className="text-[length:var(--text-metadata)] font-medium text-white/78">
            {t(stageLabels[trip.lifecycle])}
          </p>
          <TripReadinessBadge
            lifecycle={trip.lifecycle}
            readiness={trip.planningReadiness}
            tone="onMedia"
          />
        </div>

        <h2
          className="text-[length:var(--text-page-title)] leading-[1.04] font-semibold tracking-[-0.035em] text-balance md:text-[length:var(--text-immersive-title)] md:leading-[1.02]"
          id="home-focal-heading"
        >
          {trip.name}
        </h2>

        {trip.lifecycle === 'planning' ? (
          <div className="flex w-full flex-col items-center gap-3">
            <p className="text-lg font-medium">
              {t('countdown', resolveCountdown(daysUntilTripStart(trip)))}
            </p>
            <TripProgress className="w-full max-w-xs" inverse trip={trip} />
          </div>
        ) : null}

        {trip.lifecycle === 'active' ? (
          <div className="flex w-full flex-col items-center gap-2">
            <p className="text-base leading-6 text-balance">
              {nextItem
                ? t(nextItem.upcoming ? 'nextItem' : 'currentItem', { name: nextItem.label })
                : t('noNextItem')}
            </p>
            <TripProgress
              className="w-full max-w-xs"
              inverse
              trip={trip}
              tripModeContext={tripModeContext}
            />
          </div>
        ) : null}

        {trip.lifecycle === 'completed' ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm leading-6 text-balance text-white/82">
              {t('completedTripDescription', {
                endDate: formatTripDate(trip.endDate, locale),
                startDate: formatTripDate(trip.startDate, locale),
              })}
            </p>
            {trip.experienceRating === null ? null : (
              <ExperienceRatingSummary
                className="text-white"
                label={t('yourRating')}
                rating={trip.experienceRating}
                tone="onImage"
              />
            )}
          </div>
        ) : null}

        <TripFactChips className="justify-center" tone="onMedia" trip={trip} />

        <TripDestinationActions
          className="justify-center"
          destinations={withLiveTripModeFirst(
            primaryTripDestinations(trip.id, trip.lifecycle, trip.startDate),
            trip.lifecycle,
          )}
          inverse
          labelOverrides={
            trip.lifecycle === 'completed'
              ? { memories: t('viewMemories') }
              : {
                  itinerary: t('continuePlanning'),
                  // A trip already under way is not started again; it is
                  // carried on with. Preview is what a trip that has not left
                  // yet is honestly offering.
                  mode: t(trip.lifecycle === 'active' ? 'continueTrip' : 'previewTripMode'),
                }
          }
        />

        <TripReadinessPrompt className="justify-center text-center" inverse trip={trip} />

        {promptKey ? (
          <div className="flex items-center gap-2 border-t border-white/20 pt-3">
            <p className="text-sm leading-6 text-balance text-white/80">{t(promptKey)}</p>
            <Button
              aria-label={t('dismissPrompt')}
              className="shrink-0 text-white hover:bg-white/15 hover:text-white"
              onClick={() => onDismissPrompt(trip.id)}
              size="icon-sm"
              variant="ghost"
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>
    </motion.section>
  );
}
