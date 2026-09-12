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
import { formatTripDate, formatTripDateRange } from '@/lib/trips/format';
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
 * The one trip Home leads with, as a photograph first.
 *
 * The weather used to live in the corner of this card. It sits at the top of
 * the page now, beside the greeting, which is both where a traveller looks for
 * it and what frees the card's lower half for the trip's own facts - how long,
 * how far, how many - stated as chips rather than buried in a sentence.
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
      className="relative isolate flex min-h-[33rem] flex-col justify-end overflow-hidden rounded-[var(--radius-2xl)] border border-border-subtle bg-surface-media p-5 text-white shadow-[var(--shadow-card)] sm:min-h-[31rem] sm:p-7 lg:min-h-[34rem] lg:p-9"
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { duration: motionDuration.standard, ease: motionEase }
      }
    >
      <TripMedia
        alt={
          editorial
            ? mediaTranslations('alt.tripEditorial', { name: destinations ?? trip.name })
            : ''
        }
        className="absolute inset-0 -z-10 h-full w-full rounded-none"
        preload
        sizes="(max-width: 1023px) 100vw, 1024px"
        source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
        variant="hero"
      />
      {/* The top is lighter than it was, so more of the photograph survives;
          below that the ramp holds its old weight. A pale photograph - a map,
          a bright sky - is the case that decides this, and the copy sitting
          from about a third of the way down has to stay legible over one. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(10,20,15,0.16)_0%,rgba(10,20,15,0.40)_38%,rgba(8,18,13,0.94)_100%)]"
      />

      <div className="flex w-full flex-col gap-4 lg:max-w-3xl">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-white/82 uppercase">
              {destinations ?? t('destinationOpen')}
            </p>
            <span aria-hidden="true" className="text-white/40">
              ·
            </span>
            <p className="text-[length:var(--text-metadata)] font-medium text-white/72">
              {t(stageLabels[trip.lifecycle])}
            </p>
            <TripReadinessBadge
              lifecycle={trip.lifecycle}
              readiness={trip.planningReadiness}
              tone="onMedia"
            />
          </div>
          <h2
            className="max-w-2xl text-[length:var(--text-page-title)] leading-[1.04] font-semibold tracking-[-0.035em] text-balance md:text-[length:var(--text-immersive-title)] md:leading-[1.02]"
            id="home-focal-heading"
          >
            {trip.name}
          </h2>
          <TripFactChips
            className="pt-1"
            leading={
              <span className="tabular-nums">
                {formatTripDateRange(trip.startDate, trip.endDate, locale)}
              </span>
            }
            tone="onMedia"
            trip={trip}
          />
        </div>

        {trip.lifecycle === 'planning' ? (
          <div className="w-full max-w-xl space-y-2">
            <p className="text-lg font-medium">
              {t('countdown', resolveCountdown(daysUntilTripStart(trip)))}
            </p>
            <TripProgress inverse trip={trip} />
          </div>
        ) : null}

        {trip.lifecycle === 'active' ? (
          <div className="w-full max-w-xl space-y-2">
            <p className="text-[length:var(--text-metadata)] font-medium text-white/78">
              {t('nextUp')}
            </p>
            <p className="text-base leading-6">
              {nextItem
                ? t(nextItem.upcoming ? 'nextItem' : 'currentItem', { name: nextItem.label })
                : t('noNextItem')}
            </p>
            <TripProgress inverse trip={trip} tripModeContext={tripModeContext} />
          </div>
        ) : null}

        {trip.lifecycle === 'completed' ? (
          <div className="space-y-3">
            <p className="max-w-xl text-sm leading-6 text-white/78">
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

        <TripDestinationActions
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

        <TripReadinessPrompt inverse trip={trip} />

        {promptKey ? (
          <div className="flex items-start justify-between gap-3 border-t border-white/20 pt-3">
            <p className="text-sm leading-6 text-white/75">{t(promptKey)}</p>
            <Button
              aria-label={t('dismissPrompt')}
              className="text-white hover:bg-white/15 hover:text-white"
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
