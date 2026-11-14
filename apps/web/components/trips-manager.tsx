'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Archive, ChevronRight, CircleAlert, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Suspense, useEffect, useMemo, useState } from 'react';

import { AiPlanningDraftCard } from '@/components/ai-planning-draft-card';
import { HomeSheet } from '@/components/home/home-front-door';
import Link from 'next/link';
import { TripArchiveFeedback } from '@/components/trip-archive-feedback';
import { TripDestinationActions } from '@/components/trip-destination-actions';
import { PageState } from '@/components/page-state';
import { useTripCreation } from '@/components/trip-creation-provider';
import { LibraryAhead } from '@/components/trips-library/library-ahead';
import { LibraryEmpty, LibraryNothingAhead } from '@/components/trips-library/library-empty';
import { LibraryCover } from '@/components/trips-library/library-cover';
import { LibraryRemembered } from '@/components/trips-library/library-remembered';
import { LibrarySkeleton } from '@/components/trips-library/library-skeleton';
import { Button } from '@/components/ui/button';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { deviceTimeZone, fetchTripModeContext } from '@/lib/itinerary/api';
import { editorialCoverImage, editorialSubjectKey } from '@/lib/media/editorial-images';
import { queryKeys } from '@/lib/query/keys';
import { fetchTrips, type Trip } from '@/lib/trips/api';
import {
  lensCounts,
  parseTripLens,
  showLensFilter,
  TRIP_LENSES,
  tripsForLens,
  type TripLens,
} from '@/lib/trips/library-lens';
import { groupTripsForLibrary } from '@/lib/trips/lifecycle';
import { primaryTripDestinations, withLiveTripModeFirst } from '@/lib/trips/navigation';
import { resolveTripNextUp } from '@/lib/trips/next-up';
import { useEntrance, type EntranceClock } from '@/lib/page-entrance';
import { libraryEditorialSubjects, tripEditorialSubject } from '@/lib/trips/summary';
import { useLibraryView } from '@/lib/trips/use-library-view';
import { ScrollShadow } from '@/components/ui/scroll-shadow';

const EMPTY_TRIPS: Trip[] = [];

/** As many covers as a row of dots stays readable for. */
const COVER_TRIP_LIMIT = 6;

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
/**
 * The library's entrance, kept for the tab's life: the prefetched loading
 * boundary and the page that replaces it are two mounts of this screen, and
 * they share one entrance. A later visit plays it again.
 */
const libraryEntrance: EntranceClock = { startedAt: null };

export function TripsManager() {
  const t = useTranslations('trips');
  const libraryT = useTranslations('trips.library');
  const lensT = useTranslations('trips.library.lenses');
  const pathname = usePathname();
  const router = useRouter();
  const { latestCreatedTrip, openCreateTrip } = useTripCreation();
  const queryClient = useQueryClient();
  const tripsQuery = useQuery({ queryFn: () => fetchTrips(), queryKey: queryKeys.trips() });
  const trips = (tripsQuery.data?.trips ?? EMPTY_TRIPS).filter((trip) => !trip.archivedAt);
  const archivedCount = tripsQuery.data?.archivedTripCount ?? 0;
  // A failed background refresh must not replace a usable library with an error.
  const status = tripsQuery.data ? 'idle' : tripsQuery.isPending ? 'loading' : 'error';
  const view = useLibraryView(tripsQuery.data !== undefined);
  const entrance = useEntrance(libraryEntrance, { ready: status === 'idle', replay: true });

  const library = useMemo(() => groupTripsForLibrary(trips), [trips]);
  const lead = library.featured;

  // The lens lives in the URL, so Back from a trip returns to it while the
  // Trips tab - and a new session - starts on the whole library, where the
  // trip under way leads. Read once on arrival, replaced on change.
  const [coverPosition, setCoverPosition] = useState(0);
  const [lens, setLens] = useState<TripLens>('all');
  useEffect(() => {
    setLens(parseTripLens(new URLSearchParams(window.location.search).get('show')));
  }, []);
  const filterable = useMemo(() => showLensFilter(trips), [trips]);
  const counts = useMemo(() => lensCounts(trips), [trips]);
  const activeLens: TripLens = filterable ? lens : 'all';
  const lensTrips = useMemo(() => tripsForLens(trips, activeLens), [activeLens, trips]);

  function chooseLens(next: TripLens) {
    setLens(next);
    const params = new URLSearchParams(window.location.search);
    if (next === 'all') params.delete('show');
    else params.set('show', next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

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

  // The cover leads with the trip under way or next and carries the trips
  // after it, in the order they leave. Every photograph comes from the one
  // editorial request above; a slide never asks for its own.
  const coverTrips = lead ? [lead, ...library.ahead].slice(0, COVER_TRIP_LIMIT) : [];
  const coverIndex = Math.min(coverPosition, Math.max(0, coverTrips.length - 1));
  const coverTrip = coverTrips[coverIndex] ?? null;

  const intents = (
    <>
      <Suspense fallback={null}>
        <TripCreationIntent />
      </Suspense>
      <Suspense fallback={null}>
        <TripArchiveFeedback />
      </Suspense>
    </>
  );

  if (status !== 'idle') {
    return (
      <section className="mx-auto w-full max-w-5xl">
        {intents}
        {status === 'loading' ? (
          <LibrarySkeleton label={t('loading')} />
        ) : (
          <PageState
            actions={<Button onClick={() => void tripsQuery.refetch()}>{t('tryAgain')}</Button>}
            description={t('loadErrorDescription')}
            icon={<CircleAlert aria-hidden="true" />}
            kind="error"
            title={t('loadError')}
          />
        )}
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl" style={entrance.style}>
      {intents}
      <LibraryCover
        description={libraryT('description')}
        index={coverIndex}
        nextUp={resolveTripNextUp(tripModeContextQuery.data ?? null)}
        onIndexChange={setCoverPosition}
        slides={coverTrips.map((trip) => ({ editorial: editorialFor(trip), trip }))}
        title={t('title')}
      />

      <HomeSheet>
        {/* The actions belong to the trip in view on the cover, so they change
          as it is swiped. A phone already carries Create at the centre of its
          bottom bar, so New trip is the desktop's. */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          {coverTrip ? (
            <TripDestinationActions
              destinations={withLiveTripModeFirst(
                primaryTripDestinations(coverTrip.id, coverTrip.lifecycle, coverTrip.startDate),
                coverTrip.lifecycle,
              )}
              key={coverTrip.id}
              labelOverrides={{
                itinerary: t('continuePlanning'),
                // A trip already under way is carried on with, not started
                // again; one that has not left yet is honestly offering a preview.
                mode: t(coverTrip.lifecycle === 'active' ? 'continueTrip' : 'previewTripMode'),
              }}
            />
          ) : null}
          {trips.length ? (
            <Button className="ms-auto max-md:hidden" onClick={openCreateTrip} variant="outline">
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('newTrip')}
            </Button>
          ) : null}
        </div>

        {filterable ? (
          // Chips, not tabs (PRD 10): a light way to narrow, with the library
          // itself always one tap away. A lens with nothing in it is not offered.
          <ChipGroup
            render={<ScrollShadow orientation="horizontal" />}
            aria-label={lensT('label')}
            className="-mx-1 mb-5 flex-nowrap px-1 pb-1 sm:mb-6"
            multiple={false}
            onValueChange={([value]) => chooseLens(parseTripLens(value))}
            value={[activeLens]}
          >
            {TRIP_LENSES.filter(
              (option) => option === 'all' || counts[option] > 0 || option === activeLens,
            ).map((option) => (
              <Chip key={option} value={option}>
                {option === 'all'
                  ? lensT('all')
                  : lensT('count', { count: counts[option], label: lensT(option) })}
              </Chip>
            ))}
          </ChipGroup>
        ) : null}

        {activeLens !== 'all' ? (
          lensTrips.length === 0 ? (
            <PageState
              actions={
                <>
                  <Button onClick={() => chooseLens('all')} variant="outline">
                    {lensT('showAll')}
                  </Button>
                  {activeLens === 'upcoming' ? (
                    <Button onClick={openCreateTrip}>{t('newTrip')}</Button>
                  ) : null}
                </>
              }
              description={lensT(`empty.${activeLens}.description`)}
              headingLevel={2}
              kind="empty"
              title={lensT(`empty.${activeLens}.title`)}
            />
          ) : activeLens === 'past' ? (
            <LibraryRemembered
              editorialFor={editorialFor}
              expanded
              foldable={false}
              onExpandedChange={view.setExpanded}
              trips={lensTrips}
            />
          ) : (
            <LibraryAhead
              editorialFor={editorialFor}
              onCreateTrip={openCreateTrip}
              title={lensT(activeLens)}
              trips={lensTrips}
            />
          )
        ) : trips.length === 0 ? (
          <>
            {/* A draft is reachable on a traveller's very first visit, before
              there is any trip for it to sit among. */}
            <AiPlanningDraftCard />
            <LibraryEmpty onCreateTrip={openCreateTrip} />
          </>
        ) : (
          <>
            {lead ? null : (
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

        {/* Archived trips are kept, not shown: one quiet way in at the end of
          the collection, where tidying a library naturally happens. */}
        {archivedCount > 0 && (activeLens === 'all' || activeLens === 'past') ? (
          <Link
            className="group -mt-4 flex min-h-12 items-center gap-3 rounded-[var(--radius-lg)] px-1 text-sm text-muted-foreground outline-none transition-colors duration-[var(--motion-standard)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 sm:-mt-6"
            href="/trips/archived"
          >
            <Archive aria-hidden="true" className="size-4 shrink-0" />
            <span className="flex-1">{t('archive.viewCount', { count: archivedCount })}</span>
            <ChevronRight
              aria-hidden="true"
              className="size-4 shrink-0 transition-transform duration-[var(--motion-standard)] group-hover:translate-x-0.5 motion-reduce:transition-none"
            />
          </Link>
        ) : null}
      </HomeSheet>
    </section>
  );
}
