'use client';

import Image from 'next/image';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CircleAlert,
  ImagePlus,
  Plus,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DatePicker } from '@/components/date-picker';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SheetFooter } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  createTrip,
  removeTripCover,
  saveTrip,
  TripApiError,
  type Trip,
  type TripInput,
  uploadTripCover,
} from '@/lib/trips/api';
import { cn } from '@/lib/utils';

type TripFormProps = {
  onCancel: () => void;
  onDelete?: () => void;
  onSaved: (trip: Trip) => void;
  trip: Trip | null;
};

type FormState = {
  coverPhotoPath: string | null;
  destinations: string[];
  endDate: string;
  name: string;
  notes: string;
  partySize: string;
  planningReadiness: 'in_progress' | 'ready';
  referenceTimeZone: string;
  startDate: string;
  startingLocation: string;
};

type PendingShrink = {
  affectedItemCount: number;
  input: TripInput;
  uploadedPath: string | null;
};

function getToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function createInitialForm(trip: Trip | null): FormState {
  const today = getToday();

  return {
    coverPhotoPath: trip?.coverPhotoPath ?? null,
    destinations: trip?.destinations.map((destination) => destination.name) ?? [],
    endDate: trip?.endDate ?? today,
    name: trip?.name ?? '',
    notes: trip?.notes ?? '',
    partySize: String(trip?.partySize ?? 1),
    planningReadiness: trip?.planningReadiness ?? 'in_progress',
    referenceTimeZone: trip?.referenceTimeZoneSource === 'explicit' ? trip.referenceTimeZone : '',
    startDate: trip?.startDate ?? today,
    startingLocation: trip?.startingLocationOverride ?? '',
  };
}

export function TripForm({ onCancel, onDelete, onSaved, trip }: TripFormProps) {
  const t = useTranslations('trips');
  const [form, setForm] = useState(() => createInitialForm(trip));
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(trip?.coverPhotoUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [locationDetailsOpen, setLocationDetailsOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving'>('idle');
  const [pendingShrink, setPendingShrink] = useState<PendingShrink | null>(null);
  const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const timeZones = useMemo(() => {
    const supportedValuesOf = (
      Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
    ).supportedValuesOf;
    return supportedValuesOf
      ? ['UTC', ...supportedValuesOf('timeZone').filter((timeZone) => timeZone !== 'UTC')]
      : [deviceTimeZone];
  }, [deviceTimeZone]);

  useEffect(() => {
    return () => {
      if (coverPreview?.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
    if (field === 'startDate' || field === 'endDate') setDateError(null);
  }

  function updateDestination(index: number, value: string) {
    setForm((current) => ({
      ...current,
      destinations: current.destinations.map((destination, position) =>
        position === index ? value : destination,
      ),
    }));
  }

  function moveDestination(index: number, direction: -1 | 1) {
    setForm((current) => {
      const destinations = [...current.destinations];
      const target = index + direction;
      if (target < 0 || target >= destinations.length) return current;
      [destinations[index], destinations[target]] = [destinations[target]!, destinations[index]!];
      return { ...current, destinations };
    });
  }

  function handleCoverChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) return;

    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 8 * 1024 * 1024
    ) {
      setError(t('coverInvalid'));
      return;
    }

    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
    setForm((current) => ({ ...current, coverPhotoPath: null }));
  }

  function buildInput(coverPhotoPath: string | null): TripInput | null {
    const partySize = Number(form.partySize);
    if (!form.name.trim()) {
      setError(t('nameRequired'));
      return null;
    }
    if (!form.startDate || !form.endDate || form.endDate < form.startDate) {
      setDateError(t('dateRangeError'));
      return null;
    }
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 99) {
      setError(t('partySizeError'));
      return null;
    }

    return {
      coverPhotoPath,
      destinations: form.destinations
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ name })),
      deviceTimeZone,
      endDate: form.endDate,
      name: form.name.trim(),
      notes: form.notes.trim() || null,
      partySize,
      planningReadiness: form.planningReadiness,
      referenceTimeZone: form.referenceTimeZone || null,
      startDate: form.startDate,
      startingLocation: form.startingLocation.trim() || null,
    };
  }

  async function finishSave(input: TripInput) {
    const previousPath = trip?.coverPhotoPath ?? null;
    const result = trip ? await saveTrip(trip.id, input) : await createTrip(input);

    if (previousPath && previousPath !== result.trip.coverPhotoPath) {
      await removeTripCover(previousPath).catch(() => undefined);
    }
    setPendingShrink(null);
    onSaved(result.trip);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDateError(null);
    let input = buildInput(form.coverPhotoPath);
    if (!input) return;

    setStatus('saving');

    let uploadedPath: string | null = null;

    try {
      if (coverFile) {
        uploadedPath = (await uploadTripCover(coverFile)).path;
        input = { ...input, coverPhotoPath: uploadedPath };
      }
      await finishSave(input);
    } catch (saveError) {
      if (
        saveError instanceof TripApiError &&
        saveError.code === 'trip_date_shrink_confirmation_required'
      ) {
        setPendingShrink({
          affectedItemCount: saveError.affectedItemCount ?? 0,
          input,
          uploadedPath,
        });
        return;
      }

      if (uploadedPath) await removeTripCover(uploadedPath).catch(() => undefined);
      setError(
        saveError instanceof TripApiError && saveError.code === 'trip_cover_upload_failed'
          ? t('coverError')
          : t('saveError'),
      );
    } finally {
      setStatus('idle');
    }
  }

  async function confirmDateShrink() {
    if (!pendingShrink) return;
    setStatus('saving');
    setError(null);

    try {
      await finishSave({ ...pendingShrink.input, confirmDateShrink: true });
    } catch {
      if (pendingShrink.uploadedPath) {
        await removeTripCover(pendingShrink.uploadedPath).catch(() => undefined);
      }
      setPendingShrink(null);
      setError(t('saveError'));
    } finally {
      setStatus('idle');
    }
  }

  async function cancelDateShrink() {
    if (pendingShrink?.uploadedPath) {
      await removeTripCover(pendingShrink.uploadedPath).catch(() => undefined);
    }
    setPendingShrink(null);
  }

  return (
    <>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
        <div className="flex-1 space-y-8 overflow-y-auto px-5 pb-8">
          {error ? (
            <Alert role="alert" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <section aria-labelledby="trip-basics-heading" className="space-y-5">
            <div>
              <h3 className="font-medium" id="trip-basics-heading">
                {t('basicsTitle')}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{t('basicsDescription')}</p>
            </div>
            <Field data-invalid={!form.name.trim() && Boolean(error)}>
              <FieldLabel htmlFor="trip-name">{t('name')}</FieldLabel>
              <Input
                aria-invalid={!form.name.trim() && Boolean(error)}
                autoComplete="off"
                id="trip-name"
                maxLength={120}
                onChange={(event) => updateField('name', event.target.value)}
                placeholder={t('namePlaceholder')}
                required
                value={form.name}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(dateError)}>
                <FieldLabel htmlFor="trip-start-date">{t('startDate')}</FieldLabel>
                <DatePicker
                  aria-describedby={dateError ? 'trip-date-error' : undefined}
                  aria-invalid={Boolean(dateError)}
                  id="trip-start-date"
                  label={t('startDate')}
                  onChange={(value) => updateField('startDate', value)}
                  required
                  value={form.startDate}
                />
              </Field>
              <Field data-invalid={Boolean(dateError)}>
                <FieldLabel htmlFor="trip-end-date">{t('endDate')}</FieldLabel>
                <DatePicker
                  aria-describedby={dateError ? 'trip-date-error' : undefined}
                  aria-invalid={Boolean(dateError)}
                  id="trip-end-date"
                  label={t('endDate')}
                  min={form.startDate}
                  onChange={(value) => updateField('endDate', value)}
                  required
                  value={form.endDate}
                />
              </Field>
            </div>
            <FieldError id="trip-date-error">{dateError}</FieldError>
          </section>

          <section aria-labelledby="trip-destinations-heading" className="space-y-4 border-t pt-7">
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-4">
              <div>
                <h3 className="font-medium" id="trip-destinations-heading">
                  {t('destinationsTitle')}
                </h3>
                <FieldDescription>{t('destinationsDescription')}</FieldDescription>
              </div>
              <Button
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    destinations: [...current.destinations, ''],
                  }))
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus aria-hidden="true" data-icon="inline-start" />
                {t('addDestination')}
              </Button>
            </div>
            {form.destinations.length ? (
              <div className="space-y-3">
                {form.destinations.map((destination, index) => (
                  <div
                    className="flex items-center gap-2"
                    key={`${index}-${form.destinations.length}`}
                  >
                    <span className="w-5 text-center text-xs tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <Input
                      aria-label={t('destinationLabel', { number: index + 1 })}
                      maxLength={200}
                      onChange={(event) => updateDestination(index, event.target.value)}
                      placeholder={t('destinationPlaceholder')}
                      value={destination}
                    />
                    <div className="flex shrink-0">
                      <Button
                        aria-label={t('moveDestinationUp')}
                        disabled={index === 0}
                        onClick={() => moveDestination(index, -1)}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        aria-label={t('moveDestinationDown')}
                        disabled={index === form.destinations.length - 1}
                        onClick={() => moveDestination(index, 1)}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      <Button
                        aria-label={t('removeDestination')}
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            destinations: current.destinations.filter(
                              (_, position) => position !== index,
                            ),
                          }))
                        }
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('noDestinations')}</p>
            )}
          </section>

          <section aria-labelledby="trip-details-heading" className="space-y-5 border-t pt-7">
            <div>
              <h3 className="font-medium" id="trip-details-heading">
                {t('detailsTitle')}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{t('detailsDescription')}</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="trip-party-size">{t('partySize')}</FieldLabel>
                <Input
                  id="trip-party-size"
                  inputMode="numeric"
                  max={99}
                  min={1}
                  onChange={(event) => updateField('partySize', event.target.value)}
                  type="number"
                  value={form.partySize}
                />
                <FieldDescription>{t('partySizeHint')}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="trip-readiness">{t('readiness')}</FieldLabel>
                <Select
                  onValueChange={(value) => {
                    if (!value) return;
                    updateField('planningReadiness', value as FormState['planningReadiness']);
                  }}
                  value={form.planningReadiness}
                >
                  <SelectTrigger className="w-full" id="trip-readiness">
                    <SelectValue>
                      {(value) => (value === 'ready' ? t('ready') : t('inProgress'))}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_progress">{t('inProgress')}</SelectItem>
                    <SelectItem value="ready">{t('ready')}</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>{t('readinessHint')}</FieldDescription>
              </Field>
            </div>
            <details
              className="group border-y border-border py-4"
              onToggle={(event) => setLocationDetailsOpen(event.currentTarget.open)}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-sm)] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
                <span>
                  {t('locationAndTimeZone')}
                  <span className="mt-1 block text-sm font-normal text-muted-foreground">
                    {t('locationAndTimeZoneHint')}
                  </span>
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                />
              </summary>
              {locationDetailsOpen ? (
                <div className="space-y-5 pt-5">
                  <Field>
                    <FieldLabel htmlFor="trip-starting-location">
                      {t('startingLocation')}
                    </FieldLabel>
                    <Input
                      id="trip-starting-location"
                      maxLength={200}
                      onChange={(event) => updateField('startingLocation', event.target.value)}
                      placeholder={
                        trip?.startingLocation?.isOverride
                          ? undefined
                          : t('startingLocationPlaceholder')
                      }
                      value={form.startingLocation}
                    />
                    <FieldDescription>
                      {trip?.startingLocation && !trip.startingLocation.isOverride
                        ? t('startingLocationHome', { location: trip.startingLocation.name })
                        : t('startingLocationHint')}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="trip-time-zone">{t('timeZone')}</FieldLabel>
                    <NativeSelect
                      className="w-full"
                      id="trip-time-zone"
                      onChange={(event) => updateField('referenceTimeZone', event.target.value)}
                      value={form.referenceTimeZone}
                    >
                      <NativeSelectOption value="">
                        {t('timeZoneAutomatic', {
                          timeZone: trip?.referenceTimeZone ?? deviceTimeZone,
                        })}
                      </NativeSelectOption>
                      {timeZones.map((timeZone) => (
                        <NativeSelectOption key={timeZone} value={timeZone}>
                          {timeZone.replaceAll('_', ' ')}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <FieldDescription>{t('timeZoneHint')}</FieldDescription>
                  </Field>
                </div>
              ) : null}
            </details>
            <Field>
              <FieldLabel htmlFor="trip-notes">{t('notes')}</FieldLabel>
              <Textarea
                id="trip-notes"
                maxLength={5_000}
                onChange={(event) => updateField('notes', event.target.value)}
                placeholder={t('notesPlaceholder')}
                rows={4}
                value={form.notes}
              />
            </Field>
          </section>

          <section aria-labelledby="trip-cover-heading" className="space-y-4 border-t pt-7">
            <div>
              <h3 className="font-medium" id="trip-cover-heading">
                {t('coverTitle')}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{t('coverHint')}</p>
            </div>
            {coverPreview ? (
              <div className="relative aspect-[16/9] overflow-hidden rounded-[var(--radius-lg)] bg-muted">
                <Image
                  alt={t('coverAlt')}
                  className="object-cover"
                  fill
                  sizes="(max-width: 640px) 100vw, 640px"
                  src={coverPreview}
                  unoptimized
                />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <label className={cn(buttonVariants({ variant: 'outline' }), 'cursor-pointer')}>
                <ImagePlus aria-hidden="true" data-icon="inline-start" />
                {coverPreview ? t('changeCover') : t('chooseCover')}
                <Input
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={handleCoverChange}
                  type="file"
                />
              </label>
              {coverPreview ? (
                <Button
                  onClick={() => {
                    setCoverFile(null);
                    setCoverPreview(null);
                    setForm((current) => ({ ...current, coverPhotoPath: null }));
                  }}
                  type="button"
                  variant="ghost"
                >
                  {t('removeCover')}
                </Button>
              ) : null}
            </div>
          </section>
        </div>

        <SheetFooter className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          {onDelete ? (
            <Button
              className="self-start text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={status === 'saving'}
              onClick={onDelete}
              type="button"
              variant="ghost"
            >
              <Trash2 aria-hidden="true" data-icon="inline-start" />
              {t('deleteTrip')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              disabled={status === 'saving'}
              onClick={onCancel}
              type="button"
              variant="outline"
            >
              {t('cancel')}
            </Button>
            <Button disabled={status === 'saving'} type="submit">
              {status === 'saving' ? t('saving') : trip ? t('saveChanges') : t('createTrip')}
            </Button>
          </div>
        </SheetFooter>
      </form>

      <AlertDialog
        open={Boolean(pendingShrink)}
        onOpenChange={(open) => !open && void cancelDateShrink()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dateShrinkTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('dateShrinkDescription', { count: pendingShrink?.affectedItemCount ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => void cancelDateShrink()}>
              {t('keepDates')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDateShrink()}
              type="button"
              variant="destructive"
            >
              {t('moveToUnscheduled')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
