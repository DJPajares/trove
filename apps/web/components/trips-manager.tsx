'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CircleAlert, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo } from 'react';

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
import { libraryLedger } from '@/lib/trips/library';
import { groupTripsForLibrary } from '@/lib/trips/lifecycle';
import { resolveTripNextUp } from '@/lib/trips/next-up';
import { libraryEditorialSubjects, tripEditorialSubject } from '@/lib/trips/summary';

const EMPTY_TRIPS: Trip[] = [];

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
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const shouldCreateTrip = searchParams.get('create') === '1';
  const queryClient = useQueryClient();
  const tripsQuery = useQuery({ queryFn: fetchTrips, queryKey: queryKeys.trips() });
  const trips = tripsQuery.data?.trips ?? EMPTY_TRIPS;
  const status = tripsQuery.isPending ? 'loading' : tripsQuery.error ? 'error' : 'idle';

  const library = useMemo(() => groupTripsForLibrary(trips), [trips]);
  const ledger = useMemo(() => libraryLedger(trips), [trips]);
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

  // The line under the title counts what the library holds, and leaves out
  // whatever it holds none of rather than announcing a zero.
  const ledgerParts = [
    ledger.ahead ? libraryT('ledger.ahead', { count: ledger.ahead }) : null,
    ledger.remembered ? libraryT('ledger.remembered', { count: ledger.remembered }) : null,
    ledger.countries ? libraryT('ledger.countries', { count: ledger.countries }) : null,
  ].filter(Boolean);

  return (
    <section className="mx-auto w-full max-w-5xl space-y-10 sm:space-y-12">
      <PageHeader
        actions={
          // A phone already carries Create at the centre of its bottom bar,
          // and the lead trip deserves the first screen more than a second one.
          <Button className="max-md:hidden" onClick={openCreateTrip}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('newTrip')}
          </Button>
        }
        meta={status === 'idle' && ledgerParts.length ? ledgerParts.join(' · ') : undefined}
        title={t('title')}
      />

      {status === 'loading' ? (
        <LibrarySkeleton label={t('loading')} />
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

          <LibraryRemembered editorialFor={editorialFor} trips={library.past} />
        </>
      )}
    </section>
  );
}
