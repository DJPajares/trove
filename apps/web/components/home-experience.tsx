'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, CircleAlert, MapPinned, Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { ExperienceRatingSummary } from '@/components/experience-rating-field';
import { HomeFocalTrip } from '@/components/home-focal-trip';
import { HomeGreeting } from '@/components/home-greeting';
import { HomeTripDeck } from '@/components/home-trip-deck';
import { PageState } from '@/components/page-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useTripCreation } from '@/components/trip-creation-provider';
import { Button } from '@/components/ui/button';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { selectCompletedPrompt } from '@/lib/home/completed-prompt';
import { resolveHomeWeatherTarget } from '@/lib/home/weather';
import {
  deviceTimeZone,
  fetchTripModeContext,
  type ItineraryItem,
  type TripModeContext,
} from '@/lib/itinerary/api';
import { editorialCoverImage, editorialSubjectKey } from '@/lib/media/editorial-images';
import { fetchTrips, type Trip } from '@/lib/trips/api';
import { selectPrimaryTrip } from '@/lib/trips/lifecycle';
import { tripEditorialSubject } from '@/lib/trips/summary';
import { queryKeys } from '@/lib/query/keys';

type HomeStatus = 'error' | 'idle' | 'loading';

/**
 * A traveller who skips Memories or a rating should be asked once, not every
 * time they open Home. The dismissal is per trip and purely local: it hides a
 * suggestion, so it never needs to travel with the account.
 */
const DISMISSED_PROMPTS_KEY = 'trove.dismissed-completed-prompts';

function readDismissedPrompts() {
  try {
    const raw = window.localStorage.getItem(DISMISSED_PROMPTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function itemLabel(item: ItineraryItem) {
  return item.customLabel ?? item.customLocation?.label ?? item.tripPlace?.place.name ?? null;
}

const EMPTY_TRIPS: Trip[] = [];

export function HomeExperience() {
  const t = useTranslations('home');
  const { latestCreatedTrip, openCreateTrip } = useTripCreation();
  const queryClient = useQueryClient();
  // Shared with the Trips library, so arriving at Home from it costs nothing.
  const tripsQuery = useQuery({ queryFn: fetchTrips, queryKey: queryKeys.trips() });
  const [dismissedPrompts, setDismissedPrompts] = useState<string[]>([]);

  useEffect(() => {
    setDismissedPrompts(readDismissedPrompts());
  }, []);

  function dismissCompletedPrompt(tripId: string) {
    setDismissedPrompts((current) => {
      const next = current.includes(tripId) ? current : [...current, tripId];
      try {
        window.localStorage.setItem(DISMISSED_PROMPTS_KEY, JSON.stringify(next));
      } catch {
        // The prompt stays hidden for this session even without local storage.
      }
      return next;
    });
  }

  const trips = tripsQuery.data?.trips ?? EMPTY_TRIPS;
  const status: HomeStatus = tripsQuery.isPending ? 'loading' : tripsQuery.error ? 'error' : 'idle';

  useEffect(() => {
    if (!latestCreatedTrip) return;
    queryClient.setQueryData(queryKeys.trips(), (current: { trips: Trip[] } | undefined) =>
      !current || current.trips.some((trip) => trip.id === latestCreatedTrip.id)
        ? current
        : { ...current, trips: [...current.trips, latestCreatedTrip] },
    );
  }, [latestCreatedTrip, queryClient]);

  const primary = useMemo(() => selectPrimaryTrip(trips), [trips]);
  // Only a trip actually under way has a "now" worth asking about.
  const primaryTripId = primary?.lifecycle === 'active' ? primary.id : null;

  const otherTrips = useMemo(
    () => (primary ? trips.filter((trip) => trip.id !== primary.id).slice(0, 3) : []),
    [primary, trips],
  );
  const shownTrips = useMemo(
    () => (primary ? [primary, ...otherTrips] : otherTrips),
    [otherTrips, primary],
  );
  // One capped request resolves every photograph Home may render. Cards only
  // read this map and never ask the editorial service themselves.
  const editorialSubjects = useMemo(
    () => shownTrips.flatMap((trip) => tripEditorialSubject(trip) ?? []),
    [shownTrips],
  );
  const editorialImages = useEditorialImages(editorialSubjects);
  const focalSubject = primary ? tripEditorialSubject(primary) : null;
  const focalEditorial =
    focalSubject && primary
      ? editorialCoverImage(editorialImages.get(editorialSubjectKey(focalSubject)), primary.id)
      : null;
  const editorialFor = (trip: Trip) => {
    const subject = tripEditorialSubject(trip);
    return subject
      ? editorialCoverImage(editorialImages.get(editorialSubjectKey(subject)), trip.id)
      : null;
  };

  /**
   * Home asks for one trip's "now", never one per trip in the list - this
   * endpoint can reach Routes and Places, and a per-trip loop over it is
   * exactly the shape that turns a home screen into a bill.
   *
   * Trip Mode reads the same key, so walking from Home into Trip Mode reuses
   * this answer instead of buying it twice.
   */
  // Trip Mode runs on the traveller's own clock, and these surfaces show the
  // same answer, so they have to ask the same question.
  const clockTimeZone = deviceTimeZone();
  const tripModeContextQuery = useQuery({
    enabled: primaryTripId !== null,
    queryFn: ({ signal }) =>
      fetchTripModeContext(primaryTripId as string, { clockTimeZone, signal }),
    queryKey: queryKeys.tripModeContext(primaryTripId ?? '', { clockTimeZone }),
  });

  const tripModeContext = tripModeContextQuery.data ?? null;
  // A context that would not load is not an error worth showing on Home; the
  // section simply renders without it.
  const tripModeContextStatus = !primaryTripId
    ? 'idle'
    : tripModeContextQuery.isPending
      ? 'loading'
      : 'ready';

  if (status === 'loading') {
    // Home is a greeting, one tall card, and the deck beneath it, so that is
    // what waits here — at the card's real height, inside the same measure.
    //
    // The greeting waits as bars rather than as real copy: the name comes with
    // the profile and the line beneath it is keyed off the focal trip's
    // lifecycle, which is exactly what has not arrived yet.
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className="mx-auto w-full max-w-5xl space-y-9"
        role="status"
      >
        <span className="sr-only">{t('loading')}</span>
        <div aria-hidden="true" className="flex flex-col gap-4 sm:flex-row sm:justify-between">
          <div className="min-w-0 pe-[3.25rem] sm:pe-0">
            <Skeleton className="h-[calc(var(--text-page-title)*1.08)] w-2/3 max-w-sm" />
            {/* Each bar sits in a line box the height of the real description's
                leading, so the greeting keeps its height when the copy arrives. */}
            <div className="mt-2 max-w-[var(--layout-reading)]">
              <div className="flex h-[1.65rem] items-center">
                <Skeleton className="h-4 w-full" />
              </div>
              <div className="flex h-[1.65rem] items-center">
                <Skeleton className="h-4 w-4/5" />
              </div>
            </div>
          </div>
          <Skeleton className="h-9 w-44 shrink-0 rounded-full sm:mt-1" />
        </div>
        <Skeleton className="min-h-[33rem] w-full rounded-[var(--radius-2xl)] sm:min-h-[31rem] lg:min-h-[34rem]" />
        <div aria-hidden="true" className="space-y-4">
          <Skeleton className="h-7 w-44" />
          <div className="flex gap-4">
            <Skeleton className="h-[17rem] w-[86%] shrink-0 rounded-[var(--radius-2xl)] sm:w-[58%] lg:w-[38%]" />
            <Skeleton className="hidden h-[17rem] w-[58%] shrink-0 rounded-[var(--radius-2xl)] sm:block lg:w-[38%]" />
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <PageState
        actions={<Button onClick={() => window.location.reload()}>{t('tryAgain')}</Button>}
        description={t('loadErrorDescription')}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const recentCompleted = trips
    .filter((trip) => trip.lifecycle === 'completed')
    .toSorted((left, right) => right.endDate.localeCompare(left.endDate))[0];

  const nextItemId = tripModeContext?.nextItemId ?? tripModeContext?.currentOrRelevant?.itemId;
  const nextItemName = itemLabelFor(tripModeContext, nextItemId);
  const nextItem = nextItemName
    ? { label: nextItemName, upcoming: Boolean(tripModeContext?.nextItemId) }
    : null;
  const weatherTarget =
    primary && !(primary.lifecycle === 'active' && tripModeContextStatus !== 'ready')
      ? resolveHomeWeatherTarget(primary, tripModeContext)
      : null;
  /**
   * What the weather pill calls the place it is reporting on.
   *
   * The first destination that has coordinates, because that is the one the
   * server measures: `resolveTripWeatherLocation` walks the destinations in
   * order and takes the first located one. Reading the same rule here means the
   * label and the reading cannot name different places.
   *
   * Null rather than the trip's name when it has no destination yet. "A Quick
   * New Zealand Getaway" is not somewhere it can be 16 degrees, and a line that
   * looks like a place has to be one.
   */
  const weatherLocationLabel =
    primary?.destinations.find((destination) => destination.location)?.name.trim() ||
    primary?.destinations[0]?.name.trim() ||
    null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-9">
      <HomeGreeting locationLabel={weatherLocationLabel} weatherTarget={weatherTarget} />

      {primary ? (
        <HomeFocalTrip
          editorial={focalEditorial}
          nextItem={nextItem}
          onDismissPrompt={dismissCompletedPrompt}
          promptKey={selectCompletedPrompt(primary, dismissedPrompts)}
          trip={primary}
          tripModeContext={tripModeContext}
        />
      ) : (
        <PageState
          actions={
            <Button onClick={openCreateTrip}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('createTrip')}
            </Button>
          }
          description={t('startDescription')}
          headingLevel={2}
          icon={<MapPinned aria-hidden="true" />}
          kind="empty"
          scope="section"
          title={t('startTitle')}
        />
      )}

      {otherTrips.length ? <HomeTripDeck editorialFor={editorialFor} trips={otherTrips} /> : null}

      {!primary && recentCompleted ? (
        <EditorialSection density="compact" title={t('pastTripTitle')} treatment="ruled">
          <p className="text-sm leading-6 text-muted-foreground">
            {t('pastTripDescription', { name: recentCompleted.name })}
          </p>
          {recentCompleted.experienceRating === null ? null : (
            <ExperienceRatingSummary
              className="mt-2"
              label={t('yourRating')}
              rating={recentCompleted.experienceRating}
            />
          )}
          <Button
            className="mt-3"
            nativeButton={false}
            render={<Link href={`/trips/${recentCompleted.id}/memories`} />}
            size="sm"
            variant="ghost"
          >
            {t('viewMemories')}
            <ChevronRight aria-hidden="true" data-icon="inline-end" />
          </Button>
        </EditorialSection>
      ) : null}
    </div>
  );
}

function itemLabelFor(context: TripModeContext | null, itemId: string | undefined) {
  const item = context?.day?.items.find((entry) => entry.id === itemId);
  return item ? itemLabel(item) : null;
}
