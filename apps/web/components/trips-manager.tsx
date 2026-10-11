'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CircleAlert, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Suspense, useEffect, useMemo } from 'react';

import { AiPlanningDraftCard } from '@/components/ai-planning-draft-card';
import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import { useTripCreation } from '@/components/trip-creation-provider';
import { LibraryAhead } from '@/components/trips-library/library-ahead';
import { LibraryEmpty, LibraryNothingAhead } from '@/components/trips-library/library-empty';
import { LibraryLead } from '@/components/trips-library/library-lead';
import { LibraryRemembered } from '@/components/trips-library/library-remembered';
import { LibrarySkeleton } from '@/components/trips-library/library-skeleton';
import { Button } from '@/components/ui/button';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { deviceTimeZone, fetchTripModeContext } from '@/lib/itinerary/api';
import { editorialCoverImage, editorialSubjectKey } from '@/lib/media/editorial-images';
import { queryKeys } from '@/lib/query/keys';
import { fetchTrips, type Trip } from '@/lib/trips/api';
import { groupTripsForLibrary } from '@/lib/trips/lifecycle';
import { resolveTripNextUp } from '@/lib/trips/next-up';
import { libraryEditorialSubjects, tripEditorialSubject } from '@/lib/trips/summary';
import { useLibraryView } from '@/lib/trips/use-library-view';

const EMPTY_TRIPS: Trip[] = [];

// URL intent may suspend during prerendering. Keep it inside its own boundary
// so the library also works as the route's cache-aware loading fallback.
function TripCreationIntent() {
  const { openCreateTrip } = useTripCreation();
  const pathname = usePathname();
  const router = useRouter();
  const shouldCreateTrip = useSearchParams().get('create') === '1';

  useEffect(() => {
    if (!shouldCreateTrip) return;
    openCreateTrip();
    router.replace(pathname, { scroll: false });
  }, [openCreateTrip, pathname, router, shouldCreateTrip]);

  return null;
}

/**
 * The traveller's trips, as a library in three tenses (PRD 10): the journey
 * they are on or leaving for next, the trips ahead of them as a calendar of
 * departures, and the trips they have taken, kept as stories. Each tense opens
 * the experience it belongs to - planning, Trip Mode, Memories - so the page is
 * the bridge between the three rather than a list of records.
 *
 * The library creates trips; editing, sharing and deleting a trip belong to
 * the trip's own screens, where the traveller can see what they are changing.
 */
export function TripsManager() {
  const t = useTranslations('trips');
  const libraryT = useTranslations('trips.library');
  const { latestCreatedTrip, openCreateTrip } = useTripCreation();
  const queryClient = useQueryClient();
  const tripsQuery = useQuery({ queryFn: fetchTrips, queryKey: queryKeys.trips() });
  const trips = tripsQuery.data?.trips ?? EMPTY_TRIPS;
  // A failed background refresh must not replace a usable library with an error.
  const status = tripsQuery.data ? 'idle' : tripsQuery.isPending ? 'loading' : 'error';
  const view = useLibraryView(tripsQuery.data !== undefined);

  const library = useMemo(() => groupTripsForLibrary(trips), [trips]);
  const lead = library.featured;

  // Only the lead trip says what is next, and only a trip actually under way
  // has a next. The key and its options match Home's and Trip Mode's, so moving
  // between the three re-reads one answer rather than buying another - this
  // endpoint can reach Routes.
  const leadActiveTripId = lead?.lifecycle === 'active' ? lead.id : null;
  const clockTimeZone = deviceTimeZone();
  const languageCode = useLocale();
  const tripModeContextQuery = useQuery({
    enabled: leadActiveTripId !== null,
    queryFn: ({ signal }) =>
      fetchTripModeContext(leadActiveTripId as string, { clockTimeZone, languageCode, signal }),
    queryKey: queryKeys.tripModeContext(leadActiveTripId ?? '', { clockTimeZone, languageCode }),
  });

  // One request for the whole library, in priority order and capped, however
  // many trips a traveller has. Every trip reads from the answer; none asks.
  const editorialImages = useEditorialImages(libraryEditorialSubjects(library));
  const editorialFor = (trip: Trip) => {
    const subject = tripEditorialSubject(trip);
    return subject
      ? editorialCoverImage(editorialImages.get(editorialSubjectKey(subject)), trip.id)
      : null;
  };

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
    <section className="mx-auto w-full max-w-5xl space-y-10 sm:space-y-12">
      <Suspense fallback={null}>
        <TripCreationIntent />
      </Suspense>
      <PageHeader
        actions={
          // A phone already carries Create at the centre of its bottom bar,
          // and the lead trip deserves the first screen more than a second one.
          <Button className="max-md:hidden" onClick={openCreateTrip}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('newTrip')}
          </Button>
        }
        description={libraryT('description')}
        title={t('title')}
      />

      {status === 'loading' ? (
        <LibrarySkeleton label={t('loading')} />
      ) : status === 'error' ? (
        <PageState
          actions={<Button onClick={() => void tripsQuery.refetch()}>{t('tryAgain')}</Button>}
          description={t('loadErrorDescription')}
          headingLevel={2}
          icon={<CircleAlert aria-hidden="true" />}
          kind="error"
          title={t('loadError')}
        />
      ) : trips.length === 0 ? (
        <>
          {/* A draft is reachable on a traveller's very first visit, before
              there is any trip for it to sit among. */}
          <AiPlanningDraftCard />
          <LibraryEmpty onCreateTrip={openCreateTrip} />
        </>
      ) : (
        <>
          {lead ? (
            <LibraryLead
              animateEntrance={view.animateEntrance}
              editorial={editorialFor(lead)}
              nextUp={resolveTripNextUp(tripModeContextQuery.data ?? null)}
              trip={lead}
            />
          ) : (
            <>
              <LibraryNothingAhead onCreateTrip={openCreateTrip} />
              <AiPlanningDraftCard />
            </>
          )}

          {lead ? (
            <LibraryAhead
              editorialFor={editorialFor}
              leading={<AiPlanningDraftCard headingLevel={3} />}
              onCreateTrip={openCreateTrip}
              trips={library.ahead}
            />
          ) : null}

          <LibraryRemembered
            editorialFor={editorialFor}
            expanded={view.expanded}
            onExpandedChange={view.setExpanded}
            trips={library.past}
          />
        </>
      )}
    </section>
  );
}
