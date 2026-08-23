import { expect, test } from 'vitest';

import { MAX_EDITORIAL_IMAGE_SUBJECTS } from '../lib/media/editorial-images.ts';
import type { Trip, TripDestination } from '../lib/trips/api.ts';
import { tripDestinationSummary, tripEditorialSubject } from '../lib/trips/summary.ts';

function destination(name: string, position = 0): TripDestination {
  return { id: `d-${position}`, name, placeId: `p-${position}`, position, timeZone: null };
}

function trip(overrides: Partial<Trip> & Pick<Trip, 'id'>): Trip {
  return {
    coverPhotoPath: null,
    coverPhotoUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    destinations: [],
    endDate: '2026-09-21',
    experienceNote: null,
    experienceRating: null,
    lifecycle: 'planning',
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

test('destinations read as one line, and their absence reads as nothing', () => {
  expect(
    tripDestinationSummary(
      trip({ destinations: [destination('Tokyo'), destination('Kyoto', 1)], id: 'a' }),
    ),
  ).toBe('Tokyo, Kyoto');
  expect(tripDestinationSummary(trip({ id: 'a' }))).toBeNull();
});

test('a trip the traveller gave a cover to asks for no photograph', () => {
  // This is what keeps a screen's editorial batch small: the drop happens once,
  // here, rather than at every call site that renders a list.
  const withCover = trip({
    coverPhotoUrl: 'https://storage.example/cover.jpg',
    destinations: [destination('Tokyo')],
    id: 'a',
  });

  expect(tripEditorialSubject(withCover)).toBeNull();
});

test('a trip is pictured by its first destination, or failing that its own name', () => {
  expect(
    tripEditorialSubject(trip({ destinations: [destination('Tokyo')], id: 'a' })),
  ).toStrictEqual({ category: 'destination', name: 'Tokyo', tripId: 'a' });

  expect(tripEditorialSubject(trip({ id: 'b', name: 'Honeymoon' }))).toStrictEqual({
    category: 'destination',
    name: 'Honeymoon',
    tripId: 'b',
  });

  // A destination that is only whitespace is not a subject.
  expect(
    tripEditorialSubject(trip({ destinations: [destination('   ')], id: 'c', name: 'Honeymoon' })),
  ).toStrictEqual({ category: 'destination', name: 'Honeymoon', tripId: 'c' });
});

test('a nameless trip asks for nothing rather than for an empty query', () => {
  expect(tripEditorialSubject(trip({ id: 'a', name: '  ' }))).toBeNull();
});

test('a long library still resolves as a single request', () => {
  // The service chunks anything above its ceiling into parallel requests, so a
  // caller that does not cap its subjects quietly costs two.
  const many = Array.from({ length: 40 }, (_, index) =>
    trip({ destinations: [destination(`City ${index}`, index)], id: `trip-${index}` }),
  );

  const subjects = many
    .map(tripEditorialSubject)
    .filter((subject) => subject !== null)
    .slice(0, MAX_EDITORIAL_IMAGE_SUBJECTS);

  expect(subjects).toHaveLength(MAX_EDITORIAL_IMAGE_SUBJECTS);
  expect(subjects.at(0)?.name).toBe('City 0');
});
