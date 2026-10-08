import { expect, test } from 'vitest';

import type { Trip } from '../lib/trips/api.ts';
import {
  groupAheadByMonth,
  groupPastByYear,
  libraryLedger,
  tripDayProgress,
} from '../lib/trips/library.ts';

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

test('trips ahead are grouped by the month they leave in, in departure order', () => {
  const groups = groupAheadByMonth([
    trip({ id: 'nov-a', lifecycle: 'planning', startDate: '2026-11-04' }),
    trip({ id: 'nov-b', lifecycle: 'planning', startDate: '2026-11-12' }),
    trip({ id: 'dec', lifecycle: 'planning', startDate: '2026-12-05' }),
    trip({ id: 'jan', lifecycle: 'planning', startDate: '2027-01-02' }),
  ]);

  expect(groups.map((group) => [group.key, group.trips.map((entry) => entry.id)])).toStrictEqual([
    ['2026-11', ['nov-a', 'nov-b']],
    ['2026-12', ['dec']],
    ['2027-01', ['jan']],
  ]);
});

test('a second trip under way sits above the months, under now', () => {
  const groups = groupAheadByMonth([
    trip({ id: 'travelling', lifecycle: 'active', startDate: '2026-10-09' }),
    trip({ id: 'october', lifecycle: 'planning', startDate: '2026-10-16' }),
  ]);

  expect(groups.map((group) => [group.kind, group.trips.map((entry) => entry.id)])).toStrictEqual([
    ['now', ['travelling']],
    ['month', ['october']],
  ]);
});

test('nothing ahead groups into nothing', () => {
  expect(groupAheadByMonth([])).toStrictEqual([]);
});

test('finished trips are grouped by the year they ended, keeping the archive order', () => {
  const groups = groupPastByYear([
    trip({ endDate: '2026-10-06', id: 'recent', lifecycle: 'completed' }),
    // Began in 2025 and ended in 2026: it is filed beside the 2026 trips it
    // sorts among, so 2025 is never opened twice.
    trip({
      endDate: '2026-01-03',
      id: 'new-year',
      lifecycle: 'completed',
      startDate: '2025-12-28',
    }),
    trip({ endDate: '2025-09-22', id: 'older', lifecycle: 'completed' }),
  ]);

  expect(groups.map((group) => [group.year, group.trips.map((entry) => entry.id)])).toStrictEqual([
    ['2026', ['recent', 'new-year']],
    ['2025', ['older']],
  ]);
});

test('a trip under way counts its days from one, in its own time zone', () => {
  const singapore = trip({
    endDate: '2026-10-09',
    id: 'sg',
    lifecycle: 'active',
    referenceTimeZone: 'Asia/Singapore',
    startDate: '2026-10-07',
  });

  // 17:00 UTC on the 7th is already 01:00 on the 8th in Singapore.
  expect(tripDayProgress(singapore, new Date('2026-10-07T17:00:00.000Z'))).toStrictEqual({
    day: 2,
    total: 3,
  });
  expect(tripDayProgress(singapore, new Date('2026-10-07T02:00:00.000Z'))).toStrictEqual({
    day: 1,
    total: 3,
  });
});

test('the day count never runs outside the trip', () => {
  const short = trip({
    endDate: '2026-10-09',
    id: 'a',
    lifecycle: 'active',
    startDate: '2026-10-07',
  });

  expect(tripDayProgress(short, new Date('2026-10-12T12:00:00.000Z')).day).toBe(3);
  expect(tripDayProgress(short, new Date('2026-10-01T12:00:00.000Z')).day).toBe(1);
});

test('the ledger counts countries only from trips actually taken, once each', () => {
  expect(
    libraryLedger([
      trip({ countries: ['JP'], id: 'a', lifecycle: 'completed' }),
      trip({ countries: ['JP', 'KR'], id: 'b', lifecycle: 'completed' }),
      trip({ countries: ['SG'], id: 'c', lifecycle: 'active' }),
      // A plan is not a place the traveller has been.
      trip({ countries: ['VN'], id: 'd', lifecycle: 'planning' }),
      trip({ id: 'e', lifecycle: 'completed' }),
    ]),
  ).toStrictEqual({ ahead: 2, countries: 3, remembered: 3 });
});
