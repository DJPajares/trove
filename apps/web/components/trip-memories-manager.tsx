'use client';

import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ImageOff,
  MapPin,
  Pencil,
  Plus,
  Sparkles,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { ExperienceRatingField } from '@/components/experience-rating-field';
import { MemoryEditorDialog } from '@/components/memory-editor-dialog';
import { PageState } from '@/components/page-state';
import { StoryCoverPicker } from '@/components/story-cover-picker';
import { TripSectionHeader } from '@/components/trip-section-header';
import { Button } from '@/components/ui/button';
import {
  fetchItinerary,
  updateItineraryDayExperienceRating,
  type Itinerary,
} from '@/lib/itinerary/api';
import { fetchMemories, reorderHighlights, type Memory, type StoryCover } from '@/lib/memories/api';
import { buildTripStory, placeName, type StoryPlace, type TripStory } from '@/lib/memories/story';
import { useProviderPlaceNames } from '@/lib/saved/provider-names';
import { fetchTrip, updateTripExperienceRating, type Trip } from '@/lib/trips/api';
import { cn } from '@/lib/utils';

type LoadState =
  | { data: null; status: 'error' }
  | { data: null; status: 'loading' }
  | {
      data: { memories: Memory[]; storyCover: StoryCover | null; trip: Trip };
      status: 'ready';
    };

type EditorState =
  | { memory: null; mode: 'closed' }
  | { memory: null; mode: 'create' }
  | { memory: Memory; mode: 'edit' };

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
 * photos, and the context already resolved when it was captured. An edit
 * affordance, and optional Highlights reorder controls, sit alongside it.
 */
function MemoryEntry({
  anchorId,
  highlighted,
  highlightControls,
  memory,
  onEdit,
  photoAlt,
  time,
}: Readonly<{
  anchorId?: string;
  highlighted?: boolean;
  highlightControls?: { onMoveDown: (() => void) | null; onMoveUp: (() => void) | null };
  memory: Memory;
  onEdit: () => void;
  photoAlt: string;
  time: string | null;
}>) {
  const t = useTranslations('memories.story');

  return (
    <li
      className={cn(
        'border-b border-border py-5 last:border-b-0',
        highlighted
          ? '-mx-3 rounded-[var(--radius-md)] bg-secondary/60 px-3 transition-colors duration-[var(--motion-standard)]'
          : undefined,
      )}
      id={anchorId}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {time ? <p className="text-xs text-text-subtle tabular-nums">{time}</p> : null}
          {memory.note ? (
            <p className="mt-1 whitespace-pre-wrap text-base leading-7 text-pretty text-foreground">
              {memory.note}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {memory.isHighlight ? (
            <Sparkles aria-hidden="true" className="mr-1 size-4 shrink-0 text-brand" />
          ) : null}
          {highlightControls ? (
            <>
              <Button
                aria-label={t('moveHighlightUp')}
                disabled={!highlightControls.onMoveUp}
                onClick={() => highlightControls.onMoveUp?.()}
                size="icon-sm"
                variant="ghost"
              >
                <ChevronUp aria-hidden="true" />
              </Button>
              <Button
                aria-label={t('moveHighlightDown')}
                disabled={!highlightControls.onMoveDown}
                onClick={() => highlightControls.onMoveDown?.()}
                size="icon-sm"
                variant="ghost"
              >
                <ChevronDown aria-hidden="true" />
              </Button>
            </>
          ) : null}
          <Button aria-label={t('editMemory')} onClick={onEdit} size="icon-sm" variant="ghost">
            <Pencil aria-hidden="true" />
          </Button>
        </div>
      </div>
      <MemoryPhotos memory={memory} photoAlt={photoAlt} />
    </li>
  );
}

export function TripMemoriesManager({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('memories.story');
  const locale = useLocale();
  const [state, setState] = useState<LoadState>({ data: null, status: 'loading' });
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [editor, setEditor] = useState<EditorState>({ memory: null, mode: 'closed' });
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [highlightBusyId, setHighlightBusyId] = useState<string | null>(null);
  // A search result opens the story already scrolled to the Memory it matched.
  const focusedMemoryId = useSearchParams().get('memory');

  useEffect(() => {
    if (!focusedMemoryId || state.status !== 'ready') return;
    const target = document.getElementById(`memory-${focusedMemoryId}`);
    if (!target) return;
    target.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    });
  }, [focusedMemoryId, state.status]);

  const refresh = useCallback(async () => {
    setState({ data: null, status: 'loading' });
    try {
      const [memories, trip] = await Promise.all([fetchMemories(tripId), fetchTrip(tripId)]);
      setState({
        data: { memories: memories.memories, storyCover: memories.storyCover, trip: trip.trip },
        status: 'ready',
      });
    } catch {
      setState({ data: null, status: 'error' });
    }
    void fetchItinerary(tripId)
      .then(setItinerary)
      .catch(() => setItinerary(null));
  }, [tripId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const story: TripStory | null = useMemo(
    () => (state.data ? buildTripStory(state.data.memories) : null),
    [state.data],
  );

  // Provider Place names are resolved on demand and never stored as Trove data.
  const placeNames = useProviderPlaceNames(
    useMemo(
      () =>
        (story?.places ?? []).map((place) => ({
          id: place.tripPlace.placeId,
          kind: place.tripPlace.kind,
          name: place.tripPlace.name,
          providerRefs: place.tripPlace.providerRefs,
        })),
      [story?.places],
    ),
  );

  async function moveHighlight(memoryId: string, direction: -1 | 1) {
    if (!story) return;
    const index = story.highlights.findIndex((memory) => memory.id === memoryId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= story.highlights.length) return;

    const reordered = [...story.highlights];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(targetIndex, 0, moved);

    setHighlightBusyId(memoryId);
    setFeedback(null);
    try {
      await reorderHighlights(
        tripId,
        reordered.map((memory) => memory.id),
      );
      await refresh();
    } catch {
      setFeedback(t('reorderError'));
    } finally {
      setHighlightBusyId(null);
    }
  }

  async function saveTripRating(rating: number | null, note: string | null) {
    const result = await updateTripExperienceRating(tripId, rating, note);
    setState((current) =>
      current.status === 'ready'
        ? { data: { ...current.data, trip: result.trip }, status: 'ready' }
        : current,
    );
  }

  async function saveDayRating(itineraryDayId: string, rating: number | null, note: string | null) {
    const result = await updateItineraryDayExperienceRating(tripId, itineraryDayId, rating, note);
    setItinerary((current) =>
      current
        ? {
            ...current,
            days: current.days.map((day) =>
              day.id === itineraryDayId
                ? {
                    ...day,
                    experienceNote: result.experienceNote,
                    experienceRating: result.experienceRating,
                  }
                : day,
            ),
          }
        : current,
    );
  }

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

  const { storyCover, trip } = state.data;
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
      placeNames[place.tripPlace.placeId] ?? null,
      place.memories.find((memory) => memory.itineraryItem?.label)?.itineraryItem?.label ?? null,
    ) ?? t('unnamedPlace');

  const header = (
    <TripSectionHeader
      actions={
        <Button onClick={() => setEditor({ memory: null, mode: 'create' })} variant="outline">
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t('addMemory')}
        </Button>
      }
      currentSection="memories"
      description={t('description', {
        end: shortDate(trip.endDate),
        start: shortDate(trip.startDate),
      })}
      tripId={tripId}
    />
  );

  const dialogs = (
    <>
      <MemoryEditorDialog
        itinerary={itinerary}
        memory={editor.mode === 'edit' ? editor.memory : null}
        onClose={() => setEditor({ memory: null, mode: 'closed' })}
        onDeleted={() => {
          setEditor({ memory: null, mode: 'closed' });
          setFeedback(t('deleted'));
          void refresh();
        }}
        onSaved={(result) => {
          setFeedback(
            t(result.queued ? 'savedOffline' : result.localDateChanged ? 'dayMoved' : 'saved'),
          );
          void refresh();
        }}
        open={editor.mode !== 'closed'}
        tripId={tripId}
      />
      <StoryCoverPicker
        memories={state.data.memories}
        onOpenChange={setCoverPickerOpen}
        onSelected={(cover) =>
          setState((current) =>
            current.status === 'ready'
              ? { data: { ...current.data, storyCover: cover }, status: 'ready' }
              : current,
          )
        }
        open={coverPickerOpen}
        storyCover={storyCover}
        tripId={tripId}
      />
    </>
  );

  if (!story.memoryCount) {
    return (
      <section className="mx-auto w-full max-w-5xl space-y-7">
        {header}
        <ExperienceRatingField
          initialNote={trip.experienceNote}
          initialRating={trip.experienceRating}
          label={t('overallRating')}
          onSave={saveTripRating}
        />
        <PageState
          className="min-h-64 justify-center"
          description={t('emptyDescription')}
          headingLevel={2}
          icon={<Sparkles aria-hidden="true" />}
          title={t('emptyTitle')}
        />
        {dialogs}
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl space-y-9">
      {header}

      <p aria-live="polite" className="sr-only" role="status">
        {feedback}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <Button onClick={() => setCoverPickerOpen(true)} size="sm" variant="outline">
          {storyCover ? t('changeCover') : t('chooseCover')}
        </Button>
      </div>

      {storyCover?.url ? (
        <img
          alt=""
          className="aspect-[21/9] w-full rounded-[var(--radius-xl)] object-cover"
          src={storyCover.url}
        />
      ) : null}

      <ExperienceRatingField
        initialNote={trip.experienceNote}
        initialRating={trip.experienceRating}
        label={t('overallRating')}
        onSave={saveTripRating}
      />

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
            {story.highlights.map((memory, index) => (
              <MemoryEntry
                highlightControls={{
                  onMoveDown:
                    highlightBusyId || index === story.highlights.length - 1
                      ? null
                      : () => void moveHighlight(memory.id, 1),
                  onMoveUp:
                    highlightBusyId || index === 0 ? null : () => void moveHighlight(memory.id, -1),
                }}
                key={memory.id}
                memory={memory}
                onEdit={() => setEditor({ memory, mode: 'edit' })}
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
          {story.days.map((day) => {
            const itineraryDay = itinerary?.days.find((candidate) => candidate.date === day.date);
            return (
              <article aria-labelledby={`trip-story-day-${day.date}`} key={day.date}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3
                    className="text-base font-semibold text-foreground"
                    id={`trip-story-day-${day.date}`}
                  >
                    {dateOnly(day.date)}
                  </h3>
                  {itineraryDay ? (
                    <ExperienceRatingField
                      initialNote={itineraryDay.experienceNote}
                      initialRating={itineraryDay.experienceRating}
                      label={t('dayRating')}
                      onSave={(rating, note) => saveDayRating(itineraryDay.id, rating, note)}
                    />
                  ) : null}
                </div>
                <ul className="mt-2 border-y border-border">
                  {day.memories.map((memory) => (
                    // Days lists every Memory exactly once, so it carries the anchor
                    // a search result or deep link points at.
                    <MemoryEntry
                      anchorId={`memory-${memory.id}`}
                      highlighted={memory.id === focusedMemoryId}
                      key={memory.id}
                      memory={memory}
                      onEdit={() => setEditor({ memory, mode: 'edit' })}
                      photoAlt={t('photoAlt')}
                      time={localTime(memory)}
                    />
                  ))}
                </ul>
              </article>
            );
          })}
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
                      onEdit={() => setEditor({ memory, mode: 'edit' })}
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

      {dialogs}
    </section>
  );
}
