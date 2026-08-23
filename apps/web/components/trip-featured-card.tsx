import { Info } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { TripDestinationActions } from '@/components/trip-destination-actions';
import { TripLifecycleBadge } from '@/components/trip-lifecycle-badge';
import { TripMedia } from '@/components/trip-media';
import { Button } from '@/components/ui/button';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import type { Trip } from '@/lib/trips/api';
import { formatTripDateRange } from '@/lib/trips/format';
import { primaryTripDestinations } from '@/lib/trips/navigation';
import { tripDestinationSummary } from '@/lib/trips/summary';

export type TripFeaturedCardProps = {
  /** Resolved by the library's single batch. This card never fetches. */
  editorial: EditorialImageReference | null;
  /** The overview is a sheet rather than a route, so it cannot be a destination. */
  onOpenOverview: (trip: Trip) => void;
  trip: Trip;
};

/**
 * The trip the library leads with: the one being travelled, or the next one
 * being planned.
 *
 * A focal block offers its actions; only a row is a single target. So this is a
 * section containing real links and one button, never a button containing
 * links - which would be invalid markup and a keyboard trap besides.
 */
export function TripFeaturedCard({
  editorial,
  onOpenOverview,
  trip,
}: Readonly<TripFeaturedCardProps>) {
  const t = useTranslations('trips');
  const mediaTranslations = useTranslations('media');
  const locale = useLocale();
  const subjectName = trip.destinations[0]?.name ?? trip.name;

  return (
    <section
      aria-labelledby="featured-trip-heading"
      className="rounded-[var(--radius-xl)] border border-border-subtle bg-surface-tint p-5 sm:p-6"
    >
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] sm:items-start sm:gap-6">
        {/* Text and actions first at every width, so the primary action is
            reachable without scrolling past a photograph. */}
        <div className="min-w-0 space-y-3">
          <TripLifecycleBadge lifecycle={trip.lifecycle} />
          <h2
            className="text-[length:var(--text-section-title)] leading-[1.18] font-semibold tracking-[-0.022em] text-pretty text-foreground"
            id="featured-trip-heading"
          >
            {trip.name}
          </h2>
          <p className="text-[length:var(--text-metadata)] text-muted-foreground tabular-nums">
            {formatTripDateRange(trip.startDate, trip.endDate, locale)}
          </p>
          <p className="text-sm text-muted-foreground">
            {tripDestinationSummary(trip) ?? t('destinationOpen')}
            {trip.planningReadiness === 'ready' ? ` · ${t('ready')}` : ''}
          </p>
          <TripDestinationActions
            className="pt-1"
            destinations={primaryTripDestinations(trip.id, trip.lifecycle, trip.startDate)}
            extra={
              <Button onClick={() => onOpenOverview(trip)} variant="ghost">
                <Info aria-hidden="true" data-icon="inline-start" />
                {t('overview')}
              </Button>
            }
            labelOverrides={
              trip.lifecycle === 'completed'
                ? { memories: t(trip.memoryCount ? 'viewMemories' : 'addMemories') }
                : {
                    itinerary: t('continuePlanning'),
                    mode: t(trip.lifecycle === 'active' ? 'openTripMode' : 'previewTripMode'),
                  }
            }
          />
        </div>
        <TripMedia
          alt={editorial ? mediaTranslations('alt.tripEditorial', { name: subjectName }) : ''}
          className="h-40 w-full sm:h-full sm:min-h-[11rem]"
          // The library's largest image, and in practice its Largest Contentful
          // Paint - Next reports it as such if this is left to load lazily.
          preload
          sizes="(max-width: 639px) 100vw, (max-width: 1023px) 40vw, 340px"
          source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
          variant="card"
        />
      </div>
    </section>
  );
}
