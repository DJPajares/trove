'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MemoryEditorSheet } from '@/components/memory-editor-sheet';
import { ExperienceRatingSheet } from '@/components/memories/experience-rating-sheet';
import { JournalChapter, JournalQuietDays, longDate } from '@/components/memories/journal-chapter';
import { JournalContents, type JournalLensChip } from '@/components/memories/journal-contents';
import { JournalCover } from '@/components/memories/journal-cover';
import { JournalDock, JournalHeadActions } from '@/components/memories/journal-dock';
import { JournalEmpty } from '@/components/memories/journal-empty';
import { JournalEpilogue } from '@/components/memories/journal-epilogue';
import { JournalRunningHead } from '@/components/memories/journal-running-head';
import { JournalSkeleton } from '@/components/memories/journal-skeleton';
import { MomentViewer } from '@/components/memories/moment-viewer';
import { useJournalData } from '@/components/memories/use-journal-data';
import { useRunningHead } from '@/components/memories/use-running-head';
import { PageState } from '@/components/page-state';
import { StoryCoverPicker } from '@/components/story-cover-picker';
import { buttonVariants } from '@/components/ui/button';
import {
  type Memory,
  type MemoriesResponse,
  type MemoryTripPlace,
  updateDatedExperienceRating,
} from '@/lib/memories/api';
import {
  buildJournal,
  type JournalChapter as Chapter,
  type JournalLens,
  journalLensOptions,
} from '@/lib/memories/journal';
import { placeName } from '@/lib/memories/story';
import { queryKeys } from '@/lib/query/keys';
import { updateTripExperienceRating } from '@/lib/trips/api';

type EditorState =
  | { memory: null; mode: 'closed' }
  | { memory: null; mode: 'create' }
  | { memory: Memory; mode: 'edit' };

/** Which rating the sheet is collecting, held by date so it stays current. */
type RatingTarget = { date: string; kind: 'day' } | { kind: 'trip' } | null;

/** The moment open in the viewer, kept as it was opened so it can animate out once deleted. */
type ViewerState = { memory: Memory; open: boolean; photoIndex: number } | null;

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Scrolls an element into view and moves focus to it, without a second scroll. */
function bringIntoView(element: HTMLElement | null, block: ScrollLogicalPosition = 'start') {
  if (!element) return;
  element.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block });
  element.focus({ preventScroll: true });
}

/**
 * A trip's Memories as a journal you open: its own experience, like Trip
 * Mode, outside the trip's shared header (PRD 4.5).
 *
 * The journal is read top to bottom - the cover, the days of the trip, then a
 * chapter for every day something was kept, with the quiet days folded in
 * between - and ends on how the trip felt. Nothing on the page is a toolbar:
 * a moment opens when it is tapped, and is looked after there. Adding a memory
 * is always within reach, in the dock on a phone and the header from `lg`.
 */
export function MemoriesJournal({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('memories.journal');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const {
    cover,
    data,
    days,
    itinerary,
    memoriesPending,
    refresh,
    reportPhotoError,
    sketch,
    story,
    trip,
    tripContext,
  } = useJournalData(tripId);

  const [lens, setLens] = useState<JournalLens>(null);
  const [viewer, setViewer] = useState<ViewerState>(null);
  const [editor, setEditor] = useState<EditorState>({ memory: null, mode: 'closed' });
  const [ratingTarget, setRatingTarget] = useState<RatingTarget>(null);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const focusedMemoryId = useSearchParams().get('memory');

  const headRef = useRef<HTMLElement>(null);
  const coverRef = useRef<HTMLElement>(null);
  const pendingJump = useRef<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const deepLinkHandled = useRef(false);

  const journal = useMemo(
    () => (story ? buildJournal({ days, lens, story }) : null),
    [days, lens, story],
  );
  const { chapterId, overCover } = useRunningHead({
    chapterSelector: '[data-journal-chapter], [data-journal-contents]',
    coverRef,
    headRef,
    watchKey: journal?.entries.map((entry) => entry.id).join('|') ?? '',
  });

  // A search result opens the journal already at the Memory it matched.
  useEffect(() => {
    if (!focusedMemoryId || !journal || deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    bringIntoView(document.getElementById(`memory-${focusedMemoryId}`), 'center');
  }, [focusedMemoryId, journal]);

  // A jump into a day the lens was hiding waits for the lens to clear first;
  // focus after a deletion waits for the journal to be read again.
  useEffect(() => {
    if (pendingJump.current) {
      bringIntoView(document.getElementById(pendingJump.current));
      pendingJump.current = null;
    }
    if (pendingFocus.current) {
      document.getElementById(pendingFocus.current)?.focus({ preventScroll: false });
      pendingFocus.current = null;
    }
  }, [journal]);

  const localTime = useCallback(
    (memory: Memory) => {
      const [hour, minute] = memory.capturedLocalTime?.split(':') ?? [];
      if (hour === undefined || minute === undefined) return null;
      return new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC',
      }).format(new Date(`1970-01-01T${hour}:${minute}:00.000Z`));
    },
    [locale],
  );
  const resolvePlaceName = useCallback(
    (tripPlace: MemoryTripPlace, itemLabel: string | null) =>
      placeName(tripPlace, tripPlace.snapshot?.name ?? null, itemLabel) ?? t('unnamedPlace'),
    [t],
  );
  // When and where, beneath the moment rather than above it (PRD 31.2).
  const contextFor = useCallback(
    (memory: Memory) =>
      [
        localTime(memory),
        memory.tripPlace
          ? resolvePlaceName(memory.tripPlace, memory.itineraryItem?.label ?? null)
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
    [localTime, resolvePlaceName],
  );

  const lensChips: JournalLensChip[] = useMemo(
    () =>
      story
        ? journalLensOptions(story).map((option) => ({
            count: option.count,
            highlight: option.kind === 'highlights',
            id: option.id,
            label:
              option.kind === 'all'
                ? t('lensAll')
                : option.kind === 'highlights'
                  ? t('lensHighlights')
                  : option.kind === 'unplaced'
                    ? t('lensUnplaced')
                    : resolvePlaceName(
                        option.place.tripPlace,
                        option.place.memories.find((memory) => memory.itineraryItem?.label)
                          ?.itineraryItem?.label ?? null,
                      ),
          }))
        : [],
    [resolvePlaceName, story, t],
  );

  if (!trip) {
    if (tripContext?.status === 'missing' || tripContext?.status === 'error') {
      return (
        <PageState
          actions={
            <Link className={buttonVariants({ variant: 'outline' })} href="/trips">
              {t('backToTrips')}
            </Link>
          }
          description={t('loadErrorDescription')}
          icon={<CircleAlert aria-hidden="true" />}
          kind="error"
          title={t('loadError')}
        />
      );
    }
    return <JournalSkeleton />;
  }

  if (!data || !story || !journal) {
    if (memoriesPending) return <JournalSkeleton />;
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    return (
      <PageState
        actions={
          offline ? (
            <Link className={buttonVariants({ variant: 'outline' })} href={`/trips/${tripId}`}>
              {t('backToTrip')}
            </Link>
          ) : (
            <button className={buttonVariants()} onClick={() => void refresh()} type="button">
              {t('tryAgain')}
            </button>
          )
        }
        description={offline ? t('offlineDescription') : t('loadErrorDescription')}
        icon={<CircleAlert aria-hidden="true" />}
        kind={offline ? 'offline' : 'error'}
        title={offline ? t('offlineTitle') : t('loadError')}
      />
    );
  }

  const { entries, contents } = journal;
  const isEmpty = story.days.length === 0;
  const runningChapter = entries.find(
    (entry): entry is Chapter => entry.kind === 'chapter' && entry.id === chapterId,
  );
  const runningTitle = runningChapter
    ? [
        runningChapter.day.dayNumber !== null
          ? t('dayNumber', { number: runningChapter.day.dayNumber })
          : null,
        runningChapter.day.name ??
          runningChapter.day.place ??
          longDate(runningChapter.day.date, locale),
      ]
        .filter(Boolean)
        .join(' — ')
    : trip.name;

  // The latest copy of the open moment, so a Highlight or an edit shows at once.
  const viewerMemory = viewer
    ? (data.memories.find((memory) => memory.id === viewer.memory.id) ?? viewer.memory)
    : null;

  const openMoment = (memory: Memory, photoIndex: number) =>
    setViewer({ memory, open: true, photoIndex });
  const openCreate = () => setEditor({ memory: null, mode: 'create' });
  const showContents = () =>
    bringIntoView(document.getElementById('journal-contents-title') ?? null);

  function jump(anchorId: string) {
    if (lens !== null) {
      pendingJump.current = anchorId;
      setLens(null);
      return;
    }
    bringIntoView(document.getElementById(anchorId));
  }

  function chooseLens(chip: JournalLensChip) {
    setLens(chip.id);
    setFeedback(t('lensShowing', { count: chip.count, label: chip.label }));
  }

  async function saveTripRating(rating: number | null, note: string | null) {
    const result = await updateTripExperienceRating(tripId, rating, note);
    tripContext?.setTrip(result.trip);
  }

  async function saveDayRating(date: string, rating: number | null, note: string | null) {
    await updateDatedExperienceRating(tripId, date, rating, note);
    await Promise.all([
      refresh(),
      queryClient.invalidateQueries({ queryKey: queryKeys.itinerary(tripId) }),
      tripContext?.refresh(),
    ]);
  }

  function handleDeleted(memory: Memory) {
    // Focus moves on to the moment after the one deleted, or back to the
    // contents when it was the last.
    const order = entries.flatMap((entry) =>
      entry.kind === 'chapter' ? entry.memories.map((kept) => kept.id) : [],
    );
    const next = order[order.indexOf(memory.id) + 1] ?? order[order.indexOf(memory.id) - 1];
    pendingFocus.current = next ? `memory-${next}` : 'journal-contents-title';
    setViewer((current) => (current ? { ...current, open: false } : current));
    setFeedback(t('deleted'));
    void refresh();
  }

  const ratingDay =
    ratingTarget?.kind === 'day'
      ? {
          date: ratingTarget.date,
          ...(data.dayExperiences?.find((entry) => entry.date === ratingTarget.date) ?? {
            note: null,
            rating: null,
          }),
        }
      : null;

  let leanOffset = 0;

  return (
    <div
      className="mx-auto w-full max-w-5xl [--journal-head-height:calc(var(--safe-top)+4.25rem)] md:[--journal-head-height:3.25rem]"
      data-slot="journal"
    >
      <JournalRunningHead
        actions={
          <JournalHeadActions
            hasCover={Boolean(data.storyCover)}
            onAdd={openCreate}
            onChooseCover={() => setCoverPickerOpen(true)}
            onContents={isEmpty ? null : showContents}
            overCover={overCover}
          />
        }
        overCover={overCover}
        ref={headRef}
        title={runningTitle}
        tripId={tripId}
      />

      <JournalCover
        cover={cover}
        onRate={() => setRatingTarget({ kind: 'trip' })}
        ref={coverRef}
        trip={trip}
      />

      <div className="mt-12 space-y-20 pb-4 md:mt-16 lg:space-y-24 lg:pb-20">
        {isEmpty ? (
          <JournalEmpty lifecycle={trip.lifecycle} onAdd={openCreate} />
        ) : (
          <>
            <JournalContents
              contents={contents}
              lens={lens}
              lensChips={lensChips}
              onJump={jump}
              onLensChange={chooseLens}
              onPhotoError={reportPhotoError}
              sketch={sketch}
            />

            {entries.map((entry) => {
              if (entry.kind === 'interlude') {
                return <JournalQuietDays interlude={entry} key={entry.id} />;
              }
              const offset = leanOffset;
              leanOffset += entry.memories.length;
              return (
                <JournalChapter
                  chapter={entry}
                  contextFor={contextFor}
                  focusedMemoryId={focusedMemoryId}
                  key={entry.id}
                  leanOffset={offset}
                  onOpenMoment={openMoment}
                  onPhotoError={reportPhotoError}
                  onRate={() => setRatingTarget({ date: entry.day.date, kind: 'day' })}
                  rateable={entry.day.dayNumber !== null || entry.experience !== null}
                />
              );
            })}
          </>
        )}

        <JournalEpilogue trip={trip} />
      </div>

      <JournalDock
        hasCover={Boolean(data.storyCover)}
        onAdd={openCreate}
        onChooseCover={() => setCoverPickerOpen(true)}
        onContents={isEmpty ? null : showContents}
      />

      <p aria-live="polite" className="sr-only" role="status">
        {feedback}
      </p>

      <MomentViewer
        context={viewerMemory ? contextFor(viewerMemory) : ''}
        highlightOrder={story.highlights.map((memory) => memory.id)}
        initialPhotoIndex={viewer?.photoIndex ?? 0}
        isCover={(photoId) => data.storyCover?.photoId === photoId}
        memory={viewerMemory}
        onClosed={() => setViewer(null)}
        onCoverChanged={(storyCover) =>
          queryClient.setQueryData(
            queryKeys.memories(tripId),
            (current: MemoriesResponse | undefined) =>
              current ? { ...current, storyCover } : current,
          )
        }
        onDeleted={handleDeleted}
        onEdit={(memory) => {
          setViewer((current) => (current ? { ...current, open: false } : current));
          setEditor({ memory, mode: 'edit' });
        }}
        onFeedback={setFeedback}
        onOpenChange={(open) => setViewer((current) => (current ? { ...current, open } : current))}
        onPhotoError={reportPhotoError}
        onUpdated={refresh}
        open={Boolean(viewer?.open)}
        tripId={tripId}
      />

      <MemoryEditorSheet
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
        memories={data.memories}
        onOpenChange={setCoverPickerOpen}
        onSelected={(storyCover) =>
          queryClient.setQueryData(
            queryKeys.memories(tripId),
            (current: MemoriesResponse | undefined) =>
              current ? { ...current, storyCover } : current,
          )
        }
        open={coverPickerOpen}
        storyCover={data.storyCover}
        tripId={tripId}
      />

      <ExperienceRatingSheet
        description={t('ratingTripDescription', { trip: trip.name })}
        initialNote={trip.experienceNote}
        initialRating={trip.experienceRating}
        onOpenChange={(open) => !open && setRatingTarget(null)}
        onSave={saveTripRating}
        open={ratingTarget?.kind === 'trip'}
        title={t('ratingTripTitle')}
      />
      {ratingDay ? (
        <ExperienceRatingSheet
          description={t('ratingDayDescription', { date: longDate(ratingDay.date, locale) })}
          initialNote={ratingDay.note}
          initialRating={ratingDay.rating}
          onOpenChange={(open) => !open && setRatingTarget(null)}
          onSave={(rating, note) => saveDayRating(ratingDay.date, rating, note)}
          open
          title={t('ratingDayTitle')}
        />
      ) : null}
    </div>
  );
}
