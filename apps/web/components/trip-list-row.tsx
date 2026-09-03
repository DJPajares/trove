import { CalendarDays, ChevronRight, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { TripItineraryCoverage } from '@/components/trip-itinerary-coverage';
import { TripLifecycleBadge } from '@/components/trip-lifecycle-badge';
import { TripMedia } from '@/components/trip-media';
import { TripReadinessBadge } from '@/components/trip-readiness-badge';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import type { Trip } from '@/lib/trips/api';
import { formatTripDate } from '@/lib/trips/format';
import { tripDestinationSummary } from '@/lib/trips/summary';
import { cn } from '@/lib/utils';

export type TripListRowProps = {
  editorial: EditorialImageReference | null;
  trip: Trip;
  variant?: 'archive' | 'card';
};

export function TripListRow({ editorial, trip, variant = 'card' }: Readonly<TripListRowProps>) {
  const t = useTranslations('trips');
  const mediaTranslations = useTranslations('media');
  const locale = useLocale();
  const subjectName = trip.destinations[0]?.name ?? trip.name;
  const isArchive = variant === 'archive';

  return (
    <Link
      aria-label={t('viewTripLabel', { name: trip.name })}
      className={cn(
        'group grid min-w-0 grid-cols-[4.75rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius-xl)] border border-border-subtle bg-card p-3 text-left shadow-[var(--shadow-card)] transition-[border-color,background-color,box-shadow,transform] duration-[var(--motion-standard)] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-elevated)] focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none motion-reduce:transform-none motion-reduce:transition-none',
        isArchive && 'grid-cols-[3.5rem_minmax(0,1fr)_auto] rounded-[var(--radius-lg)] shadow-none',
      )}
      href={`/trips/${trip.id}`}
    >
      <TripMedia
        alt={editorial ? mediaTranslations('alt.tripEditorial', { name: subjectName }) : ''}
        className={cn('size-[4.75rem]', isArchive && 'size-14')}
        sizes={isArchive ? '56px' : '76px'}
        source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
        variant="thumbnail"
      />

      <div className="min-w-0 space-y-1.5">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <h3 className="line-clamp-1 font-semibold tracking-[-0.01em] text-foreground">
            {trip.name}
          </h3>
          {!isArchive ? (
            <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
              <TripLifecycleBadge lifecycle={trip.lifecycle} />
              <TripReadinessBadge lifecycle={trip.lifecycle} readiness={trip.planningReadiness} />
            </div>
          ) : null}
        </div>
        <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
          {tripDestinationSummary(trip) ?? t('destinationOpen')}
        </p>
        <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground tabular-nums">
          <CalendarDays aria-hidden="true" className="size-3.5 shrink-0" />
          {t('dateRange', {
            endDate: formatTripDate(trip.endDate, locale),
            startDate: formatTripDate(trip.startDate, locale),
          })}
        </p>
        {!isArchive && trip.lifecycle !== 'completed' && trip.itineraryCoverage ? (
          <TripItineraryCoverage className="pt-1" coverage={trip.itineraryCoverage} />
        ) : null}
      </div>

      <ChevronRight
        aria-hidden="true"
        className="size-4 text-muted-foreground transition-transform duration-[var(--motion-standard)] group-hover:translate-x-0.5 motion-reduce:transition-none"
      />
    </Link>
  );
}
