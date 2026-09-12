import { expect, test } from 'vitest';

import type { Trip, TripDestination } from '../lib/trips/api.ts';
import { tripDayCount, tripFacts, tripSpanMeters } from '../lib/trips/facts.ts';

function destination(
  name: string,
  position: number,
  location: TripDestination['location'] = null,
): TripDestination {
  return { id: name, location, name, placeId: `place-${name}`, position, timeZone: null };
}

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    coverPhotoPath: null,
    coverPhotoUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    description: null,
    destinations: [],
    endDate: '2026-09-12',
    experienceNote: null,
    experienceRating: null,
    id: 'trip',
    lifecycle: 'planning',
    memoryCount: 0,
    name: 'A trip',
    partySize: 2,
    planningReadiness: 'in_progress',
    referenceTimeZone: 'UTC',
    referenceTimeZoneSource: 'device_fallback',
    startDate: '2026-09-01',
    startingLocation: null,
    startingLocationOverride: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const PARIS = { latitude: 48.8566, longitude: 2.3522 };
const LYON = { latitude: 45.764, longitude: 4.8357 };
const MARSEILLE = { latitude: 43.2965, longitude: 5.3698 };

test('a trip counts both of the days it ends on', () => {
  expect(tripDayCount(trip({ endDate: '2026-09-12', startDate: '2026-09-01' }))).toBe(12);
});

test('a single-day trip is one day rather than none', () => {
  expect(tripDayCount(trip({ endDate: '2026-09-01', startDate: '2026-09-01' }))).toBe(1);
});

/**
 * The reference value is the great-circle Paris-Lyon distance, about 392km.
 * Asserting a band rather than a figure: the point is that real coordinates
 * produce a real distance, not that the earth's radius is a particular constant.
 */
test('a span is the straight line between two located destinations', () => {
  const span = tripSpanMeters(
    trip({ destinations: [destination('Paris', 0, PARIS), destination('Lyon', 1, LYON)] }),
  );

  expect(span).toBeGreaterThan(385_000);
  expect(span).toBeLessThan(400_000);
});

test('a span adds each leg rather than measuring end to end', () => {
  const legs = tripSpanMeters(
    trip({
      destinations: [
        destination('Paris', 0, PARIS),
        destination('Lyon', 1, LYON),
        destination('Marseille', 2, MARSEILLE),
      ],
    }),
  );
  const endToEnd = tripSpanMeters(
    trip({
      destinations: [destination('Paris', 0, PARIS), destination('Marseille', 1, MARSEILLE)],
    }),
  );

  expect(legs).toBeGreaterThan(endToEnd!);
});

/**
 * Trip order is the server's `position`, not the order the array happened to
 * arrive in - a span measured down a resorted list is a different number for
 * the same trip.
 */
test('a span follows position rather than array order', () => {
  const inOrder = tripSpanMeters(
    trip({
      destinations: [
        destination('Paris', 0, PARIS),
        destination('Lyon', 1, LYON),
        destination('Marseille', 2, MARSEILLE),
      ],
    }),
  );
  const shuffled = tripSpanMeters(
    trip({
      destinations: [
        destination('Marseille', 2, MARSEILLE),
        destination('Paris', 0, PARIS),
        destination('Lyon', 1, LYON),
      ],
    }),
  );

  expect(shuffled).toBe(inOrder);
});

test('one stop has no span', () => {
  expect(tripSpanMeters(trip({ destinations: [destination('Paris', 0, PARIS)] }))).toBeNull();
});

test('a trip with no destinations has no span', () => {
  expect(tripSpanMeters(trip())).toBeNull();
});

/**
 * A Place Trove has not resolved coordinates for is dropped from the
 * measurement rather than treated as the origin, which would put the span
 * through the Gulf of Guinea.
 */
test('destinations without coordinates are skipped, not counted as zero', () => {
  const span = tripSpanMeters(
    trip({
      destinations: [
        destination('Paris', 0, PARIS),
        destination('Somewhere', 1),
        destination('Lyon', 2, LYON),
      ],
    }),
  );

  expect(span).toBeGreaterThan(385_000);
  expect(span).toBeLessThan(400_000);
});

test('a span needs two located destinations, not two destinations', () => {
  expect(
    tripSpanMeters(
      trip({ destinations: [destination('Paris', 0, PARIS), destination('Somewhere', 1)] }),
    ),
  ).toBeNull();
});

test('facts drop the span a trip cannot measure', () => {
  expect(tripFacts(trip({ destinations: [destination('Paris', 0, PARIS)] }))).toStrictEqual([
    { kind: 'days', count: 12 },
    { kind: 'travellers', count: 2 },
  ]);
});

test('facts keep a fixed order once every fact is present', () => {
  const facts = tripFacts(
    trip({ destinations: [destination('Paris', 0, PARIS), destination('Lyon', 1, LYON)] }),
  );

  expect(facts.map((fact) => fact.kind)).toStrictEqual(['days', 'span', 'travellers']);
});
