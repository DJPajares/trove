import { expect, test } from 'vitest';

import { MAX_EDITORIAL_IMAGE_SUBJECTS } from '../lib/media/editorial-images.ts';
import type { Trip, TripDestination } from '../lib/trips/api.ts';
import { groupTripsForLibrary } from '../lib/trips/lifecycle.ts';
import {
  libraryEditorialSubjects,
  tripDestinationSummary,
  tripEditorialSubject,
} from '../lib/trips/summary.ts';

function destination(name: string, position = 0): TripDestination {
  return { id: `d-${position}`, name, placeId: `p-${position}`, position, timeZone: null };
}

function trip(overrides: Partial<Trip> & Pick<Trip, 'id'>): Trip {
  return {
    coverPhotoPath: null,
    coverPhotoUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    description: null,
    destinations: [],
    endDate: '2026-09-21',
    experienceNote: null,
    experienceRating: null,
    lifecycle: 'planning',
    memoryCount: 0,
    name: 'A trip',
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
  // The destination's Place travels with the name: it is what keys the subject
  // to that one city, and what lets the resolver reach the address and types it
  // has already cached rather than searching on a bare string.
  expect(
    tripEditorialSubject(trip({ destinations: [destination('Tokyo')], id: 'a' })),
  ).toStrictEqual({ category: 'destination', name: 'Tokyo', placeId: 'p-0', tripId: 'a' });

  // A trip with no destination has no Place to be pictured by, only its name.
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

test('an empty library asks for nothing at all', () => {
  // An empty subject list makes the hook return before it reaches the network.
  expect(libraryEditorialSubjects(groupTripsForLibrary([]))).toStrictEqual([]);
});

test('the library asks for the trip it leads with first and the archive last', () => {
  const trips = [
    trip({
      destinations: [destination('Lisbon')],
      endDate: '2025-04-02',
      id: 'past',
      lifecycle: 'completed',
    }),
    trip({ destinations: [destination('Kyoto')], id: 'featured', lifecycle: 'active' }),
    trip({
      destinations: [destination('Oslo')],
      id: 'upcoming',
      lifecycle: 'planning',
      startDate: '2026-11-01',
    }),
  ];

  expect(
    libraryEditorialSubjects(groupTripsForLibrary(trips)).map((subject) => subject.name),
  ).toStrictEqual(['Kyoto', 'Oslo', 'Lisbon']);
});

test('a trip with its own cover contributes nothing to the batch', () => {
  const trips = [
    trip({
      coverPhotoUrl: 'https://storage.example/cover.jpg',
      destinations: [destination('Kyoto')],
      id: 'covered',
      lifecycle: 'active',
    }),
    trip({ destinations: [destination('Oslo')], id: 'bare', lifecycle: 'planning' }),
  ];

  expect(
    libraryEditorialSubjects(groupTripsForLibrary(trips)).map((subject) => subject.name),
  ).toStrictEqual(['Oslo']);
});

test('a long library still resolves as a single request', () => {
  // The service chunks anything above its ceiling into parallel requests, so a
  // caller that does not cap its subjects quietly costs two.
  const trips = [
    trip({ destinations: [destination('Kyoto')], id: 'featured', lifecycle: 'active' }),
    ...Array.from({ length: 40 }, (_, index) =>
      trip({
        destinations: [destination(`City ${index}`, index)],
        endDate: `2025-04-${String((index % 28) + 1).padStart(2, '0')}`,
        id: `past-${index}`,
        lifecycle: 'completed',
      }),
    ),
  ];

  const subjects = libraryEditorialSubjects(groupTripsForLibrary(trips));

  expect(subjects).toHaveLength(MAX_EDITORIAL_IMAGE_SUBJECTS);
  // The trip on screen keeps its photograph however deep the archive runs.
  expect(subjects.at(0)?.name).toBe('Kyoto');
});
