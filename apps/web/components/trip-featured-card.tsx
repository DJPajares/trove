import { Info, Share2 } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { TripDestinationActions } from '@/components/trip-destination-actions';
import { TripLifecycleBadge } from '@/components/trip-lifecycle-badge';
import { TripMedia } from '@/components/trip-media';
import { TripProgress } from '@/components/trip-progress';
import { TripReadinessBadge } from '@/components/trip-readiness-badge';
import { TripReadinessPrompt } from '@/components/trip-readiness-prompt';
import { Button } from '@/components/ui/button';
import type { TripModeContext } from '@/lib/itinerary/api';
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
  /** Fetched by the library for the featured trip only, and only when active. */
  tripModeContext?: TripModeContext | null;
};

export function TripFeaturedCard({
  editorial,
  onShare,
  trip,
  tripModeContext = null,
}: Readonly<TripFeaturedCardProps>) {
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
      <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        <div className="relative min-w-0">
          <TripMedia
            alt={editorial ? mediaTranslations('alt.tripEditorial', { name: subjectName }) : ''}
            className="h-56 w-full rounded-none lg:h-full lg:min-h-[24rem]"
            preload
            sizes="(max-width: 1023px) 100vw, (max-width: 1279px) 55vw, 580px"
            source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
            variant="card"
          />
          <Button
            aria-label={share('action')}
            className="absolute top-3 right-3 size-10 rounded-full border border-media-fallback-foreground/18 bg-neutral-950/58 text-media-fallback-foreground shadow-sm backdrop-blur-sm hover:bg-neutral-950/78 hover:text-media-fallback-foreground"
            onClick={onShare}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Share2 aria-hidden="true" />
          </Button>
        </div>

        <div className="flex min-w-0 flex-col justify-center gap-4 p-5 sm:p-6 lg:p-8">
          <div className="flex flex-wrap items-center gap-1.5">
            <TripLifecycleBadge lifecycle={trip.lifecycle} />
            <TripReadinessBadge lifecycle={trip.lifecycle} readiness={trip.planningReadiness} />
          </div>
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
          </div>

          <TripProgress trip={trip} tripModeContext={tripModeContext} />

          <TripDestinationActions
            className="flex-nowrap"
            destinations={primaryTripDestinations(trip.id, trip.lifecycle, trip.startDate)}
            extra={
              <Button
                aria-label={t('overview')}
                className="shrink-0"
                nativeButton={false}
                render={<Link href={`/trips/${trip.id}`} />}
                size="icon"
                variant="ghost"
              >
                <Info aria-hidden="true" />
              </Button>
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

          <TripReadinessPrompt trip={trip} />
        </div>
      </div>
    </section>
  );
}
