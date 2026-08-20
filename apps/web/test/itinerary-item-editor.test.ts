import assert from 'node:assert/strict';
import { test } from 'vitest';

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

  assert.equal(
    filterItineraryTripPlaces(places, '', (place) => [place.name, place.address]).length,
    12,
  );
  assert.equal(
    filterItineraryTripPlaces(places, 'rotorua', (place) => [place.name, place.address]).length,
    6,
  );
});

test('provider suggestions exclude existing Trip Places and stop at three', () => {
  const suggestions = Array.from({ length: 6 }, (_, index) => ({
    category: 'other' as const,
    description: null,
    externalPlaceId: `google-${index + 1}`,
    name: `Google Place ${index + 1}`,
    provider: 'google' as const,
  })) satisfies ProviderSuggestion[];

  assert.deepEqual(
    itineraryProviderSuggestions(suggestions, new Set(['google-1'])).map(
      (suggestion) => suggestion.externalPlaceId,
    ),
    ['google-2', 'google-3', 'google-4'],
  );
});

test('a new identity is mutually exclusive while a legacy identity is preserved until changed', () => {
  const legacy = { customLabel: 'Lunch with Maya', tripPlaceId: 'trip-place-1' };

  assert.equal(itineraryIdentityChoice(legacy, { kind: 'preserve' }), legacy);
  assert.deepEqual(
    itineraryIdentityChoice(legacy, { kind: 'trip_place', tripPlaceId: 'trip-place-2' }),
    { customLabel: '', tripPlaceId: 'trip-place-2' },
  );
  assert.deepEqual(
    itineraryIdentityChoice(legacy, { kind: 'custom_label', label: '  Sunset walk  ' }),
    { customLabel: 'Sunset walk', tripPlaceId: '' },
  );
});

test('ordinary edits preserve hidden legacy fields while identity changes clear only overrides', () => {
  assert.deepEqual(itineraryIdentityLegacyPatch(false), {});
  assert.deepEqual(itineraryIdentityLegacyPatch(true), {
    customLocation: null,
    priority: null,
  });
  assert.equal('plannedCost' in itineraryIdentityLegacyPatch(true), false);
});

test('duration conversion supports presets and custom hours and minutes', () => {
  assert.deepEqual(durationParts('90'), { hours: '1', minutes: '30' });
  assert.deepEqual(durationParts(''), { hours: '', minutes: '' });
  assert.equal(durationMinutesFromParts({ hours: '2', minutes: '15' }), '135');
  assert.equal(durationMinutesFromParts({ hours: '', minutes: '45' }), '45');
  assert.equal(durationMinutesFromParts({ hours: '1', minutes: '60' }), '');
  assert.equal(durationMinutesFromParts({ hours: '0', minutes: '0' }), '');
});
