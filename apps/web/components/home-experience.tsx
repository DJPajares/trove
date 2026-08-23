'use client';

import { Bookmark, CalendarDays, ChevronRight, CircleAlert, MapPinned, Plus } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { ExperienceRatingSummary } from '@/components/experience-rating-field';
import { HomeFocalTrip } from '@/components/home-focal-trip';
import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
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
import {
  fetchTripModeContext,
  type ItineraryItem,
  type TripModeContext,
} from '@/lib/itinerary/api';
import { editorialSubjectKey } from '@/lib/media/editorial-images';
import { fetchSavedPlaces, type SavedPlace } from '@/lib/saved/api';
import { fetchTrips, type Trip } from '@/lib/trips/api';
import { formatTripDateRange } from '@/lib/trips/format';
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
  const locale = useLocale();
  const [data, setData] = useState<HomeData>({ savedPlaces: [], trips: [] });
  const [status, setStatus] = useState<HomeStatus>('loading');
  const [tripModeContext, setTripModeContext] = useState<TripModeContext | null>(null);
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

  // Home leads with one trip and paints one photograph. Asking for more would be
  // a second row of decoration bought with a provider round-trip.
  const focalSubject = primary ? tripEditorialSubject(primary) : null;
  const editorialImages = useEditorialImages(focalSubject ? [focalSubject] : []);
  const focalEditorial = focalSubject
    ? (editorialImages.get(editorialSubjectKey(focalSubject)) ?? null)
    : null;

  useEffect(() => {
    if (!primaryTripId) {
      setTripModeContext(null);
      return;
    }
    let active = true;
    void fetchTripModeContext(primaryTripId)
      .then((context) => {
        if (active) setTripModeContext(context);
      })
      .catch(() => {
        if (active) setTripModeContext(null);
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

  const otherTrips = primary ? data.trips.filter((trip) => trip.id !== primary.id).slice(0, 3) : [];
  const recentCompleted = data.trips
    .filter((trip) => trip.lifecycle === 'completed')
    .toSorted((left, right) => right.endDate.localeCompare(left.endDate))[0];

  const nextItemId = tripModeContext?.nextItemId ?? tripModeContext?.currentOrRelevant?.itemId;
  const nextItemName = itemLabelFor(tripModeContext, nextItemId);
  const nextItem = nextItemName
    ? { label: nextItemName, upcoming: Boolean(tripModeContext?.nextItemId) }
    : null;
  const stage = primary?.lifecycle ?? 'empty';

  return (
    <section aria-labelledby="home-heading" className="mx-auto w-full max-w-5xl space-y-9">
      {/* The header carries no media and no actions: with media, PageHeader puts
          its actions under the image and collapses to one column on a phone,
          which would push the trip's own next action below a photograph. Both
          belong to the focal card instead. */}
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

      {/* Everything below is a way back to something, not something to browse:
          they stay text so the one photograph above keeps its weight, and so
          Home never pays for a second batch of provider imagery. */}
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
        <EditorialSection
          actions={
            <Button nativeButton={false} render={<Link href="/trips" />} size="sm" variant="ghost">
              {t('viewTrips')}
              <ChevronRight aria-hidden="true" data-icon="inline-end" />
            </Button>
          }
          density="compact"
          title={t('otherTripsTitle')}
          treatment="ruled"
        >
          <ItemGroup aria-label={t('otherTripsTitle')} variant="list">
            {otherTrips.map((trip) => (
              <Item
                className="min-h-16 px-3 py-3 hover:bg-muted/60"
                key={trip.id}
                render={<Link href={`/trips/${trip.id}/itinerary`} />}
                variant="default"
              >
                <ItemMedia className="bg-secondary text-secondary-foreground" variant="icon">
                  <CalendarDays aria-hidden="true" className="size-4" />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="truncate">{trip.name}</ItemTitle>
                  <ItemDescription className="line-clamp-1">
                    {formatTripDateRange(trip.startDate, trip.endDate, locale)}
                  </ItemDescription>
                </ItemContent>
                <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
              </Item>
            ))}
          </ItemGroup>
        </EditorialSection>
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
    </section>
  );
}

function itemLabelFor(context: TripModeContext | null, itemId: string | undefined) {
  const item = context?.day?.items.find((entry) => entry.id === itemId);
  return item ? itemLabel(item) : null;
}
