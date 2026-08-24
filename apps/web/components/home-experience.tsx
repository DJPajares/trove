'use client';

import { Bookmark, ChevronRight, CircleAlert, MapPinned, Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { ExperienceRatingSummary } from '@/components/experience-rating-field';
import { HomeFocalTrip } from '@/components/home-focal-trip';
import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
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
import { editorialSubjectKey } from '@/lib/media/editorial-images';
import { fetchSavedPlaces, type SavedPlace } from '@/lib/saved/api';
import { fetchTrips, type Trip } from '@/lib/trips/api';
import { selectPrimaryTrip } from '@/lib/trips/lifecycle';
import { tripEditorialSubject } from '@/lib/trips/summary';

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

export function HomeExperience() {
  const t = useTranslations('home');
  const [data, setData] = useState<HomeData>({ savedPlaces: [], trips: [] });
  const [status, setStatus] = useState<HomeStatus>('loading');
  const [tripModeContext, setTripModeContext] = useState<TripModeContext | null>(null);
  const [tripModeContextStatus, setTripModeContextStatus] = useState<'idle' | 'loading' | 'ready'>(
    'idle',
  );
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

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetchTrips(),
      fetchSavedPlaces().catch(() => ({ collections: [], savedPlaces: [] })),
    ])
      .then(([tripResponse, savedResponse]) => {
        if (!active) return;
        setData({ savedPlaces: savedResponse.savedPlaces, trips: tripResponse.trips });
        setStatus('idle');
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => {
      active = false;
    };
  }, []);

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
  const focalEditorial = focalSubject
    ? (editorialImages.get(editorialSubjectKey(focalSubject))?.[0] ?? null)
    : null;
  const editorialFor = (trip: Trip) => {
    const subject = tripEditorialSubject(trip);
    return subject ? (editorialImages.get(editorialSubjectKey(subject))?.[0] ?? null) : null;
  };

  useEffect(() => {
    if (!primaryTripId) {
      setTripModeContext(null);
      setTripModeContextStatus('idle');
      return;
    }
    let active = true;
    setTripModeContextStatus('loading');
    void fetchTripModeContext(primaryTripId)
      .then((context) => {
        if (!active) return;
        setTripModeContext(context);
        setTripModeContextStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setTripModeContext(null);
        setTripModeContextStatus('ready');
      });
    return () => {
      active = false;
    };
  }, [primaryTripId]);

  if (status === 'loading') {
    return <PageState kind="loading" loadingShape="media" title={t('loading')} />;
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
      {!primary ? (
        <PageHeader
          description={t(`states.${stage}.description`)}
          headingId="home-heading"
          title={t(`states.${stage}.title`)}
        />
      ) : null}

      {primary ? (
        <HomeFocalTrip
          editorial={focalEditorial}
          nextItem={nextItem}
          onDismissPrompt={dismissCompletedPrompt}
          promptKey={selectCompletedPrompt(primary, dismissedPrompts)}
          trip={primary}
          weatherTarget={weatherTarget}
        />
      ) : (
        <PageState
          actions={
            <>
              <Button nativeButton={false} render={<Link href="/trips?create=1" />}>
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
          description={t('savedPlacesDescription')}
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
              className="text-[length:var(--text-section-title)] font-semibold tracking-[-0.02em] text-foreground"
              id="other-trips-heading"
            >
              {t('otherTripsTitle')}
            </h2>
            <Button nativeButton={false} render={<Link href="/trips" />} size="sm" variant="ghost">
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
            render={
              <Link
                href={`/trips/${recentCompleted.id}/${recentCompleted.memoryCount ? 'memories' : 'itinerary'}`}
              />
            }
            size="sm"
            variant="ghost"
          >
            {t(recentCompleted.memoryCount ? 'viewMemories' : 'viewTrip')}
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
