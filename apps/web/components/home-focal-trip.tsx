import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { ExperienceRatingSummary } from '@/components/experience-rating-field';
import { HomeWeatherInset, HomeWeatherInsetSkeleton } from '@/components/home-weather-inset';
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
  /** True while Home is still working out whether there is weather to show. */
  weatherPending?: boolean;
  weatherTarget: HomeWeatherTarget | null;
};

export function HomeFocalTrip({
  editorial,
  nextItem,
  onDismissPrompt,
  promptKey,
  trip,
  weatherPending = false,
  weatherTarget,
}: Readonly<HomeFocalTripProps>) {
  const t = useTranslations('home');
  const tripsT = useTranslations('trips');
  const mediaTranslations = useTranslations('media');
  const weatherT = useTranslations('home.weather');
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
        className="relative isolate min-h-[31rem] overflow-hidden rounded-[var(--radius-2xl)] border border-border-subtle bg-surface-media shadow-[var(--shadow-card)] sm:min-h-[29rem] lg:min-h-[31rem]"
      >
        <TripMedia
          alt={
            editorial
              ? mediaTranslations('alt.tripEditorial', { name: destinations ?? trip.name })
              : ''
          }
          className="absolute inset-0 h-full w-full rounded-none"
          preload
          sizes="(max-width: 1023px) 100vw, 1024px"
          source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
          variant="hero"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,20,15,0.22)_0%,rgba(10,20,15,0.42)_35%,rgba(8,18,13,0.92)_100%)]"
        />

        <div className="relative flex min-h-[31rem] flex-col justify-end gap-4 p-5 text-white sm:min-h-[29rem] sm:p-7 lg:min-h-[31rem] lg:p-9">
          <div className="flex w-full flex-col gap-4 lg:max-w-3xl">
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-white/78">{t(stageLabels[trip.lifecycle])}</p>
              <h2
                className="max-w-2xl text-3xl leading-[1.08] font-semibold tracking-[-0.035em] text-balance sm:text-4xl"
                id="home-focal-heading"
              >
                {trip.name}
              </h2>
              <p className="text-sm text-white/78">
                {destinations ?? t('destinationOpen')} <span aria-hidden="true">·</span>{' '}
                <span className="tabular-nums">{dateRange}</span>
              </p>
            </div>

            {trip.lifecycle === 'planning' ? (
              <div className="w-full max-w-xl space-y-3 md:max-w-xs">
                <div className="space-y-2">
                  <p className="text-lg font-medium">
                    {t('countdown', { count: daysUntilTripStart(trip) })}
                  </p>
                  <p className="text-sm text-white/78">
                    {t(`readiness.${trip.planningReadiness}`)}
                  </p>
                  {trip.itineraryCoverage ? (
                    <TripItineraryCoverage coverage={trip.itineraryCoverage} inverse />
                  ) : null}
                </div>
                <div className="md:absolute md:right-7 md:bottom-7 md:w-[25rem]">
                  {weatherTarget ? (
                    <HomeWeatherInset target={weatherTarget} />
                  ) : weatherPending ? (
                    <HomeWeatherInsetSkeleton label={weatherT('loading')} />
                  ) : null}
                </div>
              </div>
            ) : null}

            {trip.lifecycle === 'active' ? (
              <div className="w-full max-w-xl space-y-3 lg:max-w-sm">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-white/78">{t('nextUp')}</p>
                  <p className="text-base leading-6">
                    {nextItem
                      ? t(nextItem.upcoming ? 'nextItem' : 'currentItem', { name: nextItem.label })
                      : t('noNextItem')}
                  </p>
                  {trip.itineraryCoverage ? (
                    <TripItineraryCoverage coverage={trip.itineraryCoverage} inverse />
                  ) : null}
                </div>
                <div className="md:absolute md:right-9 md:bottom-9 md:w-[25rem]">
                  {weatherTarget ? (
                    <HomeWeatherInset target={weatherTarget} />
                  ) : weatherPending ? (
                    <HomeWeatherInsetSkeleton label={weatherT('loading')} />
                  ) : null}
                </div>
              </div>
            ) : null}

            {trip.lifecycle === 'completed' ? (
              <div className="space-y-3">
                <p className="max-w-xl text-sm leading-6 text-white/78">
                  {t('states.completed.tripDescription', {
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
              destinations={primaryTripDestinations(trip.id, trip.lifecycle, trip.startDate)}
              inverse
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
        </div>
      </section>
    </div>
  );
}
