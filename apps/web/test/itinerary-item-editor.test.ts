import { expect, test } from 'vitest';

import {
  durationMinutesFromParts,
  durationParts,
  filterItineraryTripPlaces,
  itineraryIdentityChoice,
  itineraryIdentityLegacyPatch,
  itineraryProviderSuggestions,
} from '../lib/itinerary/item-editor.ts';
import type { ProviderSuggestion } from '../lib/saved/api.ts';

test('local Trip Place filtering has no arbitrary result cap', () => {
  const places = Array.from({ length: 12 }, (_, index) => ({
    address: index % 2 ? 'Rotorua' : 'Auckland',
    name: `Place ${index + 1}`,
  }));

  expect(filterItineraryTripPlaces(places, '', (place) => [place.name, place.address]).length).toBe(
    12,
  );
  expect(
    filterItineraryTripPlaces(places, 'rotorua', (place) => [place.name, place.address]).length,
  ).toBe(6);
});

test('provider suggestions exclude existing Trip Places and stop at three', () => {
  const suggestions = Array.from({ length: 6 }, (_, index) => ({
    category: 'other' as const,
    description: null,
    externalPlaceId: `google-${index + 1}`,
    name: `Google Place ${index + 1}`,
    provider: 'google' as const,
  })) satisfies ProviderSuggestion[];

  expect(
    itineraryProviderSuggestions(suggestions, new Set(['google-1'])).map(
      (suggestion) => suggestion.externalPlaceId,
    ),
  ).toStrictEqual(['google-2', 'google-3', 'google-4']);
});

test('a new identity is mutually exclusive while a legacy identity is preserved until changed', () => {
  const legacy = { customLabel: 'Lunch with Maya', tripPlaceId: 'trip-place-1' };

  expect(itineraryIdentityChoice(legacy, { kind: 'preserve' })).toBe(legacy);
  expect(
    itineraryIdentityChoice(legacy, { kind: 'trip_place', tripPlaceId: 'trip-place-2' }),
  ).toStrictEqual({ customLabel: '', tripPlaceId: 'trip-place-2' });
  expect(
    itineraryIdentityChoice(legacy, { kind: 'custom_label', label: '  Sunset walk  ' }),
  ).toStrictEqual({ customLabel: 'Sunset walk', tripPlaceId: '' });
});

test('ordinary edits preserve hidden legacy fields while identity changes clear only overrides', () => {
  expect(itineraryIdentityLegacyPatch(false)).toStrictEqual({});
  expect(itineraryIdentityLegacyPatch(true)).toStrictEqual({
    customLocation: null,
    priority: null,
  });
  expect('plannedCost' in itineraryIdentityLegacyPatch(true)).toBe(false);
});

test('duration conversion supports presets and custom hours and minutes', () => {
  expect(durationParts('90')).toStrictEqual({ hours: '1', minutes: '30' });
  expect(durationParts('')).toStrictEqual({ hours: '', minutes: '' });
  expect(durationMinutesFromParts({ hours: '2', minutes: '15' })).toBe('135');
  expect(durationMinutesFromParts({ hours: '', minutes: '45' })).toBe('45');
  expect(durationMinutesFromParts({ hours: '1', minutes: '60' })).toBe('');
  expect(durationMinutesFromParts({ hours: '0', minutes: '0' })).toBe('');
});
