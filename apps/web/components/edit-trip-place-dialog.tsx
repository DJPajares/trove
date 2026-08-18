'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { updateCustomPlace } from '@/lib/saved/api';
import type { TripPlace } from '@/lib/trip-places/api';

type EditTripPlaceDialogProps = {
  onOpenChange: (open: boolean) => void;
  /** Renaming a custom Place changes the Place itself, so the collection is reloaded. */
  onRefresh: () => Promise<void> | void;
  onSave: (
    tripPlace: TripPlace,
    input: { customName?: string | null; note?: string | null },
  ) => Promise<boolean>;
  tripPlace: TripPlace | null;
};

/**
 * What the traveller calls a Place and what they wrote about it, edited together.
 *
 * Where the name lands depends on the kind of Place. A custom Place is theirs, so
 * the name belongs to the Place. A provider Place is shared with everyone who ever
 * searched for it, so the name is kept against this trip and leaving the field
 * empty simply hands the Place back to whatever Google calls it.
 */
export function EditTripPlaceDialog({
  onOpenChange,
  onRefresh,
  onSave,
  tripPlace,
}: Readonly<EditTripPlaceDialogProps>) {
  const t = useTranslations('tripPlaces');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const isCustom = tripPlace?.place.kind === 'custom';
  const providerName = tripPlace?.place.snapshot?.name ?? tripPlace?.place.providerLabel;

  useEffect(() => {
    if (!tripPlace) return;
    setName(
      (tripPlace.place.kind === 'custom' ? tripPlace.place.name : tripPlace.customName) ?? '',
    );
    setNote(tripPlace.note ?? '');
    setFailed(false);
  }, [tripPlace]);

  async function save() {
    if (!tripPlace) return;
    const trimmed = name.trim();
    if (isCustom && !trimmed) return;

    setSaving(true);
    setFailed(false);
    try {
      if (isCustom) {
        // The note lives on the trip place, the name on the Place itself.
        await updateCustomPlace(tripPlace.place.id, { name: trimmed });
        const saved = await onSave(tripPlace, { note });
        await onRefresh();
        if (!saved) return;
      } else if (!(await onSave(tripPlace, { customName: trimmed || null, note }))) {
        return;
      }
      onOpenChange(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(tripPlace)}>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('editPlaceTitle')}</DialogTitle>
          <DialogDescription>{t('editPlaceDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="trip-place-name-editor">{t('placeNameLabel')}</FieldLabel>
            <Input
              id="trip-place-name-editor"
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              placeholder={
                isCustom ? t('placeNamePlaceholder') : (providerName ?? t('providerPlace'))
              }
              required={isCustom}
              value={name}
            />
            {isCustom ? null : <FieldDescription>{t('providerNameHint')}</FieldDescription>}
          </Field>

          <Field>
            <FieldLabel htmlFor="trip-place-note-editor">{t('note')}</FieldLabel>
            <Textarea
              id="trip-place-note-editor"
              maxLength={5000}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('notePlaceholder')}
              value={note}
            />
          </Field>

          {failed ? (
            <p className="text-sm text-destructive" role="alert">
              {t('actionError')}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button disabled={saving} onClick={() => onOpenChange(false)} variant="outline">
            {t('cancel')}
          </Button>
          <Button disabled={saving || (isCustom && !name.trim())} onClick={() => void save()}>
            {saving ? t('saving') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
