import { expect, test } from 'vitest';

import {
  collectionCoverTiles,
  coverRequestOrder,
  nextTripForSaved,
  rediscoverSaved,
  tripsForSavedPlace,
} from '@/lib/saved/collection-view';

const kyoto = { latitude: 35.0116, longitude: 135.7681 };
const lisbon = { latitude: 38.7223, longitude: -9.1393 };

function trip(
  id: string,
  startDate: string,
  endDate: string,
  location: typeof kyoto | null,
  lifecycle: 'active' | 'completed' | 'planning' = 'planning',
) {
  return { destinations: [{ location, name: id }], endDate, id, lifecycle, startDate };
}

const trips = [
  trip('lisbon', '2026-12-05', '2026-12-08', lisbon),
  trip('kyoto', '2026-10-30', '2026-11-03', kyoto),
  trip('unplaced', '2026-10-20', '2026-10-22', null),
  trip('done', '2026-09-01', '2026-09-05', kyoto, 'completed'),
];

test('the next trip for saved places is the soonest ahead that Trove can place', () => {
  expect(nextTripForSaved(trips, '2026-10-11')?.id).toBe('kyoto');
  expect(nextTripForSaved(trips, '2026-11-04')?.id).toBe('lisbon');
});

test('a saved place lists the trip it sits near first, then the rest by date', () => {
  const nearKyoto = { latitude: 35.02, longitude: 135.77 };
  expect(
    tripsForSavedPlace(nearKyoto, trips, '2026-10-11').map(({ near, trip }) => [trip.id, near]),
  ).toEqual([
    ['kyoto', true],
    ['unplaced', false],
    ['lisbon', false],
  ]);
  expect(tripsForSavedPlace(null, trips, '2026-10-11').map(({ trip }) => trip.id)).toEqual([
    'unplaced',
    'kyoto',
    'lisbon',
  ]);
});

test('rediscover brings back the oldest place saved over a year ago, unless kept', () => {
  const now = Date.parse('2026-10-11T00:00:00Z');
  const saved = [
    { createdAt: '2026-03-01T00:00:00Z', id: 'recent' },
    { createdAt: '2025-09-01T00:00:00Z', id: 'old' },
    { createdAt: '2024-05-01T00:00:00Z', id: 'oldest' },
  ];
  expect(rediscoverSaved(saved, now, new Set())?.id).toBe('oldest');
  expect(rediscoverSaved(saved, now, new Set(['oldest']))?.id).toBe('old');
  expect(rediscoverSaved(saved, now, new Set(['oldest', 'old']))).toBeNull();
});

function member(id: string, createdAt: string, kind: 'custom' | 'provider', collections: string[]) {
  return {
    collections: collections.map((collection) => ({ id: collection })),
    createdAt,
    id,
    place: { kind },
  };
}

test('a cover is drawn from the newest places that can carry a photograph', () => {
  const saved = [
    member('old-photo', '2026-01-01T00:00:00Z', 'provider', ['nz']),
    member('custom', '2026-09-01T00:00:00Z', 'custom', ['nz']),
    member('new-photo', '2026-08-01T00:00:00Z', 'provider', ['nz']),
    member('mid-photo', '2026-05-01T00:00:00Z', 'provider', ['nz']),
    member('fourth', '2026-03-01T00:00:00Z', 'provider', ['nz']),
    member('elsewhere', '2026-10-01T00:00:00Z', 'provider', ['japan']),
  ];
  expect(collectionCoverTiles('nz', saved).map((tile) => tile.id)).toEqual([
    'new-photo',
    'mid-photo',
    'fourth',
  ]);
});

test('a cover never pads its photos with personal places, and falls back to one of them alone', () => {
  const saved = [
    member('photo', '2026-01-01T00:00:00Z', 'provider', ['mixed']),
    member('custom', '2026-09-01T00:00:00Z', 'custom', ['mixed', 'personal']),
    member('older-custom', '2026-02-01T00:00:00Z', 'custom', ['personal']),
  ];
  expect(collectionCoverTiles('mixed', saved).map((tile) => tile.id)).toEqual(['photo']);
  expect(collectionCoverTiles('personal', saved).map((tile) => tile.id)).toEqual(['custom']);
  expect(collectionCoverTiles('empty', saved)).toEqual([]);
});

test('cover photos are asked for lead first, so a cap never leaves a cover bare', () => {
  expect(coverRequestOrder([['a1', 'a2', 'a3'], ['b1'], ['c1', 'shared'], ['shared']])).toEqual([
    'a1',
    'b1',
    'c1',
    'shared',
    'a2',
    'a3',
  ]);
});
