'use client';

import { ImagePlus, Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import type { ItineraryItem } from '@/lib/itinerary/api';
import {
  allowedMemoryPhotoTypes,
  createMemory,
  maxMemoryPhotoSize,
  uploadMemoryPhoto,
} from '@/lib/memories/api';

const NO_CONTEXT = 'none';

/**
 * Fast Memory capture for Trip Mode. Context is inferred from the day the
 * traveller is looking at and the item they are on, stays visible, and can be
 * changed or cleared without blocking the save. The trip-local capture time and
 * timezone are resolved by the server from that context, so a device in another
 * timezone never decides when a Memory happened.
 */
export function TripModeMemoryDialog({
  dayDate,
  dayId,
  defaultItemId,
  items,
  onOpenChange,
  onSaved,
  open,
  timeZone,
  tripId,
}: Readonly<{
  dayDate: string;
  dayId: string;
  defaultItemId?: string | null;
  items: ItineraryItem[];
  onOpenChange: (open: boolean) => void;
  onSaved: (note: string | null) => void;
  open: boolean;
  timeZone: string;
  tripId: string;
}>) {
  const t = useTranslations('memories.capture');
  const fileInput = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [isHighlight, setIsHighlight] = useState(false);
  const [itemId, setItemId] = useState<string>(NO_CONTEXT);
  const [photos, setPhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNote('');
    setIsHighlight(false);
    setItemId(defaultItemId ?? NO_CONTEXT);
    setPhotos([]);
    setError(null);
    setSaving(false);
  }, [defaultItemId, open]);

  const contextItems = useMemo(
    () => items.filter((item) => item.tripPlace || item.customLabel),
    [items],
  );
  const selectedItem = contextItems.find((item) => item.id === itemId) ?? null;
  const canSave = (note.trim().length > 0 || photos.length > 0) && !saving;

  function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    const accepted: File[] = [];

    for (const file of files) {
      if (!allowedMemoryPhotoTypes.has(file.type) || file.size > maxMemoryPhotoSize) {
        setError(t('photoRejected'));
        continue;
      }
      accepted.push(file);
    }

    if (accepted.length) setPhotos((current) => [...current, ...accepted]);
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    try {
      const memory = await createMemory(tripId, {
        isHighlight,
        itineraryDayId: dayId,
        itineraryItemId: selectedItem?.id ?? null,
        note: note.trim() ? note.trim() : null,
        tripPlaceId: selectedItem?.tripPlace?.id ?? null,
      });

      for (const photo of photos) {
        await uploadMemoryPhoto(tripId, memory.id, photo);
      }

      onSaved(memory.note);
      onOpenChange(false);
    } catch {
      setError(t('saveError'));
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md" closeLabel={t('cancel')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs leading-5 text-text-subtle">
            {t('capturedContext', { date: dayDate, timeZone })}
          </p>

          <div className="space-y-2">
            <input
              accept="image/heic,image/jpeg,image/png,image/webp"
              className="sr-only"
              multiple
              onChange={(event) => {
                addPhotos(event.target.files);
                event.target.value = '';
              }}
              ref={fileInput}
              type="file"
            />
            <Button
              className="w-full"
              onClick={() => fileInput.current?.click()}
              type="button"
              variant="outline"
            >
              <ImagePlus aria-hidden="true" data-icon="inline-start" />
              {t('addPhotos')}
            </Button>
            {photos.length ? (
              <ul aria-label={t('photoList')} className="space-y-1">
                {photos.map((photo, index) => (
                  <li
                    className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] bg-muted/40 px-3 py-1.5"
                    key={`${photo.name}-${index}`}
                  >
                    <span className="min-w-0 truncate text-sm">{photo.name}</span>
                    <Button
                      aria-label={t('removePhoto', { name: photo.name })}
                      onClick={() =>
                        setPhotos((current) => current.filter((_, entry) => entry !== index))
                      }
                      size="icon-sm"
                      variant="ghost"
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <Field>
            <FieldLabel htmlFor="memory-note">{t('note')}</FieldLabel>
            <Textarea
              autoFocus
              id="memory-note"
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('notePlaceholder')}
              rows={3}
              value={note}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="memory-context">{t('context')}</FieldLabel>
            <Select onValueChange={(value) => setItemId(value ?? NO_CONTEXT)} value={itemId}>
              <SelectTrigger id="memory-context">
                <SelectValue>
                  {selectedItem
                    ? (selectedItem.tripPlace?.place.name ??
                      selectedItem.customLabel ??
                      t('noContext'))
                    : t('noContext')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CONTEXT}>{t('noContext')}</SelectItem>
                {contextItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.tripPlace?.place.name ?? item.customLabel ?? t('noContext')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{t('contextDescription')}</FieldDescription>
          </Field>

          <Field orientation="horizontal">
            <FieldLabel htmlFor="memory-highlight">{t('highlight')}</FieldLabel>
            <Switch
              checked={isHighlight}
              id="memory-highlight"
              onCheckedChange={(checked) => setIsHighlight(checked)}
            />
          </Field>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)} variant="ghost">
              {t('cancel')}
            </Button>
            <Button disabled={!canSave} onClick={() => void handleSave()}>
              <Sparkles aria-hidden="true" data-icon="inline-start" />
              {saving ? t('saving') : t('save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
