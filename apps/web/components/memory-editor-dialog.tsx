'use client';

import { ChevronDown, ChevronUp, ImagePlus, Trash2, TriangleAlert, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { TimeInput } from '@/components/time-input';
import type { Itinerary, ItineraryItem } from '@/lib/itinerary/api';
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
import { resolveItineraryItemPlaceName } from '@/lib/trip-places/place-name';

const NO_DAY = 'none';
const NO_ITEM = 'none';

type SaveResult = { localDateChanged: boolean; queued: boolean };

/**
 * Curates one Memory after the fact: caption, highlight state, day/item context,
 * the captured date/time when it needs correcting, and photo management. The
 * same dialog also adds a Memory the traveller forgot to capture, through the
 * identical fields and the same underlying capture path.
 */
export function MemoryEditorDialog({
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
  const isCreate = memory === null;
  const fileInput = useRef<HTMLInputElement>(null);

  const [note, setNote] = useState('');
  const [isHighlight, setIsHighlight] = useState(false);
  const [dayId, setDayId] = useState(NO_DAY);
  const [itemId, setItemId] = useState(NO_ITEM);
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

  useEffect(() => {
    if (!open) return;
    setNote(memory?.note ?? '');
    setIsHighlight(memory?.isHighlight ?? false);
    setDayId(memory?.itineraryDay?.id ?? NO_DAY);
    setItemId(memory?.itineraryItem?.id ?? NO_ITEM);
    setLocalDate(memory?.capturedLocalDate ?? '');
    setLocalTime(memory?.capturedLocalTime ?? '');
    setExistingPhotos(memory?.photos ?? []);
    setNewPhotos([]);
    setError(null);
    setSaving(false);
    setUploadingPhotos(false);
    setPhotoToDelete(null);
    setConfirmDelete(false);
  }, [memory, open]);

  const selectedDay = itinerary?.days.find((day) => day.id === dayId) ?? null;
  const dayItems = useMemo(
    () => selectedDay?.items.filter((item) => item.tripPlace || item.customLabel) ?? [],
    [selectedDay],
  );
  const selectedItem = dayItems.find((item) => item.id === itemId) ?? null;

  function selectDay(value: string) {
    setDayId(value);
    setItemId(NO_ITEM);
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
      itineraryItemId: selectedItem?.id ?? null,
      tripPlaceId: selectedItem?.tripPlace?.id ?? null,
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
        const result = await updateMemory(tripId, memory.id, {
          ...context,
          ...local,
          isHighlight,
          note: note.trim() ? note.trim() : null,
        });
        onSaved({ localDateChanged: result.localDateChanged, queued: false });
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

  return (
    <>
      <Dialog onOpenChange={(next) => !next && onClose()} open={open}>
        <DialogContent className="sm:max-w-lg" closeLabel={t('cancel')}>
          <DialogHeader>
            <DialogTitle>{isCreate ? t('addTitle') : t('editTitle')}</DialogTitle>
            <DialogDescription>
              {isCreate ? t('addDescription') : t('editDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <Field>
              <FieldLabel htmlFor="memory-editor-note">{t('note')}</FieldLabel>
              <Textarea
                id="memory-editor-note"
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t('notePlaceholder')}
                rows={3}
                value={note}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="memory-editor-day">{t('day')}</FieldLabel>
                <Select onValueChange={(value) => value && selectDay(value)} value={dayId}>
                  <SelectTrigger id="memory-editor-day">
                    <SelectValue>{selectedDay ? selectedDay.date : t('noDay')}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_DAY}>{t('noDay')}</SelectItem>
                    {itinerary?.days.map((day) => (
                      <SelectItem key={day.id} value={day.id}>
                        {day.date}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="memory-editor-item">{t('place')}</FieldLabel>
                <Select onValueChange={(value) => setItemId(value ?? NO_ITEM)} value={itemId}>
                  <SelectTrigger disabled={dayId === NO_DAY} id="memory-editor-item">
                    <SelectValue>
                      {selectedItem ? itemLabel(selectedItem) : t('noContext')}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ITEM}>{t('noContext')}</SelectItem>
                    {dayItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {itemLabel(item)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>{t('placeDescription')}</FieldDescription>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="memory-editor-date">{t('capturedDate')}</FieldLabel>
                <DatePicker
                  id="memory-editor-date"
                  label={t('capturedDate')}
                  max={itinerary?.trip.endDate}
                  min={itinerary?.trip.startDate}
                  onChange={setLocalDate}
                  value={localDate}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="memory-editor-time">{t('capturedTime')}</FieldLabel>
                <TimeInput
                  disabled={!localDate}
                  id="memory-editor-time"
                  onValueChange={setLocalTime}
                  value={localTime}
                />
              </Field>
            </div>
            <FieldDescription>{t('capturedHint')}</FieldDescription>

            <Field orientation="horizontal">
              <FieldLabel htmlFor="memory-editor-highlight">{t('highlight')}</FieldLabel>
              <Switch
                checked={isHighlight}
                id="memory-editor-highlight"
                onCheckedChange={setIsHighlight}
              />
            </Field>

            <div className="space-y-2">
              <FieldLabel>{t('photos')}</FieldLabel>
              <input
                accept="image/heic,image/jpeg,image/png,image/webp"
                className="sr-only"
                multiple
                onChange={(event) => {
                  addPhotoFiles(event.target.files);
                  event.target.value = '';
                }}
                ref={fileInput}
                type="file"
              />
              <Button
                disabled={uploadingPhotos}
                onClick={() => fileInput.current?.click()}
                type="button"
                variant="outline"
              >
                <ImagePlus aria-hidden="true" data-icon="inline-start" />
                {uploadingPhotos ? t('uploadingPhotos') : t('addPhotos')}
              </Button>

              {existingPhotos.length ? (
                <ul aria-label={t('photoList')} className="space-y-1">
                  {existingPhotos.map((photo, index) => (
                    <li
                      className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] bg-muted/40 px-3 py-1.5"
                      key={photo.id}
                    >
                      <span className="min-w-0 truncate text-sm">{photo.fileName}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        <Button
                          aria-label={t('movePhotoUp', { name: photo.fileName })}
                          disabled={index === 0 || busyPhotoId === photo.id}
                          onClick={() => void movePhoto(photo.id, -1)}
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          <ChevronUp aria-hidden="true" />
                        </Button>
                        <Button
                          aria-label={t('movePhotoDown', { name: photo.fileName })}
                          disabled={index === existingPhotos.length - 1 || busyPhotoId === photo.id}
                          onClick={() => void movePhoto(photo.id, 1)}
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          <ChevronDown aria-hidden="true" />
                        </Button>
                        <Button
                          aria-label={t('removePhoto', { name: photo.fileName })}
                          disabled={busyPhotoId === photo.id}
                          onClick={() => setPhotoToDelete(photo)}
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          <X aria-hidden="true" />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {newPhotos.length ? (
                <ul aria-label={t('photoList')} className="space-y-1">
                  {newPhotos.map((photo, index) => (
                    <li
                      className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] bg-muted/40 px-3 py-1.5"
                      key={`${photo.name}-${index}`}
                    >
                      <span className="min-w-0 truncate text-sm">{photo.name}</span>
                      <Button
                        aria-label={t('removePhoto', { name: photo.name })}
                        onClick={() =>
                          setNewPhotos((current) => current.filter((_, entry) => entry !== index))
                        }
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            {!isCreate ? (
              <Button onClick={() => setConfirmDelete(true)} type="button" variant="ghost">
                <Trash2 aria-hidden="true" data-icon="inline-start" />
                {t('deleteMemory')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={onClose} variant="ghost">
                {t('cancel')}
              </Button>
              <Button disabled={!canSave} onClick={() => void handleSave()}>
                {saving ? t('saving') : t('save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
