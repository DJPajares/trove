'use client';

import { Trash2, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  MemoryWhenSheet,
  MemoryWhereSheet,
  type WhenDay,
  type WhereOption,
} from '@/components/memories/memory-context';
import { MemoryPage } from '@/components/memories/memory-page';
import { usePreferences } from '@/components/preferences-provider';
import { footerDeleteClassName } from '@/components/ui/footer-actions';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetFooter, SheetHeading } from '@/components/ui/sheet';
import type { Itinerary, ItineraryItem } from '@/lib/itinerary/api';
import { formatSuggestedClock } from '@/lib/itinerary/day-time-suggestions';
import {
  addMemoryPhotos,
  allowedMemoryPhotoTypes,
  captureMemory,
  deleteMemory,
  deleteMemoryPhoto,
  maxMemoryPhotoSize,
  MemoriesApiError,
  reorderMemoryPhotos,
  updateMemory,
  type Memory,
  type MemoryPhoto,
} from '@/lib/memories/api';
import {
  memoryDraftFrom,
  memoryEditPatch,
  type MemoryPlaceChoice,
  withDay,
} from '@/lib/memories/edit-patch';
import { placeName } from '@/lib/memories/story';
import { resolveItineraryItemPlaceName, resolveTripPlaceName } from '@/lib/trip-places/place-name';

const NO_DAY = 'none';
const NO_ITEM = 'none';
/** The Place a Memory already has with no stop standing for it. */
const CURRENT_PLACE = 'current';
/** A Place kept from a stop the Memory left behind when its day changed. */
const KEPT_PLACE = 'kept';

type SaveResult = { localDateChanged: boolean; queued: boolean };

/**
 * Curates one Memory after the fact: caption, highlight state, day/item context,
 * the captured date/time when it needs correcting, and photo management. The
 * same sheet also adds a Memory the traveller forgot to capture, through the
 * identical fields and the same underlying capture path.
 */
export function MemoryEditorSheet({
  itinerary,
  memory,
  onClose,
  onDeleted,
  onSaved,
  open,
  tripId,
}: Readonly<{
  itinerary: Itinerary | null;
  memory: Memory | null;
  onClose: () => void;
  onDeleted?: () => void;
  onSaved: (result: SaveResult) => void;
  open: boolean;
  tripId: string;
}>) {
  const t = useTranslations('memories.editor');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const isCreate = memory === null;
  const fileInput = useRef<HTMLInputElement>(null);

  const [note, setNote] = useState('');
  const [isHighlight, setIsHighlight] = useState(false);
  const [dayId, setDayId] = useState(NO_DAY);
  const [place, setPlace] = useState<MemoryPlaceChoice>({ kind: 'none' });
  const [localDate, setLocalDate] = useState('');
  const [localTime, setLocalTime] = useState('');
  const [existingPhotos, setExistingPhotos] = useState<MemoryPhoto[]>([]);
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [busyPhotoId, setBusyPhotoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photoToDelete, setPhotoToDelete] = useState<MemoryPhoto | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** Which of the two small pickers - where, or when - is open over the page. */
  const [picker, setPicker] = useState<'when' | 'where' | null>(null);

  useEffect(() => {
    if (!open) return;
    const draft = memory ? memoryDraftFrom(memory) : null;
    setNote(draft?.note ?? '');
    setIsHighlight(draft?.isHighlight ?? false);
    setDayId(draft?.dayId ?? NO_DAY);
    setPlace(draft?.place ?? { kind: 'none' });
    setLocalDate(draft?.localDate ?? '');
    setLocalTime(draft?.localTime ?? '');
    setExistingPhotos(memory?.photos ?? []);
    setNewPhotos([]);
    setError(null);
    setSaving(false);
    setUploadingPhotos(false);
    setPhotoToDelete(null);
    setConfirmDelete(false);
    setPicker(null);
  }, [memory, open]);

  const selectedDay = itinerary?.days.find((day) => day.id === dayId) ?? null;
  const dayItems = useMemo(
    () => selectedDay?.items.filter((item) => item.tripPlace || item.customLabel) ?? [],
    [selectedDay],
  );
  const selectedItem =
    place.kind === 'item' ? (dayItems.find((item) => item.id === place.itemId) ?? null) : null;
  const placeValue =
    place.kind === 'item'
      ? place.itemId
      : place.kind === 'current'
        ? CURRENT_PLACE
        : place.kind === 'place'
          ? KEPT_PLACE
          : NO_ITEM;

  // The Place a Memory keeps without a stop, named the way the rest of the trip names it.
  function tripPlaceLabel(tripPlaceId: string | null) {
    const tripPlace = itinerary?.tripPlaces.find((candidate) => candidate.id === tripPlaceId);
    if (tripPlace) {
      return resolveTripPlaceName(tripPlace, { custom: t('noContext'), provider: t('noContext') });
    }
    if (memory?.tripPlace && memory.tripPlace.id === tripPlaceId) {
      return (
        placeName(memory.tripPlace, memory.tripPlace.snapshot?.name ?? null, null) ?? t('noContext')
      );
    }
    return t('noContext');
  }
  const currentPlaceLabel =
    memory?.tripPlace && !memory.itineraryItem ? tripPlaceLabel(memory.tripPlace.id) : null;
  const keptPlaceLabel = place.kind === 'place' ? tripPlaceLabel(place.tripPlaceId) : null;

  function selectPlace(value: string) {
    if (value === NO_ITEM) setPlace({ kind: 'none' });
    else if (value === CURRENT_PLACE) setPlace({ kind: 'current' });
    else if (value !== KEPT_PLACE) {
      const item = dayItems.find((candidate) => candidate.id === value);
      if (item)
        setPlace({ itemId: item.id, kind: 'item', tripPlaceId: item.tripPlace?.id ?? null });
    }
  }

  function selectDay(value: string) {
    if (!isCreate) {
      // Moving a Memory to another day moves its date and keeps its time; a
      // stop from the old day is let go, but the Place it stood for is kept.
      const day = itinerary?.days.find((candidate) => candidate.id === value) ?? null;
      const moved = withDay(
        { dayId: null, isHighlight, localDate, localTime, note, place },
        value === NO_DAY ? null : day ? { date: day.date, id: day.id } : null,
      );
      setDayId(moved.dayId ?? NO_DAY);
      setLocalDate(moved.localDate);
      setPlace(moved.place);
      return;
    }

    setDayId(value);
    setPlace({ kind: 'none' });
    if (value === NO_DAY) {
      if (isCreate) {
        setLocalDate('');
        setLocalTime('');
      }
      return;
    }
    const day = itinerary?.days.find((candidate) => candidate.id === value);
    if (!day) return;
    if (isCreate) {
      setLocalDate(day.date);
      setLocalTime((current) => current || '12:00');
    }
  }

  function addPhotoFiles(files: FileList | null) {
    if (!files?.length) return;
    const accepted: File[] = [];
    for (const file of files) {
      if (!allowedMemoryPhotoTypes.has(file.type) || file.size > maxMemoryPhotoSize) {
        setError(t('photoRejected'));
        continue;
      }
      accepted.push(file);
    }
    if (!accepted.length) return;

    if (isCreate) {
      setNewPhotos((current) => [...current, ...accepted]);
      return;
    }
    if (!memory) return;
    setUploadingPhotos(true);
    setError(null);
    void addMemoryPhotos(tripId, memory.id, accepted)
      .then((result) => {
        setExistingPhotos((current) => [...current, ...result.photos]);
        if (result.queued) setError(t('photosQueued'));
      })
      .catch(() => setError(t('saveError')))
      .finally(() => setUploadingPhotos(false));
  }

  async function movePhoto(photoId: string, direction: -1 | 1) {
    if (!memory) return;
    const index = existingPhotos.findIndex((photo) => photo.id === photoId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= existingPhotos.length) return;

    const reordered = [...existingPhotos];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(targetIndex, 0, moved);

    setBusyPhotoId(photoId);
    setError(null);
    try {
      const updated = await reorderMemoryPhotos(
        tripId,
        memory.id,
        reordered.map((photo) => photo.id),
      );
      setExistingPhotos(updated.photos);
    } catch {
      setError(t('saveError'));
    } finally {
      setBusyPhotoId(null);
    }
  }

  async function confirmPhotoDelete() {
    if (!memory || !photoToDelete) return;
    setBusyPhotoId(photoToDelete.id);
    try {
      await deleteMemoryPhoto(tripId, memory.id, photoToDelete.id, photoToDelete.url);
      setExistingPhotos((current) => current.filter((photo) => photo.id !== photoToDelete.id));
      setPhotoToDelete(null);
    } catch {
      setError(t('saveError'));
    } finally {
      setBusyPhotoId(null);
    }
  }

  async function handleDelete() {
    if (!memory) return;
    setDeleting(true);
    try {
      await deleteMemory(
        tripId,
        memory.id,
        existingPhotos.map((photo) => photo.url),
      );
      setConfirmDelete(false);
      onDeleted?.();
    } catch {
      setError(t('saveError'));
      setDeleting(false);
    }
  }

  const canSave =
    !saving &&
    !uploadingPhotos &&
    (note.trim().length > 0 || existingPhotos.length > 0 || newPhotos.length > 0);

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    const context = {
      itineraryDayId: dayId === NO_DAY ? null : dayId,
      itineraryItemId: place.kind === 'item' ? place.itemId : null,
      tripPlaceId: place.kind === 'item' ? place.tripPlaceId : null,
    };
    const local =
      localDate && localTime ? { capturedLocalDate: localDate, capturedLocalTime: localTime } : {};

    try {
      if (isCreate) {
        const result = await captureMemory(
          tripId,
          {
            ...context,
            ...local,
            isHighlight,
            note: note.trim() ? note.trim() : null,
          },
          newPhotos,
        );
        onSaved({ localDateChanged: false, queued: result.queued });
      } else {
        // Only what changed: unchanged context sent back is read as a
        // correction, which rewrites the captured time and can drop a Place.
        const patch = memoryEditPatch(memory, {
          dayId: dayId === NO_DAY ? null : dayId,
          isHighlight,
          localDate,
          localTime,
          note,
          place,
        });
        if (Object.keys(patch).length) {
          const result = await updateMemory(tripId, memory.id, patch);
          onSaved({ localDateChanged: result.localDateChanged, queued: false });
        }
      }
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof MemoriesApiError && saveError.code === 'memory_storage_full'
          ? t('storageFull')
          : t('saveError'),
      );
      setSaving(false);
    }
  }

  function itemLabel(item: ItineraryItem) {
    return resolveItineraryItemPlaceName(item, t('noContext'));
  }

  const hour12 = preferences.timeFormat === '12h';
  const clock = (time: string) => formatSuggestedClock(time.slice(0, 5), locale, hour12);
  const shortDate = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    weekday: 'short',
  });
  const dateLabel = (date: string) => shortDate.format(new Date(`${date}T00:00:00.000Z`));

  // What the page's two chips say.
  const whereLabel = selectedItem
    ? itemLabel(selectedItem)
    : place.kind === 'current'
      ? currentPlaceLabel
      : place.kind === 'place'
        ? keptPlaceLabel
        : null;
  const whenLabel = localDate
    ? localTime
      ? t('whenValue', { date: dateLabel(localDate), time: clock(localTime) })
      : dateLabel(localDate)
    : null;

  const whereOptions: WhereOption[] = [
    ...(currentPlaceLabel ? [{ id: CURRENT_PLACE, name: currentPlaceLabel, time: null }] : []),
    ...(keptPlaceLabel ? [{ id: KEPT_PLACE, name: keptPlaceLabel, time: null }] : []),
    ...dayItems.map((item) => ({
      id: item.id,
      name: itemLabel(item),
      time: item.localStartTime ? clock(item.localStartTime) : null,
    })),
  ];
  const whenDays: WhenDay[] = (itinerary?.days ?? []).map((day, index) => ({
    date: day.date,
    id: day.id,
    label: dateLabel(day.date),
    number: index + 1,
  }));

  return (
    <>
      <Sheet onOpenChange={(next) => !next && onClose()} open={open}>
        <SheetContent
          className="w-full md:data-[side=right]:w-[min(38rem,calc(100%-0.5rem))]"
          closeLabel={t('cancel')}
        >
          <SheetHeading
            title={isCreate ? t('addTitle') : t('editTitle')}
            description={isCreate ? t('addDescription') : t('editDescription')}
          />

          <div className="min-h-0 flex-1 overflow-y-auto scroll-shadow-y px-5 pt-3 pb-5">
            <input
              accept="image/heic,image/jpeg,image/png,image/webp"
              className="sr-only"
              multiple
              onChange={(event) => {
                addPhotoFiles(event.target.files);
                event.target.value = '';
              }}
              ref={fileInput}
              tabIndex={-1}
              type="file"
            />
            <MemoryPage
              error={error}
              highlight={isHighlight}
              note={note}
              onHighlightChange={setIsHighlight}
              onNoteChange={setNote}
              onOpenWhen={() => setPicker('when')}
              onOpenWhere={() => setPicker('where')}
              prints={{
                busyPhotoId,
                memoryId: memory?.id ?? null,
                onAdd: () => fileInput.current?.click(),
                onMove: (photoId, direction) => void movePhoto(photoId, direction),
                onRemove: setPhotoToDelete,
                onRemovePending: (index) =>
                  setNewPhotos((current) => current.filter((_, entry) => entry !== index)),
                pending: newPhotos,
                photos: existingPhotos,
                uploading: uploadingPhotos,
              }}
              when={whenLabel}
              where={whereLabel}
            />
          </div>

          <SheetFooter>
            {!isCreate ? (
              <Button
                className={footerDeleteClassName}
                data-footer-lead
                onClick={() => setConfirmDelete(true)}
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" data-icon="inline-start" />
                {t('deleteMemory')}
              </Button>
            ) : null}
            <Button onClick={onClose} type="button" variant="outline">
              {t('cancel')}
            </Button>
            <Button disabled={!canSave} onClick={() => void handleSave()} type="button">
              {saving ? t('saving') : t('save')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <MemoryWhereSheet
        dayChosen={dayId !== NO_DAY}
        noneId={NO_ITEM}
        noneLabel={t('noContext')}
        onChooseDay={() => setPicker('when')}
        onOpenChange={(next) => setPicker(next ? 'where' : null)}
        onSelect={selectPlace}
        open={open && picker === 'where'}
        options={whereOptions}
        selectedId={placeValue}
      />
      <MemoryWhenSheet
        days={whenDays}
        localDate={localDate}
        localTime={localTime}
        maxDate={itinerary?.trip.endDate}
        minDate={itinerary?.trip.startDate}
        noDayId={NO_DAY}
        onDateChange={setLocalDate}
        onDayChange={selectDay}
        onOpenChange={(next) => setPicker(next ? 'when' : null)}
        onTimeChange={setLocalTime}
        open={open && picker === 'when'}
        selectedDayId={dayId}
      />

      <AlertDialog
        onOpenChange={(next) => !next && setPhotoToDelete(null)}
        open={Boolean(photoToDelete)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlert aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('deletePhotoTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deletePhotoDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyPhotoId === photoToDelete?.id}
              onClick={() => void confirmPhotoDelete()}
              variant="destructive"
            >
              {t('deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog onOpenChange={setConfirmDelete} open={confirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlert aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('deleteMemoryTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteMemoryDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => void handleDelete()}
              variant="destructive"
            >
              {t('deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
