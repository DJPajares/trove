import { expect, test } from 'vitest';

import {
  durationMinutesFromParts,
  durationParts,
  filterItineraryTripPlaces,
  itineraryIdentityChoice,
  itineraryIdentityLegacyPatch,
  itineraryProviderSuggestions,
} from '../lib/itinerary/item-editor.ts';
import { formatItineraryTimeRange, itineraryLocalEndTime } from '../lib/itinerary/item-timing.ts';
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

test('formats an explicit itinerary end ahead of its derived duration', () => {
  const item = { durationMinutes: 90, localEndTime: '10:20', localStartTime: '09:00' };

  expect(itineraryLocalEndTime(item)).toBe('10:20');
  expect(formatItineraryTimeRange(item, 'en-US', '12h')).toBe('9:00 AM - 10:20 AM');
});

test('derives and formats the end of a duration while preserving start-only items', () => {
  expect(
    formatItineraryTimeRange(
      { durationMinutes: 90, localEndTime: null, localStartTime: '09:00' },
      'en-GB',
      '24h',
    ),
  ).toBe('9:00 - 10:30');
  expect(
    itineraryLocalEndTime({ durationMinutes: 90, localEndTime: null, localStartTime: '23:30' }),
  ).toBe('01:00');
  expect(
    formatItineraryTimeRange(
      { durationMinutes: null, localEndTime: null, localStartTime: '09:00' },
      'en-GB',
      '24h',
    ),
  ).toBe('9:00');
});
