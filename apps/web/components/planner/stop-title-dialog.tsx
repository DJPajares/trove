'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { type ItineraryItem, updateItineraryItem } from '@/lib/itinerary/api';
import { stopTitleInput } from '@/lib/itinerary/item-editor';
import { resolveTripPlaceName } from '@/lib/trip-places/place-name';

/** A small, title-only edit. It uses the existing queued itinerary mutation offline. */
export function StopTitleDialog({
  item,
  onClose,
  onSaved,
  tripId,
}: Readonly<{
  item: ItineraryItem;
  onClose: () => void;
  onSaved: () => Promise<void>;
  tripId: string;
}>) {
  const t = useTranslations('itinerary');
  const titleT = useTranslations('itinerary.stopTitle');
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const placeName = item.tripPlace
    ? resolveTripPlaceName(item.tripPlace, {
        custom: t('customPlace'),
        provider: t('providerPlace'),
      })
    : null;
  const [value, setValue] = useState(item.customLabel ?? placeName ?? '');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const result = stopTitleInput(value, placeName);
    if ('error' in result) return;
    if (result.input.customLabel === item.customLabel) {
      onClose();
      return;
    }
    setSaving(true);
    setFailed(false);
    try {
      await updateItineraryItem(tripId, item.id, result.input);
      await onSaved();
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        closeLabel={t('close')}
        className="sm:max-w-md"
        finalFocus={() => document.getElementById(`stop-menu-${item.id}`) ?? false}
      >
        <DialogHeader>
          <DialogTitle>{titleT('title')}</DialogTitle>
          <DialogDescription>
            {titleT(item.tripPlace ? 'description' : 'labelOnlyDescription')}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={save}>
          {failed ? (
            <Alert role="alert" variant="destructive">
              <AlertDescription>{t('saveError')}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor={inputId}>{titleT('label')}</FieldLabel>
            <Input
              aria-describedby={placeName ? hintId : undefined}
              autoFocus
              disabled={saving}
              enterKeyHint="done"
              id={inputId}
              maxLength={200}
              onChange={(event) => {
                setValue(event.target.value);
                setFailed(false);
              }}
              placeholder={placeName ?? undefined}
              ref={inputRef}
              required={!placeName}
              value={value}
            />
            {placeName ? (
              <FieldDescription id={hintId}>
                {t('linkedPlace', { place: placeName })}
              </FieldDescription>
            ) : null}
            {placeName ? (
              <Button
                className="self-start"
                disabled={saving || value === placeName}
                onClick={() => {
                  setValue(placeName);
                  inputRef.current?.focus();
                }}
                size="sm"
                type="button"
                variant="link"
              >
                {titleT('restore')}
              </Button>
            ) : null}
          </Field>
          <DialogFooter>
            <Button disabled={saving} onClick={onClose} type="button" variant="outline">
              {t('cancel')}
            </Button>
            <Button disabled={saving || (!placeName && !value.trim())} type="submit">
              {saving ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
