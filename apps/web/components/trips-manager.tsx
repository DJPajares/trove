'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, CircleAlert, MapPinned, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import { useTripCreation } from '@/components/trip-creation-provider';
import { TripFeaturedCard } from '@/components/trip-featured-card';
import { TripListRow } from '@/components/trip-list-row';
import { TripShareDialog } from '@/components/trip-share-dialog';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { editorialSubjectKey } from '@/lib/media/editorial-images';
import { groupTripsForLibrary, PAST_TRIPS_PREVIEW_COUNT } from '@/lib/trips/lifecycle';
import { libraryEditorialSubjects, tripEditorialSubject } from '@/lib/trips/summary';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { fetchTrips, type Trip } from '@/lib/trips/api';
import { queryKeys } from '@/lib/query/keys';

/**
 * The library creates trips; editing and deleting a trip belong to the trip's
 * own route, where the traveller can see what they are changing.
 */
const EMPTY_TRIPS: Trip[] = [];

export function TripsManager() {
  const t = useTranslations('trips');
  const { latestCreatedTrip, openCreateTrip } = useTripCreation();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const shouldCreateTrip = searchParams.get('create') === '1';
  const queryClient = useQueryClient();
  const tripsQuery = useQuery({ queryFn: fetchTrips, queryKey: queryKeys.trips() });
  const trips = tripsQuery.data?.trips ?? EMPTY_TRIPS;
  const status = tripsQuery.isPending ? 'loading' : tripsQuery.error ? 'error' : 'idle';

  // The library owns one dialog for whichever trip asked for it, rather than a
  // mounted dialog per card.
  const [sharingTripId, setSharingTripId] = useState<string | null>(null);
  const sharingTrip = trips.find((trip) => trip.id === sharingTripId) ?? null;

  const groupedTrips = useMemo(() => groupTripsForLibrary(trips), [trips]);

  // One request for the whole library, in priority order and capped, however
  // many trips a traveller has. Rows read from the answer; none of them ask.
  const editorialImages = useEditorialImages(libraryEditorialSubjects(groupedTrips));
  const editorialFor = (trip: Trip) => {
    const subject = tripEditorialSubject(trip);
    return subject ? (editorialImages.get(editorialSubjectKey(subject))?.[0] ?? null) : null;
  };

  useEffect(() => {
    if (!shouldCreateTrip) return;
    openCreateTrip();
    router.replace(pathname, { scroll: false });
  }, [openCreateTrip, pathname, router, shouldCreateTrip]);

  useEffect(() => {
    if (!latestCreatedTrip) return;
    queryClient.setQueryData(queryKeys.trips(), (current: { trips: Trip[] } | undefined) => {
      if (!current) return current;
      if (current.trips.some((trip) => trip.id === latestCreatedTrip.id)) return current;
      return {
        ...current,
        trips: [...current.trips, latestCreatedTrip].toSorted((left, right) =>
          left.startDate.localeCompare(right.startDate),
        ),
      };
    });
  }, [latestCreatedTrip, queryClient]);

  return (
    <section className="mx-auto w-full max-w-5xl space-y-8">
      <PageHeader
        actions={
          <Button onClick={openCreateTrip}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('newTrip')}
          </Button>
        }
        description={t('description')}
        title={t('title')}
      />

      {status === 'loading' ? (
        <PageState
          headingLevel={2}
          kind="loading"
          loadingShape="list"
          scope="section"
          title={t('loading')}
        />
      ) : status === 'error' ? (
        <PageState
          actions={<Button onClick={() => window.location.reload()}>{t('tryAgain')}</Button>}
          description={t('loadErrorDescription')}
          headingLevel={2}
          icon={<CircleAlert aria-hidden="true" />}
          kind="error"
          title={t('loadError')}
        />
      ) : trips.length === 0 ? (
        <PageState
          actions={
            <Button onClick={openCreateTrip}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('createFirstTrip')}
            </Button>
          }
          description={t('emptyDescription')}
          headingLevel={2}
          icon={<MapPinned aria-hidden="true" />}
          kind="empty"
          title={t('emptyTitle')}
        />
      ) : (
        <div className="space-y-8">
          {groupedTrips.featured ? (
            <TripFeaturedCard
              editorial={editorialFor(groupedTrips.featured)}
              onShare={() => setSharingTripId(groupedTrips.featured?.id ?? null)}
              trip={groupedTrips.featured}
            />
          ) : null}

          {groupedTrips.upcoming.length ? (
            <section aria-labelledby="upcoming-trips-heading" className="space-y-4">
              <h2
                className="text-[length:var(--text-section-title)] font-semibold tracking-[-0.02em] text-foreground"
                id="upcoming-trips-heading"
              >
                {t('sections.planning')}
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                {groupedTrips.upcoming.map((trip) => (
                  <TripListRow editorial={editorialFor(trip)} key={trip.id} trip={trip} />
                ))}
              </div>
            </section>
          ) : null}

          {groupedTrips.past.length ? (
            <section aria-labelledby="past-trips-heading" className="space-y-4">
              <h2
                className="text-[length:var(--text-section-title)] font-semibold tracking-[-0.02em] text-foreground"
                id="past-trips-heading"
              >
                {t('sections.completed')}
              </h2>
              <div className="grid gap-3">
                {groupedTrips.past.slice(0, PAST_TRIPS_PREVIEW_COUNT).map((trip) => (
                  <TripListRow
                    editorial={editorialFor(trip)}
                    key={trip.id}
                    trip={trip}
                    variant="archive"
                  />
                ))}
              </div>
              {groupedTrips.past.length > PAST_TRIPS_PREVIEW_COUNT ? (
                <Collapsible>
                  <CollapsiblePanel>
                    <div className="mt-3 grid gap-3">
                      {groupedTrips.past.slice(PAST_TRIPS_PREVIEW_COUNT).map((trip) => (
                        <TripListRow
                          editorial={editorialFor(trip)}
                          key={trip.id}
                          trip={trip}
                          variant="archive"
                        />
                      ))}
                    </div>
                  </CollapsiblePanel>
                  <CollapsibleTrigger className="group mt-3">
                    <ChevronDown
                      aria-hidden="true"
                      className="transition-transform duration-[var(--motion-standard)] group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
                    />
                    <span className="group-data-[panel-open]:hidden">
                      {t('showAllPast', { count: groupedTrips.past.length })}
                    </span>
                    <span className="hidden group-data-[panel-open]:inline">
                      {t('showFewerPast')}
                    </span>
                  </CollapsibleTrigger>
                </Collapsible>
              ) : null}
            </section>
          ) : null}
        </div>
      )}

      {/* The saved trip is written straight back into the library's own cache, so
          the card the traveller just shared reflects it without a refetch. */}
      {sharingTrip ? (
        <TripShareDialog
          onOpenChange={(open) => !open && setSharingTripId(null)}
          onTripChange={(updated) =>
            queryClient.setQueryData(queryKeys.trips(), (current: { trips: Trip[] } | undefined) =>
              current
                ? {
                    ...current,
                    trips: current.trips.map((trip) => (trip.id === updated.id ? updated : trip)),
                  }
                : current,
            )
          }
          open
          trip={sharingTrip}
        />
      ) : null}
    </section>
  );
}
