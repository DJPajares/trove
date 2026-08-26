import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { ExperienceRatingSummary } from '@/components/experience-rating-field';
import { HomeWeatherInset } from '@/components/home-weather-inset';
import { TripDestinationActions } from '@/components/trip-destination-actions';
import { TripItineraryCoverage } from '@/components/trip-itinerary-coverage';
import { TripMedia } from '@/components/trip-media';
import { Button } from '@/components/ui/button';
import type { CompletedPromptKey } from '@/lib/home/completed-prompt';
import type { HomeWeatherTarget } from '@/lib/home/weather';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import type { Trip } from '@/lib/trips/api';
import { formatTripDate } from '@/lib/trips/format';
import { daysUntilTripStart } from '@/lib/trips/lifecycle';
import { primaryTripDestinations } from '@/lib/trips/navigation';
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
  weatherTarget: HomeWeatherTarget | null;
};

export function HomeFocalTrip({
  editorial,
  nextItem,
  onDismissPrompt,
  promptKey,
  trip,
  weatherTarget,
}: Readonly<HomeFocalTripProps>) {
  const t = useTranslations('home');
  const tripsT = useTranslations('trips');
  const mediaTranslations = useTranslations('media');
  const locale = useLocale();
  const destinations = tripDestinationSummary(trip);
  const dateRange = tripsT('dateRange', {
    endDate: formatTripDate(trip.endDate, locale),
    startDate: formatTripDate(trip.startDate, locale),
  });

  return (
    <div className="space-y-3">
      <section
        aria-labelledby="home-focal-heading"
        className="overflow-hidden rounded-[var(--radius-2xl)] border border-border-subtle bg-card shadow-[var(--shadow-card)]"
      >
        <div className="relative isolate">
          <TripMedia
            alt={
              editorial
                ? mediaTranslations('alt.tripEditorial', { name: destinations ?? trip.name })
                : ''
            }
            className="rounded-none"
            preload
            sizes="(max-width: 1023px) 100vw, 1024px"
            source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
            variant="cover"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-surface-overlay from-10% via-surface-overlay/58 to-transparent"
          />
          <div className="absolute inset-0 flex flex-col justify-end p-5 text-white sm:p-7">
            <p className="text-sm font-medium text-white/78">{t(stageLabels[trip.lifecycle])}</p>
            <h1
              className="mt-1 max-w-2xl text-3xl leading-[1.08] font-semibold tracking-[-0.035em] text-balance sm:text-4xl"
              id="home-focal-heading"
            >
              {trip.name}
            </h1>
            <p className="mt-1 text-sm text-white/78">
              {destinations ?? t('destinationOpen')} <span aria-hidden="true">·</span>{' '}
              <span className="tabular-nums">{dateRange}</span>
            </p>
          </div>
        </div>

        <div className="space-y-5 p-5 sm:p-7">
          {trip.lifecycle === 'planning' ? (
            <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
              <div className="space-y-2">
                <p className="text-lg font-medium">
                  {t('countdown', { count: daysUntilTripStart(trip) })}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t(`readiness.${trip.planningReadiness}`)}
                </p>
                {trip.itineraryCoverage ? (
                  <TripItineraryCoverage coverage={trip.itineraryCoverage} />
                ) : null}
              </div>
              {weatherTarget ? <HomeWeatherInset target={weatherTarget} /> : null}
            </div>
          ) : null}

          {trip.lifecycle === 'active' ? (
            <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">{t('nextUp')}</p>
                <p className="text-base leading-6">
                  {nextItem
                    ? t(nextItem.upcoming ? 'nextItem' : 'currentItem', { name: nextItem.label })
                    : t('noNextItem')}
                </p>
                {trip.itineraryCoverage ? (
                  <TripItineraryCoverage coverage={trip.itineraryCoverage} />
                ) : null}
              </div>
              {weatherTarget ? <HomeWeatherInset target={weatherTarget} /> : null}
            </div>
          ) : null}

          {trip.lifecycle === 'completed' ? (
            <div className="space-y-3">
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">
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
                ? { memories: t('viewMemories') }
                : {
                    itinerary: t('continuePlanning'),
                    mode: t(trip.lifecycle === 'active' ? 'openTripMode' : 'previewTripMode'),
                  }
            }
          />

          {promptKey ? (
            <div className="flex items-start justify-between gap-3 border-t border-border-subtle pt-4">
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
      </section>
    </div>
  );
}
