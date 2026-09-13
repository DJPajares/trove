import { expect, test } from 'vitest';

import {
  resolveItineraryItemPlaceName,
  resolvePlacePhotoName,
  resolveTripPlaceName,
} from '../lib/trip-places/place-name.ts';

import type { PlaceSnapshot } from '../lib/saved/api.ts';

function snapshot(name: string | null): PlaceSnapshot {
  return {
    address: '1 Somewhere St',
    category: 'other',
    fetchedAt: '2026-09-01T00:00:00.000Z',
    googleMapsUri: null,
    languageCode: 'en',
    name,
    primaryType: null,
    rawTypes: [],
    stale: false,
    utcOffsetMinutes: null,
  };
}

type ProviderPlace = {
  id: string;
  kind: 'custom' | 'provider';
  name: string | null;
  providerAddress: string | null;
  providerLabel: string | null;
  snapshot: PlaceSnapshot | null;
};

function providerPlace(overrides: Partial<ProviderPlace> = {}) {
  return {
    customName: null,
    place: {
      id: 'p1',
      kind: 'provider' as const,
      name: null,
      providerAddress: '1 Somewhere St',
      providerLabel: 'Google Label',
      snapshot: snapshot('Google Name'),
      ...overrides,
    } satisfies ProviderPlace,
  };
}

test('the traveller’s name for a stop beats the one Google gave it', () => {
  // The regression: this name lives on the Trip Place, not the Place, and Trip
  // Mode's own copy of the chain skipped it - so a renamed stop showed Google's
  // name back to the person who had just renamed it.
  const named = { ...providerPlace(), customName: 'The good coffee place' };

  expect(resolveTripPlaceName(named, { custom: 'x', provider: 'x' })).toBe('The good coffee place');
});

test('a provider place falls through snapshot, then label', () => {
  expect(resolveTripPlaceName(providerPlace(), { custom: 'x', provider: 'x' })).toBe('Google Name');
  expect(
    resolveTripPlaceName(providerPlace({ snapshot: null }), { custom: 'x', provider: 'x' }),
  ).toBe('Google Label');
  expect(
    resolveTripPlaceName(providerPlace({ providerLabel: null, snapshot: null }), {
      custom: 'x',
      provider: 'fallback',
    }),
  ).toBe('fallback');
});

test('an item’s own label leads, then the place beneath it', () => {
  const item = { customLabel: 'Breakfast before the drive', tripPlace: providerPlace() };
  expect(resolveItineraryItemPlaceName(item, 'x')).toBe('Breakfast before the drive');

  expect(
    resolveItineraryItemPlaceName({ customLabel: null, tripPlace: providerPlace() }, 'x'),
  ).toBe('Google Name');
  expect(resolveItineraryItemPlaceName({ customLabel: null, tripPlace: null }, 'nothing')).toBe(
    'nothing',
  );
});

test('a photograph is asked for under the place’s name, never the nickname', () => {
  // "Mum's favourite bakery" is a photograph of nothing, and a stock library
  // will match it to something absurd.
  const nicknamed = { ...providerPlace(), customName: "Mum's favourite bakery" };
  expect(resolvePlacePhotoName(nicknamed)).toBe('Google Name');

  // A custom place does ask, under the name it was created with - an AI-planned
  // trip fills those with real place names.
  const custom = {
    customName: 'my spot',
    place: {
      id: 'p2',
      kind: 'custom' as const,
      name: 'Hanoi Old Quarter, Hoàn Kiếm',
      providerAddress: null,
      providerLabel: null,
      snapshot: null,
    },
  };
  expect(resolvePlacePhotoName(custom)).toBe('Hanoi Old Quarter, Hoàn Kiếm');

  // A custom place with no name of its own asks for nothing.
  expect(resolvePlacePhotoName({ ...custom, place: { ...custom.place, name: null } })).toBeNull();
});
