'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, ChevronRight, CircleAlert, MapPinned, Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { ExperienceRatingSummary } from '@/components/experience-rating-field';
import { HomeFocalTrip } from '@/components/home-focal-trip';
import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useTripCreation } from '@/components/trip-creation-provider';
import { TripListRow } from '@/components/trip-list-row';
import { Button } from '@/components/ui/button';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { selectCompletedPrompt } from '@/lib/home/completed-prompt';
import { resolveHomeWeatherTarget } from '@/lib/home/weather';
import {
  fetchTripModeContext,
  type ItineraryItem,
  type TripModeContext,
} from '@/lib/itinerary/api';
import { editorialCoverImage, editorialSubjectKey } from '@/lib/media/editorial-images';
import { fetchSavedPlaces, type SavedPlace } from '@/lib/saved/api';
import { fetchTrips, type Trip } from '@/lib/trips/api';
import { selectPrimaryTrip } from '@/lib/trips/lifecycle';
import { tripEditorialSubject } from '@/lib/trips/summary';
import { queryKeys } from '@/lib/query/keys';

type HomeData = {
  savedPlaces: SavedPlace[];
  trips: Trip[];
};

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

const EMPTY_SAVED_PLACES: SavedPlace[] = [];
const EMPTY_TRIPS: Trip[] = [];

export function HomeExperience() {
  const t = useTranslations('home');
  const { latestCreatedTrip, openCreateTrip } = useTripCreation();
  const queryClient = useQueryClient();
  // Both lists are shared with the Trips library and Saved Places, so arriving
  // at Home from either costs nothing.
  const tripsQuery = useQuery({ queryFn: fetchTrips, queryKey: queryKeys.trips() });
  const savedQuery = useQuery({ queryFn: fetchSavedPlaces, queryKey: queryKeys.savedPlaces() });
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

  // Saved Places are supplementary here: failing to load them leaves the
  // section empty rather than turning Home into an error screen, which is what
  // the original `.catch` on that request meant.
  const data: HomeData = {
    savedPlaces: savedQuery.data?.savedPlaces ?? EMPTY_SAVED_PLACES,
    trips: tripsQuery.data?.trips ?? EMPTY_TRIPS,
  };
  const status: HomeStatus = tripsQuery.isPending ? 'loading' : tripsQuery.error ? 'error' : 'idle';

  useEffect(() => {
    if (!latestCreatedTrip) return;
    queryClient.setQueryData(queryKeys.trips(), (current: { trips: Trip[] } | undefined) =>
      !current || current.trips.some((trip) => trip.id === latestCreatedTrip.id)
        ? current
        : { ...current, trips: [...current.trips, latestCreatedTrip] },
    );
  }, [latestCreatedTrip, queryClient]);

  const primary = useMemo(() => selectPrimaryTrip(data.trips), [data.trips]);
  // Only a trip actually under way has a "now" worth asking about.
  const primaryTripId = primary?.lifecycle === 'active' ? primary.id : null;

  const shownSavedPlaces = useMemo(() => data.savedPlaces.slice(0, 3), [data.savedPlaces]);

  const otherTrips = useMemo(
    () => (primary ? data.trips.filter((trip) => trip.id !== primary.id).slice(0, 3) : []),
    [data.trips, primary],
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
  const tripModeContextQuery = useQuery({
    enabled: primaryTripId !== null,
    queryFn: ({ signal }) => fetchTripModeContext(primaryTripId as string, { signal }),
    queryKey: queryKeys.tripModeContext(primaryTripId ?? '', {}),
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
    // Home is a page header, one tall card, and the sections beneath it, so that
    // is what waits here — at the card's real height, inside the same measure. A
    // 4:3 block beside a column of bars was a picture of a different screen.
    //
    // The header waits as bars rather than as real copy: its title and
    // description are keyed off the focal trip's lifecycle, which is exactly
    // what has not arrived yet.
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className="mx-auto w-full max-w-5xl space-y-9"
        role="status"
      >
        <span className="sr-only">{t('loading')}</span>
        <div aria-hidden="true">
          <Skeleton className="h-[calc(var(--text-page-title)*1.08)] w-2/3 max-w-sm" />
          {/* Each bar sits in a line box the height of the real description's
              leading, so the header keeps its height when the copy arrives. */}
          <div className="mt-3 max-w-[var(--layout-reading)]">
            <div className="flex h-[1.65rem] items-center">
              <Skeleton className="h-4 w-full" />
            </div>
            <div className="flex h-[1.65rem] items-center">
              <Skeleton className="h-4 w-4/5" />
            </div>
          </div>
        </div>
        <div aria-hidden="true" className="space-y-3">
          <Skeleton className="min-h-[31rem] w-full rounded-[var(--radius-2xl)] sm:min-h-[29rem] lg:min-h-[31rem]" />
        </div>
        <div aria-hidden="true" className="space-y-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-16 w-full rounded-[var(--radius-lg)]" />
          <Skeleton className="h-16 w-full rounded-[var(--radius-lg)]" />
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

  const recentCompleted = data.trips
    .filter((trip) => trip.lifecycle === 'completed')
    .toSorted((left, right) => right.endDate.localeCompare(left.endDate))[0];

  const nextItemId = tripModeContext?.nextItemId ?? tripModeContext?.currentOrRelevant?.itemId;
  const nextItemName = itemLabelFor(tripModeContext, nextItemId);
  const nextItem = nextItemName
    ? { label: nextItemName, upcoming: Boolean(tripModeContext?.nextItemId) }
    : null;
  const stage = primary?.lifecycle ?? 'empty';
  const weatherTarget =
    primary && !(primary.lifecycle === 'active' && tripModeContextStatus !== 'ready')
      ? resolveHomeWeatherTarget(primary, tripModeContext)
      : null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-9">
      <PageHeader
        description={t(`states.${stage}.description`)}
        headingId="home-heading"
        title={t(`states.${stage}.title`)}
      />

      {primary ? (
        <HomeFocalTrip
          editorial={focalEditorial}
          nextItem={nextItem}
          onDismissPrompt={dismissCompletedPrompt}
          promptKey={selectCompletedPrompt(primary, dismissedPrompts)}
          trip={primary}
          weatherPending={primary.lifecycle === 'active' && tripModeContextStatus !== 'ready'}
          weatherTarget={weatherTarget}
        />
      ) : (
        <PageState
          actions={
            <>
              <Button onClick={openCreateTrip}>
                <Plus aria-hidden="true" data-icon="inline-start" />
                {t('createTrip')}
              </Button>
              <Button nativeButton={false} render={<Link href="/saved" />} variant="outline">
                <Bookmark aria-hidden="true" data-icon="inline-start" />
                {t('viewSavedPlaces')}
              </Button>
            </>
          }
          description={t('startDescription')}
          headingLevel={2}
          icon={<MapPinned aria-hidden="true" />}
          kind="empty"
          scope="section"
          title={t('startTitle')}
        />
      )}

      {data.savedPlaces.length ? (
        <EditorialSection
          actions={
            <Button nativeButton={false} render={<Link href="/saved" />} size="sm" variant="ghost">
              {t('viewSavedPlaces')}
              <ChevronRight aria-hidden="true" data-icon="inline-end" />
            </Button>
          }
          density="compact"
          headerLayout="inline"
          title={t('savedPlacesTitle')}
          treatment="ruled"
        >
          <ItemGroup aria-label={t('savedPlacesTitle')} variant="list">
            {shownSavedPlaces.map((savedPlace) => (
              <Item className="min-h-16 px-3 py-3" key={savedPlace.id} variant="default">
                <ItemMedia className="bg-secondary text-secondary-foreground" variant="icon">
                  <Bookmark aria-hidden="true" className="size-4" />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="truncate">
                    {savedPlace.place.name ??
                      savedPlace.place.snapshot?.name ??
                      savedPlace.place.providerLabel ??
                      t('savedPlaceFallback')}
                  </ItemTitle>
                  <ItemDescription className="line-clamp-1">
                    {savedPlace.note ?? savedPlace.place.note ?? t('savedPlaceDescription')}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        </EditorialSection>
      ) : null}

      {otherTrips.length ? (
        <section aria-labelledby="other-trips-heading" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2
              className="min-w-0 text-[length:var(--text-section-title)] font-semibold tracking-[-0.02em] text-foreground"
              id="other-trips-heading"
            >
              {t('otherTripsTitle')}
            </h2>
            <Button
              className="shrink-0"
              nativeButton={false}
              render={<Link href="/trips" />}
              size="sm"
              variant="ghost"
            >
              {t('viewTrips')}
              <ChevronRight aria-hidden="true" data-icon="inline-end" />
            </Button>
          </div>
          <div className="grid gap-3">
            {otherTrips.map((trip) => (
              <TripListRow editorial={editorialFor(trip)} key={trip.id} trip={trip} />
            ))}
          </div>
        </section>
      ) : null}

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
