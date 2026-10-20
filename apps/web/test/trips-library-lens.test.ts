import { expect, test } from 'vitest';

import type { Trip } from '../lib/trips/api.ts';
import {
  lensCounts,
  parseTripLens,
  showLensFilter,
  tripsForLens,
} from '../lib/trips/library-lens.ts';

function trip(overrides: Partial<Trip> & Pick<Trip, 'id' | 'lifecycle'>): Trip {
  return {
    coverPhotoPath: null,
    coverPhotoUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    description: null,
    destinations: [],
    endDate: '2026-09-21',
    experienceNote: null,
    experienceRating: null,
    itineraryCoverage: { percentage: 29, plannedDays: 2, totalDays: 7 },
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
    weatherLocation: null,
    ...overrides,
  };
}

const library = [
  trip({ id: 'lisbon', lifecycle: 'planning', startDate: '2026-12-04', endDate: '2026-12-07' }),
  trip({ id: 'hanoi', lifecycle: 'active', startDate: '2026-10-18', endDate: '2026-10-22' }),
  trip({
    id: 'kyoto',
    lifecycle: 'planning',
    planningReadiness: 'ready',
    startDate: '2026-10-30',
    endDate: '2026-11-03',
  }),
  trip({ id: 'danang', lifecycle: 'planning', startDate: '2026-11-04', endDate: '2026-11-10' }),
  trip({ id: 'rome', lifecycle: 'completed', startDate: '2026-03-01', endDate: '2026-03-06' }),
  trip({ id: 'oslo', lifecycle: 'completed', startDate: '2026-06-01', endDate: '2026-06-04' }),
];
const ids = (trips: Trip[]) => trips.map((entry) => entry.id);

test('upcoming is the trip under way, then every departure soonest first', () => {
  expect(ids(tripsForLens(library, 'upcoming'))).toEqual(['hanoi', 'kyoto', 'danang', 'lisbon']);
});

test('needs planning is only trips ahead not yet marked Ready, soonest first', () => {
  expect(ids(tripsForLens(library, 'planning'))).toEqual(['danang', 'lisbon']);
});

test('past is finished trips, most recent first', () => {
  expect(ids(tripsForLens(library, 'past'))).toEqual(['oslo', 'rome']);
});

test('counts follow the lenses, overlap included', () => {
  expect(lensCounts(library)).toEqual({ all: 6, past: 2, planning: 2, upcoming: 4 });
});

test('a small library, or one with only one way to narrow it, offers no lenses', () => {
  expect(showLensFilter(library)).toBe(true);
  expect(showLensFilter(library.slice(0, 5))).toBe(false);
  const allPast = Array.from({ length: 6 }, (_, index) =>
    trip({ id: `p${index}`, lifecycle: 'completed' }),
  );
  expect(showLensFilter(allPast)).toBe(false);
});

test('an unknown lens reads as the whole library', () => {
  expect(parseTripLens('past')).toBe('past');
  expect(parseTripLens('bogus')).toBe('all');
  expect(parseTripLens(null)).toBe('all');
});
