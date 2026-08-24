'use client';

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
import { useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

import { TripMedia } from '@/components/trip-media';
import { TripOptionalDetails } from '@/components/trip-optional-details';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { editorialSubjectKey, type EditorialSubject } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import {
  EDITORIAL_PREVIEW_DEBOUNCE_MS,
  editorialCoverSubjectName,
  hasOptionalTripDetails,
  isValidPartySize,
} from '@/lib/trips/form';
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
import { SheetFooter } from '@/components/ui/sheet';
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
  // A trip that already carries optional detail opens showing it: a traveller
  // must never have to go looking for their own notes.
  const [detailsOpen, setDetailsOpen] = useState(() => hasOptionalTripDetails(trip));
  const [pendingDetailsFocus, setPendingDetailsFocus] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving'>('idle');
  const [pendingShrink, setPendingShrink] = useState<PendingShrink | null>(null);
  const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  useEffect(() => {
    return () => {
      if (coverPreview?.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  // The panel's fields are unmounted while it is closed, so focus has to wait
  // for the open to land rather than following the click that caused it.
  useEffect(() => {
    if (!pendingDetailsFocus || !detailsOpen) return;
    document.getElementById('trip-party-size')?.focus();
    setPendingDetailsFocus(false);
  }, [detailsOpen, pendingDetailsFocus]);

  // What the cover should show while the trip is still being described. The
  // draft settles before it is asked about, so typing a city name costs one
  // request rather than one per keystroke.
  const draftSubjectName = editorialCoverSubjectName(form.destinations);
  const [coverSubjectName, setCoverSubjectName] = useState(draftSubjectName);

  useEffect(() => {
    if (!draftSubjectName) {
      setCoverSubjectName('');
      return;
    }
    const timer = setTimeout(
      () => setCoverSubjectName(draftSubjectName),
      EDITORIAL_PREVIEW_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [draftSubjectName]);

  const coverSubject: EditorialSubject | null = coverSubjectName
    ? { category: 'destination', name: coverSubjectName, tripId: trip?.id }
    : null;
  const editorialImages = useEditorialImages(coverSubject ? [coverSubject] : []);
  const coverEditorial = coverSubject
    ? (editorialImages.get(editorialSubjectKey(coverSubject)) ?? null)
    : null;

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
    if (field === 'startDate' || field === 'endDate') setDateError(null);
  }

  /** The same thing for a group of fields the form does not own the markup of. */
  function updateFields(changes: Partial<FormState>) {
    setForm((current) => ({ ...current, ...changes }));
    setError(null);
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
    if (!isValidPartySize(form.partySize)) {
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
    if (!input) {
      // A rule that fires inside a closed panel is a silent one: open it and
      // put the traveller on the field that stopped the save.
      if (!isValidPartySize(form.partySize)) {
        setDetailsOpen(true);
        setPendingDetailsFocus(true);
      }
      return;
    }

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

          <section aria-labelledby="trip-cover-heading" className="space-y-4 border-t pt-7">
            <div>
              <h3 className="font-medium" id="trip-cover-heading">
                {t('coverTitle')}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{t('coverHint')}</p>
            </div>
            {/* One frame for both answers. The shared ladder puts an upload
                above the suggestion, so removing an upload simply reveals the
                photograph underneath it again. */}
            <TripMedia
              alt={t('coverAlt')}
              className="aspect-[16/9] w-full"
              sizes="(max-width: 640px) 100vw, 640px"
              source={resolveTripMediaSource({ coverUrl: coverPreview, editorial: coverEditorial })}
              variant="card"
            />
            {coverEditorial && !coverPreview ? (
              <p className="text-sm text-muted-foreground">
                {t('coverEditorialHint', { name: coverSubjectName })}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {/* The input this wraps is `sr-only`, so it is focusable but has
                  no ring of its own to show; the label wears it instead. */}
              <label
                className={cn(
                  buttonVariants({ variant: 'outline' }),
                  'cursor-pointer focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40',
                )}
              >
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

          <section className="border-t pt-7">
            <Collapsible onOpenChange={setDetailsOpen} open={detailsOpen}>
              <CollapsibleTrigger className="group w-full justify-between text-left">
                <span>
                  <span className="block font-medium text-foreground">{t('moreDetails')}</span>
                  <span className="mt-1 block text-sm font-normal text-muted-foreground">
                    {t('moreDetailsHint')}
                  </span>
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="shrink-0 transition-transform duration-[var(--motion-standard)] group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
                />
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <TripOptionalDetails
                  deviceTimeZone={deviceTimeZone}
                  onChange={updateFields}
                  trip={trip}
                  values={{
                    notes: form.notes,
                    partySize: form.partySize,
                    planningReadiness: form.planningReadiness,
                    referenceTimeZone: form.referenceTimeZone,
                    startingLocation: form.startingLocation,
                  }}
                />
              </CollapsiblePanel>
            </Collapsible>
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
