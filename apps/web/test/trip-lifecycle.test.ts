import { expect, test } from 'vitest';

import type { Trip } from '../lib/trips/api.ts';
import {
  calendarDayDistance,
  daysUntilTripStart,
  getLocalDate,
  isRecentlyCompleted,
  selectPrimaryTrip,
} from '../lib/trips/lifecycle.ts';

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

test('the local date follows the zone, not the device, across the date line', () => {
  // One instant, two calendar dates: Kiritimati is already tomorrow while Niue
  // is still yesterday. A countdown that used the device date would be a day
  // out for any traveller on the far side of it.
  const instant = new Date('2026-09-05T11:00:00.000Z');

  expect(getLocalDate(instant, 'Pacific/Kiritimati')).toBe('2026-09-06');
  expect(getLocalDate(instant, 'UTC')).toBe('2026-09-05');
  expect(getLocalDate(instant, 'Pacific/Niue')).toBe('2026-09-05');

  const earlier = new Date('2026-09-05T23:30:00.000Z');
  expect(getLocalDate(earlier, 'Pacific/Niue')).toBe('2026-09-05');
  expect(getLocalDate(earlier, 'Pacific/Kiritimati')).toBe('2026-09-06');
});

test('day distance counts dates, so a daylight-saving shift does not move it', () => {
  expect(calendarDayDistance('2026-09-05', '2026-09-05')).toBe(0);
  expect(calendarDayDistance('2026-09-05', '2026-09-21')).toBe(16);
  expect(calendarDayDistance('2026-09-21', '2026-09-05')).toBe(-16);
  // Europe/London leaves summer time on 2026-10-25; the day count must not
  // pick up the extra hour and round to 30.
  expect(calendarDayDistance('2026-10-24', '2026-10-26')).toBe(2);
  expect(calendarDayDistance('2026-03-28', '2026-03-30')).toBe(2);
});

test('the countdown stops at zero once a trip has started', () => {
  const upcoming = trip({ id: 'a', lifecycle: 'planning', startDate: '2026-09-05' });

  expect(daysUntilTripStart(upcoming, new Date('2026-09-01T12:00:00.000Z'))).toBe(4);
  expect(daysUntilTripStart(upcoming, new Date('2026-09-05T12:00:00.000Z'))).toBe(0);
  // Already travelling: a negative countdown would read as nonsense.
  expect(daysUntilTripStart(upcoming, new Date('2026-09-09T12:00:00.000Z'))).toBe(0);
});

test('a finished trip stays recent for thirty days and not a day longer', () => {
  const finished = trip({ id: 'a', lifecycle: 'completed', endDate: '2026-09-21' });

  expect(isRecentlyCompleted(finished, new Date('2026-09-21T12:00:00.000Z'))).toBe(true);
  expect(isRecentlyCompleted(finished, new Date('2026-10-21T12:00:00.000Z'))).toBe(true);
  expect(isRecentlyCompleted(finished, new Date('2026-10-22T12:00:00.000Z'))).toBe(false);
  // A trip that has not ended yet is not "recently completed" either.
  expect(isRecentlyCompleted(finished, new Date('2026-09-20T12:00:00.000Z'))).toBe(false);
});

test('the trip being travelled outranks the one being planned', () => {
  const trips = [
    trip({ id: 'planning', lifecycle: 'planning', startDate: '2026-09-05' }),
    trip({ id: 'active', lifecycle: 'active' }),
  ];

  expect(selectPrimaryTrip(trips)?.id).toBe('active');
});

test('within a stage the nearest trip leads', () => {
  const active = [
    trip({ id: 'later', lifecycle: 'active', endDate: '2026-09-30' }),
    trip({ id: 'sooner', lifecycle: 'active', endDate: '2026-09-21' }),
  ];
  expect(selectPrimaryTrip(active)?.id).toBe('sooner');

  const planning = [
    trip({ id: 'later', lifecycle: 'planning', startDate: '2026-11-01' }),
    trip({ id: 'sooner', lifecycle: 'planning', startDate: '2026-09-05' }),
  ];
  expect(selectPrimaryTrip(planning)?.id).toBe('sooner');
});

test('a just-finished trip leads Home but never the library', () => {
  const now = new Date('2026-09-25T12:00:00.000Z');
  const trips = [trip({ id: 'finished', lifecycle: 'completed', endDate: '2026-09-21' })];

  expect(selectPrimaryTrip(trips, now)?.id).toBe('finished');
  expect(selectPrimaryTrip(trips, now, { includeRecentlyCompleted: false })).toBeNull();
});

test('a long-finished trip leads nothing', () => {
  const trips = [trip({ id: 'old', lifecycle: 'completed', endDate: '2025-09-21' })];

  expect(selectPrimaryTrip(trips, new Date('2026-09-25T12:00:00.000Z'))).toBeNull();
});

test('no trips means no primary trip', () => {
  expect(selectPrimaryTrip([])).toBeNull();
});
