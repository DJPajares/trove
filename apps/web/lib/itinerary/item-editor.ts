import type { ItineraryDayTimeSuggestion, TimingFlexibility, TimingProvenance } from '@trove/types';
import type { ProviderSuggestion } from '@/lib/saved/api';
import { PROVIDER_SEARCH_RESULT_LIMIT } from '../saved/search-results';

import type { ItineraryItem, ItineraryItemInput } from './api';

export const ITINERARY_DURATION_PRESETS = [30, 60, 90, 120] as const;

export type DurationParts = {
  hours: string;
  minutes: string;
};

export type ItineraryIdentity = {
  customLabel: string;
  tripPlaceId: string;
};

export type ItineraryIdentityChoice =
  | { kind: 'clear' }
  | { kind: 'custom_label'; label: string }
  | { kind: 'preserve' }
  | { kind: 'trip_place'; tripPlaceId: string };

export function itineraryIdentityChoice(
  current: ItineraryIdentity,
  choice: ItineraryIdentityChoice,
): ItineraryIdentity {
  if (choice.kind === 'preserve') return current;
  if (choice.kind === 'trip_place') return { customLabel: '', tripPlaceId: choice.tripPlaceId };
  if (choice.kind === 'custom_label') return { customLabel: choice.label.trim(), tripPlaceId: '' };
  return { customLabel: '', tripPlaceId: '' };
}

export function itineraryIdentityLegacyPatch(identityChanged: boolean) {
  return identityChanged ? { customLocation: null, priority: null } : {};
}

export function normalizeItineraryPlaceQuery(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function filterItineraryTripPlaces<T>(
  places: readonly T[],
  query: string,
  searchableText: (place: T) => readonly (string | null | undefined)[],
) {
  const normalized = normalizeItineraryPlaceQuery(query);
  if (!normalized) return [...places];

  return places.filter((place) =>
    searchableText(place).some((value) => value?.toLocaleLowerCase().includes(normalized)),
  );
}

export function itineraryProviderSuggestions(
  suggestions: readonly ProviderSuggestion[],
  existingExternalPlaceIds: ReadonlySet<string>,
) {
  return suggestions
    .filter((suggestion) => !existingExternalPlaceIds.has(suggestion.externalPlaceId))
    .slice(0, PROVIDER_SEARCH_RESULT_LIMIT);
}

export function durationParts(value: string): DurationParts {
  const total = Number(value);
  if (!Number.isInteger(total) || total <= 0) return { hours: '', minutes: '' };

  return {
    hours: Math.floor(total / 60).toString(),
    minutes: (total % 60).toString(),
  };
}

export function durationMinutesFromParts(parts: DurationParts) {
  const hours = parts.hours.trim() ? Number(parts.hours) : 0;
  const minutes = parts.minutes.trim() ? Number(parts.minutes) : 0;
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return '';
  }

  const total = hours * 60 + minutes;
  return total > 0 ? total.toString() : '';
}

export function isDurationPreset(value: string) {
  const total = Number(value);
  return ITINERARY_DURATION_PRESETS.some((preset) => preset === total);
}

export type StopEditorSchedule = 'afternoon' | 'anytime' | 'evening' | 'exact' | 'morning' | 'none';

/** The stop editor's fields, as text, the way the form holds them. */
export type StopEditorForm = ItineraryIdentity & {
  durationMinutes: string;
  exactTime: string;
  localEndTime: string;
  notes: string;
  schedule: StopEditorSchedule;
  timingMode: 'duration' | 'end_time';
  timingFlexibility?: TimingFlexibility;
  timeProvenance?: TimingProvenance;
  durationProvenance?: TimingProvenance;
  dayPartIntent?: ItineraryItem['dayPart'];
  scheduleRevision?: string;
};

/** The custom length's own boxes, which can hold text the length does not yet read as. */
export type StopEditorCustomDuration = DurationParts & { open: boolean };

/**
 * The editor opened on a stop, or on nothing for a new one - which may already
 * be at a Trip Place, when it was asked for by name (a Must Go to schedule).
 */
export function stopEditorForm(
  item:
    | (Pick<
        ItineraryItem,
        'customLabel' | 'dayPart' | 'durationMinutes' | 'localEndTime' | 'localStartTime' | 'notes'
      > & {
        tripPlace: { id: string } | null;
        timingFlexibility?: TimingFlexibility;
        timeProvenance?: TimingProvenance | null;
        durationProvenance?: TimingProvenance;
      })
    | null,
  tripPlaceId?: string | null,
): StopEditorForm {
  return {
    ...(item?.timingFlexibility
      ? {
          timingFlexibility: item.timingFlexibility,
          timeProvenance: item.timeProvenance ?? 'user_owned',
          durationProvenance: item.durationProvenance,
          dayPartIntent: item.dayPart,
        }
      : {}),
    customLabel: item?.customLabel ?? '',
    durationMinutes: item?.localEndTime ? '' : (item?.durationMinutes?.toString() ?? ''),
    exactTime: item?.localStartTime ?? '',
    localEndTime: item?.localEndTime ?? '',
    notes: item?.notes ?? '',
    schedule: item?.localStartTime ? 'exact' : (item?.dayPart ?? 'none'),
    timingMode: item?.localEndTime ? 'end_time' : 'duration',
    tripPlaceId: item?.tripPlace?.id ?? tripPlaceId ?? '',
  };
}

/** The custom length boxes as the editor opens: open only for a length no preset covers. */
export function stopEditorCustomDuration(form: StopEditorForm): StopEditorCustomDuration {
  const parts = durationParts(form.timingMode === 'end_time' ? '' : form.durationMinutes);
  return {
    ...parts,
    open: Boolean(
      form.timingMode === 'duration' &&
      form.durationMinutes &&
      !isDurationPreset(form.durationMinutes),
    ),
  };
}

/** The message key a stop that cannot be saved yet is explained by. */
export type StopEditorError =
  | 'durationError'
  | 'endTimeError'
  | 'endTimeStartRequired'
  | 'exactTimeError'
  | 'minimumContentError';

/**
 * What the form saves, or why it cannot be saved yet.
 *
 * A stop is a Place, a plan, or both; an exact time needs its time; a length
 * is a whole number of minutes; and an end needs an exact start before it. An
 * edit passes whether its Place or plan changed, so the fields an older
 * version of the editor wrote - and this one no longer shows - survive an
 * ordinary edit but never ride along onto a different stop.
 */
export function buildStopInput(
  form: StopEditorForm,
  customDuration: StopEditorCustomDuration,
  options: { identityChanged?: boolean } = {},
): { error: StopEditorError } | { input: ItineraryItemInput } {
  const customLabel = form.customLabel.trim();
  if (!customLabel && !form.tripPlaceId) return { error: 'minimumContentError' };
  if (form.schedule === 'exact' && !form.exactTime) return { error: 'exactTimeError' };

  const duration =
    form.timingMode === 'duration' && form.durationMinutes ? Number(form.durationMinutes) : null;
  if (duration !== null && (!Number.isInteger(duration) || duration <= 0)) {
    return { error: 'durationError' };
  }
  const customHasInput = Boolean(customDuration.hours.trim() || customDuration.minutes.trim());
  if (
    form.timingMode === 'duration' &&
    customDuration.open &&
    customHasInput &&
    duration === null
  ) {
    return { error: 'durationError' };
  }
  if (form.timingMode === 'end_time' && form.localEndTime) {
    if (form.schedule !== 'exact' || !form.exactTime) return { error: 'endTimeStartRequired' };
    if (form.localEndTime <= form.exactTime) return { error: 'endTimeError' };
  }

  const input: ItineraryItemInput = {
    customLabel: customLabel || null,
    durationMinutes: duration,
    localEndTime: form.timingMode === 'end_time' ? form.localEndTime || null : null,
    notes: form.notes.trim() || null,
    schedule:
      form.schedule === 'exact'
        ? {
            kind: 'exact',
            localTime: form.exactTime,
            ...(form.timingFlexibility === 'flexible' && form.dayPartIntent
              ? { dayPart: form.dayPartIntent }
              : {}),
          }
        : form.schedule === 'none'
          ? { kind: 'none' }
          : { dayPart: form.schedule, kind: 'day_part' },
    tripPlaceId: form.tripPlaceId || null,
  };
  if (form.timingFlexibility) input.timingFlexibility = form.timingFlexibility;
  if (form.timeProvenance) input.timeProvenance = form.timeProvenance;
  if (form.durationProvenance) input.durationProvenance = form.durationProvenance;
  if (form.scheduleRevision) input.scheduleRevision = form.scheduleRevision;
  if (options.identityChanged !== undefined) {
    Object.assign(input, itineraryIdentityLegacyPatch(options.identityChanged));
  }
  return { input };
}

/** Only what a stop's timing is: what the timing sheet saves, leaving the rest alone. */
export function stopTimingInput(input: ItineraryItemInput): ItineraryItemInput {
  return {
    durationMinutes: input.durationMinutes ?? null,
    localEndTime: input.localEndTime ?? null,
    schedule: input.schedule ?? { kind: 'none' },
    ...(input.timingFlexibility ? { timingFlexibility: input.timingFlexibility } : {}),
    ...(input.timeProvenance ? { timeProvenance: input.timeProvenance } : {}),
    ...(input.durationProvenance ? { durationProvenance: input.durationProvenance } : {}),
    ...(input.scheduleRevision ? { scheduleRevision: input.scheduleRevision } : {}),
  };
}

export function acceptSuggestedSlot(
  form: StopEditorForm,
  slot: ItineraryDayTimeSuggestion,
  scheduleRevision?: string,
): StopEditorForm {
  if (!slot.durationMinutes) return form;
  if (slot.status !== 'ok' || !slot.localTime)
    return {
      ...form,
      durationMinutes: String(slot.durationMinutes),
      durationProvenance: slot.durationProvenance,
      scheduleRevision: undefined,
    };

  return {
    ...form,
    dayPartIntent:
      form.schedule !== 'exact' && form.schedule !== 'none' ? form.schedule : form.dayPartIntent,
    exactTime: slot.localTime,
    durationMinutes: String(slot.durationMinutes),
    localEndTime: '',
    timingMode: 'duration',
    schedule: 'exact',
    timingFlexibility: 'flexible',
    timeProvenance: 'app_estimated',
    durationProvenance: slot.durationProvenance,
    scheduleRevision,
  };
}

export function manualTimingPatch(
  form: StopEditorForm,
  patch: Partial<StopEditorForm>,
): StopEditorForm {
  const startChanged =
    (patch.exactTime !== undefined && patch.exactTime !== form.exactTime) ||
    (patch.schedule !== undefined && patch.schedule !== form.schedule);
  const durationChanged =
    (patch.durationMinutes !== undefined && patch.durationMinutes !== form.durationMinutes) ||
    (patch.localEndTime !== undefined && patch.localEndTime !== form.localEndTime);
  return {
    ...form,
    ...patch,
    scheduleRevision: undefined,
    ...(startChanged ? { timeProvenance: 'user_owned', timingFlexibility: 'fixed' } : {}),
    ...(durationChanged ? { durationProvenance: 'user_owned' } : {}),
  };
}
