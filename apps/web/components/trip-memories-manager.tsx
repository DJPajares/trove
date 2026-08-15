'use client';

import { CircleAlert, ImageOff, MapPin, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { PageState } from '@/components/page-state';
import { TripSectionHeader } from '@/components/trip-section-header';
import { Button } from '@/components/ui/button';
import { fetchMemories, type Memory } from '@/lib/memories/api';
import {
  buildTripStory,
  placeName,
  providerPlaceId,
  type StoryPlace,
  type TripStory,
} from '@/lib/memories/story';
import {
  cacheProviderPlaceDetails,
  getCachedProviderPlaceDetails,
  getProviderPlaceDetails,
} from '@/lib/saved/api';
import { fetchTrip, type Trip } from '@/lib/trips/api';

type LoadState =
  | { data: null; status: 'error' }
  | { data: null; status: 'loading' }
  | { data: { memories: Memory[]; trip: Trip }; status: 'ready' };

function MemoryPhotos({ memory, photoAlt }: Readonly<{ memory: Memory; photoAlt: string }>) {
  if (!memory.photos.length) return null;

  return (
    <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {memory.photos.map((photo) => (
        <li key={photo.id}>
          {photo.url ? (
            <img
              alt={memory.note ?? photoAlt}
              className="aspect-square w-full rounded-[var(--radius-md)] bg-muted/40 object-cover"
              loading="lazy"
              src={photo.url}
            />
          ) : (
            <span className="flex aspect-square w-full items-center justify-center rounded-[var(--radius-md)] bg-muted/40 text-muted-foreground">
              <ImageOff aria-hidden="true" className="size-5" />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * One captured moment, shown as the traveller left it: their own note, their own
 * photos, and the context already resolved when it was captured.
 */
function MemoryEntry({
  memory,
  photoAlt,
  time,
}: Readonly<{ memory: Memory; photoAlt: string; time: string | null }>) {
  return (
    <li className="border-b border-border py-5 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {time ? <p className="text-xs text-text-subtle tabular-nums">{time}</p> : null}
          {memory.note ? (
            <p className="mt-1 whitespace-pre-wrap text-base leading-7 text-pretty text-foreground">
              {memory.note}
            </p>
          ) : null}
        </div>
        {memory.isHighlight ? (
          <Sparkles aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
        ) : null}
      </div>
      <MemoryPhotos memory={memory} photoAlt={photoAlt} />
    </li>
  );
}

export function TripMemoriesManager({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('memories.story');
  const locale = useLocale();
  const [state, setState] = useState<LoadState>({ data: null, status: 'loading' });
  const [placeNames, setPlaceNames] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setState({ data: null, status: 'loading' });
    try {
      const [memories, trip] = await Promise.all([fetchMemories(tripId), fetchTrip(tripId)]);
      setState({ data: { memories: memories.memories, trip: trip.trip }, status: 'ready' });
    } catch {
      setState({ data: null, status: 'error' });
    }
  }, [tripId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const story: TripStory | null = useMemo(
    () => (state.data ? buildTripStory(state.data.memories) : null),
    [state.data],
  );

  // Provider Place names are resolved on demand and never stored as Trove data.
  useEffect(() => {
    if (!story) return;
    let active = true;
    const pending = story.places.flatMap((place) => {
      const externalPlaceId = place.tripPlace.name ? null : providerPlaceId(place.tripPlace);
      return externalPlaceId ? [{ externalPlaceId, tripPlaceId: place.tripPlace.id }] : [];
    });

    for (const { externalPlaceId, tripPlaceId } of pending) {
      const cached = getCachedProviderPlaceDetails(externalPlaceId);
      if (cached) {
        setPlaceNames((current) => ({ ...current, [tripPlaceId]: cached.name }));
        continue;
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) continue;
      void getProviderPlaceDetails(externalPlaceId)
        .then((result) => {
          if (!active || result.status !== 'ok' || !result.place) return;
          cacheProviderPlaceDetails(externalPlaceId, result.place);
          setPlaceNames((current) => ({ ...current, [tripPlaceId]: result.place!.name }));
        })
        .catch(() => undefined);
    }

    return () => {
      active = false;
    };
  }, [story]);

  if (state.status === 'loading') {
    return <PageState className="mx-auto max-w-5xl" kind="loading" title={t('loading')} />;
  }

  if (state.status === 'error' || !story) {
    return (
      <PageState
        actions={<Button onClick={() => void refresh()}>{t('tryAgain')}</Button>}
        className="mx-auto max-w-5xl"
        description={t('loadErrorDescription')}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const { trip } = state.data;
  const dateOnly = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(
      new Date(`${value}T00:00:00.000Z`),
    );
  const shortDate = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${value}T00:00:00.000Z`),
    );
  const localTime = (memory: Memory) => {
    if (!memory.capturedLocalTime) return null;
    const [hour, minute] = memory.capturedLocalTime.split(':');
    if (hour === undefined || minute === undefined) return null;
    return new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(`1970-01-01T${hour}:${minute}:00.000Z`));
  };
  const placeLabel = (place: StoryPlace) =>
    placeName(
      place.tripPlace,
      placeNames[place.tripPlace.id] ?? null,
      place.memories.find((memory) => memory.itineraryItem?.label)?.itineraryItem?.label ?? null,
    ) ?? t('unnamedPlace');

  const header = (
    <TripSectionHeader
      currentSection="memories"
      description={t('description', {
        end: shortDate(trip.endDate),
        start: shortDate(trip.startDate),
      })}
      title={t('title', { trip: trip.name })}
      tripId={tripId}
    />
  );

  if (!story.memoryCount) {
    return (
      <section className="mx-auto w-full max-w-5xl space-y-7">
        {header}
        <PageState
          className="min-h-64 justify-center"
          description={t('emptyDescription')}
          headingLevel={2}
          icon={<Sparkles aria-hidden="true" />}
          title={t('emptyTitle')}
        />
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl space-y-9">
      {header}

      <p className="text-sm leading-6 text-muted-foreground">
        {[
          t('memoryCount', { count: story.memoryCount }),
          story.photoCount ? t('photoCount', { count: story.photoCount }) : null,
          t('dayCount', { count: story.days.length }),
          story.places.length ? t('placeCount', { count: story.places.length }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {story.highlights.length ? (
        <section aria-labelledby="trip-story-highlights">
          <h2
            className="text-xl font-semibold tracking-[-0.02em] text-foreground"
            id="trip-story-highlights"
          >
            {t('highlights')}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t('highlightsDescription')}
          </p>
          <ul className="mt-3 border-y border-border">
            {story.highlights.map((memory) => (
              <MemoryEntry
                key={memory.id}
                memory={memory}
                photoAlt={t('photoAlt')}
                time={`${shortDate(memory.capturedLocalDate)}${
                  localTime(memory) ? ` · ${localTime(memory)}` : ''
                }`}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="trip-story-days">
        <h2
          className="text-xl font-semibold tracking-[-0.02em] text-foreground"
          id="trip-story-days"
        >
          {t('days')}
        </h2>
        <div className="mt-3 space-y-7">
          {story.days.map((day) => (
            <article aria-labelledby={`trip-story-day-${day.date}`} key={day.date}>
              <h3
                className="text-base font-semibold text-foreground"
                id={`trip-story-day-${day.date}`}
              >
                {dateOnly(day.date)}
              </h3>
              <ul className="mt-2 border-y border-border">
                {day.memories.map((memory) => (
                  <MemoryEntry
                    key={memory.id}
                    memory={memory}
                    photoAlt={t('photoAlt')}
                    time={localTime(memory)}
                  />
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {story.places.length ? (
        <section aria-labelledby="trip-story-places">
          <h2
            className="text-xl font-semibold tracking-[-0.02em] text-foreground"
            id="trip-story-places"
          >
            {t('places')}
          </h2>
          <div className="mt-3 space-y-7">
            {story.places.map((place) => (
              <article
                aria-labelledby={`trip-story-place-${place.tripPlace.id}`}
                key={place.tripPlace.id}
              >
                <h3
                  className="inline-flex items-center gap-2 text-base font-semibold text-foreground"
                  id={`trip-story-place-${place.tripPlace.id}`}
                >
                  <MapPin aria-hidden="true" className="size-4 shrink-0 text-brand" />
                  {placeLabel(place)}
                </h3>
                <ul className="mt-2 border-y border-border">
                  {place.memories.map((memory) => (
                    <MemoryEntry
                      key={memory.id}
                      memory={memory}
                      photoAlt={t('photoAlt')}
                      time={shortDate(memory.capturedLocalDate)}
                    />
                  ))}
                </ul>
              </article>
            ))}
          </div>
          {story.unplacedCount ? (
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              {t('unplaced', { count: story.unplacedCount })}
            </p>
          ) : null}
        </section>
      ) : null}

      <p className="border-t border-border pt-5 text-xs leading-5 text-text-subtle">
        {t('privacyNote')}
      </p>
    </section>
  );
}
