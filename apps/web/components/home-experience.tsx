'use client';

import {
  Bookmark,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Compass,
  Eye,
  MapPinned,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { ExperienceRatingSummary } from '@/components/experience-rating-field';
import { PageState } from '@/components/page-state';
import { OfflineReadyStatus } from '@/components/offline-ready-status';
import { Button } from '@/components/ui/button';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import {
  fetchTripModeContext,
  type ItineraryItem,
  type TripModeContext,
} from '@/lib/itinerary/api';
import { fetchSavedPlaces, type SavedPlace } from '@/lib/saved/api';
import { useProviderPlaceNames } from '@/lib/saved/provider-names';
import { fetchTrips, type Trip } from '@/lib/trips/api';

type HomeData = {
  savedPlaces: SavedPlace[];
  trips: Trip[];
};

type HomeStatus = 'error' | 'idle' | 'loading';

function localDate(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function calendarDayDistance(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

function isRecentlyCompleted(trip: Trip) {
  const daysSinceEnd = calendarDayDistance(trip.endDate, localDate(trip.referenceTimeZone));
  return daysSinceEnd >= 0 && daysSinceEnd <= 30;
}

function tripLabel(trip: Trip) {
  return trip.destinations.map((destination) => destination.name).join(', ');
}

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

function selectPrimaryTrip(trips: Trip[]) {
  const active = trips
    .filter((trip) => trip.lifecycle === 'active')
    .toSorted((left, right) => left.endDate.localeCompare(right.endDate));
  if (active[0]) return { kind: 'active' as const, trip: active[0] };

  const planning = trips
    .filter((trip) => trip.lifecycle === 'planning')
    .toSorted((left, right) => left.startDate.localeCompare(right.startDate));
  if (planning[0]) return { kind: 'planning' as const, trip: planning[0] };

  const completed = trips
    .filter((trip) => trip.lifecycle === 'completed' && isRecentlyCompleted(trip))
    .toSorted((left, right) => right.endDate.localeCompare(left.endDate));
  if (completed[0]) return { kind: 'completed' as const, trip: completed[0] };

  return null;
}

export function HomeExperience() {
  const t = useTranslations('home');
  const tripTranslations = useTranslations('trips');
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
  const primaryTripId = primary?.kind === 'active' ? primary.trip.id : null;

  // Only the three shown are worth resolving; a provider Place has no stored name,
  // so without this every one of them reads as the same placeholder.
  const shownSavedPlaces = useMemo(() => data.savedPlaces.slice(0, 3), [data.savedPlaces]);
  const providerNames = useProviderPlaceNames(
    useMemo(() => shownSavedPlaces.map((savedPlace) => savedPlace.place), [shownSavedPlaces]),
  );

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

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
        year: 'numeric',
      }),
    [locale],
  );

  if (status === 'loading') {
    return <PageState kind="loading" title={t('loading')} />;
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

  const formatDate = (value: string) => dateFormatter.format(new Date(`${value}T00:00:00.000Z`));
  const primaryTrip = primary?.trip ?? null;
  const otherTrips = primaryTrip
    ? data.trips.filter((trip) => trip.id !== primaryTrip.id).slice(0, 3)
    : [];
  const recentCompleted = data.trips
    .filter((trip) => trip.lifecycle === 'completed')
    .toSorted((left, right) => right.endDate.localeCompare(left.endDate))[0];
  const nextItemId = tripModeContext?.nextItemId ?? tripModeContext?.currentOrRelevant?.itemId;
  const nextItem = tripModeContext?.day?.items.find((item) => item.id === nextItemId) ?? null;
  const nextItemName = nextItem ? itemLabel(nextItem) : null;
  // Suggest only what is actually still missing, once, and never after a dismissal.
  const completedPromptKey =
    primary?.kind !== 'completed' || dismissedPrompts.includes(primary.trip.id)
      ? null
      : !primary.trip.memoryCount && primary.trip.experienceRating === null
        ? 'completedPrompt'
        : !primary.trip.memoryCount
          ? 'completedPromptMemories'
          : primary.trip.experienceRating === null
            ? 'completedPromptRating'
            : null;

  return (
    <section aria-labelledby="home-heading" className="mx-auto w-full max-w-5xl space-y-9">
      {primary ? (
        <header className="max-w-3xl">
          <h1
            className="text-[clamp(1.875rem,5vw,2.5rem)] leading-[1.12] font-semibold tracking-[-0.025em] text-pretty text-foreground"
            id="home-heading"
          >
            {t(`states.${primary.kind}.title`)}
          </h1>
          <p className="mt-3 max-w-[62ch] text-base leading-7 text-pretty text-muted-foreground">
            {t(`states.${primary.kind}.description`)}
          </p>
        </header>
      ) : (
        <header className="max-w-3xl">
          <h1
            className="text-[clamp(1.875rem,5vw,2.5rem)] leading-[1.12] font-semibold tracking-[-0.025em] text-pretty text-foreground"
            id="home-heading"
          >
            {t('states.empty.title')}
          </h1>
          <p className="mt-3 max-w-[62ch] text-base leading-7 text-pretty text-muted-foreground">
            {t('states.empty.description')}
          </p>
        </header>
      )}

      {primary?.kind === 'active' ? (
        <section className="rounded-[var(--radius-lg)] border border-border bg-card p-5 shadow-[var(--shadow-control)] sm:p-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-status-success">{t('activeLabel')}</p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-foreground">
                {primary.trip.name}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {tripLabel(primary.trip) || t('destinationOpen')}
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {tripTranslations('dateRange', {
                  endDate: formatDate(primary.trip.endDate),
                  startDate: formatDate(primary.trip.startDate),
                })}
              </p>
            </div>
            <Button nativeButton={false} render={<Link href={`/trips/${primary.trip.id}/mode`} />}>
              <Compass aria-hidden="true" data-icon="inline-start" />
              {t('openTripMode')}
            </Button>
          </div>

          <div className="mt-6 border-t border-border pt-5">
            <p className="text-sm font-medium text-foreground">{t('nextUp')}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {nextItemName
                ? t(tripModeContext?.nextItemId ? 'nextItem' : 'currentItem', {
                    name: nextItemName,
                  })
                : t('noNextItem')}
            </p>
          </div>
        </section>
      ) : null}

      {primary?.kind === 'planning' ? (
        <section className="rounded-[var(--radius-lg)] border border-border bg-card p-5 shadow-[var(--shadow-control)] sm:p-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-muted-foreground">{t('planningLabel')}</p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-foreground">
                {primary.trip.name}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t('countdown', {
                  count: Math.max(
                    0,
                    calendarDayDistance(
                      localDate(primary.trip.referenceTimeZone),
                      primary.trip.startDate,
                    ),
                  ),
                })}
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {tripTranslations('dateRange', {
                  endDate: formatDate(primary.trip.endDate),
                  startDate: formatDate(primary.trip.startDate),
                })}
              </p>
              <p className="mt-3 text-sm font-medium text-foreground">
                {t(`readiness.${primary.trip.planningReadiness}`)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                nativeButton={false}
                render={<Link href={`/trips/${primary.trip.id}/itinerary`} />}
              >
                <CalendarDays aria-hidden="true" data-icon="inline-start" />
                {t('continuePlanning')}
              </Button>
              <Button
                nativeButton={false}
                render={
                  <Link
                    href={`/trips/${primary.trip.id}/mode?preview=1&date=${primary.trip.startDate}&time=09%3A00`}
                  />
                }
                variant="outline"
              >
                <Eye aria-hidden="true" data-icon="inline-start" />
                {t('previewTripMode')}
              </Button>
            </div>
          </div>
          <div className="mt-6">
            <OfflineReadyStatus tripId={primary.trip.id} />
          </div>
        </section>
      ) : null}

      {primary?.kind === 'completed' ? (
        <section className="rounded-[var(--radius-lg)] border border-border bg-card p-5 shadow-[var(--shadow-control)] sm:p-6">
          <p className="text-sm font-medium text-muted-foreground">{t('completedLabel')}</p>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-foreground">
            {primary.trip.name}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t('states.completed.tripDescription', {
              endDate: formatDate(primary.trip.endDate),
              startDate: formatDate(primary.trip.startDate),
            })}
          </p>
          {primary.trip.experienceRating === null ? null : (
            <ExperienceRatingSummary
              className="mt-3"
              label={t('yourRating')}
              rating={primary.trip.experienceRating}
            />
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              nativeButton={false}
              render={<Link href={`/trips/${primary.trip.id}/memories`} />}
            >
              <Sparkles aria-hidden="true" data-icon="inline-start" />
              {t(primary.trip.memoryCount ? 'viewMemories' : 'addMemories')}
            </Button>
            <Button
              nativeButton={false}
              render={<Link href={`/trips/${primary.trip.id}/itinerary`} />}
              variant="outline"
            >
              <CalendarDays aria-hidden="true" data-icon="inline-start" />
              {t('viewTrip')}
            </Button>
          </div>
          {completedPromptKey ? (
            <div className="mt-5 flex items-start justify-between gap-3 border-t border-border pt-4">
              <p className="text-sm leading-6 text-muted-foreground">{t(completedPromptKey)}</p>
              <Button
                aria-label={t('dismissPrompt')}
                onClick={() => dismissCompletedPrompt(primary.trip.id)}
                size="icon-sm"
                variant="ghost"
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {!primary ? (
        <section className="rounded-[var(--radius-lg)] border border-border bg-card p-5 shadow-[var(--shadow-control)] sm:p-6">
          <MapPinned aria-hidden="true" className="size-5 text-brand" />
          <h2 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-foreground">
            {t('startTitle')}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            {t('startDescription')}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button nativeButton={false} render={<Link href="/trips?create=1" />}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('createTrip')}
            </Button>
            <Button nativeButton={false} render={<Link href="/saved" />} variant="outline">
              <Bookmark aria-hidden="true" data-icon="inline-start" />
              {t('viewSavedPlaces')}
            </Button>
          </div>
        </section>
      ) : null}

      {data.savedPlaces.length ? (
        <section aria-labelledby="saved-places-heading" className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.015em]" id="saved-places-heading">
              {t('savedPlacesTitle')}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t('savedPlacesDescription')}
            </p>
          </div>
          <ItemGroup aria-label={t('savedPlacesTitle')} variant="list">
            {shownSavedPlaces.map((savedPlace) => (
              <Item className="min-h-16 px-3 py-3" key={savedPlace.id} variant="default">
                <ItemMedia className="bg-secondary text-secondary-foreground" variant="icon">
                  <Bookmark aria-hidden="true" className="size-4" />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="truncate">
                    {savedPlace.place.name ??
                      providerNames[savedPlace.place.id] ??
                      t('savedPlaceFallback')}
                  </ItemTitle>
                  <ItemDescription className="line-clamp-1">
                    {savedPlace.note ?? savedPlace.place.note ?? t('savedPlaceDescription')}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
          <Button nativeButton={false} render={<Link href="/saved" />} size="sm" variant="ghost">
            {t('viewSavedPlaces')}
            <ChevronRight aria-hidden="true" data-icon="inline-end" />
          </Button>
        </section>
      ) : null}

      {otherTrips.length ? (
        <section aria-labelledby="other-trips-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold tracking-[-0.015em]" id="other-trips-heading">
              {t('otherTripsTitle')}
            </h2>
            <Button nativeButton={false} render={<Link href="/trips" />} size="sm" variant="ghost">
              {t('viewTrips')}
              <ChevronRight aria-hidden="true" data-icon="inline-end" />
            </Button>
          </div>
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
                    {tripTranslations('dateRange', {
                      endDate: formatDate(trip.endDate),
                      startDate: formatDate(trip.startDate),
                    })}
                  </ItemDescription>
                </ItemContent>
                <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
              </Item>
            ))}
          </ItemGroup>
        </section>
      ) : null}

      {!primary && recentCompleted ? (
        <section aria-labelledby="past-trip-heading" className="border-t border-border pt-6">
          <h2 className="text-lg font-semibold tracking-[-0.015em]" id="past-trip-heading">
            {t('pastTripTitle')}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
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
        </section>
      ) : null}
    </section>
  );
}
