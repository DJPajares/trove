import { Info, Share2 } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { TripDestinationActions } from '@/components/trip-destination-actions';
import { TripItineraryCoverage } from '@/components/trip-itinerary-coverage';
import { TripLifecycleBadge } from '@/components/trip-lifecycle-badge';
import { TripMedia } from '@/components/trip-media';
import { Button } from '@/components/ui/button';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import type { Trip } from '@/lib/trips/api';
import { formatTripDate } from '@/lib/trips/format';
import { primaryTripDestinations } from '@/lib/trips/navigation';
import { tripDestinationSummary } from '@/lib/trips/summary';

export type TripFeaturedCardProps = {
  editorial: EditorialImageReference | null;
  /** Opens the share dialog the library owns, so one dialog serves every card. */
  onShare: () => void;
  trip: Trip;
};

export function TripFeaturedCard({ editorial, onShare, trip }: Readonly<TripFeaturedCardProps>) {
  const t = useTranslations('trips');
  const share = useTranslations('trips.share');
  const mediaTranslations = useTranslations('media');
  const locale = useLocale();
  const subjectName = trip.destinations[0]?.name ?? trip.name;

  return (
    <section
      aria-labelledby="featured-trip-heading"
      className="overflow-hidden rounded-[var(--radius-2xl)] border border-border-subtle bg-card shadow-[var(--shadow-card)]"
    >
      <div className="grid md:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        <div className="min-w-0">
          <TripMedia
            alt={editorial ? mediaTranslations('alt.tripEditorial', { name: subjectName }) : ''}
            className="h-56 w-full rounded-none md:h-full md:min-h-[24rem]"
            preload
            sizes="(max-width: 767px) 100vw, (max-width: 1279px) 55vw, 580px"
            source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
            variant="card"
          />
        </div>

        <div className="flex min-w-0 flex-col justify-center gap-4 p-5 sm:p-6 lg:p-8">
          <TripLifecycleBadge className="w-fit" lifecycle={trip.lifecycle} />
          <div className="space-y-2">
            <h2
              className="text-[length:var(--text-section-title)] leading-[1.12] font-semibold tracking-[-0.03em] text-balance text-foreground sm:text-3xl"
              id="featured-trip-heading"
            >
              {trip.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tripDestinationSummary(trip) ?? t('destinationOpen')}
            </p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {t('dateRange', {
                endDate: formatTripDate(trip.endDate, locale),
                startDate: formatTripDate(trip.startDate, locale),
              })}
            </p>
            {trip.lifecycle === 'planning' ? (
              <p className="text-sm font-medium text-foreground">
                {t(`readinessState.${trip.planningReadiness}`)}
              </p>
            ) : null}
          </div>

          {trip.lifecycle !== 'completed' && trip.itineraryCoverage ? (
            <TripItineraryCoverage coverage={trip.itineraryCoverage} />
          ) : null}

          <TripDestinationActions
            destinations={primaryTripDestinations(trip.id, trip.lifecycle, trip.startDate)}
            extra={
              // One flex item, not two, so the pair can never be split across lines
              // with one control orphaned below - which is what left the overview
              // button sitting alone under the row. Left-aligned: they follow the
              // text actions directly rather than being pushed to the far edge, and
              // when the row runs out of width they wrap together, still reading as
              // a continuation of the actions rather than a separate cluster.
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  aria-label={share('action')}
                  onClick={onShare}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Share2 aria-hidden="true" />
                </Button>
                <Button
                  aria-label={t('overview')}
                  nativeButton={false}
                  render={<Link href={`/trips/${trip.id}`} />}
                  size="icon"
                  variant="ghost"
                >
                  <Info aria-hidden="true" />
                </Button>
              </div>
            }
            labelOverrides={
              trip.lifecycle === 'completed'
                ? { memories: t('viewMemories') }
                : {
                    itinerary: t('continuePlanning'),
                    mode: t(trip.lifecycle === 'active' ? 'openTripMode' : 'previewTripMode'),
                  }
            }
          />
        </div>
      </div>
    </section>
  );
}
