import { expect, test } from 'vitest';

import type { Trip } from '../lib/trips/api.ts';
import { groupTripsForLibrary } from '../lib/trips/lifecycle.ts';

function trip(overrides: Partial<Trip> & Pick<Trip, 'id' | 'lifecycle'>): Trip {
  return {
    coverPhotoPath: null,
    coverPhotoUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    destinations: [],
    endDate: '2026-09-21',
    experienceNote: null,
    experienceRating: null,
    memoryCount: 0,
    name: 'A trip',
    notes: null,
    partySize: 1,
    planningReadiness: 'in_progress',
    referenceTimeZone: 'UTC',
    referenceTimeZoneSource: 'device_fallback',
    startDate: '2026-09-05',
    startingLocation: null,
    startingLocationOverride: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('the featured trip is never repeated in the group below it', () => {
  const trips = [
    trip({ id: 'active', lifecycle: 'active' }),
    trip({ id: 'planning', lifecycle: 'planning', startDate: '2026-11-01' }),
  ];

  const { featured, upcoming } = groupTripsForLibrary(trips);

  expect(featured?.id).toBe('active');
  expect(upcoming.map((entry) => entry.id)).toStrictEqual(['planning']);
});

test('a trip being travelled sorts above one still being planned', () => {
  const trips = [
    trip({ id: 'featured', lifecycle: 'active', endDate: '2026-09-10' }),
    trip({ id: 'planning-soon', lifecycle: 'planning', startDate: '2026-10-01' }),
    trip({ id: 'active-later', lifecycle: 'active', endDate: '2026-09-30' }),
    trip({ id: 'planning-later', lifecycle: 'planning', startDate: '2026-12-01' }),
  ];

  expect(groupTripsForLibrary(trips).upcoming.map((entry) => entry.id)).toStrictEqual([
    'active-later',
    'planning-soon',
    'planning-later',
  ]);
});

test('the archive runs most recent first', () => {
  const trips = [
    trip({ id: 'older', lifecycle: 'completed', endDate: '2025-04-02' }),
    trip({ id: 'newer', lifecycle: 'completed', endDate: '2026-01-15' }),
    trip({ id: 'oldest', lifecycle: 'completed', endDate: '2024-08-30' }),
  ];

  expect(groupTripsForLibrary(trips).past.map((entry) => entry.id)).toStrictEqual([
    'newer',
    'older',
    'oldest',
  ]);
});

test('a library of only finished trips features none of them', () => {
  const trips = [
    // Recent enough to lead Home, which must not make it lead the library too.
    trip({ id: 'just-back', lifecycle: 'completed', endDate: '2026-09-21' }),
    trip({ id: 'older', lifecycle: 'completed', endDate: '2025-04-02' }),
  ];

  const { featured, past, upcoming } = groupTripsForLibrary(
    trips,
    new Date('2026-09-25T12:00:00.000Z'),
  );

  expect(featured).toBeNull();
  expect(upcoming).toStrictEqual([]);
  expect(past.map((entry) => entry.id)).toStrictEqual(['just-back', 'older']);
});

test('a single trip is featured and leaves both groups empty', () => {
  const { featured, past, upcoming } = groupTripsForLibrary([
    trip({ id: 'only', lifecycle: 'planning' }),
  ]);

  expect(featured?.id).toBe('only');
  expect(upcoming).toStrictEqual([]);
  expect(past).toStrictEqual([]);
});

test('an empty library groups into nothing rather than failing', () => {
  expect(groupTripsForLibrary([])).toStrictEqual({ featured: null, past: [], upcoming: [] });
});
