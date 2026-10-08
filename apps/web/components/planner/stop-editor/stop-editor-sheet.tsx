'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';

import { useSuggestedTime } from '@/components/itinerary-suggested-time';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { useTripContext } from '@/components/trip-provider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  createItineraryItem,
  ItineraryApiError,
  type ItineraryItem,
  type ItineraryTripPlace,
  updateItineraryItem,
} from '@/lib/itinerary/api';
import {
  buildStopInput,
  type ItineraryIdentityChoice,
  itineraryIdentityChoice,
  stopEditorCustomDuration,
  stopEditorForm,
  type StopEditorForm,
} from '@/lib/itinerary/item-editor';
import type { ScheduledPlaceUse } from '@/lib/itinerary/places';
import { queryKeys } from '@/lib/query/keys';
import { fetchSavedPlaces } from '@/lib/saved/api';
import type { ProviderSearchLocationBias } from '@/lib/saved/provider-search-session';
import type { TripPlace } from '@/lib/trip-places/api';
import { savedPlacesNearTrip } from '@/lib/trip-places/saved-near-trip';

import { PlaceField } from './place-field';
import { TimingField } from './timing-field';

/**
 * What the editor was opened for: a new stop on a day - perhaps inserted
 * between two others, perhaps already at a Trip Place - or a stop to change.
 */
export type StopEditorRequest =
  | {
      dayId: string;
      /** "Day 3", for the title. */
      dayLabel: string;
      /** Inserting rather than adding at the end: where, and after which stop. */
      insert?: { afterName: string | null; position: number } | null;
      kind: 'create';
      tripPlaceId?: string | null;
    }
  | { dayId: string; focus?: 'place' | 'timing'; item: ItineraryItem; kind: 'edit' };

export type StopEditorSaved = { timeZoneConsequence: boolean };

function itineraryTripPlaceFrom(tripPlace: TripPlace): ItineraryTripPlace {
  return {
    customName: tripPlace.customName,
    id: tripPlace.id,
    note: tripPlace.note,
    place: { ...tripPlace.place, timeZone: tripPlace.place.location?.timeZone ?? null },
    priority: tripPlace.priority,
  };
}

function StopEditorBody({
  locationBias,
  onClose,
  onDelete,
  onSaved,
  onTripPlaceAdded,
  placeUse,
  request,
  tripId,
  tripPlaces,
}: Readonly<{
  locationBias: ProviderSearchLocationBias | null;
  onClose: () => void;
  /** Only an edit offers Delete; the caller confirms it. */
  onDelete?: (item: ItineraryItem) => void;
  onSaved: (result: StopEditorSaved) => Promise<void>;
  onTripPlaceAdded: (tripPlace: TripPlace) => void;
  placeUse: Record<string, ScheduledPlaceUse>;
  request: StopEditorRequest;
  tripId: string;
  tripPlaces: readonly ItineraryTripPlace[];
}>) {
  const t = useTranslations('itinerary');
  const plannerT = useTranslations('itinerary.planner.editor');
  const online = useOnlineStatus();
  const destinations = useTripContext()?.trip?.destinations;
  const editing = request.kind === 'edit' ? request.item : null;

  const [form, setForm] = useState<StopEditorForm>(() =>
    editing
      ? stopEditorForm(editing)
      : stopEditorForm(null, request.kind === 'create' ? request.tripPlaceId : null),
  );
  const [customDuration, setCustomDuration] = useState(() => stopEditorCustomDuration(form));
  const [timingExpanded, setTimingExpanded] = useState(
    () =>
      Boolean(editing && (editing.localStartTime || editing.dayPart)) ||
      (request.kind === 'edit' && request.focus === 'timing'),
  );
  const [pickerOpen, setPickerOpen] = useState(() =>
    request.kind === 'edit' ? request.focus === 'place' : !form.tripPlaceId,
  );
  const [identityChanged, setIdentityChanged] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [added, setAdded] = useState<ItineraryTripPlace[]>([]);
  const suggestedTime = useSuggestedTime(tripId, (localTime) => {
    setForm((current) => ({ ...current, exactTime: localTime, schedule: 'exact' }));
    setFormError(null);
  });

  const availableTripPlaces = useMemo(() => {
    const byId = new Map(tripPlaces.map((tripPlace) => [tripPlace.id, tripPlace]));
    added.forEach((tripPlace) => byId.set(tripPlace.id, tripPlace));
    return [...byId.values()];
  }, [added, tripPlaces]);

  // Saved Places are the traveller's own list, read from Trove; none of it is a
  // provider request. Adding one needs the server, so offline it is not offered.
  const saved = useQuery({
    enabled: online,
    queryFn: fetchSavedPlaces,
    queryKey: queryKeys.savedPlaces(),
  });
  const savedNearTrip = useMemo(
    () =>
      online
        ? savedPlacesNearTrip({
            destinations: destinations ?? [],
            saved: saved.data?.savedPlaces ?? [],
            tripPlaceIds: new Set(availableTripPlaces.map((tripPlace) => tripPlace.place.id)),
          }).flatMap((group) => group.places)
        : [],
    [availableTripPlaces, destinations, online, saved.data],
  );

  const hasIdentity = Boolean(form.customLabel.trim() || form.tripPlaceId);
  // A stop being inserted is not where the suggestion imagines it - the end of
  // the day - so it is not offered there; nor offline, where there is no day as
  // the server holds it to ask about.
  const suggest =
    online && !(request.kind === 'create' && request.insert)
      ? {
          loading: suggestedTime.loading,
          message: suggestedTime.message,
          onRequest: () =>
            void suggestedTime.request(
              request.kind === 'edit'
                ? { dayId: request.dayId, itemId: request.item.id, schedule: form.schedule }
                : {
                    candidate: {
                      durationMinutes:
                        form.timingMode === 'duration' && form.durationMinutes
                          ? Number(form.durationMinutes)
                          : null,
                      tripPlaceId: form.tripPlaceId || null,
                    },
                    dayId: request.dayId,
                    schedule: form.schedule,
                  },
            ),
        }
      : null;

  function choose(choice: ItineraryIdentityChoice) {
    setForm((current) => ({ ...current, ...itineraryIdentityChoice(current, choice) }));
    if (editing) setIdentityChanged(true);
    setPickerOpen(choice.kind === 'clear');
    setFormError(null);
  }

  function removeTiming() {
    setForm((current) => ({
      ...current,
      durationMinutes: current.timingMode === 'end_time' ? '' : current.durationMinutes,
      exactTime: '',
      localEndTime: '',
      schedule: 'none',
      timingMode: 'duration',
    }));
    setTimingExpanded(false);
    suggestedTime.reset();
    setFormError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const built = buildStopInput(form, customDuration, editing ? { identityChanged } : {});
    if ('error' in built) {
      setFormError(t(built.error));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (request.kind === 'edit') {
        const result = await updateItineraryItem(tripId, request.item.id, built.input);
        await onSaved({ timeZoneConsequence: Boolean(result.timeZoneConsequence) });
      } else {
        await createItineraryItem(
          tripId,
          { ...built.input, itineraryDayId: request.dayId },
          { position: request.insert?.position },
        );
        await onSaved({ timeZoneConsequence: false });
      }
    } catch (error) {
      setFormError(
        error instanceof ItineraryApiError && error.code === 'invalid_local_end_time'
          ? t('endTimeError')
          : t('saveError'),
      );
    } finally {
      setSaving(false);
    }
  }

  const title =
    request.kind === 'edit'
      ? t('editTitle')
      : request.insert
        ? request.insert.afterName
          ? plannerT('insertAfterTitle', { name: request.insert.afterName })
          : plannerT('insertFirstTitle')
        : plannerT('addTitle', { day: request.dayLabel });

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>
          {request.kind === 'edit' ? t('editDescription') : t('createDescription')}
        </SheetDescription>
      </SheetHeader>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <FieldGroup>
            {formError ? (
              <Alert role="alert" variant="destructive">
                <CircleAlert aria-hidden="true" />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <PlaceField
              identity={form}
              locationBias={locationBias}
              onChoose={choose}
              onError={setFormError}
              onKeepCurrent={() => setPickerOpen(false)}
              onOpenPicker={() => setPickerOpen(true)}
              onSelectingChange={setSelecting}
              onTripPlaceAdded={(tripPlace) => {
                const entry = itineraryTripPlaceFrom(tripPlace);
                setAdded((current) =>
                  current.some((candidate) => candidate.id === entry.id)
                    ? current
                    : [...current, entry],
                );
                onTripPlaceAdded(tripPlace);
              }}
              online={online}
              pickerOpen={pickerOpen}
              placeUse={placeUse}
              savedPlaces={savedNearTrip}
              selecting={selecting}
              tripId={tripId}
              tripPlaces={availableTripPlaces}
            />

            {hasIdentity ? (
              <>
                <TimingField
                  customDuration={customDuration}
                  expanded={timingExpanded}
                  form={form}
                  onChange={(patch) => {
                    setForm((current) => ({ ...current, ...patch }));
                    setFormError(null);
                  }}
                  onCustomDurationChange={setCustomDuration}
                  onExpand={() => setTimingExpanded(true)}
                  onRemove={removeTiming}
                  suggest={suggest}
                />
                <Field>
                  <FieldLabel htmlFor="stop-editor-notes">{t('notes')}</FieldLabel>
                  <Textarea
                    id="stop-editor-notes"
                    maxLength={5_000}
                    onChange={(event) => {
                      const notes = event.target.value;
                      setForm((current) => ({ ...current, notes }));
                    }}
                    placeholder={t('notesPlaceholder')}
                    value={form.notes}
                  />
                </Field>
              </>
            ) : null}
          </FieldGroup>
        </div>
        <SheetFooter className="sm:flex-row sm:items-center sm:justify-between">
          {editing && onDelete ? (
            <Button
              className="justify-start text-destructive hover:text-destructive"
              disabled={saving}
              onClick={() => onDelete(editing)}
              type="button"
              variant="ghost"
            >
              <Trash2 aria-hidden="true" data-icon="inline-start" />
              {t('deleteItem')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button disabled={saving} onClick={onClose} type="button" variant="outline">
              {t('cancel')}
            </Button>
            <Button disabled={saving || selecting || !hasIdentity} type="submit">
              {saving ? t('saving') : editing ? t('save') : plannerT('add')}
            </Button>
          </div>
        </SheetFooter>
      </form>
    </>
  );
}

/**
 * The one editor for a stop - adding it, inserting it between two others, or
 * changing it. It replaces the two that had grown apart: the "Add to this day"
 * sheet and the planner's own edit form, which asked the same questions in the
 * same order with a thousand lines each.
 *
 * Each opening starts clean: the body is keyed by the request, so nothing typed
 * into one stop's editor survives into the next.
 */
export function StopEditorSheet({
  id,
  open,
  request,
  ...body
}: Readonly<{
  /** Changes with every opening, so each one starts from its own stop. */
  id: number;
  locationBias: ProviderSearchLocationBias | null;
  onClose: () => void;
  onDelete?: (item: ItineraryItem) => void;
  onSaved: (result: StopEditorSaved) => Promise<void>;
  onTripPlaceAdded: (tripPlace: TripPlace) => void;
  open: boolean;
  placeUse: Record<string, ScheduledPlaceUse>;
  request: StopEditorRequest | null;
  tripId: string;
  tripPlaces: readonly ItineraryTripPlace[];
}>) {
  const t = useTranslations('itinerary');

  return (
    <Sheet onOpenChange={(next) => !next && body.onClose()} open={open}>
      <SheetContent
        className="w-full md:data-[side=right]:w-[min(38rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
      >
        {request ? <StopEditorBody key={id} request={request} {...body} /> : null}
      </SheetContent>
    </Sheet>
  );
}
