import type { ProviderSuggestion } from '@/lib/saved/api';

export const ITINERARY_DURATION_PRESETS = [30, 60, 90, 120] as const;
export const ITINERARY_PROVIDER_RESULT_LIMIT = 3;

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
    .slice(0, ITINERARY_PROVIDER_RESULT_LIMIT);
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
