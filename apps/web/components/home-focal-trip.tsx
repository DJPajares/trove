import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { EditorialSection } from '@/components/editorial-section';
import { ExperienceRatingSummary } from '@/components/experience-rating-field';
import { OfflineReadyStatus } from '@/components/offline-ready-status';
import { TripDestinationActions } from '@/components/trip-destination-actions';
import { TripMedia } from '@/components/trip-media';
import { Button } from '@/components/ui/button';
import type { CompletedPromptKey } from '@/lib/home/completed-prompt';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import type { Trip } from '@/lib/trips/api';
import { formatTripDate, formatTripDateRange } from '@/lib/trips/format';
import { daysUntilTripStart } from '@/lib/trips/lifecycle';
import { primaryTripDestinations } from '@/lib/trips/navigation';
import { tripDestinationSummary } from '@/lib/trips/summary';

/** Home's own name for each stage — its voice, not the navigation contract's. */
const stageLabels: Record<Trip['lifecycle'], string> = {
  active: 'activeLabel',
  completed: 'completedLabel',
  planning: 'planningLabel',
};

export type HomeFocalTripProps = {
  /** Resolved by the shell's single request; null when the trip has its own cover. */
  editorial: EditorialImageReference | null;
  /** Active trips only. `upcoming` chooses between "next" and "happening now". */
  nextItem: { label: string; upcoming: boolean } | null;
  onDismissPrompt: (tripId: string) => void;
  /** Completed trips only, already filtered through the dismissal list. */
  promptKey: CompletedPromptKey | null;
  trip: Trip;
};

/**
 * The one trip Home leads with, whichever stage it is in.
 *
 * Purely presentational: the shell owns every fetch and the dismissal record,
 * so this can be read as "what a trip looks like at this stage" and nothing
 * else. The stage is `trip.lifecycle` rather than a prop, because a card whose
 * shape and whose trip could disagree is a card that eventually will.
 */
export function HomeFocalTrip({
  editorial,
  nextItem,
  onDismissPrompt,
  promptKey,
  trip,
}: Readonly<HomeFocalTripProps>) {
  const t = useTranslations('home');
  const mediaTranslations = useTranslations('media');
  const locale = useLocale();
  const destinations = tripDestinationSummary(trip);
  const dateRange = formatTripDateRange(trip.startDate, trip.endDate, locale);

  return (
    <EditorialSection
      density="default"
      description={destinations ?? t('destinationOpen')}
      eyebrow={t(stageLabels[trip.lifecycle])}
      headingId="home-focal-heading"
      title={trip.name}
      treatment="tinted"
    >
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] sm:items-start sm:gap-6">
        {/* The trip and its next action come before the photograph at every
            width: the action has to be reachable without scrolling, and the
            photographer's credit is a real link that must not precede it. */}
        <div className="min-w-0 space-y-4">
          {trip.lifecycle === 'planning' ? (
            <div className="space-y-1">
              <p className="text-base font-medium text-foreground">
                {t('countdown', { count: daysUntilTripStart(trip) })}
              </p>
              <p className="text-[length:var(--text-metadata)] text-muted-foreground tabular-nums">
                {dateRange}
              </p>
              {/* The trip's own readiness flag, and nothing derived from it.
                  PRD 9.2 rules out inventing a general planning-progress score. */}
              <p className="pt-1 text-sm text-foreground">
                {t(`readiness.${trip.planningReadiness}`)}
              </p>
            </div>
          ) : null}

          {trip.lifecycle === 'active' ? (
            <div className="space-y-2">
              <p className="text-[length:var(--text-metadata)] text-muted-foreground tabular-nums">
                {dateRange}
              </p>
              <div>
                <p className="text-sm font-medium text-foreground">{t('nextUp')}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {nextItem
                    ? t(nextItem.upcoming ? 'nextItem' : 'currentItem', { name: nextItem.label })
                    : t('noNextItem')}
                </p>
              </div>
            </div>
          ) : null}

          {trip.lifecycle === 'completed' ? (
            <div className="space-y-3">
              <p className="text-sm leading-6 text-muted-foreground">
                {t('states.completed.tripDescription', {
                  endDate: formatTripDate(trip.endDate, locale),
                  startDate: formatTripDate(trip.startDate, locale),
                })}
              </p>
              {trip.experienceRating === null ? null : (
                <ExperienceRatingSummary label={t('yourRating')} rating={trip.experienceRating} />
              )}
            </div>
          ) : null}

          <TripDestinationActions
            destinations={primaryTripDestinations(trip.id, trip.lifecycle, trip.startDate)}
            labelOverrides={
              trip.lifecycle === 'completed'
                ? { memories: t(trip.memoryCount ? 'viewMemories' : 'addMemories') }
                : {
                    itinerary: t('continuePlanning'),
                    mode: t(trip.lifecycle === 'active' ? 'openTripMode' : 'previewTripMode'),
                  }
            }
          />

          {promptKey ? (
            <div className="flex items-start justify-between gap-3 border-t border-border pt-4">
              <p className="text-sm leading-6 text-muted-foreground">{t(promptKey)}</p>
              <Button
                aria-label={t('dismissPrompt')}
                onClick={() => onDismissPrompt(trip.id)}
                size="icon-sm"
                variant="ghost"
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          ) : null}
        </div>

        <TripMedia
          alt={
            editorial
              ? mediaTranslations('alt.tripEditorial', { name: destinations ?? trip.name })
              : ''
          }
          className="h-40 w-full sm:h-full sm:min-h-[12rem] lg:min-h-[14rem]"
          preload
          sizes="(max-width: 639px) 100vw, (max-width: 1023px) 40vw, 380px"
          source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
          variant="card"
        />
      </div>

      {/* Below the whole card rather than inside its text column: getting ready
          is a footnote to the trip, and on a phone - where the card is one
          column - keeping it here is what stops it pushing the photograph off
          the end of the screen. */}
      {trip.lifecycle === 'planning' ? (
        <OfflineReadyStatus tripId={trip.id} variant="compact" />
      ) : null}
    </EditorialSection>
  );
}
