import { CalendarDays } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { MediaAttribution } from '@/components/media-attribution';
import { TripLifecycleBadge } from '@/components/trip-lifecycle-badge';
import { TripMedia } from '@/components/trip-media';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import type { Trip } from '@/lib/trips/api';
import { formatTripDateRange } from '@/lib/trips/format';
import { tripDestinationSummary } from '@/lib/trips/summary';

export type TripListRowProps = {
  /**
   * Resolved by the library's single batch, never fetched here. One request per
   * screen is a hard invariant: a row that asked for its own photograph would
   * turn a list of trips back into a list of requests.
   */
  editorial: EditorialImageReference | null;
  onSelect: (trip: Trip) => void;
  trip: Trip;
};

/** One trip in the library, as a single target that opens its overview. */
export function TripListRow({ editorial, onSelect, trip }: Readonly<TripListRowProps>) {
  const t = useTranslations('trips');
  const mediaTranslations = useTranslations('media');
  const locale = useLocale();
  const subjectName = trip.destinations[0]?.name ?? trip.name;

  return (
    <Item
      className="group min-h-20 flex-nowrap px-3 py-3 text-left hover:bg-muted/60"
      render={
        <button
          aria-label={t('viewTripLabel', { name: trip.name })}
          onClick={() => onSelect(trip)}
          type="button"
        />
      }
      variant="default"
    >
      <ItemMedia className="size-14 rounded-[var(--radius-md)] sm:size-16" variant="default">
        <TripMedia
          alt={editorial ? mediaTranslations('alt.tripEditorial', { name: subjectName }) : ''}
          className="size-full"
          // A thumbnail this size cannot carry a legible credit, so the row
          // renders it below instead.
          credit="inline"
          sizes="64px"
          source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
          variant="thumbnail"
        />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-1.5">
        <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <ItemTitle className="line-clamp-2 max-w-full text-base sm:line-clamp-1">
            {trip.name}
          </ItemTitle>
          <TripLifecycleBadge className="shrink-0" lifecycle={trip.lifecycle} />
        </div>
        <ItemDescription className="line-clamp-2 sm:line-clamp-1">
          <CalendarDays aria-hidden="true" className="mr-1.5 inline size-3.5" />
          {formatTripDateRange(trip.startDate, trip.endDate, locale)}
        </ItemDescription>
        <p className="truncate text-xs text-muted-foreground">
          {tripDestinationSummary(trip) ?? t('destinationOpen')}
          {trip.planningReadiness === 'ready' ? ` · ${t('ready')}` : ''}
        </p>
        {editorial ? (
          <MediaAttribution
            attribution={editorial.attribution}
            // The row is a button, so the credit cannot be a link here.
            className="truncate"
            linked={false}
            variant="inline"
          />
        ) : null}
      </ItemContent>
    </Item>
  );
}
