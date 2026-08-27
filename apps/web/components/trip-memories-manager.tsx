'use client';

import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  Ellipsis,
  ImageOff,
  ImagePlus,
  Pencil,
  Plus,
  Sparkles,
  Star,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import {
  ExperienceRatingDialog,
  ExperienceRatingStars,
} from '@/components/experience-rating-field';
import { MemoryEditorDialog } from '@/components/memory-editor-dialog';
import { PageState } from '@/components/page-state';
import { StoryCoverPicker } from '@/components/story-cover-picker';
import { useTripContext } from '@/components/trip-provider';
import { TripSectionHeader } from '@/components/trip-section-header';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import {
  fetchItinerary,
  updateItineraryDayExperienceRating,
  type Itinerary,
} from '@/lib/itinerary/api';
import { editorialSubjectKey } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import {
  fetchMemories,
  reorderHighlights,
  type Memory,
  type MemoryPhoto,
  type MemoryTripPlace,
  type StoryCover,
} from '@/lib/memories/api';
import { selectPhotoLayout } from '@/lib/memories/photo-layout';
import { buildTripStory, placeName, type StoryPlace, type TripStory } from '@/lib/memories/story';
import { updateTripExperienceRating } from '@/lib/trips/api';
import { tripEditorialSubject } from '@/lib/trips/summary';
import { cn } from '@/lib/utils';

type LoadState =
  | { data: null; status: 'error' }
  | { data: null; status: 'loading' }
  | {
      data: { memories: Memory[]; storyCover: StoryCover | null };
      status: 'ready';
    };

type EditorState =
  | { memory: null; mode: 'closed' }
  | { memory: null; mode: 'create' }
  | { memory: Memory; mode: 'edit' };

/** Which target the rating dialog is collecting for, held by id so it stays current. */
type RatingEditor = { itineraryDayId: string; kind: 'day' } | { kind: 'trip' } | null;

/**
 * `null` reads the whole story. Anything else narrows it to Highlights, to one
 * Place, or to what was captured away from any Place.
 */
type Lens = string | null;

type LensOption = { count: number; id: Lens; label: string; marked?: boolean };
/** A ChipGroup value has to be a string; no real lens id is ever this literal. */
const ALL_LENS_VALUE = '__all__';

function StoryPhoto({
  alt,
  aspect,
  photo,
}: Readonly<{ alt: string; aspect: string; photo: MemoryPhoto }>) {
  // Photo URLs are signed and expire after an hour, so a missing one is an
  // ordinary state to draw, not an error to report.
  return photo.url ? (
    <img
      alt={alt}
      className={cn('w-full rounded-[var(--radius-lg)] bg-muted/40 object-cover', aspect)}
      decoding="async"
      loading="lazy"
      src={photo.url}
    />
  ) : (
    <span
      className={cn(
        'flex w-full items-center justify-center rounded-[var(--radius-lg)] bg-muted/40 text-muted-foreground',
        aspect,
      )}
    >
      <ImageOff aria-hidden="true" className="size-5" />
    </span>
  );
}

/**
 * Photographs lead. One is given room, a pair reads as a pair, and beyond that a
 * lead image carries the moment while the rest follow beneath it — so no number
 * of photos ever looks like an accident of the grid. Which shape a Memory gets
 * within its count is chosen once, deterministically, from the Memory's own id,
 * so two Memories with the same photo count don't read as the same template
 * repeated down the page.
 */
function MemoryPhotos({ memory, photoAlt }: Readonly<{ memory: Memory; photoAlt: string }>) {
  const [lead, ...rest] = memory.photos;
  if (!lead) return null;

  // The lead photo answers to the note. Repeating that sentence on every frame
  // would only make a screen reader say the same thing four times over.
  const leadAlt = memory.note ?? photoAlt;
  const template = selectPhotoLayout(memory.id, memory.photos.length);
  if (!template) return null;

  if (template.kind === 'single') {
    return <StoryPhoto alt={leadAlt} aspect={template.aspect} photo={lead} />;
  }

  if (template.kind === 'pair') {
    return (
      <ul className="grid grid-cols-2 gap-2">
        {memory.photos.map((photo, index) => (
          <li key={photo.id}>
            <StoryPhoto
              alt={index === 0 ? leadAlt : photoAlt}
              aspect={template.aspect}
              photo={photo}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-2">
      <StoryPhoto alt={leadAlt} aspect={template.leadAspect} photo={lead} />
      {/* The strip fills its row rather than leaving a gap where a third
          photograph would have gone. */}
      <ul className={cn('grid gap-2', rest.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
        {rest.map((photo) => (
          <li key={photo.id}>
            <StoryPhoto alt={photoAlt} aspect={template.stripAspect} photo={photo} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One captured moment, read rather than logged: the traveller's own photographs
 * first, then what they wrote, then the quiet context underneath. Curation waits
 * in a single menu on that context line — the entry is something to look at, not
 * a toolbar — and this is the only place a Memory is drawn, so it carries the
 * anchor a deep link or search result points at.
 */
function MemoryEntry({
  focused,
  highlightControls,
  memory,
  meta,
  onEdit,
  photoAlt,
}: Readonly<{
  focused: boolean;
  highlightControls: { onMoveDown: (() => void) | null; onMoveUp: (() => void) | null } | null;
  memory: Memory;
  meta: string;
  onEdit: () => void;
  photoAlt: string;
}>) {
  const t = useTranslations('memories.story');

  return (
    <article
      className={cn(
        'scroll-mt-24 space-y-3',
        focused
          ? '-mx-3 rounded-[var(--radius-lg)] bg-secondary/60 px-3 py-3 transition-colors duration-[var(--motion-standard)]'
          : undefined,
      )}
      id={`memory-${memory.id}`}
    >
      <MemoryPhotos memory={memory} photoAlt={photoAlt} />
      {memory.note ? (
        <p className="text-base leading-7 whitespace-pre-wrap text-pretty text-foreground">
          {memory.note}
        </p>
      ) : null}
      <div className="flex items-center gap-2 text-xs text-text-subtle">
        {memory.isHighlight ? (
          <Sparkles aria-hidden="true" className="size-3.5 shrink-0 text-brand" />
        ) : null}
        <span className="min-w-0 truncate">{meta}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={t('memoryActions')}
                className="ml-auto shrink-0"
                size="icon-sm"
                type="button"
                variant="ghost"
              />
            }
          >
            <Ellipsis aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil aria-hidden="true" />
              {t('editMemory')}
            </DropdownMenuItem>
            {highlightControls ? (
              <>
                <DropdownMenuItem
                  disabled={!highlightControls.onMoveUp}
                  onClick={() => highlightControls.onMoveUp?.()}
                >
                  <ArrowUp aria-hidden="true" />
                  {t('moveHighlightUp')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!highlightControls.onMoveDown}
                  onClick={() => highlightControls.onMoveDown?.()}
                >
                  <ArrowDown aria-hidden="true" />
                  {t('moveHighlightDown')}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}

export function TripMemoriesManager({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('memories.story');
  const locale = useLocale();
  const tripContext = useTripContext();
  const trip = tripContext?.trip ?? null;
  const [state, setState] = useState<LoadState>({ data: null, status: 'loading' });
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [editor, setEditor] = useState<EditorState>({ memory: null, mode: 'closed' });
  const [ratingEditor, setRatingEditor] = useState<RatingEditor>(null);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [highlightBusyId, setHighlightBusyId] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>(null);
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
      const memories = await fetchMemories(tripId);
      setState({
        data: { memories: memories.memories, storyCover: memories.storyCover },
        status: 'ready',
      });
    } catch {
      setState((current) =>
        current.status === 'ready' ? current : { data: null, status: 'error' },
      );
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

  // One subject for the whole screen, and none at all once the trip already has
  // a cover of its own — the same shape every other trip surface asks for.
  const subject =
    trip && !state.data?.storyCover?.url && !trip.coverPhotoUrl ? tripEditorialSubject(trip) : null;
  const editorialImages = useEditorialImages(subject ? [subject] : []);
  const editorial = subject
    ? (editorialImages.get(editorialSubjectKey(subject))?.[0] ?? null)
    : null;

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
    tripContext?.setTrip(result.trip);
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

  // The story and the trip are fetched in parallel by different owners now, so
  // the screen waits for both rather than for one request that carried both.
  if (state.status === 'loading' || !trip) {
    return <PageState kind="loading" loadingShape="tripSection" title={t('loading')} />;
  }

  if (state.status === 'error' || !story) {
    return (
      <PageState
        actions={<Button onClick={() => void refresh()}>{t('tryAgain')}</Button>}
        description={t('loadErrorDescription')}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const { storyCover } = state.data;
  const headSource = resolveTripMediaSource({
    coverUrl: trip.coverPhotoUrl,
    editorial,
    memoryUrl: storyCover?.url,
    preferMemory: true,
  });
  const dateOnly = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(
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
  const resolvePlaceName = (tripPlace: MemoryTripPlace, itemLabel: string | null) =>
    placeName(tripPlace, tripPlace.snapshot?.name ?? null, itemLabel) ?? t('unnamedPlace');
  const placeLabel = (place: StoryPlace) =>
    resolvePlaceName(
      place.tripPlace,
      place.memories.find((memory) => memory.itineraryItem?.label)?.itineraryItem?.label ?? null,
    );
  // Place context lives on the Memory now that Places is a way in rather than a
  // second listing, so reading the story never loses where something happened.
  const memoryMeta = (memory: Memory) =>
    [
      localTime(memory),
      memory.tripPlace
        ? resolvePlaceName(memory.tripPlace, memory.itineraryItem?.label ?? null)
        : null,
    ]
      .filter(Boolean)
      .join(' · ');

  const matchesLens = (memory: Memory) =>
    lens === null
      ? true
      : lens === 'highlights'
        ? memory.isHighlight
        : lens === 'unplaced'
          ? !memory.tripPlace
          : memory.tripPlace?.id === lens;

  const visibleDays = story.days
    .map((day) => ({ ...day, memories: day.memories.filter(matchesLens) }))
    .filter((day) => day.memories.length);

  const lensOptions: LensOption[] = [
    { count: story.memoryCount, id: null, label: t('lensAll') },
    ...(story.highlights.length
      ? [
          {
            count: story.highlights.length,
            id: 'highlights',
            label: t('highlights'),
            marked: true,
          },
        ]
      : []),
    ...story.places.map((place) => ({
      count: place.memories.length,
      id: place.tripPlace.id,
      label: placeLabel(place),
    })),
    ...(story.unplacedCount
      ? [{ count: story.unplacedCount, id: 'unplaced', label: t('lensUnplaced') }]
      : []),
  ];

  function selectLens(option: LensOption) {
    setLens(option.id);
    setFeedback(t('lensShowing', { count: option.count, label: option.label }));
  }

  function highlightControlsFor(memory: Memory) {
    if (!story || !memory.isHighlight) return null;
    const index = story.highlights.findIndex((candidate) => candidate.id === memory.id);
    if (index < 0) return null;
    return {
      onMoveDown:
        highlightBusyId || index === story.highlights.length - 1
          ? null
          : () => void moveHighlight(memory.id, 1),
      onMoveUp: highlightBusyId || index === 0 ? null : () => void moveHighlight(memory.id, -1),
    };
  }

  /**
   * Rating is offered, never asked. A rating already given shows as itself; one
   * not yet given is a single quiet star, not a question standing beside the day.
   */
  function ratingAffordance(
    label: string,
    rating: number | null,
    onOpen: () => void,
    tone: 'default' | 'onImage' = 'default',
  ) {
    const onImage = tone === 'onImage';
    return rating ? (
      <Button
        aria-label={label}
        className={cn('h-auto px-1.5 py-1', onImage ? 'hover:bg-white/15' : undefined)}
        onClick={onOpen}
        size="sm"
        type="button"
        variant="ghost"
      >
        <ExperienceRatingStars rating={rating} tone={tone} />
      </Button>
    ) : (
      <Button
        aria-label={label}
        className={cn(
          onImage ? 'text-white/70 hover:bg-white/15 hover:text-white' : 'text-text-subtle',
        )}
        onClick={onOpen}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Star aria-hidden="true" />
      </Button>
    );
  }

  const tripRating = ratingAffordance(
    t('rateTrip'),
    trip.experienceRating,
    () => setRatingEditor({ kind: 'trip' }),
    'onImage',
  );

  const header = (
    <TripSectionHeader
      actions={
        <>
          <Button onClick={() => setEditor({ memory: null, mode: 'create' })} variant="outline">
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('addMemory')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button aria-label={t('storyActions')} size="icon" type="button" variant="ghost" />
              }
            >
              <Ellipsis aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem onClick={() => setCoverPickerOpen(true)}>
                <ImagePlus aria-hidden="true" />
                {storyCover ? t('changeCover') : t('chooseCover')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
      coverMeta={tripRating}
      coverSource={headSource}
      currentSection="memories"
    />
  );

  const ratingDay =
    ratingEditor?.kind === 'day'
      ? (itinerary?.days.find((day) => day.id === ratingEditor.itineraryDayId) ?? null)
      : null;

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
      <ExperienceRatingDialog
        description={t('tripRatingDescription', { trip: trip.name })}
        initialNote={trip.experienceNote}
        initialRating={trip.experienceRating}
        onOpenChange={(open) => !open && setRatingEditor(null)}
        onSave={saveTripRating}
        open={ratingEditor?.kind === 'trip'}
        title={t('tripRatingTitle')}
      />
      {ratingDay ? (
        <ExperienceRatingDialog
          description={t('dayRatingDescription', { date: dateOnly(ratingDay.date) })}
          initialNote={ratingDay.experienceNote}
          initialRating={ratingDay.experienceRating}
          onOpenChange={(open) => !open && setRatingEditor(null)}
          onSave={(rating, note) => saveDayRating(ratingDay.id, rating, note)}
          open
          title={t('dayRatingTitle')}
        />
      ) : null}
    </>
  );

  const liveRegion = (
    <p aria-live="polite" className="sr-only" role="status">
      {feedback}
    </p>
  );

  if (!story.memoryCount) {
    return (
      <section className="space-y-7">
        {header}
        {liveRegion}
        <PageState
          actions={
            <Button onClick={() => setEditor({ memory: null, mode: 'create' })}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('addFirstMemory')}
            </Button>
          }
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
    <section className="space-y-8">
      {header}
      {liveRegion}

      {/* Highlights and Places are ways into the story, not second copies of it. */}
      {lensOptions.length > 1 ? (
        <ChipGroup
          aria-label={t('lensLabel')}
          multiple={false}
          onValueChange={([value]) => {
            const option = lensOptions.find(
              (candidate) => (candidate.id ?? ALL_LENS_VALUE) === value,
            );
            if (option) selectLens(option);
          }}
          value={[lens ?? ALL_LENS_VALUE]}
        >
          {lensOptions.map((option) => (
            <Chip
              aria-label={`${option.label}, ${t('memoryCount', { count: option.count })}`}
              count={option.count}
              icon={option.marked ? <Sparkles aria-hidden="true" /> : undefined}
              key={option.id ?? ALL_LENS_VALUE}
              value={option.id ?? ALL_LENS_VALUE}
            >
              {option.label}
            </Chip>
          ))}
        </ChipGroup>
      ) : null}

      <div className="space-y-10">
        {visibleDays.map((day) => {
          const itineraryDay = itinerary?.days.find((candidate) => candidate.date === day.date);
          return (
            <article aria-labelledby={`trip-story-day-${day.date}`} key={day.date}>
              {/* The date marks a chapter rather than titling one, so the
                  photographs and what was written carry the page. */}
              <div className="flex items-center gap-3 border-b border-border pb-2">
                <h2
                  className="text-sm font-medium text-text-subtle"
                  id={`trip-story-day-${day.date}`}
                >
                  {dateOnly(day.date)}
                </h2>
                {itineraryDay ? (
                  <span className="ml-auto shrink-0">
                    {ratingAffordance(t('rateDay'), itineraryDay.experienceRating, () =>
                      setRatingEditor({ itineraryDayId: itineraryDay.id, kind: 'day' }),
                    )}
                  </span>
                ) : null}
              </div>
              <div className="mt-5 space-y-8">
                {day.memories.map((memory) => (
                  <MemoryEntry
                    focused={memory.id === focusedMemoryId}
                    highlightControls={highlightControlsFor(memory)}
                    key={memory.id}
                    memory={memory}
                    meta={memoryMeta(memory)}
                    onEdit={() => setEditor({ memory, mode: 'edit' })}
                    photoAlt={t('photoAlt')}
                  />
                ))}
              </div>
            </article>
          );
        })}
      </div>

      <p className="border-t border-border pt-5 text-xs leading-5 text-text-subtle">
        {t('privacyNote')}
      </p>

      {dialogs}
    </section>
  );
}
