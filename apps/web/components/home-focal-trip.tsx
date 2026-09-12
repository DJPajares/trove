'use client';

import { X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';

import { ExperienceRatingSummary } from '@/components/experience-rating-field';
import { TripCountries } from '@/components/trip-countries';
import { TripDestinationActions } from '@/components/trip-destination-actions';
import { TripFactChips } from '@/components/trip-fact-chips';
import { TripLifecycleBadge } from '@/components/trip-lifecycle-badge';
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

/**
 * What the trip's day says right now, or null when it says nothing worth a line.
 *
 * Null covers both "still loading" and "no day at all", because neither is a
 * fact about the traveller's schedule and both used to render as one.
 */
export type HomeNextUp =
  { kind: 'current' | 'next'; label: string } | { kind: 'nothingScheduled'; label: null };

export type HomeFocalTripProps = {
  editorial: EditorialImageReference | null;
  nextUp: HomeNextUp | null;
  onDismissPrompt: (tripId: string) => void;
  promptKey: CompletedPromptKey | null;
  trip: Trip;
  /** Already fetched by Home for the active trip; never fetched again here. */
  tripModeContext?: TripModeContext | null;
};

/**
 * The one trip Home leads with, composed the way an app introduces a subject:
 * a round photograph, a name, a line of context, its numbers, its actions.
 *
 * The photograph is a real circle at a fixed size rather than a shape stretched
 * to hold the copy. Two earlier passes put the text on the picture, which meant
 * the picture's shape was decided by how long the copy happened to be - an oval
 * on a phone, a band on a desktop - with rectangles floating on it. Making the
 * circle its own object fixes that as geometry rather than as tuning, and it
 * takes the contrast problem with it: every line below sits on the page in the
 * page's own ink, so there is no scrim left to get wrong.
 */
export function HomeFocalTrip({
  editorial,
  nextUp,
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
  const dateRange = formatTripDateRange(trip.startDate, trip.endDate, locale);

  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      aria-labelledby="home-focal-heading"
      className="flex flex-col items-center gap-5 py-2 text-center"
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { duration: motionDuration.standard, ease: motionEase }
      }
    >
      <div className="relative">
        {/* The hairline matters on a pale photograph against a pale page: without
            it a bright sky has no edge and the circle stops being a circle. */}
        <div className="size-44 overflow-hidden rounded-full shadow-[var(--shadow-elevated)] ring-1 ring-black/5 sm:size-52 lg:size-60 dark:ring-white/10">
          <TripMedia
            alt={
              editorial
                ? mediaTranslations('alt.tripEditorial', { name: destinations ?? trip.name })
                : ''
            }
            className="h-full w-full rounded-none"
            preload
            sizes="(max-width: 639px) 11rem, (max-width: 1023px) 13rem, 15rem"
            source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
            variant="thumbnail"
          />
        </div>
        {/* Over the rim, with the page's own colour ringing it, so the badge
            punches a gap out of the photograph rather than sitting on it.
            `onMedia` rather than the default tone: half of this badge is on the
            photograph, and the default fill is a tenth of a tint meant for a
            known page surface - over an arbitrary image its contrast is
            whatever the image happens to be, which in dark mode was nothing. */}
        <TripLifecycleBadge
          className="absolute -bottom-2 left-1/2 -translate-x-1/2 ring-4 ring-background"
          lifecycle={trip.lifecycle}
          tone="onMedia"
        />
      </div>

      <div className="flex w-full max-w-[34rem] flex-col items-center gap-4">
        <div className="space-y-1.5">
          <h1
            className="text-[length:var(--text-page-title)] leading-[1.06] font-semibold tracking-[-0.035em] text-balance text-foreground md:text-[length:var(--text-immersive-title)] md:leading-[1.02]"
            id="home-focal-heading"
          >
            {trip.name}
          </h1>
          {/* A trip that has not picked a destination yet simply says its dates.
              The line it used to carry instead - "Destination still open" -
              filled the space without telling the traveller anything. */}
          <p className="text-sm text-muted-foreground">
            {trip.countries?.length ? (
              <>
                <TripCountries countries={trip.countries} /> <span aria-hidden="true">·</span>{' '}
              </>
            ) : destinations ? (
              <>
                {destinations} <span aria-hidden="true">·</span>{' '}
              </>
            ) : null}
            <span className="tabular-nums">{dateRange}</span>
          </p>
          <TripReadinessBadge lifecycle={trip.lifecycle} readiness={trip.planningReadiness} />
        </div>

        {trip.lifecycle === 'planning' ? (
          <div className="flex w-full flex-col items-center gap-3">
            <p className="text-lg font-medium text-foreground">
              {t('countdown', resolveCountdown(daysUntilTripStart(trip)))}
            </p>
            <TripProgress className="w-full max-w-xs" trip={trip} />
          </div>
        ) : null}

        {trip.lifecycle === 'active' ? (
          <div className="flex w-full flex-col items-center gap-3">
            {nextUp ? (
              <p className="text-base leading-6 text-balance text-muted-foreground">
                {nextUp.kind === 'nothingScheduled'
                  ? t('nothingScheduled')
                  : t(nextUp.kind === 'next' ? 'nextItem' : 'currentItem', { name: nextUp.label })}
              </p>
            ) : null}
            <TripProgress
              className="w-full max-w-xs"
              trip={trip}
              tripModeContext={tripModeContext}
            />
          </div>
        ) : null}

        {trip.lifecycle === 'completed' ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm leading-6 text-balance text-muted-foreground">
              {t('completedTripDescription', {
                endDate: formatTripDate(trip.endDate, locale),
                startDate: formatTripDate(trip.startDate, locale),
              })}
            </p>
            {trip.experienceRating === null ? null : (
              <ExperienceRatingSummary label={t('yourRating')} rating={trip.experienceRating} />
            )}
          </div>
        ) : null}

        <TripFactChips className="border-y border-border-subtle py-3" layout="stats" trip={trip} />

        <TripDestinationActions
          className="justify-center"
          destinations={withLiveTripModeFirst(
            primaryTripDestinations(trip.id, trip.lifecycle, trip.startDate),
            trip.lifecycle,
          )}
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

        <TripReadinessPrompt className="w-full justify-center text-center" trip={trip} />

        {promptKey ? (
          <div className="flex w-full items-center justify-center gap-2 border-t border-border-subtle pt-3">
            <p className="text-sm leading-6 text-balance text-muted-foreground">{t(promptKey)}</p>
            <Button
              aria-label={t('dismissPrompt')}
              className="shrink-0"
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
